/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment node
 * Cross-contract Pilot 1 harness.
 */

import { describe, expect, it } from 'vitest';
import { STUDIO_RULE_LIMITS } from '@/common/types/project/creativeStudioRules';
import {
  STUDIO_AUTHORING_FINGERPRINT_VERSION_V3,
  STUDIO_EXPORT_SCHEMA_VERSION_V3,
  STUDIO_GENERATION_COMPOSITION_SCHEMA_VERSION_V3,
  STUDIO_MAX_ASSETS_V3,
  STUDIO_MAX_EXPORT_DIRECTORY_DEPTH,
  STUDIO_MAX_IMAGE_ASSET_BYTES_V3,
  STUDIO_MAX_JOBS_PER_PIECE_V3,
  STUDIO_MAX_JOBS_V3,
  STUDIO_MAX_PIECES_V3,
  STUDIO_MAX_PIECE_HANDLE_SCALARS_V3,
  STUDIO_MAX_PIECE_HANDLE_UTF8_BYTES_V3,
  STUDIO_MAX_PIECE_PRIOR_HANDLES_V3,
  STUDIO_MAX_PREPARED_QUOTE_CACHE_BYTES_GLOBAL,
  STUDIO_MAX_PREPARED_QUOTE_CACHE_BYTES_PER_PROJECT,
  STUDIO_MAX_PREPARED_QUOTE_SESSION_BYTES,
  STUDIO_MAX_PREPARED_QUOTE_SESSIONS_GLOBAL,
  STUDIO_MAX_PREPARED_QUOTE_SESSIONS_PER_PROJECT,
  STUDIO_MAX_SPEND_AUTHORIZATIONS_V3,
  STUDIO_MAX_UNDO_ENTRIES_V3,
  STUDIO_MUTATION_BATCH_SCHEMA_VERSION_V3,
  STUDIO_PREPARED_QUOTE_TTL_SECONDS,
  STUDIO_PROJECT_SCHEMA_VERSION_V3,
  type StudioPieceGeneratedAssetV3,
  type StudioPieceJobV3,
  type StudioProjectV3,
} from '@/common/types/project/creativeStudioTypes';
import { createEmptyStudioProjectV3 } from '@/process/services/creative-studio/service/schema2/factories';
import {
  composeStudioPieceGenerationV3,
  createStudioAuthoringFingerprintV3,
  createStudioPieceGenerationRequestPlanV3,
  deriveStudioPieceInstructionProfileV3,
  studioPieceGenerationCompositionDigestV3,
} from '@/process/services/creative-studio/service/schema2/generation';
import {
  createStudioPieceSpendAuthorizationV3,
  createStudioPieceSpendReceiptV3,
} from '@/process/services/creative-studio/service/schema2/pricing/authorization';
import { createStudioPieceSubmissionQuoteV3 } from '@/process/services/creative-studio/service/schema2/pricing/estimate';
import { validateStudioProjectV3 } from '@/process/services/creative-studio/service/schema2/validation';
import {
  STUDIO_DELETION_CLAIM_TTL_MS_V3,
  STUDIO_MAX_DELETION_CLAIMS_V3,
} from '@/process/services/creative-studio/service/schema2/mutations/deletionClaimsV3';

const projectCreatedAt = '2026-08-30T00:00:00.000Z';
const authorizedAt = '2026-08-30T00:00:01.000Z';
const jobCreatedAt = '2026-08-30T00:00:02.000Z';
const remoteStartedAt = '2026-08-30T00:00:03.000Z';
const completedAt = '2026-08-30T00:00:04.000Z';
const expiresAt = '2026-08-30T00:10:00.000Z';
const digest = 'a'.repeat(64);
const settings = { aspectRatio: '16:9' as const, resolution: '1080p' as const };
const provider = {
  providerId: 'provider_1',
  adapterId: 'weprompt-image-v1' as const,
  model: 'image-model-v1',
};

