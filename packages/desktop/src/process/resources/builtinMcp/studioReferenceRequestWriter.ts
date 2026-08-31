/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import {
  STUDIO_MAX_PROJECT_REFERENCES,
  STUDIO_REFERENCE_REQUEST_SCHEMA_VERSION,
  STUDIO_REFERENCE_REQUEST_V2_MAX_PENDING_PER_PROJECT,
  STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
  STUDIO_REFERENCE_REQUEST_V2_PENDING_TTL_MS,
  type StudioReferenceRequestV2,
} from '@/common/types/project/creativeStudioTypes';
import {
  StudioPendingRecordWriteError,
  assertPendingRecordProjectAuthorityV2,
  type StudioPendingProjectAuthorityV2,
  writePendingRecordV2,
} from '@process/resources/builtinMcp/studioPendingRecordWriter';
import {
  parseStudioReferenceRequestSlotV2,
  parseStudioReferenceRequestV2,
} from '@process/services/creative-studio/service/director/contracts';
import {
  RecordIoError,
  publishExclusiveLeaseRecord,
  readBoundedRegularFileWithIdentity,
  type RecordIoFileSystem,
} from '@process/services/creative-studio/service/recordIo';

export type WriteReferenceRequestInputV2 = {
  pendingDir: string;
  projectId: string;
  referenceIds: string[];
  /** Test seam; production omits it and gets a UUID. */
  requestId?: string;
  /** Test seam for V2 identity and publication races. */
  fs?: RecordIoFileSystem;
  /** Reasserts the exact manifest authority around V2 sidecar publication. */
  authorityFence?: () => Promise<'valid' | 'unsupported_prototype_schema' | 'invalid'>;
  projectAuthority: StudioPendingProjectAuthorityV2;
};

const SAFE_ID = /^[A-Za-z0-9_-]+$/;

const isSafeId = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= 256 && SAFE_ID.test(value);

const directoryIdentity = (stats: Awaited<ReturnType<RecordIoFileSystem['lstat']>>): string =>
  JSON.stringify([stats.isDirectory(), stats.isSymbolicLink(), stats.dev, stats.ino]);

const referenceRequestWriteQueuesV2 = new Map<string, Promise<void>>();

const REFERENCE_REQUEST_WRITER_LOCK_NAME_V2 = '.reference-requests.writer.lock';
const REFERENCE_REQUEST_WRITER_RECLAIM_NAME_V2 = '.reference-requests.writer.lock.reclaim';
const REFERENCE_REQUEST_WRITER_LOCK_MAX_BYTES_V2 = 1_024;
const REFERENCE_REQUEST_WRITER_LOCK_STALE_MS_V2 = 2 * 60_000;
const REFERENCE_REQUEST_WRITER_LOCK_WAIT_MS_V2 = 5_000;
const REFERENCE_REQUEST_WRITER_LOCK_RETRY_MS_V2 = 10;

type ReferenceRequestWriterLockV2 = {
  schemaVersion: typeof STUDIO_REFERENCE_REQUEST_SCHEMA_VERSION;
  token: string;
  pid: number;
  acquiredAt: string;
};

type AcquiredReferenceRequestWriterLockV2 = {
  root: string;
  file: string;
  reclaimFile: string;
  bytes: string;
  identity: { dev: number; ino: number };
};

const hasErrorCode = (error: unknown, code: string): boolean =>
  typeof error === 'object' && error !== null && !Array.isArray(error) && Reflect.get(error, 'code') === code;

const syncDirectory = async (injectedFs: RecordIoFileSystem, directory: string): Promise<void> => {
  const handle = await injectedFs.open(directory, 'r');
  try {
    const stats = await handle.stat();
    if (!stats.isDirectory()) throw new StudioPendingRecordWriteError('storage', 'Reference request lock is unsafe');
    await handle.sync();
  } finally {
    await handle.close();
  }
};

