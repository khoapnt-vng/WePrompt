/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest';
import { STUDIO_MAX_GENERATION_PROMPT_LENGTH } from '@/common/types/project/creativeStudioTypes';
import {
  composeStudioGenerationPrompt,
  createStudioDeferredGenerationRequestPlan,
  createStudioGenerationRequestTemplate,
  createStudioResolvedGenerationRequestPlan,
  isStudioGenerationRequestCurrent,
  materializeStudioGenerationRequestPlan,
} from '@/process/services/creative-studio/service/schema2/generation/generationRequest';

const rule = {
  id: 'rule_1',
  scope: 'project',
  text: 'Never show a competitor logo',
  predicate: { kind: 'forbidden_terms', terms: ['competitor'] },
  createdAt: '2026-08-18T00:00:00.000Z',
} as const;

const templateInput = () => ({
  purpose: 'video_take' as const,
  brief: 'Launch the new camera.',
  rules: [rule],
  look: 'Warm studio light.',
  line: 'The camera rotates into view.',
  aspectRatio: '16:9' as const,
  resolution: '1080p' as const,
  durationSeconds: 8,
  referenceInputs: [],
});

describe('composeStudioGenerationPrompt', () => {
  it('freezes Brief, rules, Look, and line in one prompt', () => {
    expect(composeStudioGenerationPrompt(templateInput())).toBe(
      [
        'BRIEF\nLaunch the new camera.',
        'PROJECT RULES — enforced before any paid render. A visual prompt that breaks an enforced rule is refused before it costs anything.\n1. [project, enforced] Never show a competitor logo (forbidden words: competitor)',
        'LOOK\nWarm studio light.',
        'SHOT\nThe camera rotates into view.',
      ].join('\n\n')
    );
  });

  it('rejects an empty or oversized provider prompt', () => {
    expect(() => composeStudioGenerationPrompt({ brief: '', rules: [], look: '', line: '' })).toThrow(RangeError);
    expect(() =>
      composeStudioGenerationPrompt({
        brief: 'x'.repeat(STUDIO_MAX_GENERATION_PROMPT_LENGTH + 1),
        rules: [],
        look: '',
        line: '',
      })
    ).toThrow(RangeError);
  });
});

