/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import {
  STUDIO_MAX_REFERENCE_REQUEST_SHOTS,
  STUDIO_PROJECT_SCHEMA_VERSION,
  STUDIO_REFERENCE_REQUEST_V2_MAX_PENDING_PER_PROJECT,
  STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
  STUDIO_REFERENCE_REQUEST_V2_PENDING_TTL_MS,
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
import {
  parseStudioReferenceRequestSlotV2,
  parseStudioReferenceRequestV2,
} from '@process/services/creative-studio/service/directorCommandContracts';
import {
  readBoundedRegularFileWithIdentity,
  type RecordIoFileSystem,
} from '@process/services/creative-studio/service/recordIo';

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
  shotIds: string[];
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

/** Reads only exact schema-2 request records; schema-1 sidecars never establish shot deduplication. */
export const listPendingReferenceRequestShotIdsV2 = async (
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
  const shotIds = new Set<string>();
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
      for (const shotId of parsed.record.shotIds) shotIds.add(shotId);
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
  return shotIds;
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

/** Writes one ordered schema-2 shot batch without starting generation. */
export const writeReferenceRequestRecordV2 = async (
  input: WriteReferenceRequestInputV2
): Promise<StudioReferenceRequestV2> => {
  let validated: { projectId: string; requestId: string | undefined; shotIds: string[] };
  try {
    const projectId = input.projectId;
    const requestId = input.requestId;
    const requestedShotIds = input.shotIds;
    if (
      !isSafeId(projectId) ||
      (requestId !== undefined && !isSafeId(requestId)) ||
      !Array.isArray(requestedShotIds) ||
      requestedShotIds.length < 1 ||
      requestedShotIds.length > STUDIO_MAX_REFERENCE_REQUEST_SHOTS ||
      Reflect.ownKeys(requestedShotIds).length !== requestedShotIds.length + 1
    ) {
      throw new StudioPendingRecordWriteError('storage', 'Invalid schema-2 reference request');
    }
    const seen = new Set<string>();
    for (let index = 0; index < requestedShotIds.length; index += 1) {
      if (!Object.hasOwn(requestedShotIds, index)) {
        throw new StudioPendingRecordWriteError('storage', 'Invalid schema-2 reference request');
      }
      const shotId = requestedShotIds[index];
      if (!isSafeId(shotId) || seen.has(shotId)) {
        throw new StudioPendingRecordWriteError('storage', 'Invalid schema-2 reference request');
      }
      seen.add(shotId);
    }
    const shotIds = [...requestedShotIds];
    const validationId = requestId ?? 'x'.repeat(256);
    const validation = parseStudioReferenceRequestV2({
      projectId,
      requestId: validationId,
      value: {
        schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
        id: validationId,
        projectId,
        shotIds,
        status: 'pending',
        createdAt: '1970-01-01T00:00:00.000Z',
      },
    });
    if (validation.status !== 'valid') {
      throw new StudioPendingRecordWriteError('storage', 'Invalid schema-2 reference request');
    }
    validated = { projectId: validation.record.projectId, requestId, shotIds: validation.record.shotIds };
  } catch (error) {
    if (error instanceof StudioPendingRecordWriteError) throw error;
    throw new StudioPendingRecordWriteError('storage', 'Invalid schema-2 reference request');
  }
  const record: StudioReferenceRequestV2 = {
    schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
    id: validated.requestId ?? randomUUID(),
    projectId: validated.projectId,
    shotIds: validated.shotIds,
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
