/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { isDeepStrictEqual } from 'node:util';
import {
  STUDIO_AUTHORING_FINGERPRINT_VERSION_V3,
  STUDIO_MAX_JOBS_PER_PIECE_V3,
  STUDIO_MAX_PIECES_V3,
  type StudioConfirmPreparedPhotoRequestV3,
  type StudioPiecePhotoSettingsV3,
  type StudioConfirmPreparedPhotoResultV3,
  type StudioPieceJobV3,
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
} from '../schema2/generation';
import { studioPieceHandleNamespaceV3 } from '../schema2/mutations/pieceHandles';
import type { StudioPreparedPhotoCacheV3 } from '../schema2/pricing';
import {
  createStudioPieceSpendAuthorizationV3,
  createStudioPieceSubmissionQuoteV3,
  evaluateStudioPieceSpendPolicyV3,
  revalidateStudioPieceSubmissionQuoteV3,
  validateStudioConfirmPreparedPhotoRequestV3,
} from '../schema2/pricing';
import { studioPieceRetryReasonForPredecessorV3 } from '../schema2/validation';
import { parseStudioConfirmPreparedPhotoRequestV3 } from './contracts';
import { CreativeStudioPilotServiceErrorV3, normalizeCreativeStudioPilotErrorV3 } from './errors';
import { resolveStudioPieceRouteAndRateV3, type StudioPieceRouteAndRateV3 } from './pricing';

export type StudioPilotConfirmPhotoDepsV3 = {
  store: CreativeStudioPilotStoreV3;
  preparedPhotos: StudioPreparedPhotoCacheV3;
  providerResolver: Pick<StudioProviderResolver, 'listGenerationRoutes'>;
  resolveRouteAndRate?: (
    resolver: Pick<StudioProviderResolver, 'listGenerationRoutes'>,
    settings: StudioPiecePhotoSettingsV3,
    conditioningInputCount: number
  ) => Promise<StudioPieceRouteAndRateV3>;
  dispatchCommittedJob: (projectId: string, jobId: string) => Promise<void>;
  onDispatchError?: (projectId: string, jobId: string) => void;
  now?: () => number;
};

export type StudioPilotConfirmPhotoServiceV3 = {
  confirmPreparedPhotoV3(input: unknown): Promise<StudioConfirmPreparedPhotoResultV3>;
};

type StudioPilotPhotoCommitAttemptV3 = {
  projectBefore: StudioProjectV3;
  expectedCandidate: StudioProjectV3;
  reservation: StudioPreparedPhotoReservationV3;
};

type StudioPilotPhotoCommitReconciliationV3 =
  | { status: 'committed'; result: StudioConfirmPreparedPhotoResultV3 }
  | { status: 'absent' }
  | { status: 'divergent' };

const readClock = (now: () => number): number => {
  const value = now();
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new CreativeStudioPilotServiceErrorV3('storage_error');
  }
  return value;
};

const retryLineageIsCurrent = (
  project: StudioProjectV3,
  reservation: Extract<StudioPreparedPhotoReservationV3, { mode: 'retry' }>
): boolean => {
  const piece = project.pieces[reservation.targetPieceId];
  const source = project.jobs[reservation.sourceJobId];
  if (
    piece === undefined ||
    source === undefined ||
    piece.currentAssetId !== null ||
    piece.jobIds.length === 0 ||
    piece.jobIds.length >= STUDIO_MAX_JOBS_PER_PIECE_V3 ||
    piece.jobIds.at(-1) !== source.id ||
    source.target.pieceId !== piece.id ||
    studioPieceRetryReasonForPredecessorV3(source) !== reservation.retryReason ||
    Object.values(project.jobs).some((job) => job.retryOfJobId === source.id) ||
    piece.jobIds.length !== reservation.lineage.length
  ) {
    return false;
  }
  return piece.jobIds.every((jobId, index) => {
    const job = project.jobs[jobId];
    const frozen = reservation.lineage[index];
    return (
      job !== undefined &&
      frozen !== undefined &&
      job.id === frozen.jobId &&
      job.retryOfJobId === frozen.retryOfJobId &&
      job.retryReason === frozen.retryReason
    );
  });
};

