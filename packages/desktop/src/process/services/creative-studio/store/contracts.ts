/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { promises as nodeFs } from 'node:fs';
import type {
  CreateStudioProjectInputV2,
  StudioConnectionBinding,
  StudioMutationBatchV2,
  StudioMutationReducerContextV2,
  StudioProjectListResultV2,
  StudioProjectV2,
  StudioProposalRecordV2,
  StudioRecordProposalInputV2,
  StudioProposalV2,
  StudioReferenceGenerationHandoffReceiptV2,
  StudioReferenceRequestDecisionV2,
  StudioReferenceRequestV2,
} from '@/common/types/project/creativeStudioTypes';
import type { StudioMutationApplyResultV2 } from '../service/schema2';

type StoreErrorCode =
  | 'invalid_payload'
  | 'not_found'
  | 'stale_project'
  | 'stale_export_catalog'
  | 'busy'
  | 'storage_error'
  | 'unsupported_prototype_schema';

export class CreativeStudioStoreError extends Error {
  readonly code: StoreErrorCode;

  constructor(code: StoreErrorCode, message: string) {
    super(message);
    this.name = 'CreativeStudioStoreError';
    this.code = code;
  }
}

export class StudioProjectConfirmationError extends Error {
  readonly code = 'expired_confirmation' as const;

  constructor(message: string) {
    super(message);
    this.name = 'StudioProjectConfirmationError';
  }
}

export type StudioProjectCommitFacts = Readonly<{
  projectId: string;
  previousRevision: number;
  committedRevision: number;
  committedAt: string;
  commitTag: string | null;
}>;

export type StudioProjectCommitObserver = (facts: StudioProjectCommitFacts) => void;

export type StudioProjectStoreLoadResultV2 =
  | { status: 'supported'; project: StudioProjectV2 }
  | { status: 'unsupported_prototype_schema'; projectId: string }
  | { status: 'not_found'; projectId: string };

export type StudioDeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly (infer Item)[]
    ? readonly StudioDeepReadonly<Item>[]
    : T extends object
      ? { readonly [Key in keyof T]: StudioDeepReadonly<T[Key]> }
      : T;

export type StudioReadonlyProjectV2 = StudioDeepReadonly<StudioProjectV2>;

export type StudioProjectConfirmationCommitV2<TDispatch> = {
  project: StudioProjectV2;
  dispatch: TDispatch;
};

export type StudioProjectConfirmationInputV2<TRevalidation, TDispatch> = {
  projectId: string;
  expectedRevision: number;
  expiresAt: string;
  revalidate: (project: StudioReadonlyProjectV2) => Promise<TRevalidation>;
  assertActive: () => void;
  buildCommit: (
    project: StudioProjectV2,
    revalidation: StudioDeepReadonly<TRevalidation>,
    confirmedAt: string
  ) => StudioProjectConfirmationCommitV2<TDispatch>;
  commitTag?: string;
};

export type StudioProjectConfirmationResultV2<TDispatch> = {
  project: StudioProjectV2;
  dispatch: StudioDeepReadonly<TDispatch>;
};

export type StudioReferenceGenerationHandoffConfirmationInputV2<TRevalidation, TDispatch> =
  StudioProjectConfirmationInputV2<TRevalidation, TDispatch> & {
    handoffId: string;
  };

export type StudioPaidRecoveryProposalConfirmationInputV2<TRevalidation, TDispatch> = StudioProjectConfirmationInputV2<
  TRevalidation,
  TDispatch
> & {
  proposalId: string;
  authorizationId: string;
};

export type StudioProjectInventoryV2 = {
  supportedProjectIds: string[];
  unsupportedProjectIds: string[];
  quarantinedProjectIds: string[];
};

export type StudioProposalAcceptanceResultV2 = {
  proposal: StudioProposalV2;
  project: StudioProjectV2;
  applied: boolean;
};

export type StudioReferenceDecisionIntentV2 = { kind: 'rejected' } | { kind: 'generation_gate' };

export type StudioDecideReferenceRequestInputV2 = {
  projectId: string;
  requestId: string;
  expectedRevision: number;
  outcome: StudioReferenceDecisionIntentV2;
};

export type StudioReferenceRequestLedgerEntryV2 = {
  request: StudioReferenceRequestV2;
  decision: StudioReferenceRequestDecisionV2 | null;
  receipt: StudioReferenceGenerationHandoffReceiptV2 | null;
};

type StudioReferenceGenerationDecisionV2 = StudioReferenceRequestDecisionV2 & {
  outcome: Extract<StudioReferenceRequestDecisionV2['outcome'], { kind: 'generation_gate' }>;
};

export type StudioReferenceGenerationHandoffStoreV2 = {
  request: StudioReferenceRequestV2;
  decision: StudioReferenceGenerationDecisionV2;
  receipt: StudioReferenceGenerationHandoffReceiptV2 | null;
};

export type StudioRecordReferenceGenerationHandoffReceiptInputV2 = {
  projectId: string;
  handoffId: string;
  expectedRevision: number;
  result: { kind: 'dismissed' } | { kind: 'confirmed'; authorizationId: string };
};

