/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest';
import type {
  StudioAssetV2,
  StudioShot,
  StudioJobV2,
  StudioMutationBatchV2,
  StudioMutationOperationV2,
  StudioProjectV2,
  StudioBeat,
} from '@/common/types/project/creativeStudioTypes';
import {
  applyStudioMutationBatchV2,
  StudioMutationErrorV2,
  type StudioMutationReasonV2,
} from '@/process/services/creative-studio/service/schema2/mutations';
import { validateStudioProjectV2 } from '@/process/services/creative-studio/service/schema2/validation';

const timestamp = '2026-08-17T00:00:00.000Z';

const makeShot = (id: string, overrides: Partial<StudioShot> = {}): StudioShot => ({
  id,
  line: '',
  narration: '',
  onScreenText: '',
  mediaKind: 'image',
  durationSeconds: 5,
  referenceAssetId: null,
  selectedTakeId: null,
  assetIds: [],
  jobIds: [],
  ...overrides,
});

const makeBeat = (id: string, shotOrder: string[]): StudioBeat => ({
  id,
  title: '',
  action: '',
  look: '',
  shotOrder,
});

const makeAsset = (id: string, shotId: string): StudioAssetV2 => ({
  id,
  projectId: 'project_1',
  shotId,
  mediaKind: 'image',
  mimeType: 'image/png',
  managedAsset: { collection: 'assets', fileName: `${id}.png` },
  byteSize: 1,
  sha256: 'a'.repeat(64),
  createdAt: timestamp,
});

const makeJob = (id: string, shotId: string): StudioJobV2 => ({
  id,
  projectId: 'project_1',
  shotId,
  status: 'queued_local',
  provider: { providerId: 'provider_1', adapterId: 'weprompt-image-v1', model: 'image-model' },
  idempotencyKey: `idem_${id}`,
  providerJobId: null,
  cancellationPolicy: 'none',
  outputAssetIds: [],
  error: null,
  retryOfJobId: null,
  retryReason: null,
  duplicateChargeAcknowledged: false,
  duplicateChargeAcknowledgedAt: null,
  createdAt: timestamp,
  updatedAt: timestamp,
});

const makeProject = (): StudioProjectV2 => ({
  schemaVersion: 2,
  revision: 7,
  id: 'project_1',
  name: 'Project One',
  brief: '',
  rules: [],
  ruleListUndo: null,
  briefConversationId: null,
  aspectRatio: '16:9',
  targetDurationSeconds: 30,
  resolution: '1080p',
  beatOrder: ['section_1', 'section_2'],
  beats: {
    section_1: makeBeat('section_1', ['clip_1']),
    section_2: makeBeat('section_2', ['clip_2']),
  },
  shots: {
    clip_1: makeShot('clip_1'),
    clip_2: makeShot('clip_2'),
  },
  bin: [],
  cuts: {},
  activeCutId: null,
  assets: {},
  jobs: {},
  routing: { image: null, video: null },
  createdAt: timestamp,
  updatedAt: timestamp,
});

const addCanonicalAsset = (project: StudioProjectV2, shotId: string, assetId: string): void => {
  project.assets[assetId] = makeAsset(assetId, shotId);
  project.shots[shotId]!.assetIds.push(assetId);
};

const batch = (
  operations: StudioMutationOperationV2[],
  overrides: Partial<StudioMutationBatchV2> = {}
): StudioMutationBatchV2 => ({
  schemaVersion: 2,
  projectId: 'project_1',
  expectedRevision: 7,
  operations,
  ...overrides,
});

const emptyShotInput = (): Extract<StudioMutationOperationV2, { kind: 'add_shot' }>['shot'] => ({
  line: '',
  narration: '',
  onScreenText: '',
  mediaKind: 'image',
  durationSeconds: 5,
  referenceAssetId: null,
});

const expectReason = (action: () => unknown, reasonCode: StudioMutationReasonV2): void => {
  try {
    action();
    throw new Error('Expected mutation to fail');
  } catch (error) {
    expect(error).toBeInstanceOf(StudioMutationErrorV2);
    expect((error as StudioMutationErrorV2).reasonCode).toBe(reasonCode);
  }
};

const sparseArray = <T>(length: number): T[] => {
  const value: T[] = [];
  value.length = length;
  return value;
};

