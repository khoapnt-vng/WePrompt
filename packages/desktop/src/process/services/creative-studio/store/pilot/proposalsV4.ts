/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash, randomBytes } from 'node:crypto';
import { type Dirent, promises as nodeFs } from 'node:fs';
import path from 'node:path';
import { syncDurableDirectory } from '../../service/durableDirectory';
import {
  readBoundedRegularFileWithIdentity,
  resolveSafeRecordDirectory,
  type RecordIoFileSystem,
} from '../../service/recordIo';
import { hasExactInputKeysV4, isPlainInputRecordV4 } from '../../service/schema2/mutations/exactInputV4';
import {
  STUDIO_PROPOSAL_MAX_RECORD_BYTES_V4,
  STUDIO_PROPOSAL_SCHEMA_VERSION_V4,
  admitStudioProposalRecordV4,
  parseStudioProposalRecordV4,
  parseStudioProposalSlotV4,
  type StudioProposalRecordV4,
  type StudioProposalSlotV4,
} from '../../service/schema2/proposals/proposalContractsV4';
import {
  CreativeStudioPilotStoreErrorV4,
  type CreativeStudioPilotStoreV4,
  type StudioPilotProjectAuthoritySnapshotV4,
} from './v4';

const PROPOSAL_DIRECTORY = 'proposals';
const PENDING_RECORD = 'pending-v4.json';
const PENDING_ENVELOPE_SCHEMA_VERSION = 1 as const;
const MAX_PENDING_ENVELOPE_BYTES = 1_048_576;
const MAX_PENDING_DIRECTORY_ENTRIES = 8;
const SAFE_TEMPORARY_ID = /^[A-Za-z0-9_-]{8,128}$/;
const SAFE_MAIN_INSTANCE_ID = /^[A-Za-z0-9_-]{8,64}$/;
const PENDING_TEMPORARY = /^pending-v4\.json\.([A-Za-z0-9_-]{8,64})\.([A-Za-z0-9_-]{8,128})\.tmp$/;
const LOWERCASE_SHA256 = /^[a-f0-9]{64}$/;
const PROCESS_MAIN_INSTANCE_ID = randomBytes(16).toString('hex');
const RECORD_INPUT_KEYS = new Set(['projectId', 'proposalId', 'proposal']);
const ENVELOPE_KEYS = new Set([
  'schemaVersion',
  'projectId',
  'proposalId',
  'baseRevision',
  'baseAuthoringRevision',
  'proposalSha256',
  'proposalBytes',
  'slot',
]);

type PendingEnvelopeV4 = {
  schemaVersion: typeof PENDING_ENVELOPE_SCHEMA_VERSION;
  projectId: string;
  proposalId: string;
  baseRevision: number;
  baseAuthoringRevision: number;
  proposalSha256: string;
  proposalBytes: string;
  slot: StudioProposalSlotV4;
};

type IdentifiedPendingEnvelopeV4 = {
  envelope: PendingEnvelopeV4;
  bytes: string;
  identity: { dev: number; ino: number };
};

type DirectoryAuthorityV4 = {
  path: string;
  dev: number;
  ino: number;
};

export type StudioPendingProposalSnapshotV4 = {
  record: StudioProposalRecordV4;
  slot: StudioProposalSlotV4;
  proposalBytes: string;
  proposalSha256: string;
  baseRevision: number;
  baseAuthoringRevision: number;
};

export type StudioRecordProposalResultV4 =
  | ({ status: 'recorded' } & StudioPendingProposalSnapshotV4)
  | { status: 'refused'; reason: 'invalid_payload' | 'stale_authoring' | 'existing_pending' }
  | {
      status: 'refused';
      reason: 'proposal_too_large';
      byteLength: number;
      maxBytes: typeof STUDIO_PROPOSAL_MAX_RECORD_BYTES_V4;
    };

export type StudioProposalSidecarStorageStepV4 =
  | 'temporary_durable'
  | 'pending_linked'
  | 'pending_durable'
  | 'complete';

