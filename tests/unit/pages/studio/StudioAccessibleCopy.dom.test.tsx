/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { fireEvent, render, screen, within } from '@testing-library/react';
import i18next, { type i18n } from 'i18next';
import React from 'react';
import { I18nextProvider } from 'react-i18next';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import {
  STUDIO_PROJECT_SCHEMA_VERSION,
  STUDIO_PROPOSAL_SCHEMA_VERSION_V2,
  STUDIO_REFERENCE_REQUEST_SCHEMA_VERSION,
  type StudioReferenceRequestV2,
  type StudioRendererProjectV2,
  type StudioRendererProposalV2,
  type StudioRendererReferenceGenerationHandoffV2,
} from '@/common/types/project/creativeStudioTypes';
import { Composer } from '@renderer/pages/studio/components/Library/Composer';
import { DirectorProposals } from '@renderer/pages/studio/components/Shell/DirectorProposals';
import conversation from '@renderer/services/i18n/locales/en-US/conversation.json';

const proposal: StudioRendererProposalV2 = {
  schemaVersion: STUDIO_PROPOSAL_SCHEMA_VERSION_V2,
  id: 'proposal-1',
  projectId: 'project-1',
  status: 'pending',
  baseRevision: 4,
  payload: { kind: 'mutation_batch', operations: [{ kind: 'set_brief', brief: 'A clearer brief' }] },
  createdAt: '2026-08-19T00:00:00.000Z',
  decidedAt: null,
  review: {
    status: 'ready',
    groups: [
      {
        change: 'edited',
        subject: {
          kind: 'project',
          id: 'project-1',
          title: 'Accessible review project',
          position: null,
          ownerBeatId: null,
          ownerBeatTitle: null,
        },
        fields: [
          {
            key: 'brief',
            before: { kind: 'text', value: 'The current brief' },
            after: { kind: 'text', value: 'A clearer brief' },
          },
        ],
      },
    ],
  },
};

const coverageProposal: StudioRendererProposalV2 = {
  ...proposal,
  id: 'proposal-coverage',
  payload: {
    kind: 'mutation_batch',
    operations: [
      {
        kind: 'apply_coverage',
        beatId: 'beat-one',
        shots: [
          {
            shotId: 'shot-fixed',
            shootingScript: 'The fixed opening remains in frame.',
            durationSeconds: 5,
            chainBreak: 'none',
          },
          {
            shotId: 'shot-new',
            shootingScript: 'The paper plane crosses frame.',
            durationSeconds: 5,
            chainBreak: 'none',
          },
        ],
        fixedShots: [
          {
            shotId: 'shot-fixed',
            reasons: [
              'owned_asset',
              'owned_job',
              'video_asset',
              'seed_still',
              'conditioning_frame',
              'conditioning_input',
              'shooting_script',
            ],
          },
        ],
      },
    ],
  },
  review: {
    status: 'ready',
    groups: [
      {
        change: 'edited',
        subject: {
          kind: 'beat',
          id: 'beat-one',
          title: 'Opening',
          position: 1,
          ownerBeatId: null,
          ownerBeatTitle: null,
        },
        fields: [
          {
            key: 'story',
            before: { kind: 'text', value: 'The fixed opening leads into a paper plane.' },
            after: { kind: 'text', value: 'The fixed opening leads into a paper plane.' },
          },
        ],
      },
      {
        change: 'added',
        subject: {
          kind: 'shot',
          id: 'shot-new',
          title: null,
          position: 2,
          ownerBeatId: 'beat-one',
          ownerBeatTitle: 'Opening',
        },
        fields: [
          {
            key: 'shootingScript',
            before: null,
            after: { kind: 'text', value: 'The paper plane crosses frame.' },
          },
        ],
      },
    ],
  },
};

const referenceRequest: StudioReferenceRequestV2 = {
  schemaVersion: STUDIO_REFERENCE_REQUEST_SCHEMA_VERSION,
  id: 'reference-1',
  projectId: 'project-1',
  referenceIds: ['reference-1'],
  status: 'pending',
  createdAt: '2026-08-19T00:00:00.000Z',
};

const handoff: StudioRendererReferenceGenerationHandoffV2 = {
  handoffId: 'handoff-1',
  requestId: 'reference-2',
  referenceIds: ['reference-2'],
  decidedAt: '2026-08-19T00:00:00.000Z',
  status: 'awaiting_spend',
  counts: { queued: 1, running: 0, succeeded: 0, failed: 0 },
  resultAssetIds: [],
  failedReferenceIds: [],
  completedAt: null,
};

