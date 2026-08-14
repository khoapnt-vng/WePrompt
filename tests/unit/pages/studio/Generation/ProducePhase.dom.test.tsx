/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  StudioAsset,
  StudioRendererJob,
  StudioRendererProject,
  StudioRouteCatalog,
  StudioRouteCatalogEntry,
  StudioScene,
} from '@/common/types/project/creativeStudioTypes';
import { ProducePhase } from '@renderer/pages/studio/components/PhaseShell/phases/ProducePhase';
import type { ProducePhaseController } from '@renderer/pages/studio/components/PhaseShell/types';
import { ManagedVideoError } from '@renderer/pages/studio/components/Preview/managedVideo';
import { managedVideo } from '@renderer/pages/studio/hooks/useManagedVideo';
import type { UseStoryboardEditorResult } from '@renderer/pages/studio/hooks/useStoryboardEditor';
import type { UseStudioJobsResult } from '@renderer/pages/studio/hooks/useStudioJobs';
import type { UseStudioModelsResult } from '@renderer/pages/studio/hooks/useStudioModels';
import { deriveStudioReadiness } from '@renderer/pages/studio/studioReadiness';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values
        ? `${key}:${Object.entries(values)
            .map(([name, value]) => `${name}=${String(value)}`)
            .join(',')}`
        : key,
    // EngineBar joins the ready media kinds with Intl.ListFormat, so the locale must exist.
    i18n: { language: 'en' },
  }),
}));

const scene = (overrides: Partial<StudioScene> = {}): StudioScene => ({
  id: 'scene-1',
  title: 'Opening shot',
  purpose: '',
  visualPrompt: 'A wide sunrise over the city',
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

const asset = (overrides: Partial<StudioAsset> = {}): StudioAsset => ({
  id: 'asset-1',
  projectId: 'project-1',
  sceneId: 'scene-1',
  mediaKind: 'image',
  mimeType: 'image/png',
  managedAsset: { collection: 'assets', fileName: 'asset-1.png' },
  byteSize: 128,
  sha256: '1'.repeat(64),
  createdAt: '2026-08-04T00:00:00.000Z',
  ...overrides,
});

const job = (overrides: Partial<StudioRendererJob> = {}): StudioRendererJob => ({
  id: 'job-1',
  projectId: 'project-1',
  sceneId: 'scene-1',
  status: 'running',
  provider: {
    choiceId: 'choice-image',
    providerId: 'provider-image',
    model: 'image-model',
  },
  outputAssetIds: [],
  error: null,
  canCancel: false,
  canRetryDownload: false,
  retryOfJobId: null,
  retryReason: null,
  duplicateChargeAcknowledged: false,
  duplicateChargeAcknowledgedAt: null,
  createdAt: '2026-08-04T00:00:00.000Z',
  updatedAt: '2026-08-04T00:00:00.000Z',
  ...overrides,
});

const route = (kind: 'image' | 'video'): StudioRouteCatalogEntry => ({
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
    minDurationSeconds: 1,
    maxDurationSeconds: 60,
    supportsFirstFrame: true,
    silentOutput: true,
  },
});

const catalog = (videoSetupRequired = false): StudioRouteCatalog => {
  const imageRoute = route('image');
  const videoRoute = route('video');
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
        choiceId: imageRoute.choiceId,
        providerId: imageRoute.providerId,
        model: imageRoute.model,
      },
      selectedRoute: imageRoute,
      selectionIssue: null,
      options: [imageRoute],
    },
    video: videoSetupRequired
      ? { status: 'setup_required', selected: null, selectedRoute: null, selectionIssue: null, options: [] }
      : {
          status: 'ready',
          selected: {
            choiceId: videoRoute.choiceId,
            providerId: videoRoute.providerId,
            model: videoRoute.model,
          },
          selectedRoute: videoRoute,
          selectionIssue: null,
          options: [videoRoute],
        },
    catalogVersion: 'catalog-v1',
  };
};

const disconnectedCatalog = (): StudioRouteCatalog => {
  const imageRoute = route('image');
  const videoRoute = route('video');
  return {
    ...catalog(),
    image: {
      status: 'selection_required',
      selected: null,
      selectedRoute: null,
      selectionIssue: null,
      options: [imageRoute],
    },
    video: {
      status: 'selection_required',
      selected: null,
      selectedRoute: null,
      selectionIssue: null,
      options: [videoRoute],
    },
  };
};

