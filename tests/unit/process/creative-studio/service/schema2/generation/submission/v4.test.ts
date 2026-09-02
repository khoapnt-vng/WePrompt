/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest';
import type {
  StudioAssetV3,
  StudioPieceGenerationCompositionV3,
  StudioPieceGenerationRequestPlanV3,
  StudioPieceJobV3,
  StudioPieceSpendAuthorizationV3,
  StudioPieceSubmissionQuoteV3,
  StudioProjectV4,
} from '@/common/types/project/creativeStudioTypes';
import {
  createEmptyStudioProjectV3,
  createEmptyStudioProjectV4,
} from '@/process/services/creative-studio/service/schema2/factories';
import { studioPieceGenerationCompositionDigestV3 } from '@/process/services/creative-studio/service/schema2/generation/composition';
import { createStudioPieceQuotedGenerationIdV3 } from '@/process/services/creative-studio/service/schema2/generation/submission/v3';
import {
  createStudioAuthoringFingerprintV4,
  STUDIO_AUTHORING_FINGERPRINT_DOMAIN_V4,
  STUDIO_AUTHORING_FINGERPRINT_VERSION_V4,
  studioProjectAuthoringEqualsV4,
} from '@/process/services/creative-studio/service/schema2/generation/submission/v4';
import { validateStudioProjectV4 } from '@/process/services/creative-studio/service/schema2/validation';
import { makePhase6Project } from '../../../../../../../fixtures/creative-studio/phase6Project';

const CREATED_AT = '2026-09-02T00:00:00.000Z';
const AUTHORIZED_AT = '2026-09-02T00:00:01.000Z';
const COMPLETED_AT = '2026-09-02T00:00:02.000Z';
const EXPIRES_AT = '2026-09-02T00:40:00.000Z';
const RETRIED_AT = '2026-09-02T00:00:03.000Z';
const DIGEST = 'a'.repeat(64);
const PROVIDER = {
  providerId: 'provider_1',
  adapterId: 'weprompt-image-v1' as const,
  model: 'image-model',
};

const makeCreateArm = () => ({
  mode: 'create' as const,
  reservedPieceId: 'piece_fresh',
  proposedHandle: 'a_fresh_photograph',
  runStem: null,
  otherActiveHandleReservations: [],
  orderIndex: 1,
  words: 'A fresh photograph.',
  settings: { aspectRatio: '16:9' as const, resolution: '1080p' as const },
  conditioningInputs: [],
});

const reverseRecord = <T>(value: Record<string, T>): Record<string, T> =>
  Object.fromEntries(Object.entries(value).toReversed());

const conditioningInputFor = (
  project: StudioProjectV4,
  pieceId: string
): StudioPieceGenerationCompositionV3['inputs']['conditioningInputs'][number] => {
  const piece = project.pieces[pieceId]!;
  const asset = project.assets[piece.currentAssetId!]!;
  return {
    pieceId,
    assetId: asset.id,
    sha256: asset.sha256,
    mimeType: asset.mimeType as 'image/jpeg' | 'image/png' | 'image/webp',
    byteSize: asset.byteSize,
  };
};

