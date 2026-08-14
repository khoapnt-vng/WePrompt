/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest';

import type {
  StudioRendererProject,
  StudioRouteCatalog,
  StudioRouteCatalogEntry,
} from '@/common/types/project/creativeStudioTypes';
import {
  buildBatchGenerationReviewRequest,
  buildSingleSceneReviewRequest,
} from '@renderer/pages/studio/components/Generation/generationRequests';

const route = (kind: 'image' | 'video', overrides: Partial<StudioRouteCatalogEntry> = {}): StudioRouteCatalogEntry => ({
  choiceId: `choice_${kind}`,
  providerId: `provider_${kind}`,
  providerName: `${kind} provider`,
  model: `${kind}-model-v1`,
  integrationLabelKey: kind === 'image' ? 'imageApi' : 'selfHostedVideoGateway',
  health: 'available',
  kind,
  constraints: {
    aspectRatios: ['16:9'],
    resolutions: ['720p'],
    minDurationSeconds: 1,
    maxDurationSeconds: 60,
    supportsFirstFrame: true,
    silentOutput: true,
  },
  ...overrides,
});

const catalog = (): StudioRouteCatalog => {
  const image = route('image');
  const video = route('video');
  return {
    storyboard: { status: 'setup_required', selected: null, options: [] },
    image: {
      status: 'ready',
      selected: { choiceId: image.choiceId, providerId: image.providerId, model: image.model },
      selectedRoute: image,
      selectionIssue: null,
      options: [image],
    },
    video: {
      status: 'ready',
      selected: { choiceId: video.choiceId, providerId: video.providerId, model: video.model },
      selectedRoute: video,
      selectionIssue: null,
      options: [video],
    },
    catalogVersion: 'catalog-v1',
  };
};

const project = (overrides: Partial<StudioRendererProject> = {}): StudioRendererProject => ({
  schemaVersion: 1,
  revision: 1,
  id: 'project-1',
  name: 'Project',
  brief: '',
  rules: [],
  ruleListUndo: null,
  aspectRatio: '16:9',
  targetDurationSeconds: 10,
  resolution: '720p',
  sceneOrder: ['scene-1'],
  scenes: {},
  assets: {},
  jobs: {},
  routing: {
    storyboard: null,
    image: { choiceId: 'choice_image', providerId: 'provider_image', model: 'image-model-v1' },
    video: { choiceId: 'choice_video', providerId: 'provider_video', model: 'video-model-v1' },
  },
  createdAt: '2026-07-30T00:00:00.000Z',
  updatedAt: '2026-07-30T00:00:00.000Z',
  ...overrides,
});

describe('generation review requests', () => {
  it('builds only a fully compatible canonical single-scene review request', () => {
    expect(
      buildSingleSceneReviewRequest({
        project: project(),
        catalog: catalog(),
        scene: { id: 'scene-1', mediaKind: 'image' },
        durationSeconds: 5,
        hasReference: false,
      })
    ).toMatchObject({ sceneId: 'scene-1', catalogVersion: 'catalog-v1', routeStatus: 'valid' });

    expect(
      buildSingleSceneReviewRequest({
        project: project({
          routing: {
            storyboard: null,
            image: { choiceId: 'choice_image', providerId: 'foreign-provider', model: 'image-model-v1' },
            video: null,
          },
        }),
        catalog: catalog(),
        scene: { id: 'scene-1', mediaKind: 'image' },
        durationSeconds: 5,
        hasReference: false,
      })
    ).toBeNull();
  });

  it('carries the reference role and prompt into the image-route review request', () => {
    expect(
      buildSingleSceneReviewRequest({
        project: project(),
        catalog: catalog(),
        scene: { id: 'scene-1', mediaKind: 'image' },
        outputRole: 'reference',
        referencePrompt: 'Edited first-frame prompt',
      })
    ).toMatchObject({
      outputRole: 'reference',
      referencePrompt: 'Edited first-frame prompt',
      route: { kind: 'image' },
    });
  });

  it('snapshots each persisted role against its own catalog and copies renderer-safe route metadata', () => {
    const source = catalog();
    const request = buildBatchGenerationReviewRequest({ project: project(), catalog: source });

    expect(request.routes).toEqual({
      image: {
        route: {
          choiceId: 'choice_image',
          providerId: 'provider_image',
          model: 'image-model-v1',
          kind: 'image',
        },
        routeStatus: 'valid',
      },
      video: {
        route: {
          choiceId: 'choice_video',
          providerId: 'provider_video',
          model: 'video-model-v1',
          kind: 'video',
        },
        routeStatus: 'valid',
      },
    });
    expect(request.availableRoutes.map(({ kind, integrationLabelKey }) => ({ kind, integrationLabelKey }))).toEqual([
      { kind: 'image', integrationLabelKey: 'imageApi' },
      { kind: 'video', integrationLabelKey: 'selfHostedVideoGateway' },
    ]);
    expect(request.availableRoutes[0]).not.toBe(source.image.options[0]);
    expect(request.availableRoutes[0]!.constraints).not.toBe(source.image.options[0]!.constraints);
  });
});
