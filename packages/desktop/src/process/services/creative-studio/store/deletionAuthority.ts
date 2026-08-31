/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash } from 'node:crypto';
import { constants as fsConstants, type promises as nodeFs } from 'node:fs';
import path from 'node:path';
import { readBoundedRegularFileWithIdentity } from '../service/recordIo';
import {
  decodeStudioProjectManifestV2,
  STUDIO_BRIEF_FILE_MAX_BYTES,
  STUDIO_BRIEF_FILE_NAME,
} from '../service/briefFile';
import { CreativeStudioStoreError } from './contracts';
import type {
  StudioDirectoryAuthorityV2,
  StudioFileIdentityV2,
  StudioProjectFileInspectionV2,
} from './projectTransactions';

const STUDIO_PROJECT_DELETION_MARKER_SCHEMA_VERSION = 1 as const;
const STUDIO_PROJECT_V2_MAX_ID_LENGTH = 256;
const SAFE_ID = /^[A-Za-z0-9_-]+$/;
const LOWERCASE_SHA256 = /^[a-f0-9]{64}$/;
const PROJECT_DELETION_MARKER_KEYS = new Set([
  'schemaVersion',
  'projectId',
  'expectedRevision',
  'directoryDev',
  'directoryIno',
  'projectSha256',
]);
const NONTERMINAL_JOB_STATUSES = new Set(['queued_local', 'submitting', 'queued_remote', 'running', 'needs_attention']);

type ExactFileIdentityV2 = StudioFileIdentityV2 & {
  size: number;
  mtimeMs: number;
  ctimeMs: number;
  nlink: number;
};

type ProjectDeletionNodeProofV2 =
  | { kind: 'directory'; identity: ExactFileIdentityV2; children: Map<string, ProjectDeletionNodeProofV2> }
  | { kind: 'file' | 'symbolic_link' | 'other'; identity: ExactFileIdentityV2 };

export type StudioProjectDeletionMarkerV2 = {
  schemaVersion: typeof STUDIO_PROJECT_DELETION_MARKER_SCHEMA_VERSION;
  projectId: string;
  expectedRevision: number;
  directoryDev: number;
  directoryIno: number;
  projectSha256: string;
};

export type StudioDeletionIdentifiedRecordV2<RecordType> = {
  file: string;
  bytes: string;
  identity: StudioFileIdentityV2;
  record: RecordType;
  quarantined: boolean;
};

type SupportedProjectFileInspectionV2 = Extract<StudioProjectFileInspectionV2, { status: 'supported' }>;

