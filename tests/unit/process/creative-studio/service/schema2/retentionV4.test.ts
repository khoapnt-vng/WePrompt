/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest';
import {
  STUDIO_MAX_IMAGE_ASSET_BYTES_V4,
  STUDIO_MAX_VIDEO_ASSET_BYTES_V4,
  type StudioAssetV4,
  type StudioPieceAssetTombstoneV4,
  type StudioPieceCurrentAssetSnapshotV4,
  type StudioPieceGenerationCompositionV4,
  type StudioPieceGenerationRequestPlanV4,
  type StudioPieceJobV4,
  type StudioPieceSpendAuthorizationV4,
  type StudioPieceSubmissionQuoteV4,
  type StudioProjectV4,
} from '@/common/types/project/creativeStudioTypes';
import {
  createStudioAuthoringFingerprintV4,
  createStudioPieceQuotedGenerationIdV4,
} from '@/process/services/creative-studio/service/schema2/generation/submission/v4';
import { studioPersistentIdentitiesV4 } from '@/process/services/creative-studio/service/schema2/mutations/projectAuthorityV4';
import {
  studioPieceGenerationCompositionDigestV4,
  validateStudioProjectV4,
} from '@/process/services/creative-studio/service/schema2/validation';
import {
  makePhase6Project,
  PHASE_6_AUTHORED_AT,
  PHASE_6_CREATED_AT,
  PHASE_6_CURRENT_AT,
} from '../../../../../fixtures/creative-studio/phase6Project';

const EXPIRES_AT = '2026-09-02T00:40:00.000Z';
const REPLACEMENT_AUTHORIZED_AT = '2026-09-02T00:00:03.000Z';
const REPLACEMENT_COMPLETED_AT = '2026-09-02T00:00:04.000Z';
const REPLACEMENT_EXPIRES_AT = '2026-09-02T00:40:03.000Z';
const RETRY_AUTHORIZED_AT = '2026-09-02T00:00:05.000Z';
const RETRY_COMPLETED_AT = '2026-09-02T00:00:06.000Z';
const RETRY_EXPIRES_AT = '2026-09-02T00:40:05.000Z';
const DIGEST = 'd'.repeat(64);
const PROVIDER = {
  providerId: 'provider_1',
  adapterId: 'weprompt-image-v1' as const,
  model: 'image-model',
};
const MOTION_PROVIDER = {
  providerId: 'provider_1',
  adapterId: 'openrouter-video-v1' as const,
  model: 'motion-model',
};
const CHAIN_AUTHORIZED_AT = '2026-09-02T00:00:03.000Z';
const CHAIN_MATERIALIZED_AT = '2026-09-02T00:00:04.000Z';
const CHAIN_COMPLETED_AT = '2026-09-02T00:00:05.000Z';
const CHAIN_EDITED_AT = '2026-09-02T00:00:06.000Z';

const tombstoneFor = (asset: StudioAssetV4): StudioPieceAssetTombstoneV4 => ({
  id: asset.id,
  mediaKind: asset.mediaKind,
  role: asset.role,
  mimeType: asset.mimeType,
  byteSize: asset.byteSize,
  sha256: asset.sha256,
  width: asset.width,
  height: asset.height,
  ...(asset.mediaKind === 'video' ? { durationSeconds: asset.durationSeconds } : {}),
  createdAt: asset.createdAt,
  origin: asset.origin,
  producerJobId: asset.producerJobId,
  compositionDigest: asset.compositionDigest,
});

const currentSnapshotFor = (asset: StudioAssetV4): StudioPieceCurrentAssetSnapshotV4 => ({
  pieceId: asset.pieceId,
  assetId: asset.id,
  mediaKind: asset.mediaKind,
  role: 'primary',
  mimeType: asset.mimeType,
  byteSize: asset.byteSize,
  sha256: asset.sha256,
  width: asset.width,
  height: asset.height,
  ...(asset.mediaKind === 'video' ? { durationSeconds: asset.durationSeconds } : {}),
  createdAt: asset.createdAt,
  origin: asset.origin,
  producerJobId: asset.producerJobId,
  compositionDigest: asset.compositionDigest,
});

const addHistoricalImportedAsset = (
  project: StudioProjectV4,
  state: 'retained' | 'evicted'
): StudioPieceAssetTombstoneV4 => {
  const piece = project.pieces.piece_photo_1!;
  const asset: StudioAssetV4 = {
    id: 'asset_imported_before_generation',
    projectId: project.id,
    pieceId: piece.id,
    mediaKind: 'image',
    role: 'primary',
    mimeType: 'image/png',
    managedAsset: { collection: 'imports', fileName: 'asset_imported_before_generation.png' },
    byteSize: 7,
    sha256: '9'.repeat(64),
    width: 1_376,
    height: 768,
    createdAt: PHASE_6_AUTHORED_AT,
    origin: 'imported',
    producerJobId: null,
    compositionDigest: null,
  };
  const tombstone = tombstoneFor(asset);
  const publication = {
    schemaVersion: 1 as const,
    kind: 'replace_current' as const,
    currentAsset: currentSnapshotFor(asset),
  };
  const producingJob = project.jobs.job_photo_1!;
  producingJob.publication = publication;
  project.spendAuthorizations[0]!.quote.item.publication = structuredClone(publication);
  piece.assetHistory =
    state === 'retained'
      ? [{ state: 'retained', assetIdsByRole: { primary: asset.id, poster: null }, supersededAt: PHASE_6_CURRENT_AT }]
      : [
          {
            state: 'evicted',
            assetsByRole: { primary: tombstone, poster: null },
            supersededAt: PHASE_6_CURRENT_AT,
            evictedAt: PHASE_6_CURRENT_AT,
          },
        ];
  if (state === 'retained') project.assets[asset.id] = asset;
  return tombstone;
};

const makeGeneratedPhase6Project = (): StudioProjectV4 => {
  const project = makePhase6Project();
  const pieceId = 'piece_photo_1';
  const jobId = 'job_photo_1';
  const assetId = 'asset_photo_1';
  const composition: StudioPieceGenerationCompositionV4 = {
    inputs: {
      schemaVersion: 4,
      projectRevisionAtPreparation: 1,
      authoringRevision: 1,
      authoringFingerprintVersion: 3,
      authoringFingerprint: DIGEST,
      brief: project.brief,
      rules: [],
      source: {
        kind: 'piece',
        pieceId,
        words: 'A quiet harbour before dawn.',
        settings: { kind: 'photograph', aspectRatio: '16:9', resolution: '1080p' },
      },
      purpose: 'piece_image',
      conditioningInputs: [],
      route: PROVIDER,
      instructionProfile: 'weprompt-image-v1.piece-image.v2',
    },
    prompt: 'PHOTO REQUEST\nA quiet harbour before dawn.',
  };
  const requestPlan: StudioPieceGenerationRequestPlanV4 = {
    kind: 'resolved',
    snapshot: {
      composition,
      settings: { kind: 'photograph', aspectRatio: '16:9', resolution: '1080p' },
      conditioningInputs: [],
    },
  };
  const target = { kind: 'piece' as const, pieceId };
  const itemId = createStudioPieceQuotedGenerationIdV4({
    projectId: project.id,
    reservationId: 'reservation_photo_1',
    quoteId: 'quote_photo_1',
    quoteRevision: 1,
    target,
    purpose: 'piece_image',
  });
  const publication = { schemaVersion: 1 as const, kind: 'fill_empty' as const };
  const attempt = { kind: 'first' as const };
  const quote: StudioPieceSubmissionQuoteV4 = {
    id: 'quote_photo_1',
    reservationId: 'reservation_photo_1',
    quoteRevision: 1,
    projectId: project.id,
    projectRevisionAtPreparation: 1,
    authoringRevision: 1,
    authoringFingerprintVersion: 3,
    authoringFingerprint: DIGEST,
    rateCardDigest: 'e'.repeat(64),
    currency: 'USD',
    item: {
      id: itemId,
      target,
      purpose: 'piece_image',
      routeId: 'route_photo_1',
      generationCount: 1,
      requestPlan,
      rateUnit: 'generation',
      rateMinorUnits: 3,
      publication,
      attempt,
    },
    lowerMinorUnits: 3,
    upperMinorUnits: 3,
    expiresAt: EXPIRES_AT,
  };
  const authorization: StudioPieceSpendAuthorizationV4 = {
    id: 'authorization_photo_1',
    quote,
    confirmedAt: PHASE_6_AUTHORED_AT,
    projectRevisionAtAuthorization: 2,
    cancellationPolicy: 'queued_and_running',
    providerBinding: { itemId, provider: PROVIDER },
    idempotencyKey: { itemId, key: 'idempotency_photo_1' },
  };
  const job: StudioPieceJobV4 = {
    id: jobId,
    projectId: project.id,
    target,
    purpose: 'piece_image',
    status: 'succeeded',
    provider: PROVIDER,
    idempotencyKey: authorization.idempotencyKey.key,
    providerSubmissionKind: 'remote',
    providerJobId: 'provider_job_photo_1',
    remoteStartedAt: PHASE_6_AUTHORED_AT,
    cancellationPolicy: authorization.cancellationPolicy,
    outputAssetIdsByRole: { primary: assetId, poster: null },
    error: null,
    progress: 100,
    publication,
    attempt,
    duplicateChargeAcknowledged: false,
    duplicateChargeAcknowledgedAt: null,
    authorizationId: authorization.id,
    authorizationItemId: itemId,
    composition,
    requestPlan,
    spendReceipt: {
      authorizationId: authorization.id,
      quoteId: quote.id,
      quoteRevision: quote.quoteRevision,
      itemId,
      jobId,
      purpose: 'piece_image',
      routeId: quote.item.routeId,
      currency: quote.currency,
      rateUnit: quote.item.rateUnit,
      rateMinorUnits: quote.item.rateMinorUnits,
      generationCount: 1,
      totalMinorUnits: quote.item.rateMinorUnits,
      recordedAt: PHASE_6_CURRENT_AT,
    },
    authoringRevision: 1,
    authoringFingerprintVersion: 3,
    authoringFingerprint: DIGEST,
    projectRevisionAtPreparation: 1,
    projectRevisionAtAuthorization: 2,
    createdAt: PHASE_6_AUTHORED_AT,
    updatedAt: PHASE_6_CURRENT_AT,
  };
  const compositionDigest = studioPieceGenerationCompositionDigestV4(composition);
  project.revision = 3;
  project.authoringRevision = 2;
  project.pieces[pieceId]!.jobIds = [jobId];
  project.assets[assetId] = {
    ...project.assets[assetId]!,
    managedAsset: { collection: 'assets', fileName: `${assetId}.png` },
    origin: 'generated',
    producerJobId: jobId,
    compositionDigest,
  };
  project.spendAuthorizations = [authorization];
  project.jobs[jobId] = job;
  expect(validateStudioProjectV4(project), 'generated fixture').toBe(true);
  return project;
};

