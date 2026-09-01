/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { types as nodeTypes } from 'node:util';
import {
  STUDIO_MUTATION_BATCH_SCHEMA_VERSION_V3,
  type CreativeStudioPilotErrorCodeV3,
  type StudioApplyMutationBatchResultV3,
  type StudioPiecePhotoSettingsV3,
  type StudioPreparePhotoResultV3,
  type StudioProjectLoadResultV3,
} from '@/common/types/project/creativeStudioTypes';
import { parseStudioApplyMutationBatchRequestV3, parseStudioPreparePhotoRequestV3 } from '../contracts';

export const STUDIO_PILOT_DIRECTOR_COMMAND_SCHEMA_VERSION = 11 as const;
export const STUDIO_PILOT_DIRECTOR_COMMAND_MAX_BYTES = 64 * 1024;
export const STUDIO_PILOT_DIRECTOR_RECEIPT_MAX_BYTES = 1024 * 1024;
export const STUDIO_PILOT_DIRECTOR_MAX_DEADLINE_MS = 5 * 60 * 1000;
export const STUDIO_PILOT_DIRECTOR_CLOCK_SKEW_MS = 30 * 1000;
export const STUDIO_PILOT_DIRECTOR_RECEIPT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
export const STUDIO_PILOT_DIRECTOR_MAX_RECEIPTS = 128;

export type StudioPilotDirectorPolicy = 'get_project_status' | 'prepare_photo' | 'rename_piece';

type StudioPilotDirectorCommandBase = {
  schemaVersion: typeof STUDIO_PILOT_DIRECTOR_COMMAND_SCHEMA_VERSION;
  commandId: string;
  projectId: string;
  createdAt: string;
  deadlineAt: string;
};

export type StudioPilotDirectorGetProjectStatusCommand = StudioPilotDirectorCommandBase & {
  policy: 'get_project_status';
};

export type StudioPilotDirectorPreparePhotoCommand = StudioPilotDirectorCommandBase & {
  policy: 'prepare_photo';
  expectedAuthoringRevision: number;
  words: string;
  settings: StudioPiecePhotoSettingsV3;
  suggestedHandle: string | null;
};

export type StudioPilotDirectorRenamePieceCommand = StudioPilotDirectorCommandBase & {
  policy: 'rename_piece';
  expectedAuthoringRevision: number;
  pieceId: string;
  handle: string;
};

export type StudioPilotDirectorCommand =
  | StudioPilotDirectorGetProjectStatusCommand
  | StudioPilotDirectorPreparePhotoCommand
  | StudioPilotDirectorRenamePieceCommand;

export type StudioPilotDirectorCommandParseResult =
  | { status: 'valid'; command: StudioPilotDirectorCommand }
  | { status: 'unsupported_version'; commandId: string | null; projectId: string | null }
  | { status: 'invalid'; commandId: string | null; projectId: string | null };

type StudioPilotDirectorReceiptBase = {
  schemaVersion: typeof STUDIO_PILOT_DIRECTOR_COMMAND_SCHEMA_VERSION;
  commandId: string;
  projectId: string;
  decidedAt: string;
};

export type StudioPilotDirectorSucceededReceipt =
  | (StudioPilotDirectorReceiptBase & {
      policy: 'get_project_status';
      expectedAuthoringRevision: null;
      status: 'succeeded';
      result: Extract<StudioProjectLoadResultV3, { status: 'supported' }>;
    })
  | (StudioPilotDirectorReceiptBase & {
      policy: 'prepare_photo';
      expectedAuthoringRevision: number;
      status: 'succeeded';
      result: StudioPreparePhotoResultV3;
    })
  | (StudioPilotDirectorReceiptBase & {
      policy: 'rename_piece';
      expectedAuthoringRevision: number;
      status: 'succeeded';
      result: StudioApplyMutationBatchResultV3;
    });

export type StudioPilotDirectorRejectedReason = CreativeStudioPilotErrorCodeV3 | 'result_mismatch';

