/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest';
import {
  STUDIO_MAX_GENERATION_PROMPT_LENGTH,
  STUDIO_MAX_PREPARED_QUOTE_CACHE_BYTES_GLOBAL,
  STUDIO_MAX_PREPARED_QUOTE_CACHE_BYTES_PER_PROJECT,
  STUDIO_MAX_PREPARED_QUOTE_SESSION_BYTES,
  STUDIO_MAX_PREPARED_QUOTE_SESSIONS_GLOBAL,
  STUDIO_MAX_PREPARED_QUOTE_SESSIONS_PER_PROJECT,
  STUDIO_PREPARED_QUOTE_TTL_SECONDS,
  type StudioPreparedSubmissionOptionsV2,
  type StudioPreparedPhotoReservationV3,
  type StudioPrepareSubmissionRequestV2,
  type StudioSpendAuthorization,
  type StudioSubmissionQuote,
} from '@/common/types/project/creativeStudioTypes';
import {
  composeStudioGenerationV2,
  composeStudioPieceGenerationV3,
  deriveStudioPieceInstructionProfileV3,
  deriveStudioInstructionProfileV2,
} from '@/process/services/creative-studio/service/schema2/generation/composition';
import { createStudioPieceGenerationRequestPlanV3 } from '@/process/services/creative-studio/service/schema2/generation/generationRequest';
import { deriveStudioPieceHandleV3 } from '@/process/services/creative-studio/service/schema2/mutations/pieceHandles';
import {
  StudioPreparedPhotoCacheV3,
  type StudioPreparedPhotoCacheAdmissionV3,
  StudioPreparedSubmissionCacheV2,
  type StudioPreparedSubmissionCacheAdmissionV2,
  type StudioPreparedSubmissionClaimV2,
  validateStudioConfirmPreparedPhotoRequestV3,
} from '@/process/services/creative-studio/service/schema2/pricing/preparedSubmissionCache';
import { createStudioPieceSubmissionQuoteV3 } from '@/process/services/creative-studio/service/schema2/pricing/estimate';

const PREPARED_AT = '2026-08-18T00:00:00.000Z';
const PREPARED_AT_MS = Date.parse(PREPARED_AT);
const EXPIRES_AT = new Date(PREPARED_AT_MS + STUDIO_PREPARED_QUOTE_TTL_SECONDS * 1_000).toISOString();
const RATE_CARD_DIGEST = 'a'.repeat(64);

type AdmissionOptions = {
  projectId?: string;
  quoteId?: string;
  withCascadeQuoteId?: string | null;
  prompt?: string;
};

const imageRoute = { providerId: 'provider_1', adapterId: 'weprompt-image-v1' as const, model: 'image-model' };
const videoRoute = {
  providerId: 'provider_1',
  adapterId: 'byteplus-seedance-v1' as const,
  model: 'video-model',
};

const shotComposition = (shotId: string, purpose: 'seed_still' | 'video_take') => {
  const route = purpose === 'video_take' ? videoRoute : imageRoute;
  const source = {
    kind: 'shot' as const,
    beatId: 'beat_1',
    story: 'A precise visual story.',
    shotId,
    shootingScript: purpose === 'video_take' ? 'Continue the action.' : 'Hold on the opening frame.',
  };
  return composeStudioGenerationV2({
    projectRevision: 7,
    brief: 'A precise image',
    rules: [],
    source,
    purpose,
    referenceInputs: [],
    aspectRatio: '16:9',
    resolution: '1080p',
    route,
    boardStyle: null,
    instructionProfile: deriveStudioInstructionProfileV2(route, purpose, source),
  });
};

const referenceComposition = (referenceId: string) => {
  const source = {
    kind: 'project_reference' as const,
    referenceId,
    referenceKind: 'character' as const,
    prompt: 'A precise recurring character.',
  };
  return composeStudioGenerationV2({
    projectRevision: 7,
    brief: 'A precise image',
    rules: [],
    source,
    purpose: 'reference_image',
    referenceInputs: [],
    aspectRatio: '16:9',
    resolution: '1080p',
    route: imageRoute,
    boardStyle: null,
    instructionProfile: deriveStudioInstructionProfileV2(imageRoute, 'reference_image', source),
  });
};

const makeQuote = (projectId: string, quoteId: string, prompt: string): StudioSubmissionQuote => {
  const composition = shotComposition('shot_1', 'seed_still');
  composition.prompt = prompt;
  return {
    id: quoteId,
    projectId,
    projectRevision: 7,
    originReferenceHandoffId: null,
    rateCardDigest: RATE_CARD_DIGEST,
    currency: 'USD',
    baseItems: [
      {
        id: `item_${quoteId}`,
        target: { kind: 'shot', shotId: 'shot_1' },
        purpose: 'seed_still',
        routeId: 'route_image',
        generationCount: 1,
        requestPlan: {
          kind: 'resolved',
          snapshot: {
            composition,
            aspectRatio: '16:9',
            resolution: '1080p',
            durationSeconds: 8,
            referenceInputs: [],
            conditioningInput: null,
          },
        },
        rateUnit: 'generation',
        rateMinorUnits: 25,
      },
    ],
    cascadeItems: [],
    lowerMinorUnits: 25,
    upperMinorUnits: 25,
    expiresAt: EXPIRES_AT,
  };
};

const makeAdmission = (options: AdmissionOptions = {}): StudioPreparedSubmissionCacheAdmissionV2 => {
  const projectId = options.projectId ?? 'project_1';
  const quoteId = options.quoteId ?? 'quote_1';
  const baseOnly = makeQuote(projectId, quoteId, options.prompt ?? 'A precise image');
  let withCascade: StudioSubmissionQuote | null = null;
  if (options.withCascadeQuoteId !== undefined && options.withCascadeQuoteId !== null) {
    withCascade = {
      ...structuredClone(baseOnly),
      id: options.withCascadeQuoteId,
      cascadeItems: [
        {
          id: `item_${options.withCascadeQuoteId}`,
          target: { kind: 'shot', shotId: 'shot_2' },
          purpose: 'video_take',
          routeId: 'route_video',
          generationCount: 1,
          requestPlan: {
            kind: 'after_take_selection',
            template: {
              composition: shotComposition('shot_2', 'video_take'),
              aspectRatio: '16:9',
              resolution: '1080p',
              durationSeconds: 8,
              referenceInputs: [],
            },
            dependency: {
              kind: 'authorized_predecessor',
              upstreamItemId: baseOnly.baseItems[0]!.id,
              predecessorShotId: 'shot_1',
            },
          },
          rateUnit: 'second',
          rateMinorUnits: 7,
        },
      ],
      upperMinorUnits: 81,
    };
  }
  const request: StudioPrepareSubmissionRequestV2 = {
    projectId,
    expectedRevision: 7,
    originReferenceHandoffId: null,
    baseChoices: [{ target: { kind: 'shot', shotId: 'shot_1' }, purpose: 'seed_still' }],
    cascadeChoices: withCascade === null ? [] : [{ target: { kind: 'shot', shotId: 'shot_2' }, purpose: 'video_take' }],
  };
  const quoteForBindings = withCascade ?? baseOnly;
  const providerBindings: StudioSpendAuthorization['providerBindings'] = [
    ...quoteForBindings.baseItems,
    ...quoteForBindings.cascadeItems,
  ].map((item) => ({
    itemId: item.id,
    provider: {
      providerId: 'provider_1',
      adapterId: item.purpose === 'video_take' ? 'byteplus-seedance-v1' : 'weprompt-image-v1',
      model: item.purpose === 'video_take' ? 'video-model' : 'image-model',
    },
  }));
  const cancellationPolicies = [...quoteForBindings.baseItems, ...quoteForBindings.cascadeItems].map((item) => ({
    itemId: item.id,
    policy: 'queued_and_running' as const,
  }));
  const prepared: StudioPreparedSubmissionOptionsV2 = { baseOnly, withCascade };
  return { request, options: prepared, providerBindings, cancellationPolicies };
};

