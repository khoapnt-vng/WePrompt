/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { constants as fsConstants } from 'node:fs';
import type { promises as nodeFs } from 'node:fs';
import path from 'node:path';

export type RecordIoErrorCode =
  | 'unsafe_path'
  | 'unsafe_file'
  | 'record_too_large'
  | 'already_exists'
  | 'partial_directory_set'
  | 'storage_error';

/** A deliberately detail-free filesystem error safe for domain-level translation. */
export class RecordIoError extends Error {
  readonly code: RecordIoErrorCode;

  constructor(code: RecordIoErrorCode) {
    super('Record IO failed');
    this.name = 'RecordIoError';
    this.code = code;
  }
}

export type RecordIoFileSystem = typeof nodeFs;

type ErrorRecord = { code?: unknown };

let temporaryFileCounter = 0;

const isErrorRecord = (value: unknown): value is ErrorRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const hasErrorCode = (error: unknown, code: string): boolean => isErrorRecord(error) && error.code === code;

const isInside = (canonicalRoot: string, target: string): boolean =>
  target === canonicalRoot || target.startsWith(`${canonicalRoot}${path.sep}`);

const preserveOrNeutralize = (error: unknown): RecordIoError =>
  error instanceof RecordIoError ? error : new RecordIoError('storage_error');

/** Creates if necessary, then verifies that the configured root itself is not a link or non-directory. */
export async function canonicalizeRecordRoot(input: { fs: RecordIoFileSystem; rootDir: string }): Promise<string> {
  const resolved = path.resolve(input.rootDir);
  try {
    await input.fs.mkdir(resolved, { recursive: true });
    const stats = await input.fs.lstat(resolved);
    if (!stats.isDirectory() || stats.isSymbolicLink()) throw new RecordIoError('unsafe_path');
    return await input.fs.realpath(resolved);
  } catch (error) {
    throw preserveOrNeutralize(error);
  }
}

/** Resolves a lexical child and refuses traversal outside the already-canonical root. */
export function resolveConfinedRecordPath(canonicalRoot: string, parent: string, ...parts: string[]): string {
  const resolvedParent = path.resolve(parent);
  const target = path.resolve(resolvedParent, ...parts);
  if (!isInside(canonicalRoot, resolvedParent) || !isInside(canonicalRoot, target)) {
    throw new RecordIoError('unsafe_path');
  }
  return target;
}

/** Resolves one lstat-confirmed canonical directory without following links. */
export async function resolveSafeRecordDirectory(input: {
  fs: RecordIoFileSystem;
  canonicalRoot: string;
  parent: string;
  name: string;
  createIfMissing: boolean;
}): Promise<string | null> {
  const directory = resolveConfinedRecordPath(input.canonicalRoot, input.parent, input.name);
  try {
    let stats: Awaited<ReturnType<RecordIoFileSystem['lstat']>>;
    try {
      stats = await input.fs.lstat(directory);
    } catch (error) {
      if (!hasErrorCode(error, 'ENOENT')) throw error;
      if (!input.createIfMissing) return null;
      await input.fs.mkdir(directory);
      stats = await input.fs.lstat(directory);
    }
    if (!stats.isDirectory() || stats.isSymbolicLink()) throw new RecordIoError('unsafe_path');
    const canonicalDirectory = await input.fs.realpath(directory);
    if (canonicalDirectory !== directory || !isInside(input.canonicalRoot, canonicalDirectory)) {
      throw new RecordIoError('unsafe_path');
    }
    return canonicalDirectory;
  } catch (error) {
    throw preserveOrNeutralize(error);
  }
}

/**
 * Resolves an all-or-nothing directory family. Only an absent family root may be lazily created;
 * an existing partial family is durable evidence of interrupted or unsafe storage.
 */
