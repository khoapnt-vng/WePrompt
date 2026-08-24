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
  STUDIO_MAX_BIN_BEAT_ITEMS,
  STUDIO_MAX_BIN_SHOT_ITEMS,
  STUDIO_MAX_LINE_HISTORY_PER_BEAT,
  STUDIO_MAX_SHOTS_PER_BEAT,
  STUDIO_MAX_SHOTS_PER_PROJECT,
  STUDIO_MAX_UNDO_ENTRIES,
  STUDIO_MAX_UNDO_PATCHES_PER_ENTRY,
  STUDIO_PROJECT_SCHEMA_VERSION,
  type StudioAssetV2,
  type StudioBeat,
  type StudioConditioningInputSnapshot,
  type StudioFixedShotReasonV2,
  type StudioGenerationRequestPlan,
  type StudioJobV2,
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
  validateStudioFixedShotReviewV2,
  validateStudioFixedShotReviewsV2,
  validateStudioProjectV2,
  validateStudioProposedShotV2,
} from '@/process/services/creative-studio/service/schema2/validation';
import { createStudioSpendReceiptV2 } from '@/process/services/creative-studio/service/schema2/pricing';

const timestamp = '2026-08-17T00:00:00.000Z';
const confirmedAt = '2026-08-17T00:00:01.000Z';
const expiresAt = '2026-08-17T00:05:00.000Z';
const digest = 'a'.repeat(64);
const provider = { providerId: 'provider_1', adapterId: 'weprompt-image-v1', model: 'model_1' } as const;