const makeProjectReferenceAdmission = (
  originReferenceHandoffId: string | null = null
): StudioPreparedSubmissionCacheAdmissionV2 => {
  const admission = makeAdmission();
  admission.request = {
    projectId: 'project_1',
    expectedRevision: 7,
    referenceIds: ['reference_character'],
  };
  admission.options.baseOnly.originReferenceHandoffId = originReferenceHandoffId;
  const item = admission.options.baseOnly.baseItems[0]!;
  const composition = referenceComposition('reference_character');
  item.target = { kind: 'reference', referenceId: 'reference_character' };
  item.purpose = 'reference_image';
  item.requestPlan = {
    kind: 'resolved',
    snapshot: {
      composition,
      aspectRatio: composition.inputs.aspectRatio,
      resolution: composition.inputs.resolution,
      durationSeconds: 4,
      referenceInputs: [],
      conditioningInput: null,
    },
  };
  return admission;
};

const serializedSessionBytes = (admission: StudioPreparedSubmissionCacheAdmissionV2): number =>
  Buffer.byteLength(
    JSON.stringify({
      preparedAt: PREPARED_AT,
      request: admission.request,
      options: admission.options,
      providerBindings: admission.providerBindings,
      cancellationPolicies: admission.cancellationPolicies,
    }),
    'utf8'
  );

const makeSizedAdmission = (
  byteSize: number,
  options: Omit<AdmissionOptions, 'prompt'> = {}
): StudioPreparedSubmissionCacheAdmissionV2 => {
  const admission = makeAdmission({ ...options, prompt: '' });
  const padding = byteSize - serializedSessionBytes(admission);
  if (padding < 0) throw new Error('test session target is smaller than its structural overhead');
  const plan = admission.options.baseOnly.baseItems[0]!.requestPlan;
  if (plan.kind !== 'resolved') throw new Error('test base item must be resolved');
  plan.snapshot.composition.prompt = 'x'.repeat(padding);
  expect(serializedSessionBytes(admission)).toBe(byteSize);
  return admission;
};

const expectCacheCode = (operation: () => unknown, code: string): void => {
  expect(operation).toThrow(expect.objectContaining({ code }));
};

type PieceAdmissionOptionsV3 = {
  mode?: 'create' | 'retry';
  reservationId?: string;
  projectId?: string;
  pieceId?: string;
  quoteId?: string;
  quoteRevision?: number;
  authoringRevision?: number;
  words?: string;
  proposedHandle?: string;
  jobId?: string;
  authorizationId?: string;
  idempotencyKey?: string;
  retryReason?: Extract<StudioPreparedPhotoReservationV3, { mode: 'retry' }>['retryReason'];
  spendPolicy?: StudioPreparedPhotoCacheAdmissionV3['spendPolicy'];
};

const makePieceAdmissionV3 = (options: PieceAdmissionOptionsV3 = {}): StudioPreparedPhotoCacheAdmissionV3 => {
  const mode = options.mode ?? 'create';
  const reservationId = options.reservationId ?? 'reservation_piece_1';
  const projectId = options.projectId ?? 'project_piece_1';
  const pieceId = options.pieceId ?? 'piece_1';
  const quoteId = options.quoteId ?? 'quote_piece_1';
  const quoteRevision = options.quoteRevision ?? 1;
  const authoringRevision = options.authoringRevision ?? 3;
  const words = options.words ?? 'A neon dai pai dong in warm rain.';
  const settings = { aspectRatio: '16:9' as const, resolution: '1080p' as const };
  const authoringFingerprint = 'e'.repeat(64);
  const composition = composeStudioPieceGenerationV3({
    projectRevisionAtPreparation: 8,
    authoringRevision,
    authoringFingerprintVersion: 1,
    authoringFingerprint,
    brief: 'One standalone photograph.',
    rules: [],
    source: { kind: 'piece', pieceId, words, settings },
    purpose: 'piece_image',
    conditioningInputs: [],
    route: imageRoute,
    instructionProfile: deriveStudioPieceInstructionProfileV3(imageRoute),
  });
  const quote = createStudioPieceSubmissionQuoteV3({
    reservationId,
    quoteId,
    quoteRevision,
    projectId,
    projectRevisionAtPreparation: 8,
    authoringRevision,
    authoringFingerprintVersion: 1,
    authoringFingerprint,
    rateCardDigest: 'f'.repeat(64),
    currency: 'USD',
    target: { kind: 'piece', pieceId },
    routeId: 'image_route',
    requestPlan: createStudioPieceGenerationRequestPlanV3({ composition }),
    rateUnit: 'generation',
    rateMinorUnits: 20,
    expiresAt: EXPIRES_AT,
  });
  const { expiresAt: ignoredQuoteExpiry, ...unstampedQuote } = quote;
  void ignoredQuoteExpiry;
  const base = {
    reservationId,
    projectId,
    targetPieceId: pieceId,
    jobId: options.jobId ?? `job_${reservationId}`,
    authorizationId: options.authorizationId ?? `authorization_${reservationId}`,
    authorizationItemId: quote.item.id,
    idempotencyKey: options.idempotencyKey ?? `idempotency_${reservationId}`,
    words,
    settings,
    provider: imageRoute,
    cancellationPolicy: 'queued_and_running' as const,
    quote: unstampedQuote,
    authoringRevision,
    authoringFingerprintVersion: 1 as const,
    authoringFingerprint,
    projectRevisionAtPreparation: 8,
  };
  const reservation =
    mode === 'create'
      ? { ...base, mode, proposedHandle: options.proposedHandle ?? 'dai_pai_dong', orderIndex: 0 }
      : {
          ...base,
          mode,
          sourceJobId: `source_${reservationId}`,
          lineage: [
            {
              jobId: `source_${reservationId}`,
              retryOfJobId: null,
              retryReason: null,
            },
          ],
          retryReason: options.retryReason ?? ('provider_failure' as const),
        };
  return {
    reservation,
    spendPolicy:
      options.spendPolicy === undefined ? { currency: 'USD', maxPerBatchMinorUnits: 20 } : options.spendPolicy,
  };
};

const makePhotoConfirmationV3 = (
  reservation: StudioPreparedPhotoReservationV3,
  explicitHumanConfirmation: boolean,
  duplicateChargeAcknowledged: boolean
) => ({
  reservationId: reservation.reservationId,
  quoteId: reservation.quote.id,
  quoteRevision: reservation.quote.quoteRevision,
  explicitHumanConfirmation,
  duplicateChargeAcknowledged,
});

