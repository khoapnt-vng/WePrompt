/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs/promises';
import path from 'node:path';
import { STUDIO_PROJECT_SCHEMA_VERSION } from '@/common/types/project/creativeStudioTypes';
import {
  RecordIoError,
  type RecordIoFileSystem,
  readBoundedRegularFileWithIdentity,
  resolveCompleteDirectorySet,
} from '@process/services/creative-studio/service/recordIo';
import {
  parseStudioProposalSlotV2,
  parseStudioReferenceRequestSlotV2,
} from '@process/services/creative-studio/service/directorCommandContracts';

// Shared subprocess-side disk contract: an O_EXCL slot caps pending records,
// an exclusive write prevents replacement, and main re-validates every record.
const MAX_RECORD_BYTES = 256 * 1024;
const MAX_PENDING_PER_PROJECT = 50;

const SAFE_RECORD_ID = /^[A-Za-z0-9_-]{1,256}$/;

export type StudioPendingRecordWriteErrorCode = 'capacity' | 'too_large' | 'storage' | 'unsupported_prototype_schema';

export class StudioPendingRecordWriteError extends Error {
  constructor(
    public readonly code: StudioPendingRecordWriteErrorCode,
    message: string
  ) {
    super(message);
  }
}

type WritePendingRecordInput<RecordType> = {
  pendingDir: string;
  recordId: string;
  record: RecordType;
  // Proposal slots must retain proposalId for the main-process validateProposalSlot contract.
  slotRecordKey: 'proposalId' | 'requestId';
  capacityMessage: string;
  tooLargeMessage: string;
  /** V2-only test seam; the schema-1 implementation deliberately ignores it. */
  fs?: RecordIoFileSystem;
  /** V2-only manifest authority fence; V1 deliberately ignores it. */
  authorityFence?: () => Promise<'valid' | 'unsupported_prototype_schema' | 'invalid'>;
  /** Binds V2 sidecars to the exact project-root generation that authorized them. */
  projectAuthority?: StudioPendingProjectAuthorityV2;
};

export type StudioPendingProjectAuthorityV2 = {
  canonicalRoot: string;
  rootIdentity: { dev: number; ino: number };
};

const slotsDirOf = (pendingDir: string): string => path.join(path.dirname(pendingDir), 'slots');

const reserveSlot = async (
  slotsDir: string,
  recordId: string,
  slotRecordKey: WritePendingRecordInput<unknown>['slotRecordKey'],
  capacityMessage: string
): Promise<string> => {
  const reservation = JSON.stringify({
    schemaVersion: 1,
    [slotRecordKey]: recordId,
    reservedAt: new Date().toISOString(),
  });
  for (let index = 0; index < MAX_PENDING_PER_PROJECT; index += 1) {
    const file = path.join(slotsDir, `${index}.slot`);
    let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
    try {
      handle = await fs.open(file, 'wx');
      await handle.writeFile(reservation, { encoding: 'utf8' });
      await handle.sync();
      return file;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') continue;
      throw new StudioPendingRecordWriteError('storage', error instanceof Error ? error.message : 'slot write failed');
    } finally {
      await handle?.close().catch((): undefined => undefined);
    }
  }
  throw new StudioPendingRecordWriteError('capacity', capacityMessage);
};

/** Publishes one bounded immutable record after atomically reserving queue capacity. */
export const writePendingRecord = async <RecordType>(
  input: WritePendingRecordInput<RecordType>
): Promise<RecordType> => {
  const serialized = JSON.stringify(input.record);
  if (Buffer.byteLength(serialized, 'utf8') > MAX_RECORD_BYTES) {
    throw new StudioPendingRecordWriteError('too_large', input.tooLargeMessage);
  }

  const slotFile = await reserveSlot(
    slotsDirOf(input.pendingDir),
    input.recordId,
    input.slotRecordKey,
    input.capacityMessage
  );
  const file = path.join(input.pendingDir, `${input.recordId}.json`);
  const temporaryFile = `${file}.${process.pid}.tmp`;
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
  try {
    handle = await fs.open(temporaryFile, 'wx');
    await handle.writeFile(serialized, { encoding: 'utf8' });
    await handle.sync();
    await handle.close();
    handle = undefined;
    await fs.link(temporaryFile, file);
    await fs.rm(temporaryFile);
    return input.record;
  } catch (error) {
    await handle?.close().catch((): undefined => undefined);
    await fs.rm(temporaryFile, { force: true }).catch((): undefined => undefined);
    await fs.rm(slotFile, { force: true }).catch((): undefined => undefined);
    throw new StudioPendingRecordWriteError('storage', error instanceof Error ? error.message : 'record write failed');
  }
};

