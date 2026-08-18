/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment node
 */

import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CreateStudioProjectInput,
  CreateStudioProjectInputV2,
  StudioAsset,
  StudioDirectorCommandRecordV1,
  StudioDirectorCommandRecordV2,
  StudioDirectorNewSceneV1,
  StudioDirectorOperationV1,
  StudioDirectorOperationV2,
  StudioJob,
  StudioProject,
  StudioProjectV2,
  StudioScene,
} from '@/common/types/project/creativeStudioTypes';
import { createCreativeStudioService } from '@process/services/creative-studio/service';
import {
  createStudioDirectorCommandService,
  createStudioDirectorCommandServiceV2,
  StudioDirectorCommandApplyError,
  StudioDirectorCommandApplyErrorV2,
  type StudioDirectorCommandService,
  type StudioDirectorCommandServiceV2,
} from '@process/services/creative-studio/service/directorCommandService';
import type { StudioStoryboardPlanner } from '@process/services/creative-studio/planning/storyboardPlanner';
import {
  CreativeStudioStoreError,
  createCreativeStudioStore,
  type CreativeStudioStore,
} from '@process/services/creative-studio/store';

const NOW = '2026-08-17T00:00:00.000Z';
const NOW_MS = Date.parse(NOW);
const APPLY_CUTOFF_MS = NOW_MS + 1_000;

const makeInput = (): CreateStudioProjectInput => ({
  name: 'Director command project',
  brief: 'Opening brief',
  aspectRatio: '16:9',
  targetDurationSeconds: 24,
  resolution: '1080p',
});

const makeInputV2 = (): CreateStudioProjectInputV2 => ({
  name: 'Director schema-2 command project',
  brief: 'Opening brief',
  aspectRatio: '16:9',
  targetDurationSeconds: 24,
  resolution: '1080p',
});

const emptyShotV2 = () => ({
  line: '',
  narration: '',
  onScreenText: '',
  mediaKind: 'image' as const,
  durationSeconds: 5,
  referenceAssetId: null,
});

const makeCommandV2 = (
  project: StudioProjectV2,
  operations: StudioDirectorOperationV2[],
  overrides: Partial<StudioDirectorCommandRecordV2> = {}
): StudioDirectorCommandRecordV2 => ({
  schemaVersion: 2,
  commandId: 'command_v2',
  projectId: project.id,
  expectedRevision: project.revision,
  createdAt: NOW,
  deadlineAt: '2026-08-17T00:00:15.000Z',
  policy: 'auto_apply',
  operations,
  ...overrides,
});