describe('StudioPreparedSubmissionCacheV2', () => {
  it('freezes exact project-reference intent and preserves a main-owned handoff correlation', () => {
    const cache = new StudioPreparedSubmissionCacheV2({ now: () => PREPARED_AT_MS });
    const admission = makeProjectReferenceAdmission('handoff_1');

    cache.admit(admission);
    admission.request.referenceIds = ['mutated_reference'];

    const claim = cache.claim('project_1', 'quote_1');
    expect(claim.option).toBe('baseOnly');
    expect(claim.session.request).toEqual({
      projectId: 'project_1',
      expectedRevision: 7,
      referenceIds: ['reference_character'],
    });
    expect(claim.quote).toMatchObject({
      originReferenceHandoffId: 'handoff_1',
      baseItems: [
        {
          target: { kind: 'reference', referenceId: 'reference_character' },
          purpose: 'reference_image',
        },
      ],
      cascadeItems: [],
    });
  });

  it('refuses project-reference sessions whose item scope or handoff identity is not exact', () => {
    const wrongItem = makeProjectReferenceAdmission();
    wrongItem.options.baseOnly.baseItems[0]!.target = {
      kind: 'reference',
      referenceId: 'reference_other',
    };
    const unsafeHandoff = makeProjectReferenceAdmission('../handoff');

    for (const admission of [wrongItem, unsafeHandoff]) {
      const cache = new StudioPreparedSubmissionCacheV2({ now: () => PREPARED_AT_MS });
      expect(() => cache.admit(admission)).toThrow('invalid_prepared_submission_session:reference_option_mismatch');
    }
  });

  it('stores the serialized copy, freezes the claimed authority, and isolates caller mutations', () => {
    const cache = new StudioPreparedSubmissionCacheV2({ now: () => PREPARED_AT_MS });
    const admission = makeAdmission({ withCascadeQuoteId: 'quote_2' });
    const admitted = cache.admit(admission);

    admission.request.projectId = 'mutated_project';
    admission.options.baseOnly.baseItems[0]!.rateMinorUnits = 999;
    admission.providerBindings[0]!.provider.model = 'mutated-model';
    admission.cancellationPolicies[0]!.policy = 'none';
    admitted.request.projectId = 'mutated_returned_copy';

    const claim = cache.claim('project_1', 'quote_2');
    expect(claim.option).toBe('withCascade');
    expect(claim.session.preparedAt).toBe(PREPARED_AT);
    expect(claim.session.request.projectId).toBe('project_1');
    expect(claim.quote.baseItems[0]!.rateMinorUnits).toBe(25);
    expect(claim.session.providerBindings[0]!.provider.model).toBe('image-model');
    expect(claim.session.cancellationPolicies[0]!.policy).toBe('queued_and_running');
    expect(Object.isFrozen(claim.session)).toBe(true);
    expect(Object.isFrozen(claim.session.options.baseOnly.baseItems[0]!.requestPlan)).toBe(true);
    expect(() => {
      claim.session.request.projectId = 'forbidden';
    }).toThrow(TypeError);
  });

  it('claims sibling options as one session, releases refusals, and consumes both on success', () => {
    const cache = new StudioPreparedSubmissionCacheV2({ now: () => PREPARED_AT_MS });
    cache.admit(makeAdmission({ withCascadeQuoteId: 'quote_2' }));

    const baseClaim = cache.claim('project_1', 'quote_1');
    expectCacheCode(() => cache.claim('project_1', 'quote_1'), 'quote_in_use');
    expectCacheCode(() => cache.claim('project_1', 'quote_2'), 'quote_in_use');
    cache.release(baseClaim);

    const cascadeClaim = cache.claim('project_1', 'quote_2');
    cache.consume(cascadeClaim);
    expectCacheCode(() => cache.claim('project_1', 'quote_1'), 'quote_not_found');
    expectCacheCode(() => cache.claim('project_1', 'quote_2'), 'quote_not_found');
  });

  it('reclaims idle expiry at the exact boundary without extending TTL after release', () => {
    let now = PREPARED_AT_MS;
    const cache = new StudioPreparedSubmissionCacheV2({ now: () => now });
    cache.admit(makeAdmission());
    const claim = cache.claim('project_1', 'quote_1');

    now = Date.parse(EXPIRES_AT) - 1;
    cache.release(claim);
    expect(cache.claim('project_1', 'quote_1').quote.id).toBe('quote_1');

    now = Date.parse(EXPIRES_AT);
    expectCacheCode(() => cache.claim('project_1', 'quote_1'), 'quote_not_found');
  });

  it('makes an expired claimed session undiscoverable but counted until its owner releases it', () => {
    let now = PREPARED_AT_MS;
    const cache = new StudioPreparedSubmissionCacheV2({ now: () => now });
    const claims: StudioPreparedSubmissionClaimV2[] = [];
    for (let index = 0; index < STUDIO_MAX_PREPARED_QUOTE_SESSIONS_PER_PROJECT; index += 1) {
      const quoteId = `quote_${index}`;
      cache.admit(makeAdmission({ quoteId }));
      claims.push(cache.claim('project_1', quoteId));
    }

    now = Date.parse(EXPIRES_AT);
    expectCacheCode(() => cache.claim('project_1', 'quote_0'), 'quote_not_found');
    expectCacheCode(() => cache.admit(makeAdmission({ quoteId: 'quote_new' })), 'quote_cache_full');
    cache.release(claims[0]!);
    expect(cache.admit(makeAdmission({ quoteId: 'quote_new' })).options.baseOnly.id).toBe('quote_new');
  });

  it('admits one byte below and at the session cap, and rejects one byte above it', () => {
    for (const byteSize of [STUDIO_MAX_PREPARED_QUOTE_SESSION_BYTES - 1, STUDIO_MAX_PREPARED_QUOTE_SESSION_BYTES]) {
      const cache = new StudioPreparedSubmissionCacheV2({ now: () => PREPARED_AT_MS });
      cache.admit(makeSizedAdmission(byteSize));
      expect(cache.claim('project_1', 'quote_1').quote.id).toBe('quote_1');
      cache.close();
    }
    const cache = new StudioPreparedSubmissionCacheV2({ now: () => PREPARED_AT_MS });
    expectCacheCode(
      () => cache.admit(makeSizedAdmission(STUDIO_MAX_PREPARED_QUOTE_SESSION_BYTES + 1)),
      'quote_too_large'
    );
  });

  it('accounts multibyte UTF-8 bytes rather than JavaScript character count', () => {
    const admission = makeSizedAdmission(STUDIO_MAX_PREPARED_QUOTE_SESSION_BYTES - 1);
    const plan = admission.options.baseOnly.baseItems[0]!.requestPlan;
    if (plan.kind !== 'resolved') throw new Error('test base item must be resolved');
    plan.snapshot.composition.prompt = `${plan.snapshot.composition.prompt}é`;
    expect(serializedSessionBytes(admission)).toBe(STUDIO_MAX_PREPARED_QUOTE_SESSION_BYTES + 1);
    const cache = new StudioPreparedSubmissionCacheV2({ now: () => PREPARED_AT_MS });
    expectCacheCode(() => cache.admit(admission), 'quote_too_large');
  });

  it('enforces the per-project count cap, evicts only idle oldest sessions, and fails when all are claimed', () => {
    let now = PREPARED_AT_MS;
    const cache = new StudioPreparedSubmissionCacheV2({ now: () => now });
    const claims: StudioPreparedSubmissionClaimV2[] = [];
    for (let index = 0; index < STUDIO_MAX_PREPARED_QUOTE_SESSIONS_PER_PROJECT; index += 1) {
      const quoteId = `quote_${index}`;
      cache.admit(makeAdmission({ quoteId }));
      claims.push(cache.claim('project_1', quoteId));
      now += 1;
    }
    expectCacheCode(() => cache.admit(makeAdmission({ quoteId: 'quote_full' })), 'quote_cache_full');

    cache.release(claims[0]!);
    cache.admit(makeAdmission({ quoteId: 'quote_replacement' }));
    expectCacheCode(() => cache.claim('project_1', 'quote_0'), 'quote_not_found');
    expect(cache.claim('project_1', 'quote_replacement').quote.id).toBe('quote_replacement');
  });

  it('enforces the global count cap and deterministic preparedAt/project/quote tie eviction', () => {
    const cache = new StudioPreparedSubmissionCacheV2({ now: () => PREPARED_AT_MS });
    const claims: StudioPreparedSubmissionClaimV2[] = [];
    for (let index = 0; index < STUDIO_MAX_PREPARED_QUOTE_SESSIONS_GLOBAL; index += 1) {
      const projectId = `project_${String(Math.floor(index / 4)).padStart(2, '0')}`;
      const quoteId = `quote_${String(index).padStart(2, '0')}`;
      cache.admit(makeAdmission({ projectId, quoteId }));
      claims.push(cache.claim(projectId, quoteId));
    }
    expectCacheCode(
      () => cache.admit(makeAdmission({ projectId: 'project_99', quoteId: 'quote_full' })),
      'quote_cache_full'
    );
    for (const claim of claims) cache.release(claim);

    cache.admit(makeAdmission({ projectId: 'project_99', quoteId: 'quote_new' }));
    expectCacheCode(() => cache.claim('project_00', 'quote_00'), 'quote_not_found');
    expect(cache.claim('project_00', 'quote_01').quote.id).toBe('quote_01');
  });

  it('enforces the per-project byte cap at exact max-size boundaries', () => {
    const cache = new StudioPreparedSubmissionCacheV2({ now: () => PREPARED_AT_MS });
    const first = makeSizedAdmission(STUDIO_MAX_PREPARED_QUOTE_SESSION_BYTES, { quoteId: 'quote_1' });
    const second = makeSizedAdmission(STUDIO_MAX_PREPARED_QUOTE_SESSION_BYTES, { quoteId: 'quote_2' });
    expect(STUDIO_MAX_PREPARED_QUOTE_SESSION_BYTES * 2).toBe(STUDIO_MAX_PREPARED_QUOTE_CACHE_BYTES_PER_PROJECT);
    cache.admit(first);
    cache.admit(second);
    const firstClaim = cache.claim('project_1', 'quote_1');
    const secondClaim = cache.claim('project_1', 'quote_2');
    expectCacheCode(() => cache.admit(makeAdmission({ quoteId: 'quote_full' })), 'quote_cache_full');
    cache.release(firstClaim);
    cache.release(secondClaim);

    cache.admit(makeAdmission({ quoteId: 'quote_new' }));
    expectCacheCode(() => cache.claim('project_1', 'quote_1'), 'quote_not_found');
    expect(cache.claim('project_1', 'quote_2').quote.id).toBe('quote_2');
  });

  it('enforces the global byte cap with claimed sessions and reclaims the deterministic idle oldest', () => {
    const cache = new StudioPreparedSubmissionCacheV2({ now: () => PREPARED_AT_MS });
    const sessionCount = STUDIO_MAX_PREPARED_QUOTE_CACHE_BYTES_GLOBAL / STUDIO_MAX_PREPARED_QUOTE_SESSION_BYTES;
    expect(Number.isSafeInteger(sessionCount)).toBe(true);
    const claims: StudioPreparedSubmissionClaimV2[] = [];
    for (let index = 0; index < sessionCount; index += 1) {
      const projectId = `project_${Math.floor(index / 2)}`;
      const quoteId = `quote_${index}`;
      cache.admit(
        makeSizedAdmission(STUDIO_MAX_PREPARED_QUOTE_SESSION_BYTES, {
          projectId,
          quoteId,
        })
      );
      claims.push(cache.claim(projectId, quoteId));
    }
    expectCacheCode(
      () => cache.admit(makeAdmission({ projectId: 'project_new', quoteId: 'quote_full' })),
      'quote_cache_full'
    );
    for (const claim of claims) cache.release(claim);

    cache.admit(makeAdmission({ projectId: 'project_new', quoteId: 'quote_new' }));
    expectCacheCode(() => cache.claim('project_0', 'quote_0'), 'quote_not_found');
    expect(cache.claim('project_0', 'quote_1').quote.id).toBe('quote_1');
  });

  it('rejects same-project quote collisions without replacing the existing session', () => {
    const cache = new StudioPreparedSubmissionCacheV2({ now: () => PREPARED_AT_MS });
    cache.admit(makeAdmission({ quoteId: 'quote_same' }));
    expect(() => cache.admit(makeAdmission({ quoteId: 'quote_same' }))).toThrow(
      'invalid_prepared_submission_session:quote_id_collision'
    );
    expect(cache.claim('project_1', 'quote_same').quote.id).toBe('quote_same');
  });

  it('isolates the same opaque quote ID by project', () => {
    const cache = new StudioPreparedSubmissionCacheV2({ now: () => PREPARED_AT_MS });
    cache.admit(makeAdmission({ projectId: 'project_1', quoteId: 'quote_same' }));
    cache.admit(makeAdmission({ projectId: 'project_2', quoteId: 'quote_same' }));

    const first = cache.claim('project_1', 'quote_same');
    const second = cache.claim('project_2', 'quote_same');
    expect(first.session.request.projectId).toBe('project_1');
    expect(second.session.request.projectId).toBe('project_2');
    expectCacheCode(() => cache.claim('project_3', 'quote_same'), 'quote_not_found');
  });

  it('retains an exact cascade request when its sibling is unavailable and permits option-scoped rate digests', () => {
    const unavailable = makeAdmission();
    unavailable.request.cascadeChoices.push({
      target: { kind: 'shot', shotId: 'shot_2' },
      purpose: 'video_take',
    });
    const baseCache = new StudioPreparedSubmissionCacheV2({ now: () => PREPARED_AT_MS });
    baseCache.admit(unavailable);
    const baseClaim = baseCache.claim('project_1', 'quote_1');
    expect(baseClaim.option).toBe('baseOnly');
    expect(baseClaim.session.request.cascadeChoices).toEqual(unavailable.request.cascadeChoices);
    expect(baseClaim.session.options.withCascade).toBeNull();

    const siblings = makeAdmission({ withCascadeQuoteId: 'quote_2' });
    siblings.options.withCascade!.rateCardDigest = 'b'.repeat(64);
    const siblingCache = new StudioPreparedSubmissionCacheV2({ now: () => PREPARED_AT_MS });
    siblingCache.admit(siblings);
    expect(siblingCache.claim('project_1', 'quote_2').quote.rateCardDigest).toBe('b'.repeat(64));
  });

  it('stamps its own expiry and refuses project, revision, cascade, and provider-binding mismatches', () => {
    const stamps = makeAdmission();
    stamps.options.baseOnly.expiresAt = '2025-01-01T00:00:00.000Z';
    const stampingCache = new StudioPreparedSubmissionCacheV2({ now: () => PREPARED_AT_MS });
    expect(stampingCache.admit(stamps).options.baseOnly.expiresAt).toBe(EXPIRES_AT);

    const cases: StudioPreparedSubmissionCacheAdmissionV2[] = [];
    const wrongProject = makeAdmission();
    wrongProject.options.baseOnly.projectId = 'project_2';
    cases.push(wrongProject);
    const wrongRevision = makeAdmission();
    wrongRevision.options.baseOnly.projectRevision = 8;
    cases.push(wrongRevision);
    const unexpectedCascade = makeAdmission({ withCascadeQuoteId: 'quote_2' });
    unexpectedCascade.request.cascadeChoices = [];
    cases.push(unexpectedCascade);
    const missingBinding = makeAdmission();
    missingBinding.providerBindings = [];
    cases.push(missingBinding);

    for (const admission of cases) {
      const cache = new StudioPreparedSubmissionCacheV2({ now: () => PREPARED_AT_MS });
      expect(() => cache.admit(admission)).toThrow(/invalid_prepared_submission_session/);
      expectCacheCode(() => cache.claim('project_1', 'quote_1'), 'quote_not_found');
    }
  });

  it('starts empty after restart and disposes idle and claimed entries on close', () => {
    const first = new StudioPreparedSubmissionCacheV2({ now: () => PREPARED_AT_MS });
    first.admit(makeAdmission({ quoteId: 'quote_idle' }));
    first.admit(makeAdmission({ quoteId: 'quote_claimed' }));
    const claim = first.claim('project_1', 'quote_claimed');
    first.close();
    first.release(claim);
    expect(() => first.claim('project_1', 'quote_idle')).toThrow('prepared_submission_cache_closed');

    const restarted = new StudioPreparedSubmissionCacheV2({ now: () => PREPARED_AT_MS });
    expectCacheCode(() => restarted.claim('project_1', 'quote_idle'), 'quote_not_found');
    expectCacheCode(() => restarted.claim('project_1', 'quote_claimed'), 'quote_not_found');
  });

  it('keeps the cache error codes distinct', () => {
    const cache = new StudioPreparedSubmissionCacheV2({ now: () => PREPARED_AT_MS });
    expectCacheCode(() => cache.claim('project_1', 'quote_missing'), 'quote_not_found');
    cache.admit(makeAdmission());
    const claim = cache.claim('project_1', 'quote_1');
    expectCacheCode(() => cache.claim('project_1', 'quote_1'), 'quote_in_use');
    cache.release(claim);

    expectCacheCode(
      () => cache.admit(makeSizedAdmission(STUDIO_MAX_PREPARED_QUOTE_SESSION_BYTES + 1, { quoteId: 'quote_huge' })),
      'quote_too_large'
    );
  });
});

