/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomUUID } from 'node:crypto';
import type { StudioReferenceRequest } from '@/common/types/project/creativeStudioTypes';
import { writePendingRecord } from '@process/resources/builtinMcp/studioPendingRecordWriter';

export type WriteReferenceRequestInput = {
  pendingDir: string;
  projectId: string;
  sceneId: string;
  /** Test seam; production omits it and gets a UUID. */
  requestId?: string;
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
