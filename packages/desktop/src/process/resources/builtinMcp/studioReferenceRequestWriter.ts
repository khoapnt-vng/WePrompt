/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import {
  STUDIO_MAX_REFERENCE_REQUEST_CLIPS,
  STUDIO_PROJECT_SCHEMA_VERSION,
  type StudioReferenceRequest,
  type StudioReferenceRequestV2,
} from '@/common/types/project/creativeStudioTypes';
import {
  StudioPendingRecordWriteError,
  assertPendingRecordProjectAuthorityV2,
  type StudioPendingProjectAuthorityV2,
  writePendingRecord,
  writePendingRecordV2,
} from '@process/resources/builtinMcp/studioPendingRecordWriter';
import { parseStudioReferenceRequestV2 } from '@process/services/creative-studio/service/directorCommandContracts';
import { readBoundedRegularFile, type RecordIoFileSystem } from '@process/services/creative-studio/service/recordIo';

export type WriteReferenceRequestInput = {
  pendingDir: string;
  projectId: string;
  sceneId: string;
  /** Test seam; production omits it and gets a UUID. */
  requestId?: string;
};

export type WriteReferenceRequestInputV2 = {
  pendingDir: string;
  projectId: string;
  clipIds: string[];
  /** Test seam; production omits it and gets a UUID. */
  requestId?: string;
  /** Test seam for V2 identity and publication races. */
  fs?: RecordIoFileSystem;
  /** Reasserts the exact manifest authority around V2 sidecar publication. */
  authorityFence?: () => Promise<'valid' | 'unsupported_prototype_schema' | 'invalid'>;
  projectAuthority: StudioPendingProjectAuthorityV2;
};

const MAX_RECORD_BYTES = 256 * 1024;
const SAFE_ID = /^[A-Za-z0-9_-]+$/;
const REFERENCE_REQUEST_KEYS = new Set(['schemaVersion', 'id', 'projectId', 'sceneId', 'status', 'createdAt']);

const isSafeId = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= 256 && SAFE_ID.test(value);

const directoryIdentity = (stats: Awaited<ReturnType<RecordIoFileSystem['lstat']>>): string =>
  JSON.stringify([stats.isDirectory(), stats.isSymbolicLink(), stats.dev, stats.ino]);

const isPendingReferenceRequest = (
  value: unknown,
  projectId: string,
  requestId: string
): value is StudioReferenceRequest =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  Object.keys(value).length === REFERENCE_REQUEST_KEYS.size &&
  Object.keys(value).every((key) => REFERENCE_REQUEST_KEYS.has(key)) &&
  (value as Partial<StudioReferenceRequest>).schemaVersion === 1 &&
  (value as Partial<StudioReferenceRequest>).id === requestId &&
  requestId.length <= 256 &&
  SAFE_ID.test(requestId) &&
  (value as Partial<StudioReferenceRequest>).projectId === projectId &&
  (value as Partial<StudioReferenceRequest>).status === 'pending' &&
  typeof (value as Partial<StudioReferenceRequest>).sceneId === 'string' &&
  SAFE_ID.test((value as Partial<StudioReferenceRequest>).sceneId!) &&
  typeof (value as Partial<StudioReferenceRequest>).createdAt === 'string' &&
  !Number.isNaN(Date.parse((value as Partial<StudioReferenceRequest>).createdAt!));

/** Reads only bounded regular records to support best-effort cross-call deduplication. */
export const listPendingReferenceRequestSceneIds = async (
  pendingDir: string,
  projectId: string
): Promise<Set<string>> => {
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(pendingDir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return new Set();
    throw error;
  }
  const sceneIds = new Set<string>();
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    try {
      const file = path.join(pendingDir, entry.name);
      const requestId = entry.name.slice(0, -'.json'.length);
      // The queue is capped at 50 records, so bounded serial reads stay cheap.
      // eslint-disable-next-line no-await-in-loop
      const stats = await fs.lstat(file);
      if (stats.isSymbolicLink() || !stats.isFile() || stats.size > MAX_RECORD_BYTES) continue;
      // eslint-disable-next-line no-await-in-loop
      const value = JSON.parse(await fs.readFile(file, 'utf8')) as unknown;
      if (isPendingReferenceRequest(value, projectId, requestId)) sceneIds.add(value.sceneId);
    } catch {
      // Main owns authoritative validation; malformed records cannot establish dedup state.
    }
  }
  return sceneIds;
};

