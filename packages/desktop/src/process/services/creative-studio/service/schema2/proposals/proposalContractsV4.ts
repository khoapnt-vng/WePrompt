/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash } from 'node:crypto';
import type { StudioBoardDraftBeatV4 } from '@/common/types/project/creativeStudioTypes';
import { snapshotStudioBoardDraftBeatsV4 } from '../mutations/boardV4';
import {
  hasExactInputKeysV4,
  isCanonicalInputTimestampV4,
  isDenseInputArrayV4,
  isPlainInputRecordV4,
  isSafeInputIdV4,
} from '../mutations/exactInputV4';
import { isCanonicalStudioPieceHandleV3 } from '../mutations/pieceHandles';

/** Proposal sidecars advance independently from the schema-7 project discriminator. */
export const STUDIO_PROPOSAL_SCHEMA_VERSION_V4 = 1 as const;
export const STUDIO_PROPOSAL_MAX_PENDING_PER_PROJECT_V4 = 1 as const;
export const STUDIO_PROPOSAL_MAX_RECORD_BYTES_V4 = 262_144 as const;
/** The current wrapper repeats identity, digest, and admission time around the bounded payload. */
export const STUDIO_PROPOSAL_CURRENT_RECORD_MAX_BYTES_V4 = STUDIO_PROPOSAL_MAX_RECORD_BYTES_V4 + 4_096;
export const STUDIO_PROPOSAL_HISTORY_MAX_BYTES_V4 = 1_048_576 as const;
export const STUDIO_PROPOSAL_RETAINED_PAYLOAD_LIMIT_V4 = 32 as const;
export const STUDIO_PROPOSAL_RETAINED_PAYLOAD_MS_V4 = 7 * 24 * 60 * 60 * 1000;
export const STUDIO_PROPOSAL_TERMINAL_TRANSACTION_SCHEMA_VERSION_V4 = 1 as const;
export const STUDIO_PROPOSAL_TERMINAL_TRANSACTION_MAX_BYTES_V4 = 65_536 as const;
/** A decided envelope contains one bounded payload plus one independently bounded transaction. */
export const STUDIO_PROPOSAL_DECIDED_RECORD_MAX_BYTES_V4 =
  STUDIO_PROPOSAL_MAX_RECORD_BYTES_V4 + STUDIO_PROPOSAL_TERMINAL_TRANSACTION_MAX_BYTES_V4 + 4_096;
/** Pending decisions expire with the existing Director receipt/proposal retention window. */
export const STUDIO_PROPOSAL_PENDING_TTL_MS_V4 = 7 * 24 * 60 * 60 * 1000;
/** Matches the mailbox command-admission tolerance; proposal time may lead the local clock only this far. */
export const STUDIO_PROPOSAL_MAX_FUTURE_SKEW_MS_V4 = 30 * 1000;
export const STUDIO_PROPOSAL_ID_DOMAIN_V4 = 'weprompt:studio-proposal:v4' as const;

const LOWERCASE_SHA256 = /^[a-f0-9]{64}$/;
const STUDIO_PROPOSAL_ID_V4 = /^proposal_[a-f0-9]{64}$/;
const RECORD_KEYS = new Set([
  'schemaVersion',
  'id',
  'projectId',
  'status',
  'baseAuthoringRevision',
  'source',
  'target',
  'issuedMemberIds',
  'payload',
  'createdAt',
  'expiresAt',
  'decidedAt',
]);
const SOURCE_KEYS = new Set(['kind', 'commandId', 'commandSha256']);
const TARGET_KEYS = new Set(['kind', 'boardId']);
const ISSUED_MEMBER_ID_KEYS = new Set(['beatIds', 'shotIds']);
const CREATE_BOARD_PAYLOAD_KEYS = new Set(['kind', 'handle', 'beats']);
const DECISION_KEYS = new Set(['schemaVersion', 'proposalId', 'projectId', 'status', 'decidedAt']);
const ATTRIBUTION_KEYS = new Set([
  'schemaVersion',
  'kind',
  'proposalId',
  'projectId',
  'beforeRevision',
  'afterRevision',
  'beforeAuthoringRevision',
  'afterAuthoringRevision',
  'target',
  'createdBeatIds',
  'createdShotIds',
  'proposalSha256',
  'beforeManifestSha256',
  'afterManifestSha256',
  'committedAt',
]);
const TERMINAL_PROPOSAL_STATUSES = new Set(['accepted', 'rejected', 'expired']);
const TERMINAL_TRANSACTION_COMMON_KEYS = [
  'schemaVersion',
  'kind',
  'proposalId',
  'projectId',
  'proposalSha256',
  'decisionBytes',
] as const;
const ACCEPT_TRANSACTION_KEYS = new Set([...TERMINAL_TRANSACTION_COMMON_KEYS, 'commitBytes']);
const SETTLEMENT_TRANSACTION_KEYS = new Set(TERMINAL_TRANSACTION_COMMON_KEYS);
const CURRENT_KEYS = new Set(['schemaVersion', 'proposalId', 'payloadSha256', 'admittedAt', 'proposal']);
const HISTORY_KEYS = new Set(['schemaVersion', 'entries']);
const TOMBSTONE_KEYS = new Set([
  'proposalId',
  'status',
  'decidedAt',
  'payloadSha256',
  'commandSha256',
  'appliedRevision',
  'payloadRetained',
]);
const DECIDED_ENVELOPE_KEYS = new Set(['schemaVersion', 'proposal', 'payloadSha256', 'terminalTransaction']);

