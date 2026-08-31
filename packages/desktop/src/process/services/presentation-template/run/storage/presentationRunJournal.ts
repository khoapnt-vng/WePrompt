/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomUUID as createRandomUUID } from 'node:crypto';
import { constants, type BigIntStats } from 'node:fs';
import { lstat, open, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { PRESENTATION_RUN_LIMITS } from '@/common/config/constants';
import {
  assertPreparedPresentationRunAssets,
  type PreparedPresentationRunAssets,
  type PreparedPresentationSourceSnapshot,
  type PreparedRetainedCandidate,
  type PresentationOwnedDirectoryLease,
  type PresentationPreparedCandidateGuard,
  type PresentationRunEntityKind,
  type PresentationRunFiles,
} from './presentationRunFiles';

export type PresentationRunDurableBoundary =
  | 'before-intent-append'
  | 'after-intent-append'
  | 'before-intent-fsync'
  | 'after-intent-fsync'
  | 'before-manifest-write'
  | 'after-manifest-write'
  | 'before-manifest-fsync'
  | 'after-manifest-fsync'
  | 'before-manifest-rename'
  | 'after-manifest-rename'
  | 'before-manifest-directory-fsync'
  | 'after-manifest-directory-fsync'
  | 'before-commit-append'
  | 'after-commit-append'
  | 'before-commit-fsync'
  | 'after-commit-fsync'
  | 'before-index-write'
  | 'after-index-write'
  | 'before-index-fsync'
  | 'after-index-fsync'
  | 'before-index-rename'
  | 'after-index-rename'
  | 'before-index-directory-fsync'
  | 'after-index-directory-fsync';

export type PresentationRunFailurePoint = {
  boundary: PresentationRunDurableBoundary;
  transactionId?: string;
  mutationIndex?: number;
  entityKind?: PresentationRunEntityKind;
  entityId?: string;
};

export type PresentationRunJournalMutation = {
  entityKind: PresentationRunEntityKind;
  entityId: string;
  expectedRevision: number | null;
  nextManifest: Record<string, unknown>;
};

export type PresentationRunJournalTransaction = {
  mutations: PresentationRunJournalMutation[];
  retainedCandidatePromotions?: PreparedRetainedCandidate[];
  sourceSnapshotPromotions?: PreparedPresentationSourceSnapshot[];
  preparedRunAssetPromotions?: PreparedPresentationRunAssets[];
};

type IntentRecord = {
  version: 1;
  type: 'intent';
  transactionId: string;
  createdAt: string;
  mutations: PresentationRunJournalMutation[];
  retainedCandidatePromotions: PreparedRetainedCandidate[];
  sourceSnapshotPromotions: PreparedPresentationSourceSnapshot[];
  preparedRunAssetPromotions: PreparedPresentationRunAssets[];
};

type CommitRecord = {
  version: 1;
  type: 'commit';
  transactionId: string;
  committedAt: string;
};

type JournalRecord = IntentRecord | CommitRecord;

type ReadRecordsResult = {
  records: JournalRecord[];
  journalIdentity: BigIntStats | null;
};

type PresentationRunJournalOptions = {
  files: PresentationRunFiles;
  failureInjector?: (point: PresentationRunFailurePoint) => void | Promise<void>;
  now?: () => Date;
  randomUUID?: () => string;
};

function hasCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ENTITY_KINDS: ReadonlySet<PresentationRunEntityKind> = new Set([
  'run',
  'grant',
  'draft',
  'owner',
  'run-tombstone',
  'grant-tombstone',
  'draft-tombstone',
]);

/** Identifies canonical bytes that are safe to quarantine rather than an I/O failure. */
export class PresentationCanonicalCorruptionError extends Error {}

/** Preserves whether recovery may need intent-owned temporary bytes after a failed transaction. */
export class PresentationJournalTransactionError extends Error {
  constructor(
    message: string,
    readonly intentMayExist: boolean,
    options?: ErrorOptions
  ) {
    super(message, options);
  }
}

export class PresentationJournalRecoveryRequiredError extends Error {
  constructor() {
    super('Presentation run journal recovery required');
  }
}

function journalCorrupt(): never {
  throw new Error('Presentation run journal is corrupt');
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).toSorted();
  return actual.length === keys.length && actual.every((key, index) => key === [...keys].toSorted()[index]);
}

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function parseMutation(value: unknown): PresentationRunJournalMutation {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['entityKind', 'entityId', 'expectedRevision', 'nextManifest']) ||
    !ENTITY_KINDS.has(value.entityKind as PresentationRunEntityKind) ||
    typeof value.entityId !== 'string' ||
    !UUID_RE.test(value.entityId) ||
    (value.expectedRevision !== null &&
      (!Number.isSafeInteger(value.expectedRevision) || (value.expectedRevision as number) < 0)) ||
    !isRecord(value.nextManifest) ||
    manifestRevision(value.nextManifest) === null
  ) {
    journalCorrupt();
  }
  return value as PresentationRunJournalMutation;
}

