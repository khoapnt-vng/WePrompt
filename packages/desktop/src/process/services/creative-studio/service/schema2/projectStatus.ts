/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { deriveStudioEditorFolderPreviewV2 } from '@/common/types/project/creativeStudioCanonicalTake';
import {
  STUDIO_FILM_EXPORT_FRAME_RATE,
  STUDIO_PROJECT_STATUS_STAGE_ORDER_V2,
  type StudioAssetV2,
  type StudioJobErrorV2,
  type StudioJobV2,
  type StudioMediaKind,
  type StudioMediaRouteCatalog,
  type StudioPrepareGenerationChoiceV2,
  type StudioProjectStatusAdvisoryV2,
  type StudioProjectStatusBlockerCauseV2,
  type StudioProjectStatusBlockerV2,
  type StudioProjectStatusRemedyV2,
  type StudioProjectStatusRouteCatalogV2,
  type StudioProjectStatusReferenceDetailV2,
  type StudioProjectStatusShotDetailV2,
  type StudioProjectStatusStageIdV2,
  type StudioProjectStatusStageStateV2,
  type StudioProjectStatusStageV2,
  type StudioProjectStatusV2,
  type StudioProjectV2,
  type StudioReferenceBindingFailureReasonV2,
  type StudioShot,
} from '@/common/types/project/creativeStudioTypes';
import { deriveStudioDirtyShotsV2 } from './chain';
import { createStudioFrameExtractionId } from './generation';
import { resolveStudioCanonicalBoardAssetV2 } from './generation/boardPanel';
import { resolveStudioReferenceBindingV2 } from './generation/referenceBinding';
import { projectStudioWorkspaceStatusV2 } from './workspaceStatus';

type ActiveShotLocation = {
  beatId: string;
  shotId: string;
  beatPosition: number;
  shotPosition: number;
  shotIndex: number;
};

const HEALTHY_JOB_STATUSES: ReadonlySet<StudioJobV2['status']> = new Set([
  'waiting_for_conditioning',
  'queued_local',
  'submitting',
  'queued_remote',
  'running',
]);

const SUBMISSION_REFUSED_CODES: ReadonlySet<StudioJobErrorV2['code']> = new Set([
  'provider_unavailable',
  'rate_limited',
  'quota',
  'invalid_request',
  'auth',
]);

const TARGET_TOLERANCE_SECONDS = 1 / STUDIO_FILM_EXPORT_FRAME_RATE;

const ownValue = <Value>(record: Readonly<Record<string, Value>>, id: string): Value | undefined =>
  Object.hasOwn(record, id) ? record[id] : undefined;

const activeShotLocations = (project: StudioProjectV2): ActiveShotLocation[] => {
  const result: ActiveShotLocation[] = [];
  for (let beatIndex = 0; beatIndex < project.beatOrder.length; beatIndex += 1) {
    const beatId = project.beatOrder[beatIndex]!;
    const beat = ownValue(project.beats, beatId);
    if (beat?.id !== beatId) continue;
    for (let shotIndex = 0; shotIndex < beat.shotOrder.length; shotIndex += 1) {
      const shotId = beat.shotOrder[shotIndex]!;
      if (ownValue(project.shots, shotId)?.id !== shotId) continue;
      result.push({
        beatId,
        shotId,
        beatPosition: beatIndex + 1,
        shotPosition: shotIndex + 1,
        shotIndex,
      });
    }
  }
  return result;
};

const shotWhere = (location: ActiveShotLocation, jobId: string | null): StudioProjectStatusBlockerV2['where'] => ({
  kind: 'shot',
  beatId: location.beatId,
  shotId: location.shotId,
  beatPosition: location.beatPosition,
  shotPosition: location.shotPosition,
  jobId,
});

const proposal = (
  prepare: Extract<StudioProjectStatusRemedyV2, { kind: 'proposal' }>['prepare']
): Extract<StudioProjectStatusRemedyV2, { kind: 'proposal' }> => ({
  kind: 'proposal',
  prepare,
  estimatedMinorUnits: null,
  currency: null,
});

const generationIntent = (
  shotId: string,
  purpose: StudioPrepareGenerationChoiceV2['purpose'],
  continuityChange: Extract<
    Extract<StudioProjectStatusRemedyV2, { kind: 'proposal' }>['prepare'],
    { kind: 'generation' }
  >['continuityChange'] = null
): Extract<StudioProjectStatusRemedyV2, { kind: 'proposal' }> =>
  proposal({
    kind: 'generation',
    baseChoices: continuityChange === null ? [{ target: { kind: 'shot', shotId }, purpose }] : [],
    cascadeChoices: [],
    continuityChange,
  });

const stage = <Stage extends StudioProjectStatusStageIdV2>(
  id: Stage,
  state: StudioProjectStatusStageStateV2,
  summary: Extract<StudioProjectStatusStageV2, { id: Stage }>['summary'],
  blockers: StudioProjectStatusBlockerV2[] = []
): Extract<StudioProjectStatusStageV2, { id: Stage }> =>
  ({ id, state, summary, blockers }) as Extract<StudioProjectStatusStageV2, { id: Stage }>;

const targetMatches = (actualSeconds: number, targetSeconds: number): boolean => {
  const roundingEpsilon = Number.EPSILON * Math.max(1, Math.abs(actualSeconds), Math.abs(targetSeconds)) * 4;
  return Math.abs(actualSeconds - targetSeconds) <= TARGET_TOLERANCE_SECONDS + roundingEpsilon;
};

const routeState = (catalog: StudioMediaRouteCatalog): StudioModelState => ({
  status: catalog.status,
  ready: catalog.status === 'ready' && catalog.selected !== null && catalog.selectedRoute !== null,
});

type StudioModelState = { status: StudioMediaRouteCatalog['status']; ready: boolean };

const routeSelectionBlocker = (
  kind: StudioMediaKind,
  catalog: StudioMediaRouteCatalog
): StudioProjectStatusBlockerV2 | null => {
  if (catalog.status === 'ready' && catalog.selected !== null && catalog.selectedRoute !== null) return null;
  if (catalog.status === 'selection_required' && catalog.selectionIssue === null) return null;
  const issue = catalog.selectionIssue;
  if (catalog.status === 'setup_required' || issue?.code === 'needs_setup') {
    return {
      cause: 'route_setup_required',
      where: { kind: 'route', routeKind: kind },
      remedy: { kind: 'owner_only', reason: 'configure_engine' },
    };
  }
  if (issue?.code === 'health') {
    return {
      cause: 'route_unavailable',
      where: { kind: 'route', routeKind: kind },
      remedy: { kind: 'owner_only', reason: 'repair_engine_health' },
    };
  }
  if (issue?.code === 'frame') {
    return {
      cause: 'route_incompatible_frame',
      where: { kind: 'route', routeKind: kind },
      remedy: { kind: 'owner_only', reason: 'choose_compatible_engine' },
    };
  }
  if (issue?.code === 'retired') {
    return {
      cause: 'route_retired',
      where: { kind: 'route', routeKind: kind },
      remedy: { kind: 'owner_only', reason: 'select_engine' },
    };
  }
  return {
    cause: catalog.status === 'selection_required' ? 'route_not_selected' : 'route_unavailable',
    where: { kind: 'route', routeKind: kind },
    remedy: {
      kind: 'owner_only',
      reason: catalog.status === 'selection_required' ? 'select_engine' : 'repair_engine_health',
    },
  };
};