const makeShot = (id: string, overrides: Partial<StudioShot> = {}): StudioShot => ({
  id,
  line: '',
  derivation: 'derived',
  derivedFromActionRevision: 1,
  narration: '',
  onScreenText: '',
  durationSeconds: 8,
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

const makeProject = (projectId = 'project_1'): StudioProjectV2 => ({
  schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
  revision: 1,
  id: projectId,
  name: `Project ${projectId}`,
  brief: '',
  rules: [],
  briefConversationId: null,
  aspectRatio: '16:9',
  targetDurationSeconds: 30,
  resolution: '1080p',
  boardStyle: null,
  beatOrder: ['beat_1'],
  beats: { beat_1: makeBeat('beat_1', ['shot_1']) },
  shots: { shot_1: makeShot('shot_1') },
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

const makeImageAsset = (
  id: string,
  shotId: string | null,
  collection: StudioAssetV2['managedAsset']['collection'] = 'assets',
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

const makeVideoAsset = (id: string, shotId: string | null = 'shot_1', durationSeconds = 10): StudioAssetV2 => ({
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

const makeAudioAsset = (id: string, shotId: string | null = null): StudioAssetV2 => ({
  id,
  projectId: 'project_1',
  shotId,
  mediaKind: 'audio',
  mimeType: 'audio/wav',
  managedAsset: { collection: 'imports', fileName: `${id}.wav` },
  byteSize: 1,
  sha256: digest,
  durationSeconds: 30,
  createdAt: timestamp,
});

const seedPlan = (referenceInput: { assetId: string; sha256: string } | null = null): StudioGenerationRequestPlan => ({
  kind: 'resolved',
  snapshot: {
    prompt: 'seed prompt',
    aspectRatio: '16:9',
    resolution: '1080p',
    durationSeconds: 8,
    referenceInputs: referenceInput === null ? [] : [referenceInput],
    conditioningInput: null,
  },
});

const boardPlan = (): StudioGenerationRequestPlan => ({
  kind: 'resolved',
  snapshot: {
    prompt: 'board prompt',
    aspectRatio: '16:9',
    resolution: '1080p',
    durationSeconds: 4,
    referenceInputs: [],
    conditioningInput: null,
  },
});

const referencedBoardPlan = (): StudioGenerationRequestPlan => {
  const plan = boardPlan();
  if (plan.kind !== 'resolved') throw new Error('expected resolved Board plan');
  plan.snapshot.referenceInputs = [{ assetId: 'reference_1', sha256: digest }];
  return plan;
};

const conditionedBoardPlan = (): StudioGenerationRequestPlan => {
  const plan = boardPlan();
  if (plan.kind !== 'resolved') throw new Error('expected resolved Board plan');
  plan.snapshot.conditioningInput = { kind: 'seed_still', assetId: 'seed_1' };
  return plan;
};

const deferredBoardPlan = (): StudioGenerationRequestPlan => ({
  kind: 'after_take_selection',
  template: {
    prompt: 'deferred board prompt',
    aspectRatio: '16:9',
    resolution: '1080p',
    durationSeconds: 8,
    referenceInputs: [],
  },
  dependency: { kind: 'authorized_seed', upstreamItemId: 'seed_item_1', shotId: 'shot_1' },
});

const videoPlan = (conditioningInput: StudioConditioningInputSnapshot): StudioGenerationRequestPlan => ({
  kind: 'resolved',
  snapshot: {
    prompt: 'video prompt',
    aspectRatio: '16:9',
    resolution: '1080p',
    durationSeconds: 8,
    referenceInputs: [],
    conditioningInput,
  },
});

const deferredVideoPlan = (upstreamItemId: string, predecessorShotId: string): StudioGenerationRequestPlan => ({
  kind: 'after_take_selection',
  template: {
    prompt: 'deferred video prompt',
    aspectRatio: '16:9',
    resolution: '1080p',
    durationSeconds: 8,
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
  purpose: StudioQuotedGeneration['purpose'],
  requestPlan: StudioGenerationRequestPlan,
  generationCount = 1,
  projectId = 'project_1'
): StudioQuotedGeneration => ({
  id: createStudioQuotedGenerationId({ projectId, projectRevision, shotId, purpose }),
  shotId,
  purpose,
  routeId: purpose === 'video_take' ? 'video_route' : 'image_route',
  generationCount,
  requestPlan,
  rateUnit: purpose === 'video_take' ? 'second' : 'generation',
  rateMinorUnits: 2,
});

const makeAuthorization = (
  id: string,
  projectRevision: number,
  baseItems: StudioQuotedGeneration[],
  cascadeItems: StudioQuotedGeneration[] = [],
  projectId = 'project_1'
): StudioSpendAuthorization => {
  const items = [...baseItems, ...cascadeItems];
  const totals = calculateStudioQuoteTotals(items)!;
  return {
    id,
    projectId,
    projectRevision,
    originReferenceHandoffId: null,
    rateCardDigest: 'b'.repeat(64),
    currency: 'USD',
    baseItems,
    cascadeItems,
    lowerMinorUnits: totals.lowerMinorUnits,
    upperMinorUnits: totals.upperMinorUnits,
    expiresAt,
    confirmedAt,
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
  projectId: authorization.projectId,
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
  purpose: item.purpose,
  authorizationId: authorization.id,
  authorizationItemId: item.id,
  requestPlan: item.requestPlan,
  requestSnapshot: item.requestPlan.kind === 'resolved' ? item.requestPlan.snapshot : null,
  spendReceipt: null,
  outputAssetIdsByRole: { primary: null, poster: null },
  ...overrides,
});

const addAuthorizationWithJobs = (
  project: StudioProjectV2,
  authorization: StudioSpendAuthorization,
  jobs: StudioJobV2[]
): void => {
  project.revision = Math.max(project.revision, authorization.projectRevision + 1);
  project.spendAuthorizations.push(authorization);
  for (const job of jobs) {
    project.jobs[job.id] = job;
    project.shots[job.shotId]!.jobIds.push(job.id);
  }
};

const addFailedSeedAuthorization = (
  project: StudioProjectV2,
  authorizationId: string,
  originReferenceHandoffId: string | null,
  retryOfJobId: string | null = null
): StudioJobV2 => {
  const item = makeItem(project.revision, 'shot_1', 'seed_still', seedPlan(), 1, project.id);
  const authorization = makeAuthorization(authorizationId, project.revision, [item], [], project.id);
  authorization.originReferenceHandoffId = originReferenceHandoffId;
  const job = makeJob(`job_${authorizationId}`, authorization, item, {
    status: 'failed',
    error: { code: 'timeout', messageKey: 'timeout' },
    retryOfJobId,
    retryReason: retryOfJobId === null ? null : 'provider_failure',
  });
  addAuthorizationWithJobs(project, authorization, [job]);
  return job;
};

const addProjectReferenceRetryLineage = (
  project: StudioProjectV2,
  predecessorOverrides: Partial<StudioJobV2>,
  retryOverrides: Partial<StudioJobV2>
): { predecessor: StudioJobV2; retry: StudioJobV2 } => {
  const referenceId = 'ref_background';
  project.referenceOrder = [referenceId];
  project.references[referenceId] = {
    id: referenceId,
    kind: 'background',
    label: 'City skyline',
    prompt: 'A recurring city skyline.',
    candidateAssetId: null,
    candidateJobId: null,
    approvedAssetId: null,
    supersededAssetIds: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  project.shots.shot_1!.referenceIds = [referenceId];

  const predecessorRevision = project.revision;
  const predecessorItem = makeItem(predecessorRevision, 'shot_1', 'seed_still', seedPlan(), 1, project.id);
  predecessorItem.projectReferenceId = referenceId;
  predecessorItem.id = createStudioQuotedGenerationId({
    projectId: project.id,
    projectRevision: predecessorRevision,
    shotId: 'shot_1',
    purpose: 'seed_still',
    projectReferenceId: referenceId,
  });
  const predecessorAuthorization = makeAuthorization(
    'auth_reference_predecessor',
    predecessorRevision,
    [predecessorItem],
    [],
    project.id
  );
  const predecessor = makeJob('job_reference_predecessor', predecessorAuthorization, predecessorItem, {
    projectReferenceId: referenceId,
    ...predecessorOverrides,
  });
  addAuthorizationWithJobs(project, predecessorAuthorization, [predecessor]);

  const retryRevision = project.revision;
  const retryItem = makeItem(retryRevision, 'shot_1', 'seed_still', seedPlan(), 1, project.id);
  retryItem.projectReferenceId = referenceId;
  retryItem.id = createStudioQuotedGenerationId({
    projectId: project.id,
    projectRevision: retryRevision,
    shotId: 'shot_1',
    purpose: 'seed_still',
    projectReferenceId: referenceId,
  });
  const retryAuthorization = makeAuthorization('auth_reference_retry', retryRevision, [retryItem], [], project.id);
  const retry = makeJob('job_reference_retry', retryAuthorization, retryItem, {
    projectReferenceId: referenceId,
    retryOfJobId: predecessor.id,
    ...retryOverrides,
  });
  addAuthorizationWithJobs(project, retryAuthorization, [retry]);
  project.references[referenceId]!.candidateJobId = retry.id;
  return { predecessor, retry };
};

const addHumanSeed = (project: StudioProjectV2, shotId = 'shot_1', assetId = 'seed_1'): StudioAssetV2 => {
  const asset = makeImageAsset(assetId, shotId, 'imports');
  project.assets[assetId] = asset;
  project.shots[shotId]!.assetIds.push(assetId);
  return asset;
};

const addSucceededVideoTake = (project: StudioProjectV2, shotId = 'shot_1', assetId = 'take_1'): StudioAssetV2 => {
  const shot = project.shots[shotId]!;
  const seedId = `seed_${shotId}`;
  const seed = project.assets[seedId] ?? addHumanSeed(project, shotId, seedId);
  shot.seedStillId = seed.id;
  const projectRevision = project.revision;
  const item = makeItem(projectRevision, shotId, 'video_take', videoPlan({ kind: 'seed_still', assetId: seed.id }));
  const authorization = makeAuthorization(`auth_${projectRevision}`, projectRevision, [item]);
  const asset = makeVideoAsset(assetId, shotId);
  project.assets[asset.id] = asset;
  shot.assetIds.push(asset.id);
  const jobId = `job_${projectRevision}`;
  const job = makeJob(jobId, authorization, item, {
    status: 'succeeded',
    providerJobId: `remote_${projectRevision}`,
    remoteStartedAt: timestamp,
    outputAssetIds: [asset.id],
    outputAssetIdsByRole: { primary: asset.id, poster: null },
    spendReceipt: {
      authorizationId: authorization.id,
      itemId: item.id,
      jobId,
      purpose: item.purpose,
      routeId: item.routeId,
      currency: authorization.currency,
      rateUnit: item.rateUnit,
      rateMinorUnits: item.rateMinorUnits,
      durationSeconds: 8,
      generationCount: 1,
      totalMinorUnits: 16,
    },
  });
  addAuthorizationWithJobs(project, authorization, [job]);
  if (shot.videoAssetId !== null) shot.supersededVideoAssetIds.push(shot.videoAssetId);
  shot.videoAssetId = asset.id;
  return asset;
};

const addSucceededBoardStill = (project: StudioProjectV2, shotId = 'shot_1', assetId = 'board_1'): StudioAssetV2 => {
  const shot = project.shots[shotId]!;
  project.boardStyle ??= 'grey_tone';
  const projectRevision = project.revision;
  const item = makeItem(projectRevision, shotId, 'board_still', boardPlan(), 1, project.id);
  const authorization = makeAuthorization(`auth_board_${projectRevision}`, projectRevision, [item], [], project.id);
  const asset = makeImageAsset(assetId, shotId, 'boardStills', { projectId: project.id });
  project.assets[asset.id] = asset;
  shot.assetIds.push(asset.id);
  const jobId = `job_board_${projectRevision}`;
  const job = makeJob(jobId, authorization, item, {
    status: 'succeeded',
    providerJobId: `remote_board_${projectRevision}`,
    remoteStartedAt: timestamp,
    outputAssetIds: [asset.id],
    outputAssetIdsByRole: { primary: asset.id, poster: null },
    spendReceipt: {
      authorizationId: authorization.id,
      itemId: item.id,
      jobId,
      purpose: item.purpose,
      routeId: item.routeId,
      currency: authorization.currency,
      rateUnit: item.rateUnit,
      rateMinorUnits: item.rateMinorUnits,
      durationSeconds: null,
      generationCount: 1,
      totalMinorUnits: item.rateMinorUnits,
    },
  });
  addAuthorizationWithJobs(project, authorization, [job]);
  if (shot.boardAssetId !== null) shot.supersededBoardAssetIds.push(shot.boardAssetId);
  shot.boardAssetId = asset.id;
  return asset;
};

const addFailedBoardRedraw = (project: StudioProjectV2, shotId = 'shot_1'): StudioJobV2 => {
  const projectRevision = project.revision;
  const item = makeItem(projectRevision, shotId, 'board_still', boardPlan(), 1, project.id);
  const authorization = makeAuthorization(`auth_board_${projectRevision}`, projectRevision, [item], [], project.id);
  const job = makeJob(`job_board_${projectRevision}`, authorization, item, {
    status: 'failed',
    error: { code: 'timeout', messageKey: 'timeout' },
  });
  addAuthorizationWithJobs(project, authorization, [job]);
  return job;
};

const addFailedAuthorizationGraph = (
  project: StudioProjectV2,
  baseItems: StudioQuotedGeneration[],
  cascadeItems: StudioQuotedGeneration[] = [],
  originReferenceHandoffId: string | null = null
): void => {
  const authorization = makeAuthorization(
    `auth_hostile_${project.revision}`,
    project.revision,
    baseItems,
    cascadeItems,
    project.id
  );
  authorization.originReferenceHandoffId = originReferenceHandoffId;
  const jobs = [...baseItems, ...cascadeItems].map((item, index) =>
    makeJob(`job_hostile_${index + 1}`, authorization, item, {
      status: 'failed',
      error: { code: 'timeout', messageKey: 'timeout' },
    })
  );
  addAuthorizationWithJobs(project, authorization, jobs);
};

const addReadyFrame = (project: StudioProjectV2, takeId = 'take_1', endpointSeconds = 10): string => {
  const frameId = createStudioFrameExtractionId({ shotId: 'shot_1', videoAssetId: takeId, endpointSeconds });
  const frameAssetId = `frame_asset_${endpointSeconds}`;
  project.assets[frameAssetId] = makeImageAsset(frameAssetId, 'shot_1', 'conditioningFrames');
  project.shots.shot_1!.assetIds.push(frameAssetId);
  project.frameExtractions[frameId] = {
    id: frameId,
    shotId: 'shot_1',
    videoAssetId: takeId,
    endpointSeconds,
    frameAssetId,
    status: 'ready',
    errorCode: null,
  };
  return frameAssetId;
};

const makeWaitingDependencyProject = (): StudioProjectV2 => {
  const project = makeProject();
  project.beats.beat_1!.shotOrder.push('shot_2');
  project.shots.shot_2 = makeShot('shot_2');
  addHumanSeed(project);
  const upstream = makeItem(1, 'shot_1', 'video_take', videoPlan({ kind: 'seed_still', assetId: 'seed_1' }), 1);
  const dependent = makeItem(1, 'shot_2', 'video_take', deferredVideoPlan(upstream.id, 'shot_1'));
  const authorization = makeAuthorization('auth_waiting_take', 1, [upstream], [dependent]);
  const asset = makeVideoAsset('take_1');
  project.assets[asset.id] = asset;
  project.shots.shot_1!.assetIds.push(asset.id);
  const upstreamJob = makeJob('job_upstream', authorization, upstream, {
    status: 'succeeded',
    providerJobId: 'remote_upstream',
    remoteStartedAt: timestamp,
    outputAssetIds: [asset.id],
    outputAssetIdsByRole: { primary: asset.id, poster: null },
    spendReceipt: {
      authorizationId: authorization.id,
      itemId: upstream.id,
      jobId: 'job_upstream',
      purpose: upstream.purpose,
      routeId: upstream.routeId,
      currency: authorization.currency,
      rateUnit: upstream.rateUnit,
      rateMinorUnits: upstream.rateMinorUnits,
      durationSeconds: 8,
      generationCount: 1,
      totalMinorUnits: 16,
    },
  });
  addAuthorizationWithJobs(project, authorization, [upstreamJob, makeJob('job_dependent', authorization, dependent)]);
  project.shots.shot_1!.videoAssetId = asset.id;
  return project;
};

const addShots = (project: StudioProjectV2, beatId: string, count: number, offset = 0): void => {
  const beat = project.beats[beatId]!;
  for (let index = 0; index < count; index += 1) {
    const shotId = `shot_${offset + index + 1}`;
    beat.shotOrder.push(shotId);
    project.shots[shotId] = makeShot(shotId);
  }
};

describe('validateStudioProjectV2 exact project and authorship contract', () => {
  it('accepts only the exact current-schema Board shape and leaves schema 3 unsupported', () => {
    const legacy = structuredClone(makeProject()) as unknown as Record<string, unknown>;
    legacy.schemaVersion = 3;
    delete legacy.boardStyle;
    const legacyShots = legacy.shots as Record<string, Record<string, unknown>>;
    delete legacyShots.shot_1!.boardAssetId;
    delete legacyShots.shot_1!.supersededBoardAssetIds;
    expect(validateStudioProjectV2(legacy)).toBe(false);
    expect(validateStudioProjectV2(makeProject())).toBe(true);
  });

  it('accepts only the three exact Board styles', () => {
    for (const style of ['grey_tone', 'line_art', 'colour_key'] as const) {
      const project = makeProject();
      project.boardStyle = style;
      expect(validateStudioProjectV2(project)).toBe(true);
    }
    const project = makeProject();
    (project as unknown as { boardStyle: string | null }).boardStyle = 'watercolour';
    expect(validateStudioProjectV2(project)).toBe(false);
  });

  it('accepts the minimal project and an empty-coverage Beat with null or authored target', () => {
    const project = makeProject();
    project.beats.beat_1!.shotOrder = [];
    project.shots = {};
    expect(validateStudioProjectV2(project)).toBe(true);
    project.beats.beat_1!.targetSeconds = 180;
    expect(validateStudioProjectV2(project)).toBe(true);
  });

  it.each([
    ['project', (project: StudioProjectV2) => Object.assign(project, { unexpected: true })],
    ['legacy Match To field', (project: StudioProjectV2) => Object.assign(project, { matchToShotId: null })],
    ['Beat', (project: StudioProjectV2) => Object.assign(project.beats.beat_1!, { unexpected: true })],
    ['Shot', (project: StudioProjectV2) => Object.assign(project.shots.shot_1!, { unexpected: true })],
    [
      'Bin item',
      (project: StudioProjectV2) => {
        project.beatOrder = [];
        project.bin = [{ kind: 'beat', beatId: 'beat_1', reason: 'lifted', unexpected: true } as never];
      },
    ],
  ])('rejects unknown keys on the %s', (_label, mutate) => {
    const project = makeProject();
    mutate(project);
    expect(validateStudioProjectV2(project)).toBe(false);
  });

  it('accepts target duration 1440 and rejects 1441', () => {
    const project = makeProject();
    project.targetDurationSeconds = 1440;
    expect(validateStudioProjectV2(project)).toBe(true);
    project.targetDurationSeconds = 1441;
    expect(validateStudioProjectV2(project)).toBe(false);
  });

  it('enforces derived/detached revision combinations against the owner Beat', () => {
    const project = makeProject();
    project.beats.beat_1!.actionRevision = 3;
    project.shots.shot_1!.derivedFromActionRevision = 3;
    expect(validateStudioProjectV2(project)).toBe(true);
    project.shots.shot_1!.derivedFromActionRevision = 4;
    expect(validateStudioProjectV2(project)).toBe(false);

    project.shots.shot_1 = makeShot('shot_1', { derivation: 'detached', derivedFromActionRevision: null });
    expect(validateStudioProjectV2(project)).toBe(true);
    project.shots.shot_1!.derivedFromActionRevision = 1;
    expect(validateStudioProjectV2(project)).toBe(false);
  });

  it('accepts history ordinal 8 after shrink and rejects 0 and 9', () => {
    const project = makeProject();
    project.beats.beat_1!.lineHistory = [{ id: 'history_1', shotOrdinal: 8, text: 'old line', capturedAt: timestamp }];
    expect(validateStudioProjectV2(project)).toBe(true);
    project.beats.beat_1!.lineHistory[0]!.shotOrdinal = 0;
    expect(validateStudioProjectV2(project)).toBe(false);
    project.beats.beat_1!.lineHistory[0]!.shotOrdinal = 9;
    expect(validateStudioProjectV2(project)).toBe(false);
  });

  it('rejects an explicit seed pin on a non-heading Shot', () => {
    const project = makeProject();
    project.beats.beat_1!.shotOrder.push('shot_2');
    project.shots.shot_2 = makeShot('shot_2');
    project.shots.shot_2!.seedStillId = addHumanSeed(project, 'shot_2', 'seed_2').id;
    expect(validateStudioProjectV2(project)).toBe(false);
  });
});

describe('validateStudioProjectV2 total ownership and capacities', () => {
  it('accepts 24 total Beats and rejects 25', () => {
    const project = makeProject();
    project.beatOrder = [];
    project.beats = {};
    project.shots = {};
    for (let index = 1; index <= STUDIO_MAX_BEATS; index += 1) {
      const beatId = `beat_${index}`;
      project.beats[beatId] = makeBeat(beatId);
      project.beatOrder.push(beatId);
    }
    expect(validateStudioProjectV2(project)).toBe(true);
    project.beats.beat_25 = makeBeat('beat_25');
    project.beatOrder.push('beat_25');
    expect(validateStudioProjectV2(project)).toBe(false);
  });

  it('accepts 8 active Shots per Beat and rejects 9', () => {
    const project = makeProject();
    project.beats.beat_1!.shotOrder = [];
    project.shots = {};
    addShots(project, 'beat_1', STUDIO_MAX_SHOTS_PER_BEAT);
    expect(validateStudioProjectV2(project)).toBe(true);
    addShots(project, 'beat_1', 1, STUDIO_MAX_SHOTS_PER_BEAT);
    expect(validateStudioProjectV2(project)).toBe(false);
  });

  it('accepts 96 total active Shots and rejects 97', () => {
    const project = makeProject();
    project.beatOrder = [];
    project.beats = {};
    project.shots = {};
    for (let beatIndex = 0; beatIndex < 12; beatIndex += 1) {
      const beatId = `beat_${beatIndex + 1}`;
      project.beatOrder.push(beatId);
      project.beats[beatId] = makeBeat(beatId);
      addShots(project, beatId, 8, beatIndex * 8);
    }
    expect(validateStudioProjectV2(project)).toBe(true);
    project.beatOrder.push('beat_13');
    project.beats.beat_13 = makeBeat('beat_13');
    addShots(project, 'beat_13', 1, STUDIO_MAX_SHOTS_PER_PROJECT);
    expect(validateStudioProjectV2(project)).toBe(false);
  });

  it('enforces the Beat Bin maximum at N and N+1', () => {
    const project = makeProject();
    project.beatOrder = [];
    project.beats = {};
    project.shots = {};
    for (let index = 1; index <= STUDIO_MAX_BIN_BEAT_ITEMS; index += 1) {
      const beatId = `beat_${index}`;
      project.beats[beatId] = makeBeat(beatId);
      project.bin.push({ kind: 'beat', beatId, reason: 'lifted' });
    }
    expect(validateStudioProjectV2(project)).toBe(true);
    project.beats.beat_25 = makeBeat('beat_25');
    project.bin.push({ kind: 'beat', beatId: 'beat_25', reason: 'lifted' });
    expect(validateStudioProjectV2(project)).toBe(false);
  });

  it('enforces the Shot Bin maximum while counting each record once', () => {
    const project = makeProject();
    project.beats.beat_1!.shotOrder = [];
    project.shots = {};
    for (let index = 1; index <= STUDIO_MAX_BIN_SHOT_ITEMS; index += 1) {
      const shotId = `shot_${index}`;
      project.shots[shotId] = makeShot(shotId);
      project.bin.push({ kind: 'shot', beatId: 'beat_1', shotId, reason: 'lifted' });
    }
    expect(validateStudioProjectV2(project)).toBe(true);
    project.shots.shot_97 = makeShot('shot_97');
    project.bin.push({ kind: 'shot', beatId: 'beat_1', shotId: 'shot_97', reason: 'lifted' });
    expect(validateStudioProjectV2(project)).toBe(false);
  });

  it('enforces line history at 20 and 21 entries', () => {
    const project = makeProject();
    project.beats.beat_1!.lineHistory = Array.from({ length: STUDIO_MAX_LINE_HISTORY_PER_BEAT }, (_, index) => ({
      id: `history_${index}`,
      shotOrdinal: 8,
      text: '',
      capturedAt: timestamp,
    }));
    expect(validateStudioProjectV2(project)).toBe(true);
    project.beats.beat_1!.lineHistory.push({ id: 'history_21', shotOrdinal: 1, text: '', capturedAt: timestamp });
    expect(validateStudioProjectV2(project)).toBe(false);
  });

  it.each([4, 15])('accepts Shot duration %i', (durationSeconds) => {
    const project = makeProject();
    project.shots.shot_1!.durationSeconds = durationSeconds;
    expect(validateStudioProjectV2(project)).toBe(true);
  });

  it.each([3, 16])('rejects Shot duration %i', (durationSeconds) => {
    const project = makeProject();
    project.shots.shot_1!.durationSeconds = durationSeconds;
    expect(validateStudioProjectV2(project)).toBe(false);
  });

  it('rejects active-and-binned Beat and Shot identities', () => {
    const beatOverlap = makeProject();
    beatOverlap.bin.push({ kind: 'beat', beatId: 'beat_1', reason: 'lifted' });
    expect(validateStudioProjectV2(beatOverlap)).toBe(false);
    const shotOverlap = makeProject();
    shotOverlap.bin.push({ kind: 'shot', beatId: 'beat_1', shotId: 'shot_1', reason: 'lifted' });
    expect(validateStudioProjectV2(shotOverlap)).toBe(false);
  });

  it('rejects duplicate Shot ownership and orphan asset/job reverse links', () => {
    const duplicate = makeProject();
    duplicate.beatOrder.push('beat_2');
    duplicate.beats.beat_2 = makeBeat('beat_2', ['shot_1']);
    expect(validateStudioProjectV2(duplicate)).toBe(false);

    const orphanAsset = makeProject();
    orphanAsset.assets.seed_1 = makeImageAsset('seed_1', 'shot_1', 'imports');
    expect(validateStudioProjectV2(orphanAsset)).toBe(false);

    const orphanJob = makeProject();
    addSucceededVideoTake(orphanJob);
    orphanJob.shots.shot_1!.jobIds = [];
    expect(validateStudioProjectV2(orphanJob)).toBe(false);
  });
});

describe('validateStudioProjectV2 media, trim, and frame lineage', () => {
  it('accepts only canonical project-owned Brief images and bed audio', () => {
    const project = makeProject();
    project.assets.cast_1 = makeImageAsset('cast_1', null, 'imports', {
      briefReferenceRole: 'cast',
      briefReferenceLabel: 'Lead',
    });
    project.assets.bed_1 = makeAudioAsset('bed_1');
    project.bedAssetId = 'bed_1';
    expect(validateStudioProjectV2(project)).toBe(true);
    project.assets.video_1 = makeVideoAsset('video_1', null);
    expect(validateStudioProjectV2(project)).toBe(false);
  });

  it.each([
    ['a non-WAV MIME type', (asset: StudioAssetV2) => (asset.mimeType = 'audio/mpeg')],
    ['a noncanonical managed name', (asset: StudioAssetV2) => (asset.managedAsset.fileName = 'foreign.wav')],
    ['zero managed bytes', (asset: StudioAssetV2) => (asset.byteSize = 0)],
    ['visual dimensions', (asset: StudioAssetV2) => (asset.width = 1)],
    ['visual source-look metadata', (asset: StudioAssetV2) => (asset.sourceLook = 'not audio metadata')],
  ])('rejects selected bed audio with %s', (_label, mutate) => {
    const project = makeProject();
    const bed = makeAudioAsset('bed_1');
    mutate(bed);
    project.assets.bed_1 = bed;
    project.bedAssetId = 'bed_1';
    expect(validateStudioProjectV2(project)).toBe(false);
  });

  it('accepts an unclassified human seed import and rejects shot-owned audio', () => {
    const project = makeProject();
    addHumanSeed(project);
    expect(validateStudioProjectV2(project)).toBe(true);
    project.assets.audio_1 = makeAudioAsset('audio_1', 'shot_1');
    project.shots.shot_1!.assetIds.push('audio_1');
    expect(validateStudioProjectV2(project)).toBe(false);
  });

  it('requires video/audio duration, forbids image duration, and rejects 1e308', () => {
    const imageDuration = makeProject();
    addHumanSeed(imageDuration).durationSeconds = 1;
    expect(validateStudioProjectV2(imageDuration)).toBe(false);
    const hugeAudio = makeProject();
    hugeAudio.assets.bed_1 = makeAudioAsset('bed_1');
    hugeAudio.assets.bed_1!.durationSeconds = 1e308;
    expect(validateStudioProjectV2(hugeAudio)).toBe(false);
    const missingAudio = makeProject();
    const audio = makeAudioAsset('bed_1');
    delete audio.durationSeconds;
    missingAudio.assets.bed_1 = audio;
    expect(validateStudioProjectV2(missingAudio)).toBe(false);
  });

  it('accepts one current 10-second video picture with an 8-second Shot plan', () => {
    const project = makeProject();
    addSucceededVideoTake(project);
    expect(validateStudioProjectV2(project)).toBe(true);
  });

  it('accepts only canonical Board art as an explicit first-frame pin and still requires its selected style', () => {
    const project = makeProject();
    const board = addSucceededBoardStill(project);
    expect(validateStudioProjectV2(project)).toBe(true);

    project.boardStyle = null;
    expect(validateStudioProjectV2(project)).toBe(false);
    project.boardStyle = 'grey_tone';
    project.shots.shot_1!.seedStillId = board.id;
    expect(validateStudioProjectV2(project)).toBe(true);
    board.managedAsset.collection = 'assets';
    expect(validateStudioProjectV2(project)).toBe(false);
  });

  it('rejects a persisted authorization that mixes Board and seed work', () => {
    const project = makeProject();
    project.boardStyle = 'grey_tone';
    addFailedAuthorizationGraph(project, [
      makeItem(project.revision, 'shot_1', 'board_still', boardPlan()),
      makeItem(project.revision, 'shot_1', 'seed_still', seedPlan()),
    ]);

    expect(validateStudioProjectV2(project)).toBe(false);
  });

  it('rejects a persisted Board cascade authorization', () => {
    const project = makeProject();
    project.boardStyle = 'grey_tone';
    project.beats.beat_1!.shotOrder.push('shot_2');
    project.shots.shot_2 = makeShot('shot_2');
    addFailedAuthorizationGraph(
      project,
      [makeItem(project.revision, 'shot_1', 'board_still', boardPlan())],
      [makeItem(project.revision, 'shot_2', 'board_still', boardPlan())]
    );

    expect(validateStudioProjectV2(project)).toBe(false);
  });

  it('rejects a persisted Board authorization with a reference-handoff origin', () => {
    const project = makeProject();
    project.boardStyle = 'grey_tone';
    addFailedAuthorizationGraph(
      project,
      [makeItem(project.revision, 'shot_1', 'board_still', boardPlan())],
      [],
      'handoff_1'
    );

    expect(validateStudioProjectV2(project)).toBe(false);
  });

  it.each([
    ['deferred', deferredBoardPlan],
    ['referenced', referencedBoardPlan],
    ['conditioned', conditionedBoardPlan],
  ] as const)('rejects a persisted %s Board request', (_label, makePlan) => {
    const project = makeProject();
    project.boardStyle = 'grey_tone';
    addFailedAuthorizationGraph(project, [makeItem(project.revision, 'shot_1', 'board_still', makePlan())]);

    expect(validateStudioProjectV2(project)).toBe(false);
  });

  it('rejects a persisted Board authority with a noncanonical plumbing duration', () => {
    const project = makeProject();
    project.boardStyle = 'grey_tone';
    const plan = boardPlan();
    if (plan.kind !== 'resolved') throw new Error('expected resolved Board plan');
    plan.snapshot.durationSeconds = 5;
    addFailedAuthorizationGraph(project, [makeItem(project.revision, 'shot_1', 'board_still', plan)]);

    expect(validateStudioProjectV2(project)).toBe(false);
  });

  it('derives current and superseded Board pointers from successful jobs in immutable order', () => {
    const project = makeProject();
    addSucceededBoardStill(project, 'shot_1', 'board_1');
    addSucceededBoardStill(project, 'shot_1', 'board_2');
    expect(project.shots.shot_1).toMatchObject({
      boardAssetId: 'board_2',
      supersededBoardAssetIds: ['board_1'],
    });
    expect(validateStudioProjectV2(project)).toBe(true);

    project.shots.shot_1!.supersededBoardAssetIds = [];
    expect(validateStudioProjectV2(project)).toBe(false);
    project.shots.shot_1!.supersededBoardAssetIds = ['board_1'];
    project.shots.shot_1!.boardAssetId = 'board_1';
    expect(validateStudioProjectV2(project)).toBe(false);
  });

  it('keeps the published Board pointer unchanged when a paid redraw fails', () => {
    const project = makeProject();
    addSucceededBoardStill(project);
    addFailedBoardRedraw(project);
    expect(project.shots.shot_1).toMatchObject({ boardAssetId: 'board_1', supersededBoardAssetIds: [] });
    expect(validateStudioProjectV2(project)).toBe(true);
  });

  it('binds a successful Board output and receipt to the immutable paid image item', () => {
    const project = makeProject();
    addSucceededBoardStill(project);
    expect(validateStudioProjectV2(project)).toBe(true);
    project.jobs.job_board_1!.spendReceipt!.durationSeconds = 8;
    expect(validateStudioProjectV2(project)).toBe(false);
  });

  it('requires the current picture and superseded history to follow successful video jobs in order', () => {
    const project = makeProject();
    addSucceededVideoTake(project, 'shot_1', 'video_1');
    addSucceededVideoTake(project, 'shot_1', 'video_2');
    expect(project.shots.shot_1).toMatchObject({
      videoAssetId: 'video_2',
      supersededVideoAssetIds: ['video_1'],
    });
    expect(validateStudioProjectV2(project)).toBe(true);

    project.shots.shot_1!.supersededVideoAssetIds = [];
    expect(validateStudioProjectV2(project)).toBe(false);
    project.shots.shot_1!.supersededVideoAssetIds = ['video_1'];
    project.shots.shot_1!.videoAssetId = 'video_1';
    expect(validateStudioProjectV2(project)).toBe(false);
  });

  it('validates trims against current picture duration, not planning duration', () => {
    const project = makeProject();
    addSucceededVideoTake(project);
    project.shots.shot_1!.trimInSeconds = 1;
    project.shots.shot_1!.trimOutSeconds = 1;
    expect(validateStudioProjectV2(project)).toBe(true);
    project.shots.shot_1!.trimOutSeconds = 9;
    expect(validateStudioProjectV2(project)).toBe(false);
    project.shots.shot_1!.trimOutSeconds = Number.NaN;
    expect(validateStudioProjectV2(project)).toBe(false);
    project.shots.shot_1!.trimOutSeconds = -0;
    expect(validateStudioProjectV2(project)).toBe(false);
  });

  it('rejects trims without a current canonical video picture', () => {
    const project = makeProject();
    project.shots.shot_1!.trimInSeconds = 1;
    expect(validateStudioProjectV2(project)).toBe(false);
  });

  it('validates ready and failed extraction state with deterministic identity', () => {
    const project = makeProject();
    addSucceededVideoTake(project);
    const frameAssetId = addReadyFrame(project);
    expect(validateStudioProjectV2(project)).toBe(true);
    const frame = Object.values(project.frameExtractions)[0]!;
    frame.id = 'frame_wrong';
    expect(validateStudioProjectV2(project)).toBe(false);
    frame.id = Object.keys(project.frameExtractions)[0]!;
    frame.status = 'failed';
    frame.frameAssetId = null;
    frame.errorCode = 'decode_failed';
    delete project.assets[frameAssetId];
    project.shots.shot_1!.assetIds = project.shots.shot_1!.assetIds.filter((id) => id !== frameAssetId);
    expect(validateStudioProjectV2(project)).toBe(true);
  });
});

describe('validateStudioProjectV2 paid graph and immutable request state', () => {
  it('accepts exact authorization/job/receipt binding and rejects ±1 tampering', () => {
    const project = makeProject();
    addSucceededVideoTake(project);
    expect(validateStudioProjectV2(project)).toBe(true);
    project.spendAuthorizations[0]!.upperMinorUnits += 1;
    expect(validateStudioProjectV2(project)).toBe(false);
    project.spendAuthorizations[0]!.upperMinorUnits -= 1;
    project.jobs.job_1!.spendReceipt!.totalMinorUnits += 1;
    expect(validateStudioProjectV2(project)).toBe(false);
  });

  it('rejects missing/changed provider bindings and idempotency relations', () => {
    const project = makeProject();
    addSucceededVideoTake(project);
    const authorization = project.spendAuthorizations[0]!;
    authorization.providerBindings = [];
    expect(validateStudioProjectV2(project)).toBe(false);
    authorization.providerBindings = [{ itemId: authorization.baseItems[0]!.id, provider }];
    project.jobs.job_1!.provider = { ...provider, model: 'other' };
    expect(validateStudioProjectV2(project)).toBe(false);
    project.jobs.job_1!.provider = provider;
    authorization.idempotencyKeys[0]!.key = 'other_key';
    expect(validateStudioProjectV2(project)).toBe(false);
  });

  it('requires non-null reference handoff origins to be unique within each project only', () => {
    const duplicate = makeProject();
    const first = addFailedSeedAuthorization(duplicate, 'auth_origin_1', 'handoff_1');
    addFailedSeedAuthorization(duplicate, 'auth_origin_2', 'handoff_2', first.id);
    expect(validateStudioProjectV2(duplicate)).toBe(true);
    duplicate.spendAuthorizations[1]!.originReferenceHandoffId = 'handoff_1';
    expect(validateStudioProjectV2(duplicate)).toBe(false);

    const ordinary = makeProject();
    const ordinaryFirst = addFailedSeedAuthorization(ordinary, 'auth_ordinary_1', null);
    addFailedSeedAuthorization(ordinary, 'auth_ordinary_2', null, ordinaryFirst.id);
    expect(validateStudioProjectV2(ordinary)).toBe(true);

    const firstProject = makeProject('project_first');
    const secondProject = makeProject('project_second');
    addFailedSeedAuthorization(firstProject, 'auth_first', 'shared_handoff');
    addFailedSeedAuthorization(secondProject, 'auth_second', 'shared_handoff');
    expect(validateStudioProjectV2(firstProject)).toBe(true);
    expect(validateStudioProjectV2(secondProject)).toBe(true);
  });

  it.each([
    {
      label: 'cancelled candidate',
      predecessor: { status: 'cancelled', error: null },
      retry: {
        retryReason: 'provider_failure',
        duplicateChargeAcknowledged: false,
        duplicateChargeAcknowledgedAt: null,
      },
      invalidRetry: {
        retryReason: 'submission_unknown',
        duplicateChargeAcknowledged: true,
        duplicateChargeAcknowledgedAt: confirmedAt,
      },
    },
    {
      label: 'failed poll-deadline candidate',
      predecessor: {
        status: 'failed',
        error: { code: 'poll_deadline', messageKey: 'pollDeadline' },
        providerJobId: 'remote_reference_poll_deadline',
        remoteStartedAt: timestamp,
      },
      retry: {
        retryReason: 'submission_unknown',
        duplicateChargeAcknowledged: true,
        duplicateChargeAcknowledgedAt: confirmedAt,
      },
      invalidRetry: {
        retryReason: 'provider_failure',
        duplicateChargeAcknowledged: false,
        duplicateChargeAcknowledgedAt: null,
      },
    },
  ] as const)('accepts the exact paid lineage semantics for a project-reference $label', (entry) => {
    const project = makeProject();
    const { retry } = addProjectReferenceRetryLineage(project, entry.predecessor, entry.retry);
    expect(validateStudioProjectV2(project)).toBe(true);

    Object.assign(retry, entry.invalidRetry);
    expect(validateStudioProjectV2(project)).toBe(false);
  });

  it('requires project-reference needs-attention work to recover or terminalize before paid lineage', () => {
    const project = makeProject();
    const { predecessor } = addProjectReferenceRetryLineage(
      project,
      {
        status: 'needs_attention',
        error: { code: 'submission_unknown', messageKey: 'submissionUnknown' },
      },
      {
        retryReason: 'submission_unknown',
        duplicateChargeAcknowledged: true,
        duplicateChargeAcknowledgedAt: confirmedAt,
      }
    );
    expect(validateStudioProjectV2(project)).toBe(false);

    predecessor.status = 'failed';
    expect(validateStudioProjectV2(project)).toBe(true);
  });

  it('decouples project-reference proxy ownership from composition and rejects duplicate live work globally', () => {
    const terminal = makeProject();
    addProjectReferenceRetryLineage(
      terminal,
      { status: 'failed', error: { code: 'timeout', messageKey: 'timeout' } },
      {
        status: 'failed',
        error: { code: 'timeout', messageKey: 'timeout' },
        retryReason: 'provider_failure',
        duplicateChargeAcknowledged: false,
        duplicateChargeAcknowledgedAt: null,
      }
    );
    terminal.shots.shot_1!.referenceIds = [];
    expect(validateStudioProjectV2(terminal)).toBe(true);

    const nonterminal = makeProject();
    addProjectReferenceRetryLineage(
      nonterminal,
      { status: 'failed', error: { code: 'timeout', messageKey: 'timeout' } },
      {
        retryReason: 'provider_failure',
        duplicateChargeAcknowledged: false,
        duplicateChargeAcknowledgedAt: null,
      }
    );
    nonterminal.shots.shot_1!.referenceIds = [];
    expect(validateStudioProjectV2(nonterminal)).toBe(true);

    nonterminal.beats.beat_1!.shotOrder.push('shot_2');
    nonterminal.shots.shot_2 = makeShot('shot_2');
    const duplicateRevision = nonterminal.revision;
    const duplicateItem = makeItem(duplicateRevision, 'shot_2', 'seed_still', seedPlan(), 1, nonterminal.id);
    duplicateItem.projectReferenceId = 'ref_background';
    duplicateItem.id = createStudioQuotedGenerationId({
      projectId: nonterminal.id,
      projectRevision: duplicateRevision,
      shotId: 'shot_2',
      purpose: 'seed_still',
      projectReferenceId: 'ref_background',
    });
    const duplicateAuthorization = makeAuthorization(
      'auth_duplicate_live_reference',
      duplicateRevision,
      [duplicateItem],
      [],
      nonterminal.id
    );
    const duplicateJob = makeJob('job_duplicate_live_reference', duplicateAuthorization, duplicateItem, {
      projectReferenceId: 'ref_background',
    });
    addAuthorizationWithJobs(nonterminal, duplicateAuthorization, [duplicateJob]);
    expect(validateStudioProjectV2(nonterminal)).toBe(false);
  });

  it('keeps failed project-reference downloads on same-job recovery instead of paid lineage', () => {
    const project = makeProject();
    const { predecessor, retry } = addProjectReferenceRetryLineage(
      project,
      {
        status: 'failed',
        error: { code: 'download_failed', messageKey: 'downloadFailed' },
        providerJobId: 'remote_reference_download',
        remoteStartedAt: timestamp,
      },
      {
        retryReason: 'provider_failure',
        duplicateChargeAcknowledged: false,
        duplicateChargeAcknowledgedAt: null,
      }
    );
    const authorization = project.spendAuthorizations.find(
      (candidate) => candidate.id === predecessor.authorizationId
    )!;
    predecessor.spendReceipt = createStudioSpendReceiptV2({
      authorization,
      itemId: predecessor.authorizationItemId,
      jobId: predecessor.id,
    });
    expect(validateStudioProjectV2(project)).toBe(false);

    retry.retryOfJobId = null;
    retry.retryReason = null;
    expect(validateStudioProjectV2(project)).toBe(true);
  });

  it('preserves ordinary Shot failed submission-unknown retry validation', () => {
    const project = makeProject();
    const predecessorItem = makeItem(project.revision, 'shot_1', 'seed_still', seedPlan());
    const predecessorAuthorization = makeAuthorization('auth_ordinary_unknown', project.revision, [predecessorItem]);
    const predecessor = makeJob('job_ordinary_unknown', predecessorAuthorization, predecessorItem, {
      status: 'failed',
      error: { code: 'submission_unknown', messageKey: 'submissionUnknown' },
    });
    addAuthorizationWithJobs(project, predecessorAuthorization, [predecessor]);

    const retryItem = makeItem(project.revision, 'shot_1', 'seed_still', seedPlan());
    const retryAuthorization = makeAuthorization('auth_ordinary_unknown_retry', project.revision, [retryItem]);
    const retry = makeJob('job_ordinary_unknown_retry', retryAuthorization, retryItem, {
      retryOfJobId: predecessor.id,
      retryReason: 'submission_unknown',
      duplicateChargeAcknowledged: true,
      duplicateChargeAcknowledgedAt: confirmedAt,
    });
    addAuthorizationWithJobs(project, retryAuthorization, [retry]);
    expect(validateStudioProjectV2(project)).toBe(true);
  });

  it('requires receipts for succeeded/post-completion failures and rejects them precompletion', () => {
    const project = makeProject();
    addSucceededVideoTake(project);
    const job = project.jobs.job_1!;
    const receipt = job.spendReceipt;
    job.spendReceipt = null;
    expect(validateStudioProjectV2(project)).toBe(false);

    job.status = 'failed';
    job.error = { code: 'download_failed', messageKey: 'download_failed' };
    job.outputAssetIds = [];
    job.outputAssetIdsByRole = { primary: null, poster: null };
    delete project.assets.take_1;
    project.shots.shot_1!.assetIds = project.shots.shot_1!.assetIds.filter((id) => id !== 'take_1');
    project.shots.shot_1!.videoAssetId = null;
    job.spendReceipt = receipt;
    expect(validateStudioProjectV2(project)).toBe(true);
    job.error = {
      code: 'seed_still_variation_grid',
      messageKey: 'conversation.creativeStudio.jobs.errors.seedStillVariationGrid',
    };
    expect(validateStudioProjectV2(project)).toBe(false);
    job.error = { code: 'download_failed', messageKey: 'download_failed' };
    job.status = 'queued_local';
    job.error = null;
    expect(validateStudioProjectV2(project)).toBe(false);
  });

  it('requires the paid seed purpose and receipt for a variation-grid failure', () => {
    const project = makeProject();
    const job = addFailedSeedAuthorization(project, 'auth_grid', null);
    const authorization = project.spendAuthorizations[0]!;
    const item = authorization.baseItems[0]!;
    job.error = {
      code: 'seed_still_variation_grid',
      messageKey: 'conversation.creativeStudio.jobs.errors.seedStillVariationGrid',
    };
    job.spendReceipt = createStudioSpendReceiptV2({ authorization, itemId: item.id, jobId: job.id });
    expect(validateStudioProjectV2(project)).toBe(true);

    job.spendReceipt = null;
    expect(validateStudioProjectV2(project)).toBe(false);
  });

  it('requires a live exact Brief reference for nonterminal work but permits terminal detached history', () => {
    const project = makeProject();
    project.assets.reference_1 = makeImageAsset('reference_1', null, 'imports', {
      briefReferenceRole: 'look',
      briefReferenceLabel: 'Palette',
    });
    const item = makeItem(1, 'shot_1', 'seed_still', seedPlan({ assetId: 'reference_1', sha256: digest }));
    const authorization = makeAuthorization('auth_ref', 1, [item]);
    const job = makeJob('job_ref', authorization, item);
    addAuthorizationWithJobs(project, authorization, [job]);
    expect(validateStudioProjectV2(project)).toBe(true);
    project.assets.reference_1!.sha256 = 'c'.repeat(64);
    expect(validateStudioProjectV2(project)).toBe(false);
    delete project.assets.reference_1;
    expect(validateStudioProjectV2(project)).toBe(false);
    job.status = 'failed';
    job.error = { code: 'timeout', messageKey: 'timeout' };
    expect(validateStudioProjectV2(project)).toBe(true);
  });

  it('rejects quoted generation counts other than exactly one', () => {
    const project = makeProject();
    const item = makeItem(1, 'shot_1', 'seed_still', seedPlan());
    const authorization = makeAuthorization('auth_exact_one', 1, [item]);
    addAuthorizationWithJobs(project, authorization, [makeJob('job_exact_one', authorization, item)]);
    expect(validateStudioProjectV2(project)).toBe(true);
    item.generationCount = 2;
    expect(validateStudioProjectV2(project)).toBe(false);
  });

  it('keeps symbolic predecessor endpoints concrete-only and binds only the exact upstream item primary', () => {
    const project = makeWaitingDependencyProject();
    const predecessor = project.shots.shot_1!;
    predecessor.videoAssetId = 'take_1';
    const frameAssetId = addReadyFrame(project, 'take_1', 10);
    const dependent = project.jobs.job_dependent!;
    const template = dependent.requestPlan.kind === 'after_take_selection' ? dependent.requestPlan.template : null;
    dependent.status = 'queued_local';
    dependent.requestSnapshot = {
      ...template!,
      conditioningInput: {
        kind: 'predecessor_frame',
        predecessorShotId: predecessor.id,
        takeAssetId: 'take_1',
        frameAssetId,
        endpointSeconds: 10,
      },
    };
    expect(validateStudioProjectV2(project)).toBe(true);

    addSucceededVideoTake(project, predecessor.id, 'take_other_authorization');
    const otherFrameAssetId = addReadyFrame(project, 'take_other_authorization', 9);
    dependent.requestSnapshot = {
      ...template!,
      conditioningInput: {
        kind: 'predecessor_frame',
        predecessorShotId: predecessor.id,
        takeAssetId: 'take_other_authorization',
        frameAssetId: otherFrameAssetId,
        endpointSeconds: 9,
      },
    };
    expect(validateStudioProjectV2(project)).toBe(false);
  });

  it('requires a bound authorized seed to be the exact upstream item primary', () => {
    const project = makeProject();
    const upstream = makeItem(1, 'shot_1', 'seed_still', seedPlan());
    const dependentPlan: StudioGenerationRequestPlan = {
      kind: 'after_take_selection',
      template: {
        prompt: 'seed-dependent video prompt',
        aspectRatio: '16:9',
        resolution: '1080p',
        durationSeconds: 8,
        referenceInputs: [],
      },
      dependency: { kind: 'authorized_seed', upstreamItemId: upstream.id, shotId: 'shot_1' },
    };
    const dependentItem = makeItem(1, 'shot_1', 'video_take', dependentPlan);
    const authorization = makeAuthorization('auth_seed_dependency', 1, [upstream], [dependentItem]);
    const generatedSeed = makeImageAsset('seed_generated', 'shot_1', 'assets');
    project.assets[generatedSeed.id] = generatedSeed;
    project.shots.shot_1!.assetIds.push(generatedSeed.id);
    project.shots.shot_1!.seedStillId = generatedSeed.id;
    const upstreamJob = makeJob('job_seed_upstream', authorization, upstream, {
      status: 'succeeded',
      providerJobId: 'remote_seed_upstream',
      remoteStartedAt: timestamp,
      outputAssetIds: [generatedSeed.id],
      outputAssetIdsByRole: { primary: generatedSeed.id, poster: null },
      spendReceipt: {
        authorizationId: authorization.id,
        itemId: upstream.id,
        jobId: 'job_seed_upstream',
        purpose: 'seed_still',
        routeId: upstream.routeId,
        currency: authorization.currency,
        rateUnit: upstream.rateUnit,
        rateMinorUnits: upstream.rateMinorUnits,
        durationSeconds: null,
        generationCount: 1,
        totalMinorUnits: upstream.rateMinorUnits,
      },
    });
    const dependentJob = makeJob('job_seed_dependent', authorization, dependentItem, {
      status: 'queued_local',
      requestSnapshot: {
        ...dependentPlan.template,
        conditioningInput: { kind: 'seed_still', assetId: generatedSeed.id },
      },
    });
    addAuthorizationWithJobs(project, authorization, [upstreamJob, dependentJob]);
    expect(validateStudioProjectV2(project)).toBe(true);

    const humanSeed = addHumanSeed(project, 'shot_1', 'seed_human_import');
    dependentJob.requestSnapshot = {
      ...dependentPlan.template,
      conditioningInput: { kind: 'seed_still', assetId: humanSeed.id },
    };
    expect(validateStudioProjectV2(project)).toBe(false);
  });

  it('rejects a speculative endpoint field on a symbolic predecessor dependency', () => {
    const project = makeWaitingDependencyProject();
    const plan = project.spendAuthorizations[0]!.cascadeItems[0]!.requestPlan;
    expect(plan.kind).toBe('after_take_selection');
    if (plan.kind !== 'after_take_selection') throw new Error('expected deferred plan');
    Object.assign(plan.dependency, { endpointSeconds: 10 });
    expect(validateStudioProjectV2(project)).toBe(false);
  });

  it('validates an unbound existing predecessor against live topology but preserves materialized history', () => {
    const project = makeProject();
    project.beats.beat_1!.shotOrder.push('shot_2');
    project.shots.shot_2 = makeShot('shot_2');
    const take = addSucceededVideoTake(project, 'shot_1', 'take_existing');
    project.shots.shot_1!.trimOutSeconds = 2;
    const plan = {
      kind: 'after_take_selection' as const,
      template: {
        prompt: 'existing predecessor video prompt',
        aspectRatio: '16:9' as const,
        resolution: '1080p' as const,
        durationSeconds: 8,
        referenceInputs: [],
      },
      dependency: {
        kind: 'existing_predecessor' as const,
        predecessorShotId: 'shot_1',
        takeAssetId: take.id,
        endpointSeconds: 8,
      },
    } as unknown as StudioGenerationRequestPlan;
    const item = makeItem(project.revision, 'shot_2', 'video_take', plan);
    const authorization = makeAuthorization('auth_existing_predecessor', project.revision, [item]);
    const dependent = makeJob('job_existing_predecessor', authorization, item);
    const extractionId = createStudioFrameExtractionId({
      shotId: 'shot_1',
      videoAssetId: take.id,
      endpointSeconds: 8,
    });
    project.frameExtractions[extractionId] = {
      id: extractionId,
      shotId: 'shot_1',
      videoAssetId: take.id,
      endpointSeconds: 8,
      frameAssetId: null,
      status: 'pending',
      errorCode: null,
    };
    addAuthorizationWithJobs(project, authorization, [dependent]);

    expect(validateStudioProjectV2(project)).toBe(true);
    project.shots.shot_1!.trimOutSeconds = 1;
    expect(validateStudioProjectV2(project)).toBe(false);
    project.shots.shot_1!.trimOutSeconds = 2;
    project.shots.shot_2!.chainBreak = 'hard_cut';
    expect(validateStudioProjectV2(project)).toBe(false);
    project.shots.shot_2!.chainBreak = 'none';

    const frameAssetId = addReadyFrame(project, take.id, 8);
    dependent.status = 'queued_local';
    dependent.requestSnapshot = {
      ...plan.template,
      conditioningInput: {
        kind: 'predecessor_frame',
        predecessorShotId: 'shot_1',
        takeAssetId: take.id,
        frameAssetId,
        endpointSeconds: 8,
      },
    };
    expect(validateStudioProjectV2(project)).toBe(true);

    project.shots.shot_1!.trimOutSeconds = 1;
    project.shots.shot_2!.chainBreak = 'hard_cut';
    expect(validateStudioProjectV2(project)).toBe(true);
  });

  it('rejects two nonterminal authorization items for one Shot/purpose and releases terminal history', () => {
    const project = makeProject();
    const firstItem = makeItem(1, 'shot_1', 'seed_still', seedPlan());
    const firstAuth = makeAuthorization('auth_first', 1, [firstItem]);
    const firstJob = makeJob('job_first', firstAuth, firstItem);
    addAuthorizationWithJobs(project, firstAuth, [firstJob]);
    const secondItem = makeItem(2, 'shot_1', 'seed_still', seedPlan());
    const secondAuth = makeAuthorization('auth_second', 2, [secondItem]);
    const secondJob = makeJob('job_second', secondAuth, secondItem);
    addAuthorizationWithJobs(project, secondAuth, [secondJob]);
    expect(validateStudioProjectV2(project)).toBe(false);
    firstJob.status = 'failed';
    firstJob.error = { code: 'timeout', messageKey: 'timeout' };
    expect(validateStudioProjectV2(project)).toBe(true);
  });

  it('allows distinct project references to share one proxy Shot and purpose in an authorization', () => {
    const project = makeProject();
    const referenceIds = ['ref_character', 'ref_background'] as const;
    project.referenceOrder = [...referenceIds];
    project.references.ref_character = {
      id: 'ref_character',
      kind: 'character',
      label: 'Ming',
      prompt: 'Character sheet for Ming.',
      candidateAssetId: null,
      candidateJobId: 'job_ref_character',
      approvedAssetId: null,
      supersededAssetIds: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    project.references.ref_background = {
      id: 'ref_background',
      kind: 'background',
      label: 'Courtyard',
      prompt: 'Recurring courtyard background.',
      candidateAssetId: null,
      candidateJobId: 'job_ref_background',
      approvedAssetId: null,
      supersededAssetIds: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    project.shots.shot_1!.referenceIds = [...referenceIds];

    const items = referenceIds.map((projectReferenceId) => {
      const item = makeItem(project.revision, 'shot_1', 'seed_still', seedPlan());
      item.projectReferenceId = projectReferenceId;
      item.id = createStudioQuotedGenerationId({
        projectId: project.id,
        projectRevision: project.revision,
        shotId: item.shotId,
        purpose: item.purpose,
        projectReferenceId,
      });
      return item;
    });
    const authorization = makeAuthorization('auth_shared_reference_proxy', project.revision, items);
    const jobs = items.map((item) =>
      makeJob(`job_${item.projectReferenceId!}`, authorization, item, {
        projectReferenceId: item.projectReferenceId,
      })
    );
    addAuthorizationWithJobs(project, authorization, jobs);

    expect(validateStudioProjectV2(project)).toBe(true);
  });

  it('accepts exact all-terminal upstream failure and rejects premature dependency_failed', () => {
    const project = makeProject();
    project.beats.beat_1!.shotOrder.push('shot_2');
    project.shots.shot_2 = makeShot('shot_2');
    addHumanSeed(project);
    const upstream = makeItem(1, 'shot_1', 'video_take', videoPlan({ kind: 'seed_still', assetId: 'seed_1' }));
    const dependent = makeItem(1, 'shot_2', 'video_take', deferredVideoPlan(upstream.id, 'shot_1'));
    const authorization = makeAuthorization('auth_dependency', 1, [upstream], [dependent]);
    const upstreamJob = makeJob('job_upstream', authorization, upstream, {
      status: 'failed',
      error: { code: 'timeout', messageKey: 'timeout' },
    });
    const dependentJob = makeJob('job_dependent', authorization, dependent, {
      status: 'failed',
      error: { code: 'dependency_failed', messageKey: 'dependency_failed' },
    });
    addAuthorizationWithJobs(project, authorization, [upstreamJob, dependentJob]);
    expect(validateStudioProjectV2(project)).toBe(true);
    upstreamJob.status = 'queued_local';
    upstreamJob.error = null;
    expect(validateStudioProjectV2(project)).toBe(false);
  });

  it('enforces authorization project/revision/expiry and canonical item identity boundaries', () => {
    const project = makeProject();
    addSucceededVideoTake(project);
    const authorization = project.spendAuthorizations[0]!;
    authorization.confirmedAt = authorization.expiresAt;
    expect(validateStudioProjectV2(project)).toBe(false);
    authorization.confirmedAt = confirmedAt;
    authorization.projectRevision = project.revision;
    expect(validateStudioProjectV2(project)).toBe(false);
    authorization.projectRevision = 1;
    authorization.baseItems[0]!.id = 'item_noncanonical';
    expect(validateStudioProjectV2(project)).toBe(false);
  });
});

describe('validateStudioProjectV2 Bin and inactive-lineage safety', () => {
  it('accepts the exact Beat and Shot Bin kinds and rejects a third kind', () => {
    const project = makeProject();
    project.beatOrder = [];
    project.bin.push({ kind: 'beat', beatId: 'beat_1', reason: 'alternate' });
    expect(validateStudioProjectV2(project)).toBe(true);
    project.bin.push({ kind: 'other' } as never);
    expect(validateStudioProjectV2(project)).toBe(false);
  });

  it('accepts a binned Shot with terminal paid lineage and rejects nonterminal work', () => {
    const project = makeProject();
    addSucceededVideoTake(project);
    project.beats.beat_1!.shotOrder = [];
    project.bin.push({ kind: 'shot', beatId: 'beat_1', shotId: 'shot_1', reason: 'lifted' });
    expect(validateStudioProjectV2(project)).toBe(true);
    const job = project.jobs.job_1!;
    job.status = 'running';
    job.outputAssetIds = [];
    job.outputAssetIdsByRole = { primary: null, poster: null };
    job.spendReceipt = null;
    delete project.assets.take_1;
    project.shots.shot_1!.assetIds = project.shots.shot_1!.assetIds.filter((id) => id !== 'take_1');
    project.shots.shot_1!.videoAssetId = null;
    expect(validateStudioProjectV2(project)).toBe(false);
  });

  it('accepts a binned Beat with terminal lineage', () => {
    const project = makeProject();
    addSucceededVideoTake(project);
    project.beatOrder = [];
    project.bin.push({ kind: 'beat', beatId: 'beat_1', reason: 'lifted' });
    expect(validateStudioProjectV2(project)).toBe(true);
  });
});

describe('validateStudioProjectV2 undo structural history', () => {
  it('accepts exact historical fragments and rejects duplicate patch targets', () => {
    const project = makeProject();
    project.undoHistory = [
      {
        id: 'undo_1',
        sourceRevision: 1,
        label: 'Edit shot',
        patches: [
          {
            kind: 'shot_fields',
            shotId: 'shot_1',
            before: null,
            beforeBeatId: null,
            beforeIndex: null,
            afterDigest: digest,
          },
        ],
      },
    ];
    expect(validateStudioProjectV2(project)).toBe(true);
    project.undoHistory[0]!.patches.push({
      kind: 'shot_fields',
      shotId: 'shot_1',
      before: null,
      beforeBeatId: null,
      beforeIndex: null,
      afterDigest: digest,
    });
    expect(validateStudioProjectV2(project)).toBe(false);
  });

  it('enforces undo entry and patch caps', () => {
    const project = makeProject();
    project.undoHistory = Array.from({ length: STUDIO_MAX_UNDO_ENTRIES }, (_, index) => ({
      id: `undo_${index}`,
      sourceRevision: 1,
      label: 'Edit',
      patches: [{ kind: 'bin' as const, before: [], afterDigest: digest }],
    }));
    expect(validateStudioProjectV2(project)).toBe(true);
    project.undoHistory.push({
      id: 'undo_over',
      sourceRevision: 1,
      label: 'Edit',
      patches: [{ kind: 'bin', before: [], afterDigest: digest }],
    });
    expect(validateStudioProjectV2(project)).toBe(false);

    const patchProject = makeProject();
    patchProject.undoHistory = [
      {
        id: 'undo_many',
        sourceRevision: 1,
        label: 'Edit',
        patches: Array.from({ length: STUDIO_MAX_UNDO_PATCHES_PER_ENTRY + 1 }, (_, index) => ({
          kind: 'shot_fields' as const,
          shotId: `historical_${index}`,
          before: null,
          beforeBeatId: null,
          beforeIndex: null,
          afterDigest: digest,
        })),
      },
    ];
    expect(validateStudioProjectV2(patchProject)).toBe(false);
  });
});

describe('validateStudioProjectV2 hostile persisted data totality', () => {
  it.each(['constructor', 'toString', '__proto__'])('rejects magic relation ID %s without throwing', (id) => {
    const projects = [
      (() => {
        const project = makeProject();
        project.assets.asset_1 = makeImageAsset('asset_1', id, 'imports');
        return project;
      })(),
      (() => {
        const project = makeProject();
        project.shots.shot_1!.videoAssetId = id;
        return project;
      })(),
      (() => {
        const project = makeProject();
        project.shots.shot_1!.seedStillId = id;
        return project;
      })(),
      (() => {
        const project = makeProject();
        addSucceededVideoTake(project);
        project.jobs.job_1!.shotId = id;
        return project;
      })(),
    ];
    for (const project of projects) expect(validateStudioProjectV2(project)).toBe(false);
  });

  it('returns false for a 20,000-deep hostile own-data graph without recursion', () => {
    const project = makeProject() as StudioProjectV2 & { hostile?: unknown };
    let hostile: Record<string, unknown> = { leaf: true };
    for (let depth = 0; depth < 20_000; depth += 1) hostile = { next: hostile };
    project.hostile = hostile;
    expect(validateStudioProjectV2(project)).toBe(false);
  });

  it('rejects sparse arrays, accessors, proxies, and serialization hooks without invoking them', () => {
    const sparseProject = makeProject();
    sparseProject.bin.length = 1;
    expect(validateStudioProjectV2(sparseProject)).toBe(false);

    const accessorProject = makeProject();
    let getterCalls = 0;
    Object.defineProperty(accessorProject, 'name', {
      enumerable: true,
      get() {
        getterCalls += 1;
        return 'Hostile';
      },
    });
    expect(validateStudioProjectV2(accessorProject)).toBe(false);
    expect(getterCalls).toBe(0);

    const toJsonProject = makeProject();
    let toJsonCalls = 0;
    Object.defineProperty(toJsonProject, 'toJSON', {
      enumerable: false,
      value: () => {
        toJsonCalls += 1;
        return {};
      },
    });
    expect(validateStudioProjectV2(toJsonProject)).toBe(false);
    expect(toJsonCalls).toBe(0);

    expect(validateStudioProjectV2(new Proxy(makeProject(), {}))).toBe(false);
  });

  it('accepts a valid 20,000-job retry chain iteratively', () => {
    const project = makeProject();
    project.revision = 20_002;
    for (let index = 0; index < 20_000; index += 1) {
      const sourceRevision = index + 1;
      const item = makeItem(sourceRevision, 'shot_1', 'seed_still', seedPlan());
      const authorization = makeAuthorization(`auth_${index}`, sourceRevision, [item]);
      const job = makeJob(`job_${index}`, authorization, item, {
        status: 'failed',
        error: { code: 'timeout', messageKey: 'timeout' },
        retryOfJobId: index === 0 ? null : `job_${index - 1}`,
        retryReason: index === 0 ? null : 'provider_failure',
      });
      project.spendAuthorizations.push(authorization);
      project.jobs[job.id] = job;
      project.shots.shot_1!.jobIds.push(job.id);
    }
    expect(validateStudioProjectV2(project)).toBe(true);
  }, 30_000);
});

describe('proposal row validators', () => {
  it('validates exact proposed Shot keys and duration bounds', () => {
    const proposed = {
      shotId: 'shot_1',
      line: '',
      narration: '',
      onScreenText: '',
      durationSeconds: 8,
      chainBreak: 'none',
    };
    expect(validateStudioProposedShotV2(proposed)).toBe(true);
    expect(validateStudioProposedShotV2({ ...proposed, durationSeconds: 3 })).toBe(false);
    expect(validateStudioProposedShotV2({ ...proposed, unexpected: true })).toBe(false);
  });

  it('requires nonempty, deduplicated reasons in frozen order and unique row IDs', () => {
    const reasons = [
      'owned_asset',
      'owned_job',
      'video_asset',
      'seed_still',
      'conditioning_frame',
      'conditioning_input',
      'narration',
      'on_screen_text',
    ] as const satisfies readonly StudioFixedShotReasonV2[];
    const row = { shotId: 'shot_1', reasons: [...reasons] };
    expect(validateStudioFixedShotReviewV2(row)).toBe(true);
    for (const reason of reasons) {
      expect(validateStudioFixedShotReviewV2({ shotId: 'shot_1', reasons: [reason] }), reason).toBe(true);
    }
    expect(validateStudioFixedShotReviewV2({ ...row, reasons: [] })).toBe(false);
    expect(validateStudioFixedShotReviewV2({ ...row, reasons: ['video_asset', 'owned_asset'] })).toBe(false);
    expect(validateStudioFixedShotReviewV2({ ...row, reasons: ['owned_asset', 'owned_asset'] })).toBe(false);
    expect(validateStudioFixedShotReviewV2({ ...row, reasons: ['unknown_reason'] })).toBe(false);
    expect(validateStudioFixedShotReviewV2({ ...row, unexpected: true })).toBe(false);
    expect(validateStudioFixedShotReviewV2({ reasons: [...reasons] })).toBe(false);
    const sparseReasons = [...reasons] as Array<StudioFixedShotReasonV2 | undefined>;
    delete sparseReasons[3];
    expect(validateStudioFixedShotReviewV2({ shotId: 'shot_1', reasons: sparseReasons })).toBe(false);
    expect(validateStudioFixedShotReviewsV2([row, { shotId: 'shot_1', reasons: ['owned_job'] }])).toBe(false);
  });
});
