/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  STUDIO_MAX_GENERATION_ITEMS_PER_REQUEST,
  STUDIO_MAX_GENERATION_SHOTS_PER_REQUEST,
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
  studioGenerationTargetKey,
  STUDIO_BOARD_REQUEST_DURATION_SECONDS,
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
  'id' | 'authorizationId' | 'authorizationItemId' | 'idempotencyKey' | 'purpose'
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

const validGenerationTarget = (value: unknown): boolean => {
  if (value === null || typeof value !== 'object') return false;
  const target = value as Record<string, unknown>;
  return (
    Reflect.ownKeys(target).length === 2 &&
    ((target.kind === 'shot' && typeof target.shotId === 'string' && SAFE_ID.test(target.shotId)) ||
      (target.kind === 'reference' && typeof target.referenceId === 'string' && SAFE_ID.test(target.referenceId)))
  );
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

type StudioBoardAuthorizationScopeV2 = Pick<
  StudioSubmissionQuote,
  'originReferenceHandoffId' | 'baseItems' | 'cascadeItems'
>;

/** Keeps Board spend authority independent from continuity and first-frame generation. */
export const studioBoardAuthorizationScopeIsValidV2 = (quote: StudioBoardAuthorizationScopeV2): boolean => {
  const items = [...quote.baseItems, ...quote.cascadeItems];
  const boardItemCount = items.filter((item) => item.purpose === 'board_still').length;
  return (
    boardItemCount === 0 ||
    (boardItemCount === items.length &&
      boardItemCount <= STUDIO_MAX_GENERATION_SHOTS_PER_REQUEST &&
      quote.originReferenceHandoffId === null &&
      quote.cascadeItems.length === 0 &&
      items.every(
        (item) =>
          item.requestPlan.kind === 'resolved' &&
          item.requestPlan.snapshot.durationSeconds === STUDIO_BOARD_REQUEST_DURATION_SECONDS &&
          item.requestPlan.snapshot.conditioningInput === null
      ))
  );
};

const quotedItemRequestAuthorityIsValid = (item: StudioQuotedGeneration): boolean => {
  const purpose = item.purpose;
  switch (purpose) {
    case 'seed_still':
    case 'reference_image':
    case 'video_take':
      return true;
    case 'board_still':
      return (
        item.requestPlan.kind === 'resolved' &&
        item.requestPlan.snapshot.durationSeconds === STUDIO_BOARD_REQUEST_DURATION_SECONDS &&
        item.requestPlan.snapshot.conditioningInput === null
      );
    default: {
      const exhaustivePurpose: never = purpose;
      void exhaustivePurpose;
      return false;
    }
  }
};

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
  if (items.length > STUDIO_MAX_GENERATION_ITEMS_PER_REQUEST || !studioBoardAuthorizationScopeIsValidV2(quote)) {
    fail('invalid_authorization');
  }
  const itemIds = new Set<string>();
  const pairs = new Set<string>();
  for (const item of items) {
    if (
      item === null ||
      typeof item !== 'object' ||
      !validGenerationTarget(item.target) ||
      !SAFE_ID.test(item.id) ||
      item.id !==
        createStudioQuotedGenerationId({
          projectId: quote.projectId,
          projectRevision: quote.projectRevision,
          target: item.target,
          purpose: item.purpose,
        }) ||
      itemIds.has(item.id) ||
      pairs.has(`${studioGenerationTargetKey(item.target)}\0${item.purpose}`) ||
      !quotedItemRequestAuthorityIsValid(item) ||
      calculateStudioQuotedGenerationAmounts(item) === null
    ) {
      return fail('invalid_authorization');
    }
    itemIds.add(item.id);
    pairs.add(`${studioGenerationTargetKey(item.target)}\0${item.purpose}`);
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

  if (!dense(input.idempotencyKeys) || input.idempotencyKeys.length !== items.length) {
    fail('invalid_idempotency');
  }
  const seenKeys = new Set<string>();
  const idempotencyKeys: StudioSpendAuthorization['idempotencyKeys'] = [];
  for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
    const item = items[itemIndex]!;
    const entry = input.idempotencyKeys[itemIndex];
    if (
      entry === undefined ||
      Reflect.ownKeys(entry).length !== 2 ||
      entry.itemId !== item.id ||
      !SAFE_ID.test(entry.key) ||
      seenKeys.has(entry.key)
    ) {
      return fail('invalid_idempotency');
    }
    seenKeys.add(entry.key);
    idempotencyKeys.push({ ...entry });
  }

  const quote = structuredClone(input.quote);
  return {
    ...quote,
    confirmedAt: input.confirmedAt,
    providerBindings,
    idempotencyKeys,
  };
};

const findAuthorizationItem = (authorization: StudioSpendAuthorization, itemId: string): StudioQuotedGeneration => {
  if (!SAFE_ID.test(itemId)) return fail('invalid_receipt');
  const item = combinedItems(authorization).find((candidate) => candidate.id === itemId);
  if (
    item === undefined ||
    item.generationCount !== 1 ||
    !authorization.idempotencyKeys.some((entry) => entry.itemId === itemId)
  ) {
    return fail('invalid_receipt');
  }
  return item;
};

const receiptDurationSeconds = (item: StudioQuotedGeneration): number | null => {
  const purpose = item.purpose;
  switch (purpose) {
    case 'seed_still':
    case 'board_still':
    case 'reference_image':
      return null;
    case 'video_take':
      return item.requestPlan.kind === 'resolved'
        ? item.requestPlan.snapshot.durationSeconds
        : item.requestPlan.template.durationSeconds;
    default: {
      const exhaustivePurpose: never = purpose;
      void exhaustivePurpose;
      return fail('invalid_receipt');
    }
  }
};

/** Derives the immutable per-job receipt from frozen authorization values, never a current rate card. */
export const createStudioSpendReceiptV2 = (input: {
  authorization: StudioSpendAuthorization;
  itemId: string;
  jobId: string;
}): StudioSpendReceipt => {
  if (!SAFE_ID.test(input.jobId)) fail('invalid_receipt');
  const item = findAuthorizationItem(input.authorization, input.itemId);
  const amounts = calculateStudioQuotedGenerationAmounts(item);
  if (amounts === null) return fail('invalid_receipt');
  const durationSeconds = receiptDurationSeconds(item);
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
    });
    const key = authorization.idempotencyKeys.find((entry) => entry.itemId === job.authorizationItemId);
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
