/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  StudioCascadeProgressV2,
  StudioAssetV2,
  StudioBeat,
  StudioBinItem,
  StudioPlanningShotBoundaryV2,
  StudioProjectStatusStageIdV2,
  StudioProjectStatusStageStateV2,
  StudioProjectStatusStageV2,
  StudioProjectStatusV2,
  StudioRendererBoardPanelStatusV2,
  StudioRendererChainBoundaryV2,
  StudioRendererChainConditioningFailureV2,
  StudioRendererChainStatusV2,
  StudioRendererDirtyShotV2,
  StudioRendererJobV2,
  StudioRendererParkEligibilityV2,
  StudioRendererProjectV2,
  StudioRendererUndoTopV2,
  StudioRendererWorkspaceStatusV2,
  StudioShot,
  StudioView,
} from '@/common/types/project/creativeStudioTypes';
import {
  STUDIO_BED_FADE_OUT_SECONDS,
  STUDIO_FILM_EXPORT_FRAME_RATE,
  STUDIO_MAX_MUTATION_OPERATIONS,
  STUDIO_MAX_PROJECT_REFERENCES,
  STUDIO_PROJECT_STATUS_BLOCKER_CAUSES_V2,
  STUDIO_PROJECT_STATUS_STAGE_ORDER_V2,
} from '@/common/types/project/creativeStudioTypes';
import { isCanonicalStudioGeneratedTakeV2 } from '@/common/types/project/creativeStudioCanonicalTake';
import {
  exactStudioProjectStatusV2,
  studioPlanningShotBoundariesV2,
  studioShotPlayedDurationV2,
} from '@/common/types/project/creativeStudioProjectSummary';
import { deriveWorkspaceShotSegmentState, type WorkspaceShotSegmentState } from './BeatPanel/segmentState';

export type WorkspaceShotDisplayState = 'draft' | 'seed_ready' | 'rendered';

export type WorkspaceBeatDisplayState =
  | 'duration_pending'
  | 'no_coverage'
  | 'part_done'
  | 'needs_attention'
  | 'rendering'
  | 'stale'
  | 'seed_pending'
  | 'status_pending'
  | 'ready'
  | 'draft';

export type WorkspaceSeedStillProjection = {
  assetId: string;
  createdAt: string;
  explicitSeed: boolean;
  effectiveSeed: boolean;
  origin: 'generated' | 'imported' | 'board' | 'inherited';
  prompt: string | null;
  promptChanged: boolean;
  sourceShotNumber: number | null;
  firstFrameChanged: boolean;
};

export type WorkspaceSeedAuthorizationLockProjection = {
  compatibleAssetIds: string[];
  canCancelWaiting: boolean;
  waitingReason: 'upstream_running' | 'choose_seed';
};

export type WorkspaceCurrentPictureProjection = {
  assetId: string;
  sourceDurationSeconds: number;
  posterAssetId: string | null;
  createdAt: string;
  prompt: string;
  promptChanged: boolean;
  firstFrameChanged: boolean;
};

export type WorkspaceBoardPanelFreshness = 'missing' | 'current' | 'stale' | 'status_pending';

export type WorkspaceBoardPanelActivity =
  | 'idle'
  | 'queued'
  | 'drawing'
  | 'needs_attention'
  | 'failed'
  | 'cancelled'
  | 'status_pending';

export type WorkspaceBoardPanelRecoveryProjection = {
  jobId: string;
  canRetry: boolean;
  canCancel: boolean;
  canRetryDownload: boolean;
  submissionUnknown: boolean;
};

export type WorkspaceBoardPanelProjection = StudioRendererBoardPanelStatusV2 & {
  freshness: WorkspaceBoardPanelFreshness;
  activity: WorkspaceBoardPanelActivity;
  recovery: WorkspaceBoardPanelRecoveryProjection | null;
};

export type WorkspaceAttentionJobProjection = Pick<StudioRendererJobV2, 'id' | 'error' | 'canCancel' | 'canRetry'> & {
  purpose: 'seed_still' | 'video_take';
};

export type WorkspaceShotProjection = {
  id: string;
  shootingScript: string;
  durationSeconds: number;
  chainBreak: StudioShot['chainBreak'];
  trimInSeconds: number | null;
  trimOutSeconds: number | null;
  currentPicture: WorkspaceCurrentPictureProjection | null;
  playedDurationSeconds: number | null;
  explicitSeedAssetId: string | null;
  effectiveSeedAssetId: string | null;
  seedAuthorityStatusReady: boolean;
  seedAuthorizationLock: WorkspaceSeedAuthorizationLockProjection | null;
  segmentHead: boolean;
  planningBoundary: StudioPlanningShotBoundaryV2 | null;
  frameBoundary: StudioRendererChainBoundaryV2 | null;
  segmentState: WorkspaceShotSegmentState;
  dirtyCauses: StudioRendererDirtyShotV2['causes'];
  downstreamShotIds: string[];
  seedStills: WorkspaceSeedStillProjection[];
  firstFrames: WorkspaceSeedStillProjection[];
  generationProgressPercent: number | null;
  activeGenerationJob: { id: string; purpose: 'seed_still' | 'video_take'; canCancel: boolean } | null;
  coverAssetId: string | null;
  displayState: WorkspaceShotDisplayState;
  retainedWork: boolean;
  videoGenerationInFlight: boolean;
  seedGenerationInFlight: boolean;
  /** True while a job blocks a fresh submission, including one that failed and needs the user. */
  videoGenerationBlocked: boolean;
  seedGenerationBlocked: boolean;
  attentionJobs: WorkspaceAttentionJobProjection[];
  /** Exact current video wave ended after a real provider attempt failed or needs attention. */
  latestVideoAttemptFailed: boolean;
  hasEffectiveSeed: boolean;
};

export type WorkspaceBeatProjection = {
  id: string;
  title: string;
  story: string;
  targetSeconds: number | null;
  /** Main-model planning sum derived once from the canonical active Shot boundaries. */
  sumSeconds: number | null;
  actualSeconds: number | null;
  displayState: WorkspaceBeatDisplayState;
  shots: WorkspaceShotProjection[];
  coverAssetId: string | null;
  retainedWork: boolean;
};

export type WorkspaceBinnedBeatProjection = WorkspaceBeatProjection & {
  reason: Extract<StudioBinItem, { kind: 'beat' }>['reason'];
  shotCount: number;
};

export type WorkspaceBinnedShotProjection = WorkspaceShotProjection & {
  beatId: string;
  beatTitle: string;
  ownerBeatBinned: boolean;
  reason: Extract<StudioBinItem, { kind: 'shot' }>['reason'];
};

export type WorkspaceBinItemProjection =
  | {
      kind: 'beat';
      position: number;
      identity: Extract<StudioBinItem, { kind: 'beat' }>;
      value: WorkspaceBinnedBeatProjection;
    }
  | {
      kind: 'shot';
      position: number;
      identity: Extract<StudioBinItem, { kind: 'shot' }>;
      value: WorkspaceBinnedShotProjection;
    };

export type WorkspaceCutBeatDurationKind = 'actual' | 'target' | 'pending';

export type WorkspaceCutBeatProjection = {
  id: string;
  title: string;
  shotCount: number;
  durationKind: WorkspaceCutBeatDurationKind;
  durationSeconds: number | null;
  coverAssetId: string | null;
};

export type WorkspaceCutAudioImportProjection = {
  assetId: string;
  position: number;
  durationSeconds: number;
  byteSize: number;
  createdAt: string;
};

export type WorkspaceCutBedProjection =
  | { status: 'none'; assetId: null }
  | { status: 'invalid'; assetId: string }
  | {
      status: 'duration_pending';
      assetId: string;
      sourceDurationSeconds: number;
    }
  | {
      status: 'too_short';
      assetId: string;
      sourceDurationSeconds: number;
      requiredDurationSeconds: number;
    }
  | {
      status: 'ready';
      assetId: string;
      sourceDurationSeconds: number;
      fadeOutStartSeconds: number;
      fadeOutEndSeconds: number;
    };

export type WorkspaceCutCoverCandidateProjection = {
  shotId: string;
  beatId: string;
  beatTitle: string;
  shootingScript: string;
  coverAssetId: string | null;
};

export type WorkspaceCutProjection = {
  orderReady: boolean;
  beats: WorkspaceCutBeatProjection[];
  filmDurationSeconds: number | null;
  /** The authored target the film is judged against. Null when the project's own target is unusable. */
  targetDurationSeconds: number | null;
  audioImports: WorkspaceCutAudioImportProjection[];
  bed: WorkspaceCutBedProjection;
  coverCandidates: WorkspaceCutCoverCandidateProjection[];
};

export type WorkspaceProjection = {
  projectId: string;
  projectRevision: number;
  activeBeats: WorkspaceBeatProjection[];
  activeBeatIds: string[];
  activeShotIds: string[];
  coverageGapBeatIds: string[];
  /** Active Shots with no authored shooting script, in exact film order. */
  unscriptedShotIds: string[];
  workspaceStatusReady: boolean;
  chainStatusReady: boolean;
  requestShapeLocked: boolean;
  cut: WorkspaceCutProjection;
  bin: {
    items: WorkspaceBinItemProjection[];
    beats: WorkspaceBinnedBeatProjection[];
    shots: WorkspaceBinnedShotProjection[];
  };
  undoTop: StudioRendererUndoTopV2 | null;
  boardPanels: WorkspaceBoardPanelProjection[];
  dirtyShots: StudioRendererDirtyShotV2[];
  cascadeProgress: StudioCascadeProgressV2[];
  parkEligibility: StudioRendererParkEligibilityV2[];
  conditioningFailures: StudioRendererChainConditioningFailureV2[];
};

const SAFE_STUDIO_ID = /^[A-Za-z0-9_-]{1,256}$/;

const isSafeStudioId = (value: unknown): value is string => typeof value === 'string' && SAFE_STUDIO_ID.test(value);

const isDisplayText = (value: unknown): value is string => typeof value === 'string';

const isDisplayTimestamp = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= 64 && Number.isFinite(Date.parse(value));

const ownValue = <Value>(record: Readonly<Record<string, Value>>, id: string): Value | undefined =>
  Object.hasOwn(record, id) ? record[id] : undefined;

const isOwnedAsset = (project: StudioRendererProjectV2, shot: StudioShot, assetId: string): StudioAssetV2 | null => {
  const asset = ownValue(project.assets, assetId);
  return isSafeStudioId(assetId) &&
    asset?.id === assetId &&
    asset.projectId === project.id &&
    asset.shotId === shot.id &&
    isDisplayTimestamp(asset.createdAt)
    ? asset
    : null;
};

const producingJobForAsset = (
  project: StudioRendererProjectV2,
  shot: StudioShot,
  assetId: string
): StudioRendererJobV2 | null => {
  const matches = shot.jobIds.flatMap((jobId) => {
    const job = ownValue(project.jobs, jobId);
    return job?.id === jobId &&
      job.projectId === project.id &&
      job.target.kind === 'shot' &&
      job.target.shotId === shot.id &&
      job.status === 'succeeded' &&
      job.outputAssetIdsByRole.primary === assetId &&
      job.outputAssetIds.filter((candidate) => candidate === assetId).length === 1
      ? [job]
      : [];
  });
  return matches.length === 1 ? matches[0]! : null;
};

/** Returns the Shot-authored prompt frozen by the unique job that produced this exact asset. */
const producingShotScriptForAsset = (
  project: StudioRendererProjectV2,
  shot: StudioShot,
  assetId: string
): string | null => {
  const source = producingJobForAsset(project, shot, assetId)?.composition?.inputs?.source;
  return source?.kind === 'shot' && source.shotId === shot.id && isDisplayText(source.shootingScript)
    ? source.shootingScript
    : null;
};

