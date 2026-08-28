/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  STUDIO_DIRECTOR_COMMAND_CLOCK_SKEW_MS,
  STUDIO_DIRECTOR_COMMAND_MAX_RECORD_BYTES,
  STUDIO_DIRECTOR_COMMAND_MAX_RECEIPT_BYTES,
  STUDIO_DIRECTOR_COMMAND_SCHEMA_VERSION_V2,
  STUDIO_DIRECTOR_COMMAND_SLOT_LEASE_MS,
  STUDIO_PROJECT_STATUS_BLOCKER_CAUSES_V2,
  STUDIO_PROJECT_STATUS_STAGE_ORDER_V2,
  STUDIO_REFERENCE_BINDING_FAILURE_REASONS_V2,
  STUDIO_MAX_MUTATION_OPERATIONS,
  STUDIO_MAX_PROJECT_REFERENCES,
  STUDIO_MAX_SHOT_SECONDS,
  STUDIO_MIN_SHOT_SECONDS,
  STUDIO_PROPOSAL_SCHEMA_VERSION_V2,
  STUDIO_REFERENCE_REQUEST_SCHEMA_VERSION,
  STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
  STUDIO_DIRECTOR_OPERATION_DISPOSITIONS_V2,
  type StudioDirectorCommandReceiptV2,
  type StudioDirectorCommandRecordV2,
  type StudioDirectorFreeRecoveryAppliedReceiptV2,
  type StudioDirectorFreeRecoveryCommandRecordV2,
  type StudioDirectorFreeRecoveryV2,
  type StudioDirectorQueryCommandRecordV2,
  type StudioDirectorQueryReceiptV2,
  type StudioDirectorQueryV2,
  type StudioDirectorCommandSlotLeaseV2,
  type StudioDirectorCommandSlotV2,
  type StudioDirectorOperationV2,
  type StudioDirectorOperationDispositionV2,
  type StudioMutationOperationV2,
  type StudioProposalDecisionV2,
  type StudioProposalRecordV2,
  type StudioProposalSlotV2,
  type StudioReferenceGenerationHandoffReceiptV2,
  type StudioReferenceRequestDecisionV2,
  type StudioReferenceRequestSlotV2,
  type StudioReferenceRequestV2,
} from '@/common/types/project/creativeStudioTypes';
import { hasRuleToken, STUDIO_RULE_LIMITS } from '@/common/types/project/creativeStudioRules';
import { validateStudioMutationOperationV2 } from './schema2/mutations';

type JsonRecord = Record<string, unknown>;

const SAFE_ID = /^[A-Za-z0-9_-]{1,256}$/;
const COMMAND_BASE_KEYS = ['schemaVersion', 'commandId', 'projectId', 'createdAt', 'deadlineAt', 'policy'] as const;
const AUTO_APPLY_COMMAND_KEYS = new Set([...COMMAND_BASE_KEYS, 'expectedRevision', 'operations']);
const FREE_FIX_COMMAND_KEYS = new Set([...COMMAND_BASE_KEYS, 'expectedRevision', 'recovery']);
const PROJECT_STATUS_COMMAND_KEYS = new Set([...COMMAND_BASE_KEYS, 'detail']);
const LIST_ROUTES_COMMAND_KEYS = new Set(COMMAND_BASE_KEYS);
const GET_PROPOSAL_COMMAND_KEYS = new Set([...COMMAND_BASE_KEYS, 'proposalId']);
const SLOT_KEYS = new Set(['schemaVersion', 'commandId', 'reservedAt', 'deadlineAt']);
const SLOT_LEASE_KEYS = new Set([
  'schemaVersion',
  'leaseId',
  'owner',
  'commandId',
  'reservedAt',
  'deadlineAt',
  'acquiredAt',
  'expiresAt',
]);
const TERMINAL_RECEIPT_KEYS = new Set([
  'schemaVersion',
  'commandId',
  'projectId',
  'expectedRevision',
  'decidedAt',
  'status',
  'observedRevision',
  'reasonCode',
]);
const QUERY_ANSWERED_RECEIPT_KEYS = new Set([
  'schemaVersion',
  'commandId',
  'projectId',
  'decidedAt',
  'status',
  'query',
  'result',
]);
const QUERY_TERMINAL_RECEIPT_KEYS = new Set([
  'schemaVersion',
  'commandId',
  'projectId',
  'decidedAt',
  'status',
  'query',
  'reasonCode',
]);
const PROJECT_STATUS_QUERY_KEYS = new Set(['kind', 'detail']);
const LIST_ROUTES_QUERY_KEYS = new Set(['kind']);
const GET_PROPOSAL_QUERY_KEYS = new Set(['kind', 'proposalId']);
const PENDING_PROPOSAL_LOOKUP_KEYS = new Set(['status', 'proposal']);
const TERMINAL_PROPOSAL_LOOKUP_KEYS = new Set(['status', 'proposalId', 'decision']);
const MISSING_PROPOSAL_LOOKUP_KEYS = new Set(['status']);

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const isSafeStudioDirectorId = (value: unknown): value is string =>
  typeof value === 'string' && SAFE_ID.test(value);

const isRevision = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;

const isNullableRevision = (value: unknown): value is number | null => value === null || isRevision(value);

const timestampMs = (value: unknown): number | null => {
  if (typeof value !== 'string' || value.length !== 24) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value ? parsed : null;
};

const fitsCommandRecord = (value: unknown): boolean => {
  try {
    return Buffer.byteLength(JSON.stringify(value), 'utf8') <= STUDIO_DIRECTOR_COMMAND_MAX_RECORD_BYTES;
  } catch {
    return false;
  }
};

const fitsCommandReceipt = (value: unknown): boolean => {
  try {
    return Buffer.byteLength(JSON.stringify(value), 'utf8') <= STUDIO_DIRECTOR_COMMAND_MAX_RECEIPT_BYTES;
  } catch {
    return false;
  }
};

const fitsReferenceRequestRecordV2 = (value: unknown): boolean => {
  try {
    return Buffer.byteLength(JSON.stringify(value), 'utf8') <= STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES;
  } catch {
    return false;
  }
};

export type StudioDirectorCommandParseResultV2 =
  | { status: 'valid'; record: StudioDirectorCommandRecordV2 }
  | { status: 'unsupported_prototype_schema'; commandId: string; expectedRevision: number | null }
  | {
      status: 'invalid';
      commandId: string;
      expectedRevision: number | null;
      reasonCode: 'malformed_record' | 'unsupported_version';
    };

/** Tri-state sidecar result keeps schema-1 bytes distinct from malformed schema-2 storage. */
export type StudioDirectorSidecarParseResultV2<RecordType> =
  | { status: 'valid'; record: RecordType }
  | { status: 'unsupported_prototype_schema' }
  | { status: 'invalid' };

type SidecarSchemaV2 = 'v1' | 'v2' | 'other' | 'missing';

const V2_APPLIED_RECEIPT_KEYS = new Set([
  'schemaVersion',
  'commandId',
  'projectId',
  'expectedRevision',
  'decidedAt',
  'status',
  'appliedRevision',
  'createdBeatIds',
  'createdShotIds',
]);
const V2_FREE_FIX_APPLIED_RECEIPT_KEYS = new Set([
  'schemaVersion',
  'commandId',
  'projectId',
  'expectedRevision',
  'decidedAt',
  'status',
  'appliedRevision',
  'recovery',
]);
const V2_REJECTION_CODES = new Set([
  'malformed_record',
  'unsupported_version',
  'operation_not_permitted',
  'stale_revision',
  'future_revision',
  'project_not_found',
  'beat_capacity_reached',
  'beat_shot_capacity_reached',
  'project_shot_capacity_reached',
  'invalid_shot_duration',
  'dependency_blocked',
  'identity_collision',
  'invalid_operation',
  'validation_failed',
]);
const V2_EXPIRY_CODES = new Set(['deadline_elapsed', 'expired_after_restart']);
const V2_INDETERMINATE_CODES = new Set(['commit_attribution_unknown', 'indeterminate_after_restart']);
const V2_QUERY_FAILURE_CODES = new Set([
  'project_not_found',
  'unsupported_prototype_schema',
  'route_inventory_unavailable',
  'project_read_unavailable',
  'response_too_large',
  'result_mismatch',
]);
const V2_NULLABLE_EXPECTED_REVISION_CODES = new Set(['malformed_record', 'unsupported_version']);
const V2_PROPOSAL_RECORD_KEYS = new Set([
  'schemaVersion',
  'id',
  'projectId',
  'status',
  'baseRevision',
  'payload',
  'createdAt',
  'decidedAt',
]);
const V2_PROPOSAL_MUTATION_PAYLOAD_KEYS = new Set(['kind', 'operations']);
const V2_PROPOSAL_PIN_RULE_PAYLOAD_KEYS = new Set(['kind', 'rule']);
const V2_PROPOSAL_RULE_KEYS = new Set(['text', 'predicate']);
const V2_RULE_PREDICATE_KEYS = new Set(['kind', 'terms']);
const V2_PROPOSAL_DECISION_KEYS = new Set(['schemaVersion', 'proposalId', 'status', 'decidedAt']);
const V2_PROPOSAL_SLOT_KEYS = new Set(['schemaVersion', 'proposalId', 'reservedAt']);
const V2_REFERENCE_REQUEST_KEYS = new Set(['schemaVersion', 'id', 'projectId', 'referenceIds', 'status', 'createdAt']);
const V2_REFERENCE_SLOT_KEYS = new Set(['schemaVersion', 'requestId', 'reservedAt']);
const V2_REFERENCE_DECISION_KEYS = new Set(['schemaVersion', 'requestId', 'projectId', 'decidedAt', 'outcome']);
const V2_REFERENCE_REJECTED_OUTCOME_KEYS = new Set(['kind']);
const V2_REFERENCE_GENERATION_OUTCOME_KEYS = new Set(['kind', 'handoffId', 'referenceIds']);
const V2_REFERENCE_HANDOFF_RECEIPT_KEYS = new Set(['schemaVersion', 'handoffId', 'requestId', 'completedAt', 'result']);
const V2_REFERENCE_DISMISSED_RESULT_KEYS = new Set(['kind']);
const V2_REFERENCE_CONFIRMED_RESULT_KEYS = new Set(['kind', 'authorizationId']);
const V2_PROPOSAL_DECISION_STATUSES = new Set(['accepted', 'rejected', 'expired']);

