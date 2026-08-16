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
  type StudioDirectorCommandReceiptV1,
  type StudioDirectorCommandRecordV1,
  type StudioDirectorCommandSlotLeaseV1,
  type StudioDirectorCommandSlotV1,
  type StudioDirectorNewSceneV1,
  type StudioDirectorOperationV1,
} from '@/common/types/project/creativeStudioTypes';

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
