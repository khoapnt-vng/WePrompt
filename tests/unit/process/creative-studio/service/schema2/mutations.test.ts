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
  shotPrompt: '',
  narration: '',
  onScreenText: '',
  mediaKind: 'image',
  durationSeconds: 5,
  referenceAssetId: null,
  selectedAssetId: null,
  assetIds: [],
  jobIds: [],
  ...overrides,
});

const makeBeat = (id: string, shotOrder: string[]): StudioBeat => ({
  id,
  title: '',
  storyLine: '',
  visualPrompt: '',
  clipOrder: shotOrder,
});

const makeAsset = (id: string, shotId: string): StudioAssetV2 => ({
  id,
  projectId: 'project_1',
  clipId: shotId,
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
  clipId: shotId,
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
  sectionOrder: ['section_1', 'section_2'],
  sections: {
    section_1: makeBeat('section_1', ['clip_1']),
    section_2: makeBeat('section_2', ['clip_2']),
  },
  clips: {
    clip_1: makeShot('clip_1'),
    clip_2: makeShot('clip_2'),
  },
  shelf: [],
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
  project.clips[shotId]!.assetIds.push(assetId);
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

const emptyShotInput = (): Extract<StudioMutationOperationV2, { kind: 'add_clip' }>['clip'] => ({
  shotPrompt: '',
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
    project.clips.clip_1!.selectedAssetId = 'asset_1';
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
    project.clips.clip_1!.jobIds.push('job_1');
    project.assets.cast_1 = {
      ...makeAsset('cast_1', 'clip_1'),
      clipId: null,
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
      batch([{ kind: 'edit_section', sectionId: 'section_1', changes: { title: 'Opening' } }])
    );

    expect({
      assets: result.project.assets,
      jobs: result.project.jobs,
      routing: result.project.routing,
      rules: result.project.rules,
      ruleListUndo: result.project.ruleListUndo,
    }).toEqual(preserved);
  });

  it('adds a section and its first clip at the requested active position', () => {
    const result = applyStudioMutationBatchV2(
      makeProject(),
      batch([
        {
          kind: 'add_section',
          sectionId: 'section_new',
          section: { title: 'New', storyLine: 'Story', visualPrompt: 'Look' },
          firstClipId: 'clip_new',
          firstClip: emptyShotInput(),
          beforeSectionId: 'section_2',
        },
      ])
    );

    expect(result).toMatchObject({
      project: { sectionOrder: ['section_1', 'section_new', 'section_2'] },
      createdSectionIds: ['section_new'],
      createdClipIds: ['clip_new'],
    });
    expect(result.project.sections.section_new!.clipOrder).toEqual(['clip_new']);
  });

  it('edits authored section fields without replacing its clip ownership', () => {
    const result = applyStudioMutationBatchV2(
      makeProject(),
      batch([{ kind: 'edit_section', sectionId: 'section_1', changes: { title: 'Opening' } }])
    );

    expect(result.project.sections.section_1).toMatchObject({ title: 'Opening', clipOrder: ['clip_1'] });
  });

  it('reorders the complete active section permutation', () => {
    const result = applyStudioMutationBatchV2(
      makeProject(),
      batch([{ kind: 'reorder_sections', sectionOrder: ['section_2', 'section_1'] }])
    );

    expect(result.project.sectionOrder).toEqual(['section_2', 'section_1']);
  });

  it('reorders sections without retargeting a deliberate cut take', () => {
    const project = makeProject();
    addCanonicalAsset(project, 'clip_1', 'asset_selected');
    addCanonicalAsset(project, 'clip_1', 'asset_cut');
    project.clips.clip_1!.selectedAssetId = 'asset_selected';
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
      batch([{ kind: 'reorder_sections', sectionOrder: ['section_2', 'section_1'] }])
    );

    expect(result.project.cuts.cut_1!.clips.cut_clip_1!.assetId).toBe('asset_cut');
  });

  it('parks an active section by appending its shelf identity', () => {
    const result = applyStudioMutationBatchV2(makeProject(), batch([{ kind: 'park_section', sectionId: 'section_1' }]));

    expect(result.project).toMatchObject({
      sectionOrder: ['section_2'],
      shelf: [{ kind: 'section', sectionId: 'section_1' }],
    });
    expect(result.project.sections.section_1!.clipOrder).toEqual(['clip_1']);
  });

  it('restores a parked section before the requested active section', () => {
    const project = makeProject();
    project.sectionOrder = ['section_2'];
    project.shelf = [{ kind: 'section', sectionId: 'section_1' }];

    const result = applyStudioMutationBatchV2(
      project,
      batch([{ kind: 'restore_section', sectionId: 'section_1', beforeSectionId: 'section_2' }])
    );

    expect(result.project).toMatchObject({ sectionOrder: ['section_1', 'section_2'], shelf: [] });
  });

  it('adds a clip before an existing clip in its owning section', () => {
    const result = applyStudioMutationBatchV2(
      makeProject(),
      batch([
        {
          kind: 'add_clip',
          sectionId: 'section_1',
          clipId: 'clip_new',
          clip: emptyShotInput(),
          beforeClipId: 'clip_1',
        },
      ])
    );

    expect(result.project.sections.section_1!.clipOrder).toEqual(['clip_new', 'clip_1']);
    expect(result.createdClipIds).toEqual(['clip_new']);
  });

  it('edits authored clip fields without replacing operational arrays', () => {
    const project = makeProject();
    addCanonicalAsset(project, 'clip_1', 'asset_1');

    const result = applyStudioMutationBatchV2(
      project,
      batch([{ kind: 'edit_clip', clipId: 'clip_1', changes: { shotPrompt: 'Wide shot' } }])
    );

    expect(result.project.clips.clip_1).toMatchObject({ shotPrompt: 'Wide shot', assetIds: ['asset_1'], jobIds: [] });
  });

  it('accepts an unchanged reference identity allowed by the schema validator', () => {
    const project = makeProject();
    project.assets.video_reference = {
      ...makeAsset('video_reference', 'clip_1'),
      mediaKind: 'video',
      mimeType: 'video/mp4',
      managedAsset: { collection: 'assets', fileName: 'video_reference.mp4' },
    };
    project.clips.clip_1!.assetIds.push('video_reference');
    project.clips.clip_1!.referenceAssetId = 'video_reference';

    const result = applyStudioMutationBatchV2(
      project,
      batch([{ kind: 'edit_clip', clipId: 'clip_1', changes: { narration: 'Narration' } }])
    );

    expect(result.project.clips.clip_1).toMatchObject({
      narration: 'Narration',
      referenceAssetId: 'video_reference',
    });
  });

  it('deletes a dependency-free clip and its ownership link', () => {
    const result = applyStudioMutationBatchV2(makeProject(), batch([{ kind: 'delete_clip', clipId: 'clip_1' }]));

    expect(Object.hasOwn(result.project.clips, 'clip_1')).toBe(false);
    expect(result.project.sections.section_1!.clipOrder).toEqual([]);
  });

  it('reorders the complete clip permutation for an active or parked section', () => {
    const project = makeProject();
    project.sections.section_1!.clipOrder.push('clip_3');
    project.clips.clip_3 = makeShot('clip_3');
    project.sectionOrder = ['section_2'];
    project.shelf = [{ kind: 'section', sectionId: 'section_1' }];

    const result = applyStudioMutationBatchV2(
      project,
      batch([{ kind: 'reorder_clips', sectionId: 'section_1', clipOrder: ['clip_3', 'clip_1'] }])
    );

    expect(result.project.sections.section_1!.clipOrder).toEqual(['clip_3', 'clip_1']);
  });

  it('parks an unselected canonical take as an appended asset alias', () => {
    const project = makeProject();
    addCanonicalAsset(project, 'clip_1', 'asset_1');

    const result = applyStudioMutationBatchV2(
      project,
      batch([{ kind: 'park_take', clipId: 'clip_1', assetId: 'asset_1' }])
    );

    expect(result.project.shelf).toEqual([{ kind: 'asset', assetId: 'asset_1' }]);
  });

  it('selects a shelved take and removes its alias atomically', () => {
    const project = makeProject();
    addCanonicalAsset(project, 'clip_1', 'asset_1');
    project.shelf = [{ kind: 'asset', assetId: 'asset_1' }];

    const result = applyStudioMutationBatchV2(
      project,
      batch([{ kind: 'select_shelved_take', clipId: 'clip_1', assetId: 'asset_1' }])
    );

    expect(result.project.clips.clip_1!.selectedAssetId).toBe('asset_1');
    expect(result.project.shelf).toEqual([]);
  });

  it('creates a dormant storyboard entry when selecting a take for a parked clip', () => {
    const project = makeProject();
    addCanonicalAsset(project, 'clip_2', 'asset_2');
    project.sectionOrder = ['section_1'];
    project.shelf = [
      { kind: 'section', sectionId: 'section_2' },
      { kind: 'asset', assetId: 'asset_2' },
    ];
    project.cuts.cut_1 = { id: 'cut_1', name: 'Cut', orderMode: 'storyboard', clipOrder: [], clips: {} };

    const result = applyStudioMutationBatchV2(
      project,
      batch([{ kind: 'select_shelved_take', clipId: 'clip_2', assetId: 'asset_2' }])
    );

    expect(result.project.cuts.cut_1!.clipOrder).toEqual(['clip_clip_2']);
    expect(result.project.cuts.cut_1!.clips.clip_clip_2).toMatchObject({ clipId: 'clip_2', assetId: 'asset_2' });
  });

  it('switches a cut to a shelved take without implicitly shelving the prior selection', () => {
    const project = makeProject();
    addCanonicalAsset(project, 'clip_1', 'asset_old');
    addCanonicalAsset(project, 'clip_1', 'asset_new');
    project.assets.asset_old!.durationSeconds = 10;
    project.assets.asset_new!.durationSeconds = 6;
    project.clips.clip_1!.selectedAssetId = 'asset_old';
    project.shelf = [{ kind: 'asset', assetId: 'asset_new' }];
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
      batch([{ kind: 'select_shelved_take', clipId: 'clip_1', assetId: 'asset_new' }])
    );

    expect(result.project).toMatchObject({
      shelf: [],
      clips: { clip_1: { selectedAssetId: 'asset_new' } },
      cuts: { cut_1: { clips: { cut_clip_1: { assetId: 'asset_new', sourceOutSeconds: 6 } } } },
    });
    expect(result.project.assets.asset_old).toEqual(project.assets.asset_old);
  });

  it('removes an asset alias without deleting the retained asset', () => {
    const project = makeProject();
    addCanonicalAsset(project, 'clip_1', 'asset_1');
    project.shelf = [{ kind: 'asset', assetId: 'asset_1' }];

    const result = applyStudioMutationBatchV2(project, batch([{ kind: 'remove_shelf_alias', assetId: 'asset_1' }]));

    expect(result.project.shelf).toEqual([]);
    expect(result.project.assets.asset_1).toEqual(project.assets.asset_1);
  });

  it('reorders the exact complete shelf identity permutation', () => {
    const project = makeProject();
    addCanonicalAsset(project, 'clip_1', 'asset_1');
    project.sectionOrder = ['section_1'];
    project.shelf = [
      { kind: 'section', sectionId: 'section_2' },
      { kind: 'asset', assetId: 'asset_1' },
    ];

    const result = applyStudioMutationBatchV2(
      project,
      batch([
        {
          kind: 'reorder_shelf',
          shelf: [
            { kind: 'asset', assetId: 'asset_1' },
            { kind: 'section', sectionId: 'section_2' },
          ],
        },
      ])
    );

    expect(result.project.shelf).toEqual([
      { kind: 'asset', assetId: 'asset_1' },
      { kind: 'section', sectionId: 'section_2' },
    ]);
  });

  it('selects a canonical take and reconciles a storyboard cut', () => {
    const project = makeProject();
    addCanonicalAsset(project, 'clip_1', 'asset_1');
    project.cuts.cut_1 = { id: 'cut_1', name: 'Cut', orderMode: 'storyboard', clipOrder: [], clips: {} };
    project.activeCutId = 'cut_1';

    const result = applyStudioMutationBatchV2(
      project,
      batch([{ kind: 'select_take', clipId: 'clip_1', assetId: 'asset_1' }])
    );

    expect(result.project.clips.clip_1!.selectedAssetId).toBe('asset_1');
    expect(Object.values(result.project.cuts.cut_1!.clips)[0]).toMatchObject({ clipId: 'clip_1', assetId: 'asset_1' });
  });
});

