/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  type StudioGenerationCompositionV2,
  type StudioGenerationReferenceInputSnapshot,
  type StudioGenerationRequestPlan,
  type StudioMediaModelRef,
  type StudioProjectV2,
} from '@/common/types/project/creativeStudioTypes';
import { composeStudioGenerationV2, deriveStudioInstructionProfileV2 } from './composition';
import { createStudioGenerationRequestTemplate, createStudioResolvedGenerationRequestPlan } from './generationRequest';

/** Board image requests use fixed image plumbing independent from video Shot limits. */
export const STUDIO_BOARD_REQUEST_DURATION_SECONDS = 4;

export type StudioBoardGenerationRequestInput = {
  composition: StudioGenerationCompositionV2;
};

export type StudioBoardGenerationRequestForShotInput = {
  project: Pick<StudioProjectV2, 'revision' | 'brief' | 'rules' | 'boardStyle' | 'aspectRatio' | 'resolution'>;
  beat: Pick<StudioProjectV2['beats'][string], 'id' | 'story'>;
  shot: Pick<StudioProjectV2['shots'][string], 'id' | 'shootingScript'>;
  route: StudioMediaModelRef;
  referenceInputs: readonly StudioGenerationReferenceInputSnapshot[];
};

/** Builds one resolved, unconditioned Board image request from the canonical composition. */
export const createStudioBoardGenerationRequestPlan = (
  input: StudioBoardGenerationRequestInput
): Extract<StudioGenerationRequestPlan, { kind: 'resolved' }> => {
  if (input.composition.inputs.purpose !== 'board_still') {
    throw new TypeError('Board requests require a board_still composition');
  }
  return createStudioResolvedGenerationRequestPlan({
    purpose: 'board_still',
    template: createStudioGenerationRequestTemplate({
      composition: input.composition,
      durationSeconds: STUDIO_BOARD_REQUEST_DURATION_SECONDS,
    }),
    conditioningInput: null,
  });
};

/** Rebuilds the canonical current Board request from persisted authored inputs and main-resolved references. */
export const createStudioBoardGenerationRequestPlanForShot = (
  input: StudioBoardGenerationRequestForShotInput
): Extract<StudioGenerationRequestPlan, { kind: 'resolved' }> | null => {
  if (input.project.boardStyle === null) return null;
  const source = {
    kind: 'shot' as const,
    beatId: input.beat.id,
    story: input.beat.story,
    shotId: input.shot.id,
    shootingScript: input.shot.shootingScript,
  };
  return createStudioBoardGenerationRequestPlan({
    composition: composeStudioGenerationV2({
      projectRevision: input.project.revision,
      brief: input.project.brief,
      rules: input.project.rules,
      source,
      purpose: 'board_still',
      referenceInputs: [...input.referenceInputs],
      aspectRatio: input.project.aspectRatio,
      resolution: input.project.resolution,
      route: input.route,
      boardStyle: input.project.boardStyle,
      instructionProfile: deriveStudioInstructionProfileV2(input.route, 'board_still', source),
    }),
  });
};
