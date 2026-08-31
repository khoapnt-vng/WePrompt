/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/** Shared, renderer-safe Creative Studio domain and desktop contract types. */

import type { StudioBriefRule, StudioBriefRuleDraft, StudioBriefRulePredicate } from './creativeStudioRules';

export type {
  StudioBriefRule,
  StudioBriefRuleDraft,
  StudioBriefRulePredicate,
  StudioBriefRuleScope,
  StudioRuleBreach,
  StudioRuleVerdict,
} from './creativeStudioRules';

/**
 * The document's views, in switch order.
 *
 * Shared rather than renderer-private because the main process needs the same vocabulary: it
 * matches the renderer's Studio URL against these segments to decide whether to run the
 * unsaved-draft preflight before closing the window. A second copy of this list would not
 * just be a style problem — a view missing from main's copy closes with no prompt and loses the drafts.
 */
export const STUDIO_VIEWS = ['references', 'table', 'board', 'cut'] as const;

export type StudioView = (typeof STUDIO_VIEWS)[number];

export type StudioMediaKind = 'image' | 'video';

export type StudioAspectRatio = '16:9' | '9:16' | '1:1' | '4:3' | '3:4';

export type StudioResolution = '720p' | '1080p';

export const STUDIO_BOARD_STYLES_V2 = ['grey_tone', 'line_art', 'colour_key'] as const;

export type StudioBoardStyleV2 = (typeof STUDIO_BOARD_STYLES_V2)[number];

export type StudioJobPurpose = 'seed_still' | 'board_still' | 'video_take' | 'reference_image';

export type StudioJobStatus =
  | 'queued_local'
  | 'submitting'
  | 'queued_remote'
  | 'running'
  | 'needs_attention'
  | 'succeeded'
  | 'failed'
  | 'cancelled';

export type StudioProviderAdapterId =
  | 'weprompt-image-v1'
  | 'byteplus-seedance-v1'
  | 'weprompt-media-gateway-v1'
  | 'openrouter-video-v1';

export type StudioProviderRef = {
  providerId: string;
  adapterId: StudioProviderAdapterId;
  model: string;
};

/** Durable schema-2 media route identity. */
export type StudioMediaModelRef = {
  providerId: string;
  adapterId: StudioProviderAdapterId;
  model: string;
};

/** Renderer-safe schema-2 media route identity. */
export type StudioRendererMediaModelRef = {
  choiceId: string;
  providerId: string;
  model: string;
};

/** Main-issued media choice identity plus renderer-safe display metadata. */
export type StudioMediaChoiceRef = {
  choiceId: string;
  providerId: string;
  model: string;
};

export type StudioJobErrorCode =
  | 'invalid_request'
  | 'content_rejected'
  | 'auth'
  | 'quota'
  | 'rate_limited'
  | 'provider_unavailable'
  | 'timeout'
  | 'poll_deadline'
  | 'no_output'
  | 'seed_still_variation_grid'
  | 'submission_unknown'
  | 'download_failed'
  | 'unsupported'
  | 'unknown';

export type StudioJobError = {
  code: StudioJobErrorCode;
  messageKey: string;
};

export type StudioJobRetryReason = 'provider_failure' | 'submission_unknown' | 'variation_grid';

export type StudioCancellationPolicy = 'none' | 'queued_only' | 'queued_and_running';

export const STUDIO_PROJECT_SCHEMA_VERSION = 5 as const;
/** Only zero-user prototype schemas 1–4 are recognized as intentionally unsupported. */
export const isUnsupportedStudioPrototypeSchemaVersion = (value: unknown): boolean =>
  Number.isSafeInteger(value) && (value as number) >= 1 && (value as number) < STUDIO_PROJECT_SCHEMA_VERSION;
/** Mutation transport version; intentionally independent from the persisted project schema. */
export const STUDIO_MUTATION_BATCH_SCHEMA_VERSION = 5 as const;
export const STUDIO_MAX_BEATS = 24;
export const STUDIO_MAX_SHOTS_PER_BEAT = 8;
export const STUDIO_MAX_SHOTS_PER_PROJECT = 96;
export const STUDIO_MAX_BIN_BEAT_ITEMS = 24;
export const STUDIO_MAX_BIN_SHOT_ITEMS = 96;
export const STUDIO_MAX_UNDO_ENTRIES = 20;
export const STUDIO_MAX_UNDO_PATCHES_PER_ENTRY = 2 + STUDIO_MAX_BEATS + STUDIO_MAX_SHOTS_PER_PROJECT;
export const STUDIO_MAX_UNDO_LABEL_LENGTH = 256;
export const STUDIO_MIN_SHOT_SECONDS = 4;
export const STUDIO_MAX_SHOT_SECONDS = 15;
export const STUDIO_MAX_STORY_LENGTH = 4 * 1024;
export const STUDIO_MAX_SHOOTING_SCRIPT_LENGTH = 24 * 1024;
export const STUDIO_MAX_GENERATION_PROMPT_LENGTH = 32 * 1024;
export const STUDIO_MAX_GENERATION_SHOTS_PER_REQUEST = 24;
export const STUDIO_MAX_GENERATION_ITEMS_PER_REQUEST = 2 * STUDIO_MAX_GENERATION_SHOTS_PER_REQUEST;
export const STUDIO_MAX_IMAGE_ASSET_BYTES_V2 = 50 * 1024 * 1024;
export const STUDIO_PREPARED_QUOTE_TTL_SECONDS = 5 * 60;
export const STUDIO_MAX_PREPARED_QUOTE_SESSIONS_PER_PROJECT = 4;
export const STUDIO_MAX_PREPARED_QUOTE_SESSIONS_GLOBAL = 16;
export const STUDIO_MAX_PREPARED_QUOTE_SESSION_BYTES = 8 * 1024 * 1024;
export const STUDIO_MAX_PREPARED_QUOTE_CACHE_BYTES_PER_PROJECT = 16 * 1024 * 1024;
export const STUDIO_MAX_PREPARED_QUOTE_CACHE_BYTES_GLOBAL = 64 * 1024 * 1024;
export const STUDIO_MAX_EXPORTS_PER_SHAPE = 5;
export const STUDIO_MAX_EXPORT_FILES_PER_ARTIFACT = STUDIO_MAX_SHOTS_PER_PROJECT + 8;
export const STUDIO_MAX_EXPORT_DIRECTORY_DEPTH = 4;
export const STUDIO_BED_FADE_OUT_SECONDS = 2;
export const STUDIO_FILM_EXPORT_FACTS_SCHEMA_VERSION = 1 as const;
export const STUDIO_FILM_EXPORT_FRAME_RATE = 24 as const;
export const STUDIO_FILM_EXPORT_AUDIO_SAMPLE_RATE = 48_000 as const;
export const STUDIO_FILM_EXPORT_AUDIO_CHANNELS = 2 as const;
export const STUDIO_FILM_EXPORT_DISSOLVE_SECONDS = 0.35 as const;
export const STUDIO_FILM_EXPORT_TAKE_GAIN = 0.85 as const;
export const STUDIO_FILM_EXPORT_BED_GAIN = 0.2 as const;
export const STUDIO_MAX_REFERENCE_REQUEST_ITEMS = 24;
export const STUDIO_MAX_PROJECT_REFERENCES = 24;
export const STUDIO_MAX_REFERENCE_LABEL_LENGTH = 120;
export const STUDIO_MAX_REFERENCE_PROMPT_LENGTH = 4 * 1024;
export const STUDIO_PROPOSAL_V2_MAX_RECORD_BYTES = 256 * 1024;
export const STUDIO_PROPOSAL_V2_MAX_PENDING_PER_PROJECT = 50;
export const STUDIO_PROPOSAL_V2_PENDING_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
export const STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES = 256 * 1024;
export const STUDIO_REFERENCE_REQUEST_V2_MAX_PENDING_PER_PROJECT = 50;
export const STUDIO_REFERENCE_REQUEST_V2_PENDING_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
export const STUDIO_MAX_DIRTY_SHOTS_REPORTED = 96;
export const STUDIO_MAX_MUTATION_OPERATIONS = 32;

/**
 * Bounds persisted remote job IDs to URL-unreserved opaque tokens before they
 * can reach provider polling or cancellation routes.
 */
export const isValidProviderJobId = (value: string): boolean =>
  value.length <= 512 && /^[A-Za-z0-9][A-Za-z0-9._~-]*$/.test(value);

export const STUDIO_MAX_DIRTY_DRAFTS_REPORTED = 24;
/** Durable Beat/Shot Director command schema. */
export const STUDIO_DIRECTOR_COMMAND_SCHEMA_VERSION_V2 = 10 as const;
export const STUDIO_PROPOSAL_SCHEMA_VERSION_V2 = 6 as const;
export const STUDIO_REFERENCE_REQUEST_SCHEMA_VERSION = 5 as const;
export const STUDIO_GENERATION_COMPOSITION_SCHEMA_VERSION = 1 as const;
/** Sidecar contract version. It intentionally does not follow the project schema version. */
export const STUDIO_EXPORT_SCHEMA_VERSION_V2 = 2 as const;
export const STUDIO_DIRECTOR_COMMAND_MAX_OPERATIONS = 32;
export const STUDIO_DIRECTOR_COMMAND_MAX_RECORD_BYTES = 256 * 1024;
/**
 * Query receipts may contain one maximum-size immutable proposal plus their bounded envelope.
 * Commands and slots intentionally retain the smaller command-record cap.
 */
export const STUDIO_DIRECTOR_COMMAND_MAX_RECEIPT_BYTES = STUDIO_PROPOSAL_V2_MAX_RECORD_BYTES + 4 * 1024;
export const STUDIO_DIRECTOR_COMMAND_RECEIPT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
export const STUDIO_DIRECTOR_COMMAND_MAX_SWEEP_RECORDS = 64;
export const STUDIO_DIRECTOR_COMMAND_MAINTENANCE_INTERVAL_MS = 60_000;
export const STUDIO_DIRECTOR_COMMAND_SWEEP_INTERVAL_MS = 500;
export const STUDIO_DIRECTOR_COMMAND_CLOCK_SKEW_MS = 2_000;
export const STUDIO_DIRECTOR_COMMAND_ACK_GRACE_MS = 2_000;
export const STUDIO_DIRECTOR_COMMAND_SLOT_LEASE_MS = STUDIO_DIRECTOR_COMMAND_ACK_GRACE_MS;
export const STUDIO_DIRECTOR_COMMAND_WAIT_MS = 15_000;

export type StudioDirectorCommandExpiryCode = 'deadline_elapsed' | 'expired_after_restart';

export type StudioDirectorCommandIndeterminateCode = 'commit_attribution_unknown' | 'indeterminate_after_restart';

/** Director commands expose only the current explicitly supported direct-edit capability. */
export type StudioDirectorOperationV2 = Extract<
  StudioMutationOperationV2,
  {
    kind:
      | 'set_brief'
      | 'reorder_beats'
      | 'delete_shot'
      | 'reorder_shots'
      | 'reorder_bin'
      | 'set_reference_plan'
      | 'amend_reference_plan'
      | 'set_shot_reference_binding';
  }
>;

/** Free, deterministic recovery authority exposed to the project-scoped Director. */
export type StudioDirectorFreeRecoveryV2 =
  | { op: 'retry_conditioning_frame'; dependentShotId: string }
  | { op: 'terminalize_refused_job'; jobId: string };

type StudioDirectorCommandRecordBaseV2 = {
  schemaVersion: typeof STUDIO_DIRECTOR_COMMAND_SCHEMA_VERSION_V2;
  commandId: string;
  projectId: string;
  createdAt: string;
  deadlineAt: string;
};

export type StudioDirectorAutoApplyCommandRecordV2 = StudioDirectorCommandRecordBaseV2 & {
  policy: 'auto_apply';
  expectedRevision: number;
  operations: StudioDirectorOperationV2[];
};

export type StudioDirectorFreeRecoveryCommandRecordV2 = StudioDirectorCommandRecordBaseV2 & {
  policy: 'apply_free_fix';
  expectedRevision: number;
  recovery: StudioDirectorFreeRecoveryV2;
};

/** Free preparation request that records a priced recovery for later human confirmation. */
export type StudioDirectorPaidRecoveryCommandRecordV2 = StudioDirectorCommandRecordBaseV2 & {
  policy: 'propose_paid_recovery';
  expectedRevision: number;
  blocker: StudioPaidRecoveryBlockerV2;
};

export type StudioDirectorGetProjectStatusCommandRecordV2 = StudioDirectorCommandRecordBaseV2 & {
  policy: 'get_project_status';
  /** Normalized by the writer so durable identity never depends on omission semantics. */
  detail: boolean;
};

export type StudioDirectorListRoutesCommandRecordV2 = StudioDirectorCommandRecordBaseV2 & {
  policy: 'list_routes';
};

export type StudioDirectorGetProposalCommandRecordV2 = StudioDirectorCommandRecordBaseV2 & {
  policy: 'get_proposal';
  proposalId: string;
};

export type StudioDirectorQueryCommandRecordV2 =
  | StudioDirectorGetProjectStatusCommandRecordV2
  | StudioDirectorListRoutesCommandRecordV2
  | StudioDirectorGetProposalCommandRecordV2;

/** One durable lane carries direct mutations, bounded free recovery, and read-only Director queries. */
export type StudioDirectorCommandRecordV2 =
  | StudioDirectorAutoApplyCommandRecordV2
  | StudioDirectorFreeRecoveryCommandRecordV2
  | StudioDirectorPaidRecoveryCommandRecordV2
  | StudioDirectorQueryCommandRecordV2;

export type StudioDirectorQueryV2 =
  | { kind: 'get_project_status'; detail: boolean }
  | { kind: 'list_routes' }
  | { kind: 'get_proposal'; proposalId: string };

export type StudioDirectorCommandSlotV2 = {
  schemaVersion: typeof STUDIO_DIRECTOR_COMMAND_SCHEMA_VERSION_V2;
  commandId: string;
  reservedAt: string;
  deadlineAt: string;
};

export type StudioDirectorCommandSlotLeaseV2 = {
  schemaVersion: typeof STUDIO_DIRECTOR_COMMAND_SCHEMA_VERSION_V2;
  leaseId: string;
  owner: 'writer' | 'main';
  commandId: string | null;
  reservedAt: string | null;
  deadlineAt: string | null;
  acquiredAt: string;
  expiresAt: string;
};

export type StudioDirectorCommandRejectionCodeV2 =
  | 'malformed_record'
  | 'unsupported_version'
  | 'operation_not_permitted'
  | 'stale_revision'
  | 'future_revision'
  | 'project_not_found'
  | 'beat_capacity_reached'
  | 'beat_shot_capacity_reached'
  | 'project_shot_capacity_reached'
  | 'invalid_shot_duration'
  | 'dependency_blocked'
  | 'identity_collision'
  | 'invalid_operation'
  | 'validation_failed';