const routeSupportsDuration = (
  route: NonNullable<StudioMediaRouteCatalog['selectedRoute']>,
  seconds: number
): boolean =>
  route.constraints.supportedDurationSeconds === undefined
    ? seconds >= route.constraints.minDurationSeconds && seconds <= route.constraints.maxDurationSeconds
    : route.constraints.supportedDurationSeconds.includes(seconds);

const deriveEnginesStage = (
  project: StudioProjectV2,
  routeInput: StudioProjectStatusRouteCatalogV2,
  locations: readonly ActiveShotLocation[]
): StudioProjectStatusStageV2 => {
  if (routeInput.status === 'inventory_unavailable') {
    return stage('engines', 'blocked', { stage: 'engines', image: 'unavailable', video: 'unavailable' }, [
      {
        cause: 'route_inventory_unavailable',
        where: { kind: 'project' },
        remedy: { kind: 'owner_only', reason: 'repair_engine_health' },
      },
    ]);
  }
  const { image, video } = routeInput.catalog;
  const blockers = [routeSelectionBlocker('image', image), routeSelectionBlocker('video', video)].filter(
    (candidate): candidate is StudioProjectStatusBlockerV2 => candidate !== null
  );
  if (project.imageRouteId === null && project.videoRouteId !== null && image.status === 'selection_required') {
    blockers.push({
      cause: 'route_not_selected',
      where: { kind: 'route', routeKind: 'image' },
      remedy: { kind: 'owner_only', reason: 'select_engine' },
    });
  }
  if (project.videoRouteId === null && project.imageRouteId !== null && video.status === 'selection_required') {
    blockers.push({
      cause: 'route_not_selected',
      where: { kind: 'route', routeKind: 'video' },
      remedy: { kind: 'owner_only', reason: 'select_engine' },
    });
  }
  if (project.imageRouteId === null && project.videoRouteId === null) {
    if (locations.length > 0 || project.referenceOrder.length > 0) {
      blockers.push({
        cause: 'route_not_selected',
        where: { kind: 'route', routeKind: 'image' },
        remedy: { kind: 'owner_only', reason: 'select_engine' },
      });
    }
    if (locations.length > 0) {
      blockers.push({
        cause: 'route_not_selected',
        where: { kind: 'route', routeKind: 'video' },
        remedy: { kind: 'owner_only', reason: 'select_engine' },
      });
    }
  }
  for (const [kind, catalog] of [
    ['image', image],
    ['video', video],
  ] as const) {
    const route = catalog.selectedRoute;
    if (catalog.status !== 'ready' || route === null) continue;
    if (
      !route.constraints.aspectRatios.includes(project.aspectRatio) ||
      !route.constraints.resolutions.includes(project.resolution)
    ) {
      blockers.push({
        cause: 'route_incompatible_frame',
        where: { kind: 'route', routeKind: kind },
        remedy: { kind: 'owner_only', reason: 'choose_compatible_engine' },
      });
    }
  }
  if (video.status === 'ready' && video.selectedRoute !== null) {
    if (locations.length > 0 && !video.selectedRoute.constraints.supportsFirstFrame) {
      blockers.push({
        cause: 'route_first_frame_unsupported',
        where: { kind: 'route', routeKind: 'video' },
        remedy: { kind: 'owner_only', reason: 'choose_compatible_engine' },
      });
    }
    for (const location of locations) {
      const shot = ownValue(project.shots, location.shotId);
      if (shot !== undefined && !routeSupportsDuration(video.selectedRoute, shot.durationSeconds)) {
        blockers.push({
          cause: 'route_duration_unsupported',
          where: shotWhere(location, null),
          remedy: { kind: 'owner_only', reason: 'choose_compatible_engine' },
        });
      }
    }
  }
  const imageState = routeState(image);
  const videoState = routeState(video);
  const state: StudioProjectStatusStageStateV2 =
    blockers.length > 0
      ? 'blocked'
      : imageState.ready && videoState.ready
        ? 'complete'
        : project.imageRouteId === null && project.videoRouteId === null
          ? 'not_started'
          : 'in_progress';
  return stage('engines', state, { stage: 'engines', image: image.status, video: video.status }, blockers);
};

const exactGeneratedReferenceProducer = (
  project: StudioProjectV2,
  referenceId: string,
  asset: StudioAssetV2
): StudioJobV2 | null => {
  const reference = ownValue(project.references, referenceId);
  if (reference === undefined) return null;
  const producers = Object.values(project.jobs).filter(
    (job) =>
      job.projectId === project.id &&
      job.target.kind === 'reference' &&
      job.target.referenceId === referenceId &&
      job.purpose === 'reference_image' &&
      job.status === 'succeeded' &&
      job.outputAssetIdsByRole.primary === asset.id &&
      job.outputAssetIds.filter((assetId) => assetId === asset.id).length === 1
  );
  return producers.length === 1 && reference.jobIds.includes(producers[0]!.id) ? producers[0]! : null;
};

const canonicalReferenceAsset = (
  project: StudioProjectV2,
  referenceId: string,
  assetId: string
): StudioAssetV2 | null => {
  const asset = ownValue(project.assets, assetId);
  if (
    asset?.id !== assetId ||
    asset.projectId !== project.id ||
    asset.shotId !== null ||
    asset.projectReferenceId !== referenceId ||
    asset.mediaKind !== 'image' ||
    (asset.managedAsset.collection !== 'assets' && asset.managedAsset.collection !== 'imports')
  ) {
    return null;
  }
  if (asset.managedAsset.collection === 'imports') {
    return asset.producerJobId === null &&
      asset.compositionDigest === null &&
      asset.generationReferenceAssetIds.length === 0
      ? asset
      : null;
  }
  const producer = exactGeneratedReferenceProducer(project, referenceId, asset);
  return producer !== null && asset.producerJobId === producer.id && asset.compositionDigest !== null ? asset : null;
};

