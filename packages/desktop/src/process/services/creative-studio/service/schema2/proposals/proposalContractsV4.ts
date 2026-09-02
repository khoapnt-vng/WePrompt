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
export const STUDIO_PROPOSAL_SCHEMA_VERSION_V4 = 7 as const;
export const STUDIO_PROPOSAL_MAX_PENDING_PER_PROJECT_V4 = 1 as const;
export const STUDIO_PROPOSAL_MAX_RECORD_BYTES_V4 = 262_144 as const;

const LOWERCASE_SHA256 = /^[a-f0-9]{64}$/;
const RECORD_KEYS = new Set([
  'schemaVersion',
  'id',
  'projectId',
  'status',
  'baseAuthoringRevision',
  'target',
  'issuedMemberIds',
  'payload',
  'createdAt',
  'decidedAt',
]);
const TARGET_KEYS = new Set(['kind', 'boardId']);
const ISSUED_MEMBER_ID_KEYS = new Set(['beatIds', 'shotIds']);
const CREATE_BOARD_PAYLOAD_KEYS = new Set(['kind', 'handle', 'beats']);
const DECISION_KEYS = new Set(['schemaVersion', 'proposalId', 'projectId', 'status', 'decidedAt']);
const SLOT_KEYS = new Set(['schemaVersion', 'proposalId', 'projectId', 'reservedAt']);
const ATTRIBUTION_KEYS = new Set([
  'schemaVersion',
  'kind',
  'proposalId',
  'projectId',
  'baseAuthoringRevision',
  'appliedAuthoringRevision',
  'beforeRevision',
  'appliedRevision',
  'target',
  'createdBeatIds',
  'createdShotIds',
  'proposalSha256',
  'beforeProjectSha256',
  'afterProjectSha256',
  'decidedAt',
]);
const TERMINAL_PROPOSAL_STATUSES = new Set(['accepted', 'rejected', 'expired']);

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

export type StudioProposalRecordV4 = {
  schemaVersion: typeof STUDIO_PROPOSAL_SCHEMA_VERSION_V4;
  id: string;
  projectId: string;
  status: 'pending';
  baseAuthoringRevision: number;
  target: StudioProposalTargetV4;
  issuedMemberIds: StudioProposalIssuedMemberIdsV4;
  payload: StudioCreateBoardProposalPayloadV4;
  createdAt: string;
  decidedAt: null;
};

export type StudioProposalDecisionStatusV4 = 'accepted' | 'rejected' | 'expired';

export type StudioProposalDecisionV4 = {
  schemaVersion: typeof STUDIO_PROPOSAL_SCHEMA_VERSION_V4;
  proposalId: string;
  projectId: string;
  status: StudioProposalDecisionStatusV4;
  decidedAt: string;
};

/** The project-scoped slot is the durable one-unanswered-proposal authority. */
export type StudioProposalSlotV4 = {
  schemaVersion: typeof STUDIO_PROPOSAL_SCHEMA_VERSION_V4;
  proposalId: string;
  projectId: string;
  reservedAt: string;
};

/** Correlated commit evidence for one free accepted create-board proposal. It cannot authorize spend. */
export type StudioProposalCommitAttributionV4 = {
  schemaVersion: typeof STUDIO_PROPOSAL_SCHEMA_VERSION_V4;
  kind: 'create_board';
  proposalId: string;
  projectId: string;
  baseAuthoringRevision: number;
  appliedAuthoringRevision: number;
  beforeRevision: number;
  appliedRevision: number;
  target: StudioProposalTargetV4;
  createdBeatIds: string[];
  createdShotIds: string[];
  proposalSha256: string;
  beforeProjectSha256: string;
  afterProjectSha256: string;
  decidedAt: string;
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
      byteLength: number;
      maxBytes: typeof STUDIO_PROPOSAL_MAX_RECORD_BYTES_V4;
    }
  | { status: 'unsupported_prototype_schema' }
  | { status: 'invalid' };

type SidecarSchemaV4 = 'legacy' | 'current' | 'other';

const valid = <RecordType>(record: RecordType): StudioProposalSidecarParseResultV4<RecordType> => ({
  status: 'valid',
  record,
});

const unsupported = <RecordType>(): StudioProposalSidecarParseResultV4<RecordType> => ({
  status: 'unsupported_prototype_schema',
});

const invalid = <RecordType>(): StudioProposalSidecarParseResultV4<RecordType> => ({ status: 'invalid' });