export type StudioDirectorAppliedReceiptV2 = {
  schemaVersion: typeof STUDIO_DIRECTOR_COMMAND_SCHEMA_VERSION_V2;
  commandId: string;
  projectId: string;
  expectedRevision: number;
  decidedAt: string;
  status: 'applied';
  appliedRevision: number;
  createdBeatIds: string[];
  createdShotIds: string[];
};

export type StudioDirectorFreeRecoveryAppliedReceiptV2 = {
  schemaVersion: typeof STUDIO_DIRECTOR_COMMAND_SCHEMA_VERSION_V2;
  commandId: string;
  projectId: string;
  expectedRevision: number;
  decidedAt: string;
  status: 'applied';
  appliedRevision: number;
  recovery: StudioDirectorFreeRecoveryV2;
};

/** Durable proof that free preparation recorded one immutable proposal and spent nothing. */
export type StudioDirectorPaidRecoveryRecordedReceiptV2 = {
  schemaVersion: typeof STUDIO_DIRECTOR_COMMAND_SCHEMA_VERSION_V2;
  commandId: string;
  projectId: string;
  expectedRevision: number;
  decidedAt: string;
  status: 'recorded';
  proposal: StudioProposalRecordV2;
};

export type StudioDirectorRejectedReceiptV2 = {
  schemaVersion: typeof STUDIO_DIRECTOR_COMMAND_SCHEMA_VERSION_V2;
  commandId: string;
  projectId: string;
  expectedRevision: number | null;
  decidedAt: string;
  status: 'rejected';
  observedRevision: number | null;
  reasonCode: StudioDirectorCommandRejectionCodeV2;
};

export type StudioDirectorExpiredReceiptV2 = {
  schemaVersion: typeof STUDIO_DIRECTOR_COMMAND_SCHEMA_VERSION_V2;
  commandId: string;
  projectId: string;
  expectedRevision: number;
  decidedAt: string;
  status: 'expired';
  observedRevision: number | null;
  reasonCode: StudioDirectorCommandExpiryCode;
};

export type StudioDirectorIndeterminateReceiptV2 = {
  schemaVersion: typeof STUDIO_DIRECTOR_COMMAND_SCHEMA_VERSION_V2;
  commandId: string;
  projectId: string;
  expectedRevision: number;
  decidedAt: string;
  status: 'indeterminate';
  observedRevision: number | null;
  reasonCode: StudioDirectorCommandIndeterminateCode;
};

export type StudioDirectorQueryFailureCodeV2 =
  | 'project_not_found'
  | 'unsupported_prototype_schema'
  | 'route_inventory_unavailable'
  | 'project_read_unavailable'
  | 'response_too_large'
  | 'result_mismatch';

type StudioDirectorQueryReceiptBaseV2 = {
  schemaVersion: typeof STUDIO_DIRECTOR_COMMAND_SCHEMA_VERSION_V2;
  commandId: string;
  projectId: string;
  decidedAt: string;
};

export type StudioDirectorAnsweredReceiptV2 =
  | (StudioDirectorQueryReceiptBaseV2 & {
      status: 'answered';
      query: Extract<StudioDirectorQueryV2, { kind: 'get_project_status' }>;
      result: StudioProjectStatusV2;
    })
  | (StudioDirectorQueryReceiptBaseV2 & {
      status: 'answered';
      query: Extract<StudioDirectorQueryV2, { kind: 'list_routes' }>;
      result: StudioRouteCatalogV2;
    })
  | (StudioDirectorQueryReceiptBaseV2 & {
      status: 'answered';
      query: Extract<StudioDirectorQueryV2, { kind: 'get_proposal' }>;
      result: StudioDirectorProposalLookupV2;
    });

export type StudioDirectorFailedQueryReceiptV2 = StudioDirectorQueryReceiptBaseV2 & {
  status: 'failed';
  query: StudioDirectorQueryV2;
  reasonCode: StudioDirectorQueryFailureCodeV2;
};

export type StudioDirectorExpiredQueryReceiptV2 = StudioDirectorQueryReceiptBaseV2 & {
  status: 'expired';
  query: StudioDirectorQueryV2;
  reasonCode: StudioDirectorCommandExpiryCode;
};

export type StudioDirectorQueryReceiptV2 =
  | StudioDirectorAnsweredReceiptV2
  | StudioDirectorFailedQueryReceiptV2
  | StudioDirectorExpiredQueryReceiptV2;

export type StudioDirectorMutationReceiptV2 =
  | StudioDirectorAppliedReceiptV2
  | StudioDirectorFreeRecoveryAppliedReceiptV2
  | StudioDirectorRejectedReceiptV2
  | StudioDirectorExpiredReceiptV2
  | StudioDirectorIndeterminateReceiptV2;

export type StudioDirectorCommandReceiptV2 =
  | StudioDirectorMutationReceiptV2
  | StudioDirectorQueryReceiptV2
  | StudioDirectorPaidRecoveryRecordedReceiptV2;

export type StudioBeat = {
  id: string;
  title: string;
  story: string;
  targetSeconds: number | null;
  shotOrder: string[];
};

export type StudioShot = {
  id: string;
  shootingScript: string;
  durationSeconds: number;
  trimInSeconds: number | null;
  trimOutSeconds: number | null;
  chainBreak: 'none' | 'hard_cut';
  referenceBinding: StudioShotReferenceBindingV2;
  seedStillId: string | null;
  /** Retained seed media hidden from the First frames strip without deleting provenance. */
  dismissedSeedStillIds: string[];
  boardAssetId: string | null;
  supersededBoardAssetIds: string[];
  videoAssetId: string | null;
  supersededVideoAssetIds: string[];
  assetIds: string[];
  jobIds: string[];
};

export type StudioReferenceKindV2 = 'character' | 'background';

export type StudioReferenceDraftV2 = {
  kind: StudioReferenceKindV2;
  label: string;
  prompt: string;
};

export type StudioBackgroundReferenceDraftV2 = Omit<StudioReferenceDraftV2, 'kind'> & {
  kind: 'background';
};

/** Durable current-image authority for one project-level reference sheet. */
export type StudioProjectReferenceV2 = StudioReferenceDraftV2 & {
  id: string;
  approvedAssetId: string | null;
  supersededAssetIds: string[];
  jobIds: string[];
  createdAt: string;
  updatedAt: string;
};

export type StudioShotReferenceBindingV2 = {
  status: 'unassigned' | 'ready';
  characterReferenceIds: string[];
  backgroundReferenceId: string | null;
};

export type StudioBinItem =
  | { kind: 'beat'; beatId: string; reason: 'lifted' | 'alternate' }
  | { kind: 'shot'; beatId: string; shotId: string; reason: 'lifted' };

export type StudioProposedShot = {
  shotId: string;
  shootingScript: string;
  durationSeconds: number;
  chainBreak: 'none' | 'hard_cut';
};

export type StudioFixedShotReasonV2 =
  | 'owned_asset'
  | 'owned_job'
  | 'video_asset'
  | 'seed_still'
  | 'conditioning_frame'
  | 'conditioning_input'
  | 'shooting_script';

export type StudioFixedShotReviewV2 = {
  shotId: string;
  reasons: StudioFixedShotReasonV2[];
};

export type StudioCoverageApplyResult = {
  beatId: string;
  createdShotIds: string[];
  retainedShotIds: string[];
  removedShotIds: string[];
  fixedShotIds: string[];
};

export type StudioPlanningShotBoundaryV2 = {
  shotId: string;
  startSeconds: number;
  endSeconds: number;
};

export type StudioConditioningInputSnapshot =
  | { kind: 'seed_still'; assetId: string }
  | {
      kind: 'predecessor_frame';
      predecessorShotId: string;
      takeAssetId: string;
      frameAssetId: string;
      endpointSeconds: number;
    };

export type StudioGenerationReferenceInputSnapshot = {
  referenceId: string;
  kind: StudioReferenceKindV2;
  assetId: string;
  sha256: string;
};

export type StudioGenerationTargetV2 = { kind: 'shot'; shotId: string } | { kind: 'reference'; referenceId: string };

export type StudioGenerationCompositionInputSnapshotV2 = {
  schemaVersion: typeof STUDIO_GENERATION_COMPOSITION_SCHEMA_VERSION;
  projectRevision: number;
  brief: string;
  rules: StudioBriefRule[];
  source:
    | { kind: 'shot'; beatId: string; story: string; shotId: string; shootingScript: string }
    | {
        kind: 'project_reference';
        referenceId: string;
        referenceKind: StudioReferenceKindV2;
        prompt: string;
      };
  purpose: StudioJobPurpose;
  referenceInputs: StudioGenerationReferenceInputSnapshot[];
  aspectRatio: StudioAspectRatio;
  resolution: StudioResolution;
  route: StudioMediaModelRef;
  boardStyle: StudioBoardStyleV2 | null;
  instructionProfile: string;
};

export type StudioGenerationCompositionV2 = {
  inputs: StudioGenerationCompositionInputSnapshotV2;
  prompt: string;
};

/** Frozen spend-review reference facts with hashes and approval internals removed. */
export type StudioRendererReferenceIdentityV2 = {
  referenceId: string;
  kind: StudioReferenceKindV2;
  label: string;
};

export type StudioRendererGenerationReferenceInputV2 = StudioRendererReferenceIdentityV2 & { assetId: string };

export type StudioRendererGenerationCompositionV2 = Omit<StudioGenerationCompositionV2, 'inputs'> & {
  inputs: Omit<StudioGenerationCompositionInputSnapshotV2, 'referenceInputs'> & {
    referenceInputs: StudioRendererGenerationReferenceInputV2[];
  };
};

export type StudioGenerationRequestSnapshot = {
  composition: StudioGenerationCompositionV2;
  aspectRatio: StudioAspectRatio;
  resolution: StudioResolution;
  durationSeconds: number;
  /** Ordered exact approved project-reference assets submitted to the provider. */
  referenceInputs: StudioGenerationReferenceInputSnapshot[];
  conditioningInput: StudioConditioningInputSnapshot | null;
};

export type StudioAuthorizedConditioningDependency =
  | { kind: 'authorized_seed'; upstreamItemId: string; shotId: string }
  | {
      kind: 'authorized_predecessor';
      upstreamItemId: string;
      predecessorShotId: string;
    }
  | {
      kind: 'existing_predecessor';
      predecessorShotId: string;
      takeAssetId: string;
      endpointSeconds: number;
    };

export type StudioGenerationRequestTemplate = Omit<StudioGenerationRequestSnapshot, 'conditioningInput'>;

export type StudioGenerationRequestPlan =
  | { kind: 'resolved'; snapshot: StudioGenerationRequestSnapshot }
  | {
      kind: 'after_take_selection';
      template: StudioGenerationRequestTemplate;
      dependency: StudioAuthorizedConditioningDependency;
    };

export type StudioFrameExtraction = {
  id: string;
  shotId: string;
  videoAssetId: string;
  endpointSeconds: number;
  frameAssetId: string | null;
  status: 'pending' | 'extracting' | 'ready' | 'failed';
  errorCode: 'decode_failed' | 'source_missing' | 'storage_error' | null;
  attemptCount: number;
};

export type StudioSpendPolicy = {
  currency: string;
  maxPerBatchMinorUnits: number;
};

export type StudioQuotedGeneration = {
  id: string;
  target: StudioGenerationTargetV2;
  purpose: StudioJobPurpose;
  routeId: string;
  generationCount: number;
  requestPlan: StudioGenerationRequestPlan;
  rateUnit: 'generation' | 'second';
  rateMinorUnits: number;
};

export type StudioSubmissionQuoteCore = {
  projectId: string;
  projectRevision: number;
  originReferenceHandoffId: string | null;
  rateCardDigest: string;
  currency: string;
  baseItems: StudioQuotedGeneration[];
  cascadeItems: StudioQuotedGeneration[];
  lowerMinorUnits: number;
  upperMinorUnits: number;
};

export type StudioSubmissionQuote = StudioSubmissionQuoteCore & {
  id: string;
  expiresAt: string;
};

export type StudioPrepareGenerationChoiceV2 = {
  target: Extract<StudioGenerationTargetV2, { kind: 'shot' }>;
  purpose: Exclude<StudioJobPurpose, 'reference_image'>;
};

export type StudioPrepareProjectReferencesRequestV2 = {
  projectId: string;
  expectedRevision: number;
  referenceIds: string[];
};

/** Main-owned cached intent; only the ordinary arm is accepted by the generic prepare IPC. */
export type StudioPreparedSubmissionRequestV2 =
  | StudioPrepareSubmissionRequestV2
  | StudioPrepareProjectReferencesRequestV2;

export type StudioContinuityChangeV2 = {
  shotId: string;
  hardCut: boolean;
  /** Renderer route-diagnosis hint. Main recomputes and rejects any mismatch. */
  requiresSeedGeneration: boolean;
};

/** Exact current Board panel that main may promote into the segment's pinned first frame. */
export type StudioBoardPromotionV2 = {
  shotId: string;
  boardAssetId: string;
};

/** Safe pricing classifications that may cross from main to the renderer without diagnostics. */
export const STUDIO_PRICING_REFUSAL_REASONS_V2 = [
  'invalid_quote',
  'inactive_shot',
  'in_flight',
  'duplicate_shot_purpose',
  'invalid_dependency',
  'invalid_prepare_request',
  'invalid_reference',
  'missing_shooting_script',
  'missing_conditioning',
  'unsafe_total',
] as const;

export type StudioPricingRefusalReasonV2 = (typeof STUDIO_PRICING_REFUSAL_REASONS_V2)[number];

export const STUDIO_REFERENCE_BINDING_FAILURE_REASONS_V2 = [
  'unassigned',
  'unknown_reference',
  'wrong_kind',
  'unapproved_reference',
  'missing_asset',
  'capacity_exceeded',
] as const;

export type StudioReferenceBindingFailureReasonV2 = (typeof STUDIO_REFERENCE_BINDING_FAILURE_REASONS_V2)[number];

export type StudioPricingRefusalDetailsV2 = {
  kind: 'reference_binding';
  shotId: string;
  reason: StudioReferenceBindingFailureReasonV2;
};

const STUDIO_PRICING_REFUSAL_REASON_SET_V2: ReadonlySet<string> = new Set(STUDIO_PRICING_REFUSAL_REASONS_V2);
const STUDIO_REFERENCE_BINDING_FAILURE_REASON_SET_V2: ReadonlySet<string> = new Set(
  STUDIO_REFERENCE_BINDING_FAILURE_REASONS_V2
);

export const isStudioPricingRefusalReasonV2 = (value: unknown): value is StudioPricingRefusalReasonV2 =>
  typeof value === 'string' && STUDIO_PRICING_REFUSAL_REASON_SET_V2.has(value);

