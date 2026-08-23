/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  STUDIO_MAX_BIN_TAKE_ITEMS,
  STUDIO_MAX_SHOTS_PER_BEAT,
  type StudioAssetV2,
  type StudioCascadeProgressV2,
  type StudioJobV2,
  type StudioProjectV2,
  type StudioQuotedGeneration,
  type StudioRendererChainBoundaryV2,
  type StudioRendererChainStatusV2,
  type StudioRendererParkBlockerCodeV2,
  type StudioRendererParkBlockerV2,
  type StudioRendererParkEligibilityV2,
  type StudioRendererWorkspaceStatusV2,
  type StudioShot,
  type StudioSpendAuthorization,
} from '@/common/types/project/creativeStudioTypes';
import { deriveStudioDirtyShotsV2, deriveStudioInboundShotReferencesV2 } from './chain';
import { createStudioFrameExtractionId } from './generation';
import type { StudioVerifiedConditioningFrameV2 } from './lifecycle';

const NONTERMINAL_JOB_STATUSES: ReadonlySet<StudioJobV2['status']> = new Set([
  'waiting_for_conditioning',
  'queued_local',
  'submitting',
  'queued_remote',
  'running',
  'needs_attention',
]);

const BLOCKER_CODE_ORDER: readonly StudioRendererParkBlockerCodeV2[] = [
  'current_match_to',
  'own_nonterminal_job',
  'own_pending_frame',
  'downstream_nonterminal_job',
  'downstream_pending_frame',
  'waiting_authorization_dependency',
  'bound_nonterminal_request',
  'current_selected_take',
  'current_seed_still',
  'nonterminal_conditioning_use',
  'take_bin_capacity_reached',
  'beat_shot_capacity_reached',
];

type ActiveShotLocation = {
  beatId: string;
  shotId: string;
  shotIndex: number;
};

type AuthorizationItem = {
  authorization: StudioSpendAuthorization;
  item: StudioQuotedGeneration;
};

const ownValue = <T>(record: Readonly<Record<string, T>>, id: string): T | undefined =>
  Object.hasOwn(record, id) ? record[id] : undefined;

const activeShotLocations = (project: StudioProjectV2): ActiveShotLocation[] => {
  const result: ActiveShotLocation[] = [];
  for (const beatId of project.beatOrder) {
    const beat = ownValue(project.beats, beatId);
    if (beat === undefined) continue;
    for (let shotIndex = 0; shotIndex < beat.shotOrder.length; shotIndex += 1) {
      result.push({ beatId, shotId: beat.shotOrder[shotIndex]!, shotIndex });
    }
  }
  return result;
};

const shotOwners = (project: StudioProjectV2): Map<string, string> => {
  const result = new Map<string, string>();
  for (const beat of Object.values(project.beats)) {
    for (const shotId of beat.shotOrder) result.set(shotId, beat.id);
  }
  for (const item of project.bin) {
    if (item.kind === 'shot') result.set(item.shotId, item.beatId);
  }
  return result;
};

const isBinnedTake = (project: StudioProjectV2, assetId: string): boolean =>
  project.bin.some((item) => item.kind === 'take' && item.assetId === assetId);

const isCanonicalTake = (
  project: StudioProjectV2,
  shot: StudioShot,
  asset: StudioAssetV2 | undefined
): asset is StudioAssetV2 =>
  asset !== undefined &&
  asset.projectId === project.id &&
  asset.shotId === shot.id &&
  (asset.mediaKind === 'image' || asset.mediaKind === 'video') &&
  (asset.managedAsset.collection === 'assets' ||
    (asset.mediaKind === 'image' && asset.managedAsset.collection === 'imports')) &&
  shot.assetIds.includes(asset.id);

const jobsForItem = (project: StudioProjectV2, authorizationId: string, itemId: string): StudioJobV2[] =>
  Object.values(project.jobs)
    .filter((job) => job.authorizationId === authorizationId && job.authorizationItemId === itemId)
    .sort((left, right) => left.generationIndex - right.generationIndex || left.id.localeCompare(right.id));

