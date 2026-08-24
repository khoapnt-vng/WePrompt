/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  StudioGenerationReferenceInputSnapshot,
  StudioJobV2,
  StudioProjectV2,
} from '@/common/types/project/creativeStudioTypes';

const SAFE_ID = /^[A-Za-z0-9_-]{1,256}$/;
const NONTERMINAL_JOB_STATUSES: ReadonlySet<StudioJobV2['status']> = new Set([
  'waiting_for_conditioning',
  'queued_local',
  'submitting',
  'queued_remote',
  'running',
  'needs_attention',
]);

export type StudioProjectReferenceApprovalErrorCodeV2 = 'invalid_authority' | 'approved_asset_busy';

export class StudioProjectReferenceApprovalErrorV2 extends Error {
  readonly code: StudioProjectReferenceApprovalErrorCodeV2;

  constructor(code: StudioProjectReferenceApprovalErrorCodeV2) {
    super(code);
    this.name = 'StudioProjectReferenceApprovalErrorV2';
    this.code = code;
  }
}

const fail = (code: StudioProjectReferenceApprovalErrorCodeV2): never => {
  throw new StudioProjectReferenceApprovalErrorV2(code);
};

const ownValue = <T>(record: Record<string, T>, key: string): T | undefined =>
  Object.hasOwn(record, key) ? record[key] : undefined;

const canonicalTimestamp = (value: string): boolean => {
  if (typeof value !== 'string' || value.length !== 24) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
};

const jobReferenceInputs = (job: StudioJobV2): readonly StudioGenerationReferenceInputSnapshot[] =>
  job.requestSnapshot?.referenceInputs ??
  (job.requestPlan.kind === 'resolved'
    ? job.requestPlan.snapshot.referenceInputs
    : job.requestPlan.template.referenceInputs);

/**
 * Applies one explicit candidate approval to an isolated project copy.
 *
 * Candidate generation and approval remain separate authorities: this function never promotes a
 * pending output, never clears the selected approval during regeneration, and appends a replaced
 * approval to immutable history only after proving the exact succeeded candidate job.
 */
export const approveStudioProjectReferenceV2 = (input: {
  project: StudioProjectV2;
  referenceId: string;
  candidateAssetId: string;
  approvedAt: string;
}): StudioProjectV2 => {
  if (
    !SAFE_ID.test(input.referenceId) ||
    !SAFE_ID.test(input.candidateAssetId) ||
    !canonicalTimestamp(input.approvedAt)
  ) {
    return fail('invalid_authority');
  }

  let project: StudioProjectV2;
  try {
    project = structuredClone(input.project);
  } catch {
    return fail('invalid_authority');
  }
  const reference = ownValue(project.references, input.referenceId);
  const candidateJob =
    reference?.candidateJobId === null || reference === undefined
      ? undefined
      : ownValue(project.jobs, reference.candidateJobId);
  const candidateAsset = ownValue(project.assets, input.candidateAssetId);
  const candidateShot = candidateJob === undefined ? undefined : ownValue(project.shots, candidateJob.shotId);
  if (
    reference === undefined ||
    reference.candidateAssetId !== input.candidateAssetId ||
    candidateJob === undefined ||
    candidateJob.projectReferenceId !== reference.id ||
    candidateJob.purpose !== 'seed_still' ||
    candidateJob.status !== 'succeeded' ||
    candidateJob.outputAssetIdsByRole.primary !== input.candidateAssetId ||
    !candidateJob.outputAssetIds.includes(input.candidateAssetId) ||
    candidateAsset === undefined ||
    candidateAsset.projectId !== project.id ||
    candidateAsset.shotId !== candidateJob.shotId ||
    candidateAsset.mediaKind !== 'image' ||
    candidateAsset.managedAsset.collection !== 'assets' ||
    candidateShot === undefined ||
    !candidateShot.jobIds.includes(candidateJob.id) ||
    !candidateShot.assetIds.includes(candidateAsset.id) ||
    reference.supersededAssetIds.includes(input.candidateAssetId) ||
    reference.approvedAssetId === input.candidateAssetId
  ) {
    return fail('invalid_authority');
  }

  const previousApprovedAssetId = reference.approvedAssetId;
  if (
    previousApprovedAssetId !== null &&
    Object.values(project.jobs).some(
      (job) =>
        NONTERMINAL_JOB_STATUSES.has(job.status) &&
        jobReferenceInputs(job).some((entry) => entry.assetId === previousApprovedAssetId)
    )
  ) {
    return fail('approved_asset_busy');
  }

  if (
    previousApprovedAssetId !== null &&
    previousApprovedAssetId !== input.candidateAssetId &&
    !reference.supersededAssetIds.includes(previousApprovedAssetId)
  ) {
    reference.supersededAssetIds.push(previousApprovedAssetId);
  }
  reference.approvedAssetId = input.candidateAssetId;
  reference.updatedAt = input.approvedAt;
  return project;
};
