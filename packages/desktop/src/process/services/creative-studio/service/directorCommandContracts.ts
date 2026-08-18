/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  STUDIO_DIRECTOR_COMMAND_CLOCK_SKEW_MS,
  STUDIO_DIRECTOR_COMMAND_MAX_OPERATIONS,
  STUDIO_DIRECTOR_COMMAND_MAX_RECORD_BYTES,
  STUDIO_DIRECTOR_COMMAND_SLOT_LEASE_MS,
  STUDIO_MAX_SHOTS_PER_BEAT,
  STUDIO_MAX_MUTATION_OPERATIONS,
  STUDIO_MAX_REFERENCE_REQUEST_SHOTS,
  STUDIO_MAX_BEATS,
  STUDIO_MAX_BIN_ITEMS,
  STUDIO_MAX_SHOT_SECONDS,
  STUDIO_MIN_SHOT_SECONDS,
  STUDIO_PROJECT_SCHEMA_VERSION,
  type StudioDirectorCommandReceiptV1,
  type StudioDirectorCommandReceiptV2,
  type StudioDirectorCommandRecordV1,
  type StudioDirectorCommandRecordV2,
  type StudioDirectorCommandSlotLeaseV1,
  type StudioDirectorCommandSlotLeaseV2,
  type StudioDirectorCommandSlotV1,
  type StudioDirectorCommandSlotV2,
  type StudioDirectorNewSceneV1,
  type StudioDirectorOperationV1,
  type StudioMutationOperationV2,
  type StudioProposalDecisionV2,
  type StudioProposalRecordV2,
  type StudioProposalSlotV2,
  type StudioReferenceRequestSlotV2,
  type StudioReferenceRequestV2,
} from '@/common/types/project/creativeStudioTypes';
import { STUDIO_RULE_LIMITS } from '@/common/types/project/creativeStudioRules';

type JsonRecord = Record<string, unknown>;

