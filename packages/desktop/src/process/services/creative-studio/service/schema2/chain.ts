/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { isCanonicalStudioGeneratedTakeV2 } from '@/common/types/project/creativeStudioCanonicalTake';
import {
  STUDIO_MAX_PROJECT_REFERENCES,
  STUDIO_MAX_DIRTY_SHOTS_REPORTED,
  type StudioAssetV2,
  type StudioConditioningInputSnapshot,
  type StudioJobV2,
  type StudioProjectV2,
  type StudioRendererDirtyShotV2,
  type StudioShot,
} from '@/common/types/project/creativeStudioTypes';
import {
  createStudioFrameExtractionId,
  createStudioGenerationRequestTemplate,
  composeStudioGenerationV2,
  deriveStudioInstructionProfileV2,
  isStudioGenerationRequestCurrent,
  studioConditioningInputsEqual,
} from './generation';
import { resolveStudioCanonicalBoardAssetV2 } from './generation/boardPanel';
import { resolveStudioReferenceBindingV2 } from './generation/referenceBinding';

const NONTERMINAL_JOB_STATUSES: ReadonlySet<StudioJobV2['status']> = new Set([
  'queued_local',
  'waiting_for_conditioning',
  'submitting',
  'queued_remote',
  'running',
  'needs_attention',
]);

export type StudioInboundShotReferenceKindV2 =
  | 'own_nonterminal_job'
  | 'own_pending_frame'
  | 'downstream_nonterminal_job'
  | 'downstream_pending_frame'
  | 'waiting_authorization_dependency'
  | 'bound_nonterminal_request';

export type StudioInboundShotReferenceV2 = {
  shotId: string;
  dependentShotId: string | null;
  kind: StudioInboundShotReferenceKindV2;
};

type ActiveShotLocation = { beatId: string; shotIndex: number };

const REFERENCE_KIND_ORDER: readonly StudioInboundShotReferenceKindV2[] = [
  'own_nonterminal_job',
  'own_pending_frame',
  'downstream_nonterminal_job',
  'downstream_pending_frame',
  'waiting_authorization_dependency',
  'bound_nonterminal_request',
];

const ownValue = <T>(record: Readonly<Record<string, T>>, id: string): T | undefined =>
  Object.hasOwn(record, id) ? record[id] : undefined;

const activeShotLocations = (project: StudioProjectV2): Map<string, ActiveShotLocation> => {
  const result = new Map<string, ActiveShotLocation>();
  for (const beatId of project.beatOrder) {
    const beat = ownValue(project.beats, beatId);
    if (beat?.id !== beatId) continue;
    for (let shotIndex = 0; shotIndex < beat.shotOrder.length; shotIndex += 1) {
      const shotId = beat.shotOrder[shotIndex]!;
      if (!result.has(shotId)) result.set(shotId, { beatId, shotIndex });
    }
  }
  return result;
};

const selectedVideoTake = (project: StudioProjectV2, shot: StudioShot): StudioAssetV2 | null => {
  if (shot.videoAssetId === null) return null;
  const asset = ownValue(project.assets, shot.videoAssetId);
  return asset?.mediaKind === 'video' && isCanonicalStudioGeneratedTakeV2(asset, project.id, shot) ? asset : null;
};

const isProjectReferenceAsset = (project: StudioProjectV2, assetId: string): boolean =>
  ownValue(project.assets, assetId)?.projectReferenceId !== null;

const eligibleSeed = (project: StudioProjectV2, shot: StudioShot, assetId: string): StudioAssetV2 | null => {
  const asset = ownValue(project.assets, assetId);
  return asset?.id === assetId &&
    asset.projectId === project.id &&
    asset.shotId === shot.id &&
    asset.mediaKind === 'image' &&
    (asset.managedAsset.collection === 'assets' || asset.managedAsset.collection === 'imports') &&
    !isProjectReferenceAsset(project, asset.id) &&
    shot.assetIds.includes(asset.id)
    ? asset
    : null;
};

