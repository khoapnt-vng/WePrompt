/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomUUID } from 'node:crypto';
import type { StudioProposalPayloadV2, StudioProposalRecordV2 } from '@/common/types/project/creativeStudioTypes';
import { STUDIO_PROPOSAL_SCHEMA_VERSION_V2 } from '@/common/types/project/creativeStudioTypes';
import {
  StudioPendingRecordWriteError,
  type StudioPendingProjectAuthorityV2,
  type StudioPendingRecordWriteErrorCode,
  writePendingRecordV2,
} from '@process/resources/builtinMcp/studioPendingRecordWriter';
import { parseStudioProposalRecordV2 } from '@process/services/creative-studio/service/director/contracts';
import type { RecordIoFileSystem } from '@process/services/creative-studio/service/recordIo';

export { StudioPendingRecordWriteError as StudioProposalWriteError };
export type StudioProposalWriteErrorCode = StudioPendingRecordWriteErrorCode;

export type WriteProposalInputV2 = {
  pendingDir: string;
  projectId: string;
  baseRevision: number;
  payload: StudioProposalPayloadV2;
  /** Test seam; production omits it and gets a UUID. */
  proposalId?: string;
  /** Test seam for V2 identity and publication races. */
  fs?: RecordIoFileSystem;
  /** Main-owned clock seam; omitted by the Director-side writer. */
  now?: () => Date;
  /** Reasserts the exact manifest authority around V2 sidecar publication. */
  authorityFence?: () => Promise<'valid' | 'unsupported_prototype_schema' | 'invalid'>;
  projectAuthority: StudioPendingProjectAuthorityV2;
};

/** Writes one validated schema-2 proposal without mutating project state. */
export const writeProposalRecordV2 = async (input: WriteProposalInputV2): Promise<StudioProposalRecordV2> => {
  let createdAt: string;
  try {
    createdAt = (input.now?.() ?? new Date()).toISOString();
  } catch {
    throw new StudioPendingRecordWriteError('storage', 'Invalid schema-2 proposal');
  }
  let validated: {
    projectId: string;
    proposalId: string | undefined;
    baseRevision: number;
    payload: StudioProposalPayloadV2;
  };
  try {
    const proposalId = input.proposalId;
    // Use the largest contract-valid generated id so validation remains conservative before UUID
    // generation or any filesystem side effect.
    const validationId = proposalId ?? 'x'.repeat(256);
    const validation = parseStudioProposalRecordV2({
      projectId: input.projectId,
      proposalId: validationId,
      value: {
        schemaVersion: STUDIO_PROPOSAL_SCHEMA_VERSION_V2,
        id: validationId,
        projectId: input.projectId,
        status: 'pending',
        baseRevision: input.baseRevision,
        payload: input.payload,
        createdAt,
        decidedAt: null,
      },
    });
    if (validation.status !== 'valid') {
      throw new StudioPendingRecordWriteError('storage', 'Invalid schema-2 proposal');
    }
    validated = {
      projectId: validation.record.projectId,
      proposalId,
      baseRevision: validation.record.baseRevision,
      payload: validation.record.payload,
    };
  } catch {
    throw new StudioPendingRecordWriteError('storage', 'Invalid schema-2 proposal');
  }
  const record: StudioProposalRecordV2 = {
    schemaVersion: STUDIO_PROPOSAL_SCHEMA_VERSION_V2,
    id: validated.proposalId ?? randomUUID(),
    projectId: validated.projectId,
    status: 'pending',
    baseRevision: validated.baseRevision,
    payload: validated.payload,
    createdAt,
    decidedAt: null,
  };
  const canonical = parseStudioProposalRecordV2({
    projectId: validated.projectId,
    proposalId: record.id,
    value: record,
  });
  if (canonical.status !== 'valid') {
    throw new StudioPendingRecordWriteError('storage', 'Invalid schema-2 proposal');
  }
  return writePendingRecordV2({
    pendingDir: input.pendingDir,
    recordId: canonical.record.id,
    record: canonical.record,
    slotRecordKey: 'proposalId',
    capacityMessage: 'Proposal inbox is full for this project',
    tooLargeMessage: 'Proposal record exceeds the size cap',
    fs: input.fs,
    authorityFence: input.authorityFence,
    projectAuthority: input.projectAuthority,
  });
};