const sidecarSchemaV2 = (value: unknown, currentVersion: number): SidecarSchemaV2 => {
  try {
    if (!isRecord(value)) return 'missing';
    const descriptor = Object.getOwnPropertyDescriptor(value, 'schemaVersion');
    if (descriptor === undefined || !Object.hasOwn(descriptor, 'value')) return 'missing';
    if (
      typeof descriptor.value === 'number' &&
      Number.isSafeInteger(descriptor.value) &&
      descriptor.value >= 1 &&
      descriptor.value < currentVersion
    ) {
      return 'v1';
    }
    if (descriptor.value === currentVersion) return 'v2';
    return 'other';
  } catch {
    return 'missing';
  }
};

const hasOnlyDataPropertiesDeepV2 = (value: unknown, seen = new Set<object>()): boolean => {
  if (typeof value === 'function') return false;
  if (typeof value !== 'object' || value === null) return true;
  if (seen.has(value)) return true;
  seen.add(value);
  try {
    const prototype = Object.getPrototypeOf(value);
    const isArray = Array.isArray(value);
    if (
      (isArray && prototype !== Array.prototype) ||
      (!isArray && prototype !== Object.prototype && prototype !== null)
    ) {
      return false;
    }
    for (const key of Reflect.ownKeys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (
        typeof key !== 'string' ||
        descriptor === undefined ||
        !Object.hasOwn(descriptor, 'value') ||
        (descriptor.enumerable !== true && !(isArray && key === 'length'))
      ) {
        return false;
      }
      if (!hasOnlyDataPropertiesDeepV2(descriptor.value, seen)) return false;
    }
    return true;
  } catch {
    return false;
  }
};

const snapshotDataRecordV2 = (value: unknown): JsonRecord | null => {
  try {
    if (!isRecord(value) || !hasOnlyDataPropertiesDeepV2(value)) return null;
    const snapshot: unknown = structuredClone(value);
    return isRecord(snapshot) && hasOnlyDataPropertiesDeepV2(snapshot) ? snapshot : null;
  } catch {
    return null;
  }
};

/** Descriptor-safe snapshot for service results before any JSON byte measurement. */
export const snapshotStudioDirectorQueryResultV2 = (value: unknown): unknown | null => snapshotDataRecordV2(value);

const hasExactKeysV2 = (value: JsonRecord, keys: ReadonlySet<string>): boolean => {
  try {
    const actualKeys = Reflect.ownKeys(value);
    return actualKeys.length === keys.size && actualKeys.every((key) => typeof key === 'string' && keys.has(key));
  } catch {
    return false;
  }
};

const parseDirectorQueryV2 = (value: unknown): StudioDirectorQueryV2 | null => {
  const record = snapshotDataRecordV2(value);
  if (record === null) return null;
  if (
    hasExactKeysV2(record, PROJECT_STATUS_QUERY_KEYS) &&
    record.kind === 'get_project_status' &&
    typeof record.detail === 'boolean'
  ) {
    return { kind: 'get_project_status', detail: record.detail };
  }
  if (hasExactKeysV2(record, LIST_ROUTES_QUERY_KEYS) && record.kind === 'list_routes') {
    return { kind: 'list_routes' };
  }
  if (
    hasExactKeysV2(record, GET_PROPOSAL_QUERY_KEYS) &&
    record.kind === 'get_proposal' &&
    isSafeStudioDirectorId(record.proposalId)
  ) {
    return { kind: 'get_proposal', proposalId: record.proposalId };
  }
  return null;
};

const validatesProposalLookupV2 = (value: unknown, projectId: string, proposalId: string): boolean => {
  const result = snapshotDataRecordV2(value);
  if (result === null || typeof result.status !== 'string') return false;
  if (result.status === 'not_found') return hasExactKeysV2(result, MISSING_PROPOSAL_LOOKUP_KEYS);
  if (result.status === 'pending') {
    return (
      hasExactKeysV2(result, PENDING_PROPOSAL_LOOKUP_KEYS) &&
      parseStudioProposalRecordV2({ projectId, proposalId, value: result.proposal }).status === 'valid'
    );
  }
  return (
    result.status === 'no_longer_pending' &&
    hasExactKeysV2(result, TERMINAL_PROPOSAL_LOOKUP_KEYS) &&
    result.proposalId === proposalId &&
    typeof result.decision === 'string' &&
    V2_PROPOSAL_DECISION_STATUSES.has(result.decision)
  );
};

const isNonnegativeSafeIntegerV2 = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

const isFiniteNonnegativeV2 = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

const isBoundedSafeTextV2 = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= 256 &&
  value === value.trim() &&
  !Array.from(value).some((character) => {
    const point = character.codePointAt(0) ?? 0;
    return point <= 0x1f || (point >= 0x7f && point <= 0x9f) || (point >= 0xd800 && point <= 0xdfff);
  });

const isNullableSafeIdV2 = (value: unknown): value is string | null => value === null || isSafeStudioDirectorId(value);

const MODEL_AVAILABILITIES_V2: ReadonlySet<unknown> = new Set([
  'ready',
  'selection_required',
  'setup_required',
  'unavailable',
]);
const JOB_STATUSES_V2: ReadonlySet<unknown> = new Set([
  'waiting_for_conditioning',
  'queued_local',
  'submitting',
  'queued_remote',
  'running',
  'needs_attention',
  'succeeded',
  'failed',
  'cancelled',
]);
const JOB_ERRORS_V2: ReadonlySet<unknown> = new Set([
  'invalid_request',
  'content_rejected',
  'auth',
  'quota',
  'rate_limited',
  'provider_unavailable',
  'timeout',
  'poll_deadline',
  'no_output',
  'seed_still_variation_grid',
  'submission_unknown',
  'download_failed',
  'unsupported',
  'unknown',
  'dependency_failed',
]);
const OWNER_REASONS_V2: ReadonlySet<unknown> = new Set([
  'select_engine',
  'configure_engine',
  'repair_engine_health',
  'choose_compatible_engine',
  'approve_reference',
  'select_seed',
  'review_project_data',
  'review_job_recovery',
  'acknowledge_possible_duplicate_charge',
  'retry_download',
  'edit_cut',
  'replace_audio_bed',
]);
const ASPECT_RATIOS_V2: ReadonlySet<unknown> = new Set(['16:9', '9:16', '1:1', '4:3', '3:4']);
const RESOLUTIONS_V2: ReadonlySet<unknown> = new Set(['720p', '1080p']);
const INTEGRATION_LABELS_V2: ReadonlySet<unknown> = new Set([
  'imageApi',
  'bytePlusSeedance',
  'selfHostedVideoGateway',
  'openRouterVideo',
]);

const validatesGenerationChoiceV2 = (value: unknown): boolean => {
  const choice = snapshotDataRecordV2(value);
  if (choice === null || !hasExactKeysV2(choice, new Set(['target', 'purpose']))) return false;
  const target = snapshotDataRecordV2(choice.target);
  return (
    target !== null &&
    hasExactKeysV2(target, new Set(['kind', 'shotId'])) &&
    target.kind === 'shot' &&
    isSafeStudioDirectorId(target.shotId) &&
    (choice.purpose === 'seed_still' || choice.purpose === 'board_still' || choice.purpose === 'video_take')
  );
};

const validatesPrepareIntentV2 = (value: unknown): boolean => {
  const prepare = snapshotDataRecordV2(value);
  if (prepare === null) return false;
  if (prepare.kind === 'project_references') {
    return (
      hasExactKeysV2(prepare, new Set(['kind', 'referenceIds'])) &&
      isUniqueSafeIdArrayV2(prepare.referenceIds, 1, STUDIO_MAX_PROJECT_REFERENCES)
    );
  }
  if (
    prepare.kind !== 'generation' ||
    !hasExactKeysV2(prepare, new Set(['kind', 'baseChoices', 'cascadeChoices', 'continuityChange'])) ||
    !isDenseArrayV2(prepare.baseChoices, 0, STUDIO_MAX_MUTATION_OPERATIONS) ||
    !isDenseArrayV2(prepare.cascadeChoices, 0, STUDIO_MAX_MUTATION_OPERATIONS) ||
    !prepare.baseChoices.every(validatesGenerationChoiceV2) ||
    !prepare.cascadeChoices.every(validatesGenerationChoiceV2)
  ) {
    return false;
  }
  if (prepare.continuityChange === null) return prepare.baseChoices.length > 0;
  const change = snapshotDataRecordV2(prepare.continuityChange);
  return (
    prepare.baseChoices.length === 0 &&
    prepare.cascadeChoices.length === 0 &&
    change !== null &&
    hasExactKeysV2(change, new Set(['shotId', 'hardCut', 'requiresSeedGeneration'])) &&
    isSafeStudioDirectorId(change.shotId) &&
    typeof change.hardCut === 'boolean' &&
    typeof change.requiresSeedGeneration === 'boolean'
  );
};