const videoPosterId = (project: StudioRendererProjectV2, shot: StudioShot, videoTake: StudioAssetV2): string | null => {
  const producingJobs = shot.jobIds.flatMap((jobId) => {
    const job = ownValue(project.jobs, jobId);
    return job?.id === jobId &&
      job.projectId === project.id &&
      job.target.kind === 'shot' &&
      job.target.shotId === shot.id &&
      job.status === 'succeeded' &&
      job.purpose === 'video_take' &&
      job.outputAssetIdsByRole.primary === videoTake.id &&
      job.outputAssetIds.filter((assetId) => assetId === videoTake.id).length === 1
      ? [job]
      : [];
  });
  if (producingJobs.length !== 1) return null;

  const producingJob = producingJobs[0]!;
  const posterId = producingJob.outputAssetIdsByRole.poster;
  if (posterId === null || producingJob.outputAssetIds.filter((assetId) => assetId === posterId).length !== 1) {
    return null;
  }
  const poster = isOwnedAsset(project, shot, posterId);
  return poster !== null &&
    poster.mediaKind === 'image' &&
    poster.managedAsset.collection === 'thumbnails' &&
    shot.assetIds.includes(poster.id)
    ? poster.id
    : null;
};

const isProjectReferenceOutput = (project: StudioRendererProjectV2, _shot: StudioShot, assetId: string): boolean =>
  ownValue(project.assets, assetId)?.projectReferenceId !== null;

const isEligibleImageTake = (project: StudioRendererProjectV2, shot: StudioShot, asset: StudioAssetV2): boolean =>
  asset.mediaKind === 'image' &&
  (asset.managedAsset.collection === 'assets' || asset.managedAsset.collection === 'imports') &&
  asset.projectId === project.id &&
  asset.shotId === shot.id &&
  !isProjectReferenceOutput(project, shot, asset.id) &&
  shot.assetIds.includes(asset.id);

const validVideoSourceDuration = (asset: StudioAssetV2): number | null =>
  asset.mediaKind === 'video' &&
  asset.durationSeconds !== undefined &&
  Number.isFinite(asset.durationSeconds) &&
  asset.durationSeconds > 0 &&
  asset.durationSeconds <= Number.MAX_SAFE_INTEGER
    ? asset.durationSeconds
    : null;

const validCurrentVideo = (project: StudioRendererProjectV2, shot: StudioShot): StudioAssetV2 | null => {
  if (shot.videoAssetId === null) return null;
  const current = isOwnedAsset(project, shot, shot.videoAssetId);
  return current !== null &&
    current.mediaKind === 'video' &&
    isCanonicalStudioGeneratedTakeV2(current, project.id, shot) &&
    validVideoSourceDuration(current) !== null
    ? current
    : null;
};

const validExplicitSeedStillId = (project: StudioRendererProjectV2, shot: StudioShot): string | null => {
  if (shot.seedStillId === null) return null;
  const seed = isOwnedAsset(project, shot, shot.seedStillId);
  return seed !== null &&
    seed.mediaKind === 'image' &&
    (seed.managedAsset.collection === 'assets' ||
      seed.managedAsset.collection === 'imports' ||
      seed.managedAsset.collection === 'boardStills') &&
    !isProjectReferenceOutput(project, shot, seed.id) &&
    shot.assetIds.includes(seed.id)
    ? seed.id
    : null;
};

const effectiveSeedStillId = (project: StudioRendererProjectV2, shot: StudioShot): string | null => {
  const explicit =
    shot.seedStillId !== null && shot.dismissedSeedStillIds.includes(shot.seedStillId)
      ? null
      : validExplicitSeedStillId(project, shot);
  if (explicit !== null) return explicit;
  const candidates = shot.assetIds.flatMap((assetId) => {
    if (shot.dismissedSeedStillIds.includes(assetId)) return [];
    const asset = isOwnedAsset(project, shot, assetId);
    return asset !== null && isEligibleImageTake(project, shot, asset) ? [asset] : [];
  });
  candidates.sort((left, right) =>
    left.createdAt === right.createdAt
      ? left.id < right.id
        ? 1
        : left.id > right.id
          ? -1
          : 0
      : left.createdAt < right.createdAt
        ? 1
        : -1
  );
  return candidates[0]?.id ?? null;
};

const compareSeedStillNewestFirst = (
  left: WorkspaceSeedStillProjection,
  right: WorkspaceSeedStillProjection
): number => {
  if (left.createdAt !== right.createdAt) return left.createdAt < right.createdAt ? 1 : -1;
  if (left.assetId === right.assetId) return 0;
  return left.assetId < right.assetId ? 1 : -1;
};

const projectSeedStills = (input: {
  project: StudioRendererProjectV2;
  shot: StudioShot;
  explicitSeedAssetId: string | null;
  effectiveSeedAssetId: string | null;
  firstFrameChanged: boolean;
}): WorkspaceSeedStillProjection[] => {
  const seedStills: WorkspaceSeedStillProjection[] = [];
  for (const assetId of new Set(input.shot.assetIds)) {
    if (input.shot.dismissedSeedStillIds.includes(assetId)) continue;
    const asset = isOwnedAsset(input.project, input.shot, assetId);
    if (asset === null) continue;
    if (
      isEligibleImageTake(input.project, input.shot, asset) ||
      (asset.id === input.explicitSeedAssetId &&
        asset.mediaKind === 'image' &&
        asset.managedAsset.collection === 'boardStills')
    ) {
      const prompt = producingShotScriptForAsset(input.project, input.shot, asset.id);
      seedStills.push({
        assetId: asset.id,
        createdAt: asset.createdAt,
        explicitSeed: input.explicitSeedAssetId === asset.id,
        effectiveSeed: input.effectiveSeedAssetId === asset.id,
        origin:
          asset.managedAsset.collection === 'imports'
            ? 'imported'
            : asset.managedAsset.collection === 'boardStills'
              ? 'board'
              : 'generated',
        prompt,
        promptChanged: prompt !== null && prompt !== input.shot.shootingScript,
        sourceShotNumber: null,
        firstFrameChanged: input.effectiveSeedAssetId === asset.id && input.firstFrameChanged,
      });
    }
  }
  seedStills.sort(compareSeedStillNewestFirst);
  return seedStills;
};

const hasOwnedShotJob = (project: StudioRendererProjectV2, shot: StudioShot): boolean =>
  shot.jobIds.some((jobId) => {
    const job = ownValue(project.jobs, jobId);
    return (
      job?.id === jobId && job.projectId === project.id && job.target.kind === 'shot' && job.target.shotId === shot.id
    );
  });

/**
 * Statuses where work is genuinely still happening.
 *
 * `needs_attention` is deliberately absent: such a job has already finished and failed — one was
 * observed carrying `provider_unavailable` against a real `providerJobId` — so counting it here
 * showed a Beat as "Rendering" for thirty-five minutes on a render that ended after nine.
 */
const GENERATION_IN_FLIGHT_STATUSES = new Set([
  'waiting_for_conditioning',
  'queued_local',
  'submitting',
  'queued_remote',
  'running',
]);

/**
 * Statuses that must stop a fresh submission for the same shot.
 *
 * A job needing attention may already have been charged — the record carries
 * `duplicateChargeAcknowledged` for exactly that reason — so it blocks even though it is not
 * running. Showing it honestly must not make it silently re-submittable.
 */
const GENERATION_BLOCKING_STATUSES = new Set([...GENERATION_IN_FLIGHT_STATUSES, 'needs_attention']);

const hasOwnedGenerationWithStatus = (
  project: StudioRendererProjectV2,
  shot: StudioShot,
  purpose: 'seed_still' | 'video_take',
  statuses: ReadonlySet<string>
): boolean => {
  return shot.jobIds.some((jobId) => {
    const job = ownValue(project.jobs, jobId);
    return (
      job?.id === jobId &&
      job.projectId === project.id &&
      job.target.kind === 'shot' &&
      job.target.shotId === shot.id &&
      job.purpose === purpose &&
      statuses.has(job.status)
    );
  });
};

const ownedAttentionJobs = (project: StudioRendererProjectV2, shot: StudioShot): WorkspaceAttentionJobProjection[] =>
  shot.jobIds.flatMap((jobId) => {
    const job = ownValue(project.jobs, jobId);
    const recoverableAttention = job?.status === 'needs_attention' && (job.canRetry || job.canCancel);
    const actionableContentRefusal = job?.status === 'failed' && job.error?.code === 'content_rejected';
    return job?.id === jobId &&
      job.projectId === project.id &&
      job.target.kind === 'shot' &&
      job.target.shotId === shot.id &&
      job.error !== null &&
      (job.purpose === 'seed_still' || job.purpose === 'video_take') &&
      (recoverableAttention || actionableContentRefusal)
      ? [
          {
            id: job.id,
            purpose: job.purpose,
            error: { ...job.error },
            canCancel: job.canCancel,
            canRetry: job.canRetry,
          },
        ]
      : [];
  });

