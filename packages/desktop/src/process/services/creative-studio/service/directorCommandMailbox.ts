/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomUUID } from 'node:crypto';
import { promises as nodeFs, type Dir, type Dirent } from 'node:fs';
import { watch as watchFileSystem } from 'node:fs';
import path from 'node:path';
import {
  STUDIO_DIRECTOR_COMMAND_MAX_RECORD_BYTES,
  STUDIO_DIRECTOR_COMMAND_MAX_SWEEP_RECORDS,
  STUDIO_DIRECTOR_COMMAND_SCHEMA_VERSION,
  STUDIO_DIRECTOR_COMMAND_SLOT_LEASE_MS,
  STUDIO_DIRECTOR_COMMAND_WAIT_MS,
  type StudioDirectorCommandReceiptV1,
  type StudioDirectorCommandSlotLeaseV1,
  type StudioDirectorCommandSlotV1,
} from '@/common/types/project/creativeStudioTypes';
import {
  parseStudioDirectorCommandReceipt,
  parseStudioDirectorCommandSlotLease,
  parseStudioDirectorCommandSlot,
  parseStudioDirectorPendingRecord,
  isSafeStudioDirectorId,
  type StudioDirectorCommandParseResult,
} from './directorCommandContracts';
import {
  canonicalizeRecordRoot,
  publishExclusiveLeaseRecord,
  publishImmutableRecord,
  readBoundedRegularFile,
  readBoundedRegularFileWithIdentity,
  RecordIoError,
  removeRegularRecordIfIdentity,
  removeRegularRecordIfPresent,
  resolveCompleteDirectorySet,
  resolveConfinedRecordPath,
  type RecordIoFileSystem,
} from './recordIo';
import { CreativeStudioStoreError, type CreativeStudioStore } from '@process/services/creative-studio/store';

export type StudioDirectorPendingRead = StudioDirectorCommandParseResult;

export type StudioDirectorCommandRef = { projectId: string; commandId: string };

export type StudioDirectorCommandPage = {
  items: StudioDirectorCommandRef[];
  nextCursor: string | null;
};

export type StudioDirectorMaintenancePage = {
  processed: number;
  nextCursor: string | null;
};

export type StudioDirectorCommandMailbox = {
  ensure(projectId: string): Promise<void>;
  snapshotPendingPage(cursor: string | null, limit: number): Promise<StudioDirectorCommandPage>;
  readPending(projectId: string, commandId: string): Promise<StudioDirectorPendingRead | null>;
  readReceipt(projectId: string, commandId: string): Promise<StudioDirectorCommandReceiptV1 | null>;
  writeReceipt(projectId: string, receipt: StudioDirectorCommandReceiptV1): Promise<void>;
  finish(projectId: string, commandId: string): Promise<void>;
  listPendingPage(cursor: string | null, limit: number): Promise<StudioDirectorCommandPage>;
  releaseOrphanedSlotsPage(cursor: string | null, now: string, limit: number): Promise<StudioDirectorMaintenancePage>;
  pruneReceiptsPage(
    cursor: string | null,
    decidedBefore: string,
    limit: number
  ): Promise<StudioDirectorMaintenancePage>;
  watch(trigger: (projectId: string, commandId?: string) => void): Promise<() => void>;
  dispose(): Promise<void>;
};

type CommandDirectories = {
  root: string;
  pending: string;
  slots: string;
  receipts: string;
};

type LedgerDirectory = 'pending' | 'receipts';

type CursorMethod = 'snapshotPendingPage' | 'listPendingPage' | 'releaseOrphanedSlotsPage' | 'pruneReceiptsPage';

type LedgerTraversal = {
  directory: Dir;
  projectId: string;
};

type CursorSession = {
  method: CursorMethod;
  token: string;
  root: Dir;
  ledger: LedgerTraversal | null;
  closed: boolean;
};

type SlotRead =
  | { status: 'absent' }
  | {
      status: 'valid';
      slot: StudioDirectorCommandSlotV1;
      bytes: string;
      identity: { dev: number; ino: number };
    }
  | { status: 'invalid'; commandId: string | null; bytes: string; identity: { dev: number; ino: number } };

type LeaseRead =
  | { status: 'absent' }
  | { status: 'invalid' }
  | {
      status: 'valid';
      lease: StudioDirectorCommandSlotLeaseV1;
      bytes: string;
      identity: { dev: number; ino: number };
    };

type WatchCommandTree = (input: {
  rootDir: string;
  onChange(relativeFile: string): void;
  onError(error: Error): void;
}) => { close(): void };

