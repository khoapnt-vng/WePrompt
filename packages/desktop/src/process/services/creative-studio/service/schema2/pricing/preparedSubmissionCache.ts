/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  STUDIO_MAX_PREPARED_QUOTE_CACHE_BYTES_GLOBAL,
  STUDIO_MAX_PREPARED_QUOTE_CACHE_BYTES_PER_PROJECT,
  STUDIO_MAX_PREPARED_QUOTE_SESSION_BYTES,
  STUDIO_MAX_PREPARED_QUOTE_SESSIONS_GLOBAL,
  STUDIO_MAX_PREPARED_QUOTE_SESSIONS_PER_PROJECT,
  STUDIO_PREPARED_QUOTE_TTL_SECONDS,
  type StudioCancellationPolicy,
  type StudioPreparedSubmissionOptionsV2,
  type StudioPrepareSubmissionRequestV2,
  type StudioSpendAuthorization,
  type StudioSubmissionCacheErrorCodeV2,
  type StudioSubmissionQuote,
} from '@/common/types/project/creativeStudioTypes';

const SAFE_ID = /^[A-Za-z0-9_-]{1,256}$/;

export type StudioPreparedSubmissionSessionV2 = {
  preparedAt: string;
  request: StudioPrepareSubmissionRequestV2;
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

const validateSession = (session: StudioPreparedSubmissionSessionV2, expectedExpiresAt: string): void => {
  const { request, options, providerBindings, cancellationPolicies } = session;
  const baseOnly = options.baseOnly;
  const withCascade = options.withCascade;
  if (
    !SAFE_ID.test(request.projectId) ||
    !Number.isSafeInteger(request.expectedRevision) ||
    request.expectedRevision < 1 ||
    !isDenseArray(request.baseChoices) ||
    !isDenseArray(request.cascadeChoices) ||
    !SAFE_ID.test(baseOnly.id) ||
    baseOnly.projectId !== request.projectId ||
    baseOnly.projectRevision !== request.expectedRevision ||
    baseOnly.originReferenceHandoffId !== request.originReferenceHandoffId ||
    baseOnly.expiresAt !== expectedExpiresAt ||
    baseOnly.cascadeItems.length !== 0 ||
    !canonicalTimestamp(baseOnly.expiresAt)
  ) {
    return invariant('base_option_mismatch');
  }

  if (request.cascadeChoices.length === 0 && withCascade !== null) {
    return invariant('cascade_option_presence');
  }
  if (
    withCascade !== null &&
    (!SAFE_ID.test(withCascade.id) ||
      withCascade.id === baseOnly.id ||
      withCascade.projectId !== request.projectId ||
      withCascade.projectRevision !== request.expectedRevision ||
      withCascade.originReferenceHandoffId !== request.originReferenceHandoffId ||
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
