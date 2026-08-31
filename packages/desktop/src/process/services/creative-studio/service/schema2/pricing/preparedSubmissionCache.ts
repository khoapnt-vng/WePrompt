/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { types as nodeTypes } from 'node:util';

import {
  STUDIO_MAX_JOBS_PER_PIECE_V3,
  STUDIO_MAX_PIECES_V3,
  STUDIO_MAX_PREPARED_QUOTE_CACHE_BYTES_GLOBAL,
  STUDIO_MAX_PREPARED_QUOTE_CACHE_BYTES_PER_PROJECT,
  STUDIO_MAX_PREPARED_QUOTE_SESSION_BYTES,
  STUDIO_MAX_PREPARED_QUOTE_SESSIONS_GLOBAL,
  STUDIO_MAX_PREPARED_QUOTE_SESSIONS_PER_PROJECT,
  STUDIO_PREPARED_QUOTE_TTL_SECONDS,
  type StudioCancellationPolicy,
  type StudioConfirmPreparedPhotoRequestV3,
  type StudioPreparedSubmissionOptionsV2,
  type StudioPreparedSubmissionRequestV2,
  type StudioPreparedPhotoReservationV3,
  type StudioRendererPreparedPhotoQuoteV3,
  type StudioSpendPolicy,
  type StudioSpendAuthorization,
  type StudioSubmissionCacheErrorCodeV2,
  type StudioSubmissionQuote,
} from '@/common/types/project/creativeStudioTypes';
import { isCanonicalStudioPieceHandleV3 } from '../mutations/pieceHandles';
import { evaluateStudioPieceSpendPolicyV3, validateStudioPieceSubmissionQuoteV3 } from './estimate';

const SAFE_ID = /^[A-Za-z0-9_-]{1,256}$/;
const isSafeIdV3 = (value: unknown): value is string => typeof value === 'string' && SAFE_ID.test(value);

export type StudioPreparedSubmissionSessionV2 = {
  preparedAt: string;
  request: StudioPreparedSubmissionRequestV2;
  options: StudioPreparedSubmissionOptionsV2;
  providerBindings: StudioSpendAuthorization['providerBindings'];
  cancellationPolicies: Array<{ itemId: string; policy: StudioCancellationPolicy }>;
};

export type StudioPreparedSubmissionCacheAdmissionV2 = Omit<StudioPreparedSubmissionSessionV2, 'preparedAt'>;

export type StudioPreparedSubmissionClaimV2 = Readonly<{
  option: keyof StudioPreparedSubmissionOptionsV2;
  quote: StudioSubmissionQuote;
  session: StudioPreparedSubmissionSessionV2;
}>;

export class StudioPreparedSubmissionCacheErrorV2 extends Error {
  readonly code: StudioSubmissionCacheErrorCodeV2;

  constructor(code: StudioSubmissionCacheErrorCodeV2) {
    super(code);
    this.name = 'StudioPreparedSubmissionCacheErrorV2';
    this.code = code;
  }
}

type CacheEntry = {
  session: StudioPreparedSubmissionSessionV2;
  byteSize: number;
  expiresAtMs: number;
  quoteIds: readonly string[];
  claimedBy: StudioPreparedSubmissionClaimV2 | null;
  expired: boolean;
};

const fail = (code: StudioSubmissionCacheErrorCodeV2): never => {
  throw new StudioPreparedSubmissionCacheErrorV2(code);
};

const invariant = (reason: string): never => {
  throw new TypeError(`invalid_prepared_submission_session:${reason}`);
};

const canonicalTimestamp = (value: string): boolean => {
  if (typeof value !== 'string' || value.length !== 24) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
};

const isDenseArray = (value: unknown): value is unknown[] => {
  if (!Array.isArray(value)) return false;
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) return false;
  }
  return true;
};

const jsonEqual = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right);

const deepFreeze = <T>(value: T, seen = new Set<object>()): T => {
  if (value === null || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    deepFreeze((value as Record<PropertyKey, unknown>)[key], seen);
  }
  return Object.freeze(value);
};

const serializeSession = (
  admission: StudioPreparedSubmissionCacheAdmissionV2,
  preparedAt: string
): { session: StudioPreparedSubmissionSessionV2; byteSize: number } => {
  let serialized: string;
  try {
    serialized = JSON.stringify({
      preparedAt,
      request: admission.request,
      options: admission.options,
      providerBindings: admission.providerBindings,
      cancellationPolicies: admission.cancellationPolicies,
    });
  } catch {
    return invariant('not_serializable');
  }
  const byteSize = Buffer.byteLength(serialized, 'utf8');
  const session = deepFreeze(JSON.parse(serialized) as StudioPreparedSubmissionSessionV2);
  return { session, byteSize };
};

const quoteItems = (quote: StudioSubmissionQuote) => [...quote.baseItems, ...quote.cascadeItems];

const isProjectReferenceRequest = (
  request: StudioPreparedSubmissionRequestV2
): request is Extract<StudioPreparedSubmissionRequestV2, { referenceIds: string[] }> =>
  Object.hasOwn(request, 'referenceIds');

