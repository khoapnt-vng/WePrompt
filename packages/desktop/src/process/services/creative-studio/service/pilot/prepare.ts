/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomBytes } from 'node:crypto';
import {
  STUDIO_AUTHORING_FINGERPRINT_VERSION_V3,
  STUDIO_MAX_JOBS_PER_PIECE_V3,
  STUDIO_MAX_PIECES_V3,
  STUDIO_PREPARED_QUOTE_TTL_SECONDS,
  type StudioPieceJobRetryReasonV3,
  type StudioPieceConditioningInputSnapshotV3,
  type StudioPiecePhotoSettingsV3,
  type StudioPreparePhotoIntentV3,
  type StudioPreparePhotoResultV3,
  type StudioPreparedPhotoReservationV3,
  type StudioProjectV3,
} from '@/common/types/project/creativeStudioTypes';
import type { StudioProviderResolver } from '@process/services/creative-studio/providerResolver';
import type { CreativeStudioPilotStoreV3 } from '@process/services/creative-studio/store/pilotStore';
import {
  composeStudioPieceGenerationV3,
  createStudioAuthoringFingerprintV3,
  createStudioPieceGenerationRequestPlanV3,
  deriveStudioPieceInstructionProfileV3,
  normalizeStudioPieceWordsV3,
} from '../schema2/generation';
import { deriveStudioPieceHandleV3, studioPieceHandleNamespaceV3 } from '../schema2/mutations/pieceHandles';
import type { StudioPreparedPhotoCacheV3 } from '../schema2/pricing';
import { createStudioPieceSubmissionQuoteV3 } from '../schema2/pricing';
import { studioPieceRetryReasonForPredecessorV3 } from '../schema2/validation';
import { parseStudioPreparePhotoIntentV3 } from './contracts';
import { CreativeStudioPilotServiceErrorV3, normalizeCreativeStudioPilotErrorV3 } from './errors';
import { resolveStudioPieceRouteAndRateV3, type StudioPieceRouteAndRateV3 } from './pricing';

export type StudioPilotIdentityKindV3 = 'reservation' | 'piece' | 'job' | 'authorization' | 'quote' | 'idempotency';

export type StudioPilotPreparePhotoDepsV3 = {
  store: CreativeStudioPilotStoreV3;
  preparedPhotos: StudioPreparedPhotoCacheV3;
  providerResolver: Pick<StudioProviderResolver, 'listGenerationRoutes'>;
  resolveRouteAndRate?: (
    resolver: Pick<StudioProviderResolver, 'listGenerationRoutes'>,
    settings: StudioPiecePhotoSettingsV3,
    conditioningInputCount: number
  ) => Promise<StudioPieceRouteAndRateV3>;
  now?: () => number;
  mintIdentity?: (kind: StudioPilotIdentityKindV3) => string;
};

export type StudioPilotPreparePhotoServiceV3 = {
  preparePhotoV3(input: unknown): Promise<StudioPreparePhotoResultV3>;
};

const ID_PREFIX: Readonly<Record<StudioPilotIdentityKindV3, string>> = {
  reservation: 'reservation',
  piece: 'piece',
  job: 'job',
  authorization: 'authorization',
  quote: 'quote',
  idempotency: 'idempotency',
};
const SAFE_ID = /^[A-Za-z0-9_-]{1,256}$/u;

const defaultMintIdentity = (kind: StudioPilotIdentityKindV3): string =>
  `${ID_PREFIX[kind]}_${randomBytes(16).toString('hex')}`;

const allPersistentIds = (project: StudioProjectV3): Set<string> => {
  const ids = new Set<string>([
    project.id,
    ...project.pieceOrder,
    ...Object.keys(project.assets),
    ...Object.keys(project.jobs),
  ]);
  for (const authorization of project.spendAuthorizations) {
    ids.add(authorization.id);
    ids.add(authorization.quote.id);
    ids.add(authorization.quote.reservationId);
    ids.add(authorization.quote.item.id);
    ids.add(authorization.idempotencyKey.key);
  }
  return ids;
};