export const isStudioPricingRefusalDetailsV2 = (value: unknown): value is StudioPricingRefusalDetailsV2 => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    Reflect.ownKeys(record).length === 3 &&
    record.kind === 'reference_binding' &&
    typeof record.shotId === 'string' &&
    /^[A-Za-z0-9_-]{1,256}$/.test(record.shotId) &&
    typeof record.reason === 'string' &&
    STUDIO_REFERENCE_BINDING_FAILURE_REASON_SET_V2.has(record.reason)
  );
};

export type StudioPrepareSubmissionRequestV2 = {
  projectId: string;
  expectedRevision: number;
  originReferenceHandoffId: null;
  baseChoices: StudioPrepareGenerationChoiceV2[];
  /** Empty asks main to derive the canonical optional continuation with one generation per row. */
  cascadeChoices: StudioPrepareGenerationChoiceV2[];
  /** Exact paid continuity review; mutually exclusive with generation choices and reference handoffs. */
  continuityChange?: StudioContinuityChangeV2;
  /** Exact paid Board-promotion review; mutually exclusive with every other submission intent. */
  boardPromotion?: StudioBoardPromotionV2;
};

export type StudioConfirmSubmissionRequestV2 = {
  projectId: string;
  quoteId: string;
  expectedRevision: number;
};

export type StudioConfirmSubmissionResultV2 = {
  projectId: string;
  projectRevision: number;
};

export type StudioSubmissionCacheErrorCodeV2 =
  | 'quote_not_found'
  | 'quote_in_use'
  | 'quote_cache_full'
  | 'quote_too_large';

export type StudioPreparedSubmissionOptionsV2 = {
  baseOnly: StudioSubmissionQuote;
  withCascade: StudioSubmissionQuote | null;
};

export type StudioRendererQuotedGenerationV2 = {
  target: StudioGenerationTargetV2;
  referenceTarget: StudioRendererReferenceIdentityV2 | null;
  purpose: StudioJobPurpose;
  route: StudioRendererMediaModelRef;
  generationCount: number;
  durationSeconds: number | null;
  conditioningAssetId: string | null;
  oneGenerationMinorUnits: number;
  requestedTotalMinorUnits: number;
  composition: StudioRendererGenerationCompositionV2;
};

export type StudioRendererBudgetVerdictV2 =
  | { kind: 'no_policy' }
  | { kind: 'within_cap'; policyCurrency: string; maxPerBatchMinorUnits: number }
  | { kind: 'over_cap'; policyCurrency: string; maxPerBatchMinorUnits: number }
  | { kind: 'currency_mismatch'; policyCurrency: string; maxPerBatchMinorUnits: number };

export type StudioRendererSubmissionQuoteV2 = {
  id: string;
  projectId: string;
  projectRevision: number;
  expiresAt: string;
  currency: string;
  baseItems: StudioRendererQuotedGenerationV2[];
  cascadeItems: StudioRendererQuotedGenerationV2[];
  lowerMinorUnits: number;
  upperMinorUnits: number;
  budget: StudioRendererBudgetVerdictV2;
};

export type StudioRendererPreparedSubmissionOptionsV2 = {
  baseOnly: StudioRendererSubmissionQuoteV2;
  withCascade: StudioRendererSubmissionQuoteV2 | null;
};

export type StudioProposalCommitAttributionV2 = {
  schemaVersion: typeof STUDIO_PROPOSAL_SCHEMA_VERSION_V2;
  kind: 'mutation' | 'paid_recovery';
  proposalId: string;
  projectId: string;
  baseRevision: number;
  appliedRevision: number;
  beforeProjectSha256: string;
  afterProjectSha256: string;
  createdBeatIds: string[];
  createdShotIds: string[];
  authorizationId: string | null;
  decidedAt: string;
};

export type StudioReferenceRequestDecisionV2 = {
  schemaVersion: typeof STUDIO_REFERENCE_REQUEST_SCHEMA_VERSION;
  requestId: string;
  projectId: string;
  decidedAt: string;
  outcome:
    | { kind: 'rejected' }
    | { kind: 'expired' }
    | { kind: 'generation_gate'; handoffId: string; referenceIds: string[] };
};

export type StudioReferenceGenerationHandoffReceiptV2 = {
  schemaVersion: typeof STUDIO_REFERENCE_REQUEST_SCHEMA_VERSION;
  handoffId: string;
  requestId: string;
  completedAt: string;
  result: { kind: 'dismissed' } | { kind: 'confirmed'; authorizationId: string };
};

export type StudioRendererReferenceGenerationHandoffV2 = {
  handoffId: string;
  requestId: string;
  referenceIds: string[];
  decidedAt: string;
  status: 'awaiting_spend' | 'running' | 'succeeded' | 'partially_failed' | 'failed' | 'dismissed';
  counts: { queued: number; running: number; succeeded: number; failed: number };
  resultAssetIds: string[];
  failedReferenceIds: string[];
  completedAt: string | null;
};

export type StudioDismissReferenceGenerationHandoffRequestV2 = {
  projectId: string;
  expectedRevision: number;
  handoffId: string;
};

export type StudioBindDirectorConversationRequestV2 = {
  projectId: string;
  expectedRevision: number;
  conversationId: string;
};

/** Main-minted trust anchors for validating a persisted Director MCP transport without resolving routes. */
export type StudioDirectorSessionAuthorityV2 = {
  serverId: string;
  serverName: string;
  scriptPath: string;
  projectDir: string;
  pendingDir: string;
  referencePendingDir: string;
};

export type StudioDismissReferenceGenerationHandoffResultV2 = {
  status: 'dismissed';
  completedAt: string;
};

export type StudioCascadeProgressV2 = {
  dependentShotId: string;
  upstreamShotId: string;
  eligiblePrimaryAssetIds: string[];
  canRetryConditioningFrame: boolean;
  canCancelWaiting: boolean;
  waitingReason:
    | 'upstream_running'
    | 'choose_seed'
    | 'conditioning_frame'
    | 'conditioning_failed'
    | 'dependency_failed'
    | 'cancelled';
};

export type StudioCascadeBarrierActionRequestV2 = {
  projectId: string;
  expectedRevision: number;
  dependentShotId: string;
};

export type StudioParkBeatRequestV2 = {
  projectId: string;
  expectedRevision: number;
  beatId: string;
};

export type StudioRestoreBeatRequestV2 = StudioParkBeatRequestV2 & { beforeBeatId: string | null };

export type StudioParkShotRequestV2 = {
  projectId: string;
  expectedRevision: number;
  shotId: string;
};

export type StudioRestoreShotRequestV2 = StudioParkShotRequestV2 & { beforeShotId: string | null };

export type StudioReorderBinRequestV2 = {
  projectId: string;
  expectedRevision: number;
  bin: StudioBinItem[];
};

export type StudioImportSeedStillRequestV2 = {
  projectId: string;
  expectedRevision: number;
  shotId: string;
};

export type StudioImportReferenceImageRequestV2 = {
  projectId: string;
  expectedRevision: number;
  referenceId: string;
};

export type StudioImportBedAudioRequestV2 = {
  projectId: string;
  expectedRevision: number;
};

export type StudioDetachBedAudioRequestV2 = StudioImportBedAudioRequestV2 & { assetId: string };
export type StudioSetBedRequestV2 = StudioImportBedAudioRequestV2 & { assetId: string | null };

export type StudioImportManagedMediaResultV2 =
  | { status: 'cancelled' }
  | { status: 'imported'; assetId: string; projectRevision: number };

export type StudioDetachManagedMediaResultV2 = {
  status: 'detached';
  projectRevision: number;
};

export type StudioEditProjectSettingsRequestV2 = {
  projectId: string;
  expectedRevision: number;
  changes: StudioEditableProjectSettingsChanges;
};

export type StudioSetRulesRequestV2 = {
  projectId: string;
  expectedRevision: number;
  rules: StudioBriefRuleDraft[];
};

export type StudioRendererAuthoringOperationV2 = Extract<
  StudioMutationOperationV2,
  {
    kind:
      | 'set_brief'
      | 'add_beat'
      | 'edit_beat'
      | 'reorder_beats'
      | 'add_binned_beat'
      | 'add_shot'
      | 'edit_shot'
      | 'delete_shot'
      | 'reorder_shots'
      | 'set_hard_cut'
      | 'set_seed_still'
      | 'dismiss_seed_still'
      | 'set_reference_plan'
      | 'amend_reference_plan'
      | 'set_reference_label'
      | 'set_reference_prompt'
      | 'select_reference_image'
      | 'remove_reference_image'
      | 'set_shot_reference_binding'
      | 'promote_board_panel'
      | 'trim_shot'
      | 'set_routes'
      | 'set_spend_policy';
  }
>;

export type StudioApplyAuthoringBatchRequestV2 = {
  projectId: string;
  expectedRevision: number;
  operations: StudioRendererAuthoringOperationV2[];
};

export type StudioRendererProjectCommitResultV2 = {
  projectId: string;
  projectRevision: number;
  createdBeatIds: string[];
  createdShotIds: string[];
};

export type StudioUndoLastRequestV2 = {
  projectId: string;
  expectedRevision: number;
  entryId: string;
};

export type StudioRendererChainConditioningFailureV2 = {
  dependentShotId: string;
  reason: 'conditioning_failed';
  canRetry: true;
};

export type StudioRendererChainBoundaryV2 =
  | {
      upstreamShotId: string;
      dependentShotId: string;
      status: 'empty' | 'gone';
      frameAssetId: null;
    }
  | {
      upstreamShotId: string;
      dependentShotId: string;
      status: 'on_disk';
      frameAssetId: string;
    };

export type StudioRendererChainStatusV2 = {
  projectId: string;
  projectRevision: number;
  conditioningFailures: StudioRendererChainConditioningFailureV2[];
  boundaries: StudioRendererChainBoundaryV2[];
};

export type StudioRendererDirtyShotV2 = {
  shotId: string;
  causes: ('continuity_stale' | 'generation_out_of_date')[];
};

export type StudioRendererBoardPanelStaleCauseV2 = 'request_out_of_date' | 'route_out_of_date';

export type StudioRendererBoardPanelStatusV2 = {
  shotId: string;
  assetId: string | null;
  producerJobId: string | null;
  latestJobId: string | null;
  staleCauses: StudioRendererBoardPanelStaleCauseV2[];
};

export type StudioRendererParkBlockerCodeV2 =
  | 'own_nonterminal_job'
  | 'own_pending_frame'
  | 'downstream_nonterminal_job'
  | 'downstream_pending_frame'
  | 'waiting_authorization_dependency'
  | 'bound_nonterminal_request'
  | 'beat_shot_capacity_reached';

export type StudioRendererParkBlockerV2 = {
  shotId: string | null;
  code: StudioRendererParkBlockerCodeV2;
};

export type StudioRendererParkEligibilityV2 = {
  subject: 'beat' | 'shot';
  action: 'park' | 'restore';
  beatId: string;
  shotId: string | null;
  allowed: boolean;
  blockers: StudioRendererParkBlockerV2[];
};

export type StudioRendererWorkspaceStatusV2 = {
  projectId: string;
  projectRevision: number;
  undoTop: StudioRendererUndoTopV2 | null;
  dirtyShots: StudioRendererDirtyShotV2[];
  /** One Board-panel status row per active Shot, in exact film order. */
  boardPanels: StudioRendererBoardPanelStatusV2[];
  cascadeProgress: StudioCascadeProgressV2[];
  /** Exact renderer job identities for each active Shot's latest authorized video generation item. */
  currentVideoJobs: { shotId: string; jobIds: string[] }[];
  parkEligibility: StudioRendererParkEligibilityV2[];
};

export type StudioRendererProjectWorkspaceSnapshotV2 = {
  project: StudioRendererProjectV2;
  workspaceStatus: StudioRendererWorkspaceStatusV2;
  chainStatus: StudioRendererChainStatusV2;
};

export type StudioProjectWorkspaceLoadResultV2 =
  | { status: 'supported'; snapshot: StudioRendererProjectWorkspaceSnapshotV2 }
  | { status: 'unsupported_prototype_schema'; projectId: string }
  | { status: 'not_found'; projectId: string };

export type StudioSpendAuthorization = StudioSubmissionQuote & {
  confirmedAt: string;
  providerBindings: { itemId: string; provider: StudioProviderRef }[];
  idempotencyKeys: { itemId: string; key: string }[];
};

export type StudioSpendReceipt = {
  authorizationId: string;
  itemId: string;
  jobId: string;
  purpose: StudioJobPurpose;
  routeId: string;
  currency: string;
  rateUnit: 'generation' | 'second';
  rateMinorUnits: number;
  durationSeconds: number | null;
  generationCount: number;
  totalMinorUnits: number;
};

export type StudioMediaKindV2 = 'image' | 'video' | 'audio';

export type StudioManagedAssetRefV2 = {
  collection: 'assets' | 'imports' | 'thumbnails' | 'conditioningFrames' | 'boardStills';
  fileName: string;
};

export type StudioAssetV2 = {
  id: string;
  projectId: string;
  shotId: string | null;
  mediaKind: StudioMediaKindV2;
  mimeType: string;
  managedAsset: StudioManagedAssetRefV2;
  byteSize: number;
  sha256: string;
  width?: number;
  height?: number;
  durationSeconds?: number;
  createdAt: string;
  projectReferenceId: string | null;
  /** Exact approved reference assets used to create this generated output, in provider order. */
  generationReferenceAssetIds: string[];
  producerJobId: string | null;
  compositionDigest: string | null;
};

/** Read-only file analysis; this profile is independent from the project schema. */
export const STUDIO_SHOT_AUDIO_ANALYSIS_PROFILE_V1 = 'effective-loudness-v1' as const;
export const STUDIO_EFFECTIVE_SILENCE_MEAN_DBFS_V1 = -45;
export const STUDIO_EFFECTIVE_SILENCE_PEAK_DBFS_V1 = -30;

export type StudioVideoAudioContentAnalysisV2 =
  | {
      status: 'audible' | 'effectively_silent';
      meanVolumeDbfs: number | null;
      peakVolumeDbfs: number | null;
    }
  | {
      status: 'no_audio_stream' | 'unavailable';
      meanVolumeDbfs: null;
      peakVolumeDbfs: null;
    };

export type StudioShotAudioAnalysisRequestV2 = {
  projectId: string;
  expectedRevision: number;
  shots: Array<{ shotId: string; assetId: string }>;
};

export type StudioShotAudioAnalysisV2 = StudioVideoAudioContentAnalysisV2 & {
  shotId: string;
  assetId: string;
};

export type StudioShotAudioAnalysisResultV2 = {
  projectId: string;
  projectRevision: number;
  profile: typeof STUDIO_SHOT_AUDIO_ANALYSIS_PROFILE_V1;
  shots: StudioShotAudioAnalysisV2[];
};

