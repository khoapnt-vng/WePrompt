/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { StudioAspectRatio } from '@/common/types/project/creativeStudioTypes';
import {
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
});