/** The first approved schema-7 proposal arm; later operations require a sidecar version bump. */
export type StudioCreateBoardProposalPayloadV4 = {
  kind: 'create_board';
  handle: string;
  beats: StudioBoardDraftBeatV4[];
};

/** A proposal has exactly one canvas home. Creation proposals carry the future Board id. */
export type StudioProposalTargetV4 = {
  kind: 'board';
  boardId: string;
};

/** Main issues all identities before the immutable proposal record is persisted. */
export type StudioProposalIssuedMemberIdsV4 = {
  beatIds: string[];
  shotIds: string[];
};

/** Exact immutable provenance for a Director-authored proposal. */
export type StudioProposalSourceV4 = {
  kind: 'director_command';
  commandId: string;
  /** Canonical immutable Director command digest, retained after the proposal payload is pruned. */
  commandSha256: string;
};

export type StudioProposalRecordV4 = {
  schemaVersion: typeof STUDIO_PROPOSAL_SCHEMA_VERSION_V4;
  id: string;
  projectId: string;
  status: 'pending';
  baseAuthoringRevision: number;
  source: StudioProposalSourceV4;
  target: StudioProposalTargetV4;
  issuedMemberIds: StudioProposalIssuedMemberIdsV4;
  payload: StudioCreateBoardProposalPayloadV4;
  createdAt: string;
  expiresAt: string;
  decidedAt: null;
};

/**
 * Receipt-recovery result for one canonical proposal replay. The digest is disclosed only for an
 * identity collision: callers can diagnose the mismatch without reading the immutable payload.
 */
export type StudioProposalReplayResultV4 =
  | { outcome: 'admitted'; proposalId: string; proposal: StudioProposalRecordV4 }
  | {
      outcome: 'already_pending';
      proposalId: string;
      proposal: StudioProposalRecordV4;
      admittedAt: string;
    }
  | { outcome: 'busy'; holdingProposalId: string }
  | {
      outcome: 'already_decided';
      proposalId: string;
      status: 'accepted' | 'rejected' | 'expired';
      decidedAt: string;
      appliedRevision: number | null;
    }
  | { outcome: 'identity_collision'; proposalId: string; expectedSha256: string }
  | { outcome: 'unavailable'; reason: 'corrupt_storage' }
  | {
      outcome: 'refused';
      reason:
        | 'invalid_payload'
        | 'stale_authoring'
        | 'proposal_too_large'
        | 'board_capacity_reached'
        | 'handle_collision'
        | 'identity_collision'
        | 'history_capacity';
    };

export type StudioProposalDecisionStatusV4 = 'accepted' | 'rejected' | 'expired';

export type StudioProposalDecisionV4 = {
  schemaVersion: typeof STUDIO_PROPOSAL_SCHEMA_VERSION_V4;
  proposalId: string;
  projectId: string;
  status: StudioProposalDecisionStatusV4;
  decidedAt: string;
};

export type StudioProposalTombstoneV4 = {
  proposalId: string;
  status: StudioProposalDecisionStatusV4;
  decidedAt: string;
  payloadSha256: string;
  commandSha256: string;
  appliedRevision: number | null;
  payloadRetained: boolean;
};

/** The single unanswered proposal. Absence of current.json means no proposal is pending. */
export type StudioProposalCurrentV4 = {
  schemaVersion: typeof STUDIO_PROPOSAL_SCHEMA_VERSION_V4;
  proposalId: string;
  payloadSha256: string;
  admittedAt: string;
  proposal: StudioProposalRecordV4;
};

/** Permanent terminal authority. Entries remain in stable append order when timestamps tie. */
export type StudioProposalHistoryV4 = {
  schemaVersion: typeof STUDIO_PROPOSAL_SCHEMA_VERSION_V4;
  entries: StudioProposalTombstoneV4[];
};

/** Retained payload and durable terminal intent. History—not this envelope—is observable truth. */
export type StudioProposalDecidedEnvelopeV4 = {
  schemaVersion: typeof STUDIO_PROPOSAL_SCHEMA_VERSION_V4;
  proposal: StudioProposalRecordV4;
  payloadSha256: string;
  terminalTransaction: StudioProposalTerminalTransactionV4;
};

