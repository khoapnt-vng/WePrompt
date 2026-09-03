/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-disable no-await-in-loop -- Recovery deliberately classifies and removes one bounded entry at a time. */

import { randomBytes } from 'node:crypto';
import { constants as fsConstants, promises as nodeFs } from 'node:fs';
import path from 'node:path';
import { isStudioProjectIdV4 } from '@/common/types/project/creativeStudioTypes';
import { syncDurableDirectory } from '../../service/durableDirectory';
import { type RecordIoFileSystem, resolveConfinedRecordPath } from '../../service/recordIo';

const WRITER_GATE_SCHEMA_VERSION = 1 as const;
const WRITER_GATE_PREFIX = '.project-write-';
const WRITER_GATE_SUFFIX = '.lock';
const WRITER_GATE_OWNER_NAME = 'owner.json';
const WRITER_GATE_READY_NAME = 'ready';
const WRITER_GATE_RECOVERY_NAME = 'recovery';
const WRITER_GATE_RECOVERY_CLAIM_NAME = 'claim.json';
const WRITER_GATE_RETIRED_PREFIX = '.project-write-retired-';
const WRITER_GATE_OWNER_MAX_BYTES = 2_048;
const WRITER_GATE_RECOVERY_CANDIDATE_LIMIT = 1_024;
const WRITER_GATE_DIRECTORY_MODE = 0o700;
const WRITER_GATE_FILE_MODE = 0o600;
const WRITER_GATE_OWNER_KEYS = new Set([
  'schemaVersion',
  'projectId',
  'operationId',
  'mainInstanceId',
  'purpose',
  'proposalId',
]);
const RECOVERY_CLAIM_KEYS = new Set([
  'schemaVersion',
  'projectId',
  'ownerOperationId',
  'recoveryOperationId',
  'mainInstanceId',
  'purpose',
  'proposalId',
]);
const SAFE_PROPOSAL_ID = /^[A-Za-z0-9_-]{1,256}$/;
const SAFE_OPERATION_ID = /^[A-Za-z0-9_-]{8,128}$/;
const SAFE_MAIN_INSTANCE_ID = /^[A-Za-z0-9_-]{8,64}$/;
const SAFE_RETIRED_NAME = /^\.project-write-retired-[A-Za-z0-9_-]{8,128}$/;
const PROCESS_MAIN_INSTANCE_ID = randomBytes(16).toString('hex');

/** Recovery operations share this queue even when callers construct independent gate instances. */
const PROCESS_RECOVERY_QUEUES = new Map<string, Promise<void>>();
/**
 * Only lock publication is serialized in-process. The directory remains the writer authority,
 * and a contender still fails busy; this fence prevents it from observing a locally-created lock
 * during the short owner/ready durability window.
 */
const PROCESS_PUBLICATION_QUEUES = new Map<string, Promise<void>>();
/** Completion signals for writers owned by this Main process; never used as durable authority. */
const PROCESS_ACTIVE_WRITERS = new Map<string, Set<Promise<void>>>();

export const STUDIO_PROJECT_WRITER_MAIN_INSTANCE_ID_V4 = PROCESS_MAIN_INSTANCE_ID;

export type StudioProjectWriterIntentV4 =
  | Readonly<{ purpose: 'project_update' }>
  | Readonly<{ purpose: 'proposal_terminal'; proposalId: string }>;

export type StudioProjectWriterOwnerV4 = Readonly<{
  schemaVersion: typeof WRITER_GATE_SCHEMA_VERSION;
  projectId: string;
  operationId: string;
  mainInstanceId: string;
  purpose: StudioProjectWriterIntentV4['purpose'];
  proposalId: string | null;
}>;

export type StudioProjectWriterGateStepV4 =
  | 'owner_durable'
  | 'gate_published'
  | 'root_durable'
  | 'recovery_owner_captured'
  | 'recovery_claim_durable'
  | 'retired'
  | 'retirement_durable'
  | 'retired_residue_removed';

export type StudioProjectWriterGateErrorCodeV4 = 'invalid_payload' | 'busy' | 'recovery_refused' | 'storage_error';

export class StudioProjectWriterGateErrorV4 extends Error {
  readonly code: StudioProjectWriterGateErrorCodeV4;

  constructor(code: StudioProjectWriterGateErrorCodeV4) {
    super(code);
    this.name = 'StudioProjectWriterGateErrorV4';
    this.code = code;
  }
}

export type StudioProjectWriterGateOptionsV4 = {
  fs?: RecordIoFileSystem;
  mainInstanceId?: string;
  createOperationId?: () => string;
  /** Retained for API compatibility; retired names are now deterministically derived from the owner operation id. */
  createRetirementId?: () => string;
  /** Injectable only for permission-mode interpretation in cross-platform tests. */
  platform?: NodeJS.Platform;
  /** Must consult Electron's actual lock, never the E2E/multi-instance `gotTheLock` shortcut. */
  hasSingleInstanceRecoveryAuthority?: () => boolean;
  onStep?: (step: StudioProjectWriterGateStepV4, projectId: string) => void | Promise<void>;
};

export type StudioProjectWriterLeaseV4 = Readonly<{
  owner: StudioProjectWriterOwnerV4;
  recovered: boolean;
  retainForRecovery(): void;
  /** Internal rollback acknowledgement; call only after the durable intent was identity-checked and removed. */
  clearRecoveryRetention(): void;
  assertOwned(): Promise<void>;
}>;

export type StudioProjectWriterGateV4 = {
  withWriter<Result>(
    canonicalRoot: string,
    projectId: string,
    intent: StudioProjectWriterIntentV4,
    operation: (lease: StudioProjectWriterLeaseV4) => Promise<Result>
  ): Promise<Result>;
  recoverWriter<Result>(
    canonicalRoot: string,
    projectId: string,
    intent: StudioProjectWriterIntentV4,
    operation: (lease: StudioProjectWriterLeaseV4) => Promise<Result>
  ): Promise<Result>;
  /** Reads only a complete durable owner; it never grants writer or recovery authority. */
  readIntent(canonicalRoot: string, projectId: string): Promise<StudioProjectWriterIntentV4 | null>;
  /** Waits only for a writer known to this Main process. False means no local writer was observed. */
  waitForLocalWriter(canonicalRoot: string, projectId: string): Promise<boolean>;
  assertUnlocked(canonicalRoot: string, projectId: string): Promise<void>;
  /** Startup-only inventory; authority must come from Electron's actual single-instance lock. */
  listRecoveryCandidates(canonicalRoot: string): Promise<StudioProjectWriterOwnerV4[]>;
};

type Identity = Readonly<{ dev: bigint; ino: bigint }>;
type CapturedFile = Readonly<{ identity: Identity; bytes: string }>;
type CapturedDirectory = Readonly<{ identity: Identity; path: string }>;

type StudioProjectWriterRecoveryClaimV4 = Readonly<{
  schemaVersion: typeof WRITER_GATE_SCHEMA_VERSION;
  projectId: string;
  ownerOperationId: string;
  recoveryOperationId: string;
  mainInstanceId: string;
  purpose: StudioProjectWriterIntentV4['purpose'];
  proposalId: string | null;
}>;

