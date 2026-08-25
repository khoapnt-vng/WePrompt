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
  type StudioProposalReviewGroupV2,
  type StudioRendererProjectV2,
  type StudioRendererProposalV2,
} from '@/common/types/project/creativeStudioTypes';
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

const timestamp = '2026-08-24T00:00:00.000Z';

const project = (): StudioRendererProjectV2 => ({
  schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
  revision: 7,
  id: 'project_1',
  name: 'Night market film',
  brief: 'Ming and Mei reunite.',
  rules: [],
  briefConversationId: null,
  aspectRatio: '16:9',
  targetDurationSeconds: 30,
  resolution: '1080p',
  boardStyle: null,
  beatOrder: [],
  beats: {},
  shots: {},
  referencePlanStatus: 'unplanned',
  referenceOrder: [],
  references: {},
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

const reviewGroups = (): StudioProposalReviewGroupV2[] => [
  {
    change: 'edited',
    subject: {
      kind: 'project',
      id: 'project_1',
      title: 'Night market film',
      position: null,
      ownerBeatId: null,
      ownerBeatTitle: null,
    },
    fields: [
      {
        key: 'brief',
        before: { kind: 'text', value: 'Ming and Mei reunite.' },
        after: { kind: 'text', value: 'Ming and Mei reconcile over midnight tea.' },
      },
    ],
  },
  {
    change: 'added',
    subject: {
      kind: 'beat',
      id: 'beat_reunion',
      title: 'Reunion',
      position: 1,
      ownerBeatId: null,
      ownerBeatTitle: null,
    },
    fields: [
      { key: 'title', before: null, after: { kind: 'text', value: 'Reunion' } },
      {
        key: 'story',
        before: null,
        after: { kind: 'text', value: 'Ming finds Mei at their old dai pai dong.' },
      },
      {
        key: 'placement',
        before: null,
        after: {
          kind: 'placement',
          value: 'active',
          position: 1,
          ownerBeatId: null,
          ownerBeatTitle: null,
        },
      },
    ],
  },
  {
    change: 'added',
    subject: {
      kind: 'shot',
      id: 'shot_arrival',
      title: null,
      position: 1,
      ownerBeatId: 'beat_reunion',
      ownerBeatTitle: 'Reunion',
    },
    fields: [
      {
        key: 'shootingScript',
        before: null,
        after: {
          kind: 'text',
          value: 'Slow dolly in. Ming steps beneath the red awning; Mei looks up.',
        },
      },
      { key: 'durationSeconds', before: null, after: { kind: 'number', value: 5 } },
    ],
  },
];

const proposal = (
  review: StudioRendererProposalV2['review'] = { status: 'ready', groups: reviewGroups() }
): StudioRendererProposalV2 => ({
  schemaVersion: STUDIO_PROPOSAL_SCHEMA_VERSION_V2,
  id: 'proposal_1',
  projectId: 'project_1',
  status: 'pending',
  baseRevision: 7,
  payload: {
    kind: 'mutation_batch',
    operations: [
      { kind: 'set_brief', brief: 'Ming and Mei reconcile over midnight tea.' },
      {
        kind: 'add_beat',
        beatId: 'beat_reunion',
        beat: { title: 'Reunion', story: 'Ming finds Mei at their old dai pai dong.', targetSeconds: 10 },
        beforeBeatId: null,
      },
    ],
  },
  createdAt: timestamp,
  decidedAt: null,
  review,
});

describe('DirectorProposalCard semantic review', () => {
  const onAccept = vi.fn(async () => undefined);
  const onReject = vi.fn(async () => undefined);

  beforeEach(() => {
    onAccept.mockClear();
    onReject.mockClear();
  });

  const renderCard = (value = proposal(), overrides: Partial<React.ComponentProps<typeof DirectorProposalCard>> = {}) =>
    render(
      <DirectorProposalCard
        project={project()}
        proposal={value}
        pending={false}
        onAccept={onAccept}
        onReject={onReject}
        {...overrides}
      />
    );

  it('shows full main-derived Brief, Story, and Shooting script text with human subject/field labels', () => {
    renderCard();

    expect(screen.getByText('Ming and Mei reunite.')).toBeVisible();
    expect(screen.getByText('Ming and Mei reconcile over midnight tea.')).toBeVisible();
    expect(screen.getByText('Ming finds Mei at their old dai pai dong.')).toBeVisible();
    expect(screen.getByText('Slow dolly in. Ming steps beneath the red awning; Mei looks up.')).toBeVisible();
    expect(screen.getByText(/workspace\.proposals\.subject\.beat/)).toHaveTextContent('Reunion');
    expect(screen.getByText(/workspace\.proposals\.subject\.shot/)).toHaveTextContent('shot_arrival');
    expect(screen.getByText(/workspace\.proposals\.ownerBeat/)).toHaveTextContent('Reunion');
    expect(screen.getByText('conversation.creativeStudio.workspace.proposals.field.story')).toBeVisible();
    expect(screen.getByText('conversation.creativeStudio.workspace.proposals.field.shootingScript')).toBeVisible();
  });

  it('never substitutes raw mutation operation names for the semantic review', () => {
    const { container } = renderCard();

    expect(container).not.toHaveTextContent('set_brief');
    expect(container).not.toHaveTextContent('add_beat');
    expect(container).not.toHaveTextContent('mutation_batch');
    expect(container.querySelector('[data-proposal-change="added"]')).not.toBeNull();
  });

  it('renders exact before/after labels and authored empty values', () => {
    const groups = reviewGroups();
    groups[1]!.fields[1]!.after = { kind: 'text', value: '' };
    renderCard(proposal({ status: 'ready', groups }));

    expect(screen.getAllByText('conversation.creativeStudio.workspace.proposals.before').length).toBeGreaterThan(0);
    expect(screen.getAllByText('conversation.creativeStudio.workspace.proposals.after').length).toBeGreaterThan(0);
    expect(screen.getByText('conversation.creativeStudio.workspace.proposals.emptyAuthoredField')).toBeVisible();
  });

  it('shows forbidden terms in the exact pinned-rule review', () => {
    renderCard(
      proposal({
        status: 'ready',
        groups: [
          {
            change: 'edited',
            subject: {
              kind: 'project',
              id: 'project_1',
              title: 'Night market film',
              position: null,
              ownerBeatId: null,
              ownerBeatTitle: null,
            },
            fields: [
              {
                key: 'rules',
                before: { kind: 'rule_list', values: [] },
                after: {
                  kind: 'rule_list',
                  values: [{ text: 'Keep brands fictional.', forbiddenTerms: ['Acme', 'Globex'] }],
                },
              },
            ],
          },
        ],
      })
    );

    expect(screen.getByText('Keep brands fictional.')).toBeVisible();
    expect(screen.getByText(/conversation\.creativeStudio\.rules\.proposalTerms/)).toHaveTextContent('Acme, Globex');
  });

  it('disables Accept and explains a stale or reducer-rejected review while keeping Reject available', () => {
    const { rerender } = renderCard(proposal({ status: 'stale', groups: [], baseRevision: 7, currentRevision: 8 }));

    expect(screen.getByRole('alert')).toHaveTextContent('workspace.proposals.reviewStale');
    expect(
      screen.getByRole('button', { name: 'conversation.creativeStudio.workspace.proposals.accept' })
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'conversation.creativeStudio.workspace.proposals.reject' })
    ).toBeEnabled();

    rerender(
      <DirectorProposalCard
        project={project()}
        proposal={proposal({ status: 'unavailable', groups: [], reason: 'reducer_rejected' })}
        pending={false}
        onAccept={onAccept}
        onReject={onReject}
      />
    );
    expect(screen.getByRole('alert')).toHaveTextContent('workspace.proposals.reviewUnavailable');
    expect(
      screen.getByRole('button', { name: 'conversation.creativeStudio.workspace.proposals.accept' })
    ).toBeDisabled();
  });

  it('honors an independent dirty-draft acceptance blocker without hiding review text', () => {
    renderCard(proposal(), {
      acceptBlockedMessageKey: 'conversation.creativeStudio.workspace.proposals.saveBeforeApply',
    });

    expect(screen.getByText('Ming finds Mei at their old dai pai dong.')).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'conversation.creativeStudio.workspace.proposals.accept' })
    ).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('workspace.proposals.saveBeforeApply');
  });

  it('renders list and placement edge states, empty reviews, decision errors, and hides decided records', () => {
    const edgeGroups: StudioProposalReviewGroupV2[] = [
      {
        change: 'reordered',
        subject: {
          kind: 'shot',
          id: 'shot_edge',
          title: null,
          position: null,
          ownerBeatId: 'beat_edge',
          ownerBeatTitle: null,
        },
        fields: [
          {
            key: 'order',
            before: { kind: 'text_list', values: ['shot_before'] },
            after: { kind: 'text_list', values: [] },
          },
          {
            key: 'placement',
            before: {
              kind: 'placement',
              value: 'bin',
              position: null,
              ownerBeatId: 'beat_edge',
              ownerBeatTitle: null,
            },
            after: null,
          },
        ],
      },
    ];
    const { rerender } = renderCard(proposal({ status: 'ready', groups: edgeGroups }), {
      errorMessageKey: 'conversation.creativeStudio.workspace.errors.storage',
    });

    expect(screen.getByText('shot_before')).toBeVisible();
    expect(screen.getAllByText('conversation.creativeStudio.workspace.proposals.emptyAuthoredField')).toHaveLength(1);
    expect(screen.getAllByText(/beat_edge/).length).toBeGreaterThan(0);
    expect(screen.getByRole('alert')).toHaveTextContent('workspace.errors.storage');

    rerender(
      <DirectorProposalCard
        project={project()}
        proposal={proposal({ status: 'ready', groups: [] })}
        pending={false}
        onAccept={onAccept}
        onReject={onReject}
      />
    );
    expect(screen.getByText('conversation.creativeStudio.workspace.proposals.noChanges')).toBeVisible();

    rerender(
      <DirectorProposalCard
        project={project()}
        proposal={{ ...proposal(), status: 'accepted', decidedAt: timestamp }}
        pending={false}
        onAccept={onAccept}
        onReject={onReject}
      />
    );
    expect(screen.queryByTestId('studio-proposal-proposal_1')).not.toBeInTheDocument();
  });

  it('keeps Accept and Reject as the only deterministic decision actions', async () => {
    renderCard();
    const card = within(screen.getByTestId('studio-proposal-proposal_1'));

    fireEvent.click(card.getByRole('button', { name: 'conversation.creativeStudio.workspace.proposals.accept' }));
    fireEvent.click(card.getByRole('button', { name: 'conversation.creativeStudio.workspace.proposals.reject' }));
    await waitFor(() => {
      expect(onAccept).toHaveBeenCalledWith('proposal_1');
      expect(onReject).toHaveBeenCalledWith('proposal_1');
    });
  });
});