export type CreativeStudioProposalSidecarsOptionsV4 = {
  projectStore: CreativeStudioPilotStoreV4;
  fs?: RecordIoFileSystem;
  /** Test seam; production sidecars in one Main process share the module-scoped instance id. */
  mainInstanceId?: string;
  createTemporaryId?: () => string;
  onStorageStep?: (step: StudioProposalSidecarStorageStepV4, projectId: string) => void | Promise<void>;
};

export type CreativeStudioProposalSidecarsV4 = {
  recordProposalV4(input: unknown): Promise<StudioRecordProposalResultV4>;
  getPendingProposalV4(projectId: string): Promise<StudioPendingProposalSnapshotV4 | null>;
};

export type CreativeStudioProposalSidecarErrorCodeV4 = 'unsupported_prototype_schema' | 'storage_error';

export class CreativeStudioProposalSidecarErrorV4 extends Error {
  readonly code: CreativeStudioProposalSidecarErrorCodeV4;

  constructor(code: CreativeStudioProposalSidecarErrorCodeV4) {
    super(code);
    this.name = 'CreativeStudioProposalSidecarErrorV4';
    this.code = code;
  }
}

const sha256Utf8 = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');

const sameIdentity = (left: { dev: number; ino: number }, right: { dev: number; ino: number }): boolean =>
  left.dev === right.dev && left.ino === right.ino;

const isPositiveSafeInteger = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 1;

const hasErrorCode = (error: unknown, code: string): boolean =>
  typeof error === 'object' && error !== null && !Array.isArray(error) && (error as { code?: unknown }).code === code;

const storageError = (error: unknown): never => {
  if (error instanceof CreativeStudioProposalSidecarErrorV4 || error instanceof CreativeStudioPilotStoreErrorV4) {
    throw error;
  }
  throw new CreativeStudioProposalSidecarErrorV4('storage_error');
};

const snapshotRecordInput = (value: unknown): { projectId: string; proposalId: string; proposal: unknown } | null => {
  try {
    if (!isPlainInputRecordV4(value) || !hasExactInputKeysV4(value, RECORD_INPUT_KEYS)) return null;
    return {
      projectId: value.projectId as string,
      proposalId: value.proposalId as string,
      proposal: value.proposal,
    };
  } catch {
    return null;
  }
};

const captureDirectory = async (fs: RecordIoFileSystem, directory: string): Promise<DirectoryAuthorityV4> => {
  const stats = await fs.lstat(directory);
  if (!stats.isDirectory() || stats.isSymbolicLink() || (await fs.realpath(directory)) !== directory) {
    throw new CreativeStudioProposalSidecarErrorV4('storage_error');
  }
  return { path: directory, dev: stats.dev, ino: stats.ino };
};

const assertDirectory = async (fs: RecordIoFileSystem, authority: DirectoryAuthorityV4): Promise<void> => {
  const current = await captureDirectory(fs, authority.path);
  if (!sameIdentity(current, authority)) throw new CreativeStudioProposalSidecarErrorV4('storage_error');
};

const resolveProposalDirectory = async (input: {
  fs: RecordIoFileSystem;
  snapshot: StudioPilotProjectAuthoritySnapshotV4;
  createIfMissing: boolean;
}): Promise<DirectoryAuthorityV4 | null> => {
  try {
    const project = await captureDirectory(input.fs, input.snapshot.projectDir);
    await input.snapshot.assertAuthoringCurrent();
    let resolved: string | null;
    try {
      resolved = await resolveSafeRecordDirectory({
        fs: input.fs,
        canonicalRoot: project.path,
        parent: project.path,
        name: PROPOSAL_DIRECTORY,
        createIfMissing: input.createIfMissing,
      });
    } catch (error) {
      if (!input.createIfMissing) throw error;
      // Another Main instance may have won the empty-family mkdir. Accept only the same safe,
      // canonical directory on the retry; every other creation failure remains a storage error.
      resolved = await resolveSafeRecordDirectory({
        fs: input.fs,
        canonicalRoot: project.path,
        parent: project.path,
        name: PROPOSAL_DIRECTORY,
        createIfMissing: false,
      });
      if (resolved === null) throw error;
    }
    await input.snapshot.assertAuthoringCurrent();
    if (resolved === null) return null;
    const proposals = await captureDirectory(input.fs, resolved);
    await assertDirectory(input.fs, project);
    await input.snapshot.assertAuthoringCurrent();
    return proposals;
  } catch (error) {
    return storageError(error);
  }
};