describe('Studio Director schema-2 command service', () => {
  let rootDir = '';
  let store: CreativeStudioStore;
  let service: StudioDirectorCommandServiceV2;
  let project: StudioProjectV2;
  let nowMs = NOW_MS;

  beforeEach(async () => {
    rootDir = await mkdtemp(path.join(tmpdir(), 'studio-director-command-service-v2-'));
    nowMs = NOW_MS;
    store = createCreativeStudioStore({ rootDir, now: () => NOW, createId: () => 'project_v2' });
    project = await store.createProjectV2(makeInputV2());
    service = createStudioDirectorCommandServiceV2({ store, now: () => nowMs });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(rootDir, { recursive: true, force: true });
  });

  it('delegates the ordered batch inside one correlated schema-2 store callback', async () => {
    const operations: StudioDirectorOperationV2[] = [
      {
        kind: 'add_beat',
        beatId: 'section_1',
        beat: { title: 'Opening', action: '', look: 'Cinematic light' },
        firstShotId: 'clip_1',
        firstShot: emptyShotV2(),
        beforeBeatId: null,
      },
      { kind: 'add_shot', beatId: 'section_1', shotId: 'clip_2', shot: emptyShotV2(), beforeShotId: null },
      { kind: 'edit_beat', beatId: 'section_1', changes: { action: 'A clear story beat' } },
      { kind: 'edit_shot', shotId: 'clip_2', changes: { line: 'Close product reveal' } },
      { kind: 'reorder_shots', beatId: 'section_1', shotOrder: ['clip_2', 'clip_1'] },
    ];
    const command = makeCommandV2(project, operations);
    const commandBytes = JSON.stringify(command);
    const updateProjectV2 = vi.spyOn(store, 'updateProjectV2');

    const result = await service.apply(command, APPLY_CUTOFF_MS, { commitTag: 'opaque-v2-command-tag' });

    expect(result).toMatchObject({
      appliedRevision: project.revision + 1,
      createdBeatIds: ['section_1'],
      createdShotIds: ['clip_1', 'clip_2'],
      project: {
        revision: project.revision + 1,
        beatOrder: ['section_1'],
        beats: { section_1: { action: 'A clear story beat', shotOrder: ['clip_2', 'clip_1'] } },
        shots: { clip_2: { line: 'Close product reveal' } },
      },
    });
    expect(updateProjectV2).toHaveBeenCalledOnce();
    expect(updateProjectV2.mock.calls[0]?.slice(0, 2)).toEqual([project.id, expect.any(Function)]);
    expect(updateProjectV2.mock.calls[0]?.slice(2)).toEqual([project.revision, 'opaque-v2-command-tag']);
    expect(JSON.stringify(command)).toBe(commandBytes);
  });

  it('checks the deadline only after schema-2 CAS admits the correlated callback', async () => {
    const realStore = store;
    const queuedStore: CreativeStudioStore = {
      ...realStore,
      updateProjectV2: (projectId, update, expectedRevision, commitTag) =>
        realStore.updateProjectV2(
          projectId,
          (current) => {
            nowMs = APPLY_CUTOFF_MS;
            return update(current);
          },
          expectedRevision,
          commitTag
        ),
    };
    service = createStudioDirectorCommandServiceV2({ store: queuedStore, now: () => nowMs });

    await expect(
      service.apply(makeCommandV2(project, [{ kind: 'set_brief', brief: 'Too late' }]), APPLY_CUTOFF_MS, {
        commitTag: 'command_v2',
      })
    ).rejects.toMatchObject({ reasonCode: 'deadline_elapsed', message: 'deadline_elapsed' });
    await expect(store.getProjectV2(project.id)).resolves.toMatchObject({
      status: 'supported',
      project: { revision: project.revision, brief: project.brief },
    });
  });

  it('keeps stale CAS precedence ahead of deadline and reducer work', async () => {
    const now = vi.fn(() => APPLY_CUTOFF_MS);
    service = createStudioDirectorCommandServiceV2({ store, now });
    await store.updateProjectV2(project.id, (current) => ({ ...current, name: 'Concurrent winner' }), project.revision);

    await expect(
      service.apply(makeCommandV2(project, [{ kind: 'set_brief', brief: 'Must not apply' }]), APPLY_CUTOFF_MS, {
        commitTag: 'command_v2',
      })
    ).rejects.toMatchObject({ code: 'stale_project' });

    expect(now).not.toHaveBeenCalled();
    await expect(store.getProjectV2(project.id)).resolves.toMatchObject({
      status: 'supported',
      project: { revision: project.revision + 1, name: 'Concurrent winner', brief: project.brief },
    });
  });

  it('returns the exact bounded reducer reason and rolls the whole draft back', async () => {
    const command = makeCommandV2(project, [
      {
        kind: 'add_beat',
        beatId: 'section_1',
        beat: { title: 'Opening', action: '', look: 'Cinematic light' },
        firstShotId: 'clip_1',
        firstShot: { ...emptyShotV2(), mediaKind: 'video', durationSeconds: 3 },
        beforeBeatId: null,
      },
    ]);

    const error = await service
      .apply(command, APPLY_CUTOFF_MS, { commitTag: command.commandId })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(StudioDirectorCommandApplyErrorV2);
    expect(error).toMatchObject({ reasonCode: 'invalid_shot_duration', message: 'invalid_shot_duration' });
    await expect(store.getProjectV2(project.id)).resolves.toMatchObject({
      status: 'supported',
      project: { revision: project.revision, beatOrder: [], beats: {}, shots: {} },
    });
  });

  it('returns schema-1 projects as unsupported without changing any project byte', async () => {
    const legacyRoot = await mkdtemp(path.join(tmpdir(), 'studio-director-command-service-v1-no-touch-'));
    try {
      const legacyStore = createCreativeStudioStore({
        rootDir: legacyRoot,
        now: () => NOW,
        createId: () => 'legacy_1',
      });
      const legacy = await legacyStore.createProject(makeInput());
      const projectFile = path.join(legacyRoot, legacy.id, 'project.json');
      const before = await readFile(projectFile, 'utf8');
      const command = makeCommandV2({ id: legacy.id, revision: legacy.revision } as StudioProjectV2, [
        { kind: 'set_brief', brief: 'Must not touch V1' },
      ]);

      const error = await createStudioDirectorCommandServiceV2({ store: legacyStore, now: () => NOW_MS })
        .apply(command, APPLY_CUTOFF_MS, { commitTag: command.commandId })
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(CreativeStudioStoreError);
      expect(error).toMatchObject({ code: 'unsupported_prototype_schema' });
      expect(await readFile(projectFile, 'utf8')).toBe(before);
      expect(await readdir(path.join(legacyRoot, legacy.id))).toEqual(['project.json']);
    } finally {
      await rm(legacyRoot, { recursive: true, force: true });
    }
  });

  it('preserves an exact busy store boundary for deferred processor handling', async () => {
    const busy = new CreativeStudioStoreError('busy', 'opaque busy detail');
    const updateProjectV2 = vi.fn(async () => {
      throw busy;
    });
    service = createStudioDirectorCommandServiceV2({ store: { updateProjectV2 } });

    const error = await service
      .apply(makeCommandV2(project, [{ kind: 'set_brief', brief: 'Defer me' }]), APPLY_CUTOFF_MS, {
        commitTag: 'command_v2',
      })
      .catch((caught: unknown) => caught);

    expect(error).toBe(busy);
    expect(updateProjectV2).toHaveBeenCalledOnce();
  });

  it('bounds store invalid_payload as validation_failed instead of leaking store prose', async () => {
    const updateProjectV2 = vi.fn(async () => {
      throw new CreativeStudioStoreError('invalid_payload', 'credential at /Users/private');
    });
    service = createStudioDirectorCommandServiceV2({ store: { updateProjectV2 } });

    const error = await service
      .apply(makeCommandV2(project, [{ kind: 'set_brief', brief: 'Invalid' }]), APPLY_CUTOFF_MS, {
        commitTag: 'command_v2',
      })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(StudioDirectorCommandApplyErrorV2);
    expect(error).toMatchObject({ reasonCode: 'validation_failed', message: 'validation_failed' });
    expect(JSON.stringify(error)).not.toContain('/Users/private');
  });
});

