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
import { rm } from 'node:fs/promises';
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
  StudioRendererJob,
  StudioRendererProject,
  StudioRouteCatalog,
} from '@/common/types/project/creativeStudioTypes';
import { jobOutputRole } from '@/common/types/project/creativeStudioOutputRole';
import { createCreativeStudioStore, type CreativeStudioStore } from '@process/services/creative-studio/store';

const makeInput = (overrides: Partial<CreateStudioProjectInput> = {}): CreateStudioProjectInput => ({
  name: 'Launch film',
  brief: 'A short launch story',
  aspectRatio: '16:9',
  targetDurationSeconds: 12,
  resolution: '1080p',
  ...overrides,
});

const cloneProject = (project: StudioProject): StudioProject => structuredClone(project);

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

  describe('proposal ledger', () => {
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
  ] as const)('rejects cut data with %s without changing durable state', async (_case, mutate) => {
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

    it('validates a job carrying the reference output role', async () => {
      const project = await store.createProject(makeInput());

      const persisted = await store.updateProject(project.id, (current) => {
        const next = addScene(current, 'scene_1');
        next.jobs.job_1 = makeJob(next, 'job_1', 'scene_1', { outputRole: 'reference' });
        next.scenes.scene_1.jobIds = ['job_1'];
        return next;
      });

      expect(persisted.jobs.job_1.outputRole).toBe('reference');
      expect(await store.getProject(project.id)).toEqual(persisted);
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