describe('applyStudioMutationBatchV2 operations', () => {
  it('sets the brief without advancing the persistence revision or timestamp', () => {
    const result = applyStudioMutationBatchV2(makeProject(), batch([{ kind: 'set_brief', brief: 'New brief' }]));

    expect(result.project).toMatchObject({ brief: 'New brief', revision: 7, updatedAt: timestamp });
  });

  it('preserves unrelated cut state when setting the brief', () => {
    const project = makeProject();
    addCanonicalAsset(project, 'clip_1', 'asset_1');
    project.shots.clip_1!.selectedTakeId = 'asset_1';
    project.cuts.cut_1 = { id: 'cut_1', name: 'Cut', orderMode: 'storyboard', clipOrder: [], clips: {} };
    project.activeCutId = 'cut_1';
    const cutsBefore = JSON.stringify(project.cuts);

    const result = applyStudioMutationBatchV2(project, batch([{ kind: 'set_brief', brief: 'New brief' }]));

    expect(JSON.stringify(result.project.cuts)).toBe(cutsBefore);
  });

  it('preserves operational ledgers, routes, rules, and references during free authoring', () => {
    const project = makeProject();
    addCanonicalAsset(project, 'clip_1', 'asset_1');
    project.jobs.job_1 = makeJob('job_1', 'clip_1');
    project.shots.clip_1!.jobIds.push('job_1');
    project.assets.cast_1 = {
      ...makeAsset('cast_1', 'clip_1'),
      shotId: null,
      managedAsset: { collection: 'imports', fileName: 'cast_1.png' },
      briefReferenceRole: 'cast',
      briefReferenceLabel: 'Lead',
    };
    project.routing = {
      image: { providerId: 'provider_1', adapterId: 'weprompt-image-v1', model: 'image-model' },
      video: null,
    };
    project.rules = [{ id: 'rule_1', scope: 'project', text: 'Keep it bright', predicate: null, createdAt: timestamp }];
    project.ruleListUndo = { capturedRevision: 6, previousRules: [] };
    const preserved = structuredClone({
      assets: project.assets,
      jobs: project.jobs,
      routing: project.routing,
      rules: project.rules,
      ruleListUndo: project.ruleListUndo,
    });

    const result = applyStudioMutationBatchV2(
      project,
      batch([{ kind: 'edit_beat', beatId: 'section_1', changes: { title: 'Opening' } }])
    );

    expect({
      assets: result.project.assets,
      jobs: result.project.jobs,
      routing: result.project.routing,
      rules: result.project.rules,
      ruleListUndo: result.project.ruleListUndo,
    }).toEqual(preserved);
  });

  it('adds a beat and its first shot at the requested active position', () => {
    const result = applyStudioMutationBatchV2(
      makeProject(),
      batch([
        {
          kind: 'add_beat',
          beatId: 'section_new',
          beat: { title: 'New', action: 'Story', look: 'Look' },
          firstShotId: 'clip_new',
          firstShot: emptyShotInput(),
          beforeBeatId: 'section_2',
        },
      ])
    );

    expect(result).toMatchObject({
      project: { beatOrder: ['section_1', 'section_new', 'section_2'] },
      createdBeatIds: ['section_new'],
      createdShotIds: ['clip_new'],
    });
    expect(result.project.beats.section_new!.shotOrder).toEqual(['clip_new']);
  });

  it('edits authored beat fields without replacing its shot ownership', () => {
    const result = applyStudioMutationBatchV2(
      makeProject(),
      batch([{ kind: 'edit_beat', beatId: 'section_1', changes: { title: 'Opening' } }])
    );

    expect(result.project.beats.section_1).toMatchObject({ title: 'Opening', shotOrder: ['clip_1'] });
  });

  it('reorders the complete active beat permutation', () => {
    const result = applyStudioMutationBatchV2(
      makeProject(),
      batch([{ kind: 'reorder_beats', beatOrder: ['section_2', 'section_1'] }])
    );

    expect(result.project.beatOrder).toEqual(['section_2', 'section_1']);
  });

  it('reorders beats without retargeting a deliberate cut take', () => {
    const project = makeProject();
    addCanonicalAsset(project, 'clip_1', 'asset_selected');
    addCanonicalAsset(project, 'clip_1', 'asset_cut');
    project.shots.clip_1!.selectedTakeId = 'asset_selected';
    project.cuts.cut_1 = {
      id: 'cut_1',
      name: 'Cut',
      orderMode: 'manual',
      clipOrder: ['cut_clip_1'],
      clips: {
        cut_clip_1: {
          id: 'cut_clip_1',
          clipId: 'clip_1',
          assetId: 'asset_cut',
          sourceInSeconds: null,
          sourceOutSeconds: null,
          crop: null,
          filters: [],
        },
      },
    };

    const result = applyStudioMutationBatchV2(
      project,
      batch([{ kind: 'reorder_beats', beatOrder: ['section_2', 'section_1'] }])
    );

    expect(result.project.cuts.cut_1!.clips.cut_clip_1!.assetId).toBe('asset_cut');
  });

  it('parks an active beat by appending its Bin identity', () => {
    const result = applyStudioMutationBatchV2(makeProject(), batch([{ kind: 'park_beat', beatId: 'section_1' }]));

    expect(result.project).toMatchObject({
      beatOrder: ['section_2'],
      bin: [{ kind: 'beat', beatId: 'section_1' }],
    });
    expect(result.project.beats.section_1!.shotOrder).toEqual(['clip_1']);
  });

  it('restores a parked beat before the requested active beat', () => {
    const project = makeProject();
    project.beatOrder = ['section_2'];
    project.bin = [{ kind: 'beat', beatId: 'section_1' }];

    const result = applyStudioMutationBatchV2(
      project,
      batch([{ kind: 'restore_beat', beatId: 'section_1', beforeBeatId: 'section_2' }])
    );

    expect(result.project).toMatchObject({ beatOrder: ['section_1', 'section_2'], bin: [] });
  });

  it('adds a shot before an existing shot in its owning beat', () => {
    const result = applyStudioMutationBatchV2(
      makeProject(),
      batch([
        {
          kind: 'add_shot',
          beatId: 'section_1',
          shotId: 'clip_new',
          shot: emptyShotInput(),
          beforeShotId: 'clip_1',
        },
      ])
    );

    expect(result.project.beats.section_1!.shotOrder).toEqual(['clip_new', 'clip_1']);
    expect(result.createdShotIds).toEqual(['clip_new']);
  });

  it('edits authored shot fields without replacing operational arrays', () => {
    const project = makeProject();
    addCanonicalAsset(project, 'clip_1', 'asset_1');

    const result = applyStudioMutationBatchV2(
      project,
      batch([{ kind: 'edit_shot', shotId: 'clip_1', changes: { line: 'Wide shot' } }])
    );

    expect(result.project.shots.clip_1).toMatchObject({ line: 'Wide shot', assetIds: ['asset_1'], jobIds: [] });
  });

  it('accepts an unchanged reference identity allowed by the schema validator', () => {
    const project = makeProject();
    project.assets.video_reference = {
      ...makeAsset('video_reference', 'clip_1'),
      mediaKind: 'video',
      mimeType: 'video/mp4',
      managedAsset: { collection: 'assets', fileName: 'video_reference.mp4' },
    };
    project.shots.clip_1!.assetIds.push('video_reference');
    project.shots.clip_1!.referenceAssetId = 'video_reference';

    const result = applyStudioMutationBatchV2(
      project,
      batch([{ kind: 'edit_shot', shotId: 'clip_1', changes: { narration: 'Narration' } }])
    );

    expect(result.project.shots.clip_1).toMatchObject({
      narration: 'Narration',
      referenceAssetId: 'video_reference',
    });
  });

  it('deletes a dependency-free shot and its ownership link', () => {
    const result = applyStudioMutationBatchV2(makeProject(), batch([{ kind: 'delete_shot', shotId: 'clip_1' }]));

    expect(Object.hasOwn(result.project.shots, 'clip_1')).toBe(false);
    expect(result.project.beats.section_1!.shotOrder).toEqual([]);
  });

  it('reorders the complete shot permutation for an active or parked beat', () => {
    const project = makeProject();
    project.beats.section_1!.shotOrder.push('clip_3');
    project.shots.clip_3 = makeShot('clip_3');
    project.beatOrder = ['section_2'];
    project.bin = [{ kind: 'beat', beatId: 'section_1' }];

    const result = applyStudioMutationBatchV2(
      project,
      batch([{ kind: 'reorder_shots', beatId: 'section_1', shotOrder: ['clip_3', 'clip_1'] }])
    );

    expect(result.project.beats.section_1!.shotOrder).toEqual(['clip_3', 'clip_1']);
  });

  it('parks an unselected canonical take as an appended Bin take reference', () => {
    const project = makeProject();
    addCanonicalAsset(project, 'clip_1', 'asset_1');

    const result = applyStudioMutationBatchV2(
      project,
      batch([{ kind: 'park_take', shotId: 'clip_1', assetId: 'asset_1' }])
    );

    expect(result.project.bin).toEqual([{ kind: 'take', assetId: 'asset_1' }]);
  });

  it('selects a binned take and removes its reference atomically', () => {
    const project = makeProject();
    addCanonicalAsset(project, 'clip_1', 'asset_1');
    project.bin = [{ kind: 'take', assetId: 'asset_1' }];

    const result = applyStudioMutationBatchV2(
      project,
      batch([{ kind: 'restore_take', shotId: 'clip_1', assetId: 'asset_1' }])
    );

    expect(result.project.shots.clip_1!.selectedTakeId).toBe('asset_1');
    expect(result.project.bin).toEqual([]);
  });

  it('creates a dormant storyboard entry when selecting a take for a parked shot', () => {
    const project = makeProject();
    addCanonicalAsset(project, 'clip_2', 'asset_2');
    project.beatOrder = ['section_1'];
    project.bin = [
      { kind: 'beat', beatId: 'section_2' },
      { kind: 'take', assetId: 'asset_2' },
    ];
    project.cuts.cut_1 = { id: 'cut_1', name: 'Cut', orderMode: 'storyboard', clipOrder: [], clips: {} };

    const result = applyStudioMutationBatchV2(
      project,
      batch([{ kind: 'restore_take', shotId: 'clip_2', assetId: 'asset_2' }])
    );

    expect(result.project.cuts.cut_1!.clipOrder).toEqual(['clip_clip_2']);
    expect(result.project.cuts.cut_1!.clips.clip_clip_2).toMatchObject({ clipId: 'clip_2', assetId: 'asset_2' });
  });

  it('switches a cut to a binned take without implicitly binning the prior selection', () => {
    const project = makeProject();
    addCanonicalAsset(project, 'clip_1', 'asset_old');
    addCanonicalAsset(project, 'clip_1', 'asset_new');
    project.assets.asset_old!.durationSeconds = 10;
    project.assets.asset_new!.durationSeconds = 6;
    project.shots.clip_1!.selectedTakeId = 'asset_old';
    project.bin = [{ kind: 'take', assetId: 'asset_new' }];
    project.cuts.cut_1 = {
      id: 'cut_1',
      name: 'Cut',
      orderMode: 'manual',
      clipOrder: ['cut_clip_1'],
      clips: {
        cut_clip_1: {
          id: 'cut_clip_1',
          clipId: 'clip_1',
          assetId: 'asset_old',
          sourceInSeconds: 4,
          sourceOutSeconds: 9,
          crop: null,
          filters: [],
        },
      },
    };

    const result = applyStudioMutationBatchV2(
      project,
      batch([{ kind: 'restore_take', shotId: 'clip_1', assetId: 'asset_new' }])
    );

    expect(result.project).toMatchObject({
      bin: [],
      shots: { clip_1: { selectedTakeId: 'asset_new' } },
      cuts: { cut_1: { clips: { cut_clip_1: { assetId: 'asset_new', sourceOutSeconds: 6 } } } },
    });
    expect(result.project.assets.asset_old).toEqual(project.assets.asset_old);
  });

  it('removes a take reference without deleting the retained asset', () => {
    const project = makeProject();
    addCanonicalAsset(project, 'clip_1', 'asset_1');
    project.bin = [{ kind: 'take', assetId: 'asset_1' }];

    const result = applyStudioMutationBatchV2(project, batch([{ kind: 'remove_bin_item', assetId: 'asset_1' }]));

    expect(result.project.bin).toEqual([]);
    expect(result.project.assets.asset_1).toEqual(project.assets.asset_1);
  });

  it('reorders the exact complete Bin identity permutation', () => {
    const project = makeProject();
    addCanonicalAsset(project, 'clip_1', 'asset_1');
    project.beatOrder = ['section_1'];
    project.bin = [
      { kind: 'beat', beatId: 'section_2' },
      { kind: 'take', assetId: 'asset_1' },
    ];

    const result = applyStudioMutationBatchV2(
      project,
      batch([
        {
          kind: 'reorder_bin',
          bin: [
            { kind: 'take', assetId: 'asset_1' },
            { kind: 'beat', beatId: 'section_2' },
          ],
        },
      ])
    );

    expect(result.project.bin).toEqual([
      { kind: 'take', assetId: 'asset_1' },
      { kind: 'beat', beatId: 'section_2' },
    ]);
  });

  it('selects a canonical take and reconciles a storyboard cut', () => {
    const project = makeProject();
    addCanonicalAsset(project, 'clip_1', 'asset_1');
    project.cuts.cut_1 = { id: 'cut_1', name: 'Cut', orderMode: 'storyboard', clipOrder: [], clips: {} };
    project.activeCutId = 'cut_1';

    const result = applyStudioMutationBatchV2(
      project,
      batch([{ kind: 'select_take', shotId: 'clip_1', assetId: 'asset_1' }])
    );

    expect(result.project.shots.clip_1!.selectedTakeId).toBe('asset_1');
    expect(Object.values(result.project.cuts.cut_1!.clips)[0]).toMatchObject({ clipId: 'clip_1', assetId: 'asset_1' });
  });
});