const classifySidecarSchema = (value: unknown): SidecarSchemaV4 => {
  try {
    if (!isPlainInputRecordV4(value)) return 'other';
    const descriptor = Object.getOwnPropertyDescriptor(value, 'schemaVersion');
    if (descriptor === undefined || !Object.hasOwn(descriptor, 'value')) return 'other';
    if (
      typeof descriptor.value === 'number' &&
      Number.isSafeInteger(descriptor.value) &&
      descriptor.value >= 1 &&
      descriptor.value < STUDIO_PROPOSAL_SCHEMA_VERSION_V4
    ) {
      return 'legacy';
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
  if (schema === 'legacy') return unsupported();
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
    value.decidedAt !== null
  ) {
    return invalid();
  }
  const target = snapshotTarget(value.target);
  const payload = snapshotPayload(value.payload);
  if (
    target === null ||
    payload === null ||
    !isPlainInputRecordV4(value.issuedMemberIds) ||
    !hasExactInputKeysV4(value.issuedMemberIds, ISSUED_MEMBER_ID_KEYS)
  ) {
    return invalid();
  }
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
    target,
    issuedMemberIds: { beatIds, shotIds },
    payload,
    createdAt: value.createdAt,
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
  if (schema === 'legacy') return unsupported();
  if (schema !== 'current' || !isPlainInputRecordV4(input.value) || !hasExactInputKeysV4(input.value, DECISION_KEYS)) {
    return invalid();
  }
  const value = input.value;
  if (
    value.proposalId !== input.proposalId ||
    value.projectId !== input.projectId ||
    !isSafeInputIdV4(value.proposalId) ||
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

export function parseStudioProposalSlotV4(input: {
  projectId: string;
  proposalId: string;
  value: unknown;
}): StudioProposalSidecarParseResultV4<StudioProposalSlotV4> {
  const schema = classifySidecarSchema(input.value);
  if (schema === 'legacy') return unsupported();
  if (schema !== 'current' || !isPlainInputRecordV4(input.value) || !hasExactInputKeysV4(input.value, SLOT_KEYS)) {
    return invalid();
  }
  const value = input.value;
  if (
    value.proposalId !== input.proposalId ||
    value.projectId !== input.projectId ||
    !isSafeInputIdV4(value.proposalId) ||
    !isSafeInputIdV4(value.projectId) ||
    !isCanonicalInputTimestampV4(value.reservedAt)
  ) {
    return invalid();
  }
  return valid({
    schemaVersion: STUDIO_PROPOSAL_SCHEMA_VERSION_V4,
    proposalId: value.proposalId,
    projectId: value.projectId,
    reservedAt: value.reservedAt,
  });
}

export function parseStudioProposalCommitAttributionV4(input: {
  projectId: string;
  proposalId: string;
  proposalBytes: string;
  value: unknown;
}): StudioProposalSidecarParseResultV4<StudioProposalCommitAttributionV4> {
  const schema = classifySidecarSchema(input.value);
  if (schema === 'legacy') return unsupported();
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
    !isSafeInputIdV4(value.proposalId) ||
    !isSafeInputIdV4(value.projectId) ||
    value.baseAuthoringRevision !== proposal.baseAuthoringRevision ||
    value.appliedAuthoringRevision !== proposal.baseAuthoringRevision + 1 ||
    !isRevision(value.beforeRevision, Number.MAX_SAFE_INTEGER - 1) ||
    value.appliedRevision !== value.beforeRevision + 1 ||
    value.beforeRevision < value.baseAuthoringRevision ||
    value.appliedRevision < value.appliedAuthoringRevision ||
    target === null ||
    target.boardId !== proposal.target.boardId ||
    createdBeatIds === null ||
    createdShotIds === null ||
    !arraysEqual(createdBeatIds, proposal.issuedMemberIds.beatIds) ||
    !arraysEqual(createdShotIds, proposal.issuedMemberIds.shotIds) ||
    !isSha256(value.proposalSha256) ||
    value.proposalSha256 !== sha256Utf8(input.proposalBytes) ||
    !isSha256(value.beforeProjectSha256) ||
    !isSha256(value.afterProjectSha256) ||
    value.beforeProjectSha256 === value.afterProjectSha256 ||
    !isCanonicalInputTimestampV4(value.decidedAt) ||
    value.decidedAt < proposal.createdAt
  ) {
    return invalid();
  }
  return valid({
    schemaVersion: STUDIO_PROPOSAL_SCHEMA_VERSION_V4,
    kind: 'create_board',
    proposalId: value.proposalId,
    projectId: value.projectId,
    baseAuthoringRevision: value.baseAuthoringRevision,
    appliedAuthoringRevision: value.appliedAuthoringRevision,
    beforeRevision: value.beforeRevision,
    appliedRevision: value.appliedRevision,
    target,
    createdBeatIds,
    createdShotIds,
    proposalSha256: value.proposalSha256,
    beforeProjectSha256: value.beforeProjectSha256,
    afterProjectSha256: value.afterProjectSha256,
    decidedAt: value.decidedAt,
  });
}
