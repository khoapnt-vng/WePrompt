/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest';
import { createStudioFrameExtractionId } from '@/process/services/creative-studio/service/schema2/generation/frameExtraction';

describe('createStudioFrameExtractionId', () => {
  it('matches the frozen canonical endpoint vector', () => {
    expect(createStudioFrameExtractionId({ shotId: 'shot_1', takeAssetId: 'take_1', endpointSeconds: 8 })).toBe(
      'frame_0a087cffc07fb3b12302860164c56b5a160c509171b8ebbb19b3bf7c8876c0d1'
    );
  });

  it('changes when any canonical input changes', () => {
    const baseline = createStudioFrameExtractionId({ shotId: 'shot_1', takeAssetId: 'take_1', endpointSeconds: 8 });

    expect(
      new Set([
        baseline,
        createStudioFrameExtractionId({ shotId: 'shot_2', takeAssetId: 'take_1', endpointSeconds: 8 }),
        createStudioFrameExtractionId({ shotId: 'shot_1', takeAssetId: 'take_2', endpointSeconds: 8 }),
        createStudioFrameExtractionId({ shotId: 'shot_1', takeAssetId: 'take_1', endpointSeconds: 8.5 }),
      ])
    ).toHaveLength(4);
  });

  it.each([
    [{ shotId: '../shot', takeAssetId: 'take_1', endpointSeconds: 8 }, TypeError],
    [{ shotId: 'shot_1', takeAssetId: 'take/1', endpointSeconds: 8 }, TypeError],
    [{ shotId: 'shot_1', takeAssetId: 'take_1', endpointSeconds: 0 }, RangeError],
    [{ shotId: 'shot_1', takeAssetId: 'take_1', endpointSeconds: Number.NaN }, RangeError],
    [{ shotId: 'shot_1', takeAssetId: 'take_1', endpointSeconds: Number.MAX_SAFE_INTEGER + 1 }, RangeError],
  ] as const)('rejects invalid canonical input %#', (input, errorType) => {
    expect(() => createStudioFrameExtractionId(input)).toThrow(errorType);
  });
});