const project: StudioRendererProjectV2 = {
  schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
  revision: 4,
  id: 'project-1',
  name: 'Accessible review project',
  brief: 'The current brief',
  rules: [],
  briefConversationId: null,
  aspectRatio: '16:9',
  targetDurationSeconds: 30,
  resolution: '720p',
  boardStyle: null,
  beatOrder: ['beat-one', 'beat-two'],
  beats: {
    'beat-one': {
      id: 'beat-one',
      title: 'Opening',
      story: 'The fixed opening leads into a paper plane.',
      targetSeconds: 10,
      shotOrder: ['shot-fixed'],
    },
    'beat-two': {
      id: 'beat-two',
      title: 'Continuation',
      story: 'The story continues.',
      targetSeconds: 5,
      shotOrder: ['shot-detached'],
    },
  },
  shots: {
    'shot-fixed': {
      id: 'shot-fixed',
      shootingScript: 'The fixed opening remains in frame.',
      durationSeconds: 5,
      trimInSeconds: null,
      trimOutSeconds: null,
      chainBreak: 'none',
      referenceBinding: { status: 'unassigned', characterReferenceIds: [], backgroundReferenceId: null },
      seedStillId: 'asset-seed',
      boardAssetId: null,
      supersededBoardAssetIds: [],
      videoAssetId: 'asset-video',
      supersededVideoAssetIds: [],
      assetIds: ['asset-owned'],
      jobIds: ['job-owned'],
    },
    'shot-detached': {
      id: 'shot-detached',
      shootingScript: 'The second shot continues the action.',
      durationSeconds: 5,
      trimInSeconds: null,
      trimOutSeconds: null,
      chainBreak: 'none',
      referenceBinding: { status: 'unassigned', characterReferenceIds: [], backgroundReferenceId: null },
      seedStillId: null,
      boardAssetId: null,
      supersededBoardAssetIds: [],
      videoAssetId: null,
      supersededVideoAssetIds: [],
      assetIds: [],
      jobIds: [],
    },
  },
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
  createdAt: '2026-08-19T00:00:00.000Z',
  updatedAt: '2026-08-19T00:00:00.000Z',
};

describe('Creative Studio workspace accessible copy', () => {
  let i18n: i18n;

  beforeAll(async () => {
    i18n = i18next.createInstance();
    await i18n.init({
      lng: 'en-US',
      fallbackLng: false,
      resources: { 'en-US': { translation: { conversation } } },
      interpolation: { escapeValue: false },
    });
  });

  const renderEnglish = (node: React.ReactNode) => render(<I18nextProvider i18n={i18n}>{node}</I18nextProvider>);

  it('names the creation composer and its controls in English', () => {
    renderEnglish(
      <Composer creating={false} disabled={false} errorMessageKey={null} onSubmit={vi.fn(async () => undefined)} />
    );

    expect(screen.getByLabelText('What do you want to make?')).toBeVisible();
    expect(screen.getByLabelText('Aspect ratio')).toBeVisible();
    expect(screen.getByLabelText('Target duration')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Create project' })).toBeVisible();
  });

  it('names every reviewed decision and the explicit open-handoff actions', () => {
    renderEnglish(
      <DirectorProposals
        project={project}
        proposals={[proposal]}
        referenceRequests={[referenceRequest]}
        referenceGenerationHandoffs={[handoff]}
        pendingActionId={null}
        onAcceptProposal={vi.fn(async () => undefined)}
        onRejectProposal={vi.fn(async () => undefined)}
        onGenerateReferences={vi.fn(async () => undefined)}
        onRejectReferences={vi.fn(async () => undefined)}
        onReviewHandoff={vi.fn()}
        onReviewReferences={vi.fn()}
        onRetryFailedReferences={vi.fn()}
        onDismissHandoff={vi.fn(async () => undefined)}
      />
    );

    expect(screen.getByRole('region', { name: 'Reviewed Director output' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Accept proposal' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Reject proposal' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Review generation' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Reject request' })).toBeVisible();
    const handoffCard = within(screen.getByTestId('studio-handoff-handoff-1'));
    expect(handoffCard.getByRole('button', { name: 'Review cost' })).toBeEnabled();
    expect(handoffCard.getByRole('button', { name: 'Dismiss' })).toBeEnabled();
  });

  it('names semantic Story and Shooting Script changes before Apply', () => {
    renderEnglish(
      <DirectorProposals
        project={project}
        proposals={[coverageProposal]}
        referenceRequests={[]}
        referenceGenerationHandoffs={[]}
        pendingActionId={null}
        onAcceptProposal={vi.fn(async () => undefined)}
        onRejectProposal={vi.fn(async () => undefined)}
        onGenerateReferences={vi.fn(async () => undefined)}
        onRejectReferences={vi.fn(async () => undefined)}
        onReviewHandoff={vi.fn()}
        onReviewReferences={vi.fn()}
        onRetryFailedReferences={vi.fn()}
        onDismissHandoff={vi.fn(async () => undefined)}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Review proposal details' }));
    const review = screen.getByTestId('studio-proposal-semantic-review');
    expect(review).toHaveTextContent('Story');
    expect(review).toHaveTextContent('Shooting script');
    const replacement = screen.getByText('The paper plane crosses frame.');
    const apply = screen.getByRole('button', { name: 'Accept proposal' });
    expect(replacement.compareDocumentPosition(apply)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });
});