const validatesRemedyV2 = (value: unknown): boolean => {
  const remedy = snapshotDataRecordV2(value);
  if (remedy === null) return false;
  if (remedy.kind === 'owner_only') {
    return hasExactKeysV2(remedy, new Set(['kind', 'reason'])) && OWNER_REASONS_V2.has(remedy.reason);
  }
  if (remedy.kind === 'proposal') {
    return (
      hasExactKeysV2(remedy, new Set(['kind', 'prepare', 'estimatedMinorUnits', 'currency'])) &&
      remedy.estimatedMinorUnits === null &&
      remedy.currency === null &&
      validatesPrepareIntentV2(remedy.prepare)
    );
  }
  if (remedy.kind !== 'free_fix' || typeof remedy.op !== 'string') return false;
  if (remedy.op === 'retry_conditioning_frame') {
    return (
      hasExactKeysV2(remedy, new Set(['kind', 'op', 'dependentShotId'])) &&
      isSafeStudioDirectorId(remedy.dependentShotId)
    );
  }
  if (remedy.op === 'terminalize_refused_job') {
    return hasExactKeysV2(remedy, new Set(['kind', 'op', 'jobId'])) && isSafeStudioDirectorId(remedy.jobId);
  }
  return (
    remedy.op === 'set_shot_reference_binding' &&
    hasExactKeysV2(remedy, new Set(['kind', 'op', 'shotId'])) &&
    isSafeStudioDirectorId(remedy.shotId)
  );
};

const validatesWhereV2 = (value: unknown): boolean => {
  const where = snapshotDataRecordV2(value);
  if (where === null || typeof where.kind !== 'string') return false;
  if (where.kind === 'project' || where.kind === 'cut') {
    return hasExactKeysV2(where, new Set(['kind']));
  }
  if (where.kind === 'route') {
    return (
      hasExactKeysV2(where, new Set(['kind', 'routeKind'])) &&
      (where.routeKind === 'image' || where.routeKind === 'video')
    );
  }
  if (where.kind === 'reference') {
    return (
      hasExactKeysV2(where, new Set(['kind', 'referenceId', 'jobId'])) &&
      isSafeStudioDirectorId(where.referenceId) &&
      isNullableSafeIdV2(where.jobId)
    );
  }
  return (
    where.kind === 'shot' &&
    hasExactKeysV2(where, new Set(['kind', 'beatId', 'shotId', 'beatPosition', 'shotPosition', 'jobId'])) &&
    isSafeStudioDirectorId(where.beatId) &&
    isSafeStudioDirectorId(where.shotId) &&
    isNonnegativeSafeIntegerV2(where.beatPosition) &&
    isNonnegativeSafeIntegerV2(where.shotPosition) &&
    isNullableSafeIdV2(where.jobId)
  );
};

const validatesBlockerV2 = (value: unknown): boolean => {
  const blocker = snapshotDataRecordV2(value);
  if (
    blocker === null ||
    !hasExactKeysV2(blocker, new Set(['cause', 'where', 'remedy'])) ||
    !STUDIO_PROJECT_STATUS_BLOCKER_CAUSES_V2.includes(blocker.cause as never) ||
    !validatesWhereV2(blocker.where) ||
    !validatesRemedyV2(blocker.remedy)
  ) {
    return false;
  }
  const where = blocker.where as JsonRecord;
  const remedy = blocker.remedy as JsonRecord;
  const cause = blocker.cause;
  if (cause === 'route_inventory_unavailable' && where.kind !== 'project') return false;
  if (
    (cause === 'route_not_selected' ||
      cause === 'route_setup_required' ||
      cause === 'route_unavailable' ||
      cause === 'route_retired' ||
      cause === 'route_incompatible_frame' ||
      cause === 'route_first_frame_unsupported') &&
    where.kind !== 'route'
  ) {
    return false;
  }
  if (cause === 'route_duration_unsupported' && where.kind !== 'shot') return false;
  if (
    (cause === 'reference_generation_required' ||
      cause === 'reference_approval_required' ||
      cause === 'reference_generation_failed') &&
    where.kind !== 'reference'
  ) {
    return false;
  }
  if (
    (cause === 'reference_binding_unassigned' ||
      cause === 'reference_binding_unknown_reference' ||
      cause === 'reference_binding_wrong_kind' ||
      cause === 'reference_binding_unapproved_reference' ||
      cause === 'reference_binding_missing_asset' ||
      cause === 'reference_binding_capacity_exceeded' ||
      cause === 'shooting_script_required' ||
      cause === 'seed_selection_required' ||
      cause === 'seed_generation_required' ||
      cause === 'conditioning_frame_required' ||
      cause === 'extraction_failed' ||
      cause === 'dependency_failed') &&
    where.kind !== 'shot'
  ) {
    return false;
  }
  if ((cause === 'cut_invalid_media' || cause === 'cut_bed_too_short') && where.kind !== 'cut') return false;
  if (remedy.kind === 'free_fix') {
    if (remedy.op === 'terminalize_refused_job') return where.jobId === remedy.jobId;
    return where.kind === 'shot' && where.shotId === (remedy.dependentShotId ?? remedy.shotId);
  }
  if (remedy.kind !== 'proposal') return true;
  const prepare = remedy.prepare as JsonRecord;
  if (prepare.kind === 'project_references') {
    return where.kind === 'reference' && (prepare.referenceIds as unknown[]).includes(where.referenceId);
  }
  if (where.kind !== 'shot') return false;
  if (prepare.continuityChange !== null) {
    return (prepare.continuityChange as JsonRecord).shotId === where.shotId;
  }
  // A downstream failed Shot can legitimately be repaired by preparing the
  // earlier root of its current segment. The prepare payload is shape-checked
  // above; only continuity changes are guaranteed to target `where` exactly.
  return true;
};

const validatesSummaryV2 = (value: unknown, stage: (typeof STUDIO_PROJECT_STATUS_STAGE_ORDER_V2)[number]): boolean => {
  const summary = snapshotDataRecordV2(value);
  if (summary === null || summary.stage !== stage) return false;
  if (stage === 'brief') {
    return hasExactKeysV2(summary, new Set(['stage', 'hasBrief'])) && typeof summary.hasBrief === 'boolean';
  }
  if (stage === 'engines') {
    return (
      hasExactKeysV2(summary, new Set(['stage', 'image', 'video'])) &&
      MODEL_AVAILABILITIES_V2.has(summary.image) &&
      MODEL_AVAILABILITIES_V2.has(summary.video)
    );
  }
  if (stage === 'references') {
    return (
      hasExactKeysV2(summary, new Set(['stage', 'plannedCount', 'approvedCount'])) &&
      isNonnegativeSafeIntegerV2(summary.plannedCount) &&
      isNonnegativeSafeIntegerV2(summary.approvedCount) &&
      summary.approvedCount <= summary.plannedCount
    );
  }
  if (stage === 'storyboard') {
    return (
      hasExactKeysV2(
        summary,
        new Set(['stage', 'beatCount', 'shotCount', 'authoredShotCount', 'plannedSeconds', 'targetSeconds'])
      ) &&
      isNonnegativeSafeIntegerV2(summary.beatCount) &&
      isNonnegativeSafeIntegerV2(summary.shotCount) &&
      isNonnegativeSafeIntegerV2(summary.authoredShotCount) &&
      summary.authoredShotCount <= summary.shotCount &&
      isFiniteNonnegativeV2(summary.plannedSeconds) &&
      isFiniteNonnegativeV2(summary.targetSeconds)
    );
  }
  if (stage === 'bindings') {
    return (
      hasExactKeysV2(summary, new Set(['stage', 'readyShotCount', 'shotCount', 'maxConditioningImages'])) &&
      isNonnegativeSafeIntegerV2(summary.readyShotCount) &&
      isNonnegativeSafeIntegerV2(summary.shotCount) &&
      summary.readyShotCount <= summary.shotCount &&
      (summary.maxConditioningImages === null || isNonnegativeSafeIntegerV2(summary.maxConditioningImages))
    );
  }
  if (stage === 'production') {
    return (
      hasExactKeysV2(summary, new Set(['stage', 'currentTakeCount', 'shotCount', 'activeJobCount'])) &&
      isNonnegativeSafeIntegerV2(summary.currentTakeCount) &&
      isNonnegativeSafeIntegerV2(summary.shotCount) &&
      summary.currentTakeCount <= summary.shotCount &&
      isNonnegativeSafeIntegerV2(summary.activeJobCount)
    );
  }
  return (
    hasExactKeysV2(
      summary,
      new Set(['stage', 'currentTakeCount', 'shotCount', 'durationSeconds', 'targetSeconds', 'structurallyPlayable'])
    ) &&
    isNonnegativeSafeIntegerV2(summary.currentTakeCount) &&
    isNonnegativeSafeIntegerV2(summary.shotCount) &&
    summary.currentTakeCount <= summary.shotCount &&
    (summary.durationSeconds === null || isFiniteNonnegativeV2(summary.durationSeconds)) &&
    isFiniteNonnegativeV2(summary.targetSeconds) &&
    typeof summary.structurallyPlayable === 'boolean'
  );
};

const validatesAdvisoryV2 = (value: unknown): boolean => {
  const advisory = snapshotDataRecordV2(value);
  if (advisory === null) return false;
  if (advisory.cause === 'target_duration_mismatch') {
    return (
      hasExactKeysV2(advisory, new Set(['cause', 'stage', 'actualSeconds', 'targetSeconds'])) &&
      (advisory.stage === 'storyboard' || advisory.stage === 'cut') &&
      isFiniteNonnegativeV2(advisory.actualSeconds) &&
      isFiniteNonnegativeV2(advisory.targetSeconds)
    );
  }
  return (
    advisory.cause === 'current_take_stale' &&
    hasExactKeysV2(advisory, new Set(['cause', 'stage', 'shotId', 'staleCauses'])) &&
    advisory.stage === 'production' &&
    isSafeStudioDirectorId(advisory.shotId) &&
    isDenseArrayV2(advisory.staleCauses, 1, 2) &&
    advisory.staleCauses.every((cause) => cause === 'continuity_stale' || cause === 'generation_out_of_date') &&
    new Set(advisory.staleCauses).size === advisory.staleCauses.length
  );
};

