/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { fireEvent, render, screen, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  StudioAsset,
  StudioRendererProject,
  StudioRouteCatalog,
  StudioRouteCatalogEntry,
  StudioScene,
} from '@/common/types/project/creativeStudioTypes';
import { AssetStrip } from '@renderer/pages/studio/components/Preview/AssetStrip';
import { StagePreview } from '@renderer/pages/studio/components/Preview/StagePreview';
import { SceneTimeline } from '@renderer/pages/studio/components/SceneTimeline';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, string | number>) => {
      if (key === 'conversation.creativeStudio.phase.review.slateLabel') return 'Slate';
      if (key === 'common.unit.second_short') return 's';
      if (params?.number !== undefined) return `${key}:${params.number}`;
      if (params?.seconds !== undefined) return `${key}:${params.seconds}`;
      return key;
    },
  }),
}));

const scene = (overrides: Partial<StudioScene> = {}): StudioScene => ({
  id: 'scene-1',
  title: 'Opening',
  purpose: 'Introduce the story',
  visualPrompt: 'A cinematic sunrise',
  narration: '',
  onScreenText: '',
  mediaKind: 'image',
  durationSeconds: 5,
  referenceAssetId: null,
  selectedAssetId: null,
  assetIds: [],
  jobIds: [],
  reviewState: 'complete',
  ...overrides,
});

const asset = (overrides: Partial<StudioAsset> = {}): StudioAsset => ({
  id: 'asset-1',
  projectId: 'project-1',
  sceneId: 'scene-1',
  mediaKind: 'image',
  mimeType: 'image/png',
  managedAsset: { collection: 'assets', fileName: 'asset-1.png' },
  byteSize: 128,
  sha256: '1'.repeat(64),
  createdAt: '2026-07-30T00:00:00.000Z',
  ...overrides,
});

const project = (current: StudioScene): StudioRendererProject => ({
  schemaVersion: 1,
  revision: 1,
  id: 'project-1',
  name: 'Project',
  brief: '',
  aspectRatio: '16:9',
  targetDurationSeconds: current.durationSeconds,
  resolution: '720p',
  sceneOrder: [current.id],
  scenes: { [current.id]: current },
  assets: {},
  jobs: {},
  routing: {
    storyboard: null,
    image: { choiceId: 'choice-image', providerId: 'provider-image', model: 'image-model' },
    video: null,
  },
  createdAt: '2026-08-03T00:00:00.000Z',
  updatedAt: '2026-08-03T00:00:00.000Z',
});

const catalog = (): StudioRouteCatalog => {
  const selectedRoute: StudioRouteCatalogEntry = {
    choiceId: 'choice-image',
    providerId: 'provider-image',
    providerName: 'Image provider',
    model: 'image-model',
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
      silentOutput: true,
    },
  };
  return {
    storyboard: { status: 'setup_required', selected: null, options: [] },
    image: {
      status: 'ready',
      selected: { choiceId: 'choice-image', providerId: 'provider-image', model: 'image-model' },
      selectedRoute,
      selectionIssue: null,
      options: [selectedRoute],
    },
    video: { status: 'setup_required', selected: null, selectedRoute: null, selectionIssue: null, options: [] },
    catalogVersion: 'catalog-1',
  };
};