const projectShot = (
  project: StudioRendererProjectV2,
  shot: StudioShot,
  context: {
    segmentHead: boolean;
    planningBoundary: StudioPlanningShotBoundaryV2 | null;
    frameBoundary: StudioRendererChainBoundaryV2 | null;
    dirtyCauses: ReadonlyArray<StudioRendererDirtyShotV2['causes'][number]>;
    downstreamShotIds: readonly string[];
    segmentStatusReady: boolean;
    cascadeStatusReady: boolean;
    cascade: StudioCascadeProgressV2 | null;
    upstreamShotNumber: number | null;
    predecessorShotNumber: number | null;
    conditioningFailed: boolean;
    currentVideoJobs: readonly StudioRendererJobV2[] | null;
  }
): WorkspaceShotProjection => {
  const explicitSeedAssetId = validExplicitSeedStillId(project, shot);
  const seedAuthorizationLock: WorkspaceSeedAuthorizationLockProjection | null =
    context.segmentHead &&
    context.cascade?.dependentShotId === shot.id &&
    context.cascade.upstreamShotId === shot.id &&
    (context.cascade.waitingReason === 'upstream_running' || context.cascade.waitingReason === 'choose_seed')
      ? {
          compatibleAssetIds: [...context.cascade.eligiblePrimaryAssetIds],
          canCancelWaiting: context.cascade.canCancelWaiting,
          waitingReason: context.cascade.waitingReason,
        }
      : null;
  const effectiveSeedAssetId = !context.segmentHead
    ? null
    : !context.cascadeStatusReady
      ? explicitSeedAssetId
      : seedAuthorizationLock === null
        ? effectiveSeedStillId(project, shot)
        : explicitSeedAssetId !== null && seedAuthorizationLock.compatibleAssetIds.includes(explicitSeedAssetId)
          ? explicitSeedAssetId
          : null;
  const currentVideo = validCurrentVideo(project, shot);
  const firstFrameChanged = context.dirtyCauses.includes('continuity_stale');
  const currentPictureFiredScript =
    currentVideo === null ? null : producingShotScriptForAsset(project, shot, currentVideo.id);
  const currentPicture =
    currentVideo === null
      ? null
      : {
          assetId: currentVideo.id,
          sourceDurationSeconds: validVideoSourceDuration(currentVideo)!,
          posterAssetId: videoPosterId(project, shot, currentVideo),
          createdAt: currentVideo.createdAt,
          prompt: currentPictureFiredScript ?? shot.shootingScript,
          promptChanged: currentPictureFiredScript !== null && currentPictureFiredScript !== shot.shootingScript,
          firstFrameChanged,
        };
  const seedStills = projectSeedStills({
    project,
    shot,
    explicitSeedAssetId,
    effectiveSeedAssetId,
    firstFrameChanged,
  });
  const inheritedFirstFrames: WorkspaceSeedStillProjection[] =
    !context.segmentHead && context.frameBoundary?.status === 'on_disk'
      ? [
          {
            assetId: context.frameBoundary.frameAssetId,
            createdAt: ownValue(project.assets, context.frameBoundary.frameAssetId)?.createdAt ?? project.updatedAt,
            explicitSeed: false,
            effectiveSeed: true,
            origin: 'inherited',
            prompt: null,
            promptChanged: false,
            sourceShotNumber: context.predecessorShotNumber,
            firstFrameChanged,
          },
        ]
      : [];
  const activeGenerationJobs = shot.jobIds.flatMap((jobId) => {
    const job = ownValue(project.jobs, jobId);
    return job?.id === jobId &&
      (job.purpose === 'seed_still' || job.purpose === 'video_take') &&
      GENERATION_IN_FLIGHT_STATUSES.has(job.status)
      ? [job]
      : [];
  });
  const activeGenerationJob =
    activeGenerationJobs.length === 1
      ? {
          id: activeGenerationJobs[0]!.id,
          purpose: activeGenerationJobs[0]!.purpose as 'seed_still' | 'video_take',
          canCancel: activeGenerationJobs[0]!.canCancel,
        }
      : null;
  const progress = activeGenerationJobs.length === 1 ? activeGenerationJobs[0]!.progress : undefined;
  const playedDurationSeconds = studioShotPlayedDurationV2(project, shot);
  const displayState: WorkspaceShotDisplayState =
    currentPicture !== null && playedDurationSeconds !== null
      ? 'rendered'
      : effectiveSeedAssetId !== null
        ? 'seed_ready'
        : 'draft';
  const segmentState = deriveWorkspaceShotSegmentState({
    statusReady: context.segmentStatusReady,
    cascade: context.cascade,
    upstreamShotNumber: context.upstreamShotNumber,
    conditioningFailed: context.conditioningFailed,
    expectsFrameBoundary: !context.segmentHead,
    frameBoundary: context.frameBoundary,
    currentVideoJobs: context.currentVideoJobs,
    dirtyCauses: context.dirtyCauses,
    hasCurrentPicture: currentPicture !== null,
  });
  const latestVideoAttemptFailed =
    (segmentState.kind === 'failed_unbilled' || segmentState.kind === 'needs_attention') &&
    context.currentVideoJobs?.some(
      (job) =>
        (job.status === 'failed' || job.status === 'needs_attention') &&
        job.error !== null &&
        job.error !== undefined &&
        job.error.code !== 'dependency_failed'
    ) === true;
  return {
    id: shot.id,
    shootingScript: shot.shootingScript,
    durationSeconds: shot.durationSeconds,
    chainBreak: shot.chainBreak,
    trimInSeconds: shot.trimInSeconds,
    trimOutSeconds: shot.trimOutSeconds,
    currentPicture,
    playedDurationSeconds,
    explicitSeedAssetId,
    effectiveSeedAssetId,
    seedAuthorityStatusReady: context.cascadeStatusReady,
    seedAuthorizationLock,
    segmentHead: context.segmentHead,
    planningBoundary: context.planningBoundary === null ? null : { ...context.planningBoundary },
    frameBoundary: context.frameBoundary === null ? null : { ...context.frameBoundary },
    segmentState,
    dirtyCauses: [...context.dirtyCauses],
    downstreamShotIds: [...context.downstreamShotIds],
    seedStills,
    firstFrames: context.segmentHead ? seedStills : inheritedFirstFrames,
    generationProgressPercent:
      typeof progress === 'number' && Number.isFinite(progress) && progress >= 0 && progress <= 100 ? progress : null,
    activeGenerationJob,
    coverAssetId: currentPicture?.posterAssetId ?? effectiveSeedAssetId,
    displayState,
    retainedWork:
      shot.assetIds.some(
        (assetId) => isOwnedAsset(project, shot, assetId) !== null && !isProjectReferenceOutput(project, shot, assetId)
      ) || hasOwnedShotJob(project, shot),
    videoGenerationInFlight: hasOwnedGenerationWithStatus(project, shot, 'video_take', GENERATION_IN_FLIGHT_STATUSES),
    seedGenerationInFlight: hasOwnedGenerationWithStatus(project, shot, 'seed_still', GENERATION_IN_FLIGHT_STATUSES),
    videoGenerationBlocked: hasOwnedGenerationWithStatus(project, shot, 'video_take', GENERATION_BLOCKING_STATUSES),
    seedGenerationBlocked: hasOwnedGenerationWithStatus(project, shot, 'seed_still', GENERATION_BLOCKING_STATUSES),
    attentionJobs: ownedAttentionJobs(project, shot),
    latestVideoAttemptFailed,
    hasEffectiveSeed: effectiveSeedAssetId !== null,
  };
};

const validBeat = (project: StudioRendererProjectV2, beatId: string): StudioBeat | null => {
  const beat = ownValue(project.beats, beatId);
  return isSafeStudioId(beatId) && beat?.id === beatId ? beat : null;
};

const validShot = (project: StudioRendererProjectV2, shotId: string): StudioShot | null => {
  const shot = ownValue(project.shots, shotId);
  return isSafeStudioId(shotId) && shot?.id === shotId ? shot : null;
};

const projectBeatActualSeconds = (project: StudioRendererProjectV2, beat: StudioBeat): number | null => {
  if (beat.shotOrder.length === 0) return null;
  let actualSeconds = 0;
  for (const shotId of beat.shotOrder) {
    const shot = validShot(project, shotId);
    if (shot === null) return null;
    const playedSeconds = studioShotPlayedDurationV2(project, shot);
    if (playedSeconds === null) return null;
    const nextActualSeconds = actualSeconds + playedSeconds;
    if (!Number.isFinite(nextActualSeconds) || nextActualSeconds < 0 || nextActualSeconds > Number.MAX_SAFE_INTEGER) {
      return null;
    }
    actualSeconds = nextActualSeconds;
  }
  return actualSeconds;
};

const validCutAudioImport = (
  project: StudioRendererProjectV2,
  assetId: string
): Omit<WorkspaceCutAudioImportProjection, 'position'> | null => {
  const asset = ownValue(project.assets, assetId);
  return asset?.id === assetId &&
    isSafeStudioId(assetId) &&
    asset.projectId === project.id &&
    asset.shotId === null &&
    asset.mediaKind === 'audio' &&
    asset.managedAsset?.collection === 'imports' &&
    typeof asset.mimeType === 'string' &&
    asset.mimeType.startsWith('audio/') &&
    Number.isSafeInteger(asset.byteSize) &&
    asset.byteSize > 0 &&
    asset.durationSeconds !== undefined &&
    Number.isFinite(asset.durationSeconds) &&
    asset.durationSeconds > 0 &&
    asset.durationSeconds <= Number.MAX_SAFE_INTEGER &&
    isDisplayTimestamp(asset.createdAt)
    ? {
        assetId,
        durationSeconds: asset.durationSeconds,
        byteSize: asset.byteSize,
        createdAt: asset.createdAt,
      }
    : null;
};

const projectCut = (
  project: StudioRendererProjectV2,
  activeBeats: readonly WorkspaceBeatProjection[]
): WorkspaceCutProjection => {
  const activeBeatIds = activeBeats.map((beat) => beat.id);
  const target = project.targetDurationSeconds;
  const targetDurationSeconds =
    Number.isFinite(target) && target > 0 && target <= Number.MAX_SAFE_INTEGER ? target : null;
  const orderReady =
    activeBeats.length === project.beatOrder.length &&
    new Set(activeBeatIds).size === activeBeatIds.length &&
    activeBeatIds.every((beatId, index) => beatId === project.beatOrder[index]);
  const beats: WorkspaceCutBeatProjection[] = [];
  const seenBeatIds = new Set<string>();
  let filmDurationSeconds: number | null = orderReady ? 0 : null;

  for (const beat of activeBeats) {
    if (seenBeatIds.has(beat.id) || !isSafeStudioId(beat.id) || !isDisplayText(beat.title)) {
      filmDurationSeconds = null;
      continue;
    }
    seenBeatIds.add(beat.id);
    const durationKind: WorkspaceCutBeatDurationKind =
      beat.shots.length === 0 ? (beat.targetSeconds === null ? 'pending' : 'target') : 'actual';
    const candidateDuration =
      durationKind === 'target' ? beat.targetSeconds : durationKind === 'actual' ? beat.actualSeconds : null;
    const durationSeconds =
      candidateDuration !== null && Number.isFinite(candidateDuration) && candidateDuration >= 0
        ? candidateDuration
        : null;
    if (durationSeconds === null) {
      filmDurationSeconds = null;
    } else if (filmDurationSeconds !== null) {
      const nextDuration = filmDurationSeconds + durationSeconds;
      filmDurationSeconds =
        Number.isFinite(nextDuration) && nextDuration <= Number.MAX_SAFE_INTEGER ? nextDuration : null;
    }
    beats.push({
      id: beat.id,
      title: beat.title,
      shotCount: beat.shots.length,
      durationKind: durationSeconds === null ? 'pending' : durationKind,
      durationSeconds,
      coverAssetId: beat.coverAssetId === null || isSafeStudioId(beat.coverAssetId) ? beat.coverAssetId : null,
    });
  }

  const audioImports = Object.keys(project.assets)
    .flatMap((assetId) => {
      const candidate = validCutAudioImport(project, assetId);
      return candidate === null ? [] : [candidate];
    })
    .toSorted((left, right) => {
      if (left.createdAt !== right.createdAt) return left.createdAt < right.createdAt ? 1 : -1;
      if (left.assetId === right.assetId) return 0;
      return left.assetId < right.assetId ? 1 : -1;
    })
    .map((asset, index) => ({
      assetId: asset.assetId,
      position: index + 1,
      durationSeconds: asset.durationSeconds,
      byteSize: asset.byteSize,
      createdAt: asset.createdAt,
    }));

  let bed: WorkspaceCutBedProjection = { status: 'none', assetId: null };
  if (project.bedAssetId !== null) {
    const selectedBed = isSafeStudioId(project.bedAssetId)
      ? (audioImports.find((asset) => asset.assetId === project.bedAssetId) ?? null)
      : null;
    if (selectedBed === null) {
      bed = {
        status: 'invalid',
        assetId: typeof project.bedAssetId === 'string' ? project.bedAssetId : '',
      };
    } else if (filmDurationSeconds === null) {
      bed = {
        status: 'duration_pending',
        assetId: selectedBed.assetId,
        sourceDurationSeconds: selectedBed.durationSeconds,
      };
    } else if (selectedBed.durationSeconds < filmDurationSeconds) {
      bed = {
        status: 'too_short',
        assetId: selectedBed.assetId,
        sourceDurationSeconds: selectedBed.durationSeconds,
        requiredDurationSeconds: filmDurationSeconds,
      };
    } else {
      bed = {
        status: 'ready',
        assetId: selectedBed.assetId,
        sourceDurationSeconds: selectedBed.durationSeconds,
        fadeOutStartSeconds: Math.max(0, filmDurationSeconds - STUDIO_BED_FADE_OUT_SECONDS),
        fadeOutEndSeconds: filmDurationSeconds,
      };
    }
  }

  const coverCandidates: WorkspaceCutCoverCandidateProjection[] = [];
  const seenShotIds = new Set<string>();
  if (orderReady) {
    for (const beat of activeBeats) {
      for (const shot of beat.shots) {
        if (
          seenShotIds.has(shot.id) ||
          !isSafeStudioId(shot.id) ||
          !isDisplayText(shot.shootingScript) ||
          !seenBeatIds.has(beat.id)
        ) {
          continue;
        }
        seenShotIds.add(shot.id);
        coverCandidates.push({
          shotId: shot.id,
          beatId: beat.id,
          beatTitle: beat.title,
          shootingScript: shot.shootingScript,
          coverAssetId: shot.coverAssetId === null || isSafeStudioId(shot.coverAssetId) ? shot.coverAssetId : null,
        });
      }
    }
  }
  return {
    orderReady,
    beats,
    filmDurationSeconds,
    targetDurationSeconds,
    audioImports,
    bed,
    coverCandidates,
  };
};