const validatesBindingDetailV2 = (value: unknown): boolean => {
  const binding = snapshotDataRecordV2(value);
  if (
    binding === null ||
    typeof binding.status !== 'string' ||
    !isNonnegativeSafeIntegerV2(binding.selectedCount) ||
    (binding.limit !== null && !isNonnegativeSafeIntegerV2(binding.limit))
  ) {
    return false;
  }
  if (binding.status === 'invalid') {
    return (
      hasExactKeysV2(binding, new Set(['status', 'reason', 'selectedCount', 'limit'])) &&
      binding.reason !== 'unassigned' &&
      STUDIO_REFERENCE_BINDING_FAILURE_REASONS_V2.includes(binding.reason as never)
    );
  }
  if (binding.status !== 'ready' && binding.status !== 'unassigned' && binding.status !== 'unknown') return false;
  return (
    hasExactKeysV2(binding, new Set(['status', 'selectedCount', 'limit'])) &&
    (binding.status !== 'unknown' || binding.limit === null) &&
    (binding.status !== 'ready' || binding.limit === null || Number(binding.selectedCount) <= Number(binding.limit))
  );
};

const validatesLatestJobV2 = (value: unknown, purposes: ReadonlySet<unknown>): boolean => {
  if (value === null) return true;
  const job = snapshotDataRecordV2(value);
  return (
    job !== null &&
    hasExactKeysV2(job, new Set(['jobId', 'purpose', 'status', 'errorCode'])) &&
    isSafeStudioDirectorId(job.jobId) &&
    purposes.has(job.purpose) &&
    JOB_STATUSES_V2.has(job.status) &&
    (job.errorCode === null || JOB_ERRORS_V2.has(job.errorCode))
  );
};

const validatesConditioningDetailV2 = (value: unknown): boolean => {
  if (value === null) return true;
  const conditioning = snapshotDataRecordV2(value);
  if (
    conditioning === null ||
    !hasExactKeysV2(
      conditioning,
      new Set(['upstreamShotId', 'recordStatus', 'mediaVerified', 'extractionId', 'errorCode', 'attemptCount'])
    ) ||
    !isSafeStudioDirectorId(conditioning.upstreamShotId) ||
    (conditioning.recordStatus !== 'missing' &&
      conditioning.recordStatus !== 'pending' &&
      conditioning.recordStatus !== 'extracting' &&
      conditioning.recordStatus !== 'ready' &&
      conditioning.recordStatus !== 'failed') ||
    conditioning.mediaVerified !== false ||
    !isNullableSafeIdV2(conditioning.extractionId) ||
    (conditioning.errorCode !== null &&
      conditioning.errorCode !== 'decode_failed' &&
      conditioning.errorCode !== 'source_missing' &&
      conditioning.errorCode !== 'storage_error') ||
    (conditioning.attemptCount !== null && !isNonnegativeSafeIntegerV2(conditioning.attemptCount))
  ) {
    return false;
  }
  return conditioning.recordStatus === 'missing'
    ? conditioning.errorCode === null && conditioning.attemptCount === null
    : conditioning.extractionId !== null &&
        conditioning.attemptCount !== null &&
        (conditioning.recordStatus === 'failed' ? conditioning.errorCode !== null : conditioning.errorCode === null);
};

const validatesShotDetailV2 = (value: unknown): boolean => {
  const shot = snapshotDataRecordV2(value);
  return (
    shot !== null &&
    hasExactKeysV2(
      shot,
      new Set([
        'beatId',
        'shotId',
        'beatPosition',
        'shotPosition',
        'seedStillAssetId',
        'videoAssetId',
        'latestGenerationJob',
        'binding',
        'conditioning',
      ])
    ) &&
    isSafeStudioDirectorId(shot.beatId) &&
    isSafeStudioDirectorId(shot.shotId) &&
    isNonnegativeSafeIntegerV2(shot.beatPosition) &&
    isNonnegativeSafeIntegerV2(shot.shotPosition) &&
    isNullableSafeIdV2(shot.seedStillAssetId) &&
    isNullableSafeIdV2(shot.videoAssetId) &&
    validatesLatestJobV2(shot.latestGenerationJob, new Set(['seed_still', 'video_take'])) &&
    validatesBindingDetailV2(shot.binding) &&
    validatesConditioningDetailV2(shot.conditioning)
  );
};

const validatesReferenceDetailV2 = (value: unknown): boolean => {
  const reference = snapshotDataRecordV2(value);
  const latestJob = reference === null ? null : reference.latestJob;
  const validLatestJob =
    latestJob === null ||
    (() => {
      const job = snapshotDataRecordV2(latestJob);
      return (
        job !== null &&
        hasExactKeysV2(job, new Set(['jobId', 'status', 'errorCode'])) &&
        isSafeStudioDirectorId(job.jobId) &&
        JOB_STATUSES_V2.has(job.status) &&
        (job.errorCode === null || JOB_ERRORS_V2.has(job.errorCode))
      );
    })();
  return (
    reference !== null &&
    hasExactKeysV2(reference, new Set(['referenceId', 'kind', 'approved', 'latestJob'])) &&
    isSafeStudioDirectorId(reference.referenceId) &&
    (reference.kind === 'character' || reference.kind === 'background') &&
    typeof reference.approved === 'boolean' &&
    validLatestJob
  );
};

const validatesProjectStatusResultV2 = (value: unknown, projectId: string, detail: boolean): boolean => {
  const result = snapshotDataRecordV2(value);
  if (
    result === null ||
    !hasExactKeysV2(
      result,
      new Set([
        'projectId',
        'projectRevision',
        'catalogVersion',
        'stages',
        'blockerCount',
        'advisories',
        'boards',
        'detail',
      ])
    ) ||
    result.projectId !== projectId ||
    !isRevision(result.projectRevision) ||
    (result.catalogVersion !== null &&
      (typeof result.catalogVersion !== 'string' || !/^[a-f0-9]{16}$/.test(result.catalogVersion))) ||
    !isDenseArrayV2(
      result.stages,
      STUDIO_PROJECT_STATUS_STAGE_ORDER_V2.length,
      STUDIO_PROJECT_STATUS_STAGE_ORDER_V2.length
    ) ||
    !isNonnegativeSafeIntegerV2(result.blockerCount) ||
    !isDenseArrayV2(result.advisories, 0, 512) ||
    !result.advisories.every(validatesAdvisoryV2)
  ) {
    return false;
  }
  for (let index = 0; index < STUDIO_PROJECT_STATUS_STAGE_ORDER_V2.length; index += 1) {
    const stage = snapshotDataRecordV2(result.stages[index]);
    const expectedId = STUDIO_PROJECT_STATUS_STAGE_ORDER_V2[index];
    if (
      stage === null ||
      !hasExactKeysV2(stage, new Set(['id', 'state', 'summary', 'blockers'])) ||
      stage.id !== expectedId ||
      (stage.state !== 'not_started' &&
        stage.state !== 'in_progress' &&
        stage.state !== 'complete' &&
        stage.state !== 'blocked') ||
      !isDenseArrayV2(stage.blockers, 0, 512) ||
      !stage.blockers.every(validatesBlockerV2) ||
      !validatesSummaryV2(stage.summary, expectedId) ||
      (stage.state === 'blocked') !== stage.blockers.length > 0
    ) {
      return false;
    }
  }
  const blockerCount = result.stages.reduce<number>((count, stageValue) => {
    const stage = stageValue as JsonRecord;
    return count + (stage.blockers as unknown[]).length;
  }, 0);
  if (blockerCount !== result.blockerCount) return false;
  const boards = snapshotDataRecordV2(result.boards);
  if (
    boards === null ||
    !hasExactKeysV2(boards, new Set(['currentPictureCount', 'shotCount'])) ||
    !isNonnegativeSafeIntegerV2(boards.currentPictureCount) ||
    !isNonnegativeSafeIntegerV2(boards.shotCount) ||
    boards.currentPictureCount > boards.shotCount
  ) {
    return false;
  }
  const stageById = new Map(
    result.stages.map((stageValue) => {
      const stage = stageValue as JsonRecord;
      return [stage.id, stage] as const;
    })
  );
  const storyboardSummary = stageById.get('storyboard')?.summary as JsonRecord;
  const bindingsSummary = stageById.get('bindings')?.summary as JsonRecord;
  const productionSummary = stageById.get('production')?.summary as JsonRecord;
  const cutSummary = stageById.get('cut')?.summary as JsonRecord;
  const referencesSummary = stageById.get('references')?.summary as JsonRecord;
  if (
    storyboardSummary.shotCount !== bindingsSummary.shotCount ||
    storyboardSummary.shotCount !== productionSummary.shotCount ||
    storyboardSummary.shotCount !== cutSummary.shotCount ||
    storyboardSummary.shotCount !== boards.shotCount ||
    productionSummary.currentTakeCount !== cutSummary.currentTakeCount
  ) {
    return false;
  }
  if (detail) {
    const detailRecord = snapshotDataRecordV2(result.detail);
    if (
      detailRecord === null ||
      !hasExactKeysV2(detailRecord, new Set(['shots', 'references'])) ||
      !isDenseArrayV2(detailRecord.shots, 0, 512) ||
      !isDenseArrayV2(detailRecord.references, 0, 512) ||
      !detailRecord.shots.every(validatesShotDetailV2) ||
      !detailRecord.references.every(validatesReferenceDetailV2)
    ) {
      return false;
    }
    const shots = detailRecord.shots as JsonRecord[];
    const references = detailRecord.references as JsonRecord[];
    if (
      shots.length !== storyboardSummary.shotCount ||
      references.length !== referencesSummary.plannedCount ||
      new Set(shots.map((shot) => shot.shotId)).size !== shots.length ||
      new Set(shots.map((shot) => `${String(shot.beatPosition)}\0${String(shot.shotPosition)}`)).size !==
        shots.length ||
      new Set(references.map((reference) => reference.referenceId)).size !== references.length ||
      shots.filter((shot) => (shot.binding as JsonRecord).status === 'ready').length !==
        bindingsSummary.readyShotCount ||
      shots.filter((shot) => shot.videoAssetId !== null).length !== productionSummary.currentTakeCount ||
      references.filter((reference) => reference.approved === true).length !== referencesSummary.approvedCount
    ) {
      return false;
    }
  } else if (result.detail !== null) {
    return false;
  }
  return fitsCommandRecord(result);
};

