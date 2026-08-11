/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomUUID } from 'node:crypto';
import type { StudioProposal, StudioProposalPayload } from '@/common/types/project/creativeStudioTypes';
import {
  StudioPendingRecordWriteError,
  type StudioPendingRecordWriteErrorCode,
  writePendingRecord,
} from '@process/resources/builtinMcp/studioPendingRecordWriter';

export { StudioPendingRecordWriteError as StudioProposalWriteError };
export type StudioProposalWriteErrorCode = StudioPendingRecordWriteErrorCode;

export type WriteProposalInput = {
  pendingDir: string;
  projectId: string;
  baseRevision: number;
  payload: StudioProposalPayload;
  /** Test seam; production omits it and gets a UUID. */
  proposalId?: string;
};

export const writeProposalRecord = async (input: WriteProposalInput): Promise<StudioProposal> => {
  const record: StudioProposal = {
    schemaVersion: 1,
    id: input.proposalId ?? randomUUID(),
    projectId: input.projectId,
    status: 'pending',
    baseRevision: input.baseRevision,
    payload: input.payload,
    createdAt: new Date().toISOString(),
    decidedAt: null,
  };
  return writePendingRecord({
    pendingDir: input.pendingDir,
    recordId: record.id,
    record,
    slotRecordKey: 'proposalId',
    capacityMessage: 'Proposal inbox is full for this project',
    tooLargeMessage: 'Proposal record exceeds the size cap',
  });
};
