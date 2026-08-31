/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  STUDIO_PROJECT_SCHEMA_VERSION,
  STUDIO_PROPOSAL_SCHEMA_VERSION_V2,
  STUDIO_REFERENCE_REQUEST_SCHEMA_VERSION,
  type StudioReferenceRequestV2,
  type StudioRendererProjectV2,
  type StudioRendererProposalV2,
  type StudioRendererReferenceGenerationHandoffV2,
} from '@/common/types/project/creativeStudioTypes';
import { DirectorProposals } from '@renderer/pages/studio/components/Shell/DirectorProposals';

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

const timestamp = '2026-08-24T00:00:00.000Z';

const proposal = (
  id: string,
  status: StudioRendererProposalV2['status'] = 'pending',
  payload: StudioRendererProposalV2['payload'] = {
    kind: 'mutation_batch',
    operations: [{ kind: 'set_brief', brief: 'A new Brief' }],
  }
): StudioRendererProposalV2 => ({
  schemaVersion: STUDIO_PROPOSAL_SCHEMA_VERSION_V2,
  id,
  projectId: 'project_1',
  status,
  baseRevision: 3,
  payload,
  createdAt: timestamp,
  decidedAt: status === 'pending' ? null : '2026-08-24T01:00:00.000Z',
  review: {
    status: 'ready',
    groups: [
      {
        change: 'edited',
        subject: {
          kind: 'project',
          id: 'project_1',
          title: 'Reunion',
          position: null,
          ownerBeatId: null,
          ownerBeatTitle: null,
        },
        fields: [
          {
            key: payload.kind === 'pin_rule' ? 'rules' : 'brief',
            before: payload.kind === 'pin_rule' ? { kind: 'rule_list', values: [] } : { kind: 'text', value: 'Old' },
            after:
              payload.kind === 'pin_rule'
                ? { kind: 'rule_list', values: [{ text: payload.rule.text, forbiddenTerms: [] }] }
                : { kind: 'text', value: 'A new Brief' },
          },
        ],
      },
    ],
  },
});

const referenceRequest = (id: string): StudioReferenceRequestV2 => ({
  schemaVersion: STUDIO_REFERENCE_REQUEST_SCHEMA_VERSION,
  id,
  projectId: 'project_1',
  referenceIds: ['reference_ming', 'reference_mei'],
  status: 'pending',
  createdAt: timestamp,
});

const handoff = (
  handoffId: string,
  status: StudioRendererReferenceGenerationHandoffV2['status'] = 'awaiting_spend'
): StudioRendererReferenceGenerationHandoffV2 => ({
  handoffId,
  requestId: `request_${handoffId}`,
  referenceIds: ['reference_ming'],
  decidedAt: timestamp,
  status,
  completedAt:
    status === 'succeeded' || status === 'partially_failed' || status === 'failed' || status === 'dismissed'
      ? '2026-08-24T01:00:00.000Z'
      : null,
  counts: {
    queued: status === 'awaiting_spend' ? 1 : 0,
    running: status === 'running' ? 1 : 0,
    succeeded: status === 'succeeded' || status === 'partially_failed' ? 1 : 0,
    failed: status === 'failed' || status === 'partially_failed' ? 1 : 0,
  },
  resultAssetIds: status === 'succeeded' || status === 'partially_failed' ? ['asset_ming'] : [],
  failedReferenceIds: status === 'failed' || status === 'partially_failed' ? ['reference_ming'] : [],
});