export async function resolveCompleteDirectorySet<const ChildName extends string>(input: {
  fs: RecordIoFileSystem;
  canonicalRoot: string;
  parent: string;
  rootName: string;
  childNames: readonly ChildName[];
  createIfWhollyAbsent: boolean;
  authorizeBeforePublish?: () => Promise<void>;
}): Promise<({ root: string } & Record<ChildName, string>) | null> {
  const root = resolveConfinedRecordPath(input.canonicalRoot, input.parent, input.rootName);
  const parentStats = await input.fs.lstat(input.parent);
  if (
    !parentStats.isDirectory() ||
    parentStats.isSymbolicLink() ||
    (await input.fs.realpath(input.parent)) !== input.parent
  ) {
    throw new RecordIoError('unsafe_path');
  }
  let rootExists = true;
  try {
    const stats = await input.fs.lstat(root);
    if (!stats.isDirectory() || stats.isSymbolicLink()) throw new RecordIoError('unsafe_path');
    if ((await input.fs.realpath(root)) !== root) throw new RecordIoError('unsafe_path');
  } catch (error) {
    if (error instanceof RecordIoError) throw error;
    if (!hasErrorCode(error, 'ENOENT')) throw new RecordIoError('storage_error');
    rootExists = false;
  }

  if (!rootExists) {
    if (!input.createIfWhollyAbsent) return null;
    const stagePrefix = `.${input.rootName}.`;
    let stage: string | undefined;
    let ownedStageIdentity: { dev: number; ino: number } | undefined;
    const ownedChildIdentities = new Map<string, { dev: number; ino: number }>();
    const verifiedChildIdentities = new Map<string, { dev: number; ino: number }>();
    let authorizationFailed = false;
    const authorize = async (): Promise<void> => {
      try {
        await input.authorizeBeforePublish?.();
      } catch (error) {
        authorizationFailed = true;
        throw error;
      }
    };
    try {
      const parentEntries = await input.fs.readdir(input.parent, { withFileTypes: true });
      const stagedEntries = parentEntries.filter(
        (entry) => entry.name.startsWith(stagePrefix) && entry.name.endsWith('.tmp')
      );
      if (stagedEntries.length > 1) throw new RecordIoError('partial_directory_set');
      if (stagedEntries.length === 1) {
        const stagedEntry = stagedEntries[0];
        if (stagedEntry === undefined || !stagedEntry.isDirectory() || stagedEntry.isSymbolicLink()) {
          throw new RecordIoError('partial_directory_set');
        }
        stage = resolveConfinedRecordPath(input.canonicalRoot, input.parent, stagedEntry.name);
      } else {
        await authorize();
        stage = resolveConfinedRecordPath(
          input.canonicalRoot,
          input.parent,
          `${stagePrefix}${process.pid}_${++temporaryFileCounter}.tmp`
        );
        await input.fs.mkdir(stage);
        const createdStageStats = await input.fs.lstat(stage);
        ownedStageIdentity = { dev: createdStageStats.dev, ino: createdStageStats.ino };
      }
      const stageStats = await input.fs.lstat(stage);
      if (!stageStats.isDirectory() || stageStats.isSymbolicLink() || (await input.fs.realpath(stage)) !== stage) {
        throw new RecordIoError('unsafe_path');
      }
      const stagedChildren = await input.fs.readdir(stage, { withFileTypes: true });
      if (
        stagedChildren.length > input.childNames.length ||
        stagedChildren.some(
          (entry) =>
            !entry.isDirectory() || entry.isSymbolicLink() || !input.childNames.includes(entry.name as ChildName)
        )
      ) {
        throw new RecordIoError('partial_directory_set');
      }
      for (const childName of input.childNames) {
        const childPath = resolveConfinedRecordPath(input.canonicalRoot, stage, childName);
        if (!stagedChildren.some((entry) => entry.name === childName)) {
          // A sole safe partial stage is recoverable because it has never been published. Repairing
          // it cannot alter the final family and every existing entry was classified above.
          // eslint-disable-next-line no-await-in-loop
          await authorize();
          // eslint-disable-next-line no-await-in-loop
          await input.fs.mkdir(childPath);
          if (ownedStageIdentity !== undefined) {
            // Capture ownership immediately after creation. Rollback never derives authority from
            // whatever happens to occupy this pathname later.
            // eslint-disable-next-line no-await-in-loop
            const createdChild = await input.fs.lstat(childPath);
            if (!createdChild.isDirectory() || createdChild.isSymbolicLink()) throw new RecordIoError('unsafe_path');
            ownedChildIdentities.set(childName, { dev: createdChild.dev, ino: createdChild.ino });
          }
        }
        // Every staged child is independently no-follow/canonical verified and empty before publication.
        // eslint-disable-next-line no-await-in-loop
        const child = await resolveSafeRecordDirectory({
          fs: input.fs,
          canonicalRoot: input.canonicalRoot,
          parent: stage,
          name: childName,
          createIfMissing: false,
        });
        if (child === null) throw new RecordIoError('partial_directory_set');
        // eslint-disable-next-line no-await-in-loop
        const verifiedChild = await input.fs.lstat(child);
        if (!verifiedChild.isDirectory() || verifiedChild.isSymbolicLink()) throw new RecordIoError('unsafe_path');
        verifiedChildIdentities.set(childName, { dev: verifiedChild.dev, ino: verifiedChild.ino });
        // eslint-disable-next-line no-await-in-loop
        if ((await input.fs.readdir(child)).length !== 0) throw new RecordIoError('partial_directory_set');
        // eslint-disable-next-line no-await-in-loop
        const childHandle = await input.fs.open(child, 'r');
        try {
          // eslint-disable-next-line no-await-in-loop
          await childHandle.sync();
        } finally {
          // eslint-disable-next-line no-await-in-loop
          await childHandle.close();
        }
      }
      const stageHandle = await input.fs.open(stage, 'r');
      try {
        await stageHandle.sync();
      } finally {
        await stageHandle.close();
      }
      await authorize();
      const currentParentStats = await input.fs.lstat(input.parent);
      if (
        !currentParentStats.isDirectory() ||
        currentParentStats.isSymbolicLink() ||
        currentParentStats.dev !== parentStats.dev ||
        currentParentStats.ino !== parentStats.ino ||
        (await input.fs.realpath(input.parent)) !== input.parent
      ) {
        throw new RecordIoError('unsafe_path');
      }
      const finalStageChildren = await input.fs.readdir(stage, { withFileTypes: true });
      if (
        finalStageChildren.length !== input.childNames.length ||
        finalStageChildren.some(
          (entry) =>
            !entry.isDirectory() || entry.isSymbolicLink() || !input.childNames.includes(entry.name as ChildName)
        )
      ) {
        throw new RecordIoError('partial_directory_set');
      }
      const finalParentEntries = await input.fs.readdir(input.parent, { withFileTypes: true });
      const finalStagedEntries = finalParentEntries.filter(
        (entry) => entry.name.startsWith(stagePrefix) && entry.name.endsWith('.tmp')
      );
      if (finalStagedEntries.length !== 1 || finalStagedEntries[0]?.name !== path.basename(stage)) {
        throw new RecordIoError('partial_directory_set');
      }
      try {
        await input.fs.lstat(root);
        throw new RecordIoError('partial_directory_set');
      } catch (error) {
        if (error instanceof RecordIoError) throw error;
        if (!hasErrorCode(error, 'ENOENT')) throw new RecordIoError('storage_error');
      }
      // All filesystem proofs above await I/O after the earlier authorization. Re-run the
      // caller's project/schema fence as the final awaited operation before publication.
      await authorize();
      for (const childName of input.childNames) {
        const childPath = resolveConfinedRecordPath(input.canonicalRoot, stage, childName);
        // Emptiness and canonicality are observed first; the captured inode is the final awaited
        // proof for each child before the stage can enter the authoritative namespace.
        // eslint-disable-next-line no-await-in-loop
        const childEntries = await input.fs.readdir(childPath);
        // eslint-disable-next-line no-await-in-loop
        const childRealpath = await input.fs.realpath(childPath);
        // eslint-disable-next-line no-await-in-loop
        const childStats = await input.fs.lstat(childPath);
        const verifiedIdentity = verifiedChildIdentities.get(childName);
        if (
          verifiedIdentity === undefined ||
          childEntries.length !== 0 ||
          childRealpath !== childPath ||
          !childStats.isDirectory() ||
          childStats.isSymbolicLink() ||
          childStats.dev !== verifiedIdentity.dev ||
          childStats.ino !== verifiedIdentity.ino
        ) {
          throw new RecordIoError('partial_directory_set');
        }
      }
      const publishStageEntries = await input.fs.readdir(stage, { withFileTypes: true });
      if (
        publishStageEntries.length !== input.childNames.length ||
        publishStageEntries.some(
          (entry) =>
            !entry.isDirectory() || entry.isSymbolicLink() || !input.childNames.includes(entry.name as ChildName)
        )
      ) {
        throw new RecordIoError('partial_directory_set');
      }
      const publishStageStats = await input.fs.lstat(stage);
      if (
        !publishStageStats.isDirectory() ||
        publishStageStats.isSymbolicLink() ||
        publishStageStats.dev !== stageStats.dev ||
        publishStageStats.ino !== stageStats.ino
      ) {
        throw new RecordIoError('unsafe_path');
      }
      try {
        await input.fs.lstat(root);
        throw new RecordIoError('partial_directory_set');
      } catch (error) {
        if (error instanceof RecordIoError) throw error;
        if (!hasErrorCode(error, 'ENOENT')) throw new RecordIoError('storage_error');
      }
      // Publication authority is the final awaited operation. The rename is the commit boundary;
      // a project/schema replacement observed here cannot inherit the staged family.
      await authorize();
      await input.fs.rename(stage, root);
      const publishedStats = await input.fs.lstat(root);
      if (
        !publishedStats.isDirectory() ||
        publishedStats.isSymbolicLink() ||
        publishedStats.dev !== stageStats.dev ||
        publishedStats.ino !== stageStats.ino
      ) {
        throw new RecordIoError('unsafe_path');
      }
      const parentHandle = await input.fs.open(input.parent, 'r');
      try {
        await parentHandle.sync();
      } finally {
        await parentHandle.close();
      }
    } catch (error) {
      if (authorizationFailed && stage !== undefined && ownedStageIdentity !== undefined) {
        try {
          const entries = await input.fs.readdir(stage, { withFileTypes: true });
          const currentStageRealpath = await input.fs.realpath(stage);
          const currentStage = await input.fs.lstat(stage);
          if (
            currentStage.isDirectory() &&
            !currentStage.isSymbolicLink() &&
            currentStage.dev === ownedStageIdentity.dev &&
            currentStage.ino === ownedStageIdentity.ino &&
            currentStageRealpath === stage &&
            entries.length === ownedChildIdentities.size &&
            entries.every((entry) => ownedChildIdentities.has(entry.name))
          ) {
            let empty = true;
            for (const entry of entries) {
              const identity = ownedChildIdentities.get(entry.name);
              if (identity === undefined) {
                empty = false;
                break;
              }
              const child = { path: path.join(stage, entry.name), ...identity };
              if (empty) {
                // Non-recursive removal preserves any raced content or replacement.
                // eslint-disable-next-line no-await-in-loop
                const childEntries = await input.fs.readdir(child.path);
                // eslint-disable-next-line no-await-in-loop
                const childRealpath = await input.fs.realpath(child.path);
                // The exact identity proof is the final awaited operation before rmdir.
                // eslint-disable-next-line no-await-in-loop
                const currentChild = await input.fs.lstat(child.path);
                if (
                  !currentChild.isDirectory() ||
                  currentChild.isSymbolicLink() ||
                  currentChild.dev !== child.dev ||
                  currentChild.ino !== child.ino ||
                  childRealpath !== child.path ||
                  childEntries.length !== 0
                ) {
                  empty = false;
                  break;
                }
                // eslint-disable-next-line no-await-in-loop
                await input.fs.rmdir(child.path);
              }
            }
            if (empty) {
              const stageEntries = await input.fs.readdir(stage);
              const stageRealpath = await input.fs.realpath(stage);
              // The exact identity proof is the final awaited operation before rmdir.
              const finalStage = await input.fs.lstat(stage);
              if (
                finalStage.isDirectory() &&
                !finalStage.isSymbolicLink() &&
                finalStage.dev === ownedStageIdentity.dev &&
                finalStage.ino === ownedStageIdentity.ino &&
                stageRealpath === stage &&
                stageEntries.length === 0
              ) {
                await input.fs.rmdir(stage);
              }
            }
          }
        } catch {
          // Preserve any replaced or ambiguous stage rather than deleting foreign authority.
        }
      }
      throw preserveOrNeutralize(error);
    }
  }

  const rootEntries = await input.fs.readdir(root, { withFileTypes: true });
  if (
    rootEntries.length !== input.childNames.length ||
    rootEntries.some((entry) => !input.childNames.includes(entry.name as ChildName))
  ) {
    throw new RecordIoError('partial_directory_set');
  }
  if (rootEntries.some((entry) => !entry.isDirectory() || entry.isSymbolicLink())) {
    throw new RecordIoError('unsafe_path');
  }
  const result: Record<string, string> = { root };
  for (const childName of input.childNames) {
    let child: string | null;
    try {
      // An existing family must be complete. Missing children are never repaired in place.
      // eslint-disable-next-line no-await-in-loop
      child = await resolveSafeRecordDirectory({
        fs: input.fs,
        canonicalRoot: input.canonicalRoot,
        parent: root,
        name: childName,
        createIfMissing: false,
      });
    } catch (error) {
      throw preserveOrNeutralize(error);
    }
    if (child === null) throw new RecordIoError('partial_directory_set');
    result[childName] = child;
  }
  return result as { root: string } & Record<ChildName, string>;
}

