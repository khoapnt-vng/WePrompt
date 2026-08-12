/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TContextHandoffItem } from '@/common/config/storage';
import type {
  StudioEditableScene,
  StudioProposal,
  StudioProposalStatus,
  StudioRendererProject,
} from '@/common/types/project/creativeStudioTypes';
import type { DirectorProposalCardProps } from '@renderer/pages/studio/components/Shell/DirectorProposalCard';
import type {
  StudioBriefConversation,
  UseBriefConversationResult,
} from '@renderer/pages/studio/components/PhaseShell/phases/brief/useBriefConversation';
import type { UseStoryboardEditorResult } from '@renderer/pages/studio/hooks/useStoryboardEditor';

const sendMessage = vi.fn(async () => ({}));

vi.mock('@/common', () => ({
  ipcBridge: { conversation: { sendMessage: { invoke: sendMessage } } },
}));

const harness: { result: UseBriefConversationResult } = {
  result: {
    state: { kind: 'absent' },
    errorMessageKey: null,
    sendFirstMessage: vi.fn(async () => {}),
    recreate: vi.fn(),
  },
};

vi.mock('@renderer/pages/studio/components/Shell/BriefConversationContext', () => ({
  useBriefConversationContext: () => harness.result,
}));

/**
 * The real card renders nothing for a resolved proposal, which would hide a broken pending filter
 * behind the card's own guard. This stub always renders, so what reaches it is what is asserted.
 */
vi.mock('@renderer/pages/studio/components/Shell/DirectorProposalCard', () => ({
  DirectorProposalCard: ({ proposal, onRepropose }: DirectorProposalCardProps) => (
    <div data-testid='proposal-card' data-proposal-id={proposal.id} data-proposal-status={proposal.status}>
      <button type='button' onClick={() => void onRepropose()}>
        repropose {proposal.id}
      </button>
    </div>
  ),
}));

const { DirectorProposals, pendingDirectorProposals } =
  await import('@renderer/pages/studio/components/Shell/DirectorProposals');

const editableScene = (): StudioEditableScene => ({
  title: 'Opening',
  purpose: 'Introduce',
  visualPrompt: 'A sunrise',
  narration: 'Old narration',
  onScreenText: '',
  mediaKind: 'image',
  durationSeconds: 10,
  referenceAssetId: null,
});

const project = (): StudioRendererProject => ({
  schemaVersion: 1,
  revision: 4,
  id: 'project-1',
  name: 'Launch film',
  brief: 'Launch it',
  aspectRatio: '16:9',
  targetDurationSeconds: 10,
  resolution: '1080p',
  sceneOrder: ['scene-1'],
  scenes: {
    'scene-1': {
      id: 'scene-1',
      ...editableScene(),
      selectedAssetId: null,
      assetIds: [],
      jobIds: [],
      reviewState: 'draft',
    },
  },
  assets: {},
  jobs: {},
  routing: { storyboard: null, image: null, video: null },
  createdAt: '2026-08-11T00:00:00.000Z',
  updatedAt: '2026-08-11T00:00:00.000Z',
});

const proposal = (id: string, status: StudioProposalStatus): StudioProposal => ({
  schemaVersion: 1,
  id,
  projectId: 'project-1',
  status,
  baseRevision: 4,
  payload: {
    kind: 'replace_storyboard',
    sceneOrder: ['proposed-1'],
    scenes: { 'proposed-1': editableScene() },
  },
  createdAt: '2026-08-11T01:00:00.000Z',
  decidedAt: status === 'pending' ? null : '2026-08-11T02:00:00.000Z',
});

const pinnedItem: TContextHandoffItem = {
  id: 'pin-1',
  title: 'Brand rules',
  content: 'Never show the logo upside down',
  source: 'manual',
  created_at: 1,
  updated_at: 1,
};

const conversation = (): StudioBriefConversation =>
  ({
    id: 'conversation_brief',
    name: 'Brief',
    type: 'aionrs',
    model: { id: 'provider_1', use_model: 'model_1' },
    created_at: 1,
    modified_at: 1,
    extra: { backend: 'aionrs', workspace: '', context_handoff: { pinned_context: [pinnedItem] } },
  }) as unknown as StudioBriefConversation;

const editor = (): Pick<UseStoryboardEditorResult, 'hasUnsavedSceneDrafts' | 'flushAllSceneDrafts'> => ({
  hasUnsavedSceneDrafts: false,
  flushAllSceneDrafts: vi.fn(async () => ({ failed: [], dirtied: [] })),
});

