/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest';
import {
  STUDIO_MAX_BEATS,
  STUDIO_MAX_BIN_TAKE_ITEMS,
  STUDIO_MAX_LINE_HISTORY_PER_BEAT,
  STUDIO_MAX_MUTATION_OPERATIONS,
  STUDIO_MAX_SHOTS_PER_BEAT,
  STUDIO_MAX_SHOTS_PER_PROJECT,
  type StudioAssetV2,
  type StudioBeat,
  type StudioConditioningInputSnapshot,
  type StudioGenerationRequestPlan,
  type StudioJobV2,
  type StudioMutationBatchV2,
  type StudioMutationOperationV2,
  type StudioProjectV2,
  type StudioQuotedGeneration,
  type StudioShot,
  type StudioSpendAuthorization,
} from '@/common/types/project/creativeStudioTypes';
import {
  calculateStudioQuoteTotals,
  createStudioFrameExtractionId,
  createStudioQuotedGenerationId,
} from '@/process/services/creative-studio/service/schema2/generation';
import {
  deriveStudioDirtyShotsV2,
  deriveStudioInboundShotReferencesV2,
} from '@/process/services/creative-studio/service/schema2/chain';
import { createStudioLineHistoryId } from '@/process/services/creative-studio/service/schema2/mutations/identity';
import {
  applyStudioMutationBatchV2,
  StudioMutationErrorV2,
  type StudioMutationReasonV2,
  validateStudioMutationOperationV2,
} from '@/process/services/creative-studio/service/schema2/mutations';
import { validateStudioProjectV2 } from '@/process/services/creative-studio/service/schema2/validation';

const timestamp = '2026-08-17T00:00:00.000Z';
const laterTimestamp = '2026-08-17T00:00:01.000Z';
const digest = 'a'.repeat(64);
const provider = { providerId: 'provider_1', adapterId: 'weprompt-image-v1', model: 'model_1' } as const;

const makeShot = (id: string, overrides: Partial<StudioShot> = {}): StudioShot => ({
  id,
  line: '',
  derivation: 'derived',
  derivedFromActionRevision: 1,
  narration: '',
  onScreenText: '',
  durationSeconds: 5,
  trimInSeconds: null,
  trimOutSeconds: null,
  chainBreak: 'none',
  seedStillId: null,
  selectedTakeId: null,
  assetIds: [],
  jobIds: [],
  ...overrides,
});

const makeBeat = (id: string, shotOrder: string[] = [], overrides: Partial<StudioBeat> = {}): StudioBeat => ({
  id,
  title: '',
  action: '',
  look: '',
  actionRevision: 1,
  targetSeconds: null,
  shotOrder,
  lineHistory: [],
  ...overrides,
});

const makeProject = (): StudioProjectV2 => ({
  schemaVersion: 2,
  revision: 7,
  id: 'project_1',
  name: 'Project One',
  brief: '',
  rules: [],
  briefConversationId: null,
  aspectRatio: '16:9',
  targetDurationSeconds: 30,
  resolution: '1080p',
  beatOrder: ['beat_1', 'beat_2'],
  beats: {
    beat_1: makeBeat('beat_1', ['shot_1', 'shot_2']),
    beat_2: makeBeat('beat_2'),
  },
  shots: {
    shot_1: makeShot('shot_1'),
    shot_2: makeShot('shot_2'),
  },
  bin: [],
  bedAssetId: null,
  matchToShotId: null,
  spendPolicy: null,
  spendAuthorizations: [],
  frameExtractions: {},
  undoHistory: [],
  imageRouteId: null,
  videoRouteId: null,
  assets: {},
  jobs: {},
  createdAt: timestamp,
  updatedAt: timestamp,
});

const editableBeat = (title = ''): Extract<StudioMutationOperationV2, { kind: 'add_beat' }>['beat'] => ({
  title,
  action: '',
  look: '',
  targetSeconds: null,
});

const editableShot = (
  overrides: Partial<Extract<StudioMutationOperationV2, { kind: 'add_shot' }>['shot']> = {}
): Extract<StudioMutationOperationV2, { kind: 'add_shot' }>['shot'] => ({
  line: '',
  narration: '',
  onScreenText: '',
  durationSeconds: 5,
  ...overrides,
});

const makeImageAsset = (
  id: string,
  shotId: string | null,
  collection: StudioAssetV2['managedAsset']['collection'] = 'imports',
  overrides: Partial<StudioAssetV2> = {}
): StudioAssetV2 => ({
  id,
  projectId: 'project_1',
  shotId,
  mediaKind: 'image',
  mimeType: 'image/png',
  managedAsset: { collection, fileName: `${id}.png` },
  byteSize: 1,
  sha256: digest,
  createdAt: timestamp,
  ...overrides,
});

const makeVideoAsset = (id: string, shotId: string, durationSeconds = 10): StudioAssetV2 => ({
  id,
  projectId: 'project_1',
  shotId,
  mediaKind: 'video',
  mimeType: 'video/mp4',
  managedAsset: { collection: 'assets', fileName: `${id}.mp4` },
  byteSize: 1,
  sha256: digest,
  durationSeconds,
  createdAt: timestamp,
});

const makeAudioAsset = (id: string): StudioAssetV2 => ({
  id,
  projectId: 'project_1',
  shotId: null,
  mediaKind: 'audio',
  mimeType: 'audio/wav',
  managedAsset: { collection: 'imports', fileName: `${id}.wav` },
  byteSize: 1,
  sha256: digest,
  durationSeconds: 30,
  createdAt: timestamp,
});

const addImageAsset = (
  project: StudioProjectV2,
  shotId: string,
  assetId: string,
  collection: StudioAssetV2['managedAsset']['collection'] = 'imports'
): StudioAssetV2 => {
  const asset = makeImageAsset(assetId, shotId, collection);
  project.assets[assetId] = asset;
  project.shots[shotId]!.assetIds.push(assetId);
  return asset;
};

const resolvedPlan = (conditioningInput: StudioConditioningInputSnapshot | null): StudioGenerationRequestPlan => ({
  kind: 'resolved',
  snapshot: {
    prompt: 'video prompt',
    aspectRatio: '16:9',
    resolution: '1080p',
    durationSeconds: 5,
    referenceInput: null,
    conditioningInput,
  },
});

const deferredPlan = (upstreamItemId: string, predecessorShotId: string): StudioGenerationRequestPlan => ({
  kind: 'after_take_selection',
  template: {
    prompt: 'dependent prompt',
    aspectRatio: '16:9',
    resolution: '1080p',
    durationSeconds: 5,
    referenceInput: null,
  },
  dependency: {
    kind: 'authorized_predecessor',
    upstreamItemId,
    predecessorShotId,
  },
});

const makeItem = (
  projectRevision: number,
  shotId: string,
  requestPlan: StudioGenerationRequestPlan,
  generationCount = 1
): StudioQuotedGeneration => ({
  id: createStudioQuotedGenerationId({
    projectId: 'project_1',
    projectRevision,
    shotId,
    purpose: 'video_take',
  }),
  shotId,
  purpose: 'video_take',
  routeId: 'video_route',
  generationCount,
  requestPlan,
  rateUnit: 'second',
  rateMinorUnits: 2,
});

const makeAuthorization = (
  id: string,
  projectRevision: number,
  baseItems: StudioQuotedGeneration[],
  cascadeItems: StudioQuotedGeneration[] = []
): StudioSpendAuthorization => {
  const items = [...baseItems, ...cascadeItems];
  const totals = calculateStudioQuoteTotals(items)!;
  return {
    id,
    projectId: 'project_1',
    projectRevision,
    originReferenceHandoffId: null,
    rateCardDigest: 'b'.repeat(64),
    currency: 'USD',
    baseItems,
    cascadeItems,
    lowerMinorUnits: totals.lowerMinorUnits,
    upperMinorUnits: totals.upperMinorUnits,
    expiresAt: '2026-08-17T00:05:00.000Z',
    confirmedAt: laterTimestamp,
    providerBindings: items.map((item) => ({ itemId: item.id, provider })),
    idempotencyKeys: items.flatMap((item) =>
      Array.from({ length: item.generationCount }, (_, generationIndex) => ({
        itemId: item.id,
        generationIndex,
        key: `idem_${id}_${item.id}_${generationIndex}`,
      }))
    ),
  };
};

const makeJob = (
  id: string,
  authorization: StudioSpendAuthorization,
  item: StudioQuotedGeneration,
  overrides: Partial<StudioJobV2> = {}
): StudioJobV2 => ({
  id,
  projectId: 'project_1',
  shotId: item.shotId,
  status: item.requestPlan.kind === 'resolved' ? 'queued_local' : 'waiting_for_conditioning',
  provider,
  idempotencyKey: authorization.idempotencyKeys.find(
    (entry) => entry.itemId === item.id && entry.generationIndex === 0
  )!.key,
  providerJobId: null,
  cancellationPolicy: 'queued_and_running',
  outputAssetIds: [],
  error: null,
  retryOfJobId: null,
  retryReason: null,
  duplicateChargeAcknowledged: false,
  duplicateChargeAcknowledgedAt: null,
  createdAt: timestamp,
  updatedAt: timestamp,
  purpose: 'video_take',
  authorizationId: authorization.id,
  authorizationItemId: item.id,
  generationIndex: 0,
  requestPlan: item.requestPlan,
  requestSnapshot: item.requestPlan.kind === 'resolved' ? item.requestPlan.snapshot : null,
  spendReceipt: null,
  outputAssetIdsByRole: { primary: null, poster: null },
  ...overrides,
});

const addSucceededVideoTake = (
  project: StudioProjectV2,
  shotId: string,
  assetId: string,
  selected: boolean
): StudioAssetV2 => {
  const shot = project.shots[shotId]!;
  const seed = addImageAsset(project, shotId, `seed_${assetId}`);
  shot.seedStillId = seed.id;
  const projectRevision = project.revision - 1;
  const item = makeItem(projectRevision, shotId, resolvedPlan({ kind: 'seed_still', assetId: seed.id }));
  const authorization = makeAuthorization(`auth_${assetId}`, projectRevision, [item]);
  const asset = makeVideoAsset(assetId, shotId);
  project.assets[asset.id] = asset;
  shot.assetIds.push(asset.id);
  const jobId = `job_${assetId}`;
  const job = makeJob(jobId, authorization, item, {
    status: 'succeeded',
    providerJobId: `remote_${assetId}`,
    remoteStartedAt: timestamp,
    outputAssetIds: [asset.id],
    outputAssetIdsByRole: { primary: asset.id, poster: null },
    spendReceipt: {
      authorizationId: authorization.id,
      itemId: item.id,
      jobId,
      purpose: 'video_take',
      routeId: item.routeId,
      currency: authorization.currency,
      rateUnit: item.rateUnit,
      rateMinorUnits: item.rateMinorUnits,
      durationSeconds: 5,
      generationIndex: 0,
      generationCount: 1,
      totalMinorUnits: 10,
    },
  });
  project.spendAuthorizations.push(authorization);
  project.jobs[job.id] = job;
  shot.jobIds.push(job.id);
  if (selected) shot.selectedTakeId = asset.id;
  return asset;
};

