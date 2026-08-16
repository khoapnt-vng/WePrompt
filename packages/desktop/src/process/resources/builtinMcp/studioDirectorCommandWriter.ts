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
  STUDIO_DIRECTOR_COMMAND_SLOT_LEASE_MS,
  STUDIO_DIRECTOR_COMMAND_SWEEP_INTERVAL_MS,
  STUDIO_DIRECTOR_COMMAND_WAIT_MS,
  type StudioDirectorCommandReceiptV1,
  type StudioDirectorCommandRecordV1,
  type StudioDirectorCommandSlotLeaseV1,
  type StudioDirectorCommandSlotV1,
  type StudioDirectorNewSceneV1,
  type StudioDirectorOperationV1,
} from '@/common/types/project/creativeStudioTypes';
import {
  isSafeStudioDirectorId,
  parseStudioDirectorCommandReceipt,
  parseStudioDirectorCommandSlotLease,
  parseStudioDirectorCommandSlot,
  parseStudioDirectorPendingRecord,
} from '@process/services/creative-studio/service/directorCommandContracts';
import {
  RecordIoError,
  type RecordIoFileSystem,
  publishExclusiveLeaseRecord,
  publishImmutableRecord,
  readBoundedRegularFile,
  readBoundedRegularFileWithIdentity,
  removeRegularRecordIfIdentity,
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
  lease: StudioDirectorCommandSlotLeaseV1;
  commandBytes: string;
  slotBytes: string;
  leaseBytes: string;
};