const PART_DONE_CASCADE_REASONS: ReadonlySet<StudioCascadeProgressV2['waitingReason']> = new Set([
  'choose_seed',
  'conditioning_failed',
  'dependency_failed',
  'cancelled',
]);

const RENDERING_CASCADE_REASONS: ReadonlySet<StudioCascadeProgressV2['waitingReason']> = new Set([
  'upstream_running',
  'conditioning_frame',
]);

const projectBeatDisplayState = (input: {
  beat: StudioBeat;
  shots: readonly WorkspaceShotProjection[];
  workspaceStatusReady: boolean;
  chainStatusReady: boolean;
  dirtyShotIds: ReadonlySet<string>;
  partDoneShotIds: ReadonlySet<string>;
  renderingShotIds: ReadonlySet<string>;
}): WorkspaceBeatDisplayState => {
  const { beat, shots } = input;
  if (beat.shotOrder.length === 0) return beat.targetSeconds === null ? 'duration_pending' : 'no_coverage';

  const activeShotIds = new Set(shots.map((shot) => shot.id));
  if (shots.some((shot) => input.partDoneShotIds.has(shot.id))) return 'part_done';
  if (
    shots.some(
      (shot) =>
        (shot.videoGenerationBlocked && !shot.videoGenerationInFlight) ||
        (shot.seedGenerationBlocked && !shot.seedGenerationInFlight)
    )
  ) {
    return 'needs_attention';
  }
  if (
    shots.some(
      (shot) => input.renderingShotIds.has(shot.id) || shot.videoGenerationInFlight || shot.seedGenerationInFlight
    )
  ) {
    return 'rendering';
  }
  if (shots.some((shot) => input.dirtyShotIds.has(shot.id))) return 'stale';

  const shotById = new Map(shots.map((shot) => [shot.id, shot]));
  if (
    beat.shotOrder.some((shotId, index) => {
      const shot = shotById.get(shotId);
      return (
        shot !== undefined &&
        activeShotIds.has(shotId) &&
        (index === 0 || shot.chainBreak === 'hard_cut') &&
        !shot.hasEffectiveSeed
      );
    })
  ) {
    return 'seed_pending';
  }
  if (!input.workspaceStatusReady || !input.chainStatusReady) return 'status_pending';
  return shots.every((shot) => shot.displayState === 'rendered') ? 'ready' : 'draft';
};

const hasSafeBeatDisplayFacts = (beat: StudioBeat): boolean =>
  isDisplayText(beat.title) &&
  isDisplayText(beat.story) &&
  (beat.targetSeconds === null ||
    (Number.isSafeInteger(beat.targetSeconds) &&
      beat.targetSeconds > 0 &&
      beat.targetSeconds <= Number.MAX_SAFE_INTEGER)) &&
  Array.isArray(beat.shotOrder);

const hasSafeShotDisplayFacts = (shot: StudioShot): boolean =>
  isDisplayText(shot.shootingScript) &&
  Number.isSafeInteger(shot.durationSeconds) &&
  shot.durationSeconds > 0 &&
  (shot.chainBreak === 'none' || shot.chainBreak === 'hard_cut') &&
  (shot.trimInSeconds === null || (Number.isFinite(shot.trimInSeconds) && shot.trimInSeconds >= 0)) &&
  (shot.trimOutSeconds === null || (Number.isFinite(shot.trimOutSeconds) && shot.trimOutSeconds >= 0)) &&
  (shot.seedStillId === null || isSafeStudioId(shot.seedStillId)) &&
  (shot.boardAssetId === null || isSafeStudioId(shot.boardAssetId)) &&
  Array.isArray(shot.supersededBoardAssetIds) &&
  shot.supersededBoardAssetIds.every(isSafeStudioId) &&
  (shot.videoAssetId === null || isSafeStudioId(shot.videoAssetId)) &&
  Array.isArray(shot.supersededVideoAssetIds) &&
  shot.supersededVideoAssetIds.every(isSafeStudioId) &&
  Array.isArray(shot.assetIds) &&
  Array.isArray(shot.jobIds);

const binIdentityKey = (item: StudioBinItem): string | null => {
  if (item.kind === 'beat') {
    return isSafeStudioId(item.beatId) && (item.reason === 'lifted' || item.reason === 'alternate')
      ? `beat:${item.beatId}`
      : null;
  }
  return isSafeStudioId(item.beatId) && isSafeStudioId(item.shotId) && item.reason === 'lifted'
    ? `shot:${item.shotId}`
    : null;
};