const addWaitingDependentOnOnlyTake = (project: StudioProjectV2): StudioAssetV2 => {
  const upstreamShot = project.shots.shot_1!;
  const seed = addImageAsset(project, upstreamShot.id, 'waiting_seed');
  upstreamShot.seedStillId = seed.id;
  const projectRevision = project.revision - 1;
  const upstream = makeItem(projectRevision, upstreamShot.id, resolvedPlan({ kind: 'seed_still', assetId: seed.id }));
  const dependent = makeItem(projectRevision, 'shot_2', deferredPlan(upstream.id, upstreamShot.id));
  const authorization = makeAuthorization('auth_waiting', projectRevision, [upstream], [dependent]);
  const take = makeVideoAsset('only_take', upstreamShot.id);
  project.assets[take.id] = take;
  upstreamShot.assetIds.push(take.id);
  const upstreamJob = makeJob('job_upstream', authorization, upstream, {
    status: 'succeeded',
    providerJobId: 'remote_upstream',
    remoteStartedAt: timestamp,
    outputAssetIds: [take.id],
    outputAssetIdsByRole: { primary: take.id, poster: null },
    spendReceipt: {
      authorizationId: authorization.id,
      itemId: upstream.id,
      jobId: 'job_upstream',
      purpose: 'video_take',
      routeId: upstream.routeId,
      currency: authorization.currency,
      rateUnit: upstream.rateUnit,
      rateMinorUnits: upstream.rateMinorUnits,
      durationSeconds: 5,
      generationIndex: 0,
      generationCount: 1,
      totalMinorUnits: 10,
    },
  });
  const dependentJob = makeJob('job_dependent', authorization, dependent);
  project.spendAuthorizations.push(authorization);
  project.jobs[upstreamJob.id] = upstreamJob;
  project.jobs[dependentJob.id] = dependentJob;
  upstreamShot.jobIds.push(upstreamJob.id);
  project.shots.shot_2!.jobIds.push(dependentJob.id);
  return take;
};

const addFrameExtraction = (
  project: StudioProjectV2,
  shotId: string,
  status: 'pending' | 'ready'
): { extractionId: string; frameAssetId: string | null } => {
  const shot = project.shots[shotId]!;
  const takeId = shot.selectedTakeId!;
  const take = project.assets[takeId]!;
  const endpointSeconds = take.durationSeconds!;
  const extractionId = createStudioFrameExtractionId({ shotId, takeAssetId: takeId, endpointSeconds });
  const frameAssetId = status === 'ready' ? `frame_${shotId}` : null;
  if (frameAssetId !== null) {
    project.assets[frameAssetId] = makeImageAsset(frameAssetId, shotId, 'conditioningFrames');
    shot.assetIds.push(frameAssetId);
  }
  project.frameExtractions[extractionId] = {
    id: extractionId,
    shotId,
    takeAssetId: takeId,
    endpointSeconds,
    frameAssetId,
    status,
    errorCode: null,
  };
  return { extractionId, frameAssetId };
};

const bindWaitingDependent = (project: StudioProjectV2): StudioJobV2 => {
  const take = addWaitingDependentOnOnlyTake(project);
  project.shots.shot_1!.selectedTakeId = take.id;
  const { frameAssetId } = addFrameExtraction(project, 'shot_1', 'ready');
  const dependent = project.jobs.job_dependent!;
  if (dependent.requestPlan.kind !== 'after_take_selection' || frameAssetId === null) {
    throw new Error('Expected one symbolic predecessor dependency');
  }
  dependent.status = 'queued_local';
  dependent.requestSnapshot = {
    ...dependent.requestPlan.template,
    conditioningInput: {
      kind: 'predecessor_frame',
      predecessorShotId: 'shot_1',
      takeAssetId: take.id,
      frameAssetId,
      endpointSeconds: 10,
    },
  };
  return dependent;
};

const completeBoundDependent = (project: StudioProjectV2): StudioJobV2 => {
  const dependent = bindWaitingDependent(project);
  const take = makeVideoAsset('dependent_take', dependent.shotId);
  project.assets[take.id] = take;
  project.shots[dependent.shotId]!.assetIds.push(take.id);
  project.shots[dependent.shotId]!.selectedTakeId = take.id;
  dependent.status = 'succeeded';
  dependent.providerJobId = 'remote_dependent';
  dependent.remoteStartedAt = timestamp;
  dependent.outputAssetIds = [take.id];
  dependent.outputAssetIdsByRole = { primary: take.id, poster: null };
  dependent.spendReceipt = {
    authorizationId: dependent.authorizationId,
    itemId: dependent.authorizationItemId,
    jobId: dependent.id,
    purpose: dependent.purpose,
    routeId: 'video_route',
    currency: 'USD',
    rateUnit: 'second',
    rateMinorUnits: 2,
    durationSeconds: 5,
    generationIndex: 0,
    generationCount: 1,
    totalMinorUnits: 10,
  };
  return dependent;
};

const mutationBatch = (project: StudioProjectV2, operations: StudioMutationOperationV2[]): StudioMutationBatchV2 => ({
  schemaVersion: 2,
  projectId: project.id,
  expectedRevision: project.revision,
  operations,
});

const apply = (
  project: StudioProjectV2,
  operations: StudioMutationOperationV2[],
  mutationId = 'mutation_1',
  capturedAt = laterTimestamp
) => applyStudioMutationBatchV2(project, mutationBatch(project, operations), { mutationId, capturedAt });

const persist = (project: StudioProjectV2): StudioProjectV2 => {
  const persisted = structuredClone(project);
  persisted.revision += 1;
  expect(validateStudioProjectV2(persisted)).toBe(true);
  return persisted;
};

const expectReason = (
  project: StudioProjectV2,
  operations: StudioMutationOperationV2[],
  reasonCode: StudioMutationReasonV2,
  mutationId = 'mutation_rejected'
): void => {
  const before = structuredClone(project);
  try {
    apply(project, operations, mutationId);
    throw new Error('Expected mutation to fail');
  } catch (error) {
    expect(error).toBeInstanceOf(StudioMutationErrorV2);
    expect((error as StudioMutationErrorV2).reasonCode).toBe(reasonCode);
  }
  expect(project).toEqual(before);
};

const FINAL_OPERATION_KINDS = [
  'edit_project',
  'set_brief',
  'set_rules',
  'add_beat',
  'edit_beat',
  'reorder_beats',
  'park_beat',
  'restore_beat',
  'add_binned_beat',
  'add_shot',
  'edit_shot',
  'delete_shot',
  'park_shot',
  'restore_shot',
  'reorder_shots',
  'apply_coverage',
  'set_hard_cut',
  'set_seed_still',
  'trim_shot',
  'redetach_line',
  'rederive_line',
  'restore_line',
  'park_take',
  'add_alternate_take',
  'restore_take',
  'reorder_bin',
  'select_take',
  'set_routes',
  'set_spend_policy',
  'set_match_to',
  'set_bed',
  'undo_last',
] as const satisfies readonly StudioMutationOperationV2['kind'][];