export type StudioPilotDirectorRejectedReceipt = StudioPilotDirectorReceiptBase & {
  policy: StudioPilotDirectorPolicy;
  expectedAuthoringRevision: number | null;
  status: 'rejected';
  reasonCode: StudioPilotDirectorRejectedReason;
};

export type StudioPilotDirectorExpiredReceipt = StudioPilotDirectorReceiptBase & {
  policy: StudioPilotDirectorPolicy;
  expectedAuthoringRevision: number | null;
  status: 'expired';
  reasonCode: 'deadline_elapsed';
};

export type StudioPilotDirectorIndeterminateReceipt = StudioPilotDirectorReceiptBase & {
  policy: StudioPilotDirectorPolicy;
  expectedAuthoringRevision: number | null;
  status: 'indeterminate';
  reasonCode: 'indeterminate_after_restart';
};

export type StudioPilotDirectorReceipt =
  | StudioPilotDirectorSucceededReceipt
  | StudioPilotDirectorRejectedReceipt
  | StudioPilotDirectorExpiredReceipt
  | StudioPilotDirectorIndeterminateReceipt;

export type StudioPilotDirectorReceiptParseResult =
  | { status: 'valid'; receipt: StudioPilotDirectorReceipt }
  | { status: 'unsupported_version' }
  | { status: 'invalid' };

export type StudioPilotDirectorClaim = {
  schemaVersion: typeof STUDIO_PILOT_DIRECTOR_COMMAND_SCHEMA_VERSION;
  commandId: string;
  projectId: string;
  processorId: string;
  claimedAt: string;
};

const SAFE_ID = /^[A-Za-z0-9_-]{1,256}$/u;
const COMMON_KEYS = ['schemaVersion', 'commandId', 'projectId', 'createdAt', 'deadlineAt', 'policy'] as const;
const GET_STATUS_KEYS = new Set(COMMON_KEYS);
const PREPARE_PHOTO_KEYS = new Set([
  ...COMMON_KEYS,
  'expectedAuthoringRevision',
  'words',
  'settings',
  'suggestedHandle',
]);
const RENAME_PIECE_KEYS = new Set([...COMMON_KEYS, 'expectedAuthoringRevision', 'pieceId', 'handle']);
const SUCCEEDED_RECEIPT_KEYS = new Set([
  'schemaVersion',
  'commandId',
  'projectId',
  'policy',
  'expectedAuthoringRevision',
  'decidedAt',
  'status',
  'result',
]);
const FAILED_RECEIPT_KEYS = new Set([
  'schemaVersion',
  'commandId',
  'projectId',
  'policy',
  'expectedAuthoringRevision',
  'decidedAt',
  'status',
  'reasonCode',
]);
const CLAIM_KEYS = new Set(['schemaVersion', 'commandId', 'projectId', 'processorId', 'claimedAt']);
const REJECTED_REASONS = new Set<StudioPilotDirectorRejectedReason>([
  'invalid_payload',
  'not_found',
  'unsupported_project',
  'project_quarantined',
  'stale_project',
  'stale_authoring',
  'project_piece_capacity_reached',
  'route_catalog_unavailable',
  'route_incompatible',
  'route_unavailable',
  'rate_not_found',
  'variable_price_unsupported',
  'quote_not_found',
  'quote_in_use',
  'quote_expired',
  'stale_quote',
  'confirmation_required',
  'duplicate_charge_acknowledgement_required',
  'job_ineligible',
  'busy',
  'cancellation_refused',
  'invalid_media',
  'download_failed',
  'variation_grid',
  'stale_export_catalog',
  'export_unavailable',
  'deletion_claim_not_found',
  'deletion_claim_expired',
  'deletion_claim_mismatch',
  'deletion_claim_capacity',
  'invalid_handle',
  'handle_collision',
  'alias_limit',
  'undo_conflict',
  'no_change',
  'storage_error',
  'runtime_inactive',
  'result_mismatch',
]);

