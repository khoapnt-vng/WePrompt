/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

// Subprocess-side writer for the Studio proposal inbox. Implements the disk
// contract the main-process store enforces on read: an O_EXCL slot file caps
// pending records per project, and an exclusive record write prevents an id
// from ever being overwritten. Main re-validates every record on read.

import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import type { StudioProposal, StudioProposalPayload } from '@/common/types/project/creativeStudioTypes';

const MAX_RECORD_BYTES = 256 * 1024;
const MAX_PENDING_PER_PROJECT = 50;

export type StudioProposalWriteErrorCode = 'capacity' | 'too_large' | 'storage';

export class StudioProposalWriteError extends Error {
  constructor(
    public readonly code: StudioProposalWriteErrorCode,
    message: string
  ) {
    super(message);
  }
}

export type WriteProposalInput = {
  pendingDir: string;
  projectId: string;
  baseRevision: number;
  payload: StudioProposalPayload;
  /** Test seam; production omits it and gets a UUID. */
  proposalId?: string;
};

const slotsDirOf = (pendingDir: string): string => path.join(path.dirname(pendingDir), 'slots');

const reserveSlot = async (slotsDir: string, proposalId: string): Promise<string> => {
  const reservation = JSON.stringify({ schemaVersion: 1, proposalId, reservedAt: new Date().toISOString() });
  for (let index = 0; index < MAX_PENDING_PER_PROJECT; index += 1) {
    const file = path.join(slotsDir, `${index}.slot`);
    let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
    try {
      handle = await fs.open(file, 'wx');
      await handle.writeFile(reservation, { encoding: 'utf8' });
      await handle.sync();
      return file;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') continue;
      throw new StudioProposalWriteError('storage', error instanceof Error ? error.message : 'slot write failed');
    } finally {
      await handle?.close().catch((): undefined => undefined);
    }
  }
  throw new StudioProposalWriteError('capacity', 'Proposal inbox is full for this project');
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
  const serialized = JSON.stringify(record);
  if (Buffer.byteLength(serialized, 'utf8') > MAX_RECORD_BYTES) {
    throw new StudioProposalWriteError('too_large', 'Proposal record exceeds the size cap');
  }

  const slotsDir = slotsDirOf(input.pendingDir);
  const slotFile = await reserveSlot(slotsDir, record.id);
  const file = path.join(input.pendingDir, `${record.id}.json`);
  const temporaryFile = `${file}.${process.pid}.tmp`;
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
  try {
    handle = await fs.open(temporaryFile, 'wx');
    await handle.writeFile(serialized, { encoding: 'utf8' });
    await handle.sync();
    await handle.close();
    handle = undefined;
    await fs.link(temporaryFile, file);
    await fs.rm(temporaryFile);
    return record;
  } catch (error) {
    await handle?.close().catch((): undefined => undefined);
    await fs.rm(temporaryFile, { force: true }).catch((): undefined => undefined);
    await fs.rm(slotFile, { force: true }).catch((): undefined => undefined);
    throw new StudioProposalWriteError('storage', error instanceof Error ? error.message : 'record write failed');
  }
};