const reservationIdsRemainAvailable = (
  project: StudioProjectV3,
  reservation: StudioPreparedPhotoReservationV3
): boolean => {
  const unavailable = new Set<string>([
    project.id,
    ...project.pieceOrder,
    ...Object.keys(project.assets),
    ...Object.keys(project.jobs),
  ]);
  for (const authorization of project.spendAuthorizations) {
    unavailable.add(authorization.id);
    unavailable.add(authorization.quote.id);
    unavailable.add(authorization.quote.reservationId);
    unavailable.add(authorization.quote.item.id);
    unavailable.add(authorization.idempotencyKey.key);
  }
  const candidates = [
    reservation.reservationId,
    reservation.jobId,
    reservation.authorizationId,
    reservation.authorizationItemId,
    reservation.idempotencyKey,
    reservation.quote.id,
    ...(reservation.mode === 'create' ? [reservation.targetPieceId] : []),
  ];
  return new Set(candidates).size === candidates.length && candidates.every((candidate) => !unavailable.has(candidate));
};

const conditioningInputsRemainCurrent = (
  project: StudioProjectV3,
  reservation: StudioPreparedPhotoReservationV3
): boolean =>
  reservation.conditioningInputs.every((input) => {
    const piece = Object.hasOwn(project.pieces, input.pieceId) ? project.pieces[input.pieceId] : undefined;
    const asset = Object.hasOwn(project.assets, input.assetId) ? project.assets[input.assetId] : undefined;
    return (
      piece !== undefined &&
      asset !== undefined &&
      piece.currentAssetId === input.assetId &&
      asset.projectId === project.id &&
      asset.pieceId === input.pieceId &&
      asset.sha256 === input.sha256 &&
      asset.mimeType === input.mimeType &&
      asset.byteSize === input.byteSize
    );
  });

const assertReservationAuthoringAuthority = (
  project: StudioProjectV3,
  reservation: StudioPreparedPhotoReservationV3
): void => {
  // Capacity is the stable losing-race outcome when another create/import fills the 96th slot.
  // Report it before the consequent authoring-revision movement so callers never misdiagnose a
  // full Project as an editable stale quote and attempt a 97th Piece.
  if (reservation.mode === 'create' && project.pieceOrder.length >= STUDIO_MAX_PIECES_V3) {
    throw new CreativeStudioPilotServiceErrorV3('project_piece_capacity_reached');
  }
  if (project.authoringRevision !== reservation.authoringRevision) {
    throw new CreativeStudioPilotServiceErrorV3('stale_quote');
  }
  if (!reservationIdsRemainAvailable(project, reservation)) {
    throw new CreativeStudioPilotServiceErrorV3('stale_quote');
  }
  if (!conditioningInputsRemainCurrent(project, reservation)) {
    throw new CreativeStudioPilotServiceErrorV3('stale_quote');
  }
  if (reservation.mode === 'create') {
    if (
      project.pieceOrder.length !== reservation.orderIndex ||
      studioPieceHandleNamespaceV3(project).has(reservation.proposedHandle)
    ) {
      throw new CreativeStudioPilotServiceErrorV3('stale_quote');
    }
    return;
  }
  if (!retryLineageIsCurrent(project, reservation)) {
    throw new CreativeStudioPilotServiceErrorV3('job_ineligible');
  }
};

