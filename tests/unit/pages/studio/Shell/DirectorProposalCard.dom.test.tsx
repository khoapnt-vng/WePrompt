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

const reviewedCoverageProposal = (): StudioProposalV2 => ({
  ...mutationProposal(),
  payload: {
    kind: 'mutation_batch',
    operations: [
      {
        kind: 'apply_coverage',
        beatId: 'beat-review',
        shots: [
          {
            shotId: 'shot-proposed-b',
            line: 'Second authored line',
            narration: 'Second authored narration',
            onScreenText: 'SECOND CARD',
            durationSeconds: 6.5,
            chainBreak: 'hard_cut',
          },
          {
            shotId: 'shot-proposed-a',
            line: 'First authored line',
            narration: '',
            onScreenText: '',
            durationSeconds: 4,
            chainBreak: 'none',
          },
        ],
        fixedShots: [
          {
            shotId: 'shot-fixed-z',
            reasons: ['conditioning_frame', 'owned_asset', 'video_asset', 'owned_job', 'seed_still', 'owned_asset'],
          },
          {
            shotId: 'shot-fixed-a',
            reasons: ['on_screen_text', 'conditioning_input', 'narration'],
          },
        ],
      },
      {
        kind: 'rederive_line',
        shotId: 'shot-rederive',
        line: 'The exact replacement line.',
      },
      {
        kind: 'apply_coverage',
        beatId: 'beat-empty-fixed-review',
        shots: [],
        fixedShots: [],
      },
    ],
  },
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

  it('reviews every coverage operation and preserves proposed and fixed payload order', () => {
    render(
      <DirectorProposalCard
        proposal={reviewedCoverageProposal()}
        pending={false}
        onAccept={onAccept}
        onReject={onReject}
      />
    );

    const coverageTitles = [0, 2].map((index) =>
      screen.getByTestId(`studio-coverage-review-${index}`).querySelector('h3')
    );
    expect(coverageTitles.map((title) => title?.textContent)).toEqual([
      'conversation.creativeStudio.workspace.proposals.coverageReviewTitle beat-review',
      'conversation.creativeStudio.workspace.proposals.coverageReviewTitle beat-empty-fixed-review',
    ]);
    expect(coverageTitles.map((title) => title?.querySelector('bdi')?.textContent)).toEqual([
      'beat-review',
      'beat-empty-fixed-review',
    ]);

    const proposedItems = [0, 1].map((index) =>
      screen.getByTestId(`studio-proposed-shot-0-${index}`).querySelector('p')
    );
    expect(proposedItems.map((node) => node?.textContent)).toEqual([
      'conversation.creativeStudio.workspace.proposals.proposedShot(position=1) · shot-proposed-b',
      'conversation.creativeStudio.workspace.proposals.proposedShot(position=2) · shot-proposed-a',
    ]);
    expect(
      [0, 1].map((index) => screen.getByTestId(`studio-proposed-shot-0-${index}`).querySelector('bdi')?.textContent)
    ).toEqual(['shot-proposed-b', 'shot-proposed-a']);
    expect(screen.getByTestId('studio-proposed-shot-0-0').querySelectorAll('bdi').item(1).textContent).toBe(
      'conversation.creativeStudio.workspace.proposals.proposedDurationValue(seconds=6.5)'
    );
    expect(screen.getByTestId('studio-proposed-shot-0-1').querySelectorAll('bdi').item(1).textContent).toBe(
      'conversation.creativeStudio.workspace.proposals.proposedDurationValue(seconds=4)'
    );
    expect(
      [0, 1].map((index) => screen.getByTestId(`studio-proposed-shot-0-${index}`).querySelector('bdi')?.tagName)
    ).toEqual(['BDI', 'BDI']);
    expect(screen.getByText('Second authored line')).toBeInTheDocument();
    expect(screen.getByText('Second authored narration')).toBeInTheDocument();
    expect(screen.getByText('SECOND CARD')).toBeInTheDocument();
    expect(screen.getByText('conversation.creativeStudio.workspace.proposals.chainBreak.hard_cut')).toBeInTheDocument();
    expect(screen.getByText('conversation.creativeStudio.workspace.proposals.chainBreak.none')).toBeInTheDocument();
    expect(screen.getAllByText('conversation.creativeStudio.workspace.proposals.emptyAuthoredField')).toHaveLength(2);

    const fixedItems = [0, 1].map((index) => screen.getByTestId(`studio-fixed-shot-0-${index}`).querySelector('p'));
    expect(fixedItems.map((node) => node?.textContent)).toEqual([
      'conversation.creativeStudio.workspace.proposals.fixedShot(position=1) · shot-fixed-z',
      'conversation.creativeStudio.workspace.proposals.fixedShot(position=2) · shot-fixed-a',
    ]);
    expect(
      [0, 1].map((index) => screen.getByTestId(`studio-fixed-shot-0-${index}`).querySelector('bdi')?.textContent)
    ).toEqual(['shot-fixed-z', 'shot-fixed-a']);
    expect(
      Array.from(screen.getByTestId('studio-fixed-reasons-0-0').querySelectorAll('li'), (node) => node.textContent)
    ).toEqual([
      'conversation.creativeStudio.workspace.proposals.fixedReason.conditioning_frame',
      'conversation.creativeStudio.workspace.proposals.fixedReason.owned_asset',
      'conversation.creativeStudio.workspace.proposals.fixedReason.video_asset',
      'conversation.creativeStudio.workspace.proposals.fixedReason.owned_job',
      'conversation.creativeStudio.workspace.proposals.fixedReason.seed_still',
      'conversation.creativeStudio.workspace.proposals.fixedReason.owned_asset',
    ]);
    expect(
      Array.from(screen.getByTestId('studio-fixed-reasons-0-1').querySelectorAll('li'), (node) => node.textContent)
    ).toEqual([
      'conversation.creativeStudio.workspace.proposals.fixedReason.on_screen_text',
      'conversation.creativeStudio.workspace.proposals.fixedReason.conditioning_input',
      'conversation.creativeStudio.workspace.proposals.fixedReason.narration',
    ]);

    expect(screen.getByTestId('studio-fixed-review-0')).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByTestId('studio-fixed-review-2')).toHaveTextContent(
      'conversation.creativeStudio.workspace.proposals.noFixedShots'
    );
    const accept = screen.getByRole('button', { name: 'conversation.creativeStudio.workspace.proposals.accept' });
    const describedByIds = accept.getAttribute('aria-describedby')?.split(' ') ?? [];
    expect(describedByIds).toHaveLength(2);
    expect(describedByIds.map((id) => document.getElementById(id))).toEqual([
      screen.getByTestId('studio-fixed-review-0'),
      screen.getByTestId('studio-fixed-review-2'),
    ]);
    expect(screen.getByTestId('studio-fixed-review-0').compareDocumentPosition(accept)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    );
  });

  it('renders an exact rederived shot and replacement line before proposal actions', () => {
    render(
      <DirectorProposalCard
        proposal={reviewedCoverageProposal()}
        pending={false}
        onAccept={onAccept}
        onReject={onReject}
      />
    );

    const review = screen.getByTestId('studio-rederive-review-1');
    const shotId = review.querySelector('bdi');
    const line = screen.getByText('The exact replacement line.');
    const accept = screen.getByRole('button', { name: 'conversation.creativeStudio.workspace.proposals.accept' });
    expect(review).toHaveTextContent('conversation.creativeStudio.workspace.proposals.rederiveShot shot-rederive');
    expect(shotId).toHaveTextContent('shot-rederive');
    expect(line).toHaveAttribute('dir', 'auto');
    expect(line.compareDocumentPosition(accept)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
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

  it('keeps structural acceptance disabled while workspace drafts need saving', () => {
    render(
      <DirectorProposalCard
        acceptBlockedMessageKey='conversation.creativeStudio.workspace.proposals.saveBeforeApply'
        proposal={reviewedCoverageProposal()}
        pending={false}
        onAccept={onAccept}
        onReject={onReject}
      />
    );

    const accept = screen.getByRole('button', { name: 'conversation.creativeStudio.workspace.proposals.accept' });
    const blocker = screen.getByText('conversation.creativeStudio.workspace.proposals.saveBeforeApply');
    expect(accept).toBeDisabled();
    expect(blocker).toHaveAttribute('role', 'status');
    expect(blocker).toHaveTextContent('conversation.creativeStudio.workspace.proposals.saveBeforeApply');
    expect(accept.getAttribute('aria-describedby')?.split(' ')).toContain(blocker.id);
    fireEvent.click(accept);
    expect(onAccept).not.toHaveBeenCalled();
    expect(
      screen.getByRole('button', { name: 'conversation.creativeStudio.workspace.proposals.reject' })
    ).toBeEnabled();
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