const authorizationItems = (authorization: StudioSpendAuthorization): StudioQuotedGeneration[] => [
  ...authorization.baseItems,
  ...authorization.cascadeItems,
];

const primaryAssetIdsForItem = (
  project: StudioProjectV2,
  authorizationId: string,
  item: StudioQuotedGeneration
): string[] => {
  const result: string[] = [];
  const seen = new Set<string>();
  const shot = ownValue(project.shots, item.shotId);
  if (shot === undefined) return result;
  for (const job of jobsForItem(project, authorizationId, item.id)) {
    if (job.shotId !== item.shotId || job.purpose !== item.purpose) continue;
    const assetId = job.status === 'succeeded' ? job.outputAssetIdsByRole.primary : null;
    if (assetId === null || seen.has(assetId) || isBinnedTake(project, assetId)) continue;
    const asset = ownValue(project.assets, assetId);
    if (
      !isCanonicalTake(project, shot, asset) ||
      !job.outputAssetIds.includes(assetId) ||
      (item.purpose === 'seed_still' ? asset.mediaKind !== 'image' : asset.mediaKind !== 'video')
    ) {
      continue;
    }
    seen.add(assetId);
    result.push(assetId);
    if (result.length >= item.generationCount) break;
  }
  return result;
};

const latestVideoItemsByShot = (
  project: StudioProjectV2,
  activeShotIds: ReadonlySet<string>
): Map<string, AuthorizationItem> => {
  const result = new Map<string, AuthorizationItem>();
  for (const authorization of project.spendAuthorizations) {
    for (const item of authorizationItems(authorization)) {
      if (item.purpose === 'video_take' && activeShotIds.has(item.shotId)) {
        result.set(item.shotId, { authorization, item });
      }
    }
  }
  return result;
};

const projectCurrentVideoJobs = (
  project: StudioProjectV2,
  locations: readonly ActiveShotLocation[]
): StudioRendererWorkspaceStatusV2['currentVideoJobs'] => {
  const activeShotIds = new Set(locations.map((location) => location.shotId));
  const latestByShot = latestVideoItemsByShot(project, activeShotIds);
  return locations.map((location) => {
    const latest = latestByShot.get(location.shotId);
    return {
      shotId: location.shotId,
      jobIds:
        latest === undefined
          ? []
          : jobsForItem(project, latest.authorization.id, latest.item.id)
              .filter(
                (job) => job.projectId === project.id && job.shotId === location.shotId && job.purpose === 'video_take'
              )
              .map((job) => job.id),
    };
  });
};

const canCancelWaitingJobs = (jobs: readonly StudioJobV2[]): boolean => {
  const remaining = jobs.filter((job) => job.status !== 'cancelled');
  return (
    remaining.length > 0 &&
    remaining.every(
      (job) =>
        job.status === 'waiting_for_conditioning' &&
        job.requestSnapshot === null &&
        job.providerJobId === null &&
        (job.remoteStartedAt === undefined || job.remoteStartedAt === null) &&
        job.spendReceipt === null &&
        job.outputAssetIds.length === 0 &&
        job.outputAssetIdsByRole.primary === null &&
        job.outputAssetIdsByRole.poster === null &&
        job.error === null &&
        job.progress === undefined
    )
  );
};

const wasNeverDispatchedCancellation = (job: StudioJobV2): boolean =>
  job.status === 'cancelled' &&
  job.requestSnapshot === null &&
  job.providerJobId === null &&
  (job.remoteStartedAt === undefined || job.remoteStartedAt === null) &&
  job.spendReceipt === null &&
  job.outputAssetIds.length === 0 &&
  job.outputAssetIdsByRole.primary === null &&
  job.outputAssetIdsByRole.poster === null &&
  job.error === null &&
  job.progress === undefined;

