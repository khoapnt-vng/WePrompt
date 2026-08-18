/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { createStudioLineHistoryId } from '@process/services/creative-studio/service/schema2/mutationIdentity';
import { describe, expect, it } from 'vitest';

describe('Creative Studio schema-2 mutation identity', () => {
  it('matches the frozen line-history identity vector', () => {
    expect(createStudioLineHistoryId('mutation_1', 2, 'shot_1', 0)).toBe(
      'history_6de52eed6dd73f96558ed4f600d761c3089082271dfc568ebfacdce5043bfc65'
    );
  });

  it('separates operation, shot, and entry identities', () => {
    const baseline = createStudioLineHistoryId('mutation_1', 0, 'shot_1', 0);

    expect(createStudioLineHistoryId('mutation_1', 1, 'shot_1', 0)).not.toBe(baseline);
    expect(createStudioLineHistoryId('mutation_1', 0, 'shot_2', 0)).not.toBe(baseline);
    expect(createStudioLineHistoryId('mutation_1', 0, 'shot_1', 1)).not.toBe(baseline);
  });

  it.each([
    ['', 0, 'shot_1', 0],
    ['mutation/1', 0, 'shot_1', 0],
    ['mutation_1', -1, 'shot_1', 0],
    ['mutation_1', 0.5, 'shot_1', 0],
    ['mutation_1', 0, '__bad/shot', 0],
    ['mutation_1', 0, 'shot_1', Number.MAX_SAFE_INTEGER + 1],
  ] as const)('rejects noncanonical identity input %#', (mutationId, operationIndex, shotId, entryIndex) => {
    expect(() => createStudioLineHistoryId(mutationId, operationIndex, shotId, entryIndex)).toThrow(TypeError);
  });
});
