/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  STUDIO_MAX_GENERATION_ITEMS_PER_REQUEST,
  STUDIO_MAX_GENERATIONS_PER_SHOT_PER_SUBMISSION,
  type StudioJobV2,
  type StudioProviderRef,
  type StudioQuotedGeneration,
  type StudioSpendAuthorization,
  type StudioSpendReceipt,
  type StudioSubmissionQuote,
} from '@/common/types/project/creativeStudioTypes';
import {
  calculateStudioQuoteTotals,
  calculateStudioQuotedGenerationAmounts,
  createStudioQuotedGenerationId,
} from '../generation';

const SAFE_ID = /^[A-Za-z0-9_-]{1,256}$/;
const LOWERCASE_SHA256 = /^[a-f0-9]{64}$/;
const ADAPTER_IDS = new Set([
  'weprompt-image-v1',
  'byteplus-seedance-v1',
  'weprompt-media-gateway-v1',
  'openrouter-video-v1',
]);

export type StudioAuthorizationErrorCodeV2 =
  | 'invalid_authorization'
  | 'expired_quote'
  | 'invalid_provider_binding'
  | 'invalid_idempotency'
  | 'invalid_receipt';

export class StudioAuthorizationErrorV2 extends Error {
  readonly code: StudioAuthorizationErrorCodeV2;

  constructor(code: StudioAuthorizationErrorCodeV2) {
    super(code);
    this.name = 'StudioAuthorizationErrorV2';
    this.code = code;
  }
}

export type StudioSpendAuthorizationInputV2 = {
  quote: StudioSubmissionQuote;
  confirmedAt: string;
  providerBindings: StudioSpendAuthorization['providerBindings'];
  idempotencyKeys: StudioSpendAuthorization['idempotencyKeys'];
};

export type StudioSpendReceiptJobLinkV2 = Pick<
  StudioJobV2,
  'id' | 'authorizationId' | 'authorizationItemId' | 'generationIndex' | 'idempotencyKey' | 'purpose'
>;

const fail = (code: StudioAuthorizationErrorCodeV2): never => {
  throw new StudioAuthorizationErrorV2(code);
};

const canonicalTimestamp = (value: string): boolean => {
  if (typeof value !== 'string' || value.length !== 24) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
};

const dense = (value: unknown): value is unknown[] => {
  if (!Array.isArray(value)) return false;
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) return false;
  }
  return true;
};

const safeModel = (value: string): boolean => {
  if (typeof value !== 'string' || value.length === 0 || value.length > 256 || value !== value.trim()) return false;
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return false;
  }
  return true;
};

const validProvider = (value: StudioProviderRef): boolean =>
  value !== null &&
  typeof value === 'object' &&
  Reflect.ownKeys(value).length === 3 &&
  SAFE_ID.test(value.providerId) &&
  ADAPTER_IDS.has(value.adapterId) &&
  safeModel(value.model);

const combinedItems = (quote: StudioSubmissionQuote): StudioQuotedGeneration[] => [
  ...quote.baseItems,
  ...quote.cascadeItems,
];

const validateQuote = (quote: StudioSubmissionQuote): StudioQuotedGeneration[] => {
  if (
    !SAFE_ID.test(quote.id) ||
    !SAFE_ID.test(quote.projectId) ||
    !Number.isSafeInteger(quote.projectRevision) ||
    quote.projectRevision < 1 ||
    (quote.originReferenceHandoffId !== null && !SAFE_ID.test(quote.originReferenceHandoffId)) ||
    !LOWERCASE_SHA256.test(quote.rateCardDigest) ||
    !/^[A-Z]{3}$/.test(quote.currency) ||
    !canonicalTimestamp(quote.expiresAt) ||
    !dense(quote.baseItems) ||
    !dense(quote.cascadeItems) ||
    quote.baseItems.length === 0
  ) {
    return fail('invalid_authorization');
  }
  const items = combinedItems(quote);
  if (items.length > STUDIO_MAX_GENERATION_ITEMS_PER_REQUEST) fail('invalid_authorization');
  const itemIds = new Set<string>();
  const pairs = new Set<string>();
  for (const item of items) {
    if (
      !SAFE_ID.test(item.id) ||
      item.id !==
        createStudioQuotedGenerationId({
          projectId: quote.projectId,
          projectRevision: quote.projectRevision,
          shotId: item.shotId,
          purpose: item.purpose,
        }) ||
      itemIds.has(item.id) ||
      pairs.has(`${item.shotId}\0${item.purpose}`) ||
      calculateStudioQuotedGenerationAmounts(item) === null
    ) {
      return fail('invalid_authorization');
    }
    itemIds.add(item.id);
    pairs.add(`${item.shotId}\0${item.purpose}`);
  }
  const totals = calculateStudioQuoteTotals(items);
  if (
    totals === null ||
    totals.lowerMinorUnits !== quote.lowerMinorUnits ||
    totals.upperMinorUnits !== quote.upperMinorUnits
  ) {
    return fail('invalid_authorization');
  }
  return items;
};

const cloneProvider = (provider: StudioProviderRef): StudioProviderRef => ({ ...provider });