const validateSession = (session: StudioPreparedSubmissionSessionV2, expectedExpiresAt: string): void => {
  const { request, options, providerBindings, cancellationPolicies } = session;
  const baseOnly = options.baseOnly;
  const withCascade = options.withCascade;
  if (
    !SAFE_ID.test(request.projectId) ||
    !Number.isSafeInteger(request.expectedRevision) ||
    request.expectedRevision < 1 ||
    !SAFE_ID.test(baseOnly.id) ||
    baseOnly.projectId !== request.projectId ||
    baseOnly.projectRevision !== request.expectedRevision ||
    baseOnly.expiresAt !== expectedExpiresAt ||
    baseOnly.cascadeItems.length !== 0 ||
    !canonicalTimestamp(baseOnly.expiresAt)
  ) {
    return invariant('base_option_mismatch');
  }

  if (isProjectReferenceRequest(request)) {
    if (
      Object.keys(request).length !== 3 ||
      !isDenseArray(request.referenceIds) ||
      request.referenceIds.length === 0 ||
      request.referenceIds.some((referenceId) => typeof referenceId !== 'string' || !SAFE_ID.test(referenceId)) ||
      new Set(request.referenceIds).size !== request.referenceIds.length ||
      (baseOnly.originReferenceHandoffId !== null && !SAFE_ID.test(baseOnly.originReferenceHandoffId)) ||
      baseOnly.baseItems.length !== request.referenceIds.length ||
      baseOnly.baseItems.some(
        (item, index) =>
          item.target?.kind !== 'reference' ||
          item.target?.referenceId !== request.referenceIds[index] ||
          item.purpose !== 'reference_image'
      ) ||
      withCascade !== null
    ) {
      return invariant('reference_option_mismatch');
    }
  } else if (
    !isDenseArray(request.baseChoices) ||
    !isDenseArray(request.cascadeChoices) ||
    baseOnly.originReferenceHandoffId !== request.originReferenceHandoffId
  ) {
    return invariant('base_option_mismatch');
  }

  if (!isProjectReferenceRequest(request) && request.cascadeChoices.length === 0 && withCascade !== null) {
    return invariant('cascade_option_presence');
  }
  if (
    withCascade !== null &&
    (!SAFE_ID.test(withCascade.id) ||
      withCascade.id === baseOnly.id ||
      withCascade.projectId !== request.projectId ||
      withCascade.projectRevision !== request.expectedRevision ||
      withCascade.originReferenceHandoffId !==
        (isProjectReferenceRequest(request) ? null : request.originReferenceHandoffId) ||
      withCascade.expiresAt !== expectedExpiresAt ||
      withCascade.currency !== baseOnly.currency ||
      withCascade.cascadeItems.length === 0 ||
      !jsonEqual(withCascade.baseItems, baseOnly.baseItems))
  ) {
    return invariant('cascade_option_mismatch');
  }

  const bindingQuote = withCascade ?? baseOnly;
  const items = quoteItems(bindingQuote);
  if (!isDenseArray(providerBindings) || providerBindings.length !== items.length) {
    return invariant('provider_binding_count');
  }
  if (!isDenseArray(cancellationPolicies) || cancellationPolicies.length !== items.length) {
    return invariant('cancellation_policy_count');
  }
  for (let index = 0; index < items.length; index += 1) {
    const binding = providerBindings[index];
    const cancellation = cancellationPolicies[index];
    if (binding === undefined || binding.itemId !== items[index]!.id) {
      return invariant('provider_binding_order');
    }
    if (
      cancellation === undefined ||
      cancellation.itemId !== items[index]!.id ||
      (cancellation.policy !== 'none' &&
        cancellation.policy !== 'queued_only' &&
        cancellation.policy !== 'queued_and_running')
    ) {
      return invariant('cancellation_policy_order');
    }
  }
};

const compareEntries = (left: CacheEntry, right: CacheEntry): number => {
  const prepared = left.session.preparedAt.localeCompare(right.session.preparedAt);
  if (prepared !== 0) return prepared;
  const project = left.session.request.projectId.localeCompare(right.session.request.projectId);
  if (project !== 0) return project;
  return left.session.options.baseOnly.id.localeCompare(right.session.options.baseOnly.id);
};

/**
 * Owns all unconfirmed schema-2 quote sessions. All methods are synchronous so each admission,
 * lookup, claim, release, and consume transition is atomic on the main-process event loop.
 */
export class StudioPreparedSubmissionCacheV2 {
  readonly #now: () => number;
  readonly #entries = new Set<CacheEntry>();
  readonly #quoteLookup = new Map<string, Map<string, CacheEntry>>();
  readonly #claimEntries = new WeakMap<StudioPreparedSubmissionClaimV2, CacheEntry>();
  #closed = false;

  constructor(options: { now?: () => number } = {}) {
    this.#now = options.now ?? Date.now;
  }

