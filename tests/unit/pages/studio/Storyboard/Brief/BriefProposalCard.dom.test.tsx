/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  StudioCommandResult,
  StudioProposal,
  StudioProposalAcceptance,
  StudioRendererProject,
} from '@/common/types/project/creativeStudioTypes';
import { BriefProposalCard } from '@renderer/pages/studio/components/PhaseShell/phases/brief/BriefProposalCard';
import type { UseStoryboardEditorResult } from '@renderer/pages/studio/hooks/useStoryboardEditor';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, number>) =>
      values ? `${key}:${values.added}/${values.removed}/${values.changed}` : key,
  }),
}));

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
      title: 'Opening',
      purpose: 'Introduce',
      visualPrompt: 'A sunrise',
      narration: 'Old narration',
      onScreenText: '',
      mediaKind: 'image',
      durationSeconds: 10,
      referenceAssetId: null,
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

const proposal = (): StudioProposal => ({
  schemaVersion: 1,
  id: 'proposal-1',
  projectId: 'project-1',
  status: 'pending',
  baseRevision: 4,
  payload: {
    kind: 'replace_storyboard',
    sceneOrder: ['scene-1', 'scene-2'],
    scenes: {
      'scene-1': {
        title: 'Opening',
        purpose: 'Introduce',
        visualPrompt: 'A sunrise',
        narration: 'New narration',
        onScreenText: '',
        mediaKind: 'image',
        durationSeconds: 10,
        referenceAssetId: null,
      },
      'scene-2': {
        title: 'Finale',
        purpose: 'Close',
        visualPrompt: 'Product hero',
        narration: '',
        onScreenText: 'Available now',
        mediaKind: 'image',
        durationSeconds: 5,
        referenceAssetId: null,
      },
    },
  },
  createdAt: '2026-08-11T01:00:00.000Z',
  decidedAt: null,
});

const success = <T,>(data: T): StudioCommandResult<T> => ({ ok: true, data });
const acceptResult = (): StudioProposalAcceptance => ({
  project: project(),
  proposal: { ...proposal(), status: 'accepted' },
});
const editor = (overrides: Partial<UseStoryboardEditorResult> = {}): UseStoryboardEditorResult =>
  ({
    hasUnsavedSceneDrafts: false,
    flushAllSceneDrafts: vi.fn(async () => ({ failed: [], dirtied: [] })),
    ...overrides,
  }) as UseStoryboardEditorResult;

describe('BriefProposalCard', () => {
  const acceptProposal = vi.fn(async () => success(acceptResult()));
  const rejectProposal = vi.fn(async () => success({ ...proposal(), status: 'rejected' as const }));
  const repropose = vi.fn(async () => {});

  beforeEach(() => {
    acceptProposal.mockClear();
    rejectProposal.mockClear();
    repropose.mockClear();
  });

  it('renders the change summary against the current script', () => {
    render(
      <BriefProposalCard
        project={project()}
        proposal={proposal()}
        editor={editor()}
        acceptProposal={acceptProposal}
        rejectProposal={rejectProposal}
        onRepropose={repropose}
      />
    );

    expect(screen.getByText('conversation.creativeStudio.brief.proposalSummary:1/0/1')).toBeInTheDocument();
    expect(screen.getByText('Opening')).toBeInTheDocument();
    expect(screen.getByText('Finale')).toBeInTheDocument();
  });

  it('accept invokes acceptProposal and announces success', async () => {
    render(
      <BriefProposalCard
        project={project()}
        proposal={proposal()}
        editor={editor()}
        acceptProposal={acceptProposal}
        rejectProposal={rejectProposal}
        onRepropose={repropose}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'conversation.creativeStudio.brief.proposalAccept' }));

    await waitFor(() =>
      expect(acceptProposal).toHaveBeenCalledWith({ projectId: 'project-1', proposalId: 'proposal-1' })
    );
    expect(screen.getByRole('status')).toHaveTextContent('conversation.creativeStudio.brief.proposalAccepted');
  });

  it('stale accept fails closed and offers re-propose', async () => {
    const staleAccept = vi.fn(
      async (): Promise<StudioCommandResult<StudioProposalAcceptance>> => ({
        ok: false,
        error: { code: 'stale_project', messageKey: 'conversation.creativeStudio.errors.staleProject' },
      })
    );
    const currentProject = project();
    render(
      <BriefProposalCard
        project={currentProject}
        proposal={proposal()}
        editor={editor()}
        acceptProposal={staleAccept}
        rejectProposal={rejectProposal}
        onRepropose={repropose}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'conversation.creativeStudio.brief.proposalAccept' }));

    expect(await screen.findByText('conversation.creativeStudio.brief.proposalStale')).toBeInTheDocument();
    expect(currentProject.revision).toBe(4);
    fireEvent.click(screen.getByRole('button', { name: 'conversation.creativeStudio.brief.proposalRepropose' }));
    expect(repropose).toHaveBeenCalledOnce();
  });

  it('reject invokes rejectProposal and reflects the rejected state', async () => {
    render(
      <BriefProposalCard
        project={project()}
        proposal={proposal()}
        editor={editor()}
        acceptProposal={acceptProposal}
        rejectProposal={rejectProposal}
        onRepropose={repropose}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'conversation.creativeStudio.brief.proposalReject' }));

    await waitFor(() =>
      expect(rejectProposal).toHaveBeenCalledWith({ projectId: 'project-1', proposalId: 'proposal-1' })
    );
    expect(screen.getByRole('status')).toHaveTextContent('conversation.creativeStudio.brief.proposalRejected');
  });

  it('flushes unsaved drafts first and refuses acceptance when the flush fails', async () => {
    const flushAllSceneDrafts = vi.fn(async () => ({ failed: ['scene-1'], dirtied: [] }));
    render(
      <BriefProposalCard
        project={project()}
        proposal={proposal()}
        editor={editor({ hasUnsavedSceneDrafts: true, flushAllSceneDrafts })}
        acceptProposal={acceptProposal}
        rejectProposal={rejectProposal}
        onRepropose={repropose}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'conversation.creativeStudio.brief.proposalAccept' }));

    expect(await screen.findByText('conversation.creativeStudio.brief.proposalFlushRefused')).toBeInTheDocument();
    expect(flushAllSceneDrafts).toHaveBeenCalledOnce();
    expect(acceptProposal).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'conversation.creativeStudio.brief.proposalAccept' })).toBeEnabled();
  });
});
