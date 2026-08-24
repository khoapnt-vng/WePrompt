/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash } from 'node:crypto';
import type { StudioJobPurpose } from '@/common/types/project/creativeStudioTypes';

const SAFE_ID = /^[A-Za-z0-9_-]{1,256}$/;
const CURRENCY = /^[A-Z]{3}$/;
const RATE_CARD_DOMAIN = 'creative-studio/rate-card/v1';
const ENTRY_KEYS = new Set(['routeId', 'kind', 'currency', 'rateUnit', 'rateMinorUnits']);

export type StudioRateCardEntryV2 =
  | {
      routeId: string;
      kind: 'image';
      currency: string;
      rateUnit: 'generation';
      rateMinorUnits: number;
    }
  | {
      routeId: string;
      kind: 'video';
      currency: string;
      rateUnit: 'second';
      rateMinorUnits: number;
    };

export type StudioRateCardV2 = {
  digest: string;
  entries: readonly StudioRateCardEntryV2[];
};

export type StudioRateCardErrorCodeV2 = 'invalid_rate_card' | 'rate_not_found' | 'route_kind_mismatch';

export class StudioRateCardErrorV2 extends Error {
  readonly code: StudioRateCardErrorCodeV2;

  constructor(code: StudioRateCardErrorCodeV2) {
    super(code);
    this.name = 'StudioRateCardErrorV2';
    this.code = code;
  }
}

const invalidRateCard = (): never => {
  throw new StudioRateCardErrorV2('invalid_rate_card');
};

const rateKindForPurpose = (purpose: StudioJobPurpose): StudioRateCardEntryV2['kind'] => {
  switch (purpose) {
    case 'seed_still':
    case 'board_still':
      return 'image';
    case 'video_take':
      return 'video';
    default: {
      const exhaustivePurpose: never = purpose;
      void exhaustivePurpose;
      return invalidRateCard();
    }
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const hasExactKeys = (value: Record<string, unknown>, keys: ReadonlySet<string>): boolean => {
  const ownKeys = Reflect.ownKeys(value);
  return ownKeys.length === keys.size && ownKeys.every((key) => typeof key === 'string' && keys.has(key));
};

const isDenseArray = (value: unknown): value is unknown[] => {
  if (!Array.isArray(value)) return false;
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) return false;
  }
  return Reflect.ownKeys(value).every(
    (key) =>
      key === 'length' || (typeof key === 'string' && /^(0|[1-9][0-9]*)$/.test(key) && Number(key) < value.length)
  );
};

const parseEntry = (value: unknown): StudioRateCardEntryV2 => {
  if (!isRecord(value) || !hasExactKeys(value, ENTRY_KEYS)) return invalidRateCard();
  const { routeId, kind, currency, rateUnit, rateMinorUnits } = value;
  if (
    typeof routeId !== 'string' ||
    !SAFE_ID.test(routeId) ||
    typeof currency !== 'string' ||
    !CURRENCY.test(currency) ||
    typeof rateMinorUnits !== 'number' ||
    !Number.isSafeInteger(rateMinorUnits) ||
    rateMinorUnits <= 0
  ) {
    return invalidRateCard();
  }
  if (kind === 'image' && rateUnit === 'generation') {
    return Object.freeze({ routeId, kind, currency, rateUnit, rateMinorUnits });
  }
  if (kind === 'video' && rateUnit === 'second') {
    return Object.freeze({ routeId, kind, currency, rateUnit, rateMinorUnits });
  }
  return invalidRateCard();
};

const compareEntries = (left: StudioRateCardEntryV2, right: StudioRateCardEntryV2): number =>
  left.routeId < right.routeId ? -1 : left.routeId > right.routeId ? 1 : 0;

/** Parses a main-only rate-card config and freezes its canonical, route-sorted representation. */
export const createStudioRateCardV2 = (input: unknown): StudioRateCardV2 => {
  if (!isDenseArray(input)) return invalidRateCard();
  const entries = input.map(parseEntry).sort(compareEntries);
  for (let index = 1; index < entries.length; index += 1) {
    if (entries[index - 1]!.routeId === entries[index]!.routeId) return invalidRateCard();
  }
  const serialized = JSON.stringify(entries);
  const digest = createHash('sha256').update(`${RATE_CARD_DOMAIN}\0${serialized}`, 'utf8').digest('hex');
  return Object.freeze({ digest, entries: Object.freeze(entries) });
};

/** Resolves one purpose-compatible rate without consulting a provider. */
export const getStudioRateCardEntryV2 = (
  card: StudioRateCardV2,
  routeId: string,
  purpose: StudioJobPurpose
): StudioRateCardEntryV2 => {
  if (!SAFE_ID.test(routeId)) invalidRateCard();
  const expectedKind = rateKindForPurpose(purpose);
  const entry = card.entries.find((candidate) => candidate.routeId === routeId);
  if (entry === undefined) throw new StudioRateCardErrorV2('rate_not_found');
  if (entry.kind !== expectedKind) throw new StudioRateCardErrorV2('route_kind_mismatch');
  return entry;
};
