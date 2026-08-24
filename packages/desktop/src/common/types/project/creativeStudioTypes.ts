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

export type StudioJobPurpose = 'seed_still' | 'board_still' | 'video_take';

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

export type StudioBriefReferenceRole = 'cast' | 'look';

export type StudioJobErrorCode =
  | 'invalid_request'
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

export type StudioJobRetryReason = 'provider_failure' | 'submission_unknown';

export type StudioCancellationPolicy = 'none' | 'queued_only' | 'queued_and_running';

export const STUDIO_PROJECT_SCHEMA_VERSION = 5 as const;
export const STUDIO_MAX_BEATS = 24;
export const STUDIO_MAX_SHOTS_PER_BEAT = 8;
export const STUDIO_MAX_SHOTS_PER_PROJECT = 96;
export const STUDIO_MAX_BIN_BEAT_ITEMS = 24;
export const STUDIO_MAX_BIN_SHOT_ITEMS = 96;
export const STUDIO_MAX_LINE_HISTORY_PER_BEAT = 20;
export const STUDIO_MAX_UNDO_ENTRIES = 20;
export const STUDIO_MAX_UNDO_PATCHES_PER_ENTRY = 2 + STUDIO_MAX_BEATS + STUDIO_MAX_SHOTS_PER_PROJECT;
export const STUDIO_MAX_UNDO_LABEL_LENGTH = 256;
export const STUDIO_MIN_SHOT_SECONDS = 4;
export const STUDIO_MAX_SHOT_SECONDS = 15;
export const STUDIO_MAX_GENERATION_PROMPT_LENGTH = 32 * 1024;
export const STUDIO_LOOK_SOFT_WORD_LIMIT = 25;
export const STUDIO_MAX_GENERATION_SHOTS_PER_REQUEST = 24;
export const STUDIO_MAX_GENERATION_ITEMS_PER_REQUEST = 2 * STUDIO_MAX_GENERATION_SHOTS_PER_REQUEST;
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
export const STUDIO_MAX_REFERENCE_REQUEST_SHOTS = 24;
export const STUDIO_MAX_PROJECT_REFERENCES = 48;
export const STUDIO_MAX_REFERENCE_LABEL_LENGTH = 256;
export const STUDIO_MAX_REFERENCE_PROMPT_LENGTH = 8 * 1024;
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
export const STUDIO_DIRECTOR_COMMAND_SCHEMA_VERSION_V2 = STUDIO_PROJECT_SCHEMA_VERSION;
export const STUDIO_DIRECTOR_COMMAND_MAX_OPERATIONS = 32;
export const STUDIO_DIRECTOR_COMMAND_MAX_RECORD_BYTES = 256 * 1024;
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

/** Schema-2 Director commands expose only the current explicitly supported edit capability. */
export type StudioDirectorOperationV2 = Extract<
  StudioMutationOperationV2,
  {
    kind:
      | 'set_brief'
      | 'add_beat'
      | 'edit_beat'
      | 'reorder_beats'
      | 'add_shot'
      | 'edit_shot'
      | 'delete_shot'
      | 'reorder_shots'
      | 'reorder_bin';
  }
>;

export type StudioDirectorCommandRecordV2 = {
  schemaVersion: typeof STUDIO_PROJECT_SCHEMA_VERSION;
  commandId: string;
  projectId: string;
  expectedRevision: number;
  createdAt: string;
  deadlineAt: string;
  policy: 'auto_apply';
  operations: StudioDirectorOperationV2[];
};

export type StudioDirectorCommandSlotV2 = {
  schemaVersion: typeof STUDIO_PROJECT_SCHEMA_VERSION;
  commandId: string;
  reservedAt: string;
  deadlineAt: string;
};

export type StudioDirectorCommandSlotLeaseV2 = {
  schemaVersion: typeof STUDIO_PROJECT_SCHEMA_VERSION;
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
  schemaVersion: typeof STUDIO_PROJECT_SCHEMA_VERSION;
  commandId: string;
  projectId: string;
  expectedRevision: number;
  decidedAt: string;
  status: 'applied';
  appliedRevision: number;
  createdBeatIds: string[];
  createdShotIds: string[];
};

export type StudioDirectorRejectedReceiptV2 = {
  schemaVersion: typeof STUDIO_PROJECT_SCHEMA_VERSION;
  commandId: string;
  projectId: string;
  expectedRevision: number | null;
  decidedAt: string;
  status: 'rejected';
  observedRevision: number | null;
  reasonCode: StudioDirectorCommandRejectionCodeV2;
};

