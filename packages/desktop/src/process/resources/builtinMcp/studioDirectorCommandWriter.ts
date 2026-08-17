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
  STUDIO_DIRECTOR_COMMAND_SCHEMA_VERSION_V2,
  STUDIO_DIRECTOR_COMMAND_SLOT_LEASE_MS,
  STUDIO_DIRECTOR_COMMAND_SWEEP_INTERVAL_MS,
  STUDIO_DIRECTOR_COMMAND_WAIT_MS,
  STUDIO_PROJECT_SCHEMA_VERSION,
  type StudioDirectorCommandReceiptV1,
  type StudioDirectorCommandReceiptV2,
  type StudioDirectorCommandRecordV1,
  type StudioDirectorCommandRecordV2,
  type StudioDirectorCommandSlotLeaseV1,
  type StudioDirectorCommandSlotLeaseV2,
  type StudioDirectorCommandSlotV1,
  type StudioDirectorCommandSlotV2,
  type StudioEditableClip,
  type StudioEditableSection,
  type StudioProjectV2,
  type StudioDirectorNewSceneV1,
  type StudioDirectorOperationV1,
} from '@/common/types/project/creativeStudioTypes';
import {
  isSafeStudioDirectorId,
  parseStudioDirectorCommandReceipt,
  parseStudioDirectorCommandReceiptV2,
  parseStudioDirectorCommandSlotLease,
  parseStudioDirectorCommandSlotLeaseV2,
  parseStudioDirectorCommandSlot,
  parseStudioDirectorCommandSlotV2,
  parseStudioDirectorPendingRecord,
  parseStudioDirectorPendingRecordV2,
} from '@process/services/creative-studio/service/directorCommandContracts';
import { validateStudioProjectV2 } from '@process/services/creative-studio/service/schema2';
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

export type StudioDirectorToolOperationV2 =
  | Exclude<StudioDirectorCommandRecordV2['operations'][number], { kind: 'add_section' | 'add_clip' }>
  | {
      kind: 'add_section';
      section: StudioEditableSection;
      firstClip: StudioEditableClip;
      beforeSectionId: string | null;
    }
  | {
      kind: 'add_clip';
      sectionId: string;
      clip: StudioEditableClip;
      beforeClipId: string | null;
    };

export type StudioApplyEditsInputV2 = {
  expectedRevision: number;
  operations: StudioDirectorToolOperationV2[];
};

export type StudioGetCommandStatusInput = { commandId: string };

export type StudioDirectorToolApplyResult =
  | StudioDirectorCommandReceiptV1
  | { status: 'busy' | 'unconfirmed' | 'storage_error'; commandId: string };

export type StudioDirectorToolStatusResult =
  | StudioDirectorCommandReceiptV1
  | { status: 'pending' | 'not_found' | 'storage_error'; commandId: string };

export type StudioDirectorToolApplyResultV2 =
  | StudioDirectorCommandReceiptV2
  | {
      status: 'busy' | 'unconfirmed' | 'storage_error' | 'unsupported_prototype_schema';
      commandId: string;
    };

export type StudioDirectorToolStatusResultV2 =
  | StudioDirectorCommandReceiptV2
  | {
      status: 'pending' | 'not_found' | 'storage_error' | 'unsupported_prototype_schema';
      commandId: string;
    };

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

export type StudioDirectorCommandWriterV2 = {
  apply(input: StudioApplyEditsInputV2): Promise<StudioDirectorToolApplyResultV2>;
  getStatus(input: StudioGetCommandStatusInput): Promise<StudioDirectorToolStatusResultV2>;
};

const MAX_SAFE_STUDIO_ID_PREVIEW = 'x'.repeat(256);

/** Conservative pure preview used by the SDK schema and direct writer before any id is minted. */
export const studioDirectorToolInputFitsDurableRecordV2 = (
  toolInput: StudioApplyEditsInputV2,
  projectId = MAX_SAFE_STUDIO_ID_PREVIEW
): boolean => {
  try {
    const operations = toolInput.operations.map((operation) => {
      if (operation.kind === 'add_section') {
        return {
          ...operation,
          sectionId: MAX_SAFE_STUDIO_ID_PREVIEW,
          firstClipId: MAX_SAFE_STUDIO_ID_PREVIEW,
        };
      }
      if (operation.kind === 'add_clip') return { ...operation, clipId: MAX_SAFE_STUDIO_ID_PREVIEW };
      return operation;
    });
    const preview: StudioDirectorCommandRecordV2 = {
      schemaVersion: STUDIO_DIRECTOR_COMMAND_SCHEMA_VERSION_V2,
      commandId: MAX_SAFE_STUDIO_ID_PREVIEW,
      projectId,
      expectedRevision: toolInput.expectedRevision,
      createdAt: '9999-12-31T23:59:59.999Z',
      deadlineAt: '9999-12-31T23:59:59.999Z',
      policy: 'auto_apply',
      operations: operations as StudioDirectorCommandRecordV2['operations'],
    };
    return Buffer.byteLength(JSON.stringify(preview), 'utf8') <= STUDIO_DIRECTOR_COMMAND_MAX_RECORD_BYTES;
  } catch {
    return false;
  }
};

type CommandDirectories = {
  canonicalRoot: string;
  pending: string;
  slots: string;
  receipts: string;
  v2Authority?: {
    pending: { dev: number; ino: number };
    slots: { dev: number; ino: number };
    receipts: { dev: number; ino: number };
  };
};

type PreparedCommand = {
  command: StudioDirectorCommandRecordV1;
  slot: StudioDirectorCommandSlotV1;
  lease: StudioDirectorCommandSlotLeaseV1;
  commandBytes: string;
  slotBytes: string;
  leaseBytes: string;
};

type PreparedCommandV2 = {
  command: StudioDirectorCommandRecordV2;
  slot: StudioDirectorCommandSlotV2;
  lease: StudioDirectorCommandSlotLeaseV2;
  commandBytes: string;
  slotBytes: string;
  leaseBytes: string;
};

type IdentifiedJsonRecord = {
  value: unknown;
  identity: { dev: number; ino: number };
};

type ProjectAuthorityV2 = {
  canonicalRoot: string;
  rootIdentity: { dev: number; ino: number };
  bytes: string;
  identity: { dev: number; ino: number };
  project: StudioProjectV2;
};

type ProjectAuthorityResultV2 =
  | { status: 'valid'; authority: ProjectAuthorityV2 }
  | { status: 'unsupported_prototype_schema' }
  | { status: 'invalid' };

const STUDIO_PROJECT_V2_MAX_RECORD_BYTES = 64 * 1024 * 1024;

const defaultSleep = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const storageError = (commandId: string): { status: 'storage_error'; commandId: string } => ({
  status: 'storage_error',
  commandId,
});

