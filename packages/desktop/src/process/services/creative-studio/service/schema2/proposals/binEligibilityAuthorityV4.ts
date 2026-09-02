/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  type StudioCanvasBinSubjectV4,
  type StudioPresentationMutationContextV4,
  type StudioProjectV4,
} from '@/common/types/project/creativeStudioTypes';
import {
  hasExactInputKeysV4,
  isCanonicalInputTimestampV4,
  isDenseInputArrayV4,
  isPlainInputRecordV4,
  isSafeInputIdV4,
} from '../mutations/exactInputV4';
import { snapshotStudioCanvasBinSubjectV4 } from '../mutations/presentationV4';
import { studioPersistentIdentitiesV4 } from '../mutations/projectAuthorityV4';
import { validateStudioProjectV4 } from '../validation';
import {
  parseStudioProposalRecordV4,
  parseStudioProposalSlotV4,
  type StudioProposalRecordV4,
  type StudioProposalSlotV4,
} from './proposalContractsV4';

/** Inactive schema-7 contract: one store-selected id anchors both immutable proposal records. */
export type StudioActiveProposalAuthorityV4 = {
  proposalId: string;
  slot: StudioProposalSlotV4;
  record: StudioProposalRecordV4;
};

/** Main-only projection of a validated prepared reservation; renderer quote rows are insufficient. */
export type StudioActivePhotoQuoteAuthorityV4 = {
  projectId: string;
  mode: 'create' | 'retry';
  reservationId: string;
  quoteId: string;
  quoteRevision: number;
  targetPieceId: string;
  jobId: string;
  authorizationId: string;
  authorizationItemId: string;
  idempotencyKey: string;
  expiresAt: string;
};

export type StudioBinEligibilityDerivationInputV4 = {
  project: StudioProjectV4;
  subjects: unknown;
  entryIds: unknown;
  activeProposal: StudioActiveProposalAuthorityV4 | null;
  activePhotoQuotes: readonly StudioActivePhotoQuoteAuthorityV4[];
  capturedAt: string;
};

export type StudioBinEligibilityEvidenceResultV4 =
  | { status: 'valid'; evidence: StudioPresentationMutationContextV4 }
  | { status: 'invalid_authority' };

const DERIVATION_KEYS = new Set([
  'project',
  'subjects',
  'entryIds',
  'activeProposal',
  'activePhotoQuotes',
  'capturedAt',
]);
const ACTIVE_PROPOSAL_KEYS = new Set(['proposalId', 'slot', 'record']);
const ACTIVE_PHOTO_QUOTE_KEYS = new Set([
  'projectId',
  'mode',
  'reservationId',
  'quoteId',
  'quoteRevision',
  'targetPieceId',
  'jobId',
  'authorizationId',
  'authorizationItemId',
  'idempotencyKey',
  'expiresAt',
]);

const invalidAuthority = (): StudioBinEligibilityEvidenceResultV4 => ({ status: 'invalid_authority' });

const subjectKey = (subject: StudioCanvasBinSubjectV4): string => {
  switch (subject.kind) {
    case 'piece':
      return `piece:${subject.pieceId}`;
    case 'board':
      return `board:${subject.boardId}`;
    case 'board_shot':
      return `board_shot:${subject.boardId}:${subject.shotId}`;
    case 'assembly':
      return `assembly:${subject.assemblyId}`;
  }
};