const binIdentityCounts = (bin: readonly StudioBinItem[]): ReadonlyMap<string, number> => {
  const counts = new Map<string, number>();
  for (const item of bin) {
    const key = binIdentityKey(item);
    if (key !== null) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
};

type WorkspaceBeatMembership = {
  beat: StudioBeat;
  binned: boolean;
};

const projectBeatMemberships = (
  project: StudioRendererProjectV2,
  identityCounts: ReadonlyMap<string, number>
): ReadonlyMap<string, WorkspaceBeatMembership> => {
  const activeCounts = new Map<string, number>();
  for (const beatId of project.beatOrder) {
    if (validBeat(project, beatId) !== null) activeCounts.set(beatId, (activeCounts.get(beatId) ?? 0) + 1);
  }
  const binnedCounts = new Map<string, number>();
  for (const item of project.bin) {
    if (item.kind !== 'beat' || binIdentityKey(item) === null) continue;
    binnedCounts.set(item.beatId, (binnedCounts.get(item.beatId) ?? 0) + 1);
  }

  const memberships = new Map<string, WorkspaceBeatMembership>();
  for (const beatId of Object.keys(project.beats)) {
    const beat = validBeat(project, beatId);
    if (beat === null || !hasSafeBeatDisplayFacts(beat)) continue;
    const activeCount = activeCounts.get(beatId) ?? 0;
    const binnedCount = binnedCounts.get(beatId) ?? 0;
    if (activeCount === 1 && binnedCount === 0) memberships.set(beatId, { beat, binned: false });
    if (activeCount === 0 && binnedCount === 1 && identityCounts.get(`beat:${beatId}`) === 1) {
      memberships.set(beatId, { beat, binned: true });
    }
  }
  return memberships;
};

type WorkspaceShotOwner = {
  beat: StudioBeat;
  beatBinned: boolean;
  shotIndex: number | null;
  source: 'beat' | 'bin';
};

const projectShotOwners = (
  project: StudioRendererProjectV2,
  memberships: ReadonlyMap<string, WorkspaceBeatMembership>,
  identityCounts: ReadonlyMap<string, number>
): ReadonlyMap<string, WorkspaceShotOwner> => {
  const candidates = new Map<string, WorkspaceShotOwner[]>();
  const addCandidate = (shotId: string, owner: WorkspaceShotOwner): void => {
    const current = candidates.get(shotId) ?? [];
    current.push(owner);
    candidates.set(shotId, current);
  };

  for (const membership of memberships.values()) {
    membership.beat.shotOrder.forEach((shotId, shotIndex) => {
      const shot = validShot(project, shotId);
      if (shot === null || !hasSafeShotDisplayFacts(shot)) return;
      addCandidate(shot.id, {
        beat: membership.beat,
        beatBinned: membership.binned,
        shotIndex,
        source: 'beat',
      });
    });
  }
  for (const item of project.bin) {
    if (item.kind !== 'shot' || identityCounts.get(`shot:${item.shotId}`) !== 1 || binIdentityKey(item) === null) {
      continue;
    }
    const membership = memberships.get(item.beatId);
    const shot = validShot(project, item.shotId);
    if (membership === undefined || shot === null || !hasSafeShotDisplayFacts(shot)) continue;
    addCandidate(shot.id, {
      beat: membership.beat,
      beatBinned: membership.binned,
      shotIndex: null,
      source: 'bin',
    });
  }

  const owners = new Map<string, WorkspaceShotOwner>();
  for (const [shotId, rows] of candidates) {
    if (rows.length === 1) owners.set(shotId, rows[0]!);
  }
  return owners;
};

type WorkspaceProjectionStatusFacts = {
  workspaceStatusReady: boolean;
  chainStatusReady: boolean;
  dirtyCausesByShotId: ReadonlyMap<string, ReadonlyArray<StudioRendererDirtyShotV2['causes'][number]>>;
  dirtyShotIds: ReadonlySet<string>;
  partDoneShotIds: ReadonlySet<string>;
  renderingShotIds: ReadonlySet<string>;
};

const projectStoredBeat = (input: {
  project: StudioRendererProjectV2;
  beat: StudioBeat;
  reason: WorkspaceBinnedBeatProjection['reason'];
  owners: ReadonlyMap<string, WorkspaceShotOwner>;
  status: WorkspaceProjectionStatusFacts;
}): WorkspaceBinnedBeatProjection | null => {
  if (!hasSafeBeatDisplayFacts(input.beat)) return null;
  const planningBoundaries = studioPlanningShotBoundariesV2(input.beat, input.project.shots);
  if (planningBoundaries === null || planningBoundaries.length !== input.beat.shotOrder.length) return null;
  const boundaryByShotId = new Map(planningBoundaries.map((boundary) => [boundary.shotId, boundary] as const));
  const orderedShots: StudioShot[] = [];
  for (let shotIndex = 0; shotIndex < input.beat.shotOrder.length; shotIndex += 1) {
    const shotId = input.beat.shotOrder[shotIndex]!;
    const shot = validShot(input.project, shotId);
    const owner = input.owners.get(shotId);
    if (
      shot === null ||
      !hasSafeShotDisplayFacts(shot) ||
      owner?.beat.id !== input.beat.id ||
      owner.source !== 'beat' ||
      owner.shotIndex !== shotIndex
    ) {
      return null;
    }
    orderedShots.push(shot);
  }
  const shots = orderedShots.map((shot, shotIndex) => {
    const downstreamShotIds: string[] = [];
    for (let downstreamIndex = shotIndex + 1; downstreamIndex < orderedShots.length; downstreamIndex += 1) {
      const downstream = orderedShots[downstreamIndex]!;
      if (downstream.chainBreak === 'hard_cut') break;
      downstreamShotIds.push(downstream.id);
    }
    return projectShot(input.project, shot, {
      segmentHead: shotIndex === 0 || shot.chainBreak === 'hard_cut',
      planningBoundary: boundaryByShotId.get(shot.id) ?? null,
      frameBoundary: null,
      dirtyCauses: input.status.dirtyCausesByShotId.get(shot.id) ?? [],
      downstreamShotIds,
      segmentStatusReady: false,
      cascadeStatusReady: true,
      cascade: null,
      upstreamShotNumber: null,
      predecessorShotNumber: shotIndex > 0 ? shotIndex : null,
      conditioningFailed: false,
      currentVideoJobs: null,
    });
  });
  return {
    id: input.beat.id,
    title: input.beat.title,
    story: input.beat.story,
    targetSeconds: input.beat.targetSeconds,
    sumSeconds: planningBoundaries.at(-1)?.endSeconds ?? null,
    actualSeconds: projectBeatActualSeconds(input.project, input.beat),
    displayState: projectBeatDisplayState({
      beat: input.beat,
      shots,
      workspaceStatusReady: input.status.workspaceStatusReady,
      chainStatusReady: input.status.chainStatusReady,
      dirtyShotIds: input.status.dirtyShotIds,
      partDoneShotIds: input.status.partDoneShotIds,
      renderingShotIds: input.status.renderingShotIds,
    }),
    shots,
    coverAssetId: shots.find((shot) => shot.coverAssetId !== null)?.coverAssetId ?? null,
    retainedWork: shots.some((shot) => shot.retainedWork),
    reason: input.reason,
    shotCount: shots.length,
  };
};

const revisionMatches = (
  project: StudioRendererProjectV2,
  snapshot: { projectId: string; projectRevision: number } | null
): boolean => snapshot?.projectId === project.id && snapshot.projectRevision === project.revision;

type ExactStatusFact<Value> = { valid: true; value: Value } | { valid: false; value: null };

const BOARD_PANEL_STALE_CAUSE_ORDER: readonly StudioRendererBoardPanelStatusV2['staleCauses'][number][] = [
  'request_out_of_date',
  'route_out_of_date',
];

const validBoardAssetId = (project: StudioRendererProjectV2, shot: StudioShot): string | null => {
  if (shot.boardAssetId === null) return null;
  const asset = isOwnedAsset(project, shot, shot.boardAssetId);
  return asset !== null &&
    asset.mediaKind === 'image' &&
    asset.managedAsset.collection === 'boardStills' &&
    shot.assetIds.filter((assetId) => assetId === asset.id).length === 1
    ? asset.id
    : null;
};

const boardJobs = (project: StudioRendererProjectV2, shot: StudioShot): StudioRendererJobV2[] =>
  shot.jobIds.flatMap((jobId) => {
    const job = ownValue(project.jobs, jobId);
    return job?.id === jobId &&
      job.projectId === project.id &&
      job.target.kind === 'shot' &&
      job.target.shotId === shot.id &&
      job.purpose === 'board_still' &&
      shot.jobIds.filter((ownedId) => ownedId === jobId).length === 1
      ? [job]
      : [];
  });

const pendingBoardPanel = (project: StudioRendererProjectV2, shot: StudioShot): WorkspaceBoardPanelProjection => ({
  shotId: shot.id,
  assetId: validBoardAssetId(project, shot),
  producerJobId: null,
  latestJobId: null,
  staleCauses: [],
  freshness: 'status_pending',
  activity: 'status_pending',
  recovery: null,
});

const boardActivity = (job: StudioRendererJobV2 | null): WorkspaceBoardPanelActivity => {
  if (job === null || job.status === 'succeeded') return 'idle';
  switch (job.status) {
    case 'queued_local':
    case 'submitting':
    case 'queued_remote':
      return 'queued';
    case 'running':
      return 'drawing';
    case 'needs_attention':
      return 'needs_attention';
    case 'failed':
      return 'failed';
    case 'cancelled':
      return 'cancelled';
    case 'waiting_for_conditioning':
      return 'status_pending';
  }
};

const boardRecovery = (job: StudioRendererJobV2 | null): WorkspaceBoardPanelRecoveryProjection | null => {
  if (job?.purpose !== 'board_still' || job.error === null) return null;
  if (job.status === 'failed' && job.error.code === 'download_failed' && job.canRetryDownload) {
    return {
      jobId: job.id,
      canRetry: false,
      canCancel: false,
      canRetryDownload: true,
      submissionUnknown: false,
    };
  }
  return job.status === 'needs_attention' && (job.canRetry || job.canCancel)
    ? {
        jobId: job.id,
        canRetry: job.canRetry,
        canCancel: job.canCancel,
        canRetryDownload: false,
        submissionUnknown: job.error.code === 'submission_unknown',
      }
    : null;
};

const hasExactBoardStaleCauses = (causes: unknown): causes is StudioRendererBoardPanelStatusV2['staleCauses'] =>
  Array.isArray(causes) &&
  causes.length <= BOARD_PANEL_STALE_CAUSE_ORDER.length &&
  causes.every((cause, index) => {
    if (typeof cause !== 'string') return false;
    const position = BOARD_PANEL_STALE_CAUSE_ORDER.indexOf(
      cause as StudioRendererBoardPanelStatusV2['staleCauses'][number]
    );
    if (position < 0) return false;
    if (index === 0) return true;
    const previousPosition = BOARD_PANEL_STALE_CAUSE_ORDER.indexOf(
      causes[index - 1] as StudioRendererBoardPanelStatusV2['staleCauses'][number]
    );
    return previousPosition < position;
  });

const exactBoardPanel = (
  project: StudioRendererProjectV2,
  shot: StudioShot,
  row: StudioRendererBoardPanelStatusV2
): WorkspaceBoardPanelProjection | null => {
  if (
    row.shotId !== shot.id ||
    (row.assetId !== null && !isSafeStudioId(row.assetId)) ||
    (row.producerJobId !== null && !isSafeStudioId(row.producerJobId)) ||
    (row.latestJobId !== null && !isSafeStudioId(row.latestJobId)) ||
    !hasExactBoardStaleCauses(row.staleCauses)
  ) {
    return null;
  }

  const jobs = boardJobs(project, shot);
  const latest = jobs.at(-1) ?? null;
  if (row.latestJobId !== latest?.id && !(row.latestJobId === null && latest === null)) return null;

  if (row.assetId === null) {
    if (shot.boardAssetId !== null || row.producerJobId !== null || row.staleCauses.length !== 0) return null;
    return {
      shotId: row.shotId,
      assetId: null,
      producerJobId: null,
      latestJobId: row.latestJobId,
      staleCauses: [],
      freshness: 'missing',
      activity: boardActivity(latest),
      recovery: boardRecovery(latest),
    };
  }

  if (row.assetId !== shot.boardAssetId || validBoardAssetId(project, shot) !== row.assetId) return null;
  const successfulProducers = jobs.filter(
    (job) =>
      job.status === 'succeeded' &&
      job.outputAssetIdsByRole.primary === row.assetId &&
      job.outputAssetIds.filter((assetId) => assetId === row.assetId).length === 1
  );
  const producer = successfulProducers.length === 1 ? successfulProducers[0]! : null;
  const latestSucceeded = jobs.toReversed().find((job) => job.status === 'succeeded') ?? null;
  if (
    producer === null ||
    latestSucceeded?.id !== producer.id ||
    row.producerJobId !== producer.id ||
    producer.spendReceipt?.purpose !== 'board_still' ||
    !isSafeStudioId(producer.spendReceipt.routeId)
  ) {
    return null;
  }
  const routeOutOfDate = project.imageRouteId === null || producer.spendReceipt.routeId !== project.imageRouteId;
  if (row.staleCauses.includes('route_out_of_date') !== routeOutOfDate) return null;
  return {
    shotId: row.shotId,
    assetId: row.assetId,
    producerJobId: row.producerJobId,
    latestJobId: row.latestJobId,
    staleCauses: [...row.staleCauses],
    freshness: row.staleCauses.length === 0 ? 'current' : 'stale',
    activity: boardActivity(latest),
    recovery: boardRecovery(latest),
  };
};

const projectBoardPanels = (
  project: StudioRendererProjectV2,
  status: StudioRendererWorkspaceStatusV2 | null,
  activeShotIds: readonly string[]
): WorkspaceBoardPanelProjection[] => {
  const activeShots = activeShotIds.map((shotId) => ownValue(project.shots, shotId));
  if (
    activeShots.some((shot) => shot === undefined) ||
    status === null ||
    !Array.isArray(status.boardPanels) ||
    status.boardPanels.length !== activeShotIds.length ||
    status.boardPanels.some((row, index) => row?.shotId !== activeShotIds[index])
  ) {
    return activeShots.flatMap((shot) => (shot === undefined ? [] : [pendingBoardPanel(project, shot)]));
  }
  return activeShots.map((shot, index) => {
    const exact = exactBoardPanel(project, shot!, status.boardPanels[index]!);
    return exact ?? pendingBoardPanel(project, shot!);
  });
};

const exactCurrentVideoJobs = (
  project: StudioRendererProjectV2,
  shot: StudioShot,
  status: StudioRendererWorkspaceStatusV2 | null
): ExactStatusFact<StudioRendererJobV2[]> => {
  if (status === null || !Array.isArray(status.currentVideoJobs)) return { valid: false, value: null };
  const matches = status.currentVideoJobs.filter((row) => row?.shotId === shot.id);
  if (matches.length !== 1) return { valid: false, value: null };
  const jobIds = matches[0]!.jobIds;
  if (
    !Array.isArray(jobIds) ||
    new Set(jobIds).size !== jobIds.length ||
    jobIds.some((jobId) => !isSafeStudioId(jobId))
  ) {
    return { valid: false, value: null };
  }
  const jobs: StudioRendererJobV2[] = [];
  for (const jobId of jobIds) {
    const job = ownValue(project.jobs, jobId);
    if (
      job?.id !== jobId ||
      job.projectId !== project.id ||
      job.target.kind !== 'shot' ||
      job.target.shotId !== shot.id ||
      job.purpose !== 'video_take' ||
      shot.jobIds.filter((ownedId) => ownedId === jobId).length !== 1
    ) {
      return { valid: false, value: null };
    }
    jobs.push(job);
  }
  return { valid: true, value: jobs };
};

const exactCascade = (
  status: StudioRendererWorkspaceStatusV2 | null,
  shot: StudioShot,
  orderedShots: readonly StudioShot[],
  shotIndex: number
): ExactStatusFact<{ row: StudioCascadeProgressV2 | null; upstreamShotNumber: number | null }> => {
  if (status === null || !Array.isArray(status.cascadeProgress)) return { valid: false, value: null };
  const matches = status.cascadeProgress.filter((row) => row?.dependentShotId === shot.id);
  if (matches.length === 0) return { valid: true, value: { row: null, upstreamShotNumber: null } };
  if (matches.length !== 1) return { valid: false, value: null };
  const row = matches[0]!;
  const upstreamIndex = orderedShots.findIndex((candidate) => candidate.id === row.upstreamShotId);
  if (
    !isSafeStudioId(row.upstreamShotId) ||
    upstreamIndex < 0 ||
    upstreamIndex > shotIndex ||
    !Array.isArray(row.eligiblePrimaryAssetIds) ||
    row.eligiblePrimaryAssetIds.some((assetId) => !isSafeStudioId(assetId)) ||
    new Set(row.eligiblePrimaryAssetIds).size !== row.eligiblePrimaryAssetIds.length ||
    typeof row.canRetryConditioningFrame !== 'boolean' ||
    typeof row.canCancelWaiting !== 'boolean' ||
    (row.waitingReason === 'conditioning_frame' && upstreamIndex !== shotIndex - 1)
  ) {
    return { valid: false, value: null };
  }
  return {
    valid: true,
    value: {
      row: { ...row, eligiblePrimaryAssetIds: [...row.eligiblePrimaryAssetIds] },
      upstreamShotNumber: upstreamIndex < shotIndex ? upstreamIndex + 1 : null,
    },
  };
};

const exactConditioningFailure = (
  status: StudioRendererChainStatusV2 | null,
  shotId: string
): ExactStatusFact<boolean> => {
  if (status === null || !Array.isArray(status.conditioningFailures)) return { valid: false, value: null };
  const matches = status.conditioningFailures.filter((row) => row?.dependentShotId === shotId);
  if (matches.length === 0) return { valid: true, value: false };
  if (matches.length !== 1 || matches[0]!.reason !== 'conditioning_failed' || matches[0]!.canRetry !== true) {
    return { valid: false, value: null };
  }
  return { valid: true, value: true };
};

const exactFrameBoundary = (
  project: StudioRendererProjectV2,
  status: StudioRendererChainStatusV2 | null,
  orderedShots: readonly StudioShot[],
  shotIndex: number
): ExactStatusFact<StudioRendererChainBoundaryV2 | null> => {
  const shot = orderedShots[shotIndex]!;
  if (status === null || !Array.isArray(status.boundaries)) return { valid: false, value: null };
  const matches = status.boundaries.filter((row) => row?.dependentShotId === shot.id);
  if (shotIndex === 0 || shot.chainBreak === 'hard_cut') {
    return matches.length === 0 ? { valid: true, value: null } : { valid: false, value: null };
  }
  if (matches.length !== 1) return { valid: false, value: null };
  const row = matches[0]!;
  const upstream = orderedShots[shotIndex - 1]!;
  if (row.upstreamShotId !== upstream.id || row.dependentShotId !== shot.id) {
    return { valid: false, value: null };
  }
  if ((row.status === 'empty' || row.status === 'gone') && row.frameAssetId === null) {
    return { valid: true, value: { ...row } };
  }
  if (row.status !== 'on_disk' || !isSafeStudioId(row.frameAssetId)) return { valid: false, value: null };
  const frame = ownValue(project.assets, row.frameAssetId);
  if (
    frame?.id !== row.frameAssetId ||
    frame.projectId !== project.id ||
    frame.shotId !== upstream.id ||
    frame.mediaKind !== 'image' ||
    frame.managedAsset.collection !== 'conditioningFrames' ||
    !upstream.assetIds.includes(frame.id)
  ) {
    return { valid: false, value: null };
  }
  return { valid: true, value: { ...row } };
};

/**
 * Builds the only renderer workspace projection. Provider identity and mutable paid records are
 * reduced to display facts here and never escape through the returned object.
 */
export const projectWorkspace = (
  project: StudioRendererProjectV2,
  workspaceStatus: StudioRendererWorkspaceStatusV2 | null,
  chainStatus: StudioRendererChainStatusV2 | null
): WorkspaceProjection => {
  const matchedWorkspaceStatus = revisionMatches(project, workspaceStatus) ? workspaceStatus : null;
  const matchedChainStatus = revisionMatches(project, chainStatus) ? chainStatus : null;
  const dirtyCausesByShotId = new Map(
    matchedWorkspaceStatus?.dirtyShots.map((row) => [row.shotId, [...row.causes]] as const) ?? []
  );
  const dirtyShotIds = new Set(dirtyCausesByShotId.keys());
  const partDoneShotIds = new Set<string>(
    matchedWorkspaceStatus?.cascadeProgress
      .filter((row) => PART_DONE_CASCADE_REASONS.has(row.waitingReason))
      .map((row) => row.dependentShotId) ?? []
  );
  for (const row of matchedChainStatus?.conditioningFailures ?? []) partDoneShotIds.add(row.dependentShotId);
  const renderingShotIds = new Set(
    matchedWorkspaceStatus?.cascadeProgress
      .filter((row) => RENDERING_CASCADE_REASONS.has(row.waitingReason))
      .map((row) => row.dependentShotId) ?? []
  );

  const activeBeatIds: string[] = [];
  const activeShotIds: string[] = [];
  const activeBeats = project.beatOrder.flatMap((beatId) => {
    const beat = validBeat(project, beatId);
    if (beat === null) return [];
    activeBeatIds.push(beat.id);
    const orderedShots = beat.shotOrder.flatMap((shotId) => {
      const shot = validShot(project, shotId);
      return shot === null ? [] : [shot];
    });
    const planningBoundaries = studioPlanningShotBoundariesV2(beat, project.shots);
    const planningBoundaryByShotId = new Map(
      planningBoundaries?.map((boundary) => [boundary.shotId, boundary] as const) ?? []
    );
    const shots = orderedShots.map((shot, shotIndex) => {
      activeShotIds.push(shot.id);
      const downstreamShotIds: string[] = [];
      for (let downstreamIndex = shotIndex + 1; downstreamIndex < orderedShots.length; downstreamIndex += 1) {
        const downstream = orderedShots[downstreamIndex]!;
        if (downstream.chainBreak === 'hard_cut') break;
        downstreamShotIds.push(downstream.id);
      }
      const currentVideoJobs = exactCurrentVideoJobs(project, shot, matchedWorkspaceStatus);
      const cascade = exactCascade(matchedWorkspaceStatus, shot, orderedShots, shotIndex);
      const conditioningFailure = exactConditioningFailure(matchedChainStatus, shot.id);
      const frameBoundary = exactFrameBoundary(project, matchedChainStatus, orderedShots, shotIndex);
      return projectShot(project, shot, {
        segmentHead: shotIndex === 0 || shot.chainBreak === 'hard_cut',
        planningBoundary: planningBoundaryByShotId.get(shot.id) ?? null,
        frameBoundary: frameBoundary.value,
        dirtyCauses: dirtyCausesByShotId.get(shot.id) ?? [],
        downstreamShotIds,
        segmentStatusReady: currentVideoJobs.valid && cascade.valid && conditioningFailure.valid && frameBoundary.valid,
        cascadeStatusReady: cascade.valid,
        cascade: cascade.value?.row ?? null,
        upstreamShotNumber: cascade.value?.upstreamShotNumber ?? null,
        predecessorShotNumber: shotIndex > 0 ? shotIndex : null,
        conditioningFailed: conditioningFailure.value ?? false,
        currentVideoJobs: currentVideoJobs.value,
      });
    });
    return [
      {
        id: beat.id,
        title: beat.title,
        story: beat.story,
        targetSeconds: beat.targetSeconds,
        sumSeconds: planningBoundaries?.at(-1)?.endSeconds ?? null,
        actualSeconds: projectBeatActualSeconds(project, beat),
        displayState: projectBeatDisplayState({
          beat,
          shots,
          workspaceStatusReady: matchedWorkspaceStatus !== null,
          chainStatusReady: matchedChainStatus !== null,
          dirtyShotIds,
          partDoneShotIds,
          renderingShotIds,
        }),
        shots,
        coverAssetId: shots.find((shot) => shot.coverAssetId !== null)?.coverAssetId ?? null,
        retainedWork: shots.some((shot) => shot.retainedWork),
      },
    ];
  });

  const identityCounts = binIdentityCounts(project.bin);
  const memberships = projectBeatMemberships(project, identityCounts);
  const owners = projectShotOwners(project, memberships, identityCounts);
  const boardPanels = projectBoardPanels(project, matchedWorkspaceStatus, activeShotIds);
  const statusFacts: WorkspaceProjectionStatusFacts = {
    workspaceStatusReady: matchedWorkspaceStatus !== null,
    chainStatusReady: matchedChainStatus !== null,
    dirtyCausesByShotId,
    dirtyShotIds,
    partDoneShotIds,
    renderingShotIds,
  };
  const binnedItems: WorkspaceBinItemProjection[] = [];
  const binnedBeats: WorkspaceBinnedBeatProjection[] = [];
  const binnedShots: WorkspaceBinnedShotProjection[] = [];
  for (let binIndex = 0; binIndex < project.bin.length; binIndex += 1) {
    const item = project.bin[binIndex]!;
    const identityKey = binIdentityKey(item);
    if (identityKey === null || identityCounts.get(identityKey) !== 1) continue;
    const position = binIndex + 1;
    if (item.kind === 'beat') {
      const membership = memberships.get(item.beatId);
      if (membership === undefined || !membership.binned) continue;
      const value = projectStoredBeat({
        project,
        beat: membership.beat,
        reason: item.reason,
        owners,
        status: statusFacts,
      });
      if (value === null) continue;
      const identity: Extract<StudioBinItem, { kind: 'beat' }> = {
        kind: 'beat',
        beatId: item.beatId,
        reason: item.reason,
      };
      binnedBeats.push(value);
      binnedItems.push({ kind: 'beat', position, identity, value });
      continue;
    }
    if (item.kind === 'shot') {
      const shot = validShot(project, item.shotId);
      const owner = owners.get(item.shotId);
      if (
        shot === null ||
        !hasSafeShotDisplayFacts(shot) ||
        owner === undefined ||
        owner.source !== 'bin' ||
        owner.beat.id !== item.beatId
      ) {
        continue;
      }
      const projectedShot = projectShot(project, shot, {
        segmentHead: shot.chainBreak === 'hard_cut',
        planningBoundary: null,
        frameBoundary: null,
        dirtyCauses: dirtyCausesByShotId.get(shot.id) ?? [],
        downstreamShotIds: [],
        segmentStatusReady: false,
        cascadeStatusReady: true,
        cascade: null,
        upstreamShotNumber: null,
        predecessorShotNumber: null,
        conditioningFailed: false,
        currentVideoJobs: null,
      });
      const currentVideo = validCurrentVideo(project, shot);
      const binnedCoverAssetId =
        (currentVideo === null ? null : videoPosterId(project, shot, currentVideo)) ??
        effectiveSeedStillId(project, shot);
      const value: WorkspaceBinnedShotProjection = {
        ...projectedShot,
        coverAssetId: binnedCoverAssetId,
        retainedWork: projectedShot.retainedWork,
        beatId: owner.beat.id,
        beatTitle: owner.beat.title,
        ownerBeatBinned: owner.beatBinned,
        reason: item.reason,
      };
      const identity: Extract<StudioBinItem, { kind: 'shot' }> = {
        kind: 'shot',
        beatId: item.beatId,
        shotId: item.shotId,
        reason: item.reason,
      };
      binnedShots.push(value);
      binnedItems.push({ kind: 'shot', position, identity, value });
      continue;
    }
  }

  return {
    projectId: project.id,
    projectRevision: project.revision,
    activeBeats,
    activeBeatIds,
    activeShotIds,
    coverageGapBeatIds: activeBeats.filter((beat) => beat.shots.length === 0).map((beat) => beat.id),
    unscriptedShotIds: activeBeats.flatMap((beat) =>
      beat.shots.filter((shot) => shot.shootingScript.trim() === '').map((shot) => shot.id)
    ),
    workspaceStatusReady: matchedWorkspaceStatus !== null,
    chainStatusReady: matchedChainStatus !== null,
    requestShapeLocked:
      matchedWorkspaceStatus?.parkEligibility.some((row) =>
        row.blockers.some((blocker) => blocker.code === 'bound_nonterminal_request')
      ) ?? false,
    cut: projectCut(project, activeBeats),
    bin: { items: binnedItems, beats: binnedBeats, shots: binnedShots },
    undoTop:
      matchedWorkspaceStatus?.undoTop === null || matchedWorkspaceStatus === null
        ? null
        : { ...matchedWorkspaceStatus.undoTop },
    boardPanels,
    dirtyShots: matchedWorkspaceStatus?.dirtyShots.map((row) => ({ ...row, causes: [...row.causes] })) ?? [],
    cascadeProgress:
      matchedWorkspaceStatus?.cascadeProgress.map((row) => ({
        ...row,
        eligiblePrimaryAssetIds: [...row.eligiblePrimaryAssetIds],
      })) ?? [],
    parkEligibility:
      matchedWorkspaceStatus?.parkEligibility.map((row) => ({
        ...row,
        blockers: row.blockers.map((blocker) => ({ ...blocker })),
      })) ?? [],
    conditioningFailures: matchedChainStatus?.conditioningFailures.map((row) => ({ ...row })) ?? [],
  };
};

export type StudioBarStats = {
  beatCount: number;
  shotCount: number;
  /** Beats that are actually ready, not merely present. */
  readyCount: number;
  /** Main-owned blocker count for this exact project revision, or null while authority is unavailable. */
  blockerCount: number | null;
  filmSeconds: number | null;
  targetSeconds: number | null;
};

/**
 * What the app bar states about the film: how many Beats it holds, how many Shots those carry, how
 * many are ready, and the film's length against the target it is authored to. An unknown length is
 * carried through as null rather than defaulted to zero — a film that has not been measured must not
 * read as a film of no length.
 */
export const buildStudioBarStats = (
  projection: WorkspaceProjection,
  projectStatus: StudioProjectStatusV2 | null = null
): StudioBarStats => {
  let shotCount = 0;
  let readyCount = 0;
  for (const beat of projection.activeBeats) {
    shotCount += beat.shots.length;
    if (beat.displayState === 'ready') readyCount += 1;
  }
  const exactStatus = exactStudioProjectStatusV2(projectStatus, projection.projectId, projection.projectRevision);
  return {
    beatCount: projection.activeBeats.length,
    shotCount,
    readyCount,
    blockerCount: exactStatus?.blockerCount ?? null,
    filmSeconds: projection.cut.filmDurationSeconds,
    targetSeconds: projection.cut.targetDurationSeconds,
  };
};

export type StudioWorkspaceViewReadiness = 'ready' | 'empty' | 'not_started';

export type StudioWorkspaceViewProgress = {
  stage: StudioProjectStatusStageIdV2;
  state: StudioProjectStatusStageStateV2;
  readiness: StudioWorkspaceViewReadiness;
  currentCount: number;
  totalCount: number;
  recommended: boolean;
};

export type StudioWorkspaceProgress = {
  views: Record<StudioView, StudioWorkspaceViewProgress>;
  nextAction: { stage: StudioProjectStatusStageIdV2; view: StudioView | null } | null;
};

const statusStage = <Stage extends StudioProjectStatusStageIdV2>(
  status: StudioProjectStatusV2,
  id: Stage
): Extract<StudioProjectStatusStageV2, { id: Stage }> | null =>
  (status.stages.find((candidate) => candidate.id === id) as
    | Extract<StudioProjectStatusStageV2, { id: Stage }>
    | undefined) ?? null;

const validStatusCount = (value: number): boolean => Number.isSafeInteger(value) && value >= 0;
const statusRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
const exactStatusKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean =>
  Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
const finiteNonnegativeStatusNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;
const workspaceStatusTargetMatches = (actualSeconds: number, targetSeconds: number): boolean => {
  const roundingEpsilon = Number.EPSILON * Math.max(1, Math.abs(actualSeconds), Math.abs(targetSeconds)) * 4;
  return Math.abs(actualSeconds - targetSeconds) <= 1 / STUDIO_FILM_EXPORT_FRAME_RATE + roundingEpsilon;
};
const safeStatusId = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 256 && /^[A-Za-z0-9_-]+$/.test(value);
const statusModelAvailabilities = new Set(['ready', 'selection_required', 'setup_required', 'unavailable']);
const statusOwnerReasons = new Set([
  'select_engine',
  'configure_engine',
  'repair_engine_health',
  'choose_compatible_engine',
  'approve_reference',
  'select_seed',
  'review_project_data',
  'review_job_recovery',
  'acknowledge_possible_duplicate_charge',
  'retry_download',
  'edit_cut',
  'replace_audio_bed',
]);

const denseStatusArray = (value: unknown, minimum: number, maximum: number): value is unknown[] => {
  try {
    if (
      !Array.isArray(value) ||
      value.length < minimum ||
      value.length > maximum ||
      Reflect.ownKeys(value).length !== value.length + 1
    ) {
      return false;
    }
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.hasOwn(value, index)) return false;
    }
    return true;
  } catch {
    return false;
  }
};

