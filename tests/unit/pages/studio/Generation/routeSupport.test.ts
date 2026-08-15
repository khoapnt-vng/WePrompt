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
  explainRouteSupport,
  routeSupportsScene,
  type StudioRouteSupportContext,
} from '@renderer/pages/studio/components/Generation/routeSupport';
import { resolveShotEngine } from '@renderer/pages/studio/studioRouteConstraints';

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
    maxConditioningImages: 0,
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

  it('treats first-frame support and image conditioning capacity as independent constraints', () => {
    const firstFrameOnly = route({
      constraints: { ...route().constraints, supportsFirstFrame: true, maxConditioningImages: 0 },
    });
    const conditioningOnly = route({
      constraints: { ...route().constraints, supportsFirstFrame: false, maxConditioningImages: 6 },
    });

    expect(routeSupportsScene(firstFrameOnly, matchingContext)).toBe(true);
    expect(routeSupportsScene(conditioningOnly, { ...matchingContext, hasReference: false })).toBe(true);
    expect(routeSupportsScene(conditioningOnly, matchingContext)).toBe(false);
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

describe('explainRouteSupport', () => {
  it.each([
    { reason: 'health', candidate: route({ health: 'unavailable' }), context: {} },
    { reason: 'frame', candidate: route(), context: { aspectRatio: '9:16' as const } },
    { reason: 'resolution', candidate: route(), context: { resolution: '1080p' as const } },
    { reason: 'duration', candidate: route(), context: { durationSeconds: 61 } },
    {
      reason: 'first_frame',
      candidate: route({ constraints: { ...route().constraints, supportsFirstFrame: false } }),
      context: { hasReference: true },
    },
  ] as const)('returns the ordered $reason capability reason', ({ reason, candidate, context }) => {
    expect(explainRouteSupport(candidate, context)).toBe(reason);
  });

  it('reports health before every conflicting project and shot constraint', () => {
    expect(
      explainRouteSupport(route({ health: 'unavailable' }), {
        aspectRatio: '9:16',
        resolution: '1080p',
        durationSeconds: 99,
        hasReference: true,
      })
    ).toBe('health');
  });

  it('returns null when every capability matches', () => {
    expect(
      explainRouteSupport(route(), {
        aspectRatio: '16:9',
        resolution: '720p',
        durationSeconds: 5,
        hasReference: true,
      })
    ).toBeNull();
  });
});

describe('resolveShotEngine', () => {
  it('resolves the persisted engine for the shot media kind without falling back', () => {
    const image = { choiceId: 'choice_image', providerId: 'provider_image', model: 'image-model' };
    const video = { choiceId: 'choice_video', providerId: 'provider_video', model: 'video-model' };
    const project = { routing: { storyboard: null, image, video } };

    expect(resolveShotEngine(project, { mediaKind: 'image' })).toEqual(image);
    expect(resolveShotEngine(project, { mediaKind: 'video' })).toEqual(video);
    expect(resolveShotEngine({ routing: { ...project.routing, video: null } }, { mediaKind: 'video' })).toBeNull();
  });
});