const makeSucceededProject = (): StudioProjectV3 => {
  const preparedProject = createEmptyStudioProjectV3(
    { name: 'Light on Water', brief: 'One quiet photograph.' },
    'project_1',
    projectCreatedAt
  );
  const prepared = {
    mode: 'create' as const,
    reservedPieceId: 'piece_1',
    proposedHandle: 'light_on_water',
    orderIndex: 0,
    words: 'Moonlight reflected on calm water.',
    settings,
  };
  const authoringFingerprint = createStudioAuthoringFingerprintV3({ project: preparedProject, prepared });
  const composition = composeStudioPieceGenerationV3({
    projectRevisionAtPreparation: preparedProject.revision,
    authoringRevision: preparedProject.authoringRevision,
    authoringFingerprintVersion: STUDIO_AUTHORING_FINGERPRINT_VERSION_V3,
    authoringFingerprint,
    brief: preparedProject.brief,
    rules: preparedProject.rules,
    source: { kind: 'piece', pieceId: prepared.reservedPieceId, words: prepared.words, settings },
    purpose: 'piece_image',
    conditioningInputs: [],
    route: provider,
    instructionProfile: deriveStudioPieceInstructionProfileV3(provider),
  });
  const requestPlan = createStudioPieceGenerationRequestPlanV3({ composition });
  const quote = createStudioPieceSubmissionQuoteV3({
    reservationId: 'reservation_1',
    quoteId: 'quote_1',
    quoteRevision: 1,
    projectId: preparedProject.id,
    projectRevisionAtPreparation: preparedProject.revision,
    authoringRevision: preparedProject.authoringRevision,
    authoringFingerprintVersion: STUDIO_AUTHORING_FINGERPRINT_VERSION_V3,
    authoringFingerprint,
    rateCardDigest: digest,
    currency: 'USD',
    target: { kind: 'piece', pieceId: prepared.reservedPieceId },
    routeId: 'route_1',
    requestPlan,
    rateUnit: 'generation',
    rateMinorUnits: 51,
    expiresAt,
  });
  const authorization = createStudioPieceSpendAuthorizationV3({
    reservationId: 'reservation_1',
    authorizationId: 'authorization_1',
    quote,
    confirmedAt: authorizedAt,
    projectRevisionAtAuthorization: 2,
    provider,
    cancellationPolicy: 'queued_and_running',
    idempotencyKey: 'idempotency_1',
  });
  const receipt = createStudioPieceSpendReceiptV3({
    reservationId: 'reservation_1',
    authorization,
    jobId: 'job_1',
    recordedAt: completedAt,
  });
  const job: StudioPieceJobV3 = {
    id: 'job_1',
    projectId: preparedProject.id,
    target: { kind: 'piece', pieceId: prepared.reservedPieceId },
    purpose: 'piece_image',
    status: 'succeeded',
    provider,
    idempotencyKey: authorization.idempotencyKey.key,
    providerSubmissionKind: 'remote',
    providerJobId: 'provider_job_1',
    remoteStartedAt,
    cancellationPolicy: 'queued_and_running',
    outputAssetId: 'asset_1',
    error: null,
    progress: 100,
    retryOfJobId: null,
    retryReason: null,
    duplicateChargeAcknowledged: false,
    duplicateChargeAcknowledgedAt: null,
    authorizationId: authorization.id,
    authorizationItemId: authorization.quote.item.id,
    composition: structuredClone(composition),
    requestPlan: structuredClone(requestPlan),
    spendReceipt: receipt,
    authoringRevision: preparedProject.authoringRevision,
    authoringFingerprintVersion: STUDIO_AUTHORING_FINGERPRINT_VERSION_V3,
    authoringFingerprint,
    projectRevisionAtPreparation: preparedProject.revision,
    projectRevisionAtAuthorization: authorization.projectRevisionAtAuthorization,
    createdAt: jobCreatedAt,
    updatedAt: completedAt,
  };
  const asset: StudioPieceGeneratedAssetV3 = {
    id: 'asset_1',
    projectId: preparedProject.id,
    pieceId: prepared.reservedPieceId,
    mediaKind: 'image',
    mimeType: 'image/png',
    byteSize: 1024,
    sha256: 'b'.repeat(64),
    width: 1920,
    height: 1080,
    createdAt: completedAt,
    origin: 'generated',
    managedAsset: { collection: 'assets', fileName: 'asset_1.png' },
    producerJobId: job.id,
    compositionDigest: studioPieceGenerationCompositionDigestV3(job.composition),
  };

  return {
    ...preparedProject,
    revision: 5,
    authoringRevision: 2,
    pieceOrder: [prepared.reservedPieceId],
    pieces: {
      [prepared.reservedPieceId]: {
        id: prepared.reservedPieceId,
        kind: 'photograph',
        handle: prepared.proposedHandle,
        priorHandles: [],
        currentAssetId: asset.id,
        jobIds: [job.id],
        createdAt: jobCreatedAt,
        updatedAt: completedAt,
      },
    },
    spendAuthorizations: [authorization],
    assets: { [asset.id]: asset },
    jobs: { [job.id]: job },
    updatedAt: completedAt,
  };
};

