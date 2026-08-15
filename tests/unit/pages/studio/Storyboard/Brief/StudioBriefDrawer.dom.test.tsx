/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { StudioAsset, StudioRendererProject } from '@/common/types/project/creativeStudioTypes';
import {
  StudioBriefDrawer,
  type StudioBriefDrawerController,
} from '@renderer/pages/studio/components/PhaseShell/BriefDrawer';
import type { UseStoryboardEditorResult } from '@renderer/pages/studio/hooks/useStoryboardEditor';
import type { UseStudioModelsResult } from '@renderer/pages/studio/hooks/useStudioModels';

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

const project = (overrides: Partial<StudioRendererProject> = {}): StudioRendererProject => ({
  schemaVersion: 1,
  revision: 2,
  id: 'project-1',
  name: 'Launch film',
  brief: 'A short launch story',
  rules: [],
  ruleListUndo: null,
  aspectRatio: '16:9',
  targetDurationSeconds: 15,
  resolution: '1080p',
  sceneOrder: [],
  scenes: {},
  assets: {},
  jobs: {},
  routing: { storyboard: null, image: null, video: null },
  createdAt: '2026-08-04T00:00:00.000Z',
  updatedAt: '2026-08-04T00:00:00.000Z',
  ...overrides,
});

const generatedAsset = (collection: StudioAsset['managedAsset']['collection']): StudioAsset => ({
  id: 'asset-1',
  projectId: 'project-1',
  sceneId: null,
  mediaKind: 'image',
  mimeType: 'image/png',
  managedAsset: { collection, fileName: 'asset-1.png' },
  byteSize: 1,
  sha256: '1'.repeat(64),
  createdAt: '2026-08-04T00:00:00.000Z',
});

const briefReference = (
  id: string,
  role: 'cast' | 'look',
  label: string,
  createdAt = '2026-08-04T00:00:00.000Z'
): StudioAsset => ({
  ...generatedAsset('imports'),
  id,
  managedAsset: { collection: 'imports', fileName: `${id}.png` },
  createdAt,
  briefReferenceRole: role,
  briefReferenceLabel: label,
});

const editor = (overrides: Partial<UseStoryboardEditorResult> = {}): UseStoryboardEditorResult =>
  ({
    project: project(),
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
    remainingDurationSeconds: 15,
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
    ...overrides,
  }) as UseStoryboardEditorResult;

const controller = (overrides: Partial<StudioBriefDrawerController> = {}): StudioBriefDrawerController => ({
  project: project(),
  editor: editor(),
  models: {
    catalog: null,
    loading: false,
    errorMessageKey: null,
    selectionIssue: null,
    pendingRole: null,
    refresh: vi.fn(async () => undefined),
    updateSelection: vi.fn(async () => true),
  } satisfies UseStudioModelsResult,
  mutationPending: false,
  generationReviewOpen: false,
  briefReferenceMutationPending: false,
  briefReferenceIssueMessageKey: null,
  addBriefReference: vi.fn(async () => null),
  removeBriefReference: vi.fn(async () => false),
  openModelSettings: vi.fn(),
  ...overrides,
});

const renderDrawer = (value = controller(), onClose = vi.fn()) => {
  const view = render(<StudioBriefDrawer visible controller={value} onClose={onClose} />);
  const dialog = screen.getByRole('dialog', { name: 'conversation.creativeStudio.phase.brief.title' });
  return { dialog, onClose, view };
};