const latestOwnedReferenceJob = (project: StudioProjectV2, referenceId: string): StudioJobV2 | null => {
  const reference = ownValue(project.references, referenceId);
  if (reference === undefined) return null;
  for (let index = reference.jobIds.length - 1; index >= 0; index -= 1) {
    const jobId = reference.jobIds[index]!;
    const job = ownValue(project.jobs, jobId);
    if (
      job?.id === jobId &&
      job.projectId === project.id &&
      job.target.kind === 'reference' &&
      job.target.referenceId === referenceId &&
      job.purpose === 'reference_image'
    ) {
      return job;
    }
  }
  return null;
};

const errorCause = (code: StudioJobErrorV2['code'] | null | undefined): StudioProjectStatusBlockerCauseV2 => {
  switch (code) {
    case 'invalid_request':
      return 'generation_invalid_request';
    case 'content_rejected':
      return 'generation_content_rejected';
    case 'auth':
      return 'generation_auth';
    case 'quota':
      return 'generation_quota';
    case 'rate_limited':
      return 'generation_rate_limited';
    case 'provider_unavailable':
      return 'generation_provider_unavailable';
    case 'timeout':
      return 'generation_timeout';
    case 'poll_deadline':
      return 'generation_poll_deadline';
    case 'no_output':
      return 'generation_no_output';
    case 'seed_still_variation_grid':
      return 'generation_variation_grid';
    case 'submission_unknown':
      return 'generation_submission_unknown';
    case 'download_failed':
      return 'generation_download_failed';
    case 'unsupported':
      return 'generation_unsupported';
    case 'dependency_failed':
      return 'dependency_failed';
    case 'unknown':
    case null:
    case undefined:
      return 'generation_unknown';
  }
};

const failedJobRemedy = (
  project: StudioProjectV2,
  job: StudioJobV2,
  fallback: StudioProjectStatusRemedyV2
): StudioProjectStatusRemedyV2 => {
  if (
    job.status === 'needs_attention' &&
    job.providerJobId === null &&
    job.spendReceipt === null &&
    job.error !== null &&
    SUBMISSION_REFUSED_CODES.has(job.error.code) &&
    !Object.values(project.jobs).some((candidate) => candidate.retryOfJobId === job.id)
  ) {
    return { kind: 'free_fix', op: 'terminalize_refused_job', jobId: job.id };
  }
  if (job.error?.code === 'submission_unknown') {
    return { kind: 'owner_only', reason: 'acknowledge_possible_duplicate_charge' };
  }
  if (job.error?.code === 'download_failed') {
    return { kind: 'owner_only', reason: 'retry_download' };
  }
  if (job.status === 'needs_attention') {
    return { kind: 'owner_only', reason: 'review_job_recovery' };
  }
  return fallback;
};

const referencePlanIsExact = (project: StudioProjectV2): boolean => {
  if (new Set(project.referenceOrder).size !== project.referenceOrder.length) return false;
  if (project.referenceOrder.length !== Object.keys(project.references).length) return false;
  let sawBackground = false;
  for (const referenceId of project.referenceOrder) {
    const reference = ownValue(project.references, referenceId);
    if (reference?.id !== referenceId) return false;
    if (reference.kind === 'background') sawBackground = true;
    else if (sawBackground) return false;
  }
  return true;
};

const deriveReferencesStage = (
  project: StudioProjectV2,
  paidPrepareAdmissible: boolean
): StudioProjectStatusStageV2 => {
  const plannedCount = project.referenceOrder.length;
  if (plannedCount === 0 && Object.keys(project.references).length === 0) {
    return stage('references', 'not_started', { stage: 'references', plannedCount: 0, approvedCount: 0 });
  }
  if (project.referencePlanStatus !== 'planned' || !referencePlanIsExact(project)) {
    return stage('references', 'blocked', { stage: 'references', plannedCount, approvedCount: 0 }, [
      {
        cause: 'reference_plan_invalid',
        where: { kind: 'project' },
        remedy: { kind: 'owner_only', reason: 'review_project_data' },
      },
    ]);
  }
  const blockers: StudioProjectStatusBlockerV2[] = [];
  let approvedCount = 0;
  const charactersApproved = project.referenceOrder
    .map((referenceId) => ownValue(project.references, referenceId))
    .filter((reference) => reference?.kind === 'character')
    .every(
      (reference) =>
        reference !== undefined &&
        reference.approvedAssetId !== null &&
        canonicalReferenceAsset(project, reference.id, reference.approvedAssetId) !== null
    );
  for (const referenceId of project.referenceOrder) {
    const reference = ownValue(project.references, referenceId)!;
    if (
      reference.approvedAssetId !== null &&
      canonicalReferenceAsset(project, reference.id, reference.approvedAssetId) !== null
    ) {
      approvedCount += 1;
      continue;
    }
    if (reference.approvedAssetId !== null) {
      blockers.push({
        cause: 'reference_plan_invalid',
        where: { kind: 'reference', referenceId, jobId: null },
        remedy: { kind: 'owner_only', reason: 'review_project_data' },
      });
      continue;
    }
    const latest = latestOwnedReferenceJob(project, referenceId);
    if (latest !== null && HEALTHY_JOB_STATUSES.has(latest.status)) {
      continue;
    }
    const candidateExists = Object.values(project.assets).some(
      (asset) => canonicalReferenceAsset(project, referenceId, asset.id) !== null
    );
    if (candidateExists || latest?.status === 'succeeded') {
      blockers.push({
        cause: 'reference_approval_required',
        where: { kind: 'reference', referenceId, jobId: latest?.id ?? null },
        remedy: { kind: 'owner_only', reason: 'approve_reference' },
      });
      continue;
    }
    const backgroundGenerationGated = reference.kind === 'background' && !charactersApproved;
    if (backgroundGenerationGated) continue;
    if (latest !== null && (latest.status === 'failed' || latest.status === 'needs_attention')) {
      blockers.push({
        cause: errorCause(latest.error?.code),
        where: { kind: 'reference', referenceId, jobId: latest.id },
        remedy: failedJobRemedy(
          project,
          latest,
          paidPrepareAdmissible
            ? proposal({ kind: 'project_references', referenceIds: [referenceId] })
            : { kind: 'owner_only', reason: 'review_project_data' }
        ),
      });
      continue;
    }
    if (!paidPrepareAdmissible) {
      continue;
    }
    blockers.push({
      cause: 'reference_generation_required',
      where: { kind: 'reference', referenceId, jobId: null },
      remedy: proposal({ kind: 'project_references', referenceIds: [referenceId] }),
    });
  }
  return stage(
    'references',
    approvedCount === plannedCount ? 'complete' : blockers.length > 0 ? 'blocked' : 'in_progress',
    { stage: 'references', plannedCount, approvedCount },
    blockers
  );
};

