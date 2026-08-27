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

const projectWithShot = (shootingScript = ''): StudioRendererProjectV2 => {
  const value = project();
  value.beatOrder = ['beat_1'];
  value.beats.beat_1 = {
    id: 'beat_1',
    title: 'Arrival',
    story: 'Ming arrives.',
    targetSeconds: null,
    shotOrder: ['shot_1'],
  };
  value.shots.shot_1 = {
    id: 'shot_1',
    shootingScript,
    durationSeconds: 4,
    trimInSeconds: null,
    trimOutSeconds: null,
    chainBreak: 'none',
    referenceBinding: { status: 'unassigned', characterReferenceIds: [], backgroundReferenceId: null },
    seedStillId: null,
    dismissedSeedStillIds: [],
    boardAssetId: null,
    supersededBoardAssetIds: [],
    videoAssetId: null,
    supersededVideoAssetIds: [],
    assetIds: [],
    jobIds: [],
  };
  return value;
};

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
  const onRequestUpdated = vi.fn(async () => undefined);
  const onReviewRuleDrafts = vi.fn();

  beforeEach(() => {
    onAccept.mockClear();
    onReject.mockClear();
    onRequestUpdated.mockClear();
    onReviewRuleDrafts.mockClear();
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

  const openReview = (): void => {
    fireEvent.click(
      screen.getByRole('button', { name: 'conversation.creativeStudio.workspace.proposals.reviewDetails' })
    );
  };

  it('leads with a bounded edit count and keeps the field review collapsed until requested', () => {
    renderCard();

    expect(screen.getByText('conversation.creativeStudio.workspace.proposals.mutationCount(count=3)')).toBeVisible();
    expect(screen.queryByTestId('studio-proposal-semantic-review')).not.toBeInTheDocument();

    openReview();
    expect(screen.getByTestId('studio-proposal-semantic-review')).toBeVisible();
  });

  it('renders the complete proposal ID as labelled, selectable code with bidirectional isolation', () => {
    renderCard();

    const id = screen.getByText('proposal_1');
    expect(screen.getByText('conversation.creativeStudio.workspace.proposals.proposalId')).toBeVisible();
    expect(id.tagName).toBe('BDI');
    expect(id).toHaveAttribute('dir', 'auto');
    expect(id.parentElement?.tagName).toBe('CODE');
    expect(screen.getByTestId('studio-proposal-proposal_1')).toHaveTextContent('proposal_1');
  });

  it('shows full main-derived Brief, Story, and Shooting script text with human subject/field labels', () => {
    renderCard();
    openReview();

    expect(screen.getByText('Ming and Mei reunite.')).toBeVisible();
    expect(screen.getByText('Ming and Mei reconcile over midnight tea.')).toBeVisible();
    expect(screen.getByText('Ming finds Mei at their old dai pai dong.')).toBeVisible();
    expect(screen.getByText('Slow dolly in. Ming steps beneath the red awning; Mei looks up.')).toBeVisible();
    expect(screen.getByText(/workspace\.proposals\.subject\.beat/)).toHaveTextContent('Reunion');
    expect(screen.getByText(/workspace\.proposals\.subject\.shot/)).not.toHaveTextContent('shot_arrival');
    expect(screen.getByText(/workspace\.proposals\.ownerBeat/)).toHaveTextContent('Reunion');
    expect(screen.getByText('conversation.creativeStudio.workspace.proposals.field.story')).toBeVisible();
    expect(screen.getByText('conversation.creativeStudio.workspace.proposals.field.shootingScript')).toBeVisible();
  });

  it('never substitutes raw mutation operation names for the semantic review', () => {
    const { container } = renderCard();
    openReview();

    expect(container).not.toHaveTextContent('set_brief');
    expect(container).not.toHaveTextContent('add_beat');
    expect(container).not.toHaveTextContent('mutation_batch');
    expect(container).not.toHaveTextContent('project_1');
    expect(container).not.toHaveTextContent('beat_reunion');
    expect(container).not.toHaveTextContent('shot_arrival');
    expect(container.querySelector('[data-proposal-subject-id="beat_reunion"]')).not.toBeNull();
    expect(container.querySelector('[data-proposal-change="added"]')).not.toBeNull();
  });

  it('reserves before/after labels for edits and renders additions as direct values', () => {
    const groups = reviewGroups();
    groups[1]!.fields[1]!.after = { kind: 'text', value: '' };
    renderCard(proposal({ status: 'ready', groups }));
    openReview();

    expect(screen.getAllByText('conversation.creativeStudio.workspace.proposals.before')).toHaveLength(1);
    expect(screen.getAllByText('conversation.creativeStudio.workspace.proposals.after')).toHaveLength(1);
    expect(screen.getByText('conversation.creativeStudio.workspace.proposals.emptyAuthoredField')).toBeVisible();
  });

  it('resolves reorder identifiers to the human titles already present in the review', () => {
    const groups = reviewGroups();
    groups.unshift({
      change: 'reordered',
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
          key: 'order',
          before: { kind: 'text_list', values: [] },
          after: { kind: 'text_list', values: ['beat_reunion'] },
        },
      ],
    });
    const { container } = renderCard(proposal({ status: 'ready', groups }));
    openReview();

    expect(container.querySelector('[data-review-value-id="beat_reunion"]')).toHaveTextContent('Reunion');
    expect(container).not.toHaveTextContent('beat_reunion');
    expect(container.querySelector('[data-review-value-id="beat_reunion"]')).not.toBeNull();
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
    openReview();

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
        proposal={proposal({ status: 'unavailable', groups: [], reason: 'reducer_rejected', refusal: null })}
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
    openReview();

    expect(screen.getByText('Ming finds Mei at their old dai pai dong.')).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'conversation.creativeStudio.workspace.proposals.accept' })
    ).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('workspace.proposals.saveBeforeApply');
  });

  it('renders exact refreshing, unavailable, and stale authority states without losing the card', async () => {
    const { rerender } = renderCard(proposal(), { authorityState: 'refreshing', onRequestUpdated });
    expect(screen.getByTestId('studio-proposal-proposal_1')).toHaveAttribute('data-proposal-state', 'refreshing');
    expect(screen.getByRole('status')).toHaveTextContent('workspace.proposals.refreshing');
    expect(
      screen.getByRole('button', { name: 'conversation.creativeStudio.workspace.proposals.accept' })
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'conversation.creativeStudio.workspace.proposals.reject' })
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'conversation.creativeStudio.workspace.proposals.requestUpdated' })
    ).toBeDisabled();

    rerender(
      <DirectorProposalCard
        project={project()}
        proposal={proposal()}
        pending={false}
        authorityState='unavailable'
        authorityVerified={false}
        onAccept={onAccept}
        onReject={onReject}
        onRequestUpdated={onRequestUpdated}
      />
    );
    expect(screen.getByTestId('studio-proposal-proposal_1')).toHaveAttribute('data-proposal-state', 'unavailable');
    expect(screen.getByRole('alert')).toHaveTextContent('workspace.proposals.authorityUnavailable');
    expect(
      screen.getByRole('button', { name: 'conversation.creativeStudio.workspace.proposals.reject' })
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'conversation.creativeStudio.workspace.proposals.requestUpdated' })
    ).toBeDisabled();

    rerender(
      <DirectorProposalCard
        project={project()}
        proposal={proposal({ status: 'unavailable', groups: [], reason: 'reducer_rejected', refusal: null })}
        pending={false}
        authorityState='unavailable'
        authorityVerified
        onAccept={onAccept}
        onReject={onReject}
        onRequestUpdated={onRequestUpdated}
      />
    );
    expect(screen.getByRole('alert')).toHaveTextContent('workspace.proposals.reviewUnavailable');
    expect(
      screen.getByRole('button', { name: 'conversation.creativeStudio.workspace.proposals.requestUpdated' })
    ).toBeEnabled();

    const stale = proposal({ status: 'stale', groups: [], baseRevision: 7, currentRevision: 8 });
    rerender(
      <DirectorProposalCard
        project={project()}
        proposal={stale}
        pending={false}
        authorityState='stale'
        onAccept={onAccept}
        onReject={onReject}
        onRequestUpdated={onRequestUpdated}
      />
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'conversation.creativeStudio.workspace.proposals.requestUpdated' })
    );
    await waitFor(() => expect(onRequestUpdated).toHaveBeenCalledWith('proposal_1', false));
    expect(
      screen.getByRole('button', { name: 'conversation.creativeStudio.workspace.proposals.reject' })
    ).toBeEnabled();
  });

  it('explains owned fixed work truthfully and offers bounded direct Shot editing without accepting', () => {
    const fixedProject = projectWithShot();
    fixedProject.shots.shot_1!.assetIds = ['asset_1'];
    const onEditShotsDirectly = vi.fn();
    renderCard(
      proposal({
        status: 'unavailable',
        groups: [],
        reason: 'reducer_rejected',
        refusal: {
          reasonCode: 'dependency_blocked',
          operationKind: 'apply_coverage',
          subjects: [
            {
              subject: {
                kind: 'shot',
                id: 'shot_1',
                title: null,
                position: 1,
                ownerBeatId: 'beat_1',
                ownerBeatTitle: 'Arrival',
              },
              fixedReasons: ['owned_asset'],
            },
          ],
        },
      }),
      { project: fixedProject, onEditShotsDirectly }
    );

    const alert = screen.getByRole('alert');
    expect(
      screen.getByText('conversation.creativeStudio.workspace.proposals.refusal.applyCoverageFixedWork')
    ).toBeVisible();
    expect(screen.queryByText('conversation.creativeStudio.workspace.proposals.refusal.applyCoverage')).toBeNull();
    expect(alert).toHaveTextContent('workspace.proposals.refusal.fixedReason.owned_asset');
    expect(alert).not.toHaveTextContent('shot_1');
    expect(
      screen.getByRole('button', { name: 'conversation.creativeStudio.workspace.proposals.accept' })
    ).toBeDisabled();

    fireEvent.click(
      screen.getByRole('button', {
        name: 'conversation.creativeStudio.workspace.proposals.refusal.editShotsDirectly',
      })
    );
    expect(onEditShotsDirectly).toHaveBeenCalledOnce();
    expect(onEditShotsDirectly).toHaveBeenCalledWith('beat_1', ['shot_1']);
    expect(onAccept).not.toHaveBeenCalled();
  });

  it('uses Shooting-script-specific coverage guidance when that is an exact fixed reason', () => {
    const fixedProject = projectWithShot('An existing authored Shot.');
    renderCard(
      proposal({
        status: 'unavailable',
        groups: [],
        reason: 'reducer_rejected',
        refusal: {
          reasonCode: 'dependency_blocked',
          operationKind: 'apply_coverage',
          subjects: [
            {
              subject: {
                kind: 'shot',
                id: 'shot_1',
                title: null,
                position: 1,
                ownerBeatId: 'beat_1',
                ownerBeatTitle: 'Arrival',
              },
              fixedReasons: ['shooting_script'],
            },
          ],
        },
      }),
      { project: fixedProject }
    );

    expect(screen.getByText('conversation.creativeStudio.workspace.proposals.refusal.applyCoverage')).toBeVisible();
    expect(
      screen.queryByText('conversation.creativeStudio.workspace.proposals.refusal.applyCoverageFixedWork')
    ).toBeNull();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'conversation.creativeStudio.workspace.proposals.refusal.fixedReason.shooting_script'
    );
  });

  it('scopes dirty-draft recovery to saving workspace edits or reviewing rule edits', async () => {
    const { rerender } = renderCard(proposal(), {
      draftBlocker: 'workspace',
      onRequestUpdated,
      onReviewRuleDrafts,
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'conversation.creativeStudio.workspace.proposals.saveAndRequestUpdated' })
    );
    await waitFor(() => expect(onRequestUpdated).toHaveBeenCalledWith('proposal_1', true));

    rerender(
      <DirectorProposalCard
        project={project()}
        proposal={{
          ...proposal(),
          payload: { kind: 'pin_rule', rule: { text: 'Keep brands fictional.', predicate: null } },
        }}
        pending={false}
        draftBlocker='rules'
        onAccept={onAccept}
        onReject={onReject}
        onRequestUpdated={onRequestUpdated}
        onReviewRuleDrafts={onReviewRuleDrafts}
      />
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'conversation.creativeStudio.workspace.proposals.reviewRuleDrafts' })
    );
    expect(onReviewRuleDrafts).toHaveBeenCalledOnce();
    expect(screen.getByRole('status')).toHaveTextContent('workspace.proposals.reviewRuleDraftsFirst');
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
    openReview();

    expect(screen.queryByText('shot_before')).not.toBeInTheDocument();
    expect(screen.getAllByText('conversation.creativeStudio.workspace.proposals.emptyAuthoredField')).toHaveLength(1);
    expect(screen.queryByText(/beat_edge/)).not.toBeInTheDocument();
    expect(document.querySelector('[data-owner-beat-id="beat_edge"]')).not.toBeNull();
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
