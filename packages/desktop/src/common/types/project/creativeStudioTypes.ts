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
export const STUDIO_MAX_SECTIONS = 24;
export const STUDIO_MAX_CLIPS_PER_SECTION = 8;
export const STUDIO_MAX_CLIPS_PER_PROJECT = 96;
export const STUDIO_MAX_SHELF_ITEMS = 120;
export const STUDIO_MAX_SHELF_SECTION_ITEMS = 24;
export const STUDIO_MAX_SHELF_TAKE_ALIASES = 96;
export const STUDIO_MAX_GENERATION_CLIPS_PER_REQUEST = 24;
export const STUDIO_MAX_REFERENCE_REQUEST_CLIPS = 24;
export const STUDIO_MAX_CUT_PLACEMENT_CLIPS = 96;
export const STUDIO_MAX_DIRTY_CLIPS_REPORTED = 96;
export const STUDIO_MAX_MCP_AVAILABLE_TAKE_IDS_PER_CLIP = 24;
export const STUDIO_MIN_VIDEO_CLIP_SECONDS = 4;
export const STUDIO_MAX_VIDEO_CLIP_SECONDS = 15;
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

export type StudioAssetV2 = Omit<StudioAsset, 'sceneId'> & {
  clipId: string | null;
};

export type StudioJobV2 = Omit<StudioJob, 'sceneId'> & {
  clipId: string;
};

export type StudioRendererJobV2 = Omit<
  StudioJobV2,
  'provider' | 'idempotencyKey' | 'providerJobId' | 'remoteStartedAt' | 'cancellationPolicy' | 'referenceInputSnapshot'
> & {
  provider: StudioRendererMediaModelRef;
  canCancel: boolean;
  canRetryDownload: boolean;
};

export type StudioSection = {
  id: string;
  title: string;
  storyLine: string;
  visualPrompt: string;
  clipOrder: string[];
};

export type StudioClip = {
  id: string;
  shotPrompt: string;
  narration: string;
  onScreenText: string;
  mediaKind: StudioMediaKind;
  durationSeconds: number;
  referenceAssetId: string | null;
  selectedAssetId: string | null;
  assetIds: string[];
  jobIds: string[];
};

export type StudioShelfItem = { kind: 'section'; sectionId: string } | { kind: 'asset'; assetId: string };

export type StudioEditableSection = Pick<StudioSection, 'title' | 'storyLine' | 'visualPrompt'>;

export type StudioEditableClip = Pick<
  StudioClip,
  'shotPrompt' | 'narration' | 'onScreenText' | 'mediaKind' | 'durationSeconds' | 'referenceAssetId'
>;

type StudioNonEmptyPartial<T> = {
  [Key in keyof T]-?: Required<Pick<T, Key>> & Partial<Omit<T, Key>>;
}[keyof T];

export type StudioEditableSectionChanges = StudioNonEmptyPartial<StudioEditableSection>;
export type StudioEditableClipChanges = StudioNonEmptyPartial<StudioEditableClip>;

export type StudioCutClipV2 = Omit<StudioCutClip, 'sceneId'> & {
  clipId: string;
};

export type StudioCutV2 = Omit<StudioCut, 'clips'> & {
  clips: Record<string, StudioCutClipV2>;
};

export type StudioRoutingPreferencesV2 = {
  image: StudioMediaModelRef | null;
  video: StudioMediaModelRef | null;
};

export type StudioRendererRoutingPreferencesV2 = {
  image: StudioRendererMediaModelRef | null;
  video: StudioRendererMediaModelRef | null;
};

export type StudioProjectV2 = Omit<
  StudioProject,
  'schemaVersion' | 'sceneOrder' | 'scenes' | 'cuts' | 'activeCutId' | 'assets' | 'jobs' | 'routing'
> & {
  schemaVersion: 2;
  sectionOrder: string[];
  sections: Record<string, StudioSection>;
  clips: Record<string, StudioClip>;
  shelf: StudioShelfItem[];
  cuts: Record<string, StudioCutV2>;
  activeCutId: string | null;
  assets: Record<string, StudioAssetV2>;
  jobs: Record<string, StudioJobV2>;
  routing: StudioRoutingPreferencesV2;
};

export type StudioRendererProjectV2 = Omit<StudioProjectV2, 'jobs' | 'routing'> & {
  jobs: Record<string, StudioRendererJobV2>;
  routing: StudioRendererRoutingPreferencesV2;
};

export type StudioProjectSummaryV2 = {
  id: string;
  name: string;
  forgeProjectId?: string;
  aspectRatio: StudioAspectRatio;
  targetDurationSeconds: number;
  resolution: StudioResolution;
  sectionCount: number;
  clipCount: number;
  selectedAssetCount: number;
  poster?: {
    sectionId: string;
    clipId: string;
    assetId: string;
    sectionPosition: number;
    clipPosition: number;
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
  | { kind: 'set_brief'; brief: string }
  | {
      kind: 'add_section';
      sectionId: string;
      section: StudioEditableSection;
      firstClipId: string;
      firstClip: StudioEditableClip;
      beforeSectionId: string | null;
    }
  | { kind: 'edit_section'; sectionId: string; changes: StudioEditableSectionChanges }
  | { kind: 'reorder_sections'; sectionOrder: string[] }
  | { kind: 'park_section'; sectionId: string }
  | { kind: 'restore_section'; sectionId: string; beforeSectionId: string | null }
  | {
      kind: 'add_clip';
      sectionId: string;
      clipId: string;
      clip: StudioEditableClip;
      beforeClipId: string | null;
    }
  | { kind: 'edit_clip'; clipId: string; changes: StudioEditableClipChanges }
  | { kind: 'delete_clip'; clipId: string }
  | { kind: 'reorder_clips'; sectionId: string; clipOrder: string[] }
  | { kind: 'park_take'; clipId: string; assetId: string }
  | { kind: 'select_shelved_take'; clipId: string; assetId: string }
  | { kind: 'remove_shelf_alias'; assetId: string }
  | { kind: 'reorder_shelf'; shelf: StudioShelfItem[] }
  | { kind: 'select_take'; clipId: string; assetId: string };

export type StudioMutationBatchV2 = {
  schemaVersion: 2;
  projectId: string;
  expectedRevision: number;
  operations: StudioMutationOperationV2[];
};

export type StudioMutationBatchResultV2 = {
  project: StudioRendererProjectV2;
  createdSectionIds: string[];
  createdClipIds: string[];
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