  admit(admission: StudioPreparedSubmissionCacheAdmissionV2): StudioPreparedSubmissionSessionV2 {
    this.#assertOpen();
    const now = this.#readClock();
    this.#expire(now);
    const preparedAt = new Date(now).toISOString();
    const expectedExpiresAt = new Date(now + STUDIO_PREPARED_QUOTE_TTL_SECONDS * 1_000).toISOString();
    const stampedAdmission: StudioPreparedSubmissionCacheAdmissionV2 = {
      request: admission.request,
      options: {
        baseOnly: { ...admission.options.baseOnly, expiresAt: expectedExpiresAt },
        withCascade:
          admission.options.withCascade === null
            ? null
            : { ...admission.options.withCascade, expiresAt: expectedExpiresAt },
      },
      providerBindings: admission.providerBindings,
      cancellationPolicies: admission.cancellationPolicies,
    };
    const { session, byteSize } = serializeSession(stampedAdmission, preparedAt);
    validateSession(session, expectedExpiresAt);
    if (byteSize > STUDIO_MAX_PREPARED_QUOTE_SESSION_BYTES) fail('quote_too_large');

    const projectId = session.request.projectId;
    const quoteIds = [session.options.baseOnly.id];
    if (session.options.withCascade !== null) quoteIds.push(session.options.withCascade.id);
    if (this.#hasQuoteCollision(projectId, quoteIds)) return invariant('quote_id_collision');

    this.#evictForProject(projectId, byteSize);
    this.#evictForGlobal(byteSize);
    if (!this.#fits(projectId, byteSize)) fail('quote_cache_full');

    const entry: CacheEntry = {
      session,
      byteSize,
      expiresAtMs: Date.parse(session.options.baseOnly.expiresAt),
      quoteIds: Object.freeze(quoteIds),
      claimedBy: null,
      expired: false,
    };
    this.#entries.add(entry);
    let projectLookup = this.#quoteLookup.get(projectId);
    if (projectLookup === undefined) {
      projectLookup = new Map();
      this.#quoteLookup.set(projectId, projectLookup);
    }
    for (const quoteId of quoteIds) projectLookup.set(quoteId, entry);

    return structuredClone(session);
  }

  claim(projectId: string, quoteId: string): StudioPreparedSubmissionClaimV2 {
    this.#assertOpen();
    this.#expire(this.#readClock());
    const entry = this.#quoteLookup.get(projectId)?.get(quoteId);
    if (entry === undefined || entry.expired) return fail('quote_not_found');
    if (entry.claimedBy !== null) return fail('quote_in_use');

    const withCascade = entry.session.options.withCascade;
    const option = withCascade?.id === quoteId ? 'withCascade' : 'baseOnly';
    const quote = option === 'withCascade' ? withCascade : entry.session.options.baseOnly;
    if (quote === null || quote.projectId !== projectId) return fail('quote_not_found');
    const claim: StudioPreparedSubmissionClaimV2 = Object.freeze({ option, quote, session: entry.session });
    entry.claimedBy = claim;
    this.#claimEntries.set(claim, entry);
    return claim;
  }

  release(claim: StudioPreparedSubmissionClaimV2): void {
    const entry = this.#activeClaimEntry(claim);
    if (entry === null) return;
    entry.claimedBy = null;
    this.#claimEntries.delete(claim);
    if (entry.expired || this.#closed) this.#remove(entry);
  }

  consume(claim: StudioPreparedSubmissionClaimV2): void {
    const entry = this.#activeClaimEntry(claim);
    if (entry === null) return;
    this.#claimEntries.delete(claim);
    this.#remove(entry);
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    for (const entry of this.#entries) {
      if (entry.claimedBy !== null) this.#claimEntries.delete(entry.claimedBy);
    }
    this.#entries.clear();
    this.#quoteLookup.clear();
  }

  #assertOpen(): void {
    if (this.#closed) throw new Error('prepared_submission_cache_closed');
  }

  #readClock(): number {
    const now = this.#now();
    if (!Number.isSafeInteger(now)) throw new Error('invalid_prepared_submission_cache_clock');
    try {
      new Date(now).toISOString();
    } catch {
      throw new Error('invalid_prepared_submission_cache_clock');
    }
    return now;
  }

  #activeClaimEntry(claim: StudioPreparedSubmissionClaimV2): CacheEntry | null {
    const entry = this.#claimEntries.get(claim);
    return entry?.claimedBy === claim ? entry : null;
  }

  #expire(now: number): void {
    for (const entry of this.#entries) {
      if (now < entry.expiresAtMs || entry.expired) continue;
      entry.expired = true;
      this.#removeLookup(entry);
      if (entry.claimedBy === null) this.#remove(entry);
    }
  }

  #hasQuoteCollision(projectId: string, quoteIds: readonly string[]): boolean {
    return [...this.#entries].some(
      (entry) =>
        entry.session.request.projectId === projectId && entry.quoteIds.some((quoteId) => quoteIds.includes(quoteId))
    );
  }

  #projectEntries(projectId: string): CacheEntry[] {
    return [...this.#entries].filter((entry) => entry.session.request.projectId === projectId);
  }

  #oldestIdle(entries: readonly CacheEntry[]): CacheEntry | undefined {
    return entries.filter((entry) => entry.claimedBy === null).toSorted(compareEntries)[0];
  }

  #evictForProject(projectId: string, byteSize: number): void {
    while (true) {
      const entries = this.#projectEntries(projectId);
      const bytes = entries.reduce((total, entry) => total + entry.byteSize, 0);
      if (
        entries.length + 1 <= STUDIO_MAX_PREPARED_QUOTE_SESSIONS_PER_PROJECT &&
        bytes + byteSize <= STUDIO_MAX_PREPARED_QUOTE_CACHE_BYTES_PER_PROJECT
      ) {
        return;
      }
      const victim = this.#oldestIdle(entries);
      if (victim === undefined) return;
      this.#remove(victim);
    }
  }

  #evictForGlobal(byteSize: number): void {
    while (true) {
      const entries = [...this.#entries];
      const bytes = entries.reduce((total, entry) => total + entry.byteSize, 0);
      if (
        entries.length + 1 <= STUDIO_MAX_PREPARED_QUOTE_SESSIONS_GLOBAL &&
        bytes + byteSize <= STUDIO_MAX_PREPARED_QUOTE_CACHE_BYTES_GLOBAL
      ) {
        return;
      }
      const victim = this.#oldestIdle(entries);
      if (victim === undefined) return;
      this.#remove(victim);
    }
  }

  #fits(projectId: string, byteSize: number): boolean {
    const projectEntries = this.#projectEntries(projectId);
    const globalEntries = [...this.#entries];
    return (
      projectEntries.length + 1 <= STUDIO_MAX_PREPARED_QUOTE_SESSIONS_PER_PROJECT &&
      projectEntries.reduce((total, entry) => total + entry.byteSize, 0) + byteSize <=
        STUDIO_MAX_PREPARED_QUOTE_CACHE_BYTES_PER_PROJECT &&
      globalEntries.length + 1 <= STUDIO_MAX_PREPARED_QUOTE_SESSIONS_GLOBAL &&
      globalEntries.reduce((total, entry) => total + entry.byteSize, 0) + byteSize <=
        STUDIO_MAX_PREPARED_QUOTE_CACHE_BYTES_GLOBAL
    );
  }

  #removeLookup(entry: CacheEntry): void {
    const projectId = entry.session.request.projectId;
    const lookup = this.#quoteLookup.get(projectId);
    if (lookup === undefined) return;
    for (const quoteId of entry.quoteIds) {
      if (lookup.get(quoteId) === entry) lookup.delete(quoteId);
    }
    if (lookup.size === 0) this.#quoteLookup.delete(projectId);
  }

  #remove(entry: CacheEntry): void {
    this.#removeLookup(entry);
    this.#entries.delete(entry);
    entry.claimedBy = null;
  }
}