const projectCascadeProgress = (
  project: StudioProjectV2,
  locations: readonly ActiveShotLocation[]
): StudioCascadeProgressV2[] => {
  const activeShotIds = new Set(locations.map((location) => location.shotId));
  const latestByShot = latestVideoItemsByShot(project, activeShotIds);
  const result: StudioCascadeProgressV2[] = [];

  for (const location of locations) {
    const latest = latestByShot.get(location.shotId);
    if (latest === undefined || latest.item.requestPlan.kind !== 'after_take_selection') continue;
    const siblings = jobsForItem(project, latest.authorization.id, latest.item.id);
    if (siblings.length === 0) continue;
    const remaining = siblings.filter((job) => job.status !== 'cancelled');
    const dependency = latest.item.requestPlan.dependency;
    const upstreamShotId = dependency.kind === 'authorized_seed' ? dependency.shotId : dependency.predecessorShotId;

    if (remaining.length === 0) {
      if (!siblings.every(wasNeverDispatchedCancellation)) continue;
      result.push({
        dependentShotId: location.shotId,
        upstreamShotId,
        eligiblePrimaryAssetIds: [],
        canRetryConditioningFrame: false,
        canCancelWaiting: false,
        waitingReason: 'cancelled',
      });
      continue;
    }

    if (
      remaining.some(
        (job) => job.status === 'failed' && job.error?.code === 'dependency_failed' && job.requestSnapshot === null
      )
    ) {
      result.push({
        dependentShotId: location.shotId,
        upstreamShotId,
        eligiblePrimaryAssetIds: [],
        canRetryConditioningFrame: false,
        canCancelWaiting: false,
        waitingReason: 'dependency_failed',
      });
      continue;
    }

    if (
      remaining.some(
        (job) => job.status !== 'waiting_for_conditioning' || job.requestSnapshot !== null || job.error !== null
      )
    ) {
      continue;
    }

    if (dependency.kind === 'existing_predecessor') {
      const upstreamShot = ownValue(project.shots, dependency.predecessorShotId);
      const selectedAsset = ownValue(project.assets, dependency.takeAssetId);
      const exactSelectedTake =
        upstreamShot?.selectedTakeId === dependency.takeAssetId &&
        selectedAsset?.mediaKind === 'video' &&
        typeof selectedAsset.durationSeconds === 'number' &&
        Object.is(selectedAsset.durationSeconds - (upstreamShot.trimOutSeconds ?? 0), dependency.endpointSeconds);
      let extractionId: string | null = null;
      try {
        extractionId = createStudioFrameExtractionId({
          shotId: dependency.predecessorShotId,
          takeAssetId: dependency.takeAssetId,
          endpointSeconds: dependency.endpointSeconds,
        });
      } catch {
        extractionId = null;
      }
      const extraction = extractionId === null ? undefined : ownValue(project.frameExtractions, extractionId);
      const exactExtraction =
        extraction?.shotId === dependency.predecessorShotId &&
        extraction.takeAssetId === dependency.takeAssetId &&
        Object.is(extraction.endpointSeconds, dependency.endpointSeconds)
          ? extraction
          : undefined;
      const failed = exactExtraction?.status === 'failed' || exactExtraction?.status === 'ready';
      result.push({
        dependentShotId: location.shotId,
        upstreamShotId,
        eligiblePrimaryAssetIds: exactSelectedTake ? [dependency.takeAssetId] : [],
        canRetryConditioningFrame: failed,
        canCancelWaiting: canCancelWaitingJobs(siblings),
        waitingReason: failed ? 'conditioning_failed' : 'conditioning_frame',
      });
      continue;
    }

    const upstreamItem = authorizationItems(latest.authorization).find((item) => item.id === dependency.upstreamItemId);
    if (upstreamItem === undefined) continue;
    const eligiblePrimaryAssetIds = primaryAssetIdsForItem(project, latest.authorization.id, upstreamItem);
    const canCancelWaiting = canCancelWaitingJobs(siblings);
    if (eligiblePrimaryAssetIds.length === 0) {
      result.push({
        dependentShotId: location.shotId,
        upstreamShotId,
        eligiblePrimaryAssetIds,
        canRetryConditioningFrame: false,
        canCancelWaiting,
        waitingReason: 'upstream_running',
      });
      continue;
    }

    const upstreamShot = ownValue(project.shots, upstreamShotId);
    const selectedAssetId =
      dependency.kind === 'authorized_seed' ? upstreamShot?.seedStillId : upstreamShot?.selectedTakeId;
    if (
      selectedAssetId === undefined ||
      selectedAssetId === null ||
      !eligiblePrimaryAssetIds.includes(selectedAssetId)
    ) {
      result.push({
        dependentShotId: location.shotId,
        upstreamShotId,
        eligiblePrimaryAssetIds,
        canRetryConditioningFrame: false,
        canCancelWaiting,
        waitingReason: dependency.kind === 'authorized_seed' ? 'choose_seed' : 'choose_take',
      });
      continue;
    }

    if (dependency.kind === 'authorized_seed' || upstreamShot === undefined) continue;
    const selectedAsset = ownValue(project.assets, selectedAssetId);
    const endpointSeconds =
      selectedAsset?.mediaKind === 'video' && typeof selectedAsset.durationSeconds === 'number'
        ? selectedAsset.durationSeconds - (upstreamShot.trimOutSeconds ?? 0)
        : Number.NaN;
    if (!Number.isFinite(endpointSeconds) || endpointSeconds <= 0) {
      continue;
    }
    let extractionId: string;
    try {
      extractionId = createStudioFrameExtractionId({
        shotId: upstreamShot.id,
        takeAssetId: selectedAssetId,
        endpointSeconds,
      });
    } catch {
      continue;
    }
    const extraction = ownValue(project.frameExtractions, extractionId);
    const exactExtraction =
      extraction?.id === extractionId &&
      extraction.shotId === upstreamShot.id &&
      extraction.takeAssetId === selectedAssetId &&
      Object.is(extraction.endpointSeconds, endpointSeconds)
        ? extraction
        : undefined;
    const failed = exactExtraction?.status === 'failed' || exactExtraction?.status === 'ready';
    result.push({
      dependentShotId: location.shotId,
      upstreamShotId,
      eligiblePrimaryAssetIds,
      canRetryConditioningFrame: failed,
      canCancelWaiting,
      waitingReason: failed ? 'conditioning_failed' : 'conditioning_frame',
    });
  }
  return result;
};