type DirectoryAuthorityV2 = { path: string; dev: number; ino: number };
type PendingDirectoriesV2 = {
  canonicalRoot: string;
  pending: DirectoryAuthorityV2;
  slots: DirectoryAuthorityV2;
};

const captureDirectoryAuthorityV2 = async (
  recordFs: RecordIoFileSystem,
  directory: string
): Promise<DirectoryAuthorityV2> => {
  const stats = await recordFs.lstat(directory);
  if (!stats.isDirectory() || stats.isSymbolicLink() || (await recordFs.realpath(directory)) !== directory) {
    throw new RecordIoError('unsafe_path');
  }
  return { path: directory, dev: stats.dev, ino: stats.ino };
};

const assertDirectoryAuthorityV2 = async (
  recordFs: RecordIoFileSystem,
  authority: DirectoryAuthorityV2
): Promise<void> => {
  const current = await captureDirectoryAuthorityV2(recordFs, authority.path);
  if (current.dev !== authority.dev || current.ino !== authority.ino) throw new RecordIoError('unsafe_path');
};

const syncDirectoryAuthorityV2 = async (
  recordFs: RecordIoFileSystem,
  authority: DirectoryAuthorityV2
): Promise<void> => {
  await assertDirectoryAuthorityV2(recordFs, authority);
  const handle = await recordFs.open(authority.path, 'r');
  try {
    const stats = await handle.stat();
    if (!stats.isDirectory() || !sameIdentityV2(stats, authority)) throw new RecordIoError('unsafe_path');
    await handle.sync();
  } finally {
    await handle.close();
  }
  await assertDirectoryAuthorityV2(recordFs, authority);
};

const resolvePendingDirectoriesV2 = async (
  pendingDir: string,
  recordFs: RecordIoFileSystem,
  projectAuthority?: StudioPendingProjectAuthorityV2
): Promise<PendingDirectoriesV2> => {
  const configuredPending = path.resolve(pendingDir);
  if (path.basename(configuredPending) !== 'pending') throw new RecordIoError('unsafe_path');
  const familyRoot = path.dirname(configuredPending);
  const projectRoot = path.dirname(familyRoot);
  const familyName = path.basename(familyRoot);
  if (!SAFE_RECORD_ID.test(familyName)) throw new RecordIoError('unsafe_path');
  try {
    const rootStats = await recordFs.lstat(projectRoot);
    if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) throw new RecordIoError('unsafe_path');
    const canonicalRoot = await recordFs.realpath(projectRoot);
    if (
      projectAuthority !== undefined &&
      (canonicalRoot !== projectAuthority.canonicalRoot ||
        rootStats.dev !== projectAuthority.rootIdentity.dev ||
        rootStats.ino !== projectAuthority.rootIdentity.ino)
    ) {
      throw new RecordIoError('unsafe_path');
    }
    const directories = await resolveCompleteDirectorySet({
      fs: recordFs,
      canonicalRoot,
      parent: canonicalRoot,
      rootName: familyName,
      childNames: ['pending', 'slots'] as const,
      createIfWhollyAbsent: false,
    });
    if (directories === null || (await recordFs.realpath(configuredPending)) !== directories.pending) {
      throw new RecordIoError('partial_directory_set');
    }
    return {
      canonicalRoot,
      pending: await captureDirectoryAuthorityV2(recordFs, directories.pending),
      slots: await captureDirectoryAuthorityV2(recordFs, directories.slots),
    };
  } catch (error) {
    throw error instanceof RecordIoError ? error : new RecordIoError('storage_error');
  }
};