describe('applyStudioMutationBatchV2 final operation contract', () => {
  it('keeps the exact exhaustive 32-operation catalog', () => {
    expect(FINAL_OPERATION_KINDS).toHaveLength(32);
    expect(new Set(FINAL_OPERATION_KINDS).size).toBe(FINAL_OPERATION_KINDS.length);
  });

  it('applies ordered project, rule, Beat, and alternate-Beat edits without advancing persistence fields', () => {
    const result = apply(makeProject(), [
      { kind: 'edit_project', changes: { name: 'Renamed', targetDurationSeconds: 60 } },
      { kind: 'set_brief', brief: 'A precise brief' },
      {
        kind: 'set_rules',
        rules: [{ id: 'rule_1', text: 'No logos', predicate: { kind: 'forbidden_terms', terms: ['logo'] } }],
      },
      { kind: 'add_beat', beatId: 'beat_3', beat: editableBeat('Third'), beforeBeatId: 'beat_2' },
      { kind: 'edit_beat', beatId: 'beat_1', changes: { title: 'Opening', action: 'Begin' } },
      { kind: 'reorder_beats', beatOrder: ['beat_3', 'beat_2', 'beat_1'] },
      { kind: 'add_binned_beat', beatId: 'beat_alt', beat: editableBeat('Alternate') },
    ]);

    expect(result.project).toMatchObject({
      revision: 7,
      updatedAt: timestamp,
      name: 'Renamed',
      brief: 'A precise brief',
      targetDurationSeconds: 60,
      beatOrder: ['beat_3', 'beat_2', 'beat_1'],
      beats: { beat_1: { title: 'Opening', action: 'Begin', actionRevision: 2 } },
      bin: [{ kind: 'beat', beatId: 'beat_alt', reason: 'alternate' }],
    });
    expect(result.project.rules).toEqual([
      {
        id: 'rule_1',
        scope: 'project',
        text: 'No logos',
        predicate: { kind: 'forbidden_terms', terms: ['logo'] },
        createdAt: laterTimestamp,
      },
    ]);
    expect(result.createdBeatIds).toEqual(['beat_3', 'beat_alt']);
    expect(result.createdShotIds).toEqual([]);
  });

  it('parks and restores an empty Beat through one exact lifted alias', () => {
    const parked = apply(makeProject(), [{ kind: 'park_beat', beatId: 'beat_2' }], 'mutation_park_beat');
    expect(parked.project.beatOrder).toEqual(['beat_1']);
    expect(parked.project.bin).toEqual([{ kind: 'beat', beatId: 'beat_2', reason: 'lifted' }]);

    const restored = apply(
      persist(parked.project),
      [{ kind: 'restore_beat', beatId: 'beat_2', beforeBeatId: 'beat_1' }],
      'mutation_restore_beat'
    );
    expect(restored.project.beatOrder).toEqual(['beat_2', 'beat_1']);
    expect(restored.project.bin).toEqual([]);
  });

  it('applies ordered Shot creation, editing, reorder, hard-cut, and dependency-free deletion', () => {
    const result = apply(makeProject(), [
      {
        kind: 'add_shot',
        beatId: 'beat_1',
        shotId: 'shot_3',
        shot: editableShot({ line: 'New shot' }),
        beforeShotId: 'shot_2',
      },
      { kind: 'edit_shot', shotId: 'shot_3', changes: { narration: 'Voice' } },
      { kind: 'reorder_shots', beatId: 'beat_1', shotOrder: ['shot_2', 'shot_1', 'shot_3'] },
      { kind: 'set_hard_cut', shotId: 'shot_3', hardCut: true },
      { kind: 'delete_shot', shotId: 'shot_2' },
    ]);

    expect(result.createdShotIds).toEqual(['shot_3']);
    expect(result.project.beats.beat_1!.shotOrder).toEqual(['shot_1', 'shot_3']);
    expect(result.project.shots).not.toHaveProperty('shot_2');
    expect(result.project.shots.shot_3).toMatchObject({
      line: 'New shot',
      narration: 'Voice',
      chainBreak: 'hard_cut',
      derivation: 'derived',
    });
  });

  it('parks and restores a Shot only through its persisted original owner', () => {
    const parked = apply(makeProject(), [{ kind: 'park_shot', shotId: 'shot_2' }], 'mutation_park_shot');
    expect(parked.project.beats.beat_1!.shotOrder).toEqual(['shot_1']);
    expect(parked.project.bin).toEqual([{ kind: 'shot', beatId: 'beat_1', shotId: 'shot_2', reason: 'lifted' }]);

    const restored = apply(
      persist(parked.project),
      [{ kind: 'restore_shot', shotId: 'shot_2', beforeShotId: 'shot_1' }],
      'mutation_restore_shot'
    );
    expect(restored.project.beats.beat_1!.shotOrder).toEqual(['shot_2', 'shot_1']);
    expect(restored.project.bin).toEqual([]);
  });

  it('applies seed, route, spend, Match To, and bed settings through exact final fields', () => {
    const project = makeProject();
    addImageAsset(project, 'shot_1', 'seed_1');
    project.assets.bed_1 = makeAudioAsset('bed_1');
    const result = apply(project, [
      { kind: 'set_seed_still', shotId: 'shot_1', assetId: 'seed_1' },
      { kind: 'set_routes', imageRouteId: 'image_route', videoRouteId: 'video_route' },
      { kind: 'set_spend_policy', policy: { currency: 'USD', maxPerBatchMinorUnits: 500 } },
      { kind: 'set_match_to', shotId: 'shot_2' },
      { kind: 'set_bed', assetId: 'bed_1' },
    ]);

    expect(result.project).toMatchObject({
      imageRouteId: 'image_route',
      videoRouteId: 'video_route',
      spendPolicy: { currency: 'USD', maxPerBatchMinorUnits: 500 },
      matchToShotId: 'shot_2',
      bedAssetId: 'bed_1',
      shots: { shot_1: { seedStillId: 'seed_1' } },
    });
  });

  it('parks, alternates, reorders, and restores takes without implicit selection', () => {
    const project = makeProject();
    addImageAsset(project, 'shot_1', 'take_1');
    addImageAsset(project, 'shot_1', 'take_2');
    const result = apply(project, [
      { kind: 'park_take', shotId: 'shot_1', assetId: 'take_1' },
      { kind: 'add_alternate_take', shotId: 'shot_1', assetId: 'take_2' },
      {
        kind: 'reorder_bin',
        bin: [
          { kind: 'take', assetId: 'take_2', reason: 'alternate' },
          { kind: 'take', assetId: 'take_1', reason: 'lifted' },
        ],
      },
      { kind: 'restore_take', shotId: 'shot_1', assetId: 'take_1' },
    ]);

    expect(result.project.bin).toEqual([{ kind: 'take', assetId: 'take_2', reason: 'alternate' }]);
    expect(result.project.shots.shot_1!.selectedTakeId).toBeNull();
  });

  it('selects and trims a canonical generated video Take', () => {
    const project = makeProject();
    addSucceededVideoTake(project, 'shot_1', 'take_video', false);
    expect(validateStudioProjectV2(project)).toBe(true);
    const result = apply(project, [
      { kind: 'select_take', shotId: 'shot_1', assetId: 'take_video' },
      { kind: 'trim_shot', shotId: 'shot_1', trimInSeconds: 1, trimOutSeconds: 2 },
    ]);

    expect(result.project.shots.shot_1).toMatchObject({
      selectedTakeId: 'take_video',
      trimInSeconds: 1,
      trimOutSeconds: 2,
    });
  });
});

