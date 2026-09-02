/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest';
import {
  STUDIO_FILM_EXPORT_FRAME_RATE,
  STUDIO_PROJECT_STATUS_STAGE_ORDER_V2,
  type StudioAssetV2,
  type StudioFrameExtraction,
  type StudioGenerationCompositionV2,
  type StudioGenerationRequestPlan,
  type StudioJobV2,
  type StudioMediaRouteCatalog,
  type StudioProjectReferenceV2,
  type StudioProjectStatusRouteCatalogV2,
  type StudioProjectStatusStageIdV2,
  type StudioProjectStatusV2,
  type StudioProjectV2,
  type StudioRouteCatalogEntry,
  type StudioShot,
  type StudioSpendAuthorization,
} from '@/common/types/project/creativeStudioTypes';
import {
  createEmptyStudioProjectV2,
  deriveStudioAssemblyPictureTimelineV4,
  projectStudioCanvasPresentationV4,
  projectStudioStatusV2,
  studioCanvasActionsForFailureV4,
  studioCanvasActionsForStalenessV4,
  studioCanvasStatusNeedsAttentionV4,
  studioCanvasStatusUsesConditionsRegionV4,
} from '@/process/services/creative-studio/service/schema2';
import { createStudioFrameExtractionId } from '@/process/services/creative-studio/service/schema2/generation';
import { makePhase6Project, PHASE_6_CURRENT_AT } from '../../../../../fixtures/creative-studio/phase6Project';

const timestamp = '2026-08-27T00:00:00.000Z';
const digest = 'a'.repeat(64);

const route = (
  kind: 'image' | 'video',
  overrides: Partial<StudioRouteCatalogEntry['constraints']> = {}
): StudioRouteCatalogEntry => ({
  choiceId: `${kind}_route`,
  providerId: 'provider_1',
  providerName: 'Provider One',
  model: `${kind}_model`,
  integrationLabelKey: kind === 'image' ? 'imageApi' : 'openRouterVideo',
  health: 'available',
  kind,
  constraints: {
    aspectRatios: ['16:9'],
    resolutions: ['1080p'],
    minDurationSeconds: 1,
    maxDurationSeconds: 60,
    supportsFirstFrame: true,
    maxConditioningImages: kind === 'image' ? 3 : 0,
    silentOutput: true,
    ...overrides,
  },
});

describe('schema-7 canvas and Assembly projections', () => {
  it('derives picture sequence from board reading order without an Assembly order field', () => {
    const value = makePhase6Project();

    expect(deriveStudioAssemblyPictureTimelineV4(value, 'assembly_1')).toEqual([
      {
        beatId: 'beat_1',
        beatPosition: 0,
        shotId: 'shot_1',
        shotPosition: 0,
        binding: value.assemblies.assembly_1!.pictureBindings.shot_1,
      },
      {
        beatId: 'beat_1',
        beatPosition: 0,
        shotId: 'shot_2',
        shotPosition: 1,
        binding: value.assemblies.assembly_1!.pictureBindings.shot_2,
      },
    ]);
  });

  it('projects dependency order and removes only lifted presentation subjects', () => {
    const value = makePhase6Project();
    value.bin = [
      {
        id: 'bin_board',
        subject: { kind: 'board', boardId: 'board_1' },
        reason: 'lifted',
        liftedAt: PHASE_6_CURRENT_AT,
      },
    ];

    expect(projectStudioCanvasPresentationV4(value)).toEqual({
      activeSubjects: [
        { kind: 'piece', pieceId: 'piece_photo_1' },
        { kind: 'assembly', assemblyId: 'assembly_1' },
      ],
      bin: value.bin,
    });
    expect(value.boards.board_1).toBeDefined();
    expect(value.assemblies.assembly_1!.boardId).toBe('board_1');
  });

  it('maps stale cause to the two signed action sets', () => {
    expect(
      studioCanvasActionsForStalenessV4({
        cause: 'chain',
        upstreamShotId: 'shot_1',
        sourceAuthoringRevision: 2,
        keptAt: null,
      })
    ).toEqual(['re_render_chain', 'keep']);
    expect(studioCanvasActionsForStalenessV4({ cause: 'words', sourceAuthoringRevision: 2, keptAt: null })).toEqual([
      'keep',
    ]);
  });

  it('never offers Retry for returned silence or another spent failure', () => {
    expect(studioCanvasActionsForFailureV4({ reason: 'returned_silence', costTruth: 'spent' })).toEqual([]);
    expect(studioCanvasActionsForFailureV4({ reason: 'provider_failure', costTruth: 'spent' })).toEqual([]);
    expect(studioCanvasActionsForFailureV4({ reason: 'provider_failure', costTruth: 'not_spent' })).toEqual(['retry']);
  });

  it('uses region 4 for the exact corrected status set and keeps all quiet-density decisions visible', () => {
    expect(['generating', 'proposed', 'needs_budget'].filter(studioCanvasStatusUsesConditionsRegionV4)).toEqual([
      'generating',
      'proposed',
      'needs_budget',
    ]);
    expect(studioCanvasStatusUsesConditionsRegionV4('rendering')).toBe(false);
    expect(
      ['proposed', 'needs_budget', 'failed', 'stale', 'queued', 'generating', 'rendering'].every(
        studioCanvasStatusNeedsAttentionV4
      )
    ).toBe(true);
    expect(studioCanvasStatusNeedsAttentionV4('rendered')).toBe(false);
  });

  it('fails closed for an unknown Assembly or malformed project', () => {
    const value = makePhase6Project();

    expect(() => deriveStudioAssemblyPictureTimelineV4(value, 'assembly_missing')).toThrow('assembly_not_found');
    expect(() => projectStudioCanvasPresentationV4({ ...value, schemaVersion: 6 })).toThrow(
      'invalid_schema_7_projection_input'
    );
  });
});

const readyRoutes = (image = route('image'), video = route('video')): StudioProjectStatusRouteCatalogV2 => ({
  status: 'available',
  catalog: {
    catalogVersion: 'catalog_1',
    image: {
      status: 'ready',
      selected: { choiceId: image.choiceId, providerId: image.providerId, model: image.model },
      selectedRoute: image,
      selectionIssue: null,
      options: [image],
    },
    video: {
      status: 'ready',
      selected: { choiceId: video.choiceId, providerId: video.providerId, model: video.model },
      selectedRoute: video,
      selectionIssue: null,
      options: [video],
    },
  },
});

const project = (): StudioProjectV2 => {
  const value = createEmptyStudioProjectV2(
    {
      name: 'Status film',
      brief: 'A bounded status film.',
      aspectRatio: '16:9',
      targetDurationSeconds: 30,
      resolution: '1080p',
    },
    'project_1',
    timestamp
  );
  value.imageRouteId = 'image_route';
  value.videoRouteId = 'video_route';
  return value;
};

const shot = (id: string, durationSeconds = 5, overrides: Partial<StudioShot> = {}): StudioShot => ({
  id,
  shootingScript: `Shooting script for ${id}`,
  durationSeconds,
  trimInSeconds: null,
  trimOutSeconds: null,
  chainBreak: 'none',
  referenceBinding: { status: 'ready', characterReferenceIds: [], backgroundReferenceId: null },
  seedStillId: null,
  dismissedSeedStillIds: [],
  boardAssetId: null,
  supersededBoardAssetIds: [],
  videoAssetId: null,
  supersededVideoAssetIds: [],
  assetIds: [],
  jobIds: [],
  ...overrides,
});

const addBeat = (value: StudioProjectV2, shots: StudioShot[], targetSeconds: number | null = null): void => {
  value.beatOrder = ['beat_1'];
  value.beats.beat_1 = {
    id: 'beat_1',
    title: 'Opening',
    story: 'The opening story.',
    targetSeconds,
    shotOrder: shots.map((item) => item.id),
  };
  for (const item of shots) value.shots[item.id] = item;
};

const stage = <Stage extends StudioProjectStatusStageIdV2>(status: StudioProjectStatusV2, id: Stage) => {
  const result = status.stages.find((candidate) => candidate.id === id);
  if (result === undefined) throw new Error(`Missing ${id} status stage`);
  return result;
};

const composition = (value: StudioProjectV2, shotId: string): StudioGenerationCompositionV2 => ({
  inputs: {
    schemaVersion: 1,
    projectRevision: value.revision,
    brief: value.brief,
    rules: [],
    source: {
      kind: 'shot',
      beatId: 'beat_1',
      story: value.beats.beat_1!.story,
      shotId,
      shootingScript: value.shots[shotId]!.shootingScript,
    },
    purpose: 'video_take',
    referenceInputs: [],
    aspectRatio: '16:9',
    resolution: '1080p',
    route: { providerId: 'provider_1', adapterId: 'openrouter-video-v1', model: 'video_model' },
    boardStyle: null,
    instructionProfile: 'video_take/openrouter-video-v1/v1',
  },
  prompt: 'Persisted prompt.',
});

