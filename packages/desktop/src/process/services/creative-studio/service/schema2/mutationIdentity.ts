/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash } from 'node:crypto';

const SAFE_ID = /^[A-Za-z0-9_-]{1,256}$/;
const LINE_HISTORY_DOMAIN = 'creative-studio/line-history/v1';

const assertSafeId = (value: string, label: string): void => {
  if (!SAFE_ID.test(value)) throw new TypeError(`Invalid ${label}`);
};

const assertCanonicalIndex = (value: number, label: string): void => {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`Invalid ${label}`);
};

/** Creates the deterministic identity for one authored line-history capture. */
export const createStudioLineHistoryId = (
  mutationId: string,
  operationIndex: number,
  shotId: string,
  entryIndex: number
): string => {
  assertSafeId(mutationId, 'mutation id');
  assertCanonicalIndex(operationIndex, 'operation index');
  assertSafeId(shotId, 'shot id');
  assertCanonicalIndex(entryIndex, 'entry index');

  const input = [
    LINE_HISTORY_DOMAIN,
    mutationId,
    Number.prototype.toString.call(operationIndex),
    shotId,
    Number.prototype.toString.call(entryIndex),
  ].join('\0');
  return `history_${createHash('sha256').update(input, 'utf8').digest('hex')}`;
};
