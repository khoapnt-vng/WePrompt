/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/** Shared, renderer-safe Creative Studio domain and desktop contract types. */

import type { ISessionMcpServer } from '@/common/config/storage';
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
 * unsaved-scene-draft preflight before closing the window. A second copy of this list would not
 * just be a style problem — a view missing from main's copy closes with no prompt and loses the drafts.
 */
export const STUDIO_VIEWS = ['table', 'board', 'cut'] as const;

export type StudioView = (typeof STUDIO_VIEWS)[number];

export type StudioMediaKind = 'image' | 'video';

export type StudioAspectRatio = '16:9' | '9:16' | '1:1' | '4:3' | '3:4';

export type StudioResolution = '720p' | '1080p';

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

export type StudioTextModelRef = {
  providerId: string;
  model: string;
};

export type StudioTextModelOption = StudioTextModelRef & {
  providerName: string;
  health: 'available' | 'unknown';
};

/** Main-issued media choice identity plus renderer-safe display metadata. */
export type StudioMediaChoiceRef = {
  choiceId: string;
  providerId: string;
  model: string;
};

/** An app-managed asset identity, deliberately not a filesystem path or URL. */
export type StudioManagedAssetRef = {
  collection:
    /** A generated take: the finished shot committed to a scene. */
    | 'assets'
    /** User-imported reference material. `StudioScene.referenceAssetId` points here today. */
    | 'imports'
    /** Captured or provider-generated poster frames for video takes. */
    | 'thumbnails'
    /** A generated reference plate (not user-imported); distinct from the `imports` sense of "reference". */
    | 'references';
  fileName: string;
};

export type StudioBriefReferenceRole = 'cast' | 'look';

export type StudioAsset = {
  id: string;
  projectId: string;
  /** Null for project-level reference material that is not attached to a scene. */
  sceneId: string | null;
  mediaKind: StudioMediaKind;
  mimeType: string;
  managedAsset: StudioManagedAssetRef;
  byteSize: number;
  sha256: string;
  width?: number;
  height?: number;
  durationSeconds?: number;
  createdAt: string;
  /** Optional Brief classification. Role and label are persisted together or both absent. */
  briefReferenceRole?: StudioBriefReferenceRole;
  briefReferenceLabel?: string;
  /**
   * The scene's visual prompt at the moment this asset was generated, trimmed.
   * Absent means unknown provenance — an asset written before this field existed,
   * or one that did not come from a prompt (an import). Absent is NOT stale.
   */
  sourceVisualPrompt?: string;
  /** Complete frame-input provenance for generated reference plates; the trio is all-or-neither. */
  sourceReferenceAssetIds?: string[];
  sourceAspectRatio?: StudioAspectRatio;
  sourceResolution?: StudioResolution;
};

export type StudioJobErrorCode =
  | 'invalid_request'
  | 'auth'
  | 'quota'
  | 'rate_limited'
  | 'provider_unavailable'
  | 'timeout'
  | 'poll_deadline'
  | 'no_output'
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

/** What a job's output becomes once it lands: the scene's finished take, or its supporting reference plate. */
export type StudioOutputRole = 'take' | 'reference';

export const STUDIO_REFERENCE_PROMPT_MAX_LENGTH = 4 * 1024;
export const STUDIO_PROJECT_SCHEMA_VERSION = 2 as const;
export const STUDIO_MAX_BEATS = 24;
export const STUDIO_MAX_SHOTS_PER_BEAT = 8;
export const STUDIO_MAX_SHOTS_PER_PROJECT = 96;
export const STUDIO_MAX_BIN_BEAT_ITEMS = 24;
export const STUDIO_MAX_BIN_SHOT_ITEMS = 96;
export const STUDIO_MAX_BIN_TAKE_ITEMS = 96;
export const STUDIO_MAX_LINE_HISTORY_PER_BEAT = 20;
export const STUDIO_MAX_UNDO_ENTRIES = 20;
export const STUDIO_MAX_UNDO_PATCHES_PER_ENTRY = 2 + STUDIO_MAX_BEATS + STUDIO_MAX_SHOTS_PER_PROJECT;
export const STUDIO_MAX_UNDO_LABEL_LENGTH = 256;
export const STUDIO_MIN_SHOT_SECONDS = 4;
export const STUDIO_MAX_SHOT_SECONDS = 15;
export const STUDIO_MAX_GENERATIONS_PER_SHOT_PER_SUBMISSION = 4;
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
export const STUDIO_PROPOSAL_V2_PENDING_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
export const STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES = 256 * 1024;
export const STUDIO_REFERENCE_REQUEST_V2_MAX_PENDING_PER_PROJECT = 50;
export const STUDIO_REFERENCE_REQUEST_V2_PENDING_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
export const STUDIO_MAX_CUT_PLACEMENT_CLIPS = 96;
export const STUDIO_MAX_DIRTY_SHOTS_REPORTED = 96;
export const STUDIO_MAX_MCP_AVAILABLE_TAKE_IDS_PER_SHOT = 24;
export const STUDIO_MAX_MUTATION_OPERATIONS = 32;

/**
 * Bounds persisted remote job IDs to URL-unreserved opaque tokens before they
 * can reach provider polling or cancellation routes.
 */
