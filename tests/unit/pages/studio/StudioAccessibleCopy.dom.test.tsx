/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fireEvent, getRoles, render, screen, within } from '@testing-library/react';
import i18next, { type i18n } from 'i18next';
import React from 'react';
import { I18nextProvider, useTranslation } from 'react-i18next';
import { describe, expect, it, vi } from 'vitest';

import i18nConfig from '@/common/config/i18n-config.json';
import type { StudioAsset, StudioRendererProject, StudioScene } from '@/common/types/project/creativeStudioTypes';
import { GenerationReviewModal } from '@renderer/pages/studio/components/Generation/GenerationReviewModal';
import { StudioPhaseHeader } from '@renderer/pages/studio/components/PhaseShell/StudioPhaseHeader';
import { StudioPhaseShell } from '@renderer/pages/studio/components/PhaseShell/StudioPhaseShell';
import { StudioViewSwitch } from '@renderer/pages/studio/components/PhaseShell/StudioViewSwitch';
import type { StudioPhaseControllers } from '@renderer/pages/studio/components/PhaseShell/types';
import { AssetStrip } from '@renderer/pages/studio/components/Preview/AssetStrip';
import { StudioExportModal } from '@renderer/pages/studio/components/Preview/StudioExportModal';
import { SceneTimeline } from '@renderer/pages/studio/components/SceneTimeline';
import type { UseStoryboardEditorResult } from '@renderer/pages/studio/hooks/useStoryboardEditor';
import type { UseStudioJobsResult } from '@renderer/pages/studio/hooks/useStudioJobs';
import type { UseStudioModelsResult } from '@renderer/pages/studio/hooks/useStudioModels';
import type { UseStudioRenderResult } from '@renderer/pages/studio/hooks/useStudioRender';
import { STUDIO_VIEWS } from '@renderer/pages/studio/studioPhaseRoute';
import conversation from '@renderer/services/i18n/locales/en-US/conversation.json';