const readClock = (now: () => number): number => {
  const value = now();
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new CreativeStudioPilotServiceErrorV3('storage_error');
  }
  return value;
};

const resolveConditioningInputs = (
  project: StudioProjectV3,
  referencePieceIds: readonly string[]
): StudioPieceConditioningInputSnapshotV3[] =>
  referencePieceIds.map((pieceId) => {
    const piece = Object.hasOwn(project.pieces, pieceId) ? project.pieces[pieceId] : undefined;
    const asset =
      piece?.currentAssetId !== null &&
      piece?.currentAssetId !== undefined &&
      Object.hasOwn(project.assets, piece.currentAssetId)
        ? project.assets[piece.currentAssetId]
        : undefined;
    if (
      piece === undefined ||
      asset === undefined ||
      asset.projectId !== project.id ||
      asset.pieceId !== piece.id ||
      asset.id !== piece.currentAssetId ||
      asset.mediaKind !== 'image' ||
      (asset.mimeType !== 'image/jpeg' && asset.mimeType !== 'image/png' && asset.mimeType !== 'image/webp')
    ) {
      throw new CreativeStudioPilotServiceErrorV3('invalid_reference');
    }
    return {
      pieceId: piece.id,
      assetId: asset.id,
      sha256: asset.sha256,
      mimeType: asset.mimeType,
      byteSize: asset.byteSize,
    };
  });

const mintUniqueIdentity = (
  kind: StudioPilotIdentityKindV3,
  mintIdentity: (kind: StudioPilotIdentityKindV3) => string,
  unavailable: Set<string>
): string => {
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const candidate = mintIdentity(kind);
    if (typeof candidate === 'string' && SAFE_ID.test(candidate) && !unavailable.has(candidate)) {
      unavailable.add(candidate);
      return candidate;
    }
  }
  throw new CreativeStudioPilotServiceErrorV3('storage_error');
};

const retryAuthority = (
  project: StudioProjectV3,
  intent: Extract<StudioPreparePhotoIntentV3, { mode: 'retry' }>
): {
  words: string;
  settings: StudioPiecePhotoSettingsV3;
  conditioningInputs: StudioPieceConditioningInputSnapshotV3[];
  retryReason: StudioPieceJobRetryReasonV3;
  lineage: Extract<StudioPreparedPhotoReservationV3, { mode: 'retry' }>['lineage'];
} => {
  const piece = Object.hasOwn(project.pieces, intent.pieceId) ? project.pieces[intent.pieceId] : undefined;
  const sourceJob = Object.hasOwn(project.jobs, intent.sourceJobId) ? project.jobs[intent.sourceJobId] : undefined;
  if (
    piece === undefined ||
    sourceJob === undefined ||
    sourceJob.target.pieceId !== piece.id ||
    piece.currentAssetId !== null ||
    piece.jobIds.length === 0 ||
    piece.jobIds.length >= STUDIO_MAX_JOBS_PER_PIECE_V3 ||
    piece.jobIds.at(-1) !== sourceJob.id ||
    project.pieceOrder.includes(piece.id) === false ||
    project.pieceOrder.filter((pieceId) => pieceId === piece.id).length !== 1 ||
    Object.values(project.jobs).some((job) => job.retryOfJobId === sourceJob.id)
  ) {
    throw new CreativeStudioPilotServiceErrorV3('job_ineligible');
  }
  const retryReason = studioPieceRetryReasonForPredecessorV3(sourceJob);
  if (retryReason === null) throw new CreativeStudioPilotServiceErrorV3('job_ineligible');
  const lineage = piece.jobIds.map((jobId) => {
    const job = project.jobs[jobId];
    if (job === undefined || job.target.pieceId !== piece.id) {
      throw new CreativeStudioPilotServiceErrorV3('job_ineligible');
    }
    return { jobId: job.id, retryOfJobId: job.retryOfJobId, retryReason: job.retryReason };
  });
  return {
    words: sourceJob.composition.inputs.source.words,
    settings: { ...sourceJob.composition.inputs.source.settings },
    conditioningInputs: structuredClone(sourceJob.composition.inputs.conditioningInputs),
    retryReason,
    lineage,
  };
};

