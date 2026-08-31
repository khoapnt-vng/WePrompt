/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { types as nodeTypes } from 'node:util';

import {
  STUDIO_MAX_GENERATION_ITEMS_PER_REQUEST,
  STUDIO_MAX_GENERATION_SHOTS_PER_REQUEST,
  type StudioJobV2,
  type StudioCancellationPolicy,
  type StudioPieceJobRetryReasonV3,
  type StudioPieceSpendAuthorizationV3,
  type StudioPieceSpendReceiptV3,
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
  createStudioPieceQuotedGenerationIdV3,
  studioGenerationTargetKey,
  validateStudioPieceGenerationRequestPlanV3,
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
  typeof value.providerId === 'string' &&
  SAFE_ID.test(value.providerId) &&
  typeof value.adapterId === 'string' &&
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

  const expectedIdempotencyItemIds = items.flatMap((item) =>
    Array.from({ length: item.generationCount }, () => item.id)
  );
  if (!dense(input.idempotencyKeys) || input.idempotencyKeys.length !== expectedIdempotencyItemIds.length) {
    fail('invalid_idempotency');
  }
  const seenKeys = new Set<string>();
  const idempotencyKeys: StudioSpendAuthorization['idempotencyKeys'] = [];
  for (let entryIndex = 0; entryIndex < expectedIdempotencyItemIds.length; entryIndex += 1) {
    const expectedItemId = expectedIdempotencyItemIds[entryIndex]!;
    const entry = input.idempotencyKeys[entryIndex];
    if (
      entry === undefined ||
      Reflect.ownKeys(entry).length !== 2 ||
      entry.itemId !== expectedItemId ||
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
    calculateStudioQuotedGenerationAmounts(item) === null ||
    authorization.idempotencyKeys.filter((entry) => entry.itemId === itemId).length !== item.generationCount
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
    generationCount: 1,
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
    return (
      job.authorizationId === authorization.id &&
      job.purpose === expected.purpose &&
      authorization.idempotencyKeys.some(
        (entry) => entry.itemId === job.authorizationItemId && entry.key === job.idempotencyKey
      ) &&
      JSON.stringify(receipt) === JSON.stringify(expected)
    );
  } catch {
    return false;
  }
};

const PIECE_QUOTE_KEYS_V3 = new Set([
  'id',
  'reservationId',
  'quoteRevision',
  'projectId',
  'projectRevisionAtPreparation',
  'authoringRevision',
  'authoringFingerprintVersion',
  'authoringFingerprint',
  'rateCardDigest',
  'currency',
  'item',
  'lowerMinorUnits',
  'upperMinorUnits',
  'expiresAt',
]);
const PIECE_ITEM_KEYS_V3 = new Set([
  'id',
  'target',
  'purpose',
  'routeId',
  'generationCount',
  'requestPlan',
  'rateUnit',
  'rateMinorUnits',
]);
const PIECE_AUTHORIZATION_INPUT_KEYS_V3 = new Set([
  'reservationId',
  'authorizationId',
  'quote',
  'confirmedAt',
  'projectRevisionAtAuthorization',
  'provider',
  'cancellationPolicy',
  'idempotencyKey',
]);
const PIECE_AUTHORIZATION_KEYS_V3 = new Set([
  'id',
  'quote',
  'confirmedAt',
  'projectRevisionAtAuthorization',
  'cancellationPolicy',
  'providerBinding',
  'idempotencyKey',
]);
const PIECE_PROVIDER_KEYS_V3 = new Set(['providerId', 'adapterId', 'model']);
const PIECE_PROVIDER_BINDING_KEYS_V3 = new Set(['itemId', 'provider']);
const PIECE_IDEMPOTENCY_KEYS_V3 = new Set(['itemId', 'key']);
const PIECE_RECEIPT_INPUT_KEYS_V3 = new Set(['reservationId', 'authorization', 'jobId', 'recordedAt']);
const PIECE_RECEIPT_KEYS_V3 = new Set([
  'authorizationId',
  'quoteId',
  'quoteRevision',
  'itemId',
  'jobId',
  'purpose',
  'routeId',
  'currency',
  'rateUnit',
  'rateMinorUnits',
  'generationCount',
  'totalMinorUnits',
  'recordedAt',
]);
const PIECE_RECEIPT_JOB_KEYS_V3 = new Set(['id', 'authorizationId', 'authorizationItemId', 'idempotencyKey']);
const PIECE_DUPLICATE_ACKNOWLEDGEMENT_KEYS_V3 = new Set([
  'retryReason',
  'duplicateChargeAcknowledged',
  'duplicateChargeAcknowledgedAt',
]);

const exactRecordV3 = (value: unknown, keys: ReadonlySet<string>): value is Record<string, unknown> => {
  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value) || nodeTypes.isProxy(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return false;
    const ownKeys = Reflect.ownKeys(value);
    return (
      ownKeys.length === keys.size &&
      ownKeys.every((key) => typeof key === 'string' && keys.has(key)) &&
      [...keys].every((key) => {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        return descriptor !== undefined && descriptor.enumerable && Object.hasOwn(descriptor, 'value');
      })
    );
  } catch {
    return false;
  }
};

