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
import { AssistantDock } from '@renderer/pages/studio/components/PhaseShell/AssistantDock';
import { StudioPhaseHeader } from '@renderer/pages/studio/components/PhaseShell/StudioPhaseHeader';
import { StudioPhaseNav } from '@renderer/pages/studio/components/PhaseShell/StudioPhaseNav';
import { StudioPhaseShell } from '@renderer/pages/studio/components/PhaseShell/StudioPhaseShell';
import { deriveStudioPhaseCompletion } from '@renderer/pages/studio/components/PhaseShell/studioPhaseCompletion';
import type { StudioPhaseControllers } from '@renderer/pages/studio/components/PhaseShell/types';
import { AssetStrip } from '@renderer/pages/studio/components/Preview/AssetStrip';
import { StudioExportModal } from '@renderer/pages/studio/components/Preview/StudioExportModal';
import { SceneTimeline } from '@renderer/pages/studio/components/SceneTimeline';
import type { UseStoryboardEditorResult } from '@renderer/pages/studio/hooks/useStoryboardEditor';
import type { UseStudioJobsResult } from '@renderer/pages/studio/hooks/useStudioJobs';
import type { UseStudioModelsResult } from '@renderer/pages/studio/hooks/useStudioModels';
import type { UseStudioRenderResult } from '@renderer/pages/studio/hooks/useStudioRender';
import { STUDIO_PHASES } from '@renderer/pages/studio/studioPhaseRoute';
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
    sendFirstMessage: vi.fn(async () => {}),
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

const phaseController = (): StudioPhaseControllers => {
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
    openDraftReview: vi.fn(),
    openSingleGenerationReview: vi.fn(),
    openBatchGenerationReview: vi.fn(),
    openExport: vi.fn(),
    openModelSettings: vi.fn(),
    importReference: vi.fn(async () => undefined),
    selectVariation: vi.fn(async () => undefined),
    clearWriteFocusIntent: vi.fn(),
    openDuplicateChargeConfirmation: vi.fn(),
  };
};

