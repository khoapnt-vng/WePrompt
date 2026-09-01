/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { types as nodeTypes } from 'node:util';
import {
  STUDIO_MAX_GENERATION_PROMPT_LENGTH,
  type StudioApplyMutationBatchRequestV3,
  type StudioCancelPieceJobRequestV3,
  type StudioConfirmPreparedPhotoRequestV3,
  type StudioCreateProjectRequestV3,
  type StudioDeleteProjectRequestV3,
  type StudioDiscardPreparedPhotoRequestV3,
  type StudioExportPieceRequestV3,
  type StudioImportPhotoRequestV3,
  type StudioPiecePhotoSettingsV3,
  type StudioPreparePhotoIntentV3,
  type StudioPreparePhotoRequestV3,
  type StudioRetryPieceJobRequestV3,
  type StudioRetryPieceDownloadRequestV3,
  type StudioResumePieceJobRequestV3,
} from '@/common/types/project/creativeStudioTypes';
import { parseStudioMutationBatchV3, StudioMutationErrorV3 } from '../schema2/mutations/pieceCatalogV3';

const SAFE_ID = /^[A-Za-z0-9_-]{1,256}$/;
const DELETION_CLAIM = /^studio-delete-v3_[A-Za-z0-9_-]{32,256}$/;
const CREATE_PROJECT_KEYS = new Set(['name', 'brief']);
const PREPARE_PHOTO_KEYS = new Set([
  'mode',
  'projectId',
  'expectedAuthoringRevision',
  'words',
  'settings',
  'suggestedHandle',
]);
const RETRY_PIECE_JOB_KEYS = new Set(['mode', 'projectId', 'expectedAuthoringRevision', 'pieceId', 'sourceJobId']);
const IMPORT_PHOTO_KEYS = new Set(['projectId', 'expectedAuthoringRevision']);
const CANCEL_PIECE_JOB_KEYS = new Set(['projectId', 'pieceId', 'jobId']);
const RETRY_PIECE_DOWNLOAD_KEYS = new Set(['projectId', 'pieceId', 'jobId', 'expectedRevision']);
const RESUME_PIECE_JOB_KEYS = new Set(['projectId', 'pieceId', 'jobId', 'expectedRevision']);
const EXPORT_PIECE_KEYS = new Set(['projectId', 'pieceId', 'expectedRevision', 'expectedCatalogRevision']);
const DELETE_HEALTHY_PROJECT_KEYS = new Set(['mode', 'projectId', 'expectedRevision']);
const DELETE_UNREADABLE_PROJECT_KEYS = new Set(['mode', 'projectId', 'deletionClaim']);
const CONFIRM_PREPARED_PHOTO_KEYS = new Set([
  'reservationId',
  'quoteId',
  'quoteRevision',
  'explicitHumanConfirmation',
  'duplicateChargeAcknowledged',
]);
const DISCARD_PREPARED_PHOTO_KEYS = new Set(['reservationId', 'quoteId', 'quoteRevision']);
const PHOTO_SETTINGS_KEYS = new Set(['aspectRatio', 'resolution']);

export class CreativeStudioPilotContractErrorV3 extends Error {
  readonly code: 'invalid_payload' | 'invalid_handle';

  constructor(code: 'invalid_payload' | 'invalid_handle' = 'invalid_payload') {
    super(code);
    this.name = 'CreativeStudioPilotContractErrorV3';
    this.code = code;
  }
}

const invalidPayload = (): never => {
  throw new CreativeStudioPilotContractErrorV3();
};

const snapshotExactRecord = (value: unknown, keys: ReadonlySet<string>): Record<string, unknown> | null => {
  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value) || nodeTypes.isProxy(value)) return null;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length !== keys.size || ownKeys.some((key) => typeof key !== 'string' || !keys.has(key))) return null;
    const snapshot: Record<string, unknown> = {};
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) return null;
      snapshot[key] = descriptor.value;
    }
    return snapshot;
  } catch {
    return null;
  }
};