export type StudioDirectorCommandParseResult =
  | { status: 'valid'; record: StudioDirectorCommandRecordV1 }
  | {
      status: 'invalid';
      commandId: string;
      expectedRevision: number | null;
      reasonCode: 'malformed_record' | 'unsupported_version';
    };

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
const SET_BRIEF_KEYS = new Set(['kind', 'brief']);
const ADD_SCENE_KEYS = new Set(['kind', 'sceneId', 'scene', 'beforeSceneId']);
const NEW_SCENE_KEYS = new Set([
  'title',
  'purpose',
  'visualPrompt',
  'narration',
  'onScreenText',
  'mediaKind',
  'durationSeconds',
]);
const EDIT_SCENE_KEYS = new Set(['kind', 'sceneId', 'changes']);
const EDIT_SCENE_CHANGE_KEYS = new Set([
  'title',
  'purpose',
  'visualPrompt',
  'narration',
  'onScreenText',
  'durationSeconds',
]);
const REORDER_SCENES_KEYS = new Set(['kind', 'sceneOrder']);
const SELECT_TAKE_KEYS = new Set(['kind', 'sceneId', 'assetId']);
const APPLIED_RECEIPT_KEYS = new Set([
  'schemaVersion',
  'commandId',
  'projectId',
  'expectedRevision',
  'decidedAt',
  'status',
  'appliedRevision',
  'createdSceneIds',
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
const REJECTION_CODES = new Set([
  'malformed_record',
  'unsupported_version',
  'stale_revision',
  'future_revision',
  'project_not_found',
  'validation_failed',
  'scene_limit_exceeded',
  'project_over_capacity',
]);
const EXPIRY_CODES = new Set(['deadline_elapsed', 'expired_after_restart']);
const INDETERMINATE_CODES = new Set(['commit_attribution_unknown', 'indeterminate_after_restart']);

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const hasExactKeys = (value: JsonRecord, keys: ReadonlySet<string>): boolean => {
  const actualKeys = Object.keys(value);
  return actualKeys.length === keys.size && actualKeys.every((key) => keys.has(key));
};

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

const isText = (value: unknown, maximum: number): value is string =>
  typeof value === 'string' && value.length <= maximum;

const isDuration = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 60;

const fitsCommandRecord = (value: unknown): boolean => {
  try {
    return Buffer.byteLength(JSON.stringify(value), 'utf8') <= STUDIO_DIRECTOR_COMMAND_MAX_RECORD_BYTES;
  } catch {
    return false;
  }
};

const validateNewScene = (value: unknown): value is StudioDirectorNewSceneV1 =>
  isRecord(value) &&
  hasExactKeys(value, NEW_SCENE_KEYS) &&
  isText(value.title, 256) &&
  isText(value.purpose, 256) &&
  isText(value.visualPrompt, 8 * 1024) &&
  isText(value.narration, 4 * 1024) &&
  isText(value.onScreenText, 1024) &&
  (value.mediaKind === 'image' || value.mediaKind === 'video') &&
  isDuration(value.durationSeconds);

const validateEditChanges = (value: unknown): boolean => {
  if (!isRecord(value) || Object.keys(value).length === 0) return false;
  if (!Object.keys(value).every((key) => EDIT_SCENE_CHANGE_KEYS.has(key))) return false;
  return Object.entries(value).every(([key, field]) => {
    if (key === 'durationSeconds') return isDuration(field);
    if (key === 'title' || key === 'purpose') return isText(field, 256);
    if (key === 'visualPrompt') return isText(field, 8 * 1024);
    if (key === 'narration') return isText(field, 4 * 1024);
    return key === 'onScreenText' && isText(field, 1024);
  });
};

const validateOperation = (value: unknown): value is StudioDirectorOperationV1 => {
  if (!isRecord(value)) return false;
  if (value.kind === 'set_brief') {
    return hasExactKeys(value, SET_BRIEF_KEYS) && isText(value.brief, 16 * 1024);
  }
  if (value.kind === 'add_scene') {
    return (
      hasExactKeys(value, ADD_SCENE_KEYS) &&
      isSafeStudioDirectorId(value.sceneId) &&
      validateNewScene(value.scene) &&
      (value.beforeSceneId === null || isSafeStudioDirectorId(value.beforeSceneId))
    );
  }
  if (value.kind === 'edit_scene') {
    return (
      hasExactKeys(value, EDIT_SCENE_KEYS) &&
      isSafeStudioDirectorId(value.sceneId) &&
      validateEditChanges(value.changes)
    );
  }
  if (value.kind === 'reorder_scenes') {
    return (
      hasExactKeys(value, REORDER_SCENES_KEYS) &&
      Array.isArray(value.sceneOrder) &&
      value.sceneOrder.length > 0 &&
      new Set(value.sceneOrder).size === value.sceneOrder.length &&
      value.sceneOrder.every(isSafeStudioDirectorId)
    );
  }
  return (
    value.kind === 'select_take' &&
    hasExactKeys(value, SELECT_TAKE_KEYS) &&
    isSafeStudioDirectorId(value.sceneId) &&
    isSafeStudioDirectorId(value.assetId)
  );
};

const recoverExpectedRevision = (value: unknown, projectId: string, commandId: string): number | null =>
  isRecord(value) &&
  value.projectId === projectId &&
  value.commandId === commandId &&
  isRevision(value.expectedRevision)
    ? value.expectedRevision
    : null;

const invalidResult = (
  value: unknown,
  projectId: string,
  commandId: string,
  reasonCode: 'malformed_record' | 'unsupported_version'
): StudioDirectorCommandParseResult => ({
  status: 'invalid',
  commandId,
  expectedRevision: recoverExpectedRevision(value, projectId, commandId),
  reasonCode,
});

const slotMatches = (input: {
  slot: unknown;
  record: StudioDirectorCommandRecordV1;
  nowMs: number;
  waitMs: number;
}): boolean => {
  const slot = parseStudioDirectorCommandSlot(input.slot, new Date(input.nowMs).toISOString(), input.waitMs);
  return slot?.commandId === input.record.commandId && slot.deadlineAt === input.record.deadlineAt;
};

export function parseStudioDirectorPendingRecord(input: {
  projectId: string;
  commandId: string;
  value: unknown;
  slot: unknown;
  now: string;
  waitMs: number;
}): StudioDirectorCommandParseResult {
  if (!isSafeStudioDirectorId(input.projectId) || !isSafeStudioDirectorId(input.commandId)) {
    return invalidResult(input.value, input.projectId, input.commandId, 'malformed_record');
  }
  if (isRecord(input.value) && Object.hasOwn(input.value, 'schemaVersion') && input.value.schemaVersion !== 1) {
    return invalidResult(input.value, input.projectId, input.commandId, 'unsupported_version');
  }
  if (!isRecord(input.value) || !hasExactKeys(input.value, COMMAND_KEYS) || !fitsCommandRecord(input.value)) {
    return invalidResult(input.value, input.projectId, input.commandId, 'malformed_record');
  }
  const createdAt = timestampMs(input.value.createdAt);
  const deadlineAt = timestampMs(input.value.deadlineAt);
  const nowMs = timestampMs(input.now);
  if (
    input.value.schemaVersion !== 1 ||
    input.value.commandId !== input.commandId ||
    input.value.projectId !== input.projectId ||
    !isRevision(input.value.expectedRevision) ||
    createdAt === null ||
    deadlineAt === null ||
    nowMs === null ||
    createdAt > nowMs + STUDIO_DIRECTOR_COMMAND_CLOCK_SKEW_MS ||
    deadlineAt <= createdAt ||
    deadlineAt - createdAt > input.waitMs ||
    input.value.policy !== 'auto_apply' ||
    !Array.isArray(input.value.operations) ||
    input.value.operations.length === 0 ||
    input.value.operations.length > STUDIO_DIRECTOR_COMMAND_MAX_OPERATIONS ||
    !input.value.operations.every(validateOperation)
  ) {
    return invalidResult(input.value, input.projectId, input.commandId, 'malformed_record');
  }
  const hasAdd = input.value.operations.some((operation) => operation.kind === 'add_scene');
  const hasReorder = input.value.operations.some((operation) => operation.kind === 'reorder_scenes');
  if (hasAdd && hasReorder) {
    return invalidResult(input.value, input.projectId, input.commandId, 'malformed_record');
  }
  const record = input.value as StudioDirectorCommandRecordV1;
  if (!slotMatches({ slot: input.slot, record, nowMs, waitMs: input.waitMs })) {
    return invalidResult(input.value, input.projectId, input.commandId, 'malformed_record');
  }
  return { status: 'valid', record };
}

export function parseStudioDirectorCommandSlot(
  value: unknown,
  now: string,
  waitMs: number
): StudioDirectorCommandSlotV1 | null {
  if (!isRecord(value) || !hasExactKeys(value, SLOT_KEYS) || value.schemaVersion !== 1) return null;
  const reservedAt = timestampMs(value.reservedAt);
  const deadlineAt = timestampMs(value.deadlineAt);
  const nowMs = timestampMs(now);
  return isSafeStudioDirectorId(value.commandId) &&
    reservedAt !== null &&
    deadlineAt !== null &&
    nowMs !== null &&
    Number.isSafeInteger(waitMs) &&
    waitMs > 0 &&
    reservedAt <= nowMs + STUDIO_DIRECTOR_COMMAND_CLOCK_SKEW_MS &&
    deadlineAt > reservedAt &&
    deadlineAt - reservedAt <= waitMs
    ? (value as StudioDirectorCommandSlotV1)
    : null;
}

export function parseStudioDirectorCommandSlotLease(
  value: unknown,
  now: string,
  waitMs: number
): StudioDirectorCommandSlotLeaseV1 | null {
  if (!isRecord(value) || !hasExactKeys(value, SLOT_LEASE_KEYS) || value.schemaVersion !== 1) return null;
  if (!isSafeStudioDirectorId(value.leaseId) || (value.owner !== 'writer' && value.owner !== 'main')) return null;
  const acquiredAt = timestampMs(value.acquiredAt);
  const expiresAt = timestampMs(value.expiresAt);
  const nowMs = timestampMs(now);
  if (
    acquiredAt === null ||
    expiresAt === null ||
    nowMs === null ||
    acquiredAt > nowMs + STUDIO_DIRECTOR_COMMAND_CLOCK_SKEW_MS ||
    expiresAt - acquiredAt !== STUDIO_DIRECTOR_COMMAND_SLOT_LEASE_MS
  ) {
    return null;
  }
  const identityIsNull = value.commandId === null && value.reservedAt === null && value.deadlineAt === null;
  const identityIsComplete = value.commandId !== null && value.reservedAt !== null && value.deadlineAt !== null;
  if (!identityIsNull && !identityIsComplete) return null;
  if (value.owner === 'writer' && !identityIsComplete) return null;
  if (
    identityIsComplete &&
    parseStudioDirectorCommandSlot(
      {
        schemaVersion: 1,
        commandId: value.commandId,
        reservedAt: value.reservedAt,
        deadlineAt: value.deadlineAt,
      },
      now,
      waitMs
    ) === null
  ) {
    return null;
  }
  return value as StudioDirectorCommandSlotLeaseV1;
}

export function parseStudioDirectorCommandReceipt(input: {
  projectId: string;
  commandId: string;
  value: unknown;
}): StudioDirectorCommandReceiptV1 | null {
  const value = input.value;
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    value.commandId !== input.commandId ||
    value.projectId !== input.projectId ||
    !isSafeStudioDirectorId(value.commandId) ||
    !isSafeStudioDirectorId(value.projectId) ||
    timestampMs(value.decidedAt) === null
  ) {
    return null;
  }
  if (value.status === 'applied') {
    if (
      !hasExactKeys(value, APPLIED_RECEIPT_KEYS) ||
      !isRevision(value.expectedRevision) ||
      value.appliedRevision !== value.expectedRevision + 1 ||
      !Array.isArray(value.createdSceneIds) ||
      value.createdSceneIds.length > STUDIO_DIRECTOR_COMMAND_MAX_OPERATIONS ||
      new Set(value.createdSceneIds).size !== value.createdSceneIds.length ||
      !value.createdSceneIds.every(isSafeStudioDirectorId)
    ) {
      return null;
    }
    return value as StudioDirectorCommandReceiptV1;
  }
  if (!hasExactKeys(value, TERMINAL_RECEIPT_KEYS) || !isNullableRevision(value.observedRevision)) return null;
  if (typeof value.reasonCode !== 'string') return null;
  if (value.status === 'rejected') {
    return (value.expectedRevision === null || isRevision(value.expectedRevision)) &&
      REJECTION_CODES.has(value.reasonCode)
      ? (value as StudioDirectorCommandReceiptV1)
      : null;
  }
  if (!isRevision(value.expectedRevision)) return null;
  if (value.status === 'expired') {
    return EXPIRY_CODES.has(value.reasonCode) ? (value as StudioDirectorCommandReceiptV1) : null;
  }
  if (value.status === 'indeterminate') {
    return INDETERMINATE_CODES.has(value.reasonCode) ? (value as StudioDirectorCommandReceiptV1) : null;
  }
  return null;
}

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
  'createdSectionIds',
  'createdClipIds',
]);
const V2_REJECTION_CODES = new Set([
  'malformed_record',
  'unsupported_version',
  'stale_revision',
  'future_revision',
  'project_not_found',
  'section_capacity_reached',
  'section_clip_capacity_reached',
  'project_clip_capacity_reached',
  'invalid_clip_duration',
  'dependency_blocked',
  'identity_collision',
  'invalid_operation',
  'validation_failed',
]);
const V2_NULLABLE_EXPECTED_REVISION_CODES = new Set(['malformed_record', 'unsupported_version']);
const V2_BEAT_KEYS = new Set(['title', 'storyLine', 'visualPrompt']);
const V2_SHOT_KEYS = new Set([
  'shotPrompt',
  'narration',
  'onScreenText',
  'mediaKind',
  'durationSeconds',
  'referenceAssetId',
]);
const V2_BEAT_CHANGE_KEYS = new Set(['title', 'storyLine', 'visualPrompt']);
const V2_SHOT_CHANGE_KEYS = new Set([
  'shotPrompt',
  'narration',
  'onScreenText',
  'mediaKind',
  'durationSeconds',
  'referenceAssetId',
]);
const V2_BIN_BEAT_KEYS = new Set(['kind', 'sectionId']);
const V2_BIN_ASSET_KEYS = new Set(['kind', 'assetId']);
const V2_OPERATION_KEYS: Readonly<Record<StudioMutationOperationV2['kind'], ReadonlySet<string>>> = {
  set_brief: new Set(['kind', 'brief']),
  add_section: new Set(['kind', 'sectionId', 'section', 'firstClipId', 'firstClip', 'beforeSectionId']),
  edit_section: new Set(['kind', 'sectionId', 'changes']),
  reorder_sections: new Set(['kind', 'sectionOrder']),
  park_section: new Set(['kind', 'sectionId']),
  restore_section: new Set(['kind', 'sectionId', 'beforeSectionId']),
  add_clip: new Set(['kind', 'sectionId', 'clipId', 'clip', 'beforeClipId']),
  edit_clip: new Set(['kind', 'clipId', 'changes']),
  delete_clip: new Set(['kind', 'clipId']),
  reorder_clips: new Set(['kind', 'sectionId', 'clipOrder']),
  park_take: new Set(['kind', 'clipId', 'assetId']),
  select_shelved_take: new Set(['kind', 'clipId', 'assetId']),
  remove_shelf_alias: new Set(['kind', 'assetId']),
  reorder_shelf: new Set(['kind', 'shelf']),
  select_take: new Set(['kind', 'clipId', 'assetId']),
};
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
const V2_REFERENCE_REQUEST_KEYS = new Set(['schemaVersion', 'id', 'projectId', 'clipIds', 'status', 'createdAt']);
const V2_REFERENCE_SLOT_KEYS = new Set(['schemaVersion', 'requestId', 'reservedAt']);
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