const assertNoUnconfirmedPublication = async (fs: RecordIoFileSystem, file: string): Promise<void> => {
  try {
    await fs.lstat(`${file}.unconfirmed`);
    throw new RecordIoError('unsafe_file');
  } catch (error) {
    if (error instanceof RecordIoError) throw error;
    if (!hasErrorCode(error, 'ENOENT')) throw error;
  }
};

export type BoundedRegularFileRead = {
  bytes: string;
  identity: { dev: number; ino: number };
};

/** Reads a named immutable record and returns the verified named inode identity. */
export async function readBoundedRegularFileWithIdentity(input: {
  fs: RecordIoFileSystem;
  canonicalRoot: string;
  file: string;
  maxBytes: number;
}): Promise<BoundedRegularFileRead | null> {
  const file = resolveConfinedRecordPath(input.canonicalRoot, path.dirname(input.file), path.basename(input.file));
  let handle: Awaited<ReturnType<RecordIoFileSystem['open']>> | undefined;
  try {
    await assertNoUnconfirmedPublication(input.fs, file);
    let preliminaryStats: Awaited<ReturnType<RecordIoFileSystem['lstat']>>;
    try {
      preliminaryStats = await input.fs.lstat(file);
    } catch (error) {
      if (hasErrorCode(error, 'ENOENT')) return null;
      throw error;
    }
    if (preliminaryStats.isSymbolicLink() || !preliminaryStats.isFile()) {
      throw new RecordIoError('unsafe_file');
    }
    if (preliminaryStats.size > input.maxBytes) throw new RecordIoError('record_too_large');
    // Windows does not expose a portable no-follow/nonblocking open combination. Its preliminary
    // lstat plus pre-read handle identity check keeps a raced replacement from being consumed.
    const flags =
      process.platform === 'win32'
        ? fsConstants.O_RDONLY
        : fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK;
    try {
      handle = await input.fs.open(file, flags);
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
    if (stats.size > input.maxBytes) throw new RecordIoError('record_too_large');
    const bytes = Buffer.alloc(input.maxBytes + 1);
    let offset = 0;
    while (offset < bytes.length) {
      // eslint-disable-next-line no-await-in-loop
      const result = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (result.bytesRead === 0) break;
      offset += result.bytesRead;
    }
    if (offset > input.maxBytes) throw new RecordIoError('record_too_large');
    const pathStats = await input.fs.lstat(file);
    if (
      pathStats.isSymbolicLink() ||
      !pathStats.isFile() ||
      pathStats.dev !== stats.dev ||
      pathStats.ino !== stats.ino
    ) {
      throw new RecordIoError('unsafe_file');
    }
    await assertNoUnconfirmedPublication(input.fs, file);
    return {
      bytes: bytes.subarray(0, offset).toString('utf8'),
      identity: { dev: stats.dev, ino: stats.ino },
    };
  } catch (error) {
    throw preserveOrNeutralize(error);
  } finally {
    await handle?.close().catch((): undefined => undefined);
  }
}

/** Reads a named immutable record through one no-follow, bounded file handle. */
export async function readBoundedRegularFile(input: {
  fs: RecordIoFileSystem;
  canonicalRoot: string;
  file: string;
  maxBytes: number;
}): Promise<string | null> {
  const record = await readBoundedRegularFileWithIdentity(input);
  return record?.bytes ?? null;
}

const assertSafeParent = async (input: {
  fs: RecordIoFileSystem;
  canonicalRoot: string;
  file: string;
}): Promise<string> => {
  const parent = path.dirname(input.file);
  resolveConfinedRecordPath(input.canonicalRoot, parent, path.basename(input.file));
  try {
    const parentStats = await input.fs.lstat(parent);
    if (!parentStats.isDirectory() || parentStats.isSymbolicLink() || (await input.fs.realpath(parent)) !== parent) {
      throw new RecordIoError('unsafe_path');
    }
    return parent;
  } catch (error) {
    throw preserveOrNeutralize(error);
  }
};

const syncDirectory = async (fs: RecordIoFileSystem, directory: string): Promise<void> => {
  const handle = await fs.open(directory, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
};

const removeIfPresent = async (fs: RecordIoFileSystem, file: string): Promise<boolean> => {
  try {
    await fs.rm(file);
    return true;
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) return true;
    return false;
  }
};

/**
 * Publishes the complete, bounded-lifetime slot lease without using the generic recursive
 * `.unconfirmed` protocol. The uniquely named temp is non-authoritative; once the hard link is
 * visible, its inode already contains the complete lease bytes.
 */
export async function publishExclusiveLeaseRecord(input: {
  fs: RecordIoFileSystem;
  canonicalRoot: string;
  file: string;
  bytes: string;
  temporaryId?: string;
}): Promise<void> {
  const parent = await assertSafeParent(input);
  const temporaryId = input.temporaryId ?? `${process.pid}_${++temporaryFileCounter}`;
  if (!/^[A-Za-z0-9_-]+$/.test(temporaryId)) throw new RecordIoError('unsafe_path');
  const temporaryFile = `${input.file}.${temporaryId}.tmp`;
  let temporaryHandle: Awaited<ReturnType<RecordIoFileSystem['open']>> | undefined;
  try {
    temporaryHandle = await input.fs.open(temporaryFile, 'wx');
    await temporaryHandle.writeFile(input.bytes, { encoding: 'utf8' });
    await temporaryHandle.sync();
    await temporaryHandle.close();
    temporaryHandle = undefined;

    try {
      await input.fs.link(temporaryFile, input.file);
    } catch (error) {
      if (hasErrorCode(error, 'EEXIST')) throw new RecordIoError('already_exists');
      throw error;
    }
    await syncDirectory(input.fs, parent);
    await input.fs.rm(temporaryFile).catch((): undefined => undefined);
  } catch (error) {
    await temporaryHandle?.close().catch((): undefined => undefined);
    await input.fs.rm(temporaryFile).catch((): undefined => undefined);
    throw preserveOrNeutralize(error);
  }
}

/** Exclusive temp-write/fsync plus a durable unconfirmed guard around link publication. */
export async function publishImmutableRecord(input: {
  fs: RecordIoFileSystem;
  canonicalRoot: string;
  file: string;
  bytes: string;
  temporaryId?: string;
}): Promise<void> {
  const parent = await assertSafeParent(input);
  const temporaryId = input.temporaryId ?? `${process.pid}_${++temporaryFileCounter}`;
  if (!/^[A-Za-z0-9_-]+$/.test(temporaryId)) throw new RecordIoError('unsafe_path');
  const temporaryFile = `${input.file}.${temporaryId}.tmp`;
  const unconfirmedFile = `${input.file}.unconfirmed`;
  let temporaryHandle: Awaited<ReturnType<RecordIoFileSystem['open']>> | undefined;
  let unconfirmedHandle: Awaited<ReturnType<RecordIoFileSystem['open']>> | undefined;
  let ownsUnconfirmed = false;
  let linked = false;
  let committed = false;
  let preserveResidue = false;
  try {
    try {
      await input.fs.lstat(input.file);
      throw new RecordIoError('already_exists');
    } catch (error) {
      if (error instanceof RecordIoError) throw error;
      if (!hasErrorCode(error, 'ENOENT')) throw error;
    }

    temporaryHandle = await input.fs.open(temporaryFile, 'wx');
    await temporaryHandle.writeFile(input.bytes, { encoding: 'utf8' });
    await temporaryHandle.sync();
    await temporaryHandle.close();
    temporaryHandle = undefined;

    unconfirmedHandle = await input.fs.open(unconfirmedFile, 'wx');
    ownsUnconfirmed = true;
    await unconfirmedHandle.writeFile('1', { encoding: 'utf8' });
    await unconfirmedHandle.sync();
    await unconfirmedHandle.close();
    unconfirmedHandle = undefined;
    await syncDirectory(input.fs, parent);

    try {
      await input.fs.link(temporaryFile, input.file);
      linked = true;
    } catch (error) {
      if (hasErrorCode(error, 'EEXIST')) throw new RecordIoError('already_exists');
      throw error;
    }
    try {
      await syncDirectory(input.fs, parent);
      committed = true;
    } catch (error) {
      const removed = await removeIfPresent(input.fs, input.file);
      linked = !removed;
      let rollbackDurable = false;
      if (removed) {
        try {
          await syncDirectory(input.fs, parent);
          rollbackDurable = true;
        } catch {
          // The durable guard remains authoritative when rollback durability is unknown.
        }
      }
      if (rollbackDurable) {
        if (await removeIfPresent(input.fs, unconfirmedFile)) ownsUnconfirmed = false;
        await removeIfPresent(input.fs, temporaryFile);
      } else {
        preserveResidue = true;
      }
      throw error;
    }

    await input.fs.rm(unconfirmedFile);
    ownsUnconfirmed = false;
    await input.fs.rm(temporaryFile).catch((): undefined => undefined);
  } catch (error) {
    await temporaryHandle?.close().catch((): undefined => undefined);
    await unconfirmedHandle?.close().catch((): undefined => undefined);
    if (!committed && !linked && !preserveResidue) {
      if (ownsUnconfirmed && (await removeIfPresent(input.fs, unconfirmedFile))) ownsUnconfirmed = false;
      await removeIfPresent(input.fs, temporaryFile);
    }
    throw preserveOrNeutralize(error);
  }
}

/** Removes one regular record, then makes the directory entry deletion durable. */
export async function removeRegularRecordIfPresent(input: {
  fs: RecordIoFileSystem;
  canonicalRoot: string;
  file: string;
  isStillAuthorized?: () => boolean | Promise<boolean>;
}): Promise<boolean> {
  const parent = await assertSafeParent(input);
  try {
    let stats: Awaited<ReturnType<RecordIoFileSystem['lstat']>>;
    try {
      stats = await input.fs.lstat(input.file);
    } catch (error) {
      if (hasErrorCode(error, 'ENOENT')) return false;
      throw error;
    }
    if (stats.isSymbolicLink() || !stats.isFile()) throw new RecordIoError('unsafe_file');
    const authorization = input.isStillAuthorized?.();
    if (authorization !== undefined) {
      const authorized = typeof authorization === 'boolean' ? authorization : await authorization;
      if (!authorized) throw new RecordIoError('storage_error');
    }
    await input.fs.rm(input.file);
    await syncDirectory(input.fs, parent);
    return true;
  } catch (error) {
    throw preserveOrNeutralize(error);
  }
}

/** Removes only the regular inode proved by the caller, then durably records the deletion. */
export async function removeRegularRecordIfIdentity(input: {
  fs: RecordIoFileSystem;
  canonicalRoot: string;
  file: string;
  identity: { dev: number; ino: number };
  isStillAuthorized: () => boolean | Promise<boolean>;
}): Promise<boolean> {
  const parent = await assertSafeParent(input);
  try {
    let stats: Awaited<ReturnType<RecordIoFileSystem['lstat']>>;
    try {
      stats = await input.fs.lstat(input.file);
    } catch (error) {
      if (hasErrorCode(error, 'ENOENT')) return false;
      throw error;
    }
    if (
      stats.isSymbolicLink() ||
      !stats.isFile() ||
      stats.dev !== input.identity.dev ||
      stats.ino !== input.identity.ino
    ) {
      throw new RecordIoError('unsafe_file');
    }
    const authorization = input.isStillAuthorized();
    const authorized = typeof authorization === 'boolean' ? authorization : await authorization;
    if (!authorized) throw new RecordIoError('storage_error');
    await input.fs.rm(input.file);
    await syncDirectory(input.fs, parent);
    return true;
  } catch (error) {
    throw preserveOrNeutralize(error);
  }
}