const parsePendingEnvelope = (input: {
  projectId: string;
  bytes: string;
}): { envelope: PendingEnvelopeV4; record: StudioProposalRecordV4 } => {
  let value: unknown;
  try {
    value = JSON.parse(input.bytes) as unknown;
  } catch {
    throw new CreativeStudioProposalSidecarErrorV4('storage_error');
  }
  if (!isPlainInputRecordV4(value) || !hasExactInputKeysV4(value, ENVELOPE_KEYS)) {
    throw new CreativeStudioProposalSidecarErrorV4('storage_error');
  }
  if (
    value.schemaVersion !== PENDING_ENVELOPE_SCHEMA_VERSION ||
    value.projectId !== input.projectId ||
    typeof value.proposalId !== 'string' ||
    !isPositiveSafeInteger(value.baseRevision) ||
    !isPositiveSafeInteger(value.baseAuthoringRevision) ||
    value.baseAuthoringRevision > value.baseRevision ||
    typeof value.proposalSha256 !== 'string' ||
    !LOWERCASE_SHA256.test(value.proposalSha256) ||
    typeof value.proposalBytes !== 'string'
  ) {
    throw new CreativeStudioProposalSidecarErrorV4('storage_error');
  }
  if (Buffer.byteLength(value.proposalBytes, 'utf8') > STUDIO_PROPOSAL_MAX_RECORD_BYTES_V4) {
    throw new CreativeStudioProposalSidecarErrorV4('storage_error');
  }
  let proposalValue: unknown;
  try {
    proposalValue = JSON.parse(value.proposalBytes) as unknown;
  } catch {
    throw new CreativeStudioProposalSidecarErrorV4('storage_error');
  }
  const parsedProposal = parseStudioProposalRecordV4({
    projectId: input.projectId,
    proposalId: value.proposalId,
    value: proposalValue,
  });
  if (parsedProposal.status === 'unsupported_prototype_schema') {
    throw new CreativeStudioProposalSidecarErrorV4('unsupported_prototype_schema');
  }
  if (parsedProposal.status !== 'valid') throw new CreativeStudioProposalSidecarErrorV4('storage_error');
  const parsedSlot = parseStudioProposalSlotV4({
    projectId: input.projectId,
    proposalId: value.proposalId,
    value: value.slot,
  });
  if (parsedSlot.status === 'unsupported_prototype_schema') {
    throw new CreativeStudioProposalSidecarErrorV4('unsupported_prototype_schema');
  }
  if (
    parsedSlot.status !== 'valid' ||
    parsedProposal.record.baseAuthoringRevision !== value.baseAuthoringRevision ||
    parsedSlot.record.reservedAt !== parsedProposal.record.createdAt ||
    sha256Utf8(value.proposalBytes) !== value.proposalSha256 ||
    JSON.stringify(parsedProposal.record) !== value.proposalBytes
  ) {
    throw new CreativeStudioProposalSidecarErrorV4('storage_error');
  }
  const envelope: PendingEnvelopeV4 = {
    schemaVersion: PENDING_ENVELOPE_SCHEMA_VERSION,
    projectId: input.projectId,
    proposalId: value.proposalId,
    baseRevision: value.baseRevision,
    baseAuthoringRevision: value.baseAuthoringRevision,
    proposalSha256: value.proposalSha256,
    proposalBytes: value.proposalBytes,
    slot: parsedSlot.record,
  };
  if (JSON.stringify(envelope) !== input.bytes) throw new CreativeStudioProposalSidecarErrorV4('storage_error');
  return { envelope, record: parsedProposal.record };
};