const deriveStoryboardStage = (
  project: StudioProjectV2,
  locations: readonly ActiveShotLocation[],
  advisories: StudioProjectStatusAdvisoryV2[]
): StudioProjectStatusStageV2 => {
  const blockers = locations.flatMap<StudioProjectStatusBlockerV2>((location) => {
    const shot = ownValue(project.shots, location.shotId);
    return shot?.shootingScript.trim().length === 0
      ? [
          {
            cause: 'shooting_script_required',
            where: shotWhere(location, null),
            remedy: { kind: 'owner_only', reason: 'review_project_data' },
          },
        ]
      : [];
  });
  let plannedSeconds = 0;
  let authoredShotCount = 0;
  let complete = project.beatOrder.length > 0;
  for (const beatId of project.beatOrder) {
    const beat = ownValue(project.beats, beatId);
    if (beat?.id !== beatId) {
      complete = false;
      continue;
    }
    if (beat.shotOrder.length === 0) {
      // A Beat target can make an intentional slate playable in Cut, but it is not authored
      // storyboard coverage. Storyboard time is the sum of active Shot durations only.
      complete = false;
      continue;
    }
    for (const shotId of beat.shotOrder) {
      const shot = ownValue(project.shots, shotId);
      if (shot?.id !== shotId) {
        complete = false;
        continue;
      }
      const hasScript = shot.shootingScript.trim().length > 0;
      const hasDuration = Number.isFinite(shot.durationSeconds) && shot.durationSeconds > 0;
      if (!hasScript || !hasDuration) complete = false;
      if (hasDuration) plannedSeconds += shot.durationSeconds;
      if (hasScript && hasDuration) authoredShotCount += 1;
    }
  }
  const matches = complete && targetMatches(plannedSeconds, project.targetDurationSeconds);
  if (complete && !matches) {
    advisories.push({
      cause: 'target_duration_mismatch',
      stage: 'storyboard',
      actualSeconds: plannedSeconds,
      targetSeconds: project.targetDurationSeconds,
    });
  }
  return stage(
    'storyboard',
    project.beatOrder.length === 0
      ? 'not_started'
      : blockers.length > 0
        ? 'blocked'
        : complete && matches
          ? 'complete'
          : 'in_progress',
    {
      stage: 'storyboard',
      beatCount: project.beatOrder.length,
      shotCount: locations.length,
      authoredShotCount,
      plannedSeconds,
      targetSeconds: project.targetDurationSeconds,
    },
    blockers
  );
};

const bindingCause = (reason: StudioReferenceBindingFailureReasonV2): StudioProjectStatusBlockerCauseV2 => {
  switch (reason) {
    case 'unassigned':
      return 'reference_binding_unassigned';
    case 'unknown_reference':
      return 'reference_binding_unknown_reference';
    case 'wrong_kind':
      return 'reference_binding_wrong_kind';
    case 'unapproved_reference':
      return 'reference_binding_unapproved_reference';
    case 'missing_asset':
      return 'reference_binding_missing_asset';
    case 'capacity_exceeded':
      return 'reference_binding_capacity_exceeded';
  }
};

const deriveBindingsStage = (
  project: StudioProjectV2,
  routeInput: StudioProjectStatusRouteCatalogV2,
  locations: readonly ActiveShotLocation[]
): StudioProjectStatusStageV2 => {
  const limit =
    routeInput.status === 'available' && routeInput.catalog.image.selectedRoute !== null
      ? routeInput.catalog.image.selectedRoute.constraints.maxConditioningImages
      : null;
  if (locations.length === 0) {
    return stage('bindings', 'not_started', {
      stage: 'bindings',
      readyShotCount: 0,
      shotCount: 0,
      maxConditioningImages: limit,
    });
  }
  if (limit === null) {
    return stage('bindings', 'in_progress', {
      stage: 'bindings',
      readyShotCount: 0,
      shotCount: locations.length,
      maxConditioningImages: null,
    });
  }
  const blockers: StudioProjectStatusBlockerV2[] = [];
  let readyShotCount = 0;
  for (const location of locations) {
    const resolution = resolveStudioReferenceBindingV2({
      project,
      shotId: location.shotId,
      maxConditioningImages: limit,
    });
    if (resolution.ok === true) {
      readyShotCount += 1;
      continue;
    }
    blockers.push({
      cause: bindingCause(resolution.reason),
      where: shotWhere(location, null),
      remedy:
        resolution.reason === 'unapproved_reference' || resolution.reason === 'missing_asset'
          ? { kind: 'owner_only', reason: 'review_project_data' }
          : { kind: 'free_fix', op: 'set_shot_reference_binding', shotId: location.shotId },
    });
  }
  return stage(
    'bindings',
    readyShotCount === locations.length ? 'complete' : blockers.length > 0 ? 'blocked' : 'in_progress',
    { stage: 'bindings', readyShotCount, shotCount: locations.length, maxConditioningImages: limit },
    blockers
  );
};

const exactTakeProducer = (project: StudioProjectV2, shot: StudioShot, asset: StudioAssetV2): StudioJobV2 | null => {
  const producers = shot.jobIds.flatMap((jobId) => {
    const job = ownValue(project.jobs, jobId);
    return job?.id === jobId &&
      job.projectId === project.id &&
      job.target.kind === 'shot' &&
      job.target.shotId === shot.id &&
      job.purpose === 'video_take' &&
      job.status === 'succeeded' &&
      job.outputAssetIdsByRole.primary === asset.id &&
      job.outputAssetIds.filter((assetId) => assetId === asset.id).length === 1
      ? [job]
      : [];
  });
  return producers.length === 1 ? producers[0]! : null;
};

const canonicalCurrentTake = (project: StudioProjectV2, shot: StudioShot): StudioAssetV2 | null => {
  if (shot.videoAssetId === null) return null;
  const asset = ownValue(project.assets, shot.videoAssetId);
  if (
    asset?.id !== shot.videoAssetId ||
    asset.projectId !== project.id ||
    asset.shotId !== shot.id ||
    asset.mediaKind !== 'video' ||
    asset.managedAsset.collection !== 'assets' ||
    !shot.assetIds.includes(asset.id) ||
    typeof asset.durationSeconds !== 'number' ||
    !Number.isFinite(asset.durationSeconds) ||
    asset.durationSeconds <= 0
  ) {
    return null;
  }
  const producer = exactTakeProducer(project, shot, asset);
  return producer !== null && asset.producerJobId === producer.id && asset.compositionDigest !== null ? asset : null;
};

