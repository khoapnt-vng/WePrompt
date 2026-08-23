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
  STUDIO_MAX_BIN_TAKE_ITEMS,
  STUDIO_MAX_LINE_HISTORY_PER_BEAT,
  STUDIO_MAX_SHOTS_PER_BEAT,
  STUDIO_MAX_SHOTS_PER_PROJECT,
  STUDIO_MAX_UNDO_ENTRIES,
  STUDIO_MAX_UNDO_PATCHES_PER_ENTRY,
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

const makeProject = (projectId = 'project_1'): StudioProjectV2 => ({
  schemaVersion: 2,
  revision: 1,
  id: projectId,
  name: `Project ${projectId}`,
  brief: '',
  rules: [],
  briefConversationId: null,
  aspectRatio: '16:9',
  targetDurationSeconds: 30,
  resolution: '1080p',
  beatOrder: ['beat_1'],
  beats: { beat_1: makeBeat('beat_1', ['shot_1']) },
  shots: { shot_1: makeShot('shot_1') },
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
    referenceInput,
    conditioningInput: null,
  },
});

const videoPlan = (conditioningInput: StudioConditioningInputSnapshot): StudioGenerationRequestPlan => ({
  kind: 'resolved',
  snapshot: {
    prompt: 'video prompt',
    aspectRatio: '16:9',
    resolution: '1080p',
    durationSeconds: 8,
    referenceInput: null,
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
  purpose: StudioQuotedGeneration['purpose'],
  requestPlan: StudioGenerationRequestPlan,
  generationCount = 1,
  projectId = 'project_1'
): StudioQuotedGeneration => ({
  id: createStudioQuotedGenerationId({ projectId, projectRevision, shotId, purpose }),
  shotId,
  purpose,
  routeId: purpose === 'seed_still' ? 'image_route' : 'video_route',
  generationCount,
  requestPlan,
  rateUnit: purpose === 'seed_still' ? 'generation' : 'second',
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
  generationIndex = 0,
  overrides: Partial<StudioJobV2> = {}
): StudioJobV2 => ({
  id,
  projectId: authorization.projectId,
  shotId: item.shotId,
  status: item.requestPlan.kind === 'resolved' ? 'queued_local' : 'waiting_for_conditioning',
  provider,
  idempotencyKey: authorization.idempotencyKeys.find(
    (entry) => entry.itemId === item.id && entry.generationIndex === generationIndex
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
  purpose: item.purpose,
  authorizationId: authorization.id,
  authorizationItemId: item.id,
  generationIndex,
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
  const job = makeJob(`job_${authorizationId}`, authorization, item, 0, {
    status: 'failed',
    error: { code: 'timeout', messageKey: 'timeout' },
    retryOfJobId,
    retryReason: retryOfJobId === null ? null : 'provider_failure',
  });
  addAuthorizationWithJobs(project, authorization, [job]);
  return job;
};

const addHumanSeed = (project: StudioProjectV2, shotId = 'shot_1', assetId = 'seed_1'): StudioAssetV2 => {
  const asset = makeImageAsset(assetId, shotId, 'imports');
  project.assets[assetId] = asset;
  project.shots[shotId]!.assetIds.push(assetId);
  return asset;
};

const addSucceededVideoTake = (project: StudioProjectV2, shotId = 'shot_1', assetId = 'take_1'): StudioAssetV2 => {
  const shot = project.shots[shotId]!;
  const seed = addHumanSeed(project, shotId, `seed_${shotId}`);
  shot.seedStillId = seed.id;
  const projectRevision = project.revision;
  const item = makeItem(projectRevision, shotId, 'video_take', videoPlan({ kind: 'seed_still', assetId: seed.id }));
  const authorization = makeAuthorization(`auth_${projectRevision}`, projectRevision, [item]);
  const asset = makeVideoAsset(assetId, shotId);
  project.assets[asset.id] = asset;
  shot.assetIds.push(asset.id);
  const jobId = `job_${projectRevision}`;
  const job = makeJob(jobId, authorization, item, 0, {
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
      generationIndex: 0,
      generationCount: 1,
      totalMinorUnits: 16,
    },
  });
  addAuthorizationWithJobs(project, authorization, [job]);
  shot.selectedTakeId = asset.id;
  return asset;
};

const addReadyFrame = (project: StudioProjectV2, takeId = 'take_1', endpointSeconds = 10): string => {
  const frameId = createStudioFrameExtractionId({ shotId: 'shot_1', takeAssetId: takeId, endpointSeconds });
  const frameAssetId = `frame_asset_${endpointSeconds}`;
  project.assets[frameAssetId] = makeImageAsset(frameAssetId, 'shot_1', 'conditioningFrames');
  project.shots.shot_1!.assetIds.push(frameAssetId);
  project.frameExtractions[frameId] = {
    id: frameId,
    shotId: 'shot_1',
    takeAssetId: takeId,
    endpointSeconds,
    frameAssetId,
    status: 'ready',
    errorCode: null,
  };
  return frameAssetId;
};

const makeWaitingDependencyProject = (primaryCount: number): StudioProjectV2 => {
  const project = makeProject();
  project.beats.beat_1!.shotOrder.push('shot_2');
  project.shots.shot_2 = makeShot('shot_2');
  addHumanSeed(project);
  const upstream = makeItem(
    1,
    'shot_1',
    'video_take',
    videoPlan({ kind: 'seed_still', assetId: 'seed_1' }),
    primaryCount
  );
  const dependent = makeItem(1, 'shot_2', 'video_take', deferredVideoPlan(upstream.id, 'shot_1'));
  const authorization = makeAuthorization('auth_waiting_take', 1, [upstream], [dependent]);
  const upstreamJobs = Array.from({ length: primaryCount }, (_, generationIndex) => {
    const asset = makeVideoAsset(`take_${generationIndex + 1}`);
    project.assets[asset.id] = asset;
    project.shots.shot_1!.assetIds.push(asset.id);
    const jobId = `job_upstream_${generationIndex}`;
    return makeJob(jobId, authorization, upstream, generationIndex, {
      status: 'succeeded',
      providerJobId: `remote_${generationIndex}`,
      remoteStartedAt: timestamp,
      outputAssetIds: [asset.id],
      outputAssetIdsByRole: { primary: asset.id, poster: null },
      spendReceipt: {
        authorizationId: authorization.id,
        itemId: upstream.id,
        jobId,
        purpose: upstream.purpose,
        routeId: upstream.routeId,
        currency: authorization.currency,
        rateUnit: upstream.rateUnit,
        rateMinorUnits: upstream.rateMinorUnits,
        durationSeconds: 8,
        generationIndex,
        generationCount: primaryCount,
        totalMinorUnits: 16,
      },
    });
  });
  addAuthorizationWithJobs(project, authorization, [
    ...upstreamJobs,
    makeJob('job_dependent', authorization, dependent),
  ]);
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

  it('enforces the independently reachable Take Bin maximum', () => {
    const project = makeProject();
    for (let index = 1; index <= STUDIO_MAX_BIN_TAKE_ITEMS; index += 1) {
      const assetId = `seed_${index}`;
      addHumanSeed(project, 'shot_1', assetId);
      project.bin.push({ kind: 'take', assetId, reason: 'alternate' });
    }
    expect(validateStudioProjectV2(project)).toBe(true);
    addHumanSeed(project, 'shot_1', 'seed_97');
    project.bin.push({ kind: 'take', assetId: 'seed_97', reason: 'alternate' });
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

  it('accepts a selected 10-second Take with an 8-second Shot plan', () => {
    const project = makeProject();
    addSucceededVideoTake(project);
    expect(validateStudioProjectV2(project)).toBe(true);
  });

  it('validates trims against selected source duration, not planning duration', () => {
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

  it('rejects trims without a selected canonical video Take', () => {
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
    project.shots.shot_1!.selectedTakeId = null;
    job.spendReceipt = receipt;
    expect(validateStudioProjectV2(project)).toBe(true);
    job.status = 'queued_local';
    job.error = null;
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

  it('rejects mixed waiting/bound siblings in one deferred item', () => {
    const project = makeProject();
    project.beats.beat_1!.shotOrder.push('shot_2');
    project.shots.shot_2 = makeShot('shot_2');
    addHumanSeed(project);
    const upstream = makeItem(1, 'shot_1', 'video_take', videoPlan({ kind: 'seed_still', assetId: 'seed_1' }));
    const dependent = makeItem(1, 'shot_2', 'video_take', deferredVideoPlan(upstream.id, 'shot_1'), 2);
    const authorization = makeAuthorization('auth_deferred', 1, [upstream], [dependent]);
    const upstreamJob = makeJob('job_upstream', authorization, upstream, 0, {
      status: 'failed',
      error: { code: 'timeout', messageKey: 'timeout' },
    });
    const first = makeJob('job_dependent_0', authorization, dependent, 0);
    const template = dependent.requestPlan.kind === 'after_take_selection' ? dependent.requestPlan.template : null;
    const second = makeJob('job_dependent_1', authorization, dependent, 1, {
      status: 'queued_local',
      requestSnapshot: { ...template!, conditioningInput: { kind: 'seed_still', assetId: 'seed_1' } },
    });
    addAuthorizationWithJobs(project, authorization, [upstreamJob, first, second]);
    expect(validateStudioProjectV2(project)).toBe(false);
  });

  it('keeps symbolic predecessor endpoints concrete-only and binds only the exact upstream item primary', () => {
    const project = makeWaitingDependencyProject(1);
    const predecessor = project.shots.shot_1!;
    predecessor.selectedTakeId = 'take_1';
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
        referenceInput: null,
      },
      dependency: { kind: 'authorized_seed', upstreamItemId: upstream.id, shotId: 'shot_1' },
    };
    const dependentItem = makeItem(1, 'shot_1', 'video_take', dependentPlan);
    const authorization = makeAuthorization('auth_seed_dependency', 1, [upstream], [dependentItem]);
    const generatedSeed = makeImageAsset('seed_generated', 'shot_1', 'assets');
    project.assets[generatedSeed.id] = generatedSeed;
    project.shots.shot_1!.assetIds.push(generatedSeed.id);
    project.shots.shot_1!.seedStillId = generatedSeed.id;
    const upstreamJob = makeJob('job_seed_upstream', authorization, upstream, 0, {
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
        generationIndex: 0,
        generationCount: 1,
        totalMinorUnits: upstream.rateMinorUnits,
      },
    });
    const dependentJob = makeJob('job_seed_dependent', authorization, dependentItem, 0, {
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
    const project = makeWaitingDependencyProject(1);
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
        referenceInput: null,
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
      takeAssetId: take.id,
      endpointSeconds: 8,
    });
    project.frameExtractions[extractionId] = {
      id: extractionId,
      shotId: 'shot_1',
      takeAssetId: take.id,
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

  it('accepts exact all-terminal upstream failure and rejects premature dependency_failed', () => {
    const project = makeProject();
    project.beats.beat_1!.shotOrder.push('shot_2');
    project.shots.shot_2 = makeShot('shot_2');
    addHumanSeed(project);
    const upstream = makeItem(1, 'shot_1', 'video_take', videoPlan({ kind: 'seed_still', assetId: 'seed_1' }));
    const dependent = makeItem(1, 'shot_2', 'video_take', deferredVideoPlan(upstream.id, 'shot_1'));
    const authorization = makeAuthorization('auth_dependency', 1, [upstream], [dependent]);
    const upstreamJob = makeJob('job_upstream', authorization, upstream, 0, {
      status: 'failed',
      error: { code: 'timeout', messageKey: 'timeout' },
    });
    const dependentJob = makeJob('job_dependent', authorization, dependent, 0, {
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
  it('accepts all three exact Bin kinds and rejects a fourth', () => {
    const project = makeProject();
    addHumanSeed(project, 'shot_1', 'alternate_seed');
    project.bin.push({ kind: 'take', assetId: 'alternate_seed', reason: 'alternate' });
    expect(validateStudioProjectV2(project)).toBe(true);
    project.bin.push({ kind: 'other' } as never);
    expect(validateStudioProjectV2(project)).toBe(false);
  });

  it('rejects Take aliases naming the selected Take or explicit seed', () => {
    const selected = makeProject();
    addSucceededVideoTake(selected);
    selected.bin.push({ kind: 'take', assetId: 'take_1', reason: 'lifted' });
    expect(validateStudioProjectV2(selected)).toBe(false);
    const seed = makeProject();
    addHumanSeed(seed);
    seed.shots.shot_1!.seedStillId = 'seed_1';
    seed.bin.push({ kind: 'take', assetId: 'seed_1', reason: 'lifted' });
    expect(validateStudioProjectV2(seed)).toBe(false);
  });

  it('refuses lifting the last selectable primary needed by a waiting dependency', () => {
    const project = makeWaitingDependencyProject(1);
    expect(validateStudioProjectV2(project)).toBe(true);
    project.bin.push({ kind: 'take', assetId: 'take_1', reason: 'alternate' });
    expect(validateStudioProjectV2(project)).toBe(false);
  });

  it('allows lifting one alternate primary while another remains selectable', () => {
    const project = makeWaitingDependencyProject(2);
    project.bin.push({ kind: 'take', assetId: 'take_1', reason: 'alternate' });
    expect(validateStudioProjectV2(project)).toBe(true);
  });

  it('requires dependency_failed once every terminal upstream primary is binned', () => {
    const project = makeWaitingDependencyProject(2);
    project.bin.push(
      { kind: 'take', assetId: 'take_1', reason: 'alternate' },
      { kind: 'take', assetId: 'take_2', reason: 'alternate' }
    );
    expect(validateStudioProjectV2(project)).toBe(false);
    const dependent = project.jobs.job_dependent!;
    dependent.status = 'failed';
    dependent.error = { code: 'dependency_failed', messageKey: 'dependency_failed' };
    expect(validateStudioProjectV2(project)).toBe(true);
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
    project.shots.shot_1!.selectedTakeId = null;
    expect(validateStudioProjectV2(project)).toBe(false);
  });

  it('accepts a binned Beat with terminal lineage and rejects current Match To', () => {
    const project = makeProject();
    addSucceededVideoTake(project);
    project.beatOrder = [];
    project.bin.push({ kind: 'beat', beatId: 'beat_1', reason: 'lifted' });
    expect(validateStudioProjectV2(project)).toBe(true);
    project.matchToShotId = 'shot_1';
    expect(validateStudioProjectV2(project)).toBe(false);
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
        project.shots.shot_1!.selectedTakeId = id;
        return project;
      })(),
      (() => {
        const project = makeProject();
        project.shots.shot_1!.seedStillId = id;
        return project;
      })(),
      (() => {
        const project = makeProject();
        project.matchToShotId = id;
        return project;
      })(),
      (() => {
        const project = makeProject();
        project.bin.push({ kind: 'take', assetId: id, reason: 'lifted' });
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
      const job = makeJob(`job_${index}`, authorization, item, 0, {
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
      'selected_take',
      'seed_still',
      'conditioning_frame',
      'conditioning_input',
      'match_to',
      'narration',
      'on_screen_text',
    ] as const satisfies readonly StudioFixedShotReasonV2[];
    const row = { shotId: 'shot_1', reasons: [...reasons] };
    expect(validateStudioFixedShotReviewV2(row)).toBe(true);
    for (const reason of reasons) {
      expect(validateStudioFixedShotReviewV2({ shotId: 'shot_1', reasons: [reason] }), reason).toBe(true);
    }
    expect(validateStudioFixedShotReviewV2({ ...row, reasons: [] })).toBe(false);
    expect(validateStudioFixedShotReviewV2({ ...row, reasons: ['selected_take', 'owned_asset'] })).toBe(false);
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