/** Read-only root/generation assertion for V2 queue reads that happen before publication. */
export const assertPendingRecordProjectAuthorityV2 = async (input: {
  pendingDir: string;
  projectAuthority: StudioPendingProjectAuthorityV2;
  fs?: RecordIoFileSystem;
}): Promise<void> => {
  await resolvePendingDirectoriesV2(input.pendingDir, input.fs ?? fs, input.projectAuthority);
};

class ExclusivePublicationErrorV2 extends Error {
  constructor(public readonly outcome: 'already_exists' | 'not_linked' | 'ambiguous') {
    super('Exclusive publication failed');
  }
}

let publicationCounterV2 = 0;
let cleanupCounterV2 = 0;

const hasErrorCodeV2 = (error: unknown, code: string): boolean =>
  typeof error === 'object' && error !== null && !Array.isArray(error) && (error as { code?: unknown }).code === code;

const sameIdentityV2 = (stats: { dev: number; ino: number }, identity: { dev: number; ino: number }): boolean =>
  stats.dev === identity.dev && stats.ino === identity.ino;

const removeOwnedTemporaryV2 = async (input: {
  fs: RecordIoFileSystem;
  parent: DirectoryAuthorityV2;
  file: string;
  identity: { dev: number; ino: number } | null;
}): Promise<void> => {
  if (input.identity === null) return;
  try {
    await assertDirectoryAuthorityV2(input.fs, input.parent);
    const stats = await input.fs.lstat(input.file);
    if (stats.isFile() && !stats.isSymbolicLink() && sameIdentityV2(stats, input.identity)) {
      await input.fs.rm(input.file);
    }
  } catch {
    // A uniquely named non-authoritative temp may remain; never chase it through lost authority.
  }
};

/** Returns only after the exact linked inode and its parent directory entry are durably committed. */
const publishOwnedExclusiveRecordV2 = async (input: {
  fs: RecordIoFileSystem;
  parent: DirectoryAuthorityV2;
  file: string;
  bytes: string;
  authorizeBeforeLink?: () => Promise<void>;
}): Promise<{ dev: number; ino: number }> => {
  if (path.dirname(input.file) !== input.parent.path) throw new ExclusivePublicationErrorV2('not_linked');
  const temporaryFile = `${input.file}.${process.pid}_${++publicationCounterV2}.tmp`;
  let temporaryHandle: Awaited<ReturnType<RecordIoFileSystem['open']>> | undefined;
  let directoryHandle: Awaited<ReturnType<RecordIoFileSystem['open']>> | undefined;
  let temporaryIdentity: { dev: number; ino: number } | null = null;
  let linkAttempted = false;
  let linked = false;
  let committed = false;
  try {
    await assertDirectoryAuthorityV2(input.fs, input.parent);
    temporaryHandle = await input.fs.open(temporaryFile, 'wx');
    const temporaryStats = await temporaryHandle.stat();
    temporaryIdentity = { dev: temporaryStats.dev, ino: temporaryStats.ino };
    await assertDirectoryAuthorityV2(input.fs, input.parent);
    if (!temporaryStats.isFile()) throw new RecordIoError('unsafe_file');
    await temporaryHandle.writeFile(input.bytes, { encoding: 'utf8' });
    await temporaryHandle.sync();
    await assertDirectoryAuthorityV2(input.fs, input.parent);
    await temporaryHandle.close();
    temporaryHandle = undefined;

    const namedTempStats = await input.fs.lstat(temporaryFile);
    if (
      namedTempStats.isSymbolicLink() ||
      !namedTempStats.isFile() ||
      !sameIdentityV2(namedTempStats, temporaryIdentity)
    ) {
      throw new RecordIoError('unsafe_file');
    }
    await assertDirectoryAuthorityV2(input.fs, input.parent);
    await input.authorizeBeforeLink?.();
    await assertDirectoryAuthorityV2(input.fs, input.parent);
    try {
      linkAttempted = true;
      await input.fs.link(temporaryFile, input.file);
      linked = true;
    } catch (error) {
      if (hasErrorCodeV2(error, 'EEXIST')) throw new ExclusivePublicationErrorV2('already_exists');
      throw error;
    }
    await assertDirectoryAuthorityV2(input.fs, input.parent);
    const targetStats = await input.fs.lstat(input.file);
    if (targetStats.isSymbolicLink() || !targetStats.isFile() || !sameIdentityV2(targetStats, temporaryIdentity)) {
      throw new RecordIoError('unsafe_file');
    }

    directoryHandle = await input.fs.open(input.parent.path, 'r');
    const directoryStats = await directoryHandle.stat();
    if (!directoryStats.isDirectory() || !sameIdentityV2(directoryStats, input.parent)) {
      throw new RecordIoError('unsafe_path');
    }
    await directoryHandle.sync();
    await directoryHandle.close();
    directoryHandle = undefined;
    await assertDirectoryAuthorityV2(input.fs, input.parent);
    const committedTargetStats = await input.fs.lstat(input.file);
    if (
      committedTargetStats.isSymbolicLink() ||
      !committedTargetStats.isFile() ||
      !sameIdentityV2(committedTargetStats, temporaryIdentity)
    ) {
      throw new RecordIoError('unsafe_file');
    }
    committed = true;
    return temporaryIdentity;
  } catch (error) {
    if (error instanceof ExclusivePublicationErrorV2 || error instanceof StudioPendingRecordWriteError) throw error;
    throw new ExclusivePublicationErrorV2(linked || linkAttempted ? 'ambiguous' : 'not_linked');
  } finally {
    await temporaryHandle?.close().catch((): undefined => undefined);
    await directoryHandle?.close().catch((): undefined => undefined);
    if (!linked || committed) {
      await removeOwnedTemporaryV2({
        fs: input.fs,
        parent: input.parent,
        file: temporaryFile,
        identity: temporaryIdentity,
      });
    }
  }
};

