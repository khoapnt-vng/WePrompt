/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { promises as nodeFs } from 'node:fs';
import path from 'node:path';
import { syncDurableDirectory } from '../../service/durableDirectory';
import {
  publishExclusiveLeaseRecord,
  readBoundedRegularFileWithIdentity,
  RecordIoError,
  removeRegularRecordIfIdentity,
  type RecordIoFileSystem,
} from '../../service/recordIo';
import { isSafeInputIdV4 } from '../../service/schema2/mutations/exactInputV4';
import {
  STUDIO_PROPOSAL_CURRENT_RECORD_MAX_BYTES_V4,
  STUDIO_PROPOSAL_DECIDED_RECORD_MAX_BYTES_V4,
  STUDIO_PROPOSAL_HISTORY_MAX_BYTES_V4,
  isStudioProposalIdV4,
} from '../../service/schema2/proposals/proposalContractsV4';
import {
  CreativeStudioPilotStoreErrorV4,
  type CreativeStudioPilotStoreV4,
  type StudioPilotProjectAuthoritySnapshotV4,
  type StudioPilotProjectWriterAuthorityV4,
} from './v4';

const PROPOSAL_DIRECTORY = 'proposal';
const DECIDED_DIRECTORY = 'decided';
const CURRENT_FILE = 'current.json';
const HISTORY_FILE = 'history.json';

type Identity = { dev: number; ino: number };
type DirectoryAuthority = Identity & { path: string };
type LedgerDirectories = { project: DirectoryAuthority; root: DirectoryAuthority; decided: DirectoryAuthority };

export type StudioProposalLedgerRecordV4 = { bytes: string; identity: Identity };
export type StudioProposalHistorySnapshotV4 = { record: StudioProposalLedgerRecordV4 | null };
export type CreativeStudioProposalLedgerErrorCodeV4 = 'invalid_payload' | 'already_exists' | 'storage_error';

export class CreativeStudioProposalLedgerErrorV4 extends Error {
  readonly code: CreativeStudioProposalLedgerErrorCodeV4;
  constructor(code: CreativeStudioProposalLedgerErrorCodeV4) {
    super(code);
    this.name = 'CreativeStudioProposalLedgerErrorV4';
    this.code = code;
  }
}

export type CreativeStudioProposalLedgerOptionsV4 = {
  projectStore: CreativeStudioPilotStoreV4;
  fs?: RecordIoFileSystem;
};

export type StudioProposalLedgerAuthorityV4<
  Snapshot extends StudioPilotProjectAuthoritySnapshotV4 = StudioPilotProjectAuthoritySnapshotV4,
> = {
  snapshot: Snapshot;
  readCurrentV4(): Promise<StudioProposalLedgerRecordV4 | null>;
  confirmCurrentV4(): Promise<StudioProposalLedgerRecordV4 | null>;
  publishCurrentV4(bytes: string): Promise<StudioProposalLedgerRecordV4>;
  removeCurrentV4(expected: StudioProposalLedgerRecordV4): Promise<void>;
  readHistoryV4(): Promise<StudioProposalHistorySnapshotV4>;
  replaceHistoryV4(expected: StudioProposalHistorySnapshotV4, bytes: string): Promise<StudioProposalLedgerRecordV4>;
  readDecidedV4(proposalId: string): Promise<StudioProposalLedgerRecordV4 | null>;
  confirmDecidedV4(proposalId: string): Promise<StudioProposalLedgerRecordV4 | null>;
  publishDecidedV4(proposalId: string, bytes: string): Promise<StudioProposalLedgerRecordV4>;
  removeDecidedV4(proposalId: string, expected: StudioProposalLedgerRecordV4): Promise<void>;
};

export type StudioProposalLedgerWriterAuthorityV4 =
  StudioProposalLedgerAuthorityV4<StudioPilotProjectWriterAuthorityV4>;

