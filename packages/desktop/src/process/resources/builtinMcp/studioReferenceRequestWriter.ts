/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import type { StudioReferenceRequest } from '@/common/types/project/creativeStudioTypes';
import { writePendingRecord } from '@process/resources/builtinMcp/studioPendingRecordWriter';

export type WriteReferenceRequestInput = {
  pendingDir: string;
  projectId: string;
  sceneId: string;
  /** Test seam; production omits it and gets a UUID. */
  requestId?: string;
};

const MAX_RECORD_BYTES = 256 * 1024;
const SAFE_ID = /^[A-Za-z0-9_-]+$/;
const REFERENCE_REQUEST_KEYS = new Set(['schemaVersion', 'id', 'projectId', 'sceneId', 'status', 'createdAt']);

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