/** Freezes the exact quote, provider, and idempotency authority before any provider attempt. */
export const createStudioSpendAuthorizationV2 = (input: StudioSpendAuthorizationInputV2): StudioSpendAuthorization => {
  const items = validateQuote(input.quote);
  if (!canonicalTimestamp(input.confirmedAt)) fail('invalid_authorization');
  if (Date.parse(input.confirmedAt) >= Date.parse(input.quote.expiresAt)) fail('expired_quote');
  if (!dense(input.providerBindings) || input.providerBindings.length !== items.length) {
    fail('invalid_provider_binding');
  }
  const providerBindings = input.providerBindings.map((binding, index) => {
    if (
      binding === null ||
      typeof binding !== 'object' ||
      Reflect.ownKeys(binding).length !== 2 ||
      binding.itemId !== items[index]!.id ||
      !validProvider(binding.provider)
    ) {
      return fail('invalid_provider_binding');
    }
    return { itemId: binding.itemId, provider: cloneProvider(binding.provider) };
  });

  const expectedKeyCount = items.reduce((sum, item) => sum + item.generationCount, 0);
  if (!dense(input.idempotencyKeys) || input.idempotencyKeys.length !== expectedKeyCount) {
    fail('invalid_idempotency');
  }
  const seenKeys = new Set<string>();
  const idempotencyKeys: StudioSpendAuthorization['idempotencyKeys'] = [];
  let keyIndex = 0;
  for (const item of items) {
    for (let generationIndex = 0; generationIndex < item.generationCount; generationIndex += 1) {
      const entry = input.idempotencyKeys[keyIndex];
      if (
        entry === undefined ||
        Reflect.ownKeys(entry).length !== 3 ||
        entry.itemId !== item.id ||
        entry.generationIndex !== generationIndex ||
        !SAFE_ID.test(entry.key) ||
        seenKeys.has(entry.key)
      ) {
        return fail('invalid_idempotency');
      }
      seenKeys.add(entry.key);
      idempotencyKeys.push({ ...entry });
      keyIndex += 1;
    }
  }

  const quote = structuredClone(input.quote);
  return {
    ...quote,
    confirmedAt: input.confirmedAt,
    providerBindings,
    idempotencyKeys,
  };
};

const findAuthorizationItem = (
  authorization: StudioSpendAuthorization,
  itemId: string,
  generationIndex: number
): StudioQuotedGeneration => {
  if (!SAFE_ID.test(itemId) || !Number.isSafeInteger(generationIndex) || generationIndex < 0) {
    return fail('invalid_receipt');
  }
  const item = combinedItems(authorization).find((candidate) => candidate.id === itemId);
  if (
    item === undefined ||
    generationIndex >= item.generationCount ||
    generationIndex >= STUDIO_MAX_GENERATIONS_PER_SHOT_PER_SUBMISSION ||
    !authorization.idempotencyKeys.some((entry) => entry.itemId === itemId && entry.generationIndex === generationIndex)
  ) {
    return fail('invalid_receipt');
  }
  return item;
};

/** Derives the immutable per-job receipt from frozen authorization values, never a current rate card. */
export const createStudioSpendReceiptV2 = (input: {
  authorization: StudioSpendAuthorization;
  itemId: string;
  jobId: string;
  generationIndex: number;
}): StudioSpendReceipt => {
  if (!SAFE_ID.test(input.jobId)) fail('invalid_receipt');
  const item = findAuthorizationItem(input.authorization, input.itemId, input.generationIndex);
  const amounts = calculateStudioQuotedGenerationAmounts(item);
  if (amounts === null) return fail('invalid_receipt');
  const durationSeconds =
    item.purpose === 'seed_still'
      ? null
      : item.requestPlan.kind === 'resolved'
        ? item.requestPlan.snapshot.durationSeconds
        : item.requestPlan.template.durationSeconds;
  return {
    authorizationId: input.authorization.id,
    itemId: item.id,
    jobId: input.jobId,
    purpose: item.purpose,
    routeId: item.routeId,
    currency: input.authorization.currency,
    rateUnit: item.rateUnit,
    rateMinorUnits: item.rateMinorUnits,
    durationSeconds,
    generationIndex: input.generationIndex,
    generationCount: item.generationCount,
    totalMinorUnits: amounts.oneGenerationMinorUnits,
  };
};

/** Proves one persisted job repeats exactly its paired authorization entry and receipt. */
export const studioSpendReceiptMatchesJobV2 = (
  receipt: StudioSpendReceipt,
  authorization: StudioSpendAuthorization,
  job: StudioSpendReceiptJobLinkV2
): boolean => {
  try {
    const expected = createStudioSpendReceiptV2({
      authorization,
      itemId: job.authorizationItemId,
      jobId: job.id,
      generationIndex: job.generationIndex,
    });
    const key = authorization.idempotencyKeys.find(
      (entry) => entry.itemId === job.authorizationItemId && entry.generationIndex === job.generationIndex
    );
    return (
      job.authorizationId === authorization.id &&
      job.purpose === expected.purpose &&
      key?.key === job.idempotencyKey &&
      JSON.stringify(receipt) === JSON.stringify(expected)
    );
  } catch {
    return false;
  }
};
