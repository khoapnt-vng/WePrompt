/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Input } from '@arco-design/web-react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  StudioAsset,
  StudioEditableScene,
  StudioRendererProject,
  StudioRouteCatalog,
  StudioScene,
} from '@/common/types/project/creativeStudioTypes';
import type { TChatConversation } from '@/common/config/storage';
import { BriefConversationProvider } from '@renderer/pages/studio/components/Shell/BriefConversationContext';
import { WritePhase } from '@renderer/pages/studio/components/PhaseShell/phases/WritePhase';
import type { StudioLayoutMode } from '@renderer/pages/studio/components/PhaseShell/useStudioLayoutMode';
import type { WritePhaseController } from '@renderer/pages/studio/components/PhaseShell/types';
import type { UseStoryboardEditorResult } from '@renderer/pages/studio/hooks/useStoryboardEditor';
import type { UseStudioModelsResult } from '@renderer/pages/studio/hooks/useStudioModels';

const writeConversationHarness = vi.hoisted(() => ({
  result: {
    state: { kind: 'absent' } as { kind: string; conversation?: TChatConversation },
    errorMessageKey: null,
    sendFirstMessage: vi.fn(async () => {}),
    recreate: vi.fn(),
  },
  messages: [] as string[],
  mountedConversationIds: [] as string[],
  providedProjectIds: [] as string[],
}));

vi.mock('@renderer/pages/studio/components/PhaseShell/phases/brief/useBriefConversation', () => ({
  useBriefConversation: (provided: { id: string }) => {
    writeConversationHarness.providedProjectIds.push(provided.id);
    return writeConversationHarness.result;
  },
}));
vi.mock('@renderer/pages/studio/components/PhaseShell/phases/StudioConversationSurface', () => ({
  StudioConversationSurface: ({ conversation }: { conversation: TChatConversation }) => {
    writeConversationHarness.mountedConversationIds.push(conversation.id);
    return (
      <div>
        {writeConversationHarness.messages.map((message) => (
          <p key={message}>{message}</p>
        ))}
      </div>
    );
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => (key === 'common.unit.second_short' ? 's' : key),
  }),
}));

// jsdom measures every element at 0 width, so the real shell would always pick `compact` and the
// docked Director pane could never be exercised. The mode is driven directly instead.
const shellLayout = vi.hoisted(() => ({ mode: 'inline' as 'inline' | 'drawer' | 'compact' }));
vi.mock('@renderer/pages/studio/components/PhaseShell/useStudioLayoutMode', () => ({
  useStudioLayoutMode: () => ({ containerRef: { current: null }, layoutMode: shellLayout.mode }),
}));

const { StudioShell } = await import('@renderer/pages/studio/components/Shell/StudioShell');

const observedTargets: Element[] = [];

class ResizeObserverMock {
  observe(target: Element): void {
    observedTargets.push(target);
  }

  disconnect(): void {}

  unobserve(): void {}
}

const scene = (id: string, overrides: Partial<StudioScene> = {}): StudioScene => ({
  id,
  title: id === 'scene-1' ? 'Opening' : 'Reveal',
  purpose: 'Move the story forward',
  visualPrompt: id === 'scene-1' ? 'A wide opening' : 'A detailed reveal',
  narration: '',
  onScreenText: '',
  mediaKind: id === 'scene-1' ? 'image' : 'video',
  durationSeconds: id === 'scene-1' ? 5 : 6,
  referenceAssetId: null,
  selectedAssetId: null,
  assetIds: [],
  jobIds: [],
  reviewState: 'ready',
  ...overrides,
});

const editable = (value: StudioScene): StudioEditableScene => ({
  title: value.title,
  purpose: value.purpose,
  visualPrompt: value.visualPrompt,
  narration: value.narration,
  onScreenText: value.onScreenText,
  mediaKind: value.mediaKind,
  durationSeconds: value.durationSeconds,
  referenceAssetId: value.referenceAssetId,
});

const reference: StudioAsset = {
  id: 'reference-2',
  projectId: 'project-1',
  sceneId: 'scene-2',
  mediaKind: 'image',
  mimeType: 'image/png',
  managedAsset: { collection: 'imports', fileName: 'reference-2.png' },
  byteSize: 1,
  sha256: '1'.repeat(64),
  createdAt: '2026-08-04T00:00:00.000Z',
};

const scenes = [scene('scene-1'), scene('scene-2', { referenceAssetId: reference.id, assetIds: [reference.id] })];

const project: StudioRendererProject = {
  schemaVersion: 1,
  revision: 3,
  id: 'project-1',
  name: 'Launch film',
  brief: 'A short launch story',
  aspectRatio: '16:9',
  targetDurationSeconds: 15,
  resolution: '1080p',
  sceneOrder: scenes.map(({ id }) => id),
  scenes: Object.fromEntries(scenes.map((item) => [item.id, item])),
  assets: { [reference.id]: reference },
  jobs: {},
  routing: {
    storyboard: { providerId: 'story-provider', model: 'planner-model' },
    image: { choiceId: 'image-choice', providerId: 'image-provider', model: 'image-model' },
    video: { choiceId: 'video-choice', providerId: 'video-provider', model: 'video-model' },
  },
  createdAt: '2026-08-04T00:00:00.000Z',
  updatedAt: '2026-08-04T00:00:00.000Z',
};