const hasOnlyOwnDataGraphV3 = (value: unknown, seen = new Set<object>()): boolean => {
  if (typeof value === 'function' || typeof value === 'symbol') return false;
  if (typeof value !== 'object' || value === null) return true;
  if (nodeTypes.isProxy(value) || seen.has(value)) return false;
  seen.add(value);
  try {
    const isArray = Array.isArray(value);
    const prototype = Object.getPrototypeOf(value);
    if (isArray ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) return false;
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string') return false;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (
        descriptor === undefined ||
        !Object.hasOwn(descriptor, 'value') ||
        (!descriptor.enumerable && !(isArray && key === 'length')) ||
        !hasOnlyOwnDataGraphV3(descriptor.value, seen)
      ) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
};

const validProviderV3 = (value: unknown): value is StudioProviderRef =>
  exactRecordV3(value, PIECE_PROVIDER_KEYS_V3) &&
  typeof value.providerId === 'string' &&
  SAFE_ID.test(value.providerId) &&
  typeof value.adapterId === 'string' &&
  ADAPTER_IDS.has(value.adapterId as StudioProviderRef['adapterId']) &&
  typeof value.model === 'string' &&
  safeModel(value.model);

const validCancellationPolicyV3 = (value: unknown): value is StudioCancellationPolicy =>
  value === 'none' || value === 'queued_only' || value === 'queued_and_running';