const readPending = async (input: {
  fs: RecordIoFileSystem;
  snapshot: StudioPilotProjectAuthoritySnapshotV4;
  directory: DirectoryAuthorityV4 | null;
  mainInstanceId: string;
}): Promise<(IdentifiedPendingEnvelopeV4 & { record: StudioProposalRecordV4 }) | null> => {
  if (input.directory === null) return null;
  try {
    await assertDirectory(input.fs, input.directory);
    const directory = await input.fs.opendir(input.directory.path);
    const entries: Dirent[] = [];
    try {
      for await (const entry of directory) {
        if (entries.length >= MAX_PENDING_DIRECTORY_ENTRIES) {
          throw new CreativeStudioProposalSidecarErrorV4('storage_error');
        }
        entries.push(entry);
      }
    } finally {
      await directory.close().catch((): undefined => undefined);
    }
    const temporaryEntries: Array<{ name: string; mainInstanceId: string }> = [];
    for (const entry of entries) {
      const isPending = entry.name === PENDING_RECORD;
      const temporary = PENDING_TEMPORARY.exec(entry.name);
      if ((!isPending && temporary === null) || !entry.isFile() || entry.isSymbolicLink()) {
        throw new CreativeStudioProposalSidecarErrorV4('storage_error');
      }
      if (temporary !== null) temporaryEntries.push({ name: entry.name, mainInstanceId: temporary[1]! });
    }
    const file = path.join(input.directory.path, PENDING_RECORD);
    const identified = await readBoundedRegularFileWithIdentity({
      fs: input.fs,
      canonicalRoot: input.snapshot.projectDir,
      file,
      maxBytes: MAX_PENDING_ENVELOPE_BYTES,
    });
    await assertDirectory(input.fs, input.directory);
    await input.snapshot.assertAuthoringCurrent();
    if (identified === null) {
      // Current-instance staging may still be live. A different instance id proves an actual Main
      // restart in this single-process service, so its unpublished residue can be reclaimed.
      if (temporaryEntries.some((entry) => entry.mainInstanceId === input.mainInstanceId)) {
        throw new CreativeStudioProposalSidecarErrorV4('storage_error');
      }
      for (const entry of temporaryEntries) {
        // eslint-disable-next-line no-await-in-loop
        await removeClassifiedTemporary({
          fs: input.fs,
          directory: input.directory,
          file: path.join(input.directory.path, entry.name),
        });
      }
      if (temporaryEntries.length > 0) {
        await assertDirectory(input.fs, input.directory);
        await input.snapshot.assertAuthoringCurrent();
      }
      return null;
    }
    const parsed = parsePendingEnvelope({ projectId: input.snapshot.project.id, bytes: identified.bytes });
    let removedLinkedCompanion = false;
    for (const entry of temporaryEntries) {
      const temporaryFile = path.join(input.directory.path, entry.name);
      if (entry.mainInstanceId !== input.mainInstanceId) {
        // The canonical final record owns the slot. Any candidate from a prior Main instance is
        // non-authoritative regardless of how far its write progressed.
        // eslint-disable-next-line no-await-in-loop
        await removeClassifiedTemporary({ fs: input.fs, directory: input.directory, file: temporaryFile });
        removedLinkedCompanion = true;
        continue;
      }
      // A crash after link(2) leaves two names for the same inode. That is the only temporary
      // residue safe to reconcile automatically; every other candidate fails closed.
      // eslint-disable-next-line no-await-in-loop
      const temporary = await readBoundedRegularFileWithIdentity({
        fs: input.fs,
        canonicalRoot: input.snapshot.projectDir,
        file: temporaryFile,
        maxBytes: MAX_PENDING_ENVELOPE_BYTES,
      });
      if (temporary === null) {
        // Another authority holder may have reconciled the same observed name first.
        continue;
      }
      if (sameIdentity(temporary.identity, identified.identity)) {
        if (temporary.bytes !== identified.bytes) throw new CreativeStudioProposalSidecarErrorV4('storage_error');
      } else {
        // A concurrently staged, fully valid loser cannot acquire the already-published slot. It
        // is safe to remove; malformed lookalikes remain storage errors rather than being erased.
        parsePendingEnvelope({ projectId: input.snapshot.project.id, bytes: temporary.bytes });
      }
      // eslint-disable-next-line no-await-in-loop
      await assertDirectory(input.fs, input.directory);
      let current: Awaited<ReturnType<RecordIoFileSystem['lstat']>>;
      try {
        // eslint-disable-next-line no-await-in-loop
        current = await input.fs.lstat(temporaryFile);
      } catch (error) {
        if (hasErrorCode(error, 'ENOENT')) continue;
        throw error;
      }
      if (!current.isFile() || current.isSymbolicLink() || !sameIdentity(current, temporary.identity)) {
        throw new CreativeStudioProposalSidecarErrorV4('storage_error');
      }
      // eslint-disable-next-line no-await-in-loop
      await input.fs.rm(temporaryFile);
      // eslint-disable-next-line no-await-in-loop
      await syncDurableDirectory(input.fs, input.directory.path);
      removedLinkedCompanion = true;
    }
    if (removedLinkedCompanion) {
      await assertDirectory(input.fs, input.directory);
      await input.snapshot.assertAuthoringCurrent();
    }
    return { envelope: parsed.envelope, record: parsed.record, bytes: identified.bytes, identity: identified.identity };
  } catch (error) {
    return storageError(error);
  }
};