const parseReferenceRequestWriterLockV2 = (bytes: string): ReferenceRequestWriterLockV2 | null => {
  let value: unknown;
  try {
    value = JSON.parse(bytes) as unknown;
  } catch {
    return null;
  }
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    Reflect.ownKeys(value).length !== 4 ||
    !Object.hasOwn(value, 'schemaVersion') ||
    !Object.hasOwn(value, 'token') ||
    !Object.hasOwn(value, 'pid') ||
    !Object.hasOwn(value, 'acquiredAt')
  ) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (
    record.schemaVersion !== STUDIO_REFERENCE_REQUEST_SCHEMA_VERSION ||
    !isSafeId(record.token) ||
    !Number.isSafeInteger(record.pid) ||
    (record.pid as number) < 1 ||
    typeof record.acquiredAt !== 'string' ||
    !Number.isFinite(Date.parse(record.acquiredAt))
  ) {
    return null;
  }
  return record as ReferenceRequestWriterLockV2;
};

const processIsAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return hasErrorCode(error, 'EPERM');
  }
};

const readWriterLockV2 = async (injectedFs: RecordIoFileSystem, canonicalRoot: string, file: string) => {
  try {
    return await readBoundedRegularFileWithIdentity({
      fs: injectedFs,
      canonicalRoot,
      file,
      maxBytes: REFERENCE_REQUEST_WRITER_LOCK_MAX_BYTES_V2,
    });
  } catch (error) {
    // A cooperative owner may unlink its lease between the reader's opening and final pathname
    // identity check. Retry only when a fresh no-follow lookup proves that the name is still absent;
    // a replacement or any other storage failure remains fail-closed.
    if (error instanceof RecordIoError && error.code === 'storage_error') {
      try {
        await injectedFs.lstat(file);
      } catch (currentError) {
        if (hasErrorCode(currentError, 'ENOENT')) return null;
      }
    }
    throw error;
  }
};

const retireWriterLockV2 = async (input: {
  fs: RecordIoFileSystem;
  projectAuthority: StudioPendingProjectAuthorityV2;
  root: string;
  file: string;
  reclaimFile: string;
  expected: { bytes: string; identity: { dev: number; ino: number } };
}): Promise<boolean> => {
  try {
    await assertPendingRecordProjectAuthorityV2({
      pendingDir: path.join(input.root, 'reference-requests', 'pending'),
      projectAuthority: input.projectAuthority,
      fs: input.fs,
    });
    await input.fs.link(input.file, input.reclaimFile);
    await syncDirectory(input.fs, input.root);
    const [named, reclaimed] = await Promise.all([
      readWriterLockV2(input.fs, input.projectAuthority.canonicalRoot, input.file),
      readWriterLockV2(input.fs, input.projectAuthority.canonicalRoot, input.reclaimFile),
    ]);
    if (
      named === null ||
      reclaimed === null ||
      named.bytes !== input.expected.bytes ||
      reclaimed.bytes !== input.expected.bytes ||
      named.identity.dev !== input.expected.identity.dev ||
      named.identity.ino !== input.expected.identity.ino ||
      reclaimed.identity.dev !== input.expected.identity.dev ||
      reclaimed.identity.ino !== input.expected.identity.ino
    ) {
      await input.fs.rm(input.reclaimFile).catch((): undefined => undefined);
      await syncDirectory(input.fs, input.root).catch((): undefined => undefined);
      return false;
    }
    await input.fs.rm(input.file);
    await syncDirectory(input.fs, input.root);
    await input.fs.rm(input.reclaimFile);
    await syncDirectory(input.fs, input.root);
    return true;
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT') || hasErrorCode(error, 'EEXIST')) return false;
    throw error;
  }
};

const clearDeadReclaimV2 = async (input: {
  fs: RecordIoFileSystem;
  projectAuthority: StudioPendingProjectAuthorityV2;
  root: string;
  reclaimFile: string;
  nowMs: number;
}): Promise<boolean> => {
  const reclaim = await readWriterLockV2(input.fs, input.projectAuthority.canonicalRoot, input.reclaimFile);
  if (reclaim === null) return true;
  const record = parseReferenceRequestWriterLockV2(reclaim.bytes);
  if (
    record === null ||
    input.nowMs - Date.parse(record.acquiredAt) <= REFERENCE_REQUEST_WRITER_LOCK_STALE_MS_V2 ||
    processIsAlive(record.pid)
  ) {
    return false;
  }
  const current = await readWriterLockV2(input.fs, input.projectAuthority.canonicalRoot, input.reclaimFile);
  if (
    current === null ||
    current.bytes !== reclaim.bytes ||
    current.identity.dev !== reclaim.identity.dev ||
    current.identity.ino !== reclaim.identity.ino
  ) {
    return false;
  }
  await input.fs.rm(input.reclaimFile);
  await syncDirectory(input.fs, input.root);
  return true;
};