export const STUDIO_EXPORT_SHAPES = ['editor_folder', 'still', 'script', 'film'] as const;
export type StudioExportShapeV2 = (typeof STUDIO_EXPORT_SHAPES)[number];

export type StudioManagedExportRefV2 = {
  collection: 'exports';
  fileName: string;
};

export type StudioFilmExportTransitionV2 = { kind: 'cut' } | { kind: 'dissolve'; seconds: number };
export type StudioFilmRenderedTransitionV2 =
  | { kind: 'cut' }
  | { kind: 'dissolve'; requestedSeconds: number; seconds: number };

export type StudioFilmExportSegmentFactV2 =
  | {
      kind: 'shot';
      shotId: string;
      sourceAssetId: string;
      sourceSha256: string;
      sourceInSeconds: number;
      sourceOutSeconds: number;
      renderedSourceOutSeconds: number;
      normalizedDurationSeconds: number;
      chainBreak: 'none' | 'hard_cut';
      hasAudio: boolean;
    }
  | {
      kind: 'slate';
      beatId: string;
      shotId: string | null;
      durationSeconds: number;
      normalizedDurationSeconds: number;
    };

export type StudioFilmExportFactsV2 = {
  schemaVersion: typeof STUDIO_FILM_EXPORT_FACTS_SCHEMA_VERSION;
  nominalDurationSeconds: number;
  renderedDurationSeconds: number;
  transition: StudioFilmRenderedTransitionV2;
  dissolveCount: number;
  trimTails: boolean;
  segments: StudioFilmExportSegmentFactV2[];
  video: {
    container: 'mp4';
    codec: 'h264';
    encoder: 'h264_videotoolbox' | 'h264_nvenc' | 'h264_qsv' | 'h264_amf' | 'h264_mf';
    profile: 'high';
    level: '4.2';
    width: number;
    height: number;
    frameRate: typeof STUDIO_FILM_EXPORT_FRAME_RATE;
    pixelFormat: 'yuv420p';
    scaleMode: 'contain_black_pad';
    sampleAspectRatio: '1:1';
    colorPrimaries: 'bt709';
    colorTransfer: 'bt709';
    colorSpace: 'bt709';
    colorRange: 'tv';
    gopFrames: 48;
    bitrate: 8_000_000 | 12_000_000;
    trackTimeBase: '1/24000';
    metadataStripped: true;
    chaptersStripped: true;
    fastStart: false;
  };
  audio: {
    codec: 'aac';
    sampleRate: typeof STUDIO_FILM_EXPORT_AUDIO_SAMPLE_RATE;
    channels: typeof STUDIO_FILM_EXPORT_AUDIO_CHANNELS;
    channelLayout: 'stereo';
    sampleFormat: 'fltp';
    bitrate: 192_000;
    silenceForMissingStreams: true;
    takeGain: number;
    bedAssetId: string | null;
    bedSha256: string | null;
    bedGain: number | null;
    bedFadeOutSeconds: number | null;
    bedFadeCurve: 'triangular' | null;
    dissolveCrossfade: boolean;
    dissolveCurve: 'triangular';
    limiterPeak: 0.95;
    limiterLatencyCompensated: true;
  };
};

type StudioExportArtifactBaseV2 = {
  schemaVersion: typeof STUDIO_EXPORT_SCHEMA_VERSION_V2;
  id: string;
  projectId: string;
  sourceRevision: number;
  payloadKind: 'directory' | 'file';
  managedExport: StudioManagedExportRefV2;
  byteSize: number;
  payloadFileCount: number;
  manifestSha256: string;
  createdAt: string;
};

export type StudioExportArtifactV2 =
  | (StudioExportArtifactBaseV2 & {
      shape: Exclude<StudioExportShapeV2, 'film'>;
    })
  | (StudioExportArtifactBaseV2 & {
      shape: 'film';
      payloadKind: 'file';
      film: StudioFilmExportFactsV2;
    });

export type StudioExportCatalogV2 = {
  schemaVersion: typeof STUDIO_EXPORT_SCHEMA_VERSION_V2;
  projectId: string;
  revision: number;
  artifacts: StudioExportArtifactV2[];
};

type StudioRendererExportArtifactBaseV2 = Pick<
  StudioExportArtifactBaseV2,
  'id' | 'sourceRevision' | 'byteSize' | 'payloadFileCount' | 'createdAt'
> & { folderName: string };

export type StudioRendererExportArtifactV2 =
  | (StudioRendererExportArtifactBaseV2 & { shape: Exclude<StudioExportShapeV2, 'film'> })
  | (StudioRendererExportArtifactBaseV2 & {
      shape: 'film';
      film: {
        nominalDurationSeconds: number;
        renderedDurationSeconds: number;
        transition: StudioFilmRenderedTransitionV2;
        trimTails: boolean;
        trimmedShotCount: number;
      };
    });

export type StudioRendererExportCatalogV2 = {
  revision: number;
  artifacts: StudioRendererExportArtifactV2[];
};

export type StudioExportArtifactRequestV2 = {
  projectId: string;
  expectedCatalogRevision: number;
  artifactId: string;
};

export type StudioCopyExportResultV2 = { status: 'cancelled' } | { status: 'copied' };
export type StudioRevealExportResultV2 = { status: 'revealed' };

export type StudioFilmExportCapabilityV2 =
  | {
      status: 'ready';
      encoder: StudioFilmExportFactsV2['video']['encoder'];
    }
  | {
      status: 'unavailable';
      reason: 'ffmpeg_unavailable' | 'ffprobe_unavailable' | 'unsupported_capabilities';
    };

export type StudioFilmExportCapabilityRequestV2 = { projectId: string };

export type StudioFilmExportProgressV2 = {
  projectId: string;
  renderId: string;
  phase: 'preparing' | 'analyzing' | 'rendering' | 'publishing';
  progress: number | null;
};

/** Reports the single global render so every project can fail closed while that resource is occupied. */
export type StudioFilmExportStatusRequestV2 = { projectId: string };
export type StudioFilmExportTerminalResultV2 =
  | {
      projectId: string;
      renderId: string;
      outcome: 'succeeded';
      artifact: Extract<StudioRendererExportArtifactV2, { shape: 'film' }>;
      movedAsideCount: number;
    }
  | {
      projectId: string;
      renderId: string;
      outcome: 'failed';
      reason: 'stale_project' | 'stale_export_catalog' | 'invalid_media' | 'unavailable' | 'render_failed';
    }
  | { projectId: string; renderId: string; outcome: 'cancelled' };
export type StudioFilmExportStatusV2 =
  | { status: 'idle' }
  | { status: 'active'; progress: StudioFilmExportProgressV2 }
  | { status: 'terminal'; result: StudioFilmExportTerminalResultV2 };
export type StudioCancelFilmExportRequestV2 = { projectId: string; renderId: string };
export type StudioCancelFilmExportResultV2 = {
  status: 'cancelled' | 'cancellation_refused' | 'not_found';
};
export type StudioAcknowledgeFilmExportRequestV2 = { projectId: string; renderId: string };
export type StudioAcknowledgeFilmExportResultV2 = { status: 'acknowledged' | 'not_found' };

export type StudioCreateExportRequestV2 =
  | { projectId: string; expectedRevision: number; expectedCatalogRevision: number; shape: 'editor_folder' }
  | {
      projectId: string;
      expectedRevision: number;
      expectedCatalogRevision: number;
      shape: 'still';
      shotId: string;
    }
  | { projectId: string; expectedRevision: number; expectedCatalogRevision: number; shape: 'script' }
  | {
      projectId: string;
      expectedRevision: number;
      expectedCatalogRevision: number;
      shape: 'film';
      renderId: string;
      transition: StudioFilmExportTransitionV2;
      trimTails: boolean;
    };

export type StudioListExportsRequestV2 = { projectId: string };

export type StudioEditorFolderTimelineEntryV2 =
  | {
      kind: 'shot';
      shotOrdinal: number;
      shotId: string;
      videoAssetId: string;
      relativePath: string;
      timelineStartSeconds: number;
      sourceInSeconds: number;
      sourceOutSeconds: number;
      durationSeconds: number;
      chainBreak: 'none' | 'hard_cut';
    }
  | {
      kind: 'slate';
      shotOrdinal: number | null;
      shotId: string | null;
      relativePath: 'media/slate.png';
      timelineStartSeconds: number;
      durationSeconds: number;
    };

export type StudioEditorFolderTimelineBeatV2 = {
  beatId: string;
  title: string;
  timelineStartSeconds: number;
  durationSeconds: number;
  entries: StudioEditorFolderTimelineEntryV2[];
};

export type StudioEditorFolderTimelineV2 = {
  schemaVersion: typeof STUDIO_EXPORT_SCHEMA_VERSION_V2;
  projectId: string;
  sourceRevision: number;
  name: string;
  aspectRatio: StudioAspectRatio;
  resolution: StudioResolution;
  durationSeconds: number;
  beats: StudioEditorFolderTimelineBeatV2[];
  bed: null | {
    assetId: string;
    relativePath: string;
    sourceInSeconds: 0;
    sourceOutSeconds: number;
    fadeOutStartSeconds: number;
    fadeOutEndSeconds: number;
  };
};

export type StudioJobOutputAssetIdsByRoleV2 = {
  primary: string | null;
  poster: string | null;
};

export type StudioJobStatusV2 = StudioJobStatus | 'waiting_for_conditioning';

export type StudioJobErrorV2 = Omit<StudioJobError, 'code'> & {
  code: StudioJobErrorCode | 'dependency_failed';
};

export type StudioJobV2 = {
  id: string;
  projectId: string;
  target: StudioGenerationTargetV2;
  status: StudioJobStatusV2;
  provider: StudioProviderRef;
  idempotencyKey: string;
  providerJobId: string | null;
  /** Set once when providerJobId becomes durable. */
  remoteStartedAt?: string | null;
  cancellationPolicy: StudioCancellationPolicy;
  outputAssetIds: string[];
  error: StudioJobErrorV2 | null;
  progress?: number;
  retryOfJobId: string | null;
  retryReason: StudioJobRetryReason | null;
  duplicateChargeAcknowledged: boolean;
  duplicateChargeAcknowledgedAt: string | null;
  createdAt: string;
  updatedAt: string;
  purpose: StudioJobPurpose;
  authorizationId: string;
  authorizationItemId: string;
  composition: StudioGenerationCompositionV2;
  requestPlan: StudioGenerationRequestPlan;
  requestSnapshot: StudioGenerationRequestSnapshot | null;
  spendReceipt: StudioSpendReceipt | null;
  outputAssetIdsByRole: StudioJobOutputAssetIdsByRoleV2;
};

export type StudioRendererSpendReceiptV2 = Pick<
  StudioSpendReceipt,
  | 'purpose'
  | 'routeId'
  | 'currency'
  | 'rateUnit'
  | 'rateMinorUnits'
  | 'durationSeconds'
  | 'generationCount'
  | 'totalMinorUnits'
>;

export type StudioRendererUndoTopV2 = {
  entryId: string;
  label: string;
  sourceRevision: number;
};

export type StudioRendererJobV2 = Omit<
  StudioJobV2,
  | 'provider'
  | 'idempotencyKey'
  | 'providerJobId'
  | 'remoteStartedAt'
  | 'cancellationPolicy'
  | 'authorizationId'
  | 'authorizationItemId'
  | 'requestPlan'
  | 'requestSnapshot'
  | 'spendReceipt'
> & {
  provider: StudioRendererMediaModelRef;
  canCancel: boolean;
  /** True only when retry reuses an existing provider attempt or acknowledges an unknown submission. */
  canRetry: boolean;
  canRetryDownload: boolean;
  spendReceipt: StudioRendererSpendReceiptV2 | null;
};

export type StudioUndoPatch =
  | {
      kind: 'project_fields';
      before: {
        name: string;
        aspectRatio: StudioAspectRatio;
        resolution: StudioResolution;
        targetDurationSeconds: number;
        boardStyle: StudioBoardStyleV2 | null;
        brief: string;
        rules: StudioBriefRule[];
        beatOrder: string[];
        imageRouteId: string | null;
        videoRouteId: string | null;
        spendPolicy: StudioSpendPolicy | null;
        bedAssetId: string | null;
      };
      afterDigest: string;
    }
  | {
      kind: 'reference_catalog';
      before: Pick<StudioProjectV2, 'referencePlanStatus' | 'referenceOrder' | 'references'>;
      afterDigest: string;
    }
  | { kind: 'beat_fields'; beatId: string; before: StudioBeat | null; afterDigest: string }
  | {
      kind: 'shot_fields';
      shotId: string;
      before: Omit<StudioShot, 'assetIds' | 'jobIds'> | null;
      beforeBeatId: string | null;
      beforeIndex: number | null;
      afterDigest: string;
    }
  | { kind: 'bin'; before: StudioBinItem[]; afterDigest: string };

export type StudioUndoEntry = {
  id: string;
  sourceRevision: number;
  label: string;
  patches: StudioUndoPatch[];
};

export type StudioMutationReducerContextV2 = {
  mutationId: string;
  capturedAt: string;
};

export type StudioEditableBeat = Pick<StudioBeat, 'title' | 'story' | 'targetSeconds'>;

export type StudioEditableShot = Pick<StudioShot, 'shootingScript' | 'durationSeconds'>;

export type StudioNonEmptyPartial<T> = {
  [Key in keyof T]-?: Required<Pick<T, Key>> & Partial<Omit<T, Key>>;
}[keyof T];

export type StudioEditableBeatChanges = StudioNonEmptyPartial<StudioEditableBeat>;
export type StudioEditableShotChanges = StudioNonEmptyPartial<StudioEditableShot>;

export type StudioEditableProjectSettings = Pick<
  StudioProjectV2,
  'name' | 'aspectRatio' | 'resolution' | 'targetDurationSeconds' | 'boardStyle'
>;
export type StudioEditableProjectSettingsChanges = StudioNonEmptyPartial<StudioEditableProjectSettings>;

export type StudioProjectV2 = {
  schemaVersion: typeof STUDIO_PROJECT_SCHEMA_VERSION;
  revision: number;
  id: string;
  name: string;
  brief: string;
  rules: StudioBriefRule[];
  forgeProjectId?: string;
  briefConversationId?: string | null;
  aspectRatio: StudioAspectRatio;
  targetDurationSeconds: number;
  resolution: StudioResolution;
  boardStyle: StudioBoardStyleV2 | null;
  beatOrder: string[];
  beats: Record<string, StudioBeat>;
  shots: Record<string, StudioShot>;
  referencePlanStatus: 'unplanned' | 'planned';
  referenceOrder: string[];
  references: Record<string, StudioProjectReferenceV2>;
  bin: StudioBinItem[];
  bedAssetId: string | null;
  spendPolicy: StudioSpendPolicy | null;
  spendAuthorizations: StudioSpendAuthorization[];
  frameExtractions: Record<string, StudioFrameExtraction>;
  undoHistory: StudioUndoEntry[];
  imageRouteId: string | null;
  videoRouteId: string | null;
  assets: Record<string, StudioAssetV2>;
  jobs: Record<string, StudioJobV2>;
  createdAt: string;
  updatedAt: string;
};