const makeTwoTopologyProject = (): StudioProjectV4 => {
  const project = makePhase6Project();
  project.pieceOrder.push('piece_photo_2');
  project.pieces.piece_photo_2 = {
    id: 'piece_photo_2',
    kind: 'photograph',
    handle: 'second_photo',
    runStem: 'second_photo',
    priorHandles: [],
    currentAssetId: 'asset_photo_2',
    jobIds: [],
    createdAt: CREATED_AT,
    updatedAt: COMPLETED_AT,
  };
  project.assets.asset_photo_2 = {
    ...structuredClone(project.assets.asset_photo_1!),
    id: 'asset_photo_2',
    pieceId: 'piece_photo_2',
    managedAsset: { collection: 'imports', fileName: 'asset_photo_2.png' },
    sha256: 'b'.repeat(64),
  };
  expect(validateStudioProjectV4(project), 'second Piece').toBe(true);
  project.boardOrder.push('board_2');
  project.boards.board_2 = {
    id: 'board_2',
    handle: 'second_board',
    priorHandles: [],
    beatOrder: ['beat_2'],
    beats: {
      beat_2: {
        id: 'beat_2',
        title: 'Closing beat',
        story: 'The harbour falls quiet.',
        targetSeconds: null,
        shotOrder: ['shot_3'],
      },
    },
    shots: {
      shot_3: {
        id: 'shot_3',
        shootingScript: 'The final boat leaves frame.',
        durationSeconds: 4,
        createdAt: CREATED_AT,
        updatedAt: COMPLETED_AT,
      },
    },
    createdAt: CREATED_AT,
    updatedAt: COMPLETED_AT,
  };
  expect(validateStudioProjectV4(project), 'second Board').toBe(true);
  project.assemblyOrder.push('assembly_2');
  project.assemblies.assembly_2 = {
    id: 'assembly_2',
    handle: 'second_cut',
    priorHandles: [],
    boardId: 'board_2',
    pictureBindings: {
      shot_3: {
        shotId: 'shot_3',
        source: null,
        sourceInSeconds: 0,
        sourceOutSeconds: null,
        join: 'hard_cut',
        staleness: null,
      },
    },
    soundBindingOrder: [],
    soundBindings: {},
    createdAt: CREATED_AT,
    updatedAt: COMPLETED_AT,
  };
  expect(validateStudioProjectV4(project)).toBe(true);
  return project;
};

const makeGeneratedProject = (): StudioProjectV4 => {
  const project = createEmptyStudioProjectV4(
    { name: 'Generated Piece', brief: 'A quiet portrait' },
    'project_generated',
    CREATED_AT
  );
  const pieceId = 'piece_1';
  const jobId = 'job_1';
  const assetId = 'asset_1';
  const composition: StudioPieceGenerationCompositionV3 = {
    inputs: {
      schemaVersion: 3,
      projectRevisionAtPreparation: 1,
      authoringRevision: 1,
      authoringFingerprintVersion: 2,
      authoringFingerprint: DIGEST,
      brief: project.brief,
      rules: [],
      source: {
        kind: 'piece',
        pieceId,
        words: 'A quiet portrait.',
        settings: { aspectRatio: '4:3', resolution: '1080p' },
      },
      purpose: 'piece_image',
      conditioningInputs: [],
      route: PROVIDER,
      instructionProfile: 'weprompt-image-v1.piece-image.v2',
    },
    prompt: 'PHOTO REQUEST\nA quiet portrait.',
  };
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
    authoringFingerprint: DIGEST,
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
    expiresAt: EXPIRES_AT,
  };
  const authorization: StudioPieceSpendAuthorizationV3 = {
    id: 'authorization_1',
    quote,
    confirmedAt: AUTHORIZED_AT,
    projectRevisionAtAuthorization: 2,
    cancellationPolicy: 'queued_and_running',
    providerBinding: { itemId, provider: PROVIDER },
    idempotencyKey: { itemId, key: 'idempotency_1' },
  };
  const job: StudioPieceJobV3 = {
    id: jobId,
    projectId: project.id,
    target,
    purpose: 'piece_image',
    status: 'succeeded',
    provider: PROVIDER,
    idempotencyKey: 'idempotency_1',
    providerSubmissionKind: 'remote',
    providerJobId: 'provider_job_1',
    remoteStartedAt: AUTHORIZED_AT,
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
    spendReceipt: {
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
      recordedAt: COMPLETED_AT,
    },
    authoringRevision: 1,
    authoringFingerprintVersion: 2,
    authoringFingerprint: DIGEST,
    projectRevisionAtPreparation: 1,
    projectRevisionAtAuthorization: 2,
    createdAt: AUTHORIZED_AT,
    updatedAt: COMPLETED_AT,
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
    createdAt: COMPLETED_AT,
    origin: 'generated',
    producerJobId: jobId,
    compositionDigest: studioPieceGenerationCompositionDigestV3(composition),
  };
  project.revision = 3;
  project.authoringRevision = 2;
  project.updatedAt = COMPLETED_AT;
  project.pieceOrder = [pieceId];
  project.pieces[pieceId] = {
    id: pieceId,
    kind: 'photograph',
    handle: 'quiet_portrait',
    runStem: 'quiet_portrait',
    priorHandles: [],
    currentAssetId: assetId,
    jobIds: [jobId],
    createdAt: AUTHORIZED_AT,
    updatedAt: COMPLETED_AT,
  };
  project.spendAuthorizations = [authorization];
  project.assets[assetId] = asset;
  project.jobs[jobId] = job;
  expect(validateStudioProjectV4(project)).toBe(true);
  return project;
};