const createAuthoringFingerprint = (project: StudioProjectV3, reservation: StudioPreparedPhotoReservationV3): string =>
  reservation.mode === 'create'
    ? createStudioAuthoringFingerprintV3({
        project,
        prepared: {
          mode: 'create',
          reservedPieceId: reservation.targetPieceId,
          proposedHandle: reservation.proposedHandle,
          orderIndex: reservation.orderIndex,
          words: reservation.words,
          settings: reservation.settings,
          conditioningInputs: reservation.conditioningInputs,
        },
      })
    : createStudioAuthoringFingerprintV3({
        project,
        prepared: {
          mode: 'retry',
          existingPieceId: reservation.targetPieceId,
          sourceJobId: reservation.sourceJobId,
          words: reservation.words,
          settings: reservation.settings,
          conditioningInputs: reservation.conditioningInputs,
        },
      });

const rederiveQuote = (
  project: StudioProjectV3,
  reservation: StudioPreparedPhotoReservationV3,
  routeAndRate: StudioPieceRouteAndRateV3
) => {
  const authoringFingerprint = createAuthoringFingerprint(project, reservation);
  const composition = composeStudioPieceGenerationV3({
    projectRevisionAtPreparation: reservation.projectRevisionAtPreparation,
    authoringRevision: project.authoringRevision,
    authoringFingerprintVersion: STUDIO_AUTHORING_FINGERPRINT_VERSION_V3,
    authoringFingerprint,
    brief: project.brief,
    rules: project.rules,
    source: {
      kind: 'piece',
      pieceId: reservation.targetPieceId,
      words: reservation.words,
      settings: reservation.settings,
    },
    purpose: 'piece_image',
    conditioningInputs: reservation.conditioningInputs,
    route: routeAndRate.provider,
    instructionProfile: deriveStudioPieceInstructionProfileV3(routeAndRate.provider),
  });
  return createStudioPieceSubmissionQuoteV3({
    reservationId: reservation.reservationId,
    quoteId: reservation.quote.id,
    quoteRevision: reservation.quote.quoteRevision,
    projectId: project.id,
    projectRevisionAtPreparation: reservation.projectRevisionAtPreparation,
    authoringRevision: project.authoringRevision,
    authoringFingerprintVersion: STUDIO_AUTHORING_FINGERPRINT_VERSION_V3,
    authoringFingerprint,
    rateCardDigest: routeAndRate.rateCardDigest,
    currency: routeAndRate.currency,
    target: { kind: 'piece', pieceId: reservation.targetPieceId },
    routeId: routeAndRate.routeId,
    requestPlan: createStudioPieceGenerationRequestPlanV3({ composition }),
    rateUnit: 'generation',
    rateMinorUnits: routeAndRate.rateMinorUnits,
    expiresAt: reservation.expiresAt,
  });
};

const assertConfirmationDecision = (
  request: StudioConfirmPreparedPhotoRequestV3,
  reservation: StudioPreparedPhotoReservationV3,
  project: StudioProjectV3,
  nowMs: number
): void => {
  if (nowMs >= Date.parse(reservation.expiresAt)) {
    throw new CreativeStudioPilotServiceErrorV3('quote_expired');
  }
  const policy = evaluateStudioPieceSpendPolicyV3(
    {
      currency: reservation.quote.currency,
      lowerMinorUnits: reservation.quote.lowerMinorUnits,
      upperMinorUnits: reservation.quote.upperMinorUnits,
    },
    project.spendPolicy
  );
  const duplicateChargeRequired = reservation.mode === 'retry' && reservation.retryReason === 'submission_unknown';
  if (request.duplicateChargeAcknowledged !== duplicateChargeRequired) {
    throw new CreativeStudioPilotServiceErrorV3('duplicate_charge_acknowledgement_required');
  }
  if (request.explicitHumanConfirmation !== (policy.requiresExplicitHumanAction || duplicateChargeRequired)) {
    throw new CreativeStudioPilotServiceErrorV3('confirmation_required');
  }
  if (!validateStudioConfirmPreparedPhotoRequestV3(request, reservation, project.spendPolicy, nowMs)) {
    throw new CreativeStudioPilotServiceErrorV3('stale_quote');
  }
};

