/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { STUDIO_PROJECT_SCHEMA_VERSION, type StudioProposalV2 } from '@/common/types/project/creativeStudioTypes';
import { DirectorProposalCard } from '@renderer/pages/studio/components/Shell/DirectorProposalCard';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values
        ? `${key}(${Object.entries(values)
            .map(([name, value]) => `${name}=${String(value)}`)
            .join(',')})`
        : key,
  }),
}));

const mutationProposal = (): StudioProposalV2 => ({
  schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
  id: 'proposal-1',
  projectId: 'project-1',
  status: 'pending',
  baseRevision: 7,
  payload: {
    kind: 'mutation_batch',
    operations: [
      { kind: 'set_brief', brief: 'A concise launch story' },
      { kind: 'edit_project', changes: { name: 'Launch film' } },
    ],
  },
  createdAt: '2026-08-19T00:00:00.000Z',
  decidedAt: null,
});

describe('DirectorProposalCard', () => {
  const onAccept = vi.fn(async () => undefined);
  const onReject = vi.fn(async () => undefined);

  beforeEach(() => {
    onAccept.mockClear();
    onReject.mockClear();
  });

  it('renders a reviewed V2 mutation batch without any legacy scene diff', () => {
    render(
      <DirectorProposalCard proposal={mutationProposal()} pending={false} onAccept={onAccept} onReject={onReject} />
    );

    expect(screen.getByText(/workspace\.proposals\.revision\(revision=7\)/)).toBeInTheDocument();
    expect(screen.getByText(/workspace\.proposals\.mutationCount\(count=2\)/)).toBeInTheDocument();
    expect(screen.getByText('set_brief')).toBeInTheDocument();
    expect(screen.getByText('edit_project')).toBeInTheDocument();
    expect(screen.queryByText(/proposalSceneChange|replace_storyboard/)).not.toBeInTheDocument();
  });

  it('shows a reviewed rule pin as its bounded rule text', () => {
    render(
      <DirectorProposalCard
        proposal={{
          ...mutationProposal(),
          payload: {
            kind: 'pin_rule',
            rule: { text: 'Keep every product unbranded.', predicate: null },
          },
        }}
        pending={false}
        onAccept={onAccept}
        onReject={onReject}
      />
    );

    expect(screen.getByText('conversation.creativeStudio.workspace.proposals.pinRule')).toBeInTheDocument();
    expect(screen.getByText('Keep every product unbranded.')).toBeInTheDocument();
    expect(screen.queryByText('set_brief')).not.toBeInTheDocument();
  });

  it('forwards only the proposal id to explicit accept and reject actions', async () => {
    render(
      <DirectorProposalCard proposal={mutationProposal()} pending={false} onAccept={onAccept} onReject={onReject} />
    );

    fireEvent.click(screen.getByRole('button', { name: 'conversation.creativeStudio.workspace.proposals.accept' }));
    fireEvent.click(screen.getByRole('button', { name: 'conversation.creativeStudio.workspace.proposals.reject' }));

    await waitFor(() => {
      expect(onAccept).toHaveBeenCalledWith('proposal-1');
      expect(onReject).toHaveBeenCalledWith('proposal-1');
    });
  });

  it('renders no node for an already decided proposal', () => {
    const { container } = render(
      <DirectorProposalCard
        proposal={{
          ...mutationProposal(),
          status: 'accepted',
          decidedAt: '2026-08-19T01:00:00.000Z',
        }}
        pending={false}
        onAccept={onAccept}
        onReject={onReject}
      />
    );

    expect(container).toBeEmptyDOMElement();
  });
});