const catalog: StudioRouteCatalog = {
  storyboard: {
    status: 'ready',
    selected: { providerId: 'story-provider', model: 'planner-model' },
    options: [
      {
        providerId: 'story-provider',
        providerName: 'Storyboard Provider',
        model: 'planner-model',
        health: 'available',
      },
    ],
  },
  image: {
    status: 'ready',
    selected: { choiceId: 'image-choice', providerId: 'image-provider', model: 'image-model' },
    selectedRoute: {
      choiceId: 'image-choice',
      providerId: 'image-provider',
      providerName: 'Image Provider',
      model: 'image-model',
      health: 'available',
      kind: 'image',
      constraints: {
        aspectRatios: ['16:9'],
        resolutions: ['1080p'],
        minDurationSeconds: 2,
        maxDurationSeconds: 8,
        supportsFirstFrame: true,
        silentOutput: true,
      },
    },
    options: [],
  },
  video: {
    status: 'ready',
    selected: { choiceId: 'video-choice', providerId: 'video-provider', model: 'video-model' },
    selectedRoute: {
      choiceId: 'video-choice',
      providerId: 'video-provider',
      providerName: 'Video Provider',
      model: 'video-model',
      health: 'available',
      kind: 'video',
      constraints: {
        aspectRatios: ['16:9'],
        resolutions: ['1080p'],
        minDurationSeconds: 4,
        maxDurationSeconds: 12,
        supportsFirstFrame: true,
        silentOutput: true,
      },
    },
    options: [],
  },
  catalogVersion: '0123456789abcdef',
};

const editor = (
  selectedSceneId = 'scene-1',
  overrides: Partial<UseStoryboardEditorResult> = {}
): UseStoryboardEditorResult =>
  ({
    project,
    orderedScenes: scenes,
    selectedSceneId,
    selectedScene: project.scenes[selectedSceneId] ?? null,
    sceneDraft: project.scenes[selectedSceneId] ? editable(project.scenes[selectedSceneId]!) : null,
    sceneDrafts: Object.fromEntries(scenes.map((item) => [item.id, editable(item)])),
    sceneSaveStates: { 'scene-1': 'saved', 'scene-2': 'dirty' },
    projectDraft: null,
    projectSaveState: 'saved',
    hasUnsavedProjectDraft: false,
    hasUnsavedSceneDrafts: true,
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
    durationTotalSeconds: 11,
    durationMatchesTarget: false,
    remainingDurationSeconds: 4,
    suggestedExpandedTargetSeconds: 20,
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
    ...overrides,
  }) as UseStoryboardEditorResult;

const models = (overrides: Partial<UseStudioModelsResult> = {}): UseStudioModelsResult => ({
  catalog,
  loading: false,
  errorMessageKey: null,
  pendingRole: null,
  refresh: vi.fn(async () => {}),
  updateSelection: vi.fn(async () => true),
  ...overrides,
});

const controller = (overrides: Partial<WritePhaseController> = {}): WritePhaseController => ({
  project,
  readiness: {
    sceneStatuses: { 'scene-1': 'ready', 'scene-2': 'ready' },
    totalSceneCount: 2,
    readySceneIds: ['scene-1', 'scene-2'],
    selectedAssetCount: 0,
    durationDeltaSeconds: -4,
  },
  editor: editor(),
  models: models(),
  selectedReferenceAsset: null,
  writeFocusIntent: null,
  advisory: null,
  mutationPending: false,
  requestTransition: vi.fn(),
  openDraftReview: vi.fn(),
  openSingleGenerationReview: vi.fn(),
  importReference: vi.fn(async () => {}),
  clearWriteFocusIntent: vi.fn(),
  ...overrides,
});

const directorConversation: TChatConversation = {
  id: 'conversation_brief',
  name: 'Launch film',
  type: 'aionrs',
  model: { id: 'provider-1', use_model: 'model-1' },
  created_at: 1,
  modified_at: 1,
  extra: { backend: 'aionrs', workspace: '', studio_project_id: project.id },
};

/** Stands in for the Director pane, which the shell renders outside the phase. */
const DirectorPaneStub: React.FC = () => (
  <div data-studio-director>
    <Input.TextArea />
  </div>
);

/**
 * Renders Write the way the shell does: underneath the one Director conversation provider.
 *
 * Without it `useBriefConversationContext` falls back to ABSENT, so every assertion about the
 * conversation-ready branch is true by construction no matter what the phase renders.
 */
const renderInShell = (ui: React.ReactElement, director?: React.ReactNode) =>
  render(
    <BriefConversationProvider project={project}>
      {director}
      {ui}
    </BriefConversationProvider>
  );

const DIRECTOR_COLLAPSED_KEY = 'studio.directorPane.collapsed';

/**
 * Renders Write inside the **real** shell, which is the only thing that can reveal the Director.
 *
 * A stub shell would let "reveal" mean whatever the test wanted it to mean. jsdom focuses hidden
 * elements happily, so `toHaveFocus()` alone cannot tell a revealed pane from a shut one — the
 * pane's own collapse attribute and Arco's drawer class are what carry that, and they only exist
 * if the real shell is mounted.
 */
const renderInStudioShell = (
  ui: React.ReactElement,
  { mode = 'inline', collapsed = false }: { mode?: StudioLayoutMode; collapsed?: boolean } = {}
) => {
  shellLayout.mode = mode;
  localStorage.setItem(DIRECTOR_COLLAPSED_KEY, collapsed ? '1' : '0');
  return render(
    <BriefConversationProvider project={project}>
      <StudioShell projectId={project.id} director={<DirectorPaneStub />}>
        {ui}
      </StudioShell>
    </BriefConversationProvider>
  );
};

const directorPane = (): HTMLElement => {
  const pane = document.querySelector<HTMLElement>('[data-studio-director-pane]');
  if (pane === null) throw new Error('the shell rendered no Director pane');
  return pane;
};

