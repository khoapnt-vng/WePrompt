/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { StudioAspectRatio } from '@/common/types/project/creativeStudioTypes';

const firstFramePromptPrefix = (aspectRatio: StudioAspectRatio): string =>
  `A single cinematic frame, ${aspectRatio}, no text, no labels, no collage, no split panels.`;

export const buildFirstFramePrompt = (visualPrompt: string, aspectRatio: StudioAspectRatio): string =>
  `${firstFramePromptPrefix(aspectRatio)} ${visualPrompt.trim()}`;

export const hasFirstFramePromptSubject = (prompt: string, aspectRatio: StudioAspectRatio): boolean => {
  const trimmedPrompt = prompt.trim();
  return trimmedPrompt.length > 0 && trimmedPrompt !== firstFramePromptPrefix(aspectRatio);
};