describe('applyStudioMutationBatchV2 coverage and fixed shots', () => {
  const everyFixedReason = [
    'owned_asset',
    'owned_job',
    'selected_take',
    'seed_still',
    'conditioning_frame',
    'conditioning_input',
    'match_to',
    'narration',
    'on_screen_text',
  ] as const;

  const proposed = (shot: StudioShot) => ({
    shotId: shot.id,
    line: shot.line,
    narration: shot.narration,
    onScreenText: shot.onScreenText,
    durationSeconds: shot.durationSeconds,
    chainBreak: shot.chainBreak,
  });

  it('replaces dependency-free coverage while preserving every exact fixed row and boundary', () => {
    const project = makeProject();
    project.shots.shot_1!.narration = 'Voice';
    project.shots.shot_1!.onScreenText = 'Title';
    const result = apply(project, [
      {
        kind: 'apply_coverage',
        beatId: 'beat_1',
        shots: [
          proposed(project.shots.shot_1!),
          {
            shotId: 'shot_3',
            line: 'Replacement',
            narration: '',
            onScreenText: '',
            durationSeconds: 6,
            chainBreak: 'none',
          },
        ],
        fixedShots: [{ shotId: 'shot_1', reasons: ['narration', 'on_screen_text'] }],
      },
    ]);

    expect(result.project.beats.beat_1!.shotOrder).toEqual(['shot_1', 'shot_3']);
    expect(result.project.shots).not.toHaveProperty('shot_2');
    expect(result.coverageResults).toEqual([
      {
        beatId: 'beat_1',
        createdShotIds: ['shot_3'],
        retainedShotIds: ['shot_1'],
        removedShotIds: ['shot_2'],
        fixedShotIds: ['shot_1'],
      },
    ]);
  });

  it('rejects missing fixed rows and fixed-shot boundary movement byte-for-byte', () => {
    const project = makeProject();
    project.shots.shot_1!.narration = 'Voice';
    const fixed = [{ shotId: 'shot_1', reasons: ['narration'] as const }];
    expectReason(
      project,
      [
        {
          kind: 'apply_coverage',
          beatId: 'beat_1',
          shots: [proposed(project.shots.shot_1!), proposed(project.shots.shot_2!)],
          fixedShots: [],
        },
      ],
      'dependency_blocked',
      'mutation_missing_fixed'
    );
    expectReason(
      project,
      [
        {
          kind: 'apply_coverage',
          beatId: 'beat_1',
          shots: [proposed(project.shots.shot_2!), proposed(project.shots.shot_1!)],
          fixedShots: fixed.map((row) => ({ shotId: row.shotId, reasons: [...row.reasons] })),
        },
      ],
      'dependency_blocked',
      'mutation_moved_fixed'
    );
  });

  it('rejects coverage for a Beat that is retained only in the Bin before mutating', () => {
    const project = makeProject();
    project.beatOrder = ['beat_2'];
    project.bin.push({ kind: 'beat', beatId: 'beat_1', reason: 'lifted' });
    expect(validateStudioProjectV2(project)).toBe(true);
    const before = JSON.stringify(project);

    expectReason(
      project,
      [
        {
          kind: 'apply_coverage',
          beatId: 'beat_1',
          shots: [
            {
              shotId: 'shot_3',
              line: 'Replacement',
              narration: '',
              onScreenText: '',
              durationSeconds: 10,
              chainBreak: 'none',
            },
          ],
          fixedShots: [],
        },
      ],
      'invalid_operation',
      'mutation_binned_beat_coverage'
    );
    expect(JSON.stringify(project)).toBe(before);
  });

  it('derives all nine fixed reasons in canonical order and preserves the exact paid Shot through re-split', () => {
    const project = makeProject();
    const fixed = project.shots.shot_1!;
    fixed.narration = 'Persistent narration';
    fixed.onScreenText = 'Persistent title';
    addSucceededVideoTake(project, fixed.id, 'fixed_take', true);
    addFrameExtraction(project, fixed.id, 'ready');
    project.matchToShotId = fixed.id;
    expect(validateStudioProjectV2(project)).toBe(true);
    const retained = structuredClone({
      shot: fixed,
      assets: project.assets,
      jobs: project.jobs,
      authorizations: project.spendAuthorizations,
      frames: project.frameExtractions,
    });

    const result = apply(project, [
      {
        kind: 'apply_coverage',
        beatId: 'beat_1',
        shots: [
          proposed(fixed),
          {
            shotId: 'shot_replacement',
            line: 'A new active neighbor',
            narration: '',
            onScreenText: '',
            durationSeconds: 5,
            chainBreak: 'none',
          },
        ],
        fixedShots: [{ shotId: fixed.id, reasons: [...everyFixedReason] }],
      },
    ]);

    expect(result.coverageResults).toEqual([
      {
        beatId: 'beat_1',
        createdShotIds: ['shot_replacement'],
        retainedShotIds: ['shot_1'],
        removedShotIds: ['shot_2'],
        fixedShotIds: ['shot_1'],
      },
    ]);
    expect({
      shot: result.project.shots.shot_1,
      assets: result.project.assets,
      jobs: result.project.jobs,
      authorizations: result.project.spendAuthorizations,
      frames: result.project.frameExtractions,
    }).toEqual(retained);
  });

  it('keeps same-Beat paid coverage intact through park, re-split, and changed-anchor restore', () => {
    const project = makeProject();
    project.beats.beat_1!.shotOrder.push('shot_3', 'shot_4');
    project.shots.shot_3 = makeShot('shot_3');
    project.shots.shot_4 = makeShot('shot_4');
    completeBoundDependent(project);
    project.shots.shot_1!.seedStillId = null;

    const { frameAssetId: secondFrameAssetId } = addFrameExtraction(project, 'shot_2', 'ready');
    addSucceededVideoTake(project, 'shot_3', 'third_take', true);
    project.shots.shot_3!.seedStillId = null;
    const thirdAuthorization = project.spendAuthorizations.find((entry) => entry.id === 'auth_third_take')!;
    const thirdJob = project.jobs.job_third_take!;
    const thirdRequestPlan = resolvedPlan({
      kind: 'predecessor_frame',
      predecessorShotId: 'shot_2',
      takeAssetId: 'dependent_take',
      frameAssetId: secondFrameAssetId!,
      endpointSeconds: 10,
    });
    if (thirdRequestPlan.kind !== 'resolved') throw new Error('Expected one resolved third-shot request');
    thirdAuthorization.baseItems[0]!.requestPlan = thirdRequestPlan;
    thirdJob.requestPlan = thirdRequestPlan;
    thirdJob.requestSnapshot = thirdRequestPlan.snapshot;

    expect(validateStudioProjectV2(project)).toBe(true);
    expect(deriveStudioDirtyShotsV2(project)).toEqual([
      { shotId: 'shot_1', causes: ['generation_out_of_date'] },
      { shotId: 'shot_2', causes: ['generation_out_of_date'] },
      { shotId: 'shot_3', causes: ['generation_out_of_date'] },
    ]);
    const retainedShot = structuredClone(project.shots.shot_1);
    const paidAuthority = structuredClone({
      assets: project.assets,
      jobs: project.jobs,
      authorizations: project.spendAuthorizations,
      frames: project.frameExtractions,
    });

    const parked = persist(
      apply(project, [{ kind: 'park_shot', shotId: 'shot_1' }], 'mutation_lifecycle_park').project
    );
    expect(parked.beats.beat_1!.shotOrder).toEqual(['shot_2', 'shot_3', 'shot_4']);
    expect(parked.bin).toEqual([{ kind: 'shot', beatId: 'beat_1', shotId: 'shot_1', reason: 'lifted' }]);
    expect(parked.shots.shot_1).toEqual(retainedShot);

    const resplitMutation = apply(
      parked,
      [
        {
          kind: 'apply_coverage',
          beatId: 'beat_1',
          shots: [
            proposed(parked.shots.shot_2!),
            proposed(parked.shots.shot_3!),
            {
              shotId: 'shot_replacement',
              line: 'Replacement free interval',
              narration: '',
              onScreenText: '',
              durationSeconds: 5,
              chainBreak: 'none',
            },
          ],
          fixedShots: [
            {
              shotId: 'shot_2',
              reasons: ['owned_asset', 'owned_job', 'selected_take', 'conditioning_frame', 'conditioning_input'],
            },
            {
              shotId: 'shot_3',
              reasons: ['owned_asset', 'owned_job', 'selected_take'],
            },
          ],
        },
      ],
      'mutation_lifecycle_resplit'
    );
    expect(resplitMutation.coverageResults).toEqual([
      {
        beatId: 'beat_1',
        createdShotIds: ['shot_replacement'],
        retainedShotIds: ['shot_2', 'shot_3'],
        removedShotIds: ['shot_4'],
        fixedShotIds: ['shot_2', 'shot_3'],
      },
    ]);
    const resplit = persist(resplitMutation.project);
    expect(resplit.beats.beat_1!.shotOrder).toEqual(['shot_2', 'shot_3', 'shot_replacement']);
    expect(resplit.bin).toEqual([{ kind: 'shot', beatId: 'beat_1', shotId: 'shot_1', reason: 'lifted' }]);
    expect(resplit.shots.shot_1).toEqual(retainedShot);
    expect({
      assets: resplit.assets,
      jobs: resplit.jobs,
      authorizations: resplit.spendAuthorizations,
      frames: resplit.frameExtractions,
    }).toEqual(paidAuthority);
    expect(deriveStudioDirtyShotsV2(resplit)).toEqual([
      { shotId: 'shot_2', causes: ['continuity_stale', 'generation_out_of_date'] },
      { shotId: 'shot_3', causes: ['generation_out_of_date'] },
    ]);

    const restored = apply(
      resplit,
      [{ kind: 'restore_shot', shotId: 'shot_1', beforeShotId: 'shot_3' }],
      'mutation_lifecycle_restore_changed_anchor'
    ).project;
    expect(restored.beats.beat_1!.shotOrder).toEqual(['shot_2', 'shot_1', 'shot_3', 'shot_replacement']);
    expect(restored.bin).toEqual([]);
    expect(restored.shots.shot_1).toEqual(retainedShot);
    expect({
      assets: restored.assets,
      jobs: restored.jobs,
      authorizations: restored.spendAuthorizations,
      frames: restored.frameExtractions,
    }).toEqual(paidAuthority);
    expect(restored.jobs.job_third_take!.requestSnapshot?.conditioningInput).toEqual({
      kind: 'predecessor_frame',
      predecessorShotId: 'shot_2',
      takeAssetId: 'dependent_take',
      frameAssetId: secondFrameAssetId,
      endpointSeconds: 10,
    });
    expect(deriveStudioDirtyShotsV2(restored)).toEqual([
      { shotId: 'shot_2', causes: ['continuity_stale', 'generation_out_of_date'] },
      { shotId: 'shot_1', causes: ['continuity_stale', 'generation_out_of_date'] },
      { shotId: 'shot_3', causes: ['continuity_stale', 'generation_out_of_date'] },
    ]);
  });

  it('refuses missing, extra, reason-reordered, and row-reordered fixed proofs before mutation', () => {
    const oneFixed = makeProject();
    oneFixed.shots.shot_1!.narration = 'Fixed narration';
    oneFixed.shots.shot_1!.onScreenText = 'Fixed title';
    const shots = [proposed(oneFixed.shots.shot_1!), proposed(oneFixed.shots.shot_2!)];
    const cases: Array<{ fixedShots: unknown; reason: StudioMutationReasonV2 }> = [
      { fixedShots: [], reason: 'dependency_blocked' },
      {
        fixedShots: [{ shotId: 'shot_1', reasons: ['narration'] }],
        reason: 'dependency_blocked',
      },
      {
        fixedShots: [{ shotId: 'shot_1', reasons: ['owned_asset', 'narration', 'on_screen_text'] }],
        reason: 'dependency_blocked',
      },
      {
        fixedShots: [{ shotId: 'shot_1', reasons: ['on_screen_text', 'narration'] }],
        reason: 'invalid_operation',
      },
      {
        fixedShots: [
          { shotId: 'shot_1', reasons: ['narration', 'on_screen_text'] },
          { shotId: 'shot_2', reasons: ['narration'] },
        ],
        reason: 'dependency_blocked',
      },
    ];
    for (const [index, testCase] of cases.entries()) {
      expectReason(
        oneFixed,
        [
          {
            kind: 'apply_coverage',
            beatId: 'beat_1',
            shots,
            fixedShots: testCase.fixedShots as Extract<
              StudioMutationOperationV2,
              { kind: 'apply_coverage' }
            >['fixedShots'],
          },
        ],
        testCase.reason,
        `mutation_fixed_refusal_${index}`
      );
    }

    const twoFixed = makeProject();
    twoFixed.shots.shot_1!.narration = 'First';
    twoFixed.shots.shot_2!.onScreenText = 'Second';
    expectReason(
      twoFixed,
      [
        {
          kind: 'apply_coverage',
          beatId: 'beat_1',
          shots: [proposed(twoFixed.shots.shot_1!), proposed(twoFixed.shots.shot_2!)],
          fixedShots: [
            { shotId: 'shot_2', reasons: ['on_screen_text'] },
            { shotId: 'shot_1', reasons: ['narration'] },
          ],
        },
      ],
      'dependency_blocked',
      'mutation_fixed_row_order'
    );
  });
});

