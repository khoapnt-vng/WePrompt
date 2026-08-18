/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash } from 'node:crypto';

const SAFE_STUDIO_ID = /^[A-Za-z0-9_-]{1,256}$/;
const FRAME_EXTRACTION_ID_NAMESPACE = 'creative-studio/frame-extraction/v1';

export type StudioFrameExtractionIdentityInput = {
  shotId: string;
  takeAssetId: string;
  endpointSeconds: number;
};

const assertSafeId = (value: string, field: string): void => {
  if (!SAFE_STUDIO_ID.test(value)) throw new TypeError(`${field} must be a safe Studio ID`);
};

/** Returns the deterministic identity of one exact take endpoint extraction. */
export const createStudioFrameExtractionId = (input: StudioFrameExtractionIdentityInput): string => {
  assertSafeId(input.shotId, 'shotId');
  assertSafeId(input.takeAssetId, 'takeAssetId');
  if (
    !Number.isFinite(input.endpointSeconds) ||
    input.endpointSeconds <= 0 ||
    input.endpointSeconds > Number.MAX_SAFE_INTEGER ||
    Object.is(input.endpointSeconds, -0)
  ) {
    throw new RangeError('endpointSeconds must be finite, positive, and no greater than Number.MAX_SAFE_INTEGER');
  }
  const canonical = [
    FRAME_EXTRACTION_ID_NAMESPACE,
    input.shotId,
    input.takeAssetId,
    Number.prototype.toString.call(input.endpointSeconds),
  ].join('\0');
  return `frame_${createHash('sha256').update(canonical, 'utf8').digest('hex')}`;
};
