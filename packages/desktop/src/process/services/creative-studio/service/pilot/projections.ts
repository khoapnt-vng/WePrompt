/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { types as nodeTypes } from 'node:util';
import {
  STUDIO_MAX_JOBS_PER_PIECE_V3,
  STUDIO_MAX_JOBS_V3,
  STUDIO_MAX_SPEND_AUTHORIZATIONS_V3,
  type StudioPieceJobV3,
  type StudioPiecePhotoSettingsV3,
  type StudioProjectSummaryV3,
  type StudioProjectV3,
  type StudioRendererCanvasInventoryV3,
  type StudioRendererCapabilityActivityV3,
  type StudioRendererPieceActivityJobV3,
  type StudioRendererPieceCurrentProvenanceV3,
  type StudioRendererPieceV3,
  type StudioRendererPreparedPhotoQuoteV3,
} from '@/common/types/project/creativeStudioTypes';
import { normalizeStudioPieceWordsV3 } from '../schema2/generation/composition';
import { isCanonicalStudioPieceHandleV3 } from '../schema2/mutations/pieceHandles';
import { studioPieceRetryReasonForPredecessorV3, validateStudioProjectV3 } from '../schema2/validation';

const SAFE_ID = /^[A-Za-z0-9_-]{1,256}$/;
const CURRENCY = /^[A-Z]{3}$/;
const PREPARED_QUOTE_KEYS = new Set([
  'reservationId',
  'projectId',
  'quoteId',
  'quoteRevision',
  'targetPieceId',
  'words',
  'settings',
  'currency',
  'lowerMinorUnits',
  'upperMinorUnits',
  'spendPolicyClassification',
  'expiresAt',
  'requiresExplicitHumanAction',
  'duplicateChargeAcknowledgementRequired',
  'mode',
  'proposedHandle',
]);
const PHOTO_SETTINGS_KEYS = new Set(['aspectRatio', 'resolution']);
const PREPARED_QUOTE_CLASSIFICATIONS = new Set(['within_cap', 'no_policy', 'currency_mismatch', 'over_cap']);

const invalidProjection = (): never => {
  throw new TypeError('invalid_schema_6_projection_input');
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

const snapshotDenseArray = (value: unknown): unknown[] | null => {
  try {
    if (!Array.isArray(value) || nodeTypes.isProxy(value)) return null;
    const ownKeys = Reflect.ownKeys(value);
    if (
      ownKeys.length !== value.length + 1 ||
      ownKeys.at(-1) !== 'length' ||
      ownKeys.slice(0, -1).some((key, index) => key !== String(index))
    ) {
      return null;
    }
    const snapshot: unknown[] = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (descriptor === undefined || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) return null;
      snapshot.push(descriptor.value);
    }
    return snapshot;
  } catch {
    return null;
  }
};

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

const isSafeId = (value: unknown): value is string => typeof value === 'string' && SAFE_ID.test(value);
const isPositiveInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
const isCanonicalTimestamp = (value: unknown): value is string => {
  if (typeof value !== 'string') return false;
  try {
    return new Date(value).toISOString() === value;
  } catch {
    return false;
  }
};

const requireProject = (value: unknown): StudioProjectV3 => {
  if (!validateStudioProjectV3(value)) return invalidProjection();
  return value;
};

const snapshotPreparedQuote = (value: unknown, projectId: string): StudioRendererPreparedPhotoQuoteV3 => {
  const snapshot = snapshotExactRecord(value, PREPARED_QUOTE_KEYS);
  const settings = snapshotPhotoSettings(snapshot?.settings);
  let normalizedWords: string;
  try {
    normalizedWords = normalizeStudioPieceWordsV3(snapshot?.words as string);
  } catch {
    return invalidProjection();
  }
  if (
    snapshot === null ||
    !isSafeId(snapshot.reservationId) ||
    snapshot.projectId !== projectId ||
    !isSafeId(snapshot.quoteId) ||
    !isPositiveInteger(snapshot.quoteRevision) ||
    !isSafeId(snapshot.targetPieceId) ||
    typeof snapshot.words !== 'string' ||
    normalizedWords !== snapshot.words ||
    settings === null ||
    typeof snapshot.currency !== 'string' ||
    !CURRENCY.test(snapshot.currency) ||
    !isPositiveInteger(snapshot.lowerMinorUnits) ||
    snapshot.upperMinorUnits !== snapshot.lowerMinorUnits ||
    typeof snapshot.spendPolicyClassification !== 'string' ||
    !PREPARED_QUOTE_CLASSIFICATIONS.has(snapshot.spendPolicyClassification) ||
    !isCanonicalTimestamp(snapshot.expiresAt) ||
    typeof snapshot.requiresExplicitHumanAction !== 'boolean' ||
    typeof snapshot.duplicateChargeAcknowledgementRequired !== 'boolean' ||
    (snapshot.duplicateChargeAcknowledgementRequired && !snapshot.requiresExplicitHumanAction)
  ) {
    return invalidProjection();
  }
  const base = {
    reservationId: snapshot.reservationId,
    projectId,
    quoteId: snapshot.quoteId,
    quoteRevision: snapshot.quoteRevision,
    targetPieceId: snapshot.targetPieceId,
    words: snapshot.words,
    settings,
    currency: snapshot.currency,
    lowerMinorUnits: snapshot.lowerMinorUnits,
    upperMinorUnits: snapshot.upperMinorUnits,
    spendPolicyClassification:
      snapshot.spendPolicyClassification as StudioRendererPreparedPhotoQuoteV3['spendPolicyClassification'],
    expiresAt: snapshot.expiresAt,
    requiresExplicitHumanAction: snapshot.requiresExplicitHumanAction,
    duplicateChargeAcknowledgementRequired: snapshot.duplicateChargeAcknowledgementRequired,
  };
  if (snapshot.mode === 'create' && isCanonicalStudioPieceHandleV3(snapshot.proposedHandle)) {
    return { ...base, mode: 'create', proposedHandle: snapshot.proposedHandle };
  }
  if (snapshot.mode === 'retry' && snapshot.proposedHandle === null) {
    return { ...base, mode: 'retry', proposedHandle: null };
  }
  return invalidProjection();
};