const validatesMediaChoiceV2 = (value: unknown): boolean => {
  if (value === null) return true;
  const choice = snapshotDataRecordV2(value);
  return (
    choice !== null &&
    hasExactKeysV2(choice, new Set(['choiceId', 'providerId', 'model'])) &&
    typeof choice.choiceId === 'string' &&
    /^choice_[a-f0-9]{24}$/.test(choice.choiceId) &&
    isSafeStudioDirectorId(choice.providerId) &&
    isBoundedSafeTextV2(choice.model)
  );
};

const validatesRouteConstraintsV2 = (value: unknown): boolean => {
  const constraints = snapshotDataRecordV2(value);
  if (constraints === null) return false;
  const keys = new Set([
    'aspectRatios',
    'resolutions',
    'minDurationSeconds',
    'maxDurationSeconds',
    'supportsFirstFrame',
    'maxConditioningImages',
    'silentOutput',
  ]);
  const hasDurations = Object.hasOwn(constraints, 'supportedDurationSeconds');
  if (hasDurations) keys.add('supportedDurationSeconds');
  return (
    hasExactKeysV2(constraints, keys) &&
    isDenseArrayV2(constraints.aspectRatios, 1, ASPECT_RATIOS_V2.size) &&
    constraints.aspectRatios.every((ratio) => ASPECT_RATIOS_V2.has(ratio)) &&
    new Set(constraints.aspectRatios).size === constraints.aspectRatios.length &&
    isDenseArrayV2(constraints.resolutions, 1, RESOLUTIONS_V2.size) &&
    constraints.resolutions.every((resolution) => RESOLUTIONS_V2.has(resolution)) &&
    new Set(constraints.resolutions).size === constraints.resolutions.length &&
    typeof constraints.minDurationSeconds === 'number' &&
    Number.isInteger(constraints.minDurationSeconds) &&
    constraints.minDurationSeconds >= 1 &&
    typeof constraints.maxDurationSeconds === 'number' &&
    Number.isInteger(constraints.maxDurationSeconds) &&
    constraints.maxDurationSeconds <= 60 &&
    constraints.minDurationSeconds <= constraints.maxDurationSeconds &&
    (!hasDurations ||
      (isDenseArrayV2(constraints.supportedDurationSeconds, 1, 12) &&
        constraints.supportedDurationSeconds.every(
          (duration, index) =>
            typeof duration === 'number' &&
            Number.isInteger(duration) &&
            duration >= 4 &&
            duration <= 15 &&
            (index === 0 || Number((constraints.supportedDurationSeconds as unknown[])[index - 1]) < duration)
        ) &&
        constraints.supportedDurationSeconds[0] === constraints.minDurationSeconds &&
        constraints.supportedDurationSeconds.at(-1) === constraints.maxDurationSeconds)) &&
    typeof constraints.supportsFirstFrame === 'boolean' &&
    isNonnegativeSafeIntegerV2(constraints.maxConditioningImages) &&
    constraints.maxConditioningImages <= 6 &&
    typeof constraints.silentOutput === 'boolean'
  );
};

const validatesRouteEntryV2 = (value: unknown, role: 'image' | 'video'): boolean => {
  const route = snapshotDataRecordV2(value);
  return (
    route !== null &&
    hasExactKeysV2(
      route,
      new Set([
        'choiceId',
        'providerId',
        'providerName',
        'model',
        'integrationLabelKey',
        'health',
        'kind',
        'constraints',
      ])
    ) &&
    typeof route.choiceId === 'string' &&
    /^choice_[a-f0-9]{24}$/.test(route.choiceId) &&
    isSafeStudioDirectorId(route.providerId) &&
    isBoundedSafeTextV2(route.providerName) &&
    isBoundedSafeTextV2(route.model) &&
    INTEGRATION_LABELS_V2.has(route.integrationLabelKey) &&
    (role === 'image' ? route.integrationLabelKey === 'imageApi' : route.integrationLabelKey !== 'imageApi') &&
    (route.health === 'available' || route.health === 'unknown') &&
    route.kind === role &&
    validatesRouteConstraintsV2(route.constraints)
  );
};

const validatesSelectionIssueV2 = (value: unknown): boolean => {
  if (value === null) return true;
  const issue = snapshotDataRecordV2(value);
  if (issue === null || typeof issue.code !== 'string') return false;
  if (issue.code === 'retired' || issue.code === 'health') return hasExactKeysV2(issue, new Set(['code']));
  if (issue.code === 'needs_setup') {
    return hasExactKeysV2(issue, new Set(['code', 'providerName'])) && isBoundedSafeTextV2(issue.providerName);
  }
  return (
    issue.code === 'frame' &&
    hasExactKeysV2(issue, new Set(['code', 'aspectRatio', 'resolution'])) &&
    ASPECT_RATIOS_V2.has(issue.aspectRatio) &&
    RESOLUTIONS_V2.has(issue.resolution)
  );
};

const sameRouteV2 = (left: JsonRecord, right: JsonRecord): boolean =>
  left.choiceId === right.choiceId &&
  left.providerId === right.providerId &&
  left.providerName === right.providerName &&
  left.model === right.model &&
  left.integrationLabelKey === right.integrationLabelKey &&
  left.health === right.health &&
  left.kind === right.kind &&
  (() => {
    const leftConstraints = left.constraints as JsonRecord;
    const rightConstraints = right.constraints as JsonRecord;
    return (
      JSON.stringify(leftConstraints.aspectRatios) === JSON.stringify(rightConstraints.aspectRatios) &&
      JSON.stringify(leftConstraints.resolutions) === JSON.stringify(rightConstraints.resolutions) &&
      leftConstraints.minDurationSeconds === rightConstraints.minDurationSeconds &&
      leftConstraints.maxDurationSeconds === rightConstraints.maxDurationSeconds &&
      JSON.stringify(leftConstraints.supportedDurationSeconds) ===
        JSON.stringify(rightConstraints.supportedDurationSeconds) &&
      leftConstraints.supportsFirstFrame === rightConstraints.supportsFirstFrame &&
      leftConstraints.maxConditioningImages === rightConstraints.maxConditioningImages &&
      leftConstraints.silentOutput === rightConstraints.silentOutput
    );
  })();

const validatesMediaRouteCatalogV2 = (value: unknown): boolean => {
  const catalog = snapshotDataRecordV2(value);
  if (
    catalog === null ||
    !hasExactKeysV2(catalog, new Set(['image', 'video', 'catalogVersion'])) ||
    typeof catalog.catalogVersion !== 'string' ||
    !/^[a-f0-9]{16}$/.test(catalog.catalogVersion)
  ) {
    return false;
  }
  for (const role of ['image', 'video'] as const) {
    const media = snapshotDataRecordV2(catalog[role]);
    if (
      media === null ||
      !hasExactKeysV2(media, new Set(['status', 'selected', 'selectedRoute', 'selectionIssue', 'options'])) ||
      (media.status !== 'ready' &&
        media.status !== 'selection_required' &&
        media.status !== 'setup_required' &&
        media.status !== 'unavailable') ||
      !validatesMediaChoiceV2(media.selected) ||
      (media.selectedRoute !== null && !validatesRouteEntryV2(media.selectedRoute, role)) ||
      !validatesSelectionIssueV2(media.selectionIssue) ||
      !isDenseArrayV2(media.options, 0, 256) ||
      !media.options.every((option) => validatesRouteEntryV2(option, role))
    ) {
      return false;
    }
    const options = media.options as JsonRecord[];
    if (new Set(options.map((option) => option.choiceId)).size !== options.length) return false;
    if (media.selected === null || media.selectedRoute === null) {
      if (media.selected !== null || media.selectedRoute !== null || media.status === 'ready') return false;
      if (media.status === 'unavailable') {
        if (media.selectionIssue === null) return false;
      } else if (
        media.selectionIssue !== null ||
        (media.status === 'setup_required' ? options.length !== 0 : options.length === 0)
      ) {
        return false;
      }
      continue;
    }
    if (media.status !== 'ready' || media.selectionIssue !== null) return false;
    const selected = media.selected as JsonRecord;
    const selectedRoute = media.selectedRoute as JsonRecord;
    if (
      selected.choiceId !== selectedRoute.choiceId ||
      selected.providerId !== selectedRoute.providerId ||
      selected.model !== selectedRoute.model ||
      !options.some((option) => sameRouteV2(option, selectedRoute))
    ) {
      return false;
    }
  }
  return fitsCommandRecord(catalog);
};

const isDenseArrayV2 = (value: unknown, minimum: number, maximum: number): value is unknown[] => {
  try {
    if (
      !Array.isArray(value) ||
      value.length < minimum ||
      value.length > maximum ||
      Reflect.ownKeys(value).length !== value.length + 1
    ) {
      return false;
    }
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.hasOwn(value, index)) return false;
    }
    return true;
  } catch {
    return false;
  }
};

const isUniqueSafeIdArrayV2 = (value: unknown, minimum: number, maximum: number): value is string[] => {
  if (!isDenseArrayV2(value, minimum, maximum)) return false;
  const ids = new Set<string>();
  for (let index = 0; index < value.length; index += 1) {
    const id = value[index];
    if (!isSafeStudioDirectorId(id) || ids.has(id)) return false;
    ids.add(id);
  }
  return true;
};

const validateOperationListV2 = (value: unknown): value is StudioMutationOperationV2[] => {
  if (!isDenseArrayV2(value, 1, STUDIO_MAX_MUTATION_OPERATIONS)) return false;
  for (let index = 0; index < value.length; index += 1) {
    if (!validateStudioMutationOperationV2(value[index])) return false;
  }
  return true;
};

export { STUDIO_DIRECTOR_OPERATION_DISPOSITIONS_V2 };
export type { StudioDirectorOperationDispositionV2 };