vi.mock('@dnd-kit/core', async () => {
  const actual = await vi.importActual<typeof import('@dnd-kit/core')>('@dnd-kit/core');
  return {
    ...actual,
    DndContext: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    useSensor: vi.fn(() => ({})),
    useSensors: vi.fn((...sensors: unknown[]) => sensors),
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

vi.mock('@renderer/pages/studio/components/PhaseShell/phases/brief/useBriefConversation', () => ({
  useBriefConversation: () => ({
    state: { kind: 'absent' },
    errorMessageKey: null,
    recreate: vi.fn(),
  }),
}));

const localeRoot = join(process.cwd(), 'packages/desktop/src/renderer/services/i18n/locales');

const loadConversationLocale = (locale: string): typeof conversation =>
  JSON.parse(readFileSync(join(localeRoot, locale, 'conversation.json'), 'utf8')) as typeof conversation;

const createLocaleI18n = async (locale: string, resource = loadConversationLocale(locale)): Promise<i18n> => {
  const instance = i18next.createInstance();
  await instance.init({
    lng: locale,
    fallbackLng: false,
    resources: {
      [locale]: {
        translation: { conversation: resource },
      },
    },
    interpolation: { escapeValue: false },
  });
  return instance;
};

const renderEnglish = async (ui: React.ReactElement) => {
  const instance = await createLocaleI18n('en-US', conversation);
  return render(<I18nextProvider i18n={instance}>{ui}</I18nextProvider>);
};

const scene = (overrides: Partial<StudioScene> = {}): StudioScene => ({
  id: 'scene-2',
  title: 'Product close-up',
  purpose: 'Show the product',
  visualPrompt: 'A cinematic product close-up',
  narration: '',
  onScreenText: '',
  mediaKind: 'video',
  durationSeconds: 5,
  referenceAssetId: null,
  selectedAssetId: null,
  assetIds: [],
  jobIds: [],
  reviewState: 'draft',
  ...overrides,
});

const asset = (id: string): StudioAsset => ({
  id,
  projectId: 'project-1',
  sceneId: 'scene-2',
  mediaKind: 'video',
  mimeType: 'video/mp4',
  managedAsset: { collection: 'assets', fileName: `${id}.mp4` },
  byteSize: 128,
  sha256: '1'.repeat(64),
  createdAt: '2026-08-03T00:00:00.000Z',
});

const project = (overrides: Partial<StudioRendererProject> = {}): StudioRendererProject => ({
  schemaVersion: 1,
  revision: 1,
  id: 'project-1',
  name: 'Launch film',
  brief: 'A short launch video',
  aspectRatio: '16:9',
  targetDurationSeconds: 5,
  resolution: '720p',
  sceneOrder: [],
  scenes: {},
  assets: {},
  jobs: {},
  routing: { storyboard: null, image: null, video: null },
  createdAt: '2026-08-03T00:00:00.000Z',
  updatedAt: '2026-08-03T00:00:00.000Z',
  ...overrides,
});

const phaseController = (overrides: Partial<StudioPhaseControllers> = {}): StudioPhaseControllers => {
  const currentProject = project();
  const editor: UseStoryboardEditorResult = {
    project: currentProject,
    orderedScenes: [],
    selectedSceneId: null,
    selectedScene: null,
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
    durationTotalSeconds: 0,
    durationMatchesTarget: false,
    remainingDurationSeconds: currentProject.targetDurationSeconds,
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
  const models: UseStudioModelsResult = {
    catalog: null,
    loading: false,
    errorMessageKey: null,
    pendingRole: null,
    refresh: vi.fn(async () => undefined),
    updateSelection: vi.fn(async () => true),
  };
  const jobs: UseStudioJobsResult = {
    project: currentProject,
    jobs: [],
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
  // Copy under an idle cut render - the state Review showed before the render was hoisted.
  const cutRender: UseStudioRenderResult = {
    status: 'idle',
    progress: 0,
    clipIndex: null,
    clipTotal: null,
    assetId: null,
    missingSceneIds: null,
    errorCode: null,
    errorMessageKey: null,
    busy: false,
    render: vi.fn(async () => undefined),
    cancel: vi.fn(async () => undefined),
  };

  return {
    proposals: [],
    acceptProposal: vi.fn(),
    rejectProposal: vi.fn(),
    project: currentProject,
    readiness: {
      sceneStatuses: {},
      totalSceneCount: 0,
      readySceneIds: [],
      selectedAssetCount: 0,
      durationDeltaSeconds: currentProject.targetDurationSeconds,
    },
    editor,
    models,
    jobs,
    render: cutRender,
    selectedAsset: null,
    posterAsset: null,
    selectedReferenceAsset: null,
    writeFocusIntent: null,
    advisory: null,
    mutationPending: false,
    requestTransition: vi.fn(),
    openBrief: vi.fn(),
    openRules: vi.fn(),
    openDraftReview: vi.fn(),
    openSingleGenerationReview: vi.fn(),
    openBatchGenerationReview: vi.fn(),
    openExport: vi.fn(),
    openModelSettings: vi.fn(),
    importReference: vi.fn(async () => undefined),
    selectVariation: vi.fn(async () => undefined),
    clearWriteFocusIntent: vi.fn(),
    openDuplicateChargeConfirmation: vi.fn(),
    ...overrides,
  };
};

/**
 * A workspace with one adopted, ready image engine and one shot ready to generate — the only state
 * in which the frame shows its paid control. The default fixture has no engine, so every header
 * assertion below would otherwise be counting buttons in a workspace that cannot spend at all.
 */
const readyEngineController = (): StudioPhaseControllers => {
  const imageRoute = {
    choiceId: 'choice-image',
    providerId: 'provider-image',
    providerName: 'Image provider',
    model: 'image-model',
    integrationLabelKey: 'imageApi' as const,
    health: 'available' as const,
    kind: 'image' as const,
    constraints: {
      aspectRatios: ['16:9' as const],
      resolutions: ['720p' as const],
      minDurationSeconds: 1,
      maxDurationSeconds: 60,
      supportsFirstFrame: true,
      silentOutput: true,
    },
  };

  return phaseController({
    models: {
      catalog: {
        storyboard: { status: 'ready', selected: null, options: [] },
        image: {
          status: 'ready',
          selected: { choiceId: imageRoute.choiceId, providerId: imageRoute.providerId, model: imageRoute.model },
          selectedRoute: imageRoute,
          selectionIssue: null,
          options: [imageRoute],
        },
        video: { status: 'setup_required', selected: null, selectedRoute: null, selectionIssue: null, options: [] },
        catalogVersion: 'catalog-v1',
      },
      loading: false,
      errorMessageKey: null,
      pendingRole: null,
      refresh: vi.fn(async () => undefined),
      updateSelection: vi.fn(async () => true),
    },
    readiness: {
      sceneStatuses: { 'scene-1': 'ready' },
      totalSceneCount: 1,
      readySceneIds: ['scene-1'],
      selectedAssetCount: 0,
      durationDeltaSeconds: 0,
    },
  });
};

describe('Creative Studio full-sentence English copy', () => {
  it('keeps the Brief and Rules project objects together in the frame', async () => {
    await renderEnglish(
      <StudioPhaseShell activeView='table' controller={phaseController()} navigationDisabled={false} onBack={vi.fn()} />
    );

    const headerActions = document.querySelector<HTMLElement>('[data-studio-phase-actions]');
    expect(headerActions).not.toBeNull();
    expect(within(headerActions!).getAllByRole('button')).toHaveLength(2);
    expect(within(headerActions!).getByRole('button', { name: 'Brief' })).toBeInTheDocument();
    expect(within(headerActions!).getByRole('button', { name: 'Rules' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start writing' })).not.toBeInTheDocument();
  });

  /**
   * The readout's three terms in English, because the third one is a copy decision as much as a
   * data one: it says "rendered", not "ready". `readySceneIds` counts shots waiting to be
   * generated and drains to nothing as the film gets made, so a readout worded "ready" would
   * invite exactly the wrong field — and would read as progress running backwards.
   */
  it('reads the storyboard state as shots, runtime and rendered takes', async () => {
    await renderEnglish(
      <StudioPhaseShell
        activeView='table'
        controller={phaseController({
          readiness: {
            sceneStatuses: {},
            totalSceneCount: 9,
            readySceneIds: ['scene-8', 'scene-9'],
            selectedAssetCount: 7,
            durationTotalSeconds: 178,
            durationDeltaSeconds: 173,
          },
        })}
        navigationDisabled={false}
        onBack={vi.fn()}
      />
    );

    const readout = document.querySelector<HTMLElement>('[data-studio-state-readout]');
    expect(readout).toHaveTextContent('9 shots · 2:58 total · 7 rendered');
    expect(readout).not.toHaveTextContent('2 rendered');
  });

  /**
   * The frame's third action is the document's only spend, so what it says and when it appears are
   * both copy decisions. Two buttons that cost nothing and one that charges a provider sit in the
   * same row: the label has to name the charge and its size, which is why it counts the shots
   * rather than reading "Generate".
   */
  it('names the paid generation control by the shots it will charge for', async () => {
    await renderEnglish(
      <StudioPhaseShell
        activeView='table'
        controller={readyEngineController()}
        navigationDisabled={false}
        onBack={vi.fn()}
      />
    );

    const headerActions = document.querySelector<HTMLElement>('[data-studio-phase-actions]');
    expect(within(headerActions!).getAllByRole('button')).toHaveLength(3);
    expect(within(headerActions!).getByRole('button', { name: 'Generate 1 ready scene' })).toBeEnabled();
  });

  /**
   * Table and Board offer no header action at all. Both used to carry a "Continue" that walked the
   * four-step rail forward; with a view switch every destination is already visible and one click
   * away, so there is no next step for a call to action to name — and two buttons reading the same
   * word while going to different places was ambiguous besides.
   *
   * Asserting the exact button count *and* the absence of the retired word keeps this falsifiable
   * in both directions: restoring either CTA makes the header hold three buttons and match "Continue".
   *
   * The header does carry a third button now — the paid generation control — but only where there
   * is an engine to spend against, and it is an action on the document rather than a step through
   * it. This fixture has no engine, so the count is still two; the engine-bound count is pinned by
   * "names the paid generation control by the shots it will charge for" above.
   */
  it.each(['table', 'board'] as const)('offers no progression action in the %s view header', async (activeView) => {
    await renderEnglish(
      <StudioPhaseShell
        activeView={activeView}
        controller={phaseController()}
        navigationDisabled={false}
        onBack={vi.fn()}
      />
    );

    const headerActions = document.querySelector<HTMLElement>('[data-studio-phase-actions]');
    expect(headerActions).not.toBeNull();
    expect(within(headerActions!).getAllByRole('button')).toHaveLength(2);
    expect(within(headerActions!).getByRole('button', { name: 'Brief' })).toBeInTheDocument();
    expect(within(headerActions!).getByRole('button', { name: 'Rules' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Generate/ })).toBeNull();
  });

  it('renders the Rules action and the Cut handoff action in the header', async () => {
    await renderEnglish(
      <StudioPhaseShell activeView='cut' controller={phaseController()} navigationDisabled={false} onBack={vi.fn()} />
    );

    const headerActions = document.querySelector<HTMLElement>('[data-studio-phase-actions]');
    expect(headerActions).not.toBeNull();
    expect(within(headerActions!).getAllByRole('button')).toHaveLength(3);
    expect(within(headerActions!).getByRole('button', { name: 'Brief' })).toBeInTheDocument();
    expect(within(headerActions!).getByRole('button', { name: 'Rules' })).toBeInTheDocument();
    expect(within(headerActions!).getByRole('button', { name: 'Prepare handoff' })).toBeInTheDocument();
  });

  /**
   * Cut is the one view whose own header action is also `type='primary'`. The paid control and the
   * export handoff therefore sit side by side, and the pair has to stay distinguishable by name
   * alone — "Prepare handoff" costs nothing, the other charges a provider per shot.
   */
  it('keeps the paid control distinguishable from the free handoff on the Cut view', async () => {
    await renderEnglish(
      <StudioPhaseShell
        activeView='cut'
        controller={readyEngineController()}
        navigationDisabled={false}
        onBack={vi.fn()}
      />
    );

    const headerActions = document.querySelector<HTMLElement>('[data-studio-phase-actions]');
    expect(
      within(headerActions!)
        .getAllByRole('button')
        .map((button) => button.textContent)
    ).toEqual(['Brief', 'Rules', 'Generate 1 ready scene', 'Prepare handoff']);
  });

  it('renders every view in every configured locale without raw visible or accessible copy', async () => {
    const rawKey = /conversation\.creativeStudio\./i;
    const issues: string[] = [];
    const localeInstances = await Promise.all(
      i18nConfig.supportedLanguages.map(async (locale) => [locale, await createLocaleI18n(locale)] as const)
    );

    for (const [locale, instance] of localeInstances) {
      for (const activeView of STUDIO_VIEWS) {
        const { container, unmount } = render(
          <I18nextProvider i18n={instance}>
            <StudioPhaseShell
              activeView={activeView}
              controller={phaseController()}
              navigationDisabled={false}
              onBack={vi.fn()}
            />
          </I18nextProvider>
        );

        // Guards the guard: a view id the shell cannot mount renders an empty frame, and an empty
        // frame satisfies every absence check below without exercising a single string.
        const focusTargets = container.querySelectorAll('[data-studio-phase-heading]');
        if (focusTargets.length !== 1) {
          issues.push(`${locale}.${activeView} mounted ${focusTargets.length} focused headings`);
        }

        if (rawKey.test(container.textContent ?? '')) {
          issues.push(`${locale}.${activeView} exposes a raw key as visible text`);
        }

        for (const role of Object.keys(getRoles(container))) {
          const rawNames = within(container).queryAllByRole(role, { name: rawKey });
          if (rawNames.length > 0) {
            issues.push(`${locale}.${activeView} exposes ${rawNames.length} raw accessible name(s) for ${role}`);
          }
        }

        unmount();
      }
    }

    expect(issues).toEqual([]);
  }, 30_000);

  it('renders the view switch with localized accessible names and no step semantics', async () => {
    await renderEnglish(<StudioViewSwitch activeView='table' disabled={false} onSelect={vi.fn()} />);

    const navigation = screen.getByRole('navigation', { name: 'Project views' });
    expect(within(navigation).getAllByRole('button')).toHaveLength(3);
    for (const viewName of ['Table', 'Board', 'Cut']) {
      expect(within(navigation).getByRole('button', { name: viewName })).toBeVisible();
    }

    // A switch, not a stepper: the active view is a page, not a step in a sequence.
    expect(within(navigation).getByRole('button', { current: 'page' })).toHaveTextContent('Table');
    expect(within(navigation).queryByRole('button', { current: 'step' })).not.toBeInTheDocument();
  });

  it('renders complete timeline and variation selection names without translated fragments', async () => {
    const timelineScene = scene({ id: 'scene-1', durationSeconds: 1 });
    const assetScene = scene();
    const firstAsset = asset('asset-1');
    const secondAsset = asset('asset-2');

    await renderEnglish(
      <>
        <SceneTimeline orderedScenes={[timelineScene]} selectedSceneId='scene-1' onSelectScene={vi.fn()} />
        <AssetStrip
          projectId='project-1'
          scene={{ ...assetScene, assetIds: [firstAsset.id, secondAsset.id] }}
          assets={{ [firstAsset.id]: firstAsset, [secondAsset.id]: secondAsset }}
          projectRevision={3}
          mutationPending={false}
          onSelectAsset={vi.fn()}
        />
      </>
    );

    expect(screen.getByRole('button', { name: 'Select scene 1: Product close-up, 1 second' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(/^Total duration: 1 second$/);
    expect(screen.getByRole('button', { name: 'Select version 2' })).toBeInTheDocument();
  });

  it('keeps scene title and duration in the accessible name while arrow navigation moves selection', async () => {
    const opening = scene({ id: 'scene-1', title: 'Opening', durationSeconds: 1 });
    const reveal = scene({ id: 'scene-2', title: 'Product reveal', durationSeconds: 5 });
    const onSelectScene = vi.fn();

    await renderEnglish(
      <SceneTimeline
        orderedScenes={[opening, reveal]}
        selectedSceneId='scene-1'
        onSelectScene={onSelectScene}
        reviewStates={{ 'scene-1': 'missing-slate', 'scene-2': 'selected-take' }}
      />
    );

    const openingControl = screen.getByRole('button', { name: 'Select scene 1: Opening, 1 second' });
    const revealControl = screen.getByRole('button', { name: 'Select scene 2: Product reveal, 5 seconds' });
    openingControl.focus();
    fireEvent.keyDown(openingControl, { key: 'ArrowRight' });

    expect(revealControl).toHaveFocus();
    expect(onSelectScene).toHaveBeenCalledExactlyOnceWith('scene-2');
  });

  it('keeps the selected-take state in the scene button description', async () => {
    const selectedScene = scene({ id: 'scene-1', selectedAssetId: 'asset-1', assetIds: ['asset-1'] });

    await renderEnglish(
      <SceneTimeline
        orderedScenes={[selectedScene]}
        selectedSceneId='scene-1'
        reviewStates={{ 'scene-1': 'selected-take' }}
        onSelectScene={vi.fn()}
      />
    );

    expect(screen.getByText('In cut')).toHaveClass('sr-only');
    expect(
      screen.getByRole('button', { name: 'Select scene 1: Product close-up, 5 seconds' })
    ).toHaveAccessibleDescription('In cut');
  });

  it('describes the Cut handoff as a manifest plus selected media without exported slates', async () => {
    await renderEnglish(
      <StudioPhaseShell activeView='cut' controller={phaseController()} navigationDisabled={false} onBack={vi.fn()} />
    );

    expect(
      screen.getByText(
        'The handoff contains the storyboard manifest and selected media only. Review slates are not exported.'
      )
    ).toBeVisible();
    expect(screen.queryByText(/includes selected media and slates/i)).not.toBeInTheDocument();
  });

  it('reports the selected scene count after a complete handoff', async () => {
    await renderEnglish(
      <StudioExportModal
        visible
        project={project()}
        selectedAssetCount={2}
        pending={false}
        includeReferences={false}
        exportedFolderName='Launch-film-export'
        missingSceneIds={[]}
        issueMessageKey={null}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
        onIncludeReferencesChange={vi.fn()}
      />
    );

    expect(screen.getByText('Handed off 2 selected scenes to “Launch-film-export”.')).toBeVisible();
  });

  it('warns about slate gaps before committing a partial export', async () => {
    const first = scene({ id: 'scene-1', title: 'Opening', selectedAssetId: 'asset-1' });
    const second = scene({ id: 'scene-2', title: 'Product close-up', selectedAssetId: 'asset-2' });
    const third = scene({ id: 'scene-3', title: 'Closing slate' });
    const currentProject: StudioRendererProject = {
      ...project(),
      sceneOrder: [first.id, second.id, third.id],
      scenes: { [first.id]: first, [second.id]: second, [third.id]: third },
    };

    await renderEnglish(
      <StudioExportModal
        visible
        project={currentProject}
        selectedAssetCount={2}
        pending={false}
        includeReferences={false}
        exportedFolderName={null}
        missingSceneIds={[third.id]}
        issueMessageKey={null}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
        onIncludeReferencesChange={vi.fn()}
      />
    );

    expect(screen.getByText("Shot 03 is still a slate — it won't be included.")).toBeVisible();
    expect(screen.getByText('Export 2 shots?')).toBeVisible();
  });

  it('does not show a slate-gap warning before a complete export', async () => {
    await renderEnglish(
      <StudioExportModal
        visible
        project={project()}
        selectedAssetCount={2}
        pending={false}
        includeReferences={false}
        exportedFolderName={null}
        missingSceneIds={[]}
        issueMessageKey={null}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
        onIncludeReferencesChange={vi.fn()}
      />
    );

    expect(screen.queryByText(/still a slate/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Export 2 shots\?/)).not.toBeInTheDocument();
  });

  it('explains that a partial handoff is missing selected media and never exports Review slates', async () => {
    await renderEnglish(
      <StudioExportModal
        visible
        project={project()}
        selectedAssetCount={1}
        pending={false}
        includeReferences={false}
        exportedFolderName='Launch-film-export'
        missingSceneIds={['scene-2']}
        issueMessageKey={null}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
        onIncludeReferencesChange={vi.fn()}
      />
    );

    expect(screen.getByText('This handoff is partial because some scenes have no selected media.')).toBeVisible();
    expect(
      screen.getByText('Scenes without selected media are excluded from the handoff. Review slates are not exported.')
    ).toBeVisible();
  });

  it('renders complete selected, target, and per-scene duration phrases', async () => {
    await renderEnglish(
      <GenerationReviewModal
        visible
        mode='single'
        scenes={[
          {
            id: 'scene-2',
            title: 'Product close-up',
            mediaKind: 'video',
            durationSeconds: 1,
            route: {
              status: 'valid',
              snapshot: {
                sceneId: 'scene-2',
                kind: 'video',
                providerId: 'provider-1',
                choiceId: 'choice-1',
                model: 'video-model',
              },
              providerName: 'Provider',
              silentOutput: true,
            },
          },
        ]}
        aspectRatio='16:9'
        resolution='720p'
        targetDurationSeconds={2}
        selectedDurationSeconds={1}
        projectDurationSeconds={1}
        submitting={false}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />
    );

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Selected duration: 1 second')).toBeInTheDocument();
    expect(within(dialog).getByText('Target duration: 2 seconds')).toBeInTheDocument();
    expect(within(screen.getByRole('article', { name: 'Product close-up' })).getByText('1 second')).toBeInTheDocument();
  });

  it('renders singular and plural ready-scene actions through the logical i18next key', async () => {
    const ReadyAction = ({ count }: { count: number }) => {
      const { t } = useTranslation();
      return (
        <StudioPhaseHeader
          project={project()}
          saveState='saved'
          onBack={vi.fn()}
          actions={
            <button type='button'>{t('conversation.creativeStudio.review.generateReadyScenes', { count })}</button>
          }
        />
      );
    };

    await renderEnglish(
      <>
        <ReadyAction count={1} />
        <ReadyAction count={2} />
      </>
    );

    expect(screen.getByRole('button', { name: 'Generate 1 ready scene' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Generate 2 ready scenes' })).toBeInTheDocument();
  });
});