export type StudioDirectorCommandMailboxDeps = {
  rootDir: string;
  store: Pick<CreativeStudioStore, 'getVerifiedProjectDirectory'>;
  now?: () => string;
  createId?: () => string;
  waitMs?: number;
  fs?: RecordIoFileSystem;
  logError?: (message: string, error: unknown) => void;
  watchCommandTree?: WatchCommandTree;
};

const COMMAND_CHILDREN = ['pending', 'slots', 'receipts'] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isErrorCode = (error: unknown, code: string): boolean =>
  typeof error === 'object' && error !== null && Reflect.get(error, 'code') === code;

const storageError = (): CreativeStudioStoreError =>
  new CreativeStudioStoreError('storage_error', 'Creative Studio command storage is unavailable');

const invalidPayload = (): CreativeStudioStoreError =>
  new CreativeStudioStoreError('invalid_payload', 'Invalid Studio Director command payload');

const neutralizeIo = (error: unknown): CreativeStudioStoreError => {
  if (error instanceof CreativeStudioStoreError) return error;
  return storageError();
};

const canonicalTimestamp = (value: string): number | null => {
  if (value.length !== 24) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value ? parsed : null;
};

/** Creates the main-process mailbox without publishing or consuming a command. */
export const createStudioDirectorCommandMailbox = (
  deps: StudioDirectorCommandMailboxDeps
): StudioDirectorCommandMailbox => {
  const fs = deps.fs ?? nodeFs;
  const now = deps.now ?? (() => new Date().toISOString());
  const createId = deps.createId ?? randomUUID;
  const waitMs = deps.waitMs ?? STUDIO_DIRECTOR_COMMAND_WAIT_MS;
  const logError = deps.logError ?? (() => undefined);
  const canonicalRootPromise = canonicalizeRecordRoot({ fs, rootDir: deps.rootDir });
  const watchCommandTree: WatchCommandTree =
    deps.watchCommandTree ??
    ((input) => {
      const watcher = watchFileSystem(input.rootDir, { recursive: true, encoding: 'utf8' }, (_eventType, fileName) => {
        if (fileName !== null) input.onChange(fileName);
      });
      watcher.on('error', input.onError);
      return { close: () => watcher.close() };
    });

  const safeLog = (message: string): void => {
    try {
      logError(message, new Error('StudioDirectorCommandStorageError'));
    } catch {
      // Maintenance diagnostics never change record authority.
    }
  };

  const requireIdentity = (projectId: string, commandId?: string): void => {
    if (!isSafeStudioDirectorId(projectId) || (commandId !== undefined && !isSafeStudioDirectorId(commandId))) {
      throw invalidPayload();
    }
  };

  const requireLimit = (limit: number): void => {
    if (!Number.isInteger(limit) || limit < 1 || limit > STUDIO_DIRECTOR_COMMAND_MAX_SWEEP_RECORDS) {
      throw invalidPayload();
    }
  };

  const directoriesFor = async (
    projectId: string,
    createIfWhollyAbsent: boolean
  ): Promise<CommandDirectories | null> => {
    requireIdentity(projectId);
    try {
      const [canonicalRoot, projectDirectory] = await Promise.all([
        canonicalRootPromise,
        deps.store.getVerifiedProjectDirectory(projectId),
      ]);
      if (projectDirectory === null) {
        throw new CreativeStudioStoreError('not_found', 'Studio project not found');
      }
      resolveConfinedRecordPath(canonicalRoot, canonicalRoot, path.relative(canonicalRoot, projectDirectory));
      return await resolveCompleteDirectorySet({
        fs,
        canonicalRoot,
        parent: projectDirectory,
        rootName: 'commands',
        childNames: COMMAND_CHILDREN,
        createIfWhollyAbsent,
      });
    } catch (error) {
      throw neutralizeIo(error);
    }
  };

  const readBytes = async (canonicalRoot: string, file: string): Promise<string | null> => {
    try {
      return await readBoundedRegularFile({
        fs,
        canonicalRoot,
        file,
        maxBytes: STUDIO_DIRECTOR_COMMAND_MAX_RECORD_BYTES,
      });
    } catch {
      throw storageError();
    }
  };

  const readIdentifiedBytes = async (
    canonicalRoot: string,
    file: string
  ): Promise<{ bytes: string; identity: { dev: number; ino: number } } | null> => {
    try {
      return await readBoundedRegularFileWithIdentity({
        fs,
        canonicalRoot,
        file,
        maxBytes: STUDIO_DIRECTOR_COMMAND_MAX_RECORD_BYTES,
      });
    } catch {
      throw storageError();
    }
  };

  const parseJson = (bytes: string): unknown => {
    try {
      return JSON.parse(bytes) as unknown;
    } catch {
      return null;
    }
  };

  const sessions = new Map<CursorMethod, CursorSession>();
  const cursorOperations = new Map<CursorMethod, Promise<void>>();
  const slotCleanupOperations = new Map<string, Promise<void>>();
  let disposed = false;

  const runCursorMethod = <Result>(method: CursorMethod, operation: () => Promise<Result>): Promise<Result> => {
    const previous = cursorOperations.get(method) ?? Promise.resolve();
    const result = previous.then(operation, operation);
    const tail = result.then(
      (): void => undefined,
      (): void => undefined
    );
    cursorOperations.set(method, tail);
    return result.finally(() => {
      if (cursorOperations.get(method) === tail) cursorOperations.delete(method);
    });
  };

  const runSlotCleanup = <Result>(projectId: string, operation: () => Promise<Result>): Promise<Result> => {
    const previous = slotCleanupOperations.get(projectId) ?? Promise.resolve();
    const result = previous.then(operation, operation);
    const tail = result.then(
      (): void => undefined,
      (): void => undefined
    );
    slotCleanupOperations.set(projectId, tail);
    return result.finally(() => {
      if (slotCleanupOperations.get(projectId) === tail) slotCleanupOperations.delete(projectId);
    });
  };

  const closeSession = async (session: CursorSession): Promise<void> => {
    if (session.closed) return;
    session.closed = true;
    if (sessions.get(session.method) === session) sessions.delete(session.method);
    const handles = session.ledger === null ? [session.root] : [session.ledger.directory, session.root];
    session.ledger = null;
    let failed = false;
    for (const handle of handles) {
      try {
        // Every opened handle is attempted even when an earlier close fails.
        // eslint-disable-next-line no-await-in-loop
        await handle.close();
      } catch {
        failed = true;
      }
    }
    if (failed) throw storageError();
  };

  const closeSessionAfterFailure = async (session: CursorSession): Promise<void> => {
    try {
      await closeSession(session);
    } catch {
      // Preserve the original error while still attempting every close.
    }
  };

  const closeLedger = async (session: CursorSession): Promise<void> => {
    const ledger = session.ledger;
    if (ledger === null) return;
    session.ledger = null;
    try {
      await ledger.directory.close();
    } catch {
      throw storageError();
    }
  };

  const openSession = async (method: CursorMethod): Promise<CursorSession> => {
    const token = `v2.${randomUUID()}`;
    let root: Dir;
    try {
      root = await fs.opendir(await canonicalRootPromise, { bufferSize: 1 });
    } catch {
      throw storageError();
    }
    const session: CursorSession = {
      method,
      token,
      root,
      ledger: null,
      closed: false,
    };
    sessions.set(method, session);
    return session;
  };

  const sessionFor = async (method: CursorMethod, cursor: string | null): Promise<CursorSession> => {
    if (disposed) throw invalidPayload();
    const current = sessions.get(method);
    if (cursor !== null) {
      if (typeof cursor !== 'string' || cursor.length > 256 || current?.token !== cursor || current.closed) {
        throw invalidPayload();
      }
      return current;
    }
    if (current !== undefined) await closeSession(current);
    return openSession(method);
  };

  const scanLedgerPage = async (input: {
    method: 'snapshotPendingPage' | 'listPendingPage' | 'pruneReceiptsPage';
    cursor: string | null;
    limit: number;
    directory: LedgerDirectory;
    tolerateProjectErrors: boolean;
    createIfWhollyAbsent: boolean;
  }): Promise<StudioDirectorCommandPage> => {
    return runCursorMethod(input.method, async () => {
      requireLimit(input.limit);
      let session: CursorSession | undefined;
      try {
        session = await sessionFor(input.method, input.cursor);
        const items: StudioDirectorCommandRef[] = [];
        let work = 0;
        while (work < input.limit) {
          if (session.ledger !== null) {
            const ledger = session.ledger;
            work += 1;
            let entry: Dirent | null;
            try {
              // eslint-disable-next-line no-await-in-loop
              entry = await ledger.directory.read();
            } catch (error) {
              if (!input.tolerateProjectErrors) throw error;
              // eslint-disable-next-line no-await-in-loop
              await closeLedger(session);
              safeLog('[CreativeStudio] Director command receipt maintenance skipped unsafe storage');
              continue;
            }
            if (entry === null) {
              // eslint-disable-next-line no-await-in-loop
              await closeLedger(session);
              continue;
            }
            if (!entry.name.endsWith('.json')) continue;
            const commandId = entry.name.slice(0, -'.json'.length);
            if (!isSafeStudioDirectorId(commandId)) continue;
            items.push({ projectId: ledger.projectId, commandId });
            continue;
          }

          work += 1;
          // eslint-disable-next-line no-await-in-loop
          const projectEntry = await session.root.read();
          if (projectEntry === null) {
            // eslint-disable-next-line no-await-in-loop
            await closeSession(session);
            return { items, nextCursor: null };
          }
          if (!projectEntry.isDirectory() || !isSafeStudioDirectorId(projectEntry.name)) continue;

          let directories: CommandDirectories | null;
          try {
            // eslint-disable-next-line no-await-in-loop
            directories = await directoriesFor(projectEntry.name, input.createIfWhollyAbsent);
          } catch (error) {
            if (!input.tolerateProjectErrors) throw error;
            safeLog('[CreativeStudio] Director command receipt maintenance skipped unsafe storage');
            continue;
          }
          if (directories === null) continue;
          try {
            // A buffer of one keeps native directory materialization bounded with the raw-read budget.
            // eslint-disable-next-line no-await-in-loop
            const directory = await fs.opendir(directories[input.directory], { bufferSize: 1 });
            session.ledger = { directory, projectId: projectEntry.name };
          } catch (error) {
            if (!input.tolerateProjectErrors) throw error;
            safeLog('[CreativeStudio] Director command receipt maintenance skipped unsafe storage');
          }
        }
        return { items, nextCursor: session.token };
      } catch (error) {
        if (session !== undefined) await closeSessionAfterFailure(session);
        if (error instanceof CreativeStudioStoreError) throw error;
        throw storageError();
      }
    });
  };

  const exactReceiptFrom = async (
    canonicalRoot: string,
    directories: CommandDirectories,
    projectId: string,
    commandId: string
  ): Promise<StudioDirectorCommandReceiptV1 | null> => {
    const bytes = await readBytes(canonicalRoot, path.join(directories.receipts, `${commandId}.json`));
    if (bytes === null) return null;
    const receipt = parseStudioDirectorCommandReceipt({ projectId, commandId, value: parseJson(bytes) });
    if (receipt === null) throw storageError();
    return receipt;
  };

  const pathExists = async (file: string): Promise<boolean> => {
    try {
      await fs.lstat(file);
      return true;
    } catch (error) {
      if (isErrorCode(error, 'ENOENT')) return false;
      throw storageError();
    }
  };

  const scanProjectPage = async (input: {
    cursor: string | null;
    limit: number;
    visit(projectId: string): Promise<void>;
  }): Promise<StudioDirectorMaintenancePage> => {
    return runCursorMethod('releaseOrphanedSlotsPage', async () => {
      requireLimit(input.limit);
      let session: CursorSession | undefined;
      try {
        session = await sessionFor('releaseOrphanedSlotsPage', input.cursor);
        let processed = 0;
        let work = 0;
        while (work < input.limit) {
          work += 1;
          // eslint-disable-next-line no-await-in-loop
          const projectEntry = await session.root.read();
          if (projectEntry === null) {
            // eslint-disable-next-line no-await-in-loop
            await closeSession(session);
            return { processed, nextCursor: null };
          }
          if (!projectEntry.isDirectory() || !isSafeStudioDirectorId(projectEntry.name)) continue;
          processed += 1;
          try {
            // A failing project advances the live root cursor without weakening another project.
            // eslint-disable-next-line no-await-in-loop
            await input.visit(projectEntry.name);
          } catch {
            safeLog('[CreativeStudio] Director command slot maintenance skipped unsafe storage');
          }
        }
        return { processed, nextCursor: session.token };
      } catch (error) {
        if (session !== undefined) await closeSessionAfterFailure(session);
        if (error instanceof CreativeStudioStoreError) throw error;
        throw storageError();
      }
    });
  };

  const readSlot = async (
    canonicalRoot: string,
    directories: CommandDirectories,
    currentTime: string
  ): Promise<SlotRead> => {
    const record = await readIdentifiedBytes(canonicalRoot, path.join(directories.slots, '0.slot'));
    if (record === null) return { status: 'absent' };
    const value = parseJson(record.bytes);
    const slot = parseStudioDirectorCommandSlot(value, currentTime, waitMs);
    if (slot !== null) return { status: 'valid', slot, bytes: record.bytes, identity: record.identity };
    return {
      status: 'invalid',
      commandId: isRecord(value) && isSafeStudioDirectorId(value.commandId) ? value.commandId : null,
      bytes: record.bytes,
      identity: record.identity,
    };
  };

  const readLease = async (
    canonicalRoot: string,
    directories: CommandDirectories,
    currentTime: string
  ): Promise<LeaseRead> => {
    const record = await readIdentifiedBytes(canonicalRoot, path.join(directories.slots, '0.slot.lease'));
    if (record === null) return { status: 'absent' };
    const lease = parseStudioDirectorCommandSlotLease(parseJson(record.bytes), currentTime, waitMs);
    return lease === null
      ? { status: 'invalid' }
      : { status: 'valid', lease, bytes: record.bytes, identity: record.identity };
  };

  const sameLease = (left: StudioDirectorCommandSlotLeaseV1, right: StudioDirectorCommandSlotLeaseV1): boolean =>
    left.schemaVersion === right.schemaVersion &&
    left.leaseId === right.leaseId &&
    left.owner === right.owner &&
    left.commandId === right.commandId &&
    left.reservedAt === right.reservedAt &&
    left.deadlineAt === right.deadlineAt &&
    left.acquiredAt === right.acquiredAt &&
    left.expiresAt === right.expiresAt;

  const sameIdentity = (left: { dev: number; ino: number }, right: { dev: number; ino: number }): boolean =>
    left.dev === right.dev && left.ino === right.ino;

  const sameSlotRead = (left: SlotRead, right: SlotRead): boolean => {
    if (left.status === 'absent' || right.status === 'absent') return left.status === right.status;
    return (
      left.status === right.status &&
      left.bytes === right.bytes &&
      sameIdentity(left.identity, right.identity) &&
      (left.status !== 'invalid' || right.status !== 'invalid' || left.commandId === right.commandId)
    );
  };

  const buildMainLease = (slot: SlotRead, currentTime: string): StudioDirectorCommandSlotLeaseV1 => {
    const acquiredAtMs = canonicalTimestamp(currentTime);
    const leaseId = createId();
    if (acquiredAtMs === null || !isSafeStudioDirectorId(leaseId)) throw storageError();
    const lease: StudioDirectorCommandSlotLeaseV1 = {
      schemaVersion: STUDIO_DIRECTOR_COMMAND_SCHEMA_VERSION,
      leaseId,
      owner: 'main',
      commandId: slot.status === 'valid' ? slot.slot.commandId : null,
      reservedAt: slot.status === 'valid' ? slot.slot.reservedAt : null,
      deadlineAt: slot.status === 'valid' ? slot.slot.deadlineAt : null,
      acquiredAt: currentTime,
      expiresAt: new Date(acquiredAtMs + STUDIO_DIRECTOR_COMMAND_SLOT_LEASE_MS).toISOString(),
    };
    if (parseStudioDirectorCommandSlotLease(lease, currentTime, waitMs) === null) throw storageError();
    return lease;
  };

  const acquireMainLease = async (
    canonicalRoot: string,
    directories: CommandDirectories,
    slot: SlotRead,
    currentTime: string
  ): Promise<Extract<LeaseRead, { status: 'valid' }> | null> => {
    const lease = buildMainLease(slot, currentTime);
    const leaseFile = path.join(directories.slots, '0.slot.lease');
    try {
      await publishExclusiveLeaseRecord({
        fs,
        canonicalRoot,
        file: leaseFile,
        bytes: JSON.stringify(lease),
      });
    } catch (error) {
      if (error instanceof RecordIoError && error.code === 'already_exists') return null;
      throw neutralizeIo(error);
    }
    const held = await readLease(canonicalRoot, directories, now());
    if (held.status !== 'valid' || !sameLease(held.lease, lease)) throw storageError();
    return held;
  };

  const leaseIsActive = (lease: StudioDirectorCommandSlotLeaseV1, currentTime: string): boolean => {
    const currentMs = canonicalTimestamp(currentTime);
    return currentMs !== null && currentMs < Date.parse(lease.expiresAt);
  };

  const removeIdentifiedRecord = async (
    canonicalRoot: string,
    file: string,
    identity: { dev: number; ino: number }
  ): Promise<boolean> => {
    try {
      return await removeRegularRecordIfIdentity({ fs, canonicalRoot, file, identity });
    } catch {
      throw storageError();
    }
  };

  const releaseMainLease = async (
    canonicalRoot: string,
    directories: CommandDirectories,
    held: Extract<LeaseRead, { status: 'valid' }>
  ): Promise<boolean> => {
    if (!leaseIsActive(held.lease, now())) return false;
    const fresh = await readLease(canonicalRoot, directories, now());
    if (
      fresh.status !== 'valid' ||
      !sameLease(fresh.lease, held.lease) ||
      !sameIdentity(fresh.identity, held.identity) ||
      !leaseIsActive(held.lease, now())
    ) {
      return false;
    }
    return removeIdentifiedRecord(canonicalRoot, path.join(directories.slots, '0.slot.lease'), fresh.identity);
  };

  const reclaimExpiredLease = async (
    canonicalRoot: string,
    directories: CommandDirectories,
    currentTime: string
  ): Promise<boolean> => {
    const observed = await readLease(canonicalRoot, directories, currentTime);
    if (observed.status === 'absent') return true;
    if (observed.status === 'invalid') throw storageError();
    if (leaseIsActive(observed.lease, currentTime)) return false;

    const fresh = await readLease(canonicalRoot, directories, currentTime);
    if (
      fresh.status !== 'valid' ||
      !sameLease(fresh.lease, observed.lease) ||
      !sameIdentity(fresh.identity, observed.identity) ||
      leaseIsActive(fresh.lease, currentTime)
    ) {
      return false;
    }
    return removeIdentifiedRecord(canonicalRoot, path.join(directories.slots, '0.slot.lease'), fresh.identity);
  };

  const removeRecord = async (canonicalRoot: string, file: string): Promise<void> => {
    try {
      await removeRegularRecordIfPresent({ fs, canonicalRoot, file });
    } catch {
      throw storageError();
    }
  };

  const readPending = async (projectId: string, commandId: string): Promise<StudioDirectorPendingRead | null> => {
    requireIdentity(projectId, commandId);
    const directories = await directoriesFor(projectId, false);
    if (directories === null) return null;
    const canonicalRoot = await canonicalRootPromise;
    const bytes = await readBytes(canonicalRoot, path.join(directories.pending, `${commandId}.json`));
    if (bytes === null) return null;
    const slotBytes = await readBytes(canonicalRoot, path.join(directories.slots, '0.slot'));
    return parseStudioDirectorPendingRecord({
      projectId,
      commandId,
      value: parseJson(bytes),
      slot: slotBytes === null ? null : parseJson(slotBytes),
      now: now(),
      waitMs,
    });
  };

  return {
    async ensure(projectId: string): Promise<void> {
      if ((await directoriesFor(projectId, true)) === null) throw storageError();
    },

    async snapshotPendingPage(cursor: string | null, limit: number): Promise<StudioDirectorCommandPage> {
      return scanLedgerPage({
        method: 'snapshotPendingPage',
        cursor,
        limit,
        directory: 'pending',
        tolerateProjectErrors: false,
        createIfWhollyAbsent: true,
      });
    },

    readPending,

    async readReceipt(projectId: string, commandId: string): Promise<StudioDirectorCommandReceiptV1 | null> {
      requireIdentity(projectId, commandId);
      const directories = await directoriesFor(projectId, false);
      if (directories === null) return null;
      return exactReceiptFrom(await canonicalRootPromise, directories, projectId, commandId);
    },

    async writeReceipt(projectId: string, receipt: StudioDirectorCommandReceiptV1): Promise<void> {
      requireIdentity(projectId, receipt.commandId);
      if (
        receipt.projectId !== projectId ||
        parseStudioDirectorCommandReceipt({ projectId, commandId: receipt.commandId, value: receipt }) === null
      ) {
        throw invalidPayload();
      }
      const bytes = JSON.stringify(receipt);
      if (Buffer.byteLength(bytes, 'utf8') > STUDIO_DIRECTOR_COMMAND_MAX_RECORD_BYTES) throw invalidPayload();
      const directories = await directoriesFor(projectId, true);
      if (directories === null) throw storageError();
      try {
        await publishImmutableRecord({
          fs,
          canonicalRoot: await canonicalRootPromise,
          file: path.join(directories.receipts, `${receipt.commandId}.json`),
          bytes,
        });
      } catch (error) {
        if (error instanceof RecordIoError && error.code === 'already_exists') {
          throw new CreativeStudioStoreError('invalid_payload', 'Studio Director command receipt already exists');
        }
        throw storageError();
      }
    },

    async finish(projectId: string, commandId: string): Promise<void> {
      requireIdentity(projectId, commandId);
      return runSlotCleanup(projectId, async () => {
        const directories = await directoriesFor(projectId, false);
        if (directories === null) return;
        const canonicalRoot = await canonicalRootPromise;
        const pendingFile = path.join(directories.pending, `${commandId}.json`);
        const slotFile = path.join(directories.slots, '0.slot');
        const receipt = await exactReceiptFrom(canonicalRoot, directories, projectId, commandId);
        const slot = await readSlot(canonicalRoot, directories, now());
        if (receipt === null) {
          const attributableSlot =
            (slot.status === 'valid' && slot.slot.commandId === commandId) ||
            (slot.status === 'invalid' && slot.commandId === commandId);
          if ((await pathExists(pendingFile)) || attributableSlot) throw storageError();
          return;
        }
        if (slot.status === 'valid' && slot.slot.commandId !== commandId) throw storageError();
        if (slot.status === 'invalid' && slot.commandId !== commandId) throw storageError();
        let held: Extract<LeaseRead, { status: 'valid' }> | undefined;
        try {
          held = (await acquireMainLease(canonicalRoot, directories, slot, now())) ?? undefined;
          if (held === undefined) throw storageError();
          if (!leaseIsActive(held.lease, now())) throw storageError();
          const freshSlot = await readSlot(canonicalRoot, directories, now());
          if (!sameSlotRead(slot, freshSlot)) throw storageError();

          await removeRecord(canonicalRoot, pendingFile);
          if (!leaseIsActive(held.lease, now())) throw storageError();
          if (
            freshSlot.status !== 'absent' &&
            !(await removeIdentifiedRecord(canonicalRoot, slotFile, freshSlot.identity))
          ) {
            throw storageError();
          }
          if (!leaseIsActive(held.lease, now())) throw storageError();
          if (!(await releaseMainLease(canonicalRoot, directories, held))) throw storageError();
          held = undefined;

          if (await pathExists(pendingFile)) throw storageError();
          if ((await readSlot(canonicalRoot, directories, now())).status !== 'absent') throw storageError();
        } catch (error) {
          if (held !== undefined) {
            await releaseMainLease(canonicalRoot, directories, held).catch((): undefined => undefined);
          }
          throw neutralizeIo(error);
        }
      });
    },

    async listPendingPage(cursor: string | null, limit: number): Promise<StudioDirectorCommandPage> {
      return scanLedgerPage({
        method: 'listPendingPage',
        cursor,
        limit,
        directory: 'pending',
        tolerateProjectErrors: true,
        createIfWhollyAbsent: false,
      });
    },

    async releaseOrphanedSlotsPage(
      cursor: string | null,
      currentTime: string,
      limit: number
    ): Promise<StudioDirectorMaintenancePage> {
      const nowMs = canonicalTimestamp(currentTime);
      if (nowMs === null) throw invalidPayload();
      const canonicalRoot = await canonicalRootPromise;
      return scanProjectPage({
        cursor,
        limit,
        visit: (projectId) =>
          runSlotCleanup(projectId, async () => {
            const directories = await directoriesFor(projectId, false);
            if (directories === null) return;
            if (!(await reclaimExpiredLease(canonicalRoot, directories, currentTime))) return;

            const observedSlot = await readSlot(canonicalRoot, directories, currentTime);
            if (observedSlot.status === 'absent') return;
            let held: Extract<LeaseRead, { status: 'valid' }> | undefined;
            try {
              held = (await acquireMainLease(canonicalRoot, directories, observedSlot, now())) ?? undefined;
              if (held === undefined) return;
              if (!leaseIsActive(held.lease, now())) return;
              const slotRead = await readSlot(canonicalRoot, directories, currentTime);
              if (!sameSlotRead(observedSlot, slotRead)) {
                await releaseMainLease(canonicalRoot, directories, held);
                held = undefined;
                return;
              }
              if (slotRead.status === 'absent') {
                await releaseMainLease(canonicalRoot, directories, held);
                held = undefined;
                return;
              }
              if (slotRead.status === 'invalid') {
                if (slotRead.commandId === null) throw storageError();
                if (await pathExists(path.join(directories.pending, `${slotRead.commandId}.json`))) {
                  await releaseMainLease(canonicalRoot, directories, held);
                  held = undefined;
                  return;
                }
              } else {
                const { slot } = slotRead;
                if (await pathExists(path.join(directories.pending, `${slot.commandId}.json`))) {
                  await releaseMainLease(canonicalRoot, directories, held);
                  held = undefined;
                  return;
                }
                const deadlineMs = canonicalTimestamp(slot.deadlineAt);
                if (deadlineMs === null) throw storageError();
                if (
                  deadlineMs >= nowMs &&
                  (await exactReceiptFrom(canonicalRoot, directories, projectId, slot.commandId)) === null
                ) {
                  await releaseMainLease(canonicalRoot, directories, held);
                  held = undefined;
                  return;
                }
              }

              if (!leaseIsActive(held.lease, now())) return;
              if (
                !(await removeIdentifiedRecord(
                  canonicalRoot,
                  path.join(directories.slots, '0.slot'),
                  slotRead.identity
                ))
              ) {
                throw storageError();
              }
              if (leaseIsActive(held.lease, now())) {
                await releaseMainLease(canonicalRoot, directories, held);
                held = undefined;
              }
            } catch (error) {
              if (held !== undefined && leaseIsActive(held.lease, now())) {
                await releaseMainLease(canonicalRoot, directories, held).catch((): undefined => undefined);
              }
              throw error;
            }
          }),
      });
    },

    async pruneReceiptsPage(
      cursor: string | null,
      decidedBefore: string,
      limit: number
    ): Promise<StudioDirectorMaintenancePage> {
      const cutoffMs = canonicalTimestamp(decidedBefore);
      if (cutoffMs === null) throw invalidPayload();
      const page = await scanLedgerPage({
        method: 'pruneReceiptsPage',
        cursor,
        limit,
        directory: 'receipts',
        tolerateProjectErrors: true,
        createIfWhollyAbsent: false,
      });
      const canonicalRoot = await canonicalRootPromise;
      for (const ref of page.items) {
        try {
          // eslint-disable-next-line no-await-in-loop
          const directories = await directoriesFor(ref.projectId, false);
          if (directories === null) continue;
          // eslint-disable-next-line no-await-in-loop
          const receipt = await exactReceiptFrom(canonicalRoot, directories, ref.projectId, ref.commandId);
          if (receipt === null || Date.parse(receipt.decidedAt) >= cutoffMs) continue;
          // eslint-disable-next-line no-await-in-loop
          if (await pathExists(path.join(directories.pending, `${ref.commandId}.json`))) continue;
          // eslint-disable-next-line no-await-in-loop
          const slot = await readSlot(canonicalRoot, directories, now());
          if (slot.status === 'invalid') throw storageError();
          if (slot.status === 'valid' && slot.slot.commandId === ref.commandId) continue;
          // eslint-disable-next-line no-await-in-loop
          await removeRecord(canonicalRoot, path.join(directories.receipts, `${ref.commandId}.json`));
        } catch {
          safeLog('[CreativeStudio] Director command receipt maintenance retained unsafe storage');
        }
      }
      return { processed: page.items.length, nextCursor: page.nextCursor };
    },

    async watch(trigger: (projectId: string, commandId?: string) => void): Promise<() => void> {
      const canonicalRoot = await canonicalRootPromise;
      let closed = false;
      let watcher: { close(): void };
      try {
        watcher = watchCommandTree({
          rootDir: canonicalRoot,
          onChange: (relativeFile) => {
            if (closed) return;
            const segments = path.normalize(relativeFile).split(path.sep);
            if (
              segments.length === 3 &&
              isSafeStudioDirectorId(segments[0]) &&
              segments[1] === 'commands' &&
              segments[2] === 'pending'
            ) {
              trigger(segments[0], undefined);
              return;
            }
            if (
              segments.length !== 4 ||
              !isSafeStudioDirectorId(segments[0]) ||
              segments[1] !== 'commands' ||
              segments[2] !== 'pending' ||
              !segments[3].endsWith('.json')
            ) {
              return;
            }
            const commandId = segments[3].slice(0, -'.json'.length);
            if (isSafeStudioDirectorId(commandId)) trigger(segments[0], commandId);
          },
          onError: () => {
            if (!closed) safeLog('[CreativeStudio] Director command watcher failed');
          },
        });
      } catch {
        throw storageError();
      }
      return () => {
        if (closed) return;
        closed = true;
        watcher.close();
      };
    },

    async dispose(): Promise<void> {
      if (disposed) return;
      disposed = true;
      await Promise.all(cursorOperations.values());
      while (slotCleanupOperations.size > 0) {
        const operations = [...slotCleanupOperations.values()];
        // A finishing cleanup can expose its queued successor; repeat until stable.
        // eslint-disable-next-line no-await-in-loop
        await Promise.allSettled(operations);
        // eslint-disable-next-line no-await-in-loop
        await Promise.resolve();
      }
      let failed = false;
      for (const session of sessions.values()) {
        try {
          // Dispose is best-effort across every method-owned traversal.
          // eslint-disable-next-line no-await-in-loop
          await closeSession(session);
        } catch {
          failed = true;
        }
      }
      if (failed) throw storageError();
    },
  };
};