/** Correlated commit evidence for one free accepted create-board proposal. It cannot authorize spend. */
export type StudioProposalCommitAttributionV4 = {
  schemaVersion: typeof STUDIO_PROPOSAL_SCHEMA_VERSION_V4;
  kind: 'create_board';
  proposalId: string;
  projectId: string;
  beforeRevision: number;
  afterRevision: number;
  beforeAuthoringRevision: number;
  afterAuthoringRevision: number;
  target: StudioProposalTargetV4;
  createdBeatIds: string[];
  createdShotIds: string[];
  proposalSha256: string;
  beforeManifestSha256: string;
  afterManifestSha256: string;
  committedAt: string;
};

/**
 * Fixed-name terminal-intent claim. Every terminal path publishes one immutable arm before any
 * project effect or decision, so accept/reject/expire arbitrate on the same filesystem name.
 */
export type StudioProposalTerminalTransactionV4 =
  | {
      schemaVersion: typeof STUDIO_PROPOSAL_TERMINAL_TRANSACTION_SCHEMA_VERSION_V4;
      kind: 'accept_board';
      proposalId: string;
      projectId: string;
      proposalSha256: string;
      commitBytes: string;
      decisionBytes: string;
    }
  | {
      schemaVersion: typeof STUDIO_PROPOSAL_TERMINAL_TRANSACTION_SCHEMA_VERSION_V4;
      kind: 'reject_board' | 'expire_board';
      proposalId: string;
      projectId: string;
      proposalSha256: string;
      decisionBytes: string;
    };

export type StudioProposalSidecarParseResultV4<RecordType> =
  | { status: 'valid'; record: RecordType }
  | { status: 'unsupported_prototype_schema' }
  | { status: 'invalid' };

/**
 * Pre-persistence admission is deliberately distinct from persisted-record parsing. A semantically
 * exact proposal that exceeds the sidecar envelope is actionable at creation time, but the same
 * bytes found on disk are an invalid persisted record rather than a recoverable request refusal.
 */
export type StudioProposalRecordAdmissionResultV4 =
  | {
      status: 'valid';
      record: StudioProposalRecordV4;
      proposalBytes: string;
      byteLength: number;
    }
  | {
      status: 'proposal_too_large';
      record: StudioProposalRecordV4;
      proposalBytes: string;
      byteLength: number;
      maxBytes: typeof STUDIO_PROPOSAL_MAX_RECORD_BYTES_V4;
    }
  | { status: 'unsupported_prototype_schema' }
  | { status: 'invalid' };

type SidecarSchemaV4 = 'unsupported' | 'current' | 'other';

const valid = <RecordType>(record: RecordType): StudioProposalSidecarParseResultV4<RecordType> => ({
  status: 'valid',
  record,
});

const unsupported = <RecordType>(): StudioProposalSidecarParseResultV4<RecordType> => ({
  status: 'unsupported_prototype_schema',
});

const invalid = <RecordType>(): StudioProposalSidecarParseResultV4<RecordType> => ({ status: 'invalid' });

const boundedTerminalTransaction = (
  record: StudioProposalTerminalTransactionV4
): StudioProposalSidecarParseResultV4<StudioProposalTerminalTransactionV4> =>
  Buffer.byteLength(JSON.stringify(record), 'utf8') <= STUDIO_PROPOSAL_TERMINAL_TRANSACTION_MAX_BYTES_V4
    ? valid(record)
    : invalid();

const classifySidecarSchema = (value: unknown): SidecarSchemaV4 => {
  try {
    if (!isPlainInputRecordV4(value)) return 'other';
    const descriptor = Object.getOwnPropertyDescriptor(value, 'schemaVersion');
    if (descriptor === undefined || !Object.hasOwn(descriptor, 'value')) return 'other';
    if (
      typeof descriptor.value === 'number' &&
      Number.isSafeInteger(descriptor.value) &&
      descriptor.value >= 1 &&
      descriptor.value !== STUDIO_PROPOSAL_SCHEMA_VERSION_V4
    ) {
      return 'unsupported';
    }
    return descriptor.value === STUDIO_PROPOSAL_SCHEMA_VERSION_V4 ? 'current' : 'other';
  } catch {
    return 'other';
  }
};

const isRevision = (value: unknown, maximum = Number.MAX_SAFE_INTEGER): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 1 && (value as number) <= maximum;

const isSha256 = (value: unknown): value is string => typeof value === 'string' && LOWERCASE_SHA256.test(value);

const sha256Utf8 = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');

export const isStudioProposalIdV4 = (value: unknown): value is string =>
  typeof value === 'string' && STUDIO_PROPOSAL_ID_V4.test(value);

