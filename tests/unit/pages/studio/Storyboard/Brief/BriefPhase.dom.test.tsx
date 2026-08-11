/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { StudioAsset, StudioRendererProject } from '@/common/types/project/creativeStudioTypes';
import { BriefPhase } from '@renderer/pages/studio/components/PhaseShell/phases/brief';
import type { BriefPhaseController } from '@renderer/pages/studio/components/PhaseShell/types';
import type { UseStoryboardEditorResult } from '@renderer/pages/studio/hooks/useStoryboardEditor';

const briefConversationHarness = vi.hoisted(() => ({
  result: {
    state: { kind: 'absent' } as { kind: string; conversation?: unknown; conversationId?: string },
    errorMessageKey: null as string | null,
    sendFirstMessage: vi.fn(async () => {}),
    recreate: vi.fn(),
  },
}));

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@renderer/pages/studio/components/PhaseShell/phases/brief/useBriefConversation', () => ({
  useBriefConversation: () => briefConversationHarness.result,
}));
vi.mock('@renderer/pages/conversation/platforms/aionrs/AionrsChat', () => ({
  default: () => <div data-testid='aionrs-chat' />,
}));
vi.mock('@renderer/pages/conversation/platforms/aionrs/useAionrsModelSelection', () => ({
  useAionrsModelSelection: () => ({
    providers: [],
    getAvailableModels: vi.fn(),
    handleSelectModel: vi.fn(),
    getDisplayModelName: vi.fn(),
  }),
}));