const unsupportedV2 = (commandId: string): { status: 'unsupported_prototype_schema'; commandId: string } => ({
  status: 'unsupported_prototype_schema',
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

const captureProjectAuthorityV2 = async (
  fs: RecordIoFileSystem,
  config: StudioDirectorCommandWriterConfig
): Promise<ProjectAuthorityResultV2> => {
  const configuredProjectDir = path.resolve(config.projectDir);
  try {
    const stats = await fs.lstat(configuredProjectDir);
    if (!stats.isDirectory() || stats.isSymbolicLink()) throw new RecordIoError('unsafe_path');
    const canonicalRoot = await fs.realpath(configuredProjectDir);
    const canonicalStats = await fs.lstat(canonicalRoot);
    if (
      !canonicalStats.isDirectory() ||
      canonicalStats.isSymbolicLink() ||
      canonicalStats.dev !== stats.dev ||
      canonicalStats.ino !== stats.ino
    ) {
      throw new RecordIoError('unsafe_path');
    }
    const record = await readBoundedRegularFileWithIdentity({
      fs,
      canonicalRoot,
      file: path.join(canonicalRoot, 'project.json'),
      maxBytes: STUDIO_PROJECT_V2_MAX_RECORD_BYTES,
    });
    if (record === null) return { status: 'invalid' };
    const value = parseJson(record.bytes);
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, 'schemaVersion');
      if (descriptor !== undefined && 'value' in descriptor && descriptor.value === 1) {
        return { status: 'unsupported_prototype_schema' };
      }
    }
    if (!validateStudioProjectV2(value) || value.schemaVersion !== STUDIO_PROJECT_SCHEMA_VERSION) {
      return { status: 'invalid' };
    }
    if (value.id !== config.projectId) return { status: 'invalid' };
    return {
      status: 'valid',
      authority: {
        canonicalRoot,
        rootIdentity: { dev: canonicalStats.dev, ino: canonicalStats.ino },
        bytes: record.bytes,
        identity: record.identity,
        project: value,
      },
    };
  } catch (error) {
    throw error instanceof RecordIoError ? error : new RecordIoError('storage_error');
  }
};

const projectAuthorityStatusV2 = async (
  fs: RecordIoFileSystem,
  config: StudioDirectorCommandWriterConfig,
  authority: ProjectAuthorityV2
): Promise<'valid' | 'unsupported_prototype_schema' | 'invalid'> => {
  try {
    const current = await captureProjectAuthorityV2(fs, config);
    if (current.status !== 'valid') return current.status;
    if (
      current.authority.canonicalRoot !== authority.canonicalRoot ||
      current.authority.rootIdentity.dev !== authority.rootIdentity.dev ||
      current.authority.rootIdentity.ino !== authority.rootIdentity.ino
    ) {
      return 'invalid';
    }
    if (
      current.authority.identity.dev === authority.identity.dev &&
      current.authority.identity.ino === authority.identity.ino &&
      current.authority.bytes === authority.bytes
    ) {
      return 'valid';
    }
    // Main owns CAS: a normal newer V2 commit remains eligible for a command carrying the older
    // expected revision, which main will reject deterministically instead of this writer guessing.
    return current.authority.project.revision >= authority.project.revision ? 'valid' : 'invalid';
  } catch {
    return 'invalid';
  }
};

/** Post-publication reads may straddle main's atomic manifest replacement; retry that one snapshot once. */
const projectAuthorityStatusForReceiptPollingV2 = async (
  fs: RecordIoFileSystem,
  config: StudioDirectorCommandWriterConfig,
  authority: ProjectAuthorityV2
): Promise<'valid' | 'unsupported_prototype_schema' | 'invalid'> => {
  const first = await projectAuthorityStatusV2(fs, config, authority);
  return first === 'invalid' ? projectAuthorityStatusV2(fs, config, authority) : first;
};

const resolveCommandDirectoriesV2 = async (
  fs: RecordIoFileSystem,
  authority: ProjectAuthorityV2
): Promise<CommandDirectories> => {
  const directories = await resolveCompleteDirectorySet({
    fs,
    canonicalRoot: authority.canonicalRoot,
    parent: authority.canonicalRoot,
    rootName: 'commands',
    childNames: ['pending', 'slots', 'receipts'] as const,
    createIfWhollyAbsent: false,
  });
  if (directories === null) throw new RecordIoError('partial_directory_set');
  const captureDirectory = async (directory: string): Promise<{ dev: number; ino: number }> => {
    const stats = await fs.lstat(directory);
    if (!stats.isDirectory() || stats.isSymbolicLink() || (await fs.realpath(directory)) !== directory) {
      throw new RecordIoError('unsafe_path');
    }
    return { dev: stats.dev, ino: stats.ino };
  };
  return {
    canonicalRoot: authority.canonicalRoot,
    pending: directories.pending,
    slots: directories.slots,
    receipts: directories.receipts,
    v2Authority: {
      pending: await captureDirectory(directories.pending),
      slots: await captureDirectory(directories.slots),
      receipts: await captureDirectory(directories.receipts),
    },
  };
};