const isSafeId = (value: unknown): value is string => typeof value === 'string' && SAFE_ID.test(value);

const isPositiveRevision = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;

const isSuggestedHandle = (value: unknown): value is string | null =>
  value === null ||
  (typeof value === 'string' && value.length > 0 && value.length <= STUDIO_MAX_GENERATION_PROMPT_LENGTH);

const snapshotPhotoSettings = (value: unknown): StudioPiecePhotoSettingsV3 | null => {
  const snapshot = snapshotExactRecord(value, PHOTO_SETTINGS_KEYS);
  if (
    snapshot === null ||
    (snapshot.aspectRatio !== '16:9' &&
      snapshot.aspectRatio !== '9:16' &&
      snapshot.aspectRatio !== '1:1' &&
      snapshot.aspectRatio !== '4:3' &&
      snapshot.aspectRatio !== '3:4') ||
    (snapshot.resolution !== '720p' && snapshot.resolution !== '1080p')
  ) {
    return null;
  }
  return { aspectRatio: snapshot.aspectRatio, resolution: snapshot.resolution };
};

/** Parses the only public schema-6 project-creation input; integrations remain Main-owned. */
export const parseStudioCreateProjectRequestV3 = (value: unknown): StudioCreateProjectRequestV3 => {
  const snapshot = snapshotExactRecord(value, CREATE_PROJECT_KEYS);
  if (
    snapshot === null ||
    typeof snapshot.name !== 'string' ||
    snapshot.name.length === 0 ||
    snapshot.name.length > 256 ||
    snapshot.name !== snapshot.name.trim() ||
    typeof snapshot.brief !== 'string' ||
    snapshot.brief.length > 16 * 1024
  ) {
    return invalidPayload();
  }
  return { name: snapshot.name, brief: snapshot.brief };
};

/** Parses create-photo intent without accepting a route, price, or caller-minted identity. */
export const parseStudioPreparePhotoRequestV3 = (value: unknown): StudioPreparePhotoRequestV3 => {
  const snapshot = snapshotExactRecord(value, PREPARE_PHOTO_KEYS);
  const settings = snapshotPhotoSettings(snapshot?.settings);
  const suggestedHandle = snapshot?.suggestedHandle;
  if (
    snapshot === null ||
    snapshot.mode !== 'create' ||
    !isSafeId(snapshot.projectId) ||
    !isPositiveRevision(snapshot.expectedAuthoringRevision) ||
    typeof snapshot.words !== 'string' ||
    snapshot.words.length === 0 ||
    snapshot.words.length > STUDIO_MAX_GENERATION_PROMPT_LENGTH ||
    snapshot.words.normalize('NFKC').replace(/\s+/gu, ' ').trim().length === 0 ||
    settings === null ||
    !isSuggestedHandle(suggestedHandle)
  ) {
    return invalidPayload();
  }
  return {
    mode: 'create',
    projectId: snapshot.projectId,
    expectedAuthoringRevision: snapshot.expectedAuthoringRevision,
    words: snapshot.words,
    settings,
    suggestedHandle,
  };
};

/** Parses retry preparation without admitting replacement wording, settings, Piece identity, or route. */
export const parseStudioRetryPieceJobRequestV3 = (value: unknown): StudioRetryPieceJobRequestV3 => {
  const snapshot = snapshotExactRecord(value, RETRY_PIECE_JOB_KEYS);
  if (
    snapshot === null ||
    snapshot.mode !== 'retry' ||
    !isSafeId(snapshot.projectId) ||
    !isPositiveRevision(snapshot.expectedAuthoringRevision) ||
    !isSafeId(snapshot.pieceId) ||
    !isSafeId(snapshot.sourceJobId)
  ) {
    return invalidPayload();
  }
  return {
    mode: 'retry',
    projectId: snapshot.projectId,
    expectedAuthoringRevision: snapshot.expectedAuthoringRevision,
    pieceId: snapshot.pieceId,
    sourceJobId: snapshot.sourceJobId,
  };
};

