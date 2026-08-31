/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomBytes } from 'node:crypto';
import { types as nodeTypes } from 'node:util';

export const STUDIO_DELETION_CLAIM_TTL_MS_V3 = 5 * 60 * 1_000;
export const STUDIO_MAX_DELETION_CLAIMS_V3 = 64;

export type StudioUnreadableProjectClassificationV3 = 'unsupported' | 'quarantined';
export type StudioObservedProjectClassificationV3 = StudioUnreadableProjectClassificationV3 | 'healthy' | 'missing';

export type StudioProjectDirectoryIdentityV3 = {
  dev: string;
  ino: string;
};

export type StudioProjectDeletionObservationV3 = {
  catalogueId: string;
  classification: StudioObservedProjectClassificationV3;
  directoryIdentity: StudioProjectDirectoryIdentityV3 | null;
  manifestFingerprint: string | null;
};

export type StudioUnreadableProjectDeletionObservationV3 = StudioProjectDeletionObservationV3 & {
  classification: StudioUnreadableProjectClassificationV3;
  directoryIdentity: StudioProjectDirectoryIdentityV3;
  manifestFingerprint: string;
};

export type StudioIssuedDeletionClaimV3 = {
  deletionClaim: string;
  expiresAt: string;
};

export type StudioDeletionClaimErrorCodeV3 =
  | 'invalid_observation'
  | 'claim_not_found'
  | 'claim_expired'
  | 'claim_mismatch'
  | 'claim_capacity';

export class StudioDeletionClaimErrorV3 extends Error {
  readonly code: StudioDeletionClaimErrorCodeV3;

  constructor(code: StudioDeletionClaimErrorCodeV3) {
    super(code);
    this.name = 'StudioDeletionClaimErrorV3';
    this.code = code;
  }
}

const fail = (code: StudioDeletionClaimErrorCodeV3): never => {
  throw new StudioDeletionClaimErrorV3(code);
};

const SAFE_ID = /^[A-Za-z0-9_-]{1,256}$/;
const DECIMAL_IDENTITY = /^(?:0|[1-9][0-9]*)$/;
const LOWERCASE_SHA256 = /^[a-f0-9]{64}$/;
const CLAIM_TOKEN = /^studio-delete-v3_[A-Za-z0-9_-]{32,256}$/;
const OBSERVATION_KEYS = new Set(['catalogueId', 'classification', 'directoryIdentity', 'manifestFingerprint']);
const IDENTITY_KEYS = new Set(['dev', 'ino']);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !nodeTypes.isProxy(value) && !Array.isArray(value);

const hasExactKeys = (value: Record<string, unknown>, keys: ReadonlySet<string>): boolean => {
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== keys.size) return false;
  for (const key of ownKeys) {
    if (typeof key !== 'string' || !keys.has(key)) return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) return false;
  }
  return true;
};

const isDirectoryIdentity = (value: unknown): value is StudioProjectDirectoryIdentityV3 =>
  isRecord(value) &&
  hasExactKeys(value, IDENTITY_KEYS) &&
  typeof value.dev === 'string' &&
  DECIMAL_IDENTITY.test(value.dev) &&
  typeof value.ino === 'string' &&
  DECIMAL_IDENTITY.test(value.ino);

const isObservation = (value: unknown): value is StudioProjectDeletionObservationV3 => {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, OBSERVATION_KEYS) ||
    typeof value.catalogueId !== 'string' ||
    !SAFE_ID.test(value.catalogueId)
  ) {
    return false;
  }
  if (
    value.classification !== 'unsupported' &&
    value.classification !== 'quarantined' &&
    value.classification !== 'healthy' &&
    value.classification !== 'missing'
  ) {
    return false;
  }
  if (value.classification === 'missing') {
    return value.directoryIdentity === null && value.manifestFingerprint === null;
  }
  return (
    isDirectoryIdentity(value.directoryIdentity) &&
    typeof value.manifestFingerprint === 'string' &&
    LOWERCASE_SHA256.test(value.manifestFingerprint)
  );
};

const isUnreadableObservation = (value: unknown): value is StudioUnreadableProjectDeletionObservationV3 =>
  isObservation(value) && (value.classification === 'unsupported' || value.classification === 'quarantined');