const acquireReferenceRequestWriterLockV2 = async (
  input: WriteReferenceRequestInputV2
): Promise<AcquiredReferenceRequestWriterLockV2> => {
  const injectedFs = input.fs ?? fs;
  const configuredFamilyRoot = path.resolve(path.dirname(input.pendingDir));
  const familyRoot = await injectedFs.realpath(configuredFamilyRoot);
  if (
    path.basename(familyRoot) !== 'reference-requests' ||
    path.dirname(familyRoot) !== input.projectAuthority.canonicalRoot
  ) {
    throw new StudioPendingRecordWriteError('storage', 'Reference request lock is outside project authority');
  }
  const familyRootStats = await injectedFs.lstat(familyRoot);
  const root = input.projectAuthority.canonicalRoot;
  const rootStats = await injectedFs.lstat(root);
  if (
    !familyRootStats.isDirectory() ||
    familyRootStats.isSymbolicLink() ||
    !rootStats.isDirectory() ||
    rootStats.isSymbolicLink() ||
    rootStats.dev !== input.projectAuthority.rootIdentity.dev ||
    rootStats.ino !== input.projectAuthority.rootIdentity.ino ||
    (await injectedFs.realpath(root)) !== root
  ) {
    throw new StudioPendingRecordWriteError('storage', 'Reference request lock root is unsafe');
  }
  const file = path.join(root, REFERENCE_REQUEST_WRITER_LOCK_NAME_V2);
  const reclaimFile = path.join(root, REFERENCE_REQUEST_WRITER_RECLAIM_NAME_V2);
  const token = randomUUID();
  const deadline = Date.now() + REFERENCE_REQUEST_WRITER_LOCK_WAIT_MS_V2;
  for (;;) {
    await assertPendingRecordProjectAuthorityV2({
      pendingDir: input.pendingDir,
      projectAuthority: input.projectAuthority,
      fs: injectedFs,
    });
    const nowMs = Date.now();
    const reclaim = await readWriterLockV2(injectedFs, input.projectAuthority.canonicalRoot, reclaimFile);
    if (reclaim !== null) {
      if (
        !(await clearDeadReclaimV2({
          fs: injectedFs,
          projectAuthority: input.projectAuthority,
          root,
          reclaimFile,
          nowMs,
        }))
      ) {
        if (nowMs >= deadline) {
          throw new StudioPendingRecordWriteError('storage', 'Reference request writer is busy');
        }
        await new Promise<void>((resolve) => setTimeout(resolve, REFERENCE_REQUEST_WRITER_LOCK_RETRY_MS_V2));
        continue;
      }
    }
    const record: ReferenceRequestWriterLockV2 = {
      schemaVersion: STUDIO_REFERENCE_REQUEST_SCHEMA_VERSION,
      token,
      pid: process.pid,
      acquiredAt: new Date(nowMs).toISOString(),
    };
    const bytes = JSON.stringify(record);
    try {
      await publishExclusiveLeaseRecord({
        fs: injectedFs,
        canonicalRoot: input.projectAuthority.canonicalRoot,
        file,
        bytes,
        temporaryId: token,
      });
      const acquired = await readWriterLockV2(injectedFs, input.projectAuthority.canonicalRoot, file);
      if (acquired === null || acquired.bytes !== bytes) {
        throw new StudioPendingRecordWriteError('storage', 'Reference request lock publication is ambiguous');
      }
      return { root, file, reclaimFile, bytes, identity: acquired.identity };
    } catch (error) {
      if (!(error instanceof RecordIoError && error.code === 'already_exists')) throw error;
      const existing = await readWriterLockV2(injectedFs, input.projectAuthority.canonicalRoot, file);
      const existingRecord = existing === null ? null : parseReferenceRequestWriterLockV2(existing.bytes);
      if (existing !== null && existingRecord === null) {
        throw new StudioPendingRecordWriteError('storage', 'Reference request writer lock is malformed');
      }
      if (
        existing !== null &&
        existingRecord !== null &&
        nowMs - Date.parse(existingRecord.acquiredAt) > REFERENCE_REQUEST_WRITER_LOCK_STALE_MS_V2 &&
        !processIsAlive(existingRecord.pid)
      ) {
        await retireWriterLockV2({
          fs: injectedFs,
          projectAuthority: input.projectAuthority,
          root,
          file,
          reclaimFile,
          expected: existing,
        });
        continue;
      }
      if (nowMs >= deadline) throw new StudioPendingRecordWriteError('storage', 'Reference request writer is busy');
      await new Promise<void>((resolve) => setTimeout(resolve, REFERENCE_REQUEST_WRITER_LOCK_RETRY_MS_V2));
    }
  }
};

