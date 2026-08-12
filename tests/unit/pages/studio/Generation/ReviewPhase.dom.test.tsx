/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { StudioAsset, StudioRendererProject, StudioScene } from '@/common/types/project/creativeStudioTypes';
import { ReviewPhase } from '@renderer/pages/studio/components/PhaseShell/phases/ReviewPhase';
import type { ReviewPhaseController } from '@renderer/pages/studio/components/PhaseShell/types';
import type { UseStoryboardEditorResult } from '@renderer/pages/studio/hooks/useStoryboardEditor';
import { useStudioRender } from '@renderer/pages/studio/hooks/useStudioRender';

type RenderProgressEvent =
  | { projectId: string; status: 'running'; progress: number; clipIndex?: number; clipTotal?: number }
  | {
      projectId: string;
      status: 'succeeded';
      progress: 1;
      assetId: string;
      missingSceneIds: string[];
    }
  | {
      projectId: string;
      status: 'failed';
      progress: number;
      errorCode: 'ffmpeg_unavailable' | 'render_failed' | 'no_renderable_scenes';
      missingSceneIds?: string[];
      clipIndex?: number;
      clipTotal?: number;
    }
  | { projectId: string; status: 'cancelled'; progress: number; missingSceneIds: string[] };

const bridge = vi.hoisted(() => ({
  updateCut: { invoke: vi.fn() },
  placeCutScenes: { invoke: vi.fn() },
  renderCut: { invoke: vi.fn() },
  cancelRender: { invoke: vi.fn() },
  renderProgress: { on: vi.fn() },
}));

const dnd = vi.hoisted(() => ({
  onDragEnd: null as null | ((event: { active: { id: string }; over: { id: string } | null }) => void),
}));

const external = vi.hoisted(() => ({ openExternalUrl: vi.fn() }));

vi.mock('@renderer/utils/platform', () => external);

vi.mock('@dnd-kit/core', async () => {
  const actual = await vi.importActual<typeof import('@dnd-kit/core')>('@dnd-kit/core');
  return {
    ...actual,
    DndContext: ({
      children,
      onDragEnd,
    }: {
      children: React.ReactNode;
      onDragEnd?: (event: { active: { id: string }; over: { id: string } | null }) => void;
    }) => {
      dnd.onDragEnd = onDragEnd ?? null;
      return <>{children}</>;
    },
  };
});

vi.mock('@dnd-kit/sortable', async () => {
  const actual = await vi.importActual<typeof import('@dnd-kit/sortable')>('@dnd-kit/sortable');
  return {
    ...actual,
    SortableContext: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    useSortable: () => ({
      attributes: {},
      listeners: {},
      setNodeRef: vi.fn(),
      setActivatorNodeRef: vi.fn(),
      transform: null,
      transition: undefined,
      isDragging: false,
    }),
  };
});

let renderProgressListener: ((event: RenderProgressEvent) => void) | undefined;

vi.mock('@/common', () => ({
  ipcBridge: { creativeStudio: bridge },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values === undefined ? key : `${key}:${Object.values(values).join(',')}`,
  }),
}));

const deferred = <T,>(): { promise: Promise<T>; resolve: (value: T) => void } => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