export type StudioDirectorExpiredReceiptV2 = {
  schemaVersion: typeof STUDIO_PROJECT_SCHEMA_VERSION;
  commandId: string;
  projectId: string;
  expectedRevision: number;
  decidedAt: string;
  status: 'expired';
  observedRevision: number | null;
  reasonCode: StudioDirectorCommandExpiryCode;
};

export type StudioDirectorIndeterminateReceiptV2 = {
  schemaVersion: typeof STUDIO_PROJECT_SCHEMA_VERSION;
  commandId: string;
  projectId: string;
  expectedRevision: number;
  decidedAt: string;
  status: 'indeterminate';
  observedRevision: number | null;
  reasonCode: StudioDirectorCommandIndeterminateCode;
};

export type StudioDirectorCommandReceiptV2 =
  | StudioDirectorAppliedReceiptV2
  | StudioDirectorRejectedReceiptV2
  | StudioDirectorExpiredReceiptV2
  | StudioDirectorIndeterminateReceiptV2;

export type StudioBeat = {
  id: string;
  title: string;
  action: string;
  look: string;
  actionRevision: number;
  targetSeconds: number | null;
  shotOrder: string[];
  lineHistory: StudioLineHistoryEntry[];
};

export type StudioLineHistoryEntry = {
  id: string;
  shotOrdinal: number;
  text: string;
  capturedAt: string;
};

export type StudioShot = {
  id: string;
  line: string;
  derivation: 'derived' | 'detached';
  derivedFromActionRevision: number | null;
  narration: string;
  onScreenText: string;
  durationSeconds: number;
  trimInSeconds: number | null;
  trimOutSeconds: number | null;
  chainBreak: 'none' | 'hard_cut';
  /** Ordered project-reference identities authored for this Shot. */
  referenceIds: string[];
  seedStillId: string | null;
  boardAssetId: string | null;
  supersededBoardAssetIds: string[];
  videoAssetId: string | null;
  supersededVideoAssetIds: string[];
  assetIds: string[];
  jobIds: string[];
};

export type StudioProjectReferenceKindV2 = 'character' | 'background';

/** Durable candidate/approval authority for one project-level reference sheet. */
export type StudioProjectReferenceV2 = {
  id: string;
  kind: StudioProjectReferenceKindV2;
  label: string;
  prompt: string;
  candidateAssetId: string | null;
  candidateJobId: string | null;
  approvedAssetId: string | null;
  /** Replaced approvals remain attributable and reachable; entries are append-only. */
  supersededAssetIds: string[];
  createdAt: string;
  updatedAt: string;
};

export type StudioProjectReferenceDraftV2 = Pick<StudioProjectReferenceV2, 'id' | 'kind' | 'label' | 'prompt'> & {
  /** Input-only assignment; the reducer writes the sole durable authority to each Shot.referenceIds. */
  shotIds: string[];
};

export type StudioBinItem =
  | { kind: 'beat'; beatId: string; reason: 'lifted' | 'alternate' }
  | { kind: 'shot'; beatId: string; shotId: string; reason: 'lifted' };

export type StudioProposedShot = {
  shotId: string;
  line: string;
  narration: string;
  onScreenText: string;
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
  | 'narration'
  | 'on_screen_text';

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
  assetId: string;
  sha256: string;
};

export type StudioGenerationRequestSnapshot = {
  prompt: string;
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
};

export type StudioSpendPolicy = {
  currency: string;
  maxPerBatchMinorUnits: number;
};

export type StudioQuotedGeneration = {
  id: string;
  shotId: string;
  /** Present only when this image job creates a candidate for a project reference. */
  projectReferenceId?: string;
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
  shotId: string;
  purpose: StudioJobPurpose;
  referenceAssetId: string | null;
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

export type StudioApproveProjectReferenceRequestV2 = {
  projectId: string;
  expectedRevision: number;
  referenceId: string;
  candidateAssetId: string;
};

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
  'missing_conditioning',
  'unsafe_total',
] as const;

export type StudioPricingRefusalReasonV2 = (typeof STUDIO_PRICING_REFUSAL_REASONS_V2)[number];

const STUDIO_PRICING_REFUSAL_REASON_SET_V2: ReadonlySet<string> = new Set(STUDIO_PRICING_REFUSAL_REASONS_V2);