/**
 * Derives the proposal-sidecar identity without granting the Director authority over Board, Beat,
 * or Shot identities. Those durable project identities remain separately Main-issued.
 */
export const deriveStudioProposalIdV4 = (projectId: unknown, commandId: unknown): string => {
  if (!isSafeInputIdV4(projectId) || !isSafeInputIdV4(commandId)) {
    throw new TypeError('projectId and commandId must be safe Studio IDs');
  }
  const digest = sha256Utf8(`${STUDIO_PROPOSAL_ID_DOMAIN_V4}\u0000${JSON.stringify({ commandId, projectId })}`);
  return `proposal_${digest}`;
};

export const deriveStudioProposalExpiresAtV4 = (createdAt: unknown): string => {
  if (!isCanonicalInputTimestampV4(createdAt)) throw new TypeError('createdAt must be a canonical timestamp');
  const expiresAtMs = Date.parse(createdAt) + STUDIO_PROPOSAL_PENDING_TTL_MS_V4;
  try {
    const expiresAt = new Date(expiresAtMs).toISOString();
    if (!isCanonicalInputTimestampV4(expiresAt)) {
      throw new TypeError('createdAt cannot produce a canonical proposal expiry');
    }
    return expiresAt;
  } catch {
    throw new TypeError('createdAt cannot produce a bounded proposal expiry');
  }
};

const snapshotIdList = (value: unknown): string[] | null => {
  if (!isDenseInputArrayV4(value)) return null;
  const ids: string[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (descriptor === undefined || !Object.hasOwn(descriptor, 'value') || !isSafeInputIdV4(descriptor.value)) {
      return null;
    }
    ids.push(descriptor.value);
  }
  return new Set(ids).size === ids.length ? ids : null;
};

const snapshotTarget = (value: unknown): StudioProposalTargetV4 | null => {
  if (
    !isPlainInputRecordV4(value) ||
    !hasExactInputKeysV4(value, TARGET_KEYS) ||
    value.kind !== 'board' ||
    !isSafeInputIdV4(value.boardId)
  ) {
    return null;
  }
  return { kind: 'board', boardId: value.boardId };
};

const snapshotSource = (value: unknown): StudioProposalSourceV4 | null => {
  if (
    !isPlainInputRecordV4(value) ||
    !hasExactInputKeysV4(value, SOURCE_KEYS) ||
    value.kind !== 'director_command' ||
    !isSafeInputIdV4(value.commandId) ||
    !isSha256(value.commandSha256)
  ) {
    return null;
  }
  return { kind: 'director_command', commandId: value.commandId, commandSha256: value.commandSha256 };
};

const snapshotPayload = (value: unknown): StudioCreateBoardProposalPayloadV4 | null => {
  if (
    !isPlainInputRecordV4(value) ||
    !hasExactInputKeysV4(value, CREATE_BOARD_PAYLOAD_KEYS) ||
    value.kind !== 'create_board' ||
    !isCanonicalStudioPieceHandleV3(value.handle)
  ) {
    return null;
  }
  const beats = snapshotStudioBoardDraftBeatsV4(value.beats);
  return beats === null ? null : { kind: 'create_board', handle: value.handle, beats };
};

const arraysEqual = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length && left.every((value, index) => value === right[index]);

const snapshotStudioProposalRecordV4 = (input: {
  projectId: string;
  proposalId: string;
  value: unknown;
}): StudioProposalSidecarParseResultV4<StudioProposalRecordV4> => {
  const schema = classifySidecarSchema(input.value);
  if (schema === 'unsupported') return unsupported();
  if (schema !== 'current' || !isPlainInputRecordV4(input.value) || !hasExactInputKeysV4(input.value, RECORD_KEYS)) {
    return invalid();
  }
  const value = input.value;
  if (
    value.id !== input.proposalId ||
    value.projectId !== input.projectId ||
    !isSafeInputIdV4(value.id) ||
    !isSafeInputIdV4(value.projectId) ||
    value.status !== 'pending' ||
    !isRevision(value.baseAuthoringRevision, Number.MAX_SAFE_INTEGER - 1) ||
    !isCanonicalInputTimestampV4(value.createdAt) ||
    !isCanonicalInputTimestampV4(value.expiresAt) ||
    value.decidedAt !== null
  ) {
    return invalid();
  }
  const source = snapshotSource(value.source);
  const target = snapshotTarget(value.target);
  const payload = snapshotPayload(value.payload);
  if (
    source === null ||
    target === null ||
    payload === null ||
    !isPlainInputRecordV4(value.issuedMemberIds) ||
    !hasExactInputKeysV4(value.issuedMemberIds, ISSUED_MEMBER_ID_KEYS)
  ) {
    return invalid();
  }
  let expectedProposalId: string;
  let expectedExpiresAt: string;
  try {
    expectedProposalId = deriveStudioProposalIdV4(value.projectId, source.commandId);
    expectedExpiresAt = deriveStudioProposalExpiresAtV4(value.createdAt);
  } catch {
    return invalid();
  }
  if (value.id !== expectedProposalId || value.expiresAt !== expectedExpiresAt) return invalid();
  const beatIds = snapshotIdList(value.issuedMemberIds.beatIds);
  const shotIds = snapshotIdList(value.issuedMemberIds.shotIds);
  const expectedShotCount = payload.beats.reduce((total, beat) => total + beat.shots.length, 0);
  if (
    beatIds === null ||
    shotIds === null ||
    beatIds.length !== payload.beats.length ||
    shotIds.length !== expectedShotCount
  ) {
    return invalid();
  }
  const issuedIds = [value.id, value.projectId, target.boardId, ...beatIds, ...shotIds];
  if (new Set(issuedIds).size !== issuedIds.length) return invalid();
  const record: StudioProposalRecordV4 = {
    schemaVersion: STUDIO_PROPOSAL_SCHEMA_VERSION_V4,
    id: value.id,
    projectId: value.projectId,
    status: 'pending',
    baseAuthoringRevision: value.baseAuthoringRevision,
    source,
    target,
    issuedMemberIds: { beatIds, shotIds },
    payload,
    createdAt: value.createdAt,
    expiresAt: value.expiresAt,
    decidedAt: null,
  };
  return valid(record);
};