export const isValidProviderJobId = (value: string): boolean =>
  value.length <= 512 && /^[A-Za-z0-9][A-Za-z0-9._~-]*$/.test(value);

export const STUDIO_MAX_SCENES = 24;
export const STUDIO_MAX_GENERATION_SCENES_PER_REQUEST = 24;
export const STUDIO_MAX_REFERENCE_REQUEST_SCENES = 24;
export const STUDIO_MAX_CUT_PLACEMENT_SCENES = 24;
export const STUDIO_MAX_DIRTY_SCENES_REPORTED = 24;
export const STUDIO_MAX_MCP_AVAILABLE_TAKE_IDS_PER_SCENE = 24;
export const STUDIO_DIRECTOR_COMMAND_SCHEMA_VERSION = 1 as const;
/** Additive Gate-1 Director contract; the registered V1 writer remains on schema 1 until atomic cutover. */
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

/** Preserves readable legacy projects while preventing any further scene-count growth above the current cap. */
export function isStudioSceneCountTransitionAllowed(currentCount: number, nextCount: number): boolean {
  if (currentCount <= STUDIO_MAX_SCENES) return nextCount <= STUDIO_MAX_SCENES;
  return nextCount <= currentCount;
}

/** Main-only frame-defining authority frozen before a reference plate is submitted. */
export type StudioReferenceInputSnapshot = {
  sourceVisualPrompt: string;
  conditioningReferenceAssetIds: string[];
  aspectRatio: StudioAspectRatio;
  resolution: StudioResolution;
};

