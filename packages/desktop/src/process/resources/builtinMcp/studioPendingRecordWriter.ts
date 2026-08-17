/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs/promises';
import path from 'node:path';

// Shared subprocess-side disk contract: an O_EXCL slot caps pending records,
// an exclusive write prevents replacement, and main re-validates every record.
const MAX_RECORD_BYTES = 256 * 1024;
const MAX_PENDING_PER_PROJECT = 50;

export type StudioPendingRecordWriteErrorCode = 'capacity' | 'too_large' | 'storage';

export class StudioPendingRecordWriteError extends Error {
  constructor(
    public readonly code: StudioPendingRecordWriteErrorCode,
    message: string
  ) {
    super(message);
  }
}

type WritePendingRecordInput<RecordType> = {
  pendingDir: string;
  recordId: string;
  record: RecordType;
  // Proposal slots must retain proposalId for the main-process validateProposalSlot contract.
  slotRecordKey: 'proposalId' | 'requestId';
  capacityMessage: string;
  tooLargeMessage: string;
};

const slotsDirOf = (pendingDir: string): string => path.join(path.dirname(pendingDir), 'slots');

const reserveSlot = async (
  slotsDir: string,
  recordId: string,
  slotRecordKey: WritePendingRecordInput<unknown>['slotRecordKey'],
  capacityMessage: string
): Promise<string> => {
  const reservation = JSON.stringify({
    schemaVersion: 1,
    [slotRecordKey]: recordId,
    reservedAt: new Date().toISOString(),
  });
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
      throw new StudioPendingRecordWriteError('storage', error instanceof Error ? error.message : 'slot write failed');
    } finally {
      await handle?.close().catch((): undefined => undefined);
    }
  }
  throw new StudioPendingRecordWriteError('capacity', capacityMessage);
};

/** Publishes one bounded immutable record after atomically reserving queue capacity. */
export const writePendingRecord = async <RecordType>(
  input: WritePendingRecordInput<RecordType>
): Promise<RecordType> => {
  const serialized = JSON.stringify(input.record);
  if (Buffer.byteLength(serialized, 'utf8') > MAX_RECORD_BYTES) {
    throw new StudioPendingRecordWriteError('too_large', input.tooLargeMessage);
  }

  const slotFile = await reserveSlot(
    slotsDirOf(input.pendingDir),
    input.recordId,
    input.slotRecordKey,
    input.capacityMessage
  );
  const file = path.join(input.pendingDir, `${input.recordId}.json`);
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
    return input.record;
  } catch (error) {
    await handle?.close().catch((): undefined => undefined);
    await fs.rm(temporaryFile, { force: true }).catch((): undefined => undefined);
    await fs.rm(slotFile, { force: true }).catch((): undefined => undefined);
    throw new StudioPendingRecordWriteError('storage', error instanceof Error ? error.message : 'record write failed');
  }
};
