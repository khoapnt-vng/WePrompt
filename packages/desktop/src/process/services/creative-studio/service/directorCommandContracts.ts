/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  STUDIO_DIRECTOR_COMMAND_CLOCK_SKEW_MS,
  STUDIO_DIRECTOR_COMMAND_MAX_RECORD_BYTES,
  STUDIO_DIRECTOR_COMMAND_SLOT_LEASE_MS,
  STUDIO_MAX_MUTATION_OPERATIONS,
  STUDIO_MAX_REFERENCE_REQUEST_SHOTS,
  STUDIO_MAX_SHOT_SECONDS,
  STUDIO_MIN_SHOT_SECONDS,
  STUDIO_PROJECT_SCHEMA_VERSION,
  STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
  type StudioDirectorCommandReceiptV2,
  type StudioDirectorCommandRecordV2,
  type StudioDirectorCommandSlotLeaseV2,
  type StudioDirectorCommandSlotV2,
  type StudioDirectorOperationV2,
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
const COMMAND_KEYS = new Set([
  'schemaVersion',
  'commandId',
  'projectId',
  'expectedRevision',
  'createdAt',
  'deadlineAt',
  'policy',
  'operations',
]);
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
const V2_REFERENCE_REQUEST_KEYS = new Set(['schemaVersion', 'id', 'projectId', 'shotIds', 'status', 'createdAt']);
const V2_REFERENCE_SLOT_KEYS = new Set(['schemaVersion', 'requestId', 'reservedAt']);
const V2_REFERENCE_DECISION_KEYS = new Set(['schemaVersion', 'requestId', 'projectId', 'decidedAt', 'outcome']);
const V2_REFERENCE_REJECTED_OUTCOME_KEYS = new Set(['kind']);
const V2_REFERENCE_IMPORTED_OUTCOME_KEYS = new Set(['kind', 'assetId', 'projectRevision']);
const V2_REFERENCE_GENERATION_OUTCOME_KEYS = new Set(['kind', 'handoffId', 'shotIds']);
const V2_REFERENCE_HANDOFF_RECEIPT_KEYS = new Set(['schemaVersion', 'handoffId', 'requestId', 'completedAt', 'result']);
const V2_REFERENCE_DISMISSED_RESULT_KEYS = new Set(['kind']);
const V2_REFERENCE_CONFIRMED_RESULT_KEYS = new Set(['kind', 'authorizationId']);
const V2_PROPOSAL_DECISION_STATUSES = new Set(['accepted', 'rejected', 'expired']);