export type StudioJob = {
  id: string;
  projectId: string;
  sceneId: string;
  status: StudioJobStatus;
  provider: StudioProviderRef;
  idempotencyKey: string;
  providerJobId: string | null;
  /** Set once when providerJobId becomes durable. Optional only for old schema-v1 jobs. */
  remoteStartedAt?: string | null;
  cancellationPolicy: StudioCancellationPolicy;
  /** Absent means 'take', the pre-existing default. Never backfilled onto old records; read via jobOutputRole(job). */
  outputRole?: StudioOutputRole;
  /** Optional only for legacy reference jobs. Never project this main-only authority to the renderer. */
  referenceInputSnapshot?: StudioReferenceInputSnapshot;
  outputAssetIds: string[];
  error: StudioJobError | null;
  progress?: number;
  retryOfJobId: string | null;
  retryReason: StudioJobRetryReason | null;
  duplicateChargeAcknowledged: boolean;
  duplicateChargeAcknowledgedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

/**
 * Renderer-facing job metadata. Provider task, adapter, and charge identities stay in main.
 * `outputRole` is an optional renderer field: absent remains the legacy `take` default and must not
 * be backfilled onto older jobs.
 */
export type StudioRendererJob = Omit<
  StudioJob,
  'provider' | 'idempotencyKey' | 'providerJobId' | 'remoteStartedAt' | 'cancellationPolicy' | 'referenceInputSnapshot'
> & {
  provider: StudioMediaChoiceRef;
  /** Main-derived cancellation capability; renderer code never infers it from status or provider metadata. */
  canCancel: boolean;
  /** Main-derived recovery capability; never exposes the durable provider task identity. */
  canRetryDownload: boolean;
};

export type StudioSceneReviewState = 'draft' | 'ready' | 'generating' | 'complete' | 'blocked';

export type StudioScene = {
  id: string;
  title: string;
  purpose: string;
  visualPrompt: string;
  narration: string;
  onScreenText: string;
  mediaKind: StudioMediaKind;
  durationSeconds: number;
  referenceAssetId: string | null;
  selectedAssetId: string | null;
  assetIds: string[];
  jobIds: string[];
  reviewState: StudioSceneReviewState;
};

/** Fields a renderer editor may supply; operational scene state remains main-owned. */
export type StudioEditableScene = Pick<
  StudioScene,
  | 'title'
  | 'purpose'
  | 'visualPrompt'
  | 'narration'
  | 'onScreenText'
  | 'mediaKind'
  | 'durationSeconds'
  | 'referenceAssetId'
>;

export type StudioDirectorNewSceneV1 = {
  title: string;
  purpose: string;
  visualPrompt: string;
  narration: string;
  onScreenText: string;
  mediaKind: StudioMediaKind;
  durationSeconds: number;
};

export type StudioDirectorOperationV1 =
  | { kind: 'set_brief'; brief: string }
  | {
      kind: 'add_scene';
      sceneId: string;
      scene: StudioDirectorNewSceneV1;
      beforeSceneId: string | null;
    }
  | {
      kind: 'edit_scene';
      sceneId: string;
      changes: Partial<
        Pick<
          StudioEditableScene,
          'title' | 'purpose' | 'visualPrompt' | 'narration' | 'onScreenText' | 'durationSeconds'
        >
      >;
    }
  | { kind: 'reorder_scenes'; sceneOrder: string[] }
  | { kind: 'select_take'; sceneId: string; assetId: string };

export type StudioDirectorCommandRecordV1 = {
  schemaVersion: 1;
  commandId: string;
  projectId: string;
  expectedRevision: number;
  createdAt: string;
  deadlineAt: string;
  policy: 'auto_apply';
  operations: StudioDirectorOperationV1[];
};

export type StudioDirectorCommandSlotV1 = {
  schemaVersion: 1;
  commandId: string;
  reservedAt: string;
  deadlineAt: string;
};

export type StudioDirectorCommandSlotLeaseV1 = {
  schemaVersion: 1;
  leaseId: string;
  owner: 'writer' | 'main';
  commandId: string | null;
  reservedAt: string | null;
  deadlineAt: string | null;
  acquiredAt: string;
  expiresAt: string;
};

export type StudioDirectorCommandRejectionCode =
  | 'malformed_record'
  | 'unsupported_version'
  | 'stale_revision'
  | 'future_revision'
  | 'project_not_found'
  | 'validation_failed'
  | 'scene_limit_exceeded'
  | 'project_over_capacity';

export type StudioDirectorCommandExpiryCode = 'deadline_elapsed' | 'expired_after_restart';

export type StudioDirectorCommandIndeterminateCode = 'commit_attribution_unknown' | 'indeterminate_after_restart';

export type StudioDirectorAppliedReceiptV1 = {
  schemaVersion: 1;
  commandId: string;
  projectId: string;
  expectedRevision: number;
  decidedAt: string;
  status: 'applied';
  appliedRevision: number;
  createdSceneIds: string[];
};

export type StudioDirectorRejectedReceiptV1 = {
  schemaVersion: 1;
  commandId: string;
  projectId: string;
  expectedRevision: number | null;
  decidedAt: string;
  status: 'rejected';
  observedRevision: number | null;
  reasonCode: StudioDirectorCommandRejectionCode;
};

export type StudioDirectorExpiredReceiptV1 = {
  schemaVersion: 1;
  commandId: string;
  projectId: string;
  expectedRevision: number;
  decidedAt: string;
  status: 'expired';
  observedRevision: number | null;
  reasonCode: StudioDirectorCommandExpiryCode;
};

export type StudioDirectorIndeterminateReceiptV1 = {
  schemaVersion: 1;
  commandId: string;
  projectId: string;
  expectedRevision: number;
  decidedAt: string;
  status: 'indeterminate';
  observedRevision: number | null;
  reasonCode: StudioDirectorCommandIndeterminateCode;
};

export type StudioDirectorCommandReceiptV1 =
  | StudioDirectorAppliedReceiptV1
  | StudioDirectorRejectedReceiptV1
  | StudioDirectorExpiredReceiptV1
  | StudioDirectorIndeterminateReceiptV1;

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

export type StudioNormalisedRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type StudioCutFilter =
  | { id: 'exposure'; amount: number }
  | { id: 'contrast'; amount: number }
  | { id: 'saturation'; amount: number }
  | { id: 'temperature'; amount: number };

export type StudioCutClip = {
  id: string;
  sceneId: string;
  assetId: string;
  sourceInSeconds: number | null;
  sourceOutSeconds: number | null;
  crop: StudioNormalisedRect | null;
  filters: StudioCutFilter[];
};

export type StudioCut = {
  id: string;
  name: string;
  orderMode: 'storyboard' | 'manual';
  clipOrder: string[];
  clips: Record<string, StudioCutClip>;
};

/** Non-destructive clip decisions the renderer may supply; provenance remains main-owned. */
export type StudioEditableCutClip = Pick<StudioCutClip, 'sourceInSeconds' | 'sourceOutSeconds' | 'crop' | 'filters'>;

/** Cut intent the renderer may supply; cut and clip identities remain main-owned. */
export type StudioEditableCut = Pick<StudioCut, 'orderMode' | 'clipOrder'> & {
  clips: Record<string, StudioEditableCutClip>;
};

export type StudioRoutingPreferences = {
  storyboard: StudioTextModelRef | null;
  image: StudioProviderRef | null;
  video: StudioProviderRef | null;
};

/** The single durable inverse available for the project's most recent rule-list write. */
export type StudioRuleListUndo = {
  capturedRevision: number;
  previousRules: StudioBriefRule[];
};

export type StudioProject = {
  schemaVersion: 1;
  revision: number;
  id: string;
  name: string;
  brief: string;
  /**
   * The executable part of the brief. REQUIRED, not optional: `StudioRendererProject` is
   * `Omit<StudioProject, 'jobs' | 'routing'> & …` and `toRendererProject` declares that return
   * type, so a required field makes omitting it from the projection a tsc error. Optional and it
   * would be persisted, validated, visible to the MCP tools and silently invisible to the renderer —
   * the documented `outputRole` trap (see the warning at :154-159).
   */
  rules: StudioBriefRule[];
  ruleListUndo: StudioRuleListUndo | null;
  forgeProjectId?: string;
  briefConversationId?: string | null;
  aspectRatio: StudioAspectRatio;
  targetDurationSeconds: number;
  resolution: StudioResolution;
  sceneOrder: string[];
  scenes: Record<string, StudioScene>;
  cuts?: Record<string, StudioCut>;
  activeCutId?: string | null;
  assets: Record<string, StudioAsset>;
  jobs: Record<string, StudioJob>;
  routing: StudioRoutingPreferences;
  createdAt: string;
  updatedAt: string;
};

export type StudioRendererRoutingPreferences = {
  storyboard: StudioTextModelRef | null;
  image: StudioMediaChoiceRef | null;
  video: StudioMediaChoiceRef | null;
};

/** Renderer-facing project metadata with nested jobs and media selections sanitized. */
export type StudioRendererProject = Omit<StudioProject, 'jobs' | 'routing'> & {
  jobs: Record<string, StudioRendererJob>;
  routing: StudioRendererRoutingPreferences;
};

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
  seedStillId: string | null;
  selectedTakeId: string | null;
  assetIds: string[];
  jobIds: string[];
};