const withReferenceRequestPublicationLockV2 = async <T>(
  input: WriteReferenceRequestInputV2,
  operation: () => Promise<T>
): Promise<T> => {
  const injectedFs = input.fs ?? fs;
  const lock = await acquireReferenceRequestWriterLockV2(input);
  let operationError: unknown;
  try {
    return await operation();
  } catch (error) {
    operationError = error;
    throw error;
  } finally {
    const retired = await retireWriterLockV2({
      fs: injectedFs,
      projectAuthority: input.projectAuthority,
      root: lock.root,
      file: lock.file,
      reclaimFile: lock.reclaimFile,
      expected: lock,
    }).catch(() => false);
    if (!retired && operationError === undefined) {
      throw new StudioPendingRecordWriteError('storage', 'Reference request writer lock could not be released');
    }
  }
};

const withReferenceRequestWriteQueueV2 = async <T>(pendingDir: string, operation: () => Promise<T>): Promise<T> => {
  const prior = referenceRequestWriteQueuesV2.get(pendingDir) ?? Promise.resolve();
  const running = prior.catch((): undefined => undefined).then(operation);
  const tail = running.then(
    (): undefined => undefined,
    (): undefined => undefined
  );
  referenceRequestWriteQueuesV2.set(pendingDir, tail);
  try {
    return await running;
  } finally {
    if (referenceRequestWriteQueuesV2.get(pendingDir) === tail) referenceRequestWriteQueuesV2.delete(pendingDir);
  }
};