describe('StudioBriefDrawer', () => {
  it('renders the remaining Brief copy and controls as a dialog, not a view', () => {
    const { dialog } = renderDrawer();

    expect(within(dialog).getByText('conversation.creativeStudio.phase.brief.description')).toBeVisible();
    expect(within(dialog).getByText('conversation.creativeStudio.phase.shared.noMediaGeneration')).toBeVisible();
    expect(within(dialog).getByLabelText('conversation.creativeStudio.project.brief')).toHaveValue(
      'A short launch story'
    );
    expect(
      within(dialog).getByRole('spinbutton', { name: 'conversation.creativeStudio.phase.brief.durationLabel' })
    ).toHaveValue('15');
    expect(
      within(dialog).getByRole('combobox', { name: 'conversation.creativeStudio.phase.brief.aspectRatioLabel' })
    ).toBeVisible();
    expect(dialog.querySelector('[data-studio-phase-heading]')).toBeNull();
  });

  it('mounts the compact Engine Strip below project constraints and above save recovery', () => {
    const phaseEditor = editor({
      conflict: {
        operation: 'update_project',
        code: 'stale_project',
        messageKey: 'conversation.creativeStudio.errors.staleProject',
      },
    });
    const { dialog } = renderDrawer(controller({ editor: phaseEditor }));
    const constraints = dialog.querySelector('[data-studio-brief-constraints]');
    const strip = within(dialog).getByRole('region', {
      name: 'conversation.creativeStudio.models.engine.label',
    });
    const error = within(dialog).getByRole('alert');

    expect(constraints).not.toBeNull();
    expect(strip).toHaveAttribute('data-variant', 'compact');
    expect(constraints!.compareDocumentPosition(strip) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    expect(strip.compareDocumentPosition(error) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
  });

  it('edits the brief text and flushes it on blur', () => {
    const props = controller();
    const { dialog } = renderDrawer(props);
    const brief = within(dialog).getByLabelText('conversation.creativeStudio.project.brief');

    fireEvent.change(brief, { target: { value: 'A sharper launch story' } });
    expect(props.editor.updateProjectDraft).toHaveBeenCalledWith({ brief: 'A sharper launch story' });
    fireEvent.blur(brief);
    expect(props.editor.flushProjectDraft).toHaveBeenCalledOnce();
  });

  it('flushes a just-typed edit before completing a close request', async () => {
    let resolveFlush: ((saved: boolean) => void) | undefined;
    const flushProjectDraft = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolveFlush = resolve;
        })
    );
    const props = controller({ editor: editor({ flushProjectDraft }) });
    const onClose = vi.fn();
    const { dialog } = renderDrawer(props, onClose);

    fireEvent.change(within(dialog).getByLabelText('conversation.creativeStudio.project.brief'), {
      target: { value: 'Typed immediately before close' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'common.close' }));

    expect(props.editor.updateProjectDraft).toHaveBeenCalledWith({ brief: 'Typed immediately before close' });
    expect(flushProjectDraft).toHaveBeenCalledOnce();
    expect(onClose).not.toHaveBeenCalled();
    resolveFlush?.(false);
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });

  it('explains invalid draft fields without flushing them on blur', () => {
    const draft = {
      brief: 'x'.repeat(16 * 1024 + 1),
      aspectRatio: '16:9' as const,
      targetDurationSeconds: 4,
    };
    const props = controller({ editor: editor({ projectDraft: draft }) });
    const { dialog } = renderDrawer(props);

    expect(within(dialog).getAllByRole('alert')).toHaveLength(2);
    expect(within(dialog).getByText('conversation.creativeStudio.errors.invalidPayload')).toBeVisible();
    expect(within(dialog).getByText('conversation.creativeStudio.create.invalidDuration')).toBeVisible();
    fireEvent.blur(within(dialog).getByLabelText('conversation.creativeStudio.project.brief'));
    expect(props.editor.flushProjectDraft).not.toHaveBeenCalled();
  });

  it('keeps project-update conflict recovery in the drawer', async () => {
    const phaseEditor = editor({
      conflict: {
        operation: 'update_project',
        code: 'stale_project',
        messageKey: 'conversation.creativeStudio.errors.staleProject',
      },
    });
    const { dialog } = renderDrawer(controller({ editor: phaseEditor }));

    expect(within(dialog).getByRole('alert')).toHaveTextContent('conversation.creativeStudio.errors.staleProject');
    fireEvent.click(within(dialog).getByRole('button', { name: 'conversation.creativeStudio.storyboard.retry' }));
    await waitFor(() => expect(phaseEditor.retryConflict).toHaveBeenCalledOnce());
    fireEvent.click(within(dialog).getByRole('button', { name: 'conversation.creativeStudio.storyboard.discard' }));
    expect(phaseEditor.discardConflict).toHaveBeenCalledOnce();
  });

  it('locks only the aspect selector when generated output exists', () => {
    const importedProject = project({ assets: { 'asset-1': generatedAsset('imports') } });
    const { dialog, view } = renderDrawer(controller({ project: importedProject }));
    expect(
      within(dialog).getByRole('combobox', { name: 'conversation.creativeStudio.phase.brief.aspectRatioLabel' })
    ).toBeEnabled();

    const lockedProject = project({ assets: { 'asset-1': generatedAsset('assets') } });
    view.rerender(<StudioBriefDrawer visible controller={controller({ project: lockedProject })} onClose={vi.fn()} />);
    expect(
      screen.getByRole('combobox', { name: 'conversation.creativeStudio.phase.brief.aspectRatioLabel' })
    ).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText('conversation.creativeStudio.phase.brief.aspectLockedHelp')).toBeVisible();
    expect(
      screen.getByRole('spinbutton', { name: 'conversation.creativeStudio.phase.brief.durationLabel' })
    ).toBeEnabled();
  });

  it('does not restore content already owned by the project frame or Director', () => {
    const { dialog } = renderDrawer(controller({ editor: editor({ projectSaveState: 'dirty' }) }));

    expect(within(dialog).queryByRole('status')).not.toBeInTheDocument();
    expect(
      within(dialog).queryByLabelText('conversation.creativeStudio.phase.brief.nameLabel')
    ).not.toBeInTheDocument();
    expect(within(dialog).queryByText('conversation.creativeStudio.brief.proposalTitle')).not.toBeInTheDocument();
    expect(within(dialog).queryByTestId('aionrs-chat')).not.toBeInTheDocument();
    expect(
      within(dialog).queryByRole('button', { name: 'conversation.creativeStudio.phase.brief.startWriting' })
    ).not.toBeInTheDocument();
  });

  it('mounts inherited Cast then Look references between constraints and engines with managed previews', () => {
    const longGermanLabel =
      'Ausfuehrliche Charakterreferenz mit vollstaendig sichtbarer Bezeichnung fuer schmale Ansichten';
    const castLater = briefReference('cast-z', 'cast', 'Second cast', '2026-08-04T00:00:02.000Z');
    const castEarlier = briefReference('cast-a', 'cast', longGermanLabel, '2026-08-04T00:00:01.000Z');
    const look = briefReference('look-a', 'look', 'Copper night palette', '2026-08-04T00:00:00.000Z');
    const refsProject = project({
      assets: { [look.id]: look, [castLater.id]: castLater, [castEarlier.id]: castEarlier },
    });
    const { dialog } = renderDrawer(controller({ project: refsProject }));
    const constraints = dialog.querySelector('[data-studio-brief-constraints]');
    const references = within(dialog).getByRole('region', {
      name: 'conversation.creativeStudio.briefReferences.title',
    });
    const strip = within(dialog).getByRole('region', { name: 'conversation.creativeStudio.models.engine.label' });

    expect(constraints!.compareDocumentPosition(references) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    expect(references.compareDocumentPosition(strip) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    expect(
      within(references).getByRole('heading', {
        level: 2,
        name: 'conversation.creativeStudio.briefReferences.title',
      })
    ).toBeVisible();
    expect(
      within(references).getByRole('heading', {
        level: 3,
        name: 'conversation.creativeStudio.briefReferences.castHeading',
      })
    ).toBeVisible();
    expect(
      within(references).getByRole('heading', {
        level: 3,
        name: 'conversation.creativeStudio.briefReferences.lookHeading',
      })
    ).toBeVisible();
    expect(
      within(references).getByText('conversation.creativeStudio.briefReferences.inheritanceDescription')
    ).toBeVisible();
    const groups = within(references).getAllByRole('group');
    expect(groups.map((group) => group.getAttribute('aria-label'))).toEqual([
      'conversation.creativeStudio.briefReferences.castHeading',
      'conversation.creativeStudio.briefReferences.lookHeading',
    ]);
    expect(
      within(groups[0]!)
        .getAllByRole('img')
        .map((image) => image.getAttribute('alt'))
    ).toEqual([
      `conversation.creativeStudio.briefReferences.previewAccessible:role=conversation.creativeStudio.briefReferences.castHeading,label=${longGermanLabel}`,
      'conversation.creativeStudio.briefReferences.previewAccessible:role=conversation.creativeStudio.briefReferences.castHeading,label=Second cast',
    ]);
    expect(within(groups[1]!).getByRole('img')).toHaveAttribute('src', 'weprompt-studio://asset/project-1/look-a');
    expect(within(references).getByText(longGermanLabel)).not.toHaveAttribute('title');
    expect(
      within(references).getByRole('button', {
        name: `conversation.creativeStudio.briefReferences.removeAccessible:label=${longGermanLabel}`,
      })
    ).toHaveTextContent('conversation.creativeStudio.briefReferences.removeFromBrief');
  });

  it('shows empty roles, the six-reference ceiling, and selected-engine recovery without hiding Remove', () => {
    const empty = renderDrawer();
    expect(within(empty.dialog).getByText('conversation.creativeStudio.briefReferences.castEmpty')).toBeVisible();
    expect(within(empty.dialog).getByText('conversation.creativeStudio.briefReferences.lookEmpty')).toBeVisible();
    expect(
      within(empty.dialog).getByRole('button', { name: 'conversation.creativeStudio.briefReferences.addCast' })
    ).toBeEnabled();
    empty.view.unmount();

    const references = Object.fromEntries(
      Array.from({ length: 6 }, (_, index) => {
        const value = briefReference(`cast-${index}`, 'cast', `Cast ${index}`);
        return [value.id, value];
      })
    );
    const selectedImage = {
      choiceId: 'choice-image',
      providerId: 'provider-image',
      providerName: 'Image provider',
      model: 'image-model',
      integrationLabelKey: 'imageApi' as const,
      health: 'available' as const,
      kind: 'image' as const,
      constraints: {
        aspectRatios: ['16:9' as const],
        resolutions: ['1080p' as const],
        minDurationSeconds: 1,
        maxDurationSeconds: 60,
        supportsFirstFrame: true,
        maxConditioningImages: 0,
        silentOutput: true,
      },
    };
    const openModelSettings = vi.fn();
    const fullController = controller({
      project: project({ assets: references }),
      models: {
        ...controller().models,
        catalog: {
          storyboard: { status: 'selection_required', selected: null, options: [] },
          image: {
            status: 'ready',
            selected: {
              choiceId: selectedImage.choiceId,
              providerId: selectedImage.providerId,
              model: selectedImage.model,
            },
            selectedRoute: selectedImage,
            selectionIssue: null,
            options: [selectedImage],
          },
          video: {
            status: 'selection_required',
            selected: null,
            selectedRoute: null,
            selectionIssue: null,
            options: [],
          },
          catalogVersion: 'catalog-1',
        },
      },
      openModelSettings,
    });
    const { dialog } = renderDrawer(fullController);
    const addButtons = [
      within(dialog).getByRole('button', { name: 'conversation.creativeStudio.briefReferences.addCast' }),
      within(dialog).getByRole('button', { name: 'conversation.creativeStudio.briefReferences.addLook' }),
    ];

    expect(addButtons.every((button) => button.hasAttribute('disabled'))).toBe(true);
    expect(addButtons[0]).toHaveAccessibleDescription('conversation.creativeStudio.briefReferences.limitReached');
    expect(addButtons[1]).toHaveAccessibleDescription('conversation.creativeStudio.briefReferences.limitReached');
    expect(within(dialog).getByText('conversation.creativeStudio.briefReferences.limitReached')).toBeVisible();
    expect(within(dialog).getAllByRole('button', { name: /briefReferences\.removeAccessible/ })[0]).toBeEnabled();
    expect(within(dialog).getByText('conversation.creativeStudio.briefReferences.engineCapacityNone')).toBeVisible();
    expect(
      within(dialog).queryByText('conversation.creativeStudio.briefReferences.capacityMismatch:count=6,maximum=0')
    ).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'conversation.creativeStudio.models.engine.manage' }));
    expect(openModelSettings).toHaveBeenCalledWith('/settings/model');
  });

  it('states exact selected-engine mismatch counts without changing the route', () => {
    const first = briefReference('cast-a', 'cast', 'Cast A');
    const second = briefReference('look-a', 'look', 'Look A');
    const selectedImage = {
      choiceId: 'choice-image',
      providerId: 'provider-image',
      providerName: 'Image provider',
      model: 'image-model',
      integrationLabelKey: 'imageApi' as const,
      health: 'available' as const,
      kind: 'image' as const,
      constraints: {
        aspectRatios: ['16:9' as const],
        resolutions: ['1080p' as const],
        minDurationSeconds: 1,
        maxDurationSeconds: 60,
        supportsFirstFrame: true,
        maxConditioningImages: 1,
        silentOutput: true,
      },
    };
    const props = controller({
      project: project({ assets: { [first.id]: first, [second.id]: second } }),
      models: {
        ...controller().models,
        catalog: {
          storyboard: { status: 'selection_required', selected: null, options: [] },
          image: {
            status: 'ready',
            selected: {
              choiceId: selectedImage.choiceId,
              providerId: selectedImage.providerId,
              model: selectedImage.model,
            },
            selectedRoute: selectedImage,
            selectionIssue: null,
            options: [selectedImage],
          },
          video: {
            status: 'selection_required',
            selected: null,
            selectedRoute: null,
            selectionIssue: null,
            options: [],
          },
          catalogVersion: 'catalog-1',
        },
      },
    });
    const { dialog } = renderDrawer(props);

    expect(
      within(dialog).getByText('conversation.creativeStudio.briefReferences.capacityMismatch:count=2,maximum=1')
    ).toBeVisible();
    expect(props.models.updateSelection).not.toHaveBeenCalled();
  });

  it('disables only reference mutation controls while their synchronous guard is pending', () => {
    const cast = briefReference('cast-a', 'cast', 'Cast A');
    const props = controller({
      project: project({ assets: { [cast.id]: cast } }),
      briefReferenceMutationPending: true,
    });
    const { dialog } = renderDrawer(props);

    expect(
      within(dialog).getByRole('button', { name: 'conversation.creativeStudio.briefReferences.addCast' })
    ).toBeDisabled();
    expect(
      within(dialog).getByRole('button', { name: 'conversation.creativeStudio.briefReferences.addLook' })
    ).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: /briefReferences\.removeAccessible/ })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'common.close' })).toBeEnabled();
  });

  it('restores Add focus on cancel and focuses an imported card only after canonical rerender', async () => {
    const imported = briefReference('cast-new', 'cast', 'New cast');
    const importResult = deferred<string | null>();
    const addBriefReference = vi.fn(() => importResult.promise);
    const initialController = controller({ addBriefReference });
    const onClose = vi.fn();
    const { dialog, view } = renderDrawer(initialController, onClose);
    const add = within(dialog).getByRole('button', { name: 'conversation.creativeStudio.briefReferences.addCast' });

    fireEvent.click(add);
    view.rerender(
      <StudioBriefDrawer
        visible
        controller={controller({
          project: project({ assets: { [imported.id]: imported } }),
          addBriefReference,
        })}
        onClose={onClose}
      />
    );
    await act(async () => importResult.resolve(imported.id));

    await waitFor(() =>
      expect(
        screen.getByRole('button', {
          name: 'conversation.creativeStudio.briefReferences.removeAccessible:label=New cast',
        })
      ).toHaveFocus()
    );

    const cancelled = vi.fn(async () => null);
    view.rerender(
      <StudioBriefDrawer visible controller={controller({ addBriefReference: cancelled })} onClose={onClose} />
    );
    const addLook = screen.getByRole('button', { name: 'conversation.creativeStudio.briefReferences.addLook' });
    fireEvent.click(addLook);
    await waitFor(() => expect(addLook).toHaveFocus());
  });

  it.each([
    { name: 'next', removeId: 'cast-a', remaining: ['cast-b', 'cast-c'], focused: 'Cast B' },
    { name: 'previous', removeId: 'cast-c', remaining: ['cast-a', 'cast-b'], focused: 'Cast B' },
    { name: 'role Add', removeId: 'cast-a', remaining: [], focused: null },
  ])('moves detach focus to the $name target after canonical rerender', async ({ removeId, remaining, focused }) => {
    const assets = {
      'cast-a': briefReference('cast-a', 'cast', 'Cast A', '2026-08-04T00:00:01.000Z'),
      'cast-b': briefReference('cast-b', 'cast', 'Cast B', '2026-08-04T00:00:02.000Z'),
      'cast-c': briefReference('cast-c', 'cast', 'Cast C', '2026-08-04T00:00:03.000Z'),
    };
    const initialAssets = focused === null ? { 'cast-a': assets['cast-a'] } : assets;
    const detachResult = deferred<boolean>();
    const removeBriefReference = vi.fn(() => detachResult.promise);
    const onClose = vi.fn();
    const view = render(
      <StudioBriefDrawer
        visible
        controller={controller({ project: project({ assets: initialAssets }), removeBriefReference })}
        onClose={onClose}
      />
    );

    fireEvent.click(
      screen.getByRole('button', {
        name: `conversation.creativeStudio.briefReferences.removeAccessible:label=${initialAssets[removeId as keyof typeof initialAssets]!.briefReferenceLabel}`,
      })
    );
    const remainingAssets = Object.fromEntries(remaining.map((id) => [id, assets[id as keyof typeof assets]]));
    view.rerender(
      <StudioBriefDrawer
        visible
        controller={controller({ project: project({ revision: 3, assets: remainingAssets }), removeBriefReference })}
        onClose={onClose}
      />
    );
    await act(async () => detachResult.resolve(true));

    const expected =
      focused === null
        ? screen.getByRole('button', { name: 'conversation.creativeStudio.briefReferences.addCast' })
        : screen.getByRole('button', {
            name: `conversation.creativeStudio.briefReferences.removeAccessible:label=${focused}`,
          });
    await waitFor(() => expect(expected).toHaveFocus());
  });
});

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};
