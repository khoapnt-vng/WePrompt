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
  StudioLineHistoryEntry,
  StudioPlanningShotBoundaryV2,
  StudioRendererChainConditioningFailureV2,
  StudioRendererChainStatusV2,
  StudioRendererDirtyShotV2,
  StudioRendererParkEligibilityV2,
  StudioRendererProjectV2,
  StudioRendererUndoTopV2,
  StudioRendererWorkspaceStatusV2,
  StudioShot,
} from '@/common/types/project/creativeStudioTypes';
import { STUDIO_BED_FADE_OUT_SECONDS } from '@/common/types/project/creativeStudioTypes';
import { isCanonicalStudioGeneratedTakeV2 } from '@/common/types/project/creativeStudioCanonicalTake';
import {
  studioPlanningShotBoundariesV2,
  studioShotPlayedDurationV2,
} from '@/common/types/project/creativeStudioProjectSummary';

export type WorkspaceShotDisplayState = 'draft' | 'seed_ready' | 'takes_available' | 'selected_take';

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

export type WorkspaceTakeProjection = {
  assetId: string;
  mediaKind: Extract<StudioAssetV2['mediaKind'], 'image' | 'video'>;
  createdAt: string;
  selected: boolean;
  explicitSeed: boolean;
  effectiveSeed: boolean;
  binReason: Extract<StudioBinItem, { kind: 'take' }>['reason'] | null;
  sourceDurationSeconds: number | null;
  posterAssetId: string | null;
};

export type WorkspaceShotProjection = {
  id: string;
  line: string;
  narration: string;
  onScreenText: string;
  durationSeconds: number;
  chainBreak: StudioShot['chainBreak'];
  derivation: StudioShot['derivation'];
  derivedFromActionRevision: number | null;
  derivationStale: boolean;
  trimInSeconds: number | null;
  trimOutSeconds: number | null;
  selectedTakeId: string | null;
  selectedTakeSourceDurationSeconds: number | null;
  playedDurationSeconds: number | null;
  explicitSeedAssetId: string | null;
  effectiveSeedAssetId: string | null;
  segmentHead: boolean;
  planningBoundary: StudioPlanningShotBoundaryV2 | null;
  dirtyCauses: StudioRendererDirtyShotV2['causes'];
  downstreamShotIds: string[];
  imageTakes: WorkspaceTakeProjection[];
  videoTakes: WorkspaceTakeProjection[];
  coverAssetId: string | null;
  takeCount: number;
  displayState: WorkspaceShotDisplayState;
  retainedWork: boolean;
  videoGenerationInFlight: boolean;
  seedGenerationInFlight: boolean;
  /** True while a job blocks a fresh submission, including one that failed and needs the user. */
  videoGenerationBlocked: boolean;
  seedGenerationBlocked: boolean;
  hasEffectiveSeed: boolean;
};

