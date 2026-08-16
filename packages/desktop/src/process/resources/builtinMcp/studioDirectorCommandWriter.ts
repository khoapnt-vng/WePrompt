/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomUUID } from 'node:crypto';
import { constants as fsConstants, promises as nodeFs } from 'node:fs';
import path from 'node:path';
import {
  STUDIO_DIRECTOR_COMMAND_MAX_RECORD_BYTES,
  STUDIO_DIRECTOR_COMMAND_SCHEMA_VERSION,
  STUDIO_DIRECTOR_COMMAND_SWEEP_INTERVAL_MS,
  STUDIO_DIRECTOR_COMMAND_WAIT_MS,
  type StudioDirectorCommandReceiptV1,
  type StudioDirectorCommandRecordV1,
  type StudioDirectorCommandSlotV1,
  type StudioDirectorNewSceneV1,
  type StudioDirectorOperationV1,
} from '@/common/types/project/creativeStudioTypes';
import {
  isSafeStudioDirectorId,
  parseStudioDirectorCommandReceipt,
  parseStudioDirectorCommandSlot,
  parseStudioDirectorPendingRecord,
} from '@process/services/creative-studio/service/directorCommandContracts';
import {
  RecordIoError,
  type RecordIoFileSystem,
  publishImmutableRecord,
  readBoundedRegularFile,
  resolveCompleteDirectorySet,
} from '@process/services/creative-studio/service/recordIo';

export type StudioDirectorToolOperationV1 =
  | Exclude<StudioDirectorOperationV1, { kind: 'add_scene' }>
  | {
      kind: 'add_scene';
      scene: StudioDirectorNewSceneV1;
      beforeSceneId: string | null;
    };

export type StudioApplyEditsInput = {
  expectedRevision: number;
  operations: StudioDirectorToolOperationV1[];
};

export type StudioGetCommandStatusInput = { commandId: string };

export type StudioDirectorToolApplyResult =
  | StudioDirectorCommandReceiptV1
  | { status: 'busy' | 'unconfirmed' | 'storage_error'; commandId: string };

export type StudioDirectorToolStatusResult =
  | StudioDirectorCommandReceiptV1
  | { status: 'pending' | 'not_found' | 'storage_error'; commandId: string };

export type StudioDirectorCommandWriterConfig = {
  projectId: string;
  projectDir: string;
};

export type StudioDirectorCommandWriterDeps = {
  fs?: RecordIoFileSystem;
  now?: () => number;
  createId?: () => string;
  sleep?: (milliseconds: number) => Promise<void>;
};

export type StudioDirectorCommandWriter = {
  apply(input: StudioApplyEditsInput): Promise<StudioDirectorToolApplyResult>;
  getStatus(input: StudioGetCommandStatusInput): Promise<StudioDirectorToolStatusResult>;
};

type CommandDirectories = {
  canonicalRoot: string;
  pending: string;
  slots: string;
  receipts: string;
};

type PreparedCommand = {
  command: StudioDirectorCommandRecordV1;
  slot: StudioDirectorCommandSlotV1;
  commandBytes: string;
  slotBytes: string;
};

type ErrorRecord = { code?: unknown };

type GuardedRecord = {
  value: unknown;
  dev: number;
  ino: number;
};

const defaultSleep = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const storageError = (commandId: string): { status: 'storage_error'; commandId: string } => ({
  status: 'storage_error',
  commandId,
});

const safeOutcomeId = (candidate: string): string => (isSafeStudioDirectorId(candidate) ? candidate : 'unavailable');

const hasErrorCode = (error: unknown, code: string): boolean =>
  typeof error === 'object' && error !== null && !Array.isArray(error) && (error as ErrorRecord).code === code;

const parseJson = (bytes: string): unknown => {
  try {
    return JSON.parse(bytes) as unknown;
  } catch {
    throw new RecordIoError('storage_error');
  }
};