/**
 * Admits one new immutable proposal before any sidecar I/O. Exact shape and Board semantics are
 * validated first; the byte envelope is classified only after a canonical plain snapshot has been
 * serialized once, so the caller can persist exactly the bytes that were admitted.
 */
export function admitStudioProposalRecordV4(input: {
  projectId: string;
  proposalId: string;
  value: unknown;
}): StudioProposalRecordAdmissionResultV4 {
  const snapshot = snapshotStudioProposalRecordV4(input);
  if (snapshot.status !== 'valid') return snapshot;

  // The semantic snapshot contains only newly allocated plain records, dense arrays, and primitives.
  const proposalBytes = JSON.stringify(snapshot.record);
  const byteLength = Buffer.byteLength(proposalBytes, 'utf8');
  if (byteLength > STUDIO_PROPOSAL_MAX_RECORD_BYTES_V4) {
    return {
      status: 'proposal_too_large',
      record: snapshot.record,
      proposalBytes,
      byteLength,
      maxBytes: STUDIO_PROPOSAL_MAX_RECORD_BYTES_V4,
    };
  }
  return { status: 'valid', record: snapshot.record, proposalBytes, byteLength };
}

export function parseStudioProposalRecordV4(input: {
  projectId: string;
  proposalId: string;
  value: unknown;
}): StudioProposalSidecarParseResultV4<StudioProposalRecordV4> {
  const admitted = admitStudioProposalRecordV4(input);
  if (admitted.status === 'valid') return valid(admitted.record);
  if (admitted.status === 'unsupported_prototype_schema') return unsupported();
  return invalid();
}

export function parseStudioProposalDecisionV4(input: {
  projectId: string;
  proposalId: string;
  value: unknown;
}): StudioProposalSidecarParseResultV4<StudioProposalDecisionV4> {
  const schema = classifySidecarSchema(input.value);
  if (schema === 'unsupported') return unsupported();
  if (schema !== 'current' || !isPlainInputRecordV4(input.value) || !hasExactInputKeysV4(input.value, DECISION_KEYS)) {
    return invalid();
  }
  const value = input.value;
  if (
    value.proposalId !== input.proposalId ||
    value.projectId !== input.projectId ||
    !isStudioProposalIdV4(value.proposalId) ||
    !isSafeInputIdV4(value.projectId) ||
    typeof value.status !== 'string' ||
    !TERMINAL_PROPOSAL_STATUSES.has(value.status) ||
    !isCanonicalInputTimestampV4(value.decidedAt)
  ) {
    return invalid();
  }
  return valid({
    schemaVersion: STUDIO_PROPOSAL_SCHEMA_VERSION_V4,
    proposalId: value.proposalId,
    projectId: value.projectId,
    status: value.status as StudioProposalDecisionStatusV4,
    decidedAt: value.decidedAt,
  });
}