/** Reads only exact schema-5 request records; older sidecars never establish reference deduplication. */
export const listPendingReferenceRequestIdsV2 = async (
  pendingDir: string,
  projectId: string,
  injectedFs: RecordIoFileSystem = fs,
  projectAuthority?: StudioPendingProjectAuthorityV2,
  now: () => number = Date.now
): Promise<Set<string>> => {
  const nowMs = now();
  if (!Number.isSafeInteger(nowMs)) {
    throw new StudioPendingRecordWriteError('storage', 'Invalid schema-2 reference request queue');
  }
  const pendingCutoffMs = nowMs - STUDIO_REFERENCE_REQUEST_V2_PENDING_TTL_MS;
  let canonicalPendingDir: string;
  let pendingIdentity: string;
  let canonicalSlotsDir: string;
  let slotsIdentity: string;
  let pendingEntries: import('node:fs').Dirent[];
  let slotEntries: import('node:fs').Dirent[];
  try {
    if (projectAuthority !== undefined) {
      await assertPendingRecordProjectAuthorityV2({ pendingDir, projectAuthority, fs: injectedFs });
    }
    const pendingStats = await injectedFs.lstat(pendingDir);
    if (!pendingStats.isDirectory() || pendingStats.isSymbolicLink()) return new Set();
    pendingIdentity = directoryIdentity(pendingStats);
    canonicalPendingDir = await injectedFs.realpath(pendingDir);
    const canonicalStats = await injectedFs.lstat(canonicalPendingDir);
    if (directoryIdentity(canonicalStats) !== pendingIdentity) return new Set();
    const slotsDir = path.join(path.dirname(canonicalPendingDir), 'slots');
    const slotsStats = await injectedFs.lstat(slotsDir);
    if (!slotsStats.isDirectory() || slotsStats.isSymbolicLink()) return new Set();
    slotsIdentity = directoryIdentity(slotsStats);
    canonicalSlotsDir = await injectedFs.realpath(slotsDir);
    const canonicalSlotsStats = await injectedFs.lstat(canonicalSlotsDir);
    if (directoryIdentity(canonicalSlotsStats) !== slotsIdentity) return new Set();
    [pendingEntries, slotEntries] = await Promise.all([
      injectedFs.readdir(canonicalPendingDir, { withFileTypes: true }),
      injectedFs.readdir(canonicalSlotsDir, { withFileTypes: true }),
    ]);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return new Set();
    throw error;
  }
  const pendingNames = pendingEntries.map((entry) => entry.name).toSorted();
  const slotNames = slotEntries.map((entry) => entry.name).toSorted();
  const liveRequestIds = new Set<string>();
  const identifiedSlots: Array<{
    file: string;
    bytes: string;
    identity: { dev: number; ino: number };
  }> = [];
  let duplicateLiveRequestId = false;
  for (const entry of slotEntries) {
    const match = /^(0|[1-9]\d*)\.slot$/.exec(entry.name);
    if (!entry.isFile() || match === null || Number(match[1]) >= STUDIO_REFERENCE_REQUEST_V2_MAX_PENDING_PER_PROJECT) {
      continue;
    }
    try {
      const file = path.join(canonicalSlotsDir, entry.name);
      // One verified live slot is the dedup authority. Terminal decisions release their slot while
      // an open generation handoff deliberately retains it until its receipt is durable.
      // eslint-disable-next-line no-await-in-loop
      const identified = await readBoundedRegularFileWithIdentity({
        fs: injectedFs,
        canonicalRoot: canonicalSlotsDir,
        file,
        maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
      });
      if (identified === null) continue;
      const parsed = parseStudioReferenceRequestSlotV2(JSON.parse(identified.bytes) as unknown);
      if (parsed.status !== 'valid') continue;
      if (liveRequestIds.has(parsed.record.requestId)) duplicateLiveRequestId = true;
      liveRequestIds.add(parsed.record.requestId);
      identifiedSlots.push({ file, ...identified });
    } catch {
      // Main owns authoritative validation; malformed and V1 slots cannot establish V2 dedup state.
    }
  }
  if (duplicateLiveRequestId) {
    throw new StudioPendingRecordWriteError('storage', 'Invalid schema-2 reference request queue');
  }
  const referenceIds = new Set<string>();
  const identifiedPending: Array<{
    file: string;
    bytes: string;
    identity: { dev: number; ino: number };
  }> = [];
  const joinedRequestIds = new Set<string>();
  for (const entry of pendingEntries) {
    if (!entry.isFile()) continue;
    try {
      const file = path.join(canonicalPendingDir, entry.name);
      const readyMatch = /^([A-Za-z0-9_-]{1,256}\.json)\.\d+_\d+\.ready$/.exec(entry.name);
      const canonicalName = entry.name.endsWith('.json') ? entry.name : readyMatch?.[1];
      if (canonicalName === undefined) continue;
      const requestId = canonicalName.slice(0, -'.json'.length);
      if (!liveRequestIds.has(requestId)) continue;
      const canonicalFile = path.join(canonicalPendingDir, canonicalName);
      let identifiedFile = file;
      let identified = await readBoundedRegularFileWithIdentity({
        fs: injectedFs,
        canonicalRoot: canonicalPendingDir,
        file,
        maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
      });
      if (readyMatch !== null) {
        const named = await readBoundedRegularFileWithIdentity({
          fs: injectedFs,
          canonicalRoot: canonicalPendingDir,
          file: canonicalFile,
          maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
        });
        if (named !== null) continue;
        const temporaryFile = `${file.slice(0, -'.ready'.length)}.tmp`;
        const temporary = await readBoundedRegularFileWithIdentity({
          fs: injectedFs,
          canonicalRoot: canonicalPendingDir,
          file: temporaryFile,
          maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
        });
        if (
          identified === null ||
          temporary === null ||
          identified.bytes !== temporary.bytes ||
          identified.identity.dev !== temporary.identity.dev ||
          identified.identity.ino !== temporary.identity.ino
        ) {
          throw new StudioPendingRecordWriteError('storage', 'Invalid schema-2 reference request queue');
        }
        identifiedPending.push({ file: temporaryFile, ...temporary });
        identifiedFile = file;
      }
      // One no-follow descriptor binds validation to the reference-request byte contract from one inode.
      if (identified === null) {
        throw new StudioPendingRecordWriteError('storage', 'Invalid schema-2 reference request queue');
      }
      const value = JSON.parse(identified.bytes) as unknown;
      const parsed = parseStudioReferenceRequestV2({ projectId, requestId, value });
      if (parsed.status !== 'valid') {
        throw new StudioPendingRecordWriteError('storage', 'Invalid schema-2 reference request queue');
      }
      if (joinedRequestIds.has(requestId)) {
        throw new StudioPendingRecordWriteError('storage', 'Invalid schema-2 reference request queue');
      }
      identifiedPending.push({ file: identifiedFile, ...identified });
      joinedRequestIds.add(requestId);
      if (Date.parse(parsed.record.createdAt) <= pendingCutoffMs) continue;
      for (const referenceId of parsed.record.referenceIds) referenceIds.add(referenceId);
    } catch (error) {
      if (error instanceof StudioPendingRecordWriteError) throw error;
      throw new StudioPendingRecordWriteError('storage', 'Invalid schema-2 reference request queue');
    }
  }
  if (joinedRequestIds.size !== liveRequestIds.size) {
    throw new StudioPendingRecordWriteError('storage', 'Invalid schema-2 reference request queue');
  }
  const [finalPendingStats, finalSlotsStats, finalPendingEntries, finalSlotEntries] = await Promise.all([
    injectedFs.lstat(canonicalPendingDir),
    injectedFs.lstat(canonicalSlotsDir),
    injectedFs.readdir(canonicalPendingDir, { withFileTypes: true }),
    injectedFs.readdir(canonicalSlotsDir, { withFileTypes: true }),
  ]);
  if (
    directoryIdentity(finalPendingStats) !== pendingIdentity ||
    directoryIdentity(finalSlotsStats) !== slotsIdentity ||
    directoryIdentity(await injectedFs.lstat(pendingDir)) !== pendingIdentity ||
    (await injectedFs.realpath(pendingDir)) !== canonicalPendingDir ||
    (await injectedFs.realpath(canonicalSlotsDir)) !== canonicalSlotsDir ||
    JSON.stringify(finalPendingEntries.map((entry) => entry.name).toSorted()) !== JSON.stringify(pendingNames) ||
    JSON.stringify(finalSlotEntries.map((entry) => entry.name).toSorted()) !== JSON.stringify(slotNames)
  ) {
    throw new StudioPendingRecordWriteError('storage', 'Invalid schema-2 reference request queue');
  }
  for (const identified of identifiedSlots) {
    // eslint-disable-next-line no-await-in-loop
    const current = await readBoundedRegularFileWithIdentity({
      fs: injectedFs,
      canonicalRoot: canonicalSlotsDir,
      file: identified.file,
      maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
    });
    if (
      current === null ||
      current.bytes !== identified.bytes ||
      current.identity.dev !== identified.identity.dev ||
      current.identity.ino !== identified.identity.ino
    ) {
      throw new StudioPendingRecordWriteError('storage', 'Invalid schema-2 reference request queue');
    }
  }
  for (const identified of identifiedPending) {
    // eslint-disable-next-line no-await-in-loop
    const current = await readBoundedRegularFileWithIdentity({
      fs: injectedFs,
      canonicalRoot: canonicalPendingDir,
      file: identified.file,
      maxBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
    });
    if (
      current === null ||
      current.bytes !== identified.bytes ||
      current.identity.dev !== identified.identity.dev ||
      current.identity.ino !== identified.identity.ino
    ) {
      throw new StudioPendingRecordWriteError('storage', 'Invalid schema-2 reference request queue');
    }
  }
  if (projectAuthority !== undefined) {
    await assertPendingRecordProjectAuthorityV2({ pendingDir, projectAuthority, fs: injectedFs });
  }
  return referenceIds;
};