export const isStudioPricingRefusalReasonV2 = (value: unknown): value is StudioPricingRefusalReasonV2 =>
  typeof value === 'string' && STUDIO_PRICING_REFUSAL_REASON_SET_V2.has(value);

export type StudioPrepareSubmissionRequestV2 = {
  projectId: string;
  expectedRevision: number;
  originReferenceHandoffId: string | null;
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
  shotId: string;
  projectReferenceId?: string;
  purpose: StudioJobPurpose;
  route: StudioRendererMediaModelRef;
  generationCount: number;
  durationSeconds: number | null;
  oneGenerationMinorUnits: number;
  requestedTotalMinorUnits: number;
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
  schemaVersion: typeof STUDIO_PROJECT_SCHEMA_VERSION;
  proposalId: string;
  projectId: string;
  baseRevision: number;
  appliedRevision: number;
  beforeProjectSha256: string;
  afterProjectSha256: string;
  createdBeatIds: string[];
  createdShotIds: string[];
  decidedAt: string;
};

export type StudioReferenceRequestDecisionV2 = {
  schemaVersion: typeof STUDIO_PROJECT_SCHEMA_VERSION;
  requestId: string;
  projectId: string;
  decidedAt: string;
  outcome:
    | { kind: 'rejected' }
    | { kind: 'expired' }
    | { kind: 'imported_reference'; assetId: string; projectRevision: number }
    | { kind: 'generation_gate'; handoffId: string; referenceIds: string[] };
};

export type StudioReferenceGenerationHandoffReceiptV2 = {
  schemaVersion: typeof STUDIO_PROJECT_SCHEMA_VERSION;
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
  status: 'open' | 'dismissed' | 'confirmed';
  completedAt: string | null;
  progress: { queued: number; running: number; succeeded: number; failed: number };
  candidateAssetIds: string[];
  retryReferenceIds: string[];
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
      | 'set_shot_background_reference'
      | 'promote_board_panel'
      | 'trim_shot'
      | 'redetach_line'
      | 'restore_line'
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
  /** Optional Brief classification. Role and label are persisted together or both absent. */
  briefReferenceRole?: StudioBriefReferenceRole;
  briefReferenceLabel?: string;
  /** Beat/Shot look provenance for generated conditioning media. */
  sourceLook?: string;
  /** Exact approved reference assets used to create this generated output, in provider order. */
  referenceAssetIds?: string[];
};

export type StudioExportShapeV2 = 'editor_folder' | 'still' | 'script';

export type StudioManagedExportRefV2 = {
  collection: 'exports';
  fileName: string;
};

export type StudioExportArtifactV2 = {
  schemaVersion: typeof STUDIO_PROJECT_SCHEMA_VERSION;
  id: string;
  projectId: string;
  sourceRevision: number;
  shape: StudioExportShapeV2;
  payloadKind: 'directory' | 'file';
  managedExport: StudioManagedExportRefV2;
  byteSize: number;
  fileCount: number;
  manifestSha256: string;
  createdAt: string;
};

export type StudioExportCatalogV2 = {
  schemaVersion: typeof STUDIO_PROJECT_SCHEMA_VERSION;
  projectId: string;
  revision: number;
  artifacts: StudioExportArtifactV2[];
};

export type StudioRendererExportArtifactV2 = Pick<
  StudioExportArtifactV2,
  'id' | 'sourceRevision' | 'shape' | 'byteSize' | 'fileCount' | 'createdAt'
>;

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

export type StudioCreateExportRequestV2 =
  | { projectId: string; expectedRevision: number; expectedCatalogRevision: number; shape: 'editor_folder' }
  | {
      projectId: string;
      expectedRevision: number;
      expectedCatalogRevision: number;
      shape: 'still';
      shotId: string;
    }
  | { projectId: string; expectedRevision: number; expectedCatalogRevision: number; shape: 'script' };

export type StudioListExportsRequestV2 = { projectId: string };

export type StudioEditorFolderTimelineEntryV2 =
  | {
      kind: 'shot';
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
  schemaVersion: typeof STUDIO_PROJECT_SCHEMA_VERSION;
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
  shotId: string;
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
  /** Candidate destination for a project-reference generation, absent for ordinary Shot jobs. */
  projectReferenceId?: string;
  authorizationId: string;
  authorizationItemId: string;
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
        referenceOrder: string[];
        references: Record<string, StudioProjectReferenceV2>;
        imageRouteId: string | null;
        videoRouteId: string | null;
        spendPolicy: StudioSpendPolicy | null;
        bedAssetId: string | null;
      };
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

