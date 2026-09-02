/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest';
import {
  STUDIO_MAX_BEATS,
  STUDIO_MAX_BIN_BEAT_ITEMS,
  STUDIO_MAX_BIN_SHOT_ITEMS,
  STUDIO_MAX_IMAGE_ASSET_BYTES_V3,
  STUDIO_MAX_JOBS_PER_PIECE_V3,
  STUDIO_MAX_PIECES_V3,
  STUDIO_MAX_PIECE_HANDLE_SCALARS_V3,
  STUDIO_MAX_PROJECT_REFERENCES,
  STUDIO_MAX_SHOOTING_SCRIPT_LENGTH,
  STUDIO_MAX_SHOTS_PER_BEAT,
  STUDIO_MAX_SHOTS_PER_PROJECT,
  STUDIO_MAX_STORY_LENGTH,
  STUDIO_MAX_UNDO_ENTRIES,
  STUDIO_MAX_UNDO_ENTRIES_V3,
  STUDIO_MAX_UNDO_PATCHES_PER_ENTRY,
  STUDIO_GENERATION_COMPOSITION_SCHEMA_VERSION,
  STUDIO_PROJECT_SCHEMA_VERSION,
  type StudioAssetV2,
  type StudioAssetV3,
  type StudioBeat,
  type StudioConditioningInputSnapshot,
  type StudioFixedShotReasonV2,
  type StudioGenerationReferenceInputSnapshot,
  type StudioGenerationRequestPlan,
  type StudioGenerationTargetV2,
  type StudioJobV2,
  type StudioPieceGenerationCompositionV3,
  type StudioPieceGenerationRequestPlanV3,
  type StudioPieceJobV3,
  type StudioPieceSpendAuthorizationV3,
  type StudioPieceSubmissionQuoteV3,
  type StudioProjectV2,
  type StudioProjectV3,
  type StudioProjectV4,
  type StudioQuotedGeneration,
  type StudioShot,
  type StudioSpendAuthorization,
} from '@/common/types/project/creativeStudioTypes';
import {
  calculateStudioQuoteTotals,
  composeStudioGenerationV2,
  createStudioFrameExtractionId,
  createStudioPieceQuotedGenerationIdV3,
  createStudioQuotedGenerationId,
  deriveStudioInstructionProfileV2,
  recomposeStudioGenerationV2,
  studioGenerationCompositionDigestV2,
  studioPieceGenerationCompositionDigestV3,
  studioPieceGenerationCompositionsEqualV3,
} from '@/process/services/creative-studio/service/schema2/generation';
import {
  validateStudioFixedShotReviewV2,
  validateStudioFixedShotReviewsV2,
  validateStudioPieceExportManifestV3,
  validateStudioProjectV2,
  validateStudioProjectV3,
  validateStudioProjectV4,
  validateStudioProposedShotV2,
  studioPieceRetryReasonForPredecessorV3,
} from '@/process/services/creative-studio/service/schema2/validation';
import { createEmptyStudioProjectV3 } from '@/process/services/creative-studio/service/schema2/factories';
import { liftStudioCanvasSubjectsToBinV4 } from '@/process/services/creative-studio/service/schema2/mutations/presentationV4';
import { createStudioSpendReceiptV2 } from '@/process/services/creative-studio/service/schema2/pricing';
import { makePhase6Project, PHASE_6_CURRENT_AT } from '../../../../../fixtures/creative-studio/phase6Project';

const timestamp = '2026-08-17T00:00:00.000Z';
const confirmedAt = '2026-08-17T00:00:01.000Z';
const expiresAt = '2026-08-17T00:05:00.000Z';
const digest = 'a'.repeat(64);
const provider = { providerId: 'provider_1', adapterId: 'weprompt-image-v1', model: 'model_1' } as const;
const timestampV3 = '2026-08-30T00:00:00.000Z';
const confirmedAtV3 = '2026-08-30T00:00:01.000Z';
const completedAtV3 = '2026-08-30T00:00:02.000Z';
const retryChainAtV3 = '2026-08-30T00:01:00.000Z';
const expiresAtV3 = '2026-08-30T00:05:00.000Z';

const makeEmptyProjectV3 = (): StudioProjectV3 =>
  createEmptyStudioProjectV3({ name: 'Pilot', brief: 'A quiet portrait' }, 'project_v3', timestampV3);

const addImportedPieceV3 = (project: StudioProjectV3, pieceId: string, handle: string): void => {
  const assetId = `asset_${pieceId}`;
  const asset: StudioAssetV3 = {
    id: assetId,
    projectId: project.id,
    pieceId,
    mediaKind: 'image',
    mimeType: 'image/png',
    managedAsset: { collection: 'imports', fileName: `${assetId}.png` },
    byteSize: 8,
    sha256: digest,
    width: 800,
    height: 600,
    createdAt: completedAtV3,
    origin: 'imported',
    producerJobId: null,
    compositionDigest: null,
  };
  project.pieceOrder.push(pieceId);
  project.pieces[pieceId] = {
    id: pieceId,
    kind: 'photograph',
    handle,
    priorHandles: [],
    currentAssetId: assetId,
    jobIds: [],
    createdAt: confirmedAtV3,
    updatedAt: completedAtV3,
  };
  project.assets[assetId] = asset;
  project.revision += 1;
  project.authoringRevision += 1;
  project.updatedAt = completedAtV3;
};

const makeCompositionV3 = (
  pieceId: string,
  projectRevisionAtPreparation = 1,
  authoringRevision = 1,
  prompt = 'A quiet portrait, soft window light.'
): StudioPieceGenerationCompositionV3 => ({
  inputs: {
    schemaVersion: 3,
    projectRevisionAtPreparation,
    authoringRevision,
    authoringFingerprintVersion: 2,
    authoringFingerprint: digest,
    brief: 'A quiet portrait',
    rules: [],
    source: {
      kind: 'piece',
      pieceId,
      words: 'A quiet portrait',
      settings: { aspectRatio: '4:3', resolution: '1080p' },
    },
    purpose: 'piece_image',
    conditioningInputs: [],
    route: provider,
    instructionProfile: 'weprompt-image-v1.piece-image.v2',
  },
  prompt,
});

const makeGeneratedProjectV3 = (): StudioProjectV3 => {
  const project = makeEmptyProjectV3();
  const pieceId = 'piece_1';
  const jobId = 'job_1';
  const assetId = 'asset_1';
  const composition = makeCompositionV3(pieceId);
  const requestPlan: StudioPieceGenerationRequestPlanV3 = {
    kind: 'resolved',
    snapshot: {
      composition,
      settings: { aspectRatio: '4:3', resolution: '1080p' },
      conditioningInputs: [],
    },
  };
  const target = { kind: 'piece' as const, pieceId };
  const itemId = createStudioPieceQuotedGenerationIdV3({
    projectId: project.id,
    reservationId: 'reservation_1',
    quoteId: 'quote_1',
    quoteRevision: 1,
    target,
    purpose: 'piece_image',
  });
  const quote: StudioPieceSubmissionQuoteV3 = {
    id: 'quote_1',
    reservationId: 'reservation_1',
    quoteRevision: 1,
    projectId: project.id,
    projectRevisionAtPreparation: 1,
    authoringRevision: 1,
    authoringFingerprintVersion: 2,
    authoringFingerprint: digest,
    rateCardDigest: 'b'.repeat(64),
    currency: 'USD',
    item: {
      id: itemId,
      target,
      purpose: 'piece_image',
      routeId: 'route_1',
      generationCount: 1,
      requestPlan,
      rateUnit: 'generation',
      rateMinorUnits: 125,
    },
    lowerMinorUnits: 125,
    upperMinorUnits: 125,
    expiresAt: expiresAtV3,
  };
  const authorization: StudioPieceSpendAuthorizationV3 = {
    id: 'authorization_1',
    quote,
    confirmedAt: confirmedAtV3,
    projectRevisionAtAuthorization: 2,
    cancellationPolicy: 'queued_and_running',
    providerBinding: { itemId, provider },
    idempotencyKey: { itemId, key: 'idempotency_1' },
  };
  const receipt = {
    authorizationId: authorization.id,
    quoteId: quote.id,
    quoteRevision: quote.quoteRevision,
    itemId: quote.item.id,
    jobId,
    purpose: 'piece_image',
    routeId: quote.item.routeId,
    currency: quote.currency,
    rateUnit: 'generation',
    rateMinorUnits: quote.item.rateMinorUnits,
    generationCount: 1,
    totalMinorUnits: quote.item.rateMinorUnits,
    recordedAt: completedAtV3,
  } as const;
  const job: StudioPieceJobV3 = {
    id: jobId,
    projectId: project.id,
    target: { kind: 'piece', pieceId },
    purpose: 'piece_image',
    status: 'succeeded',
    provider,
    idempotencyKey: 'idempotency_1',
    providerSubmissionKind: 'remote',
    providerJobId: 'provider_job_1',
    remoteStartedAt: confirmedAtV3,
    cancellationPolicy: 'queued_and_running',
    outputAssetId: assetId,
    error: null,
    progress: 100,
    retryOfJobId: null,
    retryReason: null,
    duplicateChargeAcknowledged: false,
    duplicateChargeAcknowledgedAt: null,
    authorizationId: authorization.id,
    authorizationItemId: quote.item.id,
    composition,
    requestPlan,
    spendReceipt: receipt,
    authoringRevision: 1,
    authoringFingerprintVersion: 2,
    authoringFingerprint: digest,
    projectRevisionAtPreparation: 1,
    projectRevisionAtAuthorization: 2,
    createdAt: confirmedAtV3,
    updatedAt: completedAtV3,
  };
  const asset: StudioAssetV3 = {
    id: assetId,
    projectId: project.id,
    pieceId,
    mediaKind: 'image',
    mimeType: 'image/png',
    managedAsset: { collection: 'assets', fileName: 'asset_1.png' },
    byteSize: 8,
    sha256: 'c'.repeat(64),
    width: 800,
    height: 600,
    createdAt: completedAtV3,
    origin: 'generated',
    producerJobId: jobId,
    compositionDigest: studioPieceGenerationCompositionDigestV3(composition),
  };
  project.revision = 3;
  project.authoringRevision = 2;
  project.updatedAt = completedAtV3;
  project.pieceOrder = [pieceId];
  project.pieces[pieceId] = {
    id: pieceId,
    kind: 'photograph',
    handle: 'quiet_portrait',
    priorHandles: [],
    currentAssetId: assetId,
    jobIds: [jobId],
    createdAt: confirmedAtV3,
    updatedAt: completedAtV3,
  };
  project.spendAuthorizations = [authorization];
  project.assets[assetId] = asset;
  project.jobs[jobId] = job;
  return project;
};

const makeRetryProjectV3 = (): StudioProjectV3 => {
  const project = makeGeneratedProjectV3();
  const firstJob = project.jobs.job_1!;
  firstJob.status = 'failed';
  firstJob.outputAssetId = null;
  firstJob.error = { code: 'timeout', messageKey: 'timeout' };
  firstJob.progress = null;
  firstJob.spendReceipt = null;
  delete project.assets.asset_1;
  project.pieces.piece_1!.currentAssetId = null;

  const composition = makeCompositionV3('piece_1', 3, 2);
  const requestPlan: StudioPieceGenerationRequestPlanV3 = {
    kind: 'resolved',
    snapshot: {
      composition,
      settings: { aspectRatio: '4:3', resolution: '1080p' },
      conditioningInputs: [],
    },
  };
  const target = { kind: 'piece' as const, pieceId: 'piece_1' };
  const itemId = createStudioPieceQuotedGenerationIdV3({
    projectId: project.id,
    reservationId: 'reservation_2',
    quoteId: 'quote_2',
    quoteRevision: 1,
    target,
    purpose: 'piece_image',
  });
  const quote: StudioPieceSubmissionQuoteV3 = {
    id: 'quote_2',
    reservationId: 'reservation_2',
    quoteRevision: 1,
    projectId: project.id,
    projectRevisionAtPreparation: 3,
    authoringRevision: 2,
    authoringFingerprintVersion: 2,
    authoringFingerprint: digest,
    rateCardDigest: 'b'.repeat(64),
    currency: 'USD',
    item: {
      id: itemId,
      target,
      purpose: 'piece_image',
      routeId: 'route_1',
      generationCount: 1,
      requestPlan,
      rateUnit: 'generation',
      rateMinorUnits: 125,
    },
    lowerMinorUnits: 125,
    upperMinorUnits: 125,
    expiresAt: '2026-08-30T00:06:00.000Z',
  };
  const authorization: StudioPieceSpendAuthorizationV3 = {
    id: 'authorization_2',
    quote,
    confirmedAt: '2026-08-30T00:00:04.000Z',
    projectRevisionAtAuthorization: 4,
    cancellationPolicy: 'queued_and_running',
    providerBinding: { itemId, provider },
    idempotencyKey: { itemId, key: 'idempotency_2' },
  };
  project.jobs.job_2 = {
    id: 'job_2',
    projectId: project.id,
    target: { kind: 'piece', pieceId: 'piece_1' },
    purpose: 'piece_image',
    status: 'queued_local',
    provider,
    idempotencyKey: 'idempotency_2',
    providerSubmissionKind: null,
    providerJobId: null,
    remoteStartedAt: null,
    cancellationPolicy: 'queued_and_running',
    outputAssetId: null,
    error: null,
    progress: null,
    retryOfJobId: 'job_1',
    retryReason: 'provider_failure',
    duplicateChargeAcknowledged: false,
    duplicateChargeAcknowledgedAt: null,
    authorizationId: authorization.id,
    authorizationItemId: quote.item.id,
    composition,
    requestPlan,
    spendReceipt: null,
    authoringRevision: 2,
    authoringFingerprintVersion: 2,
    authoringFingerprint: digest,
    projectRevisionAtPreparation: 3,
    projectRevisionAtAuthorization: 4,
    createdAt: authorization.confirmedAt,
    updatedAt: authorization.confirmedAt,
  };
  project.spendAuthorizations.push(authorization);
  project.pieces.piece_1!.jobIds.push('job_2');
  project.pieces.piece_1!.updatedAt = authorization.confirmedAt;
  project.revision = 4;
  project.updatedAt = authorization.confirmedAt;
  return project;
};

const extendRetryChainV3 = (project: StudioProjectV3, totalJobs: number): void => {
  for (let index = project.pieces.piece_1!.jobIds.length + 1; index <= totalJobs; index += 1) {
    const predecessorId = `job_${index - 1}`;
    const predecessor = project.jobs[predecessorId]!;
    predecessor.status = 'failed';
    predecessor.error = { code: 'timeout', messageKey: 'timeout' };
    predecessor.progress = null;
    predecessor.providerSubmissionKind = null;
    predecessor.providerJobId = null;
    predecessor.remoteStartedAt = null;
    predecessor.spendReceipt = null;
    predecessor.updatedAt = retryChainAtV3;

    const projectRevisionAtPreparation = project.revision + 1;
    const projectRevisionAtAuthorization = projectRevisionAtPreparation + 1;
    const jobId = `job_${index}`;
    const reservationId = `reservation_${index}`;
    const quoteId = `quote_${index}`;
    const authorizationId = `authorization_${index}`;
    const idempotencyKey = `idempotency_${index}`;
    const target = { kind: 'piece' as const, pieceId: 'piece_1' };
    const composition = makeCompositionV3('piece_1', projectRevisionAtPreparation, 2);
    const requestPlan: StudioPieceGenerationRequestPlanV3 = {
      kind: 'resolved',
      snapshot: {
        composition,
        settings: { aspectRatio: '4:3', resolution: '1080p' },
        conditioningInputs: [],
      },
    };
    const itemId = createStudioPieceQuotedGenerationIdV3({
      projectId: project.id,
      reservationId,
      quoteId,
      quoteRevision: 1,
      target,
      purpose: 'piece_image',
    });
    const quote: StudioPieceSubmissionQuoteV3 = {
      id: quoteId,
      reservationId,
      quoteRevision: 1,
      projectId: project.id,
      projectRevisionAtPreparation,
      authoringRevision: 2,
      authoringFingerprintVersion: 2,
      authoringFingerprint: digest,
      rateCardDigest: 'b'.repeat(64),
      currency: 'USD',
      item: {
        id: itemId,
        target,
        purpose: 'piece_image',
        routeId: 'route_1',
        generationCount: 1,
        requestPlan,
        rateUnit: 'generation',
        rateMinorUnits: 125,
      },
      lowerMinorUnits: 125,
      upperMinorUnits: 125,
      expiresAt: expiresAtV3,
    };
    const authorization: StudioPieceSpendAuthorizationV3 = {
      id: authorizationId,
      quote,
      confirmedAt: retryChainAtV3,
      projectRevisionAtAuthorization,
      cancellationPolicy: 'queued_and_running',
      providerBinding: { itemId, provider },
      idempotencyKey: { itemId, key: idempotencyKey },
    };
    project.spendAuthorizations.push(authorization);
    project.jobs[jobId] = {
      id: jobId,
      projectId: project.id,
      target,
      purpose: 'piece_image',
      status: 'queued_local',
      provider,
      idempotencyKey,
      providerSubmissionKind: null,
      providerJobId: null,
      remoteStartedAt: null,
      cancellationPolicy: 'queued_and_running',
      outputAssetId: null,
      error: null,
      progress: null,
      retryOfJobId: predecessorId,
      retryReason: 'provider_failure',
      duplicateChargeAcknowledged: false,
      duplicateChargeAcknowledgedAt: null,
      authorizationId,
      authorizationItemId: itemId,
      composition,
      requestPlan,
      spendReceipt: null,
      authoringRevision: 2,
      authoringFingerprintVersion: 2,
      authoringFingerprint: digest,
      projectRevisionAtPreparation,
      projectRevisionAtAuthorization,
      createdAt: retryChainAtV3,
      updatedAt: retryChainAtV3,
    };
    project.pieces.piece_1!.jobIds.push(jobId);
    project.pieces.piece_1!.updatedAt = retryChainAtV3;
    project.revision = projectRevisionAtAuthorization;
    project.updatedAt = retryChainAtV3;
  }
};

const reorderCompositionKeysV3 = (
  composition: StudioPieceGenerationCompositionV3
): StudioPieceGenerationCompositionV3 => ({
  prompt: composition.prompt,
  inputs: {
    instructionProfile: composition.inputs.instructionProfile,
    route: {
      model: composition.inputs.route.model,
      adapterId: composition.inputs.route.adapterId,
      providerId: composition.inputs.route.providerId,
    },
    conditioningInputs: [],
    purpose: composition.inputs.purpose,
    source: {
      settings: {
        resolution: composition.inputs.source.settings.resolution,
        aspectRatio: composition.inputs.source.settings.aspectRatio,
      },
      words: composition.inputs.source.words,
      pieceId: composition.inputs.source.pieceId,
      kind: composition.inputs.source.kind,
    },
    rules: structuredClone(composition.inputs.rules),
    brief: composition.inputs.brief,
    authoringFingerprint: composition.inputs.authoringFingerprint,
    authoringFingerprintVersion: composition.inputs.authoringFingerprintVersion,
    authoringRevision: composition.inputs.authoringRevision,
    projectRevisionAtPreparation: composition.inputs.projectRevisionAtPreparation,
    schemaVersion: composition.inputs.schemaVersion,
  },
});

const makeGeneratedProjectWithJobStatusV3 = (status: StudioPieceJobV3['status']): StudioProjectV3 => {
  const project = makeGeneratedProjectV3();
  if (status === 'succeeded') return project;

  const job = project.jobs.job_1!;
  job.status = status;
  job.outputAssetId = null;
  job.spendReceipt = null;
  job.progress = status === 'running' ? 50 : null;
  job.error =
    status === 'failed'
      ? { code: 'timeout', messageKey: 'timeout' }
      : status === 'needs_attention'
        ? { code: 'submission_unknown', messageKey: 'submission_unknown' }
        : null;
  if (status === 'queued_local' || status === 'submitting') {
    job.providerSubmissionKind = null;
    job.providerJobId = null;
    job.remoteStartedAt = null;
  }
  if (status === 'needs_attention') {
    job.providerSubmissionKind = null;
    job.providerJobId = null;
    job.remoteStartedAt = null;
  }
  delete project.assets.asset_1;
  project.pieces.piece_1!.currentAssetId = null;
  return project;
};

const makePhase6GeneratedProjectWithJobStatus = (status: StudioPieceJobV3['status']): StudioProjectV4 => {
  const project = makeGeneratedProjectWithJobStatusV3(status);
  const scaffold = makePhase6Project();
  return {
    ...project,
    schemaVersion: 7,
    pieces: Object.fromEntries(
      Object.entries(project.pieces).map(([pieceId, piece]) => [pieceId, { ...piece, runStem: null }])
    ),
    boardOrder: [...scaffold.boardOrder],
    boards: structuredClone(scaffold.boards),
    assemblyOrder: [],
    assemblies: {},
    bin: [],
    updatedAt: PHASE_6_CURRENT_AT,
  };
};

const makeShot = (id: string, overrides: Partial<StudioShot> = {}): StudioShot => ({
  id,
  shootingScript: '',
  durationSeconds: 8,
  trimInSeconds: null,
  trimOutSeconds: null,
  chainBreak: 'none',
  referenceBinding: { status: 'unassigned', characterReferenceIds: [], backgroundReferenceId: null },
  seedStillId: null,
  dismissedSeedStillIds: [],
  boardAssetId: null,
  supersededBoardAssetIds: [],
  videoAssetId: null,
  supersededVideoAssetIds: [],
  assetIds: [],
  jobIds: [],
  ...overrides,
});

const makeBeat = (id: string, shotOrder: string[] = [], overrides: Partial<StudioBeat> = {}): StudioBeat => ({
  id,
  title: '',
  story: '',
  targetSeconds: null,
  shotOrder,
  ...overrides,
});

const makeProject = (projectId = 'project_1'): StudioProjectV2 => ({
  schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
  revision: 1,
  id: projectId,
  name: `Project ${projectId}`,
  brief: '',
  rules: [],
  briefConversationId: null,
  aspectRatio: '16:9',
  targetDurationSeconds: 30,
  resolution: '1080p',
  boardStyle: null,
  beatOrder: ['beat_1'],
  beats: { beat_1: makeBeat('beat_1', ['shot_1']) },
  shots: { shot_1: makeShot('shot_1') },
  referencePlanStatus: 'unplanned',
  referenceOrder: [],
  references: {},
  bin: [],
  bedAssetId: null,
  spendPolicy: null,
  spendAuthorizations: [],
  frameExtractions: {},
  undoHistory: [],
  imageRouteId: null,
  videoRouteId: null,
  assets: {},
  jobs: {},
  createdAt: timestamp,
  updatedAt: timestamp,
});

