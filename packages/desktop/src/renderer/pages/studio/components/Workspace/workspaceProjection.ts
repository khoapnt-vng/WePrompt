/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  StudioAssetV2,
  StudioBeat,
  StudioBinItem,
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

export type WorkspaceShotDisplayState = 'draft' | 'seed_ready' | 'takes_available' | 'selected_take';

export type WorkspaceShotProjection = {
  id: string;
  line: string;
  narration: string;
  onScreenText: string;
  durationSeconds: number;
  chainBreak: StudioShot['chainBreak'];
  derivation: StudioShot['derivation'];
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
  targetSeconds: number | null;
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

const selectedVideoPosterId = (project: StudioRendererProjectV2, shot: StudioShot): string | null => {
  if (shot.selectedTakeId === null) return null;
  const selectedTake = isOwnedAsset(project, shot, shot.selectedTakeId);
  if (
    selectedTake === null ||
    selectedTake.mediaKind !== 'video' ||
    !isCanonicalStudioGeneratedTakeV2(selectedTake, project.id, shot)
  ) {
    return null;
  }

  const producingJobs = shot.jobIds.flatMap((jobId) => {
    const job = ownValue(project.jobs, jobId);
    return job?.id === jobId &&
      job.projectId === project.id &&
      job.shotId === shot.id &&
      job.status === 'succeeded' &&
      job.purpose === 'video_take' &&
      job.outputAssetIdsByRole.primary === selectedTake.id &&
      job.outputAssetIds.filter((assetId) => assetId === selectedTake.id).length === 1
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
    return asset !== null &&
      asset.mediaKind === 'image' &&
      !isBinnedTake(project, asset.id) &&
      (asset.managedAsset.collection === 'assets' || asset.managedAsset.collection === 'imports') &&
      asset.briefReferenceRole === undefined &&
      asset.briefReferenceLabel === undefined &&
      shot.assetIds.includes(asset.id)
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

const canonicalTakeCount = (project: StudioRendererProjectV2, shot: StudioShot): number =>
  shot.assetIds.filter((assetId) => {
    const asset = isOwnedAsset(project, shot, assetId);
    return (
      asset !== null &&
      !isBinnedTake(project, asset.id) &&
      asset.briefReferenceRole === undefined &&
      asset.briefReferenceLabel === undefined &&
      ((asset.mediaKind === 'image' &&
        (asset.managedAsset.collection === 'assets' || asset.managedAsset.collection === 'imports')) ||
        (asset.mediaKind === 'video' && isCanonicalStudioGeneratedTakeV2(asset, project.id, shot)))
    );
  }).length;

const canonicalVideoTakeCount = (project: StudioRendererProjectV2, shot: StudioShot): number =>
  shot.assetIds.filter((assetId) => {
    const asset = isOwnedAsset(project, shot, assetId);
    return (
      asset?.mediaKind === 'video' &&
      !isBinnedTake(project, asset.id) &&
      isCanonicalStudioGeneratedTakeV2(asset, project.id, shot)
    );
  }).length;

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

const projectShot = (project: StudioRendererProjectV2, shot: StudioShot): WorkspaceShotProjection => {
  const takeCount = canonicalTakeCount(project, shot);
  const videoTakeCount = canonicalVideoTakeCount(project, shot);
  const seedStillId = effectiveSeedStillId(project, shot);
  const selectedTake = shot.selectedTakeId === null ? null : isOwnedAsset(project, shot, shot.selectedTakeId);
  const hasSelectedTake =
    selectedTake?.mediaKind === 'video' &&
    !isBinnedTake(project, selectedTake.id) &&
    isCanonicalStudioGeneratedTakeV2(selectedTake, project.id, shot);
  const displayState: WorkspaceShotDisplayState = hasSelectedTake
    ? 'selected_take'
    : videoTakeCount > 0
      ? 'takes_available'
      : seedStillId !== null
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
    coverAssetId: selectedVideoPosterId(project, shot) ?? seedStillId,
    takeCount,
    displayState,
    retainedWork: takeCount > 0 || seedStillId !== null || hasOwnedJob(project, shot),
    videoGenerationInFlight: hasOwnedGenerationInFlight(project, shot, 'video_take'),
    seedGenerationInFlight: hasOwnedGenerationInFlight(project, shot, 'seed_still'),
    hasEffectiveSeed: seedStillId !== null,
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
  const activeShotIds: string[] = [];
  const activeBeats = project.beatOrder.flatMap((beatId) => {
    const beat = validBeat(project, beatId);
    if (beat === null) return [];
    const shots = beat.shotOrder.flatMap((shotId) => {
      const shot = validShot(project, shotId);
      if (shot === null) return [];
      activeShotIds.push(shot.id);
      return [projectShot(project, shot)];
    });
    return [
      {
        id: beat.id,
        title: beat.title,
        action: beat.action,
        look: beat.look,
        targetSeconds: beat.targetSeconds,
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
      binnedShots.push({ ...projectShot(project, shot), beatId: item.beatId, reason: item.reason });
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

  const matchedWorkspaceStatus = revisionMatches(project, workspaceStatus) ? workspaceStatus : null;
  const matchedChainStatus = revisionMatches(project, chainStatus) ? chainStatus : null;
  return {
    projectId: project.id,
    projectRevision: project.revision,
    activeBeats,
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