describe('inactive StudioPreparedPhotoCacheV3', () => {
  it('freezes one exact create reservation and exposes only a renderer-safe projection', () => {
    const cache = new StudioPreparedPhotoCacheV3({ now: () => PREPARED_AT_MS });
    const admission = makePieceAdmissionV3();
    const admitted = cache.admit(admission);
    const projection = cache.list('project_piece_1')[0]!;

    expect(admitted).toMatchObject({
      reservationId: 'reservation_piece_1',
      mode: 'create',
      proposedHandle: 'dai_pai_dong',
      orderIndex: 0,
      preparedAt: PREPARED_AT,
      expiresAt: EXPIRES_AT,
      quote: { expiresAt: EXPIRES_AT },
    });
    expect(projection).toEqual({
      reservationId: 'reservation_piece_1',
      projectId: 'project_piece_1',
      quoteId: 'quote_piece_1',
      quoteRevision: 1,
      targetPieceId: 'piece_1',
      words: 'A neon dai pai dong in warm rain.',
      settings: { aspectRatio: '16:9', resolution: '1080p' },
      currency: 'USD',
      lowerMinorUnits: 20,
      upperMinorUnits: 20,
      spendPolicyClassification: 'within_cap',
      expiresAt: EXPIRES_AT,
      requiresExplicitHumanAction: false,
      duplicateChargeAcknowledgementRequired: false,
      mode: 'create',
      proposedHandle: 'dai_pai_dong',
      orderIndex: 0,
    });
    for (const forbidden of [
      'provider',
      'authorizationId',
      'authorizationItemId',
      'idempotencyKey',
      'jobId',
      'authoringFingerprint',
      'rateCardDigest',
      'requestPlan',
      'prompt',
    ]) {
      expect(Object.hasOwn(projection, forbidden)).toBe(false);
    }

    projection.words = 'caller mutation';
    expect(cache.list('project_piece_1')[0]!.words).toBe('A neon dai pai dong in warm rain.');
    const claim = cache.claim({
      reservationId: 'reservation_piece_1',
      quoteId: 'quote_piece_1',
      quoteRevision: 1,
    });
    expect(Object.isFrozen(claim.reservation)).toBe(true);
    expect(Object.isFrozen(claim.reservation.quote.item.requestPlan)).toBe(true);
    expect(() => {
      claim.reservation.words = 'forbidden mutation';
    }).toThrow(TypeError);
  });

  it('keeps retry intent distinct and requires duplicate-charge review only for submission unknown', () => {
    const unknownCache = new StudioPreparedPhotoCacheV3({ now: () => PREPARED_AT_MS });
    unknownCache.admit(makePieceAdmissionV3({ mode: 'retry', retryReason: 'submission_unknown' }));
    expect(unknownCache.list('project_piece_1')[0]).toMatchObject({
      mode: 'retry',
      proposedHandle: null,
      orderIndex: null,
      spendPolicyClassification: 'within_cap',
      requiresExplicitHumanAction: true,
      duplicateChargeAcknowledgementRequired: true,
    });

    const ordinaryCache = new StudioPreparedPhotoCacheV3({ now: () => PREPARED_AT_MS });
    ordinaryCache.admit(makePieceAdmissionV3({ mode: 'retry', retryReason: 'provider_failure' }));
    expect(ordinaryCache.list('project_piece_1')[0]).toMatchObject({
      requiresExplicitHumanAction: false,
      duplicateChargeAcknowledgementRequired: false,
    });

    const crossedCreate = makePieceAdmissionV3();
    Object.assign(crossedCreate.reservation, { sourceJobId: 'source_job' });
    expect(() => new StudioPreparedPhotoCacheV3({ now: () => PREPARED_AT_MS }).admit(crossedCreate)).toThrow(
      /invalid_prepared_submission_session:photo_/
    );
    const crossedRetry = makePieceAdmissionV3({ mode: 'retry' });
    Object.assign(crossedRetry.reservation, { proposedHandle: 'forbidden' });
    expect(() => new StudioPreparedPhotoCacheV3({ now: () => PREPARED_AT_MS }).admit(crossedRetry)).toThrow(
      /invalid_prepared_submission_session:photo_/
    );
    const extraAdmission = makePieceAdmissionV3() as StudioPreparedPhotoCacheAdmissionV3 & { extra: boolean };
    extraAdmission.extra = true;
    expect(() => new StudioPreparedPhotoCacheV3({ now: () => PREPARED_AT_MS }).admit(extraAdmission)).toThrow(
      'invalid_prepared_submission_session:photo_admission_shape'
    );
    const branchedRetry = makePieceAdmissionV3({ mode: 'retry' });
    Object.assign(branchedRetry.reservation, {
      sourceJobId: 'source_branch_b',
      lineage: [
        { jobId: 'source_root', retryOfJobId: null, retryReason: null },
        { jobId: 'source_branch_a', retryOfJobId: 'source_root', retryReason: 'provider_failure' },
        { jobId: 'source_branch_b', retryOfJobId: 'source_root', retryReason: 'cancelled' },
      ],
    });
    expect(() => new StudioPreparedPhotoCacheV3({ now: () => PREPARED_AT_MS }).admit(branchedRetry)).toThrow(
      'invalid_prepared_submission_session:photo_retry_shape'
    );
    const secondRoot = makePieceAdmissionV3({ mode: 'retry' });
    Object.assign(secondRoot.reservation, {
      sourceJobId: 'source_root_2',
      lineage: [
        { jobId: 'source_root_1', retryOfJobId: null, retryReason: null },
        { jobId: 'source_root_2', retryOfJobId: null, retryReason: null },
      ],
    });
    expect(() => new StudioPreparedPhotoCacheV3({ now: () => PREPARED_AT_MS }).admit(secondRoot)).toThrow(
      'invalid_prepared_submission_session:photo_retry_shape'
    );
  });

  it('rejects hostile nested admissions before accessors or serialization hooks can run', () => {
    let accessorReads = 0;
    const accessorAdmission = makePieceAdmissionV3();
    Object.defineProperty(accessorAdmission.reservation.settings, 'aspectRatio', {
      enumerable: true,
      get: () => {
        accessorReads += 1;
        return '16:9';
      },
    });
    expect(() => new StudioPreparedPhotoCacheV3({ now: () => PREPARED_AT_MS }).admit(accessorAdmission)).toThrow(
      'invalid_prepared_submission_session:photo_admission_shape'
    );
    expect(accessorReads).toBe(0);

    let serializationHookCalls = 0;
    const serializationAdmission = makePieceAdmissionV3();
    Object.assign(serializationAdmission.reservation.settings, {
      toJSON: () => {
        serializationHookCalls += 1;
        return { aspectRatio: '16:9', resolution: '1080p' };
      },
    });
    expect(() => new StudioPreparedPhotoCacheV3({ now: () => PREPARED_AT_MS }).admit(serializationAdmission)).toThrow(
      'invalid_prepared_submission_session:photo_admission_shape'
    );
    expect(serializationHookCalls).toBe(0);

    const proxyAdmission = makePieceAdmissionV3();
    proxyAdmission.reservation.provider = new Proxy(proxyAdmission.reservation.provider, {});
    expect(() => new StudioPreparedPhotoCacheV3({ now: () => PREPARED_AT_MS }).admit(proxyAdmission)).toThrow(
      'invalid_prepared_submission_session:photo_admission_shape'
    );

    let policyReads = 0;
    const policyAdmission = makePieceAdmissionV3();
    const hostilePolicy = { currency: 'USD' } as Record<string, unknown>;
    Object.defineProperty(hostilePolicy, 'maxPerBatchMinorUnits', {
      enumerable: true,
      get: () => {
        policyReads += 1;
        return 20;
      },
    });
    policyAdmission.spendPolicy = hostilePolicy as never;
    expect(() => new StudioPreparedPhotoCacheV3({ now: () => PREPARED_AT_MS }).admit(policyAdmission)).toThrow(
      'invalid_prepared_submission_session:photo_admission_shape'
    );
    expect(policyReads).toBe(0);

    const undefinedExtra = makePieceAdmissionV3();
    Object.assign(undefinedExtra.reservation.settings, { extra: undefined });
    expect(() => new StudioPreparedPhotoCacheV3({ now: () => PREPARED_AT_MS }).admit(undefinedExtra)).toThrow(
      'invalid_prepared_submission_session:photo_reservation_mismatch'
    );

    const arrayExtra = makePieceAdmissionV3({ mode: 'retry' });
    if (arrayExtra.reservation.mode !== 'retry') throw new Error('test requires a retry admission');
    Object.assign(arrayExtra.reservation.lineage, { extra: 'smuggled' });
    expect(() => new StudioPreparedPhotoCacheV3({ now: () => PREPARED_AT_MS }).admit(arrayExtra)).toThrow(
      'invalid_prepared_submission_session:photo_retry_shape'
    );
  });

  it('uses one admission snapshot even when the clock mutates the caller-owned input', () => {
    const admission = makePieceAdmissionV3();
    const cache = new StudioPreparedPhotoCacheV3({
      now: () => {
        admission.reservation.words = 'Mutated after the boundary snapshot.';
        admission.spendPolicy = { currency: 'USD', maxPerBatchMinorUnits: 0 };
        return PREPARED_AT_MS;
      },
    });

    const admitted = cache.admit(admission);
    expect(admitted.words).toBe('A neon dai pai dong in warm rain.');
    expect(cache.list('project_piece_1')[0]).toMatchObject({
      words: 'A neon dai pai dong in warm rain.',
      spendPolicyClassification: 'within_cap',
      requiresExplicitHumanAction: false,
    });
  });

  it('requires the exact confirmation and duplicate-charge acknowledgement matrix', () => {
    const withinCap = { currency: 'USD', maxPerBatchMinorUnits: 20 };

    const createCache = new StudioPreparedPhotoCacheV3({ now: () => PREPARED_AT_MS });
    const create = createCache.admit(makePieceAdmissionV3());
    expect(
      validateStudioConfirmPreparedPhotoRequestV3(
        makePhotoConfirmationV3(create, false, false),
        create,
        withinCap,
        PREPARED_AT_MS
      )
    ).toBe(true);
    expect(
      validateStudioConfirmPreparedPhotoRequestV3(
        makePhotoConfirmationV3(create, true, false),
        create,
        withinCap,
        PREPARED_AT_MS
      )
    ).toBe(false);
    expect(
      validateStudioConfirmPreparedPhotoRequestV3(
        makePhotoConfirmationV3(create, false, true),
        create,
        withinCap,
        PREPARED_AT_MS
      )
    ).toBe(false);
    expect(
      validateStudioConfirmPreparedPhotoRequestV3(
        makePhotoConfirmationV3(create, true, true),
        create,
        null,
        PREPARED_AT_MS
      )
    ).toBe(false);
    expect(
      validateStudioConfirmPreparedPhotoRequestV3(
        makePhotoConfirmationV3(create, true, false),
        create,
        null,
        PREPARED_AT_MS
      )
    ).toBe(true);

    const unknownCache = new StudioPreparedPhotoCacheV3({ now: () => PREPARED_AT_MS });
    const unknown = unknownCache.admit(
      makePieceAdmissionV3({ mode: 'retry', retryReason: 'submission_unknown', reservationId: 'reservation_unknown' })
    );
    expect(
      validateStudioConfirmPreparedPhotoRequestV3(
        makePhotoConfirmationV3(unknown, true, true),
        unknown,
        withinCap,
        PREPARED_AT_MS
      )
    ).toBe(true);
    expect(
      validateStudioConfirmPreparedPhotoRequestV3(
        makePhotoConfirmationV3(unknown, false, true),
        unknown,
        withinCap,
        PREPARED_AT_MS
      )
    ).toBe(false);
    expect(
      validateStudioConfirmPreparedPhotoRequestV3(
        makePhotoConfirmationV3(unknown, true, false),
        unknown,
        withinCap,
        PREPARED_AT_MS
      )
    ).toBe(false);

    const ordinaryCache = new StudioPreparedPhotoCacheV3({ now: () => PREPARED_AT_MS });
    const ordinary = ordinaryCache.admit(
      makePieceAdmissionV3({ mode: 'retry', retryReason: 'provider_failure', reservationId: 'reservation_ordinary' })
    );
    expect(
      validateStudioConfirmPreparedPhotoRequestV3(
        makePhotoConfirmationV3(ordinary, false, false),
        ordinary,
        withinCap,
        PREPARED_AT_MS
      )
    ).toBe(true);

    expect(
      validateStudioConfirmPreparedPhotoRequestV3(
        { ...makePhotoConfirmationV3(create, false, false), extra: true },
        create,
        withinCap,
        PREPARED_AT_MS
      )
    ).toBe(false);
    expect(
      validateStudioConfirmPreparedPhotoRequestV3(
        makePhotoConfirmationV3(create, false, false),
        create,
        withinCap,
        Date.parse(create.expiresAt)
      )
    ).toBe(false);
  });

  it('reserves active create handles and rejects cross-reservation identity collisions', () => {
    const cache = new StudioPreparedPhotoCacheV3({ now: () => PREPARED_AT_MS });
    const first = cache.admit(makePieceAdmissionV3());

    expect(cache.reservedCreateHandles('project_piece_1')).toEqual(['dai_pai_dong']);
    const suffix = deriveStudioPieceHandleV3('dai pai dong', cache.reservedCreateHandles('project_piece_1'));
    expect(suffix).toBe('dai_pai_dong_2');
    cache.admit(
      makePieceAdmissionV3({
        reservationId: 'reservation_piece_2',
        quoteId: 'quote_piece_2',
        quoteRevision: 2,
        pieceId: 'piece_2',
        proposedHandle: suffix,
      })
    );
    expect(cache.reservedCreateHandles('project_piece_1')).toEqual(['dai_pai_dong', 'dai_pai_dong_2']);

    expect(() =>
      cache.admit(
        makePieceAdmissionV3({
          reservationId: 'reservation_duplicate_handle',
          quoteId: 'quote_duplicate_handle',
          quoteRevision: 3,
          pieceId: 'piece_duplicate_handle',
          proposedHandle: first.proposedHandle,
        })
      )
    ).toThrow('invalid_prepared_submission_session:photo_handle_collision');

    const collisionCases: PieceAdmissionOptionsV3[] = [
      { pieceId: 'piece_1' },
      { jobId: first.jobId },
      { authorizationId: first.authorizationId },
      { idempotencyKey: first.idempotencyKey },
    ];
    collisionCases.forEach((collision, index) => {
      expect(() =>
        cache.admit(
          makePieceAdmissionV3({
            reservationId: `reservation_identity_${index}`,
            quoteId: `quote_identity_${index}`,
            quoteRevision: index + 10,
            pieceId: `piece_identity_${index}`,
            proposedHandle: `piece_identity_${index}`,
            ...collision,
          })
        )
      ).toThrow('invalid_prepared_submission_session:photo_identity_collision');
    });

    const firstClaim = cache.claim({
      reservationId: first.reservationId,
      quoteId: first.quote.id,
      quoteRevision: first.quote.quoteRevision,
    });
    cache.consume(firstClaim);
    expect(cache.reservedCreateHandles('project_piece_1')).toEqual(['dai_pai_dong_2']);
  });

  it('preserves normalized Unicode and accounts for its serialized UTF-8 representation', () => {
    const cache = new StudioPreparedPhotoCacheV3({ now: () => PREPARED_AT_MS });
    const admission = makePieceAdmissionV3({ words: '明るい雨の屋台。' });
    admission.reservation.quote.item.requestPlan.snapshot.composition.prompt = '字'.repeat(
      STUDIO_MAX_GENERATION_PROMPT_LENGTH
    );
    const admitted = cache.admit(admission);
    const serialized = JSON.stringify(admitted);
    expect(admitted.words).toBe('明るい雨の屋台。');
    expect(Buffer.byteLength(serialized, 'utf8')).toBeGreaterThan(serialized.length);
    expect(Buffer.byteLength(serialized, 'utf8')).toBeLessThan(STUDIO_MAX_PREPARED_QUOTE_SESSION_BYTES);

    const overSemanticBound = makePieceAdmissionV3({ reservationId: 'reservation_oversized_prompt' });
    overSemanticBound.reservation.quote.item.requestPlan.snapshot.composition.prompt = 'x'.repeat(
      STUDIO_MAX_GENERATION_PROMPT_LENGTH + 1
    );
    expect(() => cache.admit(overSemanticBound)).toThrow(/invalid_prepared_submission_session/);
  });

  it('claims only the exact reservation, quote, and revision and supports release then atomic consume', () => {
    const cache = new StudioPreparedPhotoCacheV3({ now: () => PREPARED_AT_MS });
    cache.admit(makePieceAdmissionV3());
    expectCacheCode(
      () => cache.claim({ reservationId: 'reservation_piece_1', quoteId: 'quote_other', quoteRevision: 1 }),
      'quote_not_found'
    );
    expectCacheCode(
      () => cache.claim({ reservationId: 'reservation_piece_1', quoteId: 'quote_piece_1', quoteRevision: 2 }),
      'quote_not_found'
    );
    expectCacheCode(
      () =>
        cache.claim({
          reservationId: 'reservation_piece_1',
          quoteId: 'quote_piece_1',
          quoteRevision: 1,
          extra: true,
        } as never),
      'quote_not_found'
    );

    const first = cache.claim({ reservationId: 'reservation_piece_1', quoteId: 'quote_piece_1', quoteRevision: 1 });
    expectCacheCode(
      () => cache.claim({ reservationId: 'reservation_piece_1', quoteId: 'quote_piece_1', quoteRevision: 1 }),
      'quote_in_use'
    );
    cache.release(first);
    const second = cache.claim({ reservationId: 'reservation_piece_1', quoteId: 'quote_piece_1', quoteRevision: 1 });
    cache.consume(second);
    expect(cache.list('project_piece_1')).toEqual([]);
    expectCacheCode(
      () => cache.claim({ reservationId: 'reservation_piece_1', quoteId: 'quote_piece_1', quoteRevision: 1 }),
      'quote_not_found'
    );
  });

  it('discards only the exact idle quote, releases its handle, and notifies renderer activity', () => {
    const changes: string[] = [];
    const cache = new StudioPreparedPhotoCacheV3({
      now: () => PREPARED_AT_MS,
      onChange: (projectId) => changes.push(projectId),
    });
    cache.admit(makePieceAdmissionV3());
    const exact = { reservationId: 'reservation_piece_1', quoteId: 'quote_piece_1', quoteRevision: 1 };

    expectCacheCode(() => cache.discard({ ...exact, quoteId: 'quote_stale' }), 'quote_not_found');
    expectCacheCode(() => cache.discard({ ...exact, quoteRevision: 2 }), 'quote_not_found');
    expect(cache.list('project_piece_1')).toHaveLength(1);
    expect(cache.reservedCreateHandles('project_piece_1')).toEqual(['dai_pai_dong']);

    expect(cache.discard(exact)).toBe('project_piece_1');
    expect(cache.list('project_piece_1')).toEqual([]);
    expect(cache.reservedCreateHandles('project_piece_1')).toEqual([]);
    expect(changes).toEqual(['project_piece_1', 'project_piece_1']);
    expectCacheCode(() => cache.discard(exact), 'quote_not_found');
  });

  it('releases per-project capacity and refuses to discard a claimed quote', () => {
    const cache = new StudioPreparedPhotoCacheV3({ now: () => PREPARED_AT_MS });
    for (let index = 0; index < STUDIO_MAX_PREPARED_QUOTE_SESSIONS_PER_PROJECT; index += 1) {
      cache.admit(
        makePieceAdmissionV3({
          reservationId: `reservation_capacity_${index}`,
          quoteId: `quote_capacity_${index}`,
          quoteRevision: index + 1,
          pieceId: `piece_capacity_${index}`,
          proposedHandle: `piece_capacity_${index}`,
        })
      );
    }
    const first = {
      reservationId: 'reservation_capacity_0',
      quoteId: 'quote_capacity_0',
      quoteRevision: 1,
    };
    const claim = cache.claim(first);
    expectCacheCode(() => cache.discard(first), 'quote_in_use');
    cache.release(claim);
    expect(cache.discard(first)).toBe('project_piece_1');

    expect(() =>
      cache.admit(
        makePieceAdmissionV3({
          reservationId: 'reservation_capacity_replacement',
          quoteId: 'quote_capacity_replacement',
          quoteRevision: STUDIO_MAX_PREPARED_QUOTE_SESSIONS_PER_PROJECT + 1,
          pieceId: 'piece_capacity_replacement',
          proposedHandle: 'piece_capacity_0',
        })
      )
    ).not.toThrow();
    expect(cache.list('project_piece_1')).toHaveLength(STUDIO_MAX_PREPARED_QUOTE_SESSIONS_PER_PROJECT);
  });

  it('invalidates one project atomically while retaining claimed cleanup authority', () => {
    const changes: string[] = [];
    const cache = new StudioPreparedPhotoCacheV3({
      now: () => PREPARED_AT_MS,
      onChange: (projectId) => changes.push(projectId),
    });
    const first = makePieceAdmissionV3({
      projectId: 'project_invalidate',
      reservationId: 'reservation_invalidate_1',
      quoteId: 'quote_invalidate_1',
      pieceId: 'piece_invalidate_1',
      proposedHandle: 'invalidate_1',
    });
    const second = makePieceAdmissionV3({
      projectId: 'project_invalidate',
      reservationId: 'reservation_invalidate_2',
      quoteId: 'quote_invalidate_2',
      quoteRevision: 2,
      pieceId: 'piece_invalidate_2',
      proposedHandle: 'invalidate_2',
    });
    cache.admit(first);
    cache.admit(second);
    cache.admit(
      makePieceAdmissionV3({
        projectId: 'project_invalidate',
        reservationId: 'reservation_current',
        quoteId: 'quote_current',
        quoteRevision: 4,
        pieceId: 'piece_current',
        proposedHandle: 'current',
        authoringRevision: 4,
      })
    );
    cache.admit(
      makePieceAdmissionV3({
        projectId: 'project_invalidate',
        reservationId: 'reservation_newer',
        quoteId: 'quote_newer',
        quoteRevision: 5,
        pieceId: 'piece_newer',
        proposedHandle: 'newer',
        authoringRevision: 5,
      })
    );
    cache.admit(
      makePieceAdmissionV3({
        projectId: 'project_untouched',
        reservationId: 'reservation_untouched',
        quoteId: 'quote_untouched',
        pieceId: 'piece_untouched',
        proposedHandle: 'untouched',
      })
    );
    const claim = cache.claim({
      reservationId: 'reservation_invalidate_1',
      quoteId: 'quote_invalidate_1',
      quoteRevision: 1,
    });
    changes.length = 0;

    expectCacheCode(() => cache.invalidateProject('../project_invalidate', 4), 'quote_not_found');
    expectCacheCode(() => cache.invalidateProject('project_invalidate', 0), 'quote_not_found');
    expect(cache.invalidateProject('project_missing', 4)).toBe(0);
    expect(changes).toEqual([]);
    expect(cache.invalidateProject('project_invalidate', 4)).toBe(2);
    expect(changes).toEqual(['project_invalidate']);
    expect(cache.list('project_invalidate')).toEqual([
      expect.objectContaining({ reservationId: 'reservation_current' }),
      expect.objectContaining({ reservationId: 'reservation_newer' }),
    ]);
    expect(cache.list('project_untouched')).toHaveLength(1);
    expectCacheCode(
      () =>
        cache.claim({
          reservationId: 'reservation_invalidate_1',
          quoteId: 'quote_invalidate_1',
          quoteRevision: 1,
        }),
      'quote_not_found'
    );
    expectCacheCode(
      () =>
        cache.claim({
          reservationId: 'reservation_invalidate_2',
          quoteId: 'quote_invalidate_2',
          quoteRevision: 2,
        }),
      'quote_not_found'
    );
    expect(cache.invalidateProject('project_invalidate', 4)).toBe(0);

    cache.release(claim);
    expect(changes).toEqual(['project_invalidate', 'project_invalidate']);
    expect(() => cache.admit(first)).not.toThrow();
  });

  it('expires at the exact TTL boundary, notifies projections, and restarts empty', () => {
    let now = PREPARED_AT_MS;
    const changes: string[] = [];
    const cache = new StudioPreparedPhotoCacheV3({ now: () => now, onChange: (projectId) => changes.push(projectId) });
    cache.admit(makePieceAdmissionV3());
    const claim = cache.claim({ reservationId: 'reservation_piece_1', quoteId: 'quote_piece_1', quoteRevision: 1 });

    now = Date.parse(EXPIRES_AT) - 1;
    expect(cache.list('project_piece_1')).toHaveLength(1);
    now = Date.parse(EXPIRES_AT);
    expect(cache.list('project_piece_1')).toEqual([]);
    expectCacheCode(
      () => cache.claim({ reservationId: 'reservation_piece_1', quoteId: 'quote_piece_1', quoteRevision: 1 }),
      'quote_not_found'
    );
    cache.release(claim);
    expect(changes).toEqual(['project_piece_1', 'project_piece_1', 'project_piece_1']);
    cache.close();
    expect(() => cache.list('project_piece_1')).toThrow('prepared_photo_cache_closed');

    const restarted = new StudioPreparedPhotoCacheV3({ now: () => PREPARED_AT_MS });
    expect(restarted.list('project_piece_1')).toEqual([]);
  });

  it('keeps an expired claimed reservation identity reserved until its exact claim releases', () => {
    let now = PREPARED_AT_MS;
    const cache = new StudioPreparedPhotoCacheV3({ now: () => now });
    cache.admit(makePieceAdmissionV3());
    const oldClaim = cache.claim({
      reservationId: 'reservation_piece_1',
      quoteId: 'quote_piece_1',
      quoteRevision: 1,
    });
    now = Date.parse(EXPIRES_AT);
    expect(cache.list('project_piece_1')).toEqual([]);

    const replacement = makePieceAdmissionV3({
      reservationId: 'reservation_piece_1',
      quoteId: 'quote_replacement',
      quoteRevision: 2,
      pieceId: 'piece_replacement',
      proposedHandle: 'piece_replacement',
      jobId: 'job_replacement',
      authorizationId: 'authorization_replacement',
      idempotencyKey: 'idempotency_replacement',
    });
    expect(() => cache.admit(replacement)).toThrow('invalid_prepared_submission_session:photo_reservation_collision');

    cache.release(oldClaim);
    const admitted = cache.admit(replacement);
    expect(
      cache.claim({
        reservationId: admitted.reservationId,
        quoteId: admitted.quote.id,
        quoteRevision: admitted.quote.quoteRevision,
      }).reservation.quote.id
    ).toBe('quote_replacement');
  });

  it('isolates listener failures from admit, release, consume, and close authority changes', () => {
    const cache = new StudioPreparedPhotoCacheV3({
      now: () => PREPARED_AT_MS,
      onChange: () => {
        throw new Error('renderer listener failed');
      },
    });

    expect(() => cache.admit(makePieceAdmissionV3())).not.toThrow();
    expect(cache.list('project_piece_1')).toHaveLength(1);
    const first = cache.claim({ reservationId: 'reservation_piece_1', quoteId: 'quote_piece_1', quoteRevision: 1 });
    expect(() => cache.release(first)).not.toThrow();
    const second = cache.claim({ reservationId: 'reservation_piece_1', quoteId: 'quote_piece_1', quoteRevision: 1 });
    expect(() => cache.consume(second)).not.toThrow();
    expect(cache.list('project_piece_1')).toEqual([]);
    expect(() => cache.close()).not.toThrow();
  });

  it('emits renderer activity after ordinary release and consume transitions', () => {
    const changes: string[] = [];
    const cache = new StudioPreparedPhotoCacheV3({
      now: () => PREPARED_AT_MS,
      onChange: (projectId) => changes.push(projectId),
    });
    cache.admit(makePieceAdmissionV3());
    const first = cache.claim({ reservationId: 'reservation_piece_1', quoteId: 'quote_piece_1', quoteRevision: 1 });
    cache.release(first);
    expect(cache.list('project_piece_1')).toHaveLength(1);

    const second = cache.claim({ reservationId: 'reservation_piece_1', quoteId: 'quote_piece_1', quoteRevision: 1 });
    cache.consume(second);
    expect(cache.list('project_piece_1')).toEqual([]);
    expect(changes).toEqual(['project_piece_1', 'project_piece_1', 'project_piece_1']);
  });

  it('enforces the global session cap and evicts only the deterministic oldest idle reservation', () => {
    const optionsAt = (index: number): PieceAdmissionOptionsV3 => ({
      projectId: `project_global_${Math.floor(index / STUDIO_MAX_PREPARED_QUOTE_SESSIONS_PER_PROJECT)}`,
      reservationId: `reservation_global_${index}`,
      quoteId: `quote_global_${index}`,
      quoteRevision: index + 1,
      pieceId: `piece_global_${index}`,
      proposedHandle: `piece_global_${index}`,
    });
    let now = PREPARED_AT_MS;
    const claimedCache = new StudioPreparedPhotoCacheV3({ now: () => now });
    const claims = [];
    for (let index = 0; index < STUDIO_MAX_PREPARED_QUOTE_SESSIONS_GLOBAL; index += 1) {
      const admitted = claimedCache.admit(makePieceAdmissionV3(optionsAt(index)));
      claims.push(
        claimedCache.claim({
          reservationId: admitted.reservationId,
          quoteId: admitted.quote.id,
          quoteRevision: admitted.quote.quoteRevision,
        })
      );
      now += 1;
    }
    expectCacheCode(
      () => claimedCache.admit(makePieceAdmissionV3(optionsAt(STUDIO_MAX_PREPARED_QUOTE_SESSIONS_GLOBAL))),
      'quote_cache_full'
    );
    expect(claims).toHaveLength(STUDIO_MAX_PREPARED_QUOTE_SESSIONS_GLOBAL);

    now = PREPARED_AT_MS;
    const idleCache = new StudioPreparedPhotoCacheV3({ now: () => now });
    for (let index = 0; index <= STUDIO_MAX_PREPARED_QUOTE_SESSIONS_GLOBAL; index += 1) {
      idleCache.admit(makePieceAdmissionV3(optionsAt(index)));
      now += 1;
    }
    expectCacheCode(
      () => idleCache.claim({ reservationId: 'reservation_global_0', quoteId: 'quote_global_0', quoteRevision: 1 }),
      'quote_not_found'
    );
    expect(
      Array.from(
        { length: Math.ceil((STUDIO_MAX_PREPARED_QUOTE_SESSIONS_GLOBAL + 1) / 4) },
        (_, index) => idleCache.list(`project_global_${index}`).length
      ).reduce((total, count) => total + count, 0)
    ).toBe(STUDIO_MAX_PREPARED_QUOTE_SESSIONS_GLOBAL);
    expect(idleCache.list('project_global_4')[0]?.reservationId).toBe('reservation_global_16');
  });

  it('enforces duplicate identities and the bounded per-project count with claimed entries', () => {
    let now = PREPARED_AT_MS;
    const cache = new StudioPreparedPhotoCacheV3({ now: () => now });
    const claims = [];
    for (let index = 0; index < STUDIO_MAX_PREPARED_QUOTE_SESSIONS_PER_PROJECT; index += 1) {
      const suffix = String(index);
      const reservationId = `reservation_piece_${suffix}`;
      const quoteId = `quote_piece_${suffix}`;
      cache.admit(
        makePieceAdmissionV3({
          reservationId,
          quoteId,
          quoteRevision: index + 1,
          pieceId: `piece_${suffix}`,
          proposedHandle: `piece_${suffix}`,
        })
      );
      claims.push(cache.claim({ reservationId, quoteId, quoteRevision: index + 1 }));
      now += 1;
    }
    expectCacheCode(
      () =>
        cache.admit(
          makePieceAdmissionV3({
            reservationId: 'reservation_full',
            quoteId: 'quote_full',
            quoteRevision: 20,
            pieceId: 'piece_full',
            proposedHandle: 'piece_full',
          })
        ),
      'quote_cache_full'
    );
    expect(cache.list('project_piece_1')).toHaveLength(STUDIO_MAX_PREPARED_QUOTE_SESSIONS_PER_PROJECT);

    cache.release(claims[0]!);
    cache.admit(
      makePieceAdmissionV3({
        reservationId: 'reservation_new',
        quoteId: 'quote_new',
        quoteRevision: 21,
        pieceId: 'piece_new',
        proposedHandle: 'piece_new',
      })
    );
    expectCacheCode(
      () => cache.claim({ reservationId: 'reservation_piece_0', quoteId: 'quote_piece_0', quoteRevision: 1 }),
      'quote_not_found'
    );
    expect(cache.list('project_piece_1')).toHaveLength(STUDIO_MAX_PREPARED_QUOTE_SESSIONS_PER_PROJECT);

    expect(() =>
      cache.admit(
        makePieceAdmissionV3({
          reservationId: 'reservation_new',
          quoteId: 'quote_new_2',
          quoteRevision: 22,
          pieceId: 'piece_collision',
          proposedHandle: 'piece_collision',
        })
      )
    ).toThrow('invalid_prepared_submission_session:photo_reservation_collision');
  });
});