const project = (overrides: Partial<StudioRendererProject> = {}): StudioRendererProject => {
  const opening = scene();
  const closing = scene({
    id: 'scene-2',
    title: 'Closing shot',
    visualPrompt: '',
    mediaKind: 'video',
  });
  return {
    schemaVersion: 1,
    revision: 1,
    id: 'project-1',
    name: 'Project',
    brief: '',
    aspectRatio: '16:9',
    targetDurationSeconds: 10,
    resolution: '720p',
    sceneOrder: [opening.id, closing.id],
    scenes: { [opening.id]: opening, [closing.id]: closing },
    assets: {},
    jobs: {},
    routing: {
      storyboard: { providerId: 'planner', model: 'planner-model' },
      image: { choiceId: 'choice-image', providerId: 'provider-image', model: 'image-model' },
      video: { choiceId: 'choice-video', providerId: 'provider-video', model: 'video-model' },
    },
    createdAt: '2026-08-04T00:00:00.000Z',
    updatedAt: '2026-08-04T00:00:00.000Z',
    ...overrides,
  };
};

const editor = (currentProject: StudioRendererProject, selectedSceneId = 'scene-1'): UseStoryboardEditorResult => {
  const selectedScene = currentProject.scenes[selectedSceneId] ?? null;
  const orderedScenes = currentProject.sceneOrder.flatMap((sceneId) => {
    const candidate = currentProject.scenes[sceneId];
    return candidate === undefined ? [] : [candidate];
  });
  const durationTotalSeconds = orderedScenes.reduce((total, candidate) => total + candidate.durationSeconds, 0);
  return {
    project: currentProject,
    orderedScenes,
    selectedSceneId,
    selectedScene,
    sceneDraft: selectedScene,
    projectDraft: null,
    projectSaveState: 'saved',
    hasUnsavedProjectDraft: false,
    hasUnsavedSceneDrafts: false,
    hasUnsavedSelectedSceneDraft: false,
    selectedSceneSaveState: 'saved',
    saveIssues: [],
    selectScene: vi.fn(),
    updateSceneDraft: vi.fn(),
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
    durationTotalSeconds,
    durationMatchesTarget: durationTotalSeconds === currentProject.targetDurationSeconds,
    remainingDurationSeconds: currentProject.targetDurationSeconds - durationTotalSeconds,
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
  };
};

const createController = (
  currentProject = project(),
  selectedSceneId = 'scene-1',
  currentCatalog: StudioRouteCatalog | null = catalog()
): ProducePhaseController => {
  const currentEditor = editor(currentProject, selectedSceneId);
  const models: UseStudioModelsResult = {
    catalog: currentCatalog,
    loading: false,
    errorMessageKey: null,
    pendingRole: null,
    refresh: vi.fn(async () => undefined),
    updateSelection: vi.fn(async () => true),
  };
  const jobs: UseStudioJobsResult = {
    project: currentProject,
    jobs: Object.values(currentProject.jobs),
    mutationPending: false,
    issue: null,
    staleIntent: null,
    clearIssue: vi.fn(),
    clearStaleIntent: vi.fn(),
    submitScenes: vi.fn(async () => true),
    cancelJob: vi.fn(async () => true),
    retryJob: vi.fn(async () => true),
    retryDownload: vi.fn(async () => true),
  };
  return {
    project: currentProject,
    readiness: deriveStudioReadiness(currentProject),
    editor: currentEditor,
    models,
    jobs,
    selectedAsset:
      currentEditor.selectedScene?.selectedAssetId === null ||
      currentEditor.selectedScene?.selectedAssetId === undefined
        ? null
        : (currentProject.assets[currentEditor.selectedScene.selectedAssetId] ?? null),
    posterAsset: null,
    advisory: null,
    mutationPending: false,
    requestTransition: vi.fn(),
    openSingleGenerationReview: vi.fn(),
    openBatchGenerationReview: vi.fn(),
    openModelSettings: vi.fn((_path?: '/settings/model') => undefined),
    selectVariation: vi.fn(async () => undefined),
    openDuplicateChargeConfirmation: vi.fn(),
  };
};