export type WorkspaceBeatProjection = {
  id: string;
  title: string;
  action: string;
  look: string;
  actionRevision: number;
  lineHistory: StudioLineHistoryEntry[];
  targetSeconds: number | null;
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

export type WorkspaceBinnedTakeProjection = {
  assetId: string;
  shotId: string;
  shotLine: string;
  beatId: string;
  beatTitle: string;
  ownerBeatBinned: boolean;
  reason: Extract<StudioBinItem, { kind: 'take' }>['reason'];
  mediaKind: Extract<StudioAssetV2['mediaKind'], 'image' | 'video'>;
  createdAt: string;
  sourceDurationSeconds: number | null;
  posterAssetId: string | null;
  coverAssetId: string | null;
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
    }
  | {
      kind: 'take';
      position: number;
      identity: Extract<StudioBinItem, { kind: 'take' }>;
      value: WorkspaceBinnedTakeProjection;
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

export type WorkspaceCutMatchCandidateProjection = {
  shotId: string;
  beatId: string;
  beatTitle: string;
  line: string;
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
  matchCandidates: WorkspaceCutMatchCandidateProjection[];
  selectedMatchShotId: string | null;
  matchSelectionInvalid: boolean;
};

export type WorkspaceProjection = {
  projectId: string;
  projectRevision: number;
  activeBeats: WorkspaceBeatProjection[];
  activeBeatIds: string[];
  activeShotIds: string[];
  coverageGapBeatIds: string[];
  workspaceStatusReady: boolean;
  chainStatusReady: boolean;
  requestShapeLocked: boolean;
  cut: WorkspaceCutProjection;
  bin: {
    items: WorkspaceBinItemProjection[];
    beats: WorkspaceBinnedBeatProjection[];
    shots: WorkspaceBinnedShotProjection[];
    takes: WorkspaceBinnedTakeProjection[];
  };
  undoTop: StudioRendererUndoTopV2 | null;
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

const videoPosterId = (project: StudioRendererProjectV2, shot: StudioShot, videoTake: StudioAssetV2): string | null => {
  const producingJobs = shot.jobIds.flatMap((jobId) => {
    const job = ownValue(project.jobs, jobId);
    return job?.id === jobId &&
      job.projectId === project.id &&
      job.shotId === shot.id &&
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

const isBinnedTake = (project: StudioRendererProjectV2, assetId: string): boolean =>
  project.bin.some((item) => item.kind === 'take' && item.assetId === assetId);

const takeBinReason = (project: StudioRendererProjectV2, assetId: string): WorkspaceTakeProjection['binReason'] =>
  project.bin.find((item) => item.kind === 'take' && item.assetId === assetId)?.reason ?? null;

const isEligibleImageTake = (project: StudioRendererProjectV2, shot: StudioShot, asset: StudioAssetV2): boolean =>
  asset.mediaKind === 'image' &&
  (asset.managedAsset.collection === 'assets' || asset.managedAsset.collection === 'imports') &&
  asset.briefReferenceRole === undefined &&
  asset.briefReferenceLabel === undefined &&
  asset.projectId === project.id &&
  asset.shotId === shot.id &&
  shot.assetIds.includes(asset.id);

const validVideoSourceDuration = (asset: StudioAssetV2): number | null =>
  asset.mediaKind === 'video' &&
  asset.durationSeconds !== undefined &&
  Number.isFinite(asset.durationSeconds) &&
  asset.durationSeconds > 0 &&
  asset.durationSeconds <= Number.MAX_SAFE_INTEGER
    ? asset.durationSeconds
    : null;

const validSelectedVideoTake = (project: StudioRendererProjectV2, shot: StudioShot): StudioAssetV2 | null => {
  if (shot.selectedTakeId === null || isBinnedTake(project, shot.selectedTakeId)) return null;
  const selected = isOwnedAsset(project, shot, shot.selectedTakeId);
  return selected !== null &&
    selected.mediaKind === 'video' &&
    isCanonicalStudioGeneratedTakeV2(selected, project.id, shot)
    ? selected
    : null;
};

const validExplicitSeedStillId = (project: StudioRendererProjectV2, shot: StudioShot): string | null => {
  if (shot.seedStillId === null || isBinnedTake(project, shot.seedStillId)) return null;
  const seed = isOwnedAsset(project, shot, shot.seedStillId);
  return seed !== null &&
    seed.mediaKind === 'image' &&
    (seed.managedAsset.collection === 'assets' || seed.managedAsset.collection === 'imports') &&
    seed.briefReferenceRole === undefined &&
    seed.briefReferenceLabel === undefined &&
    shot.assetIds.includes(seed.id)
    ? seed.id
    : null;
};

const effectiveSeedStillId = (project: StudioRendererProjectV2, shot: StudioShot): string | null => {
  const explicit = validExplicitSeedStillId(project, shot);
  if (explicit !== null) return explicit;
  const candidates = shot.assetIds.flatMap((assetId) => {
    const asset = isOwnedAsset(project, shot, assetId);
    return asset !== null && !isBinnedTake(project, asset.id) && isEligibleImageTake(project, shot, asset)
      ? [asset]
      : [];
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

const compareTakeNewestFirst = (left: WorkspaceTakeProjection, right: WorkspaceTakeProjection): number => {
  if (left.createdAt !== right.createdAt) return left.createdAt < right.createdAt ? 1 : -1;
  if (left.assetId === right.assetId) return 0;
  return left.assetId < right.assetId ? 1 : -1;
};

const projectTakes = (input: {
  project: StudioRendererProjectV2;
  shot: StudioShot;
  selectedTakeId: string | null;
  explicitSeedAssetId: string | null;
  effectiveSeedAssetId: string | null;
}): { imageTakes: WorkspaceTakeProjection[]; videoTakes: WorkspaceTakeProjection[] } => {
  const imageTakes: WorkspaceTakeProjection[] = [];
  const videoTakes: WorkspaceTakeProjection[] = [];
  for (const assetId of new Set(input.shot.assetIds)) {
    const asset = isOwnedAsset(input.project, input.shot, assetId);
    if (asset === null) continue;
    const binReason = takeBinReason(input.project, asset.id);
    if (isEligibleImageTake(input.project, input.shot, asset)) {
      imageTakes.push({
        assetId: asset.id,
        mediaKind: 'image',
        createdAt: asset.createdAt,
        selected: false,
        explicitSeed: input.explicitSeedAssetId === asset.id,
        effectiveSeed: input.effectiveSeedAssetId === asset.id,
        binReason,
        sourceDurationSeconds: null,
        posterAssetId: null,
      });
      continue;
    }
    if (asset.mediaKind !== 'video' || !isCanonicalStudioGeneratedTakeV2(asset, input.project.id, input.shot)) {
      continue;
    }
    videoTakes.push({
      assetId: asset.id,
      mediaKind: 'video',
      createdAt: asset.createdAt,
      selected: input.selectedTakeId === asset.id,
      explicitSeed: false,
      effectiveSeed: false,
      binReason,
      sourceDurationSeconds: validVideoSourceDuration(asset),
      posterAssetId: videoPosterId(input.project, input.shot, asset),
    });
  }
  imageTakes.sort(compareTakeNewestFirst);
  videoTakes.sort(compareTakeNewestFirst);
  return { imageTakes, videoTakes };
};

const hasOwnedJob = (project: StudioRendererProjectV2, shot: StudioShot): boolean =>
  shot.jobIds.some((jobId) => {
    const job = ownValue(project.jobs, jobId);
    return job?.id === jobId && job.projectId === project.id && job.shotId === shot.id;
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
      job.shotId === shot.id &&
      job.purpose === purpose &&
      statuses.has(job.status)
    );
  });
};

const projectShot = (
  project: StudioRendererProjectV2,
  shot: StudioShot,
  context: {
    beatActionRevision: number | null;
    segmentHead: boolean;
    planningBoundary: StudioPlanningShotBoundaryV2 | null;
    dirtyCauses: ReadonlyArray<StudioRendererDirtyShotV2['causes'][number]>;
    downstreamShotIds: readonly string[];
  }
): WorkspaceShotProjection => {
  const explicitSeedAssetId = validExplicitSeedStillId(project, shot);
  const effectiveSeedAssetId = context.segmentHead ? effectiveSeedStillId(project, shot) : null;
  const selectedTake = validSelectedVideoTake(project, shot);
  const selectedTakeId = selectedTake?.id ?? null;
  const { imageTakes, videoTakes } = projectTakes({
    project,
    shot,
    selectedTakeId,
    explicitSeedAssetId,
    effectiveSeedAssetId,
  });
  const activeTakeCount = [...imageTakes, ...videoTakes].filter((take) => take.binReason === null).length;
  const activeVideoTakeCount = videoTakes.filter((take) => take.binReason === null).length;
  const selectedTakeSourceDurationSeconds = selectedTake === null ? null : validVideoSourceDuration(selectedTake);
  const playedDurationSeconds = studioShotPlayedDurationV2(project, shot);
  const displayState: WorkspaceShotDisplayState =
    selectedTake !== null && selectedTakeSourceDurationSeconds !== null && playedDurationSeconds !== null
      ? 'selected_take'
      : activeVideoTakeCount > 0
        ? 'takes_available'
        : effectiveSeedAssetId !== null
          ? 'seed_ready'
          : 'draft';
  return {
    id: shot.id,
    line: shot.line,
    narration: shot.narration,
    onScreenText: shot.onScreenText,
    durationSeconds: shot.durationSeconds,
    chainBreak: shot.chainBreak,
    derivation: shot.derivation,
    derivedFromActionRevision: shot.derivedFromActionRevision,
    derivationStale:
      shot.derivation === 'derived' &&
      context.beatActionRevision !== null &&
      shot.derivedFromActionRevision !== context.beatActionRevision,
    trimInSeconds: shot.trimInSeconds,
    trimOutSeconds: shot.trimOutSeconds,
    selectedTakeId,
    selectedTakeSourceDurationSeconds,
    playedDurationSeconds,
    explicitSeedAssetId,
    effectiveSeedAssetId,
    segmentHead: context.segmentHead,
    planningBoundary: context.planningBoundary === null ? null : { ...context.planningBoundary },
    dirtyCauses: [...context.dirtyCauses],
    downstreamShotIds: [...context.downstreamShotIds],
    imageTakes,
    videoTakes,
    coverAssetId: (selectedTake === null ? null : videoPosterId(project, shot, selectedTake)) ?? effectiveSeedAssetId,
    takeCount: activeTakeCount,
    displayState,
    retainedWork: imageTakes.length + videoTakes.length > 0 || hasOwnedJob(project, shot),
    videoGenerationInFlight: hasOwnedGenerationWithStatus(project, shot, 'video_take', GENERATION_IN_FLIGHT_STATUSES),
    seedGenerationInFlight: hasOwnedGenerationWithStatus(project, shot, 'seed_still', GENERATION_IN_FLIGHT_STATUSES),
    videoGenerationBlocked: hasOwnedGenerationWithStatus(project, shot, 'video_take', GENERATION_BLOCKING_STATUSES),
    seedGenerationBlocked: hasOwnedGenerationWithStatus(project, shot, 'seed_still', GENERATION_BLOCKING_STATUSES),
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
    asset.briefReferenceRole === undefined &&
    asset.briefReferenceLabel === undefined &&
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

  const matchCandidates: WorkspaceCutMatchCandidateProjection[] = [];
  const seenShotIds = new Set<string>();
  if (orderReady) {
    for (const beat of activeBeats) {
      for (const shot of beat.shots) {
        if (
          seenShotIds.has(shot.id) ||
          !isSafeStudioId(shot.id) ||
          !isDisplayText(shot.line) ||
          !seenBeatIds.has(beat.id)
        ) {
          continue;
        }
        seenShotIds.add(shot.id);
        matchCandidates.push({
          shotId: shot.id,
          beatId: beat.id,
          beatTitle: beat.title,
          line: shot.line,
          coverAssetId: shot.coverAssetId === null || isSafeStudioId(shot.coverAssetId) ? shot.coverAssetId : null,
        });
      }
    }
  }
  const selectedMatchShotId =
    project.matchToShotId !== null &&
    isSafeStudioId(project.matchToShotId) &&
    matchCandidates.some((candidate) => candidate.shotId === project.matchToShotId)
      ? project.matchToShotId
      : null;

  return {
    orderReady,
    beats,
    filmDurationSeconds,
    targetDurationSeconds,
    audioImports,
    bed,
    matchCandidates,
    selectedMatchShotId,
    matchSelectionInvalid: project.matchToShotId !== null && selectedMatchShotId === null,
  };
};

const PART_DONE_CASCADE_REASONS: ReadonlySet<StudioCascadeProgressV2['waitingReason']> = new Set([
  'choose_seed',
  'choose_take',
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
  return shots.every((shot) => shot.displayState === 'selected_take') ? 'ready' : 'draft';
};

const hasSafeBeatDisplayFacts = (beat: StudioBeat): boolean =>
  isDisplayText(beat.title) &&
  isDisplayText(beat.action) &&
  isDisplayText(beat.look) &&
  Number.isSafeInteger(beat.actionRevision) &&
  beat.actionRevision >= 0 &&
  (beat.targetSeconds === null ||
    (Number.isSafeInteger(beat.targetSeconds) &&
      beat.targetSeconds > 0 &&
      beat.targetSeconds <= Number.MAX_SAFE_INTEGER)) &&
  Array.isArray(beat.shotOrder) &&
  Array.isArray(beat.lineHistory) &&
  beat.lineHistory.every(
    (entry) =>
      entry !== null &&
      typeof entry === 'object' &&
      isSafeStudioId(entry.id) &&
      Number.isSafeInteger(entry.shotOrdinal) &&
      entry.shotOrdinal > 0 &&
      isDisplayText(entry.text) &&
      isDisplayTimestamp(entry.capturedAt)
  );

const hasSafeShotDisplayFacts = (shot: StudioShot): boolean =>
  isDisplayText(shot.line) &&
  isDisplayText(shot.narration) &&
  isDisplayText(shot.onScreenText) &&
  Number.isSafeInteger(shot.durationSeconds) &&
  shot.durationSeconds > 0 &&
  (shot.chainBreak === 'none' || shot.chainBreak === 'hard_cut') &&
  (shot.derivation === 'derived' || shot.derivation === 'detached') &&
  (shot.derivedFromActionRevision === null ||
    (Number.isSafeInteger(shot.derivedFromActionRevision) && shot.derivedFromActionRevision >= 0)) &&
  (shot.trimInSeconds === null || (Number.isFinite(shot.trimInSeconds) && shot.trimInSeconds >= 0)) &&
  (shot.trimOutSeconds === null || (Number.isFinite(shot.trimOutSeconds) && shot.trimOutSeconds >= 0)) &&
  (shot.seedStillId === null || isSafeStudioId(shot.seedStillId)) &&
  (shot.selectedTakeId === null || isSafeStudioId(shot.selectedTakeId)) &&
  Array.isArray(shot.assetIds) &&
  Array.isArray(shot.jobIds);

const binIdentityKey = (item: StudioBinItem): string | null => {
  if (item.kind === 'beat') {
    return isSafeStudioId(item.beatId) && (item.reason === 'lifted' || item.reason === 'alternate')
      ? `beat:${item.beatId}`
      : null;
  }
  if (item.kind === 'shot') {
    return isSafeStudioId(item.beatId) && isSafeStudioId(item.shotId) && item.reason === 'lifted'
      ? `shot:${item.shotId}`
      : null;
  }
  return isSafeStudioId(item.assetId) && (item.reason === 'lifted' || item.reason === 'alternate')
    ? `take:${item.assetId}`
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
      beatActionRevision: input.beat.actionRevision,
      segmentHead: shotIndex === 0 || shot.chainBreak === 'hard_cut',
      planningBoundary: boundaryByShotId.get(shot.id) ?? null,
      dirtyCauses: input.status.dirtyCausesByShotId.get(shot.id) ?? [],
      downstreamShotIds,
    });
  });
  return {
    id: input.beat.id,
    title: input.beat.title,
    action: input.beat.action,
    look: input.beat.look,
    actionRevision: input.beat.actionRevision,
    lineHistory: input.beat.lineHistory.map((entry) => ({ ...entry })),
    targetSeconds: input.beat.targetSeconds,
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
      return projectShot(project, shot, {
        beatActionRevision: beat.actionRevision,
        segmentHead: shotIndex === 0 || shot.chainBreak === 'hard_cut',
        planningBoundary: planningBoundaryByShotId.get(shot.id) ?? null,
        dirtyCauses: dirtyCausesByShotId.get(shot.id) ?? [],
        downstreamShotIds,
      });
    });
    return [
      {
        id: beat.id,
        title: beat.title,
        action: beat.action,
        look: beat.look,
        actionRevision: beat.actionRevision,
        lineHistory: beat.lineHistory.map((entry) => ({ ...entry })),
        targetSeconds: beat.targetSeconds,
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
  const binnedTakes: WorkspaceBinnedTakeProjection[] = [];
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
        beatActionRevision: owner.beat.actionRevision,
        segmentHead: shot.chainBreak === 'hard_cut',
        planningBoundary: null,
        dirtyCauses: dirtyCausesByShotId.get(shot.id) ?? [],
        downstreamShotIds: [],
      });
      const selectedTake = validSelectedVideoTake(project, shot);
      const binnedCoverAssetId =
        (selectedTake === null ? null : videoPosterId(project, shot, selectedTake)) ??
        effectiveSeedStillId(project, shot);
      const value: WorkspaceBinnedShotProjection = {
        ...projectedShot,
        coverAssetId: binnedCoverAssetId,
        takeCount: projectedShot.imageTakes.length + projectedShot.videoTakes.length,
        retainedWork:
          projectedShot.imageTakes.length + projectedShot.videoTakes.length > 0 || hasOwnedJob(project, shot),
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

    const asset = ownValue(project.assets, item.assetId);
    if (asset?.id !== item.assetId || asset.shotId === null) continue;
    const shot = validShot(project, asset.shotId);
    const owner = shot === null ? undefined : owners.get(shot.id);
    if (
      shot === null ||
      !hasSafeShotDisplayFacts(shot) ||
      owner === undefined ||
      isOwnedAsset(project, shot, item.assetId) === null
    ) {
      continue;
    }
    const segmentHead = owner.source === 'bin' || owner.shotIndex === 0 || shot.chainBreak === 'hard_cut';
    const explicitSeedAssetId = validExplicitSeedStillId(project, shot);
    const effectiveSeedAssetId = segmentHead ? effectiveSeedStillId(project, shot) : null;
    const selectedTakeId = validSelectedVideoTake(project, shot)?.id ?? null;
    const projectedTakes = projectTakes({
      project,
      shot,
      selectedTakeId,
      explicitSeedAssetId,
      effectiveSeedAssetId,
    });
    const projectedTake = [...projectedTakes.imageTakes, ...projectedTakes.videoTakes].find(
      (take) => take.assetId === item.assetId
    );
    if (projectedTake === undefined) continue;
    const value: WorkspaceBinnedTakeProjection = {
      assetId: projectedTake.assetId,
      shotId: shot.id,
      shotLine: shot.line,
      beatId: owner.beat.id,
      beatTitle: owner.beat.title,
      ownerBeatBinned: owner.beatBinned,
      reason: item.reason,
      mediaKind: projectedTake.mediaKind,
      createdAt: projectedTake.createdAt,
      sourceDurationSeconds: projectedTake.sourceDurationSeconds,
      posterAssetId: projectedTake.posterAssetId,
      coverAssetId: projectedTake.mediaKind === 'image' ? projectedTake.assetId : projectedTake.posterAssetId,
    };
    const identity: Extract<StudioBinItem, { kind: 'take' }> = {
      kind: 'take',
      assetId: item.assetId,
      reason: item.reason,
    };
    binnedTakes.push(value);
    binnedItems.push({ kind: 'take', position, identity, value });
  }

  return {
    projectId: project.id,
    projectRevision: project.revision,
    activeBeats,
    activeBeatIds,
    activeShotIds,
    coverageGapBeatIds: activeBeats.filter((beat) => beat.shots.length === 0).map((beat) => beat.id),
    workspaceStatusReady: matchedWorkspaceStatus !== null,
    chainStatusReady: matchedChainStatus !== null,
    requestShapeLocked:
      matchedWorkspaceStatus?.parkEligibility.some((row) =>
        row.blockers.some((blocker) => blocker.code === 'bound_nonterminal_request')
      ) ?? false,
    cut: projectCut(project, activeBeats),
    bin: { items: binnedItems, beats: binnedBeats, shots: binnedShots, takes: binnedTakes },
    undoTop:
      matchedWorkspaceStatus?.undoTop === null || matchedWorkspaceStatus === null
        ? null
        : { ...matchedWorkspaceStatus.undoTop },
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
  filmSeconds: number | null;
  targetSeconds: number | null;
};

/**
 * What the app bar states about the film: how many Beats it holds, how many Shots those carry, how
 * many are ready, and the film's length against the target it is authored to. An unknown length is
 * carried through as null rather than defaulted to zero — a film that has not been measured must not
 * read as a film of no length.
 */
export const buildStudioBarStats = (projection: WorkspaceProjection): StudioBarStats => {
  let shotCount = 0;
  let readyCount = 0;
  for (const beat of projection.activeBeats) {
    shotCount += beat.shots.length;
    if (beat.displayState === 'ready') readyCount += 1;
  }
  return {
    beatCount: projection.activeBeats.length,
    shotCount,
    readyCount,
    filmSeconds: projection.cut.filmDurationSeconds,
    targetSeconds: projection.cut.targetDurationSeconds,
  };
};
