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
  StudioJobPurpose,
  StudioMediaModelRef,
} from '@/common/types/project/creativeStudioTypes';
import {
  composeStudioGenerationV2,
  deriveStudioInstructionProfileV2,
} from '@/process/services/creative-studio/service/schema2/generation/composition';
import {
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

const imageRoute: StudioMediaModelRef = {
  providerId: 'provider_image',
  adapterId: 'weprompt-image-v1',
  model: 'image-model',
};
const videoRoute: StudioMediaModelRef = {
  providerId: 'provider_video',
  adapterId: 'openrouter-video-v1',
  model: 'video-model',
};
const source = {
  kind: 'shot' as const,
  beatId: 'beat_1',
  story: 'The operator crosses the warm studio.',
  shotId: 'shot_1',
  shootingScript: 'Slow orbit as the camera rotates into view.',
};
const approvedReference: StudioGenerationReferenceInputSnapshot = {
  referenceId: 'reference_1',
  kind: 'character',
  assetId: 'asset_reference_1',
  sha256: 'a'.repeat(64),
};

const composition = (
  purpose: Exclude<StudioJobPurpose, 'reference_image'>,
  referenceInputs: readonly StudioGenerationReferenceInputSnapshot[] = []
) => {
  const route = purpose === 'video_take' ? videoRoute : imageRoute;
  return composeStudioGenerationV2({
    projectRevision: 7,
    brief: 'Launch the new camera.',
    rules: [rule],
    source,
    purpose,
    referenceInputs: [...referenceInputs],
    aspectRatio: '16:9',
    resolution: '1080p',
    route,
    boardStyle: purpose === 'board_still' ? 'grey_tone' : null,
    instructionProfile: deriveStudioInstructionProfileV2(route, purpose, source),
  });
};

const templateInput = (
  purpose: Exclude<StudioJobPurpose, 'reference_image'> = 'video_take',
  referenceInputs: readonly StudioGenerationReferenceInputSnapshot[] = []
) => ({ composition: composition(purpose, referenceInputs), durationSeconds: purpose === 'video_take' ? 8 : 4 });

describe('generation request plans', () => {
  it('builds a resolved seed request with a frozen Brief reference digest', () => {
    const template = createStudioGenerationRequestTemplate(templateInput('seed_still', [approvedReference]));

    expect(
      createStudioResolvedGenerationRequestPlan({ purpose: 'seed_still', template, conditioningInput: null })
    ).toEqual({ kind: 'resolved', snapshot: { ...template, conditioningInput: null } });
  });

  it('materializes a deferred predecessor plan without changing its template', () => {
    const template = createStudioGenerationRequestTemplate(templateInput('video_take'));
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
    const template = createStudioGenerationRequestTemplate(templateInput('video_take'));
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
    const template = createStudioGenerationRequestTemplate(templateInput('video_take'));
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
    const template = createStudioGenerationRequestTemplate(templateInput('video_take'));
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
    const recomposed = createStudioGenerationRequestTemplate({
      composition: composeStudioGenerationV2({
        ...recorded.composition.inputs,
        schemaVersion: undefined as never,
        source: { ...source, shootingScript: 'A materially different camera move.' },
      }),
      durationSeconds: recorded.durationSeconds,
    });
    expect(
      isStudioGenerationRequestCurrent(recorded, {
        ...recomposed,
        conditioningInput: recorded.conditioningInput,
      })
    ).toBe(false);
  });

  it('rejects composition/template drift and invalid conditioning branches', () => {
    const seedTemplate = createStudioGenerationRequestTemplate(templateInput('seed_still', [approvedReference]));
    expect(() =>
      createStudioResolvedGenerationRequestPlan({
        purpose: 'seed_still',
        template: { ...seedTemplate, referenceInputs: [] },
        conditioningInput: null,
      })
    ).toThrow('template does not match its frozen composition');
    const template = createStudioGenerationRequestTemplate(templateInput('video_take'));
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