describe('generation request plans', () => {
  it('builds a resolved seed request with a frozen Brief reference digest', () => {
    const template = createStudioGenerationRequestTemplate({
      ...templateInput(),
      purpose: 'seed_still',
      referenceInputs: [{ assetId: 'reference_1', sha256: 'a'.repeat(64) }],
    });

    expect(
      createStudioResolvedGenerationRequestPlan({ purpose: 'seed_still', template, conditioningInput: null })
    ).toEqual({ kind: 'resolved', snapshot: { ...template, conditioningInput: null } });
  });

  it('materializes a deferred predecessor plan without changing its template', () => {
    const template = createStudioGenerationRequestTemplate(templateInput());
    const plan = createStudioDeferredGenerationRequestPlan({
      template,
      dependency: {
        kind: 'authorized_predecessor',
        upstreamItemId: 'item_upstream',
        predecessorShotId: 'shot_previous',
      },
    });

    expect(
      materializeStudioGenerationRequestPlan(plan, {
        kind: 'predecessor_frame',
        predecessorShotId: 'shot_previous',
        takeAssetId: 'take_1',
        frameAssetId: 'frame_1',
        endpointSeconds: 6.25,
      })
    ).toEqual({
      ...template,
      conditioningInput: {
        kind: 'predecessor_frame',
        predecessorShotId: 'shot_previous',
        takeAssetId: 'take_1',
        frameAssetId: 'frame_1',
        endpointSeconds: 6.25,
      },
    });
  });

  it('materializes an existing predecessor only from the exact quoted Take and trim endpoint', () => {
    const template = createStudioGenerationRequestTemplate(templateInput());
    const plan = createStudioDeferredGenerationRequestPlan({
      template,
      dependency: {
        kind: 'existing_predecessor',
        predecessorShotId: 'shot_previous',
        takeAssetId: 'take_1',
        endpointSeconds: 6.25,
      } as never,
    });
    const exact = {
      kind: 'predecessor_frame' as const,
      predecessorShotId: 'shot_previous',
      takeAssetId: 'take_1',
      frameAssetId: 'frame_1',
      endpointSeconds: 6.25,
    };

    expect(materializeStudioGenerationRequestPlan(plan, exact)).toEqual({
      ...template,
      conditioningInput: exact,
    });
    expect(() => materializeStudioGenerationRequestPlan(plan, { ...exact, takeAssetId: 'take_other' })).toThrow(
      TypeError
    );
    expect(() => materializeStudioGenerationRequestPlan(plan, { ...exact, endpointSeconds: 6 })).toThrow(TypeError);
  });

  it('materializes a deferred same-Shot seed choice into the reviewed image input', () => {
    const template = createStudioGenerationRequestTemplate(templateInput());
    const plan = createStudioDeferredGenerationRequestPlan({
      template,
      dependency: { kind: 'authorized_seed', upstreamItemId: 'item_seed', shotId: 'shot_1' },
    });

    expect(materializeStudioGenerationRequestPlan(plan, { kind: 'seed_still', assetId: 'seed_1' })).toEqual({
      ...template,
      conditioningInput: { kind: 'seed_still', assetId: 'seed_1' },
    });
  });

  it('detects any current-request change without treating object identity as authority', () => {
    const template = createStudioGenerationRequestTemplate(templateInput());
    const recorded = createStudioResolvedGenerationRequestPlan({
      purpose: 'video_take',
      template,
      conditioningInput: { kind: 'seed_still', assetId: 'seed_1' },
    }).snapshot;

    expect(isStudioGenerationRequestCurrent(recorded, structuredClone(recorded))).toBe(true);
    expect(isStudioGenerationRequestCurrent(recorded, { ...recorded, durationSeconds: 9 })).toBe(false);
    expect(
      isStudioGenerationRequestCurrent(recorded, {
        ...recorded,
        conditioningInput: { kind: 'seed_still', assetId: 'seed_2' },
      })
    ).toBe(false);
  });

  it('rejects invalid reference and conditioning branches', () => {
    expect(() =>
      createStudioGenerationRequestTemplate({
        ...templateInput(),
        referenceInputs: [{ assetId: 'reference_1', sha256: 'a'.repeat(64) }],
      })
    ).toThrow(TypeError);
    const template = createStudioGenerationRequestTemplate(templateInput());
    expect(() =>
      createStudioResolvedGenerationRequestPlan({ purpose: 'video_take', template, conditioningInput: null })
    ).toThrow(TypeError);
    const deferred = createStudioDeferredGenerationRequestPlan({
      template,
      dependency: {
        kind: 'authorized_predecessor',
        upstreamItemId: 'item_upstream',
        predecessorShotId: 'shot_previous',
      },
    });
    expect(() =>
      materializeStudioGenerationRequestPlan(deferred, {
        kind: 'predecessor_frame',
        predecessorShotId: 'shot_other',
        takeAssetId: 'take_1',
        frameAssetId: 'frame_1',
        endpointSeconds: 8,
      })
    ).toThrow(TypeError);
    expect(() =>
      materializeStudioGenerationRequestPlan(deferred, {
        kind: 'predecessor_frame',
        predecessorShotId: 'shot_previous',
        takeAssetId: 'take_1',
        frameAssetId: 'frame_1',
        endpointSeconds: 0,
      })
    ).toThrow(RangeError);
    expect(() =>
      materializeStudioGenerationRequestPlan(
        {
          ...deferred,
          dependency: { ...deferred.dependency, upstreamItemId: '../unsafe' },
        },
        {
          kind: 'predecessor_frame',
          predecessorShotId: 'shot_previous',
          takeAssetId: 'take_1',
          frameAssetId: 'frame_1',
          endpointSeconds: 8,
        }
      )
    ).toThrow(TypeError);
  });
});
