/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment node
 */

import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  STUDIO_MAX_BEATS,
  STUDIO_MAX_LINE_HISTORY_PER_BEAT,
  STUDIO_MAX_MUTATION_OPERATIONS,
  STUDIO_MAX_SHOTS_PER_BEAT,
  STUDIO_MAX_SHOTS_PER_PROJECT,
  STUDIO_PROJECT_SCHEMA_VERSION,
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
  createStudioBoardGenerationRequestPlanForShot,
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

const canonicalJson = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .toSorted()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(',')}}`;
};

const authoredDigest = (value: unknown): string =>
  createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');

const authoredShot = (shot: StudioShot): Omit<StudioShot, 'assetIds' | 'jobIds'> => {
  const { assetIds: _assetIds, jobIds: _jobIds, ...authored } = shot;
  return structuredClone(authored);
};

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
  referenceIds: [],
  seedStillId: null,
  boardAssetId: null,
  supersededBoardAssetIds: [],
  videoAssetId: null,
  supersededVideoAssetIds: [],
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
  schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
  revision: 7,
  id: 'project_1',
  name: 'Project One',
  brief: '',
  rules: [],
  briefConversationId: null,
  aspectRatio: '16:9',
  targetDurationSeconds: 30,
  resolution: '1080p',
  boardStyle: null,
  beatOrder: ['beat_1', 'beat_2'],
  beats: {
    beat_1: makeBeat('beat_1', ['shot_1', 'shot_2']),
    beat_2: makeBeat('beat_2'),
  },
  shots: {
    shot_1: makeShot('shot_1'),
    shot_2: makeShot('shot_2'),
  },
  referenceOrder: [],
  references: {},
  bin: [],
  bedAssetId: null,
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
  referenceAssetIds: [],
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
  referenceAssetIds: [],
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
    referenceInputs: [],
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
    referenceInputs: [],
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

const makeSeedItem = (projectRevision: number, shotId: string): StudioQuotedGeneration => ({
  id: createStudioQuotedGenerationId({
    projectId: 'project_1',
    projectRevision,
    shotId,
    purpose: 'seed_still',
  }),
  shotId,
  purpose: 'seed_still',
  routeId: 'image_route',
  generationCount: 1,
  requestPlan: resolvedPlan(null),
  rateUnit: 'generation',
  rateMinorUnits: 3,
});

const makeBoardItem = (projectRevision: number, shotId: string): StudioQuotedGeneration => {
  const requestPlan: StudioGenerationRequestPlan = {
    kind: 'resolved',
    snapshot: {
      prompt: 'Board prompt',
      aspectRatio: '16:9',
      resolution: '1080p',
      durationSeconds: 4,
      referenceInputs: [],
      conditioningInput: null,
    },
  };
  return {
    id: createStudioQuotedGenerationId({
      projectId: 'project_1',
      projectRevision,
      shotId,
      purpose: 'board_still',
    }),
    shotId,
    purpose: 'board_still',
    routeId: 'image_route',
    generationCount: 1,
    requestPlan,
    rateUnit: 'generation',
    rateMinorUnits: 3,
  };
};

const authorizedSeedPlan = (upstreamItemId: string, shotId: string): StudioGenerationRequestPlan => ({
  kind: 'after_take_selection',
  template: {
    prompt: 'dependent prompt',
    aspectRatio: '16:9',
    resolution: '1080p',
    durationSeconds: 5,
    referenceInputs: [],
  },
  dependency: { kind: 'authorized_seed', upstreamItemId, shotId },
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
    idempotencyKeys: items.map((item) => ({ itemId: item.id, key: `idem_${id}_${item.id}` })),
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
  idempotencyKey: authorization.idempotencyKeys.find((entry) => entry.itemId === item.id)!.key,
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
  requestPlan: item.requestPlan,
  requestSnapshot: item.requestPlan.kind === 'resolved' ? item.requestPlan.snapshot : null,
  spendReceipt: null,
  outputAssetIdsByRole: { primary: null, poster: null },
  ...overrides,
});

const addSucceededSeedJob = (
  project: StudioProjectV2,
  authorization: StudioSpendAuthorization,
  item: StudioQuotedGeneration,
  jobId: string,
  assetId: string
): StudioAssetV2 => {
  const asset = addImageAsset(project, item.shotId, assetId, 'assets');
  const job = makeJob(jobId, authorization, item, {
    status: 'succeeded',
    providerJobId: `remote_${jobId}`,
    remoteStartedAt: timestamp,
    purpose: 'seed_still',
    outputAssetIds: [asset.id],
    outputAssetIdsByRole: { primary: asset.id, poster: null },
    spendReceipt: {
      authorizationId: authorization.id,
      itemId: item.id,
      jobId,
      purpose: 'seed_still',
      routeId: item.routeId,
      currency: authorization.currency,
      rateUnit: 'generation',
      rateMinorUnits: item.rateMinorUnits,
      durationSeconds: null,
      generationCount: 1,
      totalMinorUnits: item.rateMinorUnits,
    },
  });
  project.jobs[job.id] = job;
  project.shots[item.shotId]!.jobIds.push(job.id);
  return asset;
};

const addApprovedProjectReference = (
  project: StudioProjectV2,
  referenceId: string,
  anchorShotId: string,
  assetId: string
): StudioAssetV2 => {
  const reference = project.references[referenceId];
  if (reference === undefined || !project.shots[anchorShotId]?.referenceIds.includes(referenceId)) {
    throw new Error('Approved reference fixture requires one exact assigned anchor Shot');
  }
  const item: StudioQuotedGeneration = {
    ...makeSeedItem(project.revision - 1, anchorShotId),
    id: createStudioQuotedGenerationId({
      projectId: project.id,
      projectRevision: project.revision - 1,
      shotId: anchorShotId,
      purpose: 'seed_still',
      projectReferenceId: referenceId,
    }),
    projectReferenceId: referenceId,
  };
  const authorization = makeAuthorization(`authorization_${referenceId}`, project.revision - 1, [item]);
  const jobId = `job_${referenceId}`;
  project.spendAuthorizations.push(authorization);
  const asset = addSucceededSeedJob(project, authorization, item, jobId, assetId);
  project.jobs[jobId]!.projectReferenceId = referenceId;
  reference.candidateJobId = jobId;
  reference.candidateAssetId = asset.id;
  reference.approvedAssetId = asset.id;
  return asset;
};

const addSucceededBoardPanel = (
  project: StudioProjectV2,
  shotId: string,
  assetId = `board_${shotId}`,
  jobId = `job_${assetId}`
): StudioAssetV2 => {
  project.boardStyle = 'grey_tone';
  project.imageRouteId = 'image_route';
  const beat = Object.values(project.beats).find((candidate) => candidate.shotOrder.includes(shotId));
  const shot = project.shots[shotId];
  if (beat === undefined || shot === undefined) throw new Error('Board fixture requires one active Shot');
  const requestPlan = createStudioBoardGenerationRequestPlanForShot({ project, beat, shot });
  if (requestPlan === null) throw new Error('Board fixture request must resolve');
  const item: StudioQuotedGeneration = {
    ...makeBoardItem(project.revision - 1, shotId),
    requestPlan,
  };
  const authorization = makeAuthorization(`auth_${assetId}`, project.revision - 1, [item]);
  const asset = addImageAsset(project, shotId, assetId, 'boardStills');
  const job = makeJob(jobId, authorization, item, {
    status: 'succeeded',
    providerJobId: `remote_${jobId}`,
    remoteStartedAt: timestamp,
    purpose: 'board_still',
    outputAssetIds: [asset.id],
    outputAssetIdsByRole: { primary: asset.id, poster: null },
    spendReceipt: {
      authorizationId: authorization.id,
      itemId: item.id,
      jobId,
      purpose: 'board_still',
      routeId: item.routeId,
      currency: authorization.currency,
      rateUnit: 'generation',
      rateMinorUnits: item.rateMinorUnits,
      durationSeconds: null,
      generationCount: 1,
      totalMinorUnits: item.rateMinorUnits,
    },
  });
  project.spendAuthorizations.push(authorization);
  project.jobs[job.id] = job;
  shot.jobIds.push(job.id);
  shot.boardAssetId = asset.id;
  return asset;
};

const addWaitingAuthorizedSeedSelection = (
  project: StudioProjectV2
): { exactAsset: StudioAssetV2; unrelatedGeneratedAsset: StudioAssetV2; unrelatedImportedAsset: StudioAssetV2 } => {
  const projectRevision = project.revision - 1;
  const upstream = makeSeedItem(projectRevision, 'shot_1');
  const dependent = makeItem(projectRevision, 'shot_1', authorizedSeedPlan(upstream.id, 'shot_1'));
  const authorization = makeAuthorization('auth_waiting_seed', projectRevision, [upstream], [dependent]);
  project.spendAuthorizations.push(authorization);
  const exactAsset = addSucceededSeedJob(project, authorization, upstream, 'job_exact_seed', 'exact_seed');
  const waitingJob = makeJob('job_waiting_for_seed', authorization, dependent);
  project.jobs[waitingJob.id] = waitingJob;
  project.shots.shot_1!.jobIds.push(waitingJob.id);

  const historicalRevision = projectRevision - 1;
  const unrelatedItem = makeSeedItem(historicalRevision, 'shot_1');
  const unrelatedAuthorization = makeAuthorization('auth_unrelated_seed', historicalRevision, [unrelatedItem]);
  project.spendAuthorizations.push(unrelatedAuthorization);
  const unrelatedGeneratedAsset = addSucceededSeedJob(
    project,
    unrelatedAuthorization,
    unrelatedItem,
    'job_unrelated_seed',
    'unrelated_generated_seed'
  );
  const unrelatedImportedAsset = addImageAsset(project, 'shot_1', 'unrelated_imported_seed');
  return { exactAsset, unrelatedGeneratedAsset, unrelatedImportedAsset };
};

const addSucceededVideoTake = (
  project: StudioProjectV2,
  shotId: string,
  assetId: string,
  _selected: boolean
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
      generationCount: 1,
      totalMinorUnits: 10,
    },
  });
  project.spendAuthorizations.push(authorization);
  project.jobs[job.id] = job;
  shot.jobIds.push(job.id);
  if (shot.videoAssetId !== null) shot.supersededVideoAssetIds.push(shot.videoAssetId);
  shot.videoAssetId = asset.id;
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
      generationCount: 1,
      totalMinorUnits: 10,
    },
  });
  const dependentJob = makeJob('job_dependent', authorization, dependent);
  project.spendAuthorizations.push(authorization);
  project.jobs[upstreamJob.id] = upstreamJob;
  project.jobs[dependentJob.id] = dependentJob;
  upstreamShot.jobIds.push(upstreamJob.id);
  upstreamShot.videoAssetId = take.id;
  project.shots.shot_2!.jobIds.push(dependentJob.id);
  return take;
};

const addFrameExtraction = (
  project: StudioProjectV2,
  shotId: string,
  status: 'pending' | 'ready'
): { extractionId: string; frameAssetId: string | null } => {
  const shot = project.shots[shotId]!;
  const takeId = shot.videoAssetId!;
  const take = project.assets[takeId]!;
  const endpointSeconds = take.durationSeconds!;
  const extractionId = createStudioFrameExtractionId({ shotId, videoAssetId: takeId, endpointSeconds });
  const frameAssetId = status === 'ready' ? `frame_${shotId}` : null;
  if (frameAssetId !== null) {
    project.assets[frameAssetId] = makeImageAsset(frameAssetId, shotId, 'conditioningFrames');
    shot.assetIds.push(frameAssetId);
  }
  project.frameExtractions[extractionId] = {
    id: extractionId,
    shotId,
    videoAssetId: takeId,
    endpointSeconds,
    frameAssetId,
    status,
    errorCode: null,
  };
  return { extractionId, frameAssetId };
};

const bindWaitingDependent = (project: StudioProjectV2): StudioJobV2 => {
  const take = addWaitingDependentOnOnlyTake(project);
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
  project.shots[dependent.shotId]!.videoAssetId = take.id;
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
    generationCount: 1,
    totalMinorUnits: 10,
  };
  return dependent;
};

const mutationBatch = (project: StudioProjectV2, operations: StudioMutationOperationV2[]): StudioMutationBatchV2 => ({
  schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
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

const makeApprovedBackgroundSelectionProject = (): StudioProjectV2 => {
  const project = makeProject();
  project.beats.beat_2!.shotOrder = ['shot_3'];
  project.shots.shot_3 = makeShot('shot_3');
  const planned = persist(
    apply(
      project,
      [
        {
          kind: 'set_project_references',
          references: [
            {
              id: 'reference_character',
              kind: 'character',
              label: 'Ming',
              prompt: 'A careful engineer in a blue coat',
              shotIds: ['shot_1', 'shot_2', 'shot_3'],
            },
            {
              id: 'reference_workshop',
              kind: 'background',
              label: 'Workshop',
              prompt: 'A luminous paper workshop',
              shotIds: ['shot_1'],
            },
            {
              id: 'reference_rooftop',
              kind: 'background',
              label: 'Rooftop',
              prompt: 'A quiet rooftop at blue hour',
              shotIds: ['shot_2', 'shot_3'],
            },
          ],
        },
      ],
      'mutation_reference_choice_plan'
    ).project
  );
  planned.imageRouteId = 'image_route';
  addApprovedProjectReference(planned, 'reference_character', 'shot_1', 'asset_reference_character');
  addApprovedProjectReference(planned, 'reference_workshop', 'shot_1', 'asset_reference_workshop');
  addApprovedProjectReference(planned, 'reference_rooftop', 'shot_3', 'asset_reference_rooftop');
  expect(validateStudioProjectV2(planned)).toBe(true);
  return planned;
};

const FINAL_OPERATION_KINDS = [
  'edit_project',
  'set_brief',
  'set_rules',
  'set_project_references',
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
  'set_shot_background_reference',
  'promote_board_panel',
  'trim_shot',
  'redetach_line',
  'rederive_line',
  'restore_line',
  'reorder_bin',
  'set_routes',
  'set_spend_policy',
  'set_bed',
  'undo_last',
] as const satisfies readonly StudioMutationOperationV2['kind'][];

describe('applyStudioMutationBatchV2 final operation contract', () => {
  it('keeps the exact exhaustive 30-operation catalog', () => {
    expect(FINAL_OPERATION_KINDS).toHaveLength(30);
    expect(new Set(FINAL_OPERATION_KINDS).size).toBe(FINAL_OPERATION_KINDS.length);
  });

  it.each(['park_take', 'add_alternate_take', 'restore_take', 'select_take'] as const)(
    'refuses removed Take operation %s at the exact parser boundary',
    (kind) => {
      expect(validateStudioMutationOperationV2({ kind, shotId: 'shot_1', assetId: 'take_1' })).toBe(false);
    }
  );

  it('refuses the removed Match To operation at the exact parser boundary', () => {
    expect(validateStudioMutationOperationV2({ kind: 'set_match_to', shotId: null })).toBe(false);
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

  it('reconciles the full active reference plan while preserving same-ID durable authority', () => {
    const planned = persist(
      apply(
        makeProject(),
        [
          {
            kind: 'set_project_references',
            references: [
              {
                id: 'reference_character',
                kind: 'character',
                label: 'Ming',
                prompt: 'A careful engineer',
                shotIds: ['shot_1', 'shot_2'],
              },
              {
                id: 'reference_background',
                kind: 'background',
                label: 'Workshop',
                prompt: 'A luminous paper workshop',
                shotIds: ['shot_1', 'shot_2'],
              },
            ],
          },
        ],
        'mutation_reference_plan'
      ).project
    );
    const initialCharacter = structuredClone(planned.references.reference_character!);
    planned.imageRouteId = 'image_route';
    const candidateItem: StudioQuotedGeneration = {
      ...makeSeedItem(planned.revision - 1, 'shot_1'),
      id: createStudioQuotedGenerationId({
        projectId: planned.id,
        projectRevision: planned.revision - 1,
        shotId: 'shot_1',
        purpose: 'seed_still',
        projectReferenceId: 'reference_character',
      }),
      projectReferenceId: 'reference_character',
    };
    const candidateAuthorization = makeAuthorization('authorization_reference_candidate', planned.revision - 1, [
      candidateItem,
    ]);
    const candidateJob = makeJob('job_reference_candidate', candidateAuthorization, candidateItem, {
      projectReferenceId: 'reference_character',
      purpose: 'seed_still',
      status: 'failed',
      error: { code: 'provider_unavailable', messageKey: 'providerUnavailable' },
    });
    planned.spendAuthorizations.push(candidateAuthorization);
    planned.jobs[candidateJob.id] = candidateJob;
    planned.shots.shot_1!.jobIds.push(candidateJob.id);
    planned.references.reference_character!.candidateJobId = candidateJob.id;
    expect(validateStudioProjectV2(planned)).toBe(true);

    const reconciled = apply(
      planned,
      [
        {
          kind: 'set_project_references',
          references: [
            {
              id: 'reference_character',
              kind: 'character',
              label: 'Ming',
              prompt: 'A careful engineer in a blue coat',
              shotIds: ['shot_1'],
            },
            {
              id: 'reference_background',
              kind: 'background',
              label: 'Workshop',
              prompt: 'A luminous paper workshop',
              shotIds: ['shot_1', 'shot_2'],
            },
          ],
        },
      ],
      'mutation_reference_reconcile',
      '2026-08-17T00:00:02.000Z'
    );

    expect(reconciled.project.referenceOrder).toEqual(['reference_character', 'reference_background']);
    expect(reconciled.project.shots.shot_1!.referenceIds).toEqual(['reference_character', 'reference_background']);
    expect(reconciled.project.shots.shot_2!.referenceIds).toEqual(['reference_background']);
    expect(reconciled.project.references.reference_character).toMatchObject({
      candidateAssetId: null,
      candidateJobId: 'job_reference_candidate',
      approvedAssetId: null,
      supersededAssetIds: [],
      createdAt: initialCharacter.createdAt,
      updatedAt: '2026-08-17T00:00:02.000Z',
    });
  });

  it('sets one approved Shot background in canonical order while preserving character and approval authority', () => {
    const project = makeApprovedBackgroundSelectionProject();
    const referencesBefore = structuredClone(project.references);
    const jobsBefore = structuredClone(project.jobs);
    const authorizationsBefore = structuredClone(project.spendAuthorizations);
    const result = apply(
      project,
      [
        {
          kind: 'set_shot_background_reference',
          shotId: 'shot_1',
          referenceId: 'reference_rooftop',
        },
      ],
      'mutation_choose_background'
    );

    expect(result.project.shots.shot_1!.referenceIds).toEqual(['reference_character', 'reference_rooftop']);
    expect(Object.values(result.project.shots).some((shot) => shot.referenceIds.includes('reference_workshop'))).toBe(
      false
    );
    expect(validateStudioProjectV2({ ...result.project, revision: result.project.revision + 1 })).toBe(true);
    expect(result.project.references).toEqual(referencesBefore);
    expect(result.project.jobs).toEqual(jobsBefore);
    expect(result.project.spendAuthorizations).toEqual(authorizationsBefore);
    expect(result.project.undoHistory.at(-1)).toMatchObject({
      id: 'mutation_choose_background',
      label: 'set_shot_background_reference',
    });

    const undone = apply(
      persist(result.project),
      [{ kind: 'undo_last', entryId: 'mutation_choose_background' }],
      'mutation_undo_background_choice'
    );
    expect(undone.project.shots.shot_1!.referenceIds).toEqual(['reference_character', 'reference_workshop']);
  });

  it('fills a missing Shot background without exposing character selection', () => {
    const project = makeApprovedBackgroundSelectionProject();
    project.shots.shot_1!.referenceIds = ['reference_character'];
    expect(validateStudioProjectV2(project)).toBe(true);

    const result = apply(project, [
      {
        kind: 'set_shot_background_reference',
        shotId: 'shot_1',
        referenceId: 'reference_rooftop',
      },
    ]);

    expect(result.project.shots.shot_1!.referenceIds).toEqual(['reference_character', 'reference_rooftop']);
  });

  it('fails closed for a stale, unapproved, wrong-kind, inactive, or no-op background choice', () => {
    const project = makeApprovedBackgroundSelectionProject();
    const inactive = structuredClone(project);
    inactive.beats.beat_1!.shotOrder = ['shot_2'];
    inactive.bin.push({ kind: 'shot', beatId: 'beat_1', shotId: 'shot_1', reason: 'lifted' });
    expect(validateStudioProjectV2(inactive)).toBe(true);
    const unapproved = structuredClone(project);
    unapproved.references.reference_rooftop!.approvedAssetId = null;
    expect(validateStudioProjectV2(unapproved)).toBe(true);

    for (const [candidate, operation] of [
      [project, { kind: 'set_shot_background_reference', shotId: 'shot_1', referenceId: 'reference_missing' }],
      [project, { kind: 'set_shot_background_reference', shotId: 'shot_1', referenceId: 'reference_character' }],
      [project, { kind: 'set_shot_background_reference', shotId: 'shot_1', referenceId: 'reference_workshop' }],
      [unapproved, { kind: 'set_shot_background_reference', shotId: 'shot_1', referenceId: 'reference_rooftop' }],
      [inactive, { kind: 'set_shot_background_reference', shotId: 'shot_1', referenceId: 'reference_rooftop' }],
    ] as const) {
      expectReason(candidate, [operation], 'invalid_operation');
    }
  });

  it('blocks a background change across bound Shot work or a nonterminal reference candidate', () => {
    const bound = makeApprovedBackgroundSelectionProject();
    const item = makeSeedItem(bound.revision - 1, 'shot_1');
    const authorization = makeAuthorization('authorization_bound_background_choice', bound.revision - 1, [item]);
    const job = makeJob('job_bound_background_choice', authorization, item, { purpose: 'seed_still' });
    bound.spendAuthorizations.push(authorization);
    bound.jobs[job.id] = job;
    bound.shots.shot_1!.jobIds.push(job.id);
    expect(validateStudioProjectV2(bound)).toBe(true);
    expectReason(
      bound,
      [
        {
          kind: 'set_shot_background_reference',
          shotId: 'shot_1',
          referenceId: 'reference_rooftop',
        },
      ],
      'dependency_blocked',
      'mutation_bound_background_choice'
    );

    const candidate = makeApprovedBackgroundSelectionProject();
    const candidateItem: StudioQuotedGeneration = {
      ...makeSeedItem(candidate.revision, 'shot_1'),
      id: createStudioQuotedGenerationId({
        projectId: candidate.id,
        projectRevision: candidate.revision,
        shotId: 'shot_1',
        purpose: 'seed_still',
        projectReferenceId: 'reference_workshop',
      }),
      projectReferenceId: 'reference_workshop',
    };
    const candidateAuthorization = makeAuthorization('authorization_pending_reference_workshop', candidate.revision, [
      candidateItem,
    ]);
    const candidateJob = makeJob('job_pending_reference_workshop', candidateAuthorization, candidateItem, {
      purpose: 'seed_still',
      projectReferenceId: 'reference_workshop',
    });
    candidate.spendAuthorizations.push(candidateAuthorization);
    candidate.jobs[candidateJob.id] = candidateJob;
    candidate.shots.shot_1!.jobIds.push(candidateJob.id);
    candidate.references.reference_workshop!.candidateJobId = candidateJob.id;
    candidate.references.reference_workshop!.candidateAssetId = null;
    candidate.revision += 1;
    expect(validateStudioProjectV2(candidate)).toBe(true);
    expectReason(
      candidate,
      [
        {
          kind: 'set_shot_background_reference',
          shotId: 'shot_1',
          referenceId: 'reference_rooftop',
        },
      ],
      'dependency_blocked',
      'mutation_pending_reference_candidate'
    );
  });

  it('refuses to orphan a reference still assigned to a retained binned Shot', () => {
    const planned = persist(
      apply(makeProject(), [
        {
          kind: 'set_project_references',
          references: [
            {
              id: 'reference_character',
              kind: 'character',
              label: 'Ming',
              prompt: 'A careful engineer',
              shotIds: ['shot_2'],
            },
            {
              id: 'reference_background',
              kind: 'background',
              label: 'Workshop',
              prompt: 'A luminous paper workshop',
              shotIds: ['shot_1', 'shot_2'],
            },
          ],
        },
      ]).project
    );
    const parked = persist(
      apply(planned, [{ kind: 'park_shot', shotId: 'shot_2' }], 'mutation_park_referenced_shot').project
    );

    expectReason(
      parked,
      [
        {
          kind: 'set_project_references',
          references: [
            {
              id: 'reference_background',
              kind: 'background',
              label: 'Workshop',
              prompt: 'A luminous paper workshop',
              shotIds: ['shot_1'],
            },
          ],
        },
      ],
      'dependency_blocked',
      'mutation_orphan_binned_reference'
    );
  });

  it('sets the Board style through the exact project edit contract and restores it through undo', () => {
    const styled = apply(
      makeProject(),
      [{ kind: 'edit_project', changes: { boardStyle: 'line_art' } } as unknown as StudioMutationOperationV2],
      'mutation_board_style'
    );
    expect(styled.project.boardStyle).toBe('line_art');

    const undone = apply(
      persist(styled.project),
      [{ kind: 'undo_last', entryId: 'mutation_board_style' }],
      'mutation_undo_board_style'
    );
    expect(undone.project.boardStyle).toBeNull();
    expect(undone.project.undoHistory).toEqual([]);
  });

  it('refuses to clear the Board style once durable Board job history exists', () => {
    const project = makeProject();
    project.boardStyle = 'grey_tone';
    project.imageRouteId = 'image_route';
    const item = makeBoardItem(project.revision - 1, 'shot_1');
    const authorization = makeAuthorization('auth_board_history', project.revision - 1, [item]);
    const job = makeJob('job_board_history', authorization, item, {
      status: 'cancelled',
      purpose: 'board_still',
    });
    project.spendAuthorizations.push(authorization);
    project.jobs[job.id] = job;
    project.shots.shot_1!.jobIds.push(job.id);
    expect(validateStudioProjectV2(project)).toBe(true);

    expectReason(
      project,
      [{ kind: 'edit_project', changes: { boardStyle: null } } as unknown as StudioMutationOperationV2],
      'dependency_blocked',
      'mutation_clear_board_style'
    );
  });

  it('refuses an undo that would clear the Board style after terminal Board history', () => {
    const initial = makeProject();
    initial.imageRouteId = 'image_route';
    const project = persist(
      apply(
        initial,
        [{ kind: 'edit_project', changes: { boardStyle: 'line_art' } } as unknown as StudioMutationOperationV2],
        'mutation_board_style_before_history'
      ).project
    );
    const item = makeBoardItem(project.revision - 1, 'shot_1');
    const authorization = makeAuthorization('auth_terminal_board_after_style', project.revision - 1, [item]);
    const job = makeJob('job_terminal_board_after_style', authorization, item, {
      status: 'cancelled',
      purpose: 'board_still',
    });
    project.spendAuthorizations.push(authorization);
    project.jobs[job.id] = job;
    project.shots.shot_1!.jobIds.push(job.id);
    expect(validateStudioProjectV2(project)).toBe(true);

    expectReason(
      project,
      [{ kind: 'undo_last', entryId: 'mutation_board_style_before_history' }],
      'undo_conflict',
      'mutation_undo_board_style_after_history'
    );
  });

  it('allows a style-to-style undo after terminal Board history', () => {
    const initial = makeProject();
    initial.boardStyle = 'grey_tone';
    initial.imageRouteId = 'image_route';
    const project = persist(
      apply(
        initial,
        [{ kind: 'edit_project', changes: { boardStyle: 'line_art' } } as unknown as StudioMutationOperationV2],
        'mutation_board_style_change_before_history'
      ).project
    );
    const item = makeBoardItem(project.revision - 1, 'shot_1');
    const authorization = makeAuthorization('auth_terminal_board_after_style_change', project.revision - 1, [item]);
    const job = makeJob('job_terminal_board_after_style_change', authorization, item, {
      status: 'cancelled',
      purpose: 'board_still',
    });
    project.spendAuthorizations.push(authorization);
    project.jobs[job.id] = job;
    project.shots.shot_1!.jobIds.push(job.id);
    expect(validateStudioProjectV2(project)).toBe(true);

    const undone = apply(
      project,
      [{ kind: 'undo_last', entryId: 'mutation_board_style_change_before_history' }],
      'mutation_undo_board_style_change_after_history'
    );
    expect(undone.project.boardStyle).toBe('grey_tone');
    expect(undone.project.jobs).toEqual(project.jobs);
    expect(undone.project.spendAuthorizations).toEqual(project.spendAuthorizations);
    expect(undone.project.undoHistory).toEqual([]);
  });

  it('pins the exact current Board panel at a segment head without mutating Board history or chainBreak', () => {
    const project = makeProject();
    const panel = addSucceededBoardPanel(project, 'shot_1');
    const boardBefore = structuredClone({
      asset: project.assets[panel.id],
      boardAssetId: project.shots.shot_1!.boardAssetId,
      supersededBoardAssetIds: project.shots.shot_1!.supersededBoardAssetIds,
      job: project.jobs.job_board_shot_1,
      chainBreak: project.shots.shot_1!.chainBreak,
    });
    expect(validateStudioProjectV2(project)).toBe(true);

    const promoted = apply(
      project,
      [{ kind: 'promote_board_panel', shotId: 'shot_1', boardAssetId: panel.id }],
      'mutation_promote_board'
    );

    expect(promoted.project.shots.shot_1).toMatchObject({
      seedStillId: panel.id,
      boardAssetId: boardBefore.boardAssetId,
      supersededBoardAssetIds: boardBefore.supersededBoardAssetIds,
      chainBreak: boardBefore.chainBreak,
    });
    expect(promoted.project.assets[panel.id]).toEqual(boardBefore.asset);
    expect(promoted.project.jobs.job_board_shot_1).toEqual(boardBefore.job);
    expect(promoted.project.undoHistory.at(-1)).toMatchObject({
      id: 'mutation_promote_board',
      label: 'promote_board_panel',
      patches: [{ kind: 'shot_fields', shotId: 'shot_1' }],
    });

    const undone = apply(
      persist(promoted.project),
      [{ kind: 'undo_last', entryId: 'mutation_promote_board' }],
      'mutation_undo_promote_board'
    );
    expect(undone.project.shots.shot_1).toMatchObject({
      seedStillId: null,
      boardAssetId: panel.id,
      chainBreak: 'none',
    });
    expect(undone.project.assets[panel.id]).toEqual(boardBefore.asset);
  });

  it('refuses to undo a Board promotion while new video work references its segment', () => {
    const project = makeProject();
    const panel = addSucceededBoardPanel(project, 'shot_1');
    const promoted = persist(
      apply(
        project,
        [{ kind: 'promote_board_panel', shotId: 'shot_1', boardAssetId: panel.id }],
        'mutation_promote_before_video'
      ).project
    );

    const item = makeItem(promoted.revision - 1, 'shot_1', resolvedPlan({ kind: 'seed_still', assetId: panel.id }));
    const authorization = makeAuthorization('auth_video_after_promotion', promoted.revision - 1, [item]);
    const job = makeJob('job_video_after_promotion', authorization, item);
    promoted.spendAuthorizations.push(authorization);
    promoted.jobs[job.id] = job;
    promoted.shots.shot_1!.jobIds.push(job.id);
    expect(validateStudioProjectV2(promoted)).toBe(true);

    expectReason(
      promoted,
      [{ kind: 'undo_last', entryId: 'mutation_promote_before_video' }],
      'undo_conflict',
      'mutation_undo_promote_during_video'
    );
    expect(promoted.shots.shot_1!.seedStillId).toBe(panel.id);
  });

  it('permits an explicit hard-cut segment head but rejects an ordinary non-head Shot', () => {
    const hardCut = makeProject();
    hardCut.shots.shot_2!.chainBreak = 'hard_cut';
    const hardCutPanel = addSucceededBoardPanel(hardCut, 'shot_2');
    expect(validateStudioProjectV2(hardCut)).toBe(true);
    expect(
      apply(hardCut, [{ kind: 'promote_board_panel', shotId: 'shot_2', boardAssetId: hardCutPanel.id }]).project.shots
        .shot_2
    ).toMatchObject({ seedStillId: hardCutPanel.id, chainBreak: 'hard_cut' });

    const nonHead = makeProject();
    const nonHeadPanel = addSucceededBoardPanel(nonHead, 'shot_2');
    expect(validateStudioProjectV2(nonHead)).toBe(true);
    expectReason(
      nonHead,
      [{ kind: 'promote_board_panel', shotId: 'shot_2', boardAssetId: nonHeadPanel.id }],
      'invalid_operation',
      'mutation_promote_non_head'
    );
  });

  it('rejects a mismatched, stale, already pinned, mixed, or nonterminal Board promotion', () => {
    const mismatch = makeProject();
    const current = addSucceededBoardPanel(mismatch, 'shot_1');
    expectReason(
      mismatch,
      [{ kind: 'promote_board_panel', shotId: 'shot_1', boardAssetId: 'other_board' }],
      'invalid_operation',
      'mutation_promote_mismatch'
    );

    const stale = structuredClone(mismatch);
    stale.shots.shot_1!.line = 'The Board request changed after the panel was drawn';
    expect(validateStudioProjectV2(stale)).toBe(true);
    expectReason(
      stale,
      [{ kind: 'promote_board_panel', shotId: 'shot_1', boardAssetId: current.id }],
      'invalid_operation',
      'mutation_promote_stale'
    );

    const alreadyPinned = structuredClone(mismatch);
    alreadyPinned.shots.shot_1!.seedStillId = current.id;
    expect(validateStudioProjectV2(alreadyPinned)).toBe(true);
    expectReason(
      alreadyPinned,
      [{ kind: 'promote_board_panel', shotId: 'shot_1', boardAssetId: current.id }],
      'invalid_operation',
      'mutation_promote_noop'
    );

    expectReason(
      mismatch,
      [
        { kind: 'promote_board_panel', shotId: 'shot_1', boardAssetId: current.id },
        { kind: 'edit_shot', shotId: 'shot_1', changes: { narration: 'mixed' } },
      ],
      'invalid_operation',
      'mutation_promote_mixed'
    );

    const inFlight = structuredClone(mismatch);
    const item = makeBoardItem(inFlight.revision - 2, 'shot_1');
    const authorization = makeAuthorization('auth_board_redraw', inFlight.revision - 2, [item]);
    const job = makeJob('job_board_redraw', authorization, item, { purpose: 'board_still' });
    inFlight.spendAuthorizations.push(authorization);
    inFlight.jobs[job.id] = job;
    inFlight.shots.shot_1!.jobIds.push(job.id);
    expect(validateStudioProjectV2(inFlight)).toBe(true);
    expectReason(
      inFlight,
      [{ kind: 'promote_board_panel', shotId: 'shot_1', boardAssetId: current.id }],
      'dependency_blocked',
      'mutation_promote_in_flight'
    );

    const downstreamInFlight = structuredClone(mismatch);
    const downstreamItem = makeBoardItem(downstreamInFlight.revision - 2, 'shot_2');
    const downstreamAuthorization = makeAuthorization('auth_downstream_board_redraw', downstreamInFlight.revision - 2, [
      downstreamItem,
    ]);
    const downstreamJob = makeJob('job_downstream_board_redraw', downstreamAuthorization, downstreamItem, {
      purpose: 'board_still',
    });
    downstreamInFlight.spendAuthorizations.push(downstreamAuthorization);
    downstreamInFlight.jobs[downstreamJob.id] = downstreamJob;
    downstreamInFlight.shots.shot_2!.jobIds.push(downstreamJob.id);
    expect(validateStudioProjectV2(downstreamInFlight)).toBe(true);
    expectReason(
      downstreamInFlight,
      [{ kind: 'promote_board_panel', shotId: 'shot_1', boardAssetId: current.id }],
      'dependency_blocked',
      'mutation_promote_downstream_in_flight'
    );

    const pendingFrame = structuredClone(mismatch);
    addSucceededVideoTake(pendingFrame, 'shot_1', 'take_before_promotion', true);
    addFrameExtraction(pendingFrame, 'shot_1', 'pending');
    expect(validateStudioProjectV2(pendingFrame)).toBe(true);
    expectReason(
      pendingFrame,
      [{ kind: 'promote_board_panel', shotId: 'shot_1', boardAssetId: current.id }],
      'dependency_blocked',
      'mutation_promote_pending_frame'
    );
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

  it('applies ordered Shot creation, editing, reorder, and dependency-free deletion', () => {
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
      { kind: 'delete_shot', shotId: 'shot_2' },
    ]);

    expect(result.createdShotIds).toEqual(['shot_3']);
    expect(result.project.beats.beat_1!.shotOrder).toEqual(['shot_1', 'shot_3']);
    expect(result.project.shots).not.toHaveProperty('shot_2');
    expect(result.project.shots.shot_3).toMatchObject({
      line: 'New shot',
      narration: 'Voice',
      chainBreak: 'none',
      derivation: 'derived',
    });
  });

  it.each([
    { label: 'sever', chainBreak: 'none' as const, hardCut: true },
    { label: 'rejoin', chainBreak: 'hard_cut' as const, hardCut: false },
  ])('refuses a free $label transition byte-for-byte', ({ chainBreak, hardCut }) => {
    const project = makeProject();
    project.shots.shot_2!.chainBreak = chainBreak;

    expectReason(
      project,
      [{ kind: 'set_hard_cut', shotId: 'shot_2', hardCut }],
      'invalid_operation',
      `mutation_refuse_${hardCut ? 'sever' : 'rejoin'}`
    );
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

  it('applies seed, route, spend, and bed settings through exact final fields', () => {
    const project = makeProject();
    addImageAsset(project, 'shot_1', 'seed_1');
    project.assets.bed_1 = makeAudioAsset('bed_1');
    const result = apply(project, [
      { kind: 'set_seed_still', shotId: 'shot_1', assetId: 'seed_1' },
      { kind: 'set_routes', imageRouteId: 'image_route', videoRouteId: 'video_route' },
      { kind: 'set_spend_policy', policy: { currency: 'USD', maxPerBatchMinorUnits: 500 } },
      { kind: 'set_bed', assetId: 'bed_1' },
    ]);

    expect(result.project).toMatchObject({
      imageRouteId: 'image_route',
      videoRouteId: 'video_route',
      spendPolicy: { currency: 'USD', maxPerBatchMinorUnits: 500 },
      bedAssetId: 'bed_1',
      shots: { shot_1: { seedStillId: 'seed_1' } },
    });
  });

  it('keeps an authorized-seed waiter null until its exact upstream primary is selected', () => {
    const project = makeProject();
    const { exactAsset, unrelatedGeneratedAsset, unrelatedImportedAsset } = addWaitingAuthorizedSeedSelection(project);
    expect(validateStudioProjectV2(project)).toBe(true);

    expectReason(
      project,
      [{ kind: 'set_seed_still', shotId: 'shot_1', assetId: unrelatedImportedAsset.id }],
      'dependency_blocked',
      'mutation_reject_unrelated_imported_seed'
    );
    expectReason(
      project,
      [{ kind: 'set_seed_still', shotId: 'shot_1', assetId: unrelatedGeneratedAsset.id }],
      'dependency_blocked',
      'mutation_reject_unrelated_generated_seed'
    );
    expect(project.shots.shot_1!.seedStillId).toBeNull();

    const repairedProject = structuredClone(project);
    repairedProject.shots.shot_1!.seedStillId = unrelatedImportedAsset.id;
    expect(validateStudioProjectV2(repairedProject)).toBe(true);
    const repaired = apply(
      repairedProject,
      [{ kind: 'set_seed_still', shotId: 'shot_1', assetId: null }],
      'mutation_repair_waiting_seed_to_null'
    );
    expect(repaired.project.shots.shot_1!.seedStillId).toBeNull();

    const selected = apply(
      project,
      [{ kind: 'set_seed_still', shotId: 'shot_1', assetId: exactAsset.id }],
      'mutation_select_exact_authorized_seed'
    );
    expect(selected.project.shots.shot_1!.seedStillId).toBe(exactAsset.id);
    expect(selected.project.jobs.job_waiting_for_seed).toMatchObject({
      status: 'waiting_for_conditioning',
      requestSnapshot: null,
    });
  });

  it('trims the canonical current video picture without a selection mutation', () => {
    const project = makeProject();
    addSucceededVideoTake(project, 'shot_1', 'take_video', false);
    expect(validateStudioProjectV2(project)).toBe(true);
    const result = apply(project, [{ kind: 'trim_shot', shotId: 'shot_1', trimInSeconds: 1, trimOutSeconds: 2 }]);

    expect(result.project.shots.shot_1).toMatchObject({
      videoAssetId: 'take_video',
      trimInSeconds: 1,
      trimOutSeconds: 2,
    });
  });
});

describe('applyStudioMutationBatchV2 coverage and fixed shots', () => {
  const everyFixedReason = [
    'owned_asset',
    'owned_job',
    'video_asset',
    'seed_still',
    'conditioning_frame',
    'conditioning_input',
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

  it('refuses coverage that introduces a new hard-cut head byte-for-byte', () => {
    const project = makeProject();

    expectReason(
      project,
      [
        {
          kind: 'apply_coverage',
          beatId: 'beat_1',
          shots: [
            proposed(project.shots.shot_1!),
            {
              shotId: 'shot_3',
              line: 'New segment',
              narration: '',
              onScreenText: '',
              durationSeconds: 5,
              chainBreak: 'hard_cut',
            },
          ],
          fixedShots: [],
        },
      ],
      'invalid_operation',
      'mutation_refuse_new_hard_cut'
    );
  });

  it.each([
    { label: 'sever', before: 'none' as const, after: 'hard_cut' as const },
    { label: 'rejoin', before: 'hard_cut' as const, after: 'none' as const },
  ])('refuses coverage that would $label an existing Shot byte-for-byte', ({ before, after }) => {
    const project = makeProject();
    project.shots.shot_2!.chainBreak = before;

    expectReason(
      project,
      [
        {
          kind: 'apply_coverage',
          beatId: 'beat_1',
          shots: [proposed(project.shots.shot_1!), { ...proposed(project.shots.shot_2!), chainBreak: after }],
          fixedShots: [],
        },
      ],
      'invalid_operation',
      `mutation_refuse_coverage_${before}_${after}`
    );
  });

  it('retains canonical hard-cut data while applying non-chain coverage edits', () => {
    const project = makeProject();
    project.shots.shot_2!.chainBreak = 'hard_cut';

    const result = apply(project, [
      {
        kind: 'apply_coverage',
        beatId: 'beat_1',
        shots: [
          proposed(project.shots.shot_1!),
          { ...proposed(project.shots.shot_2!), line: 'Revised without changing continuity' },
        ],
        fixedShots: [],
      },
    ]);

    expect(result.project.shots.shot_2).toMatchObject({
      line: 'Revised without changing continuity',
      chainBreak: 'hard_cut',
    });
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

  it('derives all eight fixed reasons in canonical order and preserves the exact paid Shot through re-split', () => {
    const project = makeProject();
    const fixed = project.shots.shot_1!;
    fixed.narration = 'Persistent narration';
    fixed.onScreenText = 'Persistent title';
    addSucceededVideoTake(project, fixed.id, 'fixed_take', true);
    addFrameExtraction(project, fixed.id, 'ready');
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
              reasons: ['owned_asset', 'owned_job', 'video_asset', 'conditioning_frame', 'conditioning_input'],
            },
            {
              shotId: 'shot_3',
              reasons: ['owned_asset', 'owned_job', 'video_asset'],
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

  it('refuses any undo while a bound Board job is nonterminal', () => {
    const initial = makeProject();
    initial.boardStyle = 'grey_tone';
    initial.imageRouteId = 'image_route';
    const project = persist(
      apply(initial, [{ kind: 'set_brief', brief: 'Undoable before Board work' }], 'mutation_before_board').project
    );
    const item = makeBoardItem(project.revision - 1, 'shot_1');
    const authorization = makeAuthorization('auth_board_after_mutation', project.revision - 1, [item]);
    const job = makeJob('job_board_after_mutation', authorization, item, { purpose: 'board_still' });
    project.spendAuthorizations.push(authorization);
    project.jobs[job.id] = job;
    project.shots.shot_1!.jobIds.push(job.id);
    expect(validateStudioProjectV2(project)).toBe(true);

    expectReason(
      project,
      [{ kind: 'undo_last', entryId: 'mutation_before_board' }],
      'undo_conflict',
      'mutation_undo_board_bound'
    );
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

  it('refuses a legacy exact undo patch that would rejoin a hard-cut Shot', () => {
    const project = makeProject();
    const current = project.shots.shot_2!;
    current.chainBreak = 'hard_cut';
    project.undoHistory = [
      {
        id: 'legacy_hard_cut_undo',
        sourceRevision: project.revision,
        label: 'set_hard_cut',
        patches: [
          {
            kind: 'shot_fields',
            shotId: current.id,
            before: { ...authoredShot(current), chainBreak: 'none' },
            beforeBeatId: 'beat_1',
            beforeIndex: 1,
            afterDigest: authoredDigest({ value: authoredShot(current), beatId: 'beat_1', index: 1 }),
          },
        ],
      },
    ];
    expect(validateStudioProjectV2(project)).toBe(true);

    expectReason(
      project,
      [{ kind: 'undo_last', entryId: 'legacy_hard_cut_undo' }],
      'undo_conflict',
      'mutation_refuse_legacy_hard_cut_undo'
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
  it('blocks image-route and destructive Shot edits while a Board job is nonterminal', () => {
    const project = makeProject();
    project.boardStyle = 'grey_tone';
    project.imageRouteId = 'image_route';
    const item = makeBoardItem(project.revision - 1, 'shot_1');
    const authorization = makeAuthorization('auth_board_inflight', project.revision - 1, [item]);
    const job = makeJob('job_board_inflight', authorization, item, { purpose: 'board_still' });
    project.spendAuthorizations.push(authorization);
    project.jobs[job.id] = job;
    project.shots.shot_1!.jobIds.push(job.id);
    expect(validateStudioProjectV2(project)).toBe(true);

    expectReason(
      project,
      [{ kind: 'set_routes', imageRouteId: 'image_route_changed', videoRouteId: null }],
      'dependency_blocked',
      'board_image_route'
    );
    expectReason(
      project,
      [{ kind: 'edit_project', changes: { boardStyle: 'line_art' } } as unknown as StudioMutationOperationV2],
      'dependency_blocked',
      'board_style'
    );
    expectReason(project, [{ kind: 'park_shot', shotId: 'shot_1' }], 'dependency_blocked', 'board_park_shot');
    expectReason(project, [{ kind: 'park_beat', beatId: 'beat_1' }], 'dependency_blocked', 'board_park_beat');
    expectReason(project, [{ kind: 'delete_shot', shotId: 'shot_1' }], 'dependency_blocked', 'board_delete_shot');
    expectReason(
      project,
      [{ kind: 'edit_beat', beatId: 'beat_1', changes: { action: 'Changed while drawing' } }],
      'dependency_blocked',
      'board_action'
    );

    const videoRouteOnly = apply(
      project,
      [{ kind: 'set_routes', imageRouteId: 'image_route', videoRouteId: 'video_route' }],
      'mutation_board_video_route'
    ).project;
    expect(videoRouteOnly.videoRouteId).toBe('video_route');
  });

  it('rejects Shot parking when its owner Beat is retained only in the Bin', () => {
    const project = makeProject();
    project.beatOrder = ['beat_2'];
    project.bin.push({ kind: 'beat', beatId: 'beat_1', reason: 'lifted' });
    expect(validateStudioProjectV2(project)).toBe(true);
    const before = JSON.stringify(project);

    expectReason(project, [{ kind: 'park_shot', shotId: 'shot_1' }], 'invalid_operation', 'mutation_binned_beat_shot');
    expect(JSON.stringify(project)).toBe(before);
  });

  it('parks terminal paid Shot lineage without dropping any asset, job, authorization, or current picture', () => {
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

  it('refuses in-flight blockers before changing a Shot or containing Beat', () => {
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
});

describe('applyStudioMutationBatchV2 bounds, totality, and rollback', () => {
  it('validates every alternate exact operation branch without invoking the reducer', () => {
    const validOperations: unknown[] = [
      ...(['9:16', '1:1', '4:3', '3:4'] as const).map((aspectRatio) => ({
        kind: 'edit_project',
        changes: { aspectRatio },
      })),
      { kind: 'edit_project', changes: { resolution: '720p' } },
      ...(['grey_tone', 'line_art', 'colour_key'] as const).map((boardStyle) => ({
        kind: 'edit_project',
        changes: { boardStyle },
      })),
      { kind: 'edit_project', changes: { boardStyle: null } },
      { kind: 'edit_project', changes: { targetDurationSeconds: 5 } },
      { kind: 'edit_project', changes: { targetDurationSeconds: 1440 } },
      { kind: 'edit_beat', beatId: 'beat_1', changes: { targetSeconds: 1 } },
      { kind: 'edit_beat', beatId: 'beat_1', changes: { targetSeconds: 1440 } },
      { kind: 'set_rules', rules: [{ id: 'rule_null', text: 'A rule', predicate: null }] },
      {
        kind: 'set_project_references',
        references: [
          {
            id: 'reference_unassigned',
            kind: 'background',
            label: 'Unassigned location',
            prompt: 'A preserved location with no current Shot assignment',
            shotIds: [],
          },
        ],
      },
      { kind: 'set_shot_background_reference', shotId: 'shot_1', referenceId: 'reference_background' },
      {
        kind: 'reorder_bin',
        bin: [
          { kind: 'beat', beatId: 'beat_1', reason: 'alternate' },
          { kind: 'shot', beatId: 'beat_1', shotId: 'shot_1', reason: 'lifted' },
        ],
      },
      { kind: 'set_routes', imageRouteId: null, videoRouteId: null },
      { kind: 'set_spend_policy', policy: null },
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
      { kind: 'edit_project', changes: { boardStyle: 'photoreal' } },
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
      { kind: 'set_shot_background_reference', shotId: '../shot', referenceId: 'reference_background' },
      { kind: 'set_shot_background_reference', shotId: 'shot_1', referenceId: '../reference' },
      { kind: 'set_shot_background_reference', shotId: 'shot_1', referenceId: 'reference_background', extra: true },
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
      { kind: 'set_match_to', shotId: null },
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
        {
          schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
          projectId: project.id,
          expectedRevision: project.revision,
          operations: sparseOperations,
        },
        { mutationId: 'mutation_sparse', capturedAt: laterTimestamp }
      )
    ).toThrowError(StudioMutationErrorV2);
    expect(project).toEqual(before);
  });
});