/** Reads only exact schema-2 request records; schema-1 sidecars never establish clip deduplication. */
export const listPendingReferenceRequestClipIdsV2 = async (
  pendingDir: string,
  projectId: string,
  injectedFs: RecordIoFileSystem = fs,
  projectAuthority?: StudioPendingProjectAuthorityV2
): Promise<Set<string>> => {
  let canonicalPendingDir: string;
  let pendingIdentity: string;
  let entries: import('node:fs').Dirent[];
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
    entries = await injectedFs.readdir(canonicalPendingDir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return new Set();
    throw error;
  }
  const clipIds = new Set<string>();
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    try {
      const file = path.join(canonicalPendingDir, entry.name);
      const requestId = entry.name.slice(0, -'.json'.length);
      // One no-follow descriptor binds validation to at most MAX_RECORD_BYTES from one inode.
      // eslint-disable-next-line no-await-in-loop
      const bytes = await readBoundedRegularFile({
        fs: injectedFs,
        canonicalRoot: canonicalPendingDir,
        file,
        maxBytes: MAX_RECORD_BYTES,
      });
      if (bytes === null) continue;
      const value = JSON.parse(bytes) as unknown;
      const parsed = parseStudioReferenceRequestV2({ projectId, requestId, value });
      if (parsed.status !== 'valid') continue;
      for (const clipId of parsed.record.clipIds) clipIds.add(clipId);
    } catch {
      // Main owns authoritative validation; malformed and V1 records cannot establish V2 dedup state.
    }
  }
  const finalPendingStats = await injectedFs.lstat(canonicalPendingDir);
  if (
    directoryIdentity(finalPendingStats) !== pendingIdentity ||
    directoryIdentity(await injectedFs.lstat(pendingDir)) !== pendingIdentity ||
    (await injectedFs.realpath(pendingDir)) !== canonicalPendingDir
  ) {
    throw new StudioPendingRecordWriteError('storage', 'Invalid schema-2 reference request queue');
  }
  if (projectAuthority !== undefined) {
    await assertPendingRecordProjectAuthorityV2({ pendingDir, projectAuthority, fs: injectedFs });
  }
  return clipIds;
};

export const writeReferenceRequestRecord = async (
  input: WriteReferenceRequestInput
): Promise<StudioReferenceRequest> => {
  const record: StudioReferenceRequest = {
    schemaVersion: 1,
    id: input.requestId ?? randomUUID(),
    projectId: input.projectId,
    sceneId: input.sceneId,
    status: 'pending',
    createdAt: new Date().toISOString(),
  };
  return writePendingRecord({
    pendingDir: input.pendingDir,
    recordId: record.id,
    record,
    slotRecordKey: 'requestId',
    capacityMessage: 'Reference request queue is full for this project',
    tooLargeMessage: 'Reference request exceeds the size cap',
  });
};

/** Writes one ordered schema-2 clip batch without starting generation. */
export const writeReferenceRequestRecordV2 = async (
  input: WriteReferenceRequestInputV2
): Promise<StudioReferenceRequestV2> => {
  let validated: { projectId: string; requestId: string | undefined; clipIds: string[] };
  try {
    const projectId = input.projectId;
    const requestId = input.requestId;
    const requestedClipIds = input.clipIds;
    if (
      !isSafeId(projectId) ||
      (requestId !== undefined && !isSafeId(requestId)) ||
      !Array.isArray(requestedClipIds) ||
      requestedClipIds.length < 1 ||
      requestedClipIds.length > STUDIO_MAX_REFERENCE_REQUEST_CLIPS ||
      Reflect.ownKeys(requestedClipIds).length !== requestedClipIds.length + 1
    ) {
      throw new StudioPendingRecordWriteError('storage', 'Invalid schema-2 reference request');
    }
    const seen = new Set<string>();
    for (let index = 0; index < requestedClipIds.length; index += 1) {
      if (!Object.hasOwn(requestedClipIds, index)) {
        throw new StudioPendingRecordWriteError('storage', 'Invalid schema-2 reference request');
      }
      const clipId = requestedClipIds[index];
      if (!isSafeId(clipId) || seen.has(clipId)) {
        throw new StudioPendingRecordWriteError('storage', 'Invalid schema-2 reference request');
      }
      seen.add(clipId);
    }
    const clipIds = [...requestedClipIds];
    const validationId = requestId ?? 'x'.repeat(256);
    const validation = parseStudioReferenceRequestV2({
      projectId,
      requestId: validationId,
      value: {
        schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
        id: validationId,
        projectId,
        clipIds,
        status: 'pending',
        createdAt: '1970-01-01T00:00:00.000Z',
      },
    });
    if (validation.status !== 'valid') {
      throw new StudioPendingRecordWriteError('storage', 'Invalid schema-2 reference request');
    }
    validated = { projectId: validation.record.projectId, requestId, clipIds: validation.record.clipIds };
  } catch (error) {
    if (error instanceof StudioPendingRecordWriteError) throw error;
    throw new StudioPendingRecordWriteError('storage', 'Invalid schema-2 reference request');
  }
  const record: StudioReferenceRequestV2 = {
    schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
    id: validated.requestId ?? randomUUID(),
    projectId: validated.projectId,
    clipIds: validated.clipIds,
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
};
