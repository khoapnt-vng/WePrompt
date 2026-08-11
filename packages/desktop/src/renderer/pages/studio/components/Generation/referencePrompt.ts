/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { StudioAspectRatio } from '@/common/types/project/creativeStudioTypes';

export const buildFirstFramePrompt = (visualPrompt: string, aspectRatio: StudioAspectRatio): string =>
  `A single cinematic frame, ${aspectRatio}, no text, no labels, no collage, no split panels. ${visualPrompt.trim()}`;