const eligibleExplicitSeed = (project: StudioProjectV2, shot: StudioShot, assetId: string): StudioAssetV2 | null =>
  eligibleSeed(project, shot, assetId) ?? resolveStudioCanonicalBoardAssetV2(project, shot, assetId)?.asset ?? null;

const effectiveSeed = (project: StudioProjectV2, shot: StudioShot): StudioAssetV2 | null => {
  if (shot.seedStillId !== null && !shot.dismissedSeedStillIds.includes(shot.seedStillId)) {
    return eligibleExplicitSeed(project, shot, shot.seedStillId);
  }
  const candidates = shot.assetIds.flatMap((assetId) => {
    if (shot.dismissedSeedStillIds.includes(assetId)) return [];
    const asset = eligibleSeed(project, shot, assetId);
    return asset === null ? [] : [asset];
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
  return candidates[0] ?? null;
};

const producingJob = (project: StudioProjectV2, shot: StudioShot, assetId: string): StudioJobV2 | null => {
  const jobs = shot.jobIds.flatMap((jobId) => {
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
  return jobs.length === 1 ? jobs[0]! : null;
};

const currentReferenceInputs = (project: StudioProjectV2, shot: StudioShot) => {
  const resolution = resolveStudioReferenceBindingV2({
    project,
    shotId: shot.id,
    maxConditioningImages: STUDIO_MAX_PROJECT_REFERENCES,
  });
  return resolution.ok ? resolution.referenceInputs : null;
};

const currentRequestTemplate = (project: StudioProjectV2, shot: StudioShot, job: StudioJobV2) => {
  const owner = Object.values(project.beats).find((beat) => beat.shotOrder.includes(shot.id));
  if (owner === undefined) return null;
  try {
    const source = {
      kind: 'shot' as const,
      beatId: owner.id,
      story: owner.story,
      shotId: shot.id,
      shootingScript: shot.shootingScript,
    };
    const referenceInputs = job.purpose === 'video_take' ? [] : currentReferenceInputs(project, shot);
    if (referenceInputs === null) return null;
    const composition = composeStudioGenerationV2({
      projectRevision: project.revision,
      brief: project.brief,
      rules: project.rules,
      source,
      purpose: job.purpose,
      referenceInputs,
      aspectRatio: project.aspectRatio,
      resolution: project.resolution,
      route: job.provider,
      boardStyle: job.purpose === 'board_still' ? project.boardStyle : null,
      instructionProfile: deriveStudioInstructionProfileV2(job.provider, job.purpose, source),
    });
    return createStudioGenerationRequestTemplate({
      composition,
      durationSeconds: shot.durationSeconds,
    });
  } catch {
    return null;
  }
};

const selectedEndpoint = (project: StudioProjectV2, shot: StudioShot) => {
  const take = selectedVideoTake(project, shot);
  if (take?.durationSeconds === undefined || !Number.isFinite(take.durationSeconds) || take.durationSeconds <= 0) {
    return null;
  }
  const endpointSeconds = take.durationSeconds - (shot.trimOutSeconds ?? 0);
  return Number.isFinite(endpointSeconds) && endpointSeconds > 0 ? { take, endpointSeconds } : null;
};

const currentConditioningInput = (
  project: StudioProjectV2,
  shot: StudioShot,
  locations: ReadonlyMap<string, ActiveShotLocation>
): StudioConditioningInputSnapshot | null => {
  const location = locations.get(shot.id);
  const owner = location === undefined ? undefined : ownValue(project.beats, location.beatId);
  if (location === undefined || owner === undefined) return null;
  if (location.shotIndex === 0 || shot.chainBreak === 'hard_cut') {
    const seed = effectiveSeed(project, shot);
    return seed === null ? null : { kind: 'seed_still', assetId: seed.id };
  }
  const predecessorId = owner.shotOrder[location.shotIndex - 1];
  const predecessor = predecessorId === undefined ? undefined : ownValue(project.shots, predecessorId);
  if (predecessor === undefined) return null;
  const endpoint = selectedEndpoint(project, predecessor);
  if (endpoint === null) return null;
  let extractionId: string;
  try {
    extractionId = createStudioFrameExtractionId({
      shotId: predecessor.id,
      videoAssetId: endpoint.take.id,
      endpointSeconds: endpoint.endpointSeconds,
    });
  } catch {
    return null;
  }
  const extraction = ownValue(project.frameExtractions, extractionId);
  if (
    extraction?.id !== extractionId ||
    extraction.status !== 'ready' ||
    extraction.frameAssetId === null ||
    extraction.shotId !== predecessor.id ||
    extraction.videoAssetId !== endpoint.take.id ||
    !Object.is(extraction.endpointSeconds, endpoint.endpointSeconds)
  ) {
    return null;
  }
  return {
    kind: 'predecessor_frame',
    predecessorShotId: predecessor.id,
    takeAssetId: endpoint.take.id,
    frameAssetId: extraction.frameAssetId,
    endpointSeconds: endpoint.endpointSeconds,
  };
};

const currentRouteId = (project: StudioProjectV2, job: StudioJobV2): string | null => {
  switch (job.purpose) {
    case 'seed_still':
    case 'board_still':
      return project.imageRouteId;
    case 'video_take':
      return project.videoRouteId;
  }
};

const jobIsCurrent = (
  project: StudioProjectV2,
  shot: StudioShot,
  job: StudioJobV2,
  conditioningInput: StudioConditioningInputSnapshot | null
): boolean => {
  const template = currentRequestTemplate(project, shot, job);
  return (
    job.requestSnapshot !== null &&
    template !== null &&
    isStudioGenerationRequestCurrent(job.requestSnapshot, { ...template, conditioningInput }) &&
    job.spendReceipt?.routeId === currentRouteId(project, job)
  );
};

const effectiveSeedGenerationIsCurrent = (project: StudioProjectV2, shot: StudioShot): boolean => {
  const seed = effectiveSeed(project, shot);
  if (seed === null || seed.managedAsset.collection === 'imports' || seed.managedAsset.collection === 'boardStills') {
    return true;
  }
  const seedJob = producingJob(project, shot, seed.id);
  return seedJob !== null && jobIsCurrent(project, shot, seedJob, null);
};

/** Derives unique active dirty rows in film order. */
export const deriveStudioDirtyShotsV2 = (project: StudioProjectV2): StudioRendererDirtyShotV2[] => {
  const locations = activeShotLocations(project);
  const result: StudioRendererDirtyShotV2[] = [];
  const seen = new Set<string>();
  for (const beatId of project.beatOrder) {
    const beat = ownValue(project.beats, beatId);
    if (beat === undefined) continue;
    for (const shotId of beat.shotOrder) {
      if (seen.has(shotId)) continue;
      seen.add(shotId);
      const shot = ownValue(project.shots, shotId);
      if (shot === undefined) continue;
      const selected = selectedVideoTake(project, shot);
      if (selected === null) continue;
      const job = producingJob(project, shot, selected.id);
      const currentConditioning = currentConditioningInput(project, shot, locations);
      const causes: StudioRendererDirtyShotV2['causes'] = [];
      if (
        job !== null &&
        !studioConditioningInputsEqual(job.requestSnapshot?.conditioningInput ?? null, currentConditioning)
      ) {
        causes.push('continuity_stale');
      }
      const location = locations.get(shot.id);
      const owner = location === undefined ? undefined : ownValue(project.beats, location.beatId);
      const startsSegment =
        location !== undefined && owner !== undefined && (location.shotIndex === 0 || shot.chainBreak === 'hard_cut');
      if (
        job === null ||
        !jobIsCurrent(project, shot, job, currentConditioning) ||
        (startsSegment && !effectiveSeedGenerationIsCurrent(project, shot))
      ) {
        causes.push('generation_out_of_date');
      }
      if (causes.length > 0) result.push({ shotId, causes });
      if (result.length >= STUDIO_MAX_DIRTY_SHOTS_REPORTED) return result;
    }
  }
  return result;
};

const referencedShotIds = (project: StudioProjectV2, job: StudioJobV2): Set<string> => {
  const result = new Set<string>();
  if (job.requestPlan.kind === 'after_take_selection') {
    result.add(
      job.requestPlan.dependency.kind === 'authorized_seed'
        ? job.requestPlan.dependency.shotId
        : job.requestPlan.dependency.predecessorShotId
    );
  }
  const input = job.requestSnapshot?.conditioningInput;
  if (input?.kind === 'predecessor_frame') result.add(input.predecessorShotId);
  if (input?.kind === 'seed_still') {
    const asset = ownValue(project.assets, input.assetId);
    if (asset?.shotId !== null && asset?.shotId !== undefined) result.add(asset.shotId);
  }
  return result;
};

/** Derives live inbound-reference blockers for one Shot or a Beat's contained-shot union. */
export const deriveStudioInboundShotReferencesV2 = (
  project: StudioProjectV2,
  shotIds: readonly string[]
): StudioInboundShotReferenceV2[] => {
  const targetOrder = new Map(shotIds.map((shotId, index) => [shotId, index]));
  const targets = new Set(shotIds);
  const result: StudioInboundShotReferenceV2[] = [];
  const seen = new Set<string>();
  const add = (shotId: string, dependentShotId: string | null, kind: StudioInboundShotReferenceKindV2): void => {
    const identity = `${shotId}\0${dependentShotId ?? ''}\0${kind}`;
    if (!seen.has(identity)) {
      seen.add(identity);
      result.push({ shotId, dependentShotId, kind });
    }
  };

  for (const job of Object.values(project.jobs)) {
    if (!NONTERMINAL_JOB_STATUSES.has(job.status)) continue;
    const dependentShotId = job.target.kind === 'shot' ? job.target.shotId : null;
    if (dependentShotId !== null && targets.has(dependentShotId)) {
      add(dependentShotId, dependentShotId, 'own_nonterminal_job');
      if (job.requestSnapshot !== null) add(dependentShotId, dependentShotId, 'bound_nonterminal_request');
    }
    for (const referencedShotId of referencedShotIds(project, job)) {
      if (!targets.has(referencedShotId) || referencedShotId === dependentShotId) continue;
      add(referencedShotId, dependentShotId, 'downstream_nonterminal_job');
      add(
        referencedShotId,
        dependentShotId,
        job.status === 'waiting_for_conditioning' && job.requestSnapshot === null
          ? 'waiting_authorization_dependency'
          : 'bound_nonterminal_request'
      );
    }
  }
  const locations = activeShotLocations(project);
  for (const extraction of Object.values(project.frameExtractions)) {
    if ((extraction.status !== 'pending' && extraction.status !== 'extracting') || !targets.has(extraction.shotId)) {
      continue;
    }
    add(extraction.shotId, extraction.shotId, 'own_pending_frame');
    const owner = locations.get(extraction.shotId);
    const beat = owner === undefined ? undefined : ownValue(project.beats, owner.beatId);
    const dependentShotId =
      owner === undefined || beat === undefined ? null : (beat.shotOrder[owner.shotIndex + 1] ?? null);
    if (dependentShotId !== null) add(extraction.shotId, dependentShotId, 'downstream_pending_frame');
  }
  return result.toSorted((left, right) => {
    const byShot =
      (targetOrder.get(left.shotId) ?? Number.MAX_SAFE_INTEGER) -
      (targetOrder.get(right.shotId) ?? Number.MAX_SAFE_INTEGER);
    if (byShot !== 0) return byShot;
    const byKind = REFERENCE_KIND_ORDER.indexOf(left.kind) - REFERENCE_KIND_ORDER.indexOf(right.kind);
    if (byKind !== 0) return byKind;
    const leftDependent = left.dependentShotId ?? '';
    const rightDependent = right.dependentShotId ?? '';
    return leftDependent < rightDependent ? -1 : leftDependent > rightDependent ? 1 : 0;
  });
};

export const studioShotHasBlockingInboundReferenceV2 = (project: StudioProjectV2, shotId: string): boolean =>
  deriveStudioInboundShotReferencesV2(project, [shotId]).length > 0;