export type StudioRendererProjectV2 = Omit<
  StudioProjectV2,
  'jobs' | 'spendAuthorizations' | 'frameExtractions' | 'undoHistory'
> & {
  jobs: Record<string, StudioRendererJobV2>;
};

export type StudioProjectSummaryV2 = {
  id: string;
  name: string;
  forgeProjectId?: string;
  aspectRatio: StudioAspectRatio;
  targetDurationSeconds: number;
  resolution: StudioResolution;
  beatCount: number;
  shotCount: number;
  pictureCount: number;
  poster?: {
    beatId: string;
    shotId: string;
    assetId: string;
    beatPosition: number;
    shotPosition: number;
  };
  createdAt: string;
  updatedAt: string;
};

export type CreateStudioProjectInputV2 = {
  name: string;
  brief: string;
  forgeProjectId?: string;
  aspectRatio: StudioAspectRatio;
  targetDurationSeconds: number;
  resolution: StudioResolution;
};

/**
 * Inactive Creative Studio 4 Pilot contracts.
 *
 * These discriminators are intentionally separate from the schema-5 constants above. Phase 1
 * freezes the new shapes without widening any production schema-5 union or switching a live
 * reader/writer to the new contract.
 */
export const STUDIO_PROJECT_SCHEMA_VERSION_V3 = 6 as const;
export const STUDIO_MUTATION_BATCH_SCHEMA_VERSION_V3 = 6 as const;
export const STUDIO_GENERATION_COMPOSITION_SCHEMA_VERSION_V3 = 2 as const;
export const STUDIO_EXPORT_SCHEMA_VERSION_V3 = 3 as const;
export const STUDIO_AUTHORING_FINGERPRINT_VERSION_V3 = 1 as const;
export const STUDIO_MAX_PIECES_V3 = 96;
export const STUDIO_MAX_PIECE_HANDLE_SCALARS_V3 = 48;
export const STUDIO_MAX_PIECE_HANDLE_UTF8_BYTES_V3 = 192;
export const STUDIO_MAX_PIECE_PRIOR_HANDLES_V3 = 20;
export const STUDIO_MAX_JOBS_PER_PIECE_V3 = 32;
export const STUDIO_MAX_ASSETS_V3 = STUDIO_MAX_PIECES_V3;
export const STUDIO_MAX_JOBS_V3 = STUDIO_MAX_PIECES_V3 * STUDIO_MAX_JOBS_PER_PIECE_V3;
export const STUDIO_MAX_SPEND_AUTHORIZATIONS_V3 = STUDIO_MAX_JOBS_V3;
export const STUDIO_MAX_UNDO_ENTRIES_V3 = 20;
/** Schema-6 owns this limit; later schema-5 changes must not silently alter the Pilot contract. */
export const STUDIO_MAX_IMAGE_ASSET_BYTES_V3 = 50 * 1024 * 1024;
/** Export-3 retains the five newest immutable artifacts for each Piece. */
export const STUDIO_MAX_PIECE_EXPORTS_PER_PIECE_V3 = 5;
export const STUDIO_MAX_PIECE_EXPORTS_PER_PROJECT_V3 = STUDIO_MAX_PIECES_V3 * STUDIO_MAX_PIECE_EXPORTS_PER_PIECE_V3;

export type StudioPieceKindV2 = 'photograph';
export type StudioPieceImagePurposeV3 = 'piece_image';
export type StudioPieceGenerationTargetV3 = { kind: 'piece'; pieceId: string };

export type StudioPiecePhotoSettingsV3 = {
  aspectRatio: StudioAspectRatio;
  resolution: StudioResolution;
};

export type StudioPieceGenerationSourceV3 = {
  kind: 'piece';
  pieceId: string;
  words: string;
  settings: StudioPiecePhotoSettingsV3;
};

export type StudioPieceGenerationCompositionInputSnapshotV3 = {
  schemaVersion: typeof STUDIO_GENERATION_COMPOSITION_SCHEMA_VERSION_V3;
  projectRevisionAtPreparation: number;
  authoringRevision: number;
  authoringFingerprintVersion: typeof STUDIO_AUTHORING_FINGERPRINT_VERSION_V3;
  authoringFingerprint: string;
  brief: string;
  rules: StudioBriefRule[];
  source: StudioPieceGenerationSourceV3;
  purpose: StudioPieceImagePurposeV3;
  conditioningInputs: [];
  route: StudioMediaModelRef;
  instructionProfile: string;
};

/** The prompt is immutable historical provider input and is never validated by recomposition. */
export type StudioPieceGenerationCompositionV3 = {
  inputs: StudioPieceGenerationCompositionInputSnapshotV3;
  prompt: string;
};

export type StudioPieceGenerationRequestSnapshotV3 = {
  composition: StudioPieceGenerationCompositionV3;
  settings: StudioPiecePhotoSettingsV3;
  conditioningInputs: [];
};

export type StudioPieceGenerationRequestPlanV3 = {
  kind: 'resolved';
  snapshot: StudioPieceGenerationRequestSnapshotV3;
};

export type StudioPieceQuotedGenerationV3 = {
  id: string;
  target: StudioPieceGenerationTargetV3;
  purpose: StudioPieceImagePurposeV3;
  routeId: string;
  generationCount: 1;
  requestPlan: StudioPieceGenerationRequestPlanV3;
  rateUnit: 'generation';
  rateMinorUnits: number;
};

export type StudioPieceSubmissionQuoteV3 = {
  id: string;
  reservationId: string;
  quoteRevision: number;
  projectId: string;
  projectRevisionAtPreparation: number;
  authoringRevision: number;
  authoringFingerprintVersion: typeof STUDIO_AUTHORING_FINGERPRINT_VERSION_V3;
  authoringFingerprint: string;
  rateCardDigest: string;
  currency: string;
  item: StudioPieceQuotedGenerationV3;
  lowerMinorUnits: number;
  upperMinorUnits: number;
  expiresAt: string;
};

export type StudioPieceSpendAuthorizationV3 = {
  id: string;
  quote: StudioPieceSubmissionQuoteV3;
  confirmedAt: string;
  projectRevisionAtAuthorization: number;
  cancellationPolicy: StudioCancellationPolicy;
  providerBinding: {
    itemId: string;
    provider: StudioProviderRef;
  };
  idempotencyKey: {
    itemId: string;
    key: string;
  };
};

export type StudioPieceSpendReceiptV3 = {
  authorizationId: string;
  quoteId: string;
  quoteRevision: number;
  itemId: string;
  jobId: string;
  purpose: StudioPieceImagePurposeV3;
  routeId: string;
  currency: string;
  rateUnit: 'generation';
  rateMinorUnits: number;
  generationCount: 1;
  totalMinorUnits: number;
  recordedAt: string;
};

export type StudioPieceJobRetryReasonV3 = 'provider_failure' | 'submission_unknown' | 'variation_grid' | 'cancelled';

export type StudioPieceJobErrorCodeV3 =
  | 'invalid_request'
  | 'content_rejected'
  | 'auth'
  | 'quota'
  | 'rate_limited'
  | 'provider_unavailable'
  | 'timeout'
  | 'poll_deadline'
  | 'no_output'
  | 'variation_grid'
  | 'submission_unknown'
  | 'download_failed'
  | 'unsupported'
  | 'unknown';

export type StudioPieceJobErrorV3 = {
  code: StudioPieceJobErrorCodeV3;
  messageKey: string;
};

/** Durable authority for interpreting the provider submit result without provider-id sentinels. */
export type StudioPieceProviderSubmissionKindV3 = 'complete' | 'remote';

export type StudioPieceJobV3 = {
  id: string;
  projectId: string;
  target: StudioPieceGenerationTargetV3;
  purpose: StudioPieceImagePurposeV3;
  status: StudioJobStatus;
  provider: StudioProviderRef;
  idempotencyKey: string;
  providerSubmissionKind: StudioPieceProviderSubmissionKindV3 | null;
  providerJobId: string | null;
  remoteStartedAt: string | null;
  cancellationPolicy: StudioCancellationPolicy;
  outputAssetId: string | null;
  error: StudioPieceJobErrorV3 | null;
  progress: number | null;
  retryOfJobId: string | null;
  retryReason: StudioPieceJobRetryReasonV3 | null;
  duplicateChargeAcknowledged: boolean;
  duplicateChargeAcknowledgedAt: string | null;
  authorizationId: string;
  authorizationItemId: string;
  composition: StudioPieceGenerationCompositionV3;
  requestPlan: StudioPieceGenerationRequestPlanV3;
  spendReceipt: StudioPieceSpendReceiptV3 | null;
  authoringRevision: number;
  authoringFingerprintVersion: typeof STUDIO_AUTHORING_FINGERPRINT_VERSION_V3;
  authoringFingerprint: string;
  projectRevisionAtPreparation: number;
  projectRevisionAtAuthorization: number;
  createdAt: string;
  updatedAt: string;
};

type StudioPieceAssetBaseV3 = {
  id: string;
  projectId: string;
  pieceId: string;
  mediaKind: 'image';
  mimeType: string;
  byteSize: number;
  sha256: string;
  width: number;
  height: number;
  createdAt: string;
};

export type StudioPieceImportedAssetV3 = StudioPieceAssetBaseV3 & {
  origin: 'imported';
  managedAsset: { collection: 'imports'; fileName: string };
  producerJobId: null;
  compositionDigest: null;
};

export type StudioPieceGeneratedAssetV3 = StudioPieceAssetBaseV3 & {
  origin: 'generated';
  managedAsset: { collection: 'assets'; fileName: string };
  producerJobId: string;
  compositionDigest: string;
};

export type StudioAssetV3 = StudioPieceImportedAssetV3 | StudioPieceGeneratedAssetV3;

export type StudioPieceV2 = {
  id: string;
  kind: StudioPieceKindV2;
  handle: string;
  priorHandles: string[];
  currentAssetId: string | null;
  jobIds: string[];
  createdAt: string;
  updatedAt: string;
};

export type StudioPieceCatalogUndoPatchV3 = {
  kind: 'piece_catalog';
  pieceId: string;
  before: {
    handle: string;
    priorHandles: string[];
  };
  /** Digest of the complete ordered Piece handle/alias namespace after the mutation. */
  afterDigest: string;
};

export type StudioUndoEntryV3 = {
  id: string;
  sourceRevision: number;
  sourceAuthoringRevision: number;
  label: string;
  patches: StudioPieceCatalogUndoPatchV3[];
};

export type StudioProjectV3 = {
  schemaVersion: typeof STUDIO_PROJECT_SCHEMA_VERSION_V3;
  revision: number;
  authoringRevision: number;
  id: string;
  name: string;
  brief: string;
  rules: StudioBriefRule[];
  forgeProjectId: string | null;
  briefConversationId: string | null;
  pieceOrder: string[];
  pieces: Record<string, StudioPieceV2>;
  spendPolicy: StudioSpendPolicy | null;
  spendAuthorizations: StudioPieceSpendAuthorizationV3[];
  undoHistory: StudioUndoEntryV3[];
  assets: Record<string, StudioAssetV3>;
  jobs: Record<string, StudioPieceJobV3>;
  createdAt: string;
  updatedAt: string;
};

export type CreateStudioProjectInputV3 = {
  name: string;
  brief: string;
  forgeProjectId?: string;
};

export type StudioPieceReservationLineageJobV3 = {
  jobId: string;
  retryOfJobId: string | null;
  retryReason: StudioPieceJobRetryReasonV3 | null;
};

type StudioPreparedPhotoReservationBaseV3 = {
  reservationId: string;
  projectId: string;
  targetPieceId: string;
  jobId: string;
  authorizationId: string;
  authorizationItemId: string;
  idempotencyKey: string;
  words: string;
  settings: StudioPiecePhotoSettingsV3;
  provider: StudioProviderRef;
  cancellationPolicy: StudioCancellationPolicy;
  quote: StudioPieceSubmissionQuoteV3;
  authoringRevision: number;
  authoringFingerprintVersion: typeof STUDIO_AUTHORING_FINGERPRINT_VERSION_V3;
  authoringFingerprint: string;
  projectRevisionAtPreparation: number;
  preparedAt: string;
  expiresAt: string;
};

export type StudioPreparedPhotoReservationV3 =
  | (StudioPreparedPhotoReservationBaseV3 & {
      mode: 'create';
      proposedHandle: string;
      orderIndex: number;
    })
  | (StudioPreparedPhotoReservationBaseV3 & {
      mode: 'retry';
      sourceJobId: string;
      lineage: StudioPieceReservationLineageJobV3[];
      retryReason: StudioPieceJobRetryReasonV3;
    });

type StudioRendererPreparedPhotoQuoteBaseV3 = {
  reservationId: string;
  projectId: string;
  quoteId: string;
  quoteRevision: number;
  targetPieceId: string;
  words: string;
  settings: StudioPiecePhotoSettingsV3;
  currency: string;
  lowerMinorUnits: number;
  upperMinorUnits: number;
  spendPolicyClassification: 'within_cap' | 'no_policy' | 'currency_mismatch' | 'over_cap';
  expiresAt: string;
  requiresExplicitHumanAction: boolean;
  duplicateChargeAcknowledgementRequired: boolean;
};

export type StudioRendererPreparedPhotoQuoteV3 =
  | (StudioRendererPreparedPhotoQuoteBaseV3 & {
      mode: 'create';
      proposedHandle: string;
    })
  | (StudioRendererPreparedPhotoQuoteBaseV3 & {
      mode: 'retry';
      proposedHandle: null;
    });

export type StudioConfirmPreparedPhotoRequestV3 = {
  reservationId: string;
  quoteId: string;
  quoteRevision: number;
  explicitHumanConfirmation: boolean;
  duplicateChargeAcknowledged: boolean;
};

export type StudioMutationOperationV3 =
  | { kind: 'edit_project'; name: string }
  | { kind: 'set_brief'; brief: string }
  | { kind: 'set_rules'; rules: StudioBriefRuleDraft[] }
  | { kind: 'set_spend_policy'; policy: StudioSpendPolicy | null }
  | { kind: 'rename_piece'; pieceId: string; handle: string }
  | { kind: 'undo_last'; entryId: string };

export type StudioMutationBatchV3 = {
  schemaVersion: typeof STUDIO_MUTATION_BATCH_SCHEMA_VERSION_V3;
  projectId: string;
  expectedAuthoringRevision: number;
  operations: StudioMutationOperationV3[];
};

