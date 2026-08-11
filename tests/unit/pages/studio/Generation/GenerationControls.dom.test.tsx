/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  StudioRendererProject,
  StudioRouteCatalog,
  StudioRouteCatalogEntry,
} from '@/common/types/project/creativeStudioTypes';
import {
  buildSingleSceneReviewRequest,
  GenerationControls,
  type GenerationControlsProps,
} from '@renderer/pages/studio/components/Generation/GenerationControls';
import { buildFirstFramePrompt } from '@renderer/pages/studio/components/Generation/referencePrompt';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values
        ? `${key}:${Object.entries(values)
            .map(([name, value]) => `${name}=${String(value)}`)
            .join(',')}`
        : key,
  }),
}));

const imageRoute = (overrides: Partial<StudioRouteCatalogEntry> = {}): StudioRouteCatalogEntry => ({
  choiceId: 'choice_image',
  providerId: 'provider_image',
  providerName: 'Image Provider',
  model: 'image-model-v1',
  health: 'available',
  kind: 'image',
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

const catalog = (overrides: Partial<StudioRouteCatalog> = {}): StudioRouteCatalog => {
  const suggested = imageRoute();
  return {
    storyboard: {
      status: 'ready',
      selected: { providerId: 'planner', model: 'planner-model' },
      options: [
        {
          providerId: 'planner',
          providerName: 'Planner',
          model: 'planner-model',
          health: 'available',
        },
      ],
    },
    image: {
      status: 'ready',
      selected: {
        choiceId: suggested.choiceId,
        providerId: suggested.providerId,
        model: suggested.model,
      },
      selectedRoute: suggested,
      options: [suggested],
    },
    video: { status: 'setup_required', selected: null, selectedRoute: null, options: [] },
    catalogVersion: 'catalog-v1',
    ...overrides,
  };
};

const project = (overrides: Partial<StudioRendererProject> = {}): StudioRendererProject => ({
  schemaVersion: 1,
  revision: 1,
  id: 'project-1',
  name: 'Project',
  brief: '',
  aspectRatio: '16:9',
  targetDurationSeconds: 10,
  resolution: '720p',
  sceneOrder: ['scene-1'],
  scenes: {},
  assets: {},
  jobs: {},
  routing: {
    storyboard: null,
    image: {
      choiceId: 'choice_image',
      providerId: 'provider_image',
      model: 'image-model-v1',
    },
    video: null,
  },
  createdAt: '2026-07-30T00:00:00.000Z',
  updatedAt: '2026-07-30T00:00:00.000Z',
  ...overrides,
});

const createProps = (overrides: Partial<GenerationControlsProps> = {}): GenerationControlsProps => ({
  catalog: catalog(),
  project: project(),
  catalogLoading: false,
  catalogErrorMessageKey: null,
  onRefreshCatalog: vi.fn(),
  scene: { id: 'scene-1', mediaKind: 'image' },
  aspectRatio: '16:9',
  resolution: '720p',
  sceneDurationSeconds: 5,
  hasReference: false,
  batchSceneCount: 2,
  disabled: false,
  onOpenSettings: vi.fn(),
  onOpenSingleReview: vi.fn(),
  onOpenBatchReview: vi.fn(),
  ...overrides,
});

describe('buildFirstFramePrompt', () => {
  it('builds a single cinematic first frame with the project aspect ratio and trimmed visual prompt', () => {
    expect(buildFirstFramePrompt('  A brushed-steel travel mug  ', '4:3')).toBe(
      'A single cinematic frame, 4:3, no text, no labels, no collage, no split panels. A brushed-steel travel mug'
    );
  });
});

describe('GenerationControls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

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

  it('derives review from persisted project routing without exposing Studio configuration controls', () => {
    const props = createProps();
    render(<GenerationControls {...props} />);

    fireEvent.click(screen.getByRole('button', { name: 'conversation.creativeStudio.review.generateScene' }));

    expect(props.onOpenSingleReview).toHaveBeenCalledWith(
      expect.objectContaining({
        route: expect.objectContaining({
          providerId: 'provider_image',
          model: 'image-model-v1',
          kind: 'image',
        }),
      })
    );
    expect(screen.queryByText('conversation.creativeStudio.routing.connectProvider')).not.toBeInTheDocument();
    expect(screen.queryByText('conversation.creativeStudio.routing.advanced')).not.toBeInTheDocument();
    expect(screen.queryByText('weprompt-image-v1')).not.toBeInTheDocument();
  });

  it('marks a missing persisted selection without auto-selecting the sole catalog option', () => {
    const props = createProps({
      project: project({ routing: { storyboard: null, image: null, video: null } }),
    });
    render(<GenerationControls {...props} />);

    expect(screen.getByText('conversation.creativeStudio.routing.missingRoute')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'conversation.creativeStudio.review.generateScene' })).toBeDisabled();
    expect(props.onOpenSingleReview).not.toHaveBeenCalled();
  });

  it('can disable an unready selected scene without disabling the ready-scene batch action', () => {
    render(<GenerationControls {...createProps({ singleDisabled: true })} />);

    expect(screen.getByRole('button', { name: 'conversation.creativeStudio.review.generateScene' })).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'conversation.creativeStudio.review.generateReadyScenes:count=2' })
    ).toBeEnabled();
  });

  it('shows the duration advisory without blocking the lower batch handler', () => {
    const props = createProps();
    render(
      <GenerationControls {...props} batchAdvisoryMessageKey='conversation.creativeStudio.review.durationMismatch' />
    );

    const batchAction = screen.getByRole('button', {
      name: 'conversation.creativeStudio.review.generateReadyScenes:count=2',
    });
    expect(batchAction).toBeEnabled();
    expect(screen.getByText('conversation.creativeStudio.review.durationMismatch')).toBeVisible();
    fireEvent.click(batchAction);
    expect(props.onOpenBatchReview).toHaveBeenCalledOnce();
  });

  it('labels a scene with a selected output as another paid variation', () => {
    render(
      <GenerationControls
        {...createProps({
          scene: { id: 'scene-1', mediaKind: 'image', hasSelectedAsset: true },
        })}
      />
    );

    expect(
      screen.getByRole('button', {
        name: 'conversation.creativeStudio.review.regenerateScene',
      })
    ).toBeEnabled();
    expect(
      screen.queryByRole('button', {
        name: 'conversation.creativeStudio.review.generateScene',
      })
    ).not.toBeInTheDocument();
  });

  it('keeps an otherwise compatible audio-capable route generatable', () => {
    const audioCapableRoute = imageRoute({
      constraints: {
        ...imageRoute().constraints,
        silentOutput: false,
      },
    });
    const props = createProps({
      catalog: catalog({
        image: {
          status: 'ready',
          selected: project().routing.image,
          options: [audioCapableRoute],
        },
      }),
    });
    render(<GenerationControls {...props} />);

    expect(screen.queryByText('conversation.creativeStudio.routing.invalidRoute')).not.toBeInTheDocument();
    const generate = screen.getByRole('button', { name: 'conversation.creativeStudio.review.generateScene' });
    expect(generate).toBeEnabled();
    fireEvent.click(generate);
    expect(props.onOpenSingleReview).toHaveBeenCalledOnce();
  });

  it.each([
    {
      name: 'aspect ratio',
      route: imageRoute(),
      props: { aspectRatio: '9:16' as const },
    },
    {
      name: 'resolution',
      route: imageRoute(),
      props: { resolution: '1080p' as const },
    },
    {
      name: 'duration',
      route: imageRoute(),
      props: { sceneDurationSeconds: 61 },
    },
    {
      name: 'first-frame input',
      route: imageRoute({
        constraints: {
          ...imageRoute().constraints,
          supportsFirstFrame: false,
        },
      }),
      props: { hasReference: true },
    },
    {
      name: 'provider health',
      route: imageRoute({ health: 'unavailable' }),
      props: {},
    },
  ])('marks the persisted route invalid when it conflicts with the current $name', ({ route, props }) => {
    const componentProps = createProps({
      ...props,
      catalog: catalog({
        image: {
          status: route.health === 'unavailable' ? 'unavailable' : 'ready',
          selected: project().routing.image,
          options: [route],
        },
      }),
    });
    render(<GenerationControls {...componentProps} />);

    expect(screen.getByText('conversation.creativeStudio.routing.invalidRoute')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'conversation.creativeStudio.review.generateScene' })).toBeDisabled();
    expect(componentProps.onOpenSingleReview).not.toHaveBeenCalled();
  });

  it('opens Model Settings and exposes a typed refresh failure without owning connection commands', () => {
    const props = createProps({
      catalogErrorMessageKey: 'conversation.creativeStudio.errors.provider',
    });
    render(<GenerationControls {...props} />);

    expect(screen.getByRole('alert')).toHaveTextContent('conversation.creativeStudio.errors.provider');
    fireEvent.click(screen.getByRole('button', { name: 'conversation.creativeStudio.models.openSettings' }));
    expect(props.onOpenSettings).toHaveBeenCalledExactlyOnceWith('/settings/model');
  });

  it('matches persisted image and video selections only against their corresponding catalogs for batch review', () => {
    const video = imageRoute({
      choiceId: 'choice_video',
      providerId: 'provider_video',
      providerName: 'Video Provider',
      model: 'video-model-v1',
      kind: 'video',
    });
    const props = createProps({
      project: project({
        routing: {
          storyboard: null,
          image: project().routing.image,
          video: {
            choiceId: video.choiceId,
            providerId: video.providerId,
            model: video.model,
          },
        },
      }),
      catalog: catalog({
        video: {
          status: 'ready',
          selected: {
            choiceId: video.choiceId,
            providerId: video.providerId,
            model: video.model,
          },
          options: [video],
        },
      }),
    });
    render(<GenerationControls {...props} />);

    fireEvent.click(
      screen.getByRole('button', { name: 'conversation.creativeStudio.review.generateReadyScenes:count=2' })
    );
    expect(props.onOpenBatchReview).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        routes: {
          image: expect.objectContaining({ route: expect.objectContaining({ kind: 'image' }) }),
          video: expect.objectContaining({ route: expect.objectContaining({ kind: 'video' }) }),
        },
      })
    );
  });
});
