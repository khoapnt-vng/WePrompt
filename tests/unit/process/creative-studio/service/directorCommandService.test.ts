/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment node
 */

import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CreateStudioProjectInputV2,
  StudioDirectorCommandRecordV2,
  StudioDirectorOperationV2,
  StudioProjectV2,
} from '@/common/types/project/creativeStudioTypes';
import {
  createStudioDirectorCommandServiceV2,
  StudioDirectorCommandApplyErrorV2,
  type StudioDirectorCommandServiceV2,
} from '@process/services/creative-studio/service/directorCommandService';
import {
  CreativeStudioStoreError,
  createCreativeStudioStore,
  type CreativeStudioStore,
} from '@process/services/creative-studio/store';
import { createStudioLineHistoryId } from '@process/services/creative-studio/service/schema2/mutations/identity';

const NOW = '2026-08-17T00:00:00.000Z';
const NOW_MS = Date.parse(NOW);
const APPLY_CUTOFF_MS = NOW_MS + 1_000;

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
  durationSeconds: 5,
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
        beat: { title: 'Opening', action: '', look: 'Cinematic light', targetSeconds: null },
        beforeBeatId: null,
      },
      { kind: 'add_shot', beatId: 'section_1', shotId: 'clip_1', shot: emptyShotV2(), beforeShotId: null },
      { kind: 'add_shot', beatId: 'section_1', shotId: 'clip_2', shot: emptyShotV2(), beforeShotId: null },
      { kind: 'edit_beat', beatId: 'section_1', changes: { action: 'A clear story beat' } },
      { kind: 'edit_shot', shotId: 'clip_2', changes: { line: 'Close product reveal' } },
      { kind: 'edit_shot', shotId: 'clip_2', changes: { line: 'Final product reveal' } },
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
        beats: {
          section_1: {
            action: 'A clear story beat',
            shotOrder: ['clip_2', 'clip_1'],
            lineHistory: [
              {
                id: createStudioLineHistoryId(command.commandId, 5, 'clip_2', 0),
                shotOrdinal: 2,
                text: 'Close product reveal',
                capturedAt: command.createdAt,
              },
            ],
          },
        },
        shots: { clip_2: { line: 'Final product reveal' } },
        undoHistory: [
          {
            id: command.commandId,
            sourceRevision: project.revision + 1,
            label: 'mutation_batch',
          },
        ],
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
        beat: { title: 'Opening', action: '', look: 'Cinematic light', targetSeconds: null },
        beforeBeatId: null,
      },
      {
        kind: 'add_shot',
        beatId: 'section_1',
        shotId: 'clip_1',
        shot: { ...emptyShotV2(), durationSeconds: 3 },
        beforeShotId: null,
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
      const legacyStore = createCreativeStudioStore({ rootDir: legacyRoot, now: () => NOW });
      const legacyDirectory = path.join(legacyRoot, 'legacy_1');
      const projectFile = path.join(legacyDirectory, 'project.json');
      await mkdir(legacyDirectory);
      await writeFile(projectFile, JSON.stringify({ schemaVersion: 1, id: 'legacy_1' }), 'utf8');
      const before = await readFile(projectFile, 'utf8');
      const command = makeCommandV2({ id: 'legacy_1', revision: 1 } as StudioProjectV2, [
        { kind: 'set_brief', brief: 'Must not touch schema-1 bytes' },
      ]);

      const error = await createStudioDirectorCommandServiceV2({ store: legacyStore, now: () => NOW_MS })
        .apply(command, APPLY_CUTOFF_MS, { commitTag: command.commandId })
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(CreativeStudioStoreError);
      expect(error).toMatchObject({ code: 'unsupported_prototype_schema' });
      expect(await readFile(projectFile, 'utf8')).toBe(before);
      expect(await readdir(legacyDirectory)).toEqual(['project.json']);
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