function parsePromotion(value: unknown): PreparedRetainedCandidate {
  const legacyKeys = ['runId', 'temporaryRelativePath', 'finalRelativePath', 'sha256', 'byteLength', 'dev', 'ino'];
  const currentKeys = [...legacyKeys, 'stagingBeforeRetain', 'retainedTemp', 'stagingAfterRetain'];
  if (
    !isRecord(value) ||
    (!hasExactKeys(value, legacyKeys) && !hasExactKeys(value, currentKeys)) ||
    typeof value.runId !== 'string' ||
    !UUID_RE.test(value.runId) ||
    typeof value.temporaryRelativePath !== 'string' ||
    !/^retained\/\.candidate-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.tmp$/i.test(
      value.temporaryRelativePath
    ) ||
    value.finalRelativePath !== 'retained/candidate.pptx' ||
    typeof value.sha256 !== 'string' ||
    !/^[0-9a-f]{64}$/i.test(value.sha256) ||
    !Number.isSafeInteger(value.byteLength) ||
    (value.byteLength as number) < 0 ||
    (value.byteLength as number) > PRESENTATION_RUN_LIMITS.MAX_CANDIDATE_COMPRESSED_BYTES ||
    typeof value.dev !== 'string' ||
    !/^(0|[1-9][0-9]*)$/.test(value.dev) ||
    typeof value.ino !== 'string' ||
    !/^[1-9][0-9]*$/.test(value.ino) ||
    (hasExactKeys(value, currentKeys) &&
      (typeof value.stagingBeforeRetain !== 'string' ||
        value.stagingBeforeRetain !== value.sha256 ||
        typeof value.retainedTemp !== 'string' ||
        value.retainedTemp !== value.sha256 ||
        typeof value.stagingAfterRetain !== 'string' ||
        value.stagingAfterRetain !== value.sha256))
  ) {
    journalCorrupt();
  }
  return value as PreparedRetainedCandidate;
}

function parseSourcePromotion(value: unknown): PreparedPresentationSourceSnapshot {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'grantId',
      'format',
      'temporaryRelativePath',
      'finalRelativePath',
      'sha256',
      'byteLength',
      'dev',
      'ino',
    ]) ||
    typeof value.grantId !== 'string' ||
    !UUID_RE.test(value.grantId) ||
    !['pdf', 'docx', 'xlsx', 'pptx', 'txt', 'md', 'csv'].includes(value.format as string) ||
    typeof value.temporaryRelativePath !== 'string' ||
    !/^\.source-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.tmp$/i.test(
      value.temporaryRelativePath
    ) ||
    value.finalRelativePath !== `source.${value.format as string}` ||
    typeof value.sha256 !== 'string' ||
    !/^[0-9a-f]{64}$/i.test(value.sha256) ||
    !Number.isSafeInteger(value.byteLength) ||
    (value.byteLength as number) < 1 ||
    (value.byteLength as number) > PRESENTATION_RUN_LIMITS.MAX_SOURCE_BYTES ||
    typeof value.dev !== 'string' ||
    !/^(0|[1-9][0-9]*)$/.test(value.dev) ||
    typeof value.ino !== 'string' ||
    !/^[1-9][0-9]*$/.test(value.ino)
  ) {
    journalCorrupt();
  }
  return value as PreparedPresentationSourceSnapshot;
}

function validateIntentParticipants(
  mutations: PresentationRunJournalMutation[],
  promotions: PreparedRetainedCandidate[],
  sourcePromotions: PreparedPresentationSourceSnapshot[],
  preparedRunPromotions: PreparedPresentationRunAssets[]
): void {
  const participantKeys = mutations.map(({ entityKind, entityId }) => `${entityKind}:${entityId}`);
  if (new Set(participantKeys).size !== participantKeys.length) journalCorrupt();
  const promotedRuns = new Set<string>();
  for (const promotion of promotions) {
    if (promotedRuns.has(promotion.runId)) journalCorrupt();
    promotedRuns.add(promotion.runId);
    const mutation = mutations.find(({ entityKind, entityId }) => entityKind === 'run' && entityId === promotion.runId);
    const candidate = mutation?.nextManifest.retainedCandidate;
    if (
      mutation === undefined ||
      mutation.nextManifest.runId !== promotion.runId ||
      mutation.nextManifest.dispatchStatus !== 'terminal_verified' ||
      mutation.nextManifest.artifactPhase !== 'candidate_retained' ||
      !isRecord(candidate) ||
      candidate.relativePath !== promotion.finalRelativePath ||
      candidate.sha256 !== promotion.sha256 ||
      candidate.byteLength !== promotion.byteLength
    ) {
      journalCorrupt();
    }
  }
  for (const mutation of mutations) {
    if (
      mutation.entityKind === 'run' &&
      mutation.nextManifest.dispatchStatus === 'terminal_verified' &&
      mutation.nextManifest.artifactPhase === 'candidate_retained' &&
      !promotedRuns.has(mutation.entityId)
    ) {
      journalCorrupt();
    }
  }
  const promotedGrants = new Set<string>();
  for (const promotion of sourcePromotions) {
    if (promotedGrants.has(promotion.grantId)) journalCorrupt();
    promotedGrants.add(promotion.grantId);
    const mutation = mutations.find(
      ({ entityKind, entityId }) => entityKind === 'grant' && entityId === promotion.grantId
    );
    if (
      mutation === undefined ||
      mutation.expectedRevision !== null ||
      mutation.nextManifest.recordType !== 'presentation-source-grant' ||
      mutation.nextManifest.grantId !== promotion.grantId ||
      mutation.nextManifest.state !== 'active' ||
      mutation.nextManifest.format !== promotion.format ||
      mutation.nextManifest.snapshotRelativePath !== promotion.finalRelativePath ||
      mutation.nextManifest.sha256 !== promotion.sha256 ||
      mutation.nextManifest.byteLength !== promotion.byteLength
    ) {
      journalCorrupt();
    }
  }
  for (const mutation of mutations) {
    if (
      mutation.entityKind === 'grant' &&
      mutation.expectedRevision === null &&
      mutation.nextManifest.recordType === 'presentation-source-grant' &&
      mutation.nextManifest.state === 'active' &&
      !promotedGrants.has(mutation.entityId)
    ) {
      journalCorrupt();
    }
  }
  const preparedRuns = new Set<string>();
  for (const promotion of preparedRunPromotions) {
    if (preparedRuns.has(promotion.runId)) journalCorrupt();
    preparedRuns.add(promotion.runId);
    const mutation = mutations.find(({ entityKind, entityId }) => entityKind === 'run' && entityId === promotion.runId);
    if (
      mutation === undefined ||
      mutation.nextManifest.runId !== promotion.runId ||
      mutation.nextManifest.dispatchStatus !== 'committed' ||
      mutation.nextManifest.artifactPhase !== 'sources_extracted' ||
      !isDeepStrictEqual(mutation.nextManifest.preparation, promotion.record)
    ) {
      journalCorrupt();
    }
  }
  for (const mutation of mutations) {
    if (
      mutation.entityKind === 'run' &&
      mutation.expectedRevision === null &&
      mutation.nextManifest.dispatchStatus === 'committed' &&
      mutation.nextManifest.artifactPhase === 'sources_extracted' &&
      mutation.nextManifest.preparation != null &&
      !preparedRuns.has(mutation.entityId)
    ) {
      journalCorrupt();
    }
  }
}

