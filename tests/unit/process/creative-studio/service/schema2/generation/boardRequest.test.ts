/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest';
import {
  composeStudioBoardGenerationPrompt,
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

const input = () => ({
  brief: 'Launch the new camera.',
  rules: [rule],
  action: 'The operator crosses the studio.',
  look: 'Warm studio light.',
  line: 'The camera rotates into view.',
  style: 'grey_tone' as const,
  aspectRatio: '16:9' as const,
  resolution: '1080p' as const,
});

describe('Studio Board generation request', () => {
  it('freezes Brief, rules, Action, Look, Shot, style, and one-panel output constraints', () => {
    expect(composeStudioBoardGenerationPrompt(input())).toBe(
      [
        'BRIEF\nLaunch the new camera.',
        'PROJECT RULES — enforced before any paid render. A visual prompt that breaks an enforced rule is refused before it costs anything.\n1. [project, enforced] Never show a competitor logo (forbidden words: competitor)',
        'ACTION\nThe operator crosses the studio.',
        'LOOK\nWarm studio light.',
        'SHOT\nThe camera rotates into view.',
        'BOARD DRAWING\nRestrained grey-tone storyboard drawing with clear staging and silhouettes. The drawing medium must not alter the authored LOOK.',
        'OUTPUT\nCreate exactly one production storyboard panel for exactly this Shot. Do not create a grid, contact sheet, split frame, caption, label, border, or UI.',
      ].join('\n\n')
    );
  });

  it.each([
    ['grey_tone', 'Restrained grey-tone storyboard drawing with clear staging and silhouettes.'],
    ['line_art', 'Clean line-art storyboard with sparse shading and clear staging and silhouettes.'],
    ['colour_key', 'Simplified colour-key storyboard with a limited palette and clear staging and silhouettes.'],
  ] as const)('uses the frozen %s treatment without replacing the authored Look', (style, phrase) => {
    const prompt = composeStudioBoardGenerationPrompt({ ...input(), style });

    expect(prompt).toContain(`BOARD DRAWING\n${phrase} The drawing medium must not alter the authored LOOK.`);
    expect(prompt).toContain('LOOK\nWarm studio light.');
  });

  it('creates a resolved image plan with fixed plumbing duration and no conditioning', () => {
    expect(createStudioBoardGenerationRequestPlan(input())).toEqual({
      kind: 'resolved',
      snapshot: {
        prompt: composeStudioBoardGenerationPrompt(input()),
        aspectRatio: '16:9',
        resolution: '1080p',
        durationSeconds: 4,
        referenceInputs: [],
        conditioningInput: null,
      },
    });
  });

  it('adapts only the persisted Board request facts and ignores unrelated Shot metadata', () => {
    const project = {
      brief: 'Launch the new camera.',
      rules: [rule],
      boardStyle: 'grey_tone' as const,
      aspectRatio: '16:9' as const,
      resolution: '1080p' as const,
    };
    const beat = { action: 'The operator crosses the studio.', look: 'Warm studio light.' };
    const shot = { line: 'The camera rotates into view.' };

    const expected = createStudioBoardGenerationRequestPlan(input());
    expect(createStudioBoardGenerationRequestPlanForShot({ project, beat, shot })).toEqual(expected);
    expect(
      createStudioBoardGenerationRequestPlanForShot({
        project: { ...project, name: 'Ignored project name' },
        beat: { ...beat, title: 'Ignored title', actionRevision: 99, targetSeconds: 120 },
        shot: {
          ...shot,
          narration: 'Ignored narration',
          onScreenText: 'Ignored title card',
          durationSeconds: 99,
          chainBreak: 'hard_cut',
        },
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
        beat: { action: 'The operator crosses the studio.', look: 'Warm studio light.' },
        shot: { line: 'The camera rotates into view.' },
      })
    ).toBeNull();
  });

  it('omits blank authored sections while retaining the Board style and one-panel contract', () => {
    const prompt = composeStudioBoardGenerationPrompt({
      ...input(),
      brief: '  ',
      rules: [],
      action: '\n',
      look: '\t',
      line: '',
    });

    expect(prompt).toBe(
      [
        'BOARD DRAWING\nRestrained grey-tone storyboard drawing with clear staging and silhouettes. The drawing medium must not alter the authored LOOK.',
        'OUTPUT\nCreate exactly one production storyboard panel for exactly this Shot. Do not create a grid, contact sheet, split frame, caption, label, border, or UI.',
      ].join('\n\n')
    );
    expect(prompt).not.toMatch(/^(BRIEF|PROJECT RULES|ACTION|LOOK|SHOT)$/m);
  });

  it('rejects an invalid style and an oversized composed prompt', () => {
    expect(() => composeStudioBoardGenerationPrompt({ ...input(), style: 'unknown' as never })).toThrow(TypeError);
    expect(() => composeStudioBoardGenerationPrompt({ ...input(), brief: 'x'.repeat(32 * 1024) })).toThrow(RangeError);
  });
});