const hasCurrentNonterminalDependencyOwner = (
  project: StudioProjectV2,
  dependentShotId: string,
  predecessorShotId: string,
  takeAssetId: string,
  endpointSeconds: number
): boolean =>
  Object.values(project.jobs).some((job) => {
    if (job.shotId !== dependentShotId || job.purpose !== 'video_take' || !NONTERMINAL_JOB_STATUSES.has(job.status)) {
      return false;
    }
    if (job.requestPlan.kind === 'after_take_selection') {
      const dependency = job.requestPlan.dependency;
      if (dependency.kind === 'authorized_predecessor' && dependency.predecessorShotId === predecessorShotId) {
        return true;
      }
      if (
        dependency.kind === 'existing_predecessor' &&
        dependency.predecessorShotId === predecessorShotId &&
        dependency.takeAssetId === takeAssetId &&
        Object.is(dependency.endpointSeconds, endpointSeconds)
      ) {
        return true;
      }
    }
    const input = job.requestSnapshot?.conditioningInput;
    return (
      input?.kind === 'predecessor_frame' &&
      input.predecessorShotId === predecessorShotId &&
      input.takeAssetId === takeAssetId &&
      Object.is(input.endpointSeconds, endpointSeconds)
    );
  });

const projectConditioningFailures = (
  project: StudioProjectV2,
  locations: readonly ActiveShotLocation[]
): StudioRendererChainStatusV2['conditioningFailures'] => {
  const result: StudioRendererChainStatusV2['conditioningFailures'] = [];
  for (const location of locations) {
    if (location.shotIndex === 0) continue;
    const shot = ownValue(project.shots, location.shotId);
    const beat = ownValue(project.beats, location.beatId);
    if (shot === undefined || beat === undefined || shot.chainBreak === 'hard_cut') continue;
    const predecessorShotId = beat.shotOrder[location.shotIndex - 1];
    const predecessor = predecessorShotId === undefined ? undefined : ownValue(project.shots, predecessorShotId);
    if (predecessor?.selectedTakeId === null || predecessor === undefined) continue;
    const take = ownValue(project.assets, predecessor.selectedTakeId);
    if (
      !isCanonicalTake(project, predecessor, take) ||
      take.mediaKind !== 'video' ||
      take.managedAsset.collection !== 'assets' ||
      isBinnedTake(project, take.id) ||
      typeof take.durationSeconds !== 'number'
    ) {
      continue;
    }
    const endpointSeconds = take.durationSeconds - (predecessor.trimOutSeconds ?? 0);
    if (!Number.isFinite(endpointSeconds) || endpointSeconds <= 0) continue;
    let extractionId: string;
    try {
      extractionId = createStudioFrameExtractionId({
        shotId: predecessor.id,
        takeAssetId: take.id,
        endpointSeconds,
      });
    } catch {
      continue;
    }
    const extraction = ownValue(project.frameExtractions, extractionId);
    if (
      extraction?.id !== extractionId ||
      extraction.status !== 'failed' ||
      extraction.shotId !== predecessor.id ||
      extraction.takeAssetId !== take.id ||
      !Object.is(extraction.endpointSeconds, endpointSeconds)
    ) {
      continue;
    }
    if (hasCurrentNonterminalDependencyOwner(project, shot.id, predecessor.id, take.id, endpointSeconds)) {
      continue;
    }
    result.push({ dependentShotId: shot.id, reason: 'conditioning_failed', canRetry: true });
  }
  return result;
};