export function parseStudioProposalCommitAttributionV4(input: {
  projectId: string;
  proposalId: string;
  proposalBytes: string;
  value: unknown;
}): StudioProposalSidecarParseResultV4<StudioProposalCommitAttributionV4> {
  const schema = classifySidecarSchema(input.value);
  if (schema === 'unsupported') return unsupported();
  if (
    schema !== 'current' ||
    !isPlainInputRecordV4(input.value) ||
    !hasExactInputKeysV4(input.value, ATTRIBUTION_KEYS)
  ) {
    return invalid();
  }
  if (
    typeof input.proposalBytes !== 'string' ||
    Buffer.byteLength(input.proposalBytes, 'utf8') > STUDIO_PROPOSAL_MAX_RECORD_BYTES_V4
  ) {
    return invalid();
  }
  let proposalValue: unknown;
  try {
    proposalValue = JSON.parse(input.proposalBytes) as unknown;
  } catch {
    return invalid();
  }
  const proposalResult = parseStudioProposalRecordV4({
    projectId: input.projectId,
    proposalId: input.proposalId,
    value: proposalValue,
  });
  if (proposalResult.status === 'unsupported_prototype_schema') return unsupported();
  if (proposalResult.status !== 'valid') return invalid();
  const proposal = proposalResult.record;
  const value = input.value;
  const target = snapshotTarget(value.target);
  const createdBeatIds = snapshotIdList(value.createdBeatIds);
  const createdShotIds = snapshotIdList(value.createdShotIds);
  if (
    value.kind !== 'create_board' ||
    value.proposalId !== input.proposalId ||
    value.projectId !== input.projectId ||
    !isStudioProposalIdV4(value.proposalId) ||
    !isSafeInputIdV4(value.projectId) ||
    !isRevision(value.beforeRevision, Number.MAX_SAFE_INTEGER - 1) ||
    value.afterRevision !== value.beforeRevision + 1 ||
    value.beforeAuthoringRevision !== proposal.baseAuthoringRevision ||
    value.afterAuthoringRevision !== value.beforeAuthoringRevision + 1 ||
    value.beforeRevision < value.beforeAuthoringRevision ||
    value.afterRevision < value.afterAuthoringRevision ||
    target === null ||
    target.boardId !== proposal.target.boardId ||
    createdBeatIds === null ||
    createdShotIds === null ||
    !arraysEqual(createdBeatIds, proposal.issuedMemberIds.beatIds) ||
    !arraysEqual(createdShotIds, proposal.issuedMemberIds.shotIds) ||
    !isSha256(value.proposalSha256) ||
    value.proposalSha256 !== sha256Utf8(input.proposalBytes) ||
    !isSha256(value.beforeManifestSha256) ||
    !isSha256(value.afterManifestSha256) ||
    value.beforeManifestSha256 === value.afterManifestSha256 ||
    !isCanonicalInputTimestampV4(value.committedAt) ||
    value.committedAt < proposal.createdAt ||
    value.committedAt >= proposal.expiresAt
  ) {
    return invalid();
  }
  return valid({
    schemaVersion: STUDIO_PROPOSAL_SCHEMA_VERSION_V4,
    kind: 'create_board',
    proposalId: value.proposalId,
    projectId: value.projectId,
    beforeRevision: value.beforeRevision,
    afterRevision: value.afterRevision,
    beforeAuthoringRevision: value.beforeAuthoringRevision,
    afterAuthoringRevision: value.afterAuthoringRevision,
    target,
    createdBeatIds,
    createdShotIds,
    proposalSha256: value.proposalSha256,
    beforeManifestSha256: value.beforeManifestSha256,
    afterManifestSha256: value.afterManifestSha256,
    committedAt: value.committedAt,
  });
}

/**
 * Parses the bounded terminal-intent claim and proves its embedded immutable settlement records.
 * The transaction protocol is independent from both project and proposal-record schema versions.
 */