/** Returns null for malformed or future operation kinds; known denied kinds stay distinguishable. */
export const classifyStudioDirectorOperationV2 = (kind: unknown): StudioDirectorOperationDispositionV2 | null =>
  typeof kind === 'string' && Object.hasOwn(STUDIO_DIRECTOR_OPERATION_DISPOSITIONS_V2, kind)
    ? STUDIO_DIRECTOR_OPERATION_DISPOSITIONS_V2[kind as StudioMutationOperationV2['kind']]
    : null;

const validateDirectorOperationListV2 = (value: unknown): value is StudioDirectorOperationV2[] =>
  validateOperationListV2(value) &&
  value.every(
    (operation) =>
      classifyStudioDirectorOperationV2(operation.kind) === 'direct' &&
      (operation.kind !== 'add_shot' ||
        (operation.shot.durationSeconds >= STUDIO_MIN_SHOT_SECONDS &&
          operation.shot.durationSeconds <= STUDIO_MAX_SHOT_SECONDS)) &&
      (operation.kind !== 'edit_shot' ||
        operation.changes.durationSeconds === undefined ||
        (operation.changes.durationSeconds >= STUDIO_MIN_SHOT_SECONDS &&
          operation.changes.durationSeconds <= STUDIO_MAX_SHOT_SECONDS))
  );

/** Exact singleton recovery grammar; status derivation remains the runtime authority for admissibility. */
export const validateStudioDirectorFreeRecoveryV2 = (value: unknown): value is StudioDirectorFreeRecoveryV2 => {
  const recovery = snapshotDataRecordV2(value);
  if (recovery === null || typeof recovery.op !== 'string') return false;
  if (recovery.op === 'retry_conditioning_frame') {
    return (
      hasExactKeysV2(recovery, new Set(['op', 'dependentShotId'])) && isSafeStudioDirectorId(recovery.dependentShotId)
    );
  }
  return (
    recovery.op === 'terminalize_refused_job' &&
    hasExactKeysV2(recovery, new Set(['op', 'jobId'])) &&
    isSafeStudioDirectorId(recovery.jobId)
  );
};

const recoverExpectedRevisionV2 = (value: unknown, projectId: string, commandId: string): number | null => {
  try {
    if (!isRecord(value)) return null;
    const projectDescriptor = Object.getOwnPropertyDescriptor(value, 'projectId');
    const commandDescriptor = Object.getOwnPropertyDescriptor(value, 'commandId');
    const revisionDescriptor = Object.getOwnPropertyDescriptor(value, 'expectedRevision');
    if (
      projectDescriptor === undefined ||
      commandDescriptor === undefined ||
      revisionDescriptor === undefined ||
      !Object.hasOwn(projectDescriptor, 'value') ||
      !Object.hasOwn(commandDescriptor, 'value') ||
      !Object.hasOwn(revisionDescriptor, 'value') ||
      projectDescriptor.value !== projectId ||
      commandDescriptor.value !== commandId ||
      !isRevision(revisionDescriptor.value)
    ) {
      return null;
    }
    return revisionDescriptor.value;
  } catch {
    return null;
  }
};

const invalidCommandV2 = (
  value: unknown,
  projectId: string,
  commandId: string,
  reasonCode: 'malformed_record' | 'unsupported_version'
): StudioDirectorCommandParseResultV2 => ({
  status: 'invalid',
  commandId,
  expectedRevision: recoverExpectedRevisionV2(value, projectId, commandId),
  reasonCode,
});

const unsupportedCommandV2 = (
  value: unknown,
  projectId: string,
  commandId: string
): StudioDirectorCommandParseResultV2 => ({
  status: 'unsupported_prototype_schema',
  commandId,
  expectedRevision: recoverExpectedRevisionV2(value, projectId, commandId),
});

const validSidecarV2 = <RecordType>(record: RecordType): StudioDirectorSidecarParseResultV2<RecordType> => ({
  status: 'valid',
  record,
});

const unsupportedSidecarV2 = <RecordType>(): StudioDirectorSidecarParseResultV2<RecordType> => ({
  status: 'unsupported_prototype_schema',
});

const invalidSidecarV2 = <RecordType>(): StudioDirectorSidecarParseResultV2<RecordType> => ({
  status: 'invalid',
});

export function parseStudioDirectorCommandSlotV2(
  value: unknown,
  now: string,
  waitMs: number
): StudioDirectorSidecarParseResultV2<StudioDirectorCommandSlotV2> {
  const schema = sidecarSchemaV2(value, STUDIO_DIRECTOR_COMMAND_SCHEMA_VERSION_V2);
  if (schema === 'v1') return unsupportedSidecarV2();
  const record = schema === 'v2' ? snapshotDataRecordV2(value) : null;
  if (record === null || !hasExactKeysV2(record, SLOT_KEYS)) {
    return invalidSidecarV2();
  }
  const reservedAt = timestampMs(record.reservedAt);
  const deadlineAt = timestampMs(record.deadlineAt);
  const nowMs = timestampMs(now);
  if (
    !isSafeStudioDirectorId(record.commandId) ||
    reservedAt === null ||
    deadlineAt === null ||
    nowMs === null ||
    !Number.isSafeInteger(waitMs) ||
    waitMs <= 0 ||
    reservedAt > nowMs + STUDIO_DIRECTOR_COMMAND_CLOCK_SKEW_MS ||
    deadlineAt <= reservedAt ||
    deadlineAt - reservedAt > waitMs
  ) {
    return invalidSidecarV2();
  }
  return validSidecarV2(record as StudioDirectorCommandSlotV2);
}

export function parseStudioDirectorCommandSlotLeaseV2(
  value: unknown,
  now: string,
  waitMs: number
): StudioDirectorSidecarParseResultV2<StudioDirectorCommandSlotLeaseV2> {
  const schema = sidecarSchemaV2(value, STUDIO_DIRECTOR_COMMAND_SCHEMA_VERSION_V2);
  if (schema === 'v1') return unsupportedSidecarV2();
  const record = schema === 'v2' ? snapshotDataRecordV2(value) : null;
  if (
    record === null ||
    !hasExactKeysV2(record, SLOT_LEASE_KEYS) ||
    !isSafeStudioDirectorId(record.leaseId) ||
    (record.owner !== 'writer' && record.owner !== 'main')
  ) {
    return invalidSidecarV2();
  }
  const acquiredAt = timestampMs(record.acquiredAt);
  const expiresAt = timestampMs(record.expiresAt);
  const nowMs = timestampMs(now);
  if (
    acquiredAt === null ||
    expiresAt === null ||
    nowMs === null ||
    acquiredAt > nowMs + STUDIO_DIRECTOR_COMMAND_CLOCK_SKEW_MS ||
    expiresAt - acquiredAt !== STUDIO_DIRECTOR_COMMAND_SLOT_LEASE_MS
  ) {
    return invalidSidecarV2();
  }
  const identityIsNull = record.commandId === null && record.reservedAt === null && record.deadlineAt === null;
  const identityIsComplete = record.commandId !== null && record.reservedAt !== null && record.deadlineAt !== null;
  if ((!identityIsNull && !identityIsComplete) || (record.owner === 'writer' && !identityIsComplete)) {
    return invalidSidecarV2();
  }
  if (identityIsComplete) {
    const slot = parseStudioDirectorCommandSlotV2(
      {
        schemaVersion: STUDIO_DIRECTOR_COMMAND_SCHEMA_VERSION_V2,
        commandId: record.commandId,
        reservedAt: record.reservedAt,
        deadlineAt: record.deadlineAt,
      },
      now,
      waitMs
    );
    if (slot.status !== 'valid') return invalidSidecarV2();
  }
  return validSidecarV2(record as StudioDirectorCommandSlotLeaseV2);
}

export function parseStudioDirectorPendingRecordV2(input: {
  projectId: string;
  commandId: string;
  value: unknown;
  slot: unknown;
  now: string;
  waitMs: number;
}): StudioDirectorCommandParseResultV2 {
  if (!isSafeStudioDirectorId(input.projectId) || !isSafeStudioDirectorId(input.commandId)) {
    return invalidCommandV2(input.value, input.projectId, input.commandId, 'malformed_record');
  }
  const schema = sidecarSchemaV2(input.value, STUDIO_DIRECTOR_COMMAND_SCHEMA_VERSION_V2);
  if (schema === 'v1') return unsupportedCommandV2(input.value, input.projectId, input.commandId);
  if (schema === 'other') return invalidCommandV2(input.value, input.projectId, input.commandId, 'unsupported_version');
  const value = schema === 'v2' ? snapshotDataRecordV2(input.value) : null;
  if (value === null || !fitsCommandRecord(value)) {
    return invalidCommandV2(input.value, input.projectId, input.commandId, 'malformed_record');
  }
  const createdAt = timestampMs(value.createdAt);
  const deadlineAt = timestampMs(value.deadlineAt);
  const nowMs = timestampMs(input.now);
  if (
    value.commandId !== input.commandId ||
    value.projectId !== input.projectId ||
    createdAt === null ||
    deadlineAt === null ||
    nowMs === null ||
    createdAt > nowMs + STUDIO_DIRECTOR_COMMAND_CLOCK_SKEW_MS ||
    deadlineAt <= createdAt ||
    deadlineAt - createdAt > input.waitMs
  ) {
    return invalidCommandV2(input.value, input.projectId, input.commandId, 'malformed_record');
  }
  const commandShapeIsValid =
    (value.policy === 'auto_apply' &&
      hasExactKeysV2(value, AUTO_APPLY_COMMAND_KEYS) &&
      isRevision(value.expectedRevision) &&
      validateDirectorOperationListV2(value.operations)) ||
    (value.policy === 'apply_free_fix' &&
      hasExactKeysV2(value, FREE_FIX_COMMAND_KEYS) &&
      isRevision(value.expectedRevision) &&
      validateStudioDirectorFreeRecoveryV2(value.recovery)) ||
    (value.policy === 'get_project_status' &&
      hasExactKeysV2(value, PROJECT_STATUS_COMMAND_KEYS) &&
      typeof value.detail === 'boolean') ||
    (value.policy === 'list_routes' && hasExactKeysV2(value, LIST_ROUTES_COMMAND_KEYS)) ||
    (value.policy === 'get_proposal' &&
      hasExactKeysV2(value, GET_PROPOSAL_COMMAND_KEYS) &&
      isSafeStudioDirectorId(value.proposalId));
  if (!commandShapeIsValid) {
    return invalidCommandV2(input.value, input.projectId, input.commandId, 'malformed_record');
  }
  const slot = parseStudioDirectorCommandSlotV2(input.slot, input.now, input.waitMs);
  if (slot.status === 'unsupported_prototype_schema') {
    return unsupportedCommandV2(input.value, input.projectId, input.commandId);
  }
  if (
    slot.status !== 'valid' ||
    slot.record.commandId !== value.commandId ||
    slot.record.deadlineAt !== value.deadlineAt
  ) {
    return invalidCommandV2(input.value, input.projectId, input.commandId, 'malformed_record');
  }
  return { status: 'valid', record: value as StudioDirectorCommandRecordV2 };
}