/** Writes one ordered schema-5 project-reference batch without starting generation. */
export const writeReferenceRequestRecordV2 = async (
  input: WriteReferenceRequestInputV2
): Promise<StudioReferenceRequestV2> =>
  withReferenceRequestWriteQueueV2(input.pendingDir, async () => {
    let validated: { projectId: string; requestId: string | undefined; referenceIds: string[] };
    try {
      const projectId = input.projectId;
      const requestId = input.requestId;
      const requestedReferenceIds = input.referenceIds;
      if (
        !isSafeId(projectId) ||
        (requestId !== undefined && !isSafeId(requestId)) ||
        !Array.isArray(requestedReferenceIds) ||
        requestedReferenceIds.length < 1 ||
        requestedReferenceIds.length > STUDIO_MAX_PROJECT_REFERENCES ||
        Reflect.ownKeys(requestedReferenceIds).length !== requestedReferenceIds.length + 1
      ) {
        throw new StudioPendingRecordWriteError('storage', 'Invalid schema-2 reference request');
      }
      const seen = new Set<string>();
      for (let index = 0; index < requestedReferenceIds.length; index += 1) {
        if (!Object.hasOwn(requestedReferenceIds, index)) {
          throw new StudioPendingRecordWriteError('storage', 'Invalid schema-2 reference request');
        }
        const referenceId = requestedReferenceIds[index];
        if (!isSafeId(referenceId) || seen.has(referenceId)) {
          throw new StudioPendingRecordWriteError('storage', 'Invalid schema-2 reference request');
        }
        seen.add(referenceId);
      }
      const referenceIds = [...requestedReferenceIds];
      const validationId = requestId ?? 'x'.repeat(256);
      const validation = parseStudioReferenceRequestV2({
        projectId,
        requestId: validationId,
        value: {
          schemaVersion: STUDIO_REFERENCE_REQUEST_SCHEMA_VERSION,
          id: validationId,
          projectId,
          referenceIds,
          status: 'pending',
          createdAt: '1970-01-01T00:00:00.000Z',
        },
      });
      if (validation.status !== 'valid') {
        throw new StudioPendingRecordWriteError('storage', 'Invalid schema-2 reference request');
      }
      validated = {
        projectId: validation.record.projectId,
        requestId,
        referenceIds: validation.record.referenceIds,
      };
    } catch (error) {
      if (error instanceof StudioPendingRecordWriteError) throw error;
      throw new StudioPendingRecordWriteError('storage', 'Invalid schema-2 reference request');
    }
    return withReferenceRequestPublicationLockV2(input, async () => {
      const pendingReferenceIds = await listPendingReferenceRequestIdsV2(
        input.pendingDir,
        validated.projectId,
        input.fs,
        input.projectAuthority
      );
      const alreadyPending = validated.referenceIds.filter((referenceId) => pendingReferenceIds.has(referenceId));
      if (alreadyPending.length > 0) {
        throw new StudioPendingRecordWriteError(
          'storage',
          `References already have pending requests: ${alreadyPending.join(', ')}`
        );
      }
      const record: StudioReferenceRequestV2 = {
        schemaVersion: STUDIO_REFERENCE_REQUEST_SCHEMA_VERSION,
        id: validated.requestId ?? randomUUID(),
        projectId: validated.projectId,
        referenceIds: validated.referenceIds,
        status: 'pending',
        createdAt: new Date().toISOString(),
      };
      const canonical = parseStudioReferenceRequestV2({
        projectId: validated.projectId,
        requestId: record.id,
        value: record,
      });
      if (canonical.status !== 'valid') {
        throw new StudioPendingRecordWriteError('storage', 'Invalid schema-2 reference request');
      }
      return writePendingRecordV2({
        pendingDir: input.pendingDir,
        recordId: canonical.record.id,
        record: canonical.record,
        slotRecordKey: 'requestId',
        capacityMessage: 'Reference request queue is full for this project',
        tooLargeMessage: 'Reference request exceeds the size cap',
        fs: input.fs,
        authorityFence: input.authorityFence,
        projectAuthority: input.projectAuthority,
      });
    });
  });