type StudioChainBoundaryFactV2 =
  | {
      upstreamShotId: string;
      dependentShotId: string;
      status: 'empty' | 'gone';
    }
  | {
      upstreamShotId: string;
      dependentShotId: string;
      status: 'ready';
      extractionId: string;
      takeAssetId: string;
      endpointSeconds: number;
      frameAssetId: string;
    };

const projectStudioChainBoundaryFactsV2 = (project: StudioProjectV2): StudioChainBoundaryFactV2[] => {
  const beatCounts = new Map<string, number>();
  const shotCounts = new Map<string, number>();
  for (const beatId of project.beatOrder) {
    beatCounts.set(beatId, (beatCounts.get(beatId) ?? 0) + 1);
    const beat = ownValue(project.beats, beatId);
    if (beat?.id !== beatId) continue;
    for (const shotId of beat.shotOrder) shotCounts.set(shotId, (shotCounts.get(shotId) ?? 0) + 1);
  }

  const result: StudioChainBoundaryFactV2[] = [];
  for (const beatId of project.beatOrder) {
    const beat = ownValue(project.beats, beatId);
    if (beat?.id !== beatId || beatCounts.get(beatId) !== 1) continue;
    for (let shotIndex = 1; shotIndex < beat.shotOrder.length; shotIndex += 1) {
      const upstreamShotId = beat.shotOrder[shotIndex - 1]!;
      const dependentShotId = beat.shotOrder[shotIndex]!;
      const upstream = ownValue(project.shots, upstreamShotId);
      const dependent = ownValue(project.shots, dependentShotId);
      if (
        upstream?.id !== upstreamShotId ||
        dependent?.id !== dependentShotId ||
        shotCounts.get(upstreamShotId) !== 1 ||
        shotCounts.get(dependentShotId) !== 1 ||
        dependent.chainBreak === 'hard_cut'
      ) {
        continue;
      }
      const empty = (): void => {
        result.push({ upstreamShotId, dependentShotId, status: 'empty' });
      };
      const gone = (): void => {
        result.push({ upstreamShotId, dependentShotId, status: 'gone' });
      };
      if (upstream.selectedTakeId === null) {
        empty();
        continue;
      }
      const take = ownValue(project.assets, upstream.selectedTakeId);
      if (
        !isCanonicalTake(project, upstream, take) ||
        take.mediaKind !== 'video' ||
        take.managedAsset.collection !== 'assets' ||
        isBinnedTake(project, take.id) ||
        typeof take.durationSeconds !== 'number'
      ) {
        empty();
        continue;
      }
      const endpointSeconds = take.durationSeconds - (upstream.trimOutSeconds ?? 0);
      if (!Number.isFinite(endpointSeconds) || endpointSeconds <= 0) {
        empty();
        continue;
      }
      let extractionId: string;
      try {
        extractionId = createStudioFrameExtractionId({
          shotId: upstream.id,
          takeAssetId: take.id,
          endpointSeconds,
        });
      } catch {
        empty();
        continue;
      }
      const extraction = ownValue(project.frameExtractions, extractionId);
      if (extraction === undefined) {
        empty();
        continue;
      }
      if (
        extraction.id !== extractionId ||
        extraction.shotId !== upstream.id ||
        extraction.takeAssetId !== take.id ||
        !Object.is(extraction.endpointSeconds, endpointSeconds)
      ) {
        gone();
        continue;
      }
      if (extraction.status === 'pending' || extraction.status === 'extracting') {
        empty();
        continue;
      }
      if (extraction.status !== 'ready' || extraction.frameAssetId === null) {
        gone();
        continue;
      }
      result.push({
        upstreamShotId,
        dependentShotId,
        status: 'ready',
        extractionId,
        takeAssetId: take.id,
        endpointSeconds,
        frameAssetId: extraction.frameAssetId,
      });
    }
  }
  return result;
};