export function parseStudioDirectorCommandReceiptV2(input: {
  projectId: string;
  commandId: string;
  value: unknown;
}): StudioDirectorSidecarParseResultV2<StudioDirectorCommandReceiptV2> {
  const schema = sidecarSchemaV2(input.value, STUDIO_DIRECTOR_COMMAND_SCHEMA_VERSION_V2);
  if (schema === 'v1') return unsupportedSidecarV2();
  const value = schema === 'v2' ? snapshotDataRecordV2(input.value) : null;
  if (
    value === null ||
    !fitsCommandReceipt(value) ||
    value.commandId !== input.commandId ||
    value.projectId !== input.projectId ||
    !isSafeStudioDirectorId(value.commandId) ||
    !isSafeStudioDirectorId(value.projectId) ||
    timestampMs(value.decidedAt) === null
  ) {
    return invalidSidecarV2();
  }
  if (Object.hasOwn(value, 'query')) {
    const query = parseDirectorQueryV2(value.query);
    if (query === null) return invalidSidecarV2();
    // Only one receipt shape can legitimately exceed the command-record ceiling: an answered
    // exact-proposal read may contain the complete immutable proposal record. All other answers
    // and terminal receipts stay on the original bound even though the mailbox can physically
    // carry the larger proposal answer.
    if (!(value.status === 'answered' && query.kind === 'get_proposal') && !fitsCommandRecord(value)) {
      return invalidSidecarV2();
    }
    if (value.status === 'answered') {
      if (!hasExactKeysV2(value, QUERY_ANSWERED_RECEIPT_KEYS)) return invalidSidecarV2();
      const validResult =
        query.kind === 'get_project_status'
          ? validatesProjectStatusResultV2(value.result, input.projectId, query.detail)
          : query.kind === 'list_routes'
            ? validatesMediaRouteCatalogV2(value.result)
            : validatesProposalLookupV2(value.result, input.projectId, query.proposalId);
      return validResult ? validSidecarV2(value as StudioDirectorCommandReceiptV2) : invalidSidecarV2();
    }
    if (!hasExactKeysV2(value, QUERY_TERMINAL_RECEIPT_KEYS) || typeof value.reasonCode !== 'string') {
      return invalidSidecarV2();
    }
    if (value.status === 'failed') {
      return V2_QUERY_FAILURE_CODES.has(value.reasonCode)
        ? validSidecarV2(value as StudioDirectorCommandReceiptV2)
        : invalidSidecarV2();
    }
    if (value.status === 'expired') {
      return V2_EXPIRY_CODES.has(value.reasonCode)
        ? validSidecarV2(value as StudioDirectorCommandReceiptV2)
        : invalidSidecarV2();
    }
    return invalidSidecarV2();
  }
  if (!fitsCommandRecord(value)) return invalidSidecarV2();
  if (value.status === 'applied') {
    if (Object.hasOwn(value, 'recovery')) {
      if (
        !hasExactKeysV2(value, V2_FREE_FIX_APPLIED_RECEIPT_KEYS) ||
        !isRevision(value.expectedRevision) ||
        !isRevision(value.appliedRevision) ||
        value.appliedRevision !== value.expectedRevision + 1 ||
        !validateStudioDirectorFreeRecoveryV2(value.recovery)
      ) {
        return invalidSidecarV2();
      }
      return validSidecarV2(value as StudioDirectorFreeRecoveryAppliedReceiptV2);
    }
    if (
      !hasExactKeysV2(value, V2_APPLIED_RECEIPT_KEYS) ||
      !isRevision(value.expectedRevision) ||
      !isRevision(value.appliedRevision) ||
      value.appliedRevision !== value.expectedRevision + 1 ||
      !isUniqueSafeIdArrayV2(value.createdBeatIds, 0, STUDIO_MAX_MUTATION_OPERATIONS) ||
      !isUniqueSafeIdArrayV2(value.createdShotIds, 0, STUDIO_MAX_MUTATION_OPERATIONS)
    ) {
      return invalidSidecarV2();
    }
    return validSidecarV2(value as StudioDirectorCommandReceiptV2);
  }
  if (!hasExactKeysV2(value, TERMINAL_RECEIPT_KEYS) || !isNullableRevision(value.observedRevision)) {
    return invalidSidecarV2();
  }
  if (typeof value.reasonCode !== 'string') return invalidSidecarV2();
  if (value.status === 'rejected') {
    if (!V2_REJECTION_CODES.has(value.reasonCode)) return invalidSidecarV2();
    const expectedRevisionIsValid =
      isRevision(value.expectedRevision) ||
      (value.expectedRevision === null && V2_NULLABLE_EXPECTED_REVISION_CODES.has(value.reasonCode));
    return expectedRevisionIsValid ? validSidecarV2(value as StudioDirectorCommandReceiptV2) : invalidSidecarV2();
  }
  if (!isRevision(value.expectedRevision)) return invalidSidecarV2();
  if (value.status === 'expired') {
    return V2_EXPIRY_CODES.has(value.reasonCode)
      ? validSidecarV2(value as StudioDirectorCommandReceiptV2)
      : invalidSidecarV2();
  }
  if (value.status === 'indeterminate') {
    return V2_INDETERMINATE_CODES.has(value.reasonCode)
      ? validSidecarV2(value as StudioDirectorCommandReceiptV2)
      : invalidSidecarV2();
  }
  return invalidSidecarV2();
}

export const isStudioDirectorQueryCommandV2 = (
  command: StudioDirectorCommandRecordV2
): command is StudioDirectorQueryCommandRecordV2 =>
  command.policy === 'get_project_status' || command.policy === 'list_routes' || command.policy === 'get_proposal';

export const isStudioDirectorFreeRecoveryCommandV2 = (
  command: StudioDirectorCommandRecordV2
): command is StudioDirectorFreeRecoveryCommandRecordV2 => command.policy === 'apply_free_fix';

export const isStudioDirectorFreeRecoveryAppliedReceiptV2 = (
  receipt: StudioDirectorCommandReceiptV2
): receipt is StudioDirectorFreeRecoveryAppliedReceiptV2 => receipt.status === 'applied' && 'recovery' in receipt;

export const isStudioDirectorQueryReceiptV2 = (
  receipt: StudioDirectorCommandReceiptV2
): receipt is StudioDirectorQueryReceiptV2 =>
  receipt.status === 'answered' || receipt.status === 'failed' || (receipt.status === 'expired' && 'query' in receipt);

export const studioDirectorQueryForCommandV2 = (command: StudioDirectorQueryCommandRecordV2): StudioDirectorQueryV2 =>
  command.policy === 'get_project_status'
    ? { kind: 'get_project_status', detail: command.detail }
    : command.policy === 'list_routes'
      ? { kind: 'list_routes' }
      : { kind: 'get_proposal', proposalId: command.proposalId };

export const studioDirectorCommandReceiptMatchesRecordV2 = (
  receipt: StudioDirectorCommandReceiptV2,
  command: StudioDirectorCommandRecordV2
): boolean => {
  if (receipt.commandId !== command.commandId || receipt.projectId !== command.projectId) return false;
  if (command.policy === 'auto_apply') {
    return (
      !isStudioDirectorQueryReceiptV2(receipt) &&
      !isStudioDirectorFreeRecoveryAppliedReceiptV2(receipt) &&
      receipt.expectedRevision === command.expectedRevision
    );
  }
  if (isStudioDirectorFreeRecoveryCommandV2(command)) {
    if (isStudioDirectorQueryReceiptV2(receipt) || receipt.expectedRevision !== command.expectedRevision) return false;
    if (receipt.status !== 'applied') return true;
    if (!isStudioDirectorFreeRecoveryAppliedReceiptV2(receipt) || receipt.recovery.op !== command.recovery.op) {
      return false;
    }
    return command.recovery.op === 'retry_conditioning_frame'
      ? receipt.recovery.op === 'retry_conditioning_frame' &&
          receipt.recovery.dependentShotId === command.recovery.dependentShotId
      : receipt.recovery.op === 'terminalize_refused_job' && receipt.recovery.jobId === command.recovery.jobId;
  }
  if (!isStudioDirectorQueryReceiptV2(receipt)) return false;
  const query = studioDirectorQueryForCommandV2(command);
  return (
    receipt.query.kind === query.kind &&
    (query.kind === 'get_project_status'
      ? receipt.query.kind === 'get_project_status' && receipt.query.detail === query.detail
      : query.kind === 'get_proposal'
        ? receipt.query.kind === 'get_proposal' && receipt.query.proposalId === query.proposalId
        : true)
  );
};

