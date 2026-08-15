/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { StudioAspectRatio } from '@/common/types/project/creativeStudioTypes';
import {
  buildConditionedFirstFramePrompt,
  buildFirstFramePrompt,
  stripFirstFramePromptPrefix,
} from '@/common/types/project/creativeStudioReferencePrompt';
import { describe, expect, it } from 'vitest';

const aspectRatios: readonly StudioAspectRatio[] = ['16:9', '9:16', '1:1', '4:3', '3:4'];
const subjects = [
  'A red bicycle leaning on a wall at dawn',
  '  Một chiếc thuyền trên sông lúc hoàng hôn  ',
  'A cinematic frame inside a gallery',
];

describe('Studio reference prompt', () => {
  it.each(aspectRatios)('round-trips authored subjects for %s', (aspectRatio) => {
    subjects.forEach((subject) => {
      expect(stripFirstFramePromptPrefix(buildFirstFramePrompt(subject, aspectRatio), aspectRatio)).toBe(
        subject.trim()
      );
    });
  });

  it.each([
    {
      label: 'cast-only',
      roles: ['cast', 'cast'] as const,
      instruction: 'Conditioning image positions 1-2 are cast references.',
    },
    {
      label: 'look-only',
      roles: ['look', 'look'] as const,
      instruction: 'Conditioning image positions 1-2 are look references.',
    },
    {
      label: 'mixed cast-then-look',
      roles: ['cast', 'cast', 'look'] as const,
      instruction:
        'Conditioning image positions 1-2 are cast references. Conditioning image position 3 is a look reference.',
    },
  ])('describes exact $label positions without local reference metadata', ({ roles, instruction }) => {
    const prompt = buildConditionedFirstFramePrompt('A hero crosses a neon city', '16:9', roles);

    expect(prompt).toBe(
      `A single cinematic frame, 16:9, no text, no labels, no collage, no split panels. A hero crosses a neon city ${instruction}`
    );
    expect(prompt).not.toContain('Hero headshot.png');
    expect(prompt).not.toContain('/managed/imports');
  });

  it('does not add a positional instruction when there are no references', () => {
    expect(buildConditionedFirstFramePrompt('A hero crosses a neon city', '16:9', [])).toBe(
      buildFirstFramePrompt('A hero crosses a neon city', '16:9')
    );
  });
});