const isV2MediaKind = (value: unknown): value is 'image' | 'video' => value === 'image' || value === 'video';

const isV2Duration = (mediaKind: 'image' | 'video', value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isSafeInteger(value) &&
  value >= (mediaKind === 'video' ? STUDIO_MIN_SHOT_SECONDS : 1) &&
  value <= (mediaKind === 'video' ? STUDIO_MAX_SHOT_SECONDS : 60);

const isV2Anchor = (value: unknown): value is string | null => value === null || isSafeStudioDirectorId(value);

const validateEditableBeatV2 = (value: unknown): boolean =>
  isRecord(value) &&
  hasExactKeysV2(value, V2_BEAT_KEYS) &&
  isText(value.title, 256) &&
  isText(value.storyLine, 4 * 1024) &&
  isText(value.visualPrompt, 8 * 1024);

const validateEditableShotV2 = (value: unknown): boolean =>
  isRecord(value) &&
  hasExactKeysV2(value, V2_SHOT_KEYS) &&
  isText(value.shotPrompt, 8 * 1024) &&
  isText(value.narration, 4 * 1024) &&
  isText(value.onScreenText, 1024) &&
  isV2MediaKind(value.mediaKind) &&
  isV2Duration(value.mediaKind, value.durationSeconds) &&
  (value.referenceAssetId === null || isSafeStudioDirectorId(value.referenceAssetId));

const validateEditableBeatChangesV2 = (value: unknown): boolean => {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  return (
    keys.length > 0 &&
    keys.every((key) => V2_BEAT_CHANGE_KEYS.has(key)) &&
    (!Object.hasOwn(value, 'title') || isText(value.title, 256)) &&
    (!Object.hasOwn(value, 'storyLine') || isText(value.storyLine, 4 * 1024)) &&
    (!Object.hasOwn(value, 'visualPrompt') || isText(value.visualPrompt, 8 * 1024))
  );
};

const validateEditableShotChangesV2 = (value: unknown): boolean => {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  if (keys.length === 0 || !keys.every((key) => V2_SHOT_CHANGE_KEYS.has(key))) return false;
  if (Object.hasOwn(value, 'shotPrompt') && !isText(value.shotPrompt, 8 * 1024)) return false;
  if (Object.hasOwn(value, 'narration') && !isText(value.narration, 4 * 1024)) return false;
  if (Object.hasOwn(value, 'onScreenText') && !isText(value.onScreenText, 1024)) return false;
  if (Object.hasOwn(value, 'mediaKind') && !isV2MediaKind(value.mediaKind)) return false;
  if (
    Object.hasOwn(value, 'referenceAssetId') &&
    value.referenceAssetId !== null &&
    !isSafeStudioDirectorId(value.referenceAssetId)
  ) {
    return false;
  }
  if (Object.hasOwn(value, 'durationSeconds')) {
    if (typeof value.durationSeconds !== 'number' || !Number.isSafeInteger(value.durationSeconds)) return false;
    if (isV2MediaKind(value.mediaKind)) return isV2Duration(value.mediaKind, value.durationSeconds);
    if (value.durationSeconds < 1 || value.durationSeconds > 60) return false;
  }
  return true;
};

const validateBinV2 = (value: unknown): boolean => {
  if (!isDenseArrayV2(value, 0, STUDIO_MAX_BIN_ITEMS)) return false;
  const identities = new Set<string>();
  for (let index = 0; index < value.length; index += 1) {
    const item = value[index];
    if (!isRecord(item)) return false;
    let identity: string;
    if (item.kind === 'section') {
      if (!hasExactKeysV2(item, V2_BIN_BEAT_KEYS) || !isSafeStudioDirectorId(item.sectionId)) return false;
      identity = `section:${item.sectionId}`;
    } else if (item.kind === 'asset') {
      if (!hasExactKeysV2(item, V2_BIN_ASSET_KEYS) || !isSafeStudioDirectorId(item.assetId)) return false;
      identity = `asset:${item.assetId}`;
    } else {
      return false;
    }
    if (identities.has(identity)) return false;
    identities.add(identity);
  }
  return true;
};

const validateOperationV2 = (value: unknown): value is StudioMutationOperationV2 => {
  if (!isRecord(value) || typeof value.kind !== 'string' || !Object.hasOwn(V2_OPERATION_KEYS, value.kind)) {
    return false;
  }
  const kind = value.kind as StudioMutationOperationV2['kind'];
  if (!hasExactKeysV2(value, V2_OPERATION_KEYS[kind])) return false;
  switch (kind) {
    case 'set_brief':
      return isText(value.brief, 16 * 1024);
    case 'add_section':
      return (
        isSafeStudioDirectorId(value.sectionId) &&
        validateEditableBeatV2(value.section) &&
        isSafeStudioDirectorId(value.firstClipId) &&
        validateEditableShotV2(value.firstClip) &&
        isV2Anchor(value.beforeSectionId)
      );
    case 'edit_section':
      return isSafeStudioDirectorId(value.sectionId) && validateEditableBeatChangesV2(value.changes);
    case 'reorder_sections':
      return isUniqueSafeIdArrayV2(value.sectionOrder, 0, STUDIO_MAX_BEATS);
    case 'park_section':
      return isSafeStudioDirectorId(value.sectionId);
    case 'restore_section':
      return isSafeStudioDirectorId(value.sectionId) && isV2Anchor(value.beforeSectionId);
    case 'add_clip':
      return (
        isSafeStudioDirectorId(value.sectionId) &&
        isSafeStudioDirectorId(value.clipId) &&
        validateEditableShotV2(value.clip) &&
        isV2Anchor(value.beforeClipId)
      );
    case 'edit_clip':
      return isSafeStudioDirectorId(value.clipId) && validateEditableShotChangesV2(value.changes);
    case 'delete_clip':
      return isSafeStudioDirectorId(value.clipId);
    case 'reorder_clips':
      return (
        isSafeStudioDirectorId(value.sectionId) && isUniqueSafeIdArrayV2(value.clipOrder, 0, STUDIO_MAX_SHOTS_PER_BEAT)
      );
    case 'park_take':
    case 'select_shelved_take':
    case 'select_take':
      return isSafeStudioDirectorId(value.clipId) && isSafeStudioDirectorId(value.assetId);
    case 'remove_shelf_alias':
      return isSafeStudioDirectorId(value.assetId);
    case 'reorder_shelf':
      return validateBinV2(value.shelf);
  }
};

const validateOperationListV2 = (value: unknown): value is StudioMutationOperationV2[] => {
  if (!isDenseArrayV2(value, 1, STUDIO_MAX_MUTATION_OPERATIONS)) return false;
  for (let index = 0; index < value.length; index += 1) {
    if (!validateOperationV2(value[index])) return false;
  }
  return true;
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
    !validateOperationListV2(value.operations)
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
      !isUniqueSafeIdArrayV2(value.createdSectionIds, 0, STUDIO_MAX_MUTATION_OPERATIONS) ||
      !isUniqueSafeIdArrayV2(value.createdClipIds, 0, STUDIO_MAX_MUTATION_OPERATIONS)
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
    return EXPIRY_CODES.has(value.reasonCode)
      ? validSidecarV2(value as StudioDirectorCommandReceiptV2)
      : invalidSidecarV2();
  }
  if (value.status === 'indeterminate') {
    return INDETERMINATE_CODES.has(value.reasonCode)
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
    return hasExactKeysV2(value, V2_PROPOSAL_MUTATION_PAYLOAD_KEYS) && validateOperationListV2(value.operations);
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
    !isUniqueSafeIdArrayV2(value.clipIds, 1, STUDIO_MAX_REFERENCE_REQUEST_SHOTS) ||
    value.status !== 'pending' ||
    timestampMs(value.createdAt) === null ||
    !fitsCommandRecord(value)
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
