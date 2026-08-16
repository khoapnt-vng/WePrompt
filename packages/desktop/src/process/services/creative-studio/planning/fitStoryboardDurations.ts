/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { STUDIO_MAX_SCENES } from '@/common/types/project/creativeStudioTypes';

export type FitStoryboardDurationItem = {
  sceneId: string;
  currentDurationSeconds: number;
  minDurationSeconds: number;
  maxDurationSeconds: number;
};

export type FitStoryboardDurationsResult =
  | {
      status: 'fitted';
      allocations: Array<{ sceneId: string; durationSeconds: number }>;
    }
  | {
      status: 'unreachable';
      minimumSeconds: number;
      maximumSeconds: number;
    };

type WorkingAllocation = FitStoryboardDurationItem & {
  index: number;
  durationSeconds: number;
};

const MAX_DURATION_SECONDS = 60;

const assertSafeNonnegativeInteger = (value: number, label: string): void => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a safe nonnegative integer`);
  }
};

const assertDurationSeconds = (value: number, label: string): void => {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_DURATION_SECONDS) {
    throw new RangeError(`${label} must be an integer from 0 to ${MAX_DURATION_SECONDS}`);
  }
};

/** Allocates a 0-60 second integer target across the admitted number of independently bounded scenes. */
export function fitStoryboardDurations(
  items: readonly FitStoryboardDurationItem[],
  targetSeconds: number
): FitStoryboardDurationsResult {
  if (items.length > STUDIO_MAX_SCENES) {
    throw new RangeError(`items must contain at most ${STUDIO_MAX_SCENES} scenes`);
  }
  assertDurationSeconds(targetSeconds, 'targetSeconds');
  let minimumSeconds = 0;
  let maximumSeconds = 0;
  let totalCurrentSeconds = 0;
  for (const item of items) {
    assertDurationSeconds(item.currentDurationSeconds, 'currentDurationSeconds');
    assertDurationSeconds(item.minDurationSeconds, 'minDurationSeconds');
    assertDurationSeconds(item.maxDurationSeconds, 'maxDurationSeconds');
    if (item.minDurationSeconds > item.maxDurationSeconds) {
      throw new RangeError('minDurationSeconds must not exceed maxDurationSeconds');
    }
    minimumSeconds += item.minDurationSeconds;
    maximumSeconds += item.maxDurationSeconds;
    totalCurrentSeconds += item.currentDurationSeconds;
    assertSafeNonnegativeInteger(minimumSeconds, 'combined minimum duration');
    assertSafeNonnegativeInteger(maximumSeconds, 'combined maximum duration');
    assertSafeNonnegativeInteger(totalCurrentSeconds, 'combined current duration');
  }
  if (targetSeconds < minimumSeconds || targetSeconds > maximumSeconds) {
    return { status: 'unreachable', minimumSeconds, maximumSeconds };
  }

  const allocations: WorkingAllocation[] = items.map((item, index) => ({
    ...item,
    index,
    durationSeconds: item.minDurationSeconds,
  }));
  let remainingSeconds = targetSeconds - minimumSeconds;
  let eligible = allocations.filter((item) => item.durationSeconds < item.maxDurationSeconds);

  while (remainingSeconds > 0 && eligible.length > 0) {
    const totalWeight = eligible.reduce((total, item) => total + Math.max(0, item.currentDurationSeconds), 0);
    const equalWeight = totalWeight === 0;
    const saturated = eligible.filter((item) => {
      const weight = equalWeight ? 1 : Math.max(0, item.currentDurationSeconds);
      const denominator = equalWeight ? eligible.length : totalWeight;
      const share = (remainingSeconds * weight) / denominator;
      return share >= item.maxDurationSeconds - item.durationSeconds;
    });

    if (saturated.length === 0) {
      for (const item of eligible) {
        const weight = equalWeight ? 1 : Math.max(0, item.currentDurationSeconds);
        const denominator = equalWeight ? eligible.length : totalWeight;
        item.durationSeconds += (remainingSeconds * weight) / denominator;
      }
      remainingSeconds = 0;
      break;
    }

    for (const item of saturated) {
      const capacity = item.maxDurationSeconds - item.durationSeconds;
      item.durationSeconds = item.maxDurationSeconds;
      remainingSeconds -= capacity;
    }
    eligible = eligible.filter((item) => !saturated.includes(item));
  }

  const floored = allocations.map((item) => ({
    ...item,
    fractionalRemainder: item.durationSeconds - Math.floor(item.durationSeconds),
    durationSeconds: Math.floor(item.durationSeconds),
  }));
  let leftoverSeconds = targetSeconds - floored.reduce((total, item) => total + item.durationSeconds, 0);
  const remainderOrder = [...floored].toSorted(
    (left, right) => right.fractionalRemainder - left.fractionalRemainder || left.index - right.index
  );
  while (leftoverSeconds > 0) {
    let allocated = false;
    for (const item of remainderOrder) {
      if (leftoverSeconds === 0) break;
      if (item.durationSeconds < item.maxDurationSeconds) {
        item.durationSeconds += 1;
        leftoverSeconds -= 1;
        allocated = true;
      }
    }
    if (!allocated) throw new RangeError('Target cannot be allocated within the supplied bounds');
  }

  const exactTotal = floored.reduce((total, item) => total + item.durationSeconds, 0);
  if (
    exactTotal !== targetSeconds ||
    floored.some(
      (item) =>
        !Number.isSafeInteger(item.durationSeconds) ||
        item.durationSeconds < item.minDurationSeconds ||
        item.durationSeconds > item.maxDurationSeconds
    )
  ) {
    throw new RangeError('Allocation did not produce an exact bounded integer result');
  }

  return {
    status: 'fitted',
    allocations: floored.map(({ sceneId, durationSeconds }) => ({ sceneId, durationSeconds })),
  };
}