const scene = (id: string, overrides: Partial<StudioScene> = {}): StudioScene => ({
  id,
  title: `Shot ${id}`,
  purpose: 'Tell the story',
  visualPrompt: 'A cinematic frame',
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

const asset = (id: string, sceneId = 'scene-selected'): StudioAsset => ({
  id,
  projectId: 'project-1',
  sceneId,
  mediaKind: 'image',
  mimeType: 'image/png',
  managedAsset: { collection: 'assets', fileName: `${id}.png` },
  byteSize: 128,
  sha256: id.padEnd(64, 'a').slice(0, 64),
  width: 1280,
  height: 720,
  durationSeconds: 5,
  createdAt: '2026-08-04T00:00:00.000Z',
});

const project = (): StudioRendererProject => {
  const selected = scene('scene-selected', {
    title: 'Selected opening',
    selectedAssetId: 'asset-1',
    assetIds: ['asset-1', 'asset-2'],
    reviewState: 'complete',
  });
  const slate = scene('scene-slate', { title: 'Missing close', durationSeconds: 7 });
  const running = scene('scene-running', { title: 'Running reveal', reviewState: 'generating' });
  const failed = scene('scene-failed', { title: 'Failed end card', reviewState: 'blocked' });
  return {
    schemaVersion: 1,
    revision: 12,
    id: 'project-1',
    name: 'Launch film',
    brief: 'A short launch video',
    aspectRatio: '16:9',
    targetDurationSeconds: 22,
    resolution: '720p',
    sceneOrder: [selected.id, slate.id, running.id, failed.id],
    scenes: {
      [selected.id]: selected,
      [slate.id]: slate,
      [running.id]: running,
      [failed.id]: failed,
    },
    cuts: {
      'cut-1': {
        id: 'cut-1',
        name: 'Launch film',
        orderMode: 'storyboard',
        clipOrder: ['clip-selected'],
        clips: {
          'clip-selected': {
            id: 'clip-selected',
            sceneId: selected.id,
            assetId: 'asset-1',
            sourceInSeconds: 0.4,
            sourceOutSeconds: 4.6,
            crop: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 },
            filters: [{ id: 'exposure', amount: 0.2 }],
          },
        },
      },
    },
    activeCutId: 'cut-1',
    assets: {
      'asset-1': asset('asset-1'),
      'asset-2': asset('asset-2'),
    },
    jobs: {},
    routing: { storyboard: null, image: null, video: null },
    createdAt: '2026-08-04T00:00:00.000Z',
    updatedAt: '2026-08-04T00:00:00.000Z',
  };
};

const editor = (currentProject: StudioRendererProject, selectedSceneId: string): UseStoryboardEditorResult => ({
  project: currentProject,
  orderedScenes: currentProject.sceneOrder.map((sceneId) => currentProject.scenes[sceneId]!),
  selectedSceneId,
  selectedScene: currentProject.scenes[selectedSceneId]!,
  sceneDraft: null,
  sceneDrafts: {},
  sceneSaveStates: {},
  projectDraft: null,
  projectSaveState: 'saved',
  hasUnsavedProjectDraft: false,
  hasUnsavedSceneDrafts: false,
  hasUnsavedSelectedSceneDraft: false,
  selectedSceneSaveState: 'saved',
  saveIssues: [],
  selectScene: vi.fn(),
  updateSceneDraft: vi.fn(),
  updateSceneDraftById: vi.fn(),
  updateProjectDraft: vi.fn(),
  flushProjectDraft: vi.fn(async () => true),
  discardProjectDraft: vi.fn(),
  flushSceneDraft: vi.fn(async () => true),
  flushSceneDraftById: vi.fn(async () => true),
  flushAllSceneDrafts: vi.fn(async () => ({ failed: [], dirtied: [] })),
  discardSceneDraft: vi.fn(),
  discardSceneDraftById: vi.fn(),
  addScene: vi.fn(async () => true),
  removeScene: vi.fn(async () => true),
  reorderScenes: vi.fn(async () => true),
  moveScene: vi.fn(async () => true),
  canAddScene: true,
  durationTotalSeconds: currentProject.targetDurationSeconds,
  durationMatchesTarget: true,
  remainingDurationSeconds: 0,
  suggestedExpandedTargetSeconds: null,
  increaseTargetDuration: vi.fn(async () => true),
  fitToTarget: vi.fn(async () => null),
  latestFitOutcome: null,
  latestFitCatalogVersion: null,
  clearLatestFitOutcome: vi.fn(),
  mutationPending: false,
  error: null,
  clearError: vi.fn(),
  conflict: null,
  retryConflict: vi.fn(async () => true),
  discardConflict: vi.fn(),
  drafting: false,
  proposeStoryboard: vi.fn(async () => true),
});

type ReviewPhaseTestController = Omit<ReviewPhaseController, 'render'>;

/**
 * Mounts the cut render where production does - above the phase - and hands it down.
 *
 * Review reads the render from its controller, so these tests exercise the real hook against the
 * mocked bridge without the phase owning the subscription.
 */
const ReviewPhaseWithRender: React.FC<{
  controller: ReviewPhaseTestController;
  layoutMode?: React.ComponentProps<typeof ReviewPhase>['layoutMode'];
}> = ({ controller: reviewController, layoutMode }) => {
  const cutRender = useStudioRender(reviewController.project.id);
  return <ReviewPhase controller={{ ...reviewController, render: cutRender }} layoutMode={layoutMode} />;
};

const controller = (selectedSceneId = 'scene-selected'): ReviewPhaseTestController => {
  const currentProject = project();
  return {
    project: currentProject,
    readiness: {
      sceneStatuses: {
        'scene-selected': 'generated',
        'scene-slate': 'ready',
        'scene-running': 'generating',
        'scene-failed': 'needs_attention',
      },
      totalSceneCount: 4,
      readySceneIds: ['scene-slate'],
      selectedAssetCount: 1,
      durationDeltaSeconds: 0,
    },
    editor: editor(currentProject, selectedSceneId),
    selectedAsset: selectedSceneId === 'scene-selected' ? currentProject.assets['asset-1']! : null,
    posterAsset: null,
    advisory: null,
    mutationPending: false,
    requestTransition: vi.fn(),
    openExport: vi.fn(),
    selectVariation: vi.fn(async () => undefined),
  };
};

const addSecondClip = (reviewController: ReviewPhaseTestController): void => {
  const secondScene = reviewController.project.scenes['scene-slate']!;
  secondScene.selectedAssetId = 'asset-3';
  secondScene.assetIds = ['asset-3'];
  reviewController.project.assets['asset-3'] = asset('asset-3', secondScene.id);
  reviewController.project.cuts!['cut-1']!.clips['clip-second'] = {
    id: 'clip-second',
    sceneId: secondScene.id,
    assetId: 'asset-3',
    sourceInSeconds: null,
    sourceOutSeconds: null,
    crop: null,
    filters: [],
  };
  reviewController.project.cuts!['cut-1']!.clipOrder.push('clip-second');
};

beforeEach(() => {
  vi.clearAllMocks();
  dnd.onDragEnd = null;
  renderProgressListener = undefined;
  bridge.renderProgress.on.mockImplementation((listener: (event: RenderProgressEvent) => void) => {
    renderProgressListener = listener;
    return () => {
      if (renderProgressListener === listener) renderProgressListener = undefined;
    };
  });
  bridge.renderCut.invoke.mockResolvedValue({
    ok: true,
    data: { assetId: 'render-default', missingSceneIds: [] },
  });
  bridge.cancelRender.invoke.mockResolvedValue({ ok: true, data: { cancelled: true } });
  bridge.updateCut.invoke.mockImplementation(async (input: { cut: StudioRendererProject['cuts'][string] }) => {
    const current = project();
    const cut = current.cuts!['cut-1']!;
    return {
      ok: true,
      data: {
        ...current,
        revision: current.revision + 1,
        cuts: {
          'cut-1': {
            ...cut,
            orderMode: input.cut.orderMode,
            clipOrder: [...input.cut.clipOrder],
            clips: Object.fromEntries(
              Object.entries(cut.clips).map(([clipId, clip]) => [clipId, { ...clip, ...input.cut.clips[clipId] }])
            ),
          },
        },
      },
    };
  });
  bridge.placeCutScenes.invoke.mockResolvedValue({ ok: true, data: project() });
});

describe('Review phase cut', () => {
  it('keeps the inspector inline beside a proportional strip in inline mode', () => {
    const { container } = render(<ReviewPhaseWithRender controller={controller()} layoutMode='inline' />);

    expect(container.querySelector('[data-review-cut-layout]')).toHaveAttribute('data-layout', 'inline');
    expect(container.querySelector('[data-review-workspace]')).toHaveAttribute('data-inspector-presentation', 'inline');
    expect(
      screen.getByRole('complementary', { name: 'conversation.creativeStudio.phase.review.cut.inspector' })
    ).toBeVisible();
    expect((container.querySelector("[data-cut-clip-id='clip-selected']") as HTMLElement).style.flexGrow).toBe('4.2');
  });

  it('keeps the stage and strip full width while a selected clip opens a 322px inspector Drawer that Escape closes', async () => {
    const { container } = render(<ReviewPhaseWithRender controller={controller()} layoutMode='drawer' />);

    expect(container.querySelector('[data-review-cut-layout]')).toHaveAttribute('data-layout', 'drawer');
    expect(container.querySelector('[data-review-workspace]')).toHaveAttribute('data-inspector-presentation', 'drawer');
    expect(container.querySelector('[data-review-primary]')).toHaveAttribute('data-full-width', 'true');
    expect(document.querySelector('.arco-drawer')).not.toBeInTheDocument();

    const opener = screen.getByRole('button', {
      name: 'conversation.creativeStudio.phase.review.cut.clipAccessible:1,Selected opening,4.2',
    });
    opener.focus();
    fireEvent.click(opener);

    const drawer = await waitFor(() => {
      const element = document.querySelector<HTMLElement>('.arco-drawer');
      expect(element).not.toBeNull();
      return element!;
    });
    expect(drawer).toHaveStyle({ width: '322px' });
    const dialog = screen.queryByRole('dialog');
    expect.soft(dialog).not.toBeNull();
    if (dialog !== null) {
      expect.soft(dialog).toHaveAccessibleName('conversation.creativeStudio.phase.review.cut.inspector');
    }
    expect(
      within(drawer).getByRole('complementary', {
        name: 'conversation.creativeStudio.phase.review.cut.inspector',
      })
    ).toBeVisible();
    const closeButton = within(drawer).getByRole('button', { name: 'common.close' });
    expect(closeButton).toBeVisible();
    closeButton.focus();
    expect(closeButton).toHaveFocus();

    const drawerWrapper = document.querySelector('.arco-drawer-wrapper');
    expect(drawerWrapper).not.toBeNull();
    fireEvent.keyDown(drawerWrapper!, { key: 'Escape', keyCode: 27, which: 27 });

    await waitFor(() => expect(document.querySelector('.arco-drawer')).not.toBeInTheDocument());
    expect(opener).toHaveFocus();
  });

  it('uses fixed 96px strip items, duration labels, and a scroll cue in compact mode', () => {
    const { container } = render(<ReviewPhaseWithRender controller={controller()} layoutMode='compact' />);

    expect(container.querySelector('[data-review-cut-layout]')).toHaveAttribute('data-layout', 'compact');
    const track = container.querySelector('[data-cut-timeline-track]');
    expect(track).toHaveAttribute('data-layout', 'compact');
    expect(within(track as HTMLElement).getByTestId('cut-scroll-affordance')).toBeVisible();

    const items = container.querySelectorAll<HTMLElement>('[data-cut-clip-id], [data-slate-scene-id]');
    expect(items).toHaveLength(4);
    for (const item of items) {
      expect(item.style.flexBasis).toBe('96px');
      expect(item.style.flexGrow).toBe('0');
      expect(item.style.minWidth).toBe('96px');
    }
    expect(container.querySelectorAll('[data-cut-duration]')).toHaveLength(4);
  });

  it('maps compact seeking through equal-width items instead of the duration-proportional rail', async () => {
    const reviewController = controller();
    const selected = reviewController.project.scenes['scene-selected']!;
    selected.mediaKind = 'video';
    reviewController.project.assets['asset-1'] = {
      ...reviewController.project.assets['asset-1']!,
      mediaKind: 'video',
      mimeType: 'video/mp4',
      managedAsset: { collection: 'assets', fileName: 'asset-1.mp4' },
    };
    render(<ReviewPhaseWithRender controller={reviewController} layoutMode='compact' />);
    const track = document.querySelector<HTMLElement>('[data-cut-timeline-track]')!;
    vi.spyOn(track, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 100,
      bottom: 20,
      width: 100,
      height: 20,
      toJSON: () => ({}),
    });

    fireEvent.click(track, { clientX: 10 });

    const video = screen.getByLabelText('conversation.creativeStudio.preview.videoLabel') as HTMLVideoElement;
    await waitFor(() => expect(video.currentTime).toBeCloseTo(2.08, 2));
  });

  it.each(['drawer', 'compact'] as const)('keeps modifier-arrow reorder available in %s mode', async (layoutMode) => {
    const reviewController = controller();
    addSecondClip(reviewController);
    const { container } = render(<ReviewPhaseWithRender controller={reviewController} layoutMode={layoutMode} />);

    expect(container.querySelector('[data-cut-timeline-track]')).toHaveAttribute('data-layout', layoutMode);

    fireEvent.keyDown(
      screen.getByRole('button', {
        name: 'conversation.creativeStudio.phase.review.cut.clipAccessible:2,Missing close,5',
      }),
      { key: 'ArrowLeft', ctrlKey: true }
    );

    await waitFor(() =>
      expect(bridge.updateCut.invoke).toHaveBeenCalledWith(
        expect.objectContaining({
          cut: expect.objectContaining({ clipOrder: ['clip-second', 'clip-selected'] }),
        })
      )
    );
  });

  it('shows played, untrimmed, and rendered durations with trim and grade marks', () => {
    const { container } = render(<ReviewPhaseWithRender controller={controller()} />);

    expect(screen.getByText('conversation.creativeStudio.phase.review.cut.duration.played:0')).toBeVisible();
    expect(screen.getByText('conversation.creativeStudio.phase.review.cut.duration.untrimmed:5')).toBeVisible();
    expect(screen.getByText('conversation.creativeStudio.phase.review.cut.duration.render:4.2')).toBeVisible();
    expect(screen.getByText('conversation.creativeStudio.phase.review.cut.trimmed')).toBeVisible();
    expect(screen.getByText('conversation.creativeStudio.phase.review.cut.graded')).toBeVisible();
    expect((container.querySelector("[data-cut-clip-id='clip-selected']") as HTMLElement).style.flexGrow).toBe('4.2');
  });

  it('reorders a focused clip with modifier plus arrow through the guarded cut mutation', async () => {
    const reviewController = controller();
    addSecondClip(reviewController);

    render(<ReviewPhaseWithRender controller={reviewController} />);
    fireEvent.keyDown(
      screen.getByRole('button', {
        name: 'conversation.creativeStudio.phase.review.cut.clipAccessible:2,Missing close,5',
      }),
      { key: 'ArrowLeft', metaKey: true }
    );

    await waitFor(() =>
      expect(bridge.updateCut.invoke).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: 'project-1',
          expectedRevision: 12,
          cutId: 'cut-1',
          cut: expect.objectContaining({ clipOrder: ['clip-second', 'clip-selected'] }),
        })
      )
    );
    expect(screen.getByText('conversation.creativeStudio.phase.review.cut.moveAnnouncement:2,1,2')).toBeInTheDocument();
  });

  it('uses the same guarded cut permutation for pointer drag reorder', async () => {
    const reviewController = controller();
    addSecondClip(reviewController);
    render(<ReviewPhaseWithRender controller={reviewController} />);

    act(() => {
      dnd.onDragEnd?.({ active: { id: 'clip-second' }, over: { id: 'clip-selected' } });
    });

    await waitFor(() =>
      expect(bridge.updateCut.invoke).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: 'project-1',
          expectedRevision: 12,
          cutId: 'cut-1',
          cut: expect.objectContaining({ clipOrder: ['clip-second', 'clip-selected'] }),
        })
      )
    );
  });

  it('keeps the trim handle and typed in point on the same persisted value', async () => {
    render(<ReviewPhaseWithRender controller={controller()} />);
    const inHandle = screen.getByRole('slider', {
      name: 'conversation.creativeStudio.phase.review.cut.trimInHandle',
    });

    fireEvent.keyDown(inHandle, { key: 'ArrowRight', shiftKey: true });

    await waitFor(() =>
      expect(bridge.updateCut.invoke).toHaveBeenLastCalledWith(
        expect.objectContaining({
          cut: expect.objectContaining({
            clips: expect.objectContaining({
              'clip-selected': expect.objectContaining({ sourceInSeconds: 1.4 }),
            }),
          }),
        })
      )
    );
    expect(
      (
        screen.getByRole('spinbutton', {
          name: 'conversation.creativeStudio.phase.review.cut.trimInField',
        }) as HTMLInputElement
      ).value
    ).toBe('1.40s');
  });

  it('shows trim points as rounded seconds instead of raw floating point', () => {
    render(<ReviewPhaseWithRender controller={controller()} />);

    const trimIn = screen.getByRole('spinbutton', {
      name: 'conversation.creativeStudio.phase.review.cut.trimInField',
    }) as HTMLInputElement;
    const trimOut = screen.getByRole('spinbutton', {
      name: 'conversation.creativeStudio.phase.review.cut.trimOutField',
    }) as HTMLInputElement;

    // A one-frame step of 1/30 makes Arco widen the field to step's own decimals,
    // which rendered trim points as 0.00000000000000 before this was formatted.
    for (const field of [trimIn, trimOut]) {
      expect(field.value).toMatch(/^\d+\.\d{2}s$/);
      expect(field.value).not.toMatch(/\d\.\d{3,}/);
    }
  });

  it('persists a precisely typed trim point through the same cut edit', async () => {
    render(<ReviewPhaseWithRender controller={controller()} />);

    fireEvent.change(
      screen.getByRole('spinbutton', {
        name: 'conversation.creativeStudio.phase.review.cut.trimInField',
      }),
      { target: { value: '0.75' } }
    );

    await waitFor(() =>
      expect(bridge.updateCut.invoke).toHaveBeenLastCalledWith(
        expect.objectContaining({
          cut: expect.objectContaining({
            clips: expect.objectContaining({
              'clip-selected': expect.objectContaining({ sourceInSeconds: 0.75 }),
            }),
          }),
        })
      )
    );
  });

  it.each([
    ['ArrowRight', false, 0.433],
    ['Home', false, null],
  ] as const)('moves the in handle with %s to the exact persisted value', async (key, shiftKey, expected) => {
    render(<ReviewPhaseWithRender controller={controller()} />);

    fireEvent.keyDown(
      screen.getByRole('slider', { name: 'conversation.creativeStudio.phase.review.cut.trimInHandle' }),
      { key, shiftKey }
    );

    await waitFor(() =>
      expect(bridge.updateCut.invoke).toHaveBeenLastCalledWith(
        expect.objectContaining({
          cut: expect.objectContaining({
            clips: expect.objectContaining({
              'clip-selected': expect.objectContaining({ sourceInSeconds: expected }),
            }),
          }),
        })
      )
    );
  });

  it('moves the out handle to its clip bound with End', async () => {
    render(<ReviewPhaseWithRender controller={controller()} />);

    fireEvent.keyDown(
      screen.getByRole('slider', { name: 'conversation.creativeStudio.phase.review.cut.trimOutHandle' }),
      { key: 'End' }
    );

    await waitFor(() =>
      expect(bridge.updateCut.invoke).toHaveBeenLastCalledWith(
        expect.objectContaining({
          cut: expect.objectContaining({
            clips: expect.objectContaining({
              'clip-selected': expect.objectContaining({ sourceOutSeconds: null }),
            }),
          }),
        })
      )
    );
  });

  it('exposes a visible zero recovery tick for every bipolar colour slider', () => {
    const { container } = render(<ReviewPhaseWithRender controller={controller()} />);

    expect(container.querySelectorAll('[data-control-zero-tick]')).toHaveLength(4);
  });

  it('persists colour changes from the slider keyboard path', async () => {
    render(<ReviewPhaseWithRender controller={controller()} />);

    fireEvent.keyDown(
      screen.getByRole('slider', {
        name: 'conversation.creativeStudio.phase.review.cut.colourLabels.exposure',
      }),
      { key: 'ArrowRight' }
    );

    await waitFor(() =>
      expect(bridge.updateCut.invoke).toHaveBeenLastCalledWith(
        expect.objectContaining({
          cut: expect.objectContaining({
            clips: expect.objectContaining({
              'clip-selected': expect.objectContaining({
                filters: expect.arrayContaining([{ id: 'exposure', amount: 0.21 }]),
              }),
            }),
          }),
        })
      )
    );
  });

  it('nudges the focusable crop overlay and resets trim, crop, and colour together', async () => {
    render(<ReviewPhaseWithRender controller={controller()} />);

    fireEvent.keyDown(screen.getByRole('group', { name: 'conversation.creativeStudio.phase.review.cut.cropOverlay' }), {
      key: 'ArrowRight',
      shiftKey: true,
    });
    await waitFor(() =>
      expect(bridge.updateCut.invoke).toHaveBeenLastCalledWith(
        expect.objectContaining({
          cut: expect.objectContaining({
            clips: expect.objectContaining({
              'clip-selected': expect.objectContaining({
                crop: expect.objectContaining({ x: 0.2, y: 0.1 }),
              }),
            }),
          }),
        })
      )
    );

    fireEvent.click(screen.getByRole('button', { name: 'conversation.creativeStudio.phase.review.cut.resetClip' }));
    await waitFor(() =>
      expect(bridge.updateCut.invoke).toHaveBeenLastCalledWith(
        expect.objectContaining({
          cut: expect.objectContaining({
            clips: expect.objectContaining({
              'clip-selected': {
                sourceInSeconds: null,
                sourceOutSeconds: null,
                crop: null,
                filters: [],
              },
            }),
          }),
        })
      )
    );
  });

  it('changes the aspect-locked crop scale from the select keyboard path', async () => {
    const reviewController = controller();
    reviewController.project.assets['asset-1'] = {
      ...reviewController.project.assets['asset-1']!,
      width: 960,
      height: 720,
    };
    render(<ReviewPhaseWithRender controller={reviewController} />);
    const scale = screen.getByRole('combobox', { name: 'conversation.creativeStudio.phase.review.cut.scale' });

    fireEvent.keyDown(scale, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13 });
    await waitFor(() => expect(scale).toHaveAttribute('aria-expanded', 'true'));
    fireEvent.keyDown(scale, { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, which: 40 });
    fireEvent.keyDown(scale, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13 });

    await waitFor(() =>
      expect(bridge.updateCut.invoke).toHaveBeenLastCalledWith(
        expect.objectContaining({
          cut: expect.objectContaining({
            clips: expect.objectContaining({
              'clip-selected': expect.objectContaining({
                crop: { x: 0.15, y: 0.238, width: 0.7, height: 0.525 },
              }),
            }),
          }),
        })
      )
    );
  });

  it('offers keyboard-operable placement only for canonical takes outside a manual cut', async () => {
    const reviewController = controller();
    const outsideScene = reviewController.project.scenes['scene-slate']!;
    outsideScene.selectedAssetId = 'asset-outside';
    outsideScene.assetIds = ['asset-outside'];
    reviewController.project.assets['asset-outside'] = asset('asset-outside', outsideScene.id);
    reviewController.project.cuts!['cut-1']!.orderMode = 'manual';

    const view = render(<ReviewPhaseWithRender controller={reviewController} />);
    expect(screen.getByText('conversation.creativeStudio.phase.review.cut.divergence')).toBeVisible();
    const add = screen.getByRole('button', {
      name: 'conversation.creativeStudio.phase.review.cut.addToEnd:Missing close',
    });
    fireEvent.keyDown(add, { key: 'Enter' });

    await waitFor(() =>
      expect(bridge.placeCutScenes.invoke).toHaveBeenCalledExactlyOnceWith({
        projectId: 'project-1',
        expectedRevision: 12,
        cutId: 'cut-1',
        sceneIds: ['scene-slate'],
        beforeClipId: null,
      })
    );

    view.unmount();
    const storyboardController = controller();
    const storyboardOutside = storyboardController.project.scenes['scene-slate']!;
    storyboardOutside.selectedAssetId = 'asset-outside';
    storyboardOutside.assetIds = ['asset-outside'];
    storyboardController.project.assets['asset-outside'] = asset('asset-outside', storyboardOutside.id);
    render(<ReviewPhaseWithRender controller={storyboardController} />);
    expect(screen.queryByText('conversation.creativeStudio.phase.review.cut.outsideTitle')).not.toBeInTheDocument();
  });

  it('seeks from the timeline, follows the selected video on stage, and sets I at the playhead', async () => {
    const reviewController = controller();
    const selected = reviewController.project.scenes['scene-selected']!;
    selected.mediaKind = 'video';
    reviewController.project.assets['asset-1'] = {
      ...reviewController.project.assets['asset-1']!,
      mediaKind: 'video',
      mimeType: 'video/mp4',
      managedAsset: { collection: 'assets', fileName: 'asset-1.mp4' },
    };
    render(<ReviewPhaseWithRender controller={reviewController} />);
    const track = document.querySelector<HTMLElement>('[data-cut-timeline-track]')!;
    vi.spyOn(track, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 100,
      bottom: 20,
      width: 100,
      height: 20,
      toJSON: () => ({}),
    });

    fireEvent.click(track, { clientX: 10 });

    const video = screen.getByLabelText('conversation.creativeStudio.preview.videoLabel') as HTMLVideoElement;
    await waitFor(() => expect(video.currentTime).toBeCloseTo(2.52, 2));
    expect(reviewController.editor.selectScene).toHaveBeenCalledWith('scene-selected');

    fireEvent.keyDown(screen.getByRole('region', { name: 'conversation.creativeStudio.timeline.title' }), {
      key: 'I',
    });
    await waitFor(() =>
      expect(bridge.updateCut.invoke).toHaveBeenLastCalledWith(
        expect.objectContaining({
          cut: expect.objectContaining({
            clips: expect.objectContaining({
              'clip-selected': expect.objectContaining({ sourceInSeconds: 2.52 }),
            }),
          }),
        })
      )
    );
  });

  it('sets O at the timeline playhead and toggles video transport with Space', async () => {
    const reviewController = controller();
    const selected = reviewController.project.scenes['scene-selected']!;
    selected.mediaKind = 'video';
    reviewController.project.assets['asset-1'] = {
      ...reviewController.project.assets['asset-1']!,
      mediaKind: 'video',
      mimeType: 'video/mp4',
      managedAsset: { collection: 'assets', fileName: 'asset-1.mp4' },
    };
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    render(<ReviewPhaseWithRender controller={reviewController} />);
    const timeline = screen.getByRole('region', { name: 'conversation.creativeStudio.timeline.title' });
    const track = document.querySelector<HTMLElement>('[data-cut-timeline-track]')!;
    vi.spyOn(track, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 100,
      bottom: 20,
      width: 100,
      height: 20,
      toJSON: () => ({}),
    });
    fireEvent.click(track, { clientX: 10 });

    fireEvent.keyDown(timeline, { key: ' ' });
    expect(play).toHaveBeenCalledOnce();
    const video = screen.getByLabelText('conversation.creativeStudio.preview.videoLabel');
    Object.defineProperty(video, 'paused', { configurable: true, value: false });
    fireEvent.keyDown(timeline, { key: ' ' });
    expect(pause).toHaveBeenCalledOnce();

    fireEvent.keyDown(timeline, { key: 'O' });
    await waitFor(() =>
      expect(bridge.updateCut.invoke).toHaveBeenLastCalledWith(
        expect.objectContaining({
          cut: expect.objectContaining({
            clips: expect.objectContaining({
              'clip-selected': expect.objectContaining({ sourceOutSeconds: 2.52 }),
            }),
          }),
        })
      )
    );
  });

  it('shows the selected take and changes variations with the canonical project revision', () => {
    const reviewController = controller();
    render(<ReviewPhaseWithRender controller={reviewController} />);

    expect(screen.getByRole('img', { name: 'conversation.creativeStudio.preview.imageAlt' })).toHaveAttribute(
      'src',
      'weprompt-studio://asset/project-1/asset-1'
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'conversation.creativeStudio.preview.selectVersionAccessible:2' })
    );

    expect(reviewController.selectVariation).toHaveBeenCalledExactlyOnceWith({
      projectId: 'project-1',
      sceneId: 'scene-selected',
      assetId: 'asset-2',
      expectedRevision: 12,
    });
  });

  it('shows a labeled scene slate with timing and handoff exclusion when no take is selected', () => {
    render(<ReviewPhaseWithRender controller={controller('scene-slate')} />);

    const preview = screen.getByRole('region', { name: 'conversation.creativeStudio.preview.title' });
    expect(within(preview).getByText('Missing close')).toBeVisible();
    expect(within(preview).getByText('conversation.creativeStudio.scene.durationSeconds:7,7')).toBeVisible();
    expect(within(preview).getByText('conversation.creativeStudio.phase.review.excludedFromHandoff')).toBeVisible();
  });

  it('keeps every takeless storyboard scene as a labeled slate outside the rendered clip order', () => {
    const { container } = render(<ReviewPhaseWithRender controller={controller()} />);

    expect(container.querySelectorAll('[data-cut-clip-id]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-slate-scene-id]')).toHaveLength(3);
    expect(screen.getAllByText('conversation.creativeStudio.phase.review.slateLabel')).toHaveLength(1);
  });

  it('labels selected, slate, running, and failed cut states without relying on colour', () => {
    render(<ReviewPhaseWithRender controller={controller()} />);

    expect(
      screen.getByRole('button', {
        name: 'conversation.creativeStudio.phase.review.cut.clipAccessible:1,Selected opening,4.2',
      })
    ).toHaveAccessibleDescription('conversation.creativeStudio.phase.review.selectedTake');
    expect(
      screen.getByRole('button', {
        name: 'conversation.creativeStudio.timeline.selectSceneAccessible:2,Missing close,7',
      })
    ).toHaveAccessibleDescription('conversation.creativeStudio.phase.review.slateLabel');
    expect(
      screen.getByRole('button', {
        name: 'conversation.creativeStudio.timeline.selectSceneAccessible:3,Running reveal,5',
      })
    ).toHaveAccessibleDescription('conversation.creativeStudio.scene.status.generating');
    expect(
      screen.getByRole('button', {
        name: 'conversation.creativeStudio.timeline.selectSceneAccessible:4,Failed end card,5',
      })
    ).toHaveAccessibleDescription('conversation.creativeStudio.jobs.status.failed');
  });

  it('keeps the new footer and rail state styling on tokens defined for light and dark themes', () => {
    const cutStyles = readFileSync(
      'packages/desktop/src/renderer/pages/studio/components/Preview/CutEditor/cut-editor.module.css',
      'utf8'
    );
    const footerStyles = readFileSync(
      'packages/desktop/src/renderer/pages/studio/components/PhaseShell/phases/ReviewPhase.module.css',
      'utf8'
    );
    const themeStyles = readFileSync('packages/desktop/src/renderer/styles/themes/default-color-scheme.css', 'utf8');

    expect(cutStyles).toMatch(/\.failedState\s*\{[^}]*color:\s*var\(--danger\)/);
    expect(cutStyles).toMatch(/\.slateItem\s*\{[^}]*background-image:\s*var\(--cut-slate-hatch\)/);
    expect(cutStyles).toMatch(/\.trimHandle[^}]*\}[\s\S]*?background:\s*var\(--control-handle\)/);
    expect(cutStyles).toMatch(/\.cropOverlay\s*\{[^}]*border:\s*2px solid var\(--control-handle\)/);
    expect(cutStyles).toMatch(/\.zeroTick\s*\{[^}]*background:\s*var\(--control-zero-tick\)/);
    expect(cutStyles).toMatch(/\.colourControl[^}]*\.arco-slider-button[^}]*border-color:\s*var\(--control-handle\)/);
    expect(`${cutStyles}\n${footerStyles}`).not.toMatch(/#[\da-f]{3,8}|rgba?\(/i);
    expect(themeStyles.match(/--danger:/g)).toHaveLength(2);
    expect(themeStyles.match(/--color-fill-2:/g)).toHaveLength(2);
  });

  it('keeps the selected clip duration legible on the brand plate', () => {
    const cutStyles = readFileSync(
      'packages/desktop/src/renderer/pages/studio/components/Preview/CutEditor/cut-editor.module.css',
      'utf8'
    );

    // The duration carries the shared `meta` type, which pins --text-secondary. On the selected
    // plate that measured 1.27:1 against --brand, so it has to take the plate's own foreground.
    expect(cutStyles).toMatch(/\.clipPlate\[aria-current='true'\][^{]*\.clipDuration\s*\{[^}]*color:\s*inherit/);
  });

  it('uses the same neutral fact chip for chosen, trimmed, and graded facts', () => {
    const { container } = render(<ReviewPhaseWithRender controller={controller()} />);
    const chosen = container.querySelector<HTMLElement>('[data-selected-take-chip]');
    const editMarks = container.querySelectorAll<HTMLElement>('[data-cut-fact-chip]');

    expect(chosen).not.toBeNull();
    expect(editMarks).toHaveLength(2);
    for (const chip of [chosen!, ...editMarks]) {
      expect(chip).toHaveClass('bg-fill-2', 'text-t-secondary');
      expect(chip.className).not.toMatch(/danger|warning|primary/);
    }
  });

  it('preserves strip-title ellipsis and non-truncating durations, counts, colour labels, and footer action', async () => {
    const { container } = render(<ReviewPhaseWithRender controller={controller()} layoutMode='compact' />);
    const cutStyles = readFileSync(
      'packages/desktop/src/renderer/pages/studio/components/Preview/CutEditor/cut-editor.module.css',
      'utf8'
    );
    const footerStyles = readFileSync(
      'packages/desktop/src/renderer/pages/studio/components/PhaseShell/phases/ReviewPhase.module.css',
      'utf8'
    );

    expect(container.querySelector('[data-cut-title]')).toHaveAttribute('title', 'Selected opening');
    expect(container.querySelectorAll('[data-cut-duration]')).toHaveLength(4);
    fireEvent.click(
      screen.getByRole('button', {
        name: 'conversation.creativeStudio.phase.review.cut.clipAccessible:1,Selected opening,4.2',
      })
    );
    await screen.findByRole('complementary', {
      name: 'conversation.creativeStudio.phase.review.cut.inspector',
    });
    expect(document.querySelectorAll('[data-colour-label]')).toHaveLength(4);
    expect(container.querySelectorAll('[data-render-count]')).toHaveLength(2);
    expect(container.querySelectorAll('[data-render-footer-line]').length).toBeGreaterThan(0);
    expect(container.querySelector('[data-render-primary-action]')).toBeInTheDocument();

    expect(cutStyles).toMatch(/\.clipTitle\s*\{[^}]*text-overflow:\s*ellipsis[^}]*white-space:\s*nowrap/);
    expect(cutStyles).toMatch(/\.clipDuration\s*\{[^}]*white-space:\s*nowrap/);
    expect(cutStyles).toMatch(/\.colourLabel\s*>\s*span\s*\{[^}]*white-space:\s*nowrap/);
    expect(footerStyles).toMatch(/\.handoffSummary span\s*\{[^}]*white-space:\s*nowrap/);
    expect(footerStyles).toMatch(/\.handoffDescription\s*\{[^}]*white-space:\s*normal/);
    expect(footerStyles).toMatch(/\.renderPrimaryAction\s*\{[^}]*flex-shrink:\s*0/);
    expect(`${cutStyles}\n${footerStyles}`).not.toMatch(/text-overflow:\s*ellipsis[^}]*data-render-footer-line/);
  });

  it('keeps a takeless storyboard slate at its intended position between clips', () => {
    const reviewController = controller();
    const running = reviewController.project.scenes['scene-running']!;
    running.selectedAssetId = 'asset-running';
    running.assetIds = ['asset-running'];
    reviewController.project.assets['asset-running'] = asset('asset-running', running.id);
    reviewController.project.cuts!['cut-1']!.clips['clip-running'] = {
      id: 'clip-running',
      sceneId: running.id,
      assetId: 'asset-running',
      sourceInSeconds: null,
      sourceOutSeconds: null,
      crop: null,
      filters: [],
    };
    reviewController.project.cuts!['cut-1']!.clipOrder.push('clip-running');
    const { container } = render(<ReviewPhaseWithRender controller={reviewController} />);

    const timelineItems = [...(container.querySelector('[data-cut-timeline-track] ol')?.children ?? [])].map(
      (item) => item.getAttribute('data-cut-clip-id') ?? item.getAttribute('data-slate-scene-id')
    );
    expect(timelineItems.slice(0, 3)).toEqual(['clip-selected', 'scene-slate', 'clip-running']);
  });

  it('keeps a selected take visibly in cut while another variation renders', () => {
    const reviewController = controller();
    reviewController.readiness = {
      ...reviewController.readiness,
      sceneStatuses: { ...reviewController.readiness.sceneStatuses, 'scene-selected': 'generating' },
    };
    const { container } = render(<ReviewPhaseWithRender controller={reviewController} />);

    expect(container.querySelector("[data-cut-clip-id='clip-selected']")).not.toBeNull();
    expect(screen.getByText('conversation.creativeStudio.phase.review.renderedShots:1')).toBeVisible();
  });

  it('never exposes generation actions in Review', () => {
    render(<ReviewPhaseWithRender controller={controller('scene-slate')} />);

    expect(
      screen.queryByRole('button', { name: 'conversation.creativeStudio.preview.generateThisScene' })
    ).not.toBeInTheDocument();
    expect(screen.queryByText('conversation.creativeStudio.review.generateScene')).not.toBeInTheDocument();
  });

  it('keeps the handoff summary with the render action at the foot of the cut', () => {
    render(<ReviewPhaseWithRender controller={controller()} />);

    const renderFoot = screen.getByRole('contentinfo', {
      name: 'conversation.creativeStudio.phase.review.render.footer',
    });
    expect(renderFoot).toContainElement(
      screen.getByText('conversation.creativeStudio.phase.review.handoffDescription')
    );
    expect(renderFoot).toContainElement(
      screen.getByRole('button', { name: 'conversation.creativeStudio.phase.review.render.action' })
    );
  });

  it('shows the render action and a non-blocking missing-take count', () => {
    bridge.renderCut.invoke.mockReturnValueOnce(new Promise(() => {}));
    render(<ReviewPhaseWithRender controller={controller()} />);

    const action = screen.getByRole('button', { name: 'conversation.creativeStudio.phase.review.render.action' });
    expect(action).toBeEnabled();
    expect(screen.getByText('conversation.creativeStudio.phase.review.render.missingScenes:3')).toBeVisible();

    fireEvent.click(action);
    expect(bridge.renderCut.invoke).toHaveBeenCalledExactlyOnceWith({ projectId: 'project-1' });
  });

  it('keeps the primary action in one slot while showing percentage and clip count', async () => {
    const pending = deferred<{
      ok: false;
      error: { code: 'cancelled'; messageKey: string };
    }>();
    bridge.renderCut.invoke.mockReturnValueOnce(pending.promise);
    render(<ReviewPhaseWithRender controller={controller()} />);

    const action = screen.getByRole('button', { name: 'conversation.creativeStudio.phase.review.render.action' });
    const slot = action.closest('[data-render-state-slot]');
    fireEvent.click(action);

    expect(
      screen.getByRole('button', { name: 'conversation.creativeStudio.phase.review.render.progress:0' })
    ).toBeDisabled();
    act(() =>
      renderProgressListener?.({
        projectId: 'project-1',
        status: 'running',
        progress: 0.42,
        clipIndex: 2,
        clipTotal: 3,
      })
    );
    expect(
      screen.getByRole('button', { name: 'conversation.creativeStudio.phase.review.render.progressWithClip:42,2,3' })
    ).toBeDisabled();
    expect(action.closest('[data-render-state-slot]')).toBe(slot);

    pending.resolve({
      ok: false,
      error: {
        code: 'cancelled',
        messageKey: 'conversation.creativeStudio.phase.review.render.errors.cancelled',
      },
    });
    await screen.findByText('conversation.creativeStudio.phase.review.render.errors.cancelled');
  });

  it('degrades a legacy running event with no clip fields to percentage only', () => {
    render(<ReviewPhaseWithRender controller={controller()} />);

    act(() => renderProgressListener?.({ projectId: 'project-1', status: 'running', progress: 0.42 }));

    expect(
      screen.getByRole('button', { name: 'conversation.creativeStudio.phase.review.render.progress:42' })
    ).toBeDisabled();
    expect(document.body).not.toHaveTextContent('undefined');
  });

  it('states the busy reason visibly and accessibly before the disabled action is hit', () => {
    render(<ReviewPhaseWithRender controller={controller()} />);

    act(() =>
      renderProgressListener?.({
        projectId: 'project-1',
        status: 'running',
        progress: 0.25,
        clipIndex: 1,
        clipTotal: 3,
      })
    );

    const busyAction = screen.getByRole('button', {
      name: 'conversation.creativeStudio.phase.review.render.progressWithClip:25,1,3',
    });
    expect(busyAction).toBeDisabled();
    expect(busyAction).toHaveAccessibleDescription('conversation.creativeStudio.phase.review.render.busyReason');
    expect(screen.getByText('conversation.creativeStudio.phase.review.render.busyReason')).toBeVisible();
    fireEvent.click(busyAction);
    expect(bridge.renderCut.invoke).not.toHaveBeenCalled();
  });

  it('offers only FFmpeg installation for an unavailable renderer', () => {
    render(<ReviewPhaseWithRender controller={controller()} />);
    act(() =>
      renderProgressListener?.({
        projectId: 'project-1',
        status: 'failed',
        progress: 0,
        errorCode: 'ffmpeg_unavailable',
      })
    );

    const slot = screen
      .getByText('conversation.creativeStudio.phase.review.render.errors.ffmpegUnavailable')
      .closest('[data-render-state-slot]')!;
    const actions = within(slot as HTMLElement).getAllByRole('button');
    expect(actions).toHaveLength(1);
    expect(actions[0]).toHaveAccessibleName('conversation.creativeStudio.phase.review.render.installFfmpeg');
    fireEvent.click(actions[0]!);
    expect(external.openExternalUrl).toHaveBeenCalledExactlyOnceWith('https://ffmpeg.org/download.html');
  });

  it('names the failed clip and offers only a render retry', async () => {
    render(<ReviewPhaseWithRender controller={controller()} />);
    act(() =>
      renderProgressListener?.({
        projectId: 'project-1',
        status: 'failed',
        progress: 0.51,
        errorCode: 'render_failed',
        clipIndex: 2,
        clipTotal: 3,
      })
    );

    const failure = screen.getByText('conversation.creativeStudio.phase.review.render.errors.failedClip:2,3');
    const slot = failure.closest('[data-render-state-slot]')!;
    expect(slot).not.toHaveTextContent(/asset-|scene-/);
    const actions = within(slot as HTMLElement).getAllByRole('button');
    expect(actions).toHaveLength(1);
    expect(actions[0]).toHaveAccessibleName('conversation.creativeStudio.phase.review.render.tryAgain');
    await act(async () => fireEvent.click(actions[0]!));
    expect(bridge.renderCut.invoke).toHaveBeenCalledExactlyOnceWith({ projectId: 'project-1' });
  });

  it('names missing shots and offers only the Produce recovery for no renderable scenes', () => {
    const reviewController = controller();
    render(<ReviewPhaseWithRender controller={reviewController} />);
    act(() =>
      renderProgressListener?.({
        projectId: 'project-1',
        status: 'failed',
        progress: 0,
        errorCode: 'no_renderable_scenes',
        missingSceneIds: ['scene-slate', 'scene-running', 'scene-failed'],
      })
    );

    const failure = screen.getByText(
      'conversation.creativeStudio.phase.review.render.errors.noRenderableShots:3,02, 03, 04'
    );
    const slot = failure.closest('[data-render-state-slot]')!;
    expect(slot).not.toHaveTextContent(/scene-slate|scene-running|scene-failed/);
    const actions = within(slot as HTMLElement).getAllByRole('button');
    expect(actions).toHaveLength(1);
    expect(actions[0]).toHaveAccessibleName('conversation.creativeStudio.phase.review.render.openProduce');
    fireEvent.click(actions[0]!);
    expect(reviewController.requestTransition).toHaveBeenCalledExactlyOnceWith({ phase: 'produce' });
  });

  it.each([
    ['ffmpeg_unavailable', 'conversation.creativeStudio.phase.review.render.errors.ffmpegUnavailable'],
    ['render_failed', 'conversation.creativeStudio.phase.review.render.errors.failed'],
    ['cancelled', 'conversation.creativeStudio.phase.review.render.errors.cancelled'],
  ] as const)('shows the distinct %s render failure', async (code, messageKey) => {
    bridge.renderCut.invoke.mockResolvedValueOnce({ ok: false, error: { code, messageKey: 'generic-error' } });
    render(<ReviewPhaseWithRender controller={controller()} />);

    fireEvent.click(screen.getByRole('button', { name: 'conversation.creativeStudio.phase.review.render.action' }));

    expect(await screen.findByText(messageKey)).toBeVisible();
  });

  it('exposes the playable result from the terminal event without polling', async () => {
    const pending = deferred<{
      ok: true;
      data: { assetId: string; missingSceneIds: string[] };
    }>();
    bridge.renderCut.invoke.mockReturnValueOnce(pending.promise);
    render(<ReviewPhaseWithRender controller={controller()} />);
    fireEvent.click(screen.getByRole('button', { name: 'conversation.creativeStudio.phase.review.render.action' }));

    act(() =>
      renderProgressListener?.({
        projectId: 'project-1',
        status: 'succeeded',
        progress: 1,
        assetId: 'render-1',
        missingSceneIds: ['scene-slate'],
      })
    );

    expect(screen.getByLabelText('conversation.creativeStudio.phase.review.render.resultLabel')).toHaveAttribute(
      'src',
      'weprompt-studio://asset/project-1/render-1'
    );
    pending.resolve({ ok: true, data: { assetId: 'render-1', missingSceneIds: ['scene-slate'] } });
    await waitFor(() => expect(bridge.renderCut.invoke).toHaveBeenCalledOnce());
  });
});

describe('Cut render without a project', () => {
  it('neither subscribes nor spends while the project scope has no id yet', async () => {
    const { result } = renderHook(() => useStudioRender(undefined));

    await act(async () => {
      await result.current.render();
      await result.current.cancel();
    });

    expect(bridge.renderProgress.on).not.toHaveBeenCalled();
    expect(bridge.renderCut.invoke).not.toHaveBeenCalled();
    expect(bridge.cancelRender.invoke).not.toHaveBeenCalled();
    expect(result.current.status).toBe('idle');
  });
});