describe('CS4 Phase 1 Piece contract harness', () => {
  it('freezes the independently versioned Pilot contracts and every exported numeric bound', () => {
    expect({
      projectSchema: STUDIO_PROJECT_SCHEMA_VERSION_V3,
      mutationBatchSchema: STUDIO_MUTATION_BATCH_SCHEMA_VERSION_V3,
      compositionSchema: STUDIO_GENERATION_COMPOSITION_SCHEMA_VERSION_V3,
      exportSchema: STUDIO_EXPORT_SCHEMA_VERSION_V3,
      authoringFingerprint: STUDIO_AUTHORING_FINGERPRINT_VERSION_V3,
    }).toEqual({
      projectSchema: 6,
      mutationBatchSchema: 6,
      compositionSchema: 2,
      exportSchema: 3,
      authoringFingerprint: 1,
    });
    expect({
      pieces: STUDIO_MAX_PIECES_V3,
      assets: STUDIO_MAX_ASSETS_V3,
      handleScalars: STUDIO_MAX_PIECE_HANDLE_SCALARS_V3,
      handleUtf8Bytes: STUDIO_MAX_PIECE_HANDLE_UTF8_BYTES_V3,
      priorHandles: STUDIO_MAX_PIECE_PRIOR_HANDLES_V3,
      jobsPerPiece: STUDIO_MAX_JOBS_PER_PIECE_V3,
      jobs: STUDIO_MAX_JOBS_V3,
      spendAuthorizations: STUDIO_MAX_SPEND_AUTHORIZATIONS_V3,
      undoEntries: STUDIO_MAX_UNDO_ENTRIES_V3,
      imageAssetBytes: STUDIO_MAX_IMAGE_ASSET_BYTES_V3,
    }).toEqual({
      pieces: 96,
      assets: 96,
      handleScalars: 48,
      handleUtf8Bytes: 192,
      priorHandles: 20,
      jobsPerPiece: 32,
      jobs: 3_072,
      spendAuthorizations: 3_072,
      undoEntries: 20,
      imageAssetBytes: 52_428_800,
    });
    expect({
      preparedTtlSeconds: STUDIO_PREPARED_QUOTE_TTL_SECONDS,
      preparedSessionsPerProject: STUDIO_MAX_PREPARED_QUOTE_SESSIONS_PER_PROJECT,
      preparedSessionsGlobal: STUDIO_MAX_PREPARED_QUOTE_SESSIONS_GLOBAL,
      preparedSessionBytes: STUDIO_MAX_PREPARED_QUOTE_SESSION_BYTES,
      preparedBytesPerProject: STUDIO_MAX_PREPARED_QUOTE_CACHE_BYTES_PER_PROJECT,
      preparedBytesGlobal: STUDIO_MAX_PREPARED_QUOTE_CACHE_BYTES_GLOBAL,
      deletionClaimTtlMs: STUDIO_DELETION_CLAIM_TTL_MS_V3,
      deletionClaims: STUDIO_MAX_DELETION_CLAIMS_V3,
      exportDirectoryDepth: STUDIO_MAX_EXPORT_DIRECTORY_DEPTH,
      rules: STUDIO_RULE_LIMITS,
    }).toEqual({
      preparedTtlSeconds: 300,
      preparedSessionsPerProject: 4,
      preparedSessionsGlobal: 16,
      preparedSessionBytes: 8_388_608,
      preparedBytesPerProject: 16_777_216,
      preparedBytesGlobal: 67_108_864,
      deletionClaimTtlMs: 300_000,
      deletionClaims: 64,
      exportDirectoryDepth: 4,
      rules: { maxRules: 24, text: 240, maxTerms: 8, term: 64 },
    });
  });

  it('wires the real factory, fingerprint, composition, request, quote, authorization, receipt, and validator', () => {
    expect(validateStudioProjectV3(makeSucceededProject())).toBe(true);
  });

  it('retains truthful spend receipts for running and paid failed provider outcomes', () => {
    for (const state of [
      { status: 'running' as const, error: null, progress: 50 },
      {
        status: 'failed' as const,
        error: { code: 'no_output' as const, messageKey: 'creativeStudio.jobs.noOutput' },
        progress: 100,
      },
      {
        status: 'failed' as const,
        error: { code: 'variation_grid' as const, messageKey: 'creativeStudio.jobs.variationGrid' },
        progress: 100,
      },
      {
        status: 'failed' as const,
        error: { code: 'download_failed' as const, messageKey: 'creativeStudio.jobs.downloadFailed' },
        progress: 100,
      },
    ]) {
      const project = makeSucceededProject();
      project.pieces.piece_1!.currentAssetId = null;
      project.assets = {};
      Object.assign(project.jobs.job_1!, {
        status: state.status,
        outputAssetId: null,
        error: state.error,
        progress: state.progress,
      });
      expect(validateStudioProjectV3(project), state.error?.code ?? state.status).toBe(true);
      project.jobs.job_1!.spendReceipt!.jobId = 'job_unrelated';
      expect(validateStudioProjectV3(project), `tampered ${state.error?.code ?? state.status}`).toBe(false);
    }
  });

  it('fails closed when any persisted cross-contract link is corrupted', () => {
    const corruptions: Array<(project: StudioProjectV3) => void> = [
      (project) => {
        project.jobs.job_1!.target.pieceId = 'piece_other';
      },
      (project) => {
        project.jobs.job_1!.composition.inputs.source.pieceId = 'piece_other';
      },
      (project) => {
        project.jobs.job_1!.purpose = 'seed_still' as never;
      },
      (project) => {
        project.jobs.job_1!.composition.prompt += ' changed';
      },
      (project) => {
        project.jobs.job_1!.requestPlan.snapshot.settings.aspectRatio = '9:16';
      },
      (project) => {
        project.spendAuthorizations[0]!.quote.item.routeId = 'route_other';
      },
      (project) => {
        project.spendAuthorizations[0]!.providerBinding.itemId = 'item_other';
      },
      (project) => {
        project.jobs.job_1!.idempotencyKey = 'idempotency_other';
      },
      (project) => {
        project.jobs.job_1!.spendReceipt!.totalMinorUnits += 1;
      },
      (project) => {
        (project.assets.asset_1 as StudioPieceGeneratedAssetV3).compositionDigest = digest;
      },
      (project) => {
        project.pieces.piece_1!.jobIds = [];
      },
      (project) => {
        project.jobs.job_1!.retryOfJobId = 'job_0';
      },
    ];

    for (const corrupt of corruptions) {
      const project = makeSucceededProject();
      corrupt(project);
      expect(validateStudioProjectV3(project)).toBe(false);
    }
  });
});