const addVideoAttempt = (
  value: StudioProjectV2,
  shotId: string,
  suffix: string,
  status: StudioJobV2['status'],
  error: StudioJobV2['error'] = null,
  output = false
): StudioJobV2 => {
  const itemId = `item_${suffix}`;
  const jobId = `job_${suffix}`;
  const authorizationId = `authorization_${suffix}`;
  const snapshot = {
    composition: composition(value, shotId),
    aspectRatio: '16:9' as const,
    resolution: '1080p' as const,
    durationSeconds: value.shots[shotId]!.durationSeconds,
    referenceInputs: [],
    conditioningInput: null,
  };
  const requestPlan: StudioGenerationRequestPlan = { kind: 'resolved', snapshot };
  const assetId = output ? `asset_${suffix}` : null;
  const job: StudioJobV2 = {
    id: jobId,
    projectId: value.id,
    target: { kind: 'shot', shotId },
    status,
    provider: { providerId: 'provider_1', adapterId: 'openrouter-video-v1', model: 'video_model' },
    idempotencyKey: `idempotency_${suffix}`,
    providerJobId: output ? `remote_${suffix}` : null,
    remoteStartedAt: output ? timestamp : null,
    cancellationPolicy: 'none',
    outputAssetIds: assetId === null ? [] : [assetId],
    error,
    retryOfJobId: null,
    retryReason: null,
    duplicateChargeAcknowledged: false,
    duplicateChargeAcknowledgedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    purpose: 'video_take',
    authorizationId,
    authorizationItemId: itemId,
    composition: snapshot.composition,
    requestPlan,
    requestSnapshot: snapshot,
    spendReceipt: output
      ? {
          authorizationId,
          itemId,
          jobId,
          purpose: 'video_take',
          routeId: 'video_route',
          currency: 'USD',
          rateUnit: 'second',
          rateMinorUnits: 1,
          durationSeconds: value.shots[shotId]!.durationSeconds,
          generationCount: 1,
          totalMinorUnits: value.shots[shotId]!.durationSeconds,
        }
      : null,
    outputAssetIdsByRole: { primary: assetId, poster: null },
  };
  const item = {
    id: itemId,
    target: { kind: 'shot' as const, shotId },
    purpose: 'video_take' as const,
    routeId: 'video_route',
    generationCount: 1,
    requestPlan,
    rateUnit: 'second' as const,
    rateMinorUnits: 1,
  };
  const authorization: StudioSpendAuthorization = {
    id: authorizationId,
    projectId: value.id,
    projectRevision: value.revision,
    originReferenceHandoffId: null,
    rateCardDigest: digest,
    currency: 'USD',
    baseItems: [item],
    cascadeItems: [],
    lowerMinorUnits: value.shots[shotId]!.durationSeconds,
    upperMinorUnits: value.shots[shotId]!.durationSeconds,
    confirmedAt: timestamp,
    providerBindings: [{ itemId, provider: job.provider }],
    idempotencyKeys: [{ itemId, key: job.idempotencyKey }],
  };
  value.jobs[jobId] = job;
  value.shots[shotId]!.jobIds.push(jobId);
  value.spendAuthorizations.push(authorization);
  if (assetId !== null) {
    const asset: StudioAssetV2 = {
      id: assetId,
      projectId: value.id,
      shotId,
      mediaKind: 'video',
      mimeType: 'video/mp4',
      managedAsset: { collection: 'assets', fileName: `${assetId}.mp4` },
      byteSize: 100,
      sha256: digest,
      durationSeconds: value.shots[shotId]!.durationSeconds,
      createdAt: timestamp,
      projectReferenceId: null,
      generationReferenceAssetIds: [],
      producerJobId: jobId,
      compositionDigest: digest,
    };
    value.assets[assetId] = asset;
    value.shots[shotId]!.assetIds.push(assetId);
    value.shots[shotId]!.videoAssetId = assetId;
  }
  return job;
};