export type CreativeStudioProposalLedgerV4 = {
  withProposalLedgerAuthorityV4<T>(
    projectId: string,
    operation: (a: StudioProposalLedgerAuthorityV4) => Promise<T>
  ): Promise<T>;
  withProposalTerminalAuthorityV4<T>(
    projectId: string,
    proposalId: string,
    operation: (a: StudioProposalLedgerWriterAuthorityV4) => Promise<T>
  ): Promise<T>;
  recoverProposalTerminalAuthorityV4<T>(
    projectId: string,
    proposalId: string,
    operation: (a: StudioProposalLedgerWriterAuthorityV4) => Promise<T>
  ): Promise<T>;
};

const sameIdentity = (a: Identity, b: Identity): boolean => a.dev === b.dev && a.ino === b.ino;
const hasCode = (error: unknown, code: RecordIoError['code']): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: unknown }).code === code;
const neutralize = (error: unknown): never => {
  if (error instanceof CreativeStudioProposalLedgerErrorV4 || error instanceof CreativeStudioPilotStoreErrorV4)
    throw error;
  if (hasCode(error, 'already_exists')) throw new CreativeStudioProposalLedgerErrorV4('already_exists');
  throw new CreativeStudioProposalLedgerErrorV4('storage_error');
};
const captureDirectory = async (fs: RecordIoFileSystem, file: string): Promise<DirectoryAuthority> => {
  const stat = await fs.lstat(file);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (await fs.realpath(file)) !== file) {
    throw new CreativeStudioProposalLedgerErrorV4('storage_error');
  }
  return { path: file, dev: stat.dev, ino: stat.ino };
};
const assertDirectory = async (fs: RecordIoFileSystem, expected: DirectoryAuthority): Promise<void> => {
  const current = await captureDirectory(fs, expected.path);
  if (!sameIdentity(current, expected)) throw new CreativeStudioProposalLedgerErrorV4('storage_error');
};
const assertBytes = (bytes: string, maxBytes: number): void => {
  if (
    typeof bytes !== 'string' ||
    Buffer.byteLength(bytes, 'utf8') > maxBytes ||
    new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(bytes, 'utf8')) !== bytes
  ) {
    throw new CreativeStudioProposalLedgerErrorV4('invalid_payload');
  }
};

const ensureDirectory = async (
  fs: RecordIoFileSystem,
  parent: DirectoryAuthority,
  name: string
): Promise<DirectoryAuthority> => {
  await assertDirectory(fs, parent);
  const target = path.join(parent.path, name);
  try {
    await fs.mkdir(target, { mode: 0o700 });
    await syncDurableDirectory(fs, parent.path);
  } catch (error) {
    if (!hasCode(error, 'already_exists')) throw error;
  }
  const result = await captureDirectory(fs, target);
  await assertDirectory(fs, parent);
  return result;
};

const resolveDirectories = async (
  fs: RecordIoFileSystem,
  snapshot: StudioPilotProjectAuthoritySnapshotV4,
  create: boolean
): Promise<LedgerDirectories | null> => {
  const project = await captureDirectory(fs, snapshot.projectDir);
  await snapshot.assertCurrent();
  let root: DirectoryAuthority;
  try {
    root = await captureDirectory(fs, path.join(project.path, PROPOSAL_DIRECTORY));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    if (!create) return null;
    root = await ensureDirectory(fs, project, PROPOSAL_DIRECTORY);
  }
  let decided: DirectoryAuthority;
  try {
    decided = await captureDirectory(fs, path.join(root.path, DECIDED_DIRECTORY));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    const exactRecordExists = async (name: string): Promise<boolean> => {
      try {
        await fs.lstat(path.join(root.path, name));
        return true;
      } catch (recordError) {
        if ((recordError as NodeJS.ErrnoException).code === 'ENOENT') return false;
        throw recordError;
      }
    };
    if ((await exactRecordExists(CURRENT_FILE)) || (await exactRecordExists(HISTORY_FILE))) {
      throw new CreativeStudioProposalLedgerErrorV4('storage_error');
    }
    if (!create) return null;
    decided = await ensureDirectory(fs, root, DECIDED_DIRECTORY);
  }
  await assertDirectory(fs, project);
  await assertDirectory(fs, root);
  await assertDirectory(fs, decided);
  await snapshot.assertCurrent();
  return { project, root, decided };
};

