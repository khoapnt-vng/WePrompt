/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
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
  StudioCascadeProgressV2,
} from '@/common/types/project/creativeStudioTypes';
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
};

export type WorkspaceBinnedBeatProjection = Pick<
  WorkspaceBeatProjection,
  'id' | 'title' | 'action' | 'look' | 'targetSeconds'
> & {
  reason: Extract<StudioBinItem, { kind: 'beat' }>['reason'];
  shotCount: number;
};

export type WorkspaceBinnedShotProjection = WorkspaceShotProjection & {
  beatId: string;
  reason: Extract<StudioBinItem, { kind: 'shot' }>['reason'];
};

export type WorkspaceBinnedTakeProjection = {
  assetId: string;
  shotId: string;
  beatId: string | null;
  reason: Extract<StudioBinItem, { kind: 'take' }>['reason'];
  mediaKind: Extract<StudioAssetV2['mediaKind'], 'image' | 'video'>;
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
  bin: {
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

const ownValue = <Value>(record: Readonly<Record<string, Value>>, id: string): Value | undefined =>
  Object.hasOwn(record, id) ? record[id] : undefined;

const isOwnedAsset = (project: StudioRendererProjectV2, shot: StudioShot, assetId: string): StudioAssetV2 | null => {
  const asset = ownValue(project.assets, assetId);
  return asset?.id === assetId && asset.projectId === project.id && asset.shotId === shot.id ? asset : null;
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

const hasOwnedGenerationInFlight = (
  project: StudioRendererProjectV2,
  shot: StudioShot,
  purpose: 'seed_still' | 'video_take'
): boolean => {
  const statuses = new Set([
    'waiting_for_conditioning',
    'queued_local',
    'submitting',
    'queued_remote',
    'running',
    'needs_attention',
  ]);
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
    retainedWork: activeTakeCount > 0 || effectiveSeedAssetId !== null || hasOwnedJob(project, shot),
    videoGenerationInFlight: hasOwnedGenerationInFlight(project, shot, 'video_take'),
    seedGenerationInFlight: hasOwnedGenerationInFlight(project, shot, 'seed_still'),
    hasEffectiveSeed: effectiveSeedAssetId !== null,
  };
};

const validBeat = (project: StudioRendererProjectV2, beatId: string): StudioBeat | null => {
  const beat = ownValue(project.beats, beatId);
  return beat?.id === beatId ? beat : null;
};

const validShot = (project: StudioRendererProjectV2, shotId: string): StudioShot | null => {
  const shot = ownValue(project.shots, shotId);
  return shot?.id === shotId ? shot : null;
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
      },
    ];
  });

  const shotOwnerById = new Map<string, string>();
  for (const beat of Object.values(project.beats)) {
    if (beat?.id === undefined) continue;
    for (const shotId of beat.shotOrder) {
      if (!shotOwnerById.has(shotId)) shotOwnerById.set(shotId, beat.id);
    }
  }
  for (const item of project.bin) {
    if (item.kind === 'shot' && !shotOwnerById.has(item.shotId)) shotOwnerById.set(item.shotId, item.beatId);
  }

  const binnedBeats: WorkspaceBinnedBeatProjection[] = [];
  const binnedShots: WorkspaceBinnedShotProjection[] = [];
  const binnedTakes: WorkspaceBinnedTakeProjection[] = [];
  for (const item of project.bin) {
    if (item.kind === 'beat') {
      const beat = validBeat(project, item.beatId);
      if (beat === null) continue;
      binnedBeats.push({
        id: beat.id,
        title: beat.title,
        action: beat.action,
        look: beat.look,
        targetSeconds: beat.targetSeconds,
        reason: item.reason,
        shotCount: beat.shotOrder.length,
      });
      continue;
    }
    if (item.kind === 'shot') {
      const shot = validShot(project, item.shotId);
      if (shot === null) continue;
      const owner = validBeat(project, item.beatId);
      binnedShots.push({
        ...projectShot(project, shot, {
          beatActionRevision: owner?.actionRevision ?? null,
          segmentHead: false,
          planningBoundary: null,
          dirtyCauses: dirtyCausesByShotId.get(shot.id) ?? [],
          downstreamShotIds: [],
        }),
        beatId: item.beatId,
        reason: item.reason,
      });
      continue;
    }
    const asset = ownValue(project.assets, item.assetId);
    if (
      asset?.id !== item.assetId ||
      asset.projectId !== project.id ||
      asset.shotId === null ||
      (asset.mediaKind !== 'image' && asset.mediaKind !== 'video')
    ) {
      continue;
    }
    binnedTakes.push({
      assetId: asset.id,
      shotId: asset.shotId,
      beatId: shotOwnerById.get(asset.shotId) ?? null,
      reason: item.reason,
      mediaKind: asset.mediaKind,
    });
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
    bin: { beats: binnedBeats, shots: binnedShots, takes: binnedTakes },
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