const snapshotFromPending = (
  pending: IdentifiedPendingEnvelopeV4 & { record: StudioProposalRecordV4 }
): StudioPendingProposalSnapshotV4 => ({
  record: structuredClone(pending.record),
  slot: structuredClone(pending.envelope.slot),
  proposalBytes: pending.envelope.proposalBytes,
  proposalSha256: pending.envelope.proposalSha256,
  baseRevision: pending.envelope.baseRevision,
  baseAuthoringRevision: pending.envelope.baseAuthoringRevision,
});

const removeOwnedTemporary = async (input: {
  fs: RecordIoFileSystem;
  directory: DirectoryAuthorityV4;
  file: string;
  identity: { dev: number; ino: number } | null;
}): Promise<void> => {
  if (input.identity === null) return;
  try {
    await assertDirectory(input.fs, input.directory);
    const stats = await input.fs.lstat(input.file);
    if (stats.isFile() && !stats.isSymbolicLink() && sameIdentity(stats, input.identity)) {
      await input.fs.rm(input.file);
      await syncDurableDirectory(input.fs, input.directory.path);
    }
  } catch {
    // A uniquely named, non-authoritative temporary is preserved after lost authority.
  }
};

const removeClassifiedTemporary = async (input: {
  fs: RecordIoFileSystem;
  directory: DirectoryAuthorityV4;
  file: string;
}): Promise<void> => {
  await assertDirectory(input.fs, input.directory);
  let observed: Awaited<ReturnType<RecordIoFileSystem['lstat']>>;
  try {
    observed = await input.fs.lstat(input.file);
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) return;
    throw error;
  }
  if (!observed.isFile() || observed.isSymbolicLink()) {
    throw new CreativeStudioProposalSidecarErrorV4('storage_error');
  }
  await assertDirectory(input.fs, input.directory);
  const current = await input.fs.lstat(input.file);
  if (!current.isFile() || current.isSymbolicLink() || !sameIdentity(current, observed)) {
    throw new CreativeStudioProposalSidecarErrorV4('storage_error');
  }
  await input.fs.rm(input.file);
  await syncDurableDirectory(input.fs, input.directory.path);
};

