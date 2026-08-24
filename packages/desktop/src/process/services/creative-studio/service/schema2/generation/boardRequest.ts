/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { renderStudioRulesBlock } from '@/common/types/project/creativeStudioRules';
import {
  STUDIO_BOARD_STYLES_V2,
  STUDIO_MAX_GENERATION_PROMPT_LENGTH,
  type StudioAspectRatio,
  type StudioBoardStyleV2,
  type StudioBriefRule,
  type StudioProjectV2,
  type StudioGenerationRequestPlan,
  type StudioGenerationRequestTemplate,
  type StudioResolution,
} from '@/common/types/project/creativeStudioTypes';
import { createStudioResolvedGenerationRequestPlan } from './generationRequest';

/** Board image requests use a fixed plumbing duration independent from video Shot limits. */
export const STUDIO_BOARD_REQUEST_DURATION_SECONDS = 4;

const BOARD_STYLE_INSTRUCTIONS: Readonly<Record<StudioBoardStyleV2, string>> = {
  grey_tone: 'Restrained grey-tone storyboard drawing with clear staging and silhouettes.',
  line_art: 'Clean line-art storyboard with sparse shading and clear staging and silhouettes.',
  colour_key: 'Simplified colour-key storyboard with a limited palette and clear staging and silhouettes.',
};

export type StudioBoardGenerationPromptInput = {
  brief: string;
  rules: readonly StudioBriefRule[];
  action: string;
  look: string;
  line: string;
  style: StudioBoardStyleV2;
};

export type StudioBoardGenerationRequestInput = StudioBoardGenerationPromptInput & {
  aspectRatio: StudioAspectRatio;
  resolution: StudioResolution;
};

export type StudioBoardGenerationRequestForShotInput = {
  project: Pick<StudioProjectV2, 'brief' | 'rules' | 'boardStyle' | 'aspectRatio' | 'resolution'>;
  beat: { action: string; look: string };
  shot: { line: string };
};

const boardStyleInstruction = (style: StudioBoardStyleV2): string => {
  if (!STUDIO_BOARD_STYLES_V2.includes(style)) throw new TypeError('style is not a Studio Board style');
  return BOARD_STYLE_INSTRUCTIONS[style];
};

/** Composes the exact one-panel Board prompt frozen into spend authority. */
export const composeStudioBoardGenerationPrompt = (input: StudioBoardGenerationPromptInput): string => {
  const brief = input.brief.trim();
  const rules = renderStudioRulesBlock(input.rules).trim();
  const action = input.action.trim();
  const look = input.look.trim();
  const line = input.line.trim();
  const treatment = boardStyleInstruction(input.style);
  const sections = [
    ...(brief.length === 0 ? [] : [`BRIEF\n${brief}`]),
    ...(rules.length === 0 ? [] : [rules]),
    ...(action.length === 0 ? [] : [`ACTION\n${action}`]),
    ...(look.length === 0 ? [] : [`LOOK\n${look}`]),
    ...(line.length === 0 ? [] : [`SHOT\n${line}`]),
    `BOARD DRAWING\n${treatment} The drawing medium must not alter the authored LOOK.`,
    'OUTPUT\nCreate exactly one production storyboard panel for exactly this Shot. Do not create a grid, contact sheet, split frame, caption, label, border, or UI.',
  ];
  const prompt = sections.join('\n\n');
  if (prompt.length === 0 || prompt.length > STUDIO_MAX_GENERATION_PROMPT_LENGTH) {
    throw new RangeError('composed Board prompt is empty or exceeds the generation prompt bound');
  }
  return prompt;
};

/** Builds one resolved, unconditioned Board image request with the fixed plumbing duration. */
export const createStudioBoardGenerationRequestPlan = (
  input: StudioBoardGenerationRequestInput
): Extract<StudioGenerationRequestPlan, { kind: 'resolved' }> => {
  const template: StudioGenerationRequestTemplate = {
    prompt: composeStudioBoardGenerationPrompt(input),
    aspectRatio: input.aspectRatio,
    resolution: input.resolution,
    durationSeconds: STUDIO_BOARD_REQUEST_DURATION_SECONDS,
    referenceInputs: [],
  };
  return createStudioResolvedGenerationRequestPlan({
    purpose: 'board_still',
    template,
    conditioningInput: null,
  });
};

/** Rebuilds the canonical current Board request from only its persisted authored inputs. */
export const createStudioBoardGenerationRequestPlanForShot = (
  input: StudioBoardGenerationRequestForShotInput
): Extract<StudioGenerationRequestPlan, { kind: 'resolved' }> | null => {
  if (input.project.boardStyle === null) return null;
  return createStudioBoardGenerationRequestPlan({
    brief: input.project.brief,
    rules: input.project.rules,
    action: input.beat.action,
    look: input.beat.look,
    line: input.shot.line,
    style: input.project.boardStyle,
    aspectRatio: input.project.aspectRatio,
    resolution: input.project.resolution,
  });
};