type IdentifiedJsonRecord = {
  value: unknown;
  identity: { dev: number; ino: number };
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

const readIdentifiedJsonRecord = async (input: {
  fs: RecordIoFileSystem;
  canonicalRoot: string;
  file: string;
}): Promise<IdentifiedJsonRecord | null> => {
  const record = await readBoundedRegularFileWithIdentity({
    ...input,
    maxBytes: STUDIO_DIRECTOR_COMMAND_MAX_RECORD_BYTES,
  });
  return record === null ? null : { value: parseJson(record.bytes), identity: record.identity };
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
  const leaseId = input.createId();
  if (!isSafeStudioDirectorId(leaseId)) return { commandId, prepared: null };
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
  const lease: StudioDirectorCommandSlotLeaseV1 = {
    schemaVersion: STUDIO_DIRECTOR_COMMAND_SCHEMA_VERSION,
    leaseId,
    owner: 'writer',
    commandId,
    reservedAt: createdAt,
    deadlineAt,
    acquiredAt: createdAt,
    expiresAt: new Date(createdAtMs + STUDIO_DIRECTOR_COMMAND_SLOT_LEASE_MS).toISOString(),
  };
  const validation = parseStudioDirectorPendingRecord({
    projectId,
    commandId,
    value: command,
    slot,
    now: createdAt,
    waitMs: STUDIO_DIRECTOR_COMMAND_WAIT_MS,
  });
  if (
    validation.status !== 'valid' ||
    parseStudioDirectorCommandSlotLease(lease, createdAt, STUDIO_DIRECTOR_COMMAND_WAIT_MS) === null
  ) {
    return { commandId, prepared: null };
  }
  const commandBytes = JSON.stringify(command);
  const slotBytes = JSON.stringify(slot);
  const leaseBytes = JSON.stringify(lease);
  if (
    Buffer.byteLength(commandBytes, 'utf8') > STUDIO_DIRECTOR_COMMAND_MAX_RECORD_BYTES ||
    Buffer.byteLength(leaseBytes, 'utf8') > STUDIO_DIRECTOR_COMMAND_MAX_RECORD_BYTES
  ) {
    return { commandId, prepared: null };
  }
  return { commandId, prepared: { command, slot, lease, commandBytes, slotBytes, leaseBytes } };
};

const sameSlot = (left: StudioDirectorCommandSlotV1, right: StudioDirectorCommandSlotV1): boolean =>
  left.schemaVersion === right.schemaVersion &&
  left.commandId === right.commandId &&
  left.reservedAt === right.reservedAt &&
  left.deadlineAt === right.deadlineAt;

const sameLease = (left: StudioDirectorCommandSlotLeaseV1, right: StudioDirectorCommandSlotLeaseV1): boolean =>
  left.schemaVersion === right.schemaVersion &&
  left.leaseId === right.leaseId &&
  left.owner === right.owner &&
  left.commandId === right.commandId &&
  left.reservedAt === right.reservedAt &&
  left.deadlineAt === right.deadlineAt &&
  left.acquiredAt === right.acquiredAt &&
  left.expiresAt === right.expiresAt;

type HeldLease = {
  lease: StudioDirectorCommandSlotLeaseV1;
  identity: { dev: number; ino: number };
};

const readSlot = async (input: {
  fs: RecordIoFileSystem;
  directories: CommandDirectories;
  nowMs: number;
}): Promise<{ slot: StudioDirectorCommandSlotV1; identity: { dev: number; ino: number } } | null> => {
  const slotFile = path.join(input.directories.slots, '0.slot');
  const record = await readIdentifiedJsonRecord({
    fs: input.fs,
    canonicalRoot: input.directories.canonicalRoot,
    file: slotFile,
  });
  if (record === null) return null;
  const slot = parseStudioDirectorCommandSlot(
    record.value,
    new Date(input.nowMs).toISOString(),
    STUDIO_DIRECTOR_COMMAND_WAIT_MS
  );
  if (slot === null) throw new RecordIoError('storage_error');
  return { slot, identity: record.identity };
};

const acquireLease = async (input: {
  fs: RecordIoFileSystem;
  directories: CommandDirectories;
  lease: StudioDirectorCommandSlotLeaseV1;
}): Promise<HeldLease> => {
  const leaseFile = path.join(input.directories.slots, '0.slot.lease');
  await publishExclusiveLeaseRecord({
    fs: input.fs,
    canonicalRoot: input.directories.canonicalRoot,
    file: leaseFile,
    bytes: JSON.stringify(input.lease),
  });
  const record = await readIdentifiedJsonRecord({
    fs: input.fs,
    canonicalRoot: input.directories.canonicalRoot,
    file: leaseFile,
  });
  const parsed =
    record === null
      ? null
      : parseStudioDirectorCommandSlotLease(record.value, input.lease.acquiredAt, STUDIO_DIRECTOR_COMMAND_WAIT_MS);
  if (record === null || parsed === null || !sameLease(parsed, input.lease)) {
    throw new RecordIoError('storage_error');
  }
  return { lease: parsed, identity: record.identity };
};

const releaseLease = async (input: {
  fs: RecordIoFileSystem;
  directories: CommandDirectories;
  held: HeldLease;
  now: () => number;
}): Promise<boolean> => {
  if (input.now() >= Date.parse(input.held.lease.expiresAt)) return false;
  const leaseFile = path.join(input.directories.slots, '0.slot.lease');
  const record = await readIdentifiedJsonRecord({
    fs: input.fs,
    canonicalRoot: input.directories.canonicalRoot,
    file: leaseFile,
  });
  if (record === null) return false;
  const current = parseStudioDirectorCommandSlotLease(
    record.value,
    new Date(input.now()).toISOString(),
    STUDIO_DIRECTOR_COMMAND_WAIT_MS
  );
  if (
    current === null ||
    !sameLease(current, input.held.lease) ||
    record.identity.dev !== input.held.identity.dev ||
    record.identity.ino !== input.held.identity.ino ||
    input.now() >= Date.parse(input.held.lease.expiresAt)
  ) {
    return false;
  }
  return removeRegularRecordIfIdentity({
    fs: input.fs,
    canonicalRoot: input.directories.canonicalRoot,
    file: leaseFile,
    identity: record.identity,
  });
};

const buildWriterLease = (input: {
  leaseId: string;
  slot: StudioDirectorCommandSlotV1;
  acquiredAtMs: number;
}): StudioDirectorCommandSlotLeaseV1 => ({
  schemaVersion: STUDIO_DIRECTOR_COMMAND_SCHEMA_VERSION,
  leaseId: input.leaseId,
  owner: 'writer',
  commandId: input.slot.commandId,
  reservedAt: input.slot.reservedAt,
  deadlineAt: input.slot.deadlineAt,
  acquiredAt: new Date(input.acquiredAtMs).toISOString(),
  expiresAt: new Date(input.acquiredAtMs + STUDIO_DIRECTOR_COMMAND_SLOT_LEASE_MS).toISOString(),
});

const cleanupOwnedSlot = async (input: {
  fs: RecordIoFileSystem;
  directories: CommandDirectories;
  slot: StudioDirectorCommandSlotV1;
  now: () => number;
  createId: () => string;
}): Promise<boolean> => {
  const initial = await readSlot({ fs: input.fs, directories: input.directories, nowMs: input.now() });
  if (initial === null) return true;
  if (!sameSlot(initial.slot, input.slot)) return false;

  const leaseId = input.createId();
  const acquiredAtMs = input.now();
  if (!isSafeStudioDirectorId(leaseId) || !Number.isFinite(acquiredAtMs)) return false;
  const lease = buildWriterLease({ leaseId, slot: input.slot, acquiredAtMs });
  if (parseStudioDirectorCommandSlotLease(lease, lease.acquiredAt, STUDIO_DIRECTOR_COMMAND_WAIT_MS) === null) {
    return false;
  }
  const held = await acquireLease({ fs: input.fs, directories: input.directories, lease });
  const fresh = await readSlot({ fs: input.fs, directories: input.directories, nowMs: input.now() });
  if (fresh === null) return releaseLease({ ...input, held });
  if (!sameSlot(fresh.slot, input.slot)) {
    await releaseLease({ ...input, held });
    return false;
  }
  if (input.now() >= Date.parse(held.lease.expiresAt)) return false;
  const removed = await removeRegularRecordIfIdentity({
    fs: input.fs,
    canonicalRoot: input.directories.canonicalRoot,
    file: path.join(input.directories.slots, '0.slot'),
    identity: fresh.identity,
  });
  if (!removed) return false;
  return releaseLease({ ...input, held });
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
    let held: HeldLease;
    try {
      held = await acquireLease({ fs, directories, lease: prepared.lease });
    } catch {
      return storageError(commandId);
    }

    try {
      if (now() >= Date.parse(held.lease.expiresAt)) return storageError(commandId);
      const existing = await readSlot({ fs, directories, nowMs: now() });
      if (existing !== null) {
        const released = await releaseLease({ fs, directories, held, now });
        return released ? { status: 'busy', commandId: existing.slot.commandId } : storageError(commandId);
      }
      await publishImmutableRecord({
        fs,
        canonicalRoot: directories.canonicalRoot,
        file: slotFile,
        bytes: prepared.slotBytes,
      });
      if (now() >= Date.parse(held.lease.expiresAt)) return storageError(commandId);
      if (!(await releaseLease({ fs, directories, held, now }))) return storageError(commandId);
    } catch {
      await releaseLease({ fs, directories, held, now }).catch((): undefined => undefined);
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
        await cleanupOwnedSlot({ fs, directories, slot: prepared.slot, now, createId });
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
