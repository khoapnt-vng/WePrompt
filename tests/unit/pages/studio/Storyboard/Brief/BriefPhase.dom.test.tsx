/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { StudioAsset, StudioProposal, StudioRendererProject } from '@/common/types/project/creativeStudioTypes';
import { BriefPhase } from '@renderer/pages/studio/components/PhaseShell/phases/brief';
import type { BriefPhaseController } from '@renderer/pages/studio/components/PhaseShell/types';
import type { UseStoryboardEditorResult } from '@renderer/pages/studio/hooks/useStoryboardEditor';

const briefConversationHarness = vi.hoisted(() => ({
  result: {
    state: { kind: 'absent' } as { kind: string; conversation?: unknown; conversationId?: string },
    errorMessageKey: null as string | null,
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

const proposal = (id: string, status: StudioProposal['status']): StudioProposal => ({
  schemaVersion: 1,
  id,
  projectId: 'project-1',
  status,
  baseRevision: 2,
  payload: { kind: 'replace_storyboard', sceneOrder: [], scenes: {} },
  createdAt: '2026-08-11T01:00:00.000Z',
  decidedAt: status === 'pending' ? null : '2026-08-11T02:00:00.000Z',
});

describe('BriefPhase', () => {
  beforeEach(() => {
    briefConversationHarness.result.state = { kind: 'absent' };
    briefConversationHarness.result.errorMessageKey = null;
    briefConversationHarness.result.recreate.mockClear();
  });

  /**
   * The brief text is Brief's work-panel content. It matters that it is here and not only in the
   * conversation: `invalidBrief` gates Start writing, so without an editor an over-long brief
   * disables the action with nothing on screen explaining why.
   */
  it('edits the brief text and flushes it on blur', () => {
    const props = controller();
    render(<BriefPhase controller={props} />);

    const brief = screen.getByLabelText('conversation.creativeStudio.project.brief');
    expect(brief).toHaveValue('A short launch story');

    fireEvent.change(brief, { target: { value: 'A sharper launch story' } });
    expect(props.editor.updateProjectDraft).toHaveBeenCalledWith({ brief: 'A sharper launch story' });

    fireEvent.blur(brief);
    expect(props.editor.flushProjectDraft).toHaveBeenCalled();
  });

  it('explains an over-long brief rather than only disabling the action', () => {
    const draft = {
      brief: 'x'.repeat(16 * 1024 + 1),
      aspectRatio: '16:9' as const,
      targetDurationSeconds: 15,
    };
    render(<BriefPhase controller={controller({ editor: editor({ projectDraft: draft }) })} />);

    expect(screen.getByRole('alert')).toHaveTextContent('conversation.creativeStudio.errors.invalidPayload');
    expect(screen.getByRole('button', { name: 'conversation.creativeStudio.phase.brief.startWriting' })).toBeDisabled();
  });

  it('renders the project constraints without a duplicate project-name control', () => {
    const props = controller();
    render(<BriefPhase controller={props} />);

    expect(screen.queryByLabelText('conversation.creativeStudio.phase.brief.nameLabel')).not.toBeInTheDocument();
    expect(
      screen.getByRole('spinbutton', { name: 'conversation.creativeStudio.phase.brief.durationLabel' })
    ).toHaveValue('15');
    expect(
      screen.getByRole('combobox', { name: 'conversation.creativeStudio.phase.brief.aspectRatioLabel' })
    ).toBeInTheDocument();

    fireEvent.change(
      screen.getByRole('spinbutton', { name: 'conversation.creativeStudio.phase.brief.durationLabel' }),
      { target: { value: '20' } }
    );

    expect(props.editor.updateProjectDraft).toHaveBeenCalledWith({ targetDurationSeconds: 20 });
    expect(screen.queryByText('conversation.creativeStudio.project.resolution')).not.toBeInTheDocument();
    expect(screen.queryByText('conversation.creativeStudio.phase.produce.modelsTitle')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /render|generate/i })).not.toBeInTheDocument();
  });

  /**
   * Proposals moved to the Director pane, which outlives the phase. Brief rendering them too would
   * double the card whenever Brief is the open phase, and — worse — a user who switched to Write
   * would lose a card they still owed an answer to.
   */
  it('does not render proposal cards, pending or otherwise', () => {
    render(
      <BriefPhase
        controller={controller({
          proposals: [
            proposal('pending', 'pending'),
            proposal('accepted', 'accepted'),
            proposal('rejected', 'rejected'),
            proposal('expired', 'expired'),
          ],
        })}
      />
    );

    expect(screen.queryByText('conversation.creativeStudio.brief.proposalTitle')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'conversation.creativeStudio.brief.proposalAccept' })
    ).not.toBeInTheDocument();
  });

  it('blocks invalid brief constraints without treating the header-owned name as a brief-panel error', () => {
    const draft = {
      name: '   ',
      brief: 'x'.repeat(16 * 1024 + 1),
      aspectRatio: '16:9' as const,
      targetDurationSeconds: 4,
    };
    const phaseEditor = editor({ projectDraft: draft, hasUnsavedProjectDraft: true, projectSaveState: 'dirty' });
    const props = controller({ editor: phaseEditor });
    render(<BriefPhase controller={props} />);

    expect(screen.queryByText('conversation.creativeStudio.phase.brief.invalidName')).not.toBeInTheDocument();
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
    expect(
      screen.getByRole('spinbutton', { name: 'conversation.creativeStudio.phase.brief.durationLabel' })
    ).toBeEnabled();
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

  it('leaves no stylesheet behind for the conversation rail it no longer renders', () => {
    const stylesheet = readFileSync(
      resolve(
        process.cwd(),
        'packages/desktop/src/renderer/pages/studio/components/PhaseShell/phases/brief/BriefPhase.module.css'
      ),
      'utf8'
    );

    // Guards the guard: a wrong path would make the assertion below pass on an empty string.
    expect(stylesheet).toMatch(/^\.constraintsRow\b/m);
    expect(stylesheet).not.toMatch(/^\.conversationSurface\b/m);
  });
});