const makeGeneratedMotionPhase6Project = (): StudioProjectV4 => {
  const project = makeGeneratedPhase6Project();
  const piece = project.pieces.piece_photo_1!;
  const photoJob = project.jobs.job_photo_1!;
  if (photoJob.purpose !== 'piece_image') throw new Error('motion fixture requires a photo source job');
  const settings = {
    kind: 'motion' as const,
    aspectRatio: '16:9' as const,
    resolution: '1080p' as const,
    requestedDurationSeconds: 6,
  };
  const { conditioningInputs: _conditioningInputs, ...compositionBase } = photoJob.composition.inputs;
  const composition: StudioPieceGenerationCompositionV4 = {
    inputs: {
      ...compositionBase,
      source: { ...compositionBase.source, settings },
      purpose: 'piece_motion',
      firstFrame: null,
      route: MOTION_PROVIDER,
      instructionProfile: 'openrouter-video-v1.piece-motion.v1',
    },
    prompt: 'MOTION REQUEST\nThe harbour wakes before dawn.',
  };
  const requestPlan: StudioPieceGenerationRequestPlanV4 = {
    kind: 'resolved',
    snapshot: { composition, settings, firstFrame: null },
  };
  const target = { kind: 'piece' as const, pieceId: piece.id };
  const itemId = createStudioPieceQuotedGenerationIdV4({
    projectId: project.id,
    reservationId: 'reservation_motion_1',
    quoteId: 'quote_motion_1',
    quoteRevision: 1,
    target,
    purpose: 'piece_motion',
  });
  const publication = { schemaVersion: 1 as const, kind: 'fill_empty' as const };
  const attempt = { kind: 'first' as const };
  const quote: StudioPieceSubmissionQuoteV4 = {
    id: 'quote_motion_1',
    reservationId: 'reservation_motion_1',
    quoteRevision: 1,
    projectId: project.id,
    projectRevisionAtPreparation: 1,
    authoringRevision: 1,
    authoringFingerprintVersion: 3,
    authoringFingerprint: DIGEST,
    rateCardDigest: '4'.repeat(64),
    currency: 'USD',
    item: {
      id: itemId,
      target,
      purpose: 'piece_motion',
      routeId: 'route_motion_1',
      generationCount: 1,
      requestPlan,
      rateUnit: 'second',
      rateMinorUnits: 5,
      requestedDurationSeconds: 6,
      billedDurationSeconds: 6,
      publication,
      attempt,
    },
    lowerMinorUnits: 30,
    upperMinorUnits: 30,
    expiresAt: EXPIRES_AT,
  };
  const authorization: StudioPieceSpendAuthorizationV4 = {
    id: 'authorization_motion_1',
    quote,
    confirmedAt: PHASE_6_AUTHORED_AT,
    projectRevisionAtAuthorization: 2,
    cancellationPolicy: 'queued_and_running',
    providerBinding: { itemId, provider: MOTION_PROVIDER },
    idempotencyKey: { itemId, key: 'idempotency_motion_1' },
  };
  const primaryId = 'asset_motion_1';
  const posterId = 'asset_motion_poster_1';
  const job: StudioPieceJobV4 = {
    ...photoJob,
    target,
    purpose: 'piece_motion',
    provider: MOTION_PROVIDER,
    idempotencyKey: authorization.idempotencyKey.key,
    providerJobId: 'provider_job_motion_1',
    outputAssetIdsByRole: { primary: primaryId, poster: posterId },
    publication,
    attempt,
    authorizationId: authorization.id,
    authorizationItemId: itemId,
    composition,
    requestPlan,
    requestSnapshot: requestPlan.snapshot,
    spendReceipt: {
      authorizationId: authorization.id,
      quoteId: quote.id,
      quoteRevision: quote.quoteRevision,
      itemId,
      jobId: photoJob.id,
      purpose: 'piece_motion',
      routeId: quote.item.routeId,
      currency: quote.currency,
      rateUnit: 'second',
      rateMinorUnits: quote.item.rateMinorUnits,
      requestedDurationSeconds: quote.item.requestedDurationSeconds,
      billedDurationSeconds: quote.item.billedDurationSeconds,
      generationCount: 1,
      totalMinorUnits: 30,
      recordedAt: PHASE_6_CURRENT_AT,
    },
  };
  const compositionDigest = studioPieceGenerationCompositionDigestV4(composition);
  const primary: StudioAssetV4 = {
    id: primaryId,
    projectId: project.id,
    pieceId: piece.id,
    mediaKind: 'video',
    role: 'primary',
    mimeType: 'video/mp4',
    managedAsset: { collection: 'assets', fileName: `${primaryId}.mp4` },
    byteSize: 1_024,
    sha256: '1'.repeat(64),
    width: 1_920,
    height: 1_080,
    durationSeconds: 5.75,
    createdAt: PHASE_6_CURRENT_AT,
    origin: 'generated',
    producerJobId: job.id,
    compositionDigest,
  };
  const poster: StudioAssetV4 = {
    id: posterId,
    projectId: project.id,
    pieceId: piece.id,
    mediaKind: 'image',
    role: 'poster',
    mimeType: 'image/webp',
    managedAsset: { collection: 'assets', fileName: `${posterId}.webp` },
    byteSize: 256,
    sha256: '2'.repeat(64),
    width: 1_920,
    height: 1_080,
    createdAt: PHASE_6_CURRENT_AT,
    origin: 'generated',
    producerJobId: job.id,
    compositionDigest,
  };
  piece.kind = 'motion';
  piece.currentAssetId = primary.id;
  project.assets = { [primary.id]: primary, [poster.id]: poster };
  project.spendAuthorizations = [authorization];
  project.jobs = { [job.id]: job };
  const binding = project.assemblies.assembly_1!.pictureBindings.shot_1!;
  binding.source = { pieceId: piece.id, assetId: primary.id };
  binding.sourceInSeconds = 0.5;
  binding.sourceOutSeconds = 5.5;
  expect(validateStudioProjectV4(project), 'generated motion fixture').toBe(true);
  return project;
};

const makeDeferredMotionChainProject = (): StudioProjectV4 => {
  const project = makeGeneratedMotionPhase6Project();
  const sourcePiece = project.pieces.piece_photo_1!;
  const sourceAuthorization = project.spendAuthorizations[0]!;
  const targetPieceId = 'piece_motion_2';
  const targetJobId = 'job_motion_waiting_2';
  const settings = {
    kind: 'motion' as const,
    aspectRatio: '16:9' as const,
    resolution: '1080p' as const,
    requestedDurationSeconds: 5,
  };
  const composition: StudioPieceGenerationCompositionV4 = {
    inputs: {
      schemaVersion: 4,
      projectRevisionAtPreparation: 4,
      authoringRevision: 3,
      authoringFingerprintVersion: 3,
      authoringFingerprint: DIGEST,
      brief: project.brief,
      rules: [],
      source: { kind: 'piece', pieceId: targetPieceId, words: 'Hands pull the rope into frame.', settings },
      purpose: 'piece_motion',
      firstFrame: null,
      route: MOTION_PROVIDER,
      instructionProfile: 'openrouter-video-v1.piece-motion.v1',
    },
    prompt: 'MOTION REQUEST\nHands pull the rope into frame.',
  };
  const requestPlan: StudioPieceGenerationRequestPlanV4 = {
    kind: 'after_upstream_completion',
    template: { composition, settings },
    dependency: {
      kind: 'authorized_predecessor',
      upstreamItemId: sourceAuthorization.quote.item.id,
      assemblyId: 'assembly_1',
      boardId: 'board_1',
      dependentShotId: 'shot_2',
      predecessorShotId: 'shot_1',
      sourcePieceId: sourcePiece.id,
    },
  };
  const target = { kind: 'piece' as const, pieceId: targetPieceId };
  const itemId = createStudioPieceQuotedGenerationIdV4({
    projectId: project.id,
    reservationId: 'reservation_motion_chain_2',
    quoteId: 'quote_motion_chain_2',
    quoteRevision: 1,
    target,
    purpose: 'piece_motion',
  });
  const publication = { schemaVersion: 1 as const, kind: 'fill_empty' as const };
  const attempt = { kind: 'first' as const };
  const quote: StudioPieceSubmissionQuoteV4 = {
    id: 'quote_motion_chain_2',
    reservationId: 'reservation_motion_chain_2',
    quoteRevision: 1,
    projectId: project.id,
    projectRevisionAtPreparation: 4,
    authoringRevision: 3,
    authoringFingerprintVersion: 3,
    authoringFingerprint: DIGEST,
    rateCardDigest: '7'.repeat(64),
    currency: 'USD',
    item: {
      id: itemId,
      target,
      purpose: 'piece_motion',
      routeId: 'route_motion_1',
      generationCount: 1,
      requestPlan,
      rateUnit: 'second',
      rateMinorUnits: 5,
      requestedDurationSeconds: 5,
      billedDurationSeconds: 5,
      publication,
      attempt,
    },
    lowerMinorUnits: 25,
    upperMinorUnits: 25,
    expiresAt: '2026-09-02T00:40:03.000Z',
  };
  const authorization: StudioPieceSpendAuthorizationV4 = {
    id: 'authorization_motion_chain_2',
    quote,
    confirmedAt: CHAIN_AUTHORIZED_AT,
    projectRevisionAtAuthorization: 5,
    cancellationPolicy: 'queued_and_running',
    providerBinding: { itemId, provider: MOTION_PROVIDER },
    idempotencyKey: { itemId, key: 'idempotency_motion_chain_2' },
  };
  const job: StudioPieceJobV4 = {
    id: targetJobId,
    projectId: project.id,
    target,
    purpose: 'piece_motion',
    status: 'waiting_for_conditioning',
    provider: MOTION_PROVIDER,
    idempotencyKey: authorization.idempotencyKey.key,
    providerSubmissionKind: null,
    providerJobId: null,
    remoteStartedAt: null,
    cancellationPolicy: authorization.cancellationPolicy,
    outputAssetIdsByRole: { primary: null, poster: null },
    error: null,
    progress: null,
    publication,
    attempt,
    duplicateChargeAcknowledged: false,
    duplicateChargeAcknowledgedAt: null,
    authorizationId: authorization.id,
    authorizationItemId: itemId,
    composition,
    requestPlan,
    requestSnapshot: null,
    spendReceipt: null,
    authoringRevision: 3,
    authoringFingerprintVersion: 3,
    authoringFingerprint: DIGEST,
    projectRevisionAtPreparation: 4,
    projectRevisionAtAuthorization: 5,
    createdAt: CHAIN_AUTHORIZED_AT,
    updatedAt: CHAIN_AUTHORIZED_AT,
  };
  project.revision = 6;
  project.authoringRevision = 3;
  project.updatedAt = CHAIN_AUTHORIZED_AT;
  project.pieceOrder.push(targetPieceId);
  project.pieces[targetPieceId] = {
    id: targetPieceId,
    kind: 'motion',
    handle: 'rope_motion',
    runStem: null,
    assetHistory: [],
    priorHandles: [],
    currentAssetId: null,
    jobIds: [targetJobId],
    createdAt: PHASE_6_CURRENT_AT,
    updatedAt: CHAIN_AUTHORIZED_AT,
  };
  project.jobs[targetJobId] = job;
  project.spendAuthorizations.push(authorization);
  project.assemblies.assembly_1!.updatedAt = CHAIN_AUTHORIZED_AT;
  project.assemblies.assembly_1!.pictureBindings.shot_2!.source = { pieceId: targetPieceId, assetId: null };
  expect(validateStudioProjectV4(project), 'deferred motion chain fixture').toBe(true);
  return project;
};

const materializeDeferredMotionChain = (project: StudioProjectV4): void => {
  const job = project.jobs.job_motion_waiting_2!;
  if (job.purpose !== 'piece_motion' || job.requestPlan.kind !== 'after_upstream_completion') {
    throw new Error('deferred motion chain job required');
  }
  const source = project.assets.asset_motion_1!;
  if (source.mediaKind !== 'video') throw new Error('motion source required');
  const extractionId = 'frame_extraction_chain_2';
  const frameAssetId = 'derived_frame_chain_2';
  project.frameExtractions[extractionId] = {
    id: extractionId,
    projectId: project.id,
    targetPieceId: job.target.pieceId,
    jobId: job.id,
    assemblyId: 'assembly_1',
    boardId: 'board_1',
    dependentShotId: 'shot_2',
    predecessorShotId: 'shot_1',
    sourcePieceId: 'piece_photo_1',
    sourceVideoAssetId: source.id,
    sourceVideoSha256: source.sha256,
    endpointSeconds: 5.5,
    frameAssetId,
    status: 'ready',
    errorCode: null,
    attemptCount: 1,
    createdAt: CHAIN_MATERIALIZED_AT,
    updatedAt: CHAIN_MATERIALIZED_AT,
  };
  project.derivedFrames[frameAssetId] = {
    id: frameAssetId,
    projectId: project.id,
    targetPieceId: job.target.pieceId,
    extractionId,
    mediaKind: 'image',
    role: 'conditioning_frame',
    mimeType: 'image/webp',
    managedAsset: { collection: 'assets', fileName: `${frameAssetId}.webp` },
    byteSize: 128,
    sha256: '8'.repeat(64),
    width: 1_920,
    height: 1_080,
    createdAt: CHAIN_MATERIALIZED_AT,
  };
  const firstFrame = {
    kind: 'predecessor_frame' as const,
    assemblyId: 'assembly_1',
    boardId: 'board_1',
    dependentShotId: 'shot_2',
    predecessorShotId: 'shot_1',
    sourcePieceId: 'piece_photo_1',
    sourceVideoAssetId: source.id,
    sourceVideoSha256: source.sha256,
    endpointSeconds: 5.5,
    frameExtractionId: extractionId,
    frameAssetId,
    frameSha256: '8'.repeat(64),
    frameMimeType: 'image/webp' as const,
    frameByteSize: 128,
  };
  const composition = structuredClone(job.requestPlan.template.composition);
  composition.inputs.firstFrame = firstFrame;
  job.requestSnapshot = { composition, settings: { ...job.requestPlan.template.settings }, firstFrame };
  job.status = 'queued_local';
  job.updatedAt = CHAIN_MATERIALIZED_AT;
  project.pieces[job.target.pieceId]!.updatedAt = CHAIN_MATERIALIZED_AT;
  project.updatedAt = CHAIN_MATERIALIZED_AT;
  expect(validateStudioProjectV4(project), 'materialized motion chain fixture').toBe(true);
};

const appendMaterializedDeferredMotionRetry = (
  project: StudioProjectV4,
  confirmedAt = RETRY_AUTHORIZED_AT
): StudioPieceJobV4 => {
  const sourceJob = project.jobs.job_motion_waiting_2!;
  if (
    sourceJob.purpose !== 'piece_motion' ||
    sourceJob.requestPlan.kind !== 'after_upstream_completion' ||
    sourceJob.requestSnapshot === null
  ) {
    throw new Error('materialized deferred motion source required');
  }
  const target = structuredClone(sourceJob.target);
  const attempt = { kind: 'retry' as const, sourceJobId: sourceJob.id, reason: 'cancelled' as const };
  const reservationId = 'reservation_motion_chain_retry_3';
  const quoteId = 'quote_motion_chain_retry_3';
  const itemId = createStudioPieceQuotedGenerationIdV4({
    projectId: project.id,
    reservationId,
    quoteId,
    quoteRevision: 1,
    target,
    purpose: 'piece_motion',
  });
  const sourceQuote = project.spendAuthorizations.find(
    (candidate) => candidate.id === sourceJob.authorizationId
  )!.quote;
  const quote: StudioPieceSubmissionQuoteV4 = {
    ...structuredClone(sourceQuote),
    id: quoteId,
    reservationId,
    item: {
      ...structuredClone(sourceQuote.item),
      id: itemId,
      requestPlan: structuredClone(sourceJob.requestPlan),
      attempt,
    },
    expiresAt: RETRY_EXPIRES_AT,
  };
  const authorization: StudioPieceSpendAuthorizationV4 = {
    id: 'authorization_motion_chain_retry_3',
    quote,
    confirmedAt,
    projectRevisionAtAuthorization: project.revision,
    cancellationPolicy: sourceJob.cancellationPolicy,
    providerBinding: { itemId, provider: structuredClone(sourceJob.provider) },
    idempotencyKey: { itemId, key: 'idempotency_motion_chain_retry_3' },
  };
  const retry: StudioPieceJobV4 = {
    ...structuredClone(sourceJob),
    id: 'job_motion_chain_retry_3',
    status: 'queued_local',
    providerSubmissionKind: null,
    providerJobId: null,
    remoteStartedAt: null,
    outputAssetIdsByRole: { primary: null, poster: null },
    error: null,
    progress: null,
    spendReceipt: null,
    publication: structuredClone(sourceJob.publication),
    attempt,
    authorizationId: authorization.id,
    authorizationItemId: itemId,
    idempotencyKey: authorization.idempotencyKey.key,
    composition: structuredClone(sourceJob.composition),
    requestPlan: structuredClone(sourceJob.requestPlan),
    requestSnapshot: structuredClone(sourceJob.requestSnapshot),
    projectRevisionAtAuthorization: project.revision,
    createdAt: confirmedAt,
    updatedAt: confirmedAt,
  };
  sourceJob.status = 'cancelled';
  project.spendAuthorizations.push(authorization);
  project.jobs[retry.id] = retry;
  project.pieces[retry.target.pieceId]!.jobIds.push(retry.id);
  project.pieces[retry.target.pieceId]!.updatedAt = confirmedAt;
  project.revision += 1;
  project.updatedAt = confirmedAt;
  return retry;
};