const makeNewScene = (overrides: Partial<StudioDirectorNewSceneV1> = {}): StudioDirectorNewSceneV1 => ({
  title: 'New scene',
  purpose: 'Advance the story',
  visualPrompt: 'A cinematic product moment',
  narration: '',
  onScreenText: '',
  mediaKind: 'video',
  durationSeconds: 4,
  ...overrides,
});

const makeScene = (id: string, overrides: Partial<StudioScene> = {}): StudioScene => ({
  id,
  ...makeNewScene({ title: `Scene ${id}` }),
  referenceAssetId: null,
  selectedAssetId: null,
  assetIds: [],
  jobIds: [],
  reviewState: 'ready',
  ...overrides,
});

const makeAsset = (
  projectId: string,
  sceneId: string,
  assetId: string,
  overrides: Partial<StudioAsset> = {}
): StudioAsset => ({
  id: assetId,
  projectId,
  sceneId,
  mediaKind: 'video',
  mimeType: 'video/mp4',
  managedAsset: { collection: 'assets', fileName: `${assetId}.mp4` },
  byteSize: 1,
  sha256: 'a'.repeat(64),
  durationSeconds: 4,
  createdAt: NOW,
  ...overrides,
});

const makeJob = (projectId: string, sceneId: string, jobId: string): StudioJob => ({
  id: jobId,
  projectId,
  sceneId,
  status: 'succeeded',
  provider: { providerId: 'provider_1', adapterId: 'weprompt-media-gateway-v1', model: 'model_1' },
  idempotencyKey: `${jobId}_key`,
  providerJobId: `${jobId}_remote`,
  cancellationPolicy: 'none',
  outputAssetIds: [],
  error: null,
  retryOfJobId: null,
  retryReason: null,
  duplicateChargeAcknowledged: false,
  duplicateChargeAcknowledgedAt: null,
  createdAt: NOW,
  updatedAt: NOW,
});

const makeCommand = (
  project: StudioProject,
  operations: StudioDirectorOperationV1[],
  overrides: Partial<StudioDirectorCommandRecordV1> = {}
): StudioDirectorCommandRecordV1 => ({
  schemaVersion: 1,
  commandId: 'command_1',
  projectId: project.id,
  expectedRevision: project.revision,
  createdAt: NOW,
  deadlineAt: '2026-08-17T00:00:15.000Z',
  policy: 'auto_apply',
  operations,
  ...overrides,
});

const planner: StudioStoryboardPlanner = {
  listModels: async () => [],
  draft: async () => {
    throw new Error('not used');
  },
  dispose: async () => {},
};

