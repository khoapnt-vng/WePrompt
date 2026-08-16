/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  promises as nodeFs,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { mkdir, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import type {
  CreateStudioProjectInput,
  StudioAsset,
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
  StudioProject,
  StudioProjectSummary,
  StudioMediaChoiceRef,
  StudioProposalPayload,
  StudioRendererJob,
  StudioRendererProject,
  StudioRouteCatalog,
} from '@/common/types/project/creativeStudioTypes';
import {
  allocateStudioBriefReferenceLabel,
  getStudioReferencePlateFreshness,
  resolveActiveStudioBriefReferences,
  STUDIO_BRIEF_REFERENCE_LABEL_MAX_LENGTH,
} from '@/common/types/project/creativeStudioManagedAssetCollections';
import { jobOutputRole } from '@/common/types/project/creativeStudioOutputRole';
import { STUDIO_EDITABLE_SCENE_LIMITS, editableSceneSchema } from '@process/resources/builtinMcp/studioServer';
import type { StudioProposalWriteError } from '@process/resources/builtinMcp/studioProposalWriter';
import { writeProposalRecord } from '@process/resources/builtinMcp/studioProposalWriter';
import { writeReferenceRequestRecord } from '@process/resources/builtinMcp/studioReferenceRequestWriter';
import {
  createCreativeStudioStore,
  type CreativeStudioStore,
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

describe('jobOutputRole', () => {
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
