/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  STUDIO_PROJECT_SCHEMA_VERSION,
  type StudioMutationOperationV2,
  type StudioProposalV2,
  type StudioRendererProjectV2,
} from '@/common/types/project/creativeStudioTypes';
import { DirectorProposalCard } from '@renderer/pages/studio/components/Shell/DirectorProposalCard';
import { buildProposalReview } from '@renderer/pages/studio/components/Shell/DirectorProposalCard/proposalReview';

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
      { kind: 'edit_beat', beatId: 'beat_1', changes: { action: 'The courier plants the glowing seed.' } },
    ],
  },
  createdAt: '2026-08-19T00:00:00.000Z',
  decidedAt: null,
});

const mutationProposalWith = (operations: StudioMutationOperationV2[]): StudioProposalV2 => ({
  ...mutationProposal(),
  payload: { kind: 'mutation_batch', operations },
});

const project = (): StudioRendererProjectV2 => ({
  schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
  revision: 7,
  id: 'project-1',
  name: 'Launch film',
  brief: 'The original launch story',
  rules: [],
  briefConversationId: null,
  aspectRatio: '16:9',
  targetDurationSeconds: 30,
  resolution: '720p',
  boardStyle: null,
  beatOrder: ['beat_1'],
  beats: {
    beat_1: {
      id: 'beat_1',
      title: 'Opening street',
      action: 'The courier finds a glowing seed.',
      look: 'Warm illustrated sunrise.',
      actionRevision: 1,
      targetSeconds: 12,
      shotOrder: ['shot_1', 'shot-rederive'],
      lineHistory: [],
    },
  },
  shots: {
    shot_1: {
      id: 'shot_1',
      line: 'A seed glows in the road.',
      derivation: 'detached',
      derivedFromActionRevision: null,
      narration: '',
      onScreenText: '',
      durationSeconds: 4,
      trimInSeconds: null,
      trimOutSeconds: null,
      chainBreak: 'hard_cut',
      referenceIds: [],
      seedStillId: null,
      boardAssetId: null,
      supersededBoardAssetIds: [],
      videoAssetId: null,
      supersededVideoAssetIds: [],
      assetIds: [],
      jobIds: [],
    },
    'shot-rederive': {
      id: 'shot-rederive',
      line: 'The current derived line.',
      derivation: 'derived',
      derivedFromActionRevision: 1,
      narration: '',
      onScreenText: '',
      durationSeconds: 4,
      trimInSeconds: null,
      trimOutSeconds: null,
      chainBreak: 'none',
      referenceIds: [],
      seedStillId: null,
      boardAssetId: null,
      supersededBoardAssetIds: [],
      videoAssetId: null,
      supersededVideoAssetIds: [],
      assetIds: [],
      jobIds: [],
    },
  },
  referenceOrder: [],
  references: {},
  bin: [],
  bedAssetId: null,
  spendPolicy: null,
  imageRouteId: null,
  videoRouteId: null,
  assets: {},
  jobs: {},
  createdAt: '2026-08-19T00:00:00.000Z',
  updatedAt: '2026-08-19T00:00:00.000Z',
});