/** Parses the one mode-discriminated preparation service input. */
export const parseStudioPreparePhotoIntentV3 = (value: unknown): StudioPreparePhotoIntentV3 => {
  const createSnapshot = snapshotExactRecord(value, PREPARE_PHOTO_KEYS);
  if (createSnapshot?.mode === 'create') return parseStudioPreparePhotoRequestV3(value);
  const retrySnapshot = snapshotExactRecord(value, RETRY_PIECE_JOB_KEYS);
  if (retrySnapshot?.mode === 'retry') return parseStudioRetryPieceJobRequestV3(value);
  return invalidPayload();
};

/** Parses only the renderer's bounded decision; Main retrieves every quote authority from its cache. */
export const parseStudioConfirmPreparedPhotoRequestV3 = (value: unknown): StudioConfirmPreparedPhotoRequestV3 => {
  const snapshot = snapshotExactRecord(value, CONFIRM_PREPARED_PHOTO_KEYS);
  if (
    snapshot === null ||
    !isSafeId(snapshot.reservationId) ||
    !isSafeId(snapshot.quoteId) ||
    !isPositiveRevision(snapshot.quoteRevision) ||
    typeof snapshot.explicitHumanConfirmation !== 'boolean' ||
    typeof snapshot.duplicateChargeAcknowledged !== 'boolean'
  ) {
    return invalidPayload();
  }
  return {
    reservationId: snapshot.reservationId,
    quoteId: snapshot.quoteId,
    quoteRevision: snapshot.quoteRevision,
    explicitHumanConfirmation: snapshot.explicitHumanConfirmation,
    duplicateChargeAcknowledged: snapshot.duplicateChargeAcknowledged,
  };
};

/** Parses only the identity of the provisional quote the renderer is declining. */
export const parseStudioDiscardPreparedPhotoRequestV3 = (value: unknown): StudioDiscardPreparedPhotoRequestV3 => {
  const snapshot = snapshotExactRecord(value, DISCARD_PREPARED_PHOTO_KEYS);
  if (
    snapshot === null ||
    !isSafeId(snapshot.reservationId) ||
    !isSafeId(snapshot.quoteId) ||
    !isPositiveRevision(snapshot.quoteRevision)
  ) {
    return invalidPayload();
  }
  return {
    reservationId: snapshot.reservationId,
    quoteId: snapshot.quoteId,
    quoteRevision: snapshot.quoteRevision,
  };
};

/** Reuses the single hostile-input-safe schema-6 mutation parser behind the Pilot service name. */
export const parseStudioApplyMutationBatchRequestV3 = (value: unknown): StudioApplyMutationBatchRequestV3 => {
  try {
    return parseStudioMutationBatchV3(value);
  } catch (error) {
    if (error instanceof StudioMutationErrorV3 && error.reasonCode === 'invalid_handle') {
      throw new CreativeStudioPilotContractErrorV3('invalid_handle');
    }
    return invalidPayload();
  }
};

/** Parses native-picker import intent. A path, asset id, Piece id, or filename is always an extra key. */
export const parseStudioImportPhotoRequestV3 = (value: unknown): StudioImportPhotoRequestV3 => {
  const snapshot = snapshotExactRecord(value, IMPORT_PHOTO_KEYS);
  if (snapshot === null || !isSafeId(snapshot.projectId) || !isPositiveRevision(snapshot.expectedAuthoringRevision)) {
    return invalidPayload();
  }
  return { projectId: snapshot.projectId, expectedAuthoringRevision: snapshot.expectedAuthoringRevision };
};

