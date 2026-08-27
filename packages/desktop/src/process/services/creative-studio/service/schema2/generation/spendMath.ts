/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  STUDIO_MAX_SHOT_SECONDS,
  STUDIO_MIN_SHOT_SECONDS,
  type StudioGenerationRequestPlan,
  type StudioQuotedGeneration,
} from '@/common/types/project/creativeStudioTypes';

export type StudioQuotedGenerationAmounts = {
  oneGenerationMinorUnits: number;
  requestedTotalMinorUnits: number;
};

export type StudioQuoteTotals = {
  lowerMinorUnits: number;
  upperMinorUnits: number;
};

type StudioQuotedGenerationForSpend = Pick<
  StudioQuotedGeneration,
  'purpose' | 'generationCount' | 'requestPlan' | 'rateUnit' | 'rateMinorUnits'
>;

const checkedMultiply = (left: number, right: number): number | null => {
  if (!Number.isSafeInteger(left) || !Number.isSafeInteger(right)) return null;
  const result = left * right;
  return Number.isSafeInteger(result) ? result : null;
};

const checkedAdd = (left: number, right: number): number | null => {
  if (!Number.isSafeInteger(left) || !Number.isSafeInteger(right)) return null;
  const result = left + right;
  return Number.isSafeInteger(result) ? result : null;
};

const requestDuration = (plan: StudioGenerationRequestPlan): number =>
  plan.kind === 'resolved' ? plan.snapshot.durationSeconds : plan.template.durationSeconds;

/** Recomputes one quote item's lower-line and fully requested amounts with checked integer arithmetic. */
export const calculateStudioQuotedGenerationAmounts = (
  item: StudioQuotedGenerationForSpend
): StudioQuotedGenerationAmounts | null => {
  const generationCountIsValid =
    item.generationCount === 1 || (item.purpose === 'reference_image' && item.generationCount === 2);
  if (!Number.isSafeInteger(item.rateMinorUnits) || item.rateMinorUnits <= 0 || !generationCountIsValid) {
    return null;
  }

  let oneGenerationMinorUnits: number | null;
  if (
    (item.purpose === 'seed_still' || item.purpose === 'board_still' || item.purpose === 'reference_image') &&
    item.rateUnit === 'generation'
  ) {
    oneGenerationMinorUnits = item.rateMinorUnits;
  } else if (item.purpose === 'video_take' && item.rateUnit === 'second') {
    const durationSeconds = requestDuration(item.requestPlan);
    if (
      !Number.isSafeInteger(durationSeconds) ||
      durationSeconds < STUDIO_MIN_SHOT_SECONDS ||
      durationSeconds > STUDIO_MAX_SHOT_SECONDS
    ) {
      return null;
    }
    oneGenerationMinorUnits = checkedMultiply(item.rateMinorUnits, durationSeconds);
  } else {
    return null;
  }
  if (oneGenerationMinorUnits === null) return null;

  const requestedTotalMinorUnits = checkedMultiply(oneGenerationMinorUnits, item.generationCount);
  return requestedTotalMinorUnits === null ? null : { oneGenerationMinorUnits, requestedTotalMinorUnits };
};

/** Recomputes the exact lower/upper quote range over one ordered item set. */
export const calculateStudioQuoteTotals = (
  items: readonly StudioQuotedGenerationForSpend[]
): StudioQuoteTotals | null => {
  let lowerMinorUnits = 0;
  let upperMinorUnits = 0;
  for (const item of items) {
    const amounts = calculateStudioQuotedGenerationAmounts(item);
    if (amounts === null) return null;
    const nextLower = checkedAdd(lowerMinorUnits, amounts.oneGenerationMinorUnits);
    const nextUpper = checkedAdd(upperMinorUnits, amounts.requestedTotalMinorUnits);
    if (nextLower === null || nextUpper === null) return null;
    lowerMinorUnits = nextLower;
    upperMinorUnits = nextUpper;
  }
  return { lowerMinorUnits, upperMinorUnits };
};