const sidecarSchemaV2 = (value: unknown): SidecarSchemaV2 => {
  try {
    if (!isRecord(value)) return 'missing';
    const descriptor = Object.getOwnPropertyDescriptor(value, 'schemaVersion');
    if (descriptor === undefined || !Object.hasOwn(descriptor, 'value')) return 'missing';
    if (descriptor.value === 1) return 'v1';
    if (descriptor.value === STUDIO_PROJECT_SCHEMA_VERSION) return 'v2';
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
    if (!isArray && prototype !== Object.prototype && prototype !== null) return false;
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

const hasExactKeysV2 = (value: JsonRecord, keys: ReadonlySet<string>): boolean => {
  try {
    const actualKeys = Reflect.ownKeys(value);
    return actualKeys.length === keys.size && actualKeys.every((key) => typeof key === 'string' && keys.has(key));
  } catch {
    return false;
  }
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

export type StudioDirectorOperationDispositionV2 = 'direct' | 'proposal' | 'operation_not_permitted';

/**
 * Frozen schema-2 Director capability policy. This is deliberately exhaustive so adding a reducer
 * gesture cannot silently make it callable by either MCP mutation surface.
 */
export const STUDIO_DIRECTOR_OPERATION_DISPOSITIONS_V2 = Object.freeze({
  edit_project: 'operation_not_permitted',
  set_brief: 'direct',
  set_rules: 'operation_not_permitted',
  add_beat: 'direct',
  edit_beat: 'direct',
  reorder_beats: 'direct',
  park_beat: 'operation_not_permitted',
  restore_beat: 'operation_not_permitted',
  add_binned_beat: 'proposal',
  add_shot: 'direct',
  edit_shot: 'direct',
  delete_shot: 'direct',
  park_shot: 'operation_not_permitted',
  restore_shot: 'operation_not_permitted',
  reorder_shots: 'direct',
  apply_coverage: 'proposal',
  set_hard_cut: 'proposal',
  set_seed_still: 'operation_not_permitted',
  trim_shot: 'operation_not_permitted',
  redetach_line: 'proposal',
  rederive_line: 'proposal',
  restore_line: 'operation_not_permitted',
  park_take: 'operation_not_permitted',
  add_alternate_take: 'operation_not_permitted',
  restore_take: 'operation_not_permitted',
  reorder_bin: 'direct',
  select_take: 'operation_not_permitted',
  set_routes: 'operation_not_permitted',
  set_spend_policy: 'operation_not_permitted',
  set_match_to: 'operation_not_permitted',
  set_bed: 'operation_not_permitted',
  undo_last: 'operation_not_permitted',
} as const satisfies Readonly<Record<StudioMutationOperationV2['kind'], StudioDirectorOperationDispositionV2>>);

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
  const schema = sidecarSchemaV2(value);
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
  const schema = sidecarSchemaV2(value);
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
        schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
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
  const schema = sidecarSchemaV2(input.value);
  if (schema === 'v1') return unsupportedCommandV2(input.value, input.projectId, input.commandId);
  if (schema === 'other') return invalidCommandV2(input.value, input.projectId, input.commandId, 'unsupported_version');
  const value = schema === 'v2' ? snapshotDataRecordV2(input.value) : null;
  if (value === null || !hasExactKeysV2(value, COMMAND_KEYS) || !fitsCommandRecord(value)) {
    return invalidCommandV2(input.value, input.projectId, input.commandId, 'malformed_record');
  }
  const createdAt = timestampMs(value.createdAt);
  const deadlineAt = timestampMs(value.deadlineAt);
  const nowMs = timestampMs(input.now);
  if (
    value.commandId !== input.commandId ||
    value.projectId !== input.projectId ||
    !isRevision(value.expectedRevision) ||
    createdAt === null ||
    deadlineAt === null ||
    nowMs === null ||
    createdAt > nowMs + STUDIO_DIRECTOR_COMMAND_CLOCK_SKEW_MS ||
    deadlineAt <= createdAt ||
    deadlineAt - createdAt > input.waitMs ||
    value.policy !== 'auto_apply' ||
    !validateDirectorOperationListV2(value.operations)
  ) {
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
  const schema = sidecarSchemaV2(input.value);
  if (schema === 'v1') return unsupportedSidecarV2();
  const value = schema === 'v2' ? snapshotDataRecordV2(input.value) : null;
  if (
    value === null ||
    value.commandId !== input.commandId ||
    value.projectId !== input.projectId ||
    !isSafeStudioDirectorId(value.commandId) ||
    !isSafeStudioDirectorId(value.projectId) ||
    timestampMs(value.decidedAt) === null
  ) {
    return invalidSidecarV2();
  }
  if (value.status === 'applied') {
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
        (operation) => classifyStudioDirectorOperationV2(operation.kind) !== 'operation_not_permitted'
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
  const schema = sidecarSchemaV2(input.value);
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
  const schema = sidecarSchemaV2(input.value);
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
  const schema = sidecarSchemaV2(value);
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
  const schema = sidecarSchemaV2(input.value);
  if (schema === 'v1') return unsupportedSidecarV2();
  const value = schema === 'v2' ? snapshotDataRecordV2(input.value) : null;
  if (
    value === null ||
    !hasExactKeysV2(value, V2_REFERENCE_REQUEST_KEYS) ||
    value.id !== input.requestId ||
    value.projectId !== input.projectId ||
    !isSafeStudioDirectorId(value.id) ||
    !isSafeStudioDirectorId(value.projectId) ||
    !isUniqueSafeIdArrayV2(value.shotIds, 1, STUDIO_MAX_REFERENCE_REQUEST_SHOTS) ||
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
  const schema = sidecarSchemaV2(value);
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
  if (value.kind === 'imported_reference') {
    return (
      hasExactKeysV2(value, V2_REFERENCE_IMPORTED_OUTCOME_KEYS) &&
      isSafeStudioDirectorId(value.assetId) &&
      isRevision(value.projectRevision)
    );
  }
  return (
    value.kind === 'generation_gate' &&
    hasExactKeysV2(value, V2_REFERENCE_GENERATION_OUTCOME_KEYS) &&
    isSafeStudioDirectorId(value.handoffId) &&
    isUniqueSafeIdArrayV2(value.shotIds, 1, STUDIO_MAX_REFERENCE_REQUEST_SHOTS)
  );
};

export function parseStudioReferenceRequestDecisionV2(input: {
  projectId: string;
  requestId: string;
  value: unknown;
}): StudioDirectorSidecarParseResultV2<StudioReferenceRequestDecisionV2> {
  const schema = sidecarSchemaV2(input.value);
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
  const schema = sidecarSchemaV2(input.value);
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