const snapshotPreparedQuotes = (value: unknown, projectId: string): StudioRendererPreparedPhotoQuoteV3[] => {
  const values = snapshotDenseArray(value);
  if (values === null) return invalidProjection();
  const seenReservations = new Set<string>();
  const seenQuotes = new Set<string>();
  const quotes = values.map((candidate) => snapshotPreparedQuote(candidate, projectId));
  for (const quote of quotes) {
    const quoteKey = `${quote.quoteId}\0${quote.quoteRevision}`;
    if (seenReservations.has(quote.reservationId) || seenQuotes.has(quoteKey)) return invalidProjection();
    seenReservations.add(quote.reservationId);
    seenQuotes.add(quoteKey);
  }
  return quotes.toSorted(
    (left, right) =>
      left.expiresAt.localeCompare(right.expiresAt) ||
      left.reservationId.localeCompare(right.reservationId) ||
      left.quoteId.localeCompare(right.quoteId)
  );
};

const pieceState = (project: StudioProjectV3, pieceId: string): StudioRendererPieceV3['state'] => {
  const piece = project.pieces[pieceId]!;
  if (piece.currentAssetId !== null) return 'current';
  const latestJobId = piece.jobIds.at(-1);
  if (latestJobId === undefined) return invalidProjection();
  switch (project.jobs[latestJobId]!.status) {
    case 'queued_local':
    case 'submitting':
    case 'queued_remote':
      return 'queued';
    case 'running':
      return 'running';
    case 'needs_attention':
      return 'needs_attention';
    case 'failed':
      return 'failed';
    case 'cancelled':
      return 'cancelled';
    case 'succeeded':
      return invalidProjection();
  }
};

const canCancelJob = (job: StudioPieceJobV3): boolean => {
  if (job.spendReceipt !== null) return false;
  if (job.status === 'queued_local') return true;
  if (job.status === 'queued_remote') return job.cancellationPolicy !== 'none' && job.providerJobId !== null;
  if (job.status === 'running' || job.status === 'needs_attention') {
    return job.cancellationPolicy === 'queued_and_running' && job.providerJobId !== null;
  }
  return false;
};

const retryChildren = (project: StudioProjectV3): ReadonlySet<string> =>
  new Set(Object.values(project.jobs).flatMap((job) => (job.retryOfJobId === null ? [] : [job.retryOfJobId])));

const canRetryJob = (project: StudioProjectV3, job: StudioPieceJobV3, children: ReadonlySet<string>): boolean => {
  const piece = project.pieces[job.target.pieceId]!;
  return (
    piece.currentAssetId === null &&
    !children.has(job.id) &&
    piece.jobIds.length < STUDIO_MAX_JOBS_PER_PIECE_V3 &&
    Object.keys(project.jobs).length < STUDIO_MAX_JOBS_V3 &&
    project.spendAuthorizations.length < STUDIO_MAX_SPEND_AUTHORIZATIONS_V3 &&
    studioPieceRetryReasonForPredecessorV3(job) !== null
  );
};

const hasOtherActivePieceJob = (project: StudioProjectV3, job: StudioPieceJobV3): boolean => {
  const piece = project.pieces[job.target.pieceId]!;
  return piece.jobIds.some((jobId) => {
    if (jobId === job.id) return false;
    const status = project.jobs[jobId]!.status;
    return status === 'queued_local' || status === 'submitting' || status === 'queued_remote' || status === 'running';
  });
};

const isSoleLatestUnpublishedJob = (
  project: StudioProjectV3,
  job: StudioPieceJobV3,
  children: ReadonlySet<string>
): boolean => {
  const piece = project.pieces[job.target.pieceId]!;
  return (
    piece.currentAssetId === null &&
    piece.jobIds.at(-1) === job.id &&
    !children.has(job.id) &&
    !hasOtherActivePieceJob(project, job)
  );
};

