/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest';
import type { StudioGenerationRequestPlan, StudioQuotedGeneration } from '@/common/types/project/creativeStudioTypes';
import {
  calculateStudioQuotedGenerationAmounts,
  calculateStudioQuoteTotals,
} from '@/process/services/creative-studio/service/schema2/generation/spendMath';

const resolvedPlan = (durationSeconds = 8): StudioGenerationRequestPlan => ({
  kind: 'resolved',
  snapshot: {
    prompt: 'A launch film',
    aspectRatio: '16:9',
    resolution: '1080p',
    durationSeconds,
    referenceInput: null,
    conditioningInput: { kind: 'seed_still', assetId: 'seed_1' },
  },
});

const makeItem = (overrides: Partial<StudioQuotedGeneration> = {}): StudioQuotedGeneration => ({
  id: 'item_1',
  shotId: 'shot_1',
  purpose: 'video_take',
  routeId: 'route_1',
  generationCount: 3,
  requestPlan: resolvedPlan(),
  rateUnit: 'second',
  rateMinorUnits: 25,
  ...overrides,
});

describe('calculateStudioQuotedGenerationAmounts', () => {
  it('prices seed generations once per generated image', () => {
    expect(
      calculateStudioQuotedGenerationAmounts(
        makeItem({
          purpose: 'seed_still',
          generationCount: 4,
          rateUnit: 'generation',
          rateMinorUnits: 125,
        })
      )
    ).toEqual({ oneGenerationMinorUnits: 125, requestedTotalMinorUnits: 500 });
  });

  it('prices each video generation from the frozen request duration', () => {
    expect(calculateStudioQuotedGenerationAmounts(makeItem())).toEqual({
      oneGenerationMinorUnits: 200,
      requestedTotalMinorUnits: 600,
    });
  });

  it.each([
    makeItem({ purpose: 'seed_still', rateUnit: 'second' }),
    makeItem({ purpose: 'video_take', rateUnit: 'generation' }),
    makeItem({ generationCount: 0 }),
    makeItem({ generationCount: 5 }),
    makeItem({ rateMinorUnits: Number.MAX_SAFE_INTEGER }),
    makeItem({ requestPlan: resolvedPlan(16) }),
  ])('rejects a mismatched or unsafe item %#', (item) => {
    expect(calculateStudioQuotedGenerationAmounts(item)).toBeNull();
  });
});

describe('calculateStudioQuoteTotals', () => {
  it('sums every item from the same checked per-generation amounts', () => {
    expect(
      calculateStudioQuoteTotals([
        makeItem(),
        makeItem({
          id: 'item_2',
          shotId: 'shot_2',
          purpose: 'seed_still',
          generationCount: 2,
          rateUnit: 'generation',
          rateMinorUnits: 75,
        }),
      ])
    ).toEqual({ lowerMinorUnits: 275, upperMinorUnits: 750 });
  });

  it('returns exact zero totals for an empty mathematical input', () => {
    expect(calculateStudioQuoteTotals([])).toEqual({ lowerMinorUnits: 0, upperMinorUnits: 0 });
  });

  it('refuses an unsafe aggregate instead of rounding it', () => {
    const safePerItem = makeItem({
      purpose: 'seed_still',
      generationCount: 1,
      rateUnit: 'generation',
      rateMinorUnits: Number.MAX_SAFE_INTEGER,
    });

    expect(calculateStudioQuoteTotals([safePerItem, safePerItem])).toBeNull();
  });
});