describe('applyStudioMutationBatchV2 ordering and atomicity', () => {
  it('makes a newly added identity visible to later operations in the same batch', () => {
    const result = applyStudioMutationBatchV2(
      makeProject(),
      batch([
        {
          kind: 'add_clip',
          sectionId: 'section_1',
          clipId: 'clip_new',
          clip: emptyShotInput(),
          beforeClipId: null,
        },
        { kind: 'edit_clip', clipId: 'clip_new', changes: { narration: 'Visible later' } },
        { kind: 'reorder_clips', sectionId: 'section_1', clipOrder: ['clip_new', 'clip_1'] },
      ])
    );

    expect(result.project.clips.clip_new!.narration).toBe('Visible later');
    expect(result.project.sections.section_1!.clipOrder).toEqual(['clip_new', 'clip_1']);
  });

  it('makes cut reconciliation visible before a later take park', () => {
    const project = makeProject();
    addCanonicalAsset(project, 'clip_1', 'asset_old');
    addCanonicalAsset(project, 'clip_1', 'asset_new');
    project.clips.clip_1!.selectedAssetId = 'asset_old';
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
        { kind: 'select_take', clipId: 'clip_1', assetId: 'asset_new' },
        { kind: 'park_take', clipId: 'clip_1', assetId: 'asset_old' },
      ])
    );

    expect(result.project.shelf).toEqual([{ kind: 'asset', assetId: 'asset_old' }]);
    expect(result.project.cuts.cut_1!.clips.cut_clip_1!.assetId).toBe('asset_new');
  });

  it('returns created identities in creation operation order', () => {
    const result = applyStudioMutationBatchV2(
      makeProject(),
      batch([
        {
          kind: 'add_clip',
          sectionId: 'section_1',
          clipId: 'clip_3',
          clip: emptyShotInput(),
          beforeClipId: null,
        },
        {
          kind: 'add_section',
          sectionId: 'section_3',
          section: { title: '', storyLine: '', visualPrompt: '' },
          firstClipId: 'clip_4',
          firstClip: emptyShotInput(),
          beforeSectionId: null,
        },
        {
          kind: 'add_clip',
          sectionId: 'section_3',
          clipId: 'clip_5',
          clip: emptyShotInput(),
          beforeClipId: null,
        },
      ])
    );

    expect(result.createdSectionIds).toEqual(['section_3']);
    expect(result.createdClipIds).toEqual(['clip_3', 'clip_4', 'clip_5']);
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
            { kind: 'delete_clip', clipId: 'missing_clip' },
          ])
        ),
      'invalid_operation'
    );
    expect(JSON.stringify(project)).toBe(before);
  });

  it('allows delete-before-add to free section capacity', () => {
    const project = makeProject();
    for (let index = 3; index <= 9; index += 1) {
      const shotId = `clip_${index}`;
      project.clips[shotId] = makeShot(shotId);
      project.sections.section_1!.clipOrder.push(shotId);
    }

    const result = applyStudioMutationBatchV2(
      project,
      batch([
        { kind: 'delete_clip', clipId: 'clip_1' },
        {
          kind: 'add_clip',
          sectionId: 'section_1',
          clipId: 'clip_10',
          clip: emptyShotInput(),
          beforeClipId: null,
        },
      ])
    );

    expect(result.project.sections.section_1!.clipOrder).toHaveLength(8);
  });

  it('rejects add-before-delete at section capacity', () => {
    const project = makeProject();
    for (let index = 3; index <= 9; index += 1) {
      const shotId = `clip_${index}`;
      project.clips[shotId] = makeShot(shotId);
      project.sections.section_1!.clipOrder.push(shotId);
    }

    expectReason(
      () =>
        applyStudioMutationBatchV2(
          project,
          batch([
            {
              kind: 'add_clip',
              sectionId: 'section_1',
              clipId: 'clip_10',
              clip: emptyShotInput(),
              beforeClipId: null,
            },
            { kind: 'delete_clip', clipId: 'clip_1' },
          ])
        ),
      'section_clip_capacity_reached'
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

  it('reports section capacity before identity collision', () => {
    const project = makeProject();
    for (let index = 3; index <= 24; index += 1) {
      const beatId = `section_${index}`;
      const shotId = `section_clip_${index}`;
      project.sections[beatId] = makeBeat(beatId, [shotId]);
      project.clips[shotId] = makeShot(shotId);
      project.sectionOrder.push(beatId);
    }

    expectReason(
      () =>
        applyStudioMutationBatchV2(
          project,
          batch([
            {
              kind: 'add_section',
              sectionId: 'section_1',
              section: { title: '', storyLine: '', visualPrompt: '' },
              firstClipId: 'new_clip',
              firstClip: emptyShotInput(),
              beforeSectionId: null,
            },
          ])
        ),
      'section_capacity_reached'
    );
  });

  it('reports invalid duration after available capacity and collision checks', () => {
    expectReason(
      () =>
        applyStudioMutationBatchV2(
          makeProject(),
          batch([
            {
              kind: 'add_clip',
              sectionId: 'section_1',
              clipId: 'clip_new',
              clip: { ...emptyShotInput(), mediaKind: 'video', durationSeconds: 3 },
              beforeClipId: null,
            },
          ])
        ),
      'invalid_clip_duration'
    );
  });

  it('reports invalid duration for a clip edit', () => {
    expectReason(
      () =>
        applyStudioMutationBatchV2(
          makeProject(),
          batch([{ kind: 'edit_clip', clipId: 'clip_1', changes: { mediaKind: 'video', durationSeconds: 3 } }])
        ),
      'invalid_clip_duration'
    );
  });

  it('reports project clip capacity when the target section still has room', () => {
    const project = makeProject();
    project.sectionOrder = [];
    project.sections = {};
    project.clips = {};
    for (let beatIndex = 1; beatIndex <= 13; beatIndex += 1) {
      const beatId = `section_${beatIndex}`;
      const count = beatIndex === 1 ? 1 : beatIndex === 13 ? 7 : 8;
      const shotOrder = Array.from({ length: count }, (_, shotIndex) => `clip_${beatIndex}_${shotIndex}`);
      project.sectionOrder.push(beatId);
      project.sections[beatId] = makeBeat(beatId, shotOrder);
      for (const shotId of shotOrder) project.clips[shotId] = makeShot(shotId);
    }

    expect(validateStudioProjectV2(project)).toBe(true);
    expectReason(
      () =>
        applyStudioMutationBatchV2(
          project,
          batch([
            {
              kind: 'add_clip',
              sectionId: 'section_1',
              clipId: 'clip_new',
              clip: emptyShotInput(),
              beforeClipId: null,
            },
          ])
        ),
      'project_clip_capacity_reached'
    );
  });

  it('reports section capacity before simultaneous project, collision, and duration failures', () => {
    const project = makeProject();
    project.sectionOrder = [];
    project.sections = {};
    project.clips = {};
    for (let beatIndex = 1; beatIndex <= 12; beatIndex += 1) {
      const beatId = `section_${beatIndex}`;
      const shotOrder = Array.from({ length: 8 }, (_, shotIndex) => `clip_${beatIndex}_${shotIndex}`);
      project.sectionOrder.push(beatId);
      project.sections[beatId] = makeBeat(beatId, shotOrder);
      for (const shotId of shotOrder) project.clips[shotId] = makeShot(shotId);
    }

    expectReason(
      () =>
        applyStudioMutationBatchV2(
          project,
          batch([
            {
              kind: 'add_clip',
              sectionId: 'section_1',
              clipId: 'clip_1_0',
              clip: { ...emptyShotInput(), mediaKind: 'video', durationSeconds: 3 },
              beforeClipId: null,
            },
          ])
        ),
      'section_clip_capacity_reached'
    );
  });

  it('reports identity collision before an invalid duration when capacity remains', () => {
    expectReason(
      () =>
        applyStudioMutationBatchV2(
          makeProject(),
          batch([
            {
              kind: 'add_clip',
              sectionId: 'section_1',
              clipId: 'clip_1',
              clip: { ...emptyShotInput(), mediaKind: 'video', durationSeconds: 3 },
              beforeClipId: null,
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
            { kind: 'delete_clip', clipId: 'clip_1' },
            {
              kind: 'add_clip',
              sectionId: 'section_1',
              clipId: 'clip_1',
              clip: emptyShotInput(),
              beforeClipId: null,
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
      kind: 'add_clip',
      sectionId: 'section_1',
      clipId: 'clip_new',
      clip: { ...emptyShotInput(), extra: true },
      beforeClipId: null,
    } as unknown as StudioMutationOperationV2;

    expectReason(() => applyStudioMutationBatchV2(makeProject(), batch([operation])), 'invalid_operation');
  });

  it('rejects an unknown edit changes key', () => {
    const operation = {
      kind: 'edit_section',
      sectionId: 'section_1',
      changes: { title: 'Opening', extra: true },
    } as unknown as StudioMutationOperationV2;

    expectReason(() => applyStudioMutationBatchV2(makeProject(), batch([operation])), 'invalid_operation');
  });

  it('rejects a sparse shelf reorder with a bounded error', () => {
    const project = makeProject();
    addCanonicalAsset(project, 'clip_1', 'asset_1');
    project.shelf = [{ kind: 'asset', assetId: 'asset_1' }];
    const sparseBin = sparseArray<StudioProjectV2['shelf'][number]>(1);

    expectReason(
      () => applyStudioMutationBatchV2(project, batch([{ kind: 'reorder_shelf', shelf: sparseBin }])),
      'invalid_operation'
    );
  });

  it('does not invoke an own array-method shadow', () => {
    const beatOrder = ['section_2', 'section_1'];
    Object.defineProperty(beatOrder, 'every', { value: null });

    const result = applyStudioMutationBatchV2(
      makeProject(),
      batch([{ kind: 'reorder_sections', sectionOrder: beatOrder }])
    );

    expect(result.project.sectionOrder).toEqual(['section_2', 'section_1']);
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
    project.clips.clip_1!.jobIds = sparseArray<string>(1);

    expectReason(
      () => applyStudioMutationBatchV2(project, batch([{ kind: 'set_brief', brief: 'x' }])),
      'validation_failed'
    );
  });

  it('rejects an empty edit changes object', () => {
    const operation = { kind: 'edit_clip', clipId: 'clip_1', changes: {} } as StudioMutationOperationV2;

    expectReason(() => applyStudioMutationBatchV2(makeProject(), batch([operation])), 'invalid_operation');
  });

  it('rejects reorder inputs that are not exact permutations', () => {
    expectReason(
      () =>
        applyStudioMutationBatchV2(
          makeProject(),
          batch([{ kind: 'reorder_sections', sectionOrder: ['section_1', 'section_1'] }])
        ),
      'invalid_operation'
    );
  });

  it('rejects a clip reorder that omits an owned clip', () => {
    const project = makeProject();
    project.sections.section_1!.clipOrder.push('clip_3');
    project.clips.clip_3 = makeShot('clip_3');

    expectReason(
      () =>
        applyStudioMutationBatchV2(
          project,
          batch([{ kind: 'reorder_clips', sectionId: 'section_1', clipOrder: ['clip_1'] }])
        ),
      'invalid_operation'
    );
  });

  it('rejects a shelf reorder that duplicates an identity', () => {
    const project = makeProject();
    addCanonicalAsset(project, 'clip_1', 'asset_1');
    project.sectionOrder = ['section_1'];
    project.shelf = [
      { kind: 'section', sectionId: 'section_2' },
      { kind: 'asset', assetId: 'asset_1' },
    ];

    expectReason(
      () =>
        applyStudioMutationBatchV2(
          project,
          batch([
            {
              kind: 'reorder_shelf',
              shelf: [
                { kind: 'asset', assetId: 'asset_1' },
                { kind: 'asset', assetId: 'asset_1' },
              ],
            },
          ])
        ),
      'invalid_operation'
    );
  });

  it('rejects a non-null reference identity on a newly created clip', () => {
    expectReason(
      () =>
        applyStudioMutationBatchV2(
          makeProject(),
          batch([
            {
              kind: 'add_clip',
              sectionId: 'section_1',
              clipId: 'clip_new',
              clip: { ...emptyShotInput(), referenceAssetId: 'asset_1' },
              beforeClipId: null,
            },
          ])
        ),
      'invalid_operation'
    );
  });

  it('blocks deletion of a clip with an asset dependency', () => {
    const project = makeProject();
    addCanonicalAsset(project, 'clip_1', 'asset_1');

    expectReason(
      () => applyStudioMutationBatchV2(project, batch([{ kind: 'delete_clip', clipId: 'clip_1' }])),
      'dependency_blocked'
    );
  });

  it('blocks deletion of a clip with a job dependency', () => {
    const project = makeProject();
    project.jobs.job_1 = makeJob('job_1', 'clip_1');
    project.clips.clip_1!.jobIds.push('job_1');

    expectReason(
      () => applyStudioMutationBatchV2(project, batch([{ kind: 'delete_clip', clipId: 'clip_1' }])),
      'dependency_blocked'
    );
  });

  it('blocks deletion of a clip referenced by a dormant cut entry', () => {
    const project = makeProject();
    addCanonicalAsset(project, 'clip_1', 'asset_1');
    project.clips.clip_1!.selectedAssetId = 'asset_1';
    project.sectionOrder = ['section_2'];
    project.shelf = [{ kind: 'section', sectionId: 'section_1' }];
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
      () => applyStudioMutationBatchV2(project, batch([{ kind: 'delete_clip', clipId: 'clip_1' }])),
      'dependency_blocked'
    );
  });

  it('refuses to park a selected take', () => {
    const project = makeProject();
    addCanonicalAsset(project, 'clip_1', 'asset_1');
    project.clips.clip_1!.selectedAssetId = 'asset_1';

    expectReason(
      () => applyStudioMutationBatchV2(project, batch([{ kind: 'park_take', clipId: 'clip_1', assetId: 'asset_1' }])),
      'dependency_blocked'
    );
  });

  it('refuses to park a take referenced by a cut even when another take is selected', () => {
    const project = makeProject();
    addCanonicalAsset(project, 'clip_1', 'asset_1');
    addCanonicalAsset(project, 'clip_1', 'asset_2');
    project.clips.clip_1!.selectedAssetId = 'asset_2';
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
      () => applyStudioMutationBatchV2(project, batch([{ kind: 'park_take', clipId: 'clip_1', assetId: 'asset_1' }])),
      'dependency_blocked'
    );
  });

  it('rejects a noncanonical asset alias', () => {
    const project = makeProject();
    project.assets.import_1 = {
      ...makeAsset('import_1', 'clip_1'),
      managedAsset: { collection: 'imports', fileName: 'import_1.png' },
    };
    project.clips.clip_1!.assetIds.push('import_1');

    expectReason(
      () => applyStudioMutationBatchV2(project, batch([{ kind: 'park_take', clipId: 'clip_1', assetId: 'import_1' }])),
      'invalid_operation'
    );
  });

  it('rejects a duplicate asset alias identity', () => {
    const project = makeProject();
    addCanonicalAsset(project, 'clip_1', 'asset_1');
    project.shelf = [{ kind: 'asset', assetId: 'asset_1' }];

    expectReason(
      () => applyStudioMutationBatchV2(project, batch([{ kind: 'park_take', clipId: 'clip_1', assetId: 'asset_1' }])),
      'invalid_operation'
    );
  });

  it('blocks a media-kind edit while the clip has a shelved take', () => {
    const project = makeProject();
    addCanonicalAsset(project, 'clip_1', 'asset_1');
    project.shelf = [{ kind: 'asset', assetId: 'asset_1' }];

    expectReason(
      () =>
        applyStudioMutationBatchV2(
          project,
          batch([{ kind: 'edit_clip', clipId: 'clip_1', changes: { mediaKind: 'video', durationSeconds: 5 } }])
        ),
      'dependency_blocked'
    );
  });

  it('blocks a media-kind edit while the clip has a selected take', () => {
    const project = makeProject();
    addCanonicalAsset(project, 'clip_1', 'asset_1');
    project.clips.clip_1!.selectedAssetId = 'asset_1';

    expectReason(
      () =>
        applyStudioMutationBatchV2(
          project,
          batch([{ kind: 'edit_clip', clipId: 'clip_1', changes: { mediaKind: 'video', durationSeconds: 5 } }])
        ),
      'dependency_blocked'
    );
  });

  it('blocks a media-kind edit while a cut depends on the clip', () => {
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
          batch([{ kind: 'edit_clip', clipId: 'clip_1', changes: { mediaKind: 'video', durationSeconds: 5 } }])
        ),
      'dependency_blocked'
    );
  });

  it('blocks a media-kind edit while the clip has a nonterminal job', () => {
    const project = makeProject();
    project.jobs.job_1 = makeJob('job_1', 'clip_1');
    project.clips.clip_1!.jobIds.push('job_1');

    expectReason(
      () =>
        applyStudioMutationBatchV2(
          project,
          batch([{ kind: 'edit_clip', clipId: 'clip_1', changes: { mediaKind: 'video', durationSeconds: 5 } }])
        ),
      'dependency_blocked'
    );
  });

  it('allows removing a shelf alias before changing media kind in one batch', () => {
    const project = makeProject();
    addCanonicalAsset(project, 'clip_1', 'asset_1');
    project.shelf = [{ kind: 'asset', assetId: 'asset_1' }];

    const result = applyStudioMutationBatchV2(
      project,
      batch([
        { kind: 'remove_shelf_alias', assetId: 'asset_1' },
        { kind: 'edit_clip', clipId: 'clip_1', changes: { mediaKind: 'video', durationSeconds: 5 } },
      ])
    );

    expect(result.project.clips.clip_1).toMatchObject({ mediaKind: 'video', durationSeconds: 5 });
    expect(result.project.shelf).toEqual([]);
  });

  it('treats equal raw section and asset IDs as distinct shelf identities', () => {
    const project = makeProject();
    project.sections.same = makeBeat('same', ['clip_same']);
    project.clips.clip_same = makeShot('clip_same');
    addCanonicalAsset(project, 'clip_1', 'same');
    project.shelf = [
      { kind: 'section', sectionId: 'same' },
      { kind: 'asset', assetId: 'same' },
    ];

    const result = applyStudioMutationBatchV2(
      project,
      batch([
        {
          kind: 'reorder_shelf',
          shelf: [
            { kind: 'asset', assetId: 'same' },
            { kind: 'section', sectionId: 'same' },
          ],
        },
      ])
    );

    expect(result.project.shelf).toEqual([
      { kind: 'asset', assetId: 'same' },
      { kind: 'section', sectionId: 'same' },
    ]);
  });

  it('requires the dedicated atomic operation to select a shelved take', () => {
    const project = makeProject();
    addCanonicalAsset(project, 'clip_1', 'asset_1');
    project.shelf = [{ kind: 'asset', assetId: 'asset_1' }];

    expectReason(
      () => applyStudioMutationBatchV2(project, batch([{ kind: 'select_take', clipId: 'clip_1', assetId: 'asset_1' }])),
      'invalid_operation'
    );
  });

  it('rejects parking a take when the take-alias shelf capacity is full', () => {
    const project = makeProject();
    for (let index = 1; index <= 96; index += 1) {
      const assetId = `asset_${index}`;
      addCanonicalAsset(project, 'clip_1', assetId);
      project.shelf.push({ kind: 'asset', assetId });
    }
    addCanonicalAsset(project, 'clip_1', 'asset_97');

    expect(validateStudioProjectV2(project)).toBe(true);
    expectReason(
      () => applyStudioMutationBatchV2(project, batch([{ kind: 'park_take', clipId: 'clip_1', assetId: 'asset_97' }])),
      'validation_failed'
    );
  });

  it.each(['constructor', 'toString', '__proto__'])('round-trips and later mutates own magic identity %s', (id) => {
    const first = applyStudioMutationBatchV2(
      makeProject(),
      batch([
        {
          kind: 'add_section',
          sectionId: id,
          section: { title: '', storyLine: '', visualPrompt: '' },
          firstClipId: `${id}_clip`,
          firstClip: emptyShotInput(),
          beforeSectionId: null,
        },
      ])
    );
    const restarted = JSON.parse(JSON.stringify(first.project)) as StudioProjectV2;

    const second = applyStudioMutationBatchV2(
      restarted,
      batch([{ kind: 'edit_section', sectionId: id, changes: { title: 'After restart' } }])
    );

    expect(Object.hasOwn(second.project.sections, id)).toBe(true);
    expect(second.project.sections[id]!.title).toBe('After restart');
    expect(validateStudioProjectV2(second.project)).toBe(true);
  });

  it.each(['constructor', 'toString', '__proto__'])(
    'round-trips and later mutates own magic clip identity %s',
    (id) => {
      const first = applyStudioMutationBatchV2(
        makeProject(),
        batch([
          {
            kind: 'add_clip',
            sectionId: 'section_1',
            clipId: id,
            clip: emptyShotInput(),
            beforeClipId: null,
          },
        ])
      );
      const restarted = JSON.parse(JSON.stringify(first.project)) as StudioProjectV2;

      const second = applyStudioMutationBatchV2(
        restarted,
        batch([
          { kind: 'edit_clip', clipId: id, changes: { shotPrompt: 'After restart' } },
          { kind: 'reorder_clips', sectionId: 'section_1', clipOrder: [id, 'clip_1'] },
        ])
      );

      expect(Object.hasOwn(second.project.clips, id)).toBe(true);
      expect(second.project.clips[id]!.shotPrompt).toBe('After restart');
      expect(validateStudioProjectV2(second.project)).toBe(true);
    }
  );

  it('rolls back the shelf and selection when a later operation fails', () => {
    const project = makeProject();
    addCanonicalAsset(project, 'clip_1', 'asset_1');
    project.shelf = [{ kind: 'asset', assetId: 'asset_1' }];

    expectReason(
      () =>
        applyStudioMutationBatchV2(
          project,
          batch([
            { kind: 'select_shelved_take', clipId: 'clip_1', assetId: 'asset_1' },
            { kind: 'delete_clip', clipId: 'missing_clip' },
          ])
        ),
      'invalid_operation'
    );
    expect(project.clips.clip_1!.selectedAssetId).toBeNull();
    expect(project.shelf).toEqual([{ kind: 'asset', assetId: 'asset_1' }]);
  });
});
