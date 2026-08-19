/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { constants as fsConstants, promises as nodeFs } from 'node:fs';
import { watch as watchFileSystem } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import {
  isValidProviderJobId,
  isStudioSceneCountTransitionAllowed,
  STUDIO_PROJECT_SCHEMA_VERSION,
  STUDIO_PROPOSAL_V2_PENDING_TTL_MS,
  STUDIO_MAX_BEATS,
  STUDIO_MAX_SCENES,
  STUDIO_MAX_SHOTS_PER_PROJECT,
  STUDIO_REFERENCE_REQUEST_V2_MAX_PENDING_PER_PROJECT,
  STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
  STUDIO_REFERENCE_REQUEST_V2_PENDING_TTL_MS,
  STUDIO_REFERENCE_PROMPT_MAX_LENGTH,
  type CreateStudioProjectInput,
  type CreateStudioProjectInputV2,
  type StudioAsset,
  type StudioCancellationPolicy,
  type StudioConnectionBinding,
  type StudioCut,
  type StudioCutClip,
  type StudioCutFilter,
  type StudioJob,
  type StudioManagedAssetRef,
  type StudioMutationBatchV2,
  type StudioMutationOperationV2,
  type StudioMutationReducerContextV2,
  type StudioOutputRole,
  type StudioProject,
  type StudioProjectListResultV2,
  type StudioProjectSummary,
  type StudioProjectSummaryV2,
  type StudioProjectV2,
  type StudioProposal,
  type StudioProposalCommitAttributionV2,
  type StudioProposalDecisionV2,
  type StudioProposalPayload,
  type StudioProposalRecordV2,
  type StudioProposalSlotV2,
  type StudioProposalV2,
  type StudioReferenceRequest,
  type StudioReferenceRequestAuthority,
  type StudioReferenceGenerationHandoffReceiptV2,
  type StudioReferenceRequestDecisionV2,
  type StudioReferenceRequestSlotV2,
  type StudioReferenceRequestV2,
  type StudioRecordProposalInput,
  type StudioProviderRef,
  type StudioScene,
  type StudioTextModelRef,
} from '@/common/types/project/creativeStudioTypes';
import { hasRuleToken, STUDIO_RULE_LIMITS, type StudioBriefRule } from '@/common/types/project/creativeStudioRules';
import { isCanonicalStudioGeneratedTake } from '@/common/types/project/creativeStudioCanonicalTake';
import {
  isStudioBriefReferenceLabel,
  isStudioReferenceImageMimeType,
  resolveActiveStudioBriefReferences,
  STUDIO_MANAGED_ASSET_COLLECTIONS,
  STUDIO_MAX_ACTIVE_BRIEF_REFERENCES,
} from '@/common/types/project/creativeStudioManagedAssetCollections';
import { toStudioProjectSummary, toStudioProjectSummaryV2 } from '@/common/types/project/creativeStudioProjectSummary';
import {
  canonicalizeRecordRoot,
  publishImmutableRecord,
  readBoundedRegularFile,
  readBoundedRegularFileWithIdentity,
  RecordIoError,
  resolveCompleteDirectorySet,
  resolveConfinedRecordPath,
  resolveSafeRecordDirectory,
} from './service/recordIo';
import {
  parseStudioProposalDecisionV2,
  parseStudioProposalRecordV2,
  parseStudioProposalSlotV2,
  parseStudioReferenceGenerationHandoffReceiptV2,
  parseStudioReferenceRequestDecisionV2,
  parseStudioReferenceRequestSlotV2,
  parseStudioReferenceRequestV2,
} from './service/directorCommandContracts';
import {
  applyStudioMutationBatchV2,
  createEmptyStudioProjectV2,
  validateStudioProjectV2,
  type StudioMutationApplyResultV2,
} from './service/schema2';

const SAFE_ID = /^[A-Za-z0-9_-]+$/;
const STUDIO_PROJECT_V2_MAX_ID_LENGTH = 256;
const ASPECT_RATIOS = new Set(['16:9', '9:16', '1:1', '4:3', '3:4']);
const RESOLUTIONS = new Set(['720p', '1080p']);
const MEDIA_KINDS = new Set(['image', 'video']);
const REVIEW_STATES = new Set(['draft', 'ready', 'generating', 'complete', 'blocked']);
const JOB_STATUSES = new Set([
  'queued_local',
  'submitting',
  'queued_remote',
  'running',
  'needs_attention',
  'succeeded',
  'failed',
  'cancelled',
]);
const NONTERMINAL_JOB_STATUSES = new Set(['queued_local', 'submitting', 'queued_remote', 'running', 'needs_attention']);
const JOB_RETRY_REASONS = new Set(['provider_failure', 'submission_unknown']);
const CANCELLATION_POLICIES = new Set<StudioCancellationPolicy>(['none', 'queued_only', 'queued_and_running']);
const JOB_OUTPUT_ROLES = new Set<StudioOutputRole>(['take', 'reference']);
const ADAPTER_IDS = new Set([
  'weprompt-image-v1',
  'byteplus-seedance-v1',
  'weprompt-media-gateway-v1',
  'openrouter-video-v1',
]);
const JOB_ERROR_CODES = new Set([
  'invalid_request',
  'auth',
  'quota',
  'rate_limited',
  'provider_unavailable',
  'timeout',
  'poll_deadline',
  'no_output',
  'submission_unknown',
  'download_failed',
  'unsupported',
  'unknown',
]);
const PROVIDER_REF_KEYS = new Set(['providerId', 'adapterId', 'model']);
const ROUTING_KEYS = new Set(['storyboard', 'image', 'video']);
const TEXT_MODEL_REF_KEYS = new Set(['providerId', 'model']);
const JOB_ERROR_KEYS = new Set(['code', 'messageKey']);
const REFERENCE_INPUT_SNAPSHOT_KEYS = new Set([
  'sourceVisualPrompt',
  'conditioningReferenceAssetIds',
  'aspectRatio',
  'resolution',
]);
const SCENE_KEYS = new Set([
  'id',
  'title',
  'purpose',
  'visualPrompt',
  'narration',
  'onScreenText',
  'mediaKind',
  'durationSeconds',
  'referenceAssetId',
  'selectedAssetId',
  'assetIds',
  'jobIds',
  'reviewState',
]);
const ASSET_KEYS = new Set([
  'id',
  'projectId',
  'sceneId',
  'mediaKind',
  'mimeType',
  'managedAsset',
  'byteSize',
  'sha256',
  'width',
  'height',
  'durationSeconds',
  'createdAt',
  'briefReferenceRole',
  'briefReferenceLabel',
  'sourceVisualPrompt',
  'sourceReferenceAssetIds',
  'sourceAspectRatio',
  'sourceResolution',
]);
const MANAGED_ASSET_KEYS = new Set(['collection', 'fileName']);
const CUT_KEYS = new Set(['id', 'name', 'orderMode', 'clipOrder', 'clips']);
const CUT_CLIP_KEYS = new Set(['id', 'sceneId', 'assetId', 'sourceInSeconds', 'sourceOutSeconds', 'crop', 'filters']);
const NORMALISED_RECT_KEYS = new Set(['x', 'y', 'width', 'height']);
const CUT_FILTER_KEYS = new Set(['id', 'amount']);
const CUT_FILTER_IDS = new Set(['exposure', 'contrast', 'saturation', 'temperature']);
const JOB_KEYS = new Set([
  'id',
  'projectId',
  'sceneId',
  'status',
  'provider',
  'idempotencyKey',
  'providerJobId',
  'remoteStartedAt',
  'cancellationPolicy',
  'outputRole',
  'referenceInputSnapshot',
  'outputAssetIds',
  'error',
  'progress',
  'retryOfJobId',
  'retryReason',
  'duplicateChargeAcknowledged',
  'duplicateChargeAcknowledgedAt',
  'createdAt',
  'updatedAt',
]);
const CONNECTION_BINDING_KEYS = new Set([
  'schemaVersion',
  'id',
  'providerId',
  'adapterId',
  'model',
  'capabilities',
  'validatedAt',
]);
const CONNECTION_MANIFEST_KEYS = new Set(['schemaVersion', 'connections']);
const CONNECTION_CAPABILITY_KEYS = new Set([
  'mediaKinds',
  'audioModes',
  'aspectRatios',
  'resolutions',
  'minDurationSeconds',
  'maxDurationSeconds',
  'supportsFirstFrame',
  'maxConditioningImages',
  'cancellationPolicy',
]);
const FORBIDDEN_CONNECTION_KEY_FRAGMENTS = [
  'authorization',
  'credential',
  'token',
  'secret',
  'key',
  'url',
  'uri',
  'path',
  'base64',
  'bytes',
  'raw',
  'metadata',
] as const;
const FORBIDDEN_RENDERER_FIELDS = new Set([
  'path',
  'filepath',
  'sourcepath',
  'destinationpath',
  'url',
  'signedurl',
  'apikey',
  'credential',
  'credentials',
  'authorization',
  'bytes',
  'base64',
]);
const PROPOSAL_RECORD_KEYS = new Set([
  'schemaVersion',
  'id',
  'projectId',
  'status',
  'baseRevision',
  'payload',
  'createdAt',
  'decidedAt',
]);
const PROPOSAL_STORYBOARD_PAYLOAD_KEYS = new Set(['kind', 'sceneOrder', 'scenes']);
const PROPOSAL_PIN_RULE_PAYLOAD_KEYS = new Set(['kind', 'rule']);
const PROPOSAL_RULE_KEYS = new Set(['text', 'predicate']);
const PROPOSAL_SCENE_KEYS = new Set([
  'title',
  'purpose',
  'visualPrompt',
  'narration',
  'onScreenText',
  'mediaKind',
  'durationSeconds',
  'referenceAssetId',
]);
const BRIEF_RULE_KEYS = new Set(['id', 'scope', 'text', 'predicate', 'createdAt']);
const BRIEF_RULE_PREDICATE_KEYS = new Set(['kind', 'terms']);
const RULE_LIST_UNDO_KEYS = new Set(['capturedRevision', 'previousRules']);
const PROPOSAL_DECISION_KEYS = new Set(['schemaVersion', 'proposalId', 'status', 'decidedAt']);
const PROPOSAL_SLOT_KEYS = new Set(['schemaVersion', 'proposalId', 'reservedAt']);
const REFERENCE_REQUEST_SLOT_KEYS = new Set(['schemaVersion', 'requestId', 'reservedAt']);
const PROPOSAL_DECISION_STATUSES = new Set(['accepted', 'rejected', 'expired']);
const REFERENCE_REQUEST_RECORD_KEYS = new Set(['schemaVersion', 'id', 'projectId', 'sceneId', 'status', 'createdAt']);
const PROPOSAL_COMMIT_ATTRIBUTION_KEYS = new Set([
  'schemaVersion',
  'proposalId',
  'projectId',
  'baseRevision',
  'appliedRevision',
  'beforeProjectSha256',
  'afterProjectSha256',
  'createdBeatIds',
  'createdShotIds',
  'decidedAt',
]);
const LOWERCASE_SHA256 = /^[a-f0-9]{64}$/;
const PROJECT_DELETION_MARKER_KEYS = new Set([
  'schemaVersion',
  'projectId',
  'expectedRevision',
  'directoryDev',
  'directoryIno',
  'projectSha256',
]);
const PROPOSAL_V2_DIRECTORY_NAMES = ['pending', 'decisions', 'slots', 'commits'] as const;
const PROPOSAL_V2_COMMIT_FILE_SUFFIX = '.json';
const IDENTITY_BOUND_CLEANUP_PATTERN = /^(.*)\.(0|[1-9]\d*)_(0|[1-9]\d*)_([a-f0-9]{64})\.cleanup$/;
const REFERENCE_REQUEST_V2_DIRECTORY_NAMES = ['pending', 'decisions', 'slots', 'receipts'] as const;
const REFERENCE_DECIDE_INPUT_KEYS = new Set(['projectId', 'requestId', 'expectedRevision', 'outcome']);
const REFERENCE_REJECTED_INTENT_KEYS = new Set(['kind']);
const REFERENCE_IMPORTED_INTENT_KEYS = new Set(['kind', 'assetId']);
const REFERENCE_RECEIPT_INPUT_KEYS = new Set(['projectId', 'handoffId', 'expectedRevision', 'result']);
const REFERENCE_DISMISSED_RESULT_KEYS = new Set(['kind']);
const REFERENCE_CONFIRMED_RESULT_KEYS = new Set(['kind', 'authorizationId']);

export const STUDIO_PROPOSAL_MAX_RECORD_BYTES = 256 * 1024;
export const STUDIO_PROPOSAL_MAX_PENDING_PER_PROJECT = 50;
export const STUDIO_PROPOSAL_PENDING_TTL_MS = STUDIO_PROPOSAL_V2_PENDING_TTL_MS;
export const STUDIO_PROJECT_V2_MAX_RECORD_BYTES = 64 * 1024 * 1024;
const STUDIO_PROJECT_SCHEMA_SNIFF_CHUNK_BYTES = 64 * 1024;
const STUDIO_PROJECT_SCHEMA_SNIFF_TOKEN_BYTES = 128;
const STUDIO_PROPOSAL_STALE_SLOT_MS = 60 * 1_000;

const isCanonicalV2SlotFileName = (value: string, capacity: number): boolean => {
  const match = /^(0|[1-9]\d*)\.slot$/.exec(value);
  if (match?.[1] === undefined) return false;
  const index = Number(match[1]);
  return Number.isSafeInteger(index) && index >= 0 && index < capacity;
};

let temporaryFileCounter = 0;

type StoreErrorCode =
  | 'invalid_payload'
  | 'not_found'
  | 'stale_project'
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

export type StudioReferenceRequestDismissAuthority = {
  expectedRevision: number;
  expectedRequests: StudioReferenceRequestAuthority[];
};

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

export type StudioReferenceDecisionIntentV2 =
  | { kind: 'rejected' }
  | { kind: 'imported_reference'; assetId: string }
  | { kind: 'generation_gate' };

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

export type CreativeStudioStore = {
  listProjects(): Promise<StudioProjectSummary[]>;
  listQuarantinedProjectIds(): Promise<string[]>;
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
  updateProjectV2(
    projectId: string,
    update: (project: StudioProjectV2) => StudioProjectV2,
    expectedRevision?: number,
    commitTag?: string
  ): Promise<StudioProjectV2>;
  deleteProjectV2(projectId: string, expectedRevision: number): Promise<boolean>;
  listProposalsV2(projectId: string): Promise<StudioProposalV2[]>;
  acceptProposalV2(projectId: string, proposalId: string): Promise<StudioProposalAcceptanceResultV2>;
  rejectProposalV2(projectId: string, proposalId: string): Promise<StudioProposalV2>;
  reapAbandonedProposalsV2(): Promise<void>;
  watchProposalsV2(listener: (projectId: string, proposalId: string) => void): Promise<() => Promise<void>>;
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
  createProject(input: CreateStudioProjectInput): Promise<StudioProject>;
  getProject(projectId: string): Promise<StudioProject | null>;
  updateProject(
    projectId: string,
    update: (project: StudioProject) => StudioProject,
    expectedRevision?: number,
    commitTag?: string
  ): Promise<StudioProject>;
  deleteProject(projectId: string, expectedRevision: number): Promise<boolean>;
  listConnections(): Promise<StudioConnectionBinding[]>;
  saveConnection(binding: StudioConnectionBinding): Promise<StudioConnectionBinding>;
  removeConnection(connectionId: string): Promise<boolean>;
  recordProposal(input: StudioRecordProposalInput): Promise<StudioProposal>;
  listProposals(projectId: string): Promise<StudioProposal[]>;
  listPendingReferenceRequests(projectId: string): Promise<StudioReferenceRequest[]>;
  dismissReferenceRequests(
    projectId: string,
    requestIds: string[],
    authority?: StudioReferenceRequestDismissAuthority
  ): Promise<void>;
  acceptProposal(
    projectId: string,
    proposalId: string,
    update: (project: StudioProject, payload: StudioProposalPayload) => StudioProject
  ): Promise<{ proposal: StudioProposal; project: StudioProject; applied: boolean }>;
  rejectProposal(projectId: string, proposalId: string): Promise<StudioProposal>;
  reapAbandonedProposals(): Promise<void>;
  watchProposals(listener: (projectId: string, proposalId: string) => void): Promise<() => Promise<void>>;
  resolveProposalPaths(
    projectId: string
  ): Promise<{ projectDir: string; pendingDir: string; referencePendingDir: string }>;
  /** Main-process-only canonical project path; never return this through IPC. */
  getVerifiedProjectDirectory(projectId: string): Promise<string | null>;
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

type ProjectListingSweep = {
  projects: StudioProjectSummary[];
  quarantinedProjectIds: string[];
};

type ProjectListingSweepV2 = {
  supportedProjectIds: string[];
  summaries: StudioProjectSummaryV2[];
  unsupportedProjectIds: string[];
  quarantinedProjectIds: string[];
};

type ProjectFileInspectionV2 =
  | {
      status: 'supported';
      project: StudioProjectV2;
      bytes: string;
      identity: FileIdentityV2;
      directory: DirectoryAuthorityV2;
    }
  | { status: 'unsupported_prototype_schema'; projectId: string }
  | { status: 'not_found'; projectId: string }
  | { status: 'malformed_v2'; projectId: string; error: CreativeStudioStoreError };

type JsonRecord = Record<string, unknown>;

type FileIdentityV2 = { dev: number; ino: number };

type DirectoryAuthorityV2 = FileIdentityV2 & { path: string };

type ProjectDeletionMarkerV2 = {
  schemaVersion: 2;
  projectId: string;
  expectedRevision: number;
  directoryDev: number;
  directoryIno: number;
  projectSha256: string;
};

type ProposalDirectoriesV2 = {
  root: DirectoryAuthorityV2;
  pending: DirectoryAuthorityV2;
  decisions: DirectoryAuthorityV2;
  slots: DirectoryAuthorityV2;
  commits: DirectoryAuthorityV2;
  project: DirectoryAuthorityV2;
};

type IdentifiedRecordV2<RecordType> = {
  file: string;
  bytes: string;
  identity: FileIdentityV2;
  record: RecordType;
  quarantined: boolean;
};

type ProposalLedgerV2 = {
  directories: ProposalDirectoriesV2;
  proposals: Map<string, IdentifiedRecordV2<StudioProposalRecordV2>>;
  decisions: Map<string, IdentifiedRecordV2<StudioProposalDecisionV2>>;
  slots: Map<string, IdentifiedRecordV2<StudioProposalSlotV2>[]>;
  attributions: IdentifiedRecordV2<StudioProposalCommitAttributionV2>[];
  journalResidues: Array<
    | {
        family: 'decisions';
        identified: IdentifiedRecordV2<StudioProposalDecisionV2>;
        namedFile: string;
        effective: boolean;
      }
    | {
        family: 'commits';
        identified: IdentifiedRecordV2<StudioProposalCommitAttributionV2>;
        namedFile: string;
        effective: boolean;
      }
  >;
  writerResidues: Array<{
    family: 'pending' | 'slots';
    identified: IdentifiedRecordV2<null>;
    namedFile: string;
    phase: 'tmp' | 'ready' | 'cleanup';
    effective: boolean;
  }>;
};

type ReferenceRequestDirectoriesV2 = {
  root: DirectoryAuthorityV2;
  pending: DirectoryAuthorityV2;
  decisions: DirectoryAuthorityV2;
  slots: DirectoryAuthorityV2;
  receipts: DirectoryAuthorityV2;
  project: DirectoryAuthorityV2;
};

type ReferenceRequestLedgerV2 = {
  directories: ReferenceRequestDirectoriesV2;
  requests: Map<string, IdentifiedRecordV2<StudioReferenceRequestV2>>;
  decisions: Map<string, IdentifiedRecordV2<StudioReferenceRequestDecisionV2>>;
  slots: Map<string, IdentifiedRecordV2<StudioReferenceRequestSlotV2>[]>;
  receipts: Map<string, IdentifiedRecordV2<StudioReferenceGenerationHandoffReceiptV2>>;
  generationDecisions: Map<string, IdentifiedRecordV2<StudioReferenceRequestDecisionV2>>;
  journalResidues: Array<
    | {
        family: 'decisions';
        identified: IdentifiedRecordV2<StudioReferenceRequestDecisionV2>;
        namedFile: string;
        effective: boolean;
      }
    | {
        family: 'receipts';
        identified: IdentifiedRecordV2<StudioReferenceGenerationHandoffReceiptV2>;
        namedFile: string;
        effective: boolean;
      }
  >;
  writerResidues: Array<{
    family: 'pending' | 'slots';
    identified: IdentifiedRecordV2<null>;
    namedFile: string;
    phase: 'tmp' | 'ready' | 'cleanup';
    effective: boolean;
  }>;
};

type StudioProposalDecision = {
  schemaVersion: 1;
  proposalId: string;
  status: Exclude<StudioProposal['status'], 'pending'>;
  decidedAt: string;
};

type StudioProposalSlot = {
  schemaVersion: 1;
  proposalId: string;
  reservedAt: string;
};

type StudioReferenceRequestSlot = {
  schemaVersion: 1;
  requestId: string;
  reservedAt: string;
};

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const containsForbiddenRendererField = (value: unknown): boolean => {
  if (Array.isArray(value)) return value.some(containsForbiddenRendererField);
  if (!isRecord(value)) return false;
  return Object.entries(value).some(
    ([key, nestedValue]) =>
      FORBIDDEN_RENDERER_FIELDS.has(key.toLowerCase()) || containsForbiddenRendererField(nestedValue)
  );
};

const normalizeConnectionFieldKey = (key: string): string =>
  key
    .normalize('NFKC')
    .replaceAll(/[^A-Za-z0-9]/g, '')
    .toLowerCase();

const containsForbiddenConnectionField = (value: unknown): boolean => {
  if (Array.isArray(value)) return value.some(containsForbiddenConnectionField);
  if (!isRecord(value)) return false;
  return Object.entries(value).some(([key, nestedValue]) => {
    const normalized = normalizeConnectionFieldKey(key);
    return (
      FORBIDDEN_CONNECTION_KEY_FRAGMENTS.some((fragment) => normalized.includes(fragment)) ||
      containsForbiddenConnectionField(nestedValue)
    );
  });
};

const isSafeId = (value: unknown): value is string => typeof value === 'string' && SAFE_ID.test(value);
const isSafeIdV2 = (value: unknown): value is string =>
  isSafeId(value) && value.length <= STUDIO_PROJECT_V2_MAX_ID_LENGTH;
const isSafeProposalId = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= 256 && SAFE_ID.test(value);
const isSafeConnectionId = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= 256 && SAFE_ID.test(value);

const isIntegerInRange = (value: unknown, minimum: number, maximum: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= minimum && value <= maximum;

const isFiniteInRange = (value: unknown, minimum: number, maximum: number): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum;

const isString = (value: unknown): value is string => typeof value === 'string';

const isNonEmptyString = (value: unknown): value is string => isString(value) && value.trim().length > 0;

const isSafeConnectionModel = (value: unknown): value is string => {
  if (!isString(value) || value.length === 0 || value.length > 256 || value !== value.trim()) return false;
  return !value.split('').some((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || (code >= 0x7f && code <= 0x9f);
  });
};

const isSafeModel = isSafeConnectionModel;

const isCanonicalIsoTimestamp = (value: unknown): value is string => {
  if (!isString(value) || value.length !== 24) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
};

const isStudioMutationReducerContextV2 = (value: unknown): value is StudioMutationReducerContextV2 => {
  if (!isRecord(value)) return false;
  const keys = Reflect.ownKeys(value);
  return (
    keys.length === 2 &&
    keys.every((key) => key === 'mutationId' || key === 'capturedAt') &&
    isSafeIdV2(value.mutationId) &&
    isCanonicalIsoTimestamp(value.capturedAt)
  );
};

const cloneConfirmationValue = <T>(value: T, label: string): T => {
  try {
    return structuredClone(value);
  } catch {
    throw new CreativeStudioStoreError('invalid_payload', `${label} must be structured-cloneable`);
  }
};

const deepFreezeConfirmationValue = <T>(value: T, label: string): StudioDeepReadonly<T> => {
  const pending: object[] = [];
  const seen = new WeakSet<object>();
  if ((typeof value === 'object' && value !== null) || typeof value === 'function') pending.push(value as object);

  while (pending.length > 0) {
    const current = pending.pop()!;
    if (seen.has(current)) continue;
    seen.add(current);

    const isArray = Array.isArray(current);
    const prototype = Reflect.getPrototypeOf(current);
    if (
      (!isArray && prototype !== Object.prototype && prototype !== null) ||
      (isArray && prototype !== Array.prototype)
    ) {
      throw new CreativeStudioStoreError('invalid_payload', `${label} must contain only plain data`);
    }
    for (const key of Reflect.ownKeys(current)) {
      const descriptor = Reflect.getOwnPropertyDescriptor(current, key);
      if (descriptor === undefined || !Object.hasOwn(descriptor, 'value')) {
        throw new CreativeStudioStoreError('invalid_payload', `${label} must contain only data properties`);
      }
      const child = descriptor.value as unknown;
      if ((typeof child === 'object' && child !== null) || typeof child === 'function') pending.push(child as object);
    }
    Object.freeze(current);
  }

  return value as StudioDeepReadonly<T>;
};

const cloneAndFreezeConfirmationValue = <T>(value: T, label: string): StudioDeepReadonly<T> =>
  deepFreezeConfirmationValue(cloneConfirmationValue(value, label), label);

const assertSynchronousConfirmationResult = (value: unknown, label: string): void => {
  if ((typeof value !== 'object' || value === null) && typeof value !== 'function') return;
  let then: unknown;
  try {
    then = Reflect.get(value, 'then');
  } catch {
    throw new CreativeStudioStoreError('invalid_payload', `${label} must return synchronously`);
  }
  if (typeof then === 'function') {
    throw new CreativeStudioStoreError('invalid_payload', `${label} must return synchronously`);
  }
};

const isSafeAssetFileName = (value: unknown): value is string =>
  isNonEmptyString(value) && value !== '.' && value !== '..' && !value.includes('/') && !value.includes('\\');

const asArrayOfSafeIds = (value: unknown): value is string[] => Array.isArray(value) && value.every(isSafeId);

const hasExactKeys = (value: Record<string, unknown>, keys: ReadonlySet<string>): boolean => {
  const ownKeys = Reflect.ownKeys(value);
  return (
    ownKeys.length === keys.size &&
    ownKeys.every((key) =>
      typeof key === 'string'
        ? keys.has(key) && Object.hasOwn(Reflect.getOwnPropertyDescriptor(value, key) ?? {}, 'value')
        : false
    )
  );
};

const validateProposalScene = (value: unknown): boolean =>
  isRecord(value) &&
  hasExactKeys(value, PROPOSAL_SCENE_KEYS) &&
  isString(value.title) &&
  value.title.length <= 256 &&
  isString(value.purpose) &&
  value.purpose.length <= 256 &&
  isString(value.visualPrompt) &&
  value.visualPrompt.length <= 8 * 1024 &&
  isString(value.narration) &&
  value.narration.length <= 4 * 1024 &&
  isString(value.onScreenText) &&
  value.onScreenText.length <= 1024 &&
  isString(value.mediaKind) &&
  MEDIA_KINDS.has(value.mediaKind) &&
  isIntegerInRange(value.durationSeconds, 1, 60) &&
  (value.referenceAssetId === null || isSafeId(value.referenceAssetId));

const validateBriefRulePredicate = (value: unknown): boolean =>
  value === null ||
  (isRecord(value) &&
    hasExactKeys(value, BRIEF_RULE_PREDICATE_KEYS) &&
    value.kind === 'forbidden_terms' &&
    Array.isArray(value.terms) &&
    value.terms.length > 0 &&
    value.terms.length <= STUDIO_RULE_LIMITS.maxTerms &&
    value.terms.every((term) => isNonEmptyString(term) && term.length <= STUDIO_RULE_LIMITS.term) &&
    new Set(value.terms).size === value.terms.length);

const validateStoredBriefRulePredicate = (value: unknown): boolean =>
  validateBriefRulePredicate(value) &&
  (value === null ||
    (isRecord(value) && Array.isArray(value.terms) && value.terms.every((term) => hasRuleToken(String(term)))));

/**
 * A rule on the project record is always project-scoped. The organisation layer is code-resident
 * (ORGANISATION_STUDIO_RULES) and is refused here on purpose: a locked rule cached on disk could be
 * edited out of the file by hand, which is exactly what "locked" must not mean.
 */
const validateBriefRule = (value: unknown): value is StudioBriefRule =>
  isRecord(value) &&
  hasExactKeys(value, BRIEF_RULE_KEYS) &&
  isSafeId(value.id) &&
  value.scope === 'project' &&
  isNonEmptyString(value.text) &&
  value.text.length <= STUDIO_RULE_LIMITS.text &&
  validateStoredBriefRulePredicate(value.predicate) &&
  isCanonicalIsoTimestamp(value.createdAt);

const validateBriefRules = (value: unknown): value is StudioBriefRule[] =>
  Array.isArray(value) &&
  value.length <= STUDIO_RULE_LIMITS.maxRules &&
  value.every(validateBriefRule) &&
  new Set(value.map((rule) => (rule as StudioBriefRule).id)).size === value.length;

const validateRuleListUndo = (value: unknown): boolean =>
  value === null ||
  (isRecord(value) &&
    hasExactKeys(value, RULE_LIST_UNDO_KEYS) &&
    isIntegerInRange(value.capturedRevision, 1, Number.MAX_SAFE_INTEGER) &&
    validateBriefRules(value.previousRules));

const validateStoryboardProposalPayload = (value: Record<string, unknown>): boolean => {
  if (!isRecord(value.scenes) || !hasExactKeys(value, PROPOSAL_STORYBOARD_PAYLOAD_KEYS)) return false;
  const scenes = value.scenes;
  const sceneOrder = value.sceneOrder;
  if (!asArrayOfSafeIds(sceneOrder)) return false;
  const sceneIds = Object.keys(scenes);
  return (
    sceneOrder.length > 0 &&
    sceneOrder.length <= STUDIO_MAX_SCENES &&
    new Set(sceneOrder).size === sceneOrder.length &&
    sceneIds.length === sceneOrder.length &&
    sceneIds.every((sceneId) => sceneOrder.includes(sceneId) && validateProposalScene(scenes[sceneId]))
  );
};

const validatePinRuleProposalPayload = (value: Record<string, unknown>): boolean =>
  hasExactKeys(value, PROPOSAL_PIN_RULE_PAYLOAD_KEYS) &&
  isRecord(value.rule) &&
  hasExactKeys(value.rule, PROPOSAL_RULE_KEYS) &&
  isNonEmptyString(value.rule.text) &&
  value.rule.text.length <= STUDIO_RULE_LIMITS.text &&
  validateBriefRulePredicate(value.rule.predicate);

const validateProposalPayload = (value: unknown): value is StudioProposalPayload => {
  if (!isRecord(value) || containsForbiddenRendererField(value)) return false;
  if (value.kind === 'replace_storyboard') return validateStoryboardProposalPayload(value);
  if (value.kind === 'pin_rule') return validatePinRuleProposalPayload(value);
  return false;
};

const validateProposalRecord = (projectId: string, proposalId: string, value: unknown): value is StudioProposal =>
  isRecord(value) &&
  hasExactKeys(value, PROPOSAL_RECORD_KEYS) &&
  value.schemaVersion === 1 &&
  value.id === proposalId &&
  isSafeProposalId(value.id) &&
  value.projectId === projectId &&
  value.status === 'pending' &&
  isIntegerInRange(value.baseRevision, 1, Number.MAX_SAFE_INTEGER) &&
  validateProposalPayload(value.payload) &&
  isCanonicalIsoTimestamp(value.createdAt) &&
  value.decidedAt === null;

const validateProposalDecision = (proposalId: string, value: unknown): value is StudioProposalDecision =>
  isRecord(value) &&
  hasExactKeys(value, PROPOSAL_DECISION_KEYS) &&
  value.schemaVersion === 1 &&
  value.proposalId === proposalId &&
  isSafeProposalId(value.proposalId) &&
  isString(value.status) &&
  PROPOSAL_DECISION_STATUSES.has(value.status) &&
  isCanonicalIsoTimestamp(value.decidedAt);

const validateProposalSlot = (value: unknown): value is StudioProposalSlot =>
  isRecord(value) &&
  hasExactKeys(value, PROPOSAL_SLOT_KEYS) &&
  value.schemaVersion === 1 &&
  isSafeProposalId(value.proposalId) &&
  isCanonicalIsoTimestamp(value.reservedAt);

const isUniqueSafeIdArrayV2 = (value: unknown, maximum: number): value is string[] =>
  Array.isArray(value) && value.length <= maximum && value.every(isSafeIdV2) && new Set(value).size === value.length;

const validateProposalCommitAttributionV2 = (
  projectId: string,
  proposalId: string,
  value: unknown
): value is StudioProposalCommitAttributionV2 =>
  isRecord(value) &&
  hasExactKeys(value, PROPOSAL_COMMIT_ATTRIBUTION_KEYS) &&
  value.schemaVersion === STUDIO_PROJECT_SCHEMA_VERSION &&
  value.proposalId === proposalId &&
  value.projectId === projectId &&
  isSafeProposalId(value.proposalId) &&
  isSafeIdV2(value.projectId) &&
  isIntegerInRange(value.baseRevision, 1, Number.MAX_SAFE_INTEGER - 1) &&
  value.appliedRevision === value.baseRevision + 1 &&
  typeof value.beforeProjectSha256 === 'string' &&
  LOWERCASE_SHA256.test(value.beforeProjectSha256) &&
  typeof value.afterProjectSha256 === 'string' &&
  LOWERCASE_SHA256.test(value.afterProjectSha256) &&
  isUniqueSafeIdArrayV2(value.createdBeatIds, STUDIO_MAX_BEATS) &&
  isUniqueSafeIdArrayV2(value.createdShotIds, STUDIO_MAX_SHOTS_PER_PROJECT) &&
  isCanonicalIsoTimestamp(value.decidedAt);

const sha256Utf8 = (bytes: string): string => createHash('sha256').update(bytes, 'utf8').digest('hex');

const identityBoundCleanupNameV2 = (identified: IdentifiedRecordV2<unknown>): string =>
  `${identified.file}.${identified.identity.dev}_${identified.identity.ino}_${sha256Utf8(identified.bytes)}.cleanup`;

const parseIdentityBoundCleanupNameV2 = (
  name: string
): { namedFileName: string; identity: FileIdentityV2; digest: string } | null => {
  const match = IDENTITY_BOUND_CLEANUP_PATTERN.exec(name);
  if (
    match === null ||
    match[1] === undefined ||
    match[2] === undefined ||
    match[3] === undefined ||
    match[4] === undefined
  ) {
    return null;
  }
  const dev = Number(match[2]);
  const ino = Number(match[3]);
  if (!Number.isSafeInteger(dev) || !Number.isSafeInteger(ino)) return null;
  return { namedFileName: match[1], identity: { dev, ino }, digest: match[4] };
};

const validateProjectDeletionMarkerV2 = (value: unknown): value is ProjectDeletionMarkerV2 =>
  isRecord(value) &&
  hasExactKeys(value, PROJECT_DELETION_MARKER_KEYS) &&
  value.schemaVersion === STUDIO_PROJECT_SCHEMA_VERSION &&
  isSafeIdV2(value.projectId) &&
  isIntegerInRange(value.expectedRevision, 1, Number.MAX_SAFE_INTEGER) &&
  isIntegerInRange(value.directoryDev, 0, Number.MAX_SAFE_INTEGER) &&
  isIntegerInRange(value.directoryIno, 0, Number.MAX_SAFE_INTEGER) &&
  typeof value.projectSha256 === 'string' &&
  LOWERCASE_SHA256.test(value.projectSha256);

const serializeJsonExact = (value: unknown): string => JSON.stringify(value, null, 2);

const validateReferenceRequestSlot = (value: unknown): value is StudioReferenceRequestSlot =>
  isRecord(value) &&
  hasExactKeys(value, REFERENCE_REQUEST_SLOT_KEYS) &&
  value.schemaVersion === 1 &&
  isSafeProposalId(value.requestId) &&
  isCanonicalIsoTimestamp(value.reservedAt);

const validateReferenceRequestRecord = (
  project: StudioProject,
  requestId: string,
  value: unknown
): value is StudioReferenceRequest =>
  isRecord(value) &&
  hasExactKeys(value, REFERENCE_REQUEST_RECORD_KEYS) &&
  value.schemaVersion === 1 &&
  value.id === requestId &&
  isSafeProposalId(value.id) &&
  value.projectId === project.id &&
  isSafeId(value.sceneId) &&
  project.scenes[value.sceneId] !== undefined &&
  value.status === 'pending' &&
  isCanonicalIsoTimestamp(value.createdAt);

const validateProviderRef = (value: unknown): value is StudioProviderRef =>
  isRecord(value) &&
  hasExactKeys(value, PROVIDER_REF_KEYS) &&
  isSafeId(value.providerId) &&
  isString(value.adapterId) &&
  ADAPTER_IDS.has(value.adapterId) &&
  isNonEmptyString(value.model);

const validateTextModelRef = (value: unknown): value is StudioTextModelRef =>
  isRecord(value) && hasExactKeys(value, TEXT_MODEL_REF_KEYS) && isSafeId(value.providerId) && isSafeModel(value.model);

const validateConnectionBinding = (value: unknown): value is StudioConnectionBinding => {
  if (!isRecord(value) || !isRecord(value.capabilities)) return false;
  const capabilities = value.capabilities;
  const mediaKinds = capabilities.mediaKinds;
  const validKinds =
    Array.isArray(mediaKinds) &&
    mediaKinds.length > 0 &&
    mediaKinds.length <= 2 &&
    mediaKinds.every((kind) => isString(kind) && MEDIA_KINDS.has(kind)) &&
    new Set(mediaKinds).size === mediaKinds.length;
  const optionalAudioModes =
    capabilities.audioModes === undefined ||
    (Array.isArray(capabilities.audioModes) &&
      capabilities.audioModes.length === 1 &&
      capabilities.audioModes[0] === 'none');
  const optionalAspectRatios =
    capabilities.aspectRatios === undefined ||
    (Array.isArray(capabilities.aspectRatios) &&
      capabilities.aspectRatios.length <= 5 &&
      capabilities.aspectRatios.every((ratio) => isString(ratio) && ASPECT_RATIOS.has(ratio)) &&
      new Set(capabilities.aspectRatios).size === capabilities.aspectRatios.length);
  const optionalResolutions =
    capabilities.resolutions === undefined ||
    (Array.isArray(capabilities.resolutions) &&
      capabilities.resolutions.length <= 2 &&
      capabilities.resolutions.every((resolution) => isString(resolution) && RESOLUTIONS.has(resolution)) &&
      new Set(capabilities.resolutions).size === capabilities.resolutions.length);
  const validAdapterCapabilities =
    value.adapterId === 'weprompt-image-v1'
      ? Array.isArray(mediaKinds) &&
        mediaKinds.length === 1 &&
        mediaKinds[0] === 'image' &&
        capabilities.audioModes === undefined
      : (value.adapterId === 'byteplus-seedance-v1' ||
          value.adapterId === 'weprompt-media-gateway-v1' ||
          value.adapterId === 'openrouter-video-v1') &&
        Array.isArray(mediaKinds) &&
        mediaKinds.length === 1 &&
        mediaKinds[0] === 'video' &&
        Array.isArray(capabilities.audioModes) &&
        capabilities.audioModes.length === 1 &&
        capabilities.audioModes[0] === 'none';
  return (
    Object.keys(value).length === CONNECTION_BINDING_KEYS.size &&
    Object.keys(value).every((key) => CONNECTION_BINDING_KEYS.has(key)) &&
    value.schemaVersion === 1 &&
    isSafeConnectionId(value.id) &&
    isSafeConnectionId(value.providerId) &&
    isString(value.adapterId) &&
    ADAPTER_IDS.has(value.adapterId) &&
    isSafeConnectionModel(value.model) &&
    Object.keys(capabilities).every((key) => CONNECTION_CAPABILITY_KEYS.has(key)) &&
    validKinds &&
    validAdapterCapabilities &&
    optionalAudioModes &&
    optionalAspectRatios &&
    optionalResolutions &&
    (capabilities.supportsFirstFrame === undefined || typeof capabilities.supportsFirstFrame === 'boolean') &&
    (capabilities.maxConditioningImages === undefined || isIntegerInRange(capabilities.maxConditioningImages, 0, 6)) &&
    isString(capabilities.cancellationPolicy) &&
    CANCELLATION_POLICIES.has(capabilities.cancellationPolicy as StudioCancellationPolicy) &&
    (capabilities.minDurationSeconds === undefined || isIntegerInRange(capabilities.minDurationSeconds, 1, 60)) &&
    (capabilities.maxDurationSeconds === undefined || isIntegerInRange(capabilities.maxDurationSeconds, 1, 60)) &&
    (capabilities.minDurationSeconds === undefined ||
      capabilities.maxDurationSeconds === undefined ||
      (capabilities.minDurationSeconds as number) <= (capabilities.maxDurationSeconds as number)) &&
    isCanonicalIsoTimestamp(value.validatedAt) &&
    !containsForbiddenConnectionField(value)
  );
};

const canonicalizeConnectionBinding = (value: unknown): StudioConnectionBinding | null => {
  if (!isRecord(value) || !isRecord(value.capabilities)) return null;
  const capabilities = value.capabilities;
  const hasPolicy = Object.hasOwn(capabilities, 'cancellationPolicy');
  const hasLegacy = Object.hasOwn(capabilities, 'cancellation');
  if (hasPolicy && hasLegacy) return null;

  let cancellationPolicy: StudioCancellationPolicy;
  if (hasPolicy) {
    if (!isString(capabilities.cancellationPolicy)) return null;
    cancellationPolicy = capabilities.cancellationPolicy as StudioCancellationPolicy;
    if (!CANCELLATION_POLICIES.has(cancellationPolicy)) return null;
  } else if (hasLegacy) {
    if (typeof capabilities.cancellation !== 'boolean') return null;
    cancellationPolicy = capabilities.cancellation ? 'queued_only' : 'none';
  } else {
    cancellationPolicy = 'none';
  }

  const { cancellation: _legacyCancellation, ...canonicalCapabilities } = capabilities;
  const candidate = {
    ...value,
    capabilities: { ...canonicalCapabilities, cancellationPolicy },
  };
  return validateConnectionBinding(candidate) ? candidate : null;
};

const validateScene = (sceneId: string, value: unknown): value is StudioScene => {
  if (!isRecord(value)) return false;
  return (
    Object.keys(value).length === SCENE_KEYS.size &&
    Object.keys(value).every((key) => SCENE_KEYS.has(key)) &&
    value.id === sceneId &&
    isSafeId(sceneId) &&
    isString(value.title) &&
    isString(value.purpose) &&
    isString(value.visualPrompt) &&
    isString(value.narration) &&
    isString(value.onScreenText) &&
    isString(value.mediaKind) &&
    MEDIA_KINDS.has(value.mediaKind) &&
    isIntegerInRange(value.durationSeconds, 1, 60) &&
    (value.referenceAssetId === null || isSafeId(value.referenceAssetId)) &&
    (value.selectedAssetId === null || isSafeId(value.selectedAssetId)) &&
    asArrayOfSafeIds(value.assetIds) &&
    new Set(value.assetIds).size === value.assetIds.length &&
    asArrayOfSafeIds(value.jobIds) &&
    new Set(value.jobIds).size === value.jobIds.length &&
    isString(value.reviewState) &&
    REVIEW_STATES.has(value.reviewState)
  );
};

const validateAsset = (
  assetId: string,
  projectId: string,
  sceneIds: Set<string>,
  value: unknown
): value is StudioAsset => {
  if (!isRecord(value) || !isRecord(value.managedAsset)) return false;
  const hasBriefReferenceRole = value.briefReferenceRole !== undefined;
  const hasBriefReferenceLabel = value.briefReferenceLabel !== undefined;
  const hasSourceReferenceAssetIds = value.sourceReferenceAssetIds !== undefined;
  const hasSourceAspectRatio = value.sourceAspectRatio !== undefined;
  const hasSourceResolution = value.sourceResolution !== undefined;
  const hasCompleteSourceProvenance = hasSourceReferenceAssetIds && hasSourceAspectRatio && hasSourceResolution;
  return (
    Object.keys(value).every((key) => ASSET_KEYS.has(key)) &&
    Object.keys(value.managedAsset).length === MANAGED_ASSET_KEYS.size &&
    Object.keys(value.managedAsset).every((key) => MANAGED_ASSET_KEYS.has(key)) &&
    value.id === assetId &&
    isSafeId(assetId) &&
    value.projectId === projectId &&
    (value.sceneId === null || (isSafeId(value.sceneId) && sceneIds.has(value.sceneId))) &&
    isString(value.mediaKind) &&
    MEDIA_KINDS.has(value.mediaKind) &&
    isNonEmptyString(value.mimeType) &&
    isString(value.managedAsset.collection) &&
    STUDIO_MANAGED_ASSET_COLLECTIONS.has(value.managedAsset.collection as StudioManagedAssetRef['collection']) &&
    isSafeAssetFileName(value.managedAsset.fileName) &&
    isIntegerInRange(value.byteSize, 0, Number.MAX_SAFE_INTEGER) &&
    isString(value.sha256) &&
    /^[a-f0-9]{64}$/i.test(value.sha256) &&
    (value.width === undefined || isIntegerInRange(value.width, 1, Number.MAX_SAFE_INTEGER)) &&
    (value.height === undefined || isIntegerInRange(value.height, 1, Number.MAX_SAFE_INTEGER)) &&
    (value.durationSeconds === undefined ||
      (isFiniteInRange(value.durationSeconds, 0, Number.MAX_SAFE_INTEGER) && value.durationSeconds > 0)) &&
    isNonEmptyString(value.createdAt) &&
    hasBriefReferenceRole === hasBriefReferenceLabel &&
    (!hasBriefReferenceRole ||
      ((value.briefReferenceRole === 'cast' || value.briefReferenceRole === 'look') &&
        isStudioBriefReferenceLabel(value.briefReferenceLabel) &&
        value.sceneId === null &&
        value.mediaKind === 'image' &&
        isStudioReferenceImageMimeType(value.mimeType) &&
        value.managedAsset.collection === 'imports')) &&
    (value.sourceVisualPrompt === undefined || isString(value.sourceVisualPrompt)) &&
    hasSourceReferenceAssetIds === hasSourceAspectRatio &&
    hasSourceAspectRatio === hasSourceResolution &&
    (!hasCompleteSourceProvenance ||
      (asArrayOfSafeIds(value.sourceReferenceAssetIds) &&
        value.sourceReferenceAssetIds.length <= STUDIO_MAX_ACTIVE_BRIEF_REFERENCES &&
        new Set(value.sourceReferenceAssetIds).size === value.sourceReferenceAssetIds.length &&
        isString(value.sourceAspectRatio) &&
        ASPECT_RATIOS.has(value.sourceAspectRatio) &&
        isString(value.sourceResolution) &&
        RESOLUTIONS.has(value.sourceResolution) &&
        value.sourceVisualPrompt !== undefined &&
        value.mediaKind === 'image' &&
        isStudioReferenceImageMimeType(value.mimeType) &&
        value.sceneId !== null &&
        value.managedAsset.collection === 'references'))
  );
};

const validateNormalisedRect = (value: unknown): boolean => {
  if (!isRecord(value) || !hasExactKeys(value, NORMALISED_RECT_KEYS)) return false;
  return (
    isFiniteInRange(value.x, 0, 1) &&
    isFiniteInRange(value.y, 0, 1) &&
    isFiniteInRange(value.width, 0, 1) &&
    value.width > 0 &&
    isFiniteInRange(value.height, 0, 1) &&
    value.height > 0 &&
    value.x + value.width <= 1 &&
    value.y + value.height <= 1
  );
};

const validateCutFilter = (value: unknown): value is StudioCutFilter =>
  isRecord(value) &&
  hasExactKeys(value, CUT_FILTER_KEYS) &&
  isString(value.id) &&
  CUT_FILTER_IDS.has(value.id) &&
  isFiniteInRange(value.amount, -1, 1);

const validateTrimPoint = (value: unknown): value is number | null =>
  value === null || isFiniteInRange(value, 0, Number.MAX_VALUE);

const validateCutClip = (
  clipId: string,
  projectId: string,
  scenes: Record<string, StudioScene>,
  assets: Record<string, StudioAsset>,
  value: unknown
): value is StudioCutClip => {
  if (!isRecord(value) || !hasExactKeys(value, CUT_CLIP_KEYS)) return false;
  const scene = isSafeId(value.sceneId) ? scenes[value.sceneId] : undefined;
  const asset = isSafeId(value.assetId) ? assets[value.assetId] : undefined;
  if (
    value.id !== clipId ||
    !isSafeId(clipId) ||
    scene === undefined ||
    asset === undefined ||
    !isCanonicalStudioGeneratedTake(asset, projectId, scene) ||
    !validateTrimPoint(value.sourceInSeconds) ||
    !validateTrimPoint(value.sourceOutSeconds) ||
    (value.sourceInSeconds !== null &&
      value.sourceOutSeconds !== null &&
      value.sourceInSeconds >= value.sourceOutSeconds) ||
    (value.crop !== null && !validateNormalisedRect(value.crop)) ||
    !Array.isArray(value.filters) ||
    !value.filters.every(validateCutFilter)
  ) {
    return false;
  }
  const filterIds = value.filters.map((filter) => filter.id);
  if (new Set(filterIds).size !== filterIds.length) return false;
  if (asset.durationSeconds === undefined) return true;
  return (
    (value.sourceInSeconds === null || value.sourceInSeconds <= asset.durationSeconds) &&
    (value.sourceOutSeconds === null || value.sourceOutSeconds <= asset.durationSeconds)
  );
};

const validateCut = (
  cutId: string,
  projectId: string,
  scenes: Record<string, StudioScene>,
  assets: Record<string, StudioAsset>,
  value: unknown
): value is StudioCut => {
  if (!isRecord(value) || !isRecord(value.clips) || !hasExactKeys(value, CUT_KEYS)) return false;
  const clips = value.clips;
  const clipIds = Object.keys(clips);
  return (
    value.id === cutId &&
    isSafeId(cutId) &&
    isString(value.name) &&
    (value.orderMode === 'storyboard' || value.orderMode === 'manual') &&
    asArrayOfSafeIds(value.clipOrder) &&
    value.clipOrder.length === clipIds.length &&
    new Set(value.clipOrder).size === value.clipOrder.length &&
    value.clipOrder.every((clipId) => Object.hasOwn(clips, clipId)) &&
    clipIds.every((clipId) => validateCutClip(clipId, projectId, scenes, assets, clips[clipId]))
  );
};

const validateCuts = (
  cuts: Record<string, unknown>,
  projectId: string,
  scenes: Record<string, StudioScene>,
  assets: Record<string, StudioAsset>
): cuts is Record<string, StudioCut> =>
  Object.keys(cuts).every((cutId) => validateCut(cutId, projectId, scenes, assets, cuts[cutId]));

const IMPLICIT_CUT_ID = 'cut_1';

export type ResolvedStudioCutState = {
  cuts: Record<string, StudioCut>;
  activeCutId: string | null;
};

const selectedTake = (project: StudioProject, scene: StudioScene): StudioAsset | null => {
  if (scene.selectedAssetId === null) return null;
  const asset = project.assets[scene.selectedAssetId];
  return asset !== undefined && isCanonicalStudioGeneratedTake(asset, project.id, scene) ? asset : null;
};

const implicitClipIdBase = (sceneId: string, suffix = ''): string =>
  `clip_${sceneId}`.slice(0, 256 - suffix.length) + suffix;

const allocateClipId = (sceneId: string, occupied: ReadonlySet<string>): string => {
  const base = implicitClipIdBase(sceneId);
  if (!occupied.has(base)) return base;
  let suffix = 2;
  while (occupied.has(implicitClipIdBase(sceneId, `_${suffix}`))) suffix += 1;
  return implicitClipIdBase(sceneId, `_${suffix}`);
};

const pristineClip = (scene: StudioScene, asset: StudioAsset, id: string): StudioCutClip => ({
  id,
  sceneId: scene.id,
  assetId: asset.id,
  sourceInSeconds: null,
  sourceOutSeconds: null,
  crop: null,
  filters: [],
});

const deriveImplicitCut = (project: StudioProject): StudioCut => {
  const clips: Record<string, StudioCutClip> = {};
  const clipOrder: string[] = [];
  const occupied = new Set<string>();
  for (const sceneId of project.sceneOrder) {
    const scene = project.scenes[sceneId];
    if (scene === undefined) continue;
    const asset = selectedTake(project, scene);
    if (asset === null) continue;
    const clipId = allocateClipId(scene.id, occupied);
    occupied.add(clipId);
    clips[clipId] = pristineClip(scene, asset, clipId);
    clipOrder.push(clipId);
  }
  return {
    id: IMPLICIT_CUT_ID,
    name: project.name,
    orderMode: 'storyboard',
    clipOrder,
    clips,
  };
};

/** Resolves legacy projects to a pristine in-memory cut without mutating or persisting them. */
export const resolveStudioCutState = (project: StudioProject): ResolvedStudioCutState => {
  if (project.cuts !== undefined && project.activeCutId !== undefined) {
    return { cuts: project.cuts, activeCutId: project.activeCutId };
  }
  const cut = deriveImplicitCut(project);
  return { cuts: { [cut.id]: cut }, activeCutId: cut.id };
};

const clampClipToAsset = (clip: StudioCutClip, asset: StudioAsset): StudioCutClip => {
  if (asset.durationSeconds === undefined) return { ...clip, assetId: asset.id };
  if (clip.sourceInSeconds !== null && clip.sourceInSeconds >= asset.durationSeconds) {
    return { ...clip, assetId: asset.id, sourceInSeconds: null, sourceOutSeconds: null };
  }
  return {
    ...clip,
    assetId: asset.id,
    sourceOutSeconds: clip.sourceOutSeconds === null ? null : Math.min(clip.sourceOutSeconds, asset.durationSeconds),
  };
};

const reconcileCut = (project: StudioProject, cut: StudioCut): StudioCut => {
  const clips: Record<string, StudioCutClip> = {};
  const priorOrder = [...cut.clipOrder];
  const orderedExistingIds = [
    ...priorOrder,
    ...Object.keys(cut.clips).filter((clipId) => !priorOrder.includes(clipId)),
  ];
  for (const clipId of orderedExistingIds) {
    const clip = cut.clips[clipId];
    const scene = clip === undefined ? undefined : project.scenes[clip.sceneId];
    const asset = scene === undefined ? null : selectedTake(project, scene);
    if (clip === undefined || asset === null) continue;
    clips[clipId] = clampClipToAsset(clip, asset);
  }

  const occupied = new Set(Object.keys(clips));
  const addedIds: string[] = [];
  if (cut.orderMode === 'storyboard') {
    for (const sceneId of project.sceneOrder) {
      const scene = project.scenes[sceneId];
      if (scene === undefined || Object.values(clips).some((clip) => clip.sceneId === sceneId)) continue;
      const asset = selectedTake(project, scene);
      if (asset === null) continue;
      const clipId = allocateClipId(sceneId, occupied);
      occupied.add(clipId);
      addedIds.push(clipId);
      clips[clipId] = pristineClip(scene, asset, clipId);
    }
  }

  const retainedPriorOrder = priorOrder.filter((clipId) => Object.hasOwn(clips, clipId));
  const clipOrder =
    cut.orderMode === 'manual'
      ? [...retainedPriorOrder, ...addedIds]
      : project.sceneOrder.flatMap((sceneId) =>
          [...retainedPriorOrder, ...addedIds].filter((clipId) => clips[clipId]?.sceneId === sceneId)
        );
  return { ...cut, clipOrder, clips };
};

/** Keeps already-persisted cuts aligned with canonical selection and storyboard changes. */
export const reconcilePersistedStudioCuts = (project: StudioProject): StudioProject => {
  if (project.cuts === undefined || project.activeCutId === undefined) return project;
  return {
    ...project,
    cuts: Object.fromEntries(Object.entries(project.cuts).map(([cutId, cut]) => [cutId, reconcileCut(project, cut)])),
  };
};

const validateJob = (jobId: string, projectId: string, sceneIds: Set<string>, value: unknown): value is StudioJob => {
  if (!isRecord(value)) return false;
  const errorIsValid =
    value.error === null ||
    (isRecord(value.error) &&
      Object.keys(value.error).length === JOB_ERROR_KEYS.size &&
      Object.keys(value.error).every((key) => JOB_ERROR_KEYS.has(key)) &&
      isString(value.error.code) &&
      JOB_ERROR_CODES.has(value.error.code) &&
      isNonEmptyString(value.error.messageKey));
  const referenceInputSnapshotIsValid =
    value.referenceInputSnapshot === undefined ||
    (value.outputRole === 'reference' &&
      isRecord(value.referenceInputSnapshot) &&
      hasExactKeys(value.referenceInputSnapshot, REFERENCE_INPUT_SNAPSHOT_KEYS) &&
      isNonEmptyString(value.referenceInputSnapshot.sourceVisualPrompt) &&
      value.referenceInputSnapshot.sourceVisualPrompt === value.referenceInputSnapshot.sourceVisualPrompt.trim() &&
      value.referenceInputSnapshot.sourceVisualPrompt.length <= STUDIO_REFERENCE_PROMPT_MAX_LENGTH &&
      asArrayOfSafeIds(value.referenceInputSnapshot.conditioningReferenceAssetIds) &&
      value.referenceInputSnapshot.conditioningReferenceAssetIds.length <= STUDIO_MAX_ACTIVE_BRIEF_REFERENCES &&
      new Set(value.referenceInputSnapshot.conditioningReferenceAssetIds).size ===
        value.referenceInputSnapshot.conditioningReferenceAssetIds.length &&
      isString(value.referenceInputSnapshot.aspectRatio) &&
      ASPECT_RATIOS.has(value.referenceInputSnapshot.aspectRatio) &&
      isString(value.referenceInputSnapshot.resolution) &&
      RESOLUTIONS.has(value.referenceInputSnapshot.resolution));
  return (
    Object.keys(value).every((key) => JOB_KEYS.has(key)) &&
    value.id === jobId &&
    isSafeId(jobId) &&
    value.projectId === projectId &&
    isSafeId(value.sceneId) &&
    sceneIds.has(value.sceneId) &&
    isString(value.status) &&
    JOB_STATUSES.has(value.status) &&
    validateProviderRef(value.provider) &&
    isSafeId(value.idempotencyKey) &&
    (value.providerJobId === null || (isString(value.providerJobId) && isValidProviderJobId(value.providerJobId))) &&
    (!Object.hasOwn(value, 'remoteStartedAt') ||
      (value.providerJobId === null
        ? value.remoteStartedAt === null
        : isCanonicalIsoTimestamp(value.remoteStartedAt))) &&
    isString(value.cancellationPolicy) &&
    CANCELLATION_POLICIES.has(value.cancellationPolicy as StudioCancellationPolicy) &&
    (value.outputRole === undefined ||
      (isString(value.outputRole) && JOB_OUTPUT_ROLES.has(value.outputRole as StudioOutputRole))) &&
    referenceInputSnapshotIsValid &&
    asArrayOfSafeIds(value.outputAssetIds) &&
    new Set(value.outputAssetIds).size === value.outputAssetIds.length &&
    errorIsValid &&
    (value.progress === undefined ||
      (typeof value.progress === 'number' &&
        Number.isFinite(value.progress) &&
        value.progress >= 0 &&
        value.progress <= 100)) &&
    (value.retryOfJobId === null || isSafeId(value.retryOfJobId)) &&
    (value.retryReason === null || (isString(value.retryReason) && JOB_RETRY_REASONS.has(value.retryReason))) &&
    typeof value.duplicateChargeAcknowledged === 'boolean' &&
    (value.duplicateChargeAcknowledgedAt === null || isCanonicalIsoTimestamp(value.duplicateChargeAcknowledgedAt)) &&
    ((value.retryOfJobId === null && value.retryReason === null) ||
      (value.retryOfJobId !== null && value.retryReason !== null)) &&
    (value.duplicateChargeAcknowledged
      ? value.retryReason === 'submission_unknown' && value.duplicateChargeAcknowledgedAt !== null
      : value.duplicateChargeAcknowledgedAt === null) &&
    isNonEmptyString(value.createdAt) &&
    isNonEmptyString(value.updatedAt)
  );
};

/** Defaults lineage fields added during Task 6 without weakening schema-v1 validation. */
const migrateSchemaV1Project = (value: unknown): unknown => {
  if (!isRecord(value) || value.schemaVersion !== 1 || !isRecord(value.jobs)) return value;
  let changed = false;
  const jobs = Object.fromEntries(
    Object.entries(value.jobs).map(([jobId, candidate]) => {
      if (!isRecord(candidate)) return [jobId, candidate];
      const job = { ...candidate };
      if (!Object.hasOwn(job, 'retryOfJobId')) {
        job.retryOfJobId = null;
        changed = true;
      }
      if (!Object.hasOwn(job, 'retryReason')) {
        job.retryReason = null;
        changed = true;
      }
      if (!Object.hasOwn(job, 'duplicateChargeAcknowledged')) {
        job.duplicateChargeAcknowledged = false;
        changed = true;
      }
      if (!Object.hasOwn(job, 'duplicateChargeAcknowledgedAt')) {
        job.duplicateChargeAcknowledgedAt = null;
        changed = true;
      }
      if (!Object.hasOwn(job, 'cancellationPolicy')) {
        job.cancellationPolicy = 'none';
        changed = true;
      }
      return [jobId, job];
    })
  );
  const routing =
    isRecord(value.routing) && !Object.hasOwn(value.routing, 'storyboard')
      ? { ...value.routing, storyboard: null }
      : value.routing;
  // Defaulted here, before validateProject runs at readProject, so a manifest written before rules
  // existed reads back rather than being quarantined. The migrator is unconditional for any record
  // that could otherwise pass validation, which is what makes it safe to validate `rules` as
  // required in the same change.
  const rulesMissing = !Object.hasOwn(value, 'rules');
  const ruleListUndoMissing = !Object.hasOwn(value, 'ruleListUndo');
  return changed || routing !== value.routing || rulesMissing || ruleListUndoMissing
    ? {
        ...value,
        jobs,
        routing,
        ...(rulesMissing ? { rules: [] } : {}),
        ...(ruleListUndoMissing ? { ruleListUndo: null } : {}),
      }
    : value;
};

const retryGraphHasCycle = (jobs: Record<string, StudioJob>): boolean => {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (jobId: string): boolean => {
    if (visiting.has(jobId)) return true;
    if (visited.has(jobId)) return false;
    visiting.add(jobId);
    const predecessorId = jobs[jobId]?.retryOfJobId;
    if (predecessorId !== null && predecessorId !== undefined && Object.hasOwn(jobs, predecessorId)) {
      if (visit(predecessorId)) return true;
    }
    visiting.delete(jobId);
    visited.add(jobId);
    return false;
  };
  return Object.keys(jobs).some(visit);
};

const validateProject = (value: unknown): value is StudioProject => {
  if (
    !isRecord(value) ||
    !isRecord(value.scenes) ||
    !isRecord(value.assets) ||
    !isRecord(value.jobs) ||
    !isRecord(value.routing)
  ) {
    return false;
  }
  const scenes = value.scenes;
  const assets = value.assets;
  const jobs = value.jobs;
  const routing = value.routing;
  const projectId = value.id;
  const sceneOrder = value.sceneOrder;
  const cutsPresent = Object.hasOwn(value, 'cuts');
  const activeCutIdPresent = Object.hasOwn(value, 'activeCutId');
  if (containsForbiddenRendererField(value)) return false;
  if (
    value.schemaVersion !== 1 ||
    !isSafeId(projectId) ||
    !isIntegerInRange(value.revision, 1, Number.MAX_SAFE_INTEGER) ||
    !isNonEmptyString(value.name) ||
    !isString(value.brief) ||
    !validateBriefRules(value.rules) ||
    !validateRuleListUndo(value.ruleListUndo) ||
    (value.forgeProjectId !== undefined && !isSafeId(value.forgeProjectId)) ||
    (value.briefConversationId !== undefined &&
      value.briefConversationId !== null &&
      !isSafeId(value.briefConversationId)) ||
    !isString(value.aspectRatio) ||
    !ASPECT_RATIOS.has(value.aspectRatio) ||
    !isIntegerInRange(value.targetDurationSeconds, 5, 60) ||
    !isString(value.resolution) ||
    !RESOLUTIONS.has(value.resolution) ||
    !asArrayOfSafeIds(sceneOrder) ||
    cutsPresent !== activeCutIdPresent ||
    !isNonEmptyString(value.createdAt) ||
    !isNonEmptyString(value.updatedAt) ||
    !hasExactKeys(routing, ROUTING_KEYS) ||
    (routing.storyboard !== null && !validateTextModelRef(routing.storyboard)) ||
    (routing.image !== null && !validateProviderRef(routing.image)) ||
    (routing.video !== null && !validateProviderRef(routing.video))
  ) {
    return false;
  }

  const sceneIds = Object.keys(scenes);
  if (
    sceneIds.some((sceneId) => !validateScene(sceneId, scenes[sceneId])) ||
    sceneOrder.length !== sceneIds.length ||
    new Set(sceneOrder).size !== sceneOrder.length ||
    sceneOrder.some((sceneId) => !Object.hasOwn(scenes, sceneId))
  ) {
    return false;
  }

  const sceneIdSet = new Set(sceneIds);
  if (Object.keys(assets).some((assetId) => !validateAsset(assetId, projectId, sceneIdSet, assets[assetId]))) {
    return false;
  }
  if (Object.keys(jobs).some((jobId) => !validateJob(jobId, projectId, sceneIdSet, jobs[jobId]))) {
    return false;
  }

  const typedScenes = scenes as Record<string, StudioScene>;
  const typedAssets = assets as Record<string, StudioAsset>;
  const typedJobs = jobs as Record<string, StudioJob>;
  if (resolveActiveStudioBriefReferences(typedAssets) === null) return false;
  const provenanceReferencesAreValid = Object.values(typedAssets).every(
    (asset) =>
      asset.sourceReferenceAssetIds === undefined ||
      asset.sourceReferenceAssetIds.every((sourceAssetId) => {
        const sourceAsset = typedAssets[sourceAssetId];
        return (
          sourceAsset?.id === sourceAssetId &&
          sourceAsset.projectId === projectId &&
          sourceAsset.sceneId === null &&
          sourceAsset.mediaKind === 'image' &&
          isStudioReferenceImageMimeType(sourceAsset.mimeType) &&
          sourceAsset.managedAsset.collection === 'imports'
        );
      })
  );
  if (!provenanceReferencesAreValid) return false;
  const jobSnapshotReferencesAreValid = Object.values(typedJobs).every(
    (job) =>
      job.referenceInputSnapshot === undefined ||
      job.referenceInputSnapshot.conditioningReferenceAssetIds.every((sourceAssetId) => {
        const sourceAsset = typedAssets[sourceAssetId];
        return (
          sourceAsset?.id === sourceAssetId &&
          sourceAsset.projectId === projectId &&
          sourceAsset.sceneId === null &&
          sourceAsset.mediaKind === 'image' &&
          isStudioReferenceImageMimeType(sourceAsset.mimeType) &&
          sourceAsset.managedAsset.collection === 'imports'
        );
      })
  );
  if (!jobSnapshotReferencesAreValid) return false;
  if (cutsPresent) {
    if (!isRecord(value.cuts)) return false;
    const cuts = value.cuts;
    const activeCutId = value.activeCutId;
    if (activeCutId !== null) {
      if (!isSafeId(activeCutId) || !Object.hasOwn(cuts, activeCutId)) return false;
    }
    if (!validateCuts(cuts, projectId, typedScenes, typedAssets)) return false;
  }
  if (retryGraphHasCycle(typedJobs)) return false;
  const assetsHaveReverseLinks = Object.values(typedAssets).every(
    (asset) => asset.sceneId === null || typedScenes[asset.sceneId]?.assetIds.includes(asset.id)
  );
  const jobsHaveReverseLinks = Object.values(typedJobs).every((job) =>
    typedScenes[job.sceneId]?.jobIds.includes(job.id)
  );
  const retryLineageIsValid = Object.values(typedJobs).every((job) => {
    if (job.retryOfJobId === null) return true;
    const predecessor = typedJobs[job.retryOfJobId];
    const owningScene = typedScenes[job.sceneId];
    if (predecessor === undefined || owningScene === undefined || predecessor.sceneId !== job.sceneId) return false;
    const predecessorIndex = owningScene.jobIds.indexOf(predecessor.id);
    const retryIndex = owningScene.jobIds.indexOf(job.id);
    if (predecessorIndex < 0 || retryIndex < 0 || predecessorIndex >= retryIndex) return false;
    if (job.retryReason === 'submission_unknown') {
      return (
        (predecessor.status === 'needs_attention' || predecessor.status === 'failed') &&
        predecessor.error?.code === 'submission_unknown' &&
        job.duplicateChargeAcknowledged &&
        job.duplicateChargeAcknowledgedAt !== null
      );
    }
    return (
      job.retryReason === 'provider_failure' &&
      predecessor.status === 'failed' &&
      predecessor.error?.code !== 'submission_unknown' &&
      predecessor.error?.code !== 'download_failed' &&
      !job.duplicateChargeAcknowledged
    );
  });
  if (!assetsHaveReverseLinks || !jobsHaveReverseLinks || !retryLineageIsValid) return false;
  return sceneIds.every((sceneId) => {
    const scene = typedScenes[sceneId];
    const linkedAssetsAreValid = scene.assetIds.every(
      (assetId) => typedAssets[assetId]?.projectId === projectId && typedAssets[assetId]?.sceneId === sceneId
    );
    const linkedJobsAreValid = scene.jobIds.every(
      (jobId) => typedJobs[jobId]?.projectId === projectId && typedJobs[jobId]?.sceneId === sceneId
    );
    const selectedAssetIsValid =
      scene.selectedAssetId === null ||
      (typedAssets[scene.selectedAssetId]?.projectId === projectId &&
        typedAssets[scene.selectedAssetId]?.sceneId === sceneId);
    const referenceAssetIsValid =
      scene.referenceAssetId === null ||
      (typedAssets[scene.referenceAssetId]?.projectId === projectId &&
        typedAssets[scene.referenceAssetId]?.sceneId === sceneId);
    const jobOutputsAreValid = scene.jobIds.every((jobId) =>
      typedJobs[jobId].outputAssetIds.every(
        (assetId) => typedAssets[assetId]?.projectId === projectId && typedAssets[assetId]?.sceneId === sceneId
      )
    );
    return (
      linkedAssetsAreValid && linkedJobsAreValid && selectedAssetIsValid && referenceAssetIsValid && jobOutputsAreValid
    );
  });
};

const toSummary = (project: StudioProject): StudioProjectSummary => toStudioProjectSummary(project);

const compareSummaries = (left: StudioProjectSummary, right: StudioProjectSummary): number => {
  const byUpdatedAt = right.updatedAt.localeCompare(left.updatedAt);
  return byUpdatedAt !== 0 ? byUpdatedAt : left.id.localeCompare(right.id);
};

const compareSummariesV2 = (left: StudioProjectSummaryV2, right: StudioProjectSummaryV2): number => {
  const byUpdatedAt = right.updatedAt.localeCompare(left.updatedAt);
  return byUpdatedAt !== 0 ? byUpdatedAt : left.id.localeCompare(right.id);
};

const sameJson = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right);

const isJsonWhitespaceByte = (value: number): boolean =>
  value === 0x20 || value === 0x09 || value === 0x0a || value === 0x0d;

const isJsonValueDelimiterByte = (value: number): boolean =>
  isJsonWhitespaceByte(value) || value === 0x2c || value === 0x5d || value === 0x7d;

const isJsonHexByte = (value: number): boolean =>
  (value >= 0x30 && value <= 0x39) || (value >= 0x41 && value <= 0x46) || (value >= 0x61 && value <= 0x66);

const isJsonSimpleEscapeByte = (value: number): boolean =>
  value === 0x22 ||
  value === 0x5c ||
  value === 0x2f ||
  value === 0x62 ||
  value === 0x66 ||
  value === 0x6e ||
  value === 0x72 ||
  value === 0x74;

const JSON_STRING_SPECIAL_BYTE_PATTERN = new RegExp(String.raw`["\\\u0000-\u001f]`);

type StudioSchemaSniffRootState =
  | 'before_root'
  | 'first_key_or_end'
  | 'key_after_comma'
  | 'colon'
  | 'value'
  | 'comma_or_end'
  | 'done'
  | 'invalid';

type StudioSchemaSniffStringRole = 'root_key' | 'root_value' | 'nested_key' | 'nested_value';
type StudioSchemaSniffNumberState =
  | 'minus'
  | 'zero'
  | 'integer'
  | 'fraction_start'
  | 'fraction'
  | 'exponent_start'
  | 'exponent_sign'
  | 'exponent';

const STUDIO_SCHEMA_STACK_OBJECT_FIRST_KEY_OR_END = 0;
const STUDIO_SCHEMA_STACK_OBJECT_KEY_AFTER_COMMA = 1;
const STUDIO_SCHEMA_STACK_OBJECT_COLON = 2;
const STUDIO_SCHEMA_STACK_OBJECT_VALUE = 3;
const STUDIO_SCHEMA_STACK_OBJECT_COMMA_OR_END = 4;
const STUDIO_SCHEMA_STACK_ARRAY_FIRST_VALUE_OR_END = 5;
const STUDIO_SCHEMA_STACK_ARRAY_VALUE_AFTER_COMMA = 6;
const STUDIO_SCHEMA_STACK_ARRAY_COMMA_OR_END = 7;
const STUDIO_SCHEMA_STACK_CHUNK_BYTES = 64 * 1024;

type StudioSchemaSniffNestedState = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** Two grammar frames per byte; allocation grows in fixed chunks rather than per-depth objects. */
class StudioSchemaSniffNestedStack {
  private readonly chunks: Uint8Array[] = [];
  private frameCount = 0;

  get length(): number {
    return this.frameCount;
  }

  push(state: StudioSchemaSniffNestedState): void {
    const frameIndex = this.frameCount;
    const byteIndex = Math.floor(frameIndex / 2);
    const chunkIndex = Math.floor(byteIndex / STUDIO_SCHEMA_STACK_CHUNK_BYTES);
    const indexInChunk = byteIndex % STUDIO_SCHEMA_STACK_CHUNK_BYTES;
    let chunk = this.chunks[chunkIndex];
    if (chunk === undefined) {
      chunk = new Uint8Array(STUDIO_SCHEMA_STACK_CHUNK_BYTES);
      this.chunks.push(chunk);
    }
    const previous = chunk[indexInChunk]!;
    chunk[indexInChunk] = frameIndex % 2 === 0 ? (previous & 0xf0) | state : (previous & 0x0f) | (state << 4);
    this.frameCount += 1;
  }

  peek(): StudioSchemaSniffNestedState | undefined {
    if (this.frameCount === 0) return undefined;
    const frameIndex = this.frameCount - 1;
    const byteIndex = Math.floor(frameIndex / 2);
    const chunk = this.chunks[Math.floor(byteIndex / STUDIO_SCHEMA_STACK_CHUNK_BYTES)]!;
    const packed = chunk[byteIndex % STUDIO_SCHEMA_STACK_CHUNK_BYTES]!;
    return (frameIndex % 2 === 0 ? packed & 0x0f : packed >>> 4) as StudioSchemaSniffNestedState;
  }

  setTop(state: StudioSchemaSniffNestedState): void {
    const frameIndex = this.frameCount - 1;
    const byteIndex = Math.floor(frameIndex / 2);
    const chunk = this.chunks[Math.floor(byteIndex / STUDIO_SCHEMA_STACK_CHUNK_BYTES)]!;
    const indexInChunk = byteIndex % STUDIO_SCHEMA_STACK_CHUNK_BYTES;
    const previous = chunk[indexInChunk]!;
    chunk[indexInChunk] = frameIndex % 2 === 0 ? (previous & 0xf0) | state : (previous & 0x0f) | (state << 4);
  }

  pop(): StudioSchemaSniffNestedState | undefined {
    const state = this.peek();
    if (state !== undefined) this.frameCount -= 1;
    return state;
  }
}

type StudioSchemaSniffValueOwner = 'root' | 'nested';

/**
 * Streams an oversized JSON object without retaining its payload. Only a direct root property can
 * classify the record; nested grammar uses a compact packed stack instead of per-depth objects.
 */
const hasTopLevelSchemaVersionOne = async (
  handle: Awaited<ReturnType<typeof nodeFs.open>>,
  maximumBytes: number
): Promise<boolean> => {
  const chunk = Buffer.alloc(STUDIO_PROJECT_SCHEMA_SNIFF_CHUNK_BYTES);
  let rootState: StudioSchemaSniffRootState = 'before_root';
  let currentKeyIsSchemaVersion = false;
  let observedSchemaVersionOne: boolean | null = null;
  let inString = false;
  let stringRole: StudioSchemaSniffStringRole | null = null;
  let escaped = false;
  let unicodeEscapeBytesRemaining = 0;
  let capturedStringOverflow = false;
  let capturedStringBytes: number[] = [];
  const nestedContainers = new StudioSchemaSniffNestedStack();
  let literalExpected: 'true' | 'false' | 'null' | null = null;
  let literalIndex = 0;
  let numberState: StudioSchemaSniffNumberState | null = null;
  let scalarValueOwner: StudioSchemaSniffValueOwner | null = null;
  let numberNegative = false;
  let numberSignificandDigits = 0;
  let numberFractionDigits = 0;
  let numberOnePosition = 0;
  let numberHasOtherNonzeroDigit = false;
  let numberExponentNegative = false;
  let numberExponentMagnitude = 0;
  let numberCounterOverflow = false;
  let offset = 0;

  const completeRootValue = (schemaVersionOne: boolean): void => {
    if (currentKeyIsSchemaVersion) observedSchemaVersionOne = schemaVersionOne;
    currentKeyIsSchemaVersion = false;
    rootState = 'comma_or_end';
  };

  const completeNestedValue = (): void => {
    const state = nestedContainers.peek();
    if (state === undefined) {
      rootState = 'invalid';
      return;
    }
    if (state <= STUDIO_SCHEMA_STACK_OBJECT_COMMA_OR_END) {
      if (state !== STUDIO_SCHEMA_STACK_OBJECT_VALUE) {
        rootState = 'invalid';
        return;
      }
      nestedContainers.setTop(STUDIO_SCHEMA_STACK_OBJECT_COMMA_OR_END);
      return;
    }
    if (
      state !== STUDIO_SCHEMA_STACK_ARRAY_FIRST_VALUE_OR_END &&
      state !== STUDIO_SCHEMA_STACK_ARRAY_VALUE_AFTER_COMMA
    ) {
      rootState = 'invalid';
      return;
    }
    nestedContainers.setTop(STUDIO_SCHEMA_STACK_ARRAY_COMMA_OR_END);
  };

  const completeScalarValue = (schemaVersionOne: boolean): void => {
    if (scalarValueOwner === 'root') completeRootValue(schemaVersionOne);
    else if (scalarValueOwner === 'nested') completeNestedValue();
    else rootState = 'invalid';
    scalarValueOwner = null;
  };

  const closeNestedContainer = (): void => {
    nestedContainers.pop();
    if (nestedContainers.length === 0) completeRootValue(false);
    else completeNestedValue();
  };

  const pushNestedContainer = (byte: number): void => {
    nestedContainers.push(
      byte === 0x7b ? STUDIO_SCHEMA_STACK_OBJECT_FIRST_KEY_OR_END : STUDIO_SCHEMA_STACK_ARRAY_FIRST_VALUE_OR_END
    );
  };

  const beginString = (role: StudioSchemaSniffStringRole): void => {
    inString = true;
    stringRole = role;
    escaped = false;
    unicodeEscapeBytesRemaining = 0;
    capturedStringOverflow = false;
    capturedStringBytes = role === 'root_key' ? [0x22] : [];
  };

  const recordSignificandDigit = (byte: number, fraction: boolean): void => {
    if (numberSignificandDigits === Number.MAX_SAFE_INTEGER) numberCounterOverflow = true;
    else numberSignificandDigits += 1;
    if (fraction) {
      if (numberFractionDigits === Number.MAX_SAFE_INTEGER) numberCounterOverflow = true;
      else numberFractionDigits += 1;
    }
    if (byte === 0x31) {
      if (numberOnePosition !== 0) numberHasOtherNonzeroDigit = true;
      else numberOnePosition = numberSignificandDigits;
    } else if (byte !== 0x30) {
      numberHasOtherNonzeroDigit = true;
    }
  };

  const recordExponentDigit = (byte: number): void => {
    const digit = byte - 0x30;
    if (numberExponentMagnitude > Math.floor((Number.MAX_SAFE_INTEGER - digit) / 10)) {
      numberCounterOverflow = true;
      return;
    }
    numberExponentMagnitude = numberExponentMagnitude * 10 + digit;
  };

  const beginNumber = (byte: number, owner: StudioSchemaSniffValueOwner): void => {
    scalarValueOwner = owner;
    numberNegative = byte === 0x2d;
    numberSignificandDigits = 0;
    numberFractionDigits = 0;
    numberOnePosition = 0;
    numberHasOtherNonzeroDigit = false;
    numberExponentNegative = false;
    numberExponentMagnitude = 0;
    numberCounterOverflow = false;
    if (numberNegative) {
      numberState = 'minus';
      return;
    }
    numberState = byte === 0x30 ? 'zero' : 'integer';
    recordSignificandDigit(byte, false);
  };

  const schemaNumberIsOne = (): boolean => {
    if (numberNegative || numberCounterOverflow || numberOnePosition === 0 || numberHasOtherNonzeroDigit) {
      return false;
    }
    const exponent = numberExponentNegative ? -numberExponentMagnitude : numberExponentMagnitude;
    return numberSignificandDigits - numberOnePosition - numberFractionDigits + exponent === 0;
  };

  const numberCanEnd = (): boolean =>
    numberState === 'zero' || numberState === 'integer' || numberState === 'fraction' || numberState === 'exponent';

  const consumeNumberByte = (byte: number): 'consumed' | 'complete' | 'invalid' => {
    if (isJsonValueDelimiterByte(byte)) return numberCanEnd() ? 'complete' : 'invalid';
    if (numberState === 'minus') {
      if (byte < 0x30 || byte > 0x39) return 'invalid';
      numberState = byte === 0x30 ? 'zero' : 'integer';
      recordSignificandDigit(byte, false);
      return 'consumed';
    }
    if (numberState === 'zero' || numberState === 'integer') {
      if (byte >= 0x30 && byte <= 0x39) {
        if (numberState === 'zero') return 'invalid';
        recordSignificandDigit(byte, false);
        return 'consumed';
      }
      if (byte === 0x2e) {
        numberState = 'fraction_start';
        return 'consumed';
      }
      if (byte === 0x45 || byte === 0x65) {
        numberState = 'exponent_start';
        return 'consumed';
      }
      return 'invalid';
    }
    if (numberState === 'fraction_start' || numberState === 'fraction') {
      if (byte >= 0x30 && byte <= 0x39) {
        numberState = 'fraction';
        recordSignificandDigit(byte, true);
        return 'consumed';
      }
      if (numberState === 'fraction' && (byte === 0x45 || byte === 0x65)) {
        numberState = 'exponent_start';
        return 'consumed';
      }
      return 'invalid';
    }
    if (numberState === 'exponent_start') {
      if (byte === 0x2b || byte === 0x2d) {
        numberExponentNegative = byte === 0x2d;
        numberState = 'exponent_sign';
        return 'consumed';
      }
      if (byte < 0x30 || byte > 0x39) return 'invalid';
      numberState = 'exponent';
      recordExponentDigit(byte);
      return 'consumed';
    }
    if (numberState === 'exponent_sign' || numberState === 'exponent') {
      if (byte < 0x30 || byte > 0x39) return 'invalid';
      numberState = 'exponent';
      recordExponentDigit(byte);
      return 'consumed';
    }
    return 'invalid';
  };

  const beginLiteral = (byte: number, owner: StudioSchemaSniffValueOwner): boolean => {
    if (byte === 0x74) literalExpected = 'true';
    else if (byte === 0x66) literalExpected = 'false';
    else if (byte === 0x6e) literalExpected = 'null';
    else return false;
    literalIndex = 1;
    scalarValueOwner = owner;
    return true;
  };

  const beginNestedValue = (byte: number): boolean => {
    if (byte === 0x22) beginString('nested_value');
    else if (byte === 0x7b || byte === 0x5b) pushNestedContainer(byte);
    else if (beginLiteral(byte, 'nested')) return true;
    else if (byte === 0x2d || (byte >= 0x30 && byte <= 0x39)) beginNumber(byte, 'nested');
    else return false;
    return true;
  };

  while (offset < maximumBytes && rootState !== 'invalid') {
    // A fixed reusable buffer keeps memory bounded even when schemaVersion follows a giant value.
    // eslint-disable-next-line no-await-in-loop
    const { bytesRead } = await handle.read(chunk, 0, Math.min(chunk.length, maximumBytes - offset), offset);
    if (bytesRead === 0) return false;
    offset += bytesRead;

    for (let index = 0; index < bytesRead; index += 1) {
      if (
        inString &&
        (stringRole !== 'root_key' || capturedStringOverflow) &&
        !escaped &&
        unicodeEscapeBytesRemaining === 0
      ) {
        const remaining = chunk.subarray(index, bytesRead);
        const nextSpecialOffset = remaining.toString('latin1').search(JSON_STRING_SPECIAL_BYTE_PATTERN);
        if (nextSpecialOffset === -1) break;
        index += nextSpecialOffset;
      }
      const byte = chunk[index]!;

      if (inString) {
        if (stringRole === 'root_key') {
          if (capturedStringBytes.length < STUDIO_PROJECT_SCHEMA_SNIFF_TOKEN_BYTES) {
            capturedStringBytes.push(byte);
          } else {
            capturedStringOverflow = true;
          }
        }
        if (unicodeEscapeBytesRemaining > 0) {
          if (!isJsonHexByte(byte)) {
            rootState = 'invalid';
            break;
          }
          unicodeEscapeBytesRemaining -= 1;
          continue;
        }
        if (escaped) {
          escaped = false;
          if (byte === 0x75) unicodeEscapeBytesRemaining = 4;
          else if (!isJsonSimpleEscapeByte(byte)) {
            rootState = 'invalid';
            break;
          }
          continue;
        }
        if (byte === 0x5c) {
          escaped = true;
          continue;
        }
        if (byte < 0x20) {
          rootState = 'invalid';
          break;
        }
        if (byte !== 0x22) continue;

        inString = false;
        const completedRole = stringRole;
        stringRole = null;
        if (completedRole === 'nested_key') {
          const state = nestedContainers.peek();
          if (
            state !== STUDIO_SCHEMA_STACK_OBJECT_FIRST_KEY_OR_END &&
            state !== STUDIO_SCHEMA_STACK_OBJECT_KEY_AFTER_COMMA
          ) {
            rootState = 'invalid';
            break;
          }
          nestedContainers.setTop(STUDIO_SCHEMA_STACK_OBJECT_COLON);
          continue;
        }
        if (completedRole === 'nested_value') {
          completeNestedValue();
          continue;
        }
        if (completedRole === 'root_value') {
          completeRootValue(false);
          continue;
        }
        currentKeyIsSchemaVersion = false;
        if (capturedStringOverflow) {
          rootState = 'colon';
          continue;
        }
        try {
          currentKeyIsSchemaVersion = JSON.parse(Buffer.from(capturedStringBytes).toString('utf8')) === 'schemaVersion';
        } catch {
          rootState = 'invalid';
          break;
        }
        rootState = 'colon';
        continue;
      }

      if (literalExpected !== null) {
        if (byte !== literalExpected.charCodeAt(literalIndex)) {
          rootState = 'invalid';
          break;
        }
        literalIndex += 1;
        if (literalIndex === literalExpected.length) {
          literalExpected = null;
          completeScalarValue(false);
        }
        continue;
      }

      if (numberState !== null) {
        const outcome = consumeNumberByte(byte);
        if (outcome === 'consumed') continue;
        if (outcome === 'invalid') {
          rootState = 'invalid';
          break;
        }
        const isSchemaOne = schemaNumberIsOne();
        numberState = null;
        completeScalarValue(isSchemaOne);
      }

      if (nestedContainers.length > 0) {
        const nestedState = nestedContainers.peek()!;
        if (nestedState <= STUDIO_SCHEMA_STACK_OBJECT_COMMA_OR_END) {
          if (
            nestedState === STUDIO_SCHEMA_STACK_OBJECT_FIRST_KEY_OR_END ||
            nestedState === STUDIO_SCHEMA_STACK_OBJECT_KEY_AFTER_COMMA
          ) {
            if (isJsonWhitespaceByte(byte)) continue;
            if (nestedState === STUDIO_SCHEMA_STACK_OBJECT_FIRST_KEY_OR_END && byte === 0x7d) {
              closeNestedContainer();
              continue;
            }
            if (byte !== 0x22) {
              rootState = 'invalid';
              break;
            }
            beginString('nested_key');
            continue;
          }
          if (nestedState === STUDIO_SCHEMA_STACK_OBJECT_COLON) {
            if (isJsonWhitespaceByte(byte)) continue;
            if (byte !== 0x3a) {
              rootState = 'invalid';
              break;
            }
            nestedContainers.setTop(STUDIO_SCHEMA_STACK_OBJECT_VALUE);
            continue;
          }
          if (nestedState === STUDIO_SCHEMA_STACK_OBJECT_VALUE) {
            if (isJsonWhitespaceByte(byte)) continue;
            if (!beginNestedValue(byte)) {
              rootState = 'invalid';
              break;
            }
            continue;
          }
          if (isJsonWhitespaceByte(byte)) continue;
          if (byte === 0x2c) {
            nestedContainers.setTop(STUDIO_SCHEMA_STACK_OBJECT_KEY_AFTER_COMMA);
            continue;
          }
          if (byte === 0x7d) {
            closeNestedContainer();
            continue;
          }
          rootState = 'invalid';
          break;
        }

        if (
          nestedState === STUDIO_SCHEMA_STACK_ARRAY_FIRST_VALUE_OR_END ||
          nestedState === STUDIO_SCHEMA_STACK_ARRAY_VALUE_AFTER_COMMA
        ) {
          if (isJsonWhitespaceByte(byte)) continue;
          if (nestedState === STUDIO_SCHEMA_STACK_ARRAY_FIRST_VALUE_OR_END && byte === 0x5d) {
            closeNestedContainer();
            continue;
          }
          if (!beginNestedValue(byte)) {
            rootState = 'invalid';
            break;
          }
          continue;
        }
        if (isJsonWhitespaceByte(byte)) continue;
        if (byte === 0x2c) {
          nestedContainers.setTop(STUDIO_SCHEMA_STACK_ARRAY_VALUE_AFTER_COMMA);
          continue;
        }
        if (byte === 0x5d) {
          closeNestedContainer();
          continue;
        }
        rootState = 'invalid';
        break;
      }

      if (rootState === 'before_root') {
        if (isJsonWhitespaceByte(byte)) continue;
        if (byte !== 0x7b) {
          rootState = 'invalid';
          break;
        }
        rootState = 'first_key_or_end';
        continue;
      }
      if (rootState === 'first_key_or_end' || rootState === 'key_after_comma') {
        if (isJsonWhitespaceByte(byte)) continue;
        if (rootState === 'first_key_or_end' && byte === 0x7d) {
          rootState = 'done';
          continue;
        }
        if (byte !== 0x22) {
          rootState = 'invalid';
          break;
        }
        beginString('root_key');
        continue;
      }
      if (rootState === 'colon') {
        if (isJsonWhitespaceByte(byte)) continue;
        if (byte !== 0x3a) {
          rootState = 'invalid';
          break;
        }
        rootState = 'value';
        continue;
      }
      if (rootState === 'value') {
        if (isJsonWhitespaceByte(byte)) continue;
        if (byte === 0x22) beginString('root_value');
        else if (byte === 0x7b || byte === 0x5b) pushNestedContainer(byte);
        else if (beginLiteral(byte, 'root')) {
          // The remaining literal bytes are consumed by the streaming scalar state above.
        } else if (byte === 0x2d || (byte >= 0x30 && byte <= 0x39)) beginNumber(byte, 'root');
        else {
          rootState = 'invalid';
          break;
        }
        continue;
      }
      if ((rootState as StudioSchemaSniffRootState) === 'comma_or_end') {
        if (isJsonWhitespaceByte(byte)) continue;
        if (byte === 0x2c) {
          rootState = 'key_after_comma';
          continue;
        }
        if (byte === 0x7d) {
          rootState = 'done';
          continue;
        }
        rootState = 'invalid';
        break;
      }
      if (rootState === 'done') {
        if (!isJsonWhitespaceByte(byte)) {
          rootState = 'invalid';
          break;
        }
        continue;
      }
    }
  }
  return (
    offset === maximumBytes &&
    rootState === 'done' &&
    !inString &&
    nestedContainers.length === 0 &&
    literalExpected === null &&
    numberState === null &&
    scalarValueOwner === null &&
    observedSchemaVersionOne === true
  );
};

const createProjectFromInput = (input: CreateStudioProjectInput, id: string, timestamp: string): StudioProject => ({
  schemaVersion: 1,
  revision: 1,
  id,
  name: input.name.trim(),
  brief: input.brief,
  rules: [],
  ruleListUndo: null,
  ...(input.forgeProjectId === undefined ? {} : { forgeProjectId: input.forgeProjectId }),
  briefConversationId: null,
  aspectRatio: input.aspectRatio,
  targetDurationSeconds: input.targetDurationSeconds,
  resolution: input.resolution,
  sceneOrder: [],
  scenes: {},
  assets: {},
  jobs: {},
  routing: { storyboard: null, image: null, video: null },
  createdAt: timestamp,
  updatedAt: timestamp,
});

/** Creates an atomic, manifest-backed store for Creative Studio projects. */
export const createCreativeStudioStore = (deps: CreativeStudioStoreDeps): CreativeStudioStore => {
  const rootDir = path.resolve(deps.rootDir);
  const now = deps.now ?? (() => new Date().toISOString());
  const createId = deps.createId ?? (() => crypto.randomUUID().replaceAll('-', '_'));
  const fs = deps.fs ?? nodeFs;
  const onProjectCommitted = deps.onProjectCommitted;
  const logError = deps.logError ?? ((message: string, error: unknown): void => console.error(message, error));
  const watchProposalTree =
    deps.watchProposalTree ??
    ((input: {
      rootDir: string;
      onChange: (relativeFile: string) => void;
      onError: (error: Error) => void;
    }): { close(): void } => {
      const watcher = watchFileSystem(input.rootDir, { recursive: true, encoding: 'utf8' }, (_eventType, fileName) => {
        if (fileName !== null) input.onChange(fileName);
      });
      watcher.on('error', input.onError);
      return { close: () => watcher.close() };
    });
  const queues = new Map<string, Promise<unknown>>();
  const proposalReapedAt = new Map<string, number>();
  let summaryQueue: Promise<unknown> = Promise.resolve();
  let summaryV2Queue: Promise<unknown> = Promise.resolve();
  let connectionsQueue: Promise<unknown> = Promise.resolve();
  let sharedListingSweep:
    | { result: ProjectListingSweep; remainingConsumer: 'projects' | 'quarantinedProjectIds' }
    | undefined;

  const safeLogError = (message: string, error: unknown): void => {
    try {
      logError(message, error);
    } catch {
      // Logging is diagnostic and cannot veto an already-authoritative project commit.
    }
  };

  const observeProjectCommit = (facts: StudioProjectCommitFacts): void => {
    if (onProjectCommitted === undefined) return;
    let observerResult: unknown;
    try {
      observerResult = (onProjectCommitted as (observed: StudioProjectCommitFacts) => unknown)(facts);
    } catch (error) {
      safeLogError('[CreativeStudio] Project commit observer failed', error);
      return;
    }
    if ((typeof observerResult !== 'object' || observerResult === null) && typeof observerResult !== 'function') {
      return;
    }
    try {
      if (typeof Reflect.get(observerResult, 'then') !== 'function') return;
      void Promise.resolve(observerResult).catch((error: unknown): void => {
        safeLogError('[CreativeStudio] Project commit observer rejected', error);
      });
    } catch (error) {
      safeLogError('[CreativeStudio] Project commit observer rejected', error);
    }
  };

  const requireSafeId = (projectId: string): void => {
    if (!isSafeId(projectId)) throw new CreativeStudioStoreError('invalid_payload', 'Invalid Studio project id');
  };

  const isInsideRoot = (canonicalRoot: string, target: string): boolean =>
    target === canonicalRoot || target.startsWith(canonicalRoot + path.sep);

  const storageError = (error: unknown, fallback: string): CreativeStudioStoreError =>
    new CreativeStudioStoreError('storage_error', error instanceof Error ? error.message : fallback);

  const canonicalRoot = async (): Promise<string> => {
    try {
      return await canonicalizeRecordRoot({ fs, rootDir });
    } catch (error) {
      throw storageError(error, 'Creative Studio root is unavailable');
    }
  };

  const existingCanonicalRootV2 = async (): Promise<string | null> => {
    try {
      const stats = await fs.lstat(rootDir);
      if (!stats.isDirectory() || stats.isSymbolicLink()) {
        throw new CreativeStudioStoreError('storage_error', 'Creative Studio root is unsafe');
      }
      return await fs.realpath(rootDir);
    } catch (error) {
      if (error instanceof CreativeStudioStoreError) throw error;
      if (isRecord(error) && error.code === 'ENOENT') return null;
      throw storageError(error, 'Creative Studio root is unavailable');
    }
  };

  const writableCanonicalRootV2 = async (): Promise<string> => (await existingCanonicalRootV2()) ?? canonicalRoot();

  const resolveRootChild = (root: string, child: string): string => {
    try {
      return resolveConfinedRecordPath(root, root, child);
    } catch {
      throw new CreativeStudioStoreError('storage_error', 'Creative Studio storage target escaped its root');
    }
  };

  const assertRegularFileOrMissing = async (file: string): Promise<void> => {
    try {
      const stats = await fs.lstat(file);
      if (stats.isSymbolicLink() || !stats.isFile()) {
        throw new CreativeStudioStoreError('storage_error', 'Creative Studio storage file is not a regular file');
      }
    } catch (error) {
      if (error instanceof CreativeStudioStoreError) throw error;
      if (isRecord(error) && error.code === 'ENOENT') return;
      throw storageError(error, 'Creative Studio storage file is unavailable');
    }
  };

  const projectDirectory = async (
    root: string,
    projectId: string,
    createIfMissing: boolean
  ): Promise<string | null> => {
    requireSafeId(projectId);
    const directory = resolveRootChild(root, projectId);
    try {
      const stats = await fs.lstat(directory);
      if (!stats.isDirectory() || stats.isSymbolicLink()) {
        throw new CreativeStudioStoreError('storage_error', 'Creative Studio project directory is unsafe');
      }
    } catch (error) {
      if (error instanceof CreativeStudioStoreError) throw error;
      if (!isRecord(error) || error.code !== 'ENOENT')
        throw storageError(error, 'Creative Studio project directory is unavailable');
      if (!createIfMissing) return null;
      try {
        await fs.mkdir(directory);
      } catch (mkdirError) {
        throw storageError(mkdirError, 'Creative Studio project directory could not be created');
      }
      const createdStats = await fs.lstat(directory);
      if (!createdStats.isDirectory() || createdStats.isSymbolicLink()) {
        throw new CreativeStudioStoreError('storage_error', 'Creative Studio project directory is unsafe');
      }
    }

    try {
      const canonicalDirectory = await fs.realpath(directory);
      if (!isInsideRoot(root, canonicalDirectory) || canonicalDirectory === root) {
        throw new CreativeStudioStoreError('storage_error', 'Creative Studio project directory escaped its root');
      }
      return canonicalDirectory;
    } catch (error) {
      if (error instanceof CreativeStudioStoreError) throw error;
      throw storageError(error, 'Creative Studio project directory is unavailable');
    }
  };

  const createProjectDirectoryV2 = async (root: string, projectId: string): Promise<string> => {
    if (!isSafeIdV2(projectId)) {
      throw new CreativeStudioStoreError('invalid_payload', 'Invalid Studio project id');
    }
    const directory = resolveRootChild(root, projectId);
    try {
      await fs.mkdir(directory);
    } catch (error) {
      if (isRecord(error) && error.code === 'EEXIST') {
        throw new CreativeStudioStoreError('invalid_payload', 'Studio project already exists');
      }
      throw storageError(error, 'Creative Studio project directory could not be created');
    }
    try {
      const stats = await fs.lstat(directory);
      const canonicalDirectory = await fs.realpath(directory);
      if (
        !stats.isDirectory() ||
        stats.isSymbolicLink() ||
        !isInsideRoot(root, canonicalDirectory) ||
        canonicalDirectory === root
      ) {
        throw new CreativeStudioStoreError('storage_error', 'Creative Studio project directory is unsafe');
      }
      return canonicalDirectory;
    } catch (error) {
      if (error instanceof CreativeStudioStoreError) throw error;
      throw storageError(error, 'Creative Studio project directory is unavailable');
    }
  };

  const projectFile = async (root: string, projectId: string, createDirectory: boolean): Promise<string | null> => {
    const directory = await projectDirectory(root, projectId, createDirectory);
    if (directory === null) return null;
    const file = resolveRootChild(directory, 'project.json');
    await assertRegularFileOrMissing(file);
    return file;
  };

  const summariesFile = async (root: string): Promise<string> => {
    const file = resolveRootChild(root, 'projects.json');
    await assertRegularFileOrMissing(file);
    return file;
  };

  const summariesFileV2 = async (root: string): Promise<string> => {
    const file = resolveRootChild(root, 'projects-v2.json');
    await assertRegularFileOrMissing(file);
    return file;
  };

  const sniffOversizedStudioProjectSchema = async (
    root: string,
    file: string,
    preliminaryStats: Awaited<ReturnType<typeof fs.lstat>>
  ): Promise<boolean> => {
    const parent = path.dirname(file);
    let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
    try {
      const parentStats = await fs.lstat(parent);
      if (
        parentStats.isSymbolicLink() ||
        !parentStats.isDirectory() ||
        (await fs.realpath(parent)) !== parent ||
        !isInsideRoot(root, parent)
      ) {
        throw new CreativeStudioStoreError('storage_error', 'Schema-2 Studio project directory is unsafe');
      }
      const flags =
        process.platform === 'win32'
          ? fsConstants.O_RDONLY
          : fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK;
      handle = await fs.open(file, flags);
      const openedStats = await handle.stat();
      if (
        !openedStats.isFile() ||
        openedStats.dev !== preliminaryStats.dev ||
        openedStats.ino !== preliminaryStats.ino
      ) {
        throw new CreativeStudioStoreError('storage_error', 'Schema-2 Studio file changed during schema inspection');
      }

      const isSchemaOne = await hasTopLevelSchemaVersionOne(handle, openedStats.size);
      const [finalHandleStats, finalPathStats, finalParentStats, finalParent] = await Promise.all([
        handle.stat(),
        fs.lstat(file),
        fs.lstat(parent),
        fs.realpath(parent),
      ]);
      if (
        finalHandleStats.size !== openedStats.size ||
        finalHandleStats.mtimeMs !== openedStats.mtimeMs ||
        finalHandleStats.ctimeMs !== openedStats.ctimeMs ||
        finalPathStats.isSymbolicLink() ||
        !finalPathStats.isFile() ||
        finalPathStats.dev !== openedStats.dev ||
        finalPathStats.ino !== openedStats.ino ||
        finalParentStats.isSymbolicLink() ||
        !finalParentStats.isDirectory() ||
        finalParentStats.dev !== parentStats.dev ||
        finalParentStats.ino !== parentStats.ino ||
        finalParent !== parent
      ) {
        throw new CreativeStudioStoreError('storage_error', 'Schema-2 Studio file changed during schema inspection');
      }
      return isSchemaOne;
    } catch (error) {
      if (error instanceof CreativeStudioStoreError) throw error;
      throw storageError(error, 'Schema-2 Studio file could not be inspected');
    } finally {
      await handle?.close().catch((): undefined => undefined);
    }
  };

  const readBoundedStudioV2File = async (
    root: string,
    file: string
  ): Promise<
    { status: 'bytes'; bytes: string; identity: FileIdentityV2 } | { status: 'unsupported_prototype_schema' } | null
  > => {
    let stats: Awaited<ReturnType<typeof fs.lstat>>;
    try {
      stats = await fs.lstat(file);
    } catch (error) {
      if (isRecord(error) && error.code === 'ENOENT') return null;
      throw storageError(error, 'Schema-2 Studio file is unavailable');
    }
    if (stats.isSymbolicLink() || !stats.isFile()) {
      throw new CreativeStudioStoreError('storage_error', 'Schema-2 Studio file is unsafe');
    }
    if (stats.size > STUDIO_PROJECT_V2_MAX_RECORD_BYTES) {
      if (await sniffOversizedStudioProjectSchema(root, file, stats)) {
        return { status: 'unsupported_prototype_schema' };
      }
      throw new CreativeStudioStoreError('storage_error', 'Schema-2 Studio file is too large');
    }
    try {
      const record = await readBoundedRegularFileWithIdentity({
        fs,
        canonicalRoot: root,
        file,
        maxBytes: stats.size,
      });
      return record === null ? null : { status: 'bytes', bytes: record.bytes, identity: record.identity };
    } catch (error) {
      throw storageError(error, 'Schema-2 Studio file could not be read');
    }
  };

  const connectionsFile = async (root: string): Promise<string> => {
    const file = resolveRootChild(root, 'connections.json');
    await assertRegularFileOrMissing(file);
    return file;
  };

  const safeNestedDirectory = async (
    root: string,
    parent: string,
    name: string,
    createIfMissing: boolean
  ): Promise<string | null> => {
    try {
      return await resolveSafeRecordDirectory({
        fs,
        canonicalRoot: root,
        parent,
        name,
        createIfMissing,
      });
    } catch (error) {
      throw storageError(error, 'Creative Studio queue directory is unavailable');
    }
  };

  const sameIdentityV2 = (left: FileIdentityV2, right: FileIdentityV2): boolean =>
    left.dev === right.dev && left.ino === right.ino;

  const captureDirectoryAuthorityV2 = async (directory: string): Promise<DirectoryAuthorityV2> => {
    try {
      const stats = await fs.lstat(directory);
      if (!stats.isDirectory() || stats.isSymbolicLink() || (await fs.realpath(directory)) !== directory) {
        throw new CreativeStudioStoreError('storage_error', 'Creative Studio directory authority changed');
      }
      return { path: directory, dev: stats.dev, ino: stats.ino };
    } catch (error) {
      if (error instanceof CreativeStudioStoreError) throw error;
      throw storageError(error, 'Creative Studio directory authority is unavailable');
    }
  };

  const assertDirectoryAuthorityV2 = async (authority: DirectoryAuthorityV2): Promise<void> => {
    const current = await captureDirectoryAuthorityV2(authority.path);
    if (!sameIdentityV2(current, authority)) {
      throw new CreativeStudioStoreError('storage_error', 'Creative Studio directory authority changed');
    }
  };

  const syncDirectoryAuthorityV2 = async (authority: DirectoryAuthorityV2): Promise<void> => {
    let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
    try {
      await assertDirectoryAuthorityV2(authority);
      handle = await fs.open(authority.path, 'r');
      const stats = await handle.stat();
      if (!stats.isDirectory() || !sameIdentityV2(stats, authority)) {
        throw new CreativeStudioStoreError('storage_error', 'Creative Studio directory authority changed');
      }
      await handle.sync();
      await handle.close();
      handle = undefined;
      await assertDirectoryAuthorityV2(authority);
    } catch (error) {
      await handle?.close().catch((): undefined => undefined);
      if (error instanceof CreativeStudioStoreError) throw error;
      throw storageError(error, 'Creative Studio directory sync failed');
    }
  };

  const resolveProposalDirectoriesV2 = async (input: {
    root: string;
    project: DirectoryAuthorityV2;
    createIfWhollyAbsent: boolean;
    snapshot?: Extract<ProjectFileInspectionV2, { status: 'supported' }>;
  }): Promise<ProposalDirectoriesV2 | null> => {
    await assertDirectoryAuthorityV2(input.project);
    let resolved: ({ root: string } & Record<(typeof PROPOSAL_V2_DIRECTORY_NAMES)[number], string>) | null;
    try {
      resolved = await resolveCompleteDirectorySet({
        fs,
        canonicalRoot: input.root,
        parent: input.project.path,
        rootName: 'proposals',
        childNames: PROPOSAL_V2_DIRECTORY_NAMES,
        createIfWhollyAbsent: input.createIfWhollyAbsent,
        authorizeBeforePublish:
          input.snapshot === undefined
            ? undefined
            : () => assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot! }),
      });
    } catch (error) {
      throw storageError(error, 'Schema-2 Studio proposal directories are unavailable');
    }
    if (resolved === null) {
      if (input.snapshot !== undefined) {
        await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
      }
      return null;
    }
    if (input.snapshot !== undefined) {
      await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
    }
    const directories: ProposalDirectoriesV2 = {
      project: input.project,
      root: await captureDirectoryAuthorityV2(resolved.root),
      pending: await captureDirectoryAuthorityV2(resolved.pending),
      decisions: await captureDirectoryAuthorityV2(resolved.decisions),
      slots: await captureDirectoryAuthorityV2(resolved.slots),
      commits: await captureDirectoryAuthorityV2(resolved.commits),
    };
    await Promise.all([
      assertDirectoryAuthorityV2(directories.project),
      assertDirectoryAuthorityV2(directories.root),
      assertDirectoryAuthorityV2(directories.pending),
      assertDirectoryAuthorityV2(directories.decisions),
      assertDirectoryAuthorityV2(directories.slots),
      assertDirectoryAuthorityV2(directories.commits),
    ]);
    if (input.snapshot !== undefined) {
      await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
    }
    return directories;
  };

  const assertProposalDirectoryAuthoritiesV2 = async (directories: ProposalDirectoriesV2): Promise<void> => {
    await Promise.all([
      assertDirectoryAuthorityV2(directories.project),
      assertDirectoryAuthorityV2(directories.root),
      assertDirectoryAuthorityV2(directories.pending),
      assertDirectoryAuthorityV2(directories.decisions),
      assertDirectoryAuthorityV2(directories.slots),
      assertDirectoryAuthorityV2(directories.commits),
    ]);
  };

  const resolveReferenceRequestDirectoriesV2 = async (input: {
    root: string;
    project: DirectoryAuthorityV2;
    createIfWhollyAbsent: boolean;
    snapshot?: Extract<ProjectFileInspectionV2, { status: 'supported' }>;
  }): Promise<ReferenceRequestDirectoriesV2 | null> => {
    await assertDirectoryAuthorityV2(input.project);
    let resolved: ({ root: string } & Record<(typeof REFERENCE_REQUEST_V2_DIRECTORY_NAMES)[number], string>) | null;
    try {
      resolved = await resolveCompleteDirectorySet({
        fs,
        canonicalRoot: input.root,
        parent: input.project.path,
        rootName: 'reference-requests',
        childNames: REFERENCE_REQUEST_V2_DIRECTORY_NAMES,
        createIfWhollyAbsent: input.createIfWhollyAbsent,
        authorizeBeforePublish:
          input.snapshot === undefined
            ? undefined
            : () => assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot! }),
      });
    } catch (error) {
      throw storageError(error, 'Schema-2 Studio reference request directories are unavailable');
    }
    if (resolved === null) {
      if (input.snapshot !== undefined) {
        await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
      }
      return null;
    }
    if (input.snapshot !== undefined) {
      await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
    }
    const directories: ReferenceRequestDirectoriesV2 = {
      project: input.project,
      root: await captureDirectoryAuthorityV2(resolved.root),
      pending: await captureDirectoryAuthorityV2(resolved.pending),
      decisions: await captureDirectoryAuthorityV2(resolved.decisions),
      slots: await captureDirectoryAuthorityV2(resolved.slots),
      receipts: await captureDirectoryAuthorityV2(resolved.receipts),
    };
    await Promise.all([
      assertDirectoryAuthorityV2(directories.project),
      assertDirectoryAuthorityV2(directories.root),
      assertDirectoryAuthorityV2(directories.pending),
      assertDirectoryAuthorityV2(directories.decisions),
      assertDirectoryAuthorityV2(directories.slots),
      assertDirectoryAuthorityV2(directories.receipts),
    ]);
    if (input.snapshot !== undefined) {
      await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
    }
    return directories;
  };

  const assertReferenceRequestDirectoryAuthoritiesV2 = async (
    directories: ReferenceRequestDirectoriesV2
  ): Promise<void> => {
    await Promise.all([
      assertDirectoryAuthorityV2(directories.project),
      assertDirectoryAuthorityV2(directories.root),
      assertDirectoryAuthorityV2(directories.pending),
      assertDirectoryAuthorityV2(directories.decisions),
      assertDirectoryAuthorityV2(directories.slots),
      assertDirectoryAuthorityV2(directories.receipts),
    ]);
  };

  const reconcileJournalPublicationResiduesV2 = async <RecordType>(input: {
    root: string;
    authority: DirectoryAuthorityV2;
    maxBytes?: number;
    validateNamedBase: (namedBase: string) => boolean;
    parseRecord: (namedBase: string, value: unknown) => RecordType | null;
    deferCleanup?: boolean;
  }): Promise<Array<{ identified: IdentifiedRecordV2<RecordType>; namedFile: string; effective: boolean }>> => {
    const maxBytes = input.maxBytes ?? STUDIO_PROPOSAL_MAX_RECORD_BYTES;
    const deferred: Array<{ identified: IdentifiedRecordV2<RecordType>; namedFile: string; effective: boolean }> = [];
    const entries = await readStableDirectoryEntriesV2(input.authority);
    for (const entry of entries) {
      if (!entry.name.endsWith('.publish')) continue;
      if (!entry.isFile() || entry.isSymbolicLink()) {
        throw new CreativeStudioStoreError('storage_error', 'Studio proposal publication residue is unsafe');
      }
      const temporaryFile = path.join(input.authority.path, entry.name);
      const namedFile = temporaryFile.slice(0, -'.publish'.length);
      const namedBase = path.basename(namedFile);
      if (!input.validateNamedBase(namedBase)) {
        throw new CreativeStudioStoreError('storage_error', 'Studio proposal publication residue is malformed');
      }
      let temporary: Awaited<ReturnType<typeof readBoundedRegularFileWithIdentity>>;
      let named: Awaited<ReturnType<typeof readBoundedRegularFileWithIdentity>>;
      try {
        [temporary, named] = await Promise.all([
          readBoundedRegularFileWithIdentity({
            fs,
            canonicalRoot: input.root,
            file: temporaryFile,
            maxBytes,
          }),
          readBoundedRegularFileWithIdentity({
            fs,
            canonicalRoot: input.root,
            file: namedFile,
            maxBytes,
          }),
        ]);
      } catch (error) {
        throw storageError(error, 'Studio proposal publication residue could not be inspected');
      }
      if (temporary === null) {
        throw new CreativeStudioStoreError('storage_error', 'Studio proposal publication residue changed');
      }
      if (named !== null && (!sameIdentityV2(temporary.identity, named.identity) || temporary.bytes !== named.bytes)) {
        throw new CreativeStudioStoreError('storage_error', 'Studio proposal publication residue is ambiguous');
      }
      let decoded: unknown;
      try {
        decoded = JSON.parse(temporary.bytes) as unknown;
      } catch {
        throw new CreativeStudioStoreError('storage_error', 'Studio proposal publication residue is malformed');
      }
      const record = input.parseRecord(namedBase, decoded);
      if (record === null) {
        throw new CreativeStudioStoreError('storage_error', 'Studio proposal publication residue is malformed');
      }
      const identified: IdentifiedRecordV2<RecordType> = {
        file: temporaryFile,
        bytes: temporary.bytes,
        identity: temporary.identity,
        record,
        quarantined: false,
      };
      await assertIdentifiedRecordCurrentV2({ root: input.root, authority: input.authority, identified, maxBytes });
      if (input.deferCleanup) {
        deferred.push({ identified, namedFile, effective: named === null });
        continue;
      }
      try {
        await fs.rm(temporaryFile);
      } catch (error) {
        throw storageError(error, 'Studio proposal publication residue could not be removed');
      }
      await syncDirectoryAuthorityV2(input.authority);
    }
    return deferred;
  };

  const reconcileOwnedPendingPublicationResiduesV2 = async (input: {
    root: string;
    authority: DirectoryAuthorityV2;
    maxBytes: number;
    validateNamedBase: (namedBase: string) => boolean;
    validateRecord: (namedBase: string, value: unknown) => boolean;
    allowForeignNamedPhase?: boolean;
    deferCleanup?: boolean;
  }): Promise<
    Array<{
      identified: IdentifiedRecordV2<null>;
      namedFile: string;
      phase: 'tmp' | 'ready';
      effective: boolean;
    }>
  > => {
    const deferred: Array<{
      identified: IdentifiedRecordV2<null>;
      namedFile: string;
      phase: 'tmp' | 'ready';
      effective: boolean;
    }> = [];
    const entries = await readStableDirectoryEntriesV2(input.authority);
    for (const entry of entries) {
      const match = /^(.*)\.\d+_\d+\.(tmp|ready)$/.exec(entry.name);
      if (match === null) continue;
      const namedBase = match[1];
      if (namedBase === undefined || !input.validateNamedBase(namedBase) || !entry.isFile() || entry.isSymbolicLink()) {
        throw new CreativeStudioStoreError('storage_error', 'Studio pending publication residue is malformed');
      }
      const temporaryFile = path.join(input.authority.path, entry.name);
      const namedFile = path.join(input.authority.path, namedBase);
      let temporary: Awaited<ReturnType<typeof readBoundedRegularFileWithIdentity>>;
      let named: Awaited<ReturnType<typeof readBoundedRegularFileWithIdentity>>;
      try {
        [temporary, named] = await Promise.all([
          readBoundedRegularFileWithIdentity({
            fs,
            canonicalRoot: input.root,
            file: temporaryFile,
            maxBytes: input.maxBytes,
          }),
          readBoundedRegularFileWithIdentity({
            fs,
            canonicalRoot: input.root,
            file: namedFile,
            maxBytes: input.maxBytes,
          }),
        ]);
      } catch (error) {
        throw storageError(error, 'Studio pending publication residue could not be inspected');
      }
      const foreignNamedPhase =
        named !== null &&
        (temporary === null || temporary.bytes !== named.bytes || !sameIdentityV2(temporary.identity, named.identity));
      if (temporary === null || (foreignNamedPhase && input.allowForeignNamedPhase !== true)) {
        throw new CreativeStudioStoreError('storage_error', 'Studio pending publication residue is ambiguous');
      }
      let decoded: unknown;
      try {
        decoded = JSON.parse(temporary.bytes) as unknown;
      } catch {
        throw new CreativeStudioStoreError('storage_error', 'Studio pending publication residue is malformed');
      }
      if (!input.validateRecord(namedBase, decoded)) {
        throw new CreativeStudioStoreError('storage_error', 'Studio pending publication residue is malformed');
      }
      if (match[2] === 'ready') {
        const preparation = await readBoundedRegularFileWithIdentity({
          fs,
          canonicalRoot: input.root,
          file: `${temporaryFile.slice(0, -'.ready'.length)}.tmp`,
          maxBytes: input.maxBytes,
        });
        if (
          preparation === null ||
          preparation.bytes !== temporary.bytes ||
          !sameIdentityV2(preparation.identity, temporary.identity)
        ) {
          throw new CreativeStudioStoreError('storage_error', 'Studio pending publication residue is ambiguous');
        }
      }
      const identified: IdentifiedRecordV2<null> = {
        file: temporaryFile,
        bytes: temporary.bytes,
        identity: temporary.identity,
        record: null,
        quarantined: false,
      };
      await assertIdentifiedRecordCurrentV2({
        root: input.root,
        authority: input.authority,
        identified,
        maxBytes: input.maxBytes,
      });
      if (input.deferCleanup) {
        deferred.push({
          identified,
          namedFile,
          phase: match[2] === 'ready' ? 'ready' : 'tmp',
          effective: match[2] === 'ready' && named === null,
        });
        continue;
      }
      await syncDirectoryAuthorityV2(input.authority);
      await assertIdentifiedRecordCurrentV2({
        root: input.root,
        authority: input.authority,
        identified,
        maxBytes: input.maxBytes,
      });
      try {
        await fs.rm(temporaryFile);
      } catch (error) {
        throw storageError(error, 'Studio pending publication residue could not be removed');
      }
      await syncDirectoryAuthorityV2(input.authority);
    }
    return deferred;
  };

  const reconcileOwnedSlotCleanupResiduesV2 = async <SlotRecord>(input: {
    root: string;
    pending: DirectoryAuthorityV2;
    slots: DirectoryAuthorityV2;
    maxBytes: number;
    capacity: number;
    recordId: (record: SlotRecord) => string;
    validatePending: (recordId: string, value: unknown) => boolean;
    parse: (
      value: unknown
    ) => { status: 'valid'; record: SlotRecord } | { status: 'unsupported_prototype_schema' } | { status: 'invalid' };
    deferCleanup?: boolean;
  }): Promise<Array<{ identified: IdentifiedRecordV2<SlotRecord>; namedFile: string; effective: boolean }>> => {
    const deferred: Array<{
      identified: IdentifiedRecordV2<SlotRecord>;
      namedFile: string;
      effective: boolean;
    }> = [];
    const entries = await readStableDirectoryEntriesV2(input.slots);
    for (const entry of entries) {
      const match = /^((?:0|[1-9]\d*)\.slot)\.\d+_\d+\.cleanup$/.exec(entry.name);
      if (match === null) continue;
      if (
        !entry.isFile() ||
        entry.isSymbolicLink() ||
        match[1] === undefined ||
        !isCanonicalV2SlotFileName(match[1], input.capacity)
      ) {
        throw new CreativeStudioStoreError('storage_error', 'Studio slot cleanup residue is malformed');
      }
      const quarantineFile = path.join(input.slots.path, entry.name);
      const namedFile = path.join(input.slots.path, match[1]);
      const quarantined = await parseIdentifiedJsonV2({
        root: input.root,
        file: quarantineFile,
        maxBytes: input.maxBytes,
        parse: input.parse,
      });
      let named: Awaited<ReturnType<typeof readBoundedRegularFileWithIdentity>>;
      try {
        named = await readBoundedRegularFileWithIdentity({
          fs,
          canonicalRoot: input.root,
          file: namedFile,
          maxBytes: input.maxBytes,
        });
      } catch (error) {
        throw storageError(error, 'Studio slot cleanup named authority could not be inspected');
      }
      if (named !== null) {
        let decoded: unknown;
        try {
          decoded = JSON.parse(named.bytes) as unknown;
        } catch {
          throw new CreativeStudioStoreError('storage_error', 'Studio slot cleanup named record is malformed');
        }
        const parsed = input.parse(decoded);
        if (
          parsed.status !== 'valid' ||
          input.recordId(parsed.record) !== input.recordId(quarantined.record) ||
          named.bytes !== quarantined.bytes ||
          !sameIdentityV2(named.identity, quarantined.identity)
        ) {
          throw new CreativeStudioStoreError('storage_error', 'Studio slot cleanup residue is ambiguous');
        }
      }
      await assertDirectoryAuthorityV2(input.pending);
      const pendingFile = path.join(input.pending.path, `${input.recordId(quarantined.record)}.json`);
      let pending: Awaited<ReturnType<typeof readBoundedRegularFileWithIdentity>>;
      try {
        pending = await readBoundedRegularFileWithIdentity({
          fs,
          canonicalRoot: input.root,
          file: pendingFile,
          maxBytes: input.maxBytes,
        });
      } catch (error) {
        throw storageError(error, 'Studio slot cleanup residue pending authority could not be inspected');
      }
      if (pending !== null) {
        let decoded: unknown;
        try {
          decoded = JSON.parse(pending.bytes) as unknown;
        } catch {
          throw new CreativeStudioStoreError('storage_error', 'Studio slot cleanup pending record is malformed');
        }
        if (!input.validatePending(input.recordId(quarantined.record), decoded)) {
          throw new CreativeStudioStoreError('storage_error', 'Studio slot cleanup pending record is malformed');
        }
      }
      await Promise.all([
        assertDirectoryAuthorityV2(input.pending),
        assertDirectoryAuthorityV2(input.slots),
        assertIdentifiedRecordCurrentV2({
          root: input.root,
          authority: input.slots,
          identified: quarantined,
          maxBytes: input.maxBytes,
        }),
        ...(pending === null
          ? []
          : [
              assertIdentifiedRecordCurrentV2({
                root: input.root,
                authority: input.pending,
                identified: {
                  file: pendingFile,
                  bytes: pending.bytes,
                  identity: pending.identity,
                  record: null,
                  quarantined: false,
                },
                maxBytes: input.maxBytes,
              }),
            ]),
        ...(named === null
          ? [assertPathAbsentV2(namedFile)]
          : [
              assertIdentifiedRecordCurrentV2({
                root: input.root,
                authority: input.slots,
                identified: {
                  file: namedFile,
                  bytes: named.bytes,
                  identity: named.identity,
                  record: null,
                  quarantined: false,
                },
                maxBytes: input.maxBytes,
              }),
            ]),
      ]);
      if (input.deferCleanup) {
        deferred.push({ identified: quarantined, namedFile, effective: named === null && pending !== null });
        continue;
      }
      try {
        if (named !== null || pending === null) await fs.rm(quarantineFile);
        else await fs.rename(quarantineFile, namedFile);
      } catch (error) {
        throw storageError(error, 'Studio slot cleanup residue could not be reconciled');
      }
      await syncDirectoryAuthorityV2(input.slots);
    }
    return deferred;
  };

  const publishImmutableJournalRecordV2 = async (input: {
    root: string;
    authority: DirectoryAuthorityV2;
    file: string;
    bytes: string;
    maxBytes?: number;
    authorizeBeforeLink?: (temporary: IdentifiedRecordV2<null>) => Promise<void>;
    retainTemporary?: boolean;
  }): Promise<void> => {
    const maxBytes = input.maxBytes ?? STUDIO_PROPOSAL_MAX_RECORD_BYTES;
    const temporaryFile = `${input.file}.publish`;
    let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
    let temporaryOwned = false;
    let linked = false;
    let temporaryIdentity: Awaited<ReturnType<Awaited<ReturnType<typeof fs.open>>['stat']>> | undefined;
    let identifiedTemporary: IdentifiedRecordV2<null> | undefined;
    try {
      await assertDirectoryAuthorityV2(input.authority);
      await Promise.all([assertPathAbsentV2(input.file), assertPathAbsentV2(temporaryFile)]);
      handle = await fs.open(temporaryFile, 'wx');
      temporaryOwned = true;
      temporaryIdentity = await handle.stat();
      if (!temporaryIdentity.isFile()) {
        throw new CreativeStudioStoreError('storage_error', 'Studio proposal publication temporary is unsafe');
      }
      await handle.writeFile(input.bytes, { encoding: 'utf8' });
      await handle.sync();
      const writtenIdentity = await handle.stat();
      if (
        !writtenIdentity.isFile() ||
        writtenIdentity.dev !== temporaryIdentity.dev ||
        writtenIdentity.ino !== temporaryIdentity.ino
      ) {
        throw new CreativeStudioStoreError('storage_error', 'Studio proposal publication temporary is unsafe');
      }
      await handle.close();
      handle = undefined;
      await assertDirectoryAuthorityV2(input.authority);
      identifiedTemporary = {
        file: temporaryFile,
        bytes: input.bytes,
        identity: temporaryIdentity,
        record: null,
        quarantined: false,
      };
      await assertIdentifiedRecordCurrentV2({
        root: input.root,
        authority: input.authority,
        identified: identifiedTemporary,
        maxBytes,
      });
      await input.authorizeBeforeLink?.(identifiedTemporary);
      await Promise.all([
        assertDirectoryAuthorityV2(input.authority),
        assertIdentifiedRecordCurrentV2({
          root: input.root,
          authority: input.authority,
          identified: identifiedTemporary,
          maxBytes,
        }),
        assertPathAbsentV2(input.file),
      ]);
      // Re-run caller authority after every asynchronous publication proof. The only remaining
      // source race is the adjacent lstat/link syscall edge, and the hard link itself still
      // enforces exclusive destination publication.
      await assertIdentifiedRecordCurrentV2({
        root: input.root,
        authority: input.authority,
        identified: identifiedTemporary,
        maxBytes,
      });
      await input.authorizeBeforeLink?.(identifiedTemporary);
      await fs.link(temporaryFile, input.file);
      linked = true;
      await syncDirectoryAuthorityV2(input.authority);
      const named = await readBoundedRegularFileWithIdentity({
        fs,
        canonicalRoot: input.root,
        file: input.file,
        maxBytes,
      });
      if (
        named === null ||
        named.bytes !== input.bytes ||
        named.identity.dev !== temporaryIdentity.dev ||
        named.identity.ino !== temporaryIdentity.ino
      ) {
        throw new CreativeStudioStoreError('storage_error', 'Studio proposal publication changed');
      }
      if (!input.retainTemporary) {
        const namedAuthority: IdentifiedRecordV2<null> = { ...identifiedTemporary, file: input.file };
        await Promise.all([
          assertIdentifiedRecordCurrentV2({
            root: input.root,
            authority: input.authority,
            identified: identifiedTemporary,
            maxBytes,
          }),
          assertIdentifiedRecordCurrentV2({
            root: input.root,
            authority: input.authority,
            identified: namedAuthority,
            maxBytes,
          }),
        ]);
        await fs.rm(temporaryFile);
        await syncDirectoryAuthorityV2(input.authority);
        await assertIdentifiedRecordCurrentV2({
          root: input.root,
          authority: input.authority,
          identified: namedAuthority,
          maxBytes,
        });
      }
    } catch (error) {
      await handle?.close().catch((): undefined => undefined);
      if (temporaryOwned && !linked && temporaryIdentity !== undefined) {
        try {
          const current = await fs.lstat(temporaryFile);
          if (
            current.isSymbolicLink() ||
            !current.isFile() ||
            current.dev !== temporaryIdentity.dev ||
            current.ino !== temporaryIdentity.ino
          ) {
            throw new CreativeStudioStoreError('storage_error', 'Studio proposal publication temporary changed');
          }
          await fs.rm(temporaryFile);
        } catch {
          // A replaced or ambiguous temporary is foreign authority and must be preserved.
        }
      }
      if (error instanceof CreativeStudioStoreError) throw error;
      throw storageError(error, 'Studio proposal immutable publication failed');
    }
  };

  const proposalDirectories = async (
    root: string,
    projectId: string,
    createIfMissing: boolean
  ): Promise<{ root: string; pending: string; decisions: string; slots: string } | null> => {
    const project = await projectDirectory(root, projectId, false);
    if (project === null) throw new CreativeStudioStoreError('not_found', 'Studio project not found');
    const proposalRoot = await safeNestedDirectory(root, project, 'proposals', createIfMissing);
    if (proposalRoot === null) return null;
    const pending = await safeNestedDirectory(root, proposalRoot, 'pending', createIfMissing);
    const decisions = await safeNestedDirectory(root, proposalRoot, 'decisions', createIfMissing);
    if (pending === null || decisions === null) return null;
    const slots = await safeNestedDirectory(root, proposalRoot, 'slots', true);
    if (slots === null) {
      throw new CreativeStudioStoreError('storage_error', 'Creative Studio proposal slots are unavailable');
    }
    return { root: proposalRoot, pending, decisions, slots };
  };

  const referenceRequestDirectories = async (
    root: string,
    projectId: string,
    createIfMissing: boolean
  ): Promise<{ root: string; pending: string; slots: string } | null> => {
    const project = await projectDirectory(root, projectId, false);
    if (project === null) throw new CreativeStudioStoreError('not_found', 'Studio project not found');
    const requestRoot = await safeNestedDirectory(root, project, 'reference-requests', createIfMissing);
    if (requestRoot === null) return null;
    const pending = await safeNestedDirectory(root, requestRoot, 'pending', createIfMissing);
    if (pending === null) return null;
    const slots = await safeNestedDirectory(root, requestRoot, 'slots', true);
    if (slots === null) {
      throw new CreativeStudioStoreError('storage_error', 'Creative Studio reference request slots are unavailable');
    }
    return { root: requestRoot, pending, slots };
  };

  const readConnections = async (root: string): Promise<StudioConnectionBinding[]> => {
    const file = await connectionsFile(root);
    try {
      const parsed = JSON.parse(await fs.readFile(file, 'utf8')) as unknown;
      if (
        !isRecord(parsed) ||
        Object.keys(parsed).length !== CONNECTION_MANIFEST_KEYS.size ||
        !Object.keys(parsed).every((key) => CONNECTION_MANIFEST_KEYS.has(key)) ||
        parsed.schemaVersion !== 1 ||
        !Array.isArray(parsed.connections)
      ) {
        throw new CreativeStudioStoreError('storage_error', 'Malformed Studio connection manifest');
      }
      const connections = parsed.connections.map(canonicalizeConnectionBinding);
      if (connections.some((connection) => connection === null)) {
        throw new CreativeStudioStoreError('storage_error', 'Malformed Studio connection manifest');
      }
      return (connections as StudioConnectionBinding[]).toSorted((left, right) => left.id.localeCompare(right.id));
    } catch (error) {
      if (error instanceof CreativeStudioStoreError) throw error;
      if (isRecord(error) && error.code === 'ENOENT') return [];
      throw new CreativeStudioStoreError(
        'storage_error',
        error instanceof Error ? error.message : 'Studio connection storage read failed'
      );
    }
  };

  const enqueueConnections = <T>(work: () => Promise<T>): Promise<T> => {
    const next = connectionsQueue.catch((): undefined => undefined).then(work);
    connectionsQueue = next.catch((): undefined => undefined);
    return next;
  };

  const writeBytesAtomic = async (
    root: string,
    file: string,
    bytes: string,
    authorizeBeforeReplace?: () => Promise<void>
  ): Promise<void> => {
    const parent = path.dirname(file);
    if (!isInsideRoot(root, parent)) {
      throw new CreativeStudioStoreError('storage_error', 'Creative Studio storage target escaped its root');
    }
    const parentStats = await fs.lstat(parent);
    if (!parentStats.isDirectory() || parentStats.isSymbolicLink() || (await fs.realpath(parent)) !== parent) {
      throw new CreativeStudioStoreError('storage_error', 'Creative Studio storage parent is unsafe');
    }
    await assertRegularFileOrMissing(file);
    const temporaryFile = `${file}.${process.pid}.${++temporaryFileCounter}.tmp`;
    let temporaryHandle: Awaited<ReturnType<typeof fs.open>> | undefined;
    let temporaryOwned = false;
    let temporaryIdentity: FileIdentityV2 | undefined;
    let published = false;
    try {
      temporaryHandle = await fs.open(temporaryFile, 'wx');
      temporaryOwned = true;
      await temporaryHandle.writeFile(bytes, { encoding: 'utf8' });
      await temporaryHandle.sync();
      const temporaryStats = await temporaryHandle.stat();
      temporaryIdentity = { dev: temporaryStats.dev, ino: temporaryStats.ino };
      const namedTemporaryStats = await fs.lstat(temporaryFile);
      if (
        !temporaryStats.isFile() ||
        namedTemporaryStats.isSymbolicLink() ||
        !namedTemporaryStats.isFile() ||
        temporaryStats.dev !== namedTemporaryStats.dev ||
        temporaryStats.ino !== namedTemporaryStats.ino
      ) {
        throw new CreativeStudioStoreError('storage_error', 'Studio storage temporary changed before publication');
      }
      await authorizeBeforeReplace?.();
      const currentTemporary = await readBoundedRegularFileWithIdentity({
        fs,
        canonicalRoot: root,
        file: temporaryFile,
        maxBytes: Math.max(1, Buffer.byteLength(bytes, 'utf8')),
      });
      if (
        currentTemporary === null ||
        currentTemporary.bytes !== bytes ||
        currentTemporary.identity.dev !== temporaryStats.dev ||
        currentTemporary.identity.ino !== temporaryStats.ino
      ) {
        throw new CreativeStudioStoreError('storage_error', 'Studio storage temporary changed before publication');
      }
      const currentParentStats = await fs.lstat(parent);
      if (
        currentParentStats.isSymbolicLink() ||
        !currentParentStats.isDirectory() ||
        currentParentStats.dev !== parentStats.dev ||
        currentParentStats.ino !== parentStats.ino ||
        (await fs.realpath(parent)) !== parent
      ) {
        throw new CreativeStudioStoreError(
          'storage_error',
          'Creative Studio storage parent changed before publication'
        );
      }
      // The temporary-file and parent proofs above perform asynchronous I/O after the first
      // authorization. Re-run the caller's full compare-and-swap proof as the final awaited
      // operation before rename so a newer project installed during those checks is preserved.
      const finalTemporaryStats = await fs.lstat(temporaryFile);
      if (
        finalTemporaryStats.isSymbolicLink() ||
        !finalTemporaryStats.isFile() ||
        finalTemporaryStats.dev !== temporaryStats.dev ||
        finalTemporaryStats.ino !== temporaryStats.ino ||
        finalTemporaryStats.size !== temporaryStats.size ||
        finalTemporaryStats.mtimeMs !== temporaryStats.mtimeMs ||
        finalTemporaryStats.ctimeMs !== temporaryStats.ctimeMs
      ) {
        throw new CreativeStudioStoreError('storage_error', 'Studio storage temporary changed before publication');
      }
      await authorizeBeforeReplace?.();
      await fs.rename(temporaryFile, file);
      published = true;
      const publishedStats = await fs.lstat(file);
      if (
        publishedStats.isSymbolicLink() ||
        !publishedStats.isFile() ||
        publishedStats.dev !== temporaryStats.dev ||
        publishedStats.ino !== temporaryStats.ino
      ) {
        throw new CreativeStudioStoreError('storage_error', 'Studio storage publication changed');
      }
      await temporaryHandle.close();
      temporaryHandle = undefined;
      const directoryHandle = await fs.open(parent, 'r');
      try {
        await directoryHandle.sync();
      } finally {
        await directoryHandle.close();
      }
    } catch (error) {
      await temporaryHandle?.close().catch((): undefined => undefined);
      if (temporaryOwned && !published && temporaryIdentity !== undefined) {
        try {
          const current = await readBoundedRegularFileWithIdentity({
            fs,
            canonicalRoot: root,
            file: temporaryFile,
            maxBytes: Math.max(1, Buffer.byteLength(bytes, 'utf8')),
          });
          if (
            current !== null &&
            current.bytes === bytes &&
            current.identity.dev === temporaryIdentity.dev &&
            current.identity.ino === temporaryIdentity.ino
          ) {
            await fs.rm(temporaryFile);
          }
        } catch {
          // A replaced or unavailable temporary cannot be removed under the original authority.
        }
      }
      throw new CreativeStudioStoreError(
        'storage_error',
        error instanceof Error ? error.message : 'Studio storage write failed'
      );
    }
  };

  const writeJsonAtomic = (root: string, file: string, value: unknown): Promise<void> =>
    writeBytesAtomic(root, file, serializeJsonExact(value));

  const serializeProjectV2ForWrite = (project: StudioProjectV2, label: string): string => {
    const bytes = serializeJsonExact(project);
    if (Buffer.byteLength(bytes, 'utf8') > STUDIO_PROJECT_V2_MAX_RECORD_BYTES) {
      throw new CreativeStudioStoreError('invalid_payload', `${label} is too large`);
    }
    return bytes;
  };

  const projectDeletionPathsV2 = (
    root: string,
    projectId: string
  ): { markerFile: string; quarantineDirectory: string; projectDirectory: string } => ({
    markerFile: resolveRootChild(root, `.delete-${projectId}.json`),
    quarantineDirectory: resolveRootChild(root, `.delete-${projectId}`),
    projectDirectory: resolveRootChild(root, projectId),
  });

  const readProjectDeletionMarkerV2 = async (
    root: string,
    projectId: string
  ): Promise<IdentifiedRecordV2<ProjectDeletionMarkerV2> | null> => {
    const { markerFile } = projectDeletionPathsV2(root, projectId);
    let identified: Awaited<ReturnType<typeof readBoundedRegularFileWithIdentity>>;
    let publication: Awaited<ReturnType<typeof readBoundedRegularFileWithIdentity>>;
    try {
      [identified, publication] = await Promise.all([
        readBoundedRegularFileWithIdentity({
          fs,
          canonicalRoot: root,
          file: markerFile,
          maxBytes: 2 * 1024,
        }),
        readBoundedRegularFileWithIdentity({
          fs,
          canonicalRoot: root,
          file: `${markerFile}.publish`,
          maxBytes: 2 * 1024,
        }),
      ]);
    } catch (error) {
      throw storageError(error, 'Studio project deletion marker could not be inspected');
    }
    if (
      identified !== null &&
      publication !== null &&
      (identified.bytes !== publication.bytes || !sameIdentityV2(identified.identity, publication.identity))
    ) {
      throw new CreativeStudioStoreError('storage_error', 'Studio project deletion marker publication is ambiguous');
    }
    // A temporary-only marker is not a committed deletion intent. Ordinary project reads must
    // never turn a crash before the exclusive final link (or an injected lookalike) into deletion
    // authority. An explicit delete retry may promote an exact temporary below.
    if (identified === null) return null;
    let decoded: unknown;
    try {
      decoded = JSON.parse(identified.bytes) as unknown;
    } catch {
      throw new CreativeStudioStoreError('storage_error', 'Studio project deletion marker is malformed');
    }
    if (!validateProjectDeletionMarkerV2(decoded) || decoded.projectId !== projectId) {
      throw new CreativeStudioStoreError('storage_error', 'Studio project deletion marker is malformed');
    }
    return {
      file: markerFile,
      bytes: identified.bytes,
      identity: identified.identity,
      record: decoded,
      // Reuse the internal flag to remember that only the final marker survived. This is safe
      // recovery authority only after both the live and quarantine directories are already gone.
      quarantined: publication === null,
    };
  };

  const createProjectDeletionMarkerV2 = async (
    root: string,
    marker: ProjectDeletionMarkerV2,
    snapshot: Extract<ProjectFileInspectionV2, { status: 'supported' }>
  ): Promise<IdentifiedRecordV2<ProjectDeletionMarkerV2>> => {
    const rootAuthority = await captureDirectoryAuthorityV2(root);
    const { markerFile } = projectDeletionPathsV2(root, marker.projectId);
    const bytes = serializeJsonExact(marker);
    try {
      await assertDirectoryAuthorityV2(rootAuthority);
      await assertPathAbsentV2(markerFile);
      const temporaryFile = `${markerFile}.publish`;
      let existingTemporary = await readBoundedRegularFileWithIdentity({
        fs,
        canonicalRoot: root,
        file: temporaryFile,
        maxBytes: 2 * 1024,
      });
      if (existingTemporary !== null && existingTemporary.bytes !== bytes) {
        let staleMarker: unknown;
        try {
          staleMarker = JSON.parse(existingTemporary.bytes) as unknown;
        } catch {
          throw new CreativeStudioStoreError('storage_error', 'Studio project deletion marker retry is ambiguous');
        }
        if (
          !validateProjectDeletionMarkerV2(staleMarker) ||
          staleMarker.projectId !== marker.projectId ||
          staleMarker.expectedRevision >= marker.expectedRevision ||
          marker.expectedRevision !== snapshot.project.revision
        ) {
          throw new CreativeStudioStoreError('storage_error', 'Studio project deletion marker retry is ambiguous');
        }
        await assertDirectoryAuthorityV2(rootAuthority);
        await assertIdentifiedRecordCurrentV2({
          root,
          authority: rootAuthority,
          identified: {
            file: temporaryFile,
            bytes: existingTemporary.bytes,
            identity: existingTemporary.identity,
            record: null,
            quarantined: false,
          },
          maxBytes: 2 * 1024,
        });
        await assertPathAbsentV2(markerFile);
        await assertProjectSnapshotCurrentV2({ root, snapshot });
        await fs.rm(temporaryFile);
        await syncDirectoryAuthorityV2(rootAuthority);
        existingTemporary = null;
      }
      if (existingTemporary !== null) {
        await assertProjectSnapshotCurrentV2({ root, snapshot });
        await assertDirectoryAuthorityV2(rootAuthority);
        await assertIdentifiedRecordCurrentV2({
          root,
          authority: rootAuthority,
          identified: {
            file: temporaryFile,
            bytes,
            identity: existingTemporary.identity,
            record: null,
            quarantined: false,
          },
          maxBytes: 2 * 1024,
        });
        await assertPathAbsentV2(markerFile);
        await assertProjectSnapshotCurrentV2({ root, snapshot });
        await fs.link(temporaryFile, markerFile);
        await syncDirectoryAuthorityV2(rootAuthority);
      } else {
        await publishImmutableJournalRecordV2({
          root,
          authority: rootAuthority,
          file: markerFile,
          bytes,
          maxBytes: 2 * 1024,
          retainTemporary: true,
          authorizeBeforeLink: async (temporary) => {
            await assertDirectoryAuthorityV2(rootAuthority);
            await assertIdentifiedRecordCurrentV2({
              root,
              authority: rootAuthority,
              identified: temporary,
              maxBytes: 2 * 1024,
            });
            await assertPathAbsentV2(markerFile);
            await assertProjectSnapshotCurrentV2({ root, snapshot });
          },
        });
      }
      const identified = await readProjectDeletionMarkerV2(root, marker.projectId);
      if (identified === null || identified.file !== markerFile || identified.bytes !== bytes) {
        throw new CreativeStudioStoreError('storage_error', 'Studio project deletion marker changed at publication');
      }
      return identified;
    } catch (error) {
      throw storageError(error, 'Studio project deletion marker could not be published');
    }
  };

  const finishProjectDeletionV2 = async (
    root: string,
    marker: IdentifiedRecordV2<ProjectDeletionMarkerV2>
  ): Promise<void> => {
    const rootAuthority = await captureDirectoryAuthorityV2(root);
    const {
      markerFile,
      projectDirectory: targetDirectory,
      quarantineDirectory,
    } = projectDeletionPathsV2(root, marker.record.projectId);
    const assertMarkerCurrent = (): Promise<void> =>
      assertIdentifiedRecordCurrentV2({ root, authority: rootAuthority, identified: marker, maxBytes: 2 * 1024 });
    let quarantineStats: Awaited<ReturnType<typeof fs.lstat>> | null = null;
    try {
      quarantineStats = await fs.lstat(quarantineDirectory);
      if (quarantineStats.isSymbolicLink() || !quarantineStats.isDirectory()) {
        throw new CreativeStudioStoreError('storage_error', 'Studio project deletion quarantine is unsafe');
      }
    } catch (error) {
      if (error instanceof CreativeStudioStoreError) throw error;
      if (!isRecord(error) || error.code !== 'ENOENT') {
        throw storageError(error, 'Studio project deletion quarantine could not be inspected');
      }
    }
    if (marker.quarantined && quarantineStats !== null) {
      throw new CreativeStudioStoreError('storage_error', 'Studio project deletion marker companion is missing');
    }
    if (quarantineStats === null) {
      let targetStats: Awaited<ReturnType<typeof fs.lstat>> | null = null;
      try {
        targetStats = await fs.lstat(targetDirectory);
      } catch (error) {
        if (!isRecord(error) || error.code !== 'ENOENT') {
          throw storageError(error, 'Studio project deletion target could not be inspected');
        }
      }
      if (marker.quarantined && targetStats !== null) {
        throw new CreativeStudioStoreError('storage_error', 'Studio project deletion marker companion is missing');
      }
      const inspected = await inspectProjectFileV2(root, marker.record.projectId);
      if (inspected.status === 'not_found') {
        if (targetStats !== null) {
          throw new CreativeStudioStoreError('storage_error', 'Studio project deletion target changed');
        }
        // The whole directory removal committed before a crash; only the durable marker remains.
      } else {
        const snapshot = requireSupportedProjectInspectionV2(inspected);
        if (
          snapshot.project.revision !== marker.record.expectedRevision ||
          snapshot.directory.dev !== marker.record.directoryDev ||
          snapshot.directory.ino !== marker.record.directoryIno ||
          sha256Utf8(snapshot.bytes) !== marker.record.projectSha256
        ) {
          throw new CreativeStudioStoreError('storage_error', 'Studio project changed during deletion');
        }
        await assertMarkerCurrent();
        // The project digest is the final awaited authority before moving the directory out of
        // the live namespace. A concurrent write in the same directory inode is therefore never
        // swept into recursive deletion under an older marker.
        await assertProjectSnapshotCurrentV2({ root, snapshot });
        try {
          await fs.rename(targetDirectory, quarantineDirectory);
        } catch (error) {
          throw storageError(error, 'Studio project could not enter deletion quarantine');
        }
        await syncDirectoryAuthorityV2(rootAuthority);
        quarantineStats = await fs.lstat(quarantineDirectory);
      }
    }
    if (quarantineStats !== null) {
      if (
        quarantineStats.isSymbolicLink() ||
        !quarantineStats.isDirectory() ||
        quarantineStats.dev !== marker.record.directoryDev ||
        quarantineStats.ino !== marker.record.directoryIno
      ) {
        try {
          await assertPathAbsentV2(targetDirectory);
          const currentForeign = await fs.lstat(quarantineDirectory);
          if (
            !currentForeign.isSymbolicLink() &&
            currentForeign.isDirectory() &&
            currentForeign.dev === quarantineStats.dev &&
            currentForeign.ino === quarantineStats.ino
          ) {
            await fs.rename(quarantineDirectory, targetDirectory);
            await syncDirectoryAuthorityV2(rootAuthority);
          }
        } catch {
          // Preserve both names on any ambiguity; a foreign replacement is never deletion authority.
        }
        throw new CreativeStudioStoreError('storage_error', 'Studio project deletion quarantine changed');
      }
      await assertMarkerCurrent();
      await assertPathAbsentV2(targetDirectory);
      const currentQuarantine = await fs.lstat(quarantineDirectory);
      if (
        currentQuarantine.isSymbolicLink() ||
        !currentQuarantine.isDirectory() ||
        currentQuarantine.dev !== marker.record.directoryDev ||
        currentQuarantine.ino !== marker.record.directoryIno
      ) {
        throw new CreativeStudioStoreError('storage_error', 'Studio project deletion quarantine changed');
      }
      const quarantinedManifest = await readBoundedRegularFileWithIdentity({
        fs,
        canonicalRoot: root,
        file: path.join(quarantineDirectory, 'project.json'),
        maxBytes: STUDIO_PROJECT_V2_MAX_RECORD_BYTES,
      });
      if (quarantinedManifest === null || sha256Utf8(quarantinedManifest.bytes) !== marker.record.projectSha256) {
        throw new CreativeStudioStoreError('storage_error', 'Studio project deletion quarantine manifest changed');
      }
      let quarantinedProject: unknown;
      try {
        quarantinedProject = JSON.parse(quarantinedManifest.bytes) as unknown;
      } catch {
        throw new CreativeStudioStoreError('storage_error', 'Studio project deletion quarantine manifest is malformed');
      }
      if (
        !validateStudioProjectV2(quarantinedProject) ||
        quarantinedProject.id !== marker.record.projectId ||
        quarantinedProject.revision !== marker.record.expectedRevision
      ) {
        throw new CreativeStudioStoreError('storage_error', 'Studio project deletion quarantine manifest changed');
      }
      await assertMarkerCurrent();
      await assertPathAbsentV2(targetDirectory);
      const finalQuarantine = await fs.lstat(quarantineDirectory);
      if (
        finalQuarantine.isSymbolicLink() ||
        !finalQuarantine.isDirectory() ||
        finalQuarantine.dev !== marker.record.directoryDev ||
        finalQuarantine.ino !== marker.record.directoryIno
      ) {
        throw new CreativeStudioStoreError('storage_error', 'Studio project deletion quarantine changed');
      }
      await assertIdentifiedRecordCurrentV2({
        root,
        authority: {
          path: quarantineDirectory,
          dev: finalQuarantine.dev,
          ino: finalQuarantine.ino,
        },
        identified: {
          file: path.join(quarantineDirectory, 'project.json'),
          bytes: quarantinedManifest.bytes,
          identity: quarantinedManifest.identity,
          record: null,
          quarantined: false,
        },
        maxBytes: STUDIO_PROJECT_V2_MAX_RECORD_BYTES,
      });
      try {
        await fs.rm(quarantineDirectory, { recursive: true, force: false });
      } catch (error) {
        throw storageError(error, 'Studio project deletion cleanup failed');
      }
      await syncDirectoryAuthorityV2(rootAuthority);
    }
    await assertPathAbsentV2(targetDirectory);
    await assertMarkerCurrent();
    if (marker.file === markerFile) {
      const publicationFile = `${markerFile}.publish`;
      let publication: Awaited<ReturnType<typeof readBoundedRegularFileWithIdentity>>;
      try {
        publication = await readBoundedRegularFileWithIdentity({
          fs,
          canonicalRoot: root,
          file: publicationFile,
          maxBytes: 2 * 1024,
        });
      } catch (error) {
        throw storageError(error, 'Studio project deletion marker publication could not be inspected');
      }
      if (publication !== null) {
        if (publication.bytes !== marker.bytes || !sameIdentityV2(publication.identity, marker.identity)) {
          throw new CreativeStudioStoreError('storage_error', 'Studio project deletion marker publication changed');
        }
        await assertMarkerCurrent();
        await assertIdentifiedRecordCurrentV2({
          root,
          authority: rootAuthority,
          identified: { ...marker, file: publicationFile },
          maxBytes: 2 * 1024,
        });
        try {
          await fs.rm(publicationFile);
        } catch (error) {
          throw storageError(error, 'Studio project deletion marker publication cleanup failed');
        }
        await syncDirectoryAuthorityV2(rootAuthority);
      }
    }
    await assertMarkerCurrent();
    try {
      await fs.rm(marker.file);
    } catch (error) {
      throw storageError(error, 'Studio project deletion marker cleanup failed');
    }
    await syncDirectoryAuthorityV2(rootAuthority);
  };

  const writeJsonExclusiveAtomic = async (root: string, file: string, serialized: string): Promise<void> => {
    try {
      await publishImmutableRecord({ fs, canonicalRoot: root, file, bytes: serialized });
    } catch (error) {
      if (error instanceof RecordIoError && error.code === 'already_exists') {
        throw new CreativeStudioStoreError('invalid_payload', 'Studio proposal already exists');
      }
      throw storageError(error, 'Studio proposal write failed');
    }
  };

  const pendingRecordFileEntries = async (directory: string): Promise<import('node:fs').Dirent[]> => {
    try {
      return await fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
      throw storageError(error, 'Creative Studio proposal directory could not be read');
    }
  };

  const readBoundedPendingRecordJson = async (
    file: string,
    region: 'proposal' | 'reference request' = 'proposal'
  ): Promise<unknown> => {
    try {
      const bytes = await readBoundedRegularFile({
        fs,
        canonicalRoot: await canonicalRoot(),
        file,
        maxBytes: STUDIO_PROPOSAL_MAX_RECORD_BYTES,
      });
      if (bytes === null) {
        throw new CreativeStudioStoreError('storage_error', `Creative Studio ${region} record is unavailable`);
      }
      return JSON.parse(bytes) as unknown;
    } catch (error) {
      if (error instanceof CreativeStudioStoreError) throw error;
      throw storageError(error, `Creative Studio ${region} record is unsafe`);
    }
  };

  const readProposalRecords = async (
    projectId: string,
    directories: { pending: string }
  ): Promise<StudioProposal[]> => {
    const entries = await pendingRecordFileEntries(directories.pending);
    const proposals: StudioProposal[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const proposalId = entry.name.slice(0, -'.json'.length);
      if (!isSafeProposalId(proposalId)) continue;
      try {
        const value = await readBoundedPendingRecordJson(path.join(directories.pending, entry.name));
        if (validateProposalRecord(projectId, proposalId, value)) proposals.push(value);
        else logError('[CreativeStudio] Ignoring malformed proposal record', new Error('InvalidProposalRecord'));
      } catch (error) {
        logError('[CreativeStudio] Ignoring unreadable proposal record', error);
      }
    }
    return proposals;
  };

  const readReferenceRequestRecords = async (
    project: StudioProject,
    directories: { pending: string }
  ): Promise<StudioReferenceRequest[]> => {
    const entries = await pendingRecordFileEntries(directories.pending);
    const requests: StudioReferenceRequest[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const requestId = entry.name.slice(0, -'.json'.length);
      if (!isSafeProposalId(requestId)) continue;
      try {
        // The bounded queue contains at most 50 records and logs each malformed entry independently.
        // eslint-disable-next-line no-await-in-loop
        const value = await readBoundedPendingRecordJson(
          path.join(directories.pending, entry.name),
          'reference request'
        );
        if (validateReferenceRequestRecord(project, requestId, value)) requests.push(value);
        else {
          logError(
            '[CreativeStudio] Ignoring malformed reference request record',
            new Error('InvalidReferenceRequestRecord')
          );
        }
      } catch (error) {
        logError('[CreativeStudio] Ignoring unreadable reference request record', error);
      }
    }
    return requests;
  };

  const readProposalDecisions = async (directories: {
    decisions: string;
  }): Promise<Map<string, StudioProposalDecision>> => {
    const entries = await pendingRecordFileEntries(directories.decisions);
    const decisions = new Map<string, StudioProposalDecision>();
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const proposalId = entry.name.slice(0, -'.json'.length);
      if (!isSafeProposalId(proposalId)) continue;
      try {
        const value = await readBoundedPendingRecordJson(path.join(directories.decisions, entry.name));
        if (validateProposalDecision(proposalId, value)) decisions.set(proposalId, value);
        else logError('[CreativeStudio] Ignoring malformed proposal decision', new Error('InvalidProposalDecision'));
      } catch (error) {
        logError('[CreativeStudio] Ignoring unreadable proposal decision', error);
      }
    }
    return decisions;
  };

  const effectiveProposal = (proposal: StudioProposal, decision: StudioProposalDecision | undefined): StudioProposal =>
    decision === undefined
      ? proposal
      : {
          ...proposal,
          status: decision.status,
          decidedAt: decision.decidedAt,
        };

  const reserveProposalSlot = async (slotsDirectory: string, proposalId: string): Promise<string> => {
    const reservation: StudioProposalSlot = {
      schemaVersion: 1,
      proposalId,
      reservedAt: now(),
    };
    for (let index = 0; index < STUDIO_PROPOSAL_MAX_PENDING_PER_PROJECT; index += 1) {
      const file = path.join(slotsDirectory, `${index}.slot`);
      let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
      try {
        // Slot creation is the cross-process pending-capacity compare-and-set.
        // eslint-disable-next-line no-await-in-loop
        handle = await fs.open(file, 'wx');
        // eslint-disable-next-line no-await-in-loop
        await handle.writeFile(JSON.stringify(reservation), { encoding: 'utf8' });
        // eslint-disable-next-line no-await-in-loop
        await handle.sync();
        // eslint-disable-next-line no-await-in-loop
        await handle.close();
        handle = undefined;
        return file;
      } catch (error) {
        await handle?.close().catch((): undefined => undefined);
        if (isRecord(error) && error.code === 'EEXIST') continue;
        await fs.rm(file, { force: true }).catch((): undefined => undefined);
        throw storageError(error, 'Studio proposal capacity could not be reserved');
      }
    }
    throw new CreativeStudioStoreError('busy', 'Studio proposal inbox is full');
  };

  const releaseProposalSlotFile = async (file: string): Promise<void> => {
    await fs.rm(file, { force: true });
  };

  const cleanupPendingRecordSlots = async <Slot extends { reservedAt: string }>(
    directories: { slots: string },
    liveRecordIds: Set<string>,
    validateSlot: (value: unknown) => value is Slot,
    recordIdOf: (slot: Slot) => string,
    region: 'Proposal' | 'Reference request'
  ): Promise<void> => {
    const entries = await pendingRecordFileEntries(directories.slots);
    const retainedRecordIds = new Set<string>();
    const cutoff = Date.parse(now()) - STUDIO_PROPOSAL_STALE_SLOT_MS;
    for (const entry of entries) {
      if (!entry.isFile() || !/^\d+\.slot$/.test(entry.name)) continue;
      const file = path.join(directories.slots, entry.name);
      try {
        // eslint-disable-next-line no-await-in-loop
        const value = await readBoundedPendingRecordJson(
          file,
          region === 'Proposal' ? 'proposal' : 'reference request'
        );
        const slot = validateSlot(value) ? value : undefined;
        const recordId = slot === undefined ? undefined : recordIdOf(slot);
        const retain = recordId !== undefined && liveRecordIds.has(recordId) && !retainedRecordIds.has(recordId);
        if (retain) {
          retainedRecordIds.add(recordId);
          continue;
        }
        const activeReservation =
          recordId !== undefined &&
          !liveRecordIds.has(recordId) &&
          slot !== undefined &&
          Date.parse(slot.reservedAt) > cutoff;
        if (activeReservation) continue;
        // eslint-disable-next-line no-await-in-loop
        await releaseProposalSlotFile(file);
      } catch (error) {
        logError(`[CreativeStudio] ${region} slot cleanup failed`, error);
      }
    }
  };

  const cleanupProposalSlots = async (directories: { slots: string }, proposals: StudioProposal[]): Promise<void> =>
    cleanupPendingRecordSlots(
      directories,
      new Set(proposals.filter((proposal) => proposal.status === 'pending').map((proposal) => proposal.id)),
      validateProposalSlot,
      (slot) => slot.proposalId,
      'Proposal'
    );

  const cleanupReferenceRequestSlots = async (
    directories: { slots: string },
    requests: StudioReferenceRequest[]
  ): Promise<void> =>
    cleanupPendingRecordSlots(
      directories,
      new Set(requests.map((request) => request.id)),
      validateReferenceRequestSlot,
      (slot) => slot.requestId,
      'Reference request'
    );

  const releaseProposalSlot = async (directories: { slots: string }, proposalId: string): Promise<void> => {
    const entries = await pendingRecordFileEntries(directories.slots);
    for (const entry of entries) {
      if (!entry.isFile() || !/^\d+\.slot$/.test(entry.name)) continue;
      const file = path.join(directories.slots, entry.name);
      try {
        // eslint-disable-next-line no-await-in-loop
        const value = await readBoundedPendingRecordJson(file);
        if (!validateProposalSlot(value) || value.proposalId !== proposalId) continue;
        // eslint-disable-next-line no-await-in-loop
        await releaseProposalSlotFile(file);
      } catch (error) {
        logError('[CreativeStudio] Proposal slot release failed', error);
      }
    }
  };

  const releaseReferenceRequestSlots = async (
    directories: { slots: string },
    requestIds: ReadonlySet<string>
  ): Promise<void> => {
    const entries = await pendingRecordFileEntries(directories.slots);
    for (const entry of entries) {
      if (!entry.isFile() || !/^\d+\.slot$/.test(entry.name)) continue;
      const file = path.join(directories.slots, entry.name);
      try {
        // eslint-disable-next-line no-await-in-loop
        const value = await readBoundedPendingRecordJson(file);
        if (!validateReferenceRequestSlot(value) || !requestIds.has(value.requestId)) continue;
        // eslint-disable-next-line no-await-in-loop
        await releaseProposalSlotFile(file);
      } catch (error) {
        logError('[CreativeStudio] Reference request slot release failed', error);
      }
    }
  };

  const appendProposalDecision = async (
    root: string,
    decisionsDirectory: string,
    proposalId: string,
    status: StudioProposalDecision['status']
  ): Promise<StudioProposalDecision> => {
    const decision: StudioProposalDecision = {
      schemaVersion: 1,
      proposalId,
      status,
      decidedAt: now(),
    };
    await writeJsonExclusiveAtomic(root, path.join(decisionsDirectory, `${proposalId}.json`), JSON.stringify(decision));
    return decision;
  };

  const reapPendingProposals = async (
    root: string,
    directories: { pending: string; decisions: string; slots: string }
  ): Promise<void> => {
    const [proposals, decisions] = await Promise.all([
      readProposalRecords(path.basename(path.dirname(path.dirname(directories.pending))), directories),
      readProposalDecisions(directories),
    ]);
    const cutoff = Date.parse(now()) - STUDIO_PROPOSAL_PENDING_TTL_MS;
    for (const proposal of proposals) {
      if (decisions.has(proposal.id) || Date.parse(proposal.createdAt) > cutoff) continue;
      try {
        // A bounded project ledger has at most 50 live pending records.
        // eslint-disable-next-line no-await-in-loop
        const decision = await appendProposalDecision(root, directories.decisions, proposal.id, 'expired');
        decisions.set(proposal.id, decision);
        // eslint-disable-next-line no-await-in-loop
        await releaseProposalSlot(directories, proposal.id);
      } catch (error) {
        if (!(error instanceof CreativeStudioStoreError) || error.code !== 'invalid_payload') throw error;
      }
    }
    await cleanupProposalSlots(
      directories,
      proposals.map((proposal) => effectiveProposal(proposal, decisions.get(proposal.id)))
    );
  };

  const reapPendingProposalsBeforeWrite = async (
    root: string,
    projectId: string,
    directories: { pending: string; decisions: string; slots: string }
  ): Promise<void> => {
    const observedAt = now();
    if (!isCanonicalIsoTimestamp(observedAt)) {
      throw new CreativeStudioStoreError('storage_error', 'Studio proposal reap clock is invalid');
    }
    const currentTime = Date.parse(observedAt);
    const lastReapedAt = proposalReapedAt.get(projectId);
    if (lastReapedAt !== undefined && currentTime - lastReapedAt < STUDIO_PROPOSAL_STALE_SLOT_MS) return;
    await reapPendingProposals(root, directories);
    proposalReapedAt.set(projectId, currentTime);
  };

  const reapPendingReferenceRequests = async (
    project: StudioProject,
    directories: { pending: string; slots: string }
  ): Promise<void> => {
    const requests = await readReferenceRequestRecords(project, directories);
    const cutoff = Date.parse(now()) - STUDIO_PROPOSAL_PENDING_TTL_MS;
    const retained: StudioReferenceRequest[] = [];
    for (const request of requests) {
      if (Date.parse(request.createdAt) > cutoff) {
        retained.push(request);
        continue;
      }
      try {
        // A bounded project ledger has at most 50 live pending records.
        // eslint-disable-next-line no-await-in-loop
        await fs.rm(path.join(directories.pending, `${request.id}.json`));
      } catch (error) {
        retained.push(request);
        logError('[CreativeStudio] Reference request expiry failed', error);
      }
    }
    await cleanupReferenceRequestSlots(directories, retained);
  };

  const listProjectProposals = async (
    root: string,
    projectId: string,
    directories: { pending: string; decisions: string; slots: string }
  ): Promise<StudioProposal[]> => {
    await reapPendingProposals(root, directories);
    const [proposals, decisions] = await Promise.all([
      readProposalRecords(projectId, directories),
      readProposalDecisions(directories),
    ]);
    const effective = proposals
      .map((proposal) => effectiveProposal(proposal, decisions.get(proposal.id)))
      .toSorted((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
    await cleanupProposalSlots(directories, effective);
    return effective;
  };

  const readProject = async (root: string, projectId: string): Promise<StudioProject | null> => {
    try {
      const file = await projectFile(root, projectId, false);
      if (file === null) return null;
      const raw = JSON.parse(await fs.readFile(file, 'utf8')) as unknown;
      const migrated = migrateSchemaV1Project(raw);
      if (validateProject(migrated) && migrated.id === projectId) return migrated;
      throw new CreativeStudioStoreError('storage_error', 'Malformed Studio project manifest');
    } catch (error) {
      if (error instanceof CreativeStudioStoreError) throw error;
      if (isRecord(error) && error.code === 'ENOENT') return null;
      throw new CreativeStudioStoreError(
        'storage_error',
        error instanceof Error ? error.message : 'Studio storage read failed'
      );
    }
  };

  const enqueue = <T>(projectId: string, work: () => Promise<T>): Promise<T> => {
    const previous = queues.get(projectId) ?? Promise.resolve();
    const next = previous.catch((): undefined => undefined).then(() => work());
    queues.set(projectId, next);
    void next
      .finally(() => {
        if (queues.get(projectId) === next) queues.delete(projectId);
      })
      .catch((): undefined => undefined);
    return next;
  };

  const inspectProjectFileV2 = async (root: string, projectId: string): Promise<ProjectFileInspectionV2> => {
    const directoryPath = await projectDirectory(root, projectId, false);
    if (directoryPath === null) return { status: 'not_found', projectId };
    const directory = await captureDirectoryAuthorityV2(directoryPath);
    const file = resolveRootChild(directory.path, 'project.json');
    await assertRegularFileOrMissing(file);
    const record = await readBoundedStudioV2File(root, file);
    if (record === null) return { status: 'not_found', projectId };
    if (record.status === 'unsupported_prototype_schema') {
      return { status: 'unsupported_prototype_schema', projectId };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(record.bytes) as unknown;
    } catch {
      return {
        status: 'malformed_v2',
        projectId,
        error: new CreativeStudioStoreError('storage_error', 'Malformed schema-2 Studio project manifest'),
      };
    }
    if (isRecord(parsed) && parsed.schemaVersion === 1) {
      return { status: 'unsupported_prototype_schema', projectId };
    }
    if (
      !isRecord(parsed) ||
      parsed.schemaVersion !== 2 ||
      !validateStudioProjectV2(parsed) ||
      parsed.id !== projectId
    ) {
      return {
        status: 'malformed_v2',
        projectId,
        error: new CreativeStudioStoreError('storage_error', 'Malformed schema-2 Studio project manifest'),
      };
    }
    await assertDirectoryAuthorityV2(directory);
    return { status: 'supported', project: parsed, bytes: record.bytes, identity: record.identity, directory };
  };

  const readStableDirectoryEntriesV2 = async (authority: DirectoryAuthorityV2): Promise<import('node:fs').Dirent[]> => {
    try {
      await assertDirectoryAuthorityV2(authority);
      const entries = await fs.readdir(authority.path, { withFileTypes: true });
      await assertDirectoryAuthorityV2(authority);
      return entries.toSorted((left, right) => left.name.localeCompare(right.name));
    } catch (error) {
      if (error instanceof CreativeStudioStoreError) throw error;
      throw storageError(error, 'Schema-2 Studio proposal directory could not be read');
    }
  };

  const parseIdentifiedJsonV2 = async <RecordType>(input: {
    root: string;
    file: string;
    quarantined?: boolean;
    maxBytes?: number;
    parse: (
      value: unknown
    ) => { status: 'valid'; record: RecordType } | { status: 'unsupported_prototype_schema' } | { status: 'invalid' };
  }): Promise<IdentifiedRecordV2<RecordType>> => {
    const maxBytes = input.maxBytes ?? STUDIO_PROPOSAL_MAX_RECORD_BYTES;
    let identified: Awaited<ReturnType<typeof readBoundedRegularFileWithIdentity>>;
    try {
      identified = await readBoundedRegularFileWithIdentity({
        fs,
        canonicalRoot: input.root,
        file: input.file,
        maxBytes,
      });
    } catch (error) {
      throw storageError(error, 'Schema-2 Studio proposal record is unsafe');
    }
    if (identified === null) {
      throw new CreativeStudioStoreError('storage_error', 'Schema-2 Studio proposal record changed during read');
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(identified.bytes) as unknown;
    } catch {
      throw new CreativeStudioStoreError('storage_error', 'Malformed schema-2 Studio proposal record');
    }
    const result = input.parse(parsed);
    if (result.status === 'unsupported_prototype_schema') {
      throw new CreativeStudioStoreError(
        'unsupported_prototype_schema',
        'Unsupported prototype Studio proposal schema'
      );
    }
    if (result.status !== 'valid') {
      throw new CreativeStudioStoreError('storage_error', 'Malformed schema-2 Studio proposal record');
    }
    return {
      file: input.file,
      bytes: identified.bytes,
      identity: identified.identity,
      record: result.record,
      quarantined: input.quarantined ?? false,
    };
  };

  const parseAttributionRecordV2 = (
    projectId: string,
    proposalId: string,
    value: unknown
  ):
    | { status: 'valid'; record: StudioProposalCommitAttributionV2 }
    | { status: 'unsupported_prototype_schema' }
    | { status: 'invalid' } => {
    if (isRecord(value) && value.schemaVersion === 1) return { status: 'unsupported_prototype_schema' };
    return validateProposalCommitAttributionV2(projectId, proposalId, value)
      ? { status: 'valid', record: value }
      : { status: 'invalid' };
  };

  const readProposalLedgerV2 = async (input: {
    root: string;
    projectId: string;
    directories: ProposalDirectoriesV2;
  }): Promise<ProposalLedgerV2> => {
    await assertProposalDirectoryAuthoritiesV2(input.directories);
    const pendingResidues = await reconcileOwnedPendingPublicationResiduesV2({
      root: input.root,
      authority: input.directories.pending,
      maxBytes: STUDIO_PROPOSAL_MAX_RECORD_BYTES,
      validateNamedBase: (namedBase) =>
        namedBase.endsWith('.json') && isSafeProposalId(namedBase.slice(0, -'.json'.length)),
      validateRecord: (namedBase, value) => {
        const proposalId = namedBase.slice(0, -'.json'.length);
        return parseStudioProposalRecordV2({ projectId: input.projectId, proposalId, value }).status === 'valid';
      },
      allowForeignNamedPhase: true,
      deferCleanup: true,
    });
    const slotPublicationResidues = await reconcileOwnedPendingPublicationResiduesV2({
      root: input.root,
      authority: input.directories.slots,
      maxBytes: STUDIO_PROPOSAL_MAX_RECORD_BYTES,
      validateNamedBase: (namedBase) => isCanonicalV2SlotFileName(namedBase, STUDIO_PROPOSAL_MAX_PENDING_PER_PROJECT),
      validateRecord: (_namedBase, value) => parseStudioProposalSlotV2(value).status === 'valid',
      allowForeignNamedPhase: true,
      deferCleanup: true,
    });
    const slotCleanupResidues = await reconcileOwnedSlotCleanupResiduesV2({
      root: input.root,
      pending: input.directories.pending,
      slots: input.directories.slots,
      maxBytes: STUDIO_PROPOSAL_MAX_RECORD_BYTES,
      capacity: STUDIO_PROPOSAL_MAX_PENDING_PER_PROJECT,
      recordId: (slot: StudioProposalSlotV2) => slot.proposalId,
      validatePending: (proposalId, value) =>
        parseStudioProposalRecordV2({ projectId: input.projectId, proposalId, value }).status === 'valid',
      parse: parseStudioProposalSlotV2,
      deferCleanup: true,
    });
    const [decisionResidues, attributionResidues] = await Promise.all([
      reconcileJournalPublicationResiduesV2({
        root: input.root,
        authority: input.directories.decisions,
        validateNamedBase: (namedBase) =>
          namedBase.endsWith('.json') && isSafeProposalId(namedBase.slice(0, -'.json'.length)),
        parseRecord: (namedBase, value) => {
          const proposalId = namedBase.slice(0, -'.json'.length);
          const parsed = parseStudioProposalDecisionV2({ proposalId, value });
          return parsed.status === 'valid' ? parsed.record : null;
        },
        deferCleanup: true,
      }),
      reconcileJournalPublicationResiduesV2({
        root: input.root,
        authority: input.directories.commits,
        validateNamedBase: (namedBase) =>
          namedBase.endsWith(PROPOSAL_V2_COMMIT_FILE_SUFFIX) &&
          isSafeProposalId(namedBase.slice(0, -PROPOSAL_V2_COMMIT_FILE_SUFFIX.length)),
        parseRecord: (namedBase, value) => {
          const proposalId = namedBase.slice(0, -PROPOSAL_V2_COMMIT_FILE_SUFFIX.length);
          const parsed = parseAttributionRecordV2(input.projectId, proposalId, value);
          return parsed.status === 'valid' ? parsed.record : null;
        },
        deferCleanup: true,
      }),
    ]);
    const [rawPendingEntries, rawDecisionEntries, rawSlotEntries, rawCommitEntries] = await Promise.all([
      readStableDirectoryEntriesV2(input.directories.pending),
      readStableDirectoryEntriesV2(input.directories.decisions),
      readStableDirectoryEntriesV2(input.directories.slots),
      readStableDirectoryEntriesV2(input.directories.commits),
    ]);
    const decisionResidueNames = new Set(decisionResidues.map((residue) => path.basename(residue.identified.file)));
    const attributionResidueNames = new Set(
      attributionResidues.map((residue) => path.basename(residue.identified.file))
    );
    const pendingResidueNames = new Set(pendingResidues.map((record) => path.basename(record.identified.file)));
    const slotResidueNames = new Set([
      ...slotPublicationResidues.map((record) => path.basename(record.identified.file)),
      ...slotCleanupResidues.map((record) => path.basename(record.identified.file)),
    ]);
    const pendingEntries = rawPendingEntries.filter((entry) => !pendingResidueNames.has(entry.name));
    const slotEntries = rawSlotEntries.filter((entry) => !slotResidueNames.has(entry.name));
    const decisionEntries = rawDecisionEntries.filter((entry) => !decisionResidueNames.has(entry.name));
    const commitEntries = rawCommitEntries.filter((entry) => !attributionResidueNames.has(entry.name));
    const proposals = new Map<string, IdentifiedRecordV2<StudioProposalRecordV2>>();
    const decisions = new Map<string, IdentifiedRecordV2<StudioProposalDecisionV2>>();
    const slots = new Map<string, IdentifiedRecordV2<StudioProposalSlotV2>[]>();
    const attributions: IdentifiedRecordV2<StudioProposalCommitAttributionV2>[] = [];

    for (const entry of pendingEntries) {
      if (!entry.isFile() || entry.isSymbolicLink() || !entry.name.endsWith('.json')) {
        throw new CreativeStudioStoreError('storage_error', 'Malformed schema-2 Studio proposal directory');
      }
      const proposalId = entry.name.slice(0, -'.json'.length);
      if (!isSafeProposalId(proposalId) || proposals.has(proposalId)) {
        throw new CreativeStudioStoreError('storage_error', 'Malformed schema-2 Studio proposal identity');
      }
      // The proposal ledger is bounded by its slot family.
      // eslint-disable-next-line no-await-in-loop
      const proposal = await parseIdentifiedJsonV2({
        root: input.root,
        file: path.join(input.directories.pending.path, entry.name),
        parse: (value) => parseStudioProposalRecordV2({ projectId: input.projectId, proposalId, value }),
      });
      proposals.set(proposalId, proposal);
    }
    for (const residue of pendingResidues) {
      if (!residue.effective) continue;
      const proposalId = path.basename(residue.namedFile, '.json');
      let value: unknown;
      try {
        value = JSON.parse(residue.identified.bytes) as unknown;
      } catch {
        throw new CreativeStudioStoreError('storage_error', 'Malformed schema-2 Studio proposal recovery record');
      }
      const parsed = parseStudioProposalRecordV2({ projectId: input.projectId, proposalId, value });
      if (parsed.status !== 'valid' || proposals.has(proposalId)) {
        throw new CreativeStudioStoreError('storage_error', 'Ambiguous schema-2 Studio proposal recovery record');
      }
      proposals.set(proposalId, { ...residue.identified, record: parsed.record });
    }
    for (const entry of decisionEntries) {
      if (!entry.isFile() || entry.isSymbolicLink() || !entry.name.endsWith('.json')) {
        throw new CreativeStudioStoreError('storage_error', 'Malformed schema-2 Studio proposal decision directory');
      }
      const proposalId = entry.name.slice(0, -'.json'.length);
      if (!isSafeProposalId(proposalId) || decisions.has(proposalId)) {
        throw new CreativeStudioStoreError('storage_error', 'Malformed schema-2 Studio proposal decision identity');
      }
      // eslint-disable-next-line no-await-in-loop
      const decision = await parseIdentifiedJsonV2({
        root: input.root,
        file: path.join(input.directories.decisions.path, entry.name),
        parse: (value) => parseStudioProposalDecisionV2({ proposalId, value }),
      });
      decisions.set(proposalId, decision);
    }

    for (const entry of slotEntries) {
      const cleanup = parseIdentityBoundCleanupNameV2(entry.name);
      const quarantined = cleanup !== null;
      const namedSlot = cleanup?.namedFileName ?? entry.name;
      if (
        !entry.isFile() ||
        entry.isSymbolicLink() ||
        !isCanonicalV2SlotFileName(namedSlot, STUDIO_PROPOSAL_MAX_PENDING_PER_PROJECT)
      ) {
        throw new CreativeStudioStoreError('storage_error', 'Malformed schema-2 Studio proposal slot directory');
      }
      // eslint-disable-next-line no-await-in-loop
      const slot = await parseIdentifiedJsonV2({
        root: input.root,
        file: path.join(input.directories.slots.path, entry.name),
        quarantined,
        parse: parseStudioProposalSlotV2,
      });
      if (
        cleanup !== null &&
        (!sameIdentityV2(slot.identity, cleanup.identity) || sha256Utf8(slot.bytes) !== cleanup.digest)
      ) {
        throw new CreativeStudioStoreError('storage_error', 'Studio proposal cleanup authority mismatch');
      }
      const held = slots.get(slot.record.proposalId) ?? [];
      held.push(slot);
      slots.set(slot.record.proposalId, held);
    }
    for (const residue of slotCleanupResidues) {
      if (!residue.effective) continue;
      const effective = { ...residue.identified, quarantined: false };
      const held = slots.get(effective.record.proposalId) ?? [];
      held.push(effective);
      slots.set(effective.record.proposalId, held);
    }
    for (const residue of slotPublicationResidues) {
      if (!residue.effective) continue;
      let value: unknown;
      try {
        value = JSON.parse(residue.identified.bytes) as unknown;
      } catch {
        throw new CreativeStudioStoreError('storage_error', 'Malformed schema-2 Studio proposal slot recovery');
      }
      const parsed = parseStudioProposalSlotV2(value);
      if (parsed.status !== 'valid') {
        throw new CreativeStudioStoreError('storage_error', 'Malformed schema-2 Studio proposal slot recovery');
      }
      const held = slots.get(parsed.record.proposalId) ?? [];
      held.push({ ...residue.identified, record: parsed.record });
      slots.set(parsed.record.proposalId, held);
    }

    for (const entry of commitEntries) {
      const cleanup = parseIdentityBoundCleanupNameV2(entry.name);
      const quarantined = cleanup !== null;
      const namedCommit = cleanup?.namedFileName ?? entry.name;
      if (!entry.isFile() || entry.isSymbolicLink() || !namedCommit.endsWith(PROPOSAL_V2_COMMIT_FILE_SUFFIX)) {
        throw new CreativeStudioStoreError('storage_error', 'Malformed Studio proposal attribution directory');
      }
      const proposalId = namedCommit.slice(0, -PROPOSAL_V2_COMMIT_FILE_SUFFIX.length);
      if (!isSafeProposalId(proposalId)) {
        throw new CreativeStudioStoreError('storage_error', 'Malformed Studio proposal attribution identity');
      }
      // eslint-disable-next-line no-await-in-loop
      const attribution = await parseIdentifiedJsonV2({
        root: input.root,
        file: path.join(input.directories.commits.path, entry.name),
        quarantined,
        parse: (value) => parseAttributionRecordV2(input.projectId, proposalId, value),
      });
      if (
        cleanup !== null &&
        (!sameIdentityV2(attribution.identity, cleanup.identity) || sha256Utf8(attribution.bytes) !== cleanup.digest)
      ) {
        throw new CreativeStudioStoreError('storage_error', 'Studio proposal cleanup authority mismatch');
      }
      attributions.push(attribution);
    }
    for (const residue of decisionResidues) {
      if (!residue.effective) continue;
      const proposalId = path.basename(residue.namedFile, '.json');
      if (decisions.has(proposalId)) {
        throw new CreativeStudioStoreError('storage_error', 'Ambiguous Studio proposal decision publication');
      }
      decisions.set(proposalId, residue.identified);
    }
    for (const residue of attributionResidues) {
      if (residue.effective) attributions.push(residue.identified);
    }

    await assertProposalDirectoryAuthoritiesV2(input.directories);
    if (attributions.length > 1) {
      throw new CreativeStudioStoreError('storage_error', 'Ambiguous Studio proposal commit attribution');
    }
    for (const [proposalId, decision] of decisions) {
      const proposal = proposals.get(proposalId);
      if (
        proposal === undefined ||
        decision.record.proposalId !== proposalId ||
        Date.parse(decision.record.decidedAt) < Date.parse(proposal.record.createdAt) ||
        (decision.record.status === 'expired' &&
          Date.parse(decision.record.decidedAt) <
            Date.parse(proposal.record.createdAt) + STUDIO_PROPOSAL_PENDING_TTL_MS)
      ) {
        throw new CreativeStudioStoreError('storage_error', 'Studio proposal decision has no immutable proposal');
      }
    }
    for (const [proposalId, held] of slots) {
      if (held.length > 1) {
        throw new CreativeStudioStoreError('storage_error', 'Ambiguous Studio proposal slot authority');
      }
      const proposal = proposals.get(proposalId);
      if (proposal !== undefined && decisions.get(proposalId) === undefined && held[0].quarantined) {
        throw new CreativeStudioStoreError('storage_error', 'Pending Studio proposal slot is quarantined');
      }
    }
    for (const proposalId of proposals.keys()) {
      if (decisions.has(proposalId)) continue;
      const held = slots.get(proposalId) ?? [];
      if (held.length !== 1 || held[0].quarantined) {
        throw new CreativeStudioStoreError('storage_error', 'Pending Studio proposal has no exact slot authority');
      }
    }
    const unresolvedCount = [...proposals.keys()].filter((proposalId) => !decisions.has(proposalId)).length;
    // Terminal proposal sources and decisions are immutable audit history. They are
    // deliberately excluded from the live admission cap and never turn an otherwise
    // readable project into a permanent storage error solely because history grew.
    if (unresolvedCount > STUDIO_PROPOSAL_MAX_PENDING_PER_PROJECT) {
      throw new CreativeStudioStoreError('storage_error', 'Schema-2 Studio proposal ledger exceeds its capacity');
    }
    return {
      directories: input.directories,
      proposals,
      decisions,
      slots,
      attributions,
      journalResidues: [
        ...decisionResidues.map((residue) => ({ family: 'decisions' as const, ...residue })),
        ...attributionResidues.map((residue) => ({ family: 'commits' as const, ...residue })),
      ],
      writerResidues: [
        ...pendingResidues.map((residue) => ({ family: 'pending' as const, ...residue })),
        ...slotPublicationResidues.map((residue) => ({ family: 'slots' as const, ...residue })),
        ...slotCleanupResidues.map(({ identified, namedFile }) => ({
          family: 'slots' as const,
          identified: { ...identified, record: null } as IdentifiedRecordV2<null>,
          namedFile,
          phase: 'cleanup' as const,
          effective: true,
        })),
      ],
    };
  };

  const assertProposalLedgerEntrySetCurrentV2 = async (
    ledger: ProposalLedgerV2,
    publication?: {
      decision?: IdentifiedRecordV2<null>;
      attribution?: IdentifiedRecordV2<null>;
    }
  ): Promise<void> => {
    const root = path.dirname(ledger.directories.project.path);
    const assertEntries = async (
      authority: DirectoryAuthorityV2,
      records: readonly IdentifiedRecordV2<unknown>[]
    ): Promise<void> => {
      const expected = new Map(records.map((record) => [path.basename(record.file), record]));
      const entries = await readStableDirectoryEntriesV2(authority);
      const observed = new Set<string>();
      for (const entry of entries) {
        const identified = expected.get(entry.name);
        if (!entry.isFile() || entry.isSymbolicLink()) {
          throw new CreativeStudioStoreError('storage_error', 'Studio proposal directory entry set changed');
        }
        if (identified === undefined) {
          const named = entry.name.endsWith('.publish')
            ? expected.get(entry.name.slice(0, -'.publish'.length))
            : undefined;
          if (named === undefined) {
            throw new CreativeStudioStoreError('storage_error', 'Studio proposal directory entry set changed');
          }
          // A just-published immutable journal may have its durable recovery twin before the
          // caller refreshes the ledger. Admit only the exact same inode and bytes.
          // eslint-disable-next-line no-await-in-loop
          await assertIdentifiedRecordCurrentV2({
            root,
            authority,
            identified: { ...named, file: path.join(authority.path, entry.name) },
          });
          continue;
        }
        observed.add(entry.name);
        // eslint-disable-next-line no-await-in-loop
        await assertIdentifiedRecordCurrentV2({ root, authority, identified });
      }
      if ([...expected.keys()].some((name) => !observed.has(name))) {
        throw new CreativeStudioStoreError('storage_error', 'Studio proposal directory entry set changed');
      }
      await assertDirectoryAuthorityV2(authority);
    };
    await Promise.all([
      assertEntries(ledger.directories.pending, [
        ...ledger.proposals.values(),
        ...ledger.writerResidues.filter((residue) => residue.family === 'pending').map((residue) => residue.identified),
      ]),
      assertEntries(ledger.directories.decisions, [
        ...ledger.decisions.values(),
        ...ledger.journalResidues
          .filter((residue) => residue.family === 'decisions')
          .map((residue) => residue.identified),
        ...(publication?.decision === undefined ? [] : [publication.decision]),
      ]),
      assertEntries(ledger.directories.slots, [
        ...[...ledger.slots.values()].flat(),
        ...ledger.writerResidues.filter((residue) => residue.family === 'slots').map((residue) => residue.identified),
      ]),
      assertEntries(ledger.directories.commits, [
        ...ledger.attributions,
        ...ledger.journalResidues
          .filter((residue) => residue.family === 'commits')
          .map((residue) => residue.identified),
        ...(publication?.attribution === undefined ? [] : [publication.attribution]),
      ]),
    ]);
    await assertProposalDirectoryAuthoritiesV2(ledger.directories);
  };

  const cleanupJournalPublicationResidueV2 = async <RecordType>(input: {
    root: string;
    authority: DirectoryAuthorityV2;
    identified: IdentifiedRecordV2<RecordType>;
    namedFile: string;
    effective: boolean;
    maxBytes: number;
    authorizeProject: () => Promise<void>;
  }): Promise<IdentifiedRecordV2<RecordType>> => {
    await assertIdentifiedRecordCurrentV2({
      root: input.root,
      authority: input.authority,
      identified: input.identified,
      maxBytes: input.maxBytes,
    });
    if (input.effective) {
      await assertPathAbsentV2(input.namedFile);
      await input.authorizeProject();
      await assertIdentifiedRecordCurrentV2({
        root: input.root,
        authority: input.authority,
        identified: input.identified,
        maxBytes: input.maxBytes,
      });
      try {
        await fs.link(input.identified.file, input.namedFile);
      } catch (error) {
        if (!isRecord(error) || error.code !== 'EEXIST') {
          throw storageError(error, 'Studio journal publication residue could not be promoted');
        }
      }
      await syncDirectoryAuthorityV2(input.authority);
      const named = await readBoundedRegularFileWithIdentity({
        fs,
        canonicalRoot: input.root,
        file: input.namedFile,
        maxBytes: input.maxBytes,
      });
      if (
        named === null ||
        named.bytes !== input.identified.bytes ||
        !sameIdentityV2(named.identity, input.identified.identity)
      ) {
        throw new CreativeStudioStoreError('storage_error', 'Studio journal publication promotion changed');
      }
    }
    await assertIdentifiedRecordCurrentV2({
      root: input.root,
      authority: input.authority,
      identified: input.identified,
      maxBytes: input.maxBytes,
    });
    const named = await readBoundedRegularFileWithIdentity({
      fs,
      canonicalRoot: input.root,
      file: input.namedFile,
      maxBytes: input.maxBytes,
    });
    if (
      named === null ||
      named.bytes !== input.identified.bytes ||
      !sameIdentityV2(named.identity, input.identified.identity)
    ) {
      throw new CreativeStudioStoreError('storage_error', 'Studio journal publication authority changed');
    }
    await input.authorizeProject();
    const identifiedNamed: IdentifiedRecordV2<RecordType> = { ...input.identified, file: input.namedFile };
    await assertIdentifiedRecordCurrentV2({
      root: input.root,
      authority: input.authority,
      identified: identifiedNamed,
      maxBytes: input.maxBytes,
    });
    // Keep the recognized publication companion as a durable recovery hardlink. It is removed
    // only with the terminal relation that makes the underlying journal record unnecessary.
    return identifiedNamed;
  };

  const cleanupProposalJournalPublicationResiduesV2 = async (
    root: string,
    ledger: ProposalLedgerV2,
    authorizeProject: () => Promise<void>
  ): Promise<ProposalLedgerV2> => {
    const current: ProposalLedgerV2 = {
      ...ledger,
      decisions: new Map(ledger.decisions),
      attributions: [...ledger.attributions],
      journalResidues: [...ledger.journalResidues],
    };
    for (const residue of ledger.journalResidues) {
      const authority = current.directories[residue.family];
      await assertProposalLedgerEntrySetCurrentV2(current);
      if (residue.family === 'decisions') {
        // eslint-disable-next-line no-await-in-loop
        const named = await cleanupJournalPublicationResidueV2({
          root,
          authority,
          identified: residue.identified,
          namedFile: residue.namedFile,
          effective: residue.effective,
          maxBytes: STUDIO_PROPOSAL_MAX_RECORD_BYTES,
          authorizeProject,
        });
        if (residue.effective) current.decisions.set(residue.identified.record.proposalId, named);
      } else {
        // eslint-disable-next-line no-await-in-loop
        const named = await cleanupJournalPublicationResidueV2({
          root,
          authority,
          identified: residue.identified,
          namedFile: residue.namedFile,
          effective: residue.effective,
          maxBytes: STUDIO_PROPOSAL_MAX_RECORD_BYTES,
          authorizeProject,
        });
        if (residue.effective) {
          current.attributions = current.attributions.map((attribution) =>
            attribution.file === residue.identified.file ? named : attribution
          );
        }
      }
      current.journalResidues = current.journalResidues.map((candidate) =>
        candidate.identified.file === residue.identified.file ? { ...candidate, effective: false } : candidate
      );
    }
    return current;
  };

  const removeJournalPublicationCompanionV2 = async (input: {
    root: string;
    authority: DirectoryAuthorityV2;
    named: IdentifiedRecordV2<unknown>;
    maxBytes: number;
    authorize: () => Promise<void>;
  }): Promise<void> => {
    const companionFile = `${input.named.file}.publish`;
    let companion: Awaited<ReturnType<typeof readBoundedRegularFileWithIdentity>>;
    try {
      companion = await readBoundedRegularFileWithIdentity({
        fs,
        canonicalRoot: input.root,
        file: companionFile,
        maxBytes: input.maxBytes,
      });
    } catch (error) {
      throw storageError(error, 'Studio journal recovery companion could not be inspected');
    }
    if (companion === null) return;
    if (companion.bytes !== input.named.bytes || !sameIdentityV2(companion.identity, input.named.identity)) {
      throw new CreativeStudioStoreError('storage_error', 'Studio journal recovery companion is ambiguous');
    }
    await Promise.all([
      assertIdentifiedRecordCurrentV2({
        root: input.root,
        authority: input.authority,
        identified: input.named,
        maxBytes: input.maxBytes,
      }),
      assertIdentifiedRecordCurrentV2({
        root: input.root,
        authority: input.authority,
        identified: {
          file: companionFile,
          bytes: companion.bytes,
          identity: companion.identity,
          record: null,
          quarantined: false,
        },
        maxBytes: input.maxBytes,
      }),
    ]);
    await input.authorize();
    try {
      await fs.rm(companionFile);
    } catch (error) {
      throw storageError(error, 'Studio journal recovery companion could not be removed');
    }
    await syncDirectoryAuthorityV2(input.authority);
    await assertIdentifiedRecordCurrentV2({
      root: input.root,
      authority: input.authority,
      identified: input.named,
      maxBytes: input.maxBytes,
    });
  };

  const cleanupCapturedWriterResiduesV2 = async <SlotRecord>(input: {
    root: string;
    pending: DirectoryAuthorityV2;
    slots: DirectoryAuthorityV2;
    residues: Array<{
      family: 'pending' | 'slots';
      identified: IdentifiedRecordV2<null>;
      namedFile: string;
      phase: 'tmp' | 'ready' | 'cleanup';
      effective: boolean;
    }>;
    maxBytes: number;
    capacity: number;
    parseSlot: (
      value: unknown
    ) => { status: 'valid'; record: SlotRecord } | { status: 'unsupported_prototype_schema' } | { status: 'invalid' };
    recordId: (record: SlotRecord) => string;
    validatePending: (recordId: string, value: unknown) => boolean;
    authorizeProject: () => Promise<void>;
    recoveryAction: (residue: {
      family: 'pending' | 'slots';
      identified: IdentifiedRecordV2<null>;
      namedFile: string;
      phase: 'tmp' | 'ready' | 'cleanup';
      effective: boolean;
    }) => Promise<'promote' | 'rollback' | 'retain'>;
  }): Promise<void> => {
    const orderedResidues = [...input.residues].toSorted(
      (left, right) => Number(right.phase === 'ready') - Number(left.phase === 'ready')
    );
    const removedResidueFiles = new Set<string>();
    const assertValidForeignNamedPhaseV2 = (collision: {
      family: 'pending' | 'slots';
      namedFile: string;
      phaseBytes: string;
      namedBytes: string;
    }): void => {
      let phaseValue: unknown;
      let namedValue: unknown;
      try {
        phaseValue = JSON.parse(collision.phaseBytes) as unknown;
        namedValue = JSON.parse(collision.namedBytes) as unknown;
      } catch {
        throw new CreativeStudioStoreError('storage_error', 'Studio writer recovery authority is ambiguous');
      }
      if (collision.family === 'pending') {
        const namedBase = path.basename(collision.namedFile);
        if (!namedBase.endsWith('.json')) {
          throw new CreativeStudioStoreError('storage_error', 'Studio writer recovery authority is ambiguous');
        }
        const recordId = namedBase.slice(0, -'.json'.length);
        if (!input.validatePending(recordId, phaseValue) || !input.validatePending(recordId, namedValue)) {
          throw new CreativeStudioStoreError('storage_error', 'Studio writer recovery authority is ambiguous');
        }
        return;
      }
      const phaseSlot = input.parseSlot(phaseValue);
      const namedSlot = input.parseSlot(namedValue);
      if (
        phaseSlot.status !== 'valid' ||
        namedSlot.status !== 'valid' ||
        input.recordId(phaseSlot.record) === input.recordId(namedSlot.record)
      ) {
        throw new CreativeStudioStoreError('storage_error', 'Studio writer recovery authority is ambiguous');
      }
    };
    for (const residue of orderedResidues) {
      if (removedResidueFiles.has(residue.identified.file)) continue;
      const authority = residue.family === 'pending' ? input.pending : input.slots;
      if (residue.identified.file.endsWith('.tmp')) {
        const readyFile = `${residue.identified.file.slice(0, -'.tmp'.length)}.ready`;
        const namedFile = residue.identified.file.replace(/\.\d+_\d+\.tmp$/, '');
        const [ready, named] = await Promise.all([
          readBoundedRegularFileWithIdentity({
            fs,
            canonicalRoot: input.root,
            file: readyFile,
            maxBytes: input.maxBytes,
          }),
          readBoundedRegularFileWithIdentity({
            fs,
            canonicalRoot: input.root,
            file: namedFile,
            maxBytes: input.maxBytes,
          }),
        ]);
        const namedIsExact =
          named !== null &&
          named.bytes === residue.identified.bytes &&
          sameIdentityV2(named.identity, residue.identified.identity);
        if (named !== null && !namedIsExact) {
          assertValidForeignNamedPhaseV2({
            family: residue.family,
            namedFile,
            phaseBytes: residue.identified.bytes,
            namedBytes: named.bytes,
          });
        }
        if (ready !== null) {
          if (
            ready.bytes !== residue.identified.bytes ||
            !sameIdentityV2(ready.identity, residue.identified.identity) ||
            named === null
          ) {
            throw new CreativeStudioStoreError('storage_error', 'Studio writer recovery authority is ambiguous');
          }
          // eslint-disable-next-line no-await-in-loop
          await input.authorizeProject();
          continue;
        }
        if (named !== null && !namedIsExact) {
          const identifiedNamed: IdentifiedRecordV2<null> = {
            file: namedFile,
            bytes: named.bytes,
            identity: named.identity,
            record: null,
            quarantined: false,
          };
          await Promise.all([
            assertIdentifiedRecordCurrentV2({
              root: input.root,
              authority,
              identified: residue.identified,
              maxBytes: input.maxBytes,
            }),
            assertIdentifiedRecordCurrentV2({
              root: input.root,
              authority,
              identified: identifiedNamed,
              maxBytes: input.maxBytes,
            }),
          ]);
          await input.authorizeProject();
          await Promise.all([
            assertIdentifiedRecordCurrentV2({
              root: input.root,
              authority,
              identified: residue.identified,
              maxBytes: input.maxBytes,
            }),
            assertIdentifiedRecordCurrentV2({
              root: input.root,
              authority,
              identified: identifiedNamed,
              maxBytes: input.maxBytes,
            }),
          ]);
          await input.authorizeProject();
          try {
            await fs.rm(residue.identified.file);
            await syncDirectoryAuthorityV2(authority);
          } catch (error) {
            throw storageError(error, 'Studio writer collision residue could not be rolled back');
          }
          await assertIdentifiedRecordCurrentV2({
            root: input.root,
            authority,
            identified: identifiedNamed,
            maxBytes: input.maxBytes,
          });
          removedResidueFiles.add(residue.identified.file);
          continue;
        }
      }
      const readyMatch = /^(.*)\.\d+_\d+\.ready$/.exec(path.basename(residue.identified.file));
      if (readyMatch?.[1] !== undefined) {
        const namedFile = residue.namedFile;
        let named: Awaited<ReturnType<typeof readBoundedRegularFileWithIdentity>>;
        let temporary: Awaited<ReturnType<typeof readBoundedRegularFileWithIdentity>>;
        try {
          // eslint-disable-next-line no-await-in-loop
          [named, temporary] = await Promise.all([
            readBoundedRegularFileWithIdentity({
              fs,
              canonicalRoot: input.root,
              file: namedFile,
              maxBytes: input.maxBytes,
            }),
            readBoundedRegularFileWithIdentity({
              fs,
              canonicalRoot: input.root,
              file: `${residue.identified.file.slice(0, -'.ready'.length)}.tmp`,
              maxBytes: input.maxBytes,
            }),
          ]);
        } catch (error) {
          throw storageError(error, 'Studio writer recovery authority could not be inspected');
        }
        if (
          temporary === null ||
          temporary.bytes !== residue.identified.bytes ||
          !sameIdentityV2(temporary.identity, residue.identified.identity)
        ) {
          throw new CreativeStudioStoreError('storage_error', 'Studio writer recovery authority is ambiguous');
        }
        if (
          named !== null &&
          (named.bytes !== residue.identified.bytes || !sameIdentityV2(named.identity, residue.identified.identity))
        ) {
          assertValidForeignNamedPhaseV2({
            family: residue.family,
            namedFile,
            phaseBytes: residue.identified.bytes,
            namedBytes: named.bytes,
          });

          const temporaryFile = `${residue.identified.file.slice(0, -'.ready'.length)}.tmp`;
          const identifiedTemporary: IdentifiedRecordV2<null> = {
            file: temporaryFile,
            bytes: temporary.bytes,
            identity: temporary.identity,
            record: null,
            quarantined: false,
          };
          const identifiedNamed: IdentifiedRecordV2<null> = {
            file: namedFile,
            bytes: named.bytes,
            identity: named.identity,
            record: null,
            quarantined: false,
          };
          await Promise.all([
            assertIdentifiedRecordCurrentV2({
              root: input.root,
              authority,
              identified: residue.identified,
              maxBytes: input.maxBytes,
            }),
            assertIdentifiedRecordCurrentV2({
              root: input.root,
              authority,
              identified: identifiedTemporary,
              maxBytes: input.maxBytes,
            }),
            assertIdentifiedRecordCurrentV2({
              root: input.root,
              authority,
              identified: identifiedNamed,
              maxBytes: input.maxBytes,
            }),
          ]);
          // A distinct valid inode owns the exclusive canonical name, proving this phase never
          // committed. Roll back only the exact owned pair, ready first so an interrupted cleanup
          // leaves canonical + tmp, which remains safely recoverable on the next fence.
          await input.authorizeProject();
          try {
            await fs.rm(residue.identified.file);
            await syncDirectoryAuthorityV2(authority);
            await input.authorizeProject();
            await Promise.all([
              assertIdentifiedRecordCurrentV2({
                root: input.root,
                authority,
                identified: identifiedTemporary,
                maxBytes: input.maxBytes,
              }),
              assertIdentifiedRecordCurrentV2({
                root: input.root,
                authority,
                identified: identifiedNamed,
                maxBytes: input.maxBytes,
              }),
            ]);
            await fs.rm(temporaryFile);
            await syncDirectoryAuthorityV2(authority);
          } catch (error) {
            throw storageError(error, 'Studio writer collision residue could not be rolled back');
          }
          await assertIdentifiedRecordCurrentV2({
            root: input.root,
            authority,
            identified: identifiedNamed,
            maxBytes: input.maxBytes,
          });
          removedResidueFiles.add(residue.identified.file);
          removedResidueFiles.add(temporaryFile);
          continue;
        }
        // The durable ready hardlink remains beside the immutable pending record. It is recovery
        // authority if the canonical name is lost; terminal slot cleanup removes its own twin.
        // eslint-disable-next-line no-await-in-loop
        await assertIdentifiedRecordCurrentV2({
          root: input.root,
          authority,
          identified: residue.identified,
          maxBytes: input.maxBytes,
        });
        if (named === null) {
          if (!residue.effective) {
            throw new CreativeStudioStoreError('storage_error', 'Studio writer recovery phase is not committed');
          }
          // eslint-disable-next-line no-await-in-loop
          const action = await input.recoveryAction(residue);
          if (action === 'rollback') {
            // eslint-disable-next-line no-await-in-loop
            await input.authorizeProject();
            // eslint-disable-next-line no-await-in-loop
            await assertIdentifiedRecordCurrentV2({
              root: input.root,
              authority,
              identified: residue.identified,
              maxBytes: input.maxBytes,
            });
            // eslint-disable-next-line no-await-in-loop
            await input.authorizeProject();
            try {
              // eslint-disable-next-line no-await-in-loop
              await fs.rm(residue.identified.file);
            } catch (error) {
              throw storageError(error, 'Studio writer recovery reservation could not be rolled back');
            }
            // eslint-disable-next-line no-await-in-loop
            await syncDirectoryAuthorityV2(authority);
            continue;
          }
          if (action !== 'promote') {
            throw new CreativeStudioStoreError('storage_error', 'Studio writer recovery relation is incomplete');
          }
          // eslint-disable-next-line no-await-in-loop
          await assertPathAbsentV2(namedFile);
          // eslint-disable-next-line no-await-in-loop
          await input.authorizeProject();
          // Re-prove the phase inode after the asynchronous project/relation fence. A live writer
          // may be completing the same phase concurrently, so exclusive-link EEXIST is accepted
          // only when it already names this exact inode.
          // eslint-disable-next-line no-await-in-loop
          await assertIdentifiedRecordCurrentV2({
            root: input.root,
            authority,
            identified: residue.identified,
            maxBytes: input.maxBytes,
          });
          // Project/schema authority is the terminal cooperative fence before the exclusive link.
          // eslint-disable-next-line no-await-in-loop
          await input.authorizeProject();
          try {
            // eslint-disable-next-line no-await-in-loop
            await fs.link(residue.identified.file, namedFile);
          } catch (error) {
            if (!isRecord(error) || error.code !== 'EEXIST') {
              throw storageError(error, 'Studio writer recovery authority could not be promoted');
            }
            // eslint-disable-next-line no-await-in-loop
            const existing = await readBoundedRegularFileWithIdentity({
              fs,
              canonicalRoot: input.root,
              file: namedFile,
              maxBytes: input.maxBytes,
            });
            if (
              existing === null ||
              existing.bytes !== residue.identified.bytes ||
              !sameIdentityV2(existing.identity, residue.identified.identity)
            ) {
              throw new CreativeStudioStoreError('storage_error', 'Studio writer recovery authority changed');
            }
          }
          // eslint-disable-next-line no-await-in-loop
          await syncDirectoryAuthorityV2(authority);
          // eslint-disable-next-line no-await-in-loop
          await assertIdentifiedRecordCurrentV2({
            root: input.root,
            authority,
            identified: { ...residue.identified, file: namedFile },
            maxBytes: input.maxBytes,
          });
        }
        // eslint-disable-next-line no-await-in-loop
        await input.authorizeProject();
        continue;
      }
      if (residue.family === 'pending' || residue.identified.file.endsWith('.tmp')) {
        // The complete ledger already classified this exact temporary. Never rescan the family:
        // a subprocess may be publishing a different record concurrently.
        // eslint-disable-next-line no-await-in-loop
        await assertIdentifiedRecordCurrentV2({
          root: input.root,
          authority,
          identified: residue.identified,
          maxBytes: input.maxBytes,
        });
        // eslint-disable-next-line no-await-in-loop
        await input.authorizeProject();
        // eslint-disable-next-line no-await-in-loop
        await assertIdentifiedRecordCurrentV2({
          root: input.root,
          authority,
          identified: residue.identified,
          maxBytes: input.maxBytes,
        });
        // eslint-disable-next-line no-await-in-loop
        await input.authorizeProject();
        try {
          // eslint-disable-next-line no-await-in-loop
          await fs.rm(residue.identified.file);
        } catch (error) {
          throw storageError(error, 'Studio writer publication residue could not be removed');
        }
        // eslint-disable-next-line no-await-in-loop
        await syncDirectoryAuthorityV2(authority);
        continue;
      }

      const cleanupMatch = /^((?:0|[1-9]\d*)\.slot)\.\d+_\d+\.cleanup$/.exec(path.basename(residue.identified.file));
      let decoded: unknown;
      try {
        decoded = JSON.parse(residue.identified.bytes) as unknown;
      } catch {
        throw new CreativeStudioStoreError('storage_error', 'Studio writer slot cleanup residue is malformed');
      }
      const parsed = input.parseSlot(decoded);
      if (
        cleanupMatch?.[1] === undefined ||
        !isCanonicalV2SlotFileName(cleanupMatch[1], input.capacity) ||
        parsed.status !== 'valid'
      ) {
        throw new CreativeStudioStoreError('storage_error', 'Studio writer slot cleanup residue is malformed');
      }
      const namedFile = path.join(input.slots.path, cleanupMatch[1]);
      const pendingFile = path.join(input.pending.path, `${input.recordId(parsed.record)}.json`);
      let named: Awaited<ReturnType<typeof readBoundedRegularFileWithIdentity>>;
      let pending: Awaited<ReturnType<typeof readBoundedRegularFileWithIdentity>>;
      try {
        // eslint-disable-next-line no-await-in-loop
        [named, pending] = await Promise.all([
          readBoundedRegularFileWithIdentity({
            fs,
            canonicalRoot: input.root,
            file: namedFile,
            maxBytes: input.maxBytes,
          }),
          readBoundedRegularFileWithIdentity({
            fs,
            canonicalRoot: input.root,
            file: pendingFile,
            maxBytes: input.maxBytes,
          }),
        ]);
      } catch (error) {
        throw storageError(error, 'Studio writer slot cleanup authority could not be inspected');
      }
      if (
        named !== null &&
        (named.bytes !== residue.identified.bytes || !sameIdentityV2(named.identity, residue.identified.identity))
      ) {
        throw new CreativeStudioStoreError('storage_error', 'Studio writer slot cleanup authority is ambiguous');
      }
      if (pending !== null) {
        let pendingValue: unknown;
        try {
          pendingValue = JSON.parse(pending.bytes) as unknown;
        } catch {
          throw new CreativeStudioStoreError('storage_error', 'Studio writer pending authority is malformed');
        }
        if (!input.validatePending(input.recordId(parsed.record), pendingValue)) {
          throw new CreativeStudioStoreError('storage_error', 'Studio writer pending authority is malformed');
        }
      }
      // eslint-disable-next-line no-await-in-loop
      await input.authorizeProject();
      // eslint-disable-next-line no-await-in-loop
      await assertIdentifiedRecordCurrentV2({
        root: input.root,
        authority: input.slots,
        identified: residue.identified,
        maxBytes: input.maxBytes,
      });
      if (named !== null) {
        // eslint-disable-next-line no-await-in-loop
        await assertIdentifiedRecordCurrentV2({
          root: input.root,
          authority: input.slots,
          identified: { ...residue.identified, file: namedFile },
          maxBytes: input.maxBytes,
        });
      } else {
        // eslint-disable-next-line no-await-in-loop
        await assertPathAbsentV2(namedFile);
      }
      if (pending !== null) {
        // eslint-disable-next-line no-await-in-loop
        await assertIdentifiedRecordCurrentV2({
          root: input.root,
          authority: input.pending,
          identified: {
            file: pendingFile,
            bytes: pending.bytes,
            identity: pending.identity,
            record: null,
            quarantined: false,
          },
          maxBytes: input.maxBytes,
        });
      } else {
        // eslint-disable-next-line no-await-in-loop
        await assertPathAbsentV2(pendingFile);
      }
      // Project/schema authority is the last awaited fence before changing the captured slot
      // pathname. New writer residues outside this frozen ledger are never consulted or touched.
      // eslint-disable-next-line no-await-in-loop
      await input.authorizeProject();
      try {
        if (named === null && pending !== null) {
          // eslint-disable-next-line no-await-in-loop
          await fs.link(residue.identified.file, namedFile);
          // eslint-disable-next-line no-await-in-loop
          await syncDirectoryAuthorityV2(input.slots);
          // eslint-disable-next-line no-await-in-loop
          await assertIdentifiedRecordCurrentV2({
            root: input.root,
            authority: input.slots,
            identified: { ...residue.identified, file: namedFile },
            maxBytes: input.maxBytes,
          });
          // eslint-disable-next-line no-await-in-loop
          await input.authorizeProject();
          // eslint-disable-next-line no-await-in-loop
          await assertIdentifiedRecordCurrentV2({
            root: input.root,
            authority: input.slots,
            identified: residue.identified,
            maxBytes: input.maxBytes,
          });
          // eslint-disable-next-line no-await-in-loop
          await fs.rm(residue.identified.file);
        } else {
          // eslint-disable-next-line no-await-in-loop
          await fs.rm(residue.identified.file);
        }
      } catch (error) {
        throw storageError(error, 'Studio writer slot cleanup residue could not be reconciled');
      }
      // eslint-disable-next-line no-await-in-loop
      await syncDirectoryAuthorityV2(input.slots);
    }
  };

  const removeReadyPublicationCompanionV2 = async (input: {
    root: string;
    authority: DirectoryAuthorityV2;
    named: IdentifiedRecordV2<unknown>;
    maxBytes: number;
    authorize: () => Promise<void>;
  }): Promise<void> => {
    const namedBase = path.basename(input.named.file);
    const entries = await readStableDirectoryEntriesV2(input.authority);
    const candidates = entries.filter(
      (entry) =>
        entry.isFile() &&
        !entry.isSymbolicLink() &&
        entry.name.startsWith(`${namedBase}.`) &&
        /^\d+_\d+\.(tmp|ready)$/.test(entry.name.slice(namedBase.length + 1))
    );
    if (candidates.length > 2) {
      throw new CreativeStudioStoreError('storage_error', 'Studio writer recovery authority is ambiguous');
    }
    // Remove the durable ready phase before its temporary hardlink. If cleanup is
    // interrupted between the two unlinks, canonical + tmp remains a recoverable
    // state; canonical + ready without its required tmp twin is intentionally not.
    const ordered = candidates.toSorted(
      (left, right) => Number(right.name.endsWith('.ready')) - Number(left.name.endsWith('.ready'))
    );
    for (const candidate of ordered) {
      const companionFile = path.join(input.authority.path, candidate.name);
      // eslint-disable-next-line no-await-in-loop
      const companion = await readBoundedRegularFileWithIdentity({
        fs,
        canonicalRoot: input.root,
        file: companionFile,
        maxBytes: input.maxBytes,
      });
      if (
        companion === null ||
        companion.bytes !== input.named.bytes ||
        !sameIdentityV2(companion.identity, input.named.identity)
      ) {
        throw new CreativeStudioStoreError('storage_error', 'Studio writer recovery authority is ambiguous');
      }
      // eslint-disable-next-line no-await-in-loop
      await assertIdentifiedRecordCurrentV2({
        root: input.root,
        authority: input.authority,
        identified: input.named,
        maxBytes: input.maxBytes,
      });
      // eslint-disable-next-line no-await-in-loop
      await assertIdentifiedRecordCurrentV2({
        root: input.root,
        authority: input.authority,
        identified: {
          file: companionFile,
          bytes: companion.bytes,
          identity: companion.identity,
          record: null,
          quarantined: false,
        },
        maxBytes: input.maxBytes,
      });
      // eslint-disable-next-line no-await-in-loop
      await input.authorize();
      // eslint-disable-next-line no-await-in-loop
      await fs.rm(companionFile);
      // eslint-disable-next-line no-await-in-loop
      await syncDirectoryAuthorityV2(input.authority);
    }
  };

  const cleanupProposalWriterResiduesV2 = async (
    root: string,
    projectId: string,
    ledger: ProposalLedgerV2,
    projectSnapshot: Extract<ProjectFileInspectionV2, { status: 'supported' }>
  ): Promise<void> => {
    if (ledger.writerResidues.length === 0) return;
    await assertProposalLedgerEntrySetCurrentV2(ledger);
    await cleanupCapturedWriterResiduesV2({
      root,
      pending: ledger.directories.pending,
      slots: ledger.directories.slots,
      residues: ledger.writerResidues,
      maxBytes: STUDIO_PROPOSAL_MAX_RECORD_BYTES,
      capacity: STUDIO_PROPOSAL_MAX_PENDING_PER_PROJECT,
      parseSlot: parseStudioProposalSlotV2,
      recordId: (slot) => slot.proposalId,
      validatePending: (proposalId, value) =>
        parseStudioProposalRecordV2({ projectId, proposalId, value }).status === 'valid',
      authorizeProject: () => assertProjectSnapshotCurrentV2({ root, snapshot: projectSnapshot }),
      recoveryAction: async (residue) => {
        if (residue.phase !== 'ready' || !residue.effective) return 'retain';
        if (residue.family === 'pending') {
          const proposalId = path.basename(residue.namedFile, '.json');
          const decision = ledger.decisions.get(proposalId);
          const counterpart = decision ?? ledger.slots.get(proposalId)?.[0];
          if (counterpart === undefined) return 'retain';
          await assertIdentifiedRecordCurrentV2({
            root,
            authority: decision === undefined ? ledger.directories.slots : ledger.directories.decisions,
            identified: counterpart,
            maxBytes: STUDIO_PROPOSAL_MAX_RECORD_BYTES,
          });
          return 'promote';
        }
        let value: unknown;
        try {
          value = JSON.parse(residue.identified.bytes) as unknown;
        } catch {
          return 'retain';
        }
        const parsed = parseStudioProposalSlotV2(value);
        if (parsed.status !== 'valid') return 'retain';
        const proposal = ledger.proposals.get(parsed.record.proposalId);
        const decision = ledger.decisions.get(parsed.record.proposalId);
        if (proposal === undefined) {
          await assertPathAbsentV2(path.join(ledger.directories.pending.path, `${parsed.record.proposalId}.json`));
          return 'rollback';
        }
        await assertIdentifiedRecordCurrentV2({
          root,
          authority: ledger.directories.pending,
          identified: proposal,
          maxBytes: STUDIO_PROPOSAL_MAX_RECORD_BYTES,
        });
        if (decision !== undefined) {
          await assertIdentifiedRecordCurrentV2({
            root,
            authority: ledger.directories.decisions,
            identified: decision,
            maxBytes: STUDIO_PROPOSAL_MAX_RECORD_BYTES,
          });
          return 'rollback';
        }
        return 'promote';
      },
    });
  };

  const readReferenceRequestLedgerV2 = async (input: {
    root: string;
    projectId: string;
    directories: ReferenceRequestDirectoriesV2;
  }): Promise<ReferenceRequestLedgerV2> => {
    await assertReferenceRequestDirectoryAuthoritiesV2(input.directories);
    const pendingResidues = await reconcileOwnedPendingPublicationResiduesV2({
      root: input.root,
      authority: input.directories.pending,
      maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
      validateNamedBase: (namedBase) =>
        namedBase.endsWith('.json') && isSafeProposalId(namedBase.slice(0, -'.json'.length)),
      validateRecord: (namedBase, value) => {
        const requestId = namedBase.slice(0, -'.json'.length);
        return parseStudioReferenceRequestV2({ projectId: input.projectId, requestId, value }).status === 'valid';
      },
      allowForeignNamedPhase: true,
      deferCleanup: true,
    });
    const slotPublicationResidues = await reconcileOwnedPendingPublicationResiduesV2({
      root: input.root,
      authority: input.directories.slots,
      maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
      validateNamedBase: (namedBase) =>
        isCanonicalV2SlotFileName(namedBase, STUDIO_REFERENCE_REQUEST_V2_MAX_PENDING_PER_PROJECT),
      validateRecord: (_namedBase, value) => parseStudioReferenceRequestSlotV2(value).status === 'valid',
      allowForeignNamedPhase: true,
      deferCleanup: true,
    });
    const slotCleanupResidues = await reconcileOwnedSlotCleanupResiduesV2({
      root: input.root,
      pending: input.directories.pending,
      slots: input.directories.slots,
      maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
      capacity: STUDIO_REFERENCE_REQUEST_V2_MAX_PENDING_PER_PROJECT,
      recordId: (slot: StudioReferenceRequestSlotV2) => slot.requestId,
      validatePending: (requestId, value) =>
        parseStudioReferenceRequestV2({ projectId: input.projectId, requestId, value }).status === 'valid',
      parse: parseStudioReferenceRequestSlotV2,
      deferCleanup: true,
    });
    const [decisionResidues, receiptResidues] = await Promise.all([
      reconcileJournalPublicationResiduesV2({
        root: input.root,
        authority: input.directories.decisions,
        maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
        validateNamedBase: (namedBase) =>
          namedBase.endsWith('.json') && isSafeProposalId(namedBase.slice(0, -'.json'.length)),
        parseRecord: (namedBase, value) => {
          const requestId = namedBase.slice(0, -'.json'.length);
          const parsed = parseStudioReferenceRequestDecisionV2({ projectId: input.projectId, requestId, value });
          return parsed.status === 'valid' ? parsed.record : null;
        },
        deferCleanup: true,
      }),
      reconcileJournalPublicationResiduesV2({
        root: input.root,
        authority: input.directories.receipts,
        maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
        validateNamedBase: (namedBase) =>
          namedBase.endsWith('.json') && isSafeProposalId(namedBase.slice(0, -'.json'.length)),
        parseRecord: (namedBase, value) => {
          const handoffId = namedBase.slice(0, -'.json'.length);
          const parsed = parseStudioReferenceGenerationHandoffReceiptV2({ handoffId, value });
          return parsed.status === 'valid' ? parsed.record : null;
        },
        deferCleanup: true,
      }),
    ]);
    const [rawPendingEntries, rawDecisionEntries, rawSlotEntries, rawReceiptEntries] = await Promise.all([
      readStableDirectoryEntriesV2(input.directories.pending),
      readStableDirectoryEntriesV2(input.directories.decisions),
      readStableDirectoryEntriesV2(input.directories.slots),
      readStableDirectoryEntriesV2(input.directories.receipts),
    ]);
    const decisionResidueNames = new Set(decisionResidues.map((residue) => path.basename(residue.identified.file)));
    const receiptResidueNames = new Set(receiptResidues.map((residue) => path.basename(residue.identified.file)));
    const pendingResidueNames = new Set(pendingResidues.map((record) => path.basename(record.identified.file)));
    const slotResidueNames = new Set([
      ...slotPublicationResidues.map((record) => path.basename(record.identified.file)),
      ...slotCleanupResidues.map((record) => path.basename(record.identified.file)),
    ]);
    const pendingEntries = rawPendingEntries.filter((entry) => !pendingResidueNames.has(entry.name));
    const slotEntries = rawSlotEntries.filter((entry) => !slotResidueNames.has(entry.name));
    const decisionEntries = rawDecisionEntries.filter((entry) => !decisionResidueNames.has(entry.name));
    const receiptEntries = rawReceiptEntries.filter((entry) => !receiptResidueNames.has(entry.name));
    const requests = new Map<string, IdentifiedRecordV2<StudioReferenceRequestV2>>();
    const decisions = new Map<string, IdentifiedRecordV2<StudioReferenceRequestDecisionV2>>();
    const slots = new Map<string, IdentifiedRecordV2<StudioReferenceRequestSlotV2>[]>();
    const receipts = new Map<string, IdentifiedRecordV2<StudioReferenceGenerationHandoffReceiptV2>>();
    const generationDecisions = new Map<string, IdentifiedRecordV2<StudioReferenceRequestDecisionV2>>();

    for (const entry of pendingEntries) {
      if (!entry.isFile() || entry.isSymbolicLink() || !entry.name.endsWith('.json')) {
        throw new CreativeStudioStoreError('storage_error', 'Malformed schema-2 Studio reference request directory');
      }
      const requestId = entry.name.slice(0, -'.json'.length);
      if (!isSafeProposalId(requestId) || requests.has(requestId)) {
        throw new CreativeStudioStoreError('storage_error', 'Malformed schema-2 Studio reference request identity');
      }
      // The reference request ledger is bounded by its slot family.
      // eslint-disable-next-line no-await-in-loop
      const request = await parseIdentifiedJsonV2({
        root: input.root,
        file: path.join(input.directories.pending.path, entry.name),
        maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
        parse: (value) => parseStudioReferenceRequestV2({ projectId: input.projectId, requestId, value }),
      });
      requests.set(requestId, request);
    }
    for (const residue of pendingResidues) {
      if (!residue.effective) continue;
      const requestId = path.basename(residue.namedFile, '.json');
      let value: unknown;
      try {
        value = JSON.parse(residue.identified.bytes) as unknown;
      } catch {
        throw new CreativeStudioStoreError('storage_error', 'Malformed Studio reference request recovery record');
      }
      const parsed = parseStudioReferenceRequestV2({ projectId: input.projectId, requestId, value });
      if (parsed.status !== 'valid' || requests.has(requestId)) {
        throw new CreativeStudioStoreError('storage_error', 'Ambiguous Studio reference request recovery record');
      }
      requests.set(requestId, { ...residue.identified, record: parsed.record });
    }
    for (const entry of decisionEntries) {
      if (!entry.isFile() || entry.isSymbolicLink() || !entry.name.endsWith('.json')) {
        throw new CreativeStudioStoreError('storage_error', 'Malformed Studio reference request decision directory');
      }
      const requestId = entry.name.slice(0, -'.json'.length);
      if (!isSafeProposalId(requestId) || decisions.has(requestId)) {
        throw new CreativeStudioStoreError('storage_error', 'Malformed Studio reference request decision identity');
      }
      // eslint-disable-next-line no-await-in-loop
      const decision = await parseIdentifiedJsonV2({
        root: input.root,
        file: path.join(input.directories.decisions.path, entry.name),
        maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
        parse: (value) => parseStudioReferenceRequestDecisionV2({ projectId: input.projectId, requestId, value }),
      });
      decisions.set(requestId, decision);
    }

    for (const entry of slotEntries) {
      const cleanup = parseIdentityBoundCleanupNameV2(entry.name);
      const quarantined = cleanup !== null;
      const namedSlot = cleanup?.namedFileName ?? entry.name;
      if (
        !entry.isFile() ||
        entry.isSymbolicLink() ||
        !isCanonicalV2SlotFileName(namedSlot, STUDIO_REFERENCE_REQUEST_V2_MAX_PENDING_PER_PROJECT)
      ) {
        throw new CreativeStudioStoreError('storage_error', 'Malformed Studio reference request slot directory');
      }
      // eslint-disable-next-line no-await-in-loop
      const slot = await parseIdentifiedJsonV2({
        root: input.root,
        file: path.join(input.directories.slots.path, entry.name),
        quarantined,
        maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
        parse: parseStudioReferenceRequestSlotV2,
      });
      if (
        cleanup !== null &&
        (!sameIdentityV2(slot.identity, cleanup.identity) || sha256Utf8(slot.bytes) !== cleanup.digest)
      ) {
        throw new CreativeStudioStoreError('storage_error', 'Studio reference cleanup authority mismatch');
      }
      const held = slots.get(slot.record.requestId) ?? [];
      held.push(slot);
      slots.set(slot.record.requestId, held);
    }
    for (const residue of slotCleanupResidues) {
      if (!residue.effective) continue;
      const effective = { ...residue.identified, quarantined: false };
      const held = slots.get(effective.record.requestId) ?? [];
      held.push(effective);
      slots.set(effective.record.requestId, held);
    }
    for (const residue of slotPublicationResidues) {
      if (!residue.effective) continue;
      let value: unknown;
      try {
        value = JSON.parse(residue.identified.bytes) as unknown;
      } catch {
        throw new CreativeStudioStoreError('storage_error', 'Malformed Studio reference slot recovery record');
      }
      const parsed = parseStudioReferenceRequestSlotV2(value);
      if (parsed.status !== 'valid') {
        throw new CreativeStudioStoreError('storage_error', 'Malformed Studio reference slot recovery record');
      }
      const held = slots.get(parsed.record.requestId) ?? [];
      held.push({ ...residue.identified, record: parsed.record });
      slots.set(parsed.record.requestId, held);
    }

    for (const entry of receiptEntries) {
      if (!entry.isFile() || entry.isSymbolicLink() || !entry.name.endsWith('.json')) {
        throw new CreativeStudioStoreError('storage_error', 'Malformed Studio reference handoff receipt directory');
      }
      const handoffId = entry.name.slice(0, -'.json'.length);
      if (!isSafeProposalId(handoffId) || receipts.has(handoffId)) {
        throw new CreativeStudioStoreError('storage_error', 'Malformed Studio reference handoff receipt identity');
      }
      // eslint-disable-next-line no-await-in-loop
      const receipt = await parseIdentifiedJsonV2({
        root: input.root,
        file: path.join(input.directories.receipts.path, entry.name),
        maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
        parse: (value) => parseStudioReferenceGenerationHandoffReceiptV2({ handoffId, value }),
      });
      receipts.set(handoffId, receipt);
    }
    for (const residue of decisionResidues) {
      if (!residue.effective) continue;
      const requestId = path.basename(residue.namedFile, '.json');
      if (decisions.has(requestId)) {
        throw new CreativeStudioStoreError('storage_error', 'Ambiguous Studio reference decision publication');
      }
      decisions.set(requestId, residue.identified);
    }
    for (const residue of receiptResidues) {
      if (!residue.effective) continue;
      const handoffId = path.basename(residue.namedFile, '.json');
      if (receipts.has(handoffId)) {
        throw new CreativeStudioStoreError('storage_error', 'Ambiguous Studio reference receipt publication');
      }
      receipts.set(handoffId, residue.identified);
    }

    await assertReferenceRequestDirectoryAuthoritiesV2(input.directories);
    for (const [requestId, decision] of decisions) {
      const request = requests.get(requestId);
      if (request === undefined || decision.record.requestId !== requestId) {
        throw new CreativeStudioStoreError('storage_error', 'Studio reference decision has no immutable request');
      }
      if (Date.parse(decision.record.decidedAt) < Date.parse(request.record.createdAt)) {
        throw new CreativeStudioStoreError('storage_error', 'Studio reference decision predates its request');
      }
      if (
        decision.record.outcome.kind === 'expired' &&
        Date.parse(decision.record.decidedAt) <
          Date.parse(request.record.createdAt) + STUDIO_REFERENCE_REQUEST_V2_PENDING_TTL_MS
      ) {
        throw new CreativeStudioStoreError('storage_error', 'Studio reference decision expires its request early');
      }
      if (decision.record.outcome.kind === 'generation_gate') {
        const outcome = decision.record.outcome;
        if (
          outcome.shotIds.length !== request.record.shotIds.length ||
          !outcome.shotIds.every((shotId, index) => shotId === request.record.shotIds[index]) ||
          generationDecisions.has(outcome.handoffId)
        ) {
          throw new CreativeStudioStoreError('storage_error', 'Ambiguous Studio reference generation handoff');
        }
        generationDecisions.set(outcome.handoffId, decision);
      }
    }
    for (const [handoffId, receipt] of receipts) {
      const decision = generationDecisions.get(handoffId);
      if (
        decision === undefined ||
        decision.record.requestId !== receipt.record.requestId ||
        Date.parse(receipt.record.completedAt) < Date.parse(decision.record.decidedAt)
      ) {
        throw new CreativeStudioStoreError('storage_error', 'Studio reference handoff receipt has no exact decision');
      }
    }
    for (const [requestId, held] of slots) {
      if (held.length > 1) {
        throw new CreativeStudioStoreError('storage_error', 'Ambiguous Studio reference request slot authority');
      }
      const request = requests.get(requestId);
      const decision = decisions.get(requestId)?.record;
      const receipt =
        decision?.outcome.kind === 'generation_gate' ? receipts.get(decision.outcome.handoffId)?.record : undefined;
      if (
        request !== undefined &&
        (decision === undefined || (decision.outcome.kind === 'generation_gate' && !receipt))
      ) {
        if (held[0].quarantined) {
          throw new CreativeStudioStoreError('storage_error', 'Pending Studio reference request slot is quarantined');
        }
      }
    }
    for (const requestId of requests.keys()) {
      const decision = decisions.get(requestId)?.record;
      const receipt =
        decision?.outcome.kind === 'generation_gate' ? receipts.get(decision.outcome.handoffId)?.record : undefined;
      const live = decision === undefined || (decision.outcome.kind === 'generation_gate' && receipt === undefined);
      if (!live) continue;
      const held = slots.get(requestId) ?? [];
      if (held.length !== 1 || held[0].quarantined) {
        throw new CreativeStudioStoreError(
          'storage_error',
          'Pending Studio reference request has no exact slot authority'
        );
      }
    }
    for (const [requestId, request] of requests) {
      const decision = decisions.get(requestId)?.record;
      const receipt =
        decision?.outcome.kind === 'generation_gate' ? receipts.get(decision.outcome.handoffId)?.record : undefined;
      const requiresSlot =
        decision === undefined || (decision.outcome.kind === 'generation_gate' && receipt === undefined);
      if (requiresSlot && slots.get(requestId)?.length !== 1) {
        throw new CreativeStudioStoreError('storage_error', 'Pending Studio reference request has no exact slot');
      }
      if (request.record.projectId !== input.projectId) {
        throw new CreativeStudioStoreError('storage_error', 'Studio reference request project authority mismatch');
      }
    }
    const liveCount = [...requests.keys()].filter((requestId) => {
      const decision = decisions.get(requestId)?.record;
      return (
        decision === undefined ||
        (decision.outcome.kind === 'generation_gate' && !receipts.has(decision.outcome.handoffId))
      );
    }).length;
    // Immutable terminal relations are retained as audit history. Only requests
    // which still hold a slot participate in the live reference-request cap.
    if (liveCount > STUDIO_REFERENCE_REQUEST_V2_MAX_PENDING_PER_PROJECT) {
      throw new CreativeStudioStoreError('storage_error', 'Schema-2 Studio reference request ledger exceeds capacity');
    }
    return {
      directories: input.directories,
      requests,
      decisions,
      slots,
      receipts,
      generationDecisions,
      journalResidues: [
        ...decisionResidues.map((residue) => ({ family: 'decisions' as const, ...residue })),
        ...receiptResidues.map((residue) => ({ family: 'receipts' as const, ...residue })),
      ],
      writerResidues: [
        ...pendingResidues.map((residue) => ({ family: 'pending' as const, ...residue })),
        ...slotPublicationResidues.map((residue) => ({ family: 'slots' as const, ...residue })),
        ...slotCleanupResidues.map(({ identified, namedFile }) => ({
          family: 'slots' as const,
          identified: { ...identified, record: null } as IdentifiedRecordV2<null>,
          namedFile,
          phase: 'cleanup' as const,
          effective: true,
        })),
      ],
    };
  };

  const assertReferenceRequestLedgerEntrySetCurrentV2 = async (
    ledger: ReferenceRequestLedgerV2,
    publication?: {
      decision?: IdentifiedRecordV2<null>;
      receipt?: IdentifiedRecordV2<null>;
    }
  ): Promise<void> => {
    const root = path.dirname(ledger.directories.project.path);
    const assertEntries = async (
      authority: DirectoryAuthorityV2,
      records: readonly IdentifiedRecordV2<unknown>[]
    ): Promise<void> => {
      const expected = new Map(records.map((record) => [path.basename(record.file), record]));
      const entries = await readStableDirectoryEntriesV2(authority);
      const observed = new Set<string>();
      for (const entry of entries) {
        const identified = expected.get(entry.name);
        if (!entry.isFile() || entry.isSymbolicLink()) {
          throw new CreativeStudioStoreError('storage_error', 'Studio reference request directory entry set changed');
        }
        if (identified === undefined) {
          const named = entry.name.endsWith('.publish')
            ? expected.get(entry.name.slice(0, -'.publish'.length))
            : undefined;
          if (named === undefined) {
            throw new CreativeStudioStoreError('storage_error', 'Studio reference request directory entry set changed');
          }
          // eslint-disable-next-line no-await-in-loop
          await assertIdentifiedRecordCurrentV2({
            root,
            authority,
            identified: { ...named, file: path.join(authority.path, entry.name) },
            maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
          });
          continue;
        }
        observed.add(entry.name);
        // eslint-disable-next-line no-await-in-loop
        await assertIdentifiedRecordCurrentV2({
          root,
          authority,
          identified,
          maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
        });
      }
      if ([...expected.keys()].some((name) => !observed.has(name))) {
        throw new CreativeStudioStoreError('storage_error', 'Studio reference request directory entry set changed');
      }
      await assertDirectoryAuthorityV2(authority);
    };
    await Promise.all([
      assertEntries(ledger.directories.pending, [
        ...ledger.requests.values(),
        ...ledger.writerResidues.filter((residue) => residue.family === 'pending').map((residue) => residue.identified),
      ]),
      assertEntries(ledger.directories.decisions, [
        ...ledger.decisions.values(),
        ...ledger.journalResidues
          .filter((residue) => residue.family === 'decisions')
          .map((residue) => residue.identified),
        ...(publication?.decision === undefined ? [] : [publication.decision]),
      ]),
      assertEntries(ledger.directories.slots, [
        ...[...ledger.slots.values()].flat(),
        ...ledger.writerResidues.filter((residue) => residue.family === 'slots').map((residue) => residue.identified),
      ]),
      assertEntries(ledger.directories.receipts, [
        ...ledger.receipts.values(),
        ...ledger.journalResidues
          .filter((residue) => residue.family === 'receipts')
          .map((residue) => residue.identified),
        ...(publication?.receipt === undefined ? [] : [publication.receipt]),
      ]),
    ]);
    await assertReferenceRequestDirectoryAuthoritiesV2(ledger.directories);
  };

  const cleanupReferenceJournalPublicationResiduesV2 = async (
    root: string,
    ledger: ReferenceRequestLedgerV2,
    authorizeProject: () => Promise<void>
  ): Promise<ReferenceRequestLedgerV2> => {
    const current: ReferenceRequestLedgerV2 = {
      ...ledger,
      decisions: new Map(ledger.decisions),
      receipts: new Map(ledger.receipts),
      generationDecisions: new Map(ledger.generationDecisions),
      journalResidues: [...ledger.journalResidues],
    };
    for (const residue of ledger.journalResidues) {
      const authority = current.directories[residue.family];
      await assertReferenceRequestLedgerEntrySetCurrentV2(current);
      if (residue.family === 'decisions') {
        // eslint-disable-next-line no-await-in-loop
        const named = await cleanupJournalPublicationResidueV2({
          root,
          authority,
          identified: residue.identified,
          namedFile: residue.namedFile,
          effective: residue.effective,
          maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
          authorizeProject,
        });
        if (residue.effective) {
          current.decisions.set(residue.identified.record.requestId, named);
          if (residue.identified.record.outcome.kind === 'generation_gate') {
            current.generationDecisions.set(residue.identified.record.outcome.handoffId, named);
          }
        }
      } else {
        // eslint-disable-next-line no-await-in-loop
        const named = await cleanupJournalPublicationResidueV2({
          root,
          authority,
          identified: residue.identified,
          namedFile: residue.namedFile,
          effective: residue.effective,
          maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
          authorizeProject,
        });
        if (residue.effective) current.receipts.set(residue.identified.record.handoffId, named);
      }
      current.journalResidues = current.journalResidues.map((candidate) =>
        candidate.identified.file === residue.identified.file ? { ...candidate, effective: false } : candidate
      );
    }
    return current;
  };

  const cleanupReferenceWriterResiduesV2 = async (
    root: string,
    projectId: string,
    ledger: ReferenceRequestLedgerV2,
    projectSnapshot: Extract<ProjectFileInspectionV2, { status: 'supported' }>
  ): Promise<void> => {
    if (ledger.writerResidues.length === 0) return;
    await assertReferenceRequestLedgerEntrySetCurrentV2(ledger);
    await cleanupCapturedWriterResiduesV2({
      root,
      pending: ledger.directories.pending,
      slots: ledger.directories.slots,
      residues: ledger.writerResidues,
      maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
      capacity: STUDIO_REFERENCE_REQUEST_V2_MAX_PENDING_PER_PROJECT,
      parseSlot: parseStudioReferenceRequestSlotV2,
      recordId: (slot) => slot.requestId,
      validatePending: (requestId, value) =>
        parseStudioReferenceRequestV2({ projectId, requestId, value }).status === 'valid',
      authorizeProject: () => assertProjectSnapshotCurrentV2({ root, snapshot: projectSnapshot }),
      recoveryAction: async (residue) => {
        if (residue.phase !== 'ready' || !residue.effective) return 'retain';
        if (residue.family === 'pending') {
          const requestId = path.basename(residue.namedFile, '.json');
          const decision = ledger.decisions.get(requestId);
          const receipt =
            decision?.record.outcome.kind === 'generation_gate'
              ? ledger.receipts.get(decision.record.outcome.handoffId)
              : undefined;
          const counterpart =
            decision === undefined || (decision.record.outcome.kind === 'generation_gate' && receipt === undefined)
              ? ledger.slots.get(requestId)?.[0]
              : (receipt ?? decision);
          if (counterpart === undefined) return 'retain';
          const authority =
            decision === undefined || (decision.record.outcome.kind === 'generation_gate' && receipt === undefined)
              ? ledger.directories.slots
              : receipt === undefined
                ? ledger.directories.decisions
                : ledger.directories.receipts;
          await assertIdentifiedRecordCurrentV2({
            root,
            authority,
            identified: counterpart,
            maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
          });
          return 'promote';
        }
        let value: unknown;
        try {
          value = JSON.parse(residue.identified.bytes) as unknown;
        } catch {
          return 'retain';
        }
        const parsed = parseStudioReferenceRequestSlotV2(value);
        if (parsed.status !== 'valid') return 'retain';
        const request = ledger.requests.get(parsed.record.requestId);
        const decision = ledger.decisions.get(parsed.record.requestId);
        const receipt =
          decision?.record.outcome.kind === 'generation_gate'
            ? ledger.receipts.get(decision.record.outcome.handoffId)
            : undefined;
        if (request === undefined) {
          await assertPathAbsentV2(path.join(ledger.directories.pending.path, `${parsed.record.requestId}.json`));
          return 'rollback';
        }
        await assertIdentifiedRecordCurrentV2({
          root,
          authority: ledger.directories.pending,
          identified: request,
          maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
        });
        const live =
          decision === undefined || (decision.record.outcome.kind === 'generation_gate' && receipt === undefined);
        if (live) return 'promote';
        const terminal = receipt ?? decision;
        if (terminal !== undefined) {
          await assertIdentifiedRecordCurrentV2({
            root,
            authority: receipt === undefined ? ledger.directories.decisions : ledger.directories.receipts,
            identified: terminal,
            maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
          });
        }
        return 'rollback';
      },
    });
  };

  const assertIdentifiedRecordCurrentV2 = async (input: {
    root: string;
    authority: DirectoryAuthorityV2;
    identified: IdentifiedRecordV2<unknown>;
    maxBytes?: number;
  }): Promise<void> => {
    const maxBytes = input.maxBytes ?? STUDIO_PROPOSAL_MAX_RECORD_BYTES;
    await assertDirectoryAuthorityV2(input.authority);
    let current: Awaited<ReturnType<typeof readBoundedRegularFileWithIdentity>>;
    try {
      current = await readBoundedRegularFileWithIdentity({
        fs,
        canonicalRoot: input.root,
        file: input.identified.file,
        maxBytes,
      });
    } catch (error) {
      throw storageError(error, 'Schema-2 Studio proposal authority changed');
    }
    if (
      current === null ||
      current.bytes !== input.identified.bytes ||
      !sameIdentityV2(current.identity, input.identified.identity)
    ) {
      throw new CreativeStudioStoreError('storage_error', 'Schema-2 Studio proposal authority changed');
    }
    await assertDirectoryAuthorityV2(input.authority);
  };

  const assertProjectSnapshotCurrentV2 = async (input: {
    root: string;
    snapshot: Extract<ProjectFileInspectionV2, { status: 'supported' }>;
  }): Promise<void> => {
    await assertDirectoryAuthorityV2(input.snapshot.directory);
    const file = resolveRootChild(input.snapshot.directory.path, 'project.json');
    let current: Awaited<ReturnType<typeof readBoundedRegularFileWithIdentity>>;
    try {
      current = await readBoundedRegularFileWithIdentity({
        fs,
        canonicalRoot: input.root,
        file,
        maxBytes: STUDIO_PROJECT_V2_MAX_RECORD_BYTES,
      });
    } catch (error) {
      throw storageError(error, 'Schema-2 Studio project authority changed');
    }
    if (
      current === null ||
      current.bytes !== input.snapshot.bytes ||
      !sameIdentityV2(current.identity, input.snapshot.identity)
    ) {
      throw new CreativeStudioStoreError('storage_error', 'Schema-2 Studio project authority changed');
    }
    await assertDirectoryAuthorityV2(input.snapshot.directory);
  };

  const quarantineRemoveIdentifiedRecordV2 = async <RecordType>(input: {
    root: string;
    authority: DirectoryAuthorityV2;
    identified: IdentifiedRecordV2<RecordType>;
    authorize: () => Promise<void>;
    maxBytes?: number;
  }): Promise<void> => {
    const maxBytes = input.maxBytes ?? STUDIO_PROPOSAL_MAX_RECORD_BYTES;
    let quarantineFile = input.identified.file;
    if (!input.identified.quarantined) {
      quarantineFile = identityBoundCleanupNameV2(input.identified);
      await assertIdentifiedRecordCurrentV2({ ...input, maxBytes });
      await input.authorize();
      await Promise.all([assertIdentifiedRecordCurrentV2({ ...input, maxBytes }), assertPathAbsentV2(quarantineFile)]);
      await input.authorize();
      try {
        await fs.rename(input.identified.file, quarantineFile);
      } catch (error) {
        throw storageError(error, 'Studio proposal record could not be quarantined');
      }
      await syncDirectoryAuthorityV2(input.authority);
      const renamed: IdentifiedRecordV2<RecordType> = {
        ...input.identified,
        file: quarantineFile,
        quarantined: true,
      };
      try {
        await assertIdentifiedRecordCurrentV2({
          root: input.root,
          authority: input.authority,
          identified: renamed,
          maxBytes,
        });
      } catch (error) {
        try {
          await Promise.all([assertDirectoryAuthorityV2(input.authority), assertPathAbsentV2(input.identified.file)]);
          await fs.rename(quarantineFile, input.identified.file);
          await syncDirectoryAuthorityV2(input.authority);
        } catch (restoreError) {
          throw storageError(restoreError, 'Studio proposal quarantine replacement could not be restored');
        }
        if (error instanceof CreativeStudioStoreError) throw error;
        throw storageError(error, 'Studio proposal record changed while being quarantined');
      }
    }

    const quarantined: IdentifiedRecordV2<RecordType> = {
      ...input.identified,
      file: quarantineFile,
      quarantined: true,
    };
    await assertIdentifiedRecordCurrentV2({
      root: input.root,
      authority: input.authority,
      identified: quarantined,
      maxBytes,
    });
    await input.authorize();
    await assertIdentifiedRecordCurrentV2({
      root: input.root,
      authority: input.authority,
      identified: quarantined,
      maxBytes,
    });
    await input.authorize();
    try {
      await fs.rm(quarantineFile);
    } catch (error) {
      throw storageError(error, 'Studio proposal quarantine could not be removed');
    }
    await syncDirectoryAuthorityV2(input.authority);
  };

  const effectiveProposalV2 = (
    proposal: StudioProposalRecordV2,
    decision: StudioProposalDecisionV2 | undefined
  ): StudioProposalV2 =>
    decision === undefined
      ? proposal
      : {
          ...proposal,
          status: decision.status,
          decidedAt: decision.decidedAt,
        };

  const operationCreatedIdentityOrderV2 = (input: {
    proposal: StudioProposalRecordV2;
    existingBeatIds?: ReadonlySet<string>;
    existingShotIds?: ReadonlySet<string>;
    createdBeatEvidence?: ReadonlySet<string>;
    createdShotEvidence?: ReadonlySet<string>;
  }): { createdBeatIds: string[]; createdShotIds: string[] } => {
    if (input.proposal.payload.kind === 'pin_rule') return { createdBeatIds: [], createdShotIds: [] };
    const beats = new Set(input.existingBeatIds ?? []);
    const shots = new Set(input.existingShotIds ?? []);
    const createdBeatIds: string[] = [];
    const createdShotIds: string[] = [];
    const considerBeat = (beatId: string): void => {
      const isCreated = input.createdBeatEvidence?.has(beatId) ?? !beats.has(beatId);
      if (isCreated && !createdBeatIds.includes(beatId)) createdBeatIds.push(beatId);
      beats.add(beatId);
    };
    const considerShot = (shotId: string): void => {
      const isCreated = input.createdShotEvidence?.has(shotId) ?? !shots.has(shotId);
      if (isCreated && !createdShotIds.includes(shotId)) createdShotIds.push(shotId);
      shots.add(shotId);
    };
    for (const operation of input.proposal.payload.operations) {
      if (operation.kind === 'add_beat' || operation.kind === 'add_binned_beat') considerBeat(operation.beatId);
      else if (operation.kind === 'add_shot') considerShot(operation.shotId);
      else if (operation.kind === 'apply_coverage') {
        for (const shot of operation.shots) considerShot(shot.shotId);
      }
    }
    return { createdBeatIds, createdShotIds };
  };

  const sameOrderedIdsV2 = (left: readonly string[], right: readonly string[]): boolean =>
    left.length === right.length && left.every((id, index) => id === right[index]);

  const assertAttributionCreatedIdsV2 = (input: {
    attribution: StudioProposalCommitAttributionV2;
    proposal: StudioProposalRecordV2;
    project: StudioProjectV2;
    state: 'before' | 'after';
  }): void => {
    let expected: { createdBeatIds: string[]; createdShotIds: string[] };
    if (input.state === 'before') {
      expected = operationCreatedIdentityOrderV2({
        proposal: input.proposal,
        existingBeatIds: new Set(Object.keys(input.project.beats)),
        existingShotIds: new Set(Object.keys(input.project.shots)),
      });
    } else {
      const undo = input.project.undoHistory.at(-1);
      if (
        undo === undefined ||
        undo.id !== input.proposal.id ||
        undo.sourceRevision !== input.attribution.appliedRevision
      ) {
        throw new CreativeStudioStoreError(
          'storage_error',
          'Studio proposal attribution has no matching undo authority'
        );
      }
      const createdBeatEvidence = new Set(
        undo.patches
          .filter((patch) => patch.kind === 'beat_fields' && patch.before === null)
          .map((patch) => (patch.kind === 'beat_fields' ? patch.beatId : ''))
      );
      const createdShotEvidence = new Set(
        undo.patches
          .filter((patch) => patch.kind === 'shot_fields' && patch.before === null)
          .map((patch) => (patch.kind === 'shot_fields' ? patch.shotId : ''))
      );
      expected = operationCreatedIdentityOrderV2({
        proposal: input.proposal,
        createdBeatEvidence,
        createdShotEvidence,
      });
      if (
        expected.createdBeatIds.length !== createdBeatEvidence.size ||
        expected.createdShotIds.length !== createdShotEvidence.size
      ) {
        throw new CreativeStudioStoreError('storage_error', 'Studio proposal attribution created identities mismatch');
      }
    }
    if (
      !sameOrderedIdsV2(input.attribution.createdBeatIds, expected.createdBeatIds) ||
      !sameOrderedIdsV2(input.attribution.createdShotIds, expected.createdShotIds)
    ) {
      throw new CreativeStudioStoreError('storage_error', 'Studio proposal attribution created identities mismatch');
    }
  };

  const assertPathAbsentV2 = async (file: string): Promise<void> => {
    try {
      await fs.lstat(file);
      throw new CreativeStudioStoreError('storage_error', 'Studio proposal authority changed');
    } catch (error) {
      if (error instanceof CreativeStudioStoreError) throw error;
      if (!isRecord(error) || error.code !== 'ENOENT') {
        throw storageError(error, 'Studio proposal authority could not be verified');
      }
    }
  };

  const publishProposalDecisionV2 = async (input: {
    root: string;
    projectId: string;
    directories: ProposalDirectoriesV2;
    proposal: IdentifiedRecordV2<StudioProposalRecordV2>;
    status: StudioProposalDecisionV2['status'];
    decidedAt: string;
    authorizeBeforeLink: (temporary: IdentifiedRecordV2<null>) => Promise<void>;
  }): Promise<IdentifiedRecordV2<StudioProposalDecisionV2>> => {
    if (Date.parse(input.decidedAt) < Date.parse(input.proposal.record.createdAt)) {
      throw new CreativeStudioStoreError('storage_error', 'Studio proposal decision predates its proposal');
    }
    const decision: StudioProposalDecisionV2 = {
      schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
      proposalId: input.proposal.record.id,
      status: input.status,
      decidedAt: input.decidedAt,
    };
    const file = path.join(input.directories.decisions.path, `${input.proposal.record.id}.json`);
    await assertProposalDirectoryAuthoritiesV2(input.directories);
    await assertIdentifiedRecordCurrentV2({
      root: input.root,
      authority: input.directories.pending,
      identified: input.proposal,
    });
    await assertPathAbsentV2(file);
    await publishImmutableJournalRecordV2({
      root: input.root,
      authority: input.directories.decisions,
      file,
      bytes: serializeJsonExact(decision),
      retainTemporary: true,
      authorizeBeforeLink: input.authorizeBeforeLink,
    });
    await assertProposalDirectoryAuthoritiesV2(input.directories);
    const published = await parseIdentifiedJsonV2({
      root: input.root,
      file,
      parse: (value) => parseStudioProposalDecisionV2({ proposalId: decision.proposalId, value }),
    });
    if (
      published.record.status !== decision.status ||
      published.record.decidedAt !== decision.decidedAt ||
      published.bytes !== serializeJsonExact(decision)
    ) {
      throw new CreativeStudioStoreError('storage_error', 'Schema-2 Studio proposal decision changed at publication');
    }
    return published;
  };

  const releaseProposalSlotV2 = async (input: {
    root: string;
    ledger: ProposalLedgerV2;
    proposal: IdentifiedRecordV2<StudioProposalRecordV2>;
    decision: IdentifiedRecordV2<StudioProposalDecisionV2>;
    slot: IdentifiedRecordV2<StudioProposalSlotV2> | undefined;
    projectSnapshot?: Extract<ProjectFileInspectionV2, { status: 'supported' }>;
  }): Promise<void> => {
    if (input.slot === undefined) return;
    const authorize = async (): Promise<void> => {
      await assertProposalDirectoryAuthoritiesV2(input.ledger.directories);
      if (input.projectSnapshot !== undefined) {
        await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.projectSnapshot });
      }
      await Promise.all([
        assertIdentifiedRecordCurrentV2({
          root: input.root,
          authority: input.ledger.directories.pending,
          identified: input.proposal,
        }),
        assertIdentifiedRecordCurrentV2({
          root: input.root,
          authority: input.ledger.directories.decisions,
          identified: input.decision,
        }),
      ]);
      if (input.projectSnapshot !== undefined) {
        await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.projectSnapshot });
      }
    };
    await removeReadyPublicationCompanionV2({
      root: input.root,
      authority: input.ledger.directories.slots,
      named: input.slot,
      maxBytes: STUDIO_PROPOSAL_MAX_RECORD_BYTES,
      authorize,
    });
    await quarantineRemoveIdentifiedRecordV2({
      root: input.root,
      authority: input.ledger.directories.slots,
      identified: input.slot,
      authorize,
    });
  };

  const resolveProposalAttributionV2InsideQueue = async (input: {
    root: string;
    projectId: string;
    snapshot: Extract<ProjectFileInspectionV2, { status: 'supported' }>;
  }): Promise<Extract<ProjectFileInspectionV2, { status: 'supported' }>> => {
    const directories = await resolveProposalDirectoriesV2({
      root: input.root,
      project: input.snapshot.directory,
      createIfWhollyAbsent: false,
    });
    if (directories === null) {
      await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
      return input.snapshot;
    }
    let ledger = await readProposalLedgerV2({ root: input.root, projectId: input.projectId, directories });
    await assertProposalLedgerEntrySetCurrentV2(ledger);
    const effectiveAcceptedDecisions = ledger.journalResidues.filter(
      (residue) =>
        residue.family === 'decisions' && residue.effective && residue.identified.record.status === 'accepted'
    );
    if (
      effectiveAcceptedDecisions.some((residue) => {
        const attribution = ledger.attributions[0]?.record;
        return (
          attribution === undefined ||
          attribution.proposalId !== residue.identified.record.proposalId ||
          attribution.decidedAt !== residue.identified.record.decidedAt
        );
      })
    ) {
      throw new CreativeStudioStoreError(
        'storage_error',
        'Studio accepted proposal decision has no exact commit attribution'
      );
    }
    if (ledger.attributions.length === 0) {
      ledger = await cleanupProposalJournalPublicationResiduesV2(input.root, ledger, () =>
        assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot })
      );
      await Promise.all([
        assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot }),
        assertProposalLedgerEntrySetCurrentV2(ledger),
      ]);
      if (ledger.writerResidues.length > 0) {
        await cleanupProposalWriterResiduesV2(input.root, input.projectId, ledger, input.snapshot);
        ledger = await readProposalLedgerV2({ root: input.root, projectId: input.projectId, directories });
        await Promise.all([
          assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot }),
          assertProposalLedgerEntrySetCurrentV2(ledger),
        ]);
        await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
      }
      return input.snapshot;
    }

    const identifiedAttribution = ledger.attributions[0];
    const attribution = identifiedAttribution.record;
    const proposal = ledger.proposals.get(attribution.proposalId);
    const decision = ledger.decisions.get(attribution.proposalId);
    const heldSlots = ledger.slots.get(attribution.proposalId) ?? [];
    const slot = heldSlots[0];
    if (
      proposal === undefined ||
      proposal.record.baseRevision !== attribution.baseRevision ||
      Date.parse(attribution.decidedAt) < Date.parse(proposal.record.createdAt) ||
      heldSlots.length !== 1 ||
      slot === undefined ||
      slot.record.proposalId !== attribution.proposalId ||
      slot.quarantined
    ) {
      throw new CreativeStudioStoreError('storage_error', 'Studio proposal attribution authority mismatch');
    }
    await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
    await Promise.all([
      assertIdentifiedRecordCurrentV2({
        root: input.root,
        authority: directories.commits,
        identified: identifiedAttribution,
      }),
      assertIdentifiedRecordCurrentV2({ root: input.root, authority: directories.pending, identified: proposal }),
      assertIdentifiedRecordCurrentV2({ root: input.root, authority: directories.slots, identified: slot }),
      ...(decision === undefined
        ? []
        : [
            assertIdentifiedRecordCurrentV2({
              root: input.root,
              authority: directories.decisions,
              identified: decision,
            }),
          ]),
    ]);
    await assertProposalDirectoryAuthoritiesV2(directories);

    const projectDigest = sha256Utf8(input.snapshot.bytes);
    const isExactBefore =
      input.snapshot.project.revision === attribution.baseRevision && projectDigest === attribution.beforeProjectSha256;
    const isExactAfter =
      input.snapshot.project.revision === attribution.appliedRevision &&
      projectDigest === attribution.afterProjectSha256;
    if (isExactBefore === isExactAfter) {
      throw new CreativeStudioStoreError('storage_error', 'Studio proposal attribution project facts mismatch');
    }

    if (isExactBefore) {
      if (decision !== undefined) {
        throw new CreativeStudioStoreError('storage_error', 'Uncommitted Studio proposal has a terminal decision');
      }
      assertAttributionCreatedIdsV2({
        attribution,
        proposal: proposal.record,
        project: input.snapshot.project,
        state: 'before',
      });
      ledger = await cleanupProposalJournalPublicationResiduesV2(input.root, ledger, () =>
        assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot })
      );
      await Promise.all([
        assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot }),
        assertProposalLedgerEntrySetCurrentV2(ledger),
      ]);
      const cleanedAttribution = ledger.attributions[0];
      if (cleanedAttribution === undefined) {
        throw new CreativeStudioStoreError('storage_error', 'Studio proposal attribution disappeared during repair');
      }
      const authorize = async (): Promise<void> => {
        await assertProposalDirectoryAuthoritiesV2(directories);
        await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
        await Promise.all([
          assertIdentifiedRecordCurrentV2({ root: input.root, authority: directories.pending, identified: proposal }),
          assertIdentifiedRecordCurrentV2({ root: input.root, authority: directories.slots, identified: slot }),
          assertPathAbsentV2(path.join(directories.decisions.path, `${attribution.proposalId}.json`)),
        ]);
        await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
      };
      await removeJournalPublicationCompanionV2({
        root: input.root,
        authority: directories.commits,
        named: cleanedAttribution,
        maxBytes: STUDIO_PROPOSAL_MAX_RECORD_BYTES,
        authorize,
      });
      await quarantineRemoveIdentifiedRecordV2({
        root: input.root,
        authority: directories.commits,
        identified: cleanedAttribution,
        authorize,
      });
      const fresh = await inspectProjectFileV2(input.root, input.projectId);
      if (fresh.status !== 'supported') {
        throw new CreativeStudioStoreError('storage_error', 'Studio project authority changed during proposal repair');
      }
      const postRepairLedger = await readProposalLedgerV2({
        root: input.root,
        projectId: input.projectId,
        directories,
      });
      await assertProposalLedgerEntrySetCurrentV2(postRepairLedger);
      await cleanupProposalWriterResiduesV2(input.root, input.projectId, postRepairLedger, fresh);
      await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: fresh });
      return fresh;
    }

    const effectiveDecisionResidue = ledger.journalResidues.some(
      (residue) =>
        residue.family === 'decisions' &&
        residue.effective &&
        residue.identified.record.proposalId === attribution.proposalId
    );
    if (
      input.snapshot.project.updatedAt !== attribution.decidedAt ||
      (identifiedAttribution.quarantined && (decision === undefined || effectiveDecisionResidue))
    ) {
      throw new CreativeStudioStoreError('storage_error', 'Committed Studio proposal attribution timestamp mismatch');
    }
    assertAttributionCreatedIdsV2({
      attribution,
      proposal: proposal.record,
      project: input.snapshot.project,
      state: 'after',
    });
    let acceptedDecision = decision;
    if (acceptedDecision !== undefined) {
      if (
        acceptedDecision.record.status !== 'accepted' ||
        acceptedDecision.record.decidedAt !== attribution.decidedAt
      ) {
        throw new CreativeStudioStoreError('storage_error', 'Studio proposal attribution decision mismatch');
      }
    }
    ledger = await cleanupProposalJournalPublicationResiduesV2(input.root, ledger, () =>
      assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot })
    );
    await Promise.all([
      assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot }),
      assertProposalLedgerEntrySetCurrentV2(ledger),
    ]);
    const cleanedAttribution = ledger.attributions[0];
    if (cleanedAttribution === undefined) {
      throw new CreativeStudioStoreError('storage_error', 'Studio proposal attribution disappeared during repair');
    }
    acceptedDecision = ledger.decisions.get(attribution.proposalId);
    if (acceptedDecision === undefined) {
      await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
      await assertProposalDirectoryAuthoritiesV2(directories);
      acceptedDecision = await publishProposalDecisionV2({
        root: input.root,
        projectId: input.projectId,
        directories,
        proposal,
        status: 'accepted',
        decidedAt: attribution.decidedAt,
        authorizeBeforeLink: async (temporary) => {
          await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
          await assertProposalLedgerEntrySetCurrentV2(ledger, { decision: temporary });
          await Promise.all([
            assertIdentifiedRecordCurrentV2({ root: input.root, authority: directories.pending, identified: proposal }),
            assertIdentifiedRecordCurrentV2({ root: input.root, authority: directories.slots, identified: slot }),
            assertIdentifiedRecordCurrentV2({
              root: input.root,
              authority: directories.commits,
              identified: cleanedAttribution,
            }),
            assertPathAbsentV2(path.join(directories.decisions.path, `${attribution.proposalId}.json`)),
          ]);
          await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
        },
      });
    }
    const resolvedLedger: ProposalLedgerV2 = {
      ...ledger,
      decisions: new Map(ledger.decisions).set(attribution.proposalId, acceptedDecision),
    };
    await assertProposalLedgerEntrySetCurrentV2(resolvedLedger);

    const authorizeAttributionCleanup = async (): Promise<void> => {
      await assertProposalDirectoryAuthoritiesV2(directories);
      await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
      await Promise.all([
        assertIdentifiedRecordCurrentV2({ root: input.root, authority: directories.pending, identified: proposal }),
        assertIdentifiedRecordCurrentV2({
          root: input.root,
          authority: directories.decisions,
          identified: acceptedDecision,
        }),
        assertIdentifiedRecordCurrentV2({ root: input.root, authority: directories.slots, identified: slot }),
      ]);
      await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
    };
    await removeJournalPublicationCompanionV2({
      root: input.root,
      authority: directories.commits,
      named: cleanedAttribution,
      maxBytes: STUDIO_PROPOSAL_MAX_RECORD_BYTES,
      authorize: authorizeAttributionCleanup,
    });
    await quarantineRemoveIdentifiedRecordV2({
      root: input.root,
      authority: directories.commits,
      identified: cleanedAttribution,
      authorize: authorizeAttributionCleanup,
    });
    const repairedLedger: ProposalLedgerV2 = { ...resolvedLedger, attributions: [] };
    await releaseProposalSlotV2({
      root: input.root,
      ledger: repairedLedger,
      proposal,
      decision: acceptedDecision,
      slot,
      projectSnapshot: input.snapshot,
    });
    const fresh = await inspectProjectFileV2(input.root, input.projectId);
    if (fresh.status !== 'supported') {
      throw new CreativeStudioStoreError('storage_error', 'Studio project authority changed during proposal repair');
    }
    const postRepairLedger = await readProposalLedgerV2({ root: input.root, projectId: input.projectId, directories });
    await assertProposalLedgerEntrySetCurrentV2(postRepairLedger);
    await cleanupProposalWriterResiduesV2(input.root, input.projectId, postRepairLedger, fresh);
    await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: fresh });
    return fresh;
  };

  const isReferenceGenerationDecisionV2 = (
    decision: StudioReferenceRequestDecisionV2
  ): decision is StudioReferenceGenerationDecisionV2 => decision.outcome.kind === 'generation_gate';

  const publishReferenceRequestDecisionV2 = async (input: {
    root: string;
    projectId: string;
    directories: ReferenceRequestDirectoriesV2;
    request: IdentifiedRecordV2<StudioReferenceRequestV2>;
    outcome: StudioReferenceRequestDecisionV2['outcome'];
    decidedAt: string;
    authorizeBeforeLink: (temporary: IdentifiedRecordV2<null>) => Promise<void>;
  }): Promise<IdentifiedRecordV2<StudioReferenceRequestDecisionV2>> => {
    const decision: StudioReferenceRequestDecisionV2 = {
      schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
      requestId: input.request.record.id,
      projectId: input.projectId,
      decidedAt: input.decidedAt,
      outcome: structuredClone(input.outcome),
    };
    const bytes = serializeJsonExact(decision);
    const file = path.join(input.directories.decisions.path, `${decision.requestId}.json`);
    await assertReferenceRequestDirectoryAuthoritiesV2(input.directories);
    await assertPathAbsentV2(file);
    await publishImmutableJournalRecordV2({
      root: input.root,
      authority: input.directories.decisions,
      file,
      bytes,
      maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
      retainTemporary: true,
      authorizeBeforeLink: input.authorizeBeforeLink,
    });
    await assertReferenceRequestDirectoryAuthoritiesV2(input.directories);
    const published = await parseIdentifiedJsonV2({
      root: input.root,
      file,
      maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
      parse: (value) =>
        parseStudioReferenceRequestDecisionV2({
          projectId: input.projectId,
          requestId: decision.requestId,
          value,
        }),
    });
    if (published.bytes !== bytes) {
      throw new CreativeStudioStoreError('storage_error', 'Studio reference request decision changed at publication');
    }
    return published;
  };

  const publishReferenceGenerationHandoffReceiptV2 = async (input: {
    root: string;
    directories: ReferenceRequestDirectoriesV2;
    receipt: StudioReferenceGenerationHandoffReceiptV2;
    authorizeBeforeLink: (temporary: IdentifiedRecordV2<null>) => Promise<void>;
  }): Promise<IdentifiedRecordV2<StudioReferenceGenerationHandoffReceiptV2>> => {
    const bytes = serializeJsonExact(input.receipt);
    const file = path.join(input.directories.receipts.path, `${input.receipt.handoffId}.json`);
    await assertReferenceRequestDirectoryAuthoritiesV2(input.directories);
    await assertPathAbsentV2(file);
    await publishImmutableJournalRecordV2({
      root: input.root,
      authority: input.directories.receipts,
      file,
      bytes,
      maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
      retainTemporary: true,
      authorizeBeforeLink: input.authorizeBeforeLink,
    });
    await assertReferenceRequestDirectoryAuthoritiesV2(input.directories);
    const published = await parseIdentifiedJsonV2({
      root: input.root,
      file,
      maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
      parse: (value) => parseStudioReferenceGenerationHandoffReceiptV2({ handoffId: input.receipt.handoffId, value }),
    });
    if (published.bytes !== bytes) {
      throw new CreativeStudioStoreError('storage_error', 'Studio reference handoff receipt changed at publication');
    }
    return published;
  };

  const assertPendingReferenceRequestSlotV2 = (
    ledger: ReferenceRequestLedgerV2,
    requestId: string
  ): IdentifiedRecordV2<StudioReferenceRequestSlotV2> => {
    const held = ledger.slots.get(requestId) ?? [];
    if (held.length !== 1 || held[0].quarantined) {
      throw new CreativeStudioStoreError('storage_error', 'Pending Studio reference request has no exact slot');
    }
    return held[0];
  };

  const releaseReferenceRequestSlotV2 = async (input: {
    root: string;
    ledger: ReferenceRequestLedgerV2;
    request: IdentifiedRecordV2<StudioReferenceRequestV2>;
    decision: IdentifiedRecordV2<StudioReferenceRequestDecisionV2>;
    receipt?: IdentifiedRecordV2<StudioReferenceGenerationHandoffReceiptV2>;
    slot: IdentifiedRecordV2<StudioReferenceRequestSlotV2> | undefined;
    projectSnapshot: Extract<ProjectFileInspectionV2, { status: 'supported' }>;
  }): Promise<void> => {
    if (input.slot === undefined) return;
    const authorize = async (): Promise<void> => {
      await assertReferenceRequestDirectoryAuthoritiesV2(input.ledger.directories);
      await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.projectSnapshot });
      await Promise.all([
        assertIdentifiedRecordCurrentV2({
          root: input.root,
          authority: input.ledger.directories.pending,
          identified: input.request,
          maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
        }),
        assertIdentifiedRecordCurrentV2({
          root: input.root,
          authority: input.ledger.directories.decisions,
          identified: input.decision,
          maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
        }),
        ...(input.receipt === undefined
          ? []
          : [
              assertIdentifiedRecordCurrentV2({
                root: input.root,
                authority: input.ledger.directories.receipts,
                identified: input.receipt,
                maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
              }),
            ]),
      ]);
      await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.projectSnapshot });
    };
    await removeReadyPublicationCompanionV2({
      root: input.root,
      authority: input.ledger.directories.slots,
      named: input.slot,
      maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
      authorize,
    });
    await quarantineRemoveIdentifiedRecordV2({
      root: input.root,
      authority: input.ledger.directories.slots,
      identified: input.slot,
      authorize,
      maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
    });
  };

  const referenceAuthorizationByHandoffV2 = (
    project: StudioProjectV2
  ): Map<string, StudioProjectV2['spendAuthorizations'][number]> => {
    const authorizations = new Map<string, StudioProjectV2['spendAuthorizations'][number]>();
    for (const authorization of project.spendAuthorizations) {
      const handoffId = authorization.originReferenceHandoffId;
      if (handoffId === null) continue;
      if (authorizations.has(handoffId)) {
        throw new CreativeStudioStoreError('storage_error', 'Ambiguous Studio reference authorization origin');
      }
      authorizations.set(handoffId, authorization);
    }
    return authorizations;
  };

  const assertReferenceAuthorizationRelationsV2 = (input: {
    project: StudioProjectV2;
    ledger: ReferenceRequestLedgerV2;
  }): Array<{
    handoffId: string;
    authorization: StudioProjectV2['spendAuthorizations'][number];
    decision: IdentifiedRecordV2<StudioReferenceRequestDecisionV2>;
    request: IdentifiedRecordV2<StudioReferenceRequestV2>;
    slot: IdentifiedRecordV2<StudioReferenceRequestSlotV2>;
  }> => {
    const authorizations = referenceAuthorizationByHandoffV2(input.project);
    const missing: Array<{
      handoffId: string;
      authorization: StudioProjectV2['spendAuthorizations'][number];
      decision: IdentifiedRecordV2<StudioReferenceRequestDecisionV2>;
      request: IdentifiedRecordV2<StudioReferenceRequestV2>;
      slot: IdentifiedRecordV2<StudioReferenceRequestSlotV2>;
    }> = [];
    for (const [handoffId, authorization] of authorizations) {
      const decision = input.ledger.generationDecisions.get(handoffId);
      if (decision === undefined || !isReferenceGenerationDecisionV2(decision.record)) {
        throw new CreativeStudioStoreError('storage_error', 'Studio authorization has no reference handoff decision');
      }
      const generationOutcome = decision.record.outcome;
      const request = input.ledger.requests.get(decision.record.requestId);
      if (request === undefined) {
        throw new CreativeStudioStoreError('storage_error', 'Studio authorization reference request is missing');
      }
      if (
        authorization.cascadeItems.length !== 0 ||
        authorization.baseItems.length !== generationOutcome.shotIds.length ||
        Date.parse(authorization.confirmedAt) < Date.parse(decision.record.decidedAt) ||
        !authorization.baseItems.every(
          (item, index) => item.purpose === 'seed_still' && item.shotId === generationOutcome.shotIds[index]
        )
      ) {
        throw new CreativeStudioStoreError('storage_error', 'Studio authorization reference handoff scope mismatch');
      }
      const receipt = input.ledger.receipts.get(handoffId);
      if (receipt === undefined) {
        missing.push({
          handoffId,
          authorization,
          decision,
          request,
          slot: assertPendingReferenceRequestSlotV2(input.ledger, request.record.id),
        });
      } else if (
        receipt.record.result.kind !== 'confirmed' ||
        receipt.record.result.authorizationId !== authorization.id ||
        receipt.record.completedAt !== authorization.confirmedAt
      ) {
        throw new CreativeStudioStoreError('storage_error', 'Studio authorization reference receipt mismatch');
      }
    }
    for (const [handoffId, receipt] of input.ledger.receipts) {
      const authorization = authorizations.get(handoffId);
      if (receipt.record.result.kind === 'dismissed') {
        if (authorization !== undefined) {
          throw new CreativeStudioStoreError('storage_error', 'Dismissed Studio reference handoff has authorization');
        }
      } else if (
        authorization === undefined ||
        receipt.record.result.authorizationId !== authorization.id ||
        receipt.record.completedAt !== authorization.confirmedAt
      ) {
        throw new CreativeStudioStoreError(
          'storage_error',
          'Confirmed Studio reference handoff has no exact authorization'
        );
      }
    }
    for (const decision of input.ledger.decisions.values()) {
      if (
        decision.record.outcome.kind === 'imported_reference' &&
        decision.record.outcome.projectRevision > input.project.revision
      ) {
        throw new CreativeStudioStoreError('storage_error', 'Studio imported reference decision is from the future');
      }
    }
    return missing;
  };

  const resolveReferenceAuthorizationReceiptsV2InsideQueue = async (input: {
    root: string;
    projectId: string;
    snapshot: Extract<ProjectFileInspectionV2, { status: 'supported' }>;
  }): Promise<Extract<ProjectFileInspectionV2, { status: 'supported' }>> => {
    const directories = await resolveReferenceRequestDirectoriesV2({
      root: input.root,
      project: input.snapshot.directory,
      createIfWhollyAbsent: false,
    });
    if (directories === null) {
      if (input.snapshot.project.spendAuthorizations.some((authorization) => authorization.originReferenceHandoffId)) {
        throw new CreativeStudioStoreError('storage_error', 'Studio reference authorization ledger is missing');
      }
      await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
      return input.snapshot;
    }
    let ledger = await readReferenceRequestLedgerV2({
      root: input.root,
      projectId: input.projectId,
      directories,
    });
    await assertReferenceRequestLedgerEntrySetCurrentV2(ledger);
    let missing = assertReferenceAuthorizationRelationsV2({ project: input.snapshot.project, ledger });
    const activeShotPositions = new Map(
      input.snapshot.project.beatOrder
        .flatMap((beatId) => input.snapshot.project.beats[beatId]?.shotOrder ?? [])
        .map((shotId, index) => [shotId, index])
    );
    for (const residue of ledger.journalResidues) {
      if (residue.family !== 'decisions' || !residue.effective) continue;
      const decision = residue.identified.record;
      const request = ledger.requests.get(decision.requestId);
      if (request === undefined) {
        throw new CreativeStudioStoreError('storage_error', 'Studio reference decision has no immutable request');
      }
      if (decision.outcome.kind === 'imported_reference') {
        if (
          decision.outcome.projectRevision !== input.snapshot.project.revision ||
          !isActiveClassifiedBriefImageV2(input.snapshot.project, decision.outcome.assetId)
        ) {
          throw new CreativeStudioStoreError(
            'storage_error',
            'Studio imported reference publication is no longer current'
          );
        }
      } else if (decision.outcome.kind === 'generation_gate') {
        let previous = -1;
        for (const shotId of request.record.shotIds) {
          const position = activeShotPositions.get(shotId);
          if (position === undefined || position <= previous) {
            throw new CreativeStudioStoreError(
              'storage_error',
              'Studio reference generation publication is no longer active'
            );
          }
          previous = position;
        }
      }
    }
    ledger = await cleanupReferenceJournalPublicationResiduesV2(input.root, ledger, () =>
      assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot })
    );
    missing = assertReferenceAuthorizationRelationsV2({ project: input.snapshot.project, ledger });
    for (const repair of missing) {
      await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
      await assertReferenceRequestLedgerEntrySetCurrentV2(ledger);
      await Promise.all([
        assertIdentifiedRecordCurrentV2({
          root: input.root,
          authority: directories.pending,
          identified: repair.request,
          maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
        }),
        assertIdentifiedRecordCurrentV2({
          root: input.root,
          authority: directories.decisions,
          identified: repair.decision,
          maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
        }),
        assertIdentifiedRecordCurrentV2({
          root: input.root,
          authority: directories.slots,
          identified: repair.slot,
          maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
        }),
        assertPathAbsentV2(path.join(directories.receipts.path, `${repair.handoffId}.json`)),
      ]);
      const receiptRecord: StudioReferenceGenerationHandoffReceiptV2 = {
        schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
        handoffId: repair.handoffId,
        requestId: repair.request.record.id,
        completedAt: repair.authorization.confirmedAt,
        result: { kind: 'confirmed', authorizationId: repair.authorization.id },
      };
      // A project has a bounded authorization ledger and repairs remain sequentially attributable.
      // eslint-disable-next-line no-await-in-loop
      const receipt = await publishReferenceGenerationHandoffReceiptV2({
        root: input.root,
        directories,
        receipt: receiptRecord,
        authorizeBeforeLink: async (temporary) => {
          await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
          await assertReferenceRequestLedgerEntrySetCurrentV2(ledger, { receipt: temporary });
          await Promise.all([
            assertIdentifiedRecordCurrentV2({
              root: input.root,
              authority: directories.pending,
              identified: repair.request,
              maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
            }),
            assertIdentifiedRecordCurrentV2({
              root: input.root,
              authority: directories.decisions,
              identified: repair.decision,
              maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
            }),
            assertIdentifiedRecordCurrentV2({
              root: input.root,
              authority: directories.slots,
              identified: repair.slot,
              maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
            }),
            assertPathAbsentV2(path.join(directories.receipts.path, `${repair.handoffId}.json`)),
          ]);
          await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
        },
      });
      ledger = { ...ledger, receipts: new Map(ledger.receipts).set(repair.handoffId, receipt) };
      await assertReferenceRequestLedgerEntrySetCurrentV2(ledger);
      // eslint-disable-next-line no-await-in-loop
      await releaseReferenceRequestSlotV2({
        root: input.root,
        ledger,
        request: repair.request,
        decision: repair.decision,
        receipt,
        slot: repair.slot,
        projectSnapshot: input.snapshot,
      });
      const slots = new Map(ledger.slots);
      slots.delete(repair.request.record.id);
      ledger = { ...ledger, slots };
    }
    for (const [handoffId, receipt] of ledger.receipts) {
      const decision = ledger.generationDecisions.get(handoffId);
      if (decision === undefined) continue;
      const request = ledger.requests.get(decision.record.requestId);
      const slot = ledger.slots.get(decision.record.requestId)?.[0];
      if (request === undefined || slot === undefined) continue;
      // eslint-disable-next-line no-await-in-loop
      await releaseReferenceRequestSlotV2({
        root: input.root,
        ledger,
        request,
        decision,
        receipt,
        slot,
        projectSnapshot: input.snapshot,
      });
      const slots = new Map(ledger.slots);
      slots.delete(request.record.id);
      ledger = { ...ledger, slots };
    }
    const postRepairLedger = await readReferenceRequestLedgerV2({
      root: input.root,
      projectId: input.projectId,
      directories,
    });
    assertReferenceAuthorizationRelationsV2({ project: input.snapshot.project, ledger: postRepairLedger });
    await cleanupReferenceWriterResiduesV2(input.root, input.projectId, postRepairLedger, input.snapshot);
    await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
    return input.snapshot;
  };

  const inspectProjectWithAttributionFenceV2InsideQueue = async (
    root: string,
    projectId: string
  ): Promise<ProjectFileInspectionV2> => {
    const deletion = await readProjectDeletionMarkerV2(root, projectId);
    if (deletion !== null) {
      const paths = projectDeletionPathsV2(root, projectId);
      let liveTarget = false;
      let quarantine = false;
      try {
        await fs.lstat(paths.projectDirectory);
        liveTarget = true;
      } catch (error) {
        if (!isRecord(error) || error.code !== 'ENOENT') {
          throw storageError(error, 'Studio pending deletion target could not be inspected');
        }
      }
      try {
        await fs.lstat(paths.quarantineDirectory);
        quarantine = true;
      } catch (error) {
        if (!isRecord(error) || error.code !== 'ENOENT') {
          throw storageError(error, 'Studio pending deletion quarantine could not be inspected');
        }
      }
      if (liveTarget && !quarantine) {
        throw new CreativeStudioStoreError('storage_error', 'Studio project deletion requires an explicit retry');
      }
      await finishProjectDeletionV2(root, deletion);
      return { status: 'not_found', projectId };
    }
    const inspected = await inspectProjectFileV2(root, projectId);
    if (inspected.status !== 'supported') return inspected;
    const proposalResolved = await resolveProposalAttributionV2InsideQueue({ root, projectId, snapshot: inspected });
    return resolveReferenceAuthorizationReceiptsV2InsideQueue({ root, projectId, snapshot: proposalResolved });
  };

  const inspectProjectThroughAttributionFenceV2 = (root: string, projectId: string): Promise<ProjectFileInspectionV2> =>
    enqueue(projectId, () => inspectProjectWithAttributionFenceV2InsideQueue(root, projectId));

  const requireSupportedProjectInspectionV2 = (
    inspected: ProjectFileInspectionV2
  ): Extract<ProjectFileInspectionV2, { status: 'supported' }> => {
    if (inspected.status === 'supported') return inspected;
    if (inspected.status === 'not_found') {
      throw new CreativeStudioStoreError('not_found', 'Studio project not found');
    }
    if (inspected.status === 'unsupported_prototype_schema') {
      throw new CreativeStudioStoreError('unsupported_prototype_schema', 'Unsupported prototype Studio schema');
    }
    throw inspected.error;
  };

  const readCleanProposalLedgerV2InsideQueue = async (input: {
    root: string;
    projectId: string;
    snapshot: Extract<ProjectFileInspectionV2, { status: 'supported' }>;
    createIfWhollyAbsent: boolean;
  }): Promise<ProposalLedgerV2 | null> => {
    let snapshot = input.snapshot;
    let directories = await resolveProposalDirectoriesV2({
      root: input.root,
      project: snapshot.directory,
      createIfWhollyAbsent: input.createIfWhollyAbsent,
      snapshot,
    });
    if (directories === null) {
      await assertProjectSnapshotCurrentV2({ root: input.root, snapshot });
      return null;
    }
    let ledger = await readProposalLedgerV2({ root: input.root, projectId: input.projectId, directories });
    if (ledger.attributions.length > 0) {
      snapshot = await resolveProposalAttributionV2InsideQueue({
        root: input.root,
        projectId: input.projectId,
        snapshot,
      });
      directories = await resolveProposalDirectoriesV2({
        root: input.root,
        project: snapshot.directory,
        createIfWhollyAbsent: false,
      });
      if (directories === null) {
        throw new CreativeStudioStoreError('storage_error', 'Studio proposal attribution removed its directory family');
      }
      ledger = await readProposalLedgerV2({ root: input.root, projectId: input.projectId, directories });
      if (ledger.attributions.length > 0) {
        throw new CreativeStudioStoreError('storage_error', 'Studio proposal attribution did not resolve');
      }
    }
    return ledger;
  };

  const assertPendingProposalSlotV2 = (
    ledger: ProposalLedgerV2,
    proposalId: string
  ): IdentifiedRecordV2<StudioProposalSlotV2> => {
    const held = ledger.slots.get(proposalId) ?? [];
    if (held.length !== 1 || held[0].quarantined) {
      throw new CreativeStudioStoreError('storage_error', 'Pending Studio proposal has no exact slot authority');
    }
    return held[0];
  };

  const cleanupOrphanProposalSlotV2 = async (input: {
    root: string;
    projectId: string;
    snapshot: Extract<ProjectFileInspectionV2, { status: 'supported' }>;
    ledger: ProposalLedgerV2;
    slot: IdentifiedRecordV2<StudioProposalSlotV2>;
  }): Promise<void> => {
    const authorize = async (): Promise<void> => {
      await assertProposalDirectoryAuthoritiesV2(input.ledger.directories);
      await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
      await Promise.all([
        assertPathAbsentV2(path.join(input.ledger.directories.pending.path, `${input.slot.record.proposalId}.json`)),
        assertPathAbsentV2(path.join(input.ledger.directories.decisions.path, `${input.slot.record.proposalId}.json`)),
      ]);
      await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
    };
    await removeReadyPublicationCompanionV2({
      root: input.root,
      authority: input.ledger.directories.slots,
      named: input.slot,
      maxBytes: STUDIO_PROPOSAL_MAX_RECORD_BYTES,
      authorize,
    });
    await quarantineRemoveIdentifiedRecordV2({
      root: input.root,
      authority: input.ledger.directories.slots,
      identified: input.slot,
      authorize,
    });
  };

  const reapProposalLedgerV2InsideQueue = async (input: {
    root: string;
    projectId: string;
    snapshot: Extract<ProjectFileInspectionV2, { status: 'supported' }>;
    ledger: ProposalLedgerV2;
  }): Promise<ProposalLedgerV2> => {
    if (input.ledger.attributions.length > 0) {
      throw new CreativeStudioStoreError('storage_error', 'Studio proposal attribution must resolve before reaping');
    }
    for (const [proposalId] of input.ledger.proposals) {
      if (!input.ledger.decisions.has(proposalId)) assertPendingProposalSlotV2(input.ledger, proposalId);
    }

    await assertProposalLedgerEntrySetCurrentV2(input.ledger);
    const currentTime = Date.parse(now());
    const cutoff = currentTime - STUDIO_PROPOSAL_PENDING_TTL_MS;
    const orphanSlotCutoff = currentTime - STUDIO_PROPOSAL_STALE_SLOT_MS;
    const decisions = new Map(input.ledger.decisions);
    const slots = new Map(input.ledger.slots);
    for (const [proposalId, proposal] of input.ledger.proposals) {
      let decision = decisions.get(proposalId);
      const slot = slots.get(proposalId)?.[0];
      if (decision === undefined && Date.parse(proposal.record.createdAt) <= cutoff) {
        const decidedAt = now();
        if (!isCanonicalIsoTimestamp(decidedAt)) {
          throw new CreativeStudioStoreError('storage_error', 'Studio proposal decision clock is invalid');
        }
        // The ledger was fully validated before the first terminal publication.
        // eslint-disable-next-line no-await-in-loop
        decision = await publishProposalDecisionV2({
          root: input.root,
          projectId: input.projectId,
          directories: input.ledger.directories,
          proposal,
          status: 'expired',
          decidedAt,
          authorizeBeforeLink: async (temporary) => {
            const effectiveLedger = { ...input.ledger, decisions, slots };
            await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
            await assertProposalLedgerEntrySetCurrentV2(effectiveLedger, { decision: temporary });
            await Promise.all([
              assertIdentifiedRecordCurrentV2({
                root: input.root,
                authority: input.ledger.directories.pending,
                identified: proposal,
              }),
              ...(slot === undefined
                ? []
                : [
                    assertIdentifiedRecordCurrentV2({
                      root: input.root,
                      authority: input.ledger.directories.slots,
                      identified: slot,
                    }),
                  ]),
              assertPathAbsentV2(path.join(input.ledger.directories.decisions.path, `${proposalId}.json`)),
            ]);
            await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
          },
        });
        decisions.set(proposalId, decision);
      }
      if (decision !== undefined && slot !== undefined) {
        // eslint-disable-next-line no-await-in-loop
        await releaseProposalSlotV2({
          root: input.root,
          ledger: { ...input.ledger, decisions, slots },
          proposal,
          decision,
          slot,
          projectSnapshot: input.snapshot,
        });
        slots.delete(proposalId);
      }
    }
    for (const [proposalId, held] of slots) {
      if (input.ledger.proposals.has(proposalId) || held.length !== 1) continue;
      const slot = held[0];
      if (Date.parse(slot.record.reservedAt) > orphanSlotCutoff) continue;
      // eslint-disable-next-line no-await-in-loop
      await cleanupOrphanProposalSlotV2({
        root: input.root,
        projectId: input.projectId,
        snapshot: input.snapshot,
        ledger: input.ledger,
        slot,
      });
      slots.delete(proposalId);
    }
    return { ...input.ledger, decisions, slots };
  };

  const listProposalsV2InsideQueue = async (input: {
    root: string;
    projectId: string;
    snapshot: Extract<ProjectFileInspectionV2, { status: 'supported' }>;
    createIfWhollyAbsent: boolean;
  }): Promise<StudioProposalV2[]> => {
    const ledger = await readCleanProposalLedgerV2InsideQueue(input);
    if (ledger === null) {
      await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
      return [];
    }
    const reaped = await reapProposalLedgerV2InsideQueue({ ...input, ledger });
    const result = [...reaped.proposals.values()]
      .map((proposal) => effectiveProposalV2(proposal.record, reaped.decisions.get(proposal.record.id)?.record))
      .toSorted((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
    await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
    return result;
  };

  const listProposalsV2ThroughQueue = (projectId: string): Promise<StudioProposalV2[]> =>
    enqueue(projectId, async () => {
      const root = await existingCanonicalRootV2();
      if (root === null) throw new CreativeStudioStoreError('not_found', 'Studio project not found');
      const snapshot = requireSupportedProjectInspectionV2(
        await inspectProjectWithAttributionFenceV2InsideQueue(root, projectId)
      );
      return listProposalsV2InsideQueue({ root, projectId, snapshot, createIfWhollyAbsent: false });
    });

  const readCleanReferenceRequestLedgerV2InsideQueue = async (input: {
    root: string;
    projectId: string;
    snapshot: Extract<ProjectFileInspectionV2, { status: 'supported' }>;
    createIfWhollyAbsent: boolean;
  }): Promise<ReferenceRequestLedgerV2 | null> => {
    const directories = await resolveReferenceRequestDirectoriesV2({
      root: input.root,
      project: input.snapshot.directory,
      createIfWhollyAbsent: input.createIfWhollyAbsent,
      snapshot: input.snapshot,
    });
    if (directories === null) {
      await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
      return null;
    }
    let ledger = await readReferenceRequestLedgerV2({
      root: input.root,
      projectId: input.projectId,
      directories,
    });
    const missing = assertReferenceAuthorizationRelationsV2({ project: input.snapshot.project, ledger });
    if (missing.length > 0) {
      throw new CreativeStudioStoreError('storage_error', 'Studio reference authorization receipt was not repaired');
    }
    ledger = await cleanupReferenceJournalPublicationResiduesV2(input.root, ledger, () =>
      assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot })
    );
    if (ledger.writerResidues.length > 0) {
      await cleanupReferenceWriterResiduesV2(input.root, input.projectId, ledger, input.snapshot);
      ledger = await readReferenceRequestLedgerV2({
        root: input.root,
        projectId: input.projectId,
        directories,
      });
      assertReferenceAuthorizationRelationsV2({ project: input.snapshot.project, ledger });
    }
    await Promise.all([
      assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot }),
      assertReferenceRequestLedgerEntrySetCurrentV2(ledger),
    ]);
    return ledger;
  };

  const referenceRequestLedgerEntryV2 = (
    ledger: ReferenceRequestLedgerV2,
    request: IdentifiedRecordV2<StudioReferenceRequestV2>
  ): StudioReferenceRequestLedgerEntryV2 => {
    const decision = ledger.decisions.get(request.record.id)?.record ?? null;
    const receipt =
      decision?.outcome.kind === 'generation_gate'
        ? (ledger.receipts.get(decision.outcome.handoffId)?.record ?? null)
        : null;
    return { request: request.record, decision, receipt };
  };

  const activeShotOrderV2 = (project: StudioProjectV2): string[] =>
    project.beatOrder.flatMap((beatId) => project.beats[beatId]?.shotOrder ?? []);

  const assertReferenceRequestShotsActiveV2 = (project: StudioProjectV2, request: StudioReferenceRequestV2): void => {
    const positions = new Map(activeShotOrderV2(project).map((shotId, index) => [shotId, index]));
    let previous = -1;
    for (const shotId of request.shotIds) {
      const position = positions.get(shotId);
      if (position === undefined || position <= previous) {
        throw new CreativeStudioStoreError('invalid_payload', 'Studio reference request shots are no longer active');
      }
      previous = position;
    }
  };

  const isActiveClassifiedBriefImageV2 = (project: StudioProjectV2, assetId: string): boolean => {
    if (!Object.hasOwn(project.assets, assetId)) return false;
    const asset = project.assets[assetId];
    return (
      asset !== undefined &&
      asset.id === assetId &&
      asset.projectId === project.id &&
      asset.shotId === null &&
      asset.mediaKind === 'image' &&
      asset.managedAsset.collection === 'imports' &&
      (asset.briefReferenceRole === 'cast' || asset.briefReferenceRole === 'look') &&
      typeof asset.briefReferenceLabel === 'string'
    );
  };

  const sameReferenceDecisionIntentV2 = (
    decision: StudioReferenceRequestDecisionV2,
    intent: StudioReferenceDecisionIntentV2
  ): boolean =>
    decision.outcome.kind === intent.kind &&
    (intent.kind !== 'imported_reference' ||
      (decision.outcome.kind === 'imported_reference' && decision.outcome.assetId === intent.assetId));

  const cleanupOrphanReferenceRequestSlotV2 = async (input: {
    root: string;
    snapshot: Extract<ProjectFileInspectionV2, { status: 'supported' }>;
    ledger: ReferenceRequestLedgerV2;
    slot: IdentifiedRecordV2<StudioReferenceRequestSlotV2>;
  }): Promise<void> => {
    const authorize = async (): Promise<void> => {
      await assertReferenceRequestDirectoryAuthoritiesV2(input.ledger.directories);
      await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
      await Promise.all([
        assertPathAbsentV2(path.join(input.ledger.directories.pending.path, `${input.slot.record.requestId}.json`)),
        assertPathAbsentV2(path.join(input.ledger.directories.decisions.path, `${input.slot.record.requestId}.json`)),
      ]);
      await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
    };
    await removeReadyPublicationCompanionV2({
      root: input.root,
      authority: input.ledger.directories.slots,
      named: input.slot,
      maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
      authorize,
    });
    await quarantineRemoveIdentifiedRecordV2({
      root: input.root,
      authority: input.ledger.directories.slots,
      identified: input.slot,
      authorize,
      maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
    });
  };

  const reapReferenceRequestLedgerV2InsideQueue = async (input: {
    root: string;
    projectId: string;
    snapshot: Extract<ProjectFileInspectionV2, { status: 'supported' }>;
    ledger: ReferenceRequestLedgerV2;
  }): Promise<ReferenceRequestLedgerV2> => {
    await assertReferenceRequestLedgerEntrySetCurrentV2(input.ledger);
    const observedAt = now();
    if (!isCanonicalIsoTimestamp(observedAt)) {
      throw new CreativeStudioStoreError('storage_error', 'Studio reference request reap clock is invalid');
    }
    const currentTime = Date.parse(observedAt);
    const cutoff = currentTime - STUDIO_REFERENCE_REQUEST_V2_PENDING_TTL_MS;
    const orphanSlotCutoff = currentTime - STUDIO_PROPOSAL_STALE_SLOT_MS;
    let ledger = input.ledger;
    for (const [requestId, request] of ledger.requests) {
      let decision = ledger.decisions.get(requestId);
      if (decision === undefined && Date.parse(request.record.createdAt) <= cutoff) {
        const expiringSlot = assertPendingReferenceRequestSlotV2(ledger, requestId);
        await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
        await assertReferenceRequestLedgerEntrySetCurrentV2(ledger);
        // A bounded reference ledger has at most fifty live request records.
        // eslint-disable-next-line no-await-in-loop
        decision = await publishReferenceRequestDecisionV2({
          root: input.root,
          projectId: input.projectId,
          directories: ledger.directories,
          request,
          outcome: { kind: 'expired' },
          decidedAt: observedAt,
          authorizeBeforeLink: async (temporary) => {
            await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
            await assertReferenceRequestLedgerEntrySetCurrentV2(ledger, { decision: temporary });
            await Promise.all([
              assertIdentifiedRecordCurrentV2({
                root: input.root,
                authority: ledger.directories.pending,
                identified: request,
                maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
              }),
              assertIdentifiedRecordCurrentV2({
                root: input.root,
                authority: ledger.directories.slots,
                identified: expiringSlot,
                maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
              }),
              assertPathAbsentV2(path.join(ledger.directories.decisions.path, `${requestId}.json`)),
            ]);
            await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
          },
        });
        ledger = { ...ledger, decisions: new Map(ledger.decisions).set(requestId, decision) };
        await assertReferenceRequestLedgerEntrySetCurrentV2(ledger);
      }
      const receipt =
        decision?.record.outcome.kind === 'generation_gate'
          ? ledger.receipts.get(decision.record.outcome.handoffId)
          : undefined;
      const terminal =
        decision !== undefined && (decision.record.outcome.kind !== 'generation_gate' || receipt !== undefined);
      const slot = ledger.slots.get(requestId)?.[0];
      if (terminal && decision !== undefined && slot !== undefined) {
        // eslint-disable-next-line no-await-in-loop
        await releaseReferenceRequestSlotV2({
          root: input.root,
          ledger,
          request,
          decision,
          receipt,
          slot,
          projectSnapshot: input.snapshot,
        });
        const slots = new Map(ledger.slots);
        slots.delete(requestId);
        ledger = { ...ledger, slots };
      }
    }
    for (const [requestId, held] of ledger.slots) {
      if (ledger.requests.has(requestId) || held.length !== 1) continue;
      const slot = held[0];
      if (Date.parse(slot.record.reservedAt) > orphanSlotCutoff) continue;
      // eslint-disable-next-line no-await-in-loop
      await cleanupOrphanReferenceRequestSlotV2({
        root: input.root,
        snapshot: input.snapshot,
        ledger,
        slot,
      });
      const slots = new Map(ledger.slots);
      slots.delete(requestId);
      ledger = { ...ledger, slots };
    }
    return ledger;
  };

  const listReferenceRequestsV2InsideQueue = async (input: {
    root: string;
    projectId: string;
    snapshot: Extract<ProjectFileInspectionV2, { status: 'supported' }>;
  }): Promise<StudioReferenceRequestLedgerEntryV2[]> => {
    const ledger = await readCleanReferenceRequestLedgerV2InsideQueue({
      ...input,
      createIfWhollyAbsent: false,
    });
    if (ledger === null) {
      await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
      return [];
    }
    const reaped = await reapReferenceRequestLedgerV2InsideQueue({ ...input, ledger });
    const result = [...reaped.requests.values()]
      .map((request) => referenceRequestLedgerEntryV2(reaped, request))
      .toSorted(
        (left, right) =>
          left.request.createdAt.localeCompare(right.request.createdAt) ||
          left.request.id.localeCompare(right.request.id)
      );
    await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
    return result;
  };

  const listReferenceRequestsV2ThroughQueue = (projectId: string): Promise<StudioReferenceRequestLedgerEntryV2[]> =>
    enqueue(projectId, async () => {
      const root = await existingCanonicalRootV2();
      if (root === null) throw new CreativeStudioStoreError('not_found', 'Studio project not found');
      const snapshot = requireSupportedProjectInspectionV2(
        await inspectProjectWithAttributionFenceV2InsideQueue(root, projectId)
      );
      return listReferenceRequestsV2InsideQueue({ root, projectId, snapshot });
    });

  const decideReferenceRequestV2InsideQueue = async (input: {
    root: string;
    decisionInput: StudioDecideReferenceRequestInputV2;
    snapshot: Extract<ProjectFileInspectionV2, { status: 'supported' }>;
  }): Promise<StudioReferenceRequestLedgerEntryV2> => {
    const { projectId, requestId, expectedRevision, outcome: intent } = input.decisionInput;
    let ledger = await readCleanReferenceRequestLedgerV2InsideQueue({
      root: input.root,
      projectId,
      snapshot: input.snapshot,
      createIfWhollyAbsent: false,
    });
    if (ledger === null) throw new CreativeStudioStoreError('not_found', 'Studio reference request not found');
    ledger = await reapReferenceRequestLedgerV2InsideQueue({
      root: input.root,
      projectId,
      snapshot: input.snapshot,
      ledger,
    });
    const request = ledger.requests.get(requestId);
    if (request === undefined) throw new CreativeStudioStoreError('not_found', 'Studio reference request not found');
    const existingDecision = ledger.decisions.get(requestId);
    if (existingDecision !== undefined) {
      if (!sameReferenceDecisionIntentV2(existingDecision.record, intent)) {
        throw new CreativeStudioStoreError('invalid_payload', 'Studio reference request already has another decision');
      }
      const receipt =
        existingDecision.record.outcome.kind === 'generation_gate'
          ? ledger.receipts.get(existingDecision.record.outcome.handoffId)
          : undefined;
      const slot = ledger.slots.get(requestId)?.[0];
      if ((existingDecision.record.outcome.kind !== 'generation_gate' || receipt !== undefined) && slot !== undefined) {
        await releaseReferenceRequestSlotV2({
          root: input.root,
          ledger,
          request,
          decision: existingDecision,
          receipt,
          slot,
          projectSnapshot: input.snapshot,
        });
        const slots = new Map(ledger.slots);
        slots.delete(requestId);
        ledger = { ...ledger, slots };
      }
      await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
      return referenceRequestLedgerEntryV2(ledger, request);
    }
    if (input.snapshot.project.revision !== expectedRevision) {
      throw new CreativeStudioStoreError('stale_project', 'Studio project has changed');
    }
    if (intent.kind !== 'rejected') {
      assertReferenceRequestShotsActiveV2(input.snapshot.project, request.record);
    }
    const slot = assertPendingReferenceRequestSlotV2(ledger, requestId);
    const decidedAt = now();
    if (!isCanonicalIsoTimestamp(decidedAt)) {
      throw new CreativeStudioStoreError('storage_error', 'Studio reference request decision clock is invalid');
    }
    if (Date.parse(decidedAt) < Date.parse(request.record.createdAt)) {
      throw new CreativeStudioStoreError('storage_error', 'Studio reference request decision predates its request');
    }
    let outcome: StudioReferenceRequestDecisionV2['outcome'];
    if (intent.kind === 'rejected') {
      outcome = { kind: 'rejected' };
    } else if (intent.kind === 'imported_reference') {
      if (!isSafeIdV2(intent.assetId) || !isActiveClassifiedBriefImageV2(input.snapshot.project, intent.assetId)) {
        throw new CreativeStudioStoreError('invalid_payload', 'Studio reference asset is not an active Brief image');
      }
      outcome = {
        kind: 'imported_reference',
        assetId: intent.assetId,
        projectRevision: input.snapshot.project.revision,
      };
    } else {
      let handoffId: string;
      try {
        handoffId = createId();
      } catch (error) {
        throw storageError(error, 'Studio reference handoff identity could not be generated');
      }
      if (
        !isSafeIdV2(handoffId) ||
        ledger.generationDecisions.has(handoffId) ||
        ledger.receipts.has(handoffId) ||
        referenceAuthorizationByHandoffV2(input.snapshot.project).has(handoffId)
      ) {
        throw new CreativeStudioStoreError('storage_error', 'Studio reference handoff identity collides');
      }
      outcome = { kind: 'generation_gate', handoffId, shotIds: [...request.record.shotIds] };
    }
    await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
    await assertReferenceRequestLedgerEntrySetCurrentV2(ledger);
    await Promise.all([
      assertIdentifiedRecordCurrentV2({
        root: input.root,
        authority: ledger.directories.pending,
        identified: request,
        maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
      }),
      assertIdentifiedRecordCurrentV2({
        root: input.root,
        authority: ledger.directories.slots,
        identified: slot,
        maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
      }),
      assertPathAbsentV2(path.join(ledger.directories.decisions.path, `${requestId}.json`)),
    ]);
    const decision = await publishReferenceRequestDecisionV2({
      root: input.root,
      projectId,
      directories: ledger.directories,
      request,
      outcome,
      decidedAt,
      authorizeBeforeLink: async (temporary) => {
        await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
        await assertReferenceRequestLedgerEntrySetCurrentV2(ledger, { decision: temporary });
        await Promise.all([
          assertIdentifiedRecordCurrentV2({
            root: input.root,
            authority: ledger.directories.pending,
            identified: request,
            maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
          }),
          assertIdentifiedRecordCurrentV2({
            root: input.root,
            authority: ledger.directories.slots,
            identified: slot,
            maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
          }),
          assertPathAbsentV2(path.join(ledger.directories.decisions.path, `${requestId}.json`)),
        ]);
        await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
      },
    });
    const decisions = new Map(ledger.decisions).set(requestId, decision);
    const generationDecisions = new Map(ledger.generationDecisions);
    if (decision.record.outcome.kind === 'generation_gate') {
      generationDecisions.set(decision.record.outcome.handoffId, decision);
    }
    ledger = { ...ledger, decisions, generationDecisions };
    await assertReferenceRequestLedgerEntrySetCurrentV2(ledger);
    if (decision.record.outcome.kind !== 'generation_gate') {
      await releaseReferenceRequestSlotV2({
        root: input.root,
        ledger,
        request,
        decision,
        slot,
        projectSnapshot: input.snapshot,
      });
      const slots = new Map(ledger.slots);
      slots.delete(requestId);
      ledger = { ...ledger, slots };
    }
    await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
    return referenceRequestLedgerEntryV2(ledger, request);
  };

  const referenceGenerationHandoffV2 = (
    ledger: ReferenceRequestLedgerV2,
    handoffId: string
  ): StudioReferenceGenerationHandoffStoreV2 | null => {
    const decision = ledger.generationDecisions.get(handoffId)?.record;
    if (decision === undefined || !isReferenceGenerationDecisionV2(decision)) return null;
    const request = ledger.requests.get(decision.requestId)?.record;
    if (request === undefined) {
      throw new CreativeStudioStoreError('storage_error', 'Studio reference handoff request is missing');
    }
    return {
      request,
      decision,
      receipt: ledger.receipts.get(handoffId)?.record ?? null,
    };
  };

  const recordReferenceGenerationHandoffReceiptV2InsideQueue = async (input: {
    root: string;
    receiptInput: StudioRecordReferenceGenerationHandoffReceiptInputV2;
    snapshot: Extract<ProjectFileInspectionV2, { status: 'supported' }>;
  }): Promise<StudioReferenceGenerationHandoffStoreV2> => {
    const { projectId, handoffId, expectedRevision, result } = input.receiptInput;
    let ledger = await readCleanReferenceRequestLedgerV2InsideQueue({
      root: input.root,
      projectId,
      snapshot: input.snapshot,
      createIfWhollyAbsent: false,
    });
    if (ledger === null) throw new CreativeStudioStoreError('not_found', 'Studio reference handoff not found');
    const decision = ledger.generationDecisions.get(handoffId);
    if (decision === undefined || !isReferenceGenerationDecisionV2(decision.record)) {
      throw new CreativeStudioStoreError('not_found', 'Studio reference handoff not found');
    }
    const request = ledger.requests.get(decision.record.requestId);
    if (request === undefined) {
      throw new CreativeStudioStoreError('storage_error', 'Studio reference handoff request is missing');
    }
    const existingReceipt = ledger.receipts.get(handoffId);
    if (existingReceipt !== undefined) {
      const sameResult =
        existingReceipt.record.result.kind === result.kind &&
        (result.kind !== 'confirmed' ||
          (existingReceipt.record.result.kind === 'confirmed' &&
            existingReceipt.record.result.authorizationId === result.authorizationId));
      if (!sameResult) {
        throw new CreativeStudioStoreError('invalid_payload', 'Studio reference handoff already has another receipt');
      }
      const slot = ledger.slots.get(request.record.id)?.[0];
      if (slot !== undefined) {
        await releaseReferenceRequestSlotV2({
          root: input.root,
          ledger,
          request,
          decision,
          receipt: existingReceipt,
          slot,
          projectSnapshot: input.snapshot,
        });
        const slots = new Map(ledger.slots);
        slots.delete(request.record.id);
        ledger = { ...ledger, slots };
      }
      await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
      return referenceGenerationHandoffV2(ledger, handoffId)!;
    }
    if (input.snapshot.project.revision !== expectedRevision) {
      throw new CreativeStudioStoreError('stale_project', 'Studio project has changed');
    }
    const authorizations = referenceAuthorizationByHandoffV2(input.snapshot.project);
    const authorization = authorizations.get(handoffId);
    let completedAt: string;
    if (result.kind === 'dismissed') {
      if (authorization !== undefined) {
        throw new CreativeStudioStoreError('storage_error', 'Authorized Studio reference handoff cannot be dismissed');
      }
      completedAt = now();
      if (!isCanonicalIsoTimestamp(completedAt)) {
        throw new CreativeStudioStoreError('storage_error', 'Studio reference handoff receipt clock is invalid');
      }
      if (Date.parse(completedAt) < Date.parse(decision.record.decidedAt)) {
        throw new CreativeStudioStoreError('storage_error', 'Studio reference handoff receipt predates its decision');
      }
    } else {
      if (authorization === undefined || authorization.id !== result.authorizationId) {
        throw new CreativeStudioStoreError('storage_error', 'Studio reference handoff has no exact authorization');
      }
      completedAt = authorization.confirmedAt;
    }
    const slot = assertPendingReferenceRequestSlotV2(ledger, request.record.id);
    await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
    await assertReferenceRequestLedgerEntrySetCurrentV2(ledger);
    await Promise.all([
      assertIdentifiedRecordCurrentV2({
        root: input.root,
        authority: ledger.directories.pending,
        identified: request,
        maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
      }),
      assertIdentifiedRecordCurrentV2({
        root: input.root,
        authority: ledger.directories.decisions,
        identified: decision,
        maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
      }),
      assertIdentifiedRecordCurrentV2({
        root: input.root,
        authority: ledger.directories.slots,
        identified: slot,
        maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
      }),
      assertPathAbsentV2(path.join(ledger.directories.receipts.path, `${handoffId}.json`)),
    ]);
    const receipt = await publishReferenceGenerationHandoffReceiptV2({
      root: input.root,
      directories: ledger.directories,
      receipt: {
        schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
        handoffId,
        requestId: request.record.id,
        completedAt,
        result: structuredClone(result),
      },
      authorizeBeforeLink: async (temporary) => {
        await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
        await assertReferenceRequestLedgerEntrySetCurrentV2(ledger, { receipt: temporary });
        await Promise.all([
          assertIdentifiedRecordCurrentV2({
            root: input.root,
            authority: ledger.directories.pending,
            identified: request,
            maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
          }),
          assertIdentifiedRecordCurrentV2({
            root: input.root,
            authority: ledger.directories.decisions,
            identified: decision,
            maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
          }),
          assertIdentifiedRecordCurrentV2({
            root: input.root,
            authority: ledger.directories.slots,
            identified: slot,
            maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
          }),
          assertPathAbsentV2(path.join(ledger.directories.receipts.path, `${handoffId}.json`)),
        ]);
        await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
      },
    });
    ledger = { ...ledger, receipts: new Map(ledger.receipts).set(handoffId, receipt) };
    await assertReferenceRequestLedgerEntrySetCurrentV2(ledger);
    await releaseReferenceRequestSlotV2({
      root: input.root,
      ledger,
      request,
      decision,
      receipt,
      slot,
      projectSnapshot: input.snapshot,
    });
    const slots = new Map(ledger.slots);
    slots.delete(request.record.id);
    ledger = { ...ledger, slots };
    await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
    return referenceGenerationHandoffV2(ledger, handoffId)!;
  };

  const proposalOperationsV2 = (
    proposal: StudioProposalRecordV2,
    project: StudioProjectV2
  ): StudioMutationOperationV2[] => {
    if (proposal.payload.kind === 'mutation_batch') {
      if (proposal.payload.operations.some((operation) => operation.kind === 'undo_last')) {
        throw new CreativeStudioStoreError('invalid_payload', 'Undo is not a reviewable Studio proposal mutation');
      }
      return structuredClone(proposal.payload.operations);
    }
    let ruleId: string;
    try {
      ruleId = createId();
    } catch (error) {
      throw storageError(error, 'Studio rule identity could not be generated');
    }
    if (!isSafeIdV2(ruleId) || project.rules.some((rule) => rule.id === ruleId)) {
      throw new CreativeStudioStoreError('invalid_payload', 'Studio rule identity is invalid or already exists');
    }
    return [
      {
        kind: 'set_rules',
        rules: [
          ...project.rules.map((rule) => ({
            id: rule.id,
            text: rule.text,
            predicate:
              rule.predicate === null ? null : { kind: 'forbidden_terms' as const, terms: [...rule.predicate.terms] },
          })),
          {
            id: ruleId,
            text: proposal.payload.rule.text,
            predicate:
              proposal.payload.rule.predicate === null
                ? null
                : { kind: 'forbidden_terms' as const, terms: [...proposal.payload.rule.predicate.terms] },
          },
        ],
      },
    ];
  };

  const publishProposalAttributionV2 = async (input: {
    root: string;
    projectId: string;
    directories: ProposalDirectoriesV2;
    attribution: StudioProposalCommitAttributionV2;
    authorizeBeforeLink: (temporary: IdentifiedRecordV2<null>) => Promise<void>;
  }): Promise<IdentifiedRecordV2<StudioProposalCommitAttributionV2>> => {
    const file = path.join(input.directories.commits.path, `${input.attribution.proposalId}.json`);
    await assertProposalDirectoryAuthoritiesV2(input.directories);
    await assertPathAbsentV2(file);
    await publishImmutableJournalRecordV2({
      root: input.root,
      authority: input.directories.commits,
      file,
      bytes: serializeJsonExact(input.attribution),
      retainTemporary: true,
      authorizeBeforeLink: input.authorizeBeforeLink,
    });
    await assertProposalDirectoryAuthoritiesV2(input.directories);
    const published = await parseIdentifiedJsonV2({
      root: input.root,
      file,
      parse: (value) => parseAttributionRecordV2(input.projectId, input.attribution.proposalId, value),
    });
    if (published.bytes !== serializeJsonExact(input.attribution)) {
      throw new CreativeStudioStoreError('storage_error', 'Studio proposal commit attribution changed at publication');
    }
    return published;
  };

  const acceptProposalV2InsideQueue = async (input: {
    root: string;
    projectId: string;
    proposalId: string;
    snapshot: Extract<ProjectFileInspectionV2, { status: 'supported' }>;
  }): Promise<StudioProposalAcceptanceResultV2> => {
    let ledger = await readCleanProposalLedgerV2InsideQueue({ ...input, createIfWhollyAbsent: false });
    if (ledger === null) throw new CreativeStudioStoreError('not_found', 'Studio proposal not found');
    ledger = await reapProposalLedgerV2InsideQueue({ ...input, ledger });
    const proposal = ledger.proposals.get(input.proposalId);
    if (proposal === undefined) throw new CreativeStudioStoreError('not_found', 'Studio proposal not found');
    const existingDecision = ledger.decisions.get(input.proposalId);
    if (existingDecision !== undefined) {
      if (existingDecision.record.status !== 'accepted') {
        throw new CreativeStudioStoreError('invalid_payload', 'Studio proposal is no longer pending');
      }
      await releaseProposalSlotV2({
        root: input.root,
        ledger,
        proposal,
        decision: existingDecision,
        slot: ledger.slots.get(input.proposalId)?.[0],
        projectSnapshot: input.snapshot,
      });
      await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
      return {
        proposal: effectiveProposalV2(proposal.record, existingDecision.record),
        project: input.snapshot.project,
        applied: false,
      };
    }
    const slot = assertPendingProposalSlotV2(ledger, input.proposalId);
    if (input.snapshot.project.revision !== proposal.record.baseRevision) {
      throw new CreativeStudioStoreError('stale_project', 'Studio project has changed');
    }
    const decidedAt = now();
    if (!isCanonicalIsoTimestamp(decidedAt)) {
      throw new CreativeStudioStoreError('storage_error', 'Studio proposal decision clock is invalid');
    }
    if (Date.parse(decidedAt) < Date.parse(proposal.record.createdAt)) {
      throw new CreativeStudioStoreError('storage_error', 'Studio proposal decision predates its proposal');
    }
    const operations = proposalOperationsV2(proposal.record, input.snapshot.project);
    const applied = applyStudioMutationBatchV2(
      input.snapshot.project,
      {
        schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
        projectId: input.projectId,
        expectedRevision: proposal.record.baseRevision,
        operations,
      },
      { mutationId: proposal.record.id, capturedAt: decidedAt }
    );
    const candidate: StudioProjectV2 = {
      ...applied.project,
      schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
      revision: proposal.record.baseRevision + 1,
      updatedAt: decidedAt,
    };
    if (!validateStudioProjectV2(candidate)) {
      throw new CreativeStudioStoreError('invalid_payload', 'Invalid schema-2 Studio proposal result');
    }
    const candidateBytes = serializeJsonExact(candidate);
    if (Buffer.byteLength(candidateBytes, 'utf8') > STUDIO_PROJECT_V2_MAX_RECORD_BYTES) {
      throw new CreativeStudioStoreError('invalid_payload', 'Schema-2 Studio proposal result is too large');
    }
    const attribution: StudioProposalCommitAttributionV2 = {
      schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
      proposalId: proposal.record.id,
      projectId: input.projectId,
      baseRevision: proposal.record.baseRevision,
      appliedRevision: candidate.revision,
      beforeProjectSha256: sha256Utf8(input.snapshot.bytes),
      afterProjectSha256: sha256Utf8(candidateBytes),
      createdBeatIds: [...applied.createdBeatIds],
      createdShotIds: [...applied.createdShotIds],
      decidedAt,
    };
    if (!validateProposalCommitAttributionV2(input.projectId, proposal.record.id, attribution)) {
      throw new CreativeStudioStoreError('storage_error', 'Invalid Studio proposal commit attribution');
    }
    assertAttributionCreatedIdsV2({
      attribution,
      proposal: proposal.record,
      project: input.snapshot.project,
      state: 'before',
    });
    await assertProposalLedgerEntrySetCurrentV2(ledger);
    await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
    await Promise.all([
      assertProposalDirectoryAuthoritiesV2(ledger.directories),
      assertIdentifiedRecordCurrentV2({
        root: input.root,
        authority: ledger.directories.pending,
        identified: proposal,
      }),
      assertIdentifiedRecordCurrentV2({ root: input.root, authority: ledger.directories.slots, identified: slot }),
      assertPathAbsentV2(path.join(ledger.directories.decisions.path, `${proposal.record.id}.json`)),
    ]);
    const identifiedAttribution = await publishProposalAttributionV2({
      root: input.root,
      projectId: input.projectId,
      directories: ledger.directories,
      attribution,
      authorizeBeforeLink: async (temporary) => {
        await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
        await assertProposalLedgerEntrySetCurrentV2(ledger, { attribution: temporary });
        await Promise.all([
          assertIdentifiedRecordCurrentV2({
            root: input.root,
            authority: ledger.directories.pending,
            identified: proposal,
          }),
          assertIdentifiedRecordCurrentV2({
            root: input.root,
            authority: ledger.directories.slots,
            identified: slot,
          }),
          assertPathAbsentV2(path.join(ledger.directories.commits.path, `${proposal.record.id}.json`)),
          assertPathAbsentV2(path.join(ledger.directories.decisions.path, `${proposal.record.id}.json`)),
        ]);
        await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
      },
    });
    const durableAttribution = identifiedAttribution.record;
    const attributedLedger: ProposalLedgerV2 = { ...ledger, attributions: [identifiedAttribution] };
    await assertProposalLedgerEntrySetCurrentV2(attributedLedger);
    await Promise.all([
      assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot }),
      assertIdentifiedRecordCurrentV2({
        root: input.root,
        authority: ledger.directories.commits,
        identified: identifiedAttribution,
      }),
      assertIdentifiedRecordCurrentV2({
        root: input.root,
        authority: ledger.directories.pending,
        identified: proposal,
      }),
      assertIdentifiedRecordCurrentV2({ root: input.root, authority: ledger.directories.slots, identified: slot }),
      assertPathAbsentV2(path.join(ledger.directories.decisions.path, `${proposal.record.id}.json`)),
    ]);
    const projectFilePath = resolveRootChild(input.snapshot.directory.path, 'project.json');
    await writeBytesAtomic(input.root, projectFilePath, candidateBytes, async () => {
      await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
      await assertProposalLedgerEntrySetCurrentV2(attributedLedger);
      await assertProposalDirectoryAuthoritiesV2(ledger.directories);
      await Promise.all([
        assertIdentifiedRecordCurrentV2({
          root: input.root,
          authority: ledger.directories.commits,
          identified: identifiedAttribution,
        }),
        assertIdentifiedRecordCurrentV2({
          root: input.root,
          authority: ledger.directories.pending,
          identified: proposal,
        }),
        assertIdentifiedRecordCurrentV2({ root: input.root, authority: ledger.directories.slots, identified: slot }),
        assertPathAbsentV2(path.join(ledger.directories.decisions.path, `${proposal.record.id}.json`)),
      ]);
      await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
    });
    const committed = requireSupportedProjectInspectionV2(await inspectProjectFileV2(input.root, input.projectId));
    if (
      committed.bytes !== candidateBytes ||
      sha256Utf8(committed.bytes) !== durableAttribution.afterProjectSha256 ||
      !sameIdentityV2(committed.directory, input.snapshot.directory)
    ) {
      throw new CreativeStudioStoreError('storage_error', 'Studio proposal project publication changed');
    }
    await assertProposalLedgerEntrySetCurrentV2(attributedLedger);
    await Promise.all([
      assertIdentifiedRecordCurrentV2({
        root: input.root,
        authority: ledger.directories.commits,
        identified: identifiedAttribution,
      }),
      assertIdentifiedRecordCurrentV2({
        root: input.root,
        authority: ledger.directories.pending,
        identified: proposal,
      }),
      assertIdentifiedRecordCurrentV2({ root: input.root, authority: ledger.directories.slots, identified: slot }),
      assertPathAbsentV2(path.join(ledger.directories.decisions.path, `${proposal.record.id}.json`)),
    ]);
    const decision = await publishProposalDecisionV2({
      root: input.root,
      projectId: input.projectId,
      directories: ledger.directories,
      proposal,
      status: 'accepted',
      decidedAt: durableAttribution.decidedAt,
      authorizeBeforeLink: async (temporary) => {
        await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: committed });
        await assertProposalLedgerEntrySetCurrentV2(attributedLedger, { decision: temporary });
        await Promise.all([
          assertIdentifiedRecordCurrentV2({
            root: input.root,
            authority: ledger.directories.commits,
            identified: identifiedAttribution,
          }),
          assertIdentifiedRecordCurrentV2({
            root: input.root,
            authority: ledger.directories.pending,
            identified: proposal,
          }),
          assertIdentifiedRecordCurrentV2({
            root: input.root,
            authority: ledger.directories.slots,
            identified: slot,
          }),
          assertPathAbsentV2(path.join(ledger.directories.decisions.path, `${proposal.record.id}.json`)),
        ]);
        await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: committed });
      },
    });
    const decidedLedger: ProposalLedgerV2 = {
      ...attributedLedger,
      decisions: new Map(attributedLedger.decisions).set(input.proposalId, decision),
    };
    await assertProposalLedgerEntrySetCurrentV2(decidedLedger);
    const authorizeAttributionCleanup = async (): Promise<void> => {
      await assertProposalDirectoryAuthoritiesV2(ledger.directories);
      await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: committed });
      await Promise.all([
        assertIdentifiedRecordCurrentV2({
          root: input.root,
          authority: ledger.directories.pending,
          identified: proposal,
        }),
        assertIdentifiedRecordCurrentV2({
          root: input.root,
          authority: ledger.directories.decisions,
          identified: decision,
        }),
        assertIdentifiedRecordCurrentV2({ root: input.root, authority: ledger.directories.slots, identified: slot }),
      ]);
      await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: committed });
    };
    await removeJournalPublicationCompanionV2({
      root: input.root,
      authority: ledger.directories.commits,
      named: identifiedAttribution,
      maxBytes: STUDIO_PROPOSAL_MAX_RECORD_BYTES,
      authorize: authorizeAttributionCleanup,
    });
    await quarantineRemoveIdentifiedRecordV2({
      root: input.root,
      authority: ledger.directories.commits,
      identified: identifiedAttribution,
      authorize: authorizeAttributionCleanup,
    });
    await releaseProposalSlotV2({
      root: input.root,
      ledger: { ...decidedLedger, attributions: [] },
      proposal,
      decision,
      slot,
      projectSnapshot: committed,
    });
    observeProjectCommit(
      Object.freeze({
        projectId: input.projectId,
        previousRevision: proposal.record.baseRevision,
        committedRevision: candidate.revision,
        committedAt: decidedAt,
        commitTag: `proposal:${proposal.record.id}`,
      })
    );
    return { proposal: effectiveProposalV2(proposal.record, decision.record), project: candidate, applied: true };
  };

  const scanProjectsV2 = async (root: string): Promise<ProjectListingSweepV2> => {
    let entries: import('node:fs').Dirent[];
    try {
      entries = await fs.readdir(root, { withFileTypes: true });
    } catch (error) {
      throw storageError(error, 'Studio project inventory could not be inspected');
    }
    const unsafeProjectEntry = entries.find((entry) => isSafeIdV2(entry.name) && entry.isSymbolicLink());
    if (unsafeProjectEntry !== undefined) {
      throw new CreativeStudioStoreError('storage_error', 'Creative Studio project directory is unsafe');
    }
    const projectEntries = entries
      .filter((entry) => entry.isDirectory() && isSafeIdV2(entry.name))
      .toSorted((left, right) => left.name.localeCompare(right.name));
    const supportedProjectIds: string[] = [];
    const summaries: StudioProjectSummaryV2[] = [];
    const unsupportedProjectIds: string[] = [];
    const quarantinedProjectIds: string[] = [];
    for (const entry of projectEntries) {
      const projectId = entry.name;
      let inspected: ProjectFileInspectionV2;
      try {
        // A schema-2 record may be large, so inventory reads stay sequential and bounded.
        // eslint-disable-next-line no-await-in-loop
        inspected = await inspectProjectThroughAttributionFenceV2(root, projectId);
      } catch (error) {
        quarantinedProjectIds.push(projectId);
        safeLogError(`[CreativeStudio] Quarantined corrupt schema-2 project manifest: ${projectId}`, error);
        continue;
      }
      if (inspected.status === 'supported') {
        supportedProjectIds.push(inspected.project.id);
        summaries.push(toStudioProjectSummaryV2(inspected.project));
      } else if (inspected.status === 'unsupported_prototype_schema') unsupportedProjectIds.push(projectId);
      else if (inspected.status === 'malformed_v2') {
        quarantinedProjectIds.push(projectId);
        safeLogError(`[CreativeStudio] Quarantined corrupt schema-2 project manifest: ${projectId}`, inspected.error);
      }
    }
    return { supportedProjectIds, summaries, unsupportedProjectIds, quarantinedProjectIds };
  };

  const readAllProjects = async (
    root: string
  ): Promise<{ projects: StudioProject[]; quarantinedProjectIds: string[] }> => {
    let entries: import('node:fs').Dirent[];
    try {
      entries = await fs.readdir(root, { withFileTypes: true });
    } catch (error) {
      if (isRecord(error) && error.code === 'ENOENT') return { projects: [], quarantinedProjectIds: [] };
      throw new CreativeStudioStoreError(
        'storage_error',
        error instanceof Error ? error.message : 'Studio storage read failed'
      );
    }
    const unsafeProjectEntry = entries.find((entry) => isSafeId(entry.name) && entry.isSymbolicLink());
    if (unsafeProjectEntry !== undefined) {
      throw new CreativeStudioStoreError('storage_error', 'Creative Studio project directory is unsafe');
    }
    const projectEntries = entries
      .filter((entry) => entry.isDirectory() && isSafeId(entry.name))
      .toSorted((left, right) => left.name.localeCompare(right.name));
    const settledProjects = await Promise.allSettled(projectEntries.map((entry) => readProject(root, entry.name)));
    const projects: StudioProject[] = [];
    const quarantinedProjectIds: string[] = [];
    settledProjects.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        if (result.value !== null) projects.push(result.value);
        return;
      }
      const projectId = projectEntries[index].name;
      quarantinedProjectIds.push(projectId);
      logError(`[CreativeStudio] Quarantined corrupt project manifest: ${projectId}`, result.reason);
    });
    return { projects, quarantinedProjectIds };
  };

  const repairSummaryIndex = (): Promise<ProjectListingSweep> => {
    const rebuild = async (): Promise<ProjectListingSweep> => {
      const root = await canonicalRoot();
      const indexFile = await summariesFile(root);
      const { projects, quarantinedProjectIds } = await readAllProjects(root);
      const summaries = projects.map(toSummary).toSorted(compareSummaries);
      let existing: unknown = null;
      try {
        existing = JSON.parse(await fs.readFile(indexFile, 'utf8')) as unknown;
      } catch {
        // A missing or malformed summary is repaired from the per-project source of truth below.
      }
      const next = { schemaVersion: 1, projects: summaries };
      if (!sameJson(existing, next)) await writeJsonAtomic(root, indexFile, next);
      return { projects: summaries, quarantinedProjectIds };
    };
    const next = summaryQueue.catch((): undefined => undefined).then(() => rebuild());
    summaryQueue = next.catch((): undefined => undefined);
    return next;
  };

  const repairSummaryAfterCommit = async (): Promise<void> => {
    try {
      await repairSummaryIndex();
    } catch (error) {
      safeLogError('[CreativeStudio] Project summary repair failed after commit', error);
      void repairSummaryIndex().catch((retryError: unknown): void => {
        safeLogError('[CreativeStudio] Project summary repair retry failed', retryError);
      });
    }
  };

  const toProjectListResultV2 = (sweep: ProjectListingSweepV2): StudioProjectListResultV2 => ({
    projects: sweep.summaries.toSorted(compareSummariesV2),
    unsupportedProjectIds: [...sweep.unsupportedProjectIds].toSorted((left, right) => left.localeCompare(right)),
    quarantinedProjectIds: [...sweep.quarantinedProjectIds].toSorted((left, right) => left.localeCompare(right)),
  });

  const repairSummaryIndexV2 = (): Promise<StudioProjectListResultV2> => {
    const rebuild = async (): Promise<StudioProjectListResultV2> => {
      const root = await existingCanonicalRootV2();
      if (root === null) return { projects: [], unsupportedProjectIds: [], quarantinedProjectIds: [] };
      const indexFile = await summariesFileV2(root);
      const sweep = await scanProjectsV2(root);
      const result = toProjectListResultV2(sweep);
      let existing: unknown = null;
      let indexExists = true;
      try {
        const record = await readBoundedStudioV2File(root, indexFile);
        indexExists = record !== null;
        if (record?.status === 'bytes') existing = JSON.parse(record.bytes) as unknown;
      } catch {
        // A malformed or oversized schema-2 summary index is rebuilt from project manifests below.
      }
      const ownsIndex = indexExists || sweep.supportedProjectIds.length > 0 || sweep.quarantinedProjectIds.length > 0;
      if (ownsIndex) {
        const next = { schemaVersion: 2, projects: result.projects };
        if (!sameJson(existing, next)) await writeJsonAtomic(root, indexFile, next);
      }
      return result;
    };
    const next = summaryV2Queue.catch((): undefined => undefined).then(() => rebuild());
    summaryV2Queue = next.catch((): undefined => undefined);
    return next;
  };

  const repairSummaryV2AfterCommit = async (): Promise<void> => {
    try {
      await repairSummaryIndexV2();
    } catch (error) {
      safeLogError('[CreativeStudio] Schema-2 project summary repair failed after commit', error);
      await repairSummaryIndexV2().catch((retryError: unknown): void => {
        safeLogError('[CreativeStudio] Schema-2 project summary repair retry failed', retryError);
      });
    }
  };

  const updateProjectInsideQueue = async (
    root: string,
    projectId: string,
    update: (project: StudioProject) => StudioProject,
    expectedRevision: number | undefined,
    commitTag: string | null
  ): Promise<StudioProject> => {
    await summariesFile(root);
    const current = await readProject(root, projectId);
    if (current === null) throw new CreativeStudioStoreError('not_found', 'Studio project not found');
    if (expectedRevision !== undefined && expectedRevision !== current.revision) {
      throw new CreativeStudioStoreError('stale_project', 'Studio project has changed');
    }
    const updated = update(structuredClone(current));
    if (!isRecord(updated) || updated.id !== current.id || updated.createdAt !== current.createdAt) {
      throw new CreativeStudioStoreError('invalid_payload', 'Studio project identity cannot change');
    }
    if (
      Array.isArray(updated.sceneOrder) &&
      !isStudioSceneCountTransitionAllowed(current.sceneOrder.length, updated.sceneOrder.length)
    ) {
      throw new CreativeStudioStoreError('invalid_payload', 'Studio scene limit exceeded');
    }
    const next: StudioProject = {
      ...updated,
      schemaVersion: 1,
      revision: current.revision + 1,
      updatedAt: now(),
    };
    if (!validateProject(next)) {
      throw new CreativeStudioStoreError('invalid_payload', 'Invalid Studio project payload');
    }
    const file = await projectFile(root, projectId, false);
    if (file === null) {
      throw new CreativeStudioStoreError('storage_error', 'Creative Studio project storage is unavailable');
    }
    await writeJsonAtomic(root, file, next);
    observeProjectCommit(
      Object.freeze({
        projectId,
        previousRevision: current.revision,
        committedRevision: next.revision,
        committedAt: next.updatedAt,
        commitTag,
      })
    );
    await repairSummaryAfterCommit();
    return next;
  };

  const updateProjectV2InsideQueue = async (
    root: string,
    inspected: Extract<ProjectFileInspectionV2, { status: 'supported' }>,
    update: (project: StudioProjectV2) => StudioProjectV2,
    expectedRevision: number | undefined,
    commitTag: string | null
  ): Promise<StudioProjectV2> => {
    const current = inspected.project;
    if (expectedRevision !== undefined && expectedRevision !== current.revision) {
      throw new CreativeStudioStoreError('stale_project', 'Studio project has changed');
    }
    await summariesFileV2(root);
    const updated = update(structuredClone(current));
    if (!isRecord(updated) || updated.id !== current.id || updated.createdAt !== current.createdAt) {
      throw new CreativeStudioStoreError('invalid_payload', 'Studio project identity cannot change');
    }
    const next: StudioProjectV2 = {
      ...updated,
      schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
      revision: current.revision + 1,
      updatedAt: now(),
    };
    if (!validateStudioProjectV2(next)) {
      throw new CreativeStudioStoreError('invalid_payload', 'Invalid schema-2 Studio project payload');
    }
    const file = resolveRootChild(inspected.directory.path, 'project.json');
    const bytes = serializeProjectV2ForWrite(next, 'Schema-2 Studio project');
    await writeBytesAtomic(root, file, bytes, () => assertProjectSnapshotCurrentV2({ root, snapshot: inspected }));
    observeProjectCommit(
      Object.freeze({
        projectId: current.id,
        previousRevision: current.revision,
        committedRevision: next.revision,
        committedAt: next.updatedAt,
        commitTag,
      })
    );
    return next;
  };

  const confirmProjectV2InsideQueue = async <TRevalidation, TDispatch>(
    root: string,
    inspected: Extract<ProjectFileInspectionV2, { status: 'supported' }>,
    input: StudioProjectConfirmationInputV2<TRevalidation, TDispatch>
  ): Promise<StudioProjectConfirmationResultV2<TDispatch>> => {
    const current = inspected.project;
    if (current.revision !== input.expectedRevision) {
      throw new CreativeStudioStoreError('stale_project', 'Studio project has changed');
    }

    await summariesFileV2(root);
    const file = resolveRootChild(inspected.directory.path, 'project.json');

    const snapshot = cloneAndFreezeConfirmationValue(current, 'Studio confirmation project snapshot');
    const rawRevalidation = await input.revalidate(snapshot);
    const revalidation = cloneAndFreezeConfirmationValue(rawRevalidation, 'Studio confirmation revalidation');

    const activeAfterRevalidation = (input.assertActive as () => unknown)();
    assertSynchronousConfirmationResult(activeAfterRevalidation, 'Studio confirmation active-session check');

    const confirmedAt = now();
    if (!isCanonicalIsoTimestamp(confirmedAt)) {
      throw new CreativeStudioStoreError('storage_error', 'Studio confirmation clock is invalid');
    }
    if (Date.parse(confirmedAt) >= Date.parse(input.expiresAt)) {
      throw new StudioProjectConfirmationError('Studio confirmation has expired');
    }

    const mutableProject = cloneConfirmationValue(current, 'Studio confirmation commit project');
    const rawCommit = input.buildCommit(mutableProject, revalidation, confirmedAt) as unknown;
    assertSynchronousConfirmationResult(rawCommit, 'Studio confirmation commit builder');
    if (!isRecord(rawCommit)) {
      throw new CreativeStudioStoreError('invalid_payload', 'Invalid Studio confirmation commit');
    }
    const projectDescriptor = Reflect.getOwnPropertyDescriptor(rawCommit, 'project');
    const dispatchDescriptor = Reflect.getOwnPropertyDescriptor(rawCommit, 'dispatch');
    if (
      projectDescriptor === undefined ||
      !Object.hasOwn(projectDescriptor, 'value') ||
      dispatchDescriptor === undefined ||
      !Object.hasOwn(dispatchDescriptor, 'value')
    ) {
      throw new CreativeStudioStoreError('invalid_payload', 'Invalid Studio confirmation commit');
    }
    const builtProject = projectDescriptor.value as unknown;
    if (!isRecord(builtProject) || builtProject.id !== current.id || builtProject.createdAt !== current.createdAt) {
      throw new CreativeStudioStoreError('invalid_payload', 'Studio project identity cannot change');
    }
    const candidate: StudioProjectV2 = {
      ...(builtProject as StudioProjectV2),
      schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
      revision: current.revision + 1,
      updatedAt: confirmedAt,
    };
    if (!validateStudioProjectV2(candidate)) {
      throw new CreativeStudioStoreError('invalid_payload', 'Invalid schema-2 Studio project payload');
    }
    const next = cloneConfirmationValue(candidate, 'Studio confirmation committed project');
    if (!validateStudioProjectV2(next)) {
      throw new CreativeStudioStoreError('invalid_payload', 'Invalid schema-2 Studio project payload');
    }
    const dispatch = cloneAndFreezeConfirmationValue(
      dispatchDescriptor.value as TDispatch,
      'Studio confirmation dispatch'
    );

    const activeBeforePersistence = (input.assertActive as () => unknown)();
    assertSynchronousConfirmationResult(activeBeforePersistence, 'Studio confirmation active-session check');
    const bytes = serializeProjectV2ForWrite(next, 'Schema-2 Studio confirmation project');
    await writeBytesAtomic(root, file, bytes, () => assertProjectSnapshotCurrentV2({ root, snapshot: inspected }));
    observeProjectCommit(
      Object.freeze({
        projectId: current.id,
        previousRevision: current.revision,
        committedRevision: next.revision,
        committedAt: next.updatedAt,
        commitTag: input.commitTag ?? null,
      })
    );
    return { project: next, dispatch };
  };

  const listProposalsThroughQueue = (projectId: string): Promise<StudioProposal[]> =>
    enqueue(projectId, async (): Promise<StudioProposal[]> => {
      const root = await canonicalRoot();
      const project = await readProject(root, projectId);
      if (project === null) throw new CreativeStudioStoreError('not_found', 'Studio project not found');
      const directories = await proposalDirectories(root, projectId, false);
      return directories === null ? [] : listProjectProposals(root, projectId, directories);
    });

  const listReferenceRequestsThroughQueue = (projectId: string): Promise<StudioReferenceRequest[]> =>
    enqueue(projectId, async (): Promise<StudioReferenceRequest[]> => {
      const root = await canonicalRoot();
      const project = await readProject(root, projectId);
      if (project === null) throw new CreativeStudioStoreError('not_found', 'Studio project not found');
      const directories = await referenceRequestDirectories(root, projectId, false);
      if (directories === null) return [];
      return (await readReferenceRequestRecords(project, directories)).toSorted(
        (left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)
      );
    });

  return {
    async inspectProjectsV2(): Promise<StudioProjectInventoryV2> {
      const root = await existingCanonicalRootV2();
      if (root === null) {
        return { supportedProjectIds: [], unsupportedProjectIds: [], quarantinedProjectIds: [] };
      }
      const sweep = await scanProjectsV2(root);
      return {
        supportedProjectIds: [...sweep.supportedProjectIds].toSorted((left, right) => left.localeCompare(right)),
        unsupportedProjectIds: [...sweep.unsupportedProjectIds].toSorted((left, right) => left.localeCompare(right)),
        quarantinedProjectIds: [...sweep.quarantinedProjectIds].toSorted((left, right) => left.localeCompare(right)),
      };
    },

    async listProjectsV2(): Promise<StudioProjectListResultV2> {
      return repairSummaryIndexV2();
    },

    async createProjectV2(input: CreateStudioProjectInputV2): Promise<StudioProjectV2> {
      if (!isRecord(input) || Object.hasOwn(input, 'id')) {
        throw new CreativeStudioStoreError('invalid_payload', 'Studio project ids are generated by the store');
      }
      const projectId = createId();
      if (!isSafeIdV2(projectId)) throw new CreativeStudioStoreError('invalid_payload', 'Invalid Studio project id');
      let candidate: StudioProjectV2;
      try {
        candidate = createEmptyStudioProjectV2(input, projectId, now());
      } catch {
        throw new CreativeStudioStoreError('invalid_payload', 'Invalid schema-2 Studio project payload');
      }
      const created = await enqueue(projectId, async () => {
        const root = await writableCanonicalRootV2();
        await summariesFileV2(root);
        if ((await projectDirectory(root, projectId, false)) !== null) {
          throw new CreativeStudioStoreError('invalid_payload', 'Studio project already exists');
        }
        const directory = await createProjectDirectoryV2(root, projectId);
        const file = resolveRootChild(directory, 'project.json');
        await assertRegularFileOrMissing(file);
        await writeJsonAtomic(root, file, candidate);
        return candidate;
      });
      await repairSummaryV2AfterCommit();
      return created;
    },

    async getProjectV2(projectId: string): Promise<StudioProjectStoreLoadResultV2> {
      if (!isSafeIdV2(projectId)) return { status: 'not_found', projectId };
      const root = await existingCanonicalRootV2();
      if (root === null) return { status: 'not_found', projectId };
      const inspected = await inspectProjectThroughAttributionFenceV2(root, projectId);
      if (inspected.status === 'malformed_v2') throw inspected.error;
      return inspected.status === 'supported' ? { status: 'supported', project: inspected.project } : inspected;
    },

    async applyMutationBatchV2(
      batch: StudioMutationBatchV2,
      context: StudioMutationReducerContextV2,
      commitTag?: string
    ): Promise<StudioMutationApplyResultV2> {
      if (!isRecord(batch) || !isSafeIdV2(batch.projectId)) {
        throw new CreativeStudioStoreError('invalid_payload', 'Invalid Studio project id');
      }
      if (!isIntegerInRange(batch.expectedRevision, 1, Number.MAX_SAFE_INTEGER)) {
        throw new CreativeStudioStoreError('invalid_payload', 'Invalid Studio project revision');
      }
      if (!isStudioMutationReducerContextV2(context)) {
        throw new CreativeStudioStoreError('invalid_payload', 'Invalid Studio mutation reducer context');
      }
      const mutationBatch = cloneConfirmationValue(batch, 'Studio mutation batch');
      const reducerContext = Object.freeze({
        mutationId: context.mutationId,
        capturedAt: context.capturedAt,
      });
      const result = await enqueue(mutationBatch.projectId, async () => {
        const root = await existingCanonicalRootV2();
        if (root === null) throw new CreativeStudioStoreError('not_found', 'Studio project not found');
        const inspected = await inspectProjectWithAttributionFenceV2InsideQueue(root, mutationBatch.projectId);
        if (inspected.status === 'not_found') {
          throw new CreativeStudioStoreError('not_found', 'Studio project not found');
        }
        if (inspected.status === 'unsupported_prototype_schema') {
          throw new CreativeStudioStoreError('unsupported_prototype_schema', 'Unsupported prototype Studio schema');
        }
        if (inspected.status === 'malformed_v2') throw inspected.error;
        const current = inspected.project;
        if (current.revision !== mutationBatch.expectedRevision) {
          throw new CreativeStudioStoreError('stale_project', 'Studio project has changed');
        }
        await summariesFileV2(root);
        const applied = applyStudioMutationBatchV2(current, mutationBatch, reducerContext);
        const committed: StudioProjectV2 = {
          ...applied.project,
          revision: current.revision + 1,
          updatedAt: now(),
        };
        if (!validateStudioProjectV2(committed)) {
          throw new CreativeStudioStoreError('invalid_payload', 'Invalid schema-2 Studio project payload');
        }
        const file = resolveRootChild(inspected.directory.path, 'project.json');
        const bytes = serializeProjectV2ForWrite(committed, 'Schema-2 Studio mutation project');
        await writeBytesAtomic(root, file, bytes, () => assertProjectSnapshotCurrentV2({ root, snapshot: inspected }));
        observeProjectCommit(
          Object.freeze({
            projectId: current.id,
            previousRevision: current.revision,
            committedRevision: committed.revision,
            committedAt: committed.updatedAt,
            commitTag: commitTag ?? null,
          })
        );
        return { ...applied, project: committed };
      });
      await repairSummaryV2AfterCommit();
      return result;
    },

    async confirmProjectV2<TRevalidation, TDispatch>(
      input: StudioProjectConfirmationInputV2<TRevalidation, TDispatch>
    ): Promise<StudioProjectConfirmationResultV2<TDispatch>> {
      if (
        !isRecord(input) ||
        !isSafeIdV2(input.projectId) ||
        !isIntegerInRange(input.expectedRevision, 1, Number.MAX_SAFE_INTEGER) ||
        !isCanonicalIsoTimestamp(input.expiresAt) ||
        typeof input.revalidate !== 'function' ||
        typeof input.assertActive !== 'function' ||
        typeof input.buildCommit !== 'function' ||
        (input.commitTag !== undefined && typeof input.commitTag !== 'string')
      ) {
        throw new CreativeStudioStoreError('invalid_payload', 'Invalid Studio confirmation input');
      }
      const confirmationInput = Object.freeze({
        projectId: input.projectId,
        expectedRevision: input.expectedRevision,
        expiresAt: input.expiresAt,
        revalidate: input.revalidate,
        assertActive: input.assertActive,
        buildCommit: input.buildCommit,
        commitTag: input.commitTag,
      });
      let result: StudioProjectConfirmationResultV2<TDispatch>;
      try {
        result = await enqueue(confirmationInput.projectId, async () => {
          const root = await existingCanonicalRootV2();
          if (root === null) throw new CreativeStudioStoreError('not_found', 'Studio project not found');
          const inspected = requireSupportedProjectInspectionV2(
            await inspectProjectWithAttributionFenceV2InsideQueue(root, confirmationInput.projectId)
          );
          return confirmProjectV2InsideQueue(root, inspected, confirmationInput);
        });
      } catch (error) {
        // A commit queued immediately before this confirmation may be repairing the summary index.
        // Delay the stale rejection until that already-started maintenance settles so callers can
        // observe the preceding mutation before handling this queued result.
        await summaryV2Queue.catch((): undefined => undefined);
        throw error;
      }
      await repairSummaryV2AfterCommit();
      return result;
    },

    async updateProjectV2(
      projectId: string,
      update: (project: StudioProjectV2) => StudioProjectV2,
      expectedRevision?: number,
      commitTag?: string
    ): Promise<StudioProjectV2> {
      if (!isSafeIdV2(projectId)) {
        throw new CreativeStudioStoreError('invalid_payload', 'Invalid Studio project id');
      }
      if (expectedRevision !== undefined && !isIntegerInRange(expectedRevision, 1, Number.MAX_SAFE_INTEGER)) {
        throw new CreativeStudioStoreError('invalid_payload', 'Invalid Studio project revision');
      }
      const result = await enqueue(projectId, async () => {
        const root = await existingCanonicalRootV2();
        if (root === null) throw new CreativeStudioStoreError('not_found', 'Studio project not found');
        const inspected = requireSupportedProjectInspectionV2(
          await inspectProjectWithAttributionFenceV2InsideQueue(root, projectId)
        );
        return updateProjectV2InsideQueue(root, inspected, update, expectedRevision, commitTag ?? null);
      });
      await repairSummaryV2AfterCommit();
      return result;
    },

    async deleteProjectV2(projectId: string, expectedRevision: number): Promise<boolean> {
      if (!isSafeIdV2(projectId)) return false;
      if (!isIntegerInRange(expectedRevision, 1, Number.MAX_SAFE_INTEGER)) {
        throw new CreativeStudioStoreError('invalid_payload', 'Invalid Studio project revision');
      }
      const deleted = await enqueue(projectId, async () => {
        const root = await existingCanonicalRootV2();
        if (root === null) return false;
        const existingMarker = await readProjectDeletionMarkerV2(root, projectId);
        if (existingMarker !== null) {
          if (existingMarker.record.expectedRevision !== expectedRevision) {
            throw new CreativeStudioStoreError('stale_project', 'Studio project has changed');
          }
          await finishProjectDeletionV2(root, existingMarker);
          return true;
        }
        const inspected = await inspectProjectWithAttributionFenceV2InsideQueue(root, projectId);
        if (inspected.status === 'not_found') return false;
        if (inspected.status === 'unsupported_prototype_schema') {
          throw new CreativeStudioStoreError('unsupported_prototype_schema', 'Unsupported prototype Studio schema');
        }
        if (inspected.status === 'malformed_v2') throw inspected.error;
        const current = inspected.project;
        if (Object.values(current.jobs).some((job) => NONTERMINAL_JOB_STATUSES.has(job.status))) {
          throw new CreativeStudioStoreError('busy', 'Studio project has active generation jobs');
        }
        if (current.revision !== expectedRevision) {
          throw new CreativeStudioStoreError('stale_project', 'Studio project has changed');
        }
        await summariesFileV2(root);
        const paths = projectDeletionPathsV2(root, projectId);
        try {
          await fs.lstat(paths.quarantineDirectory);
          throw new CreativeStudioStoreError('storage_error', 'Studio project deletion quarantine already exists');
        } catch (error) {
          if (error instanceof CreativeStudioStoreError) throw error;
          if (!isRecord(error) || error.code !== 'ENOENT') {
            throw storageError(error, 'Studio project deletion quarantine could not be inspected');
          }
        }
        const marker = await createProjectDeletionMarkerV2(
          root,
          {
            schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
            projectId,
            expectedRevision,
            directoryDev: inspected.directory.dev,
            directoryIno: inspected.directory.ino,
            projectSha256: sha256Utf8(inspected.bytes),
          },
          inspected
        );
        await finishProjectDeletionV2(root, marker);
        return true;
      });
      if (deleted) await repairSummaryV2AfterCommit();
      return deleted;
    },

    async listProposalsV2(projectId: string): Promise<StudioProposalV2[]> {
      if (!isSafeIdV2(projectId)) {
        throw new CreativeStudioStoreError('invalid_payload', 'Invalid Studio proposal project identity');
      }
      return listProposalsV2ThroughQueue(projectId);
    },

    async acceptProposalV2(projectId: string, proposalId: string): Promise<StudioProposalAcceptanceResultV2> {
      if (!isSafeIdV2(projectId) || !isSafeProposalId(proposalId)) {
        throw new CreativeStudioStoreError('invalid_payload', 'Invalid Studio proposal identity');
      }
      const accepted = await enqueue(projectId, async () => {
        const root = await existingCanonicalRootV2();
        if (root === null) throw new CreativeStudioStoreError('not_found', 'Studio project not found');
        const snapshot = requireSupportedProjectInspectionV2(
          await inspectProjectWithAttributionFenceV2InsideQueue(root, projectId)
        );
        return acceptProposalV2InsideQueue({ root, projectId, proposalId, snapshot });
      });
      await repairSummaryV2AfterCommit();
      return accepted;
    },

    async rejectProposalV2(projectId: string, proposalId: string): Promise<StudioProposalV2> {
      if (!isSafeIdV2(projectId) || !isSafeProposalId(proposalId)) {
        throw new CreativeStudioStoreError('invalid_payload', 'Invalid Studio proposal identity');
      }
      return enqueue(projectId, async () => {
        const root = await existingCanonicalRootV2();
        if (root === null) throw new CreativeStudioStoreError('not_found', 'Studio project not found');
        const snapshot = requireSupportedProjectInspectionV2(
          await inspectProjectWithAttributionFenceV2InsideQueue(root, projectId)
        );
        let ledger = await readCleanProposalLedgerV2InsideQueue({
          root,
          projectId,
          snapshot,
          createIfWhollyAbsent: false,
        });
        if (ledger === null) throw new CreativeStudioStoreError('not_found', 'Studio proposal not found');
        ledger = await reapProposalLedgerV2InsideQueue({ root, projectId, snapshot, ledger });
        const proposal = ledger.proposals.get(proposalId);
        if (proposal === undefined) throw new CreativeStudioStoreError('not_found', 'Studio proposal not found');
        let decision = ledger.decisions.get(proposalId);
        if (decision !== undefined) {
          if (decision.record.status !== 'rejected') {
            throw new CreativeStudioStoreError('invalid_payload', 'Studio proposal is no longer pending');
          }
          await releaseProposalSlotV2({
            root,
            ledger,
            proposal,
            decision,
            slot: ledger.slots.get(proposalId)?.[0],
            projectSnapshot: snapshot,
          });
          await assertProjectSnapshotCurrentV2({ root, snapshot });
          return effectiveProposalV2(proposal.record, decision.record);
        }
        const slot = assertPendingProposalSlotV2(ledger, proposalId);
        const decidedAt = now();
        if (!isCanonicalIsoTimestamp(decidedAt)) {
          throw new CreativeStudioStoreError('storage_error', 'Studio proposal decision clock is invalid');
        }
        decision = await publishProposalDecisionV2({
          root,
          projectId,
          directories: ledger.directories,
          proposal,
          status: 'rejected',
          decidedAt,
          authorizeBeforeLink: async (temporary) => {
            await assertProjectSnapshotCurrentV2({ root, snapshot });
            await assertProposalLedgerEntrySetCurrentV2(ledger, { decision: temporary });
            await Promise.all([
              assertIdentifiedRecordCurrentV2({
                root,
                authority: ledger.directories.pending,
                identified: proposal,
              }),
              assertIdentifiedRecordCurrentV2({
                root,
                authority: ledger.directories.slots,
                identified: slot,
              }),
              assertPathAbsentV2(path.join(ledger.directories.decisions.path, `${proposalId}.json`)),
            ]);
            await assertProjectSnapshotCurrentV2({ root, snapshot });
          },
        });
        await releaseProposalSlotV2({
          root,
          ledger: { ...ledger, decisions: new Map(ledger.decisions).set(proposalId, decision) },
          proposal,
          decision,
          slot,
          projectSnapshot: snapshot,
        });
        await assertProjectSnapshotCurrentV2({ root, snapshot });
        return effectiveProposalV2(proposal.record, decision.record);
      });
    },

    async reapAbandonedProposalsV2(): Promise<void> {
      const root = await existingCanonicalRootV2();
      if (root === null) return;
      const sweep = await scanProjectsV2(root);
      await Promise.all(
        sweep.supportedProjectIds.map((projectId) =>
          enqueue(projectId, async () => {
            const snapshot = requireSupportedProjectInspectionV2(
              await inspectProjectWithAttributionFenceV2InsideQueue(root, projectId)
            );
            const ledger = await readCleanProposalLedgerV2InsideQueue({
              root,
              projectId,
              snapshot,
              createIfWhollyAbsent: false,
            });
            if (ledger !== null) {
              await reapProposalLedgerV2InsideQueue({ root, projectId, snapshot, ledger });
            }
          })
        )
      );
    },

    async watchProposalsV2(listener: (projectId: string, proposalId: string) => void): Promise<() => Promise<void>> {
      const root = await writableCanonicalRootV2();
      let closed = false;
      const observedStatuses = new Map<string, StudioProposalV2['status']>();
      const validateAndNotify = async (relativeFile: string): Promise<void> => {
        const segments = path.normalize(relativeFile).split(path.sep);
        if (
          segments.length !== 4 ||
          !isSafeIdV2(segments[0]) ||
          segments[1] !== 'proposals' ||
          (segments[2] !== 'pending' && segments[2] !== 'decisions') ||
          !segments[3].endsWith('.json')
        ) {
          return;
        }
        const projectId = segments[0];
        const proposalId = segments[3].slice(0, -'.json'.length);
        if (!isSafeProposalId(proposalId)) return;
        try {
          const proposal = (await listProposalsV2ThroughQueue(projectId)).find(
            (candidate) => candidate.id === proposalId
          );
          if (closed || proposal === undefined) return;
          const key = `${projectId}:${proposalId}`;
          if (observedStatuses.get(key) === proposal.status) return;
          observedStatuses.set(key, proposal.status);
          listener(projectId, proposalId);
        } catch (error) {
          if (!closed) safeLogError('[CreativeStudio] Schema-2 proposal watcher ignored an invalid record', error);
        }
      };
      let watcher: { close(): void };
      try {
        watcher = watchProposalTree({
          rootDir: root,
          onChange: (relativeFile) => {
            if (!closed) void validateAndNotify(relativeFile);
          },
          onError: (error) => {
            if (!closed) safeLogError('[CreativeStudio] Schema-2 proposal watcher failed', error);
          },
        });
      } catch (error) {
        throw storageError(error, 'Schema-2 Studio proposal watcher could not start');
      }
      return async (): Promise<void> => {
        if (closed) return;
        closed = true;
        watcher.close();
      };
    },

    async resolveProposalPathsV2(projectId: string): Promise<{ projectDir: string; pendingDir: string }> {
      if (!isSafeIdV2(projectId)) {
        throw new CreativeStudioStoreError('invalid_payload', 'Invalid Studio proposal project identity');
      }
      return enqueue(projectId, async () => {
        const root = await existingCanonicalRootV2();
        if (root === null) throw new CreativeStudioStoreError('not_found', 'Studio project not found');
        const snapshot = requireSupportedProjectInspectionV2(
          await inspectProjectWithAttributionFenceV2InsideQueue(root, projectId)
        );
        const directories = await resolveProposalDirectoriesV2({
          root,
          project: snapshot.directory,
          createIfWhollyAbsent: true,
          snapshot,
        });
        if (directories === null) {
          throw new CreativeStudioStoreError('storage_error', 'Schema-2 Studio proposal storage is unavailable');
        }
        return { projectDir: snapshot.directory.path, pendingDir: directories.pending.path };
      });
    },

    async listReferenceRequestsV2(projectId: string): Promise<StudioReferenceRequestLedgerEntryV2[]> {
      if (!isSafeIdV2(projectId)) {
        throw new CreativeStudioStoreError('invalid_payload', 'Invalid Studio reference request project identity');
      }
      return listReferenceRequestsV2ThroughQueue(projectId);
    },

    async decideReferenceRequestV2(
      input: StudioDecideReferenceRequestInputV2
    ): Promise<StudioReferenceRequestLedgerEntryV2> {
      if (
        !isRecord(input) ||
        !hasExactKeys(input, REFERENCE_DECIDE_INPUT_KEYS) ||
        !isSafeIdV2(input.projectId) ||
        !isSafeIdV2(input.requestId) ||
        !isIntegerInRange(input.expectedRevision, 1, Number.MAX_SAFE_INTEGER) ||
        !isRecord(input.outcome) ||
        ((input.outcome.kind === 'rejected' || input.outcome.kind === 'generation_gate') &&
          !hasExactKeys(input.outcome, REFERENCE_REJECTED_INTENT_KEYS)) ||
        (input.outcome.kind === 'imported_reference' &&
          (!hasExactKeys(input.outcome, REFERENCE_IMPORTED_INTENT_KEYS) || !isSafeIdV2(input.outcome.assetId))) ||
        (input.outcome.kind !== 'rejected' &&
          input.outcome.kind !== 'imported_reference' &&
          input.outcome.kind !== 'generation_gate')
      ) {
        throw new CreativeStudioStoreError('invalid_payload', 'Invalid Studio reference request decision input');
      }
      const decisionInput = structuredClone(input);
      return enqueue(decisionInput.projectId, async () => {
        const root = await existingCanonicalRootV2();
        if (root === null) throw new CreativeStudioStoreError('not_found', 'Studio project not found');
        const snapshot = requireSupportedProjectInspectionV2(
          await inspectProjectWithAttributionFenceV2InsideQueue(root, decisionInput.projectId)
        );
        return decideReferenceRequestV2InsideQueue({ root, decisionInput, snapshot });
      });
    },

    async readReferenceGenerationHandoffV2(
      projectId: string,
      handoffId: string
    ): Promise<StudioReferenceGenerationHandoffStoreV2 | null> {
      if (!isSafeIdV2(projectId) || !isSafeIdV2(handoffId)) {
        throw new CreativeStudioStoreError('invalid_payload', 'Invalid Studio reference handoff identity');
      }
      return enqueue(projectId, async () => {
        const root = await existingCanonicalRootV2();
        if (root === null) throw new CreativeStudioStoreError('not_found', 'Studio project not found');
        const snapshot = requireSupportedProjectInspectionV2(
          await inspectProjectWithAttributionFenceV2InsideQueue(root, projectId)
        );
        const ledger = await readCleanReferenceRequestLedgerV2InsideQueue({
          root,
          projectId,
          snapshot,
          createIfWhollyAbsent: false,
        });
        const result = ledger === null ? null : referenceGenerationHandoffV2(ledger, handoffId);
        await assertProjectSnapshotCurrentV2({ root, snapshot });
        return result;
      });
    },

    async recordReferenceGenerationHandoffReceiptV2(
      input: StudioRecordReferenceGenerationHandoffReceiptInputV2
    ): Promise<StudioReferenceGenerationHandoffStoreV2> {
      if (
        !isRecord(input) ||
        !hasExactKeys(input, REFERENCE_RECEIPT_INPUT_KEYS) ||
        !isSafeIdV2(input.projectId) ||
        !isSafeIdV2(input.handoffId) ||
        !isIntegerInRange(input.expectedRevision, 1, Number.MAX_SAFE_INTEGER) ||
        !isRecord(input.result) ||
        (input.result.kind === 'dismissed' && !hasExactKeys(input.result, REFERENCE_DISMISSED_RESULT_KEYS)) ||
        (input.result.kind === 'confirmed' &&
          (!hasExactKeys(input.result, REFERENCE_CONFIRMED_RESULT_KEYS) ||
            !isSafeIdV2(input.result.authorizationId))) ||
        (input.result.kind !== 'dismissed' && input.result.kind !== 'confirmed')
      ) {
        throw new CreativeStudioStoreError('invalid_payload', 'Invalid Studio reference handoff receipt input');
      }
      const receiptInput = structuredClone(input);
      return enqueue(receiptInput.projectId, async () => {
        const root = await existingCanonicalRootV2();
        if (root === null) throw new CreativeStudioStoreError('not_found', 'Studio project not found');
        const snapshot = requireSupportedProjectInspectionV2(
          await inspectProjectWithAttributionFenceV2InsideQueue(root, receiptInput.projectId)
        );
        return recordReferenceGenerationHandoffReceiptV2InsideQueue({ root, receiptInput, snapshot });
      });
    },

    async reapAbandonedReferenceRequestsV2(): Promise<void> {
      const root = await existingCanonicalRootV2();
      if (root === null) return;
      const sweep = await scanProjectsV2(root);
      await Promise.all(
        sweep.supportedProjectIds.map((projectId) =>
          enqueue(projectId, async () => {
            const snapshot = requireSupportedProjectInspectionV2(
              await inspectProjectWithAttributionFenceV2InsideQueue(root, projectId)
            );
            const ledger = await readCleanReferenceRequestLedgerV2InsideQueue({
              root,
              projectId,
              snapshot,
              createIfWhollyAbsent: false,
            });
            if (ledger !== null) {
              await reapReferenceRequestLedgerV2InsideQueue({ root, projectId, snapshot, ledger });
            }
          })
        )
      );
    },

    async watchReferenceRequestsV2(
      listener: (projectId: string, requestId: string) => void
    ): Promise<() => Promise<void>> {
      const root = await writableCanonicalRootV2();
      let closed = false;
      const observedSignatures = new Map<string, string>();
      const validateAndNotify = async (relativeFile: string): Promise<void> => {
        const segments = path.normalize(relativeFile).split(path.sep);
        if (
          segments.length !== 4 ||
          !isSafeIdV2(segments[0]) ||
          segments[1] !== 'reference-requests' ||
          (segments[2] !== 'pending' && segments[2] !== 'decisions' && segments[2] !== 'receipts') ||
          !segments[3].endsWith('.json')
        ) {
          return;
        }
        const projectId = segments[0];
        const recordId = segments[3].slice(0, -'.json'.length);
        if (!isSafeIdV2(recordId)) return;
        try {
          const entries = await listReferenceRequestsV2ThroughQueue(projectId);
          const entry =
            segments[2] === 'receipts'
              ? entries.find(
                  (candidate) =>
                    candidate.decision?.outcome.kind === 'generation_gate' &&
                    candidate.decision.outcome.handoffId === recordId
                )
              : entries.find((candidate) => candidate.request.id === recordId);
          if (closed || entry === undefined) return;
          const key = `${projectId}:${entry.request.id}`;
          const signature = serializeJsonExact({
            request: entry.request,
            decision: entry.decision,
            receipt: entry.receipt,
          });
          if (observedSignatures.get(key) === signature) return;
          observedSignatures.set(key, signature);
          listener(projectId, entry.request.id);
        } catch (error) {
          if (!closed) safeLogError('[CreativeStudio] Schema-2 reference watcher ignored an invalid record', error);
        }
      };
      let watcher: { close(): void };
      try {
        watcher = watchProposalTree({
          rootDir: root,
          onChange: (relativeFile) => {
            if (!closed) void validateAndNotify(relativeFile);
          },
          onError: (error) => {
            if (!closed) safeLogError('[CreativeStudio] Schema-2 reference watcher failed', error);
          },
        });
      } catch (error) {
        throw storageError(error, 'Schema-2 Studio reference watcher could not start');
      }
      return async (): Promise<void> => {
        if (closed) return;
        closed = true;
        watcher.close();
      };
    },

    async resolveReferenceRequestPathsV2(projectId: string): Promise<{ projectDir: string; pendingDir: string }> {
      if (!isSafeIdV2(projectId)) {
        throw new CreativeStudioStoreError('invalid_payload', 'Invalid Studio reference request project identity');
      }
      return enqueue(projectId, async () => {
        const root = await existingCanonicalRootV2();
        if (root === null) throw new CreativeStudioStoreError('not_found', 'Studio project not found');
        const snapshot = requireSupportedProjectInspectionV2(
          await inspectProjectWithAttributionFenceV2InsideQueue(root, projectId)
        );
        const directories = await resolveReferenceRequestDirectoriesV2({
          root,
          project: snapshot.directory,
          createIfWhollyAbsent: true,
          snapshot,
        });
        if (directories === null) {
          throw new CreativeStudioStoreError('storage_error', 'Schema-2 Studio reference request storage unavailable');
        }
        return { projectDir: snapshot.directory.path, pendingDir: directories.pending.path };
      });
    },

    async listProjects(): Promise<StudioProjectSummary[]> {
      if (sharedListingSweep?.remainingConsumer === 'projects') {
        const { result } = sharedListingSweep;
        sharedListingSweep = undefined;
        return result.projects;
      }
      const result = await repairSummaryIndex();
      sharedListingSweep = { result, remainingConsumer: 'quarantinedProjectIds' };
      return result.projects;
    },

    async listQuarantinedProjectIds(): Promise<string[]> {
      if (sharedListingSweep?.remainingConsumer === 'quarantinedProjectIds') {
        const { result } = sharedListingSweep;
        sharedListingSweep = undefined;
        return result.quarantinedProjectIds;
      }
      const result = await repairSummaryIndex();
      sharedListingSweep = { result, remainingConsumer: 'projects' };
      return result.quarantinedProjectIds;
    },

    async createProject(input: CreateStudioProjectInput): Promise<StudioProject> {
      if (Object.hasOwn(input, 'id')) {
        throw new CreativeStudioStoreError('invalid_payload', 'Studio project ids are generated by the store');
      }
      const projectId = createId();
      if (!isSafeId(projectId)) throw new CreativeStudioStoreError('invalid_payload', 'Invalid Studio project id');
      sharedListingSweep = undefined;
      return enqueue(projectId, async () => {
        const root = await canonicalRoot();
        await summariesFile(root);
        const candidate = createProjectFromInput(input, projectId, now());
        if (!validateProject(candidate))
          throw new CreativeStudioStoreError('invalid_payload', 'Invalid Studio project payload');
        if (await readProject(root, projectId))
          throw new CreativeStudioStoreError('invalid_payload', 'Studio project already exists');
        const file = await projectFile(root, projectId, true);
        if (file === null)
          throw new CreativeStudioStoreError('storage_error', 'Creative Studio project storage is unavailable');
        await writeJsonAtomic(root, file, candidate);
        await repairSummaryIndex();
        return candidate;
      });
    },

    async getProject(projectId: string): Promise<StudioProject | null> {
      if (!isSafeId(projectId)) return null;
      return readProject(await canonicalRoot(), projectId);
    },

    async getVerifiedProjectDirectory(projectId: string): Promise<string | null> {
      if (!isSafeId(projectId)) return null;
      return projectDirectory(await canonicalRoot(), projectId, false);
    },

    async getVerifiedProjectDirectoryV2(projectId: string): Promise<string | null> {
      if (!isSafeIdV2(projectId)) return null;
      const root = await existingCanonicalRootV2();
      if (root === null) return null;
      const inspected = await inspectProjectThroughAttributionFenceV2(root, projectId);
      if (inspected.status === 'not_found') return null;
      if (inspected.status === 'unsupported_prototype_schema') {
        throw new CreativeStudioStoreError('unsupported_prototype_schema', 'Unsupported prototype Studio schema');
      }
      if (inspected.status === 'malformed_v2') throw inspected.error;
      return inspected.directory.path;
    },

    async resolveProposalPaths(
      projectId: string
    ): Promise<{ projectDir: string; pendingDir: string; referencePendingDir: string }> {
      if (!isSafeId(projectId)) {
        throw new CreativeStudioStoreError('invalid_payload', 'Invalid Studio project id');
      }
      return enqueue(projectId, async () => {
        const root = await canonicalRoot();
        const project = await projectDirectory(root, projectId, false);
        if (project === null) throw new CreativeStudioStoreError('not_found', 'Studio project not found');
        const directories = await proposalDirectories(root, projectId, true);
        const referenceDirectories = await referenceRequestDirectories(root, projectId, true);
        if (directories === null || referenceDirectories === null) {
          throw new CreativeStudioStoreError('storage_error', 'Creative Studio proposal storage is unavailable');
        }
        return {
          projectDir: project,
          pendingDir: directories.pending,
          referencePendingDir: referenceDirectories.pending,
        };
      });
    },

    async recordProposal(input: StudioRecordProposalInput): Promise<StudioProposal> {
      if (!isSafeId(input.projectId) || !isSafeProposalId(input.proposalId)) {
        throw new CreativeStudioStoreError('invalid_payload', 'Invalid Studio proposal identity');
      }
      if (!isIntegerInRange(input.baseRevision, 1, Number.MAX_SAFE_INTEGER)) {
        throw new CreativeStudioStoreError('invalid_payload', 'Invalid Studio proposal revision');
      }
      return enqueue(input.projectId, async () => {
        const root = await canonicalRoot();
        const project = await readProject(root, input.projectId);
        if (project === null) throw new CreativeStudioStoreError('not_found', 'Studio project not found');
        const candidate: StudioProposal = {
          schemaVersion: 1,
          id: input.proposalId,
          projectId: input.projectId,
          status: 'pending',
          baseRevision: input.baseRevision,
          payload: structuredClone(input.payload),
          createdAt: now(),
          decidedAt: null,
        };
        if (!validateProposalRecord(input.projectId, input.proposalId, candidate)) {
          throw new CreativeStudioStoreError('invalid_payload', 'Invalid Studio proposal record');
        }
        const serialized = JSON.stringify(candidate);
        if (Buffer.byteLength(serialized, 'utf8') > STUDIO_PROPOSAL_MAX_RECORD_BYTES) {
          throw new CreativeStudioStoreError('invalid_payload', 'Studio proposal record is too large');
        }
        const directories = await proposalDirectories(root, input.projectId, true);
        if (directories === null) {
          throw new CreativeStudioStoreError('storage_error', 'Creative Studio proposal storage is unavailable');
        }
        await reapPendingProposalsBeforeWrite(root, input.projectId, directories);
        const slot = await reserveProposalSlot(directories.slots, input.proposalId);
        try {
          await writeJsonExclusiveAtomic(root, path.join(directories.pending, `${input.proposalId}.json`), serialized);
        } catch (error) {
          await releaseProposalSlotFile(slot).catch((): undefined => undefined);
          throw error;
        }
        return candidate;
      });
    },

    async listProposals(projectId: string): Promise<StudioProposal[]> {
      if (!isSafeId(projectId)) {
        throw new CreativeStudioStoreError('invalid_payload', 'Invalid Studio project id');
      }
      return listProposalsThroughQueue(projectId);
    },

    async listPendingReferenceRequests(projectId: string): Promise<StudioReferenceRequest[]> {
      if (!isSafeId(projectId)) {
        throw new CreativeStudioStoreError('invalid_payload', 'Invalid Studio project id');
      }
      return listReferenceRequestsThroughQueue(projectId);
    },

    async dismissReferenceRequests(
      projectId: string,
      requestIds: string[],
      authority?: StudioReferenceRequestDismissAuthority
    ): Promise<void> {
      if (
        !isSafeId(projectId) ||
        requestIds.length === 0 ||
        requestIds.length > STUDIO_PROPOSAL_MAX_PENDING_PER_PROJECT ||
        new Set(requestIds).size !== requestIds.length ||
        requestIds.some((requestId) => !isSafeProposalId(requestId)) ||
        (authority !== undefined &&
          (!isIntegerInRange(authority.expectedRevision, 1, Number.MAX_SAFE_INTEGER) ||
            !Array.isArray(authority.expectedRequests) ||
            authority.expectedRequests.length !== requestIds.length ||
            authority.expectedRequests.some(
              (request, index) =>
                request.id !== requestIds[index] || !isSafeProposalId(request.id) || !isSafeId(request.sceneId)
            )))
      ) {
        throw new CreativeStudioStoreError('invalid_payload', 'Invalid Studio reference request identities');
      }
      await enqueue(projectId, async (): Promise<void> => {
        const root = await canonicalRoot();
        const project = await readProject(root, projectId);
        if (project === null) throw new CreativeStudioStoreError('not_found', 'Studio project not found');
        if (authority !== undefined && project.revision !== authority.expectedRevision) {
          throw new CreativeStudioStoreError('stale_project', 'Studio project has changed');
        }
        const directories = await referenceRequestDirectories(root, projectId, false);
        if (directories === null) {
          if (authority !== undefined) {
            throw new CreativeStudioStoreError('invalid_payload', 'Studio reference request authority changed');
          }
          return;
        }
        const requests = await readReferenceRequestRecords(project, directories);
        if (authority !== undefined) {
          const currentSceneById = new Map(requests.map((request) => [request.id, request.sceneId]));
          if (authority.expectedRequests.some((expected) => currentSceneById.get(expected.id) !== expected.sceneId)) {
            throw new CreativeStudioStoreError('invalid_payload', 'Studio reference request authority changed');
          }
        }
        const requestedIds = new Set(requestIds);
        const dismissibleIds = new Set(
          requests.filter((request) => requestedIds.has(request.id)).map((request) => request.id)
        );
        for (const requestId of dismissibleIds) {
          try {
            // The bounded queue contains at most 50 records.
            // eslint-disable-next-line no-await-in-loop
            await fs.rm(path.join(directories.pending, `${requestId}.json`));
          } catch (error) {
            if (!isRecord(error) || error.code !== 'ENOENT') {
              throw storageError(error, 'Creative Studio reference request could not be dismissed');
            }
          }
        }
        await releaseReferenceRequestSlots(directories, dismissibleIds);
        await cleanupReferenceRequestSlots(
          directories,
          requests.filter((request) => !dismissibleIds.has(request.id))
        );
      });
    },

    async rejectProposal(projectId: string, proposalId: string): Promise<StudioProposal> {
      if (!isSafeId(projectId) || !isSafeProposalId(proposalId)) {
        throw new CreativeStudioStoreError('invalid_payload', 'Invalid Studio proposal identity');
      }
      return enqueue(projectId, async () => {
        const root = await canonicalRoot();
        const project = await readProject(root, projectId);
        if (project === null) throw new CreativeStudioStoreError('not_found', 'Studio project not found');
        const directories = await proposalDirectories(root, projectId, false);
        if (directories === null) throw new CreativeStudioStoreError('not_found', 'Studio proposal not found');
        const proposal = (await listProjectProposals(root, projectId, directories)).find(
          (candidate) => candidate.id === proposalId
        );
        if (proposal === undefined) throw new CreativeStudioStoreError('not_found', 'Studio proposal not found');
        if (proposal.status === 'rejected') return proposal;
        if (proposal.status !== 'pending') {
          throw new CreativeStudioStoreError('invalid_payload', 'Studio proposal is no longer pending');
        }
        const decision = await appendProposalDecision(root, directories.decisions, proposalId, 'rejected');
        await releaseProposalSlot(directories, proposalId);
        return effectiveProposal(proposal, decision);
      });
    },

    async reapAbandonedProposals(): Promise<void> {
      const root = await canonicalRoot();
      const { projects } = await readAllProjects(root);
      await Promise.all(
        projects.map((project) =>
          enqueue(project.id, async () => {
            const [directories, referenceDirectories] = await Promise.all([
              proposalDirectories(root, project.id, false),
              referenceRequestDirectories(root, project.id, false),
            ]);
            if (directories !== null) {
              await reapPendingProposals(root, directories);
              proposalReapedAt.set(project.id, Date.parse(now()));
            }
            if (referenceDirectories !== null) {
              await reapPendingReferenceRequests(project, referenceDirectories);
            }
          })
        )
      );
    },

    async watchProposals(listener: (projectId: string, proposalId: string) => void): Promise<() => Promise<void>> {
      const root = await canonicalRoot();
      let closed = false;
      const observedStatuses = new Map<string, StudioProposal['status'] | StudioReferenceRequest['status']>();
      const validateAndNotify = async (relativeFile: string): Promise<void> => {
        const segments = path.normalize(relativeFile).split(path.sep);
        const isProposalChange =
          segments[1] === 'proposals' && (segments[2] === 'pending' || segments[2] === 'decisions');
        const isReferenceRequestChange = segments[1] === 'reference-requests' && segments[2] === 'pending';
        if (
          segments.length !== 4 ||
          !isSafeId(segments[0]) ||
          (!isProposalChange && !isReferenceRequestChange) ||
          !segments[3].endsWith('.json')
        ) {
          return;
        }
        const projectId = segments[0];
        const recordId = segments[3].slice(0, -'.json'.length);
        if (!isSafeProposalId(recordId)) return;
        try {
          const record = isProposalChange
            ? (await listProposalsThroughQueue(projectId)).find((candidate) => candidate.id === recordId)
            : (await listReferenceRequestsThroughQueue(projectId)).find((candidate) => candidate.id === recordId);
          if (closed || record === undefined) return;
          const key = `${projectId}:${recordId}`;
          if (observedStatuses.get(key) === record.status) return;
          observedStatuses.set(key, record.status);
          listener(projectId, recordId);
        } catch (error) {
          if (!closed) logError('[CreativeStudio] Proposal watcher ignored an invalid record', error);
        }
      };
      let watcher: { close(): void };
      try {
        watcher = watchProposalTree({
          rootDir: root,
          onChange: (relativeFile) => {
            if (!closed) void validateAndNotify(relativeFile);
          },
          onError: (error) => {
            if (!closed) logError('[CreativeStudio] Proposal watcher failed', error);
          },
        });
      } catch (error) {
        throw storageError(error, 'Creative Studio proposal watcher could not start');
      }
      return async () => {
        if (closed) return;
        closed = true;
        watcher.close();
      };
    },

    async acceptProposal(
      projectId: string,
      proposalId: string,
      update: (project: StudioProject, payload: StudioProposalPayload) => StudioProject
    ): Promise<{ proposal: StudioProposal; project: StudioProject; applied: boolean }> {
      if (!isSafeId(projectId) || !isSafeProposalId(proposalId)) {
        throw new CreativeStudioStoreError('invalid_payload', 'Invalid Studio proposal identity');
      }
      return enqueue(projectId, async () => {
        const root = await canonicalRoot();
        const current = await readProject(root, projectId);
        if (current === null) throw new CreativeStudioStoreError('not_found', 'Studio project not found');
        const directories = await proposalDirectories(root, projectId, false);
        if (directories === null) throw new CreativeStudioStoreError('not_found', 'Studio proposal not found');
        const proposal = (await listProjectProposals(root, projectId, directories)).find(
          (candidate) => candidate.id === proposalId
        );
        if (proposal === undefined) throw new CreativeStudioStoreError('not_found', 'Studio proposal not found');
        if (proposal.status === 'accepted') return { proposal, project: current, applied: false };
        if (proposal.status !== 'pending') {
          throw new CreativeStudioStoreError('invalid_payload', 'Studio proposal is no longer pending');
        }
        const project = await updateProjectInsideQueue(
          root,
          projectId,
          (candidate) => update(candidate, structuredClone(proposal.payload)),
          proposal.baseRevision,
          null
        );
        const decision = await appendProposalDecision(root, directories.decisions, proposalId, 'accepted');
        await releaseProposalSlot(directories, proposalId);
        return { proposal: effectiveProposal(proposal, decision), project, applied: true };
      });
    },

    async updateProject(
      projectId: string,
      update: (project: StudioProject) => StudioProject,
      expectedRevision?: number,
      commitTag?: string
    ): Promise<StudioProject> {
      if (!isSafeId(projectId)) throw new CreativeStudioStoreError('invalid_payload', 'Invalid Studio project id');
      if (expectedRevision !== undefined && !isIntegerInRange(expectedRevision, 1, Number.MAX_SAFE_INTEGER)) {
        throw new CreativeStudioStoreError('invalid_payload', 'Invalid Studio project revision');
      }
      sharedListingSweep = undefined;
      return enqueue(projectId, async () => {
        const root = await canonicalRoot();
        return updateProjectInsideQueue(root, projectId, update, expectedRevision, commitTag ?? null);
      });
    },

    async deleteProject(projectId: string, expectedRevision: number): Promise<boolean> {
      if (!isSafeId(projectId)) return false;
      if (!isIntegerInRange(expectedRevision, 1, Number.MAX_SAFE_INTEGER)) {
        throw new CreativeStudioStoreError('invalid_payload', 'Invalid Studio project revision');
      }
      sharedListingSweep = undefined;
      return enqueue(projectId, async () => {
        const root = await canonicalRoot();
        await summariesFile(root);
        const current = await readProject(root, projectId);
        if (current === null) return false;
        if (Object.values(current.jobs).some((job) => NONTERMINAL_JOB_STATUSES.has(job.status))) {
          throw new CreativeStudioStoreError('busy', 'Studio project has active generation jobs');
        }
        if (current.revision !== expectedRevision) {
          throw new CreativeStudioStoreError('stale_project', 'Studio project has changed');
        }
        try {
          const targetDir = await projectDirectory(root, projectId, false);
          if (targetDir === null) return false;
          await fs.rm(targetDir, { recursive: true, force: false });
        } catch (error) {
          throw new CreativeStudioStoreError(
            'storage_error',
            error instanceof Error ? error.message : 'Studio project deletion failed'
          );
        }
        await repairSummaryIndex();
        return true;
      });
    },

    async listConnections(): Promise<StudioConnectionBinding[]> {
      return readConnections(await canonicalRoot());
    },

    async saveConnection(binding: StudioConnectionBinding): Promise<StudioConnectionBinding> {
      const canonicalBinding = canonicalizeConnectionBinding(binding);
      if (canonicalBinding === null) {
        throw new CreativeStudioStoreError('invalid_payload', 'Invalid Studio connection binding');
      }
      return enqueueConnections(async () => {
        const root = await canonicalRoot();
        const current = await readConnections(root);
        const next = [
          ...current.filter(
            (connection) =>
              connection.id !== canonicalBinding.id &&
              !(
                connection.providerId === canonicalBinding.providerId &&
                connection.adapterId === canonicalBinding.adapterId &&
                connection.model === canonicalBinding.model
              )
          ),
          structuredClone(canonicalBinding),
        ].toSorted((left, right) => left.id.localeCompare(right.id));
        await writeJsonAtomic(root, await connectionsFile(root), { schemaVersion: 1, connections: next });
        return structuredClone(canonicalBinding);
      });
    },

    async removeConnection(connectionId: string): Promise<boolean> {
      if (!isSafeConnectionId(connectionId)) return false;
      return enqueueConnections(async () => {
        const root = await canonicalRoot();
        const current = await readConnections(root);
        const next = current.filter((connection) => connection.id !== connectionId);
        if (next.length === current.length) return false;
        await writeJsonAtomic(root, await connectionsFile(root), { schemaVersion: 1, connections: next });
        return true;
      });
    },
  };
};