const uniqueSafeStatusIdArray = (value: unknown, minimum: number, maximum: number): value is string[] => {
  if (!denseStatusArray(value, minimum, maximum)) return false;
  const ids = new Set<string>();
  for (const id of value) {
    if (!safeStatusId(id) || ids.has(id)) return false;
    ids.add(id);
  }
  return true;
};

const validWorkspaceStageSummary = (stage: StudioProjectStatusStageV2): boolean => {
  const summary = statusRecord(stage.summary);
  if (summary === null) return false;
  switch (stage.id) {
    case 'brief':
      return exactStatusKeys(summary, ['stage', 'hasBrief']) && typeof summary.hasBrief === 'boolean';
    case 'engines':
      return (
        exactStatusKeys(summary, ['stage', 'image', 'video']) &&
        statusModelAvailabilities.has(summary.image as string) &&
        statusModelAvailabilities.has(summary.video as string)
      );
    case 'references':
      return (
        exactStatusKeys(summary, ['stage', 'plannedCount', 'approvedCount']) &&
        validStatusCount(summary.plannedCount as number) &&
        validStatusCount(summary.approvedCount as number)
      );
    case 'storyboard':
      return (
        exactStatusKeys(summary, [
          'stage',
          'beatCount',
          'shotCount',
          'authoredShotCount',
          'plannedSeconds',
          'targetSeconds',
        ]) &&
        validStatusCount(summary.beatCount as number) &&
        validStatusCount(summary.shotCount as number) &&
        validStatusCount(summary.authoredShotCount as number) &&
        finiteNonnegativeStatusNumber(summary.plannedSeconds) &&
        finiteNonnegativeStatusNumber(summary.targetSeconds)
      );
    case 'bindings':
      return (
        exactStatusKeys(summary, ['stage', 'readyShotCount', 'shotCount', 'maxConditioningImages']) &&
        validStatusCount(summary.readyShotCount as number) &&
        validStatusCount(summary.shotCount as number) &&
        (summary.maxConditioningImages === null || validStatusCount(summary.maxConditioningImages as number))
      );
    case 'production':
      return (
        exactStatusKeys(summary, ['stage', 'currentTakeCount', 'shotCount', 'activeJobCount']) &&
        validStatusCount(summary.currentTakeCount as number) &&
        validStatusCount(summary.shotCount as number) &&
        validStatusCount(summary.activeJobCount as number)
      );
    case 'cut':
      return (
        exactStatusKeys(summary, [
          'stage',
          'currentTakeCount',
          'shotCount',
          'durationSeconds',
          'targetSeconds',
          'structurallyPlayable',
        ]) &&
        validStatusCount(summary.currentTakeCount as number) &&
        validStatusCount(summary.shotCount as number) &&
        (summary.durationSeconds === null || finiteNonnegativeStatusNumber(summary.durationSeconds)) &&
        finiteNonnegativeStatusNumber(summary.targetSeconds) &&
        typeof summary.structurallyPlayable === 'boolean'
      );
  }
};

