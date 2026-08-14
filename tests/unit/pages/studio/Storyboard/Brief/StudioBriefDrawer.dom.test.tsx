/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { StudioAsset, StudioRendererProject } from '@/common/types/project/creativeStudioTypes';
import {
  StudioBriefDrawer,
  type StudioBriefDrawerController,
} from '@renderer/pages/studio/components/PhaseShell/BriefDrawer';
import type { UseStoryboardEditorResult } from '@renderer/pages/studio/hooks/useStoryboardEditor';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

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
  mutationPending: false,
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
});
