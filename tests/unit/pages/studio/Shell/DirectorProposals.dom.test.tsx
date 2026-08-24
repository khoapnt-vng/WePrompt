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
  type StudioProposalV2,
  type StudioReferenceRequestV2,
  type StudioRendererProjectV2,
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

const proposal = (id: string, status: StudioProposalV2['status'] = 'pending'): StudioProposalV2 =>
  ({
    schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
    id,
    projectId: 'project-1',
    status,
    baseRevision: 3,
    payload: { kind: 'mutation_batch', operations: [{ kind: 'set_brief', brief: 'A new brief' }] },
    createdAt: '2026-08-19T00:00:00.000Z',
    decidedAt: status === 'pending' ? null : '2026-08-19T01:00:00.000Z',
  }) as StudioProposalV2;

const pinRuleProposal = (id: string): StudioProposalV2 => ({
  ...proposal(id),
  payload: { kind: 'pin_rule', rule: { text: 'Never show a logo', predicate: null } },
});

const referenceRequest = (id: string): StudioReferenceRequestV2 => ({
  schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
  id,
  projectId: 'project-1',
  referenceIds: ['reference-1', 'reference-2'],
  status: 'pending',
  createdAt: '2026-08-19T00:00:00.000Z',
});

const handoff = (
  handoffId: string,
  status: StudioRendererReferenceGenerationHandoffV2['status'] = 'open'
): StudioRendererReferenceGenerationHandoffV2 => ({
  handoffId,
  requestId: `request-${handoffId}`,
  referenceIds: ['reference-1'],
  decidedAt: '2026-08-19T00:00:00.000Z',
  status,
  completedAt: status === 'open' ? null : '2026-08-19T01:00:00.000Z',
  progress: { queued: 0, running: 0, succeeded: status === 'confirmed' ? 1 : 0, failed: 0 },
  candidateAssetIds: status === 'confirmed' ? ['asset-reference-1'] : [],
  retryReferenceIds: [],
});

const project = {
  id: 'project-1',
  revision: 3,
  brief: 'Current brief',
  referenceOrder: ['reference-1'],
  references: {
    'reference-1': {
      id: 'reference-1',
      kind: 'character',
      label: 'Ming',
      prompt: 'Character sheet',
      candidateAssetId: 'asset-reference-1',
      candidateJobId: null,
      approvedAssetId: null,
      supersededAssetIds: [],
      createdAt: '2026-08-19T00:00:00.000Z',
      updatedAt: '2026-08-19T00:00:00.000Z',
    },
  },
  beatOrder: [],
  beats: {},
  shots: {},
  bin: [],
} as StudioRendererProjectV2;