const completeDeferredMotionChain = (project: StudioProjectV4): void => {
  const job = project.jobs.job_motion_waiting_2!;
  if (job.purpose !== 'piece_motion' || job.requestSnapshot === null) {
    throw new Error('materialized motion chain required');
  }
  const primaryId = 'asset_motion_chain_2';
  job.status = 'succeeded';
  job.providerSubmissionKind = 'remote';
  job.providerJobId = 'provider_job_motion_chain_2';
  job.remoteStartedAt = CHAIN_MATERIALIZED_AT;
  job.outputAssetIdsByRole = { primary: primaryId, poster: null };
  job.progress = 100;
  job.spendReceipt = {
    authorizationId: job.authorizationId,
    quoteId: 'quote_motion_chain_2',
    quoteRevision: 1,
    itemId: job.authorizationItemId,
    jobId: job.id,
    purpose: 'piece_motion',
    routeId: 'route_motion_1',
    currency: 'USD',
    rateUnit: 'second',
    rateMinorUnits: 5,
    requestedDurationSeconds: 5,
    billedDurationSeconds: 5,
    generationCount: 1,
    totalMinorUnits: 25,
    recordedAt: CHAIN_COMPLETED_AT,
  };
  job.updatedAt = CHAIN_COMPLETED_AT;
  project.assets[primaryId] = {
    id: primaryId,
    projectId: project.id,
    pieceId: job.target.pieceId,
    mediaKind: 'video',
    role: 'primary',
    mimeType: 'video/mp4',
    managedAsset: { collection: 'assets', fileName: `${primaryId}.mp4` },
    byteSize: 2_048,
    sha256: 'a'.repeat(64),
    width: 1_920,
    height: 1_080,
    durationSeconds: 5,
    createdAt: CHAIN_COMPLETED_AT,
    origin: 'generated',
    producerJobId: job.id,
    compositionDigest: studioPieceGenerationCompositionDigestV4(job.requestSnapshot.composition),
  };
  const piece = project.pieces[job.target.pieceId]!;
  piece.currentAssetId = primaryId;
  piece.updatedAt = CHAIN_COMPLETED_AT;
  const assembly = project.assemblies.assembly_1!;
  assembly.pictureBindings.shot_2!.source = { pieceId: piece.id, assetId: primaryId };
  assembly.updatedAt = CHAIN_COMPLETED_AT;
  project.revision = 7;
  project.updatedAt = CHAIN_COMPLETED_AT;
  expect(validateStudioProjectV4(project), 'completed motion chain fixture').toBe(true);
};

const recordLaterChainEdit = (project: StudioProjectV4): void => {
  project.revision += 1;
  project.authoringRevision += 1;
  project.boards.board_1!.updatedAt = CHAIN_EDITED_AT;
  project.assemblies.assembly_1!.updatedAt = CHAIN_EDITED_AT;
  project.updatedAt = CHAIN_EDITED_AT;
};

const reorderChainShots = (project: StudioProjectV4): void => {
  project.boards.board_1!.beats.beat_1!.shotOrder = ['shot_2', 'shot_1'];
  project.assemblies.assembly_1!.pictureBindings.shot_2!.join = 'hard_cut';
  project.assemblies.assembly_1!.pictureBindings.shot_1!.join = 'match_previous';
  recordLaterChainEdit(project);
};

const clearCurrentPredecessorBinding = (project: StudioProjectV4, recordStaleness: boolean): void => {
  project.assemblies.assembly_1!.pictureBindings.shot_1!.source = null;
  project.assemblies.assembly_1!.pictureBindings.shot_1!.sourceInSeconds = 0;
  project.assemblies.assembly_1!.pictureBindings.shot_1!.sourceOutSeconds = null;
  if (recordStaleness) {
    project.assemblies.assembly_1!.pictureBindings.shot_2!.staleness = {
      cause: 'chain',
      upstreamShotId: 'shot_1',
      sourceAuthoringRevision: project.authoringRevision,
      keptAt: null,
    };
  }
  recordLaterChainEdit(project);
};

const addGeneratedMotionReplacement = (project: StudioProjectV4): void => {
  const piece = project.pieces.piece_photo_1!;
  const sourceJob = project.jobs.job_photo_1!;
  if (sourceJob.purpose !== 'piece_motion') throw new Error('motion replacement requires a motion job');
  const previousPrimary = project.assets[piece.currentAssetId!]!;
  const previousPosterId = sourceJob.outputAssetIdsByRole.poster;
  if (previousPrimary.mediaKind !== 'video' || previousPosterId === null) {
    throw new Error('motion replacement requires complete current outputs');
  }
  const previousPoster = project.assets[previousPosterId]!;
  if (previousPoster.mediaKind !== 'image' || previousPoster.role !== 'poster') {
    throw new Error('motion replacement requires its generated poster');
  }
  const composition = structuredClone(sourceJob.composition);
  composition.inputs.projectRevisionAtPreparation = project.revision;
  composition.inputs.authoringRevision = project.authoringRevision;
  const requestPlan: StudioPieceGenerationRequestPlanV4 = {
    kind: 'resolved',
    snapshot: {
      composition,
      settings: { ...composition.inputs.source.settings },
      firstFrame: composition.inputs.firstFrame === null ? null : { ...composition.inputs.firstFrame },
    },
  };
  const target = { kind: 'piece' as const, pieceId: piece.id };
  const itemId = createStudioPieceQuotedGenerationIdV4({
    projectId: project.id,
    reservationId: 'reservation_motion_2',
    quoteId: 'quote_motion_2',
    quoteRevision: 1,
    target,
    purpose: 'piece_motion',
  });
  const publication = {
    schemaVersion: 1 as const,
    kind: 'replace_current' as const,
    currentAsset: currentSnapshotFor(previousPrimary),
  };
  const attempt = { kind: 'first' as const };
  const quote: StudioPieceSubmissionQuoteV4 = {
    id: 'quote_motion_2',
    reservationId: 'reservation_motion_2',
    quoteRevision: 1,
    projectId: project.id,
    projectRevisionAtPreparation: project.revision,
    authoringRevision: project.authoringRevision,
    authoringFingerprintVersion: 3,
    authoringFingerprint: DIGEST,
    rateCardDigest: '3'.repeat(64),
    currency: 'USD',
    item: {
      id: itemId,
      target,
      purpose: 'piece_motion',
      routeId: 'route_motion_1',
      generationCount: 1,
      requestPlan,
      rateUnit: 'second',
      rateMinorUnits: 5,
      requestedDurationSeconds: 6,
      billedDurationSeconds: 6,
      publication,
      attempt,
    },
    lowerMinorUnits: 30,
    upperMinorUnits: 30,
    expiresAt: REPLACEMENT_EXPIRES_AT,
  };
  const authorization: StudioPieceSpendAuthorizationV4 = {
    id: 'authorization_motion_2',
    quote,
    confirmedAt: REPLACEMENT_AUTHORIZED_AT,
    projectRevisionAtAuthorization: project.revision + 1,
    cancellationPolicy: 'queued_and_running',
    providerBinding: { itemId, provider: MOTION_PROVIDER },
    idempotencyKey: { itemId, key: 'idempotency_motion_2' },
  };
  const primaryId = 'asset_motion_2';
  const posterId = 'asset_motion_poster_2';
  const job: StudioPieceJobV4 = {
    ...sourceJob,
    id: 'job_motion_2',
    idempotencyKey: authorization.idempotencyKey.key,
    providerJobId: 'provider_job_motion_2',
    remoteStartedAt: REPLACEMENT_AUTHORIZED_AT,
    outputAssetIdsByRole: { primary: primaryId, poster: posterId },
    publication,
    attempt,
    authorizationId: authorization.id,
    authorizationItemId: itemId,
    composition,
    requestPlan,
    requestSnapshot: requestPlan.snapshot,
    spendReceipt: {
      authorizationId: authorization.id,
      quoteId: quote.id,
      quoteRevision: quote.quoteRevision,
      itemId,
      jobId: 'job_motion_2',
      purpose: 'piece_motion',
      routeId: quote.item.routeId,
      currency: quote.currency,
      rateUnit: 'second',
      rateMinorUnits: quote.item.rateMinorUnits,
      requestedDurationSeconds: quote.item.requestedDurationSeconds,
      billedDurationSeconds: quote.item.billedDurationSeconds,
      generationCount: 1,
      totalMinorUnits: 30,
      recordedAt: REPLACEMENT_COMPLETED_AT,
    },
    authoringRevision: project.authoringRevision,
    projectRevisionAtPreparation: project.revision,
    projectRevisionAtAuthorization: project.revision + 1,
    createdAt: REPLACEMENT_AUTHORIZED_AT,
    updatedAt: REPLACEMENT_COMPLETED_AT,
  };
  const compositionDigest = studioPieceGenerationCompositionDigestV4(composition);
  const primary: StudioAssetV4 = {
    ...previousPrimary,
    id: primaryId,
    managedAsset: { collection: 'assets', fileName: `${primaryId}.mp4` },
    sha256: '5'.repeat(64),
    createdAt: REPLACEMENT_COMPLETED_AT,
    producerJobId: job.id,
    compositionDigest,
  };
  const poster: StudioAssetV4 = {
    ...previousPoster,
    id: posterId,
    managedAsset: { collection: 'assets', fileName: `${posterId}.webp` },
    sha256: '6'.repeat(64),
    createdAt: REPLACEMENT_COMPLETED_AT,
    producerJobId: job.id,
    compositionDigest,
  };
  piece.assetHistory.push({
    state: 'retained',
    assetIdsByRole: { primary: previousPrimary.id, poster: previousPoster.id },
    supersededAt: REPLACEMENT_COMPLETED_AT,
  });
  piece.currentAssetId = primary.id;
  piece.jobIds.push(job.id);
  piece.updatedAt = REPLACEMENT_COMPLETED_AT;
  project.assets[primary.id] = primary;
  project.assets[poster.id] = poster;
  project.jobs[job.id] = job;
  project.spendAuthorizations.push(authorization);
  project.revision += 2;
  project.updatedAt = REPLACEMENT_COMPLETED_AT;
  expect(validateStudioProjectV4(project), 'generated motion replacement fixture').toBe(true);
};

const addGeneratedReplacement = (project: StudioProjectV4): StudioAssetV4 => {
  const piece = project.pieces.piece_photo_1!;
  const previous = project.assets[piece.currentAssetId!]!;
  if (previous.origin !== 'generated') throw new Error('replacement fixture requires generated current media');
  const jobId = 'job_photo_2';
  const assetId = 'asset_photo_2';
  const composition = structuredClone(project.jobs.job_photo_1!.composition);
  composition.inputs.projectRevisionAtPreparation = project.revision;
  composition.inputs.authoringRevision = project.authoringRevision;
  const requestPlan: StudioPieceGenerationRequestPlanV4 = {
    kind: 'resolved',
    snapshot: {
      composition,
      settings: { ...composition.inputs.source.settings },
      conditioningInputs: [],
    },
  };
  const target = { kind: 'piece' as const, pieceId: piece.id };
  const itemId = createStudioPieceQuotedGenerationIdV4({
    projectId: project.id,
    reservationId: 'reservation_photo_2',
    quoteId: 'quote_photo_2',
    quoteRevision: 1,
    target,
    purpose: 'piece_image',
  });
  const publication = {
    schemaVersion: 1 as const,
    kind: 'replace_current' as const,
    currentAsset: currentSnapshotFor(previous),
  };
  const attempt = { kind: 'first' as const };
  const quote: StudioPieceSubmissionQuoteV4 = {
    id: 'quote_photo_2',
    reservationId: 'reservation_photo_2',
    quoteRevision: 1,
    projectId: project.id,
    projectRevisionAtPreparation: project.revision,
    authoringRevision: project.authoringRevision,
    authoringFingerprintVersion: 3,
    authoringFingerprint: DIGEST,
    rateCardDigest: 'f'.repeat(64),
    currency: 'USD',
    item: {
      id: itemId,
      target,
      purpose: 'piece_image',
      routeId: 'route_photo_1',
      generationCount: 1,
      requestPlan,
      rateUnit: 'generation',
      rateMinorUnits: 3,
      publication,
      attempt,
    },
    lowerMinorUnits: 3,
    upperMinorUnits: 3,
    expiresAt: REPLACEMENT_EXPIRES_AT,
  };
  const authorization: StudioPieceSpendAuthorizationV4 = {
    id: 'authorization_photo_2',
    quote,
    confirmedAt: REPLACEMENT_AUTHORIZED_AT,
    projectRevisionAtAuthorization: project.revision + 1,
    cancellationPolicy: 'queued_and_running',
    providerBinding: { itemId, provider: PROVIDER },
    idempotencyKey: { itemId, key: 'idempotency_photo_2' },
  };
  const job: StudioPieceJobV4 = {
    ...structuredClone(project.jobs.job_photo_1!),
    id: jobId,
    idempotencyKey: authorization.idempotencyKey.key,
    providerJobId: 'provider_job_photo_2',
    remoteStartedAt: REPLACEMENT_AUTHORIZED_AT,
    outputAssetIdsByRole: { primary: assetId, poster: null },
    authorizationId: authorization.id,
    authorizationItemId: itemId,
    composition,
    requestPlan,
    spendReceipt: {
      authorizationId: authorization.id,
      quoteId: quote.id,
      quoteRevision: quote.quoteRevision,
      itemId,
      jobId,
      purpose: 'piece_image',
      routeId: quote.item.routeId,
      currency: quote.currency,
      rateUnit: quote.item.rateUnit,
      rateMinorUnits: quote.item.rateMinorUnits,
      generationCount: 1,
      totalMinorUnits: quote.item.rateMinorUnits,
      recordedAt: REPLACEMENT_COMPLETED_AT,
    },
    publication,
    attempt,
    authoringRevision: project.authoringRevision,
    projectRevisionAtPreparation: project.revision,
    projectRevisionAtAuthorization: project.revision + 1,
    createdAt: REPLACEMENT_AUTHORIZED_AT,
    updatedAt: REPLACEMENT_COMPLETED_AT,
  };
  const asset: StudioAssetV4 = {
    ...previous,
    id: assetId,
    managedAsset: { collection: 'assets', fileName: `${assetId}.png` },
    sha256: '8'.repeat(64),
    createdAt: REPLACEMENT_COMPLETED_AT,
    producerJobId: jobId,
    compositionDigest: studioPieceGenerationCompositionDigestV4(composition),
  };
  piece.assetHistory.push({
    state: 'retained',
    assetIdsByRole: { primary: previous.id, poster: null },
    supersededAt: asset.createdAt,
  });
  piece.currentAssetId = asset.id;
  piece.jobIds.push(job.id);
  piece.updatedAt = asset.createdAt;
  project.spendAuthorizations.push(authorization);
  project.jobs[job.id] = job;
  project.assets[asset.id] = asset;
  project.revision += 2;
  project.updatedAt = asset.createdAt;
  expect(validateStudioProjectV4(project), 'generated replacement fixture').toBe(true);
  return asset;
};