const coverageProject = (): StudioRendererProjectV2 => {
  const value = project();
  value.beatOrder.push('beat-review', 'beat-empty-fixed-review');
  value.beats['beat-review'] = {
    id: 'beat-review',
    title: 'Reviewed coverage',
    action: 'The reviewed coverage action.',
    look: 'Warm illustrated sunrise.',
    actionRevision: 1,
    targetSeconds: 12,
    shotOrder: ['shot-fixed-z', 'shot-fixed-a', 'shot-removed'],
    lineHistory: [],
  };
  value.beats['beat-empty-fixed-review'] = {
    id: 'beat-empty-fixed-review',
    title: 'Empty coverage',
    action: 'The empty coverage action.',
    look: 'Cool illustrated dusk.',
    actionRevision: 1,
    targetSeconds: 8,
    shotOrder: [],
    lineHistory: [],
  };
  value.shots['shot-fixed-z'] = {
    ...value.shots.shot_1!,
    id: 'shot-fixed-z',
    line: 'Fixed Z line.',
    narration: 'Fixed Z narration.',
    onScreenText: 'FIXED Z',
  };
  value.shots['shot-fixed-a'] = {
    ...value.shots.shot_1!,
    id: 'shot-fixed-a',
    line: 'Fixed A line.',
  };
  value.shots['shot-removed'] = {
    ...value.shots.shot_1!,
    id: 'shot-removed',
    line: 'Removed coverage line.',
  };
  return value;
};

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
            shotId: 'shot-fixed-z',
            line: 'Fixed Z line.',
            narration: 'Fixed Z narration.',
            onScreenText: 'FIXED Z',
            durationSeconds: 4,
            chainBreak: 'hard_cut',
          },
          {
            shotId: 'shot-fixed-a',
            line: 'First authored line',
            narration: 'First authored narration',
            onScreenText: 'FIRST CARD',
            durationSeconds: 6.5,
            chainBreak: 'hard_cut',
          },
          {
            shotId: 'shot-proposed-b',
            line: 'Second authored line',
            narration: 'Second authored narration',
            onScreenText: 'SECOND CARD',
            durationSeconds: 4,
            chainBreak: 'none',
          },
        ],
        fixedShots: [
          {
            shotId: 'shot-fixed-z',
            reasons: ['narration', 'on_screen_text'],
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

const catalogProject = (): StudioRendererProjectV2 => {
  const value = project();
  value.beatOrder.push('beat_coverage');
  value.beats.beat_coverage = {
    id: 'beat_coverage',
    title: 'Coverage beat',
    action: 'A clean coverage target.',
    look: 'Simple ink wash.',
    actionRevision: 1,
    targetSeconds: 8,
    shotOrder: [],
    lineHistory: [],
  };
  for (const beatId of ['beat_bin_a', 'beat_bin_b'] as const) {
    value.beats[beatId] = {
      id: beatId,
      title: beatId === 'beat_bin_a' ? 'Alternate A' : 'Alternate B',
      action: 'A parked alternate.',
      look: 'Pencil thumbnail.',
      actionRevision: 1,
      targetSeconds: 4,
      shotOrder: [],
      lineHistory: [],
    };
  }
  value.bin = [
    { kind: 'beat', beatId: 'beat_bin_a', reason: 'alternate' },
    { kind: 'beat', beatId: 'beat_bin_b', reason: 'alternate' },
  ];
  return value;
};

const directorOperationCatalog = (): StudioMutationOperationV2[] => [
  { kind: 'set_brief', brief: 'Catalog brief.' },
  {
    kind: 'add_beat',
    beatId: 'beat_new',
    beat: { title: 'New beat', action: 'Initial action.', look: 'Bright cel animation.', targetSeconds: 6 },
    beforeBeatId: 'beat_coverage',
  },
  {
    kind: 'edit_beat',
    beatId: 'beat_new',
    changes: { title: 'Edited new beat', action: 'Edited action.', look: 'Soft cel animation.', targetSeconds: 7 },
  },
  { kind: 'reorder_beats', beatOrder: ['beat_new', 'beat_1', 'beat_coverage'] },
  {
    kind: 'add_binned_beat',
    beatId: 'beat_bin_new',
    beat: { title: 'New alternate', action: 'Alternate action.', look: 'Loose pencil.', targetSeconds: 5 },
  },
  {
    kind: 'add_shot',
    beatId: 'beat_new',
    shotId: 'shot_new',
    shot: { line: 'Initial new line.', narration: '', onScreenText: '', durationSeconds: 4 },
    beforeShotId: null,
  },
  {
    kind: 'edit_shot',
    shotId: 'shot_new',
    changes: {
      line: 'Edited new line.',
      narration: 'Edited narration.',
      onScreenText: 'EDITED CARD',
      durationSeconds: 5,
    },
  },
  { kind: 'reorder_shots', beatId: 'beat_1', shotOrder: ['shot-rederive', 'shot_1'] },
  {
    kind: 'apply_coverage',
    beatId: 'beat_coverage',
    shots: [
      {
        shotId: 'shot_coverage',
        line: 'Coverage line.',
        narration: '',
        onScreenText: '',
        durationSeconds: 4,
        chainBreak: 'none',
      },
    ],
    fixedShots: [],
  },
  { kind: 'redetach_line', shotId: 'shot-rederive', line: 'Detached catalog line.' },
  { kind: 'rederive_line', shotId: 'shot-rederive', line: 'Rederived catalog line.' },
  {
    kind: 'set_project_references',
    references: [
      {
        id: 'reference_character',
        kind: 'character',
        label: 'Courier',
        prompt: 'Courier identity sheet.',
        shotIds: ['shot_new', 'shot-rederive'],
      },
      {
        id: 'reference_background',
        kind: 'background',
        label: 'Street',
        prompt: 'Recurring street background.',
        shotIds: ['shot_new'],
      },
    ],
  },
  { kind: 'delete_shot', shotId: 'shot_1' },
  {
    kind: 'reorder_bin',
    bin: [
      { kind: 'beat', beatId: 'beat_bin_b', reason: 'alternate' },
      { kind: 'beat', beatId: 'beat_bin_new', reason: 'alternate' },
      { kind: 'beat', beatId: 'beat_bin_a', reason: 'alternate' },
    ],
  },
];

const deniedOperations: readonly StudioMutationOperationV2[] = [
  { kind: 'edit_project', changes: { name: 'Unsafe' } },
  { kind: 'set_rules', rules: [] },
  { kind: 'park_beat', beatId: 'beat_1' },
  { kind: 'restore_beat', beatId: 'beat_1', beforeBeatId: null },
  { kind: 'park_shot', shotId: 'shot_1' },
  { kind: 'restore_shot', shotId: 'shot_1', beforeShotId: null },
  { kind: 'set_hard_cut', shotId: 'shot_1', hardCut: true },
  { kind: 'set_seed_still', shotId: 'shot_1', assetId: null },
  { kind: 'set_shot_background_reference', shotId: 'shot_1', referenceId: 'reference_background' },
  { kind: 'promote_board_panel', shotId: 'shot_1', boardAssetId: 'asset_1' },
  { kind: 'trim_shot', shotId: 'shot_1', trimInSeconds: null, trimOutSeconds: null },
  { kind: 'restore_line', shotId: 'shot_1', historyEntryId: 'history_1' },
  { kind: 'set_routes', imageRouteId: null, videoRouteId: null },
  { kind: 'set_spend_policy', policy: null },
  { kind: 'set_bed', assetId: null },
  { kind: 'undo_last', entryId: 'undo_1' },
];

describe('DirectorProposalCard', () => {
  const onAccept = vi.fn(async () => undefined);
  const onReject = vi.fn(async () => undefined);

  beforeEach(() => {
    onAccept.mockClear();
    onReject.mockClear();
  });

  it('renders the brief and authored Beat changes while keeping operation names in technical details', async () => {
    render(
      <DirectorProposalCard
        project={project()}
        proposal={mutationProposal()}
        pending={false}
        onAccept={onAccept}
        onReject={onReject}
      />
    );

    expect(screen.getByText(/workspace\.proposals\.revision\(revision=7\)/)).toBeInTheDocument();
    expect(screen.getByText(/workspace\.proposals\.mutationCount\(count=2\)/)).toBeInTheDocument();
    expect(screen.getByText('The original launch story')).toBeInTheDocument();
    expect(screen.getByText('A concise launch story')).toBeInTheDocument();
    expect(screen.getByText('The courier finds a glowing seed.')).toBeInTheDocument();
    expect(screen.getByText('The courier plants the glowing seed.')).toBeInTheDocument();
    expect(screen.queryByTestId('studio-proposal-technical-operations')).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', {
        name: 'conversation.creativeStudio.workspace.proposals.technicalDetails',
      })
    );
    const technical = await screen.findByTestId('studio-proposal-technical-operations');
    expect(technical).toHaveTextContent('set_brief');
    expect(technical).toHaveTextContent('edit_beat');
    expect(screen.getByTestId('studio-human-operation-review-0').querySelector('code')).toBeNull();
    expect(screen.getByTestId('studio-human-operation-review-1').querySelector('code')).toBeNull();
    expect(screen.queryByText(/proposalSceneChange|replace_storyboard/)).not.toBeInTheDocument();
  });

  it('reviews coverage as exact before/after order and retained, added, and removed Shot deltas', () => {
    render(
      <DirectorProposalCard
        project={coverageProject()}
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
      'conversation.creativeStudio.workspace.proposals.coverageReviewTitle · conversation.creativeStudio.workspace.bin.kind.beat 2 · Reviewed coverage · beat-review',
      'conversation.creativeStudio.workspace.proposals.coverageReviewTitle · conversation.creativeStudio.workspace.bin.kind.beat 3 · Empty coverage · beat-empty-fixed-review',
    ]);
    expect(coverageTitles.map((title) => title?.querySelector('bdi')?.textContent)).toEqual([
      'conversation.creativeStudio.workspace.bin.kind.beat 2 · Reviewed coverage · beat-review',
      'conversation.creativeStudio.workspace.bin.kind.beat 3 · Empty coverage · beat-empty-fixed-review',
    ]);

    const orderIds = Array.from(
      screen.getByTestId('studio-coverage-order-0').querySelectorAll('dd bdi'),
      (node) => node.textContent?.split(' · ')[1]
    );
    expect(orderIds).toEqual([
      'shot-fixed-z',
      'shot-fixed-a',
      'shot-removed',
      'shot-fixed-z',
      'shot-fixed-a',
      'shot-proposed-b',
    ]);

    const shotChanges = [0, 1, 2, 3].map((index) => screen.getByTestId(`studio-proposed-shot-0-${index}`));
    expect(shotChanges.map((item) => item.dataset.change)).toEqual(['retained', 'retained', 'added', 'removed']);
    expect(shotChanges.map((item) => item.querySelector('h4 bdi')?.textContent?.split(' · ')[1])).toEqual([
      'shot-fixed-z',
      'shot-fixed-a',
      'shot-proposed-b',
      'shot-removed',
    ]);
    expect(shotChanges[1]).toHaveTextContent('Fixed A line.');
    expect(shotChanges[1]).toHaveTextContent('First authored line');
    expect(shotChanges[1]).toHaveTextContent('First authored narration');
    expect(shotChanges[1]).toHaveTextContent('FIRST CARD');
    expect(shotChanges[1]).toHaveTextContent(
      'conversation.creativeStudio.workspace.proposals.proposedDurationValue(seconds=4)'
    );
    expect(shotChanges[1]).toHaveTextContent(
      'conversation.creativeStudio.workspace.proposals.proposedDurationValue(seconds=6.5)'
    );
    expect(shotChanges[1]).toHaveTextContent('conversation.creativeStudio.workspace.proposals.chainBreak.hard_cut');
    expect(shotChanges[2]).toHaveTextContent('Second authored line');
    expect(shotChanges[2]).toHaveTextContent('Second authored narration');
    expect(shotChanges[2]).toHaveTextContent('SECOND CARD');
    expect(shotChanges[2]).toHaveTextContent('conversation.creativeStudio.workspace.proposals.chainBreak.none');
    expect(shotChanges[3]).toHaveTextContent('Removed coverage line.');
    expect(shotChanges[3]).toHaveTextContent('conversation.creativeStudio.workspace.proposals.emptyAuthoredField');

    const fixedItem = screen.getByTestId('studio-fixed-shot-0-0');
    expect(fixedItem.querySelector('p')?.textContent).toBe(
      'conversation.creativeStudio.workspace.proposals.fixedShot(position=1) · shot-fixed-z'
    );
    expect(fixedItem.querySelector('bdi')?.textContent).toBe('shot-fixed-z');
    expect(
      Array.from(screen.getByTestId('studio-fixed-reasons-0-0').querySelectorAll('li'), (node) => node.textContent)
    ).toEqual([
      'conversation.creativeStudio.workspace.proposals.fixedReason.narration',
      'conversation.creativeStudio.workspace.proposals.fixedReason.on_screen_text',
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
        project={coverageProject()}
        proposal={reviewedCoverageProposal()}
        pending={false}
        onAccept={onAccept}
        onReject={onReject}
      />
    );

    const review = screen.getByTestId('studio-human-operation-review-1');
    const shotId = review.querySelector('h3 bdi');
    const beforeLine = screen.getByText('The current derived line.');
    const line = screen.getByText('The exact replacement line.');
    const accept = screen.getByRole('button', { name: 'conversation.creativeStudio.workspace.proposals.accept' });
    expect(review).toHaveTextContent('conversation.creativeStudio.workspace.controls.undoLabel.rederive_line');
    expect(shotId).toHaveTextContent('shot-rederive');
    expect(beforeLine).toBeVisible();
    expect(line.closest('bdi')).toHaveAttribute('dir', 'auto');
    expect(line.compareDocumentPosition(accept)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('reviews project references by type, prompt, and assigned Shot order', () => {
    render(
      <DirectorProposalCard
        project={project()}
        proposal={{
          ...mutationProposal(),
          payload: {
            kind: 'mutation_batch',
            operations: [
              {
                kind: 'set_project_references',
                references: [
                  {
                    id: 'reference_ming',
                    kind: 'character',
                    label: 'Ming',
                    prompt: 'A precise identity sheet for Ming in her red courier jacket.',
                    shotIds: ['shot_1', 'shot-rederive'],
                  },
                ],
              },
            ],
          },
        }}
        pending={false}
        onAccept={onAccept}
        onReject={onReject}
      />
    );

    const reference = screen.getByTestId('studio-proposed-project-reference-0');
    expect(reference).toHaveTextContent('Ming');
    expect(reference).toHaveTextContent('conversation.creativeStudio.brief.proposalField.title');
    expect(reference).not.toHaveTextContent('conversation.brief.proposalField.title');
    expect(reference).toHaveTextContent('conversation.creativeStudio.workspace.referenceWorkflow.characters.title');
    expect(reference).toHaveTextContent('A precise identity sheet for Ming in her red courier jacket.');
    const assigned = reference.querySelectorAll('ol li');
    expect(Array.from(assigned, (item) => item.textContent)).toEqual([
      expect.stringContaining('shot_1'),
      expect.stringContaining('shot-rederive'),
    ]);
  });

  it('shows project-reference order before and after a reorder-only proposal', () => {
    const value = project();
    value.referenceOrder = ['reference_ming', 'reference_mei'];
    value.references = {
      reference_ming: {
        id: 'reference_ming',
        kind: 'character',
        label: 'Ming',
        prompt: 'Ming identity sheet.',
        candidateAssetId: null,
        candidateJobId: null,
        approvedAssetId: null,
        supersededAssetIds: [],
        createdAt: '2026-08-19T00:00:00.000Z',
        updatedAt: '2026-08-19T00:00:00.000Z',
      },
      reference_mei: {
        id: 'reference_mei',
        kind: 'character',
        label: 'Mei',
        prompt: 'Mei identity sheet.',
        candidateAssetId: null,
        candidateJobId: null,
        approvedAssetId: null,
        supersededAssetIds: [],
        createdAt: '2026-08-19T00:00:00.000Z',
        updatedAt: '2026-08-19T00:00:00.000Z',
      },
    };
    value.shots.shot_1!.referenceIds = ['reference_ming', 'reference_mei'];
    render(
      <DirectorProposalCard
        project={value}
        proposal={mutationProposalWith([
          {
            kind: 'set_project_references',
            references: [
              {
                id: 'reference_mei',
                kind: 'character',
                label: 'Mei',
                prompt: 'Mei identity sheet.',
                shotIds: ['shot_1'],
              },
              {
                id: 'reference_ming',
                kind: 'character',
                label: 'Ming',
                prompt: 'Ming identity sheet.',
                shotIds: ['shot_1'],
              },
            ],
          },
        ])}
        pending={false}
        onAccept={onAccept}
        onReject={onReject}
      />
    );

    expect(
      Array.from(screen.getByTestId('studio-reference-order-0').querySelectorAll('dd bdi'), (node) =>
        node.textContent?.split(' · ').at(-1)
      )
    ).toEqual(['reference_ming', 'reference_mei', 'reference_mei', 'reference_ming']);
  });

  it('renders all fourteen Director-capable operation kinds from one valid sequential catalog', () => {
    const operations = directorOperationCatalog();
    const review = buildProposalReview(catalogProject(), operations);
    expect(review?.map((item) => item.operationKind)).toEqual(operations.map((operation) => operation.kind));

    render(
      <DirectorProposalCard
        project={catalogProject()}
        proposal={mutationProposalWith(operations)}
        pending={false}
        onAccept={onAccept}
        onReject={onReject}
      />
    );

    const specialIndexes = new Map([
      [8, 'studio-coverage-review-8'],
      [11, 'studio-reference-operation-review-11'],
    ]);
    for (let index = 0; index < operations.length; index += 1) {
      expect(screen.getByTestId(specialIndexes.get(index) ?? `studio-human-operation-review-${index}`)).toBeVisible();
    }
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'conversation.creativeStudio.workspace.proposals.accept' })
    ).toBeEnabled();
    expect(screen.getAllByText('Edited new beat').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Edited new line.').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Detached catalog line.').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Rederived catalog line.').length).toBeGreaterThan(0);
  });

  it('fails closed for reducer-impossible coverage, reference, Bin, and identity-reuse transitions', () => {
    const coveragePayload = reviewedCoverageProposal().payload;
    if (coveragePayload.kind !== 'mutation_batch' || coveragePayload.operations[0]?.kind !== 'apply_coverage') {
      throw new Error('Invalid reviewed coverage fixture');
    }
    const validCoverage = coveragePayload.operations[0];
    expect(buildProposalReview(coverageProject(), [validCoverage])).not.toBeNull();

    const newHardCut: StudioMutationOperationV2 = {
      ...validCoverage,
      shots: validCoverage.shots.map((shot) =>
        shot.shotId === 'shot-proposed-b' ? { ...shot, chainBreak: 'hard_cut' as const } : shot
      ),
    };
    const fixedMismatch: StudioMutationOperationV2 = { ...validCoverage, fixedShots: [] };
    const duplicateBackgrounds: StudioMutationOperationV2 = {
      kind: 'set_project_references',
      references: [
        {
          id: 'background_a',
          kind: 'background',
          label: 'Street A',
          prompt: 'Street A background.',
          shotIds: ['shot_1'],
        },
        {
          id: 'background_b',
          kind: 'background',
          label: 'Street B',
          prompt: 'Street B background.',
          shotIds: ['shot_1'],
        },
      ],
    };
    const arbitraryBin: StudioMutationOperationV2 = {
      kind: 'reorder_bin',
      bin: [{ kind: 'beat', beatId: 'beat_1', reason: 'alternate' }],
    };
    const deleteThenReuse: StudioMutationOperationV2[] = [
      { kind: 'delete_shot', shotId: 'shot_1' },
      {
        kind: 'add_shot',
        beatId: 'beat_1',
        shotId: 'shot_1',
        shot: { line: 'Reused identity.', narration: '', onScreenText: '', durationSeconds: 4 },
        beforeShotId: null,
      },
    ];

    expect(buildProposalReview(coverageProject(), [newHardCut])).toBeNull();
    expect(buildProposalReview(coverageProject(), [fixedMismatch])).toBeNull();
    expect(buildProposalReview(project(), [duplicateBackgrounds])).toBeNull();
    expect(buildProposalReview(project(), [arbitraryBin])).toBeNull();
    expect(buildProposalReview(project(), deleteThenReuse)).toBeNull();
  });

  it('uses each prior operation as the before-value for a later edit in the same batch', () => {
    render(
      <DirectorProposalCard
        project={project()}
        proposal={{
          ...mutationProposal(),
          payload: {
            kind: 'mutation_batch',
            operations: [
              { kind: 'edit_beat', beatId: 'beat_1', changes: { action: 'First proposed action.' } },
              { kind: 'edit_beat', beatId: 'beat_1', changes: { action: 'Final proposed action.' } },
            ],
          },
        }}
        pending={false}
        onAccept={onAccept}
        onReject={onReject}
      />
    );

    const second = screen.getByTestId('studio-human-operation-review-1');
    expect(second).toHaveTextContent('First proposed action.');
    expect(second).toHaveTextContent('Final proposed action.');
    expect(second).not.toHaveTextContent('The courier finds a glowing seed.');
  });

  it('uses the first reorder as the before-order for a later reorder in the same batch', () => {
    const reorderedProject = project();
    reorderedProject.beatOrder = ['beat_1', 'beat_2'];
    reorderedProject.beats.beat_2 = {
      id: 'beat_2',
      title: 'Rooftop finish',
      action: 'The courier reaches the rooftop.',
      look: 'Cool illustrated dusk.',
      actionRevision: 1,
      targetSeconds: 8,
      shotOrder: [],
      lineHistory: [],
    };
    render(
      <DirectorProposalCard
        project={reorderedProject}
        proposal={{
          ...mutationProposal(),
          payload: {
            kind: 'mutation_batch',
            operations: [
              { kind: 'reorder_beats', beatOrder: ['beat_2', 'beat_1'] },
              { kind: 'reorder_beats', beatOrder: ['beat_1', 'beat_2'] },
            ],
          },
        }}
        pending={false}
        onAccept={onAccept}
        onReject={onReject}
      />
    );

    expect(
      Array.from(screen.getByTestId('studio-human-operation-review-1').querySelectorAll('dd bdi'), (node) =>
        node.textContent?.split(' · ').at(-1)
      )
    ).toEqual(['beat_2', 'beat_1', 'beat_1', 'beat_2']);
  });

  it.each(deniedOperations)('fails closed when denied $kind reaches the renderer', (operation) => {
    render(
      <DirectorProposalCard
        project={project()}
        proposal={mutationProposalWith([operation])}
        pending={false}
        onAccept={onAccept}
        onReject={onReject}
      />
    );

    expect(screen.getByRole('alert')).toHaveTextContent(
      'conversation.creativeStudio.workspace.proposals.reviewUnavailable'
    );
    expect(
      screen.getByRole('button', { name: 'conversation.creativeStudio.workspace.proposals.accept' })
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'conversation.creativeStudio.workspace.proposals.reject' })
    ).toBeEnabled();
  });

  it('fails closed when a reviewable operation names an unavailable entity', () => {
    render(
      <DirectorProposalCard
        project={project()}
        proposal={{
          ...mutationProposal(),
          payload: {
            kind: 'mutation_batch',
            operations: [{ kind: 'edit_beat', beatId: 'missing_beat', changes: { title: 'Unavailable' } }],
          },
        }}
        pending={false}
        onAccept={onAccept}
        onReject={onReject}
      />
    );

    expect(screen.getByRole('alert')).toHaveTextContent(
      'conversation.creativeStudio.workspace.proposals.reviewUnavailable'
    );
    expect(
      screen.getByRole('button', { name: 'conversation.creativeStudio.workspace.proposals.accept' })
    ).toBeDisabled();
  });

  it('shows a reviewed rule pin and every enforced forbidden term before acceptance', () => {
    render(
      <DirectorProposalCard
        project={project()}
        proposal={{
          ...mutationProposal(),
          payload: {
            kind: 'pin_rule',
            rule: {
              text: 'Keep every product unbranded.',
              predicate: { kind: 'forbidden_terms', terms: ['Nike', 'Adidas'] },
            },
          },
        }}
        pending={false}
        onAccept={onAccept}
        onReject={onReject}
      />
    );

    expect(screen.getByText('conversation.creativeStudio.workspace.proposals.pinRule')).toBeInTheDocument();
    expect(screen.getByText('Keep every product unbranded.')).toBeInTheDocument();
    expect(screen.getByText('conversation.creativeStudio.rules.proposalTerms(terms=Nike, Adidas)')).toBeInTheDocument();
    expect(screen.queryByText('set_brief')).not.toBeInTheDocument();
  });

  it('forwards only the proposal id to explicit accept and reject actions', async () => {
    render(
      <DirectorProposalCard
        project={project()}
        proposal={mutationProposal()}
        pending={false}
        onAccept={onAccept}
        onReject={onReject}
      />
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
        project={coverageProject()}
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
        project={project()}
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
