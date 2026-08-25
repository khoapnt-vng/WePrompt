/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest';
import {
  STUDIO_MAX_PREPARED_QUOTE_CACHE_BYTES_GLOBAL,
  STUDIO_MAX_PREPARED_QUOTE_CACHE_BYTES_PER_PROJECT,
  STUDIO_MAX_PREPARED_QUOTE_SESSION_BYTES,
  STUDIO_MAX_PREPARED_QUOTE_SESSIONS_GLOBAL,
  STUDIO_MAX_PREPARED_QUOTE_SESSIONS_PER_PROJECT,
  STUDIO_PREPARED_QUOTE_TTL_SECONDS,
  type StudioPreparedSubmissionOptionsV2,
  type StudioPrepareSubmissionRequestV2,
  type StudioSpendAuthorization,
  type StudioSubmissionQuote,
} from '@/common/types/project/creativeStudioTypes';
import {
  composeStudioGenerationV2,
  deriveStudioInstructionProfileV2,
} from '@/process/services/creative-studio/service/schema2/generation/composition';
import {
  StudioPreparedSubmissionCacheV2,
  type StudioPreparedSubmissionCacheAdmissionV2,
  type StudioPreparedSubmissionClaimV2,
} from '@/process/services/creative-studio/service/schema2/pricing/preparedSubmissionCache';

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