const currentVideoJobsByShot = (
  project: StudioProjectV2,
  workspace: ReturnType<typeof projectStudioWorkspaceStatusV2>
): Map<string, StudioJobV2[]> => {
  return new Map(
    workspace.currentVideoJobs.map(({ shotId, jobIds }) => [
      shotId,
      jobIds.flatMap((jobId) => {
        const job = ownValue(project.jobs, jobId);
        return job?.id === jobId ? [job] : [];
      }),
    ])
  );
};

const currentSeedJobsByShot = (
  project: StudioProjectV2,
  locations: readonly ActiveShotLocation[]
): Map<string, StudioJobV2[]> => {
  const activeShotIds = new Set(locations.map((location) => location.shotId));
  const latestItemByShot = new Map<string, { authorizationId: string; itemId: string }>();
  for (const authorization of project.spendAuthorizations) {
    for (const item of [...authorization.baseItems, ...authorization.cascadeItems]) {
      if (item.target.kind === 'shot' && item.purpose === 'seed_still' && activeShotIds.has(item.target.shotId)) {
        latestItemByShot.set(item.target.shotId, { authorizationId: authorization.id, itemId: item.id });
      }
    }
  }
  return new Map(
    locations.map((location) => {
      const latest = latestItemByShot.get(location.shotId);
      return [
        location.shotId,
        latest === undefined
          ? []
          : Object.values(project.jobs).filter(
              (job) =>
                job.projectId === project.id &&
                job.authorizationId === latest.authorizationId &&
                job.authorizationItemId === latest.itemId &&
                job.target.kind === 'shot' &&
                job.target.shotId === location.shotId &&
                job.purpose === 'seed_still'
            ),
      ];
    })
  );
};

const latestJob = (jobs: readonly StudioJobV2[]): StudioJobV2 | null =>
  jobs
    .toSorted((left, right) => {
      const byCreatedAt = left.createdAt.localeCompare(right.createdAt);
      return byCreatedAt === 0 ? left.id.localeCompare(right.id) : byCreatedAt;
    })
    .at(-1) ?? null;

const conditioningRecord = (
  project: StudioProjectV2,
  location: ActiveShotLocation
): StudioProjectStatusShotDetailV2['conditioning'] => {
  if (location.shotIndex === 0) return null;
  const beat = ownValue(project.beats, location.beatId);
  const shot = ownValue(project.shots, location.shotId);
  if (beat === undefined || shot === undefined || shot.chainBreak === 'hard_cut') return null;
  const upstreamShotId = beat.shotOrder[location.shotIndex - 1]!;
  const upstream = ownValue(project.shots, upstreamShotId);
  if (upstream === undefined) {
    return {
      upstreamShotId,
      recordStatus: 'missing',
      mediaVerified: false,
      extractionId: null,
      errorCode: null,
      attemptCount: null,
    };
  }
  const take = canonicalCurrentTake(project, upstream);
  const endpointSeconds =
    take?.durationSeconds === undefined ? Number.NaN : take.durationSeconds - (upstream.trimOutSeconds ?? 0);
  if (take === null || !Number.isFinite(endpointSeconds) || endpointSeconds <= 0) {
    return {
      upstreamShotId,
      recordStatus: 'missing',
      mediaVerified: false,
      extractionId: null,
      errorCode: null,
      attemptCount: null,
    };
  }
  let extractionId: string;
  try {
    extractionId = createStudioFrameExtractionId({ shotId: upstream.id, videoAssetId: take.id, endpointSeconds });
  } catch {
    return {
      upstreamShotId,
      recordStatus: 'missing',
      mediaVerified: false,
      extractionId: null,
      errorCode: null,
      attemptCount: null,
    };
  }
  const extraction = ownValue(project.frameExtractions, extractionId);
  const exact =
    extraction?.id === extractionId &&
    extraction.shotId === upstream.id &&
    extraction.videoAssetId === take.id &&
    Object.is(extraction.endpointSeconds, endpointSeconds)
      ? extraction
      : null;
  return {
    upstreamShotId,
    recordStatus: exact?.status ?? 'missing',
    mediaVerified: false,
    extractionId,
    errorCode: exact?.errorCode ?? null,
    attemptCount: exact?.attemptCount ?? null,
  };
};

type CurrentConditioningState = 'ready' | 'repair_required' | 'upstream_missing';

const currentConditioningState = (project: StudioProjectV2, shotId: string): CurrentConditioningState => {
  const location = activeShotLocations(project).find((candidate) => candidate.shotId === shotId);
  const shot = ownValue(project.shots, shotId);
  const beat = location === undefined ? undefined : ownValue(project.beats, location.beatId);
  if (location === undefined || shot === undefined || beat === undefined) return 'upstream_missing';
  if (location.shotIndex === 0 || shot.chainBreak === 'hard_cut') return 'ready';
  const predecessorId = beat.shotOrder[location.shotIndex - 1];
  const predecessor = predecessorId === undefined ? undefined : ownValue(project.shots, predecessorId);
  const take = predecessor === undefined ? null : canonicalCurrentTake(project, predecessor);
  if (predecessor === undefined || take === null || take.durationSeconds === undefined) return 'upstream_missing';
  const endpointSeconds = take.durationSeconds - (predecessor.trimOutSeconds ?? 0);
  if (!Number.isFinite(endpointSeconds) || endpointSeconds <= 0) return 'repair_required';
  let extractionId: string;
  try {
    extractionId = createStudioFrameExtractionId({ shotId: predecessor.id, videoAssetId: take.id, endpointSeconds });
  } catch {
    return 'repair_required';
  }
  const extraction = ownValue(project.frameExtractions, extractionId);
  const frame =
    extraction?.frameAssetId === null ? undefined : ownValue(project.assets, extraction?.frameAssetId ?? '');
  return extraction?.id === extractionId &&
    extraction.status === 'ready' &&
    extraction.shotId === predecessor.id &&
    extraction.videoAssetId === take.id &&
    Object.is(extraction.endpointSeconds, endpointSeconds) &&
    extraction.frameAssetId !== null &&
    frame?.id === extraction.frameAssetId &&
    frame.projectId === project.id &&
    frame.shotId === predecessor.id &&
    frame.mediaKind === 'image' &&
    frame.managedAsset.collection === 'conditioningFrames' &&
    predecessor.assetIds.includes(frame.id)
    ? 'ready'
    : 'repair_required';
};