const renderProposals = (proposals: readonly StudioProposal[]): ReturnType<typeof render> =>
  render(
    <DirectorProposals
      project={project()}
      proposals={proposals}
      editor={editor()}
      acceptProposal={vi.fn()}
      rejectProposal={vi.fn()}
    />
  );

const renderedProposalIds = (): string[] =>
  screen.queryAllByTestId('proposal-card').map((card) => card.getAttribute('data-proposal-id') ?? '');

beforeEach(() => {
  sendMessage.mockClear();
  harness.result = {
    state: { kind: 'ready', conversation: conversation() },
    errorMessageKey: null,
    sendFirstMessage: vi.fn(async () => {}),
    recreate: vi.fn(),
  };
});

describe('pendingDirectorProposals', () => {
  /**
   * A proposal the user already answered is history, not an open question. Accepted ones were merged
   * into the script and rejected ones were dropped; re-offering either would invite a second decision
   * on a script that has already moved.
   */
  it('keeps only the proposals still awaiting an answer', () => {
    const kept = pendingDirectorProposals([
      proposal('accepted-1', 'accepted'),
      proposal('pending-1', 'pending'),
      proposal('rejected-1', 'rejected'),
      proposal('pending-2', 'pending'),
      proposal('expired-1', 'expired'),
    ]);

    expect(kept.map((entry) => entry.id)).toEqual(['pending-1', 'pending-2']);
  });

  it('returns nothing when every proposal has been answered', () => {
    expect(
      pendingDirectorProposals([
        proposal('accepted-1', 'accepted'),
        proposal('rejected-1', 'rejected'),
        proposal('expired-1', 'expired'),
      ])
    ).toEqual([]);
  });
});

describe('DirectorProposals', () => {
  it('renders one card per pending proposal, in the order they arrived', () => {
    renderProposals([proposal('pending-1', 'pending'), proposal('pending-2', 'pending')]);

    expect(renderedProposalIds()).toEqual(['pending-1', 'pending-2']);
  });

  /**
   * The pane pins this slot under the conversation with its own border, so anything rendered here is
   * a visible strip. An answered proposal must produce no node at all, not an empty card.
   */
  it('renders nothing when every proposal has already been answered', () => {
    const { container } = renderProposals([
      proposal('accepted-1', 'accepted'),
      proposal('rejected-1', 'rejected'),
      proposal('expired-1', 'expired'),
    ]);

    expect(renderedProposalIds()).toEqual([]);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when the project has no proposals at all', () => {
    const { container } = renderProposals([]);

    expect(container).toBeEmptyDOMElement();
  });

  it('drops the answered proposals and keeps the pending one', () => {
    renderProposals([
      proposal('accepted-1', 'accepted'),
      proposal('pending-1', 'pending'),
      proposal('rejected-1', 'rejected'),
    ]);

    expect(renderedProposalIds()).toEqual(['pending-1']);
  });

  /**
   * Re-proposing has to reach the Director's own thread — a bare retry against a fresh conversation
   * redrafts from memory instead of from the script that moved underneath it.
   */
  it('asks the Director to redraft against the current script, in the Director conversation', () => {
    renderProposals([proposal('pending-1', 'pending')]);

    fireEvent.click(screen.getByRole('button', { name: 'repropose pending-1' }));

    expect(sendMessage).toHaveBeenCalledOnce();
    const payload = sendMessage.mock.calls[0]?.[0] as {
      input: string;
      conversation_id: string;
      files: unknown[];
      pinned_context: TContextHandoffItem[];
    };
    expect(payload.conversation_id).toBe('conversation_brief');
    // Naming the tool is the load-bearing half: without it the Director redrafts from memory.
    expect(payload.input).toContain('read_storyboard');
    expect(payload.files).toEqual([]);
    // The brief's pinned context is what the Director was briefed with; a redraft without it drifts.
    expect(payload.pinned_context).toEqual([pinnedItem]);
  });

  it('stays silent when there is no Director conversation to ask', () => {
    harness.result = { ...harness.result, state: { kind: 'absent' } };

    renderProposals([proposal('pending-1', 'pending')]);

    fireEvent.click(screen.getByRole('button', { name: 'repropose pending-1' }));

    expect(sendMessage).not.toHaveBeenCalled();
  });
});
