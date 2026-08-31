/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  StudioJobPurpose,
  StudioJobStatusV2,
  StudioRendererJobV2,
  StudioRendererProjectV2,
} from '@/common/types/project/creativeStudioTypes';

type NonterminalStudioJobStatus = Extract<
  StudioJobStatusV2,
  'waiting_for_conditioning' | 'queued_local' | 'submitting' | 'queued_remote' | 'running' | 'needs_attention'
>;

const NONTERMINAL_JOB_STATUSES: ReadonlySet<NonterminalStudioJobStatus> = new Set([
  'waiting_for_conditioning',
  'queued_local',
  'submitting',
  'queued_remote',
  'running',
  'needs_attention',
]);

type ReferenceRemovalBlockerBase = {
  referenceId: string;
  assetId: string;
  jobId: string;
  /** Immutable job identity captured with the recovery claim. */
  createdAt: string;
  purpose: StudioJobPurpose;
  shotId: string | null;
  beatId: string | null;
  /** One-based active-film position, or null for retained/non-Shot work. */
  beatPosition: number | null;
  /** One-based position within the active Beat, or null for retained/non-Shot work. */
  shotPosition: number | null;
};

export type ReferenceRetainedShotBinOwner =
  | { kind: 'shot'; beatId: string; shotId: string; reason: 'lifted' }
  | { kind: 'beat'; beatId: string; reason: 'lifted' | 'alternate' };

type ReferenceRemovalJobBlocker =
  | (ReferenceRemovalBlockerBase & { kind: 'active_reference_job'; status: NonterminalStudioJobStatus })
  | (ReferenceRemovalBlockerBase & { kind: 'active_asset_consumer'; status: NonterminalStudioJobStatus })
  | (ReferenceRemovalBlockerBase & {
      kind: 'download_recovery';
      status: 'failed';
      recoveryAction: 'retry_download';
    })
  | (ReferenceRemovalBlockerBase & {
      kind: 'download_recovery';
      status: 'failed';
      recoveryAction: 'restore_shot';
      retainedOwner: ReferenceRetainedShotBinOwner;
    });

export type ReferenceRemovalBlocker =
  | ReferenceRemovalJobBlocker
  | {
      kind: 'invalid_authority';
      referenceId: string;
      assetId: string;
    };

export type ReferenceDownloadRecoveryClaim = Extract<
  ReferenceRemovalJobBlocker,
  { kind: 'download_recovery'; recoveryAction: 'retry_download' }
>;

export type ReferenceRetainedShotReviewClaim = Extract<
  ReferenceRemovalJobBlocker,
  { kind: 'download_recovery'; recoveryAction: 'restore_shot' }
>;

type ShotPosition = Pick<ReferenceRemovalBlockerBase, 'shotId' | 'beatId' | 'beatPosition' | 'shotPosition'>;

const exactActiveShotPosition = (project: StudioRendererProjectV2, shotId: string): ShotPosition => {
  const matches: Omit<ShotPosition, 'shotId'>[] = [];
  project.beatOrder.forEach((beatId, beatIndex) => {
    const beat = Object.hasOwn(project.beats, beatId) ? project.beats[beatId] : undefined;
    if (beat?.id !== beatId) return;
    beat.shotOrder.forEach((candidateShotId, shotIndex) => {
      if (candidateShotId !== shotId) return;
      matches.push({
        beatId,
        beatPosition: beatIndex + 1,
        shotPosition: shotIndex + 1,
      });
    });
  });
  const position = matches.length === 1 ? matches[0]! : null;
  return {
    shotId,
    beatId: position?.beatId ?? null,
    beatPosition: position?.beatPosition ?? null,
    shotPosition: position?.shotPosition ?? null,
  };
};

const ownedJob = (project: StudioRendererProjectV2, job: StudioRendererJobV2): boolean => {
  if (job.projectId !== project.id) return false;
  if (job.target.kind === 'reference') {
    const reference = Object.hasOwn(project.references, job.target.referenceId)
      ? project.references[job.target.referenceId]
      : undefined;
    return reference?.id === job.target.referenceId && reference.jobIds.includes(job.id);
  }
  const shot = Object.hasOwn(project.shots, job.target.shotId) ? project.shots[job.target.shotId] : undefined;
  return shot?.id === job.target.shotId && shot.jobIds.includes(job.id);
};

const jobUsesExactReferenceAsset = (job: StudioRendererJobV2, referenceId: string, assetId: string): boolean =>
  job.composition.inputs.referenceInputs.some(
    (input) => input.referenceId === referenceId && input.assetId === assetId
  );

const locationForJob = (project: StudioRendererProjectV2, job: StudioRendererJobV2): ShotPosition =>
  job.target.kind === 'shot'
    ? exactActiveShotPosition(project, job.target.shotId)
    : { shotId: null, beatId: null, beatPosition: null, shotPosition: null };

const isNonterminalJobStatus = (status: StudioJobStatusV2): status is NonterminalStudioJobStatus =>
  NONTERMINAL_JOB_STATUSES.has(status as NonterminalStudioJobStatus);