describe('Creative Studio full-sentence English copy', () => {
  it('keeps Brief start-writing only in its validated footer', async () => {
    await renderEnglish(
      <StudioPhaseShell
        activePhase='brief'
        controller={phaseController()}
        navigationDisabled={false}
        onBack={vi.fn()}
      />
    );

    const headerActions = document.querySelector<HTMLElement>('[data-studio-phase-actions]');
    expect(headerActions).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Start writing' })).toHaveLength(1);
  });

  it.each([
    ['write', 'Continue'],
    ['produce', 'Continue'],
    ['review', 'Prepare handoff'],
  ] as const)('renders one %s phase action in the header', async (activePhase, actionName) => {
    await renderEnglish(
      <StudioPhaseShell
        activePhase={activePhase}
        controller={phaseController()}
        navigationDisabled={false}
        onBack={vi.fn()}
      />
    );

    const headerActions = document.querySelector<HTMLElement>('[data-studio-phase-actions]');
    expect(headerActions).not.toBeNull();
    expect(within(headerActions!).getAllByRole('button')).toHaveLength(1);
    expect(within(headerActions!).getByRole('button', { name: actionName })).toBeInTheDocument();
  });

  it('renders every phase in every configured locale without raw visible or accessible copy', async () => {
    const rawKey = /conversation\.creativeStudio\./i;
    const issues: string[] = [];
    const localeInstances = await Promise.all(
      i18nConfig.supportedLanguages.map(async (locale) => [locale, await createLocaleI18n(locale)] as const)
    );

    for (const [locale, instance] of localeInstances) {
      for (const activePhase of STUDIO_PHASES) {
        const { container, unmount } = render(
          <I18nextProvider i18n={instance}>
            <StudioPhaseShell
              activePhase={activePhase}
              controller={phaseController()}
              navigationDisabled={false}
              onBack={vi.fn()}
            />
          </I18nextProvider>
        );

        if (rawKey.test(container.textContent ?? '')) {
          issues.push(`${locale}.${activePhase} exposes a raw key as visible text`);
        }

        for (const role of Object.keys(getRoles(container))) {
          const rawNames = within(container).queryAllByRole(role, { name: rawKey });
          if (rawNames.length > 0) {
            issues.push(`${locale}.${activePhase} exposes ${rawNames.length} raw accessible name(s) for ${role}`);
          }
        }

        unmount();
      }
    }

    expect(issues).toEqual([]);
  }, 30_000);

  it('renders the phase workflow and assistant dock with localized accessible names', async () => {
    await renderEnglish(
      <>
        <StudioPhaseNav
          activePhase='brief'
          project={project()}
          readiness={{
            sceneStatuses: {},
            totalSceneCount: 0,
            readySceneIds: [],
            selectedAssetCount: 0,
            durationDeltaSeconds: -5,
          }}
          disabled={false}
          onSelect={vi.fn()}
        />
        <AssistantDock>
          <span>Assistant controls</span>
        </AssistantDock>
        <AssistantDock kind='produce'>
          <span>Generation controls</span>
        </AssistantDock>
      </>
    );

    const navigation = screen.getByRole('navigation', { name: 'Creative workflow' });
    expect(within(navigation).getAllByRole('button')).toHaveLength(4);
    for (const phaseName of ['Brief', 'Write', 'Produce', 'Review']) {
      expect(within(navigation).getByRole('button', { name: phaseName })).toBeVisible();
    }
    expect(screen.getByRole('complementary', { name: 'Writing assistant' })).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'Generation activity' })).toBeInTheDocument();
  });

  it('derives phase completion from durable project content', () => {
    const completeScene = scene({ id: 'scene-1', visualPrompt: 'A finished visual prompt' });
    const currentProject = project({
      brief: 'A useful intent',
      sceneOrder: [completeScene.id],
      scenes: { [completeScene.id]: completeScene },
    });

    expect(
      deriveStudioPhaseCompletion(currentProject, {
        sceneStatuses: { [completeScene.id]: 'generated' },
        totalSceneCount: 1,
        readySceneIds: [],
        selectedAssetCount: 1,
        durationDeltaSeconds: 0,
      })
    ).toEqual({ brief: true, write: true, produce: true, review: false });
  });

  it('derives rail checkmarks from phase content while keeping Review numbered', async () => {
    const completeScene = scene({ id: 'scene-1', visualPrompt: 'A finished visual prompt' });
    const completeProject = project({
      brief: 'A useful intent',
      sceneOrder: [completeScene.id],
      scenes: { [completeScene.id]: completeScene },
    });
    await renderEnglish(
      <StudioPhaseNav
        activePhase='review'
        project={completeProject}
        readiness={{
          sceneStatuses: { [completeScene.id]: 'generated' },
          totalSceneCount: 1,
          readySceneIds: [],
          selectedAssetCount: 1,
          durationDeltaSeconds: 0,
        }}
        disabled={false}
        onSelect={vi.fn()}
      />
    );

    expect(document.querySelector('[data-studio-phase-marker="brief"]')).toHaveAttribute('data-complete', 'true');
    expect(document.querySelector('[data-studio-phase-marker="write"]')).toHaveAttribute('data-complete', 'true');
    expect(document.querySelector('[data-studio-phase-marker="produce"]')).toHaveAttribute('data-complete', 'true');
    expect(document.querySelector('[data-studio-phase-marker="review"]')).toHaveAttribute('data-complete', 'false');
    expect(document.querySelector('[data-studio-phase-marker="review"]')).toHaveTextContent('4');
    expect(screen.getByRole('button', { current: 'step' })).toHaveTextContent('Review');
  });

  it('keeps Write incomplete when any ordered shot has a blank visual prompt', async () => {
    const completeScene = scene({ id: 'scene-1', visualPrompt: 'A finished visual prompt' });
    const blankScene = scene({ id: 'scene-2', visualPrompt: '   ' });
    await renderEnglish(
      <StudioPhaseNav
        activePhase='write'
        project={project({
          brief: '   ',
          sceneOrder: [completeScene.id, blankScene.id],
          scenes: { [completeScene.id]: completeScene, [blankScene.id]: blankScene },
        })}
        readiness={{
          sceneStatuses: { [completeScene.id]: 'ready', [blankScene.id]: 'needs_prompt' },
          totalSceneCount: 2,
          readySceneIds: [completeScene.id],
          selectedAssetCount: 0,
          durationDeltaSeconds: 5,
        }}
        disabled={false}
        onSelect={vi.fn()}
      />
    );

    expect(document.querySelector('[data-studio-phase-marker="brief"]')).toHaveAttribute('data-complete', 'false');
    expect(document.querySelector('[data-studio-phase-marker="write"]')).toHaveAttribute('data-complete', 'false');
    expect(document.querySelector('[data-studio-phase-marker="produce"]')).toHaveAttribute('data-complete', 'false');
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

  it('describes the Review handoff as a manifest plus selected media without exported slates', async () => {
    await renderEnglish(
      <StudioPhaseShell
        activePhase='review'
        controller={phaseController()}
        navigationDisabled={false}
        onBack={vi.fn()}
      />
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