const validWorkspaceGenerationChoice = (value: unknown): boolean => {
  const choice = statusRecord(value);
  if (choice === null || !exactStatusKeys(choice, ['target', 'purpose'])) return false;
  const target = statusRecord(choice.target);
  return (
    target !== null &&
    exactStatusKeys(target, ['kind', 'shotId']) &&
    target.kind === 'shot' &&
    safeStatusId(target.shotId) &&
    (choice.purpose === 'seed_still' || choice.purpose === 'board_still' || choice.purpose === 'video_take')
  );
};

const validWorkspacePrepareIntent = (value: unknown): boolean => {
  const prepare = statusRecord(value);
  if (prepare === null) return false;
  if (prepare.kind === 'project_references') {
    return (
      exactStatusKeys(prepare, ['kind', 'referenceIds']) &&
      uniqueSafeStatusIdArray(prepare.referenceIds, 1, STUDIO_MAX_PROJECT_REFERENCES)
    );
  }
  if (
    prepare.kind !== 'generation' ||
    !exactStatusKeys(prepare, ['kind', 'baseChoices', 'cascadeChoices', 'continuityChange']) ||
    !denseStatusArray(prepare.baseChoices, 0, STUDIO_MAX_MUTATION_OPERATIONS) ||
    !denseStatusArray(prepare.cascadeChoices, 0, STUDIO_MAX_MUTATION_OPERATIONS) ||
    !prepare.baseChoices.every(validWorkspaceGenerationChoice) ||
    !prepare.cascadeChoices.every(validWorkspaceGenerationChoice)
  ) {
    return false;
  }
  if (prepare.continuityChange === null) return prepare.baseChoices.length > 0;
  const change = statusRecord(prepare.continuityChange);
  return (
    prepare.baseChoices.length === 0 &&
    prepare.cascadeChoices.length === 0 &&
    change !== null &&
    exactStatusKeys(change, ['shotId', 'hardCut', 'requiresSeedGeneration']) &&
    safeStatusId(change.shotId) &&
    typeof change.hardCut === 'boolean' &&
    typeof change.requiresSeedGeneration === 'boolean'
  );
};

const validWorkspaceRemedy = (value: unknown): boolean => {
  const remedy = statusRecord(value);
  if (remedy === null) return false;
  if (remedy.kind === 'owner_only') {
    return exactStatusKeys(remedy, ['kind', 'reason']) && statusOwnerReasons.has(remedy.reason as string);
  }
  if (remedy.kind === 'proposal') {
    return (
      exactStatusKeys(remedy, ['kind', 'prepare', 'estimatedMinorUnits', 'currency']) &&
      remedy.estimatedMinorUnits === null &&
      remedy.currency === null &&
      validWorkspacePrepareIntent(remedy.prepare)
    );
  }
  if (remedy.kind !== 'free_fix' || typeof remedy.op !== 'string') return false;
  if (remedy.op === 'retry_conditioning_frame') {
    return exactStatusKeys(remedy, ['kind', 'op', 'dependentShotId']) && safeStatusId(remedy.dependentShotId);
  }
  if (remedy.op === 'terminalize_refused_job') {
    return exactStatusKeys(remedy, ['kind', 'op', 'jobId']) && safeStatusId(remedy.jobId);
  }
  return (
    remedy.op === 'set_shot_reference_binding' &&
    exactStatusKeys(remedy, ['kind', 'op', 'shotId']) &&
    safeStatusId(remedy.shotId)
  );
};

const validWorkspaceWhere = (value: unknown): boolean => {
  const where = statusRecord(value);
  if (where === null || typeof where.kind !== 'string') return false;
  if (where.kind === 'project' || where.kind === 'cut') return exactStatusKeys(where, ['kind']);
  if (where.kind === 'route') {
    return (
      exactStatusKeys(where, ['kind', 'routeKind']) && (where.routeKind === 'image' || where.routeKind === 'video')
    );
  }
  if (where.kind === 'reference') {
    return (
      exactStatusKeys(where, ['kind', 'referenceId', 'jobId']) &&
      safeStatusId(where.referenceId) &&
      (where.jobId === null || safeStatusId(where.jobId))
    );
  }
  return (
    where.kind === 'shot' &&
    exactStatusKeys(where, ['kind', 'beatId', 'shotId', 'beatPosition', 'shotPosition', 'jobId']) &&
    safeStatusId(where.beatId) &&
    safeStatusId(where.shotId) &&
    validStatusCount(where.beatPosition as number) &&
    validStatusCount(where.shotPosition as number) &&
    (where.jobId === null || safeStatusId(where.jobId))
  );
};

const validWorkspaceBlocker = (value: unknown): boolean => {
  const blocker = statusRecord(value);
  if (
    blocker === null ||
    !exactStatusKeys(blocker, ['cause', 'where', 'remedy']) ||
    !STUDIO_PROJECT_STATUS_BLOCKER_CAUSES_V2.some((cause) => cause === blocker.cause) ||
    !validWorkspaceWhere(blocker.where) ||
    !validWorkspaceRemedy(blocker.remedy)
  ) {
    return false;
  }
  const where = blocker.where as Record<string, unknown>;
  const remedy = blocker.remedy as Record<string, unknown>;
  const cause = blocker.cause;
  if (cause === 'route_inventory_unavailable' && where.kind !== 'project') return false;
  if (
    (cause === 'route_not_selected' ||
      cause === 'route_setup_required' ||
      cause === 'route_unavailable' ||
      cause === 'route_retired' ||
      cause === 'route_incompatible_frame' ||
      cause === 'route_first_frame_unsupported') &&
    where.kind !== 'route'
  ) {
    return false;
  }
  if (cause === 'route_duration_unsupported' && where.kind !== 'shot') return false;
  if (
    (cause === 'reference_generation_required' ||
      cause === 'reference_approval_required' ||
      cause === 'reference_generation_failed') &&
    where.kind !== 'reference'
  ) {
    return false;
  }
  if (
    (cause === 'reference_binding_unassigned' ||
      cause === 'reference_binding_unknown_reference' ||
      cause === 'reference_binding_wrong_kind' ||
      cause === 'reference_binding_unapproved_reference' ||
      cause === 'reference_binding_missing_asset' ||
      cause === 'reference_binding_capacity_exceeded' ||
      cause === 'shooting_script_required' ||
      cause === 'seed_selection_required' ||
      cause === 'seed_generation_required' ||
      cause === 'conditioning_frame_required' ||
      cause === 'extraction_failed' ||
      cause === 'dependency_failed') &&
    where.kind !== 'shot'
  ) {
    return false;
  }
  if ((cause === 'cut_invalid_media' || cause === 'cut_bed_too_short') && where.kind !== 'cut') return false;
  if (remedy.kind === 'free_fix') {
    if (remedy.op === 'terminalize_refused_job') return where.jobId === remedy.jobId;
    return where.kind === 'shot' && where.shotId === (remedy.dependentShotId ?? remedy.shotId);
  }
  if (remedy.kind !== 'proposal') return true;
  const prepare = remedy.prepare as Record<string, unknown>;
  if (prepare.kind === 'project_references') {
    return where.kind === 'reference' && (prepare.referenceIds as unknown[]).includes(where.referenceId);
  }
  if (where.kind !== 'shot') return false;
  if (prepare.continuityChange !== null) {
    return (prepare.continuityChange as Record<string, unknown>).shotId === where.shotId;
  }
  return true;
};