/** The sole create/retry durable commit builder; confirmation mode never selects a second path. */
export const buildStudioPilotAuthorizedPhotoCommitV3 = (input: {
  project: StudioProjectV3;
  reservation: StudioPreparedPhotoReservationV3;
  confirmation: StudioConfirmPreparedPhotoRequestV3;
  confirmedAt: string;
}): StudioProjectV3 => {
  const { project, reservation, confirmation, confirmedAt } = input;
  const nextRevision = project.revision + 1;
  const authorization = createStudioPieceSpendAuthorizationV3({
    reservationId: reservation.reservationId,
    authorizationId: reservation.authorizationId,
    quote: reservation.quote,
    confirmedAt,
    projectRevisionAtAuthorization: nextRevision,
    provider: reservation.provider,
    cancellationPolicy: reservation.cancellationPolicy,
    idempotencyKey: reservation.idempotencyKey,
  });
  const retryOfJobId = reservation.mode === 'retry' ? reservation.sourceJobId : null;
  const retryReason = reservation.mode === 'retry' ? reservation.retryReason : null;
  const duplicateChargeAcknowledged = retryReason === 'submission_unknown';
  const job: StudioPieceJobV3 = {
    id: reservation.jobId,
    projectId: project.id,
    target: { kind: 'piece', pieceId: reservation.targetPieceId },
    purpose: 'piece_image',
    status: 'queued_local',
    provider: { ...reservation.provider },
    idempotencyKey: reservation.idempotencyKey,
    providerSubmissionKind: null,
    providerJobId: null,
    remoteStartedAt: null,
    cancellationPolicy: reservation.cancellationPolicy,
    outputAssetId: null,
    error: null,
    progress: null,
    retryOfJobId,
    retryReason,
    duplicateChargeAcknowledged,
    duplicateChargeAcknowledgedAt: duplicateChargeAcknowledged ? confirmedAt : null,
    authorizationId: authorization.id,
    authorizationItemId: authorization.quote.item.id,
    composition: structuredClone(authorization.quote.item.requestPlan.snapshot.composition),
    requestPlan: structuredClone(authorization.quote.item.requestPlan),
    spendReceipt: null,
    authoringRevision: reservation.authoringRevision,
    authoringFingerprintVersion: reservation.authoringFingerprintVersion,
    authoringFingerprint: reservation.authoringFingerprint,
    projectRevisionAtPreparation: reservation.projectRevisionAtPreparation,
    projectRevisionAtAuthorization: nextRevision,
    createdAt: confirmedAt,
    updatedAt: confirmedAt,
  };
  const draft = structuredClone(project);
  draft.spendAuthorizations.push(authorization);
  draft.jobs[job.id] = job;
  if (reservation.mode === 'create') {
    draft.pieceOrder.push(reservation.targetPieceId);
    draft.pieces[reservation.targetPieceId] = {
      id: reservation.targetPieceId,
      kind: 'photograph',
      handle: reservation.proposedHandle,
      priorHandles: [],
      currentAssetId: null,
      jobIds: [job.id],
      createdAt: confirmedAt,
      updatedAt: confirmedAt,
    };
  } else {
    const piece = draft.pieces[reservation.targetPieceId];
    if (piece === undefined) throw new CreativeStudioPilotServiceErrorV3('job_ineligible');
    piece.jobIds.push(job.id);
    piece.updatedAt = confirmedAt;
  }
  void confirmation;
  return draft;
};

/**
 * Resolves the only ambiguous confirmation window: the update journal is durable but the
 * store call rejected before reporting its committed project. The replayed project must be
 * exactly either the pre-commit snapshot or the reservation-owned commit. Any third state
 * consumes the reservation so a colliding authorization can never be submitted again.
 */