describe('StagePreview managed media', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('renders a canonical managed image without exposing any other source shape', () => {
    const selectedAsset = asset();
    render(
      <StagePreview
        projectId='project-1'
        selectedScene={scene({ selectedAssetId: selectedAsset.id, assetIds: [selectedAsset.id] })}
        selectedAsset={selectedAsset}
      />
    );

    expect(screen.getByRole('img', { name: 'conversation.creativeStudio.preview.imageAlt' })).toHaveAttribute(
      'src',
      'weprompt-studio://asset/project-1/asset-1'
    );
  });

  it('renders canonical video controls with an optional canonical poster', () => {
    const selectedAsset = asset({
      id: 'video-1',
      mediaKind: 'video',
      mimeType: 'video/mp4',
      managedAsset: { collection: 'assets', fileName: 'video-1.mp4' },
    });
    const posterAsset = asset({
      id: 'poster-1',
      managedAsset: { collection: 'thumbnails', fileName: 'poster-1.png' },
    });
    render(
      <StagePreview
        projectId='project-1'
        selectedScene={scene({
          mediaKind: 'video',
          selectedAssetId: selectedAsset.id,
          assetIds: [selectedAsset.id, posterAsset.id],
        })}
        selectedAsset={selectedAsset}
        posterAsset={posterAsset}
      />
    );

    const video = screen.getByLabelText('conversation.creativeStudio.preview.videoLabel');
    expect(
      screen.getByRole('figure', {
        name: 'conversation.creativeStudio.preview.title',
      })
    ).toContainElement(video);
    expect(video).toHaveAttribute('src', 'weprompt-studio://asset/project-1/video-1');
    expect(video).toHaveAttribute('poster', 'weprompt-studio://asset/project-1/poster-1');
    expect(video).toHaveAttribute('controls');
  });

  it('previews real audio with an explicit volume control instead of forcing mute', () => {
    const selectedAsset = asset({
      id: 'video-1',
      mediaKind: 'video',
      mimeType: 'video/mp4',
      managedAsset: { collection: 'assets', fileName: 'video-1.mp4' },
    });
    render(
      <StagePreview
        projectId='project-1'
        selectedScene={scene({
          mediaKind: 'video',
          selectedAssetId: selectedAsset.id,
          assetIds: [selectedAsset.id],
        })}
        selectedAsset={selectedAsset}
      />
    );

    expect((screen.getByLabelText('conversation.creativeStudio.preview.videoLabel') as HTMLVideoElement).muted).toBe(
      false
    );
    expect(screen.getByRole('slider', { name: 'conversation.creativeStudio.phase.review.cut.volume' })).toHaveAttribute(
      'aria-valuenow',
      '1'
    );
  });

  it('stops a video preview at the trimmed out point', () => {
    const selectedAsset = asset({
      id: 'video-1',
      mediaKind: 'video',
      mimeType: 'video/mp4',
      managedAsset: { collection: 'assets', fileName: 'video-1.mp4' },
    });
    const onPlaybackTimeChange = vi.fn();
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    render(
      <StagePreview
        projectId='project-1'
        selectedScene={scene({
          mediaKind: 'video',
          selectedAssetId: selectedAsset.id,
          assetIds: [selectedAsset.id],
        })}
        selectedAsset={selectedAsset}
        playbackEndSeconds={0.7}
        onPlaybackTimeChange={onPlaybackTimeChange}
      />
    );
    const video = screen.getByLabelText('conversation.creativeStudio.preview.videoLabel') as HTMLVideoElement;
    video.currentTime = 0.8;

    fireEvent.timeUpdate(video);

    expect(pause).toHaveBeenCalledOnce();
    expect(video.currentTime).toBe(0.7);
    expect(onPlaybackTimeChange).toHaveBeenCalledExactlyOnceWith(0.7);
  });

  it('announces that a posterless video is ready while keeping canonical playback available', () => {
    const selectedAsset = asset({
      id: 'video-1',
      mediaKind: 'video',
      mimeType: 'video/mp4',
      managedAsset: { collection: 'assets', fileName: 'video-1.mp4' },
    });
    render(
      <StagePreview
        projectId='project-1'
        selectedScene={scene({
          mediaKind: 'video',
          selectedAssetId: selectedAsset.id,
          assetIds: [selectedAsset.id],
        })}
        selectedAsset={selectedAsset}
      />
    );

    expect(screen.getByRole('status')).toHaveTextContent('conversation.creativeStudio.preview.videoReady');
    expect(screen.getByLabelText('conversation.creativeStudio.preview.videoLabel')).toHaveAttribute('controls');
  });

  it('replaces failed managed media with a semantic error placeholder', () => {
    const selectedAsset = asset();
    render(
      <StagePreview
        projectId='project-1'
        selectedScene={scene({ selectedAssetId: selectedAsset.id, assetIds: [selectedAsset.id] })}
        selectedAsset={selectedAsset}
      />
    );

    fireEvent.error(screen.getByRole('img', { name: 'conversation.creativeStudio.preview.imageAlt' }));

    expect(screen.getByRole('alert')).toHaveTextContent('conversation.creativeStudio.preview.loadFailed');
    expect(screen.queryByRole('img', { name: 'conversation.creativeStudio.preview.imageAlt' })).not.toBeInTheDocument();
  });

  it('retries a previously failed source after the user selects away and back', () => {
    const first = asset();
    const second = asset({
      id: 'asset-2',
      managedAsset: { collection: 'assets', fileName: 'asset-2.png' },
    });
    const view = render(
      <StagePreview
        projectId='project-1'
        selectedScene={scene({ selectedAssetId: first.id, assetIds: [first.id, second.id] })}
        selectedAsset={first}
      />
    );
    fireEvent.error(screen.getByRole('img', { name: 'conversation.creativeStudio.preview.imageAlt' }));
    expect(screen.getByRole('alert')).toBeInTheDocument();

    view.rerender(
      <StagePreview
        projectId='project-1'
        selectedScene={scene({ selectedAssetId: second.id, assetIds: [first.id, second.id] })}
        selectedAsset={second}
      />
    );
    view.rerender(
      <StagePreview
        projectId='project-1'
        selectedScene={scene({ selectedAssetId: first.id, assetIds: [first.id, second.id] })}
        selectedAsset={first}
      />
    );

    expect(screen.getByRole('img', { name: 'conversation.creativeStudio.preview.imageAlt' })).toHaveAttribute(
      'src',
      'weprompt-studio://asset/project-1/asset-1'
    );
  });

  it('rejects a thumbnail that is not linked to the canonical scene', () => {
    const selectedAsset = asset({
      id: 'video-1',
      mediaKind: 'video',
      mimeType: 'video/mp4',
      managedAsset: { collection: 'assets', fileName: 'video-1.mp4' },
    });
    const posterAsset = asset({
      id: 'poster-unlinked',
      managedAsset: { collection: 'thumbnails', fileName: 'poster-unlinked.png' },
    });
    render(
      <StagePreview
        projectId='project-1'
        selectedScene={scene({
          mediaKind: 'video',
          selectedAssetId: selectedAsset.id,
          assetIds: [selectedAsset.id],
        })}
        selectedAsset={selectedAsset}
        posterAsset={posterAsset}
      />
    );

    expect(screen.getByLabelText('conversation.creativeStudio.preview.videoLabel')).not.toHaveAttribute('poster');
    expect(screen.getByRole('status')).toHaveTextContent('conversation.creativeStudio.preview.videoReady');
  });

  it('rejects asset metadata that does not belong to the canonical project and scene', () => {
    const selectedAsset = asset({ projectId: 'other-project' });
    render(
      <StagePreview
        projectId='project-1'
        selectedScene={scene({ selectedAssetId: selectedAsset.id, assetIds: [selectedAsset.id] })}
        selectedAsset={selectedAsset}
      />
    );

    expect(screen.getByRole('alert')).toHaveTextContent('conversation.creativeStudio.preview.loadFailed');
    expect(document.querySelector('img, video')).not.toBeInTheDocument();
  });

  it('uses no renderer fetch, FileReader, or base64 path for video playback', () => {
    const fetchSpy = vi.fn();
    const fileReaderSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    vi.stubGlobal('FileReader', fileReaderSpy);
    const selectedAsset = asset({
      id: 'video-1',
      mediaKind: 'video',
      mimeType: 'video/mp4',
      managedAsset: { collection: 'assets', fileName: 'video-1.mp4' },
    });
    render(
      <StagePreview
        projectId='project-1'
        selectedScene={scene({
          mediaKind: 'video',
          selectedAssetId: selectedAsset.id,
          assetIds: [selectedAsset.id],
        })}
        selectedAsset={selectedAsset}
      />
    );

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(fileReaderSpy).not.toHaveBeenCalled();
    expect(screen.getByLabelText('conversation.creativeStudio.preview.videoLabel').getAttribute('src')).not.toContain(
      'base64'
    );
  });

  it('shows the prompt requirement when the selected scene has no visual prompt', () => {
    const current = scene({ visualPrompt: '   ' });
    render(
      <StagePreview
        projectId='project-1'
        project={project(current)}
        catalog={catalog()}
        selectedScene={current}
        onOpenSingleReview={vi.fn()}
      />
    );

    expect(screen.getByText('conversation.creativeStudio.preview.missingVisualPrompt')).toBeVisible();
    expect(
      screen.queryByRole('button', { name: 'conversation.creativeStudio.preview.generateThisScene' })
    ).not.toBeInTheDocument();
  });

  it('renders a review slate without exposing Produce generation controls', () => {
    const current = scene({ title: 'Opening slate', durationSeconds: 9 });
    render(
      <StagePreview
        projectId='project-1'
        project={project(current)}
        selectedScene={current}
        presentation='review'
        slate={{ title: current.title, durationSeconds: current.durationSeconds }}
        onOpenSingleReview={vi.fn()}
      />
    );

    const preview = screen.getByRole('region', { name: 'conversation.creativeStudio.preview.title' });
    expect(within(preview).getByText('Opening slate')).toBeVisible();
    expect(within(preview).getByText('conversation.creativeStudio.scene.durationSeconds:9')).toBeVisible();
    expect(
      screen.queryByRole('button', { name: 'conversation.creativeStudio.preview.generateThisScene' })
    ).not.toBeInTheDocument();
  });

  it('shows model-loading feedback and withholds review during initial catalog loading', () => {
    const current = scene();
    const onOpenSingleReview = vi.fn();
    render(
      <StagePreview
        projectId='project-1'
        project={project(current)}
        catalog={null}
        catalogLoading
        selectedScene={current}
        onOpenSingleReview={onOpenSingleReview}
      />
    );

    expect(screen.getByText('conversation.creativeStudio.models.loading')).toBeVisible();
    expect(screen.queryByText('conversation.creativeStudio.preview.missingModel')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'conversation.creativeStudio.preview.generateThisScene' })
    ).not.toBeInTheDocument();
    expect(onOpenSingleReview).not.toHaveBeenCalled();
  });

  it('removes a stale catalog review action while the catalog refreshes', () => {
    const current = scene();
    const onOpenSingleReview = vi.fn();
    const view = render(
      <StagePreview
        projectId='project-1'
        project={project(current)}
        catalog={catalog()}
        catalogLoading={false}
        selectedScene={current}
        onOpenSingleReview={onOpenSingleReview}
      />
    );
    expect(screen.getByRole('button', { name: 'conversation.creativeStudio.preview.generateThisScene' })).toBeEnabled();

    view.rerender(
      <StagePreview
        projectId='project-1'
        project={project(current)}
        catalog={catalog()}
        catalogLoading
        selectedScene={current}
        onOpenSingleReview={onOpenSingleReview}
      />
    );

    expect(screen.getByText('conversation.creativeStudio.models.loading')).toBeVisible();
    expect(
      screen.queryByRole('button', { name: 'conversation.creativeStudio.preview.generateThisScene' })
    ).not.toBeInTheDocument();
    expect(onOpenSingleReview).not.toHaveBeenCalled();
  });

  it('offers contextual generation only when a compatible single-scene review can be built', () => {
    const current = scene();
    const onOpenSingleReview = vi.fn();
    render(
      <StagePreview
        projectId='project-1'
        project={project(current)}
        catalog={catalog()}
        selectedScene={current}
        onOpenSingleReview={onOpenSingleReview}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'conversation.creativeStudio.preview.generateThisScene' }));

    expect(onOpenSingleReview).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ sceneId: current.id, catalogVersion: 'catalog-1', routeStatus: 'valid' })
    );
  });

  it('shows the model requirement instead of a generation shortcut when routing is unavailable', () => {
    const current = scene();
    render(
      <StagePreview
        projectId='project-1'
        project={project(current)}
        catalog={null}
        selectedScene={current}
        onOpenSingleReview={vi.fn()}
      />
    );

    expect(screen.getByText('conversation.creativeStudio.preview.missingModel')).toBeVisible();
    expect(
      screen.queryByRole('button', { name: 'conversation.creativeStudio.preview.generateThisScene' })
    ).not.toBeInTheDocument();
  });
});