describe('ProducePhase', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows only the connection door when no ready selected route exists', () => {
    const controller = createController(project(), 'scene-1', disconnectedCatalog());
    const { container } = render(<ProducePhase controller={controller} />);

    expect(
      screen.getByRole('heading', { name: 'conversation.creativeStudio.phase.produce.connectEngine' })
    ).toBeVisible();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('region', { name: 'conversation.creativeStudio.phase.produce.activityTitle' })
    ).not.toBeInTheDocument();
    expect(container.querySelectorAll('[role="alert"]')).toHaveLength(0);
  });

  it('routes the connection door actions to Model Settings and the shared clipboard utility', () => {
    const controller = createController(project(), 'scene-1', disconnectedCatalog());
    let copiedText = '';
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: false });
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn(() => {
        copiedText = document.querySelector('textarea')?.value ?? '';
        return true;
      }),
    });
    render(<ProducePhase controller={controller} />);

    fireEvent.click(screen.getByRole('button', { name: 'conversation.creativeStudio.models.openSettings' }));
    fireEvent.click(screen.getByRole('button', { name: 'conversation.creativeStudio.phase.produce.askTeammate' }));

    expect(controller.openModelSettings).toHaveBeenCalledExactlyOnceWith('/settings/model');
    expect(copiedText).toBe('conversation.creativeStudio.phase.produce.askTeammateCopy');
  });

  it('shows facts only from ready selected routes and opens settings through Change engines', () => {
    const imageRoute = route('image');
    imageRoute.constraints.maxDurationSeconds = 47;
    const controller = createController(project(), 'scene-1', {
      ...catalog(true),
      image: {
        ...catalog(true).image,
        selectedRoute: imageRoute,
        selectionIssue: null,
        options: [imageRoute],
      },
    });
    render(<ProducePhase controller={controller} />);

    // The engine chip hides the summary behind a hover, so the paid model and its duration
    // contract have to remain reachable through the trigger's description.
    expect(screen.getByRole('button', { name: /engineKinds/ })).toHaveAccessibleDescription(
      'conversation.creativeStudio.phase.produce.engineSummary:model=image-model,kind=conversation.creativeStudio.scene.image,seconds=47'
    );
    expect(screen.queryByText(/video-model/)).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'conversation.creativeStudio.phase.produce.changeEngines' }));
    expect(controller.openModelSettings).toHaveBeenCalledExactlyOnceWith('/settings/model');
  });

  it('keeps exactly one focus target for the shell to move focus to on a phase transition', () => {
    // StudioPhaseShell focuses [data-studio-phase-heading] after every transition; if the engine
    // strip ever drops or duplicates its heading, keyboard focus lands nowhere or on the wrong node.
    const { container } = render(<ProducePhase controller={createController()} />);

    const focusTargets = container.querySelectorAll('[data-studio-phase-heading]');
    expect(focusTargets).toHaveLength(1);
    expect(focusTargets[0]).toHaveAttribute('id', 'studio-produce-phase-heading');
    expect(focusTargets[0]).toHaveAttribute('tabindex', '-1');
    // It must name the VIEW. It used to be the engine strip's heading, so activating "Board" moved
    // focus to a heading announcing "Rendering with —" instead of where the user had just gone.
    expect(focusTargets[0]).toHaveTextContent('conversation.creativeStudio.phase.produce.title');
  });

  it('shows only canonical generated takes and opens the selected take preview from its card', () => {
    const firstTake = asset();
    const selectedTake = asset({ id: 'asset-2', managedAsset: { collection: 'assets', fileName: 'asset-2.png' } });
    const imported = asset({ id: 'import-1', managedAsset: { collection: 'imports', fileName: 'import-1.png' } });
    const thumbnail = asset({
      id: 'thumb-1',
      managedAsset: { collection: 'thumbnails', fileName: 'thumb-1.png' },
    });
    const currentProject = project({
      scenes: {
        'scene-1': scene({
          selectedAssetId: selectedTake.id,
          assetIds: [imported.id, firstTake.id, thumbnail.id, selectedTake.id],
        }),
        'scene-2': scene({ id: 'scene-2', title: 'Closing shot', mediaKind: 'video', visualPrompt: '' }),
      },
      assets: {
        [firstTake.id]: firstTake,
        [selectedTake.id]: selectedTake,
        [imported.id]: imported,
        [thumbnail.id]: thumbnail,
      },
    });
    render(<ProducePhase controller={createController(currentProject)} />);

    const opening = screen.getByRole('listitem', {
      name: 'conversation.creativeStudio.scene.accessibleName:number=1,title=Opening shot',
    });
    expect(
      within(opening).getByText('conversation.creativeStudio.phase.produce.takeRatio:current=2,total=2')
    ).toBeVisible();
    expect(within(opening).getByRole('img', { name: 'conversation.creativeStudio.preview.imageAlt' })).toHaveAttribute(
      'src',
      'weprompt-studio://asset/project-1/asset-2'
    );
    expect(screen.queryByRole('figure', { name: 'conversation.creativeStudio.preview.title' })).not.toBeInTheDocument();

    fireEvent.click(
      within(opening).getByRole('button', {
        name: 'conversation.creativeStudio.phase.produce.openPreview:title=Opening shot',
      })
    );
    expect(screen.getByRole('figure', { name: 'conversation.creativeStudio.preview.title' })).toBeVisible();
  });

  it('keeps a paid video take usable and labels it ready when poster capture cannot decode it', async () => {
    const selectedVideo = asset({
      id: 'video-1',
      sceneId: 'scene-2',
      mediaKind: 'video',
      mimeType: 'video/mp4',
      managedAsset: { collection: 'assets', fileName: 'video-1.mp4' },
    });
    const completedJob = job({
      id: 'job-video',
      sceneId: 'scene-2',
      status: 'succeeded',
      provider: { choiceId: 'choice-video', providerId: 'provider-video', model: 'video-model' },
      outputAssetIds: [selectedVideo.id],
    });
    const currentProject = project({
      scenes: {
        'scene-1': scene(),
        'scene-2': scene({
          id: 'scene-2',
          title: 'Closing shot',
          mediaKind: 'video',
          visualPrompt: 'A final wave',
          selectedAssetId: selectedVideo.id,
          assetIds: [selectedVideo.id],
          jobIds: [completedJob.id],
          reviewState: 'complete',
        }),
      },
      assets: { [selectedVideo.id]: selectedVideo },
      jobs: { [completedJob.id]: completedJob },
    });
    const open = vi.spyOn(managedVideo, 'open').mockRejectedValue(new ManagedVideoError('decode_unsupported'));
    const controller = createController(currentProject, 'scene-2');
    render(<ProducePhase controller={controller} />);

    // The third argument is the cancellation signal added by the BUG-026 leak fix.
    await waitFor(() => expect(open).toHaveBeenCalledExactlyOnceWith('project-1', 'video-1', expect.any(AbortSignal)));
    const closing = screen.getByRole('listitem', {
      name: 'conversation.creativeStudio.scene.accessibleName:number=2,title=Closing shot',
    });
    expect(within(closing).getByText('conversation.creativeStudio.preview.videoReady')).toBeVisible();
    expect(
      within(closing).queryByText('conversation.creativeStudio.preview.posterUnavailable')
    ).not.toBeInTheDocument();

    fireEvent.click(
      within(closing).getByRole('button', {
        name: 'conversation.creativeStudio.phase.produce.openPreview:title=Closing shot',
      })
    );
    const preview = screen.getByRole('figure', { name: 'conversation.creativeStudio.preview.title' });
    expect(within(preview).getByLabelText('conversation.creativeStudio.preview.videoLabel')).toHaveAttribute(
      'controls'
    );
    open.mockRestore();
  });

  it('selects a shot without opening or submitting generation', () => {
    const currentProject = project({
      scenes: {
        'scene-1': scene(),
        'scene-2': scene({ id: 'scene-2', title: 'Closing shot', mediaKind: 'video', visualPrompt: 'A final wave' }),
      },
    });
    const controller = createController(currentProject);
    render(<ProducePhase controller={controller} />);

    fireEvent.click(
      screen.getByRole('button', {
        name: 'conversation.creativeStudio.scene.accessibleName:number=2,title=Closing shot',
      })
    );

    expect(controller.editor.selectScene).toHaveBeenCalledExactlyOnceWith('scene-2');
    expect(controller.openSingleGenerationReview).not.toHaveBeenCalled();
    expect(controller.jobs.submitScenes).not.toHaveBeenCalled();
  });

  it('routes a blank-prompt shot to its Table visual field instead of offering generation', () => {
    const controller = createController();
    render(<ProducePhase controller={controller} />);
    const closing = screen.getByRole('listitem', {
      name: 'conversation.creativeStudio.scene.accessibleName:number=2,title=Closing shot',
    });

    expect(
      within(closing).queryByRole('button', { name: 'conversation.creativeStudio.phase.produce.render' })
    ).not.toBeInTheDocument();
    fireEvent.click(
      within(closing).getByRole('button', { name: 'conversation.creativeStudio.phase.produce.writeVisual' })
    );

    expect(controller.editor.selectScene).toHaveBeenCalledExactlyOnceWith('scene-2');
    expect(controller.requestTransition).toHaveBeenCalledExactlyOnceWith({
      view: 'table',
      state: { writeFocus: { sceneId: 'scene-2', field: 'visualPrompt' } },
    });
  });

  it('opens explicit single-shot review from a ready selected shot without submitting', () => {
    const controller = createController();
    render(<ProducePhase controller={controller} />);

    fireEvent.click(screen.getByRole('button', { name: 'conversation.creativeStudio.phase.produce.render' }));

    expect(controller.openSingleGenerationReview).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ sceneId: 'scene-1', routeStatus: 'valid' })
    );
    expect(controller.jobs.submitScenes).not.toHaveBeenCalled();
  });

  it('shows determinate progress and Cancel only for the exact displayed cancellable job', () => {
    const olderAuthorized = job({
      id: 'job-opening-older',
      canCancel: true,
      progress: 10,
      updatedAt: '2026-08-04T01:00:00.000Z',
    });
    const displayedOpening = job({
      id: 'job-opening-current',
      canCancel: false,
      progress: 64,
      updatedAt: '2026-08-04T02:00:00.000Z',
    });
    const displayedClosing = job({
      id: 'job-closing-current',
      sceneId: 'scene-2',
      provider: { choiceId: 'choice-video', providerId: 'provider-video', model: 'video-model' },
      canCancel: true,
      progress: 37,
      updatedAt: '2026-08-04T03:00:00.000Z',
    });
    const currentProject = project({
      scenes: {
        'scene-1': scene({ jobIds: [olderAuthorized.id, displayedOpening.id] }),
        'scene-2': scene({
          id: 'scene-2',
          title: 'Closing shot',
          mediaKind: 'video',
          visualPrompt: 'A final wave',
          jobIds: [displayedClosing.id],
        }),
      },
      jobs: {
        [olderAuthorized.id]: olderAuthorized,
        [displayedOpening.id]: displayedOpening,
        [displayedClosing.id]: displayedClosing,
      },
    });
    const controller = createController(currentProject);
    render(<ProducePhase controller={controller} />);

    const opening = screen.getByRole('listitem', {
      name: 'conversation.creativeStudio.scene.accessibleName:number=1,title=Opening shot',
    });
    const closing = screen.getByRole('listitem', {
      name: 'conversation.creativeStudio.scene.accessibleName:number=2,title=Closing shot',
    });
    expect(
      within(opening).queryByRole('button', { name: 'conversation.creativeStudio.jobs.cancel' })
    ).not.toBeInTheDocument();
    expect(within(closing).getByText('conversation.creativeStudio.jobs.progress:percent=37')).toBeVisible();

    fireEvent.click(within(closing).getByRole('button', { name: 'conversation.creativeStudio.jobs.cancel' }));
    expect(controller.jobs.cancelJob).toHaveBeenCalledExactlyOnceWith('job-closing-current');
  });

  /**
   * The paid control and its advisory live in the frame's top bar now; the assertions that they
   * open review rather than submit moved with them to `StudioPhaseShell.dom.test.tsx`.
   *
   * What has to stay here is the absence. Board is the view the batch button came from and the one
   * a reader would most naturally put it back on, and a second entry point to the only spend in
   * Studio is not a cosmetic duplicate — it is two buttons that can each charge a provider, with
   * only one of them holding the frame's disabled derivation. The advisory is checked too: routed
   * to the batch anchor it must render exactly once, in the frame, not once per surface that
   * happens to read `advisory`.
   */
  it('hosts no batch generation control or batch advisory now that the frame owns the spend', () => {
    const controller = createController(project());
    controller.advisory = {
      messageKey: 'conversation.creativeStudio.review.durationMismatch',
      anchor: 'batch',
    };
    render(<ProducePhase controller={controller} />);

    // Guards the guard: without a mounted engine surface every absence below passes vacuously.
    expect(screen.getByRole('heading', { name: /phase\.produce\.renderingWith/ })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /conversation\.creativeStudio\.review\.generateReadyScenes/ })
    ).not.toBeInTheDocument();
    expect(screen.queryByText('conversation.creativeStudio.review.durationMismatch')).not.toBeInTheDocument();
    expect(controller.openBatchGenerationReview).not.toHaveBeenCalled();
  });

  it('lists project activity across scenes instead of filtering to the selected shot', () => {
    const openingJob = job({ id: 'job-opening', sceneId: 'scene-1' });
    const closingJob = job({ id: 'job-closing', sceneId: 'scene-2', status: 'succeeded' });
    const currentProject = project({
      scenes: {
        'scene-1': scene({ jobIds: [openingJob.id] }),
        'scene-2': scene({
          id: 'scene-2',
          title: 'Closing shot',
          mediaKind: 'video',
          visualPrompt: 'A final wave',
          jobIds: [closingJob.id],
        }),
      },
      jobs: { [openingJob.id]: openingJob, [closingJob.id]: closingJob },
    });
    render(<ProducePhase controller={createController(currentProject)} />);

    const activity = screen.getByRole('region', {
      name: 'conversation.creativeStudio.phase.produce.activityTitle',
    });
    expect(within(activity).getByText('Opening shot')).toBeVisible();
    expect(within(activity).getByText('Closing shot')).toBeVisible();
  });
});