type CapturedRecoveryClaim = Readonly<{
  directory: CapturedDirectory;
  claimFile: CapturedFile;
  record: StudioProjectWriterRecoveryClaimV4;
}>;

type CapturedGate = Readonly<{
  root: Identity;
  directory: CapturedDirectory;
  ownerFile: CapturedFile;
  owner: StudioProjectWriterOwnerV4;
  ready: CapturedDirectory;
  recoveryClaim: CapturedRecoveryClaim | null;
}>;

type RecoveryShape =
  | Readonly<{ kind: 'none' }>
  | Readonly<{ kind: 'incomplete'; directory: CapturedDirectory; claimFile: CapturedFile | null }>
  | Readonly<{ kind: 'valid'; claim: CapturedRecoveryClaim }>;

type LockShape =
  | Readonly<{ kind: 'absent' }>
  | Readonly<{
      kind: 'incomplete';
      root: Identity;
      directory: CapturedDirectory;
      ownerFile: CapturedFile | null;
    }>
  | Readonly<{ kind: 'complete'; gate: CapturedGate; recoveryShape: RecoveryShape }>;

const hasCode = (error: unknown, code: string): boolean =>
  typeof error === 'object' && error !== null && !Array.isArray(error) && (error as { code?: unknown }).code === code;

const storageError = (): StudioProjectWriterGateErrorV4 => new StudioProjectWriterGateErrorV4('storage_error');

const sameIdentity = (left: Identity, right: Identity): boolean => left.dev === right.dev && left.ino === right.ino;

const identityOf = (stats: { dev: bigint; ino: bigint }): Identity => ({ dev: stats.dev, ino: stats.ino });

const exactKeys = (value: Record<string, unknown>, expected: ReadonlySet<string>): boolean => {
  const keys = Reflect.ownKeys(value);
  return keys.length === expected.size && keys.every((key) => typeof key === 'string' && expected.has(key));
};

const canonicalOwnerBytes = (owner: StudioProjectWriterOwnerV4): string => JSON.stringify(owner);

const ownerIntent = (owner: StudioProjectWriterOwnerV4): StudioProjectWriterIntentV4 =>
  owner.purpose === 'proposal_terminal'
    ? Object.freeze({ purpose: 'proposal_terminal', proposalId: owner.proposalId! })
    : Object.freeze({ purpose: 'project_update' });

const parseOwner = (bytes: string): StudioProjectWriterOwnerV4 | null => {
  if (Buffer.byteLength(bytes, 'utf8') > WRITER_GATE_OWNER_MAX_BYTES) return null;
  let value: unknown;
  try {
    value = JSON.parse(bytes) as unknown;
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    !exactKeys(record, WRITER_GATE_OWNER_KEYS) ||
    record.schemaVersion !== WRITER_GATE_SCHEMA_VERSION ||
    !isStudioProjectIdV4(record.projectId) ||
    typeof record.operationId !== 'string' ||
    !SAFE_OPERATION_ID.test(record.operationId) ||
    typeof record.mainInstanceId !== 'string' ||
    !SAFE_MAIN_INSTANCE_ID.test(record.mainInstanceId) ||
    (record.purpose !== 'project_update' && record.purpose !== 'proposal_terminal') ||
    (record.proposalId !== null &&
      (typeof record.proposalId !== 'string' || !SAFE_PROPOSAL_ID.test(record.proposalId))) ||
    (record.purpose === 'project_update' && record.proposalId !== null) ||
    (record.purpose === 'proposal_terminal' && record.proposalId === null)
  ) {
    return null;
  }
  const owner = record as StudioProjectWriterOwnerV4;
  return canonicalOwnerBytes(owner) === bytes ? owner : null;
};

const parseRecoveryClaim = (bytes: string): StudioProjectWriterRecoveryClaimV4 | null => {
  if (Buffer.byteLength(bytes, 'utf8') > WRITER_GATE_OWNER_MAX_BYTES) return null;
  let value: unknown;
  try {
    value = JSON.parse(bytes) as unknown;
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    !exactKeys(record, RECOVERY_CLAIM_KEYS) ||
    record.schemaVersion !== WRITER_GATE_SCHEMA_VERSION ||
    !isStudioProjectIdV4(record.projectId) ||
    typeof record.ownerOperationId !== 'string' ||
    !SAFE_OPERATION_ID.test(record.ownerOperationId) ||
    typeof record.recoveryOperationId !== 'string' ||
    !SAFE_OPERATION_ID.test(record.recoveryOperationId) ||
    typeof record.mainInstanceId !== 'string' ||
    !SAFE_MAIN_INSTANCE_ID.test(record.mainInstanceId) ||
    (record.purpose !== 'project_update' && record.purpose !== 'proposal_terminal') ||
    (record.proposalId !== null &&
      (typeof record.proposalId !== 'string' || !SAFE_PROPOSAL_ID.test(record.proposalId))) ||
    (record.purpose === 'project_update' && record.proposalId !== null) ||
    (record.purpose === 'proposal_terminal' && record.proposalId === null)
  ) {
    return null;
  }
  const claim = record as StudioProjectWriterRecoveryClaimV4;
  return JSON.stringify(claim) === bytes ? claim : null;
};

const writerGateName = (projectId: string): string => `${WRITER_GATE_PREFIX}${projectId}${WRITER_GATE_SUFFIX}`;
const retiredGateName = (operationId: string): string => `${WRITER_GATE_RETIRED_PREFIX}${operationId}`;

const modeIs = (mode: bigint, expected: number, platform: NodeJS.Platform): boolean =>
  platform === 'win32' || Number(mode & BigInt(0o777)) === expected;

const lstatBig = (fs: RecordIoFileSystem, target: string) => fs.lstat(target, { bigint: true });

const assertCanonicalRoot = async (fs: RecordIoFileSystem, canonicalRoot: string): Promise<Identity> => {
  try {
    const stats = await lstatBig(fs, canonicalRoot);
    if (!stats.isDirectory() || stats.isSymbolicLink() || (await fs.realpath(canonicalRoot)) !== canonicalRoot) {
      throw storageError();
    }
    return identityOf(stats);
  } catch (error) {
    if (error instanceof StudioProjectWriterGateErrorV4) throw error;
    throw storageError();
  }
};

const captureDirectory = async (
  fs: RecordIoFileSystem,
  canonicalRoot: string,
  directoryPath: string,
  platform: NodeJS.Platform
): Promise<CapturedDirectory> => {
  try {
    const stats = await lstatBig(fs, directoryPath);
    if (
      !stats.isDirectory() ||
      stats.isSymbolicLink() ||
      !modeIs(stats.mode, WRITER_GATE_DIRECTORY_MODE, platform) ||
      (await fs.realpath(directoryPath)) !== directoryPath ||
      !directoryPath.startsWith(`${canonicalRoot}${path.sep}`)
    ) {
      throw storageError();
    }
    return { identity: identityOf(stats), path: directoryPath };
  } catch (error) {
    if (error instanceof StudioProjectWriterGateErrorV4 || hasCode(error, 'ENOENT')) throw error;
    throw storageError();
  }
};

