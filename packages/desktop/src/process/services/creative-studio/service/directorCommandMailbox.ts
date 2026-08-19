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
  STUDIO_DIRECTOR_COMMAND_SCHEMA_VERSION_V2,
  STUDIO_DIRECTOR_COMMAND_SLOT_LEASE_MS,
  STUDIO_DIRECTOR_COMMAND_WAIT_MS,
  type StudioDirectorCommandReceiptV2,
  type StudioDirectorCommandSlotLeaseV2,
  type StudioDirectorCommandSlotV2,
} from '@/common/types/project/creativeStudioTypes';
import {
  parseStudioDirectorCommandReceiptV2,
  parseStudioDirectorCommandSlotLeaseV2,
  parseStudioDirectorCommandSlotV2,
  parseStudioDirectorPendingRecordV2,
  isSafeStudioDirectorId,
  type StudioDirectorCommandParseResultV2,
  type StudioDirectorSidecarParseResultV2,
} from './directorCommandContracts';
import {
  canonicalizeRecordRoot,
  publishExclusiveLeaseRecord,
  publishImmutableRecord,
  readBoundedRegularFile,
  readBoundedRegularFileWithIdentity,
  RecordIoError,
  resolveCompleteDirectorySet,
  resolveConfinedRecordPath,
  type RecordIoFileSystem,
} from './recordIo';
import { CreativeStudioStoreError, type CreativeStudioStore } from '@process/services/creative-studio/store';

export type StudioDirectorPendingReadV2 = StudioDirectorCommandParseResultV2;
export type StudioDirectorReceiptReadV2 = StudioDirectorSidecarParseResultV2<StudioDirectorCommandReceiptV2>;

export type StudioDirectorCommandRef = { projectId: string; commandId: string };

export type StudioDirectorCommandPage = {
  items: StudioDirectorCommandRef[];
  nextCursor: string | null;
};

export type StudioDirectorMaintenancePage = {
  processed: number;
  nextCursor: string | null;
};