export type StudioMutationBatchResultV3 = {
  projectId: string;
  revision: number;
  authoringRevision: number;
};

/** Public Pilot naming keeps the one existing exact schema-6 mutation batch contract. */
export type StudioApplyMutationBatchRequestV3 = StudioMutationBatchV3;
export type StudioApplyMutationBatchResultV3 = StudioMutationBatchResultV3;

export type StudioRendererPieceCurrentProvenanceV3 =
  | {
      origin: 'imported';
      createdAt: string;
    }
  | {
      origin: 'generated';
      createdAt: string;
      producerJobId: string;
      model: string;
      instructionProfile: string;
      recordedSpend: {
        currency: string;
        totalMinorUnits: number;
      };
    };

export type StudioRendererPieceAssetV3 = {
  id: string;
  mediaKind: 'image';
  mimeType: string;
  width: number;
  height: number;
  byteSize: number;
  provenance: StudioRendererPieceCurrentProvenanceV3;
};

export type StudioRendererPieceV3 = {
  id: string;
  kind: StudioPieceKindV2;
  handle: string;
  priorHandles: string[];
  currentAsset: StudioRendererPieceAssetV3 | null;
  state: 'queued' | 'running' | 'needs_attention' | 'failed' | 'cancelled' | 'current';
};

export type StudioRendererCanvasInventoryV3 = {
  projectId: string;
  revision: number;
  authoringRevision: number;
  pieces: StudioRendererPieceV3[];
};

export type StudioRendererPieceActivityJobV3 = {
  jobId: string;
  pieceId: string;
  status: StudioJobStatus;
  progress: number | null;
  error: StudioPieceJobErrorV3 | null;
  canCancel: boolean;
  canRetry: boolean;
  canRetryDownload: boolean;
  canResume: boolean;
  recordedSpend: null | {
    currency: string;
    totalMinorUnits: number;
  };
};

export type StudioRendererCapabilityActivityV3 = {
  projectId: string;
  preparedPhotoQuotes: StudioRendererPreparedPhotoQuoteV3[];
  jobs: StudioRendererPieceActivityJobV3[];
};

export type StudioPieceExportGeneratedProvenanceV3 = {
  origin: 'generated';
  producerJobId: string;
  provider: StudioProviderRef;
  composition: StudioPieceGenerationCompositionV3;
  requestPlan: StudioPieceGenerationRequestPlanV3;
  authorizationId: string;
  quoteId: string;
  quoteRevision: number;
  receipt: StudioPieceSpendReceiptV3;
};

export type StudioPieceExportProvenanceV3 = { origin: 'imported' } | StudioPieceExportGeneratedProvenanceV3;

export type StudioPieceExportManifestV3 = {
  schemaVersion: typeof STUDIO_EXPORT_SCHEMA_VERSION_V3;
  exportId: string;
  projectId: string;
  sourceRevision: number;
  piece: {
    id: string;
    kind: StudioPieceKindV2;
    handleAtExport: string;
  };
  asset: {
    id: string;
    sha256: string;
    mimeType: string;
    byteSize: number;
    width: number;
    height: number;
    createdAt: string;
    relativePath: string;
  };
  provenance: StudioPieceExportProvenanceV3;
  exportedAt: string;
};

/** Exact renderer/Director input for creating a schema-6 Pilot project. Main mints its identity. */
export type StudioCreateProjectRequestV3 = {
  name: string;
  brief: string;
};

/** Exact create-photo preparation input. Route, price, and every durable identity remain Main-owned. */
export type StudioPreparePhotoRequestV3 = {
  mode: 'create';
  projectId: string;
  expectedAuthoringRevision: number;
  words: string;
  settings: StudioPiecePhotoSettingsV3;
  suggestedHandle: string | null;
};

/** Exact same-Piece retry preparation input; words and settings are copied from the predecessor. */
export type StudioRetryPieceJobRequestV3 = {
  mode: 'retry';
  projectId: string;
  expectedAuthoringRevision: number;
  pieceId: string;
  sourceJobId: string;
};

export type StudioPreparePhotoIntentV3 = StudioPreparePhotoRequestV3 | StudioRetryPieceJobRequestV3;

/** Native-picker import input. No renderer path or caller-minted identity is accepted. */
export type StudioImportPhotoRequestV3 = {
  projectId: string;
  expectedAuthoringRevision: number;
};

/** Runtime cancellation targets immutable ownership rather than renderer-supplied storage revision. */
export type StudioCancelPieceJobRequestV3 = {
  projectId: string;
  pieceId: string;
  jobId: string;
};

/** Same-Job recovery for paid output bytes; it cannot mint a quote, authorization, or replacement Job. */
export type StudioRetryPieceDownloadRequestV3 = {
  projectId: string;
  pieceId: string;
  jobId: string;
  expectedRevision: number;
};

/** Same-provider-Job status recovery after a bounded poll deadline. */
export type StudioResumePieceJobRequestV3 = {
  projectId: string;
  pieceId: string;
  jobId: string;
  expectedRevision: number;
};

/** Creates one managed export-3 artifact for the exact current image of one Piece. */
export type StudioExportPieceRequestV3 = {
  projectId: string;
  pieceId: string;
  expectedRevision: number;
  expectedCatalogRevision: number;
};

/** Healthy deletion uses decoded revision authority; unreadable deletion uses an opaque Main claim. */
export type StudioDeleteProjectRequestV3 =
  | {
      mode: 'healthy';
      projectId: string;
      expectedRevision: number;
    }
  | {
      mode: 'unreadable';
      projectId: string;
      deletionClaim: string;
    };

export type StudioProjectSummaryV3 = {
  id: string;
  name: string;
  pieceCount: number;
  currentPieceCount: number;
  createdAt: string;
  updatedAt: string;
};

type StudioUnreadableProjectLibraryEntryV3 = {
  projectId: string;
  deletionClaim: string;
  deletionClaimExpiresAt: string;
};

export type StudioProjectLibraryEntryV3 =
  | { status: 'supported'; summary: StudioProjectSummaryV3 }
  | (StudioUnreadableProjectLibraryEntryV3 & { status: 'unsupported' | 'quarantined' });

export type StudioProjectListResultV3 = {
  entries: StudioProjectLibraryEntryV3[];
};

export type StudioProjectLoadResultV3 =
  | {
      status: 'supported';
      summary: StudioProjectSummaryV3;
      canvas: StudioRendererCanvasInventoryV3;
      activity: StudioRendererCapabilityActivityV3;
    }
  | (StudioUnreadableProjectLibraryEntryV3 & { status: 'unsupported' | 'quarantined' })
  | { status: 'not_found'; projectId: string };

export type StudioCreateProjectResultV3 = {
  status: 'created';
  summary: StudioProjectSummaryV3;
};

export type StudioPreparePhotoResultV3 = {
  status: 'prepared';
  quote: StudioRendererPreparedPhotoQuoteV3;
};

export type StudioRetryPieceJobResultV3 = StudioPreparePhotoResultV3;

export type StudioConfirmPreparedPhotoResultV3 = {
  status: 'queued';
  projectId: string;
  pieceId: string;
  jobId: string;
  revision: number;
  authoringRevision: number;
};

export type StudioImportPhotoResultV3 =
  | { status: 'cancelled' }
  | {
      status: 'imported';
      projectId: string;
      pieceId: string;
      assetId: string;
      revision: number;
      authoringRevision: number;
    };

export type StudioCancelPieceJobResultV3 = {
  status: 'cancelled';
  projectId: string;
  pieceId: string;
  jobId: string;
  revision: number;
};

export type StudioRetryPieceDownloadResultV3 = {
  status: 'recovering';
  projectId: string;
  pieceId: string;
  jobId: string;
  revision: number;
};

export type StudioResumePieceJobResultV3 = StudioRetryPieceDownloadResultV3;

export type StudioPieceExportArtifactV3 = {
  schemaVersion: typeof STUDIO_EXPORT_SCHEMA_VERSION_V3;
  id: string;
  projectId: string;
  pieceId: string;
  sourceRevision: number;
  handleAtExport: string;
  managedExport: { collection: 'exports'; fileName: string };
  byteSize: number;
  payloadFileCount: 2;
  manifestSha256: string;
  createdAt: string;
};

export type StudioPieceExportCatalogV3 = {
  schemaVersion: typeof STUDIO_EXPORT_SCHEMA_VERSION_V3;
  projectId: string;
  revision: number;
  artifacts: StudioPieceExportArtifactV3[];
};

export type StudioRendererPieceExportArtifactV3 = Pick<
  StudioPieceExportArtifactV3,
  'id' | 'pieceId' | 'sourceRevision' | 'handleAtExport' | 'byteSize' | 'payloadFileCount' | 'createdAt'
> & { folderName: string };

export type StudioRendererPieceExportCatalogV3 = {
  revision: number;
  artifacts: StudioRendererPieceExportArtifactV3[];
};

export type StudioExportPieceResultV3 = {
  status: 'exported';
  catalog: StudioRendererPieceExportCatalogV3;
};

export type StudioDeleteProjectResultV3 = {
  status: 'deleted' | 'not_found';
  projectId: string;
};

/** Stable CS4 Pilot service failures. Provider bodies, paths, and authority snapshots never cross. */
export type CreativeStudioPilotErrorCodeV3 =
  | 'invalid_payload'
  | 'not_found'
  | 'unsupported_project'
  | 'project_quarantined'
  | 'stale_project'
  | 'stale_authoring'
  | 'project_piece_capacity_reached'
  | 'route_unavailable'
  | 'rate_not_found'
  | 'variable_price_unsupported'
  | 'quote_not_found'
  | 'quote_in_use'
  | 'quote_expired'
  | 'stale_quote'
  | 'confirmation_required'
  | 'duplicate_charge_acknowledgement_required'
  | 'job_ineligible'
  | 'busy'
  | 'cancellation_refused'
  | 'invalid_media'
  | 'download_failed'
  | 'variation_grid'
  | 'stale_export_catalog'
  | 'export_unavailable'
  | 'deletion_claim_not_found'
  | 'deletion_claim_expired'
  | 'deletion_claim_mismatch'
  | 'deletion_claim_capacity'
  | 'storage_error'
  | 'runtime_inactive';

/** Task 7 public project names now resolve exclusively to the Beat/Shot contract. */
export type StudioProject = StudioProjectV2;
export type StudioRendererProject = StudioRendererProjectV2;
export type StudioProjectSummary = StudioProjectSummaryV2;
export type CreateStudioProjectInput = CreateStudioProjectInputV2;

export type StudioProjectLoadResultV2 =
  | { status: 'supported'; project: StudioRendererProjectV2 }
  | { status: 'unsupported_prototype_schema'; projectId: string }
  | { status: 'not_found'; projectId: string };

export type StudioProjectListResultV2 = {
  projects: StudioProjectSummaryV2[];
  /** Ephemeral revision authority for correlating separately derived project status reads. */
  projectRevisions: { projectId: string; revision: number }[];
  unsupportedProjectIds: string[];
  quarantinedProjectIds: string[];
};

export type StudioMutationOperationV2 =
  | { kind: 'edit_project'; changes: StudioEditableProjectSettingsChanges }
  | { kind: 'set_brief'; brief: string }
  | { kind: 'set_rules'; rules: StudioBriefRuleDraft[] }
  | { kind: 'set_reference_plan'; references: StudioReferenceDraftV2[] }
  | { kind: 'amend_reference_plan'; additions: StudioBackgroundReferenceDraftV2[] }
  | { kind: 'set_reference_label'; referenceId: string; label: string }
  | { kind: 'set_reference_prompt'; referenceId: string; prompt: string }
  | { kind: 'select_reference_image'; referenceId: string; assetId: string }
  | { kind: 'remove_reference_image'; referenceId: string; assetId: string }
  | {
      kind: 'set_shot_reference_binding';
      shotId: string;
      characterReferenceIds: string[];
      backgroundReferenceId: string | null;
    }
  | {
      kind: 'add_beat';
      beatId: string;
      beat: StudioEditableBeat;
      beforeBeatId: string | null;
    }
  | { kind: 'edit_beat'; beatId: string; changes: StudioEditableBeatChanges }
  | { kind: 'reorder_beats'; beatOrder: string[] }
  | { kind: 'park_beat'; beatId: string }
  | { kind: 'restore_beat'; beatId: string; beforeBeatId: string | null }
  | { kind: 'add_binned_beat'; beatId: string; beat: StudioEditableBeat }
  | {
      kind: 'add_shot';
      beatId: string;
      shotId: string;
      shot: StudioEditableShot;
      beforeShotId: string | null;
    }
  | { kind: 'edit_shot'; shotId: string; changes: StudioEditableShotChanges }
  | { kind: 'delete_shot'; shotId: string }
  | { kind: 'park_shot'; shotId: string }
  | { kind: 'restore_shot'; shotId: string; beforeShotId: string | null }
  | { kind: 'reorder_shots'; beatId: string; shotOrder: string[] }
  | { kind: 'apply_coverage'; beatId: string; shots: StudioProposedShot[]; fixedShots: StudioFixedShotReviewV2[] }
  | { kind: 'set_hard_cut'; shotId: string; hardCut: boolean }
  | { kind: 'set_seed_still'; shotId: string; assetId: string | null }
  | { kind: 'dismiss_seed_still'; shotId: string; assetId: string }
  | { kind: 'promote_board_panel'; shotId: string; boardAssetId: string }
  | { kind: 'trim_shot'; shotId: string; trimInSeconds: number | null; trimOutSeconds: number | null }
  | { kind: 'reorder_bin'; bin: StudioBinItem[] }
  | { kind: 'set_routes'; imageRouteId: string | null; videoRouteId: string | null }
  | { kind: 'set_spend_policy'; policy: StudioSpendPolicy | null }
  | { kind: 'set_bed'; assetId: string | null }
  | { kind: 'undo_last'; entryId: string };

export type StudioDirectorOperationDispositionV2 = 'direct' | 'proposal' | 'operation_not_permitted';

/**
 * Shared, exhaustive Director authority. Main enforces this map and the renderer derives the
 * Director's capability instructions from the same value so self-description cannot drift.
 */
