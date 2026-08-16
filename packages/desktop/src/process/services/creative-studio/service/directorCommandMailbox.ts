/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { promises as nodeFs } from 'node:fs';
import { watch as watchFileSystem } from 'node:fs';
import path from 'node:path';
import {
  STUDIO_DIRECTOR_COMMAND_MAX_RECORD_BYTES,
  STUDIO_DIRECTOR_COMMAND_MAX_SWEEP_RECORDS,
  STUDIO_DIRECTOR_COMMAND_WAIT_MS,
  type StudioDirectorCommandReceiptV1,
} from '@/common/types/project/creativeStudioTypes';
import {
  parseStudioDirectorCommandReceipt,
  parseStudioDirectorCommandSlot,
  parseStudioDirectorPendingRecord,
  isSafeStudioDirectorId,
  type StudioDirectorCommandParseResult,
} from './directorCommandContracts';
import {
  canonicalizeRecordRoot,
  publishImmutableRecord,
  readBoundedRegularFile,
  RecordIoError,
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
};

type CommandDirectories = {
  root: string;
  pending: string;
  slots: string;
  receipts: string;
};

type WatchCommandTree = (input: {
  rootDir: string;
  onChange(relativeFile: string): void;
  onError(error: Error): void;
}) => { close(): void };

export type StudioDirectorCommandMailboxDeps = {
  rootDir: string;
  store: Pick<CreativeStudioStore, 'getVerifiedProjectDirectory' | 'listProjects'>;
  now?: () => string;
  waitMs?: number;
  fs?: RecordIoFileSystem;
  logError?: (message: string, error: unknown) => void;
  watchCommandTree?: WatchCommandTree;
};

const COMMAND_CHILDREN = ['pending', 'slots', 'receipts'] as const;

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

const refCursor = (ref: StudioDirectorCommandRef): string => `${ref.projectId}\u0000${ref.commandId}`;

const compareCodeUnits = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0);

const pageRefs = (
  refs: StudioDirectorCommandRef[],
  cursor: string | null,
  limit: number
): StudioDirectorCommandPage => {
  const available = cursor === null ? refs : refs.filter((ref) => refCursor(ref) > cursor);
  const items = available.slice(0, limit);
  return {
    items,
    nextCursor: available.length > items.length && items.length > 0 ? refCursor(items.at(-1)!) : null,
  };
};

