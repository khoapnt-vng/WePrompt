/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash, randomUUID as createRandomUUID, timingSafeEqual } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { PRESENTATION_RUN_DISPATCH_STATUSES, PRESENTATION_RUN_LIMITS } from '@/common/config/constants';
import type { PresentationReadinessEvidence } from '@/common/types/office/artifactReadiness';
import type {
  PresentationGrantOwner,
  PresentationRunFailure,
  PresentationSourceDescriptor,
  PresentationSourceRef,
} from '@/common/types/office/presentationRun';
import {
  PresentationRunSimulatedProcessCrashError,
  type PreparedPresentationRunAssets,
  type PreparedPresentationSourceSnapshot,
  type PresentationRunFiles,
} from './presentationRunFiles';
import {
  PresentationCanonicalCorruptionError,
  PresentationJournalRecoveryRequiredError,
  PresentationJournalTransactionError,
  type PresentationRunJournal,
} from './presentationRunJournal';
import {
  assertPresentationRunManifestState,
  assertPresentationRunPreparationRecord,
  assertPresentationSourceDraftManifest,
  assertPresentationSourceDraftTombstone,
  assertPresentationSourceGrantManifest,
  assertPresentationSourceGrantTombstone,
  assertPresentationSourceOwnerManifest,
  bindPresentationRunTurn,
  hasExactPresentationTerminalEvidence,
  transitionPresentationRunState,
  type BindPresentationRunTurnInput,
  type PresentationInitialDispatchLease,
  type PresentationRunReadiness,
  type PresentationRunTerminalEvidence,
  type PresentationRunManifest,
  type PresentationRunTransition,
  type PresentationSourceDraftManifest,
  type PresentationSourceDraftTombstone,
  type PresentationSourceGrantManifest,
  type PresentationSourceGrantTombstone,
  type PresentationSourceOwnerManifest,
} from './presentationRunStateMachine';

type LockWaiter = { resolve: (release: () => void) => void };

class KeyMutex {
  private locked = false;
  private readonly waiters: LockWaiter[] = [];

  async acquire(): Promise<() => void> {
    if (!this.locked) {
      this.locked = true;
      return this.release;
    }
    return new Promise<() => void>((resolve) => this.waiters.push({ resolve }));
  }

  get idle(): boolean {
    return !this.locked && this.waiters.length === 0;
  }

  private readonly release = (): void => {
    const next = this.waiters.shift();
    if (next !== undefined) {
      next.resolve(this.release);
      return;
    }
    this.locked = false;
  };
}

/** Acquires every requested key once and in lexical order. */
export class SortedKeyedLock {
  private readonly mutexes = new Map<string, KeyMutex>();

  constructor(private readonly onAcquire?: (sortedKeys: readonly string[]) => void) {}

  async runExclusive<T>(keys: readonly string[], operation: () => Promise<T>): Promise<T> {
    const sortedKeys = [...new Set(keys)].toSorted();
    this.onAcquire?.(sortedKeys);
    const acquired: { key: string; mutex: KeyMutex; release: () => void }[] = [];
    try {
      for (const key of sortedKeys) {
        const mutex = this.mutexes.get(key) ?? new KeyMutex();
        this.mutexes.set(key, mutex);
        acquired.push({ key, mutex, release: await mutex.acquire() });
      }
      return await operation();
    } finally {
      for (const lock of acquired.toReversed()) {
        lock.release();
        if (lock.mutex.idle && this.mutexes.get(lock.key) === lock.mutex) this.mutexes.delete(lock.key);
      }
    }
  }
}

export type StoredPresentationRunManifest = PresentationRunManifest & {
  requestFingerprint: string;
  postAllocationFailure: PresentationRunFailure | null;
};

export type StoredPresentationRunTombstone = {
  version: 2;
  tombstoneType: 'presentation-run';
  revision: 0;
  runId: string;
  tombstonedAt: string;
  discardedRun: StoredPresentationRunManifest;
};

export type PresentationRunSweepResult = {
  failedRetained: string[];
  tombstoned: string[];
  purgedTombstones: string[];
  operatorAlerts: string[];
};

export type StoredPresentationGrantManifest = {
  version: 2;
  grantId: string;
  ownerKey: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  state: 'active' | 'claimed' | 'consumed' | 'revoked' | 'expired';
  byteLength: number;
  claimedRunId: string | null;
};

export type StoredPresentationSourceOwnerManifest = PresentationSourceOwnerManifest;
export type StoredPresentationSourceGrantManifest = PresentationSourceGrantManifest;
export type StoredPresentationSourceDraftManifest = PresentationSourceDraftManifest;
export type StoredPresentationSourceGrantTombstone = PresentationSourceGrantTombstone;
export type StoredPresentationSourceDraftTombstone = PresentationSourceDraftTombstone;

export type PresentationSourceStoreFailureCode =
  | 'INVALID_REQUEST'
  | 'RUN_FORBIDDEN'
  | 'DRAFT_NOT_FOUND'
  | 'DRAFT_EXPIRED'
  | 'DRAFT_FOREIGN'
  | 'DRAFT_ALREADY_BOUND'
  | 'DRAFT_LIMIT_EXCEEDED'
  | 'GRANT_LIMIT_EXCEEDED'
  | 'SOURCE_GRANT_INVALID'
  | 'SOURCE_GRANT_EXPIRED'
  | 'SOURCE_GRANT_FOREIGN'
  | 'SOURCE_GRANT_REPLAYED'
  | 'SOURCE_TAMPERED'
  | 'SOURCE_LIMIT_EXCEEDED'
  | 'PERSISTENCE_FAILED';

export class PresentationSourceStoreError extends Error {
  constructor(
    readonly code: PresentationSourceStoreFailureCode,
    readonly details: { draftId?: string; conversationId?: string; grantId?: string } = {},
    options?: ErrorOptions
  ) {
    super(code, options);
  }
}

export class PresentationRunStoreError extends Error {
  constructor(
    readonly code:
      | 'RESOURCE_LIMIT_EXCEEDED'
      | 'RUN_STATE_CONFLICT'
      | 'LEASE_CONFLICT'
      | 'LEASE_EXPIRED'
      | 'LEASE_FOREIGN'
  ) {
    super(code);
    this.name = 'PresentationRunStoreError';
  }
}

export type PresentationSourceOwnerSnapshot = {
  owner: PresentationGrantOwner;
  ownerRevision: number;
  grants: StoredPresentationSourceGrantManifest[];
};

export type ConfirmQueuedPresentationSourcesStoreResult = PresentationSourceOwnerSnapshot & {
  status: 'confirmed' | 'already_confirmed';
  expiresAt: string;
};

export type CreatePresentationSourceDraftStoreResult = {
  status: 'created' | 'existing';
  draft: StoredPresentationSourceDraftManifest;
};

export type BindPresentationSourceDraftStoreResult = {
  status: 'bound' | 'already_bound';
  draftId: string;
  conversationId: string;
  revision: number;
  boundAt: string;
};

export type PresentationSourceGrantCreateInput = {
  grantId: string;
  displayName: string;
  format: PresentationSourceDescriptor['format'];
  sourceKind: PresentationSourceDescriptor['sourceKind'];
  snapshotRelativePath: `source.${PresentationSourceDescriptor['format']}`;
  sha256: string;
  byteLength: number;
  preparedSnapshot: PreparedPresentationSourceSnapshot;
};

export type PresentationSourceSweepResult = {
  expiredDrafts: string[];
  expiredGrants: string[];
  purgedDraftTombstones: string[];
  purgedGrantTombstones: string[];
};

export type PresentationRunGrantClaim =
  | {
      grantId: string;
      expectedRevision: number;
    }
  | {
      grantId: string;
      expectedByteLength: number;
      expectedSha256: string;
    };

export type ClaimedPresentationSourceSnapshot = Pick<
  PresentationSourceDescriptor,
  'grantId' | 'displayName' | 'format' | 'sourceKind' | 'byteLength' | 'sha256'
> & {
  snapshotRelativePath: `source.${PresentationSourceDescriptor['format']}`;
};

export type AllocatePresentationRunInput = {
  conversationId: string;
  clientRequestId: string;
  selectedTemplateId: string;
  requestFingerprint: string;
  /** Required by the public hash/length claim path to bind grants to current authority. */
  principalId?: string;
  grantClaims: readonly PresentationRunGrantClaim[];
};

export type AllocatePresentationRunResult =
  | { ok: true; status: 'created' | 'existing'; run: StoredPresentationRunManifest }
  | PresentationRunFailure;

export type ClaimInitialPresentationDispatchInput = {
  runId: string;
  conversationId: string;
  holderId: string;
  expectedRevision: number;
};

export type RenewInitialPresentationDispatchInput = {
  runId: string;
  conversationId: string;
  leaseToken: string;
  expectedRevision: number;
};

export type MatchInitialPresentationDispatchLeaseInput = RenewInitialPresentationDispatchInput;

type PresentationRunIndex = {
  version: 1;
  requests: Record<string, string>;
  conversations: Record<string, string[]>;
  turns: Record<string, string>;
  grants: Record<string, string>;
  sourceOwners: Record<string, string>;
  draftRequests: Record<string, string>;
};

type PresentationRunStoreOptions = {
  files: PresentationRunFiles;
  journal: PresentationRunJournal;
  lock?: SortedKeyedLock;
  now?: () => Date;
  randomUUID?: () => string;
  getFreeDiskBytes: () => Promise<number>;
};

type TokenBucket = {
  tokens: number;
  updatedAtMs: number;
};

const createIndexRecord = <Value>(): Record<string, Value> => Object.create(null) as Record<string, Value>;

const getOwnIndexValue = <Value>(record: Record<string, Value>, key: string): Value | undefined =>
  Object.hasOwn(record, key) ? record[key] : undefined;

const createEmptyIndex = (): PresentationRunIndex => ({
  version: 1,
  requests: createIndexRecord<string>(),
  conversations: createIndexRecord<string[]>(),
  turns: createIndexRecord<string>(),
  grants: createIndexRecord<string>(),
  sourceOwners: createIndexRecord<string>(),
  draftRequests: createIndexRecord<string>(),
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REQUEST_FINGERPRINT_RE = /^[0-9a-f]{64}$/;
const REQUEST_FINGERPRINT_INPUT_RE = /^[0-9a-f]{64}$/i;
const PREDISPATCH_STATUSES = new Set<StoredPresentationRunManifest['dispatchStatus']>(['allocating', 'committed']);
const LIVE_GENERATION_STATUSES = new Set<StoredPresentationRunManifest['dispatchStatus']>([
  'dispatching',
  'bound',
  'terminal_verified',
  'dispatch_uncertain',
]);
const RETAINED_STATUSES = new Set<StoredPresentationRunManifest['dispatchStatus']>(['retained', 'failed_retained']);
const INITIAL_DISPATCH_LEASE_MS = 30_000;
const RUNTIME_RELEASE_CONFIRMATION_MS = 30_000;
const CURRENT_LIFECYCLE_KEYS = [
  'initialDispatchLease',
  'terminalEvidence',
  'runtimeReleaseObservations',
  'retentionProof',
  'readiness',
] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const hasExactKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean => {
  const expected = [...keys].toSorted();
  const actual = Object.keys(value).toSorted();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
};

function currentLifecycleManifest(run: StoredPresentationRunManifest): StoredPresentationRunManifest {
  return {
    ...run,
    preparation: run.preparation ?? null,
    initialDispatchLease: run.initialDispatchLease ?? null,
    terminalEvidence: run.terminalEvidence ?? null,
    runtimeReleaseObservations: [...(run.runtimeReleaseObservations ?? [])],
    retentionProof: run.retentionProof ?? null,
    readiness: run.readiness ?? null,
  };
}

function hasExactLegacyNullableBinding(run: StoredPresentationRunManifest): boolean {
  return run.binding?.runtime === null && CURRENT_LIFECYCLE_KEYS.every((key) => !Object.hasOwn(run, key));
}

function isLegacyRuntimeReleaseFallback(run: StoredPresentationRunManifest): boolean {
  return (
    run.dispatchStatus === 'dispatch_uncertain' &&
    run.disposition === 'TRACKING_REQUIRED' &&
    run.binding === null &&
    run.retainedCandidate === null &&
    run.initialDispatchLease === null &&
    run.terminalEvidence === null &&
    run.runtimeReleaseObservations?.length === 1 &&
    run.retentionProof === null &&
    run.readiness === null &&
    CURRENT_LIFECYCLE_KEYS.every((key) => Object.hasOwn(run, key))
  );
}

function sameCapability(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function isLegacyPresentationRunGrantClaim(
  value: unknown
): value is Extract<PresentationRunGrantClaim, { expectedRevision: number }> {
  return (
    isRecord(value) &&
    hasExactKeys(value, ['grantId', 'expectedRevision']) &&
    typeof value.grantId === 'string' &&
    UUID_RE.test(value.grantId) &&
    Number.isSafeInteger(value.expectedRevision) &&
    (value.expectedRevision as number) >= 0
  );
}

function isIntegrityPresentationRunGrantClaim(
  value: unknown
): value is Extract<PresentationRunGrantClaim, { expectedByteLength: number }> {
  return (
    isRecord(value) &&
    hasExactKeys(value, ['grantId', 'expectedByteLength', 'expectedSha256']) &&
    typeof value.grantId === 'string' &&
    UUID_RE.test(value.grantId) &&
    Number.isSafeInteger(value.expectedByteLength) &&
    (value.expectedByteLength as number) >= 1 &&
    (value.expectedByteLength as number) <= PRESENTATION_RUN_LIMITS.MAX_SOURCE_BYTES &&
    typeof value.expectedSha256 === 'string' &&
    /^[0-9a-f]{64}$/.test(value.expectedSha256)
  );
}

function isPresentationRunGrantClaim(value: unknown): value is PresentationRunGrantClaim {
  return isLegacyPresentationRunGrantClaim(value) || isIntegrityPresentationRunGrantClaim(value);
}

const isNonnegativeInteger = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;

const isIsoTimestamp = (value: unknown): value is string => {
  if (typeof value !== 'string') return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
};

const GRANT_STATES: ReadonlySet<StoredPresentationGrantManifest['state']> = new Set([
  'active',
  'claimed',
  'consumed',
  'revoked',
  'expired',
]);

function isStructurallyValidGrant(value: unknown, expectedGrantId: string): value is StoredPresentationGrantManifest {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'version',
      'grantId',
      'ownerKey',
      'revision',
      'createdAt',
      'updatedAt',
      'expiresAt',
      'state',
      'byteLength',
      'claimedRunId',
    ]) ||
    value.version !== 2 ||
    value.grantId !== expectedGrantId ||
    !UUID_RE.test(expectedGrantId) ||
    typeof value.ownerKey !== 'string' ||
    !/^(?:conversation|draft):.{1,256}$/.test(value.ownerKey) ||
    !isNonnegativeInteger(value.revision) ||
    !isIsoTimestamp(value.createdAt) ||
    !isIsoTimestamp(value.updatedAt) ||
    !isIsoTimestamp(value.expiresAt) ||
    !GRANT_STATES.has(value.state as StoredPresentationGrantManifest['state']) ||
    !isNonnegativeInteger(value.byteLength) ||
    (value.claimedRunId !== null && (typeof value.claimedRunId !== 'string' || !UUID_RE.test(value.claimedRunId)))
  ) {
    return false;
  }
  const grant = value as StoredPresentationGrantManifest;
  if (
    Date.parse(grant.updatedAt) < Date.parse(grant.createdAt) ||
    Date.parse(grant.expiresAt) < Date.parse(grant.createdAt)
  ) {
    return false;
  }
  if (grant.state === 'active') return grant.claimedRunId === null;
  if (grant.state === 'claimed' || grant.state === 'consumed') return grant.claimedRunId !== null;
  return true;
}

function isStructurallyValidSourceGrant(
  value: unknown,
  expectedGrantId: string
): value is StoredPresentationSourceGrantManifest {
  if (!isRecord(value) || value.grantId !== expectedGrantId || value.recordType !== 'presentation-source-grant') {
    return false;
  }
  try {
    assertPresentationSourceGrantManifest(value as StoredPresentationSourceGrantManifest);
    return true;
  } catch {
    return false;
  }
}

