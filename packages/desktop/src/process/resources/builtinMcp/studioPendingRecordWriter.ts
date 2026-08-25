/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs/promises';
import path from 'node:path';
import {
  STUDIO_PROPOSAL_SCHEMA_VERSION_V2,
  STUDIO_PROPOSAL_V2_MAX_PENDING_PER_PROJECT,
  STUDIO_PROPOSAL_V2_MAX_RECORD_BYTES,
  STUDIO_PROPOSAL_V2_PENDING_TTL_MS,
  STUDIO_REFERENCE_REQUEST_SCHEMA_VERSION,
  STUDIO_REFERENCE_REQUEST_V2_PENDING_TTL_MS,
  STUDIO_REFERENCE_REQUEST_V2_MAX_PENDING_PER_PROJECT,
  STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
  type StudioProposalDecisionV2,
  type StudioReferenceGenerationHandoffReceiptV2,
  type StudioReferenceRequestDecisionV2,
} from '@/common/types/project/creativeStudioTypes';
import {
  RecordIoError,
  type RecordIoFileSystem,
  readBoundedRegularFileWithIdentity,
  resolveCompleteDirectorySet,
} from '@process/services/creative-studio/service/recordIo';
import {
  parseStudioProposalDecisionV2,
  parseStudioProposalRecordV2,
  parseStudioProposalSlotV2,
  parseStudioReferenceGenerationHandoffReceiptV2,
  parseStudioReferenceRequestDecisionV2,
  parseStudioReferenceRequestV2,
  parseStudioReferenceRequestSlotV2,
} from '@process/services/creative-studio/service/directorCommandContracts';

export {
  STUDIO_PROPOSAL_V2_MAX_PENDING_PER_PROJECT,
  STUDIO_PROPOSAL_V2_MAX_RECORD_BYTES,
  STUDIO_REFERENCE_REQUEST_V2_MAX_PENDING_PER_PROJECT,
  STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
  STUDIO_REFERENCE_REQUEST_V2_PENDING_TTL_MS,
} from '@/common/types/project/creativeStudioTypes';

type PendingRecordLimitsV2 = Readonly<{
  maxRecordBytes: number;
  maxPendingPerProject: number;
}>;

const pendingRecordLimitsV2 = (
  slotRecordKey: WritePendingRecordInputV2<unknown>['slotRecordKey']
): PendingRecordLimitsV2 =>
  slotRecordKey === 'requestId'
    ? {
        maxRecordBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
        maxPendingPerProject: STUDIO_REFERENCE_REQUEST_V2_MAX_PENDING_PER_PROJECT,
      }
    : {
        maxRecordBytes: STUDIO_PROPOSAL_V2_MAX_RECORD_BYTES,
        maxPendingPerProject: STUDIO_PROPOSAL_V2_MAX_PENDING_PER_PROJECT,
      };

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

type WritePendingRecordInputV2<RecordType> = {
  pendingDir: string;
  recordId: string;
  record: RecordType;
  // Proposal slots must retain proposalId for the main-process validateProposalSlot contract.
  slotRecordKey: 'proposalId' | 'requestId';
  capacityMessage: string;
  tooLargeMessage: string;
  /** Test seam for identity and publication races. */
  fs?: RecordIoFileSystem;
  /** Reasserts the manifest authority around sidecar publication. */
  authorityFence?: () => Promise<'valid' | 'unsupported_prototype_schema' | 'invalid'>;
  /** Binds sidecars to the exact project-root generation that authorized them. */
  projectAuthority?: StudioPendingProjectAuthorityV2;
};

export type StudioPendingProjectAuthorityV2 = {
  canonicalRoot: string;
  rootIdentity: { dev: number; ino: number };
};

type DirectoryAuthorityV2 = { path: string; dev: number; ino: number };
type PendingDirectoriesV2 = {
  canonicalRoot: string;
  authorities: readonly DirectoryAuthorityV2[];
  root: DirectoryAuthorityV2;
  childNames: readonly string[];
  pending: DirectoryAuthorityV2;
  slots: DirectoryAuthorityV2;
  terminal: readonly DirectoryAuthorityV2[];
};

const PROPOSAL_DIRECTORY_NAMES_V2 = ['pending', 'decisions', 'slots', 'commits'] as const;
const REFERENCE_DIRECTORY_NAMES_V2 = ['pending', 'decisions', 'slots', 'receipts'] as const;

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
  projectAuthority?: StudioPendingProjectAuthorityV2,
  expectedSlotRecordKey?: WritePendingRecordInputV2<unknown>['slotRecordKey']
): Promise<PendingDirectoriesV2> => {
  const configuredPending = path.resolve(pendingDir);
  if (path.basename(configuredPending) !== 'pending') throw new RecordIoError('unsafe_path');
  const familyRoot = path.dirname(configuredPending);
  const projectRoot = path.dirname(familyRoot);
  const familyName = path.basename(familyRoot);
  const slotRecordKey =
    familyName === 'proposals' ? 'proposalId' : familyName === 'reference-requests' ? 'requestId' : null;
  if (slotRecordKey === null || (expectedSlotRecordKey !== undefined && expectedSlotRecordKey !== slotRecordKey)) {
    throw new RecordIoError('unsafe_path');
  }
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
    const directories =
      familyName === 'proposals'
        ? await resolveCompleteDirectorySet({
            fs: recordFs,
            canonicalRoot,
            parent: canonicalRoot,
            rootName: familyName,
            childNames: PROPOSAL_DIRECTORY_NAMES_V2,
            createIfWhollyAbsent: false,
          })
        : await resolveCompleteDirectorySet({
            fs: recordFs,
            canonicalRoot,
            parent: canonicalRoot,
            rootName: familyName,
            childNames: REFERENCE_DIRECTORY_NAMES_V2,
            createIfWhollyAbsent: false,
          });
    if (directories === null || (await recordFs.realpath(configuredPending)) !== directories.pending) {
      throw new RecordIoError('partial_directory_set');
    }
    const childNames = familyName === 'proposals' ? PROPOSAL_DIRECTORY_NAMES_V2 : REFERENCE_DIRECTORY_NAMES_V2;
    const authorities = await Promise.all([
      captureDirectoryAuthorityV2(recordFs, directories.root),
      ...childNames.map((childName) => captureDirectoryAuthorityV2(recordFs, path.join(directories.root, childName))),
    ]);
    const childAuthorities = new Map(
      childNames.map((childName, index) => [childName, authorities[index + 1]!] as const)
    );
    return {
      canonicalRoot,
      authorities,
      root: authorities[0]!,
      childNames,
      pending: childAuthorities.get('pending')!,
      slots: childAuthorities.get('slots')!,
      terminal: childNames
        .filter((childName) => childName !== 'pending' && childName !== 'slots')
        .map((childName) => childAuthorities.get(childName)!),
    };
  } catch (error) {
    throw error instanceof RecordIoError ? error : new RecordIoError('storage_error');
  }
};

const assertPendingDirectoriesV2 = async (
  recordFs: RecordIoFileSystem,
  directories: PendingDirectoriesV2
): Promise<void> => {
  const entries = await recordFs.readdir(directories.root.path, { withFileTypes: true });
  if (
    entries.length !== directories.childNames.length ||
    entries.some(
      (entry) => !entry.isDirectory() || entry.isSymbolicLink() || !directories.childNames.includes(entry.name)
    )
  ) {
    throw new RecordIoError('partial_directory_set');
  }
  await Promise.all(directories.authorities.map((authority) => assertDirectoryAuthorityV2(recordFs, authority)));
};

/** Read-only root/generation assertion for V2 queue reads that happen before publication. */
export const assertPendingRecordProjectAuthorityV2 = async (input: {
  pendingDir: string;
  projectAuthority: StudioPendingProjectAuthorityV2;
  fs?: RecordIoFileSystem;
}): Promise<void> => {
  const directories = await resolvePendingDirectoriesV2(input.pendingDir, input.fs ?? fs, input.projectAuthority);
  await assertPendingDirectoriesV2(input.fs ?? fs, directories);
};