const addReference = (
  value: StudioProjectV2,
  id: string,
  kind: StudioProjectReferenceV2['kind'],
  options: { assetId?: string; approved?: boolean; collection?: 'assets' | 'imports' } = {}
): StudioProjectReferenceV2 => {
  const assetId = options.assetId ?? null;
  const reference: StudioProjectReferenceV2 = {
    id,
    kind,
    label: id,
    prompt: `Prompt for ${id}`,
    approvedAssetId: assetId !== null && options.approved !== false ? assetId : null,
    supersededAssetIds: [],
    jobIds: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  value.referencePlanStatus = 'planned';
  value.referenceOrder.push(id);
  value.references[id] = reference;
  if (assetId !== null) {
    value.assets[assetId] = {
      id: assetId,
      projectId: value.id,
      shotId: null,
      mediaKind: 'image',
      mimeType: 'image/png',
      managedAsset: { collection: options.collection ?? 'imports', fileName: `${assetId}.png` },
      byteSize: 100,
      sha256: digest,
      createdAt: timestamp,
      projectReferenceId: id,
      generationReferenceAssetIds: [],
      producerJobId: null,
      compositionDigest: null,
    };
  }
  return reference;
};

const addReferenceJob = (
  value: StudioProjectV2,
  referenceId: string,
  suffix: string,
  status: StudioJobV2['status'],
  error: StudioJobV2['error'] = null
): StudioJobV2 => {
  const shotId = Object.keys(value.shots)[0];
  if (shotId === undefined) throw new Error('Reference job fixture needs one Shot');
  const job = addVideoAttempt(value, shotId, suffix, status, error);
  value.shots[shotId]!.jobIds = value.shots[shotId]!.jobIds.filter((jobId) => jobId !== job.id);
  job.target = { kind: 'reference', referenceId };
  job.purpose = 'reference_image';
  value.references[referenceId]!.jobIds.push(job.id);
  return job;
};

const addSeedImage = (
  value: StudioProjectV2,
  shotId: string,
  id: string,
  createdAt = timestamp,
  collection: 'assets' | 'imports' = 'imports'
): StudioAssetV2 => {
  const asset: StudioAssetV2 = {
    id,
    projectId: value.id,
    shotId,
    mediaKind: 'image',
    mimeType: 'image/png',
    managedAsset: { collection, fileName: `${id}.png` },
    byteSize: 100,
    sha256: digest,
    createdAt,
    projectReferenceId: null,
    generationReferenceAssetIds: [],
    producerJobId: null,
    compositionDigest: null,
  };
  value.assets[id] = asset;
  value.shots[shotId]!.assetIds.push(id);
  return asset;
};

const addBoardImage = (value: StudioProjectV2, shotId: string, id: string): StudioAssetV2 => {
  const producer = addVideoAttempt(value, shotId, `board_${id}`, 'succeeded');
  producer.purpose = 'board_still';
  producer.outputAssetIds = [id];
  producer.outputAssetIdsByRole.primary = id;
  const asset: StudioAssetV2 = {
    id,
    projectId: value.id,
    shotId,
    mediaKind: 'image',
    mimeType: 'image/png',
    managedAsset: { collection: 'boardStills', fileName: `${id}.png` },
    byteSize: 100,
    sha256: digest,
    createdAt: timestamp,
    projectReferenceId: null,
    generationReferenceAssetIds: [],
    producerJobId: producer.id,
    compositionDigest: digest,
  };
  value.assets[id] = asset;
  value.shots[shotId]!.assetIds.push(id);
  value.shots[shotId]!.boardAssetId = id;
  return asset;
};

const unavailableRoute = (
  status: StudioMediaRouteCatalog['status'],
  selectionIssue: StudioMediaRouteCatalog['selectionIssue']
): StudioMediaRouteCatalog => ({ status, selected: null, selectedRoute: null, selectionIssue, options: [] });

const makeExistingPredecessorPlan = (
  value: StudioProjectV2,
  job: StudioJobV2,
  predecessorShotId: string,
  takeAssetId: string,
  endpointSeconds: number
): void => {
  if (job.requestSnapshot === null) throw new Error('Expected resolved fixture snapshot');
  const { conditioningInput: _conditioningInput, ...template } = job.requestSnapshot;
  const requestPlan: StudioGenerationRequestPlan = {
    kind: 'after_take_selection',
    template,
    dependency: { kind: 'existing_predecessor', predecessorShotId, takeAssetId, endpointSeconds },
  };
  job.requestPlan = requestPlan;
  job.requestSnapshot = null;
  const authorization = value.spendAuthorizations.find((candidate) => candidate.id === job.authorizationId);
  const item = authorization?.baseItems.find((candidate) => candidate.id === job.authorizationItemId);
  if (item === undefined) throw new Error('Expected authorization item');
  item.requestPlan = requestPlan;
};

const authorizationLink = (value: StudioProjectV2, job: StudioJobV2) => {
  const authorization = value.spendAuthorizations.find((candidate) => candidate.id === job.authorizationId);
  const item = [...(authorization?.baseItems ?? []), ...(authorization?.cascadeItems ?? [])].find(
    (candidate) => candidate.id === job.authorizationItemId
  );
  if (authorization === undefined || item === undefined) throw new Error('Expected authorization link');
  return { authorization, item };
};

const makeAuthorizedPredecessorPlan = (
  value: StudioProjectV2,
  job: StudioJobV2,
  predecessorShotId: string,
  upstreamItemId: string
): void => {
  if (job.requestSnapshot === null) throw new Error('Expected resolved fixture snapshot');
  const { conditioningInput: _conditioningInput, ...template } = job.requestSnapshot;
  const requestPlan: StudioGenerationRequestPlan = {
    kind: 'after_take_selection',
    template,
    dependency: { kind: 'authorized_predecessor', predecessorShotId, upstreamItemId },
  };
  job.requestPlan = requestPlan;
  job.requestSnapshot = null;
  authorizationLink(value, job).item.requestPlan = requestPlan;
};

const makeAuthorizedSeedPlan = (
  value: StudioProjectV2,
  job: StudioJobV2,
  shotId: string,
  upstreamItemId: string
): void => {
  if (job.requestSnapshot === null) throw new Error('Expected resolved fixture snapshot');
  const { conditioningInput: _conditioningInput, ...template } = job.requestSnapshot;
  const requestPlan: StudioGenerationRequestPlan = {
    kind: 'after_take_selection',
    template,
    dependency: { kind: 'authorized_seed', shotId, upstreamItemId },
  };
  job.requestPlan = requestPlan;
  job.requestSnapshot = null;
  authorizationLink(value, job).item.requestPlan = requestPlan;
};

const addGeneratedSeedAttempt = (value: StudioProjectV2, shotId: string, suffix: string): StudioJobV2 => {
  const job = addVideoAttempt(value, shotId, suffix, 'succeeded', null, true);
  const assetId = `asset_${suffix}`;
  const asset = value.assets[assetId]!;
  job.purpose = 'seed_still';
  authorizationLink(value, job).item.purpose = 'seed_still';
  if (job.spendReceipt !== null) job.spendReceipt.purpose = 'seed_still';
  asset.mediaKind = 'image';
  asset.mimeType = 'image/png';
  delete asset.durationSeconds;
  value.shots[shotId]!.videoAssetId = null;
  return job;
};

const addSeedAttempt = (
  value: StudioProjectV2,
  shotId: string,
  suffix: string,
  status: StudioJobV2['status'],
  error: StudioJobV2['error'] = null
): StudioJobV2 => {
  const job = addVideoAttempt(value, shotId, suffix, status, error);
  job.purpose = 'seed_still';
  authorizationLink(value, job).item.purpose = 'seed_still';
  return job;
};

const mergeAuthorizationChain = (value: StudioProjectV2, root: StudioJobV2, followers: StudioJobV2[]): void => {
  const rootLink = authorizationLink(value, root);
  const followerLinks = followers.map((job) => ({ job, ...authorizationLink(value, job) }));
  rootLink.authorization.baseItems = [rootLink.item];
  rootLink.authorization.cascadeItems = followerLinks.map(({ item }) => item);
  for (const { job } of followerLinks) job.authorizationId = rootLink.authorization.id;
  const removed = new Set(followerLinks.map(({ authorization }) => authorization.id));
  value.spendAuthorizations = value.spendAuthorizations.filter((authorization) => !removed.has(authorization.id));
};

const addExtraction = (
  value: StudioProjectV2,
  shotId: string,
  videoAssetId: string,
  endpointSeconds: number,
  status: StudioFrameExtraction['status']
): StudioFrameExtraction => {
  const id = createStudioFrameExtractionId({ shotId, videoAssetId, endpointSeconds });
  const extraction: StudioFrameExtraction = {
    id,
    shotId,
    videoAssetId,
    endpointSeconds,
    frameAssetId: null,
    status,
    errorCode: status === 'failed' ? 'decode_failed' : null,
    attemptCount: 1,
  };
  value.frameExtractions[id] = extraction;
  return extraction;
};

const addReadyConditioningFrame = (
  value: StudioProjectV2,
  predecessorShotId: string,
  videoAssetId: string,
  endpointSeconds: number,
  frameAssetId: string
): void => {
  const extraction = addExtraction(value, predecessorShotId, videoAssetId, endpointSeconds, 'ready');
  extraction.frameAssetId = frameAssetId;
  value.assets[frameAssetId] = {
    id: frameAssetId,
    projectId: value.id,
    shotId: predecessorShotId,
    mediaKind: 'image',
    mimeType: 'image/png',
    managedAsset: { collection: 'conditioningFrames', fileName: `${frameAssetId}.png` },
    byteSize: 100,
    sha256: digest,
    createdAt: timestamp,
    projectReferenceId: null,
    generationReferenceAssetIds: [],
    producerJobId: null,
    compositionDigest: null,
  };
  value.shots[predecessorShotId]!.assetIds.push(frameAssetId);
};

describe('projectStudioStatusV2', () => {
  it('returns the fixed seven-stage order and keeps boards advisory', () => {
    const value = project();
    const status = projectStudioStatusV2(value, readyRoutes());

    expect(status.stages.map((item) => item.id)).toEqual(STUDIO_PROJECT_STATUS_STAGE_ORDER_V2);
    expect(stage(status, 'brief').state).toBe('complete');
    expect(stage(status, 'references')).toMatchObject({
      state: 'not_started',
      blockers: [],
      summary: { plannedCount: 0, approvedCount: 0 },
    });
    expect(stage(status, 'storyboard').state).toBe('not_started');
    expect(status.boards).toEqual({ currentPictureCount: 0, shotCount: 0 });
    expect(status.detail).toBeNull();
  });

  it('uses an inclusive one-frame tolerance and reports outside mismatches as advisories', () => {
    const atBoundary = project();
    addBeat(atBoundary, [shot('shot_1', 30 - 1 / STUDIO_FILM_EXPORT_FRAME_RATE)]);
    expect(stage(projectStudioStatusV2(atBoundary, readyRoutes()), 'storyboard').state).toBe('complete');

    const outside = project();
    addBeat(outside, [shot('shot_1', 30 - 1 / STUDIO_FILM_EXPORT_FRAME_RATE - 0.000_001)]);
    const status = projectStudioStatusV2(outside, readyRoutes());
    expect(stage(status, 'storyboard').state).toBe('in_progress');
    expect(status.advisories).toContainEqual({
      cause: 'target_duration_mismatch',
      stage: 'storyboard',
      actualSeconds: outside.shots.shot_1!.durationSeconds,
      targetSeconds: 30,
    });
  });

  it('keeps an empty active Beat in progress and excludes its slate target from planned storyboard time', () => {
    const value = project();
    addBeat(value, [], 30);

    const status = projectStudioStatusV2(value, readyRoutes());

    expect(stage(status, 'storyboard')).toMatchObject({
      state: 'in_progress',
      summary: {
        stage: 'storyboard',
        beatCount: 1,
        shotCount: 0,
        authoredShotCount: 0,
        plannedSeconds: 0,
        targetSeconds: 30,
      },
    });
    expect(stage(status, 'cut')).toMatchObject({
      state: 'complete',
      summary: { structurallyPlayable: true, durationSeconds: 30, targetSeconds: 30 },
    });
  });

  it('blocks the exact active Shot with a blank Shooting script without losing its planned duration', () => {
    const value = project();
    addBeat(value, [shot('shot_1', 12, { shootingScript: '   ' })], 30);

    const status = projectStudioStatusV2(value, readyRoutes());

    expect(stage(status, 'storyboard')).toMatchObject({
      state: 'blocked',
      summary: {
        shotCount: 1,
        authoredShotCount: 0,
        plannedSeconds: 12,
        targetSeconds: 30,
      },
      blockers: [
        {
          cause: 'shooting_script_required',
          where: {
            kind: 'shot',
            beatId: 'beat_1',
            shotId: 'shot_1',
            beatPosition: 1,
            shotPosition: 1,
            jobId: null,
          },
          remedy: { kind: 'owner_only', reason: 'review_project_data' },
        },
      ],
    });
    expect(status.blockerCount).toBe(1);
  });

  it('ignores blank Shooting scripts retained only in the Bin', () => {
    const value = project();
    addBeat(value, [shot('shot_active', 12)], 30);
    value.shots.shot_binned = shot('shot_binned', 8, { shootingScript: '\n  ' });
    value.bin.push({ kind: 'shot', beatId: 'beat_1', shotId: 'shot_binned', reason: 'lifted' });

    expect(stage(projectStudioStatusV2(value, readyRoutes()), 'storyboard')).toMatchObject({
      state: 'in_progress',
      summary: { shotCount: 1, authoredShotCount: 1, plannedSeconds: 12, targetSeconds: 30 },
      blockers: [],
    });
  });

  it('returns a bounded engine blocker when fresh inventory is unavailable without hiding other stages', () => {
    const value = project();
    const status = projectStudioStatusV2(value, { status: 'inventory_unavailable', catalogVersion: null });

    expect(stage(status, 'engines')).toMatchObject({
      state: 'blocked',
      blockers: [{ cause: 'route_inventory_unavailable', remedy: { kind: 'owner_only' } }],
    });
    expect(stage(status, 'brief').state).toBe('complete');
    expect(status.catalogVersion).toBeNull();
  });

  it('detects half-selected, first-frame-incompatible, and duration-incompatible routes', () => {
    const half = project();
    half.imageRouteId = null;
    const halfCatalog = readyRoutes();
    if (halfCatalog.status !== 'available') throw new Error('Expected catalog');
    halfCatalog.catalog.image = {
      status: 'selection_required',
      selected: null,
      selectedRoute: null,
      selectionIssue: null,
      options: [route('image')],
    };
    expect(stage(projectStudioStatusV2(half, halfCatalog), 'engines').blockers).toContainEqual(
      expect.objectContaining({ cause: 'route_not_selected', where: { kind: 'route', routeKind: 'image' } })
    );

    const incompatible = project();
    addBeat(incompatible, [shot('shot_1', 7)]);
    const status = projectStudioStatusV2(
      incompatible,
      readyRoutes(route('image'), route('video', { supportsFirstFrame: false, supportedDurationSeconds: [5] }))
    );
    expect(stage(status, 'engines').blockers.map((item) => item.cause)).toEqual([
      'route_first_frame_unsupported',
      'route_duration_unsupported',
    ]);
  });

  it('reports unassigned bindings precisely in compact and detailed status', () => {
    const value = project();
    addBeat(value, [
      shot('shot_1', 30, {
        referenceBinding: { status: 'unassigned', characterReferenceIds: [], backgroundReferenceId: null },
      }),
    ]);
    const status = projectStudioStatusV2(value, readyRoutes(), { detail: true });

    expect(stage(status, 'bindings')).toMatchObject({
      state: 'blocked',
      blockers: [
        {
          cause: 'reference_binding_unassigned',
          where: expect.objectContaining({ kind: 'shot', shotId: 'shot_1' }),
          remedy: { kind: 'free_fix', op: 'set_shot_reference_binding', shotId: 'shot_1' },
        },
      ],
    });
    expect(status.detail?.shots[0]?.binding).toEqual({ status: 'unassigned', selectedCount: 0, limit: 3 });
  });

  it('opens production for a fully authored film before anything has been submitted', () => {
    const value = project();
    addBeat(value, [shot('shot_1', 30)]);
    const status = projectStudioStatusV2(value, readyRoutes());

    expect(stage(status, 'engines').state).toBe('complete');
    expect(stage(status, 'references').state).toBe('not_started');
    expect(stage(status, 'storyboard').state).toBe('complete');
    expect(stage(status, 'bindings').state).toBe('complete');
    expect(stage(status, 'production')).toMatchObject({
      state: 'in_progress',
      blockers: [],
      summary: { currentTakeCount: 0, shotCount: 1, activeJobCount: 0 },
    });
  });

  it('does not call a slate-backed missing video playable', () => {
    const value = project();
    addBeat(value, [shot('shot_1', 30)]);
    const cut = stage(projectStudioStatusV2(value, readyRoutes()), 'cut');

    expect(cut.summary).toMatchObject({ stage: 'cut', structurallyPlayable: false });
    expect(cut.state).toBe('not_started');
  });

  it('keeps intentional targeted empty-Beat slates playable but not an untimed empty Beat', () => {
    const targeted = project();
    addBeat(targeted, [], 30);
    expect(stage(projectStudioStatusV2(targeted, readyRoutes()), 'cut')).toMatchObject({
      state: 'complete',
      summary: { structurallyPlayable: true, durationSeconds: 30 },
    });

    const untimed = project();
    addBeat(untimed, [], null);
    expect(stage(projectStudioStatusV2(untimed, readyRoutes()), 'cut')).toMatchObject({
      state: 'not_started',
      summary: { structurallyPlayable: false },
    });

    const drifted = project();
    addBeat(drifted, [], 29);
    const driftedStatus = projectStudioStatusV2(drifted, readyRoutes());
    expect(stage(driftedStatus, 'cut')).toMatchObject({
      state: 'in_progress',
      summary: { structurallyPlayable: true, durationSeconds: 29, targetSeconds: 30 },
    });
    expect(driftedStatus.advisories).toContainEqual({
      cause: 'target_duration_mismatch',
      stage: 'cut',
      actualSeconds: 29,
      targetSeconds: 30,
    });
  });

  it('keeps a canonical selected take complete and advisory-only when stale or followed by a failed replacement', () => {
    const value = project();
    addBeat(value, [shot('shot_1', 30)]);
    addVideoAttempt(value, 'shot_1', 'success', 'succeeded', null, true);
    addVideoAttempt(value, 'shot_1', 'replacement', 'failed', { code: 'content_rejected', messageKey: 'safe' });

    const status = projectStudioStatusV2(value, readyRoutes());
    expect(stage(status, 'production')).toMatchObject({ state: 'complete', blockers: [] });
    expect(stage(status, 'cut').summary).toMatchObject({ structurallyPlayable: true });
    expect(status.advisories).toContainEqual(
      expect.objectContaining({ cause: 'current_take_stale', stage: 'production', shotId: 'shot_1' })
    );
  });

  it.each([
    ['setup_required', null, 'route_setup_required', 'configure_engine'],
    [
      'selection_required',
      { code: 'needs_setup', providerName: 'Provider One' },
      'route_setup_required',
      'configure_engine',
    ],
    ['unavailable', { code: 'health' }, 'route_unavailable', 'repair_engine_health'],
    [
      'selection_required',
      { code: 'frame', aspectRatio: '16:9', resolution: '1080p' },
      'route_incompatible_frame',
      'choose_compatible_engine',
    ],
    ['selection_required', { code: 'retired' }, 'route_retired', 'select_engine'],
    ['unavailable', null, 'route_unavailable', 'repair_engine_health'],
  ] as const)('maps %s route inventory to a bounded %s blocker', (routeStatus, issue, cause, reason) => {
    const routes = readyRoutes();
    if (routes.status !== 'available') throw new Error('Expected route catalog');
    routes.catalog.image = unavailableRoute(routeStatus, issue);
    const blocker = stage(projectStudioStatusV2(project(), routes), 'engines').blockers[0];
    expect(blocker).toEqual({
      cause,
      where: { kind: 'route', routeKind: 'image' },
      remedy: { kind: 'owner_only', reason },
    });
  });

  it('keeps pristine and targeted-slate projects route-independent but blocks authored generation with no routes', () => {
    const routes = readyRoutes();
    if (routes.status !== 'available') throw new Error('Expected route catalog');
    routes.catalog.image = unavailableRoute('selection_required', null);
    routes.catalog.video = unavailableRoute('selection_required', null);

    const pristine = project();
    pristine.imageRouteId = null;
    pristine.videoRouteId = null;
    expect(stage(projectStudioStatusV2(pristine, routes), 'engines')).toMatchObject({
      state: 'not_started',
      blockers: [],
    });

    const slate = project();
    slate.imageRouteId = null;
    slate.videoRouteId = null;
    addBeat(slate, [], 30);
    expect(stage(projectStudioStatusV2(slate, routes), 'engines').blockers).toEqual([]);

    const authored = project();
    authored.imageRouteId = null;
    authored.videoRouteId = null;
    addBeat(authored, [shot('shot_1', 30)]);
    expect(stage(projectStudioStatusV2(authored, routes), 'engines').blockers.map((item) => item.where)).toEqual([
      { kind: 'route', routeKind: 'image' },
      { kind: 'route', routeKind: 'video' },
    ]);
  });

  it('blocks incompatible ratio, resolution, and continuous duration route constraints', () => {
    const value = project();
    addBeat(value, [shot('shot_1', 0.5), shot('shot_2', 29.5)]);
    const status = projectStudioStatusV2(
      value,
      readyRoutes(
        route('image', { aspectRatios: ['1:1'], resolutions: ['720p'] }),
        route('video', { aspectRatios: ['1:1'], resolutions: ['720p'], minDurationSeconds: 1, maxDurationSeconds: 20 })
      )
    );
    expect(stage(status, 'engines').blockers.map((item) => item.cause)).toEqual([
      'route_incompatible_frame',
      'route_incompatible_frame',
      'route_duration_unsupported',
      'route_duration_unsupported',
    ]);
  });

  it('enforces character-first reference generation and exposes bounded reference detail', () => {
    const before = project();
    addReference(before, 'character_1', 'character');
    addReference(before, 'character_2', 'character');
    addReference(before, 'background_1', 'background');
    expect(
      stage(projectStudioStatusV2(before, readyRoutes()), 'references').blockers.map((item) => item.where)
    ).toEqual([
      { kind: 'reference', referenceId: 'character_1', jobId: null },
      { kind: 'reference', referenceId: 'character_2', jobId: null },
    ]);

    const importedBackground = project();
    addReference(importedBackground, 'character_1', 'character');
    addReference(importedBackground, 'background_1', 'background', {
      assetId: 'asset_background_candidate',
      approved: false,
    });
    expect(
      stage(projectStudioStatusV2(importedBackground, readyRoutes()), 'references').blockers.map((item) => item.cause)
    ).toEqual(['reference_generation_required', 'reference_approval_required']);

    const after = project();
    addReference(after, 'character_1', 'character', { assetId: 'asset_character_1' });
    addReference(after, 'character_2', 'character', { assetId: 'asset_character_2' });
    addReference(after, 'background_1', 'background');
    const status = projectStudioStatusV2(after, readyRoutes(), { detail: true });
    expect(stage(status, 'references').blockers).toEqual([
      expect.objectContaining({
        cause: 'reference_generation_required',
        where: { kind: 'reference', referenceId: 'background_1', jobId: null },
      }),
    ]);
    expect(status.detail?.references).toEqual([
      { referenceId: 'character_1', kind: 'character', approved: true, latestJob: null },
      { referenceId: 'character_2', kind: 'character', approved: true, latestJob: null },
      { referenceId: 'background_1', kind: 'background', approved: false, latestJob: null },
    ]);
  });

  it('distinguishes invalid plans, candidate approval, active work, and failed reference generation', () => {
    const invalid = project();
    addReference(invalid, 'background_1', 'background');
    addReference(invalid, 'character_1', 'character');
    expect(stage(projectStudioStatusV2(invalid, readyRoutes()), 'references').blockers[0]?.cause).toBe(
      'reference_plan_invalid'
    );

    const candidate = project();
    addReference(candidate, 'character_1', 'character', { assetId: 'asset_candidate', approved: false });
    expect(stage(projectStudioStatusV2(candidate, readyRoutes()), 'references').blockers[0]).toMatchObject({
      cause: 'reference_approval_required',
      remedy: { kind: 'owner_only', reason: 'approve_reference' },
    });

    const active = project();
    addBeat(active, [shot('shot_1', 30)]);
    addReference(active, 'character_1', 'character');
    addReferenceJob(active, 'character_1', 'reference_active', 'running');
    expect(stage(projectStudioStatusV2(active, readyRoutes()), 'references')).toMatchObject({
      state: 'in_progress',
      blockers: [],
    });

    const failed = project();
    addBeat(failed, [shot('shot_1', 30)]);
    addReference(failed, 'character_1', 'character');
    addReferenceJob(failed, 'character_1', 'reference_failed', 'failed', {
      code: 'provider_unavailable',
      messageKey: 'safe',
    });
    expect(stage(projectStudioStatusV2(failed, readyRoutes()), 'references').blockers[0]).toMatchObject({
      cause: 'generation_provider_unavailable',
      remedy: { kind: 'proposal', prepare: { kind: 'project_references', referenceIds: ['character_1'] } },
    });

    const gatedBackground = project();
    addBeat(gatedBackground, [shot('shot_1', 30)]);
    addReference(gatedBackground, 'character_1', 'character');
    addReference(gatedBackground, 'background_1', 'background');
    const backgroundJob = addReferenceJob(gatedBackground, 'background_1', 'background_failed', 'failed', {
      code: 'provider_unavailable',
      messageKey: 'safe',
    });
    const gatedStatus = projectStudioStatusV2(gatedBackground, readyRoutes(), { detail: true });
    expect(stage(gatedStatus, 'references').blockers.map((item) => item.where)).toEqual([
      { kind: 'reference', referenceId: 'character_1', jobId: null },
    ]);
    expect(gatedStatus.detail?.references[1]?.latestJob?.jobId).toBe(backgroundJob.id);
  });

  it('accepts exactly one generated canonical reference producer and rejects malformed approved authority', () => {
    const generated = project();
    addBeat(generated, [shot('shot_1', 30)]);
    const reference = addReference(generated, 'character_1', 'character', {
      assetId: 'asset_generated',
      collection: 'assets',
    });
    const producer = addReferenceJob(generated, reference.id, 'reference_success', 'succeeded');
    producer.outputAssetIds = ['asset_generated'];
    producer.outputAssetIdsByRole.primary = 'asset_generated';
    generated.assets.asset_generated!.producerJobId = producer.id;
    generated.assets.asset_generated!.compositionDigest = digest;
    expect(stage(projectStudioStatusV2(generated, readyRoutes()), 'references').state).toBe('complete');

    producer.target = { kind: 'shot', shotId: 'shot_1' };
    expect(stage(projectStudioStatusV2(generated, readyRoutes()), 'references').blockers[0]).toMatchObject({
      cause: 'reference_plan_invalid',
      remedy: { kind: 'owner_only', reason: 'review_project_data' },
    });
  });

  it.each([
    ['unknown_reference', { characterReferenceIds: ['missing'], backgroundReferenceId: null }, 'free_fix'],
    ['wrong_kind', { characterReferenceIds: ['background_1'], backgroundReferenceId: null }, 'free_fix'],
    [
      'unapproved_reference',
      { characterReferenceIds: ['character_unapproved'], backgroundReferenceId: null },
      'owner_only',
    ],
    ['missing_asset', { characterReferenceIds: ['character_missing'], backgroundReferenceId: null }, 'owner_only'],
  ] as const)('reports %s binding truth with an admissible %s remedy', (expectedReason, binding, remedyKind) => {
    const value = project();
    addBeat(value, [shot('shot_1', 30, { referenceBinding: { status: 'ready', ...binding } })]);
    addReference(value, 'background_1', 'background', { assetId: 'asset_background' });
    addReference(value, 'character_unapproved', 'character');
    const missing = addReference(value, 'character_missing', 'character');
    missing.approvedAssetId = 'asset_missing';
    const status = projectStudioStatusV2(value, readyRoutes(), { detail: true });
    expect(stage(status, 'bindings').blockers[0]).toMatchObject({
      cause: `reference_binding_${expectedReason}`,
      remedy: { kind: remedyKind },
    });
    expect(status.detail?.shots[0]?.binding).toMatchObject({ status: 'invalid', reason: expectedReason });
  });

  it('reports binding capacity exactly and leaves capacity unknown when image routes are unavailable', () => {
    const value = project();
    addReference(value, 'character_1', 'character', { assetId: 'asset_character_1' });
    addReference(value, 'character_2', 'character', { assetId: 'asset_character_2' });
    addBeat(value, [
      shot('shot_1', 30, {
        referenceBinding: {
          status: 'ready',
          characterReferenceIds: ['character_1', 'character_2'],
          backgroundReferenceId: null,
        },
      }),
    ]);
    const limited = projectStudioStatusV2(value, readyRoutes(route('image', { maxConditioningImages: 1 })), {
      detail: true,
    });
    expect(stage(limited, 'bindings').blockers[0]?.cause).toBe('reference_binding_capacity_exceeded');

    const unavailable = readyRoutes();
    if (unavailable.status !== 'available') throw new Error('Expected route catalog');
    unavailable.catalog.image = unavailableRoute('unavailable', null);
    const unknown = projectStudioStatusV2(value, unavailable, { detail: true });
    expect(stage(unknown, 'bindings')).toMatchObject({
      state: 'in_progress',
      summary: { maxConditioningImages: null, readyShotCount: 0 },
    });
    expect(unknown.detail?.shots[0]?.binding).toEqual({ status: 'unknown', selectedCount: 2, limit: null });
  });

  it.each([
    ['invalid_request', 'generation_invalid_request'],
    ['content_rejected', 'generation_content_rejected'],
    ['auth', 'generation_auth'],
    ['quota', 'generation_quota'],
    ['rate_limited', 'generation_rate_limited'],
    ['provider_unavailable', 'generation_provider_unavailable'],
    ['timeout', 'generation_timeout'],
    ['poll_deadline', 'generation_poll_deadline'],
    ['no_output', 'generation_no_output'],
    ['seed_still_variation_grid', 'generation_variation_grid'],
    ['submission_unknown', 'generation_submission_unknown'],
    ['download_failed', 'generation_download_failed'],
    ['unsupported', 'generation_unsupported'],
    ['unknown', 'generation_unknown'],
    ['dependency_failed', 'dependency_failed'],
  ] as const)('maps %s generation failures to %s', (code, cause) => {
    const value = project();
    addBeat(value, [shot('shot_1', 30)]);
    addSeedImage(value, 'shot_1', `seed_${code}`);
    value.shots.shot_1!.seedStillId = `seed_${code}`;
    addVideoAttempt(value, 'shot_1', `error_${code}`, 'failed', { code, messageKey: 'safe' });
    const production = stage(projectStudioStatusV2(value, readyRoutes()), 'production');
    expect(production.state).toBe('blocked');
    expect(production.blockers[0]?.cause).toBe(cause);
  });

  it('keeps every needs-attention recovery in a free or owner lane and never proposes new spend', () => {
    const refused = project();
    addBeat(refused, [shot('shot_1', 30)]);
    addSeedImage(refused, 'shot_1', 'seed_refused');
    refused.shots.shot_1!.seedStillId = 'seed_refused';
    const refusedJob = addVideoAttempt(refused, 'shot_1', 'refused', 'needs_attention', {
      code: 'provider_unavailable',
      messageKey: 'safe',
    });
    expect(stage(projectStudioStatusV2(refused, readyRoutes()), 'production').blockers[0]?.remedy).toEqual({
      kind: 'free_fix',
      op: 'terminalize_refused_job',
      jobId: refusedJob.id,
    });

    const cases = [
      ['submission_unknown', 'acknowledge_possible_duplicate_charge'],
      ['download_failed', 'retry_download'],
      ['timeout', 'review_job_recovery'],
    ] as const;
    for (const [code, reason] of cases) {
      const value = project();
      addBeat(value, [shot('shot_1', 30)]);
      addSeedImage(value, 'shot_1', `seed_attention_${code}`);
      value.shots.shot_1!.seedStillId = `seed_attention_${code}`;
      const job = addVideoAttempt(value, 'shot_1', `attention_${code}`, 'needs_attention', {
        code,
        messageKey: 'safe',
      });
      if (code === 'timeout') job.providerJobId = 'remote_timeout';
      expect(stage(projectStudioStatusV2(value, readyRoutes()), 'production').blockers[0]?.remedy).toEqual({
        kind: 'owner_only',
        reason,
      });
    }
  });

  it('offers conditioning retry only for the exact current waiting authorization and gives dependency failure precedence', () => {
    const waiting = project();
    addBeat(waiting, [shot('shot_1', 15), shot('shot_2', 15)]);
    addVideoAttempt(waiting, 'shot_1', 'conditioning_upstream', 'succeeded', null, true);
    const waitingJob = addVideoAttempt(waiting, 'shot_2', 'conditioning_waiting', 'waiting_for_conditioning');
    makeExistingPredecessorPlan(waiting, waitingJob, 'shot_1', 'asset_conditioning_upstream', 15);
    addExtraction(waiting, 'shot_1', 'asset_conditioning_upstream', 15, 'failed');
    const waitingStatus = projectStudioStatusV2(waiting, readyRoutes(), { detail: true });
    expect(stage(waitingStatus, 'production').blockers).toContainEqual({
      cause: 'extraction_failed',
      where: expect.objectContaining({ kind: 'shot', shotId: 'shot_2', jobId: waitingJob.id }),
      remedy: { kind: 'free_fix', op: 'retry_conditioning_frame', dependentShotId: 'shot_2' },
    });
    expect(waitingStatus.detail?.shots[1]?.conditioning).toMatchObject({
      recordStatus: 'failed',
      mediaVerified: false,
      errorCode: 'decode_failed',
      attemptCount: 1,
    });

    const readyAfterCrash = project();
    addBeat(readyAfterCrash, [shot('shot_1', 15), shot('shot_2', 15)]);
    addVideoAttempt(readyAfterCrash, 'shot_1', 'ready_crash_upstream', 'succeeded', null, true);
    const readyWaitingJob = addVideoAttempt(
      readyAfterCrash,
      'shot_2',
      'ready_crash_waiting',
      'waiting_for_conditioning'
    );
    makeExistingPredecessorPlan(readyAfterCrash, readyWaitingJob, 'shot_1', 'asset_ready_crash_upstream', 15);
    addReadyConditioningFrame(readyAfterCrash, 'shot_1', 'asset_ready_crash_upstream', 15, 'frame_ready_after_crash');
    expect(stage(projectStudioStatusV2(readyAfterCrash, readyRoutes()), 'production').blockers).toEqual([
      expect.objectContaining({
        cause: 'conditioning_frame_required',
        where: expect.objectContaining({ shotId: 'shot_2', jobId: readyWaitingJob.id }),
        remedy: { kind: 'free_fix', op: 'retry_conditioning_frame', dependentShotId: 'shot_2' },
      }),
    ]);

    const stale = project();
    addBeat(stale, [shot('shot_1', 15), shot('shot_2', 15)]);
    addVideoAttempt(stale, 'shot_1', 'stale_upstream', 'succeeded', null, true);
    addExtraction(stale, 'shot_1', 'asset_stale_upstream', 15, 'failed');
    expect(stage(projectStudioStatusV2(stale, readyRoutes()), 'production').blockers).toEqual([
      expect.objectContaining({
        cause: 'extraction_failed',
        where: expect.objectContaining({ shotId: 'shot_2', jobId: null }),
        remedy: { kind: 'owner_only', reason: 'review_project_data' },
      }),
    ]);

    const missing = project();
    addBeat(missing, [shot('shot_1', 15), shot('shot_2', 15)]);
    addVideoAttempt(missing, 'shot_1', 'missing_frame_upstream', 'succeeded', null, true);
    expect(stage(projectStudioStatusV2(missing, readyRoutes()), 'production').blockers).toEqual([
      expect.objectContaining({
        cause: 'conditioning_frame_required',
        where: expect.objectContaining({ shotId: 'shot_2', jobId: null }),
        remedy: { kind: 'owner_only', reason: 'review_project_data' },
      }),
    ]);

    const inertSucceeded = project();
    addBeat(inertSucceeded, [shot('shot_1', 15), shot('shot_2', 15)]);
    addVideoAttempt(inertSucceeded, 'shot_1', 'inert_upstream', 'succeeded', null, true);
    addVideoAttempt(inertSucceeded, 'shot_2', 'inert_succeeded', 'succeeded');
    expect(stage(projectStudioStatusV2(inertSucceeded, readyRoutes()), 'production').blockers).toEqual([
      expect.objectContaining({
        cause: 'conditioning_frame_required',
        where: expect.objectContaining({ shotId: 'shot_2' }),
      }),
    ]);

    const terminal = project();
    addBeat(terminal, [shot('shot_1', 15), shot('shot_2', 15)]);
    addVideoAttempt(terminal, 'shot_1', 'terminal_upstream', 'succeeded', null, true);
    const terminalJob = addVideoAttempt(terminal, 'shot_2', 'terminal_follower', 'failed', {
      code: 'dependency_failed',
      messageKey: 'safe',
    });
    makeExistingPredecessorPlan(terminal, terminalJob, 'shot_1', 'asset_terminal_upstream', 15);
    addExtraction(terminal, 'shot_1', 'asset_terminal_upstream', 15, 'failed');
    expect(stage(projectStudioStatusV2(terminal, readyRoutes()), 'production').blockers[0]).toMatchObject({
      cause: 'dependency_failed',
      where: { kind: 'shot', shotId: 'shot_2' },
    });
  });

  it('collapses dependency-failed followers to one failed current root without replaying historical cascade targets', () => {
    const value = project();
    addBeat(value, [shot('shot_1', 10), shot('shot_2', 10), shot('shot_3', 10)]);
    addSeedImage(value, 'shot_1', 'seed_head');
    value.shots.shot_1!.seedStillId = 'seed_head';
    const root = addVideoAttempt(value, 'shot_1', 'chain_root', 'failed', {
      code: 'provider_unavailable',
      messageKey: 'safe',
    });
    const follower1 = addVideoAttempt(value, 'shot_2', 'chain_follower_1', 'failed', {
      code: 'dependency_failed',
      messageKey: 'safe',
    });
    const follower2 = addVideoAttempt(value, 'shot_3', 'chain_follower_2', 'failed', {
      code: 'dependency_failed',
      messageKey: 'safe',
    });
    makeAuthorizedPredecessorPlan(value, follower1, 'shot_1', root.authorizationItemId);
    makeAuthorizedPredecessorPlan(value, follower2, 'shot_2', follower1.authorizationItemId);
    mergeAuthorizationChain(value, root, [follower1, follower2]);

    const production = stage(projectStudioStatusV2(value, readyRoutes()), 'production');
    expect(production.blockers).toHaveLength(1);
    expect(production.blockers[0]).toEqual({
      cause: 'generation_provider_unavailable',
      where: expect.objectContaining({ kind: 'shot', shotId: 'shot_1', jobId: root.id }),
      remedy: {
        kind: 'proposal',
        prepare: {
          kind: 'generation',
          baseChoices: [{ target: { kind: 'shot', shotId: 'shot_1' }, purpose: 'video_take' }],
          cascadeChoices: [],
          continuityChange: null,
        },
        estimatedMinorUnits: null,
        currency: null,
      },
    });
  });

  it('groups a reordered old cascade by the one current missing segment root', () => {
    const value = project();
    addBeat(value, [shot('shot_A', 10), shot('shot_B', 10), shot('shot_C', 10)]);
    const root = addVideoAttempt(value, 'shot_A', 'reorder_root', 'failed', {
      code: 'provider_unavailable',
      messageKey: 'safe',
    });
    const followerB = addVideoAttempt(value, 'shot_B', 'reorder_B', 'failed', {
      code: 'dependency_failed',
      messageKey: 'safe',
    });
    const followerC = addVideoAttempt(value, 'shot_C', 'reorder_C', 'failed', {
      code: 'dependency_failed',
      messageKey: 'safe',
    });
    makeAuthorizedPredecessorPlan(value, followerB, 'shot_A', root.authorizationItemId);
    makeAuthorizedPredecessorPlan(value, followerC, 'shot_B', followerB.authorizationItemId);
    mergeAuthorizationChain(value, root, [followerB, followerC]);
    value.beats.beat_1!.shotOrder = ['shot_B', 'shot_A', 'shot_C'];

    expect(stage(projectStudioStatusV2(value, readyRoutes()), 'production').blockers).toEqual([
      {
        cause: 'seed_generation_required',
        where: expect.objectContaining({ kind: 'shot', shotId: 'shot_B', jobId: null }),
        remedy: {
          kind: 'proposal',
          prepare: {
            kind: 'generation',
            baseChoices: [{ target: { kind: 'shot', shotId: 'shot_B' }, purpose: 'seed_still' }],
            cascadeChoices: [],
            continuityChange: null,
          },
          estimatedMinorUnits: null,
          currency: null,
        },
      },
    ]);
  });

  it('uses a new current predecessor as the missing segment root instead of an old frozen upstream', () => {
    const value = project();
    addBeat(value, [shot('shot_A', 10), shot('shot_B', 10)]);
    value.shots.shot_D = shot('shot_D', 20);
    const oldRoot = addVideoAttempt(value, 'shot_A', 'topology_old_A', 'failed', {
      code: 'provider_unavailable',
      messageKey: 'safe',
    });
    const follower = addVideoAttempt(value, 'shot_B', 'topology_old_B', 'failed', {
      code: 'dependency_failed',
      messageKey: 'safe',
    });
    makeAuthorizedPredecessorPlan(value, follower, 'shot_A', oldRoot.authorizationItemId);
    mergeAuthorizationChain(value, oldRoot, [follower]);
    value.beats.beat_1!.shotOrder = ['shot_D', 'shot_B'];

    expect(stage(projectStudioStatusV2(value, readyRoutes()), 'production').blockers).toEqual([
      {
        cause: 'seed_generation_required',
        where: expect.objectContaining({ kind: 'shot', shotId: 'shot_D', jobId: null }),
        remedy: {
          kind: 'proposal',
          prepare: {
            kind: 'generation',
            baseChoices: [{ target: { kind: 'shot', shotId: 'shot_D' }, purpose: 'seed_still' }],
            cascadeChoices: [],
            continuityChange: null,
          },
          estimatedMinorUnits: null,
          currency: null,
        },
      },
    ]);
  });

  it('bases terminal followers on current predecessor topology and switches moved segment heads to seed generation', () => {
    const replaced = project();
    addBeat(replaced, [shot('shot_1', 15), shot('shot_2', 15)]);
    const oldRoot = addVideoAttempt(replaced, 'shot_1', 'old_root', 'failed', {
      code: 'provider_unavailable',
      messageKey: 'safe',
    });
    const follower = addVideoAttempt(replaced, 'shot_2', 'old_follower', 'failed', {
      code: 'dependency_failed',
      messageKey: 'safe',
    });
    makeAuthorizedPredecessorPlan(replaced, follower, 'shot_1', oldRoot.authorizationItemId);
    mergeAuthorizationChain(replaced, oldRoot, [follower]);
    addVideoAttempt(replaced, 'shot_1', 'new_root', 'succeeded', null, true);
    addReadyConditioningFrame(replaced, 'shot_1', 'asset_new_root', 15, 'frame_new_root');

    const blocker = stage(projectStudioStatusV2(replaced, readyRoutes()), 'production').blockers[0];
    expect(blocker).toMatchObject({
      cause: 'dependency_failed',
      where: { kind: 'shot', shotId: 'shot_2', jobId: follower.id },
      remedy: {
        kind: 'proposal',
        prepare: {
          baseChoices: [{ target: { kind: 'shot', shotId: 'shot_2' }, purpose: 'video_take' }],
          cascadeChoices: [],
        },
      },
    });

    replaced.shots.shot_2!.chainBreak = 'hard_cut';
    const moved = stage(projectStudioStatusV2(replaced, readyRoutes()), 'production').blockers[0];
    expect(moved).toMatchObject({
      cause: 'seed_generation_required',
      where: { kind: 'shot', shotId: 'shot_2', jobId: null },
      remedy: {
        kind: 'proposal',
        prepare: {
          baseChoices: [{ target: { kind: 'shot', shotId: 'shot_2' }, purpose: 'seed_still' }],
          cascadeChoices: [],
        },
      },
    });
  });

  it('rederives an existing-predecessor follower against the current replacement take', () => {
    const value = project();
    addBeat(value, [shot('shot_1', 15), shot('shot_2', 15)]);
    addVideoAttempt(value, 'shot_1', 'existing_old', 'succeeded', null, true);
    const follower = addVideoAttempt(value, 'shot_2', 'existing_follower', 'failed', {
      code: 'dependency_failed',
      messageKey: 'safe',
    });
    makeExistingPredecessorPlan(value, follower, 'shot_1', 'asset_existing_old', 15);
    addVideoAttempt(value, 'shot_1', 'existing_new', 'succeeded', null, true);

    expect(stage(projectStudioStatusV2(value, readyRoutes()), 'production').blockers[0]?.remedy).toEqual({
      kind: 'owner_only',
      reason: 'review_project_data',
    });

    addReadyConditioningFrame(value, 'shot_1', 'asset_existing_new', 15, 'frame_existing_new');
    expect(stage(projectStudioStatusV2(value, readyRoutes()), 'production').blockers[0]).toMatchObject({
      where: { kind: 'shot', shotId: 'shot_2', jobId: follower.id },
      remedy: {
        kind: 'proposal',
        prepare: {
          baseChoices: [{ target: { kind: 'shot', shotId: 'shot_2' }, purpose: 'video_take' }],
          cascadeChoices: [],
        },
      },
    });

    value.shots.shot_1!.trimOutSeconds = 1;
    expect(stage(projectStudioStatusV2(value, readyRoutes()), 'production').blockers[0]?.remedy).toEqual({
      kind: 'owner_only',
      reason: 'review_project_data',
    });
  });

  it('reports the exact effective ordinary seed and falls back after a dismissed pin', () => {
    const explicit = project();
    explicit.brief = '';
    addBeat(explicit, [shot('shot_1', 30)]);
    addSeedImage(explicit, 'shot_1', 'seed_explicit');
    explicit.shots.shot_1!.seedStillId = 'seed_explicit';
    const explicitStatus = projectStudioStatusV2(explicit, readyRoutes(), { detail: true });
    expect(stage(explicitStatus, 'brief').state).toBe('not_started');
    expect(explicitStatus.detail?.shots[0]?.seedStillAssetId).toBe('seed_explicit');

    const value = project();
    addBeat(value, [shot('shot_1', 30)]);
    addSeedImage(value, 'shot_1', 'seed_A', '2026-08-27T00:00:01.000Z');
    addSeedImage(value, 'shot_1', 'seed_Z', '2026-08-27T00:00:01.000Z');
    value.shots.shot_1!.seedStillId = 'seed_Z';
    value.shots.shot_1!.dismissedSeedStillIds = ['seed_Z'];
    const status = projectStudioStatusV2(value, readyRoutes(), { detail: true });
    expect(stage(status, 'production').blockers).toEqual([]);
    expect(status.detail?.shots[0]?.seedStillAssetId).toBe('seed_A');
  });

  it('distinguishes an authorized seed selection from paid seed generation and rejects a dismissed Board pin', () => {
    const authorized = project();
    addBeat(authorized, [shot('shot_1', 30)]);
    const seedJob = addGeneratedSeedAttempt(authorized, 'shot_1', 'authorized_seed');
    const videoJob = addVideoAttempt(authorized, 'shot_1', 'authorized_video', 'waiting_for_conditioning');
    makeAuthorizedSeedPlan(authorized, videoJob, 'shot_1', seedJob.authorizationItemId);
    mergeAuthorizationChain(authorized, seedJob, [videoJob]);

    expect(stage(projectStudioStatusV2(authorized, readyRoutes()), 'production').blockers).toEqual([
      expect.objectContaining({
        cause: 'seed_selection_required',
        where: expect.objectContaining({ shotId: 'shot_1', jobId: seedJob.id }),
        remedy: { kind: 'owner_only', reason: 'select_seed' },
      }),
    ]);

    authorized.shots.shot_1!.seedStillId = 'asset_authorized_seed';
    expect(stage(projectStudioStatusV2(authorized, readyRoutes()), 'production')).toMatchObject({
      state: 'in_progress',
      blockers: [],
      summary: { activeJobCount: 1 },
    });

    const dismissedBoard = project();
    addBeat(dismissedBoard, [shot('shot_1', 30)]);
    addBoardImage(dismissedBoard, 'shot_1', 'board_seed');
    dismissedBoard.shots.shot_1!.seedStillId = 'board_seed';
    dismissedBoard.shots.shot_1!.dismissedSeedStillIds = ['board_seed'];
    expect(stage(projectStudioStatusV2(dismissedBoard, readyRoutes()), 'production').blockers[0]).toMatchObject({
      cause: 'seed_generation_required',
      remedy: { kind: 'proposal', prepare: { baseChoices: [{ purpose: 'seed_still' }] } },
    });
  });

  it('treats current seed work as the segment authority without duplicate paid proposals', () => {
    const running = project();
    addBeat(running, [shot('shot_1', 30)]);
    addVideoAttempt(running, 'shot_1', 'older_video_failure', 'failed', {
      code: 'provider_unavailable',
      messageKey: 'safe',
    });
    const runningSeed = addSeedAttempt(running, 'shot_1', 'seed_running', 'running');
    const runningStatus = projectStudioStatusV2(running, readyRoutes(), { detail: true });
    expect(stage(runningStatus, 'production')).toMatchObject({
      state: 'in_progress',
      blockers: [],
      summary: { activeJobCount: 1 },
    });
    expect(runningStatus.detail?.shots[0]?.latestGenerationJob).toEqual({
      jobId: runningSeed.id,
      purpose: 'seed_still',
      status: 'running',
      errorCode: null,
    });

    const failed = project();
    addBeat(failed, [shot('shot_1', 30)]);
    const failedSeed = addSeedAttempt(failed, 'shot_1', 'seed_failed', 'failed', {
      code: 'provider_unavailable',
      messageKey: 'safe',
    });
    expect(stage(projectStudioStatusV2(failed, readyRoutes()), 'production').blockers).toEqual([
      {
        cause: 'generation_provider_unavailable',
        where: expect.objectContaining({ kind: 'shot', shotId: 'shot_1', jobId: failedSeed.id }),
        remedy: {
          kind: 'proposal',
          prepare: {
            kind: 'generation',
            baseChoices: [{ target: { kind: 'shot', shotId: 'shot_1' }, purpose: 'seed_still' }],
            cascadeChoices: [],
            continuityChange: null,
          },
          estimatedMinorUnits: null,
          currency: null,
        },
      },
    ]);

    addSeedImage(failed, 'shot_1', 'seed_imported_after_failure');
    failed.shots.shot_1!.seedStillId = 'seed_imported_after_failure';
    const importedStatus = projectStudioStatusV2(failed, readyRoutes(), { detail: true });
    expect(stage(importedStatus, 'production').blockers).toEqual([]);
    expect(importedStatus.detail?.shots[0]?.latestGenerationJob).toEqual({
      jobId: failedSeed.id,
      purpose: 'seed_still',
      status: 'failed',
      errorCode: 'provider_unavailable',
    });

    const competing = project();
    addBeat(competing, [shot('shot_1', 30)]);
    addVideoAttempt(competing, 'shot_1', 'old_succeeded_video', 'succeeded');
    const failedCurrentSeed = addSeedAttempt(competing, 'shot_1', 'new_failed_seed', 'failed', {
      code: 'quota',
      messageKey: 'safe',
    });
    expect(stage(projectStudioStatusV2(competing, readyRoutes()), 'production').blockers[0]).toMatchObject({
      cause: 'generation_quota',
      where: { kind: 'shot', shotId: 'shot_1', jobId: failedCurrentSeed.id },
      remedy: { kind: 'proposal', prepare: { baseChoices: [{ purpose: 'seed_still' }] } },
    });

    const authorizedFailure = project();
    addBeat(authorizedFailure, [shot('shot_1', 30)]);
    const failedAuthorizedSeed = addSeedAttempt(authorizedFailure, 'shot_1', 'authorized_failed_seed', 'failed', {
      code: 'provider_unavailable',
      messageKey: 'safe',
    });
    const failedWaitingVideo = addVideoAttempt(authorizedFailure, 'shot_1', 'authorized_dependency_video', 'failed', {
      code: 'dependency_failed',
      messageKey: 'safe',
    });
    makeAuthorizedSeedPlan(authorizedFailure, failedWaitingVideo, 'shot_1', failedAuthorizedSeed.authorizationItemId);
    mergeAuthorizationChain(authorizedFailure, failedAuthorizedSeed, [failedWaitingVideo]);
    expect(stage(projectStudioStatusV2(authorizedFailure, readyRoutes()), 'production').blockers[0]).toMatchObject({
      cause: 'generation_provider_unavailable',
      where: { kind: 'shot', shotId: 'shot_1', jobId: failedAuthorizedSeed.id },
      remedy: { kind: 'proposal', prepare: { baseChoices: [{ purpose: 'seed_still' }] } },
    });
  });

  it('classifies invalid media and a short canonical bed as exact Cut blockers', () => {
    const invalid = project();
    addBeat(invalid, [shot('shot_1', 30)]);
    addVideoAttempt(invalid, 'shot_1', 'invalid_media', 'succeeded', null, true);
    invalid.shots.shot_1!.trimInSeconds = 31;
    expect(stage(projectStudioStatusV2(invalid, readyRoutes()), 'cut').blockers[0]?.cause).toBe('cut_invalid_media');

    const shortBed = project();
    addBeat(shortBed, [shot('shot_1', 30)]);
    addVideoAttempt(shortBed, 'shot_1', 'with_bed', 'succeeded', null, true);
    shortBed.bedAssetId = 'bed_1';
    shortBed.assets.bed_1 = {
      id: 'bed_1',
      projectId: shortBed.id,
      shotId: null,
      mediaKind: 'audio',
      mimeType: 'audio/wav',
      managedAsset: { collection: 'imports', fileName: 'bed_1.wav' },
      byteSize: 100,
      sha256: digest,
      durationSeconds: 10,
      createdAt: timestamp,
      projectReferenceId: null,
      generationReferenceAssetIds: [],
      producerJobId: null,
      compositionDigest: null,
    };
    expect(stage(projectStudioStatusV2(shortBed, readyRoutes()), 'cut').blockers[0]?.cause).toBe('cut_bed_too_short');
  });

  it('fails closed over malformed Beat, Shot, and reference-plan topology without throwing', () => {
    const missingBeat = project();
    missingBeat.beatOrder = ['missing_beat'];
    expect(stage(projectStudioStatusV2(missingBeat, readyRoutes()), 'storyboard')).toMatchObject({
      state: 'in_progress',
      summary: { beatCount: 1, shotCount: 0 },
    });

    const missingShot = project();
    addBeat(missingShot, [shot('shot_1', 30)]);
    delete missingShot.shots.shot_1;
    expect(stage(projectStudioStatusV2(missingShot, readyRoutes()), 'storyboard')).toMatchObject({
      state: 'in_progress',
      summary: { authoredShotCount: 0 },
    });

    const duplicate = project();
    addReference(duplicate, 'character_1', 'character');
    duplicate.referenceOrder.push('character_1');
    expect(stage(projectStudioStatusV2(duplicate, readyRoutes()), 'references').blockers[0]?.cause).toBe(
      'reference_plan_invalid'
    );

    const extra = project();
    addReference(extra, 'character_1', 'character');
    extra.references.character_2 = { ...extra.references.character_1!, id: 'character_2' };
    expect(stage(projectStudioStatusV2(extra, readyRoutes()), 'references').blockers[0]?.cause).toBe(
      'reference_plan_invalid'
    );

    const missingReference = project();
    addReference(missingReference, 'character_1', 'character');
    delete missingReference.references.character_1;
    expect(stage(projectStudioStatusV2(missingReference, readyRoutes()), 'references').blockers[0]?.cause).toBe(
      'reference_plan_invalid'
    );
  });

  it('covers the video half-selection and nonblocking inventory-in-progress states', () => {
    const half = project();
    half.videoRouteId = null;
    const halfRoutes = readyRoutes();
    if (halfRoutes.status !== 'available') throw new Error('Expected route catalog');
    halfRoutes.catalog.video = unavailableRoute('selection_required', null);
    expect(stage(projectStudioStatusV2(half, halfRoutes), 'engines').blockers).toContainEqual({
      cause: 'route_not_selected',
      where: { kind: 'route', routeKind: 'video' },
      remedy: { kind: 'owner_only', reason: 'select_engine' },
    });

    const pending = project();
    const pendingRoutes = readyRoutes();
    if (pendingRoutes.status !== 'available') throw new Error('Expected route catalog');
    pendingRoutes.catalog.image = unavailableRoute('selection_required', null);
    expect(stage(projectStudioStatusV2(pending, pendingRoutes), 'engines')).toMatchObject({
      state: 'in_progress',
      blockers: [],
    });
  });

  it('counts a canonical Board independently, accepts an explicit Board seed, and reports Cut target drift', () => {
    const value = project();
    addBeat(value, [shot('shot_1', 29)]);
    addBoardImage(value, 'shot_1', 'board_1');
    value.shots.shot_1!.seedStillId = 'board_1';
    addVideoAttempt(value, 'shot_1', 'cut_drift', 'succeeded', null, true);
    const status = projectStudioStatusV2(value, readyRoutes(), { detail: true });
    expect(status.boards).toEqual({ currentPictureCount: 1, shotCount: 1 });
    expect(status.detail?.shots[0]?.seedStillAssetId).toBe('board_1');
    expect(stage(status, 'cut')).toMatchObject({ state: 'in_progress', summary: { structurallyPlayable: true } });
    expect(status.advisories).toContainEqual({
      cause: 'target_duration_mismatch',
      stage: 'cut',
      actualSeconds: 29,
      targetSeconds: 30,
    });
  });

  it('suppresses inadmissible paid reference retries while upstream route authority is blocked', () => {
    const value = project();
    addBeat(value, [shot('shot_1', 30)]);
    addReference(value, 'character_1', 'character');
    addReferenceJob(value, 'character_1', 'blocked_reference', 'failed', {
      code: 'provider_unavailable',
      messageKey: 'safe',
    });
    const routes = readyRoutes(route('image', { aspectRatios: ['1:1'] }));
    expect(stage(projectStudioStatusV2(value, routes), 'references').blockers[0]?.remedy).toEqual({
      kind: 'owner_only',
      reason: 'review_project_data',
    });

    const missing = project();
    addReference(missing, 'character_1', 'character');
    const unavailable = readyRoutes();
    if (unavailable.status !== 'available') throw new Error('Expected route catalog');
    unavailable.catalog.image = unavailableRoute('unavailable', null);
    expect(stage(projectStudioStatusV2(missing, unavailable), 'references')).toMatchObject({
      state: 'in_progress',
      blockers: [],
    });
  });

  it('is deterministic and pure for a rich project projection', () => {
    const value = project();
    addReference(value, 'character_1', 'character', { assetId: 'asset_character_1' });
    addBeat(value, [
      shot('shot_1', 15, {
        referenceBinding: {
          status: 'ready',
          characterReferenceIds: ['character_1'],
          backgroundReferenceId: null,
        },
      }),
      shot('shot_2', 15, {
        referenceBinding: {
          status: 'ready',
          characterReferenceIds: ['character_1'],
          backgroundReferenceId: null,
        },
      }),
    ]);
    addSeedImage(value, 'shot_1', 'seed_1');
    value.shots.shot_1!.seedStillId = 'seed_1';
    addVideoAttempt(value, 'shot_1', 'purity_take', 'succeeded', null, true);
    addReadyConditioningFrame(value, 'shot_1', 'asset_purity_take', 15, 'frame_purity');
    const original = structuredClone(value);

    const first = projectStudioStatusV2(value, readyRoutes(), { detail: true });
    const second = projectStudioStatusV2(value, readyRoutes(), { detail: true });

    expect(second).toEqual(first);
    expect(value).toEqual(original);
  });
});