export type StudioEditableBeat = Pick<StudioBeat, 'title' | 'action' | 'look' | 'targetSeconds'>;

export type StudioEditableShot = Pick<StudioShot, 'line' | 'narration' | 'onScreenText' | 'durationSeconds'>;

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
  unsupportedProjectIds: string[];
  quarantinedProjectIds: string[];
};

export type StudioMutationOperationV2 =
  | { kind: 'edit_project'; changes: StudioEditableProjectSettingsChanges }
  | { kind: 'set_brief'; brief: string }
  | { kind: 'set_rules'; rules: StudioBriefRuleDraft[] }
  | { kind: 'set_project_references'; references: StudioProjectReferenceDraftV2[] }
  | { kind: 'set_shot_background_reference'; shotId: string; referenceId: string }
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
  | { kind: 'promote_board_panel'; shotId: string; boardAssetId: string }
  | { kind: 'trim_shot'; shotId: string; trimInSeconds: number | null; trimOutSeconds: number | null }
  | { kind: 'redetach_line'; shotId: string; line: string }
  | { kind: 'rederive_line'; shotId: string; line: string }
  | { kind: 'restore_line'; shotId: string; historyEntryId: string }
  | { kind: 'reorder_bin'; bin: StudioBinItem[] }
  | { kind: 'set_routes'; imageRouteId: string | null; videoRouteId: string | null }
  | { kind: 'set_spend_policy'; policy: StudioSpendPolicy | null }
  | { kind: 'set_bed'; assetId: string | null }
  | { kind: 'undo_last'; entryId: string };

export type StudioMutationBatchV2 = {
  schemaVersion: typeof STUDIO_PROJECT_SCHEMA_VERSION;
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

/** A reviewed schema-2 proposal delegates its ordered free edits to the shared mutation reducer. */
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

export type StudioProposalPayloadV2 = StudioMutationBatchProposalPayloadV2 | StudioPinRuleProposalPayloadV2;

/** Exact immutable record written under proposals/pending. Decisions remain separate append-only records. */
export type StudioProposalRecordV2 = {
  schemaVersion: typeof STUDIO_PROJECT_SCHEMA_VERSION;
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

export type StudioProposalDecisionV2 = {
  schemaVersion: typeof STUDIO_PROJECT_SCHEMA_VERSION;
  proposalId: string;
  status: Exclude<StudioProposalStatus, 'pending'>;
  decidedAt: string;
};

export type StudioProposalSlotV2 = {
  schemaVersion: typeof STUDIO_PROJECT_SCHEMA_VERSION;
  proposalId: string;
  reservedAt: string;
};

export type StudioRecordProposalInputV2 = {
  projectId: string;
  proposalId: string;
  baseRevision: number;
  payload: StudioProposalPayloadV2;
};

/** A durable schema-2 request for reviewed reference generation across ordered active shots. */
export type StudioReferenceRequestV2 = {
  schemaVersion: typeof STUDIO_PROJECT_SCHEMA_VERSION;
  id: string;
  projectId: string;
  referenceIds: string[];
  status: 'pending';
  createdAt: string;
};

export type StudioReferenceRequestSlotV2 = {
  schemaVersion: typeof STUDIO_PROJECT_SCHEMA_VERSION;
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

export type StudioCommandErrorCode =
  | 'feature_disabled'
  | 'invalid_payload'
  | 'pricing_refused'
  | 'not_found'
  | 'stale_project'
  | 'invalid_route'
  | 'rule_breach'
  | 'media_in_use'
  | 'cancellation_refused'
  | 'duplicate_charge_acknowledgement_required'
  | 'unsupported'
  | 'busy'
  | 'cancelled'
  | 'provider_error'
  | StudioSubmissionCacheErrorCodeV2
  | 'storage_error';

export type StudioCommandError =
  | {
      code: 'pricing_refused';
      reason: StudioPricingRefusalReasonV2;
      messageKey: string;
    }
  | {
      code: Exclude<StudioCommandErrorCode, 'pricing_refused'>;
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

export type StudioDetachBriefReferenceRequest = {
  projectId: string;
  assetId: string;
  expectedRevision: number;
};

export type StudioValidateConnectionRequest = {
  providerId: string;
  integrationId: string;
  model: string;
};

export type StudioSaveConnectionRequest = StudioValidateConnectionRequest;

export type StudioRemoveConnectionRequest = { bindingId: string };