export type StudioBinItem =
  | { kind: 'beat'; beatId: string; reason: 'lifted' | 'alternate' }
  | { kind: 'shot'; beatId: string; shotId: string; reason: 'lifted' }
  | { kind: 'take'; assetId: string; reason: 'lifted' | 'alternate' };

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
  | 'selected_take'
  | 'seed_still'
  | 'conditioning_frame'
  | 'conditioning_input'
  | 'match_to'
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
  referenceInput: StudioGenerationReferenceInputSnapshot | null;
  conditioningInput: StudioConditioningInputSnapshot | null;
};

export type StudioAuthorizedConditioningDependency =
  | { kind: 'authorized_seed'; upstreamItemId: string; shotId: string }
  | {
      kind: 'authorized_predecessor';
      upstreamItemId: string;
      predecessorShotId: string;
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
  takeAssetId: string;
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
  purpose: 'seed_still' | 'video_take';
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
  purpose: 'seed_still' | 'video_take';
  generationCount: number;
  referenceAssetId: string | null;
};

export type StudioPrepareSubmissionRequestV2 = {
  projectId: string;
  expectedRevision: number;
  originReferenceHandoffId: string | null;
  baseChoices: StudioPrepareGenerationChoiceV2[];
  cascadeChoices: StudioPrepareGenerationChoiceV2[];
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
  purpose: 'seed_still' | 'video_take';
  route: StudioRendererMediaModelRef;
  generationCount: number;
  durationSeconds: number | null;
  oneGenerationMinorUnits: number;
  requestedTotalMinorUnits: number;
  waitsForTakeSelection: boolean;
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
    | { kind: 'generation_gate'; handoffId: string; shotIds: string[] };
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
  shotIds: string[];
  decidedAt: string;
  status: 'open' | 'dismissed' | 'confirmed';
  completedAt: string | null;
};

