/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  StudioMediaModelRef,
  StudioProjectReferenceV2,
  StudioProjectV2,
  StudioGenerationRequestPlan,
} from '@/common/types/project/creativeStudioTypes';
import { composeStudioGenerationV2, deriveStudioInstructionProfileV2 } from './composition';
import { STUDIO_BOARD_REQUEST_DURATION_SECONDS } from './boardRequest';
import { createStudioGenerationRequestTemplate, createStudioResolvedGenerationRequestPlan } from './generationRequest';

/** Builds the canonical unconditioned paid request for one persisted project-reference target. */
export const createStudioReferenceGenerationRequestPlan = (input: {
  project: Pick<StudioProjectV2, 'revision' | 'brief' | 'rules' | 'aspectRatio' | 'resolution' | 'boardStyle'>;
  reference: StudioProjectReferenceV2;
  route: StudioMediaModelRef;
}): Extract<StudioGenerationRequestPlan, { kind: 'resolved' }> => {
  const source = {
    kind: 'project_reference' as const,
    referenceId: input.reference.id,
    referenceKind: input.reference.kind,
    prompt: input.reference.prompt,
  };
  const composition = composeStudioGenerationV2({
    projectRevision: input.project.revision,
    brief: input.project.brief,
    rules: input.project.rules,
    source,
    purpose: 'reference_image',
    referenceInputs: [],
    aspectRatio: input.project.aspectRatio,
    resolution: input.project.resolution,
    route: input.route,
    boardStyle: null,
    instructionProfile: deriveStudioInstructionProfileV2(input.route, 'reference_image', source),
  });
  return createStudioResolvedGenerationRequestPlan({
    purpose: 'reference_image',
    template: createStudioGenerationRequestTemplate({
      composition,
      durationSeconds: STUDIO_BOARD_REQUEST_DURATION_SECONDS,
    }),
    conditioningInput: null,
  });
};