type SidecarSchemaV2 = 'missing' | 'v1' | 'v2' | 'invalid';

const readSidecarSchemaV2 = async (input: {
  fs: RecordIoFileSystem;
  canonicalRoot: string;
  parent: DirectoryAuthorityV2;
  file: string;
  slotRecordKey?: WritePendingRecordInput<unknown>['slotRecordKey'];
}): Promise<SidecarSchemaV2> => {
  await assertDirectoryAuthorityV2(input.fs, input.parent);
  const record = await readBoundedRegularFileWithIdentity({
    fs: input.fs,
    canonicalRoot: input.canonicalRoot,
    file: input.file,
    maxBytes: MAX_RECORD_BYTES,
  });
  await assertDirectoryAuthorityV2(input.fs, input.parent);
  if (record === null) return 'missing';
  try {
    const value = JSON.parse(record.bytes) as unknown;
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return 'invalid';
    const descriptor = Object.getOwnPropertyDescriptor(value, 'schemaVersion');
    if (descriptor === undefined || !('value' in descriptor)) return 'invalid';
    if (descriptor.value === 1) return 'v1';
    if (descriptor.value !== STUDIO_PROJECT_SCHEMA_VERSION) return 'invalid';
    if (input.slotRecordKey === undefined) return 'v2';
    const parsed =
      input.slotRecordKey === 'proposalId'
        ? parseStudioProposalSlotV2(value)
        : parseStudioReferenceRequestSlotV2(value);
    if (parsed.status === 'valid') return 'v2';
    return parsed.status === 'unsupported_prototype_schema' ? 'v1' : 'invalid';
  } catch {
    return 'invalid';
  }
};

const throwForSidecarSchemaV2 = (schema: Exclude<SidecarSchemaV2, 'missing' | 'v2'>): never => {
  if (schema === 'v1') {
    throw new StudioPendingRecordWriteError('unsupported_prototype_schema', 'unsupported_prototype_schema');
  }
  throw new StudioPendingRecordWriteError('storage', 'Invalid schema-2 sidecar');
};

