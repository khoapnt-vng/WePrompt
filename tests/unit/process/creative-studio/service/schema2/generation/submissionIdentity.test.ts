/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest';
import {
  createStudioAutomaticReferenceRetryJobId,
  createStudioAutomaticVideoRetryJobId,
  createStudioQuotedGenerationId,
} from '@/process/services/creative-studio/service/schema2/generation/submissionIdentity';

describe('createStudioQuotedGenerationId', () => {
  it('matches the frozen quote-item vector', () => {
    expect(
      createStudioQuotedGenerationId({
        projectId: 'project_1',
        projectRevision: 7,
        target: { kind: 'shot', shotId: 'shot_1' },
        purpose: 'video_take',
      })
    ).toBe('item_4ce18f1fe50f45c89e006a4ea5159289a83e10aae0441c03dc6d0e159a1f74de');
  });

  it('keeps sibling quote options on the same deterministic item identity', () => {
    const input = {
      projectId: 'project_1',
      projectRevision: 7,
      target: { kind: 'shot', shotId: 'shot_1' },
      purpose: 'seed_still',
    } as const;

    expect(createStudioQuotedGenerationId(input)).toBe(createStudioQuotedGenerationId({ ...input }));
  });

  it('gives a Board item its own frozen purpose identity', () => {
    expect(
      createStudioQuotedGenerationId({
        projectId: 'project_1',
        projectRevision: 7,
        target: { kind: 'shot', shotId: 'shot_1' },
        purpose: 'board_still',
      })
    ).toBe('item_3591305b656e0aabcac0ed7ed1938a20a4ed148c43c8885303dfa45f3aac9fe7');
  });

  it('keeps two semantic references in separate item namespaces', () => {
    const base = {
      projectId: 'project_1',
      projectRevision: 7,
      purpose: 'reference_image' as const,
    };
    expect(
      createStudioQuotedGenerationId({
        ...base,
        target: { kind: 'reference', referenceId: 'reference_ming' },
      })
    ).not.toBe(
      createStudioQuotedGenerationId({
        ...base,
        target: { kind: 'reference', referenceId: 'reference_mei' },
      })
    );
  });

  it.each([
    [
      {
        projectId: '../project',
        projectRevision: 7,
        target: { kind: 'shot', shotId: 'shot_1' },
        purpose: 'video_take',
      },
      TypeError,
    ],
    [
      {
        projectId: 'project_1',
        projectRevision: 0,
        target: { kind: 'shot', shotId: 'shot_1' },
        purpose: 'video_take',
      },
      RangeError,
    ],
    [
      {
        projectId: 'project_1',
        projectRevision: Number.MAX_SAFE_INTEGER + 1,
        target: { kind: 'shot', shotId: 'shot_1' },
        purpose: 'video_take',
      },
      RangeError,
    ],
    [
      {
        projectId: 'project_1',
        projectRevision: 7,
        target: { kind: 'shot', shotId: 'shot/1' },
        purpose: 'video_take',
      },
      TypeError,
    ],
    [
      {
        projectId: 'project_1',
        projectRevision: 7,
        target: { kind: 'shot', shotId: 'shot_1' },
        purpose: 'unknown',
      },
      TypeError,
    ],
  ] as const)('rejects invalid quote identity input %#', (input, errorType) => {
    expect(() => createStudioQuotedGenerationId(input as never)).toThrow(errorType);
  });
});

describe('createStudioAutomaticVideoRetryJobId', () => {
  it('matches its frozen identity vector without colliding with reference retries', () => {
    const input = {
      authorizationId: 'authorization_1',
      itemId: 'item_1',
      idempotencyKey: 'key_2',
    };

    expect(createStudioAutomaticVideoRetryJobId(input)).toBe(
      'job_477b4e48919e0e4f30fcd49654f39ae113f9a4add44e8de468daa5bbca6a9203'
    );
    expect(createStudioAutomaticVideoRetryJobId(input)).not.toBe(createStudioAutomaticReferenceRetryJobId(input));
  });

  it('rejects unsafe persisted identity fields', () => {
    expect(() =>
      createStudioAutomaticVideoRetryJobId({
        authorizationId: '../authorization',
        itemId: 'item_1',
        idempotencyKey: 'key_2',
      })
    ).toThrow(TypeError);
  });
});