const project = (): StudioRendererProjectV2 => ({
  schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
  revision: 3,
  id: 'project_1',
  name: 'Reunion',
  brief: 'Current Brief',
  rules: [],
  briefConversationId: null,
  referencePlanStatus: 'planned',
  referenceOrder: ['reference_ming'],
  references: {
    reference_ming: {
      id: 'reference_ming',
      kind: 'character',
      label: 'Ming',
      prompt: 'Ming reference prompt',
      approvedAssetId: 'asset_ming',
      supersededAssetIds: [],
      jobIds: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  },
  aspectRatio: '16:9',
  targetDurationSeconds: 30,
  resolution: '1080p',
  boardStyle: null,
  beatOrder: [],
  beats: {},
  shots: {},
  bin: [],
  bedAssetId: null,
  spendPolicy: null,
  imageRouteId: null,
  videoRouteId: null,
  assets: {},
  jobs: {},
  createdAt: timestamp,
  updatedAt: timestamp,
});

describe('DirectorProposals', () => {
  const onAcceptProposal = vi.fn(async () => undefined);
  const onRejectProposal = vi.fn(async () => undefined);
  const onRequestUpdatedProposal = vi.fn(async () => undefined);
  const onGenerateReferences = vi.fn(async () => undefined);
  const onRejectReferences = vi.fn(async () => undefined);
  const onReviewHandoff = vi.fn();
  const onReviewReferences = vi.fn();
  const onRetryFailedReferences = vi.fn();
  const onDismissHandoff = vi.fn(async () => undefined);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const renderList = (
    proposals: StudioRendererProposalV2[] = [],
    referenceRequests: StudioReferenceRequestV2[] = [],
    referenceGenerationHandoffs: StudioRendererReferenceGenerationHandoffV2[] = [],
    overrides: Partial<React.ComponentProps<typeof DirectorProposals>> = {}
  ) =>
    render(
      <DirectorProposals
        project={project()}
        proposals={proposals}
        referenceRequests={referenceRequests}
        referenceGenerationHandoffs={referenceGenerationHandoffs}
        pendingAction={null}
        onAcceptProposal={onAcceptProposal}
        onRejectProposal={onRejectProposal}
        onRequestUpdatedProposal={onRequestUpdatedProposal}
        onGenerateReferences={onGenerateReferences}
        onRejectReferences={onRejectReferences}
        onReviewHandoff={onReviewHandoff}
        onReviewReferences={onReviewReferences}
        onRetryFailedReferences={onRetryFailedReferences}
        onDismissHandoff={onDismissHandoff}
        {...overrides}
      />
    );

  it('renders only pending schema-5 proposals with their main-derived review', () => {
    renderList([proposal('pending'), proposal('accepted', 'accepted'), proposal('rejected', 'rejected')]);

    fireEvent.click(
      screen.getByRole('button', {
        name: 'conversation.creativeStudio.workspace.proposals.reviewDetails',
      })
    );
    expect(screen.getByTestId('studio-proposal-pending')).toHaveTextContent('A new Brief');
    expect(screen.queryByTestId('studio-proposal-accepted')).toBeNull();
    expect(screen.queryByTestId('studio-proposal-rejected')).toBeNull();
  });

  it('collapses only verified terminal proposals while keeping actionable and uncertain work visible', () => {
    const stale = {
      ...proposal('stale'),
      review: { status: 'stale' as const, groups: [], baseRevision: 3, currentRevision: 4 },
    };
    const refused = {
      ...proposal('refused'),
      review: {
        status: 'unavailable' as const,
        groups: [],
        reason: 'reducer_rejected' as const,
        refusal: null,
      },
    };
    const refreshing = proposal('refreshing');
    const unverified = proposal('unverified');
    renderList([proposal('ready'), stale, refused, refreshing, unverified], [], [], {
      proposalAuthorityState: (candidate) => {
        if (candidate.id === 'refreshing') return 'refreshing';
        if (candidate.id === 'unverified') return 'unavailable';
        return candidate.review.status;
      },
      proposalAuthorityVerified: (candidate) => candidate.id !== 'refreshing' && candidate.id !== 'unverified',
    });

    expect(screen.getByTestId('studio-proposal-ready')).toBeVisible();
    expect(screen.getByTestId('studio-proposal-refreshing')).toBeVisible();
    expect(screen.getByTestId('studio-proposal-unverified')).toBeVisible();
    expect(screen.queryByTestId('studio-proposal-stale')).toBeNull();
    expect(screen.queryByTestId('studio-proposal-refused')).toBeNull();
    expect(screen.getByTestId('studio-terminal-proposals')).toHaveTextContent(
      'conversation.creativeStudio.workspace.proposals.terminalCount(count=2)'
    );
    expect(
      screen.getByRole('button', { name: 'conversation.creativeStudio.workspace.proposals.showTerminal' })
    ).toHaveAttribute('aria-expanded', 'false');
  });

  it('keeps exact re-propose and reject actions available inside the terminal disclosure', async () => {
    const stale = {
      ...proposal('stale'),
      review: { status: 'stale' as const, groups: [], baseRevision: 3, currentRevision: 4 },
    };
    const refused = {
      ...proposal('refused'),
      review: {
        status: 'unavailable' as const,
        groups: [],
        reason: 'reducer_rejected' as const,
        refusal: null,
      },
    };
    renderList([stale, refused]);

    fireEvent.click(
      screen.getByRole('button', { name: 'conversation.creativeStudio.workspace.proposals.showTerminal' })
    );

    const staleCard = within(screen.getByTestId('studio-proposal-stale'));
    const refusedCard = within(screen.getByTestId('studio-proposal-refused'));
    expect(screen.getByTestId('studio-terminal-proposal-list')).toBeVisible();
    expect(staleCard.getByRole('alert')).toHaveTextContent('workspace.proposals.reviewStale');
    expect(refusedCard.getByRole('alert')).toHaveTextContent('workspace.proposals.reviewUnavailable');
    expect(staleCard.getByRole('button', { name: /workspace\.proposals\.accept/ })).toBeDisabled();
    expect(staleCard.getByRole('button', { name: /workspace\.proposals\.requestUpdated/ })).toHaveClass(
      'arco-btn-primary'
    );

    fireEvent.click(staleCard.getByRole('button', { name: /workspace\.proposals\.requestUpdated/ }));
    fireEvent.click(refusedCard.getByRole('button', { name: /workspace\.proposals\.reject/ }));
    await waitFor(() => {
      expect(onRequestUpdatedProposal).toHaveBeenCalledWith('stale', false);
      expect(onRejectProposal).toHaveBeenCalledWith('refused');
    });

    fireEvent.click(
      screen.getByRole('button', { name: 'conversation.creativeStudio.workspace.proposals.hideTerminal' })
    );
    expect(screen.queryByTestId('studio-terminal-proposal-list')).toBeNull();
    expect(screen.queryByTestId('studio-proposal-stale')).toBeNull();
  });

  it('keeps an in-flight terminal proposal visible and leaves disclosure review available while actions are locked', () => {
    const stale = {
      ...proposal('stale'),
      review: { status: 'stale' as const, groups: [], baseRevision: 3, currentRevision: 4 },
    };
    const sibling = {
      ...proposal('sibling'),
      review: { status: 'stale' as const, groups: [], baseRevision: 3, currentRevision: 4 },
    };
    const secondSibling = {
      ...proposal('second-sibling'),
      review: { status: 'stale' as const, groups: [], baseRevision: 3, currentRevision: 4 },
    };
    renderList([stale, sibling, secondSibling], [], [], {
      actionsLocked: true,
      pendingAction: { kind: 'proposal', id: 'stale' },
    });

    expect(screen.getByTestId('studio-proposal-stale')).toBeVisible();
    expect(screen.getByTestId('studio-terminal-proposals')).toHaveTextContent('terminalCount(count=2)');
    const show = screen.getByRole('button', {
      name: 'conversation.creativeStudio.workspace.proposals.showTerminal',
    });
    expect(show).toBeEnabled();
    fireEvent.click(show);
    const siblingCard = within(screen.getByTestId('studio-proposal-sibling'));
    expect(siblingCard.getByRole('button', { name: /workspace\.proposals\.reject/ })).toBeDisabled();
    expect(siblingCard.getByRole('button', { name: /workspace\.proposals\.requestUpdated/ })).toBeDisabled();
  });

  it('keeps semantic reference generation behind an explicit reviewed human decision', async () => {
    renderList([], [referenceRequest('request_references')]);

    expect(screen.getByText(/workspace\.references\.referenceCount/)).toHaveTextContent('total=2');
    fireEvent.click(screen.getByRole('button', { name: 'conversation.creativeStudio.workspace.references.generate' }));
    fireEvent.click(screen.getByRole('button', { name: 'conversation.creativeStudio.workspace.references.reject' }));
    await waitFor(() => {
      expect(onGenerateReferences).toHaveBeenCalledWith('request_references');
      expect(onRejectReferences).toHaveBeenCalledWith('request_references');
    });
  });

  it('deduplicates durable handoffs and exposes only explicit review/dismiss actions before spend', async () => {
    renderList([], [], [handoff('handoff_1'), handoff('handoff_1'), handoff('dismissed', 'dismissed')]);

    expect(screen.getAllByTestId('studio-handoff-handoff_1')).toHaveLength(1);
    const open = within(screen.getByTestId('studio-handoff-handoff_1'));
    fireEvent.click(open.getByRole('button', { name: 'conversation.creativeStudio.workspace.handoffs.review' }));
    fireEvent.click(open.getByRole('button', { name: 'conversation.creativeStudio.workspace.handoffs.dismiss' }));
    await waitFor(() => {
      expect(onReviewHandoff).toHaveBeenCalledWith(expect.objectContaining({ handoffId: 'handoff_1' }));
      expect(onDismissHandoff).toHaveBeenCalledWith(expect.objectContaining({ handoffId: 'handoff_1' }));
    });
  });

  it('shows durable progress and exact approved result thumbnails on success', () => {
    renderList([], [], [handoff('success', 'succeeded')]);

    const card = within(screen.getByTestId('studio-handoff-success'));
    expect(card.getByText(/workspace\.handoffs\.progress/)).toHaveTextContent('succeeded=1');
    expect(card.getByRole('img', { name: /Ming/ })).toHaveAttribute('src', expect.stringContaining('asset_ming'));
    fireEvent.click(
      card.getByRole('button', { name: 'conversation.creativeStudio.workspace.handoffs.reviewReferences' })
    );
    expect(onReviewReferences).toHaveBeenCalledWith(expect.objectContaining({ handoffId: 'success' }));
  });

  it('retries only the exact failed identities carried by a partial handoff', () => {
    const partial = handoff('partial', 'partially_failed');
    renderList([], [], [partial]);

    fireEvent.click(screen.getByRole('button', { name: 'conversation.creativeStudio.workspace.handoffs.retryFailed' }));
    expect(onRetryFailedReferences).toHaveBeenCalledWith(partial);
  });

  it('blocks dirty-generation review with guidance while leaving free dismissal available', () => {
    renderList([], [], [handoff('handoff_1')], {
      reviewBlockedMessageKey: 'conversation.creativeStudio.workspace.controls.saveBeforeReview',
    });

    const card = within(screen.getByTestId('studio-handoff-handoff_1'));
    expect(card.getByRole('button', { name: 'conversation.creativeStudio.workspace.handoffs.review' })).toBeDisabled();
    expect(card.getByRole('button', { name: 'conversation.creativeStudio.workspace.handoffs.dismiss' })).toBeEnabled();
    expect(card.getByText('conversation.creativeStudio.workspace.controls.saveBeforeReview')).toBeVisible();
  });

  it('blocks structural proposals for dirty drafts without blocking an independent rule pin', async () => {
    const pinRule = proposal('rule', 'pending', {
      kind: 'pin_rule',
      rule: { text: 'Keep brands fictional.', predicate: null },
    });
    renderList([proposal('mutation'), pinRule], [], [], {
      proposalDraftBlocker: (candidate) => (candidate.payload.kind === 'mutation_batch' ? 'workspace' : null),
    });

    const mutation = within(screen.getByTestId('studio-proposal-mutation'));
    expect(
      mutation.getByRole('button', { name: 'conversation.creativeStudio.workspace.proposals.accept' })
    ).toBeDisabled();
    const rule = within(screen.getByTestId('studio-proposal-rule'));
    fireEvent.click(rule.getByRole('button', { name: 'conversation.creativeStudio.workspace.proposals.accept' }));
    await waitFor(() => expect(onAcceptProposal).toHaveBeenCalledWith('rule'));
  });

  it('returns no surface without pending output or errors, and exposes channel-specific errors when present', () => {
    const { container, rerender } = renderList();
    expect(container).toBeEmptyDOMElement();

    rerender(
      <DirectorProposals
        project={project()}
        proposals={[]}
        referenceRequests={[]}
        referenceGenerationHandoffs={[]}
        pendingAction={null}
        proposalErrorMessageKey='proposal.error'
        referenceErrorMessageKey='reference.error'
        onAcceptProposal={onAcceptProposal}
        onRejectProposal={onRejectProposal}
        onGenerateReferences={onGenerateReferences}
        onRejectReferences={onRejectReferences}
        onReviewHandoff={onReviewHandoff}
        onReviewReferences={onReviewReferences}
        onRetryFailedReferences={onRetryFailedReferences}
        onDismissHandoff={onDismissHandoff}
      />
    );
    expect(screen.getAllByRole('alert').map((node) => node.textContent)).toEqual(['proposal.error', 'reference.error']);
  });
});