describe('applyStudioMutationBatchV2 line history and unified undo', () => {
  it('mints deterministic history for detach/rederive/restore in operation order', () => {
    const project = makeProject();
    project.shots.shot_1 = makeShot('shot_1', {
      line: 'Old line',
      derivation: 'detached',
      derivedFromActionRevision: null,
    });
    const mutationId = 'mutation_lines';
    const firstHistoryId = createStudioLineHistoryId(mutationId, 0, 'shot_1', 0);
    const secondHistoryId = createStudioLineHistoryId(mutationId, 1, 'shot_1', 0);
    const result = apply(
      project,
      [
        { kind: 'redetach_line', shotId: 'shot_1', line: 'New line' },
        { kind: 'rederive_line', shotId: 'shot_1', line: 'Derived line' },
        { kind: 'restore_line', shotId: 'shot_1', historyEntryId: firstHistoryId },
      ],
      mutationId
    );

    expect(result.project.shots.shot_1).toMatchObject({
      line: 'Old line',
      derivation: 'detached',
      derivedFromActionRevision: null,
    });
    expect(result.project.beats.beat_1!.lineHistory).toEqual([
      { id: firstHistoryId, shotOrdinal: 1, text: 'Old line', capturedAt: laterTimestamp },
      { id: secondHistoryId, shotOrdinal: 1, text: 'New line', capturedAt: laterTimestamp },
    ]);
  });

  it('archives a detached deletion and undo restores the exact Shot and owner history', () => {
    const project = makeProject();
    project.shots.shot_2 = makeShot('shot_2', {
      line: 'Deleted line',
      derivation: 'detached',
      derivedFromActionRevision: null,
    });
    const deleted = apply(project, [{ kind: 'delete_shot', shotId: 'shot_2' }], 'mutation_delete');
    expect(deleted.project.shots).not.toHaveProperty('shot_2');
    expect(deleted.project.beats.beat_1!.lineHistory).toEqual([
      {
        id: createStudioLineHistoryId('mutation_delete', 0, 'shot_2', 0),
        shotOrdinal: 2,
        text: 'Deleted line',
        capturedAt: laterTimestamp,
      },
    ]);

    const undone = apply(
      persist(deleted.project),
      [{ kind: 'undo_last', entryId: 'mutation_delete' }],
      'mutation_undo_delete'
    );
    expect(undone.project.shots.shot_2).toEqual(project.shots.shot_2);
    expect(undone.project.beats.beat_1).toEqual(project.beats.beat_1);
    expect(undone.project.undoHistory).toEqual([]);
  });

  it('undo preserves paid membership arrays written after the authored mutation', () => {
    const changed = apply(
      makeProject(),
      [{ kind: 'edit_shot', shotId: 'shot_1', changes: { line: 'Changed' } }],
      'mutation_edit'
    );
    const withPaidWrite = persist(changed.project);
    addImageAsset(withPaidWrite, 'shot_1', 'later_asset');
    withPaidWrite.revision += 1;
    expect(validateStudioProjectV2(withPaidWrite)).toBe(true);

    const undone = apply(withPaidWrite, [{ kind: 'undo_last', entryId: 'mutation_edit' }], 'mutation_undo_edit');
    expect(undone.project.shots.shot_1!.line).toBe('');
    expect(undone.project.shots.shot_1!.assetIds).toEqual(['later_asset']);
    expect(undone.project.assets.later_asset).toBeDefined();
  });

  it('fails closed when an authored after-fragment no longer matches the undo digest', () => {
    const changed = persist(
      apply(makeProject(), [{ kind: 'edit_shot', shotId: 'shot_1', changes: { line: 'Changed' } }], 'mutation_conflict')
        .project
    );
    changed.shots.shot_1!.narration = 'Concurrent authored change';
    changed.revision += 1;
    expect(validateStudioProjectV2(changed)).toBe(true);
    expectReason(
      changed,
      [{ kind: 'undo_last', entryId: 'mutation_conflict' }],
      'undo_conflict',
      'mutation_undo_conflict'
    );
  });

  it('evicts only the oldest line-history row at the exact 20-row boundary', () => {
    const project = makeProject();
    project.shots.shot_1 = makeShot('shot_1', {
      line: 'Current detached line',
      derivation: 'detached',
      derivedFromActionRevision: null,
    });
    project.beats.beat_1!.lineHistory = Array.from({ length: STUDIO_MAX_LINE_HISTORY_PER_BEAT }, (_, index) => ({
      id: `history_${index}`,
      shotOrdinal: 1,
      text: `line ${index}`,
      capturedAt: timestamp,
    }));
    const result = apply(
      project,
      [{ kind: 'redetach_line', shotId: 'shot_1', line: 'Replacement' }],
      'mutation_history_cap'
    );

    expect(result.project.beats.beat_1!.lineHistory).toHaveLength(STUDIO_MAX_LINE_HISTORY_PER_BEAT);
    expect(result.project.beats.beat_1!.lineHistory[0]!.id).toBe('history_1');
    expect(result.project.beats.beat_1!.lineHistory.at(-1)!.id).toBe(
      createStudioLineHistoryId('mutation_history_cap', 0, 'shot_1', 0)
    );
  });

  it('keeps only the newest 20 undo entries and never appends an inverse for undo', () => {
    let project = makeProject();
    for (let index = 0; index < 21; index += 1) {
      project = persist(
        apply(project, [{ kind: 'set_brief', brief: `brief ${index}` }], `mutation_brief_${index}`).project
      );
    }
    expect(project.undoHistory).toHaveLength(20);
    expect(project.undoHistory[0]!.id).toBe('mutation_brief_1');
    expect(project.undoHistory.at(-1)!.id).toBe('mutation_brief_20');

    const undone = apply(project, [{ kind: 'undo_last', entryId: 'mutation_brief_20' }], 'mutation_no_inverse');
    expect(undone.project.brief).toBe('brief 19');
    expect(undone.project.undoHistory.at(-1)!.id).toBe('mutation_brief_19');
    expect(undone.project.undoHistory).toHaveLength(19);
  });
});

describe('applyStudioMutationBatchV2 park safety and retained lineage', () => {
  it('rejects Shot and Take parking when their owner Beat is retained only in the Bin', () => {
    const project = makeProject();
    addImageAsset(project, 'shot_1', 'inactive_take');
    project.beatOrder = ['beat_2'];
    project.bin.push({ kind: 'beat', beatId: 'beat_1', reason: 'lifted' });
    expect(validateStudioProjectV2(project)).toBe(true);
    const before = JSON.stringify(project);

    expectReason(project, [{ kind: 'park_shot', shotId: 'shot_1' }], 'invalid_operation', 'mutation_binned_beat_shot');
    expectReason(
      project,
      [{ kind: 'park_take', shotId: 'shot_1', assetId: 'inactive_take' }],
      'invalid_operation',
      'mutation_binned_beat_take'
    );
    expect(JSON.stringify(project)).toBe(before);
  });

  it('parks terminal paid Shot lineage without dropping any asset, job, authorization, or selection', () => {
    const project = makeProject();
    addSucceededVideoTake(project, 'shot_1', 'terminal_take', true);
    expect(validateStudioProjectV2(project)).toBe(true);
    const retained = structuredClone({
      shot: project.shots.shot_1,
      assets: project.assets,
      jobs: project.jobs,
      spendAuthorizations: project.spendAuthorizations,
    });

    const result = apply(project, [{ kind: 'park_shot', shotId: 'shot_1' }], 'mutation_park_paid');
    expect(result.project.bin).toContainEqual({
      kind: 'shot',
      beatId: 'beat_1',
      shotId: 'shot_1',
      reason: 'lifted',
    });
    expect({
      shot: result.project.shots.shot_1,
      assets: result.project.assets,
      jobs: result.project.jobs,
      spendAuthorizations: result.project.spendAuthorizations,
    }).toEqual(retained);
  });

  it('parks a terminal-paid Beat, re-splits an active neighbor, and restores only the original Beat ownership', () => {
    const project = makeProject();
    project.shots.shot_2!.chainBreak = 'hard_cut';
    addSucceededVideoTake(project, 'shot_1', 'paid_take_1', true);
    addSucceededVideoTake(project, 'shot_2', 'paid_take_2', true);
    project.beats.beat_2!.shotOrder = ['shot_neighbor'];
    project.shots.shot_neighbor = makeShot('shot_neighbor');
    expect(validateStudioProjectV2(project)).toBe(true);
    const retained = structuredClone({
      beat: project.beats.beat_1,
      shots: { shot_1: project.shots.shot_1, shot_2: project.shots.shot_2 },
      assets: project.assets,
      jobs: project.jobs,
      authorizations: project.spendAuthorizations,
    });

    const parked = persist(
      apply(project, [{ kind: 'park_beat', beatId: 'beat_1' }], 'mutation_park_paid_beat').project
    );
    expect(parked.beatOrder).toEqual(['beat_2']);
    expect(parked.bin).toEqual([{ kind: 'beat', beatId: 'beat_1', reason: 'lifted' }]);
    expect(parked.bin).not.toContainEqual(expect.objectContaining({ kind: 'shot' }));

    const resplit = persist(
      apply(
        parked,
        [
          {
            kind: 'apply_coverage',
            beatId: 'beat_2',
            shots: [
              {
                shotId: 'shot_neighbor_replacement',
                line: 'Replacement neighbor',
                narration: '',
                onScreenText: '',
                durationSeconds: 5,
                chainBreak: 'none',
              },
            ],
            fixedShots: [],
          },
        ],
        'mutation_resplit_neighbor'
      ).project
    );
    expect(resplit.beats.beat_2!.shotOrder).toEqual(['shot_neighbor_replacement']);
    expect({
      beat: resplit.beats.beat_1,
      shots: { shot_1: resplit.shots.shot_1, shot_2: resplit.shots.shot_2 },
      assets: resplit.assets,
      jobs: resplit.jobs,
      authorizations: resplit.spendAuthorizations,
    }).toEqual(retained);

    const restored = apply(
      resplit,
      [{ kind: 'restore_beat', beatId: 'beat_1', beforeBeatId: 'beat_2' }],
      'mutation_restore_paid_beat'
    ).project;
    expect(restored.beatOrder).toEqual(['beat_1', 'beat_2']);
    expect(restored.beats.beat_1!.shotOrder).toEqual(['shot_1', 'shot_2']);
    expect(restored.bin).toEqual([]);
    expect({
      beat: restored.beats.beat_1,
      shots: { shot_1: restored.shots.shot_1, shot_2: restored.shots.shot_2 },
      assets: restored.assets,
      jobs: restored.jobs,
      authorizations: restored.spendAuthorizations,
    }).toEqual(retained);
  });

  it('feeds every inbound blocker family into the real Shot and Beat reducer refusal', () => {
    const assertBlocked = (project: StudioProjectV2, expectedKinds: string[], label: string): void => {
      expect(validateStudioProjectV2(project), label).toBe(true);
      expect(
        deriveStudioInboundShotReferencesV2(project, ['shot_1']).map((row) => row.kind),
        label
      ).toEqual(expectedKinds);
      expectReason(project, [{ kind: 'park_shot', shotId: 'shot_1' }], 'dependency_blocked', `${label}_shot`);
      expectReason(project, [{ kind: 'park_beat', beatId: 'beat_1' }], 'dependency_blocked', `${label}_beat`);
    };

    const matchTo = makeProject();
    matchTo.matchToShotId = 'shot_1';
    assertBlocked(matchTo, ['current_match_to'], 'mutation_blocker_match');

    const ownBound = makeProject();
    const seed = addImageAsset(ownBound, 'shot_1', 'own_bound_seed');
    ownBound.shots.shot_1!.seedStillId = seed.id;
    const ownItem = makeItem(ownBound.revision - 1, 'shot_1', resolvedPlan({ kind: 'seed_still', assetId: seed.id }));
    const ownAuthorization = makeAuthorization('auth_own_bound', ownBound.revision - 1, [ownItem]);
    const ownJob = makeJob('job_own_bound', ownAuthorization, ownItem);
    ownBound.spendAuthorizations.push(ownAuthorization);
    ownBound.jobs[ownJob.id] = ownJob;
    ownBound.shots.shot_1!.jobIds.push(ownJob.id);
    assertBlocked(ownBound, ['own_nonterminal_job', 'bound_nonterminal_request'], 'mutation_blocker_own');

    const pendingFrame = makeProject();
    addSucceededVideoTake(pendingFrame, 'shot_1', 'pending_frame_take', true);
    addFrameExtraction(pendingFrame, 'shot_1', 'pending');
    assertBlocked(pendingFrame, ['own_pending_frame', 'downstream_pending_frame'], 'mutation_blocker_pending_frame');

    const waiting = makeProject();
    addWaitingDependentOnOnlyTake(waiting);
    assertBlocked(
      waiting,
      ['downstream_nonterminal_job', 'waiting_authorization_dependency'],
      'mutation_blocker_waiting'
    );

    const downstreamBound = makeProject();
    bindWaitingDependent(downstreamBound);
    assertBlocked(
      downstreamBound,
      ['downstream_nonterminal_job', 'bound_nonterminal_request'],
      'mutation_blocker_downstream_bound'
    );
  });

  it('permits terminal historical conditioning, then projects the parked predecessor as stale', () => {
    const project = makeProject();
    completeBoundDependent(project);
    expect(validateStudioProjectV2(project)).toBe(true);
    expect(deriveStudioDirtyShotsV2(project)).toEqual([
      { shotId: 'shot_1', causes: ['generation_out_of_date'] },
      { shotId: 'shot_2', causes: ['generation_out_of_date'] },
    ]);
    expect(deriveStudioInboundShotReferencesV2(project, ['shot_1'])).toEqual([]);

    const parked = apply(project, [{ kind: 'park_shot', shotId: 'shot_1' }], 'mutation_terminal_history').project;

    expect(parked.bin).toContainEqual({ kind: 'shot', beatId: 'beat_1', shotId: 'shot_1', reason: 'lifted' });
    expect(deriveStudioInboundShotReferencesV2(parked, ['shot_1'])).toEqual([]);
    expect(deriveStudioDirtyShotsV2(parked)).toEqual([
      { shotId: 'shot_2', causes: ['continuity_stale', 'generation_out_of_date'] },
    ]);
  });

  it('refuses Match To and in-flight blockers before changing a Shot or containing Beat', () => {
    const matchProject = makeProject();
    matchProject.matchToShotId = 'shot_1';
    expectReason(matchProject, [{ kind: 'park_shot', shotId: 'shot_1' }], 'dependency_blocked', 'mutation_match_block');

    const inFlight = makeProject();
    const seed = addImageAsset(inFlight, 'shot_1', 'inflight_seed');
    inFlight.shots.shot_1!.seedStillId = seed.id;
    const item = makeItem(inFlight.revision - 1, 'shot_1', resolvedPlan({ kind: 'seed_still', assetId: seed.id }));
    const authorization = makeAuthorization('auth_inflight', inFlight.revision - 1, [item]);
    const job = makeJob('job_inflight', authorization, item);
    inFlight.spendAuthorizations.push(authorization);
    inFlight.jobs[job.id] = job;
    inFlight.shots.shot_1!.jobIds.push(job.id);
    expect(validateStudioProjectV2(inFlight)).toBe(true);
    expectReason(inFlight, [{ kind: 'park_beat', beatId: 'beat_1' }], 'dependency_blocked', 'mutation_beat_inflight');
  });

  it('refuses selected and seed takes without clearing either pin', () => {
    const selected = makeProject();
    addSucceededVideoTake(selected, 'shot_1', 'selected_take', true);
    expectReason(
      selected,
      [{ kind: 'park_take', shotId: 'shot_1', assetId: 'selected_take' }],
      'dependency_blocked',
      'mutation_selected_take'
    );
    expect(selected.shots.shot_1!.selectedTakeId).toBe('selected_take');

    const seeded = makeProject();
    addImageAsset(seeded, 'shot_1', 'seed_take');
    seeded.shots.shot_1!.seedStillId = 'seed_take';
    expectReason(
      seeded,
      [{ kind: 'park_take', shotId: 'shot_1', assetId: 'seed_take' }],
      'dependency_blocked',
      'mutation_seed_take'
    );
    expect(seeded.shots.shot_1!.seedStillId).toBe('seed_take');
  });

  it('refuses an unpinned Take that a nonterminal concrete request is consuming', () => {
    const project = makeProject();
    const take = addImageAsset(project, 'shot_1', 'conditioned_take');
    const item = makeItem(project.revision - 1, 'shot_1', resolvedPlan({ kind: 'seed_still', assetId: take.id }));
    const authorization = makeAuthorization('auth_conditioned_take', project.revision - 1, [item]);
    const job = makeJob('job_conditioned_take', authorization, item);
    project.spendAuthorizations.push(authorization);
    project.jobs[job.id] = job;
    project.shots.shot_1!.jobIds.push(job.id);
    expect(validateStudioProjectV2(project)).toBe(true);

    expectReason(
      project,
      [{ kind: 'park_take', shotId: 'shot_1', assetId: take.id }],
      'dependency_blocked',
      'mutation_conditioned_take'
    );
  });

  it('refuses the last selectable primary while an authorized dependent waits for that item', () => {
    const project = makeProject();
    const take = addWaitingDependentOnOnlyTake(project);
    expect(validateStudioProjectV2(project)).toBe(true);

    expectReason(
      project,
      [{ kind: 'park_take', shotId: 'shot_1', assetId: take.id }],
      'dependency_blocked',
      'mutation_waiting_last_take'
    );
  });
});