const failGeneratedReplacement = (project: StudioProjectV4): void => {
  const piece = project.pieces.piece_photo_1!;
  const job = project.jobs.job_photo_2!;
  const replacementAssetId = job.outputAssetIdsByRole.primary!;
  const prior = piece.assetHistory.at(-1);
  if (prior?.state !== 'retained') throw new Error('expected retained replacement source');
  job.status = 'failed';
  job.outputAssetIdsByRole = { primary: null, poster: null };
  job.error = { code: 'timeout', messageKey: 'timeout' };
  job.progress = null;
  job.spendReceipt = null;
  delete project.assets[replacementAssetId];
  piece.assetHistory.pop();
  piece.currentAssetId = prior.assetIdsByRole.primary;
  project.assemblies.assembly_1!.pictureBindings.shot_1!.source = {
    pieceId: piece.id,
    assetId: prior.assetIdsByRole.primary,
  };
};

const addSuccessfulReplacementRetry = (project: StudioProjectV4): StudioAssetV4 => {
  const piece = project.pieces.piece_photo_1!;
  const sourceJob = project.jobs.job_photo_2!;
  const previous = project.assets[piece.currentAssetId!]!;
  const jobId = 'job_photo_3';
  const assetId = 'asset_photo_3';
  const composition = structuredClone(sourceJob.composition);
  composition.inputs.projectRevisionAtPreparation = project.revision;
  const requestPlan: StudioPieceGenerationRequestPlanV4 = {
    kind: 'resolved',
    snapshot: {
      composition,
      settings: { ...composition.inputs.source.settings },
      conditioningInputs: [],
    },
  };
  const target = { kind: 'piece' as const, pieceId: piece.id };
  const itemId = createStudioPieceQuotedGenerationIdV4({
    projectId: project.id,
    reservationId: 'reservation_photo_3',
    quoteId: 'quote_photo_3',
    quoteRevision: 1,
    target,
    purpose: 'piece_image',
  });
  const publication = structuredClone(sourceJob.publication);
  const attempt = { kind: 'retry' as const, sourceJobId: sourceJob.id, reason: 'provider_failure' as const };
  const quote: StudioPieceSubmissionQuoteV4 = {
    id: 'quote_photo_3',
    reservationId: 'reservation_photo_3',
    quoteRevision: 1,
    projectId: project.id,
    projectRevisionAtPreparation: project.revision,
    authoringRevision: project.authoringRevision,
    authoringFingerprintVersion: 3,
    authoringFingerprint: DIGEST,
    rateCardDigest: '7'.repeat(64),
    currency: 'USD',
    item: {
      id: itemId,
      target,
      purpose: 'piece_image',
      routeId: 'route_photo_1',
      generationCount: 1,
      requestPlan,
      rateUnit: 'generation',
      rateMinorUnits: 3,
      publication,
      attempt,
    },
    lowerMinorUnits: 3,
    upperMinorUnits: 3,
    expiresAt: RETRY_EXPIRES_AT,
  };
  const authorization: StudioPieceSpendAuthorizationV4 = {
    id: 'authorization_photo_3',
    quote,
    confirmedAt: RETRY_AUTHORIZED_AT,
    projectRevisionAtAuthorization: project.revision + 1,
    cancellationPolicy: 'queued_and_running',
    providerBinding: { itemId, provider: PROVIDER },
    idempotencyKey: { itemId, key: 'idempotency_photo_3' },
  };
  const job: StudioPieceJobV4 = {
    ...structuredClone(sourceJob),
    id: jobId,
    status: 'succeeded',
    idempotencyKey: authorization.idempotencyKey.key,
    providerJobId: 'provider_job_photo_3',
    remoteStartedAt: RETRY_AUTHORIZED_AT,
    outputAssetIdsByRole: { primary: assetId, poster: null },
    error: null,
    progress: 100,
    authorizationId: authorization.id,
    authorizationItemId: itemId,
    composition,
    requestPlan,
    spendReceipt: {
      authorizationId: authorization.id,
      quoteId: quote.id,
      quoteRevision: quote.quoteRevision,
      itemId,
      jobId,
      purpose: 'piece_image',
      routeId: quote.item.routeId,
      currency: quote.currency,
      rateUnit: quote.item.rateUnit,
      rateMinorUnits: quote.item.rateMinorUnits,
      generationCount: 1,
      totalMinorUnits: quote.item.rateMinorUnits,
      recordedAt: RETRY_COMPLETED_AT,
    },
    publication,
    attempt,
    projectRevisionAtPreparation: project.revision,
    projectRevisionAtAuthorization: project.revision + 1,
    createdAt: RETRY_AUTHORIZED_AT,
    updatedAt: RETRY_COMPLETED_AT,
  };
  const asset: StudioAssetV4 = {
    ...previous,
    id: assetId,
    managedAsset: { collection: 'assets', fileName: `${assetId}.png` },
    sha256: '6'.repeat(64),
    createdAt: RETRY_COMPLETED_AT,
    producerJobId: jobId,
    compositionDigest: studioPieceGenerationCompositionDigestV4(composition),
  };
  piece.assetHistory.push({
    state: 'retained',
    assetIdsByRole: { primary: previous.id, poster: null },
    supersededAt: asset.createdAt,
  });
  piece.currentAssetId = asset.id;
  piece.jobIds.push(job.id);
  piece.updatedAt = asset.createdAt;
  project.spendAuthorizations.push(authorization);
  project.jobs[job.id] = job;
  project.assets[asset.id] = asset;
  project.revision += 2;
  project.updatedAt = asset.createdAt;
  return asset;
};

const evictHistoricalGeneratedAsset = (project: StudioProjectV4): StudioPieceAssetTombstoneV4 => {
  const piece = project.pieces.piece_photo_1!;
  const retained = piece.assetHistory.find((entry) => {
    if (entry.state !== 'retained') return false;
    return project.assets[entry.assetIdsByRole.primary]?.origin === 'generated';
  });
  if (retained?.state !== 'retained') throw new Error('expected retained generated history');
  const asset = project.assets[retained.assetIdsByRole.primary]!;
  const tombstone = tombstoneFor(asset);
  const index = piece.assetHistory.indexOf(retained);
  piece.assetHistory[index] = {
    state: 'evicted',
    assetsByRole: { primary: tombstone, poster: null },
    supersededAt: retained.supersededAt,
    evictedAt: project.updatedAt,
  };
  delete project.assets[asset.id];
  return tombstone;
};