describe('applyStudioMutationBatchV2 ordering and atomicity', () => {
  it('makes a newly added identity visible to later operations in the same batch', () => {
    const result = applyStudioMutationBatchV2(
      makeProject(),
      batch([
        {
          kind: 'add_shot',
          beatId: 'section_1',
          shotId: 'clip_new',
          shot: emptyShotInput(),
          beforeShotId: null,
        },
        { kind: 'edit_shot', shotId: 'clip_new', changes: { narration: 'Visible later' } },
        { kind: 'reorder_shots', beatId: 'section_1', shotOrder: ['clip_new', 'clip_1'] },
      ])
    );

    expect(result.project.shots.clip_new!.narration).toBe('Visible later');
    expect(result.project.beats.section_1!.shotOrder).toEqual(['clip_new', 'clip_1']);
  });

  it('makes cut reconciliation visible before a later take park', () => {
    const project = makeProject();
    addCanonicalAsset(project, 'clip_1', 'asset_old');
    addCanonicalAsset(project, 'clip_1', 'asset_new');
    project.shots.clip_1!.selectedTakeId = 'asset_old';
    project.cuts.cut_1 = {
      id: 'cut_1',
      name: 'Cut',
      orderMode: 'manual',
      clipOrder: ['cut_clip_1'],
      clips: {
        cut_clip_1: {
          id: 'cut_clip_1',
          clipId: 'clip_1',
          assetId: 'asset_old',
          sourceInSeconds: null,
          sourceOutSeconds: null,
          crop: null,
          filters: [],
        },
      },
    };

    const result = applyStudioMutationBatchV2(
      project,
      batch([
        { kind: 'select_take', shotId: 'clip_1', assetId: 'asset_new' },
        { kind: 'park_take', shotId: 'clip_1', assetId: 'asset_old' },
      ])
    );

    expect(result.project.bin).toEqual([{ kind: 'take', assetId: 'asset_old' }]);
    expect(result.project.cuts.cut_1!.clips.cut_clip_1!.assetId).toBe('asset_new');
  });

  it('returns created identities in creation operation order', () => {
    const result = applyStudioMutationBatchV2(
      makeProject(),
      batch([
        {
          kind: 'add_shot',
          beatId: 'section_1',
          shotId: 'clip_3',
          shot: emptyShotInput(),
          beforeShotId: null,
        },
        {
          kind: 'add_beat',
          beatId: 'section_3',
          beat: { title: '', action: '', look: '' },
          firstShotId: 'clip_4',
          firstShot: emptyShotInput(),
          beforeBeatId: null,
        },
        {
          kind: 'add_shot',
          beatId: 'section_3',
          shotId: 'clip_5',
          shot: emptyShotInput(),
          beforeShotId: null,
        },
      ])
    );

    expect(result.createdBeatIds).toEqual(['section_3']);
    expect(result.createdShotIds).toEqual(['clip_3', 'clip_4', 'clip_5']);
  });

  it('does not mutate the input after a successful batch', () => {
    const project = makeProject();
    const before = structuredClone(project);

    applyStudioMutationBatchV2(project, batch([{ kind: 'set_brief', brief: 'Changed' }]));

    expect(project).toEqual(before);
  });

  it('rolls back all earlier operations when a later operation fails', () => {
    const project = makeProject();
    const before = JSON.stringify(project);

    expectReason(
      () =>
        applyStudioMutationBatchV2(
          project,
          batch([
            { kind: 'set_brief', brief: 'Must roll back' },
            { kind: 'delete_shot', shotId: 'missing_clip' },
          ])
        ),
      'invalid_operation'
    );
    expect(JSON.stringify(project)).toBe(before);
  });

  it('allows delete-before-add to free beat capacity', () => {
    const project = makeProject();
    for (let index = 3; index <= 9; index += 1) {
      const shotId = `clip_${index}`;
      project.shots[shotId] = makeShot(shotId);
      project.beats.section_1!.shotOrder.push(shotId);
    }

    const result = applyStudioMutationBatchV2(
      project,
      batch([
        { kind: 'delete_shot', shotId: 'clip_1' },
        {
          kind: 'add_shot',
          beatId: 'section_1',
          shotId: 'clip_10',
          shot: emptyShotInput(),
          beforeShotId: null,
        },
      ])
    );

    expect(result.project.beats.section_1!.shotOrder).toHaveLength(8);
  });

  it('rejects add-before-delete at beat capacity', () => {
    const project = makeProject();
    for (let index = 3; index <= 9; index += 1) {
      const shotId = `clip_${index}`;
      project.shots[shotId] = makeShot(shotId);
      project.beats.section_1!.shotOrder.push(shotId);
    }

    expectReason(
      () =>
        applyStudioMutationBatchV2(
          project,
          batch([
            {
              kind: 'add_shot',
              beatId: 'section_1',
              shotId: 'clip_10',
              shot: emptyShotInput(),
              beforeShotId: null,
            },
            { kind: 'delete_shot', shotId: 'clip_1' },
          ])
        ),
      'beat_shot_capacity_reached'
    );
  });
});