const publishPending = async (input: {
  fs: RecordIoFileSystem;
  snapshot: StudioPilotProjectAuthoritySnapshotV4;
  directory: DirectoryAuthorityV4;
  envelope: PendingEnvelopeV4;
  envelopeBytes: string;
  mainInstanceId: string;
  temporaryId: string;
  storageStep: (step: StudioProposalSidecarStorageStepV4) => Promise<void>;
}): Promise<'published' | 'already_exists'> => {
  const finalFile = path.join(input.directory.path, PENDING_RECORD);
  const temporaryFile = `${finalFile}.${input.mainInstanceId}.${input.temporaryId}.tmp`;
  let handle: Awaited<ReturnType<RecordIoFileSystem['open']>> | undefined;
  let temporaryIdentity: { dev: number; ino: number } | null = null;
  let linked = false;
  try {
    await assertDirectory(input.fs, input.directory);
    handle = await input.fs.open(temporaryFile, 'wx');
    const opened = await handle.stat();
    if (!opened.isFile()) throw new CreativeStudioProposalSidecarErrorV4('storage_error');
    temporaryIdentity = { dev: opened.dev, ino: opened.ino };
    await handle.writeFile(input.envelopeBytes, { encoding: 'utf8' });
    await handle.sync();
    await handle.close();
    handle = undefined;
    const staged = await readBoundedRegularFileWithIdentity({
      fs: input.fs,
      canonicalRoot: input.snapshot.projectDir,
      file: temporaryFile,
      maxBytes: MAX_PENDING_ENVELOPE_BYTES,
    });
    if (
      staged === null ||
      staged.bytes !== input.envelopeBytes ||
      !sameIdentity(staged.identity, temporaryIdentity) ||
      parsePendingEnvelope({ projectId: input.snapshot.project.id, bytes: staged.bytes }).envelope.proposalSha256 !==
        input.envelope.proposalSha256
    ) {
      throw new CreativeStudioProposalSidecarErrorV4('storage_error');
    }
    await input.storageStep('temporary_durable');
    await assertDirectory(input.fs, input.directory);
    await input.snapshot.assertAuthoringCurrent();
    try {
      await input.fs.link(temporaryFile, finalFile);
      linked = true;
    } catch (error) {
      // A competing reader may have reconciled this valid loser after another writer published.
      // In both races the caller must reread and validate the authoritative final record below.
      if (!hasErrorCode(error, 'EEXIST') && !hasErrorCode(error, 'ENOENT')) throw error;
      await removeOwnedTemporary({
        fs: input.fs,
        directory: input.directory,
        file: temporaryFile,
        identity: temporaryIdentity,
      });
      return 'already_exists';
    }
    await input.storageStep('pending_linked');
    await syncDurableDirectory(input.fs, input.directory.path);
    await input.storageStep('pending_durable');
    await assertDirectory(input.fs, input.directory);
    await input.snapshot.assertAuthoringCurrent();
    const published = await readBoundedRegularFileWithIdentity({
      fs: input.fs,
      canonicalRoot: input.snapshot.projectDir,
      file: finalFile,
      maxBytes: MAX_PENDING_ENVELOPE_BYTES,
    });
    if (
      published === null ||
      published.bytes !== input.envelopeBytes ||
      !sameIdentity(published.identity, temporaryIdentity)
    ) {
      throw new CreativeStudioProposalSidecarErrorV4('storage_error');
    }
    await removeOwnedTemporary({
      fs: input.fs,
      directory: input.directory,
      file: temporaryFile,
      identity: temporaryIdentity,
    });
    await input.storageStep('complete');
    return 'published';
  } catch (error) {
    await handle?.close().catch((): undefined => undefined);
    if (!linked) {
      await removeOwnedTemporary({
        fs: input.fs,
        directory: input.directory,
        file: temporaryFile,
        identity: temporaryIdentity,
      });
    }
    return storageError(error);
  }
};

/**
 * Creates the inactive schema-7 proposal authority. A pending proposal is one immutable envelope;
 * its exact admitted bytes are the later commit-attribution input, while the envelope version and
 * proposal protocol version remain independent from the project schema discriminator.
 */