const currentRecoveryBase = (
  project: StudioProjectV2,
  shotId: string
): { rootShotId: string; choice: StudioPrepareGenerationChoiceV2 } | null => {
  const location = activeShotLocations(project).find((candidate) => candidate.shotId === shotId);
  const beat = location === undefined ? undefined : ownValue(project.beats, location.beatId);
  if (location === undefined || beat === undefined) return null;
  for (let shotIndex = location.shotIndex; shotIndex >= 0; shotIndex -= 1) {
    const candidateId = beat.shotOrder[shotIndex];
    const candidate = candidateId === undefined ? undefined : ownValue(project.shots, candidateId);
    if (candidate === undefined) return null;
    const startsSegment = shotIndex === 0 || candidate.chainBreak === 'hard_cut';
    if (startsSegment) {
      return {
        rootShotId: candidate.id,
        choice: {
          target: { kind: 'shot', shotId: candidate.id },
          purpose: effectiveSeedAsset(project, candidate) === null ? 'seed_still' : 'video_take',
        },
      };
    }
    const conditioning = currentConditioningState(project, candidate.id);
    if (conditioning === 'ready') {
      return {
        rootShotId: candidate.id,
        choice: { target: { kind: 'shot', shotId: candidate.id }, purpose: 'video_take' },
      };
    }
    if (conditioning === 'repair_required') return null;
  }
  return null;
};

const failureBlockerForShot = (
  project: StudioProjectV2,
  job: StudioJobV2,
  location: ActiveShotLocation,
  paidPrepareAdmissible: boolean
): StudioProjectStatusBlockerV2 => {
  const shot = ownValue(project.shots, location.shotId);
  const hasActualPredecessor =
    location.shotIndex > 0 && ownValue(project.beats, location.beatId)?.shotOrder[location.shotIndex - 1] !== undefined;
  const continuityChange =
    job.error?.code === 'content_rejected' && shot?.chainBreak === 'none' && hasActualPredecessor
      ? { shotId: location.shotId, hardCut: true, requiresSeedGeneration: true }
      : null;
  const currentBaseChoice = currentRecoveryBase(project, location.shotId)?.choice ?? null;
  const fallback: StudioProjectStatusRemedyV2 = !paidPrepareAdmissible
    ? { kind: 'owner_only', reason: 'review_project_data' }
    : continuityChange !== null
      ? generationIntent(location.shotId, 'video_take', continuityChange)
      : currentBaseChoice === null
        ? { kind: 'owner_only', reason: 'review_project_data' }
        : proposal({
            kind: 'generation',
            baseChoices: [currentBaseChoice],
            cascadeChoices: [],
            continuityChange: null,
          });
  return {
    cause: errorCause(job.error?.code),
    where: shotWhere(location, job.id),
    remedy: failedJobRemedy(project, job, fallback),
  };
};

const selectedBindingCount = (shot: StudioShot): number =>
  shot.referenceBinding.characterReferenceIds.length + Number(shot.referenceBinding.backgroundReferenceId !== null);

const bindingDetail = (
  project: StudioProjectV2,
  shot: StudioShot,
  limit: number | null
): StudioProjectStatusShotDetailV2['binding'] => {
  const selectedCount = selectedBindingCount(shot);
  if (shot.referenceBinding.status === 'unassigned') return { status: 'unassigned', selectedCount, limit };
  if (limit === null) return { status: 'unknown', selectedCount, limit: null };
  const resolution = resolveStudioReferenceBindingV2({ project, shotId: shot.id, maxConditioningImages: limit });
  return resolution.ok === true
    ? { status: 'ready', selectedCount, limit }
    : resolution.reason === 'unassigned'
      ? { status: 'unassigned', selectedCount, limit }
      : { status: 'invalid', reason: resolution.reason, selectedCount, limit };
};

const effectiveSeedAsset = (project: StudioProjectV2, shot: StudioShot): StudioAssetV2 | null => {
  if (shot.seedStillId !== null && !shot.dismissedSeedStillIds.includes(shot.seedStillId)) {
    const board = resolveStudioCanonicalBoardAssetV2(project, shot, shot.seedStillId);
    if (board !== null) return board.asset;
    const asset = ownValue(project.assets, shot.seedStillId);
    return asset?.id === shot.seedStillId &&
      asset.projectId === project.id &&
      asset.shotId === shot.id &&
      asset.projectReferenceId === null &&
      asset.mediaKind === 'image' &&
      (asset.managedAsset.collection === 'assets' || asset.managedAsset.collection === 'imports') &&
      shot.assetIds.includes(asset.id)
      ? asset
      : null;
  }
  const candidates = shot.assetIds.flatMap((assetId) => {
    if (shot.dismissedSeedStillIds.includes(assetId)) return [];
    const asset = ownValue(project.assets, assetId);
    return asset?.id === assetId &&
      asset.projectId === project.id &&
      asset.shotId === shot.id &&
      asset.projectReferenceId === null &&
      asset.mediaKind === 'image' &&
      (asset.managedAsset.collection === 'assets' || asset.managedAsset.collection === 'imports')
      ? [asset]
      : [];
  });
  return (
    candidates.toSorted((left, right) =>
      left.createdAt === right.createdAt
        ? left.id < right.id
          ? 1
          : left.id > right.id
            ? -1
            : 0
        : left.createdAt < right.createdAt
          ? 1
          : -1
    )[0] ?? null
  );
};

