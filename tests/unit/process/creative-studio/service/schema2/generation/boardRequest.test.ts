/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest';
import type {
  StudioGenerationReferenceInputSnapshot,
  StudioMediaModelRef,
} from '@/common/types/project/creativeStudioTypes';
import {
  composeStudioGenerationV2,
  deriveStudioInstructionProfileV2,
} from '@/process/services/creative-studio/service/schema2/generation/composition';
import {
  createStudioBoardGenerationRequestPlan,
  createStudioBoardGenerationRequestPlanForShot,
} from '@/process/services/creative-studio/service/schema2/generation/boardRequest';

const rule = {
  id: 'rule_1',
  scope: 'project',
  text: 'Never show a competitor logo',
  predicate: { kind: 'forbidden_terms', terms: ['competitor'] },
  createdAt: '2026-08-18T00:00:00.000Z',
} as const;

const route: StudioMediaModelRef = {
  providerId: 'provider_image',
  adapterId: 'weprompt-image-v1',
  model: 'image-model',
};
const references: StudioGenerationReferenceInputSnapshot[] = [
  {
    referenceId: 'reference_operator',
    kind: 'character',
    assetId: 'asset_operator',
    sha256: 'a'.repeat(64),
  },
];
const project = {
  revision: 7,
  brief: 'Launch the new camera.',
  rules: [rule],
  boardStyle: 'grey_tone' as const,
  aspectRatio: '16:9' as const,
  resolution: '1080p' as const,
};
const beat = { id: 'beat_1', story: 'The operator crosses the warm studio.' };
const shot = { id: 'shot_1', shootingScript: 'Slow orbit as the camera rotates into view.' };
const composition = (style: 'grey_tone' | 'line_art' | 'colour_key' = 'grey_tone') => {
  const source = {
    kind: 'shot' as const,
    beatId: beat.id,
    story: beat.story,
    shotId: shot.id,
    shootingScript: shot.shootingScript,
  };
  return composeStudioGenerationV2({
    projectRevision: project.revision,
    brief: project.brief,
    rules: project.rules,
    source,
    purpose: 'board_still',
    referenceInputs: references,
    aspectRatio: project.aspectRatio,
    resolution: project.resolution,
    route,
    boardStyle: style,
    instructionProfile: deriveStudioInstructionProfileV2(route, 'board_still', source),
  });
};

describe('Studio Board generation request', () => {
  it('freezes Story, Shooting script, and approved references', () => {
    const prompt = composition().prompt;
    expect(prompt).toContain('STORY\nThe operator crosses the warm studio.');
    expect(prompt).toContain('SHOOTING SCRIPT\nSlow orbit as the camera rotates into view.');
    expect(prompt).toContain('Character reference_operator: preserve the approved identity');
  });

  it('requests one high-fidelity image that can serve as the production first frame', () => {
    const prompt = composition().prompt;

    expect(prompt).toContain('PRODUCTION VISUAL DIRECTION');
    expect(prompt).toContain("Follow the project's final intended visual language");
    expect(prompt).toContain('exactly one production-ready first-frame image');
    expect(prompt).toContain('suitable for direct promotion');
  });

  it('anchors the image to the opening state and rejects planning aesthetics by default', () => {
    const prompt = composition().prompt;

    expect(prompt).toContain("Depict the Shot's opening moment and state");
    expect(prompt).toContain('not a representative midpoint or ending');
    expect(prompt).toContain(
      'Do not use a sketch, line-art, colour-key, storyboard, animatic, rough-concept, or placeholder aesthetic unless the authored final visual language explicitly requires that aesthetic as the finished production style.'
    );
  });

  it.each(['grey_tone', 'line_art', 'colour_key'] as const)(
    'retains legacy %s only as frozen metadata without changing the production direction',
    (style) => {
      const frozen = composition(style);

      expect(frozen.inputs.boardStyle).toBe(style);
      expect(frozen.prompt).toContain('Render at full production fidelity');
      expect(frozen.prompt).toContain('STORY\nThe operator crosses the warm studio.');
    }
  );

  it('keeps legacy style values from changing the guarded v2 provider prompt', () => {
    const prompts = (['grey_tone', 'line_art', 'colour_key'] as const).map((style) => composition(style).prompt);

    expect(new Set(prompts).size).toBe(1);
    expect(prompts[0]).not.toContain('Use clean line-art');
    expect(prompts[0]).toContain(
      'unless the authored final visual language explicitly requires that aesthetic as the finished production style'
    );
  });

  it('creates a resolved image plan with fixed plumbing duration and no conditioning', () => {
    const frozen = composition();
    expect(createStudioBoardGenerationRequestPlan({ composition: frozen })).toEqual({
      kind: 'resolved',
      snapshot: {
        composition: frozen,
        aspectRatio: '16:9',
        resolution: '1080p',
        durationSeconds: 4,
        referenceInputs: references,
        conditioningInput: null,
      },
    });
  });

  it('adapts only the persisted Board request facts and ignores unrelated Shot metadata', () => {
    const expected = createStudioBoardGenerationRequestPlan({ composition: composition() });
    expect(
      createStudioBoardGenerationRequestPlanForShot({ project, beat, shot, route, referenceInputs: references })
    ).toEqual(expected);
    expect(
      createStudioBoardGenerationRequestPlanForShot({
        project: { ...project, name: 'Ignored project name' },
        beat: { ...beat, title: 'Ignored title', targetSeconds: 120 },
        shot: {
          ...shot,
          durationSeconds: 99,
          chainBreak: 'hard_cut',
        },
        route,
        referenceInputs: references,
      })
    ).toEqual(expected);
  });

  it('has no current Board request until the global style is selected', () => {
    expect(
      createStudioBoardGenerationRequestPlanForShot({
        project: {
          brief: 'Launch the new camera.',
          rules: [rule],
          boardStyle: null,
          aspectRatio: '16:9',
          resolution: '1080p',
        },
        beat,
        shot,
        route,
        referenceInputs: references,
      })
    ).toBeNull();
  });

  it('permits blank Story and Shooting script when the Brief remains authored', () => {
    const plan = createStudioBoardGenerationRequestPlanForShot({
      project: { ...project, rules: [] },
      beat: { ...beat, story: '' },
      shot: { ...shot, shootingScript: '' },
      route,
      referenceInputs: [],
    });

    expect(plan?.snapshot.composition.prompt).toContain('PROJECT BRIEF\nLaunch the new camera.');
    expect(plan?.snapshot.composition.prompt).toContain('STORY\n\n\nSHOOTING SCRIPT\n');
  });

  it('rejects a non-Board composition', () => {
    expect(() =>
      createStudioBoardGenerationRequestPlan({
        composition: { ...composition(), inputs: { ...composition().inputs, purpose: 'seed_still', boardStyle: null } },
      })
    ).toThrow('Board requests require a board_still composition');
  });
});
