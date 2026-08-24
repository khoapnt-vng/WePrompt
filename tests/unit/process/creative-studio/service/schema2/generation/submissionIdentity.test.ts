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
    ).toBe('item_46549f5822c48d16941795e360a3cb1ecb580f0528d6131d7405a71c5a67e42f');
  });

  it('keeps sibling quote options on the same deterministic item identity', () => {
    const input = { projectId: 'project_1', projectRevision: 7, shotId: 'shot_1', purpose: 'seed_still' } as const;

    expect(createStudioQuotedGenerationId(input)).toBe(createStudioQuotedGenerationId({ ...input }));
  });

  it('gives a Board item its own frozen purpose identity', () => {
    expect(
      createStudioQuotedGenerationId({
        projectId: 'project_1',
        projectRevision: 7,
        shotId: 'shot_1',
        purpose: 'board_still',
      })
    ).toBe('item_70b23caff1d33a7951aac019540ebc609d97ac3f6008631fc9a5a77036a313fb');
  });

  it('keeps two project references sharing one proxy Shot in separate item namespaces', () => {
    const base = {
      projectId: 'project_1',
      projectRevision: 7,
      shotId: 'shot_1',
      purpose: 'seed_still' as const,
    };
    expect(createStudioQuotedGenerationId({ ...base, projectReferenceId: 'reference_ming' })).not.toBe(
      createStudioQuotedGenerationId({ ...base, projectReferenceId: 'reference_mei' })
    );
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