export type StudioDirectorCommandMailboxV2 = {
  ensure(projectId: string): Promise<void>;
  snapshotPendingPage(cursor: string | null, limit: number): Promise<StudioDirectorCommandPage>;
  readPending(projectId: string, commandId: string): Promise<StudioDirectorPendingReadV2 | null>;
  readReceipt(projectId: string, commandId: string): Promise<StudioDirectorReceiptReadV2 | null>;
  writeReceipt(projectId: string, receipt: StudioDirectorCommandReceiptV2): Promise<void>;
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

type DirectorCommandSlot = StudioDirectorCommandSlotV2;
type DirectorCommandSlotLease = StudioDirectorCommandSlotLeaseV2;
type DirectorCommandReceipt = StudioDirectorCommandReceiptV2;
type DirectorPendingRead = StudioDirectorPendingReadV2;
type DirectoryAuthorityV2 = { path: string; dev: number; ino: number };
type ProjectManifestFingerprintV2 = {
  dev: number;
  ino: number;
  size: number;
  mtimeMs: number;
  ctimeMs: number;
};
type ProjectAuthorityV2 = {
  projectId: string;
  directory: DirectoryAuthorityV2;
  manifest: ProjectManifestFingerprintV2 | null;
};
const STUDIO_DIRECTOR_PROJECT_AUTHORITY_MAX_BYTES_V2 = 64 * 1024 * 1024;
type DirectorReceiptRead =
  | { status: 'valid'; record: DirectorCommandReceipt }
  | { status: 'unsupported_prototype_schema' }
  | { status: 'invalid' };

type SlotRead =
  | { status: 'absent' }
  | {
      status: 'valid';
      slot: DirectorCommandSlot;
      bytes: string;
      identity: { dev: number; ino: number };
    }
  | {
      status: 'invalid';
      commandId: string | null;
      bytes: string;
      identity: { dev: number; ino: number };
    }
  | {
      status: 'unsupported_prototype_schema';
      commandId: string | null;
      bytes: string;
      identity: { dev: number; ino: number };
    };

type LeaseRead =
  | { status: 'absent' }
  | { status: 'invalid' }
  | {
      status: 'valid';
      lease: DirectorCommandSlotLease;
      bytes: string;
      identity: { dev: number; ino: number };
    }
  | { status: 'unsupported_prototype_schema' };

type WatchCommandTree = (input: {
  rootDir: string;
  onChange(relativeFile: string): void;
  onError(error: Error): void;
}) => { close(): void };

export type StudioDirectorCommandMailboxDepsV2 = {
  rootDir: string;
  store: Pick<CreativeStudioStore, 'getVerifiedProjectDirectoryV2'>;
  now?: () => string;
  createId?: () => string;
  waitMs?: number;
  fs?: RecordIoFileSystem;
  logError?: (message: string, error: unknown) => void;
  watchCommandTree?: WatchCommandTree;
};

type StudioDirectorCommandMailboxInternalDeps = Omit<StudioDirectorCommandMailboxDepsV2, 'store'> & {
  getVerifiedProjectDirectory(projectId: string): Promise<string | null>;
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

const isUnsupportedProject = (error: unknown): boolean =>
  error instanceof CreativeStudioStoreError && error.code === 'unsupported_prototype_schema';

const neutralizeIo = (error: unknown): CreativeStudioStoreError => {
  if (error instanceof CreativeStudioStoreError) return error;
  return storageError();
};

const canonicalTimestamp = (value: string): number | null => {
  if (value.length !== 24) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value ? parsed : null;
};

const createStudioDirectorCommandMailboxInternal = (
  deps: StudioDirectorCommandMailboxInternalDeps
): StudioDirectorCommandMailboxV2 => {
  const fs = deps.fs ?? nodeFs;
  const now = deps.now ?? (() => new Date().toISOString());
  const createId = deps.createId ?? randomUUID;
  const waitMs = deps.waitMs ?? STUDIO_DIRECTOR_COMMAND_WAIT_MS;
  const logError = deps.logError ?? (() => undefined);
  const canonicalRootPromise = canonicalizeRecordRoot({ fs, rootDir: deps.rootDir });
  const verifiedProjectAuthoritiesV2 = new Map<string, ProjectAuthorityV2>();
  const watchCommandTree: WatchCommandTree =
    deps.watchCommandTree ??
    ((input) => {
      const watcher = watchFileSystem(input.rootDir, { recursive: true, encoding: 'utf8' }, (_eventType, fileName) => {
        if (fileName !== null) input.onChange(fileName);
      });
      watcher.on('error', input.onError);
      return { close: () => watcher.close() };
    });

  const parsePendingRecord = (input: {
    projectId: string;
    commandId: string;
    value: unknown;
    slot: unknown;
    now: string;
    waitMs: number;
  }): DirectorPendingRead => parseStudioDirectorPendingRecordV2(input);

  const parseSlotRecord = (
    value: unknown,
    currentTime: string
  ):
    | { status: 'valid'; record: DirectorCommandSlot }
    | { status: 'unsupported_prototype_schema' }
    | { status: 'invalid' } => parseStudioDirectorCommandSlotV2(value, currentTime, waitMs);

  const parseLeaseRecord = (
    value: unknown,
    currentTime: string
  ):
    | { status: 'valid'; record: DirectorCommandSlotLease }
    | { status: 'unsupported_prototype_schema' }
    | { status: 'invalid' } => parseStudioDirectorCommandSlotLeaseV2(value, currentTime, waitMs);

  const parseReceiptRecord = (input: { projectId: string; commandId: string; value: unknown }): DirectorReceiptRead =>
    parseStudioDirectorCommandReceiptV2(input);

  const safeLog = (message: string): void => {
    try {
      logError(message, new Error('StudioDirectorCommandStorageError'));
    } catch {
      // Maintenance diagnostics never change record authority.
    }
  };

  const captureDirectoryAuthorityV2 = async (directory: string): Promise<DirectoryAuthorityV2> => {
    const stats = await fs.lstat(directory);
    if (!stats.isDirectory() || stats.isSymbolicLink() || (await fs.realpath(directory)) !== directory) {
      throw new RecordIoError('unsafe_path');
    }
    return { path: directory, dev: stats.dev, ino: stats.ino };
  };

  const assertDirectoryAuthorityV2 = async (authority: DirectoryAuthorityV2): Promise<void> => {
    const current = await captureDirectoryAuthorityV2(authority.path);
    if (current.dev !== authority.dev || current.ino !== authority.ino) throw new RecordIoError('unsafe_path');
  };

  const syncDirectoryAuthorityV2 = async (authority: DirectoryAuthorityV2): Promise<void> => {
    await assertDirectoryAuthorityV2(authority);
    const handle = await fs.open(authority.path, 'r');
    try {
      const stats = await handle.stat();
      if (!stats.isDirectory() || stats.dev !== authority.dev || stats.ino !== authority.ino) {
        throw new RecordIoError('unsafe_path');
      }
      await handle.sync();
    } finally {
      await handle.close();
    }
    await assertDirectoryAuthorityV2(authority);
  };

  const captureProjectAuthorityV2 = async (
    projectId: string,
    directories: CommandDirectories
  ): Promise<ProjectAuthorityV2> => {
    const expectedDirectory = path.dirname(directories.root);
    const cached = verifiedProjectAuthoritiesV2.get(projectId);
    if (cached !== undefined) {
      if (cached.directory.path !== expectedDirectory) throw new RecordIoError('unsafe_path');
      await assertProjectAuthorityV2(cached);
      return cached;
    }
    const verifiedDirectory = await deps.getVerifiedProjectDirectory(projectId);
    if (verifiedDirectory !== expectedDirectory) throw new RecordIoError('unsafe_path');
    const directory = await captureDirectoryAuthorityV2(expectedDirectory);
    const authority: ProjectAuthorityV2 = { projectId, directory, manifest: null };
    await assertProjectAuthorityV2(authority);
    verifiedProjectAuthoritiesV2.set(projectId, authority);
    return authority;
  };

  const assertProjectAuthorityV2 = async (authority: ProjectAuthorityV2): Promise<void> => {
    await assertDirectoryAuthorityV2(authority.directory);
    const projectFile = path.join(authority.directory.path, 'project.json');
    const initial = await fs.lstat(projectFile);
    if (initial.isSymbolicLink() || !initial.isFile()) throw new RecordIoError('unsafe_file');
    if (
      authority.manifest !== null &&
      initial.dev === authority.manifest.dev &&
      initial.ino === authority.manifest.ino &&
      initial.size === authority.manifest.size &&
      initial.mtimeMs === authority.manifest.mtimeMs &&
      initial.ctimeMs === authority.manifest.ctimeMs
    ) {
      await assertDirectoryAuthorityV2(authority.directory);
      return;
    }
    const identified = await readBoundedRegularFileWithIdentity({
      fs,
      canonicalRoot: authority.directory.path,
      file: projectFile,
      maxBytes: STUDIO_DIRECTOR_PROJECT_AUTHORITY_MAX_BYTES_V2,
    });
    if (identified === null) throw new RecordIoError('unsafe_file');
    let value: unknown;
    try {
      value = JSON.parse(identified.bytes) as unknown;
    } catch {
      throw new RecordIoError('unsafe_file');
    }
    if (
      typeof value === 'object' &&
      value !== null &&
      !Array.isArray(value) &&
      (value as { schemaVersion?: unknown }).schemaVersion === 1
    ) {
      throw new CreativeStudioStoreError(
        'unsupported_prototype_schema',
        'Studio Director commands do not own schema-1 project bytes'
      );
    }
    if (
      typeof value !== 'object' ||
      value === null ||
      Array.isArray(value) ||
      (value as { schemaVersion?: unknown }).schemaVersion !== 2 ||
      (value as { id?: unknown }).id !== authority.projectId
    ) {
      throw new RecordIoError('unsafe_file');
    }
    const final = await fs.lstat(projectFile);
    if (
      final.isSymbolicLink() ||
      !final.isFile() ||
      final.dev !== identified.identity.dev ||
      final.ino !== identified.identity.ino
    ) {
      throw new RecordIoError('unsafe_file');
    }
    authority.manifest = {
      dev: final.dev,
      ino: final.ino,
      size: final.size,
      mtimeMs: final.mtimeMs,
      ctimeMs: final.ctimeMs,
    };
    await assertDirectoryAuthorityV2(authority.directory);
  };

  const syncAuthorizedDirectoryV2 = async (
    authority: DirectoryAuthorityV2,
    projectAuthority: ProjectAuthorityV2
  ): Promise<void> => {
    await assertProjectAuthorityV2(projectAuthority);
    await syncDirectoryAuthorityV2(authority);
    await assertProjectAuthorityV2(projectAuthority);
  };

  const withExactLinkAuthorityV2 = (
    authority: DirectoryAuthorityV2,
    projectAuthority: ProjectAuthorityV2,
    finalFile: string,
    authorizeBeforeLink?: () => Promise<void>,
    onLinkAttempt?: () => void,
    observeLinkOutcome?: (existingPath: string, newPath: string) => Promise<void>
  ): RecordIoFileSystem =>
    new Proxy(fs, {
      get(target, property) {
        if (property === 'link') {
          return async (
            existingPath: Parameters<RecordIoFileSystem['link']>[0],
            newPath: Parameters<RecordIoFileSystem['link']>[1]
          ): ReturnType<RecordIoFileSystem['link']> => {
            if (String(newPath) !== finalFile) throw new RecordIoError('unsafe_path');
            await assertProjectAuthorityV2(projectAuthority);
            await assertDirectoryAuthorityV2(authority);
            await authorizeBeforeLink?.();
            await assertDirectoryAuthorityV2(authority);
            await assertProjectAuthorityV2(projectAuthority);
            onLinkAttempt?.();
            try {
              await target.link(existingPath, newPath);
            } catch (error) {
              await observeLinkOutcome?.(String(existingPath), String(newPath));
              throw error;
            }
            await observeLinkOutcome?.(String(existingPath), String(newPath));
          };
        }
        const value = Reflect.get(target, property, target) as unknown;
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });

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
      const canonicalRoot = await canonicalRootPromise;
      let projectDirectory: string | null;
      const cached = verifiedProjectAuthoritiesV2.get(projectId);
      if (cached !== undefined) {
        await assertProjectAuthorityV2(cached);
        projectDirectory = cached.directory.path;
      } else {
        projectDirectory = await deps.getVerifiedProjectDirectory(projectId);
        if (projectDirectory !== null) {
          const authority: ProjectAuthorityV2 = {
            projectId,
            directory: await captureDirectoryAuthorityV2(projectDirectory),
            manifest: null,
          };
          await assertProjectAuthorityV2(authority);
          verifiedProjectAuthoritiesV2.set(projectId, authority);
        }
      }
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
  const indeterminateReceiptPublications = new Set<string>();
  let disposed = false;

  const receiptPublicationKey = (projectId: string, commandId: string): string => `${projectId}/${commandId}`;

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
            if (isUnsupportedProject(error)) continue;
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
  ): Promise<DirectorReceiptRead | null> => {
    if (indeterminateReceiptPublications.has(receiptPublicationKey(projectId, commandId))) {
      throw storageError();
    }
    const authorities = {
      project: await captureProjectAuthorityV2(projectId, directories),
      receipts: await captureDirectoryAuthorityV2(directories.receipts),
    };
    const bytes = await readBytes(canonicalRoot, path.join(directories.receipts, `${commandId}.json`));
    if (bytes === null) {
      await assertDirectoryAuthorityV2(authorities.receipts);
      await assertProjectAuthorityV2(authorities.project);
      return null;
    }
    const receipt = parseReceiptRecord({ projectId, commandId, value: parseJson(bytes) });
    if (receipt.status === 'valid') {
      await syncAuthorizedDirectoryV2(authorities.receipts, authorities.project);
    } else {
      await assertDirectoryAuthorityV2(authorities.receipts);
      await assertProjectAuthorityV2(authorities.project);
    }
    return receipt;
  };

  const exactReceiptRecordIsCurrentV2 = async (input: {
    canonicalRoot: string;
    authority: DirectoryAuthorityV2;
    projectAuthority: ProjectAuthorityV2;
    file: string;
    projectId: string;
    commandId: string;
    expected: NonNullable<Awaited<ReturnType<typeof readIdentifiedBytes>>>;
  }): Promise<boolean> => {
    if (indeterminateReceiptPublications.has(receiptPublicationKey(input.projectId, input.commandId))) return false;
    await assertProjectAuthorityV2(input.projectAuthority);
    await assertDirectoryAuthorityV2(input.authority);
    const current = await readIdentifiedBytes(input.canonicalRoot, input.file);
    if (
      current === null ||
      current.bytes !== input.expected.bytes ||
      !sameIdentity(current.identity, input.expected.identity)
    ) {
      return false;
    }
    const parsed = parseReceiptRecord({
      projectId: input.projectId,
      commandId: input.commandId,
      value: parseJson(current.bytes),
    });
    await assertDirectoryAuthorityV2(input.authority);
    await assertProjectAuthorityV2(input.projectAuthority);
    return parsed.status === 'valid' && parsed.record.schemaVersion === STUDIO_DIRECTOR_COMMAND_SCHEMA_VERSION_V2;
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

  const exactPathIsAbsentV2 = async (
    authority: DirectoryAuthorityV2,
    projectAuthority: ProjectAuthorityV2,
    file: string
  ): Promise<boolean> => {
    if (path.dirname(file) !== authority.path) return false;
    await assertProjectAuthorityV2(projectAuthority);
    await assertDirectoryAuthorityV2(authority);
    try {
      await fs.lstat(file);
      return false;
    } catch (error) {
      if (!isErrorCode(error, 'ENOENT')) throw error;
    }
    await assertDirectoryAuthorityV2(authority);
    await assertProjectAuthorityV2(projectAuthority);
    return true;
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
    const parsed = parseSlotRecord(value, currentTime);
    if (parsed.status === 'valid') {
      return { status: 'valid', slot: parsed.record, bytes: record.bytes, identity: record.identity };
    }
    return {
      status: parsed.status,
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
    const parsed = parseLeaseRecord(parseJson(record.bytes), currentTime);
    if (parsed.status !== 'valid') return { status: parsed.status };
    return { status: 'valid', lease: parsed.record, bytes: record.bytes, identity: record.identity };
  };

  const sameLease = (left: DirectorCommandSlotLease, right: DirectorCommandSlotLease): boolean =>
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

  const buildMainLease = (slot: SlotRead, currentTime: string): DirectorCommandSlotLease => {
    const acquiredAtMs = canonicalTimestamp(currentTime);
    const leaseId = createId();
    if (acquiredAtMs === null || !isSafeStudioDirectorId(leaseId)) throw storageError();
    const candidate = {
      schemaVersion: STUDIO_DIRECTOR_COMMAND_SCHEMA_VERSION_V2,
      leaseId,
      owner: 'main',
      commandId: slot.status === 'valid' ? slot.slot.commandId : null,
      reservedAt: slot.status === 'valid' ? slot.slot.reservedAt : null,
      deadlineAt: slot.status === 'valid' ? slot.slot.deadlineAt : null,
      acquiredAt: currentTime,
      expiresAt: new Date(acquiredAtMs + STUDIO_DIRECTOR_COMMAND_SLOT_LEASE_MS).toISOString(),
    };
    const parsed = parseLeaseRecord(candidate, currentTime);
    if (parsed.status !== 'valid') throw storageError();
    return parsed.record;
  };

  const acquireMainLease = async (
    canonicalRoot: string,
    directories: CommandDirectories,
    slot: SlotRead,
    currentTime: string,
    projectAuthorityV2?: ProjectAuthorityV2
  ): Promise<Extract<LeaseRead, { status: 'valid' }> | null> => {
    const lease = buildMainLease(slot, currentTime);
    const leaseFile = path.join(directories.slots, '0.slot.lease');
    const leaseBytes = JSON.stringify(lease);
    if (projectAuthorityV2 === undefined) throw storageError();
    const authority = await captureDirectoryAuthorityV2(directories.slots);
    let linkedIdentity: { dev: number; ino: number } | undefined;
    const observeLinkedLease = async (source: string, destination: string): Promise<void> => {
      try {
        const [sourceStats, destinationStats] = await Promise.all([fs.lstat(source), fs.lstat(destination)]);
        if (
          sourceStats.isFile() &&
          !sourceStats.isSymbolicLink() &&
          destinationStats.isFile() &&
          !destinationStats.isSymbolicLink() &&
          sameIdentity(sourceStats, destinationStats)
        ) {
          linkedIdentity = { dev: destinationStats.dev, ino: destinationStats.ino };
        }
      } catch {
        // A missing or replaced final name is not owned by this publication.
      }
    };
    try {
      await publishExclusiveLeaseRecord({
        fs: withExactLinkAuthorityV2(
          authority,
          projectAuthorityV2,
          leaseFile,
          async () => {
            const currentSlot = await readSlot(canonicalRoot, directories, now());
            if (!sameSlotRead(slot, currentSlot)) throw new RecordIoError('storage_error');
          },
          undefined,
          observeLinkedLease
        ),
        canonicalRoot,
        file: leaseFile,
        bytes: leaseBytes,
      });
      await syncAuthorizedDirectoryV2(authority, projectAuthorityV2);
      const held = await readLease(canonicalRoot, directories, now());
      if (
        held.status !== 'valid' ||
        linkedIdentity === undefined ||
        !sameIdentity(held.identity, linkedIdentity) ||
        !sameLease(held.lease, lease)
      ) {
        throw storageError();
      }
      await assertDirectoryAuthorityV2(authority);
      await assertProjectAuthorityV2(projectAuthorityV2);
      return held;
    } catch (error) {
      if (linkedIdentity !== undefined) {
        const ownedIdentity = linkedIdentity;
        await quarantineRemoveIdentifiedRecordV2({
          authority,
          allowProjectSchemaMismatchForOwnedPublicationRollback: true,
          file: leaseFile,
          identity: ownedIdentity,
          missingIsSuccess: true,
          isStillAuthorized: async (_phase, file) => {
            const record = await readIdentifiedBytes(canonicalRoot, file);
            if (record === null || record.bytes !== leaseBytes || !sameIdentity(record.identity, ownedIdentity)) {
              return false;
            }
            const parsed = parseLeaseRecord(parseJson(record.bytes), now());
            return parsed.status === 'valid' && sameLease(parsed.record, lease);
          },
        }).catch((): false => false);
      }
      if (error instanceof RecordIoError && error.code === 'already_exists') return null;
      throw neutralizeIo(error);
    }
  };

  const leaseIsActive = (lease: DirectorCommandSlotLease, currentTime: string): boolean => {
    const currentMs = canonicalTimestamp(currentTime);
    return currentMs !== null && currentMs < Date.parse(lease.expiresAt);
  };

  const heldLeaseIsExactAndActiveV2 = async (
    canonicalRoot: string,
    directories: CommandDirectories,
    held: Extract<LeaseRead, { status: 'valid' }>,
    authority: DirectoryAuthorityV2,
    projectAuthority: ProjectAuthorityV2
  ): Promise<boolean> => {
    const currentTime = now();
    if (!leaseIsActive(held.lease, currentTime)) return false;
    await assertProjectAuthorityV2(projectAuthority);
    await assertDirectoryAuthorityV2(authority);
    const record = await readIdentifiedBytes(canonicalRoot, path.join(directories.slots, '0.slot.lease'));
    if (record === null || record.bytes !== held.bytes || !sameIdentity(record.identity, held.identity)) return false;
    const parsed = parseLeaseRecord(parseJson(record.bytes), currentTime);
    await assertDirectoryAuthorityV2(authority);
    await assertProjectAuthorityV2(projectAuthority);
    return parsed.status === 'valid' && sameLease(parsed.record, held.lease) && leaseIsActive(held.lease, now());
  };

  const restoreQuarantinedRecordV2 = async (input: {
    authority: DirectoryAuthorityV2;
    file: string;
    quarantine: string;
  }): Promise<void> => {
    try {
      await assertDirectoryAuthorityV2(input.authority);
      try {
        await fs.link(input.quarantine, input.file);
      } catch (error) {
        if (!isErrorCode(error, 'EEXIST')) throw error;
        await syncDirectoryAuthorityV2(input.authority);
        return;
      }
      const [restored, quarantined] = await Promise.all([fs.lstat(input.file), fs.lstat(input.quarantine)]);
      if (
        restored.isSymbolicLink() ||
        quarantined.isSymbolicLink() ||
        !restored.isFile() ||
        !quarantined.isFile() ||
        !sameIdentity(restored, quarantined)
      ) {
        await syncDirectoryAuthorityV2(input.authority);
        return;
      }
      await fs.rm(input.quarantine);
      await syncDirectoryAuthorityV2(input.authority);
    } catch {
      // The named entry or its private quarantine remains authoritative for repair.
      await syncDirectoryAuthorityV2(input.authority).catch((): undefined => undefined);
    }
  };

  const quarantineRemoveIdentifiedRecordV2 = async (input: {
    authority: DirectoryAuthorityV2;
    projectAuthority?: ProjectAuthorityV2;
    allowProjectSchemaMismatchForOwnedPublicationRollback?: boolean;
    file: string;
    identity: { dev: number; ino: number };
    missingIsSuccess: boolean;
    isStillAuthorized: (phase: 'named' | 'quarantined', file: string) => boolean | Promise<boolean>;
  }): Promise<boolean> => {
    if (path.dirname(input.file) !== input.authority.path) return false;
    if (input.projectAuthority === undefined && input.allowProjectSchemaMismatchForOwnedPublicationRollback !== true) {
      return false;
    }
    const quarantine = `${input.file}.${process.pid}_${randomUUID()}.cleanup`;
    let moved = false;
    try {
      if (input.projectAuthority !== undefined) await assertProjectAuthorityV2(input.projectAuthority);
      await assertDirectoryAuthorityV2(input.authority);
      let current: Awaited<ReturnType<RecordIoFileSystem['lstat']>>;
      try {
        current = await fs.lstat(input.file);
      } catch (error) {
        if (!isErrorCode(error, 'ENOENT')) throw error;
        await assertDirectoryAuthorityV2(input.authority);
        if (input.projectAuthority !== undefined) await assertProjectAuthorityV2(input.projectAuthority);
        return input.missingIsSuccess;
      }
      if (
        current.isSymbolicLink() ||
        !current.isFile() ||
        !sameIdentity(current, input.identity) ||
        !(await input.isStillAuthorized('named', input.file))
      ) {
        return false;
      }
      if (input.projectAuthority !== undefined) await assertProjectAuthorityV2(input.projectAuthority);
      await assertDirectoryAuthorityV2(input.authority);
      const named = await fs.lstat(input.file);
      if (named.isSymbolicLink() || !named.isFile() || !sameIdentity(named, input.identity)) return false;
      try {
        await fs.lstat(quarantine);
        return false;
      } catch (error) {
        if (!isErrorCode(error, 'ENOENT')) return false;
      }
      await fs.rename(input.file, quarantine);
      moved = true;
      if (input.projectAuthority !== undefined) await assertProjectAuthorityV2(input.projectAuthority);
      await assertDirectoryAuthorityV2(input.authority);
      const quarantined = await fs.lstat(quarantine);
      if (
        quarantined.isSymbolicLink() ||
        !quarantined.isFile() ||
        !sameIdentity(quarantined, input.identity) ||
        !(await input.isStillAuthorized('quarantined', quarantine))
      ) {
        await restoreQuarantinedRecordV2({ ...input, quarantine });
        return false;
      }
      if (input.projectAuthority !== undefined) await assertProjectAuthorityV2(input.projectAuthority);
      await fs.rm(quarantine);
      moved = false;
      if (input.projectAuthority === undefined) {
        await syncDirectoryAuthorityV2(input.authority);
      } else {
        await syncAuthorizedDirectoryV2(input.authority, input.projectAuthority);
      }
      return true;
    } catch {
      if (moved) await restoreQuarantinedRecordV2({ ...input, quarantine });
      return false;
    }
  };

  const releaseMainLease = async (
    canonicalRoot: string,
    directories: CommandDirectories,
    held: Extract<LeaseRead, { status: 'valid' }>,
    projectAuthorityV2?: ProjectAuthorityV2,
    additionalAuthorizationV2?: (phase: 'named' | 'quarantined') => boolean | Promise<boolean>
  ): Promise<boolean> => {
    if (!leaseIsActive(held.lease, now())) return false;
    if (projectAuthorityV2 === undefined) return false;
    const authority = await captureDirectoryAuthorityV2(directories.slots);
    const fresh = await readLease(canonicalRoot, directories, now());
    if (
      fresh.status !== 'valid' ||
      !sameLease(fresh.lease, held.lease) ||
      !sameIdentity(fresh.identity, held.identity) ||
      !leaseIsActive(held.lease, now())
    ) {
      return false;
    }
    return quarantineRemoveIdentifiedRecordV2({
      authority,
      projectAuthority: projectAuthorityV2,
      file: path.join(directories.slots, '0.slot.lease'),
      identity: fresh.identity,
      missingIsSuccess: false,
      isStillAuthorized: async (phase, file) => {
        if (additionalAuthorizationV2 !== undefined && !(await additionalAuthorizationV2(phase))) return false;
        if (!leaseIsActive(held.lease, now())) return false;
        const record = await readIdentifiedBytes(canonicalRoot, file);
        if (record === null || record.bytes !== fresh.bytes || !sameIdentity(record.identity, fresh.identity)) {
          return false;
        }
        const parsed = parseLeaseRecord(parseJson(record.bytes), now());
        if (parsed.status !== 'valid' || !sameLease(parsed.record, held.lease) || !leaseIsActive(held.lease, now())) {
          return false;
        }
        return additionalAuthorizationV2 === undefined || (await additionalAuthorizationV2(phase));
      },
    });
  };

  const reclaimExpiredLease = async (
    canonicalRoot: string,
    directories: CommandDirectories,
    currentTime: string,
    projectAuthorityV2?: ProjectAuthorityV2
  ): Promise<boolean> => {
    if (projectAuthorityV2 === undefined) return false;
    const authority = await captureDirectoryAuthorityV2(directories.slots);
    const observed = await readLease(canonicalRoot, directories, currentTime);
    if (observed.status === 'absent') return true;
    if (observed.status === 'invalid') throw storageError();
    if (observed.status === 'unsupported_prototype_schema') return false;
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
    return quarantineRemoveIdentifiedRecordV2({
      authority,
      projectAuthority: projectAuthorityV2,
      file: path.join(directories.slots, '0.slot.lease'),
      identity: fresh.identity,
      missingIsSuccess: false,
      isStillAuthorized: async (_phase, file) => {
        const record = await readIdentifiedBytes(canonicalRoot, file);
        if (record === null || record.bytes !== fresh.bytes || !sameIdentity(record.identity, fresh.identity)) {
          return false;
        }
        const parsed = parseLeaseRecord(parseJson(record.bytes), currentTime);
        return (
          parsed.status === 'valid' &&
          sameLease(parsed.record, fresh.lease) &&
          !leaseIsActive(parsed.record, currentTime)
        );
      },
    });
  };

  const readPending = async (projectId: string, commandId: string): Promise<DirectorPendingRead | null> => {
    requireIdentity(projectId, commandId);
    let directories: CommandDirectories | null;
    try {
      directories = await directoriesFor(projectId, false);
    } catch (error) {
      if (isUnsupportedProject(error)) {
        return { status: 'unsupported_prototype_schema', commandId, expectedRevision: null };
      }
      throw error;
    }
    if (directories === null) return null;
    const authoritiesV2 = {
      project: await captureProjectAuthorityV2(projectId, directories),
      pending: await captureDirectoryAuthorityV2(directories.pending),
      slots: await captureDirectoryAuthorityV2(directories.slots),
    };
    const canonicalRoot = await canonicalRootPromise;
    const bytes = await readBytes(canonicalRoot, path.join(directories.pending, `${commandId}.json`));
    if (bytes === null) {
      if (authoritiesV2 !== undefined) {
        await assertDirectoryAuthorityV2(authoritiesV2.pending);
        await assertProjectAuthorityV2(authoritiesV2.project);
      }
      return null;
    }
    const slotBytes = await readBytes(canonicalRoot, path.join(directories.slots, '0.slot'));
    const parsed = parsePendingRecord({
      projectId,
      commandId,
      value: parseJson(bytes),
      slot: slotBytes === null ? null : parseJson(slotBytes),
      now: now(),
      waitMs,
    });
    if (authoritiesV2 !== undefined) {
      await assertDirectoryAuthorityV2(authoritiesV2.pending);
      await assertDirectoryAuthorityV2(authoritiesV2.slots);
      await assertProjectAuthorityV2(authoritiesV2.project);
    }
    return parsed;
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

    async readReceipt(projectId: string, commandId: string): Promise<DirectorReceiptRead | null> {
      requireIdentity(projectId, commandId);
      let directories: CommandDirectories | null;
      try {
        directories = await directoriesFor(projectId, false);
      } catch (error) {
        if (isUnsupportedProject(error)) return { status: 'unsupported_prototype_schema' };
        throw error;
      }
      if (directories === null) return null;
      return exactReceiptFrom(await canonicalRootPromise, directories, projectId, commandId);
    },

    async writeReceipt(projectId: string, receipt: StudioDirectorCommandReceiptV2): Promise<void> {
      requireIdentity(projectId, receipt.commandId);
      const publicationKey = receiptPublicationKey(projectId, receipt.commandId);
      if (indeterminateReceiptPublications.has(publicationKey)) throw storageError();
      const parsed = parseReceiptRecord({ projectId, commandId: receipt.commandId, value: receipt });
      if (
        receipt.projectId !== projectId ||
        parsed.status !== 'valid' ||
        parsed.record.schemaVersion !== STUDIO_DIRECTOR_COMMAND_SCHEMA_VERSION_V2
      ) {
        throw invalidPayload();
      }
      const bytes = JSON.stringify(receipt);
      if (Buffer.byteLength(bytes, 'utf8') > STUDIO_DIRECTOR_COMMAND_MAX_RECORD_BYTES) throw invalidPayload();
      const directories = await directoriesFor(projectId, true);
      if (directories === null) throw storageError();
      let published = false;
      let linkAttempted = false;
      try {
        const projectAuthority = await captureProjectAuthorityV2(projectId, directories);
        const receiptDirectoryAuthority = await captureDirectoryAuthorityV2(directories.receipts);
        const receiptFile = path.join(directories.receipts, `${receipt.commandId}.json`);
        await publishImmutableRecord({
          fs: withExactLinkAuthorityV2(receiptDirectoryAuthority, projectAuthority, receiptFile, undefined, () => {
            linkAttempted = true;
          }),
          canonicalRoot: await canonicalRootPromise,
          file: receiptFile,
          bytes,
        });
        published = true;
        await syncAuthorizedDirectoryV2(receiptDirectoryAuthority, projectAuthority);
      } catch (error) {
        if (published || (linkAttempted && !(error instanceof RecordIoError && error.code === 'already_exists'))) {
          indeterminateReceiptPublications.add(publicationKey);
        }
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
        const receiptFile = path.join(directories.receipts, `${commandId}.json`);
        const directoryAuthoritiesV2 = {
          project: await captureProjectAuthorityV2(projectId, directories),
          pending: await captureDirectoryAuthorityV2(directories.pending),
          slots: await captureDirectoryAuthorityV2(directories.slots),
          receipts: await captureDirectoryAuthorityV2(directories.receipts),
        };
        if (indeterminateReceiptPublications.has(receiptPublicationKey(projectId, commandId))) {
          throw storageError();
        }
        const receiptRecordV2 = await readIdentifiedBytes(canonicalRoot, receiptFile);
        const receipt: DirectorReceiptRead | null =
          receiptRecordV2 === null
            ? null
            : parseReceiptRecord({ projectId, commandId, value: parseJson(receiptRecordV2.bytes) });
        const slot = await readSlot(canonicalRoot, directories, now());
        let pendingRecordV2: Awaited<ReturnType<typeof readIdentifiedBytes>> | undefined;
        let pendingValueV2: unknown;
        let validPendingV2: Extract<DirectorPendingRead, { status: 'valid' }> | undefined;
        let invalidPendingV2: Extract<StudioDirectorCommandParseResultV2, { status: 'invalid' }> | undefined;
        pendingRecordV2 = await readIdentifiedBytes(canonicalRoot, pendingFile);
        if (pendingRecordV2 !== null) {
          pendingValueV2 = parseJson(pendingRecordV2.bytes);
          const pending = parseStudioDirectorPendingRecordV2({
            projectId,
            commandId,
            value: pendingValueV2,
            slot: slot.status === 'absent' ? null : parseJson(slot.bytes),
            now: now(),
            waitMs,
          });
          if (pending.status === 'unsupported_prototype_schema') throw storageError();
          if (pending.status === 'valid') validPendingV2 = pending;
          else invalidPendingV2 = pending;
        }
        if (receipt === null) {
          const attributableSlot =
            (slot.status === 'valid' && slot.slot.commandId === commandId) ||
            (slot.status !== 'absent' && slot.status !== 'valid' && slot.commandId === commandId);
          if ((await pathExists(pendingFile)) || attributableSlot) throw storageError();
          return;
        }
        if (receipt.status !== 'valid') throw storageError();
        const validReceipt = receipt.record;
        const validReceiptV2 =
          validReceipt.schemaVersion === STUDIO_DIRECTOR_COMMAND_SCHEMA_VERSION_V2 ? validReceipt : undefined;
        if (validReceiptV2 === undefined) throw storageError();
        if (
          validPendingV2 !== undefined &&
          validReceiptV2?.expectedRevision !== validPendingV2.record.expectedRevision
        ) {
          throw storageError();
        }
        if (
          validPendingV2 !== undefined &&
          validReceiptV2?.status === 'rejected' &&
          (validReceiptV2.reasonCode === 'malformed_record' || validReceiptV2.reasonCode === 'unsupported_version')
        ) {
          throw storageError();
        }
        if (
          invalidPendingV2 !== undefined &&
          (validReceiptV2?.status !== 'rejected' ||
            validReceiptV2.reasonCode !== invalidPendingV2.reasonCode ||
            validReceiptV2.expectedRevision !== invalidPendingV2.expectedRevision)
        ) {
          throw storageError();
        }
        await syncAuthorizedDirectoryV2(directoryAuthoritiesV2.receipts, directoryAuthoritiesV2.project);
        const receiptAuthorityV2 =
          receiptRecordV2 === null
            ? undefined
            : { authority: directoryAuthoritiesV2.receipts, expected: receiptRecordV2 };
        if (receiptAuthorityV2 === undefined) throw storageError();
        if (slot.status === 'unsupported_prototype_schema') throw storageError();
        if (slot.status === 'valid' && slot.slot.commandId !== commandId) throw storageError();
        if (slot.status === 'invalid' && slot.commandId !== commandId) throw storageError();
        const invalidPendingMatchesSlotV2 = (value: unknown): boolean =>
          slot.status === 'valid' &&
          slot.slot.schemaVersion === STUDIO_DIRECTOR_COMMAND_SCHEMA_VERSION_V2 &&
          isRecord(value) &&
          value.commandId === slot.slot.commandId &&
          value.deadlineAt === slot.slot.deadlineAt;
        if (
          invalidPendingV2 !== undefined &&
          (slot.status !== 'valid' || slot.slot.commandId !== commandId || !invalidPendingMatchesSlotV2(pendingValueV2))
        ) {
          throw storageError();
        }
        let pendingAuthorityExpectationV2: 'observed' | 'absent' =
          pendingRecordV2 !== undefined && pendingRecordV2 !== null ? 'observed' : 'absent';
        let slotAuthorityExpectationV2: 'observed' | 'absent' = slot.status === 'absent' ? 'absent' : 'observed';
        const receiptAuthorityIsCurrentV2 = async (): Promise<boolean> =>
          receiptAuthorityV2 !== undefined &&
          directoryAuthoritiesV2 !== undefined &&
          (await exactReceiptRecordIsCurrentV2({
            canonicalRoot,
            authority: receiptAuthorityV2.authority,
            projectAuthority: directoryAuthoritiesV2.project,
            file: receiptFile,
            projectId,
            commandId,
            expected: receiptAuthorityV2.expected,
          }));
        const pendingParseMatchesAuthorityV2 = (
          pending: StudioDirectorCommandParseResultV2,
          value: unknown
        ): boolean => {
          if (validPendingV2 !== undefined) {
            return (
              pending.status === 'valid' &&
              pending.record.expectedRevision === validPendingV2.record.expectedRevision &&
              pending.record.expectedRevision === validReceiptV2?.expectedRevision
            );
          }
          return (
            invalidPendingV2 !== undefined &&
            pending.status === 'invalid' &&
            pending.commandId === invalidPendingV2.commandId &&
            pending.expectedRevision === invalidPendingV2.expectedRevision &&
            pending.reasonCode === invalidPendingV2.reasonCode &&
            invalidPendingMatchesSlotV2(value) &&
            validReceiptV2?.status === 'rejected' &&
            validReceiptV2.expectedRevision === pending.expectedRevision &&
            validReceiptV2.reasonCode === pending.reasonCode
          );
        };
        const pendingAuthorityIsCurrentV2 = async (): Promise<boolean> => {
          if (directoryAuthoritiesV2 === undefined) return false;
          if (pendingAuthorityExpectationV2 === 'absent') {
            return exactPathIsAbsentV2(directoryAuthoritiesV2.pending, directoryAuthoritiesV2.project, pendingFile);
          }
          if (pendingRecordV2 === undefined || pendingRecordV2 === null) return false;
          await assertProjectAuthorityV2(directoryAuthoritiesV2.project);
          await assertDirectoryAuthorityV2(directoryAuthoritiesV2.pending);
          const current = await readIdentifiedBytes(canonicalRoot, pendingFile);
          if (
            current === null ||
            current.bytes !== pendingRecordV2.bytes ||
            !sameIdentity(current.identity, pendingRecordV2.identity)
          ) {
            return false;
          }
          const value = parseJson(current.bytes);
          const pending = parseStudioDirectorPendingRecordV2({
            projectId,
            commandId,
            value,
            slot: slot.status === 'absent' ? null : parseJson(slot.bytes),
            now: now(),
            waitMs,
          });
          await assertDirectoryAuthorityV2(directoryAuthoritiesV2.pending);
          await assertProjectAuthorityV2(directoryAuthoritiesV2.project);
          return pendingParseMatchesAuthorityV2(pending, value);
        };
        const slotAuthorityIsCurrentV2 = async (): Promise<boolean> => {
          if (directoryAuthoritiesV2 === undefined) return false;
          if (slotAuthorityExpectationV2 === 'absent') {
            return exactPathIsAbsentV2(directoryAuthoritiesV2.slots, directoryAuthoritiesV2.project, slotFile);
          }
          await assertProjectAuthorityV2(directoryAuthoritiesV2.project);
          await assertDirectoryAuthorityV2(directoryAuthoritiesV2.slots);
          const current = await readSlot(canonicalRoot, directories, now());
          await assertDirectoryAuthorityV2(directoryAuthoritiesV2.slots);
          await assertProjectAuthorityV2(directoryAuthoritiesV2.project);
          return sameSlotRead(slot, current);
        };
        const terminalAuthorityIsCurrentV2 = async (): Promise<boolean> =>
          (await receiptAuthorityIsCurrentV2()) &&
          (await pendingAuthorityIsCurrentV2()) &&
          (await slotAuthorityIsCurrentV2()) &&
          (await receiptAuthorityIsCurrentV2());
        let held: Extract<LeaseRead, { status: 'valid' }> | undefined;
        let preserveHeldLease = false;
        try {
          held =
            (await acquireMainLease(canonicalRoot, directories, slot, now(), directoryAuthoritiesV2?.project)) ??
            undefined;
          if (held === undefined) throw storageError();
          if (!leaseIsActive(held.lease, now())) throw storageError();
          const leaseAuthorityIsCurrentV2 = async (): Promise<boolean> =>
            directoryAuthoritiesV2 !== undefined &&
            (await heldLeaseIsExactAndActiveV2(
              canonicalRoot,
              directories,
              held,
              directoryAuthoritiesV2.slots,
              directoryAuthoritiesV2.project
            ));
          const leaseReceiptAuthorityIsCurrentV2 = async (): Promise<boolean> =>
            (await leaseAuthorityIsCurrentV2()) &&
            (await receiptAuthorityIsCurrentV2()) &&
            (await leaseAuthorityIsCurrentV2());
          const pendingCleanupAuthorityIsCurrentV2 = async (): Promise<boolean> =>
            (await leaseReceiptAuthorityIsCurrentV2()) &&
            (await slotAuthorityIsCurrentV2()) &&
            (await leaseReceiptAuthorityIsCurrentV2());
          const slotCleanupAuthorityIsCurrentV2 = async (): Promise<boolean> =>
            (await leaseReceiptAuthorityIsCurrentV2()) &&
            (await pendingAuthorityIsCurrentV2()) &&
            (await leaseReceiptAuthorityIsCurrentV2());
          const freshSlot = await readSlot(canonicalRoot, directories, now());
          if (!sameSlotRead(slot, freshSlot)) throw storageError();
          if (!(await terminalAuthorityIsCurrentV2())) throw storageError();

          if (pendingRecordV2 !== undefined && pendingRecordV2 !== null && directoryAuthoritiesV2 !== undefined) {
            const removed = await quarantineRemoveIdentifiedRecordV2({
              authority: directoryAuthoritiesV2.pending,
              projectAuthority: directoryAuthoritiesV2.project,
              file: pendingFile,
              identity: pendingRecordV2.identity,
              missingIsSuccess: invalidPendingV2 === undefined,
              isStillAuthorized: async (_phase, file) => {
                if (!(await pendingCleanupAuthorityIsCurrentV2())) return false;
                const record = await readIdentifiedBytes(canonicalRoot, file);
                if (
                  record === null ||
                  record.bytes !== pendingRecordV2.bytes ||
                  !sameIdentity(record.identity, pendingRecordV2.identity)
                ) {
                  return false;
                }
                const value = parseJson(record.bytes);
                const pending = parseStudioDirectorPendingRecordV2({
                  projectId,
                  commandId,
                  value,
                  slot: freshSlot.status === 'absent' ? null : parseJson(freshSlot.bytes),
                  now: now(),
                  waitMs,
                });
                return pendingParseMatchesAuthorityV2(pending, value) && (await pendingCleanupAuthorityIsCurrentV2());
              },
            });
            if (!removed) {
              preserveHeldLease = true;
              throw storageError();
            }
            pendingAuthorityExpectationV2 = 'absent';
          }
          if (!leaseIsActive(held.lease, now())) throw storageError();
          if (freshSlot.status !== 'absent') {
            const removed = await quarantineRemoveIdentifiedRecordV2({
              authority: directoryAuthoritiesV2.slots,
              projectAuthority: directoryAuthoritiesV2.project,
              file: slotFile,
              identity: freshSlot.identity,
              missingIsSuccess: invalidPendingV2 === undefined,
              isStillAuthorized: async (_phase, file) => {
                if (!(await slotCleanupAuthorityIsCurrentV2())) return false;
                const record = await readIdentifiedBytes(canonicalRoot, file);
                return (
                  record !== null &&
                  record.bytes === freshSlot.bytes &&
                  sameIdentity(record.identity, freshSlot.identity) &&
                  (await slotCleanupAuthorityIsCurrentV2())
                );
              },
            });
            if (!removed) {
              preserveHeldLease = true;
              throw storageError();
            }
            slotAuthorityExpectationV2 = 'absent';
          }
          if (!leaseIsActive(held.lease, now())) throw storageError();
          if (
            !(await releaseMainLease(
              canonicalRoot,
              directories,
              held,
              directoryAuthoritiesV2?.project,
              terminalAuthorityIsCurrentV2
            ))
          ) {
            preserveHeldLease = true;
            throw storageError();
          }
          held = undefined;

          if (directoryAuthoritiesV2 !== undefined) {
            await assertProjectAuthorityV2(directoryAuthoritiesV2.project);
          }
          if (await pathExists(pendingFile)) throw storageError();
          const finalSlot = await readSlot(canonicalRoot, directories, now());
          if (directoryAuthoritiesV2 !== undefined) {
            await assertProjectAuthorityV2(directoryAuthoritiesV2.project);
          }
          if (
            finalSlot.status !== 'absent' &&
            !(finalSlot.status === 'valid' && finalSlot.slot.commandId !== commandId)
          ) {
            throw storageError();
          }
        } catch (error) {
          if (held !== undefined && !preserveHeldLease) {
            await releaseMainLease(
              canonicalRoot,
              directories,
              held,
              directoryAuthoritiesV2?.project,
              terminalAuthorityIsCurrentV2
            ).catch((): undefined => undefined);
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
            const projectAuthorityV2 = await captureProjectAuthorityV2(projectId, directories);
            const preReclaimSlot = await readSlot(canonicalRoot, directories, currentTime);
            if (preReclaimSlot.status === 'unsupported_prototype_schema') return;
            if (preReclaimSlot.status !== 'absent') {
              const commandId =
                preReclaimSlot.status === 'valid' ? preReclaimSlot.slot.commandId : preReclaimSlot.commandId;
              if (commandId !== null) {
                const pending = await readPending(projectId, commandId);
                if (pending?.status === 'unsupported_prototype_schema') return;
              }
            }
            if (!(await reclaimExpiredLease(canonicalRoot, directories, currentTime, projectAuthorityV2))) return;

            const orphanAuthoritiesV2 = {
              project: projectAuthorityV2,
              pending: await captureDirectoryAuthorityV2(directories.pending),
              slots: await captureDirectoryAuthorityV2(directories.slots),
              receipts: await captureDirectoryAuthorityV2(directories.receipts),
            };
            const observedSlot = await readSlot(canonicalRoot, directories, currentTime);
            if (observedSlot.status === 'absent') return;
            if (observedSlot.status === 'unsupported_prototype_schema') return;
            let receiptProofV2:
              | {
                  file: string;
                  expected: NonNullable<Awaited<ReturnType<typeof readIdentifiedBytes>>>;
                  commandId: string;
                }
              | undefined;
            let held: Extract<LeaseRead, { status: 'valid' }> | undefined;
            let preserveHeldLease = false;
            try {
              held =
                (await acquireMainLease(canonicalRoot, directories, observedSlot, now(), projectAuthorityV2)) ??
                undefined;
              if (held === undefined) return;
              if (!leaseIsActive(held.lease, now())) return;
              const slotRead = await readSlot(canonicalRoot, directories, currentTime);
              if (!sameSlotRead(observedSlot, slotRead)) {
                await releaseMainLease(canonicalRoot, directories, held, projectAuthorityV2);
                held = undefined;
                return;
              }
              if (slotRead.status === 'absent') {
                await releaseMainLease(canonicalRoot, directories, held, projectAuthorityV2);
                held = undefined;
                return;
              }
              if (slotRead.status === 'unsupported_prototype_schema') {
                await releaseMainLease(canonicalRoot, directories, held, projectAuthorityV2);
                held = undefined;
                return;
              }
              if (slotRead.status === 'invalid') {
                if (slotRead.commandId === null) throw storageError();
                const pendingFile = path.join(directories.pending, `${slotRead.commandId}.json`);
                const pendingExists = !(await exactPathIsAbsentV2(
                  orphanAuthoritiesV2.pending,
                  orphanAuthoritiesV2.project,
                  pendingFile
                ));
                if (pendingExists) {
                  await releaseMainLease(canonicalRoot, directories, held, projectAuthorityV2);
                  held = undefined;
                  return;
                }
              } else {
                const { slot } = slotRead;
                const pendingFile = path.join(directories.pending, `${slot.commandId}.json`);
                const pendingExists = !(await exactPathIsAbsentV2(
                  orphanAuthoritiesV2.pending,
                  orphanAuthoritiesV2.project,
                  pendingFile
                ));
                if (pendingExists) {
                  await releaseMainLease(canonicalRoot, directories, held, projectAuthorityV2);
                  held = undefined;
                  return;
                }
                const deadlineMs = canonicalTimestamp(slot.deadlineAt);
                if (deadlineMs === null) throw storageError();
                if (deadlineMs >= nowMs) {
                  let receiptIsValid = false;
                  if (!indeterminateReceiptPublications.has(receiptPublicationKey(projectId, slot.commandId))) {
                    const receiptFile = path.join(directories.receipts, `${slot.commandId}.json`);
                    const receiptRecord = await readIdentifiedBytes(canonicalRoot, receiptFile);
                    if (receiptRecord !== null) {
                      const parsed = parseReceiptRecord({
                        projectId,
                        commandId: slot.commandId,
                        value: parseJson(receiptRecord.bytes),
                      });
                      if (parsed.status === 'valid') {
                        await syncAuthorizedDirectoryV2(orphanAuthoritiesV2.receipts, orphanAuthoritiesV2.project);
                        receiptProofV2 = { file: receiptFile, expected: receiptRecord, commandId: slot.commandId };
                        receiptIsValid = true;
                      }
                    }
                  }
                  if (!receiptIsValid) {
                    await releaseMainLease(canonicalRoot, directories, held, projectAuthorityV2);
                    held = undefined;
                    return;
                  }
                }
              }

              if (!leaseIsActive(held.lease, now())) return;
              const orphanCleanupAuthorityIsCurrentV2 = async (): Promise<boolean> => {
                if (orphanAuthoritiesV2 === undefined) return false;
                if (
                  !(await heldLeaseIsExactAndActiveV2(
                    canonicalRoot,
                    directories,
                    held,
                    orphanAuthoritiesV2.slots,
                    orphanAuthoritiesV2.project
                  ))
                ) {
                  return false;
                }
                const commandId = slotRead.status === 'valid' ? slotRead.slot.commandId : slotRead.commandId;
                if (
                  commandId === null ||
                  !(await exactPathIsAbsentV2(
                    orphanAuthoritiesV2.pending,
                    orphanAuthoritiesV2.project,
                    path.join(directories.pending, `${commandId}.json`)
                  ))
                ) {
                  return false;
                }
                if (
                  receiptProofV2 !== undefined &&
                  !(await exactReceiptRecordIsCurrentV2({
                    canonicalRoot,
                    authority: orphanAuthoritiesV2.receipts,
                    projectAuthority: orphanAuthoritiesV2.project,
                    file: receiptProofV2.file,
                    projectId,
                    commandId: receiptProofV2.commandId,
                    expected: receiptProofV2.expected,
                  }))
                ) {
                  return false;
                }
                return heldLeaseIsExactAndActiveV2(
                  canonicalRoot,
                  directories,
                  held,
                  orphanAuthoritiesV2.slots,
                  orphanAuthoritiesV2.project
                );
              };
              const removed = await quarantineRemoveIdentifiedRecordV2({
                authority: orphanAuthoritiesV2.slots,
                projectAuthority: orphanAuthoritiesV2.project,
                file: path.join(directories.slots, '0.slot'),
                identity: slotRead.identity,
                missingIsSuccess: false,
                isStillAuthorized: async (_phase, file) => {
                  if (!(await orphanCleanupAuthorityIsCurrentV2())) return false;
                  const record = await readIdentifiedBytes(canonicalRoot, file);
                  return (
                    record !== null &&
                    record.bytes === slotRead.bytes &&
                    sameIdentity(record.identity, slotRead.identity) &&
                    (await orphanCleanupAuthorityIsCurrentV2())
                  );
                },
              });
              if (!removed) {
                preserveHeldLease = true;
                throw storageError();
              }
              if (leaseIsActive(held.lease, now())) {
                if (!(await releaseMainLease(canonicalRoot, directories, held, projectAuthorityV2))) {
                  preserveHeldLease = true;
                  throw storageError();
                }
                held = undefined;
              }
            } catch (error) {
              if (held !== undefined && !preserveHeldLease && leaseIsActive(held.lease, now())) {
                await releaseMainLease(canonicalRoot, directories, held, projectAuthorityV2).catch(
                  (): undefined => undefined
                );
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
          const authorities = {
            // eslint-disable-next-line no-await-in-loop
            project: await captureProjectAuthorityV2(ref.projectId, directories),
            // eslint-disable-next-line no-await-in-loop
            pending: await captureDirectoryAuthorityV2(directories.pending),
            // eslint-disable-next-line no-await-in-loop
            slots: await captureDirectoryAuthorityV2(directories.slots),
            // eslint-disable-next-line no-await-in-loop
            receipts: await captureDirectoryAuthorityV2(directories.receipts),
          };
          const receiptFile = path.join(directories.receipts, `${ref.commandId}.json`);
          if (indeterminateReceiptPublications.has(receiptPublicationKey(ref.projectId, ref.commandId))) continue;
          // eslint-disable-next-line no-await-in-loop
          const receiptRecord = await readIdentifiedBytes(canonicalRoot, receiptFile);
          if (receiptRecord === null) continue;
          const receipt = parseReceiptRecord({
            projectId: ref.projectId,
            commandId: ref.commandId,
            value: parseJson(receiptRecord.bytes),
          });
          if (receipt.status !== 'valid' || Date.parse(receipt.record.decidedAt) >= cutoffMs) continue;
          // A guard-free receipt that survived a restart becomes cleanup authority only after
          // the exact receipt-directory generation is durably synchronized.
          // eslint-disable-next-line no-await-in-loop
          await syncAuthorizedDirectoryV2(authorities.receipts, authorities.project);
          const pendingFile = path.join(directories.pending, `${ref.commandId}.json`);
          // eslint-disable-next-line no-await-in-loop
          if (!(await exactPathIsAbsentV2(authorities.pending, authorities.project, pendingFile))) continue;
          // eslint-disable-next-line no-await-in-loop
          const slot = await readSlot(canonicalRoot, directories, now());
          await assertDirectoryAuthorityV2(authorities.slots);
          if (slot.status === 'invalid' || slot.status === 'unsupported_prototype_schema') throw storageError();
          if (slot.status === 'valid' && slot.slot.commandId === ref.commandId) continue;
          // eslint-disable-next-line no-await-in-loop
          const removed = await quarantineRemoveIdentifiedRecordV2({
            authority: authorities.receipts,
            projectAuthority: authorities.project,
            file: receiptFile,
            identity: receiptRecord.identity,
            missingIsSuccess: true,
            isStillAuthorized: async (_phase, file) => {
              const current = await readIdentifiedBytes(canonicalRoot, file);
              if (
                current === null ||
                current.bytes !== receiptRecord.bytes ||
                !sameIdentity(current.identity, receiptRecord.identity)
              ) {
                return false;
              }
              const parsed = parseReceiptRecord({
                projectId: ref.projectId,
                commandId: ref.commandId,
                value: parseJson(current.bytes),
              });
              if (
                parsed.status !== 'valid' ||
                Date.parse(parsed.record.decidedAt) >= cutoffMs ||
                !(await exactPathIsAbsentV2(authorities.pending, authorities.project, pendingFile))
              ) {
                return false;
              }
              await assertDirectoryAuthorityV2(authorities.slots);
              const currentSlot = await readSlot(canonicalRoot, directories, now());
              await assertDirectoryAuthorityV2(authorities.slots);
              return (
                currentSlot.status !== 'invalid' &&
                currentSlot.status !== 'unsupported_prototype_schema' &&
                !(currentSlot.status === 'valid' && currentSlot.slot.commandId === ref.commandId)
              );
            },
          });
          if (!removed) throw storageError();
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
      const forwardSupportedChange = (projectId: string, commandId?: string): void => {
        void deps
          .getVerifiedProjectDirectory(projectId)
          .then((projectDirectory) => {
            if (!closed && projectDirectory !== null) trigger(projectId, commandId);
          })
          .catch((error: unknown) => {
            if (!closed && !isUnsupportedProject(error)) {
              safeLog('[CreativeStudio] Director command watcher skipped unsafe project');
            }
          });
      };
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
              forwardSupportedChange(segments[0], undefined);
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
            if (isSafeStudioDirectorId(commandId)) forwardSupportedChange(segments[0], commandId);
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

/** Creates the schema-2 Director command mailbox. */
export const createStudioDirectorCommandMailboxV2 = (
  deps: StudioDirectorCommandMailboxDepsV2
): StudioDirectorCommandMailboxV2 =>
  createStudioDirectorCommandMailboxInternal({
    ...deps,
    getVerifiedProjectDirectory: deps.store.getVerifiedProjectDirectoryV2,
  });