const snapshotIdArray = (value: unknown): string[] | null => {
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

const reserveIdentities = (namespace: Set<string>, identities: readonly string[]): boolean => {
  if (new Set(identities).size !== identities.length || identities.some((identity) => namespace.has(identity))) {
    return false;
  }
  identities.forEach((identity) => namespace.add(identity));
  return true;
};

const snapshotActiveProposal = (
  project: StudioProjectV4,
  value: unknown,
  capturedAt: string,
  namespace: Set<string>
): StudioProposalRecordV4 | null => {
  if (!isPlainInputRecordV4(value) || !hasExactInputKeysV4(value, ACTIVE_PROPOSAL_KEYS)) return null;
  if (!isSafeInputIdV4(value.proposalId)) return null;
  const recordResult = parseStudioProposalRecordV4({
    projectId: project.id,
    proposalId: value.proposalId,
    value: value.record,
  });
  if (recordResult.status !== 'valid') return null;
  const slotResult = parseStudioProposalSlotV4({
    projectId: project.id,
    proposalId: value.proposalId,
    value: value.slot,
  });
  if (
    slotResult.status !== 'valid' ||
    slotResult.record.reservedAt < project.createdAt ||
    slotResult.record.reservedAt > recordResult.record.createdAt ||
    recordResult.record.createdAt > capturedAt ||
    recordResult.record.baseAuthoringRevision > project.authoringRevision
  ) {
    return null;
  }
  const issuedIds = [
    recordResult.record.id,
    recordResult.record.target.boardId,
    ...recordResult.record.issuedMemberIds.beatIds,
    ...recordResult.record.issuedMemberIds.shotIds,
  ];
  return reserveIdentities(namespace, issuedIds) ? recordResult.record : null;
};

const snapshotActivePhotoQuote = (
  project: StudioProjectV4,
  value: unknown,
  capturedAt: string,
  namespace: Set<string>
): StudioActivePhotoQuoteAuthorityV4 | null => {
  if (!isPlainInputRecordV4(value) || !hasExactInputKeysV4(value, ACTIVE_PHOTO_QUOTE_KEYS)) return null;
  if (
    value.projectId !== project.id ||
    (value.mode !== 'create' && value.mode !== 'retry') ||
    !isSafeInputIdV4(value.reservationId) ||
    !isSafeInputIdV4(value.quoteId) ||
    !Number.isSafeInteger(value.quoteRevision) ||
    (value.quoteRevision as number) < 1 ||
    !isSafeInputIdV4(value.targetPieceId) ||
    !isSafeInputIdV4(value.jobId) ||
    !isSafeInputIdV4(value.authorizationId) ||
    !isSafeInputIdV4(value.authorizationItemId) ||
    !isSafeInputIdV4(value.idempotencyKey) ||
    !isCanonicalInputTimestampV4(value.expiresAt) ||
    value.expiresAt <= capturedAt
  ) {
    return null;
  }
  const targetExists = Object.hasOwn(project.pieces, value.targetPieceId);
  if ((value.mode === 'create' && targetExists) || (value.mode === 'retry' && !targetExists)) return null;
  const reservedIds = [
    value.reservationId,
    value.quoteId,
    value.jobId,
    value.authorizationId,
    value.authorizationItemId,
    value.idempotencyKey,
    ...(value.mode === 'create' ? [value.targetPieceId] : []),
  ];
  if (!reserveIdentities(namespace, reservedIds)) return null;
  return {
    projectId: value.projectId,
    mode: value.mode,
    reservationId: value.reservationId,
    quoteId: value.quoteId,
    quoteRevision: value.quoteRevision as number,
    targetPieceId: value.targetPieceId,
    jobId: value.jobId,
    authorizationId: value.authorizationId,
    authorizationItemId: value.authorizationItemId,
    idempotencyKey: value.idempotencyKey,
    expiresAt: value.expiresAt,
  };
};

/**
 * Derives exact decision rows and issued Bin identities from Main-owned authorities.
 *
 * This Wave recognizes only Piece-photo quotes. Board/cut quote writers do not exist yet; their
 * exact Main projections must be added before those writers land.
 *
 * This is a snapshot derivation, not a commit capability. Project revision does not fence proposal
 * slots or prepared-quote caches. Production may call it only while holding one shared per-project
 * critical section across all three authorities, then commit before releasing that section (or
 * recheck equivalent owner-issued epochs under those owners).
 */
export const deriveStudioBinEligibilityEvidenceV4 = (
  inputValue: StudioBinEligibilityDerivationInputV4
): StudioBinEligibilityEvidenceResultV4 => {
  if (!isPlainInputRecordV4(inputValue) || !hasExactInputKeysV4(inputValue, DERIVATION_KEYS)) {
    return invalidAuthority();
  }
  const input = inputValue;
  if (
    !validateStudioProjectV4(input.project) ||
    !isCanonicalInputTimestampV4(input.capturedAt) ||
    input.capturedAt < input.project.updatedAt
  ) {
    return invalidAuthority();
  }

  if (!isDenseInputArrayV4(input.subjects)) return invalidAuthority();
  const subjects = input.subjects.map(snapshotStudioCanvasBinSubjectV4);
  if (subjects.some((subject) => subject === null)) return invalidAuthority();
  const snapshots = subjects as StudioCanvasBinSubjectV4[];
  const requestedKeys = snapshots.map(subjectKey);
  if (new Set(requestedKeys).size !== requestedKeys.length) return invalidAuthority();
  const entryIds = snapshotIdArray(input.entryIds);
  if (entryIds === null || entryIds.length !== snapshots.length) return invalidAuthority();

  const namespace = studioPersistentIdentitiesV4(input.project);
  const proposal =
    input.activeProposal === null
      ? null
      : snapshotActiveProposal(input.project, input.activeProposal, input.capturedAt, namespace);
  if (input.activeProposal !== null && proposal === null) return invalidAuthority();

  if (!isDenseInputArrayV4(input.activePhotoQuotes)) return invalidAuthority();
  const quoteTargetKeys = new Set<string>();
  for (let index = 0; index < input.activePhotoQuotes.length; index += 1) {
    const quote = snapshotActivePhotoQuote(input.project, input.activePhotoQuotes[index], input.capturedAt, namespace);
    if (quote === null) return invalidAuthority();
    const key = subjectKey({ kind: 'piece', pieceId: quote.targetPieceId });
    if (quoteTargetKeys.has(key)) return invalidAuthority();
    quoteTargetKeys.add(key);
  }
  if (!reserveIdentities(namespace, entryIds)) return invalidAuthority();

  return {
    status: 'valid',
    evidence: {
      projectId: input.project.id,
      projectRevision: input.project.revision,
      entryIds,
      decisions: snapshots.map((subject, index) => {
        const key = requestedKeys[index]!;
        const blockedByBoardProposal =
          proposal !== null &&
          (subject.kind === 'board' || subject.kind === 'board_shot') &&
          subject.boardId === proposal.target.boardId;
        return {
          subject,
          state: blockedByBoardProposal ? 'proposed' : quoteTargetKeys.has(key) ? 'needs_budget' : 'clear',
        };
      }),
      capturedAt: input.capturedAt,
    },
  };
};