const resolveCommandDirectories = async (
  fs: RecordIoFileSystem,
  config: StudioDirectorCommandWriterConfig
): Promise<CommandDirectories> => {
  const configuredProjectDir = path.resolve(config.projectDir);
  try {
    const stats = await fs.lstat(configuredProjectDir);
    if (!stats.isDirectory() || stats.isSymbolicLink()) throw new RecordIoError('unsafe_path');
    const canonicalRoot = await fs.realpath(configuredProjectDir);
    const directories = await resolveCompleteDirectorySet({
      fs,
      canonicalRoot,
      parent: canonicalRoot,
      rootName: 'commands',
      childNames: ['pending', 'slots', 'receipts'] as const,
      createIfWhollyAbsent: false,
    });
    if (directories === null) throw new RecordIoError('partial_directory_set');
    return {
      canonicalRoot,
      pending: directories.pending,
      slots: directories.slots,
      receipts: directories.receipts,
    };
  } catch (error) {
    throw error instanceof RecordIoError ? error : new RecordIoError('storage_error');
  }
};

const readJsonRecord = async (input: {
  fs: RecordIoFileSystem;
  canonicalRoot: string;
  file: string;
}): Promise<unknown | null> => {
  const bytes = await readBoundedRegularFile({
    ...input,
    maxBytes: STUDIO_DIRECTOR_COMMAND_MAX_RECORD_BYTES,
  });
  return bytes === null ? null : parseJson(bytes);
};

