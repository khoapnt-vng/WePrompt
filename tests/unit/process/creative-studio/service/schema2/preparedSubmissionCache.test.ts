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
  StudioPreparedSubmissionCacheV2,
  type StudioPreparedSubmissionCacheAdmissionV2,
  type StudioPreparedSubmissionClaimV2,
  type StudioPreparedSubmissionSessionV2,
} from '@/process/services/creative-studio/service/schema2/preparedSubmissionCache';

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

const makeQuote = (projectId: string, quoteId: string, prompt: string): StudioSubmissionQuote => ({
  id: quoteId,
  projectId,
  projectRevision: 7,
  originReferenceHandoffId: null,
  rateCardDigest: RATE_CARD_DIGEST,
  currency: 'USD',
  baseItems: [
    {
      id: `item_${quoteId}`,
      shotId: 'shot_1',
      purpose: 'seed_still',
      routeId: 'route_image',
      generationCount: 1,
      requestPlan: {
        kind: 'resolved',
        snapshot: {
          prompt,
          aspectRatio: '16:9',
          resolution: '1080p',
          durationSeconds: 8,
          referenceInput: null,
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
});

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
          shotId: 'shot_2',
          purpose: 'video_take',
          routeId: 'route_video',
          generationCount: 1,
          requestPlan: {
            kind: 'after_take_selection',
            template: {
              prompt: 'Continue the action',
              aspectRatio: '16:9',
              resolution: '1080p',
              durationSeconds: 8,
              referenceInput: null,
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
    baseChoices: [{ shotId: 'shot_1', purpose: 'seed_still', generationCount: 1, referenceAssetId: null }],
    cascadeChoices:
      withCascade === null
        ? []
        : [{ shotId: 'shot_2', purpose: 'video_take', generationCount: 1, referenceAssetId: null }],
  };
  const quoteForBindings = withCascade ?? baseOnly;
  const providerBindings: StudioSpendAuthorization['providerBindings'] = [
    ...quoteForBindings.baseItems,
    ...quoteForBindings.cascadeItems,
  ].map((item) => ({
    itemId: item.id,
    provider: {
      providerId: 'provider_1',
      adapterId: item.purpose === 'seed_still' ? 'weprompt-image-v1' : 'byteplus-seedance-v1',
      model: item.purpose === 'seed_still' ? 'image-model' : 'video-model',
    },
  }));
  const cancellationPolicies = [...quoteForBindings.baseItems, ...quoteForBindings.cascadeItems].map((item) => ({
    itemId: item.id,
    policy: 'queued_and_running' as const,
  }));
  const prepared: StudioPreparedSubmissionOptionsV2 = { baseOnly, withCascade };
  return { request, options: prepared, providerBindings, cancellationPolicies };
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
  plan.snapshot.prompt = 'x'.repeat(padding);
  expect(serializedSessionBytes(admission)).toBe(byteSize);
  return admission;
};

const expectCacheCode = (operation: () => unknown, code: string): void => {
  expect(operation).toThrow(expect.objectContaining({ code }));
};

describe('StudioPreparedSubmissionCacheV2', () => {
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
    plan.snapshot.prompt = `${plan.snapshot.prompt}é`;
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
    const missingCascade = makeAdmission();
    missingCascade.request.cascadeChoices.push({
      shotId: 'shot_2',
      purpose: 'video_take',
      generationCount: 1,
      referenceAssetId: null,
    });
    cases.push(missingCascade);
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