const validateRulePredicateV2 = (value: unknown): boolean => {
  if (value === null) return true;
  if (
    !isRecord(value) ||
    !hasExactKeysV2(value, V2_RULE_PREDICATE_KEYS) ||
    value.kind !== 'forbidden_terms' ||
    !isDenseArrayV2(value.terms, 1, STUDIO_RULE_LIMITS.maxTerms)
  ) {
    return false;
  }
  const terms = new Set<string>();
  for (let index = 0; index < value.terms.length; index += 1) {
    const term = value.terms[index];
    if (
      typeof term !== 'string' ||
      term.trim().length === 0 ||
      term.length > STUDIO_RULE_LIMITS.term ||
      !hasRuleToken(term) ||
      terms.has(term)
    ) {
      return false;
    }
    terms.add(term);
  }
  return true;
};

const validateProposalPayloadV2 = (value: unknown): boolean => {
  if (!isRecord(value)) return false;
  if (value.kind === 'mutation_batch') {
    return (
      hasExactKeysV2(value, V2_PROPOSAL_MUTATION_PAYLOAD_KEYS) &&
      validateOperationListV2(value.operations) &&
      value.operations.every(
        (operation) =>
          operation.kind !== 'set_reference_plan' &&
          operation.kind !== 'amend_reference_plan' &&
          operation.kind !== 'set_shot_reference_binding' &&
          classifyStudioDirectorOperationV2(operation.kind) !== 'operation_not_permitted'
      )
    );
  }
  return (
    value.kind === 'pin_rule' &&
    hasExactKeysV2(value, V2_PROPOSAL_PIN_RULE_PAYLOAD_KEYS) &&
    isRecord(value.rule) &&
    hasExactKeysV2(value.rule, V2_PROPOSAL_RULE_KEYS) &&
    typeof value.rule.text === 'string' &&
    value.rule.text.trim().length > 0 &&
    value.rule.text.length <= STUDIO_RULE_LIMITS.text &&
    validateRulePredicateV2(value.rule.predicate)
  );
};

export function parseStudioProposalRecordV2(input: {
  projectId: string;
  proposalId: string;
  value: unknown;
}): StudioDirectorSidecarParseResultV2<StudioProposalRecordV2> {
  const schema = sidecarSchemaV2(input.value, STUDIO_PROPOSAL_SCHEMA_VERSION_V2);
  if (schema === 'v1') return unsupportedSidecarV2();
  const value = schema === 'v2' ? snapshotDataRecordV2(input.value) : null;
  if (
    value === null ||
    !hasExactKeysV2(value, V2_PROPOSAL_RECORD_KEYS) ||
    value.id !== input.proposalId ||
    value.projectId !== input.projectId ||
    !isSafeStudioDirectorId(value.id) ||
    !isSafeStudioDirectorId(value.projectId) ||
    value.status !== 'pending' ||
    !isRevision(value.baseRevision) ||
    !validateProposalPayloadV2(value.payload) ||
    timestampMs(value.createdAt) === null ||
    value.decidedAt !== null ||
    !fitsCommandRecord(value)
  ) {
    return invalidSidecarV2();
  }
  return validSidecarV2(value as StudioProposalRecordV2);
}

export function parseStudioProposalDecisionV2(input: {
  proposalId: string;
  value: unknown;
}): StudioDirectorSidecarParseResultV2<StudioProposalDecisionV2> {
  const schema = sidecarSchemaV2(input.value, STUDIO_PROPOSAL_SCHEMA_VERSION_V2);
  if (schema === 'v1') return unsupportedSidecarV2();
  const value = schema === 'v2' ? snapshotDataRecordV2(input.value) : null;
  if (
    value === null ||
    !hasExactKeysV2(value, V2_PROPOSAL_DECISION_KEYS) ||
    value.proposalId !== input.proposalId ||
    !isSafeStudioDirectorId(value.proposalId) ||
    typeof value.status !== 'string' ||
    !V2_PROPOSAL_DECISION_STATUSES.has(value.status) ||
    timestampMs(value.decidedAt) === null
  ) {
    return invalidSidecarV2();
  }
  return validSidecarV2(value as StudioProposalDecisionV2);
}

export function parseStudioProposalSlotV2(value: unknown): StudioDirectorSidecarParseResultV2<StudioProposalSlotV2> {
  const schema = sidecarSchemaV2(value, STUDIO_PROPOSAL_SCHEMA_VERSION_V2);
  if (schema === 'v1') return unsupportedSidecarV2();
  const record = schema === 'v2' ? snapshotDataRecordV2(value) : null;
  if (
    record === null ||
    !hasExactKeysV2(record, V2_PROPOSAL_SLOT_KEYS) ||
    !isSafeStudioDirectorId(record.proposalId) ||
    timestampMs(record.reservedAt) === null
  ) {
    return invalidSidecarV2();
  }
  return validSidecarV2(record as StudioProposalSlotV2);
}

export function parseStudioReferenceRequestV2(input: {
  projectId: string;
  requestId: string;
  value: unknown;
}): StudioDirectorSidecarParseResultV2<StudioReferenceRequestV2> {
  const schema = sidecarSchemaV2(input.value, STUDIO_REFERENCE_REQUEST_SCHEMA_VERSION);
  if (schema === 'v1') return unsupportedSidecarV2();
  const value = schema === 'v2' ? snapshotDataRecordV2(input.value) : null;
  if (
    value === null ||
    !hasExactKeysV2(value, V2_REFERENCE_REQUEST_KEYS) ||
    value.id !== input.requestId ||
    value.projectId !== input.projectId ||
    !isSafeStudioDirectorId(value.id) ||
    !isSafeStudioDirectorId(value.projectId) ||
    !isUniqueSafeIdArrayV2(value.referenceIds, 1, STUDIO_MAX_PROJECT_REFERENCES) ||
    value.status !== 'pending' ||
    timestampMs(value.createdAt) === null ||
    !fitsReferenceRequestRecordV2(value)
  ) {
    return invalidSidecarV2();
  }
  return validSidecarV2(value as StudioReferenceRequestV2);
}

export function parseStudioReferenceRequestSlotV2(
  value: unknown
): StudioDirectorSidecarParseResultV2<StudioReferenceRequestSlotV2> {
  const schema = sidecarSchemaV2(value, STUDIO_REFERENCE_REQUEST_SCHEMA_VERSION);
  if (schema === 'v1') return unsupportedSidecarV2();
  const record = schema === 'v2' ? snapshotDataRecordV2(value) : null;
  if (
    record === null ||
    !hasExactKeysV2(record, V2_REFERENCE_SLOT_KEYS) ||
    !isSafeStudioDirectorId(record.requestId) ||
    timestampMs(record.reservedAt) === null
  ) {
    return invalidSidecarV2();
  }
  return validSidecarV2(record as StudioReferenceRequestSlotV2);
}

const validateStudioReferenceRequestDecisionOutcomeV2 = (value: unknown): boolean => {
  if (!isRecord(value)) return false;
  if (value.kind === 'rejected' || value.kind === 'expired') {
    return hasExactKeysV2(value, V2_REFERENCE_REJECTED_OUTCOME_KEYS);
  }
  return (
    value.kind === 'generation_gate' &&
    hasExactKeysV2(value, V2_REFERENCE_GENERATION_OUTCOME_KEYS) &&
    isSafeStudioDirectorId(value.handoffId) &&
    isUniqueSafeIdArrayV2(value.referenceIds, 1, STUDIO_MAX_PROJECT_REFERENCES)
  );
};

export function parseStudioReferenceRequestDecisionV2(input: {
  projectId: string;
  requestId: string;
  value: unknown;
}): StudioDirectorSidecarParseResultV2<StudioReferenceRequestDecisionV2> {
  const schema = sidecarSchemaV2(input.value, STUDIO_REFERENCE_REQUEST_SCHEMA_VERSION);
  if (schema === 'v1') return unsupportedSidecarV2();
  const value = schema === 'v2' ? snapshotDataRecordV2(input.value) : null;
  if (
    value === null ||
    !hasExactKeysV2(value, V2_REFERENCE_DECISION_KEYS) ||
    value.requestId !== input.requestId ||
    value.projectId !== input.projectId ||
    !isSafeStudioDirectorId(value.requestId) ||
    !isSafeStudioDirectorId(value.projectId) ||
    timestampMs(value.decidedAt) === null ||
    !validateStudioReferenceRequestDecisionOutcomeV2(value.outcome) ||
    !fitsReferenceRequestRecordV2(value)
  ) {
    return invalidSidecarV2();
  }
  return validSidecarV2(value as StudioReferenceRequestDecisionV2);
}

const validateStudioReferenceGenerationHandoffResultV2 = (value: unknown): boolean => {
  if (!isRecord(value)) return false;
  if (value.kind === 'dismissed') {
    return hasExactKeysV2(value, V2_REFERENCE_DISMISSED_RESULT_KEYS);
  }
  return (
    value.kind === 'confirmed' &&
    hasExactKeysV2(value, V2_REFERENCE_CONFIRMED_RESULT_KEYS) &&
    isSafeStudioDirectorId(value.authorizationId)
  );
};

export function parseStudioReferenceGenerationHandoffReceiptV2(input: {
  handoffId: string;
  value: unknown;
}): StudioDirectorSidecarParseResultV2<StudioReferenceGenerationHandoffReceiptV2> {
  const schema = sidecarSchemaV2(input.value, STUDIO_REFERENCE_REQUEST_SCHEMA_VERSION);
  if (schema === 'v1') return unsupportedSidecarV2();
  const value = schema === 'v2' ? snapshotDataRecordV2(input.value) : null;
  if (
    value === null ||
    !hasExactKeysV2(value, V2_REFERENCE_HANDOFF_RECEIPT_KEYS) ||
    value.handoffId !== input.handoffId ||
    !isSafeStudioDirectorId(value.handoffId) ||
    !isSafeStudioDirectorId(value.requestId) ||
    timestampMs(value.completedAt) === null ||
    !validateStudioReferenceGenerationHandoffResultV2(value.result) ||
    !fitsReferenceRequestRecordV2(value)
  ) {
    return invalidSidecarV2();
  }
  return validSidecarV2(value as StudioReferenceGenerationHandoffReceiptV2);
}