describe('Studio Director command service', () => {
  let rootDir = '';
  let store: CreativeStudioStore;
  let service: StudioDirectorCommandService;
  let project: StudioProject;
  let nowMs = NOW_MS;

  beforeEach(async () => {
    rootDir = await mkdtemp(path.join(tmpdir(), 'studio-director-command-service-'));
    nowMs = NOW_MS;
    store = createCreativeStudioStore({ rootDir, now: () => NOW, createId: () => 'project_1' });
    project = await store.createProject(makeInput());
    service = createStudioDirectorCommandService({ store, now: () => nowMs });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(rootDir, { recursive: true, force: true });
  });

  const seedScenes = async (sceneIds: string[]): Promise<StudioProject> =>
    store.updateProject(
      project.id,
      (current) => ({
        ...current,
        sceneOrder: [...sceneIds],
        scenes: Object.fromEntries(sceneIds.map((sceneId) => [sceneId, makeScene(sceneId)])),
      }),
      project.revision
    );

  const writeLegacySceneCount = async (sceneCount: number): Promise<StudioProject> => {
    const file = path.join(rootDir, project.id, 'project.json');
    const legacy = JSON.parse(await readFile(file, 'utf8')) as StudioProject;
    const sceneOrder = Array.from({ length: sceneCount }, (_, index) => `scene_${index + 1}`);
    legacy.sceneOrder = sceneOrder;
    legacy.scenes = Object.fromEntries(sceneOrder.map((sceneId) => [sceneId, makeScene(sceneId)]));
    await writeFile(file, JSON.stringify(legacy), 'utf8');
    return legacy;
  };

  const apply = (current: StudioProject, operations: StudioDirectorOperationV1[], commandId = 'command_1') =>
    service.apply(makeCommand(current, operations, { commandId }), APPLY_CUTOFF_MS, {
      commitTag: commandId,
    });

  it('applies compatible operations in array order through one correlated revision', async () => {
    project = await seedScenes(['scene_1', 'scene_2']);
    project = await store.updateProject(
      project.id,
      (current) => {
        const next = structuredClone(current);
        next.assets.take_1 = makeAsset(next.id, 'scene_1', 'take_1');
        next.scenes.scene_1.assetIds = ['take_1'];
        return next;
      },
      project.revision
    );
    const command = makeCommand(project, [
      { kind: 'set_brief', brief: 'Director brief' },
      { kind: 'edit_scene', sceneId: 'scene_2', changes: { title: 'Edited second scene' } },
      { kind: 'reorder_scenes', sceneOrder: ['scene_2', 'scene_1'] },
      { kind: 'select_take', sceneId: 'scene_1', assetId: 'take_1' },
    ]);
    const commandBefore = structuredClone(command);
    const updateProject = vi.spyOn(store, 'updateProject');

    const result = await service.apply(command, APPLY_CUTOFF_MS, { commitTag: 'opaque-command-tag' });

    expect(result.appliedRevision).toBe(project.revision + 1);
    expect(result.project).toMatchObject({
      revision: project.revision + 1,
      brief: 'Director brief',
      sceneOrder: ['scene_2', 'scene_1'],
      scenes: {
        scene_1: { selectedAssetId: 'take_1' },
        scene_2: { title: 'Edited second scene' },
      },
    });
    expect(result.createdSceneIds).toEqual([]);
    expect(updateProject).toHaveBeenCalledOnce();
    expect(updateProject.mock.calls[0]?.[0]).toBe(project.id);
    expect(updateProject.mock.calls[0]?.[2]).toBe(project.revision);
    expect(updateProject.mock.calls[0]?.[3]).toBe('opaque-command-tag');
    expect(command).toEqual(commandBefore);
  });

  it('lets a later operation edit a scene added earlier without mutating command input', async () => {
    const command = makeCommand(project, [
      { kind: 'add_scene', sceneId: 'scene_new', scene: makeNewScene(), beforeSceneId: null },
      {
        kind: 'edit_scene',
        sceneId: 'scene_new',
        changes: { title: 'Edited after add', narration: 'The later operation saw the draft.' },
      },
    ]);
    const commandBytes = JSON.stringify(command);

    const result = await service.apply(command, APPLY_CUTOFF_MS, { commitTag: command.commandId });

    expect(result.createdSceneIds).toEqual(['scene_new']);
    expect(result.project.sceneOrder).toEqual(['scene_new']);
    expect(result.project.scenes.scene_new).toMatchObject({
      title: 'Edited after add',
      narration: 'The later operation saw the draft.',
      referenceAssetId: null,
    });
    expect(JSON.stringify(command)).toBe(commandBytes);
  });

  it.each([
    { name: 'appends', beforeSceneId: null, want: ['scene_1', 'scene_2', 'scene_new'] },
    {
      name: 'inserts before the first opening scene',
      beforeSceneId: 'scene_1',
      want: ['scene_new', 'scene_1', 'scene_2'],
    },
    {
      name: 'inserts before a middle opening scene',
      beforeSceneId: 'scene_2',
      want: ['scene_1', 'scene_new', 'scene_2'],
    },
  ])('$name', async ({ beforeSceneId, want }) => {
    project = await seedScenes(['scene_1', 'scene_2']);

    const result = await apply(project, [
      { kind: 'add_scene', sceneId: 'scene_new', scene: makeNewScene(), beforeSceneId },
    ]);

    expect(result.project.sceneOrder).toEqual(want);
    expect(result.createdSceneIds).toEqual(['scene_new']);
  });

  it('keeps operation order for multiple additions before the same opening anchor', async () => {
    project = await seedScenes(['scene_1', 'scene_2']);

    const result = await apply(project, [
      { kind: 'add_scene', sceneId: 'scene_a', scene: makeNewScene({ title: 'A' }), beforeSceneId: 'scene_2' },
      { kind: 'add_scene', sceneId: 'scene_b', scene: makeNewScene({ title: 'B' }), beforeSceneId: 'scene_2' },
      { kind: 'add_scene', sceneId: 'scene_c', scene: makeNewScene({ title: 'C' }), beforeSceneId: 'scene_2' },
    ]);

    expect(result.project.sceneOrder).toEqual(['scene_1', 'scene_a', 'scene_b', 'scene_c', 'scene_2']);
    expect(result.createdSceneIds).toEqual(['scene_a', 'scene_b', 'scene_c']);
  });

  it.each([
    {
      name: 'an unknown opening anchor',
      operations: [{ kind: 'add_scene', sceneId: 'scene_new', scene: makeNewScene(), beforeSceneId: 'scene_missing' }],
    },
    {
      name: 'an anchor created earlier in the same command',
      operations: [
        { kind: 'add_scene', sceneId: 'scene_a', scene: makeNewScene(), beforeSceneId: null },
        { kind: 'add_scene', sceneId: 'scene_b', scene: makeNewScene(), beforeSceneId: 'scene_a' },
      ],
    },
    {
      name: 'an add id colliding with an opening scene',
      operations: [
        { kind: 'add_scene', sceneId: 'scene_1', scene: makeNewScene({ title: 'Overwrite' }), beforeSceneId: null },
      ],
    },
    {
      name: 'duplicate add ids',
      operations: [
        { kind: 'add_scene', sceneId: 'scene_new', scene: makeNewScene({ title: 'First' }), beforeSceneId: null },
        { kind: 'add_scene', sceneId: 'scene_new', scene: makeNewScene({ title: 'Second' }), beforeSceneId: null },
      ],
    },
    {
      name: 'add plus reorder',
      operations: [
        { kind: 'add_scene', sceneId: 'scene_new', scene: makeNewScene(), beforeSceneId: null },
        { kind: 'reorder_scenes', sceneOrder: ['scene_2', 'scene_1'] },
      ],
    },
  ] satisfies Array<{ name: string; operations: StudioDirectorOperationV1[] }>)(
    'rejects $name atomically',
    async ({ operations }) => {
      project = await seedScenes(['scene_1', 'scene_2']);
      const before = await readFile(path.join(rootDir, project.id, 'project.json'), 'utf8');

      await expect(apply(project, operations)).rejects.toMatchObject({
        name: 'StudioDirectorCommandApplyError',
        reasonCode: 'validation_failed',
        message: 'validation_failed',
      });

      expect(await readFile(path.join(rootDir, project.id, 'project.json'), 'utf8')).toBe(before);
    }
  );

  it('allows only the six editable patch fields to enter a scene', async () => {
    project = await seedScenes(['scene_1']);
    project = await store.updateProject(
      project.id,
      (current) => {
        const next = structuredClone(current);
        next.assets.reference_1 = makeAsset(next.id, 'scene_1', 'reference_1', {
          mediaKind: 'image',
          mimeType: 'image/png',
          managedAsset: { collection: 'references', fileName: 'reference_1.png' },
          durationSeconds: undefined,
        });
        next.assets.take_1 = makeAsset(next.id, 'scene_1', 'take_1');
        next.jobs.job_1 = makeJob(next.id, 'scene_1', 'job_1');
        next.scenes.scene_1 = makeScene('scene_1', {
          referenceAssetId: 'reference_1',
          selectedAssetId: 'take_1',
          assetIds: ['reference_1', 'take_1'],
          jobIds: ['job_1'],
          reviewState: 'complete',
        });
        return next;
      },
      project.revision
    );
    const changes = {
      title: 'Allowed title',
      purpose: 'Allowed purpose',
      visualPrompt: 'Allowed visual prompt',
      narration: 'Allowed narration',
      onScreenText: 'Allowed text',
      durationSeconds: 9,
      referenceAssetId: null,
      selectedAssetId: null,
      assetIds: [],
      jobIds: [],
      reviewState: 'draft',
    } as unknown as Extract<StudioDirectorOperationV1, { kind: 'edit_scene' }>['changes'];

    const result = await apply(project, [{ kind: 'edit_scene', sceneId: 'scene_1', changes }]);

    expect(result.project.scenes.scene_1).toEqual({
      id: 'scene_1',
      title: 'Allowed title',
      purpose: 'Allowed purpose',
      visualPrompt: 'Allowed visual prompt',
      narration: 'Allowed narration',
      onScreenText: 'Allowed text',
      mediaKind: 'video',
      durationSeconds: 9,
      referenceAssetId: 'reference_1',
      selectedAssetId: 'take_1',
      assetIds: ['reference_1', 'take_1'],
      jobIds: ['job_1'],
      reviewState: 'complete',
    });
  });

  it('accepts only a canonical reverse-linked generated take', async () => {
    project = await seedScenes(['scene_1', 'scene_2']);
    project = await store.updateProject(
      project.id,
      (current) => {
        const next = structuredClone(current);
        next.assets.take_1 = makeAsset(next.id, 'scene_1', 'take_1');
        next.assets.take_2 = makeAsset(next.id, 'scene_2', 'take_2');
        next.scenes.scene_1.assetIds = ['take_1'];
        next.scenes.scene_2.assetIds = ['take_2'];
        return next;
      },
      project.revision
    );

    const accepted = await apply(project, [{ kind: 'select_take', sceneId: 'scene_1', assetId: 'take_1' }]);
    await expect(
      apply(accepted.project, [{ kind: 'select_take', sceneId: 'scene_1', assetId: 'take_2' }], 'command_2')
    ).rejects.toMatchObject({ reasonCode: 'validation_failed', message: 'validation_failed' });

    expect((await store.getProject(project.id))?.scenes.scene_1.selectedAssetId).toBe('take_1');
  });

  it('rolls back earlier draft operations when a later operation fails', async () => {
    project = await seedScenes(['scene_1']);
    const before = await readFile(path.join(rootDir, project.id, 'project.json'), 'utf8');

    await expect(
      apply(project, [
        { kind: 'set_brief', brief: 'Must not persist' },
        { kind: 'edit_scene', sceneId: 'scene_missing', changes: { title: 'Missing' } },
      ])
    ).rejects.toMatchObject({
      name: 'StudioDirectorCommandApplyError',
      reasonCode: 'validation_failed',
      message: 'validation_failed',
    });

    expect(await readFile(path.join(rootDir, project.id, 'project.json'), 'utf8')).toBe(before);
    await expect(store.getProject(project.id)).resolves.toMatchObject({
      revision: project.revision,
      brief: project.brief,
    });
  });

  it('rechecks the deadline from inside the revision-current store callback before operation one', async () => {
    const realStore = store;
    const queuedStore: CreativeStudioStore = {
      ...realStore,
      updateProject: (projectId, update, expectedRevision, commitTag) =>
        realStore.updateProject(
          projectId,
          (current) => {
            nowMs = APPLY_CUTOFF_MS;
            return update(current);
          },
          expectedRevision,
          commitTag
        ),
    };
    service = createStudioDirectorCommandService({ store: queuedStore, now: () => nowMs });

    await expect(apply(project, [{ kind: 'set_brief', brief: 'Too late' }])).rejects.toMatchObject({
      reasonCode: 'deadline_elapsed',
      message: 'deadline_elapsed',
    });
    await expect(store.getProject(project.id)).resolves.toMatchObject({
      revision: project.revision,
      brief: project.brief,
    });
  });

  it('rejects deadline before legacy over-capacity and add semantic failures in a revision-current callback', async () => {
    const legacy = await writeLegacySceneCount(25);
    const file = path.join(rootDir, project.id, 'project.json');
    const before = await readFile(file, 'utf8');
    const realStore = store;
    const queuedStore: CreativeStudioStore = {
      ...realStore,
      updateProject: (projectId, update, expectedRevision, commitTag) =>
        realStore.updateProject(
          projectId,
          (current) => {
            nowMs = APPLY_CUTOFF_MS;
            return update(current);
          },
          expectedRevision,
          commitTag
        ),
    };
    service = createStudioDirectorCommandService({ store: queuedStore, now: () => nowMs });

    await expect(
      apply(legacy, [
        {
          kind: 'add_scene',
          sceneId: 'scene_1',
          scene: makeNewScene(),
          beforeSceneId: 'scene_missing',
        },
      ])
    ).rejects.toMatchObject({ reasonCode: 'deadline_elapsed', message: 'deadline_elapsed' });

    expect(await readFile(file, 'utf8')).toBe(before);
  });

  it('preserves store stale precedence when a concurrent write wins before the callback', async () => {
    const legacy = await writeLegacySceneCount(25);
    const clock = vi.fn(() => APPLY_CUTOFF_MS);
    service = createStudioDirectorCommandService({ store, now: clock });
    const winningWrite = store.updateProject(
      legacy.id,
      (current) => ({ ...current, name: 'Concurrent winner' }),
      legacy.revision
    );
    const directorWrite = apply(legacy, [
      {
        kind: 'add_scene',
        sceneId: 'scene_1',
        scene: makeNewScene(),
        beforeSceneId: 'scene_missing',
      },
    ]);

    await expect(winningWrite).resolves.toMatchObject({ revision: legacy.revision + 1 });
    await expect(directorWrite).rejects.toMatchObject({ code: 'stale_project' });
    expect(clock).not.toHaveBeenCalled();
    await expect(store.getProject(legacy.id)).resolves.toMatchObject({
      revision: legacy.revision + 1,
      name: 'Concurrent winner',
      brief: legacy.brief,
      sceneOrder: legacy.sceneOrder,
    });
  });

  it('preserves the project-level store not-found error unchanged', async () => {
    const error = await service
      .apply(
        makeCommand(project, [{ kind: 'set_brief', brief: 'Missing project' }], { projectId: 'missing_project' }),
        APPLY_CUTOFF_MS,
        { commitTag: 'command_missing' }
      )
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(CreativeStudioStoreError);
    expect(error).toMatchObject({ code: 'not_found', message: 'Studio project not found' });
    expect(error).not.toBeInstanceOf(StudioDirectorCommandApplyError);
  });

  it('preserves the exact project-level storage error object unchanged', async () => {
    const storageError = new CreativeStudioStoreError('storage_error', 'opaque store failure');
    const updateProject = vi.fn(async () => {
      throw storageError;
    });
    const failingStore: CreativeStudioStore = {
      ...store,
      updateProject,
    };
    service = createStudioDirectorCommandService({ store: failingStore, now: () => nowMs });

    const error = await apply(project, [{ kind: 'set_brief', brief: 'Cannot persist' }]).catch(
      (caught: unknown) => caught
    );

    expect(error).toBe(storageError);
    expect(error).not.toBeInstanceOf(StudioDirectorCommandApplyError);
    expect(updateProject).toHaveBeenCalledTimes(1);
  });

  it.each([
    {
      name: 'a store-shaped error',
      thrown: new CreativeStudioStoreError('not_found', 'operation helper detail must not escape'),
    },
    { name: 'a generic error', thrown: new Error('generic operation detail must not escape') },
  ])('translates $name inside the callback to validation_failed without raw prose', async ({ thrown }) => {
    project = await seedScenes(['scene_1']);
    const changes = Object.defineProperty({}, 'title', {
      enumerable: true,
      get: () => {
        throw thrown;
      },
    }) as Extract<StudioDirectorOperationV1, { kind: 'edit_scene' }>['changes'];
    const before = await readFile(path.join(rootDir, project.id, 'project.json'), 'utf8');

    const error = await apply(project, [{ kind: 'edit_scene', sceneId: 'scene_1', changes }]).catch(
      (caught: unknown) => caught
    );

    expect(error).toBeInstanceOf(StudioDirectorCommandApplyError);
    expect(error).toMatchObject({
      name: 'StudioDirectorCommandApplyError',
      reasonCode: 'validation_failed',
      message: 'validation_failed',
    });
    expect((error as Error).message).not.toContain(thrown.message);
    expect(await readFile(path.join(rootDir, project.id, 'project.json'), 'utf8')).toBe(before);
  });

  it('rejects a revision-current legacy over-capacity project before operation one', async () => {
    const file = path.join(rootDir, project.id, 'project.json');
    const legacy = await writeLegacySceneCount(25);
    const before = await readFile(file, 'utf8');

    await expect(apply(legacy, [{ kind: 'set_brief', brief: 'Must not apply' }])).rejects.toMatchObject({
      reasonCode: 'project_over_capacity',
      message: 'project_over_capacity',
    });

    expect(await readFile(file, 'utf8')).toBe(before);
    expect(await store.listQuarantinedProjectIds()).toEqual([]);
  });

  it('rejects project_over_capacity before add overflow and semantic validation in a revision-current callback', async () => {
    const file = path.join(rootDir, project.id, 'project.json');
    const legacy = await writeLegacySceneCount(25);
    const before = await readFile(file, 'utf8');

    await expect(
      apply(legacy, [
        {
          kind: 'add_scene',
          sceneId: 'scene_1',
          scene: makeNewScene(),
          beforeSceneId: 'scene_missing',
        },
      ])
    ).rejects.toMatchObject({ reasonCode: 'project_over_capacity', message: 'project_over_capacity' });

    expect(await readFile(file, 'utf8')).toBe(before);
  });

  it('rejects a 23-scene two-add command atomically with a scene-limit reason', async () => {
    project = await seedScenes(Array.from({ length: 23 }, (_, index) => `scene_${index + 1}`));
    const before = await readFile(path.join(rootDir, project.id, 'project.json'), 'utf8');

    await expect(
      apply(project, [
        { kind: 'add_scene', sceneId: 'scene_24', scene: makeNewScene(), beforeSceneId: null },
        { kind: 'add_scene', sceneId: 'scene_25', scene: makeNewScene(), beforeSceneId: null },
      ])
    ).rejects.toMatchObject({ reasonCode: 'scene_limit_exceeded', message: 'scene_limit_exceeded' });

    expect(await readFile(path.join(rootDir, project.id, 'project.json'), 'utf8')).toBe(before);
  });

  it.each([
    {
      name: 'an opening-scene id collision',
      operation: {
        kind: 'add_scene',
        sceneId: 'scene_1',
        scene: makeNewScene(),
        beforeSceneId: null,
      },
    },
    {
      name: 'an unknown opening anchor',
      operation: {
        kind: 'add_scene',
        sceneId: 'scene_25',
        scene: makeNewScene(),
        beforeSceneId: 'scene_missing',
      },
    },
  ] satisfies Array<{
    name: string;
    operation: Extract<StudioDirectorOperationV1, { kind: 'add_scene' }>;
  }>)('rejects a 24-scene add with $name as scene_limit_exceeded before semantic validation', async ({ operation }) => {
    project = await seedScenes(Array.from({ length: 24 }, (_, index) => `scene_${index + 1}`));
    const file = path.join(rootDir, project.id, 'project.json');
    const before = await readFile(file, 'utf8');

    await expect(apply(project, [operation])).rejects.toMatchObject({
      reasonCode: 'scene_limit_exceeded',
      message: 'scene_limit_exceeded',
    });

    expect(await readFile(file, 'utf8')).toBe(before);
  });

  it('counts duplicate add operations toward the 23-scene aggregate limit before semantic validation', async () => {
    project = await seedScenes(Array.from({ length: 23 }, (_, index) => `scene_${index + 1}`));
    const file = path.join(rootDir, project.id, 'project.json');
    const before = await readFile(file, 'utf8');

    await expect(
      apply(project, [
        { kind: 'add_scene', sceneId: 'scene_24', scene: makeNewScene({ title: 'First' }), beforeSceneId: null },
        { kind: 'add_scene', sceneId: 'scene_24', scene: makeNewScene({ title: 'Second' }), beforeSceneId: null },
      ])
    ).rejects.toMatchObject({ reasonCode: 'scene_limit_exceeded', message: 'scene_limit_exceeded' });

    expect(await readFile(file, 'utf8')).toBe(before);
  });

  it('allows edit, reorder, and select at 24 scenes but rejects an addition', async () => {
    project = await seedScenes(Array.from({ length: 24 }, (_, index) => `scene_${index + 1}`));
    project = await store.updateProject(
      project.id,
      (current) => {
        const next = structuredClone(current);
        next.assets.take_1 = makeAsset(next.id, 'scene_1', 'take_1');
        next.scenes.scene_1.assetIds = ['take_1'];
        return next;
      },
      project.revision
    );
    const reversed = [...project.sceneOrder].reverse();

    const valid = await apply(project, [
      { kind: 'edit_scene', sceneId: 'scene_1', changes: { title: 'Edited at capacity' } },
      { kind: 'reorder_scenes', sceneOrder: reversed },
      { kind: 'select_take', sceneId: 'scene_1', assetId: 'take_1' },
    ]);

    expect(valid.project).toMatchObject({
      sceneOrder: reversed,
      scenes: { scene_1: { title: 'Edited at capacity', selectedAssetId: 'take_1' } },
    });
    await expect(
      apply(
        valid.project,
        [{ kind: 'add_scene', sceneId: 'scene_25', scene: makeNewScene(), beforeSceneId: null }],
        'command_2'
      )
    ).rejects.toMatchObject({ reasonCode: 'scene_limit_exceeded' });
  });

  it('preserves rule-list undo bytes through every operation and ordinary undo changes only rules', async () => {
    project = await seedScenes(['scene_1', 'scene_2']);
    project = await store.updateProject(
      project.id,
      (current) => {
        const next = structuredClone(current);
        next.rules = [
          {
            id: 'rule_current',
            scope: 'project',
            text: 'Keep the product central.',
            predicate: null,
            createdAt: NOW,
          },
        ];
        next.ruleListUndo = {
          capturedRevision: current.revision,
          previousRules: [
            {
              id: 'rule_previous',
              scope: 'project',
              text: 'Keep the logo abstract.',
              predicate: null,
              createdAt: '2026-08-16T23:59:00.000Z',
            },
          ],
        };
        next.assets.take_1 = makeAsset(next.id, 'scene_1', 'take_1');
        next.scenes.scene_1.assetIds = ['take_1'];
        return next;
      },
      project.revision
    );
    const undoBytes = JSON.stringify(project.ruleListUndo);
    const operationLists: StudioDirectorOperationV1[][] = [
      [{ kind: 'set_brief', brief: 'Director changed the brief' }],
      [{ kind: 'add_scene', sceneId: 'scene_3', scene: makeNewScene(), beforeSceneId: null }],
      [{ kind: 'edit_scene', sceneId: 'scene_3', changes: { title: 'Director edited the added scene' } }],
      [{ kind: 'reorder_scenes', sceneOrder: ['scene_3', 'scene_2', 'scene_1'] }],
      [{ kind: 'select_take', sceneId: 'scene_1', assetId: 'take_1' }],
    ];

    for (const [index, operations] of operationLists.entries()) {
      const result = await apply(project, operations, `command_${index + 1}`);
      expect(JSON.stringify(result.project.ruleListUndo)).toBe(undoBytes);
      expect(Object.keys(result).sort()).toEqual(['appliedRevision', 'createdSceneIds', 'project']);
      expect(JSON.stringify(result)).not.toMatch(/undoable|reversible|recovery/i);
      project = result.project;
    }

    const ordinaryService = createCreativeStudioService({
      store,
      onProjectUpdated: vi.fn(),
      storyboardPlanner: planner,
    });
    const undone = await ordinaryService.undoBriefRules({ projectId: project.id });

    expect(undone.rules).toMatchObject([{ id: 'rule_previous', text: 'Keep the logo abstract.' }]);
    expect(undone.ruleListUndo).toBeNull();
    expect(undone).toMatchObject({
      brief: 'Director changed the brief',
      sceneOrder: ['scene_3', 'scene_2', 'scene_1'],
      scenes: {
        scene_1: { selectedAssetId: 'take_1' },
        scene_3: { title: 'Director edited the added scene' },
      },
    });
  });
});