const project = (overrides: Partial<StudioRendererProject> = {}): StudioRendererProject => ({
  schemaVersion: 1,
  revision: 2,
  id: 'project-1',
  name: 'Launch film',
  brief: 'A short launch story',
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

const controller = (overrides: Partial<BriefPhaseController> = {}): BriefPhaseController => ({
  project: project(),
  proposals: [],
  readiness: {
    sceneStatuses: {},
    totalSceneCount: 0,
    readySceneIds: [],
    selectedAssetCount: 0,
    durationDeltaSeconds: -15,
  },
  editor: editor(),
  advisory: null,
  mutationPending: false,
  requestTransition: vi.fn(),
  acceptProposal: vi.fn(),
  rejectProposal: vi.fn(),
  ...overrides,
});

describe('BriefPhase', () => {
  beforeEach(() => {
    briefConversationHarness.result.state = { kind: 'absent' };
    briefConversationHarness.result.errorMessageKey = null;
    briefConversationHarness.result.sendFirstMessage.mockClear();
    briefConversationHarness.result.recreate.mockClear();
  });

  it('renders the intent composer with the editable form controls before the conversation exists', () => {
    const props = controller();
    render(<BriefPhase controller={props} />);

    expect(screen.getByLabelText('conversation.creativeStudio.phase.brief.nameLabel')).toHaveValue('Launch film');
    expect(screen.getByPlaceholderText('conversation.creativeStudio.brief.composerPlaceholder')).toHaveValue(
      'A short launch story'
    );
    expect(
      screen.getByRole('spinbutton', { name: 'conversation.creativeStudio.phase.brief.durationLabel' })
    ).toHaveValue('15');
    expect(
      screen.getByRole('combobox', { name: 'conversation.creativeStudio.phase.brief.aspectRatioLabel' })
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('conversation.creativeStudio.phase.brief.nameLabel'), {
      target: { value: 'Launch film v2' },
    });
    fireEvent.change(
      screen.getByRole('spinbutton', { name: 'conversation.creativeStudio.phase.brief.durationLabel' }),
      { target: { value: '20' } }
    );

    expect(props.editor.updateProjectDraft).toHaveBeenCalledWith({ name: 'Launch film v2' });
    expect(props.editor.updateProjectDraft).toHaveBeenCalledWith({ targetDurationSeconds: 20 });
    expect(screen.getByRole('button', { name: 'conversation.creativeStudio.brief.composerSend' })).toBeInTheDocument();
    expect(screen.queryByText('conversation.creativeStudio.project.resolution')).not.toBeInTheDocument();
    expect(screen.queryByText('conversation.creativeStudio.phase.produce.modelsTitle')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /render|generate/i })).not.toBeInTheDocument();
  });

  it('mounts the ready conversation surface', () => {
    briefConversationHarness.result.state = {
      kind: 'ready',
      conversation: {
        id: 'conversation_brief',
        name: 'Brief',
        type: 'aionrs',
        model: { id: 'provider_1', use_model: 'model_1' },
        created_at: 1,
        modified_at: 1,
        extra: { backend: 'aionrs', workspace: '' },
      },
    };

    render(<BriefPhase controller={controller()} />);

    expect(
      screen.getByRole('region', { name: 'conversation.creativeStudio.brief.conversationTitle' })
    ).toBeInTheDocument();
  });

  it('shows the dangling notice and Start fresh action', () => {
    briefConversationHarness.result.state = { kind: 'dangling', conversationId: 'conversation_deleted' };

    render(<BriefPhase controller={controller()} />);

    expect(screen.getByText('conversation.creativeStudio.brief.danglingNotice')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'conversation.creativeStudio.brief.danglingStartFresh' }));
    expect(briefConversationHarness.result.recreate).toHaveBeenCalledOnce();
  });

  it('blocks invalid fields next to their inputs without attempting persistence or navigation', () => {
    const draft = {
      name: '   ',
      brief: 'x'.repeat(16 * 1024 + 1),
      aspectRatio: '16:9' as const,
      targetDurationSeconds: 4,
    };
    const phaseEditor = editor({ projectDraft: draft, hasUnsavedProjectDraft: true, projectSaveState: 'dirty' });
    const props = controller({ editor: phaseEditor });
    render(<BriefPhase controller={props} />);

    expect(screen.getByText('conversation.creativeStudio.phase.brief.invalidName')).toBeInTheDocument();
    expect(screen.getByText('conversation.creativeStudio.errors.invalidPayload')).toBeInTheDocument();
    expect(screen.getByText('conversation.creativeStudio.create.invalidDuration')).toBeInTheDocument();

    const startWriting = screen.getByRole('button', {
      name: 'conversation.creativeStudio.phase.brief.startWriting',
    });
    expect(startWriting).toBeDisabled();
    fireEvent.click(startWriting);
    expect(phaseEditor.flushProjectDraft).not.toHaveBeenCalled();
    expect(props.requestTransition).not.toHaveBeenCalled();
  });

  it('saves the Brief before requesting Write and stays put when persistence fails', async () => {
    const phaseEditor = editor({
      projectDraft: { name: 'Launch film v2', brief: 'Updated', aspectRatio: '16:9', targetDurationSeconds: 15 },
      hasUnsavedProjectDraft: true,
      projectSaveState: 'dirty',
      flushProjectDraft: vi.fn(async () => true),
    });
    const props = controller({ editor: phaseEditor });
    const view = render(<BriefPhase controller={props} />);

    fireEvent.click(
      screen.getByRole('button', {
        name: 'conversation.creativeStudio.phase.brief.startWriting',
      })
    );
    await waitFor(() => expect(phaseEditor.flushProjectDraft).toHaveBeenCalledOnce());
    expect(props.requestTransition).toHaveBeenCalledWith({ phase: 'write' });

    const failedEditor = editor({
      projectDraft: { name: 'Launch film v3', brief: 'Updated', aspectRatio: '16:9', targetDurationSeconds: 15 },
      hasUnsavedProjectDraft: true,
      projectSaveState: 'failed',
      flushProjectDraft: vi.fn(async () => false),
    });
    const failedController = controller({ editor: failedEditor, requestTransition: vi.fn() });
    view.rerender(<BriefPhase controller={failedController} />);
    fireEvent.click(
      screen.getByRole('button', {
        name: 'conversation.creativeStudio.phase.brief.startWriting',
      })
    );
    await waitFor(() => expect(failedEditor.flushProjectDraft).toHaveBeenCalledOnce());
    expect(failedController.requestTransition).not.toHaveBeenCalled();
  });

  it('surfaces stale project recovery and blocks Write until retry resolves the conflict', async () => {
    const phaseEditor = editor({
      projectDraft: { name: 'Launch film v2', brief: 'Updated', aspectRatio: '16:9', targetDurationSeconds: 15 },
      hasUnsavedProjectDraft: true,
      projectSaveState: 'failed',
      conflict: {
        operation: 'update_project',
        code: 'stale_project',
        messageKey: 'conversation.creativeStudio.errors.staleProject',
      },
      flushProjectDraft: vi.fn(async () => true),
      retryConflict: vi.fn(async () => true),
    });
    const props = controller({ editor: phaseEditor });
    const view = render(<BriefPhase controller={props} />);

    expect(screen.getByRole('alert')).toHaveTextContent('conversation.creativeStudio.errors.staleProject');
    const startWriting = screen.getByRole('button', {
      name: 'conversation.creativeStudio.phase.brief.startWriting',
    });
    expect(startWriting).toBeDisabled();
    fireEvent.click(startWriting);
    expect(phaseEditor.flushProjectDraft).not.toHaveBeenCalled();
    expect(props.requestTransition).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'conversation.creativeStudio.storyboard.retry' }));
    await waitFor(() => expect(phaseEditor.retryConflict).toHaveBeenCalledOnce());
    expect(props.requestTransition).not.toHaveBeenCalled();

    const resolvedEditor = editor({ flushProjectDraft: vi.fn(async () => true) });
    view.rerender(
      <BriefPhase controller={controller({ editor: resolvedEditor, requestTransition: props.requestTransition })} />
    );
    fireEvent.click(startWriting);
    await waitFor(() => expect(resolvedEditor.flushProjectDraft).toHaveBeenCalledOnce());
    expect(props.requestTransition).toHaveBeenCalledExactlyOnceWith({ phase: 'write' });
  });

  it('discards a stale project conflict without navigating', () => {
    const phaseEditor = editor({
      projectSaveState: 'failed',
      conflict: {
        operation: 'update_project',
        code: 'stale_project',
        messageKey: 'conversation.creativeStudio.errors.staleProject',
      },
    });
    const props = controller({ editor: phaseEditor });
    render(<BriefPhase controller={props} />);

    fireEvent.click(screen.getByRole('button', { name: 'conversation.creativeStudio.storyboard.discard' }));

    expect(phaseEditor.discardConflict).toHaveBeenCalledOnce();
    expect(props.requestTransition).not.toHaveBeenCalled();
  });

  it('locks only the aspect selector when generated output exists and explains why', () => {
    const importedProject = project({ assets: { 'asset-1': generatedAsset('imports') } });
    const view = render(<BriefPhase controller={controller({ project: importedProject })} />);
    expect(
      screen.getByRole('combobox', { name: 'conversation.creativeStudio.phase.brief.aspectRatioLabel' })
    ).toBeEnabled();

    const lockedProject = project({ assets: { 'asset-1': generatedAsset('assets') } });
    view.rerender(<BriefPhase controller={controller({ project: lockedProject })} />);
    expect(
      screen.getByRole('combobox', { name: 'conversation.creativeStudio.phase.brief.aspectRatioLabel' })
    ).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText('conversation.creativeStudio.phase.brief.aspectLockedHelp')).toBeInTheDocument();
    expect(screen.getByLabelText('conversation.creativeStudio.phase.brief.nameLabel')).toBeEnabled();
  });

  it.each([
    ['saved', 'conversation.creativeStudio.phase.brief.saved'],
    ['dirty', 'conversation.creativeStudio.phase.brief.unsaved'],
    ['saving', 'conversation.creativeStudio.phase.brief.saving'],
    ['failed', 'conversation.creativeStudio.inspector.saveFailed'],
  ] as const)('announces the %s project draft state', (projectSaveState, message) => {
    render(<BriefPhase controller={controller({ editor: editor({ projectSaveState }) })} />);

    expect(screen.getByRole('status')).toHaveTextContent(message);
  });
});
