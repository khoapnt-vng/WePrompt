/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

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
}): Promise<({ root: string } & Record<ChildName, string>) | null> {
  const root = resolveConfinedRecordPath(input.canonicalRoot, input.parent, input.rootName);
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
    try {
      await input.fs.mkdir(root);
      for (const childName of input.childNames) {
        // A newly exclusive-created family root has no pre-existing child authority.
        // eslint-disable-next-line no-await-in-loop
        await input.fs.mkdir(resolveConfinedRecordPath(input.canonicalRoot, root, childName));
      }
    } catch (error) {
      throw preserveOrNeutralize(error);
    }
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

/** Reads a named immutable record only after lstat type and size checks. */
export async function readBoundedRegularFile(input: {
  fs: RecordIoFileSystem;
  canonicalRoot: string;
  file: string;
  maxBytes: number;
}): Promise<string | null> {
  const file = resolveConfinedRecordPath(input.canonicalRoot, path.dirname(input.file), path.basename(input.file));
  try {
    let stats: Awaited<ReturnType<RecordIoFileSystem['lstat']>>;
    try {
      stats = await input.fs.lstat(file);
    } catch (error) {
      if (hasErrorCode(error, 'ENOENT')) return null;
      throw error;
    }
    if (stats.isSymbolicLink() || !stats.isFile()) throw new RecordIoError('unsafe_file');
    if (stats.size > input.maxBytes) throw new RecordIoError('record_too_large');
    const bytes = await input.fs.readFile(file, 'utf8');
    if (Buffer.byteLength(bytes, 'utf8') > input.maxBytes) throw new RecordIoError('record_too_large');
    return bytes;
  } catch (error) {
    throw preserveOrNeutralize(error);
  }
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

/** Exclusive temp-write/fsync/link publication followed by parent-directory fsync. */
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
  let temporaryHandle: Awaited<ReturnType<RecordIoFileSystem['open']>> | undefined;
  try {
    temporaryHandle = await input.fs.open(temporaryFile, 'wx');
    await temporaryHandle.writeFile(input.bytes, { encoding: 'utf8' });
    await temporaryHandle.sync();
    await temporaryHandle.close();
    temporaryHandle = undefined;
    await input.fs.link(temporaryFile, input.file);
    await input.fs.rm(temporaryFile);
    await syncDirectory(input.fs, parent);
  } catch (error) {
    await temporaryHandle?.close().catch((): undefined => undefined);
    await input.fs.rm(temporaryFile, { force: true }).catch((): undefined => undefined);
    if (hasErrorCode(error, 'EEXIST')) throw new RecordIoError('already_exists');
    throw preserveOrNeutralize(error);
  }
}

/** Removes one regular record, then makes the directory entry deletion durable. */
export async function removeRegularRecordIfPresent(input: {
  fs: RecordIoFileSystem;
  canonicalRoot: string;
  file: string;
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
    await input.fs.rm(input.file);
    await syncDirectory(input.fs, parent);
    return true;
  } catch (error) {
    throw preserveOrNeutralize(error);
  }
}