export const STUDIO_DIRECTOR_OPERATION_DISPOSITIONS_V2 = Object.freeze({
  edit_project: 'proposal',
  set_brief: 'direct',
  set_rules: 'operation_not_permitted',
  set_reference_plan: 'direct',
  amend_reference_plan: 'direct',
  set_reference_label: 'operation_not_permitted',
  set_reference_prompt: 'proposal',
  select_reference_image: 'operation_not_permitted',
  remove_reference_image: 'operation_not_permitted',
  set_shot_reference_binding: 'direct',
  add_beat: 'proposal',
  edit_beat: 'proposal',
  reorder_beats: 'direct',
  park_beat: 'operation_not_permitted',
  restore_beat: 'operation_not_permitted',
  add_binned_beat: 'proposal',
  add_shot: 'proposal',
  edit_shot: 'proposal',
  delete_shot: 'direct',
  park_shot: 'operation_not_permitted',
  restore_shot: 'operation_not_permitted',
  reorder_shots: 'direct',
  apply_coverage: 'proposal',
  set_hard_cut: 'operation_not_permitted',
  set_seed_still: 'operation_not_permitted',
  dismiss_seed_still: 'operation_not_permitted',
  promote_board_panel: 'operation_not_permitted',
  trim_shot: 'operation_not_permitted',
  reorder_bin: 'direct',
  set_routes: 'operation_not_permitted',
  set_spend_policy: 'operation_not_permitted',
  set_bed: 'operation_not_permitted',
  undo_last: 'operation_not_permitted',
} as const satisfies Readonly<Record<StudioMutationOperationV2['kind'], StudioDirectorOperationDispositionV2>>);

/** Operational recovery is direct but deliberately excluded from reducer and undo inventories. */
export const STUDIO_DIRECTOR_FREE_RECOVERY_DISPOSITIONS_V2 = Object.freeze({
  retry_conditioning_frame: 'direct',
  terminalize_refused_job: 'direct',
} as const satisfies Readonly<Record<StudioDirectorFreeRecoveryV2['op'], 'direct'>>);

export type StudioPersistedUndoOperationKindV2 = Exclude<StudioMutationOperationV2['kind'], 'undo_last'>;

/**
 * Runtime inventory for every single-operation mutation kind that can become an undo label.
 * The authority map above is compile-time exhaustive, so adding an operation updates this inventory
 * once its required authority disposition is declared.
 */
export const STUDIO_PERSISTED_UNDO_OPERATION_KINDS_V2: readonly StudioPersistedUndoOperationKindV2[] = Object.freeze(
  (Object.keys(STUDIO_DIRECTOR_OPERATION_DISPOSITIONS_V2) as StudioMutationOperationV2['kind'][]).filter(
    (kind): kind is StudioPersistedUndoOperationKindV2 => kind !== 'undo_last'
  )
);

const studioDirectorOperationsWithDispositionV2 = (disposition: StudioDirectorOperationDispositionV2): string =>
  Object.entries(STUDIO_DIRECTOR_OPERATION_DISPOSITIONS_V2)
    .filter((entry) => entry[1] === disposition)
    .map((entry) => entry[0])
    .join(', ');

/** English system-prompt rules derived from the exact policy Main enforces. */
export const studioDirectorCapabilityRulesV2 = (): string =>
  [
    'Your Studio authority is exact. Do not generalize one unavailable action into a refusal to author.',
    `Permitted through propose_storyboard and human review: ${studioDirectorOperationsWithDispositionV2('proposal')}.`,
    'You are permitted to create and edit Beats and Shots through that proposal path. Once the person agrees a',
    'direction, or directly asks you to build or draft the film, author the storyboard with propose_storyboard;',
    'do not say Studio denies that permission.',
    `Permitted directly through studio_apply_edits: ${studioDirectorOperationsWithDispositionV2('direct')}.`,
    `Permitted directly through studio_apply_free_fix when fresh project status offers the exact free_fix: ${Object.keys(
      STUDIO_DIRECTOR_FREE_RECOVERY_DISPOSITIONS_V2
    ).join(', ')}.`,
    `Unavailable to you: ${studioDirectorOperationsWithDispositionV2('operation_not_permitted')}.`,
    'Paid generation is separate from authoring. Never start or confirm paid generation; after the reviewed',
    'storyboard is accepted, explain that the person chooses when to review a quote and spend.',
  ].join('\n');

export type StudioMutationBatchV2 = {
  schemaVersion: typeof STUDIO_MUTATION_BATCH_SCHEMA_VERSION;
  projectId: string;
  expectedRevision: number;
  operations: StudioMutationOperationV2[];
};

export type StudioMutationBatchResultV2 = {
  project: StudioRendererProjectV2;
  createdBeatIds: string[];
  createdShotIds: string[];
};

export type StudioProposalStatus = 'pending' | 'accepted' | 'rejected' | 'expired';

/** A reviewed proposal delegates its ordered free edits to the shared mutation reducer. */
export type StudioMutationBatchProposalPayloadV2 = {
  kind: 'mutation_batch';
  operations: StudioMutationOperationV2[];
};

/** One governed rule the Director wants pinned through the reviewed proposal protocol. */
export type StudioPinRuleProposalPayloadV2 = {
  kind: 'pin_rule';
  rule: {
    text: string;
    predicate: StudioBriefRulePredicate | null;
  };
};

/** Exact status-owned paid remedy copied from a fresh detailed Director status read. */
export type StudioPaidRecoveryBlockerV2 = {
  cause: StudioProjectStatusBlockerCauseV2;
  where: StudioProjectStatusWhereV2;
  remedy: Extract<StudioProjectStatusRemedyV2, { kind: 'proposal' }>;
};

/** Bounded display facts; the full provider-bound quote remains only in Main's expiring cache. */
export type StudioPaidRecoveryQuoteSummaryV2 = {
  quoteId: string;
  projectRevision: number;
  expiresAt: string;
  currency: string;
  lowerMinorUnits: number;
  upperMinorUnits: number;
  itemCount: number;
  includesCascade: boolean;
};

/** One priced recovery whose spend boundary remains an explicit renderer-only Confirm. */
export type StudioPaidRecoveryProposalPayloadV2 = {
  kind: 'paid_recovery';
  blocker: StudioPaidRecoveryBlockerV2;
  quote: StudioPaidRecoveryQuoteSummaryV2;
};

export type StudioProposalPayloadV2 =
  | StudioMutationBatchProposalPayloadV2
  | StudioPinRuleProposalPayloadV2
  | StudioPaidRecoveryProposalPayloadV2;

/** Exact immutable record written under proposals/pending. Decisions remain separate append-only records. */
export type StudioProposalRecordV2 = {
  schemaVersion: typeof STUDIO_PROPOSAL_SCHEMA_VERSION_V2;
  id: string;
  projectId: string;
  status: 'pending';
  baseRevision: number;
  payload: StudioProposalPayloadV2;
  createdAt: string;
  decidedAt: null;
};

/** Renderer-safe effective proposal after overlaying an optional immutable decision. */
export type StudioProposalV2 =
  | StudioProposalRecordV2
  | (Omit<StudioProposalRecordV2, 'status' | 'decidedAt'> & {
      status: Exclude<StudioProposalStatus, 'pending'>;
      decidedAt: string;
    });

export type StudioProposalReviewSubjectV2 = {
  kind: 'project' | 'reference' | 'beat' | 'shot';
  id: string;
  title: string | null;
  position: number | null;
  ownerBeatId: string | null;
  ownerBeatTitle: string | null;
};

export type StudioProposalReviewFieldKeyV2 =
  | 'name'
  | 'brief'
  | 'rules'
  | 'aspectRatio'
  | 'resolution'
  | 'targetDurationSeconds'
  | 'boardStyle'
  | 'prompt'
  | 'title'
  | 'story'
  | 'targetSeconds'
  | 'shootingScript'
  | 'durationSeconds'
  | 'chainBreak'
  | 'placement'
  | 'order';

export type StudioProposalReviewValueV2 =
  | { kind: 'text'; value: string | null }
  | { kind: 'number'; value: number | null }
  | { kind: 'text_list'; values: string[] }
  | { kind: 'rule_list'; values: { text: string; forbiddenTerms: string[] }[] }
  | {
      kind: 'placement';
      value: 'active' | 'bin' | 'removed';
      position: number | null;
      ownerBeatId: string | null;
      ownerBeatTitle: string | null;
    };

export type StudioProposalReviewFieldV2 = {
  key: StudioProposalReviewFieldKeyV2;
  before: StudioProposalReviewValueV2 | null;
  after: StudioProposalReviewValueV2 | null;
};

export type StudioProposalReviewGroupV2 = {
  change: 'added' | 'edited' | 'removed' | 'reordered';
  subject: StudioProposalReviewSubjectV2;
  fields: StudioProposalReviewFieldV2[];
};

export type StudioProposalReviewRefusalSubjectV2 = {
  subject: StudioProposalReviewSubjectV2;
  fixedReasons: StudioFixedShotReasonV2[];
};

/** Transient main-derived reducer refusal. It is never written into the proposal sidecar. */
export type StudioProposalReviewRefusalV2 = {
  reasonCode: StudioMutationReasonV2;
  operationKind: StudioMutationOperationV2['kind'] | null;
  subjects: StudioProposalReviewRefusalSubjectV2[];
};

export type StudioProposalReviewV2 =
  | { status: 'ready'; groups: StudioProposalReviewGroupV2[] }
  | { status: 'stale'; groups: []; currentRevision: number; baseRevision: number }
  | {
      status: 'unavailable';
      groups: [];
      reason: 'reducer_rejected';
      refusal: StudioProposalReviewRefusalV2 | null;
    };

/** Renderer-safe proposal plus a main-derived review of the exact reducer result. */
export type StudioRendererProposalV2 = StudioProposalV2 & {
  review: StudioProposalReviewV2;
};

/** Main-correlated proposal authority installed atomically by the renderer. */
export type StudioRendererProposalCatalogV2 = {
  projectId: string;
  projectRevision: number;
  proposals: StudioRendererProposalV2[];
};

/** Exact bounded answer for the Director's read-only proposal lookup. */
export type StudioDirectorProposalLookupV2 =
  | { status: 'pending'; proposal: StudioProposalRecordV2 }
  | { status: 'not_found' }
  | {
      status: 'no_longer_pending';
      proposalId: string;
      decision: Exclude<StudioProposalStatus, 'pending'>;
    };

export type StudioProposalDecisionV2 = {
  schemaVersion: typeof STUDIO_PROPOSAL_SCHEMA_VERSION_V2;
  proposalId: string;
  status: Exclude<StudioProposalStatus, 'pending'>;
  decidedAt: string;
};

export type StudioProposalSlotV2 = {
  schemaVersion: typeof STUDIO_PROPOSAL_SCHEMA_VERSION_V2;
  proposalId: string;
  reservedAt: string;
};

export type StudioRecordProposalInputV2 = {
  projectId: string;
  proposalId: string;
  baseRevision: number;
  payload: StudioProposalPayloadV2;
};

export type StudioPreparePaidRecoveryProposalRequestV2 = {
  projectId: string;
  proposalId: string;
};

export type StudioConfirmPaidRecoveryProposalRequestV2 = {
  projectId: string;
  proposalId: string;
  quoteId: string;
  expectedRevision: number;
};

/** A durable request for reviewed generation of ordered semantic project references. */
export type StudioReferenceRequestV2 = {
  schemaVersion: typeof STUDIO_REFERENCE_REQUEST_SCHEMA_VERSION;
  id: string;
  projectId: string;
  referenceIds: string[];
  status: 'pending';
  createdAt: string;
};

export type StudioReferenceRequestSlotV2 = {
  schemaVersion: typeof STUDIO_REFERENCE_REQUEST_SCHEMA_VERSION;
  requestId: string;
  reservedAt: string;
};

export type StudioReferenceRequestAuthorityV2 = Pick<StudioReferenceRequestV2, 'id' | 'referenceIds'>;

export type StudioRouteIssue = {
  code: 'provider_unavailable' | 'unsupported_media' | 'invalid_duration' | 'invalid_resolution' | 'invalid_reference';
};

export type NormalizedStudioGenerationParameters = {
  aspectRatio: StudioAspectRatio;
  resolution: StudioResolution;
  durationSeconds: number;
};

export type StudioRouteValidation =
  | {
      ok: true;
      normalized: {
        aspectRatio: StudioAspectRatio;
        resolution: StudioResolution;
        durationSeconds: number;
      };
    }
  | {
      ok: false;
      issues: StudioRouteIssue[];
    };

export type StudioConnectionCandidateModel = {
  model: string;
  health: 'available' | 'unknown' | 'unavailable';
};

export type StudioConnectionIntegrationLabelKey =
  | 'imageApi'
  | 'bytePlusSeedance'
  | 'selfHostedVideoGateway'
  | 'openRouterVideo';

export type StudioConnectionCandidateIntegrationModels = {
  integrationLabelKey: StudioConnectionIntegrationLabelKey;
  models: StudioConnectionCandidateModel[];
};

export type StudioConnectionCandidate = {
  providerId: string;
  providerName: string;
  models: StudioConnectionCandidateModel[];
  integrationModels: StudioConnectionCandidateIntegrationModels[];
};

export type StudioRouteCatalogEntry = {
  choiceId: string;
  providerId: string;
  providerName: string;
  model: string;
  integrationLabelKey: StudioConnectionIntegrationLabelKey;
  health: 'available' | 'unknown' | 'unavailable';
  kind: StudioMediaKind;
  constraints: StudioRouteConstraints;
};

export type StudioConnectionCapabilities = {
  mediaKinds: StudioMediaKind[];
  audioModes?: string[];
  aspectRatios?: StudioAspectRatio[];
  resolutions?: StudioResolution[];
  minDurationSeconds?: number;
  maxDurationSeconds?: number;
  /** Exact provider-supported clip lengths when the interval is not continuous. */
  supportedDurationSeconds?: number[];
  supportsFirstFrame?: boolean;
  maxConditioningImages?: number;
  cancellationPolicy?: StudioCancellationPolicy;
  /** Legacy schema-v1 ingress only. Canonical reads and new writes omit it. */
  cancellation?: boolean;
};

export type StudioRouteConstraints = {
  aspectRatios: StudioAspectRatio[];
  resolutions: StudioResolution[];
  minDurationSeconds: number;
  maxDurationSeconds: number;
  /** Exact admissible clip lengths; absent only for continuous-duration adapters. */
  supportedDurationSeconds?: number[];
  supportsFirstFrame: boolean;
  maxConditioningImages: number;
  silentOutput: boolean;
};

/** Credential-free durable record stored in connections.json. */
export type StudioConnectionBinding = {
  schemaVersion: 1;
  id: string;
  providerId: string;
  adapterId: StudioProviderAdapterId;
  model: string;
  capabilities: StudioConnectionCapabilities;
  validatedAt: string;
};

export type StudioConnectionIntegration = {
  integrationId: string;
  kind: StudioMediaKind;
  labelKey: StudioConnectionIntegrationLabelKey;
};

export type StudioRendererConnectionCapabilities = Omit<
  StudioConnectionCapabilities,
  'cancellationPolicy' | 'cancellation'
>;