/** Arco marks a shut Drawer with `-wrapper-hide` (`display: none`) rather than unmounting it. */
const directorOverlayVisible = (): boolean => {
  const wrapper = document.querySelector('.arco-drawer-wrapper');
  return wrapper !== null && !wrapper.classList.contains('arco-drawer-wrapper-hide');
};

const directorComposer = (): HTMLElement | null =>
  document.querySelector<HTMLElement>('[data-studio-director] textarea');

const emptyVisualSetup = (): { props: WritePhaseController; phaseEditor: UseStoryboardEditorResult } => {
  const emptyReveal = scene('scene-2', {
    visualPrompt: '',
    referenceAssetId: reference.id,
    assetIds: [reference.id],
  });
  const emptyScenes = [scenes[0]!, emptyReveal];
  const emptyProject: StudioRendererProject = {
    ...project,
    sceneOrder: emptyScenes.map(({ id }) => id),
    scenes: Object.fromEntries(emptyScenes.map((item) => [item.id, item])),
  };
  const phaseEditor = editor('scene-1', {
    project: emptyProject,
    orderedScenes: emptyScenes,
    sceneDrafts: Object.fromEntries(emptyScenes.map((item) => [item.id, editable(item)])),
  });
  return { props: controller({ project: emptyProject, editor: phaseEditor }), phaseEditor };
};

