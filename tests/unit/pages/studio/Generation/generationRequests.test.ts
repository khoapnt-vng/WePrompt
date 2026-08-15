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
  StudioScene,
} from '@/common/types/project/creativeStudioTypes';
import {
  buildBatchGenerationReviewRequest,
  buildSingleSceneReviewRequest,
  describeSceneRenderBlock,
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
    maxConditioningImages: 0,
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

const scene = (overrides: Partial<StudioScene> = {}): StudioScene => ({
  id: 'scene-1',
  title: 'Opening',
  purpose: '',
  visualPrompt: 'A clear visual prompt',
  narration: '',
  onScreenText: '',
  mediaKind: 'image',
  durationSeconds: 5,
  referenceAssetId: null,
  selectedAssetId: null,
  assetIds: [],
  jobIds: [],
  reviewState: 'ready',
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
    source.image.options[0]!.constraints.maxConditioningImages = 6;
    const request = buildBatchGenerationReviewRequest({ project: project(), catalog: source, candidateSceneIds: [] });

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
    expect(request.availableRoutes[0]!.constraints).toHaveProperty('maxConditioningImages', 6);
    expect(request.availableRoutes[1]!.constraints).toHaveProperty('maxConditioningImages', 0);
  });

  it.each([
    {
      condition: 'catalog is unloaded',
      currentProject: project(),
      currentCatalog: null,
      currentScene: scene(),
      expected: { code: 'catalog_unloaded', role: 'image' },
    },
    {
      condition: 'no engine is selected',
      currentProject: project({ routing: { storyboard: null, image: null, video: null } }),
      currentCatalog: {
        ...catalog(),
        image: { ...catalog().image, status: 'selection_required' as const, selected: null, selectedRoute: null },
      },
      currentScene: scene(),
      expected: { code: 'no_engine', role: 'image' },
    },
    {
      condition: 'the selected engine needs setup',
      currentProject: project(),
      currentCatalog: {
        ...catalog(),
        image: {
          ...catalog().image,
          status: 'setup_required' as const,
          selectedRoute: null,
          selectionIssue: { code: 'needs_setup' as const, providerName: 'Image provider' },
        },
      },
      currentScene: scene(),
      expected: { code: 'needs_setup', role: 'image' },
    },
    {
      condition: 'the selected engine is not answering',
      currentProject: project(),
      currentCatalog: {
        ...catalog(),
        image: {
          ...catalog().image,
          selectedRoute: route('image', { health: 'unavailable' as const }),
          options: [route('image', { health: 'unavailable' as const })],
        },
      },
      currentScene: scene(),
      expected: { code: 'health', role: 'image' },
    },
    {
      condition: 'the persisted selection was retired',
      currentProject: project(),
      currentCatalog: {
        ...catalog(),
        image: {
          ...catalog().image,
          status: 'selection_required' as const,
          selectedRoute: null,
          selectionIssue: { code: 'retired' as const },
        },
      },
      currentScene: scene(),
      expected: { code: 'retired', role: 'image' },
    },
    {
      condition: 'renderer defense: a stale canonical route rejects only the aspect ratio',
      currentProject: project(),
      currentCatalog: {
        ...catalog(),
        image: {
          ...catalog().image,
          selectedRoute: route('image', {
            constraints: { ...route('image').constraints, aspectRatios: ['9:16'] },
          }),
          options: [route('image', { constraints: { ...route('image').constraints, aspectRatios: ['9:16'] } })],
        },
      },
      currentScene: scene(),
      expected: { code: 'frame', role: 'image', ratio: '16:9' },
    },
    {
      condition: 'renderer defense: a stale canonical route rejects only the resolution',
      currentProject: project(),
      currentCatalog: {
        ...catalog(),
        image: {
          ...catalog().image,
          selectedRoute: route('image', {
            constraints: { ...route('image').constraints, resolutions: ['1080p'] },
          }),
          options: [route('image', { constraints: { ...route('image').constraints, resolutions: ['1080p'] } })],
        },
      },
      currentScene: scene(),
      expected: { code: 'resolution', role: 'image', resolution: '720p' },
    },
    {
      condition: 'the catalog projects a combined project-frame mismatch',
      currentProject: project(),
      currentCatalog: {
        ...catalog(),
        image: {
          ...catalog().image,
          status: 'selection_required' as const,
          selectedRoute: null,
          selectionIssue: { code: 'frame' as const, aspectRatio: '16:9' as const, resolution: '720p' as const },
        },
      },
      currentScene: scene(),
      expected: {
        code: 'project_frame',
        role: 'image',
        model: 'image-model-v1',
        ratio: '16:9',
        resolution: '720p',
      },
    },
    {
      condition: 'the selected engine rejects the shot duration',
      currentProject: project(),
      currentCatalog: {
        ...catalog(),
        image: {
          ...catalog().image,
          selectedRoute: route('image', {
            constraints: { ...route('image').constraints, minDurationSeconds: 4, maxDurationSeconds: 15 },
          }),
          options: [
            route('image', {
              constraints: { ...route('image').constraints, minDurationSeconds: 4, maxDurationSeconds: 15 },
            }),
          ],
        },
      },
      currentScene: scene({ durationSeconds: 3 }),
      expected: { code: 'duration', role: 'image', seconds: 3 },
    },
    {
      condition: 'the selected engine cannot consume a first frame',
      currentProject: project(),
      currentCatalog: {
        ...catalog(),
        image: {
          ...catalog().image,
          selectedRoute: route('image', {
            constraints: { ...route('image').constraints, supportsFirstFrame: false },
          }),
          options: [route('image', { constraints: { ...route('image').constraints, supportsFirstFrame: false } })],
        },
      },
      currentScene: scene({ referenceAssetId: 'reference-1' }),
      expected: { code: 'first_frame', role: 'image' },
    },
  ])(
    'describes $condition and refuses to construct paid intent',
    ({ currentProject, currentCatalog, currentScene, expected }) => {
      expect(describeSceneRenderBlock(currentProject, currentCatalog, currentScene)).toEqual(expected);
      expect(
        buildSingleSceneReviewRequest({
          project: currentProject,
          catalog: currentCatalog,
          scene: currentScene,
          durationSeconds: currentScene.durationSeconds,
          hasReference: currentScene.referenceAssetId !== null,
        })
      ).toBeNull();
    }
  );

  it('freezes only eligible candidate IDs and groups exclusions by their exact reason', () => {
    const image = route('image', {
      constraints: { ...route('image').constraints, supportsFirstFrame: false },
    });
    const source: StudioRouteCatalog = {
      ...catalog(),
      image: { ...catalog().image, selectedRoute: image, options: [image] },
      video: {
        ...catalog().video,
        status: 'selection_required',
        selected: null,
        selectedRoute: null,
        options: [route('video')],
      },
    };
    const eligible = scene({ id: 'scene-eligible' });
    const noEngine = scene({ id: 'scene-no-engine', mediaKind: 'video' });
    const noFirstFrame = scene({ id: 'scene-no-first-frame', referenceAssetId: 'reference-1' });
    const currentProject = project({
      sceneOrder: [eligible.id, noEngine.id, noFirstFrame.id],
      scenes: {
        [eligible.id]: eligible,
        [noEngine.id]: noEngine,
        [noFirstFrame.id]: noFirstFrame,
      },
      routing: { ...project().routing, video: null },
    });

    const request = buildBatchGenerationReviewRequest({
      project: currentProject,
      catalog: source,
      candidateSceneIds: [eligible.id, noEngine.id, noFirstFrame.id],
    });

    expect(request.sceneIds).toEqual(['scene-eligible']);
    expect(request.exclusions).toEqual([
      { block: { code: 'no_engine', role: 'video' }, sceneIds: ['scene-no-engine'] },
      { block: { code: 'first_frame', role: 'image' }, sceneIds: ['scene-no-first-frame'] },
    ]);
  });
});