const reconcileStudioPilotPhotoCommitV3 = async (
  store: CreativeStudioPilotStoreV3,
  attempt: StudioPilotPhotoCommitAttemptV3
): Promise<StudioPilotPhotoCommitReconciliationV3> => {
  let observed: StudioProjectV3;
  try {
    observed = await store.loadProjectV3(attempt.reservation.projectId);
  } catch {
    return { status: 'divergent' };
  }
  if (isDeepStrictEqual(observed, attempt.projectBefore)) return { status: 'absent' };

  const expected: StudioProjectV3 = {
    ...attempt.expectedCandidate,
    revision: attempt.projectBefore.revision + 1,
    authoringRevision: attempt.projectBefore.authoringRevision + (attempt.reservation.mode === 'create' ? 1 : 0),
    updatedAt: observed.updatedAt,
  };
  if (!isDeepStrictEqual(observed, expected)) return { status: 'divergent' };

  const expectedAuthorization = expected.spendAuthorizations.at(-1);
  const expectedJob = expected.jobs[attempt.reservation.jobId];
  const expectedPiece = expected.pieces[attempt.reservation.targetPieceId];
  if (
    expectedAuthorization?.id !== attempt.reservation.authorizationId ||
    expectedAuthorization.quote.id !== attempt.reservation.quote.id ||
    expectedAuthorization.quote.item.id !== attempt.reservation.authorizationItemId ||
    expectedAuthorization.idempotencyKey.key !== attempt.reservation.idempotencyKey ||
    expectedJob?.authorizationId !== attempt.reservation.authorizationId ||
    expectedJob.authorizationItemId !== attempt.reservation.authorizationItemId ||
    expectedJob.idempotencyKey !== attempt.reservation.idempotencyKey ||
    expectedPiece === undefined ||
    expectedPiece.jobIds.at(-1) !== attempt.reservation.jobId
  ) {
    return { status: 'divergent' };
  }

  return {
    status: 'committed',
    result: {
      status: 'queued',
      projectId: observed.id,
      pieceId: attempt.reservation.targetPieceId,
      jobId: attempt.reservation.jobId,
      revision: observed.revision,
      authoringRevision: observed.authoringRevision,
    },
  };
};

const dispatchStudioPilotCommittedPhotoV3 = async (
  deps: StudioPilotConfirmPhotoDepsV3,
  result: StudioConfirmPreparedPhotoResultV3
): Promise<void> => {
  try {
    await deps.dispatchCommittedJob(result.projectId, result.jobId);
  } catch {
    try {
      deps.onDispatchError?.(result.projectId, result.jobId);
    } catch {
      // Diagnostics cannot change the durable queued result.
    }
  }
};