type UnstampedPieceQuoteV3 = Omit<StudioPreparedPhotoReservationV3['quote'], 'expiresAt'>;
type UnstampedPieceReservationV3<T extends StudioPreparedPhotoReservationV3 = StudioPreparedPhotoReservationV3> =
  T extends StudioPreparedPhotoReservationV3
    ? Omit<T, 'preparedAt' | 'expiresAt' | 'quote'> & { quote: UnstampedPieceQuoteV3 }
    : never;

export type StudioPreparedPhotoCacheAdmissionV3 = {
  reservation: UnstampedPieceReservationV3;
  spendPolicy: StudioSpendPolicy | null;
};

export type StudioPreparedPhotoClaimV3 = Readonly<{
  reservation: StudioPreparedPhotoReservationV3;
}>;

export class StudioPreparedPhotoCacheErrorV3 extends Error {
  readonly code: StudioSubmissionCacheErrorCodeV2;

  constructor(code: StudioSubmissionCacheErrorCodeV2) {
    super(code);
    this.name = 'StudioPreparedPhotoCacheErrorV3';
    this.code = code;
  }
}

type PreparedPhotoEntryV3 = {
  reservation: StudioPreparedPhotoReservationV3;
  projection: StudioRendererPreparedPhotoQuoteV3;
  byteSize: number;
  expiresAtMs: number;
  claimedBy: StudioPreparedPhotoClaimV3 | null;
  expired: boolean;
};