type DeletionAuthorityDepsV2 = {
  fs: typeof nodeFs;
  maxProjectBytes: number;
  resolveRootChild: (root: string, child: string) => string;
  captureDirectoryAuthority: (directory: string) => Promise<StudioDirectoryAuthorityV2>;
  assertDirectoryAuthority: (authority: StudioDirectoryAuthorityV2) => Promise<void>;
  syncDirectoryAuthority: (authority: StudioDirectoryAuthorityV2) => Promise<void>;
  assertPathAbsent: (file: string) => Promise<void>;
  assertProjectSnapshotCurrent: (input: { root: string; snapshot: SupportedProjectFileInspectionV2 }) => Promise<void>;
  assertIdentifiedRecordCurrent: (input: {
    root: string;
    authority: StudioDirectoryAuthorityV2;
    identified: StudioDeletionIdentifiedRecordV2<unknown>;
    maxBytes?: number;
  }) => Promise<void>;
  publishImmutableJournalRecord: (input: {
    root: string;
    authority: StudioDirectoryAuthorityV2;
    file: string;
    bytes: string;
    maxBytes?: number;
    authorizeBeforeLink?: (temporary: StudioDeletionIdentifiedRecordV2<null>) => Promise<void>;
    retainTemporary?: boolean;
  }) => Promise<void>;
  inspectProjectFile: (root: string, projectId: string) => Promise<StudioProjectFileInspectionV2>;
  requireSupportedProjectInspection: (inspected: StudioProjectFileInspectionV2) => SupportedProjectFileInspectionV2;
  summariesFile: (root: string) => Promise<string>;
  storageError: (error: unknown, fallback: string) => CreativeStudioStoreError;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const hasExactKeys = (value: Record<string, unknown>, keys: ReadonlySet<string>): boolean => {
  const ownKeys = Reflect.ownKeys(value);
  return (
    ownKeys.length === keys.size &&
    ownKeys.every((key) =>
      typeof key === 'string'
        ? keys.has(key) && Object.hasOwn(Reflect.getOwnPropertyDescriptor(value, key) ?? {}, 'value')
        : false
    )
  );
};

const isIntegerInRange = (value: unknown, minimum: number, maximum: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= minimum && value <= maximum;

const isSafeProjectId = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= STUDIO_PROJECT_V2_MAX_ID_LENGTH && SAFE_ID.test(value);

const validateProjectDeletionMarkerV2 = (value: unknown): value is StudioProjectDeletionMarkerV2 =>
  isRecord(value) &&
  hasExactKeys(value, PROJECT_DELETION_MARKER_KEYS) &&
  value.schemaVersion === STUDIO_PROJECT_DELETION_MARKER_SCHEMA_VERSION &&
  isSafeProjectId(value.projectId) &&
  isIntegerInRange(value.expectedRevision, 1, Number.MAX_SAFE_INTEGER) &&
  isIntegerInRange(value.directoryDev, 0, Number.MAX_SAFE_INTEGER) &&
  isIntegerInRange(value.directoryIno, 0, Number.MAX_SAFE_INTEGER) &&
  typeof value.projectSha256 === 'string' &&
  LOWERCASE_SHA256.test(value.projectSha256);

const sha256Utf8 = (bytes: string): string => createHash('sha256').update(bytes, 'utf8').digest('hex');

const serializeJsonExact = (value: unknown): string => JSON.stringify(value, null, 2);

const sameIdentityV2 = (left: StudioFileIdentityV2, right: StudioFileIdentityV2): boolean =>
  left.dev === right.dev && left.ino === right.ino;

export const createStudioDeletionAuthorityV2 = (deps: DeletionAuthorityDepsV2) => {
  const {
    fs,
    maxProjectBytes,
    resolveRootChild,
    captureDirectoryAuthority,
    assertDirectoryAuthority,
    syncDirectoryAuthority,
    assertPathAbsent,
    assertProjectSnapshotCurrent,
    assertIdentifiedRecordCurrent,
    publishImmutableJournalRecord,
    inspectProjectFile,
    requireSupportedProjectInspection,
    summariesFile,
    storageError,
  } = deps;

  // eslint-disable-next-line unicorn/consistent-function-scoping -- the injected filesystem defines the stat shape.
  const exactFileIdentityV2 = (stats: Awaited<ReturnType<typeof fs.lstat>>): ExactFileIdentityV2 => ({
    dev: Number(stats.dev),
    ino: Number(stats.ino),
    size: Number(stats.size),
    mtimeMs: Number(stats.mtimeMs),
    ctimeMs: Number(stats.ctimeMs),
    nlink: Number(stats.nlink),
  });

  const sameExactFileIdentityV2 = (left: ExactFileIdentityV2, right: ExactFileIdentityV2): boolean =>
    sameIdentityV2(left, right) &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs &&
    left.nlink === right.nlink;

  const readRetainedDeletionDirectoryNamesV2 = async (
    directoryPath: string,
    expected: ExactFileIdentityV2,
    compareExpected: (current: ExactFileIdentityV2, retained: ExactFileIdentityV2) => boolean
  ): Promise<string[]> => {
    const beforeStats = await fs.lstat(directoryPath);
    const before = exactFileIdentityV2(beforeStats);
    if (
      beforeStats.isSymbolicLink() ||
      !beforeStats.isDirectory() ||
      !compareExpected(before, expected) ||
      (await fs.realpath(directoryPath)) !== directoryPath
    ) {
      throw new CreativeStudioStoreError('storage_error', 'Studio project deletion cleanup directory changed');
    }
    const directory = await fs.opendir(directoryPath);
    try {
      const afterOpenStats = await fs.lstat(directoryPath);
      const afterOpen = exactFileIdentityV2(afterOpenStats);
      if (
        afterOpenStats.isSymbolicLink() ||
        !afterOpenStats.isDirectory() ||
        !sameExactFileIdentityV2(before, afterOpen) ||
        !compareExpected(afterOpen, expected)
      ) {
        throw new CreativeStudioStoreError('storage_error', 'Studio project deletion cleanup directory changed');
      }
      const names: string[] = [];
      for (;;) {
        // eslint-disable-next-line no-await-in-loop -- the retained directory handle is the traversal authority.
        const entry = await directory.read();
        if (entry === null) break;
        names.push(entry.name);
      }
      const afterReadStats = await fs.lstat(directoryPath);
      const afterRead = exactFileIdentityV2(afterReadStats);
      if (
        afterReadStats.isSymbolicLink() ||
        !afterReadStats.isDirectory() ||
        !sameExactFileIdentityV2(before, afterRead) ||
        !compareExpected(afterRead, expected)
      ) {
        throw new CreativeStudioStoreError('storage_error', 'Studio project deletion cleanup directory changed');
      }
      return names.toSorted();
    } finally {
      await directory.close().catch((): undefined => undefined);
    }
  };

  const captureProjectDeletionNodeProofV2 = async (nodePath: string): Promise<ProjectDeletionNodeProofV2> => {
    const initialStats = await fs.lstat(nodePath);
    const initial = exactFileIdentityV2(initialStats);
    if (initialStats.isSymbolicLink()) {
      const currentStats = await fs.lstat(nodePath);
      if (!currentStats.isSymbolicLink() || !sameExactFileIdentityV2(exactFileIdentityV2(currentStats), initial)) {
        throw new CreativeStudioStoreError('storage_error', 'Studio project deletion cleanup node changed');
      }
      return { kind: 'symbolic_link', identity: initial };
    }
    if (initialStats.isDirectory()) {
      const names = await readRetainedDeletionDirectoryNamesV2(nodePath, initial, sameExactFileIdentityV2);
      const children = new Map<string, ProjectDeletionNodeProofV2>();
      for (const name of names) {
        // eslint-disable-next-line no-await-in-loop -- every child is captured under the same retained parent proof.
        const parentBefore = exactFileIdentityV2(await fs.lstat(nodePath));
        if (!sameExactFileIdentityV2(parentBefore, initial)) {
          throw new CreativeStudioStoreError('storage_error', 'Studio project deletion cleanup directory changed');
        }
        const childPath = path.join(nodePath, name);
        if (path.dirname(childPath) !== nodePath) {
          throw new CreativeStudioStoreError('storage_error', 'Studio project deletion cleanup path is unsafe');
        }
        // eslint-disable-next-line no-await-in-loop -- every child is captured under the same retained parent proof.
        children.set(name, await captureProjectDeletionNodeProofV2(childPath));
        // eslint-disable-next-line no-await-in-loop -- every child is captured under the same retained parent proof.
        const parentAfter = exactFileIdentityV2(await fs.lstat(nodePath));
        if (!sameExactFileIdentityV2(parentAfter, initial)) {
          throw new CreativeStudioStoreError('storage_error', 'Studio project deletion cleanup directory changed');
        }
      }
      return { kind: 'directory', identity: initial, children };
    }
    if (initialStats.isFile()) {
      let handle: Awaited<ReturnType<typeof fs.open>> | null = null;
      try {
        const flags =
          process.platform === 'win32'
            ? fsConstants.O_RDONLY
            : fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK;
        handle = await fs.open(nodePath, flags);
        const openedStats = await handle.stat();
        const opened = exactFileIdentityV2(openedStats);
        const pathIdentity = exactFileIdentityV2(await fs.lstat(nodePath));
        if (
          !openedStats.isFile() ||
          openedStats.isSymbolicLink() ||
          !sameExactFileIdentityV2(opened, initial) ||
          !sameExactFileIdentityV2(opened, pathIdentity)
        ) {
          throw new CreativeStudioStoreError('storage_error', 'Studio project deletion cleanup file changed');
        }
      } finally {
        await handle?.close().catch((): undefined => undefined);
      }
      const currentStats = await fs.lstat(nodePath);
      if (!currentStats.isFile() || !sameExactFileIdentityV2(exactFileIdentityV2(currentStats), initial)) {
        throw new CreativeStudioStoreError('storage_error', 'Studio project deletion cleanup file changed');
      }
      return { kind: 'file', identity: initial };
    }
    const currentStats = await fs.lstat(nodePath);
    if (!sameExactFileIdentityV2(exactFileIdentityV2(currentStats), initial)) {
      throw new CreativeStudioStoreError('storage_error', 'Studio project deletion cleanup node changed');
    }
    return { kind: 'other', identity: initial };
  };

  const removeExactlyProvedProjectDeletionNodeV2 = async (
    nodePath: string,
    proof: ProjectDeletionNodeProofV2
  ): Promise<void> => {
    const initialStats = await fs.lstat(nodePath);
    if (!sameExactFileIdentityV2(exactFileIdentityV2(initialStats), proof.identity)) {
      throw new CreativeStudioStoreError('storage_error', 'Studio project deletion cleanup node changed');
    }
    if (proof.kind === 'directory') {
      if (!initialStats.isDirectory() || initialStats.isSymbolicLink()) {
        throw new CreativeStudioStoreError('storage_error', 'Studio project deletion cleanup directory changed');
      }
      const expectedNames = [...proof.children.keys()].toSorted();
      const actualNames = await readRetainedDeletionDirectoryNamesV2(nodePath, proof.identity, sameExactFileIdentityV2);
      if (JSON.stringify(actualNames) !== JSON.stringify(expectedNames)) {
        throw new CreativeStudioStoreError('storage_error', 'Studio project deletion cleanup directory changed');
      }
      for (const name of expectedNames) {
        const child = proof.children.get(name);
        if (child === undefined) {
          throw new CreativeStudioStoreError('storage_error', 'Studio project deletion cleanup proof changed');
        }
        // eslint-disable-next-line no-await-in-loop -- deletion is serialized under the exact retained tree proof.
        const parentBefore = exactFileIdentityV2(await fs.lstat(nodePath));
        if (!sameIdentityV2(parentBefore, proof.identity)) {
          throw new CreativeStudioStoreError('storage_error', 'Studio project deletion cleanup directory changed');
        }
        const childPath = path.join(nodePath, name);
        if (path.dirname(childPath) !== nodePath) {
          throw new CreativeStudioStoreError('storage_error', 'Studio project deletion cleanup path is unsafe');
        }
        // eslint-disable-next-line no-await-in-loop -- deletion is serialized under the exact retained tree proof.
        await removeExactlyProvedProjectDeletionNodeV2(childPath, child);
        // eslint-disable-next-line no-await-in-loop -- deletion is serialized under the exact retained tree proof.
        const parentAfter = exactFileIdentityV2(await fs.lstat(nodePath));
        if (!sameIdentityV2(parentAfter, proof.identity)) {
          throw new CreativeStudioStoreError('storage_error', 'Studio project deletion cleanup directory changed');
        }
      }
      const remaining = await readRetainedDeletionDirectoryNamesV2(nodePath, proof.identity, sameIdentityV2);
      if (remaining.length !== 0) {
        throw new CreativeStudioStoreError('storage_error', 'Studio project deletion cleanup directory changed');
      }
      await fs.rmdir(nodePath);
      return;
    }
    if (proof.kind === 'file') {
      if (!initialStats.isFile() || initialStats.isSymbolicLink()) {
        throw new CreativeStudioStoreError('storage_error', 'Studio project deletion cleanup file changed');
      }
      let handle: Awaited<ReturnType<typeof fs.open>> | null = null;
      try {
        const flags =
          process.platform === 'win32'
            ? fsConstants.O_RDONLY
            : fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK;
        handle = await fs.open(nodePath, flags);
        const openedStats = await handle.stat();
        const opened = exactFileIdentityV2(openedStats);
        const pathIdentity = exactFileIdentityV2(await fs.lstat(nodePath));
        if (
          !openedStats.isFile() ||
          openedStats.isSymbolicLink() ||
          !sameExactFileIdentityV2(opened, proof.identity) ||
          !sameExactFileIdentityV2(opened, pathIdentity)
        ) {
          throw new CreativeStudioStoreError('storage_error', 'Studio project deletion cleanup file changed');
        }
      } finally {
        await handle?.close().catch((): undefined => undefined);
      }
    } else if (proof.kind === 'symbolic_link') {
      if (!initialStats.isSymbolicLink()) {
        throw new CreativeStudioStoreError('storage_error', 'Studio project deletion cleanup link changed');
      }
    } else if (initialStats.isDirectory() || initialStats.isSymbolicLink() || initialStats.isFile()) {
      throw new CreativeStudioStoreError('storage_error', 'Studio project deletion cleanup node changed');
    }
    const finalStats = await fs.lstat(nodePath);
    if (!sameExactFileIdentityV2(exactFileIdentityV2(finalStats), proof.identity)) {
      throw new CreativeStudioStoreError('storage_error', 'Studio project deletion cleanup node changed');
    }
    await fs.unlink(nodePath);
  };

  const projectDeletionPathsV2 = (
    root: string,
    projectId: string
  ): { markerFile: string; quarantineDirectory: string; projectDirectory: string } => ({
    markerFile: resolveRootChild(root, `.delete-${projectId}.json`),
    quarantineDirectory: resolveRootChild(root, `.delete-${projectId}`),
    projectDirectory: resolveRootChild(root, projectId),
  });

  const projectDeletionCleanupDirectoryV2 = (root: string, marker: StudioProjectDeletionMarkerV2): string =>
    resolveRootChild(root, `.delete-cleanup-${sha256Utf8(serializeJsonExact(marker))}`);

  const readProjectDeletionMarkerV2 = async (
    root: string,
    projectId: string
  ): Promise<StudioDeletionIdentifiedRecordV2<StudioProjectDeletionMarkerV2> | null> => {
    const { markerFile } = projectDeletionPathsV2(root, projectId);
    let identified: Awaited<ReturnType<typeof readBoundedRegularFileWithIdentity>>;
    let publication: Awaited<ReturnType<typeof readBoundedRegularFileWithIdentity>>;
    try {
      [identified, publication] = await Promise.all([
        readBoundedRegularFileWithIdentity({
          fs,
          canonicalRoot: root,
          file: markerFile,
          maxBytes: 2 * 1024,
        }),
        readBoundedRegularFileWithIdentity({
          fs,
          canonicalRoot: root,
          file: `${markerFile}.publish`,
          maxBytes: 2 * 1024,
        }),
      ]);
    } catch (error) {
      throw storageError(error, 'Studio project deletion marker could not be inspected');
    }
    if (
      identified !== null &&
      publication !== null &&
      (identified.bytes !== publication.bytes || !sameIdentityV2(identified.identity, publication.identity))
    ) {
      throw new CreativeStudioStoreError('storage_error', 'Studio project deletion marker publication is ambiguous');
    }
    // A temporary-only marker is not a committed deletion intent. Ordinary project reads must
    // never turn a crash before the exclusive final link (or an injected lookalike) into deletion
    // authority. An explicit delete retry may promote an exact temporary below.
    if (identified === null) return null;
    let decoded: unknown;
    try {
      decoded = JSON.parse(identified.bytes) as unknown;
    } catch {
      throw new CreativeStudioStoreError('storage_error', 'Studio project deletion marker is malformed');
    }
    if (!validateProjectDeletionMarkerV2(decoded) || decoded.projectId !== projectId) {
      throw new CreativeStudioStoreError('storage_error', 'Studio project deletion marker is malformed');
    }
    return {
      file: markerFile,
      bytes: identified.bytes,
      identity: identified.identity,
      record: decoded,
      // Reuse the internal flag to remember that only the final marker survived. This is safe
      // recovery authority only after both the live and quarantine directories are already gone.
      quarantined: publication === null,
    };
  };

  const createProjectDeletionMarkerV2 = async (
    root: string,
    marker: StudioProjectDeletionMarkerV2,
    snapshot: SupportedProjectFileInspectionV2,
    authorizeBeforePublish?: () => void | Promise<void>
  ): Promise<StudioDeletionIdentifiedRecordV2<StudioProjectDeletionMarkerV2>> => {
    const rootAuthority = await captureDirectoryAuthority(root);
    const { markerFile } = projectDeletionPathsV2(root, marker.projectId);
    const bytes = serializeJsonExact(marker);
    try {
      await assertDirectoryAuthority(rootAuthority);
      await assertPathAbsent(markerFile);
      const temporaryFile = `${markerFile}.publish`;
      let existingTemporary = await readBoundedRegularFileWithIdentity({
        fs,
        canonicalRoot: root,
        file: temporaryFile,
        maxBytes: 2 * 1024,
      });
      if (existingTemporary !== null && existingTemporary.bytes !== bytes) {
        let staleMarker: unknown;
        try {
          staleMarker = JSON.parse(existingTemporary.bytes) as unknown;
        } catch {
          throw new CreativeStudioStoreError('storage_error', 'Studio project deletion marker retry is ambiguous');
        }
        if (
          !validateProjectDeletionMarkerV2(staleMarker) ||
          staleMarker.projectId !== marker.projectId ||
          staleMarker.expectedRevision >= marker.expectedRevision ||
          marker.expectedRevision !== snapshot.project.revision
        ) {
          throw new CreativeStudioStoreError('storage_error', 'Studio project deletion marker retry is ambiguous');
        }
        await assertDirectoryAuthority(rootAuthority);
        await assertIdentifiedRecordCurrent({
          root,
          authority: rootAuthority,
          identified: {
            file: temporaryFile,
            bytes: existingTemporary.bytes,
            identity: existingTemporary.identity,
            record: null,
            quarantined: false,
          },
          maxBytes: 2 * 1024,
        });
        await assertPathAbsent(markerFile);
        await assertProjectSnapshotCurrent({ root, snapshot });
        await fs.rm(temporaryFile);
        await syncDirectoryAuthority(rootAuthority);
        existingTemporary = null;
      }
      if (existingTemporary !== null) {
        await assertProjectSnapshotCurrent({ root, snapshot });
        await assertDirectoryAuthority(rootAuthority);
        await assertIdentifiedRecordCurrent({
          root,
          authority: rootAuthority,
          identified: {
            file: temporaryFile,
            bytes,
            identity: existingTemporary.identity,
            record: null,
            quarantined: false,
          },
          maxBytes: 2 * 1024,
        });
        await assertPathAbsent(markerFile);
        await assertProjectSnapshotCurrent({ root, snapshot });
        await authorizeBeforePublish?.();
        await fs.link(temporaryFile, markerFile);
        await syncDirectoryAuthority(rootAuthority);
      } else {
        await publishImmutableJournalRecord({
          root,
          authority: rootAuthority,
          file: markerFile,
          bytes,
          maxBytes: 2 * 1024,
          retainTemporary: true,
          authorizeBeforeLink: async (temporary) => {
            await assertDirectoryAuthority(rootAuthority);
            await assertIdentifiedRecordCurrent({
              root,
              authority: rootAuthority,
              identified: temporary,
              maxBytes: 2 * 1024,
            });
            await assertPathAbsent(markerFile);
            await assertProjectSnapshotCurrent({ root, snapshot });
            await authorizeBeforePublish?.();
          },
        });
      }
      const identified = await readProjectDeletionMarkerV2(root, marker.projectId);
      if (identified === null || identified.file !== markerFile || identified.bytes !== bytes) {
        throw new CreativeStudioStoreError('storage_error', 'Studio project deletion marker changed at publication');
      }
      return identified;
    } catch (error) {
      if (error instanceof CreativeStudioStoreError) throw error;
      throw storageError(error, 'Studio project deletion marker could not be published');
    }
  };

  const finishProjectDeletionV2 = async (
    root: string,
    marker: StudioDeletionIdentifiedRecordV2<StudioProjectDeletionMarkerV2>
  ): Promise<void> => {
    const rootAuthority = await captureDirectoryAuthority(root);
    const {
      markerFile,
      projectDirectory: targetDirectory,
      quarantineDirectory,
    } = projectDeletionPathsV2(root, marker.record.projectId);
    const cleanupDirectory = projectDeletionCleanupDirectoryV2(root, marker.record);
    const assertMarkerCurrent = (): Promise<void> =>
      assertIdentifiedRecordCurrent({ root, authority: rootAuthority, identified: marker, maxBytes: 2 * 1024 });
    let quarantineStats: Awaited<ReturnType<typeof fs.lstat>> | null = null;
    let cleanupStats: Awaited<ReturnType<typeof fs.lstat>> | null = null;
    try {
      quarantineStats = await fs.lstat(quarantineDirectory);
      if (quarantineStats.isSymbolicLink() || !quarantineStats.isDirectory()) {
        throw new CreativeStudioStoreError('storage_error', 'Studio project deletion quarantine is unsafe');
      }
    } catch (error) {
      if (error instanceof CreativeStudioStoreError) throw error;
      if (!isRecord(error) || error.code !== 'ENOENT') {
        throw storageError(error, 'Studio project deletion quarantine could not be inspected');
      }
    }
    try {
      cleanupStats = await fs.lstat(cleanupDirectory);
      if (cleanupStats.isSymbolicLink() || !cleanupStats.isDirectory()) {
        throw new CreativeStudioStoreError('storage_error', 'Studio project deletion cleanup claim is unsafe');
      }
    } catch (error) {
      if (error instanceof CreativeStudioStoreError) throw error;
      if (!isRecord(error) || error.code !== 'ENOENT') {
        throw storageError(error, 'Studio project deletion cleanup claim could not be inspected');
      }
    }
    if (quarantineStats !== null && cleanupStats !== null) {
      throw new CreativeStudioStoreError('storage_error', 'Studio project deletion cleanup authority is ambiguous');
    }
    if (marker.quarantined && (quarantineStats !== null || cleanupStats !== null)) {
      throw new CreativeStudioStoreError('storage_error', 'Studio project deletion marker companion is missing');
    }
    if (quarantineStats === null && cleanupStats === null) {
      let targetStats: Awaited<ReturnType<typeof fs.lstat>> | null = null;
      try {
        targetStats = await fs.lstat(targetDirectory);
      } catch (error) {
        if (!isRecord(error) || error.code !== 'ENOENT') {
          throw storageError(error, 'Studio project deletion target could not be inspected');
        }
      }
      if (marker.quarantined && targetStats !== null) {
        throw new CreativeStudioStoreError('storage_error', 'Studio project deletion marker companion is missing');
      }
      const inspected = await inspectProjectFile(root, marker.record.projectId);
      if (inspected.status === 'not_found') {
        if (targetStats !== null) {
          throw new CreativeStudioStoreError('storage_error', 'Studio project deletion target changed');
        }
        // The whole directory removal committed before a crash; only the durable marker remains.
      } else {
        const snapshot = requireSupportedProjectInspection(inspected);
        if (
          snapshot.project.revision !== marker.record.expectedRevision ||
          snapshot.directory.dev !== marker.record.directoryDev ||
          snapshot.directory.ino !== marker.record.directoryIno ||
          sha256Utf8(snapshot.bytes) !== marker.record.projectSha256
        ) {
          throw new CreativeStudioStoreError('storage_error', 'Studio project changed during deletion');
        }
        await assertMarkerCurrent();
        // The project digest is the final awaited authority before moving the directory out of
        // the live namespace. A concurrent write in the same directory inode is therefore never
        // swept into recursive deletion under an older marker.
        await assertProjectSnapshotCurrent({ root, snapshot });
        try {
          await fs.rename(targetDirectory, quarantineDirectory);
        } catch (error) {
          throw storageError(error, 'Studio project could not enter deletion quarantine');
        }
        await syncDirectoryAuthority(rootAuthority);
        quarantineStats = await fs.lstat(quarantineDirectory);
      }
    }
    const restoreCleanupClaim = async (claimed: Awaited<ReturnType<typeof fs.lstat>>): Promise<void> => {
      try {
        await assertDirectoryAuthority(rootAuthority);
        await assertPathAbsent(quarantineDirectory);
        const currentClaim = await fs.lstat(cleanupDirectory);
        if (
          !currentClaim.isSymbolicLink() &&
          currentClaim.isDirectory() &&
          currentClaim.dev === claimed.dev &&
          currentClaim.ino === claimed.ino
        ) {
          await fs.rename(cleanupDirectory, quarantineDirectory);
          await syncDirectoryAuthority(rootAuthority);
        }
      } catch {
        // Both names remain preserved when a replacement makes restoration ambiguous.
      }
    };
    if (quarantineStats !== null) {
      if (
        quarantineStats.isSymbolicLink() ||
        !quarantineStats.isDirectory() ||
        quarantineStats.dev !== marker.record.directoryDev ||
        quarantineStats.ino !== marker.record.directoryIno
      ) {
        try {
          await assertPathAbsent(targetDirectory);
          const currentForeign = await fs.lstat(quarantineDirectory);
          if (
            !currentForeign.isSymbolicLink() &&
            currentForeign.isDirectory() &&
            currentForeign.dev === quarantineStats.dev &&
            currentForeign.ino === quarantineStats.ino
          ) {
            await fs.rename(quarantineDirectory, targetDirectory);
            await syncDirectoryAuthority(rootAuthority);
          }
        } catch {
          // Preserve both names on any ambiguity; a foreign replacement is never deletion authority.
        }
        throw new CreativeStudioStoreError('storage_error', 'Studio project deletion quarantine changed');
      }
      await assertMarkerCurrent();
      await Promise.all([assertPathAbsent(targetDirectory), assertPathAbsent(cleanupDirectory)]);
      const currentQuarantine = await fs.lstat(quarantineDirectory);
      if (
        currentQuarantine.isSymbolicLink() ||
        !currentQuarantine.isDirectory() ||
        currentQuarantine.dev !== marker.record.directoryDev ||
        currentQuarantine.ino !== marker.record.directoryIno
      ) {
        throw new CreativeStudioStoreError('storage_error', 'Studio project deletion quarantine changed');
      }
      const quarantinedManifest = await readBoundedRegularFileWithIdentity({
        fs,
        canonicalRoot: root,
        file: path.join(quarantineDirectory, 'project.json'),
        maxBytes: maxProjectBytes,
      });
      if (quarantinedManifest === null || sha256Utf8(quarantinedManifest.bytes) !== marker.record.projectSha256) {
        throw new CreativeStudioStoreError('storage_error', 'Studio project deletion quarantine manifest changed');
      }
      let quarantinedProject: unknown;
      try {
        quarantinedProject = JSON.parse(quarantinedManifest.bytes) as unknown;
      } catch {
        throw new CreativeStudioStoreError('storage_error', 'Studio project deletion quarantine manifest is malformed');
      }
      const quarantinedBrief = await readBoundedRegularFileWithIdentity({
        fs,
        canonicalRoot: root,
        file: path.join(quarantineDirectory, STUDIO_BRIEF_FILE_NAME),
        maxBytes: STUDIO_BRIEF_FILE_MAX_BYTES,
      });
      const decodedQuarantined = decodeStudioProjectManifestV2(quarantinedProject, quarantinedBrief?.bytes ?? null);
      if (
        decodedQuarantined === null ||
        decodedQuarantined.project.id !== marker.record.projectId ||
        decodedQuarantined.project.revision !== marker.record.expectedRevision
      ) {
        throw new CreativeStudioStoreError('storage_error', 'Studio project deletion quarantine manifest changed');
      }
      await assertMarkerCurrent();
      await Promise.all([assertPathAbsent(targetDirectory), assertPathAbsent(cleanupDirectory)]);
      const finalQuarantine = await fs.lstat(quarantineDirectory);
      if (
        finalQuarantine.isSymbolicLink() ||
        !finalQuarantine.isDirectory() ||
        finalQuarantine.dev !== marker.record.directoryDev ||
        finalQuarantine.ino !== marker.record.directoryIno
      ) {
        throw new CreativeStudioStoreError('storage_error', 'Studio project deletion quarantine changed');
      }
      await assertIdentifiedRecordCurrent({
        root,
        authority: {
          path: quarantineDirectory,
          dev: finalQuarantine.dev,
          ino: finalQuarantine.ino,
        },
        identified: {
          file: path.join(quarantineDirectory, 'project.json'),
          bytes: quarantinedManifest.bytes,
          identity: quarantinedManifest.identity,
          record: null,
          quarantined: false,
        },
        maxBytes: maxProjectBytes,
      });
      await assertMarkerCurrent();
      await Promise.all([assertPathAbsent(targetDirectory), assertPathAbsent(cleanupDirectory)]);
      try {
        await fs.rename(quarantineDirectory, cleanupDirectory);
      } catch (error) {
        throw storageError(error, 'Studio project deletion cleanup could not be claimed');
      }
      await syncDirectoryAuthority(rootAuthority);
      const claimed = await fs.lstat(cleanupDirectory);
      if (
        claimed.isSymbolicLink() ||
        !claimed.isDirectory() ||
        claimed.dev !== marker.record.directoryDev ||
        claimed.ino !== marker.record.directoryIno
      ) {
        await restoreCleanupClaim(claimed);
        throw new CreativeStudioStoreError('storage_error', 'Studio project deletion cleanup claim changed');
      }
      try {
        await assertPathAbsent(quarantineDirectory);
        await assertIdentifiedRecordCurrent({
          root,
          authority: { path: cleanupDirectory, dev: claimed.dev, ino: claimed.ino },
          identified: {
            file: path.join(cleanupDirectory, 'project.json'),
            bytes: quarantinedManifest.bytes,
            identity: quarantinedManifest.identity,
            record: null,
            quarantined: true,
          },
          maxBytes: maxProjectBytes,
        });
      } catch (error) {
        await restoreCleanupClaim(claimed);
        if (error instanceof CreativeStudioStoreError) throw error;
        throw storageError(error, 'Studio project deletion cleanup claim changed');
      }
      cleanupStats = claimed;
      quarantineStats = null;
    }
    if (cleanupStats !== null) {
      if (
        cleanupStats.isSymbolicLink() ||
        !cleanupStats.isDirectory() ||
        cleanupStats.dev !== marker.record.directoryDev ||
        cleanupStats.ino !== marker.record.directoryIno
      ) {
        throw new CreativeStudioStoreError('storage_error', 'Studio project deletion cleanup claim changed');
      }
      await assertMarkerCurrent();
      await Promise.all([assertPathAbsent(targetDirectory), assertPathAbsent(quarantineDirectory)]);
      const claimedAuthority = await captureDirectoryAuthority(cleanupDirectory);
      if (claimedAuthority.dev !== marker.record.directoryDev || claimedAuthority.ino !== marker.record.directoryIno) {
        throw new CreativeStudioStoreError('storage_error', 'Studio project deletion cleanup claim changed');
      }
      const cleanupProof = await captureProjectDeletionNodeProofV2(cleanupDirectory);
      if (
        cleanupProof.kind !== 'directory' ||
        cleanupProof.identity.dev !== marker.record.directoryDev ||
        cleanupProof.identity.ino !== marker.record.directoryIno
      ) {
        throw new CreativeStudioStoreError('storage_error', 'Studio project deletion cleanup claim changed');
      }
      await assertMarkerCurrent();
      await Promise.all([assertPathAbsent(targetDirectory), assertPathAbsent(quarantineDirectory)]);
      try {
        await removeExactlyProvedProjectDeletionNodeV2(cleanupDirectory, cleanupProof);
      } catch (error) {
        throw storageError(error, 'Studio project deletion cleanup failed');
      }
      await syncDirectoryAuthority(rootAuthority);
    }
    await Promise.all([
      assertPathAbsent(targetDirectory),
      assertPathAbsent(quarantineDirectory),
      assertPathAbsent(cleanupDirectory),
    ]);
    await assertMarkerCurrent();
    if (marker.file === markerFile) {
      const publicationFile = `${markerFile}.publish`;
      let publication: Awaited<ReturnType<typeof readBoundedRegularFileWithIdentity>>;
      try {
        publication = await readBoundedRegularFileWithIdentity({
          fs,
          canonicalRoot: root,
          file: publicationFile,
          maxBytes: 2 * 1024,
        });
      } catch (error) {
        throw storageError(error, 'Studio project deletion marker publication could not be inspected');
      }
      if (publication !== null) {
        if (publication.bytes !== marker.bytes || !sameIdentityV2(publication.identity, marker.identity)) {
          throw new CreativeStudioStoreError('storage_error', 'Studio project deletion marker publication changed');
        }
        await assertMarkerCurrent();
        await assertIdentifiedRecordCurrent({
          root,
          authority: rootAuthority,
          identified: { ...marker, file: publicationFile },
          maxBytes: 2 * 1024,
        });
        try {
          await fs.rm(publicationFile);
        } catch (error) {
          throw storageError(error, 'Studio project deletion marker publication cleanup failed');
        }
        await syncDirectoryAuthority(rootAuthority);
      }
    }
    await assertMarkerCurrent();
    try {
      await fs.rm(marker.file);
    } catch (error) {
      throw storageError(error, 'Studio project deletion marker cleanup failed');
    }
    await syncDirectoryAuthority(rootAuthority);
  };

  const deleteSupportedProjectV2InsideQueue = async (
    root: string,
    inspected: SupportedProjectFileInspectionV2,
    expectedRevision: number,
    authorizeBeforeDelete?: () => void | Promise<void>
  ): Promise<boolean> => {
    const current = inspected.project;
    if (Object.values(current.jobs).some((job) => NONTERMINAL_JOB_STATUSES.has(job.status))) {
      throw new CreativeStudioStoreError('busy', 'Studio project has active generation jobs');
    }
    if (current.revision !== expectedRevision) {
      throw new CreativeStudioStoreError('stale_project', 'Studio project has changed');
    }
    await summariesFile(root);
    const paths = projectDeletionPathsV2(root, current.id);
    try {
      await fs.lstat(paths.quarantineDirectory);
      throw new CreativeStudioStoreError('storage_error', 'Studio project deletion quarantine already exists');
    } catch (error) {
      if (error instanceof CreativeStudioStoreError) throw error;
      if (!isRecord(error) || error.code !== 'ENOENT') {
        throw storageError(error, 'Studio project deletion quarantine could not be inspected');
      }
    }
    const marker = await createProjectDeletionMarkerV2(
      root,
      {
        schemaVersion: STUDIO_PROJECT_DELETION_MARKER_SCHEMA_VERSION,
        projectId: current.id,
        expectedRevision,
        directoryDev: inspected.directory.dev,
        directoryIno: inspected.directory.ino,
        projectSha256: sha256Utf8(inspected.bytes),
      },
      inspected,
      authorizeBeforeDelete
    );
    await finishProjectDeletionV2(root, marker);
    return true;
  };

  return {
    deleteSupportedProjectV2InsideQueue,
    finishProjectDeletionV2,
    projectDeletionPathsV2,
    readProjectDeletionMarkerV2,
  };
};
