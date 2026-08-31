/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest';

import type {
  StudioMediaModelRef,
  StudioProjectReferenceV2,
  StudioProjectV2,
} from '@/common/types/project/creativeStudioTypes';
import { createStudioReferenceGenerationRequestPlan } from '@/process/services/creative-studio/service/schema2/generation/referenceRequest';

const timestamp = '2026-08-24T00:00:00.000Z';
const route: StudioMediaModelRef = {
  providerId: 'provider_image',
  adapterId: 'weprompt-image-v1',
  model: 'image-model-1',
};
const project: Pick<StudioProjectV2, 'revision' | 'brief' | 'rules' | 'aspectRatio' | 'resolution' | 'boardStyle'> = {
  revision: 11,
  brief: 'Ming and Mei reunite at a rain-soaked dai pai dong.',
  rules: [],
  aspectRatio: '16:9',
  resolution: '1080p',
  boardStyle: 'line_art',
};

const reference = (overrides: Partial<StudioProjectReferenceV2> = {}): StudioProjectReferenceV2 => ({
  id: 'reference_ming',
  kind: 'character',
  label: 'Ming',
  prompt: 'Ming, late 20s, short black hair, red rain jacket, warm illustrated style.',
  approvedAssetId: null,
  supersededAssetIds: [],
  jobIds: [],
  createdAt: timestamp,
  updatedAt: timestamp,
  ...overrides,
});

describe('reference-image request composition', () => {
  it('builds an unconditioned request whose target identity and wording come from the semantic reference', () => {
    const plan = createStudioReferenceGenerationRequestPlan({ project, reference: reference(), route });

    expect(plan).toMatchObject({
      kind: 'resolved',
      snapshot: {
        conditioningInput: null,
        referenceInputs: [],
        composition: {
          inputs: {
            projectRevision: 11,
            source: {
              kind: 'project_reference',
              referenceId: 'reference_ming',
              referenceKind: 'character',
              prompt: 'Ming, late 20s, short black hair, red rain jacket, warm illustrated style.',
            },
            purpose: 'reference_image',
            referenceInputs: [],
            boardStyle: null,
            route,
            instructionProfile: 'weprompt-image-v1.reference-character.v1',
          },
        },
      },
    });
    expect(plan.snapshot.composition.prompt).toContain('REFERENCE DESCRIPTION\nMing, late 20s');
    expect(plan.snapshot.composition.prompt).toContain('ONE SINGLE clean character reference photograph');
    expect(plan.snapshot.composition.prompt).toContain('not a character sheet, not a turnaround');
    expect(plan.snapshot.composition.prompt).not.toContain('BOARD STYLE');
  });

  it('uses the background-specific instruction without accepting character inputs', () => {
    const plan = createStudioReferenceGenerationRequestPlan({
      project,
      reference: reference({
        id: 'reference_dai_pai_dong',
        kind: 'background',
        label: 'Dai pai dong',
        prompt: 'Compact street-food stall beneath a red awning at midnight.',
      }),
      route,
    });

    expect(plan.snapshot.composition.inputs.instructionProfile).toBe('weprompt-image-v1.reference-background.v1');
    expect(plan.snapshot.composition.prompt).toContain(
      'ONE SINGLE clean environment reference photograph with no characters'
    );
    expect(plan.snapshot.referenceInputs).toEqual([]);
  });

  it('freezes cloned project/reference/route data instead of retaining mutable caller objects', () => {
    const mutableReference = reference();
    const mutableProject = structuredClone(project);
    const mutableRoute = { ...route };
    const plan = createStudioReferenceGenerationRequestPlan({
      project: mutableProject,
      reference: mutableReference,
      route: mutableRoute,
    });

    mutableReference.prompt = 'Changed after preparation.';
    mutableProject.brief = 'Changed Brief.';
    mutableRoute.model = 'changed-model';
    expect(plan.snapshot.composition.inputs.source).toMatchObject({
      prompt: 'Ming, late 20s, short black hair, red rain jacket, warm illustrated style.',
    });
    expect(plan.snapshot.composition.inputs.brief).toBe('Ming and Mei reunite at a rain-soaked dai pai dong.');
    expect(plan.snapshot.composition.inputs.route.model).toBe('image-model-1');
  });

  it('rejects malformed semantic identity and empty reference wording before a quote can exist', () => {
    expect(() =>
      createStudioReferenceGenerationRequestPlan({
        project,
        reference: reference({ id: '../reference_ming' }),
        route,
      })
    ).toThrow('safe Studio ID');
    expect(() =>
      createStudioReferenceGenerationRequestPlan({
        project,
        reference: reference({ prompt: '' }),
        route,
      })
    ).toThrow('reference prompt is empty');
  });
});