const sameObservation = (
  issued: StudioUnreadableProjectDeletionObservationV3,
  current: StudioProjectDeletionObservationV3
): boolean =>
  current.classification === issued.classification &&
  current.catalogueId === issued.catalogueId &&
  current.directoryIdentity !== null &&
  current.directoryIdentity.dev === issued.directoryIdentity.dev &&
  current.directoryIdentity.ino === issued.directoryIdentity.ino &&
  current.manifestFingerprint === issued.manifestFingerprint;

type StoredClaim = {
  observation: StudioUnreadableProjectDeletionObservationV3;
  issuedAtMs: number;
  expiresAtMs: number;
};

export type StudioDeletionClaimCacheOptionsV3 = {
  now?: () => number;
  createToken?: () => string;
  ttlMs?: number;
  maximumClaims?: number;
};

export type StudioDeletionClaimCacheV3 = {
  issue(observation: StudioUnreadableProjectDeletionObservationV3): StudioIssuedDeletionClaimV3;
  /** Consumes the claim whether the current observation matches or not. */
  consume(deletionClaim: string, current: StudioProjectDeletionObservationV3): void;
  clear(): void;
  readonly size: number;
};

const defaultToken = (): string => `studio-delete-v3_${randomBytes(24).toString('base64url')}`;

/**
 * Creates an in-memory, bounded claim cache. Only its opaque token and expiry cross to renderer;
 * directory identity and manifest fingerprint remain in Main.
 */
export const createStudioDeletionClaimCacheV3 = (
  options: StudioDeletionClaimCacheOptionsV3 = {}
): StudioDeletionClaimCacheV3 => {
  const now = options.now ?? Date.now;
  const createToken = options.createToken ?? defaultToken;
  const ttlMs = options.ttlMs ?? STUDIO_DELETION_CLAIM_TTL_MS_V3;
  const maximumClaims = options.maximumClaims ?? STUDIO_MAX_DELETION_CLAIMS_V3;
  if (
    !Number.isSafeInteger(ttlMs) ||
    ttlMs < 1 ||
    ttlMs > STUDIO_DELETION_CLAIM_TTL_MS_V3 ||
    !Number.isSafeInteger(maximumClaims) ||
    maximumClaims < 1 ||
    maximumClaims > STUDIO_MAX_DELETION_CLAIMS_V3
  ) {
    throw new TypeError('Invalid Studio deletion-claim cache bounds');
  }

  const claims = new Map<string, StoredClaim>();
  const readNow = (): number => {
    const value = now();
    if (!Number.isSafeInteger(value) || value < 0) throw new TypeError('Invalid Studio deletion-claim clock');
    return value;
  };
  const purgeExpired = (atMs: number): void => {
    for (const [claim, stored] of claims) {
      if (stored.expiresAtMs <= atMs) claims.delete(claim);
    }
  };

  return {
    issue(observation) {
      if (!isUnreadableObservation(observation)) return fail('invalid_observation');
      const atMs = readNow();
      purgeExpired(atMs);
      if (claims.size >= maximumClaims) return fail('claim_capacity');

      let deletionClaim: string | null = null;
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const candidate = createToken();
        if (typeof candidate === 'string' && CLAIM_TOKEN.test(candidate) && !claims.has(candidate)) {
          deletionClaim = candidate;
          break;
        }
      }
      if (deletionClaim === null) return fail('claim_capacity');
      const expiresAtMs = atMs + ttlMs;
      if (!Number.isSafeInteger(expiresAtMs) || !Number.isFinite(new Date(expiresAtMs).getTime())) {
        return fail('claim_capacity');
      }
      claims.set(deletionClaim, {
        observation: structuredClone(observation),
        issuedAtMs: atMs,
        expiresAtMs,
      });
      return { deletionClaim, expiresAt: new Date(expiresAtMs).toISOString() };
    },

    consume(deletionClaim, current) {
      if (typeof deletionClaim !== 'string' || !CLAIM_TOKEN.test(deletionClaim)) return fail('claim_not_found');
      const atMs = readNow();
      const stored = claims.get(deletionClaim);
      if (stored === undefined) return fail('claim_not_found');
      // Consume before reclassification and identity comparison so a failed probe cannot be replayed.
      claims.delete(deletionClaim);
      if (atMs < stored.issuedAtMs || stored.expiresAtMs <= atMs) return fail('claim_expired');
      if (!isObservation(current) || !sameObservation(stored.observation, current)) {
        return fail('claim_mismatch');
      }
    },

    clear() {
      claims.clear();
    },

    get size() {
      return claims.size;
    },
  };
};