/** Creates the main-process mailbox without publishing or consuming a command. */
export const createStudioDirectorCommandMailbox = (
  deps: StudioDirectorCommandMailboxDeps
): StudioDirectorCommandMailbox => {
  const fs = deps.fs ?? nodeFs;
  const now = deps.now ?? (() => new Date().toISOString());
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

  const parseJson = (bytes: string): unknown => {
    try {
      return JSON.parse(bytes) as unknown;
    } catch {
      return null;
    }
  };

  const listProjectIds = async (): Promise<string[]> =>
    (await deps.store.listProjects()).map((project) => project.id).toSorted();

  const readDirectoryEntries = async (directory: string): Promise<import('node:fs').Dirent[]> => {
    try {
      return await fs.readdir(directory, { withFileTypes: true });
    } catch {
      throw storageError();
    }
  };

  const listPendingRefs = async (): Promise<StudioDirectorCommandRef[]> => {
    const refs: StudioDirectorCommandRef[] = [];
    for (const projectId of await listProjectIds()) {
      // Pagination takes a deterministic snapshot of every safe filename, including unsafe file types.
      // eslint-disable-next-line no-await-in-loop
      const directories = await directoriesFor(projectId, false);
      if (directories === null) continue;
      // eslint-disable-next-line no-await-in-loop
      const entries = await readDirectoryEntries(directories.pending);
      for (const entry of entries) {
        if (!entry.name.endsWith('.json')) continue;
        const commandId = entry.name.slice(0, -'.json'.length);
        if (isSafeStudioDirectorId(commandId)) refs.push({ projectId, commandId });
      }
    }
    return refs.toSorted((left, right) => compareCodeUnits(refCursor(left), refCursor(right)));
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

  const maintenanceProjectPage = async (
    cursor: string | null,
    limit: number
  ): Promise<{ projectIds: string[]; nextCursor: string | null }> => {
    requireLimit(limit);
    const all = await listProjectIds();
    const available = cursor === null ? all : all.filter((projectId) => projectId > cursor);
    const projectIds = available.slice(0, limit);
    return {
      projectIds,
      nextCursor: available.length > projectIds.length && projectIds.length > 0 ? projectIds.at(-1)! : null,
    };
  };

  const readSlot = async (
    canonicalRoot: string,
    directories: CommandDirectories
  ): Promise<ReturnType<typeof parseStudioDirectorCommandSlot>> => {
    const bytes = await readBytes(canonicalRoot, path.join(directories.slots, '0.slot'));
    if (bytes === null) return null;
    const slot = parseStudioDirectorCommandSlot(parseJson(bytes));
    if (slot === null) throw storageError();
    return slot;
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
      requireLimit(limit);
      return pageRefs(await listPendingRefs(), cursor, limit);
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
      const directories = await directoriesFor(projectId, false);
      if (directories === null) return;
      const canonicalRoot = await canonicalRootPromise;
      if ((await exactReceiptFrom(canonicalRoot, directories, projectId, commandId)) === null) return;
      const slot = await readSlot(canonicalRoot, directories);
      if (slot !== null && slot.commandId !== commandId) return;
      await removeRecord(canonicalRoot, path.join(directories.pending, `${commandId}.json`));
      if (slot !== null) await removeRecord(canonicalRoot, path.join(directories.slots, '0.slot'));
    },

    async listPendingPage(cursor: string | null, limit: number): Promise<StudioDirectorCommandPage> {
      requireLimit(limit);
      return pageRefs(await listPendingRefs(), cursor, limit);
    },

    async releaseOrphanedSlotsPage(
      cursor: string | null,
      currentTime: string,
      limit: number
    ): Promise<StudioDirectorMaintenancePage> {
      const nowMs = canonicalTimestamp(currentTime);
      if (nowMs === null) throw invalidPayload();
      const page = await maintenanceProjectPage(cursor, limit);
      const canonicalRoot = await canonicalRootPromise;
      for (const projectId of page.projectIds) {
        try {
          // A failing project advances the cursor but cannot weaken another project's authority.
          // eslint-disable-next-line no-await-in-loop
          const directories = await directoriesFor(projectId, false);
          if (directories === null) continue;
          // eslint-disable-next-line no-await-in-loop
          const slot = await readSlot(canonicalRoot, directories);
          if (slot === null) continue;
          // eslint-disable-next-line no-await-in-loop
          if (await pathExists(path.join(directories.pending, `${slot.commandId}.json`))) continue;
          // eslint-disable-next-line no-await-in-loop
          const deadlineMs = canonicalTimestamp(slot.deadlineAt);
          if (deadlineMs === null) continue;
          if (deadlineMs >= nowMs) {
            // A live slot is releasable only with its exact durable terminal receipt.
            // eslint-disable-next-line no-await-in-loop
            if ((await exactReceiptFrom(canonicalRoot, directories, projectId, slot.commandId)) === null) continue;
          }
          // eslint-disable-next-line no-await-in-loop
          await removeRecord(canonicalRoot, path.join(directories.slots, '0.slot'));
        } catch {
          safeLog('[CreativeStudio] Director command slot maintenance skipped unsafe storage');
        }
      }
      return { processed: page.projectIds.length, nextCursor: page.nextCursor };
    },

    async pruneReceiptsPage(
      cursor: string | null,
      decidedBefore: string,
      limit: number
    ): Promise<StudioDirectorMaintenancePage> {
      requireLimit(limit);
      const cutoffMs = canonicalTimestamp(decidedBefore);
      if (cutoffMs === null) throw invalidPayload();
      const refs: StudioDirectorCommandRef[] = [];
      for (const projectId of await listProjectIds()) {
        try {
          // eslint-disable-next-line no-await-in-loop
          const directories = await directoriesFor(projectId, false);
          if (directories === null) continue;
          // eslint-disable-next-line no-await-in-loop
          const entries = await readDirectoryEntries(directories.receipts);
          for (const entry of entries) {
            if (!entry.name.endsWith('.json')) continue;
            const commandId = entry.name.slice(0, -'.json'.length);
            if (isSafeStudioDirectorId(commandId)) refs.push({ projectId, commandId });
          }
        } catch {
          safeLog('[CreativeStudio] Director command receipt maintenance skipped unsafe storage');
        }
      }
      refs.sort((left, right) => compareCodeUnits(refCursor(left), refCursor(right)));
      const page = pageRefs(refs, cursor, limit);
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
          const slot = await readSlot(canonicalRoot, directories);
          if (slot?.commandId === ref.commandId) continue;
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
  };
};