const deriveProductionStage = (
  project: StudioProjectV2,
  locations: readonly ActiveShotLocation[],
  advisories: StudioProjectStatusAdvisoryV2[],
  detailRequested: boolean,
  bindingLimit: number | null,
  paidPrepareAdmissible: boolean
): { stage: StudioProjectStatusStageV2; details: StudioProjectStatusShotDetailV2[] } => {
  const workspace = projectStudioWorkspaceStatusV2(project);
  const currentJobs = currentVideoJobsByShot(project, workspace);
  const currentSeedJobs = currentSeedJobsByShot(project, locations);
  const cascadeByShot = new Map(workspace.cascadeProgress.map((item) => [item.dependentShotId, item]));
  const recoveryRootShotIds = new Set<string>();
  const attemptedRecoveryRootShotIds = new Set<string>();
  let currentBeatId: string | null = null;
  let segmentMissing = false;
  let segmentRootShotId: string | null = null;
  let segmentHasLineage = false;
  const finishSegment = (): void => {
    if (segmentRootShotId !== null && segmentHasLineage) attemptedRecoveryRootShotIds.add(segmentRootShotId);
  };
  for (const location of locations) {
    const shot = ownValue(project.shots, location.shotId)!;
    if (location.beatId !== currentBeatId || shot.chainBreak === 'hard_cut') {
      finishSegment();
      currentBeatId = location.beatId;
      segmentMissing = false;
      segmentRootShotId = null;
      segmentHasLineage = false;
    }
    segmentHasLineage ||=
      (currentJobs.get(shot.id)?.length ?? 0) > 0 ||
      (currentSeedJobs.get(shot.id)?.length ?? 0) > 0 ||
      shot.dismissedSeedStillIds.length > 0 ||
      shot.jobIds.some((jobId) => {
        const job = ownValue(project.jobs, jobId);
        return job?.projectId === project.id && job.target.kind === 'shot' && job.target.shotId === shot.id;
      });
    if (!segmentMissing && canonicalCurrentTake(project, shot) === null) {
      recoveryRootShotIds.add(shot.id);
      segmentMissing = true;
      segmentRootShotId = shot.id;
    }
  }
  finishSegment();
  const blockers: StudioProjectStatusBlockerV2[] = [];
  const details: StudioProjectStatusShotDetailV2[] = [];
  let currentTakeCount = 0;
  let activeJobCount = 0;
  for (const location of locations) {
    const shot = ownValue(project.shots, location.shotId)!;
    const take = canonicalCurrentTake(project, shot);
    const seed = effectiveSeedAsset(project, shot);
    const startsSegment = location.shotIndex === 0 || shot.chainBreak === 'hard_cut';
    if (take !== null) currentTakeCount += 1;
    const videoJobs = currentJobs.get(location.shotId) ?? [];
    const seedJobs = currentSeedJobs.get(location.shotId) ?? [];
    const currentVideo = latestJob(videoJobs);
    const currentSeed = latestJob(seedJobs);
    const latestGenerationJob = latestJob([...seedJobs, ...videoJobs]);
    const authority = startsSegment && seed === null ? currentSeed : currentVideo;
    const current = authority?.status === 'succeeded' || authority?.status === 'cancelled' ? null : authority;
    activeJobCount += [...videoJobs, ...seedJobs].filter((job) => HEALTHY_JOB_STATUSES.has(job.status)).length;
    const conditioning = conditioningRecord(project, location);
    if (detailRequested) {
      details.push({
        beatId: location.beatId,
        shotId: location.shotId,
        beatPosition: location.beatPosition,
        shotPosition: location.shotPosition,
        seedStillAssetId: seed?.id ?? null,
        videoAssetId: take?.id ?? null,
        latestGenerationJob:
          latestGenerationJob === null
            ? null
            : {
                jobId: latestGenerationJob.id,
                purpose: latestGenerationJob.purpose === 'seed_still' ? 'seed_still' : 'video_take',
                status: latestGenerationJob.status,
                errorCode: latestGenerationJob.error?.code ?? null,
              },
        binding: bindingDetail(project, shot, bindingLimit),
        conditioning,
      });
    }
    if (take !== null) continue;
    if (!recoveryRootShotIds.has(location.shotId)) continue;
    const cascade = cascadeByShot.get(location.shotId);
    if (cascade?.waitingReason === 'dependency_failed') {
      const blocker =
        current !== null
          ? failureBlockerForShot(project, current, location, paidPrepareAdmissible)
          : startsSegment && seed === null && paidPrepareAdmissible
            ? {
                cause: 'seed_generation_required' as const,
                where: shotWhere(location, null),
                remedy: generationIntent(location.shotId, 'seed_still'),
              }
            : !startsSegment && currentConditioningState(project, shot.id) === 'repair_required'
              ? {
                  cause:
                    conditioning?.recordStatus === 'failed'
                      ? ('extraction_failed' as const)
                      : ('conditioning_frame_required' as const),
                  where: shotWhere(location, null),
                  remedy: { kind: 'owner_only' as const, reason: 'review_project_data' as const },
                }
              : {
                  cause: 'dependency_failed' as const,
                  where: shotWhere(location, null),
                  remedy: { kind: 'owner_only' as const, reason: 'review_project_data' as const },
                };
      const blockerShotId = blocker.where.kind === 'shot' ? blocker.where.shotId : null;
      if (
        blockerShotId === null ||
        !blockers.some((candidate) => candidate.where.kind === 'shot' && candidate.where.shotId === blockerShotId)
      ) {
        blockers.push(blocker);
      }
      continue;
    }
    if (cascade?.waitingReason === 'conditioning_failed' && cascade.canRetryConditioningFrame) {
      blockers.push({
        cause: conditioning?.recordStatus === 'failed' ? 'extraction_failed' : 'conditioning_frame_required',
        where: shotWhere(location, current?.id ?? null),
        remedy: { kind: 'free_fix', op: 'retry_conditioning_frame', dependentShotId: location.shotId },
      });
      continue;
    }
    if (cascade?.waitingReason === 'choose_seed') {
      blockers.push({
        cause: 'seed_selection_required',
        where: shotWhere(location, currentSeed?.id ?? current?.id ?? null),
        remedy: { kind: 'owner_only', reason: 'select_seed' },
      });
      continue;
    }
    if (current !== null && (current.status === 'failed' || current.status === 'needs_attention')) {
      const blocker = failureBlockerForShot(project, current, location, paidPrepareAdmissible);
      const blockerShotId = blocker.where.kind === 'shot' ? blocker.where.shotId : null;
      if (
        blocker.cause !== 'dependency_failed' ||
        blockerShotId === null ||
        !blockers.some((candidate) => candidate.where.kind === 'shot' && candidate.where.shotId === blockerShotId)
      ) {
        blockers.push(blocker);
      }
      continue;
    }
    if (current === null && !startsSegment && currentConditioningState(project, shot.id) === 'repair_required') {
      blockers.push({
        cause: conditioning?.recordStatus === 'failed' ? 'extraction_failed' : 'conditioning_frame_required',
        where: shotWhere(location, null),
        remedy: { kind: 'owner_only', reason: 'review_project_data' },
      });
      continue;
    }
    if (
      current === null &&
      startsSegment &&
      seed === null &&
      paidPrepareAdmissible &&
      attemptedRecoveryRootShotIds.has(location.shotId)
    ) {
      blockers.push({
        cause: 'seed_generation_required',
        where: shotWhere(location, null),
        remedy: generationIntent(location.shotId, 'seed_still'),
      });
    }
  }
  for (const dirty of deriveStudioDirtyShotsV2(project)) {
    advisories.push({
      cause: 'current_take_stale',
      stage: 'production',
      shotId: dirty.shotId,
      staleCauses: [...dirty.causes],
    });
  }
  const uniqueBlockers: StudioProjectStatusBlockerV2[] = [];
  const blockerIdentities = new Set<string>();
  for (const blocker of blockers) {
    const identity = JSON.stringify(blocker);
    if (blockerIdentities.has(identity)) continue;
    blockerIdentities.add(identity);
    uniqueBlockers.push(blocker);
  }
  const state: StudioProjectStatusStageStateV2 =
    locations.length === 0
      ? 'not_started'
      : currentTakeCount === locations.length
        ? 'complete'
        : uniqueBlockers.length > 0
          ? 'blocked'
          : 'in_progress';
  return {
    stage: stage(
      'production',
      state,
      {
        stage: 'production',
        currentTakeCount,
        shotCount: locations.length,
        activeJobCount,
      },
      uniqueBlockers
    ),
    details,
  };
};