const canRetryJobDownload = (project: StudioProjectV3, job: StudioPieceJobV3, children: ReadonlySet<string>): boolean =>
  job.status === 'failed' &&
  job.error?.code === 'download_failed' &&
  job.spendReceipt !== null &&
  job.providerSubmissionKind !== null &&
  isSoleLatestUnpublishedJob(project, job, children);

const canResumeJob = (project: StudioProjectV3, job: StudioPieceJobV3, children: ReadonlySet<string>): boolean =>
  job.status === 'needs_attention' &&
  job.error?.code === 'poll_deadline' &&
  job.providerSubmissionKind === 'remote' &&
  job.providerJobId !== null &&
  isSoleLatestUnpublishedJob(project, job, children);

const currentProvenance = (
  project: StudioProjectV3,
  pieceId: string
): StudioRendererPieceCurrentProvenanceV3 | null => {
  const piece = project.pieces[pieceId];
  if (piece === undefined) return invalidProjection();
  if (piece.currentAssetId === null) return null;
  const asset = project.assets[piece.currentAssetId]!;
  if (asset.origin === 'imported') return { origin: 'imported', createdAt: asset.createdAt };
  const producer = project.jobs[asset.producerJobId]!;
  const receipt = producer.spendReceipt;
  if (receipt === null) return invalidProjection();
  return {
    origin: 'generated',
    createdAt: asset.createdAt,
    producerJobId: producer.id,
    model: producer.provider.model,
    instructionProfile: producer.composition.inputs.instructionProfile,
    recordedSpend: {
      currency: receipt.currency,
      totalMinorUnits: receipt.totalMinorUnits,
    },
  };
};

/** Returns the minimal project list/card facts and no storage or Director binding authority. */
export const toStudioProjectSummaryV3 = (value: unknown): StudioProjectSummaryV3 => {
  const project = requireProject(value);
  return {
    id: project.id,
    name: project.name,
    pieceCount: project.pieceOrder.length,
    currentPieceCount: project.pieceOrder.filter((pieceId) => project.pieces[pieceId]!.currentAssetId !== null).length,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  };
};

/** Projects only the safe provenance needed to explain the current image. */
export const toStudioRendererPieceCurrentProvenanceV3 = (
  value: unknown,
  pieceId: string
): StudioRendererPieceCurrentProvenanceV3 | null => {
  const project = requireProject(value);
  if (!isSafeId(pieceId)) return invalidProjection();
  return currentProvenance(project, pieceId);
};

/** Projects the ordered one-photo Piece canvas without paths, hashes, Jobs, or spend authority. */
export const toStudioRendererCanvasInventoryV3 = (value: unknown): StudioRendererCanvasInventoryV3 => {
  const project = requireProject(value);
  return {
    projectId: project.id,
    revision: project.revision,
    authoringRevision: project.authoringRevision,
    pieces: project.pieceOrder.map((pieceId) => {
      const piece = project.pieces[pieceId]!;
      const currentAsset =
        piece.currentAssetId === null
          ? null
          : (() => {
              const asset = project.assets[piece.currentAssetId]!;
              const provenance = currentProvenance(project, pieceId);
              if (provenance === null) return invalidProjection();
              return {
                id: asset.id,
                mediaKind: 'image' as const,
                mimeType: asset.mimeType,
                width: asset.width,
                height: asset.height,
                byteSize: asset.byteSize,
                provenance,
              };
            })();
      return {
        id: piece.id,
        kind: piece.kind,
        handle: piece.handle,
        priorHandles: [...piece.priorHandles],
        currentAsset,
        state: pieceState(project, pieceId),
      };
    }),
  };
};

/** Projects transient quotes and persisted Job capabilities without any Main-only execution authority. */
export const toStudioRendererCapabilityActivityV3 = (
  value: unknown,
  preparedPhotoQuotes: unknown
): StudioRendererCapabilityActivityV3 => {
  const project = requireProject(value);
  const children = retryChildren(project);
  const jobs: StudioRendererPieceActivityJobV3[] = project.pieceOrder.flatMap((pieceId) =>
    project.pieces[pieceId]!.jobIds.map((jobId) => {
      const job = project.jobs[jobId]!;
      return {
        jobId: job.id,
        pieceId,
        status: job.status,
        progress: job.progress,
        error: job.error === null ? null : { code: job.error.code, messageKey: job.error.messageKey },
        canCancel: canCancelJob(job),
        canRetry: canRetryJob(project, job, children),
        canRetryDownload: canRetryJobDownload(project, job, children),
        canResume: canResumeJob(project, job, children),
        recordedSpend:
          job.spendReceipt === null
            ? null
            : {
                currency: job.spendReceipt.currency,
                totalMinorUnits: job.spendReceipt.totalMinorUnits,
              },
      };
    })
  );
  return {
    projectId: project.id,
    preparedPhotoQuotes: snapshotPreparedQuotes(preparedPhotoQuotes, project.id),
    jobs,
  };
};