const CREATE_RESERVATION_KEYS_V3 = new Set([
  'reservationId',
  'projectId',
  'targetPieceId',
  'jobId',
  'authorizationId',
  'authorizationItemId',
  'idempotencyKey',
  'words',
  'settings',
  'provider',
  'cancellationPolicy',
  'quote',
  'authoringRevision',
  'authoringFingerprintVersion',
  'authoringFingerprint',
  'projectRevisionAtPreparation',
  'preparedAt',
  'expiresAt',
  'mode',
  'proposedHandle',
  'orderIndex',
]);
const RETRY_RESERVATION_KEYS_V3 = new Set([
  'reservationId',
  'projectId',
  'targetPieceId',
  'jobId',
  'authorizationId',
  'authorizationItemId',
  'idempotencyKey',
  'words',
  'settings',
  'provider',
  'cancellationPolicy',
  'quote',
  'authoringRevision',
  'authoringFingerprintVersion',
  'authoringFingerprint',
  'projectRevisionAtPreparation',
  'preparedAt',
  'expiresAt',
  'mode',
  'sourceJobId',
  'lineage',
  'retryReason',
]);
const CREATE_UNSTAMPED_RESERVATION_KEYS_V3 = new Set(
  [...CREATE_RESERVATION_KEYS_V3].filter((key) => key !== 'preparedAt' && key !== 'expiresAt')
);
const RETRY_UNSTAMPED_RESERVATION_KEYS_V3 = new Set(
  [...RETRY_RESERVATION_KEYS_V3].filter((key) => key !== 'preparedAt' && key !== 'expiresAt')
);
const UNSTAMPED_QUOTE_KEYS_V3 = new Set([
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
]);
const PHOTO_CLAIM_KEYS_V3 = new Set(['reservationId', 'quoteId', 'quoteRevision']);
const PHOTO_CONFIRMATION_KEYS_V3 = new Set([
  'reservationId',
  'quoteId',
  'quoteRevision',
  'explicitHumanConfirmation',
  'duplicateChargeAcknowledged',
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

const exactDenseArrayV3 = (value: unknown, maxLength: number): value is unknown[] => {
  try {
    if (!Array.isArray(value) || nodeTypes.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype) {
      return false;
    }
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
    if (
      lengthDescriptor === undefined ||
      !Object.hasOwn(lengthDescriptor, 'value') ||
      lengthDescriptor.enumerable ||
      !Number.isSafeInteger(lengthDescriptor.value) ||
      (lengthDescriptor.value as number) < 0 ||
      (lengthDescriptor.value as number) > maxLength
    ) {
      return false;
    }
    const length = lengthDescriptor.value as number;
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length !== length + 1) return false;
    for (let index = 0; index < length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (descriptor === undefined || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) return false;
    }
    return ownKeys.every((key) => key === 'length' || (typeof key === 'string' && /^(?:0|[1-9]\d*)$/.test(key)));
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

const projectPieceSpendQuoteV3 = (
  quote: StudioPreparedPhotoReservationV3['quote']
): Pick<StudioPreparedPhotoReservationV3['quote'], 'currency' | 'lowerMinorUnits' | 'upperMinorUnits'> => ({
  currency: quote.currency,
  lowerMinorUnits: quote.lowerMinorUnits,
  upperMinorUnits: quote.upperMinorUnits,
});

const validTimestampV3 = (value: unknown): value is string => {
  if (typeof value !== 'string' || value.length !== 24) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
};

const validSettingsV3 = (value: unknown): boolean =>
  exactRecordV3(value, new Set(['aspectRatio', 'resolution'])) &&
  (value.aspectRatio === '16:9' ||
    value.aspectRatio === '9:16' ||
    value.aspectRatio === '1:1' ||
    value.aspectRatio === '4:3' ||
    value.aspectRatio === '3:4') &&
  (value.resolution === '720p' || value.resolution === '1080p');

const providerEqualsV3 = (left: unknown, right: unknown): boolean =>
  exactRecordV3(left, new Set(['providerId', 'adapterId', 'model'])) &&
  exactRecordV3(right, new Set(['providerId', 'adapterId', 'model'])) &&
  left.providerId === right.providerId &&
  left.adapterId === right.adapterId &&
  left.model === right.model;

const validateRetryLineageV3 = (reservation: Extract<StudioPreparedPhotoReservationV3, { mode: 'retry' }>): boolean => {
  if (
    !exactDenseArrayV3(reservation.lineage, STUDIO_MAX_JOBS_PER_PIECE_V3) ||
    reservation.lineage.length === 0 ||
    reservation.lineage.at(-1)?.jobId !== reservation.sourceJobId
  ) {
    return false;
  }
  const positions = new Map<string, number>();
  const parents = new Set<string>();
  for (let index = 0; index < reservation.lineage.length; index += 1) {
    const entry = reservation.lineage[index];
    if (
      !exactRecordV3(entry, new Set(['jobId', 'retryOfJobId', 'retryReason'])) ||
      typeof entry.jobId !== 'string' ||
      !SAFE_ID.test(entry.jobId) ||
      positions.has(entry.jobId) ||
      (entry.retryOfJobId !== null && (typeof entry.retryOfJobId !== 'string' || !SAFE_ID.test(entry.retryOfJobId))) ||
      (entry.retryReason !== null &&
        entry.retryReason !== 'provider_failure' &&
        entry.retryReason !== 'submission_unknown' &&
        entry.retryReason !== 'variation_grid' &&
        entry.retryReason !== 'cancelled') ||
      (index === 0) !== (entry.retryOfJobId === null) ||
      (entry.retryOfJobId === null) !== (entry.retryReason === null)
    ) {
      return false;
    }
    if (entry.retryOfJobId !== null && (positions.get(entry.retryOfJobId) ?? Number.MAX_SAFE_INTEGER) >= index) {
      return false;
    }
    if (entry.retryOfJobId !== null && parents.has(entry.retryOfJobId)) return false;
    if (entry.retryOfJobId !== null) parents.add(entry.retryOfJobId);
    positions.set(entry.jobId, index);
  }
  return !positions.has(reservation.jobId);
};

const validatePreparedPhotoReservationV3 = (reservation: StudioPreparedPhotoReservationV3): void => {
  const keys = reservation.mode === 'create' ? CREATE_RESERVATION_KEYS_V3 : RETRY_RESERVATION_KEYS_V3;
  if (
    !exactRecordV3(reservation, keys) ||
    (reservation.mode !== 'create' && reservation.mode !== 'retry') ||
    !isSafeIdV3(reservation.reservationId) ||
    !isSafeIdV3(reservation.projectId) ||
    !isSafeIdV3(reservation.targetPieceId) ||
    !isSafeIdV3(reservation.jobId) ||
    !isSafeIdV3(reservation.authorizationId) ||
    !isSafeIdV3(reservation.authorizationItemId) ||
    !isSafeIdV3(reservation.idempotencyKey) ||
    new Set([
      reservation.reservationId,
      reservation.targetPieceId,
      reservation.jobId,
      reservation.authorizationId,
      reservation.authorizationItemId,
      reservation.idempotencyKey,
      reservation.quote.id,
    ]).size !== 7 ||
    typeof reservation.words !== 'string' ||
    reservation.words.length === 0 ||
    reservation.words !== reservation.words.normalize('NFKC').replace(/\s+/gu, ' ').trim() ||
    !validSettingsV3(reservation.settings) ||
    (reservation.cancellationPolicy !== 'none' &&
      reservation.cancellationPolicy !== 'queued_only' &&
      reservation.cancellationPolicy !== 'queued_and_running') ||
    !Number.isSafeInteger(reservation.authoringRevision) ||
    reservation.authoringRevision < 1 ||
    reservation.authoringFingerprintVersion !== 1 ||
    !/^[a-f0-9]{64}$/.test(reservation.authoringFingerprint) ||
    !Number.isSafeInteger(reservation.projectRevisionAtPreparation) ||
    reservation.projectRevisionAtPreparation < 1 ||
    !validTimestampV3(reservation.preparedAt) ||
    !validTimestampV3(reservation.expiresAt) ||
    reservation.preparedAt >= reservation.expiresAt ||
    !validateStudioPieceSubmissionQuoteV3(reservation.quote, reservation.reservationId) ||
    reservation.quote.id === reservation.authorizationId ||
    reservation.quote.expiresAt !== reservation.expiresAt ||
    reservation.quote.projectId !== reservation.projectId ||
    reservation.quote.item.target.pieceId !== reservation.targetPieceId ||
    reservation.quote.item.id !== reservation.authorizationItemId ||
    reservation.quote.authoringRevision !== reservation.authoringRevision ||
    reservation.quote.authoringFingerprintVersion !== reservation.authoringFingerprintVersion ||
    reservation.quote.authoringFingerprint !== reservation.authoringFingerprint ||
    reservation.quote.projectRevisionAtPreparation !== reservation.projectRevisionAtPreparation ||
    reservation.quote.item.requestPlan.snapshot.composition.inputs.source.words !== reservation.words ||
    reservation.quote.item.requestPlan.snapshot.settings.aspectRatio !== reservation.settings.aspectRatio ||
    reservation.quote.item.requestPlan.snapshot.settings.resolution !== reservation.settings.resolution ||
    !providerEqualsV3(reservation.provider, reservation.quote.item.requestPlan.snapshot.composition.inputs.route)
  ) {
    return invariant('photo_reservation_mismatch');
  }
  if (reservation.mode === 'create') {
    if (
      !isCanonicalStudioPieceHandleV3(reservation.proposedHandle) ||
      !Number.isSafeInteger(reservation.orderIndex) ||
      reservation.orderIndex < 0 ||
      reservation.orderIndex >= STUDIO_MAX_PIECES_V3
    ) {
      return invariant('photo_create_shape');
    }
    return;
  }
  if (
    !isSafeIdV3(reservation.sourceJobId) ||
    (reservation.retryReason !== 'provider_failure' &&
      reservation.retryReason !== 'submission_unknown' &&
      reservation.retryReason !== 'variation_grid' &&
      reservation.retryReason !== 'cancelled') ||
    !validateRetryLineageV3(reservation)
  ) {
    return invariant('photo_retry_shape');
  }
};

const comparePreparedPhotosV3 = (left: PreparedPhotoEntryV3, right: PreparedPhotoEntryV3): number =>
  left.reservation.preparedAt.localeCompare(right.reservation.preparedAt) ||
  left.reservation.projectId.localeCompare(right.reservation.projectId) ||
  left.reservation.reservationId.localeCompare(right.reservation.reservationId);

/**
 * Validates the renderer's bounded confirmation decision against current spend policy and the
 * claimed Main-owned reservation. Quote/fingerprint rederivation remains a separate Main gate.
 */
export const validateStudioConfirmPreparedPhotoRequestV3 = (
  value: unknown,
  reservation: StudioPreparedPhotoReservationV3,
  currentPolicy: StudioSpendPolicy | null,
  nowMs: number
): value is StudioConfirmPreparedPhotoRequestV3 => {
  try {
    validatePreparedPhotoReservationV3(reservation);
    if (
      !exactRecordV3(value, PHOTO_CONFIRMATION_KEYS_V3) ||
      !isSafeIdV3(value.reservationId) ||
      !isSafeIdV3(value.quoteId) ||
      !Number.isSafeInteger(value.quoteRevision) ||
      typeof value.explicitHumanConfirmation !== 'boolean' ||
      typeof value.duplicateChargeAcknowledged !== 'boolean' ||
      value.reservationId !== reservation.reservationId ||
      value.quoteId !== reservation.quote.id ||
      value.quoteRevision !== reservation.quote.quoteRevision ||
      !Number.isSafeInteger(nowMs) ||
      nowMs < 0 ||
      nowMs >= Date.parse(reservation.expiresAt)
    ) {
      return false;
    }
    const policy = evaluateStudioPieceSpendPolicyV3(projectPieceSpendQuoteV3(reservation.quote), currentPolicy);
    const duplicateChargeRequired = reservation.mode === 'retry' && reservation.retryReason === 'submission_unknown';
    const explicitHumanRequired = policy.requiresExplicitHumanAction || duplicateChargeRequired;
    return (
      value.explicitHumanConfirmation === explicitHumanRequired &&
      value.duplicateChargeAcknowledged === duplicateChargeRequired
    );
  } catch {
    return false;
  }
};

/** In-memory owner of inactive CS4 create/retry reservations and renderer-safe quote activity. */
export class StudioPreparedPhotoCacheV3 {
  readonly #now: () => number;
  readonly #onChange: (projectId: string) => void;
  readonly #entries = new Set<PreparedPhotoEntryV3>();
  readonly #reservations = new Map<string, PreparedPhotoEntryV3>();
  readonly #claimEntries = new WeakMap<StudioPreparedPhotoClaimV3, PreparedPhotoEntryV3>();
  #closed = false;

  constructor(options: { now?: () => number; onChange?: (projectId: string) => void } = {}) {
    this.#now = options.now ?? Date.now;
    this.#onChange = options.onChange ?? (() => undefined);
  }

  admit(admission: StudioPreparedPhotoCacheAdmissionV3): StudioPreparedPhotoReservationV3 {
    this.#assertOpen();
    if (!exactRecordV3(admission, new Set(['reservation', 'spendPolicy'])) || !hasOnlyOwnDataGraphV3(admission)) {
      return invariant('photo_admission_shape');
    }
    let snapshot: StudioPreparedPhotoCacheAdmissionV3;
    try {
      snapshot = structuredClone(admission);
    } catch {
      return invariant('photo_admission_shape');
    }
    const exactCreate = exactRecordV3(snapshot.reservation, CREATE_UNSTAMPED_RESERVATION_KEYS_V3);
    const exactRetry = exactRecordV3(snapshot.reservation, RETRY_UNSTAMPED_RESERVATION_KEYS_V3);
    if ((!exactCreate && !exactRetry) || !exactRecordV3(snapshot.reservation.quote, UNSTAMPED_QUOTE_KEYS_V3)) {
      return invariant('photo_admission_shape');
    }
    const now = this.#readClock();
    this.#expire(now);
    const preparedAt = new Date(now).toISOString();
    const expiresAt = new Date(now + STUDIO_PREPARED_QUOTE_TTL_SECONDS * 1_000).toISOString();
    const candidate = {
      ...snapshot.reservation,
      quote: { ...snapshot.reservation.quote, expiresAt },
      preparedAt,
      expiresAt,
    } as StudioPreparedPhotoReservationV3;
    validatePreparedPhotoReservationV3(candidate);
    let serialized: string;
    try {
      serialized = JSON.stringify(candidate);
    } catch {
      return invariant('photo_not_serializable');
    }
    const byteSize = Buffer.byteLength(serialized, 'utf8');
    const reservation = deepFreeze(JSON.parse(serialized) as StudioPreparedPhotoReservationV3);
    validatePreparedPhotoReservationV3(reservation);
    if (byteSize > STUDIO_MAX_PREPARED_QUOTE_SESSION_BYTES)
      throw new StudioPreparedPhotoCacheErrorV3('quote_too_large');
    if ([...this.#entries].some((entry) => entry.reservation.reservationId === reservation.reservationId)) {
      return invariant('photo_reservation_collision');
    }
    const sameProjectEntries = [...this.#entries].filter(
      (entry) => !entry.expired && entry.reservation.projectId === reservation.projectId
    );
    if (
      sameProjectEntries.some(
        (entry) =>
          entry.reservation.targetPieceId === reservation.targetPieceId ||
          entry.reservation.jobId === reservation.jobId ||
          entry.reservation.authorizationId === reservation.authorizationId ||
          entry.reservation.authorizationItemId === reservation.authorizationItemId ||
          entry.reservation.idempotencyKey === reservation.idempotencyKey
      )
    ) {
      return invariant('photo_identity_collision');
    }
    if (
      reservation.mode === 'create' &&
      sameProjectEntries.some(
        (entry) =>
          !entry.expired &&
          entry.reservation.mode === 'create' &&
          entry.reservation.projectId === reservation.projectId &&
          entry.reservation.proposedHandle === reservation.proposedHandle
      )
    ) {
      return invariant('photo_handle_collision');
    }
    if (
      [...this.#entries].some(
        (entry) =>
          entry.reservation.projectId === reservation.projectId &&
          entry.reservation.quote.id === reservation.quote.id &&
          entry.reservation.quote.quoteRevision === reservation.quote.quoteRevision
      )
    ) {
      return invariant('photo_quote_collision');
    }
    const policy = evaluateStudioPieceSpendPolicyV3(projectPieceSpendQuoteV3(reservation.quote), snapshot.spendPolicy);
    const duplicateChargeAcknowledgementRequired =
      reservation.mode === 'retry' && reservation.retryReason === 'submission_unknown';
    const requiresExplicitHumanAction = policy.requiresExplicitHumanAction || duplicateChargeAcknowledgementRequired;
    const projectionBase = {
      reservationId: reservation.reservationId,
      projectId: reservation.projectId,
      quoteId: reservation.quote.id,
      quoteRevision: reservation.quote.quoteRevision,
      targetPieceId: reservation.targetPieceId,
      words: reservation.words,
      settings: { ...reservation.settings },
      currency: reservation.quote.currency,
      lowerMinorUnits: reservation.quote.lowerMinorUnits,
      upperMinorUnits: reservation.quote.upperMinorUnits,
      spendPolicyClassification: policy.classification,
      expiresAt: reservation.expiresAt,
      requiresExplicitHumanAction,
      duplicateChargeAcknowledgementRequired,
    };
    const projection: StudioRendererPreparedPhotoQuoteV3 = deepFreeze(
      reservation.mode === 'create'
        ? { ...projectionBase, mode: 'create', proposedHandle: reservation.proposedHandle }
        : { ...projectionBase, mode: 'retry', proposedHandle: null }
    );

    const evictionPlan = this.#planEvictions(reservation.projectId, byteSize);
    if (evictionPlan === null) throw new StudioPreparedPhotoCacheErrorV3('quote_cache_full');
    const changedProjects = new Set(evictionPlan.map((victim) => victim.reservation.projectId));
    for (const victim of evictionPlan) this.#remove(victim, false);
    const entry: PreparedPhotoEntryV3 = {
      reservation,
      projection,
      byteSize,
      expiresAtMs: Date.parse(expiresAt),
      claimedBy: null,
      expired: false,
    };
    this.#entries.add(entry);
    this.#reservations.set(reservation.reservationId, entry);
    changedProjects.add(reservation.projectId);
    for (const projectId of changedProjects) this.#notify(projectId);
    return structuredClone(reservation);
  }

  list(projectId: string): StudioRendererPreparedPhotoQuoteV3[] {
    this.#assertOpen();
    if (!isSafeIdV3(projectId)) throw new StudioPreparedPhotoCacheErrorV3('quote_not_found');
    this.#expire(this.#readClock());
    return [...this.#entries]
      .filter((entry) => entry.reservation.projectId === projectId && !entry.expired)
      .toSorted(comparePreparedPhotosV3)
      .map((entry) => structuredClone(entry.projection));
  }

  /** Main-only namespace input for deterministic handle derivation before the quote is composed. */
  reservedCreateHandles(projectId: string): string[] {
    this.#assertOpen();
    if (!isSafeIdV3(projectId)) throw new StudioPreparedPhotoCacheErrorV3('quote_not_found');
    this.#expire(this.#readClock());
    return [...this.#entries]
      .filter(
        (
          entry
        ): entry is PreparedPhotoEntryV3 & {
          reservation: Extract<StudioPreparedPhotoReservationV3, { mode: 'create' }>;
        } => !entry.expired && entry.reservation.projectId === projectId && entry.reservation.mode === 'create'
      )
      .map((entry) => entry.reservation.proposedHandle)
      .toSorted();
  }

  claim(input: { reservationId: string; quoteId: string; quoteRevision: number }): StudioPreparedPhotoClaimV3 {
    this.#assertOpen();
    this.#expire(this.#readClock());
    if (
      !exactRecordV3(input, PHOTO_CLAIM_KEYS_V3) ||
      !isSafeIdV3(input.reservationId) ||
      !isSafeIdV3(input.quoteId) ||
      !Number.isSafeInteger(input.quoteRevision) ||
      input.quoteRevision < 1
    ) {
      throw new StudioPreparedPhotoCacheErrorV3('quote_not_found');
    }
    const entry = this.#reservations.get(input.reservationId);
    if (
      entry === undefined ||
      entry.expired ||
      entry.reservation.quote.id !== input.quoteId ||
      entry.reservation.quote.quoteRevision !== input.quoteRevision
    ) {
      throw new StudioPreparedPhotoCacheErrorV3('quote_not_found');
    }
    if (entry.claimedBy !== null) throw new StudioPreparedPhotoCacheErrorV3('quote_in_use');
    const claim = Object.freeze({ reservation: entry.reservation });
    entry.claimedBy = claim;
    this.#claimEntries.set(claim, entry);
    return claim;
  }

  release(claim: StudioPreparedPhotoClaimV3): void {
    const entry = this.#activeClaim(claim);
    if (entry === null) return;
    entry.claimedBy = null;
    this.#claimEntries.delete(claim);
    if (entry.expired || this.#closed) this.#remove(entry, false);
    this.#notify(entry.reservation.projectId);
  }

  consume(claim: StudioPreparedPhotoClaimV3): void {
    const entry = this.#activeClaim(claim);
    if (entry === null) return;
    this.#claimEntries.delete(claim);
    this.#remove(entry, true);
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    const projects = new Set([...this.#entries].map((entry) => entry.reservation.projectId));
    for (const entry of this.#entries) {
      if (entry.claimedBy !== null) this.#claimEntries.delete(entry.claimedBy);
    }
    this.#entries.clear();
    this.#reservations.clear();
    for (const projectId of projects) this.#notify(projectId);
  }

  #assertOpen(): void {
    if (this.#closed) throw new Error('prepared_photo_cache_closed');
  }

  #notify(projectId: string): void {
    try {
      this.#onChange(projectId);
    } catch {
      // Activity delivery is best-effort and can never roll back cache authority.
    }
  }

  #readClock(): number {
    const now = this.#now();
    if (!Number.isSafeInteger(now)) throw new Error('invalid_prepared_photo_cache_clock');
    try {
      new Date(now).toISOString();
    } catch {
      throw new Error('invalid_prepared_photo_cache_clock');
    }
    return now;
  }

  #activeClaim(claim: StudioPreparedPhotoClaimV3): PreparedPhotoEntryV3 | null {
    const entry = this.#claimEntries.get(claim);
    return entry?.claimedBy === claim ? entry : null;
  }

  #expire(now: number): void {
    const changed = new Set<string>();
    for (const entry of this.#entries) {
      if (entry.expired || now < entry.expiresAtMs) continue;
      entry.expired = true;
      this.#reservations.delete(entry.reservation.reservationId);
      changed.add(entry.reservation.projectId);
      if (entry.claimedBy === null) this.#remove(entry, false);
    }
    for (const projectId of changed) this.#notify(projectId);
  }

  #oldestIdle(entries: readonly PreparedPhotoEntryV3[]): PreparedPhotoEntryV3 | undefined {
    return entries.filter((entry) => entry.claimedBy === null).toSorted(comparePreparedPhotosV3)[0];
  }

  #planEvictions(projectId: string, byteSize: number): PreparedPhotoEntryV3[] | null {
    const remaining = [...this.#entries];
    const victims: PreparedPhotoEntryV3[] = [];
    const removeVictim = (victim: PreparedPhotoEntryV3): void => {
      remaining.splice(remaining.indexOf(victim), 1);
      victims.push(victim);
    };
    while (true) {
      const projectEntries = remaining.filter((entry) => entry.reservation.projectId === projectId);
      const projectBytes = projectEntries.reduce((total, entry) => total + entry.byteSize, 0);
      if (
        projectEntries.length + 1 <= STUDIO_MAX_PREPARED_QUOTE_SESSIONS_PER_PROJECT &&
        projectBytes + byteSize <= STUDIO_MAX_PREPARED_QUOTE_CACHE_BYTES_PER_PROJECT
      ) {
        break;
      }
      const victim = this.#oldestIdle(projectEntries);
      if (victim === undefined) return null;
      removeVictim(victim);
    }
    while (true) {
      const globalBytes = remaining.reduce((total, entry) => total + entry.byteSize, 0);
      if (
        remaining.length + 1 <= STUDIO_MAX_PREPARED_QUOTE_SESSIONS_GLOBAL &&
        globalBytes + byteSize <= STUDIO_MAX_PREPARED_QUOTE_CACHE_BYTES_GLOBAL
      ) {
        return victims;
      }
      const victim = this.#oldestIdle(remaining);
      if (victim === undefined) return null;
      removeVictim(victim);
    }
  }

  #remove(entry: PreparedPhotoEntryV3, notify: boolean): void {
    if (this.#reservations.get(entry.reservation.reservationId) === entry) {
      this.#reservations.delete(entry.reservation.reservationId);
    }
    this.#entries.delete(entry);
    entry.claimedBy = null;
    if (notify) this.#notify(entry.reservation.projectId);
  }
}
