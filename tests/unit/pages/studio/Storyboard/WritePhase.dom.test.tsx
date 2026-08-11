/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  StudioAsset,
  StudioEditableScene,
  StudioRendererProject,
  StudioRouteCatalog,
  StudioScene,
} from '@/common/types/project/creativeStudioTypes';
import { WritePhase } from '@renderer/pages/studio/components/PhaseShell/phases/WritePhase';
import type { WritePhaseController } from '@renderer/pages/studio/components/PhaseShell/types';
import type { UseStoryboardEditorResult } from '@renderer/pages/studio/hooks/useStoryboardEditor';
import type { UseStudioModelsResult } from '@renderer/pages/studio/hooks/useStudioModels';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => (key === 'common.unit.second_short' ? 's' : key),
  }),
}));

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

describe('WritePhase', () => {
  beforeEach(() => {
    observedTargets.length = 0;
    vi.stubGlobal('ResizeObserver', ResizeObserverMock);
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

    render(<WritePhase controller={controller({ project: emptyProject, editor: phaseEditor })} />);

    const reveal = screen.getByRole('region', { name: 'Reveal' });
    expect(within(reveal).getByLabelText('conversation.creativeStudio.inspector.visualPromptLabel')).toHaveAttribute(
      'placeholder',
      'conversation.creativeStudio.phase.write.visualPlaceholder'
    );
    expect(
      within(reveal).getByRole('button', { name: 'conversation.creativeStudio.phase.write.suggestVisual' })
    ).toBeInTheDocument();
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

  it('keeps Fit to goal at summary level and contains no media-generation or spend action', () => {
    const phaseEditor = editor('scene-1', { hasUnsavedSceneDrafts: false });
    const props = controller({ editor: phaseEditor });
    render(<WritePhase controller={props} />);

    const fitButton = screen.getByRole('button', {
      name: 'conversation.creativeStudio.phase.write.fitToGoal',
    });
    expect(fitButton).toBeEnabled();
    fireEvent.click(fitButton);
    expect(phaseEditor.fitToTarget).toHaveBeenCalledWith('0123456789abcdef');
    expect(screen.queryByRole('button', { name: /render|generate image|generate video/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/credit|session spend|estimated cost/i)).not.toBeInTheDocument();
  });

  it('renders proportional pacing blocks, positions the goal marker, and selects a clicked shot', () => {
    const phaseEditor = editor('scene-1', { hasUnsavedSceneDrafts: false });
    render(<WritePhase controller={controller({ editor: phaseEditor })} />);

    const pacing = screen.getByRole('region', {
      name: 'conversation.creativeStudio.phase.write.pacingTitle',
    });
    const blocks = [...pacing.querySelectorAll<HTMLElement>('[data-pacing-scene]')];
    expect(blocks.map((block) => block.style.flexGrow)).toEqual(['5', '6']);
    expect(pacing.querySelector<HTMLElement>('[data-pacing-shot-span]')).toHaveStyle({
      width: `${(11 / 15) * 100}%`,
    });
    expect(pacing.querySelector<HTMLElement>('[data-pacing-goal]')).toHaveStyle({
      left: `${(15 / 11) * 100}%`,
    });

    fireEvent.click(within(pacing).getAllByRole('button')[1]!);
    expect(phaseEditor.selectScene).toHaveBeenCalledWith('scene-2');
  });

  it('announces the Write timing advisory politely at the pacing bar', () => {
    render(
      <WritePhase
        controller={controller({
          advisory: {
            messageKey: 'conversation.creativeStudio.review.durationMismatch',
            anchor: 'pacing',
          },
        })}
      />
    );

    const advisory = screen.getByText('conversation.creativeStudio.review.durationMismatch');
    expect(advisory).toHaveAttribute('role', 'status');
    expect(advisory).toHaveAttribute('aria-live', 'polite');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('keeps unreachable fit errors assertive', () => {
    const fitOutcome = {
      status: 'unreachable' as const,
      reason: 'target_out_of_bounds' as const,
      project,
      lockedSceneIds: [],
      minimumTotalSeconds: 18,
      maximumTotalSeconds: 24,
    };
    render(
      <WritePhase
        controller={controller({
          editor: editor('scene-1', {
            latestFitOutcome: fitOutcome,
            latestFitCatalogVersion: catalog.catalogVersion,
          }),
        })}
      />
    );

    expect(screen.getByRole('alert')).toHaveTextContent(
      'conversation.creativeStudio.storyboard.fitUnreachable.target_out_of_bounds'
    );
  });

  it('docks the assistant in the inline right column and keeps the drawer trigger for narrower layouts', () => {
    const view = render(<WritePhase controller={controller()} layoutMode='inline' />);

    const assistant = screen.getByRole('complementary', {
      name: 'conversation.creativeStudio.phase.write.assistantTitle',
    });
    expect(assistant).toHaveAttribute('data-assistant-presentation', 'inline');
    expect(assistant.closest('[data-write-assistant-column]')).toHaveAttribute('data-layout', 'inline');
    expect(
      screen.queryByRole('button', { name: 'conversation.creativeStudio.phase.write.askAssistant' })
    ).not.toBeInTheDocument();

    view.rerender(<WritePhase controller={controller()} layoutMode='drawer' />);
    expect(
      screen.getByRole('button', { name: 'conversation.creativeStudio.phase.write.askAssistant' })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('complementary', { name: 'conversation.creativeStudio.phase.write.assistantTitle' })
    ).not.toBeInTheDocument();
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