const makeImageAsset = (
  id: string,
  shotId: string | null,
  collection: StudioAssetV2['managedAsset']['collection'] = 'assets',
  overrides: Partial<StudioAssetV2> = {}
): StudioAssetV2 => ({
  id,
  projectId: 'project_1',
  shotId,
  mediaKind: 'image',
  mimeType: 'image/png',
  managedAsset: { collection, fileName: `${id}.png` },
  byteSize: 1,
  sha256: digest,
  projectReferenceId: null,
  generationReferenceAssetIds: [],
  producerJobId: null,
  compositionDigest: null,
  createdAt: timestamp,
  ...overrides,
});

const makeVideoAsset = (id: string, shotId: string | null = 'shot_1', durationSeconds = 10): StudioAssetV2 => ({
  id,
  projectId: 'project_1',
  shotId,
  mediaKind: 'video',
  mimeType: 'video/mp4',
  managedAsset: { collection: 'assets', fileName: `${id}.mp4` },
  byteSize: 1,
  sha256: digest,
  projectReferenceId: null,
  generationReferenceAssetIds: [],
  producerJobId: null,
  compositionDigest: null,
  durationSeconds,
  createdAt: timestamp,
});

const makeAudioAsset = (id: string, shotId: string | null = null): StudioAssetV2 => ({
  id,
  projectId: 'project_1',
  shotId,
  mediaKind: 'audio',
  mimeType: 'audio/wav',
  managedAsset: { collection: 'imports', fileName: `${id}.wav` },
  byteSize: 1,
  sha256: digest,
  projectReferenceId: null,
  generationReferenceAssetIds: [],
  producerJobId: null,
  compositionDigest: null,
  durationSeconds: 30,
  createdAt: timestamp,
});

const seedPlan = (
  referenceSnapshot: StudioGenerationReferenceInputSnapshot | null = null
): StudioGenerationRequestPlan => ({
  kind: 'resolved',
  snapshot: {
    composition: null as never,
    aspectRatio: '16:9',
    resolution: '1080p',
    durationSeconds: 8,
    referenceInputs: referenceSnapshot === null ? [] : [referenceSnapshot],
    conditioningInput: null,
  },
});

const boardPlan = (): StudioGenerationRequestPlan => ({
  kind: 'resolved',
  snapshot: {
    composition: null as never,
    aspectRatio: '16:9',
    resolution: '1080p',
    durationSeconds: 4,
    referenceInputs: [],
    conditioningInput: null,
  },
});

const referencedBoardPlan = (): StudioGenerationRequestPlan => {
  const plan = boardPlan();
  if (plan.kind !== 'resolved') throw new Error('expected resolved Board plan');
  plan.snapshot.referenceInputs = [
    { referenceId: 'ref_character', kind: 'character', assetId: 'reference_1', sha256: digest },
  ];
  return plan;
};

const conditionedBoardPlan = (): StudioGenerationRequestPlan => {
  const plan = boardPlan();
  if (plan.kind !== 'resolved') throw new Error('expected resolved Board plan');
  plan.snapshot.conditioningInput = { kind: 'seed_still', assetId: 'seed_1' };
  return plan;
};

const deferredBoardPlan = (): StudioGenerationRequestPlan => ({
  kind: 'after_take_selection',
  template: {
    composition: null as never,
    aspectRatio: '16:9',
    resolution: '1080p',
    durationSeconds: 8,
    referenceInputs: [],
  },
  dependency: { kind: 'authorized_seed', upstreamItemId: 'seed_item_1', shotId: 'shot_1' },
});

const videoPlan = (conditioningInput: StudioConditioningInputSnapshot): StudioGenerationRequestPlan => ({
  kind: 'resolved',
  snapshot: {
    composition: null as never,
    aspectRatio: '16:9',
    resolution: '1080p',
    durationSeconds: 8,
    referenceInputs: [],
    conditioningInput,
  },
});

const deferredVideoPlan = (upstreamItemId: string, predecessorShotId: string): StudioGenerationRequestPlan => ({
  kind: 'after_take_selection',
  template: {
    composition: null as never,
    aspectRatio: '16:9',
    resolution: '1080p',
    durationSeconds: 8,
    referenceInputs: [],
  },
  dependency: {
    kind: 'authorized_predecessor',
    upstreamItemId,
    predecessorShotId,
  },
});

const makeItem = (
  projectRevision: number,
  shotId: string,
  purpose: StudioQuotedGeneration['purpose'],
  requestPlan: StudioGenerationRequestPlan,
  generationCount = 1,
  projectId = 'project_1',
  targetOverride?: StudioGenerationTargetV2
): StudioQuotedGeneration => {
  const target = targetOverride ?? { kind: 'shot' as const, shotId };
  const referenceInputs =
    requestPlan.kind === 'resolved' ? requestPlan.snapshot.referenceInputs : requestPlan.template.referenceInputs;
  const source =
    target.kind === 'shot'
      ? {
          kind: 'shot' as const,
          beatId: 'beat_1',
          story: 'Story',
          shotId: target.shotId,
          shootingScript: 'Shooting script',
        }
      : {
          kind: 'project_reference' as const,
          referenceId: target.referenceId,
          referenceKind: target.referenceId.includes('character') ? ('character' as const) : ('background' as const),
          prompt: 'Reference description',
        };
  const composition = composeStudioGenerationV2({
    projectRevision,
    brief: 'Brief',
    rules: [],
    source,
    purpose,
    referenceInputs,
    aspectRatio: '16:9',
    resolution: '1080p',
    route: provider,
    boardStyle: purpose === 'board_still' ? 'grey_tone' : null,
    instructionProfile: deriveStudioInstructionProfileV2(provider, purpose, source),
  });
  if (requestPlan.kind === 'resolved') requestPlan.snapshot.composition = composition;
  else requestPlan.template.composition = composition;
  return {
    id: createStudioQuotedGenerationId({ projectId, projectRevision, target, purpose }),
    target,
    purpose,
    routeId: purpose === 'video_take' ? 'video_route' : 'image_route',
    generationCount,
    requestPlan,
    rateUnit: purpose === 'video_take' ? 'second' : 'generation',
    rateMinorUnits: 2,
  };
};

const makeAuthorization = (
  id: string,
  projectRevision: number,
  baseItems: StudioQuotedGeneration[],
  cascadeItems: StudioQuotedGeneration[] = [],
  projectId = 'project_1'
): StudioSpendAuthorization => {
  const items = [...baseItems, ...cascadeItems];
  const totals = calculateStudioQuoteTotals(items)!;
  return {
    id,
    projectId,
    projectRevision,
    originReferenceHandoffId: null,
    rateCardDigest: 'b'.repeat(64),
    currency: 'USD',
    baseItems,
    cascadeItems,
    lowerMinorUnits: totals.lowerMinorUnits,
    upperMinorUnits: totals.upperMinorUnits,
    expiresAt,
    confirmedAt,
    providerBindings: items.map((item) => ({ itemId: item.id, provider })),
    idempotencyKeys: items.flatMap((item) =>
      Array.from({ length: item.generationCount }, (_, attemptIndex) => ({
        itemId: item.id,
        key: `idem_${id}_${item.id}${attemptIndex === 0 ? '' : `_attempt_${attemptIndex + 1}`}`,
      }))
    ),
  };
};

const makeJob = (
  id: string,
  authorization: StudioSpendAuthorization,
  item: StudioQuotedGeneration,
  overrides: Partial<StudioJobV2> = {}
): StudioJobV2 => ({
  id,
  projectId: authorization.projectId,
  target: structuredClone(item.target),
  status: item.requestPlan.kind === 'resolved' ? 'queued_local' : 'waiting_for_conditioning',
  provider,
  idempotencyKey: authorization.idempotencyKeys.find((entry) => entry.itemId === item.id)!.key,
  providerJobId: null,
  cancellationPolicy: 'queued_and_running',
  outputAssetIds: [],
  error: null,
  retryOfJobId: null,
  retryReason: null,
  duplicateChargeAcknowledged: false,
  duplicateChargeAcknowledgedAt: null,
  createdAt: timestamp,
  updatedAt: timestamp,
  purpose: item.purpose,
  authorizationId: authorization.id,
  authorizationItemId: item.id,
  composition:
    item.requestPlan.kind === 'resolved'
      ? item.requestPlan.snapshot.composition
      : item.requestPlan.template.composition,
  requestPlan: item.requestPlan,
  requestSnapshot: item.requestPlan.kind === 'resolved' ? item.requestPlan.snapshot : null,
  spendReceipt: null,
  outputAssetIdsByRole: { primary: null, poster: null },
  ...overrides,
});

const addAuthorizationWithJobs = (
  project: StudioProjectV2,
  authorization: StudioSpendAuthorization,
  jobs: StudioJobV2[]
): void => {
  project.revision = Math.max(project.revision, authorization.projectRevision + 1);
  project.spendAuthorizations.push(authorization);
  for (const job of jobs) {
    project.jobs[job.id] = job;
    if (job.target.kind === 'shot') project.shots[job.target.shotId]!.jobIds.push(job.id);
    else project.references[job.target.referenceId]!.jobIds.push(job.id);
  }
};

const addFailedSeedAuthorization = (
  project: StudioProjectV2,
  authorizationId: string,
  originReferenceHandoffId: string | null,
  retryOfJobId: string | null = null
): StudioJobV2 => {
  const item = makeItem(project.revision, 'shot_1', 'seed_still', seedPlan(), 1, project.id);
  const authorization = makeAuthorization(authorizationId, project.revision, [item], [], project.id);
  authorization.originReferenceHandoffId = originReferenceHandoffId;
  const job = makeJob(`job_${authorizationId}`, authorization, item, {
    status: 'failed',
    error: { code: 'timeout', messageKey: 'timeout' },
    retryOfJobId,
    retryReason: retryOfJobId === null ? null : 'provider_failure',
  });
  addAuthorizationWithJobs(project, authorization, [job]);
  return job;
};

