/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomUUID } from 'node:crypto';
import { promises as nodeFs } from 'node:fs';
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
  removeRegularRecordIfPresent,
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

const defaultSleep = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const storageError = (commandId: string): { status: 'storage_error'; commandId: string } => ({
  status: 'storage_error',
  commandId,
});

const safeOutcomeId = (candidate: string): string => (isSafeStudioDirectorId(candidate) ? candidate : 'unavailable');

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
  if (current?.commandId !== input.slot.commandId || current.deadlineAt !== input.slot.deadlineAt) return false;
  await removeRegularRecordIfPresent({
    fs: input.fs,
    canonicalRoot: input.directories.canonicalRoot,
    file: slotFile,
  });
  return true;
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
