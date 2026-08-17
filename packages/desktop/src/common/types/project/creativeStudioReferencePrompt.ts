/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { StudioAspectRatio, StudioBriefReferenceRole } from '@/common/types/project/creativeStudioTypes';

export const firstFramePromptPrefix = (aspectRatio: StudioAspectRatio): string =>
  `A single cinematic frame, ${aspectRatio}, no text, no labels, no collage, no split panels.`;

export const buildFirstFramePrompt = (visualPrompt: string, aspectRatio: StudioAspectRatio): string =>
  `${firstFramePromptPrefix(aspectRatio)} ${visualPrompt.trim()}`;

const positionInstruction = (role: StudioBriefReferenceRole, firstPosition: number, lastPosition: number): string =>
  firstPosition === lastPosition
    ? `Conditioning image position ${firstPosition} is a ${role} reference.`
    : `Conditioning image positions ${firstPosition}-${lastPosition} are ${role} references.`;

/** Adds provider-facing positional roles without leaking local labels, paths, or managed identities. */
export const buildConditionedFirstFramePrompt = (
  visualPrompt: string,
  aspectRatio: StudioAspectRatio,
  roles: readonly StudioBriefReferenceRole[]
): string => {
  const prompt = buildFirstFramePrompt(visualPrompt, aspectRatio);
  if (roles.length === 0) return prompt;
  const instructions: string[] = [];
  for (let start = 0; start < roles.length; ) {
    const role = roles[start]!;
    let end = start;
    while (end + 1 < roles.length && roles[end + 1] === role) end += 1;
    instructions.push(positionInstruction(role, start + 1, end + 1));
    start = end + 1;
  }
  return `${prompt} ${instructions.join(' ')}`;
};

export const stripFirstFramePromptPrefix = (prompt: string, aspectRatio: StudioAspectRatio): string => {
  const trimmedPrompt = prompt.trim();
  const prefix = firstFramePromptPrefix(aspectRatio);
  if (trimmedPrompt === prefix) return '';
  return trimmedPrompt.startsWith(`${prefix} `) ? trimmedPrompt.slice(prefix.length + 1).trim() : trimmedPrompt;
};

export const hasFirstFramePromptSubject = (prompt: string, aspectRatio: StudioAspectRatio): boolean => {
  const trimmedPrompt = prompt.trim();
  return trimmedPrompt.length > 0 && trimmedPrompt !== firstFramePromptPrefix(aspectRatio);
};
