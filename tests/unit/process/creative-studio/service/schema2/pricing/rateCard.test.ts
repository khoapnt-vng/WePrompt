/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  createStudioRateCardV2,
  getStudioRateCardEntryV2,
} from '@/process/services/creative-studio/service/schema2/pricing';

const imageRate = {
  routeId: 'choice_image',
  kind: 'image',
  currency: 'USD',
  rateUnit: 'generation',
  rateMinorUnits: 25,
} as const;

const videoRate = {
  routeId: 'choice_video',
  kind: 'video',
  currency: 'USD',
  rateUnit: 'second',
  rateMinorUnits: 7,
} as const;

describe('schema-2 Studio rate card', () => {
  it('canonicalizes route order and produces a stable digest', () => {
    const card = createStudioRateCardV2([videoRate, imageRate]);

    expect(card.entries).toEqual([imageRate, videoRate]);
    expect(card.digest).toBe('b3e12f729bfbcf0a0117b2aaddb0966b57a032f409b8f59c91c31f530920782b');
    expect(createStudioRateCardV2([imageRate, videoRate])).toEqual(card);
  });

  it('resolves purpose-compatible image and video rates', () => {
    const card = createStudioRateCardV2([imageRate, videoRate]);

    expect(getStudioRateCardEntryV2(card, imageRate.routeId, 'seed_still')).toEqual(imageRate);
    expect(getStudioRateCardEntryV2(card, videoRate.routeId, 'video_take')).toEqual(videoRate);
  });

  it.each([
    [[{ ...imageRate, extra: true }]],
    [[{ ...imageRate, routeId: 'unsafe route' }]],
    [[{ ...imageRate, currency: 'usd' }]],
    [[{ ...imageRate, rateMinorUnits: 0 }]],
    [[{ ...imageRate, rateMinorUnits: Number.MAX_SAFE_INTEGER + 1 }]],
    [[{ ...imageRate, rateUnit: 'second' }]],
    [[imageRate, imageRate]],
  ])('rejects malformed or ambiguous rate-card input %#', (input) => {
    expect(() => createStudioRateCardV2(input)).toThrow(expect.objectContaining({ code: 'invalid_rate_card' }));
  });

  it('rejects sparse input without throwing from traversal', () => {
    const sparse = Array(1) as unknown[];

    expect(() => createStudioRateCardV2(sparse)).toThrow(expect.objectContaining({ code: 'invalid_rate_card' }));
  });

  it('distinguishes missing rates from route-kind mismatches', () => {
    const card = createStudioRateCardV2([imageRate, videoRate]);

    expect(() => getStudioRateCardEntryV2(card, 'choice_missing', 'seed_still')).toThrow(
      expect.objectContaining({ code: 'rate_not_found' })
    );
    expect(() => getStudioRateCardEntryV2(card, imageRate.routeId, 'video_take')).toThrow(
      expect.objectContaining({ code: 'route_kind_mismatch' })
    );
  });

  it('returns immutable entries so config mutation cannot alter pricing', () => {
    const input = [{ ...imageRate }];
    const card = createStudioRateCardV2(input);
    input[0]!.rateMinorUnits = 999;

    expect(card.entries[0]).toEqual(imageRate);
    expect(Object.isFrozen(card.entries)).toBe(true);
    expect(Object.isFrozen(card.entries[0])).toBe(true);
  });
});