describe('WritePhase', () => {
  beforeEach(() => {
    observedTargets.length = 0;
    // The pane preference persists by design, so it must be cleared or one test decides the next.
    localStorage.clear();
    shellLayout.mode = 'inline';
    vi.stubGlobal('ResizeObserver', ResizeObserverMock);
    writeConversationHarness.result.state = { kind: 'absent' };
    writeConversationHarness.messages = [];
    writeConversationHarness.mountedConversationIds = [];
    writeConversationHarness.providedProjectIds = [];
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('lays out every seeded shot as one four-zone script row', () => {
    render(<WritePhase controller={controller()} />);

    const table = screen.getByRole('region', {
      name: 'conversation.creativeStudio.phase.write.scriptTableTitle',
    });
    const opening = within(table).getByRole('region', { name: 'Opening' });
    const reveal = within(table).getByRole('region', { name: 'Reveal' });

    for (const row of [opening, reveal]) {
      expect(
        [...row.querySelectorAll('[data-script-zone]')].map((zone) => zone.getAttribute('data-script-zone'))
      ).toEqual(['timing', 'script', 'visual', 'output']);
      expect(
        within(row).getByRole('combobox', { name: 'conversation.creativeStudio.inspector.durationLabel' })
      ).toBeInTheDocument();
      expect(within(row).getByLabelText('conversation.creativeStudio.inspector.titleLabel')).toBeInTheDocument();
      expect(within(row).getByLabelText('conversation.creativeStudio.inspector.narrationLabel')).toHaveAttribute(
        'rows',
        '2'
      );
      expect(within(row).getByLabelText('conversation.creativeStudio.inspector.visualPromptLabel')).toHaveAttribute(
        'rows',
        '3'
      );
      expect(
        within(row).getByRole('combobox', { name: 'conversation.creativeStudio.inspector.mediaKindLabel' })
      ).toBeInTheDocument();
    }
  });

  it('keeps row readiness without repeating the scene save status', () => {
    render(<WritePhase controller={controller()} />);

    expect(screen.getAllByText('conversation.creativeStudio.scene.status.ready')).toHaveLength(2);
    expect(screen.queryByText('conversation.creativeStudio.inspector.saved')).not.toBeInTheDocument();
  });

  it('shows compact zone headings while every scene field keeps its accessible name', () => {
    render(<WritePhase controller={controller()} layoutMode='compact' />);

    const opening = screen.getByRole('region', { name: 'Opening' });
    expect(
      within(opening)
        .getAllByRole('heading', { level: 4 })
        .map((heading) => heading.textContent)
    ).toEqual([
      'conversation.creativeStudio.phase.write.shotColumn',
      'conversation.creativeStudio.phase.write.scriptColumn',
      'conversation.creativeStudio.phase.write.visualColumn',
      'conversation.creativeStudio.phase.write.outputColumn',
    ]);
    expect(
      within(opening).getByRole('combobox', { name: 'conversation.creativeStudio.inspector.durationLabel' })
    ).toBeInTheDocument();
    expect(within(opening).getByLabelText('conversation.creativeStudio.inspector.titleLabel')).toBeInTheDocument();
    expect(within(opening).getByLabelText('conversation.creativeStudio.inspector.narrationLabel')).toBeInTheDocument();
    expect(
      within(opening).getByLabelText('conversation.creativeStudio.inspector.visualPromptLabel')
    ).toBeInTheDocument();
    expect(
      within(opening).getByRole('combobox', { name: 'conversation.creativeStudio.inspector.mediaKindLabel' })
    ).toBeInTheDocument();

    fireEvent.click(
      within(opening).getByRole('button', { name: 'conversation.creativeStudio.phase.write.moreDetails' })
    );
    expect(within(opening).getByLabelText('conversation.creativeStudio.inspector.purposeLabel')).toBeInTheDocument();
    expect(
      within(opening).getByLabelText('conversation.creativeStudio.inspector.onScreenTextLabel')
    ).toBeInTheDocument();
  });

  it('offers a visual suggestion from an empty visual cell', () => {
    render(<WritePhase controller={emptyVisualSetup().props} />);

    const reveal = screen.getByRole('region', { name: 'Reveal' });
    expect(within(reveal).getByLabelText('conversation.creativeStudio.inspector.visualPromptLabel')).toHaveAttribute(
      'placeholder',
      'conversation.creativeStudio.phase.write.visualPlaceholder'
    );
    expect(
      within(reveal).getByRole('button', { name: 'conversation.creativeStudio.phase.write.suggestVisual' })
    ).toBeInTheDocument();
  });

  /**
   * "Suggest a visual" has no surface of its own to fall back to any more.
   *
   * It used to focus the composer of the conversation Write mounted itself, then — once the shell
   * took that conversation — Write's own writing assistant whenever the Director was out of reach.
   * That assistant is gone (D10), so the Director has to be *made* reachable: the pane expands, or
   * the overlay opens, and only then does the composer take the caret.
   *
   * Every case below asserts the reveal, not just the focus. jsdom focuses hidden elements without
   * complaint, so `toHaveFocus()` on its own passes just as happily against a pane that never
   * opened — which is precisely how the original silent no-op survived its guard.
   */
  describe('suggest a visual', () => {
    const clickSuggest = (): void => {
      const reveal = screen.getByRole('region', { name: 'Reveal' });
      fireEvent.click(
        within(reveal).getByRole('button', { name: 'conversation.creativeStudio.phase.write.suggestVisual' })
      );
    };

    it('hands the request to the Director composer when the pane is already on screen', () => {
      writeConversationHarness.result.state = { kind: 'ready', conversation: directorConversation };
      const { props, phaseEditor } = emptyVisualSetup();
      renderInStudioShell(<WritePhase controller={props} />);
      expect(directorPane()).toHaveAttribute('data-collapsed', 'false');

      clickSuggest();

      expect(phaseEditor.selectScene).toHaveBeenCalledWith('scene-2');
      expect(directorPane()).toHaveAttribute('data-collapsed', 'false');
      expect(directorComposer()).toHaveFocus();
    });

    it('expands a collapsed Director pane and then lands in its composer', () => {
      writeConversationHarness.result.state = { kind: 'ready', conversation: directorConversation };
      const { props } = emptyVisualSetup();
      renderInStudioShell(<WritePhase controller={props} />, { collapsed: true });
      // Guards the guard: a pane that started open would make the reveal assertion vacuous.
      expect(directorPane()).toHaveAttribute('data-collapsed', 'true');
      expect(directorComposer()).not.toHaveFocus();

      clickSuggest();

      expect(directorPane()).toHaveAttribute('data-collapsed', 'false');
      expect(directorComposer()).toHaveFocus();
      // Revealing is a choice to see the pane, so it is the user's preference from now on.
      expect(localStorage.getItem(DIRECTOR_COLLAPSED_KEY)).toBe('0');
    });

    it('opens the Director overlay below inline width and lands in its composer', () => {
      writeConversationHarness.result.state = { kind: 'ready', conversation: directorConversation };
      const { props } = emptyVisualSetup();
      renderInStudioShell(<WritePhase controller={props} layoutMode='drawer' />, { mode: 'drawer' });
      expect(directorOverlayVisible()).toBe(false);
      expect(directorComposer()).not.toHaveFocus();

      clickSuggest();

      expect(directorOverlayVisible()).toBe(true);
      expect(directorComposer()).toHaveFocus();
    });

    /**
     * Opening the overlay is a UI action bound to the narrow presentation, not a change of intent.
     * Writing `expanded` here would silently overwrite a collapse the user chose at full width, and
     * writing `collapsed` would leave the pane shut when they widened the window again.
     */
    it('leaves the stored pane preference untouched when it reveals the overlay', () => {
      writeConversationHarness.result.state = { kind: 'ready', conversation: directorConversation };
      const { props } = emptyVisualSetup();
      renderInStudioShell(<WritePhase controller={props} layoutMode='drawer' />, {
        mode: 'drawer',
        collapsed: true,
      });

      clickSuggest();

      expect(directorOverlayVisible()).toBe(true);
      expect(localStorage.getItem(DIRECTOR_COLLAPSED_KEY)).toBe('1');
    });

    it('reveals the Director but keeps out of the composer that writes the brief', () => {
      const { props } = emptyVisualSetup();
      renderInStudioShell(<WritePhase controller={props} />, { collapsed: true });

      clickSuggest();

      // The Director is on screen, so the user can see there is no thread yet and start one — but
      // that composer's first message becomes the project brief, not a note about one shot.
      expect(directorPane()).toHaveAttribute('data-collapsed', 'false');
      expect(directorComposer()).not.toHaveFocus();
    });
  });

  it('keeps a cleared title local and surfaces the required field error', () => {
    const clearedDraft = { ...editable(scenes[0]!), title: '' };
    const phaseEditor = editor('scene-1', {
      sceneDrafts: { 'scene-1': clearedDraft, 'scene-2': editable(scenes[1]!) },
    });
    render(<WritePhase controller={controller({ editor: phaseEditor })} />);

    const title = screen.getAllByLabelText('conversation.creativeStudio.inspector.titleLabel')[0]!;
    const opening = title.closest('section');
    expect(opening).not.toBeNull();
    expect(title).toHaveAttribute('maxlength', '256');
    expect(within(opening!).getByRole('alert')).toHaveTextContent(
      'conversation.creativeStudio.phase.write.invalidTitle'
    );

    fireEvent.blur(title);
    fireEvent.blur(within(opening!).getByLabelText('conversation.creativeStudio.inspector.visualPromptLabel'));
    expect(phaseEditor.flushSceneDraftById).not.toHaveBeenCalled();
  });

  it('renders empty seeded titles as position-based placeholders and needs-title readiness', () => {
    const emptyScenes = [
      scene('scene-1', { title: '' }),
      scene('scene-2', { title: '' }),
      scene('scene-3', { title: '', durationSeconds: 4 }),
    ];
    const emptyProject: StudioRendererProject = {
      ...project,
      sceneOrder: emptyScenes.map(({ id }) => id),
      scenes: Object.fromEntries(emptyScenes.map((item) => [item.id, item])),
    };
    const phaseEditor = editor('scene-1', {
      project: emptyProject,
      orderedScenes: emptyScenes,
      sceneDrafts: Object.fromEntries(emptyScenes.map((item) => [item.id, editable(item)])),
    });

    render(
      <WritePhase
        controller={controller({
          project: emptyProject,
          editor: phaseEditor,
          readiness: {
            sceneStatuses: { 'scene-1': 'needs_prompt', 'scene-2': 'needs_prompt', 'scene-3': 'needs_prompt' },
            totalSceneCount: 3,
            readySceneIds: [],
            selectedAssetCount: 0,
            durationDeltaSeconds: -1,
          },
        })}
      />
    );

    expect(
      screen
        .getAllByLabelText('conversation.creativeStudio.inspector.titleLabel')
        .map((input) => input.getAttribute('placeholder'))
    ).toEqual([
      'conversation.creativeStudio.phase.write.placeholder.opening',
      'conversation.creativeStudio.phase.write.placeholder.middle',
      'conversation.creativeStudio.phase.write.placeholder.closing',
    ]);
    expect(screen.getAllByText('conversation.creativeStudio.phase.write.needsTitle')).toHaveLength(3);
  });

  it('keeps secondary script details collapsed independently per row', () => {
    render(<WritePhase controller={controller()} />);

    const opening = screen.getByRole('region', { name: 'Opening' });
    const reveal = screen.getByRole('region', { name: 'Reveal' });
    const openingDetails = within(opening).getByRole('button', {
      name: 'conversation.creativeStudio.phase.write.moreDetails',
    });
    const revealDetails = within(reveal).getByRole('button', {
      name: 'conversation.creativeStudio.phase.write.moreDetails',
    });

    expect(openingDetails).toHaveAttribute('aria-expanded', 'false');
    expect(revealDetails).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByLabelText('conversation.creativeStudio.inspector.purposeLabel')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('conversation.creativeStudio.inspector.onScreenTextLabel')).not.toBeInTheDocument();

    fireEvent.click(revealDetails);

    expect(openingDetails).toHaveAttribute('aria-expanded', 'false');
    expect(revealDetails).toHaveAttribute('aria-expanded', 'true');
    expect(within(reveal).getByLabelText('conversation.creativeStudio.inspector.purposeLabel')).toHaveValue(
      'Move the story forward'
    );
    expect(within(reveal).getByLabelText('conversation.creativeStudio.inspector.onScreenTextLabel')).toHaveValue('');

    fireEvent.click(revealDetails);
    expect(
      within(reveal).queryByLabelText('conversation.creativeStudio.inspector.purposeLabel')
    ).not.toBeInTheDocument();
    expect(
      within(reveal).queryByLabelText('conversation.creativeStudio.inspector.onScreenTextLabel')
    ).not.toBeInTheDocument();
  });

  it('preserves by-ID editing and flushing for disclosed secondary script details', () => {
    const phaseEditor = editor();
    render(<WritePhase controller={controller({ editor: phaseEditor })} />);

    const reveal = screen.getByRole('region', { name: 'Reveal' });
    fireEvent.click(
      within(reveal).getByRole('button', { name: 'conversation.creativeStudio.phase.write.moreDetails' })
    );
    const purpose = within(reveal).getByLabelText('conversation.creativeStudio.inspector.purposeLabel');
    const onScreenText = within(reveal).getByLabelText('conversation.creativeStudio.inspector.onScreenTextLabel');

    fireEvent.change(purpose, { target: { value: 'Land the product benefit' } });
    expect(phaseEditor.updateSceneDraftById).toHaveBeenCalledWith('scene-2', {
      purpose: 'Land the product benefit',
    });
    fireEvent.blur(purpose);

    fireEvent.change(onScreenText, { target: { value: 'Built for momentum' } });
    expect(phaseEditor.updateSceneDraftById).toHaveBeenCalledWith('scene-2', {
      onScreenText: 'Built for momentum',
    });
    fireEvent.blur(onScreenText);

    expect(phaseEditor.flushSceneDraftById).toHaveBeenCalledTimes(2);
    expect(phaseEditor.flushSceneDraftById).toHaveBeenNthCalledWith(1, 'scene-2');
    expect(phaseEditor.flushSceneDraftById).toHaveBeenNthCalledWith(2, 'scene-2');
  });

  it('renders every scene as a by-ID editor with route-aware duration options', async () => {
    const props = controller();
    render(<WritePhase controller={props} />);

    expect(screen.getAllByLabelText('conversation.creativeStudio.inspector.titleLabel')).toHaveLength(2);
    expect(screen.getAllByLabelText('conversation.creativeStudio.inspector.narrationLabel')).toHaveLength(2);
    expect(screen.getAllByLabelText('conversation.creativeStudio.inspector.visualPromptLabel')).toHaveLength(2);
    screen
      .getAllByRole('button', { name: 'conversation.creativeStudio.phase.write.moreDetails' })
      .forEach((button) => fireEvent.click(button));
    expect(screen.getAllByLabelText('conversation.creativeStudio.inspector.onScreenTextLabel')).toHaveLength(2);
    expect(screen.getAllByLabelText('conversation.creativeStudio.inspector.purposeLabel')).toHaveLength(2);

    const durations = screen.getAllByRole('combobox', {
      name: 'conversation.creativeStudio.inspector.durationLabel',
    });
    expect(durations[0]).toHaveTextContent('5s');
    expect(durations[1]).toHaveTextContent('6s');

    fireEvent.click(durations[0]!);
    const imageOptions = within(await screen.findByRole('listbox')).getAllByRole('option');
    expect(imageOptions.map((option) => option.textContent)).toEqual(['2s', '3s', '4s', '5s', '6s', '7s', '8s']);
    fireEvent.click(screen.getByRole('option', { name: '8s' }));
    expect(props.editor.updateSceneDraftById).toHaveBeenCalledWith('scene-1', { durationSeconds: 8 });
    fireEvent.blur(durations[0]!);
    expect(props.editor.flushSceneDraftById).toHaveBeenCalledWith('scene-1');
    await waitFor(() => expect(screen.queryByRole('listbox', { hidden: true })).not.toBeInTheDocument());

    fireEvent.click(durations[1]!);
    const videoOptions = within(await screen.findByRole('listbox')).getAllByRole('option');
    expect(videoOptions.map((option) => option.textContent)).toEqual([
      '4s',
      '5s',
      '6s',
      '7s',
      '8s',
      '9s',
      '10s',
      '11s',
      '12s',
    ]);
    fireEvent.keyDown(durations[1]!, { key: 'Escape', code: 'Escape', keyCode: 27, which: 27 });
    await waitFor(() => expect(screen.queryByRole('listbox', { hidden: true })).not.toBeInTheDocument());

    fireEvent.change(screen.getAllByLabelText('conversation.creativeStudio.inspector.visualPromptLabel')[1]!, {
      target: { value: 'A revised reveal prompt' },
    });
    expect(props.editor.updateSceneDraftById).toHaveBeenCalledWith('scene-2', {
      visualPrompt: 'A revised reveal prompt',
    });
  });

  it('keeps route-invalid persisted durations visibly flagged', () => {
    const phaseEditor = editor('scene-1', {
      sceneDrafts: {
        'scene-1': editable(scene('scene-1', { durationSeconds: 9 })),
        'scene-2': editable(scene('scene-2')),
      },
    });
    render(<WritePhase controller={controller({ editor: phaseEditor })} />);

    const opening = screen.getByRole('region', { name: 'Opening' });
    expect(
      within(opening).getByRole('combobox', {
        name: 'conversation.creativeStudio.inspector.durationLabel',
      })
    ).toHaveAttribute('aria-invalid', 'true');
    expect(within(opening).getByRole('alert')).toHaveTextContent(
      'conversation.creativeStudio.inspector.invalidDuration'
    );
  });

  it('keeps the duration chip keyboard-operable', async () => {
    const user = userEvent.setup();
    const phaseEditor = editor();
    render(<WritePhase controller={controller({ editor: phaseEditor })} />);

    const opening = screen.getByRole('region', { name: 'Opening' });
    const duration = within(opening).getByRole('combobox', {
      name: 'conversation.creativeStudio.inspector.durationLabel',
    });
    await user.tab();
    await user.tab();
    await user.tab();
    expect(duration).toHaveFocus();

    fireEvent.keyDown(duration, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13 });
    await waitFor(() => expect(duration).toHaveAttribute('aria-expanded', 'true'));
    fireEvent.keyDown(duration, { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, which: 40 });
    fireEvent.keyDown(duration, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13 });

    await waitFor(() =>
      expect(phaseEditor.updateSceneDraftById).toHaveBeenCalledWith('scene-1', { durationSeconds: 6 })
    );
    await waitFor(() => expect(duration).toHaveAttribute('aria-expanded', 'false'));
    await waitFor(() => expect(screen.queryByRole('listbox', { hidden: true })).not.toBeInTheDocument());
  });

  it.each([
    {
      sceneId: 'scene-1',
      selectorIndex: 0,
      initialDraft: editable(scene('scene-1', { durationSeconds: 2 })),
      nextKind: 'video' as const,
      optionLabel: 'conversation.creativeStudio.scene.video',
      expectedDurationSeconds: 4,
    },
    {
      sceneId: 'scene-2',
      selectorIndex: 1,
      initialDraft: editable(scene('scene-2', { mediaKind: 'video', durationSeconds: 12 })),
      nextKind: 'image' as const,
      optionLabel: 'conversation.creativeStudio.scene.image',
      expectedDurationSeconds: 8,
    },
  ])(
    'atomically clamps $sceneId duration when changing to the $nextKind route',
    async ({ sceneId, selectorIndex, initialDraft, nextKind, optionLabel, expectedDurationSeconds }) => {
      const phaseEditor = editor('scene-1', {
        sceneDrafts: {
          'scene-1': selectorIndex === 0 ? initialDraft : editable(scenes[0]!),
          'scene-2': selectorIndex === 1 ? initialDraft : editable(scenes[1]!),
        },
      });
      render(<WritePhase controller={controller({ editor: phaseEditor })} />);

      const selectors = screen.getAllByRole('combobox', {
        name: 'conversation.creativeStudio.inspector.mediaKindLabel',
      });
      fireEvent.click(selectors[selectorIndex]!);
      fireEvent.click(await screen.findByRole('option', { name: optionLabel }));

      expect(phaseEditor.updateSceneDraftById).toHaveBeenCalledExactlyOnceWith(sceneId, {
        mediaKind: nextKind,
        durationSeconds: expectedDurationSeconds,
      });
    }
  );

  it('shows one truthful first-frame reference per row and imports for that scene ID', async () => {
    const props = controller();
    render(<WritePhase controller={props} />);

    expect(screen.getByRole('img', { name: 'conversation.creativeStudio.preview.importReference' })).toHaveAttribute(
      'src',
      'weprompt-studio://asset/project-1/reference-2'
    );
    const referenceActions = screen.getAllByRole('button', {
      name: 'conversation.creativeStudio.phase.write.addReference',
    });
    expect(referenceActions).toHaveLength(2);
    fireEvent.click(referenceActions[1]!);
    await waitFor(() => expect(props.importReference).toHaveBeenCalledWith('scene-2'));
  });

  it('shows a generated plate from the references collection in its scene row', () => {
    const generatedReference: StudioAsset = {
      ...reference,
      managedAsset: { collection: 'references', fileName: 'reference-2.png' },
      sourceVisualPrompt: 'First-frame reference plate',
    };
    render(
      <WritePhase
        controller={controller({
          project: {
            ...project,
            assets: { [generatedReference.id]: generatedReference },
          },
        })}
      />
    );

    expect(screen.getByRole('img', { name: 'conversation.creativeStudio.preview.importReference' })).toHaveAttribute(
      'src',
      'weprompt-studio://asset/project-1/reference-2'
    );
  });

  it('does not offer reference generation while any scene draft is dirty', () => {
    render(<WritePhase controller={controller()} />);

    expect(
      screen.queryByRole('button', { name: 'conversation.creativeStudio.reference.generate' })
    ).not.toBeInTheDocument();
  });

  it('prefills the reference prompt from the live scene draft', async () => {
    const phaseEditor = editor('scene-1', {
      hasUnsavedSceneDrafts: false,
      sceneDrafts: {
        'scene-1': { ...editable(scenes[0]!), visualPrompt: 'A live draft first-frame subject' },
        'scene-2': editable(scenes[1]!),
      },
    });
    render(<WritePhase controller={controller({ editor: phaseEditor })} />);

    fireEvent.click(screen.getAllByRole('button', { name: 'conversation.creativeStudio.reference.generate' })[0]!);
    const dialog = await screen.findByRole('dialog', {
      name: 'conversation.creativeStudio.reference.dialogTitle',
    });

    expect(within(dialog).getByLabelText('conversation.creativeStudio.reference.promptLabel')).toHaveValue(
      'A single cinematic frame, 16:9, no text, no labels, no collage, no split panels. A live draft first-frame subject'
    );
  });

  it('blocks a boilerplate-only reference prompt but accepts an explicit subject', async () => {
    const emptyOpening = scene('scene-1', { visualPrompt: '' });
    const emptyProject = {
      ...project,
      scenes: { ...project.scenes, [emptyOpening.id]: emptyOpening },
    };
    const phaseEditor = editor('scene-1', {
      project: emptyProject,
      hasUnsavedSceneDrafts: false,
      orderedScenes: [emptyOpening, scenes[1]!],
      sceneDrafts: {
        'scene-1': editable(emptyOpening),
        'scene-2': editable(scenes[1]!),
      },
    });
    render(<WritePhase controller={controller({ project: emptyProject, editor: phaseEditor })} />);

    fireEvent.click(screen.getAllByRole('button', { name: 'conversation.creativeStudio.reference.generate' })[0]!);
    const dialog = await screen.findByRole('dialog', {
      name: 'conversation.creativeStudio.reference.dialogTitle',
    });
    const prompt = within(dialog).getByLabelText('conversation.creativeStudio.reference.promptLabel');
    const confirm = within(dialog).getByRole('button', {
      name: 'conversation.creativeStudio.reference.generate',
    });

    expect(prompt).toHaveAttribute('maxlength', '4096');
    expect(confirm).toBeDisabled();

    fireEvent.change(prompt, { target: { value: 'A single cinematic frame of a cobalt travel mug' } });
    expect(confirm).toBeEnabled();
  });

  it('closes the reference prompt dialog when the image catalog role loses readiness', async () => {
    const props = controller({ editor: editor('scene-1', { hasUnsavedSceneDrafts: false }) });
    const view = render(<WritePhase controller={props} />);

    fireEvent.click(screen.getAllByRole('button', { name: 'conversation.creativeStudio.reference.generate' })[0]!);
    expect(
      screen.getByRole('dialog', { name: 'conversation.creativeStudio.reference.dialogTitle' })
    ).toBeInTheDocument();

    view.rerender(
      <WritePhase
        controller={controller({
          models: models({
            catalog: {
              ...catalog,
              image: { status: 'setup_required', selected: null, selectedRoute: null, options: [] },
            },
          }),
          openSingleGenerationReview: props.openSingleGenerationReview,
        })}
      />
    );

    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'conversation.creativeStudio.reference.dialogTitle' })
      ).not.toBeInTheDocument()
    );
    expect(
      screen.queryByRole('button', { name: 'conversation.creativeStudio.reference.generate' })
    ).not.toBeInTheDocument();
    expect(props.openSingleGenerationReview).not.toHaveBeenCalled();
  });

  it('contains no media-generation or spend action anywhere in Write', () => {
    render(<WritePhase controller={controller({ editor: editor('scene-1', { hasUnsavedSceneDrafts: false }) })} />);

    expect(screen.queryByRole('button', { name: /render|generate image|generate video/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/credit|session spend|estimated cost/i)).not.toBeInTheDocument();
  });

  /**
   * D10: the Director is the only writing assistant in Studio.
   *
   * Write used to dock a second one — inline at full width, behind an "Ask assistant" opener below
   * it — offering a subset of what the pane beside it already does. Removed means removed at every
   * width, opener included; an assistant that only appears in one layout is the same surface hiding.
   */
  it('hosts no writing assistant of its own at any width', () => {
    const view = render(<WritePhase controller={controller()} layoutMode='inline' />);

    for (const mode of ['inline', 'drawer', 'compact'] as const) {
      view.rerender(<WritePhase controller={controller()} layoutMode={mode} />);
      const scriptTable = screen.getByRole('region', {
        name: 'conversation.creativeStudio.phase.write.scriptTableTitle',
      });
      // Guards the guard: the phase really did render at this width.
      expect(scriptTable, mode).toBeVisible();

      // The script is the whole of Write's work area. A sibling here is the shape every version of
      // the assistant took — the inline card, and the opener button that stood in for it below
      // 1120px. Asserting only on the rendered drawer would miss the opener entirely, because Arco
      // does not mount a Drawer until it is first opened.
      const workspace = scriptTable.parentElement;
      expect(workspace, mode).not.toBeNull();
      expect([...workspace!.children], mode).toEqual([scriptTable]);
      expect(screen.queryByRole('complementary'), mode).not.toBeInTheDocument();
      expect(document.querySelector('.arco-drawer'), mode).toBeNull();
      expect(document.querySelector('[data-assistant-presentation]'), mode).toBeNull();
    }
  });

  /**
   * Write must NOT mount its own conversation.
   *
   * It used to, which meant one thread had two mounts and each phase called
   * `useBriefConversation` separately. The shell now owns the single mount, so a phase change
   * cannot tear down a streaming reply — and this asserts Write does not quietly reintroduce a
   * second one. Presence of the mount is covered by StudioShell.dom.test.tsx.
   *
   * The provider is what gives this teeth. Rendered bare, Write reads the ABSENT fallback, so a
   * conversation surface put back behind `state.kind === 'ready'` would never render and the
   * assertion would hold no matter what the component does.
   */
  it('leaves the conversation to the shell instead of mounting a second copy', () => {
    writeConversationHarness.result.state = { kind: 'ready', conversation: directorConversation };
    writeConversationHarness.messages = ['A 20-second teaser.', 'Five shots, 20 seconds.'];

    renderInShell(<WritePhase controller={controller()} layoutMode='inline' />);

    // Guards the guard: the provider is live and feeding Write a ready conversation.
    expect(writeConversationHarness.providedProjectIds).toEqual([project.id]);
    expect(writeConversationHarness.mountedConversationIds).toEqual([]);
    expect(screen.queryByText('Five shots, 20 seconds.')).not.toBeInTheDocument();
  });

  it('adds no second conversation region once the Director thread exists', () => {
    writeConversationHarness.result.state = { kind: 'ready', conversation: directorConversation };

    renderInShell(<WritePhase controller={controller()} layoutMode='inline' />);

    // Guards the guard: the provider is live and feeding Write a ready conversation.
    expect(writeConversationHarness.providedProjectIds).toEqual([project.id]);
    // The Director pane already carries this name. A second region under it sends a screen-reader
    // user landmark-hopping into a rail that holds no conversation at all.
    expect(
      screen.queryByRole('complementary', { name: 'conversation.creativeStudio.brief.conversationTitle' })
    ).not.toBeInTheDocument();
  });

  it('leaves no stylesheet behind for the surfaces it no longer renders', () => {
    const stylesheet = readFileSync(
      resolve(
        process.cwd(),
        'packages/desktop/src/renderer/pages/studio/components/PhaseShell/phases/write/write.module.css'
      ),
      'utf8'
    );

    // Guards the guard: a wrong path would make the assertions below pass on an empty string.
    expect(stylesheet).toMatch(/^\.workspace\b/m);
    expect(stylesheet).not.toMatch(/^\.conversation(Rail|Surface)\b/m);
    expect(stylesheet).not.toMatch(/^\.assistantSlot\b/m);
    expect(stylesheet).not.toMatch(/assistantSlot/);
  });
  it('selects and focuses the requested visual prompt, then clears the route intent', async () => {
    const firstEditor = editor('scene-1');
    const props = controller({
      editor: firstEditor,
      writeFocusIntent: { sceneId: 'scene-2', field: 'visualPrompt' },
    });
    const view = render(<WritePhase controller={props} />);

    expect(firstEditor.selectScene).toHaveBeenCalledWith('scene-2');
    const selectedEditor = editor('scene-2');
    const selectedProps = controller({
      editor: selectedEditor,
      writeFocusIntent: { sceneId: 'scene-2', field: 'visualPrompt' },
      clearWriteFocusIntent: props.clearWriteFocusIntent,
    });
    view.rerender(<WritePhase controller={selectedProps} />);

    await waitFor(() => expect(screen.getByDisplayValue('A detailed reveal')).toHaveFocus());
    expect(props.clearWriteFocusIntent).toHaveBeenCalledOnce();
  });

  it('clears a missing-scene focus intent without moving focus', () => {
    const phaseEditor = editor();
    const props = controller({
      editor: phaseEditor,
      writeFocusIntent: { sceneId: 'removed-scene', field: 'visualPrompt' },
    });
    render(<WritePhase controller={props} />);

    expect(props.clearWriteFocusIntent).toHaveBeenCalledOnce();
    expect(phaseEditor.selectScene).not.toHaveBeenCalled();
  });

  it('uses the shell layout contract without observing its own phase root', () => {
    const { container } = render(<WritePhase controller={controller()} />);

    const phaseRoot = container.querySelector('section[data-layout]');
    expect(phaseRoot).not.toBeNull();
    expect(observedTargets).not.toContain(phaseRoot);
  });
});