/** Claims, rederives, commits, then dispatches exactly one durable Piece job. */
export const createStudioPilotConfirmPhotoServiceV3 = (
  deps: StudioPilotConfirmPhotoDepsV3
): StudioPilotConfirmPhotoServiceV3 => {
  const now = deps.now ?? Date.now;
  const resolveRouteAndRate = deps.resolveRouteAndRate ?? resolveStudioPieceRouteAndRateV3;
  return {
    async confirmPreparedPhotoV3(input) {
      let claim: ReturnType<StudioPreparedPhotoCacheV3['claim']> | null = null;
      let committed = false;
      let commitAttempt: StudioPilotPhotoCommitAttemptV3 | null = null;
      try {
        const request = parseStudioConfirmPreparedPhotoRequestV3(input);
        claim = deps.preparedPhotos.claim({
          reservationId: request.reservationId,
          quoteId: request.quoteId,
          quoteRevision: request.quoteRevision,
        });
        const reservation = claim.reservation;
        const result = await deps.store.withProjectAuthorityV3(reservation.projectId, async (authority) => {
          const project = authority.project;
          assertReservationAuthoringAuthority(project, reservation);
          const nowMs = readClock(now);
          if (nowMs < Date.parse(project.updatedAt)) {
            throw new CreativeStudioPilotServiceErrorV3('storage_error');
          }
          assertConfirmationDecision(request, reservation, project, nowMs);
          const routeAndRate = await resolveRouteAndRate(
            deps.providerResolver,
            reservation.settings,
            reservation.conditioningInputs.length
          );
          const rederived = rederiveQuote(project, reservation, routeAndRate);
          const revalidation = revalidateStudioPieceSubmissionQuoteV3({
            reservationId: reservation.reservationId,
            recorded: reservation.quote,
            rederived,
            policy: project.spendPolicy,
          });
          if (
            !revalidation.ok ||
            routeAndRate.cancellationPolicy !== reservation.cancellationPolicy ||
            routeAndRate.provider.providerId !== reservation.provider.providerId ||
            routeAndRate.provider.adapterId !== reservation.provider.adapterId ||
            routeAndRate.provider.model !== reservation.provider.model
          ) {
            throw new CreativeStudioPilotServiceErrorV3('stale_quote');
          }
          await authority.assertCurrent();
          const confirmedAt = new Date(nowMs).toISOString();
          commitAttempt = {
            projectBefore: project,
            expectedCandidate: buildStudioPilotAuthorizedPhotoCommitV3({
              project,
              reservation,
              confirmation: request,
              confirmedAt,
            }),
            reservation,
          };
          const committedProject = await authority.commit(
            (current) =>
              buildStudioPilotAuthorizedPhotoCommitV3({
                project: current,
                reservation,
                confirmation: request,
                confirmedAt,
              }),
            {
              kind: reservation.mode === 'create' ? 'authoring' : 'runtime',
              expectedRevision: project.revision,
              authorizeBeforeReplace: async () => {
                const finalNow = readClock(now);
                assertConfirmationDecision(request, reservation, project, finalNow);
                const finalRouteAndRate = await resolveRouteAndRate(
                  deps.providerResolver,
                  reservation.settings,
                  reservation.conditioningInputs.length
                );
                const finalQuote = rederiveQuote(project, reservation, finalRouteAndRate);
                const finalValidation = revalidateStudioPieceSubmissionQuoteV3({
                  reservationId: reservation.reservationId,
                  recorded: reservation.quote,
                  rederived: finalQuote,
                  policy: project.spendPolicy,
                });
                if (!finalValidation.ok || finalRouteAndRate.cancellationPolicy !== reservation.cancellationPolicy) {
                  throw new CreativeStudioPilotServiceErrorV3('stale_quote');
                }
              },
            }
          );
          return {
            status: 'queued' as const,
            projectId: committedProject.id,
            pieceId: reservation.targetPieceId,
            jobId: reservation.jobId,
            revision: committedProject.revision,
            authoringRevision: committedProject.authoringRevision,
          };
        });
        deps.preparedPhotos.consume(claim);
        if (claim.reservation.mode === 'create') {
          // Creating a Piece advances authoring authority. Every other prepared intent for the
          // project was derived from the former authored canvas and must disappear immediately.
          deps.preparedPhotos.invalidateProject(result.projectId, result.authoringRevision);
        }
        committed = true;
        await dispatchStudioPilotCommittedPhotoV3(deps, result);
        return result;
      } catch (error) {
        if (claim !== null && !committed && commitAttempt !== null) {
          const reconciliation = await reconcileStudioPilotPhotoCommitV3(deps.store, commitAttempt);
          if (reconciliation.status === 'committed') {
            deps.preparedPhotos.consume(claim);
            if (claim.reservation.mode === 'create') {
              deps.preparedPhotos.invalidateProject(
                reconciliation.result.projectId,
                reconciliation.result.authoringRevision
              );
            }
            committed = true;
            await dispatchStudioPilotCommittedPhotoV3(deps, reconciliation.result);
            return reconciliation.result;
          }
          if (reconciliation.status === 'divergent') {
            deps.preparedPhotos.consume(claim);
            committed = true;
          }
        }
        if (claim !== null && !committed) deps.preparedPhotos.release(claim);
        return normalizeCreativeStudioPilotErrorV3(error);
      }
    },
  };
};