class ExclusivePublicationErrorV2 extends Error {
  constructor(
    public readonly outcome: 'already_exists' | 'not_linked' | 'ambiguous',
    public readonly cause?: StudioPendingRecordWriteError
  ) {
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
  namedFile?: string;
}): Promise<void> => {
  if (input.identity === null) return;
  try {
    await assertDirectoryAuthorityV2(input.fs, input.parent);
    const stats = await input.fs.lstat(input.file);
    let named: typeof stats | undefined;
    if (input.namedFile !== undefined) {
      named = await input.fs.lstat(input.namedFile);
    }
    if (
      stats.isFile() &&
      !stats.isSymbolicLink() &&
      sameIdentityV2(stats, input.identity) &&
      (named === undefined || (named.isFile() && !named.isSymbolicLink() && sameIdentityV2(named, input.identity)))
    ) {
      await input.fs.rm(input.file);
      if (input.namedFile !== undefined) {
        const finalNamed = await input.fs.lstat(input.namedFile);
        if (finalNamed.isSymbolicLink() || !finalNamed.isFile() || !sameIdentityV2(finalNamed, input.identity)) {
          throw new RecordIoError('unsafe_file');
        }
      }
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
  authorizeBeforeLink?: (source: {
    file: string;
    bytes: string;
    identity: { dev: number; ino: number };
  }) => Promise<void>;
  authorizeBeforeCleanup?: () => Promise<void>;
}): Promise<{ identity: { dev: number; ino: number }; readyFile: string }> => {
  if (path.dirname(input.file) !== input.parent.path) throw new ExclusivePublicationErrorV2('not_linked');
  const publicationId = `${process.pid}_${++publicationCounterV2}`;
  const temporaryFile = `${input.file}.${publicationId}.tmp`;
  const readyFile = `${input.file}.${publicationId}.ready`;
  let temporaryHandle: Awaited<ReturnType<RecordIoFileSystem['open']>> | undefined;
  let directoryHandle: Awaited<ReturnType<RecordIoFileSystem['open']>> | undefined;
  let temporaryIdentity: { dev: number; ino: number } | null = null;
  let linkAttempted = false;
  let linked = false;
  let readyAttempted = false;
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

    const namedTemp = await readBoundedRegularFileWithIdentity({
      fs: input.fs,
      canonicalRoot: input.parent.path,
      file: temporaryFile,
      maxBytes: Buffer.byteLength(input.bytes, 'utf8'),
    });
    if (
      namedTemp === null ||
      namedTemp.bytes !== input.bytes ||
      !sameIdentityV2(namedTemp.identity, temporaryIdentity)
    ) {
      throw new RecordIoError('unsafe_file');
    }
    await assertDirectoryAuthorityV2(input.fs, input.parent);
    try {
      await input.fs.lstat(readyFile);
      throw new RecordIoError('unsafe_file');
    } catch (error) {
      if (!hasErrorCodeV2(error, 'ENOENT')) throw error;
    }
    await input.authorizeBeforeLink?.({ file: temporaryFile, bytes: input.bytes, identity: temporaryIdentity });
    const authorizedTemporary = await readBoundedRegularFileWithIdentity({
      fs: input.fs,
      canonicalRoot: input.parent.path,
      file: temporaryFile,
      maxBytes: Buffer.byteLength(input.bytes, 'utf8'),
    });
    if (
      authorizedTemporary === null ||
      authorizedTemporary.bytes !== input.bytes ||
      !sameIdentityV2(authorizedTemporary.identity, temporaryIdentity)
    ) {
      throw new RecordIoError('unsafe_file');
    }
    await assertDirectoryAuthorityV2(input.fs, input.parent);
    readyAttempted = true;
    await input.fs.link(temporaryFile, readyFile);
    await syncDirectoryAuthorityV2(input.fs, input.parent);
    const ready = await readBoundedRegularFileWithIdentity({
      fs: input.fs,
      canonicalRoot: input.parent.path,
      file: readyFile,
      maxBytes: Buffer.byteLength(input.bytes, 'utf8'),
    });
    if (ready === null || ready.bytes !== input.bytes || !sameIdentityV2(ready.identity, temporaryIdentity)) {
      throw new RecordIoError('unsafe_file');
    }
    await input.authorizeBeforeLink?.({ file: readyFile, bytes: input.bytes, identity: temporaryIdentity });
    const authorizedReady = await readBoundedRegularFileWithIdentity({
      fs: input.fs,
      canonicalRoot: input.parent.path,
      file: readyFile,
      maxBytes: Buffer.byteLength(input.bytes, 'utf8'),
    });
    if (
      authorizedReady === null ||
      authorizedReady.bytes !== input.bytes ||
      !sameIdentityV2(authorizedReady.identity, temporaryIdentity)
    ) {
      throw new RecordIoError('unsafe_file');
    }
    await assertDirectoryAuthorityV2(input.fs, input.parent);
    try {
      linkAttempted = true;
      await input.fs.link(readyFile, input.file);
      linked = true;
    } catch (error) {
      if (hasErrorCodeV2(error, 'EEXIST')) {
        const existing = await readBoundedRegularFileWithIdentity({
          fs: input.fs,
          canonicalRoot: input.parent.path,
          file: input.file,
          maxBytes: Math.max(STUDIO_PROPOSAL_V2_MAX_RECORD_BYTES, STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES),
        });
        if (
          existing !== null &&
          existing.bytes === input.bytes &&
          sameIdentityV2(existing.identity, temporaryIdentity)
        ) {
          // Main-process recovery may have linked this exact ready phase while the subprocess was
          // between its durable phase and canonical link. Treat that same inode as our commit;
          // otherwise the outer failure path would release the request's exact slot.
          linked = true;
        } else {
          await input.authorizeBeforeCleanup?.();
          const [ownedTemporary, ownedReady] = await Promise.all([
            input.fs.lstat(temporaryFile),
            input.fs.lstat(readyFile),
          ]);
          if (
            ownedTemporary.isSymbolicLink() ||
            !ownedTemporary.isFile() ||
            ownedReady.isSymbolicLink() ||
            !ownedReady.isFile() ||
            !sameIdentityV2(ownedTemporary, temporaryIdentity) ||
            !sameIdentityV2(ownedReady, temporaryIdentity)
          ) {
            throw new ExclusivePublicationErrorV2('ambiguous');
          }
          await input.authorizeBeforeCleanup?.();
          const finalOwnedReady = await input.fs.lstat(readyFile);
          if (
            finalOwnedReady.isSymbolicLink() ||
            !finalOwnedReady.isFile() ||
            !sameIdentityV2(finalOwnedReady, temporaryIdentity)
          ) {
            throw new ExclusivePublicationErrorV2('ambiguous');
          }
          await input.fs.rm(readyFile);
          await syncDirectoryAuthorityV2(input.fs, input.parent);
          await input.authorizeBeforeCleanup?.();
          const finalTemporary = await input.fs.lstat(temporaryFile);
          if (
            finalTemporary.isSymbolicLink() ||
            !finalTemporary.isFile() ||
            !sameIdentityV2(finalTemporary, temporaryIdentity)
          ) {
            throw new ExclusivePublicationErrorV2('ambiguous');
          }
          await input.fs.rm(temporaryFile);
          await syncDirectoryAuthorityV2(input.fs, input.parent);
          readyAttempted = false;
          throw new ExclusivePublicationErrorV2('already_exists');
        }
      }
      if (!linked) throw error;
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
    const [durableTemporary, durableReady, durableTarget] = await Promise.all([
      input.fs.lstat(temporaryFile),
      input.fs.lstat(readyFile),
      input.fs.lstat(input.file),
    ]);
    if (
      durableTemporary.isSymbolicLink() ||
      !durableTemporary.isFile() ||
      durableReady.isSymbolicLink() ||
      !durableReady.isFile() ||
      durableTarget.isSymbolicLink() ||
      !durableTarget.isFile() ||
      !sameIdentityV2(durableTemporary, temporaryIdentity) ||
      !sameIdentityV2(durableReady, temporaryIdentity) ||
      !sameIdentityV2(durableTarget, temporaryIdentity)
    ) {
      throw new RecordIoError('unsafe_file');
    }
    return { identity: temporaryIdentity, readyFile };
  } catch (error) {
    if (error instanceof ExclusivePublicationErrorV2) throw error;
    if (error instanceof StudioPendingRecordWriteError && !readyAttempted) throw error;
    throw new ExclusivePublicationErrorV2(
      linked || linkAttempted || readyAttempted ? 'ambiguous' : 'not_linked',
      error instanceof StudioPendingRecordWriteError ? error : undefined
    );
  } finally {
    await temporaryHandle?.close().catch((): undefined => undefined);
    await directoryHandle?.close().catch((): undefined => undefined);
    if (!readyAttempted) {
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

const pendingFamilySchemaVersionV2 = (slotRecordKey: WritePendingRecordInputV2<unknown>['slotRecordKey']): number =>
  slotRecordKey === 'proposalId' ? STUDIO_PROPOSAL_SCHEMA_VERSION_V2 : STUDIO_REFERENCE_REQUEST_SCHEMA_VERSION;

const readSidecarSchemaV2 = async (input: {
  fs: RecordIoFileSystem;
  canonicalRoot: string;
  parent: DirectoryAuthorityV2;
  file: string;
  maxRecordBytes: number;
  familyKey: WritePendingRecordInputV2<unknown>['slotRecordKey'];
  slotRecordKey?: WritePendingRecordInputV2<unknown>['slotRecordKey'];
}): Promise<SidecarSchemaV2> => {
  await assertDirectoryAuthorityV2(input.fs, input.parent);
  const record = await readBoundedRegularFileWithIdentity({
    fs: input.fs,
    canonicalRoot: input.canonicalRoot,
    file: input.file,
    maxBytes: input.maxRecordBytes,
  });
  await assertDirectoryAuthorityV2(input.fs, input.parent);
  if (record === null) return 'missing';
  try {
    const value = JSON.parse(record.bytes) as unknown;
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return 'invalid';
    const descriptor = Object.getOwnPropertyDescriptor(value, 'schemaVersion');
    if (descriptor === undefined || !('value' in descriptor)) return 'invalid';
    const currentVersion = pendingFamilySchemaVersionV2(input.familyKey);
    if (
      typeof descriptor.value === 'number' &&
      Number.isSafeInteger(descriptor.value) &&
      descriptor.value >= 1 &&
      descriptor.value < currentVersion
    ) {
      return 'v1';
    }
    if (descriptor.value !== currentVersion) return 'invalid';
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

const assertPendingAuthorityV2 = async (fence: WritePendingRecordInputV2<unknown>['authorityFence']): Promise<void> => {
  if (fence === undefined) return;
  const status = await fence();
  if (status === 'valid') return;
  if (status === 'unsupported_prototype_schema') throwForSidecarSchemaV2('v1');
  throw new StudioPendingRecordWriteError('storage', 'Invalid schema-2 project authority');
};

type IdentifiedFamilyEntryV2 = {
  file: string;
  bytes: string;
  identity: { dev: number; ino: number };
};

type TerminalDirectorySnapshotV2 = {
  authority: DirectoryAuthorityV2;
  names: readonly string[];
  entries: readonly IdentifiedFamilyEntryV2[];
};

type TerminalEntrySnapshotV2 = {
  directories: readonly TerminalDirectorySnapshotV2[];
  decisionRecordIds: ReadonlySet<string>;
  maxRecordBytes: number;
  namedRecordIds: ReadonlySet<string>;
  proposalDecisions: ReadonlyMap<string, StudioProposalDecisionV2>;
  referenceDecisions: ReadonlyMap<string, StudioReferenceRequestDecisionV2>;
  referenceReceipts: ReadonlyMap<string, StudioReferenceGenerationHandoffReceiptV2>;
  terminalRecordIds: ReadonlySet<string>;
};

type OwnedPublicationSourceV2 = {
  file: string;
  bytes: string;
  identity: { dev: number; ino: number };
};

const entryNamesV2 = (entries: import('node:fs').Dirent[]): string[] => entries.map((entry) => entry.name).toSorted();

const captureTerminalEntrySnapshotV2 = async (
  recordFs: RecordIoFileSystem,
  directories: PendingDirectoriesV2,
  input: {
    slotRecordKey: WritePendingRecordInputV2<unknown>['slotRecordKey'];
    expectedProjectId?: string;
    maxRecordBytes: number;
  }
): Promise<TerminalEntrySnapshotV2> => {
  const snapshots: TerminalDirectorySnapshotV2[] = [];
  const decisionRecordIds = new Set<string>();
  const namedRecordIds = new Set<string>();
  const terminalRecordIds = new Set<string>();
  const proposalDecisions = new Map<string, StudioProposalDecisionV2>();
  const referenceDecisions = new Map<string, StudioReferenceRequestDecisionV2>();
  const referenceReceipts = new Map<string, StudioReferenceGenerationHandoffReceiptV2>();

  for (const authority of directories.terminal) {
    // eslint-disable-next-line no-await-in-loop
    await assertDirectoryAuthorityV2(recordFs, authority);
    // eslint-disable-next-line no-await-in-loop
    const entries = await recordFs.readdir(authority.path, { withFileTypes: true });
    const identifiedEntries: IdentifiedFamilyEntryV2[] = [];
    const logicalEntries = new Map<string, IdentifiedFamilyEntryV2>();
    const terminalKind = path.basename(authority.path);
    if (terminalKind === 'commits' && entries.length > 0) {
      // Commit attribution is a transient main-process journal. The subprocess cannot prove its
      // project-digest relation, so it must wait for main to resolve it instead of publishing.
      throwForSidecarSchemaV2('invalid');
    }
    for (const entry of entries) {
      const namedBase = entry.name.endsWith('.publish') ? entry.name.slice(0, -'.publish'.length) : entry.name;
      const match = /^([A-Za-z0-9_-]{1,256})\.json$/.exec(namedBase);
      if (!entry.isFile() || entry.isSymbolicLink() || match === null) throwForSidecarSchemaV2('invalid');
      const recordId = match[1]!;
      const file = path.join(authority.path, entry.name);
      // eslint-disable-next-line no-await-in-loop
      const identified = await readBoundedRegularFileWithIdentity({
        fs: recordFs,
        canonicalRoot: directories.canonicalRoot,
        file,
        maxBytes: input.maxRecordBytes,
      });
      if (identified === null) throwForSidecarSchemaV2('invalid');
      const previous = logicalEntries.get(namedBase);
      if (
        previous !== undefined &&
        (previous.bytes !== identified.bytes || !sameIdentityV2(previous.identity, identified.identity))
      ) {
        throwForSidecarSchemaV2('invalid');
      }
      logicalEntries.set(namedBase, { file, ...identified });
      identifiedEntries.push({ file, ...identified });
      namedRecordIds.add(recordId);

      let value: unknown;
      try {
        value = JSON.parse(identified.bytes) as unknown;
      } catch {
        throwForSidecarSchemaV2('invalid');
      }
      if (terminalKind === 'decisions') {
        if (input.slotRecordKey === 'proposalId') {
          const parsed = parseStudioProposalDecisionV2({ proposalId: recordId, value });
          if (parsed.status === 'valid') proposalDecisions.set(recordId, parsed.record);
          else throwForSidecarSchemaV2(parsed.status === 'unsupported_prototype_schema' ? 'v1' : 'invalid');
          decisionRecordIds.add(recordId);
          terminalRecordIds.add(recordId);
        } else {
          if (input.expectedProjectId === undefined) throwForSidecarSchemaV2('invalid');
          const parsed = parseStudioReferenceRequestDecisionV2({
            projectId: input.expectedProjectId,
            requestId: recordId,
            value,
          });
          if (parsed.status === 'unsupported_prototype_schema') throwForSidecarSchemaV2('v1');
          if (parsed.status === 'valid') {
            referenceDecisions.set(recordId, parsed.record);
            decisionRecordIds.add(recordId);
          } else {
            throwForSidecarSchemaV2('invalid');
          }
        }
      } else if (terminalKind === 'receipts' && input.slotRecordKey === 'requestId') {
        const parsed = parseStudioReferenceGenerationHandoffReceiptV2({ handoffId: recordId, value });
        if (parsed.status === 'unsupported_prototype_schema') throwForSidecarSchemaV2('v1');
        if (parsed.status === 'valid') {
          referenceReceipts.set(recordId, parsed.record);
        } else {
          throwForSidecarSchemaV2('invalid');
        }
      } else {
        throwForSidecarSchemaV2('invalid');
      }
    }
    snapshots.push({ authority, names: entryNamesV2(entries), entries: identifiedEntries });
  }

  if (input.slotRecordKey === 'requestId') {
    const generationDecisions = new Map<string, StudioReferenceRequestDecisionV2>();
    for (const [requestId, decision] of referenceDecisions) {
      if (decision.outcome.kind !== 'generation_gate') {
        terminalRecordIds.add(requestId);
        continue;
      }
      if (generationDecisions.has(decision.outcome.handoffId)) throwForSidecarSchemaV2('invalid');
      generationDecisions.set(decision.outcome.handoffId, decision);
      const receipt = referenceReceipts.get(decision.outcome.handoffId);
      if (receipt === undefined) continue;
      if (receipt.requestId !== requestId || Date.parse(receipt.completedAt) < Date.parse(decision.decidedAt)) {
        throwForSidecarSchemaV2('invalid');
      }
      terminalRecordIds.add(requestId);
    }
    for (const [handoffId, receipt] of referenceReceipts) {
      const decision = generationDecisions.get(handoffId);
      if (
        decision === undefined ||
        decision.requestId !== receipt.requestId ||
        Date.parse(receipt.completedAt) < Date.parse(decision.decidedAt)
      ) {
        throwForSidecarSchemaV2('invalid');
      }
    }
  }
  await assertPendingDirectoriesV2(recordFs, directories);
  return {
    directories: snapshots,
    decisionRecordIds,
    maxRecordBytes: input.maxRecordBytes,
    namedRecordIds,
    proposalDecisions,
    referenceDecisions,
    referenceReceipts,
    terminalRecordIds,
  };
};

const assertTerminalEntrySnapshotV2 = async (
  recordFs: RecordIoFileSystem,
  directories: PendingDirectoriesV2,
  snapshots: TerminalEntrySnapshotV2,
  recordId: string
): Promise<void> => {
  if (snapshots.directories.length !== directories.terminal.length) throw new RecordIoError('unsafe_path');
  if (snapshots.namedRecordIds.has(recordId)) {
    throw new StudioPendingRecordWriteError('storage', 'Record already exists');
  }
  for (const snapshot of snapshots.directories) {
    // eslint-disable-next-line no-await-in-loop
    await assertDirectoryAuthorityV2(recordFs, snapshot.authority);
    // eslint-disable-next-line no-await-in-loop
    const current = await recordFs.readdir(snapshot.authority.path, { withFileTypes: true });
    if (JSON.stringify(entryNamesV2(current)) !== JSON.stringify(snapshot.names)) {
      throw new RecordIoError('unsafe_file');
    }
    // eslint-disable-next-line no-await-in-loop
    await reassertIdentifiedFamilyEntriesV2({
      fs: recordFs,
      canonicalRoot: directories.canonicalRoot,
      maxRecordBytes: snapshots.maxRecordBytes,
      entries: snapshot.entries,
    });
  }
  await assertPendingDirectoriesV2(recordFs, directories);
};

/** Reconciles only the restart shape produced when cleanup restored a hard link but could not remove its alias. */
const reconcileCleanupAliasV2 = async (input: {
  fs: RecordIoFileSystem;
  directories: PendingDirectoriesV2;
  slotFile: string;
  alias: string;
}): Promise<boolean> => {
  try {
    await assertPendingDirectoriesV2(input.fs, input.directories);
    const [slot, alias] = await Promise.all([input.fs.lstat(input.slotFile), input.fs.lstat(input.alias)]);
    if (
      slot.isSymbolicLink() ||
      !slot.isFile() ||
      alias.isSymbolicLink() ||
      !alias.isFile() ||
      !sameIdentityV2(slot, alias)
    ) {
      return false;
    }
    await assertPendingDirectoriesV2(input.fs, input.directories);
    const [currentSlot, currentAlias] = await Promise.all([
      input.fs.lstat(input.slotFile),
      input.fs.lstat(input.alias),
    ]);
    if (
      currentSlot.isSymbolicLink() ||
      !currentSlot.isFile() ||
      currentAlias.isSymbolicLink() ||
      !currentAlias.isFile() ||
      !sameIdentityV2(currentSlot, slot) ||
      !sameIdentityV2(currentAlias, slot)
    ) {
      return false;
    }
    await input.fs.rm(input.alias);
    await syncDirectoryAuthorityV2(input.fs, input.directories.slots);
    const finalSlot = await input.fs.lstat(input.slotFile);
    return finalSlot.isFile() && !finalSlot.isSymbolicLink() && sameIdentityV2(finalSlot, slot);
  } catch {
    return false;
  }
};

const reconcileRestartCleanupAliasesV2 = async (input: {
  fs: RecordIoFileSystem;
  directories: PendingDirectoriesV2;
  maxPendingPerProject: number;
}): Promise<void> => {
  await assertPendingDirectoriesV2(input.fs, input.directories);
  const entries = await input.fs.readdir(input.directories.slots.path, { withFileTypes: true });
  for (const entry of entries) {
    const match = /^(0|[1-9]\d*)\.slot\.[1-9]\d*_[1-9]\d*\.cleanup$/.exec(entry.name);
    if (match === null) continue;
    const index = Number(match[1]);
    if (
      !entry.isFile() ||
      !Number.isSafeInteger(index) ||
      index >= input.maxPendingPerProject ||
      // eslint-disable-next-line no-await-in-loop
      !(await reconcileCleanupAliasV2({
        fs: input.fs,
        directories: input.directories,
        slotFile: path.join(input.directories.slots.path, `${index}.slot`),
        alias: path.join(input.directories.slots.path, entry.name),
      }))
    ) {
      throw new RecordIoError('unsafe_file');
    }
  }
  await assertPendingDirectoriesV2(input.fs, input.directories);
};

const reassertIdentifiedFamilyEntriesV2 = async (input: {
  fs: RecordIoFileSystem;
  canonicalRoot: string;
  maxRecordBytes: number;
  entries: readonly IdentifiedFamilyEntryV2[];
}): Promise<void> => {
  for (const identified of input.entries) {
    // eslint-disable-next-line no-await-in-loop
    const current = await readBoundedRegularFileWithIdentity({
      fs: input.fs,
      canonicalRoot: input.canonicalRoot,
      file: identified.file,
      maxBytes: input.maxRecordBytes,
    });
    if (
      current === null ||
      current.bytes !== identified.bytes ||
      !sameIdentityV2(current.identity, identified.identity)
    ) {
      throw new RecordIoError('unsafe_file');
    }
  }
};

const preflightPendingFamilyV2 = async (input: {
  fs: RecordIoFileSystem;
  directories: PendingDirectoriesV2;
  recordId: string;
  slotRecordKey: WritePendingRecordInputV2<unknown>['slotRecordKey'];
  limits: PendingRecordLimitsV2;
  expectedProjectId?: string;
  authorizeBeforeCleanup?: () => Promise<void>;
  terminalSnapshot?: TerminalEntrySnapshotV2;
  ownedUnpublishedSlot?: { file: string; identity: { dev: number; ino: number } };
  ownedPublicationSource?: OwnedPublicationSourceV2;
}): Promise<TerminalEntrySnapshotV2> => {
  await assertPendingDirectoriesV2(input.fs, input.directories);
  const terminalSnapshot =
    input.terminalSnapshot ??
    (await captureTerminalEntrySnapshotV2(input.fs, input.directories, {
      slotRecordKey: input.slotRecordKey,
      expectedProjectId: input.expectedProjectId,
      maxRecordBytes: input.limits.maxRecordBytes,
    }));
  await assertTerminalEntrySnapshotV2(input.fs, input.directories, terminalSnapshot, input.recordId);
  const terminalDecisionIds = new Set(terminalSnapshot.terminalRecordIds);

  const [pendingEntries, slotEntries] = await Promise.all([
    input.fs.readdir(input.directories.pending.path, { withFileTypes: true }),
    input.fs.readdir(input.directories.slots.path, { withFileTypes: true }),
  ]);
  const pendingNames = entryNamesV2(pendingEntries);
  const slotNames = entryNamesV2(slotEntries);
  const pendingById = new Map<string, IdentifiedFamilyEntryV2>();
  const slotsById = new Map<string, IdentifiedFamilyEntryV2 & { file: string }>();
  const slotsByFile = new Map<string, IdentifiedFamilyEntryV2>();
  const cleanupAliases: Array<IdentifiedFamilyEntryV2 & { slotFile: string }> = [];
  const linkedPublicationAliases: Array<IdentifiedFamilyEntryV2 & { namedFile: string; parent: DirectoryAuthorityV2 }> =
    [];
  const readyRecoveries: Array<
    IdentifiedFamilyEntryV2 & {
      family: 'pending' | 'slots';
      namedFile: string;
      temporaryFile: string;
      parent: DirectoryAuthorityV2;
      recordId: string;
      foreignNamed?: IdentifiedFamilyEntryV2;
    }
  > = [];
  const abortedPublicationAliases: Array<
    IdentifiedFamilyEntryV2 & {
      namedFile: string;
      named: IdentifiedFamilyEntryV2;
      parent: DirectoryAuthorityV2;
    }
  > = [];
  const identifiedEntries: IdentifiedFamilyEntryV2[] = [];
  let observedOwnedSource = input.ownedPublicationSource === undefined;
  const parseSlotRecordId = (bytes: string): string => {
    let value: unknown;
    try {
      value = JSON.parse(bytes) as unknown;
    } catch {
      throwForSidecarSchemaV2('invalid');
    }
    if (input.slotRecordKey === 'proposalId') {
      const parsed = parseStudioProposalSlotV2(value);
      if (parsed.status === 'valid') return parsed.record.proposalId;
      throwForSidecarSchemaV2(parsed.status === 'unsupported_prototype_schema' ? 'v1' : 'invalid');
      throw new RecordIoError('unsafe_file');
    }
    const parsed = parseStudioReferenceRequestSlotV2(value);
    if (parsed.status === 'valid') return parsed.record.requestId;
    throwForSidecarSchemaV2(parsed.status === 'unsupported_prototype_schema' ? 'v1' : 'invalid');
    throw new RecordIoError('unsafe_file');
  };
  const assertValidPendingRecord = (bytes: string, pendingId: string): void => {
    let value: unknown;
    try {
      value = JSON.parse(bytes) as unknown;
    } catch {
      throwForSidecarSchemaV2('invalid');
    }
    const projectId =
      typeof value === 'object' &&
      value !== null &&
      !Array.isArray(value) &&
      typeof (value as { projectId?: unknown }).projectId === 'string'
        ? (value as { projectId: string }).projectId
        : '';
    const parsed =
      input.slotRecordKey === 'proposalId'
        ? parseStudioProposalRecordV2({ projectId, proposalId: pendingId, value })
        : parseStudioReferenceRequestV2({ projectId, requestId: pendingId, value });
    if (parsed.status === 'unsupported_prototype_schema') throwForSidecarSchemaV2('v1');
    if (input.expectedProjectId === undefined || projectId !== input.expectedProjectId || parsed.status !== 'valid') {
      throwForSidecarSchemaV2('invalid');
    }
  };

  for (const entry of pendingEntries) {
    const file = path.join(input.directories.pending.path, entry.name);
    if (input.ownedPublicationSource !== undefined && file === input.ownedPublicationSource.file) {
      if (!entry.isFile()) throwForSidecarSchemaV2('invalid');
      const source = await readBoundedRegularFileWithIdentity({
        fs: input.fs,
        canonicalRoot: input.directories.canonicalRoot,
        file,
        maxBytes: input.limits.maxRecordBytes,
      });
      if (
        source === null ||
        source.bytes !== input.ownedPublicationSource.bytes ||
        !sameIdentityV2(source.identity, input.ownedPublicationSource.identity)
      ) {
        throwForSidecarSchemaV2('invalid');
      }
      identifiedEntries.push({ file, ...source });
      observedOwnedSource = true;
      continue;
    }
    const publicationMatch = /^([A-Za-z0-9_-]{1,256}\.json)\.\d+_\d+\.(tmp|ready)$/.exec(entry.name);
    if (publicationMatch?.[1] !== undefined) {
      if (!entry.isFile()) throwForSidecarSchemaV2('invalid');
      const namedFile = path.join(input.directories.pending.path, publicationMatch[1]);
      const [source, named] = await Promise.all([
        readBoundedRegularFileWithIdentity({
          fs: input.fs,
          canonicalRoot: input.directories.canonicalRoot,
          file,
          maxBytes: input.limits.maxRecordBytes,
        }),
        readBoundedRegularFileWithIdentity({
          fs: input.fs,
          canonicalRoot: input.directories.canonicalRoot,
          file: namedFile,
          maxBytes: input.limits.maxRecordBytes,
        }),
      ]);
      const isOwnedReadyPreparation =
        publicationMatch[2] === 'tmp' &&
        named === null &&
        input.ownedPublicationSource?.file === `${file.slice(0, -'.tmp'.length)}.ready` &&
        source !== null &&
        source.bytes === input.ownedPublicationSource.bytes &&
        sameIdentityV2(source.identity, input.ownedPublicationSource.identity);
      if (isOwnedReadyPreparation && source !== null) {
        identifiedEntries.push({ file, ...source });
        continue;
      }
      if (source === null) throwForSidecarSchemaV2('invalid');
      const stored = { file, namedFile, parent: input.directories.pending, ...source };
      if (publicationMatch[2] === 'tmp') {
        const pendingId = publicationMatch[1].slice(0, -'.json'.length);
        const ready = await readBoundedRegularFileWithIdentity({
          fs: input.fs,
          canonicalRoot: input.directories.canonicalRoot,
          file: `${file.slice(0, -'.tmp'.length)}.ready`,
          maxBytes: input.limits.maxRecordBytes,
        });
        if (ready === null) {
          if (named === null) {
            throwForSidecarSchemaV2('invalid');
          }
          if (sameIdentityV2(source.identity, named.identity)) {
            if (source.bytes !== named.bytes) throwForSidecarSchemaV2('invalid');
            linkedPublicationAliases.push(stored);
          } else {
            assertValidPendingRecord(source.bytes, pendingId);
            assertValidPendingRecord(named.bytes, pendingId);
            abortedPublicationAliases.push({
              ...stored,
              named: { file: namedFile, ...named },
            });
          }
        } else if (ready.bytes !== source.bytes || !sameIdentityV2(ready.identity, source.identity)) {
          throwForSidecarSchemaV2('invalid');
        } else if (named !== null) {
          if (sameIdentityV2(named.identity, source.identity)) {
            if (named.bytes !== source.bytes) throwForSidecarSchemaV2('invalid');
          } else {
            assertValidPendingRecord(source.bytes, pendingId);
            assertValidPendingRecord(named.bytes, pendingId);
          }
        }
      } else {
        const temporaryFile = `${file.slice(0, -'.ready'.length)}.tmp`;
        const temporary = await readBoundedRegularFileWithIdentity({
          fs: input.fs,
          canonicalRoot: input.directories.canonicalRoot,
          file: temporaryFile,
          maxBytes: input.limits.maxRecordBytes,
        });
        if (
          temporary === null ||
          temporary.bytes !== source.bytes ||
          !sameIdentityV2(temporary.identity, source.identity)
        ) {
          throwForSidecarSchemaV2('invalid');
        }
        const pendingId = publicationMatch[1].slice(0, -'.json'.length);
        if (named === null) {
          let value: unknown;
          try {
            value = JSON.parse(source.bytes) as unknown;
          } catch {
            throwForSidecarSchemaV2('invalid');
          }
          const projectId =
            typeof value === 'object' &&
            value !== null &&
            !Array.isArray(value) &&
            typeof (value as { projectId?: unknown }).projectId === 'string'
              ? (value as { projectId: string }).projectId
              : '';
          const parsed =
            input.slotRecordKey === 'proposalId'
              ? parseStudioProposalRecordV2({ projectId, proposalId: pendingId, value })
              : parseStudioReferenceRequestV2({ projectId, requestId: pendingId, value });
          if (
            input.expectedProjectId === undefined ||
            projectId !== input.expectedProjectId ||
            parsed.status !== 'valid' ||
            pendingById.has(pendingId)
          ) {
            throwForSidecarSchemaV2('invalid');
          }
          pendingById.set(pendingId, stored);
          readyRecoveries.push({
            ...stored,
            family: 'pending',
            temporaryFile,
            recordId: pendingId,
          });
        } else if (sameIdentityV2(named.identity, source.identity)) {
          if (named.bytes !== source.bytes) throwForSidecarSchemaV2('invalid');
        } else {
          assertValidPendingRecord(source.bytes, pendingId);
          assertValidPendingRecord(named.bytes, pendingId);
          readyRecoveries.push({
            ...stored,
            family: 'pending',
            temporaryFile,
            recordId: pendingId,
            foreignNamed: { file: namedFile, ...named },
          });
        }
      }
      identifiedEntries.push(stored);
      continue;
    }
    const match = /^([A-Za-z0-9_-]{1,256})\.json$/.exec(entry.name);
    if (!entry.isFile() || match === null) throwForSidecarSchemaV2('invalid');
    const pendingId = match[1]!;
    if (pendingById.has(pendingId)) throwForSidecarSchemaV2('invalid');
    const identified = await readBoundedRegularFileWithIdentity({
      fs: input.fs,
      canonicalRoot: input.directories.canonicalRoot,
      file,
      maxBytes: input.limits.maxRecordBytes,
    });
    if (identified === null) throwForSidecarSchemaV2('invalid');
    let value: unknown;
    try {
      value = JSON.parse(identified.bytes) as unknown;
    } catch {
      throwForSidecarSchemaV2('invalid');
    }
    const schema =
      typeof value === 'object' && value !== null && !Array.isArray(value)
        ? Object.getOwnPropertyDescriptor(value, 'schemaVersion')
        : undefined;
    if (schema !== undefined && 'value' in schema && schema.value === 1) throwForSidecarSchemaV2('v1');
    const projectId =
      typeof value === 'object' &&
      value !== null &&
      !Array.isArray(value) &&
      typeof (value as { projectId?: unknown }).projectId === 'string'
        ? (value as { projectId: string }).projectId
        : '';
    if (input.expectedProjectId === undefined || projectId !== input.expectedProjectId) {
      throwForSidecarSchemaV2('invalid');
    }
    const parsed =
      input.slotRecordKey === 'proposalId'
        ? parseStudioProposalRecordV2({ projectId, proposalId: pendingId, value })
        : parseStudioReferenceRequestV2({ projectId, requestId: pendingId, value });
    if (parsed.status === 'unsupported_prototype_schema') throwForSidecarSchemaV2('v1');
    if (parsed.status !== 'valid') throwForSidecarSchemaV2('invalid');
    const stored = { file, ...identified };
    pendingById.set(pendingId, stored);
    identifiedEntries.push(stored);
  }
  if (!observedOwnedSource) throwForSidecarSchemaV2('invalid');
  if (pendingById.has(input.recordId)) {
    throw new StudioPendingRecordWriteError('storage', 'Record already exists');
  }
  for (const decisionRecordId of terminalSnapshot.decisionRecordIds) {
    const pending = pendingById.get(decisionRecordId);
    if (pending === undefined || input.expectedProjectId === undefined) throwForSidecarSchemaV2('invalid');
    let value: unknown;
    try {
      value = JSON.parse(pending.bytes) as unknown;
    } catch {
      throwForSidecarSchemaV2('invalid');
    }
    if (input.slotRecordKey === 'proposalId') {
      const proposal = parseStudioProposalRecordV2({
        projectId: input.expectedProjectId,
        proposalId: decisionRecordId,
        value,
      });
      const decision = terminalSnapshot.proposalDecisions.get(decisionRecordId);
      if (decision === undefined) throwForSidecarSchemaV2('invalid');
      if (proposal.status !== 'valid') {
        throwForSidecarSchemaV2('invalid');
        throw new RecordIoError('unsafe_file');
      }
      const createdAt = Date.parse(proposal.record.createdAt);
      const decidedAt = Date.parse(decision.decidedAt);
      if (
        decidedAt < createdAt ||
        (decision.status === 'expired' && decidedAt < createdAt + STUDIO_PROPOSAL_V2_PENDING_TTL_MS)
      ) {
        throwForSidecarSchemaV2('invalid');
      }
      continue;
    }
    const request = parseStudioReferenceRequestV2({
      projectId: input.expectedProjectId,
      requestId: decisionRecordId,
      value,
    });
    const decision = terminalSnapshot.referenceDecisions.get(decisionRecordId);
    if (decision === undefined) throwForSidecarSchemaV2('invalid');
    if (request.status !== 'valid') {
      throwForSidecarSchemaV2('invalid');
      throw new RecordIoError('unsafe_file');
    }
    const createdAt = Date.parse(request.record.createdAt);
    const decidedAt = Date.parse(decision.decidedAt);
    if (
      decidedAt < createdAt ||
      (decision.outcome.kind === 'expired' && decidedAt < createdAt + STUDIO_REFERENCE_REQUEST_V2_PENDING_TTL_MS)
    ) {
      throwForSidecarSchemaV2('invalid');
    }
    if (
      decision.outcome.kind === 'generation_gate' &&
      (decision.outcome.referenceIds.length !== request.record.referenceIds.length ||
        !decision.outcome.referenceIds.every(
          (referenceId, index) => referenceId === request.record.referenceIds[index]
        ))
    ) {
      throwForSidecarSchemaV2('invalid');
    }
  }

  for (const entry of slotEntries) {
    const publicationMatch = /^((?:0|[1-9]\d*)\.slot)\.\d+_\d+\.(tmp|ready)$/.exec(entry.name);
    if (publicationMatch?.[1] !== undefined) {
      const slotIndex = Number(publicationMatch[1].slice(0, -'.slot'.length));
      if (!entry.isFile() || !Number.isSafeInteger(slotIndex) || slotIndex >= input.limits.maxPendingPerProject) {
        throwForSidecarSchemaV2('invalid');
      }
      const file = path.join(input.directories.slots.path, entry.name);
      const namedFile = path.join(input.directories.slots.path, publicationMatch[1]);
      const [source, named] = await Promise.all([
        readBoundedRegularFileWithIdentity({
          fs: input.fs,
          canonicalRoot: input.directories.canonicalRoot,
          file,
          maxBytes: input.limits.maxRecordBytes,
        }),
        readBoundedRegularFileWithIdentity({
          fs: input.fs,
          canonicalRoot: input.directories.canonicalRoot,
          file: namedFile,
          maxBytes: input.limits.maxRecordBytes,
        }),
      ]);
      if (source === null) throwForSidecarSchemaV2('invalid');
      const stored = { file, namedFile, parent: input.directories.slots, ...source };
      if (publicationMatch[2] === 'tmp') {
        const ready = await readBoundedRegularFileWithIdentity({
          fs: input.fs,
          canonicalRoot: input.directories.canonicalRoot,
          file: `${file.slice(0, -'.tmp'.length)}.ready`,
          maxBytes: input.limits.maxRecordBytes,
        });
        if (ready === null) {
          if (named === null) throwForSidecarSchemaV2('invalid');
          if (source.bytes === named.bytes && sameIdentityV2(source.identity, named.identity)) {
            linkedPublicationAliases.push(stored);
          } else {
            const sourceRecordId = parseSlotRecordId(source.bytes);
            const namedRecordId = parseSlotRecordId(named.bytes);
            if (sourceRecordId === namedRecordId) throwForSidecarSchemaV2('invalid');
            abortedPublicationAliases.push({
              ...stored,
              named: { file: namedFile, ...named },
            });
          }
        } else if (ready.bytes !== source.bytes || !sameIdentityV2(ready.identity, source.identity)) {
          throwForSidecarSchemaV2('invalid');
        } else if (
          named !== null &&
          (named.bytes !== source.bytes || !sameIdentityV2(named.identity, source.identity)) &&
          parseSlotRecordId(source.bytes) === parseSlotRecordId(named.bytes)
        ) {
          throwForSidecarSchemaV2('invalid');
        }
      } else {
        const temporaryFile = `${file.slice(0, -'.ready'.length)}.tmp`;
        const temporary = await readBoundedRegularFileWithIdentity({
          fs: input.fs,
          canonicalRoot: input.directories.canonicalRoot,
          file: temporaryFile,
          maxBytes: input.limits.maxRecordBytes,
        });
        if (
          temporary === null ||
          temporary.bytes !== source.bytes ||
          !sameIdentityV2(temporary.identity, source.identity)
        ) {
          throwForSidecarSchemaV2('invalid');
        }
        if (named === null) {
          const pendingId = parseSlotRecordId(source.bytes);
          if (slotsById.has(pendingId)) throwForSidecarSchemaV2('invalid');
          slotsById.set(pendingId, stored);
          slotsByFile.set(namedFile, stored);
          readyRecoveries.push({
            ...stored,
            family: 'slots',
            temporaryFile,
            recordId: pendingId,
          });
        } else if (named.bytes !== source.bytes || !sameIdentityV2(named.identity, source.identity)) {
          const pendingId = parseSlotRecordId(source.bytes);
          if (pendingId === parseSlotRecordId(named.bytes)) throwForSidecarSchemaV2('invalid');
          readyRecoveries.push({
            ...stored,
            family: 'slots',
            temporaryFile,
            recordId: pendingId,
            foreignNamed: { file: namedFile, ...named },
          });
        }
      }
      identifiedEntries.push(stored);
      continue;
    }
    const cleanupMatch = /^(0|[1-9]\d*)\.slot\.[1-9]\d*_[1-9]\d*\.cleanup$/.exec(entry.name);
    if (cleanupMatch !== null) {
      const cleanupIndex = Number(cleanupMatch[1]);
      if (!entry.isFile() || !Number.isSafeInteger(cleanupIndex) || cleanupIndex >= input.limits.maxPendingPerProject) {
        throwForSidecarSchemaV2('invalid');
      }
      const file = path.join(input.directories.slots.path, entry.name);
      const identified = await readBoundedRegularFileWithIdentity({
        fs: input.fs,
        canonicalRoot: input.directories.canonicalRoot,
        file,
        maxBytes: input.limits.maxRecordBytes,
      });
      if (identified === null) throwForSidecarSchemaV2('invalid');
      const stored = {
        file,
        slotFile: path.join(input.directories.slots.path, `${cleanupIndex}.slot`),
        ...identified,
      };
      cleanupAliases.push(stored);
      identifiedEntries.push(stored);
      continue;
    }
    const match = /^(0|[1-9]\d*)\.slot$/.exec(entry.name);
    const index = match === null ? Number.NaN : Number(match[1]);
    if (
      !entry.isFile() ||
      match === null ||
      !Number.isSafeInteger(index) ||
      index >= input.limits.maxPendingPerProject
    ) {
      throwForSidecarSchemaV2('invalid');
    }
    const file = path.join(input.directories.slots.path, entry.name);
    const identified = await readBoundedRegularFileWithIdentity({
      fs: input.fs,
      canonicalRoot: input.directories.canonicalRoot,
      file,
      maxBytes: input.limits.maxRecordBytes,
    });
    if (identified === null) throwForSidecarSchemaV2('invalid');
    let value: unknown;
    try {
      value = JSON.parse(identified.bytes) as unknown;
    } catch {
      throwForSidecarSchemaV2('invalid');
    }
    let pendingId: string;
    if (input.slotRecordKey === 'proposalId') {
      const parsed = parseStudioProposalSlotV2(value);
      if (parsed.status === 'unsupported_prototype_schema') throwForSidecarSchemaV2('v1');
      if (parsed.status === 'valid') pendingId = parsed.record.proposalId;
      else throwForSidecarSchemaV2('invalid');
    } else {
      const parsed = parseStudioReferenceRequestSlotV2(value);
      if (parsed.status === 'unsupported_prototype_schema') throwForSidecarSchemaV2('v1');
      if (parsed.status === 'valid') pendingId = parsed.record.requestId;
      else throwForSidecarSchemaV2('invalid');
    }
    if (slotsById.has(pendingId)) throwForSidecarSchemaV2('invalid');
    const stored = { file, ...identified };
    slotsById.set(pendingId, stored);
    slotsByFile.set(file, stored);
    identifiedEntries.push(stored);
  }

  for (const alias of cleanupAliases) {
    const slot = slotsByFile.get(alias.slotFile);
    if (slot === undefined || alias.bytes !== slot.bytes || !sameIdentityV2(alias.identity, slot.identity)) {
      throwForSidecarSchemaV2('invalid');
    }
  }

  for (const [pendingId, slot] of slotsById) {
    if (pendingById.has(pendingId)) continue;
    if (readyRecoveries.some((recovery) => recovery.family === 'slots' && recovery.recordId === pendingId)) {
      continue;
    }
    if (
      input.ownedUnpublishedSlot === undefined ||
      pendingId !== input.recordId ||
      slot.file !== input.ownedUnpublishedSlot.file ||
      !sameIdentityV2(slot.identity, input.ownedUnpublishedSlot.identity)
    ) {
      throwForSidecarSchemaV2('invalid');
    }
  }
  for (const pendingId of pendingById.keys()) {
    if (!slotsById.has(pendingId) && !terminalDecisionIds.has(pendingId)) throwForSidecarSchemaV2('invalid');
  }

  await assertPendingDirectoriesV2(input.fs, input.directories);
  const [finalPendingEntries, finalSlotEntries] = await Promise.all([
    input.fs.readdir(input.directories.pending.path, { withFileTypes: true }),
    input.fs.readdir(input.directories.slots.path, { withFileTypes: true }),
  ]);
  if (
    finalPendingEntries.some((entry) => !entry.isFile()) ||
    finalSlotEntries.some((entry) => !entry.isFile()) ||
    JSON.stringify(entryNamesV2(finalPendingEntries)) !== JSON.stringify(pendingNames) ||
    JSON.stringify(entryNamesV2(finalSlotEntries)) !== JSON.stringify(slotNames)
  ) {
    throw new RecordIoError('unsafe_file');
  }
  await reassertIdentifiedFamilyEntriesV2({
    fs: input.fs,
    canonicalRoot: input.directories.canonicalRoot,
    maxRecordBytes: input.limits.maxRecordBytes,
    entries: identifiedEntries,
  });
  await assertTerminalEntrySnapshotV2(input.fs, input.directories, terminalSnapshot, input.recordId);
  if (cleanupAliases.length > 0) {
    await input.authorizeBeforeCleanup?.();
    await assertPendingDirectoriesV2(input.fs, input.directories);
    const [authorizedPendingEntries, authorizedSlotEntries] = await Promise.all([
      input.fs.readdir(input.directories.pending.path, { withFileTypes: true }),
      input.fs.readdir(input.directories.slots.path, { withFileTypes: true }),
    ]);
    if (
      authorizedPendingEntries.some((entry) => !entry.isFile()) ||
      authorizedSlotEntries.some((entry) => !entry.isFile()) ||
      JSON.stringify(entryNamesV2(authorizedPendingEntries)) !== JSON.stringify(pendingNames) ||
      JSON.stringify(entryNamesV2(authorizedSlotEntries)) !== JSON.stringify(slotNames)
    ) {
      throw new RecordIoError('unsafe_file');
    }
    await reassertIdentifiedFamilyEntriesV2({
      fs: input.fs,
      canonicalRoot: input.directories.canonicalRoot,
      maxRecordBytes: input.limits.maxRecordBytes,
      entries: identifiedEntries,
    });
    await assertTerminalEntrySnapshotV2(input.fs, input.directories, terminalSnapshot, input.recordId);
    await reconcileRestartCleanupAliasesV2({
      fs: input.fs,
      directories: input.directories,
      maxPendingPerProject: input.limits.maxPendingPerProject,
    });
  }
  for (const collision of abortedPublicationAliases) {
    const readyFile = `${collision.file.slice(0, -'.tmp'.length)}.ready`;
    // A different valid inode already owns this canonical name, so the exact tmp-only phase
    // cannot have crossed its exclusive-link commit boundary. Retire just that captured inode.
    // eslint-disable-next-line no-await-in-loop
    await input.authorizeBeforeCleanup?.();
    // eslint-disable-next-line no-await-in-loop
    await reassertIdentifiedFamilyEntriesV2({
      fs: input.fs,
      canonicalRoot: input.directories.canonicalRoot,
      maxRecordBytes: input.limits.maxRecordBytes,
      entries: [collision, collision.named],
    });
    try {
      // eslint-disable-next-line no-await-in-loop
      await input.fs.lstat(readyFile);
      throw new RecordIoError('unsafe_file');
    } catch (error) {
      if (!hasErrorCodeV2(error, 'ENOENT')) throw error;
    }
    // eslint-disable-next-line no-await-in-loop
    await input.authorizeBeforeCleanup?.();
    // eslint-disable-next-line no-await-in-loop
    const current = await input.fs.lstat(collision.file);
    if (current.isSymbolicLink() || !current.isFile() || !sameIdentityV2(current, collision.identity)) {
      throw new RecordIoError('unsafe_file');
    }
    // eslint-disable-next-line no-await-in-loop
    await input.fs.rm(collision.file);
    // eslint-disable-next-line no-await-in-loop
    await syncDirectoryAuthorityV2(input.fs, collision.parent);
  }
  for (const recovery of readyRecoveries) {
    const shouldPromote =
      recovery.foreignNamed !== undefined
        ? false
        : recovery.family === 'pending'
          ? slotsById.has(recovery.recordId) || terminalDecisionIds.has(recovery.recordId)
          : pendingById.has(recovery.recordId);
    // eslint-disable-next-line no-await-in-loop
    await input.authorizeBeforeCleanup?.();
    // eslint-disable-next-line no-await-in-loop
    const [ready, temporary] = await Promise.all([
      readBoundedRegularFileWithIdentity({
        fs: input.fs,
        canonicalRoot: input.directories.canonicalRoot,
        file: recovery.file,
        maxBytes: input.limits.maxRecordBytes,
      }),
      readBoundedRegularFileWithIdentity({
        fs: input.fs,
        canonicalRoot: input.directories.canonicalRoot,
        file: recovery.temporaryFile,
        maxBytes: input.limits.maxRecordBytes,
      }),
    ]);
    if (
      ready === null ||
      temporary === null ||
      ready.bytes !== recovery.bytes ||
      temporary.bytes !== recovery.bytes ||
      !sameIdentityV2(ready.identity, recovery.identity) ||
      !sameIdentityV2(temporary.identity, recovery.identity)
    ) {
      throw new RecordIoError('unsafe_file');
    }
    if (recovery.foreignNamed !== undefined) {
      // eslint-disable-next-line no-await-in-loop
      await reassertIdentifiedFamilyEntriesV2({
        fs: input.fs,
        canonicalRoot: input.directories.canonicalRoot,
        maxRecordBytes: input.limits.maxRecordBytes,
        entries: [recovery.foreignNamed],
      });
    }
    if (shouldPromote) {
      // eslint-disable-next-line no-await-in-loop
      await input.authorizeBeforeCleanup?.();
      try {
        // eslint-disable-next-line no-await-in-loop
        await input.fs.link(recovery.file, recovery.namedFile);
      } catch (error) {
        if (!hasErrorCodeV2(error, 'EEXIST')) throw error;
        // eslint-disable-next-line no-await-in-loop
        const named = await readBoundedRegularFileWithIdentity({
          fs: input.fs,
          canonicalRoot: input.directories.canonicalRoot,
          file: recovery.namedFile,
          maxBytes: input.limits.maxRecordBytes,
        });
        if (named === null || named.bytes !== recovery.bytes || !sameIdentityV2(named.identity, recovery.identity)) {
          throw new RecordIoError('unsafe_file');
        }
      }
      // eslint-disable-next-line no-await-in-loop
      await syncDirectoryAuthorityV2(input.fs, recovery.parent);
    } else {
      for (const file of [recovery.file, recovery.temporaryFile]) {
        // eslint-disable-next-line no-await-in-loop
        await input.authorizeBeforeCleanup?.();
        // eslint-disable-next-line no-await-in-loop
        const current = await input.fs.lstat(file);
        if (current.isSymbolicLink() || !current.isFile() || !sameIdentityV2(current, recovery.identity)) {
          throw new RecordIoError('unsafe_file');
        }
        // eslint-disable-next-line no-await-in-loop
        await input.authorizeBeforeCleanup?.();
        // eslint-disable-next-line no-await-in-loop
        await input.fs.rm(file);
        // eslint-disable-next-line no-await-in-loop
        await syncDirectoryAuthorityV2(input.fs, recovery.parent);
      }
    }
  }
  for (const alias of linkedPublicationAliases) {
    // Older writers retained a linked `.tmp` without a durable phase name. Convert that exact
    // hardlink to the recognized recovery phase instead of unlinking the only remaining authority
    // if the canonical name is concurrently removed.
    // eslint-disable-next-line no-await-in-loop
    await input.authorizeBeforeCleanup?.();
    // eslint-disable-next-line no-await-in-loop
    const [source, named] = await Promise.all([
      readBoundedRegularFileWithIdentity({
        fs: input.fs,
        canonicalRoot: input.directories.canonicalRoot,
        file: alias.file,
        maxBytes: input.limits.maxRecordBytes,
      }),
      readBoundedRegularFileWithIdentity({
        fs: input.fs,
        canonicalRoot: input.directories.canonicalRoot,
        file: alias.namedFile,
        maxBytes: input.limits.maxRecordBytes,
      }),
    ]);
    if (
      source === null ||
      named === null ||
      source.bytes !== alias.bytes ||
      named.bytes !== alias.bytes ||
      !sameIdentityV2(source.identity, alias.identity) ||
      !sameIdentityV2(named.identity, alias.identity)
    ) {
      throw new RecordIoError('unsafe_file');
    }
    const readyFile = `${alias.file.slice(0, -'.tmp'.length)}.ready`;
    try {
      // eslint-disable-next-line no-await-in-loop
      await input.fs.lstat(readyFile);
      throw new RecordIoError('unsafe_file');
    } catch (error) {
      if (!hasErrorCodeV2(error, 'ENOENT')) throw error;
    }
    // eslint-disable-next-line no-await-in-loop
    await input.authorizeBeforeCleanup?.();
    // eslint-disable-next-line no-await-in-loop
    const finalSource = await readBoundedRegularFileWithIdentity({
      fs: input.fs,
      canonicalRoot: input.directories.canonicalRoot,
      file: alias.file,
      maxBytes: input.limits.maxRecordBytes,
    });
    if (
      finalSource === null ||
      finalSource.bytes !== alias.bytes ||
      !sameIdentityV2(finalSource.identity, alias.identity)
    ) {
      throw new RecordIoError('unsafe_file');
    }
    try {
      // eslint-disable-next-line no-await-in-loop
      await input.fs.link(alias.file, readyFile);
    } catch (error) {
      if (!hasErrorCodeV2(error, 'EEXIST')) throw error;
      // eslint-disable-next-line no-await-in-loop
      const existingReady = await readBoundedRegularFileWithIdentity({
        fs: input.fs,
        canonicalRoot: input.directories.canonicalRoot,
        file: readyFile,
        maxBytes: input.limits.maxRecordBytes,
      });
      if (
        existingReady === null ||
        existingReady.bytes !== alias.bytes ||
        !sameIdentityV2(existingReady.identity, alias.identity)
      ) {
        throw new RecordIoError('unsafe_file');
      }
    }
    // eslint-disable-next-line no-await-in-loop
    await syncDirectoryAuthorityV2(input.fs, alias.parent);
    // eslint-disable-next-line no-await-in-loop
    const [finalReady, finalNamed] = await Promise.all([input.fs.lstat(readyFile), input.fs.lstat(alias.namedFile)]);
    if (
      finalReady.isSymbolicLink() ||
      !finalReady.isFile() ||
      finalNamed.isSymbolicLink() ||
      !finalNamed.isFile() ||
      !sameIdentityV2(finalReady, alias.identity) ||
      !sameIdentityV2(finalNamed, alias.identity)
    ) {
      throw new RecordIoError('unsafe_file');
    }
  }
  return terminalSnapshot;
};

const reserveSlotV2 = async (input: {
  fs: RecordIoFileSystem;
  directories: PendingDirectoriesV2;
  recordId: string;
  slotRecordKey: WritePendingRecordInputV2<unknown>['slotRecordKey'];
  capacityMessage: string;
  limits: PendingRecordLimitsV2;
  authorizeBeforeLink?: () => Promise<void>;
}): Promise<{ file: string; identity: { dev: number; ino: number }; readyFile: string }> => {
  const bytes = JSON.stringify({
    schemaVersion: pendingFamilySchemaVersionV2(input.slotRecordKey),
    [input.slotRecordKey]: input.recordId,
    reservedAt: new Date().toISOString(),
  });
  for (let index = 0; index < input.limits.maxPendingPerProject; index += 1) {
    const file = path.join(input.directories.slots.path, `${index}.slot`);
    try {
      const publication = await publishOwnedExclusiveRecordV2({
        fs: input.fs,
        parent: input.directories.slots,
        file,
        bytes,
        authorizeBeforeLink: async () => {
          await assertPendingDirectoriesV2(input.fs, input.directories);
          await input.authorizeBeforeLink?.();
        },
        authorizeBeforeCleanup: input.authorizeBeforeLink,
      });
      await assertPendingDirectoriesV2(input.fs, input.directories);
      return { file, ...publication };
    } catch (error) {
      if (error instanceof ExclusivePublicationErrorV2 && error.outcome === 'already_exists') {
        // The collision may be a late V1 authority installation; classify it before continuing.
        // eslint-disable-next-line no-await-in-loop
        const schema = await readSidecarSchemaV2({
          fs: input.fs,
          canonicalRoot: input.directories.canonicalRoot,
          parent: input.directories.slots,
          file,
          maxRecordBytes: input.limits.maxRecordBytes,
          familyKey: input.slotRecordKey,
          slotRecordKey: input.slotRecordKey,
        });
        if (schema === 'v1' || schema === 'invalid') throwForSidecarSchemaV2(schema);
        continue;
      }
      if (error instanceof ExclusivePublicationErrorV2 && error.cause !== undefined) throw error.cause;
      throw error;
    }
  }
  throw new StudioPendingRecordWriteError('capacity', input.capacityMessage);
};

/** Keeps a durable hardlink to the owned inode while removing its authoritative slot name. */
const cleanupReservedSlotV2 = async (input: {
  fs: RecordIoFileSystem;
  directories: PendingDirectoriesV2;
  slot: { file: string; identity: { dev: number; ino: number }; readyFile: string };
  authorizeBeforeMutation?: () => Promise<void>;
}): Promise<boolean> => {
  const quarantine = `${input.slot.file}.${process.pid}_${++cleanupCounterV2}.cleanup`;
  const removePublicationCompanions = async (): Promise<boolean> => {
    for (const companionFile of [input.slot.readyFile, `${input.slot.readyFile.slice(0, -'.ready'.length)}.tmp`]) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await input.authorizeBeforeMutation?.();
        // eslint-disable-next-line no-await-in-loop
        const companion = await input.fs.lstat(companionFile);
        if (companion.isSymbolicLink() || !companion.isFile() || !sameIdentityV2(companion, input.slot.identity)) {
          return false;
        }
        // eslint-disable-next-line no-await-in-loop
        await input.authorizeBeforeMutation?.();
        // eslint-disable-next-line no-await-in-loop
        const authorized = await input.fs.lstat(companionFile);
        if (authorized.isSymbolicLink() || !authorized.isFile() || !sameIdentityV2(authorized, input.slot.identity)) {
          return false;
        }
        // eslint-disable-next-line no-await-in-loop
        await input.fs.rm(companionFile);
        // eslint-disable-next-line no-await-in-loop
        await syncDirectoryAuthorityV2(input.fs, input.directories.slots);
      } catch {
        return false;
      }
    }
    return true;
  };
  try {
    await assertPendingDirectoriesV2(input.fs, input.directories);
    let current: Awaited<ReturnType<RecordIoFileSystem['lstat']>>;
    try {
      current = await input.fs.lstat(input.slot.file);
    } catch (error) {
      if (!hasErrorCodeV2(error, 'ENOENT')) throw error;
      await assertPendingDirectoriesV2(input.fs, input.directories);
      return removePublicationCompanions();
    }
    if (current.isSymbolicLink() || !current.isFile() || !sameIdentityV2(current, input.slot.identity)) {
      await removePublicationCompanions();
      return false;
    }
    try {
      await input.fs.lstat(quarantine);
      return false;
    } catch (error) {
      if (!hasErrorCodeV2(error, 'ENOENT')) return false;
    }
    await input.authorizeBeforeMutation?.();
    await input.fs.link(input.slot.file, quarantine);
    await syncDirectoryAuthorityV2(input.fs, input.directories.slots);
    await assertPendingDirectoriesV2(input.fs, input.directories);
    const quarantined = await input.fs.lstat(quarantine);
    if (quarantined.isSymbolicLink() || !quarantined.isFile() || !sameIdentityV2(quarantined, input.slot.identity)) {
      // A replacement won before link. Its authoritative named slot remains untouched.
      await input.authorizeBeforeMutation?.();
      await input.fs.rm(quarantine);
      await syncDirectoryAuthorityV2(input.fs, input.directories.slots);
      return false;
    }
    let named: Awaited<ReturnType<typeof fs.lstat>> | null;
    try {
      named = await input.fs.lstat(input.slot.file);
    } catch (error) {
      if (!hasErrorCodeV2(error, 'ENOENT')) throw error;
      named = null;
    }
    if (named !== null) {
      if (
        named.isSymbolicLink() ||
        !named.isFile() ||
        typeof named.dev !== 'number' ||
        typeof named.ino !== 'number' ||
        !sameIdentityV2({ dev: Number(named.dev), ino: Number(named.ino) }, input.slot.identity)
      ) {
        await input.authorizeBeforeMutation?.();
        await input.fs.rm(quarantine);
        await syncDirectoryAuthorityV2(input.fs, input.directories.slots);
        return false;
      }
    }
    if (named !== null) {
      await assertPendingDirectoriesV2(input.fs, input.directories);
      const [authorizedNamed, authorizedQuarantine] = await Promise.all([
        input.fs.lstat(input.slot.file),
        input.fs.lstat(quarantine),
      ]);
      if (
        authorizedNamed.isSymbolicLink() ||
        !authorizedNamed.isFile() ||
        authorizedQuarantine.isSymbolicLink() ||
        !authorizedQuarantine.isFile() ||
        !sameIdentityV2(authorizedNamed, input.slot.identity) ||
        !sameIdentityV2(authorizedQuarantine, input.slot.identity)
      ) {
        return false;
      }
      await input.authorizeBeforeMutation?.();
      if (!(await removePublicationCompanions())) return false;
      await input.authorizeBeforeMutation?.();
      await input.fs.rm(input.slot.file);
      await syncDirectoryAuthorityV2(input.fs, input.directories.slots);
    }
    await input.authorizeBeforeMutation?.();
    await input.fs.rm(quarantine);
    await syncDirectoryAuthorityV2(input.fs, input.directories.slots);
    await assertPendingDirectoriesV2(input.fs, input.directories);
    return true;
  } catch {
    return false;
  }
};

const reservedSlotIsCurrentV2 = async (input: {
  fs: RecordIoFileSystem;
  directories: PendingDirectoriesV2;
  slot: { file: string; identity: { dev: number; ino: number }; readyFile: string };
  recordId: string;
  slotRecordKey: WritePendingRecordInputV2<unknown>['slotRecordKey'];
  maxRecordBytes: number;
}): Promise<boolean> => {
  await assertPendingDirectoriesV2(input.fs, input.directories);
  const record = await readBoundedRegularFileWithIdentity({
    fs: input.fs,
    canonicalRoot: input.directories.canonicalRoot,
    file: input.slot.file,
    maxBytes: input.maxRecordBytes,
  });
  await assertPendingDirectoriesV2(input.fs, input.directories);
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

/** Publishes a crash-recoverable schema-2 record and fails closed on every ambiguous authority race. */
export const writePendingRecordV2 = async <RecordType>(
  input: WritePendingRecordInputV2<RecordType>
): Promise<RecordType> => {
  const recordFs = input.fs ?? fs;
  const limits = pendingRecordLimitsV2(input.slotRecordKey);
  let serialized: string;
  try {
    if (!SAFE_RECORD_ID.test(input.recordId)) throw new RecordIoError('unsafe_path');
    serialized = JSON.stringify(input.record);
  } catch {
    throw new StudioPendingRecordWriteError('storage', 'record write failed');
  }
  if (Buffer.byteLength(serialized, 'utf8') > limits.maxRecordBytes) {
    throw new StudioPendingRecordWriteError('too_large', input.tooLargeMessage);
  }

  let directories: PendingDirectoriesV2;
  let reservedSlot: { file: string; identity: { dev: number; ino: number }; readyFile: string } | undefined;
  let terminalSnapshot: TerminalEntrySnapshotV2 | undefined;
  let slotStage = 'resolve';
  const expectedProjectId =
    typeof input.record === 'object' &&
    input.record !== null &&
    !Array.isArray(input.record) &&
    typeof (input.record as { projectId?: unknown }).projectId === 'string'
      ? (input.record as unknown as { projectId: string }).projectId
      : undefined;
  try {
    directories = await resolvePendingDirectoriesV2(
      input.pendingDir,
      recordFs,
      input.projectAuthority,
      input.slotRecordKey
    );
    await assertPendingDirectoriesV2(recordFs, directories);
    await assertPendingAuthorityV2(input.authorityFence);
    slotStage = 'preflight';
    terminalSnapshot = await preflightPendingFamilyV2({
      fs: recordFs,
      directories,
      recordId: input.recordId,
      slotRecordKey: input.slotRecordKey,
      limits,
      expectedProjectId,
      authorizeBeforeCleanup: () => assertPendingAuthorityV2(input.authorityFence),
    });
    await assertPendingAuthorityV2(input.authorityFence);
    slotStage = 'reserve';
    reservedSlot = await reserveSlotV2({
      fs: recordFs,
      directories,
      recordId: input.recordId,
      slotRecordKey: input.slotRecordKey,
      capacityMessage: input.capacityMessage,
      limits,
      authorizeBeforeLink: () => assertPendingAuthorityV2(input.authorityFence),
    });
    // A second full scan catches unsupported or malformed authority that appeared after the first
    // scan but before our reservation, so publication fails closed at either cooperative fence.
    await preflightPendingFamilyV2({
      fs: recordFs,
      directories,
      recordId: input.recordId,
      slotRecordKey: input.slotRecordKey,
      limits,
      expectedProjectId,
      authorizeBeforeCleanup: () => assertPendingAuthorityV2(input.authorityFence),
      terminalSnapshot,
      ownedUnpublishedSlot: reservedSlot,
    });
    await assertPendingAuthorityV2(input.authorityFence);
  } catch (error) {
    let reservationCleaned = true;
    if (reservedSlot !== undefined) {
      reservationCleaned = await cleanupReservedSlotV2({
        fs: recordFs,
        directories,
        slot: reservedSlot,
        authorizeBeforeMutation: () => assertPendingAuthorityV2(input.authorityFence),
      });
    }
    if (error instanceof StudioPendingRecordWriteError && error.code === 'unsupported_prototype_schema') throw error;
    if (!reservationCleaned) throw new StudioPendingRecordWriteError('storage', 'slot write failed');
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
      authorizeBeforeLink: async (source) => {
        await assertPendingDirectoriesV2(recordFs, directories);
        await assertPendingAuthorityV2(input.authorityFence);
        await preflightPendingFamilyV2({
          fs: recordFs,
          directories,
          recordId: input.recordId,
          slotRecordKey: input.slotRecordKey,
          limits,
          expectedProjectId,
          authorizeBeforeCleanup: () => assertPendingAuthorityV2(input.authorityFence),
          terminalSnapshot,
          ownedUnpublishedSlot: reservedSlot,
          ownedPublicationSource: source,
        });
        if (
          !(await reservedSlotIsCurrentV2({
            fs: recordFs,
            directories,
            slot: reservedSlot,
            recordId: input.recordId,
            slotRecordKey: input.slotRecordKey,
            maxRecordBytes: limits.maxRecordBytes,
          }))
        ) {
          throw new StudioPendingRecordWriteError('storage', 'record write failed');
        }
        await assertPendingDirectoriesV2(recordFs, directories);
        await assertPendingAuthorityV2(input.authorityFence);
      },
      authorizeBeforeCleanup: () => assertPendingAuthorityV2(input.authorityFence),
    });
    pendingPublished = true;
    await assertPendingDirectoriesV2(recordFs, directories);
    await assertPendingAuthorityV2(input.authorityFence);
    if (terminalSnapshot === undefined) throw new RecordIoError('unsafe_file');
    await assertTerminalEntrySnapshotV2(recordFs, directories, terminalSnapshot, input.recordId);
    return input.record;
  } catch (error) {
    if (error instanceof ExclusivePublicationErrorV2 && error.outcome === 'already_exists') {
      const schema = await readSidecarSchemaV2({
        fs: recordFs,
        canonicalRoot: directories.canonicalRoot,
        parent: directories.pending,
        file: path.join(directories.pending.path, `${input.recordId}.json`),
        maxRecordBytes: limits.maxRecordBytes,
        familyKey: input.slotRecordKey,
      }).catch((): SidecarSchemaV2 => 'invalid');
      if (schema === 'v1') throwForSidecarSchemaV2('v1');
      const cleaned = await cleanupReservedSlotV2({
        fs: recordFs,
        directories,
        slot: reservedSlot,
        authorizeBeforeMutation: () => assertPendingAuthorityV2(input.authorityFence),
      });
      if (!cleaned) throw new StudioPendingRecordWriteError('storage', 'record write failed');
      throw new StudioPendingRecordWriteError('storage', 'record write failed');
    }
    if (error instanceof StudioPendingRecordWriteError && error.code === 'unsupported_prototype_schema') throw error;
    if (!pendingPublished && !(error instanceof ExclusivePublicationErrorV2 && error.outcome === 'ambiguous')) {
      const cleaned = await cleanupReservedSlotV2({
        fs: recordFs,
        directories,
        slot: reservedSlot,
        authorizeBeforeMutation: () => assertPendingAuthorityV2(input.authorityFence),
      });
      if (!cleaned) throw new StudioPendingRecordWriteError('storage', 'record write failed');
    }
    if (error instanceof ExclusivePublicationErrorV2 && error.cause !== undefined) throw error.cause;
    if (error instanceof StudioPendingRecordWriteError) throw error;
    // A slot is retained only after durable final publication or an ambiguous link outcome. Main
    // owns the coordination needed to reconcile those cases without risking committed work.
    throw new StudioPendingRecordWriteError('storage', 'record write failed');
  }
};