export function parseStudioProposalTerminalTransactionV4(input: {
  projectId: string;
  proposalId: string;
  proposalBytes: string;
  value: unknown;
}): StudioProposalSidecarParseResultV4<StudioProposalTerminalTransactionV4> {
  if (
    typeof input.proposalBytes !== 'string' ||
    Buffer.byteLength(input.proposalBytes, 'utf8') > STUDIO_PROPOSAL_MAX_RECORD_BYTES_V4 ||
    new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(input.proposalBytes, 'utf8')) !== input.proposalBytes
  ) {
    return invalid();
  }
  if (!isPlainInputRecordV4(input.value)) return invalid();
  const schemaDescriptor = Object.getOwnPropertyDescriptor(input.value, 'schemaVersion');
  if (
    schemaDescriptor === undefined ||
    !Object.hasOwn(schemaDescriptor, 'value') ||
    schemaDescriptor.value !== STUDIO_PROPOSAL_TERMINAL_TRANSACTION_SCHEMA_VERSION_V4
  ) {
    return typeof schemaDescriptor?.value === 'number' &&
      Number.isSafeInteger(schemaDescriptor.value) &&
      schemaDescriptor.value > STUDIO_PROPOSAL_TERMINAL_TRANSACTION_SCHEMA_VERSION_V4
      ? unsupported()
      : invalid();
  }
  const hasAcceptShape = hasExactInputKeysV4(input.value, ACCEPT_TRANSACTION_KEYS);
  const hasSettlementShape = hasExactInputKeysV4(input.value, SETTLEMENT_TRANSACTION_KEYS);
  if (!hasAcceptShape && !hasSettlementShape) return invalid();
  const value = input.value;
  if (
    (value.kind !== 'accept_board' && value.kind !== 'reject_board' && value.kind !== 'expire_board') ||
    (value.kind === 'accept_board' ? !hasAcceptShape : !hasSettlementShape) ||
    value.proposalId !== input.proposalId ||
    value.projectId !== input.projectId ||
    !isStudioProposalIdV4(value.proposalId) ||
    !isSafeInputIdV4(value.projectId) ||
    !isSha256(value.proposalSha256) ||
    value.proposalSha256 !== sha256Utf8(input.proposalBytes) ||
    typeof value.decisionBytes !== 'string' ||
    (value.kind === 'accept_board' && typeof value.commitBytes !== 'string')
  ) {
    return invalid();
  }
  let proposalValue: unknown;
  try {
    proposalValue = JSON.parse(input.proposalBytes) as unknown;
  } catch {
    return invalid();
  }
  const proposal = parseStudioProposalRecordV4({
    projectId: input.projectId,
    proposalId: input.proposalId,
    value: proposalValue,
  });
  // This is a current terminal-transaction envelope. An unsupported proposal nested inside it is
  // internally inconsistent, not evidence that the terminal protocol itself is unsupported.
  if (proposal.status !== 'valid' || JSON.stringify(proposal.record) !== input.proposalBytes) return invalid();
  let decisionValue: unknown;
  try {
    decisionValue = JSON.parse(value.decisionBytes) as unknown;
  } catch {
    return invalid();
  }
  const decision = parseStudioProposalDecisionV4({
    projectId: input.projectId,
    proposalId: input.proposalId,
    value: decisionValue,
  });
  if (decision.status !== 'valid' || JSON.stringify(decision.record) !== value.decisionBytes) {
    return invalid();
  }
  if (value.kind === 'reject_board' || value.kind === 'expire_board') {
    const expectedDecisionStatus = value.kind === 'reject_board' ? 'rejected' : 'expired';
    const decisionInPendingWindow =
      decision.record.decidedAt >= proposal.record.createdAt && decision.record.decidedAt < proposal.record.expiresAt;
    if (
      decision.record.status !== expectedDecisionStatus ||
      (value.kind === 'reject_board' && !decisionInPendingWindow) ||
      (value.kind === 'expire_board' && decision.record.decidedAt < proposal.record.expiresAt)
    ) {
      return invalid();
    }
    return boundedTerminalTransaction({
      schemaVersion: STUDIO_PROPOSAL_TERMINAL_TRANSACTION_SCHEMA_VERSION_V4,
      kind: value.kind,
      proposalId: value.proposalId,
      projectId: value.projectId,
      proposalSha256: value.proposalSha256,
      decisionBytes: value.decisionBytes,
    });
  }
  if (typeof value.commitBytes !== 'string') return invalid();
  const commitBytes = value.commitBytes;
  let commitValue: unknown;
  try {
    commitValue = JSON.parse(commitBytes) as unknown;
  } catch {
    return invalid();
  }
  const commit = parseStudioProposalCommitAttributionV4({
    projectId: input.projectId,
    proposalId: input.proposalId,
    proposalBytes: input.proposalBytes,
    value: commitValue,
  });
  if (
    commit.status !== 'valid' ||
    decision.record.status !== 'accepted' ||
    decision.record.decidedAt !== commit.record.committedAt ||
    value.proposalSha256 !== commit.record.proposalSha256 ||
    JSON.stringify(commit.record) !== commitBytes
  ) {
    return invalid();
  }
  return boundedTerminalTransaction({
    schemaVersion: STUDIO_PROPOSAL_TERMINAL_TRANSACTION_SCHEMA_VERSION_V4,
    kind: 'accept_board',
    proposalId: value.proposalId,
    projectId: value.projectId,
    proposalSha256: value.proposalSha256,
    commitBytes,
    decisionBytes: value.decisionBytes,
  });
}