type PlainRecord = Record<string, unknown>;

const isSafeId = (value: unknown): value is string => typeof value === 'string' && SAFE_ID.test(value);

const isPositiveRevision = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;

export const studioPilotDirectorTimestampMs = (value: unknown): number | null => {
  if (typeof value !== 'string' || value.length !== 24) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value ? parsed : null;
};

const byteLengthWithin = (value: unknown, maximum: number): boolean => {
  try {
    return Buffer.byteLength(JSON.stringify(value), 'utf8') <= maximum;
  } catch {
    return false;
  }
};

const isOwnJsonData = (value: unknown, seen = new Set<object>()): boolean => {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object' || nodeTypes.isProxy(value) || seen.has(value)) return false;
  seen.add(value);
  try {
    const prototype = Object.getPrototypeOf(value);
    if (Array.isArray(value)) {
      if (prototype !== Array.prototype) return false;
    } else if (prototype !== Object.prototype && prototype !== null) {
      return false;
    }
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string') return false;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (
        descriptor === undefined ||
        !Object.hasOwn(descriptor, 'value') ||
        (!descriptor.enumerable && !(Array.isArray(value) && key === 'length')) ||
        !isOwnJsonData(descriptor.value, seen)
      ) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
};

const snapshotExactRecord = (value: unknown, keys: ReadonlySet<string>): PlainRecord | null => {
  if (!isOwnJsonData(value) || typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as PlainRecord;
  const ownKeys = Object.keys(record);
  if (ownKeys.length !== keys.size || ownKeys.some((key) => !keys.has(key))) return null;
  try {
    return structuredClone(record);
  } catch {
    return null;
  }
};

const commandEnvelope = (
  value: unknown
): { schemaVersion: unknown; commandId: string | null; projectId: string | null } => {
  if (typeof value !== 'object' || value === null || Array.isArray(value) || nodeTypes.isProxy(value)) {
    return { schemaVersion: null, commandId: null, projectId: null };
  }
  try {
    const schema = Object.getOwnPropertyDescriptor(value, 'schemaVersion');
    const command = Object.getOwnPropertyDescriptor(value, 'commandId');
    const project = Object.getOwnPropertyDescriptor(value, 'projectId');
    return {
      schemaVersion: schema !== undefined && Object.hasOwn(schema, 'value') ? schema.value : null,
      commandId:
        command !== undefined && Object.hasOwn(command, 'value') && isSafeId(command.value) ? command.value : null,
      projectId:
        project !== undefined && Object.hasOwn(project, 'value') && isSafeId(project.value) ? project.value : null,
    };
  } catch {
    return { schemaVersion: null, commandId: null, projectId: null };
  }
};

const validCommandBase = (snapshot: PlainRecord): boolean => {
  const createdAt = studioPilotDirectorTimestampMs(snapshot.createdAt);
  const deadlineAt = studioPilotDirectorTimestampMs(snapshot.deadlineAt);
  return (
    snapshot.schemaVersion === STUDIO_PILOT_DIRECTOR_COMMAND_SCHEMA_VERSION &&
    isSafeId(snapshot.commandId) &&
    isSafeId(snapshot.projectId) &&
    createdAt !== null &&
    deadlineAt !== null &&
    deadlineAt > createdAt &&
    deadlineAt - createdAt <= STUDIO_PILOT_DIRECTOR_MAX_DEADLINE_MS
  );
};

/** Parses the exact three-policy schema-11 Director surface; command status is deliberately absent. */
export const parseStudioPilotDirectorCommand = (value: unknown): StudioPilotDirectorCommandParseResult => {
  const envelope = commandEnvelope(value);
  if (envelope.schemaVersion !== STUDIO_PILOT_DIRECTOR_COMMAND_SCHEMA_VERSION) {
    return typeof envelope.schemaVersion === 'number' && Number.isSafeInteger(envelope.schemaVersion)
      ? { status: 'unsupported_version', commandId: envelope.commandId, projectId: envelope.projectId }
      : { status: 'invalid', commandId: envelope.commandId, projectId: envelope.projectId };
  }
  if (typeof value !== 'object' || value === null) {
    return { status: 'invalid', commandId: envelope.commandId, projectId: envelope.projectId };
  }
  const policyDescriptor = Object.getOwnPropertyDescriptor(value, 'policy');
  const policy =
    policyDescriptor !== undefined && Object.hasOwn(policyDescriptor, 'value') ? policyDescriptor.value : null;
  const keys =
    policy === 'get_project_status'
      ? GET_STATUS_KEYS
      : policy === 'prepare_photo'
        ? PREPARE_PHOTO_KEYS
        : policy === 'rename_piece'
          ? RENAME_PIECE_KEYS
          : null;
  const snapshot = keys === null ? null : snapshotExactRecord(value, keys);
  if (
    snapshot === null ||
    !validCommandBase(snapshot) ||
    !byteLengthWithin(snapshot, STUDIO_PILOT_DIRECTOR_COMMAND_MAX_BYTES)
  ) {
    return { status: 'invalid', commandId: envelope.commandId, projectId: envelope.projectId };
  }
  try {
    if (snapshot.policy === 'get_project_status') {
      return { status: 'valid', command: snapshot as StudioPilotDirectorGetProjectStatusCommand };
    }
    if (snapshot.policy === 'prepare_photo') {
      parseStudioPreparePhotoRequestV3({
        mode: 'create',
        projectId: snapshot.projectId,
        expectedAuthoringRevision: snapshot.expectedAuthoringRevision,
        words: snapshot.words,
        settings: snapshot.settings,
        suggestedHandle: snapshot.suggestedHandle,
      });
      return { status: 'valid', command: snapshot as StudioPilotDirectorPreparePhotoCommand };
    }
    parseStudioApplyMutationBatchRequestV3({
      schemaVersion: STUDIO_MUTATION_BATCH_SCHEMA_VERSION_V3,
      projectId: snapshot.projectId,
      expectedAuthoringRevision: snapshot.expectedAuthoringRevision,
      operations: [{ kind: 'rename_piece', pieceId: snapshot.pieceId, handle: snapshot.handle }],
    });
    return { status: 'valid', command: snapshot as StudioPilotDirectorRenamePieceCommand };
  } catch {
    return { status: 'invalid', commandId: envelope.commandId, projectId: envelope.projectId };
  }
};

const expectedAuthoringRevisionFor = (command: StudioPilotDirectorCommand): number | null =>
  command.policy === 'get_project_status' ? null : command.expectedAuthoringRevision;

const isLoadResult = (value: unknown): value is Extract<StudioProjectLoadResultV3, { status: 'supported' }> => {
  if (!isOwnJsonData(value) || typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const statusDescriptor = Object.getOwnPropertyDescriptor(value, 'status');
  const status =
    statusDescriptor !== undefined && Object.hasOwn(statusDescriptor, 'value') ? statusDescriptor.value : null;
  return status === 'supported';
};

const isPrepareResult = (value: unknown): value is StudioPreparePhotoResultV3 =>
  isOwnJsonData(value) &&
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  Reflect.get(value, 'status') === 'prepared' &&
  typeof Reflect.get(value, 'quote') === 'object' &&
  Reflect.get(value, 'quote') !== null;

const isMutationResult = (value: unknown, projectId: string): value is StudioApplyMutationBatchResultV3 => {
  const snapshot = snapshotExactRecord(value, new Set(['projectId', 'revision', 'authoringRevision', 'undoEntryId']));
  return (
    snapshot !== null &&
    snapshot.projectId === projectId &&
    isPositiveRevision(snapshot.revision) &&
    isPositiveRevision(snapshot.authoringRevision) &&
    (snapshot.undoEntryId === null || isSafeId(snapshot.undoEntryId))
  );
};

/** Validates a terminal record against the immutable command it answers. */
export const parseStudioPilotDirectorReceipt = (
  value: unknown,
  command?: StudioPilotDirectorCommand
): StudioPilotDirectorReceiptParseResult => {
  if (typeof value !== 'object' || value === null || Array.isArray(value) || nodeTypes.isProxy(value)) {
    return { status: 'invalid' };
  }
  const schema = Object.getOwnPropertyDescriptor(value, 'schemaVersion');
  if (schema === undefined || !Object.hasOwn(schema, 'value')) return { status: 'invalid' };
  if (schema.value !== STUDIO_PILOT_DIRECTOR_COMMAND_SCHEMA_VERSION) {
    return typeof schema.value === 'number' && Number.isSafeInteger(schema.value)
      ? { status: 'unsupported_version' }
      : { status: 'invalid' };
  }
  const status = Reflect.get(value, 'status');
  const keys = status === 'succeeded' ? SUCCEEDED_RECEIPT_KEYS : FAILED_RECEIPT_KEYS;
  const snapshot = snapshotExactRecord(value, keys);
  if (
    snapshot === null ||
    !byteLengthWithin(snapshot, STUDIO_PILOT_DIRECTOR_RECEIPT_MAX_BYTES) ||
    !isSafeId(snapshot.commandId) ||
    !isSafeId(snapshot.projectId) ||
    (snapshot.policy !== 'get_project_status' &&
      snapshot.policy !== 'prepare_photo' &&
      snapshot.policy !== 'rename_piece') ||
    studioPilotDirectorTimestampMs(snapshot.decidedAt) === null ||
    (snapshot.policy === 'get_project_status'
      ? snapshot.expectedAuthoringRevision !== null
      : !isPositiveRevision(snapshot.expectedAuthoringRevision))
  ) {
    return { status: 'invalid' };
  }
  if (
    command !== undefined &&
    (snapshot.commandId !== command.commandId ||
      snapshot.projectId !== command.projectId ||
      snapshot.policy !== command.policy ||
      snapshot.expectedAuthoringRevision !== expectedAuthoringRevisionFor(command))
  ) {
    return { status: 'invalid' };
  }
  if (status === 'succeeded') {
    const resultValid =
      snapshot.policy === 'get_project_status'
        ? isLoadResult(snapshot.result)
        : snapshot.policy === 'prepare_photo'
          ? isPrepareResult(snapshot.result)
          : isMutationResult(snapshot.result, snapshot.projectId as string);
    return resultValid
      ? { status: 'valid', receipt: snapshot as StudioPilotDirectorSucceededReceipt }
      : { status: 'invalid' };
  }
  if (
    (status === 'rejected' && REJECTED_REASONS.has(snapshot.reasonCode as StudioPilotDirectorRejectedReason)) ||
    (status === 'expired' && snapshot.reasonCode === 'deadline_elapsed') ||
    (status === 'indeterminate' && snapshot.reasonCode === 'indeterminate_after_restart')
  ) {
    return { status: 'valid', receipt: snapshot as StudioPilotDirectorReceipt };
  }
  return { status: 'invalid' };
};

/** Exact parser for the durable processing marker used to prevent write replay after restart. */
export const parseStudioPilotDirectorClaim = (value: unknown): StudioPilotDirectorClaim | null => {
  const snapshot = snapshotExactRecord(value, CLAIM_KEYS);
  if (
    snapshot === null ||
    snapshot.schemaVersion !== STUDIO_PILOT_DIRECTOR_COMMAND_SCHEMA_VERSION ||
    !isSafeId(snapshot.commandId) ||
    !isSafeId(snapshot.projectId) ||
    !isSafeId(snapshot.processorId) ||
    studioPilotDirectorTimestampMs(snapshot.claimedAt) === null
  ) {
    return null;
  }
  return snapshot as StudioPilotDirectorClaim;
};

export const studioPilotDirectorExpectedAuthoringRevision = expectedAuthoringRevisionFor;
