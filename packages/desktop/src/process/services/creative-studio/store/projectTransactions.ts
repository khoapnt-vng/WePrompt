/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { promises as nodeFs } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import type { StudioProjectV2 } from '@/common/types/project/creativeStudioTypes';
import { readBoundedRegularFileWithIdentity } from '../service/recordIo';
import {
  createStudioProjectManifestV2,
  decodeStudioProjectManifestV2,
  STUDIO_BRIEF_FILE_MAX_BYTES,
  STUDIO_BRIEF_FILE_NAME,
} from '../service/briefFile';
import { CreativeStudioStoreError, type StudioProjectCommitFacts } from './contracts';

const STUDIO_BRIEF_TRANSACTION_FILE_NAME = '.brief-transaction.json';
const STUDIO_BRIEF_TRANSACTION_SCHEMA_VERSION = 1 as const;
// JSON escaping can expand a valid 64 KiB Brief by up to six bytes per source byte.
const STUDIO_BRIEF_TRANSACTION_MAX_BYTES = 512 * 1024;
const STUDIO_PROJECT_V2_MAX_ID_LENGTH = 256;
const SAFE_ID = /^[A-Za-z0-9_-]+$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;

type StudioBriefTransactionV2 = {
  schemaVersion: typeof STUDIO_BRIEF_TRANSACTION_SCHEMA_VERSION;
  projectId: string;
  baseManifestSha256: string;
  baseBriefSha256: string | null;
  candidateManifestSha256: string;
  candidateBrief: string;
};

export type StudioFileIdentityV2 = { dev: number; ino: number };

export type StudioDirectoryAuthorityV2 = StudioFileIdentityV2 & { path: string };

export type StudioProjectFileInspectionV2 =
  | {
      status: 'supported';
      project: StudioProjectV2;
      bytes: string;
      identity: StudioFileIdentityV2;
      directory: StudioDirectoryAuthorityV2;
      briefFile: { status: 'present'; bytes: string; identity: StudioFileIdentityV2 };
      briefSynchronized: boolean;
    }
  | { status: 'unsupported_prototype_schema'; projectId: string }
  | { status: 'not_found'; projectId: string }
  | { status: 'malformed_v2'; projectId: string; error: CreativeStudioStoreError };

type SupportedProjectFileInspectionV2 = Extract<StudioProjectFileInspectionV2, { status: 'supported' }>;