const assertPendingAuthorityV2 = async (fence: WritePendingRecordInput<unknown>['authorityFence']): Promise<void> => {
  if (fence === undefined) return;
  const status = await fence();
  if (status === 'valid') return;
  if (status === 'unsupported_prototype_schema') throwForSidecarSchemaV2('v1');
  throw new StudioPendingRecordWriteError('storage', 'Invalid schema-2 project authority');
};

const preflightPendingFamilyV2 = async (input: {
  fs: RecordIoFileSystem;
  directories: PendingDirectoriesV2;
  recordId: string;
  slotRecordKey: WritePendingRecordInput<unknown>['slotRecordKey'];
}): Promise<void> => {
  const schemas: SidecarSchemaV2[] = [
    await readSidecarSchemaV2({
      fs: input.fs,
      canonicalRoot: input.directories.canonicalRoot,
      parent: input.directories.pending,
      file: path.join(input.directories.pending.path, `${input.recordId}.json`),
    }),
  ];
  for (let index = 0; index < MAX_PENDING_PER_PROJECT; index += 1) {
    // eslint-disable-next-line no-await-in-loop
    schemas.push(
      // eslint-disable-next-line no-await-in-loop
      await readSidecarSchemaV2({
        fs: input.fs,
        canonicalRoot: input.directories.canonicalRoot,
        parent: input.directories.slots,
        file: path.join(input.directories.slots.path, `${index}.slot`),
        slotRecordKey: input.slotRecordKey,
      })
    );
  }
  if (schemas.includes('v1')) throwForSidecarSchemaV2('v1');
  if (schemas[0] !== 'missing' || schemas.includes('invalid')) {
    if (schemas.includes('invalid')) throwForSidecarSchemaV2('invalid');
    throw new StudioPendingRecordWriteError('storage', 'Record already exists');
  }
};

const reserveSlotV2 = async (input: {
  fs: RecordIoFileSystem;
  directories: PendingDirectoriesV2;
  recordId: string;
  slotRecordKey: WritePendingRecordInput<unknown>['slotRecordKey'];
  capacityMessage: string;
}): Promise<{ file: string; identity: { dev: number; ino: number } }> => {
  const bytes = JSON.stringify({
    schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
    [input.slotRecordKey]: input.recordId,
    reservedAt: new Date().toISOString(),
  });
  for (let index = 0; index < MAX_PENDING_PER_PROJECT; index += 1) {
    const file = path.join(input.directories.slots.path, `${index}.slot`);
    try {
      const identity = await publishOwnedExclusiveRecordV2({
        fs: input.fs,
        parent: input.directories.slots,
        file,
        bytes,
      });
      return { file, identity };
    } catch (error) {
      if (error instanceof ExclusivePublicationErrorV2 && error.outcome === 'already_exists') {
        // The collision may be a late V1 authority installation; classify it before continuing.
        // eslint-disable-next-line no-await-in-loop
        const schema = await readSidecarSchemaV2({
          fs: input.fs,
          canonicalRoot: input.directories.canonicalRoot,
          parent: input.directories.slots,
          file,
          slotRecordKey: input.slotRecordKey,
        });
        if (schema === 'v1' || schema === 'invalid') throwForSidecarSchemaV2(schema);
        continue;
      }
      throw error;
    }
  }
  throw new StudioPendingRecordWriteError('capacity', input.capacityMessage);
};

/**
 * Atomically quarantines the current slot name before deleting it. If the name was replaced after
 * our identity check, the replacement is restored from quarantine instead of being path-unlinked.
 */