const addProjectReferenceRetryLineage = (
  project: StudioProjectV2,
  predecessorOverrides: Partial<StudioJobV2>,
  retryOverrides: Partial<StudioJobV2>
): { predecessor: StudioJobV2; retry: StudioJobV2 } => {
  const referenceId = 'ref_background';
  project.referencePlanStatus = 'planned';
  project.referenceOrder = [referenceId];
  project.references[referenceId] = {
    id: referenceId,
    kind: 'background',
    label: 'City skyline',
    prompt: 'A recurring city skyline.',
    approvedAssetId: null,
    supersededAssetIds: [],
    jobIds: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  const predecessorRevision = project.revision;
  const predecessorItem = makeItem(predecessorRevision, 'shot_1', 'reference_image', seedPlan(), 1, project.id, {
    kind: 'reference',
    referenceId,
  });
  const predecessorAuthorization = makeAuthorization(
    'auth_reference_predecessor',
    predecessorRevision,
    [predecessorItem],
    [],
    project.id
  );
  const predecessor = makeJob('job_reference_predecessor', predecessorAuthorization, predecessorItem, {
    ...predecessorOverrides,
  });
  addAuthorizationWithJobs(project, predecessorAuthorization, [predecessor]);

  const retryRevision = project.revision;
  const retryItem = makeItem(retryRevision, 'shot_1', 'reference_image', seedPlan(), 1, project.id, {
    kind: 'reference',
    referenceId,
  });
  const retryAuthorization = makeAuthorization('auth_reference_retry', retryRevision, [retryItem], [], project.id);
  const retry = makeJob('job_reference_retry', retryAuthorization, retryItem, {
    retryOfJobId: predecessor.id,
    ...retryOverrides,
  });
  addAuthorizationWithJobs(project, retryAuthorization, [retry]);
  return { predecessor, retry };
};

const addHumanSeed = (project: StudioProjectV2, shotId = 'shot_1', assetId = 'seed_1'): StudioAssetV2 => {
  const asset = makeImageAsset(assetId, shotId, 'imports');
  project.assets[assetId] = asset;
  project.shots[shotId]!.assetIds.push(assetId);
  return asset;
};

const addApprovedProjectReference = (
  project: StudioProjectV2,
  referenceId = 'ref_character',
  assetId = 'reference_1'
): StudioAssetV2 => {
  project.referencePlanStatus = 'planned';
  if (!project.references[referenceId]) {
    project.referenceOrder.push(referenceId);
    project.references[referenceId] = {
      id: referenceId,
      kind: referenceId.includes('character') ? 'character' : 'background',
      label: referenceId.includes('character') ? 'Character' : 'Background',
      prompt: 'Canonical reference description.',
      approvedAssetId: null,
      supersededAssetIds: [],
      jobIds: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  }
  const reference = project.references[referenceId]!;
  const item = makeItem(project.revision, 'shot_1', 'reference_image', seedPlan(), 1, project.id, {
    kind: 'reference',
    referenceId,
  });
  const authorization = makeAuthorization(`auth_${assetId}`, project.revision, [item], [], project.id);
  const jobId = `job_${assetId}`;
  const composition = item.requestPlan.kind === 'resolved' ? item.requestPlan.snapshot.composition : null;
  if (composition === null) throw new Error('expected resolved reference composition');
  const asset = makeImageAsset(assetId, null, 'assets', {
    projectId: project.id,
    projectReferenceId: referenceId,
    producerJobId: jobId,
    compositionDigest: studioGenerationCompositionDigestV2(composition),
  });
  project.assets[asset.id] = asset;
  const job = makeJob(jobId, authorization, item, {
    status: 'succeeded',
    providerJobId: `remote_${assetId}`,
    remoteStartedAt: timestamp,
    outputAssetIds: [asset.id],
    outputAssetIdsByRole: { primary: asset.id, poster: null },
    spendReceipt: {
      authorizationId: authorization.id,
      itemId: item.id,
      jobId,
      purpose: item.purpose,
      routeId: item.routeId,
      currency: authorization.currency,
      rateUnit: item.rateUnit,
      rateMinorUnits: item.rateMinorUnits,
      durationSeconds: null,
      generationCount: 1,
      totalMinorUnits: item.rateMinorUnits,
    },
  });
  addAuthorizationWithJobs(project, authorization, [job]);
  if (reference.approvedAssetId !== null) reference.supersededAssetIds.push(reference.approvedAssetId);
  reference.approvedAssetId = asset.id;
  return asset;
};

const addSucceededVideoTake = (project: StudioProjectV2, shotId = 'shot_1', assetId = 'take_1'): StudioAssetV2 => {
  const shot = project.shots[shotId]!;
  const seedId = `seed_${shotId}`;
  const seed = project.assets[seedId] ?? addHumanSeed(project, shotId, seedId);
  shot.seedStillId = seed.id;
  const projectRevision = project.revision;
  const item = makeItem(projectRevision, shotId, 'video_take', videoPlan({ kind: 'seed_still', assetId: seed.id }));
  const authorization = makeAuthorization(`auth_${projectRevision}`, projectRevision, [item]);
  const jobId = `job_${projectRevision}`;
  const composition = item.requestPlan.kind === 'resolved' ? item.requestPlan.snapshot.composition : null;
  if (composition === null) throw new Error('expected resolved video composition');
  const asset = makeVideoAsset(assetId, shotId);
  asset.producerJobId = jobId;
  asset.compositionDigest = studioGenerationCompositionDigestV2(composition);
  project.assets[asset.id] = asset;
  shot.assetIds.push(asset.id);
  const job = makeJob(jobId, authorization, item, {
    status: 'succeeded',
    providerJobId: `remote_${projectRevision}`,
    remoteStartedAt: timestamp,
    outputAssetIds: [asset.id],
    outputAssetIdsByRole: { primary: asset.id, poster: null },
    spendReceipt: {
      authorizationId: authorization.id,
      itemId: item.id,
      jobId,
      purpose: item.purpose,
      routeId: item.routeId,
      currency: authorization.currency,
      rateUnit: item.rateUnit,
      rateMinorUnits: item.rateMinorUnits,
      durationSeconds: 8,
      generationCount: 1,
      totalMinorUnits: 16,
    },
  });
  addAuthorizationWithJobs(project, authorization, [job]);
  if (shot.videoAssetId !== null) shot.supersededVideoAssetIds.push(shot.videoAssetId);
  shot.videoAssetId = asset.id;
  return asset;
};

const addSucceededBoardStill = (project: StudioProjectV2, shotId = 'shot_1', assetId = 'board_1'): StudioAssetV2 => {
  const shot = project.shots[shotId]!;
  project.boardStyle ??= 'grey_tone';
  const projectRevision = project.revision;
  const item = makeItem(projectRevision, shotId, 'board_still', boardPlan(), 1, project.id);
  const authorization = makeAuthorization(`auth_board_${projectRevision}`, projectRevision, [item], [], project.id);
  const jobId = `job_board_${projectRevision}`;
  const composition = item.requestPlan.kind === 'resolved' ? item.requestPlan.snapshot.composition : null;
  if (composition === null) throw new Error('expected resolved Board composition');
  const asset = makeImageAsset(assetId, shotId, 'boardStills', {
    projectId: project.id,
    producerJobId: jobId,
    compositionDigest: studioGenerationCompositionDigestV2(composition),
  });
  project.assets[asset.id] = asset;
  shot.assetIds.push(asset.id);
  const job = makeJob(jobId, authorization, item, {
    status: 'succeeded',
    providerJobId: `remote_board_${projectRevision}`,
    remoteStartedAt: timestamp,
    outputAssetIds: [asset.id],
    outputAssetIdsByRole: { primary: asset.id, poster: null },
    spendReceipt: {
      authorizationId: authorization.id,
      itemId: item.id,
      jobId,
      purpose: item.purpose,
      routeId: item.routeId,
      currency: authorization.currency,
      rateUnit: item.rateUnit,
      rateMinorUnits: item.rateMinorUnits,
      durationSeconds: null,
      generationCount: 1,
      totalMinorUnits: item.rateMinorUnits,
    },
  });
  addAuthorizationWithJobs(project, authorization, [job]);
  if (shot.boardAssetId !== null) shot.supersededBoardAssetIds.push(shot.boardAssetId);
  shot.boardAssetId = asset.id;
  return asset;
};

const addFailedBoardRedraw = (project: StudioProjectV2, shotId = 'shot_1'): StudioJobV2 => {
  const projectRevision = project.revision;
  const item = makeItem(projectRevision, shotId, 'board_still', boardPlan(), 1, project.id);
  const authorization = makeAuthorization(`auth_board_${projectRevision}`, projectRevision, [item], [], project.id);
  const job = makeJob(`job_board_${projectRevision}`, authorization, item, {
    status: 'failed',
    error: { code: 'timeout', messageKey: 'timeout' },
  });
  addAuthorizationWithJobs(project, authorization, [job]);
  return job;
};

const addFailedAuthorizationGraph = (
  project: StudioProjectV2,
  baseItems: StudioQuotedGeneration[],
  cascadeItems: StudioQuotedGeneration[] = [],
  originReferenceHandoffId: string | null = null
): void => {
  const authorization = makeAuthorization(
    `auth_hostile_${project.revision}`,
    project.revision,
    baseItems,
    cascadeItems,
    project.id
  );
  authorization.originReferenceHandoffId = originReferenceHandoffId;
  const jobs = [...baseItems, ...cascadeItems].map((item, index) =>
    makeJob(`job_hostile_${index + 1}`, authorization, item, {
      status: 'failed',
      error: { code: 'timeout', messageKey: 'timeout' },
    })
  );
  addAuthorizationWithJobs(project, authorization, jobs);
};

const addReadyFrame = (project: StudioProjectV2, takeId = 'take_1', endpointSeconds = 10): string => {
  const frameId = createStudioFrameExtractionId({ shotId: 'shot_1', videoAssetId: takeId, endpointSeconds });
  const frameAssetId = `frame_asset_${endpointSeconds}`;
  project.assets[frameAssetId] = makeImageAsset(frameAssetId, 'shot_1', 'conditioningFrames');
  project.shots.shot_1!.assetIds.push(frameAssetId);
  project.frameExtractions[frameId] = {
    id: frameId,
    shotId: 'shot_1',
    videoAssetId: takeId,
    endpointSeconds,
    frameAssetId,
    status: 'ready',
    errorCode: null,
    attemptCount: 1,
  };
  return frameAssetId;
};

const makeWaitingDependencyProject = (): StudioProjectV2 => {
  const project = makeProject();
  project.beats.beat_1!.shotOrder.push('shot_2');
  project.shots.shot_2 = makeShot('shot_2');
  addHumanSeed(project);
  const upstream = makeItem(1, 'shot_1', 'video_take', videoPlan({ kind: 'seed_still', assetId: 'seed_1' }), 1);
  const dependent = makeItem(1, 'shot_2', 'video_take', deferredVideoPlan(upstream.id, 'shot_1'));
  const authorization = makeAuthorization('auth_waiting_take', 1, [upstream], [dependent]);
  const asset = makeVideoAsset('take_1');
  if (upstream.requestPlan.kind !== 'resolved') throw new Error('expected resolved upstream');
  asset.producerJobId = 'job_upstream';
  asset.compositionDigest = studioGenerationCompositionDigestV2(upstream.requestPlan.snapshot.composition);
  project.assets[asset.id] = asset;
  project.shots.shot_1!.assetIds.push(asset.id);
  const upstreamJob = makeJob('job_upstream', authorization, upstream, {
    status: 'succeeded',
    providerJobId: 'remote_upstream',
    remoteStartedAt: timestamp,
    outputAssetIds: [asset.id],
    outputAssetIdsByRole: { primary: asset.id, poster: null },
    spendReceipt: {
      authorizationId: authorization.id,
      itemId: upstream.id,
      jobId: 'job_upstream',
      purpose: upstream.purpose,
      routeId: upstream.routeId,
      currency: authorization.currency,
      rateUnit: upstream.rateUnit,
      rateMinorUnits: upstream.rateMinorUnits,
      durationSeconds: 8,
      generationCount: 1,
      totalMinorUnits: 16,
    },
  });
  addAuthorizationWithJobs(project, authorization, [upstreamJob, makeJob('job_dependent', authorization, dependent)]);
  project.shots.shot_1!.videoAssetId = asset.id;
  return project;
};

const addShots = (project: StudioProjectV2, beatId: string, count: number, offset = 0): void => {
  const beat = project.beats[beatId]!;
  for (let index = 0; index < count; index += 1) {
    const shotId = `shot_${offset + index + 1}`;
    beat.shotOrder.push(shotId);
    project.shots[shotId] = makeShot(shotId);
  }
};

describe('validateStudioProjectV2 exact project and authorship contract', () => {
  it('accepts only the exact current-schema Board shape and leaves schema 3 unsupported', () => {
    const legacy = structuredClone(makeProject()) as unknown as Record<string, unknown>;
    legacy.schemaVersion = 3;
    delete legacy.boardStyle;
    const legacyShots = legacy.shots as Record<string, Record<string, unknown>>;
    delete legacyShots.shot_1!.boardAssetId;
    delete legacyShots.shot_1!.supersededBoardAssetIds;
    expect(validateStudioProjectV2(legacy)).toBe(false);
    expect(validateStudioProjectV2(makeProject())).toBe(true);
  });

  it('accepts only the three exact Board styles', () => {
    for (const style of ['grey_tone', 'line_art', 'colour_key'] as const) {
      const project = makeProject();
      project.boardStyle = style;
      expect(validateStudioProjectV2(project)).toBe(true);
    }
    const project = makeProject();
    (project as unknown as { boardStyle: string | null }).boardStyle = 'watercolour';
    expect(validateStudioProjectV2(project)).toBe(false);
  });

  it('accepts the minimal project and an empty-coverage Beat with null or authored target', () => {
    const project = makeProject();
    project.beats.beat_1!.shotOrder = [];
    project.shots = {};
    expect(validateStudioProjectV2(project)).toBe(true);
    project.beats.beat_1!.targetSeconds = 180;
    expect(validateStudioProjectV2(project)).toBe(true);
  });

  it.each([
    ['project', (project: StudioProjectV2) => Object.assign(project, { unexpected: true })],
    ['legacy Match To field', (project: StudioProjectV2) => Object.assign(project, { matchToShotId: null })],
    ['Beat', (project: StudioProjectV2) => Object.assign(project.beats.beat_1!, { unexpected: true })],
    ['Shot', (project: StudioProjectV2) => Object.assign(project.shots.shot_1!, { unexpected: true })],
    [
      'Bin item',
      (project: StudioProjectV2) => {
        project.beatOrder = [];
        project.bin = [{ kind: 'beat', beatId: 'beat_1', reason: 'lifted', unexpected: true } as never];
      },
    ],
  ])('rejects unknown keys on the %s', (_label, mutate) => {
    const project = makeProject();
    mutate(project);
    expect(validateStudioProjectV2(project)).toBe(false);
  });

  it('accepts target duration 1440 and rejects 1441', () => {
    const project = makeProject();
    project.targetDurationSeconds = 1440;
    expect(validateStudioProjectV2(project)).toBe(true);
    project.targetDurationSeconds = 1441;
    expect(validateStudioProjectV2(project)).toBe(false);
  });

  it('accepts Story and Shooting script at their exact bounds and rejects overflow', () => {
    const project = makeProject();
    project.beats.beat_1!.story = 's'.repeat(STUDIO_MAX_STORY_LENGTH);
    project.shots.shot_1!.shootingScript = 'x'.repeat(STUDIO_MAX_SHOOTING_SCRIPT_LENGTH);
    expect(validateStudioProjectV2(project)).toBe(true);
    project.beats.beat_1!.story += 's';
    expect(validateStudioProjectV2(project)).toBe(false);
    project.beats.beat_1!.story = '';
    project.shots.shot_1!.shootingScript += 'x';
    expect(validateStudioProjectV2(project)).toBe(false);
  });

  it.each([
    ['Action', (project: StudioProjectV2) => Object.assign(project.beats.beat_1!, { action: '' })],
    ['Look', (project: StudioProjectV2) => Object.assign(project.beats.beat_1!, { look: '' })],
    ['Line', (project: StudioProjectV2) => Object.assign(project.shots.shot_1!, { line: '' })],
    ['Narration', (project: StudioProjectV2) => Object.assign(project.shots.shot_1!, { narration: '' })],
    ['on-screen text', (project: StudioProjectV2) => Object.assign(project.shots.shot_1!, { onScreenText: '' })],
    ['derivation', (project: StudioProjectV2) => Object.assign(project.shots.shot_1!, { derivation: 'derived' })],
  ])('rejects the retired %s authoring field', (_label, mutate) => {
    const project = makeProject();
    mutate(project);
    expect(validateStudioProjectV2(project)).toBe(false);
  });

  it('rejects an explicit seed pin on a non-heading Shot', () => {
    const project = makeProject();
    project.beats.beat_1!.shotOrder.push('shot_2');
    project.shots.shot_2 = makeShot('shot_2');
    project.shots.shot_2!.seedStillId = addHumanSeed(project, 'shot_2', 'seed_2').id;
    expect(validateStudioProjectV2(project)).toBe(false);
  });
});

describe('validateStudioProjectV2 total ownership and capacities', () => {
  it('accepts 24 total Beats and rejects 25', () => {
    const project = makeProject();
    project.beatOrder = [];
    project.beats = {};
    project.shots = {};
    for (let index = 1; index <= STUDIO_MAX_BEATS; index += 1) {
      const beatId = `beat_${index}`;
      project.beats[beatId] = makeBeat(beatId);
      project.beatOrder.push(beatId);
    }
    expect(validateStudioProjectV2(project)).toBe(true);
    project.beats.beat_25 = makeBeat('beat_25');
    project.beatOrder.push('beat_25');
    expect(validateStudioProjectV2(project)).toBe(false);
  });

  it('accepts 8 active Shots per Beat and rejects 9', () => {
    const project = makeProject();
    project.beats.beat_1!.shotOrder = [];
    project.shots = {};
    addShots(project, 'beat_1', STUDIO_MAX_SHOTS_PER_BEAT);
    expect(validateStudioProjectV2(project)).toBe(true);
    addShots(project, 'beat_1', 1, STUDIO_MAX_SHOTS_PER_BEAT);
    expect(validateStudioProjectV2(project)).toBe(false);
  });

  it('accepts 96 total active Shots and rejects 97', () => {
    const project = makeProject();
    project.beatOrder = [];
    project.beats = {};
    project.shots = {};
    for (let beatIndex = 0; beatIndex < 12; beatIndex += 1) {
      const beatId = `beat_${beatIndex + 1}`;
      project.beatOrder.push(beatId);
      project.beats[beatId] = makeBeat(beatId);
      addShots(project, beatId, 8, beatIndex * 8);
    }
    expect(validateStudioProjectV2(project)).toBe(true);
    project.beatOrder.push('beat_13');
    project.beats.beat_13 = makeBeat('beat_13');
    addShots(project, 'beat_13', 1, STUDIO_MAX_SHOTS_PER_PROJECT);
    expect(validateStudioProjectV2(project)).toBe(false);
  });

  it('enforces the Beat Bin maximum at N and N+1', () => {
    const project = makeProject();
    project.beatOrder = [];
    project.beats = {};
    project.shots = {};
    for (let index = 1; index <= STUDIO_MAX_BIN_BEAT_ITEMS; index += 1) {
      const beatId = `beat_${index}`;
      project.beats[beatId] = makeBeat(beatId);
      project.bin.push({ kind: 'beat', beatId, reason: 'lifted' });
    }
    expect(validateStudioProjectV2(project)).toBe(true);
    project.beats.beat_25 = makeBeat('beat_25');
    project.bin.push({ kind: 'beat', beatId: 'beat_25', reason: 'lifted' });
    expect(validateStudioProjectV2(project)).toBe(false);
  });

  it('enforces the Shot Bin maximum while counting each record once', () => {
    const project = makeProject();
    project.beats.beat_1!.shotOrder = [];
    project.shots = {};
    for (let index = 1; index <= STUDIO_MAX_BIN_SHOT_ITEMS; index += 1) {
      const shotId = `shot_${index}`;
      project.shots[shotId] = makeShot(shotId);
      project.bin.push({ kind: 'shot', beatId: 'beat_1', shotId, reason: 'lifted' });
    }
    expect(validateStudioProjectV2(project)).toBe(true);
    project.shots.shot_97 = makeShot('shot_97');
    project.bin.push({ kind: 'shot', beatId: 'beat_1', shotId: 'shot_97', reason: 'lifted' });
    expect(validateStudioProjectV2(project)).toBe(false);
  });

  it('enforces the semantic reference catalogue at 24 and 25 entries', () => {
    const project = makeProject();
    project.referencePlanStatus = 'planned';
    for (let index = 1; index <= STUDIO_MAX_PROJECT_REFERENCES; index += 1) {
      const referenceId = `ref_${index}`;
      project.referenceOrder.push(referenceId);
      project.references[referenceId] = {
        id: referenceId,
        kind: 'character',
        label: `Character ${index}`,
        prompt: `Reference description ${index}`,
        approvedAssetId: null,
        supersededAssetIds: [],
        jobIds: [],
        createdAt: timestamp,
        updatedAt: timestamp,
      };
    }
    expect(validateStudioProjectV2(project)).toBe(true);
    project.referenceOrder.push('ref_25');
    project.references.ref_25 = {
      id: 'ref_25',
      kind: 'background',
      label: 'Background 25',
      prompt: 'Reference description 25',
      approvedAssetId: null,
      supersededAssetIds: [],
      jobIds: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    expect(validateStudioProjectV2(project)).toBe(false);
  });

  it.each([4, 15])('accepts Shot duration %i', (durationSeconds) => {
    const project = makeProject();
    project.shots.shot_1!.durationSeconds = durationSeconds;
    expect(validateStudioProjectV2(project)).toBe(true);
  });

  it.each([3, 16])('rejects Shot duration %i', (durationSeconds) => {
    const project = makeProject();
    project.shots.shot_1!.durationSeconds = durationSeconds;
    expect(validateStudioProjectV2(project)).toBe(false);
  });

  it('rejects active-and-binned Beat and Shot identities', () => {
    const beatOverlap = makeProject();
    beatOverlap.bin.push({ kind: 'beat', beatId: 'beat_1', reason: 'lifted' });
    expect(validateStudioProjectV2(beatOverlap)).toBe(false);
    const shotOverlap = makeProject();
    shotOverlap.bin.push({ kind: 'shot', beatId: 'beat_1', shotId: 'shot_1', reason: 'lifted' });
    expect(validateStudioProjectV2(shotOverlap)).toBe(false);
  });

  it('rejects duplicate Shot ownership and orphan asset/job reverse links', () => {
    const duplicate = makeProject();
    duplicate.beatOrder.push('beat_2');
    duplicate.beats.beat_2 = makeBeat('beat_2', ['shot_1']);
    expect(validateStudioProjectV2(duplicate)).toBe(false);

    const orphanAsset = makeProject();
    orphanAsset.assets.seed_1 = makeImageAsset('seed_1', 'shot_1', 'imports');
    expect(validateStudioProjectV2(orphanAsset)).toBe(false);

    const orphanJob = makeProject();
    addSucceededVideoTake(orphanJob);
    orphanJob.shots.shot_1!.jobIds = [];
    expect(validateStudioProjectV2(orphanJob)).toBe(false);
  });
});

describe('validateStudioProjectV2 media, trim, and frame lineage', () => {
  it('accepts canonical bed audio and rejects unowned project-level visual media', () => {
    const project = makeProject();
    project.assets.bed_1 = makeAudioAsset('bed_1');
    project.bedAssetId = 'bed_1';
    expect(validateStudioProjectV2(project)).toBe(true);
    project.assets.image_1 = makeImageAsset('image_1', null, 'assets');
    expect(validateStudioProjectV2(project)).toBe(false);
    delete project.assets.image_1;
    project.assets.video_1 = makeVideoAsset('video_1', null);
    expect(validateStudioProjectV2(project)).toBe(false);
  });

  it.each([
    ['a non-WAV MIME type', (asset: StudioAssetV2) => (asset.mimeType = 'audio/mpeg')],
    ['a noncanonical managed name', (asset: StudioAssetV2) => (asset.managedAsset.fileName = 'foreign.wav')],
    ['zero managed bytes', (asset: StudioAssetV2) => (asset.byteSize = 0)],
    ['visual dimensions', (asset: StudioAssetV2) => (asset.width = 1)],
    ['visual source-look metadata', (asset: StudioAssetV2) => (asset.sourceLook = 'not audio metadata')],
  ])('rejects selected bed audio with %s', (_label, mutate) => {
    const project = makeProject();
    const bed = makeAudioAsset('bed_1');
    mutate(bed);
    project.assets.bed_1 = bed;
    project.bedAssetId = 'bed_1';
    expect(validateStudioProjectV2(project)).toBe(false);
  });

  it('accepts an unclassified human seed import and rejects shot-owned audio', () => {
    const project = makeProject();
    addHumanSeed(project);
    expect(validateStudioProjectV2(project)).toBe(true);
    project.assets.audio_1 = makeAudioAsset('audio_1', 'shot_1');
    project.shots.shot_1!.assetIds.push('audio_1');
    expect(validateStudioProjectV2(project)).toBe(false);
  });

  it('requires video/audio duration, forbids image duration, and rejects 1e308', () => {
    const imageDuration = makeProject();
    addHumanSeed(imageDuration).durationSeconds = 1;
    expect(validateStudioProjectV2(imageDuration)).toBe(false);
    const hugeAudio = makeProject();
    hugeAudio.assets.bed_1 = makeAudioAsset('bed_1');
    hugeAudio.assets.bed_1!.durationSeconds = 1e308;
    expect(validateStudioProjectV2(hugeAudio)).toBe(false);
    const missingAudio = makeProject();
    const audio = makeAudioAsset('bed_1');
    delete audio.durationSeconds;
    missingAudio.assets.bed_1 = audio;
    expect(validateStudioProjectV2(missingAudio)).toBe(false);
  });

  it('accepts one current 10-second video picture with an 8-second Shot plan', () => {
    const project = makeProject();
    addSucceededVideoTake(project);
    expect(validateStudioProjectV2(project)).toBe(true);
  });

  it('accepts only canonical Board art as an explicit first-frame pin and still requires its selected style', () => {
    const project = makeProject();
    const board = addSucceededBoardStill(project);
    expect(validateStudioProjectV2(project)).toBe(true);

    project.boardStyle = null;
    expect(validateStudioProjectV2(project)).toBe(false);
    project.boardStyle = 'grey_tone';
    project.shots.shot_1!.seedStillId = board.id;
    expect(validateStudioProjectV2(project)).toBe(true);
    board.managedAsset.collection = 'assets';
    expect(validateStudioProjectV2(project)).toBe(false);
  });

  it('rejects a persisted authorization that mixes Board and seed work', () => {
    const project = makeProject();
    project.boardStyle = 'grey_tone';
    addFailedAuthorizationGraph(project, [
      makeItem(project.revision, 'shot_1', 'board_still', boardPlan()),
      makeItem(project.revision, 'shot_1', 'seed_still', seedPlan()),
    ]);

    expect(validateStudioProjectV2(project)).toBe(false);
  });

  it('rejects a persisted Board cascade authorization', () => {
    const project = makeProject();
    project.boardStyle = 'grey_tone';
    project.beats.beat_1!.shotOrder.push('shot_2');
    project.shots.shot_2 = makeShot('shot_2');
    addFailedAuthorizationGraph(
      project,
      [makeItem(project.revision, 'shot_1', 'board_still', boardPlan())],
      [makeItem(project.revision, 'shot_2', 'board_still', boardPlan())]
    );

    expect(validateStudioProjectV2(project)).toBe(false);
  });

  it('rejects a persisted Board authorization with a reference-handoff origin', () => {
    const project = makeProject();
    project.boardStyle = 'grey_tone';
    addFailedAuthorizationGraph(
      project,
      [makeItem(project.revision, 'shot_1', 'board_still', boardPlan())],
      [],
      'handoff_1'
    );

    expect(validateStudioProjectV2(project)).toBe(false);
  });

  it.each([
    ['deferred', deferredBoardPlan],
    ['conditioned', conditionedBoardPlan],
  ] as const)('rejects a persisted %s Board request', (_label, makePlan) => {
    const project = makeProject();
    project.boardStyle = 'grey_tone';
    addFailedAuthorizationGraph(project, [makeItem(project.revision, 'shot_1', 'board_still', makePlan())]);

    expect(validateStudioProjectV2(project)).toBe(false);
  });

  it('rejects a persisted Board request whose frozen reference has no semantic or asset authority', () => {
    const project = makeProject();
    project.boardStyle = 'grey_tone';
    addFailedAuthorizationGraph(project, [makeItem(project.revision, 'shot_1', 'board_still', referencedBoardPlan())]);

    expect(validateStudioProjectV2(project)).toBe(false);
  });

  it('accepts a persisted Board request with an exact approved semantic reference and source asset', () => {
    const project = makeProject();
    project.boardStyle = 'grey_tone';
    addApprovedProjectReference(project);
    addFailedAuthorizationGraph(project, [makeItem(project.revision, 'shot_1', 'board_still', referencedBoardPlan())]);

    expect(validateStudioProjectV2(project)).toBe(true);
  });

  it('rejects a persisted Board authority with a noncanonical plumbing duration', () => {
    const project = makeProject();
    project.boardStyle = 'grey_tone';
    const plan = boardPlan();
    if (plan.kind !== 'resolved') throw new Error('expected resolved Board plan');
    plan.snapshot.durationSeconds = 5;
    addFailedAuthorizationGraph(project, [makeItem(project.revision, 'shot_1', 'board_still', plan)]);

    expect(validateStudioProjectV2(project)).toBe(false);
  });

  it('derives current and superseded Board pointers from successful jobs in immutable order', () => {
    const project = makeProject();
    addSucceededBoardStill(project, 'shot_1', 'board_1');
    addSucceededBoardStill(project, 'shot_1', 'board_2');
    expect(project.shots.shot_1).toMatchObject({
      boardAssetId: 'board_2',
      supersededBoardAssetIds: ['board_1'],
    });
    expect(validateStudioProjectV2(project)).toBe(true);

    project.shots.shot_1!.supersededBoardAssetIds = [];
    expect(validateStudioProjectV2(project)).toBe(false);
    project.shots.shot_1!.supersededBoardAssetIds = ['board_1'];
    project.shots.shot_1!.boardAssetId = 'board_1';
    expect(validateStudioProjectV2(project)).toBe(false);
  });

  it('keeps the published Board pointer unchanged when a paid redraw fails', () => {
    const project = makeProject();
    addSucceededBoardStill(project);
    addFailedBoardRedraw(project);
    expect(project.shots.shot_1).toMatchObject({ boardAssetId: 'board_1', supersededBoardAssetIds: [] });
    expect(validateStudioProjectV2(project)).toBe(true);
  });

  it('binds a successful Board output and receipt to the immutable paid image item', () => {
    const project = makeProject();
    addSucceededBoardStill(project);
    expect(validateStudioProjectV2(project)).toBe(true);
    project.jobs.job_board_1!.spendReceipt!.durationSeconds = 8;
    expect(validateStudioProjectV2(project)).toBe(false);
  });

  it('requires the current picture and superseded history to follow successful video jobs in order', () => {
    const project = makeProject();
    addSucceededVideoTake(project, 'shot_1', 'video_1');
    addSucceededVideoTake(project, 'shot_1', 'video_2');
    expect(project.shots.shot_1).toMatchObject({
      videoAssetId: 'video_2',
      supersededVideoAssetIds: ['video_1'],
    });
    expect(validateStudioProjectV2(project)).toBe(true);

    project.shots.shot_1!.supersededVideoAssetIds = [];
    expect(validateStudioProjectV2(project)).toBe(false);
    project.shots.shot_1!.supersededVideoAssetIds = ['video_1'];
    project.shots.shot_1!.videoAssetId = 'video_1';
    expect(validateStudioProjectV2(project)).toBe(false);
    project.shots.shot_1!.videoAssetId = null;
    project.shots.shot_1!.supersededVideoAssetIds = ['video_1', 'video_2'];
    expect(validateStudioProjectV2(project)).toBe(false);
  });

  it('validates trims against current picture duration, not planning duration', () => {
    const project = makeProject();
    addSucceededVideoTake(project);
    project.shots.shot_1!.trimInSeconds = 1;
    project.shots.shot_1!.trimOutSeconds = 1;
    expect(validateStudioProjectV2(project)).toBe(true);
    project.shots.shot_1!.trimOutSeconds = 9;
    expect(validateStudioProjectV2(project)).toBe(false);
    project.shots.shot_1!.trimOutSeconds = Number.NaN;
    expect(validateStudioProjectV2(project)).toBe(false);
    project.shots.shot_1!.trimOutSeconds = -0;
    expect(validateStudioProjectV2(project)).toBe(false);
  });

  it('rejects trims without a current canonical video picture', () => {
    const project = makeProject();
    project.shots.shot_1!.trimInSeconds = 1;
    expect(validateStudioProjectV2(project)).toBe(false);
  });

  it('validates ready and failed extraction state with deterministic identity', () => {
    const project = makeProject();
    addSucceededVideoTake(project);
    const frameAssetId = addReadyFrame(project);
    expect(validateStudioProjectV2(project)).toBe(true);
    const frame = Object.values(project.frameExtractions)[0]!;
    frame.id = 'frame_wrong';
    expect(validateStudioProjectV2(project)).toBe(false);
    frame.id = Object.keys(project.frameExtractions)[0]!;
    frame.status = 'failed';
    frame.frameAssetId = null;
    frame.errorCode = 'decode_failed';
    delete project.assets[frameAssetId];
    project.shots.shot_1!.assetIds = project.shots.shot_1!.assetIds.filter((id) => id !== frameAssetId);
    expect(validateStudioProjectV2(project)).toBe(true);
  });
});

describe('validateStudioProjectV2 paid graph and immutable request state', () => {
  it('validates compositions against their independent protocol version', () => {
    const project = makeProject();
    addSucceededVideoTake(project);
    const compositionInputs = project.jobs.job_1!.composition.inputs;
    expect(compositionInputs.schemaVersion).toBe(STUDIO_GENERATION_COMPOSITION_SCHEMA_VERSION);
    expect(validateStudioProjectV2(project)).toBe(true);
    (compositionInputs as { schemaVersion: number }).schemaVersion = STUDIO_GENERATION_COMPOSITION_SCHEMA_VERSION + 1;
    expect(validateStudioProjectV2(project)).toBe(false);
  });

  it('accepts historical prompt bytes while retaining exact stored-to-stored composition authority', () => {
    const current = makeProject();
    const asset = addApprovedProjectReference(current);
    // JSON is the persistence boundary: repeated composition values are serialized independently.
    const archived = JSON.parse(JSON.stringify(current)) as StudioProjectV2;
    const job = archived.jobs[`job_${asset.id}`]!;
    const authorization = archived.spendAuthorizations.find((candidate) => candidate.id === job.authorizationId)!;
    const item = authorization.baseItems.find((candidate) => candidate.id === job.authorizationItemId)!;
    if (item.requestPlan.kind !== 'resolved' || job.requestPlan.kind !== 'resolved' || job.requestSnapshot === null) {
      throw new Error('historical prompt fixture requires resolved request records');
    }
    const legacyPrompt = job.composition.prompt.replace(
      /OUTPUT\n[\s\S]*$/,
      'OUTPUT\nCreate one clean character reference sheet in a single image with front, three-quarter, side, and back views.'
    );
    expect(legacyPrompt).not.toBe(job.composition.prompt);
    const persistedCopies = [
      item.requestPlan.snapshot.composition,
      job.requestPlan.snapshot.composition,
      job.requestSnapshot.composition,
      job.composition,
    ];
    for (const composition of persistedCopies) composition.prompt = legacyPrompt;
    archived.assets[asset.id]!.compositionDigest = studioGenerationCompositionDigestV2(job.composition);

    expect(recomposeStudioGenerationV2(job.composition).prompt).not.toBe(legacyPrompt);
    expect(validateStudioProjectV2(archived)).toBe(true);

    job.composition.prompt = `${legacyPrompt}\nUNMATCHED JOB COPY`;
    expect(validateStudioProjectV2(archived)).toBe(false);
    job.composition.prompt = legacyPrompt;
    authorization.providerBindings[0]!.provider = { ...provider, model: 'other-model' };
    expect(validateStudioProjectV2(archived)).toBe(false);
  });

  it('accepts exact authorization/job/receipt binding and rejects ±1 tampering', () => {
    const project = makeProject();
    addSucceededVideoTake(project);
    expect(validateStudioProjectV2(project)).toBe(true);
    project.spendAuthorizations[0]!.upperMinorUnits += 1;
    expect(validateStudioProjectV2(project)).toBe(false);
    project.spendAuthorizations[0]!.upperMinorUnits -= 1;
    project.jobs.job_1!.spendReceipt!.totalMinorUnits += 1;
    expect(validateStudioProjectV2(project)).toBe(false);
  });

  it('rejects missing/changed provider bindings and idempotency relations', () => {
    const project = makeProject();
    addSucceededVideoTake(project);
    const authorization = project.spendAuthorizations[0]!;
    authorization.providerBindings = [];
    expect(validateStudioProjectV2(project)).toBe(false);
    authorization.providerBindings = [{ itemId: authorization.baseItems[0]!.id, provider }];
    project.jobs.job_1!.provider = { ...provider, model: 'other' };
    expect(validateStudioProjectV2(project)).toBe(false);
    project.jobs.job_1!.provider = provider;
    authorization.idempotencyKeys[0]!.key = 'other_key';
    expect(validateStudioProjectV2(project)).toBe(false);
  });

  it('requires non-null reference handoff origins to be unique within each project only', () => {
    const duplicate = makeProject();
    const first = addFailedSeedAuthorization(duplicate, 'auth_origin_1', 'handoff_1');
    addFailedSeedAuthorization(duplicate, 'auth_origin_2', 'handoff_2', first.id);
    expect(validateStudioProjectV2(duplicate)).toBe(true);
    duplicate.spendAuthorizations[1]!.originReferenceHandoffId = 'handoff_1';
    expect(validateStudioProjectV2(duplicate)).toBe(false);

    const ordinary = makeProject();
    const ordinaryFirst = addFailedSeedAuthorization(ordinary, 'auth_ordinary_1', null);
    addFailedSeedAuthorization(ordinary, 'auth_ordinary_2', null, ordinaryFirst.id);
    expect(validateStudioProjectV2(ordinary)).toBe(true);

    const firstProject = makeProject('project_first');
    const secondProject = makeProject('project_second');
    addFailedSeedAuthorization(firstProject, 'auth_first', 'shared_handoff');
    addFailedSeedAuthorization(secondProject, 'auth_second', 'shared_handoff');
    expect(validateStudioProjectV2(firstProject)).toBe(true);
    expect(validateStudioProjectV2(secondProject)).toBe(true);
  });

  it.each([
    {
      label: 'cancelled candidate',
      predecessor: { status: 'cancelled', error: null },
      retry: {
        retryReason: 'provider_failure',
        duplicateChargeAcknowledged: false,
        duplicateChargeAcknowledgedAt: null,
      },
      invalidRetry: {
        retryReason: 'submission_unknown',
        duplicateChargeAcknowledged: true,
        duplicateChargeAcknowledgedAt: confirmedAt,
      },
    },
    {
      label: 'failed poll-deadline candidate',
      predecessor: {
        status: 'failed',
        error: { code: 'poll_deadline', messageKey: 'pollDeadline' },
        providerJobId: 'remote_reference_poll_deadline',
        remoteStartedAt: timestamp,
      },
      retry: {
        retryReason: 'submission_unknown',
        duplicateChargeAcknowledged: true,
        duplicateChargeAcknowledgedAt: confirmedAt,
      },
      invalidRetry: {
        retryReason: 'provider_failure',
        duplicateChargeAcknowledged: false,
        duplicateChargeAcknowledgedAt: null,
      },
    },
  ] as const)('accepts the exact paid lineage semantics for a project-reference $label', (entry) => {
    const project = makeProject();
    const { retry } = addProjectReferenceRetryLineage(project, entry.predecessor, entry.retry);
    expect(validateStudioProjectV2(project)).toBe(true);

    Object.assign(retry, entry.invalidRetry);
    expect(validateStudioProjectV2(project)).toBe(false);
  });

  it('requires project-reference needs-attention work to recover or terminalize before paid lineage', () => {
    const project = makeProject();
    const { predecessor } = addProjectReferenceRetryLineage(
      project,
      {
        status: 'needs_attention',
        error: { code: 'submission_unknown', messageKey: 'submissionUnknown' },
      },
      {
        retryReason: 'submission_unknown',
        duplicateChargeAcknowledged: true,
        duplicateChargeAcknowledgedAt: confirmedAt,
      }
    );
    expect(validateStudioProjectV2(project)).toBe(false);

    predecessor.status = 'failed';
    expect(validateStudioProjectV2(project)).toBe(true);
  });

  it('keeps terminal reference history and rejects duplicate live work for one semantic target', () => {
    const terminal = makeProject();
    addProjectReferenceRetryLineage(
      terminal,
      { status: 'failed', error: { code: 'timeout', messageKey: 'timeout' } },
      {
        status: 'failed',
        error: { code: 'timeout', messageKey: 'timeout' },
        retryReason: 'provider_failure',
        duplicateChargeAcknowledged: false,
        duplicateChargeAcknowledgedAt: null,
      }
    );
    expect(validateStudioProjectV2(terminal)).toBe(true);

    const nonterminal = makeProject();
    addProjectReferenceRetryLineage(
      nonterminal,
      { status: 'failed', error: { code: 'timeout', messageKey: 'timeout' } },
      {
        retryReason: 'provider_failure',
        duplicateChargeAcknowledged: false,
        duplicateChargeAcknowledgedAt: null,
      }
    );
    expect(validateStudioProjectV2(nonterminal)).toBe(true);

    const duplicateRevision = nonterminal.revision;
    const duplicateItem = makeItem(duplicateRevision, 'shot_1', 'reference_image', seedPlan(), 1, nonterminal.id, {
      kind: 'reference',
      referenceId: 'ref_background',
    });
    const duplicateAuthorization = makeAuthorization(
      'auth_duplicate_live_reference',
      duplicateRevision,
      [duplicateItem],
      [],
      nonterminal.id
    );
    const duplicateJob = makeJob('job_duplicate_live_reference', duplicateAuthorization, duplicateItem);
    addAuthorizationWithJobs(nonterminal, duplicateAuthorization, [duplicateJob]);
    expect(validateStudioProjectV2(nonterminal)).toBe(false);
  });

  it('rejects branching paid retry lineage from one predecessor', () => {
    const project = makeProject();
    const { predecessor } = addProjectReferenceRetryLineage(
      project,
      { status: 'failed', error: { code: 'timeout', messageKey: 'timeout' } },
      {
        status: 'failed',
        error: { code: 'timeout', messageKey: 'timeout' },
        retryReason: 'provider_failure',
        duplicateChargeAcknowledged: false,
        duplicateChargeAcknowledgedAt: null,
      }
    );
    expect(validateStudioProjectV2(project)).toBe(true);

    const branchRevision = project.revision;
    const branchItem = makeItem(branchRevision, 'shot_1', 'reference_image', seedPlan(), 1, project.id, {
      kind: 'reference',
      referenceId: 'ref_background',
    });
    const branchAuthorization = makeAuthorization(
      'auth_reference_retry_branch',
      branchRevision,
      [branchItem],
      [],
      project.id
    );
    const branch = makeJob('job_reference_retry_branch', branchAuthorization, branchItem, {
      status: 'failed',
      error: { code: 'timeout', messageKey: 'timeout' },
      retryOfJobId: predecessor.id,
      retryReason: 'provider_failure',
    });
    addAuthorizationWithJobs(project, branchAuthorization, [branch]);

    expect(validateStudioProjectV2(project)).toBe(false);
  });

  it('keeps failed project-reference downloads on same-job recovery instead of paid lineage', () => {
    const project = makeProject();
    const { predecessor, retry } = addProjectReferenceRetryLineage(
      project,
      {
        status: 'failed',
        error: { code: 'download_failed', messageKey: 'downloadFailed' },
        providerJobId: 'remote_reference_download',
        remoteStartedAt: timestamp,
      },
      {
        retryReason: 'provider_failure',
        duplicateChargeAcknowledged: false,
        duplicateChargeAcknowledgedAt: null,
      }
    );
    const authorization = project.spendAuthorizations.find(
      (candidate) => candidate.id === predecessor.authorizationId
    )!;
    predecessor.spendReceipt = createStudioSpendReceiptV2({
      authorization,
      itemId: predecessor.authorizationItemId,
      jobId: predecessor.id,
    });
    expect(validateStudioProjectV2(project)).toBe(false);

    retry.retryOfJobId = null;
    retry.retryReason = null;
    expect(validateStudioProjectV2(project)).toBe(true);
  });

  it('preserves ordinary Shot failed submission-unknown retry validation', () => {
    const project = makeProject();
    const predecessorItem = makeItem(project.revision, 'shot_1', 'seed_still', seedPlan());
    const predecessorAuthorization = makeAuthorization('auth_ordinary_unknown', project.revision, [predecessorItem]);
    const predecessor = makeJob('job_ordinary_unknown', predecessorAuthorization, predecessorItem, {
      status: 'failed',
      error: { code: 'submission_unknown', messageKey: 'submissionUnknown' },
    });
    addAuthorizationWithJobs(project, predecessorAuthorization, [predecessor]);

    const retryItem = makeItem(project.revision, 'shot_1', 'seed_still', seedPlan());
    const retryAuthorization = makeAuthorization('auth_ordinary_unknown_retry', project.revision, [retryItem]);
    const retry = makeJob('job_ordinary_unknown_retry', retryAuthorization, retryItem, {
      retryOfJobId: predecessor.id,
      retryReason: 'submission_unknown',
      duplicateChargeAcknowledged: true,
      duplicateChargeAcknowledgedAt: confirmedAt,
    });
    addAuthorizationWithJobs(project, retryAuthorization, [retry]);
    expect(validateStudioProjectV2(project)).toBe(true);
  });

  it('requires receipts for succeeded/post-completion failures and rejects them precompletion', () => {
    const project = makeProject();
    addSucceededVideoTake(project);
    const job = project.jobs.job_1!;
    const receipt = job.spendReceipt;
    job.spendReceipt = null;
    expect(validateStudioProjectV2(project)).toBe(false);

    job.status = 'failed';
    job.error = { code: 'download_failed', messageKey: 'download_failed' };
    job.outputAssetIds = [];
    job.outputAssetIdsByRole = { primary: null, poster: null };
    delete project.assets.take_1;
    project.shots.shot_1!.assetIds = project.shots.shot_1!.assetIds.filter((id) => id !== 'take_1');
    project.shots.shot_1!.videoAssetId = null;
    job.spendReceipt = receipt;
    expect(validateStudioProjectV2(project)).toBe(true);
    job.error = {
      code: 'seed_still_variation_grid',
      messageKey: 'conversation.creativeStudio.jobs.errors.seedStillVariationGrid',
    };
    expect(validateStudioProjectV2(project)).toBe(false);
    job.error = { code: 'download_failed', messageKey: 'download_failed' };
    job.status = 'queued_local';
    job.error = null;
    expect(validateStudioProjectV2(project)).toBe(false);
  });

  it('requires the paid seed purpose and receipt for a variation-grid failure', () => {
    const project = makeProject();
    const job = addFailedSeedAuthorization(project, 'auth_grid', null);
    const authorization = project.spendAuthorizations[0]!;
    const item = authorization.baseItems[0]!;
    job.error = {
      code: 'seed_still_variation_grid',
      messageKey: 'conversation.creativeStudio.jobs.errors.seedStillVariationGrid',
    };
    job.spendReceipt = createStudioSpendReceiptV2({ authorization, itemId: item.id, jobId: job.id });
    expect(validateStudioProjectV2(project)).toBe(true);

    job.spendReceipt = null;
    expect(validateStudioProjectV2(project)).toBe(false);
  });

  it('requires the exact approved semantic reference for live work and retains superseded terminal provenance', () => {
    const project = makeProject();
    const reference = addApprovedProjectReference(project);
    project.shots.shot_1!.referenceBinding = {
      status: 'ready',
      characterReferenceIds: ['ref_character'],
      backgroundReferenceId: null,
    };
    const item = makeItem(
      project.revision,
      'shot_1',
      'seed_still',
      seedPlan({
        referenceId: 'ref_character',
        kind: 'character',
        assetId: reference.id,
        sha256: reference.sha256,
      })
    );
    const authorization = makeAuthorization('auth_ref', project.revision, [item]);
    const job = makeJob('job_ref', authorization, item);
    addAuthorizationWithJobs(project, authorization, [job]);
    expect(validateStudioProjectV2(project)).toBe(true);
    reference.sha256 = 'c'.repeat(64);
    expect(validateStudioProjectV2(project)).toBe(false);
    reference.sha256 = digest;
    addApprovedProjectReference(project, 'ref_character', 'reference_2');
    expect(validateStudioProjectV2(project)).toBe(true);
    job.status = 'failed';
    job.error = { code: 'timeout', messageKey: 'timeout' };
    expect(validateStudioProjectV2(project)).toBe(true);
  });

  it('preserves exact per-Shot character order independently of catalogue order', () => {
    const project = makeProject();
    addApprovedProjectReference(project, 'ref_character_ming', 'reference_ming');
    addApprovedProjectReference(project, 'ref_character_mei', 'reference_mei');
    project.references.ref_character_ming!.label = 'Ming';
    project.references.ref_character_mei!.label = 'Mei';
    expect(project.referenceOrder).toEqual(['ref_character_ming', 'ref_character_mei']);

    project.shots.shot_1!.referenceBinding = {
      status: 'ready',
      characterReferenceIds: ['ref_character_mei', 'ref_character_ming'],
      backgroundReferenceId: null,
    };

    expect(validateStudioProjectV2(project)).toBe(true);
  });

  it('rejects wrong-kind, cross-semantic, candidate-only, and non-managed frozen reference inputs', () => {
    const addFrozenReferenceJob = (
      project: StudioProjectV2,
      referenceId: string,
      kind: 'character' | 'background',
      asset: StudioAssetV2
    ): void => {
      project.shots.shot_1!.referenceBinding = {
        status: 'ready',
        characterReferenceIds: kind === 'character' ? [referenceId] : [],
        backgroundReferenceId: kind === 'background' ? referenceId : null,
      };
      const item = makeItem(
        project.revision,
        'shot_1',
        'seed_still',
        seedPlan({ referenceId, kind, assetId: asset.id, sha256: asset.sha256 })
      );
      const authorization = makeAuthorization(`auth_frozen_${referenceId}`, project.revision, [item]);
      addAuthorizationWithJobs(project, authorization, [makeJob(`job_frozen_${referenceId}`, authorization, item)]);
    };

    const wrongKind = makeProject();
    const wrongKindAsset = addApprovedProjectReference(wrongKind);
    addFrozenReferenceJob(wrongKind, 'ref_character', 'background', wrongKindAsset);
    expect(validateStudioProjectV2(wrongKind)).toBe(false);

    const crossSemantic = makeProject();
    const firstAsset = addApprovedProjectReference(crossSemantic);
    addApprovedProjectReference(crossSemantic, 'ref_character_other', 'reference_other');
    crossSemantic.references.ref_character_other!.label = 'Other character';
    addFrozenReferenceJob(crossSemantic, 'ref_character_other', 'character', firstAsset);
    expect(validateStudioProjectV2(crossSemantic)).toBe(false);

    const noCurrentImage = makeProject();
    const unboundAsset = addApprovedProjectReference(noCurrentImage, 'ref_character_unbound', 'reference_unbound');
    const unboundReference = noCurrentImage.references.ref_character_unbound!;
    unboundReference.approvedAssetId = null;
    addFrozenReferenceJob(noCurrentImage, unboundReference.id, 'character', unboundAsset);
    expect(validateStudioProjectV2(noCurrentImage)).toBe(false);

    const wrongCollection = makeProject();
    const wrongCollectionAsset = addApprovedProjectReference(wrongCollection);
    wrongCollectionAsset.managedAsset.collection = 'imports';
    addFrozenReferenceJob(wrongCollection, 'ref_character', 'character', wrongCollectionAsset);
    expect(validateStudioProjectV2(wrongCollection)).toBe(false);
  });

  it('rejects quoted generation counts other than exactly one', () => {
    const project = makeProject();
    const item = makeItem(1, 'shot_1', 'seed_still', seedPlan());
    const authorization = makeAuthorization('auth_exact_one', 1, [item]);
    addAuthorizationWithJobs(project, authorization, [makeJob('job_exact_one', authorization, item)]);
    expect(validateStudioProjectV2(project)).toBe(true);
    item.generationCount = 2;
    expect(validateStudioProjectV2(project)).toBe(false);
  });

  it('admits exactly one bounded reference-grid retry under the original quote authority', () => {
    const project = makeProject();
    const referenceId = 'ref_background';
    project.referencePlanStatus = 'planned';
    project.referenceOrder = [referenceId];
    project.references[referenceId] = {
      id: referenceId,
      kind: 'background',
      label: 'Dai pai dong',
      prompt: 'A recurring Hong Kong street-food stall.',
      approvedAssetId: null,
      supersededAssetIds: [],
      jobIds: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const item = makeItem(project.revision, 'shot_1', 'reference_image', seedPlan(), 2, project.id, {
      kind: 'reference',
      referenceId,
    });
    const authorization = makeAuthorization('auth_bounded_grid_retry', project.revision, [item]);
    const first = makeJob('job_grid_first', authorization, item);
    addAuthorizationWithJobs(project, authorization, [first]);
    expect(validateStudioProjectV2(project)).toBe(true);

    first.status = 'failed';
    first.error = {
      code: 'seed_still_variation_grid',
      messageKey: 'conversation.creativeStudio.jobs.errors.seedStillVariationGrid',
    };
    first.spendReceipt = createStudioSpendReceiptV2({ authorization, itemId: item.id, jobId: first.id });
    expect(validateStudioProjectV2(project)).toBe(false);

    const retry = makeJob('job_grid_retry', authorization, item, {
      idempotencyKey: authorization.idempotencyKeys[1]!.key,
      retryOfJobId: first.id,
      retryReason: 'variation_grid',
    });
    project.jobs[retry.id] = retry;
    project.references[referenceId]!.jobIds.push(retry.id);
    expect(validateStudioProjectV2(project)).toBe(true);

    retry.retryOfJobId = null;
    retry.retryReason = null;
    expect(validateStudioProjectV2(project)).toBe(false);
    retry.retryOfJobId = first.id;
    retry.retryReason = 'variation_grid';
    retry.idempotencyKey = first.idempotencyKey;
    expect(validateStudioProjectV2(project)).toBe(false);
    retry.idempotencyKey = authorization.idempotencyKeys[1]!.key;
    retry.status = 'failed';
    retry.error = {
      code: 'seed_still_variation_grid',
      messageKey: 'conversation.creativeStudio.jobs.errors.referenceVariationGridRepeated',
    };
    retry.spendReceipt = createStudioSpendReceiptV2({ authorization, itemId: item.id, jobId: retry.id });
    expect(validateStudioProjectV2(project)).toBe(true);
    expect(retry.spendReceipt).toMatchObject({ generationCount: 1, totalMinorUnits: item.rateMinorUnits });
  });

  it('accepts canonical imported references while refusing detached imports for live work', () => {
    const project = makeProject();
    const referenceId = 'ref_character';
    const assetId = 'reference_imported';
    project.referencePlanStatus = 'planned';
    project.referenceOrder = [referenceId];
    project.references[referenceId] = {
      id: referenceId,
      kind: 'character',
      label: 'Ming',
      prompt: 'Ming in a red rain jacket.',
      approvedAssetId: assetId,
      supersededAssetIds: [],
      jobIds: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    project.assets[assetId] = makeImageAsset(assetId, null, 'imports', {
      projectReferenceId: referenceId,
    });
    project.shots.shot_1!.referenceBinding = {
      status: 'ready',
      characterReferenceIds: [referenceId],
      backgroundReferenceId: null,
    };
    const item = makeItem(
      project.revision,
      'shot_1',
      'seed_still',
      seedPlan({ referenceId, kind: 'character', assetId, sha256: digest })
    );
    const authorization = makeAuthorization('auth_imported_reference', project.revision, [item]);
    const job = makeJob('job_imported_reference', authorization, item);
    addAuthorizationWithJobs(project, authorization, [job]);
    expect(validateStudioProjectV2(project)).toBe(true);

    project.references[referenceId]!.approvedAssetId = null;
    expect(validateStudioProjectV2(project)).toBe(false);
    job.status = 'failed';
    job.error = { code: 'timeout', messageKey: 'timeout' };
    expect(validateStudioProjectV2(project)).toBe(true);

    project.assets[assetId]!.producerJobId = 'forged_producer';
    expect(validateStudioProjectV2(project)).toBe(false);
  });

  it('keeps symbolic predecessor endpoints concrete-only and binds only the exact upstream item primary', () => {
    const project = makeWaitingDependencyProject();
    const predecessor = project.shots.shot_1!;
    predecessor.videoAssetId = 'take_1';
    const frameAssetId = addReadyFrame(project, 'take_1', 10);
    const dependent = project.jobs.job_dependent!;
    const template = dependent.requestPlan.kind === 'after_take_selection' ? dependent.requestPlan.template : null;
    dependent.status = 'queued_local';
    dependent.requestSnapshot = {
      ...template!,
      conditioningInput: {
        kind: 'predecessor_frame',
        predecessorShotId: predecessor.id,
        takeAssetId: 'take_1',
        frameAssetId,
        endpointSeconds: 10,
      },
    };
    expect(validateStudioProjectV2(project)).toBe(true);

    addSucceededVideoTake(project, predecessor.id, 'take_other_authorization');
    const otherFrameAssetId = addReadyFrame(project, 'take_other_authorization', 9);
    dependent.requestSnapshot = {
      ...template!,
      conditioningInput: {
        kind: 'predecessor_frame',
        predecessorShotId: predecessor.id,
        takeAssetId: 'take_other_authorization',
        frameAssetId: otherFrameAssetId,
        endpointSeconds: 9,
      },
    };
    expect(validateStudioProjectV2(project)).toBe(false);
  });

  it('requires a bound authorized seed to be the exact upstream item primary', () => {
    const project = makeProject();
    const upstream = makeItem(1, 'shot_1', 'seed_still', seedPlan());
    const dependentPlan: StudioGenerationRequestPlan = {
      kind: 'after_take_selection',
      template: {
        composition: null as never,
        aspectRatio: '16:9',
        resolution: '1080p',
        durationSeconds: 8,
        referenceInputs: [],
      },
      dependency: { kind: 'authorized_seed', upstreamItemId: upstream.id, shotId: 'shot_1' },
    };
    const dependentItem = makeItem(1, 'shot_1', 'video_take', dependentPlan);
    const authorization = makeAuthorization('auth_seed_dependency', 1, [upstream], [dependentItem]);
    const upstreamComposition =
      upstream.requestPlan.kind === 'resolved' ? upstream.requestPlan.snapshot.composition : null;
    if (upstreamComposition === null) throw new Error('expected resolved seed composition');
    const generatedSeed = makeImageAsset('seed_generated', 'shot_1', 'assets', {
      producerJobId: 'job_seed_upstream',
      compositionDigest: studioGenerationCompositionDigestV2(upstreamComposition),
    });
    project.assets[generatedSeed.id] = generatedSeed;
    project.shots.shot_1!.assetIds.push(generatedSeed.id);
    project.shots.shot_1!.seedStillId = generatedSeed.id;
    const upstreamJob = makeJob('job_seed_upstream', authorization, upstream, {
      status: 'succeeded',
      providerJobId: 'remote_seed_upstream',
      remoteStartedAt: timestamp,
      outputAssetIds: [generatedSeed.id],
      outputAssetIdsByRole: { primary: generatedSeed.id, poster: null },
      spendReceipt: {
        authorizationId: authorization.id,
        itemId: upstream.id,
        jobId: 'job_seed_upstream',
        purpose: 'seed_still',
        routeId: upstream.routeId,
        currency: authorization.currency,
        rateUnit: upstream.rateUnit,
        rateMinorUnits: upstream.rateMinorUnits,
        durationSeconds: null,
        generationCount: 1,
        totalMinorUnits: upstream.rateMinorUnits,
      },
    });
    const dependentJob = makeJob('job_seed_dependent', authorization, dependentItem, {
      status: 'queued_local',
      requestSnapshot: {
        ...dependentPlan.template,
        conditioningInput: { kind: 'seed_still', assetId: generatedSeed.id },
      },
    });
    addAuthorizationWithJobs(project, authorization, [upstreamJob, dependentJob]);
    expect(validateStudioProjectV2(project)).toBe(true);

    const humanSeed = addHumanSeed(project, 'shot_1', 'seed_human_import');
    dependentJob.requestSnapshot = {
      ...dependentPlan.template,
      conditioningInput: { kind: 'seed_still', assetId: humanSeed.id },
    };
    expect(validateStudioProjectV2(project)).toBe(false);
  });

  it('rejects a speculative endpoint field on a symbolic predecessor dependency', () => {
    const project = makeWaitingDependencyProject();
    const plan = project.spendAuthorizations[0]!.cascadeItems[0]!.requestPlan;
    expect(plan.kind).toBe('after_take_selection');
    if (plan.kind !== 'after_take_selection') throw new Error('expected deferred plan');
    Object.assign(plan.dependency, { endpointSeconds: 10 });
    expect(validateStudioProjectV2(project)).toBe(false);
  });

  it('validates an unbound existing predecessor against live topology but preserves materialized history', () => {
    const project = makeProject();
    project.beats.beat_1!.shotOrder.push('shot_2');
    project.shots.shot_2 = makeShot('shot_2');
    const take = addSucceededVideoTake(project, 'shot_1', 'take_existing');
    project.shots.shot_1!.trimOutSeconds = 2;
    const plan = {
      kind: 'after_take_selection' as const,
      template: {
        composition: null as never,
        aspectRatio: '16:9' as const,
        resolution: '1080p' as const,
        durationSeconds: 8,
        referenceInputs: [],
      },
      dependency: {
        kind: 'existing_predecessor' as const,
        predecessorShotId: 'shot_1',
        takeAssetId: take.id,
        endpointSeconds: 8,
      },
    } as unknown as StudioGenerationRequestPlan;
    const item = makeItem(project.revision, 'shot_2', 'video_take', plan);
    const authorization = makeAuthorization('auth_existing_predecessor', project.revision, [item]);
    const dependent = makeJob('job_existing_predecessor', authorization, item);
    const extractionId = createStudioFrameExtractionId({
      shotId: 'shot_1',
      videoAssetId: take.id,
      endpointSeconds: 8,
    });
    project.frameExtractions[extractionId] = {
      id: extractionId,
      shotId: 'shot_1',
      videoAssetId: take.id,
      endpointSeconds: 8,
      frameAssetId: null,
      status: 'pending',
      errorCode: null,
      attemptCount: 0,
    };
    addAuthorizationWithJobs(project, authorization, [dependent]);

    expect(validateStudioProjectV2(project)).toBe(true);
    project.shots.shot_1!.trimOutSeconds = 1;
    expect(validateStudioProjectV2(project)).toBe(false);
    project.shots.shot_1!.trimOutSeconds = 2;
    project.shots.shot_2!.chainBreak = 'hard_cut';
    expect(validateStudioProjectV2(project)).toBe(false);
    project.shots.shot_2!.chainBreak = 'none';

    const frameAssetId = addReadyFrame(project, take.id, 8);
    dependent.status = 'queued_local';
    dependent.requestSnapshot = {
      ...plan.template,
      conditioningInput: {
        kind: 'predecessor_frame',
        predecessorShotId: 'shot_1',
        takeAssetId: take.id,
        frameAssetId,
        endpointSeconds: 8,
      },
    };
    expect(validateStudioProjectV2(project)).toBe(true);

    project.shots.shot_1!.trimOutSeconds = 1;
    project.shots.shot_2!.chainBreak = 'hard_cut';
    expect(validateStudioProjectV2(project)).toBe(true);
  });

  it('rejects two nonterminal authorization items for one Shot/purpose and releases terminal history', () => {
    const project = makeProject();
    const firstItem = makeItem(1, 'shot_1', 'seed_still', seedPlan());
    const firstAuth = makeAuthorization('auth_first', 1, [firstItem]);
    const firstJob = makeJob('job_first', firstAuth, firstItem);
    addAuthorizationWithJobs(project, firstAuth, [firstJob]);
    const secondItem = makeItem(2, 'shot_1', 'seed_still', seedPlan());
    const secondAuth = makeAuthorization('auth_second', 2, [secondItem]);
    const secondJob = makeJob('job_second', secondAuth, secondItem);
    addAuthorizationWithJobs(project, secondAuth, [secondJob]);
    expect(validateStudioProjectV2(project)).toBe(false);
    firstJob.status = 'failed';
    firstJob.error = { code: 'timeout', messageKey: 'timeout' };
    expect(validateStudioProjectV2(project)).toBe(true);
  });

  it('allows distinct character references to share one reference-image authorization', () => {
    const project = makeProject();
    const referenceIds = ['ref_character_ming', 'ref_character_mei'] as const;
    project.referencePlanStatus = 'planned';
    project.referenceOrder = [...referenceIds];
    project.references.ref_character_ming = {
      id: 'ref_character_ming',
      kind: 'character',
      label: 'Ming',
      prompt: 'Character sheet for Ming.',
      approvedAssetId: null,
      supersededAssetIds: [],
      jobIds: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    project.references.ref_character_mei = {
      id: 'ref_character_mei',
      kind: 'character',
      label: 'Mei',
      prompt: 'Character sheet for Mei.',
      approvedAssetId: null,
      supersededAssetIds: [],
      jobIds: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    const items = referenceIds.map((referenceId) =>
      makeItem(project.revision, 'shot_1', 'reference_image', seedPlan(), 1, project.id, {
        kind: 'reference',
        referenceId,
      })
    );
    const authorization = makeAuthorization('auth_shared_reference_proxy', project.revision, items);
    const jobs = items.map((item) => {
      if (item.target.kind !== 'reference') throw new Error('expected reference target');
      return makeJob(`job_${item.target.referenceId}`, authorization, item);
    });
    addAuthorizationWithJobs(project, authorization, jobs);

    expect(validateStudioProjectV2(project)).toBe(true);
  });

  it('accepts exact all-terminal upstream failure and rejects premature dependency_failed', () => {
    const project = makeProject();
    project.beats.beat_1!.shotOrder.push('shot_2');
    project.shots.shot_2 = makeShot('shot_2');
    addHumanSeed(project);
    const upstream = makeItem(1, 'shot_1', 'video_take', videoPlan({ kind: 'seed_still', assetId: 'seed_1' }));
    const dependent = makeItem(1, 'shot_2', 'video_take', deferredVideoPlan(upstream.id, 'shot_1'));
    const authorization = makeAuthorization('auth_dependency', 1, [upstream], [dependent]);
    const upstreamJob = makeJob('job_upstream', authorization, upstream, {
      status: 'failed',
      error: { code: 'timeout', messageKey: 'timeout' },
    });
    const dependentJob = makeJob('job_dependent', authorization, dependent, {
      status: 'failed',
      error: { code: 'dependency_failed', messageKey: 'dependency_failed' },
    });
    addAuthorizationWithJobs(project, authorization, [upstreamJob, dependentJob]);
    expect(validateStudioProjectV2(project)).toBe(true);
    upstreamJob.status = 'queued_local';
    upstreamJob.error = null;
    expect(validateStudioProjectV2(project)).toBe(false);
  });

  it('enforces authorization project/revision/expiry and canonical item identity boundaries', () => {
    const project = makeProject();
    addSucceededVideoTake(project);
    const authorization = project.spendAuthorizations[0]!;
    authorization.confirmedAt = authorization.expiresAt;
    expect(validateStudioProjectV2(project)).toBe(false);
    authorization.confirmedAt = confirmedAt;
    authorization.projectRevision = project.revision;
    expect(validateStudioProjectV2(project)).toBe(false);
    authorization.projectRevision = 1;
    authorization.baseItems[0]!.id = 'item_noncanonical';
    expect(validateStudioProjectV2(project)).toBe(false);
  });
});

describe('validateStudioProjectV2 Bin and inactive-lineage safety', () => {
  it('accepts the exact Beat and Shot Bin kinds and rejects a third kind', () => {
    const project = makeProject();
    project.beatOrder = [];
    project.bin.push({ kind: 'beat', beatId: 'beat_1', reason: 'alternate' });
    expect(validateStudioProjectV2(project)).toBe(true);
    project.bin.push({ kind: 'other' } as never);
    expect(validateStudioProjectV2(project)).toBe(false);
  });

  it('accepts a binned Shot with terminal paid lineage and rejects nonterminal work', () => {
    const project = makeProject();
    addSucceededVideoTake(project);
    project.beats.beat_1!.shotOrder = [];
    project.bin.push({ kind: 'shot', beatId: 'beat_1', shotId: 'shot_1', reason: 'lifted' });
    expect(validateStudioProjectV2(project)).toBe(true);
    const job = project.jobs.job_1!;
    job.status = 'running';
    job.outputAssetIds = [];
    job.outputAssetIdsByRole = { primary: null, poster: null };
    job.spendReceipt = null;
    delete project.assets.take_1;
    project.shots.shot_1!.assetIds = project.shots.shot_1!.assetIds.filter((id) => id !== 'take_1');
    project.shots.shot_1!.videoAssetId = null;
    expect(validateStudioProjectV2(project)).toBe(false);
  });

  it('accepts a binned Beat with terminal lineage', () => {
    const project = makeProject();
    addSucceededVideoTake(project);
    project.beatOrder = [];
    project.bin.push({ kind: 'beat', beatId: 'beat_1', reason: 'lifted' });
    expect(validateStudioProjectV2(project)).toBe(true);
  });
});

describe('validateStudioProjectV2 undo structural history', () => {
  it('accepts exact historical fragments and rejects duplicate patch targets', () => {
    const project = makeProject();
    project.undoHistory = [
      {
        id: 'undo_1',
        sourceRevision: 1,
        label: 'Edit shot',
        patches: [
          {
            kind: 'shot_fields',
            shotId: 'shot_1',
            before: null,
            beforeBeatId: null,
            beforeIndex: null,
            afterDigest: digest,
          },
        ],
      },
    ];
    expect(validateStudioProjectV2(project)).toBe(true);
    project.undoHistory[0]!.patches.push({
      kind: 'shot_fields',
      shotId: 'shot_1',
      before: null,
      beforeBeatId: null,
      beforeIndex: null,
      afterDigest: digest,
    });
    expect(validateStudioProjectV2(project)).toBe(false);
  });

  it('enforces undo entry and patch caps', () => {
    const project = makeProject();
    project.undoHistory = Array.from({ length: STUDIO_MAX_UNDO_ENTRIES }, (_, index) => ({
      id: `undo_${index}`,
      sourceRevision: 1,
      label: 'Edit',
      patches: [{ kind: 'bin' as const, before: [], afterDigest: digest }],
    }));
    expect(validateStudioProjectV2(project)).toBe(true);
    project.undoHistory.push({
      id: 'undo_over',
      sourceRevision: 1,
      label: 'Edit',
      patches: [{ kind: 'bin', before: [], afterDigest: digest }],
    });
    expect(validateStudioProjectV2(project)).toBe(false);

    const patchProject = makeProject();
    patchProject.undoHistory = [
      {
        id: 'undo_many',
        sourceRevision: 1,
        label: 'Edit',
        patches: Array.from({ length: STUDIO_MAX_UNDO_PATCHES_PER_ENTRY + 1 }, (_, index) => ({
          kind: 'shot_fields' as const,
          shotId: `historical_${index}`,
          before: null,
          beforeBeatId: null,
          beforeIndex: null,
          afterDigest: digest,
        })),
      },
    ];
    expect(validateStudioProjectV2(patchProject)).toBe(false);
  });
});

describe('validateStudioProjectV2 hostile persisted data totality', () => {
  it.each(['constructor', 'toString', '__proto__'])('rejects magic relation ID %s without throwing', (id) => {
    const projects = [
      (() => {
        const project = makeProject();
        project.assets.asset_1 = makeImageAsset('asset_1', id, 'imports');
        return project;
      })(),
      (() => {
        const project = makeProject();
        project.shots.shot_1!.videoAssetId = id;
        return project;
      })(),
      (() => {
        const project = makeProject();
        project.shots.shot_1!.seedStillId = id;
        return project;
      })(),
      (() => {
        const project = makeProject();
        addSucceededVideoTake(project);
        project.jobs.job_1!.shotId = id;
        return project;
      })(),
    ];
    for (const project of projects) expect(validateStudioProjectV2(project)).toBe(false);
  });

  it('returns false for a 20,000-deep hostile own-data graph without recursion', () => {
    const project = makeProject() as StudioProjectV2 & { hostile?: unknown };
    let hostile: Record<string, unknown> = { leaf: true };
    for (let depth = 0; depth < 20_000; depth += 1) hostile = { next: hostile };
    project.hostile = hostile;
    expect(validateStudioProjectV2(project)).toBe(false);
  });

  it('rejects sparse arrays, accessors, proxies, and serialization hooks without invoking them', () => {
    const sparseProject = makeProject();
    sparseProject.bin.length = 1;
    expect(validateStudioProjectV2(sparseProject)).toBe(false);

    const accessorProject = makeProject();
    let getterCalls = 0;
    Object.defineProperty(accessorProject, 'name', {
      enumerable: true,
      get() {
        getterCalls += 1;
        return 'Hostile';
      },
    });
    expect(validateStudioProjectV2(accessorProject)).toBe(false);
    expect(getterCalls).toBe(0);

    const toJsonProject = makeProject();
    let toJsonCalls = 0;
    Object.defineProperty(toJsonProject, 'toJSON', {
      enumerable: false,
      value: () => {
        toJsonCalls += 1;
        return {};
      },
    });
    expect(validateStudioProjectV2(toJsonProject)).toBe(false);
    expect(toJsonCalls).toBe(0);

    expect(validateStudioProjectV2(new Proxy(makeProject(), {}))).toBe(false);
  });

  it('accepts a valid 20,000-job retry chain iteratively', () => {
    const project = makeProject();
    project.revision = 20_002;
    for (let index = 0; index < 20_000; index += 1) {
      const sourceRevision = index + 1;
      const item = makeItem(sourceRevision, 'shot_1', 'seed_still', seedPlan());
      const authorization = makeAuthorization(`auth_${index}`, sourceRevision, [item]);
      const job = makeJob(`job_${index}`, authorization, item, {
        status: 'failed',
        error: { code: 'timeout', messageKey: 'timeout' },
        retryOfJobId: index === 0 ? null : `job_${index - 1}`,
        retryReason: index === 0 ? null : 'provider_failure',
      });
      project.spendAuthorizations.push(authorization);
      project.jobs[job.id] = job;
      project.shots.shot_1!.jobIds.push(job.id);
    }
    expect(validateStudioProjectV2(project)).toBe(true);
  }, 30_000);
});

describe('proposal row validators', () => {
  it('validates exact proposed Shot keys and duration bounds', () => {
    const proposed = {
      shotId: 'shot_1',
      shootingScript: '',
      durationSeconds: 8,
      chainBreak: 'none',
    };
    expect(validateStudioProposedShotV2(proposed)).toBe(true);
    expect(validateStudioProposedShotV2({ ...proposed, durationSeconds: 3 })).toBe(false);
    expect(validateStudioProposedShotV2({ ...proposed, unexpected: true })).toBe(false);
  });

  it('requires nonempty, deduplicated reasons in frozen order and unique row IDs', () => {
    const reasons = [
      'owned_asset',
      'owned_job',
      'video_asset',
      'seed_still',
      'conditioning_frame',
      'conditioning_input',
      'shooting_script',
    ] as const satisfies readonly StudioFixedShotReasonV2[];
    const row = { shotId: 'shot_1', reasons: [...reasons] };
    expect(validateStudioFixedShotReviewV2(row)).toBe(true);
    for (const reason of reasons) {
      expect(validateStudioFixedShotReviewV2({ shotId: 'shot_1', reasons: [reason] }), reason).toBe(true);
    }
    expect(validateStudioFixedShotReviewV2({ ...row, reasons: [] })).toBe(false);
    expect(validateStudioFixedShotReviewV2({ ...row, reasons: ['video_asset', 'owned_asset'] })).toBe(false);
    expect(validateStudioFixedShotReviewV2({ ...row, reasons: ['owned_asset', 'owned_asset'] })).toBe(false);
    expect(validateStudioFixedShotReviewV2({ ...row, reasons: ['unknown_reason'] })).toBe(false);
    expect(validateStudioFixedShotReviewV2({ ...row, unexpected: true })).toBe(false);
    expect(validateStudioFixedShotReviewV2({ reasons: [...reasons] })).toBe(false);
    const sparseReasons = [...reasons] as Array<StudioFixedShotReasonV2 | undefined>;
    delete sparseReasons[3];
    expect(validateStudioFixedShotReviewV2({ shotId: 'shot_1', reasons: sparseReasons })).toBe(false);
    expect(validateStudioFixedShotReviewsV2([row, { shotId: 'shot_1', reasons: ['owned_job'] }])).toBe(false);
  });
});

describe('validateStudioProjectV3 exact schema-6 Pilot contract', () => {
  it('accepts its factory project and rejects schema crossover, defaults, extra keys, and sparse arrays', () => {
    const project = makeEmptyProjectV3();
    expect(validateStudioProjectV3(project)).toBe(true);
    expect(validateStudioProjectV2(project)).toBe(false);
    expect(validateStudioProjectV3(makeProject())).toBe(false);

    const missingRequiredNull = { ...project } as Record<string, unknown>;
    delete missingRequiredNull.forgeProjectId;
    expect(validateStudioProjectV3(missingRequiredNull)).toBe(false);
    expect(validateStudioProjectV3({ ...project, aspectRatio: '16:9' })).toBe(false);

    const sparse = makeEmptyProjectV3();
    addImportedPieceV3(sparse, 'piece_1', 'ảnh_đêm');
    delete sparse.pieceOrder[0];
    expect(validateStudioProjectV3(sparse)).toBe(false);
  });

  it('accepts the exact 256-byte safe identity bound and rejects empty, non-ASCII, or 257-byte ids', () => {
    const maximumId = 'p'.repeat(256);
    expect(
      validateStudioProjectV3(createEmptyStudioProjectV3({ name: 'Pilot', brief: '' }, maximumId, timestampV3))
    ).toBe(true);
    for (const projectId of ['', 'ảnh', 'p'.repeat(257)]) {
      const project = makeEmptyProjectV3();
      project.id = projectId;
      expect(validateStudioProjectV3(project), projectId.length).toBe(false);
    }
  });

  it('requires every schema-6 rule timestamp to remain inside the Project lifetime', () => {
    const project = makeEmptyProjectV3();
    project.updatedAt = completedAtV3;
    project.rules = [
      {
        id: 'rule_1',
        scope: 'project',
        text: 'Keep the portrait quiet.',
        predicate: null,
        createdAt: confirmedAtV3,
      },
    ];
    expect(validateStudioProjectV3(project)).toBe(true);

    const beforeProject = structuredClone(project);
    beforeProject.rules[0]!.createdAt = '2026-08-29T23:59:59.999Z';
    expect(validateStudioProjectV3(beforeProject)).toBe(false);

    const afterProject = structuredClone(project);
    afterProject.rules[0]!.createdAt = '2026-08-30T00:00:02.001Z';
    expect(validateStudioProjectV3(afterProject)).toBe(false);
  });

  it('accepts the exact schema-6 image byte ceiling and rejects one byte over', () => {
    const project = makeEmptyProjectV3();
    addImportedPieceV3(project, 'piece_1', 'photo');
    project.assets.asset_piece_1!.byteSize = STUDIO_MAX_IMAGE_ASSET_BYTES_V3;
    expect(validateStudioProjectV3(project)).toBe(true);
    project.assets.asset_piece_1!.byteSize += 1;
    expect(validateStudioProjectV3(project)).toBe(false);
  });

  it('accepts 20 exact one-patch undo entries and rejects 21', () => {
    const project = makeEmptyProjectV3();
    addImportedPieceV3(project, 'piece_1', 'photo');
    project.revision = STUDIO_MAX_UNDO_ENTRIES_V3 + 1;
    project.authoringRevision = STUDIO_MAX_UNDO_ENTRIES_V3 + 1;
    project.undoHistory = Array.from({ length: STUDIO_MAX_UNDO_ENTRIES_V3 }, (_unused, index) => ({
      id: `undo_${index + 1}`,
      sourceRevision: index + 2,
      sourceAuthoringRevision: index + 2,
      label: 'rename_piece',
      patches: [
        {
          kind: 'piece_catalog' as const,
          pieceId: 'piece_1',
          before: { handle: `prior_${index + 1}`, priorHandles: [] },
          afterDigest: digest,
        },
      ],
    }));
    expect(validateStudioProjectV3(project)).toBe(true);
    project.undoHistory.push({
      id: 'undo_21',
      sourceRevision: project.revision,
      sourceAuthoringRevision: project.authoringRevision,
      label: 'rename_piece',
      patches: [
        {
          kind: 'piece_catalog',
          pieceId: 'piece_1',
          before: { handle: 'prior_21', priorHandles: [] },
          afterDigest: digest,
        },
      ],
    });
    expect(validateStudioProjectV3(project)).toBe(false);
  });

  it('requires retained undo authorities to be strictly chronological', () => {
    const project = makeEmptyProjectV3();
    addImportedPieceV3(project, 'piece_1', 'photo');
    project.revision = 4;
    project.authoringRevision = 4;
    project.undoHistory = [
      {
        id: 'undo_1',
        sourceRevision: 3,
        sourceAuthoringRevision: 3,
        label: 'rename_piece',
        patches: [
          {
            kind: 'piece_catalog',
            pieceId: 'piece_1',
            before: { handle: 'photo_before_1', priorHandles: [] },
            afterDigest: digest,
          },
        ],
      },
      {
        id: 'undo_2',
        sourceRevision: 4,
        sourceAuthoringRevision: 4,
        label: 'rename_piece',
        patches: [
          {
            kind: 'piece_catalog',
            pieceId: 'piece_1',
            before: { handle: 'photo_before_2', priorHandles: [] },
            afterDigest: digest,
          },
        ],
      },
    ];
    expect(validateStudioProjectV3(project)).toBe(true);

    const duplicateRevision = structuredClone(project);
    duplicateRevision.undoHistory[1]!.sourceRevision = 3;
    expect(validateStudioProjectV3(duplicateRevision)).toBe(false);

    const reversedAuthoring = structuredClone(project);
    reversedAuthoring.undoHistory[1]!.sourceAuthoringRevision = 2;
    expect(validateStudioProjectV3(reversedAuthoring)).toBe(false);
  });

  it('accepts 32 coherent Jobs and authorizations for one Piece and rejects 33', () => {
    const project = makeRetryProjectV3();
    extendRetryChainV3(project, STUDIO_MAX_JOBS_PER_PIECE_V3);
    expect(project.jobs).toHaveProperty(`job_${STUDIO_MAX_JOBS_PER_PIECE_V3}`);
    expect(project.spendAuthorizations).toHaveLength(STUDIO_MAX_JOBS_PER_PIECE_V3);
    expect(validateStudioProjectV3(project)).toBe(true);

    extendRetryChainV3(project, STUDIO_MAX_JOBS_PER_PIECE_V3 + 1);
    expect(validateStudioProjectV3(project)).toBe(false);
  });

  it('enforces the named Piece bound instead of accepting an unbounded map', () => {
    const project = makeEmptyProjectV3();
    for (let index = 0; index <= STUDIO_MAX_PIECES_V3; index += 1) {
      addImportedPieceV3(project, `piece_${index}`, `piece_${index}`);
    }
    expect(project.pieceOrder).toHaveLength(STUDIO_MAX_PIECES_V3 + 1);
    expect(validateStudioProjectV3(project)).toBe(false);
  });

  it('accepts canonical multilingual handles and rejects noncanonical, over-bound, or ambiguous namespaces', () => {
    const project = makeEmptyProjectV3();
    addImportedPieceV3(project, 'piece_vi', 'ảnh_đêm');
    addImportedPieceV3(project, 'piece_fa', 'شب_تهران');
    addImportedPieceV3(project, 'piece_ja', '東京_夜');
    expect(validateStudioProjectV3(project)).toBe(true);

    const decomposed = structuredClone(project);
    decomposed.pieces.piece_vi!.handle = 'a\u0301nh_đêm';
    expect(validateStudioProjectV3(decomposed)).toBe(false);

    const uppercase = structuredClone(project);
    uppercase.pieces.piece_vi!.handle = 'Ảnh_đêm';
    expect(validateStudioProjectV3(uppercase)).toBe(false);

    const overBound = structuredClone(project);
    overBound.pieces.piece_vi!.handle = 'a'.repeat(STUDIO_MAX_PIECE_HANDLE_SCALARS_V3 + 1);
    expect(validateStudioProjectV3(overBound)).toBe(false);

    const aliasCollision = structuredClone(project);
    aliasCollision.pieces.piece_fa!.priorHandles = ['ảnh_đêm'];
    expect(validateStudioProjectV3(aliasCollision)).toBe(false);
  });

  it('requires exact bidirectional imported and generated Piece ownership', () => {
    const imported = makeEmptyProjectV3();
    addImportedPieceV3(imported, 'piece_1', 'imported_photo');
    expect(validateStudioProjectV3(imported)).toBe(true);

    const wrongImportedOwner = structuredClone(imported);
    wrongImportedOwner.assets.asset_piece_1!.pieceId = 'piece_missing';
    expect(validateStudioProjectV3(wrongImportedOwner)).toBe(false);

    const ownerlessImportedAsset = structuredClone(imported);
    ownerlessImportedAsset.pieces.piece_1!.currentAssetId = null;
    expect(validateStudioProjectV3(ownerlessImportedAsset)).toBe(false);

    const generated = makeGeneratedProjectV3();
    expect(validateStudioProjectV3(generated)).toBe(true);

    const wrongProducerOwner = structuredClone(generated);
    wrongProducerOwner.jobs.job_1!.target.pieceId = 'piece_missing';
    expect(validateStudioProjectV3(wrongProducerOwner)).toBe(false);

    const wrongDigest = structuredClone(generated);
    (wrongDigest.assets.asset_1 as Extract<StudioAssetV3, { origin: 'generated' }>).compositionDigest = digest;
    expect(validateStudioProjectV3(wrongDigest)).toBe(false);

    const assetCollidesWithPiece = structuredClone(generated);
    const pieceCollisionAsset = assetCollidesWithPiece.assets.asset_1!;
    delete assetCollidesWithPiece.assets.asset_1;
    pieceCollisionAsset.id = 'piece_1';
    pieceCollisionAsset.managedAsset.fileName = 'piece_1.png';
    assetCollidesWithPiece.assets.piece_1 = pieceCollisionAsset;
    assetCollidesWithPiece.pieces.piece_1!.currentAssetId = 'piece_1';
    assetCollidesWithPiece.jobs.job_1!.outputAssetId = 'piece_1';
    expect(validateStudioProjectV3(assetCollidesWithPiece)).toBe(false);

    const assetCollidesWithProducer = structuredClone(generated);
    const producerCollisionAsset = assetCollidesWithProducer.assets.asset_1!;
    delete assetCollidesWithProducer.assets.asset_1;
    producerCollisionAsset.id = 'job_1';
    producerCollisionAsset.managedAsset.fileName = 'job_1.png';
    assetCollidesWithProducer.assets.job_1 = producerCollisionAsset;
    assetCollidesWithProducer.pieces.piece_1!.currentAssetId = 'job_1';
    assetCollidesWithProducer.jobs.job_1!.outputAssetId = 'job_1';
    expect(validateStudioProjectV3(assetCollidesWithProducer)).toBe(false);
  });

  it('requires identity-derived managed image names with exact MIME extensions and unique managed paths', () => {
    const exactMimeCases = [
      { mimeType: 'image/jpeg', fileName: 'asset_piece_1.jpg' },
      { mimeType: 'image/png', fileName: 'asset_piece_1.png' },
      { mimeType: 'image/webp', fileName: 'asset_piece_1.webp' },
    ] as const;
    for (const { mimeType, fileName } of exactMimeCases) {
      const project = makeEmptyProjectV3();
      addImportedPieceV3(project, 'piece_1', 'photo');
      project.assets.asset_piece_1!.mimeType = mimeType;
      project.assets.asset_piece_1!.managedAsset.fileName = fileName;
      expect(validateStudioProjectV3(project), `${mimeType} -> ${fileName}`).toBe(true);
    }

    const invalidNames = [
      'asset_piece_1.jpeg',
      'asset_piece_1.PNG',
      'asset_piece_1.webp',
      '../asset_piece_1.png',
      'folder/asset_piece_1.png',
      'folder\\asset_piece_1.png',
      'asset_piece_1.png\u0000',
      'asset_piece_1.\u0001png',
      'asset_piece_1.png.',
      ' asset_piece_1.png',
    ];
    for (const fileName of invalidNames) {
      const project = makeEmptyProjectV3();
      addImportedPieceV3(project, 'piece_1', 'photo');
      project.assets.asset_piece_1!.managedAsset.fileName = fileName;
      expect(validateStudioProjectV3(project), fileName).toBe(false);
    }

    const duplicatePath = makeEmptyProjectV3();
    addImportedPieceV3(duplicatePath, 'piece_1', 'first');
    addImportedPieceV3(duplicatePath, 'piece_2', 'second');
    duplicatePath.assets.asset_piece_2!.managedAsset.fileName =
      duplicatePath.assets.asset_piece_1!.managedAsset.fileName;
    expect(validateStudioProjectV3(duplicatePath)).toBe(false);
  });

  it('does not impose schema-6 canonical image names on schema 5', () => {
    const project = makeProject();
    const asset = addHumanSeed(project);
    asset.managedAsset.fileName = 'legacy-safe-name.jpeg';
    expect(validateStudioProjectV2(project)).toBe(true);
  });

  it('validates historical prompt bytes by stored consistency without recomposing current wording', () => {
    const historical = makeGeneratedProjectV3();
    const oldPrompt = 'Historical provider wording that the current composer does not produce.';
    const historicalProfile = 'weprompt-image-v1.piece-image.v2';
    historical.jobs.job_1!.composition.prompt = oldPrompt;
    historical.jobs.job_1!.composition.inputs.instructionProfile = historicalProfile;
    historical.jobs.job_1!.requestPlan.snapshot.composition.prompt = oldPrompt;
    historical.jobs.job_1!.requestPlan.snapshot.composition.inputs.instructionProfile = historicalProfile;
    historical.spendAuthorizations[0]!.quote.item.requestPlan.snapshot.composition.prompt = oldPrompt;
    historical.spendAuthorizations[0]!.quote.item.requestPlan.snapshot.composition.inputs.instructionProfile =
      historicalProfile;
    (historical.assets.asset_1 as Extract<StudioAssetV3, { origin: 'generated' }>).compositionDigest =
      studioPieceGenerationCompositionDigestV3(historical.jobs.job_1!.composition);
    expect(validateStudioProjectV3(historical)).toBe(true);

    const mismatched = structuredClone(historical);
    mismatched.spendAuthorizations[0]!.quote.item.requestPlan = structuredClone(
      mismatched.spendAuthorizations[0]!.quote.item.requestPlan
    );
    mismatched.spendAuthorizations[0]!.quote.item.requestPlan.snapshot.composition.prompt = 'Changed quote only';
    expect(validateStudioProjectV3(mismatched)).toBe(false);
  });

  it('uses canonical V3 composition equality and digests without depending on object insertion order', () => {
    const project = makeGeneratedProjectV3();
    const original = project.jobs.job_1!.composition;
    const reordered = reorderCompositionKeysV3(original);

    expect(JSON.stringify(reordered)).not.toBe(JSON.stringify(original));
    expect(studioPieceGenerationCompositionsEqualV3(original, reordered)).toBe(true);
    expect(studioPieceGenerationCompositionDigestV3(reordered)).toBe(
      studioPieceGenerationCompositionDigestV3(original)
    );

    project.jobs.job_1!.composition = reordered;
    project.jobs.job_1!.requestPlan.snapshot.composition = structuredClone(reordered);
    project.spendAuthorizations[0]!.quote.item.requestPlan.snapshot.composition = structuredClone(reordered);
    (project.assets.asset_1 as Extract<StudioAssetV3, { origin: 'generated' }>).compositionDigest =
      studioPieceGenerationCompositionDigestV3(reordered);
    expect(validateStudioProjectV3(project)).toBe(true);

    const changed = structuredClone(reordered);
    changed.prompt = `${changed.prompt} Changed.`;
    expect(studioPieceGenerationCompositionsEqualV3(original, changed)).toBe(false);
    expect(studioPieceGenerationCompositionDigestV3(changed)).not.toBe(
      studioPieceGenerationCompositionDigestV3(original)
    );
  });

  it('enforces the exact status-dependent Piece Job lifecycle matrix', () => {
    const validStatuses: StudioPieceJobV3['status'][] = [
      'queued_local',
      'submitting',
      'queued_remote',
      'running',
      'needs_attention',
      'succeeded',
      'failed',
      'cancelled',
    ];
    for (const status of validStatuses) {
      expect(validateStudioProjectV3(makeGeneratedProjectWithJobStatusV3(status)), status).toBe(true);
    }

    const cancelledBeforeSubmission = makeGeneratedProjectWithJobStatusV3('cancelled');
    cancelledBeforeSubmission.jobs.job_1!.providerSubmissionKind = null;
    cancelledBeforeSubmission.jobs.job_1!.providerJobId = null;
    cancelledBeforeSubmission.jobs.job_1!.remoteStartedAt = null;
    expect(validateStudioProjectV3(cancelledBeforeSubmission)).toBe(true);

    const failedBeforeSubmission = makeGeneratedProjectWithJobStatusV3('failed');
    failedBeforeSubmission.jobs.job_1!.providerSubmissionKind = null;
    failedBeforeSubmission.jobs.job_1!.providerJobId = null;
    failedBeforeSubmission.jobs.job_1!.remoteStartedAt = null;
    failedBeforeSubmission.jobs.job_1!.error = { code: 'invalid_request', messageKey: 'invalid_request' };
    expect(validateStudioProjectV3(failedBeforeSubmission)).toBe(true);

    const corruptions: Array<(project: StudioProjectV3) => void> = [
      (project) => {
        project.jobs.job_1!.providerJobId = 'provider_job_1';
        project.jobs.job_1!.remoteStartedAt = confirmedAtV3;
      },
      (project) => {
        project.jobs.job_1!.progress = 1;
      },
      (project) => {
        project.jobs.job_1!.providerJobId = null;
        project.jobs.job_1!.remoteStartedAt = null;
      },
      (project) => {
        project.jobs.job_1!.providerJobId = null;
        project.jobs.job_1!.remoteStartedAt = null;
      },
      (project) => {
        project.jobs.job_1!.error = null;
      },
      (project) => {
        project.jobs.job_1!.error = null;
      },
      (project) => {
        project.jobs.job_1!.error = { code: 'timeout', messageKey: 'timeout' };
      },
      (project) => {
        project.jobs.job_1!.spendReceipt = null;
      },
    ];
    const invalidStatuses: StudioPieceJobV3['status'][] = [
      'queued_local',
      'submitting',
      'queued_remote',
      'running',
      'needs_attention',
      'failed',
      'cancelled',
      'succeeded',
    ];
    for (let index = 0; index < invalidStatuses.length; index += 1) {
      const project = makeGeneratedProjectWithJobStatusV3(invalidStatuses[index]!);
      corruptions[index]!(project);
      expect(validateStudioProjectV3(project), invalidStatuses[index]).toBe(false);
    }

    const halfRemoteIdentity = makeGeneratedProjectWithJobStatusV3('needs_attention');
    halfRemoteIdentity.jobs.job_1!.providerSubmissionKind = 'remote';
    halfRemoteIdentity.jobs.job_1!.providerJobId = 'provider_job_1';
    halfRemoteIdentity.jobs.job_1!.error = { code: 'poll_deadline', messageKey: 'poll_deadline' };
    halfRemoteIdentity.jobs.job_1!.remoteStartedAt = null;
    expect(validateStudioProjectV3(halfRemoteIdentity)).toBe(false);

    const wrongErrorState = makeGeneratedProjectWithJobStatusV3('needs_attention');
    wrongErrorState.jobs.job_1!.error = { code: 'variation_grid', messageKey: 'variation_grid' };
    expect(validateStudioProjectV3(wrongErrorState)).toBe(false);

    for (const code of [
      'invalid_request',
      'content_rejected',
      'auth',
      'quota',
      'rate_limited',
      'provider_unavailable',
      'timeout',
      'no_output',
      'variation_grid',
      'download_failed',
      'unsupported',
      'unknown',
    ] as const) {
      const unsupportedRecoveryState = makeGeneratedProjectWithJobStatusV3('needs_attention');
      unsupportedRecoveryState.jobs.job_1!.error = { code, messageKey: code };
      expect(validateStudioProjectV3(unsupportedRecoveryState), code).toBe(false);
    }
  });

  it('requires complete remote authority for receipt-bearing failures and poll-deadline recovery', () => {
    const removeGeneratedOutput = (project: StudioProjectV3): StudioPieceJobV3 => {
      const job = project.jobs.job_1!;
      job.outputAssetId = null;
      job.progress = null;
      delete project.assets.asset_1;
      project.pieces.piece_1!.currentAssetId = null;
      return job;
    };
    const invalidateRemoteAuthority = (
      project: StudioProjectV3,
      identity: 'missing' | 'missing_provider_job' | 'missing_started_at'
    ): void => {
      const job = project.jobs.job_1!;
      if (identity !== 'missing_started_at') job.providerJobId = null;
      if (identity !== 'missing_provider_job') job.remoteStartedAt = null;
    };

    for (const code of ['no_output', 'variation_grid', 'download_failed'] as const) {
      const valid = makeGeneratedProjectV3();
      const validJob = removeGeneratedOutput(valid);
      validJob.status = 'failed';
      validJob.error = { code, messageKey: code };
      expect(validateStudioProjectV3(valid), `${code}: valid`).toBe(true);

      for (const identity of ['missing', 'missing_provider_job', 'missing_started_at'] as const) {
        const invalid = structuredClone(valid);
        invalidateRemoteAuthority(invalid, identity);
        expect(validateStudioProjectV3(invalid), `${code}: ${identity}`).toBe(false);
      }
    }

    for (const withReceipt of [false, true]) {
      const valid = makeGeneratedProjectV3();
      const validJob = removeGeneratedOutput(valid);
      validJob.status = 'needs_attention';
      validJob.error = { code: 'poll_deadline', messageKey: 'poll_deadline' };
      if (!withReceipt) validJob.spendReceipt = null;
      expect(validateStudioProjectV3(valid), `poll_deadline receipt=${withReceipt}: valid`).toBe(true);

      for (const identity of ['missing', 'missing_provider_job', 'missing_started_at'] as const) {
        const invalid = structuredClone(valid);
        invalidateRemoteAuthority(invalid, identity);
        expect(validateStudioProjectV3(invalid), `poll_deadline receipt=${withReceipt}: ${identity}`).toBe(false);
      }
    }

    const deadEnd = makeGeneratedProjectV3();
    const deadEndJob = removeGeneratedOutput(deadEnd);
    deadEndJob.status = 'failed';
    deadEndJob.error = { code: 'poll_deadline', messageKey: 'poll_deadline' };
    deadEndJob.spendReceipt = null;
    expect(validateStudioProjectV3(deadEnd), 'poll_deadline must remain resumable').toBe(false);
  });

  it('treats complete versus remote provider submission as exact immutable authority', () => {
    const complete = makeGeneratedProjectV3();
    complete.jobs.job_1!.providerSubmissionKind = 'complete';
    complete.jobs.job_1!.providerJobId = null;
    complete.jobs.job_1!.remoteStartedAt = null;
    expect(validateStudioProjectV3(complete)).toBe(true);

    const collidingRemoteId = makeGeneratedProjectV3();
    collidingRemoteId.jobs.job_1!.providerJobId = `local_${collidingRemoteId.jobs.job_1!.id}`;
    expect(validateStudioProjectV3(collidingRemoteId)).toBe(true);

    const completeWithRemoteIdentity = structuredClone(complete);
    completeWithRemoteIdentity.jobs.job_1!.providerJobId = 'provider_job_forbidden';
    completeWithRemoteIdentity.jobs.job_1!.remoteStartedAt = confirmedAtV3;
    expect(validateStudioProjectV3(completeWithRemoteIdentity)).toBe(false);

    const missingRemoteIdentity = makeGeneratedProjectV3();
    missingRemoteIdentity.jobs.job_1!.providerJobId = null;
    missingRemoteIdentity.jobs.job_1!.remoteStartedAt = null;
    expect(validateStudioProjectV3(missingRemoteIdentity)).toBe(false);

    const paidCompleteHandoffFailure = structuredClone(complete);
    paidCompleteHandoffFailure.pieces.piece_1!.currentAssetId = null;
    paidCompleteHandoffFailure.assets = {};
    Object.assign(paidCompleteHandoffFailure.jobs.job_1!, {
      status: 'needs_attention',
      outputAssetId: null,
      progress: null,
      error: { code: 'submission_unknown', messageKey: 'submission_unknown' },
    });
    expect(validateStudioProjectV3(paidCompleteHandoffFailure)).toBe(true);
    paidCompleteHandoffFailure.jobs.job_1!.spendReceipt = null;
    expect(validateStudioProjectV3(paidCompleteHandoffFailure)).toBe(false);
  });

  it('rejects authorization, Job, acknowledgement, remote, and receipt timestamps outside their authority window', () => {
    const corruptions: Array<(project: StudioProjectV3) => void> = [
      (project) => {
        project.spendAuthorizations[0]!.confirmedAt = '2026-08-29T23:59:59.000Z';
      },
      (project) => {
        project.jobs.job_1!.createdAt = timestampV3;
        project.jobs.job_1!.remoteStartedAt = timestampV3;
      },
      (project) => {
        project.jobs.job_1!.remoteStartedAt = timestampV3;
      },
      (project) => {
        project.jobs.job_1!.remoteStartedAt = '2026-08-30T00:00:03.000Z';
      },
      (project) => {
        project.jobs.job_1!.spendReceipt!.recordedAt = timestampV3;
      },
      (project) => {
        project.jobs.job_1!.spendReceipt!.recordedAt = '2026-08-30T00:00:03.000Z';
      },
    ];
    for (const corrupt of corruptions) {
      const project = makeGeneratedProjectV3();
      corrupt(project);
      expect(validateStudioProjectV3(project)).toBe(false);
    }

    const makeAcknowledgedRetry = (): StudioProjectV3 => {
      const project = makeRetryProjectV3();
      project.jobs.job_1!.status = 'needs_attention';
      project.jobs.job_1!.providerSubmissionKind = null;
      project.jobs.job_1!.providerJobId = null;
      project.jobs.job_1!.remoteStartedAt = null;
      project.jobs.job_1!.error = { code: 'submission_unknown', messageKey: 'submission_unknown' };
      project.jobs.job_2!.retryReason = 'submission_unknown';
      project.jobs.job_2!.duplicateChargeAcknowledged = true;
      project.jobs.job_2!.duplicateChargeAcknowledgedAt = '2026-08-30T00:00:04.000Z';
      return project;
    };
    expect(validateStudioProjectV3(makeAcknowledgedRetry())).toBe(true);

    const acknowledgementBeforeAuthorization = makeAcknowledgedRetry();
    acknowledgementBeforeAuthorization.jobs.job_2!.duplicateChargeAcknowledgedAt = '2026-08-30T00:00:03.000Z';
    expect(validateStudioProjectV3(acknowledgementBeforeAuthorization)).toBe(false);

    const acknowledgementAfterJobCreation = makeAcknowledgedRetry();
    acknowledgementAfterJobCreation.jobs.job_2!.duplicateChargeAcknowledgedAt = '2026-08-30T00:00:05.000Z';
    expect(validateStudioProjectV3(acknowledgementAfterJobCreation)).toBe(false);
  });

  it('requires Piece, Job, generated asset, retry, frozen-rule, and remote-receipt chronology', () => {
    const jobBeforePiece = makeGeneratedProjectV3();
    jobBeforePiece.pieces.piece_1!.createdAt = completedAtV3;
    expect(validateStudioProjectV3(jobBeforePiece)).toBe(false);

    const jobAfterPiece = makeRetryProjectV3();
    jobAfterPiece.jobs.job_2!.createdAt = '2026-08-30T00:00:05.000Z';
    jobAfterPiece.jobs.job_2!.updatedAt = '2026-08-30T00:00:05.000Z';
    jobAfterPiece.updatedAt = '2026-08-30T00:00:05.000Z';
    expect(validateStudioProjectV3(jobAfterPiece)).toBe(false);

    const assetBeforeProducer = makeGeneratedProjectV3();
    assetBeforeProducer.pieces.piece_1!.createdAt = timestampV3;
    assetBeforeProducer.assets.asset_1!.createdAt = timestampV3;
    expect(validateStudioProjectV3(assetBeforeProducer)).toBe(false);

    const assetAfterProducer = makeGeneratedProjectV3();
    assetAfterProducer.jobs.job_1!.updatedAt = confirmedAtV3;
    assetAfterProducer.jobs.job_1!.spendReceipt!.recordedAt = confirmedAtV3;
    expect(validateStudioProjectV3(assetAfterProducer)).toBe(false);

    const predecessorOverlapsRetry = makeRetryProjectV3();
    predecessorOverlapsRetry.jobs.job_1!.updatedAt = '2026-08-30T00:00:05.000Z';
    predecessorOverlapsRetry.pieces.piece_1!.updatedAt = '2026-08-30T00:00:05.000Z';
    predecessorOverlapsRetry.updatedAt = '2026-08-30T00:00:05.000Z';
    expect(validateStudioProjectV3(predecessorOverlapsRetry)).toBe(false);

    const withFrozenRuleAt = (createdAt: string): StudioProjectV3 => {
      const project = makeGeneratedProjectV3();
      const rule = {
        id: 'rule_1',
        scope: 'project' as const,
        text: 'Keep the portrait quiet.',
        predicate: null,
        createdAt,
      };
      project.jobs.job_1!.composition.inputs.rules = [structuredClone(rule)];
      project.jobs.job_1!.requestPlan.snapshot.composition.inputs.rules = [structuredClone(rule)];
      project.spendAuthorizations[0]!.quote.item.requestPlan.snapshot.composition.inputs.rules = [
        structuredClone(rule),
      ];
      (project.assets.asset_1 as Extract<StudioAssetV3, { origin: 'generated' }>).compositionDigest =
        studioPieceGenerationCompositionDigestV3(project.jobs.job_1!.composition);
      return project;
    };
    expect(validateStudioProjectV3(withFrozenRuleAt(timestampV3))).toBe(true);
    expect(validateStudioProjectV3(withFrozenRuleAt('2026-08-29T23:59:59.999Z'))).toBe(false);
    expect(validateStudioProjectV3(withFrozenRuleAt(completedAtV3))).toBe(false);

    const receiptBeforeRemoteStart = makeGeneratedProjectV3();
    receiptBeforeRemoteStart.jobs.job_1!.remoteStartedAt = completedAtV3;
    receiptBeforeRemoteStart.jobs.job_1!.spendReceipt!.recordedAt = confirmedAtV3;
    expect(validateStudioProjectV3(receiptBeforeRemoteStart)).toBe(false);
  });

  it('requires unique reservation authority and ordered, disjoint authorization commits', () => {
    const project = makeRetryProjectV3();
    expect(validateStudioProjectV3(project)).toBe(true);

    const duplicateReservation = structuredClone(project);
    const firstReservationId = duplicateReservation.spendAuthorizations[0]!.quote.reservationId;
    const secondAuthorization = duplicateReservation.spendAuthorizations[1]!;
    secondAuthorization.quote.reservationId = firstReservationId;
    const itemId = createStudioPieceQuotedGenerationIdV3({
      projectId: duplicateReservation.id,
      reservationId: firstReservationId,
      quoteId: secondAuthorization.quote.id,
      quoteRevision: secondAuthorization.quote.quoteRevision,
      target: secondAuthorization.quote.item.target,
      purpose: secondAuthorization.quote.item.purpose,
    });
    secondAuthorization.quote.item.id = itemId;
    secondAuthorization.providerBinding.itemId = itemId;
    secondAuthorization.idempotencyKey.itemId = itemId;
    duplicateReservation.jobs.job_2!.authorizationItemId = itemId;
    expect(validateStudioProjectV3(duplicateReservation)).toBe(false);

    const reversedRevision = structuredClone(project);
    reversedRevision.spendAuthorizations[1]!.projectRevisionAtAuthorization = 2;
    reversedRevision.jobs.job_2!.projectRevisionAtAuthorization = 2;
    expect(validateStudioProjectV3(reversedRevision)).toBe(false);

    const reversedTime = structuredClone(project);
    reversedTime.spendAuthorizations[1]!.confirmedAt = timestampV3;
    reversedTime.jobs.job_2!.createdAt = timestampV3;
    reversedTime.jobs.job_2!.updatedAt = timestampV3;
    expect(validateStudioProjectV3(reversedTime)).toBe(false);

    const overlapsUndo = structuredClone(project);
    overlapsUndo.undoHistory = [
      {
        id: 'undo_1',
        sourceRevision: 4,
        sourceAuthoringRevision: 2,
        label: 'rename_piece',
        patches: [
          {
            kind: 'piece_catalog',
            pieceId: 'piece_1',
            before: { handle: 'quiet_portrait_before', priorHandles: [] },
            afterDigest: digest,
          },
        ],
      },
    ];
    expect(validateStudioProjectV3(overlapsUndo)).toBe(false);
  });

  it('fails closed on cross-contract quote, authorization, receipt, Job, and Piece mismatches', () => {
    const corruptions: Array<(project: StudioProjectV3) => void> = [
      (project) => {
        project.spendAuthorizations[0]!.quote.item.target.pieceId = 'piece_missing';
      },
      (project) => {
        project.spendAuthorizations[0]!.providerBinding.itemId = 'item_missing';
      },
      (project) => {
        const authorization = project.spendAuthorizations[0]!;
        authorization.id = project.id;
        project.jobs.job_1!.authorizationId = project.id;
        project.jobs.job_1!.spendReceipt!.authorizationId = project.id;
      },
      (project) => {
        const authorization = project.spendAuthorizations[0]!;
        authorization.quote.reservationId = 'job_1';
        const itemId = createStudioPieceQuotedGenerationIdV3({
          projectId: project.id,
          reservationId: 'job_1',
          quoteId: authorization.quote.id,
          quoteRevision: authorization.quote.quoteRevision,
          target: authorization.quote.item.target,
          purpose: authorization.quote.item.purpose,
        });
        authorization.quote.item.id = itemId;
        authorization.providerBinding.itemId = itemId;
        authorization.idempotencyKey.itemId = itemId;
        project.jobs.job_1!.authorizationItemId = itemId;
        project.jobs.job_1!.spendReceipt!.itemId = itemId;
      },
      (project) => {
        project.spendAuthorizations[0]!.idempotencyKey.key = 'piece_1';
        project.jobs.job_1!.idempotencyKey = 'piece_1';
      },
      (project) => {
        const itemId = `item_${'f'.repeat(64)}`;
        const authorization = project.spendAuthorizations[0]!;
        authorization.quote.item.id = itemId;
        authorization.providerBinding.itemId = itemId;
        authorization.idempotencyKey.itemId = itemId;
        project.jobs.job_1!.authorizationItemId = itemId;
        project.jobs.job_1!.spendReceipt!.itemId = itemId;
      },
      (project) => {
        project.jobs.job_1!.cancellationPolicy = 'none';
      },
      (project) => {
        const authorization = project.spendAuthorizations[0]!;
        authorization.id = authorization.quote.id;
        project.jobs.job_1!.authorizationId = authorization.id;
        project.jobs.job_1!.spendReceipt!.authorizationId = authorization.id;
      },
      (project) => {
        project.jobs.job_1!.authorizationId = 'authorization_missing';
      },
      (project) => {
        project.jobs.job_1!.spendReceipt!.totalMinorUnits += 1;
      },
      (project) => {
        project.pieces.piece_1!.jobIds = [];
      },
      (project) => {
        project.jobs.job_1!.requestPlan.snapshot.settings.aspectRatio = '16:9';
      },
      (project) => {
        project.spendAuthorizations[0]!.projectRevisionAtAuthorization = 1;
        project.jobs.job_1!.projectRevisionAtAuthorization = 1;
      },
      (project) => {
        project.assets.asset_1!.createdAt = timestampV3;
      },
      (project) => {
        const words = 'A  quiet portrait';
        project.jobs.job_1!.composition.inputs.source.words = words;
        project.jobs.job_1!.requestPlan.snapshot.composition.inputs.source.words = words;
        project.spendAuthorizations[0]!.quote.item.requestPlan.snapshot.composition.inputs.source.words = words;
        (project.assets.asset_1 as Extract<StudioAssetV3, { origin: 'generated' }>).compositionDigest =
          studioPieceGenerationCompositionDigestV3(project.jobs.job_1!.composition);
      },
    ];
    for (const corrupt of corruptions) {
      const project = makeGeneratedProjectV3();
      corrupt(project);
      expect(validateStudioProjectV3(project)).toBe(false);
    }
  });

  it('requires same-Piece retry lineage, copied words/settings, one child, and exact reason mapping', () => {
    const project = makeRetryProjectV3();
    expect(validateStudioProjectV3(project)).toBe(true);

    const wrongPiece = structuredClone(project);
    wrongPiece.jobs.job_2!.target.pieceId = 'piece_missing';
    expect(validateStudioProjectV3(wrongPiece)).toBe(false);

    const editedRetry = structuredClone(project);
    editedRetry.jobs.job_2!.composition.inputs.source.words = 'Edited retry wording';
    editedRetry.jobs.job_2!.requestPlan.snapshot.composition.inputs.source.words = 'Edited retry wording';
    editedRetry.spendAuthorizations[1]!.quote.item.requestPlan.snapshot.composition.inputs.source.words =
      'Edited retry wording';
    expect(validateStudioProjectV3(editedRetry)).toBe(false);

    const wrongReason = structuredClone(project);
    wrongReason.jobs.job_2!.retryReason = 'cancelled';
    expect(validateStudioProjectV3(wrongReason)).toBe(false);

    const cycle = structuredClone(project);
    cycle.jobs.job_1!.retryOfJobId = 'job_2';
    cycle.jobs.job_1!.retryReason = 'provider_failure';
    expect(validateStudioProjectV3(cycle)).toBe(false);

    const duplicateChild = structuredClone(project);
    const duplicateAuthorization = structuredClone(duplicateChild.spendAuthorizations[1]!);
    duplicateAuthorization.id = 'authorization_3';
    duplicateAuthorization.quote.id = 'quote_3';
    duplicateAuthorization.quote.item.id = 'item_3';
    duplicateAuthorization.providerBinding.itemId = 'item_3';
    duplicateAuthorization.idempotencyKey = { itemId: 'item_3', key: 'idempotency_3' };
    duplicateChild.spendAuthorizations.push(duplicateAuthorization);
    duplicateChild.jobs.job_3 = {
      ...structuredClone(duplicateChild.jobs.job_2!),
      id: 'job_3',
      authorizationId: 'authorization_3',
      authorizationItemId: 'item_3',
      idempotencyKey: 'idempotency_3',
    };
    duplicateChild.pieces.piece_1!.jobIds.push('job_3');
    duplicateChild.revision += 1;
    expect(validateStudioProjectV3(duplicateChild)).toBe(false);
  });

  it('derives paid-retry reasons without turning download or poll recovery into a new charge', () => {
    const ordinaryProviderFailures: StudioPieceJobV3['error'][] = [
      { code: 'invalid_request', messageKey: 'invalid_request' },
      { code: 'content_rejected', messageKey: 'content_rejected' },
      { code: 'auth', messageKey: 'auth' },
      { code: 'quota', messageKey: 'quota' },
      { code: 'rate_limited', messageKey: 'rate_limited' },
      { code: 'provider_unavailable', messageKey: 'provider_unavailable' },
      { code: 'timeout', messageKey: 'timeout' },
      { code: 'no_output', messageKey: 'no_output' },
      { code: 'unsupported', messageKey: 'unsupported' },
      { code: 'unknown', messageKey: 'unknown' },
    ];
    for (const error of ordinaryProviderFailures) {
      expect(studioPieceRetryReasonForPredecessorV3({ status: 'failed', error })).toBe('provider_failure');
    }

    expect(
      studioPieceRetryReasonForPredecessorV3({
        status: 'needs_attention',
        error: { code: 'submission_unknown', messageKey: 'submission_unknown' },
      })
    ).toBe('submission_unknown');
    expect(
      studioPieceRetryReasonForPredecessorV3({
        status: 'failed',
        error: { code: 'variation_grid', messageKey: 'variation_grid' },
      })
    ).toBe('variation_grid');
    expect(studioPieceRetryReasonForPredecessorV3({ status: 'cancelled', error: null })).toBe('cancelled');

    for (const code of ['download_failed', 'poll_deadline'] as const) {
      expect(
        studioPieceRetryReasonForPredecessorV3({ status: 'failed', error: { code, messageKey: code } })
      ).toBeNull();
      const project = makeRetryProjectV3();
      project.jobs.job_1!.error = { code, messageKey: code };
      if (code === 'download_failed') {
        project.jobs.job_1!.spendReceipt = makeGeneratedProjectV3().jobs.job_1!.spendReceipt;
      }
      expect(validateStudioProjectV3(project)).toBe(false);
    }

    expect(
      studioPieceRetryReasonForPredecessorV3({
        status: 'needs_attention',
        error: { code: 'timeout', messageKey: 'timeout' },
      })
    ).toBeNull();
    expect(studioPieceRetryReasonForPredecessorV3({ status: 'succeeded', error: null })).toBeNull();
    expect(studioPieceRetryReasonForPredecessorV3({ status: 'queued_local', error: null })).toBeNull();
  });

  it('requires duplicate-charge acknowledgement and timestamp exactly for submission-unknown retry', () => {
    const project = makeRetryProjectV3();
    project.jobs.job_1!.status = 'needs_attention';
    project.jobs.job_1!.providerSubmissionKind = null;
    project.jobs.job_1!.providerJobId = null;
    project.jobs.job_1!.remoteStartedAt = null;
    project.jobs.job_1!.error = { code: 'submission_unknown', messageKey: 'submission_unknown' };
    project.jobs.job_2!.retryReason = 'submission_unknown';
    project.jobs.job_2!.duplicateChargeAcknowledged = true;
    project.jobs.job_2!.duplicateChargeAcknowledgedAt = '2026-08-30T00:00:04.000Z';
    expect(validateStudioProjectV3(project)).toBe(true);

    project.jobs.job_2!.duplicateChargeAcknowledged = false;
    project.jobs.job_2!.duplicateChargeAcknowledgedAt = null;
    expect(validateStudioProjectV3(project)).toBe(false);
  });

  it('rejects accessors and proxies without invoking input code', () => {
    const project = makeEmptyProjectV3();
    let getterCalls = 0;
    Object.defineProperty(project, 'pieces', {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        return {};
      },
    });
    expect(validateStudioProjectV3(project)).toBe(false);
    expect(getterCalls).toBe(0);
    expect(validateStudioProjectV3(new Proxy(makeEmptyProjectV3(), {}))).toBe(false);
  });
});

describe('validateStudioProjectV4 exact schema-7 Wave-1 contract', () => {
  it('accepts one board and an Assembly whose picture sequence exists only on the board', () => {
    const project = makePhase6Project();

    expect(validateStudioProjectV4(project)).toBe(true);
    expect(Object.hasOwn(project.assemblies.assembly_1!, 'pictureOrder')).toBe(false);
  });

  it('requires exact schema-7 run lineage while leaving the schema-6 Piece contract unchanged', () => {
    const sharedStem = 'harbour_attempt';
    const duplicateStems = makePhase6Project();
    duplicateStems.pieces.piece_photo_1!.runStem = sharedStem;
    duplicateStems.pieceOrder.push('piece_photo_2');
    duplicateStems.pieces.piece_photo_2 = {
      ...structuredClone(duplicateStems.pieces.piece_photo_1!),
      id: 'piece_photo_2',
      handle: 'harbour_attempt_2',
      currentAssetId: 'asset_photo_2',
    };
    duplicateStems.assets.asset_photo_2 = {
      ...structuredClone(duplicateStems.assets.asset_photo_1!),
      id: 'asset_photo_2',
      pieceId: 'piece_photo_2',
      managedAsset: { collection: 'imports', fileName: 'asset_photo_2.png' },
      sha256: 'b'.repeat(64),
    };
    expect(validateStudioProjectV4(duplicateStems)).toBe(true);

    const missing = makePhase6Project() as StudioProjectV4 & {
      pieces: Record<string, Omit<StudioProjectV4['pieces'][string], 'runStem'> & { runStem?: string | null }>;
    };
    delete missing.pieces.piece_photo_1!.runStem;
    expect(validateStudioProjectV4(missing)).toBe(false);

    const invalid = makePhase6Project();
    invalid.pieces.piece_photo_1!.runStem = '../not_canonical';
    expect(validateStudioProjectV4(invalid)).toBe(false);

    const schemaSix = makeGeneratedProjectV3() as StudioProjectV3 & {
      pieces: Record<string, StudioProjectV3['pieces'][string] & { runStem?: string | null }>;
    };
    schemaSix.pieces.piece_1!.runStem = null;
    expect(validateStudioProjectV3(schemaSix)).toBe(false);
  });

  it('keeps rule identities inside the schema-7 durable identity namespace', () => {
    const project = makePhase6Project();
    project.rules = [
      {
        id: 'rule_1',
        scope: 'project',
        text: 'No visible logos',
        predicate: null,
        createdAt: PHASE_6_CURRENT_AT,
      },
    ];
    project.bin = [
      {
        id: 'rule_1',
        subject: { kind: 'assembly', assemblyId: 'assembly_1' },
        reason: 'lifted',
        liftedAt: PHASE_6_CURRENT_AT,
      },
    ];

    expect(validateStudioProjectV4(project)).toBe(false);

    const projectCollision = makePhase6Project();
    projectCollision.rules = [{ ...project.rules[0]!, id: projectCollision.id }];
    expect(validateStudioProjectV4(projectCollision)).toBe(false);
  });

  it('rejects identity collisions inside one Board as well as across owners', () => {
    const project = makePhase6Project();
    const beat = project.boards.board_1!.beats.beat_1!;
    project.boards.board_1!.beatOrder = ['board_1'];
    project.boards.board_1!.beats = { board_1: { ...beat, id: 'board_1' } };

    expect(validateStudioProjectV4(project)).toBe(false);
  });

  it('rejects schema 6 and missing or invented schema-7 collections instead of defaulting them', () => {
    const schemaSix = createEmptyStudioProjectV3({ name: 'Pilot', brief: '' }, 'project_6', timestampV3);
    const missingBin = makePhase6Project() as StudioProjectV4 & { bin?: StudioProjectV4['bin'] };
    delete missingBin.bin;
    const inventedOrder = makePhase6Project() as StudioProjectV4 & { canvasBlockOrder?: string[] };
    inventedOrder.canvasBlockOrder = [];

    expect(validateStudioProjectV4(schemaSix)).toBe(false);
    expect(validateStudioProjectV4(missingBin)).toBe(false);
    expect(validateStudioProjectV4(inventedOrder)).toBe(false);
  });

  it('allows one project-owned Piece to be bound by several Assemblies without copying its asset', () => {
    const project = makePhase6Project();
    project.assemblyOrder.push('assembly_2');
    project.assemblies.assembly_2 = {
      ...structuredClone(project.assemblies.assembly_1!),
      id: 'assembly_2',
      handle: 'alternate_cut',
    };

    expect(validateStudioProjectV4(project)).toBe(true);
    expect(project.assemblies.assembly_1!.pictureBindings.shot_1!.source).toEqual({
      pieceId: 'piece_photo_1',
      assetId: 'asset_photo_1',
    });
    expect(project.assemblies.assembly_2!.pictureBindings.shot_1!.source).toEqual({
      pieceId: 'piece_photo_1',
      assetId: 'asset_photo_1',
    });
  });

  it('fails closed when a binding invents an asset or stores a second picture order', () => {
    const unknownAsset = makePhase6Project();
    unknownAsset.assemblies.assembly_1!.pictureBindings.shot_1!.source = {
      pieceId: 'piece_photo_1',
      assetId: 'asset_missing',
    };
    const orderedAssembly = makePhase6Project() as StudioProjectV4 & {
      assemblies: Record<string, StudioProjectV4['assemblies'][string] & { pictureOrder?: string[] }>;
    };
    orderedAssembly.assemblies.assembly_1!.pictureOrder = ['shot_1', 'shot_2'];

    expect(validateStudioProjectV4(unknownAsset)).toBe(false);
    expect(validateStudioProjectV4(orderedAssembly)).toBe(false);
  });

  it('requires the exact asset to belong to the Piece named by an Assembly binding', () => {
    const project = makePhase6Project();
    const firstPiece = project.pieces.piece_photo_1!;
    const firstAsset = project.assets.asset_photo_1!;
    project.pieceOrder.push('piece_photo_2');
    project.pieces.piece_photo_2 = {
      ...structuredClone(firstPiece),
      id: 'piece_photo_2',
      handle: 'harbour_evening',
      currentAssetId: 'asset_photo_2',
    };
    project.assets.asset_photo_2 = {
      ...structuredClone(firstAsset),
      id: 'asset_photo_2',
      pieceId: 'piece_photo_2',
      managedAsset: { collection: 'imports', fileName: 'asset_photo_2.png' },
      sha256: 'b'.repeat(64),
    };
    expect(validateStudioProjectV4(project)).toBe(true);

    project.assemblies.assembly_1!.pictureBindings.shot_1!.source = {
      pieceId: 'piece_photo_1',
      assetId: 'asset_photo_2',
    };
    expect(validateStudioProjectV4(project)).toBe(false);
  });

  it('distinguishes an unplanned slate from a planned Piece whose media is not ready', () => {
    const currentPiece = makePhase6Project();
    currentPiece.assemblies.assembly_1!.pictureBindings.shot_2!.source = {
      pieceId: 'piece_photo_1',
      assetId: null,
    };
    expect(validateStudioProjectV4(currentPiece)).toBe(false);

    const pendingV3 = makeGeneratedProjectWithJobStatusV3('queued_local');
    const scaffold = makePhase6Project();
    const planned: StudioProjectV4 = {
      ...pendingV3,
      schemaVersion: 7,
      pieces: Object.fromEntries(
        Object.entries(pendingV3.pieces).map(([pieceId, piece]) => [pieceId, { ...piece, runStem: null }])
      ),
      boardOrder: [...scaffold.boardOrder],
      boards: structuredClone(scaffold.boards),
      assemblyOrder: [...scaffold.assemblyOrder],
      assemblies: structuredClone(scaffold.assemblies),
      bin: [],
      updatedAt: PHASE_6_CURRENT_AT,
    };
    planned.assemblies.assembly_1!.pictureBindings.shot_1!.source = null;
    planned.assemblies.assembly_1!.pictureBindings.shot_2!.source = {
      pieceId: 'piece_1',
      assetId: null,
    };
    expect(validateStudioProjectV4(planned)).toBe(true);

    const inventedPiece = structuredClone(planned);
    inventedPiece.assemblies.assembly_1!.pictureBindings.shot_2!.source = {
      pieceId: 'piece_missing',
      assetId: null,
    };
    expect(validateStudioProjectV4(inventedPiece)).toBe(false);

    const trimmedMissingMedia = structuredClone(planned);
    trimmedMissingMedia.assemblies.assembly_1!.pictureBindings.shot_2!.sourceInSeconds = 1;
    expect(validateStudioProjectV4(trimmedMissingMedia)).toBe(false);

    const staleSlate = makePhase6Project();
    staleSlate.assemblies.assembly_1!.pictureBindings.shot_2!.staleness = {
      cause: 'chain',
      upstreamShotId: 'shot_1',
      sourceAuthoringRevision: 2,
      keptAt: null,
    };
    expect(validateStudioProjectV4(staleSlate)).toBe(false);

    const stalePlanned = structuredClone(planned);
    stalePlanned.assemblies.assembly_1!.pictureBindings.shot_2!.staleness = {
      cause: 'chain',
      upstreamShotId: 'shot_1',
      sourceAuthoringRevision: 2,
      keptAt: null,
    };
    expect(validateStudioProjectV4(stalePlanned)).toBe(false);
  });

  it('reserves absolute source bounds for timed media and rejects image trimming plus schema-5 vocabulary', () => {
    const bounded = makePhase6Project();
    bounded.assemblies.assembly_1!.pictureBindings.shot_1!.sourceOutSeconds = 5;
    expect(validateStudioProjectV4(bounded)).toBe(false);

    const nonzeroStart = makePhase6Project();
    nonzeroStart.assemblies.assembly_1!.pictureBindings.shot_1!.sourceInSeconds = 5;
    expect(validateStudioProjectV4(nonzeroStart)).toBe(false);

    for (const invalid of [-0, Number.NaN, Number.POSITIVE_INFINITY, 86_401]) {
      const invalidBound = makePhase6Project();
      invalidBound.assemblies.assembly_1!.pictureBindings.shot_1!.sourceInSeconds = invalid;
      expect(validateStudioProjectV4(invalidBound)).toBe(false);
    }

    const legacy = makePhase6Project() as StudioProjectV4 & {
      assemblies: Record<
        string,
        StudioProjectV4['assemblies'][string] & {
          pictureBindings: Record<
            string,
            StudioProjectV4['assemblies'][string]['pictureBindings'][string] & {
              trimInSeconds?: number;
              trimOutSeconds?: number | null;
            }
          >;
        }
      >;
    };
    const binding = legacy.assemblies.assembly_1!.pictureBindings.shot_1!;
    binding.trimInSeconds = binding.sourceInSeconds;
    binding.trimOutSeconds = binding.sourceOutSeconds;
    delete (binding as Partial<typeof binding>).sourceInSeconds;
    delete (binding as Partial<typeof binding>).sourceOutSeconds;
    expect(validateStudioProjectV4(legacy)).toBe(false);
  });

  it('enforces chain-only picture staleness against the actual predecessor', () => {
    const project = makePhase6Project();
    project.assemblies.assembly_1!.pictureBindings.shot_2!.source = {
      pieceId: 'piece_photo_1',
      assetId: 'asset_photo_1',
    };
    project.assemblies.assembly_1!.pictureBindings.shot_2!.staleness = {
      cause: 'chain',
      upstreamShotId: 'shot_1',
      sourceAuthoringRevision: 2,
      keptAt: null,
    };
    expect(validateStudioProjectV4(project)).toBe(true);

    project.assemblies.assembly_1!.pictureBindings.shot_2!.staleness!.upstreamShotId = 'shot_missing';
    expect(validateStudioProjectV4(project)).toBe(false);

    const wrongExistingPredecessor = makePhase6Project();
    const board = wrongExistingPredecessor.boards.board_1!;
    board.beats.beat_1!.shotOrder.push('shot_3');
    board.shots.shot_3 = {
      id: 'shot_3',
      shootingScript: 'The wake fills the frame.',
      durationSeconds: 5,
      createdAt: PHASE_6_CURRENT_AT,
      updatedAt: PHASE_6_CURRENT_AT,
    };
    wrongExistingPredecessor.assemblies.assembly_1!.pictureBindings.shot_3 = {
      shotId: 'shot_3',
      source: { pieceId: 'piece_photo_1', assetId: 'asset_photo_1' },
      sourceInSeconds: 0,
      sourceOutSeconds: null,
      join: 'match_previous',
      staleness: {
        cause: 'chain',
        upstreamShotId: 'shot_1',
        sourceAuthoringRevision: 2,
        keptAt: null,
      },
    };
    expect(validateStudioProjectV4(wrongExistingPredecessor)).toBe(false);

    const hardCut = makePhase6Project();
    hardCut.assemblies.assembly_1!.pictureBindings.shot_1!.staleness = {
      cause: 'chain',
      upstreamShotId: 'shot_2',
      sourceAuthoringRevision: 2,
      keptAt: null,
    };
    expect(validateStudioProjectV4(hardCut)).toBe(false);
  });

  it('rejects sound bindings until the native schema-7 sound ledger is active', () => {
    const project = makePhase6Project();
    project.assemblies.assembly_1!.soundBindingOrder = ['sound_binding_1'];
    project.assemblies.assembly_1!.soundBindings.sound_binding_1 = {
      id: 'sound_binding_1',
      source: null,
      anchorBeatId: 'beat_1',
      levelDb: -6,
      sourceInSeconds: 0,
      sourceOutSeconds: null,
      staleness: null,
    };
    expect(validateStudioProjectV4(project)).toBe(false);
  });

  it('admits a recoverable Assembly entry while retaining its owning record and bindings', () => {
    const project = makePhase6Project();
    project.bin = [
      {
        id: 'bin_1',
        subject: { kind: 'assembly', assemblyId: 'assembly_1' },
        reason: 'lifted',
        liftedAt: PHASE_6_CURRENT_AT,
      },
    ];

    expect(validateStudioProjectV4(project)).toBe(true);
    expect(project.pieces.piece_photo_1!.currentAssetId).toBe('asset_photo_1');
    expect(project.assemblies.assembly_1!.pictureBindings.shot_1!.source).not.toBeNull();
  });

  it('rejects duplicate Bin subjects, missing subjects, and Bin identity collisions', () => {
    const duplicate = makePhase6Project();
    duplicate.bin = [
      {
        id: 'bin_1',
        subject: { kind: 'assembly', assemblyId: 'assembly_1' },
        reason: 'lifted',
        liftedAt: PHASE_6_CURRENT_AT,
      },
      {
        id: 'bin_2',
        subject: { kind: 'assembly', assemblyId: 'assembly_1' },
        reason: 'lifted',
        liftedAt: PHASE_6_CURRENT_AT,
      },
    ];
    const missing = makePhase6Project();
    missing.bin = [
      {
        id: 'bin_1',
        subject: { kind: 'board', boardId: 'board_missing' },
        reason: 'lifted',
        liftedAt: PHASE_6_CURRENT_AT,
      },
    ];
    const colliding = makePhase6Project();
    colliding.bin = [
      {
        id: 'asset_photo_1',
        subject: { kind: 'assembly', assemblyId: 'assembly_1' },
        reason: 'lifted',
        liftedAt: PHASE_6_CURRENT_AT,
      },
    ];

    expect(validateStudioProjectV4(duplicate)).toBe(false);
    expect(validateStudioProjectV4(missing)).toBe(false);
    expect(validateStudioProjectV4(colliding)).toBe(false);
  });

  it('resolves a binned Board Shot through its owning Board with own-property lookups', () => {
    const project = makePhase6Project();
    project.assemblyOrder = [];
    project.assemblies = {};
    project.bin = [
      {
        id: 'bin_1',
        subject: { kind: 'board_shot', boardId: 'board_1', shotId: 'shot_1' },
        reason: 'lifted',
        liftedAt: PHASE_6_CURRENT_AT,
      },
    ];
    expect(validateStudioProjectV4(project)).toBe(true);

    const inheritedBoard = structuredClone(project);
    inheritedBoard.bin[0]!.subject = { kind: 'board_shot', boardId: 'toString', shotId: 'shot_1' };
    expect(validateStudioProjectV4(inheritedBoard)).toBe(false);

    const inheritedShot = structuredClone(project);
    inheritedShot.bin[0]!.subject = { kind: 'board_shot', boardId: 'board_1', shotId: 'constructor' };
    expect(validateStudioProjectV4(inheritedShot)).toBe(false);
  });

  it('rejects Bin history that predates the exact subject owner', () => {
    const beforeSubjectCreation = '2026-09-02T00:00:00.500Z';
    const subjects = [
      { kind: 'piece' as const, pieceId: 'piece_photo_1' },
      { kind: 'board' as const, boardId: 'board_1' },
      { kind: 'board_shot' as const, boardId: 'board_1', shotId: 'shot_1' },
      { kind: 'assembly' as const, assemblyId: 'assembly_1' },
    ];

    for (const subject of subjects) {
      const project = makePhase6Project();
      if (subject.kind !== 'assembly') {
        project.assemblyOrder = [];
        project.assemblies = {};
      }
      project.bin = [{ id: `bin_${subject.kind}`, subject, reason: 'lifted', liftedAt: beforeSubjectCreation }];
      expect(validateStudioProjectV4(project), subject.kind).toBe(false);
    }
  });

  it('rejects duplicate Board Shot subjects and parent-child overlap in either order', () => {
    const duplicate = makePhase6Project();
    duplicate.assemblyOrder = [];
    duplicate.assemblies = {};
    duplicate.bin = [
      {
        id: 'bin_1',
        subject: { kind: 'board_shot', boardId: 'board_1', shotId: 'shot_1' },
        reason: 'lifted',
        liftedAt: PHASE_6_CURRENT_AT,
      },
      {
        id: 'bin_2',
        subject: { kind: 'board_shot', boardId: 'board_1', shotId: 'shot_1' },
        reason: 'lifted',
        liftedAt: PHASE_6_CURRENT_AT,
      },
    ];
    expect(validateStudioProjectV4(duplicate)).toBe(false);

    const allMembers = structuredClone(duplicate);
    allMembers.bin[1]!.subject = { kind: 'board_shot', boardId: 'board_1', shotId: 'shot_2' };
    expect(validateStudioProjectV4(allMembers)).toBe(false);

    const boardFirst = structuredClone(allMembers);
    boardFirst.bin[0]!.subject = { kind: 'board', boardId: 'board_1' };
    expect(validateStudioProjectV4(boardFirst)).toBe(false);

    const shotFirst = structuredClone(boardFirst);
    shotFirst.bin.reverse();
    expect(validateStudioProjectV4(shotFirst)).toBe(false);
  });

  it('keeps every Board Shot in the film while a retained Assembly references its Board', () => {
    const project = makePhase6Project();
    project.bin = [
      {
        id: 'bin_1',
        subject: { kind: 'assembly', assemblyId: 'assembly_1' },
        reason: 'lifted',
        liftedAt: PHASE_6_CURRENT_AT,
      },
      {
        id: 'bin_2',
        subject: { kind: 'board_shot', boardId: 'board_1', shotId: 'shot_2' },
        reason: 'lifted',
        liftedAt: PHASE_6_CURRENT_AT,
      },
    ];

    expect(project.assemblies.assembly_1!.pictureBindings.shot_2!.source).toBeNull();
    expect(validateStudioProjectV4(project)).toBe(false);

    project.bin[1]!.subject = { kind: 'board', boardId: 'board_1' };
    expect(validateStudioProjectV4(project)).toBe(false);
  });

  it('keeps concrete and planned Pieces in the film while any retained Assembly references them', () => {
    const concrete = makePhase6Project();
    concrete.bin = [
      {
        id: 'bin_1',
        subject: { kind: 'assembly', assemblyId: 'assembly_1' },
        reason: 'lifted',
        liftedAt: PHASE_6_CURRENT_AT,
      },
      {
        id: 'bin_2',
        subject: { kind: 'piece', pieceId: 'piece_photo_1' },
        reason: 'lifted',
        liftedAt: PHASE_6_CURRENT_AT,
      },
    ];
    expect(validateStudioProjectV4(concrete)).toBe(false);

    const pendingV3 = makeGeneratedProjectWithJobStatusV3('queued_local');
    const scaffold = makePhase6Project();
    const planned: StudioProjectV4 = {
      ...pendingV3,
      schemaVersion: 7,
      pieces: Object.fromEntries(
        Object.entries(pendingV3.pieces).map(([pieceId, piece]) => [pieceId, { ...piece, runStem: null }])
      ),
      boardOrder: [...scaffold.boardOrder],
      boards: structuredClone(scaffold.boards),
      assemblyOrder: [...scaffold.assemblyOrder],
      assemblies: structuredClone(scaffold.assemblies),
      bin: [],
      updatedAt: PHASE_6_CURRENT_AT,
    };
    planned.assemblies.assembly_1!.pictureBindings.shot_1!.source = null;
    planned.assemblies.assembly_1!.pictureBindings.shot_2!.source = { pieceId: 'piece_1', assetId: null };
    planned.bin = [
      {
        id: 'bin_1',
        subject: { kind: 'assembly', assemblyId: 'assembly_1' },
        reason: 'lifted',
        liftedAt: PHASE_6_CURRENT_AT,
      },
      {
        id: 'bin_2',
        subject: { kind: 'piece', pieceId: 'piece_1' },
        reason: 'lifted',
        liftedAt: PHASE_6_CURRENT_AT,
      },
    ];
    expect(validateStudioProjectV4(planned)).toBe(false);
  });

  it('rejects persisted Bin entries for active Piece work and refuses the valid mutation atomically', () => {
    const blockingStatuses = ['queued_local', 'submitting', 'queued_remote', 'running', 'needs_attention'] as const;
    for (const status of blockingStatuses) {
      const project = makePhase6GeneratedProjectWithJobStatus(status);
      expect(validateStudioProjectV4(project), status).toBe(true);
      project.bin = [
        {
          id: `bin_${status}`,
          subject: { kind: 'piece', pieceId: 'piece_1' },
          reason: 'lifted',
          liftedAt: PHASE_6_CURRENT_AT,
        },
      ];
      expect(validateStudioProjectV4(project), status).toBe(false);
    }

    const project = makePhase6GeneratedProjectWithJobStatus('queued_local');
    const subject = { kind: 'piece' as const, pieceId: 'piece_1' };
    const result = liftStudioCanvasSubjectsToBinV4(
      project,
      { projectId: project.id, expectedRevision: project.revision, subjects: [subject] },
      {
        projectId: project.id,
        projectRevision: project.revision,
        entryIds: ['bin_active_piece'],
        decisions: [{ subject, state: 'clear' }],
        capturedAt: '2026-09-02T00:00:03.000Z',
      }
    );
    expect(result).toEqual({ status: 'refused', reason: 'work_in_progress' });
    expect(project.bin).toEqual([]);
  });

  it('rejects accessors and proxies without invoking project code', () => {
    const project = makePhase6Project();
    let getterCalls = 0;
    Object.defineProperty(project, 'boards', {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        return {};
      },
    });

    expect(validateStudioProjectV4(project)).toBe(false);
    expect(getterCalls).toBe(0);
    expect(validateStudioProjectV4(new Proxy(makePhase6Project(), {}))).toBe(false);
  });
});

describe('validateStudioPieceExportManifestV3', () => {
  it('requires the exact Piece kind, handle-at-export, asset timestamp, and imported provenance', () => {
    const manifest = {
      schemaVersion: 3,
      exportId: 'export_1',
      projectId: 'project_v3',
      sourceRevision: 2,
      piece: { id: 'piece_1', kind: 'photograph', handleAtExport: 'ảnh_đêm' },
      asset: {
        id: 'asset_1',
        sha256: digest,
        mimeType: 'image/png',
        byteSize: 8,
        width: 800,
        height: 600,
        createdAt: completedAtV3,
        relativePath: 'ảnh_đêm.png',
      },
      provenance: { origin: 'imported' },
      exportedAt: '2026-08-30T00:00:03.000Z',
    };
    expect(validateStudioPieceExportManifestV3(manifest)).toBe(true);
    expect(
      validateStudioPieceExportManifestV3({
        ...manifest,
        asset: { ...manifest.asset, byteSize: STUDIO_MAX_IMAGE_ASSET_BYTES_V3 },
      })
    ).toBe(true);
    expect(
      validateStudioPieceExportManifestV3({
        ...manifest,
        asset: { ...manifest.asset, byteSize: STUDIO_MAX_IMAGE_ASSET_BYTES_V3 + 1 },
      })
    ).toBe(false);
    expect(validateStudioPieceExportManifestV3({ ...manifest, piece: { ...manifest.piece, kind: 'video' } })).toBe(
      false
    );
    expect(
      validateStudioPieceExportManifestV3({
        ...manifest,
        piece: { id: 'piece_1', kind: 'photograph' },
      })
    ).toBe(false);
    expect(
      validateStudioPieceExportManifestV3({
        ...manifest,
        asset: { ...manifest.asset, createdAt: '2026-08-30T00:00:04.000Z' },
      })
    ).toBe(false);
    expect(validateStudioPieceExportManifestV3({ ...manifest, unexpected: true })).toBe(false);
  });

  it('requires internally consistent generated provenance without exposing a legacy film shape', () => {
    const project = makeGeneratedProjectV3();
    const job = project.jobs.job_1!;
    const authorization = project.spendAuthorizations[0]!;
    const asset = project.assets.asset_1!;
    if (asset.origin !== 'generated' || job.spendReceipt === null) throw new Error('expected generated fixture');
    const manifest = {
      schemaVersion: 3,
      exportId: 'export_1',
      projectId: project.id,
      sourceRevision: project.revision,
      piece: { id: 'piece_1', kind: 'photograph', handleAtExport: 'quiet_portrait' },
      asset: {
        id: asset.id,
        sha256: asset.sha256,
        mimeType: asset.mimeType,
        byteSize: asset.byteSize,
        width: asset.width,
        height: asset.height,
        createdAt: asset.createdAt,
        relativePath: 'quiet_portrait.png',
      },
      provenance: {
        origin: 'generated',
        producerJobId: job.id,
        provider: job.provider,
        composition: job.composition,
        requestPlan: job.requestPlan,
        authorizationId: authorization.id,
        quoteId: authorization.quote.id,
        quoteRevision: authorization.quote.quoteRevision,
        receipt: job.spendReceipt,
      },
      exportedAt: '2026-08-30T00:00:03.000Z',
    };
    expect(validateStudioPieceExportManifestV3(manifest)).toBe(true);
    expect(
      validateStudioPieceExportManifestV3({
        ...manifest,
        provenance: { ...manifest.provenance, quoteId: 'quote_other' },
      })
    ).toBe(false);
    expect(
      validateStudioPieceExportManifestV3({
        ...manifest,
        provenance: {
          ...manifest.provenance,
          provider: { ...manifest.provenance.provider, model: 'model_other' },
        },
      })
    ).toBe(false);
  });
});
