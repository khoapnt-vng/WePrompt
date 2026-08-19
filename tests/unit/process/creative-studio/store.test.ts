/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  promises as nodeFs,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import type {
  CreateStudioProjectInput,
  CreateStudioProjectInputV2,
  StudioAsset,
  StudioAssetV2,
  StudioShot,
  StudioConnectionBinding,
  StudioConnectionCandidate,
  StudioConnectionInventory,
  StudioConnectionRecord,
  StudioConnectionValidationResult,
  StudioCommandResult,
  StudioCut,
  StudioCutFilter,
  StudioDesktopApi,
  StudioEditableCut,
  StudioEditableCutClip,
  StudioJob,
  StudioJobV2,
  StudioGenerationRequestPlan,
  StudioMutationBatchV2,
  StudioMutationReducerContextV2,
  StudioProject,
  StudioProjectSummary,
  StudioProjectV2,
  StudioProposalCommitAttributionV2,
  StudioProposalRecordV2,
  StudioProposalSlotV2,
  StudioReferenceGenerationHandoffReceiptV2,
  StudioReferenceRequestDecisionV2,
  StudioReferenceRequestSlotV2,
  StudioReferenceRequestV2,
  StudioQuotedGeneration,
  StudioMediaChoiceRef,
  StudioProposalPayload,
  StudioRendererJob,
  StudioRendererProject,
  StudioRouteCatalog,
  StudioSpendAuthorization,
} from '@/common/types/project/creativeStudioTypes';
import { STUDIO_REFERENCE_REQUEST_V2_MAX_PENDING_PER_PROJECT } from '@/common/types/project/creativeStudioTypes';
import {
  allocateStudioBriefReferenceLabel,
  getStudioReferencePlateFreshness,
  resolveActiveStudioBriefReferences,
  STUDIO_BRIEF_REFERENCE_LABEL_MAX_LENGTH,
} from '@/common/types/project/creativeStudioManagedAssetCollections';
import { jobOutputRole } from '@/common/types/project/creativeStudioOutputRole';
import {
  createEmptyStudioProjectV2,
  type StudioMutationApplyResultV2,
} from '@process/services/creative-studio/service/schema2';
import {
  calculateStudioQuoteTotals,
  createStudioQuotedGenerationId,
} from '@process/services/creative-studio/service/schema2/generation';
import { STUDIO_EDITABLE_SCENE_LIMITS, editableSceneSchema } from '@process/resources/builtinMcp/studioServer';
import type { StudioProposalWriteError } from '@process/resources/builtinMcp/studioProposalWriter';
import { writeProposalRecord } from '@process/resources/builtinMcp/studioProposalWriter';
import { writeReferenceRequestRecord } from '@process/resources/builtinMcp/studioReferenceRequestWriter';
import {
  createCreativeStudioStore,
  StudioProjectConfirmationError,
  STUDIO_PROPOSAL_MAX_PENDING_PER_PROJECT,
  STUDIO_PROPOSAL_PENDING_TTL_MS,
  STUDIO_PROJECT_V2_MAX_RECORD_BYTES,
  type CreativeStudioStore,
  type StudioProjectConfirmationInputV2,
  type StudioProjectInventoryV2,
  type StudioProjectStoreLoadResultV2,
  type StudioProjectCommitObserver,
} from '@process/services/creative-studio/store';

const makeInput = (overrides: Partial<CreateStudioProjectInput> = {}): CreateStudioProjectInput => ({
  name: 'Launch film',
  brief: 'A short launch story',
  aspectRatio: '16:9',
  targetDurationSeconds: 12,
  resolution: '1080p',
  ...overrides,
});

const subprocessProposalPayload: StudioProposalPayload = {
  kind: 'replace_storyboard',
  sceneOrder: ['scene_1'],
  scenes: {
    scene_1: {
      title: 'Sunrise over the terraces',
      purpose: 'Open on the origin of the coffee',
      visualPrompt: 'Golden hour over mountain coffee terraces, mist in the valleys',
      narration: 'It starts at 1,600 meters.',
      onScreenText: '',
      mediaKind: 'image',
      durationSeconds: 5,
      referenceAssetId: null,
    },
  },
};

const cloneProject = (project: StudioProject): StudioProject => structuredClone(project);

const makeProjectImport = (project: StudioProject, id: string, overrides: Partial<StudioAsset> = {}): StudioAsset => ({
  id,
  projectId: project.id,
  sceneId: null,
  mediaKind: 'image',
  mimeType: 'image/png',
  managedAsset: { collection: 'imports', fileName: `${id}.png` },
  byteSize: 1,
  sha256: 'a'.repeat(64),
  createdAt: project.createdAt,
  ...overrides,
});

const addScene = (project: StudioProject, id: string, durationSeconds = 1): StudioProject => {
  const next = cloneProject(project);
  next.scenes[id] = {
    id,
    title: `Scene ${id}`,
    purpose: 'Test scene',
    visualPrompt: 'A safe test scene',
    narration: '',
    onScreenText: '',
    mediaKind: 'image',
    durationSeconds,
    referenceAssetId: null,
    selectedAssetId: null,
    assetIds: [],
    jobIds: [],
    reviewState: 'draft',
  };
  next.sceneOrder.push(id);
  return next;
};

const withSceneCount = (project: StudioProject, count: number): StudioProject => {
  let next = cloneProject(project);
  for (let index = next.sceneOrder.length; index < count; index += 1) {
    next = addScene(next, `scene_${index + 1}`);
  }
  return next;
};

const addVideoAsset = (project: StudioProject, durationSeconds: number): StudioProject => {
  const next = addScene(project, 'scene_1');
  next.scenes.scene_1.mediaKind = 'video';
  next.assets.asset_1 = {
    id: 'asset_1',
    projectId: next.id,
    sceneId: 'scene_1',
    mediaKind: 'video',
    mimeType: 'video/mp4',
    managedAsset: { collection: 'assets', fileName: 'asset_1.mp4' },
    byteSize: 1,
    sha256: '0'.repeat(64),
    durationSeconds,
    createdAt: next.createdAt,
  };
  next.scenes.scene_1.assetIds = ['asset_1'];
  return next;
};

const addCut = (project: StudioProject, durationSeconds: number | null = 5.085): StudioProject => {
  const next = addVideoAsset(project, durationSeconds ?? 5.085);
  if (durationSeconds === null) delete next.assets.asset_1.durationSeconds;
  next.scenes.scene_1.selectedAssetId = 'asset_1';
  next.cuts = {
    cut_1: {
      id: 'cut_1',
      name: next.name,
      orderMode: 'storyboard',
      clipOrder: ['clip_1'],
      clips: {
        clip_1: {
          id: 'clip_1',
          sceneId: 'scene_1',
          assetId: 'asset_1',
          sourceInSeconds: 0.25,
          sourceOutSeconds: 4.5,
          crop: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 },
          filters: [{ id: 'temperature', amount: 0.25 }],
        },
      },
    },
  };
  next.activeCutId = 'cut_1';
  return next;
};

const addSucceededJob = (project: StudioProject): StudioProject => {
  const next = addScene(project, 'scene_1');
  next.assets.asset_1 = {
    id: 'asset_1',
    projectId: next.id,
    sceneId: 'scene_1',
    mediaKind: 'image',
    mimeType: 'image/png',
    managedAsset: { collection: 'assets', fileName: 'asset_1.png' },
    byteSize: 1,
    sha256: '0'.repeat(64),
    createdAt: next.createdAt,
  };
  next.jobs.job_1 = {
    id: 'job_1',
    projectId: next.id,
    sceneId: 'scene_1',
    status: 'succeeded',
    provider: { providerId: 'provider_1', adapterId: 'weprompt-image-v1', model: 'model_1' },
    idempotencyKey: 'key_1',
    providerJobId: null,
    cancellationPolicy: 'none',
    outputAssetIds: [],
    error: null,
    retryOfJobId: null,
    retryReason: null,
    duplicateChargeAcknowledged: false,
    duplicateChargeAcknowledgedAt: null,
    createdAt: next.createdAt,
    updatedAt: next.updatedAt,
  };
  next.scenes.scene_1.assetIds = ['asset_1'];
  next.scenes.scene_1.jobIds = ['job_1'];
  return next;
};

const makeJob = (
  project: StudioProject,
  id: string,
  sceneId: string,
  overrides: Partial<StudioJob> = {}
): StudioJob => ({
  id,
  projectId: project.id,
  sceneId,
  status: 'failed',
  provider: { providerId: 'provider_1', adapterId: 'weprompt-image-v1', model: 'model_1' },
  idempotencyKey: `key_${id}`,
  providerJobId: null,
  cancellationPolicy: 'none',
  outputAssetIds: [],
  error: { code: 'provider_unavailable', messageKey: 'conversation.creativeStudio.jobs.errors.providerUnavailable' },
  retryOfJobId: null,
  retryReason: null,
  duplicateChargeAcknowledged: false,
  duplicateChargeAcknowledgedAt: null,
  createdAt: project.createdAt,
  updatedAt: project.updatedAt,
  ...overrides,
});

const addRetryGraph = (project: StudioProject): StudioProject => {
  let next = addScene(project, 'scene_1');
  next = addScene(next, 'scene_2');
  next.jobs.job_1 = makeJob(next, 'job_1', 'scene_1');
  next.jobs.job_2 = makeJob(next, 'job_2', 'scene_1', {
    retryOfJobId: 'job_1',
    retryReason: 'provider_failure',
  });
  next.scenes.scene_1.jobIds = ['job_1', 'job_2'];
  return next;
};

const validConnectionBinding = (): StudioConnectionBinding => ({
  schemaVersion: 1,
  id: 'binding_1',
  providerId: 'provider_1',
  adapterId: 'weprompt-media-gateway-v1',
  model: 'open-sora',
  capabilities: { mediaKinds: ['video'], audioModes: ['none'] },
  validatedAt: '2026-07-30T00:00:00.000Z',
});

const proposalPayload = (title = 'Proposed opening') => ({
  kind: 'replace_storyboard' as const,
  sceneOrder: ['scene_proposed'],
  scenes: {
    scene_proposed: {
      title,
      purpose: 'Open the story',
      visualPrompt: 'A bounded proposal payload',
      narration: '',
      onScreenText: '',
      mediaKind: 'image' as const,
      durationSeconds: 5,
      referenceAssetId: null,
    },
  },
});

const summaryRenameFailureFs = () => {
  let armed = false;
  let projectRenameAttempts = 0;
  let summaryRenameAttempts = 0;
  const fs = new Proxy(nodeFs, {
    get(target, property, receiver) {
      if (property !== 'rename') return Reflect.get(target, property, receiver);
      return async (...args: Parameters<typeof nodeFs.rename>): ReturnType<typeof nodeFs.rename> => {
        const destination = String(args[1]);
        if (destination.endsWith(`${path.sep}project.json`)) projectRenameAttempts += 1;
        if (destination.endsWith(`${path.sep}projects.json`)) {
          summaryRenameAttempts += 1;
          if (armed) {
            armed = false;
            throw new Error('summary rename failed');
          }
        }
        return nodeFs.rename(...args);
      };
    },
  }) as typeof nodeFs;
  return {
    fs,
    arm: (): void => {
      armed = true;
    },
    projectRenameAttempts: (): number => projectRenameAttempts,
    summaryRenameAttempts: (): number => summaryRenameAttempts,
  };
};

describe('Creative Studio Brief reference metadata', () => {
  const project = {
    id: 'project_1',
    createdAt: '2026-08-15T00:00:00.000Z',
  } as StudioProject;

  const classifiedImport = (
    id: string,
    role: 'cast' | 'look',
    createdAt: string,
    overrides: Partial<StudioAsset> = {}
  ): StudioAsset =>
    makeProjectImport(project, id, {
      createdAt,
      briefReferenceRole: role,
      briefReferenceLabel: id,
      ...overrides,
    });

  it('ignores legacy project imports with no Brief classification', () => {
    expect(resolveActiveStudioBriefReferences({ legacy: makeProjectImport(project, 'legacy') })).toEqual([]);
  });

  it.each([{ briefReferenceRole: 'cast' as const }, { briefReferenceLabel: 'Hero' }])(
    'rejects an incomplete role and label pair: %o',
    (metadata) => {
      const asset = makeProjectImport(project, 'hero', metadata);

      expect(resolveActiveStudioBriefReferences({ hero: asset })).toBeNull();
    }
  );

  it.each([
    { sceneId: 'scene_1' },
    { mediaKind: 'video' as const, mimeType: 'video/mp4' },
    { mimeType: 'video/mp4' },
    { managedAsset: { collection: 'assets' as const, fileName: 'hero.png' } },
  ])('rejects classified metadata on an asset that cannot be a Brief reference: %o', (overrides) => {
    const asset = classifiedImport('hero', 'cast', project.createdAt, overrides);

    expect(resolveActiveStudioBriefReferences({ hero: asset })).toBeNull();
  });

  it('orders cast before look and breaks ties by createdAt then id', () => {
    const assets = {
      look_old: classifiedImport('look_old', 'look', '2026-08-15T00:00:00.000Z'),
      cast_new: classifiedImport('cast_new', 'cast', '2026-08-15T00:00:01.000Z'),
      cast_b: classifiedImport('cast_b', 'cast', '2026-08-15T00:00:00.000Z'),
      cast_a: classifiedImport('cast_a', 'cast', '2026-08-15T00:00:00.000Z'),
    };

    expect(resolveActiveStudioBriefReferences(assets)?.map((asset) => asset.id)).toEqual([
      'cast_a',
      'cast_b',
      'cast_new',
      'look_old',
    ]);
  });

  it('orders mixed-case and punctuation timestamps by deterministic code units', () => {
    const assets = {
      lower: classifiedImport('lower', 'cast', 'a_stamp'),
      punctuation: classifiedImport('punctuation', 'cast', '_stamp'),
      upper: classifiedImport('upper', 'cast', 'B_stamp'),
    };

    expect(resolveActiveStudioBriefReferences(assets)?.map((asset) => asset.id)).toEqual([
      'upper',
      'punctuation',
      'lower',
    ]);
  });

  it('breaks timestamp ties for mixed-case and punctuation IDs by deterministic code units', () => {
    const assets = {
      a_ref: classifiedImport('a_ref', 'cast', project.createdAt),
      Z_ref: classifiedImport('Z_ref', 'cast', project.createdAt),
      _ref: classifiedImport('_ref', 'cast', project.createdAt),
    };

    expect(resolveActiveStudioBriefReferences(assets)?.map((asset) => asset.id)).toEqual(['Z_ref', '_ref', 'a_ref']);
  });

  it('accepts six active references and rejects a seventh', () => {
    const six = Object.fromEntries(
      Array.from({ length: 6 }, (_, index) => {
        const id = `reference_${index + 1}`;
        return [id, classifiedImport(id, index < 3 ? 'cast' : 'look', project.createdAt)];
      })
    );

    expect(resolveActiveStudioBriefReferences(six)).toHaveLength(6);
    expect(
      resolveActiveStudioBriefReferences({
        ...six,
        reference_7: classifiedImport('reference_7', 'look', project.createdAt),
      })
    ).toBeNull();
  });

  it('derives a trimmed, control-free basename label', () => {
    expect(allocateStudioBriefReferenceLabel('/tmp/  Hero\u0000\t Portrait .PNG', [])).toBe('Hero Portrait');
  });

  it('bounds labels while preserving a unique numeric suffix', () => {
    const source = `${'x'.repeat(STUDIO_BRIEF_REFERENCE_LABEL_MAX_LENGTH + 20)}.png`;
    const first = allocateStudioBriefReferenceLabel(source, []);
    const second = allocateStudioBriefReferenceLabel(source, [first]);

    expect(first).toHaveLength(STUDIO_BRIEF_REFERENCE_LABEL_MAX_LENGTH);
    expect(second).toHaveLength(STUDIO_BRIEF_REFERENCE_LABEL_MAX_LENGTH);
    expect(second.endsWith(' (2)')).toBe(true);
    expect(second).not.toBe(first);
  });

  it('reports complete exact plate provenance as current', () => {
    const plate = classifiedImport('plate_1', 'cast', project.createdAt, {
      sceneId: 'scene_1',
      managedAsset: { collection: 'references', fileName: 'plate_1.png' },
      sourceVisualPrompt: 'Hero enters the arena',
      sourceReferenceAssetIds: ['cast_1', 'look_1'],
      sourceAspectRatio: '16:9',
      sourceResolution: '1080p',
      briefReferenceRole: undefined,
      briefReferenceLabel: undefined,
    });

    expect(
      getStudioReferencePlateFreshness(plate, {
        visualPrompt: 'Hero enters the arena',
        referenceAssetIds: ['cast_1', 'look_1'],
        aspectRatio: '16:9',
        resolution: '1080p',
      })
    ).toBe('current');
  });

  it.each([
    { visualPrompt: 'Hero leaves the arena' },
    { referenceAssetIds: ['look_1', 'cast_1'] },
    { referenceAssetIds: ['cast_1'] },
    { referenceAssetIds: ['cast_1', 'look_1', 'look_2'] },
    { aspectRatio: '9:16' as const },
    { resolution: '720p' as const },
  ])('reports changed frame-defining inputs as out of date: %o', (override) => {
    const plate = makeProjectImport(project, 'plate_1', {
      sceneId: 'scene_1',
      managedAsset: { collection: 'references', fileName: 'plate_1.png' },
      sourceVisualPrompt: 'Hero enters the arena',
      sourceReferenceAssetIds: ['cast_1', 'look_1'],
      sourceAspectRatio: '16:9',
      sourceResolution: '1080p',
    });

    expect(
      getStudioReferencePlateFreshness(plate, {
        visualPrompt: 'Hero enters the arena',
        referenceAssetIds: ['cast_1', 'look_1'],
        aspectRatio: '16:9',
        resolution: '1080p',
        ...override,
      })
    ).toBe('out_of_date');
  });

  it('reports missing legacy provenance as unknown rather than out of date', () => {
    const legacyPlate = makeProjectImport(project, 'plate_1', {
      sceneId: 'scene_1',
      managedAsset: { collection: 'references', fileName: 'plate_1.png' },
      sourceVisualPrompt: 'Hero enters the arena',
    });

    expect(
      getStudioReferencePlateFreshness(legacyPlate, {
        visualPrompt: 'Changed prompt',
        referenceAssetIds: ['cast_1'],
        aspectRatio: '9:16',
        resolution: '720p',
      })
    ).toBe('unknown');
  });
});

describe('creative studio project store', () => {
  let rootDir: string;
  let store: CreativeStudioStore;
  let clock: number;
  let idCounter: number;

  beforeEach(() => {
    rootDir = mkdtempSync(path.join(tmpdir(), 'creative-studio-store-'));
    clock = 1_700_000_000_000;
    idCounter = 0;
    store = createCreativeStudioStore({
      rootDir,
      now: () => new Date((clock += 1_000)).toISOString(),
      createId: () => `project_${++idCounter}`,
    });
  });

  afterEach(() => {
    rmSync(rootDir, { recursive: true, force: true });
  });

  it('creates a durable project at revision 1 instead of returning an unwritten draft', async () => {
    const project = await store.createProject(makeInput());

    expect(project.revision).toBe(1);
    expect(project.schemaVersion).toBe(1);
    expect(await store.getProject(project.id)).toEqual(project);
  });

  it('reads and lists a legacy 25-scene schema-v1 project without rewriting or quarantining it', async () => {
    const project = await store.createProject(makeInput());
    const file = path.join(rootDir, project.id, 'project.json');
    const legacy = withSceneCount(project, 25);
    const manifestBytes = JSON.stringify(legacy);
    writeFileSync(file, manifestBytes);

    await expect(store.getProject(project.id)).resolves.toEqual(legacy);
    await expect(store.listProjects()).resolves.toEqual([
      expect.objectContaining({ id: project.id, sceneCount: 25, selectedAssetCount: 0 }),
    ]);
    await expect(store.listQuarantinedProjectIds()).resolves.toEqual([]);
    expect(readFileSync(file, 'utf8')).toBe(manifestBytes);
  });

  it('lists a legacy 25-scene project whose selected canonical take is number 257', async () => {
    const project = await store.createProject(makeInput());
    const file = path.join(rootDir, project.id, 'project.json');
    const legacy = withSceneCount(project, 25);
    const takes = Array.from({ length: 257 }, (_, index) => {
      const assetId = `asset_${index + 1}`;
      return {
        id: assetId,
        projectId: legacy.id,
        sceneId: 'scene_1',
        mediaKind: 'image' as const,
        mimeType: 'image/png',
        managedAsset: { collection: 'assets' as const, fileName: `${assetId}.png` },
        byteSize: 1,
        sha256: 'a'.repeat(64),
        createdAt: legacy.createdAt,
      };
    });
    legacy.assets = Object.fromEntries(takes.map((asset) => [asset.id, asset]));
    legacy.scenes.scene_1.assetIds = takes.map((asset) => asset.id);
    legacy.scenes.scene_1.selectedAssetId = 'asset_257';
    const manifestBytes = JSON.stringify(legacy);
    writeFileSync(file, manifestBytes);

    await expect(store.getProject(project.id)).resolves.toEqual(legacy);
    await expect(store.listProjects()).resolves.toEqual([
      expect.objectContaining({
        id: project.id,
        sceneCount: 25,
        selectedAssetCount: 1,
        poster: expect.objectContaining({ assetId: 'asset_257', sceneNumber: 1, takeNumber: 257 }),
      }),
    ]);
    expect(readFileSync(file, 'utf8')).toBe(manifestBytes);
  });

  it('rejects a direct 23-to-25 scene transition without changing manifest bytes or revision', async () => {
    const project = await store.createProject(makeInput());
    const admitted = await store.updateProject(project.id, (current) => withSceneCount(current, 23), project.revision);
    const file = path.join(rootDir, project.id, 'project.json');
    const before = readFileSync(file);

    await expect(
      store.updateProject(admitted.id, (current) => withSceneCount(current, 25), admitted.revision)
    ).rejects.toMatchObject({ code: 'invalid_payload', message: 'Studio scene limit exceeded' });

    expect(readFileSync(file)).toEqual(before);
    await expect(store.getProject(project.id)).resolves.toMatchObject({
      revision: admitted.revision,
      sceneOrder: admitted.sceneOrder,
    });
  });

  it('allows a legacy over-capacity project to stay or shrink but never grow', async () => {
    const project = await store.createProject(makeInput());
    const file = path.join(rootDir, project.id, 'project.json');
    writeFileSync(file, JSON.stringify(withSceneCount(project, 25)));

    const retained = await store.updateProject(project.id, (current) => ({ ...current, name: 'Legacy retained' }), 1);
    expect(retained.sceneOrder).toHaveLength(25);

    const beforeGrowth = readFileSync(file);
    await expect(
      store.updateProject(retained.id, (current) => withSceneCount(current, 26), retained.revision)
    ).rejects.toMatchObject({ code: 'invalid_payload', message: 'Studio scene limit exceeded' });
    expect(readFileSync(file)).toEqual(beforeGrowth);

    const reduced = await store.updateProject(
      retained.id,
      (current) => {
        const next = structuredClone(current);
        const removed = next.sceneOrder.pop()!;
        delete next.scenes[removed];
        return next;
      },
      retained.revision
    );
    expect(reduced.sceneOrder).toHaveLength(24);
  });

  it('does not let an admitted 24-scene project cross the scene limit', async () => {
    const project = await store.createProject(makeInput());
    const admitted = await store.updateProject(project.id, (current) => withSceneCount(current, 24), project.revision);

    await expect(
      store.updateProject(admitted.id, (current) => withSceneCount(current, 25), admitted.revision)
    ).rejects.toMatchObject({ code: 'invalid_payload', message: 'Studio scene limit exceeded' });
  });

  it('reads a project written before rule history existed and defaults the missing fields', async () => {
    const project = await store.createProject(makeInput());
    const file = path.join(rootDir, project.id, 'project.json');
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    delete raw.rules;
    delete raw.ruleListUndo;
    writeFileSync(file, JSON.stringify(raw));

    const reread = await store.getProject(project.id);

    expect(reread?.rules).toEqual([]);
    expect(reread?.ruleListUndo).toBeNull();
    expect(await store.listQuarantinedProjectIds()).toEqual([]);

    await store.updateProject(project.id, (current) => ({ ...current, name: 'Migrated project' }));
    expect((JSON.parse(readFileSync(file, 'utf8')) as StudioProject).rules).toEqual([]);
    expect((JSON.parse(readFileSync(file, 'utf8')) as StudioProject).ruleListUndo).toBeNull();
  });

  it('persists a valid enforced rule and reads it back unchanged', async () => {
    const project = await store.createProject(makeInput());
    const rule: StudioProject['rules'][number] = {
      id: 'rule_1',
      scope: 'project',
      text: 'Do not show competitor branding',
      predicate: { kind: 'forbidden_terms', terms: ['nike'] },
      createdAt: '2026-08-13T00:00:00.000Z',
    };

    await store.updateProject(project.id, (current) => ({ ...current, rules: [rule] }), project.revision);

    expect((await store.getProject(project.id))?.rules).toEqual([rule]);
  });

  it('refuses a rules array that breaks the shape, rather than persisting it unread', async () => {
    const project = await store.createProject(makeInput());
    const file = path.join(rootDir, project.id, 'project.json');
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    raw.rules = [
      {
        id: 'rule_1',
        scope: 'project',
        text: 'x',
        predicate: { kind: 'nope', terms: ['nike'] },
        createdAt: '2026-08-13T00:00:00.000Z',
      },
    ];
    writeFileSync(file, JSON.stringify(raw));

    await expect(store.getProject(project.id)).rejects.toMatchObject({ code: 'storage_error' });
  });

  it('refuses an organisation-scoped rule on the project record, because that layer is code-resident', async () => {
    const project = await store.createProject(makeInput());
    const file = path.join(rootDir, project.id, 'project.json');
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    raw.rules = [
      { id: 'rule_1', scope: 'organisation', text: 'x', predicate: null, createdAt: '2026-08-13T00:00:00.000Z' },
    ];
    writeFileSync(file, JSON.stringify(raw));

    await expect(store.getProject(project.id)).rejects.toMatchObject({ code: 'storage_error' });
  });

  describe('proposal ledger', () => {
    it('accepts a pin_rule proposal record and refuses one with an unknown key', async () => {
      const project = await store.createProject(makeInput());
      const { pendingDir } = await store.resolveProposalPaths(project.id);

      const good = {
        schemaVersion: 1,
        id: 'proposal_rule',
        projectId: project.id,
        status: 'pending',
        baseRevision: project.revision,
        payload: { kind: 'pin_rule', rule: { text: 'Keep the kits generic.', predicate: null } },
        createdAt: '2026-08-13T00:00:00.000Z',
        decidedAt: null,
      };
      writeFileSync(path.join(pendingDir, 'proposal_rule.json'), JSON.stringify(good));
      writeFileSync(
        path.join(pendingDir, 'proposal_bad.json'),
        JSON.stringify({ ...good, id: 'proposal_bad', payload: { ...good.payload, sceneOrder: [] } })
      );

      const proposals = await store.listProposals(project.id);

      expect(proposals.map((proposal) => proposal.id)).toEqual(['proposal_rule']);
    });

    it('resolves verified project and pending paths while creating every proposal directory', async () => {
      const project = await store.createProject(makeInput());

      const paths = await store.resolveProposalPaths(project.id);
      const canonicalRoot = await realpath(rootDir);

      expect(paths).toEqual({
        projectDir: path.join(canonicalRoot, project.id),
        pendingDir: path.join(canonicalRoot, project.id, 'proposals', 'pending'),
        referencePendingDir: path.join(canonicalRoot, project.id, 'reference-requests', 'pending'),
      });
      expect(existsSync(path.join(rootDir, project.id, 'proposals', 'decisions'))).toBe(true);
      expect(existsSync(path.join(rootDir, project.id, 'proposals', 'slots'))).toBe(true);
      expect(existsSync(path.join(rootDir, project.id, 'reference-requests', 'slots'))).toBe(true);
    });

    it('rejects proposal-path resolution for an unknown project', async () => {
      await expect(store.resolveProposalPaths('project_missing')).rejects.toMatchObject({ code: 'not_found' });
    });

    it('records one immutable project-scoped proposal and reloads it after restart', async () => {
      const project = await store.createProject(makeInput());
      const recorded = await store.recordProposal({
        projectId: project.id,
        proposalId: 'proposal_1',
        baseRevision: project.revision,
        payload: proposalPayload(),
      });
      const reloadedStore = createCreativeStudioStore({
        rootDir,
        now: () => new Date((clock += 1_000)).toISOString(),
      });

      await expect(reloadedStore.listProposals(project.id)).resolves.toEqual([recorded]);
      expect(recorded).toMatchObject({
        schemaVersion: 1,
        id: 'proposal_1',
        projectId: project.id,
        status: 'pending',
        baseRevision: project.revision,
      });
      expect(
        JSON.parse(readFileSync(path.join(rootDir, project.id, 'proposals', 'pending', 'proposal_1.json'), 'utf8'))
      ).toEqual(recorded);
    });

    it('preserves immutable proposal byte-sync, link publication, and parent-directory sync through shared record IO', async () => {
      const project = await store.createProject(makeInput());
      const events: string[] = [];
      const observedFs = new Proxy(nodeFs, {
        get(realFs, property, receiver) {
          if (property === 'link') {
            return async (...args: Parameters<typeof nodeFs.link>): ReturnType<typeof nodeFs.link> => {
              events.push('link');
              return nodeFs.link(...args);
            };
          }
          if (property !== 'open') return Reflect.get(realFs, property, receiver);
          return async (...args: Parameters<typeof nodeFs.open>) => {
            const handle = await nodeFs.open(...args);
            const file = String(args[0]);
            const isPendingDirectory = file.endsWith(`${path.sep}proposals${path.sep}pending`);
            const isProposalTemporary =
              file.includes(`${path.sep}proposals${path.sep}pending${path.sep}proposal_io.json.`) &&
              file.endsWith('.tmp');
            return new Proxy(handle, {
              get(realHandle, handleProperty, handleReceiver) {
                if (handleProperty === 'writeFile' && isProposalTemporary) {
                  return async (...writeArgs: Parameters<typeof handle.writeFile>) => {
                    events.push('write');
                    return handle.writeFile(...writeArgs);
                  };
                }
                if (handleProperty === 'sync' && (isProposalTemporary || isPendingDirectory)) {
                  return async () => {
                    events.push(isPendingDirectory ? 'directory-sync' : 'file-sync');
                    return handle.sync();
                  };
                }
                return Reflect.get(realHandle, handleProperty, handleReceiver);
              },
            });
          };
        },
      }) as typeof nodeFs;
      const observedStore = createCreativeStudioStore({
        rootDir,
        fs: observedFs,
        now: () => '2026-08-16T12:00:00.000Z',
      });

      await observedStore.recordProposal({
        projectId: project.id,
        proposalId: 'proposal_io',
        baseRevision: project.revision,
        payload: proposalPayload(),
      });

      expect(events).toEqual(['write', 'file-sync', 'directory-sync', 'link', 'directory-sync']);
    });

    it('keeps unsafe proposal records unreadable after delegating bounded lstat reads', async () => {
      const project = await store.createProject(makeInput());
      const { pendingDir } = await store.resolveProposalPaths(project.id);
      const outside = path.join(rootDir, 'outside-proposal.json');
      writeFileSync(
        outside,
        JSON.stringify({
          schemaVersion: 1,
          id: 'proposal_symlink',
          projectId: project.id,
          status: 'pending',
          baseRevision: project.revision,
          payload: proposalPayload(),
          createdAt: '2026-08-16T12:00:00.000Z',
          decidedAt: null,
        })
      );
      symlinkSync(outside, path.join(pendingDir, 'proposal_symlink.json'));

      await expect(store.listProposals(project.id)).resolves.toEqual([]);
    });

    it('marks a rejection with an immutable decision while retaining the original pending record', async () => {
      const project = await store.createProject(makeInput());
      await store.recordProposal({
        projectId: project.id,
        proposalId: 'proposal_1',
        baseRevision: project.revision,
        payload: proposalPayload(),
      });
      const originalPath = path.join(rootDir, project.id, 'proposals', 'pending', 'proposal_1.json');
      const originalBytes = readFileSync(originalPath);

      const rejected = await store.rejectProposal(project.id, 'proposal_1');

      expect(rejected.status).toBe('rejected');
      expect(readFileSync(originalPath)).toEqual(originalBytes);
      expect(
        JSON.parse(readFileSync(path.join(rootDir, project.id, 'proposals', 'decisions', 'proposal_1.json'), 'utf8'))
      ).toMatchObject({ proposalId: 'proposal_1', status: 'rejected' });
      await expect(store.listProposals(project.id)).resolves.toEqual([rejected]);
    });

    it('rejects a proposal whose serialized record exceeds 256 KiB without creating it', async () => {
      const project = await store.createProject(makeInput());
      const sceneOrder = Array.from({ length: 24 }, (_, index) => `scene_${index + 1}`);
      const scenes = Object.fromEntries(
        sceneOrder.map((sceneId) => [
          sceneId,
          {
            ...proposalPayload().scenes.scene_proposed,
            visualPrompt: 'v'.repeat(8 * 1024),
            narration: 'n'.repeat(4 * 1024),
            onScreenText: 'o'.repeat(1024),
          },
        ])
      );

      await expect(
        store.recordProposal({
          projectId: project.id,
          proposalId: 'proposal_too_large',
          baseRevision: project.revision,
          payload: { kind: 'replace_storyboard', sceneOrder, scenes },
        })
      ).rejects.toMatchObject({ code: 'invalid_payload' });
      await expect(store.listProposals(project.id)).resolves.toEqual([]);
      expect(existsSync(path.join(rootDir, project.id, 'proposals', 'pending', 'proposal_too_large.json'))).toBe(false);
    });

    /**
     * The `propose_storyboard` tool writes straight into the pending directory; the store only sees
     * the payload when it reads it back. So a scene the tool's schema admits and the store's reader
     * refuses is written to disk, reported to the Director as "recorded for user review", and then
     * dropped on read with nothing but a log line — no proposal for the user, no error for the
     * model. Since D10 that tool is the only route to a drafted storyboard, so a proposal lost this
     * way is the whole capability lost.
     *
     * This asserts the two agree at the boundary, which is the only place they can disagree.
     */
    it('keeps a proposal holding every field at the length propose_storyboard advertises', async () => {
      const project = await store.createProject(makeInput());
      const { pendingDir } = await store.resolveProposalPaths(project.id);
      const atAdvertisedMaximum = {
        title: 'T'.repeat(STUDIO_EDITABLE_SCENE_LIMITS.title),
        purpose: 'P'.repeat(STUDIO_EDITABLE_SCENE_LIMITS.purpose),
        visualPrompt: 'V'.repeat(STUDIO_EDITABLE_SCENE_LIMITS.visualPrompt),
        narration: 'N'.repeat(STUDIO_EDITABLE_SCENE_LIMITS.narration),
        onScreenText: 'O'.repeat(STUDIO_EDITABLE_SCENE_LIMITS.onScreenText),
        mediaKind: 'image' as const,
        durationSeconds: 5,
        referenceAssetId: null,
      };
      // Guards the guard: the limits above really are what the tool accepts, so this payload is one
      // the Director can actually send rather than a shape invented by the test.
      expect(editableSceneSchema.safeParse(atAdvertisedMaximum).success).toBe(true);

      const record = await writeProposalRecord({
        pendingDir,
        projectId: project.id,
        baseRevision: project.revision,
        payload: {
          kind: 'replace_storyboard',
          sceneOrder: ['scene_proposed'],
          scenes: { scene_proposed: atAdvertisedMaximum },
        },
      });

      expect((await store.listProposals(project.id)).map((proposal) => proposal.id)).toContain(record.id);
    });

    it('rejects an overlong opaque proposal id before constructing a filesystem path', async () => {
      const project = await store.createProject(makeInput());

      await expect(
        store.recordProposal({
          projectId: project.id,
          proposalId: 'p'.repeat(257),
          baseRevision: project.revision,
          payload: proposalPayload(),
        })
      ).rejects.toMatchObject({ code: 'invalid_payload' });
      await expect(store.listProposals(project.id)).resolves.toEqual([]);
    });

    it('admits at most 50 concurrent pending proposals and writes nothing for the overflow', async () => {
      expect(STUDIO_PROPOSAL_MAX_PENDING_PER_PROJECT).toBe(50);
      const project = await store.createProject(makeInput());
      const results = await Promise.allSettled(
        Array.from({ length: 51 }, (_, index) =>
          store.recordProposal({
            projectId: project.id,
            proposalId: `proposal_${index + 1}`,
            baseRevision: project.revision,
            payload: proposalPayload(`Proposal ${index + 1}`),
          })
        )
      );

      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(50);
      expect(results.filter((result) => result.status === 'rejected')).toEqual([
        expect.objectContaining({ reason: expect.objectContaining({ code: 'busy' }) }),
      ]);
      await expect(store.listProposals(project.id)).resolves.toHaveLength(50);
      expect(readdirSync(path.join(rootDir, project.id, 'proposals', 'pending'))).toHaveLength(50);
    });

    it('enforces the pending bound across independent writers racing for the final slot', async () => {
      const project = await store.createProject(makeInput());
      for (let index = 0; index < 49; index += 1) {
        // Populate the ledger serially so the assertion isolates only the final cross-writer race.
        // eslint-disable-next-line no-await-in-loop
        await store.recordProposal({
          projectId: project.id,
          proposalId: `proposal_${index + 1}`,
          baseRevision: project.revision,
          payload: proposalPayload(`Proposal ${index + 1}`),
        });
      }
      const secondWriter = createCreativeStudioStore({
        rootDir,
        now: () => new Date((clock += 1_000)).toISOString(),
      });

      const results = await Promise.allSettled([
        store.recordProposal({
          projectId: project.id,
          proposalId: 'proposal_50_a',
          baseRevision: project.revision,
          payload: proposalPayload('Proposal 50 A'),
        }),
        secondWriter.recordProposal({
          projectId: project.id,
          proposalId: 'proposal_50_b',
          baseRevision: project.revision,
          payload: proposalPayload('Proposal 50 B'),
        }),
      ]);

      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
      await expect(store.listProposals(project.id)).resolves.toHaveLength(50);
    });

    it('reaps abandoned pending proposals by appending an expiry decision before listing', async () => {
      expect(STUDIO_PROPOSAL_PENDING_TTL_MS).toBe(7 * 24 * 60 * 60 * 1_000);
      const project = await store.createProject(makeInput());
      await store.recordProposal({
        projectId: project.id,
        proposalId: 'proposal_abandoned',
        baseRevision: project.revision,
        payload: proposalPayload(),
      });
      clock += 8 * 24 * 60 * 60 * 1_000;

      await expect(store.listProposals(project.id)).resolves.toMatchObject([
        { id: 'proposal_abandoned', status: 'expired' },
      ]);
      expect(
        JSON.parse(
          readFileSync(path.join(rootDir, project.id, 'proposals', 'decisions', 'proposal_abandoned.json'), 'utf8')
        )
      ).toMatchObject({ proposalId: 'proposal_abandoned', status: 'expired' });
    });

    it('reaps abandoned reference requests and releases their queue slots', async () => {
      expect(STUDIO_PROPOSAL_PENDING_TTL_MS).toBe(7 * 24 * 60 * 60 * 1_000);
      const project = await store.createProject(makeInput());
      await store.updateProject(project.id, (current) => addScene(current, 'scene_1'));
      const paths = await store.resolveProposalPaths(project.id);
      clock = Date.now();
      const record = await writeReferenceRequestRecord({
        pendingDir: paths.referencePendingDir,
        projectId: project.id,
        sceneId: 'scene_1',
        requestId: 'request_abandoned',
      });
      clock += 8 * 24 * 60 * 60 * 1_000;

      await store.reapAbandonedProposals();

      await expect(store.listPendingReferenceRequests(project.id)).resolves.toEqual([]);
      expect(existsSync(path.join(paths.referencePendingDir, `${record.id}.json`))).toBe(false);
      expect(readdirSync(path.join(rootDir, project.id, 'reference-requests', 'slots'))).toEqual([]);
    });

    describe('subprocess proposal conformance', () => {
      const prepareProposalDirectories = async (projectId: string): Promise<string> => {
        await store.listProposals(projectId);
        const proposalsDir = path.join(rootDir, projectId, 'proposals');
        const pendingDir = path.join(proposalsDir, 'pending');
        await mkdir(pendingDir, { recursive: true });
        await mkdir(path.join(proposalsDir, 'decisions'), { recursive: true });
        await mkdir(path.join(proposalsDir, 'slots'), { recursive: true });
        return pendingDir;
      };

      it('lists and watches a record written by the subprocess writer', async () => {
        const project = await store.createProject(makeInput());
        const pendingDir = await prepareProposalDirectories(project.id);
        const record = await writeProposalRecord({
          pendingDir,
          projectId: project.id,
          baseRevision: project.revision,
          payload: subprocessProposalPayload,
        });

        expect((await store.listProposals(project.id)).map((proposal) => proposal.id)).toContain(record.id);

        const listener = vi.fn();
        let notifyFileChange: ((relativeFile: string) => void) | undefined;
        const watchingStore = createCreativeStudioStore({
          rootDir,
          now: () => new Date((clock += 1_000)).toISOString(),
          watchProposalTree: ({ onChange }) => {
            notifyFileChange = onChange;
            return { close: vi.fn() };
          },
        });
        const stopWatching = await watchingStore.watchProposals(listener);
        try {
          const secondRecord = await writeProposalRecord({
            pendingDir,
            projectId: project.id,
            baseRevision: project.revision,
            payload: subprocessProposalPayload,
          });
          notifyFileChange?.(`${project.id}/proposals/pending/${secondRecord.id}.json`);
          await vi.waitFor(() => expect(listener).toHaveBeenCalledWith(project.id, secondRecord.id));
        } finally {
          await stopWatching();
        }
      });

      it('accepts a subprocess-written record under CAS and rejects a stale one', async () => {
        const project = await store.createProject(makeInput());
        const pendingDir = await prepareProposalDirectories(project.id);
        const record = await writeProposalRecord({
          pendingDir,
          projectId: project.id,
          baseRevision: project.revision,
          payload: subprocessProposalPayload,
        });

        const accepted = await store.acceptProposal(project.id, record.id, (current, payload) => ({
          ...current,
          brief: payload.scenes.scene_1.narration,
        }));
        expect(accepted.applied).toBe(true);

        const bumped = await store.updateProject(project.id, (current) => ({ ...current, name: 'Changed elsewhere' }));
        const staleRecord = await writeProposalRecord({
          pendingDir,
          projectId: project.id,
          baseRevision: bumped.revision - 1,
          payload: subprocessProposalPayload,
        });

        await expect(store.acceptProposal(project.id, staleRecord.id, (current) => current)).rejects.toMatchObject({
          code: 'stale_project',
        });
      });

      it('ignores a malformed record without failing the listing', async () => {
        const project = await store.createProject(makeInput());
        const pendingDir = await prepareProposalDirectories(project.id);
        const record = await writeProposalRecord({
          pendingDir,
          projectId: project.id,
          baseRevision: project.revision,
          payload: subprocessProposalPayload,
        });
        await writeFile(path.join(pendingDir, 'zzz.json'), '{not-json');

        await expect(store.listProposals(project.id)).resolves.toMatchObject([{ id: record.id }]);
      });
    });

    it('lists and watches validated reference requests from the sibling queue', async () => {
      const project = await store.createProject(makeInput());
      await store.updateProject(project.id, (current) => addScene(current, 'scene_1'));
      const paths = await store.resolveProposalPaths(project.id);
      const record = await writeReferenceRequestRecord({
        pendingDir: paths.referencePendingDir,
        projectId: project.id,
        sceneId: 'scene_1',
      });
      await writeFile(
        path.join(paths.referencePendingDir, 'request_unknown_scene.json'),
        JSON.stringify({ ...record, id: 'request_unknown_scene', sceneId: 'scene_missing' })
      );

      await expect(store.listPendingReferenceRequests(project.id)).resolves.toMatchObject([
        { id: record.id, projectId: project.id, sceneId: 'scene_1', status: 'pending' },
      ]);

      const listener = vi.fn();
      let notifyFileChange: ((relativeFile: string) => void) | undefined;
      const watchingStore = createCreativeStudioStore({
        rootDir,
        watchProposalTree: ({ onChange }) => {
          notifyFileChange = onChange;
          return { close: vi.fn() };
        },
      });
      const stopWatching = await watchingStore.watchProposals(listener);
      try {
        notifyFileChange?.(`${project.id}/reference-requests/pending/${record.id}.json`);
        await vi.waitFor(() => expect(listener).toHaveBeenCalledWith(project.id, record.id));
      } finally {
        await stopWatching();
      }
    });

    it('dismisses only the reviewed reference requests and releases their queue slots', async () => {
      const project = await store.createProject(makeInput());
      await store.updateProject(project.id, (current) => addScene(addScene(current, 'scene_1'), 'scene_2'));
      const paths = await store.resolveProposalPaths(project.id);
      const dismissed = await writeReferenceRequestRecord({
        pendingDir: paths.referencePendingDir,
        projectId: project.id,
        sceneId: 'scene_1',
        requestId: 'request_dismissed',
      });
      const retained = await writeReferenceRequestRecord({
        pendingDir: paths.referencePendingDir,
        projectId: project.id,
        sceneId: 'scene_2',
        requestId: 'request_retained',
      });

      await store.dismissReferenceRequests(project.id, [dismissed.id]);

      await expect(store.listPendingReferenceRequests(project.id)).resolves.toMatchObject([{ id: retained.id }]);
      expect(existsSync(path.join(paths.referencePendingDir, `${dismissed.id}.json`))).toBe(false);
      expect(readdirSync(path.join(rootDir, project.id, 'reference-requests', 'slots'))).toHaveLength(1);
    });

    it('atomically dismisses only exact reviewed request identities at the expected project revision', async () => {
      const created = await store.createProject(makeInput());
      const project = await store.updateProject(created.id, (current) =>
        addScene(addScene(current, 'scene_1'), 'scene_2')
      );
      const paths = await store.resolveProposalPaths(project.id);
      const dismissed = await writeReferenceRequestRecord({
        pendingDir: paths.referencePendingDir,
        projectId: project.id,
        sceneId: 'scene_1',
        requestId: 'request_exact',
      });
      const retained = await writeReferenceRequestRecord({
        pendingDir: paths.referencePendingDir,
        projectId: project.id,
        sceneId: 'scene_2',
        requestId: 'request_unrelated',
      });

      await store.dismissReferenceRequests(project.id, [dismissed.id], {
        expectedRevision: project.revision,
        expectedRequests: [{ id: dismissed.id, sceneId: dismissed.sceneId }],
      });

      await expect(store.listPendingReferenceRequests(project.id)).resolves.toMatchObject([{ id: retained.id }]);
      expect(existsSync(path.join(paths.referencePendingDir, `${dismissed.id}.json`))).toBe(false);
      expect(existsSync(path.join(paths.referencePendingDir, `${retained.id}.json`))).toBe(true);
    });

    it.each([
      {
        condition: 'the request id was remapped',
        authority: (projectRevision: number) => ({
          expectedRevision: projectRevision,
          expectedRequests: [{ id: 'request_checked', sceneId: 'scene_2' }],
        }),
        code: 'invalid_payload',
      },
      {
        condition: 'the project revision changed',
        authority: (projectRevision: number) => ({
          expectedRevision: projectRevision - 1,
          expectedRequests: [{ id: 'request_checked', sceneId: 'scene_1' }],
        }),
        code: 'stale_project',
      },
    ])('deletes nothing when $condition before checked consumption', async ({ authority, code }) => {
      const created = await store.createProject(makeInput());
      const project = await store.updateProject(created.id, (current) =>
        addScene(addScene(current, 'scene_1'), 'scene_2')
      );
      const paths = await store.resolveProposalPaths(project.id);
      const checked = await writeReferenceRequestRecord({
        pendingDir: paths.referencePendingDir,
        projectId: project.id,
        sceneId: 'scene_1',
        requestId: 'request_checked',
      });
      const unrelated = await writeReferenceRequestRecord({
        pendingDir: paths.referencePendingDir,
        projectId: project.id,
        sceneId: 'scene_2',
        requestId: 'request_unrelated',
      });

      await expect(
        store.dismissReferenceRequests(project.id, [checked.id], authority(project.revision))
      ).rejects.toMatchObject({ code });

      await expect(store.listPendingReferenceRequests(project.id)).resolves.toHaveLength(2);
      expect(existsSync(path.join(paths.referencePendingDir, `${checked.id}.json`))).toBe(true);
      expect(existsSync(path.join(paths.referencePendingDir, `${unrelated.id}.json`))).toBe(true);
      expect(readdirSync(path.join(rootDir, project.id, 'reference-requests', 'slots'))).toHaveLength(2);
    });

    it('keeps proposal and reference-request inboxes independent', async () => {
      expect(STUDIO_PROPOSAL_MAX_PENDING_PER_PROJECT).toBe(50);
      const project = await store.createProject(makeInput());
      const updated = await store.updateProject(project.id, (current) => addScene(current, 'scene_1'));
      const paths = await store.resolveProposalPaths(project.id);
      await writeReferenceRequestRecord({
        pendingDir: paths.referencePendingDir,
        projectId: project.id,
        sceneId: 'scene_1',
      });

      await expect(store.listProposals(project.id)).resolves.toEqual([]);

      await store.recordProposal({
        projectId: project.id,
        proposalId: 'proposal_1',
        baseRevision: updated.revision,
        payload: subprocessProposalPayload,
      });
      await rm(path.join(paths.referencePendingDir, (await readdir(paths.referencePendingDir))[0]));

      await expect(store.listPendingReferenceRequests(project.id)).resolves.toEqual([]);
    });
  });

  it('creates three empty project model selections', async () => {
    const project = await store.createProject(makeInput());

    expect(project.routing).toEqual({ storyboard: null, image: null, video: null });
  });

  it('persists and reloads a scene with an empty display title', async () => {
    const project = await store.createProject(makeInput());
    const edited = await store.updateProject(project.id, (current) => {
      const next = addScene(current, 'scene_1');
      next.scenes.scene_1.title = '';
      return next;
    });
    const reloadedStore = createCreativeStudioStore({ rootDir });

    await expect(reloadedStore.getProject(project.id)).resolves.toEqual(edited);
  });

  it('loads a project that retains a scene-owned imported reference as its legacy selection', async () => {
    const project = await store.createProject(makeInput());
    const persisted = await store.updateProject(project.id, (current) => {
      const next = addScene(current, 'scene_1');
      next.assets.reference_1 = {
        id: 'reference_1',
        projectId: next.id,
        sceneId: 'scene_1',
        mediaKind: 'image',
        mimeType: 'image/png',
        managedAsset: { collection: 'imports', fileName: 'reference_1.png' },
        byteSize: 1,
        sha256: '1'.repeat(64),
        createdAt: next.createdAt,
      };
      next.scenes.scene_1.assetIds = ['reference_1'];
      next.scenes.scene_1.selectedAssetId = 'reference_1';
      return next;
    });
    const reloadedStore = createCreativeStudioStore({ rootDir });

    await expect(reloadedStore.getProject(project.id)).resolves.toEqual(persisted);
  });

  it('persists a valid cut with fractional trim and the closed filter union', async () => {
    const project = await store.createProject(makeInput());

    const persisted = await store.updateProject(project.id, addCut, project.revision);

    expect(await store.getProject(project.id)).toEqual(persisted);
    expect(persisted.cuts?.cut_1.clips.clip_1).toMatchObject({
      sourceInSeconds: 0.25,
      sourceOutSeconds: 4.5,
      filters: [{ id: 'temperature', amount: 0.25 }],
    });
  });

  it('accepts trim bounds when provider metadata omits asset duration', async () => {
    const project = await store.createProject(makeInput());

    const persisted = await store.updateProject(
      project.id,
      (current) => {
        const next = addCut(current, null);
        next.cuts!.cut_1.clips.clip_1.sourceOutSeconds = 9_999.25;
        return next;
      },
      project.revision
    );

    expect(persisted.cuts?.cut_1.clips.clip_1.sourceOutSeconds).toBe(9_999.25);
  });

  it.each([
    [
      'cuts without activeCutId',
      (project: StudioProject) => {
        delete project.activeCutId;
      },
    ],
    [
      'activeCutId without cuts',
      (project: StudioProject) => {
        delete project.cuts;
      },
    ],
    [
      'an active id absent from cuts',
      (project: StudioProject) => {
        project.activeCutId = 'cut_missing';
      },
    ],
    [
      'a malformed cuts collection',
      (project: StudioProject) => {
        project.cuts = [] as never;
      },
    ],
    [
      'a cut id that differs from its map key',
      (project: StudioProject) => {
        project.cuts!.cut_1.id = 'cut_2';
      },
    ],
    [
      'a clip id that differs from its map key',
      (project: StudioProject) => {
        project.cuts!.cut_1.clips.clip_1.id = 'clip_2';
      },
    ],
    [
      'an unknown order mode',
      (project: StudioProject) => {
        project.cuts!.cut_1.orderMode = 'automatic' as never;
      },
    ],
    [
      'an extra cut field',
      (project: StudioProject) => {
        Object.assign(project.cuts!.cut_1, { outputHash: 'renderer-owned' });
      },
    ],
    [
      'an extra clip field',
      (project: StudioProject) => {
        Object.assign(project.cuts!.cut_1.clips.clip_1, { resolvedDurationSeconds: 4.25 });
      },
    ],
    [
      'an extra crop field',
      (project: StudioProject) => {
        Object.assign(project.cuts!.cut_1.clips.clip_1.crop!, { unit: 'pixels' });
      },
    ],
    [
      'an extra filter field',
      (project: StudioProject) => {
        Object.assign(project.cuts!.cut_1.clips.clip_1.filters[0]!, { expression: 'eq=contrast=1.5' });
      },
    ],
    [
      'duplicate clip ids in clipOrder',
      (project: StudioProject) => {
        project.cuts!.cut_1.clipOrder = ['clip_1', 'clip_1'];
      },
    ],
    [
      'a dangling clip id in clipOrder',
      (project: StudioProject) => {
        project.cuts!.cut_1.clipOrder = ['clip_missing'];
      },
    ],
    [
      'a clip omitted from clipOrder',
      (project: StudioProject) => {
        project.cuts!.cut_1.clipOrder = [];
      },
    ],
    [
      'a missing clip scene',
      (project: StudioProject) => {
        project.cuts!.cut_1.clips.clip_1.sceneId = 'scene_missing';
      },
    ],
    [
      'a non-canonical imported clip asset',
      (project: StudioProject) => {
        project.assets.asset_1.managedAsset.collection = 'imports';
      },
    ],
    [
      'a crop extending beyond the source frame',
      (project: StudioProject) => {
        project.cuts!.cut_1.clips.clip_1.crop = { x: 0.4, y: 0.1, width: 0.7, height: 0.8 };
      },
    ],
    [
      'a zero-width crop',
      (project: StudioProject) => {
        project.cuts!.cut_1.clips.clip_1.crop = { x: 0, y: 0, width: 0, height: 1 };
      },
    ],
    [
      'a non-finite crop coordinate',
      (project: StudioProject) => {
        project.cuts!.cut_1.clips.clip_1.crop = { x: Number.NaN, y: 0, width: 1, height: 1 };
      },
    ],
    [
      'an unknown filter id',
      (project: StudioProject) => {
        project.cuts!.cut_1.clips.clip_1.filters = [{ id: 'blur', amount: 0.25 } as never];
      },
    ],
    [
      'a duplicate filter id',
      (project: StudioProject) => {
        project.cuts!.cut_1.clips.clip_1.filters = [
          { id: 'contrast', amount: 0.1 },
          { id: 'contrast', amount: 0.2 },
        ];
      },
    ],
    [
      'an out-of-range filter amount',
      (project: StudioProject) => {
        project.cuts!.cut_1.clips.clip_1.filters = [{ id: 'exposure', amount: 1.01 }];
      },
    ],
    [
      'a non-finite filter amount',
      (project: StudioProject) => {
        project.cuts!.cut_1.clips.clip_1.filters = [{ id: 'exposure', amount: Number.NaN }];
      },
    ],
    [
      'a backend filter expression',
      (project: StudioProject) => {
        project.cuts!.cut_1.clips.clip_1.filters = ['eq=brightness=0.06:saturation=1.2' as never];
      },
    ],
    [
      'a negative source in',
      (project: StudioProject) => {
        project.cuts!.cut_1.clips.clip_1.sourceInSeconds = -0.01;
      },
    ],
    [
      'a non-finite source out',
      (project: StudioProject) => {
        project.cuts!.cut_1.clips.clip_1.sourceOutSeconds = Number.POSITIVE_INFINITY;
      },
    ],
    [
      'non-increasing trim bounds',
      (project: StudioProject) => {
        project.cuts!.cut_1.clips.clip_1.sourceInSeconds = 4.5;
        project.cuts!.cut_1.clips.clip_1.sourceOutSeconds = 4.5;
      },
    ],
    [
      'trim beyond a known asset duration',
      (project: StudioProject) => {
        project.cuts!.cut_1.clips.clip_1.sourceOutSeconds = 5.086;
      },
    ],
    [
      'source in beyond a known asset duration',
      (project: StudioProject) => {
        project.cuts!.cut_1.clips.clip_1.sourceInSeconds = 5.086;
        project.cuts!.cut_1.clips.clip_1.sourceOutSeconds = null;
      },
    ],
    [
      'a 241-character brief rule',
      (project: StudioProject) => {
        project.rules = [
          {
            id: 'rule_1',
            scope: 'project',
            text: 'x'.repeat(241),
            predicate: null,
            createdAt: '2026-08-13T00:00:00.000Z',
          },
        ];
      },
    ],
    [
      'a ninth brief rule term',
      (project: StudioProject) => {
        project.rules = [
          {
            id: 'rule_1',
            scope: 'project',
            text: 'Avoid these terms',
            predicate: { kind: 'forbidden_terms', terms: Array.from({ length: 9 }, (_, index) => `term_${index}`) },
            createdAt: '2026-08-13T00:00:00.000Z',
          },
        ];
      },
    ],
    [
      'a 65-character brief rule term',
      (project: StudioProject) => {
        project.rules = [
          {
            id: 'rule_1',
            scope: 'project',
            text: 'Avoid this term',
            predicate: { kind: 'forbidden_terms', terms: ['x'.repeat(65)] },
            createdAt: '2026-08-13T00:00:00.000Z',
          },
        ];
      },
    ],
    [
      'a 25th brief rule',
      (project: StudioProject) => {
        project.rules = Array.from({ length: 25 }, (_, index) => ({
          id: `rule_${index}`,
          scope: 'project',
          text: `Rule ${index}`,
          predicate: null,
          createdAt: '2026-08-13T00:00:00.000Z',
        }));
      },
    ],
    [
      'duplicate brief rule ids',
      (project: StudioProject) => {
        project.rules = [
          {
            id: 'rule_1',
            scope: 'project',
            text: 'First rule',
            predicate: null,
            createdAt: '2026-08-13T00:00:00.000Z',
          },
          {
            id: 'rule_1',
            scope: 'project',
            text: 'Second rule',
            predicate: null,
            createdAt: '2026-08-13T00:00:00.000Z',
          },
        ];
      },
    ],
    [
      'duplicate terms in a brief rule',
      (project: StudioProject) => {
        project.rules = [
          {
            id: 'rule_1',
            scope: 'project',
            text: 'Avoid this term',
            predicate: { kind: 'forbidden_terms', terms: ['nike', 'nike'] },
            createdAt: '2026-08-13T00:00:00.000Z',
          },
        ];
      },
    ],
    [
      'an extra brief rule predicate field',
      (project: StudioProject) => {
        project.rules = [
          {
            id: 'rule_1',
            scope: 'project',
            text: 'Avoid this term',
            predicate: { kind: 'forbidden_terms', terms: ['nike'] },
            createdAt: '2026-08-13T00:00:00.000Z',
          },
        ];
        Object.assign(project.rules[0].predicate!, { caseSensitive: true });
      },
    ],
    [
      'an empty brief rule term list',
      (project: StudioProject) => {
        project.rules = [
          {
            id: 'rule_1',
            scope: 'project',
            text: 'Avoid these terms',
            predicate: { kind: 'forbidden_terms', terms: [] },
            createdAt: '2026-08-13T00:00:00.000Z',
          },
        ];
      },
    ],
    [
      'an extra brief rule field',
      (project: StudioProject) => {
        project.rules = [
          {
            id: 'rule_1',
            scope: 'project',
            text: 'Avoid this term',
            predicate: null,
            createdAt: '2026-08-13T00:00:00.000Z',
          },
        ];
        Object.assign(project.rules[0], { priority: 'high' });
      },
    ],
    [
      'a non-canonical brief rule timestamp',
      (project: StudioProject) => {
        project.rules = [
          {
            id: 'rule_1',
            scope: 'project',
            text: 'Avoid this term',
            predicate: null,
            createdAt: '2026-08-13T00:00:00Z',
          },
        ];
      },
    ],
  ] as const)('rejects %s without changing durable state', async (_case, mutate) => {
    const project = await store.createProject(makeInput());

    await expect(
      store.updateProject(
        project.id,
        (current) => {
          const next = addCut(current);
          mutate(next);
          return next;
        },
        project.revision
      )
    ).rejects.toMatchObject({ code: 'invalid_payload' });
    expect(await store.getProject(project.id)).toEqual(project);
  });

  it('loads a current schema-v1 manifest without a storyboard selection', async () => {
    const project = await store.createProject(makeInput());
    const file = path.join(rootDir, project.id, 'project.json');
    const raw = JSON.parse(readFileSync(file, 'utf8')) as StudioProject;
    writeFileSync(file, JSON.stringify({ ...raw, routing: { image: raw.routing.image, video: raw.routing.video } }));

    expect((await store.getProject(project.id))?.routing).toEqual({
      storyboard: null,
      image: null,
      video: null,
    });

    await store.updateProject(project.id, (current) => ({ ...current, name: 'Migrated project' }));
    expect((JSON.parse(readFileSync(file, 'utf8')) as StudioProject).routing).toEqual({
      storyboard: null,
      image: null,
      video: null,
    });
  });

  it.each([
    { storyboard: null, image: null, video: null, extra: true },
    { storyboard: { providerId: '../provider', model: 'gpt-4o' }, image: null, video: null },
    { storyboard: { providerId: 'provider_1', model: 'gpt-4o\u0000secret' }, image: null, video: null },
  ])('rejects malformed project model selections: %o', async (routing) => {
    const project = await store.createProject(makeInput());
    const file = path.join(rootDir, project.id, 'project.json');
    writeFileSync(file, JSON.stringify({ ...project, routing }));

    await expect(store.getProject(project.id)).rejects.toMatchObject({ code: 'storage_error' });
  });

  it('increments revision for each successful mutation instead of silently replacing a project', async () => {
    const project = await store.createProject(makeInput());
    const renamed = await store.updateProject(project.id, (current) => ({ ...current, name: 'Revised launch film' }));
    const revisedAgain = await store.updateProject(renamed.id, (current) => ({ ...current, brief: 'A revised story' }));

    expect(renamed.revision).toBe(2);
    expect(revisedAgain.revision).toBe(3);
  });

  it('rejects a late compare-and-set update instead of overwriting a newer edit', async () => {
    const project = await store.createProject(makeInput());
    await store.updateProject(project.id, (current) => ({ ...current, name: 'Newer edit' }), project.revision);

    await expect(
      store.updateProject(project.id, (current) => ({ ...current, name: 'Stale edit' }), project.revision)
    ).rejects.toMatchObject({ code: 'stale_project' });
  });

  describe('project timing validation', () => {
    it.each([4, 61, 12.5])(
      'rejects target duration %s instead of persisting an out-of-range project target',
      async (target) => {
        await expect(store.createProject(makeInput({ targetDurationSeconds: target }))).rejects.toMatchObject({
          code: 'invalid_payload',
        });
      }
    );

    it.each([0, 61, 1.5])(
      'rejects scene duration %s instead of treating scene timing as project timing',
      async (duration) => {
        const project = await store.createProject(makeInput());

        await expect(
          store.updateProject(project.id, (current) => addScene(current, 'scene_1', duration))
        ).rejects.toMatchObject({
          code: 'invalid_payload',
        });
      }
    );

    it('allows a temporary scene-total mismatch because only the later review gate owns exact-total validation', async () => {
      const project = await store.createProject(makeInput({ targetDurationSeconds: 12 }));
      const edited = await store.updateProject(project.id, (current) => addScene(current, 'scene_1', 3));

      expect(edited.scenes.scene_1.durationSeconds).toBe(3);
    });
  });

  describe('project graph validation', () => {
    it('persists a finite fractional actual asset duration', async () => {
      const project = await store.createProject(makeInput());

      await store.updateProject(project.id, (current) => addVideoAsset(current, 5.085));

      await expect(store.getProject(project.id)).resolves.toMatchObject({
        assets: { asset_1: { durationSeconds: 5.085 } },
      });
    });

    it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
      'rejects invalid actual asset duration %s',
      async (durationSeconds) => {
        const project = await store.createProject(makeInput());

        await expect(
          store.updateProject(project.id, (current) => addVideoAsset(current, durationSeconds))
        ).rejects.toMatchObject({ code: 'invalid_payload' });
      }
    );

    it('keeps requested scene durations integral when actual asset durations are fractional', async () => {
      const project = await store.createProject(makeInput());

      await expect(
        store.updateProject(project.id, (current) => addScene(current, 'scene_1', 5.5))
      ).rejects.toMatchObject({ code: 'invalid_payload' });
    });

    it('rejects duplicate scene-order IDs instead of allowing a scene to render twice', async () => {
      const project = await store.createProject(makeInput());

      await expect(
        store.updateProject(project.id, (current) => {
          const next = addScene(current, 'scene_1');
          next.sceneOrder.push('scene_1');
          return next;
        })
      ).rejects.toMatchObject({ code: 'invalid_payload' });
    });

    it('rejects a missing scene-order ID instead of silently dropping a stored scene', async () => {
      const project = await store.createProject(makeInput());

      await expect(
        store.updateProject(project.id, (current) => {
          const next = addScene(current, 'scene_1');
          next.sceneOrder = [];
          return next;
        })
      ).rejects.toMatchObject({ code: 'invalid_payload' });
    });

    it('rejects scene-owned assets and jobs that are absent from the owning scene indexes', async () => {
      const project = await store.createProject(makeInput());

      await expect(
        store.updateProject(project.id, (current) => {
          const next = addScene(current, 'scene_1');
          next.assets.asset_orphan = {
            id: 'asset_orphan',
            projectId: next.id,
            sceneId: 'scene_1',
            mediaKind: 'image',
            mimeType: 'image/png',
            managedAsset: { collection: 'assets', fileName: 'asset_orphan.png' },
            byteSize: 1,
            sha256: 'a'.repeat(64),
            createdAt: next.createdAt,
          };
          return next;
        })
      ).rejects.toMatchObject({ code: 'invalid_payload' });

      await expect(
        store.updateProject(project.id, (current) => {
          const next = addScene(current, 'scene_1');
          next.jobs.job_orphan = makeJob(next, 'job_orphan', 'scene_1');
          return next;
        })
      ).rejects.toMatchObject({ code: 'invalid_payload' });
    });

    it('rejects unknown durable job fields instead of retaining provider response data', async () => {
      const project = await store.createProject(makeInput());

      await expect(
        store.updateProject(project.id, (current) => {
          const next = addScene(current, 'scene_1');
          const job = makeJob(next, 'job_1', 'scene_1') as StudioJob & {
            providerPayload?: { requestId: string };
          };
          job.providerPayload = { requestId: 'provider-secret' };
          next.jobs.job_1 = job;
          next.scenes.scene_1.jobIds = ['job_1'];
          return next;
        })
      ).rejects.toMatchObject({ code: 'invalid_payload' });
    });

    it('rejects unknown durable scene and asset fields instead of retaining provider metadata', async () => {
      const project = await store.createProject(makeInput());

      await expect(
        store.updateProject(project.id, (current) => {
          const next = addScene(current, 'scene_1');
          const scene = next.scenes.scene_1 as (typeof next.scenes)['scene_1'] & {
            providerJobId?: string;
          };
          scene.providerJobId = 'remote-secret';
          return next;
        })
      ).rejects.toMatchObject({ code: 'invalid_payload' });

      await expect(
        store.updateProject(project.id, (current) => {
          const next = addScene(current, 'scene_1');
          const asset: StudioAsset & { idempotencyKey?: string } = {
            id: 'asset_1',
            projectId: next.id,
            sceneId: 'scene_1',
            mediaKind: 'image',
            mimeType: 'image/png',
            managedAsset: { collection: 'assets', fileName: 'asset_1.png' },
            byteSize: 1,
            sha256: 'a'.repeat(64),
            createdAt: next.createdAt,
            idempotencyKey: 'provider-secret',
          };
          next.assets.asset_1 = asset;
          next.scenes.scene_1.assetIds = ['asset_1'];
          return next;
        })
      ).rejects.toMatchObject({ code: 'invalid_payload' });
    });

    it('rejects URL-shaped remote job identities instead of persisting token-bearing routes', async () => {
      const project = await store.createProject(makeInput());

      await expect(
        store.updateProject(project.id, (current) => {
          const next = addScene(current, 'scene_1');
          next.jobs.job_1 = makeJob(next, 'job_1', 'scene_1', {
            providerJobId: 'https://provider.example/jobs/1?token=secret',
          });
          next.scenes.scene_1.jobIds = ['job_1'];
          return next;
        })
      ).rejects.toMatchObject({ code: 'invalid_payload' });
    });

    it('rejects traversal IDs instead of creating project-controlled paths outside the store root', async () => {
      await expect(store.createProject({ ...makeInput(), id: '../outside' })).rejects.toMatchObject({
        code: 'invalid_payload',
      });
    });

    it('validates an asset in the references collection with no scene attachment', async () => {
      const project = await store.createProject(makeInput());

      const persisted = await store.updateProject(project.id, (current) => {
        const next = addScene(current, 'scene_1');
        next.assets.reference_1 = {
          id: 'reference_1',
          projectId: next.id,
          sceneId: null,
          mediaKind: 'image',
          mimeType: 'image/png',
          managedAsset: { collection: 'references', fileName: 'reference_1.png' },
          byteSize: 1,
          sha256: '2'.repeat(64),
          createdAt: next.createdAt,
        };
        return next;
      });

      expect(await store.getProject(project.id)).toEqual(persisted);
    });

    it('persists paired Brief metadata and complete generated-plate provenance', async () => {
      const project = await store.createProject(makeInput());

      const persisted = await store.updateProject(project.id, (current) => {
        const next = addScene(current, 'scene_1');
        next.assets.cast_1 = makeProjectImport(next, 'cast_1', {
          briefReferenceRole: 'cast',
          briefReferenceLabel: 'Lead Hero',
        });
        next.assets.look_1 = makeProjectImport(next, 'look_1', {
          briefReferenceRole: 'look',
          briefReferenceLabel: 'Stadium Light',
        });
        next.assets.plate_1 = {
          ...makeProjectImport(next, 'plate_1'),
          sceneId: 'scene_1',
          managedAsset: { collection: 'references', fileName: 'plate_1.png' },
          sourceVisualPrompt: 'Hero enters the arena',
          sourceReferenceAssetIds: ['cast_1', 'look_1'],
          sourceAspectRatio: '16:9',
          sourceResolution: '1080p',
        };
        next.scenes.scene_1.assetIds = ['plate_1'];
        return next;
      });

      expect(persisted.assets.cast_1).toMatchObject({
        briefReferenceRole: 'cast',
        briefReferenceLabel: 'Lead Hero',
      });
      expect(persisted.assets.plate_1).toMatchObject({
        sourceVisualPrompt: 'Hero enters the arena',
        sourceReferenceAssetIds: ['cast_1', 'look_1'],
        sourceAspectRatio: '16:9',
        sourceResolution: '1080p',
      });
      await expect(store.getProject(project.id)).resolves.toEqual(persisted);
    });

    it.each([
      {
        label: 'role without label',
        mutate: (asset: StudioAsset) => {
          asset.briefReferenceRole = 'cast';
        },
      },
      {
        label: 'label without role',
        mutate: (asset: StudioAsset) => {
          asset.briefReferenceLabel = 'Hero';
        },
      },
      {
        label: 'label with a control character',
        mutate: (asset: StudioAsset) => {
          asset.briefReferenceRole = 'cast';
          asset.briefReferenceLabel = 'Hero\u0000Portrait';
        },
      },
      {
        label: 'untrimmed label',
        mutate: (asset: StudioAsset) => {
          asset.briefReferenceRole = 'cast';
          asset.briefReferenceLabel = ' Hero ';
        },
      },
      {
        label: 'overlong label',
        mutate: (asset: StudioAsset) => {
          asset.briefReferenceRole = 'cast';
          asset.briefReferenceLabel = 'x'.repeat(STUDIO_BRIEF_REFERENCE_LABEL_MAX_LENGTH + 1);
        },
      },
      {
        label: 'classification on a scene-owned import',
        mutate: (asset: StudioAsset) => {
          asset.sceneId = 'scene_1';
          asset.briefReferenceRole = 'cast';
          asset.briefReferenceLabel = 'Hero';
        },
      },
      {
        label: 'classification on a non-image import',
        mutate: (asset: StudioAsset) => {
          asset.mediaKind = 'video';
          asset.mimeType = 'video/mp4';
          asset.briefReferenceRole = 'cast';
          asset.briefReferenceLabel = 'Hero';
        },
      },
      {
        label: 'classification on image metadata with a video MIME',
        mutate: (asset: StudioAsset) => {
          asset.mimeType = 'video/mp4';
          asset.briefReferenceRole = 'cast';
          asset.briefReferenceLabel = 'Hero';
        },
      },
      {
        label: 'classification outside imports',
        mutate: (asset: StudioAsset) => {
          asset.managedAsset = { collection: 'assets', fileName: 'cast_1.png' };
          asset.briefReferenceRole = 'cast';
          asset.briefReferenceLabel = 'Hero';
        },
      },
    ])('rejects invalid Brief reference metadata: $label', async ({ mutate }) => {
      const project = await store.createProject(makeInput());

      await expect(
        store.updateProject(project.id, (current) => {
          const next = addScene(current, 'scene_1');
          const asset = makeProjectImport(next, 'cast_1');
          mutate(asset);
          next.assets.cast_1 = asset;
          if (asset.sceneId === 'scene_1') next.scenes.scene_1.assetIds = ['cast_1'];
          return next;
        })
      ).rejects.toMatchObject({ code: 'invalid_payload' });
    });

    it('rejects more than six active Brief references', async () => {
      const project = await store.createProject(makeInput());

      await expect(
        store.updateProject(project.id, (current) => {
          const next = cloneProject(current);
          Array.from({ length: 7 }, (_, index) => `reference_${index + 1}`).forEach((id, index) => {
            next.assets[id] = makeProjectImport(next, id, {
              briefReferenceRole: index < 3 ? 'cast' : 'look',
              briefReferenceLabel: `Reference ${index + 1}`,
            });
          });
          return next;
        })
      ).rejects.toMatchObject({ code: 'invalid_payload' });
    });

    it.each([
      {
        label: 'duplicate source IDs',
        sourceReferenceAssetIds: ['cast_1', 'cast_1'],
      },
      {
        label: 'missing source ID',
        sourceReferenceAssetIds: ['missing_reference'],
      },
      {
        label: 'foreign source ID',
        sourceReferenceAssetIds: ['foreign_reference'],
      },
    ])('rejects generated-plate provenance with $label', async ({ sourceReferenceAssetIds }) => {
      const project = await store.createProject(makeInput());
      const foreign = await store.createProject(makeInput({ name: 'Foreign' }));
      await store.updateProject(foreign.id, (current) => ({
        ...current,
        assets: { foreign_reference: makeProjectImport(current, 'foreign_reference') },
      }));

      await expect(
        store.updateProject(project.id, (current) => {
          const next = addScene(current, 'scene_1');
          next.assets.cast_1 = makeProjectImport(next, 'cast_1');
          next.assets.plate_1 = {
            ...makeProjectImport(next, 'plate_1'),
            sceneId: 'scene_1',
            managedAsset: { collection: 'references', fileName: 'plate_1.png' },
            sourceVisualPrompt: 'Hero enters the arena',
            sourceReferenceAssetIds,
            sourceAspectRatio: '16:9',
            sourceResolution: '1080p',
          };
          next.scenes.scene_1.assetIds = ['plate_1'];
          return next;
        })
      ).rejects.toMatchObject({ code: 'invalid_payload' });
    });

    it('accepts complete provenance pointing to a retained import that is no longer classified in Brief', async () => {
      const project = await store.createProject(makeInput());

      const persisted = await store.updateProject(project.id, (current) => {
        const next = addScene(current, 'scene_1');
        next.assets.retained_1 = makeProjectImport(next, 'retained_1');
        next.assets.plate_1 = {
          ...makeProjectImport(next, 'plate_1'),
          sceneId: 'scene_1',
          managedAsset: { collection: 'references', fileName: 'plate_1.png' },
          sourceVisualPrompt: 'Hero enters the arena',
          sourceReferenceAssetIds: ['retained_1'],
          sourceAspectRatio: '16:9',
          sourceResolution: '1080p',
        };
        next.scenes.scene_1.assetIds = ['plate_1'];
        return next;
      });

      expect(persisted.assets.retained_1).not.toHaveProperty('briefReferenceRole');
      expect(persisted.assets.plate_1.sourceReferenceAssetIds).toEqual(['retained_1']);
    });

    it('rejects complete provenance pointing to image metadata with a video MIME', async () => {
      const project = await store.createProject(makeInput());

      await expect(
        store.updateProject(project.id, (current) => {
          const next = addScene(current, 'scene_1');
          next.assets.source_1 = makeProjectImport(next, 'source_1', { mimeType: 'video/mp4' });
          next.assets.plate_1 = {
            ...makeProjectImport(next, 'plate_1'),
            sceneId: 'scene_1',
            managedAsset: { collection: 'references', fileName: 'plate_1.png' },
            sourceVisualPrompt: 'Hero enters the arena',
            sourceReferenceAssetIds: ['source_1'],
            sourceAspectRatio: '16:9',
            sourceResolution: '1080p',
          };
          next.scenes.scene_1.assetIds = ['plate_1'];
          return next;
        })
      ).rejects.toMatchObject({ code: 'invalid_payload' });
    });

    it.each([
      {
        sourceReferenceAssetIds: ['cast_1'],
      },
      {
        sourceAspectRatio: '16:9' as const,
      },
      {
        sourceResolution: '1080p' as const,
      },
      {
        sourceReferenceAssetIds: ['cast_1'],
        sourceAspectRatio: '16:9' as const,
      },
    ])('rejects partial generated-plate provenance: %o', async (provenance) => {
      const project = await store.createProject(makeInput());

      await expect(
        store.updateProject(project.id, (current) => {
          const next = addScene(current, 'scene_1');
          next.assets.cast_1 = makeProjectImport(next, 'cast_1');
          next.assets.plate_1 = {
            ...makeProjectImport(next, 'plate_1'),
            sceneId: 'scene_1',
            managedAsset: { collection: 'references', fileName: 'plate_1.png' },
            sourceVisualPrompt: 'Hero enters the arena',
            ...provenance,
          };
          next.scenes.scene_1.assetIds = ['plate_1'];
          return next;
        })
      ).rejects.toMatchObject({ code: 'invalid_payload' });
    });

    it.each([
      {
        label: 'wrong collection',
        overrides: { managedAsset: { collection: 'assets' as const, fileName: 'plate_1.png' } },
      },
      {
        label: 'missing visual prompt',
        overrides: { sourceVisualPrompt: undefined },
      },
      {
        label: 'image metadata with a video MIME',
        overrides: { mimeType: 'video/mp4' },
      },
    ])('rejects complete provenance on a plate with the $label', async ({ overrides }) => {
      const project = await store.createProject(makeInput());

      await expect(
        store.updateProject(project.id, (current) => {
          const next = addScene(current, 'scene_1');
          next.assets.cast_1 = makeProjectImport(next, 'cast_1');
          next.assets.plate_1 = {
            ...makeProjectImport(next, 'plate_1'),
            sceneId: 'scene_1',
            managedAsset: { collection: 'references', fileName: 'plate_1.png' },
            sourceVisualPrompt: 'Hero enters the arena',
            sourceReferenceAssetIds: ['cast_1'],
            sourceAspectRatio: '16:9',
            sourceResolution: '1080p',
            ...overrides,
          };
          next.scenes.scene_1.assetIds = ['plate_1'];
          return next;
        })
      ).rejects.toMatchObject({ code: 'invalid_payload' });
    });

    it('loads and rewrites a pre-3a schema-v1 project without adding asset metadata defaults', async () => {
      const project = await store.createProject(makeInput());
      const legacy = await store.updateProject(project.id, (current) => {
        const next = addScene(current, 'scene_1');
        next.assets.plate_1 = {
          ...makeProjectImport(next, 'plate_1'),
          sceneId: 'scene_1',
          managedAsset: { collection: 'references', fileName: 'plate_1.png' },
          sourceVisualPrompt: 'Legacy generated plate',
        };
        next.scenes.scene_1.assetIds = ['plate_1'];
        return next;
      });
      const manifestFile = path.join(rootDir, project.id, 'project.json');
      const before = JSON.parse(readFileSync(manifestFile, 'utf8')) as StudioProject;

      await expect(store.getProject(project.id)).resolves.toEqual(legacy);
      const rewritten = await store.updateProject(project.id, (current) => ({ ...current, name: 'Legacy renamed' }));
      const after = JSON.parse(readFileSync(manifestFile, 'utf8')) as StudioProject;

      expect(before.assets.plate_1).not.toHaveProperty('sourceReferenceAssetIds');
      expect(rewritten.schemaVersion).toBe(1);
      expect(after.assets.plate_1).toEqual(before.assets.plate_1);
    });

    it('validates a job carrying the reference output role', async () => {
      const project = await store.createProject(makeInput());

      const persisted = await store.updateProject(project.id, (current) => {
        const next = addScene(current, 'scene_1');
        next.jobs.job_1 = makeJob(next, 'job_1', 'scene_1', {
          outputRole: 'reference',
          referenceInputSnapshot: {
            sourceVisualPrompt: 'Reviewed one-off plate',
            conditioningReferenceAssetIds: [],
            aspectRatio: '16:9',
            resolution: '720p',
          },
        });
        next.scenes.scene_1.jobIds = ['job_1'];
        return next;
      });

      expect(persisted.jobs.job_1.outputRole).toBe('reference');
      expect(persisted.jobs.job_1.referenceInputSnapshot).toEqual({
        sourceVisualPrompt: 'Reviewed one-off plate',
        conditioningReferenceAssetIds: [],
        aspectRatio: '16:9',
        resolution: '720p',
      });
      expect(await store.getProject(project.id)).toEqual(persisted);
    });

    it('keeps legacy reference jobs without a reference input snapshot valid and absent', async () => {
      const project = await store.createProject(makeInput());

      const persisted = await store.updateProject(project.id, (current) => {
        const next = addScene(current, 'scene_1');
        next.jobs.job_1 = makeJob(next, 'job_1', 'scene_1', { outputRole: 'reference' });
        next.scenes.scene_1.jobIds = ['job_1'];
        return next;
      });

      expect(persisted.jobs.job_1).not.toHaveProperty('referenceInputSnapshot');
    });

    it.each([
      {
        label: 'a take output role',
        snapshot: {
          sourceVisualPrompt: 'Reviewed plate',
          conditioningReferenceAssetIds: [],
          aspectRatio: '16:9',
          resolution: '720p',
        },
        outputRole: undefined,
      },
      {
        label: 'an unsafe reference id',
        snapshot: {
          sourceVisualPrompt: 'Reviewed plate',
          conditioningReferenceAssetIds: ['../escape'],
          aspectRatio: '16:9',
          resolution: '720p',
        },
        outputRole: 'reference' as const,
      },
      {
        label: 'an unknown aspect ratio',
        snapshot: {
          sourceVisualPrompt: 'Reviewed plate',
          conditioningReferenceAssetIds: [],
          aspectRatio: '2:1',
          resolution: '720p',
        },
        outputRole: 'reference' as const,
      },
    ])('rejects a reference input snapshot with $label', async ({ snapshot, outputRole }) => {
      const project = await store.createProject(makeInput());

      await expect(
        store.updateProject(project.id, (current) => {
          const next = addScene(current, 'scene_1');
          next.jobs.job_1 = makeJob(next, 'job_1', 'scene_1', {
            ...(outputRole === undefined ? {} : { outputRole }),
            referenceInputSnapshot: snapshot as never,
          });
          next.scenes.scene_1.jobIds = ['job_1'];
          return next;
        })
      ).rejects.toMatchObject({ code: 'invalid_payload' });
    });

    it('rejects a job carrying an unknown output role', async () => {
      const project = await store.createProject(makeInput());

      await expect(
        store.updateProject(project.id, (current) => {
          const next = addScene(current, 'scene_1');
          next.jobs.job_1 = makeJob(next, 'job_1', 'scene_1', { outputRole: 'poster' as never });
          next.scenes.scene_1.jobIds = ['job_1'];
          return next;
        })
      ).rejects.toMatchObject({ code: 'invalid_payload' });
    });

    it('rejects an asset with an unknown collection', async () => {
      const project = await store.createProject(makeInput());

      await expect(
        store.updateProject(project.id, (current) => {
          const next = addScene(current, 'scene_1');
          next.assets.asset_1 = {
            id: 'asset_1',
            projectId: next.id,
            sceneId: 'scene_1',
            mediaKind: 'image',
            mimeType: 'image/png',
            managedAsset: { collection: 'gallery' as never, fileName: 'asset_1.png' },
            byteSize: 1,
            sha256: '3'.repeat(64),
            createdAt: next.createdAt,
          };
          next.scenes.scene_1.assetIds = ['asset_1'];
          return next;
        })
      ).rejects.toMatchObject({ code: 'invalid_payload' });
    });

    it('accepts an asset carrying the visual prompt it was generated from', async () => {
      const project = await store.createProject(makeInput());

      const persisted = await store.updateProject(project.id, (current) => {
        const next = addScene(current, 'scene_1');
        next.assets.reference_1 = {
          id: 'reference_1',
          projectId: next.id,
          sceneId: 'scene_1',
          mediaKind: 'image',
          mimeType: 'image/png',
          managedAsset: { collection: 'references', fileName: 'reference_1.png' },
          byteSize: 1,
          sha256: '4'.repeat(64),
          createdAt: next.createdAt,
          sourceVisualPrompt: 'Aerial, drifting. Smoke columns.',
        };
        next.scenes.scene_1.assetIds = ['reference_1'];
        return next;
      });

      expect(persisted.assets.reference_1.sourceVisualPrompt).toBe('Aerial, drifting. Smoke columns.');
      expect(await store.getProject(project.id)).toEqual(persisted);
    });

    it('accepts an asset with no provenance — every pre-existing asset lacks it', async () => {
      const project = await store.createProject(makeInput());

      const persisted = await store.updateProject(project.id, (current) => {
        const next = addScene(current, 'scene_1');
        next.assets.reference_1 = {
          id: 'reference_1',
          projectId: next.id,
          sceneId: 'scene_1',
          mediaKind: 'image',
          mimeType: 'image/png',
          managedAsset: { collection: 'references', fileName: 'reference_1.png' },
          byteSize: 1,
          sha256: '5'.repeat(64),
          createdAt: next.createdAt,
        };
        next.scenes.scene_1.assetIds = ['reference_1'];
        expect('sourceVisualPrompt' in next.assets.reference_1).toBe(false);
        return next;
      });

      expect('sourceVisualPrompt' in persisted.assets.reference_1).toBe(false);
      expect(await store.getProject(project.id)).toEqual(persisted);
    });

    it('rejects an asset whose provenance is not a string', async () => {
      const project = await store.createProject(makeInput());

      await expect(
        store.updateProject(project.id, (current) => {
          const next = addScene(current, 'scene_1');
          next.assets.reference_1 = {
            id: 'reference_1',
            projectId: next.id,
            sceneId: 'scene_1',
            mediaKind: 'image',
            mimeType: 'image/png',
            managedAsset: { collection: 'references', fileName: 'reference_1.png' },
            byteSize: 1,
            sha256: '6'.repeat(64),
            createdAt: next.createdAt,
            sourceVisualPrompt: 42 as never,
          };
          next.scenes.scene_1.assetIds = ['reference_1'];
          return next;
        })
      ).rejects.toMatchObject({ code: 'invalid_payload' });
    });
  });

  it('returns summaries newest-first instead of relying on filesystem iteration order', async () => {
    const older = await store.createProject(makeInput({ name: 'Older' }));
    const newer = await store.createProject(makeInput({ name: 'Newer' }));
    await store.updateProject(older.id, (current) => ({ ...current, name: 'Newest after edit' }));

    expect((await store.listProjects()).map((summary) => summary.id)).toEqual([older.id, newer.id]);
  });

  it('repairs a stale summary index from project manifests instead of hiding durable projects', async () => {
    const project = await store.createProject(makeInput());
    writeFileSync(path.join(rootDir, 'projects.json'), JSON.stringify({ schemaVersion: 1, projects: [] }));

    const summaries = await store.listProjects();

    expect(summaries).toEqual([expect.objectContaining({ id: project.id, name: project.name })]);
    expect(readFileSync(path.join(rootDir, 'projects.json'), 'utf8')).toContain(project.id);
  });

  it('repairs a corrupt summary index from project manifests instead of discarding the source of truth', async () => {
    const project = await store.createProject(makeInput());
    writeFileSync(path.join(rootDir, 'projects.json'), '{not json');

    await expect(store.listProjects()).resolves.toEqual([expect.objectContaining({ id: project.id })]);
    expect(() => JSON.parse(readFileSync(path.join(rootDir, 'projects.json'), 'utf8'))).not.toThrow();
  });

  it('lists healthy projects and reports one corrupt manifest', async () => {
    const logError = vi.fn();
    store = createCreativeStudioStore({
      rootDir,
      now: () => new Date((clock += 1_000)).toISOString(),
      createId: () => `project_${++idCounter}`,
      logError,
    });
    const healthyA = await store.createProject(makeInput({ name: 'Healthy A' }));
    const corrupt = await store.createProject(makeInput({ name: 'Corrupt' }));
    const healthyC = await store.createProject(makeInput({ name: 'Healthy C' }));
    writeFileSync(path.join(rootDir, corrupt.id, 'project.json'), '{not json');

    const summaries = await store.listProjects();

    expect(summaries.map((summary) => summary.id).toSorted()).toEqual([healthyA.id, healthyC.id]);
    expect(await store.listQuarantinedProjectIds()).toEqual([corrupt.id]);
  });

  it('logs one parse error and shares the manifest sweep between listing methods', async () => {
    const logError = vi.fn();
    const manifestReads: string[] = [];
    const trackingFs = new Proxy(nodeFs, {
      get(target, property, receiver) {
        if (property !== 'readFile') return Reflect.get(target, property, receiver);
        return async (...args: Parameters<typeof nodeFs.readFile>): ReturnType<typeof nodeFs.readFile> => {
          const [file] = args;
          if (String(file).endsWith('project.json')) manifestReads.push(String(file));
          return nodeFs.readFile(...args);
        };
      },
    }) as typeof nodeFs;
    store = createCreativeStudioStore({
      rootDir,
      now: () => new Date((clock += 1_000)).toISOString(),
      createId: () => `project_${++idCounter}`,
      fs: trackingFs,
      logError,
    });
    const corrupt = await store.createProject(makeInput({ name: 'Corrupt' }));
    const corruptManifest = path.join(rootDir, corrupt.id, 'project.json');
    writeFileSync(corruptManifest, '{not json');
    manifestReads.length = 0;

    await store.listProjects();
    await store.listQuarantinedProjectIds();

    expect(manifestReads.filter((file) => file.endsWith(path.join(corrupt.id, 'project.json')))).toHaveLength(1);
    expect(logError).toHaveBeenCalledOnce();
    expect(logError).toHaveBeenCalledWith(
      `[CreativeStudio] Quarantined corrupt project manifest: ${corrupt.id}`,
      expect.objectContaining({ message: expect.stringContaining('JSON') })
    );
  });

  it('rejects a malformed project manifest instead of silently inventing a repaired project', async () => {
    const projectDir = path.join(rootDir, 'project_broken');
    mkdirSync(projectDir);
    writeFileSync(path.join(rootDir, 'projects.json'), '{not json');
    writeFileSync(path.join(projectDir, 'project.json'), '{not json');

    await expect(store.getProject('project_broken')).rejects.toMatchObject({ code: 'storage_error' });
  });

  describe('durable project commit boundary', () => {
    it('returns the committed revision and repairs the summary without rewriting the project', async () => {
      const project = await store.createProject(makeInput());
      const fault = summaryRenameFailureFs();
      const logError = vi.fn();
      store = createCreativeStudioStore({
        rootDir,
        now: () => new Date((clock += 1_000)).toISOString(),
        fs: fault.fs,
        logError,
      });
      fault.arm();

      const committed = await store.updateProject(
        project.id,
        (current) => ({ ...current, name: 'Committed despite stale summary' }),
        project.revision
      );

      expect(committed).toMatchObject({ name: 'Committed despite stale summary', revision: project.revision + 1 });
      expect(await store.getProject(project.id)).toEqual(committed);
      await vi.waitFor(() => {
        const index = JSON.parse(readFileSync(path.join(rootDir, 'projects.json'), 'utf8')) as {
          projects: StudioProjectSummary[];
        };
        expect(index.projects).toEqual([
          expect.objectContaining({ id: project.id, name: 'Committed despite stale summary' }),
        ]);
      });
      expect(fault.projectRenameAttempts()).toBe(1);
      expect(fault.summaryRenameAttempts()).toBe(2);
      expect(logError).toHaveBeenCalledExactlyOnceWith(
        '[CreativeStudio] Project summary repair failed after commit',
        expect.objectContaining({ message: 'summary rename failed' })
      );
    });

    it('observes frozen explicit and ordinary commit facts after directory sync and before summary repair', async () => {
      const project = await store.createProject(makeInput());
      const events: string[] = [];
      const facts: Parameters<StudioProjectCommitObserver>[0][] = [];
      let failSummaryRename = true;
      const trackingFs = new Proxy(nodeFs, {
        get(target, property, receiver) {
          if (property === 'rename') {
            return async (...args: Parameters<typeof nodeFs.rename>): ReturnType<typeof nodeFs.rename> => {
              const destination = String(args[1]);
              if (destination.endsWith(`${path.sep}projects.json`)) {
                events.push('summary-rename');
                if (failSummaryRename) {
                  failSummaryRename = false;
                  throw new Error('summary rename failed');
                }
              }
              return nodeFs.rename(...args);
            };
          }
          if (property !== 'open') return Reflect.get(target, property, receiver);
          return async (...args: Parameters<typeof nodeFs.open>) => {
            const file = String(args[0]);
            const handle = await nodeFs.open(...args);
            return new Proxy(handle, {
              get(handleTarget, handleProperty, handleReceiver) {
                if (handleProperty === 'sync') {
                  return async (): Promise<void> => {
                    await handleTarget.sync();
                    if (file.endsWith(`${path.sep}${project.id}`)) events.push('project-directory-sync');
                  };
                }
                const value = Reflect.get(handleTarget, handleProperty, handleReceiver) as unknown;
                return typeof value === 'function' ? value.bind(handleTarget) : value;
              },
            });
          };
        },
      }) as typeof nodeFs;
      store = createCreativeStudioStore({
        rootDir,
        now: () => new Date((clock += 1_000)).toISOString(),
        fs: trackingFs,
        onProjectCommitted: (observed) => {
          events.push('observer');
          facts.push(observed);
        },
      });

      const tagged = await store.updateProject(
        project.id,
        (current) => ({ ...current, name: 'Tagged commit' }),
        project.revision,
        'opaque/director/value'
      );
      const ordinary = await store.updateProject(tagged.id, (current) => ({ ...current, name: 'Ordinary commit' }));

      expect(events.slice(0, 3)).toEqual(['project-directory-sync', 'observer', 'summary-rename']);
      expect(facts).toEqual([
        {
          projectId: project.id,
          previousRevision: project.revision,
          committedRevision: tagged.revision,
          committedAt: tagged.updatedAt,
          commitTag: 'opaque/director/value',
        },
        {
          projectId: project.id,
          previousRevision: tagged.revision,
          committedRevision: ordinary.revision,
          committedAt: ordinary.updatedAt,
          commitTag: null,
        },
      ]);
      expect(facts.every(Object.isFrozen)).toBe(true);
    });

    it('does not observe stale or invalid mutations that fail before the project write', async () => {
      const project = await store.createProject(makeInput());
      const onProjectCommitted = vi.fn<StudioProjectCommitObserver>();
      store = createCreativeStudioStore({ rootDir, onProjectCommitted });

      await expect(
        store.updateProject(project.id, (current) => ({ ...current, name: 'Stale' }), project.revision + 1)
      ).rejects.toMatchObject({ code: 'stale_project' });
      await expect(
        store.updateProject(project.id, (current) => ({ ...current, targetDurationSeconds: 61 }), project.revision)
      ).rejects.toMatchObject({ code: 'invalid_payload' });

      expect(onProjectCommitted).not.toHaveBeenCalled();
    });

    it('does not observe a project whose atomic rename fails', async () => {
      const project = await store.createProject(makeInput());
      const onProjectCommitted = vi.fn<StudioProjectCommitObserver>();
      const failingFs = new Proxy(nodeFs, {
        get(target, property, receiver) {
          if (property !== 'rename') return Reflect.get(target, property, receiver);
          return async (...args: Parameters<typeof nodeFs.rename>): ReturnType<typeof nodeFs.rename> => {
            if (String(args[1]).endsWith(`${path.sep}project.json`)) throw new Error('project rename failed');
            return nodeFs.rename(...args);
          };
        },
      }) as typeof nodeFs;
      store = createCreativeStudioStore({ rootDir, fs: failingFs, onProjectCommitted });

      await expect(
        store.updateProject(project.id, (current) => ({ ...current, name: 'Not committed' }), project.revision)
      ).rejects.toMatchObject({ code: 'storage_error' });

      expect(onProjectCommitted).not.toHaveBeenCalled();
      expect(await createCreativeStudioStore({ rootDir }).getProject(project.id)).toEqual(project);
    });

    it('does not observe a project whose directory sync fails', async () => {
      const project = await store.createProject(makeInput());
      const onProjectCommitted = vi.fn<StudioProjectCommitObserver>();
      const failingFs = new Proxy(nodeFs, {
        get(target, property, receiver) {
          if (property !== 'open') return Reflect.get(target, property, receiver);
          return async (...args: Parameters<typeof nodeFs.open>) => {
            const file = String(args[0]);
            const handle = await nodeFs.open(...args);
            return new Proxy(handle, {
              get(handleTarget, handleProperty, handleReceiver) {
                if (handleProperty === 'sync' && file.endsWith(`${path.sep}${project.id}`)) {
                  return async (): Promise<void> => {
                    throw new Error('project directory sync failed');
                  };
                }
                const value = Reflect.get(handleTarget, handleProperty, handleReceiver) as unknown;
                return typeof value === 'function' ? value.bind(handleTarget) : value;
              },
            });
          };
        },
      }) as typeof nodeFs;
      store = createCreativeStudioStore({ rootDir, fs: failingFs, onProjectCommitted });

      await expect(
        store.updateProject(project.id, (current) => ({ ...current, name: 'Unconfirmed commit' }), project.revision)
      ).rejects.toMatchObject({ code: 'storage_error' });

      expect(onProjectCommitted).not.toHaveBeenCalled();
    });

    it('logs and swallows a synchronous commit observer failure', async () => {
      const project = await store.createProject(makeInput());
      const observerError = new Error('observer failed');
      const logError = vi.fn();
      store = createCreativeStudioStore({
        rootDir,
        onProjectCommitted: () => {
          throw observerError;
        },
        logError,
      });

      await expect(
        store.updateProject(project.id, (current) => ({ ...current, name: 'Observer cannot veto' }), project.revision)
      ).resolves.toMatchObject({ name: 'Observer cannot veto', revision: project.revision + 1 });
      expect(logError).toHaveBeenCalledWith('[CreativeStudio] Project commit observer failed', observerError);
    });

    it('sinks a rejected contract-violating thenable without awaiting it', async () => {
      const project = await store.createProject(makeInput());
      const observerError = new Error('async observer failed');
      const logError = vi.fn();
      let rejectObserver: (error: Error) => void = () => undefined;
      const contractViolatingObserver = (() =>
        new Promise<never>((_resolve, reject) => {
          rejectObserver = reject;
        })) as unknown as StudioProjectCommitObserver;
      store = createCreativeStudioStore({ rootDir, onProjectCommitted: contractViolatingObserver, logError });
      let settled = false;

      const update = store
        .updateProject(
          project.id,
          (current) => ({ ...current, name: 'Thenable cannot delay commit' }),
          project.revision
        )
        .then((result) => {
          settled = true;
          return result;
        });
      await vi.waitFor(() => expect(settled).toBe(true));
      rejectObserver(observerError);

      await vi.waitFor(() =>
        expect(logError).toHaveBeenCalledWith('[CreativeStudio] Project commit observer rejected', observerError)
      );
      await expect(update).resolves.toMatchObject({ revision: project.revision + 1 });
    });

    it('keeps the committed result and retry when error logging itself throws', async () => {
      const project = await store.createProject(makeInput());
      const fault = summaryRenameFailureFs();
      const throwingLogger = vi.fn(() => {
        throw new Error('logger failed');
      });
      store = createCreativeStudioStore({
        rootDir,
        fs: fault.fs,
        onProjectCommitted: () => {
          throw new Error('observer failed');
        },
        logError: throwingLogger,
      });
      fault.arm();

      const committed = await store.updateProject(
        project.id,
        (current) => ({ ...current, name: 'Committed through logger failures' }),
        project.revision
      );

      expect(committed.revision).toBe(project.revision + 1);
      await vi.waitFor(() => expect(fault.summaryRenameAttempts()).toBe(2));
      expect(fault.projectRenameAttempts()).toBe(1);
      expect(throwingLogger).toHaveBeenCalledTimes(2);
    });
  });

  it('syncs atomic temp files and their directories before reporting a write as complete', async () => {
    const syncTargets: string[] = [];
    const trackingFs = new Proxy(nodeFs, {
      get(target, property, receiver) {
        if (property !== 'open') return Reflect.get(target, property, receiver);
        return async (...args: Parameters<typeof nodeFs.open>) => {
          const file = String(args[0]);
          const handle = await nodeFs.open(...args);
          return new Proxy(handle, {
            get(handleTarget, handleProperty, handleReceiver) {
              if (handleProperty === 'sync') {
                return async (): Promise<void> => {
                  syncTargets.push(file);
                  await handleTarget.sync();
                };
              }
              const value = Reflect.get(handleTarget, handleProperty, handleReceiver) as unknown;
              return typeof value === 'function' ? value.bind(handleTarget) : value;
            },
          });
        };
      },
    }) as typeof nodeFs;
    store = createCreativeStudioStore({
      rootDir,
      now: () => new Date((clock += 1_000)).toISOString(),
      createId: () => `project_${++idCounter}`,
      fs: trackingFs,
    });
    const project = await store.createProject(makeInput());
    syncTargets.length = 0;

    await store.updateProject(project.id, (current) => ({ ...current, name: 'Durable rename' }));

    expect(syncTargets.some((target) => target.endsWith('.tmp'))).toBe(true);
    expect(syncTargets.some((target) => target.endsWith(project.id))).toBe(true);
  });

  it('defaults Task 6 retry metadata when reading a valid pre-Task 6 schema-v1 job', async () => {
    const project = await store.createProject(makeInput());
    const withJob = await store.updateProject(project.id, (current) => addSucceededJob(current));
    const manifestFile = path.join(rootDir, withJob.id, 'project.json');
    const legacy = JSON.parse(readFileSync(manifestFile, 'utf8')) as {
      jobs: Record<string, Record<string, unknown>>;
    };
    delete legacy.jobs.job_1.retryOfJobId;
    delete legacy.jobs.job_1.retryReason;
    delete legacy.jobs.job_1.duplicateChargeAcknowledged;
    delete legacy.jobs.job_1.duplicateChargeAcknowledgedAt;
    writeFileSync(manifestFile, JSON.stringify(legacy));

    await expect(store.getProject(withJob.id)).resolves.toMatchObject({
      jobs: {
        job_1: {
          retryOfJobId: null,
          retryReason: null,
          duplicateChargeAcknowledged: false,
          duplicateChargeAcknowledgedAt: null,
        },
      },
    });
  });

  it('defaults a legacy schema-v1 job cancellation policy to none on read', async () => {
    const project = await store.createProject(makeInput());
    const withJob = await store.updateProject(project.id, (current) => addSucceededJob(current));
    const manifestFile = path.join(rootDir, withJob.id, 'project.json');
    const legacy = JSON.parse(readFileSync(manifestFile, 'utf8')) as {
      jobs: Record<string, Record<string, unknown>>;
    };
    delete legacy.jobs.job_1.cancellationPolicy;
    writeFileSync(manifestFile, JSON.stringify(legacy));

    await expect(store.getProject(withJob.id)).resolves.toMatchObject({
      jobs: { job_1: { cancellationPolicy: 'none' } },
    });
  });

  it('accepts a legacy schema-v1 job without a remote polling anchor', async () => {
    const project = await store.createProject(makeInput());
    const withJob = await store.updateProject(project.id, (current) => addSucceededJob(current));
    const manifestFile = path.join(rootDir, withJob.id, 'project.json');
    const legacy = JSON.parse(readFileSync(manifestFile, 'utf8')) as {
      jobs: Record<string, Record<string, unknown>>;
    };
    delete legacy.jobs.job_1.remoteStartedAt;
    writeFileSync(manifestFile, JSON.stringify(legacy));

    await expect(store.getProject(withJob.id)).resolves.toMatchObject({
      jobs: { job_1: { id: 'job_1' } },
    });
  });

  it.each([null, '2026-08-04T01:02:03.004Z'])(
    'accepts the durable remote polling anchor %s',
    async (remoteStartedAt) => {
      const project = await store.createProject(makeInput());
      const withJob = await store.updateProject(project.id, (current) => addSucceededJob(current));

      await expect(
        store.updateProject(withJob.id, (current) => {
          const next = cloneProject(current);
          next.jobs.job_1.providerJobId = remoteStartedAt === null ? null : 'remote_1';
          next.jobs.job_1.remoteStartedAt = remoteStartedAt;
          return next;
        })
      ).resolves.toMatchObject({
        jobs: { job_1: { remoteStartedAt } },
      });
    }
  );

  it.each(['not-a-date', '2026-08-04T01:02:03Z', '999999999999999999999999'])(
    'rejects a non-canonical durable remote polling anchor %s',
    async (remoteStartedAt) => {
      const project = await store.createProject(makeInput());
      const withJob = await store.updateProject(project.id, (current) => addSucceededJob(current));

      await expect(
        store.updateProject(withJob.id, (current) => {
          const next = cloneProject(current);
          next.jobs.job_1.providerJobId = 'remote_1';
          next.jobs.job_1.remoteStartedAt = remoteStartedAt;
          return next;
        })
      ).rejects.toMatchObject({ code: 'invalid_payload' });
    }
  );

  it.each([
    {
      label: 'a timestamp without a provider identity',
      providerJobId: null,
      remoteStartedAt: '2026-08-04T01:02:03.004Z',
    },
    { label: 'null with a provider identity', providerJobId: 'remote_1', remoteStartedAt: null },
  ])('rejects $label when the remote anchor property is present', async ({ providerJobId, remoteStartedAt }) => {
    const project = await store.createProject(makeInput());
    const withJob = await store.updateProject(project.id, (current) => addSucceededJob(current));

    await expect(
      store.updateProject(withJob.id, (current) => {
        const next = cloneProject(current);
        next.jobs.job_1.providerJobId = providerJobId;
        next.jobs.job_1.remoteStartedAt = remoteStartedAt;
        return next;
      })
    ).rejects.toMatchObject({ code: 'invalid_payload' });
  });

  it('accepts poll_deadline as a stable durable job error code', async () => {
    const project = await store.createProject(makeInput());
    const withJob = await store.updateProject(project.id, (current) => {
      const next = addSucceededJob(current);
      next.jobs.job_1.status = 'needs_attention';
      next.jobs.job_1.error = {
        code: 'poll_deadline',
        messageKey: 'conversation.creativeStudio.jobs.errors.pollDeadline',
      };
      next.scenes.scene_1.reviewState = 'blocked';
      return next;
    });

    await expect(store.getProject(withJob.id)).resolves.toMatchObject({
      jobs: { job_1: { error: { code: 'poll_deadline' } } },
    });
  });

  it('rejects an invalid durable job cancellation policy instead of widening cancellation authority', async () => {
    const project = await store.createProject(makeInput());
    const withJob = await store.updateProject(project.id, (current) => addSucceededJob(current));
    const manifestFile = path.join(rootDir, withJob.id, 'project.json');
    const malformed = JSON.parse(readFileSync(manifestFile, 'utf8')) as {
      jobs: Record<string, Record<string, unknown>>;
    };
    malformed.jobs.job_1.cancellationPolicy = 'always';
    writeFileSync(manifestFile, JSON.stringify(malformed));

    await expect(store.getProject(withJob.id)).rejects.toMatchObject({ code: 'storage_error' });
  });

  it('atomically replaces manifests instead of leaving a partial JSON document after repeated writes', async () => {
    const project = await store.createProject(makeInput());
    await store.updateProject(project.id, (current) => ({ ...current, name: 'Atomically replaced' }));

    const manifestFile = path.join(rootDir, project.id, 'project.json');
    expect(() => JSON.parse(readFileSync(manifestFile, 'utf8'))).not.toThrow();
    expect(readdirSync(path.dirname(manifestFile)).some((entry) => entry.endsWith('.tmp'))).toBe(false);
  });

  it('serializes concurrent updates instead of losing one editor mutation', async () => {
    const project = await store.createProject(makeInput());

    await Promise.all([
      store.updateProject(project.id, (current) => addScene(current, 'scene_1')),
      store.updateProject(project.id, (current) => addScene(current, 'scene_2')),
    ]);

    const persisted = await store.getProject(project.id);
    expect(persisted?.sceneOrder).toEqual(['scene_1', 'scene_2']);
    expect(persisted?.revision).toBe(3);
  });

  it('continues a project queue after a rejected update instead of blocking later valid edits', async () => {
    const project = await store.createProject(makeInput());
    await expect(
      store.updateProject(project.id, (current) => ({ ...current, targetDurationSeconds: 61 }))
    ).rejects.toMatchObject({ code: 'invalid_payload' });

    await expect(
      store.updateProject(project.id, (current) => ({ ...current, name: 'Saved after rejection' }))
    ).resolves.toMatchObject({
      name: 'Saved after rejection',
      revision: 2,
    });
  });

  it('persists structurally valid terminal-job metadata corrections instead of owning job lifecycle policy', async () => {
    const project = await store.createProject(makeInput());
    const withTerminalJob = await store.updateProject(project.id, (current) => {
      const next = addSucceededJob(current);
      next.jobs.job_1.status = 'failed';
      next.jobs.job_1.error = {
        code: 'provider_unavailable',
        messageKey: 'conversation.creativeStudio.jobs.errors.providerUnavailable',
      };
      return next;
    });

    const corrected = await store.updateProject(withTerminalJob.id, (current) => {
      const next = cloneProject(current);
      next.jobs.job_1.error = {
        code: 'timeout',
        messageKey: 'conversation.creativeStudio.jobs.errors.timeout',
      };
      return next;
    });

    expect(corrected.jobs.job_1.error).toEqual({
      code: 'timeout',
      messageKey: 'conversation.creativeStudio.jobs.errors.timeout',
    });
  });

  it.each([
    [
      'a missing predecessor',
      (project: StudioProject) => {
        project.jobs.job_2.retryOfJobId = 'job_missing';
      },
    ],
    [
      'itself',
      (project: StudioProject) => {
        project.jobs.job_2.retryOfJobId = 'job_2';
      },
    ],
    [
      'a job owned by another scene',
      (project: StudioProject) => {
        project.jobs.job_other = makeJob(project, 'job_other', 'scene_2');
        project.scenes.scene_2.jobIds = ['job_other'];
        project.jobs.job_2.retryOfJobId = 'job_other';
      },
    ],
    [
      'a later job',
      (project: StudioProject) => {
        project.scenes.scene_1.jobIds = ['job_2', 'job_1'];
      },
    ],
  ])('rejects retry lineage that references %s', async (_reason, mutate) => {
    const project = await store.createProject(makeInput());

    await expect(
      store.updateProject(project.id, (current) => {
        const next = addRetryGraph(current);
        mutate(next);
        return next;
      })
    ).rejects.toMatchObject({ code: 'invalid_payload' });
  });

  it('rejects retry cycles even when every referenced job exists', async () => {
    const project = await store.createProject(makeInput());

    await expect(
      store.updateProject(project.id, (current) => {
        const next = addRetryGraph(current);
        next.jobs.job_1.retryOfJobId = 'job_2';
        next.jobs.job_1.retryReason = 'provider_failure';
        return next;
      })
    ).rejects.toMatchObject({ code: 'invalid_payload' });
  });

  it('accepts duplicate-charge acknowledgement only for an actual submission-unknown predecessor', async () => {
    const project = await store.createProject(makeInput());

    await expect(
      store.updateProject(project.id, (current) => {
        const next = addRetryGraph(current);
        next.jobs.job_2.retryReason = 'submission_unknown';
        next.jobs.job_2.duplicateChargeAcknowledged = true;
        next.jobs.job_2.duplicateChargeAcknowledgedAt = '2026-07-30T00:00:00.000Z';
        return next;
      })
    ).rejects.toMatchObject({ code: 'invalid_payload' });
  });

  it.each(['needs_attention', 'failed'] as const)(
    'accepts acknowledged submission-unknown lineage when the predecessor is %s',
    async (predecessorStatus) => {
      const project = await store.createProject(makeInput());

      await expect(
        store.updateProject(project.id, (current) => {
          const next = addRetryGraph(current);
          next.jobs.job_1.status = predecessorStatus;
          next.jobs.job_1.error = {
            code: 'submission_unknown',
            messageKey: 'conversation.creativeStudio.jobs.errors.submissionUnknown',
          };
          next.jobs.job_2.retryReason = 'submission_unknown';
          next.jobs.job_2.duplicateChargeAcknowledged = true;
          next.jobs.job_2.duplicateChargeAcknowledgedAt = '2026-07-30T00:00:00.000Z';
          return next;
        })
      ).resolves.toMatchObject({
        jobs: {
          job_2: {
            retryOfJobId: 'job_1',
            retryReason: 'submission_unknown',
            duplicateChargeAcknowledged: true,
          },
        },
      });
    }
  );

  it('requires a confirmed failed predecessor for provider-failure retry lineage', async () => {
    const project = await store.createProject(makeInput());

    await expect(
      store.updateProject(project.id, (current) => {
        const next = addRetryGraph(current);
        next.jobs.job_1.status = 'needs_attention';
        return next;
      })
    ).rejects.toMatchObject({ code: 'invalid_payload' });
  });

  it('serializes concurrent index rebuilds instead of dropping a different-project summary', async () => {
    const [first, second] = await Promise.all([
      store.createProject(makeInput({ name: 'First' })),
      store.createProject(makeInput({ name: 'Second' })),
    ]);

    const index = JSON.parse(readFileSync(path.join(rootDir, 'projects.json'), 'utf8')) as {
      projects: StudioProjectSummary[];
    };
    expect(index.projects.map((summary) => summary.id).toSorted()).toEqual([first.id, second.id].toSorted());
  });

  it('deletes a project explicitly instead of retaining its summary after removal', async () => {
    const project = await store.createProject(makeInput());

    expect(await store.deleteProject(project.id, project.revision)).toBe(true);
    expect(await store.getProject(project.id)).toBeNull();
    expect(await store.listProjects()).toEqual([]);
  });

  it('refuses deletion inside the project queue while generation work is active', async () => {
    const project = await store.createProject(makeInput());
    const active = await store.updateProject(project.id, (current) => {
      const next = addSucceededJob(current);
      next.jobs.job_1.status = 'running';
      next.jobs.job_1.outputAssetIds = [];
      return next;
    });

    await expect(store.deleteProject(active.id, project.revision)).rejects.toMatchObject({ code: 'busy' });
    await expect(store.getProject(active.id)).resolves.toMatchObject({ id: active.id });
  });

  it('refuses deletion while a possibly charged attempt still needs attention', async () => {
    const project = await store.createProject(makeInput());
    const paused = await store.updateProject(project.id, (current) => {
      const next = addSucceededJob(current);
      next.jobs.job_1.status = 'needs_attention';
      next.jobs.job_1.outputAssetIds = [];
      next.jobs.job_1.error = {
        code: 'submission_unknown',
        messageKey: 'conversation.creativeStudio.jobs.errors.submissionUnknown',
      };
      return next;
    });

    await expect(store.deleteProject(paused.id, paused.revision)).rejects.toMatchObject({ code: 'busy' });
    await expect(store.getProject(paused.id)).resolves.toMatchObject({ id: paused.id });
  });

  it('refuses a traversing deletion ID instead of removing a sibling directory', async () => {
    const outsideDir = mkdtempSync(path.join(tmpdir(), 'creative-studio-outside-'));
    const marker = path.join(outsideDir, 'survives.txt');
    writeFileSync(marker, 'must survive');

    try {
      await expect(store.deleteProject(path.join('..', path.basename(outsideDir)), 1)).resolves.toBe(false);
      expect(existsSync(marker)).toBe(true);
    } finally {
      await rm(outsideDir, { recursive: true, force: true });
    }
  });

  it('refuses a symlinked project root instead of following it during deletion', async () => {
    const outsideDir = mkdtempSync(path.join(tmpdir(), 'creative-studio-symlink-target-'));
    const marker = path.join(outsideDir, 'survives.txt');
    writeFileSync(marker, 'must survive');
    symlinkSync(outsideDir, path.join(rootDir, 'project_link'));

    try {
      await expect(store.deleteProject('project_link', 1)).rejects.toMatchObject({ code: 'storage_error' });
      expect(existsSync(marker)).toBe(true);
    } finally {
      await rm(outsideDir, { recursive: true, force: true });
    }
  });

  describe('symlink confinement', () => {
    it('rejects a symlinked project directory before getProject can read an external manifest', async () => {
      const project = await store.createProject(makeInput());
      const outsideDir = mkdtempSync(path.join(tmpdir(), 'creative-studio-get-target-'));
      const manifest = readFileSync(path.join(rootDir, project.id, 'project.json'));
      writeFileSync(path.join(outsideDir, 'project.json'), manifest);
      rmSync(path.join(rootDir, project.id), { recursive: true, force: true });
      symlinkSync(outsideDir, path.join(rootDir, project.id));

      try {
        await expect(store.getProject(project.id)).rejects.toMatchObject({ code: 'storage_error' });
        expect(readFileSync(path.join(outsideDir, 'project.json'))).toEqual(manifest);
      } finally {
        await rm(outsideDir, { recursive: true, force: true });
      }
    });

    it('rejects a symlinked project directory before updateProject can overwrite an external manifest', async () => {
      const project = await store.createProject(makeInput());
      const outsideDir = mkdtempSync(path.join(tmpdir(), 'creative-studio-update-target-'));
      const manifest = readFileSync(path.join(rootDir, project.id, 'project.json'));
      writeFileSync(path.join(outsideDir, 'project.json'), manifest);
      rmSync(path.join(rootDir, project.id), { recursive: true, force: true });
      symlinkSync(outsideDir, path.join(rootDir, project.id));

      try {
        await expect(
          store.updateProject(project.id, (current) => ({ ...current, name: 'Escaped write' }))
        ).rejects.toMatchObject({
          code: 'storage_error',
        });
        expect(readFileSync(path.join(outsideDir, 'project.json'))).toEqual(manifest);
      } finally {
        await rm(outsideDir, { recursive: true, force: true });
      }
    });

    it('rejects project creation when the new project directory is a symlink instead of writing through it', async () => {
      const outsideDir = mkdtempSync(path.join(tmpdir(), 'creative-studio-create-target-'));
      const marker = path.join(outsideDir, 'do-not-create-project.json');
      writeFileSync(marker, 'must survive');
      symlinkSync(outsideDir, path.join(rootDir, 'project_1'));

      try {
        await expect(store.createProject(makeInput())).rejects.toMatchObject({ code: 'storage_error' });
        expect(existsSync(path.join(outsideDir, 'project.json'))).toBe(false);
        expect(readFileSync(marker, 'utf8')).toBe('must survive');
      } finally {
        await rm(outsideDir, { recursive: true, force: true });
      }
    });

    it('rejects a symlinked project directory during summary repair instead of silently accepting it', async () => {
      const outsideDir = mkdtempSync(path.join(tmpdir(), 'creative-studio-summary-project-target-'));
      const marker = path.join(outsideDir, 'do-not-read-project.json');
      writeFileSync(marker, 'must survive');
      symlinkSync(outsideDir, path.join(rootDir, 'project_escape'));

      try {
        await expect(store.listProjects()).rejects.toMatchObject({ code: 'storage_error' });
        expect(readFileSync(marker, 'utf8')).toBe('must survive');
      } finally {
        await rm(outsideDir, { recursive: true, force: true });
      }
    });

    it('rejects a symlinked summary index instead of repairing it through an external file', async () => {
      const project = await store.createProject(makeInput());
      const outsideDir = mkdtempSync(path.join(tmpdir(), 'creative-studio-summary-index-target-'));
      const outsideIndex = path.join(outsideDir, 'projects.json');
      const sentinel = '{"sentinel":"must survive"}';
      writeFileSync(outsideIndex, sentinel);
      rmSync(path.join(rootDir, 'projects.json'));
      symlinkSync(outsideIndex, path.join(rootDir, 'projects.json'));

      try {
        await expect(store.listProjects()).rejects.toMatchObject({ code: 'storage_error' });
        expect(readFileSync(outsideIndex, 'utf8')).toBe(sentinel);
        expect(await store.getProject(project.id)).toMatchObject({ id: project.id });
      } finally {
        await rm(outsideDir, { recursive: true, force: true });
      }
    });

    it('rejects project creation when the summary index is a symlink before creating a manifest', async () => {
      const outsideDir = mkdtempSync(path.join(tmpdir(), 'creative-studio-create-index-target-'));
      const outsideIndex = path.join(outsideDir, 'projects.json');
      const sentinel = '{"sentinel":"must survive"}';
      writeFileSync(outsideIndex, sentinel);
      symlinkSync(outsideIndex, path.join(rootDir, 'projects.json'));

      try {
        await expect(store.createProject(makeInput())).rejects.toMatchObject({ code: 'storage_error' });
        expect(existsSync(path.join(rootDir, 'project_1'))).toBe(false);
        expect(readFileSync(outsideIndex, 'utf8')).toBe(sentinel);
      } finally {
        await rm(outsideDir, { recursive: true, force: true });
      }
    });

    it('rejects updates when the summary index is a symlink before changing a project manifest', async () => {
      const project = await store.createProject(makeInput());
      const outsideDir = mkdtempSync(path.join(tmpdir(), 'creative-studio-update-index-target-'));
      const outsideIndex = path.join(outsideDir, 'projects.json');
      const sentinel = '{"sentinel":"must survive"}';
      writeFileSync(outsideIndex, sentinel);
      rmSync(path.join(rootDir, 'projects.json'));
      symlinkSync(outsideIndex, path.join(rootDir, 'projects.json'));

      try {
        await expect(
          store.updateProject(project.id, (current) => ({ ...current, name: 'Blocked update' }))
        ).rejects.toMatchObject({
          code: 'storage_error',
        });
        expect((await store.getProject(project.id))?.name).toBe(project.name);
        expect(readFileSync(outsideIndex, 'utf8')).toBe(sentinel);
      } finally {
        await rm(outsideDir, { recursive: true, force: true });
      }
    });
  });
});

const makeStudioMutationBatchV2 = (
  project: StudioProjectV2,
  operations: StudioMutationBatchV2['operations'],
  expectedRevision = project.revision
): StudioMutationBatchV2 => ({
  schemaVersion: 2,
  projectId: project.id,
  expectedRevision,
  operations,
});

const makeBoundaryMutationBatchV2 = (projectId: string, expectedRevision = 1): StudioMutationBatchV2 => ({
  schemaVersion: 2,
  projectId,
  expectedRevision,
  operations: [{ kind: 'set_brief', brief: 'Updated without a commit tag' }],
});

const makeMutationContextV2 = (
  overrides: Partial<StudioMutationReducerContextV2> = {}
): StudioMutationReducerContextV2 => ({
  mutationId: 'mutation_store_test',
  capturedAt: '2026-08-17T12:00:00.000Z',
  ...overrides,
});

const createDeferredV2 = <T>(): {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
} => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

describe('schema-2 creative studio project store', () => {
  const timestamp = '2026-08-17T12:00:00.000Z';
  const inputV2: CreateStudioProjectInputV2 = {
    name: 'Schema Two Film',
    brief: 'A clean-cutover project',
    aspectRatio: '16:9',
    targetDurationSeconds: 30,
    resolution: '1080p',
  };
  let rootDir: string;

  const readJson = <T>(file: string): T => JSON.parse(readFileSync(file, 'utf8')) as T;

  const seedProjectV2 = (project: StudioProjectV2): void => {
    const directory = path.join(rootDir, project.id);
    mkdirSync(directory);
    writeFileSync(path.join(directory, 'project.json'), JSON.stringify(project, null, 2));
  };

  const seedProposalV2 = async (
    store: CreativeStudioStore,
    project: StudioProjectV2,
    input: {
      proposalId?: string;
      payload?: StudioProposalRecordV2['payload'];
      createdAt?: string;
    } = {}
  ): Promise<{
    proposal: StudioProposalRecordV2;
    slot: StudioProposalSlotV2;
    directories: { root: string; pending: string; decisions: string; slots: string; commits: string };
  }> => {
    await store.resolveProposalPathsV2(project.id);
    const familyRoot = path.join(rootDir, project.id, 'proposals');
    const directories = {
      root: familyRoot,
      pending: path.join(familyRoot, 'pending'),
      decisions: path.join(familyRoot, 'decisions'),
      slots: path.join(familyRoot, 'slots'),
      commits: path.join(familyRoot, 'commits'),
    };
    const proposalId = input.proposalId ?? 'proposal_v2';
    const proposal: StudioProposalRecordV2 = {
      schemaVersion: 2,
      id: proposalId,
      projectId: project.id,
      status: 'pending',
      baseRevision: project.revision,
      payload: input.payload ?? {
        kind: 'mutation_batch',
        operations: [{ kind: 'set_brief', brief: 'Accepted brief' }],
      },
      createdAt: input.createdAt ?? timestamp,
      decidedAt: null,
    };
    const slot: StudioProposalSlotV2 = { schemaVersion: 2, proposalId, reservedAt: proposal.createdAt };
    writeFileSync(path.join(directories.pending, `${proposalId}.json`), JSON.stringify(proposal));
    writeFileSync(path.join(directories.slots, '0.slot'), JSON.stringify(slot));
    return { proposal, slot, directories };
  };

  const seedReferenceRequestV2 = async (
    store: CreativeStudioStore,
    project: StudioProjectV2,
    input: { requestId?: string; shotIds?: string[]; createdAt?: string; slotIndex?: number } = {}
  ): Promise<{
    request: StudioReferenceRequestV2;
    slot: StudioReferenceRequestSlotV2;
    directories: { root: string; pending: string; decisions: string; slots: string; receipts: string };
  }> => {
    await store.resolveReferenceRequestPathsV2(project.id);
    const familyRoot = path.join(rootDir, project.id, 'reference-requests');
    const directories = {
      root: familyRoot,
      pending: path.join(familyRoot, 'pending'),
      decisions: path.join(familyRoot, 'decisions'),
      slots: path.join(familyRoot, 'slots'),
      receipts: path.join(familyRoot, 'receipts'),
    };
    const requestId = input.requestId ?? 'reference_request_v2';
    const request: StudioReferenceRequestV2 = {
      schemaVersion: 2,
      id: requestId,
      projectId: project.id,
      shotIds: input.shotIds ?? ['shot_reference'],
      status: 'pending',
      createdAt: input.createdAt ?? timestamp,
    };
    const slot: StudioReferenceRequestSlotV2 = {
      schemaVersion: 2,
      requestId,
      reservedAt: request.createdAt,
    };
    writeFileSync(path.join(directories.pending, `${requestId}.json`), JSON.stringify(request));
    writeFileSync(path.join(directories.slots, `${input.slotIndex ?? 0}.slot`), JSON.stringify(slot));
    return { request, slot, directories };
  };

  const seedGenerationHandoffV2 = async (
    store: CreativeStudioStore,
    project: StudioProjectV2,
    input: { requestId?: string; shotIds?: string[]; slotIndex?: number } = {}
  ): Promise<
    Awaited<ReturnType<typeof seedReferenceRequestV2>> & {
      decision: StudioReferenceRequestDecisionV2 & {
        outcome: Extract<StudioReferenceRequestDecisionV2['outcome'], { kind: 'generation_gate' }>;
      };
      handoffId: string;
    }
  > => {
    const seeded = await seedReferenceRequestV2(store, project, input);
    const entry = await store.decideReferenceRequestV2({
      projectId: project.id,
      requestId: seeded.request.id,
      expectedRevision: project.revision,
      outcome: { kind: 'generation_gate' },
    });
    if (entry.decision?.outcome.kind !== 'generation_gate') {
      throw new Error('expected generation handoff decision');
    }
    return {
      ...seeded,
      decision: entry.decision as StudioReferenceRequestDecisionV2 & {
        outcome: Extract<StudioReferenceRequestDecisionV2['outcome'], { kind: 'generation_gate' }>;
      },
      handoffId: entry.decision.outcome.handoffId,
    };
  };

  const addActiveReferenceShotsV2 = async (
    store: CreativeStudioStore,
    project: StudioProjectV2,
    shotIds: string[] = ['shot_reference']
  ): Promise<StudioProjectV2> => {
    const operations: StudioMutationBatchV2['operations'] = [
      {
        kind: 'add_beat',
        beatId: 'beat_reference',
        beat: { title: 'Reference beat', action: '', look: '', targetSeconds: null },
        beforeBeatId: null,
      },
      ...shotIds.map((shotId): StudioMutationBatchV2['operations'][number] => ({
        kind: 'add_shot',
        beatId: 'beat_reference',
        shotId,
        shot: { line: shotId, narration: '', onScreenText: '', durationSeconds: 4 },
        beforeShotId: null,
      })),
    ];
    return (
      await store.applyMutationBatchV2(
        { schemaVersion: 2, projectId: project.id, expectedRevision: project.revision, operations },
        { mutationId: `seed_${project.id}`, capturedAt: timestamp }
      )
    ).project;
  };

  const addReferenceAuthorizationV2 = (
    project: StudioProjectV2,
    handoffId: string,
    shotId = 'shot_reference'
  ): StudioProjectV2 => {
    const requestPlan: StudioGenerationRequestPlan = {
      kind: 'resolved',
      snapshot: {
        prompt: 'Reference seed prompt',
        aspectRatio: project.aspectRatio,
        resolution: project.resolution,
        durationSeconds: project.shots[shotId]!.durationSeconds,
        referenceInput: null,
        conditioningInput: null,
      },
    };
    const item: StudioQuotedGeneration = {
      id: createStudioQuotedGenerationId({
        projectId: project.id,
        projectRevision: project.revision,
        shotId,
        purpose: 'seed_still',
      }),
      shotId,
      purpose: 'seed_still',
      routeId: 'image_route',
      generationCount: 1,
      requestPlan,
      rateUnit: 'generation',
      rateMinorUnits: 2,
    };
    const totals = calculateStudioQuoteTotals([item])!;
    const provider = {
      providerId: 'provider_reference',
      adapterId: 'weprompt-image-v1',
      model: 'image-model',
    } as const;
    const authorization: StudioSpendAuthorization = {
      id: `authorization_${handoffId}`,
      projectId: project.id,
      projectRevision: project.revision,
      originReferenceHandoffId: handoffId,
      rateCardDigest: 'd'.repeat(64),
      currency: 'USD',
      baseItems: [item],
      cascadeItems: [],
      lowerMinorUnits: totals.lowerMinorUnits,
      upperMinorUnits: totals.upperMinorUnits,
      expiresAt: '2026-08-17T12:05:00.000Z',
      confirmedAt: '2026-08-17T12:00:03.000Z',
      providerBindings: [{ itemId: item.id, provider }],
      idempotencyKeys: [{ itemId: item.id, generationIndex: 0, key: `idem_${handoffId}` }],
    };
    const job: StudioJobV2 = {
      id: `job_${handoffId}`,
      projectId: project.id,
      shotId,
      status: 'queued_local',
      provider,
      idempotencyKey: `idem_${handoffId}`,
      providerJobId: null,
      cancellationPolicy: 'queued_and_running',
      purpose: 'seed_still',
      authorizationId: authorization.id,
      authorizationItemId: item.id,
      generationIndex: 0,
      requestPlan,
      requestSnapshot: requestPlan.snapshot,
      spendReceipt: null,
      outputAssetIds: [],
      outputAssetIdsByRole: { primary: null, poster: null },
      error: null,
      retryOfJobId: null,
      retryReason: null,
      duplicateChargeAcknowledged: false,
      duplicateChargeAcknowledgedAt: null,
      createdAt: authorization.confirmedAt,
      updatedAt: authorization.confirmedAt,
    };
    project.spendAuthorizations.push(authorization);
    project.jobs[job.id] = job;
    project.shots[shotId]!.jobIds.push(job.id);
    return project;
  };

  const snapshotTreeV2 = (directory: string): Array<{ path: string; kind: 'directory' | 'file'; bytes?: string }> => {
    const entries: Array<{ path: string; kind: 'directory' | 'file'; bytes?: string }> = [];
    const visit = (current: string, relative: string): void => {
      for (const name of readdirSync(current).toSorted()) {
        const absolute = path.join(current, name);
        const child = relative.length === 0 ? name : path.join(relative, name);
        const stats = lstatSync(absolute);
        if (stats.isDirectory()) {
          entries.push({ path: child, kind: 'directory' });
          visit(absolute, child);
        } else if (stats.isFile()) {
          entries.push({ path: child, kind: 'file', bytes: readFileSync(absolute).toString('base64') });
        }
      }
    };
    visit(directory, '');
    return entries;
  };

  const failFileSystemOnceV2 = (shouldFail: (method: string, args: readonly unknown[]) => boolean): typeof nodeFs => {
    let failed = false;
    return new Proxy(nodeFs, {
      get(target, property, receiver) {
        const value = Reflect.get(target, property, receiver) as unknown;
        if (typeof property !== 'string' || typeof value !== 'function') return value;
        return (...args: unknown[]): unknown => {
          if (!failed && shouldFail(property, args)) {
            failed = true;
            throw Object.assign(new Error('injected proposal crash'), { code: 'EIO' });
          }
          return Reflect.apply(value, target, args);
        };
      },
    }) as typeof nodeFs;
  };

  const seedPrototypeProject = async (projectId = 'prototype_v1'): Promise<StudioProject> => {
    const prototypeStore = createCreativeStudioStore({
      rootDir,
      createId: () => projectId,
      now: () => timestamp,
    });
    return prototypeStore.createProject(makeInput({ name: 'Prototype project' }));
  };

  const protectPrototypeIndex = (): { fs: typeof nodeFs; accesses: string[] } => {
    const prototypeIndex = path.join(realpathSync(rootDir), 'projects.json');
    const accesses: string[] = [];
    const fs = new Proxy(nodeFs, {
      get(target, property, receiver) {
        const value = Reflect.get(target, property, receiver) as unknown;
        if (typeof value !== 'function') return value;
        return (...args: unknown[]): unknown => {
          const touchesPrototypeIndex = args.some((argument) => {
            if (typeof argument !== 'string') return false;
            const resolved = path.resolve(argument);
            return resolved === prototypeIndex || resolved.startsWith(`${prototypeIndex}.`);
          });
          if (touchesPrototypeIndex) {
            accesses.push(String(property));
            throw new Error(`schema-2 path accessed projects.json through ${String(property)}`);
          }
          return Reflect.apply(value, target, args);
        };
      },
    }) as typeof nodeFs;
    return { fs, accesses };
  };

  const createStoreV2 = (
    overrides: Omit<Parameters<typeof createCreativeStudioStore>[0], 'rootDir' | 'fs'> = {}
  ): { store: CreativeStudioStore; prototypeIndexAccesses: string[] } => {
    const protectedFs = protectPrototypeIndex();
    return {
      store: createCreativeStudioStore({
        rootDir,
        fs: protectedFs.fs,
        logError: () => undefined,
        ...overrides,
      }),
      prototypeIndexAccesses: protectedFs.accesses,
    };
  };

  const observeFileSystemMethods = (
    observedMethods: ReadonlySet<string>,
    baseFs: typeof nodeFs = nodeFs
  ): { fs: typeof nodeFs; calls: string[] } => {
    const calls: string[] = [];
    const fs = new Proxy(baseFs, {
      get(target, property, receiver) {
        const value = Reflect.get(target, property, receiver) as unknown;
        if (typeof property !== 'string' || typeof value !== 'function' || !observedMethods.has(property)) {
          return value;
        }
        return (...args: unknown[]): unknown => {
          calls.push(property);
          return Reflect.apply(value, target, args);
        };
      },
    }) as typeof nodeFs;
    return { fs, calls };
  };

  const makePosterProjectV2 = (id = 'poster_v2'): StudioProjectV2 => {
    const project = createEmptyStudioProjectV2(inputV2, id, timestamp);
    const shot: StudioShot = {
      id: 'clip_video',
      line: 'A launch vehicle crosses frame',
      derivation: 'derived',
      derivedFromActionRevision: 1,
      narration: '',
      onScreenText: '',
      durationSeconds: 4,
      trimInSeconds: null,
      trimOutSeconds: null,
      chainBreak: 'none',
      seedStillId: 'asset_seed',
      selectedTakeId: 'asset_video',
      assetIds: ['asset_seed', 'asset_video', 'asset_thumbnail'],
      jobIds: ['job_video'],
    };
    const seed: StudioAssetV2 = {
      id: 'asset_seed',
      projectId: id,
      shotId: shot.id,
      mediaKind: 'image',
      mimeType: 'image/png',
      managedAsset: { collection: 'imports', fileName: 'asset_seed.png' },
      byteSize: 1,
      sha256: 'c'.repeat(64),
      createdAt: timestamp,
    };
    const video: StudioAssetV2 = {
      id: 'asset_video',
      projectId: id,
      shotId: shot.id,
      mediaKind: 'video',
      mimeType: 'video/mp4',
      managedAsset: { collection: 'assets', fileName: 'asset_video.mp4' },
      byteSize: 1,
      sha256: 'a'.repeat(64),
      durationSeconds: 4,
      createdAt: timestamp,
    };
    const thumbnail: StudioAssetV2 = {
      id: 'asset_thumbnail',
      projectId: id,
      shotId: shot.id,
      mediaKind: 'image',
      mimeType: 'image/png',
      managedAsset: { collection: 'thumbnails', fileName: 'asset_thumbnail.png' },
      byteSize: 1,
      sha256: 'b'.repeat(64),
      createdAt: timestamp,
    };
    const requestPlan: StudioGenerationRequestPlan = {
      kind: 'resolved',
      snapshot: {
        prompt: 'A launch vehicle crosses frame',
        aspectRatio: '16:9',
        resolution: '1080p',
        durationSeconds: 4,
        referenceInput: null,
        conditioningInput: { kind: 'seed_still', assetId: seed.id },
      },
    };
    const item: StudioQuotedGeneration = {
      id: createStudioQuotedGenerationId({
        projectId: id,
        projectRevision: 1,
        shotId: shot.id,
        purpose: 'video_take',
      }),
      shotId: shot.id,
      purpose: 'video_take',
      routeId: 'video_route',
      generationCount: 1,
      requestPlan,
      rateUnit: 'second',
      rateMinorUnits: 2,
    };
    const totals = calculateStudioQuoteTotals([item])!;
    const provider = {
      providerId: 'provider_1',
      adapterId: 'byteplus-seedance-v1',
      model: 'model_1',
    } as const;
    const authorization: StudioSpendAuthorization = {
      id: 'authorization_video',
      projectId: id,
      projectRevision: 1,
      originReferenceHandoffId: null,
      rateCardDigest: 'd'.repeat(64),
      currency: 'USD',
      baseItems: [item],
      cascadeItems: [],
      lowerMinorUnits: totals.lowerMinorUnits,
      upperMinorUnits: totals.upperMinorUnits,
      expiresAt: '2026-08-17T12:05:00.000Z',
      confirmedAt: timestamp,
      providerBindings: [{ itemId: item.id, provider }],
      idempotencyKeys: [{ itemId: item.id, generationIndex: 0, key: 'idem_job_video' }],
    };
    const job: StudioJobV2 = {
      id: 'job_video',
      projectId: id,
      shotId: shot.id,
      status: 'succeeded',
      provider,
      idempotencyKey: 'idem_job_video',
      providerJobId: 'remote_job_video',
      remoteStartedAt: timestamp,
      cancellationPolicy: 'none',
      purpose: 'video_take',
      authorizationId: authorization.id,
      authorizationItemId: item.id,
      generationIndex: 0,
      requestPlan,
      requestSnapshot: requestPlan.snapshot,
      spendReceipt: {
        authorizationId: authorization.id,
        itemId: item.id,
        jobId: 'job_video',
        purpose: 'video_take',
        routeId: item.routeId,
        currency: authorization.currency,
        rateUnit: 'second',
        rateMinorUnits: item.rateMinorUnits,
        durationSeconds: 4,
        generationIndex: 0,
        generationCount: 1,
        totalMinorUnits: 8,
      },
      outputAssetIds: [video.id, thumbnail.id],
      outputAssetIdsByRole: { primary: video.id, poster: thumbnail.id },
      error: null,
      retryOfJobId: null,
      retryReason: null,
      duplicateChargeAcknowledged: false,
      duplicateChargeAcknowledgedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    project.beatOrder = ['section_1'];
    project.beats.section_1 = {
      id: 'section_1',
      title: 'Opening',
      action: '',
      look: '',
      actionRevision: 1,
      targetSeconds: null,
      shotOrder: [shot.id],
      lineHistory: [],
    };
    project.shots[shot.id] = shot;
    project.assets = { [seed.id]: seed, [video.id]: video, [thumbnail.id]: thumbnail };
    project.jobs[job.id] = job;
    project.spendAuthorizations = [authorization];
    project.revision = 2;
    return project;
  };

  beforeEach(() => {
    rootDir = mkdtempSync(path.join(tmpdir(), 'creative-studio-store-v2-'));
  });

  afterEach(() => {
    rmSync(rootDir, { recursive: true, force: true });
  });

  it('returns exact load discriminants without parsing a schema-1 payload as schema 2', async () => {
    const prototypeId = 'prototype_minimal';
    mkdirSync(path.join(rootDir, prototypeId));
    writeFileSync(
      path.join(rootDir, prototypeId, 'project.json'),
      JSON.stringify({ schemaVersion: 1, id: prototypeId, deliberatelyNotAProject: true })
    );
    const malformedId = 'malformed_v2';
    mkdirSync(path.join(rootDir, malformedId));
    writeFileSync(
      path.join(rootDir, malformedId, 'project.json'),
      JSON.stringify({ schemaVersion: 2, id: malformedId })
    );
    const project = createEmptyStudioProjectV2(inputV2, 'supported_v2', timestamp);
    seedProjectV2(project);
    const { store, prototypeIndexAccesses } = createStoreV2();

    const supported: StudioProjectStoreLoadResultV2 = { status: 'supported', project };
    const unsupported: StudioProjectStoreLoadResultV2 = {
      status: 'unsupported_prototype_schema',
      projectId: prototypeId,
    };
    const missing: StudioProjectStoreLoadResultV2 = { status: 'not_found', projectId: 'missing_v2' };
    await expect(store.getProjectV2(project.id)).resolves.toEqual(supported);
    await expect(store.getProjectV2(prototypeId)).resolves.toEqual(unsupported);
    await expect(store.getProjectV2('missing_v2')).resolves.toEqual(missing);
    await expect(store.getProjectV2(malformedId)).rejects.toMatchObject({ code: 'storage_error' });
    expect(prototypeIndexAccesses).toEqual([]);
  });

  it('classifies a reordered schema-1 manifest larger than the V2 cap without mutating its tree', async () => {
    const projectId = 'oversized_prototype_v1';
    const projectDirectory = path.join(rootDir, projectId);
    const projectFile = path.join(projectDirectory, 'project.json');
    mkdirSync(projectDirectory);
    const handle = await nodeFs.open(projectFile, 'wx');
    try {
      await handle.write('{"padding":"');
      const chunk = Buffer.alloc(1024 * 1024, 'x');
      for (let index = 0; index <= STUDIO_PROJECT_V2_MAX_RECORD_BYTES / chunk.length; index += 1) {
        // The fixture is deliberately streamed so the test never allocates the oversized record.
        // eslint-disable-next-line no-await-in-loop
        await handle.write(chunk);
      }
      await handle.write(
        `","deep":${'['.repeat(300)}0${']'.repeat(300)},"id":"${projectId}",\n  "schemaVersion" \t : 1.${'0'.repeat(130)}}`
      );
    } finally {
      await handle.close();
    }
    const before = await nodeFs.lstat(projectFile, { bigint: true });
    const rootEntriesBefore = readdirSync(rootDir).toSorted();
    const projectEntriesBefore = readdirSync(projectDirectory).toSorted();
    const protectedFs = protectPrototypeIndex();
    const mutations = observeFileSystemMethods(
      new Set(['appendFile', 'copyFile', 'link', 'mkdir', 'rename', 'rm', 'rmdir', 'truncate', 'unlink', 'writeFile']),
      protectedFs.fs
    );
    const store = createCreativeStudioStore({ rootDir, fs: mutations.fs, logError: () => undefined });

    expect(before.size).toBeGreaterThan(BigInt(STUDIO_PROJECT_V2_MAX_RECORD_BYTES));
    await expect(store.getProjectV2(projectId)).resolves.toEqual({
      status: 'unsupported_prototype_schema',
      projectId,
    });
    await expect(store.listProjectsV2()).resolves.toEqual({
      projects: [],
      unsupportedProjectIds: [projectId],
      quarantinedProjectIds: [],
    });
    await expect(store.inspectProjectsV2()).resolves.toEqual({
      supportedProjectIds: [],
      unsupportedProjectIds: [projectId],
      quarantinedProjectIds: [],
    });

    const after = await nodeFs.lstat(projectFile, { bigint: true });
    expect({ dev: after.dev, ino: after.ino, size: after.size, mtimeNs: after.mtimeNs }).toEqual({
      dev: before.dev,
      ino: before.ino,
      size: before.size,
      mtimeNs: before.mtimeNs,
    });
    expect(readdirSync(rootDir).toSorted()).toEqual(rootEntriesBefore);
    expect(readdirSync(projectDirectory).toSorted()).toEqual(projectEntriesBefore);
    expect(mutations.calls).toEqual([]);
    expect(protectedFs.accesses).toEqual([]);
  });

  it('rejects an oversized schema-2 manifest after a no-follow bounded schema sniff', async () => {
    const projectId = 'oversized_v2';
    const projectFilePath = path.join(rootDir, projectId, 'project.json');
    mkdirSync(path.dirname(projectFilePath));
    writeFileSync(
      projectFilePath,
      `{"schemaVersion":1,"payload":{"schemaVersion":1},"schemaVersion":2,"id":"${projectId}"}`
    );
    const projectFile = realpathSync(projectFilePath);
    const protectedFs = protectPrototypeIndex();
    let projectOpenCount = 0;
    let projectReadFileCount = 0;
    const boundedFs = new Proxy(protectedFs.fs, {
      get(target, property, receiver) {
        if (property === 'lstat') {
          return async (...args: Parameters<typeof nodeFs.lstat>) => {
            const stats = await nodeFs.lstat(...args);
            if (path.resolve(String(args[0])) !== projectFile) return stats;
            return new Proxy(stats, {
              get(statsTarget, statsProperty, statsReceiver) {
                if (statsProperty === 'size') return STUDIO_PROJECT_V2_MAX_RECORD_BYTES + 1;
                return Reflect.get(statsTarget, statsProperty, statsReceiver) as unknown;
              },
            });
          };
        }
        if (property === 'open') {
          return (...args: Parameters<typeof nodeFs.open>) => {
            if (path.resolve(String(args[0])) === projectFile) projectOpenCount += 1;
            return nodeFs.open(...args);
          };
        }
        if (property === 'readFile') {
          return (...args: Parameters<typeof nodeFs.readFile>) => {
            if (path.resolve(String(args[0])) === projectFile) projectReadFileCount += 1;
            return nodeFs.readFile(...args);
          };
        }
        return Reflect.get(target, property, receiver) as unknown;
      },
    }) as typeof nodeFs;
    const store = createCreativeStudioStore({ rootDir, fs: boundedFs });

    await expect(store.getProjectV2(projectId)).rejects.toMatchObject({ code: 'storage_error' });
    expect(projectOpenCount).toBe(1);
    expect(projectReadFileCount).toBe(0);
    expect(protectedFs.accesses).toEqual([]);
  });

  it.each([
    ['nested object and array grammar', '{"payload":[{}],"schemaVersion":1}'],
    ['a unicode escape in a root value', '{"padding":"\\u0041","schemaVersion":1}'],
    ['a unicode escape in a nested key', '{"payload":{"\\u0078":1},"schemaVersion":1}'],
    ['a unicode escape in a nested array value', '{"payload":["\\u0041"],"schemaVersion":1}'],
  ])('accepts valid %s before a root schema-1 member', async (_label, bytes) => {
    const projectId = 'oversized_nested_v1';
    const projectFilePath = path.join(rootDir, projectId, 'project.json');
    mkdirSync(path.dirname(projectFilePath));
    writeFileSync(projectFilePath, bytes);
    const projectFile = realpathSync(projectFilePath);
    const oversizedFs = new Proxy(nodeFs, {
      get(target, property, receiver) {
        if (property !== 'lstat') return Reflect.get(target, property, receiver) as unknown;
        return async (...args: Parameters<typeof nodeFs.lstat>) => {
          const stats = await nodeFs.lstat(...args);
          if (path.resolve(String(args[0])) !== projectFile) return stats;
          return new Proxy(stats, {
            get(statsTarget, statsProperty, statsReceiver) {
              if (statsProperty === 'size') return STUDIO_PROJECT_V2_MAX_RECORD_BYTES + 1;
              return Reflect.get(statsTarget, statsProperty, statsReceiver) as unknown;
            },
          });
        };
      },
    }) as typeof nodeFs;
    const store = createCreativeStudioStore({ rootDir, fs: oversizedFs });

    await expect(store.getProjectV2(projectId)).resolves.toEqual({
      status: 'unsupported_prototype_schema',
      projectId,
    });
  });

  it('keeps a million-level schema sniff compact while preserving exact nested grammar', async () => {
    const projectId = 'oversized_compact_stack_v1';
    const projectFilePath = path.join(rootDir, projectId, 'project.json');
    const depth = 1_000_000;
    mkdirSync(path.dirname(projectFilePath));
    writeFileSync(projectFilePath, `{"payload":${'['.repeat(depth)}0${']'.repeat(depth)},"schemaVersion":1}`);
    const projectFile = realpathSync(projectFilePath);
    const heapBefore = process.memoryUsage().heapUsed;
    let peakHeapGrowth = 0;
    const oversizedFs = new Proxy(nodeFs, {
      get(target, property, receiver) {
        if (property === 'lstat') {
          return async (...args: Parameters<typeof nodeFs.lstat>) => {
            const stats = await nodeFs.lstat(...args);
            if (path.resolve(String(args[0])) !== projectFile) return stats;
            return new Proxy(stats, {
              get(statsTarget, statsProperty, statsReceiver) {
                if (statsProperty === 'size') return STUDIO_PROJECT_V2_MAX_RECORD_BYTES + 1;
                return Reflect.get(statsTarget, statsProperty, statsReceiver) as unknown;
              },
            });
          };
        }
        if (property === 'open') {
          return async (...args: Parameters<typeof nodeFs.open>) => {
            const handle = await nodeFs.open(...args);
            if (path.resolve(String(args[0])) !== projectFile) return handle;
            return new Proxy(handle, {
              get(handleTarget, handleProperty, handleReceiver) {
                if (handleProperty !== 'read') {
                  const value = Reflect.get(handleTarget, handleProperty, handleReceiver) as unknown;
                  return typeof value === 'function' ? value.bind(handleTarget) : value;
                }
                return (...readArgs: Parameters<typeof handle.read>) => {
                  peakHeapGrowth = Math.max(peakHeapGrowth, process.memoryUsage().heapUsed - heapBefore);
                  return handle.read(...readArgs);
                };
              },
            });
          };
        }
        return Reflect.get(target, property, receiver) as unknown;
      },
    }) as typeof nodeFs;
    const store = createCreativeStudioStore({ rootDir, fs: oversizedFs });

    await expect(store.getProjectV2(projectId)).resolves.toEqual({
      status: 'unsupported_prototype_schema',
      projectId,
    });
    expect(peakHeapGrowth).toBeLessThan(24 * 1024 * 1024);
  });

  it.each([
    ['leading garbage', 'garbage{"schemaVersion":1}'],
    ['future-version value bait', '{"schemaVersion":3,"bait":"schemaVersion":1}'],
    ['missing root comma', '{"schemaVersion":1 "future":3}'],
    ['valid future version with quoted bait', '{"schemaVersion":3,"bait":"schemaVersion:1"}'],
    ['crossed nested delimiters', '{"payload":[{]},"schemaVersion":1}'],
    ['invalid nested literal', '{"payload":{"x":garbage},"schemaVersion":1}'],
    ['missing nested comma', '{"payload":[1 2],"schemaVersion":1}'],
  ])('rejects an oversized %s manifest instead of treating bait as schema 1', async (_label, bytes) => {
    const projectId = 'oversized_schema_bait';
    const projectFilePath = path.join(rootDir, projectId, 'project.json');
    mkdirSync(path.dirname(projectFilePath));
    writeFileSync(projectFilePath, bytes);
    const projectFile = realpathSync(projectFilePath);
    const oversizedFs = new Proxy(nodeFs, {
      get(target, property, receiver) {
        if (property !== 'lstat') return Reflect.get(target, property, receiver) as unknown;
        return async (...args: Parameters<typeof nodeFs.lstat>) => {
          const stats = await nodeFs.lstat(...args);
          if (path.resolve(String(args[0])) !== projectFile) return stats;
          return new Proxy(stats, {
            get(statsTarget, statsProperty, statsReceiver) {
              if (statsProperty === 'size') return STUDIO_PROJECT_V2_MAX_RECORD_BYTES + 1;
              return Reflect.get(statsTarget, statsProperty, statsReceiver) as unknown;
            },
          });
        };
      },
    }) as typeof nodeFs;
    const store = createCreativeStudioStore({ rootDir, fs: oversizedFs });

    await expect(store.getProjectV2(projectId)).rejects.toMatchObject({ code: 'storage_error' });
  });

  it('bounds an oversized schema sniff to the opened size before rejecting concurrent growth', async () => {
    const projectId = 'oversized_growing_v1';
    const projectFilePath = path.join(rootDir, projectId, 'project.json');
    mkdirSync(path.dirname(projectFilePath));
    writeFileSync(projectFilePath, JSON.stringify({ schemaVersion: 1, id: projectId }));
    const projectFile = realpathSync(projectFilePath);
    let readCount = 0;
    const growingFs = new Proxy(nodeFs, {
      get(target, property, receiver) {
        if (property === 'lstat') {
          return async (...args: Parameters<typeof nodeFs.lstat>) => {
            const stats = await nodeFs.lstat(...args);
            if (path.resolve(String(args[0])) !== projectFile || readCount > 0) return stats;
            return new Proxy(stats, {
              get(statsTarget, statsProperty, statsReceiver) {
                if (statsProperty === 'size') return STUDIO_PROJECT_V2_MAX_RECORD_BYTES + 1;
                return Reflect.get(statsTarget, statsProperty, statsReceiver) as unknown;
              },
            });
          };
        }
        if (property === 'open') {
          return async (...args: Parameters<typeof nodeFs.open>) => {
            const handle = await nodeFs.open(...args);
            if (path.resolve(String(args[0])) !== projectFile) return handle;
            return new Proxy(handle, {
              get(handleTarget, handleProperty, handleReceiver) {
                if (handleProperty !== 'read') {
                  const value = Reflect.get(handleTarget, handleProperty, handleReceiver) as unknown;
                  return typeof value === 'function' ? value.bind(handleTarget) : value;
                }
                return async (...readArgs: Parameters<typeof handle.read>) => {
                  readCount += 1;
                  if (readCount > 4) throw new Error('schema sniff did not honor the opened size');
                  const result = await handle.read(...readArgs);
                  writeFileSync(projectFile, ' ', { flag: 'a' });
                  return result;
                };
              },
            });
          };
        }
        return Reflect.get(target, property, receiver) as unknown;
      },
    }) as typeof nodeFs;
    const store = createCreativeStudioStore({ rootDir, fs: growingFs });

    await expect(store.getProjectV2(projectId)).rejects.toMatchObject({ code: 'storage_error' });
    expect(readCount).toBe(1);
  });

  it('rejects a symlink raced into the manifest name during the oversized schema sniff', async () => {
    const projectId = 'oversized_sniff_race_v1';
    const projectFilePath = path.join(rootDir, projectId, 'project.json');
    const outsideDirectory = mkdtempSync(path.join(tmpdir(), 'creative-studio-schema-sniff-race-'));
    const outsideFile = path.join(outsideDirectory, 'project.json');
    mkdirSync(path.dirname(projectFilePath));
    writeFileSync(projectFilePath, JSON.stringify({ schemaVersion: 1, id: projectId }));
    writeFileSync(outsideFile, JSON.stringify({ schemaVersion: 1, id: projectId, outside: true }));
    const projectFile = realpathSync(projectFilePath);
    const outsideBefore = readFileSync(outsideFile);
    let raced = false;
    const racedFs = new Proxy(nodeFs, {
      get(target, property, receiver) {
        if (property === 'lstat') {
          return async (...args: Parameters<typeof nodeFs.lstat>) => {
            const stats = await nodeFs.lstat(...args);
            if (path.resolve(String(args[0])) !== projectFile || raced) return stats;
            return new Proxy(stats, {
              get(statsTarget, statsProperty, statsReceiver) {
                if (statsProperty === 'size') return STUDIO_PROJECT_V2_MAX_RECORD_BYTES + 1;
                return Reflect.get(statsTarget, statsProperty, statsReceiver) as unknown;
              },
            });
          };
        }
        if (property === 'open') {
          return (...args: Parameters<typeof nodeFs.open>) => {
            if (path.resolve(String(args[0])) === projectFile && !raced) {
              raced = true;
              rmSync(projectFile);
              symlinkSync(outsideFile, projectFile);
            }
            return nodeFs.open(...args);
          };
        }
        return Reflect.get(target, property, receiver) as unknown;
      },
    }) as typeof nodeFs;
    const store = createCreativeStudioStore({ rootDir, fs: racedFs });

    try {
      await expect(store.getProjectV2(projectId)).rejects.toMatchObject({ code: 'storage_error' });
      expect(raced).toBe(true);
      expect(readFileSync(outsideFile)).toEqual(outsideBefore);
    } finally {
      await rm(outsideDirectory, { recursive: true, force: true });
    }
  });

  it('does not annex a pre-existing project directory that has sidecar data but no manifest', async () => {
    const projectId = 'reserved_v2';
    const projectDirectory = path.join(rootDir, projectId);
    const sidecarFile = path.join(projectDirectory, 'pending-command.sidecar');
    mkdirSync(projectDirectory);
    writeFileSync(sidecarFile, Buffer.from([0, 1, 2, 254, 255]));
    const rootEntriesBefore = readdirSync(rootDir).toSorted();
    const projectEntriesBefore = readdirSync(projectDirectory).toSorted();
    const sidecarBytesBefore = readFileSync(sidecarFile);
    const protectedFs = protectPrototypeIndex();
    const mutations = observeFileSystemMethods(
      new Set(['mkdir', 'open', 'rename', 'rm', 'rmdir', 'truncate', 'unlink', 'writeFile']),
      protectedFs.fs
    );
    const store = createCreativeStudioStore({
      rootDir,
      fs: mutations.fs,
      createId: () => projectId,
      now: () => timestamp,
    });

    await expect(store.createProjectV2(inputV2)).rejects.toMatchObject({ code: 'invalid_payload' });

    expect(readdirSync(rootDir).toSorted()).toEqual(rootEntriesBefore);
    expect(readdirSync(projectDirectory).toSorted()).toEqual(projectEntriesBefore);
    expect(readFileSync(sidecarFile)).toEqual(sidecarBytesBefore);
    expect(existsSync(path.join(projectDirectory, 'project.json'))).toBe(false);
    expect(existsSync(path.join(rootDir, 'projects-v2.json'))).toBe(false);
    expect(mutations.calls).toEqual([]);
    expect(protectedFs.accesses).toEqual([]);
  });

  it('allows exactly one winner when two stores concurrently create the same generated project ID', async () => {
    const projectId = 'concurrent_v2';
    const leftInput = { ...inputV2, name: 'Left contender', brief: 'Created by the left store' };
    const rightInput = { ...inputV2, name: 'Right contender', brief: 'Created by the right store' };
    const left = createStoreV2({ createId: () => projectId, now: () => timestamp });
    const right = createStoreV2({ createId: () => projectId, now: () => timestamp });

    const outcomes = await Promise.allSettled([
      left.store.createProjectV2(leftInput),
      right.store.createProjectV2(rightInput),
    ]);
    const fulfilled = outcomes.filter(
      (outcome): outcome is PromiseFulfilledResult<StudioProjectV2> => outcome.status === 'fulfilled'
    );
    const rejected = outcomes.filter((outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toMatchObject({ code: 'invalid_payload' });
    const winner = fulfilled[0]!.value;
    const summary = {
      id: projectId,
      name: winner.name,
      aspectRatio: winner.aspectRatio,
      targetDurationSeconds: winner.targetDurationSeconds,
      resolution: winner.resolution,
      beatCount: 0,
      shotCount: 0,
      selectedTakeCount: 0,
      createdAt: winner.createdAt,
      updatedAt: winner.updatedAt,
    };
    expect(readJson<StudioProjectV2>(path.join(rootDir, projectId, 'project.json'))).toEqual(winner);
    expect(readJson(path.join(rootDir, 'projects-v2.json'))).toEqual({ schemaVersion: 2, projects: [summary] });
    const restarted = createStoreV2().store;
    await expect(restarted.getProjectV2(projectId)).resolves.toEqual({ status: 'supported', project: winner });
    await expect(restarted.listProjectsV2()).resolves.toEqual({
      projects: [summary],
      unsupportedProjectIds: [],
      quarantinedProjectIds: [],
    });
    expect(left.prototypeIndexAccesses).toEqual([]);
    expect(right.prototypeIndexAccesses).toEqual([]);
  });

  it('validates create input before creating or writing an absent storage root', async () => {
    const absentRoot = path.join(rootDir, 'absent-store');
    const mutations = observeFileSystemMethods(new Set(['mkdir', 'open', 'rename', 'rm', 'writeFile']));
    const store = createCreativeStudioStore({
      rootDir: absentRoot,
      fs: mutations.fs,
      createId: () => 'invalid_input_v2',
      now: () => timestamp,
    });
    const invalidInput = { ...inputV2, unexpected: true } as CreateStudioProjectInputV2;

    await expect(store.createProjectV2(invalidInput)).rejects.toMatchObject({ code: 'invalid_payload' });

    expect(mutations.calls).toEqual([]);
    expect(existsSync(absentRoot)).toBe(false);
  });

  it('rejects oversized generated and caller project IDs before any filesystem path access', async () => {
    const oversizedId = 'p'.repeat(257);
    const pathAccesses = observeFileSystemMethods(
      new Set([
        'access',
        'appendFile',
        'chmod',
        'chown',
        'copyFile',
        'cp',
        'link',
        'lstat',
        'mkdir',
        'open',
        'readFile',
        'readdir',
        'readlink',
        'realpath',
        'rename',
        'rm',
        'rmdir',
        'stat',
        'symlink',
        'truncate',
        'unlink',
        'utimes',
        'writeFile',
      ])
    );
    const store = createCreativeStudioStore({
      rootDir,
      fs: pathAccesses.fs,
      createId: () => oversizedId,
      now: () => timestamp,
    });
    const oversizedBatch: StudioMutationBatchV2 = {
      schemaVersion: 2,
      projectId: oversizedId,
      expectedRevision: 1,
      operations: [{ kind: 'set_brief', brief: 'must not reach storage' }],
    };

    await expect(store.createProjectV2(inputV2)).rejects.toMatchObject({ code: 'invalid_payload' });
    await expect(store.getProjectV2(oversizedId)).resolves.toEqual({ status: 'not_found', projectId: oversizedId });
    await expect(store.applyMutationBatchV2(oversizedBatch, makeMutationContextV2())).rejects.toMatchObject({
      code: 'invalid_payload',
    });
    await expect(store.deleteProjectV2(oversizedId, 1)).resolves.toBe(false);
    expect(pathAccesses.calls).toEqual([]);
  });

  it('scans schema-2 manifests sequentially with one bounded read handle at a time', async () => {
    const projectIds = ['scan_a', 'scan_b', 'scan_c'];
    for (const projectId of projectIds) seedProjectV2(createEmptyStudioProjectV2(inputV2, projectId, timestamp));
    let activeManifestHandles = 0;
    let maxConcurrentManifestHandles = 0;
    const sequentialFs = new Proxy(nodeFs, {
      get(target, property, receiver) {
        if (property !== 'open') return Reflect.get(target, property, receiver);
        return async (...args: Parameters<typeof nodeFs.open>) => {
          const file = path.resolve(String(args[0]));
          const handle = await nodeFs.open(...args);
          if (!file.endsWith(`${path.sep}project.json`)) return handle;
          activeManifestHandles += 1;
          maxConcurrentManifestHandles = Math.max(maxConcurrentManifestHandles, activeManifestHandles);
          let closed = false;
          return new Proxy(handle, {
            get(handleTarget, handleProperty, handleReceiver) {
              const value = Reflect.get(handleTarget, handleProperty, handleReceiver) as unknown;
              if (typeof value !== 'function') return value;
              if (handleProperty === 'read') {
                return async (...readArgs: unknown[]) => {
                  await new Promise<void>((resolve) => setTimeout(resolve, 10));
                  return Reflect.apply(value, handleTarget, readArgs);
                };
              }
              if (handleProperty === 'close') {
                return async (...closeArgs: unknown[]): Promise<void> => {
                  try {
                    await Reflect.apply(value, handleTarget, closeArgs);
                  } finally {
                    if (!closed) {
                      closed = true;
                      activeManifestHandles -= 1;
                    }
                  }
                };
              }
              return value.bind(handleTarget);
            },
          });
        };
      },
    }) as typeof nodeFs;
    const store = createCreativeStudioStore({ rootDir, fs: sequentialFs });

    await expect(store.inspectProjectsV2()).resolves.toEqual({
      supportedProjectIds: projectIds,
      unsupportedProjectIds: [],
      quarantinedProjectIds: [],
    });
    expect(maxConcurrentManifestHandles).toBe(1);
    expect(activeManifestHandles).toBe(0);
  });

  it('keeps an absent storage root read-only while reporting empty and missing results', async () => {
    const absentRoot = path.join(rootDir, 'absent-read-store');
    const store = createCreativeStudioStore({ rootDir: absentRoot });

    await expect(store.inspectProjectsV2()).resolves.toEqual({
      supportedProjectIds: [],
      unsupportedProjectIds: [],
      quarantinedProjectIds: [],
    });
    await expect(store.listProjectsV2()).resolves.toEqual({
      projects: [],
      unsupportedProjectIds: [],
      quarantinedProjectIds: [],
    });
    await expect(store.getProjectV2('missing_v2')).resolves.toEqual({
      status: 'not_found',
      projectId: 'missing_v2',
    });
    expect(existsSync(absentRoot)).toBe(false);
  });

  it('does not create absent storage while rejecting and ignoring missing mutations', async () => {
    const absentRoot = path.join(rootDir, 'absent-mutation-store');
    const store = createCreativeStudioStore({ rootDir: absentRoot });

    await expect(
      store.applyMutationBatchV2(makeBoundaryMutationBatchV2('missing_v2'), makeMutationContextV2())
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(store.deleteProjectV2('missing_v2', 1)).resolves.toBe(false);
    expect(existsSync(absentRoot)).toBe(false);
  });

  it('rejects malformed create arguments before allocating storage', async () => {
    const absentRoot = path.join(rootDir, 'absent-create-store');
    const createId = vi.fn(() => 'generated_v2');
    const store = createCreativeStudioStore({ rootDir: absentRoot, createId, now: () => timestamp });

    await expect(store.createProjectV2(null as never)).rejects.toMatchObject({ code: 'invalid_payload' });
    await expect(
      store.createProjectV2({ ...inputV2, id: 'caller_v2' } as CreateStudioProjectInputV2)
    ).rejects.toMatchObject({ code: 'invalid_payload' });
    expect(createId).not.toHaveBeenCalled();
    expect(existsSync(absentRoot)).toBe(false);
  });

  it('rejects invalid mutation revisions before consulting storage', async () => {
    const absentRoot = path.join(rootDir, 'absent-revision-store');
    const store = createCreativeStudioStore({ rootDir: absentRoot });

    await expect(
      store.applyMutationBatchV2(makeBoundaryMutationBatchV2('missing_v2', 0), makeMutationContextV2())
    ).rejects.toMatchObject({ code: 'invalid_payload' });
    await expect(store.deleteProjectV2('missing_v2', 0)).rejects.toMatchObject({ code: 'invalid_payload' });
    expect(existsSync(absentRoot)).toBe(false);
  });

  it('requires an exact reducer context before queueing or consulting storage', async () => {
    const absentRoot = path.join(rootDir, 'absent-context-store');
    const mutations = observeFileSystemMethods(
      new Set(['access', 'mkdir', 'open', 'readFile', 'readdir', 'rename', 'rm', 'stat', 'writeFile'])
    );
    const store = createCreativeStudioStore({ rootDir: absentRoot, fs: mutations.fs });
    const batch = makeBoundaryMutationBatchV2('missing_v2');
    const invokeWithoutContext = store.applyMutationBatchV2 as unknown as (
      input: StudioMutationBatchV2
    ) => Promise<unknown>;
    const symbolContext = { ...makeMutationContextV2(), [Symbol('unexpected')]: true };
    const invalidContexts: unknown[] = [
      null,
      {},
      { mutationId: '../unsafe', capturedAt: timestamp },
      { mutationId: 'mutation_bad_time', capturedAt: '2026-08-17' },
      { ...makeMutationContextV2(), unexpected: true },
      symbolContext,
    ];

    await expect(invokeWithoutContext(batch)).rejects.toMatchObject({ code: 'invalid_payload' });
    for (const context of invalidContexts) {
      await expect(store.applyMutationBatchV2(batch, context as StudioMutationReducerContextV2)).rejects.toMatchObject({
        code: 'invalid_payload',
      });
    }

    expect(mutations.calls).toEqual([]);
    expect(existsSync(absentRoot)).toBe(false);
  });

  it('distinguishes absent manifests in an existing storage root', async () => {
    const { store, prototypeIndexAccesses } = createStoreV2();

    await expect(
      store.applyMutationBatchV2(makeBoundaryMutationBatchV2('missing_v2'), makeMutationContextV2())
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(store.deleteProjectV2('missing_v2', 1)).resolves.toBe(false);
    expect(prototypeIndexAccesses).toEqual([]);
  });

  it('refuses prototype and malformed manifests through mutation entry points', async () => {
    mkdirSync(path.join(rootDir, 'prototype_boundary_v1'));
    mkdirSync(path.join(rootDir, 'malformed_boundary_v2'));
    writeFileSync(
      path.join(rootDir, 'prototype_boundary_v1', 'project.json'),
      JSON.stringify({ schemaVersion: 1, id: 'prototype_boundary_v1' })
    );
    writeFileSync(
      path.join(rootDir, 'malformed_boundary_v2', 'project.json'),
      JSON.stringify({ schemaVersion: 2, id: 'malformed_boundary_v2' })
    );
    const { store, prototypeIndexAccesses } = createStoreV2();

    await expect(
      store.applyMutationBatchV2(makeBoundaryMutationBatchV2('prototype_boundary_v1'), makeMutationContextV2())
    ).rejects.toMatchObject({ code: 'unsupported_prototype_schema' });
    await expect(
      store.applyMutationBatchV2(makeBoundaryMutationBatchV2('malformed_boundary_v2'), makeMutationContextV2())
    ).rejects.toMatchObject({ code: 'storage_error' });
    await expect(store.deleteProjectV2('malformed_boundary_v2', 1)).rejects.toMatchObject({ code: 'storage_error' });
    expect(prototypeIndexAccesses).toEqual([]);
  });

  it('records an omitted commit tag and rejects deletion with the previous revision', async () => {
    const onProjectCommitted = vi.fn();
    const { store, prototypeIndexAccesses } = createStoreV2({
      createId: () => 'committed_boundary_v2',
      now: () => timestamp,
      onProjectCommitted,
    });
    const project = await store.createProjectV2(inputV2);

    const applied = await store.applyMutationBatchV2(
      makeBoundaryMutationBatchV2(project.id, project.revision),
      makeMutationContextV2()
    );

    expect(applied.project.revision).toBe(project.revision + 1);
    expect(onProjectCommitted).toHaveBeenLastCalledWith(expect.objectContaining({ commitTag: null }));
    await expect(store.deleteProjectV2(project.id, project.revision)).rejects.toMatchObject({ code: 'stale_project' });
    expect(prototypeIndexAccesses).toEqual([]);
  });

  it('snapshots reducer context before queue work and ignores later caller mutation', async () => {
    const { store } = createStoreV2({ createId: () => 'context_snapshot_v2', now: () => timestamp });
    const project = await store.createProjectV2(inputV2);
    const context = makeMutationContextV2({
      mutationId: 'mutation_context_snapshot',
      capturedAt: '2026-08-17T12:34:56.000Z',
    });
    const pending = store.applyMutationBatchV2(
      makeStudioMutationBatchV2(project, [
        {
          kind: 'set_rules',
          rules: [{ id: 'rule_1', text: 'Keep the logo visible', predicate: null }],
        },
      ]),
      context
    );

    context.mutationId = 'mutation_changed_after_call';
    context.capturedAt = '2026-08-17T23:59:59.000Z';
    const applied = await pending;

    expect(applied.project.rules).toEqual([
      {
        id: 'rule_1',
        scope: 'project',
        text: 'Keep the logo visible',
        predicate: null,
        createdAt: '2026-08-17T12:34:56.000Z',
      },
    ]);
    expect(applied.project.undoHistory.at(-1)).toMatchObject({
      id: 'mutation_context_snapshot',
      sourceRevision: project.revision + 1,
    });
  });

  it('snapshots the complete mutation batch before selecting its project queue', async () => {
    const ids = ['batch_snapshot_a_v2', 'batch_snapshot_b_v2'];
    const { store } = createStoreV2({
      createId: () => ids.shift() ?? 'unexpected_batch_snapshot',
      now: () => timestamp,
    });
    const firstProject = await store.createProjectV2(inputV2);
    const secondProject = await store.createProjectV2(inputV2);
    const revalidationStarted = createDeferredV2<void>();
    const releaseRevalidation = createDeferredV2<void>();
    const expectedFailure = new Error('release the project queue without a commit');
    const blocker = store.confirmProjectV2({
      projectId: firstProject.id,
      expectedRevision: firstProject.revision,
      expiresAt: '2026-08-17T12:05:00.000Z',
      async revalidate() {
        revalidationStarted.resolve(undefined);
        await releaseRevalidation.promise;
        throw expectedFailure;
      },
      assertActive: () => undefined,
      buildCommit: (project) => ({ project, dispatch: null }),
    });
    await revalidationStarted.promise;
    const batch = makeStudioMutationBatchV2(firstProject, [{ kind: 'set_brief', brief: 'Original batch' }]);
    const pending = store.applyMutationBatchV2(batch, makeMutationContextV2({ mutationId: 'mutation_batch_snapshot' }));

    batch.projectId = secondProject.id;
    (batch.operations[0] as { kind: 'set_brief'; brief: string }).brief = 'Caller mutation';
    releaseRevalidation.resolve(undefined);

    await expect(blocker).rejects.toBe(expectedFailure);
    await expect(pending).resolves.toMatchObject({ project: { id: firstProject.id, brief: 'Original batch' } });
    await expect(store.getProjectV2(secondProject.id)).resolves.toMatchObject({
      status: 'supported',
      project: { id: secondProject.id, brief: secondProject.brief, revision: secondProject.revision },
    });
  });

  it.each(['mutation', 'update', 'confirmation'] as const)(
    'CAS-fences a schema-2 %s write against a same-revision project replacement',
    async (operation) => {
      const projectId = `ordinary_cas_${operation}_v2`;
      const projectDirectory = path.join(realpathSync(rootDir), projectId);
      const projectFile = path.join(projectDirectory, 'project.json');
      const onProjectCommitted = vi.fn<StudioProjectCommitObserver>();
      let armed = false;
      let replaced = false;
      let externalBytes = '';
      const racingFs = new Proxy(nodeFs, {
        get(target, property, receiver) {
          const value = Reflect.get(target, property, receiver) as unknown;
          if (property !== 'open' || typeof value !== 'function') return value;
          return async (...args: Parameters<typeof nodeFs.open>) => {
            const handle = await nodeFs.open(...args);
            const opened = String(args[0]);
            if (armed && !replaced && opened.startsWith(`${projectFile}.`) && opened.endsWith('.tmp')) {
              const replacement = `${projectFile}.external`;
              writeFileSync(replacement, externalBytes);
              renameSync(replacement, projectFile);
              replaced = true;
            }
            return handle;
          };
        },
      }) as typeof nodeFs;
      const store = createCreativeStudioStore({
        rootDir,
        fs: racingFs,
        createId: () => projectId,
        now: () => timestamp,
        logError: () => undefined,
        onProjectCommitted,
      });
      const project = await store.createProjectV2(inputV2);
      const replacement: StudioProjectV2 = { ...project, name: `External ${operation} winner` };
      externalBytes = `${JSON.stringify(replacement, null, 2)}\n`;
      const indexFile = path.join(rootDir, 'projects-v2.json');
      const indexBefore = readFileSync(indexFile);
      armed = true;

      const attempt =
        operation === 'mutation'
          ? store.applyMutationBatchV2(
              makeStudioMutationBatchV2(project, [{ kind: 'set_brief', brief: 'Must not overwrite' }]),
              makeMutationContextV2({ mutationId: 'mutation_ordinary_cas' })
            )
          : operation === 'update'
            ? store.updateProjectV2(
                project.id,
                (candidate) => ({ ...candidate, brief: 'Must not overwrite' }),
                project.revision
              )
            : store.confirmProjectV2({
                projectId: project.id,
                expectedRevision: project.revision,
                expiresAt: '2026-08-17T12:05:00.000Z',
                revalidate: async () => ({ routeId: 'video_route' }),
                assertActive: () => undefined,
                buildCommit: (candidate) => ({
                  project: { ...candidate, brief: 'Must not overwrite' },
                  dispatch: { jobIds: ['job_ordinary_cas'] },
                }),
              });

      await expect(attempt).rejects.toMatchObject({ code: 'storage_error' });
      expect(replaced).toBe(true);
      expect(readFileSync(projectFile, 'utf8')).toBe(externalBytes);
      expect(readFileSync(indexFile)).toEqual(indexBefore);
      expect(onProjectCommitted).not.toHaveBeenCalled();
      await expect(store.getProjectV2(project.id)).resolves.toMatchObject({
        status: 'supported',
        project: { name: replacement.name, revision: project.revision },
      });
    }
  );

  it('refuses stale and same-context replay without rewriting or observing a second commit', async () => {
    const onProjectCommitted = vi.fn<StudioProjectCommitObserver>();
    const { store } = createStoreV2({
      createId: () => 'context_replay_v2',
      now: () => timestamp,
      onProjectCommitted,
    });
    const project = await store.createProjectV2(inputV2);
    const context = makeMutationContextV2({ mutationId: 'mutation_replay' });
    const originalBatch = makeStudioMutationBatchV2(project, [{ kind: 'set_brief', brief: 'Applied once' }]);
    const first = await store.applyMutationBatchV2(originalBatch, context);
    const projectFile = path.join(rootDir, project.id, 'project.json');
    const indexFile = path.join(rootDir, 'projects-v2.json');
    const committedProjectBytes = readFileSync(projectFile);
    const committedIndexBytes = readFileSync(indexFile);

    await expect(store.applyMutationBatchV2(originalBatch, context)).rejects.toMatchObject({
      code: 'stale_project',
    });
    await expect(
      store.applyMutationBatchV2({ ...originalBatch, expectedRevision: first.project.revision }, context)
    ).rejects.toMatchObject({ reasonCode: 'identity_collision' });

    expect(readFileSync(projectFile)).toEqual(committedProjectBytes);
    expect(readFileSync(indexFile)).toEqual(committedIndexBytes);
    expect(onProjectCommitted).toHaveBeenCalledTimes(1);
  });

  it('serializes same-revision V2 batches so exactly one context reaches the reducer commit', async () => {
    const onProjectCommitted = vi.fn<StudioProjectCommitObserver>();
    const { store } = createStoreV2({
      createId: () => 'context_cas_v2',
      now: () => timestamp,
      onProjectCommitted,
    });
    const project = await store.createProjectV2(inputV2);
    const outcomes = await Promise.allSettled([
      store.applyMutationBatchV2(
        makeStudioMutationBatchV2(project, [{ kind: 'set_brief', brief: 'Left winner' }]),
        makeMutationContextV2({ mutationId: 'mutation_left' })
      ),
      store.applyMutationBatchV2(
        makeStudioMutationBatchV2(project, [{ kind: 'set_brief', brief: 'Right winner' }]),
        makeMutationContextV2({ mutationId: 'mutation_right' })
      ),
    ]);
    const fulfilled = outcomes.filter(
      (outcome): outcome is PromiseFulfilledResult<StudioMutationApplyResultV2> => outcome.status === 'fulfilled'
    );
    const rejected = outcomes.filter((outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toMatchObject({ code: 'stale_project' });
    await expect(store.getProjectV2(project.id)).resolves.toMatchObject({
      status: 'supported',
      project: { revision: project.revision + 1, brief: fulfilled[0]!.value.project.brief },
    });
    expect(onProjectCommitted).toHaveBeenCalledTimes(1);
  });

  it('rejects a symlinked project identity during inventory inspection', async () => {
    const backingDirectory = path.join(rootDir, '.inventory-symlink-backing');
    mkdirSync(backingDirectory);
    symlinkSync(backingDirectory, path.join(rootDir, 'unsafe_inventory_v2'), 'dir');
    const { store, prototypeIndexAccesses } = createStoreV2();

    await expect(store.inspectProjectsV2()).rejects.toMatchObject({ code: 'storage_error' });
    expect(prototypeIndexAccesses).toEqual([]);
  });

  it('creates an exact empty project in projects-v2.json and reloads it after restart', async () => {
    const { store, prototypeIndexAccesses } = createStoreV2({
      createId: () => 'created_v2',
      now: () => timestamp,
    });

    const project = await store.createProjectV2(inputV2);

    expect(project).toEqual(createEmptyStudioProjectV2(inputV2, 'created_v2', timestamp));
    expect(existsSync(path.join(rootDir, 'projects.json'))).toBe(false);
    expect(readJson(path.join(rootDir, 'projects-v2.json'))).toEqual({
      schemaVersion: 2,
      projects: [
        {
          id: project.id,
          name: 'Schema Two Film',
          aspectRatio: '16:9',
          targetDurationSeconds: 30,
          resolution: '1080p',
          beatCount: 0,
          shotCount: 0,
          selectedTakeCount: 0,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      ],
    });

    const restarted = createStoreV2().store;
    await expect(restarted.getProjectV2(project.id)).resolves.toEqual({ status: 'supported', project });
    await expect(restarted.listProjectsV2()).resolves.toEqual({
      projects: [expect.objectContaining({ id: project.id, beatCount: 0, shotCount: 0 })],
      unsupportedProjectIds: [],
      quarantinedProjectIds: [],
    });
    expect(prototypeIndexAccesses).toEqual([]);
  });

  it.each([
    ['missing', null],
    [
      'stale',
      JSON.stringify({
        schemaVersion: 2,
        projects: [
          {
            id: 'phantom_v2',
            name: 'Phantom project',
            aspectRatio: '9:16',
            targetDurationSeconds: 99,
            resolution: '4k',
            beatCount: 9,
            shotCount: 9,
            selectedTakeCount: 9,
            createdAt: timestamp,
            updatedAt: timestamp,
          },
        ],
      }),
    ],
    ['corrupt', '{not-json'],
    ['wrong schema', JSON.stringify({ schemaVersion: 1, projects: [] })],
  ])('repairs a %s schema-2 index from classified manifests only', async (_label, indexBytes) => {
    const prototype = await seedPrototypeProject();
    const project = createEmptyStudioProjectV2(inputV2, 'healthy_v2', timestamp);
    seedProjectV2(project);
    const malformedId = 'broken_v2';
    mkdirSync(path.join(rootDir, malformedId));
    writeFileSync(
      path.join(rootDir, malformedId, 'project.json'),
      JSON.stringify({ schemaVersion: 2, id: malformedId })
    );
    if (indexBytes !== null) writeFileSync(path.join(rootDir, 'projects-v2.json'), indexBytes);
    const prototypeIndexBefore = readFileSync(path.join(rootDir, 'projects.json'));
    const { store, prototypeIndexAccesses } = createStoreV2();
    const expectedSummary = {
      id: project.id,
      name: project.name,
      aspectRatio: project.aspectRatio,
      targetDurationSeconds: project.targetDurationSeconds,
      resolution: project.resolution,
      beatCount: 0,
      shotCount: 0,
      selectedTakeCount: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    await expect(store.listProjectsV2()).resolves.toEqual({
      projects: [expectedSummary],
      unsupportedProjectIds: [prototype.id],
      quarantinedProjectIds: [malformedId],
    });
    expect(readJson(path.join(rootDir, 'projects-v2.json'))).toEqual({
      schemaVersion: 2,
      projects: [expectedSummary],
    });
    expect(readFileSync(path.join(rootDir, 'projects.json'))).toEqual(prototypeIndexBefore);
    expect(prototypeIndexAccesses).toEqual([]);
  });

  it('lists schema-1 separately and persists the exact active video poster summary', async () => {
    const prototype = await seedPrototypeProject();
    const project = makePosterProjectV2();
    seedProjectV2(project);
    writeFileSync(path.join(rootDir, 'projects-v2.json'), JSON.stringify({ schemaVersion: 2, projects: [] }));
    const { store, prototypeIndexAccesses } = createStoreV2();
    const summary = {
      id: project.id,
      name: project.name,
      aspectRatio: '16:9',
      targetDurationSeconds: 30,
      resolution: '1080p',
      beatCount: 1,
      shotCount: 1,
      selectedTakeCount: 1,
      poster: {
        beatId: 'section_1',
        shotId: 'clip_video',
        assetId: 'asset_thumbnail',
        beatPosition: 1,
        shotPosition: 1,
      },
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    await expect(store.listProjectsV2()).resolves.toEqual({
      projects: [summary],
      unsupportedProjectIds: [prototype.id],
      quarantinedProjectIds: [],
    });
    expect(readJson(path.join(rootDir, 'projects-v2.json'))).toEqual({ schemaVersion: 2, projects: [summary] });
    expect(prototypeIndexAccesses).toEqual([]);
  });

  it('rolls back an earlier operation when a later operation fails', async () => {
    const onProjectCommitted = vi.fn<StudioProjectCommitObserver>();
    const { store } = createStoreV2({ createId: () => 'rollback_v2', now: () => timestamp, onProjectCommitted });
    const project = await store.createProjectV2(inputV2);
    const projectFile = path.join(rootDir, project.id, 'project.json');
    const indexFile = path.join(rootDir, 'projects-v2.json');
    const beforeProject = readFileSync(projectFile);
    const beforeIndex = readFileSync(indexFile);

    await expect(
      store.applyMutationBatchV2(
        makeStudioMutationBatchV2(project, [
          { kind: 'set_brief', brief: 'must roll back' },
          { kind: 'delete_shot', shotId: 'missing_clip' },
        ]),
        makeMutationContextV2({ mutationId: 'mutation_rollback' }),
        'rollback/test'
      )
    ).rejects.toMatchObject({ reasonCode: 'invalid_operation' });

    expect(readFileSync(projectFile)).toEqual(beforeProject);
    expect(readFileSync(indexFile)).toEqual(beforeIndex);
    expect(onProjectCommitted).not.toHaveBeenCalled();
  });

  it('rejects stale mutation authority before writing or observing', async () => {
    const onProjectCommitted = vi.fn<StudioProjectCommitObserver>();
    const { store } = createStoreV2({ createId: () => 'stale_v2', now: () => timestamp, onProjectCommitted });
    const project = await store.createProjectV2(inputV2);
    const projectFile = path.join(rootDir, project.id, 'project.json');
    const indexFile = path.join(rootDir, 'projects-v2.json');
    const beforeProject = readFileSync(projectFile);
    const beforeIndex = readFileSync(indexFile);

    await expect(
      store.applyMutationBatchV2(
        makeStudioMutationBatchV2(project, [{ kind: 'set_brief', brief: 'stale write' }], project.revision + 1),
        makeMutationContextV2({ mutationId: 'mutation_stale' }),
        'stale/test'
      )
    ).rejects.toMatchObject({ code: 'stale_project' });

    expect(readFileSync(projectFile)).toEqual(beforeProject);
    expect(readFileSync(indexFile)).toEqual(beforeIndex);
    expect(onProjectCommitted).not.toHaveBeenCalled();
  });

  it('commits a multi-operation batch as one revision and one frozen observer fact', async () => {
    const facts: Parameters<StudioProjectCommitObserver>[0][] = [];
    const events: string[] = [];
    let clock = Date.parse(timestamp);
    const canonicalRoot = realpathSync(rootDir);
    const committedProjectDirectory = path.join(canonicalRoot, 'committed_v2');
    const protectedFs = protectPrototypeIndex();
    const trackingFs = new Proxy(protectedFs.fs, {
      get(target, property, receiver) {
        if (property === 'rename') {
          return async (...args: Parameters<typeof nodeFs.rename>): ReturnType<typeof nodeFs.rename> => {
            const destination = path.resolve(String(args[1]));
            await protectedFs.fs.rename(...args);
            if (destination.endsWith(`${path.sep}project.json`)) events.push('project-rename');
            if (destination === path.join(canonicalRoot, 'projects-v2.json')) events.push('index-rename');
          };
        }
        if (property !== 'open') return Reflect.get(target, property, receiver);
        return async (...args: Parameters<typeof nodeFs.open>) => {
          const file = path.resolve(String(args[0]));
          const handle = await protectedFs.fs.open(...args);
          return new Proxy(handle, {
            get(handleTarget, handleProperty, handleReceiver) {
              if (handleProperty === 'sync' && file === committedProjectDirectory) {
                return async (): Promise<void> => {
                  await handleTarget.sync();
                  events.push('project-directory-sync');
                };
              }
              const value = Reflect.get(handleTarget, handleProperty, handleReceiver) as unknown;
              return typeof value === 'function' ? value.bind(handleTarget) : value;
            },
          });
        };
      },
    }) as typeof nodeFs;
    const store = createCreativeStudioStore({
      rootDir,
      fs: trackingFs,
      createId: () => 'committed_v2',
      now: () => new Date((clock += 1_000)).toISOString(),
      logError: () => undefined,
      onProjectCommitted: (fact) => {
        events.push('observer');
        facts.push(fact);
      },
    });
    const project = await store.createProjectV2(inputV2);
    events.length = 0;

    const result = await store.applyMutationBatchV2(
      makeStudioMutationBatchV2(project, [
        {
          kind: 'add_beat',
          beatId: 'section_new',
          beat: { title: 'First title', action: '', look: '', targetSeconds: null },
          beforeBeatId: null,
        },
        {
          kind: 'add_shot',
          beatId: 'section_new',
          shotId: 'clip_new',
          shot: { line: '', narration: '', onScreenText: '', durationSeconds: 4 },
          beforeShotId: null,
        },
        { kind: 'edit_beat', beatId: 'section_new', changes: { title: 'Final title' } },
      ]),
      makeMutationContextV2({ mutationId: 'mutation_committed', capturedAt: '2026-08-17T12:00:01.000Z' }),
      'opaque/task-3-tag'
    );

    expect(result.project).toMatchObject({ revision: project.revision + 1, brief: project.brief });
    expect(result.project.beats.section_new?.title).toBe('Final title');
    expect(result.createdBeatIds).toEqual(['section_new']);
    expect(result.createdShotIds).toEqual(['clip_new']);
    expect(facts).toEqual([
      {
        projectId: project.id,
        previousRevision: project.revision,
        committedRevision: project.revision + 1,
        committedAt: result.project.updatedAt,
        commitTag: 'opaque/task-3-tag',
      },
    ]);
    expect(facts.every(Object.isFrozen)).toBe(true);
    expect(events).toEqual(['project-rename', 'project-directory-sync', 'observer', 'index-rename']);
    expect(
      readJson<{ schemaVersion: number; projects: Array<{ beatCount: number; shotCount: number }> }>(
        path.join(rootDir, 'projects-v2.json')
      )
    ).toMatchObject({ schemaVersion: 2, projects: [{ beatCount: 1, shotCount: 1 }] });
    expect(protectedFs.accesses).toEqual([]);
  });

  it('returns a committed batch after one V2 index failure and retries only that V2 index', async () => {
    const projectId = 'repair_retry_v2';
    const facts: Parameters<StudioProjectCommitObserver>[0][] = [];
    const logError = vi.fn();
    const renameDestinations: string[] = [];
    const protectedFs = protectPrototypeIndex();
    let armed = false;
    let indexRenameAttempts = 0;
    let signalRetryStarted: () => void = () => undefined;
    const retryStarted = new Promise<void>((resolve) => {
      signalRetryStarted = resolve;
    });
    let releaseRetry: () => void = () => undefined;
    const retryGate = new Promise<void>((resolve) => {
      releaseRetry = resolve;
    });
    const failingOnceFs = new Proxy(protectedFs.fs, {
      get(target, property, receiver) {
        if (property !== 'rename') return Reflect.get(target, property, receiver);
        return async (...args: Parameters<typeof nodeFs.rename>): ReturnType<typeof nodeFs.rename> => {
          const destination = path.resolve(String(args[1]));
          if (armed) {
            renameDestinations.push(destination);
            if (destination.endsWith(`${path.sep}projects-v2.json`)) {
              indexRenameAttempts += 1;
              if (indexRenameAttempts === 1) throw new Error('schema-2 index rename failed once');
              signalRetryStarted();
              await retryGate;
            }
          }
          return protectedFs.fs.rename(...args);
        };
      },
    }) as typeof nodeFs;
    let clock = Date.parse(timestamp);
    const store = createCreativeStudioStore({
      rootDir,
      fs: failingOnceFs,
      createId: () => projectId,
      now: () => new Date((clock += 1_000)).toISOString(),
      logError,
      onProjectCommitted: (fact) => facts.push(fact),
    });
    const project = await store.createProjectV2(inputV2);
    armed = true;

    const resultPromise = store.applyMutationBatchV2(
      makeStudioMutationBatchV2(project, [
        {
          kind: 'add_beat',
          beatId: 'section_retry',
          beat: { title: 'Retry summary', action: '', look: '', targetSeconds: null },
          beforeBeatId: null,
        },
        {
          kind: 'add_shot',
          beatId: 'section_retry',
          shotId: 'clip_retry',
          shot: { line: '', narration: '', onScreenText: '', durationSeconds: 4 },
          beforeShotId: null,
        },
      ]),
      makeMutationContextV2({ mutationId: 'mutation_retry', capturedAt: '2026-08-17T12:00:02.000Z' }),
      'opaque/retry-tag'
    );
    let settled = false;
    void resultPromise.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      }
    );
    await retryStarted;
    expect(settled).toBe(false);
    releaseRetry();
    const result = await resultPromise;

    expect(result.project).toMatchObject({ id: projectId, revision: project.revision + 1 });
    expect(facts).toEqual([
      {
        projectId,
        previousRevision: project.revision,
        committedRevision: result.project.revision,
        committedAt: result.project.updatedAt,
        commitTag: 'opaque/retry-tag',
      },
    ]);
    expect(facts.every(Object.isFrozen)).toBe(true);
    expect(
      readJson<{ projects: Array<{ beatCount: number; shotCount: number }> }>(path.join(rootDir, 'projects-v2.json'))
        .projects
    ).toEqual([expect.objectContaining({ beatCount: 1, shotCount: 1 })]);
    expect(renameDestinations.map((destination) => path.basename(destination))).toEqual([
      'project.json',
      'projects-v2.json',
      'projects-v2.json',
    ]);
    expect(indexRenameAttempts).toBe(2);
    expect(logError).toHaveBeenCalledExactlyOnceWith(
      '[CreativeStudio] Schema-2 project summary repair failed after commit',
      expect.objectContaining({ message: 'schema-2 index rename failed once' })
    );
    expect(protectedFs.accesses).toEqual([]);
  });

  it('reports a busy V2 delete before stale revision when both conditions apply', async () => {
    const project = makePosterProjectV2('busy_delete_v2');
    const shot = project.shots.clip_video!;
    shot.selectedTakeId = null;
    shot.assetIds = ['asset_seed'];
    delete project.assets.asset_video;
    delete project.assets.asset_thumbnail;
    project.jobs.job_video = {
      ...project.jobs.job_video!,
      status: 'running',
      outputAssetIds: [],
      outputAssetIdsByRole: { primary: null, poster: null },
      spendReceipt: null,
    };
    seedProjectV2(project);
    const manifestFile = path.join(rootDir, project.id, 'project.json');
    const manifestBefore = readFileSync(manifestFile);
    const { store, prototypeIndexAccesses } = createStoreV2();

    await expect(store.deleteProjectV2(project.id, project.revision + 1)).rejects.toMatchObject({ code: 'busy' });

    expect(readFileSync(manifestFile)).toEqual(manifestBefore);
    expect(existsSync(path.join(rootDir, 'projects-v2.json'))).toBe(false);
    expect(prototypeIndexAccesses).toEqual([]);
  });

  it('rejects a symlinked V2 project directory before issuing any remove', async () => {
    const projectId = 'symlink_delete_v2';
    const project = createEmptyStudioProjectV2(inputV2, projectId, timestamp);
    const backingDirectory = path.join(rootDir, '.symlink-delete-backing');
    const manifestFile = path.join(backingDirectory, 'project.json');
    mkdirSync(backingDirectory);
    writeFileSync(manifestFile, JSON.stringify(project, null, 2));
    symlinkSync(backingDirectory, path.join(rootDir, projectId), 'dir');
    const manifestBefore = readFileSync(manifestFile);
    const protectedFs = protectPrototypeIndex();
    const rmCalls: string[] = [];
    const noDeleteFs = new Proxy(protectedFs.fs, {
      get(target, property, receiver) {
        if (property !== 'rm') return Reflect.get(target, property, receiver);
        return (...args: Parameters<typeof nodeFs.rm>): ReturnType<typeof nodeFs.rm> => {
          rmCalls.push(String(args[0]));
          return protectedFs.fs.rm(...args);
        };
      },
    }) as typeof nodeFs;
    const store = createCreativeStudioStore({ rootDir, fs: noDeleteFs });

    await expect(store.deleteProjectV2(projectId, project.revision)).rejects.toMatchObject({ code: 'storage_error' });

    expect(rmCalls).toEqual([]);
    expect(existsSync(path.join(rootDir, projectId))).toBe(true);
    expect(readFileSync(manifestFile)).toEqual(manifestBefore);
    expect(protectedFs.accesses).toEqual([]);
  });

  it('preserves and restores a replacement project directory raced into V2 deletion', async () => {
    const { store: base } = createStoreV2({ createId: () => 'delete_replacement_v2', now: () => timestamp });
    const project = await base.createProjectV2(inputV2);
    const targetDirectory = realpathSync(path.join(rootDir, project.id));
    const originalProjectBytes = readFileSync(path.join(targetDirectory, 'project.json'));
    const originalBackup = path.join(rootDir, '.external-original-backup');
    const replacementBytes = Buffer.from('replacement project bytes');
    let replacementInstalled = false;
    const racingFs = new Proxy(nodeFs, {
      get(target, property, receiver) {
        const value = Reflect.get(target, property, receiver) as unknown;
        if (property !== 'rename' || typeof value !== 'function') return value;
        return (...args: unknown[]): unknown => {
          if (
            !replacementInstalled &&
            String(args[0]) === targetDirectory &&
            String(args[1]).endsWith(`/.delete-${project.id}`)
          ) {
            renameSync(targetDirectory, originalBackup);
            mkdirSync(targetDirectory);
            writeFileSync(path.join(targetDirectory, 'sentinel.bin'), replacementBytes);
            replacementInstalled = true;
          }
          return Reflect.apply(value, target, args);
        };
      },
    }) as typeof nodeFs;
    const racing = createCreativeStudioStore({ rootDir, fs: racingFs, logError: () => undefined });

    await expect(racing.deleteProjectV2(project.id, project.revision)).rejects.toMatchObject({
      code: 'storage_error',
    });
    expect(replacementInstalled).toBe(true);
    expect(readFileSync(path.join(targetDirectory, 'sentinel.bin'))).toEqual(replacementBytes);
    expect(readFileSync(path.join(originalBackup, 'project.json'))).toEqual(originalProjectBytes);
    expect(existsSync(path.join(rootDir, `.delete-${project.id}`))).toBe(false);
  });

  it('resumes an identity-bound V2 deletion on the first queued read after quarantine cleanup fails', async () => {
    const { store: base } = createStoreV2({ createId: () => 'delete_resume_v2', now: () => timestamp });
    const project = await base.createProjectV2(inputV2);
    const quarantineDirectory = realpathSync(rootDir) + `/.delete-${project.id}`;
    const crashing = createCreativeStudioStore({
      rootDir,
      fs: failFileSystemOnceV2(
        (method, args) => method === 'rm' && String(args[0]) === quarantineDirectory && args[1] !== undefined
      ),
      logError: () => undefined,
    });

    await expect(crashing.deleteProjectV2(project.id, project.revision)).rejects.toMatchObject({
      code: 'storage_error',
    });
    expect(existsSync(path.join(rootDir, project.id))).toBe(false);
    expect(existsSync(quarantineDirectory)).toBe(true);
    expect(existsSync(path.join(realpathSync(rootDir), `.delete-${project.id}.json`))).toBe(true);

    const restarted = createStoreV2().store;
    await expect(restarted.getProjectV2(project.id)).resolves.toEqual({ status: 'not_found', projectId: project.id });
    expect(existsSync(quarantineDirectory)).toBe(false);
    expect(existsSync(path.join(realpathSync(rootDir), `.delete-${project.id}.json`))).toBe(false);
  });

  it('does not grant deletion authority to a temporary-only marker and promotes it only on an explicit retry', async () => {
    const { store: base } = createStoreV2({ createId: () => 'delete_temp_only_v2', now: () => timestamp });
    const project = await base.createProjectV2(inputV2);
    const projectDirectory = realpathSync(path.join(rootDir, project.id));
    const projectBytes = readFileSync(path.join(projectDirectory, 'project.json'), 'utf8');
    const directory = lstatSync(projectDirectory);
    const temporaryMarker = path.join(realpathSync(rootDir), `.delete-${project.id}.json.publish`);
    writeFileSync(
      temporaryMarker,
      JSON.stringify(
        {
          schemaVersion: 2,
          projectId: project.id,
          expectedRevision: project.revision,
          directoryDev: directory.dev,
          directoryIno: directory.ino,
          projectSha256: createHash('sha256').update(projectBytes).digest('hex'),
        },
        null,
        2
      )
    );

    const restarted = createStoreV2().store;
    await expect(restarted.getProjectV2(project.id)).resolves.toEqual({ status: 'supported', project });
    expect(existsSync(temporaryMarker)).toBe(true);

    await expect(restarted.deleteProjectV2(project.id, project.revision)).resolves.toBe(true);
    expect(existsSync(projectDirectory)).toBe(false);
    expect(existsSync(temporaryMarker)).toBe(false);
    expect(existsSync(path.join(realpathSync(rootDir), `.delete-${project.id}.json`))).toBe(false);
  });

  it('removes only its exact partial deletion-marker temporary when a marker write fails', async () => {
    const { store: base } = createStoreV2({ createId: () => 'delete_partial_marker_v2', now: () => timestamp });
    const project = await base.createProjectV2(inputV2);
    const temporaryMarker = path.join(realpathSync(rootDir), `.delete-${project.id}.json.publish`);
    let injected = false;
    const failingFs = new Proxy(nodeFs, {
      get(target, property, receiver) {
        if (property !== 'open') return Reflect.get(target, property, receiver);
        return async (...args: Parameters<typeof nodeFs.open>) => {
          const handle = await nodeFs.open(...args);
          if (String(args[0]) !== temporaryMarker) return handle;
          return new Proxy(handle, {
            get(handleTarget, handleProperty, handleReceiver) {
              if (handleProperty !== 'writeFile') return Reflect.get(handleTarget, handleProperty, handleReceiver);
              return async (...writeArgs: Parameters<typeof handle.writeFile>) => {
                if (!injected) {
                  injected = true;
                  await handle.writeFile('{', { encoding: 'utf8' });
                  throw Object.assign(new Error('injected deletion marker write failure'), { code: 'EIO' });
                }
                return handle.writeFile(...writeArgs);
              };
            },
          });
        };
      },
    }) as typeof nodeFs;
    const failing = createCreativeStudioStore({ rootDir, fs: failingFs, now: () => timestamp });

    await expect(failing.deleteProjectV2(project.id, project.revision)).rejects.toMatchObject({
      code: 'storage_error',
    });
    expect(injected).toBe(true);
    expect(existsSync(temporaryMarker)).toBe(false);
    expect(existsSync(path.join(rootDir, `.delete-${project.id}.json`))).toBe(false);
    await expect(base.getProjectV2(project.id)).resolves.toEqual({ status: 'supported', project });
  });

  it('preserves an exact quarantine and a replacement live directory raced in before deletion cleanup', async () => {
    const { store: base } = createStoreV2({ createId: () => 'delete_late_replacement_v2', now: () => timestamp });
    const project = await base.createProjectV2(inputV2);
    const targetDirectory = realpathSync(path.join(rootDir, project.id));
    const quarantineDirectory = realpathSync(rootDir) + `/.delete-${project.id}`;
    const replacementBytes = Buffer.from('late replacement bytes');
    let quarantined = false;
    let replacementInstalled = false;
    const racingFs = new Proxy(nodeFs, {
      get(target, property, receiver) {
        const value = Reflect.get(target, property, receiver) as unknown;
        if (typeof value !== 'function') return value;
        if (property === 'rename') {
          return async (...args: Parameters<typeof nodeFs.rename>) => {
            const result = await nodeFs.rename(...args);
            if (String(args[0]) === targetDirectory && String(args[1]) === quarantineDirectory) quarantined = true;
            return result;
          };
        }
        if (property === 'lstat') {
          return async (...args: Parameters<typeof nodeFs.lstat>) => {
            const result = await nodeFs.lstat(...args);
            if (quarantined && !replacementInstalled && String(args[0]) === quarantineDirectory) {
              mkdirSync(targetDirectory);
              writeFileSync(path.join(targetDirectory, 'sentinel.bin'), replacementBytes);
              replacementInstalled = true;
            }
            return result;
          };
        }
        return value.bind(target);
      },
    }) as typeof nodeFs;
    const racing = createCreativeStudioStore({ rootDir, fs: racingFs, now: () => timestamp });

    await expect(racing.deleteProjectV2(project.id, project.revision)).rejects.toMatchObject({
      code: 'storage_error',
    });
    expect(replacementInstalled).toBe(true);
    expect(readFileSync(path.join(targetDirectory, 'sentinel.bin'))).toEqual(replacementBytes);
    expect(existsSync(path.join(quarantineDirectory, 'project.json'))).toBe(true);
    expect(existsSync(path.join(rootDir, `.delete-${project.id}.json`))).toBe(true);
  });

  it('deletes only a supported schema-2 project and refuses the schema-1 identity without touching it', async () => {
    const prototype = await seedPrototypeProject();
    const prototypeManifest = readFileSync(path.join(rootDir, prototype.id, 'project.json'));
    const prototypeIndex = readFileSync(path.join(rootDir, 'projects.json'));
    const { store, prototypeIndexAccesses } = createStoreV2({ createId: () => 'deleted_v2', now: () => timestamp });
    const project = await store.createProjectV2(inputV2);

    await expect(store.deleteProjectV2(prototype.id, prototype.revision)).rejects.toMatchObject({
      code: 'unsupported_prototype_schema',
    });
    await expect(store.deleteProjectV2(project.id, project.revision)).resolves.toBe(true);

    expect(existsSync(path.join(rootDir, project.id))).toBe(false);
    expect(readFileSync(path.join(rootDir, prototype.id, 'project.json'))).toEqual(prototypeManifest);
    expect(readFileSync(path.join(rootDir, 'projects.json'))).toEqual(prototypeIndex);
    expect(readJson(path.join(rootDir, 'projects-v2.json'))).toEqual({ schemaVersion: 2, projects: [] });
    expect(prototypeIndexAccesses).toEqual([]);
  });

  it('keeps inspection read-only and refreshes its classified ID inventory after create and delete', async () => {
    const prototype = await seedPrototypeProject();
    const malformedId = 'inventory_broken_v2';
    mkdirSync(path.join(rootDir, malformedId));
    writeFileSync(
      path.join(rootDir, malformedId, 'project.json'),
      JSON.stringify({ schemaVersion: 2, id: malformedId })
    );
    const ids = ['inventory_a', 'inventory_b'];
    const { store, prototypeIndexAccesses } = createStoreV2({
      createId: () => ids.shift() ?? 'unexpected_id',
      now: () => timestamp,
    });
    const first = await store.createProjectV2(inputV2);
    rmSync(path.join(rootDir, 'projects-v2.json'));

    const firstInventory: StudioProjectInventoryV2 = {
      supportedProjectIds: [first.id],
      unsupportedProjectIds: [prototype.id],
      quarantinedProjectIds: [malformedId],
    };
    await expect(store.inspectProjectsV2()).resolves.toEqual(firstInventory);
    expect(existsSync(path.join(rootDir, 'projects-v2.json'))).toBe(false);

    const second = await store.createProjectV2(inputV2);
    await expect(store.inspectProjectsV2()).resolves.toEqual({
      ...firstInventory,
      supportedProjectIds: [first.id, second.id],
    });
    await store.deleteProjectV2(first.id, first.revision);
    await expect(store.inspectProjectsV2()).resolves.toEqual({
      ...firstInventory,
      supportedProjectIds: [second.id],
    });
    expect(prototypeIndexAccesses).toEqual([]);
  });

  it('confirms one frozen revalidation snapshot as one durable revision and returns an isolated frozen dispatch', async () => {
    const confirmedAt = '2026-08-17T12:00:01.000Z';
    const expiresAt = '2026-08-17T12:05:00.000Z';
    const facts: Parameters<StudioProjectCommitObserver>[0][] = [];
    let clock = timestamp;
    const { store } = createStoreV2({
      createId: () => 'confirmed_transaction_v2',
      now: () => clock,
      onProjectCommitted: (fact) => facts.push(fact),
    });
    const project = await store.createProjectV2(inputV2);
    clock = confirmedAt;
    const rawRevalidation = {
      providerBindings: [{ itemId: 'item_1', routeId: 'video_route' }],
    };
    const dispatchSource = {
      jobIds: ['job_1'],
      route: { id: 'video_route' },
    };
    let observedSnapshot: unknown;
    let observedRevalidation: unknown;
    let retainedBuilderProject: StudioProjectV2 | undefined;
    let snapshotMutationSucceeded = true;
    const assertActive = vi.fn();
    const input: StudioProjectConfirmationInputV2<typeof rawRevalidation, typeof dispatchSource> = {
      projectId: project.id,
      expectedRevision: project.revision,
      expiresAt,
      async revalidate(snapshot) {
        observedSnapshot = snapshot;
        snapshotMutationSucceeded = Reflect.set(snapshot, 'brief', 'must not mutate');
        return rawRevalidation;
      },
      assertActive,
      buildCommit(candidate, revalidation, receivedConfirmedAt) {
        retainedBuilderProject = candidate;
        observedRevalidation = revalidation;
        candidate.brief = `Confirmed at ${receivedConfirmedAt}`;
        return { project: candidate, dispatch: dispatchSource };
      },
      commitTag: 'submission/confirm-v2',
    };

    const result = await store.confirmProjectV2(input);

    expect(result.project).toMatchObject({
      revision: project.revision + 1,
      updatedAt: confirmedAt,
      brief: `Confirmed at ${confirmedAt}`,
    });
    expect(readJson<StudioProjectV2>(path.join(rootDir, project.id, 'project.json'))).toEqual(result.project);
    expect(assertActive).toHaveBeenCalledTimes(2);
    expect(facts).toEqual([
      {
        projectId: project.id,
        previousRevision: project.revision,
        committedRevision: project.revision + 1,
        committedAt: confirmedAt,
        commitTag: 'submission/confirm-v2',
      },
    ]);
    expect(snapshotMutationSucceeded).toBe(false);
    expect(Object.isFrozen(observedSnapshot)).toBe(true);
    expect(Object.isFrozen((observedSnapshot as { beatOrder: unknown }).beatOrder)).toBe(true);
    expect(observedSnapshot).not.toBe(project);
    expect(Object.isFrozen(observedRevalidation)).toBe(true);
    expect(observedRevalidation).not.toBe(rawRevalidation);
    expect(retainedBuilderProject).not.toBe(project);
    expect(Object.isFrozen(retainedBuilderProject)).toBe(false);
    expect(Object.isFrozen(result.dispatch)).toBe(true);
    expect(Object.isFrozen(result.dispatch.route)).toBe(true);

    rawRevalidation.providerBindings[0]!.routeId = 'changed_after_confirm';
    dispatchSource.jobIds.push('job_2');
    dispatchSource.route.id = 'changed_after_confirm';
    retainedBuilderProject!.brief = 'changed after confirm';

    expect(observedRevalidation).toEqual({
      providerBindings: [{ itemId: 'item_1', routeId: 'video_route' }],
    });
    expect(result.dispatch).toEqual({ jobIds: ['job_1'], route: { id: 'video_route' } });
    expect(() => {
      (result.dispatch as { route: { id: string } }).route.id = 'forbidden';
    }).toThrow(TypeError);
    await expect(store.getProjectV2(project.id)).resolves.toMatchObject({
      status: 'supported',
      project: { brief: `Confirmed at ${confirmedAt}` },
    });
  });

  it('refuses stale confirmation authority before callbacks and preserves every durable byte', async () => {
    const onProjectCommitted = vi.fn<StudioProjectCommitObserver>();
    const { store } = createStoreV2({
      createId: () => 'stale_confirmation_v2',
      now: () => timestamp,
      onProjectCommitted,
    });
    const project = await store.createProjectV2(inputV2);
    const projectFile = path.join(rootDir, project.id, 'project.json');
    const indexFile = path.join(rootDir, 'projects-v2.json');
    const projectBefore = readFileSync(projectFile);
    const indexBefore = readFileSync(indexFile);
    const revalidate = vi.fn(async () => ({ routeId: 'video_route' }));
    const assertActive = vi.fn();
    const buildCommit = vi.fn((candidate: StudioProjectV2) => ({
      project: candidate,
      dispatch: { jobIds: ['job_1'] },
    }));

    await expect(
      store.confirmProjectV2({
        projectId: project.id,
        expectedRevision: project.revision + 1,
        expiresAt: '2026-08-17T12:05:00.000Z',
        revalidate,
        assertActive,
        buildCommit,
      })
    ).rejects.toMatchObject({ code: 'stale_project' });

    expect(revalidate).not.toHaveBeenCalled();
    expect(assertActive).not.toHaveBeenCalled();
    expect(buildCommit).not.toHaveBeenCalled();
    expect(readFileSync(projectFile)).toEqual(projectBefore);
    expect(readFileSync(indexFile)).toEqual(indexBefore);
    expect(onProjectCommitted).not.toHaveBeenCalled();
  });

  it('refuses confirmation at exact expiry after revalidation without invoking the commit builder', async () => {
    const expiry = '2026-08-17T12:05:00.000Z';
    let clock = timestamp;
    const { store } = createStoreV2({ createId: () => 'expired_confirmation_v2', now: () => clock });
    const project = await store.createProjectV2(inputV2);
    const projectFile = path.join(rootDir, project.id, 'project.json');
    const indexFile = path.join(rootDir, 'projects-v2.json');
    const projectBefore = readFileSync(projectFile);
    const indexBefore = readFileSync(indexFile);
    const revalidate = vi.fn(async () => ({ routeId: 'video_route' }));
    const buildCommit = vi.fn((candidate: StudioProjectV2) => ({ project: candidate, dispatch: null }));
    clock = expiry;

    const confirmation = store.confirmProjectV2({
      projectId: project.id,
      expectedRevision: project.revision,
      expiresAt: expiry,
      revalidate,
      assertActive: () => undefined,
      buildCommit,
    });

    await expect(confirmation).rejects.toBeInstanceOf(StudioProjectConfirmationError);
    expect(revalidate).toHaveBeenCalledOnce();
    expect(buildCommit).not.toHaveBeenCalled();
    expect(readFileSync(projectFile)).toEqual(projectBefore);
    expect(readFileSync(indexFile)).toEqual(indexBefore);
  });

  it('rechecks expiry after delayed async revalidation and changes no bytes when the clock crosses it', async () => {
    const expiry = '2026-08-17T12:05:00.000Z';
    let clock = timestamp;
    const started = createDeferredV2<void>();
    const release = createDeferredV2<void>();
    const { store } = createStoreV2({ createId: () => 'delayed_expiry_v2', now: () => clock });
    const project = await store.createProjectV2(inputV2);
    const projectFile = path.join(rootDir, project.id, 'project.json');
    const indexFile = path.join(rootDir, 'projects-v2.json');
    const projectBefore = readFileSync(projectFile);
    const indexBefore = readFileSync(indexFile);
    const buildCommit = vi.fn((candidate: StudioProjectV2) => ({ project: candidate, dispatch: null }));
    const confirmation = store.confirmProjectV2({
      projectId: project.id,
      expectedRevision: project.revision,
      expiresAt: expiry,
      async revalidate() {
        started.resolve(undefined);
        await release.promise;
        return { routeId: 'video_route' };
      },
      assertActive: () => undefined,
      buildCommit,
    });

    await started.promise;
    clock = expiry;
    release.resolve(undefined);

    await expect(confirmation).rejects.toMatchObject({ code: 'expired_confirmation' });
    expect(buildCommit).not.toHaveBeenCalled();
    expect(readFileSync(projectFile)).toEqual(projectBefore);
    expect(readFileSync(indexFile)).toEqual(indexBefore);
  });

  it('preserves async revalidation and synchronous builder throws without writing', async () => {
    const revalidationError = new Error('route resolver failed');
    const builderError = new Error('authorization construction failed');
    const onProjectCommitted = vi.fn<StudioProjectCommitObserver>();
    const { store } = createStoreV2({
      createId: () => 'confirmation_callback_error_v2',
      now: () => timestamp,
      onProjectCommitted,
    });
    const project = await store.createProjectV2(inputV2);
    const projectFile = path.join(rootDir, project.id, 'project.json');
    const indexFile = path.join(rootDir, 'projects-v2.json');
    const projectBefore = readFileSync(projectFile);
    const indexBefore = readFileSync(indexFile);
    const buildAfterFailedRevalidation = vi.fn((candidate: StudioProjectV2) => ({
      project: candidate,
      dispatch: null,
    }));

    await expect(
      store.confirmProjectV2({
        projectId: project.id,
        expectedRevision: project.revision,
        expiresAt: '2026-08-17T12:05:00.000Z',
        revalidate: async () => {
          throw revalidationError;
        },
        assertActive: () => undefined,
        buildCommit: buildAfterFailedRevalidation,
      })
    ).rejects.toBe(revalidationError);
    await expect(
      store.confirmProjectV2({
        projectId: project.id,
        expectedRevision: project.revision,
        expiresAt: '2026-08-17T12:05:00.000Z',
        revalidate: async () => ({ routeId: 'video_route' }),
        assertActive: () => undefined,
        buildCommit: () => {
          throw builderError;
        },
      })
    ).rejects.toBe(builderError);

    expect(buildAfterFailedRevalidation).not.toHaveBeenCalled();
    expect(readFileSync(projectFile)).toEqual(projectBefore);
    expect(readFileSync(indexFile)).toEqual(indexBefore);
    expect(onProjectCommitted).not.toHaveBeenCalled();
  });

  it('rejects thenable guard and commit-builder results before persistence', async () => {
    const { store } = createStoreV2({ createId: () => 'confirmation_thenable_v2', now: () => timestamp });
    const project = await store.createProjectV2(inputV2);
    const projectFile = path.join(rootDir, project.id, 'project.json');
    const indexFile = path.join(rootDir, 'projects-v2.json');
    const projectBefore = readFileSync(projectFile);
    const indexBefore = readFileSync(indexFile);
    const buildCommit = vi.fn((candidate: StudioProjectV2) => ({ project: candidate, dispatch: null }));
    const thenableGuard = (() => Promise.resolve()) as unknown as () => void;
    const thenableBuilder = (async (candidate: StudioProjectV2) => ({
      project: candidate,
      dispatch: null,
    })) as unknown as StudioProjectConfirmationInputV2<null, null>['buildCommit'];

    await expect(
      store.confirmProjectV2({
        projectId: project.id,
        expectedRevision: project.revision,
        expiresAt: '2026-08-17T12:05:00.000Z',
        revalidate: async () => null,
        assertActive: thenableGuard,
        buildCommit,
      })
    ).rejects.toMatchObject({ code: 'invalid_payload' });
    await expect(
      store.confirmProjectV2({
        projectId: project.id,
        expectedRevision: project.revision,
        expiresAt: '2026-08-17T12:05:00.000Z',
        revalidate: async () => null,
        assertActive: () => undefined,
        buildCommit: thenableBuilder,
      })
    ).rejects.toMatchObject({ code: 'invalid_payload' });

    expect(buildCommit).not.toHaveBeenCalled();
    expect(readFileSync(projectFile)).toEqual(projectBefore);
    expect(readFileSync(indexFile)).toEqual(indexBefore);
  });

  it('rechecks the live session after building and refuses a close immediately before persistence', async () => {
    const closeError = new Error('prepared submission cache closed');
    const onProjectCommitted = vi.fn<StudioProjectCommitObserver>();
    const { store } = createStoreV2({
      createId: () => 'confirmation_close_fence_v2',
      now: () => timestamp,
      onProjectCommitted,
    });
    const project = await store.createProjectV2(inputV2);
    const projectFile = path.join(rootDir, project.id, 'project.json');
    const indexFile = path.join(rootDir, 'projects-v2.json');
    const projectBefore = readFileSync(projectFile);
    const indexBefore = readFileSync(indexFile);
    let activeChecks = 0;
    const buildCommit = vi.fn((candidate: StudioProjectV2) => ({
      project: { ...candidate, brief: 'must not persist' },
      dispatch: { jobIds: ['job_1'] },
    }));

    await expect(
      store.confirmProjectV2({
        projectId: project.id,
        expectedRevision: project.revision,
        expiresAt: '2026-08-17T12:05:00.000Z',
        revalidate: async () => ({ routeId: 'video_route' }),
        assertActive() {
          activeChecks += 1;
          if (activeChecks === 2) throw closeError;
        },
        buildCommit,
      })
    ).rejects.toBe(closeError);

    expect(activeChecks).toBe(2);
    expect(buildCommit).toHaveBeenCalledOnce();
    expect(readFileSync(projectFile)).toEqual(projectBefore);
    expect(readFileSync(indexFile)).toEqual(indexBefore);
    expect(onProjectCommitted).not.toHaveBeenCalled();
  });

  it('rejects an invalid built project and preserves project and summary bytes', async () => {
    const onProjectCommitted = vi.fn<StudioProjectCommitObserver>();
    const { store } = createStoreV2({
      createId: () => 'confirmation_invalid_project_v2',
      now: () => timestamp,
      onProjectCommitted,
    });
    const project = await store.createProjectV2(inputV2);
    const projectFile = path.join(rootDir, project.id, 'project.json');
    const indexFile = path.join(rootDir, 'projects-v2.json');
    const projectBefore = readFileSync(projectFile);
    const indexBefore = readFileSync(indexFile);

    await expect(
      store.confirmProjectV2({
        projectId: project.id,
        expectedRevision: project.revision,
        expiresAt: '2026-08-17T12:05:00.000Z',
        revalidate: async () => ({ routeId: 'video_route' }),
        assertActive: () => undefined,
        buildCommit: (candidate) => ({
          project: { ...candidate, beatOrder: ['missing_beat'] },
          dispatch: { jobIds: ['job_1'] },
        }),
      })
    ).rejects.toMatchObject({ code: 'invalid_payload' });

    expect(readFileSync(projectFile)).toEqual(projectBefore);
    expect(readFileSync(indexFile)).toEqual(indexBefore);
    expect(onProjectCommitted).not.toHaveBeenCalled();
  });

  it('serializes an edit queued before confirmation so stale confirmation never revalidates', async () => {
    const { store } = createStoreV2({ createId: () => 'edit_before_confirmation_v2', now: () => timestamp });
    const project = await store.createProjectV2(inputV2);
    const revalidate = vi.fn(async () => ({ routeId: 'video_route' }));
    const edit = store.updateProjectV2(
      project.id,
      (candidate) => ({ ...candidate, name: 'Edited before confirmation' }),
      project.revision
    );
    const confirmation = store.confirmProjectV2({
      projectId: project.id,
      expectedRevision: project.revision,
      expiresAt: '2026-08-17T12:05:00.000Z',
      revalidate,
      assertActive: () => undefined,
      buildCommit: (candidate) => ({ project: candidate, dispatch: null }),
    });

    const edited = await edit;

    await expect(confirmation).rejects.toMatchObject({ code: 'stale_project' });
    expect(edited).toMatchObject({ revision: project.revision + 1, name: 'Edited before confirmation' });
    expect(revalidate).not.toHaveBeenCalled();
  });

  it('holds an edit queued after confirmation until the confirmed revision is durable', async () => {
    const started = createDeferredV2<void>();
    const release = createDeferredV2<void>();
    let clock = timestamp;
    const { store } = createStoreV2({ createId: () => 'edit_after_confirmation_v2', now: () => clock });
    const project = await store.createProjectV2(inputV2);
    clock = '2026-08-17T12:00:01.000Z';
    const confirmation = store.confirmProjectV2({
      projectId: project.id,
      expectedRevision: project.revision,
      expiresAt: '2026-08-17T12:05:00.000Z',
      async revalidate() {
        started.resolve(undefined);
        await release.promise;
        return { routeId: 'video_route' };
      },
      assertActive: () => undefined,
      buildCommit: (candidate) => ({
        project: { ...candidate, brief: 'Confirmed before the later edit' },
        dispatch: { jobIds: ['job_1'] },
      }),
    });
    await started.promise;
    clock = '2026-08-17T12:00:02.000Z';
    const edit = store.updateProjectV2(project.id, (candidate) => ({
      ...candidate,
      name: 'Edited after confirmation',
    }));
    release.resolve(undefined);

    const confirmed = await confirmation;
    const edited = await edit;

    expect(confirmed.project).toMatchObject({
      revision: project.revision + 1,
      brief: 'Confirmed before the later edit',
    });
    expect(edited).toMatchObject({
      revision: project.revision + 2,
      name: 'Edited after confirmation',
      brief: 'Confirmed before the later edit',
    });
    await expect(store.getProjectV2(project.id)).resolves.toMatchObject({ status: 'supported', project: edited });
  });

  it('never returns dispatch or observes a commit when the atomic project write fails', async () => {
    const projectId = 'confirmation_write_failure_v2';
    const protectedFs = protectPrototypeIndex();
    const onProjectCommitted = vi.fn<StudioProjectCommitObserver>();
    let failProjectRename = false;
    const failingFs = new Proxy(protectedFs.fs, {
      get(target, property, receiver) {
        if (property !== 'rename') return Reflect.get(target, property, receiver);
        return async (...args: Parameters<typeof nodeFs.rename>): ReturnType<typeof nodeFs.rename> => {
          const destination = path.resolve(String(args[1]));
          if (failProjectRename && destination === path.join(realpathSync(rootDir), projectId, 'project.json')) {
            throw new Error('confirmation project rename failed');
          }
          return protectedFs.fs.rename(...args);
        };
      },
    }) as typeof nodeFs;
    const store = createCreativeStudioStore({
      rootDir,
      fs: failingFs,
      createId: () => projectId,
      now: () => timestamp,
      logError: () => undefined,
      onProjectCommitted,
    });
    const project = await store.createProjectV2(inputV2);
    const projectFile = path.join(rootDir, project.id, 'project.json');
    const projectBefore = readFileSync(projectFile);
    failProjectRename = true;

    await expect(
      store.confirmProjectV2({
        projectId: project.id,
        expectedRevision: project.revision,
        expiresAt: '2026-08-17T12:05:00.000Z',
        revalidate: async () => ({ routeId: 'video_route' }),
        assertActive: () => undefined,
        buildCommit: (candidate) => ({
          project: { ...candidate, brief: 'must not survive failed durability' },
          dispatch: { jobIds: ['job_1'] },
        }),
      })
    ).rejects.toMatchObject({ code: 'storage_error' });

    expect(readFileSync(projectFile)).toEqual(projectBefore);
    expect(onProjectCommitted).not.toHaveBeenCalled();
    expect(protectedFs.accesses).toEqual([]);
  });

  it('updates one supported schema-2 project with one revision, observer fact, and V2 summary repair', async () => {
    const prototype = await seedPrototypeProject();
    const prototypeManifestFile = path.join(rootDir, prototype.id, 'project.json');
    const prototypeIndexFile = path.join(rootDir, 'projects.json');
    const prototypeManifestBefore = readFileSync(prototypeManifestFile);
    const prototypeIndexBefore = readFileSync(prototypeIndexFile);
    const facts: Parameters<StudioProjectCommitObserver>[0][] = [];
    let clock = Date.parse(timestamp);
    const { store, prototypeIndexAccesses } = createStoreV2({
      createId: () => 'updated_v2',
      now: () => new Date((clock += 1_000)).toISOString(),
      onProjectCommitted: (fact) => facts.push(fact),
    });
    const project = await store.createProjectV2(inputV2);

    const updated = await store.updateProjectV2(
      project.id,
      (candidate) => ({ ...candidate, name: 'Retitled schema-2 film', brief: 'Updated atomically' }),
      project.revision,
      'media/attach-v2'
    );

    expect(updated).toMatchObject({
      id: project.id,
      name: 'Retitled schema-2 film',
      brief: 'Updated atomically',
      revision: project.revision + 1,
      createdAt: project.createdAt,
    });
    expect(updated.updatedAt).not.toBe(project.updatedAt);
    expect(project).toMatchObject({ name: inputV2.name, brief: inputV2.brief, revision: 1 });
    expect(readJson<StudioProjectV2>(path.join(rootDir, project.id, 'project.json'))).toEqual(updated);
    expect(readJson(path.join(rootDir, 'projects-v2.json'))).toEqual({
      schemaVersion: 2,
      projects: [
        {
          id: project.id,
          name: updated.name,
          aspectRatio: updated.aspectRatio,
          targetDurationSeconds: updated.targetDurationSeconds,
          resolution: updated.resolution,
          beatCount: 0,
          shotCount: 0,
          selectedTakeCount: 0,
          createdAt: updated.createdAt,
          updatedAt: updated.updatedAt,
        },
      ],
    });
    expect(facts).toEqual([
      {
        projectId: project.id,
        previousRevision: project.revision,
        committedRevision: updated.revision,
        committedAt: updated.updatedAt,
        commitTag: 'media/attach-v2',
      },
    ]);
    expect(facts.every(Object.isFrozen)).toBe(true);
    expect(readFileSync(prototypeManifestFile)).toEqual(prototypeManifestBefore);
    expect(readFileSync(prototypeIndexFile)).toEqual(prototypeIndexBefore);
    expect(prototypeIndexAccesses).toEqual([]);
  });

  it('rejects stale schema-2 update authority before invoking the callback or writing', async () => {
    const onProjectCommitted = vi.fn<StudioProjectCommitObserver>();
    const update = vi.fn(
      (candidate: StudioProjectV2): StudioProjectV2 => ({
        ...candidate,
        brief: 'must never run',
      })
    );
    const { store, prototypeIndexAccesses } = createStoreV2({
      createId: () => 'stale_update_v2',
      now: () => timestamp,
      onProjectCommitted,
    });
    const project = await store.createProjectV2(inputV2);
    const projectFile = path.join(rootDir, project.id, 'project.json');
    const indexFile = path.join(rootDir, 'projects-v2.json');
    const projectBefore = readFileSync(projectFile);
    const indexBefore = readFileSync(indexFile);

    await expect(store.updateProjectV2(project.id, update, project.revision + 1)).rejects.toMatchObject({
      code: 'stale_project',
    });

    expect(update).not.toHaveBeenCalled();
    expect(onProjectCommitted).not.toHaveBeenCalled();
    expect(readFileSync(projectFile)).toEqual(projectBefore);
    expect(readFileSync(indexFile)).toEqual(indexBefore);
    expect(prototypeIndexAccesses).toEqual([]);
  });

  it('rolls back an invalid schema-2 update callback result without observing it', async () => {
    const onProjectCommitted = vi.fn<StudioProjectCommitObserver>();
    const { store, prototypeIndexAccesses } = createStoreV2({
      createId: () => 'invalid_update_v2',
      now: () => timestamp,
      onProjectCommitted,
    });
    const project = await store.createProjectV2(inputV2);
    const projectFile = path.join(rootDir, project.id, 'project.json');
    const indexFile = path.join(rootDir, 'projects-v2.json');
    const projectBefore = readFileSync(projectFile);
    const indexBefore = readFileSync(indexFile);

    await expect(
      store.updateProjectV2(project.id, (candidate) => ({ ...candidate, beatOrder: ['missing_section'] }))
    ).rejects.toMatchObject({ code: 'invalid_payload' });

    expect(onProjectCommitted).not.toHaveBeenCalled();
    expect(readFileSync(projectFile)).toEqual(projectBefore);
    expect(readFileSync(indexFile)).toEqual(indexBefore);
    expect(prototypeIndexAccesses).toEqual([]);
  });

  it('rejects an inherited array serialization hook before writing schema-2 project bytes', async () => {
    const onProjectCommitted = vi.fn<StudioProjectCommitObserver>();
    const { store } = createStoreV2({
      createId: () => 'serialization_hook_v2',
      now: () => timestamp,
      onProjectCommitted,
    });
    const project = await store.createProjectV2(inputV2);
    const projectFile = path.join(rootDir, project.id, 'project.json');
    const indexFile = path.join(rootDir, 'projects-v2.json');
    const projectBefore = readFileSync(projectFile);
    const indexBefore = readFileSync(indexFile);
    let toJsonCalls = 0;

    await expect(
      store.updateProjectV2(project.id, (candidate) => {
        Object.setPrototypeOf(candidate.beatOrder, {
          toJSON() {
            toJsonCalls += 1;
            return ['missing_section'];
          },
        });
        return candidate;
      })
    ).rejects.toMatchObject({ code: 'invalid_payload' });

    expect(toJsonCalls).toBe(0);
    expect(onProjectCommitted).not.toHaveBeenCalled();
    expect(readFileSync(projectFile)).toEqual(projectBefore);
    expect(readFileSync(indexFile)).toEqual(indexBefore);
  });

  it('rejects an own hidden serialization hook before writing schema-2 project bytes', async () => {
    const onProjectCommitted = vi.fn<StudioProjectCommitObserver>();
    const { store } = createStoreV2({
      createId: () => 'hidden_serialization_hook_v2',
      now: () => timestamp,
      onProjectCommitted,
    });
    const project = await store.createProjectV2(inputV2);
    const projectFile = path.join(rootDir, project.id, 'project.json');
    const indexFile = path.join(rootDir, 'projects-v2.json');
    const projectBefore = readFileSync(projectFile);
    const indexBefore = readFileSync(indexFile);
    let toJsonCalls = 0;

    await expect(
      store.updateProjectV2(project.id, (candidate) => {
        Object.defineProperty(candidate.frameExtractions, 'toJSON', {
          configurable: true,
          enumerable: false,
          value() {
            toJsonCalls += 1;
            return {};
          },
        });
        return candidate;
      })
    ).rejects.toMatchObject({ code: 'invalid_payload' });

    expect(toJsonCalls).toBe(0);
    expect(onProjectCommitted).not.toHaveBeenCalled();
    expect(readFileSync(projectFile)).toEqual(projectBefore);
    expect(readFileSync(indexFile)).toEqual(indexBefore);
  });

  it('preserves a schema-2 update callback error and leaves durable state unchanged', async () => {
    const callbackError = new Error('attachment staging failed');
    const onProjectCommitted = vi.fn<StudioProjectCommitObserver>();
    const { store, prototypeIndexAccesses } = createStoreV2({
      createId: () => 'callback_error_v2',
      now: () => timestamp,
      onProjectCommitted,
    });
    const project = await store.createProjectV2(inputV2);
    const projectFile = path.join(rootDir, project.id, 'project.json');
    const indexFile = path.join(rootDir, 'projects-v2.json');
    const projectBefore = readFileSync(projectFile);
    const indexBefore = readFileSync(indexFile);

    await expect(
      store.updateProjectV2(project.id, () => {
        throw callbackError;
      })
    ).rejects.toBe(callbackError);

    expect(onProjectCommitted).not.toHaveBeenCalled();
    expect(readFileSync(projectFile)).toEqual(projectBefore);
    expect(readFileSync(indexFile)).toEqual(indexBefore);
    expect(prototypeIndexAccesses).toEqual([]);
  });

  it('classifies unsupported, malformed, and missing projects before a schema-2 update callback', async () => {
    const prototype = await seedPrototypeProject();
    const prototypeManifestFile = path.join(rootDir, prototype.id, 'project.json');
    const prototypeIndexFile = path.join(rootDir, 'projects.json');
    const prototypeManifestBefore = readFileSync(prototypeManifestFile);
    const prototypeIndexBefore = readFileSync(prototypeIndexFile);
    const malformedId = 'update_malformed_v2';
    mkdirSync(path.join(rootDir, malformedId));
    writeFileSync(
      path.join(rootDir, malformedId, 'project.json'),
      JSON.stringify({ schemaVersion: 2, id: malformedId })
    );
    const update = vi.fn((project: StudioProjectV2): StudioProjectV2 => project);
    const { store, prototypeIndexAccesses } = createStoreV2();

    await expect(store.updateProjectV2(prototype.id, update)).rejects.toMatchObject({
      code: 'unsupported_prototype_schema',
    });
    await expect(store.updateProjectV2(malformedId, update)).rejects.toMatchObject({ code: 'storage_error' });
    await expect(store.updateProjectV2('missing_update_v2', update)).rejects.toMatchObject({ code: 'not_found' });

    expect(update).not.toHaveBeenCalled();
    expect(readFileSync(prototypeManifestFile)).toEqual(prototypeManifestBefore);
    expect(readFileSync(prototypeIndexFile)).toEqual(prototypeIndexBefore);
    expect(existsSync(path.join(rootDir, 'projects-v2.json'))).toBe(false);
    expect(prototypeIndexAccesses).toEqual([]);
  });

  it('lists, accepts, and restart-retries one mutation proposal without reapplying it', async () => {
    const { store } = createStoreV2({
      createId: () => 'proposal_project_v2',
      now: () => '2026-08-17T12:00:01.000Z',
    });
    const project = await store.createProjectV2(inputV2);
    const { proposal, directories } = await seedProposalV2(store, project);

    await expect(store.listProposalsV2(project.id)).resolves.toEqual([proposal]);
    const accepted = await store.acceptProposalV2(project.id, proposal.id);

    expect(accepted).toMatchObject({ applied: true, proposal: { id: proposal.id, status: 'accepted' } });
    expect(accepted.project).toMatchObject({ revision: project.revision + 1, brief: 'Accepted brief' });
    expect(accepted.project.undoHistory.at(-1)).toMatchObject({
      id: proposal.id,
      sourceRevision: project.revision + 1,
      label: 'set_brief',
    });
    expect(readdirSync(directories.commits)).toEqual([]);
    expect(readdirSync(directories.slots)).toEqual([]);
    expect(readJson<{ status: string }>(path.join(directories.decisions, `${proposal.id}.json`)).status).toBe(
      'accepted'
    );

    const restarted = createStoreV2({ now: () => '2026-08-17T12:00:02.000Z' }).store;
    const retry = await restarted.acceptProposalV2(project.id, proposal.id);
    expect(retry.applied).toBe(false);
    expect(retry.project.revision).toBe(project.revision + 1);
    expect(retry.project.undoHistory.filter((entry) => entry.id === proposal.id)).toHaveLength(1);
  });

  it('accepts pin_rule by applying one deterministic set_rules reducer operation', async () => {
    const ids = ['pin_project_v2', 'pinned_rule_v2'];
    const { store } = createStoreV2({
      createId: () => ids.shift() ?? 'unexpected_id',
      now: () => '2026-08-17T12:00:01.000Z',
    });
    const project = await store.createProjectV2(inputV2);
    const { proposal } = await seedProposalV2(store, project, {
      proposalId: 'proposal_pin_v2',
      payload: { kind: 'pin_rule', rule: { text: 'Never show a logo', predicate: null } },
    });

    const accepted = await store.acceptProposalV2(project.id, proposal.id);

    expect(accepted.project.rules).toEqual([
      {
        id: 'pinned_rule_v2',
        scope: 'project',
        text: 'Never show a logo',
        predicate: null,
        createdAt: '2026-08-17T12:00:01.000Z',
      },
    ]);
    expect(accepted.project.undoHistory.at(-1)).toMatchObject({ id: proposal.id, label: 'set_rules' });
  });

  it('returns an empty V2 proposal list without creating a proposal directory family', async () => {
    const { store } = createStoreV2({ createId: () => 'empty_proposals_v2', now: () => timestamp });
    const project = await store.createProjectV2(inputV2);
    const projectDir = realpathSync(path.join(rootDir, project.id));
    const before = snapshotTreeV2(projectDir);

    await expect(store.listProposalsV2(project.id)).resolves.toEqual([]);

    expect(snapshotTreeV2(projectDir)).toEqual(before);
    expect(existsSync(path.join(projectDir, 'proposals'))).toBe(false);
  });

  it.each([
    {
      stage: 'attribution link',
      exactBefore: true,
      fail: (method: string, args: readonly unknown[], projectDir: string) =>
        method === 'link' && String(args[1]) === path.join(projectDir, 'proposals', 'commits', 'proposal_crash.json'),
    },
    {
      stage: 'project rename',
      exactBefore: true,
      fail: (method: string, args: readonly unknown[], projectDir: string) =>
        method === 'rename' && String(args[1]) === path.join(projectDir, 'project.json'),
    },
    {
      stage: 'decision link',
      exactBefore: false,
      fail: (method: string, args: readonly unknown[], projectDir: string) =>
        method === 'link' && String(args[1]) === path.join(projectDir, 'proposals', 'decisions', 'proposal_crash.json'),
    },
    {
      stage: 'attribution companion cleanup',
      exactBefore: false,
      fail: (method: string, args: readonly unknown[], projectDir: string) =>
        method === 'rm' &&
        String(args[0]) === path.join(projectDir, 'proposals', 'commits', 'proposal_crash.json.publish'),
    },
    {
      stage: 'attribution quarantine',
      exactBefore: false,
      fail: (method: string, args: readonly unknown[], projectDir: string) =>
        method === 'rename' && String(args[0]) === path.join(projectDir, 'proposals', 'commits', 'proposal_crash.json'),
    },
    {
      stage: 'attribution quarantine cleanup',
      exactBefore: false,
      fail: (method: string, args: readonly unknown[], projectDir: string) =>
        method === 'rm' &&
        String(args[0]).startsWith(path.join(projectDir, 'proposals', 'commits', 'proposal_crash.json.')) &&
        String(args[0]).endsWith('.cleanup'),
    },
    {
      stage: 'slot quarantine',
      exactBefore: false,
      fail: (method: string, args: readonly unknown[], projectDir: string) =>
        method === 'rename' && String(args[0]) === path.join(projectDir, 'proposals', 'slots', '0.slot'),
    },
    {
      stage: 'slot quarantine cleanup',
      exactBefore: false,
      fail: (method: string, args: readonly unknown[], projectDir: string) =>
        method === 'rm' &&
        String(args[0]).startsWith(path.join(projectDir, 'proposals', 'slots', '0.slot.')) &&
        String(args[0]).endsWith('.cleanup'),
    },
  ])('repairs a restart after an injected $stage crash without reducer replay', async ({ exactBefore, fail }) => {
    const base = createStoreV2({
      createId: () => 'crash_project_v2',
      now: () => '2026-08-17T12:00:00.000Z',
    }).store;
    const project = await base.createProjectV2(inputV2);
    const { proposal, directories } = await seedProposalV2(base, project, { proposalId: 'proposal_crash' });
    const projectDir = realpathSync(path.join(rootDir, project.id));
    const crashing = createCreativeStudioStore({
      rootDir,
      fs: failFileSystemOnceV2((method, args) => fail(method, args, projectDir)),
      now: () => '2026-08-17T12:00:01.000Z',
      logError: () => undefined,
    });

    await expect(crashing.acceptProposalV2(project.id, proposal.id)).rejects.toMatchObject({ code: 'storage_error' });

    const restarted = createStoreV2({ now: () => '2026-08-17T12:00:02.000Z' }).store;
    const loaded = await restarted.getProjectV2(project.id);
    expect(loaded.status).toBe('supported');
    if (loaded.status !== 'supported') throw new Error('expected supported project');
    expect(loaded.project.revision).toBe(exactBefore ? project.revision : project.revision + 1);
    const repaired = await restarted.listProposalsV2(project.id);
    expect(repaired).toHaveLength(1);
    expect(repaired[0].status).toBe(exactBefore ? 'pending' : 'accepted');
    expect(readdirSync(directories.commits)).toEqual([]);

    const retry = await restarted.acceptProposalV2(project.id, proposal.id);
    expect(retry.applied).toBe(exactBefore);
    expect(retry.project.revision).toBe(project.revision + 1);
    expect(retry.project.undoHistory.filter((entry) => entry.id === proposal.id)).toHaveLength(1);
    expect(readdirSync(directories.slots)).toEqual([]);
  });

  it('rechecks exact project temp bytes after async proposal authority before rename', async () => {
    const base = createStoreV2({ createId: () => 'project_temp_race_v2', now: () => timestamp }).store;
    const project = await base.createProjectV2(inputV2);
    const seeded = await seedProposalV2(base, project, { proposalId: 'proposal_project_temp_race' });
    const projectDir = path.join(rootDir, project.id);
    const projectFile = path.join(projectDir, 'project.json');
    const projectBefore = readFileSync(projectFile);
    let replacedTemporary = false;
    const racingFs = new Proxy(nodeFs, {
      get(target, property, receiver) {
        const value = Reflect.get(target, property, receiver) as unknown;
        if (property !== 'readdir' || typeof value !== 'function') return value;
        return (...args: unknown[]): unknown => {
          if (!replacedTemporary && String(args[0]).endsWith('/proposals/commits')) {
            const temporary = readdirSync(projectDir).find(
              (name) => name.startsWith('project.json.') && name.endsWith('.tmp')
            );
            if (temporary !== undefined) {
              replacedTemporary = true;
              writeFileSync(path.join(projectDir, temporary), '{"third":"state"}');
            }
          }
          return Reflect.apply(value, target, args);
        };
      },
    }) as typeof nodeFs;
    const racing = createCreativeStudioStore({
      rootDir,
      fs: racingFs,
      now: () => '2026-08-17T12:00:01.000Z',
      logError: () => undefined,
    });

    await expect(racing.acceptProposalV2(project.id, seeded.proposal.id)).rejects.toMatchObject({
      code: 'storage_error',
    });
    expect(replacedTemporary).toBe(true);
    expect(readFileSync(projectFile)).toEqual(projectBefore);

    const restarted = createStoreV2({ now: () => '2026-08-17T12:00:02.000Z' }).store;
    await expect(restarted.getProjectV2(project.id)).resolves.toMatchObject({
      status: 'supported',
      project: { revision: project.revision },
    });
    expect(readdirSync(seeded.directories.commits)).toEqual([]);
  });

  it('rechecks the project CAS after temp verification and preserves a newer project before proposal rename', async () => {
    const base = createStoreV2({ createId: () => 'project_cas_race_v2', now: () => timestamp }).store;
    const project = await base.createProjectV2(inputV2);
    const seeded = await seedProposalV2(base, project, { proposalId: 'proposal_project_cas_race' });
    const projectDir = realpathSync(path.join(rootDir, project.id));
    const projectFile = path.join(projectDir, 'project.json');
    const externalProject = {
      ...(JSON.parse(readFileSync(projectFile, 'utf8')) as StudioProjectV2),
      name: 'External winner',
      revision: project.revision + 1,
      updatedAt: '2026-08-17T12:00:00.500Z',
    };
    const externalBytes = `${JSON.stringify(externalProject, null, 2)}\n`;
    let replacedProject = false;
    const racingFs = new Proxy(nodeFs, {
      get(target, property, receiver) {
        const value = Reflect.get(target, property, receiver) as unknown;
        if (property !== 'realpath' || typeof value !== 'function') return value;
        return (...args: unknown[]): unknown => {
          const projectTemporaryExists = readdirSync(projectDir).some(
            (name) => name.startsWith('project.json.') && name.endsWith('.tmp')
          );
          if (!replacedProject && String(args[0]) === projectDir && projectTemporaryExists) {
            const replacement = `${projectFile}.external`;
            writeFileSync(replacement, externalBytes);
            renameSync(replacement, projectFile);
            replacedProject = true;
          }
          return Reflect.apply(value, target, args);
        };
      },
    }) as typeof nodeFs;
    const racing = createCreativeStudioStore({
      rootDir,
      fs: racingFs,
      now: () => '2026-08-17T12:00:01.000Z',
      logError: () => undefined,
    });

    await expect(racing.acceptProposalV2(project.id, seeded.proposal.id)).rejects.toMatchObject({
      code: 'storage_error',
    });
    expect(replacedProject).toBe(true);
    expect(readFileSync(projectFile, 'utf8')).toBe(externalBytes);
  });

  it('fails every fenced project operation on attribution mismatch and preserves the byte tree', async () => {
    const { store } = createStoreV2({
      createId: () => 'mismatch_project_v2',
      now: () => '2026-08-17T12:00:01.000Z',
    });
    const project = await store.createProjectV2(inputV2);
    const { proposal, directories } = await seedProposalV2(store, project, { proposalId: 'proposal_mismatch' });
    const projectBytes = readFileSync(path.join(rootDir, project.id, 'project.json'), 'utf8');
    const attribution: StudioProposalCommitAttributionV2 = {
      schemaVersion: 2,
      proposalId: proposal.id,
      projectId: project.id,
      baseRevision: project.revision,
      appliedRevision: project.revision + 1,
      beforeProjectSha256: createHash('sha256').update(projectBytes).digest('hex'),
      afterProjectSha256: 'b'.repeat(64),
      createdBeatIds: ['forged_beat'],
      createdShotIds: [],
      decidedAt: '2026-08-17T12:00:01.000Z',
    };
    writeFileSync(path.join(directories.commits, `${proposal.id}.json`), JSON.stringify(attribution, null, 2));
    const before = snapshotTreeV2(rootDir);
    const update = vi.fn((current: StudioProjectV2) => current);

    await expect(store.getProjectV2(project.id)).rejects.toMatchObject({ code: 'storage_error' });
    await expect(store.updateProjectV2(project.id, update, project.revision)).rejects.toMatchObject({
      code: 'storage_error',
    });
    await expect(store.deleteProjectV2(project.id, project.revision)).rejects.toMatchObject({ code: 'storage_error' });
    expect(update).not.toHaveBeenCalled();
    expect(snapshotTreeV2(rootDir)).toEqual(before);
  });

  it('fails an exact-before attribution whose decision predates its immutable proposal', async () => {
    const { store } = createStoreV2({ createId: () => 'attribution_clock_v2', now: () => timestamp });
    const project = await store.createProjectV2(inputV2);
    const seeded = await seedProposalV2(store, project, { proposalId: 'proposal_attribution_clock' });
    const projectBytes = readFileSync(path.join(rootDir, project.id, 'project.json'), 'utf8');
    const attribution: StudioProposalCommitAttributionV2 = {
      schemaVersion: 2,
      proposalId: seeded.proposal.id,
      projectId: project.id,
      baseRevision: project.revision,
      appliedRevision: project.revision + 1,
      beforeProjectSha256: createHash('sha256').update(projectBytes).digest('hex'),
      afterProjectSha256: 'c'.repeat(64),
      createdBeatIds: [],
      createdShotIds: [],
      decidedAt: '2026-08-17T11:59:59.000Z',
    };
    const attributionFile = path.join(seeded.directories.commits, `${seeded.proposal.id}.json`);
    writeFileSync(attributionFile, JSON.stringify(attribution));
    linkSync(attributionFile, `${attributionFile}.publish`);
    const before = snapshotTreeV2(path.join(rootDir, project.id));

    await expect(store.getProjectV2(project.id)).rejects.toMatchObject({ code: 'storage_error' });

    expect(snapshotTreeV2(path.join(rootDir, project.id))).toEqual(before);
  });

  it('rejects, expires, reaps, and deduplicates watched V2 proposal status changes', async () => {
    let notifyChange: ((relativeFile: string) => void) | undefined;
    const listener = vi.fn();
    const { store } = createStoreV2({
      createId: () => 'lifecycle_project_v2',
      now: () => '2026-08-17T12:00:01.000Z',
      watchProposalTree: ({ onChange }) => {
        notifyChange = onChange;
        return { close: vi.fn() };
      },
    });
    const project = await store.createProjectV2(inputV2);
    const first = await seedProposalV2(store, project, { proposalId: 'proposal_reject' });
    const stop = await store.watchProposalsV2(listener);
    notifyChange?.(`${project.id}/proposals/pending/${first.proposal.id}.json`);
    notifyChange?.(`${project.id}/proposals/pending/${first.proposal.id}.json`);
    await vi.waitFor(() => expect(listener).toHaveBeenCalledTimes(1));
    const projectBefore = readFileSync(path.join(rootDir, project.id, 'project.json'));
    await expect(store.rejectProposalV2(project.id, first.proposal.id)).resolves.toMatchObject({ status: 'rejected' });
    notifyChange?.(`${project.id}/proposals/decisions/${first.proposal.id}.json`);
    await vi.waitFor(() => expect(listener).toHaveBeenCalledTimes(2));
    expect(readFileSync(path.join(rootDir, project.id, 'project.json'))).toEqual(projectBefore);
    await stop();

    const expiredProposal: StudioProposalRecordV2 = {
      ...first.proposal,
      id: 'proposal_expire',
      createdAt: '2026-08-01T00:00:00.000Z',
    };
    writeFileSync(path.join(first.directories.pending, `${expiredProposal.id}.json`), JSON.stringify(expiredProposal));
    writeFileSync(
      path.join(first.directories.slots, '1.slot'),
      JSON.stringify({ schemaVersion: 2, proposalId: expiredProposal.id, reservedAt: expiredProposal.createdAt })
    );
    await store.reapAbandonedProposalsV2();
    await expect(store.listProposalsV2(project.id)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: first.proposal.id, status: 'rejected' }),
        expect.objectContaining({ id: expiredProposal.id, status: 'expired' }),
      ])
    );
    expect(readdirSync(first.directories.slots)).toEqual([]);
  });

  it('arms the V2 proposal watcher before the first supported project is created', async () => {
    let notifyChange: ((relativeFile: string) => void) | undefined;
    const listener = vi.fn();
    const { store } = createStoreV2({
      createId: () => 'watch_before_project_v2',
      now: () => timestamp,
      watchProposalTree: ({ onChange }) => {
        notifyChange = onChange;
        return { close: vi.fn() };
      },
    });
    const stop = await store.watchProposalsV2(listener);
    const project = await store.createProjectV2(inputV2);
    const seeded = await seedProposalV2(store, project, { proposalId: 'proposal_after_watch' });

    notifyChange?.(`${project.id}/proposals/pending/${seeded.proposal.id}.json`);
    await vi.waitFor(() => expect(listener).toHaveBeenCalledWith(project.id, seeded.proposal.id));
    await stop();
  });

  it('creates only a complete V2 proposal directory generation and refuses a pre-existing partial family', async () => {
    const { store } = createStoreV2({
      createId: vi.fn().mockReturnValueOnce('complete_paths_v2').mockReturnValueOnce('partial_paths_v2'),
      now: () => timestamp,
    });
    const complete = await store.createProjectV2(inputV2);
    const completePaths = await store.resolveProposalPathsV2(complete.id);
    expect(readdirSync(path.join(completePaths.projectDir, 'proposals')).toSorted()).toEqual([
      'commits',
      'decisions',
      'pending',
      'slots',
    ]);

    const partial = await store.createProjectV2(inputV2);
    const partialRoot = path.join(rootDir, partial.id, 'proposals');
    mkdirSync(path.join(partialRoot, 'pending'), { recursive: true });
    mkdirSync(path.join(partialRoot, 'decisions'));
    mkdirSync(path.join(partialRoot, 'slots'));
    await expect(store.resolveProposalPathsV2(partial.id)).rejects.toMatchObject({ code: 'storage_error' });
    expect(readdirSync(partialRoot).toSorted()).toEqual(['decisions', 'pending', 'slots']);
  });

  it.each([
    ['proposal', 'proposals', ['pending', 'decisions', 'slots', 'commits']] as const,
    ['reference', 'reference-requests', ['pending', 'decisions', 'slots', 'receipts']] as const,
  ])('does not publish a staged %s family after the project becomes schema-1', async (kind, family, children) => {
    const projectId = `family_schema_race_${kind}_v2`;
    const base = createStoreV2({ createId: () => projectId, now: () => timestamp }).store;
    await base.createProjectV2(inputV2);
    const projectDirectory = realpathSync(path.join(rootDir, projectId));
    const projectFile = path.join(projectDirectory, 'project.json');
    const replacementBytes = `${JSON.stringify({ schemaVersion: 1, id: projectId, sentinel: kind }, null, 2)}\n`;
    let replaced = false;
    const racingFs = new Proxy(nodeFs, {
      get(target, property, receiver) {
        const value = Reflect.get(target, property, receiver) as unknown;
        if (property !== 'lstat' || typeof value !== 'function') return value;
        return async (...args: Parameters<typeof nodeFs.lstat>) => {
          if (!replaced && String(args[0]) === projectFile) {
            const stageName = readdirSync(projectDirectory).find(
              (name) => name.startsWith(`.${family}.`) && name.endsWith('.tmp')
            );
            const stage = stageName === undefined ? null : path.join(projectDirectory, stageName);
            if (stage !== null && children.every((child) => existsSync(path.join(stage, child)))) {
              const replacement = `${projectFile}.external`;
              writeFileSync(replacement, replacementBytes);
              renameSync(replacement, projectFile);
              replaced = true;
            }
          }
          return nodeFs.lstat(...args);
        };
      },
    }) as typeof nodeFs;
    const racing = createCreativeStudioStore({ rootDir, fs: racingFs, logError: () => undefined });

    const attempt =
      kind === 'proposal' ? racing.resolveProposalPathsV2(projectId) : racing.resolveReferenceRequestPathsV2(projectId);
    await expect(attempt).rejects.toMatchObject({ code: 'storage_error' });
    expect(replaced).toBe(true);
    expect(readFileSync(projectFile, 'utf8')).toBe(replacementBytes);
    expect(existsSync(path.join(projectDirectory, family))).toBe(false);
    expect(readdirSync(projectDirectory).filter((name) => name.startsWith(`.${family}.`))).toEqual([]);
  });

  it('lists, generates, dismisses, and restart-retries one reference handoff without changing project bytes', async () => {
    const ids = ['reference_lifecycle_v2', 'handoff_lifecycle_v2'];
    const { store } = createStoreV2({
      createId: () => ids.shift() ?? 'unexpected_reference_id',
      now: () => '2026-08-17T12:00:02.000Z',
    });
    const created = await store.createProjectV2(inputV2);
    const project = await addActiveReferenceShotsV2(store, created);
    const { request, directories } = await seedReferenceRequestV2(store, project);
    const projectFile = path.join(rootDir, project.id, 'project.json');
    const projectBefore = readFileSync(projectFile);

    await expect(store.listReferenceRequestsV2(project.id)).resolves.toEqual([
      { request, decision: null, receipt: null },
    ]);
    const decided = await store.decideReferenceRequestV2({
      projectId: project.id,
      requestId: request.id,
      expectedRevision: project.revision,
      outcome: { kind: 'generation_gate' },
    });
    expect(decided).toMatchObject({
      request: { id: request.id },
      decision: {
        outcome: { kind: 'generation_gate', handoffId: 'handoff_lifecycle_v2', shotIds: request.shotIds },
      },
      receipt: null,
    });
    expect(readdirSync(directories.slots)).toEqual(['0.slot']);
    const retryDecision = await store.decideReferenceRequestV2({
      projectId: project.id,
      requestId: request.id,
      expectedRevision: 1,
      outcome: { kind: 'generation_gate' },
    });
    expect(retryDecision.decision).toEqual(decided.decision);

    await expect(store.readReferenceGenerationHandoffV2(project.id, 'handoff_lifecycle_v2')).resolves.toEqual(decided);
    const dismissed = await store.recordReferenceGenerationHandoffReceiptV2({
      projectId: project.id,
      handoffId: 'handoff_lifecycle_v2',
      expectedRevision: project.revision,
      result: { kind: 'dismissed' },
    });
    expect(dismissed.receipt).toEqual({
      schemaVersion: 2,
      handoffId: 'handoff_lifecycle_v2',
      requestId: request.id,
      completedAt: '2026-08-17T12:00:02.000Z',
      result: { kind: 'dismissed' },
    });
    expect(readdirSync(directories.slots)).toEqual([]);
    await expect(
      store.recordReferenceGenerationHandoffReceiptV2({
        projectId: project.id,
        handoffId: 'handoff_lifecycle_v2',
        expectedRevision: 1,
        result: { kind: 'dismissed' },
      })
    ).resolves.toEqual(dismissed);
    expect(readFileSync(projectFile)).toEqual(projectBefore);

    const restarted = createStoreV2({ now: () => '2026-08-17T12:00:04.000Z' }).store;
    await expect(restarted.readReferenceGenerationHandoffV2(project.id, 'handoff_lifecycle_v2')).resolves.toEqual(
      dismissed
    );
  });

  it('selects only a current classified Brief image and allows rejection after request shots become inactive', async () => {
    const { store } = createStoreV2({ createId: () => 'reference_import_v2', now: () => timestamp });
    const created = await store.createProjectV2(inputV2);
    const active = await addActiveReferenceShotsV2(store, created);
    const withReference = await store.updateProjectV2(
      active.id,
      (project) => ({
        ...project,
        assets: {
          ...project.assets,
          brief_image: {
            id: 'brief_image',
            projectId: project.id,
            shotId: null,
            mediaKind: 'image',
            mimeType: 'image/png',
            managedAsset: { collection: 'imports', fileName: 'brief_image.png' },
            byteSize: 1,
            sha256: 'a'.repeat(64),
            createdAt: timestamp,
            briefReferenceRole: 'look',
            briefReferenceLabel: 'Look board',
          },
        },
      }),
      active.revision
    );
    const imported = await seedReferenceRequestV2(store, withReference, {
      requestId: 'request_imported',
      slotIndex: 0,
    });
    const projectFile = path.join(rootDir, withReference.id, 'project.json');
    const projectBefore = readFileSync(projectFile);
    await expect(
      store.decideReferenceRequestV2({
        projectId: withReference.id,
        requestId: imported.request.id,
        expectedRevision: withReference.revision,
        outcome: { kind: 'imported_reference', assetId: 'brief_image' },
      })
    ).resolves.toMatchObject({
      decision: {
        outcome: {
          kind: 'imported_reference',
          assetId: 'brief_image',
          projectRevision: withReference.revision,
        },
      },
    });
    expect(readFileSync(projectFile)).toEqual(projectBefore);

    const stale = await seedReferenceRequestV2(store, withReference, {
      requestId: 'request_inactive',
      slotIndex: 1,
    });
    await expect(
      store.decideReferenceRequestV2({
        projectId: withReference.id,
        requestId: stale.request.id,
        expectedRevision: withReference.revision,
        outcome: { kind: 'imported_reference', assetId: 'missing_asset' },
      })
    ).rejects.toMatchObject({ code: 'invalid_payload' });
    const deleted = await store.applyMutationBatchV2(
      {
        schemaVersion: 2,
        projectId: withReference.id,
        expectedRevision: withReference.revision,
        operations: [{ kind: 'delete_shot', shotId: 'shot_reference' }],
      },
      { mutationId: 'delete_reference_shot', capturedAt: timestamp }
    );
    await expect(
      store.decideReferenceRequestV2({
        projectId: withReference.id,
        requestId: stale.request.id,
        expectedRevision: deleted.project.revision,
        outcome: { kind: 'rejected' },
      })
    ).resolves.toMatchObject({ decision: { outcome: { kind: 'rejected' } } });
  });

  it('revalidates imported assets at the selected revision and preserves the immutable decision afterward', async () => {
    const { store } = createStoreV2({ createId: () => 'reference_asset_race_v2', now: () => timestamp });
    const created = await store.createProjectV2(inputV2);
    const active = await addActiveReferenceShotsV2(store, created);
    const asset: StudioAssetV2 = {
      id: 'race_brief_image',
      projectId: active.id,
      shotId: null,
      mediaKind: 'image',
      mimeType: 'image/png',
      managedAsset: { collection: 'imports', fileName: 'race_brief_image.png' },
      byteSize: 1,
      sha256: 'b'.repeat(64),
      createdAt: timestamp,
      briefReferenceRole: 'look',
      briefReferenceLabel: 'Race look',
    };
    const selected = await store.updateProjectV2(
      active.id,
      (project) => ({ ...project, assets: { ...project.assets, [asset.id]: asset } }),
      active.revision
    );
    const seeded = await seedReferenceRequestV2(store, selected, { requestId: 'asset_race_request' });
    const detached = await store.updateProjectV2(
      selected.id,
      (project) => {
        const assets = { ...project.assets };
        delete assets[asset.id];
        return { ...project, assets };
      },
      selected.revision
    );

    await expect(
      store.decideReferenceRequestV2({
        projectId: selected.id,
        requestId: seeded.request.id,
        expectedRevision: selected.revision,
        outcome: { kind: 'imported_reference', assetId: asset.id },
      })
    ).rejects.toMatchObject({ code: 'stale_project' });
    await expect(
      store.decideReferenceRequestV2({
        projectId: selected.id,
        requestId: seeded.request.id,
        expectedRevision: detached.revision,
        outcome: { kind: 'imported_reference', assetId: asset.id },
      })
    ).rejects.toMatchObject({ code: 'invalid_payload' });
    expect(readdirSync(seeded.directories.decisions)).toEqual([]);
    expect(readdirSync(seeded.directories.slots)).toEqual(['0.slot']);

    const reattached = await store.updateProjectV2(
      selected.id,
      (project) => ({ ...project, assets: { ...project.assets, [asset.id]: asset } }),
      detached.revision
    );
    const imported = await store.decideReferenceRequestV2({
      projectId: selected.id,
      requestId: seeded.request.id,
      expectedRevision: reattached.revision,
      outcome: { kind: 'imported_reference', assetId: asset.id },
    });
    expect(imported.decision?.outcome).toEqual({
      kind: 'imported_reference',
      assetId: asset.id,
      projectRevision: reattached.revision,
    });
    const detachedAgain = await store.updateProjectV2(
      selected.id,
      (project) => {
        const assets = { ...project.assets };
        delete assets[asset.id];
        return { ...project, assets };
      },
      reattached.revision
    );
    await expect(
      store.decideReferenceRequestV2({
        projectId: selected.id,
        requestId: seeded.request.id,
        expectedRevision: reattached.revision,
        outcome: { kind: 'imported_reference', assetId: asset.id },
      })
    ).resolves.toEqual(imported);
    await expect(store.listReferenceRequestsV2(detachedAgain.id)).resolves.toContainEqual(imported);
  });

  it('rejects a same-inode project and asset replacement at the imported-decision publication gate', async () => {
    const { store } = createStoreV2({ createId: () => 'asset_publication_race_v2', now: () => timestamp });
    const active = await addActiveReferenceShotsV2(store, await store.createProjectV2(inputV2));
    const asset: StudioAssetV2 = {
      id: 'publication_race_image',
      projectId: active.id,
      shotId: null,
      mediaKind: 'image',
      mimeType: 'image/png',
      managedAsset: { collection: 'imports', fileName: 'publication_race_image.png' },
      byteSize: 1,
      sha256: 'e'.repeat(64),
      createdAt: timestamp,
      briefReferenceRole: 'look',
      briefReferenceLabel: 'Publication race',
    };
    const selected = await store.updateProjectV2(
      active.id,
      (project) => ({ ...project, assets: { ...project.assets, [asset.id]: asset } }),
      active.revision
    );
    const seeded = await seedReferenceRequestV2(store, selected, { requestId: 'asset_publication_race_request' });
    const replacement = structuredClone(selected);
    delete replacement.assets[asset.id];
    let replaced = false;
    const racingFs = new Proxy(nodeFs, {
      get(target, property, receiver) {
        const value = Reflect.get(target, property, receiver) as unknown;
        if (property !== 'open' || typeof value !== 'function') return value;
        return (...args: unknown[]): unknown => {
          const openedFile = String(args[0]);
          if (
            !replaced &&
            openedFile.endsWith(`/${selected.id}/project.json`) &&
            readdirSync(seeded.directories.decisions).some((name) => name.endsWith('.publish'))
          ) {
            replaced = true;
            writeFileSync(openedFile, JSON.stringify(replacement, null, 2));
          }
          return Reflect.apply(value, target, args);
        };
      },
    }) as typeof nodeFs;
    const racing = createCreativeStudioStore({ rootDir, fs: racingFs, now: () => timestamp });

    await expect(
      racing.decideReferenceRequestV2({
        projectId: selected.id,
        requestId: seeded.request.id,
        expectedRevision: selected.revision,
        outcome: { kind: 'imported_reference', assetId: asset.id },
      })
    ).rejects.toMatchObject({ code: 'storage_error' });

    expect(replaced).toBe(true);
    expect(readdirSync(seeded.directories.decisions)).toEqual([]);
    expect(readdirSync(seeded.directories.slots)).toEqual(['0.slot']);
    expect(readJson<StudioProjectV2>(path.join(rootDir, selected.id, 'project.json')).assets[asset.id]).toBeUndefined();
  });

  it('rejects hidden and symbol extras on reference decision and receipt inputs before touching the ledger', async () => {
    const ids = ['exact_input_project', 'exact_input_handoff'];
    const { store } = createStoreV2({ createId: () => ids.shift() ?? 'unexpected_id', now: () => timestamp });
    const project = await addActiveReferenceShotsV2(store, await store.createProjectV2(inputV2));
    const seeded = await seedReferenceRequestV2(store, project, { requestId: 'exact_input_request' });
    const decisionInput = {
      projectId: project.id,
      requestId: seeded.request.id,
      expectedRevision: project.revision,
      outcome: { kind: 'generation_gate' as const },
    };
    Object.defineProperty(decisionInput.outcome, 'hidden', { value: true, enumerable: false });
    const before = snapshotTreeV2(seeded.directories.root);
    await expect(store.decideReferenceRequestV2(decisionInput)).rejects.toMatchObject({ code: 'invalid_payload' });
    expect(snapshotTreeV2(seeded.directories.root)).toEqual(before);

    const generated = await seedGenerationHandoffV2(store, project, {
      requestId: 'exact_receipt_request',
      slotIndex: 1,
    });
    const receiptInput = {
      projectId: project.id,
      handoffId: generated.handoffId,
      expectedRevision: project.revision,
      result: { kind: 'dismissed' as const },
    };
    Object.defineProperty(receiptInput, Symbol('extra'), { value: true, enumerable: false });
    const receiptBefore = snapshotTreeV2(generated.directories.root);
    await expect(store.recordReferenceGenerationHandoffReceiptV2(receiptInput)).rejects.toMatchObject({
      code: 'invalid_payload',
    });
    expect(snapshotTreeV2(generated.directories.root)).toEqual(receiptBefore);
  });

  it('rejects every malformed reference decision and receipt shape before touching the ledger', async () => {
    const ids = ['reference_input_contract_v2', 'reference_input_contract_handoff_v2'];
    const { store } = createStoreV2({ createId: () => ids.shift() ?? 'unexpected_id', now: () => timestamp });
    const project = await addActiveReferenceShotsV2(store, await store.createProjectV2(inputV2));
    const seeded = await seedReferenceRequestV2(store, project, { requestId: 'reference_input_contract_request' });
    const decisionInput = {
      projectId: project.id,
      requestId: seeded.request.id,
      expectedRevision: project.revision,
      outcome: { kind: 'generation_gate' as const },
    };
    const before = snapshotTreeV2(seeded.directories.root);
    const malformedDecisions: unknown[] = [
      null,
      { ...decisionInput, extra: true },
      { ...decisionInput, projectId: '../unsafe' },
      { ...decisionInput, requestId: '../unsafe' },
      { ...decisionInput, expectedRevision: 0 },
      { ...decisionInput, outcome: null },
      { ...decisionInput, outcome: { kind: 'rejected', extra: true } },
      { ...decisionInput, outcome: { kind: 'generation_gate', extra: true } },
      { ...decisionInput, outcome: { kind: 'imported_reference', assetId: 'asset', extra: true } },
      { ...decisionInput, outcome: { kind: 'imported_reference', assetId: '../unsafe' } },
      { ...decisionInput, outcome: { kind: 'unknown' } },
    ];
    for (const malformed of malformedDecisions) {
      // Each malformed shape is deliberately outside the public TypeScript contract.
      // eslint-disable-next-line no-await-in-loop
      await expect(store.decideReferenceRequestV2(malformed as never)).rejects.toMatchObject({
        code: 'invalid_payload',
      });
    }
    expect(snapshotTreeV2(seeded.directories.root)).toEqual(before);

    const generated = await seedGenerationHandoffV2(store, project, {
      requestId: 'reference_receipt_contract_request',
      slotIndex: 1,
    });
    const receiptInput = {
      projectId: project.id,
      handoffId: generated.handoffId,
      expectedRevision: project.revision,
      result: { kind: 'dismissed' as const },
    };
    const receiptBefore = snapshotTreeV2(generated.directories.root);
    const malformedReceipts: unknown[] = [
      null,
      { ...receiptInput, extra: true },
      { ...receiptInput, projectId: '../unsafe' },
      { ...receiptInput, handoffId: '../unsafe' },
      { ...receiptInput, expectedRevision: 0 },
      { ...receiptInput, result: null },
      { ...receiptInput, result: { kind: 'dismissed', extra: true } },
      { ...receiptInput, result: { kind: 'confirmed', authorizationId: 'authorization', extra: true } },
      { ...receiptInput, result: { kind: 'confirmed', authorizationId: '../unsafe' } },
      { ...receiptInput, result: { kind: 'unknown' } },
    ];
    for (const malformed of malformedReceipts) {
      // Each malformed shape is deliberately outside the public TypeScript contract.
      // eslint-disable-next-line no-await-in-loop
      await expect(store.recordReferenceGenerationHandoffReceiptV2(malformed as never)).rejects.toMatchObject({
        code: 'invalid_payload',
      });
    }
    expect(snapshotTreeV2(generated.directories.root)).toEqual(receiptBefore);
  });

  it('rejects unsafe proposal and reference identities at every public ledger boundary', async () => {
    const { store } = createStoreV2({ createId: () => 'ledger_identity_contract_v2', now: () => timestamp });
    const project = await store.createProjectV2(inputV2);

    await expect(store.listProposalsV2('../unsafe')).rejects.toMatchObject({ code: 'invalid_payload' });
    await expect(store.acceptProposalV2('../unsafe', 'proposal')).rejects.toMatchObject({ code: 'invalid_payload' });
    await expect(store.acceptProposalV2(project.id, '../unsafe')).rejects.toMatchObject({ code: 'invalid_payload' });
    await expect(store.rejectProposalV2('../unsafe', 'proposal')).rejects.toMatchObject({ code: 'invalid_payload' });
    await expect(store.rejectProposalV2(project.id, '../unsafe')).rejects.toMatchObject({ code: 'invalid_payload' });
    await expect(store.resolveProposalPathsV2('../unsafe')).rejects.toMatchObject({ code: 'invalid_payload' });
    await expect(store.listReferenceRequestsV2('../unsafe')).rejects.toMatchObject({ code: 'invalid_payload' });
    await expect(store.resolveReferenceRequestPathsV2('../unsafe')).rejects.toMatchObject({ code: 'invalid_payload' });
    await expect(store.readReferenceGenerationHandoffV2('../unsafe', 'handoff')).rejects.toMatchObject({
      code: 'invalid_payload',
    });
    await expect(store.readReferenceGenerationHandoffV2(project.id, '../unsafe')).rejects.toMatchObject({
      code: 'invalid_payload',
    });
  });

  it('distinguishes absent ledgers from empty ledgers at every proposal and reference lookup boundary', async () => {
    const { store } = createStoreV2({ createId: () => 'empty_ledger_contract_v2', now: () => timestamp });
    const project = await store.createProjectV2(inputV2);
    const missingReceipt = {
      projectId: project.id,
      handoffId: 'missing_handoff',
      expectedRevision: project.revision,
      result: { kind: 'dismissed' as const },
    };
    const missingDecision = {
      projectId: project.id,
      requestId: 'missing_request',
      expectedRevision: project.revision,
      outcome: { kind: 'rejected' as const },
    };

    await expect(store.acceptProposalV2(project.id, 'missing_proposal')).rejects.toMatchObject({ code: 'not_found' });
    await expect(store.rejectProposalV2(project.id, 'missing_proposal')).rejects.toMatchObject({ code: 'not_found' });
    await expect(store.decideReferenceRequestV2(missingDecision)).rejects.toMatchObject({ code: 'not_found' });
    await expect(store.recordReferenceGenerationHandoffReceiptV2(missingReceipt)).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(store.readReferenceGenerationHandoffV2(project.id, 'missing_handoff')).resolves.toBeNull();

    await store.resolveProposalPathsV2(project.id);
    await store.resolveReferenceRequestPathsV2(project.id);
    await expect(store.acceptProposalV2(project.id, 'missing_proposal')).rejects.toMatchObject({ code: 'not_found' });
    await expect(store.rejectProposalV2(project.id, 'missing_proposal')).rejects.toMatchObject({ code: 'not_found' });
    await expect(store.decideReferenceRequestV2(missingDecision)).rejects.toMatchObject({ code: 'not_found' });
    await expect(store.recordReferenceGenerationHandoffReceiptV2(missingReceipt)).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(store.readReferenceGenerationHandoffV2(project.id, 'missing_handoff')).resolves.toBeNull();
  });

  it('fails closed without mutation for malformed proposal and reference directory entries', async () => {
    const { store } = createStoreV2({ createId: () => 'malformed_ledger_entries_v2', now: () => timestamp });
    const project = await addActiveReferenceShotsV2(store, await store.createProjectV2(inputV2));
    const proposal = await seedProposalV2(store, project, { proposalId: 'malformed_entry_proposal' });
    const reference = await seedReferenceRequestV2(store, project, {
      requestId: 'malformed_entry_reference',
    });
    const cases: Array<{ root: string; directory: string; name: string; list: () => Promise<unknown> }> = [
      {
        root: proposal.directories.root,
        directory: proposal.directories.pending,
        name: 'not-json.txt',
        list: () => store.listProposalsV2(project.id),
      },
      {
        root: proposal.directories.root,
        directory: proposal.directories.pending,
        name: '.json',
        list: () => store.listProposalsV2(project.id),
      },
      {
        root: proposal.directories.root,
        directory: proposal.directories.decisions,
        name: 'not-json.txt',
        list: () => store.listProposalsV2(project.id),
      },
      {
        root: proposal.directories.root,
        directory: proposal.directories.decisions,
        name: '.json',
        list: () => store.listProposalsV2(project.id),
      },
      {
        root: proposal.directories.root,
        directory: proposal.directories.slots,
        name: '99.slot',
        list: () => store.listProposalsV2(project.id),
      },
      {
        root: proposal.directories.root,
        directory: proposal.directories.commits,
        name: 'not-commit.txt',
        list: () => store.listProposalsV2(project.id),
      },
      {
        root: proposal.directories.root,
        directory: proposal.directories.commits,
        name: '.accepted.json',
        list: () => store.listProposalsV2(project.id),
      },
      {
        root: reference.directories.root,
        directory: reference.directories.pending,
        name: 'not-json.txt',
        list: () => store.listReferenceRequestsV2(project.id),
      },
      {
        root: reference.directories.root,
        directory: reference.directories.pending,
        name: '.json',
        list: () => store.listReferenceRequestsV2(project.id),
      },
      {
        root: reference.directories.root,
        directory: reference.directories.decisions,
        name: 'not-json.txt',
        list: () => store.listReferenceRequestsV2(project.id),
      },
      {
        root: reference.directories.root,
        directory: reference.directories.decisions,
        name: '.json',
        list: () => store.listReferenceRequestsV2(project.id),
      },
      {
        root: reference.directories.root,
        directory: reference.directories.slots,
        name: '99.slot',
        list: () => store.listReferenceRequestsV2(project.id),
      },
      {
        root: reference.directories.root,
        directory: reference.directories.receipts,
        name: 'not-json.txt',
        list: () => store.listReferenceRequestsV2(project.id),
      },
      {
        root: reference.directories.root,
        directory: reference.directories.receipts,
        name: '.json',
        list: () => store.listReferenceRequestsV2(project.id),
      },
    ];

    for (const malformed of cases) {
      const file = path.join(malformed.directory, malformed.name);
      writeFileSync(file, '{}');
      const before = snapshotTreeV2(malformed.root);
      // Each case uses a different durable ledger namespace.
      // eslint-disable-next-line no-await-in-loop
      await expect(malformed.list()).rejects.toMatchObject({ code: 'storage_error' });
      expect(snapshotTreeV2(malformed.root)).toEqual(before);
      rmSync(file);
    }
    await expect(store.listProposalsV2(project.id)).resolves.toHaveLength(1);
    await expect(store.listReferenceRequestsV2(project.id)).resolves.toHaveLength(1);
  });

  it('rejects malformed terminal journal publications without promoting or removing them', async () => {
    const { store } = createStoreV2({ createId: () => 'malformed_terminal_publications_v2', now: () => timestamp });
    const project = await addActiveReferenceShotsV2(store, await store.createProjectV2(inputV2));
    const proposal = await seedProposalV2(store, project, { proposalId: 'malformed_journal_proposal' });
    const reference = await seedReferenceRequestV2(store, project, {
      requestId: 'malformed_journal_reference',
    });
    const cases: Array<{ root: string; file: string; bytes: string; list: () => Promise<unknown> }> = [
      {
        root: proposal.directories.root,
        file: path.join(proposal.directories.decisions, `${proposal.proposal.id}.json.publish`),
        bytes: '{}',
        list: () => store.listProposalsV2(project.id),
      },
      {
        root: proposal.directories.root,
        file: path.join(proposal.directories.commits, `${proposal.proposal.id}.accepted.json.publish`),
        bytes: JSON.stringify({ schemaVersion: 1 }),
        list: () => store.listProposalsV2(project.id),
      },
      {
        root: reference.directories.root,
        file: path.join(reference.directories.decisions, `${reference.request.id}.json.publish`),
        bytes: '{}',
        list: () => store.listReferenceRequestsV2(project.id),
      },
      {
        root: reference.directories.root,
        file: path.join(reference.directories.receipts, 'malformed_handoff.json.publish'),
        bytes: '{}',
        list: () => store.listReferenceRequestsV2(project.id),
      },
    ];

    for (const malformed of cases) {
      writeFileSync(malformed.file, malformed.bytes);
      const before = snapshotTreeV2(malformed.root);
      // Each malformed publication must fail before recovery mutates the journal.
      // eslint-disable-next-line no-await-in-loop
      await expect(malformed.list()).rejects.toMatchObject({ code: 'storage_error' });
      expect(snapshotTreeV2(malformed.root)).toEqual(before);
      rmSync(malformed.file);
    }
  });

  it('fails closed for missing or duplicate proposal and reference slot authority', async () => {
    const { store } = createStoreV2({ createId: () => 'slot_authority_contract_v2', now: () => timestamp });
    const project = await addActiveReferenceShotsV2(store, await store.createProjectV2(inputV2));
    const proposal = await seedProposalV2(store, project, { proposalId: 'slot_authority_proposal' });
    const proposalSlot = path.join(proposal.directories.slots, '0.slot');
    const proposalSlotBytes = readFileSync(proposalSlot);
    const duplicateProposalSlot = path.join(proposal.directories.slots, '1.slot');
    writeFileSync(duplicateProposalSlot, proposalSlotBytes);
    await expect(store.listProposalsV2(project.id)).rejects.toMatchObject({ code: 'storage_error' });
    rmSync(duplicateProposalSlot);
    rmSync(proposalSlot);
    await expect(store.listProposalsV2(project.id)).rejects.toMatchObject({ code: 'storage_error' });
    writeFileSync(proposalSlot, proposalSlotBytes);

    const reference = await seedReferenceRequestV2(store, project, {
      requestId: 'slot_authority_reference',
    });
    const referenceSlot = path.join(reference.directories.slots, '0.slot');
    const referenceSlotBytes = readFileSync(referenceSlot);
    const duplicateReferenceSlot = path.join(reference.directories.slots, '1.slot');
    writeFileSync(duplicateReferenceSlot, referenceSlotBytes);
    await expect(store.listReferenceRequestsV2(project.id)).rejects.toMatchObject({ code: 'storage_error' });
    rmSync(duplicateReferenceSlot);
    rmSync(referenceSlot);
    await expect(store.listReferenceRequestsV2(project.id)).rejects.toMatchObject({ code: 'storage_error' });
  });

  it('repairs an authorization-origin handoff into one exact confirmed receipt before project exposure', async () => {
    const ids = ['reference_repair_v2', 'handoff_repair_v2'];
    const { store } = createStoreV2({
      createId: () => ids.shift() ?? 'unexpected_reference_id',
      now: () => '2026-08-17T12:00:02.000Z',
    });
    const created = await store.createProjectV2(inputV2);
    const project = await addActiveReferenceShotsV2(store, created);
    const { request, slot, directories } = await seedReferenceRequestV2(store, project, {
      requestId: 'request_repair',
    });
    const decided = await store.decideReferenceRequestV2({
      projectId: project.id,
      requestId: request.id,
      expectedRevision: project.revision,
      outcome: { kind: 'generation_gate' },
    });
    const handoffId = (
      decided.decision as StudioReferenceRequestDecisionV2 & {
        outcome: { kind: 'generation_gate'; handoffId: string; shotIds: string[] };
      }
    ).outcome.handoffId;
    const authorized = await store.updateProjectV2(
      project.id,
      (draft) => addReferenceAuthorizationV2(draft, handoffId),
      project.revision
    );
    const receiptFile = path.join(directories.receipts, `${handoffId}.json`);
    rmSync(receiptFile);
    rmSync(`${receiptFile}.publish`);
    writeFileSync(path.join(directories.slots, '0.slot'), JSON.stringify(slot));
    expect(readdirSync(directories.receipts)).toEqual([]);

    await expect(store.getProjectV2(project.id)).resolves.toMatchObject({
      status: 'supported',
      project: { revision: authorized.revision },
    });
    const receipt = readJson<StudioReferenceGenerationHandoffReceiptV2>(
      path.join(directories.receipts, `${handoffId}.json`)
    );
    expect(receipt).toEqual({
      schemaVersion: 2,
      handoffId,
      requestId: request.id,
      completedAt: '2026-08-17T12:00:03.000Z',
      result: { kind: 'confirmed', authorizationId: `authorization_${handoffId}` },
    });
    expect(readdirSync(directories.slots)).toEqual([]);
    await expect(store.listReferenceRequestsV2(project.id)).resolves.toEqual([expect.objectContaining({ receipt })]);
  });

  it('arms the reference watcher before any V2 project and expires old requests with deduplicated notifications', async () => {
    let notifyChange: ((relativeFile: string) => void) | undefined;
    const listener = vi.fn();
    const { store } = createStoreV2({
      createId: () => 'reference_watch_v2',
      now: () => '2026-08-17T12:00:02.000Z',
      watchProposalTree: ({ onChange }) => {
        notifyChange = onChange;
        return { close: vi.fn() };
      },
    });
    const stop = await store.watchReferenceRequestsV2(listener);
    const project = await store.createProjectV2(inputV2);
    const active = await addActiveReferenceShotsV2(store, project);
    const seeded = await seedReferenceRequestV2(store, active, { requestId: 'request_watch' });
    notifyChange?.(`${active.id}/reference-requests/pending/${seeded.request.id}.json`);
    notifyChange?.(`${active.id}/reference-requests/pending/${seeded.request.id}.json`);
    await vi.waitFor(() => expect(listener).toHaveBeenCalledTimes(1));
    writeFileSync(
      path.join(seeded.directories.pending, `${seeded.request.id}.json`),
      JSON.stringify({ ...seeded.request, createdAt: '2026-08-17T12:00:01.000Z' })
    );
    notifyChange?.(`${active.id}/reference-requests/pending/${seeded.request.id}.json`);
    await vi.waitFor(() => expect(listener).toHaveBeenCalledTimes(2));
    await store.decideReferenceRequestV2({
      projectId: active.id,
      requestId: seeded.request.id,
      expectedRevision: active.revision,
      outcome: { kind: 'rejected' },
    });
    notifyChange?.(`${active.id}/reference-requests/decisions/${seeded.request.id}.json`);
    await vi.waitFor(() => expect(listener).toHaveBeenCalledTimes(3));
    await stop();

    const expired = await seedReferenceRequestV2(store, active, {
      requestId: 'request_expired',
      createdAt: '2026-08-01T00:00:00.000Z',
      slotIndex: 1,
    });
    await store.reapAbandonedReferenceRequestsV2();
    await expect(store.listReferenceRequestsV2(active.id)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          request: expect.objectContaining({ id: expired.request.id }),
          decision: expect.objectContaining({ outcome: { kind: 'expired' } }),
        }),
      ])
    );
    expect(readdirSync(expired.directories.slots)).toEqual([]);
  });

  it('creates a complete reference directory family, keeps list read-only, and refuses a partial family', async () => {
    const { store } = createStoreV2({
      createId: vi.fn().mockReturnValueOnce('reference_paths_v2').mockReturnValueOnce('reference_partial_v2'),
      now: () => timestamp,
    });
    const project = await store.createProjectV2(inputV2);
    await expect(store.listReferenceRequestsV2(project.id)).resolves.toEqual([]);
    expect(existsSync(path.join(rootDir, project.id, 'reference-requests'))).toBe(false);
    const paths = await store.resolveReferenceRequestPathsV2(project.id);
    expect(readdirSync(path.join(paths.projectDir, 'reference-requests')).toSorted()).toEqual([
      'decisions',
      'pending',
      'receipts',
      'slots',
    ]);

    const partial = await store.createProjectV2(inputV2);
    const partialRoot = path.join(rootDir, partial.id, 'reference-requests');
    mkdirSync(path.join(partialRoot, 'pending'), { recursive: true });
    mkdirSync(path.join(partialRoot, 'slots'));
    await expect(store.resolveReferenceRequestPathsV2(partial.id)).rejects.toMatchObject({ code: 'storage_error' });
    expect(readdirSync(partialRoot).toSorted()).toEqual(['pending', 'slots']);
  });

  it('rejects a same-project generation handoff collision without changing any reference bytes', async () => {
    const ids = ['reference_collision_v2', 'shared_handoff_v2', 'shared_handoff_v2'];
    const { store } = createStoreV2({
      createId: () => ids.shift() ?? 'unexpected_reference_id',
      now: () => timestamp,
    });
    const created = await store.createProjectV2(inputV2);
    const project = await addActiveReferenceShotsV2(store, created);
    const first = await seedReferenceRequestV2(store, project, { requestId: 'request_collision_a', slotIndex: 0 });
    await store.decideReferenceRequestV2({
      projectId: project.id,
      requestId: first.request.id,
      expectedRevision: project.revision,
      outcome: { kind: 'generation_gate' },
    });
    const second = await seedReferenceRequestV2(store, project, { requestId: 'request_collision_b', slotIndex: 1 });
    const before = snapshotTreeV2(second.directories.root);
    await expect(
      store.decideReferenceRequestV2({
        projectId: project.id,
        requestId: second.request.id,
        expectedRevision: project.revision,
        outcome: { kind: 'generation_gate' },
      })
    ).rejects.toMatchObject({ code: 'storage_error' });
    expect(snapshotTreeV2(second.directories.root)).toEqual(before);
  });

  it.each([
    { label: 'request id', mutate: 'request' as const },
    { label: 'handoff id', mutate: 'handoff' as const },
  ])('fails closed on a receipt whose $label does not match its generation relation', async ({ mutate }) => {
    const ids = [`relation_project_${mutate}`, `relation_handoff_${mutate}`];
    const { store } = createStoreV2({ createId: () => ids.shift() ?? 'unexpected_id', now: () => timestamp });
    const created = await store.createProjectV2(inputV2);
    const project = await addActiveReferenceShotsV2(store, created);
    const generated = await seedGenerationHandoffV2(store, project, { requestId: `relation_request_${mutate}` });
    const receipt: StudioReferenceGenerationHandoffReceiptV2 = {
      schemaVersion: 2,
      handoffId: mutate === 'handoff' ? 'different_handoff' : generated.handoffId,
      requestId: mutate === 'request' ? 'different_request' : generated.request.id,
      completedAt: timestamp,
      result: { kind: 'dismissed' },
    };
    writeFileSync(path.join(generated.directories.receipts, `${generated.handoffId}.json`), JSON.stringify(receipt));
    const before = snapshotTreeV2(generated.directories.root);

    await expect(store.getProjectV2(project.id)).rejects.toMatchObject({ code: 'storage_error' });

    expect(snapshotTreeV2(generated.directories.root)).toEqual(before);
    expect(readdirSync(generated.directories.slots)).toEqual(['0.slot']);
  });

  it.each([
    { label: 'confirmed receipt without authorization', auth: false, result: 'confirmed' as const, early: false },
    { label: 'confirmed receipt with the wrong authorization', auth: true, result: 'confirmed' as const, early: false },
    { label: 'dismissed receipt with authorization', auth: true, result: 'dismissed' as const, early: false },
    { label: 'authorization confirmed before its decision', auth: true, result: null, early: true },
  ])('preserves bytes for $label', async ({ auth, result, early }) => {
    const ids = [`auth_project_${result ?? 'early'}`, `auth_handoff_${result ?? 'early'}`];
    const decisionTime = early ? '2026-08-17T12:00:04.000Z' : timestamp;
    const { store } = createStoreV2({ createId: () => ids.shift() ?? 'unexpected_id', now: () => decisionTime });
    const created = await store.createProjectV2(inputV2);
    const project = await addActiveReferenceShotsV2(store, created);
    const generated = await seedGenerationHandoffV2(store, project, {
      requestId: `auth_request_${result ?? 'early'}`,
    });
    if (auth) {
      writeFileSync(
        path.join(rootDir, project.id, 'project.json'),
        JSON.stringify(addReferenceAuthorizationV2(structuredClone(project), generated.handoffId), null, 2)
      );
    }
    if (result !== null) {
      const receipt: StudioReferenceGenerationHandoffReceiptV2 = {
        schemaVersion: 2,
        handoffId: generated.handoffId,
        requestId: generated.request.id,
        completedAt: '2026-08-17T12:00:03.000Z',
        result:
          result === 'dismissed'
            ? { kind: 'dismissed' }
            : {
                kind: 'confirmed',
                authorizationId: auth ? 'wrong_authorization' : 'missing_authorization',
              },
      };
      const receiptFile = path.join(generated.directories.receipts, `${generated.handoffId}.json`);
      writeFileSync(receiptFile, JSON.stringify(receipt));
      if (auth && result === 'confirmed') linkSync(receiptFile, `${receiptFile}.publish`);
    }
    const before = snapshotTreeV2(path.join(rootDir, project.id));

    await expect(store.getProjectV2(project.id)).rejects.toMatchObject({ code: 'storage_error' });

    expect(snapshotTreeV2(path.join(rootDir, project.id))).toEqual(before);
    expect(readdirSync(generated.directories.slots)).toEqual(['0.slot']);
  });

  it('scopes the same generated handoff identity independently across projects', async () => {
    const ids = ['cross_project_a', 'cross_project_b', 'shared_reference_handoff', 'shared_reference_handoff'];
    const { store } = createStoreV2({ createId: () => ids.shift() ?? 'unexpected_id', now: () => timestamp });
    const first = await addActiveReferenceShotsV2(store, await store.createProjectV2(inputV2));
    const second = await addActiveReferenceShotsV2(store, await store.createProjectV2(inputV2));
    const firstHandoff = await seedGenerationHandoffV2(store, first, { requestId: 'cross_request_a' });
    const secondHandoff = await seedGenerationHandoffV2(store, second, { requestId: 'cross_request_b' });

    expect(firstHandoff.handoffId).toBe('shared_reference_handoff');
    expect(secondHandoff.handoffId).toBe('shared_reference_handoff');
    await expect(store.readReferenceGenerationHandoffV2(first.id, firstHandoff.handoffId)).resolves.toMatchObject({
      request: { id: 'cross_request_a', projectId: first.id },
    });
    await store.recordReferenceGenerationHandoffReceiptV2({
      projectId: first.id,
      handoffId: firstHandoff.handoffId,
      expectedRevision: first.revision,
      result: { kind: 'dismissed' },
    });
    await expect(store.readReferenceGenerationHandoffV2(second.id, secondHandoff.handoffId)).resolves.toMatchObject({
      request: { id: 'cross_request_b', projectId: second.id },
      receipt: null,
    });
  });

  it('restart-reconciles an exact linked reference decision publication residue', async () => {
    const ids = ['decision_publish_project', 'decision_publish_handoff'];
    const base = createStoreV2({ createId: () => ids.shift() ?? 'unexpected_id', now: () => timestamp }).store;
    const created = await base.createProjectV2(inputV2);
    const project = await addActiveReferenceShotsV2(base, created);
    const seeded = await seedReferenceRequestV2(base, project, { requestId: 'decision_publish_request' });
    const decisionFile = path.join(seeded.directories.decisions, `${seeded.request.id}.json`);
    const crashing = createCreativeStudioStore({
      rootDir,
      fs: failFileSystemOnceV2(
        (method, args) =>
          method === 'rm' && String(args[0]).includes('/slots/0.slot.') && String(args[0]).endsWith('.cleanup')
      ),
      now: () => '2026-08-17T12:00:01.000Z',
      logError: () => undefined,
    });

    await expect(
      crashing.decideReferenceRequestV2({
        projectId: project.id,
        requestId: seeded.request.id,
        expectedRevision: project.revision,
        outcome: { kind: 'rejected' },
      })
    ).rejects.toMatchObject({ code: 'storage_error' });
    expect(lstatSync(decisionFile).ino).toBe(lstatSync(`${decisionFile}.publish`).ino);

    const restarted = createStoreV2({ now: () => '2026-08-17T12:00:02.000Z' }).store;
    await expect(restarted.listReferenceRequestsV2(project.id)).resolves.toMatchObject([
      { decision: { outcome: { kind: 'rejected' } } },
    ]);
    expect(existsSync(`${decisionFile}.publish`)).toBe(true);
    expect(readdirSync(seeded.directories.slots)).toEqual([]);
  });

  it('promotes relationally valid temp-only proposal and reference journal records after restart', async () => {
    const ids = ['temp_journal_project', 'temp_journal_handoff'];
    const store = createStoreV2({ createId: () => ids.shift() ?? 'unexpected_id', now: () => timestamp }).store;
    const created = await store.createProjectV2(inputV2);
    const project = await addActiveReferenceShotsV2(store, created);
    const proposal = await seedProposalV2(store, project, { proposalId: 'temp_journal_proposal' });
    const proposalDecisionFile = path.join(proposal.directories.decisions, `${proposal.proposal.id}.json`);
    writeFileSync(
      `${proposalDecisionFile}.publish`,
      JSON.stringify({
        schemaVersion: 2,
        proposalId: proposal.proposal.id,
        status: 'rejected',
        decidedAt: timestamp,
      })
    );
    const reference = await seedReferenceRequestV2(store, project, {
      requestId: 'temp_journal_reference',
      slotIndex: 1,
    });
    const referenceDecisionFile = path.join(reference.directories.decisions, `${reference.request.id}.json`);
    writeFileSync(
      `${referenceDecisionFile}.publish`,
      JSON.stringify({
        schemaVersion: 2,
        requestId: reference.request.id,
        projectId: project.id,
        decidedAt: timestamp,
        outcome: { kind: 'rejected' },
      })
    );

    const restarted = createStoreV2({ now: () => '2026-08-17T12:00:01.000Z' }).store;
    await expect(restarted.listProposalsV2(project.id)).resolves.toMatchObject([
      { id: proposal.proposal.id, status: 'rejected' },
    ]);
    await expect(restarted.listReferenceRequestsV2(project.id)).resolves.toMatchObject([
      { request: { id: reference.request.id }, decision: { outcome: { kind: 'rejected' } } },
    ]);
    expect(existsSync(proposalDecisionFile)).toBe(true);
    expect(existsSync(`${proposalDecisionFile}.publish`)).toBe(true);
    expect(lstatSync(proposalDecisionFile).ino).toBe(lstatSync(`${proposalDecisionFile}.publish`).ino);
    expect(existsSync(referenceDecisionFile)).toBe(true);
    expect(existsSync(`${referenceDecisionFile}.publish`)).toBe(true);
    expect(lstatSync(referenceDecisionFile).ino).toBe(lstatSync(`${referenceDecisionFile}.publish`).ino);
  });

  it('preserves a temp-only journal whose otherwise valid decision predates its immutable source', async () => {
    const { store } = createStoreV2({ createId: () => 'temp_journal_mismatch_v2', now: () => timestamp });
    const project = await store.createProjectV2(inputV2);
    const proposal = await seedProposalV2(store, project, { proposalId: 'temp_journal_mismatch' });
    const decisionFile = path.join(proposal.directories.decisions, `${proposal.proposal.id}.json`);
    const publicationFile = `${decisionFile}.publish`;
    writeFileSync(
      publicationFile,
      JSON.stringify({
        schemaVersion: 2,
        proposalId: proposal.proposal.id,
        status: 'rejected',
        decidedAt: '2026-08-16T23:59:59.999Z',
      })
    );
    const before = snapshotTreeV2(proposal.directories.root);

    await expect(store.listProposalsV2(project.id)).rejects.toMatchObject({ code: 'storage_error' });

    expect(existsSync(decisionFile)).toBe(false);
    expect(existsSync(publicationFile)).toBe(true);
    expect(snapshotTreeV2(proposal.directories.root)).toEqual(before);
  });

  it('restart-reconciles an exact linked receipt publication and receipt-first slot cleanup', async () => {
    const ids = ['receipt_publish_project', 'receipt_publish_handoff'];
    const base = createStoreV2({ createId: () => ids.shift() ?? 'unexpected_id', now: () => timestamp }).store;
    const created = await base.createProjectV2(inputV2);
    const project = await addActiveReferenceShotsV2(base, created);
    const generated = await seedGenerationHandoffV2(base, project, { requestId: 'receipt_publish_request' });
    const receiptFile = path.join(generated.directories.receipts, `${generated.handoffId}.json`);
    const slotFile = path.join(generated.directories.slots, '0.slot');
    const crashingPublication = createCreativeStudioStore({
      rootDir,
      fs: failFileSystemOnceV2(
        (method, args) =>
          method === 'rm' && String(args[0]).includes('/slots/0.slot.') && String(args[0]).endsWith('.cleanup')
      ),
      now: () => '2026-08-17T12:00:02.000Z',
      logError: () => undefined,
    });
    await expect(
      crashingPublication.recordReferenceGenerationHandoffReceiptV2({
        projectId: project.id,
        handoffId: generated.handoffId,
        expectedRevision: project.revision,
        result: { kind: 'dismissed' },
      })
    ).rejects.toMatchObject({ code: 'storage_error' });
    expect(lstatSync(receiptFile).ino).toBe(lstatSync(`${receiptFile}.publish`).ino);
    expect(
      readdirSync(generated.directories.slots).some((name) => name.startsWith('0.slot.') && name.endsWith('.cleanup'))
    ).toBe(true);

    const restarted = createStoreV2({ now: () => '2026-08-17T12:00:04.000Z' }).store;
    const repaired = await restarted.recordReferenceGenerationHandoffReceiptV2({
      projectId: project.id,
      handoffId: generated.handoffId,
      expectedRevision: project.revision,
      result: { kind: 'dismissed' },
    });
    expect(repaired.receipt?.completedAt).toBe('2026-08-17T12:00:02.000Z');
    expect(readdirSync(generated.directories.receipts)).toEqual([
      `${generated.handoffId}.json`,
      `${generated.handoffId}.json.publish`,
    ]);
    expect(readdirSync(generated.directories.slots)).toEqual([]);
  });

  it('reconciles exact linked pending/slot temps and PID slot cleanup residues for both V2 ledgers', async () => {
    const ids = ['residue_project_v2', 'residue_handoff_v2'];
    const { store } = createStoreV2({ createId: () => ids.shift() ?? 'unexpected_id', now: () => timestamp });
    const created = await store.createProjectV2(inputV2);
    const project = await addActiveReferenceShotsV2(store, created);
    const proposal = await seedProposalV2(store, project, { proposalId: 'proposal_residue' });
    const proposalFile = path.join(proposal.directories.pending, `${proposal.proposal.id}.json`);
    const proposalSlot = path.join(proposal.directories.slots, '0.slot');
    linkSync(proposalFile, `${proposalFile}.123_1.tmp`);
    linkSync(proposalSlot, `${proposalSlot}.123_2.tmp`);
    await expect(store.listProposalsV2(project.id)).resolves.toHaveLength(1);
    expect(readdirSync(proposal.directories.pending)).toEqual([`${proposal.proposal.id}.json`]);
    expect(readdirSync(proposal.directories.slots)).toEqual(['0.slot']);

    const proposalWinnerBytes = readFileSync(proposalFile);
    const proposalWinnerInode = lstatSync(proposalFile).ino;
    const collidedProposalTemporary = `${proposalFile}.123_20.tmp`;
    const collidedProposalReady = `${proposalFile}.123_20.ready`;
    writeFileSync(
      collidedProposalTemporary,
      JSON.stringify({ ...proposal.proposal, createdAt: '2026-08-17T12:00:00.001Z' })
    );
    linkSync(collidedProposalTemporary, collidedProposalReady);
    await expect(store.listProposalsV2(project.id)).resolves.toHaveLength(1);
    expect(existsSync(collidedProposalTemporary)).toBe(false);
    expect(existsSync(collidedProposalReady)).toBe(false);
    expect(readFileSync(proposalFile)).toEqual(proposalWinnerBytes);
    expect(lstatSync(proposalFile).ino).toBe(proposalWinnerInode);

    const collidedSlotTemporary = `${proposalSlot}.123_21.tmp`;
    const collidedSlotReady = `${proposalSlot}.123_21.ready`;
    writeFileSync(
      collidedSlotTemporary,
      JSON.stringify({ schemaVersion: 2, proposalId: 'proposal_collision', reservedAt: timestamp })
    );
    linkSync(collidedSlotTemporary, collidedSlotReady);
    await expect(store.listProposalsV2(project.id)).resolves.toHaveLength(1);
    expect(existsSync(collidedSlotTemporary)).toBe(false);
    expect(existsSync(collidedSlotReady)).toBe(false);
    expect(readdirSync(proposal.directories.slots)).toEqual(['0.slot']);

    renameSync(proposalSlot, `${proposalSlot}.123_3.cleanup`);
    await expect(store.listProposalsV2(project.id)).resolves.toHaveLength(1);
    expect(readdirSync(proposal.directories.slots)).toEqual(['0.slot']);
    linkSync(proposalSlot, `${proposalSlot}.123_31.cleanup`);
    await expect(store.listProposalsV2(project.id)).resolves.toHaveLength(1);
    expect(readdirSync(proposal.directories.slots)).toEqual(['0.slot']);

    const rolledBackProposal: StudioProposalRecordV2 = {
      ...proposal.proposal,
      id: 'proposal_temp_only',
    };
    writeFileSync(
      path.join(proposal.directories.pending, 'proposal_temp_only.json.123_4.tmp'),
      JSON.stringify(rolledBackProposal)
    );
    writeFileSync(
      path.join(proposal.directories.slots, '9.slot.123_5.tmp'),
      JSON.stringify({ schemaVersion: 2, proposalId: rolledBackProposal.id, reservedAt: timestamp })
    );
    await expect(store.listProposalsV2(project.id)).resolves.toHaveLength(1);
    expect(readdirSync(proposal.directories.pending)).toEqual([`${proposal.proposal.id}.json`]);
    expect(readdirSync(proposal.directories.slots)).toEqual(['0.slot']);

    const readyProposal: StudioProposalRecordV2 = { ...proposal.proposal, id: 'proposal_ready_phase' };
    const readyProposalFile = path.join(proposal.directories.pending, `${readyProposal.id}.json`);
    const readyProposalTemporary = `${readyProposalFile}.123_32.tmp`;
    const readyProposalPhase = `${readyProposalFile}.123_32.ready`;
    writeFileSync(readyProposalTemporary, JSON.stringify(readyProposal));
    linkSync(readyProposalTemporary, readyProposalPhase);
    writeFileSync(
      path.join(proposal.directories.slots, '2.slot'),
      JSON.stringify({ schemaVersion: 2, proposalId: readyProposal.id, reservedAt: timestamp })
    );
    await expect(store.listProposalsV2(project.id)).resolves.toHaveLength(2);
    expect(lstatSync(readyProposalFile).ino).toBe(lstatSync(readyProposalPhase).ino);
    expect(lstatSync(readyProposalFile).ino).toBe(lstatSync(readyProposalTemporary).ino);

    const orphanProposalSlot = path.join(proposal.directories.slots, '3.slot');
    const orphanProposalTemporary = `${orphanProposalSlot}.123_33.tmp`;
    const orphanProposalPhase = `${orphanProposalSlot}.123_33.ready`;
    writeFileSync(
      orphanProposalTemporary,
      JSON.stringify({ schemaVersion: 2, proposalId: 'proposal_orphan_ready', reservedAt: timestamp })
    );
    linkSync(orphanProposalTemporary, orphanProposalPhase);
    await expect(store.listProposalsV2(project.id)).resolves.toHaveLength(2);
    expect(existsSync(orphanProposalTemporary)).toBe(false);
    expect(existsSync(orphanProposalPhase)).toBe(false);

    const reference = await seedReferenceRequestV2(store, project, { requestId: 'reference_residue', slotIndex: 1 });
    const referenceFile = path.join(reference.directories.pending, `${reference.request.id}.json`);
    const referenceSlot = path.join(reference.directories.slots, '1.slot');
    linkSync(referenceFile, `${referenceFile}.123_6.tmp`);
    linkSync(referenceSlot, `${referenceSlot}.123_7.tmp`);
    await expect(store.listReferenceRequestsV2(project.id)).resolves.toHaveLength(1);
    const referenceWinnerBytes = readFileSync(referenceFile);
    const referenceWinnerInode = lstatSync(referenceFile).ino;
    const collidedReferenceTemporary = `${referenceFile}.123_60.tmp`;
    const collidedReferenceReady = `${referenceFile}.123_60.ready`;
    writeFileSync(
      collidedReferenceTemporary,
      JSON.stringify({ ...reference.request, createdAt: '2026-08-17T12:00:00.001Z' })
    );
    linkSync(collidedReferenceTemporary, collidedReferenceReady);
    await expect(store.listReferenceRequestsV2(project.id)).resolves.toHaveLength(1);
    expect(existsSync(collidedReferenceTemporary)).toBe(false);
    expect(existsSync(collidedReferenceReady)).toBe(false);
    expect(readFileSync(referenceFile)).toEqual(referenceWinnerBytes);
    expect(lstatSync(referenceFile).ino).toBe(referenceWinnerInode);
    renameSync(referenceSlot, `${referenceSlot}.123_8.cleanup`);
    await expect(store.listReferenceRequestsV2(project.id)).resolves.toHaveLength(1);
    expect(readdirSync(reference.directories.slots).toSorted()).toEqual(['1.slot']);

    const rolledBackReference: StudioReferenceRequestV2 = {
      ...reference.request,
      id: 'reference_temp_only',
    };
    writeFileSync(
      path.join(reference.directories.pending, 'reference_temp_only.json.123_9.tmp'),
      JSON.stringify(rolledBackReference)
    );
    writeFileSync(
      path.join(reference.directories.slots, '9.slot.123_10.tmp'),
      JSON.stringify({ schemaVersion: 2, requestId: rolledBackReference.id, reservedAt: timestamp })
    );
    await expect(store.listReferenceRequestsV2(project.id)).resolves.toHaveLength(1);
    expect(readdirSync(reference.directories.pending)).toEqual([`${reference.request.id}.json`]);
    expect(readdirSync(reference.directories.slots)).toEqual(['1.slot']);

    const readyReference: StudioReferenceRequestV2 = { ...reference.request, id: 'reference_ready_phase' };
    const readyReferenceFile = path.join(reference.directories.pending, `${readyReference.id}.json`);
    const readyReferenceTemporary = `${readyReferenceFile}.123_34.tmp`;
    const readyReferencePhase = `${readyReferenceFile}.123_34.ready`;
    writeFileSync(readyReferenceTemporary, JSON.stringify(readyReference));
    linkSync(readyReferenceTemporary, readyReferencePhase);
    writeFileSync(
      path.join(reference.directories.slots, '2.slot'),
      JSON.stringify({ schemaVersion: 2, requestId: readyReference.id, reservedAt: timestamp })
    );
    await expect(store.listReferenceRequestsV2(project.id)).resolves.toHaveLength(2);
    expect(lstatSync(readyReferenceFile).ino).toBe(lstatSync(readyReferencePhase).ino);
    expect(lstatSync(readyReferenceFile).ino).toBe(lstatSync(readyReferenceTemporary).ino);
  });

  it('recovers terminal slot companion cleanup when the second unlink is interrupted', async () => {
    const { store } = createStoreV2({ createId: () => 'companion_cleanup_project', now: () => timestamp });
    const project = await store.createProjectV2(inputV2);
    const seeded = await seedProposalV2(store, project, { proposalId: 'companion_cleanup_proposal' });
    const slotFile = path.join(seeded.directories.slots, '0.slot');
    const temporaryFile = `${slotFile}.123_40.tmp`;
    const readyFile = `${slotFile}.123_40.ready`;
    linkSync(slotFile, temporaryFile);
    linkSync(slotFile, readyFile);
    const interrupted = createCreativeStudioStore({
      rootDir,
      fs: failFileSystemOnceV2((method, args) => method === 'rm' && String(args[0]).endsWith('.tmp')),
      now: () => '2026-08-17T12:00:01.000Z',
      logError: () => undefined,
    });

    await expect(interrupted.rejectProposalV2(project.id, seeded.proposal.id)).rejects.toMatchObject({ code: 'EIO' });
    expect(existsSync(readyFile)).toBe(false);
    expect(existsSync(temporaryFile)).toBe(true);
    expect(existsSync(slotFile)).toBe(true);

    const restarted = createStoreV2({ now: () => '2026-08-17T12:00:02.000Z' }).store;
    await expect(restarted.rejectProposalV2(project.id, seeded.proposal.id)).resolves.toMatchObject({
      status: 'rejected',
    });
    expect(readdirSync(seeded.directories.slots)).toEqual([]);
  });

  it('restart-recovers an interrupted same-ID pending publication collision without replacing the winner', async () => {
    const { store } = createStoreV2({ createId: () => 'pending_collision_project', now: () => timestamp });
    const project = await store.createProjectV2(inputV2);
    const seeded = await seedProposalV2(store, project, { proposalId: 'pending_collision_proposal' });
    const proposalFile = path.join(seeded.directories.pending, `${seeded.proposal.id}.json`);
    const temporaryFile = `${proposalFile}.123_41.tmp`;
    const readyFile = `${proposalFile}.123_41.ready`;
    const winnerBytes = readFileSync(proposalFile);
    const winnerInode = lstatSync(proposalFile).ino;
    writeFileSync(temporaryFile, JSON.stringify({ ...seeded.proposal, createdAt: '2026-08-17T12:00:00.001Z' }));
    linkSync(temporaryFile, readyFile);
    const interrupted = createCreativeStudioStore({
      rootDir,
      fs: failFileSystemOnceV2(
        (method, args) => method === 'rm' && String(args[0]).endsWith(path.basename(temporaryFile))
      ),
      now: () => '2026-08-17T12:00:01.000Z',
      logError: () => undefined,
    });

    await expect(interrupted.listProposalsV2(project.id)).rejects.toMatchObject({ code: 'storage_error' });
    expect(existsSync(readyFile)).toBe(false);
    expect(existsSync(temporaryFile)).toBe(true);
    expect(readFileSync(proposalFile)).toEqual(winnerBytes);
    expect(lstatSync(proposalFile).ino).toBe(winnerInode);

    const restarted = createStoreV2({ now: () => '2026-08-17T12:00:02.000Z' }).store;
    await expect(restarted.listProposalsV2(project.id)).resolves.toHaveLength(1);
    expect(existsSync(temporaryFile)).toBe(false);
    expect(readFileSync(proposalFile)).toEqual(winnerBytes);
    expect(lstatSync(proposalFile).ino).toBe(winnerInode);
  });

  it('does not touch malformed or schema-1 same-ID pending publication collisions', async () => {
    const { store } = createStoreV2({ createId: () => 'invalid_pending_collision_project', now: () => timestamp });
    const created = await store.createProjectV2(inputV2);
    const project = await addActiveReferenceShotsV2(store, created);
    const proposal = await seedProposalV2(store, project, { proposalId: 'malformed_pending_collision' });
    const proposalFile = path.join(proposal.directories.pending, `${proposal.proposal.id}.json`);
    const proposalTemporary = `${proposalFile}.123_42.tmp`;
    const proposalReady = `${proposalFile}.123_42.ready`;
    writeFileSync(proposalTemporary, '{');
    linkSync(proposalTemporary, proposalReady);
    const proposalBefore = snapshotTreeV2(proposal.directories.root);

    await expect(store.listProposalsV2(project.id)).rejects.toMatchObject({ code: 'storage_error' });
    expect(snapshotTreeV2(proposal.directories.root)).toEqual(proposalBefore);
    rmSync(proposalReady);
    rmSync(proposalTemporary);

    const reference = await seedReferenceRequestV2(store, project, {
      requestId: 'schema_one_pending_collision',
    });
    const referenceFile = path.join(reference.directories.pending, `${reference.request.id}.json`);
    const referenceTemporary = `${referenceFile}.123_43.tmp`;
    const referenceReady = `${referenceFile}.123_43.ready`;
    writeFileSync(referenceTemporary, JSON.stringify({ ...reference.request, schemaVersion: 1 }));
    linkSync(referenceTemporary, referenceReady);
    const referenceBefore = snapshotTreeV2(reference.directories.root);

    await expect(store.listReferenceRequestsV2(project.id)).rejects.toMatchObject({ code: 'storage_error' });
    expect(snapshotTreeV2(reference.directories.root)).toEqual(referenceBefore);
  });

  it('preserves incomplete temp-only writer residue and an unsafe-name collision', async () => {
    const { store } = createStoreV2({ createId: () => 'temp_only_residue_v2', now: () => timestamp });
    const project = await store.createProjectV2(inputV2);
    const paths = await store.resolveProposalPathsV2(project.id);
    const slots = path.join(path.dirname(paths.pendingDir), 'slots');
    const pendingResidue = path.join(paths.pendingDir, 'interrupted.json.123_1.tmp');
    const slotResidue = path.join(slots, '1.slot.123_2.tmp');
    writeFileSync(pendingResidue, '');
    writeFileSync(slotResidue, '{"schemaVersion":');

    await expect(store.listProposalsV2(project.id)).rejects.toMatchObject({ code: 'storage_error' });
    expect(existsSync(pendingResidue)).toBe(true);
    expect(existsSync(slotResidue)).toBe(true);
    rmSync(pendingResidue);
    rmSync(slotResidue);

    const collision = path.join(paths.pendingDir, 'not safe.json.123_3.tmp');
    writeFileSync(collision, 'foreign bytes');
    const before = readFileSync(collision);

    await expect(store.listProposalsV2(project.id)).rejects.toMatchObject({ code: 'storage_error' });

    expect(readFileSync(collision)).toEqual(before);
  });

  it('preserves unsafe journal residue, unowned publication collisions, and out-of-range slots', async () => {
    const ids = ['journal_collision_project', 'journal_collision_handoff'];
    const base = createStoreV2({ createId: () => ids.shift() ?? 'unexpected_id', now: () => timestamp }).store;
    const project = await addActiveReferenceShotsV2(base, await base.createProjectV2(inputV2));
    const seeded = await seedReferenceRequestV2(base, project, { requestId: 'journal_collision_request' });
    const unsafeResidue = path.join(seeded.directories.decisions, 'not safe.json.publish');
    writeFileSync(unsafeResidue, 'foreign journal bytes');
    const unsafeBefore = readFileSync(unsafeResidue);
    await expect(base.listReferenceRequestsV2(project.id)).rejects.toMatchObject({ code: 'storage_error' });
    expect(readFileSync(unsafeResidue)).toEqual(unsafeBefore);
    rmSync(unsafeResidue);

    const decisionFile = path.join(seeded.directories.decisions, `${seeded.request.id}.json`);
    const publication = `${decisionFile}.publish`;
    const sentinel = 'unowned publication collision';
    let collidedPublication: string | null = null;
    const collisionFs = new Proxy(nodeFs, {
      get(target, property, receiver) {
        const value = Reflect.get(target, property, receiver) as unknown;
        if (property !== 'open' || typeof value !== 'function') return value;
        return async (...args: unknown[]): Promise<unknown> => {
          const openedFile = String(args[0]);
          if (
            openedFile.endsWith('/journal_collision_request.json.publish') &&
            String(args[1]) === 'wx' &&
            !existsSync(openedFile)
          ) {
            collidedPublication = openedFile;
            writeFileSync(openedFile, sentinel);
          }
          return Reflect.apply(value, target, args) as unknown;
        };
      },
    }) as typeof nodeFs;
    const colliding = createCreativeStudioStore({ rootDir, fs: collisionFs, now: () => timestamp });
    await expect(
      colliding.decideReferenceRequestV2({
        projectId: project.id,
        requestId: seeded.request.id,
        expectedRevision: project.revision,
        outcome: { kind: 'generation_gate' },
      })
    ).rejects.toMatchObject({ code: 'storage_error' });
    expect(collidedPublication?.endsWith('/journal_collision_request.json.publish')).toBe(true);
    expect(readFileSync(publication, 'utf8')).toBe(sentinel);
    expect(existsSync(decisionFile)).toBe(false);
    await expect(base.listReferenceRequestsV2(project.id)).rejects.toMatchObject({ code: 'storage_error' });
    expect(readFileSync(publication, 'utf8')).toBe(sentinel);
    expect(existsSync(decisionFile)).toBe(false);
    rmSync(publication);

    renameSync(path.join(seeded.directories.slots, '0.slot'), path.join(seeded.directories.slots, '50.slot'));
    const beforeRangeCheck = snapshotTreeV2(seeded.directories.root);
    await expect(base.listReferenceRequestsV2(project.id)).rejects.toMatchObject({ code: 'storage_error' });
    expect(snapshotTreeV2(seeded.directories.root)).toEqual(beforeRangeCheck);
  });

  it('rejects rollback clocks before proposal, reference decision, or dismissed receipt publication', async () => {
    const ids = ['rollback_clock_project', 'rollback_clock_handoff'];
    const base = createStoreV2({ createId: () => ids.shift() ?? 'unexpected_id', now: () => timestamp }).store;
    const project = await addActiveReferenceShotsV2(base, await base.createProjectV2(inputV2));
    const proposal = await seedProposalV2(base, project, { proposalId: 'rollback_clock_proposal' });
    const reference = await seedReferenceRequestV2(base, project, {
      requestId: 'rollback_clock_reference',
      slotIndex: 1,
    });
    const rollback = createStoreV2({
      createId: () => 'rollback_clock_handoff',
      now: () => '2026-08-17T11:59:59.000Z',
    }).store;
    const before = snapshotTreeV2(path.join(rootDir, project.id));
    await expect(rollback.rejectProposalV2(project.id, proposal.proposal.id)).rejects.toMatchObject({
      code: 'storage_error',
    });
    await expect(
      rollback.decideReferenceRequestV2({
        projectId: project.id,
        requestId: reference.request.id,
        expectedRevision: project.revision,
        outcome: { kind: 'generation_gate' },
      })
    ).rejects.toMatchObject({ code: 'storage_error' });
    expect(snapshotTreeV2(path.join(rootDir, project.id))).toEqual(before);

    const generated = await seedGenerationHandoffV2(base, project, {
      requestId: 'rollback_receipt_reference',
      slotIndex: 2,
    });
    const receiptBefore = snapshotTreeV2(generated.directories.root);
    await expect(
      rollback.recordReferenceGenerationHandoffReceiptV2({
        projectId: project.id,
        handoffId: generated.handoffId,
        expectedRevision: project.revision,
        result: { kind: 'dismissed' },
      })
    ).rejects.toMatchObject({ code: 'storage_error' });
    expect(snapshotTreeV2(generated.directories.root)).toEqual(receiptBefore);
  });

  it('fails closed when a reference directory generation is replaced', async () => {
    const { store } = createStoreV2({ createId: () => 'reference_directory_replacement', now: () => timestamp });
    const project = await store.createProjectV2(inputV2);
    const seeded = await seedReferenceRequestV2(store, project, { requestId: 'directory_replacement_request' });
    const outside = mkdtempSync(path.join(tmpdir(), 'reference-decisions-replacement-'));
    const marker = path.join(outside, 'marker');
    writeFileSync(marker, 'must survive');
    rmSync(seeded.directories.decisions, { recursive: true });
    symlinkSync(outside, seeded.directories.decisions);
    const before = snapshotTreeV2(path.join(rootDir, project.id));

    try {
      await expect(store.listReferenceRequestsV2(project.id)).rejects.toMatchObject({ code: 'storage_error' });
      expect(readFileSync(marker, 'utf8')).toBe('must survive');
      expect(snapshotTreeV2(path.join(rootDir, project.id))).toEqual(before);
    } finally {
      rmSync(seeded.directories.decisions);
      await rm(outside, { recursive: true, force: true });
    }
  });

  it('counts only unresolved live records against V2 proposal and reference capacity', async () => {
    const { store } = createStoreV2({ createId: () => 'history_capacity_v2', now: () => timestamp });
    const project = await store.createProjectV2(inputV2);
    const proposalPaths = await store.resolveProposalPathsV2(project.id);
    const proposalRoot = path.dirname(proposalPaths.pendingDir);
    for (let index = 0; index < STUDIO_PROPOSAL_MAX_PENDING_PER_PROJECT; index += 1) {
      const proposalId = `terminal_${index}`;
      const proposal: StudioProposalRecordV2 = {
        schemaVersion: 2,
        id: proposalId,
        projectId: project.id,
        status: 'pending',
        baseRevision: project.revision,
        payload: { kind: 'mutation_batch', operations: [{ kind: 'set_brief', brief: proposalId }] },
        createdAt: timestamp,
        decidedAt: null,
      };
      const decision = { schemaVersion: 2, proposalId, status: 'rejected', decidedAt: timestamp };
      writeFileSync(path.join(proposalPaths.pendingDir, `${proposalId}.json`), JSON.stringify(proposal));
      writeFileSync(path.join(proposalRoot, 'decisions', `${proposalId}.json`), JSON.stringify(decision));
    }
    const live = await seedProposalV2(store, project, { proposalId: 'live_after_history' });
    await expect(store.listProposalsV2(project.id)).resolves.toHaveLength(STUDIO_PROPOSAL_MAX_PENDING_PER_PROJECT + 1);
    for (let index = 1; index <= STUDIO_PROPOSAL_MAX_PENDING_PER_PROJECT; index += 1) {
      const proposalId = `live_overflow_${index}`;
      const proposal: StudioProposalRecordV2 = {
        ...live.proposal,
        id: proposalId,
      };
      writeFileSync(path.join(live.directories.pending, `${proposalId}.json`), JSON.stringify(proposal));
      writeFileSync(
        path.join(live.directories.slots, `${index}.slot`),
        JSON.stringify({ schemaVersion: 2, proposalId, reservedAt: timestamp })
      );
    }
    await expect(store.listProposalsV2(project.id)).rejects.toMatchObject({ code: 'storage_error' });

    const referenceStore = createStoreV2({
      createId: () => 'reference_history_capacity_v2',
      now: () => timestamp,
    }).store;
    const referenceProject = await referenceStore.createProjectV2(inputV2);
    const referencePaths = await referenceStore.resolveReferenceRequestPathsV2(referenceProject.id);
    const referenceRoot = path.dirname(referencePaths.pendingDir);
    for (let index = 0; index < STUDIO_REFERENCE_REQUEST_V2_MAX_PENDING_PER_PROJECT; index += 1) {
      const requestId = `terminal_reference_${index}`;
      const request: StudioReferenceRequestV2 = {
        schemaVersion: 2,
        id: requestId,
        projectId: referenceProject.id,
        shotIds: ['historical_shot'],
        status: 'pending',
        createdAt: timestamp,
      };
      const decision: StudioReferenceRequestDecisionV2 = {
        schemaVersion: 2,
        requestId,
        projectId: referenceProject.id,
        decidedAt: timestamp,
        outcome: { kind: 'rejected' },
      };
      writeFileSync(path.join(referencePaths.pendingDir, `${requestId}.json`), JSON.stringify(request));
      writeFileSync(path.join(referenceRoot, 'decisions', `${requestId}.json`), JSON.stringify(decision));
    }
    const liveReference = await seedReferenceRequestV2(referenceStore, referenceProject, {
      requestId: 'live_reference_after_history',
    });
    await expect(referenceStore.listReferenceRequestsV2(referenceProject.id)).resolves.toHaveLength(
      STUDIO_REFERENCE_REQUEST_V2_MAX_PENDING_PER_PROJECT + 1
    );
    for (let index = 1; index <= STUDIO_REFERENCE_REQUEST_V2_MAX_PENDING_PER_PROJECT; index += 1) {
      const requestId = `live_reference_overflow_${index}`;
      const request: StudioReferenceRequestV2 = { ...liveReference.request, id: requestId };
      writeFileSync(path.join(liveReference.directories.pending, `${requestId}.json`), JSON.stringify(request));
      writeFileSync(
        path.join(liveReference.directories.slots, `${index}.slot`),
        JSON.stringify({ schemaVersion: 2, requestId, reservedAt: timestamp })
      );
    }
    await expect(referenceStore.listReferenceRequestsV2(referenceProject.id)).rejects.toMatchObject({
      code: 'storage_error',
    });
  });

  it('leaves a complete V1 project and sidecar tree byte-identical across every V2 ledger entrypoint', async () => {
    const prototype = await seedPrototypeProject('prototype_proposals_v1');
    const prototypeStore = createCreativeStudioStore({ rootDir, now: () => timestamp });
    await prototypeStore.resolveProposalPaths(prototype.id);
    const before = snapshotTreeV2(rootDir);
    const watchProposalTree = vi.fn(() => ({ close: vi.fn() }));
    const v2 = createCreativeStudioStore({
      rootDir,
      now: () => timestamp,
      watchProposalTree,
      logError: () => undefined,
    });

    await expect(v2.listProposalsV2(prototype.id)).rejects.toMatchObject({ code: 'unsupported_prototype_schema' });
    await expect(v2.acceptProposalV2(prototype.id, 'proposal_v1')).rejects.toMatchObject({
      code: 'unsupported_prototype_schema',
    });
    await expect(v2.rejectProposalV2(prototype.id, 'proposal_v1')).rejects.toMatchObject({
      code: 'unsupported_prototype_schema',
    });
    await expect(v2.resolveProposalPathsV2(prototype.id)).rejects.toMatchObject({
      code: 'unsupported_prototype_schema',
    });
    await expect(v2.listReferenceRequestsV2(prototype.id)).rejects.toMatchObject({
      code: 'unsupported_prototype_schema',
    });
    await expect(
      v2.decideReferenceRequestV2({
        projectId: prototype.id,
        requestId: 'request_v1',
        expectedRevision: 1,
        outcome: { kind: 'rejected' },
      })
    ).rejects.toMatchObject({ code: 'unsupported_prototype_schema' });
    await expect(v2.readReferenceGenerationHandoffV2(prototype.id, 'handoff_v1')).rejects.toMatchObject({
      code: 'unsupported_prototype_schema',
    });
    await expect(
      v2.recordReferenceGenerationHandoffReceiptV2({
        projectId: prototype.id,
        handoffId: 'handoff_v1',
        expectedRevision: 1,
        result: { kind: 'dismissed' },
      })
    ).rejects.toMatchObject({ code: 'unsupported_prototype_schema' });
    await expect(v2.resolveReferenceRequestPathsV2(prototype.id)).rejects.toMatchObject({
      code: 'unsupported_prototype_schema',
    });
    await v2.reapAbandonedProposalsV2();
    await v2.reapAbandonedReferenceRequestsV2();
    const stopProposals = await v2.watchProposalsV2(vi.fn());
    const stopReferences = await v2.watchReferenceRequestsV2(vi.fn());
    await stopProposals();
    await stopReferences();

    expect(watchProposalTree).toHaveBeenCalledTimes(2);
    expect(snapshotTreeV2(rootDir)).toEqual(before);
  });

  it('returns a verified path only for a supported schema-2 manifest without touching the V1 index', async () => {
    const prototype = await seedPrototypeProject();
    const prototypeManifestFile = path.join(rootDir, prototype.id, 'project.json');
    const prototypeIndexFile = path.join(rootDir, 'projects.json');
    const prototypeManifestBefore = readFileSync(prototypeManifestFile);
    const prototypeIndexBefore = readFileSync(prototypeIndexFile);
    const supported = createEmptyStudioProjectV2(inputV2, 'verified_path_v2', timestamp);
    seedProjectV2(supported);
    const malformedId = 'path_malformed_v2';
    mkdirSync(path.join(rootDir, malformedId));
    writeFileSync(
      path.join(rootDir, malformedId, 'project.json'),
      JSON.stringify({ schemaVersion: 2, id: malformedId })
    );
    const orphanId = 'path_without_manifest_v2';
    mkdirSync(path.join(rootDir, orphanId));
    writeFileSync(path.join(rootDir, orphanId, 'sidecar.bin'), Buffer.from([0, 1, 2]));
    const { store, prototypeIndexAccesses } = createStoreV2();

    await expect(store.getVerifiedProjectDirectoryV2(supported.id)).resolves.toBe(
      realpathSync(path.join(rootDir, supported.id))
    );
    await expect(store.getVerifiedProjectDirectoryV2(prototype.id)).rejects.toMatchObject({
      code: 'unsupported_prototype_schema',
    });
    await expect(store.getVerifiedProjectDirectoryV2(malformedId)).rejects.toMatchObject({ code: 'storage_error' });
    await expect(store.getVerifiedProjectDirectoryV2(orphanId)).resolves.toBeNull();
    await expect(store.getVerifiedProjectDirectoryV2('missing_path_v2')).resolves.toBeNull();
    await expect(store.getVerifiedProjectDirectoryV2('../unsafe')).resolves.toBeNull();

    expect(readFileSync(prototypeManifestFile)).toEqual(prototypeManifestBefore);
    expect(readFileSync(prototypeIndexFile)).toEqual(prototypeIndexBefore);
    expect(existsSync(path.join(rootDir, 'projects-v2.json'))).toBe(false);
    expect(prototypeIndexAccesses).toEqual([]);
  });
});

const makeBareJob = (overrides: Partial<StudioJob> = {}): StudioJob => ({
  id: 'job_1',
  projectId: 'project_1',
  sceneId: 'scene_1',
  status: 'succeeded',
  provider: { providerId: 'provider_1', adapterId: 'weprompt-image-v1', model: 'model_1' },
  idempotencyKey: 'key_1',
  providerJobId: null,
  cancellationPolicy: 'none',
  outputAssetIds: [],
  error: null,
  retryOfJobId: null,
  retryReason: null,
  duplicateChargeAcknowledged: false,
  duplicateChargeAcknowledgedAt: null,
  createdAt: '2026-08-06T00:00:00.000Z',
  updatedAt: '2026-08-06T00:00:00.000Z',
  ...overrides,
});

describe('jobOutputRole', () => {
  it('accepts exactly the schema-1 durable job contract', () => {
    expectTypeOf(jobOutputRole).parameter(0).toEqualTypeOf<StudioJob>();
  });

  it('defaults an old schema-v1 job that lacks the field to take', () => {
    expect(jobOutputRole(makeBareJob())).toBe('take');
  });

  it('reads an explicit take role', () => {
    expect(jobOutputRole(makeBareJob({ outputRole: 'take' }))).toBe('take');
  });

  it('reads an explicit reference role', () => {
    expect(jobOutputRole(makeBareJob({ outputRole: 'reference' }))).toBe('reference');
  });
});

describe('creative studio renderer DTO contract', () => {
  it('limits renderer cut edits to non-destructive edit decisions', () => {
    type EditableCutKeys = keyof StudioEditableCut;
    type EditableClipKeys = keyof StudioEditableCutClip;
    const filter = { id: 'temperature', amount: 0.25 } as const satisfies StudioCutFilter;
    const cut: StudioCut = {
      id: 'cut_1',
      name: 'Launch film',
      orderMode: 'storyboard',
      clipOrder: ['clip_1'],
      clips: {
        clip_1: {
          id: 'clip_1',
          sceneId: 'scene_1',
          assetId: 'asset_1',
          sourceInSeconds: null,
          sourceOutSeconds: null,
          crop: null,
          filters: [filter],
        },
      },
    };

    expectTypeOf<EditableCutKeys>().toEqualTypeOf<'orderMode' | 'clipOrder' | 'clips'>();
    expectTypeOf<EditableClipKeys>().toEqualTypeOf<'sourceInSeconds' | 'sourceOutSeconds' | 'crop' | 'filters'>();
    expect(cut.clips.clip_1?.filters).toEqual([{ id: 'temperature', amount: 0.25 }]);
  });

  it('keeps command responses free of filesystem paths, credentials, signed URLs, and media bytes', () => {
    type ForbiddenRendererField =
      | 'path'
      | 'filePath'
      | 'credential'
      | 'apiKey'
      | 'signedUrl'
      | 'url'
      | 'bytes'
      | 'base64'
      | 'providerJobId'
      | 'remoteStartedAt'
      | 'idempotencyKey'
      | 'adapterId'
      | 'cancellationPolicy';
    type KeysOfUnion<Value> = Value extends unknown ? keyof Value : never;
    type RendererDto =
      | StudioRendererProject
      | StudioProjectSummary
      | StudioAsset
      | StudioRendererJob
      | StudioMediaChoiceRef
      | StudioRouteCatalog
      | StudioConnectionRecord
      | StudioConnectionInventory
      | StudioConnectionValidationResult
      | StudioConnectionCandidate;
    type RendererProjectKeys = KeysOfUnion<RendererDto>;
    type NoForbiddenRendererFields = Extract<RendererProjectKeys, ForbiddenRendererField>;
    const result: StudioCommandResult<StudioProjectSummary[]> = { ok: true, data: [] };

    expectTypeOf<NoForbiddenRendererFields>().toEqualTypeOf<never>();
    expect(result).toEqual({ ok: true, data: [] });
  });

  it('keeps rejected commands typed instead of throwing unstructured renderer errors', () => {
    const result: StudioCommandResult<never> = {
      ok: false,
      error: { code: 'invalid_payload', messageKey: 'conversation.creativeStudio.errors.invalidPayload' },
    };

    expect(result.error.code).toBe('invalid_payload');
  });

  it('declares every renderer operation as a typed command result instead of a raw service return', () => {
    type IsTypedCommand<Result> = Result extends (...args: never[]) => Promise<StudioCommandResult<unknown>>
      ? true
      : false;
    type AllOperationsAreTyped = IsTypedCommand<StudioDesktopApi[keyof StudioDesktopApi]>;

    expectTypeOf<AllOperationsAreTyped>().toEqualTypeOf<true>();
  });
});

describe('CreativeStudioStore connections', () => {
  it('preserves an absent legacy conditioning capacity without writing a default', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'creative-studio-connections-capacity-legacy-'));
    const connectionStore = createCreativeStudioStore({ rootDir: root });
    try {
      writeFileSync(
        path.join(root, 'connections.json'),
        JSON.stringify({ schemaVersion: 1, connections: [validConnectionBinding()] })
      );

      const [loaded] = await connectionStore.listConnections();

      expect(loaded?.capabilities).not.toHaveProperty('maxConditioningImages');
      expect(readFileSync(path.join(root, 'connections.json'), 'utf8')).not.toContain('maxConditioningImages');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.each([0, 6])('persists admitted conditioning capacity %i exactly', async (maxConditioningImages) => {
    const root = mkdtempSync(path.join(tmpdir(), 'creative-studio-connections-capacity-valid-'));
    const connectionStore = createCreativeStudioStore({ rootDir: root });
    try {
      const saved = await connectionStore.saveConnection({
        ...validConnectionBinding(),
        capabilities: { ...validConnectionBinding().capabilities, maxConditioningImages },
      });

      expect(saved.capabilities).toHaveProperty('maxConditioningImages', maxConditioningImages);
      await expect(connectionStore.listConnections()).resolves.toEqual([saved]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.each([-1, 1.5, 7])('rejects conditioning capacity %s at connection read and write boundaries', async (value) => {
    const root = mkdtempSync(path.join(tmpdir(), 'creative-studio-connections-capacity-invalid-'));
    const connectionStore = createCreativeStudioStore({ rootDir: root });
    const malformed = {
      ...validConnectionBinding(),
      capabilities: { ...validConnectionBinding().capabilities, maxConditioningImages: value },
    };
    try {
      await expect(connectionStore.saveConnection(malformed as never)).rejects.toMatchObject({
        code: 'invalid_payload',
      });
      writeFileSync(
        path.join(root, 'connections.json'),
        JSON.stringify({ schemaVersion: 1, connections: [malformed] })
      );
      await expect(connectionStore.listConnections()).rejects.toMatchObject({ code: 'storage_error' });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('persists only a secret-free validated binding in the separately atomic connection file', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'creative-studio-connections-'));
    const connectionStore = createCreativeStudioStore({ rootDir: root });
    try {
      const saved = await connectionStore.saveConnection(validConnectionBinding());

      expect(saved.id).toBe('binding_1');
      expect(await connectionStore.listConnections()).toEqual([saved]);
      const raw = readFileSync(path.join(root, 'connections.json'), 'utf8');
      expect(raw).not.toContain('api_key');
      expect(raw).not.toContain('https://');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('accepts the OpenRouter video adapter in the durable media-binding allowlist', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'creative-studio-openrouter-connection-'));
    const connectionStore = createCreativeStudioStore({ rootDir: root });
    try {
      const saved = await connectionStore.saveConnection({
        ...validConnectionBinding(),
        adapterId: 'openrouter-video-v1',
        model: 'bytedance/seedance-2.0-fast',
        capabilities: {
          mediaKinds: ['video'],
          audioModes: ['none'],
          aspectRatios: ['16:9'],
          resolutions: ['720p'],
          minDurationSeconds: 4,
          maxDurationSeconds: 15,
          supportsFirstFrame: true,
          maxConditioningImages: 0,
          cancellationPolicy: 'none',
        },
      });

      expect(saved.adapterId).toBe('openrouter-video-v1');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.each([
    { legacy: true, expected: 'queued_only' },
    { legacy: false, expected: 'none' },
    { legacy: undefined, expected: 'none' },
  ])(
    'canonicalizes legacy cancellation $legacy to $expected when reading connections',
    async ({ legacy, expected }) => {
      const root = mkdtempSync(path.join(tmpdir(), 'creative-studio-connections-legacy-read-'));
      const connectionStore = createCreativeStudioStore({ rootDir: root });
      try {
        const binding = validConnectionBinding() as StudioConnectionBinding & {
          capabilities: StudioConnectionBinding['capabilities'] & { cancellation?: boolean };
        };
        if (legacy !== undefined) binding.capabilities.cancellation = legacy;
        writeFileSync(
          path.join(root, 'connections.json'),
          JSON.stringify({ schemaVersion: 1, connections: [binding] })
        );

        const [loaded] = await connectionStore.listConnections();

        expect(loaded?.capabilities).toMatchObject({ cancellationPolicy: expected });
        expect(loaded?.capabilities).not.toHaveProperty('cancellation');
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    }
  );

  it('canonicalizes legacy cancellation on save and persists only cancellationPolicy', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'creative-studio-connections-legacy-save-'));
    const connectionStore = createCreativeStudioStore({ rootDir: root });
    try {
      const legacy = validConnectionBinding() as StudioConnectionBinding & {
        capabilities: StudioConnectionBinding['capabilities'] & { cancellation: boolean };
      };
      legacy.capabilities.cancellation = true;

      const saved = await connectionStore.saveConnection(legacy);
      const raw = readFileSync(path.join(root, 'connections.json'), 'utf8');

      expect(saved.capabilities).toMatchObject({ cancellationPolicy: 'queued_only' });
      expect(saved.capabilities).not.toHaveProperty('cancellation');
      expect(raw).toContain('"cancellationPolicy": "queued_only"');
      expect(raw).not.toContain('"cancellation"');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.each([
    { label: 'an invalid explicit policy', capabilities: { cancellationPolicy: 'always' } },
    {
      label: 'both legacy and explicit policy fields',
      capabilities: { cancellation: true, cancellationPolicy: 'none' },
    },
  ])('rejects $label at connection read and write boundaries', async ({ capabilities }) => {
    const root = mkdtempSync(path.join(tmpdir(), 'creative-studio-connections-policy-invalid-'));
    const connectionStore = createCreativeStudioStore({ rootDir: root });
    const malformed = {
      ...validConnectionBinding(),
      capabilities: { ...validConnectionBinding().capabilities, ...capabilities },
    };
    try {
      await expect(connectionStore.saveConnection(malformed as never)).rejects.toMatchObject({
        code: 'invalid_payload',
      });
      writeFileSync(
        path.join(root, 'connections.json'),
        JSON.stringify({ schemaVersion: 1, connections: [malformed] })
      );
      await expect(connectionStore.listConnections()).rejects.toMatchObject({ code: 'storage_error' });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.each([
    'unknown',
    'api_key',
    'base_url',
    'file_path',
    'token',
    'secret',
    'accessToken',
    'client-secret',
    'payloadBase64',
    'response_bytes',
    'raw-metadata',
  ])('rejects an unsafe or unknown top-level binding field on save: %s', async (field) => {
    const root = mkdtempSync(path.join(tmpdir(), 'creative-studio-connections-save-keys-'));
    const connectionStore = createCreativeStudioStore({ rootDir: root });
    try {
      await expect(
        connectionStore.saveConnection({ ...validConnectionBinding(), [field]: 'must-not-persist' } as never)
      ).rejects.toMatchObject({ code: 'invalid_payload' });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.each(['unknown', 'api_key', 'base_url', 'file_path', 'token', 'secret'])(
    'rejects an unsafe or unknown top-level binding field while reading: %s',
    async (field) => {
      const root = mkdtempSync(path.join(tmpdir(), 'creative-studio-connections-read-keys-'));
      const connectionStore = createCreativeStudioStore({ rootDir: root });
      try {
        writeFileSync(
          path.join(root, 'connections.json'),
          JSON.stringify({
            schemaVersion: 1,
            connections: [{ ...validConnectionBinding(), [field]: 'must-not-load' }],
          })
        );

        await expect(connectionStore.listConnections()).rejects.toMatchObject({ code: 'storage_error' });
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    }
  );

  it.each([
    { label: 'oversized connection id', override: { id: 'i'.repeat(257) } },
    { label: 'oversized provider id', override: { providerId: 'p'.repeat(257) } },
    { label: 'leading model whitespace', override: { model: ' open-sora' } },
    { label: 'trailing model whitespace', override: { model: 'open-sora ' } },
    { label: 'model control characters', override: { model: 'open\nsora' } },
    { label: 'oversized model', override: { model: 'm'.repeat(257) } },
    { label: 'non-ISO validation time', override: { validatedAt: 'yesterday' } },
    { label: 'non-canonical validation time', override: { validatedAt: '2026-07-30T07:00:00+07:00' } },
    { label: 'impossible validation time', override: { validatedAt: '2026-02-30T00:00:00.000Z' } },
  ])('rejects unsafe bounded binding metadata: $label', async ({ override }) => {
    const root = mkdtempSync(path.join(tmpdir(), 'creative-studio-connections-metadata-'));
    const connectionStore = createCreativeStudioStore({ rootDir: root });
    try {
      await expect(connectionStore.saveConnection({ ...validConnectionBinding(), ...override })).rejects.toMatchObject({
        code: 'invalid_payload',
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.each(['api_key', 'base_url', 'token', 'metadata'])(
    'rejects an unknown or sensitive manifest-root field while reading: %s',
    async (field) => {
      const root = mkdtempSync(path.join(tmpdir(), 'creative-studio-connections-root-'));
      const connectionStore = createCreativeStudioStore({ rootDir: root });
      try {
        writeFileSync(
          path.join(root, 'connections.json'),
          JSON.stringify({
            schemaVersion: 1,
            connections: [validConnectionBinding()],
            [field]: 'must-not-load',
          })
        );

        await expect(connectionStore.listConnections()).rejects.toMatchObject({ code: 'storage_error' });
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    }
  );

  it('rejects connection capabilities with unknown fields instead of durable provider metadata', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'creative-studio-connections-invalid-'));
    const connectionStore = createCreativeStudioStore({ rootDir: root });
    try {
      await expect(
        connectionStore.saveConnection({
          schemaVersion: 1,
          id: 'binding_1',
          providerId: 'provider_1',
          adapterId: 'weprompt-media-gateway-v1',
          model: 'open-sora',
          capabilities: { mediaKinds: ['video'], baseUrl: 'https://not-stored.invalid' } as never,
          validatedAt: '2026-07-30T00:00:00.000Z',
        })
      ).rejects.toMatchObject({ code: 'invalid_payload' });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('upserts the same provider adapter and model instead of creating duplicate routes', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'creative-studio-connections-upsert-'));
    const connectionStore = createCreativeStudioStore({ rootDir: root });
    try {
      const base = {
        schemaVersion: 1 as const,
        providerId: 'provider_1',
        adapterId: 'weprompt-media-gateway-v1' as const,
        model: 'open-sora',
        capabilities: { mediaKinds: ['video' as const], audioModes: ['none'] },
        validatedAt: '2026-07-30T00:00:00.000Z',
      };
      await connectionStore.saveConnection({ ...base, id: 'binding_1' });
      await connectionStore.saveConnection({ ...base, id: 'binding_2' });

      await expect(connectionStore.listConnections()).resolves.toMatchObject([{ id: 'binding_2' }]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.each([
    { mediaKinds: ['image'], audioModes: ['none'] },
    { mediaKinds: ['video'], audioModes: ['none', 'stereo'] },
    { mediaKinds: ['video'], audioModes: ['none', 'none'] },
    { mediaKinds: ['video'], aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4', '16:9'] },
    { mediaKinds: ['video'], resolutions: ['720p', '1080p', '720p'] },
  ])('rejects unbounded or non-silent persisted capability arrays', async (capabilities) => {
    const root = mkdtempSync(path.join(tmpdir(), 'creative-studio-connections-bounds-'));
    const connectionStore = createCreativeStudioStore({ rootDir: root });
    try {
      await expect(
        connectionStore.saveConnection({
          schemaVersion: 1,
          id: 'binding_1',
          providerId: 'provider_1',
          adapterId: 'weprompt-media-gateway-v1',
          model: 'open-sora',
          capabilities: capabilities as never,
          validatedAt: '2026-07-30T00:00:00.000Z',
        })
      ).rejects.toMatchObject({ code: 'invalid_payload' });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('Studio subprocess proposal writer', () => {
  let proposalRoot: string;
  let pendingDir: string;
  let slotsDir: string;

  beforeEach(async () => {
    proposalRoot = await nodeFs.mkdtemp(path.join(tmpdir(), 'studio-proposals-'));
    pendingDir = path.join(proposalRoot, 'pending');
    slotsDir = path.join(proposalRoot, 'slots');
    await mkdir(pendingDir, { recursive: true });
    await mkdir(slotsDir, { recursive: true });
  });

  it('writes a pending record and a slot reservation', async () => {
    const record = await writeProposalRecord({
      pendingDir,
      projectId: 'project_1',
      baseRevision: 3,
      payload: subprocessProposalPayload,
    });

    expect(record.status).toBe('pending');
    expect(record.baseRevision).toBe(3);
    const written = JSON.parse(await readFile(path.join(pendingDir, `${record.id}.json`), 'utf8'));
    expect(written).toEqual(record);
    const slots = await readdir(slotsDir);
    expect(slots).toHaveLength(1);
    const slot = JSON.parse(await readFile(path.join(slotsDir, slots[0]), 'utf8'));
    expect(slot).toMatchObject({ schemaVersion: 1, proposalId: record.id });
  });

  it('fails typed when every slot is taken, without writing a record', async () => {
    await Promise.all(
      Array.from({ length: 50 }, (_, index) =>
        writeFile(
          path.join(slotsDir, `${index}.slot`),
          JSON.stringify({ schemaVersion: 1, proposalId: 'x', reservedAt: 'now' })
        )
      )
    );

    await expect(
      writeProposalRecord({ pendingDir, projectId: 'project_1', baseRevision: 1, payload: subprocessProposalPayload })
    ).rejects.toMatchObject({ code: 'capacity' } satisfies Partial<StudioProposalWriteError>);
    expect(await readdir(pendingDir)).toHaveLength(0);
  });

  it('releases its slot when the record write fails', async () => {
    const collidingId = 'fixed_id_for_collision';
    await mkdir(path.join(pendingDir, `${collidingId}.json`));

    await expect(
      writeProposalRecord({
        pendingDir,
        projectId: 'project_1',
        baseRevision: 1,
        payload: subprocessProposalPayload,
        proposalId: collidingId,
      })
    ).rejects.toMatchObject({ code: 'storage' });
    expect(await readdir(slotsDir)).toHaveLength(0);
  });

  it('rejects a record over the byte cap without touching disk', async () => {
    const huge = {
      ...subprocessProposalPayload,
      scenes: {
        scene_1: { ...subprocessProposalPayload.scenes.scene_1, narration: 'x'.repeat(300 * 1024) },
      },
    };

    await expect(
      writeProposalRecord({ pendingDir, projectId: 'project_1', baseRevision: 1, payload: huge })
    ).rejects.toMatchObject({ code: 'too_large' });
    expect(await readdir(pendingDir)).toHaveLength(0);
    expect(await readdir(slotsDir)).toHaveLength(0);
  });
});