const makeRetriedProject = (): StudioProjectV4 => {
  const project = makeGeneratedProject();
  const firstJob = project.jobs.job_1!;
  firstJob.status = 'failed';
  firstJob.outputAssetId = null;
  firstJob.error = { code: 'timeout', messageKey: 'timeout' };
  firstJob.progress = null;
  firstJob.spendReceipt = null;
  delete project.assets.asset_1;
  project.pieces.piece_1!.currentAssetId = null;

  const composition = structuredClone(firstJob.composition);
  composition.inputs.projectRevisionAtPreparation = 3;
  composition.inputs.authoringRevision = 2;
  const requestPlan: StudioPieceGenerationRequestPlanV3 = {
    kind: 'resolved',
    snapshot: {
      composition,
      settings: { ...composition.inputs.source.settings },
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
    authoringFingerprint: DIGEST,
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
    expiresAt: EXPIRES_AT,
  };
  const authorization: StudioPieceSpendAuthorizationV3 = {
    id: 'authorization_2',
    quote,
    confirmedAt: RETRIED_AT,
    projectRevisionAtAuthorization: 4,
    cancellationPolicy: 'queued_and_running',
    providerBinding: { itemId, provider: PROVIDER },
    idempotencyKey: { itemId, key: 'idempotency_2' },
  };
  project.jobs.job_2 = {
    id: 'job_2',
    projectId: project.id,
    target,
    purpose: 'piece_image',
    status: 'queued_local',
    provider: PROVIDER,
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
    authoringFingerprint: DIGEST,
    projectRevisionAtPreparation: 3,
    projectRevisionAtAuthorization: 4,
    createdAt: RETRIED_AT,
    updatedAt: RETRIED_AT,
  };
  project.spendAuthorizations.push(authorization);
  project.pieces.piece_1!.jobIds.push('job_2');
  project.pieces.piece_1!.updatedAt = RETRIED_AT;
  project.revision = 4;
  project.updatedAt = RETRIED_AT;
  expect(validateStudioProjectV4(project), 'retry project').toBe(true);
  return project;
};

describe('inactive exact schema-7 authoring fingerprint', () => {
  it('compares authored meaning independently from runtime progress', () => {
    const project = makePhase6Project();
    const runtimeOnly = structuredClone(project);
    runtimeOnly.revision += 1;
    runtimeOnly.assets.asset_photo_1!.width = 1_377;
    expect(validateStudioProjectV4(runtimeOnly)).toBe(true);

    expect(studioProjectAuthoringEqualsV4(project, runtimeOnly)).toBe(true);
    runtimeOnly.name = 'Changed authored name';
    expect(studioProjectAuthoringEqualsV4(project, runtimeOnly)).toBe(false);
    expect(studioProjectAuthoringEqualsV4(project, { ...runtimeOnly, schemaVersion: 6 })).toBe(false);
  });

  it('freezes the independently versioned domain and exact schema-7 golden digest', () => {
    const fingerprint = createStudioAuthoringFingerprintV4({
      project: makePhase6Project(),
      prepared: makeCreateArm(),
    });

    expect(STUDIO_AUTHORING_FINGERPRINT_VERSION_V4).toBe(3);
    expect(STUDIO_AUTHORING_FINGERPRINT_DOMAIN_V4).toBe('weprompt:studio-authoring:v3');
    expect(fingerprint).toBe('584441af9242b20f8ebd2813660cf0dcde890b6aab17ff0d80a346a01eee8378');
    expect(fingerprint).toBe(
      createStudioAuthoringFingerprintV4({ project: makePhase6Project(), prepared: makeCreateArm() })
    );
  });

  it('fails closed on proxies, getters, and sparse prepared input without invoking hostile code', () => {
    const project = makePhase6Project();
    const create = makeCreateArm();
    expect(() => createStudioAuthoringFingerprintV4({ project, prepared: new Proxy(create, {}) } as never)).toThrow(
      TypeError
    );
    expect(() =>
      createStudioAuthoringFingerprintV4({ project: new Proxy(project, {}), prepared: create } as never)
    ).toThrow(TypeError);

    let getterRead = false;
    const accessorPrepared = { ...create } as Record<string, unknown>;
    Object.defineProperty(accessorPrepared, 'mode', {
      enumerable: true,
      get: () => {
        getterRead = true;
        return 'create';
      },
    });
    expect(() => createStudioAuthoringFingerprintV4({ project, prepared: accessorPrepared } as never)).toThrow(
      TypeError
    );
    expect(getterRead).toBe(false);

    const sparseConditioningInputs = Array(1) as StudioPieceGenerationCompositionV3['inputs']['conditioningInputs'];
    expect(() =>
      createStudioAuthoringFingerprintV4({
        project,
        prepared: { ...create, conditioningInputs: sparseConditioningInputs },
      })
    ).toThrow(TypeError);
  });

  it('rejects schema 6, missing schema-7 roots, inexact Pieces, and undeclared keys', () => {
    const project = makePhase6Project();
    const schemaSix = createEmptyStudioProjectV3({ name: 'Schema Six', brief: '' }, 'project_6', CREATED_AT);
    const missingBoardOrder = structuredClone(project) as StudioProjectV4 & { boardOrder?: string[] };
    delete missingBoardOrder.boardOrder;
    const missingRunStem = structuredClone(project) as StudioProjectV4 & {
      pieces: Record<string, Omit<StudioProjectV4['pieces'][string], 'runStem'> & { runStem?: string | null }>;
    };
    delete missingRunStem.pieces.piece_photo_1!.runStem;

    for (const invalidProject of [
      schemaSix,
      missingBoardOrder,
      { ...project, extra: true },
      missingRunStem,
      {
        ...project,
        pieces: {
          ...project.pieces,
          piece_photo_1: { ...project.pieces.piece_photo_1!, extra: true },
        },
      },
    ]) {
      expect(() =>
        createStudioAuthoringFingerprintV4({ project: invalidProject, prepared: makeCreateArm() } as never)
      ).toThrow(TypeError);
    }
  });

  it('requires an exact create arm with explicit runStem and rejects invalid or colliding identities', () => {
    const project = makePhase6Project();
    const create = makeCreateArm();
    const { runStem: _missing, ...missingRunStem } = create;
    const { otherActiveHandleReservations: _missingReservations, ...missingReservations } = create;
    void _missing;
    void _missingReservations;

    for (const prepared of [
      missingRunStem,
      missingReservations,
      { ...create, runStem: undefined },
      { ...create, runStem: 'Not Canonical' },
      { ...create, proposedHandle: 'harbour_morning' },
      { ...create, reservedPieceId: 'board_1' },
      { ...create, runStem: 'harbour_morning', proposedHandle: 'unrelated_handle' },
      { ...create, extra: true },
    ]) {
      expect(() => createStudioAuthoringFingerprintV4({ project, prepared } as never)).toThrow(TypeError);
    }

    expect(() =>
      createStudioAuthoringFingerprintV4({
        project,
        prepared: { ...create, proposedHandle: 'harbour_morning_2', runStem: 'harbour_morning' },
      })
    ).not.toThrow();
  });

  it('rederives concurrent reservations from a bounded canonical frozen snapshot', () => {
    const project = makePhase6Project();
    const liveReservations = ['unrelated', 'a_fresh_photograph'];
    const prepared = {
      ...makeCreateArm(),
      proposedHandle: 'a_fresh_photograph_2',
      otherActiveHandleReservations: [...liveReservations],
    };
    const fingerprint = createStudioAuthoringFingerprintV4({ project, prepared });

    expect(
      createStudioAuthoringFingerprintV4({
        project,
        prepared: { ...prepared, otherActiveHandleReservations: liveReservations.toReversed() },
      })
    ).toBe(fingerprint);

    liveReservations.length = 0;
    expect(createStudioAuthoringFingerprintV4({ project, prepared })).toBe(fingerprint);
    expect(() =>
      createStudioAuthoringFingerprintV4({
        project,
        prepared: {
          ...prepared,
          otherActiveHandleReservations: [...prepared.otherActiveHandleReservations, prepared.proposedHandle],
        },
      })
    ).toThrow('create handle reservation snapshot is invalid');
    expect(() =>
      createStudioAuthoringFingerprintV4({
        project,
        prepared: { ...prepared, otherActiveHandleReservations: ['storyboard'] },
      })
    ).toThrow(expect.objectContaining({ code: 'invalid_namespace' }));
  });

  it('rejects hostile, duplicate, noncanonical, and over-capacity reservation snapshots', () => {
    const project = makePhase6Project();
    const create = makeCreateArm();
    const sparse = Array(1) as string[];
    const proxy = new Proxy(['reserved'], {});
    const atCapacity = Array.from({ length: 94 }, (_, index) => `reservation_${index}`);

    expect(() =>
      createStudioAuthoringFingerprintV4({
        project,
        prepared: { ...create, otherActiveHandleReservations: atCapacity },
      })
    ).not.toThrow();
    for (const otherActiveHandleReservations of [
      [...atCapacity, 'reservation_overflow'],
      ['duplicate', 'duplicate'],
      ['Not Canonical'],
      sparse,
      proxy,
    ]) {
      expect(() =>
        createStudioAuthoringFingerprintV4({
          project,
          prepared: { ...create, otherActiveHandleReservations },
        })
      ).toThrow();
    }
  });

  it('rederives null fallbacks and collisions across Piece, Board, and Assembly handles', () => {
    const project = makePhase6Project();
    const create = makeCreateArm();
    expect(() => createStudioAuthoringFingerprintV4({ project, prepared: create })).not.toThrow();
    expect(() =>
      createStudioAuthoringFingerprintV4({ project, prepared: { ...create, proposedHandle: 'fresh_piece' } })
    ).toThrow('create authoring arm is invalid');

    expect(() =>
      createStudioAuthoringFingerprintV4({
        project,
        prepared: { ...create, words: 'Storyboard', proposedHandle: 'storyboard_2' },
      })
    ).not.toThrow();
    expect(() =>
      createStudioAuthoringFingerprintV4({
        project,
        prepared: { ...create, words: 'Storyboard', proposedHandle: 'storyboard' },
      })
    ).toThrow('create authoring arm is invalid');
    expect(() =>
      createStudioAuthoringFingerprintV4({
        project,
        prepared: { ...create, runStem: 'the_cut', proposedHandle: 'the_cut_2' },
      })
    ).not.toThrow();
  });

  it('validates exact current conditioning facts and preserves their order', () => {
    const project = makeTwoTopologyProject();
    const create = makeCreateArm();
    const first = conditioningInputFor(project, 'piece_photo_1');
    const second = conditioningInputFor(project, 'piece_photo_2');
    const firstThenSecond = createStudioAuthoringFingerprintV4({
      project,
      prepared: { ...create, conditioningInputs: [first, second] },
    });
    const secondThenFirst = createStudioAuthoringFingerprintV4({
      project,
      prepared: { ...create, conditioningInputs: [second, first] },
    });

    expect(secondThenFirst).not.toBe(firstThenSecond);
    expect(() =>
      createStudioAuthoringFingerprintV4({
        project,
        prepared: { ...create, conditioningInputs: [{ ...first, sha256: 'f'.repeat(64) }] },
      })
    ).toThrow('conditioning inputs must match current project assets');
    expect(() =>
      createStudioAuthoringFingerprintV4({
        project,
        prepared: { ...create, conditioningInputs: [first, first] },
      })
    ).toThrow('conditioning inputs are invalid');
  });

  it('binds both prepared and persisted run stems into authoring authority', () => {
    const project = makePhase6Project();
    const create = makeCreateArm();
    const withoutStem = createStudioAuthoringFingerprintV4({ project, prepared: create });
    const withPreparedStem = createStudioAuthoringFingerprintV4({
      project,
      prepared: { ...create, runStem: create.proposedHandle },
    });
    const persistedStem = structuredClone(project);
    persistedStem.pieces.piece_photo_1!.runStem = 'harbour_morning';

    expect(withPreparedStem).not.toBe(withoutStem);
    expect(createStudioAuthoringFingerprintV4({ project: persistedStem, prepared: create })).not.toBe(withoutStem);
  });

  it('canonicalizes map insertion order while preserving semantic reading order', () => {
    const project = makeTwoTopologyProject();
    const reordered = structuredClone(project);
    reordered.pieces = reverseRecord(reordered.pieces);
    reordered.boards = reverseRecord(reordered.boards);
    reordered.boards.board_1!.beats = reverseRecord(reordered.boards.board_1!.beats);
    reordered.boards.board_1!.shots = reverseRecord(reordered.boards.board_1!.shots);
    reordered.assemblies = reverseRecord(reordered.assemblies);
    reordered.assemblies.assembly_1!.pictureBindings = reverseRecord(reordered.assemblies.assembly_1!.pictureBindings);
    reordered.assets = reverseRecord(reordered.assets);
    reordered.jobs = reverseRecord(reordered.jobs);

    expect(validateStudioProjectV4(reordered)).toBe(true);
    expect(createStudioAuthoringFingerprintV4({ project: reordered, prepared: makeCreateArm() })).toBe(
      createStudioAuthoringFingerprintV4({ project, prepared: makeCreateArm() })
    );

    const changedReadingOrder = structuredClone(project);
    changedReadingOrder.boards.board_1!.beats.beat_1!.shotOrder.reverse();
    changedReadingOrder.assemblies.assembly_1!.pictureBindings.shot_2!.join = 'hard_cut';
    changedReadingOrder.assemblies.assembly_1!.pictureBindings.shot_1!.join = 'match_previous';
    expect(validateStudioProjectV4(changedReadingOrder)).toBe(true);
    expect(createStudioAuthoringFingerprintV4({ project: changedReadingOrder, prepared: makeCreateArm() })).not.toBe(
      createStudioAuthoringFingerprintV4({ project, prepared: makeCreateArm() })
    );
  });

  it('binds each independent top-level reading order rather than map insertion order', () => {
    const project = makeTwoTopologyProject();
    const baseline = createStudioAuthoringFingerprintV4({ project, prepared: makeCreateArm() });
    const changedPieceOrder = structuredClone(project);
    changedPieceOrder.pieceOrder.reverse();
    const changedBoardOrder = structuredClone(project);
    changedBoardOrder.boardOrder.reverse();
    const changedAssemblyOrder = structuredClone(project);
    changedAssemblyOrder.assemblyOrder.reverse();

    for (const changed of [changedPieceOrder, changedBoardOrder, changedAssemblyOrder]) {
      expect(validateStudioProjectV4(changed)).toBe(true);
      expect(createStudioAuthoringFingerprintV4({ project: changed, prepared: makeCreateArm() })).not.toBe(baseline);
    }
  });

  it('binds Board and Assembly authored structure while excluding presentation-only Bin membership', () => {
    const project = makeTwoTopologyProject();
    const baseline = createStudioAuthoringFingerprintV4({ project, prepared: makeCreateArm() });
    const boardChange = structuredClone(project);
    boardChange.boards.board_1!.shots.shot_1!.shootingScript = 'A changed authored shot.';
    const assemblyChange = structuredClone(project);
    assemblyChange.assemblies.assembly_1!.pictureBindings.shot_2!.join = 'hard_cut';
    const binChange = structuredClone(project);
    binChange.bin = [
      {
        id: 'bin_1',
        subject: { kind: 'piece', pieceId: 'piece_photo_2' },
        reason: 'lifted',
        liftedAt: COMPLETED_AT,
      },
    ];

    for (const changed of [boardChange, assemblyChange]) {
      expect(validateStudioProjectV4(changed)).toBe(true);
      expect(createStudioAuthoringFingerprintV4({ project: changed, prepared: makeCreateArm() })).not.toBe(baseline);
    }
    expect(validateStudioProjectV4(binChange)).toBe(true);
    expect(createStudioAuthoringFingerprintV4({ project: binChange, prepared: makeCreateArm() })).toBe(baseline);

    const restored = structuredClone(binChange);
    restored.bin = [];
    expect(validateStudioProjectV4(restored)).toBe(true);
    expect(createStudioAuthoringFingerprintV4({ project: restored, prepared: makeCreateArm() })).toBe(baseline);
  });

  it('excludes timestamps, including rule creation, Bin lift time, and the exact Keep timestamp', () => {
    const project = makeTwoTopologyProject();
    project.rules.push({
      id: 'rule_1',
      scope: 'project',
      text: 'Keep the harbour quiet.',
      predicate: null,
      createdAt: CREATED_AT,
    });
    project.bin = [
      {
        id: 'bin_1',
        subject: { kind: 'piece', pieceId: 'piece_photo_2' },
        reason: 'lifted',
        liftedAt: AUTHORIZED_AT,
      },
    ];
    project.assemblies.assembly_1!.pictureBindings.shot_2!.source = {
      pieceId: 'piece_photo_1',
      assetId: 'asset_photo_1',
    };
    project.assemblies.assembly_1!.pictureBindings.shot_2!.staleness = {
      cause: 'chain',
      upstreamShotId: 'shot_1',
      sourceAuthoringRevision: 1,
      keptAt: AUTHORIZED_AT,
    };
    expect(validateStudioProjectV4(project)).toBe(true);
    const baseline = createStudioAuthoringFingerprintV4({ project, prepared: makeCreateArm() });

    const otherTimestamps = structuredClone(project);
    otherTimestamps.rules[0]!.createdAt = AUTHORIZED_AT;
    otherTimestamps.bin[0]!.liftedAt = COMPLETED_AT;
    otherTimestamps.assemblies.assembly_1!.pictureBindings.shot_2!.staleness!.keptAt = COMPLETED_AT;
    expect(validateStudioProjectV4(otherTimestamps)).toBe(true);
    expect(createStudioAuthoringFingerprintV4({ project: otherTimestamps, prepared: makeCreateArm() })).toBe(baseline);

    const shifted = structuredClone(project);
    const shiftedCreatedAt = '2026-09-03T00:00:00.000Z';
    const shiftedAuthoredAt = '2026-09-03T00:00:01.000Z';
    const shiftedCurrentAt = '2026-09-03T00:00:02.000Z';
    shifted.createdAt = shiftedCreatedAt;
    shifted.updatedAt = shiftedCurrentAt;
    shifted.rules[0]!.createdAt = shiftedAuthoredAt;
    for (const piece of Object.values(shifted.pieces)) {
      piece.createdAt = shiftedAuthoredAt;
      piece.updatedAt = shiftedCurrentAt;
    }
    for (const asset of Object.values(shifted.assets)) asset.createdAt = shiftedCurrentAt;
    for (const board of Object.values(shifted.boards)) {
      board.createdAt = shiftedAuthoredAt;
      board.updatedAt = shiftedCurrentAt;
      for (const shot of Object.values(board.shots)) {
        shot.createdAt = shiftedAuthoredAt;
        shot.updatedAt = shiftedCurrentAt;
      }
    }
    for (const assembly of Object.values(shifted.assemblies)) {
      assembly.createdAt = shiftedAuthoredAt;
      assembly.updatedAt = shiftedCurrentAt;
    }
    shifted.bin[0]!.liftedAt = shiftedAuthoredAt;
    shifted.assemblies.assembly_1!.pictureBindings.shot_2!.staleness!.keptAt = shiftedAuthoredAt;
    expect(validateStudioProjectV4(shifted)).toBe(true);
    expect(createStudioAuthoringFingerprintV4({ project: shifted, prepared: makeCreateArm() })).toBe(baseline);
  });

  it('binds chain staleness cause data and the Keep decision without binding its timestamp', () => {
    const stale = makePhase6Project();
    stale.assemblies.assembly_1!.pictureBindings.shot_2!.source = {
      pieceId: 'piece_photo_1',
      assetId: 'asset_photo_1',
    };
    stale.assemblies.assembly_1!.pictureBindings.shot_2!.staleness = {
      cause: 'chain',
      upstreamShotId: 'shot_1',
      sourceAuthoringRevision: 1,
      keptAt: null,
    };
    expect(validateStudioProjectV4(stale)).toBe(true);
    const pendingKeep = createStudioAuthoringFingerprintV4({ project: stale, prepared: makeCreateArm() });

    const kept = structuredClone(stale);
    kept.assemblies.assembly_1!.pictureBindings.shot_2!.staleness!.keptAt = AUTHORIZED_AT;
    expect(validateStudioProjectV4(kept)).toBe(true);
    expect(createStudioAuthoringFingerprintV4({ project: kept, prepared: makeCreateArm() })).not.toBe(pendingKeep);

    const revisedCause = structuredClone(stale);
    revisedCause.assemblies.assembly_1!.pictureBindings.shot_2!.staleness!.sourceAuthoringRevision = 2;
    expect(validateStudioProjectV4(revisedCause)).toBe(true);
    expect(createStudioAuthoringFingerprintV4({ project: revisedCause, prepared: makeCreateArm() })).not.toBe(
      pendingKeep
    );
  });

  it('excludes runtime job state, progress, receipt, asset facts, and current publication', () => {
    const project = makeGeneratedProject();
    const retry = {
      mode: 'retry' as const,
      existingPieceId: 'piece_1',
      sourceJobId: 'job_1',
      words: 'A quiet portrait.',
      settings: { aspectRatio: '4:3' as const, resolution: '1080p' as const },
      conditioningInputs: [],
    };
    const fingerprint = createStudioAuthoringFingerprintV4({ project, prepared: retry });
    const failedRuntime = structuredClone(project);
    const job = failedRuntime.jobs.job_1!;
    job.status = 'failed';
    job.outputAssetId = null;
    job.error = { code: 'timeout', messageKey: 'timeout' };
    job.progress = null;
    job.spendReceipt = null;
    delete failedRuntime.assets.asset_1;
    failedRuntime.pieces.piece_1!.currentAssetId = null;
    failedRuntime.revision += 1;

    expect(validateStudioProjectV4(failedRuntime)).toBe(true);
    expect(createStudioAuthoringFingerprintV4({ project: failedRuntime, prepared: retry })).toBe(fingerprint);

    const changedAssetFacts = structuredClone(project);
    changedAssetFacts.assets.asset_1!.sha256 = 'd'.repeat(64);
    changedAssetFacts.assets.asset_1!.byteSize = 16;
    changedAssetFacts.assets.asset_1!.width = 1_600;
    expect(validateStudioProjectV4(changedAssetFacts)).toBe(true);
    expect(createStudioAuthoringFingerprintV4({ project: changedAssetFacts, prepared: retry })).toBe(fingerprint);
  });

  it('preserves multi-job ordered retry topology and rejects malformed retry payloads', () => {
    const project = makeRetriedProject();
    const retry = {
      mode: 'retry' as const,
      existingPieceId: 'piece_1',
      sourceJobId: 'job_2',
      words: 'A quiet portrait.',
      settings: { aspectRatio: '4:3' as const, resolution: '1080p' as const },
      conditioningInputs: [],
    };

    const fingerprint = createStudioAuthoringFingerprintV4({ project, prepared: retry });
    const oneJobProject = makeGeneratedProject();
    expect(
      createStudioAuthoringFingerprintV4({
        project: oneJobProject,
        prepared: { ...retry, sourceJobId: 'job_1' },
      })
    ).not.toBe(fingerprint);
    const reversedMap = structuredClone(project);
    reversedMap.jobs = reverseRecord(reversedMap.jobs);
    expect(validateStudioProjectV4(reversedMap)).toBe(true);
    expect(createStudioAuthoringFingerprintV4({ project: reversedMap, prepared: retry })).toBe(fingerprint);

    const reversedTopology = structuredClone(project);
    reversedTopology.pieces.piece_1!.jobIds.reverse();
    expect(validateStudioProjectV4(reversedTopology)).toBe(false);
    expect(() => createStudioAuthoringFingerprintV4({ project: reversedTopology, prepared: retry })).toThrow(TypeError);
    expect(() =>
      createStudioAuthoringFingerprintV4({ project, prepared: { ...retry, runStem: null } } as never)
    ).toThrow(TypeError);
    expect(() =>
      createStudioAuthoringFingerprintV4({ project, prepared: { ...retry, sourceJobId: 'job_missing' } })
    ).toThrow('sourceJobId must be the latest persisted Piece job');
    expect(() =>
      createStudioAuthoringFingerprintV4({
        project,
        prepared: {
          ...retry,
          conditioningInputs: [
            {
              pieceId: 'piece_other',
              assetId: 'asset_other',
              sha256: 'f'.repeat(64),
              mimeType: 'image/png',
              byteSize: 1,
            },
          ],
        },
      })
    ).toThrow('exactly match');
  });
});