const syncDirectory = async (fs: RecordIoFileSystem, directory: string): Promise<void> => {
  const handle = await fs.open(directory, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
};

const readGuardedJsonRecord = async (input: {
  fs: RecordIoFileSystem;
  file: string;
}): Promise<GuardedRecord | null> => {
  let handle: Awaited<ReturnType<RecordIoFileSystem['open']>> | undefined;
  try {
    let preliminaryStats: Awaited<ReturnType<RecordIoFileSystem['lstat']>>;
    try {
      preliminaryStats = await input.fs.lstat(input.file);
    } catch (error) {
      if (hasErrorCode(error, 'ENOENT')) return null;
      throw error;
    }
    if (preliminaryStats.isSymbolicLink() || !preliminaryStats.isFile()) {
      throw new RecordIoError('unsafe_file');
    }
    if (preliminaryStats.size > STUDIO_DIRECTOR_COMMAND_MAX_RECORD_BYTES) {
      throw new RecordIoError('record_too_large');
    }
    const flags =
      process.platform === 'win32'
        ? fsConstants.O_RDONLY
        : fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK;
    try {
      handle = await input.fs.open(input.file, flags);
    } catch (error) {
      if (hasErrorCode(error, 'ENOENT')) return null;
      if (hasErrorCode(error, 'ELOOP') || hasErrorCode(error, 'EMLINK')) {
        throw new RecordIoError('unsafe_file');
      }
      throw error;
    }
    const stats = await handle.stat();
    if (!stats.isFile() || stats.dev !== preliminaryStats.dev || stats.ino !== preliminaryStats.ino) {
      throw new RecordIoError('unsafe_file');
    }
    if (stats.size > STUDIO_DIRECTOR_COMMAND_MAX_RECORD_BYTES) {
      throw new RecordIoError('record_too_large');
    }
    const bytes = Buffer.alloc(STUDIO_DIRECTOR_COMMAND_MAX_RECORD_BYTES + 1);
    let offset = 0;
    while (offset < bytes.length) {
      // eslint-disable-next-line no-await-in-loop
      const result = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (result.bytesRead === 0) break;
      offset += result.bytesRead;
    }
    if (offset > STUDIO_DIRECTOR_COMMAND_MAX_RECORD_BYTES) throw new RecordIoError('record_too_large');
    let pathStats: Awaited<ReturnType<RecordIoFileSystem['lstat']>>;
    try {
      pathStats = await input.fs.lstat(input.file);
    } catch (error) {
      if (hasErrorCode(error, 'ENOENT')) return null;
      throw error;
    }
    if (
      pathStats.isSymbolicLink() ||
      !pathStats.isFile() ||
      pathStats.dev !== stats.dev ||
      pathStats.ino !== stats.ino
    ) {
      throw new RecordIoError('unsafe_file');
    }
    return {
      value: parseJson(bytes.subarray(0, offset).toString('utf8')),
      dev: stats.dev,
      ino: stats.ino,
    };
  } catch (error) {
    throw error instanceof RecordIoError ? error : new RecordIoError('storage_error');
  } finally {
    await handle?.close().catch((): undefined => undefined);
  }
};

const readNamedReceipt = async (input: {
  fs: RecordIoFileSystem;
  directories: CommandDirectories;
  projectId: string;
  commandId: string;
}): Promise<StudioDirectorCommandReceiptV1 | null> => {
  const value = await readJsonRecord({
    fs: input.fs,
    canonicalRoot: input.directories.canonicalRoot,
    file: path.join(input.directories.receipts, `${input.commandId}.json`),
  });
  if (value === null) return null;
  const receipt = parseStudioDirectorCommandReceipt({
    projectId: input.projectId,
    commandId: input.commandId,
    value,
  });
  if (receipt === null) throw new RecordIoError('storage_error');
  return receipt;
};

const pendingRecordIsValid = (input: {
  projectId: string;
  commandId: string;
  value: unknown;
  nowMs: number;
}): boolean => {
  if (typeof input.value !== 'object' || input.value === null || Array.isArray(input.value)) return false;
  const candidate = input.value as Record<string, unknown>;
  const syntheticSlot = {
    schemaVersion: STUDIO_DIRECTOR_COMMAND_SCHEMA_VERSION,
    commandId: candidate.commandId,
    reservedAt: candidate.createdAt,
    deadlineAt: candidate.deadlineAt,
  };
  const parsed = parseStudioDirectorPendingRecord({
    projectId: input.projectId,
    commandId: input.commandId,
    value: input.value,
    slot: syntheticSlot,
    now: new Date(input.nowMs).toISOString(),
    waitMs: STUDIO_DIRECTOR_COMMAND_WAIT_MS,
  });
  return parsed.status === 'valid';
};

const recoverBusyCommandId = async (input: {
  fs: RecordIoFileSystem;
  directories: CommandDirectories;
}): Promise<string | null> => {
  const value = await readJsonRecord({
    fs: input.fs,
    canonicalRoot: input.directories.canonicalRoot,
    file: path.join(input.directories.slots, '0.slot'),
  });
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const commandId = (value as Record<string, unknown>).commandId;
  return isSafeStudioDirectorId(commandId) ? commandId : null;
};

const prepareCommand = (input: {
  config: StudioDirectorCommandWriterConfig | null;
  toolInput: StudioApplyEditsInput;
  now: () => number;
  createId: () => string;
}): { commandId: string; prepared: PreparedCommand | null } => {
  const commandId = input.createId();
  const outcomeCommandId = safeOutcomeId(commandId);
  const toolOperations = Array.isArray(input.toolInput.operations) ? input.toolInput.operations : [];
  const mintedSceneIds: string[] = [];
  const operations = toolOperations.map((operation) => {
    if (typeof operation === 'object' && operation !== null && operation.kind === 'add_scene') {
      const sceneId = input.createId();
      mintedSceneIds.push(sceneId);
      return { ...operation, sceneId };
    }
    return operation;
  }) as StudioDirectorOperationV1[];
  const mintedIds = [commandId, ...mintedSceneIds];
  if (!mintedIds.every(isSafeStudioDirectorId) || new Set(mintedIds).size !== mintedIds.length) {
    return { commandId: outcomeCommandId, prepared: null };
  }
  const createdAtMs = input.now();
  if (!Number.isFinite(createdAtMs)) return { commandId, prepared: null };
  const createdAt = new Date(createdAtMs).toISOString();
  const deadlineAt = new Date(createdAtMs + STUDIO_DIRECTOR_COMMAND_WAIT_MS).toISOString();
  const projectId = input.config?.projectId ?? '';
  const command: StudioDirectorCommandRecordV1 = {
    schemaVersion: STUDIO_DIRECTOR_COMMAND_SCHEMA_VERSION,
    commandId,
    projectId,
    expectedRevision: input.toolInput.expectedRevision,
    createdAt,
    deadlineAt,
    policy: 'auto_apply',
    operations,
  };
  const slot: StudioDirectorCommandSlotV1 = {
    schemaVersion: STUDIO_DIRECTOR_COMMAND_SCHEMA_VERSION,
    commandId,
    reservedAt: createdAt,
    deadlineAt,
  };
  const validation = parseStudioDirectorPendingRecord({
    projectId,
    commandId,
    value: command,
    slot,
    now: createdAt,
    waitMs: STUDIO_DIRECTOR_COMMAND_WAIT_MS,
  });
  if (validation.status !== 'valid') return { commandId, prepared: null };
  const commandBytes = JSON.stringify(command);
  const slotBytes = JSON.stringify(slot);
  if (Buffer.byteLength(commandBytes, 'utf8') > STUDIO_DIRECTOR_COMMAND_MAX_RECORD_BYTES) {
    return { commandId, prepared: null };
  }
  return { commandId, prepared: { command, slot, commandBytes, slotBytes } };
};

const cleanupOwnedSlot = async (input: {
  fs: RecordIoFileSystem;
  directories: CommandDirectories;
  slot: StudioDirectorCommandSlotV1;
  nowMs: number;
}): Promise<boolean> => {
  const slotFile = path.join(input.directories.slots, '0.slot');
  const value = await readJsonRecord({
    fs: input.fs,
    canonicalRoot: input.directories.canonicalRoot,
    file: slotFile,
  });
  if (value === null) return true;
  const current = parseStudioDirectorCommandSlot(
    value,
    new Date(input.nowMs).toISOString(),
    STUDIO_DIRECTOR_COMMAND_WAIT_MS
  );
  if (
    current?.schemaVersion !== input.slot.schemaVersion ||
    current.commandId !== input.slot.commandId ||
    current.reservedAt !== input.slot.reservedAt ||
    current.deadlineAt !== input.slot.deadlineAt
  ) {
    return false;
  }

  const slotGuard = `${slotFile}.unconfirmed`;
  let guardHandle: Awaited<ReturnType<RecordIoFileSystem['open']>> | undefined;
  let ownsGuard = false;
  let preserveGuard = false;
  const releaseGuard = async (): Promise<void> => {
    await input.fs.rm(slotGuard);
    ownsGuard = false;
    await syncDirectory(input.fs, input.directories.slots);
  };
  try {
    const slotsStats = await input.fs.lstat(input.directories.slots);
    if (
      !slotsStats.isDirectory() ||
      slotsStats.isSymbolicLink() ||
      (await input.fs.realpath(input.directories.slots)) !== input.directories.slots
    ) {
      throw new RecordIoError('unsafe_path');
    }
    guardHandle = await input.fs.open(slotGuard, 'wx');
    ownsGuard = true;
    await guardHandle.writeFile('1', { encoding: 'utf8' });
    await guardHandle.sync();
    await guardHandle.close();
    guardHandle = undefined;
    await syncDirectory(input.fs, input.directories.slots);

    const guardedRecord = await readGuardedJsonRecord({ fs: input.fs, file: slotFile });
    if (guardedRecord === null) {
      await releaseGuard();
      return true;
    }
    const guardedSlot = parseStudioDirectorCommandSlot(
      guardedRecord.value,
      new Date(input.nowMs).toISOString(),
      STUDIO_DIRECTOR_COMMAND_WAIT_MS
    );
    if (
      guardedSlot?.schemaVersion !== input.slot.schemaVersion ||
      guardedSlot.commandId !== input.slot.commandId ||
      guardedSlot.reservedAt !== input.slot.reservedAt ||
      guardedSlot.deadlineAt !== input.slot.deadlineAt
    ) {
      await releaseGuard();
      return false;
    }

    let finalStats: Awaited<ReturnType<RecordIoFileSystem['lstat']>>;
    try {
      finalStats = await input.fs.lstat(slotFile);
    } catch (error) {
      if (!hasErrorCode(error, 'ENOENT')) throw error;
      await releaseGuard();
      return true;
    }
    if (
      finalStats.isSymbolicLink() ||
      !finalStats.isFile() ||
      finalStats.dev !== guardedRecord.dev ||
      finalStats.ino !== guardedRecord.ino
    ) {
      await releaseGuard();
      return false;
    }
    await input.fs.rm(slotFile);
    preserveGuard = true;
    await syncDirectory(input.fs, input.directories.slots);
    preserveGuard = false;
    await releaseGuard();
    return true;
  } catch (error) {
    await guardHandle?.close().catch((): undefined => undefined);
    if (ownsGuard && !preserveGuard) {
      await input.fs.rm(slotGuard).catch((): undefined => undefined);
      await syncDirectory(input.fs, input.directories.slots).catch((): undefined => undefined);
    }
    throw error instanceof RecordIoError ? error : new RecordIoError('storage_error');
  }
};

export const createStudioDirectorCommandWriter = (
  config: StudioDirectorCommandWriterConfig | null,
  injected: StudioDirectorCommandWriterDeps = {}
): StudioDirectorCommandWriter => {
  const fs = injected.fs ?? nodeFs;
  const now = injected.now ?? Date.now;
  const createId = injected.createId ?? randomUUID;
  const sleep = injected.sleep ?? defaultSleep;

  const getStatus = async (input: StudioGetCommandStatusInput): Promise<StudioDirectorToolStatusResult> => {
    if (!isSafeStudioDirectorId(input.commandId) || config === null || !isSafeStudioDirectorId(config.projectId)) {
      return storageError(input.commandId);
    }
    try {
      const directories = await resolveCommandDirectories(fs, config);
      const receipt = await readNamedReceipt({
        fs,
        directories,
        projectId: config.projectId,
        commandId: input.commandId,
      });
      if (receipt !== null) return receipt;
      const pendingValue = await readJsonRecord({
        fs,
        canonicalRoot: directories.canonicalRoot,
        file: path.join(directories.pending, `${input.commandId}.json`),
      });
      if (pendingValue === null) return { status: 'not_found', commandId: input.commandId };
      return pendingRecordIsValid({
        projectId: config.projectId,
        commandId: input.commandId,
        value: pendingValue,
        nowMs: now(),
      })
        ? { status: 'pending', commandId: input.commandId }
        : storageError(input.commandId);
    } catch {
      return storageError(input.commandId);
    }
  };

  const apply = async (toolInput: StudioApplyEditsInput): Promise<StudioDirectorToolApplyResult> => {
    const { commandId, prepared } = prepareCommand({ config, toolInput, now, createId });
    if (prepared === null || config === null) return storageError(commandId);
    let directories: CommandDirectories;
    try {
      directories = await resolveCommandDirectories(fs, config);
    } catch {
      return storageError(commandId);
    }
    const slotFile = path.join(directories.slots, '0.slot');
    try {
      await publishImmutableRecord({
        fs,
        canonicalRoot: directories.canonicalRoot,
        file: slotFile,
        bytes: prepared.slotBytes,
      });
    } catch (error) {
      if (error instanceof RecordIoError && error.code === 'already_exists') {
        try {
          const existingCommandId = await recoverBusyCommandId({ fs, directories });
          return existingCommandId === null
            ? storageError(commandId)
            : { status: 'busy', commandId: existingCommandId };
        } catch {
          return storageError(commandId);
        }
      }
      return storageError(commandId);
    }

    try {
      await publishImmutableRecord({
        fs,
        canonicalRoot: directories.canonicalRoot,
        file: path.join(directories.pending, `${commandId}.json`),
        bytes: prepared.commandBytes,
      });
    } catch {
      try {
        await cleanupOwnedSlot({ fs, directories, slot: prepared.slot, nowMs: now() });
      } catch {
        // The caller receives storage_error; a slot that cannot be re-proven is deliberately retained.
      }
      return storageError(commandId);
    }

    const readReceipt = (): Promise<StudioDirectorCommandReceiptV1 | null> =>
      readNamedReceipt({ fs, directories, projectId: config.projectId, commandId });
    try {
      let receipt = await readReceipt();
      if (receipt !== null) return receipt;
      const deadlineMs = Date.parse(prepared.command.deadlineAt);
      while (now() < deadlineMs) {
        const remainingMs = Math.max(0, deadlineMs - now());
        // eslint-disable-next-line no-await-in-loop
        await sleep(Math.min(STUDIO_DIRECTOR_COMMAND_SWEEP_INTERVAL_MS, remainingMs));
        // eslint-disable-next-line no-await-in-loop
        receipt = await readReceipt();
        if (receipt !== null) return receipt;
      }
      // A final exact-name read at the named deadline closes the last sleep/read race.
      receipt = await readReceipt();
      return receipt ?? { status: 'unconfirmed', commandId };
    } catch {
      return storageError(commandId);
    }
  };

  return { apply, getStatus };
};
