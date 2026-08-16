/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment node
 */

import { fitStoryboardDurations } from '@process/services/creative-studio/planning';
import { describe, expect, it, vi } from 'vitest';

type Item = Parameters<typeof fitStoryboardDurations>[0][number];

const REVIEW_REPRODUCTION_TARGET_SECONDS = 7_611_773_375_400_180;

const item = (
  sceneId: string,
  currentDurationSeconds: number,
  minDurationSeconds = 1,
  maxDurationSeconds = 60
): Item => ({ sceneId, currentDurationSeconds, minDurationSeconds, maxDurationSeconds });

describe('fitStoryboardDurations', () => {
  it('fits the canonical 18-second storyboard to 15 seconds deterministically', () => {
    const result = fitStoryboardDurations(
      [item('scene-1', 3), item('scene-2', 5), item('scene-3', 5), item('scene-4', 5)],
      15
    );

    expect(result).toEqual({
      status: 'fitted',
      allocations: [
        { sceneId: 'scene-1', durationSeconds: 3 },
        { sceneId: 'scene-2', durationSeconds: 4 },
        { sceneId: 'scene-3', durationSeconds: 4 },
        { sceneId: 'scene-4', durationSeconds: 4 },
      ],
    });
  });

  it('honors independent bounds while redistributing after maximum saturation', () => {
    const result = fitStoryboardDurations(
      [item('short', 10, 1, 2), item('medium', 5, 3, 6), item('long', 5, 4, 12)],
      15
    );

    expect(result).toEqual({
      status: 'fitted',
      allocations: [
        { sceneId: 'short', durationSeconds: 2 },
        { sceneId: 'medium', durationSeconds: 6 },
        { sceneId: 'long', durationSeconds: 7 },
      ],
    });
  });

  it('starts at scene minimums and redistributes only remaining capacity', () => {
    const result = fitStoryboardDurations(
      [item('minimum-heavy', 1, 7, 9), item('weighted', 10, 1, 20), item('capped', 20, 1, 3)],
      18
    );

    expect(result).toEqual({
      status: 'fitted',
      allocations: [
        { sceneId: 'minimum-heavy', durationSeconds: 8 },
        { sceneId: 'weighted', durationSeconds: 7 },
        { sceneId: 'capped', durationSeconds: 3 },
      ],
    });
  });

  it.each([
    [5, 6, 15],
    [16, 6, 15],
  ])('rejects target %s outside the full bounds', (targetSeconds, minimumSeconds, maximumSeconds) => {
    expect(fitStoryboardDurations([item('scene-1', 5, 2, 5), item('scene-2', 7, 4, 10)], targetSeconds)).toEqual({
      status: 'unreachable',
      minimumSeconds,
      maximumSeconds,
    });
  });

  it('uses storyboard order to break equal fractional remainders', () => {
    const result = fitStoryboardDurations([item('first', 1, 1, 5), item('second', 1, 1, 5), item('third', 1, 1, 5)], 5);

    expect(result).toEqual({
      status: 'fitted',
      allocations: [
        { sceneId: 'first', durationSeconds: 2 },
        { sceneId: 'second', durationSeconds: 2 },
        { sceneId: 'third', durationSeconds: 1 },
      ],
    });
  });

  it.each([
    [6, [2, 2, 2]],
    [9, [2, 3, 4]],
    [15, [3, 5, 7]],
  ])('returns an exact bounded allocation for target %s', (targetSeconds, expected) => {
    const result = fitStoryboardDurations(
      [item('scene-1', 2, 2, 3), item('scene-2', 4, 2, 5), item('scene-3', 8, 2, 8)],
      targetSeconds
    );

    expect(result).toEqual({
      status: 'fitted',
      allocations: expected.map((durationSeconds, index) => ({
        sceneId: `scene-${index + 1}`,
        durationSeconds,
      })),
    });
  });

  it('normalizes an already-on-target input that violates a minimum bound', () => {
    const result = fitStoryboardDurations([item('invalid', 1, 3, 5), item('valid', 7, 1, 10)], 8);

    expect(result).toEqual({
      status: 'fitted',
      allocations: [
        { sceneId: 'invalid', durationSeconds: 4 },
        { sceneId: 'valid', durationSeconds: 4 },
      ],
    });
  });

  it.each([
    ['NaN target', [item('scene-1', 5, 1, 10)], Number.NaN],
    ['positive infinite target', [item('scene-1', 5, 1, 10)], Number.POSITIVE_INFINITY],
    ['negative infinite target', [item('scene-1', 5, 1, 10)], Number.NEGATIVE_INFINITY],
    ['fractional target', [item('scene-1', 5, 1, 10)], 5.5],
    ['unsafe target', [item('scene-1', 5, 1, 10)], Number.MAX_SAFE_INTEGER + 1],
    ['negative target', [item('scene-1', 5, 1, 10)], -1],
    ['NaN current duration', [item('scene-1', Number.NaN, 1, 10)], 5],
    ['positive infinite current duration', [item('scene-1', Number.POSITIVE_INFINITY, 1, 10)], 5],
    ['negative infinite current duration', [item('scene-1', Number.NEGATIVE_INFINITY, 1, 10)], 5],
    ['fractional current duration', [item('scene-1', 5.5, 1, 10)], 5],
    ['unsafe current duration', [item('scene-1', Number.MAX_SAFE_INTEGER + 1, 1, 10)], 5],
    ['negative current duration', [item('scene-1', -1, 1, 10)], 5],
    ['NaN minimum', [item('scene-1', 5, Number.NaN, 10)], 5],
    ['infinite maximum', [item('scene-1', 5, 1, Number.POSITIVE_INFINITY)], 5],
    ['fractional minimum', [item('scene-1', 5, 1.5, 10)], 5],
    ['fractional maximum', [item('scene-1', 5, 1, 10.5)], 5],
    ['unsafe minimum', [item('scene-1', 5, Number.MAX_SAFE_INTEGER + 1, Number.MAX_SAFE_INTEGER + 1)], 5],
    ['unsafe maximum', [item('scene-1', 5, 1, Number.MAX_SAFE_INTEGER + 1)], 5],
    ['negative minimum', [item('scene-1', 5, -1, 10)], 5],
    ['negative maximum', [item('scene-1', 5, 0, -1)], 0],
    ['reversed bounds', [item('scene-1', 5, 10, 1)], 5],
  ])('rejects %s before allocation', (_case, items, targetSeconds) => {
    expect(() => fitStoryboardDurations(items, targetSeconds)).toThrow();
  });

  it.each([
    ['targetSeconds', () => fitStoryboardDurations([item('scene-1', 5, 0, 60)], 61)],
    ['currentDurationSeconds', () => fitStoryboardDurations([item('scene-1', 61, 0, 60)], 5)],
    ['minDurationSeconds', () => fitStoryboardDurations([item('scene-1', 5, 61, 60)], 5)],
    ['maxDurationSeconds', () => fitStoryboardDurations([item('scene-1', 5, 0, 61)], 5)],
  ])('rejects %s above the 60-second Creative Studio limit', (label, allocate) => {
    expect(allocate).toThrowError(new RangeError(`${label} must be an integer from 0 to 60`));
  });

  it.each([
    [
      'currentDurationSeconds',
      () => fitStoryboardDurations([item('scene-1', REVIEW_REPRODUCTION_TARGET_SECONDS, 0, 60)], 5),
    ],
    [
      'minDurationSeconds',
      () => fitStoryboardDurations([item('scene-1', 5, REVIEW_REPRODUCTION_TARGET_SECONDS, 60)], 5),
    ],
    [
      'maxDurationSeconds',
      () => fitStoryboardDurations([item('scene-1', 5, 0, REVIEW_REPRODUCTION_TARGET_SECONDS)], 5),
    ],
  ])('rejects reproduction-scale safe-integer %s before allocation', (label, allocate) => {
    expect(allocate).toThrowError(new RangeError(`${label} must be an integer from 0 to 60`));
  });

  it('rejects the reviewer huge-safe target at the supported-domain boundary', () => {
    expect(() =>
      fitStoryboardDurations(
        [
          item('first', REVIEW_REPRODUCTION_TARGET_SECONDS, 0, REVIEW_REPRODUCTION_TARGET_SECONDS),
          item('second', 1, 0, REVIEW_REPRODUCTION_TARGET_SECONDS),
        ],
        REVIEW_REPRODUCTION_TARGET_SECONDS
      )
    ).toThrowError(new RangeError('targetSeconds must be an integer from 0 to 60'));
  });

  it('rejects storyboards with more than 24 items before allocation', () => {
    const items = Array.from({ length: 25 }, (_, index) => item(`scene-${index + 1}`, 1, 0, 60));

    expect(() => fitStoryboardDurations(items, 25)).toThrowError(
      new RangeError('items must contain at most 24 scenes')
    );
  });

  it('reads the storyboard item boundary from the shared scene authority', async () => {
    vi.resetModules();
    vi.doMock('@/common/types/project/creativeStudioTypes', async (importOriginal) => ({
      ...(await importOriginal<Record<string, unknown>>()),
      STUDIO_MAX_SCENES: 2,
    }));
    try {
      const { fitStoryboardDurations: fitWithAuthority } =
        await import('@process/services/creative-studio/planning/fitStoryboardDurations');

      expect(() =>
        fitWithAuthority([item('scene-1', 1, 0, 60), item('scene-2', 1, 0, 60), item('scene-3', 1, 0, 60)], 3)
      ).toThrowError(new RangeError('items must contain at most 2 scenes'));
    } finally {
      vi.doUnmock('@/common/types/project/creativeStudioTypes');
      vi.resetModules();
    }
  });

  it.each([
    [6, [item('first', 0, 2, 5), item('second', 60, 1, 4)]],
    [13, [item('first', 50, 0, 3), item('second', 1, 4, 10), item('third', 7, 2, 8)]],
    [24, [item('first', 4, 4, 4), item('second', 12, 5, 15), item('third', 2, 1, 20)]],
  ])('keeps every fitted allocation integral, bounded, and exact for target %s', (targetSeconds, items) => {
    const result = fitStoryboardDurations(items, targetSeconds);

    expect(result.status).toBe('fitted');
    if (result.status !== 'fitted') return;
    expect(result.allocations.reduce((total, allocation) => total + allocation.durationSeconds, 0)).toBe(targetSeconds);
    for (const [index, allocation] of result.allocations.entries()) {
      expect(Number.isInteger(allocation.durationSeconds)).toBe(true);
      expect(allocation.durationSeconds).toBeGreaterThanOrEqual(items[index]!.minDurationSeconds);
      expect(allocation.durationSeconds).toBeLessThanOrEqual(items[index]!.maxDurationSeconds);
    }
  });
});
