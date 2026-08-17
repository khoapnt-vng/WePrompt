/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import type {
  StudioRendererProject,
  StudioRouteCatalog,
  StudioRouteCatalogEntry,
} from '@/common/types/project/creativeStudioTypes';
import { resolveSceneDurationBounds } from '@renderer/pages/studio/studioRouteConstraints';

const route = (
  kind: 'image' | 'video',
  minDurationSeconds: number,
  maxDurationSeconds: number
): StudioRouteCatalogEntry => ({
  choiceId: `choice-${kind}`,
  providerId: `provider-${kind}`,
  providerName: `${kind} provider`,
  model: `${kind}-model`,
  integrationLabelKey: kind === 'image' ? 'imageApi' : 'selfHostedVideoGateway',
  health: 'available',
  kind,
  constraints: {
    aspectRatios: ['16:9'],
    resolutions: ['720p'],
    minDurationSeconds,
    maxDurationSeconds,
    supportsFirstFrame: true,
    maxConditioningImages: 0,
    silentOutput: true,
  },
});

const imageRoute = route('image', 1, 60);
const videoRoute = route('video', 4, 12);

const project = (): StudioRendererProject => ({
  schemaVersion: 1,
  revision: 1,
  id: 'project-1',
  name: 'Project',
  brief: '',
  aspectRatio: '16:9',
  targetDurationSeconds: 12,
  resolution: '720p',
  sceneOrder: [],
  scenes: {},
  assets: {},
  jobs: {},
  routing: {
    storyboard: null,
    image: { choiceId: imageRoute.choiceId, providerId: imageRoute.providerId, model: imageRoute.model },
    video: { choiceId: videoRoute.choiceId, providerId: videoRoute.providerId, model: videoRoute.model },
  },
  createdAt: '2026-08-03T00:00:00.000Z',
  updatedAt: '2026-08-03T00:00:00.000Z',
});

const catalog = (): StudioRouteCatalog => ({
  storyboard: { status: 'selection_required', selected: null, options: [] },
  image: {
    status: 'ready',
    selected: { choiceId: imageRoute.choiceId, providerId: imageRoute.providerId, model: imageRoute.model },
    selectedRoute: imageRoute,
    selectionIssue: null,
    options: [imageRoute],
  },
  video: {
    status: 'ready',
    selected: { choiceId: videoRoute.choiceId, providerId: videoRoute.providerId, model: videoRoute.model },
    selectedRoute: videoRoute,
    selectionIssue: null,
    options: [videoRoute],
  },
  catalogVersion: 'catalog-1',
});

describe('resolveSceneDurationBounds', () => {
  it('uses a selected video route duration range', () => {
    expect(resolveSceneDurationBounds(project(), catalog(), 'video')).toEqual({
      minDurationSeconds: 4,
      maxDurationSeconds: 12,
      source: 'selected_route',
    });
  });

  it('keeps image duration bounds independent from the selected video route', () => {
    expect(resolveSceneDurationBounds(project(), catalog(), 'image')).toEqual({
      minDurationSeconds: 1,
      maxDurationSeconds: 60,
      source: 'selected_route',
    });
  });

  it('changes bounds immediately when a draft changes from video to image', () => {
    expect([
      resolveSceneDurationBounds(project(), catalog(), 'video'),
      resolveSceneDurationBounds(project(), catalog(), 'image'),
    ]).toEqual([
      { minDurationSeconds: 4, maxDurationSeconds: 12, source: 'selected_route' },
      { minDurationSeconds: 1, maxDurationSeconds: 60, source: 'selected_route' },
    ]);
  });

  it('falls back to storage bounds when the selected route is missing', () => {
    expect(resolveSceneDurationBounds(project(), null, 'video')).toEqual({
      minDurationSeconds: 1,
      maxDurationSeconds: 60,
      source: 'fallback',
    });
  });

  it('falls back when the project has no media selection despite a catalog route', () => {
    const current = project();
    expect(
      resolveSceneDurationBounds({ ...current, routing: { ...current.routing, video: null } }, catalog(), 'video')
    ).toEqual({
      minDurationSeconds: 1,
      maxDurationSeconds: 60,
      source: 'fallback',
    });
  });

  it('falls back when the project selection does not match the catalog selected route', () => {
    const current = project();
    expect(
      resolveSceneDurationBounds(
        {
          ...current,
          routing: {
            ...current.routing,
            video: { ...current.routing.video!, choiceId: 'choice-other' },
          },
        },
        catalog(),
        'video'
      )
    ).toEqual({
      minDurationSeconds: 1,
      maxDurationSeconds: 60,
      source: 'fallback',
    });
  });
});