describe('schema-7 Piece-owned media retention', () => {
  it('keeps motion primary and poster together while Board Shot time remains the presentation clock', () => {
    const project = makeGeneratedMotionPhase6Project();
    const binding = project.assemblies.assembly_1!.pictureBindings.shot_1!;
    binding.sourceInSeconds = 0.5;
    binding.sourceOutSeconds = 5.5;

    expect(validateStudioProjectV4(project)).toBe(true);
    expect(project.jobs.job_photo_1!.outputAssetIdsByRole).toEqual({
      primary: 'asset_motion_1',
      poster: 'asset_motion_poster_1',
    });

    const outsideSource = structuredClone(project);
    outsideSource.assemblies.assembly_1!.pictureBindings.shot_1!.sourceOutSeconds = 5.751;
    expect(validateStudioProjectV4(outsideSource)).toBe(false);

    const tooShort = structuredClone(project);
    tooShort.assemblies.assembly_1!.pictureBindings.shot_1!.sourceOutSeconds = 0.501;
    expect(validateStudioProjectV4(tooShort)).toBe(false);

    const assemblyClock = structuredClone(project) as StudioProjectV4 & {
      assemblies: Record<string, StudioProjectV4['assemblies'][string] & { durationSeconds?: number }>;
    };
    assemblyClock.assemblies.assembly_1!.durationSeconds = 10;
    expect(validateStudioProjectV4(assemblyClock)).toBe(false);

    const largerThanImage = makeGeneratedMotionPhase6Project();
    largerThanImage.assets.asset_motion_1!.byteSize = STUDIO_MAX_IMAGE_ASSET_BYTES_V4 + 1;
    expect(validateStudioProjectV4(largerThanImage)).toBe(true);

    const oversizedVideo = makeGeneratedMotionPhase6Project();
    oversizedVideo.assets.asset_motion_1!.byteSize = STUDIO_MAX_VIDEO_ASSET_BYTES_V4 + 1;
    expect(validateStudioProjectV4(oversizedVideo)).toBe(false);

    const oversizedPoster = makeGeneratedMotionPhase6Project();
    oversizedPoster.assets.asset_motion_poster_1!.byteSize = STUDIO_MAX_IMAGE_ASSET_BYTES_V4 + 1;
    expect(validateStudioProjectV4(oversizedPoster)).toBe(false);
  });

  it('rejects cross-arm composition, request, purpose, settings, and output compatibility fields', () => {
    const photo = makeGeneratedPhase6Project();
    const photoJob = photo.jobs.job_photo_1!;
    if (photoJob.purpose !== 'piece_image') throw new Error('expected photo fixture');
    const photoInputs = photoJob.composition.inputs as typeof photoJob.composition.inputs & {
      firstFrame?: null;
    };
    photoInputs.firstFrame = null;
    expect(validateStudioProjectV4(photo)).toBe(false);

    const motion = makeGeneratedMotionPhase6Project();
    const motionJob = motion.jobs.job_photo_1!;
    if (motionJob.purpose !== 'piece_motion') throw new Error('expected motion fixture');
    const motionInputs = motionJob.composition.inputs as typeof motionJob.composition.inputs & {
      conditioningInputs?: [];
    };
    motionInputs.conditioningInputs = [];
    expect(validateStudioProjectV4(motion)).toBe(false);

    const wrongKind = makeGeneratedMotionPhase6Project();
    wrongKind.pieces.piece_photo_1!.kind = 'photograph';
    expect(validateStudioProjectV4(wrongKind)).toBe(false);

    const wrongDuration = makeGeneratedMotionPhase6Project();
    const durationItem = wrongDuration.spendAuthorizations[0]!.quote.item;
    if (durationItem.purpose !== 'piece_motion') throw new Error('expected motion quote');
    durationItem.requestedDurationSeconds = 7;
    expect(validateStudioProjectV4(wrongDuration)).toBe(false);

    const scalarOutput = makeGeneratedMotionPhase6Project() as StudioProjectV4 & {
      jobs: Record<string, StudioPieceJobV4 & { outputAssetId?: string }>;
    };
    scalarOutput.jobs.job_photo_1!.outputAssetId = 'asset_motion_1';
    expect(validateStudioProjectV4(scalarOutput)).toBe(false);

    const duplicatedOutput = makeGeneratedMotionPhase6Project();
    duplicatedOutput.jobs.job_photo_1!.outputAssetIdsByRole.poster = 'asset_motion_1';
    expect(validateStudioProjectV4(duplicatedOutput)).toBe(false);
  });

  it('requires generated posters to remain owned by the same Piece and producer', () => {
    const wrongOwner = makeGeneratedMotionPhase6Project();
    wrongOwner.assets.asset_motion_poster_1!.pieceId = 'piece_elsewhere';
    expect(validateStudioProjectV4(wrongOwner)).toBe(false);

    const wrongProducer = makeGeneratedMotionPhase6Project();
    wrongProducer.assets.asset_motion_poster_1!.producerJobId = 'job_other';
    expect(validateStudioProjectV4(wrongProducer)).toBe(false);

    const posterAsCurrent = makeGeneratedMotionPhase6Project();
    posterAsCurrent.pieces.piece_photo_1!.currentAssetId = 'asset_motion_poster_1';
    expect(validateStudioProjectV4(posterAsCurrent)).toBe(false);
  });

  it('retains and evicts one motion version as a primary-plus-poster pair', () => {
    const retained = makeGeneratedMotionPhase6Project();
    addGeneratedMotionReplacement(retained);
    expect(retained.pieces.piece_photo_1!.assetHistory).toEqual([
      {
        state: 'retained',
        assetIdsByRole: { primary: 'asset_motion_1', poster: 'asset_motion_poster_1' },
        supersededAt: REPLACEMENT_COMPLETED_AT,
      },
    ]);
    expect(validateStudioProjectV4(retained)).toBe(true);

    const evicted = structuredClone(retained);
    const entry = evicted.pieces.piece_photo_1!.assetHistory[0]!;
    if (entry.state !== 'retained' || entry.assetIdsByRole.poster === null) {
      throw new Error('expected retained motion pair');
    }
    const primary = evicted.assets[entry.assetIdsByRole.primary]!;
    const poster = evicted.assets[entry.assetIdsByRole.poster]!;
    evicted.pieces.piece_photo_1!.assetHistory[0] = {
      state: 'evicted',
      assetsByRole: { primary: tombstoneFor(primary), poster: tombstoneFor(poster) },
      supersededAt: entry.supersededAt,
      evictedAt: evicted.updatedAt,
    };
    delete evicted.assets[primary.id];
    delete evicted.assets[poster.id];
    evicted.assemblies.assembly_1!.pictureBindings.shot_1!.source = {
      pieceId: 'piece_photo_1',
      assetId: 'asset_motion_2',
    };
    evicted.assemblies.assembly_1!.updatedAt = evicted.updatedAt;
    expect(validateStudioProjectV4(evicted)).toBe(true);
    const identities = studioPersistentIdentitiesV4(evicted);
    expect(identities.has('asset_motion_1')).toBe(true);
    expect(identities.has('asset_motion_poster_1')).toBe(true);

    const missingPoster = structuredClone(evicted);
    const missingEntry = missingPoster.pieces.piece_photo_1!.assetHistory[0]!;
    if (missingEntry.state !== 'evicted') throw new Error('expected evicted motion pair');
    missingEntry.assetsByRole.poster = null;
    expect(validateStudioProjectV4(missingPoster)).toBe(false);
  });

  it('preserves imported-to-generated replacement and lets an Assembly keep the exact old source', () => {
    const project = makeGeneratedPhase6Project();
    addHistoricalImportedAsset(project, 'retained');
    project.assemblies.assembly_1!.pictureBindings.shot_1!.source = {
      pieceId: 'piece_photo_1',
      assetId: 'asset_imported_before_generation',
    };

    expect(validateStudioProjectV4(project)).toBe(true);
    expect(project.assemblies.assembly_1!.pictureBindings.shot_1!.source).toEqual({
      pieceId: 'piece_photo_1',
      assetId: 'asset_imported_before_generation',
    });
  });

  it('keeps evicted provenance addressable but never treats a tombstone as playable media', () => {
    const bound = makeGeneratedPhase6Project();
    const tombstone = addHistoricalImportedAsset(bound, 'evicted');
    bound.assemblies.assembly_1!.pictureBindings.shot_1!.source = {
      pieceId: 'piece_photo_1',
      assetId: tombstone.id,
    };

    expect(validateStudioProjectV4(bound)).toBe(false);

    bound.assemblies.assembly_1!.pictureBindings.shot_1!.source = {
      pieceId: 'piece_photo_1',
      assetId: 'asset_photo_1',
    };
    expect(validateStudioProjectV4(bound)).toBe(true);
    expect(studioPersistentIdentitiesV4(bound)).toContain(tombstone.id);
  });

  it('requires every live asset to be current or retained by exactly one Piece', () => {
    const missingRetained = makeGeneratedPhase6Project();
    addHistoricalImportedAsset(missingRetained, 'retained');
    delete missingRetained.assets.asset_imported_before_generation;
    expect(validateStudioProjectV4(missingRetained)).toBe(false);

    const unowned = makePhase6Project();
    unowned.assets.asset_orphan = {
      ...structuredClone(unowned.assets.asset_photo_1!),
      id: 'asset_orphan',
      managedAsset: { collection: 'imports', fileName: 'asset_orphan.png' },
      sha256: 'f'.repeat(64),
    };
    expect(validateStudioProjectV4(unowned)).toBe(false);

    const duplicateOwnership = makeGeneratedPhase6Project();
    duplicateOwnership.pieces.piece_photo_1!.assetHistory = [
      {
        state: 'retained',
        assetId: 'asset_photo_1',
        supersededAt: PHASE_6_CURRENT_AT,
      },
    ];
    expect(validateStudioProjectV4(duplicateOwnership)).toBe(false);
  });

  it('rejects tombstone identities reused by live assets or another durable owner', () => {
    const duplicate = makeGeneratedPhase6Project();
    const duplicateTombstone = addHistoricalImportedAsset(duplicate, 'evicted');
    duplicateTombstone.id = 'asset_photo_1';
    expect(validateStudioProjectV4(duplicate)).toBe(false);

    const collision = makeGeneratedPhase6Project();
    const collidingTombstone = addHistoricalImportedAsset(collision, 'evicted');
    collidingTombstone.id = 'board_1';
    expect(validateStudioProjectV4(collision)).toBe(false);
  });

  it('keeps imported tombstones free of invented generation provenance', () => {
    const valid = makeGeneratedPhase6Project();
    addHistoricalImportedAsset(valid, 'evicted');
    expect(validateStudioProjectV4(valid)).toBe(true);

    const inventedProducer = structuredClone(valid);
    const producerTombstone = inventedProducer.pieces.piece_photo_1!.assetHistory[0]!;
    if (producerTombstone.state !== 'evicted') throw new Error('expected evicted fixture');
    producerTombstone.assetsByRole.primary.producerJobId = 'job_invented';
    expect(validateStudioProjectV4(inventedProducer)).toBe(false);

    const inventedDigest = structuredClone(valid);
    const digestTombstone = inventedDigest.pieces.piece_photo_1!.assetHistory[0]!;
    if (digestTombstone.state !== 'evicted') throw new Error('expected evicted fixture');
    digestTombstone.assetsByRole.primary.compositionDigest = 'a'.repeat(64);
    expect(validateStudioProjectV4(inventedDigest)).toBe(false);
  });

  it('requires generated tombstones to preserve their succeeded producer and composition digest', () => {
    const valid = makeGeneratedPhase6Project();
    addGeneratedReplacement(valid);
    valid.assemblies.assembly_1!.pictureBindings.shot_1!.source = {
      pieceId: 'piece_photo_1',
      assetId: 'asset_photo_2',
    };
    valid.assemblies.assembly_1!.updatedAt = valid.updatedAt;
    evictHistoricalGeneratedAsset(valid);
    expect(validateStudioProjectV4(valid)).toBe(true);

    const wrongProducer = structuredClone(valid);
    const producerTombstone = wrongProducer.pieces.piece_photo_1!.assetHistory[0]!;
    if (producerTombstone.state !== 'evicted') throw new Error('expected evicted fixture');
    producerTombstone.assetsByRole.primary.producerJobId = 'job_unknown';
    expect(validateStudioProjectV4(wrongProducer)).toBe(false);

    const wrongDigest = structuredClone(valid);
    const digestTombstone = wrongDigest.pieces.piece_photo_1!.assetHistory[0]!;
    if (digestTombstone.state !== 'evicted') throw new Error('expected evicted fixture');
    digestTombstone.assetsByRole.primary.compositionDigest = '0'.repeat(64);
    expect(validateStudioProjectV4(wrongDigest)).toBe(false);
  });

  it('requires superseded history in oldest-first timestamp order', () => {
    const project = makeGeneratedPhase6Project();
    addHistoricalImportedAsset(project, 'retained');
    addGeneratedReplacement(project);
    expect(validateStudioProjectV4(project)).toBe(true);

    project.pieces.piece_photo_1!.assetHistory.reverse();
    expect(validateStudioProjectV4(project)).toBe(false);
  });

  it('requires evicted history to be an oldest-first prefix with monotonic eviction times', () => {
    const retainedThenEvicted = makeGeneratedPhase6Project();
    addHistoricalImportedAsset(retainedThenEvicted, 'retained');
    addGeneratedReplacement(retainedThenEvicted);
    const newer = retainedThenEvicted.pieces.piece_photo_1!.assetHistory[1]!;
    if (newer.state !== 'retained') throw new Error('expected retained generated version');
    const newerAsset = retainedThenEvicted.assets[newer.assetIdsByRole.primary]!;
    retainedThenEvicted.pieces.piece_photo_1!.assetHistory[1] = {
      state: 'evicted',
      assetsByRole: { primary: tombstoneFor(newerAsset), poster: null },
      supersededAt: newer.supersededAt,
      evictedAt: retainedThenEvicted.updatedAt,
    };
    delete retainedThenEvicted.assets[newerAsset.id];
    retainedThenEvicted.assemblies.assembly_1!.pictureBindings.shot_1!.source = {
      pieceId: 'piece_photo_1',
      assetId: 'asset_photo_2',
    };
    expect(validateStudioProjectV4(retainedThenEvicted)).toBe(false);

    const chronological = makeGeneratedPhase6Project();
    addHistoricalImportedAsset(chronological, 'retained');
    addGeneratedReplacement(chronological);
    const [first, second] = chronological.pieces.piece_photo_1!.assetHistory;
    if (first?.state !== 'retained' || second?.state !== 'retained') {
      throw new Error('expected two retained versions');
    }
    const firstAsset = chronological.assets[first.assetIdsByRole.primary]!;
    const secondAsset = chronological.assets[second.assetIdsByRole.primary]!;
    chronological.pieces.piece_photo_1!.assetHistory = [
      {
        state: 'evicted',
        assetsByRole: { primary: tombstoneFor(firstAsset), poster: null },
        supersededAt: first.supersededAt,
        evictedAt: RETRY_AUTHORIZED_AT,
      },
      {
        state: 'evicted',
        assetsByRole: { primary: tombstoneFor(secondAsset), poster: null },
        supersededAt: second.supersededAt,
        evictedAt: RETRY_COMPLETED_AT,
      },
    ];
    delete chronological.assets[firstAsset.id];
    delete chronological.assets[secondAsset.id];
    chronological.assemblies.assembly_1!.pictureBindings.shot_1!.source = {
      pieceId: 'piece_photo_1',
      assetId: 'asset_photo_2',
    };
    chronological.updatedAt = RETRY_COMPLETED_AT;
    chronological.assemblies.assembly_1!.updatedAt = RETRY_COMPLETED_AT;
    expect(validateStudioProjectV4(chronological)).toBe(true);

    const reversedEviction = structuredClone(chronological);
    const olderEntry = reversedEviction.pieces.piece_photo_1!.assetHistory[0]!;
    const newerEntry = reversedEviction.pieces.piece_photo_1!.assetHistory[1]!;
    if (olderEntry.state !== 'evicted' || newerEntry.state !== 'evicted') {
      throw new Error('expected evicted prefix');
    }
    olderEntry.evictedAt = RETRY_COMPLETED_AT;
    newerEntry.evictedAt = RETRY_AUTHORIZED_AT;
    expect(validateStudioProjectV4(reversedEviction)).toBe(false);
  });

  it('preserves generated-to-generated replacement without silently rebinding an Assembly', () => {
    const project = makeGeneratedPhase6Project();
    addGeneratedReplacement(project);

    expect(project.pieces.piece_photo_1!.currentAssetId).toBe('asset_photo_2');
    expect(project.pieces.piece_photo_1!.assetHistory).toEqual([
      {
        state: 'retained',
        assetIdsByRole: { primary: 'asset_photo_1', poster: null },
        supersededAt: REPLACEMENT_COMPLETED_AT,
      },
    ]);
    expect(project.assemblies.assembly_1!.pictureBindings.shot_1!.source).toEqual({
      pieceId: 'piece_photo_1',
      assetId: 'asset_photo_1',
    });
    expect(validateStudioProjectV4(project)).toBe(true);
  });

  it('keeps current media through a failed replacement and preserves its publication on retry', () => {
    const project = makeGeneratedPhase6Project();
    addGeneratedReplacement(project);
    failGeneratedReplacement(project);

    expect(project.pieces.piece_photo_1!.currentAssetId).toBe('asset_photo_1');
    expect(project.pieces.piece_photo_1!.assetHistory).toEqual([]);
    expect(validateStudioProjectV4(project), 'failed replacement').toBe(true);

    addSuccessfulReplacementRetry(project);
    expect(project.jobs.job_photo_3!.attempt).toEqual({
      kind: 'retry',
      sourceJobId: 'job_photo_2',
      reason: 'provider_failure',
    });
    expect(project.jobs.job_photo_3!.publication).toEqual(project.jobs.job_photo_2!.publication);
    expect(project.pieces.piece_photo_1!.currentAssetId).toBe('asset_photo_3');
    expect(project.pieces.piece_photo_1!.assetHistory).toEqual([
      {
        state: 'retained',
        assetIdsByRole: { primary: 'asset_photo_1', poster: null },
        supersededAt: RETRY_COMPLETED_AT,
      },
    ]);
    expect(validateStudioProjectV4(project), 'replacement retry').toBe(true);

    const authorizedBeforeFailure = structuredClone(project);
    authorizedBeforeFailure.spendAuthorizations[2]!.confirmedAt = '2026-09-02T00:00:03.500Z';
    expect(validateStudioProjectV4(authorizedBeforeFailure)).toBe(false);

    const changedPublication = structuredClone(project);
    const currentAsset = changedPublication.jobs.job_photo_3!.publication;
    if (currentAsset.kind !== 'replace_current') throw new Error('expected replacement publication');
    currentAsset.currentAsset.sha256 = '0'.repeat(64);
    changedPublication.spendAuthorizations[2]!.quote.item.publication = structuredClone(currentAsset);
    expect(validateStudioProjectV4(changedPublication)).toBe(false);

    const wrongRetrySource = structuredClone(project);
    const attempt = wrongRetrySource.jobs.job_photo_3!.attempt;
    if (attempt.kind !== 'retry') throw new Error('expected retry attempt');
    attempt.sourceJobId = 'job_photo_1';
    wrongRetrySource.spendAuthorizations[2]!.quote.item.attempt = structuredClone(attempt);
    expect(validateStudioProjectV4(wrongRetrySource)).toBe(false);
  });

  it('requires a frozen reference image to remain current through authorization', () => {
    const project = makeGeneratedPhase6Project();
    const targetJob = project.jobs.job_photo_1!;
    if (targetJob.purpose !== 'piece_image') throw new Error('expected photo target');
    const referencePieceId = 'piece_reference';
    const importedId = 'asset_reference_imported';
    const currentId = 'asset_reference_current';
    const referenceJobId = 'job_reference';
    const imported: StudioAssetV4 = {
      ...structuredClone(project.assets.asset_photo_1!),
      id: importedId,
      pieceId: referencePieceId,
      managedAsset: { collection: 'imports', fileName: `${importedId}.png` },
      sha256: 'a'.repeat(64),
      createdAt: PHASE_6_CREATED_AT,
      origin: 'imported',
      producerJobId: null,
      compositionDigest: null,
    };
    const referenceComposition = structuredClone(targetJob.composition);
    referenceComposition.inputs.source.pieceId = referencePieceId;
    referenceComposition.inputs.source.words = 'A separate reference photograph.';
    referenceComposition.inputs.conditioningInputs = [];
    const referenceRequest: StudioPieceGenerationRequestPlanV4 = {
      kind: 'resolved',
      snapshot: {
        composition: referenceComposition,
        settings: { ...referenceComposition.inputs.source.settings },
        conditioningInputs: [],
      },
    };
    const target = { kind: 'piece' as const, pieceId: referencePieceId };
    const referenceItemId = createStudioPieceQuotedGenerationIdV4({
      projectId: project.id,
      reservationId: 'reservation_reference',
      quoteId: 'quote_reference',
      quoteRevision: 1,
      target,
      purpose: 'piece_image',
    });
    const publication = {
      schemaVersion: 1 as const,
      kind: 'replace_current' as const,
      currentAsset: currentSnapshotFor(imported),
    };
    const attempt = { kind: 'first' as const };
    const referenceQuote: StudioPieceSubmissionQuoteV4 = {
      ...structuredClone(project.spendAuthorizations[0]!.quote),
      id: 'quote_reference',
      reservationId: 'reservation_reference',
      item: {
        ...structuredClone(project.spendAuthorizations[0]!.quote.item),
        id: referenceItemId,
        target,
        requestPlan: referenceRequest,
        publication,
        attempt,
      },
    };
    const referenceAuthorization: StudioPieceSpendAuthorizationV4 = {
      ...structuredClone(project.spendAuthorizations[0]!),
      id: 'authorization_reference',
      quote: referenceQuote,
      projectRevisionAtAuthorization: 3,
      providerBinding: { itemId: referenceItemId, provider: PROVIDER },
      idempotencyKey: { itemId: referenceItemId, key: 'idempotency_reference' },
    };
    const referenceJob: StudioPieceJobV4 = {
      ...structuredClone(targetJob),
      id: referenceJobId,
      target,
      idempotencyKey: referenceAuthorization.idempotencyKey.key,
      providerJobId: 'provider_job_reference',
      outputAssetIdsByRole: { primary: currentId, poster: null },
      publication,
      attempt,
      authorizationId: referenceAuthorization.id,
      authorizationItemId: referenceItemId,
      composition: referenceComposition,
      requestPlan: referenceRequest,
      spendReceipt: {
        ...structuredClone(targetJob.spendReceipt!),
        authorizationId: referenceAuthorization.id,
        quoteId: referenceQuote.id,
        itemId: referenceItemId,
        jobId: referenceJobId,
      },
      projectRevisionAtAuthorization: 3,
    };
    const current: StudioAssetV4 = {
      ...structuredClone(project.assets.asset_photo_1!),
      id: currentId,
      pieceId: referencePieceId,
      managedAsset: { collection: 'assets', fileName: `${currentId}.png` },
      sha256: 'b'.repeat(64),
      producerJobId: referenceJobId,
      compositionDigest: studioPieceGenerationCompositionDigestV4(referenceComposition),
    };
    project.pieceOrder.push(referencePieceId);
    project.pieces[referencePieceId] = {
      id: referencePieceId,
      kind: 'photograph',
      handle: 'reference_photo',
      runStem: null,
      assetHistory: [
        {
          state: 'retained',
          assetIdsByRole: { primary: importedId, poster: null },
          supersededAt: PHASE_6_CURRENT_AT,
        },
      ],
      priorHandles: [],
      currentAssetId: currentId,
      jobIds: [referenceJobId],
      createdAt: PHASE_6_CREATED_AT,
      updatedAt: PHASE_6_CURRENT_AT,
    };
    project.assets[importedId] = imported;
    project.assets[currentId] = current;
    project.jobs[referenceJobId] = referenceJob;
    project.spendAuthorizations.push(referenceAuthorization);
    const input = {
      pieceId: referencePieceId,
      assetId: importedId,
      sha256: imported.sha256,
      mimeType: imported.mimeType,
      byteSize: imported.byteSize,
    };
    targetJob.composition.inputs.conditioningInputs = [input];
    targetJob.requestPlan.snapshot.conditioningInputs = [input];
    project.assets.asset_photo_1!.compositionDigest = studioPieceGenerationCompositionDigestV4(targetJob.composition);
    expect(validateStudioProjectV4(project)).toBe(true);

    const setReferenceCompletion = (candidate: StudioProjectV4, completedAt: string): void => {
      candidate.pieces[referencePieceId]!.assetHistory[0]!.supersededAt = completedAt;
      candidate.assets[currentId]!.createdAt = completedAt;
      candidate.jobs[referenceJobId]!.updatedAt = completedAt;
      candidate.jobs[referenceJobId]!.spendReceipt!.recordedAt = completedAt;
    };
    const boundary = structuredClone(project);
    setReferenceCompletion(boundary, PHASE_6_AUTHORED_AT);
    expect(validateStudioProjectV4(boundary)).toBe(false);

    const oneMillisecondLater = structuredClone(project);
    setReferenceCompletion(oneMillisecondLater, '2026-09-02T00:00:01.001Z');
    expect(validateStudioProjectV4(oneMillisecondLater)).toBe(true);

    const terminalWithBinnedReference = structuredClone(project);
    terminalWithBinnedReference.bin = [
      {
        id: 'bin_piece_reference',
        subject: { kind: 'piece', pieceId: referencePieceId },
        reason: 'lifted',
        liftedAt: terminalWithBinnedReference.updatedAt,
      },
    ];
    expect(validateStudioProjectV4(terminalWithBinnedReference), 'terminal provenance may reference Bin media').toBe(
      true
    );

    const resumable = structuredClone(project);
    const resumableJob = resumable.jobs.job_photo_1!;
    resumableJob.status = 'needs_attention';
    resumableJob.outputAssetIdsByRole = { primary: null, poster: null };
    resumableJob.error = { code: 'poll_deadline', messageKey: 'poll_deadline' };
    resumableJob.progress = 50;
    delete resumable.assets.asset_photo_1;
    resumable.pieces.piece_photo_1!.currentAssetId = null;
    resumable.assemblies.assembly_1!.pictureBindings.shot_1!.source = null;
    expect(validateStudioProjectV4(resumable), 'resumable job with retained input bytes').toBe(true);
    resumable.bin = structuredClone(terminalWithBinnedReference.bin);
    expect(validateStudioProjectV4(resumable), 'Bin Piece still consumed by resumable work').toBe(false);
    resumable.bin = [];

    const resumableWithoutInputBytes = structuredClone(resumable);
    const resumableHistorical = resumableWithoutInputBytes.pieces[referencePieceId]!.assetHistory[0]!;
    if (resumableHistorical.state !== 'retained') throw new Error('expected retained input version');
    const resumableHistoricalAsset = resumableWithoutInputBytes.assets[resumableHistorical.assetIdsByRole.primary]!;
    resumableWithoutInputBytes.pieces[referencePieceId]!.assetHistory[0] = {
      state: 'evicted',
      assetsByRole: { primary: tombstoneFor(resumableHistoricalAsset), poster: null },
      supersededAt: resumableHistorical.supersededAt,
      evictedAt: resumableWithoutInputBytes.updatedAt,
    };
    delete resumableWithoutInputBytes.assets[resumableHistoricalAsset.id];
    expect(validateStudioProjectV4(resumableWithoutInputBytes), 'resumable job without input bytes').toBe(false);

    const terminalWithTombstone = structuredClone(project);
    const historical = terminalWithTombstone.pieces[referencePieceId]!.assetHistory[0]!;
    if (historical.state !== 'retained') throw new Error('expected retained input version');
    const historicalAsset = terminalWithTombstone.assets[historical.assetIdsByRole.primary]!;
    terminalWithTombstone.pieces[referencePieceId]!.assetHistory[0] = {
      state: 'evicted',
      assetsByRole: { primary: tombstoneFor(historicalAsset), poster: null },
      supersededAt: historical.supersededAt,
      evictedAt: terminalWithTombstone.updatedAt,
    };
    delete terminalWithTombstone.assets[historicalAsset.id];
    expect(validateStudioProjectV4(terminalWithTombstone)).toBe(true);

    const activeWithoutInputBytes = structuredClone(terminalWithTombstone);
    const activeJob = activeWithoutInputBytes.jobs.job_photo_1!;
    activeJob.status = 'running';
    activeJob.outputAssetIdsByRole = { primary: null, poster: null };
    activeJob.progress = 50;
    delete activeWithoutInputBytes.assets.asset_photo_1;
    activeWithoutInputBytes.pieces.piece_photo_1!.currentAssetId = null;
    activeWithoutInputBytes.assemblies.assembly_1!.pictureBindings.shot_1!.source = null;
    expect(validateStudioProjectV4(activeWithoutInputBytes)).toBe(false);
  });

  it('exempts a Piece from new retention eviction after it enters the Bin', () => {
    const project = makeGeneratedPhase6Project();
    addHistoricalImportedAsset(project, 'evicted');
    project.assemblyOrder = [];
    project.assemblies = {};
    project.bin = [
      {
        id: 'bin_piece_photo_1',
        subject: { kind: 'piece', pieceId: 'piece_photo_1' },
        reason: 'lifted',
        liftedAt: PHASE_6_CURRENT_AT,
      },
    ];
    expect(validateStudioProjectV4(project)).toBe(true);

    project.bin[0]!.liftedAt = PHASE_6_AUTHORED_AT;
    expect(validateStudioProjectV4(project)).toBe(false);
  });

  it('keeps an Assembly out of the Bin while nonterminal work depends on it', () => {
    const project = makeDeferredMotionChainProject();
    project.bin = [
      {
        id: 'bin_assembly_live',
        subject: { kind: 'assembly', assemblyId: 'assembly_1' },
        reason: 'lifted',
        liftedAt: project.updatedAt,
      },
    ];

    expect(validateStudioProjectV4(project)).toBe(false);

    project.jobs.job_motion_waiting_2!.status = 'cancelled';
    expect(validateStudioProjectV4(project), 'terminal dependency may remain as provenance').toBe(true);
  });

  it('orders Bin entries newest first while allowing equal timestamps from one batch', () => {
    const project = makePhase6Project();
    project.assemblies.assembly_1!.pictureBindings.shot_1!.source = null;
    project.assemblies.assembly_1!.pictureBindings.shot_1!.sourceInSeconds = 0;
    project.assemblies.assembly_1!.pictureBindings.shot_1!.sourceOutSeconds = null;
    project.pieces.piece_photo_1!.updatedAt = REPLACEMENT_AUTHORIZED_AT;
    project.updatedAt = REPLACEMENT_COMPLETED_AT;
    const newest = {
      id: 'bin_piece_newest',
      subject: { kind: 'piece' as const, pieceId: 'piece_photo_1' },
      reason: 'lifted' as const,
      liftedAt: REPLACEMENT_COMPLETED_AT,
    };
    const older = {
      id: 'bin_assembly_older',
      subject: { kind: 'assembly' as const, assemblyId: 'assembly_1' },
      reason: 'lifted' as const,
      liftedAt: REPLACEMENT_AUTHORIZED_AT,
    };
    project.bin = [newest, older];
    expect(validateStudioProjectV4(project), 'newest-first Bin').toBe(true);

    project.bin = [older, newest];
    expect(validateStudioProjectV4(project), 'oldest-first Bin').toBe(false);

    project.bin = [newest, { ...older, liftedAt: REPLACEMENT_COMPLETED_AT }];
    expect(validateStudioProjectV4(project), 'same-batch Bin entries').toBe(true);
  });

  it('enforces causal timestamps within Boards, Assemblies, bindings, and Bin entries', () => {
    const shotBeforeBoard = makePhase6Project();
    shotBeforeBoard.boards.board_1!.shots.shot_1!.createdAt = '2026-09-02T00:00:00.500Z';
    expect(validateStudioProjectV4(shotBeforeBoard), 'Shot predates Board').toBe(false);

    const boardBeforeShotUpdate = makePhase6Project();
    boardBeforeShotUpdate.boards.board_1!.updatedAt = '2026-09-02T00:00:01.500Z';
    expect(validateStudioProjectV4(boardBeforeShotUpdate), 'Board closes before Shot update').toBe(false);

    const assemblyBeforeBoard = makePhase6Project();
    assemblyBeforeBoard.assemblies.assembly_1!.createdAt = '2026-09-02T00:00:00.500Z';
    expect(validateStudioProjectV4(assemblyBeforeBoard), 'Assembly predates Board').toBe(false);

    const assemblyBeforeSelectedAsset = makePhase6Project();
    assemblyBeforeSelectedAsset.assemblies.assembly_1!.updatedAt = '2026-09-02T00:00:01.500Z';
    expect(validateStudioProjectV4(assemblyBeforeSelectedAsset), 'binding selects a future asset').toBe(false);

    const liftBeforePieceUpdate = makePhase6Project();
    liftBeforePieceUpdate.assemblies.assembly_1!.pictureBindings.shot_1!.source = null;
    liftBeforePieceUpdate.bin = [
      {
        id: 'bin_piece_too_early',
        subject: { kind: 'piece', pieceId: 'piece_photo_1' },
        reason: 'lifted',
        liftedAt: '2026-09-02T00:00:01.500Z',
      },
    ];
    expect(validateStudioProjectV4(liftBeforePieceUpdate), 'Bin lift predates subject update').toBe(false);

    const liftBeforeAssemblyUpdate = makePhase6Project();
    liftBeforeAssemblyUpdate.bin = [
      {
        id: 'bin_assembly_too_early',
        subject: { kind: 'assembly', assemblyId: 'assembly_1' },
        reason: 'lifted',
        liftedAt: '2026-09-02T00:00:01.500Z',
      },
    ];
    expect(validateStudioProjectV4(liftBeforeAssemblyUpdate), 'Assembly lift predates its update').toBe(false);
  });

  it('freezes symbolic predecessor authority and materializes only the Job request snapshot', () => {
    const waiting = makeDeferredMotionChainProject();
    const waitingJob = waiting.jobs.job_motion_waiting_2!;
    if (waitingJob.purpose !== 'piece_motion') throw new Error('motion job required');
    const frozenPlan = structuredClone(waitingJob.requestPlan);
    const frozenJobComposition = structuredClone(waitingJob.composition);
    const quotedPlan = structuredClone(waiting.spendAuthorizations[1]!.quote.item.requestPlan);
    expect(waitingJob.status).toBe('waiting_for_conditioning');
    expect(waitingJob.requestSnapshot).toBeNull();

    materializeDeferredMotionChain(waiting);
    const materializedJob = waiting.jobs.job_motion_waiting_2!;
    if (materializedJob.purpose !== 'piece_motion') throw new Error('motion job required');
    expect(materializedJob.requestPlan).toEqual(frozenPlan);
    expect(materializedJob.composition).toEqual(frozenJobComposition);
    expect(waiting.spendAuthorizations[1]!.quote.item.requestPlan).toEqual(quotedPlan);
    expect(materializedJob.requestSnapshot?.firstFrame?.kind).toBe('predecessor_frame');
    expect(waiting.assets.derived_frame_chain_2).toBeUndefined();
    expect(waiting.pieces.piece_motion_2!.assetHistory).toEqual([]);
    expect(studioPersistentIdentitiesV4(waiting)).toContain('derived_frame_chain_2');
  });

  it('keeps completed predecessor history playable after later Shot order and binding edits', () => {
    const reordered = makeDeferredMotionChainProject();
    materializeDeferredMotionChain(reordered);
    completeDeferredMotionChain(reordered);
    reorderChainShots(reordered);
    expect(validateStudioProjectV4(reordered), 'completed history after reorder').toBe(true);

    const rebound = makeDeferredMotionChainProject();
    materializeDeferredMotionChain(rebound);
    completeDeferredMotionChain(rebound);
    clearCurrentPredecessorBinding(rebound, true);
    expect(validateStudioProjectV4(rebound), 'completed history after predecessor rebind').toBe(true);
  });

  it('rejects orphaned or internally inconsistent completed predecessor provenance', () => {
    const inconsistent = makeDeferredMotionChainProject();
    materializeDeferredMotionChain(inconsistent);
    completeDeferredMotionChain(inconsistent);
    inconsistent.frameExtractions.frame_extraction_chain_2!.sourceVideoSha256 = '9'.repeat(64);
    expect(validateStudioProjectV4(inconsistent), 'inconsistent completed provenance').toBe(false);

    const orphaned = makeDeferredMotionChainProject();
    materializeDeferredMotionChain(orphaned);
    completeDeferredMotionChain(orphaned);
    delete orphaned.frameExtractions.frame_extraction_chain_2;
    expect(validateStudioProjectV4(orphaned), 'orphaned completed provenance').toBe(false);
  });

  it('keeps terminal deferred history after later edits without treating it as live authority', () => {
    const cancelled = makeDeferredMotionChainProject();
    cancelled.jobs.job_motion_waiting_2!.status = 'cancelled';
    reorderChainShots(cancelled);
    expect(validateStudioProjectV4(cancelled), 'cancelled unresolved history after reorder').toBe(true);

    const failed = makeDeferredMotionChainProject();
    materializeDeferredMotionChain(failed);
    const failedJob = failed.jobs.job_motion_waiting_2!;
    failedJob.status = 'failed';
    failedJob.providerSubmissionKind = 'remote';
    failedJob.providerJobId = 'provider_job_motion_chain_failed';
    failedJob.remoteStartedAt = CHAIN_MATERIALIZED_AT;
    failedJob.error = { code: 'timeout', messageKey: 'timeout' };
    failedJob.updatedAt = CHAIN_COMPLETED_AT;
    failed.pieces.piece_motion_2!.updatedAt = CHAIN_COMPLETED_AT;
    failed.updatedAt = CHAIN_COMPLETED_AT;
    clearCurrentPredecessorBinding(failed, false);
    expect(validateStudioProjectV4(failed), 'failed materialized history after rebind').toBe(true);
  });

  it('keeps a cancelled deferred Job valid after its exact predecessor frame was materialized', () => {
    const project = makeDeferredMotionChainProject();
    materializeDeferredMotionChain(project);
    const job = project.jobs.job_motion_waiting_2!;
    job.status = 'cancelled';

    expect(job.requestSnapshot?.firstFrame?.kind).toBe('predecessor_frame');
    expect(validateStudioProjectV4(project)).toBe(true);
  });

  it('fingerprints a deferred motion retry from its materialized provider request', () => {
    const project = makeDeferredMotionChainProject();
    materializeDeferredMotionChain(project);
    const job = project.jobs.job_motion_waiting_2!;
    if (job.purpose !== 'piece_motion' || job.requestSnapshot === null) {
      throw new Error('materialized motion job required');
    }
    job.status = 'cancelled';
    const prepared = {
      mode: 'retry' as const,
      existingPieceId: job.target.pieceId,
      sourceJobId: job.id,
      words: job.composition.inputs.source.words,
      settings: { ...job.composition.inputs.source.settings },
      firstFrame: structuredClone(job.requestSnapshot.firstFrame),
    };

    expect(() => createStudioAuthoringFingerprintV4({ project, prepared })).not.toThrow();
    expect(() => createStudioAuthoringFingerprintV4({ project, prepared: { ...prepared, firstFrame: null } })).toThrow(
      'retry words and settings must exactly match'
    );

    const drifted = structuredClone(project);
    const predecessor = drifted.assemblies.assembly_1!.pictureBindings.shot_1!;
    predecessor.sourceInSeconds = 0.25;
    predecessor.sourceOutSeconds = 5.25;
    recordLaterChainEdit(drifted);
    expect(validateStudioProjectV4(drifted), 'terminal history remains valid after trim drift').toBe(true);
    expect(() => createStudioAuthoringFingerprintV4({ project: drifted, prepared })).toThrow(
      'deferred retry predecessor topology no longer matches project authority'
    );
  });

  it('keeps a materialized predecessor frame valid across a later retry authorization', () => {
    const project = makeDeferredMotionChainProject();
    materializeDeferredMotionChain(project);
    const retry = appendMaterializedDeferredMotionRetry(project);

    expect(retry.createdAt).toBe(RETRY_AUTHORIZED_AT);
    expect(project.derivedFrames.derived_frame_chain_2!.createdAt).toBe(CHAIN_MATERIALIZED_AT);
    expect(validateStudioProjectV4(project)).toBe(true);
  });

  it('revalidates a live materialized retry against the current trimmed predecessor endpoint', () => {
    const project = makeDeferredMotionChainProject();
    materializeDeferredMotionChain(project);
    appendMaterializedDeferredMotionRetry(project, CHAIN_MATERIALIZED_AT);
    expect(validateStudioProjectV4(project), 'live materialized retry fixture').toBe(true);

    const predecessor = project.assemblies.assembly_1!.pictureBindings.shot_1!;
    predecessor.sourceInSeconds = 0.25;
    predecessor.sourceOutSeconds = 5.25;
    recordLaterChainEdit(project);

    expect(validateStudioProjectV4(project)).toBe(false);
  });

  it('rejects a terminal materialized extraction beyond its immutable source duration', () => {
    const project = makeDeferredMotionChainProject();
    materializeDeferredMotionChain(project);
    const job = project.jobs.job_motion_waiting_2!;
    if (job.purpose !== 'piece_motion' || job.requestSnapshot?.firstFrame?.kind !== 'predecessor_frame') {
      throw new Error('materialized predecessor frame required');
    }
    job.status = 'cancelled';
    const extraction = project.frameExtractions.frame_extraction_chain_2!;
    extraction.endpointSeconds = 100;
    job.requestSnapshot.firstFrame.endpointSeconds = 100;
    job.composition.inputs.firstFrame = structuredClone(job.requestSnapshot.firstFrame);
    job.requestSnapshot.composition = structuredClone(job.composition);

    expect(validateStudioProjectV4(project)).toBe(false);
  });

  it('rejects an unresolved waiting dependency after its upstream work is exhausted', () => {
    const project = makeDeferredMotionChainProject();
    const upstreamJob = project.jobs.job_photo_1!;
    upstreamJob.status = 'failed';
    upstreamJob.outputAssetIdsByRole = { primary: null, poster: null };
    upstreamJob.error = { code: 'timeout', messageKey: 'timeout' };
    upstreamJob.progress = null;
    upstreamJob.spendReceipt = null;
    delete project.assets.asset_motion_1;
    delete project.assets.asset_motion_poster_1;
    project.pieces.piece_photo_1!.currentAssetId = null;
    const predecessorBinding = project.assemblies.assembly_1!.pictureBindings.shot_1!;
    predecessorBinding.source = { pieceId: 'piece_photo_1', assetId: null };
    predecessorBinding.sourceInSeconds = 0;
    predecessorBinding.sourceOutSeconds = null;

    expect(validateStudioProjectV4(project), 'exhausted dependency still waiting').toBe(false);

    project.jobs.job_motion_waiting_2!.status = 'cancelled';
    expect(validateStudioProjectV4(project), 'cancelled dependency after exhaustion').toBe(true);
  });

  it('still rejects current-topology drift while predecessor work can progress', () => {
    const unresolved = makeDeferredMotionChainProject();
    reorderChainShots(unresolved);
    expect(validateStudioProjectV4(unresolved), 'active unresolved dependency after reorder').toBe(false);

    const materialized = makeDeferredMotionChainProject();
    materializeDeferredMotionChain(materialized);
    clearCurrentPredecessorBinding(materialized, false);
    expect(validateStudioProjectV4(materialized), 'active materialization after predecessor rebind').toBe(false);

    const brokenJoin = makeDeferredMotionChainProject();
    materializeDeferredMotionChain(brokenJoin);
    brokenJoin.assemblies.assembly_1!.pictureBindings.shot_2!.join = 'hard_cut';
    expect(validateStudioProjectV4(brokenJoin), 'live predecessor dependency without match join').toBe(false);

    const needsAttention = makeDeferredMotionChainProject();
    materializeDeferredMotionChain(needsAttention);
    const needsAttentionJob = needsAttention.jobs.job_motion_waiting_2!;
    needsAttentionJob.status = 'needs_attention';
    needsAttentionJob.providerSubmissionKind = 'remote';
    needsAttentionJob.providerJobId = 'provider_job_motion_chain_attention';
    needsAttentionJob.remoteStartedAt = CHAIN_MATERIALIZED_AT;
    needsAttentionJob.error = { code: 'poll_deadline', messageKey: 'poll_deadline' };
    needsAttentionJob.updatedAt = CHAIN_COMPLETED_AT;
    needsAttention.pieces.piece_motion_2!.updatedAt = CHAIN_COMPLETED_AT;
    needsAttention.updatedAt = CHAIN_COMPLETED_AT;
    reorderChainShots(needsAttention);
    expect(validateStudioProjectV4(needsAttention), 'resumable dependency after reorder').toBe(false);
  });

  it('rejects stale or arbitrary materialization of an authorized predecessor dependency', () => {
    const wrongEndpoint = makeDeferredMotionChainProject();
    materializeDeferredMotionChain(wrongEndpoint);
    wrongEndpoint.frameExtractions.frame_extraction_chain_2!.endpointSeconds = 5.4;
    expect(validateStudioProjectV4(wrongEndpoint)).toBe(false);

    const wrongAdjacency = makeDeferredMotionChainProject();
    materializeDeferredMotionChain(wrongAdjacency);
    wrongAdjacency.frameExtractions.frame_extraction_chain_2!.predecessorShotId = 'shot_2';
    expect(validateStudioProjectV4(wrongAdjacency)).toBe(false);

    const wrongFrameFacts = makeDeferredMotionChainProject();
    materializeDeferredMotionChain(wrongFrameFacts);
    wrongFrameFacts.derivedFrames.derived_frame_chain_2!.sha256 = '9'.repeat(64);
    expect(validateStudioProjectV4(wrongFrameFacts)).toBe(false);

    const arbitraryPhoto = makeDeferredMotionChainProject();
    materializeDeferredMotionChain(arbitraryPhoto);
    const job = arbitraryPhoto.jobs.job_motion_waiting_2!;
    if (job.purpose !== 'piece_motion' || job.requestSnapshot === null) throw new Error('materialized motion required');
    const sourcePhoto = makePhase6Project().assets.asset_photo_1!;
    job.requestSnapshot.firstFrame = {
      kind: 'piece_image',
      pieceId: 'piece_photo_1',
      assetId: 'asset_motion_1',
      sha256: sourcePhoto.sha256,
      mimeType: 'image/png',
      byteSize: sourcePhoto.byteSize,
    };
    job.composition.inputs.firstFrame = structuredClone(job.requestSnapshot.firstFrame);
    job.requestSnapshot.composition = structuredClone(job.composition);
    expect(validateStudioProjectV4(arbitraryPhoto)).toBe(false);
  });

  it('rejects half-materialized and compatibility-shaped predecessor records', () => {
    const waitingWithSnapshot = makeDeferredMotionChainProject();
    materializeDeferredMotionChain(waitingWithSnapshot);
    const job = waitingWithSnapshot.jobs.job_motion_waiting_2!;
    job.status = 'waiting_for_conditioning';
    expect(validateStudioProjectV4(waitingWithSnapshot)).toBe(false);

    const extraField = makeDeferredMotionChainProject();
    materializeDeferredMotionChain(extraField);
    Object.assign(extraField.frameExtractions.frame_extraction_chain_2!, { takeAssetId: 'legacy_take' });
    expect(validateStudioProjectV4(extraField)).toBe(false);

    const orphanFrame = makeDeferredMotionChainProject();
    materializeDeferredMotionChain(orphanFrame);
    delete orphanFrame.frameExtractions.frame_extraction_chain_2;
    expect(validateStudioProjectV4(orphanFrame)).toBe(false);

    const orphanExtraction = makeDeferredMotionChainProject();
    const source = orphanExtraction.assets.asset_motion_1!;
    if (source.mediaKind !== 'video') throw new Error('motion source required');
    orphanExtraction.frameExtractions.orphan_extraction = {
      id: 'orphan_extraction',
      projectId: orphanExtraction.id,
      targetPieceId: 'piece_motion_2',
      jobId: 'job_missing',
      assemblyId: 'assembly_1',
      boardId: 'board_1',
      dependentShotId: 'shot_2',
      predecessorShotId: 'shot_1',
      sourcePieceId: 'piece_photo_1',
      sourceVideoAssetId: source.id,
      sourceVideoSha256: source.sha256,
      endpointSeconds: 5.5,
      frameAssetId: null,
      status: 'pending',
      errorCode: null,
      attemptCount: 0,
      createdAt: CHAIN_AUTHORIZED_AT,
      updatedAt: CHAIN_AUTHORIZED_AT,
    };
    expect(validateStudioProjectV4(orphanExtraction)).toBe(false);
  });

  it('retains a failed extraction ledger when its waiting owner is cancelled', () => {
    const project = makeDeferredMotionChainProject();
    materializeDeferredMotionChain(project);
    const extraction = project.frameExtractions.frame_extraction_chain_2!;
    const owner = project.jobs.job_motion_waiting_2!;
    extraction.status = 'failed';
    extraction.frameAssetId = null;
    extraction.errorCode = 'decode_failed';
    extraction.attemptCount = 3;
    delete project.derivedFrames.derived_frame_chain_2;
    owner.status = 'waiting_for_conditioning';
    owner.requestSnapshot = null;
    expect(validateStudioProjectV4(project), 'durable failed extraction while waiting').toBe(true);

    owner.status = 'cancelled';
    expect(validateStudioProjectV4(project), 'durable failed extraction after cancellation').toBe(true);

    extraction.status = 'extracting';
    expect(validateStudioProjectV4(project), 'active extraction cannot outlive cancellation').toBe(false);
  });

  it('admits exactly one causally ordered extraction record per deferred Job', () => {
    const pending = makeDeferredMotionChainProject();
    materializeDeferredMotionChain(pending);
    const extraction = pending.frameExtractions.frame_extraction_chain_2!;
    const owner = pending.jobs.job_motion_waiting_2!;
    extraction.status = 'pending';
    extraction.frameAssetId = null;
    extraction.attemptCount = 0;
    delete pending.derivedFrames.derived_frame_chain_2;
    owner.status = 'waiting_for_conditioning';
    owner.requestSnapshot = null;
    expect(validateStudioProjectV4(pending), 'one pending extraction').toBe(true);

    const duplicate = structuredClone(pending);
    duplicate.frameExtractions.frame_extraction_duplicate = {
      ...structuredClone(duplicate.frameExtractions.frame_extraction_chain_2!),
      id: 'frame_extraction_duplicate',
    };
    expect(validateStudioProjectV4(duplicate), 'two extraction identities for one Job').toBe(false);

    const predatesOwner = structuredClone(pending);
    predatesOwner.frameExtractions.frame_extraction_chain_2!.createdAt = '2026-09-02T00:00:02.500Z';
    expect(validateStudioProjectV4(predatesOwner), 'extraction before deferred authorization').toBe(false);

    const afterOwnerClosed = makeDeferredMotionChainProject();
    materializeDeferredMotionChain(afterOwnerClosed);
    afterOwnerClosed.frameExtractions.frame_extraction_chain_2!.updatedAt = RETRY_AUTHORIZED_AT;
    afterOwnerClosed.derivedFrames.derived_frame_chain_2!.createdAt = RETRY_AUTHORIZED_AT;
    afterOwnerClosed.pieces.piece_motion_2!.updatedAt = RETRY_AUTHORIZED_AT;
    afterOwnerClosed.updatedAt = RETRY_AUTHORIZED_AT;
    expect(validateStudioProjectV4(afterOwnerClosed), 'frame completed after its owner Job closed').toBe(false);
  });

  it('binds a materialized predecessor asset to the exact authorized upstream item', () => {
    const project = makeDeferredMotionChainProject();
    materializeDeferredMotionChain(project);
    addGeneratedMotionReplacement(project);
    const replacement = project.assets.asset_motion_2!;
    if (replacement.mediaKind !== 'video') throw new Error('replacement motion required');
    project.assemblies.assembly_1!.pictureBindings.shot_1!.source = {
      pieceId: 'piece_photo_1',
      assetId: replacement.id,
    };
    const extraction = project.frameExtractions.frame_extraction_chain_2!;
    extraction.sourceVideoAssetId = replacement.id;
    extraction.sourceVideoSha256 = replacement.sha256;
    const job = project.jobs.job_motion_waiting_2!;
    if (job.purpose !== 'piece_motion' || job.requestSnapshot?.firstFrame?.kind !== 'predecessor_frame') {
      throw new Error('materialized dependency required');
    }
    job.requestSnapshot.firstFrame.sourceVideoAssetId = replacement.id;
    job.requestSnapshot.firstFrame.sourceVideoSha256 = replacement.sha256;
    job.requestSnapshot.composition.inputs.firstFrame = structuredClone(job.requestSnapshot.firstFrame);
    expect(validateStudioProjectV4(project)).toBe(false);
  });

  it('requires predecessor authority to predate the dependent quote snapshot', () => {
    const project = makeDeferredMotionChainProject();
    const upstreamAuthorization = project.spendAuthorizations[0]!;
    const dependentAuthorization = project.spendAuthorizations[1]!;
    upstreamAuthorization.projectRevisionAtAuthorization = 5;
    project.jobs.job_photo_1!.projectRevisionAtAuthorization = 5;
    dependentAuthorization.projectRevisionAtAuthorization = 6;
    project.jobs.job_motion_waiting_2!.projectRevisionAtAuthorization = 6;

    expect(dependentAuthorization.quote.projectRevisionAtPreparation).toBe(4);
    expect(validateStudioProjectV4(project)).toBe(false);
  });

  it('digests the concrete provider composition while preserving symbolic job authority', () => {
    const project = makeDeferredMotionChainProject();
    const symbolic = structuredClone(project.jobs.job_motion_waiting_2!.composition);
    materializeDeferredMotionChain(project);
    completeDeferredMotionChain(project);
    const job = project.jobs.job_motion_waiting_2!;
    if (job.purpose !== 'piece_motion' || job.requestSnapshot === null) throw new Error('completed motion required');
    expect(job.composition).toEqual(symbolic);
    expect(project.assets.asset_motion_chain_2!.compositionDigest).toBe(
      studioPieceGenerationCompositionDigestV4(job.requestSnapshot.composition)
    );
    expect(studioPieceGenerationCompositionDigestV4(job.composition)).not.toBe(
      project.assets.asset_motion_chain_2!.compositionDigest
    );

    project.assets.asset_motion_chain_2!.compositionDigest = studioPieceGenerationCompositionDigestV4(job.composition);
    expect(validateStudioProjectV4(project)).toBe(false);
  });

  it('cancels an unresolved dependency without materializing or dispatching it', () => {
    const project = makeDeferredMotionChainProject();
    const job = project.jobs.job_motion_waiting_2!;
    job.status = 'cancelled';
    expect(validateStudioProjectV4(project)).toBe(true);

    const dispatched = structuredClone(project);
    const dispatchedJob = dispatched.jobs.job_motion_waiting_2!;
    dispatchedJob.providerSubmissionKind = 'remote';
    dispatchedJob.providerJobId = 'provider_job_should_not_exist';
    dispatchedJob.remoteStartedAt = CHAIN_AUTHORIZED_AT;
    expect(validateStudioProjectV4(dispatched)).toBe(false);

    const extracted = structuredClone(project);
    const waiting = makeDeferredMotionChainProject();
    materializeDeferredMotionChain(waiting);
    extracted.frameExtractions = structuredClone(waiting.frameExtractions);
    extracted.derivedFrames = structuredClone(waiting.derivedFrames);
    extracted.updatedAt = CHAIN_MATERIALIZED_AT;
    extracted.pieces.piece_motion_2!.updatedAt = CHAIN_MATERIALIZED_AT;
    expect(validateStudioProjectV4(extracted)).toBe(false);

    const invalidRetry = structuredClone(project);
    const retryJob = invalidRetry.jobs.job_motion_waiting_2!;
    retryJob.attempt = { kind: 'retry', sourceJobId: 'job_photo_1', reason: 'cancelled' };
    invalidRetry.spendAuthorizations[1]!.quote.item.attempt = structuredClone(retryJob.attempt);
    expect(validateStudioProjectV4(invalidRetry)).toBe(false);
  });

  it('never accepts superseded history without a retained current asset', () => {
    const project = makeGeneratedPhase6Project();
    addGeneratedReplacement(project);
    delete project.assets.asset_photo_2;
    project.pieces.piece_photo_1!.currentAssetId = null;

    expect(validateStudioProjectV4(project)).toBe(false);
  });

  it('requires the only active Job to be final in its Piece attempt order', () => {
    const project = makeGeneratedPhase6Project();
    addGeneratedReplacement(project);
    failGeneratedReplacement(project);
    const active = project.jobs.job_photo_1!;
    const later = project.jobs.job_photo_2!;
    active.status = 'queued_local';
    active.providerSubmissionKind = null;
    active.providerJobId = null;
    active.remoteStartedAt = null;
    active.outputAssetIdsByRole = { primary: null, poster: null };
    active.progress = null;
    active.spendReceipt = null;
    delete project.assets.asset_photo_1;
    project.pieces.piece_photo_1!.currentAssetId = null;
    project.assemblies.assembly_1!.pictureBindings.shot_1!.source = null;
    later.publication = { schemaVersion: 1, kind: 'fill_empty' };
    project.spendAuthorizations[1]!.quote.item.publication = structuredClone(later.publication);

    expect(project.pieces.piece_photo_1!.jobIds).toEqual(['job_photo_1', 'job_photo_2']);
    expect(validateStudioProjectV4(project)).toBe(false);
  });

  it('rejects stale publication versions, quote drift, and schema-6 retry compatibility fields', () => {
    const staleVersion = makeGeneratedPhase6Project();
    staleVersion.jobs.job_photo_1!.publication.schemaVersion = 2 as 1;
    staleVersion.spendAuthorizations[0]!.quote.item.publication.schemaVersion = 2 as 1;
    expect(validateStudioProjectV4(staleVersion)).toBe(false);

    const quoteDrift = makeGeneratedPhase6Project();
    quoteDrift.spendAuthorizations[0]!.quote.item.attempt = {
      kind: 'retry',
      sourceJobId: 'job_missing',
      reason: 'provider_failure',
    };
    expect(validateStudioProjectV4(quoteDrift)).toBe(false);

    const compatibility = makeGeneratedPhase6Project() as StudioProjectV4 & {
      jobs: Record<string, StudioPieceJobV4 & { retryOfJobId?: string | null; retryReason?: string | null }>;
    };
    compatibility.jobs.job_photo_1!.retryOfJobId = null;
    compatibility.jobs.job_photo_1!.retryReason = null;
    expect(validateStudioProjectV4(compatibility)).toBe(false);
  });

  it('rejects tombstones with copied ownership paths or facts predating their Piece', () => {
    const withOwnership = makeGeneratedPhase6Project();
    addHistoricalImportedAsset(withOwnership, 'evicted');
    const ownershipTombstone = withOwnership.pieces.piece_photo_1!.assetHistory[0]!;
    if (ownershipTombstone.state !== 'evicted') throw new Error('expected evicted fixture');
    Object.assign(ownershipTombstone.assetsByRole.primary, {
      projectId: withOwnership.id,
      pieceId: 'piece_photo_1',
      managedAsset: { collection: 'imports', fileName: 'asset_imported_before_generation.png' },
    });
    expect(validateStudioProjectV4(withOwnership)).toBe(false);

    const predatingPiece = makeGeneratedPhase6Project();
    addHistoricalImportedAsset(predatingPiece, 'evicted');
    const oldTombstone = predatingPiece.pieces.piece_photo_1!.assetHistory[0]!;
    if (oldTombstone.state !== 'evicted') throw new Error('expected evicted fixture');
    oldTombstone.assetsByRole.primary.createdAt = PHASE_6_CREATED_AT;
    expect(validateStudioProjectV4(predatingPiece)).toBe(false);
  });
});