function validateTransaction(input: PresentationRunJournalTransaction): void {
  if (!Array.isArray(input.mutations) || input.mutations.length === 0) {
    throw new Error('Presentation run journal transaction is empty');
  }
  const mutations = input.mutations.map(parseMutation);
  if (input.retainedCandidatePromotions !== undefined && !Array.isArray(input.retainedCandidatePromotions)) {
    journalCorrupt();
  }
  const promotions = (input.retainedCandidatePromotions ?? []).map(parsePromotion);
  if (input.sourceSnapshotPromotions !== undefined && !Array.isArray(input.sourceSnapshotPromotions)) {
    journalCorrupt();
  }
  const sourcePromotions = (input.sourceSnapshotPromotions ?? []).map(parseSourcePromotion);
  if (input.preparedRunAssetPromotions !== undefined && !Array.isArray(input.preparedRunAssetPromotions)) {
    journalCorrupt();
  }
  const preparedRunPromotions = (input.preparedRunAssetPromotions ?? []).map((promotion) => {
    assertPreparedPresentationRunAssets(promotion);
    return promotion;
  });
  validateIntentParticipants(mutations, promotions, sourcePromotions, preparedRunPromotions);
}

function parseJournalRecord(line: string): JournalRecord {
  let value: unknown;
  try {
    value = JSON.parse(line) as unknown;
  } catch {
    journalCorrupt();
  }
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    typeof value.transactionId !== 'string' ||
    (value.type !== 'intent' && value.type !== 'commit')
  ) {
    journalCorrupt();
  }
  if (value.type === 'intent') {
    const legacyKeys = ['version', 'type', 'transactionId', 'createdAt', 'mutations', 'retainedCandidatePromotions'];
    const currentKeys = [...legacyKeys, 'sourceSnapshotPromotions'];
    const preparedRunKeys = [...currentKeys, 'preparedRunAssetPromotions'];
    if (
      (!hasExactKeys(value, legacyKeys) &&
        !hasExactKeys(value, currentKeys) &&
        !hasExactKeys(value, preparedRunKeys)) ||
      !UUID_RE.test(value.transactionId) ||
      !isIsoTimestamp(value.createdAt) ||
      !Array.isArray(value.mutations) ||
      !Array.isArray(value.retainedCandidatePromotions) ||
      (value.sourceSnapshotPromotions !== undefined && !Array.isArray(value.sourceSnapshotPromotions)) ||
      (value.preparedRunAssetPromotions !== undefined && !Array.isArray(value.preparedRunAssetPromotions))
    ) {
      journalCorrupt();
    }
    const mutations = value.mutations.map(parseMutation);
    const retainedCandidatePromotions = value.retainedCandidatePromotions.map(parsePromotion);
    const sourceSnapshotPromotions = (
      Array.isArray(value.sourceSnapshotPromotions) ? value.sourceSnapshotPromotions : []
    ).map(parseSourcePromotion);
    const preparedRunAssetPromotions = (
      Array.isArray(value.preparedRunAssetPromotions) ? value.preparedRunAssetPromotions : []
    ).map((promotion) => {
      assertPreparedPresentationRunAssets(promotion as PreparedPresentationRunAssets);
      return promotion as PreparedPresentationRunAssets;
    });
    validateIntentParticipants(
      mutations,
      retainedCandidatePromotions,
      sourceSnapshotPromotions,
      preparedRunAssetPromotions
    );
    return {
      ...(value as Omit<IntentRecord, 'sourceSnapshotPromotions' | 'preparedRunAssetPromotions'>),
      mutations,
      retainedCandidatePromotions,
      sourceSnapshotPromotions,
      preparedRunAssetPromotions,
    };
  }
  if (
    !hasExactKeys(value, ['version', 'type', 'transactionId', 'committedAt']) ||
    !UUID_RE.test(value.transactionId) ||
    !isIsoTimestamp(value.committedAt)
  ) {
    journalCorrupt();
  }
  return value as CommitRecord;
}

function manifestRevision(value: unknown): number | null {
  if (!isRecord(value) || !Number.isSafeInteger(value.revision) || (value.revision as number) < 0) return null;
  return value.revision as number;
}

type OpenHandle = Awaited<ReturnType<typeof open>>;

type OpenOwnedFile = {
  handle: OpenHandle;
  metadata: BigIntStats;
};

const OWNED_FILE_ERROR = 'Presentation storage file must be regular and owned by the current user';
const CHANGED_FILE_ERROR = 'Presentation storage file changed while in use';