describe('applyStudioMutationBatchV2 bounds, totality, and rollback', () => {
  it('validates every alternate exact operation branch without invoking the reducer', () => {
    const validOperations: unknown[] = [
      ...(['9:16', '1:1', '4:3', '3:4'] as const).map((aspectRatio) => ({
        kind: 'edit_project',
        changes: { aspectRatio },
      })),
      { kind: 'edit_project', changes: { resolution: '720p' } },
      { kind: 'edit_project', changes: { targetDurationSeconds: 5 } },
      { kind: 'edit_project', changes: { targetDurationSeconds: 1440 } },
      { kind: 'edit_beat', beatId: 'beat_1', changes: { targetSeconds: 1 } },
      { kind: 'edit_beat', beatId: 'beat_1', changes: { targetSeconds: 1440 } },
      { kind: 'set_rules', rules: [{ id: 'rule_null', text: 'A rule', predicate: null }] },
      {
        kind: 'reorder_bin',
        bin: [
          { kind: 'beat', beatId: 'beat_1', reason: 'alternate' },
          { kind: 'shot', beatId: 'beat_1', shotId: 'shot_1', reason: 'lifted' },
          { kind: 'take', assetId: 'take_1', reason: 'lifted' },
        ],
      },
      { kind: 'set_routes', imageRouteId: null, videoRouteId: null },
      { kind: 'set_spend_policy', policy: null },
      { kind: 'set_match_to', shotId: null },
      { kind: 'set_bed', assetId: null },
      { kind: 'trim_shot', shotId: 'shot_1', trimInSeconds: 0, trimOutSeconds: null },
    ];

    for (const operation of validOperations) expect(validateStudioMutationOperationV2(operation)).toBe(true);
  });

  it('rejects malformed variants across every operation parser branch', () => {
    const duplicateRules = [
      { id: 'rule_1', text: 'One', predicate: null },
      { id: 'rule_1', text: 'Two', predicate: null },
    ];
    const invalidOperations: unknown[] = [
      null,
      [],
      {},
      { kind: 1 },
      { kind: 'unknown_operation' },
      { kind: 'set_brief', brief: 'valid', extra: true },
      { kind: 'edit_project', changes: null },
      { kind: 'edit_project', changes: {} },
      { kind: 'edit_project', changes: { unknown: true } },
      { kind: 'edit_project', changes: { name: '   ' } },
      { kind: 'edit_project', changes: { name: 'n'.repeat(257) } },
      { kind: 'edit_project', changes: { aspectRatio: '2:1' } },
      { kind: 'edit_project', changes: { resolution: '4k' } },
      { kind: 'edit_project', changes: { targetDurationSeconds: 4 } },
      { kind: 'set_brief', brief: 1 },
      { kind: 'set_brief', brief: 'b'.repeat(16 * 1024 + 1) },
      { kind: 'set_rules', rules: {} },
      { kind: 'set_rules', rules: [{ id: 'rule_1', text: 'Rule' }] },
      { kind: 'set_rules', rules: [{ id: '../rule', text: 'Rule', predicate: null }] },
      { kind: 'set_rules', rules: [{ id: 'rule_1', text: ' ', predicate: null }] },
      { kind: 'set_rules', rules: [{ id: 'rule_1', text: 'Rule', predicate: { kind: 'other', terms: ['x'] } }] },
      {
        kind: 'set_rules',
        rules: [{ id: 'rule_1', text: 'Rule', predicate: { kind: 'forbidden_terms', terms: [] } }],
      },
      {
        kind: 'set_rules',
        rules: [{ id: 'rule_1', text: 'Rule', predicate: { kind: 'forbidden_terms', terms: [1] } }],
      },
      {
        kind: 'set_rules',
        rules: [{ id: 'rule_1', text: 'Rule', predicate: { kind: 'forbidden_terms', terms: [' '] } }],
      },
      {
        kind: 'set_rules',
        rules: [{ id: 'rule_1', text: 'Rule', predicate: { kind: 'forbidden_terms', terms: ['x'.repeat(257)] } }],
      },
      {
        kind: 'set_rules',
        rules: [{ id: 'rule_1', text: 'Rule', predicate: { kind: 'forbidden_terms', terms: ['---'] } }],
      },
      {
        kind: 'set_rules',
        rules: [{ id: 'rule_1', text: 'Rule', predicate: { kind: 'forbidden_terms', terms: ['same', 'same'] } }],
      },
      { kind: 'set_rules', rules: duplicateRules },
      { kind: 'add_beat', beatId: '../beat', beat: editableBeat(), beforeBeatId: null },
      { kind: 'add_beat', beatId: 'beat_3', beat: null, beforeBeatId: null },
      { kind: 'add_beat', beatId: 'beat_3', beat: { ...editableBeat(), extra: true }, beforeBeatId: null },
      { kind: 'add_beat', beatId: 'beat_3', beat: editableBeat('t'.repeat(257)), beforeBeatId: null },
      {
        kind: 'add_beat',
        beatId: 'beat_3',
        beat: { ...editableBeat(), action: 'a'.repeat(4 * 1024 + 1) },
        beforeBeatId: null,
      },
      {
        kind: 'add_beat',
        beatId: 'beat_3',
        beat: { ...editableBeat(), look: 'l'.repeat(8 * 1024 + 1) },
        beforeBeatId: null,
      },
      { kind: 'add_beat', beatId: 'beat_3', beat: { ...editableBeat(), targetSeconds: 0 }, beforeBeatId: null },
      { kind: 'add_beat', beatId: 'beat_3', beat: editableBeat(), beforeBeatId: '../beat' },
      { kind: 'edit_beat', beatId: 'beat_1', changes: null },
      { kind: 'edit_beat', beatId: 'beat_1', changes: {} },
      { kind: 'edit_beat', beatId: 'beat_1', changes: { unknown: true } },
      { kind: 'edit_beat', beatId: 'beat_1', changes: { title: 't'.repeat(257) } },
      { kind: 'edit_beat', beatId: 'beat_1', changes: { action: 'a'.repeat(4 * 1024 + 1) } },
      { kind: 'edit_beat', beatId: 'beat_1', changes: { look: 'l'.repeat(8 * 1024 + 1) } },
      { kind: 'edit_beat', beatId: 'beat_1', changes: { targetSeconds: 0 } },
      { kind: 'reorder_beats', beatOrder: {} },
      { kind: 'reorder_beats', beatOrder: ['beat_1', 'beat_1'] },
      { kind: 'reorder_beats', beatOrder: ['../beat'] },
      { kind: 'park_beat', beatId: '../beat' },
      { kind: 'restore_beat', beatId: 'beat_1', beforeBeatId: '../beat' },
      { kind: 'add_binned_beat', beatId: '../beat', beat: editableBeat() },
      { kind: 'add_shot', beatId: '../beat', shotId: 'shot_3', shot: editableShot(), beforeShotId: null },
      { kind: 'add_shot', beatId: 'beat_1', shotId: '../shot', shot: editableShot(), beforeShotId: null },
      { kind: 'add_shot', beatId: 'beat_1', shotId: 'shot_3', shot: null, beforeShotId: null },
      {
        kind: 'add_shot',
        beatId: 'beat_1',
        shotId: 'shot_3',
        shot: { ...editableShot(), extra: true },
        beforeShotId: null,
      },
      {
        kind: 'add_shot',
        beatId: 'beat_1',
        shotId: 'shot_3',
        shot: editableShot({ line: 'l'.repeat(8 * 1024 + 1) }),
        beforeShotId: null,
      },
      {
        kind: 'add_shot',
        beatId: 'beat_1',
        shotId: 'shot_3',
        shot: editableShot({ narration: 'n'.repeat(4 * 1024 + 1) }),
        beforeShotId: null,
      },
      {
        kind: 'add_shot',
        beatId: 'beat_1',
        shotId: 'shot_3',
        shot: editableShot({ onScreenText: 'o'.repeat(1025) }),
        beforeShotId: null,
      },
      {
        kind: 'add_shot',
        beatId: 'beat_1',
        shotId: 'shot_3',
        shot: editableShot({ durationSeconds: 4.5 }),
        beforeShotId: null,
      },
      { kind: 'add_shot', beatId: 'beat_1', shotId: 'shot_3', shot: editableShot(), beforeShotId: '../shot' },
      { kind: 'edit_shot', shotId: 'shot_1', changes: null },
      { kind: 'edit_shot', shotId: 'shot_1', changes: {} },
      { kind: 'edit_shot', shotId: 'shot_1', changes: { unknown: true } },
      { kind: 'edit_shot', shotId: 'shot_1', changes: { line: 'l'.repeat(8 * 1024 + 1) } },
      { kind: 'edit_shot', shotId: 'shot_1', changes: { narration: 'n'.repeat(4 * 1024 + 1) } },
      { kind: 'edit_shot', shotId: 'shot_1', changes: { onScreenText: 'o'.repeat(1025) } },
      { kind: 'edit_shot', shotId: 'shot_1', changes: { durationSeconds: 4.5 } },
      { kind: 'delete_shot', shotId: '../shot' },
      { kind: 'park_shot', shotId: '../shot' },
      { kind: 'restore_shot', shotId: 'shot_1', beforeShotId: '../shot' },
      { kind: 'reorder_shots', beatId: 'beat_1', shotOrder: ['shot_1', 'shot_1'] },
      { kind: 'apply_coverage', beatId: 'beat_1', shots: {}, fixedShots: [] },
      { kind: 'apply_coverage', beatId: 'beat_1', shots: [{}], fixedShots: [] },
      { kind: 'apply_coverage', beatId: 'beat_1', shots: [], fixedShots: [{}] },
      { kind: 'set_hard_cut', shotId: 'shot_1', hardCut: 'yes' },
      { kind: 'set_seed_still', shotId: 'shot_1', assetId: '../asset' },
      { kind: 'trim_shot', shotId: 'shot_1', trimInSeconds: -1, trimOutSeconds: null },
      { kind: 'trim_shot', shotId: 'shot_1', trimInSeconds: -0, trimOutSeconds: null },
      { kind: 'trim_shot', shotId: 'shot_1', trimInSeconds: Number.POSITIVE_INFINITY, trimOutSeconds: null },
      { kind: 'redetach_line', shotId: 'shot_1', line: 1 },
      { kind: 'rederive_line', shotId: 'shot_1', line: 'l'.repeat(8 * 1024 + 1) },
      { kind: 'restore_line', shotId: 'shot_1', historyEntryId: '../history' },
      { kind: 'park_take', shotId: 'shot_1', assetId: '../asset' },
      { kind: 'add_alternate_take', shotId: 'shot_1', assetId: '../asset' },
      { kind: 'restore_take', shotId: 'shot_1', assetId: '../asset' },
      { kind: 'select_take', shotId: 'shot_1', assetId: '../asset' },
      { kind: 'reorder_bin', bin: {} },
      { kind: 'reorder_bin', bin: [{ kind: 'unknown' }] },
      { kind: 'reorder_bin', bin: [{ kind: 'beat', beatId: 'beat_1', reason: 'bad' }] },
      { kind: 'reorder_bin', bin: [{ kind: 'shot', beatId: 'beat_1', shotId: 'shot_1', reason: 'bad' }] },
      { kind: 'reorder_bin', bin: [{ kind: 'take', assetId: 'take_1', reason: 'bad' }] },
      { kind: 'set_routes', imageRouteId: '../route', videoRouteId: null },
      { kind: 'set_spend_policy', policy: {} },
      { kind: 'set_spend_policy', policy: { currency: 'US', maxPerBatchMinorUnits: 1 } },
      { kind: 'set_spend_policy', policy: { currency: 'USD', maxPerBatchMinorUnits: -1 } },
      { kind: 'set_match_to', shotId: '../shot' },
      { kind: 'set_bed', assetId: '../asset' },
      { kind: 'undo_last', entryId: '../entry' },
    ];

    const cyclic = { kind: 'set_brief', brief: 'cyclic' } as Record<string, unknown>;
    cyclic.self = cyclic;
    invalidOperations.push(cyclic);

    for (const operation of invalidOperations) expect(validateStudioMutationOperationV2(operation)).toBe(false);
  });

  it('rejects malformed batch and reducer-context envelopes before mutating project bytes', () => {
    const project = makeProject();
    const validBatch = mutationBatch(project, [{ kind: 'set_brief', brief: 'changed' }]);
    const validContext = { mutationId: 'mutation_envelope', capturedAt: laterTimestamp };
    const cases: Array<{ batch: unknown; context: unknown; reason: StudioMutationReasonV2 }> = [
      { batch: null, context: validContext, reason: 'invalid_operation' },
      { batch: { ...validBatch, extra: true }, context: validContext, reason: 'invalid_operation' },
      { batch: { ...validBatch, schemaVersion: 1 }, context: validContext, reason: 'invalid_operation' },
      { batch: { ...validBatch, projectId: 'other_project' }, context: validContext, reason: 'invalid_operation' },
      {
        batch: { ...validBatch, expectedRevision: project.revision + 1 },
        context: validContext,
        reason: 'invalid_operation',
      },
      { batch: { ...validBatch, expectedRevision: 7.5 }, context: validContext, reason: 'invalid_operation' },
      { batch: { ...validBatch, operations: {} }, context: validContext, reason: 'invalid_operation' },
      { batch: { ...validBatch, operations: [] }, context: validContext, reason: 'invalid_operation' },
      { batch: validBatch, context: null, reason: 'invalid_operation' },
      { batch: validBatch, context: { ...validContext, extra: true }, reason: 'invalid_operation' },
      { batch: validBatch, context: { ...validContext, mutationId: '../mutation' }, reason: 'invalid_operation' },
      { batch: validBatch, context: { ...validContext, capturedAt: 1 }, reason: 'invalid_operation' },
      { batch: validBatch, context: { ...validContext, capturedAt: 'invalid' }, reason: 'invalid_operation' },
      {
        batch: validBatch,
        context: { ...validContext, capturedAt: '2026-08-17T00:00:00.000+00:00' },
        reason: 'invalid_operation',
      },
    ];

    for (const entry of cases) {
      const before = structuredClone(project);
      try {
        applyStudioMutationBatchV2(project, entry.batch as StudioMutationBatchV2, entry.context as never);
        throw new Error('Expected malformed envelope to fail');
      } catch (error) {
        expect(error).toBeInstanceOf(StudioMutationErrorV2);
        expect((error as StudioMutationErrorV2).reasonCode).toBe(entry.reason);
      }
      expect(project).toEqual(before);
    }

    const invalidProject = makeProject();
    invalidProject.name = '';
    expect(() => apply(invalidProject, [{ kind: 'set_brief', brief: 'never' }])).toThrow(
      expect.objectContaining({ reasonCode: 'validation_failed' })
    );

    const uncloneable = mutationBatch(project, [
      { kind: 'set_brief', brief: (() => 'not cloneable') as unknown as string },
    ]);
    expect(() => applyStudioMutationBatchV2(project, uncloneable, validContext)).toThrow(
      expect.objectContaining({ reasonCode: 'validation_failed' })
    );
  });

  it('rejects semantic no-ops, missing owners and anchors, and reused identities', () => {
    const cases: Array<{ operation: StudioMutationOperationV2; reason: StudioMutationReasonV2 }> = [
      { operation: { kind: 'edit_project', changes: { name: 'Project One' } }, reason: 'invalid_operation' },
      { operation: { kind: 'set_brief', brief: '' }, reason: 'invalid_operation' },
      { operation: { kind: 'set_rules', rules: [] }, reason: 'invalid_operation' },
      {
        operation: {
          kind: 'add_beat',
          beatId: 'beat_3',
          beat: editableBeat(),
          beforeBeatId: 'missing_beat',
        },
        reason: 'invalid_operation',
      },
      {
        operation: { kind: 'add_beat', beatId: 'beat_1', beat: editableBeat(), beforeBeatId: null },
        reason: 'identity_collision',
      },
      {
        operation: { kind: 'edit_beat', beatId: 'missing_beat', changes: { title: 'Title' } },
        reason: 'invalid_operation',
      },
      { operation: { kind: 'edit_beat', beatId: 'beat_1', changes: { title: '' } }, reason: 'invalid_operation' },
      { operation: { kind: 'reorder_beats', beatOrder: ['beat_1'] }, reason: 'invalid_operation' },
      { operation: { kind: 'reorder_beats', beatOrder: ['beat_1', 'beat_2'] }, reason: 'invalid_operation' },
      { operation: { kind: 'park_beat', beatId: 'missing_beat' }, reason: 'invalid_operation' },
      { operation: { kind: 'restore_beat', beatId: 'beat_1', beforeBeatId: null }, reason: 'invalid_operation' },
      {
        operation: {
          kind: 'add_shot',
          beatId: 'missing_beat',
          shotId: 'shot_3',
          shot: editableShot(),
          beforeShotId: null,
        },
        reason: 'invalid_operation',
      },
      {
        operation: {
          kind: 'add_shot',
          beatId: 'beat_1',
          shotId: 'shot_3',
          shot: editableShot(),
          beforeShotId: 'missing_shot',
        },
        reason: 'invalid_operation',
      },
      {
        operation: {
          kind: 'add_shot',
          beatId: 'beat_1',
          shotId: 'shot_1',
          shot: editableShot(),
          beforeShotId: null,
        },
        reason: 'identity_collision',
      },
      {
        operation: { kind: 'edit_shot', shotId: 'missing_shot', changes: { line: 'Line' } },
        reason: 'invalid_operation',
      },
      { operation: { kind: 'edit_shot', shotId: 'shot_1', changes: { line: '' } }, reason: 'invalid_operation' },
      { operation: { kind: 'set_hard_cut', shotId: 'shot_1', hardCut: false }, reason: 'invalid_operation' },
      { operation: { kind: 'set_seed_still', shotId: 'shot_1', assetId: null }, reason: 'invalid_operation' },
      {
        operation: { kind: 'trim_shot', shotId: 'shot_1', trimInSeconds: null, trimOutSeconds: null },
        reason: 'invalid_operation',
      },
      { operation: { kind: 'rederive_line', shotId: 'shot_1', line: '' }, reason: 'invalid_operation' },
      { operation: { kind: 'set_routes', imageRouteId: null, videoRouteId: null }, reason: 'invalid_operation' },
      { operation: { kind: 'set_spend_policy', policy: null }, reason: 'invalid_operation' },
      { operation: { kind: 'set_match_to', shotId: null }, reason: 'invalid_operation' },
      { operation: { kind: 'set_bed', assetId: null }, reason: 'invalid_operation' },
    ];

    for (const { operation, reason } of cases) expectReason(makeProject(), [operation], reason);

    const nonemptyLine = makeProject();
    nonemptyLine.shots.shot_1!.line = 'Current reviewed line';
    expectReason(nonemptyLine, [{ kind: 'rederive_line', shotId: 'shot_1', line: '' }], 'invalid_operation');
  });

  it('accepts exactly 32 ordered operations and rejects 33', () => {
    const maximum = Array.from({ length: STUDIO_MAX_MUTATION_OPERATIONS }, (_, index) => ({
      kind: 'set_brief' as const,
      brief: `brief ${index}`,
    }));
    expect(apply(makeProject(), maximum, 'mutation_32').project.brief).toBe('brief 31');
    expectReason(
      makeProject(),
      [...maximum, { kind: 'set_brief', brief: 'overflow' }],
      'invalid_operation',
      'mutation_33'
    );
  });

  it('accepts inclusive 4/15-second Shot bounds and rejects values outside them', () => {
    const result = apply(makeProject(), [
      {
        kind: 'add_shot',
        beatId: 'beat_1',
        shotId: 'shot_min',
        shot: editableShot({ durationSeconds: 4 }),
        beforeShotId: null,
      },
      {
        kind: 'add_shot',
        beatId: 'beat_1',
        shotId: 'shot_max',
        shot: editableShot({ durationSeconds: 15 }),
        beforeShotId: null,
      },
    ]);
    expect(result.project.shots.shot_min!.durationSeconds).toBe(4);
    expect(result.project.shots.shot_max!.durationSeconds).toBe(15);
    expectReason(
      makeProject(),
      [
        {
          kind: 'add_shot',
          beatId: 'beat_1',
          shotId: 'shot_short',
          shot: editableShot({ durationSeconds: 3 }),
          beforeShotId: null,
        },
      ],
      'invalid_shot_duration',
      'mutation_short'
    );
    expectReason(
      makeProject(),
      [
        {
          kind: 'add_shot',
          beatId: 'beat_1',
          shotId: 'shot_long',
          shot: editableShot({ durationSeconds: 16 }),
          beforeShotId: null,
        },
      ],
      'invalid_shot_duration',
      'mutation_long'
    );
  });

  it('reports reachable Beat, per-Beat Shot, and project Shot capacity reasons', () => {
    const fullBeats = makeProject();
    fullBeats.beatOrder = [];
    fullBeats.beats = {};
    fullBeats.shots = {};
    for (let index = 0; index < STUDIO_MAX_BEATS; index += 1) {
      const beatId = `beat_${index}`;
      fullBeats.beatOrder.push(beatId);
      fullBeats.beats[beatId] = makeBeat(beatId);
    }
    expectReason(
      fullBeats,
      [{ kind: 'add_beat', beatId: 'beat_overflow', beat: editableBeat(), beforeBeatId: null }],
      'beat_capacity_reached',
      'mutation_beat_capacity'
    );

    const fullBeat = makeProject();
    fullBeat.beats.beat_1!.shotOrder = [];
    fullBeat.shots = {};
    for (let index = 0; index < STUDIO_MAX_SHOTS_PER_BEAT; index += 1) {
      const shotId = `shot_${index}`;
      fullBeat.beats.beat_1!.shotOrder.push(shotId);
      fullBeat.shots[shotId] = makeShot(shotId);
    }
    expectReason(
      fullBeat,
      [
        {
          kind: 'add_shot',
          beatId: 'beat_1',
          shotId: 'shot_overflow',
          shot: editableShot(),
          beforeShotId: null,
        },
      ],
      'beat_shot_capacity_reached',
      'mutation_beat_shot_capacity'
    );

    const fullProject = makeProject();
    fullProject.beatOrder = [];
    fullProject.beats = {};
    fullProject.shots = {};
    for (let beatIndex = 0; beatIndex < STUDIO_MAX_SHOTS_PER_PROJECT / STUDIO_MAX_SHOTS_PER_BEAT; beatIndex += 1) {
      const beatId = `beat_${beatIndex}`;
      const shotOrder: string[] = [];
      for (let shotIndex = 0; shotIndex < STUDIO_MAX_SHOTS_PER_BEAT; shotIndex += 1) {
        const shotId = `shot_${beatIndex}_${shotIndex}`;
        shotOrder.push(shotId);
        fullProject.shots[shotId] = makeShot(shotId);
      }
      fullProject.beatOrder.push(beatId);
      fullProject.beats[beatId] = makeBeat(beatId, shotOrder);
    }
    fullProject.beatOrder.push('beat_empty');
    fullProject.beats.beat_empty = makeBeat('beat_empty');
    expectReason(
      fullProject,
      [
        {
          kind: 'add_shot',
          beatId: 'beat_empty',
          shotId: 'shot_overflow',
          shot: editableShot(),
          beforeShotId: null,
        },
      ],
      'project_shot_capacity_reached',
      'mutation_project_shot_capacity'
    );

    const fullRestoreOwner = makeProject();
    for (let index = 3; index <= STUDIO_MAX_SHOTS_PER_BEAT; index += 1) {
      const shotId = `shot_${index}`;
      fullRestoreOwner.beats.beat_1!.shotOrder.push(shotId);
      fullRestoreOwner.shots[shotId] = makeShot(shotId);
    }
    fullRestoreOwner.shots.shot_parked = makeShot('shot_parked');
    fullRestoreOwner.bin.push({ kind: 'shot', beatId: 'beat_1', shotId: 'shot_parked', reason: 'lifted' });
    expect(validateStudioProjectV2(fullRestoreOwner)).toBe(true);
    expectReason(
      fullRestoreOwner,
      [{ kind: 'restore_shot', shotId: 'shot_parked', beforeShotId: null }],
      'beat_shot_capacity_reached',
      'mutation_restore_shot_capacity'
    );
  });

  it('refuses the 97th Take alias at the exact Bin capacity without mutation', () => {
    const project = makeProject();
    for (let index = 0; index <= STUDIO_MAX_BIN_TAKE_ITEMS; index += 1) {
      addImageAsset(project, 'shot_1', `take_${index}`);
      if (index < STUDIO_MAX_BIN_TAKE_ITEMS) {
        project.bin.push({ kind: 'take', assetId: `take_${index}`, reason: 'alternate' });
      }
    }
    expect(validateStudioProjectV2(project)).toBe(true);
    expectReason(
      project,
      [{ kind: 'park_take', shotId: 'shot_1', assetId: `take_${STUDIO_MAX_BIN_TAKE_ITEMS}` }],
      'take_bin_capacity_reached',
      'mutation_take_capacity'
    );
  });

  it('rolls back an earlier valid operation when a later duration fails', () => {
    const project = makeProject();
    expectReason(
      project,
      [
        { kind: 'set_brief', brief: 'Must roll back' },
        { kind: 'edit_shot', shotId: 'shot_1', changes: { durationSeconds: 3 } },
      ],
      'invalid_shot_duration',
      'mutation_late_failure'
    );
    expect(project.brief).toBe('');
  });

  it('rejects inherited prototypes, accessors, symbols, and sparse operation arrays before cloning', () => {
    const project = makeProject();
    const inherited = Object.create({ kind: 'set_brief' }) as StudioMutationOperationV2;
    Object.assign(inherited, { brief: 'inherited' });
    expectReason(project, [inherited], 'invalid_operation', 'mutation_inherited');

    const accessor = { kind: 'set_brief' } as Record<string, unknown>;
    Object.defineProperty(accessor, 'brief', { enumerable: true, get: () => 'accessor' });
    expectReason(project, [accessor as StudioMutationOperationV2], 'invalid_operation', 'mutation_accessor');

    const symbolOperation = { kind: 'set_brief', brief: 'symbol' } as StudioMutationOperationV2 &
      Record<symbol, unknown>;
    symbolOperation[Symbol('hidden')] = true;
    expectReason(project, [symbolOperation], 'invalid_operation', 'mutation_symbol');

    const sparseOperations: StudioMutationOperationV2[] = [];
    sparseOperations.length = 1;
    const before = structuredClone(project);
    expect(() =>
      applyStudioMutationBatchV2(
        project,
        { schemaVersion: 2, projectId: project.id, expectedRevision: project.revision, operations: sparseOperations },
        { mutationId: 'mutation_sparse', capturedAt: laterTimestamp }
      )
    ).toThrowError(StudioMutationErrorV2);
    expect(project).toEqual(before);
  });
});