describe('applyStudioMutationBatchV2 boundaries', () => {
  it('accepts one mutation operation', () => {
    const result = applyStudioMutationBatchV2(makeProject(), batch([{ kind: 'set_brief', brief: 'one' }]));

    expect(result.project.brief).toBe('one');
  });

  it('accepts exactly 32 mutation operations', () => {
    const operations = Array.from(
      { length: 32 },
      (_, index): StudioMutationOperationV2 => ({ kind: 'set_brief', brief: `brief ${index}` })
    );

    const result = applyStudioMutationBatchV2(makeProject(), batch(operations));

    expect(result.project.brief).toBe('brief 31');
  });

  it('rejects an empty mutation batch', () => {
    expectReason(() => applyStudioMutationBatchV2(makeProject(), batch([])), 'invalid_operation');
  });

  it('rejects 33 mutation operations', () => {
    const operations = Array.from(
      { length: 33 },
      (_, index): StudioMutationOperationV2 => ({ kind: 'set_brief', brief: `brief ${index}` })
    );

    expectReason(() => applyStudioMutationBatchV2(makeProject(), batch(operations)), 'invalid_operation');
  });

  it('rejects an envelope for another revision', () => {
    expectReason(
      () =>
        applyStudioMutationBatchV2(makeProject(), batch([{ kind: 'set_brief', brief: 'x' }], { expectedRevision: 6 })),
      'invalid_operation'
    );
  });

  it('rejects an envelope for another project', () => {
    expectReason(
      () =>
        applyStudioMutationBatchV2(
          makeProject(),
          batch([{ kind: 'set_brief', brief: 'x' }], { projectId: 'project_2' })
        ),
      'invalid_operation'
    );
  });

  it('rejects an unknown envelope key', () => {
    const input = { ...batch([{ kind: 'set_brief', brief: 'x' }]), extra: true } as unknown as StudioMutationBatchV2;

    expectReason(() => applyStudioMutationBatchV2(makeProject(), input), 'invalid_operation');
  });

  it('rejects another mutation schema version', () => {
    const input = {
      ...batch([{ kind: 'set_brief', brief: 'x' }]),
      schemaVersion: 1,
    } as unknown as StudioMutationBatchV2;

    expectReason(() => applyStudioMutationBatchV2(makeProject(), input), 'invalid_operation');
  });

  it('reports beat capacity before identity collision', () => {
    const project = makeProject();
    for (let index = 3; index <= 24; index += 1) {
      const beatId = `section_${index}`;
      const shotId = `section_clip_${index}`;
      project.beats[beatId] = makeBeat(beatId, [shotId]);
      project.shots[shotId] = makeShot(shotId);
      project.beatOrder.push(beatId);
    }

    expectReason(
      () =>
        applyStudioMutationBatchV2(
          project,
          batch([
            {
              kind: 'add_beat',
              beatId: 'section_1',
              beat: { title: '', action: '', look: '' },
              firstShotId: 'new_clip',
              firstShot: emptyShotInput(),
              beforeBeatId: null,
            },
          ])
        ),
      'beat_capacity_reached'
    );
  });

  it('reports invalid duration after available capacity and collision checks', () => {
    expectReason(
      () =>
        applyStudioMutationBatchV2(
          makeProject(),
          batch([
            {
              kind: 'add_shot',
              beatId: 'section_1',
              shotId: 'clip_new',
              shot: { ...emptyShotInput(), mediaKind: 'video', durationSeconds: 3 },
              beforeShotId: null,
            },
          ])
        ),
      'invalid_shot_duration'
    );
  });

  it('reports invalid duration for a shot edit', () => {
    expectReason(
      () =>
        applyStudioMutationBatchV2(
          makeProject(),
          batch([{ kind: 'edit_shot', shotId: 'clip_1', changes: { mediaKind: 'video', durationSeconds: 3 } }])
        ),
      'invalid_shot_duration'
    );
  });

  it('reports project shot capacity when the target beat still has room', () => {
    const project = makeProject();
    project.beatOrder = [];
    project.beats = {};
    project.shots = {};
    for (let beatIndex = 1; beatIndex <= 13; beatIndex += 1) {
      const beatId = `section_${beatIndex}`;
      const count = beatIndex === 1 ? 1 : beatIndex === 13 ? 7 : 8;
      const shotOrder = Array.from({ length: count }, (_, shotIndex) => `clip_${beatIndex}_${shotIndex}`);
      project.beatOrder.push(beatId);
      project.beats[beatId] = makeBeat(beatId, shotOrder);
      for (const shotId of shotOrder) project.shots[shotId] = makeShot(shotId);
    }

    expect(validateStudioProjectV2(project)).toBe(true);
    expectReason(
      () =>
        applyStudioMutationBatchV2(
          project,
          batch([
            {
              kind: 'add_shot',
              beatId: 'section_1',
              shotId: 'clip_new',
              shot: emptyShotInput(),
              beforeShotId: null,
            },
          ])
        ),
      'project_shot_capacity_reached'
    );
  });

  it('reports beat capacity before simultaneous project, collision, and duration failures', () => {
    const project = makeProject();
    project.beatOrder = [];
    project.beats = {};
    project.shots = {};
    for (let beatIndex = 1; beatIndex <= 12; beatIndex += 1) {
      const beatId = `section_${beatIndex}`;
      const shotOrder = Array.from({ length: 8 }, (_, shotIndex) => `clip_${beatIndex}_${shotIndex}`);
      project.beatOrder.push(beatId);
      project.beats[beatId] = makeBeat(beatId, shotOrder);
      for (const shotId of shotOrder) project.shots[shotId] = makeShot(shotId);
    }

    expectReason(
      () =>
        applyStudioMutationBatchV2(
          project,
          batch([
            {
              kind: 'add_shot',
              beatId: 'section_1',
              shotId: 'clip_1_0',
              shot: { ...emptyShotInput(), mediaKind: 'video', durationSeconds: 3 },
              beforeShotId: null,
            },
          ])
        ),
      'beat_shot_capacity_reached'
    );
  });

  it('reports identity collision before an invalid duration when capacity remains', () => {
    expectReason(
      () =>
        applyStudioMutationBatchV2(
          makeProject(),
          batch([
            {
              kind: 'add_shot',
              beatId: 'section_1',
              shotId: 'clip_1',
              shot: { ...emptyShotInput(), mediaKind: 'video', durationSeconds: 3 },
              beforeShotId: null,
            },
          ])
        ),
      'identity_collision'
    );
  });

  it('rejects a reused identity even after deletion earlier in the batch', () => {
    expectReason(
      () =>
        applyStudioMutationBatchV2(
          makeProject(),
          batch([
            { kind: 'delete_shot', shotId: 'clip_1' },
            {
              kind: 'add_shot',
              beatId: 'section_1',
              shotId: 'clip_1',
              shot: emptyShotInput(),
              beforeShotId: null,
            },
          ])
        ),
      'identity_collision'
    );
  });
});