/** Returns only deterministic ready-extraction identities that main must verify before projection. */
export const projectStudioChainBoundaryVerificationIdsV2 = (project: StudioProjectV2): string[] => [
  ...new Set(
    projectStudioChainBoundaryFactsV2(project).flatMap((boundary) =>
      boundary.status === 'ready' ? [boundary.extractionId] : []
    )
  ),
];

const verifiedBoundary = (
  project: StudioProjectV2,
  boundary: Extract<StudioChainBoundaryFactV2, { status: 'ready' }>,
  verification: StudioVerifiedConditioningFrameV2 | undefined
): StudioRendererChainBoundaryV2 => {
  const frameAsset = ownValue(project.assets, boundary.frameAssetId);
  const frameIsCanonical =
    frameAsset?.id === boundary.frameAssetId &&
    frameAsset.projectId === project.id &&
    frameAsset.shotId === boundary.upstreamShotId &&
    frameAsset.mediaKind === 'image' &&
    frameAsset.managedAsset.collection === 'conditioningFrames' &&
    ownValue(project.shots, boundary.upstreamShotId)?.assetIds.includes(frameAsset.id) === true;
  if (
    !frameIsCanonical ||
    verification?.extractionId !== boundary.extractionId ||
    verification.shotId !== boundary.upstreamShotId ||
    verification.takeAssetId !== boundary.takeAssetId ||
    !Object.is(verification.endpointSeconds, boundary.endpointSeconds) ||
    verification.frameAssetId !== boundary.frameAssetId ||
    verification.byteSize !== frameAsset.byteSize ||
    verification.sha256 !== frameAsset.sha256
  ) {
    return {
      upstreamShotId: boundary.upstreamShotId,
      dependentShotId: boundary.dependentShotId,
      status: 'gone',
      frameAssetId: null,
    };
  }
  return {
    upstreamShotId: boundary.upstreamShotId,
    dependentShotId: boundary.dependentShotId,
    status: 'on_disk',
    frameAssetId: boundary.frameAssetId,
  };
};

const dedupeAndSortBlockers = (
  blockers: readonly StudioRendererParkBlockerV2[],
  shotOrder: readonly string[]
): StudioRendererParkBlockerV2[] => {
  const shotPositions = new Map(shotOrder.map((shotId, index) => [shotId, index]));
  const seen = new Set<string>();
  return blockers
    .filter((blocker) => {
      const identity = `${blocker.shotId ?? ''}\0${blocker.code}`;
      if (seen.has(identity)) return false;
      seen.add(identity);
      return true;
    })
    .sort((left, right) => {
      const byShot =
        (left.shotId === null ? Number.MAX_SAFE_INTEGER : (shotPositions.get(left.shotId) ?? Number.MAX_SAFE_INTEGER)) -
        (right.shotId === null
          ? Number.MAX_SAFE_INTEGER
          : (shotPositions.get(right.shotId) ?? Number.MAX_SAFE_INTEGER));
      return byShot !== 0 ? byShot : BLOCKER_CODE_ORDER.indexOf(left.code) - BLOCKER_CODE_ORDER.indexOf(right.code);
    });
};