export function parseStudioProposalCurrentV4(input: {
  projectId: string;
  value: unknown;
}): StudioProposalSidecarParseResultV4<StudioProposalCurrentV4> {
  const schema = classifySidecarSchema(input.value);
  if (schema === 'unsupported') return unsupported();
  if (schema !== 'current' || !isPlainInputRecordV4(input.value) || !hasExactInputKeysV4(input.value, CURRENT_KEYS)) {
    return invalid();
  }
  const value = input.value;
  if (
    !isStudioProposalIdV4(value.proposalId) ||
    !isSha256(value.payloadSha256) ||
    !isCanonicalInputTimestampV4(value.admittedAt)
  ) {
    return invalid();
  }
  const proposal = parseStudioProposalRecordV4({
    projectId: input.projectId,
    proposalId: value.proposalId,
    value: value.proposal,
  });
  if (proposal.status !== 'valid')
    return proposal.status === 'unsupported_prototype_schema' ? unsupported() : invalid();
  const proposalBytes = JSON.stringify(proposal.record);
  if (
    value.payloadSha256 !== sha256Utf8(proposalBytes) ||
    value.admittedAt !== proposal.record.createdAt ||
    JSON.stringify(value.proposal) !== proposalBytes
  ) {
    return invalid();
  }
  return valid({
    schemaVersion: STUDIO_PROPOSAL_SCHEMA_VERSION_V4,
    proposalId: value.proposalId,
    payloadSha256: value.payloadSha256,
    admittedAt: value.admittedAt,
    proposal: proposal.record,
  });
}

export function parseStudioProposalHistoryV4(
  value: unknown
): StudioProposalSidecarParseResultV4<StudioProposalHistoryV4> {
  const schema = classifySidecarSchema(value);
  if (schema === 'unsupported') return unsupported();
  if (schema !== 'current' || !isPlainInputRecordV4(value) || !hasExactInputKeysV4(value, HISTORY_KEYS)) {
    return invalid();
  }
  if (!isDenseInputArrayV4(value.entries)) return invalid();
  const entries: StudioProposalTombstoneV4[] = [];
  const seen = new Set<string>();
  let previousDecidedAt: string | null = null;
  for (let index = 0; index < value.entries.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value.entries, String(index));
    if (descriptor === undefined || !Object.hasOwn(descriptor, 'value') || !isPlainInputRecordV4(descriptor.value)) {
      return invalid();
    }
    const entry = descriptor.value;
    if (
      !hasExactInputKeysV4(entry, TOMBSTONE_KEYS) ||
      !isStudioProposalIdV4(entry.proposalId) ||
      typeof entry.status !== 'string' ||
      !TERMINAL_PROPOSAL_STATUSES.has(entry.status) ||
      !isCanonicalInputTimestampV4(entry.decidedAt) ||
      !isSha256(entry.payloadSha256) ||
      !isSha256(entry.commandSha256) ||
      (entry.appliedRevision !== null && !isRevision(entry.appliedRevision)) ||
      (entry.status === 'accepted') !== (entry.appliedRevision !== null) ||
      typeof entry.payloadRetained !== 'boolean' ||
      seen.has(entry.proposalId) ||
      (previousDecidedAt !== null && entry.decidedAt < previousDecidedAt)
    ) {
      return invalid();
    }
    seen.add(entry.proposalId);
    previousDecidedAt = entry.decidedAt;
    entries.push({
      proposalId: entry.proposalId,
      status: entry.status as StudioProposalDecisionStatusV4,
      decidedAt: entry.decidedAt,
      payloadSha256: entry.payloadSha256,
      commandSha256: entry.commandSha256,
      appliedRevision: entry.appliedRevision as number | null,
      payloadRetained: entry.payloadRetained,
    });
  }
  return valid({ schemaVersion: STUDIO_PROPOSAL_SCHEMA_VERSION_V4, entries });
}

export function parseStudioProposalDecidedEnvelopeV4(input: {
  projectId: string;
  proposalId: string;
  value: unknown;
}): StudioProposalSidecarParseResultV4<StudioProposalDecidedEnvelopeV4> {
  const schema = classifySidecarSchema(input.value);
  if (schema === 'unsupported') return unsupported();
  if (
    schema !== 'current' ||
    !isPlainInputRecordV4(input.value) ||
    !hasExactInputKeysV4(input.value, DECIDED_ENVELOPE_KEYS) ||
    !isSha256(input.value.payloadSha256)
  ) {
    return invalid();
  }
  const proposal = parseStudioProposalRecordV4({
    projectId: input.projectId,
    proposalId: input.proposalId,
    value: input.value.proposal,
  });
  if (proposal.status !== 'valid')
    return proposal.status === 'unsupported_prototype_schema' ? unsupported() : invalid();
  const proposalBytes = JSON.stringify(proposal.record);
  if (
    input.value.payloadSha256 !== sha256Utf8(proposalBytes) ||
    JSON.stringify(input.value.proposal) !== proposalBytes
  ) {
    return invalid();
  }
  const terminal = parseStudioProposalTerminalTransactionV4({
    projectId: input.projectId,
    proposalId: input.proposalId,
    proposalBytes,
    value: input.value.terminalTransaction,
  });
  if (terminal.status !== 'valid')
    return terminal.status === 'unsupported_prototype_schema' ? unsupported() : invalid();
  return valid({
    schemaVersion: STUDIO_PROPOSAL_SCHEMA_VERSION_V4,
    proposal: proposal.record,
    payloadSha256: input.value.payloadSha256,
    terminalTransaction: terminal.record,
  });
}