const exactRetainedShotOwner = (
  project: StudioRendererProjectV2,
  shotId: string
): ReferenceRetainedShotBinOwner | null => {
  const matches: ReferenceRetainedShotBinOwner[] = [];
  for (const item of project.bin) {
    if (item.kind === 'shot') {
      if (item.shotId !== shotId) continue;
      const beat = Object.hasOwn(project.beats, item.beatId) ? project.beats[item.beatId] : undefined;
      const activeBeatCount = project.beatOrder.filter((beatId) => beatId === item.beatId).length;
      const binnedBeatCount = project.bin.filter(
        (candidate) => candidate.kind === 'beat' && candidate.beatId === item.beatId
      ).length;
      if (beat?.id !== item.beatId || activeBeatCount + binnedBeatCount !== 1) return null;
      matches.push({ kind: 'shot', beatId: item.beatId, shotId, reason: item.reason });
      continue;
    }
    const beat = Object.hasOwn(project.beats, item.beatId) ? project.beats[item.beatId] : undefined;
    if (beat?.id !== item.beatId) continue;
    if (
      project.beatOrder.filter((beatId) => beatId === item.beatId).length !== 0 ||
      project.bin.filter((candidate) => candidate.kind === 'beat' && candidate.beatId === item.beatId).length !== 1
    ) {
      return null;
    }
    const shotOccurrences = beat.shotOrder.filter((candidateShotId) => candidateShotId === shotId).length;
    if (shotOccurrences > 1) return null;
    if (shotOccurrences === 1) {
      matches.push({ kind: 'beat', beatId: item.beatId, reason: item.reason });
    }
  }
  return matches.length === 1 ? matches[0]! : null;
};

const hasCanonicalCurrentAsset = (project: StudioRendererProjectV2, referenceId: string, assetId: string): boolean => {
  const reference = Object.hasOwn(project.references, referenceId) ? project.references[referenceId] : undefined;
  const asset = Object.hasOwn(project.assets, assetId) ? project.assets[assetId] : undefined;
  if (
    reference?.id !== referenceId ||
    asset?.id !== assetId ||
    asset.projectId !== project.id ||
    asset.projectReferenceId !== referenceId ||
    asset.shotId !== null ||
    asset.mediaKind !== 'image' ||
    (asset.managedAsset.collection !== 'assets' && asset.managedAsset.collection !== 'imports')
  ) {
    return false;
  }
  if (asset.managedAsset.collection === 'imports') {
    return (
      asset.producerJobId === null && asset.compositionDigest === null && asset.generationReferenceAssetIds.length === 0
    );
  }
  const producers = Object.values(project.jobs).filter(
    (job) =>
      job.projectId === project.id &&
      job.target.kind === 'reference' &&
      job.target.referenceId === referenceId &&
      job.purpose === 'reference_image' &&
      job.status === 'succeeded' &&
      job.outputAssetIdsByRole.primary === assetId &&
      job.outputAssetIds.filter((outputAssetId) => outputAssetId === assetId).length === 1
  );
  return producers.length === 1 && reference.jobIds.includes(producers[0]!.id);
};

/**
 * Mirrors Main's fail-closed current-reference deletion guard for a renderer-safe project snapshot,
 * while preserving enough identity to show each blocker and authorize only exact free recovery.
 */
export const deriveReferenceRemovalBlockers = (
  project: StudioRendererProjectV2,
  referenceId: string
): ReferenceRemovalBlocker[] => {
  const reference = Object.hasOwn(project.references, referenceId) ? project.references[referenceId] : undefined;
  if (reference?.id !== referenceId || reference.approvedAssetId === null) return [];
  const assetId = reference.approvedAssetId;
  const invalidAuthority: ReferenceRemovalBlocker = { kind: 'invalid_authority', referenceId, assetId };
  if (
    project.referencePlanStatus !== 'planned' ||
    project.referenceOrder.filter((candidateId) => candidateId === referenceId).length !== 1
  ) {
    return [invalidAuthority];
  }
  if (!hasCanonicalCurrentAsset(project, referenceId, assetId)) return [invalidAuthority];

  const blockers: ReferenceRemovalJobBlocker[] = [];
  for (const job of Object.values(project.jobs)) {
    const usesAsset = jobUsesExactReferenceAsset(job, referenceId, assetId);
    const activeReferenceJob =
      isNonterminalJobStatus(job.status) && job.target.kind === 'reference' && job.target.referenceId === referenceId;
    const activeAssetConsumer = isNonterminalJobStatus(job.status) && usesAsset;
    const downloadRecovery =
      job.status === 'failed' && job.error?.code === 'download_failed' && job.canRetryDownload && usesAsset;
    if (!activeReferenceJob && !activeAssetConsumer && !downloadRecovery) continue;
    if (job.id.length === 0 || !ownedJob(project, job)) return [invalidAuthority];

    const common: ReferenceRemovalBlockerBase = {
      referenceId,
      assetId,
      jobId: job.id,
      createdAt: job.createdAt,
      purpose: job.purpose,
      ...locationForJob(project, job),
    };
    if (activeReferenceJob) {
      blockers.push({ ...common, kind: 'active_reference_job', status: job.status as NonterminalStudioJobStatus });
      continue;
    }
    if (activeAssetConsumer) {
      blockers.push({ ...common, kind: 'active_asset_consumer', status: job.status as NonterminalStudioJobStatus });
      continue;
    }
    if (downloadRecovery) {
      if (common.shotId !== null && common.beatPosition === null) {
        const retainedOwner = exactRetainedShotOwner(project, common.shotId);
        if (retainedOwner === null) return [invalidAuthority];
        blockers.push({
          ...common,
          kind: 'download_recovery',
          status: 'failed',
          recoveryAction: 'restore_shot',
          retainedOwner,
        });
      } else {
        blockers.push({
          ...common,
          kind: 'download_recovery',
          status: 'failed',
          recoveryAction: 'retry_download',
        });
      }
    }
  }

  return blockers.toSorted((left, right) => {
    const recoveryPriority = Number(right.kind === 'download_recovery') - Number(left.kind === 'download_recovery');
    if (recoveryPriority !== 0) return recoveryPriority;
    const byCreatedAt = left.createdAt.localeCompare(right.createdAt);
    return byCreatedAt === 0 ? left.jobId.localeCompare(right.jobId) : byCreatedAt;
  });
};
