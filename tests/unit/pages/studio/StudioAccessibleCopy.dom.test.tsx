/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { render, screen, within } from '@testing-library/react';
import i18next, { type i18n } from 'i18next';
import React from 'react';
import { I18nextProvider } from 'react-i18next';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import {
  STUDIO_PROJECT_SCHEMA_VERSION,
  type StudioProposalV2,
  type StudioReferenceRequestV2,
  type StudioRendererReferenceGenerationHandoffV2,
} from '@/common/types/project/creativeStudioTypes';
import { Composer } from '@renderer/pages/studio/components/Library/Composer';
import { DirectorProposals } from '@renderer/pages/studio/components/Shell/DirectorProposals';
import conversation from '@renderer/services/i18n/locales/en-US/conversation.json';

const proposal: StudioProposalV2 = {
  schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
  id: 'proposal-1',
  projectId: 'project-1',
  status: 'pending',
  baseRevision: 4,
  payload: { kind: 'mutation_batch', operations: [{ kind: 'set_brief', brief: 'A clearer brief' }] },
  createdAt: '2026-08-19T00:00:00.000Z',
  decidedAt: null,
};

const coverageProposal: StudioProposalV2 = {
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
            shotId: 'shot-new',
            line: 'The paper plane crosses frame.',
            narration: '',
            onScreenText: '',
            durationSeconds: 5,
            chainBreak: 'hard_cut',
          },
        ],
        fixedShots: [
          {
            shotId: 'shot-fixed',
            reasons: [
              'owned_asset',
              'owned_job',
              'selected_take',
              'seed_still',
              'conditioning_frame',
              'conditioning_input',
              'match_to',
              'narration',
              'on_screen_text',
            ],
          },
        ],
      },
      { kind: 'rederive_line', shotId: 'shot-detached', line: 'The reviewed replacement line.' },
    ],
  },
};

const referenceRequest: StudioReferenceRequestV2 = {
  schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
  id: 'reference-1',
  projectId: 'project-1',
  shotIds: ['shot-1'],
  status: 'pending',
  createdAt: '2026-08-19T00:00:00.000Z',
};

const handoff: StudioRendererReferenceGenerationHandoffV2 = {
  handoffId: 'handoff-1',
  requestId: 'reference-2',
  shotIds: ['shot-2'],
  decidedAt: '2026-08-19T00:00:00.000Z',
  status: 'open',
  completedAt: null,
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
        proposals={[proposal]}
        referenceRequests={[referenceRequest]}
        referenceGenerationHandoffs={[handoff]}
        pendingActionId={null}
        onAcceptProposal={vi.fn(async () => undefined)}
        onRejectProposal={vi.fn(async () => undefined)}
        onGenerateReferences={vi.fn(async () => undefined)}
        onRejectReferences={vi.fn(async () => undefined)}
        onReviewHandoff={vi.fn()}
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

  it('explains every fixed-coverage reason and the exact line replacement before Apply', () => {
    renderEnglish(
      <DirectorProposals
        proposals={[coverageProposal]}
        referenceRequests={[]}
        referenceGenerationHandoffs={[]}
        pendingActionId={null}
        onAcceptProposal={vi.fn(async () => undefined)}
        onRejectProposal={vi.fn(async () => undefined)}
        onGenerateReferences={vi.fn(async () => undefined)}
        onRejectReferences={vi.fn(async () => undefined)}
        onReviewHandoff={vi.fn()}
        onDismissHandoff={vi.fn(async () => undefined)}
      />
    );

    const review = screen.getByRole('status');
    expect(review).toHaveTextContent('Fixed Shot 1 · shot-fixed');
    expect(review).toHaveTextContent('It owns media.');
    expect(review).toHaveTextContent('It owns generation work.');
    expect(review).toHaveTextContent('It has a selected Take.');
    expect(review).toHaveTextContent('It has a pinned seed still.');
    expect(review).toHaveTextContent('It owns a continuity frame.');
    expect(review).toHaveTextContent('A generation request uses it as conditioning input.');
    expect(review).toHaveTextContent("It is the project's Match To reference.");
    expect(review).toHaveTextContent('It has authored narration.');
    expect(review).toHaveTextContent('It has authored on-screen text.');
    const rederivedShotId = screen.getByText('shot-detached', { selector: 'bdi' });
    expect(rederivedShotId).toBeVisible();
    expect(rederivedShotId.parentElement).toHaveTextContent('Shot shot-detached');
    const replacement = screen.getByText('The reviewed replacement line.');
    const apply = screen.getByRole('button', { name: 'Accept proposal' });
    expect(replacement.compareDocumentPosition(apply)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });
});