export type StudioDismissReferenceGenerationHandoffRequestV2 = {
  projectId: string;
  expectedRevision: number;
  handoffId: string;
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
    | 'choose_take'
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

export type StudioTakeActionRequestV2 = {
  projectId: string;
  expectedRevision: number;
  shotId: string;
  assetId: string;
};

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
export type StudioSetMatchToRequestV2 = StudioImportBedAudioRequestV2 & { shotId: string | null };

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

export type StudioRendererChainStatusV2 = {
  projectId: string;
  projectRevision: number;
  conditioningFailures: StudioRendererChainConditioningFailureV2[];
};

export type StudioGetChainStatusRequestV2 = { projectId: string };

export type StudioRendererDirtyShotV2 = {
  shotId: string;
  causes: ('continuity_stale' | 'generation_out_of_date')[];
};

export type StudioRendererParkBlockerCodeV2 =
  | 'current_match_to'
  | 'own_nonterminal_job'
  | 'own_pending_frame'
  | 'downstream_nonterminal_job'
  | 'downstream_pending_frame'
  | 'waiting_authorization_dependency'
  | 'bound_nonterminal_request'
  | 'current_selected_take'
  | 'current_seed_still'
  | 'nonterminal_conditioning_use'
  | 'take_bin_capacity_reached'
  | 'beat_shot_capacity_reached';

export type StudioRendererParkBlockerV2 = {
  shotId: string | null;
  code: StudioRendererParkBlockerCodeV2;
};

export type StudioRendererParkEligibilityV2 = {
  subject: 'beat' | 'shot' | 'take';
  action: 'park' | 'restore';
  beatId: string;
  shotId: string | null;
  assetId: string | null;
  allowed: boolean;
  blockers: StudioRendererParkBlockerV2[];
};

export type StudioGetWorkspaceStatusRequestV2 = { projectId: string };

export type StudioRendererWorkspaceStatusV2 = {
  projectId: string;
  projectRevision: number;
  undoTop: StudioRendererUndoTopV2 | null;
  dirtyShots: StudioRendererDirtyShotV2[];
  cascadeProgress: StudioCascadeProgressV2[];
  parkEligibility: StudioRendererParkEligibilityV2[];
};

export type StudioSpendAuthorization = StudioSubmissionQuote & {
  confirmedAt: string;
  providerBindings: { itemId: string; provider: StudioProviderRef }[];
  idempotencyKeys: { itemId: string; generationIndex: number; key: string }[];
};

export type StudioSpendReceipt = {
  authorizationId: string;
  itemId: string;
  jobId: string;
  purpose: 'seed_still' | 'video_take';
  routeId: string;
  currency: string;
  rateUnit: 'generation' | 'second';
  rateMinorUnits: number;
  durationSeconds: number | null;
  generationIndex: number;
  generationCount: number;
  totalMinorUnits: number;
};

export type StudioMediaKindV2 = 'image' | 'video' | 'audio';

export type StudioManagedAssetRefV2 = {
  collection: 'assets' | 'imports' | 'thumbnails' | 'conditioningFrames';
  fileName: string;
};

export type StudioAssetV2 = Omit<
  StudioAsset,
  | 'sceneId'
  | 'mediaKind'
  | 'managedAsset'
  | 'sourceVisualPrompt'
  | 'sourceReferenceAssetIds'
  | 'sourceAspectRatio'
  | 'sourceResolution'
> & {
  shotId: string | null;
  mediaKind: StudioMediaKindV2;
  managedAsset: StudioManagedAssetRefV2;
  sourceLook?: string;
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
      takeAssetId: string;
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

export type StudioJobV2 = Omit<StudioJob, 'sceneId' | 'status' | 'error' | 'outputRole' | 'referenceInputSnapshot'> & {
  shotId: string;
  status: StudioJobStatusV2;
  error: StudioJobErrorV2 | null;
  purpose: 'seed_still' | 'video_take';
  authorizationId: string;
  authorizationItemId: string;
  generationIndex: number;
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
  | 'generationIndex'
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
        brief: string;
        rules: StudioBriefRule[];
        beatOrder: string[];
        imageRouteId: string | null;
        videoRouteId: string | null;
        spendPolicy: StudioSpendPolicy | null;
        bedAssetId: string | null;
        matchToShotId: string | null;
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
  'name' | 'aspectRatio' | 'resolution' | 'targetDurationSeconds'
>;
export type StudioEditableProjectSettingsChanges = StudioNonEmptyPartial<StudioEditableProjectSettings>;

export type StudioProjectV2 = Omit<
  StudioProject,
  'schemaVersion' | 'sceneOrder' | 'scenes' | 'cuts' | 'activeCutId' | 'assets' | 'jobs' | 'routing' | 'ruleListUndo'
> & {
  schemaVersion: typeof STUDIO_PROJECT_SCHEMA_VERSION;
  beatOrder: string[];
  beats: Record<string, StudioBeat>;
  shots: Record<string, StudioShot>;
  bin: StudioBinItem[];
  bedAssetId: string | null;
  matchToShotId: string | null;
  spendPolicy: StudioSpendPolicy | null;
  spendAuthorizations: StudioSpendAuthorization[];
  frameExtractions: Record<string, StudioFrameExtraction>;
  undoHistory: StudioUndoEntry[];
  imageRouteId: string | null;
  videoRouteId: string | null;
  assets: Record<string, StudioAssetV2>;
  jobs: Record<string, StudioJobV2>;
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
  selectedTakeCount: number;
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
  | { kind: 'trim_shot'; shotId: string; trimInSeconds: number | null; trimOutSeconds: number | null }
  | { kind: 'redetach_line'; shotId: string; line: string }
  | { kind: 'rederive_line'; shotId: string; line: string }
  | { kind: 'restore_line'; shotId: string; historyEntryId: string }
  | { kind: 'park_take'; shotId: string; assetId: string }
  | { kind: 'add_alternate_take'; shotId: string; assetId: string }
  | { kind: 'restore_take'; shotId: string; assetId: string }
  | { kind: 'reorder_bin'; bin: StudioBinItem[] }
  | { kind: 'select_take'; shotId: string; assetId: string }
  | { kind: 'set_routes'; imageRouteId: string | null; videoRouteId: string | null }
  | { kind: 'set_spend_policy'; policy: StudioSpendPolicy | null }
  | { kind: 'set_match_to'; shotId: string | null }
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

/** A complete replacement for the editable storyboard region named by a proposal. */
export type StudioReplaceStoryboardProposalPayload = {
  kind: 'replace_storyboard';
  sceneOrder: string[];
  scenes: Record<string, StudioEditableScene>;
};

/**
 * One rule the Director wants pinned to the project.
 *
 * A rule pin rides the proposal protocol rather than a new pending-record family: the writer, the
 * slot reservation, the CAS on accept, the decision ledger, the three IPC channels and the card in
 * the Director pane all already exist and are all kind-agnostic. What is NOT kind-agnostic is
 * `validateProposalPayload` — see store.ts — which is why the discriminant must be validated
 * per-kind before any record of this shape reaches disk.
 */
export type StudioPinRuleProposalPayload = {
  kind: 'pin_rule';
  rule: {
    text: string;
    predicate: StudioBriefRulePredicate | null;
  };
};

export type StudioProposalPayload = StudioReplaceStoryboardProposalPayload | StudioPinRuleProposalPayload;

export type StudioEditableSceneField = keyof StudioEditableScene;

/** The fields one shot would have rewritten, identified by its 1-based position in the proposed order. */
export type StudioProposalSceneChange = {
  position: number;
  fields: StudioEditableSceneField[];
};

/** What a proposal would change, matched by shot position. Main computes it; nothing else may claim it. */
export type StudioProposalDiff = {
  added: number;
  removed: number;
  changed: StudioProposalSceneChange[];
};

/** Renderer-safe durable proposal state derived from an immutable record and optional decision marker. */
export type StudioProposal = {
  schemaVersion: 1;
  id: string;
  projectId: string;
  status: StudioProposalStatus;
  baseRevision: number;
  payload: StudioProposalPayload;
  createdAt: string;
  decidedAt: string | null;
  /**
   * Frozen at the moment main first saw this proposal against the project it was drafted from, and never
   * recomputed — a diff recomputed after acceptance reads as zero changes. Absent means main never observed
   * the proposal while the project still stood at `baseRevision`, so the truth is unknowable, not empty.
   * The durable record never carries it: `validateProposalRecord` exact-matches its keys.
   */
  diff?: StudioProposalDiff;
};

export type StudioRecordProposalInput = {
  projectId: string;
  proposalId: string;
  baseRevision: number;
  payload: StudioProposalPayload;
};

export type StudioProposalRequest = StudioProjectRequest & {
  proposalId: string;
};

export type StudioProposalAcceptance = {
  proposal: StudioProposal;
  project: StudioRendererProject;
};

/** A reviewed schema-2 proposal delegates its ordered free edits to the shared mutation reducer. */
export type StudioMutationBatchProposalPayloadV2 = {
  kind: 'mutation_batch';
  operations: StudioMutationOperationV2[];
};

export type StudioPinRuleProposalPayloadV2 = StudioPinRuleProposalPayload;

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
  shotIds: string[];
  status: 'pending';
  createdAt: string;
};

export type StudioReferenceRequestSlotV2 = {
  schemaVersion: typeof STUDIO_PROJECT_SCHEMA_VERSION;
  requestId: string;
  reservedAt: string;
};

export type StudioReferenceRequestAuthorityV2 = Pick<StudioReferenceRequestV2, 'id' | 'shotIds'>;

/** A durable request for one scene reference image; generation begins only after renderer approval. */
export type StudioReferenceRequest = {
  schemaVersion: 1;
  id: string;
  projectId: string;
  sceneId: string;
  status: 'pending';
  createdAt: string;
};

export type StudioReferenceRequestAuthority = Pick<StudioReferenceRequest, 'id' | 'sceneId'>;

export type StudioDismissReferenceRequestsRequest = StudioProjectRequest & {
  requestIds: string[];
  /** Both fields are present only for an atomic checked consume before a human-confirmed spend. */
  expectedRevision?: number;
  expectedRequests?: StudioReferenceRequestAuthority[];
};

export type StudioProjectSummary = {
  id: string;
  name: string;
  forgeProjectId?: string;
  aspectRatio: StudioAspectRatio;
  targetDurationSeconds: number;
  resolution: StudioResolution;
  sceneCount: number;
  selectedAssetCount: number;
  poster: {
    assetId: string;
    sceneNumber: number;
    takeNumber: number;
  } | null;
  createdAt: string;
  updatedAt: string;
};

export type CreateStudioProjectInput = {
  name: string;
  brief: string;
  forgeProjectId?: string;
  aspectRatio: StudioAspectRatio;
  targetDurationSeconds: number;
  resolution: StudioResolution;
};

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

export type StudioConnectionCandidate = {
  providerId: string;
  providerName: string;
  models: StudioConnectionCandidateModel[];
};

export type StudioConnectionIntegrationLabelKey =
  | 'imageApi'
  | 'bytePlusSeedance'
  | 'selfHostedVideoGateway'
  | 'openRouterVideo';

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

export type StudioConnectionValidationResult = Omit<StudioConnectionRecord, 'bindingId'>;

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

export type StudioRouteCatalog = {
  storyboard: {
    status: StudioModelAvailability;
    selected: StudioTextModelRef | null;
    options: StudioTextModelOption[];
  };
  image: StudioMediaRouteCatalog;
  video: StudioMediaRouteCatalog;
  catalogVersion: string;
};

export type StudioCommandErrorCode =
  | 'feature_disabled'
  | 'invalid_payload'
  | 'not_found'
  | 'storyboard_exists'
  | 'stale_project'
  | 'planning_unavailable'
  | 'invalid_route'
  | 'rule_breach'
  | 'cancellation_refused'
  | 'duplicate_charge_acknowledgement_required'
  | 'unsupported'
  | 'busy'
  | 'ffmpeg_unavailable'
  | 'render_failed'
  | 'no_renderable_scenes'
  | 'cancelled'
  | 'provider_error'
  | 'storage_error';

export type StudioCommandResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      error: {
        code: StudioCommandErrorCode;
        messageKey: string;
      };
    };

export type StudioProjectRequest = {
  projectId: string;
};

export type StudioRenderErrorCode =
  | 'busy'
  | 'ffmpeg_unavailable'
  | 'render_failed'
  | 'no_renderable_scenes'
  | 'cancelled';

export type StudioRenderCutResult = { assetId: string; missingSceneIds: string[] };

export type StudioCancelRenderResult = { cancelled: boolean };

export type StudioRenderProgressEvent =
  | {
      projectId: string;
      status: 'running';
      progress: number;
      /** Optional so renderer boundaries remain compatible with renders started before an upgrade. */
      clipIndex?: number;
      clipTotal?: number;
    }
  | (StudioRenderCutResult & { projectId: string; status: 'succeeded'; progress: 1 })
  | {
      projectId: string;
      status: 'failed';
      progress: number;
      errorCode: Exclude<StudioRenderErrorCode, 'busy' | 'cancelled'>;
      missingSceneIds?: string[];
      clipIndex?: number;
      clipTotal?: number;
    }
  | { projectId: string; status: 'cancelled'; progress: number; missingSceneIds: string[] };

export type StudioLatestRender = { fileName: 'cut.mp4'; renderedAt: string };

export type ProposeStudioStoryboardInput = StudioProjectRequest & {
  expectedRevision: number;
  replaceExisting: boolean;
};

export type StudioDeleteProjectRequest = StudioProjectRequest & {
  expectedRevision: number;
};

export type StudioUpdateProjectRequest = StudioProjectRequest & {
  expectedRevision: number;
  name?: string;
  brief?: string;
  aspectRatio?: StudioAspectRatio;
  targetDurationSeconds?: number;
  resolution?: StudioResolution;
};

export type StudioBindBriefConversationRequest = StudioProjectRequest & {
  expectedRevision: number;
  conversationId: string | null;
};

/** Replaces the project's whole rule list. Main mints scope and createdAt; ids come from the caller. */
export type StudioSetBriefRulesRequest = StudioProjectRequest & {
  expectedRevision: number;
  rules: StudioBriefRuleDraft[];
};

export type StudioUpdateCutRequest = StudioProjectRequest & {
  expectedRevision: number;
  cutId: string;
  cut: StudioEditableCut;
};

export type StudioPlaceCutScenesRequest = StudioProjectRequest & {
  expectedRevision: number;
  cutId: string;
  sceneIds: string[];
  beforeClipId: string | null;
};

export type StudioModelSelectionChange =
  | {
      role: 'storyboard';
      selection: StudioTextModelRef | null;
    }
  | {
      role: 'image' | 'video';
      selection: Pick<StudioMediaChoiceRef, 'choiceId'> | null;
    };

export type StudioUpdateModelSelectionRequest = StudioProjectRequest & {
  expectedRevision: number;
  role: StudioModelSelectionChange['role'];
  selection: StudioTextModelRef | Pick<StudioMediaChoiceRef, 'choiceId'> | null;
};

export type StudioUpdateSceneRequest = StudioProjectRequest & {
  sceneId: string;
  expectedRevision: number;
  scene: StudioEditableScene | null;
};

export type StudioReorderScenesRequest = StudioProjectRequest & {
  expectedRevision: number;
  sceneOrder: string[];
};

export type StudioAssetRequest = StudioProjectRequest & {
  assetId: string;
};

export type StudioPersistCapturedPosterRequest = StudioProjectRequest & {
  sceneId: string;
  videoAssetId: string;
  dataUrl: string;
  width: number;
  height: number;
};

export type StudioSelectVariationRequest = StudioProjectRequest & {
  sceneId: string;
  assetId: string;
  expectedRevision: number;
};

export type StudioSelectAssetRequest = StudioSelectVariationRequest;

export type StudioJobRequest = StudioProjectRequest & {
  jobId: string;
  expectedRevision: number;
};

export type StudioRetryJobRequest = StudioJobRequest & {
  acknowledgePossibleDuplicateCharge?: boolean;
};

export type StudioRetryDownloadRequest = StudioJobRequest;

export type StudioSceneGenerationChoice = {
  sceneId: string;
  choiceId: string;
  kind: StudioMediaKind;
};

export type StudioGenerationSubmitMode = 'single' | 'batch';

/** The picture one scene's reference plate should paint. A plate is that scene's first frame, so
 *  the prompt is per scene: a batch-wide prompt would paint every scene the same. */
export type StudioSceneReferencePrompt = {
  sceneId: string;
  prompt: string;
};

export type StudioSubmitScenesRequest = StudioProjectRequest & {
  mode: StudioGenerationSubmitMode;
  sceneIds: string[];
  expectedRevision: number;
  routes: StudioSceneGenerationChoice[];
  catalogVersion: string;
  /** Absent means 'take'. Batch submissions may request 'reference' across multiple scenes, same as single mode. */
  outputRole?: StudioOutputRole;
  /** Required by, and only valid with, outputRole: 'reference' — exactly one entry per submitted scene. */
  referencePrompts?: StudioSceneReferencePrompt[];
};

export type StudioFitStoryboardRequest = StudioProjectRequest & {
  expectedRevision: number;
  catalogVersion: string;
};

export type StudioFitStoryboardOutcome =
  | {
      status: 'applied';
      project: StudioRendererProject;
      changedSceneIds: string[];
      lockedSceneIds: string[];
    }
  | {
      status: 'already_matches';
      project: StudioRendererProject;
      changedSceneIds: [];
      lockedSceneIds: string[];
    }
  | {
      status: 'unreachable';
      reason: 'route_unavailable';
      project: StudioRendererProject;
      lockedSceneIds: string[];
      unavailableSceneIds: string[];
    }
  | {
      status: 'unreachable';
      reason: 'no_adjustable_scenes';
      project: StudioRendererProject;
      lockedSceneIds: string[];
      fixedTotalSeconds: number;
    }
  | {
      status: 'unreachable';
      reason: 'target_out_of_bounds';
      project: StudioRendererProject;
      lockedSceneIds: string[];
      minimumTotalSeconds: number;
      maximumTotalSeconds: number;
    };

export type StudioChooseAndImportReferenceRequest = StudioProjectRequest & {
  sceneId?: string;
  briefReferenceRole?: StudioBriefReferenceRole;
  expectedRevision: number;
};

export type StudioDetachBriefReferenceRequest = StudioProjectRequest & {
  assetId: string;
  expectedRevision: number;
};

export type StudioChooseAndExportAssetsRequest = StudioProjectRequest & {
  includeReferences: boolean;
};

export type StudioListRoutesRequest = { projectId?: string };

export type StudioValidateConnectionRequest = {
  providerId: string;
  integrationId: string;
  model: string;
};

export type StudioSaveConnectionRequest = StudioValidateConnectionRequest;

export type StudioRemoveConnectionRequest = { bindingId: string };

export type StudioImportOutcome =
  | { status: 'imported'; asset: StudioAsset; project: StudioRendererProject }
  | { status: 'cancelled' };

export type StudioExportItem = { assetId: string; fileName: string };

export type StudioExportOutcome =
  | { status: 'exported'; folderName: string; exported: StudioExportItem[]; missingSceneIds: string[] }
  | { status: 'cancelled' };

/** The renderer-facing native API. Inputs and outputs contain IDs and metadata only. */
export type StudioDesktopApi = {
  listProjects(): Promise<StudioCommandResult<StudioProjectSummary[]>>;
  createProject(input: CreateStudioProjectInput): Promise<StudioCommandResult<StudioRendererProject>>;
  getProject(input: StudioProjectRequest): Promise<StudioCommandResult<StudioRendererProject | null>>;
  getBriefSessionServer(input: StudioProjectRequest): Promise<StudioCommandResult<ISessionMcpServer>>;
  proposeStoryboard(input: ProposeStudioStoryboardInput): Promise<StudioCommandResult<StudioRendererProject>>;
  updateModelSelection(input: StudioUpdateModelSelectionRequest): Promise<StudioCommandResult<StudioRendererProject>>;
  updateProject(input: StudioUpdateProjectRequest): Promise<StudioCommandResult<StudioRendererProject>>;
  bindBriefConversation(input: StudioBindBriefConversationRequest): Promise<StudioCommandResult<StudioRendererProject>>;
  updateCut(input: StudioUpdateCutRequest): Promise<StudioCommandResult<StudioRendererProject>>;
  placeCutScenes(input: StudioPlaceCutScenesRequest): Promise<StudioCommandResult<StudioRendererProject>>;
  deleteProject(input: StudioDeleteProjectRequest): Promise<StudioCommandResult<boolean>>;
  updateScene(input: StudioUpdateSceneRequest): Promise<StudioCommandResult<StudioRendererProject>>;
  reorderScenes(input: StudioReorderScenesRequest): Promise<StudioCommandResult<StudioRendererProject>>;
  selectAsset(input: StudioSelectAssetRequest): Promise<StudioCommandResult<StudioRendererProject>>;
  persistCapturedPoster(input: StudioPersistCapturedPosterRequest): Promise<StudioCommandResult<StudioAsset>>;
  chooseAndImportReference(
    input: StudioChooseAndImportReferenceRequest
  ): Promise<StudioCommandResult<StudioImportOutcome>>;
  detachBriefReference(input: StudioDetachBriefReferenceRequest): Promise<StudioCommandResult<StudioRendererProject>>;
  selectVariation(input: StudioSelectVariationRequest): Promise<StudioCommandResult<StudioRendererProject>>;
  submitScenes(input: StudioSubmitScenesRequest): Promise<StudioCommandResult<StudioRendererJob[]>>;
  fitStoryboard(input: StudioFitStoryboardRequest): Promise<StudioCommandResult<StudioFitStoryboardOutcome>>;
  cancelJob(input: StudioJobRequest): Promise<StudioCommandResult<StudioRendererJob>>;
  retryJob(input: StudioRetryJobRequest): Promise<StudioCommandResult<StudioRendererJob>>;
  retryDownload(input: StudioRetryDownloadRequest): Promise<StudioCommandResult<StudioRendererJob>>;
  chooseAndExportAssets(input: StudioChooseAndExportAssetsRequest): Promise<StudioCommandResult<StudioExportOutcome>>;
  renderCut(input: StudioProjectRequest): Promise<StudioCommandResult<StudioRenderCutResult>>;
  cancelRender(input: StudioProjectRequest): Promise<StudioCommandResult<StudioCancelRenderResult>>;
  listConnectionCandidates(): Promise<StudioCommandResult<StudioConnectionCandidate[]>>;
  listConnections(): Promise<StudioCommandResult<StudioConnectionInventory>>;
  validateConnection(
    input: StudioValidateConnectionRequest
  ): Promise<StudioCommandResult<StudioConnectionValidationResult>>;
  saveConnection(input: StudioSaveConnectionRequest): Promise<StudioCommandResult<StudioConnectionRecord>>;
  removeConnection(input: StudioRemoveConnectionRequest): Promise<StudioCommandResult<boolean>>;
  listRoutes(input?: StudioListRoutesRequest): Promise<StudioCommandResult<StudioRouteCatalog>>;
};