export type StudioConnectionRecord = {
  bindingId: string;
  providerId: string;
  integrationId: string;
  labelKey: StudioConnectionIntegrationLabelKey;
  model: string;
  capabilities: StudioRendererConnectionCapabilities;
  validatedAt: string;
};

export type StudioConnectionInventory = {
  integrations: StudioConnectionIntegration[];
  connections: StudioConnectionRecord[];
};

export type StudioConnectionValidationSuccess = Omit<StudioConnectionRecord, 'bindingId'>;

/** Stable, provider-body-free reason returned by an explicit connection-validation attempt. */
export type StudioConnectionValidationFailureReason =
  | 'unsupported'
  | 'auth'
  | 'rate_limited'
  | 'provider_unavailable'
  | 'timeout'
  | 'invalid_response'
  | 'unknown';

export type StudioConnectionValidationResult =
  | { valid: true; connection: StudioConnectionValidationSuccess }
  | { valid: false; reason: StudioConnectionValidationFailureReason };

export type StudioModelAvailability = 'ready' | 'selection_required' | 'setup_required' | 'unavailable';

export type StudioMediaSelectionIssue =
  | { code: 'retired' }
  | { code: 'needs_setup'; providerName: string }
  | { code: 'health' }
  | { code: 'frame'; aspectRatio: StudioAspectRatio; resolution: StudioResolution };

export type StudioMediaRouteCatalog = {
  status: StudioModelAvailability;
  selected: StudioMediaChoiceRef | null;
  selectedRoute: StudioRouteCatalogEntry | null;
  selectionIssue: StudioMediaSelectionIssue | null;
  options: StudioRouteCatalogEntry[];
};

/** Image/video-only route catalog exposed by the Beat/Shot workspace. */
export type StudioRouteCatalogV2 = {
  image: StudioMediaRouteCatalog;
  video: StudioMediaRouteCatalog;
  catalogVersion: string;
};

/** Stable pipeline order for the derived Creative Studio project status. */
export const STUDIO_PROJECT_STATUS_STAGE_ORDER_V2 = [
  'brief',
  'engines',
  'references',
  'storyboard',
  'bindings',
  'production',
  'cut',
] as const;

export type StudioProjectStatusStageIdV2 = (typeof STUDIO_PROJECT_STATUS_STAGE_ORDER_V2)[number];

export type StudioProjectStatusStageStateV2 = 'not_started' | 'in_progress' | 'complete' | 'blocked';

/** Explicit no-cache input used when fresh provider inventory cannot be discovered. */
export type StudioProjectStatusRouteCatalogV2 =
  | { status: 'available'; catalog: StudioRouteCatalogV2 }
  | { status: 'inventory_unavailable'; catalogVersion: null };

export const STUDIO_PROJECT_STATUS_BLOCKER_CAUSES_V2 = [
  'route_inventory_unavailable',
  'route_not_selected',
  'route_setup_required',
  'route_unavailable',
  'route_retired',
  'route_incompatible_frame',
  'route_first_frame_unsupported',
  'route_duration_unsupported',
  'reference_plan_invalid',
  'reference_generation_required',
  'reference_approval_required',
  'reference_generation_failed',
  'reference_binding_unassigned',
  'reference_binding_unknown_reference',
  'reference_binding_wrong_kind',
  'reference_binding_unapproved_reference',
  'reference_binding_missing_asset',
  'reference_binding_capacity_exceeded',
  'shooting_script_required',
  'seed_selection_required',
  'seed_generation_required',
  'conditioning_frame_required',
  'extraction_failed',
  'dependency_failed',
  'generation_invalid_request',
  'generation_content_rejected',
  'generation_auth',
  'generation_quota',
  'generation_rate_limited',
  'generation_provider_unavailable',
  'generation_timeout',
  'generation_poll_deadline',
  'generation_no_output',
  'generation_variation_grid',
  'generation_submission_unknown',
  'generation_download_failed',
  'generation_unsupported',
  'generation_unknown',
  'cut_invalid_media',
  'cut_bed_too_short',
] as const;

export type StudioProjectStatusBlockerCauseV2 = (typeof STUDIO_PROJECT_STATUS_BLOCKER_CAUSES_V2)[number];

export type StudioProjectStatusWhereV2 =
  | { kind: 'project' }
  | { kind: 'route'; routeKind: StudioMediaKind }
  | { kind: 'reference'; referenceId: string; jobId: string | null }
  | {
      kind: 'shot';
      beatId: string;
      shotId: string;
      beatPosition: number;
      shotPosition: number;
      jobId: string | null;
    }
  | { kind: 'cut' };

export type StudioProjectStatusPrepareIntentV2 =
  | { kind: 'project_references'; referenceIds: string[] }
  | {
      kind: 'generation';
      baseChoices: StudioPrepareGenerationChoiceV2[];
      cascadeChoices: StudioPrepareGenerationChoiceV2[];
      continuityChange: StudioContinuityChangeV2 | null;
    };

export type StudioProjectStatusFreeFixV2 =
  | StudioDirectorFreeRecoveryV2
  | { op: 'set_shot_reference_binding'; shotId: string };

export type StudioProjectStatusOwnerReasonV2 =
  | 'select_engine'
  | 'configure_engine'
  | 'repair_engine_health'
  | 'choose_compatible_engine'
  | 'approve_reference'
  | 'select_seed'
  | 'review_project_data'
  | 'review_job_recovery'
  | 'acknowledge_possible_duplicate_charge'
  | 'retry_download'
  | 'edit_cut'
  | 'replace_audio_bed';

export type StudioProjectStatusRemedyV2 =
  | ({ kind: 'free_fix' } & StudioProjectStatusFreeFixV2)
  | {
      kind: 'proposal';
      prepare: StudioProjectStatusPrepareIntentV2;
      /** Wave 6A discloses intent only; a later prepared quote supplies exact price authority. */
      estimatedMinorUnits: null;
      currency: null;
    }
  | { kind: 'owner_only'; reason: StudioProjectStatusOwnerReasonV2 };

export type StudioProjectStatusBlockerV2 = {
  cause: StudioProjectStatusBlockerCauseV2;
  where: StudioProjectStatusWhereV2;
  remedy: StudioProjectStatusRemedyV2;
};

export type StudioProjectStatusAdvisoryV2 =
  | {
      cause: 'target_duration_mismatch';
      stage: Extract<StudioProjectStatusStageIdV2, 'storyboard' | 'cut'>;
      actualSeconds: number;
      targetSeconds: number;
    }
  | {
      cause: 'current_take_stale';
      stage: 'production';
      shotId: string;
      staleCauses: StudioRendererDirtyShotV2['causes'];
    };

export type StudioProjectStatusStageSummaryV2 =
  | { stage: 'brief'; hasBrief: boolean }
  | {
      stage: 'engines';
      image: StudioModelAvailability;
      video: StudioModelAvailability;
    }
  | { stage: 'references'; plannedCount: number; approvedCount: number }
  | {
      stage: 'storyboard';
      beatCount: number;
      shotCount: number;
      authoredShotCount: number;
      plannedSeconds: number;
      targetSeconds: number;
    }
  | { stage: 'bindings'; readyShotCount: number; shotCount: number; maxConditioningImages: number | null }
  | { stage: 'production'; currentTakeCount: number; shotCount: number; activeJobCount: number }
  | {
      stage: 'cut';
      currentTakeCount: number;
      shotCount: number;
      durationSeconds: number | null;
      targetSeconds: number;
      structurallyPlayable: boolean;
    };

export type StudioProjectStatusStageV2 = {
  [Stage in StudioProjectStatusStageIdV2]: {
    id: Stage;
    state: StudioProjectStatusStageStateV2;
    summary: Extract<StudioProjectStatusStageSummaryV2, { stage: Stage }>;
    blockers: StudioProjectStatusBlockerV2[];
  };
}[StudioProjectStatusStageIdV2];

export type StudioProjectStatusShotDetailV2 = {
  beatId: string;
  shotId: string;
  beatPosition: number;
  shotPosition: number;
  seedStillAssetId: string | null;
  videoAssetId: string | null;
  latestGenerationJob: null | {
    jobId: string;
    purpose: Extract<StudioJobPurpose, 'seed_still' | 'video_take'>;
    status: StudioJobStatusV2;
    errorCode: StudioJobErrorV2['code'] | null;
  };
  binding:
    | { status: 'ready'; selectedCount: number; limit: number | null }
    | { status: 'unassigned'; selectedCount: number; limit: number | null }
    | { status: 'unknown'; selectedCount: number; limit: null }
    | {
        status: 'invalid';
        reason: Exclude<StudioReferenceBindingFailureReasonV2, 'unassigned'>;
        selectedCount: number;
        limit: number | null;
      };
  conditioning: null | {
    upstreamShotId: string;
    /** Persisted extraction state only; Wave 6A performs no physical media verification. */
    recordStatus: 'missing' | StudioFrameExtraction['status'];
    mediaVerified: false;
    extractionId: string | null;
    errorCode: StudioFrameExtraction['errorCode'];
    attemptCount: number | null;
  };
};

export type StudioProjectStatusReferenceDetailV2 = {
  referenceId: string;
  kind: StudioReferenceKindV2;
  approved: boolean;
  latestJob: null | {
    jobId: string;
    status: StudioJobStatusV2;
    errorCode: StudioJobErrorV2['code'] | null;
  };
};

export type StudioProjectStatusV2 = {
  projectId: string;
  projectRevision: number;
  catalogVersion: string | null;
  stages: StudioProjectStatusStageV2[];
  blockerCount: number;
  advisories: StudioProjectStatusAdvisoryV2[];
  boards: { currentPictureCount: number; shotCount: number };
  detail: { shots: StudioProjectStatusShotDetailV2[]; references: StudioProjectStatusReferenceDetailV2[] } | null;
};

export type StudioProjectStatusRequestV2 = { projectId: string; detail?: boolean };

/** One renderer-requested target whose persisted route/input capability Main may explain. */
export type StudioGenerationCapabilityItemV2 =
  | {
      target: Extract<StudioGenerationTargetV2, { kind: 'shot' }>;
      purpose: Extract<StudioJobPurpose, 'seed_still' | 'board_still' | 'video_take'>;
    }
  | {
      target: Extract<StudioGenerationTargetV2, { kind: 'reference' }>;
      purpose: 'reference_image';
    };

/** Renderer-safe, deterministic reasons why Main will not admit a generation item. */
export type StudioGenerationBlockV2 =
  | { code: 'catalog_unloaded'; role: StudioMediaKind }
  | { code: 'no_engine'; role: StudioMediaKind }
  | { code: 'needs_setup'; role: StudioMediaKind }
  | { code: 'health'; role: StudioMediaKind }
  | { code: 'retired'; role: StudioMediaKind }
  | { code: 'frame'; role: StudioMediaKind; ratio: StudioAspectRatio }
  | { code: 'resolution'; role: StudioMediaKind; resolution: StudioResolution }
  | { code: 'duration'; role: StudioMediaKind; seconds: number }
  | { code: 'first_frame'; role: 'video' }
  | {
      code: 'reference_binding';
      role: 'image';
      reason: StudioReferenceBindingFailureReasonV2;
      selectedCount: number;
      limit: number;
    };

export type StudioGenerationCapabilityBlockGroupV2 = {
  block: StudioGenerationBlockV2;
  items: StudioGenerationCapabilityItemV2[];
};

export type StudioGenerationCapabilityRequestV2 = {
  projectId: string;
  expectedRevision: number;
  items: StudioGenerationCapabilityItemV2[];
};

/**
 * Main-owned route/input capability disclosure. A supported item is not proof of payability:
 * preparation and confirmation still derive dependency topology, identity, price, and spend authority.
 */
export type StudioGenerationCapabilityV2 = {
  projectId: string;
  projectRevision: number;
  catalogVersion: string | null;
  supportedItems: StudioGenerationCapabilityItemV2[];
  blocks: StudioGenerationCapabilityBlockGroupV2[];
};

/** Bounded, renderer-safe reasons for refusing an authoring mutation before persistence. */
export const STUDIO_MUTATION_REASONS_V2 = [
  'beat_capacity_reached',
  'beat_shot_capacity_reached',
  'project_shot_capacity_reached',
  'invalid_shot_duration',
  'dependency_blocked',
  'identity_collision',
  'invalid_operation',
  'undo_conflict',
  'validation_failed',
] as const;

export type StudioMutationReasonV2 = (typeof STUDIO_MUTATION_REASONS_V2)[number];

const STUDIO_MUTATION_REASON_SET_V2: ReadonlySet<string> = new Set(STUDIO_MUTATION_REASONS_V2);

export const isStudioMutationReasonV2 = (value: unknown): value is StudioMutationReasonV2 =>
  typeof value === 'string' && STUDIO_MUTATION_REASON_SET_V2.has(value);

export type StudioCommandErrorCode =
  | 'feature_disabled'
  | 'invalid_payload'
  | 'pricing_refused'
  | 'not_found'
  | 'stale_project'
  | 'stale_export_catalog'
  | 'invalid_route'
  | 'rule_breach'
  | 'media_in_use'
  | 'cancellation_refused'
  | 'duplicate_charge_acknowledgement_required'
  | 'unsupported'
  | 'ffmpeg_unavailable'
  | 'unsupported_capabilities'
  | 'render_failed'
  | 'busy'
  | 'cancelled'
  | 'provider_error'
  | 'runtime_inactive'
  | 'project_quarantined'
  | 'connection_validation_failed'
  | 'mutation_refused'
  | StudioSubmissionCacheErrorCodeV2
  | 'storage_error';

export type StudioCommandError =
  | {
      code: 'pricing_refused';
      reason: StudioPricingRefusalReasonV2;
      details: StudioPricingRefusalDetailsV2 | null;
      messageKey: string;
    }
  | {
      code: 'connection_validation_failed';
      reason: StudioConnectionValidationFailureReason;
      messageKey: string;
    }
  | {
      code: 'project_quarantined';
      projectId: string;
      messageKey: string;
    }
  | {
      code: 'mutation_refused';
      reason: StudioMutationReasonV2;
      messageKey: string;
    }
  | {
      code: Exclude<
        StudioCommandErrorCode,
        'pricing_refused' | 'connection_validation_failed' | 'project_quarantined' | 'mutation_refused'
      >;
      messageKey: string;
    };

export type StudioCommandResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      error: StudioCommandError;
    };

export type StudioJobRequest = {
  projectId: string;
  jobId: string;
  expectedRevision: number;
};

export type StudioRetryJobRequest = StudioJobRequest & {
  acknowledgePossibleDuplicateCharge?: boolean;
};

export type StudioRetryDownloadRequest = StudioJobRequest;

export type StudioValidateConnectionRequest = {
  providerId: string;
  integrationId: string;
  model: string;
};

export type StudioSaveConnectionRequest = StudioValidateConnectionRequest;

export type StudioRemoveConnectionRequest = { bindingId: string };