export const createCreativeStudioProposalSidecarsV4 = (
  options: CreativeStudioProposalSidecarsOptionsV4
): CreativeStudioProposalSidecarsV4 => {
  const fs = options.fs ?? nodeFs;
  const mainInstanceId = options.mainInstanceId ?? PROCESS_MAIN_INSTANCE_ID;
  if (typeof mainInstanceId !== 'string' || !SAFE_MAIN_INSTANCE_ID.test(mainInstanceId)) {
    throw new CreativeStudioProposalSidecarErrorV4('storage_error');
  }
  const createTemporaryId = options.createTemporaryId ?? (() => randomBytes(16).toString('hex'));
  const storageStep = async (step: StudioProposalSidecarStorageStepV4, projectId: string): Promise<void> => {
    await options.onStorageStep?.(step, projectId);
  };

  return {
    async recordProposalV4(inputValue) {
      const input = snapshotRecordInput(inputValue);
      if (input === null) return { status: 'refused', reason: 'invalid_payload' };
      let admission: ReturnType<typeof admitStudioProposalRecordV4>;
      try {
        admission = admitStudioProposalRecordV4({
          projectId: input.projectId,
          proposalId: input.proposalId,
          value: input.proposal,
        });
      } catch {
        return { status: 'refused', reason: 'invalid_payload' };
      }
      if (admission.status !== 'valid' && admission.status !== 'proposal_too_large') {
        return { status: 'refused', reason: 'invalid_payload' };
      }
      const baseAuthoringRevision =
        admission.status === 'valid'
          ? admission.record.baseAuthoringRevision
          : // Admission has already walked and validated every own data property before returning
            // proposal_too_large; only the size arm omits its canonical snapshot from the public result.
            (input.proposal as StudioProposalRecordV4).baseAuthoringRevision;

      return options.projectStore.withProjectAuthorityV4(input.projectId, async (snapshot) => {
        if (baseAuthoringRevision !== snapshot.project.authoringRevision) {
          return { status: 'refused', reason: 'stale_authoring' } as const;
        }
        const existingDirectory = await resolveProposalDirectory({ fs, snapshot, createIfMissing: false });
        const existing = await readPending({ fs, snapshot, directory: existingDirectory, mainInstanceId });
        if (existing !== null) return { status: 'refused', reason: 'existing_pending' } as const;
        if (admission.status === 'proposal_too_large') {
          return {
            status: 'refused',
            reason: 'proposal_too_large',
            byteLength: admission.byteLength,
            maxBytes: admission.maxBytes,
          } as const;
        }
        const proposalSha256 = sha256Utf8(admission.proposalBytes);
        const slot: StudioProposalSlotV4 = {
          schemaVersion: STUDIO_PROPOSAL_SCHEMA_VERSION_V4,
          proposalId: admission.record.id,
          projectId: admission.record.projectId,
          reservedAt: admission.record.createdAt,
        };
        const envelope: PendingEnvelopeV4 = {
          schemaVersion: PENDING_ENVELOPE_SCHEMA_VERSION,
          projectId: admission.record.projectId,
          proposalId: admission.record.id,
          baseRevision: snapshot.project.revision,
          baseAuthoringRevision: admission.record.baseAuthoringRevision,
          proposalSha256,
          proposalBytes: admission.proposalBytes,
          slot,
        };
        const envelopeBytes = JSON.stringify(envelope);
        if (Buffer.byteLength(envelopeBytes, 'utf8') > MAX_PENDING_ENVELOPE_BYTES) {
          throw new CreativeStudioProposalSidecarErrorV4('storage_error');
        }
        const temporaryId = createTemporaryId();
        if (typeof temporaryId !== 'string' || !SAFE_TEMPORARY_ID.test(temporaryId)) {
          throw new CreativeStudioProposalSidecarErrorV4('storage_error');
        }
        const directory = await resolveProposalDirectory({ fs, snapshot, createIfMissing: true });
        if (directory === null) throw new CreativeStudioProposalSidecarErrorV4('storage_error');
        const outcome = await publishPending({
          fs,
          snapshot,
          directory,
          envelope,
          envelopeBytes,
          mainInstanceId,
          temporaryId,
          storageStep: (step) => storageStep(step, input.projectId),
        });
        if (outcome === 'already_exists') {
          const raced = await readPending({ fs, snapshot, directory, mainInstanceId });
          if (raced === null) throw new CreativeStudioProposalSidecarErrorV4('storage_error');
          return { status: 'refused', reason: 'existing_pending' } as const;
        }
        const durable = await readPending({ fs, snapshot, directory, mainInstanceId });
        if (durable === null || durable.bytes !== envelopeBytes || durable.envelope.proposalSha256 !== proposalSha256) {
          throw new CreativeStudioProposalSidecarErrorV4('storage_error');
        }
        return { status: 'recorded', ...snapshotFromPending(durable) } as const;
      });
    },

    async getPendingProposalV4(projectId) {
      return options.projectStore.withProjectAuthorityV4(projectId, async (snapshot) => {
        const directory = await resolveProposalDirectory({ fs, snapshot, createIfMissing: false });
        const pending = await readPending({ fs, snapshot, directory, mainInstanceId });
        return pending === null ? null : snapshotFromPending(pending);
      });
    },
  };
};