/** Main-only snapshot exposed while the existing per-project mutation queue is held. */
export type StudioProjectAuthoritySnapshotV2 = {
  project: StudioProjectV2;
  projectDir: string;
  /** Re-proves the captured project directory and manifest immediately before a sidecar publication. */
  assertCurrent?: () => Promise<void>;
  /** Commits at most one project update while the existing project queue remains held. */
  commit(
    update: (project: StudioProjectV2) => StudioProjectV2,
    expectedRevision?: number,
    commitTag?: string,
    authorizeBeforeReplace?: () => void | Promise<void>
  ): Promise<StudioProjectV2>;
  /** Deletes this exact project while the existing project queue and any nested sidecar lock remain held. */
  delete(expectedRevision: number, authorizeBeforeDelete?: () => void | Promise<void>): Promise<boolean>;
};

/** Main-only deletion scope that can resume an exact durable deletion marker under the project queue. */
export type StudioProjectDeletionAuthoritySnapshotV2 = Pick<
  StudioProjectAuthoritySnapshotV2,
  'project' | 'projectDir' | 'assertCurrent' | 'delete'
>;

export type CreativeStudioStore = {
  inspectProjectsV2(): Promise<StudioProjectInventoryV2>;
  listProjectsV2(): Promise<StudioProjectListResultV2>;
  createProjectV2(input: CreateStudioProjectInputV2): Promise<StudioProjectV2>;
  getProjectV2(projectId: string): Promise<StudioProjectStoreLoadResultV2>;
  applyMutationBatchV2(
    batch: StudioMutationBatchV2,
    context: StudioMutationReducerContextV2,
    commitTag?: string
  ): Promise<StudioMutationApplyResultV2>;
  confirmProjectV2<TRevalidation, TDispatch>(
    input: StudioProjectConfirmationInputV2<TRevalidation, TDispatch>
  ): Promise<StudioProjectConfirmationResultV2<TDispatch>>;
  confirmReferenceGenerationHandoffV2<TRevalidation, TDispatch>(
    input: StudioReferenceGenerationHandoffConfirmationInputV2<TRevalidation, TDispatch>
  ): Promise<StudioProjectConfirmationResultV2<TDispatch>>;
  confirmPaidRecoveryProposalV2<TRevalidation, TDispatch>(
    input: StudioPaidRecoveryProposalConfirmationInputV2<TRevalidation, TDispatch>
  ): Promise<StudioProjectConfirmationResultV2<TDispatch>>;
  updateProjectV2(
    projectId: string,
    update: (project: StudioProjectV2) => StudioProjectV2,
    expectedRevision?: number,
    commitTag?: string
  ): Promise<StudioProjectV2>;
  withProjectAuthorityV2<T>(
    projectId: string,
    operation: (snapshot: StudioProjectAuthoritySnapshotV2) => Promise<T>
  ): Promise<T>;
  deleteProjectWithSidecarAuthorityV2(
    projectId: string,
    expectedRevision: number,
    operation: (snapshot: StudioProjectDeletionAuthoritySnapshotV2) => Promise<boolean>
  ): Promise<boolean>;
  deleteProjectV2(projectId: string, expectedRevision: number): Promise<boolean>;
  listProposalsV2(projectId: string): Promise<StudioProposalV2[]>;
  recordProposalV2(input: StudioRecordProposalInputV2): Promise<StudioProposalRecordV2>;
  acceptProposalV2(projectId: string, proposalId: string): Promise<StudioProposalAcceptanceResultV2>;
  rejectProposalV2(projectId: string, proposalId: string): Promise<StudioProposalV2>;
  reapAbandonedProposalsV2(): Promise<void>;
  watchProposalsV2(listener: (projectId: string, proposalId: string) => void): Promise<() => Promise<void>>;
  watchBriefsV2(listener: (projectId: string) => void): Promise<() => Promise<void>>;
  resolveProposalPathsV2(projectId: string): Promise<{ projectDir: string; pendingDir: string }>;
  listReferenceRequestsV2(projectId: string): Promise<StudioReferenceRequestLedgerEntryV2[]>;
  decideReferenceRequestV2(input: StudioDecideReferenceRequestInputV2): Promise<StudioReferenceRequestLedgerEntryV2>;
  readReferenceGenerationHandoffV2(
    projectId: string,
    handoffId: string
  ): Promise<StudioReferenceGenerationHandoffStoreV2 | null>;
  recordReferenceGenerationHandoffReceiptV2(
    input: StudioRecordReferenceGenerationHandoffReceiptInputV2
  ): Promise<StudioReferenceGenerationHandoffStoreV2>;
  reapAbandonedReferenceRequestsV2(): Promise<void>;
  watchReferenceRequestsV2(listener: (projectId: string, requestId: string) => void): Promise<() => Promise<void>>;
  resolveReferenceRequestPathsV2(projectId: string): Promise<{ projectDir: string; pendingDir: string }>;
  listConnections(): Promise<StudioConnectionBinding[]>;
  saveConnection(binding: StudioConnectionBinding): Promise<StudioConnectionBinding>;
  removeConnection(connectionId: string): Promise<boolean>;
  /** Main-process-only schema-2 path; classifies the manifest before returning a directory. */
  getVerifiedProjectDirectoryV2(projectId: string): Promise<string | null>;
};

export type CreativeStudioStoreDeps = {
  rootDir: string;
  now?: () => string;
  createId?: () => string;
  fs?: typeof nodeFs;
  onProjectCommitted?: StudioProjectCommitObserver;
  logError?: (message: string, error: unknown) => void;
  watchProposalTree?: (input: {
    rootDir: string;
    onChange: (relativeFile: string) => void;
    onError: (error: Error) => void;
  }) => { close(): void };
};