const validWorkspaceAdvisory = (value: unknown): boolean => {
  const advisory = statusRecord(value);
  if (advisory === null) return false;
  if (advisory.cause === 'next_action') {
    return (
      exactStatusKeys(advisory, ['cause', 'stage']) &&
      STUDIO_PROJECT_STATUS_STAGE_ORDER_V2.some((stageId) => stageId === advisory.stage)
    );
  }
  if (advisory.cause === 'target_duration_mismatch') {
    return (
      exactStatusKeys(advisory, ['cause', 'stage', 'actualSeconds', 'targetSeconds']) &&
      (advisory.stage === 'storyboard' || advisory.stage === 'cut') &&
      finiteNonnegativeStatusNumber(advisory.actualSeconds) &&
      finiteNonnegativeStatusNumber(advisory.targetSeconds)
    );
  }
  if (advisory.cause !== 'current_take_stale') return false;
  if (
    !exactStatusKeys(advisory, ['cause', 'stage', 'shotId', 'staleCauses']) ||
    advisory.stage !== 'production' ||
    !safeStatusId(advisory.shotId) ||
    !denseStatusArray(advisory.staleCauses, 1, 2) ||
    !advisory.staleCauses.every((cause) => cause === 'continuity_stale' || cause === 'generation_out_of_date')
  ) {
    return false;
  }
  return new Set(advisory.staleCauses).size === advisory.staleCauses.length;
};

const viewForStatusStage = (stageId: StudioProjectStatusStageIdV2): StudioView | null => {
  switch (stageId) {
    case 'references':
      return 'references';
    case 'storyboard':
    case 'bindings':
      return 'table';
    case 'production':
      return 'board';
    case 'cut':
      return 'cut';
    case 'brief':
    case 'engines':
      return null;
  }
};

/** Maps exact Main status to honest, non-gating view progress. Unknown or inconsistent authority stays neutral. */
export const deriveStudioWorkspaceProgress = (
  status: StudioProjectStatusV2 | null,
  projectId: string,
  projectRevision: number
): StudioWorkspaceProgress | null => {
  const exact = exactStudioProjectStatusV2(status, projectId, projectRevision);
  if (exact === null) return null;
  const brief = statusStage(exact, 'brief');
  const engines = statusStage(exact, 'engines');
  const references = statusStage(exact, 'references');
  const storyboard = statusStage(exact, 'storyboard');
  const bindings = statusStage(exact, 'bindings');
  const production = statusStage(exact, 'production');
  const cut = statusStage(exact, 'cut');
  if (
    brief === null ||
    engines === null ||
    references === null ||
    storyboard === null ||
    bindings === null ||
    production === null ||
    cut === null
  ) {
    return null;
  }
  if (
    exact.stages.some(
      (item) =>
        !validWorkspaceStageSummary(item) ||
        !denseStatusArray(item.blockers, 0, 512) ||
        !item.blockers.every(validWorkspaceBlocker) ||
        (item.state === 'blocked') !== item.blockers.length > 0
    )
  ) {
    return null;
  }
  const referencesComplete = references.summary.approvedCount === references.summary.plannedCount;
  const storyboardComplete =
    storyboard.summary.beatCount > 0 &&
    storyboard.summary.shotCount > 0 &&
    storyboard.summary.authoredShotCount === storyboard.summary.shotCount &&
    workspaceStatusTargetMatches(storyboard.summary.plannedSeconds, storyboard.summary.targetSeconds);
  const expectedStoryboardState =
    storyboard.summary.beatCount === 0 ? 'not_started' : storyboardComplete ? 'complete' : 'in_progress';
  const expectedBindingsState =
    bindings.summary.shotCount === 0
      ? 'not_started'
      : bindings.summary.readyShotCount === bindings.summary.shotCount
        ? 'complete'
        : 'in_progress';
  const expectedProductionState =
    production.summary.shotCount === 0 ||
    (production.summary.currentTakeCount === 0 && production.summary.activeJobCount === 0)
      ? 'not_started'
      : production.summary.currentTakeCount === production.summary.shotCount
        ? 'complete'
        : 'in_progress';
  const cutComplete =
    cut.summary.structurallyPlayable &&
    cut.summary.durationSeconds !== null &&
    workspaceStatusTargetMatches(cut.summary.durationSeconds, cut.summary.targetSeconds);
  const expectedCutState = cutComplete
    ? 'complete'
    : cut.summary.structurallyPlayable || cut.summary.currentTakeCount > 0
      ? 'in_progress'
      : 'not_started';
  if (
    brief.state !== (brief.summary.hasBrief ? 'complete' : 'not_started') ||
    (engines.state !== 'blocked' &&
      (engines.state === 'complete') !== (engines.summary.image === 'ready' && engines.summary.video === 'ready')) ||
    !validStatusCount(references.summary.approvedCount) ||
    !validStatusCount(references.summary.plannedCount) ||
    references.summary.approvedCount > references.summary.plannedCount ||
    (references.state !== 'blocked' && references.state !== (referencesComplete ? 'complete' : 'in_progress')) ||
    !validStatusCount(storyboard.summary.authoredShotCount) ||
    !validStatusCount(storyboard.summary.beatCount) ||
    !validStatusCount(storyboard.summary.shotCount) ||
    storyboard.summary.authoredShotCount > storyboard.summary.shotCount ||
    (storyboard.summary.beatCount === 0 &&
      (storyboard.summary.shotCount !== 0 ||
        storyboard.summary.authoredShotCount !== 0 ||
        storyboard.summary.plannedSeconds !== 0)) ||
    (storyboard.summary.shotCount === 0 && storyboard.summary.plannedSeconds !== 0) ||
    (storyboard.state !== 'blocked' && storyboard.state !== expectedStoryboardState) ||
    !validStatusCount(bindings.summary.readyShotCount) ||
    !validStatusCount(bindings.summary.shotCount) ||
    bindings.summary.readyShotCount > bindings.summary.shotCount ||
    (bindings.state !== 'blocked' && bindings.state !== expectedBindingsState) ||
    !validStatusCount(production.summary.activeJobCount) ||
    !validStatusCount(production.summary.currentTakeCount) ||
    !validStatusCount(production.summary.shotCount) ||
    production.summary.currentTakeCount > production.summary.shotCount ||
    (production.state !== 'blocked' && production.state !== expectedProductionState) ||
    !validStatusCount(cut.summary.currentTakeCount) ||
    !validStatusCount(cut.summary.shotCount) ||
    cut.summary.currentTakeCount > cut.summary.shotCount ||
    typeof cut.summary.structurallyPlayable !== 'boolean' ||
    (cut.summary.structurallyPlayable &&
      cut.summary.shotCount > 0 &&
      cut.summary.currentTakeCount !== cut.summary.shotCount) ||
    (cut.summary.structurallyPlayable && cut.summary.shotCount === 0 && storyboard.summary.beatCount === 0) ||
    (cut.state !== 'blocked' &&
      cut.summary.shotCount > 0 &&
      cut.summary.currentTakeCount === cut.summary.shotCount &&
      !cut.summary.structurallyPlayable) ||
    (cut.state !== 'blocked' && cut.state !== expectedCutState) ||
    !validStatusCount(exact.boards.currentPictureCount) ||
    !validStatusCount(exact.boards.shotCount) ||
    exact.boards.currentPictureCount > exact.boards.shotCount ||
    storyboard.summary.shotCount !== bindings.summary.shotCount ||
    storyboard.summary.shotCount !== production.summary.shotCount ||
    storyboard.summary.shotCount !== cut.summary.shotCount ||
    storyboard.summary.shotCount !== exact.boards.shotCount ||
    production.summary.currentTakeCount !== cut.summary.currentTakeCount ||
    !denseStatusArray(exact.advisories, 0, 512) ||
    !exact.advisories.every(validWorkspaceAdvisory)
  ) {
    return null;
  }

  const expectedNextStage =
    exact.blockerCount === 0 ? exact.stages.find((candidate) => candidate.state !== 'complete') : undefined;
  const nextActions = exact.advisories.filter((advisory) => advisory.cause === 'next_action');
  if (
    expectedNextStage === undefined
      ? nextActions.length !== 0
      : nextActions.length !== 1 || nextActions[0]!.stage !== expectedNextStage.id
  ) {
    return null;
  }
  const nextAction =
    expectedNextStage === undefined
      ? null
      : { stage: expectedNextStage.id, view: viewForStatusStage(expectedNextStage.id) };
  const tableStage =
    storyboard.state !== 'complete' ? storyboard : bindings.state !== 'complete' ? bindings : storyboard;
  const boardHasContent =
    production.summary.currentTakeCount > 0 ||
    production.summary.activeJobCount > 0 ||
    exact.boards.currentPictureCount > 0 ||
    production.state === 'in_progress' ||
    production.state === 'blocked';
  const cutHasContent =
    cut.summary.currentTakeCount > 0 ||
    cut.summary.structurallyPlayable ||
    cut.state === 'in_progress' ||
    cut.state === 'blocked';
  const recommendedView = nextAction?.view ?? null;

  return {
    views: {
      references: {
        stage: 'references',
        state: references.state,
        readiness: references.summary.plannedCount === 0 && references.state === 'complete' ? 'empty' : 'ready',
        currentCount: references.summary.approvedCount,
        totalCount: references.summary.plannedCount,
        recommended: recommendedView === 'references',
      },
      table: {
        stage: tableStage.id,
        state: tableStage.state,
        readiness:
          storyboard.summary.beatCount === 0 && storyboard.state === 'complete'
            ? 'empty'
            : storyboard.summary.beatCount === 0 && storyboard.state === 'not_started'
              ? 'not_started'
              : 'ready',
        currentCount:
          tableStage.id === 'bindings' ? bindings.summary.readyShotCount : storyboard.summary.authoredShotCount,
        totalCount: tableStage.id === 'bindings' ? bindings.summary.shotCount : storyboard.summary.shotCount,
        recommended: recommendedView === 'table',
      },
      board: {
        stage: 'production',
        state: production.state,
        readiness: boardHasContent ? 'ready' : 'not_started',
        currentCount: production.summary.currentTakeCount,
        totalCount: production.summary.shotCount,
        recommended: recommendedView === 'board',
      },
      cut: {
        stage: 'cut',
        state: cut.state,
        readiness: cutHasContent ? 'ready' : 'not_started',
        currentCount: cut.summary.currentTakeCount,
        totalCount: cut.summary.shotCount,
        recommended: recommendedView === 'cut',
      },
    },
    nextAction,
  };
};