const canonicalJsonV3 = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJsonV3).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .toSorted()
    .map((key) => `${JSON.stringify(key)}:${canonicalJsonV3(record[key])}`)
    .join(',')}}`;
};

const pieceQuoteIsValidV3 = (quote: StudioPieceSpendAuthorizationV3['quote'], reservationId: string): boolean => {
  try {
    if (
      typeof reservationId !== 'string' ||
      !SAFE_ID.test(reservationId) ||
      !exactRecordV3(quote, PIECE_QUOTE_KEYS_V3) ||
      typeof quote.id !== 'string' ||
      !SAFE_ID.test(quote.id) ||
      quote.reservationId !== reservationId ||
      typeof quote.projectId !== 'string' ||
      !SAFE_ID.test(quote.projectId) ||
      !Number.isSafeInteger(quote.quoteRevision) ||
      quote.quoteRevision < 1 ||
      !Number.isSafeInteger(quote.projectRevisionAtPreparation) ||
      quote.projectRevisionAtPreparation < 1 ||
      !Number.isSafeInteger(quote.authoringRevision) ||
      quote.authoringRevision < 1 ||
      quote.authoringFingerprintVersion !== 1 ||
      typeof quote.authoringFingerprint !== 'string' ||
      !LOWERCASE_SHA256.test(quote.authoringFingerprint) ||
      typeof quote.rateCardDigest !== 'string' ||
      !LOWERCASE_SHA256.test(quote.rateCardDigest) ||
      typeof quote.currency !== 'string' ||
      !/^[A-Z]{3}$/.test(quote.currency) ||
      !canonicalTimestamp(quote.expiresAt) ||
      !Number.isSafeInteger(quote.lowerMinorUnits) ||
      quote.lowerMinorUnits < 1 ||
      quote.lowerMinorUnits !== quote.upperMinorUnits ||
      !exactRecordV3(quote.item, PIECE_ITEM_KEYS_V3)
    ) {
      return false;
    }
    const item = quote.item;
    if (
      !exactRecordV3(item.target, new Set(['kind', 'pieceId'])) ||
      item.target.kind !== 'piece' ||
      typeof item.target.pieceId !== 'string' ||
      !SAFE_ID.test(item.target.pieceId) ||
      item.purpose !== 'piece_image' ||
      typeof item.routeId !== 'string' ||
      !SAFE_ID.test(item.routeId) ||
      item.generationCount !== 1 ||
      item.rateUnit !== 'generation' ||
      item.rateMinorUnits !== quote.lowerMinorUnits ||
      !validateStudioPieceGenerationRequestPlanV3(item.requestPlan)
    ) {
      return false;
    }
    const composition = item.requestPlan.snapshot.composition;
    return (
      item.id ===
        createStudioPieceQuotedGenerationIdV3({
          projectId: quote.projectId,
          reservationId: quote.reservationId,
          quoteId: quote.id,
          quoteRevision: quote.quoteRevision,
          target: item.target,
          purpose: 'piece_image',
        }) &&
      composition.inputs.source.pieceId === item.target.pieceId &&
      composition.inputs.projectRevisionAtPreparation === quote.projectRevisionAtPreparation &&
      composition.inputs.authoringRevision === quote.authoringRevision &&
      composition.inputs.authoringFingerprintVersion === quote.authoringFingerprintVersion &&
      composition.inputs.authoringFingerprint === quote.authoringFingerprint
    );
  } catch {
    return false;
  }
};

export type StudioPieceSpendAuthorizationInputV3 = {
  reservationId: string;
  authorizationId: string;
  quote: StudioPieceSpendAuthorizationV3['quote'];
  confirmedAt: string;
  projectRevisionAtAuthorization: number;
  provider: StudioProviderRef;
  cancellationPolicy: StudioCancellationPolicy;
  idempotencyKey: string;
};

/** Freezes a separately identified Piece authorization after the reservation has been revalidated. */
export const createStudioPieceSpendAuthorizationV3 = (
  input: StudioPieceSpendAuthorizationInputV3
): StudioPieceSpendAuthorizationV3 => {
  let snapshot: StudioPieceSpendAuthorizationInputV3;
  if (!exactRecordV3(input, PIECE_AUTHORIZATION_INPUT_KEYS_V3) || !hasOnlyOwnDataGraphV3(input)) {
    return fail('invalid_authorization');
  }
  try {
    snapshot = structuredClone(input);
  } catch {
    return fail('invalid_authorization');
  }
  if (!pieceQuoteIsValidV3(snapshot.quote, snapshot.reservationId)) fail('invalid_authorization');
  if (
    typeof snapshot.authorizationId !== 'string' ||
    !SAFE_ID.test(snapshot.authorizationId) ||
    snapshot.authorizationId === snapshot.quote.id ||
    snapshot.authorizationId === snapshot.quote.item.id ||
    !canonicalTimestamp(snapshot.confirmedAt) ||
    Date.parse(snapshot.confirmedAt) >= Date.parse(snapshot.quote.expiresAt) ||
    !Number.isSafeInteger(snapshot.projectRevisionAtAuthorization) ||
    snapshot.projectRevisionAtAuthorization <= snapshot.quote.projectRevisionAtPreparation ||
    !validCancellationPolicyV3(snapshot.cancellationPolicy)
  ) {
    fail(
      Date.parse(snapshot.confirmedAt) >= Date.parse(snapshot.quote.expiresAt)
        ? 'expired_quote'
        : 'invalid_authorization'
    );
  }
  if (!validProvider(snapshot.provider)) fail('invalid_provider_binding');
  const compositionProvider = snapshot.quote.item.requestPlan.snapshot.composition.inputs.route;
  if (
    compositionProvider.providerId !== snapshot.provider.providerId ||
    compositionProvider.adapterId !== snapshot.provider.adapterId ||
    compositionProvider.model !== snapshot.provider.model
  ) {
    fail('invalid_provider_binding');
  }
  if (typeof snapshot.idempotencyKey !== 'string' || !SAFE_ID.test(snapshot.idempotencyKey)) {
    fail('invalid_idempotency');
  }
  return {
    id: snapshot.authorizationId,
    quote: structuredClone(snapshot.quote),
    confirmedAt: snapshot.confirmedAt,
    projectRevisionAtAuthorization: snapshot.projectRevisionAtAuthorization,
    cancellationPolicy: snapshot.cancellationPolicy,
    providerBinding: { itemId: snapshot.quote.item.id, provider: cloneProvider(snapshot.provider) },
    idempotencyKey: { itemId: snapshot.quote.item.id, key: snapshot.idempotencyKey },
  };
};

export const validateStudioPieceSpendAuthorizationV3 = (
  authorization: unknown,
  reservationId: string
): authorization is StudioPieceSpendAuthorizationV3 => {
  try {
    if (
      !hasOnlyOwnDataGraphV3(authorization) ||
      !exactRecordV3(authorization, PIECE_AUTHORIZATION_KEYS_V3) ||
      typeof authorization.id !== 'string' ||
      !SAFE_ID.test(authorization.id) ||
      !pieceQuoteIsValidV3(authorization.quote as StudioPieceSpendAuthorizationV3['quote'], reservationId) ||
      (authorization.quote as StudioPieceSpendAuthorizationV3['quote']).id === authorization.id ||
      (authorization.quote as StudioPieceSpendAuthorizationV3['quote']).item.id === authorization.id ||
      !canonicalTimestamp(authorization.confirmedAt as string) ||
      Date.parse(authorization.confirmedAt as string) >=
        Date.parse((authorization.quote as StudioPieceSpendAuthorizationV3['quote']).expiresAt) ||
      !Number.isSafeInteger(authorization.projectRevisionAtAuthorization) ||
      (authorization.projectRevisionAtAuthorization as number) <=
        (authorization.quote as StudioPieceSpendAuthorizationV3['quote']).projectRevisionAtPreparation ||
      !validCancellationPolicyV3(authorization.cancellationPolicy) ||
      !exactRecordV3(authorization.providerBinding, PIECE_PROVIDER_BINDING_KEYS_V3) ||
      !exactRecordV3(authorization.idempotencyKey, PIECE_IDEMPOTENCY_KEYS_V3)
    ) {
      return false;
    }
    const typed = authorization as unknown as StudioPieceSpendAuthorizationV3;
    return (
      typed.providerBinding.itemId === typed.quote.item.id &&
      validProviderV3(typed.providerBinding.provider) &&
      typed.providerBinding.provider.providerId ===
        typed.quote.item.requestPlan.snapshot.composition.inputs.route.providerId &&
      typed.providerBinding.provider.adapterId ===
        typed.quote.item.requestPlan.snapshot.composition.inputs.route.adapterId &&
      typed.providerBinding.provider.model === typed.quote.item.requestPlan.snapshot.composition.inputs.route.model &&
      typed.idempotencyKey.itemId === typed.quote.item.id &&
      typeof typed.idempotencyKey.key === 'string' &&
      SAFE_ID.test(typed.idempotencyKey.key)
    );
  } catch {
    return false;
  }
};

export const createStudioPieceSpendReceiptV3 = (input: {
  reservationId: string;
  authorization: StudioPieceSpendAuthorizationV3;
  jobId: string;
  recordedAt: string;
}): StudioPieceSpendReceiptV3 => {
  let snapshot: typeof input;
  if (!exactRecordV3(input, PIECE_RECEIPT_INPUT_KEYS_V3) || !hasOnlyOwnDataGraphV3(input)) {
    return fail('invalid_receipt');
  }
  try {
    snapshot = structuredClone(input);
  } catch {
    return fail('invalid_receipt');
  }
  if (!validateStudioPieceSpendAuthorizationV3(snapshot.authorization, snapshot.reservationId)) {
    fail('invalid_receipt');
  }
  if (
    typeof snapshot.jobId !== 'string' ||
    !SAFE_ID.test(snapshot.jobId) ||
    !canonicalTimestamp(snapshot.recordedAt) ||
    snapshot.recordedAt < snapshot.authorization.confirmedAt
  ) {
    fail('invalid_receipt');
  }
  const { authorization } = snapshot;
  const item = authorization.quote.item;
  return {
    authorizationId: authorization.id,
    quoteId: authorization.quote.id,
    quoteRevision: authorization.quote.quoteRevision,
    itemId: item.id,
    jobId: snapshot.jobId,
    purpose: 'piece_image',
    routeId: item.routeId,
    currency: authorization.quote.currency,
    rateUnit: 'generation',
    rateMinorUnits: item.rateMinorUnits,
    generationCount: 1,
    totalMinorUnits: item.rateMinorUnits,
    recordedAt: snapshot.recordedAt,
  };
};

export const studioPieceSpendReceiptMatchesJobV3 = (
  receipt: StudioPieceSpendReceiptV3,
  authorization: StudioPieceSpendAuthorizationV3,
  job: { id: string; authorizationId: string; authorizationItemId: string; idempotencyKey: string },
  reservationId: string
): boolean => {
  try {
    if (
      !exactRecordV3(receipt, PIECE_RECEIPT_KEYS_V3) ||
      !exactRecordV3(job, PIECE_RECEIPT_JOB_KEYS_V3) ||
      !hasOnlyOwnDataGraphV3({ receipt, authorization, job, reservationId })
    ) {
      return false;
    }
    const snapshot = structuredClone({ receipt, authorization, job, reservationId });
    if (!validateStudioPieceSpendAuthorizationV3(snapshot.authorization, snapshot.reservationId)) return false;
    const expected = createStudioPieceSpendReceiptV3({
      reservationId: snapshot.reservationId,
      authorization: snapshot.authorization,
      jobId: snapshot.job.id,
      recordedAt: snapshot.receipt.recordedAt,
    });
    return (
      snapshot.job.authorizationId === snapshot.authorization.id &&
      snapshot.job.authorizationItemId === snapshot.authorization.quote.item.id &&
      snapshot.job.idempotencyKey === snapshot.authorization.idempotencyKey.key &&
      canonicalJsonV3(snapshot.receipt) === canonicalJsonV3(expected)
    );
  } catch {
    return false;
  }
};

/** Enforces the Pilot retry duplicate-charge acknowledgement matrix. */
export const studioPieceDuplicateChargeAcknowledgementIsValidV3 = (input: {
  retryReason: StudioPieceJobRetryReasonV3 | null;
  duplicateChargeAcknowledged: boolean;
  duplicateChargeAcknowledgedAt: string | null;
}): boolean => {
  if (!exactRecordV3(input, PIECE_DUPLICATE_ACKNOWLEDGEMENT_KEYS_V3) || !hasOnlyOwnDataGraphV3(input)) {
    return false;
  }
  let snapshot: typeof input;
  try {
    snapshot = structuredClone(input);
  } catch {
    return false;
  }
  if (
    snapshot.retryReason !== null &&
    snapshot.retryReason !== 'provider_failure' &&
    snapshot.retryReason !== 'submission_unknown' &&
    snapshot.retryReason !== 'variation_grid' &&
    snapshot.retryReason !== 'cancelled'
  ) {
    return false;
  }
  return snapshot.retryReason === 'submission_unknown'
    ? snapshot.duplicateChargeAcknowledged &&
        snapshot.duplicateChargeAcknowledgedAt !== null &&
        canonicalTimestamp(snapshot.duplicateChargeAcknowledgedAt)
    : !snapshot.duplicateChargeAcknowledged && snapshot.duplicateChargeAcknowledgedAt === null;
};
