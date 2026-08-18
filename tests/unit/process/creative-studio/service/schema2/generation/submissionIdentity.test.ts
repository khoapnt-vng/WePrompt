/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest';
import { createStudioQuotedGenerationId } from '@/process/services/creative-studio/service/schema2/generation/submissionIdentity';

describe('createStudioQuotedGenerationId', () => {
  it('matches the frozen quote-item vector', () => {
    expect(
      createStudioQuotedGenerationId({
        projectId: 'project_1',
        projectRevision: 7,
        shotId: 'shot_1',
        purpose: 'video_take',
      })
    ).toBe('item_bf91f6360d990f6083c2e7c754fcd431a657e84f4f20220a9305b4104a5fcbfe');
  });

  it('keeps sibling quote options on the same deterministic item identity', () => {
    const input = { projectId: 'project_1', projectRevision: 7, shotId: 'shot_1', purpose: 'seed_still' } as const;

    expect(createStudioQuotedGenerationId(input)).toBe(createStudioQuotedGenerationId({ ...input }));
  });

  it.each([
    [{ projectId: '../project', projectRevision: 7, shotId: 'shot_1', purpose: 'video_take' }, TypeError],
    [{ projectId: 'project_1', projectRevision: 0, shotId: 'shot_1', purpose: 'video_take' }, RangeError],
    [
      { projectId: 'project_1', projectRevision: Number.MAX_SAFE_INTEGER + 1, shotId: 'shot_1', purpose: 'video_take' },
      RangeError,
    ],
    [{ projectId: 'project_1', projectRevision: 7, shotId: 'shot/1', purpose: 'video_take' }, TypeError],
    [{ projectId: 'project_1', projectRevision: 7, shotId: 'shot_1', purpose: 'unknown' }, TypeError],
  ] as const)('rejects invalid quote identity input %#', (input, errorType) => {
    expect(() => createStudioQuotedGenerationId(input as never)).toThrow(errorType);
  });
});