export const createCreativeStudioProposalLedgerV4 = (
  options: CreativeStudioProposalLedgerOptionsV4
): CreativeStudioProposalLedgerV4 => {
  const fs = options.fs ?? nodeFs;
  // Every recoverable residue has one exact name. Proposal storage is never enumerated.
  const publicationTemporaryId = 'proposal_publish_v1';

  const bind = <S extends StudioPilotProjectAuthoritySnapshotV4>(snapshot: S): StudioProposalLedgerAuthorityV4<S> => {
    const readAt = async (
      file: string,
      maxBytes: number,
      create = false
    ): Promise<StudioProposalLedgerRecordV4 | null> => {
      const dirs = await resolveDirectories(fs, snapshot, create);
      if (dirs === null) return null;
      const result = await readBoundedRegularFileWithIdentity({
        fs,
        canonicalRoot: snapshot.projectDir,
        file,
        maxBytes,
      });
      await assertDirectory(fs, dirs.project);
      await assertDirectory(fs, dirs.root);
      await assertDirectory(fs, dirs.decided);
      await snapshot.assertCurrent();
      return result;
    };
    const paths = async (create: boolean) => {
      const dirs = await resolveDirectories(fs, snapshot, create);
      if (dirs === null) return null;
      return {
        dirs,
        current: path.join(dirs.root.path, CURRENT_FILE),
        history: path.join(dirs.root.path, HISTORY_FILE),
      };
    };
    const publish = async (directory: DirectoryAuthority, file: string, bytes: string, maxBytes: number) => {
      assertBytes(bytes, maxBytes);
      await assertDirectory(fs, directory);
      await snapshot.assertCurrent();
      const residueFile = `${file}.${publicationTemporaryId}.tmp`;
      const residue = await readBoundedRegularFileWithIdentity({
        fs,
        canonicalRoot: snapshot.projectDir,
        file: residueFile,
        maxBytes,
      });
      if (residue !== null) {
        const removed = await removeRegularRecordIfIdentity({
          fs,
          canonicalRoot: snapshot.projectDir,
          file: residueFile,
          identity: residue.identity,
          isStillAuthorized: () => snapshot.assertCurrent().then(() => true),
        });
        if (!removed) throw new CreativeStudioProposalLedgerErrorV4('storage_error');
        await syncDurableDirectory(fs, directory.path);
      }
      await publishExclusiveLeaseRecord({
        fs,
        canonicalRoot: snapshot.projectDir,
        file,
        bytes,
        temporaryId: publicationTemporaryId,
      });
      await syncDurableDirectory(fs, directory.path);
      const record = await readAt(file, maxBytes, true);
      if (record === null || record.bytes !== bytes) throw new CreativeStudioProposalLedgerErrorV4('storage_error');
      return record;
    };
    const remove = async (
      directory: DirectoryAuthority,
      file: string,
      expected: StudioProposalLedgerRecordV4,
      maxBytes: number
    ) => {
      await assertDirectory(fs, directory);
      const current = await readAt(file, maxBytes);
      if (current === null || current.bytes !== expected.bytes || !sameIdentity(current.identity, expected.identity))
        throw new CreativeStudioProposalLedgerErrorV4('storage_error');
      const removed = await removeRegularRecordIfIdentity({
        fs,
        canonicalRoot: snapshot.projectDir,
        file,
        identity: expected.identity,
        isStillAuthorized: () => snapshot.assertCurrent().then(() => true),
      });
      if (!removed) throw new CreativeStudioProposalLedgerErrorV4('storage_error');
      await syncDurableDirectory(fs, directory.path);
      await snapshot.assertCurrent();
    };
    const decidedFile = async (proposalId: string, create: boolean) => {
      if (!isStudioProposalIdV4(proposalId)) throw new CreativeStudioProposalLedgerErrorV4('invalid_payload');
      const dirs = await resolveDirectories(fs, snapshot, create);
      return dirs === null ? null : { dirs, file: path.join(dirs.decided.path, `${proposalId}.json`) };
    };
    return {
      snapshot,
      async readCurrentV4() {
        const p = await paths(false);
        return p === null ? null : readAt(p.current, STUDIO_PROPOSAL_CURRENT_RECORD_MAX_BYTES_V4);
      },
      async confirmCurrentV4() {
        const p = await paths(false);
        if (p === null) return null;
        const before = await readAt(p.current, STUDIO_PROPOSAL_CURRENT_RECORD_MAX_BYTES_V4);
        if (before === null) return null;
        await syncDurableDirectory(fs, p.dirs.root.path);
        const after = await readAt(p.current, STUDIO_PROPOSAL_CURRENT_RECORD_MAX_BYTES_V4);
        if (after === null || after.bytes !== before.bytes || !sameIdentity(after.identity, before.identity))
          throw new CreativeStudioProposalLedgerErrorV4('storage_error');
        return after;
      },
      async publishCurrentV4(bytes) {
        const p = await paths(true);
        if (p === null) throw new CreativeStudioProposalLedgerErrorV4('storage_error');
        return publish(p.dirs.root, p.current, bytes, STUDIO_PROPOSAL_CURRENT_RECORD_MAX_BYTES_V4);
      },
      async removeCurrentV4(expected) {
        const p = await paths(false);
        if (p === null) throw new CreativeStudioProposalLedgerErrorV4('storage_error');
        await remove(p.dirs.root, p.current, expected, STUDIO_PROPOSAL_CURRENT_RECORD_MAX_BYTES_V4);
      },
      async readHistoryV4() {
        const p = await paths(false);
        return { record: p === null ? null : await readAt(p.history, STUDIO_PROPOSAL_HISTORY_MAX_BYTES_V4) };
      },
      async replaceHistoryV4(expected, bytes) {
        const p = await paths(true);
        if (p === null) throw new CreativeStudioProposalLedgerErrorV4('storage_error');
        assertBytes(bytes, STUDIO_PROPOSAL_HISTORY_MAX_BYTES_V4);
        const current = await readAt(p.history, STUDIO_PROPOSAL_HISTORY_MAX_BYTES_V4);
        if (
          (current === null) !== (expected.record === null) ||
          (current &&
            expected.record &&
            (current.bytes !== expected.record.bytes || !sameIdentity(current.identity, expected.record.identity)))
        )
          throw new CreativeStudioProposalLedgerErrorV4('storage_error');
        if (current === null) return publish(p.dirs.root, p.history, bytes, STUDIO_PROPOSAL_HISTORY_MAX_BYTES_V4);
        const temp = path.join(p.dirs.root.path, 'history.json.tmp');
        const residue = await readBoundedRegularFileWithIdentity({
          fs,
          canonicalRoot: snapshot.projectDir,
          file: temp,
          maxBytes: STUDIO_PROPOSAL_HISTORY_MAX_BYTES_V4,
        });
        if (residue !== null) {
          const removed = await removeRegularRecordIfIdentity({
            fs,
            canonicalRoot: snapshot.projectDir,
            file: temp,
            identity: residue.identity,
            isStillAuthorized: () => snapshot.assertCurrent().then(() => true),
          });
          if (!removed) throw new CreativeStudioProposalLedgerErrorV4('storage_error');
          await syncDurableDirectory(fs, p.dirs.root.path);
        }
        await fs.writeFile(temp, bytes, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
        const handle = await fs.open(temp, 'r');
        try {
          await handle.sync();
        } finally {
          await handle.close();
        }
        const again = await readAt(p.history, STUDIO_PROPOSAL_HISTORY_MAX_BYTES_V4);
        if (again === null || again.bytes !== current.bytes || !sameIdentity(again.identity, current.identity))
          throw new CreativeStudioProposalLedgerErrorV4('storage_error');
        await fs.rename(temp, p.history);
        await syncDurableDirectory(fs, p.dirs.root.path);
        const result = await readAt(p.history, STUDIO_PROPOSAL_HISTORY_MAX_BYTES_V4);
        if (result === null || result.bytes !== bytes) throw new CreativeStudioProposalLedgerErrorV4('storage_error');
        return result;
      },
      async readDecidedV4(id) {
        const p = await decidedFile(id, false);
        return p === null ? null : readAt(p.file, STUDIO_PROPOSAL_DECIDED_RECORD_MAX_BYTES_V4);
      },
      async confirmDecidedV4(id) {
        const p = await decidedFile(id, false);
        if (p === null) return null;
        const before = await readAt(p.file, STUDIO_PROPOSAL_DECIDED_RECORD_MAX_BYTES_V4);
        if (before === null) return null;
        await syncDurableDirectory(fs, p.dirs.decided.path);
        const after = await readAt(p.file, STUDIO_PROPOSAL_DECIDED_RECORD_MAX_BYTES_V4);
        if (after === null || after.bytes !== before.bytes || !sameIdentity(after.identity, before.identity))
          throw new CreativeStudioProposalLedgerErrorV4('storage_error');
        return after;
      },
      async publishDecidedV4(id, bytes) {
        const p = await decidedFile(id, true);
        if (p === null) throw new CreativeStudioProposalLedgerErrorV4('storage_error');
        return publish(p.dirs.decided, p.file, bytes, STUDIO_PROPOSAL_DECIDED_RECORD_MAX_BYTES_V4);
      },
      async removeDecidedV4(id, expected) {
        const p = await decidedFile(id, false);
        if (p === null) throw new CreativeStudioProposalLedgerErrorV4('storage_error');
        await remove(p.dirs.decided, p.file, expected, STUDIO_PROPOSAL_DECIDED_RECORD_MAX_BYTES_V4);
      },
    };
  };

  const withRead = async <T>(
    projectId: string,
    operation: (a: StudioProposalLedgerAuthorityV4) => Promise<T>
  ): Promise<T> => {
    let consumer: unknown;
    const marker = Object.freeze({});
    if (!isSafeInputIdV4(projectId) || typeof operation !== 'function')
      throw new CreativeStudioProposalLedgerErrorV4('invalid_payload');
    try {
      return await options.projectStore.withProjectAuthorityV4(projectId, async (s) => {
        try {
          return await operation(bind(s));
        } catch (error) {
          consumer = error;
          throw marker;
        }
      });
    } catch (error) {
      if (error === marker) {
        if (consumer instanceof RecordIoError) return neutralize(consumer);
        throw consumer;
      }
      return neutralize(error);
    }
  };
  const withTerminal = async <T>(
    projectId: string,
    proposalId: string,
    operation: (a: StudioProposalLedgerWriterAuthorityV4) => Promise<T>,
    recover: boolean
  ): Promise<T> => {
    if (!isSafeInputIdV4(projectId) || !isStudioProposalIdV4(proposalId) || typeof operation !== 'function')
      throw new CreativeStudioProposalLedgerErrorV4('invalid_payload');
    let consumer: unknown;
    const marker = Object.freeze({});
    try {
      const method = recover
        ? options.projectStore.recoverProjectWriterAuthorityV4
        : options.projectStore.withProjectWriterAuthorityV4;
      return await method(projectId, { purpose: 'proposal_terminal', proposalId }, async (s) => {
        try {
          return await operation(bind(s));
        } catch (e) {
          consumer = e;
          throw marker;
        }
      });
    } catch (error) {
      if (error === marker) throw consumer;
      return neutralize(error);
    }
  };
  return {
    withProposalLedgerAuthorityV4: withRead,
    withProposalTerminalAuthorityV4: (p, id, op) => withTerminal(p, id, op, false),
    recoverProposalTerminalAuthorityV4: (p, id, op) => withTerminal(p, id, op, true),
  };
};