describe('AssetStrip canonical variations', () => {
  it('shows a visible in-cut badge on the selected take', () => {
    const selected = asset();
    render(
      <AssetStrip
        projectId='project-1'
        scene={scene({ selectedAssetId: selected.id, assetIds: [selected.id] })}
        assets={{ [selected.id]: selected }}
        projectRevision={8}
        mutationPending={false}
        onSelectAsset={vi.fn()}
      />
    );

    expect(screen.getByText('conversation.creativeStudio.phase.review.selectedTake')).toBeVisible();
  });

  it('renders only generated outputs that canonically belong to the scene', () => {
    const generated = asset();
    const imported = asset({
      id: 'import-1',
      managedAsset: { collection: 'imports', fileName: 'import-1.png' },
    });
    const thumbnail = asset({
      id: 'thumb-1',
      managedAsset: { collection: 'thumbnails', fileName: 'thumb-1.png' },
    });
    const otherScene = asset({ id: 'other-scene', sceneId: 'scene-2' });
    const wrongKind = asset({ id: 'video-1', mediaKind: 'video', mimeType: 'video/mp4' });
    render(
      <AssetStrip
        projectId='project-1'
        scene={scene({
          selectedAssetId: generated.id,
          assetIds: [generated.id, imported.id, thumbnail.id, otherScene.id, wrongKind.id],
        })}
        assets={{
          [generated.id]: generated,
          [imported.id]: imported,
          [thumbnail.id]: thumbnail,
          [otherScene.id]: otherScene,
          [wrongKind.id]: wrongKind,
        }}
        projectRevision={8}
        mutationPending={false}
        onSelectAsset={vi.fn()}
      />
    );

    const controls = screen.getAllByRole('button', {
      name: /conversation\.creativeStudio\.preview\.selectVersion/,
    });
    expect(controls).toHaveLength(1);
    expect(controls[0]).toHaveAttribute('aria-current', 'true');
    expect(controls[0].querySelector('img')).toHaveAttribute('src', 'weprompt-studio://asset/project-1/asset-1');
  });

  it('selects a canonical variation with the latest project revision', () => {
    const first = asset();
    const second = asset({ id: 'asset-2', managedAsset: { collection: 'assets', fileName: 'asset-2.png' } });
    const onSelectAsset = vi.fn();
    render(
      <AssetStrip
        projectId='project-1'
        scene={scene({ selectedAssetId: first.id, assetIds: [first.id, second.id] })}
        assets={{ [first.id]: first, [second.id]: second }}
        projectRevision={11}
        mutationPending={false}
        onSelectAsset={onSelectAsset}
      />
    );

    fireEvent.click(
      screen.getByRole('button', {
        name: 'conversation.creativeStudio.preview.selectVersionAccessible:2',
      })
    );

    expect(onSelectAsset).toHaveBeenCalledExactlyOnceWith({
      projectId: 'project-1',
      sceneId: 'scene-1',
      assetId: 'asset-2',
      expectedRevision: 11,
    });
  });

  it('renders no variation claim when canonical generated outputs are unavailable', () => {
    const imported = asset({
      id: 'import-1',
      managedAsset: { collection: 'imports', fileName: 'import-1.png' },
    });
    render(
      <AssetStrip
        projectId='project-1'
        scene={scene({ assetIds: [imported.id] })}
        assets={{ [imported.id]: imported }}
        projectRevision={3}
        mutationPending={false}
        onSelectAsset={vi.fn()}
      />
    );

    expect(screen.queryByText('conversation.creativeStudio.preview.versions')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});

describe('SceneTimeline storyboard strip', () => {
  it('renders missing scenes as dashed slate plates and selected media as solid take plates', () => {
    const missingScene = scene({ id: 'scene-1', title: 'Opening' });
    const selectedScene = scene({
      id: 'scene-2',
      title: 'Reveal',
      selectedAssetId: 'asset-2',
      assetIds: ['asset-2'],
    });
    const { container } = render(
      <SceneTimeline
        orderedScenes={[missingScene, selectedScene]}
        selectedSceneId='scene-1'
        onSelectScene={vi.fn()}
        reviewStates={{ 'scene-1': 'missing-slate', 'scene-2': 'selected-take' }}
      />
    );

    const [slateControl, takeControl] = screen.getAllByRole('button', {
      name: /conversation\.creativeStudio\.timeline\.selectSceneAccessible/,
    });
    // The plate styling lives in SceneTimeline.module.css and keys off
    // data-plate-state, so assert that contract rather than computed CSS —
    // jsdom does not apply the stylesheet.
    expect(slateControl.dataset.plateState).toBe('missing-slate');
    expect(takeControl.dataset.plateState).toBe('selected-take');
    expect(container.querySelector('[data-review-state="missing-slate"]')).toHaveTextContent('01 · Slate');
    expect(container.querySelector('[data-review-state="selected-take"]')).toHaveTextContent('02 · 5s');
  });

  it('keeps the dashed keyline that marks a slate plate as reserved rather than broken', () => {
    // jsdom never applies the module, so guard the declaration itself: without
    // the dashed border an empty frame reads as a rendering failure.
    const stylesheet = readFileSync(
      resolve(process.cwd(), 'packages/desktop/src/renderer/pages/studio/components/SceneTimeline.module.css'),
      'utf8'
    );

    expect(stylesheet).toMatch(/\.plate\[data-plate-state='missing-slate'\]\s*\{[^}]*border-style:\s*dashed/);
    expect(stylesheet).toMatch(/\.plate\[data-plate-state='missing-slate'\]\s*\{[^}]*var\(--studio-slate-border\)/);
  });

  it('renders canonical order and duration-proportional selectable segments', () => {
    const orderedScenes = [
      scene({ id: 'scene-1', title: 'Opening', durationSeconds: 5 }),
      scene({ id: 'scene-2', title: 'Reveal', durationSeconds: 3 }),
      scene({ id: 'scene-3', title: 'Closing', durationSeconds: 7 }),
    ];
    render(<SceneTimeline orderedScenes={orderedScenes} selectedSceneId='scene-2' onSelectScene={vi.fn()} />);

    const controls = screen.getAllByRole('button', {
      name: /conversation\.creativeStudio\.timeline\.selectSceneAccessible/,
    });
    expect(controls.map((control) => control.getAttribute('aria-label'))).toEqual([
      'conversation.creativeStudio.timeline.selectSceneAccessible:1',
      'conversation.creativeStudio.timeline.selectSceneAccessible:2',
      'conversation.creativeStudio.timeline.selectSceneAccessible:3',
    ]);
    expect(controls.map((control) => control.parentElement?.style.flexGrow)).toEqual(['5', '3', '7']);
    expect(screen.getByRole('status')).toHaveTextContent('conversation.creativeStudio.timeline.totalDurationFull:15');
  });

  it('marks selection and supports adjacent keyboard selection without reordering', () => {
    const orderedScenes = [
      scene({ id: 'scene-1', title: 'Opening', durationSeconds: 5 }),
      scene({ id: 'scene-2', title: 'Reveal', durationSeconds: 3 }),
    ];
    const onSelectScene = vi.fn();
    render(<SceneTimeline orderedScenes={orderedScenes} selectedSceneId='scene-1' onSelectScene={onSelectScene} />);
    const controls = screen.getAllByRole('button', {
      name: /conversation\.creativeStudio\.timeline\.selectSceneAccessible/,
    });

    expect(controls[0]).toHaveAttribute('aria-current', 'true');
    controls[0].focus();
    fireEvent.keyDown(controls[0], { key: 'ArrowRight' });
    expect(controls[1]).toHaveFocus();
    fireEvent.click(controls[1]);

    expect(onSelectScene).toHaveBeenNthCalledWith(1, 'scene-2');
    expect(onSelectScene).toHaveBeenNthCalledWith(2, 'scene-2');
  });

  it('shows explicit Review state text while retaining keyboard selection', () => {
    const orderedScenes = [
      scene({ id: 'scene-1', title: 'Opening' }),
      scene({ id: 'scene-2', title: 'Reveal' }),
      scene({ id: 'scene-3', title: 'Build' }),
      scene({ id: 'scene-4', title: 'Closing' }),
    ];
    const onSelectScene = vi.fn();
    const { container } = render(
      <SceneTimeline
        orderedScenes={orderedScenes}
        selectedSceneId='scene-1'
        onSelectScene={onSelectScene}
        reviewStates={{
          'scene-1': 'selected-take',
          'scene-2': 'missing-slate',
          'scene-3': 'running',
          'scene-4': 'failed',
        }}
      />
    );

    expect(
      Array.from(container.querySelectorAll('[data-review-state]'), (node) => node.getAttribute('data-review-state'))
    ).toEqual(['selected-take', 'missing-slate', 'running', 'failed']);
    const controls = screen.getAllByRole('button', {
      name: /conversation\.creativeStudio\.timeline\.selectSceneAccessible/,
    });
    controls[0].focus();
    fireEvent.keyDown(controls[0], { key: 'ArrowRight' });
    expect(controls[1]).toHaveFocus();
    expect(onSelectScene).toHaveBeenCalledWith('scene-2');
  });

  it('shows the localized empty state without waveform, music, or caption claims', () => {
    const { container } = render(<SceneTimeline orderedScenes={[]} selectedSceneId={null} onSelectScene={vi.fn()} />);

    expect(screen.getByText('conversation.creativeStudio.timeline.noScenes')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(container.textContent).not.toMatch(/waveform|music|caption/i);
  });
});