const deriveCutStage = (
  project: StudioProjectV2,
  locations: readonly ActiveShotLocation[],
  currentTakeCount: number,
  advisories: StudioProjectStatusAdvisoryV2[]
): StudioProjectStatusStageV2 => {
  const preview = deriveStudioEditorFolderPreviewV2(project);
  if (preview.status === 'blocked') {
    const blockers: StudioProjectStatusBlockerV2[] = [];
    if (preview.reason === 'invalid_media') {
      blockers.push({
        cause: 'cut_invalid_media',
        where: { kind: 'cut' },
        remedy: { kind: 'owner_only', reason: 'edit_cut' },
      });
    } else if (preview.reason === 'bed_too_short') {
      blockers.push({
        cause: 'cut_bed_too_short',
        where: { kind: 'cut' },
        remedy: { kind: 'owner_only', reason: 'replace_audio_bed' },
      });
    }
    return stage(
      'cut',
      currentTakeCount === 0 && blockers.length === 0 ? 'not_started' : blockers.length > 0 ? 'blocked' : 'in_progress',
      {
        stage: 'cut',
        currentTakeCount,
        shotCount: locations.length,
        durationSeconds: null,
        targetSeconds: project.targetDurationSeconds,
        structurallyPlayable: false,
      },
      blockers
    );
  }
  const targetedSlateOnly =
    locations.length === 0 &&
    project.beatOrder.length > 0 &&
    project.beatOrder.every((beatId) => {
      const beat = ownValue(project.beats, beatId);
      return (
        beat?.id === beatId &&
        beat.shotOrder.length === 0 &&
        beat.targetSeconds !== null &&
        Number.isFinite(beat.targetSeconds) &&
        beat.targetSeconds > 0
      );
    });
  const completePictures = (locations.length > 0 && currentTakeCount === locations.length) || targetedSlateOnly;
  const matches = targetMatches(preview.durationSeconds, project.targetDurationSeconds);
  if (completePictures && !matches) {
    advisories.push({
      cause: 'target_duration_mismatch',
      stage: 'cut',
      actualSeconds: preview.durationSeconds,
      targetSeconds: project.targetDurationSeconds,
    });
  }
  return stage(
    'cut',
    completePictures && matches ? 'complete' : completePictures || currentTakeCount > 0 ? 'in_progress' : 'not_started',
    {
      stage: 'cut',
      currentTakeCount,
      shotCount: locations.length,
      durationSeconds: preview.durationSeconds,
      targetSeconds: project.targetDurationSeconds,
      structurallyPlayable: completePictures,
    }
  );
};

/** Derives one bounded, renderer-safe project status without I/O, persistence, or spend authority. */
export const projectStudioStatusV2 = (
  project: StudioProjectV2,
  routeInput: StudioProjectStatusRouteCatalogV2,
  options: { detail?: boolean } = {}
): StudioProjectStatusV2 => {
  const locations = activeShotLocations(project);
  const advisories: StudioProjectStatusAdvisoryV2[] = [];
  const brief = stage('brief', project.brief.trim().length > 0 ? 'complete' : 'not_started', {
    stage: 'brief',
    hasBrief: project.brief.trim().length > 0,
  });
  const engines = deriveEnginesStage(project, routeInput, locations);
  const imageRoute = routeInput.status === 'available' ? routeInput.catalog.image.selectedRoute : null;
  const imagePrepareAdmissible =
    routeInput.status === 'available' &&
    routeInput.catalog.image.status === 'ready' &&
    imageRoute !== null &&
    imageRoute.constraints.aspectRatios.includes(project.aspectRatio) &&
    imageRoute.constraints.resolutions.includes(project.resolution);
  const references = deriveReferencesStage(project, imagePrepareAdmissible);
  const storyboard = deriveStoryboardStage(project, locations, advisories);
  const bindings = deriveBindingsStage(project, routeInput, locations);
  const bindingLimit =
    routeInput.status === 'available' && routeInput.catalog.image.selectedRoute !== null
      ? routeInput.catalog.image.selectedRoute.constraints.maxConditioningImages
      : null;
  const productionResult = deriveProductionStage(
    project,
    locations,
    advisories,
    options.detail === true,
    bindingLimit,
    engines.state === 'complete' &&
      (references.state === 'complete' ||
        (references.state === 'not_started' &&
          references.summary.stage === 'references' &&
          references.summary.plannedCount === 0)) &&
      storyboard.summary.stage === 'storyboard' &&
      storyboard.summary.beatCount > 0 &&
      storyboard.summary.authoredShotCount === storyboard.summary.shotCount &&
      bindings.state === 'complete'
  );
  const productionSummary =
    productionResult.stage.summary.stage === 'production' ? productionResult.stage.summary : null;
  const cut = deriveCutStage(project, locations, productionSummary?.currentTakeCount ?? 0, advisories);
  const stages: StudioProjectStatusStageV2[] = [
    brief,
    engines,
    references,
    storyboard,
    bindings,
    productionResult.stage,
    cut,
  ];
  const boardPictureCount = locations.filter((location) => {
    const shot = ownValue(project.shots, location.shotId);
    return (
      shot !== undefined &&
      shot.boardAssetId !== null &&
      resolveStudioCanonicalBoardAssetV2(project, shot, shot.boardAssetId) !== null
    );
  }).length;
  if (!STUDIO_PROJECT_STATUS_STAGE_ORDER_V2.every((id, index) => stages[index]?.id === id)) {
    throw new TypeError('Invalid Studio project status stage order');
  }
  return {
    projectId: project.id,
    projectRevision: project.revision,
    catalogVersion: routeInput.status === 'available' ? routeInput.catalog.catalogVersion : null,
    stages,
    blockerCount: stages.reduce((count, item) => count + item.blockers.length, 0),
    advisories,
    boards: { currentPictureCount: boardPictureCount, shotCount: locations.length },
    detail:
      options.detail === true
        ? {
            shots: productionResult.details,
            references: project.referenceOrder.flatMap((referenceId): StudioProjectStatusReferenceDetailV2[] => {
              const reference = ownValue(project.references, referenceId);
              if (reference?.id !== referenceId) return [];
              const latest = latestOwnedReferenceJob(project, referenceId);
              return [
                {
                  referenceId,
                  kind: reference.kind,
                  approved:
                    reference.approvedAssetId !== null &&
                    canonicalReferenceAsset(project, referenceId, reference.approvedAssetId) !== null,
                  latestJob:
                    latest === null
                      ? null
                      : { jobId: latest.id, status: latest.status, errorCode: latest.error?.code ?? null },
                },
              ];
            }),
          }
        : null,
  };
};