type ProjectTransactionsDepsV2 = {
  fs: typeof nodeFs;
  now: () => string;
  maxProjectBytes: number;
  resolveRootChild: (root: string, child: string) => string;
  assertRegularFileOrMissing: (file: string) => Promise<void>;
  assertDirectoryAuthority: (authority: StudioDirectoryAuthorityV2) => Promise<void>;
  syncDirectoryAuthority: (authority: StudioDirectoryAuthorityV2) => Promise<void>;
  assertPathAbsent: (file: string) => Promise<void>;
  inspectProjectFile: (root: string, projectId: string) => Promise<StudioProjectFileInspectionV2>;
  requireSupportedProjectInspection: (inspected: StudioProjectFileInspectionV2) => SupportedProjectFileInspectionV2;
  observeProjectCommit: (facts: StudioProjectCommitFacts) => void;
  storageError: (error: unknown, fallback: string) => CreativeStudioStoreError;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isSafeProjectId = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= STUDIO_PROJECT_V2_MAX_ID_LENGTH && SAFE_ID.test(value);

const sameIdentityV2 = (left: StudioFileIdentityV2, right: StudioFileIdentityV2): boolean =>
  left.dev === right.dev && left.ino === right.ino;

const sha256Utf8 = (bytes: string): string => createHash('sha256').update(bytes, 'utf8').digest('hex');

const serializeJsonExact = (value: unknown): string => JSON.stringify(value, null, 2);

const parseStudioBriefTransactionV2 = (value: unknown): StudioBriefTransactionV2 | null => {
  if (
    !isRecord(value) ||
    Reflect.ownKeys(value).length !== 6 ||
    value.schemaVersion !== STUDIO_BRIEF_TRANSACTION_SCHEMA_VERSION ||
    !isSafeProjectId(value.projectId) ||
    typeof value.baseManifestSha256 !== 'string' ||
    !SHA256_HEX.test(value.baseManifestSha256) ||
    !(
      value.baseBriefSha256 === null ||
      (typeof value.baseBriefSha256 === 'string' && SHA256_HEX.test(value.baseBriefSha256))
    ) ||
    typeof value.candidateManifestSha256 !== 'string' ||
    !SHA256_HEX.test(value.candidateManifestSha256) ||
    typeof value.candidateBrief !== 'string' ||
    Buffer.byteLength(value.candidateBrief, 'utf8') > STUDIO_BRIEF_FILE_MAX_BYTES
  ) {
    return null;
  }
  return value as StudioBriefTransactionV2;
};

let temporaryFileCounter = 0;

export const createStudioProjectTransactionsV2 = (deps: ProjectTransactionsDepsV2) => {
  const {
    fs,
    now,
    maxProjectBytes,
    resolveRootChild,
    assertRegularFileOrMissing,
    assertDirectoryAuthority,
    syncDirectoryAuthority,
    assertPathAbsent,
    inspectProjectFile,
    requireSupportedProjectInspection,
    observeProjectCommit,
    storageError,
  } = deps;

  const isInsideRoot = (canonicalRoot: string, target: string): boolean =>
    target === canonicalRoot || target.startsWith(canonicalRoot + path.sep);

  const writeBytesAtomic = async (
    root: string,
    file: string,
    bytes: string,
    authorizeBeforeReplace?: () => Promise<void>
  ): Promise<void> => {
    const parent = path.dirname(file);
    if (!isInsideRoot(root, parent)) {
      throw new CreativeStudioStoreError('storage_error', 'Creative Studio storage target escaped its root');
    }
    const parentStats = await fs.lstat(parent);
    if (!parentStats.isDirectory() || parentStats.isSymbolicLink() || (await fs.realpath(parent)) !== parent) {
      throw new CreativeStudioStoreError('storage_error', 'Creative Studio storage parent is unsafe');
    }
    await assertRegularFileOrMissing(file);
    const temporaryFile = `${file}.${process.pid}.${++temporaryFileCounter}.tmp`;
    let temporaryHandle: Awaited<ReturnType<typeof fs.open>> | undefined;
    let temporaryOwned = false;
    let temporaryIdentity: StudioFileIdentityV2 | undefined;
    let published = false;
    try {
      temporaryHandle = await fs.open(temporaryFile, 'wx');
      temporaryOwned = true;
      await temporaryHandle.writeFile(bytes, { encoding: 'utf8' });
      await temporaryHandle.sync();
      const temporaryStats = await temporaryHandle.stat();
      temporaryIdentity = { dev: temporaryStats.dev, ino: temporaryStats.ino };
      const namedTemporaryStats = await fs.lstat(temporaryFile);
      if (
        !temporaryStats.isFile() ||
        namedTemporaryStats.isSymbolicLink() ||
        !namedTemporaryStats.isFile() ||
        temporaryStats.dev !== namedTemporaryStats.dev ||
        temporaryStats.ino !== namedTemporaryStats.ino
      ) {
        throw new CreativeStudioStoreError('storage_error', 'Studio storage temporary changed before publication');
      }
      await authorizeBeforeReplace?.();
      const currentTemporary = await readBoundedRegularFileWithIdentity({
        fs,
        canonicalRoot: root,
        file: temporaryFile,
        maxBytes: Math.max(1, Buffer.byteLength(bytes, 'utf8')),
      });
      if (
        currentTemporary === null ||
        currentTemporary.bytes !== bytes ||
        currentTemporary.identity.dev !== temporaryStats.dev ||
        currentTemporary.identity.ino !== temporaryStats.ino
      ) {
        throw new CreativeStudioStoreError('storage_error', 'Studio storage temporary changed before publication');
      }
      const currentParentStats = await fs.lstat(parent);
      if (
        currentParentStats.isSymbolicLink() ||
        !currentParentStats.isDirectory() ||
        currentParentStats.dev !== parentStats.dev ||
        currentParentStats.ino !== parentStats.ino ||
        (await fs.realpath(parent)) !== parent
      ) {
        throw new CreativeStudioStoreError(
          'storage_error',
          'Creative Studio storage parent changed before publication'
        );
      }
      // The temporary-file and parent proofs above perform asynchronous I/O after the first
      // authorization. Re-run the caller's full compare-and-swap proof as the final awaited
      // operation before rename so a newer project installed during those checks is preserved.
      const finalTemporaryStats = await fs.lstat(temporaryFile);
      if (
        finalTemporaryStats.isSymbolicLink() ||
        !finalTemporaryStats.isFile() ||
        finalTemporaryStats.dev !== temporaryStats.dev ||
        finalTemporaryStats.ino !== temporaryStats.ino ||
        finalTemporaryStats.size !== temporaryStats.size ||
        finalTemporaryStats.mtimeMs !== temporaryStats.mtimeMs ||
        finalTemporaryStats.ctimeMs !== temporaryStats.ctimeMs
      ) {
        throw new CreativeStudioStoreError('storage_error', 'Studio storage temporary changed before publication');
      }
      await authorizeBeforeReplace?.();
      await fs.rename(temporaryFile, file);
      published = true;
      const publishedStats = await fs.lstat(file);
      if (
        publishedStats.isSymbolicLink() ||
        !publishedStats.isFile() ||
        publishedStats.dev !== temporaryStats.dev ||
        publishedStats.ino !== temporaryStats.ino
      ) {
        throw new CreativeStudioStoreError('storage_error', 'Studio storage publication changed');
      }
      await temporaryHandle.close();
      temporaryHandle = undefined;
      const directoryHandle = await fs.open(parent, 'r');
      try {
        await directoryHandle.sync();
      } finally {
        await directoryHandle.close();
      }
    } catch (error) {
      await temporaryHandle?.close().catch((): undefined => undefined);
      if (temporaryOwned && !published && temporaryIdentity !== undefined) {
        try {
          const current = await readBoundedRegularFileWithIdentity({
            fs,
            canonicalRoot: root,
            file: temporaryFile,
            maxBytes: Math.max(1, Buffer.byteLength(bytes, 'utf8')),
          });
          if (
            current !== null &&
            current.bytes === bytes &&
            current.identity.dev === temporaryIdentity.dev &&
            current.identity.ino === temporaryIdentity.ino
          ) {
            await fs.rm(temporaryFile);
          }
        } catch {
          // A replaced or unavailable temporary cannot be removed under the original authority.
        }
      }
      throw new CreativeStudioStoreError(
        'storage_error',
        error instanceof Error ? error.message : 'Studio storage write failed'
      );
    }
  };

  const writeJsonAtomic = (root: string, file: string, value: unknown): Promise<void> =>
    writeBytesAtomic(root, file, serializeJsonExact(value));

  const serializeProjectV2ForWrite = (project: StudioProjectV2, label: string): string => {
    const bytes = serializeJsonExact(createStudioProjectManifestV2(project));
    if (Buffer.byteLength(bytes, 'utf8') > maxProjectBytes) {
      throw new CreativeStudioStoreError('invalid_payload', `${label} is too large`);
    }
    return bytes;
  };

  const assertProjectSnapshotCurrentV2 = async (input: {
    root: string;
    snapshot: SupportedProjectFileInspectionV2;
  }): Promise<void> => {
    await assertDirectoryAuthority(input.snapshot.directory);
    const file = resolveRootChild(input.snapshot.directory.path, 'project.json');
    let current: Awaited<ReturnType<typeof readBoundedRegularFileWithIdentity>>;
    try {
      current = await readBoundedRegularFileWithIdentity({
        fs,
        canonicalRoot: input.root,
        file,
        maxBytes: maxProjectBytes,
      });
    } catch (error) {
      throw storageError(error, 'Schema-2 Studio project authority changed');
    }
    if (
      current === null ||
      current.bytes !== input.snapshot.bytes ||
      !sameIdentityV2(current.identity, input.snapshot.identity)
    ) {
      throw new CreativeStudioStoreError('storage_error', 'Schema-2 Studio project authority changed');
    }
    let currentBrief: Awaited<ReturnType<typeof readBoundedRegularFileWithIdentity>>;
    try {
      currentBrief = await readBoundedRegularFileWithIdentity({
        fs,
        canonicalRoot: input.root,
        file: resolveRootChild(input.snapshot.directory.path, STUDIO_BRIEF_FILE_NAME),
        maxBytes: STUDIO_BRIEF_FILE_MAX_BYTES,
      });
    } catch (error) {
      throw storageError(error, 'Schema-2 Studio Brief authority changed');
    }
    if (
      currentBrief === null ||
      currentBrief.bytes !== input.snapshot.briefFile.bytes ||
      !sameIdentityV2(currentBrief.identity, input.snapshot.briefFile.identity)
    ) {
      throw new CreativeStudioStoreError('storage_error', 'Schema-2 Studio Brief authority changed');
    }
    await assertDirectoryAuthority(input.snapshot.directory);
  };

  const writeProjectFilesV2 = async (input: {
    root: string;
    snapshot: SupportedProjectFileInspectionV2;
    project: StudioProjectV2;
    projectBytes: string;
    authorizeBeforeReplace?: () => void | Promise<void>;
  }): Promise<void> => {
    const projectFile = resolveRootChild(input.snapshot.directory.path, 'project.json');
    if (input.project.brief === input.snapshot.project.brief && input.snapshot.briefFile.status === 'present') {
      await writeBytesAtomic(input.root, projectFile, input.projectBytes, async () => {
        await input.authorizeBeforeReplace?.();
        await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
        await input.authorizeBeforeReplace?.();
      });
      return;
    }
    if (Buffer.byteLength(input.project.brief, 'utf8') > STUDIO_BRIEF_FILE_MAX_BYTES) {
      throw new CreativeStudioStoreError('invalid_payload', 'Schema-2 Studio Brief is too large');
    }
    const briefFile = resolveRootChild(input.snapshot.directory.path, STUDIO_BRIEF_FILE_NAME);
    const transactionFile = resolveRootChild(input.snapshot.directory.path, STUDIO_BRIEF_TRANSACTION_FILE_NAME);
    const transaction: StudioBriefTransactionV2 = {
      schemaVersion: STUDIO_BRIEF_TRANSACTION_SCHEMA_VERSION,
      projectId: input.project.id,
      baseManifestSha256: sha256Utf8(input.snapshot.bytes),
      baseBriefSha256: sha256Utf8(input.snapshot.briefFile.bytes),
      candidateManifestSha256: sha256Utf8(input.projectBytes),
      candidateBrief: input.project.brief,
    };
    const transactionBytes = serializeJsonExact(transaction);
    if (Buffer.byteLength(transactionBytes, 'utf8') > STUDIO_BRIEF_TRANSACTION_MAX_BYTES) {
      throw new CreativeStudioStoreError('invalid_payload', 'Schema-2 Studio Brief transaction is too large');
    }
    await writeBytesAtomic(input.root, transactionFile, transactionBytes, async () => {
      await input.authorizeBeforeReplace?.();
      await assertPathAbsent(transactionFile);
      await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
      await input.authorizeBeforeReplace?.();
    });
    const transactionRecord = await readBoundedRegularFileWithIdentity({
      fs,
      canonicalRoot: input.root,
      file: transactionFile,
      maxBytes: STUDIO_BRIEF_TRANSACTION_MAX_BYTES,
    });
    if (transactionRecord === null || transactionRecord.bytes !== transactionBytes) {
      throw new CreativeStudioStoreError('storage_error', 'Schema-2 Studio Brief transaction was not published');
    }
    const assertTransactionCurrent = async (): Promise<void> => {
      const current = await readBoundedRegularFileWithIdentity({
        fs,
        canonicalRoot: input.root,
        file: transactionFile,
        maxBytes: STUDIO_BRIEF_TRANSACTION_MAX_BYTES,
      });
      if (
        current === null ||
        current.bytes !== transactionRecord.bytes ||
        !sameIdentityV2(current.identity, transactionRecord.identity)
      ) {
        throw new CreativeStudioStoreError('storage_error', 'Schema-2 Studio Brief transaction authority changed');
      }
    };
    await writeBytesAtomic(input.root, projectFile, input.projectBytes, async () => {
      await input.authorizeBeforeReplace?.();
      await assertTransactionCurrent();
      await assertProjectSnapshotCurrentV2({ root: input.root, snapshot: input.snapshot });
      await input.authorizeBeforeReplace?.();
    });
    const candidateManifest = await readBoundedRegularFileWithIdentity({
      fs,
      canonicalRoot: input.root,
      file: projectFile,
      maxBytes: maxProjectBytes,
    });
    if (candidateManifest === null || candidateManifest.bytes !== input.projectBytes) {
      throw new CreativeStudioStoreError('storage_error', 'Schema-2 Studio project was not published');
    }
    await writeBytesAtomic(input.root, briefFile, input.project.brief, async () => {
      await assertTransactionCurrent();
      const currentManifest = await readBoundedRegularFileWithIdentity({
        fs,
        canonicalRoot: input.root,
        file: projectFile,
        maxBytes: maxProjectBytes,
      });
      if (
        currentManifest === null ||
        currentManifest.bytes !== candidateManifest.bytes ||
        !sameIdentityV2(currentManifest.identity, candidateManifest.identity)
      ) {
        throw new CreativeStudioStoreError('storage_error', 'Schema-2 Studio project authority changed');
      }
      const currentBrief = await readBoundedRegularFileWithIdentity({
        fs,
        canonicalRoot: input.root,
        file: briefFile,
        maxBytes: STUDIO_BRIEF_FILE_MAX_BYTES,
      });
      if (
        currentBrief === null ||
        currentBrief.bytes !== input.snapshot.briefFile.bytes ||
        !sameIdentityV2(currentBrief.identity, input.snapshot.briefFile.identity)
      ) {
        throw new CreativeStudioStoreError('storage_error', 'Schema-2 Studio Brief authority changed');
      }
    });
    await assertTransactionCurrent();
    try {
      await fs.rm(transactionFile);
    } catch (error) {
      throw storageError(error, 'Schema-2 Studio Brief transaction cleanup failed');
    }
    await syncDirectoryAuthority(input.snapshot.directory);
  };

  const recoverBriefTransactionV2 = async (
    root: string,
    directory: StudioDirectoryAuthorityV2,
    expectedManifest: { bytes: string; identity: StudioFileIdentityV2 }
  ): Promise<void> => {
    const transactionFile = resolveRootChild(directory.path, STUDIO_BRIEF_TRANSACTION_FILE_NAME);
    let transactionRecord: Awaited<ReturnType<typeof readBoundedRegularFileWithIdentity>>;
    try {
      transactionRecord = await readBoundedRegularFileWithIdentity({
        fs,
        canonicalRoot: root,
        file: transactionFile,
        maxBytes: STUDIO_BRIEF_TRANSACTION_MAX_BYTES,
      });
    } catch (error) {
      throw storageError(error, 'Schema-2 Studio Brief transaction could not be read');
    }
    if (transactionRecord === null) return;
    let transaction: StudioBriefTransactionV2 | null = null;
    try {
      transaction = parseStudioBriefTransactionV2(JSON.parse(transactionRecord.bytes) as unknown);
    } catch {
      // The exact fixed-name transaction is store-owned; malformed bytes are never guessed or removed.
    }
    if (transaction === null || transaction.projectId !== path.basename(directory.path)) {
      throw new CreativeStudioStoreError('storage_error', 'Malformed schema-2 Studio Brief transaction');
    }
    const projectFile = resolveRootChild(directory.path, 'project.json');
    const briefFile = resolveRootChild(directory.path, STUDIO_BRIEF_FILE_NAME);
    const readManifest = async (): Promise<
      NonNullable<Awaited<ReturnType<typeof readBoundedRegularFileWithIdentity>>>
    > => {
      const current = await readBoundedRegularFileWithIdentity({
        fs,
        canonicalRoot: root,
        file: projectFile,
        maxBytes: maxProjectBytes,
      });
      if (current === null) throw new CreativeStudioStoreError('storage_error', 'Studio project manifest is missing');
      return current;
    };
    const readBrief = (): Promise<Awaited<ReturnType<typeof readBoundedRegularFileWithIdentity>>> =>
      readBoundedRegularFileWithIdentity({
        fs,
        canonicalRoot: root,
        file: briefFile,
        maxBytes: STUDIO_BRIEF_FILE_MAX_BYTES,
      });
    const assertTransactionCurrent = async (): Promise<void> => {
      const current = await readBoundedRegularFileWithIdentity({
        fs,
        canonicalRoot: root,
        file: transactionFile,
        maxBytes: STUDIO_BRIEF_TRANSACTION_MAX_BYTES,
      });
      if (
        current === null ||
        current.bytes !== transactionRecord.bytes ||
        !sameIdentityV2(current.identity, transactionRecord.identity)
      ) {
        throw new CreativeStudioStoreError('storage_error', 'Schema-2 Studio Brief transaction authority changed');
      }
      await assertDirectoryAuthority(directory);
    };
    const removeTransaction = async (expectedManifestSha256: string): Promise<void> => {
      await assertTransactionCurrent();
      const currentManifest = await readManifest();
      if (sha256Utf8(currentManifest.bytes) !== expectedManifestSha256) {
        throw new CreativeStudioStoreError('storage_error', 'Schema-2 Studio Brief transaction authority changed');
      }
      try {
        await fs.rm(transactionFile);
      } catch (error) {
        throw storageError(error, 'Schema-2 Studio Brief transaction cleanup failed');
      }
      await syncDirectoryAuthority(directory);
    };

    const manifest = await readManifest();
    if (manifest.bytes !== expectedManifest.bytes || !sameIdentityV2(manifest.identity, expectedManifest.identity)) {
      throw new CreativeStudioStoreError('storage_error', 'Schema-2 Studio Brief transaction authority changed');
    }
    const brief = await readBrief();
    const manifestSha256 = sha256Utf8(manifest.bytes);
    const briefSha256 = brief === null ? null : sha256Utf8(brief.bytes);
    if (manifestSha256 === transaction.baseManifestSha256) {
      // No candidate manifest was committed. Any external Brief edit remains authoritative.
      await removeTransaction(manifestSha256);
      return;
    }
    if (manifestSha256 !== transaction.candidateManifestSha256) {
      if (brief === null) {
        throw new CreativeStudioStoreError('storage_error', 'Schema-2 Studio Brief transaction diverged');
      }
      let replacement: unknown;
      try {
        replacement = JSON.parse(manifest.bytes) as unknown;
      } catch {
        throw new CreativeStudioStoreError('storage_error', 'Schema-2 Studio Brief transaction diverged');
      }
      const decodedReplacement = decodeStudioProjectManifestV2(replacement, brief.bytes);
      if (
        decodedReplacement === null ||
        decodedReplacement.project.id !== transaction.projectId ||
        !decodedReplacement.synchronized
      ) {
        throw new CreativeStudioStoreError('storage_error', 'Schema-2 Studio Brief transaction diverged');
      }
      // A complete same-project replacement won after the transaction was published. Preserve it.
      await removeTransaction(manifestSha256);
      return;
    }
    const candidateBriefSha256 = sha256Utf8(transaction.candidateBrief);
    if (briefSha256 === candidateBriefSha256) {
      await removeTransaction(manifestSha256);
      return;
    }
    if (briefSha256 === transaction.baseBriefSha256) {
      await writeBytesAtomic(root, briefFile, transaction.candidateBrief, async () => {
        await assertTransactionCurrent();
        const currentManifest = await readManifest();
        const currentBrief = await readBrief();
        if (
          sha256Utf8(currentManifest.bytes) !== transaction.candidateManifestSha256 ||
          (currentBrief === null ? null : sha256Utf8(currentBrief.bytes)) !== transaction.baseBriefSha256
        ) {
          throw new CreativeStudioStoreError('storage_error', 'Schema-2 Studio Brief transaction authority changed');
        }
      });
      await removeTransaction(manifestSha256);
      return;
    }
    if (brief === null) {
      throw new CreativeStudioStoreError('storage_error', 'Schema-2 Studio Brief transaction lost its authority');
    }
    let parsedManifest: unknown;
    try {
      parsedManifest = JSON.parse(manifest.bytes) as unknown;
    } catch {
      throw new CreativeStudioStoreError('storage_error', 'Malformed schema-2 Studio project manifest');
    }
    const decoded = decodeStudioProjectManifestV2(parsedManifest, brief.bytes);
    if (decoded === null || decoded.project.id !== transaction.projectId) {
      throw new CreativeStudioStoreError('storage_error', 'Malformed schema-2 Studio project manifest');
    }
    const synchronizedProject: StudioProjectV2 = {
      ...decoded.project,
      revision: decoded.project.revision + 1,
      updatedAt: now(),
    };
    const synchronizedBytes = serializeProjectV2ForWrite(synchronizedProject, 'Schema-2 Studio Brief recovery project');
    await writeBytesAtomic(root, projectFile, synchronizedBytes, async () => {
      await assertTransactionCurrent();
      const currentManifest = await readManifest();
      const currentBrief = await readBrief();
      if (
        currentBrief === null ||
        sha256Utf8(currentManifest.bytes) !== transaction.candidateManifestSha256 ||
        currentBrief.bytes !== brief.bytes ||
        !sameIdentityV2(currentBrief.identity, brief.identity)
      ) {
        throw new CreativeStudioStoreError('storage_error', 'Schema-2 Studio Brief transaction authority changed');
      }
    });
    observeProjectCommit(
      Object.freeze({
        projectId: transaction.projectId,
        previousRevision: decoded.project.revision,
        committedRevision: synchronizedProject.revision,
        committedAt: synchronizedProject.updatedAt,
        commitTag: 'brief:file-sync',
      })
    );
    await removeTransaction(sha256Utf8(synchronizedBytes));
  };

  const synchronizeBriefFileV2InsideQueue = async (
    root: string,
    snapshot: SupportedProjectFileInspectionV2
  ): Promise<SupportedProjectFileInspectionV2> => {
    if (snapshot.briefSynchronized) return snapshot;
    const contentChanged = !snapshot.briefSynchronized;
    const project: StudioProjectV2 = contentChanged
      ? { ...snapshot.project, revision: snapshot.project.revision + 1, updatedAt: now() }
      : snapshot.project;
    const projectBytes = serializeProjectV2ForWrite(project, 'Schema-2 Studio Brief synchronization project');
    await writeProjectFilesV2({ root, snapshot, project, projectBytes });
    if (contentChanged) {
      observeProjectCommit(
        Object.freeze({
          projectId: project.id,
          previousRevision: snapshot.project.revision,
          committedRevision: project.revision,
          committedAt: project.updatedAt,
          commitTag: 'brief:file-sync',
        })
      );
    }
    const synchronized = requireSupportedProjectInspection(await inspectProjectFile(root, project.id));
    if (!synchronized.briefSynchronized) {
      throw new CreativeStudioStoreError('storage_error', 'Schema-2 Studio Brief synchronization did not settle');
    }
    return synchronized;
  };

  return {
    assertProjectSnapshotCurrentV2,
    recoverBriefTransactionV2,
    serializeProjectV2ForWrite,
    synchronizeBriefFileV2InsideQueue,
    writeBytesAtomic,
    writeJsonAtomic,
    writeProjectFilesV2,
  };
};