const cleanupReservedSlotV2 = async (input: {
  fs: RecordIoFileSystem;
  directories: PendingDirectoriesV2;
  slot: { file: string; identity: { dev: number; ino: number } };
}): Promise<boolean> => {
  const quarantine = `${input.slot.file}.${process.pid}_${++cleanupCounterV2}.cleanup`;
  try {
    await assertDirectoryAuthorityV2(input.fs, input.directories.slots);
    let current: Awaited<ReturnType<RecordIoFileSystem['lstat']>>;
    try {
      current = await input.fs.lstat(input.slot.file);
    } catch (error) {
      if (!hasErrorCodeV2(error, 'ENOENT')) throw error;
      await assertDirectoryAuthorityV2(input.fs, input.directories.slots);
      return true;
    }
    if (current.isSymbolicLink() || !current.isFile() || !sameIdentityV2(current, input.slot.identity)) return false;
    try {
      await input.fs.lstat(quarantine);
      return false;
    } catch (error) {
      if (!hasErrorCodeV2(error, 'ENOENT')) return false;
    }
    await input.fs.rename(input.slot.file, quarantine);
    await assertDirectoryAuthorityV2(input.fs, input.directories.slots);
    const quarantined = await input.fs.lstat(quarantine);
    if (quarantined.isSymbolicLink() || !quarantined.isFile() || !sameIdentityV2(quarantined, input.slot.identity)) {
      // The source name changed in the lstat-to-rename window. Restore exactly what rename moved.
      try {
        await input.fs.link(quarantine, input.slot.file);
        await input.fs.rm(quarantine);
        await syncDirectoryAuthorityV2(input.fs, input.directories.slots);
      } catch {
        // A current slot or the quarantined replacement remains authoritative; delete neither.
      }
      return false;
    }
    await input.fs.rm(quarantine);
    await syncDirectoryAuthorityV2(input.fs, input.directories.slots);
    return true;
  } catch {
    return false;
  }
};

const reservedSlotIsCurrentV2 = async (input: {
  fs: RecordIoFileSystem;
  directories: PendingDirectoriesV2;
  slot: { file: string; identity: { dev: number; ino: number } };
  recordId: string;
  slotRecordKey: WritePendingRecordInput<unknown>['slotRecordKey'];
}): Promise<boolean> => {
  await assertDirectoryAuthorityV2(input.fs, input.directories.slots);
  const record = await readBoundedRegularFileWithIdentity({
    fs: input.fs,
    canonicalRoot: input.directories.canonicalRoot,
    file: input.slot.file,
    maxBytes: MAX_RECORD_BYTES,
  });
  await assertDirectoryAuthorityV2(input.fs, input.directories.slots);
  if (record === null || !sameIdentityV2(record.identity, input.slot.identity)) return false;
  let value: unknown;
  try {
    value = JSON.parse(record.bytes) as unknown;
  } catch {
    return false;
  }
  if (input.slotRecordKey === 'proposalId') {
    const parsed = parseStudioProposalSlotV2(value);
    return parsed.status === 'valid' && parsed.record.proposalId === input.recordId;
  }
  const parsed = parseStudioReferenceRequestSlotV2(value);
  return parsed.status === 'valid' && parsed.record.requestId === input.recordId;
};

/**
 * Staged schema-2 publisher. V1 above deliberately retains its original observable behavior; V2
 * alone binds directory generations and distinguishes committed links from ambiguous publication.
 */