const inboundBlockers = (project: StudioProjectV2, shotIds: readonly string[]): StudioRendererParkBlockerV2[] =>
  dedupeAndSortBlockers(
    deriveStudioInboundShotReferencesV2(project, shotIds).map((reference) => ({
      shotId: reference.shotId,
      code: reference.kind,
    })),
    shotIds
  );

const takeHasNonterminalConditioningUse = (project: StudioProjectV2, assetId: string): boolean =>
  Object.values(project.jobs).some((job) => {
    if (!NONTERMINAL_JOB_STATUSES.has(job.status)) return false;
    const input = job.requestSnapshot?.conditioningInput;
    return (
      (job.requestPlan.kind === 'after_take_selection' &&
        job.requestPlan.dependency.kind === 'existing_predecessor' &&
        job.requestPlan.dependency.takeAssetId === assetId) ||
      (input?.kind === 'seed_still' && input.assetId === assetId) ||
      (input?.kind === 'predecessor_frame' && input.takeAssetId === assetId)
    );
  });

const takeIsLastSelectableForWaitingDependency = (project: StudioProjectV2, assetId: string): boolean => {
  const producer = Object.values(project.jobs).find(
    (job) => job.status === 'succeeded' && job.outputAssetIdsByRole.primary === assetId
  );
  if (producer === undefined) return false;
  const hasWaitingDependent = Object.values(project.jobs).some(
    (job) =>
      NONTERMINAL_JOB_STATUSES.has(job.status) &&
      job.requestPlan.kind === 'after_take_selection' &&
      ((job.requestPlan.dependency.kind === 'existing_predecessor' &&
        job.requestPlan.dependency.takeAssetId === assetId) ||
        (job.requestPlan.dependency.kind !== 'existing_predecessor' &&
          job.requestPlan.dependency.upstreamItemId === producer.authorizationItemId))
  );
  if (!hasWaitingDependent) return false;
  const primaryIds = new Set<string>();
  for (const sibling of Object.values(project.jobs)) {
    if (sibling.authorizationItemId !== producer.authorizationItemId || sibling.status !== 'succeeded') continue;
    const primaryId = sibling.outputAssetIdsByRole.primary;
    if (primaryId === null || isBinnedTake(project, primaryId)) continue;
    const shot = ownValue(project.shots, producer.shotId);
    if (shot !== undefined && isCanonicalTake(project, shot, ownValue(project.assets, primaryId))) {
      primaryIds.add(primaryId);
    }
  }
  return primaryIds.size === 1 && primaryIds.has(assetId);
};

const takeBlockers = (project: StudioProjectV2, shot: StudioShot, assetId: string) => {
  const blockers: StudioRendererParkBlockerV2[] = [];
  if (shot.selectedTakeId === assetId) blockers.push({ shotId: shot.id, code: 'current_selected_take' });
  if (shot.seedStillId === assetId) blockers.push({ shotId: shot.id, code: 'current_seed_still' });
  if (takeHasNonterminalConditioningUse(project, assetId)) {
    blockers.push({ shotId: shot.id, code: 'nonterminal_conditioning_use' });
  }
  if (takeIsLastSelectableForWaitingDependency(project, assetId)) {
    blockers.push({ shotId: shot.id, code: 'waiting_authorization_dependency' });
  }
  if (project.bin.filter((item) => item.kind === 'take').length >= STUDIO_MAX_BIN_TAKE_ITEMS) {
    blockers.push({ shotId: shot.id, code: 'take_bin_capacity_reached' });
  }
  return dedupeAndSortBlockers(blockers, [shot.id]);
};

const eligibilityRow = (
  identity: Omit<StudioRendererParkEligibilityV2, 'allowed' | 'blockers'>,
  blockers: StudioRendererParkBlockerV2[]
): StudioRendererParkEligibilityV2 => ({ ...identity, allowed: blockers.length === 0, blockers });

