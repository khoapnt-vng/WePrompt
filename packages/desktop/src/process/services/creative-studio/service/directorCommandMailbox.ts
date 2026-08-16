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

type LedgerDirectory = 'pending' | 'receipts';

type LedgerCursor = {
  projectId: string;
  /** null means the project was fully inspected. */
  entryName: string | null;
};

type SlotRead =
  | { status: 'absent' }
  | { status: 'valid'; slot: NonNullable<ReturnType<typeof parseStudioDirectorCommandSlot>> }
  | { status: 'invalid'; commandId: string | null };

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

const compareCodeUnits = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0);

const encodeLedgerCursor = (cursor: LedgerCursor): string =>
  `v1.${Buffer.from(JSON.stringify([cursor.projectId, cursor.entryName]), 'utf8').toString('base64url')}`;

const decodeLedgerCursor = (cursor: string | null): LedgerCursor | null => {
  if (cursor === null) return null;
  if (cursor.length > 2_048 || !cursor.startsWith('v1.')) throw invalidPayload();
  const encoded = cursor.slice(3);
  if (!/^[A-Za-z0-9_-]+$/.test(encoded)) throw invalidPayload();
  try {
    const bytes = Buffer.from(encoded, 'base64url');
    if (bytes.toString('base64url') !== encoded) throw invalidPayload();
    const value = JSON.parse(bytes.toString('utf8')) as unknown;
    if (!Array.isArray(value) || value.length !== 2 || !isSafeStudioDirectorId(value[0])) throw invalidPayload();
    const entryName = value[1];
    if (
      entryName !== null &&
      (typeof entryName !== 'string' ||
        entryName.length === 0 ||
        entryName.length > 1_024 ||
        entryName.includes('\u0000'))
    ) {
      throw invalidPayload();
    }
    return { projectId: value[0], entryName };
  } catch (error) {
    if (error instanceof CreativeStudioStoreError) throw error;
    throw invalidPayload();
  }
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

  const scanLedgerPage = async (input: {
    cursor: string | null;
    limit: number;
    directory: LedgerDirectory;
    tolerateProjectErrors: boolean;
  }): Promise<StudioDirectorCommandPage> => {
    requireLimit(input.limit);
    const cursor = decodeLedgerCursor(input.cursor);
    const projectIds = await listProjectIds();
    let startIndex = 0;
    if (cursor !== null) {
      startIndex = projectIds.findIndex((projectId) => projectId >= cursor.projectId);
      if (startIndex < 0) return { items: [], nextCursor: null };
      if (projectIds[startIndex] === cursor.projectId && cursor.entryName === null) startIndex += 1;
    }

    const collected: Array<{ ref: StudioDirectorCommandRef; cursor: LedgerCursor }> = [];
    const workLimit = input.limit + 1;
    let inspectedDirectories = 0;
    let inspectedEntries = 0;
    let lastProgress: LedgerCursor | null = cursor;

    const boundedPage = (): StudioDirectorCommandPage => ({
      items: collected.slice(0, input.limit).map((item) => item.ref),
      nextCursor: lastProgress === null ? null : encodeLedgerCursor(lastProgress),
    });

    for (let projectIndex = startIndex; projectIndex < projectIds.length; projectIndex += 1) {
      if (inspectedDirectories >= workLimit) return boundedPage();
      const projectId = projectIds[projectIndex];
      inspectedDirectories += 1;
      let directories: CommandDirectories | null;
      try {
        // eslint-disable-next-line no-await-in-loop
        directories = await directoriesFor(projectId, false);
      } catch (error) {
        if (!input.tolerateProjectErrors) throw error;
        safeLog('[CreativeStudio] Director command receipt maintenance skipped unsafe storage');
        lastProgress = { projectId, entryName: null };
        continue;
      }
      if (directories === null) {
        lastProgress = { projectId, entryName: null };
        continue;
      }

      let entries: import('node:fs').Dirent[];
      try {
        // eslint-disable-next-line no-await-in-loop
        entries = (await readDirectoryEntries(directories[input.directory])).toSorted((left, right) =>
          compareCodeUnits(left.name, right.name)
        );
      } catch (error) {
        if (!input.tolerateProjectErrors) throw error;
        safeLog('[CreativeStudio] Director command receipt maintenance skipped unsafe storage');
        lastProgress = { projectId, entryName: null };
        continue;
      }

      const afterEntry = cursor?.projectId === projectId ? cursor.entryName : null;
      for (const entry of entries) {
        if (afterEntry !== null && compareCodeUnits(entry.name, afterEntry) <= 0) continue;
        if (inspectedEntries >= workLimit) return boundedPage();
        inspectedEntries += 1;
        lastProgress = { projectId, entryName: entry.name };
        if (!entry.name.endsWith('.json')) continue;
        const commandId = entry.name.slice(0, -'.json'.length);
        if (!isSafeStudioDirectorId(commandId)) continue;
        collected.push({ ref: { projectId, commandId }, cursor: lastProgress });
        if (collected.length > input.limit) {
          const lastReturned = collected[input.limit - 1];
          return {
            items: collected.slice(0, input.limit).map((item) => item.ref),
            nextCursor: encodeLedgerCursor(lastReturned.cursor),
          };
        }
      }
      lastProgress = { projectId, entryName: null };
    }

    return { items: collected.map((item) => item.ref), nextCursor: null };
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
    directories: CommandDirectories,
    currentTime: string
  ): Promise<SlotRead> => {
    const bytes = await readBytes(canonicalRoot, path.join(directories.slots, '0.slot'));
    if (bytes === null) return { status: 'absent' };
    const value = parseJson(bytes);
    const slot = parseStudioDirectorCommandSlot(value, currentTime, waitMs);
    if (slot !== null) return { status: 'valid', slot };
    return {
      status: 'invalid',
      commandId: isRecord(value) && isSafeStudioDirectorId(value.commandId) ? value.commandId : null,
    };
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
      return scanLedgerPage({ cursor, limit, directory: 'pending', tolerateProjectErrors: false });
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
      const slot = await readSlot(canonicalRoot, directories, now());
      if (slot.status === 'invalid') throw storageError();
      if (slot.status === 'valid' && slot.slot.commandId !== commandId) return;
      await removeRecord(canonicalRoot, path.join(directories.pending, `${commandId}.json`));
      if (slot.status === 'valid') await removeRecord(canonicalRoot, path.join(directories.slots, '0.slot'));
    },

    async listPendingPage(cursor: string | null, limit: number): Promise<StudioDirectorCommandPage> {
      return scanLedgerPage({ cursor, limit, directory: 'pending', tolerateProjectErrors: false });
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
          const slotRead = await readSlot(canonicalRoot, directories, currentTime);
          if (slotRead.status === 'absent') continue;
          if (slotRead.status === 'invalid') {
            if (slotRead.commandId === null) throw storageError();
            // eslint-disable-next-line no-await-in-loop
            if (await pathExists(path.join(directories.pending, `${slotRead.commandId}.json`))) continue;
            // A bounded invalid reservation cannot remain live authority once its pending record is absent.
            // eslint-disable-next-line no-await-in-loop
            await removeRecord(canonicalRoot, path.join(directories.slots, '0.slot'));
            continue;
          }
          const { slot } = slotRead;
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
      const cutoffMs = canonicalTimestamp(decidedBefore);
      if (cutoffMs === null) throw invalidPayload();
      const page = await scanLedgerPage({ cursor, limit, directory: 'receipts', tolerateProjectErrors: true });
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
  };
};