export const writePendingRecordV2 = async <RecordType>(
  input: WritePendingRecordInput<RecordType>
): Promise<RecordType> => {
  const recordFs = input.fs ?? fs;
  let serialized: string;
  try {
    if (!SAFE_RECORD_ID.test(input.recordId)) throw new RecordIoError('unsafe_path');
    serialized = JSON.stringify(input.record);
  } catch {
    throw new StudioPendingRecordWriteError('storage', 'record write failed');
  }
  if (Buffer.byteLength(serialized, 'utf8') > MAX_RECORD_BYTES) {
    throw new StudioPendingRecordWriteError('too_large', input.tooLargeMessage);
  }

  let directories: PendingDirectoriesV2;
  let reservedSlot: { file: string; identity: { dev: number; ino: number } } | undefined;
  let slotStage = 'resolve';
  try {
    directories = await resolvePendingDirectoriesV2(input.pendingDir, recordFs, input.projectAuthority);
    await assertPendingAuthorityV2(input.authorityFence);
    slotStage = 'preflight';
    await preflightPendingFamilyV2({
      fs: recordFs,
      directories,
      recordId: input.recordId,
      slotRecordKey: input.slotRecordKey,
    });
    await assertPendingAuthorityV2(input.authorityFence);
    slotStage = 'reserve';
    reservedSlot = await reserveSlotV2({
      fs: recordFs,
      directories,
      recordId: input.recordId,
      slotRecordKey: input.slotRecordKey,
      capacityMessage: input.capacityMessage,
    });
    // A second full scan catches a V1/malformed authority that appeared after the first scan but
    // before our reservation. Gate 1 keeps V1 writers registered, so V2 publication is fail-closed
    // if the mixed family becomes observable at either cooperative fence.
    await preflightPendingFamilyV2({
      fs: recordFs,
      directories,
      recordId: input.recordId,
      slotRecordKey: input.slotRecordKey,
    });
    await assertPendingAuthorityV2(input.authorityFence);
  } catch (error) {
    if (reservedSlot !== undefined) {
      const cleaned = await cleanupReservedSlotV2({ fs: recordFs, directories, slot: reservedSlot });
      if (!cleaned) throw new StudioPendingRecordWriteError('storage', 'slot write failed');
    }
    if (error instanceof StudioPendingRecordWriteError) throw error;
    throw new StudioPendingRecordWriteError(
      'storage',
      error instanceof RecordIoError
        ? `slot write failed (${slotStage}): ${error.code}`
        : error instanceof Error
          ? `slot write failed: ${error.message}`
          : 'slot write failed'
    );
  }
  if (reservedSlot === undefined) throw new StudioPendingRecordWriteError('storage', 'slot write failed');

  let pendingPublished = false;
  try {
    await publishOwnedExclusiveRecordV2({
      fs: recordFs,
      parent: directories.pending,
      file: path.join(directories.pending.path, `${input.recordId}.json`),
      bytes: serialized,
      authorizeBeforeLink: async () => {
        await assertPendingAuthorityV2(input.authorityFence);
        await preflightPendingFamilyV2({
          fs: recordFs,
          directories,
          recordId: input.recordId,
          slotRecordKey: input.slotRecordKey,
        });
        if (
          !(await reservedSlotIsCurrentV2({
            fs: recordFs,
            directories,
            slot: reservedSlot,
            recordId: input.recordId,
            slotRecordKey: input.slotRecordKey,
          }))
        ) {
          throw new StudioPendingRecordWriteError('storage', 'record write failed');
        }
      },
    });
    pendingPublished = true;
    await assertPendingAuthorityV2(input.authorityFence);
    return input.record;
  } catch (error) {
    if (error instanceof ExclusivePublicationErrorV2 && error.outcome === 'already_exists') {
      const schema = await readSidecarSchemaV2({
        fs: recordFs,
        canonicalRoot: directories.canonicalRoot,
        parent: directories.pending,
        file: path.join(directories.pending.path, `${input.recordId}.json`),
      }).catch((): SidecarSchemaV2 => 'invalid');
      const cleaned = await cleanupReservedSlotV2({ fs: recordFs, directories, slot: reservedSlot });
      if (!cleaned) throw new StudioPendingRecordWriteError('storage', 'record write failed');
      if (schema === 'v1') throwForSidecarSchemaV2('v1');
      throw new StudioPendingRecordWriteError('storage', 'record write failed');
    }
    if (!pendingPublished && !(error instanceof ExclusivePublicationErrorV2 && error.outcome === 'ambiguous')) {
      const cleaned = await cleanupReservedSlotV2({ fs: recordFs, directories, slot: reservedSlot });
      if (!cleaned) throw new StudioPendingRecordWriteError('storage', 'record write failed');
    }
    if (error instanceof StudioPendingRecordWriteError) throw error;
    // A slot is retained only after durable final publication or an ambiguous link outcome. Main
    // owns the coordination needed to reconcile those cases without risking committed work.
    throw new StudioPendingRecordWriteError('storage', 'record write failed');
  }
};