describe('DirectorProposals', () => {
  const onAcceptProposal = vi.fn(async () => undefined);
  const onRejectProposal = vi.fn(async () => undefined);
  const onGenerateReferences = vi.fn(async () => undefined);
  const onRejectReferences = vi.fn(async () => undefined);
  const onReviewHandoff = vi.fn();
  const onReviewReferences = vi.fn();
  const onRetryFailedReferences = vi.fn();
  const onDismissHandoff = vi.fn(async () => undefined);

  beforeEach(() => {
    onAcceptProposal.mockClear();
    onRejectProposal.mockClear();
    onGenerateReferences.mockClear();
    onRejectReferences.mockClear();
    onReviewHandoff.mockClear();
    onReviewReferences.mockClear();
    onRetryFailedReferences.mockClear();
    onDismissHandoff.mockClear();
  });

  const renderList = (
    proposals: StudioProposalV2[] = [],
    referenceRequests: StudioReferenceRequestV2[] = [],
    referenceGenerationHandoffs: StudioRendererReferenceGenerationHandoffV2[] = [],
    locks: {
      gateLocked?: boolean;
      reviewBlockedMessageKey?: string | null;
      blockMutationProposalAcceptance?: boolean;
    } = {}
  ) =>
    render(
      <DirectorProposals
        project={project}
        proposals={proposals}
        referenceRequests={referenceRequests}
        referenceGenerationHandoffs={referenceGenerationHandoffs}
        pendingActionId={null}
        onAcceptProposal={onAcceptProposal}
        onRejectProposal={onRejectProposal}
        onGenerateReferences={onGenerateReferences}
        onRejectReferences={onRejectReferences}
        onReviewHandoff={onReviewHandoff}
        onReviewReferences={onReviewReferences}
        onRetryFailedReferences={onRetryFailedReferences}
        onDismissHandoff={onDismissHandoff}
        {...locks}
      />
    );

  it('renders only pending schema-2 proposals', () => {
    renderList([proposal('pending'), proposal('accepted', 'accepted'), proposal('rejected', 'rejected')]);

    expect(screen.getByTestId('studio-proposal-pending')).toBeInTheDocument();
    expect(screen.queryByTestId('studio-proposal-accepted')).not.toBeInTheDocument();
    expect(screen.queryByTestId('studio-proposal-rejected')).not.toBeInTheDocument();
  });

  it('keeps reference generation behind an explicit reviewed decision', async () => {
    renderList([], [referenceRequest('reference-1')]);

    fireEvent.click(screen.getByRole('button', { name: 'conversation.creativeStudio.workspace.references.generate' }));
    fireEvent.click(screen.getByRole('button', { name: 'conversation.creativeStudio.workspace.references.reject' }));

    await waitFor(() => {
      expect(onGenerateReferences).toHaveBeenCalledWith('reference-1');
      expect(onRejectReferences).toHaveBeenCalledWith('reference-1');
    });
  });

  it('deduplicates persistent handoffs and exposes only explicit review/dismiss actions while open', async () => {
    renderList([], [], [handoff('handoff-1'), handoff('handoff-1'), handoff('dismissed', 'dismissed')]);

    expect(screen.getAllByTestId('studio-handoff-handoff-1')).toHaveLength(1);
    expect(screen.getByTestId('studio-handoff-dismissed')).toBeInTheDocument();
    const open = within(screen.getByTestId('studio-handoff-handoff-1'));
    fireEvent.click(open.getByRole('button', { name: 'conversation.creativeStudio.workspace.handoffs.review' }));
    fireEvent.click(open.getByRole('button', { name: 'conversation.creativeStudio.workspace.handoffs.dismiss' }));
    await waitFor(() => {
      expect(onReviewHandoff).toHaveBeenCalledWith(expect.objectContaining({ handoffId: 'handoff-1' }));
      expect(onDismissHandoff).toHaveBeenCalledWith(expect.objectContaining({ handoffId: 'handoff-1' }));
    });
  });

  it('keeps a confirmed handoff actionable with durable progress and exact result thumbnails', () => {
    const { container } = renderList([proposal('accepted', 'accepted')], [], [handoff('confirmed', 'confirmed')]);

    expect(container).not.toBeEmptyDOMElement();
    const card = within(screen.getByTestId('studio-handoff-confirmed'));
    expect(card.getByText(/workspace\.handoffs\.progress/)).toBeVisible();
    expect(
      card.getByRole('button', { name: 'conversation.creativeStudio.workspace.handoffs.reviewReferences' })
    ).toBeEnabled();
    expect(card.getByRole('img', { name: /Ming/ })).toBeVisible();
  });

  it('retries only the failed identities carried by a partial handoff', () => {
    const partial = {
      ...handoff('partial', 'confirmed'),
      progress: { queued: 0, running: 0, succeeded: 0, failed: 1 },
      retryReferenceIds: ['reference-1'],
    };
    renderList([], [], [partial]);

    fireEvent.click(screen.getByRole('button', { name: 'conversation.creativeStudio.workspace.handoffs.retryFailed' }));
    expect(onRetryFailedReferences).toHaveBeenCalledWith(partial);
  });

  it('blocks dirty-generation review with guidance while leaving free dismissal available', () => {
    renderList([], [], [handoff('handoff-1')], {
      reviewBlockedMessageKey: 'conversation.creativeStudio.workspace.controls.saveBeforeReview',
    });

    const card = within(screen.getByTestId('studio-handoff-handoff-1'));
    expect(card.getByRole('button', { name: 'conversation.creativeStudio.workspace.handoffs.review' })).toBeDisabled();
    expect(card.getByRole('button', { name: 'conversation.creativeStudio.workspace.handoffs.dismiss' })).toBeEnabled();
    expect(card.getByText('conversation.creativeStudio.workspace.controls.saveBeforeReview')).toBeVisible();
  });

  it('blocks structural proposals for dirty row drafts without blocking an independent rule pin', async () => {
    renderList([proposal('mutation'), pinRuleProposal('rule')], [], [], {
      blockMutationProposalAcceptance: true,
    });

    const mutation = within(screen.getByTestId('studio-proposal-mutation'));
    expect(
      mutation.getByRole('button', { name: 'conversation.creativeStudio.workspace.proposals.accept' })
    ).toBeDisabled();
    expect(mutation.getByText('conversation.creativeStudio.workspace.proposals.saveBeforeApply')).toBeVisible();

    const rule = within(screen.getByTestId('studio-proposal-rule'));
    const acceptRule = rule.getByRole('button', {
      name: 'conversation.creativeStudio.workspace.proposals.accept',
    });
    expect(acceptRule).toBeEnabled();
    fireEvent.click(acceptRule);
    await waitFor(() => expect(onAcceptProposal).toHaveBeenCalledWith('rule'));
  });
});