const assertCommandDirectoriesV2 = async (fs: RecordIoFileSystem, directories: CommandDirectories): Promise<void> => {
  if (directories.v2Authority === undefined) throw new RecordIoError('unsafe_path');
  for (const name of ['pending', 'slots', 'receipts'] as const) {
    const directory = directories[name];
    const expected = directories.v2Authority[name];
    // eslint-disable-next-line no-await-in-loop
    const stats = await fs.lstat(directory);
    if (
      !stats.isDirectory() ||
      stats.isSymbolicLink() ||
      stats.dev !== expected.dev ||
      stats.ino !== expected.ino ||
      // eslint-disable-next-line no-await-in-loop
      (await fs.realpath(directory)) !== directory
    ) {
      throw new RecordIoError('unsafe_path');
    }
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

const readNamedReceiptV2 = async (input: {
  fs: RecordIoFileSystem;
  directories: CommandDirectories;
  projectId: string;
  commandId: string;
  publicationAuthority?: {
    config: StudioDirectorCommandWriterConfig;
    project: ProjectAuthorityV2;
  };
}): Promise<{ status: 'missing' | 'publishing' } | ReturnType<typeof parseStudioDirectorCommandReceiptV2>> => {
  await assertCommandDirectoriesV2(input.fs, input.directories);
  const receiptFile = path.join(input.directories.receipts, `${input.commandId}.json`);
  let value: unknown | null;
  try {
    value = await readJsonRecord({
      fs: input.fs,
      canonicalRoot: input.directories.canonicalRoot,
      file: receiptFile,
    });
  } catch (error) {
    if (input.publicationAuthority === undefined || !(error instanceof RecordIoError) || error.code !== 'unsafe_file') {
      throw error;
    }
    await assertCommandDirectoriesV2(input.fs, input.directories);
    const initialAuthorityStatus = await projectAuthorityStatusForReceiptPollingV2(
      input.fs,
      input.publicationAuthority.config,
      input.publicationAuthority.project
    );
    if (initialAuthorityStatus === 'unsupported_prototype_schema') {
      return { status: 'unsupported_prototype_schema' };
    }
    if (initialAuthorityStatus !== 'valid') {
      throw error;
    }
    let guard: Awaited<ReturnType<RecordIoFileSystem['lstat']>>;
    try {
      guard = await input.fs.lstat(`${receiptFile}.unconfirmed`);
    } catch (guardError) {
      if (!hasFileSystemCodeV2(guardError, 'ENOENT')) throw guardError;
      // The guard may have disappeared after the bounded read rejected it. Retry the exact
      // receipt once; guard-free unsafe or malformed records still fail closed.
      value = await readJsonRecord({
        fs: input.fs,
        canonicalRoot: input.directories.canonicalRoot,
        file: receiptFile,
      });
      await assertCommandDirectoriesV2(input.fs, input.directories);
      const retryAuthorityStatus = await projectAuthorityStatusForReceiptPollingV2(
        input.fs,
        input.publicationAuthority.config,
        input.publicationAuthority.project
      );
      if (retryAuthorityStatus === 'unsupported_prototype_schema') {
        return { status: 'unsupported_prototype_schema' };
      }
      if (retryAuthorityStatus !== 'valid') throw error;
      return value === null
        ? { status: 'missing' }
        : parseStudioDirectorCommandReceiptV2({
            projectId: input.projectId,
            commandId: input.commandId,
            value,
          });
    }
    if (guard.isSymbolicLink() || !guard.isFile()) throw error;
    try {
      const receipt = await input.fs.lstat(receiptFile);
      if (receipt.isSymbolicLink() || !receipt.isFile()) throw error;
    } catch (receiptError) {
      if (!hasFileSystemCodeV2(receiptError, 'ENOENT')) throw receiptError;
    }
    await assertCommandDirectoriesV2(input.fs, input.directories);
    const finalAuthorityStatus = await projectAuthorityStatusForReceiptPollingV2(
      input.fs,
      input.publicationAuthority.config,
      input.publicationAuthority.project
    );
    if (finalAuthorityStatus === 'unsupported_prototype_schema') {
      return { status: 'unsupported_prototype_schema' };
    }
    if (finalAuthorityStatus !== 'valid') throw error;
    return { status: 'publishing' };
  }
  await assertCommandDirectoriesV2(input.fs, input.directories);
  return value === null
    ? { status: 'missing' }
    : parseStudioDirectorCommandReceiptV2({
        projectId: input.projectId,
        commandId: input.commandId,
        value,
      });
};

const pendingRecordStatusV2 = (input: {
  projectId: string;
  commandId: string;
  value: unknown;
  nowMs: number;
}): 'valid' | 'unsupported_prototype_schema' | 'invalid' => {
  if (typeof input.value !== 'object' || input.value === null || Array.isArray(input.value)) return 'invalid';
  const candidate = input.value as Record<string, unknown>;
  const parsed = parseStudioDirectorPendingRecordV2({
    projectId: input.projectId,
    commandId: input.commandId,
    value: input.value,
    slot: {
      schemaVersion: STUDIO_DIRECTOR_COMMAND_SCHEMA_VERSION_V2,
      commandId: candidate.commandId,
      reservedAt: candidate.createdAt,
      deadlineAt: candidate.deadlineAt,
    },
    now: new Date(input.nowMs).toISOString(),
    waitMs: STUDIO_DIRECTOR_COMMAND_WAIT_MS,
  });
  return parsed.status;
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

const prepareCommandV2 = (input: {
  config: StudioDirectorCommandWriterConfig | null;
  toolInput: StudioApplyEditsInputV2;
  now: () => number;
  createId: () => string;
}): { commandId: string; prepared: PreparedCommandV2 | null } => {
  if (!studioDirectorToolInputFitsDurableRecordV2(input.toolInput, input.config?.projectId)) {
    return { commandId: 'unavailable', prepared: null };
  }
  const commandId = input.createId();
  const outcomeCommandId = safeOutcomeId(commandId);
  const toolOperations = Array.isArray(input.toolInput.operations) ? input.toolInput.operations : [];
  const createdIds: string[] = [];
  const operations = toolOperations.map((operation) => {
    if (typeof operation === 'object' && operation !== null && operation.kind === 'add_section') {
      const sectionId = input.createId();
      const firstClipId = input.createId();
      createdIds.push(sectionId, firstClipId);
      return { ...operation, sectionId, firstClipId };
    }
    if (typeof operation === 'object' && operation !== null && operation.kind === 'add_clip') {
      const clipId = input.createId();
      createdIds.push(clipId);
      return { ...operation, clipId };
    }
    return operation;
  }) as StudioDirectorCommandRecordV2['operations'];
  const durableIds = [commandId, ...createdIds];
  if (!durableIds.every(isSafeStudioDirectorId) || new Set(durableIds).size !== durableIds.length) {
    return { commandId: outcomeCommandId, prepared: null };
  }
  const leaseId = input.createId();
  if (!isSafeStudioDirectorId(leaseId) || durableIds.includes(leaseId)) return { commandId, prepared: null };
  const createdAtMs = input.now();
  if (!Number.isFinite(createdAtMs)) return { commandId, prepared: null };
  const createdAt = new Date(createdAtMs).toISOString();
  const deadlineAt = new Date(createdAtMs + STUDIO_DIRECTOR_COMMAND_WAIT_MS).toISOString();
  const projectId = input.config?.projectId ?? '';
  const command: StudioDirectorCommandRecordV2 = {
    schemaVersion: STUDIO_DIRECTOR_COMMAND_SCHEMA_VERSION_V2,
    commandId,
    projectId,
    expectedRevision: input.toolInput.expectedRevision,
    createdAt,
    deadlineAt,
    policy: 'auto_apply',
    operations,
  };
  const slot: StudioDirectorCommandSlotV2 = {
    schemaVersion: STUDIO_DIRECTOR_COMMAND_SCHEMA_VERSION_V2,
    commandId,
    reservedAt: createdAt,
    deadlineAt,
  };
  const lease: StudioDirectorCommandSlotLeaseV2 = {
    schemaVersion: STUDIO_DIRECTOR_COMMAND_SCHEMA_VERSION_V2,
    leaseId,
    owner: 'writer',
    commandId,
    reservedAt: createdAt,
    deadlineAt,
    acquiredAt: createdAt,
    expiresAt: new Date(createdAtMs + STUDIO_DIRECTOR_COMMAND_SLOT_LEASE_MS).toISOString(),
  };
  const validation = parseStudioDirectorPendingRecordV2({
    projectId,
    commandId,
    value: command,
    slot,
    now: createdAt,
    waitMs: STUDIO_DIRECTOR_COMMAND_WAIT_MS,
  });
  const leaseValidation = parseStudioDirectorCommandSlotLeaseV2(lease, createdAt, STUDIO_DIRECTOR_COMMAND_WAIT_MS);
  if (validation.status !== 'valid' || leaseValidation.status !== 'valid') {
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

const sameSlotV2 = (left: StudioDirectorCommandSlotV2, right: StudioDirectorCommandSlotV2): boolean =>
  left.schemaVersion === right.schemaVersion &&
  left.commandId === right.commandId &&
  left.reservedAt === right.reservedAt &&
  left.deadlineAt === right.deadlineAt;

const sameLeaseV2 = (left: StudioDirectorCommandSlotLeaseV2, right: StudioDirectorCommandSlotLeaseV2): boolean =>
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

type HeldLeaseV2 = {
  lease: StudioDirectorCommandSlotLeaseV2;
  identity: { dev: number; ino: number };
};

class CommandImmutablePublicationErrorV2 extends Error {
  constructor(
    public readonly outcome: 'already_exists' | 'not_linked' | 'ambiguous',
    public readonly publicationCause: unknown
  ) {
    super('Command pending publication failed');
  }
}

class CommandPublicationAuthorizationErrorV2 extends Error {
  constructor(public readonly status: 'collision' | 'storage_error' | 'unsupported_prototype_schema') {
    super('Command publication authorization failed');
  }
}

const hasFileSystemCodeV2 = (error: unknown, code: string): boolean =>
  typeof error === 'object' && error !== null && !Array.isArray(error) && (error as { code?: unknown }).code === code;

let commandCleanupCounterV2 = 0;

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
    isStillAuthorized: () => input.now() < Date.parse(input.held.lease.expiresAt),
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
    isStillAuthorized: () => input.now() < Date.parse(held.lease.expiresAt),
  });
  if (!removed) return false;
  return releaseLease({ ...input, held });
};

type ReadSlotResultV2 =
  | { status: 'missing' }
  | { status: 'unsupported_prototype_schema' }
  | { status: 'invalid' }
  | { status: 'valid'; slot: StudioDirectorCommandSlotV2; identity: { dev: number; ino: number } };

const readSlotV2 = async (input: {
  fs: RecordIoFileSystem;
  directories: CommandDirectories;
  nowMs: number;
}): Promise<ReadSlotResultV2> => {
  await assertCommandDirectoriesV2(input.fs, input.directories);
  const record = await readIdentifiedJsonRecord({
    fs: input.fs,
    canonicalRoot: input.directories.canonicalRoot,
    file: path.join(input.directories.slots, '0.slot'),
  });
  await assertCommandDirectoriesV2(input.fs, input.directories);
  if (record === null) return { status: 'missing' };
  const parsed = parseStudioDirectorCommandSlotV2(
    record.value,
    new Date(input.nowMs).toISOString(),
    STUDIO_DIRECTOR_COMMAND_WAIT_MS
  );
  return parsed.status === 'valid'
    ? { status: 'valid', slot: parsed.record, identity: record.identity }
    : { status: parsed.status };
};

type ReadLeaseResultV2 =
  | { status: 'missing' }
  | { status: 'unsupported_prototype_schema' }
  | { status: 'invalid' }
  | { status: 'valid'; lease: StudioDirectorCommandSlotLeaseV2; identity: { dev: number; ino: number } };

const readLeaseV2 = async (input: {
  fs: RecordIoFileSystem;
  directories: CommandDirectories;
  nowMs: number;
}): Promise<ReadLeaseResultV2> => {
  await assertCommandDirectoriesV2(input.fs, input.directories);
  const record = await readIdentifiedJsonRecord({
    fs: input.fs,
    canonicalRoot: input.directories.canonicalRoot,
    file: path.join(input.directories.slots, '0.slot.lease'),
  });
  await assertCommandDirectoriesV2(input.fs, input.directories);
  if (record === null) return { status: 'missing' };
  const parsed = parseStudioDirectorCommandSlotLeaseV2(
    record.value,
    new Date(input.nowMs).toISOString(),
    STUDIO_DIRECTOR_COMMAND_WAIT_MS
  );
  return parsed.status === 'valid'
    ? { status: 'valid', lease: parsed.record, identity: record.identity }
    : { status: parsed.status };
};

type CommandAuthorityPreflightV2 = {
  receipt: Awaited<ReturnType<typeof readNamedReceiptV2>>;
  pending: { status: 'missing' | 'valid' | 'unsupported_prototype_schema' | 'invalid' };
  slot: ReadSlotResultV2;
  lease: ReadLeaseResultV2;
};

const preflightCommandAuthorityV2 = async (input: {
  fs: RecordIoFileSystem;
  directories: CommandDirectories;
  projectId: string;
  commandId: string;
  nowMs: number;
}): Promise<CommandAuthorityPreflightV2> => {
  await assertCommandDirectoriesV2(input.fs, input.directories);
  const receipt = await readNamedReceiptV2(input);
  const pendingValue = await readJsonRecord({
    fs: input.fs,
    canonicalRoot: input.directories.canonicalRoot,
    file: path.join(input.directories.pending, `${input.commandId}.json`),
  });
  await assertCommandDirectoriesV2(input.fs, input.directories);
  const pending =
    pendingValue === null
      ? ({ status: 'missing' } as const)
      : ({
          status: pendingRecordStatusV2({
            projectId: input.projectId,
            commandId: input.commandId,
            value: pendingValue,
            nowMs: input.nowMs,
          }),
        } as const);
  const slot = await readSlotV2(input);
  const lease = await readLeaseV2(input);
  await assertCommandDirectoriesV2(input.fs, input.directories);
  return { receipt, pending, slot, lease };
};

const preflightHasStatusV2 = (
  preflight: CommandAuthorityPreflightV2,
  status: 'unsupported_prototype_schema' | 'invalid'
): boolean =>
  preflight.receipt.status === status ||
  preflight.pending.status === status ||
  preflight.slot.status === status ||
  preflight.lease.status === status;

const assertCommandLeasePublicationAuthorityV2 = async (input: {
  fs: RecordIoFileSystem;
  config: StudioDirectorCommandWriterConfig;
  projectAuthority: ProjectAuthorityV2;
  directories: CommandDirectories;
  lease: StudioDirectorCommandSlotLeaseV2;
  now: () => number;
}): Promise<void> => {
  const fail = (status: 'storage_error' | 'unsupported_prototype_schema'): never => {
    throw new CommandPublicationAuthorizationErrorV2(status);
  };
  await assertCommandDirectoriesV2(input.fs, input.directories);
  const authorityStatus = await projectAuthorityStatusV2(input.fs, input.config, input.projectAuthority);
  if (authorityStatus !== 'valid') {
    fail(authorityStatus === 'unsupported_prototype_schema' ? authorityStatus : 'storage_error');
  }
  await assertCommandDirectoriesV2(input.fs, input.directories);
  const currentMs = input.now();
  if (
    !Number.isFinite(currentMs) ||
    currentMs >= Date.parse(input.lease.expiresAt) ||
    currentMs >= Date.parse(input.lease.deadlineAt)
  ) {
    fail('storage_error');
  }
};

const publishCommandLeaseRecordV2 = async (input: {
  fs: RecordIoFileSystem;
  directories: CommandDirectories;
  file: string;
  bytes: string;
  authorizeBeforeLink: () => Promise<void>;
}): Promise<void> => {
  if (path.dirname(input.file) !== input.directories.slots) {
    throw new CommandImmutablePublicationErrorV2('not_linked', new RecordIoError('unsafe_path'));
  }
  let linkAttempted = false;
  let linked = false;
  let authorizationFailure: unknown;
  const link: RecordIoFileSystem['link'] = async (existingPath, newPath) => {
    if (String(newPath) !== input.file) throw new RecordIoError('unsafe_path');
    try {
      await input.authorizeBeforeLink();
    } catch (error) {
      authorizationFailure = error;
      throw error;
    }
    linkAttempted = true;
    await input.fs.link(existingPath, newPath);
    linked = true;
  };
  const publishingFs = new Proxy(input.fs, {
    get(target, property, receiver) {
      if (property === 'link') return link;
      const value = Reflect.get(target, property, receiver) as unknown;
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  try {
    await publishExclusiveLeaseRecord({
      fs: publishingFs,
      canonicalRoot: input.directories.canonicalRoot,
      file: input.file,
      bytes: input.bytes,
    });
  } catch (error) {
    const outcome =
      linked || (linkAttempted && !(error instanceof RecordIoError && error.code === 'already_exists'))
        ? 'ambiguous'
        : error instanceof RecordIoError && error.code === 'already_exists'
          ? 'already_exists'
          : 'not_linked';
    throw new CommandImmutablePublicationErrorV2(outcome, authorizationFailure ?? error);
  }
};

const acquireLeaseV2 = async (input: {
  fs: RecordIoFileSystem;
  config: StudioDirectorCommandWriterConfig;
  projectAuthority: ProjectAuthorityV2;
  directories: CommandDirectories;
  lease: StudioDirectorCommandSlotLeaseV2;
  now: () => number;
}): Promise<HeldLeaseV2> => {
  const leaseFile = path.join(input.directories.slots, '0.slot.lease');
  await assertCommandDirectoriesV2(input.fs, input.directories);
  await publishCommandLeaseRecordV2({
    fs: input.fs,
    directories: input.directories,
    file: leaseFile,
    bytes: JSON.stringify(input.lease),
    authorizeBeforeLink: () => assertCommandLeasePublicationAuthorityV2(input),
  });
  await assertCommandDirectoriesV2(input.fs, input.directories);
  const record = await readIdentifiedJsonRecord({
    fs: input.fs,
    canonicalRoot: input.directories.canonicalRoot,
    file: leaseFile,
  });
  await assertCommandDirectoriesV2(input.fs, input.directories);
  const parsed =
    record === null
      ? null
      : parseStudioDirectorCommandSlotLeaseV2(record.value, input.lease.acquiredAt, STUDIO_DIRECTOR_COMMAND_WAIT_MS);
  if (record === null || parsed === null || parsed.status !== 'valid' || !sameLeaseV2(parsed.record, input.lease)) {
    throw new RecordIoError('storage_error');
  }
  return { lease: parsed.record, identity: record.identity };
};

const releaseLeaseV2 = async (input: {
  fs: RecordIoFileSystem;
  directories: CommandDirectories;
  held: HeldLeaseV2;
  now: () => number;
}): Promise<boolean> => {
  if (input.now() >= Date.parse(input.held.lease.expiresAt)) return false;
  const leaseFile = path.join(input.directories.slots, '0.slot.lease');
  await assertCommandDirectoriesV2(input.fs, input.directories);
  const record = await readIdentifiedJsonRecord({
    fs: input.fs,
    canonicalRoot: input.directories.canonicalRoot,
    file: leaseFile,
  });
  if (record === null) return false;
  const current = parseStudioDirectorCommandSlotLeaseV2(
    record.value,
    new Date(input.now()).toISOString(),
    STUDIO_DIRECTOR_COMMAND_WAIT_MS
  );
  if (
    current.status !== 'valid' ||
    !sameLeaseV2(current.record, input.held.lease) ||
    record.identity.dev !== input.held.identity.dev ||
    record.identity.ino !== input.held.identity.ino ||
    input.now() >= Date.parse(input.held.lease.expiresAt)
  ) {
    return false;
  }
  return quarantineRemoveOwnedCommandRecordV2({
    fs: input.fs,
    directories: input.directories,
    parent: 'slots',
    file: leaseFile,
    identity: record.identity,
    missingIsSuccess: false,
    isStillAuthorized: async (phase) => {
      const authorizationMs = input.now();
      if (!Number.isFinite(authorizationMs) || authorizationMs >= Date.parse(input.held.lease.expiresAt)) {
        return false;
      }
      if (phase === 'named') {
        const named = await readLeaseV2({ fs: input.fs, directories: input.directories, nowMs: authorizationMs });
        if (
          named.status !== 'valid' ||
          !sameLeaseV2(named.lease, input.held.lease) ||
          named.identity.dev !== input.held.identity.dev ||
          named.identity.ino !== input.held.identity.ino
        ) {
          return false;
        }
      } else {
        await assertCommandDirectoriesV2(input.fs, input.directories);
      }
      const finalAuthorizationMs = input.now();
      return Number.isFinite(finalAuthorizationMs) && finalAuthorizationMs < Date.parse(input.held.lease.expiresAt);
    },
  });
};

const syncCommandDirectoryV2 = async (input: {
  fs: RecordIoFileSystem;
  directories: CommandDirectories;
  name: 'pending' | 'slots';
}): Promise<void> => {
  if (input.directories.v2Authority === undefined) throw new RecordIoError('unsafe_path');
  const directory = input.directories[input.name];
  const expected = input.directories.v2Authority[input.name];
  let handle: Awaited<ReturnType<RecordIoFileSystem['open']>> | undefined;
  try {
    await assertCommandDirectoriesV2(input.fs, input.directories);
    handle = await input.fs.open(directory, 'r');
    const stats = await handle.stat();
    if (!stats.isDirectory() || stats.dev !== expected.dev || stats.ino !== expected.ino) {
      throw new RecordIoError('unsafe_path');
    }
    await handle.sync();
    await handle.close();
    handle = undefined;
    await assertCommandDirectoriesV2(input.fs, input.directories);
  } finally {
    await handle?.close().catch((): undefined => undefined);
  }
};

const restoreQuarantinedCommandRecordV2 = async (input: {
  fs: RecordIoFileSystem;
  directories: CommandDirectories;
  parent: 'slots';
  file: string;
  quarantine: string;
}): Promise<void> => {
  try {
    await input.fs.link(input.quarantine, input.file);
    await input.fs.rm(input.quarantine);
    await syncCommandDirectoryV2({ fs: input.fs, directories: input.directories, name: input.parent });
  } catch {
    // The current name or quarantined replacement remains authoritative; delete neither.
  }
};

const quarantineRemoveOwnedCommandRecordV2 = async (input: {
  fs: RecordIoFileSystem;
  directories: CommandDirectories;
  parent: 'slots';
  file: string;
  identity: { dev: number; ino: number };
  missingIsSuccess: boolean;
  isStillAuthorized: (phase: 'named' | 'quarantined') => boolean | Promise<boolean>;
}): Promise<boolean> => {
  const quarantine = `${input.file}.${process.pid}_${++commandCleanupCounterV2}.cleanup`;
  try {
    await assertCommandDirectoriesV2(input.fs, input.directories);
    let current: Awaited<ReturnType<RecordIoFileSystem['lstat']>>;
    try {
      current = await input.fs.lstat(input.file);
    } catch (error) {
      if (!hasFileSystemCodeV2(error, 'ENOENT')) throw error;
      await assertCommandDirectoriesV2(input.fs, input.directories);
      return input.missingIsSuccess;
    }
    if (
      current.isSymbolicLink() ||
      !current.isFile() ||
      current.dev !== input.identity.dev ||
      current.ino !== input.identity.ino ||
      !(await input.isStillAuthorized('named'))
    ) {
      return false;
    }
    try {
      await input.fs.lstat(quarantine);
      return false;
    } catch (error) {
      if (!hasFileSystemCodeV2(error, 'ENOENT')) return false;
    }
    await input.fs.rename(input.file, quarantine);
    await assertCommandDirectoriesV2(input.fs, input.directories);
    const quarantined = await input.fs.lstat(quarantine);
    if (
      quarantined.isSymbolicLink() ||
      !quarantined.isFile() ||
      quarantined.dev !== input.identity.dev ||
      quarantined.ino !== input.identity.ino ||
      !(await input.isStillAuthorized('quarantined'))
    ) {
      await restoreQuarantinedCommandRecordV2({ ...input, quarantine });
      return false;
    }
    await input.fs.rm(quarantine);
    await syncCommandDirectoryV2({ fs: input.fs, directories: input.directories, name: input.parent });
    return true;
  } catch {
    return false;
  }
};

const publishCommandImmutableRecordV2 = async (input: {
  fs: RecordIoFileSystem;
  directories: CommandDirectories;
  parent: 'pending' | 'slots';
  file: string;
  bytes: string;
  authorizeBeforeLink: () => Promise<void>;
}): Promise<void> => {
  if (path.dirname(input.file) !== input.directories[input.parent]) {
    throw new CommandImmutablePublicationErrorV2('not_linked', new RecordIoError('unsafe_path'));
  }
  let linkAttempted = false;
  let linked = false;
  let authorizationFailure: unknown;
  const link: RecordIoFileSystem['link'] = async (existingPath, newPath) => {
    if (String(newPath) !== input.file) throw new RecordIoError('unsafe_path');
    try {
      await input.authorizeBeforeLink();
    } catch (error) {
      authorizationFailure = error;
      throw error;
    }
    linkAttempted = true;
    await input.fs.link(existingPath, newPath);
    linked = true;
  };
  const publishingFs = new Proxy(input.fs, {
    get(target, property, receiver) {
      if (property === 'link') return link;
      const value = Reflect.get(target, property, receiver) as unknown;
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  try {
    await publishImmutableRecord({
      fs: publishingFs,
      canonicalRoot: input.directories.canonicalRoot,
      file: input.file,
      bytes: input.bytes,
    });
    await syncCommandDirectoryV2({ fs: input.fs, directories: input.directories, name: input.parent });
  } catch (error) {
    const outcome =
      linked || (linkAttempted && !(error instanceof RecordIoError && error.code === 'already_exists'))
        ? 'ambiguous'
        : error instanceof RecordIoError && error.code === 'already_exists'
          ? 'already_exists'
          : 'not_linked';
    throw new CommandImmutablePublicationErrorV2(outcome, authorizationFailure ?? error);
  }
};

const assertCommandPublicationAuthorityV2 = async (input: {
  fs: RecordIoFileSystem;
  config: StudioDirectorCommandWriterConfig;
  projectAuthority: ProjectAuthorityV2;
  directories: CommandDirectories;
  held: HeldLeaseV2;
  slotAuthority:
    | { status: 'missing' }
    | { status: 'owned'; slot: StudioDirectorCommandSlotV2; identity: { dev: number; ino: number } };
  now: () => number;
}): Promise<void> => {
  const fail = (status: 'collision' | 'storage_error' | 'unsupported_prototype_schema'): never => {
    throw new CommandPublicationAuthorizationErrorV2(status);
  };
  await assertCommandDirectoriesV2(input.fs, input.directories);
  const lease = await readLeaseV2({ fs: input.fs, directories: input.directories, nowMs: input.now() });
  if (lease.status === 'unsupported_prototype_schema') fail('unsupported_prototype_schema');
  if (
    lease.status !== 'valid' ||
    !sameLeaseV2(lease.lease, input.held.lease) ||
    lease.identity.dev !== input.held.identity.dev ||
    lease.identity.ino !== input.held.identity.ino
  ) {
    fail('storage_error');
  }
  if (input.slotAuthority.status === 'missing') {
    try {
      const stats = await input.fs.lstat(path.join(input.directories.slots, '0.slot'));
      if (stats.isSymbolicLink() || !stats.isFile()) fail('storage_error');
      fail('collision');
    } catch (error) {
      if (error instanceof CommandPublicationAuthorizationErrorV2) throw error;
      if (!hasFileSystemCodeV2(error, 'ENOENT')) fail('storage_error');
    }
  } else {
    const slot = await readSlotV2({ fs: input.fs, directories: input.directories, nowMs: input.now() });
    if (slot.status === 'unsupported_prototype_schema') fail('unsupported_prototype_schema');
    if (
      slot.status !== 'valid' ||
      !sameSlotV2(slot.slot, input.slotAuthority.slot) ||
      slot.identity.dev !== input.slotAuthority.identity.dev ||
      slot.identity.ino !== input.slotAuthority.identity.ino
    ) {
      fail('storage_error');
    }
  }
  const authorityStatus = await projectAuthorityStatusV2(input.fs, input.config, input.projectAuthority);
  if (authorityStatus !== 'valid') {
    fail(authorityStatus === 'unsupported_prototype_schema' ? authorityStatus : 'storage_error');
  }
  await assertCommandDirectoriesV2(input.fs, input.directories);
  const currentMs = input.now();
  if (
    !Number.isFinite(currentMs) ||
    currentMs >= Date.parse(input.held.lease.expiresAt) ||
    currentMs >= Date.parse(input.held.lease.deadlineAt)
  ) {
    fail('storage_error');
  }
};

const settleNotLinkedReservationV2 = async (input: {
  fs: RecordIoFileSystem;
  directories: CommandDirectories;
  held: HeldLeaseV2;
  slot: StudioDirectorCommandSlotV2;
  slotIdentity: { dev: number; ino: number };
  now: () => number;
}): Promise<boolean> => {
  const currentMs = input.now();
  if (
    !Number.isFinite(currentMs) ||
    currentMs >= Date.parse(input.held.lease.expiresAt) ||
    currentMs >= Date.parse(input.slot.deadlineAt)
  ) {
    return false;
  }
  const lease = await readLeaseV2({ fs: input.fs, directories: input.directories, nowMs: currentMs });
  if (
    lease.status !== 'valid' ||
    !sameLeaseV2(lease.lease, input.held.lease) ||
    lease.identity.dev !== input.held.identity.dev ||
    lease.identity.ino !== input.held.identity.ino
  ) {
    return false;
  }
  const slot = await readSlotV2({ fs: input.fs, directories: input.directories, nowMs: input.now() });
  if (
    slot.status !== 'valid' ||
    !sameSlotV2(slot.slot, input.slot) ||
    slot.identity.dev !== input.slotIdentity.dev ||
    slot.identity.ino !== input.slotIdentity.ino
  ) {
    return releaseLeaseV2({ fs: input.fs, directories: input.directories, held: input.held, now: input.now });
  }
  const removed = await quarantineRemoveOwnedCommandRecordV2({
    fs: input.fs,
    directories: input.directories,
    parent: 'slots',
    file: path.join(input.directories.slots, '0.slot'),
    identity: input.slotIdentity,
    missingIsSuccess: true,
    isStillAuthorized: async () => {
      const authorizationMs = input.now();
      if (
        !Number.isFinite(authorizationMs) ||
        authorizationMs >= Date.parse(input.held.lease.expiresAt) ||
        authorizationMs >= Date.parse(input.slot.deadlineAt)
      ) {
        return false;
      }
      const currentLease = await readLeaseV2({
        fs: input.fs,
        directories: input.directories,
        nowMs: authorizationMs,
      });
      const finalAuthorizationMs = input.now();
      return (
        currentLease.status === 'valid' &&
        sameLeaseV2(currentLease.lease, input.held.lease) &&
        currentLease.identity.dev === input.held.identity.dev &&
        currentLease.identity.ino === input.held.identity.ino &&
        Number.isFinite(finalAuthorizationMs) &&
        finalAuthorizationMs < Date.parse(input.held.lease.expiresAt) &&
        finalAuthorizationMs < Date.parse(input.slot.deadlineAt)
      );
    },
  });
  if (!removed) return false;
  return releaseLeaseV2({ fs: input.fs, directories: input.directories, held: input.held, now: input.now });
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

/** Staged schema-2 writer. The registered subprocess keeps using the schema-1 factory through Gate 1. */
export const createStudioDirectorCommandWriterV2 = (
  config: StudioDirectorCommandWriterConfig | null,
  injected: StudioDirectorCommandWriterDeps = {}
): StudioDirectorCommandWriterV2 => {
  const fs = injected.fs ?? nodeFs;
  const now = injected.now ?? Date.now;
  const createId = injected.createId ?? randomUUID;
  const sleep = injected.sleep ?? defaultSleep;

  const getStatus = async (input: StudioGetCommandStatusInput): Promise<StudioDirectorToolStatusResultV2> => {
    if (!isSafeStudioDirectorId(input.commandId) || config === null || !isSafeStudioDirectorId(config.projectId)) {
      return storageError(input.commandId);
    }
    try {
      const projectAuthority = await captureProjectAuthorityV2(fs, config);
      if (projectAuthority.status === 'unsupported_prototype_schema') return unsupportedV2(input.commandId);
      if (projectAuthority.status !== 'valid') return storageError(input.commandId);
      const directories = await resolveCommandDirectoriesV2(fs, projectAuthority.authority);
      const preflight = await preflightCommandAuthorityV2({
        fs,
        directories,
        projectId: config.projectId,
        commandId: input.commandId,
        nowMs: now(),
      });
      const authorityStatus = await projectAuthorityStatusV2(fs, config, projectAuthority.authority);
      if (authorityStatus !== 'valid') {
        return authorityStatus === 'unsupported_prototype_schema'
          ? unsupportedV2(input.commandId)
          : storageError(input.commandId);
      }
      if (preflightHasStatusV2(preflight, 'unsupported_prototype_schema')) return unsupportedV2(input.commandId);
      if (preflightHasStatusV2(preflight, 'invalid')) return storageError(input.commandId);
      if (preflight.receipt.status === 'valid') return preflight.receipt.record;
      if (preflight.pending.status === 'valid') return { status: 'pending', commandId: input.commandId };
      if (
        (preflight.slot.status === 'valid' && preflight.slot.slot.commandId === input.commandId) ||
        (preflight.lease.status === 'valid' && preflight.lease.lease.commandId === input.commandId)
      ) {
        return { status: 'pending', commandId: input.commandId };
      }
      return { status: 'not_found', commandId: input.commandId };
    } catch {
      return storageError(input.commandId);
    }
  };

  const apply = async (toolInput: StudioApplyEditsInputV2): Promise<StudioDirectorToolApplyResultV2> => {
    const { commandId, prepared } = prepareCommandV2({ config, toolInput, now, createId });
    if (prepared === null || config === null) return storageError(commandId);
    let directories: CommandDirectories;
    let projectAuthority: ProjectAuthorityV2;
    try {
      const captured = await captureProjectAuthorityV2(fs, config);
      if (captured.status === 'unsupported_prototype_schema') return unsupportedV2(commandId);
      if (captured.status !== 'valid') return storageError(commandId);
      projectAuthority = captured.authority;
      directories = await resolveCommandDirectoriesV2(fs, projectAuthority);
    } catch {
      return storageError(commandId);
    }

    try {
      const preflight = await preflightCommandAuthorityV2({
        fs,
        directories,
        projectId: config.projectId,
        commandId,
        nowMs: now(),
      });
      if (preflightHasStatusV2(preflight, 'unsupported_prototype_schema')) return unsupportedV2(commandId);
      if (preflightHasStatusV2(preflight, 'invalid')) return storageError(commandId);
      if (preflight.receipt.status === 'valid' || preflight.pending.status === 'valid') return storageError(commandId);
      if (preflight.slot.status === 'valid') return { status: 'busy', commandId: preflight.slot.slot.commandId };
      if (preflight.lease.status === 'valid') {
        const incumbentCommandId = preflight.lease.lease.commandId;
        return incumbentCommandId === null
          ? storageError(commandId)
          : { status: 'busy', commandId: incumbentCommandId };
      }
      const authorityStatus = await projectAuthorityStatusV2(fs, config, projectAuthority);
      if (authorityStatus !== 'valid') {
        return authorityStatus === 'unsupported_prototype_schema' ? unsupportedV2(commandId) : storageError(commandId);
      }
    } catch {
      return storageError(commandId);
    }

    const slotFile = path.join(directories.slots, '0.slot');
    let held: HeldLeaseV2;
    try {
      held = await acquireLeaseV2({ fs, config, projectAuthority, directories, lease: prepared.lease, now });
    } catch (error) {
      if (error instanceof CommandImmutablePublicationErrorV2) {
        if (error.outcome === 'ambiguous') return storageError(commandId);
        if (error.publicationCause instanceof CommandPublicationAuthorizationErrorV2) {
          return error.publicationCause.status === 'unsupported_prototype_schema'
            ? unsupportedV2(commandId)
            : storageError(commandId);
        }
        if (error.outcome !== 'already_exists') return storageError(commandId);
      } else {
        return storageError(commandId);
      }
      try {
        const collision = await readLeaseV2({ fs, directories, nowMs: now() });
        if (collision.status === 'unsupported_prototype_schema') return unsupportedV2(commandId);
        if (collision.status === 'valid' && !sameLeaseV2(collision.lease, prepared.lease)) {
          const incumbentCommandId = collision.lease.commandId;
          return incumbentCommandId === null
            ? storageError(commandId)
            : { status: 'busy', commandId: incumbentCommandId };
        }
        return storageError(commandId);
      } catch {
        return storageError(commandId);
      }
    }

    let ownedSlotIdentity: { dev: number; ino: number } | undefined;
    let slotPublished = false;
    try {
      const authorityStatus = await projectAuthorityStatusV2(fs, config, projectAuthority);
      if (authorityStatus !== 'valid') {
        const released = await releaseLeaseV2({ fs, directories, held, now });
        if (!released) return storageError(commandId);
        return authorityStatus === 'unsupported_prototype_schema' ? unsupportedV2(commandId) : storageError(commandId);
      }
      if (now() >= Date.parse(held.lease.expiresAt)) return storageError(commandId);
      const existing = await readSlotV2({ fs, directories, nowMs: now() });
      if (existing.status !== 'missing') {
        const released = await releaseLeaseV2({ fs, directories, held, now });
        if (!released) return storageError(commandId);
        if (existing.status === 'unsupported_prototype_schema') return unsupportedV2(commandId);
        if (existing.status === 'invalid') return storageError(commandId);
        return { status: 'busy', commandId: existing.slot.commandId };
      }
      await assertCommandDirectoriesV2(fs, directories);
      await publishCommandImmutableRecordV2({
        fs,
        directories,
        parent: 'slots',
        file: slotFile,
        bytes: prepared.slotBytes,
        authorizeBeforeLink: () =>
          assertCommandPublicationAuthorityV2({
            fs,
            config,
            projectAuthority,
            directories,
            held,
            slotAuthority: { status: 'missing' },
            now,
          }),
      });
      slotPublished = true;
      await assertCommandDirectoriesV2(fs, directories);
      const publishedSlot = await readSlotV2({ fs, directories, nowMs: now() });
      if (publishedSlot.status !== 'valid' || !sameSlotV2(publishedSlot.slot, prepared.slot)) {
        throw new RecordIoError('storage_error');
      }
      ownedSlotIdentity = publishedSlot.identity;
      if (now() >= Date.parse(held.lease.expiresAt)) return storageError(commandId);
    } catch (error) {
      if (slotPublished || (error instanceof CommandImmutablePublicationErrorV2 && error.outcome === 'ambiguous')) {
        return storageError(commandId);
      }
      let result: StudioDirectorToolApplyResultV2 = storageError(commandId);
      if (
        error instanceof CommandImmutablePublicationErrorV2 &&
        (error.outcome === 'already_exists' ||
          (error.publicationCause instanceof CommandPublicationAuthorizationErrorV2 &&
            error.publicationCause.status === 'collision'))
      ) {
        try {
          const collision = await readSlotV2({ fs, directories, nowMs: now() });
          if (collision.status === 'unsupported_prototype_schema') result = unsupportedV2(commandId);
          if (collision.status === 'valid') result = { status: 'busy', commandId: collision.slot.commandId };
        } catch {
          result = storageError(commandId);
        }
      } else if (
        error instanceof CommandImmutablePublicationErrorV2 &&
        error.publicationCause instanceof CommandPublicationAuthorizationErrorV2
      ) {
        const authorization = error.publicationCause;
        if (authorization.status === 'unsupported_prototype_schema') result = unsupportedV2(commandId);
      }
      const released = await releaseLeaseV2({ fs, directories, held, now }).catch(() => false);
      return released ? result : storageError(commandId);
    }

    try {
      const authorityStatus = await projectAuthorityStatusV2(fs, config, projectAuthority);
      if (authorityStatus !== 'valid') {
        if (ownedSlotIdentity === undefined) return storageError(commandId);
        const cleaned = await settleNotLinkedReservationV2({
          fs,
          directories,
          held,
          slot: prepared.slot,
          slotIdentity: ownedSlotIdentity,
          now,
        });
        if (!cleaned) return storageError(commandId);
        return authorityStatus === 'unsupported_prototype_schema' ? unsupportedV2(commandId) : storageError(commandId);
      }
      if (ownedSlotIdentity === undefined) return storageError(commandId);
      const currentSlot = await readSlotV2({ fs, directories, nowMs: now() });
      if (currentSlot.status === 'unsupported_prototype_schema') {
        const released = await releaseLeaseV2({ fs, directories, held, now });
        return released ? unsupportedV2(commandId) : storageError(commandId);
      }
      if (currentSlot.status !== 'valid') {
        await releaseLeaseV2({ fs, directories, held, now }).catch((): undefined => undefined);
        return storageError(commandId);
      }
      if (!sameSlotV2(currentSlot.slot, prepared.slot)) {
        const released = await releaseLeaseV2({ fs, directories, held, now });
        return released ? { status: 'busy', commandId: currentSlot.slot.commandId } : storageError(commandId);
      }
      if (currentSlot.identity.dev !== ownedSlotIdentity.dev || currentSlot.identity.ino !== ownedSlotIdentity.ino) {
        await releaseLeaseV2({ fs, directories, held, now }).catch((): undefined => undefined);
        return storageError(commandId);
      }
    } catch {
      await releaseLeaseV2({ fs, directories, held, now }).catch((): undefined => undefined);
      return storageError(commandId);
    }

    const pendingFile = path.join(directories.pending, `${commandId}.json`);
    let pendingPublished = false;
    try {
      if (ownedSlotIdentity === undefined) return storageError(commandId);
      await assertCommandDirectoriesV2(fs, directories);
      await publishCommandImmutableRecordV2({
        fs,
        directories,
        parent: 'pending',
        file: pendingFile,
        bytes: prepared.commandBytes,
        authorizeBeforeLink: () =>
          assertCommandPublicationAuthorityV2({
            fs,
            config,
            projectAuthority,
            directories,
            held,
            slotAuthority: { status: 'owned', slot: prepared.slot, identity: ownedSlotIdentity },
            now,
          }),
      });
      pendingPublished = true;
      await assertCommandDirectoriesV2(fs, directories);
      if (!(await releaseLeaseV2({ fs, directories, held, now }))) return storageError(commandId);
    } catch (error) {
      if (pendingPublished || (error instanceof CommandImmutablePublicationErrorV2 && error.outcome === 'ambiguous')) {
        return storageError(commandId);
      }
      let collisionStatus: 'unsupported_prototype_schema' | 'invalid' | null = null;
      if (error instanceof CommandImmutablePublicationErrorV2 && error.outcome === 'already_exists') {
        try {
          const collided = await readJsonRecord({
            fs,
            canonicalRoot: directories.canonicalRoot,
            file: pendingFile,
          });
          if (collided !== null) {
            const parsedStatus = pendingRecordStatusV2({
              projectId: config.projectId,
              commandId,
              value: collided,
              nowMs: now(),
            });
            if (parsedStatus !== 'valid') collisionStatus = parsedStatus;
          }
        } catch {
          return storageError(commandId);
        }
      } else if (
        error instanceof CommandImmutablePublicationErrorV2 &&
        error.publicationCause instanceof CommandPublicationAuthorizationErrorV2 &&
        error.publicationCause.status === 'unsupported_prototype_schema'
      ) {
        collisionStatus = 'unsupported_prototype_schema';
      }
      try {
        if (ownedSlotIdentity === undefined) return storageError(commandId);
        const cleaned = await settleNotLinkedReservationV2({
          fs,
          directories,
          held,
          slot: prepared.slot,
          slotIdentity: ownedSlotIdentity,
          now,
        });
        if (!cleaned) return storageError(commandId);
      } catch {
        // A slot that cannot be re-proven stays durable for main-process recovery.
        return storageError(commandId);
      }
      return collisionStatus === 'unsupported_prototype_schema' ? unsupportedV2(commandId) : storageError(commandId);
    }

    try {
      const authorityStatus = await projectAuthorityStatusForReceiptPollingV2(fs, config, projectAuthority);
      if (authorityStatus !== 'valid') {
        return authorityStatus === 'unsupported_prototype_schema' ? unsupportedV2(commandId) : storageError(commandId);
      }
    } catch {
      return storageError(commandId);
    }

    const readReceipt = (): Promise<Awaited<ReturnType<typeof readNamedReceiptV2>>> =>
      readNamedReceiptV2({
        fs,
        directories,
        projectId: config.projectId,
        commandId,
        publicationAuthority: { config, project: projectAuthority },
      });
    try {
      let receipt = await readReceipt();
      if (receipt.status === 'valid') return receipt.record;
      if (receipt.status === 'unsupported_prototype_schema') return unsupportedV2(commandId);
      if (receipt.status === 'invalid') return storageError(commandId);
      const deadlineMs = Date.parse(prepared.command.deadlineAt);
      while (now() < deadlineMs) {
        const remainingMs = Math.max(0, deadlineMs - now());
        // eslint-disable-next-line no-await-in-loop
        await sleep(Math.min(STUDIO_DIRECTOR_COMMAND_SWEEP_INTERVAL_MS, remainingMs));
        // eslint-disable-next-line no-await-in-loop
        receipt = await readReceipt();
        if (receipt.status === 'valid') return receipt.record;
        if (receipt.status === 'unsupported_prototype_schema') return unsupportedV2(commandId);
        if (receipt.status === 'invalid') return storageError(commandId);
      }
      receipt = await readReceipt();
      if (receipt.status === 'valid') return receipt.record;
      if (receipt.status === 'unsupported_prototype_schema') return unsupportedV2(commandId);
      if (receipt.status === 'invalid') return storageError(commandId);
      return { status: 'unconfirmed', commandId };
    } catch {
      return storageError(commandId);
    }
  };

  return { apply, getStatus };
};