/** Parses runtime cancellation by exact persisted ownership. */
export const parseStudioCancelPieceJobRequestV3 = (value: unknown): StudioCancelPieceJobRequestV3 => {
  const snapshot = snapshotExactRecord(value, CANCEL_PIECE_JOB_KEYS);
  if (snapshot === null || !isSafeId(snapshot.projectId) || !isSafeId(snapshot.pieceId) || !isSafeId(snapshot.jobId)) {
    return invalidPayload();
  }
  return { projectId: snapshot.projectId, pieceId: snapshot.pieceId, jobId: snapshot.jobId };
};

/** Parses exact revision authority for a same-Job paid-output download recovery. */
export const parseStudioRetryPieceDownloadRequestV3 = (value: unknown): StudioRetryPieceDownloadRequestV3 => {
  const snapshot = snapshotExactRecord(value, RETRY_PIECE_DOWNLOAD_KEYS);
  if (
    snapshot === null ||
    !isSafeId(snapshot.projectId) ||
    !isSafeId(snapshot.pieceId) ||
    !isSafeId(snapshot.jobId) ||
    !isPositiveRevision(snapshot.expectedRevision)
  ) {
    return invalidPayload();
  }
  return {
    projectId: snapshot.projectId,
    pieceId: snapshot.pieceId,
    jobId: snapshot.jobId,
    expectedRevision: snapshot.expectedRevision,
  };
};

/** Parses exact revision authority for polling the same provider Job after a deadline. */
export const parseStudioResumePieceJobRequestV3 = (value: unknown): StudioResumePieceJobRequestV3 => {
  const snapshot = snapshotExactRecord(value, RESUME_PIECE_JOB_KEYS);
  if (
    snapshot === null ||
    !isSafeId(snapshot.projectId) ||
    !isSafeId(snapshot.pieceId) ||
    !isSafeId(snapshot.jobId) ||
    !isPositiveRevision(snapshot.expectedRevision)
  ) {
    return invalidPayload();
  }
  return {
    projectId: snapshot.projectId,
    pieceId: snapshot.pieceId,
    jobId: snapshot.jobId,
    expectedRevision: snapshot.expectedRevision,
  };
};

/** Parses one exact Piece export request with project and export-catalog compare-and-swap authority. */
export const parseStudioExportPieceRequestV3 = (value: unknown): StudioExportPieceRequestV3 => {
  const snapshot = snapshotExactRecord(value, EXPORT_PIECE_KEYS);
  if (
    snapshot === null ||
    !isSafeId(snapshot.projectId) ||
    !isSafeId(snapshot.pieceId) ||
    !isPositiveRevision(snapshot.expectedRevision) ||
    !isPositiveRevision(snapshot.expectedCatalogRevision)
  ) {
    return invalidPayload();
  }
  return {
    projectId: snapshot.projectId,
    pieceId: snapshot.pieceId,
    expectedRevision: snapshot.expectedRevision,
    expectedCatalogRevision: snapshot.expectedCatalogRevision,
  };
};

/** Parses healthy revision deletion or opaque-claim unreadable deletion, never a path. */
export const parseStudioDeleteProjectRequestV3 = (value: unknown): StudioDeleteProjectRequestV3 => {
  const healthy = snapshotExactRecord(value, DELETE_HEALTHY_PROJECT_KEYS);
  if (healthy?.mode === 'healthy' && isSafeId(healthy.projectId) && isPositiveRevision(healthy.expectedRevision)) {
    return { mode: 'healthy', projectId: healthy.projectId, expectedRevision: healthy.expectedRevision };
  }
  const unreadable = snapshotExactRecord(value, DELETE_UNREADABLE_PROJECT_KEYS);
  if (
    unreadable?.mode === 'unreadable' &&
    isSafeId(unreadable.projectId) &&
    typeof unreadable.deletionClaim === 'string' &&
    DELETION_CLAIM.test(unreadable.deletionClaim)
  ) {
    return { mode: 'unreadable', projectId: unreadable.projectId, deletionClaim: unreadable.deletionClaim };
  }
  return invalidPayload();
};