/** Opens without following links and reads at most MAX+1 bytes, then binds the bytes to the path identity. */
const captureBoundedFile = async (
  fs: RecordIoFileSystem,
  filePath: string,
  platform: NodeJS.Platform
): Promise<CapturedFile> => {
  let handle: Awaited<ReturnType<RecordIoFileSystem['open']>> | null = null;
  try {
    const before = await lstatBig(fs, filePath);
    if (
      !before.isFile() ||
      before.isSymbolicLink() ||
      !modeIs(before.mode, WRITER_GATE_FILE_MODE, platform) ||
      before.size > BigInt(WRITER_GATE_OWNER_MAX_BYTES)
    ) {
      throw storageError();
    }
    handle = await fs.open(filePath, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
    const opened = await handle.stat({ bigint: true });
    if (
      !opened.isFile() ||
      !sameIdentity(identityOf(before), identityOf(opened)) ||
      !modeIs(opened.mode, WRITER_GATE_FILE_MODE, platform) ||
      opened.size > BigInt(WRITER_GATE_OWNER_MAX_BYTES)
    ) {
      throw storageError();
    }
    const buffer = Buffer.alloc(WRITER_GATE_OWNER_MAX_BYTES + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const result = await handle.read(buffer, offset, buffer.length - offset, offset);
      if (result.bytesRead === 0) break;
      offset += result.bytesRead;
    }
    if (offset > WRITER_GATE_OWNER_MAX_BYTES) throw storageError();
    const afterHandle = await handle.stat({ bigint: true });
    const afterPath = await lstatBig(fs, filePath);
    if (
      !sameIdentity(identityOf(before), identityOf(afterHandle)) ||
      !sameIdentity(identityOf(before), identityOf(afterPath)) ||
      afterHandle.size !== BigInt(offset) ||
      afterPath.size !== BigInt(offset)
    ) {
      throw storageError();
    }
    return { identity: identityOf(before), bytes: buffer.subarray(0, offset).toString('utf8') };
  } catch (error) {
    if (error instanceof StudioProjectWriterGateErrorV4 || hasCode(error, 'ENOENT')) throw error;
    throw storageError();
  } finally {
    await handle?.close().catch((): undefined => undefined);
  }
};

const assertDirectoryIdentity = async (
  fs: RecordIoFileSystem,
  canonicalRoot: string,
  captured: CapturedDirectory,
  platform: NodeJS.Platform
): Promise<void> => {
  const current = await captureDirectory(fs, canonicalRoot, captured.path, platform);
  if (!sameIdentity(current.identity, captured.identity)) throw storageError();
};

const assertFileIdentity = async (
  fs: RecordIoFileSystem,
  filePath: string,
  captured: CapturedFile,
  platform: NodeJS.Platform
): Promise<void> => {
  const current = await captureBoundedFile(fs, filePath, platform);
  if (!sameIdentity(current.identity, captured.identity) || current.bytes !== captured.bytes) throw storageError();
};

const writeExclusiveDurableFile = async (
  fs: RecordIoFileSystem,
  filePath: string,
  bytes: string,
  platform: NodeJS.Platform
): Promise<CapturedFile> => {
  let handle: Awaited<ReturnType<RecordIoFileSystem['open']>> | null = null;
  try {
    handle = await fs.open(
      filePath,
      fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | (fsConstants.O_NOFOLLOW ?? 0),
      WRITER_GATE_FILE_MODE
    );
    await handle.writeFile(bytes, 'utf8');
    await handle.sync();
    const stats = await handle.stat({ bigint: true });
    if (
      !stats.isFile() ||
      !modeIs(stats.mode, WRITER_GATE_FILE_MODE, platform) ||
      stats.size !== BigInt(Buffer.byteLength(bytes, 'utf8')) ||
      stats.size > BigInt(WRITER_GATE_OWNER_MAX_BYTES)
    ) {
      throw storageError();
    }
    return { identity: identityOf(stats), bytes };
  } catch (error) {
    if (error instanceof StudioProjectWriterGateErrorV4) throw error;
    throw storageError();
  } finally {
    await handle?.close().catch((): undefined => undefined);
  }
};

const captureRecoveryShape = async (
  fs: RecordIoFileSystem,
  canonicalRoot: string,
  gateDirectory: CapturedDirectory,
  owner: StudioProjectWriterOwnerV4,
  platform: NodeJS.Platform
): Promise<RecoveryShape> => {
  const recoveryPath = resolveConfinedRecordPath(canonicalRoot, gateDirectory.path, WRITER_GATE_RECOVERY_NAME);
  let recoveryDirectory: CapturedDirectory;
  try {
    recoveryDirectory = await captureDirectory(fs, canonicalRoot, recoveryPath, platform);
  } catch (error) {
    if (hasCode(error, 'ENOENT')) return { kind: 'none' };
    throw error;
  }
  const entries = await fs.readdir(recoveryPath, { withFileTypes: true }).catch((error: unknown) => {
    if (hasCode(error, 'ENOENT')) throw error;
    throw storageError();
  });
  if (
    entries.length > 1 ||
    entries.some((entry) => entry.name !== WRITER_GATE_RECOVERY_CLAIM_NAME || !entry.isFile() || entry.isSymbolicLink())
  ) {
    throw storageError();
  }
  if (entries.length === 0) return { kind: 'incomplete', directory: recoveryDirectory, claimFile: null };
  const claimPath = resolveConfinedRecordPath(canonicalRoot, recoveryPath, WRITER_GATE_RECOVERY_CLAIM_NAME);
  const claimFile = await captureBoundedFile(fs, claimPath, platform);
  const record = parseRecoveryClaim(claimFile.bytes);
  if (
    record === null ||
    record.projectId !== owner.projectId ||
    record.ownerOperationId !== owner.operationId ||
    record.purpose !== owner.purpose ||
    record.proposalId !== owner.proposalId
  ) {
    return { kind: 'incomplete', directory: recoveryDirectory, claimFile };
  }
  return { kind: 'valid', claim: { directory: recoveryDirectory, claimFile, record } };
};

const inspectLockOnce = async (
  fs: RecordIoFileSystem,
  canonicalRoot: string,
  projectId: string,
  platform: NodeJS.Platform,
  captureIncompleteOwner = true
): Promise<LockShape> => {
  const root = await assertCanonicalRoot(fs, canonicalRoot);
  const lockPath = resolveConfinedRecordPath(canonicalRoot, canonicalRoot, writerGateName(projectId));
  let directory: CapturedDirectory;
  try {
    directory = await captureDirectory(fs, canonicalRoot, lockPath, platform);
  } catch (error) {
    if (hasCode(error, 'ENOENT')) return { kind: 'absent' };
    throw error;
  }
  const entries = await fs.readdir(lockPath, { withFileTypes: true }).catch((error: unknown) => {
    if (hasCode(error, 'ENOENT')) throw error;
    throw storageError();
  });
  const allowed = new Set([WRITER_GATE_OWNER_NAME, WRITER_GATE_READY_NAME, WRITER_GATE_RECOVERY_NAME]);
  if (entries.length > allowed.size || entries.some((entry) => !allowed.has(entry.name))) throw storageError();
  const ownerEntry = entries.find((entry) => entry.name === WRITER_GATE_OWNER_NAME);
  const readyEntry = entries.find((entry) => entry.name === WRITER_GATE_READY_NAME);
  const recoveryEntry = entries.find((entry) => entry.name === WRITER_GATE_RECOVERY_NAME);
  if (
    (ownerEntry !== undefined && (!ownerEntry.isFile() || ownerEntry.isSymbolicLink())) ||
    (readyEntry !== undefined && (!readyEntry.isDirectory() || readyEntry.isSymbolicLink())) ||
    (recoveryEntry !== undefined && (!recoveryEntry.isDirectory() || recoveryEntry.isSymbolicLink()))
  ) {
    throw storageError();
  }
  if (readyEntry === undefined) {
    if (recoveryEntry !== undefined) throw storageError();
    const ownerFile =
      ownerEntry === undefined || !captureIncompleteOwner
        ? null
        : await captureBoundedFile(
            fs,
            resolveConfinedRecordPath(canonicalRoot, lockPath, WRITER_GATE_OWNER_NAME),
            platform
          );
    await assertDirectoryIdentity(fs, canonicalRoot, directory, platform);
    return { kind: 'incomplete', root, directory, ownerFile };
  }
  if (ownerEntry === undefined) {
    // `ready/` is the commit marker. Once present, missing or corrupt owner data is never repairable.
    throw storageError();
  }
  const ownerPath = resolveConfinedRecordPath(canonicalRoot, lockPath, WRITER_GATE_OWNER_NAME);
  const ownerFile = await captureBoundedFile(fs, ownerPath, platform);
  const owner = parseOwner(ownerFile.bytes);
  if (owner === null || owner.projectId !== projectId) throw storageError();
  const readyPath = resolveConfinedRecordPath(canonicalRoot, lockPath, WRITER_GATE_READY_NAME);
  const ready = await captureDirectory(fs, canonicalRoot, readyPath, platform);
  if ((await fs.readdir(readyPath)).length !== 0) throw storageError();
  const recoveryShape = await captureRecoveryShape(fs, canonicalRoot, directory, owner, platform);
  if (!sameIdentity(root, await assertCanonicalRoot(fs, canonicalRoot))) throw storageError();
  await assertDirectoryIdentity(fs, canonicalRoot, directory, platform);
  await assertFileIdentity(fs, ownerPath, ownerFile, platform);
  await assertDirectoryIdentity(fs, canonicalRoot, ready, platform);
  if ((await fs.readdir(readyPath)).length !== 0) throw storageError();
  const recoveryClaim = recoveryShape.kind === 'valid' ? recoveryShape.claim : null;
  return {
    kind: 'complete',
    gate: { root, directory, ownerFile, owner, ready, recoveryClaim },
    recoveryShape,
  };
};

/**
 * Retirement may remove a completely captured lock between any two no-follow checks. Recapture
 * once so a stable disappearance is absence, while a second unstable or replacement shape never
 * grants startup cleanup authority.
 */
const inspectLock = async (
  fs: RecordIoFileSystem,
  canonicalRoot: string,
  projectId: string,
  platform: NodeJS.Platform,
  captureIncompleteOwner = true
): Promise<LockShape> => {
  try {
    return await inspectLockOnce(fs, canonicalRoot, projectId, platform, captureIncompleteOwner);
  } catch (error) {
    if (!hasCode(error, 'ENOENT')) throw error;
  }
  try {
    return await inspectLockOnce(fs, canonicalRoot, projectId, platform, captureIncompleteOwner);
  } catch (error) {
    if (!hasCode(error, 'ENOENT')) throw error;
  }

  const root = await assertCanonicalRoot(fs, canonicalRoot);
  const lockPath = resolveConfinedRecordPath(canonicalRoot, canonicalRoot, writerGateName(projectId));
  let directory: CapturedDirectory;
  try {
    directory = await captureDirectory(fs, canonicalRoot, lockPath, platform);
  } catch (error) {
    if (hasCode(error, 'ENOENT')) return { kind: 'absent' };
    throw error;
  }
  if (captureIncompleteOwner) throw storageError();
  return { kind: 'incomplete', root, directory, ownerFile: null };
};

const assertCapturedGateAt = async (
  fs: RecordIoFileSystem,
  canonicalRoot: string,
  captured: CapturedGate,
  gatePath: string,
  platform: NodeJS.Platform
): Promise<void> => {
  if (!sameIdentity(captured.root, await assertCanonicalRoot(fs, canonicalRoot))) throw storageError();
  const directory = await captureDirectory(fs, canonicalRoot, gatePath, platform);
  if (!sameIdentity(directory.identity, captured.directory.identity)) throw storageError();
  const expectedNames = [WRITER_GATE_OWNER_NAME, WRITER_GATE_READY_NAME];
  if (captured.recoveryClaim !== null) expectedNames.push(WRITER_GATE_RECOVERY_NAME);
  const entries = await fs.readdir(gatePath, { withFileTypes: true });
  if (
    entries.length !== expectedNames.length ||
    entries.some((entry) => !expectedNames.includes(entry.name)) ||
    entries.some((entry) => entry.isSymbolicLink())
  ) {
    throw storageError();
  }
  const ownerPath = resolveConfinedRecordPath(canonicalRoot, gatePath, WRITER_GATE_OWNER_NAME);
  await assertFileIdentity(fs, ownerPath, captured.ownerFile, platform);
  const readyPath = resolveConfinedRecordPath(canonicalRoot, gatePath, WRITER_GATE_READY_NAME);
  const ready = await captureDirectory(fs, canonicalRoot, readyPath, platform);
  if (!sameIdentity(ready.identity, captured.ready.identity) || (await fs.readdir(readyPath)).length !== 0) {
    throw storageError();
  }
  if (captured.recoveryClaim !== null) {
    const recoveryPath = resolveConfinedRecordPath(canonicalRoot, gatePath, WRITER_GATE_RECOVERY_NAME);
    const recovery = await captureDirectory(fs, canonicalRoot, recoveryPath, platform);
    if (!sameIdentity(recovery.identity, captured.recoveryClaim.directory.identity)) throw storageError();
    const recoveryEntries = await fs.readdir(recoveryPath, { withFileTypes: true });
    if (
      recoveryEntries.length !== 1 ||
      recoveryEntries[0]?.name !== WRITER_GATE_RECOVERY_CLAIM_NAME ||
      !recoveryEntries[0].isFile() ||
      recoveryEntries[0].isSymbolicLink()
    ) {
      throw storageError();
    }
    await assertFileIdentity(
      fs,
      resolveConfinedRecordPath(canonicalRoot, recoveryPath, WRITER_GATE_RECOVERY_CLAIM_NAME),
      captured.recoveryClaim.claimFile,
      platform
    );
  }
};

const assertCapturedGate = async (
  fs: RecordIoFileSystem,
  canonicalRoot: string,
  captured: CapturedGate,
  platform: NodeJS.Platform
): Promise<void> => assertCapturedGateAt(fs, canonicalRoot, captured, captured.directory.path, platform);

const unlinkCapturedFile = async (
  fs: RecordIoFileSystem,
  filePath: string,
  captured: CapturedFile,
  platform: NodeJS.Platform,
  authorizeDestructiveStep?: () => void
): Promise<void> => {
  await assertFileIdentity(fs, filePath, captured, platform);
  authorizeDestructiveStep?.();
  await fs.unlink(filePath).catch(() => {
    throw storageError();
  });
};

const rmdirCaptured = async (
  fs: RecordIoFileSystem,
  canonicalRoot: string,
  captured: CapturedDirectory,
  platform: NodeJS.Platform,
  authorizeDestructiveStep?: () => void
): Promise<void> => {
  await assertDirectoryIdentity(fs, canonicalRoot, captured, platform);
  if ((await fs.readdir(captured.path)).length !== 0) throw storageError();
  authorizeDestructiveStep?.();
  await fs.rmdir(captured.path).catch(() => {
    throw storageError();
  });
};

const removeCapturedRecovery = async (
  fs: RecordIoFileSystem,
  canonicalRoot: string,
  recovery: Exclude<RecoveryShape, { kind: 'none' }>,
  platform: NodeJS.Platform,
  authorizeDestructiveStep?: () => void
): Promise<void> => {
  const claimFile = recovery.kind === 'valid' ? recovery.claim.claimFile : recovery.claimFile;
  const directory = recovery.kind === 'valid' ? recovery.claim.directory : recovery.directory;
  if (claimFile !== null) {
    await unlinkCapturedFile(
      fs,
      resolveConfinedRecordPath(canonicalRoot, directory.path, WRITER_GATE_RECOVERY_CLAIM_NAME),
      claimFile,
      platform,
      authorizeDestructiveStep
    );
  }
  await rmdirCaptured(fs, canonicalRoot, directory, platform, authorizeDestructiveStep);
};

const removeIncompleteLock = async (
  fs: RecordIoFileSystem,
  canonicalRoot: string,
  shape: Extract<LockShape, { kind: 'incomplete' }>,
  platform: NodeJS.Platform,
  authorizeDestructiveStep?: () => void
): Promise<void> => {
  if (!sameIdentity(shape.root, await assertCanonicalRoot(fs, canonicalRoot))) throw storageError();
  await assertDirectoryIdentity(fs, canonicalRoot, shape.directory, platform);
  const entries = await fs.readdir(shape.directory.path, { withFileTypes: true });
  if (
    entries.length !== (shape.ownerFile === null ? 0 : 1) ||
    entries.some(
      (entry) =>
        entry.name !== WRITER_GATE_OWNER_NAME || !entry.isFile() || entry.isSymbolicLink() || shape.ownerFile === null
    )
  ) {
    throw storageError();
  }
  if (shape.ownerFile !== null) {
    await unlinkCapturedFile(
      fs,
      resolveConfinedRecordPath(canonicalRoot, shape.directory.path, WRITER_GATE_OWNER_NAME),
      shape.ownerFile,
      platform,
      authorizeDestructiveStep
    );
  }
  await rmdirCaptured(fs, canonicalRoot, shape.directory, platform, authorizeDestructiveStep);
  authorizeDestructiveStep?.();
  await syncDurableDirectory(fs, canonicalRoot);
};

const removeCapturedCompleteTree = async (
  fs: RecordIoFileSystem,
  canonicalRoot: string,
  captured: CapturedGate,
  gatePath: string,
  platform: NodeJS.Platform,
  authorizeDestructiveStep?: () => void
): Promise<void> => {
  await assertCapturedGateAt(fs, canonicalRoot, captured, gatePath, platform);
  if (captured.recoveryClaim !== null) {
    const recoveryPath = resolveConfinedRecordPath(canonicalRoot, gatePath, WRITER_GATE_RECOVERY_NAME);
    const recovery: RecoveryShape = {
      kind: 'valid',
      claim: {
        ...captured.recoveryClaim,
        directory: { ...captured.recoveryClaim.directory, path: recoveryPath },
      },
    };
    await removeCapturedRecovery(fs, canonicalRoot, recovery, platform, authorizeDestructiveStep);
  }
  const readyPath = resolveConfinedRecordPath(canonicalRoot, gatePath, WRITER_GATE_READY_NAME);
  await rmdirCaptured(fs, canonicalRoot, { ...captured.ready, path: readyPath }, platform, authorizeDestructiveStep);
  await unlinkCapturedFile(
    fs,
    resolveConfinedRecordPath(canonicalRoot, gatePath, WRITER_GATE_OWNER_NAME),
    captured.ownerFile,
    platform,
    authorizeDestructiveStep
  );
  await rmdirCaptured(fs, canonicalRoot, { ...captured.directory, path: gatePath }, platform, authorizeDestructiveStep);
};

const serialize = async <Result>(
  queues: Map<string, Promise<void>>,
  key: string,
  operation: () => Promise<Result>
): Promise<Result> => {
  const previous = queues.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.catch((): undefined => undefined).then(() => current);
  queues.set(key, tail);
  await previous.catch((): undefined => undefined);
  try {
    return await operation();
  } finally {
    release();
    if (queues.get(key) === tail) queues.delete(key);
  }
};

const trackActiveWriter = (key: string): (() => void) => {
  let release!: () => void;
  const completion = new Promise<void>((resolve) => {
    release = resolve;
  });
  const active = PROCESS_ACTIVE_WRITERS.get(key) ?? new Set<Promise<void>>();
  active.add(completion);
  PROCESS_ACTIVE_WRITERS.set(key, active);
  return () => {
    release();
    active.delete(completion);
    if (active.size === 0 && PROCESS_ACTIVE_WRITERS.get(key) === active) PROCESS_ACTIVE_WRITERS.delete(key);
  };
};

/** A durable root-sibling writer lock; elapsed time and PID are deliberately absent from its authority. */
export const createStudioProjectWriterGateV4 = (
  options: StudioProjectWriterGateOptionsV4 = {}
): StudioProjectWriterGateV4 => {
  const fs = options.fs ?? nodeFs;
  const mainInstanceId = options.mainInstanceId ?? PROCESS_MAIN_INSTANCE_ID;
  const createOperationId = options.createOperationId ?? (() => randomBytes(16).toString('hex'));
  const platform = options.platform ?? process.platform;
  if (!SAFE_MAIN_INSTANCE_ID.test(mainInstanceId)) throw new TypeError('Invalid Studio Main instance id');

  const step = async (value: StudioProjectWriterGateStepV4, projectId: string): Promise<void> => {
    await options.onStep?.(value, projectId);
  };

  const requireRecoveryAuthority = (): void => {
    if (options.hasSingleInstanceRecoveryAuthority?.() !== true) {
      throw new StudioProjectWriterGateErrorV4('recovery_refused');
    }
  };

  const validateRequest = (
    canonicalRoot: string,
    projectId: string,
    intent: StudioProjectWriterIntentV4,
    operation: unknown
  ): void => {
    if (
      typeof canonicalRoot !== 'string' ||
      canonicalRoot.length === 0 ||
      !isStudioProjectIdV4(projectId) ||
      typeof operation !== 'function' ||
      (intent.purpose !== 'project_update' && intent.purpose !== 'proposal_terminal') ||
      (intent.purpose === 'proposal_terminal' &&
        (typeof intent.proposalId !== 'string' || !SAFE_PROPOSAL_ID.test(intent.proposalId)))
    ) {
      throw new StudioProjectWriterGateErrorV4('invalid_payload');
    }
  };

  const acquire = async (
    canonicalRoot: string,
    projectId: string,
    intent: StudioProjectWriterIntentV4
  ): Promise<CapturedGate> => {
    const root = await assertCanonicalRoot(fs, canonicalRoot);
    const operationId = createOperationId();
    if (typeof operationId !== 'string' || !SAFE_OPERATION_ID.test(operationId)) throw storageError();
    const owner: StudioProjectWriterOwnerV4 = Object.freeze({
      schemaVersion: WRITER_GATE_SCHEMA_VERSION,
      projectId,
      operationId,
      mainInstanceId,
      purpose: intent.purpose,
      proposalId: intent.purpose === 'proposal_terminal' ? intent.proposalId : null,
    });
    const ownerBytes = canonicalOwnerBytes(owner);
    const lockPath = resolveConfinedRecordPath(canonicalRoot, canonicalRoot, writerGateName(projectId));
    let directory: CapturedDirectory | null = null;
    let ownerFile: CapturedFile | null = null;
    let ready: CapturedDirectory | null = null;
    const rollback = async (): Promise<void> => {
      if (directory === null) return;
      try {
        await assertDirectoryIdentity(fs, canonicalRoot, directory, platform);
        const entries = await fs.readdir(lockPath, { withFileTypes: true });
        const expected = [
          ownerFile === null ? null : WRITER_GATE_OWNER_NAME,
          ready === null ? null : WRITER_GATE_READY_NAME,
        ]
          .filter((name): name is string => name !== null)
          .toSorted();
        if (
          entries
            .map((entry) => entry.name)
            .toSorted()
            .join('\0') !== expected.join('\0') ||
          entries.some((entry) => entry.isSymbolicLink())
        ) {
          return;
        }
        if (ready !== null) await rmdirCaptured(fs, canonicalRoot, ready, platform);
        if (ownerFile !== null) {
          await unlinkCapturedFile(
            fs,
            resolveConfinedRecordPath(canonicalRoot, lockPath, WRITER_GATE_OWNER_NAME),
            ownerFile,
            platform
          );
        }
        await rmdirCaptured(fs, canonicalRoot, directory, platform);
        if (sameIdentity(root, await assertCanonicalRoot(fs, canonicalRoot)))
          await syncDurableDirectory(fs, canonicalRoot);
      } catch {
        // Identity ambiguity is fail-closed. Startup recovery may remove only a safely recaptured incomplete gate.
      }
    };
    try {
      try {
        await fs.mkdir(lockPath, { mode: WRITER_GATE_DIRECTORY_MODE });
      } catch (error) {
        if (!hasCode(error, 'EEXIST')) throw storageError();
        const existing = await inspectLock(fs, canonicalRoot, projectId, platform, false);
        if (existing.kind === 'absent') throw storageError();
        throw new StudioProjectWriterGateErrorV4('busy');
      }
      directory = await captureDirectory(fs, canonicalRoot, lockPath, platform);
      if (!sameIdentity(root, await assertCanonicalRoot(fs, canonicalRoot))) throw storageError();
      ownerFile = await writeExclusiveDurableFile(
        fs,
        resolveConfinedRecordPath(canonicalRoot, lockPath, WRITER_GATE_OWNER_NAME),
        ownerBytes,
        platform
      );
      await syncDurableDirectory(fs, lockPath);
      await syncDurableDirectory(fs, canonicalRoot);
      await step('owner_durable', projectId);
      const readyPath = resolveConfinedRecordPath(canonicalRoot, lockPath, WRITER_GATE_READY_NAME);
      await fs.mkdir(readyPath, { mode: WRITER_GATE_DIRECTORY_MODE });
      ready = await captureDirectory(fs, canonicalRoot, readyPath, platform);
      if ((await fs.readdir(readyPath)).length !== 0) throw storageError();
      await step('gate_published', projectId);
      await syncDurableDirectory(fs, readyPath);
      await syncDurableDirectory(fs, lockPath);
      await syncDurableDirectory(fs, canonicalRoot);
      await step('root_durable', projectId);
      const shape = await inspectLock(fs, canonicalRoot, projectId, platform);
      if (shape.kind !== 'complete' || shape.recoveryShape.kind !== 'none') throw storageError();
      if (
        !sameIdentity(shape.gate.directory.identity, directory.identity) ||
        !sameIdentity(shape.gate.ownerFile.identity, ownerFile.identity) ||
        !sameIdentity(shape.gate.ready.identity, ready.identity)
      ) {
        throw storageError();
      }
      return shape.gate;
    } catch (error) {
      await rollback();
      if (error instanceof StudioProjectWriterGateErrorV4) throw error;
      throw storageError();
    }
  };

  const removeStaleRecovery = async (
    canonicalRoot: string,
    gate: CapturedGate,
    recoveryShape: Exclude<RecoveryShape, { kind: 'none' }>
  ): Promise<CapturedGate> => {
    requireRecoveryAuthority();
    await assertDirectoryIdentity(fs, canonicalRoot, gate.directory, platform);
    await assertFileIdentity(
      fs,
      resolveConfinedRecordPath(canonicalRoot, gate.directory.path, WRITER_GATE_OWNER_NAME),
      gate.ownerFile,
      platform
    );
    await assertDirectoryIdentity(fs, canonicalRoot, gate.ready, platform);
    await removeCapturedRecovery(fs, canonicalRoot, recoveryShape, platform, requireRecoveryAuthority);
    requireRecoveryAuthority();
    await syncDurableDirectory(fs, gate.directory.path);
    requireRecoveryAuthority();
    await syncDurableDirectory(fs, canonicalRoot);
    const refreshed = await inspectLock(fs, canonicalRoot, gate.owner.projectId, platform);
    if (refreshed.kind !== 'complete' || refreshed.recoveryShape.kind !== 'none') throw storageError();
    return refreshed.gate;
  };

  const claimRecovery = async (
    canonicalRoot: string,
    gateInput: CapturedGate,
    recoveryInput: RecoveryShape
  ): Promise<CapturedGate> => {
    let gate = gateInput;
    if (recoveryInput.kind === 'valid' && recoveryInput.claim.record.mainInstanceId === mainInstanceId) {
      throw new StudioProjectWriterGateErrorV4('recovery_refused');
    }
    if (recoveryInput.kind !== 'none') gate = await removeStaleRecovery(canonicalRoot, gate, recoveryInput);
    requireRecoveryAuthority();
    const recoveryOperationId = createOperationId();
    if (typeof recoveryOperationId !== 'string' || !SAFE_OPERATION_ID.test(recoveryOperationId)) throw storageError();
    const record: StudioProjectWriterRecoveryClaimV4 = Object.freeze({
      schemaVersion: WRITER_GATE_SCHEMA_VERSION,
      projectId: gate.owner.projectId,
      ownerOperationId: gate.owner.operationId,
      recoveryOperationId,
      mainInstanceId,
      purpose: gate.owner.purpose,
      proposalId: gate.owner.proposalId,
    });
    const recoveryPath = resolveConfinedRecordPath(canonicalRoot, gate.directory.path, WRITER_GATE_RECOVERY_NAME);
    let directory: CapturedDirectory | null = null;
    let claimFile: CapturedFile | null = null;
    try {
      requireRecoveryAuthority();
      try {
        await fs.mkdir(recoveryPath, { mode: WRITER_GATE_DIRECTORY_MODE });
      } catch (error) {
        if (hasCode(error, 'EEXIST')) throw new StudioProjectWriterGateErrorV4('recovery_refused');
        throw storageError();
      }
      directory = await captureDirectory(fs, canonicalRoot, recoveryPath, platform);
      claimFile = await writeExclusiveDurableFile(
        fs,
        resolveConfinedRecordPath(canonicalRoot, recoveryPath, WRITER_GATE_RECOVERY_CLAIM_NAME),
        JSON.stringify(record),
        platform
      );
      requireRecoveryAuthority();
      await syncDurableDirectory(fs, recoveryPath);
      requireRecoveryAuthority();
      await syncDurableDirectory(fs, gate.directory.path);
      requireRecoveryAuthority();
      await syncDurableDirectory(fs, canonicalRoot);
      await step('recovery_claim_durable', gate.owner.projectId);
      const shape = await inspectLock(fs, canonicalRoot, gate.owner.projectId, platform);
      if (
        shape.kind !== 'complete' ||
        shape.recoveryShape.kind !== 'valid' ||
        shape.recoveryShape.claim.record.recoveryOperationId !== recoveryOperationId ||
        shape.recoveryShape.claim.record.mainInstanceId !== mainInstanceId ||
        !sameIdentity(shape.recoveryShape.claim.directory.identity, directory.identity) ||
        !sameIdentity(shape.recoveryShape.claim.claimFile.identity, claimFile.identity)
      ) {
        throw storageError();
      }
      return shape.gate;
    } catch (error) {
      if (directory !== null) {
        try {
          await removeCapturedRecovery(
            fs,
            canonicalRoot,
            { kind: 'incomplete', directory, claimFile },
            platform,
            requireRecoveryAuthority
          );
          requireRecoveryAuthority();
          await syncDurableDirectory(fs, gate.directory.path);
          requireRecoveryAuthority();
          await syncDurableDirectory(fs, canonicalRoot);
        } catch {
          // An ambiguous claim remains exclusive and must be classified by startup authority.
        }
      }
      if (error instanceof StudioProjectWriterGateErrorV4) throw error;
      throw storageError();
    }
  };

  const retire = async (
    canonicalRoot: string,
    captured: CapturedGate,
    authorizeDestructiveStep?: () => void
  ): Promise<void> => {
    authorizeDestructiveStep?.();
    await assertCapturedGate(fs, canonicalRoot, captured, platform);
    const retiredPath = resolveConfinedRecordPath(
      canonicalRoot,
      canonicalRoot,
      retiredGateName(captured.owner.operationId)
    );
    try {
      await lstatBig(fs, retiredPath);
      throw storageError();
    } catch (error) {
      if (error instanceof StudioProjectWriterGateErrorV4) throw error;
      if (!hasCode(error, 'ENOENT')) throw storageError();
    }
    authorizeDestructiveStep?.();
    try {
      await fs.rename(captured.directory.path, retiredPath);
    } catch {
      throw storageError();
    }
    await assertCapturedGateAt(fs, canonicalRoot, captured, retiredPath, platform);
    await step('retired', captured.owner.projectId);
    authorizeDestructiveStep?.();
    await syncDurableDirectory(fs, canonicalRoot);
    await step('retirement_durable', captured.owner.projectId);
    authorizeDestructiveStep?.();
    await removeCapturedCompleteTree(fs, canonicalRoot, captured, retiredPath, platform, authorizeDestructiveStep);
    authorizeDestructiveStep?.();
    await syncDurableDirectory(fs, canonicalRoot);
    await step('retired_residue_removed', captured.owner.projectId);
  };

  const run = async <Result>(input: {
    canonicalRoot: string;
    projectId: string;
    intent: StudioProjectWriterIntentV4;
    recover: boolean;
    operation: (lease: StudioProjectWriterLeaseV4) => Promise<Result>;
  }): Promise<Result> => {
    validateRequest(input.canonicalRoot, input.projectId, input.intent, input.operation);
    const execute = async (): Promise<Result> => {
      const activeWriterKey = `${path.resolve(input.canonicalRoot)}\0${input.projectId}`;
      const releaseActiveWriter = trackActiveWriter(activeWriterKey);
      try {
        let captured: CapturedGate;
        if (input.recover) {
          requireRecoveryAuthority();
          const shape = await inspectLock(fs, input.canonicalRoot, input.projectId, platform);
          if (shape.kind === 'absent' || shape.kind === 'incomplete') {
            throw new StudioProjectWriterGateErrorV4('recovery_refused');
          }
          const activeLocalWriters = PROCESS_ACTIVE_WRITERS.get(activeWriterKey)?.size ?? 0;
          const ownCompletedWriter = shape.gate.owner.mainInstanceId === mainInstanceId && activeLocalWriters === 1;
          if (
            (shape.gate.owner.mainInstanceId === mainInstanceId && !ownCompletedWriter) ||
            shape.gate.owner.purpose !== input.intent.purpose ||
            (input.intent.purpose === 'proposal_terminal' && shape.gate.owner.proposalId !== input.intent.proposalId)
          ) {
            throw new StudioProjectWriterGateErrorV4('recovery_refused');
          }
          await step('recovery_owner_captured', input.projectId);
          captured = await claimRecovery(input.canonicalRoot, shape.gate, shape.recoveryShape);
          requireRecoveryAuthority();
          await assertCapturedGate(fs, input.canonicalRoot, captured, platform);
        } else {
          captured = await serialize(PROCESS_PUBLICATION_QUEUES, activeWriterKey, () =>
            acquire(input.canonicalRoot, input.projectId, input.intent)
          );
        }
        let retain = input.recover;
        let succeeded = false;
        const lease: StudioProjectWriterLeaseV4 = Object.freeze({
          owner: captured.owner,
          recovered: input.recover,
          retainForRecovery: () => {
            retain = true;
          },
          clearRecoveryRetention: () => {
            retain = false;
          },
          assertOwned: async () => {
            if (input.recover) requireRecoveryAuthority();
            await assertCapturedGate(fs, input.canonicalRoot, captured, platform);
          },
        });
        try {
          const result = await input.operation(lease);
          succeeded = true;
          return result;
        } finally {
          if (succeeded || !retain) {
            await retire(input.canonicalRoot, captured, input.recover ? requireRecoveryAuthority : undefined);
          }
        }
      } finally {
        releaseActiveWriter();
      }
    };
    if (!input.recover) return execute();
    return serialize(PROCESS_RECOVERY_QUEUES, path.resolve(input.canonicalRoot), execute);
  };

  return {
    withWriter: (canonicalRoot, projectId, intent, operation) =>
      run({ canonicalRoot, projectId, intent, recover: false, operation }),
    recoverWriter: (canonicalRoot, projectId, intent, operation) =>
      run({ canonicalRoot, projectId, intent, recover: true, operation }),
    readIntent: async (canonicalRoot, projectId) => {
      if (typeof canonicalRoot !== 'string' || canonicalRoot.length === 0 || !isStudioProjectIdV4(projectId)) {
        throw new StudioProjectWriterGateErrorV4('invalid_payload');
      }
      const shape = await inspectLock(fs, canonicalRoot, projectId, platform, false);
      if (shape.kind === 'absent') return null;
      if (shape.kind === 'incomplete') throw new StudioProjectWriterGateErrorV4('busy');
      return ownerIntent(shape.gate.owner);
    },
    waitForLocalWriter: async (canonicalRoot, projectId) => {
      if (typeof canonicalRoot !== 'string' || canonicalRoot.length === 0 || !isStudioProjectIdV4(projectId)) {
        throw new StudioProjectWriterGateErrorV4('invalid_payload');
      }
      const active = PROCESS_ACTIVE_WRITERS.get(`${path.resolve(canonicalRoot)}\0${projectId}`);
      if (active === undefined || active.size === 0) return false;
      await Promise.all(active);
      return true;
    },
    assertUnlocked: async (canonicalRoot, projectId) => {
      if (typeof canonicalRoot !== 'string' || canonicalRoot.length === 0 || !isStudioProjectIdV4(projectId)) {
        throw new StudioProjectWriterGateErrorV4('invalid_payload');
      }
      const shape = await inspectLock(fs, canonicalRoot, projectId, platform, false);
      if (shape.kind !== 'absent') throw new StudioProjectWriterGateErrorV4('busy');
    },
    listRecoveryCandidates: async (canonicalRoot) => {
      if (typeof canonicalRoot !== 'string' || canonicalRoot.length === 0) {
        throw new StudioProjectWriterGateErrorV4('invalid_payload');
      }
      requireRecoveryAuthority();
      return serialize(PROCESS_RECOVERY_QUEUES, path.resolve(canonicalRoot), async () => {
        requireRecoveryAuthority();
        await assertCanonicalRoot(fs, canonicalRoot);
        const entries = await fs.readdir(canonicalRoot, { withFileTypes: true });
        const relevantNames = entries
          .filter(
            (entry) =>
              (entry.name.startsWith(WRITER_GATE_PREFIX) && entry.name.endsWith(WRITER_GATE_SUFFIX)) ||
              entry.name.startsWith(WRITER_GATE_RETIRED_PREFIX)
          )
          .map((entry) => entry.name)
          .toSorted();
        if (relevantNames.length > WRITER_GATE_RECOVERY_CANDIDATE_LIMIT) throw storageError();

        for (const name of relevantNames.filter(
          (entry) => entry.startsWith(WRITER_GATE_RETIRED_PREFIX) && !entry.endsWith(WRITER_GATE_SUFFIX)
        )) {
          if (!SAFE_RETIRED_NAME.test(name)) throw storageError();
          requireRecoveryAuthority();
          const retiredPath = resolveConfinedRecordPath(canonicalRoot, canonicalRoot, name);
          const directory = await captureDirectory(fs, canonicalRoot, retiredPath, platform);
          const retiredEntries = await fs.readdir(retiredPath, { withFileTypes: true });
          const ownerEntry = retiredEntries.find((entry) => entry.name === WRITER_GATE_OWNER_NAME);
          const readyEntry = retiredEntries.find((entry) => entry.name === WRITER_GATE_READY_NAME);
          const recoveryEntry = retiredEntries.find((entry) => entry.name === WRITER_GATE_RECOVERY_NAME);
          if (
            retiredEntries.length < 2 ||
            retiredEntries.length > 3 ||
            ownerEntry === undefined ||
            readyEntry === undefined ||
            !ownerEntry.isFile() ||
            ownerEntry.isSymbolicLink() ||
            !readyEntry.isDirectory() ||
            readyEntry.isSymbolicLink() ||
            (recoveryEntry !== undefined && (!recoveryEntry.isDirectory() || recoveryEntry.isSymbolicLink())) ||
            retiredEntries.some(
              (entry) =>
                entry.name !== WRITER_GATE_OWNER_NAME &&
                entry.name !== WRITER_GATE_READY_NAME &&
                entry.name !== WRITER_GATE_RECOVERY_NAME
            )
          ) {
            throw storageError();
          }
          const ownerFile = await captureBoundedFile(
            fs,
            resolveConfinedRecordPath(canonicalRoot, retiredPath, WRITER_GATE_OWNER_NAME),
            platform
          );
          const owner = parseOwner(ownerFile.bytes);
          if (owner === null || retiredGateName(owner.operationId) !== name) throw storageError();
          const ready = await captureDirectory(
            fs,
            canonicalRoot,
            resolveConfinedRecordPath(canonicalRoot, retiredPath, WRITER_GATE_READY_NAME),
            platform
          );
          if ((await fs.readdir(ready.path)).length !== 0) throw storageError();
          const recoveryShape = await captureRecoveryShape(fs, canonicalRoot, directory, owner, platform);
          if (recoveryShape.kind === 'incomplete') throw storageError();
          const captured: CapturedGate = {
            root: await assertCanonicalRoot(fs, canonicalRoot),
            directory,
            ownerFile,
            owner,
            ready,
            recoveryClaim: recoveryShape.kind === 'valid' ? recoveryShape.claim : null,
          };
          await removeCapturedCompleteTree(
            fs,
            canonicalRoot,
            captured,
            retiredPath,
            platform,
            requireRecoveryAuthority
          );
          requireRecoveryAuthority();
          await syncDurableDirectory(fs, canonicalRoot);
          await step('retired_residue_removed', owner.projectId);
        }

        const owners: StudioProjectWriterOwnerV4[] = [];
        for (const name of relevantNames.filter((entry) => entry.endsWith(WRITER_GATE_SUFFIX))) {
          const projectId = name.slice(WRITER_GATE_PREFIX.length, -WRITER_GATE_SUFFIX.length);
          if (!isStudioProjectIdV4(projectId) || writerGateName(projectId) !== name) throw storageError();
          const shape = await inspectLock(fs, canonicalRoot, projectId, platform);
          if (shape.kind === 'absent') continue;
          if (shape.kind === 'incomplete') {
            requireRecoveryAuthority();
            await removeIncompleteLock(fs, canonicalRoot, shape, platform, requireRecoveryAuthority);
            continue;
          }
          if (shape.gate.owner.mainInstanceId === mainInstanceId) {
            throw new StudioProjectWriterGateErrorV4('recovery_refused');
          }
          let gate = shape.gate;
          if (
            shape.recoveryShape.kind === 'valid' &&
            shape.recoveryShape.claim.record.mainInstanceId === mainInstanceId
          ) {
            throw new StudioProjectWriterGateErrorV4('recovery_refused');
          }
          if (shape.recoveryShape.kind !== 'none') {
            gate = await removeStaleRecovery(canonicalRoot, gate, shape.recoveryShape);
          }
          owners.push(Object.freeze({ ...gate.owner }));
        }
        return owners;
      });
    },
  };
};
