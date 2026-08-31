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
    referenceInputs: [],
    conditioningInput: { kind: 'seed_still', assetId: 'seed_1' },
  },
});

const makeItem = (overrides: Partial<StudioQuotedGeneration> = {}): StudioQuotedGeneration => ({
  id: 'item_1',
  shotId: 'shot_1',
  purpose: 'video_take',
  routeId: 'route_1',
  generationCount: 1,
  requestPlan: resolvedPlan(),
  rateUnit: 'second',
  rateMinorUnits: 25,
  ...overrides,
});

describe('calculateStudioQuotedGenerationAmounts', () => {
  it('prices one seed generation', () => {
    expect(
      calculateStudioQuotedGenerationAmounts(
        makeItem({
          purpose: 'seed_still',
          rateUnit: 'generation',
          rateMinorUnits: 125,
        })
      )
    ).toEqual({ oneGenerationMinorUnits: 125, requestedTotalMinorUnits: 125 });
  });

  it('prices one Board panel as an image generation rather than video time', () => {
    expect(
      calculateStudioQuotedGenerationAmounts(
        makeItem({
          purpose: 'board_still',
          requestPlan: {
            kind: 'resolved',
            snapshot: {
              prompt: 'A Board panel',
              aspectRatio: '16:9',
              resolution: '1080p',
              durationSeconds: 4,
              referenceInputs: [],
              conditioningInput: null,
            },
          },
          rateUnit: 'generation',
          rateMinorUnits: 3,
        })
      )
    ).toEqual({ oneGenerationMinorUnits: 3, requestedTotalMinorUnits: 3 });
  });

  it('prices one video generation from the frozen request duration', () => {
    expect(calculateStudioQuotedGenerationAmounts(makeItem())).toEqual({
      oneGenerationMinorUnits: 200,
      requestedTotalMinorUnits: 200,
    });
  });

  it('prices one required reference attempt plus one bounded variation-grid contingency', () => {
    expect(
      calculateStudioQuotedGenerationAmounts(
        makeItem({
          target: { kind: 'reference', referenceId: 'reference_1' },
          purpose: 'reference_image',
          generationCount: 2,
          requestPlan: {
            kind: 'resolved',
            snapshot: {
              prompt: 'One candid portrait.',
              aspectRatio: '16:9',
              resolution: '1080p',
              durationSeconds: 5,
              referenceInputs: [],
              conditioningInput: null,
            },
          },
          rateUnit: 'generation',
          rateMinorUnits: 25,
        })
      )
    ).toEqual({ oneGenerationMinorUnits: 25, requestedTotalMinorUnits: 50 });
    expect(
      calculateStudioQuotedGenerationAmounts(
        makeItem({ purpose: 'seed_still', generationCount: 2, rateUnit: 'generation' })
      )
    ).toBeNull();
  });

  it.each([
    makeItem({ purpose: 'seed_still', rateUnit: 'second' }),
    makeItem({ purpose: 'board_still', rateUnit: 'second' }),
    makeItem({ purpose: 'video_take', rateUnit: 'generation' }),
    makeItem({ generationCount: 0 }),
    makeItem({ generationCount: 2 }),
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
          rateUnit: 'generation',
          rateMinorUnits: 75,
        }),
      ])
    ).toEqual({ lowerMinorUnits: 275, upperMinorUnits: 275 });
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