const projectParkEligibility = (project: StudioProjectV2): StudioRendererParkEligibilityV2[] => {
  const result: StudioRendererParkEligibilityV2[] = [];
  for (const beatId of project.beatOrder) {
    const beat = ownValue(project.beats, beatId);
    if (beat === undefined) continue;
    result.push(
      eligibilityRow(
        { subject: 'beat', action: 'park', beatId, shotId: null, assetId: null },
        inboundBlockers(project, beat.shotOrder)
      )
    );
    for (const shotId of beat.shotOrder) {
      const shot = ownValue(project.shots, shotId);
      if (shot === undefined) continue;
      result.push(
        eligibilityRow(
          { subject: 'shot', action: 'park', beatId, shotId, assetId: null },
          inboundBlockers(project, [shotId])
        )
      );
      for (const assetId of shot.assetIds) {
        const asset = ownValue(project.assets, assetId);
        if (!isCanonicalTake(project, shot, asset) || isBinnedTake(project, assetId)) continue;
        result.push(
          eligibilityRow(
            { subject: 'take', action: 'park', beatId, shotId, assetId },
            takeBlockers(project, shot, assetId)
          )
        );
      }
    }
  }

  const owners = shotOwners(project);
  for (const item of project.bin) {
    if (item.kind === 'beat') {
      result.push(
        eligibilityRow({ subject: 'beat', action: 'restore', beatId: item.beatId, shotId: null, assetId: null }, [])
      );
      continue;
    }
    if (item.kind === 'shot') {
      const beat = ownValue(project.beats, item.beatId);
      const blockers: StudioRendererParkBlockerV2[] =
        beat !== undefined && beat.shotOrder.length >= STUDIO_MAX_SHOTS_PER_BEAT
          ? [{ shotId: null, code: 'beat_shot_capacity_reached' as const }]
          : [];
      result.push(
        eligibilityRow(
          { subject: 'shot', action: 'restore', beatId: item.beatId, shotId: item.shotId, assetId: null },
          blockers
        )
      );
      continue;
    }
    const asset = ownValue(project.assets, item.assetId);
    const shot = asset?.shotId === null || asset === undefined ? undefined : ownValue(project.shots, asset.shotId);
    const beatId = shot === undefined ? undefined : owners.get(shot.id);
    if (shot === undefined || beatId === undefined || !isCanonicalTake(project, shot, asset)) continue;
    result.push(eligibilityRow({ subject: 'take', action: 'restore', beatId, shotId: shot.id, assetId: asset.id }, []));
  }
  return result;
};

/** Projects the complete renderer-safe workspace status without performing I/O or mutation. */
export const projectStudioWorkspaceStatusV2 = (project: StudioProjectV2): StudioRendererWorkspaceStatusV2 => {
  const locations = activeShotLocations(project);
  const undoTop = project.undoHistory.at(-1);
  return {
    projectId: project.id,
    projectRevision: project.revision,
    undoTop:
      undoTop === undefined
        ? null
        : { entryId: undoTop.id, label: undoTop.label, sourceRevision: undoTop.sourceRevision },
    dirtyShots: deriveStudioDirtyShotsV2(project),
    cascadeProgress: projectCascadeProgress(project, locations),
    currentVideoJobs: projectCurrentVideoJobs(project, locations),
    parkEligibility: projectParkEligibility(project),
  };
};

/** Projects post-cancellation failures and renderer-safe boundaries without exposing extraction authority. */
export const projectStudioChainStatusV2 = (
  project: StudioProjectV2,
  verifiedReadyExtractions: ReadonlyMap<string, StudioVerifiedConditioningFrameV2> = new Map()
): StudioRendererChainStatusV2 => {
  const locations = activeShotLocations(project);
  return {
    projectId: project.id,
    projectRevision: project.revision,
    conditioningFailures: projectConditioningFailures(project, locations),
    boundaries: projectStudioChainBoundaryFactsV2(project).map((boundary): StudioRendererChainBoundaryV2 => {
      if (boundary.status === 'ready') {
        return verifiedBoundary(project, boundary, verifiedReadyExtractions.get(boundary.extractionId));
      }
      return {
        upstreamShotId: boundary.upstreamShotId,
        dependentShotId: boundary.dependentShotId,
        status: boundary.status,
        frameAssetId: null,
      };
    }),
  };
};