function isStoredPresentationSourceGrantManifest(
  value: StoredPresentationGrantManifest | StoredPresentationSourceGrantManifest
): value is StoredPresentationSourceGrantManifest {
  return 'recordType' in value && value.recordType === 'presentation-source-grant';
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function frozenSnapshot<T>(value: T): T {
  return deepFreeze(structuredClone(value));
}

const FAILURE_RULES: Record<string, { states: readonly string[]; retryable: boolean }> = {
  FEATURE_DISABLED: { states: ['preflight'], retryable: false },
  DESKTOP_REQUIRED: { states: ['preflight'], retryable: false },
  INVALID_REQUEST: { states: ['preflight'], retryable: false },
  REQUEST_COLLISION: { states: ['lookup'], retryable: false },
  RUN_NOT_FOUND: { states: ['lookup'], retryable: false },
  RUN_FORBIDDEN: { states: ['lookup'], retryable: false },
  RUN_STATE_CONFLICT: { states: ['lookup'], retryable: false },
  DRAFT_NOT_FOUND: { states: ['lookup'], retryable: false },
  DRAFT_EXPIRED: { states: ['draft_expired'], retryable: false },
  DRAFT_FOREIGN: { states: ['lookup'], retryable: false },
  DRAFT_ALREADY_BOUND: { states: ['draft_active'], retryable: false },
  DRAFT_LIMIT_EXCEEDED: { states: ['preflight'], retryable: false },
  GRANT_LIMIT_EXCEEDED: { states: ['preflight'], retryable: false },
  NATIVE_FILE_REQUIRED: { states: ['preflight'], retryable: false },
  DIALOG_UNAVAILABLE: { states: ['preflight'], retryable: false },
  LEASE_CONFLICT: { states: ['committed'], retryable: false },
  LEASE_EXPIRED: { states: ['committed'], retryable: false },
  LEASE_FOREIGN: { states: ['committed'], retryable: false },
  SCOPE_UNAVAILABLE: { states: ['preflight'], retryable: false },
  TEAM_SCOPE_UNSUPPORTED: { states: ['preflight'], retryable: false },
  RUNTIME_UNSUPPORTED: { states: ['preflight'], retryable: false },
  SOURCE_GRANT_INVALID: { states: ['grant_validation'], retryable: false },
  SOURCE_GRANT_EXPIRED: { states: ['grant_expired'], retryable: false },
  SOURCE_GRANT_FOREIGN: { states: ['grant_validation'], retryable: false },
  SOURCE_GRANT_REPLAYED: { states: ['grant_validation'], retryable: false },
  SOURCE_TAMPERED: { states: ['grant_validation'], retryable: false },
  SOURCE_LIMIT_EXCEEDED: { states: ['grant_validation'], retryable: false },
  SOURCE_FORMAT_UNSUPPORTED: { states: ['grant_validation'], retryable: false },
  TEMPLATE_NOT_FOUND: { states: ['preflight'], retryable: false },
  TEMPLATE_UNSUPPORTED: { states: ['preflight'], retryable: false },
  RESOURCE_LIMIT_EXCEEDED: { states: ['preflight'], retryable: false },
  RATE_LIMITED: { states: ['preflight'], retryable: true },
  DISK_RESERVE_EXCEEDED: { states: ['preflight'], retryable: false },
  PERSISTENCE_FAILED: { states: ['preflight', 'committed'], retryable: false },
  BACKEND_PREFLIGHT_BLOCKED: { states: ['committed'], retryable: true },
  DISPATCH_UNCERTAIN: { states: ['dispatch_uncertain'], retryable: false },
  TRACKING_REQUIRED: { states: ['bound', 'retained'], retryable: false },
  CANDIDATE_UNAVAILABLE: { states: ['retained'], retryable: false },
  HASH_MISMATCH: { states: ['retained'], retryable: false },
  UNSAFE_TO_OPEN: { states: ['committed', 'dispatching', 'bound', 'dispatch_uncertain', 'retained'], retryable: false },
  UNSAFE_TO_DISCARD: {
    states: ['committed', 'dispatching', 'bound', 'dispatch_uncertain', 'retained'],
    retryable: false,
  },
  INTERNAL_ERROR: { states: ['preflight'], retryable: false },
};

function hasIdDetails(details: unknown, key: string, extras: Record<string, unknown> = {}): boolean {
  if (!isRecord(details) || typeof details[key] !== 'string') return false;
  return (
    hasExactKeys(details, [key, ...Object.keys(extras)]) &&
    Object.entries(extras).every(([extraKey, expected]) => details[extraKey] === expected)
  );
}

function isFailureDetails(code: string, details: unknown): boolean {
  if (
    [
      'FEATURE_DISABLED',
      'DESKTOP_REQUIRED',
      'INVALID_REQUEST',
      'RUN_NOT_FOUND',
      'RUN_FORBIDDEN',
      'DRAFT_NOT_FOUND',
      'DRAFT_FOREIGN',
      'DRAFT_LIMIT_EXCEEDED',
      'GRANT_LIMIT_EXCEEDED',
      'NATIVE_FILE_REQUIRED',
      'DIALOG_UNAVAILABLE',
      'SCOPE_UNAVAILABLE',
      'TEAM_SCOPE_UNSUPPORTED',
      'RUNTIME_UNSUPPORTED',
      'TEMPLATE_NOT_FOUND',
      'TEMPLATE_UNSUPPORTED',
      'RESOURCE_LIMIT_EXCEEDED',
      'DISK_RESERVE_EXCEEDED',
      'INTERNAL_ERROR',
    ].includes(code)
  ) {
    return details === null;
  }
  if (code === 'REQUEST_COLLISION') return hasIdDetails(details, 'existingRunId');
  if (code === 'DRAFT_EXPIRED') return hasIdDetails(details, 'draftId');
  if (code === 'DRAFT_ALREADY_BOUND') {
    return (
      isRecord(details) &&
      hasExactKeys(details, ['draftId', 'conversationId']) &&
      typeof details.draftId === 'string' &&
      typeof details.conversationId === 'string'
    );
  }
  if (code === 'RUN_STATE_CONFLICT') {
    return (
      isRecord(details) &&
      hasExactKeys(details, ['runId', 'dispatchStatus']) &&
      typeof details.runId === 'string' &&
      typeof details.dispatchStatus === 'string' &&
      (PRESENTATION_RUN_DISPATCH_STATUSES as readonly string[]).includes(details.dispatchStatus)
    );
  }
  if (code === 'SOURCE_GRANT_EXPIRED') return hasIdDetails(details, 'grantId');
  if (code.startsWith('SOURCE_')) {
    return (
      isRecord(details) &&
      Object.keys(details).every((key) => key === 'grantId') &&
      (details.grantId === undefined || typeof details.grantId === 'string')
    );
  }
  if (code === 'LEASE_CONFLICT') {
    return (
      isRecord(details) &&
      hasExactKeys(details, ['runId', 'leaseExpiresAt']) &&
      typeof details.runId === 'string' &&
      typeof details.leaseExpiresAt === 'string'
    );
  }
  if (code === 'LEASE_EXPIRED') return hasIdDetails(details, 'runId', { reclaimAllowed: true });
  if (
    code === 'LEASE_FOREIGN' ||
    code === 'TRACKING_REQUIRED' ||
    code === 'CANDIDATE_UNAVAILABLE' ||
    code === 'HASH_MISMATCH' ||
    code === 'UNSAFE_TO_OPEN' ||
    code === 'UNSAFE_TO_DISCARD'
  ) {
    return hasIdDetails(details, 'runId');
  }
  if (code === 'RATE_LIMITED') {
    return (
      isRecord(details) &&
      hasExactKeys(details, ['retryAfterMs', 'postInvoked']) &&
      isNonnegativeInteger(details.retryAfterMs) &&
      details.postInvoked === false
    );
  }
  if (code === 'BACKEND_PREFLIGHT_BLOCKED') {
    return (
      isRecord(details) &&
      hasExactKeys(details, ['runId', 'retryAfterMs', 'postInvoked']) &&
      typeof details.runId === 'string' &&
      isNonnegativeInteger(details.retryAfterMs) &&
      details.postInvoked === false
    );
  }
  if (code === 'PERSISTENCE_FAILED') {
    return isRecord(details) && hasExactKeys(details, ['postInvoked']) && details.postInvoked === false;
  }
  if (code === 'DISPATCH_UNCERTAIN') {
    return (
      isRecord(details) &&
      hasExactKeys(details, ['runId', 'postInvoked', 'queryRequired']) &&
      typeof details.runId === 'string' &&
      details.postInvoked === true &&
      details.queryRequired === true
    );
  }
  return false;
}

function isPresentationRunFailure(value: unknown): value is PresentationRunFailure {
  if (!isRecord(value) || !hasExactKeys(value, ['ok', 'code', 'messageKey', 'retryable', 'state', 'details'])) {
    return false;
  }
  const rule = typeof value.code === 'string' ? FAILURE_RULES[value.code] : undefined;
  return (
    rule !== undefined &&
    value.ok === false &&
    value.messageKey === `conversation.presentationRun.${value.code}` &&
    value.retryable === rule.retryable &&
    typeof value.state === 'string' &&
    rule.states.includes(value.state) &&
    isFailureDetails(value.code as string, value.details)
  );
}

const tupleIndexKey = (first: string, second: string): string => JSON.stringify([first, second]);

const requestIndexKey = (conversationId: string, clientRequestId: string): string =>
  tupleIndexKey(conversationId, clientRequestId);

const turnIndexKey = (conversationId: string, turnId: string): string => tupleIndexKey(conversationId, turnId);

const draftRequestIndexKey = (principalId: string, clientRequestId: string): string =>
  tupleIndexKey(principalId, clientRequestId);

export function presentationSourceOwnerKey(owner: PresentationGrantOwner): string {
  return owner.owner_type === 'conversation' ? `conversation:${owner.conversation_id}` : `draft:${owner.draft_id}`;
}

/** Produces a stable UUID-shaped canonical entity id without exposing an owner path. */
export function presentationSourceOwnerId(owner: PresentationGrantOwner): string {
  const hex = createHash('sha256')
    .update(`aionui:presentation-source-owner:${presentationSourceOwnerKey(owner)}`)
    .digest('hex')
    .slice(0, 32)
    .split('');
  hex[12] = '5';
  hex[16] = '8';
  const value = hex.join('');
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

const preflightFailure = <Code extends 'DISK_RESERVE_EXCEEDED' | 'RESOURCE_LIMIT_EXCEEDED'>(
  code: Code
): Extract<PresentationRunFailure, { code: Code }> =>
  ({
    ok: false,
    code,
    messageKey: `conversation.presentationRun.${code}`,
    retryable: false,
    state: 'preflight',
    details: null,
  }) as Extract<PresentationRunFailure, { code: Code }>;

const collisionFailure = (runId: string): Extract<PresentationRunFailure, { code: 'REQUEST_COLLISION' }> => ({
  ok: false,
  code: 'REQUEST_COLLISION',
  messageKey: 'conversation.presentationRun.REQUEST_COLLISION',
  retryable: false,
  state: 'lookup',
  details: { existingRunId: runId },
});

/** Serialized canonical store for presentation runs and their repairable indexes. */
export class PresentationRunStore {
  private readonly files: PresentationRunFiles;
  private readonly journal: PresentationRunJournal;
  private readonly lock: SortedKeyedLock;
  private readonly now: () => Date;
  private readonly randomUUID: () => string;
  private readonly getFreeDiskBytes: () => Promise<number>;
  private initialization: Promise<void> | null = null;
  private index: PresentationRunIndex = createEmptyIndex();
  private readonly runs = new Map<string, StoredPresentationRunManifest>();
  private readonly tombstones = new Map<string, StoredPresentationRunTombstone>();
  private readonly sourceOwners = new Map<string, StoredPresentationSourceOwnerManifest>();
  private readonly sourceGrants = new Map<string, StoredPresentationSourceGrantManifest>();
  private readonly sourceGrantTombstones = new Map<string, StoredPresentationSourceGrantTombstone>();
  private readonly sourceDrafts = new Map<string, StoredPresentationSourceDraftManifest>();
  private readonly sourceDraftTombstones = new Map<string, StoredPresentationSourceDraftTombstone>();
  private readonly conversationStartBuckets = new Map<string, TokenBucket>();
  private appStartBucket: TokenBucket | null = null;
  private storageHealthy = true;
  private indexRepairPending = false;

  constructor(options: PresentationRunStoreOptions) {
    this.files = options.files;
    this.journal = options.journal;
    this.lock = options.lock ?? new SortedKeyedLock();
    this.now = options.now ?? (() => new Date());
    this.randomUUID = options.randomUUID ?? createRandomUUID;
    this.getFreeDiskBytes = options.getFreeDiskBytes;
  }

  async initialize(): Promise<void> {
    this.initialization ??= this.initializeOnce();
    return this.initialization;
  }

  async getPresentationSourceOwner(
    owner: PresentationGrantOwner,
    principalId: string
  ): Promise<PresentationSourceOwnerSnapshot> {
    await this.initialize();
    this.assertStorageHealthy();
    await this.expirePresentationSourceOwnerIfNeeded(owner);
    const ownerId = presentationSourceOwnerId(owner);
    return this.lock.runExclusive(['store:health', `owner:${ownerId}`], async () => {
      this.assertStorageHealthy();
      const manifest = this.sourceOwners.get(ownerId);
      if (manifest === undefined) {
        if (owner.owner_type === 'conversation') return { owner, ownerRevision: 0, grants: [] };
        this.throwDraftLookupFailure(owner.draft_id, principalId);
      }
      if (manifest.principalId !== principalId) {
        throw new PresentationSourceStoreError(owner.owner_type === 'draft' ? 'DRAFT_FOREIGN' : 'RUN_FORBIDDEN');
      }
      if (owner.owner_type === 'draft') {
        if (manifest.draftLifecycle === 'expired') {
          throw new PresentationSourceStoreError('DRAFT_EXPIRED', { draftId: owner.draft_id });
        }
        if (manifest.draftLifecycle !== 'active') {
          throw new PresentationSourceStoreError('DRAFT_NOT_FOUND');
        }
      }
      const grants = manifest.grantIds.map((grantId) => {
        const grant = this.sourceGrants.get(grantId);
        if (
          grant === undefined ||
          grant.state !== 'active' ||
          presentationSourceOwnerKey(grant.owner) !== presentationSourceOwnerKey(owner)
        ) {
          throw new PresentationCanonicalCorruptionError('Presentation source owner references an invalid grant');
        }
        return frozenSnapshot(grant);
      });
      return { owner: structuredClone(owner), ownerRevision: manifest.revision, grants };
    });
  }

  async createPresentationSourceDraft(
    principalId: string,
    clientRequestId: string
  ): Promise<CreatePresentationSourceDraftStoreResult> {
    await this.initialize();
    this.assertStorageHealthy();
    const requestKey = draftRequestIndexKey(principalId, clientRequestId);
    return this.lock.runExclusive(['store:health', 'policy:app', `draft-request:${requestKey}`], async () => {
      this.assertStorageHealthy();
      const existingOwnerId = getOwnIndexValue(this.index.draftRequests, requestKey);
      if (existingOwnerId !== undefined) {
        const history = this.sourceOwners.get(existingOwnerId);
        if (history === undefined || history.owner.owner_type !== 'draft') {
          throw new PresentationCanonicalCorruptionError('Presentation draft request history is corrupt');
        }
        if (history.draftLifecycle === 'expired') {
          const tombstone = this.sourceDraftTombstones.get(history.owner.draft_id);
          if (tombstone !== undefined && Date.parse(tombstone.deleteAfter) > this.now().getTime()) {
            throw new PresentationSourceStoreError('DRAFT_EXPIRED', { draftId: history.owner.draft_id });
          }
          throw new PresentationSourceStoreError('DRAFT_NOT_FOUND');
        }
        if (history.draftLifecycle !== 'active') throw new PresentationSourceStoreError('DRAFT_NOT_FOUND');
        const existing = this.sourceDrafts.get(history.owner.draft_id);
        if (existing === undefined) {
          throw new PresentationCanonicalCorruptionError('Presentation draft history has no canonical draft');
        }
        if (Date.parse(existing.expiresAt) <= this.now().getTime()) {
          await this.expireDraftLocked(existing, history);
          throw new PresentationSourceStoreError('DRAFT_EXPIRED', { draftId: existing.draftId });
        }
        return { status: 'existing', draft: frozenSnapshot(existing) };
      }
      const liveDraftCount = Array.from(this.sourceDrafts.values()).filter((draft) => draft.state === 'active').length;
      if (liveDraftCount >= PRESENTATION_RUN_LIMITS.MAX_LIVE_GUID_DRAFTS_PER_APP) {
        throw new PresentationSourceStoreError('DRAFT_LIMIT_EXCEEDED');
      }
      const draftId = this.randomUUID();
      if (!UUID_RE.test(draftId) || this.sourceDrafts.has(draftId)) {
        throw new Error('Presentation source draft allocator produced a colliding id');
      }
      const owner: PresentationGrantOwner = { owner_type: 'draft', draft_id: draftId };
      const ownerId = presentationSourceOwnerId(owner);
      const now = this.now().toISOString();
      const expiresAt = new Date(Date.parse(now) + PRESENTATION_RUN_LIMITS.GRANT_TTL_MS).toISOString();
      const draft: StoredPresentationSourceDraftManifest = {
        version: 2,
        recordType: 'presentation-source-draft',
        draftId,
        clientRequestId,
        principalId,
        revision: 0,
        state: 'active',
        createdAt: now,
        updatedAt: now,
        expiresAt,
        boundConversationId: null,
        boundAt: null,
      };
      const ownerManifest: StoredPresentationSourceOwnerManifest = {
        version: 2,
        recordType: 'presentation-source-owner',
        ownerId,
        owner,
        principalId,
        revision: 0,
        createdAt: now,
        updatedAt: now,
        grantIds: [],
        unboundBytes: 0,
        draftClientRequestId: clientRequestId,
        draftLifecycle: 'active',
      };
      assertPresentationSourceDraftManifest(draft);
      assertPresentationSourceOwnerManifest(ownerManifest);
      await this.runCanonicalTransaction({
        mutations: [
          { entityKind: 'draft', entityId: draftId, expectedRevision: null, nextManifest: draft },
          { entityKind: 'owner', entityId: ownerId, expectedRevision: null, nextManifest: ownerManifest },
        ],
      });
      this.sourceDrafts.set(draftId, frozenSnapshot(draft));
      this.sourceOwners.set(ownerId, frozenSnapshot(ownerManifest));
      this.index = this.buildIndex();
      await this.persistDerivedIndexBestEffort();
      return { status: 'created', draft: frozenSnapshot(draft) };
    });
  }

  async createPresentationSourceGrants(input: {
    owner: PresentationGrantOwner;
    principalId: string;
    expectedOwnerRevision: number;
    grants: readonly PresentationSourceGrantCreateInput[];
  }): Promise<PresentationSourceOwnerSnapshot> {
    await this.initialize();
    this.assertStorageHealthy();
    await this.expirePresentationSourceOwnerIfNeeded(input.owner);
    const ownerId = presentationSourceOwnerId(input.owner);
    const grantLockKeys = input.grants.map(({ grantId }) => `grant:${grantId}`);
    return this.lock.runExclusive(['store:health', 'policy:app', `owner:${ownerId}`, ...grantLockKeys], async () => {
      this.assertStorageHealthy();
      const currentOwner = this.requireMutableSourceOwner(input.owner, input.principalId, input.expectedOwnerRevision);
      if (input.grants.length === 0) throw new PresentationSourceStoreError('INVALID_REQUEST');
      if (new Set(input.grants.map(({ grantId }) => grantId)).size !== input.grants.length) {
        throw new PresentationSourceStoreError('SOURCE_GRANT_INVALID');
      }
      const batchBytes = input.grants.reduce((total, grant) => total + grant.byteLength, 0);
      const appGrants = Array.from(this.sourceGrants.values()).filter((grant) => grant.state === 'active');
      const appBytes = appGrants.reduce((total, grant) => total + grant.byteLength, 0);
      if (
        currentOwner.grantIds.length + input.grants.length > PRESENTATION_RUN_LIMITS.MAX_UNBOUND_GRANTS_PER_OWNER ||
        appGrants.length + input.grants.length > PRESENTATION_RUN_LIMITS.MAX_UNBOUND_GRANTS_PER_APP
      ) {
        throw new PresentationSourceStoreError('GRANT_LIMIT_EXCEEDED');
      }
      if (
        batchBytes > PRESENTATION_RUN_LIMITS.MAX_TOTAL_SOURCE_BYTES ||
        currentOwner.unboundBytes + batchBytes > PRESENTATION_RUN_LIMITS.MAX_UNBOUND_GRANT_BYTES_PER_OWNER ||
        appBytes + batchBytes > PRESENTATION_RUN_LIMITS.MAX_UNBOUND_GRANT_BYTES_PER_APP
      ) {
        throw new PresentationSourceStoreError('SOURCE_LIMIT_EXCEEDED');
      }
      const now = this.now().toISOString();
      const expiresAt = new Date(Date.parse(now) + PRESENTATION_RUN_LIMITS.GRANT_TTL_MS).toISOString();
      const grants = input.grants.map<StoredPresentationSourceGrantManifest>((grant) => ({
        version: 2,
        recordType: 'presentation-source-grant',
        grantId: grant.grantId,
        owner: structuredClone(input.owner),
        revision: 0,
        displayName: grant.displayName,
        format: grant.format,
        sourceKind: grant.sourceKind,
        snapshotRelativePath: grant.snapshotRelativePath,
        sha256: grant.sha256.toLowerCase(),
        byteLength: grant.byteLength,
        createdAt: now,
        updatedAt: now,
        expiresAt,
        stateEnteredAt: now,
        state: 'active',
        queueExtendedAt: null,
        queueItemId: null,
        claimedRunId: null,
      }));
      for (const grant of grants) {
        if (this.sourceGrants.has(grant.grantId) || this.sourceGrantTombstones.has(grant.grantId)) {
          throw new PresentationSourceStoreError('SOURCE_GRANT_INVALID', { grantId: grant.grantId });
        }
        assertPresentationSourceGrantManifest(grant);
      }
      const nextOwner: StoredPresentationSourceOwnerManifest = {
        ...currentOwner,
        revision: currentOwner.revision + 1,
        createdAt: currentOwner.createdAt === '' ? now : currentOwner.createdAt,
        updatedAt: now,
        grantIds: [...currentOwner.grantIds, ...grants.map(({ grantId }) => grantId)].toSorted(),
        unboundBytes: currentOwner.unboundBytes + batchBytes,
      };
      assertPresentationSourceOwnerManifest(nextOwner);
      const draft = input.owner.owner_type === 'draft' ? this.sourceDrafts.get(input.owner.draft_id) : undefined;
      const nextDraft =
        draft === undefined
          ? undefined
          : ({
              ...draft,
              revision: draft.revision + 1,
              updatedAt: now,
            } satisfies StoredPresentationSourceDraftManifest);
      if (nextDraft !== undefined) assertPresentationSourceDraftManifest(nextDraft);
      await this.runCanonicalTransaction(
        {
          sourceSnapshotPromotions: input.grants.map(({ preparedSnapshot }) => preparedSnapshot),
          mutations: [
            {
              entityKind: 'owner',
              entityId: ownerId,
              expectedRevision:
                currentOwner.revision === 0 && currentOwner.createdAt === '' ? null : currentOwner.revision,
              nextManifest: nextOwner,
            },
            ...grants.map((grant) => ({
              entityKind: 'grant' as const,
              entityId: grant.grantId,
              expectedRevision: null as null,
              nextManifest: grant,
            })),
            ...(nextDraft === undefined
              ? []
              : [
                  {
                    entityKind: 'draft' as const,
                    entityId: nextDraft.draftId,
                    expectedRevision: draft?.revision ?? null,
                    nextManifest: nextDraft,
                  },
                ]),
          ],
        },
        async () => {
          for (const grant of input.grants) await this.files.removePreparedSourceSnapshot(grant.preparedSnapshot);
        }
      );
      this.sourceOwners.set(ownerId, frozenSnapshot(nextOwner));
      for (const grant of grants) this.sourceGrants.set(grant.grantId, frozenSnapshot(grant));
      if (nextDraft !== undefined) this.sourceDrafts.set(nextDraft.draftId, frozenSnapshot(nextDraft));
      this.index = this.buildIndex();
      await this.persistDerivedIndexBestEffort();
      return {
        owner: structuredClone(input.owner),
        ownerRevision: nextOwner.revision,
        grants: grants.map(frozenSnapshot),
      };
    });
  }

  async extendPresentationSourceGrantsForQueue(input: {
    owner: PresentationGrantOwner;
    principalId: string;
    sources: readonly PresentationSourceRef[];
    queueItemId: string;
    expectedOwnerRevision: number;
  }): Promise<ConfirmQueuedPresentationSourcesStoreResult> {
    await this.initialize();
    this.assertStorageHealthy();
    if (
      !Array.isArray(input.sources) ||
      input.sources.length === 0 ||
      input.sources.length > PRESENTATION_RUN_LIMITS.MAX_SOURCES_PER_RUN ||
      !input.sources.every(isIntegrityPresentationRunGrantClaim) ||
      new Set(input.sources.map(({ grantId }) => grantId.toLowerCase())).size !== input.sources.length ||
      input.sources.reduce((total, source) => total + source.expectedByteLength, 0) >
        PRESENTATION_RUN_LIMITS.MAX_TOTAL_SOURCE_BYTES ||
      typeof input.queueItemId !== 'string' ||
      !UUID_RE.test(input.queueItemId) ||
      !Number.isSafeInteger(input.expectedOwnerRevision) ||
      input.expectedOwnerRevision < 0
    ) {
      throw new PresentationSourceStoreError('INVALID_REQUEST');
    }
    await this.expirePresentationSourceOwnerIfNeeded(input.owner);
    const ownerId = presentationSourceOwnerId(input.owner);
    return this.lock.runExclusive(
      ['store:health', 'policy:app', `owner:${ownerId}`, ...input.sources.map(({ grantId }) => `grant:${grantId}`)],
      async () => {
        this.assertStorageHealthy();
        for (const { grantId } of input.sources) {
          const tombstone = this.sourceGrantTombstones.get(grantId);
          if (tombstone === undefined) continue;
          if (presentationSourceOwnerKey(tombstone.owner) !== presentationSourceOwnerKey(input.owner)) {
            throw new PresentationSourceStoreError('SOURCE_GRANT_FOREIGN', { grantId });
          }
          throw new PresentationSourceStoreError(
            tombstone.terminalState === 'expired' ? 'SOURCE_GRANT_EXPIRED' : 'SOURCE_GRANT_REPLAYED',
            { grantId }
          );
        }
        const owner = this.sourceOwners.get(ownerId);
        if (owner === undefined) {
          if (input.owner.owner_type === 'draft') {
            this.throwDraftLookupFailure(input.owner.draft_id, input.principalId);
          }
          throw new PresentationSourceStoreError('SOURCE_GRANT_INVALID', {
            grantId: input.sources[0]?.grantId,
          });
        }
        if (owner.principalId !== input.principalId) {
          throw new PresentationSourceStoreError(
            input.owner.owner_type === 'draft' ? 'DRAFT_FOREIGN' : 'RUN_FORBIDDEN'
          );
        }
        if (input.owner.owner_type === 'draft') {
          if (owner.draftLifecycle === 'expired') {
            throw new PresentationSourceStoreError('DRAFT_EXPIRED', { draftId: input.owner.draft_id });
          }
          if (owner.draftLifecycle !== 'active') throw new PresentationSourceStoreError('DRAFT_NOT_FOUND');
        }
        const grants = input.sources.map((source) => {
          const grant = this.sourceGrants.get(source.grantId);
          if (grant === undefined || !owner.grantIds.includes(source.grantId)) {
            throw new PresentationSourceStoreError('SOURCE_GRANT_INVALID', { grantId: source.grantId });
          }
          if (presentationSourceOwnerKey(grant.owner) !== presentationSourceOwnerKey(input.owner)) {
            throw new PresentationSourceStoreError('SOURCE_GRANT_FOREIGN', { grantId: source.grantId });
          }
          if (grant.state !== 'active') {
            throw new PresentationSourceStoreError('SOURCE_GRANT_REPLAYED', { grantId: source.grantId });
          }
          if (grant.byteLength !== source.expectedByteLength || grant.sha256 !== source.expectedSha256) {
            throw new PresentationSourceStoreError('SOURCE_TAMPERED', { grantId: source.grantId });
          }
          return grant;
        });
        const queueBoundGrants = owner.grantIds
          .map((grantId) => this.sourceGrants.get(grantId))
          .filter(
            (grant): grant is StoredPresentationSourceGrantManifest =>
              grant !== undefined && grant.queueItemId === input.queueItemId
          );
        const exactReplay =
          queueBoundGrants.length === grants.length &&
          grants.every((grant) => grant.queueItemId === input.queueItemId && grant.queueExtendedAt !== null) &&
          // The exact owner, queue binding, and complete ref set are the durable idempotency identity.
          // A replay with an older owner revision performs no mutation or TTL extension; first mutation
          // still requires the strict owner-revision CAS below.
          input.expectedOwnerRevision < owner.revision;
        if (exactReplay) {
          const expiresAt = grants[0]?.expiresAt;
          if (expiresAt === undefined || grants.some((grant) => grant.expiresAt !== expiresAt)) {
            throw new PresentationCanonicalCorruptionError('Queued presentation source expiries are inconsistent');
          }
          return {
            status: 'already_confirmed',
            owner: structuredClone(input.owner),
            ownerRevision: owner.revision,
            expiresAt,
            grants: owner.grantIds.map((grantId) => {
              const grant = this.sourceGrants.get(grantId);
              if (grant === undefined) {
                throw new PresentationCanonicalCorruptionError('Presentation source owner references a missing grant');
              }
              return frozenSnapshot(grant);
            }),
          };
        }
        const replayedGrant = grants.find((grant) => grant.queueExtendedAt !== null || grant.queueItemId !== null);
        if (queueBoundGrants.length > 0 || replayedGrant !== undefined) {
          throw new PresentationSourceStoreError('SOURCE_GRANT_REPLAYED', {
            grantId: replayedGrant?.grantId ?? queueBoundGrants[0]?.grantId,
          });
        }
        if (owner.revision !== input.expectedOwnerRevision) {
          throw new PresentationSourceStoreError('INVALID_REQUEST');
        }
        const now = this.now().toISOString();
        const expiresAt = new Date(Date.parse(now) + PRESENTATION_RUN_LIMITS.QUEUED_GRANT_TTL_MS).toISOString();
        const nextGrants = grants.map<StoredPresentationSourceGrantManifest>((grant) => ({
          ...grant,
          revision: grant.revision + 1,
          updatedAt: now,
          expiresAt,
          queueExtendedAt: now,
          queueItemId: input.queueItemId,
        }));
        const nextOwner: StoredPresentationSourceOwnerManifest = {
          ...owner,
          revision: owner.revision + 1,
          updatedAt: now,
        };
        const draft = input.owner.owner_type === 'draft' ? this.sourceDrafts.get(input.owner.draft_id) : undefined;
        const nextDraft = draft === undefined ? undefined : { ...draft, revision: draft.revision + 1, updatedAt: now };
        for (const grant of nextGrants) assertPresentationSourceGrantManifest(grant);
        assertPresentationSourceOwnerManifest(nextOwner);
        if (nextDraft !== undefined) assertPresentationSourceDraftManifest(nextDraft);
        await this.runCanonicalTransaction({
          mutations: [
            { entityKind: 'owner', entityId: ownerId, expectedRevision: owner.revision, nextManifest: nextOwner },
            ...nextGrants.map((grant, index) => ({
              entityKind: 'grant' as const,
              entityId: grant.grantId,
              expectedRevision: grants[index]?.revision ?? null,
              nextManifest: grant,
            })),
            ...(nextDraft === undefined
              ? []
              : [
                  {
                    entityKind: 'draft' as const,
                    entityId: nextDraft.draftId,
                    expectedRevision: draft?.revision ?? null,
                    nextManifest: nextDraft,
                  },
                ]),
          ],
        });
        this.sourceOwners.set(ownerId, frozenSnapshot(nextOwner));
        for (const grant of nextGrants) this.sourceGrants.set(grant.grantId, frozenSnapshot(grant));
        if (nextDraft !== undefined) this.sourceDrafts.set(nextDraft.draftId, frozenSnapshot(nextDraft));
        this.index = this.buildIndex();
        await this.persistDerivedIndexBestEffort();
        return {
          status: 'confirmed',
          owner: structuredClone(input.owner),
          ownerRevision: nextOwner.revision,
          expiresAt,
          grants: nextOwner.grantIds.map((grantId) => {
            const grant = this.sourceGrants.get(grantId);
            if (grant === undefined) {
              throw new PresentationCanonicalCorruptionError('Presentation source owner references a missing grant');
            }
            return frozenSnapshot(grant);
          }),
        };
      }
    );
  }

  async bindPresentationSourceDraft(input: {
    draftId: string;
    conversationId: string;
    principalId: string;
    expectedRevision: number;
  }): Promise<BindPresentationSourceDraftStoreResult> {
    await this.initialize();
    this.assertStorageHealthy();
    const draftOwner: PresentationGrantOwner = { owner_type: 'draft', draft_id: input.draftId };
    const destinationOwner: PresentationGrantOwner = {
      owner_type: 'conversation',
      conversation_id: input.conversationId,
    };
    const draftOwnerId = presentationSourceOwnerId(draftOwner);
    const destinationOwnerId = presentationSourceOwnerId(destinationOwner);
    const knownGrantIds = this.sourceOwners.get(draftOwnerId)?.grantIds ?? [];
    return this.lock.runExclusive(
      [
        'store:health',
        'policy:app',
        `draft:${input.draftId}`,
        `owner:${draftOwnerId}`,
        `owner:${destinationOwnerId}`,
        ...knownGrantIds.map((grantId) => `grant:${grantId}`),
      ],
      async () => {
        this.assertStorageHealthy();
        const terminal = this.sourceDraftTombstones.get(input.draftId);
        if (terminal !== undefined) {
          if (Date.parse(terminal.deleteAfter) <= this.now().getTime()) {
            throw new PresentationSourceStoreError('DRAFT_NOT_FOUND');
          }
          if (terminal.principalId !== input.principalId) throw new PresentationSourceStoreError('DRAFT_FOREIGN');
          if (terminal.terminalState === 'expired') {
            throw new PresentationSourceStoreError('DRAFT_EXPIRED', { draftId: input.draftId });
          }
          if (terminal.boundConversationId === input.conversationId) {
            return {
              status: 'already_bound',
              draftId: terminal.draftId,
              conversationId: input.conversationId,
              revision: terminal.lastRevision,
              boundAt: terminal.terminalAt,
            };
          }
          throw new PresentationSourceStoreError('DRAFT_ALREADY_BOUND', {
            draftId: input.draftId,
            conversationId: terminal.boundConversationId ?? undefined,
          });
        }
        const draft = this.sourceDrafts.get(input.draftId);
        const currentDraftOwner = this.sourceOwners.get(draftOwnerId);
        if (draft === undefined || currentDraftOwner === undefined) {
          this.throwDraftLookupFailure(input.draftId, input.principalId);
        }
        if (draft.principalId !== input.principalId || currentDraftOwner.principalId !== input.principalId) {
          throw new PresentationSourceStoreError('DRAFT_FOREIGN');
        }
        if (Date.parse(draft.expiresAt) <= this.now().getTime()) {
          await this.expireDraftLocked(draft, currentDraftOwner);
          throw new PresentationSourceStoreError('DRAFT_EXPIRED', { draftId: draft.draftId });
        }
        if (draft.state === 'bound') {
          if (draft.boundConversationId === input.conversationId && draft.boundAt !== null) {
            return {
              status: 'already_bound',
              draftId: draft.draftId,
              conversationId: input.conversationId,
              revision: draft.revision,
              boundAt: draft.boundAt,
            };
          }
          throw new PresentationSourceStoreError('DRAFT_ALREADY_BOUND', {
            draftId: draft.draftId,
            conversationId: draft.boundConversationId ?? undefined,
          });
        }
        if (draft.revision !== input.expectedRevision || currentDraftOwner.revision !== input.expectedRevision) {
          throw new PresentationSourceStoreError('INVALID_REQUEST');
        }
        const grants = currentDraftOwner.grantIds.map((grantId) => {
          const grant = this.sourceGrants.get(grantId);
          if (grant === undefined || grant.state !== 'active') {
            throw new PresentationCanonicalCorruptionError('Presentation draft references an invalid grant');
          }
          return grant;
        });
        if (new Set(knownGrantIds).size !== new Set(currentDraftOwner.grantIds).size) {
          throw new PresentationSourceStoreError('INVALID_REQUEST');
        }
        const existingDestination = this.sourceOwners.get(destinationOwnerId);
        if (existingDestination !== undefined && existingDestination.principalId !== input.principalId) {
          throw new PresentationSourceStoreError('RUN_FORBIDDEN');
        }
        const destinationCount = existingDestination?.grantIds.length ?? 0;
        const destinationBytes = existingDestination?.unboundBytes ?? 0;
        if (destinationCount + grants.length > PRESENTATION_RUN_LIMITS.MAX_UNBOUND_GRANTS_PER_OWNER) {
          throw new PresentationSourceStoreError('GRANT_LIMIT_EXCEEDED');
        }
        if (
          destinationBytes + currentDraftOwner.unboundBytes >
          PRESENTATION_RUN_LIMITS.MAX_UNBOUND_GRANT_BYTES_PER_OWNER
        ) {
          throw new PresentationSourceStoreError('SOURCE_LIMIT_EXCEEDED');
        }
        const now = this.now().toISOString();
        const nextDraft: StoredPresentationSourceDraftManifest = {
          ...draft,
          revision: draft.revision + 1,
          state: 'bound',
          updatedAt: now,
          boundConversationId: input.conversationId,
          boundAt: now,
        };
        const nextDraftOwner: StoredPresentationSourceOwnerManifest = {
          ...currentDraftOwner,
          revision: currentDraftOwner.revision + 1,
          updatedAt: now,
          grantIds: [],
          unboundBytes: 0,
          draftLifecycle: 'bound',
        };
        const nextDestination: StoredPresentationSourceOwnerManifest =
          existingDestination === undefined
            ? {
                version: 2,
                recordType: 'presentation-source-owner',
                ownerId: destinationOwnerId,
                owner: destinationOwner,
                principalId: input.principalId,
                revision: 1,
                createdAt: now,
                updatedAt: now,
                grantIds: grants.map(({ grantId }) => grantId).toSorted(),
                unboundBytes: currentDraftOwner.unboundBytes,
                draftClientRequestId: null,
                draftLifecycle: null,
              }
            : {
                ...existingDestination,
                revision: existingDestination.revision + 1,
                updatedAt: now,
                grantIds: [...existingDestination.grantIds, ...grants.map(({ grantId }) => grantId)].toSorted(),
                unboundBytes: existingDestination.unboundBytes + currentDraftOwner.unboundBytes,
              };
        const migratedGrants = grants.map<StoredPresentationSourceGrantManifest>((grant) => ({
          ...grant,
          owner: destinationOwner,
          revision: grant.revision + 1,
          updatedAt: now,
        }));
        const tombstone: StoredPresentationSourceDraftTombstone = {
          version: 2,
          recordType: 'presentation-source-draft-tombstone',
          revision: 0,
          draftId: draft.draftId,
          clientRequestId: draft.clientRequestId,
          principalId: draft.principalId,
          terminalState: 'bound',
          terminalAt: now,
          tombstonedAt: now,
          deleteAfter: new Date(Date.parse(now) + PRESENTATION_RUN_LIMITS.TOMBSTONE_RETENTION_MS).toISOString(),
          lastRevision: nextDraft.revision,
          boundConversationId: input.conversationId,
        };
        assertPresentationSourceDraftManifest(nextDraft);
        assertPresentationSourceOwnerManifest(nextDraftOwner);
        assertPresentationSourceOwnerManifest(nextDestination);
        assertPresentationSourceDraftTombstone(tombstone);
        for (const grant of migratedGrants) assertPresentationSourceGrantManifest(grant);
        await this.runCanonicalTransaction({
          mutations: [
            {
              entityKind: 'draft',
              entityId: draft.draftId,
              expectedRevision: draft.revision,
              nextManifest: nextDraft,
            },
            {
              entityKind: 'draft-tombstone',
              entityId: draft.draftId,
              expectedRevision: null,
              nextManifest: tombstone,
            },
            {
              entityKind: 'owner',
              entityId: draftOwnerId,
              expectedRevision: currentDraftOwner.revision,
              nextManifest: nextDraftOwner,
            },
            {
              entityKind: 'owner',
              entityId: destinationOwnerId,
              expectedRevision: existingDestination?.revision ?? null,
              nextManifest: nextDestination,
            },
            ...migratedGrants.map((grant, index) => ({
              entityKind: 'grant' as const,
              entityId: grant.grantId,
              expectedRevision: grants[index]?.revision ?? null,
              nextManifest: grant,
            })),
          ],
        });
        this.sourceDrafts.delete(draft.draftId);
        this.sourceDraftTombstones.set(draft.draftId, frozenSnapshot(tombstone));
        this.sourceOwners.set(draftOwnerId, frozenSnapshot(nextDraftOwner));
        this.sourceOwners.set(destinationOwnerId, frozenSnapshot(nextDestination));
        for (const grant of migratedGrants) this.sourceGrants.set(grant.grantId, frozenSnapshot(grant));
        this.index = this.buildIndex();
        await this.persistDerivedIndexBestEffort();
        await this.files.removeDraft(draft.draftId);
        return {
          status: 'bound',
          draftId: draft.draftId,
          conversationId: input.conversationId,
          revision: nextDraft.revision,
          boundAt: now,
        };
      }
    );
  }

  async revokePresentationSourceGrant(input: {
    owner: PresentationGrantOwner;
    principalId: string;
    grantId: string;
    expectedOwnerRevision: number;
  }): Promise<{ status: 'revoked' | 'already_revoked'; grantId: string; ownerRevision: number; revokedAt: string }> {
    await this.initialize();
    this.assertStorageHealthy();
    await this.expirePresentationSourceOwnerIfNeeded(input.owner);
    const ownerId = presentationSourceOwnerId(input.owner);
    return this.lock.runExclusive(
      ['store:health', 'policy:app', `owner:${ownerId}`, `grant:${input.grantId}`],
      async () => {
        this.assertStorageHealthy();
        const existingTombstone = this.sourceGrantTombstones.get(input.grantId);
        if (existingTombstone !== undefined && Date.parse(existingTombstone.deleteAfter) > this.now().getTime()) {
          if (!Number.isSafeInteger(input.expectedOwnerRevision) || input.expectedOwnerRevision < 0) {
            throw new PresentationSourceStoreError('INVALID_REQUEST');
          }
          if (presentationSourceOwnerKey(existingTombstone.owner) !== presentationSourceOwnerKey(input.owner)) {
            throw new PresentationSourceStoreError('SOURCE_GRANT_FOREIGN', { grantId: input.grantId });
          }
          const currentOwner = this.sourceOwners.get(ownerId);
          if (currentOwner === undefined) {
            if (input.owner.owner_type === 'draft') {
              this.throwDraftLookupFailure(input.owner.draft_id, input.principalId);
            }
            throw new PresentationSourceStoreError('SOURCE_GRANT_INVALID', { grantId: input.grantId });
          }
          if (currentOwner.principalId !== input.principalId) {
            throw new PresentationSourceStoreError(
              input.owner.owner_type === 'draft' ? 'DRAFT_FOREIGN' : 'RUN_FORBIDDEN'
            );
          }
          if (existingTombstone.terminalState === 'revoked') {
            return {
              status: 'already_revoked',
              grantId: input.grantId,
              ownerRevision: currentOwner.revision,
              revokedAt: existingTombstone.terminalAt,
            };
          }
          throw new PresentationSourceStoreError(
            existingTombstone.terminalState === 'expired' ? 'SOURCE_GRANT_EXPIRED' : 'SOURCE_GRANT_REPLAYED',
            { grantId: input.grantId }
          );
        }
        const owner = this.requireMutableSourceOwner(input.owner, input.principalId, input.expectedOwnerRevision);
        const grant = this.sourceGrants.get(input.grantId);
        if (grant === undefined)
          throw new PresentationSourceStoreError('SOURCE_GRANT_INVALID', { grantId: input.grantId });
        if (presentationSourceOwnerKey(grant.owner) !== presentationSourceOwnerKey(input.owner)) {
          throw new PresentationSourceStoreError('SOURCE_GRANT_FOREIGN', { grantId: input.grantId });
        }
        if (grant.state !== 'active') {
          throw new PresentationSourceStoreError(
            grant.state === 'expired' ? 'SOURCE_GRANT_EXPIRED' : 'SOURCE_GRANT_REPLAYED',
            { grantId: input.grantId }
          );
        }
        const now = this.now().toISOString();
        const nextGrant: StoredPresentationSourceGrantManifest = {
          ...grant,
          revision: grant.revision + 1,
          updatedAt: now,
          stateEnteredAt: now,
          state: 'revoked',
        };
        const nextOwner: StoredPresentationSourceOwnerManifest = {
          ...owner,
          revision: owner.revision + 1,
          updatedAt: now,
          grantIds: owner.grantIds.filter((grantId) => grantId !== input.grantId),
          unboundBytes: owner.unboundBytes - grant.byteLength,
        };
        const tombstone = this.createGrantTombstone(nextGrant, 'revoked', now);
        const draft = input.owner.owner_type === 'draft' ? this.sourceDrafts.get(input.owner.draft_id) : undefined;
        const nextDraft = draft === undefined ? undefined : { ...draft, revision: draft.revision + 1, updatedAt: now };
        await this.runCanonicalTransaction({
          mutations: [
            {
              entityKind: 'grant',
              entityId: grant.grantId,
              expectedRevision: grant.revision,
              nextManifest: nextGrant,
            },
            {
              entityKind: 'grant-tombstone',
              entityId: grant.grantId,
              expectedRevision: null,
              nextManifest: tombstone,
            },
            { entityKind: 'owner', entityId: ownerId, expectedRevision: owner.revision, nextManifest: nextOwner },
            ...(nextDraft === undefined
              ? []
              : [
                  {
                    entityKind: 'draft' as const,
                    entityId: nextDraft.draftId,
                    expectedRevision: draft?.revision ?? null,
                    nextManifest: nextDraft,
                  },
                ]),
          ],
        });
        this.sourceGrants.delete(grant.grantId);
        this.sourceGrantTombstones.set(grant.grantId, frozenSnapshot(tombstone));
        this.sourceOwners.set(ownerId, frozenSnapshot(nextOwner));
        if (nextDraft !== undefined) this.sourceDrafts.set(nextDraft.draftId, frozenSnapshot(nextDraft));
        this.index = this.buildIndex();
        await this.persistDerivedIndexBestEffort();
        await this.files.removeGrant(grant.grantId);
        return { status: 'revoked', grantId: grant.grantId, ownerRevision: nextOwner.revision, revokedAt: now };
      }
    );
  }

  async allocateRun(unsafeInput: AllocatePresentationRunInput): Promise<AllocatePresentationRunResult> {
    const input = structuredClone(unsafeInput);
    if (typeof input.requestFingerprint === 'string' && REQUEST_FINGERPRINT_INPUT_RE.test(input.requestFingerprint)) {
      input.requestFingerprint = input.requestFingerprint.toLowerCase();
    }
    deepFreeze(input);
    await this.initialize();
    this.assertStorageHealthy();
    const requestKey = requestIndexKey(input.conversationId, input.clientRequestId);
    const sourceOwner: PresentationGrantOwner = {
      owner_type: 'conversation',
      conversation_id: input.conversationId,
    };
    const sourceOwnerId = presentationSourceOwnerId(sourceOwner);
    const lockKeys = [
      'store:health',
      `conversation:${input.conversationId}`,
      ...input.grantClaims.map(({ grantId }) => `grant:${grantId}`),
      `owner:${sourceOwnerId}`,
      'policy:app',
      `request:${requestKey}`,
    ];
    return this.lock.runExclusive(lockKeys, async () => {
      this.assertStorageHealthy();
      const existing = await this.findByRequest(input.conversationId, input.clientRequestId);
      if (existing !== null) {
        if (existing.requestFingerprint !== input.requestFingerprint) return collisionFailure(existing.runId);
        if (existing.postAllocationFailure !== null) return existing.postAllocationFailure;
        return { ok: true, status: 'existing', run: existing };
      }

      if (input.grantClaims.length > PRESENTATION_RUN_LIMITS.MAX_SOURCES_PER_RUN) {
        return preflightFailure('RESOURCE_LIMIT_EXCEEDED');
      }
      const grantIds = input.grantClaims.map(({ grantId }) => grantId);
      if (new Set(grantIds).size !== grantIds.length) {
        const duplicate = grantIds.find((grantId, index) => grantIds.indexOf(grantId) !== index);
        return {
          ok: false,
          code: 'SOURCE_GRANT_INVALID',
          messageKey: 'conversation.presentationRun.SOURCE_GRANT_INVALID',
          retryable: false,
          state: 'grant_validation',
          details: { grantId: duplicate },
        };
      }
      const grants: (StoredPresentationGrantManifest | StoredPresentationSourceGrantManifest)[] = [];
      let sourceBytes = 0;
      for (const unsafeClaim of input.grantClaims as readonly unknown[]) {
        if (!isPresentationRunGrantClaim(unsafeClaim)) {
          return {
            ok: false,
            code: 'SOURCE_GRANT_INVALID',
            messageKey: 'conversation.presentationRun.SOURCE_GRANT_INVALID',
            retryable: false,
            state: 'grant_validation',
            details: {
              grantId: isRecord(unsafeClaim) && typeof unsafeClaim.grantId === 'string' ? unsafeClaim.grantId : '',
            },
          };
        }
        const claim = unsafeClaim;
        const tombstone = this.sourceGrantTombstones.get(claim.grantId);
        if (tombstone !== undefined && Date.parse(tombstone.deleteAfter) > this.now().getTime()) {
          const ownerKey = presentationSourceOwnerKey(tombstone.owner);
          if (ownerKey !== `conversation:${input.conversationId}`) {
            return {
              ok: false,
              code: 'SOURCE_GRANT_FOREIGN',
              messageKey: 'conversation.presentationRun.SOURCE_GRANT_FOREIGN',
              retryable: false,
              state: 'grant_validation',
              details: { grantId: claim.grantId },
            };
          }
          if (tombstone.terminalState === 'expired') {
            return {
              ok: false,
              code: 'SOURCE_GRANT_EXPIRED',
              messageKey: 'conversation.presentationRun.SOURCE_GRANT_EXPIRED',
              retryable: false,
              state: 'grant_expired',
              details: { grantId: claim.grantId },
            };
          }
          return {
            ok: false,
            code: 'SOURCE_GRANT_REPLAYED',
            messageKey: 'conversation.presentationRun.SOURCE_GRANT_REPLAYED',
            retryable: false,
            state: 'grant_validation',
            details: { grantId: claim.grantId },
          };
        }
        const canonical = await this.journal.readCanonical<Record<string, unknown>>('grant', claim.grantId);
        const grant = isStructurallyValidSourceGrant(canonical, claim.grantId)
          ? canonical
          : isStructurallyValidGrant(canonical, claim.grantId)
            ? canonical
            : null;
        if (grant === null) {
          return {
            ok: false,
            code: 'SOURCE_GRANT_INVALID',
            messageKey: 'conversation.presentationRun.SOURCE_GRANT_INVALID',
            retryable: false,
            state: 'grant_validation',
            details: { grantId: claim.grantId },
          };
        }
        const ownerKey = 'recordType' in grant ? presentationSourceOwnerKey(grant.owner) : grant.ownerKey;
        if (ownerKey !== `conversation:${input.conversationId}`) {
          return {
            ok: false,
            code: 'SOURCE_GRANT_FOREIGN',
            messageKey: 'conversation.presentationRun.SOURCE_GRANT_FOREIGN',
            retryable: false,
            state: 'grant_validation',
            details: { grantId: claim.grantId },
          };
        }
        if (grant.state === 'expired') {
          return {
            ok: false,
            code: 'SOURCE_GRANT_EXPIRED',
            messageKey: 'conversation.presentationRun.SOURCE_GRANT_EXPIRED',
            retryable: false,
            state: 'grant_expired',
            details: { grantId: claim.grantId },
          };
        }
        if (grant.state === 'claimed' || grant.state === 'consumed') {
          return {
            ok: false,
            code: 'SOURCE_GRANT_REPLAYED',
            messageKey: 'conversation.presentationRun.SOURCE_GRANT_REPLAYED',
            retryable: false,
            state: 'grant_validation',
            details: { grantId: claim.grantId },
          };
        }
        if (
          grant.state !== 'active' ||
          (isLegacyPresentationRunGrantClaim(claim) && grant.revision !== claim.expectedRevision)
        ) {
          return {
            ok: false,
            code: 'SOURCE_GRANT_INVALID',
            messageKey: 'conversation.presentationRun.SOURCE_GRANT_INVALID',
            retryable: false,
            state: 'grant_validation',
            details: { grantId: claim.grantId },
          };
        }
        if (isIntegrityPresentationRunGrantClaim(claim)) {
          if (!isStoredPresentationSourceGrantManifest(grant)) {
            return {
              ok: false,
              code: 'SOURCE_GRANT_INVALID',
              messageKey: 'conversation.presentationRun.SOURCE_GRANT_INVALID',
              retryable: false,
              state: 'grant_validation',
              details: { grantId: claim.grantId },
            };
          }
          if (grant.byteLength !== claim.expectedByteLength || grant.sha256 !== claim.expectedSha256) {
            return {
              ok: false,
              code: 'SOURCE_TAMPERED',
              messageKey: 'conversation.presentationRun.SOURCE_TAMPERED',
              retryable: false,
              state: 'grant_validation',
              details: { grantId: claim.grantId },
            };
          }
        }
        sourceBytes += grant.byteLength;
        if (
          grant.byteLength > PRESENTATION_RUN_LIMITS.MAX_SOURCE_BYTES ||
          sourceBytes > PRESENTATION_RUN_LIMITS.MAX_TOTAL_SOURCE_BYTES
        ) {
          return {
            ok: false,
            code: 'SOURCE_LIMIT_EXCEEDED',
            messageKey: 'conversation.presentationRun.SOURCE_LIMIT_EXCEEDED',
            retryable: false,
            state: 'grant_validation',
            details: { grantId: claim.grantId },
          };
        }
        grants.push(grant);
      }
      const freeBytes = await this.getFreeDiskBytes();
      const allocationTime = this.now();
      const expiredGrant = grants.find((grant) => Date.parse(grant.expiresAt) <= allocationTime.getTime());
      if (expiredGrant !== undefined) {
        return {
          ok: false,
          code: 'SOURCE_GRANT_EXPIRED',
          messageKey: 'conversation.presentationRun.SOURCE_GRANT_EXPIRED',
          retryable: false,
          state: 'grant_expired',
          details: { grantId: expiredGrant.grantId },
        };
      }
      const task3Grants = grants.filter(isStoredPresentationSourceGrantManifest);
      const usesIntegrityClaims = input.grantClaims.some(isIntegrityPresentationRunGrantClaim);
      const currentSourceOwner = task3Grants.length === 0 ? undefined : this.sourceOwners.get(sourceOwnerId);
      if (
        usesIntegrityClaims &&
        task3Grants.length > 0 &&
        (typeof input.principalId !== 'string' ||
          input.principalId.length < 1 ||
          input.principalId.length > 256 ||
          currentSourceOwner?.principalId !== input.principalId)
      ) {
        return {
          ok: false,
          code: 'SOURCE_GRANT_FOREIGN',
          messageKey: 'conversation.presentationRun.SOURCE_GRANT_FOREIGN',
          retryable: false,
          state: 'grant_validation',
          details: { grantId: task3Grants[0]?.grantId },
        };
      }
      for (const grant of task3Grants) {
        try {
          await this.files.verifySourceSnapshot({
            grantId: grant.grantId,
            format: grant.format,
            relativePath: grant.snapshotRelativePath,
            sha256: grant.sha256,
            byteLength: grant.byteLength,
          });
        } catch {
          return {
            ok: false,
            code: 'SOURCE_TAMPERED',
            messageKey: 'conversation.presentationRun.SOURCE_TAMPERED',
            retryable: false,
            state: 'grant_validation',
            details: { grantId: grant.grantId },
          };
        }
      }
      const capacityFailure = this.getCapacityFailure(input.conversationId, freeBytes);
      if (capacityFailure !== null) return capacityFailure;
      if (this.wouldExceedRetainedBytes(input.conversationId, sourceBytes)) {
        return preflightFailure('RESOURCE_LIMIT_EXCEEDED');
      }
      const rateFailure = this.getRateLimitFailure(input.conversationId, allocationTime.getTime());
      if (rateFailure !== null) return rateFailure;
      const now = allocationTime.toISOString();
      const runId = this.randomUUID();
      if (!UUID_RE.test(runId) || this.runs.has(runId) || this.tombstones.has(runId)) {
        throw new Error('Presentation run allocator produced a colliding id');
      }
      const task3Bytes = task3Grants.reduce((total, grant) => total + grant.byteLength, 0);
      if (
        task3Grants.length > 0 &&
        (currentSourceOwner === undefined ||
          presentationSourceOwnerKey(currentSourceOwner.owner) !== presentationSourceOwnerKey(sourceOwner) ||
          task3Grants.some((grant) => !currentSourceOwner.grantIds.includes(grant.grantId)) ||
          currentSourceOwner.unboundBytes < task3Bytes)
      ) {
        throw new PresentationCanonicalCorruptionError('Presentation source owner claim accounting is corrupt');
      }
      const nextSourceOwner =
        currentSourceOwner === undefined
          ? undefined
          : ({
              ...currentSourceOwner,
              revision: currentSourceOwner.revision + 1,
              updatedAt: now,
              grantIds: currentSourceOwner.grantIds.filter(
                (grantId) => !task3Grants.some((grant) => grant.grantId === grantId)
              ),
              unboundBytes: currentSourceOwner.unboundBytes - task3Bytes,
            } satisfies StoredPresentationSourceOwnerManifest);
      const claimedGrants = grants.map((grant) =>
        isStoredPresentationSourceGrantManifest(grant)
          ? ({
              ...grant,
              revision: grant.revision + 1,
              updatedAt: now,
              stateEnteredAt: now,
              state: 'claimed' as const,
              claimedRunId: runId,
            } satisfies StoredPresentationSourceGrantManifest)
          : ({
              ...grant,
              revision: grant.revision + 1,
              updatedAt: now,
              state: 'claimed' as const,
              claimedRunId: runId,
            } satisfies StoredPresentationGrantManifest)
      );
      for (const grant of claimedGrants) {
        if (isStoredPresentationSourceGrantManifest(grant)) assertPresentationSourceGrantManifest(grant);
      }
      if (nextSourceOwner !== undefined) assertPresentationSourceOwnerManifest(nextSourceOwner);
      const run: StoredPresentationRunManifest = {
        version: 2,
        runId,
        clientRequestId: input.clientRequestId,
        conversationId: input.conversationId,
        selectedTemplateId: input.selectedTemplateId,
        requestFingerprint: input.requestFingerprint,
        postAllocationFailure: null,
        revision: 0,
        createdAt: now,
        updatedAt: now,
        statusEnteredAt: now,
        committedAt: null,
        retainedAt: null,
        dispatchStatus: 'allocating',
        artifactPhase: 'none',
        disposition: null,
        retainedCandidate: null,
        sourceGrants: input.grantClaims.map(({ grantId }) => grantId),
        binding: null,
        postInvoked: false,
        retainedBytes: sourceBytes,
        preparation: null,
        initialDispatchLease: null,
        terminalEvidence: null,
        runtimeReleaseObservations: [],
        retentionProof: null,
        readiness: null,
      };
      this.assertStoredRun(run, runId);
      await this.runCanonicalTransaction({
        mutations: [
          { entityKind: 'run', entityId: runId, expectedRevision: null, nextManifest: run },
          ...(nextSourceOwner === undefined || currentSourceOwner === undefined
            ? []
            : [
                {
                  entityKind: 'owner' as const,
                  entityId: sourceOwnerId,
                  expectedRevision: currentSourceOwner.revision,
                  nextManifest: nextSourceOwner,
                },
              ]),
          ...claimedGrants.map((grant, index) => ({
            entityKind: 'grant' as const,
            entityId: grant.grantId,
            expectedRevision: grants[index]?.revision ?? null,
            nextManifest: grant,
          })),
        ],
      });
      const cached = this.cacheRun(run);
      if (nextSourceOwner !== undefined) this.sourceOwners.set(sourceOwnerId, frozenSnapshot(nextSourceOwner));
      for (const grant of claimedGrants) {
        if (isStoredPresentationSourceGrantManifest(grant)) {
          this.sourceGrants.set(grant.grantId, frozenSnapshot(grant));
        }
      }
      this.index = this.buildIndex();
      this.consumeStartTokens(input.conversationId, allocationTime.getTime());
      await this.persistDerivedIndexBestEffort();
      return { ok: true, status: 'created', run: this.snapshotRun(cached) };
    });
  }

  async recordPostAllocationFailure(
    runId: string,
    expectedRevision: number,
    unsafeFailure: PresentationRunFailure
  ): Promise<StoredPresentationRunManifest> {
    const failure = frozenSnapshot(unsafeFailure);
    if (!isPresentationRunFailure(failure)) throw new Error('Invalid presentation run failure envelope');
    await this.initialize();
    this.assertStorageHealthy();
    return this.lock.runExclusive(['store:health', `run:${runId}`], async () => {
      this.assertStorageHealthy();
      const current = this.runs.get(runId);
      if (current === undefined) throw new Error('Presentation run not found');
      if (current.postAllocationFailure !== null) {
        if (isDeepStrictEqual(current.postAllocationFailure, failure)) return this.snapshotRun(current);
        throw new Error('Presentation post-allocation failure is immutable');
      }
      if (current.revision !== expectedRevision) throw new Error('Presentation run revision conflict');
      const next: StoredPresentationRunManifest = {
        ...current,
        revision: current.revision + 1,
        updatedAt: this.now().toISOString(),
        postAllocationFailure: structuredClone(failure),
      };
      this.assertStoredRun(next, runId);
      await this.runCanonicalTransaction({
        mutations: [{ entityKind: 'run', entityId: runId, expectedRevision: current.revision, nextManifest: next }],
      });
      const cached = this.cacheRun(next);
      this.index = this.buildIndex();
      await this.persistDerivedIndexBestEffort();
      return this.snapshotRun(cached);
    });
  }

  /** Atomically publishes staged inputs and commits the exact restart-safe preparation record. */
  async commitPreparedRun(
    runId: string,
    expectedRevision: number,
    unsafePrepared: PreparedPresentationRunAssets
  ): Promise<StoredPresentationRunManifest> {
    const prepared = frozenSnapshot(unsafePrepared);
    let handedToJournal = false;
    try {
      await this.initialize();
      this.assertStorageHealthy();
      const currentForLock = this.runs.get(runId);
      if (currentForLock === undefined) throw new Error('Presentation run not found');
      return await this.lock.runExclusive(
        ['store:health', `run:${runId}`, ...currentForLock.sourceGrants.map((grantId) => `grant:${grantId}`)],
        async () => {
          this.assertStorageHealthy();
          const current = this.runs.get(runId);
          if (current === undefined) throw new Error('Presentation run not found');
          if (prepared.runId !== runId) throw new Error('Prepared presentation run id does not match');
          if (current.revision !== expectedRevision) throw new Error('Presentation run revision conflict');
          if (
            current.dispatchStatus !== 'allocating' ||
            current.artifactPhase !== 'sources_snapshotted' ||
            current.postAllocationFailure !== null ||
            (current.preparation !== undefined && current.preparation !== null)
          ) {
            throw new Error('Presentation run is not ready to commit');
          }
          if (
            prepared.record.payload.sourceRefs.length !== current.sourceGrants.length ||
            prepared.record.payload.sourceRefs.some((sourceRef, index) => {
              const grantId = current.sourceGrants[index];
              const grant = grantId === undefined ? undefined : this.sourceGrants.get(grantId);
              return (
                grant === undefined ||
                grant.state !== 'claimed' ||
                grant.claimedRunId !== runId ||
                sourceRef.grantId !== grantId ||
                sourceRef.expectedByteLength !== grant.byteLength ||
                sourceRef.expectedSha256 !== grant.sha256
              );
            })
          ) {
            throw new Error('Prepared presentation sources do not match the claimed run');
          }
          const transitioned = transitionPresentationRunState(current, {
            expectedRevision,
            dispatchStatus: 'committed',
            artifactPhase: 'sources_extracted',
            now: this.now().toISOString(),
          }) as StoredPresentationRunManifest;
          let next: StoredPresentationRunManifest = {
            ...transitioned,
            retainedBytes: current.retainedBytes + prepared.grounding.byteLength + prepared.record.byteLength,
            preparation: structuredClone(prepared.record),
          };
          for (;;) {
            const canonicalManifestBytes = Buffer.byteLength(`${JSON.stringify(next, null, 2)}\n`, 'utf8');
            const retainedBytes =
              current.retainedBytes +
              prepared.grounding.byteLength +
              prepared.record.byteLength +
              canonicalManifestBytes;
            if (retainedBytes === next.retainedBytes) break;
            next = { ...next, retainedBytes };
          }
          const additionalRetainedBytes = next.retainedBytes - current.retainedBytes;
          if (this.wouldExceedRetainedBytes(current.conversationId, additionalRetainedBytes)) {
            throw new PresentationRunStoreError('RESOURCE_LIMIT_EXCEEDED');
          }
          this.assertStoredRun(next, runId);
          handedToJournal = true;
          await this.runCanonicalTransaction(
            {
              preparedRunAssetPromotions: [prepared],
              mutations: [
                { entityKind: 'run', entityId: runId, expectedRevision: current.revision, nextManifest: next },
              ],
            },
            () => this.files.removePreparedRunAssets(prepared)
          );
          const cached = this.cacheRun(next);
          this.index = this.buildIndex();
          await this.persistDerivedIndexBestEffort();
          return this.snapshotRun(cached);
        }
      );
    } catch (error) {
      if (!handedToJournal) await this.files.removePreparedRunAssets(prepared);
      throw error;
    }
  }

  async retainCandidate(runId: string, expectedRevision: number): Promise<StoredPresentationRunManifest> {
    await this.initialize();
    this.assertStorageHealthy();
    return this.lock.runExclusive(['store:health', `run:${runId}`], async () => {
      this.assertStorageHealthy();
      const current = this.runs.get(runId);
      if (current === undefined) throw new Error('Presentation run not found');
      if (current.revision !== expectedRevision) throw new Error('Presentation run revision conflict');
      if (
        current.dispatchStatus !== 'terminal_verified' ||
        current.artifactPhase !== 'sources_extracted' ||
        current.retainedCandidate !== null ||
        !hasExactPresentationTerminalEvidence(current)
      ) {
        throw new Error('Candidate retention requires terminal verification');
      }
      const candidateByteLength = await this.files.getStagingCandidateByteLength(runId);
      if (this.wouldExceedRetainedBytes(current.conversationId, candidateByteLength)) {
        throw new Error('Presentation retained resource limit exceeded');
      }
      const prepared = await this.files.prepareRetainedCandidate(runId);
      if (this.wouldExceedRetainedBytes(current.conversationId, prepared.byteLength)) {
        await this.files.removePreparedRetainedCandidate(prepared);
        throw new Error('Presentation retained resource limit exceeded');
      }
      const normalized = currentLifecycleManifest(current);
      const retentionProof = {
        stagingBeforeRetain: prepared.stagingBeforeRetain ?? prepared.sha256,
        retainedTemp: prepared.retainedTemp ?? prepared.sha256,
        stagingAfterRetain: prepared.stagingAfterRetain ?? prepared.sha256,
      };
      const next = transitionPresentationRunState(normalized, {
        expectedRevision,
        dispatchStatus: 'terminal_verified',
        artifactPhase: 'candidate_retained',
        retainedCandidate: {
          relativePath: prepared.finalRelativePath,
          sha256: prepared.sha256,
          byteLength: prepared.byteLength,
        },
        retentionProof,
        now: this.now().toISOString(),
      }) as StoredPresentationRunManifest;
      next.retainedBytes = current.retainedBytes + prepared.byteLength;
      this.assertStoredRun(next, runId);
      await this.runCanonicalTransaction(
        {
          retainedCandidatePromotions: [prepared],
          mutations: [{ entityKind: 'run', entityId: runId, expectedRevision: current.revision, nextManifest: next }],
        },
        () => this.files.removePreparedRetainedCandidate(prepared)
      );
      const cached = this.cacheRun(next);
      this.index = this.buildIndex();
      await this.persistDerivedIndexBestEffort();
      return this.snapshotRun(cached);
    });
  }

  async getRun(runId: string): Promise<StoredPresentationRunManifest | null> {
    await this.initialize();
    this.assertStorageHealthy();
    return this.lock.runExclusive(['store:health'], async () => {
      this.assertStorageHealthy();
      const run = this.runs.get(runId) ?? this.tombstones.get(runId)?.discardedRun;
      return run === undefined ? null : this.snapshotRun(run);
    });
  }

  /** Returns verified Task-3 snapshots in the exact renderer-selected order recorded on the run. */
  async getClaimedSourceSnapshots(runId: string): Promise<ClaimedPresentationSourceSnapshot[]> {
    await this.initialize();
    this.assertStorageHealthy();
    if (!UUID_RE.test(runId)) throw new Error('Invalid presentation run id');
    const currentForLock = this.runs.get(runId);
    if (currentForLock === undefined) throw new Error('Presentation run not found');
    return this.lock.runExclusive(
      ['store:health', `run:${runId}`, ...currentForLock.sourceGrants.map((grantId) => `grant:${grantId}`)],
      async () => {
        this.assertStorageHealthy();
        const current = this.runs.get(runId);
        if (current === undefined) throw new Error('Presentation run not found');
        const snapshots: ClaimedPresentationSourceSnapshot[] = [];
        for (const grantId of current.sourceGrants) {
          const grant = this.sourceGrants.get(grantId);
          if (grant === undefined || grant.state !== 'claimed' || grant.claimedRunId !== runId) {
            throw new PresentationSourceStoreError('SOURCE_GRANT_INVALID', { grantId });
          }
          try {
            await this.files.verifySourceSnapshot({
              grantId,
              format: grant.format,
              relativePath: grant.snapshotRelativePath,
              sha256: grant.sha256,
              byteLength: grant.byteLength,
            });
          } catch (error) {
            throw new PresentationSourceStoreError('SOURCE_TAMPERED', { grantId }, { cause: error });
          }
          snapshots.push({
            grantId,
            displayName: grant.displayName,
            format: grant.format,
            sourceKind: grant.sourceKind,
            byteLength: grant.byteLength,
            sha256: grant.sha256,
            snapshotRelativePath: grant.snapshotRelativePath,
          });
        }
        return frozenSnapshot(snapshots);
      }
    );
  }

  async getByRequest(conversationId: string, clientRequestId: string): Promise<StoredPresentationRunManifest | null> {
    await this.initialize();
    this.assertStorageHealthy();
    return this.lock.runExclusive(['store:health'], async () => {
      this.assertStorageHealthy();
      return this.findByRequest(conversationId, clientRequestId);
    });
  }

  async claimInitialDispatch(unsafeInput: ClaimInitialPresentationDispatchInput): Promise<{
    status: 'claimed' | 'already_claimed';
    manifest: StoredPresentationRunManifest;
    leaseToken: string;
  }> {
    const input = frozenSnapshot(unsafeInput);
    await this.initialize();
    this.assertStorageHealthy();
    return this.lock.runExclusive(['store:health', `run:${input.runId}`], async () => {
      this.assertStorageHealthy();
      const current = this.runs.get(input.runId);
      if (current === undefined || current.conversationId !== input.conversationId) {
        throw new PresentationRunStoreError('RUN_STATE_CONFLICT');
      }
      if (current.dispatchStatus !== 'committed' || current.postInvoked) {
        throw new PresentationRunStoreError('RUN_STATE_CONFLICT');
      }
      const now = this.now();
      const currentLease = current.initialDispatchLease ?? null;
      if (currentLease !== null && Date.parse(currentLease.expiresAt) > now.getTime()) {
        if (currentLease.holderId !== input.holderId) throw new PresentationRunStoreError('LEASE_CONFLICT');
        return {
          status: 'already_claimed',
          manifest: this.snapshotRun(current),
          leaseToken: currentLease.leaseToken,
        };
      }
      if (current.revision !== input.expectedRevision) throw new PresentationRunStoreError('RUN_STATE_CONFLICT');
      const claimedAt = now.toISOString();
      const lease: PresentationInitialDispatchLease = {
        holderId: input.holderId,
        leaseToken: this.randomUUID(),
        claimedAt,
        expiresAt: new Date(now.getTime() + INITIAL_DISPATCH_LEASE_MS).toISOString(),
      };
      const normalized = currentLifecycleManifest(current);
      const next: StoredPresentationRunManifest = {
        ...normalized,
        revision: normalized.revision + 1,
        updatedAt: claimedAt,
        initialDispatchLease: lease,
      };
      this.assertStoredRun(next, input.runId);
      await this.commitRunMutation(current, next);
      return { status: 'claimed', manifest: this.snapshotRun(next), leaseToken: lease.leaseToken };
    });
  }

  async renewInitialDispatch(
    unsafeInput: RenewInitialPresentationDispatchInput
  ): Promise<{ status: 'renewed'; manifest: StoredPresentationRunManifest }> {
    const input = frozenSnapshot(unsafeInput);
    await this.initialize();
    this.assertStorageHealthy();
    return this.lock.runExclusive(['store:health', `run:${input.runId}`], async () => {
      this.assertStorageHealthy();
      const current = this.runs.get(input.runId);
      if (
        current === undefined ||
        current.conversationId !== input.conversationId ||
        current.dispatchStatus !== 'committed' ||
        current.postInvoked
      ) {
        throw new PresentationRunStoreError('RUN_STATE_CONFLICT');
      }
      if (current.revision !== input.expectedRevision) throw new PresentationRunStoreError('RUN_STATE_CONFLICT');
      const lease = current.initialDispatchLease ?? null;
      if (lease === null || !sameCapability(lease.leaseToken, input.leaseToken)) {
        throw new PresentationRunStoreError('LEASE_FOREIGN');
      }
      const now = this.now();
      if (Date.parse(lease.expiresAt) <= now.getTime()) throw new PresentationRunStoreError('LEASE_EXPIRED');
      const next: StoredPresentationRunManifest = {
        ...currentLifecycleManifest(current),
        revision: current.revision + 1,
        updatedAt: now.toISOString(),
        initialDispatchLease: {
          ...lease,
          expiresAt: new Date(now.getTime() + INITIAL_DISPATCH_LEASE_MS).toISOString(),
        },
      };
      this.assertStoredRun(next, input.runId);
      await this.commitRunMutation(current, next);
      return { status: 'renewed', manifest: this.snapshotRun(next) };
    });
  }

  async matchesInitialDispatchLease(unsafeInput: MatchInitialPresentationDispatchLeaseInput): Promise<boolean> {
    const input = frozenSnapshot(unsafeInput);
    await this.initialize();
    this.assertStorageHealthy();
    return this.lock.runExclusive(['store:health'], async () => {
      this.assertStorageHealthy();
      const current = this.runs.get(input.runId);
      if (current === undefined || current.conversationId !== input.conversationId) {
        throw new PresentationRunStoreError('RUN_STATE_CONFLICT');
      }
      const lease = current?.initialDispatchLease ?? null;
      if (current.dispatchStatus === 'committed' && current.revision !== input.expectedRevision) {
        throw new PresentationRunStoreError('RUN_STATE_CONFLICT');
      }
      if (lease === null || !sameCapability(lease.leaseToken, input.leaseToken)) {
        throw new PresentationRunStoreError('LEASE_FOREIGN');
      }
      if (!current.postInvoked && Date.parse(lease.expiresAt) <= this.now().getTime()) {
        throw new PresentationRunStoreError('LEASE_EXPIRED');
      }
      const leaseIsUsable = current.postInvoked === true || Date.parse(lease.expiresAt) > this.now().getTime();
      return leaseIsUsable;
    });
  }

  async beginInitialDispatch(
    unsafeInput: MatchInitialPresentationDispatchLeaseInput
  ): Promise<StoredPresentationRunManifest> {
    const input = frozenSnapshot(unsafeInput);
    await this.initialize();
    this.assertStorageHealthy();
    return this.lock.runExclusive(['store:health', 'policy:app', `run:${input.runId}`], async () => {
      this.assertStorageHealthy();
      const current = this.runs.get(input.runId);
      if (current === undefined || current.conversationId !== input.conversationId) {
        throw new PresentationRunStoreError('RUN_STATE_CONFLICT');
      }
      if (current.revision !== input.expectedRevision || current.dispatchStatus !== 'committed') {
        throw new PresentationRunStoreError('RUN_STATE_CONFLICT');
      }
      const lease = current.initialDispatchLease ?? null;
      if (lease === null || !sameCapability(lease.leaseToken, input.leaseToken)) {
        throw new PresentationRunStoreError('LEASE_FOREIGN');
      }
      if (Date.parse(lease.expiresAt) <= this.now().getTime()) throw new PresentationRunStoreError('LEASE_EXPIRED');
      const next = transitionPresentationRunState(currentLifecycleManifest(current), {
        expectedRevision: current.revision,
        dispatchStatus: 'dispatching',
        postInvoked: true,
        now: this.now().toISOString(),
      }) as StoredPresentationRunManifest;
      this.assertLiveGenerationCapacity(current.conversationId);
      await this.commitRunMutation(current, next);
      return this.snapshotRun(next);
    });
  }

  async settleDispatchUncertain(runId: string, expectedRevision: number): Promise<StoredPresentationRunManifest> {
    await this.initialize();
    this.assertStorageHealthy();
    return this.lock.runExclusive(['store:health', `run:${runId}`], async () => {
      this.assertStorageHealthy();
      const current = this.runs.get(runId);
      if (current === undefined) throw new PresentationRunStoreError('RUN_STATE_CONFLICT');
      if (current.dispatchStatus === 'dispatch_uncertain') return this.snapshotRun(current);
      if (current.revision !== expectedRevision || current.dispatchStatus !== 'dispatching') {
        throw new PresentationRunStoreError('RUN_STATE_CONFLICT');
      }
      const next = transitionPresentationRunState(currentLifecycleManifest(current), {
        expectedRevision,
        dispatchStatus: 'dispatch_uncertain',
        disposition: 'TRACKING_REQUIRED',
        now: this.now().toISOString(),
      }) as StoredPresentationRunManifest;
      await this.commitRunMutation(current, next);
      return this.snapshotRun(next);
    });
  }

  async settleCommittedPreflightFailure(
    runId: string,
    expectedRevision: number
  ): Promise<StoredPresentationRunManifest> {
    await this.initialize();
    this.assertStorageHealthy();
    return this.lock.runExclusive(['store:health', `run:${runId}`], async () => {
      this.assertStorageHealthy();
      const current = this.runs.get(runId);
      if (current === undefined || current.revision !== expectedRevision || current.dispatchStatus !== 'committed') {
        throw new PresentationRunStoreError('RUN_STATE_CONFLICT');
      }
      const next = transitionPresentationRunState(currentLifecycleManifest(current), {
        expectedRevision,
        dispatchStatus: 'failed_retained',
        disposition: 'TRACKING_REQUIRED',
        now: this.now().toISOString(),
      }) as StoredPresentationRunManifest;
      await this.commitRunMutation(current, next);
      return this.snapshotRun(next);
    });
  }

  async getRunByTurn(conversationId: string, turnId: string): Promise<StoredPresentationRunManifest | null> {
    await this.initialize();
    this.assertStorageHealthy();
    return this.lock.runExclusive(['store:health'], async () => {
      this.assertStorageHealthy();
      const runId = this.index.turns[`${conversationId}\u0000${turnId}`];
      if (runId === undefined) return null;
      const run = this.runs.get(runId);
      return run === undefined ? null : this.snapshotRun(run);
    });
  }

  async recordTerminalProof(
    runId: string,
    expectedRevision: number,
    unsafeEvidence: PresentationRunTerminalEvidence
  ): Promise<StoredPresentationRunManifest> {
    const evidence = frozenSnapshot(unsafeEvidence);
    await this.initialize();
    this.assertStorageHealthy();
    return this.lock.runExclusive(['store:health', `run:${runId}`], async () => {
      this.assertStorageHealthy();
      const current = this.runs.get(runId);
      if (current === undefined) throw new PresentationRunStoreError('RUN_STATE_CONFLICT');
      if (current.terminalEvidence !== undefined && current.terminalEvidence !== null) {
        if (isDeepStrictEqual(current.terminalEvidence, evidence)) return this.snapshotRun(current);
        throw new PresentationRunStoreError('RUN_STATE_CONFLICT');
      }
      if (current.revision !== expectedRevision || current.dispatchStatus !== 'bound') {
        throw new PresentationRunStoreError('RUN_STATE_CONFLICT');
      }
      const now = this.now().toISOString();
      const next: StoredPresentationRunManifest = {
        ...currentLifecycleManifest(current),
        revision: current.revision + 1,
        updatedAt: now,
        statusEnteredAt: now,
        dispatchStatus: 'terminal_verified',
        terminalEvidence: evidence,
      };
      this.assertStoredRun(next, runId);
      await this.commitRunMutation(current, next);
      return this.snapshotRun(next);
    });
  }

  async recordRuntimeReleaseObservation(
    runId: string,
    expectedRevision: number,
    observedAt: string
  ): Promise<{ status: 'observed' | 'tracking_required'; manifest: StoredPresentationRunManifest }> {
    await this.initialize();
    this.assertStorageHealthy();
    return this.lock.runExclusive(['store:health', `run:${runId}`], async () => {
      this.assertStorageHealthy();
      const current = this.runs.get(runId);
      const legacyNullableBound =
        current !== undefined && current.dispatchStatus === 'bound' && hasExactLegacyNullableBinding(current);
      const legacyFallback = current !== undefined && isLegacyRuntimeReleaseFallback(current);
      if (
        current === undefined ||
        current.revision !== expectedRevision ||
        (current.dispatchStatus !== 'bound' && !legacyFallback)
      ) {
        throw new PresentationRunStoreError('RUN_STATE_CONFLICT');
      }
      const observations = current.runtimeReleaseObservations ?? [];
      const first = observations[0];
      if (first === undefined || Date.parse(observedAt) - Date.parse(first) < RUNTIME_RELEASE_CONFIRMATION_MS) {
        const next: StoredPresentationRunManifest = legacyNullableBound
          ? {
              ...currentLifecycleManifest(current),
              revision: current.revision + 1,
              updatedAt: observedAt,
              statusEnteredAt: observedAt,
              dispatchStatus: 'dispatch_uncertain',
              disposition: 'TRACKING_REQUIRED',
              binding: null,
              runtimeReleaseObservations: [observedAt],
            }
          : {
              ...currentLifecycleManifest(current),
              revision: current.revision + 1,
              updatedAt: observedAt,
              runtimeReleaseObservations: first === undefined ? [observedAt] : [first],
            };
        this.assertStoredRun(next, runId);
        await this.commitRunMutation(current, next);
        return { status: 'observed', manifest: this.snapshotRun(next) };
      }
      const next: StoredPresentationRunManifest = legacyFallback
        ? {
            ...current,
            revision: current.revision + 1,
            updatedAt: observedAt,
            statusEnteredAt: observedAt,
            retainedAt: observedAt,
            dispatchStatus: 'retained',
            disposition: 'TRACKING_REQUIRED',
            binding: null,
            runtimeReleaseObservations: [first, observedAt],
          }
        : (transitionPresentationRunState(currentLifecycleManifest(current), {
            expectedRevision,
            dispatchStatus: 'retained',
            disposition: 'TRACKING_REQUIRED',
            now: observedAt,
          }) as StoredPresentationRunManifest);
      if (!legacyFallback) next.runtimeReleaseObservations = [first, observedAt];
      this.assertStoredRun(next, runId);
      await this.commitRunMutation(current, next);
      return { status: 'tracking_required', manifest: this.snapshotRun(next) };
    });
  }

  async settleReadinessSuccess(
    runId: string,
    expectedRevision: number,
    evidence: PresentationReadinessEvidence
  ): Promise<StoredPresentationRunManifest> {
    return this.settleReadiness(runId, expectedRevision, {
      status: 'passed',
      recordedAt: this.now().toISOString(),
      evidence,
    });
  }

  async settleReadinessFailure(
    runId: string,
    expectedRevision: number,
    readiness: Extract<PresentationRunReadiness, { status: 'blocked' | 'error' }>
  ): Promise<StoredPresentationRunManifest> {
    return this.settleReadiness(runId, expectedRevision, readiness);
  }

  async settleTerminalFailure(
    runId: string,
    expectedRevision: number,
    code: 'TERMINAL_PROOF_MISSING' | 'RETENTION_FAILED'
  ): Promise<StoredPresentationRunManifest> {
    if (code !== 'TERMINAL_PROOF_MISSING' && code !== 'RETENTION_FAILED') {
      throw new Error('Invalid presentation terminal failure code');
    }
    await this.initialize();
    this.assertStorageHealthy();
    return this.lock.runExclusive(['store:health', `run:${runId}`], async () => {
      this.assertStorageHealthy();
      const current = this.runs.get(runId);
      if (current === undefined) throw new PresentationRunStoreError('RUN_STATE_CONFLICT');
      if (current.dispatchStatus === 'failed_retained' && current.disposition === 'TRACKING_REQUIRED') {
        return this.snapshotRun(current);
      }
      if (current.revision !== expectedRevision || current.dispatchStatus !== 'terminal_verified') {
        throw new PresentationRunStoreError('RUN_STATE_CONFLICT');
      }
      const now = this.now().toISOString();
      const terminalProofMissing = code === 'TERMINAL_PROOF_MISSING';
      const hasCandidate = current.retainedCandidate !== null;
      const binding = hasExactLegacyNullableBinding(current) ? null : current.binding;
      const next: StoredPresentationRunManifest = {
        ...currentLifecycleManifest(current),
        revision: current.revision + 1,
        updatedAt: now,
        statusEnteredAt: now,
        retainedAt: now,
        dispatchStatus: 'failed_retained',
        artifactPhase: terminalProofMissing && hasCandidate ? 'sources_extracted' : current.artifactPhase,
        disposition: terminalProofMissing || !hasCandidate ? 'TRACKING_REQUIRED' : 'REVIEW_REQUIRED',
        retainedCandidate: terminalProofMissing ? null : current.retainedCandidate,
        retentionProof: terminalProofMissing ? null : current.retentionProof,
        binding,
        readiness: code === 'RETENTION_FAILED' ? { status: 'error', recordedAt: now, code } : null,
      };
      this.assertStoredRun(next, runId);
      await this.commitRunMutation(current, next);
      return this.snapshotRun(next);
    });
  }

  private async settleReadiness(
    runId: string,
    expectedRevision: number,
    readiness: PresentationRunReadiness
  ): Promise<StoredPresentationRunManifest> {
    const snapshot = frozenSnapshot(readiness);
    await this.initialize();
    this.assertStorageHealthy();
    return this.lock.runExclusive(['store:health', `run:${runId}`], async () => {
      this.assertStorageHealthy();
      const current = this.runs.get(runId);
      if (
        current === undefined ||
        current.revision !== expectedRevision ||
        current.dispatchStatus !== 'terminal_verified' ||
        current.artifactPhase !== 'candidate_retained' ||
        current.retainedCandidate === null ||
        !hasExactPresentationTerminalEvidence(current)
      ) {
        throw new PresentationRunStoreError('RUN_STATE_CONFLICT');
      }
      const now = snapshot.recordedAt;
      const passed = snapshot.status === 'passed';
      const next: StoredPresentationRunManifest = {
        ...currentLifecycleManifest(current),
        revision: current.revision + 1,
        updatedAt: now,
        statusEnteredAt: now,
        retainedAt: now,
        dispatchStatus: passed ? 'retained' : 'failed_retained',
        artifactPhase: passed ? 'rendered_exact_hash' : 'candidate_retained',
        disposition: 'REVIEW_REQUIRED',
        readiness: snapshot,
      };
      this.assertStoredRun(next, runId);
      await this.commitRunMutation(current, next);
      return this.snapshotRun(next);
    });
  }

  async transitionRun(
    runId: string,
    unsafeTransition: PresentationRunTransition
  ): Promise<StoredPresentationRunManifest> {
    const transition = frozenSnapshot(unsafeTransition);
    await this.initialize();
    this.assertStorageHealthy();
    const currentForLock = this.runs.get(runId);
    if (currentForLock === undefined) throw new Error('Presentation run not found');
    const isSafePredispatchPhaseMutation =
      currentForLock.dispatchStatus === 'allocating' &&
      transition.dispatchStatus === 'allocating' &&
      (transition.artifactPhase === undefined ||
        transition.artifactPhase === 'none' ||
        transition.artifactPhase === 'sources_snapshotted') &&
      transition.disposition === undefined &&
      transition.retainedCandidate === undefined &&
      transition.retentionProof === undefined &&
      transition.binding === undefined &&
      transition.postInvoked === undefined;
    if (!isSafePredispatchPhaseMutation) {
      throw new Error('Presentation lifecycle mutation requires a dedicated store method');
    }
    return this.lock.runExclusive(['store:health', `run:${runId}`], async () => {
      this.assertStorageHealthy();
      const current = this.runs.get(runId);
      if (current === undefined) throw new Error('Presentation run not found');
      const next = transitionPresentationRunState(current, transition) as StoredPresentationRunManifest;
      await this.commitRunMutation(current, next);
      return this.snapshotRun(next);
    });
  }

  async bindRunTurn(
    runId: string,
    unsafeInput: BindPresentationRunTurnInput
  ): Promise<{ status: 'bound' | 'already_bound'; manifest: StoredPresentationRunManifest }> {
    const input = frozenSnapshot(unsafeInput);
    await this.initialize();
    this.assertStorageHealthy();
    const currentForLock = this.runs.get(runId);
    if (currentForLock === undefined) throw new Error('Presentation run not found');
    return this.lock.runExclusive(
      [
        'store:health',
        `conversation:${input.conversationId}`,
        ...currentForLock.sourceGrants.map((grantId) => `grant:${grantId}`),
        `run:${runId}`,
        `turn:${turnIndexKey(input.conversationId, input.turnId)}`,
      ],
      async () => {
        this.assertStorageHealthy();
        const current = this.runs.get(runId);
        if (current === undefined) throw new Error('Presentation run not found');
        const turnKey = turnIndexKey(input.conversationId, input.turnId);
        const owner = getOwnIndexValue(this.index.turns, turnKey);
        if (owner !== undefined && owner !== runId) {
          throw new Error('Presentation conversation turn is already bound to another run');
        }
        const result = bindPresentationRunTurn(currentLifecycleManifest(current), input);
        if (result.status === 'already_bound') {
          return { status: result.status, manifest: this.snapshotRun(current) };
        }
        const next = result.manifest as StoredPresentationRunManifest;
        const claimedGrants = current.sourceGrants.flatMap((grantId) => {
          const grant = this.sourceGrants.get(grantId);
          if (grant === undefined) return [];
          if (grant.state !== 'claimed' || grant.claimedRunId !== runId) {
            throw new PresentationCanonicalCorruptionError('Presentation run references an invalid claimed grant');
          }
          const consumed: StoredPresentationSourceGrantManifest = {
            ...grant,
            revision: grant.revision + 1,
            updatedAt: input.now,
            stateEnteredAt: input.now,
            state: 'consumed',
          };
          assertPresentationSourceGrantManifest(consumed);
          return [consumed];
        });
        if (!isDeepStrictEqual(current.postAllocationFailure, next.postAllocationFailure)) {
          throw new Error('Presentation post-allocation failure is immutable');
        }
        this.assertStoredRun(next, current.runId);
        await this.runCanonicalTransaction({
          mutations: [
            {
              entityKind: 'run',
              entityId: current.runId,
              expectedRevision: current.revision,
              nextManifest: next,
            },
            ...claimedGrants.map((grant) => ({
              entityKind: 'grant' as const,
              entityId: grant.grantId,
              expectedRevision: grant.revision - 1,
              nextManifest: grant,
            })),
          ],
        });
        this.cacheRun(next);
        for (const grant of claimedGrants) this.sourceGrants.set(grant.grantId, frozenSnapshot(grant));
        this.index = this.buildIndex();
        await this.persistDerivedIndexBestEffort();
        return { status: result.status, manifest: this.snapshotRun(next) };
      }
    );
  }

  async listPublicRecoverable(conversationId: string): Promise<StoredPresentationRunManifest[]> {
    await this.initialize();
    this.assertStorageHealthy();
    const recoverable = new Set(['retained', 'failed_retained', 'dispatch_uncertain']);
    return this.lock.runExclusive(['store:health'], async () => {
      this.assertStorageHealthy();
      return this.sortedRuns((run) => run.conversationId === conversationId && recoverable.has(run.dispatchStatus));
    });
  }

  async listDispatchReconciliation(): Promise<StoredPresentationRunManifest[]> {
    await this.initialize();
    this.assertStorageHealthy();
    return this.lock.runExclusive(['store:health'], async () => {
      this.assertStorageHealthy();
      return this.sortedRuns(
        (run) =>
          run.dispatchStatus === 'dispatching' || run.dispatchStatus === 'bound' || isLegacyRuntimeReleaseFallback(run)
      );
    });
  }

  async listTerminalReconciliation(): Promise<StoredPresentationRunManifest[]> {
    await this.initialize();
    this.assertStorageHealthy();
    return this.lock.runExclusive(['store:health'], async () => {
      this.assertStorageHealthy();
      return this.sortedRuns((run) => run.dispatchStatus === 'terminal_verified');
    });
  }

  async listSettledInspectionCleanup(): Promise<string[]> {
    await this.initialize();
    this.assertStorageHealthy();
    return this.lock.runExclusive(['store:health'], async () => {
      this.assertStorageHealthy();
      return this.sortedRuns(
        (run) =>
          (run.dispatchStatus === 'retained' || run.dispatchStatus === 'failed_retained') &&
          run.readiness !== undefined &&
          run.readiness !== null
      ).map(({ runId }) => runId);
    });
  }

  async listCommittedForInitialDispatch(): Promise<StoredPresentationRunManifest[]> {
    await this.initialize();
    this.assertStorageHealthy();
    return this.lock.runExclusive(['store:health'], async () => {
      this.assertStorageHealthy();
      return this.sortedRuns((run) => run.dispatchStatus === 'committed' && !run.postInvoked);
    });
  }

  async discardRun(runId: string, expectedRevision: number): Promise<StoredPresentationRunManifest> {
    await this.initialize();
    this.assertStorageHealthy();
    return this.lock.runExclusive(['store:health', 'policy:app', `run:${runId}`], async () => {
      this.assertStorageHealthy();
      const existingTombstone = this.tombstones.get(runId);
      if (existingTombstone !== undefined) {
        await this.cleanupTombstonedRun(existingTombstone);
        return this.snapshotRun(existingTombstone.discardedRun);
      }
      const current = this.runs.get(runId);
      if (current === undefined) throw new Error('Presentation run not found');
      const discarded = transitionPresentationRunState(current, {
        expectedRevision,
        dispatchStatus: 'discarded',
        now: this.now().toISOString(),
      }) as StoredPresentationRunManifest;
      return this.persistTombstone(current, discarded);
    });
  }

  async sweepExpiredRuns(): Promise<PresentationRunSweepResult> {
    await this.initialize();
    this.assertStorageHealthy();
    return this.lock.runExclusive(['store:health', 'policy:app'], async () => {
      this.assertStorageHealthy();
      return this.sweepCanonicalState(this.now());
    });
  }

  async sweepExpiredPresentationSources(): Promise<PresentationSourceSweepResult> {
    await this.initialize();
    this.assertStorageHealthy();
    return this.lock.runExclusive(['store:health', 'policy:app'], async () => {
      this.assertStorageHealthy();
      return this.sweepPresentationSources(this.now());
    });
  }

  private async initializeOnce(): Promise<void> {
    await this.files.initialize();
    await this.journal.recover();
    await this.reloadCanonicalState();
    await this.sweepCanonicalState(this.now());
    await this.sweepPresentationSources(this.now());
  }

  private async sweepCanonicalState(now: Date): Promise<PresentationRunSweepResult> {
    const nowIso = now.toISOString();
    const result: PresentationRunSweepResult = {
      failedRetained: [],
      tombstoned: [],
      purgedTombstones: [],
      operatorAlerts: [],
    };
    for (const run of Array.from(this.runs.values())) {
      if (
        run.dispatchStatus === 'allocating' &&
        now.getTime() - Date.parse(run.createdAt) >= PRESENTATION_RUN_LIMITS.ALLOCATING_TTL_MS
      ) {
        const next = transitionPresentationRunState(run, {
          expectedRevision: run.revision,
          dispatchStatus: 'failed_retained',
          disposition: 'TRACKING_REQUIRED',
          now: nowIso,
        }) as StoredPresentationRunManifest;
        await this.commitRunMutation(run, next);
        result.failedRetained.push(run.runId);
        continue;
      }
      if (
        run.dispatchStatus === 'committed' &&
        run.committedAt !== null &&
        now.getTime() - Date.parse(run.committedAt) >= PRESENTATION_RUN_LIMITS.COMMITTED_TTL_MS
      ) {
        const next = transitionPresentationRunState(run, {
          expectedRevision: run.revision,
          dispatchStatus: 'failed_retained',
          disposition: 'TRACKING_REQUIRED',
          now: nowIso,
        }) as StoredPresentationRunManifest;
        await this.commitRunMutation(run, next);
        result.failedRetained.push(run.runId);
        continue;
      }
      if (
        (run.dispatchStatus === 'retained' || run.dispatchStatus === 'failed_retained') &&
        run.retainedAt !== null &&
        now.getTime() - Date.parse(run.retainedAt) >= PRESENTATION_RUN_LIMITS.FAILED_OR_REVIEW_RETENTION_MS
      ) {
        const discarded = this.createGarbageCollectedDiscard(run, nowIso);
        await this.persistTombstone(run, discarded);
        result.tombstoned.push(run.runId);
        continue;
      }
      if (
        run.dispatchStatus === 'dispatch_uncertain' &&
        now.getTime() - Date.parse(run.statusEnteredAt) >= PRESENTATION_RUN_LIMITS.UNCERTAIN_OPERATOR_ALERT_MS
      ) {
        result.operatorAlerts.push(run.runId);
      }
    }
    for (const tombstone of Array.from(this.tombstones.values())) {
      await this.cleanupTombstonedRun(tombstone);
      if (now.getTime() - Date.parse(tombstone.tombstonedAt) >= PRESENTATION_RUN_LIMITS.TOMBSTONE_RETENTION_MS) {
        await this.files.removeTombstone('run', tombstone.runId);
        this.tombstones.delete(tombstone.runId);
        result.purgedTombstones.push(tombstone.runId);
      }
    }
    if (result.purgedTombstones.length > 0) {
      this.index = this.buildIndex();
      await this.persistDerivedIndexBestEffort();
    }
    return result;
  }

  private async reloadCanonicalState(): Promise<void> {
    const scannedRuns = new Map<string, StoredPresentationRunManifest>();
    const scannedTombstones = new Map<string, StoredPresentationRunTombstone>();
    const scannedOwners = new Map<string, StoredPresentationSourceOwnerManifest>();
    const scannedGrants = new Map<string, StoredPresentationSourceGrantManifest>();
    const scannedGrantTombstones = new Map<string, StoredPresentationSourceGrantTombstone>();
    const scannedDrafts = new Map<string, StoredPresentationSourceDraftManifest>();
    const scannedDraftTombstones = new Map<string, StoredPresentationSourceDraftTombstone>();
    for (const grantId of (await this.files.listTombstoneIds('grant')).toSorted()) {
      try {
        const tombstone = await this.journal.readCanonical<StoredPresentationSourceGrantTombstone>(
          'grant-tombstone',
          grantId
        );
        if (tombstone === null) throw new PresentationCanonicalCorruptionError('Source grant tombstone is missing');
        assertPresentationSourceGrantTombstone(tombstone);
        await this.files.removeGrant(grantId);
        scannedGrantTombstones.set(grantId, frozenSnapshot(tombstone));
      } catch (error) {
        if (
          !(error instanceof PresentationCanonicalCorruptionError) &&
          !(error instanceof Error && error.message.startsWith('Invalid presentation source'))
        )
          throw error;
        await this.files.quarantineEntity('grant-tombstone', grantId);
      }
    }
    for (const draftId of (await this.files.listTombstoneIds('draft')).toSorted()) {
      try {
        const tombstone = await this.journal.readCanonical<StoredPresentationSourceDraftTombstone>(
          'draft-tombstone',
          draftId
        );
        if (tombstone === null) throw new PresentationCanonicalCorruptionError('Source draft tombstone is missing');
        assertPresentationSourceDraftTombstone(tombstone);
        await this.files.removeDraft(draftId);
        scannedDraftTombstones.set(draftId, frozenSnapshot(tombstone));
      } catch (error) {
        if (
          !(error instanceof PresentationCanonicalCorruptionError) &&
          !(error instanceof Error && error.message.startsWith('Invalid presentation source'))
        )
          throw error;
        await this.files.quarantineEntity('draft-tombstone', draftId);
      }
    }
    for (const ownerId of (await this.files.listEntityIds('owner')).toSorted()) {
      try {
        const owner = await this.journal.readCanonical<StoredPresentationSourceOwnerManifest>('owner', ownerId);
        if (owner === null) throw new PresentationCanonicalCorruptionError('Source owner manifest is missing');
        assertPresentationSourceOwnerManifest(owner);
        if (owner.ownerId !== ownerId || presentationSourceOwnerId(owner.owner) !== ownerId) {
          throw new PresentationCanonicalCorruptionError('Source owner manifest id is corrupt');
        }
        scannedOwners.set(ownerId, frozenSnapshot(owner));
      } catch (error) {
        if (
          !(error instanceof PresentationCanonicalCorruptionError) &&
          !(error instanceof Error && error.message.startsWith('Invalid presentation source'))
        )
          throw error;
        await this.files.quarantineEntity('owner', ownerId);
      }
    }
    for (const grantId of (await this.files.listEntityIds('grant')).toSorted()) {
      if (scannedGrantTombstones.has(grantId)) continue;
      try {
        const value = await this.journal.readCanonical<Record<string, unknown>>('grant', grantId);
        if (value === null) {
          if (await this.files.removeAbandonedPreparedSourceGrant(grantId)) continue;
          throw new PresentationCanonicalCorruptionError('Source grant manifest is missing');
        }
        if (value.recordType !== 'presentation-source-grant') {
          if (!isStructurallyValidGrant(value, grantId)) {
            throw new PresentationCanonicalCorruptionError('Source grant manifest is corrupt');
          }
          continue;
        }
        const grant = value as StoredPresentationSourceGrantManifest;
        assertPresentationSourceGrantManifest(grant);
        await this.files.verifySourceSnapshot({
          grantId,
          format: grant.format,
          relativePath: grant.snapshotRelativePath,
          sha256: grant.sha256,
          byteLength: grant.byteLength,
        });
        await this.files.removeUnreferencedSourceTemps(grantId);
        scannedGrants.set(grantId, frozenSnapshot(grant));
      } catch (error) {
        if (
          !(error instanceof PresentationCanonicalCorruptionError) &&
          !(error instanceof Error && error.message.startsWith('Invalid presentation source'))
        ) {
          throw error;
        }
        await this.files.quarantineEntity('grant', grantId);
      }
    }
    for (const draftId of (await this.files.listEntityIds('draft')).toSorted()) {
      if (scannedDraftTombstones.has(draftId)) continue;
      try {
        const draft = await this.journal.readCanonical<StoredPresentationSourceDraftManifest>('draft', draftId);
        if (draft === null) throw new PresentationCanonicalCorruptionError('Source draft manifest is missing');
        assertPresentationSourceDraftManifest(draft);
        if (draft.draftId !== draftId) throw new PresentationCanonicalCorruptionError('Source draft id is corrupt');
        scannedDrafts.set(draftId, frozenSnapshot(draft));
      } catch (error) {
        if (
          !(error instanceof PresentationCanonicalCorruptionError) &&
          !(error instanceof Error && error.message.startsWith('Invalid presentation source'))
        )
          throw error;
        await this.files.quarantineEntity('draft', draftId);
      }
    }
    for (const runId of (await this.files.listTombstoneIds('run')).toSorted()) {
      let tombstone: StoredPresentationRunTombstone | null;
      try {
        tombstone = await this.journal.readCanonical<StoredPresentationRunTombstone>('run-tombstone', runId);
        if (tombstone === null) {
          throw new PresentationCanonicalCorruptionError('Presentation run tombstone is missing');
        }
        this.assertStoredTombstone(tombstone, runId);
      } catch (error) {
        if (!(error instanceof PresentationCanonicalCorruptionError)) throw error;
        await this.files.quarantineEntity('run-tombstone', runId);
        continue;
      }
      await this.cleanupTombstonedRun(tombstone);
      scannedTombstones.set(runId, frozenSnapshot(tombstone));
    }
    for (const runId of (await this.files.listEntityIds('run')).toSorted()) {
      let run: StoredPresentationRunManifest | null;
      try {
        run = await this.journal.readCanonical<StoredPresentationRunManifest>('run', runId);
        if (run === null) {
          throw new PresentationCanonicalCorruptionError('Presentation run manifest is missing');
        }
        this.assertStoredRun(run, runId);
      } catch (error) {
        if (!(error instanceof PresentationCanonicalCorruptionError)) throw error;
        await this.files.quarantineEntity('run', runId);
        continue;
      }
      await this.files.removeUnreferencedCandidateTemps(runId);
      const cached = frozenSnapshot(run);
      scannedRuns.set(cached.runId, cached);
    }
    this.runs.clear();
    for (const [runId, run] of scannedRuns) this.runs.set(runId, run);
    this.tombstones.clear();
    for (const [runId, tombstone] of scannedTombstones) this.tombstones.set(runId, tombstone);
    this.sourceOwners.clear();
    for (const [ownerId, owner] of scannedOwners) this.sourceOwners.set(ownerId, owner);
    this.sourceGrants.clear();
    for (const [grantId, grant] of scannedGrants) this.sourceGrants.set(grantId, grant);
    this.sourceGrantTombstones.clear();
    for (const [grantId, tombstone] of scannedGrantTombstones) this.sourceGrantTombstones.set(grantId, tombstone);
    this.sourceDrafts.clear();
    for (const [draftId, draft] of scannedDrafts) this.sourceDrafts.set(draftId, draft);
    this.sourceDraftTombstones.clear();
    for (const [draftId, tombstone] of scannedDraftTombstones) this.sourceDraftTombstones.set(draftId, tombstone);
    this.assertSourceCanonicalReferences();
    this.index = this.buildIndex();
    this.rebuildRateBuckets();
    await this.persistDerivedIndexBestEffort();
  }

  private async sweepPresentationSources(now: Date): Promise<PresentationSourceSweepResult> {
    const result: PresentationSourceSweepResult = {
      expiredDrafts: [],
      expiredGrants: [],
      purgedDraftTombstones: [],
      purgedGrantTombstones: [],
    };
    for (const draft of Array.from(this.sourceDrafts.values())) {
      if (draft.state !== 'active' || Date.parse(draft.expiresAt) > now.getTime()) continue;
      const owner = this.sourceOwners.get(presentationSourceOwnerId({ owner_type: 'draft', draft_id: draft.draftId }));
      if (owner === undefined) throw new PresentationCanonicalCorruptionError('Presentation draft owner is missing');
      await this.expireDraftLocked(draft, owner, now.toISOString());
      result.expiredDrafts.push(draft.draftId);
    }
    for (const grant of Array.from(this.sourceGrants.values())) {
      if (grant.state !== 'active' || Date.parse(grant.expiresAt) > now.getTime()) continue;
      await this.expireGrantLocked(grant, now.toISOString());
      result.expiredGrants.push(grant.grantId);
    }
    for (const tombstone of Array.from(this.sourceGrantTombstones.values())) {
      await this.files.removeGrant(tombstone.grantId);
      if (Date.parse(tombstone.deleteAfter) > now.getTime()) continue;
      await this.files.removeTombstone('grant', tombstone.grantId);
      this.sourceGrantTombstones.delete(tombstone.grantId);
      result.purgedGrantTombstones.push(tombstone.grantId);
    }
    for (const tombstone of Array.from(this.sourceDraftTombstones.values())) {
      await this.files.removeDraft(tombstone.draftId);
      if (Date.parse(tombstone.deleteAfter) > now.getTime()) continue;
      const ownerKey: PresentationGrantOwner = { owner_type: 'draft', draft_id: tombstone.draftId };
      const ownerId = presentationSourceOwnerId(ownerKey);
      const owner = this.sourceOwners.get(ownerId);
      if (owner !== undefined && owner.draftLifecycle !== 'purged') {
        const nextOwner: StoredPresentationSourceOwnerManifest = {
          ...owner,
          revision: owner.revision + 1,
          updatedAt: now.toISOString(),
          draftLifecycle: 'purged',
        };
        assertPresentationSourceOwnerManifest(nextOwner);
        await this.runCanonicalTransaction({
          mutations: [
            {
              entityKind: 'owner',
              entityId: ownerId,
              expectedRevision: owner.revision,
              nextManifest: nextOwner,
            },
          ],
        });
        this.sourceOwners.set(ownerId, frozenSnapshot(nextOwner));
      }
      await this.files.removeTombstone('draft', tombstone.draftId);
      this.sourceDraftTombstones.delete(tombstone.draftId);
      result.purgedDraftTombstones.push(tombstone.draftId);
    }
    if (
      result.expiredDrafts.length > 0 ||
      result.expiredGrants.length > 0 ||
      result.purgedDraftTombstones.length > 0 ||
      result.purgedGrantTombstones.length > 0
    ) {
      this.index = this.buildIndex();
      await this.persistDerivedIndexBestEffort();
    }
    return result;
  }

  private async expirePresentationSourceOwnerIfNeeded(_owner: PresentationGrantOwner): Promise<void> {
    await this.sweepExpiredPresentationSources();
  }

  private requireMutableSourceOwner(
    owner: PresentationGrantOwner,
    principalId: string,
    expectedRevision: number
  ): StoredPresentationSourceOwnerManifest {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
      throw new PresentationSourceStoreError('INVALID_REQUEST');
    }
    const ownerId = presentationSourceOwnerId(owner);
    const existing = this.sourceOwners.get(ownerId);
    if (existing === undefined) {
      if (owner.owner_type === 'draft') this.throwDraftLookupFailure(owner.draft_id, principalId);
      if (expectedRevision !== 0) throw new PresentationSourceStoreError('INVALID_REQUEST');
      return {
        version: 2,
        recordType: 'presentation-source-owner',
        ownerId,
        owner: structuredClone(owner),
        principalId,
        revision: 0,
        createdAt: '',
        updatedAt: '',
        grantIds: [],
        unboundBytes: 0,
        draftClientRequestId: null,
        draftLifecycle: null,
      };
    }
    if (existing.principalId !== principalId) {
      throw new PresentationSourceStoreError(owner.owner_type === 'draft' ? 'DRAFT_FOREIGN' : 'RUN_FORBIDDEN');
    }
    if (owner.owner_type === 'draft') {
      if (existing.draftLifecycle === 'expired') {
        throw new PresentationSourceStoreError('DRAFT_EXPIRED', { draftId: owner.draft_id });
      }
      if (existing.draftLifecycle !== 'active') throw new PresentationSourceStoreError('DRAFT_NOT_FOUND');
    }
    if (existing.revision !== expectedRevision) throw new PresentationSourceStoreError('INVALID_REQUEST');
    return frozenSnapshot(existing);
  }

  private throwDraftLookupFailure(draftId: string, principalId: string): never {
    const tombstone = this.sourceDraftTombstones.get(draftId);
    if (tombstone !== undefined) {
      if (Date.parse(tombstone.deleteAfter) <= this.now().getTime()) {
        throw new PresentationSourceStoreError('DRAFT_NOT_FOUND');
      }
      if (tombstone.principalId !== principalId) throw new PresentationSourceStoreError('DRAFT_FOREIGN');
      if (tombstone.terminalState === 'expired') {
        throw new PresentationSourceStoreError('DRAFT_EXPIRED', { draftId });
      }
    }
    throw new PresentationSourceStoreError('DRAFT_NOT_FOUND');
  }

  private createGrantTombstone(
    grant: StoredPresentationSourceGrantManifest,
    terminalState: StoredPresentationSourceGrantTombstone['terminalState'],
    now: string
  ): StoredPresentationSourceGrantTombstone {
    const tombstone: StoredPresentationSourceGrantTombstone = {
      version: 2,
      recordType: 'presentation-source-grant-tombstone',
      revision: 0,
      grantId: grant.grantId,
      owner: structuredClone(grant.owner),
      terminalState,
      terminalAt: now,
      tombstonedAt: now,
      deleteAfter: new Date(Date.parse(now) + PRESENTATION_RUN_LIMITS.TOMBSTONE_RETENTION_MS).toISOString(),
      lastRevision: grant.revision,
    };
    assertPresentationSourceGrantTombstone(tombstone);
    return tombstone;
  }

  private async expireGrantLocked(grant: StoredPresentationSourceGrantManifest, now: string): Promise<void> {
    const ownerId = presentationSourceOwnerId(grant.owner);
    const owner = this.sourceOwners.get(ownerId);
    if (owner === undefined) throw new PresentationCanonicalCorruptionError('Presentation source owner is missing');
    const nextGrant: StoredPresentationSourceGrantManifest = {
      ...grant,
      revision: grant.revision + 1,
      updatedAt: now,
      stateEnteredAt: now,
      state: 'expired',
    };
    const nextOwner: StoredPresentationSourceOwnerManifest = {
      ...owner,
      revision: owner.revision + 1,
      updatedAt: now,
      grantIds: owner.grantIds.filter((grantId) => grantId !== grant.grantId),
      unboundBytes: owner.unboundBytes - grant.byteLength,
    };
    const tombstone = this.createGrantTombstone(nextGrant, 'expired', now);
    await this.runCanonicalTransaction({
      mutations: [
        {
          entityKind: 'grant',
          entityId: grant.grantId,
          expectedRevision: grant.revision,
          nextManifest: nextGrant,
        },
        {
          entityKind: 'grant-tombstone',
          entityId: grant.grantId,
          expectedRevision: null,
          nextManifest: tombstone,
        },
        { entityKind: 'owner', entityId: ownerId, expectedRevision: owner.revision, nextManifest: nextOwner },
      ],
    });
    this.sourceGrants.delete(grant.grantId);
    this.sourceGrantTombstones.set(grant.grantId, frozenSnapshot(tombstone));
    this.sourceOwners.set(ownerId, frozenSnapshot(nextOwner));
    await this.files.removeGrant(grant.grantId);
  }

  private async expireDraftLocked(
    draft: StoredPresentationSourceDraftManifest,
    owner: StoredPresentationSourceOwnerManifest,
    timestamp = this.now().toISOString()
  ): Promise<void> {
    const grants = owner.grantIds.map((grantId) => {
      const grant = this.sourceGrants.get(grantId);
      if (grant === undefined || grant.state !== 'active') {
        throw new PresentationCanonicalCorruptionError('Presentation draft references an invalid grant');
      }
      return grant;
    });
    const nextOwner: StoredPresentationSourceOwnerManifest = {
      ...owner,
      revision: owner.revision + 1,
      updatedAt: timestamp,
      grantIds: [],
      unboundBytes: 0,
      draftLifecycle: 'expired',
    };
    const nextDraft: StoredPresentationSourceDraftManifest = {
      ...draft,
      revision: draft.revision + 1,
    };
    const draftTombstone: StoredPresentationSourceDraftTombstone = {
      version: 2,
      recordType: 'presentation-source-draft-tombstone',
      revision: 0,
      draftId: draft.draftId,
      clientRequestId: draft.clientRequestId,
      principalId: draft.principalId,
      terminalState: 'expired',
      terminalAt: timestamp,
      tombstonedAt: timestamp,
      deleteAfter: new Date(Date.parse(timestamp) + PRESENTATION_RUN_LIMITS.TOMBSTONE_RETENTION_MS).toISOString(),
      lastRevision: nextDraft.revision,
      boundConversationId: null,
    };
    const expiredGrants = grants.map<StoredPresentationSourceGrantManifest>((grant) => ({
      ...grant,
      revision: grant.revision + 1,
      updatedAt: timestamp,
      stateEnteredAt: timestamp,
      state: 'expired',
    }));
    const grantTombstones = expiredGrants.map((grant) => this.createGrantTombstone(grant, 'expired', timestamp));
    assertPresentationSourceDraftManifest(nextDraft);
    await this.runCanonicalTransaction({
      mutations: [
        {
          entityKind: 'draft',
          entityId: draft.draftId,
          expectedRevision: draft.revision,
          nextManifest: nextDraft,
        },
        { entityKind: 'owner', entityId: owner.ownerId, expectedRevision: owner.revision, nextManifest: nextOwner },
        {
          entityKind: 'draft-tombstone',
          entityId: draft.draftId,
          expectedRevision: null,
          nextManifest: draftTombstone,
        },
        ...expiredGrants.flatMap((grant, index) => [
          {
            entityKind: 'grant' as const,
            entityId: grant.grantId,
            expectedRevision: grants[index]?.revision ?? null,
            nextManifest: grant,
          },
          {
            entityKind: 'grant-tombstone' as const,
            entityId: grant.grantId,
            expectedRevision: null as null,
            nextManifest: grantTombstones[index] as StoredPresentationSourceGrantTombstone,
          },
        ]),
      ],
    });
    this.sourceDrafts.delete(draft.draftId);
    this.sourceDraftTombstones.set(draft.draftId, frozenSnapshot(draftTombstone));
    this.sourceOwners.set(owner.ownerId, frozenSnapshot(nextOwner));
    for (const [index, grant] of expiredGrants.entries()) {
      this.sourceGrants.delete(grant.grantId);
      this.sourceGrantTombstones.set(
        grant.grantId,
        frozenSnapshot(grantTombstones[index] as StoredPresentationSourceGrantTombstone)
      );
      await this.files.removeGrant(grant.grantId);
    }
    await this.files.removeDraft(draft.draftId);
  }

  private assertSourceCanonicalReferences(): void {
    for (const owner of this.sourceOwners.values()) {
      let bytes = 0;
      for (const grantId of owner.grantIds) {
        const grant = this.sourceGrants.get(grantId);
        if (
          grant === undefined ||
          grant.state !== 'active' ||
          presentationSourceOwnerKey(grant.owner) !== presentationSourceOwnerKey(owner.owner)
        ) {
          throw new PresentationCanonicalCorruptionError('Presentation source ownership is corrupt');
        }
        bytes += grant.byteLength;
      }
      if (bytes !== owner.unboundBytes) {
        throw new PresentationCanonicalCorruptionError('Presentation source owner byte accounting is corrupt');
      }
      if (owner.owner.owner_type === 'draft' && owner.draftLifecycle === 'active') {
        const draft = this.sourceDrafts.get(owner.owner.draft_id);
        if (draft === undefined || draft.principalId !== owner.principalId || draft.revision !== owner.revision) {
          throw new PresentationCanonicalCorruptionError('Presentation source draft ownership is corrupt');
        }
      }
    }
    for (const grant of this.sourceGrants.values()) {
      const owner = this.sourceOwners.get(presentationSourceOwnerId(grant.owner));
      if (grant.state === 'active') {
        if (owner === undefined || !owner.grantIds.includes(grant.grantId)) {
          throw new PresentationCanonicalCorruptionError('Active presentation source grant has no owner accounting');
        }
        continue;
      }
      if (grant.state === 'claimed' || grant.state === 'consumed') {
        const run =
          grant.claimedRunId === null
            ? undefined
            : (this.runs.get(grant.claimedRunId) ?? this.tombstones.get(grant.claimedRunId)?.discardedRun);
        if (
          owner?.grantIds.includes(grant.grantId) === true ||
          run === undefined ||
          !run.sourceGrants.includes(grant.grantId)
        ) {
          throw new PresentationCanonicalCorruptionError('Claimed presentation source grant has no run accounting');
        }
        continue;
      }
      throw new PresentationCanonicalCorruptionError('Terminal presentation source grant has no tombstone');
    }
  }

  private async findByRequest(
    conversationId: string,
    clientRequestId: string
  ): Promise<StoredPresentationRunManifest | null> {
    const indexedRunId = getOwnIndexValue(this.index.requests, requestIndexKey(conversationId, clientRequestId));
    if (indexedRunId !== undefined) {
      const indexed = this.runs.get(indexedRunId);
      const indexedTombstone = this.tombstones.get(indexedRunId)?.discardedRun;
      const indexedRecord = indexed ?? indexedTombstone;
      if (
        indexedRecord !== undefined &&
        indexedRecord.conversationId === conversationId &&
        indexedRecord.clientRequestId === clientRequestId
      ) {
        return this.snapshotRun(indexedRecord);
      }
    }
    for (const run of this.runs.values()) {
      if (run.conversationId === conversationId && run.clientRequestId === clientRequestId) {
        return this.snapshotRun(run);
      }
    }
    for (const tombstone of this.tombstones.values()) {
      const run = tombstone.discardedRun;
      if (run.conversationId === conversationId && run.clientRequestId === clientRequestId) {
        return this.snapshotRun(run);
      }
    }
    return null;
  }

  private addRunToIndex(run: StoredPresentationRunManifest, index: PresentationRunIndex = this.index): void {
    const requestKey = requestIndexKey(run.conversationId, run.clientRequestId);
    const requestOwner = getOwnIndexValue(index.requests, requestKey);
    if (requestOwner !== undefined && requestOwner !== run.runId) {
      throw new PresentationCanonicalCorruptionError('Duplicate presentation request ownership');
    }
    index.requests[requestKey] = run.runId;
    const runs = getOwnIndexValue(index.conversations, run.conversationId) ?? [];
    if (!runs.includes(run.runId)) runs.push(run.runId);
    index.conversations[run.conversationId] = runs;
    if (run.binding !== null) {
      const turnKey = turnIndexKey(run.binding.conversationId, run.binding.turnId);
      const turnOwner = getOwnIndexValue(index.turns, turnKey);
      if (turnOwner !== undefined && turnOwner !== run.runId) {
        throw new PresentationCanonicalCorruptionError('Duplicate presentation turn ownership');
      }
      index.turns[turnKey] = run.runId;
    }
    for (const grantId of run.sourceGrants) {
      const grantOwner = getOwnIndexValue(index.grants, grantId);
      if (grantOwner !== undefined && grantOwner !== run.runId) {
        throw new PresentationCanonicalCorruptionError('Duplicate presentation grant ownership');
      }
      index.grants[grantId] = run.runId;
    }
  }

  private async commitRunMutation(
    current: StoredPresentationRunManifest,
    next: StoredPresentationRunManifest
  ): Promise<void> {
    if (!isDeepStrictEqual(current.postAllocationFailure, next.postAllocationFailure)) {
      throw new Error('Presentation post-allocation failure is immutable');
    }
    this.assertStoredRun(next, current.runId);
    await this.runCanonicalTransaction({
      mutations: [
        {
          entityKind: 'run',
          entityId: current.runId,
          expectedRevision: current.revision,
          nextManifest: next,
        },
      ],
    });
    this.cacheRun(next);
    this.index = this.buildIndex();
    await this.persistDerivedIndexBestEffort();
  }

  private async persistTombstone(
    current: StoredPresentationRunManifest,
    discarded: StoredPresentationRunManifest
  ): Promise<StoredPresentationRunManifest> {
    const tombstone: StoredPresentationRunTombstone = {
      version: 2,
      tombstoneType: 'presentation-run',
      revision: 0,
      runId: current.runId,
      tombstonedAt: discarded.updatedAt,
      discardedRun: frozenSnapshot(discarded),
    };
    this.assertStoredTombstone(tombstone, current.runId);
    await this.runCanonicalTransaction({
      mutations: [
        {
          entityKind: 'run',
          entityId: current.runId,
          expectedRevision: current.revision,
          nextManifest: discarded,
        },
        {
          entityKind: 'run-tombstone',
          entityId: current.runId,
          expectedRevision: null,
          nextManifest: tombstone,
        },
      ],
    });
    const cachedTombstone = frozenSnapshot(tombstone);
    this.tombstones.set(current.runId, cachedTombstone);
    this.runs.delete(current.runId);
    this.index = this.buildIndex();
    await this.persistDerivedIndexBestEffort();
    await this.cleanupTombstonedRun(cachedTombstone);
    return this.snapshotRun(cachedTombstone.discardedRun);
  }

  private createGarbageCollectedDiscard(
    current: StoredPresentationRunManifest,
    now: string
  ): StoredPresentationRunManifest {
    if (current.dispatchStatus !== 'retained' && current.dispatchStatus !== 'failed_retained') {
      throw new Error('Presentation run is not eligible for garbage collection');
    }
    const discarded: StoredPresentationRunManifest = {
      ...current,
      revision: current.revision + 1,
      updatedAt: now,
      statusEnteredAt: now,
      dispatchStatus: 'discarded',
      artifactPhase: null,
      disposition: null,
      retainedCandidate: null,
      preparation: null,
      binding: null,
      retainedBytes: 0,
      initialDispatchLease: null,
      terminalEvidence: null,
      runtimeReleaseObservations: [],
      retentionProof: null,
      readiness: null,
    };
    this.assertStoredRun(discarded, current.runId);
    return discarded;
  }

  private async cleanupTombstonedRun(tombstone: StoredPresentationRunTombstone): Promise<void> {
    await this.files.removeRun(tombstone.runId);
    for (const grantId of tombstone.discardedRun.sourceGrants) await this.files.removeGrant(grantId);
  }

  private sortedRuns(predicate: (run: StoredPresentationRunManifest) => boolean): StoredPresentationRunManifest[] {
    return Array.from(this.runs.values())
      .filter(predicate)
      .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt) || right.runId.localeCompare(left.runId))
      .map((run) => this.snapshotRun(run));
  }

  private buildIndex(
    runs: Iterable<StoredPresentationRunManifest> = this.runs.values(),
    tombstones: Iterable<StoredPresentationRunTombstone> = this.tombstones.values()
  ): PresentationRunIndex {
    const index = createEmptyIndex();
    for (const run of runs) this.addRunToIndex(run, index);
    for (const tombstone of tombstones) {
      const run = tombstone.discardedRun;
      const requestKey = requestIndexKey(run.conversationId, run.clientRequestId);
      const requestOwner = getOwnIndexValue(index.requests, requestKey);
      if (requestOwner !== undefined && requestOwner !== run.runId) {
        throw new PresentationCanonicalCorruptionError('Duplicate presentation request ownership');
      }
      index.requests[requestKey] = run.runId;
    }
    for (const owner of this.sourceOwners.values()) {
      const key = presentationSourceOwnerKey(owner.owner);
      const indexedOwner = getOwnIndexValue(index.sourceOwners, key);
      if (indexedOwner !== undefined && indexedOwner !== owner.ownerId) {
        throw new PresentationCanonicalCorruptionError('Duplicate presentation source owner');
      }
      index.sourceOwners[key] = owner.ownerId;
      if (owner.owner.owner_type === 'draft' && owner.draftClientRequestId !== null) {
        const requestKey = draftRequestIndexKey(owner.principalId, owner.draftClientRequestId);
        const requestOwner = getOwnIndexValue(index.draftRequests, requestKey);
        if (requestOwner !== undefined && requestOwner !== owner.ownerId) {
          throw new PresentationCanonicalCorruptionError('Duplicate presentation draft request ownership');
        }
        index.draftRequests[requestKey] = owner.ownerId;
      }
    }
    return index;
  }

  private assertStoredRun(run: StoredPresentationRunManifest, expectedRunId: string): void {
    const canonicalKeys = [
      'version',
      'runId',
      'clientRequestId',
      'conversationId',
      'selectedTemplateId',
      'requestFingerprint',
      'postAllocationFailure',
      'revision',
      'createdAt',
      'updatedAt',
      'statusEnteredAt',
      'committedAt',
      'retainedAt',
      'dispatchStatus',
      'artifactPhase',
      'disposition',
      'retainedCandidate',
      'sourceGrants',
      'binding',
      'postInvoked',
      'retainedBytes',
    ];
    const currentLifecycleKeys = [
      ...canonicalKeys,
      'preparation',
      'initialDispatchLease',
      'terminalEvidence',
      'runtimeReleaseObservations',
      'retentionProof',
      'readiness',
    ];
    if (
      !isRecord(run) ||
      (!hasExactKeys(run, canonicalKeys) &&
        !hasExactKeys(run, [...canonicalKeys, 'preparation']) &&
        !hasExactKeys(run, currentLifecycleKeys)) ||
      run.version !== 2 ||
      run.runId !== expectedRunId ||
      !REQUEST_FINGERPRINT_RE.test(run.requestFingerprint) ||
      !Number.isSafeInteger(run.revision) ||
      run.revision < 0 ||
      !Array.isArray(run.sourceGrants) ||
      !Number.isSafeInteger(run.retainedBytes) ||
      run.retainedBytes < 0 ||
      (run.postAllocationFailure !== null && !isPresentationRunFailure(run.postAllocationFailure))
    ) {
      throw new PresentationCanonicalCorruptionError('Presentation canonical run manifest is corrupt');
    }
    if (
      (run.retainedCandidate !== null &&
        (!isRecord(run.retainedCandidate) ||
          !hasExactKeys(run.retainedCandidate, ['relativePath', 'sha256', 'byteLength']))) ||
      (run.binding !== null &&
        (!isRecord(run.binding) || !hasExactKeys(run.binding, ['conversationId', 'turnId', 'runtime', 'boundAt'])))
    ) {
      throw new PresentationCanonicalCorruptionError('Presentation canonical run manifest is corrupt');
    }
    try {
      if (run.preparation !== undefined && run.preparation !== null) {
        assertPresentationRunPreparationRecord(run.preparation);
      }
      assertPresentationRunManifestState(run);
    } catch (error) {
      throw new PresentationCanonicalCorruptionError('Presentation canonical run manifest is corrupt', {
        cause: error,
      });
    }
  }

  private assertStoredTombstone(tombstone: StoredPresentationRunTombstone, expectedRunId: string): void {
    if (
      !hasExactKeys(tombstone as unknown as Record<string, unknown>, [
        'version',
        'tombstoneType',
        'revision',
        'runId',
        'tombstonedAt',
        'discardedRun',
      ]) ||
      tombstone.version !== 2 ||
      tombstone.tombstoneType !== 'presentation-run' ||
      tombstone.revision !== 0 ||
      tombstone.runId !== expectedRunId ||
      !UUID_RE.test(tombstone.runId) ||
      Number.isNaN(Date.parse(tombstone.tombstonedAt)) ||
      new Date(Date.parse(tombstone.tombstonedAt)).toISOString() !== tombstone.tombstonedAt ||
      !isRecord(tombstone.discardedRun) ||
      tombstone.discardedRun.runId !== tombstone.runId ||
      tombstone.discardedRun.dispatchStatus !== 'discarded' ||
      tombstone.discardedRun.updatedAt !== tombstone.tombstonedAt
    ) {
      throw new PresentationCanonicalCorruptionError('Presentation canonical run tombstone is corrupt');
    }
    this.assertStoredRun(tombstone.discardedRun, tombstone.runId);
  }

  private cacheRun(run: StoredPresentationRunManifest): StoredPresentationRunManifest {
    const cached = frozenSnapshot(run);
    this.runs.set(cached.runId, cached);
    return cached;
  }

  private snapshotRun(run: StoredPresentationRunManifest): StoredPresentationRunManifest {
    return frozenSnapshot(run);
  }

  private getCapacityFailure(
    conversationId: string,
    freeBytes: number
  ): Extract<PresentationRunFailure, { code: 'RESOURCE_LIMIT_EXCEEDED' | 'DISK_RESERVE_EXCEEDED' }> | null {
    const runs = Array.from(this.runs.values());
    const predispatch = runs.filter((run) => PREDISPATCH_STATUSES.has(run.dispatchStatus));
    const live = runs.filter((run) => LIVE_GENERATION_STATUSES.has(run.dispatchStatus));
    const active = [...predispatch, ...live];
    const retained = runs.filter((run) => RETAINED_STATUSES.has(run.dispatchStatus));
    const conversationActiveCount = active.filter((run) => run.conversationId === conversationId).length;
    const conversationRetained = retained.filter((run) => run.conversationId === conversationId);
    const conversationDurableBytes = runs
      .filter((run) => run.conversationId === conversationId)
      .reduce((total, run) => total + run.retainedBytes, 0);
    const appDurableBytes = runs.reduce((total, run) => total + run.retainedBytes, 0);
    if (
      predispatch.length >= PRESENTATION_RUN_LIMITS.MAX_PREDISPATCH_INTENTS_PER_APP ||
      conversationRetained.length >= PRESENTATION_RUN_LIMITS.MAX_RETAINED_RUNS_PER_CONVERSATION ||
      retained.length >= PRESENTATION_RUN_LIMITS.MAX_RETAINED_RUNS_PER_APP ||
      conversationRetained.length + conversationActiveCount >=
        PRESENTATION_RUN_LIMITS.MAX_RETAINED_RUNS_PER_CONVERSATION ||
      retained.length + active.length >= PRESENTATION_RUN_LIMITS.MAX_RETAINED_RUNS_PER_APP ||
      conversationDurableBytes >= PRESENTATION_RUN_LIMITS.MAX_RETAINED_BYTES_PER_CONVERSATION ||
      appDurableBytes >= PRESENTATION_RUN_LIMITS.MAX_RETAINED_BYTES_PER_APP
    ) {
      return preflightFailure('RESOURCE_LIMIT_EXCEEDED');
    }
    const reservedAfterStart = (active.length + 1) * PRESENTATION_RUN_LIMITS.TRANSIENT_DISK_RESERVATION_BYTES_PER_RUN;
    if (
      !Number.isSafeInteger(freeBytes) ||
      freeBytes < PRESENTATION_RUN_LIMITS.MIN_FREE_BYTES_BEFORE_START ||
      freeBytes - reservedAfterStart < PRESENTATION_RUN_LIMITS.MIN_UNRESERVED_BYTES_AFTER_RESERVATIONS
    ) {
      return preflightFailure('DISK_RESERVE_EXCEEDED');
    }
    return null;
  }

  private assertLiveGenerationCapacity(conversationId: string): void {
    const live = Array.from(this.runs.values()).filter((run) => LIVE_GENERATION_STATUSES.has(run.dispatchStatus));
    if (
      live.filter((run) => run.conversationId === conversationId).length >=
        PRESENTATION_RUN_LIMITS.MAX_LIVE_RUNS_PER_CONVERSATION ||
      live.length >= PRESENTATION_RUN_LIMITS.MAX_LIVE_RUNS_PER_APP
    ) {
      throw new Error('Presentation live run resource limit exceeded');
    }
  }

  private wouldExceedRetainedBytes(conversationId: string, additionalBytes: number): boolean {
    if (!Number.isSafeInteger(additionalBytes) || additionalBytes < 0) return true;
    const runs = Array.from(this.runs.values());
    const conversationBytes = runs
      .filter((run) => run.conversationId === conversationId)
      .reduce((total, run) => total + run.retainedBytes, 0);
    const appBytes = runs.reduce((total, run) => total + run.retainedBytes, 0);
    return (
      conversationBytes + additionalBytes > PRESENTATION_RUN_LIMITS.MAX_RETAINED_BYTES_PER_CONVERSATION ||
      appBytes + additionalBytes > PRESENTATION_RUN_LIMITS.MAX_RETAINED_BYTES_PER_APP
    );
  }

  private getRateLimitFailure(
    conversationId: string,
    nowMs: number
  ): Extract<PresentationRunFailure, { code: 'RATE_LIMITED' }> | null {
    const conversationBucket = this.refillBucket(
      this.conversationStartBuckets.get(conversationId),
      PRESENTATION_RUN_LIMITS.STARTS_PER_CONVERSATION_BURST,
      PRESENTATION_RUN_LIMITS.MAX_STARTS_PER_CONVERSATION_PER_WINDOW,
      nowMs
    );
    this.conversationStartBuckets.set(conversationId, conversationBucket);
    const appBucket = this.refillBucket(
      this.appStartBucket ?? undefined,
      PRESENTATION_RUN_LIMITS.STARTS_PER_APP_BURST,
      PRESENTATION_RUN_LIMITS.MAX_STARTS_PER_APP_PER_WINDOW,
      nowMs
    );
    this.appStartBucket = appBucket;
    const conversationDeficit = Math.max(0, 1 - conversationBucket.tokens);
    const appDeficit = Math.max(0, 1 - appBucket.tokens);
    if (conversationDeficit === 0 && appDeficit === 0) return null;
    const conversationRetryMs =
      (conversationDeficit * PRESENTATION_RUN_LIMITS.START_RATE_WINDOW_MS) /
      PRESENTATION_RUN_LIMITS.MAX_STARTS_PER_CONVERSATION_PER_WINDOW;
    const appRetryMs =
      (appDeficit * PRESENTATION_RUN_LIMITS.START_RATE_WINDOW_MS) /
      PRESENTATION_RUN_LIMITS.MAX_STARTS_PER_APP_PER_WINDOW;
    return {
      ok: false,
      code: 'RATE_LIMITED',
      messageKey: 'conversation.presentationRun.RATE_LIMITED',
      retryable: true,
      state: 'preflight',
      details: { retryAfterMs: Math.ceil(Math.max(conversationRetryMs, appRetryMs)), postInvoked: false },
    };
  }

  private consumeStartTokens(conversationId: string, atMs: number): void {
    this.recordStartEvent(conversationId, atMs);
  }

  private rebuildRateBuckets(): void {
    this.conversationStartBuckets.clear();
    this.appStartBucket = null;
    const starts = Array.from(this.runs.values())
      .concat(Array.from(this.tombstones.values(), ({ discardedRun }) => discardedRun))
      .toSorted(
        (left, right) => left.createdAt.localeCompare(right.createdAt) || left.runId.localeCompare(right.runId)
      );
    for (const run of starts) this.recordStartEvent(run.conversationId, Date.parse(run.createdAt));
  }

  private recordStartEvent(conversationId: string, atMs: number): void {
    const conversationBucket = this.refillBucket(
      this.conversationStartBuckets.get(conversationId),
      PRESENTATION_RUN_LIMITS.STARTS_PER_CONVERSATION_BURST,
      PRESENTATION_RUN_LIMITS.MAX_STARTS_PER_CONVERSATION_PER_WINDOW,
      atMs
    );
    conversationBucket.tokens = Math.max(0, conversationBucket.tokens - 1);
    this.conversationStartBuckets.set(conversationId, conversationBucket);
    const appBucket = this.refillBucket(
      this.appStartBucket ?? undefined,
      PRESENTATION_RUN_LIMITS.STARTS_PER_APP_BURST,
      PRESENTATION_RUN_LIMITS.MAX_STARTS_PER_APP_PER_WINDOW,
      atMs
    );
    appBucket.tokens = Math.max(0, appBucket.tokens - 1);
    this.appStartBucket = appBucket;
  }

  private refillBucket(
    bucket: TokenBucket | undefined,
    capacity: number,
    startsPerWindow: number,
    atMs: number
  ): TokenBucket {
    if (bucket === undefined) return { tokens: capacity, updatedAtMs: atMs };
    const elapsedMs = Math.max(0, atMs - bucket.updatedAtMs);
    return {
      tokens: Math.min(
        capacity,
        bucket.tokens + (elapsedMs * startsPerWindow) / PRESENTATION_RUN_LIMITS.START_RATE_WINDOW_MS
      ),
      updatedAtMs: Math.max(bucket.updatedAtMs, atMs),
    };
  }

  private async runCanonicalTransaction(
    input: Parameters<PresentationRunJournal['transaction']>[0],
    cleanupBeforeIntent?: () => Promise<void>
  ): Promise<void> {
    try {
      await this.journal.transaction(input);
    } catch (error) {
      if (
        error instanceof PresentationJournalTransactionError &&
        error.cause instanceof PresentationRunSimulatedProcessCrashError
      ) {
        this.storageHealthy = false;
        throw error;
      }
      if (
        !(error instanceof PresentationJournalTransactionError) &&
        !(error instanceof PresentationJournalRecoveryRequiredError)
      ) {
        throw error;
      }
      this.storageHealthy = false;
      let cleanupError: unknown;
      if (
        (error instanceof PresentationJournalTransactionError && !error.intentMayExist) ||
        error instanceof PresentationJournalRecoveryRequiredError
      ) {
        try {
          await cleanupBeforeIntent?.();
        } catch (caught) {
          cleanupError = caught;
        }
      }
      try {
        await this.journal.recover();
        await this.reloadCanonicalState();
        this.storageHealthy = true;
      } catch (recoveryError) {
        throw new Error('Presentation run store recovery required', { cause: recoveryError });
      }
      if (cleanupError !== undefined) throw cleanupError;
      throw error;
    }
  }

  private async persistDerivedIndexBestEffort(): Promise<void> {
    try {
      await this.journal.writeDerivedIndex(this.index);
      this.indexRepairPending = false;
    } catch {
      this.indexRepairPending = true;
    }
  }

  private assertStorageHealthy(): void {
    if (!this.storageHealthy) throw new Error('Presentation run store recovery required');
    if (this.indexRepairPending) void this.persistDerivedIndexBestEffort();
  }
}