function sameFileIdentity(left: BigIntStats, right: BigIntStats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function assertOwnedRegularFile(metadata: BigIntStats): void {
  const currentUid = typeof process.getuid === 'function' ? process.getuid() : undefined;
  if (
    !metadata.isFile() ||
    metadata.nlink !== BigInt(1) ||
    (currentUid !== undefined && metadata.uid !== BigInt(currentUid))
  ) {
    throw new Error(OWNED_FILE_ERROR);
  }
}

function assertOwnedUnlinkedFile(metadata: BigIntStats, expected: BigIntStats): void {
  const currentUid = typeof process.getuid === 'function' ? process.getuid() : undefined;
  if (
    !metadata.isFile() ||
    metadata.nlink !== BigInt(0) ||
    (currentUid !== undefined && metadata.uid !== BigInt(currentUid)) ||
    !sameFileIdentity(metadata, expected) ||
    metadata.size !== expected.size
  ) {
    throw new Error(CHANGED_FILE_ERROR);
  }
}

async function assertPathNamesFile(filePath: string, metadata: BigIntStats): Promise<void> {
  const named = await lstat(filePath, { bigint: true });
  assertOwnedRegularFile(named);
  if (named.isSymbolicLink() || !sameFileIdentity(named, metadata)) throw new Error(CHANGED_FILE_ERROR);
}

async function openOwnedFile(filePath: string, flags: number, mode?: number): Promise<OpenOwnedFile> {
  const noFollow = 'O_NOFOLLOW' in constants ? constants.O_NOFOLLOW : 0;
  const handle = await open(filePath, flags | noFollow, mode);
  try {
    const metadata = await handle.stat({ bigint: true });
    assertOwnedRegularFile(metadata);
    await assertPathNamesFile(filePath, metadata);
    return { handle, metadata };
  } catch (error) {
    await handle.close();
    throw error;
  }
}

async function assertOpenFileStillNamed(
  opened: OpenOwnedFile,
  filePath: string,
  requireUnchanged: boolean
): Promise<BigIntStats> {
  const current = await opened.handle.stat({ bigint: true });
  assertOwnedRegularFile(current);
  if (
    !sameFileIdentity(opened.metadata, current) ||
    (requireUnchanged &&
      (opened.metadata.size !== current.size ||
        opened.metadata.mtimeNs !== current.mtimeNs ||
        opened.metadata.ctimeNs !== current.ctimeNs))
  ) {
    throw new Error(CHANGED_FILE_ERROR);
  }
  await assertPathNamesFile(filePath, current);
  return current;
}

async function refreshOpenFileAfterMutation(opened: OpenOwnedFile, filePath: string): Promise<void> {
  opened.metadata = await assertOpenFileStillNamed(opened, filePath, false);
}

async function assertOpenFileUnchanged(opened: OpenOwnedFile, filePath: string): Promise<void> {
  opened.metadata = await assertOpenFileStillNamed(opened, filePath, true);
}

async function assertPathAbsent(filePath: string): Promise<void> {
  try {
    await lstat(filePath, { bigint: true });
    throw new Error(CHANGED_FILE_ERROR);
  } catch (error) {
    if (!hasCode(error, 'ENOENT')) throw error;
  }
}

async function validateUnlinkedFileAndSync(
  filePath: string,
  opened: OpenOwnedFile,
  directoryLease: PresentationOwnedDirectoryLease
): Promise<void> {
  const unlinked = await opened.handle.stat({ bigint: true });
  assertOwnedUnlinkedFile(unlinked, opened.metadata);
  await assertPathAbsent(filePath);
  await directoryLease.assertCurrent();
  await directoryLease.sync(path.dirname(filePath));
  const afterSync = await opened.handle.stat({ bigint: true });
  assertOwnedUnlinkedFile(afterSync, opened.metadata);
  await assertPathAbsent(filePath);
  await directoryLease.assertCurrent();
}

function cleanupFailure(operationError: unknown, cleanupError: unknown): Error {
  const message = cleanupError instanceof Error ? cleanupError.message : 'Presentation temporary cleanup failed';
  return new Error(message, { cause: { operationError, cleanupError } });
}

async function readOwnedFile(filePath: string, directoryLease: PresentationOwnedDirectoryLease): Promise<Buffer> {
  await directoryLease.assertCurrent();
  const opened = await openOwnedFile(filePath, constants.O_RDONLY);
  try {
    const bytes = await opened.handle.readFile();
    await assertOpenFileUnchanged(opened, filePath);
    await directoryLease.assertCurrent();
    return bytes;
  } finally {
    await opened.handle.close();
  }
}

async function removeOwnedFileIfPresent(
  filePath: string,
  directoryLease: PresentationOwnedDirectoryLease
): Promise<void> {
  await directoryLease.assertCurrent();
  let opened: OpenOwnedFile;
  try {
    opened = await openOwnedFile(filePath, constants.O_RDONLY);
  } catch (error) {
    if (!hasCode(error, 'ENOENT')) throw error;
    await directoryLease.assertCurrent();
    return;
  }
  try {
    await assertOpenFileUnchanged(opened, filePath);
    await directoryLease.assertCurrent();
    // Node does not expose unlinkat(2); holding and rechecking both handles is the narrowest same-UID race bound available.
    await unlink(filePath);
    await validateUnlinkedFileAndSync(filePath, opened, directoryLease);
  } finally {
    await opened.handle.close();
  }
}

async function removeOpenFileIfCurrent(
  filePath: string,
  opened: OpenOwnedFile,
  directoryLease: PresentationOwnedDirectoryLease
): Promise<void> {
  await directoryLease.assertCurrent();
  await assertOpenFileStillNamed(opened, filePath, false);
  await unlink(filePath);
  await validateUnlinkedFileAndSync(filePath, opened, directoryLease);
}

type AppendRecordOptions = {
  journalLease: PresentationOwnedDirectoryLease;
  expectedJournalIdentity: BigIntStats | null;
  prePersistGuard?: PresentationPreparedCandidateGuard;
  onAppendMayPersist?: () => void;
};

async function inspectOwnedFileIdentityIfPresent(
  filePath: string,
  directoryLease: PresentationOwnedDirectoryLease
): Promise<BigIntStats | null> {
  await directoryLease.assertCurrent();
  let opened: OpenOwnedFile;
  try {
    opened = await openOwnedFile(filePath, constants.O_RDONLY);
  } catch (error) {
    if (!hasCode(error, 'ENOENT')) throw error;
    await directoryLease.assertCurrent();
    return null;
  }
  try {
    await assertOpenFileUnchanged(opened, filePath);
    await directoryLease.assertCurrent();
    return opened.metadata;
  } finally {
    await opened.handle.close();
  }
}

/** Write-ahead journal for compare-and-swap mutations of canonical presentation records. */
export class PresentationRunJournal {
  private readonly files: PresentationRunFiles;
  private readonly failureInjector?: PresentationRunJournalOptions['failureInjector'];
  private readonly now: () => Date;
  private readonly randomUUID: () => string;
  private serializationTail: Promise<void> = Promise.resolve();
  private recoveryRequired = false;

  constructor(options: PresentationRunJournalOptions) {
    this.files = options.files;
    this.failureInjector = options.failureInjector;
    this.now = options.now ?? (() => new Date());
    this.randomUUID = options.randomUUID ?? createRandomUUID;
  }

  async transaction(input: PresentationRunJournalTransaction): Promise<void> {
    const inputSnapshot = structuredClone(input);
    return this.serialized(async () => {
      let intentMayExist = false;
      try {
        if (this.recoveryRequired) throw new PresentationJournalRecoveryRequiredError();
        validateTransaction(inputSnapshot);
        await this.files.initialize();
        for (const mutation of inputSnapshot.mutations) await this.assertExpectedRevision(mutation);
        await this.assertPreparedRunContinuity(inputSnapshot);
        const intent: IntentRecord = {
          version: 1,
          type: 'intent',
          transactionId: this.randomUUID(),
          createdAt: this.now().toISOString(),
          mutations: inputSnapshot.mutations,
          retainedCandidatePromotions: inputSnapshot.retainedCandidatePromotions ?? [],
          sourceSnapshotPromotions: inputSnapshot.sourceSnapshotPromotions ?? [],
          preparedRunAssetPromotions: inputSnapshot.preparedRunAssetPromotions ?? [],
        };
        await this.files.withJournalDirectoryLease(async (journalLease) => {
          const journalPath = this.files.getJournalPath();
          const journalIdentityBeforeIntent = await inspectOwnedFileIdentityIfPresent(journalPath, journalLease);
          const journalIdentity = await this.files.withPreparedRetainedCandidateLeases(
            intent.retainedCandidatePromotions,
            async (retainedGuard) =>
              this.files.withPreparedSourceSnapshotLeases(intent.sourceSnapshotPromotions, async (sourceGuard) =>
                this.files.withPreparedRunAssetLeases(intent.preparedRunAssetPromotions, async (preparedRunGuard) =>
                  this.appendRecord(intent, {
                    journalLease,
                    expectedJournalIdentity: journalIdentityBeforeIntent,
                    prePersistGuard: {
                      assertCurrent: async () => {
                        await retainedGuard.assertCurrent();
                        await sourceGuard.assertCurrent();
                        await preparedRunGuard.assertCurrent();
                      },
                    },
                    onAppendMayPersist: () => {
                      this.recoveryRequired = true;
                      intentMayExist = true;
                    },
                  })
                )
              )
          );
          await this.applyIntent(intent);
          const committedJournalIdentity = await this.appendRecord(
            {
              version: 1,
              type: 'commit',
              transactionId: intent.transactionId,
              committedAt: this.now().toISOString(),
            },
            { journalLease, expectedJournalIdentity: journalIdentity }
          );
          await this.compactCommittedRecords(journalLease, committedJournalIdentity);
          await journalLease.assertCurrent();
          this.recoveryRequired = false;
        });
      } catch (error) {
        if (error instanceof PresentationJournalRecoveryRequiredError) throw error;
        const message = error instanceof Error ? error.message : 'Presentation journal transaction failed';
        throw new PresentationJournalTransactionError(message, intentMayExist, { cause: error });
      }
    });
  }

  async recover(): Promise<void> {
    return this.serialized(async () => {
      this.recoveryRequired = true;
      await this.files.initialize();
      await this.files.withJournalDirectoryLease(async (journalLease) => {
        const { records, journalIdentity: readJournalIdentity } = await this.readRecords(journalLease);
        let journalIdentity = readJournalIdentity;
        const intents = new Map<string, IntentRecord>();
        const committed = new Set<string>();
        for (const record of records) {
          if (record.type === 'intent') {
            if (intents.has(record.transactionId)) throw new Error('Presentation run journal has a duplicate intent');
            intents.set(record.transactionId, record);
          } else {
            if (committed.has(record.transactionId) || !intents.has(record.transactionId)) {
              throw new Error('Presentation run journal is corrupt');
            }
            committed.add(record.transactionId);
          }
        }
        for (const intent of intents.values()) {
          if (committed.has(intent.transactionId)) continue;
          await this.applyIntent(intent, true);
          if (journalIdentity === null) throw new Error('Presentation run journal is corrupt');
          journalIdentity = await this.appendRecord(
            {
              version: 1,
              type: 'commit',
              transactionId: intent.transactionId,
              committedAt: this.now().toISOString(),
            },
            { journalLease, expectedJournalIdentity: journalIdentity }
          );
        }
        await this.compactCommittedRecords(journalLease, journalIdentity);
        await journalLease.assertCurrent();
        this.recoveryRequired = false;
      });
    });
  }

  async readCanonical<T extends Record<string, unknown>>(
    entityKind: PresentationRunEntityKind,
    entityId: string
  ): Promise<T | null> {
    const manifestPath = this.files.getEntityManifestPath(entityKind, entityId);
    await this.files.initialize();
    return this.files.withExistingEntityParentDirectoryLease(entityKind, entityId, async (directoryLease) => {
      try {
        const parsed = JSON.parse((await readOwnedFile(manifestPath, directoryLease)).toString('utf8')) as unknown;
        if (!isRecord(parsed) || manifestRevision(parsed) === null) {
          throw new PresentationCanonicalCorruptionError('Presentation canonical manifest is corrupt');
        }
        await directoryLease.assertCurrent();
        return parsed as T;
      } catch (error) {
        if (hasCode(error, 'ENOENT')) {
          await directoryLease.assertCurrent();
          return null;
        }
        if (error instanceof SyntaxError) {
          throw new PresentationCanonicalCorruptionError('Presentation canonical manifest is corrupt');
        }
        throw error;
      }
    });
  }

  async writeDerivedIndex(index: Record<string, unknown>): Promise<void> {
    const indexSnapshot = structuredClone(index);
    return this.serialized(async () => {
      await this.files.initialize();
      const indexPath = this.files.getIndexPath();
      const temporaryPath = path.join(path.dirname(indexPath), `.index-${this.randomUUID()}.tmp`);
      const point = (boundary: PresentationRunDurableBoundary): PresentationRunFailurePoint => ({ boundary });
      await this.files.withIndexDirectoryLease(async (directoryLease) => {
        let opened: OpenOwnedFile | null = null;
        let temporaryStillNamed = true;
        try {
          await directoryLease.assertCurrent();
          opened = await openOwnedFile(
            temporaryPath,
            constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
            PRESENTATION_RUN_LIMITS.OWNED_FILE_MODE
          );
          await this.injectAndValidateFile(point('before-index-write'), directoryLease, opened, temporaryPath);
          await opened.handle.writeFile(`${JSON.stringify(indexSnapshot, null, 2)}\n`, 'utf8');
          await refreshOpenFileAfterMutation(opened, temporaryPath);
          await this.injectAndValidateFile(point('after-index-write'), directoryLease, opened, temporaryPath);
          await this.injectAndValidateFile(point('before-index-fsync'), directoryLease, opened, temporaryPath);
          await opened.handle.sync();
          await assertOpenFileUnchanged(opened, temporaryPath);
          await this.injectAndValidateFile(point('after-index-fsync'), directoryLease, opened, temporaryPath);
          await this.injectAndValidateFile(point('before-index-rename'), directoryLease, opened, temporaryPath);
          await rename(temporaryPath, indexPath);
          temporaryStillNamed = false;
          await refreshOpenFileAfterMutation(opened, indexPath);
          await directoryLease.assertCurrent();
          await this.injectAndValidateFile(point('after-index-rename'), directoryLease, opened, indexPath);
          await this.injectAndValidateFile(point('before-index-directory-fsync'), directoryLease, opened, indexPath);
          await directoryLease.sync(path.dirname(indexPath));
          await assertOpenFileUnchanged(opened, indexPath);
          await this.injectAndValidateFile(point('after-index-directory-fsync'), directoryLease, opened, indexPath);
        } catch (error) {
          if (opened !== null && temporaryStillNamed) {
            try {
              await removeOpenFileIfCurrent(temporaryPath, opened, directoryLease);
            } catch (cleanupError) {
              throw cleanupFailure(error, cleanupError);
            }
          }
          throw error;
        } finally {
          if (opened !== null) await opened.handle.close().catch((): undefined => undefined);
        }
      });
    });
  }

  async readDerivedIndex<T extends Record<string, unknown>>(): Promise<T | null> {
    await this.files.initialize();
    return this.files.withIndexDirectoryLease(async (directoryLease) => {
      try {
        const parsed = JSON.parse(
          (await readOwnedFile(this.files.getIndexPath(), directoryLease)).toString('utf8')
        ) as unknown;
        if (!isRecord(parsed)) throw new Error('Presentation run index is corrupt');
        await directoryLease.assertCurrent();
        return parsed as T;
      } catch (error) {
        if (hasCode(error, 'ENOENT')) {
          await directoryLease.assertCurrent();
          return null;
        }
        if (error instanceof SyntaxError) throw new Error('Presentation run index is corrupt', { cause: error });
        throw error;
      }
    });
  }

  private async appendRecord(record: JournalRecord, options: AppendRecordOptions): Promise<BigIntStats> {
    const isIntent = record.type === 'intent';
    const appendBefore: PresentationRunDurableBoundary = isIntent ? 'before-intent-append' : 'before-commit-append';
    const appendAfter: PresentationRunDurableBoundary = isIntent ? 'after-intent-append' : 'after-commit-append';
    const fsyncBefore: PresentationRunDurableBoundary = isIntent ? 'before-intent-fsync' : 'before-commit-fsync';
    const fsyncAfter: PresentationRunDurableBoundary = isIntent ? 'after-intent-fsync' : 'after-commit-fsync';
    const context = { transactionId: record.transactionId };
    await this.inject({ ...context, boundary: appendBefore });
    await options.journalLease.assertCurrent();
    await options.prePersistGuard?.assertCurrent();
    options.onAppendMayPersist?.();
    let created = false;
    let opened: OpenOwnedFile;
    const journalPath = this.files.getJournalPath();
    if (options.expectedJournalIdentity === null) {
      opened = await openOwnedFile(
        journalPath,
        constants.O_CREAT | constants.O_EXCL | constants.O_APPEND | constants.O_WRONLY,
        PRESENTATION_RUN_LIMITS.OWNED_FILE_MODE
      );
      created = true;
    } else {
      opened = await openOwnedFile(journalPath, constants.O_APPEND | constants.O_WRONLY);
      if (!sameFileIdentity(options.expectedJournalIdentity, opened.metadata)) {
        await opened.handle.close();
        throw new Error(CHANGED_FILE_ERROR);
      }
    }
    try {
      await options.journalLease.assertCurrent();
      await assertOpenFileUnchanged(opened, journalPath);
      await opened.handle.chmod(PRESENTATION_RUN_LIMITS.OWNED_FILE_MODE);
      await refreshOpenFileAfterMutation(opened, journalPath);
      await opened.handle.writeFile(`${JSON.stringify(record)}\n`, 'utf8');
      await refreshOpenFileAfterMutation(opened, journalPath);
      await this.injectAndValidateFile(
        { ...context, boundary: appendAfter },
        options.journalLease,
        opened,
        journalPath
      );
      await this.injectAndValidateFile(
        { ...context, boundary: fsyncBefore },
        options.journalLease,
        opened,
        journalPath
      );
      await opened.handle.sync();
      await assertOpenFileUnchanged(opened, journalPath);
      await options.journalLease.assertCurrent();
      if (created) {
        await options.journalLease.sync(this.files.roots.journalRoot);
        await assertOpenFileUnchanged(opened, journalPath);
      }
      await this.injectAndValidateFile({ ...context, boundary: fsyncAfter }, options.journalLease, opened, journalPath);
      return opened.metadata;
    } finally {
      await opened.handle.close();
    }
  }

  private async compactCommittedRecords(
    journalLease: PresentationOwnedDirectoryLease,
    expectedJournalIdentity: BigIntStats | null
  ): Promise<void> {
    await journalLease.assertCurrent();
    if (expectedJournalIdentity === null) return;
    const journalPath = this.files.getJournalPath();
    const opened = await openOwnedFile(journalPath, constants.O_RDWR);
    try {
      if (!sameFileIdentity(expectedJournalIdentity, opened.metadata)) throw new Error(CHANGED_FILE_ERROR);
      await journalLease.assertCurrent();
      await assertOpenFileUnchanged(opened, journalPath);
      await opened.handle.truncate(0);
      await refreshOpenFileAfterMutation(opened, journalPath);
      await opened.handle.sync();
      await assertOpenFileUnchanged(opened, journalPath);
      await journalLease.assertCurrent();
    } finally {
      await opened.handle.close();
    }
  }

  private async applyIntent(intent: IntentRecord, recovering = false): Promise<void> {
    for (const promotion of intent.retainedCandidatePromotions) {
      await this.files.recoverRetainedCandidatePromotion(promotion);
    }
    for (const promotion of intent.sourceSnapshotPromotions) {
      await this.files.recoverSourceSnapshotPromotion(promotion);
    }
    for (const promotion of intent.preparedRunAssetPromotions) {
      await this.files.recoverRunAssetPromotion(promotion);
    }
    for (const [mutationIndex, mutation] of intent.mutations.entries()) {
      if (recovering && (await this.isMutationApplied(mutation))) continue;
      if (recovering) await this.assertExpectedRevision(mutation);
      await this.writeManifest(intent.transactionId, mutationIndex, mutation);
    }
  }

  private async writeManifest(
    transactionId: string,
    mutationIndex: number,
    mutation: PresentationRunJournalMutation
  ): Promise<void> {
    await this.ensureEntityLayout(mutation.entityKind, mutation.entityId);
    const manifestPath = this.files.getEntityManifestPath(mutation.entityKind, mutation.entityId);
    const temporaryPath = path.join(path.dirname(manifestPath), `.manifest-${transactionId}-${mutationIndex}.tmp`);
    const context = {
      transactionId,
      mutationIndex,
      entityKind: mutation.entityKind,
      entityId: mutation.entityId,
    };
    await this.files.withEntityParentDirectoryLease(mutation.entityKind, mutation.entityId, async (directoryLease) => {
      await removeOwnedFileIfPresent(temporaryPath, directoryLease);
      let opened: OpenOwnedFile | null = null;
      let temporaryStillNamed = true;
      try {
        await directoryLease.assertCurrent();
        opened = await openOwnedFile(
          temporaryPath,
          constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
          PRESENTATION_RUN_LIMITS.OWNED_FILE_MODE
        );
        await this.injectAndValidateFile(
          { ...context, boundary: 'before-manifest-write' },
          directoryLease,
          opened,
          temporaryPath
        );
        await opened.handle.writeFile(`${JSON.stringify(mutation.nextManifest, null, 2)}\n`, 'utf8');
        await refreshOpenFileAfterMutation(opened, temporaryPath);
        await this.injectAndValidateFile(
          { ...context, boundary: 'after-manifest-write' },
          directoryLease,
          opened,
          temporaryPath
        );
        await this.injectAndValidateFile(
          { ...context, boundary: 'before-manifest-fsync' },
          directoryLease,
          opened,
          temporaryPath
        );
        await opened.handle.sync();
        await assertOpenFileUnchanged(opened, temporaryPath);
        await this.injectAndValidateFile(
          { ...context, boundary: 'after-manifest-fsync' },
          directoryLease,
          opened,
          temporaryPath
        );
        await this.injectAndValidateFile(
          { ...context, boundary: 'before-manifest-rename' },
          directoryLease,
          opened,
          temporaryPath
        );
        await rename(temporaryPath, manifestPath);
        temporaryStillNamed = false;
        await refreshOpenFileAfterMutation(opened, manifestPath);
        await directoryLease.assertCurrent();
        await this.injectAndValidateFile(
          { ...context, boundary: 'after-manifest-rename' },
          directoryLease,
          opened,
          manifestPath
        );
        await this.injectAndValidateFile(
          { ...context, boundary: 'before-manifest-directory-fsync' },
          directoryLease,
          opened,
          manifestPath
        );
        await directoryLease.sync(path.dirname(manifestPath));
        await assertOpenFileUnchanged(opened, manifestPath);
        await this.injectAndValidateFile(
          { ...context, boundary: 'after-manifest-directory-fsync' },
          directoryLease,
          opened,
          manifestPath
        );
      } catch (error) {
        if (opened !== null && temporaryStillNamed) {
          try {
            await removeOpenFileIfCurrent(temporaryPath, opened, directoryLease);
          } catch (cleanupError) {
            throw cleanupFailure(error, cleanupError);
          }
        }
        throw error;
      } finally {
        if (opened !== null) await opened.handle.close().catch((): undefined => undefined);
      }
    });
  }

  private async assertExpectedRevision(mutation: PresentationRunJournalMutation): Promise<void> {
    const current = await this.readCanonical<Record<string, unknown>>(mutation.entityKind, mutation.entityId);
    const revision = current === null ? null : manifestRevision(current);
    if (revision !== mutation.expectedRevision) throw new Error('Presentation canonical revision conflict');
    const nextRevision = manifestRevision(mutation.nextManifest);
    const expectedNext = mutation.expectedRevision === null ? 0 : mutation.expectedRevision + 1;
    const isFirstConversationOwnerMutation =
      mutation.entityKind === 'owner' &&
      mutation.expectedRevision === null &&
      nextRevision === 1 &&
      mutation.nextManifest.recordType === 'presentation-source-owner' &&
      isRecord(mutation.nextManifest.owner) &&
      mutation.nextManifest.owner.owner_type === 'conversation';
    if (nextRevision !== expectedNext && !isFirstConversationOwnerMutation) {
      throw new Error('Presentation canonical revision must increase by one');
    }
  }

  private async assertPreparedRunContinuity(input: PresentationRunJournalTransaction): Promise<void> {
    const promotedRunIds = new Set((input.preparedRunAssetPromotions ?? []).map(({ runId }) => runId));
    await Promise.all(
      input.mutations.map(async (mutation): Promise<void> => {
        if (
          mutation.entityKind !== 'run' ||
          mutation.nextManifest.preparation == null ||
          promotedRunIds.has(mutation.entityId)
        ) {
          return;
        }
        const current = await this.readCanonical<Record<string, unknown>>(mutation.entityKind, mutation.entityId);
        if (current === null || !isDeepStrictEqual(current.preparation, mutation.nextManifest.preparation)) {
          throw new Error('Presentation prepared run assets require an exact promotion or immutable preservation');
        }
      })
    );
  }

  private async isMutationApplied(mutation: PresentationRunJournalMutation): Promise<boolean> {
    const current = await this.readCanonical<Record<string, unknown>>(mutation.entityKind, mutation.entityId);
    return current !== null && JSON.stringify(current) === JSON.stringify(mutation.nextManifest);
  }

  private async ensureEntityLayout(kind: PresentationRunEntityKind, entityId: string): Promise<void> {
    if (kind === 'run') {
      await this.files.createRunLayout(entityId);
    } else if (kind === 'grant') {
      await this.files.createGrantLayout(entityId);
    } else if (kind === 'draft') {
      await this.files.createDraftLayout(entityId);
    } else if (kind === 'owner') {
      await this.files.createOwnerLayout(entityId);
    } else {
      await this.files.initialize();
    }
  }

  private async readRecords(journalLease: PresentationOwnedDirectoryLease): Promise<ReadRecordsResult> {
    const journalPath = this.files.getJournalPath();
    await journalLease.assertCurrent();
    let opened: OpenOwnedFile;
    try {
      opened = await openOwnedFile(journalPath, constants.O_RDWR);
    } catch (error) {
      if (hasCode(error, 'ENOENT')) {
        await journalLease.assertCurrent();
        return { records: [], journalIdentity: null };
      }
      throw error;
    }
    try {
      let bytes = await opened.handle.readFile();
      await assertOpenFileUnchanged(opened, journalPath);
      await journalLease.assertCurrent();
      if (bytes.length > 0 && bytes[bytes.length - 1] !== 0x0a) {
        const lastNewline = bytes.lastIndexOf(0x0a);
        const retainedLength = lastNewline < 0 ? 0 : lastNewline + 1;
        await opened.handle.truncate(retainedLength);
        await refreshOpenFileAfterMutation(opened, journalPath);
        await opened.handle.sync();
        await assertOpenFileUnchanged(opened, journalPath);
        await journalLease.assertCurrent();
        bytes = bytes.subarray(0, retainedLength);
      }
      const lines = bytes.toString('utf8').split('\n');
      const records = lines.filter((line) => line.length > 0).map(parseJournalRecord);
      await assertOpenFileUnchanged(opened, journalPath);
      await journalLease.assertCurrent();
      return { records, journalIdentity: opened.metadata };
    } finally {
      await opened.handle.close();
    }
  }

  private async injectAndValidateFile(
    point: PresentationRunFailurePoint,
    directoryLease: PresentationOwnedDirectoryLease,
    opened: OpenOwnedFile,
    filePath: string
  ): Promise<void> {
    await this.inject(point);
    await directoryLease.assertCurrent();
    await assertOpenFileUnchanged(opened, filePath);
  }

  private async inject(point: PresentationRunFailurePoint): Promise<void> {
    await this.failureInjector?.(point);
  }

  private async serialized<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.serializationTail;
    let release: () => void = (): void => undefined;
    this.serializationTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }
}