/** Creates the memory-only quote owner used by the isolated schema-6 entry point. */
export const createStudioPilotPreparePhotoServiceV3 = (
  deps: StudioPilotPreparePhotoDepsV3
): StudioPilotPreparePhotoServiceV3 => {
  const now = deps.now ?? Date.now;
  const mintIdentity = deps.mintIdentity ?? defaultMintIdentity;
  const resolveRouteAndRate = deps.resolveRouteAndRate ?? resolveStudioPieceRouteAndRateV3;

  return {
    async preparePhotoV3(input) {
      try {
        const intent = parseStudioPreparePhotoIntentV3(input);
        return await deps.store.withProjectAuthorityV3(intent.projectId, async (authority) => {
          const project = authority.project;
          if (project.authoringRevision !== intent.expectedAuthoringRevision) {
            throw new CreativeStudioPilotServiceErrorV3('stale_authoring');
          }
          const reservedCreateHandles = deps.preparedPhotos.reservedCreateHandles(
            project.id,
            project.authoringRevision
          );
          if (
            intent.mode === 'create' &&
            project.pieceOrder.length + reservedCreateHandles.length >= STUDIO_MAX_PIECES_V3
          ) {
            throw new CreativeStudioPilotServiceErrorV3('project_piece_capacity_reached');
          }

          const retry = intent.mode === 'retry' ? retryAuthority(project, intent) : null;
          const words = intent.mode === 'create' ? normalizeStudioPieceWordsV3(intent.words) : retry!.words;
          const settings: StudioPiecePhotoSettingsV3 =
            intent.mode === 'create' ? { ...intent.settings } : retry!.settings;
          const conditioningInputs =
            intent.mode === 'create'
              ? resolveConditioningInputs(project, intent.referencePieceIds)
              : retry!.conditioningInputs;
          const unavailableHandles = studioPieceHandleNamespaceV3(project, null, reservedCreateHandles);
          const proposedHandle =
            intent.mode === 'create'
              ? deriveStudioPieceHandleV3(intent.suggestedHandle ?? words, unavailableHandles)
              : null;

          const unavailableIds = allPersistentIds(project);
          const reservationId = mintUniqueIdentity('reservation', mintIdentity, unavailableIds);
          const targetPieceId =
            intent.mode === 'create' ? mintUniqueIdentity('piece', mintIdentity, unavailableIds) : intent.pieceId;
          const jobId = mintUniqueIdentity('job', mintIdentity, unavailableIds);
          const authorizationId = mintUniqueIdentity('authorization', mintIdentity, unavailableIds);
          const quoteId = mintUniqueIdentity('quote', mintIdentity, unavailableIds);
          const idempotencyKey = mintUniqueIdentity('idempotency', mintIdentity, unavailableIds);
          const orderIndex = project.pieceOrder.length;
          const authoringFingerprint =
            intent.mode === 'create'
              ? createStudioAuthoringFingerprintV3({
                  project,
                  prepared: {
                    mode: 'create',
                    reservedPieceId: targetPieceId,
                    proposedHandle: proposedHandle!,
                    orderIndex,
                    words,
                    settings,
                    conditioningInputs,
                  },
                })
              : createStudioAuthoringFingerprintV3({
                  project,
                  prepared: {
                    mode: 'retry',
                    existingPieceId: targetPieceId,
                    sourceJobId: intent.sourceJobId,
                    words,
                    settings,
                    conditioningInputs,
                  },
                });
          const routeAndRate = await resolveRouteAndRate(deps.providerResolver, settings, conditioningInputs.length);
          const composition = composeStudioPieceGenerationV3({
            projectRevisionAtPreparation: project.revision,
            authoringRevision: project.authoringRevision,
            authoringFingerprintVersion: STUDIO_AUTHORING_FINGERPRINT_VERSION_V3,
            authoringFingerprint,
            brief: project.brief,
            rules: project.rules,
            source: { kind: 'piece', pieceId: targetPieceId, words, settings },
            purpose: 'piece_image',
            conditioningInputs,
            route: routeAndRate.provider,
            instructionProfile: deriveStudioPieceInstructionProfileV3(routeAndRate.provider),
          });
          const requestPlan = createStudioPieceGenerationRequestPlanV3({ composition });
          const nowMs = readClock(now);
          const quote = createStudioPieceSubmissionQuoteV3({
            reservationId,
            quoteId,
            quoteRevision: 1,
            projectId: project.id,
            projectRevisionAtPreparation: project.revision,
            authoringRevision: project.authoringRevision,
            authoringFingerprintVersion: STUDIO_AUTHORING_FINGERPRINT_VERSION_V3,
            authoringFingerprint,
            rateCardDigest: routeAndRate.rateCardDigest,
            currency: routeAndRate.currency,
            target: { kind: 'piece', pieceId: targetPieceId },
            routeId: routeAndRate.routeId,
            requestPlan,
            rateUnit: 'generation',
            rateMinorUnits: routeAndRate.rateMinorUnits,
            expiresAt: new Date(nowMs + STUDIO_PREPARED_QUOTE_TTL_SECONDS * 1_000).toISOString(),
          });
          const { expiresAt: _quoteExpiry, ...unstampedQuote } = quote;
          const reservation =
            intent.mode === 'create'
              ? {
                  mode: 'create' as const,
                  reservationId,
                  projectId: project.id,
                  targetPieceId,
                  jobId,
                  authorizationId,
                  authorizationItemId: quote.item.id,
                  idempotencyKey,
                  words,
                  settings,
                  conditioningInputs,
                  provider: routeAndRate.provider,
                  cancellationPolicy: routeAndRate.cancellationPolicy,
                  quote: unstampedQuote,
                  authoringRevision: project.authoringRevision,
                  authoringFingerprintVersion: STUDIO_AUTHORING_FINGERPRINT_VERSION_V3,
                  authoringFingerprint,
                  projectRevisionAtPreparation: project.revision,
                  proposedHandle: proposedHandle!,
                  orderIndex,
                }
              : {
                  mode: 'retry' as const,
                  reservationId,
                  projectId: project.id,
                  targetPieceId,
                  jobId,
                  authorizationId,
                  authorizationItemId: quote.item.id,
                  idempotencyKey,
                  words,
                  settings,
                  conditioningInputs,
                  provider: routeAndRate.provider,
                  cancellationPolicy: routeAndRate.cancellationPolicy,
                  quote: unstampedQuote,
                  authoringRevision: project.authoringRevision,
                  authoringFingerprintVersion: STUDIO_AUTHORING_FINGERPRINT_VERSION_V3,
                  authoringFingerprint,
                  projectRevisionAtPreparation: project.revision,
                  sourceJobId: intent.sourceJobId,
                  lineage: retry!.lineage,
                  retryReason: retry!.retryReason,
                };

          await authority.assertCurrent();
          const admitted = deps.preparedPhotos.admit({ reservation, spendPolicy: project.spendPolicy });
          const projection = deps.preparedPhotos
            .list(project.id)
            .find((candidate) => candidate.reservationId === admitted.reservationId);
          if (projection === undefined) throw new CreativeStudioPilotServiceErrorV3('storage_error');
          return { status: 'prepared' as const, quote: projection };
        });
      } catch (error) {
        return normalizeCreativeStudioPilotErrorV3(error);
      }
    },
  };
};
