/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest';

import type { StudioRouteCatalogEntry } from '@/common/types/project/creativeStudioTypes';
import {
  routeSupportsScene,
  type StudioRouteSupportContext,
} from '@renderer/pages/studio/components/Generation/routeSupport';

const route = (overrides: Partial<StudioRouteCatalogEntry> = {}): StudioRouteCatalogEntry => ({
  choiceId: 'choice_image',
  providerId: 'provider_image',
  providerName: 'Image Provider',
  model: 'image-model-v1',
  integrationLabelKey: 'imageApi',
  health: 'available',
  kind: 'image',
  constraints: {
    aspectRatios: ['16:9'],
    resolutions: ['720p'],
    minDurationSeconds: 1,
    maxDurationSeconds: 60,
    supportsFirstFrame: true,
    silentOutput: false,
  },
  ...overrides,
});

const matchingContext = {
  kind: 'image',
  sceneId: 'scene-1',
  routeSceneId: 'scene-1',
  aspectRatio: '16:9',
  resolution: '720p',
  durationSeconds: 5,
  hasReference: true,
} satisfies StudioRouteSupportContext;

describe('routeSupportsScene', () => {
  it('supports an audio-capable route when every renderer compatibility constraint matches', () => {
    expect(routeSupportsScene(route(), matchingContext)).toBe(true);
  });

  it.each([
    {
      condition: 'provider health',
      candidate: route({ health: 'unavailable' }),
      context: matchingContext,
    },
    {
      condition: 'media kind',
      candidate: route(),
      context: { ...matchingContext, kind: 'video' as const },
    },
    {
      condition: 'scene identity',
      candidate: route(),
      context: { ...matchingContext, routeSceneId: 'scene-2' },
    },
    {
      condition: 'aspect ratio',
      candidate: route(),
      context: { ...matchingContext, aspectRatio: '9:16' as const },
    },
    {
      condition: 'resolution',
      candidate: route(),
      context: { ...matchingContext, resolution: '1080p' as const },
    },
    {
      condition: 'minimum duration',
      candidate: route(),
      context: { ...matchingContext, durationSeconds: 0 },
    },
    {
      condition: 'maximum duration',
      candidate: route(),
      context: { ...matchingContext, durationSeconds: 61 },
    },
    {
      condition: 'first-frame support',
      candidate: route({
        constraints: {
          ...route().constraints,
          supportsFirstFrame: false,
        },
      }),
      context: matchingContext,
    },
  ])('rejects a route that violates the $condition constraint', ({ candidate, context }) => {
    expect(routeSupportsScene(candidate, context)).toBe(false);
  });
});
