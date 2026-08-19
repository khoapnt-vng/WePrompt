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

const referenceRequest = (id: string): StudioReferenceRequestV2 => ({
  schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
  id,
  projectId: 'project-1',
  shotIds: ['shot-1', 'shot-2'],
  status: 'pending',
  createdAt: '2026-08-19T00:00:00.000Z',
});

const handoff = (
  handoffId: string,
  status: StudioRendererReferenceGenerationHandoffV2['status'] = 'open'
): StudioRendererReferenceGenerationHandoffV2 => ({
  handoffId,
  requestId: `request-${handoffId}`,
  shotIds: ['shot-1'],
  decidedAt: '2026-08-19T00:00:00.000Z',
  status,
  completedAt: status === 'open' ? null : '2026-08-19T01:00:00.000Z',
});

describe('DirectorProposals', () => {
  const onAcceptProposal = vi.fn(async () => undefined);
  const onRejectProposal = vi.fn(async () => undefined);
  const onGenerateReferences = vi.fn(async () => undefined);
  const onRejectReferences = vi.fn(async () => undefined);
  const onReviewHandoff = vi.fn();
  const onDismissHandoff = vi.fn(async () => undefined);

  beforeEach(() => {
    onAcceptProposal.mockClear();
    onRejectProposal.mockClear();
    onGenerateReferences.mockClear();
    onRejectReferences.mockClear();
    onReviewHandoff.mockClear();
    onDismissHandoff.mockClear();
  });

  const renderList = (
    proposals: StudioProposalV2[] = [],
    referenceRequests: StudioReferenceRequestV2[] = [],
    referenceGenerationHandoffs: StudioRendererReferenceGenerationHandoffV2[] = [],
    locks: { gateLocked?: boolean; reviewBlockedMessageKey?: string | null } = {}
  ) =>
    render(
      <DirectorProposals
        proposals={proposals}
        referenceRequests={referenceRequests}
        referenceGenerationHandoffs={referenceGenerationHandoffs}
        pendingActionId={null}
        onAcceptProposal={onAcceptProposal}
        onRejectProposal={onRejectProposal}
        onGenerateReferences={onGenerateReferences}
        onRejectReferences={onRejectReferences}
        onReviewHandoff={onReviewHandoff}
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

  it('keeps terminal handoff cards persistent without actions', () => {
    const { container } = renderList([proposal('accepted', 'accepted')], [], [handoff('confirmed', 'confirmed')]);

    expect(container).not.toBeEmptyDOMElement();
    expect(screen.getByText('conversation.creativeStudio.workspace.handoffs.confirmed')).toBeVisible();
    expect(within(screen.getByTestId('studio-handoff-confirmed')).queryByRole('button')).not.toBeInTheDocument();
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
});