describe('applyStudioMutationBatchV2 validation and dependencies', () => {
  it('rejects an unknown operation key', () => {
    const operation = { kind: 'set_brief', brief: 'x', extra: true } as unknown as StudioMutationOperationV2;

    expectReason(() => applyStudioMutationBatchV2(makeProject(), batch([operation])), 'invalid_operation');
  });

  it('rejects an unknown nested add payload key', () => {
    const operation = {
      kind: 'add_shot',
      beatId: 'section_1',
      shotId: 'clip_new',
      shot: { ...emptyShotInput(), extra: true },
      beforeShotId: null,
    } as unknown as StudioMutationOperationV2;

    expectReason(() => applyStudioMutationBatchV2(makeProject(), batch([operation])), 'invalid_operation');
  });

  it('rejects an unknown edit changes key', () => {
    const operation = {
      kind: 'edit_beat',
      beatId: 'section_1',
      changes: { title: 'Opening', extra: true },
    } as unknown as StudioMutationOperationV2;

    expectReason(() => applyStudioMutationBatchV2(makeProject(), batch([operation])), 'invalid_operation');
  });

  it('rejects a sparse Bin reorder with a bounded error', () => {
    const project = makeProject();
    addCanonicalAsset(project, 'clip_1', 'asset_1');
    project.bin = [{ kind: 'take', assetId: 'asset_1' }];
    const sparseBin = sparseArray<StudioProjectV2['bin'][number]>(1);

    expectReason(
      () => applyStudioMutationBatchV2(project, batch([{ kind: 'reorder_bin', bin: sparseBin }])),
      'invalid_operation'
    );
  });

  it('does not invoke an own array-method shadow', () => {
    const beatOrder = ['section_2', 'section_1'];
    Object.defineProperty(beatOrder, 'every', { value: null });

    const result = applyStudioMutationBatchV2(makeProject(), batch([{ kind: 'reorder_beats', beatOrder: beatOrder }]));

    expect(result.project.beatOrder).toEqual(['section_2', 'section_1']);
  });

  it('maps a hostile operation proxy to a bounded error', () => {
    const operation = new Proxy(
      { kind: 'set_brief', brief: 'x' },
      {
        ownKeys: () => {
          throw new Error('hostile ownKeys trap');
        },
      }
    ) as StudioMutationOperationV2;

    expectReason(() => applyStudioMutationBatchV2(makeProject(), batch([operation])), 'invalid_operation');
  });

  it('maps a throwing operation-array accessor to a bounded error', () => {
    const input = batch([{ kind: 'set_brief', brief: 'x' }]);
    Object.defineProperty(input.operations, 0, {
      configurable: true,
      enumerable: true,
      get: () => {
        throw new Error('hostile operation getter');
      },
    });

    expectReason(() => applyStudioMutationBatchV2(makeProject(), input), 'invalid_operation');
  });

  it('rejects an accessor operation without invoking it or contaminating project state', () => {
    const project = makeProject();
    let getterCalls = 0;
    const operation = { kind: 'set_brief' } as unknown as StudioMutationOperationV2;
    Object.defineProperty(operation, 'brief', {
      configurable: true,
      enumerable: true,
      get: () => {
        getterCalls += 1;
        project.name = 'Getter changed name';
        return 'x';
      },
    });

    expectReason(() => applyStudioMutationBatchV2(project, batch([operation])), 'invalid_operation');
    expect(getterCalls).toBe(0);
    expect(project.name).toBe('Project One');
  });

  it('maps a malformed sparse project to validation_failed', () => {
    const project = makeProject();
    project.shots.clip_1!.jobIds = sparseArray<string>(1);

    expectReason(
      () => applyStudioMutationBatchV2(project, batch([{ kind: 'set_brief', brief: 'x' }])),
      'validation_failed'
    );
  });

  it('rejects an empty edit changes object', () => {
    const operation = { kind: 'edit_shot', shotId: 'clip_1', changes: {} } as StudioMutationOperationV2;

    expectReason(() => applyStudioMutationBatchV2(makeProject(), batch([operation])), 'invalid_operation');
  });

  it('rejects reorder inputs that are not exact permutations', () => {
    expectReason(
      () =>
        applyStudioMutationBatchV2(
          makeProject(),
          batch([{ kind: 'reorder_beats', beatOrder: ['section_1', 'section_1'] }])
        ),
      'invalid_operation'
    );
  });

  it('rejects a shot reorder that omits an owned shot', () => {
    const project = makeProject();
    project.beats.section_1!.shotOrder.push('clip_3');
    project.shots.clip_3 = makeShot('clip_3');

    expectReason(
      () =>
        applyStudioMutationBatchV2(
          project,
          batch([{ kind: 'reorder_shots', beatId: 'section_1', shotOrder: ['clip_1'] }])
        ),
      'invalid_operation'
    );
  });

  it('rejects a Bin reorder that duplicates an identity', () => {
    const project = makeProject();
    addCanonicalAsset(project, 'clip_1', 'asset_1');
    project.beatOrder = ['section_1'];
    project.bin = [
      { kind: 'beat', beatId: 'section_2' },
      { kind: 'take', assetId: 'asset_1' },
    ];

    expectReason(
      () =>
        applyStudioMutationBatchV2(
          project,
          batch([
            {
              kind: 'reorder_bin',
              bin: [
                { kind: 'take', assetId: 'asset_1' },
                { kind: 'take', assetId: 'asset_1' },
              ],
            },
          ])
        ),
      'invalid_operation'
    );
  });

  it('rejects a non-null reference identity on a newly created shot', () => {
    expectReason(
      () =>
        applyStudioMutationBatchV2(
          makeProject(),
          batch([
            {
              kind: 'add_shot',
              beatId: 'section_1',
              shotId: 'clip_new',
              shot: { ...emptyShotInput(), referenceAssetId: 'asset_1' },
              beforeShotId: null,
            },
          ])
        ),
      'invalid_operation'
    );
  });

  it('blocks deletion of a shot with an asset dependency', () => {
    const project = makeProject();
    addCanonicalAsset(project, 'clip_1', 'asset_1');

    expectReason(
      () => applyStudioMutationBatchV2(project, batch([{ kind: 'delete_shot', shotId: 'clip_1' }])),
      'dependency_blocked'
    );
  });

  it('blocks deletion of a shot with a job dependency', () => {
    const project = makeProject();
    project.jobs.job_1 = makeJob('job_1', 'clip_1');
    project.shots.clip_1!.jobIds.push('job_1');

    expectReason(
      () => applyStudioMutationBatchV2(project, batch([{ kind: 'delete_shot', shotId: 'clip_1' }])),
      'dependency_blocked'
    );
  });

  it('blocks deletion of a shot referenced by a dormant cut entry', () => {
    const project = makeProject();
    addCanonicalAsset(project, 'clip_1', 'asset_1');
    project.shots.clip_1!.selectedTakeId = 'asset_1';
    project.beatOrder = ['section_2'];
    project.bin = [{ kind: 'beat', beatId: 'section_1' }];
    project.cuts.cut_1 = {
      id: 'cut_1',
      name: 'Cut',
      orderMode: 'manual',
      clipOrder: ['cut_clip_1'],
      clips: {
        cut_clip_1: {
          id: 'cut_clip_1',
          clipId: 'clip_1',
          assetId: 'asset_1',
          sourceInSeconds: null,
          sourceOutSeconds: null,
          crop: null,
          filters: [],
        },
      },
    };

    expectReason(
      () => applyStudioMutationBatchV2(project, batch([{ kind: 'delete_shot', shotId: 'clip_1' }])),
      'dependency_blocked'
    );
  });

  it('refuses to park a selected take', () => {
    const project = makeProject();
    addCanonicalAsset(project, 'clip_1', 'asset_1');
    project.shots.clip_1!.selectedTakeId = 'asset_1';

    expectReason(
      () => applyStudioMutationBatchV2(project, batch([{ kind: 'park_take', shotId: 'clip_1', assetId: 'asset_1' }])),
      'dependency_blocked'
    );
  });

  it('refuses to park a take referenced by a cut even when another take is selected', () => {
    const project = makeProject();
    addCanonicalAsset(project, 'clip_1', 'asset_1');
    addCanonicalAsset(project, 'clip_1', 'asset_2');
    project.shots.clip_1!.selectedTakeId = 'asset_2';
    project.cuts.cut_1 = {
      id: 'cut_1',
      name: 'Cut',
      orderMode: 'manual',
      clipOrder: ['cut_clip_1'],
      clips: {
        cut_clip_1: {
          id: 'cut_clip_1',
          clipId: 'clip_1',
          assetId: 'asset_1',
          sourceInSeconds: null,
          sourceOutSeconds: null,
          crop: null,
          filters: [],
        },
      },
    };

    expect(validateStudioProjectV2(project)).toBe(true);
    expectReason(
      () => applyStudioMutationBatchV2(project, batch([{ kind: 'park_take', shotId: 'clip_1', assetId: 'asset_1' }])),
      'dependency_blocked'
    );
  });

  it('rejects a noncanonical take reference', () => {
    const project = makeProject();
    project.assets.import_1 = {
      ...makeAsset('import_1', 'clip_1'),
      managedAsset: { collection: 'imports', fileName: 'import_1.png' },
    };
    project.shots.clip_1!.assetIds.push('import_1');

    expectReason(
      () => applyStudioMutationBatchV2(project, batch([{ kind: 'park_take', shotId: 'clip_1', assetId: 'import_1' }])),
      'invalid_operation'
    );
  });

  it('rejects a duplicate take reference identity', () => {
    const project = makeProject();
    addCanonicalAsset(project, 'clip_1', 'asset_1');
    project.bin = [{ kind: 'take', assetId: 'asset_1' }];

    expectReason(
      () => applyStudioMutationBatchV2(project, batch([{ kind: 'park_take', shotId: 'clip_1', assetId: 'asset_1' }])),
      'invalid_operation'
    );
  });

  it('blocks a media-kind edit while the shot has a binned take', () => {
    const project = makeProject();
    addCanonicalAsset(project, 'clip_1', 'asset_1');
    project.bin = [{ kind: 'take', assetId: 'asset_1' }];

    expectReason(
      () =>
        applyStudioMutationBatchV2(
          project,
          batch([{ kind: 'edit_shot', shotId: 'clip_1', changes: { mediaKind: 'video', durationSeconds: 5 } }])
        ),
      'dependency_blocked'
    );
  });

  it('blocks a media-kind edit while the shot has a selected take', () => {
    const project = makeProject();
    addCanonicalAsset(project, 'clip_1', 'asset_1');
    project.shots.clip_1!.selectedTakeId = 'asset_1';

    expectReason(
      () =>
        applyStudioMutationBatchV2(
          project,
          batch([{ kind: 'edit_shot', shotId: 'clip_1', changes: { mediaKind: 'video', durationSeconds: 5 } }])
        ),
      'dependency_blocked'
    );
  });

  it('blocks a media-kind edit while a cut clip depends on the shot', () => {
    const project = makeProject();
    addCanonicalAsset(project, 'clip_1', 'asset_1');
    project.cuts.cut_1 = {
      id: 'cut_1',
      name: 'Cut',
      orderMode: 'manual',
      clipOrder: ['cut_clip_1'],
      clips: {
        cut_clip_1: {
          id: 'cut_clip_1',
          clipId: 'clip_1',
          assetId: 'asset_1',
          sourceInSeconds: null,
          sourceOutSeconds: null,
          crop: null,
          filters: [],
        },
      },
    };

    expectReason(
      () =>
        applyStudioMutationBatchV2(
          project,
          batch([{ kind: 'edit_shot', shotId: 'clip_1', changes: { mediaKind: 'video', durationSeconds: 5 } }])
        ),
      'dependency_blocked'
    );
  });

  it('blocks a media-kind edit while the shot has a nonterminal job', () => {
    const project = makeProject();
    project.jobs.job_1 = makeJob('job_1', 'clip_1');
    project.shots.clip_1!.jobIds.push('job_1');

    expectReason(
      () =>
        applyStudioMutationBatchV2(
          project,
          batch([{ kind: 'edit_shot', shotId: 'clip_1', changes: { mediaKind: 'video', durationSeconds: 5 } }])
        ),
      'dependency_blocked'
    );
  });

  it('allows removing a Bin item before changing media kind in one batch', () => {
    const project = makeProject();
    addCanonicalAsset(project, 'clip_1', 'asset_1');
    project.bin = [{ kind: 'take', assetId: 'asset_1' }];

    const result = applyStudioMutationBatchV2(
      project,
      batch([
        { kind: 'remove_bin_item', assetId: 'asset_1' },
        { kind: 'edit_shot', shotId: 'clip_1', changes: { mediaKind: 'video', durationSeconds: 5 } },
      ])
    );

    expect(result.project.shots.clip_1).toMatchObject({ mediaKind: 'video', durationSeconds: 5 });
    expect(result.project.bin).toEqual([]);
  });

  it('treats equal raw beat and asset IDs as distinct Bin identities', () => {
    const project = makeProject();
    project.beats.same = makeBeat('same', ['clip_same']);
    project.shots.clip_same = makeShot('clip_same');
    addCanonicalAsset(project, 'clip_1', 'same');
    project.bin = [
      { kind: 'beat', beatId: 'same' },
      { kind: 'take', assetId: 'same' },
    ];

    const result = applyStudioMutationBatchV2(
      project,
      batch([
        {
          kind: 'reorder_bin',
          bin: [
            { kind: 'take', assetId: 'same' },
            { kind: 'beat', beatId: 'same' },
          ],
        },
      ])
    );

    expect(result.project.bin).toEqual([
      { kind: 'take', assetId: 'same' },
      { kind: 'beat', beatId: 'same' },
    ]);
  });

  it('requires the dedicated atomic operation to select a binned take', () => {
    const project = makeProject();
    addCanonicalAsset(project, 'clip_1', 'asset_1');
    project.bin = [{ kind: 'take', assetId: 'asset_1' }];

    expectReason(
      () => applyStudioMutationBatchV2(project, batch([{ kind: 'select_take', shotId: 'clip_1', assetId: 'asset_1' }])),
      'invalid_operation'
    );
  });

  it('rejects parking a take when the take-alias Bin capacity is full', () => {
    const project = makeProject();
    for (let index = 1; index <= 96; index += 1) {
      const assetId = `asset_${index}`;
      addCanonicalAsset(project, 'clip_1', assetId);
      project.bin.push({ kind: 'take', assetId });
    }
    addCanonicalAsset(project, 'clip_1', 'asset_97');

    expect(validateStudioProjectV2(project)).toBe(true);
    expectReason(
      () => applyStudioMutationBatchV2(project, batch([{ kind: 'park_take', shotId: 'clip_1', assetId: 'asset_97' }])),
      'validation_failed'
    );
  });

  it.each(['constructor', 'toString', '__proto__'])('round-trips and later mutates own magic identity %s', (id) => {
    const first = applyStudioMutationBatchV2(
      makeProject(),
      batch([
        {
          kind: 'add_beat',
          beatId: id,
          beat: { title: '', action: '', look: '' },
          firstShotId: `${id}_clip`,
          firstShot: emptyShotInput(),
          beforeBeatId: null,
        },
      ])
    );
    const restarted = JSON.parse(JSON.stringify(first.project)) as StudioProjectV2;

    const second = applyStudioMutationBatchV2(
      restarted,
      batch([{ kind: 'edit_beat', beatId: id, changes: { title: 'After restart' } }])
    );

    expect(Object.hasOwn(second.project.beats, id)).toBe(true);
    expect(second.project.beats[id]!.title).toBe('After restart');
    expect(validateStudioProjectV2(second.project)).toBe(true);
  });

  it.each(['constructor', 'toString', '__proto__'])(
    'round-trips and later mutates own magic shot identity %s',
    (id) => {
      const first = applyStudioMutationBatchV2(
        makeProject(),
        batch([
          {
            kind: 'add_shot',
            beatId: 'section_1',
            shotId: id,
            shot: emptyShotInput(),
            beforeShotId: null,
          },
        ])
      );
      const restarted = JSON.parse(JSON.stringify(first.project)) as StudioProjectV2;

      const second = applyStudioMutationBatchV2(
        restarted,
        batch([
          { kind: 'edit_shot', shotId: id, changes: { line: 'After restart' } },
          { kind: 'reorder_shots', beatId: 'section_1', shotOrder: [id, 'clip_1'] },
        ])
      );

      expect(Object.hasOwn(second.project.shots, id)).toBe(true);
      expect(second.project.shots[id]!.line).toBe('After restart');
      expect(validateStudioProjectV2(second.project)).toBe(true);
    }
  );

  it('rolls back the Bin and selection when a later operation fails', () => {
    const project = makeProject();
    addCanonicalAsset(project, 'clip_1', 'asset_1');
    project.bin = [{ kind: 'take', assetId: 'asset_1' }];

    expectReason(
      () =>
        applyStudioMutationBatchV2(
          project,
          batch([
            { kind: 'restore_take', shotId: 'clip_1', assetId: 'asset_1' },
            { kind: 'delete_shot', shotId: 'missing_clip' },
          ])
        ),
      'invalid_operation'
    );
    expect(project.shots.clip_1!.selectedTakeId).toBeNull();
    expect(project.bin).toEqual([{ kind: 'take', assetId: 'asset_1' }]);
  });
});
