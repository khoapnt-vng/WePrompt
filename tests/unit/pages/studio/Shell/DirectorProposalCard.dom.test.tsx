/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  StudioCommandResult,
  StudioEditableScene,
  StudioProposal,
  StudioProposalAcceptance,
  StudioRendererProject,
} from '@/common/types/project/creativeStudioTypes';
import { DirectorProposalCard } from '@renderer/pages/studio/components/Shell/DirectorProposalCard';
import type { UseStoryboardEditorResult } from '@renderer/pages/studio/hooks/useStoryboardEditor';

const FIELD_SEPARATOR_KEY = 'conversation.creativeStudio.brief.proposalFieldSeparator';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    // The separator resolves to its real en-US value; every other key echoes so assertions read as keys.
    t: (key: string, values?: Record<string, unknown>) =>
      key === FIELD_SEPARATOR_KEY
        ? ', '
        : values
          ? `${key}(${Object.entries(values)
              .map(([name, value]) => `${name}=${String(value)}`)
              .join(',')})`
          : key,
  }),
}));

const summary = (added: number, removed: number, changed: number): string =>
  `conversation.creativeStudio.brief.proposalSummary(added=${added},removed=${removed},changed=${changed})`;

const sceneChange = (position: number, ...fields: string[]): string =>
  `conversation.creativeStudio.brief.proposalSceneChange(position=${position},fields=${fields
    .map((field) => `conversation.creativeStudio.brief.proposalField.${field}`)
    .join(', ')})`;

const editableScene = (overrides: Partial<StudioEditableScene> = {}): StudioEditableScene => ({
  title: 'Opening',
  purpose: 'Introduce',
  visualPrompt: 'A sunrise',
  narration: 'Old narration',
  onScreenText: '',
  mediaKind: 'image',
  durationSeconds: 10,
  referenceAssetId: null,
  ...overrides,
});

const project = (overrides: Partial<StudioRendererProject> = {}): StudioRendererProject => ({
  schemaVersion: 1,
  revision: 4,
  id: 'project-1',
  name: 'Launch film',
  brief: 'Launch it',
  rules: [],
  aspectRatio: '16:9',
  targetDurationSeconds: 10,
  resolution: '1080p',
  sceneOrder: ['scene-1'],
  scenes: {
    'scene-1': {
      id: 'scene-1',
      ...editableScene(),
      selectedAssetId: null,
      assetIds: [],
      jobIds: [],
      reviewState: 'draft',
    },
  },
  assets: {},
  jobs: {},
  routing: { storyboard: null, image: null, video: null },
  createdAt: '2026-08-11T00:00:00.000Z',
  updatedAt: '2026-08-11T00:00:00.000Z',
  ...overrides,
});

/**
 * `propose_storyboard` is a whole-script replace that mints fresh scene ids on every call, so a redraft
 * never shares an id with the script it redrafts. This fixture is that real shape, not a stable-id ideal.
 */
const proposal = (overrides: Partial<StudioProposal> = {}): StudioProposal => ({
  schemaVersion: 1,
  id: 'proposal-1',
  projectId: 'project-1',
  status: 'pending',
  baseRevision: 4,
  payload: {
    kind: 'replace_storyboard',
    sceneOrder: ['proposed-1'],
    scenes: { 'proposed-1': editableScene({ narration: 'New narration' }) },
  },
  createdAt: '2026-08-11T01:00:00.000Z',
  decidedAt: null,
  ...overrides,
});

const success = <T,>(data: T): StudioCommandResult<T> => ({ ok: true, data });
const acceptResult = (): StudioProposalAcceptance => ({
  project: project(),
  proposal: { ...proposal(), status: 'accepted' },
});
const editor = (overrides: Partial<UseStoryboardEditorResult> = {}): UseStoryboardEditorResult =>
  ({
    hasUnsavedSceneDrafts: false,
    flushAllSceneDrafts: vi.fn(async () => ({ failed: [], dirtied: [] })),
    ...overrides,
  }) as UseStoryboardEditorResult;

describe('DirectorProposalCard', () => {
  const acceptProposal = vi.fn(async () => success(acceptResult()));
  const rejectProposal = vi.fn(async () => success({ ...proposal(), status: 'rejected' as const }));
  const repropose = vi.fn(async () => {});

  const renderCard = (overrides: { project?: StudioRendererProject; proposal?: StudioProposal } = {}): void => {
    render(
      <DirectorProposalCard
        project={overrides.project ?? project()}
        proposal={overrides.proposal ?? proposal()}
        editor={editor()}
        acceptProposal={acceptProposal}
        rejectProposal={rejectProposal}
        onRepropose={repropose}
      />
    );
  };

  beforeEach(() => {
    acceptProposal.mockClear();
    rejectProposal.mockClear();
    repropose.mockClear();
  });

  it('shows a rule pin as the rule itself, with its enforced words, and no shot diff', () => {
    renderCard({
      proposal: proposal({
        payload: {
          kind: 'pin_rule',
          rule: { text: 'Keep the kits generic.', predicate: { kind: 'forbidden_terms', terms: ['acme', 'globex'] } },
        },
      }),
    });

    expect(screen.getByText('conversation.creativeStudio.rules.proposalTitle')).toBeInTheDocument();
    expect(screen.getByText('conversation.creativeStudio.rules.proposalBody')).toBeInTheDocument();
    expect(screen.getByText('Keep the kits generic.')).toBeInTheDocument();
    // `fieldSeparator` is the one key the mock resolves for real, so the joined terms read as ', '.
    expect(screen.getByText('conversation.creativeStudio.rules.proposalTerms(terms=acme, globex)')).toBeInTheDocument();
    // Nothing from the storyboard branch: no diff summary, no per-scene change list, no scene titles.
    expect(screen.queryByText(/proposalSummary/)).not.toBeInTheDocument();
    expect(screen.queryByText(/proposalSceneChange/)).not.toBeInTheDocument();
  });

  it('does not compute a shot diff for a rule pin, even at a stale revision', () => {
    renderCard({
      project: project({ revision: 9 }),
      proposal: proposal({
        baseRevision: 3,
        payload: { kind: 'pin_rule', rule: { text: 'Keep the kits generic.', predicate: null } },
      }),
    });

    // The storyboard branch would render proposalDiffUnavailable here, because revision 9 ≠ base 3.
    expect(screen.queryByText('conversation.creativeStudio.brief.proposalDiffUnavailable')).not.toBeInTheDocument();
    expect(screen.getByText('conversation.creativeStudio.rules.proposalTitle')).toBeInTheDocument();
  });

  it('accepts a rule pin without flushing unrelated scene drafts', async () => {
    const flushAllSceneDrafts = vi.fn(async () => ({ failed: ['scene-1'], dirtied: [] }));
    render(
      <DirectorProposalCard
        project={project()}
        proposal={proposal({
          payload: { kind: 'pin_rule', rule: { text: 'Keep the kits generic.', predicate: null } },
        })}
        editor={editor({ hasUnsavedSceneDrafts: true, flushAllSceneDrafts })}
        acceptProposal={acceptProposal}
        rejectProposal={rejectProposal}
        onRepropose={repropose}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'conversation.creativeStudio.brief.proposalAccept' }));

    await waitFor(() =>
      expect(acceptProposal).toHaveBeenCalledWith({ projectId: 'project-1', proposalId: 'proposal-1' })
    );
    expect(flushAllSceneDrafts).not.toHaveBeenCalled();
  });

  it('names the one field a same-length redraft rewrites instead of reporting a wholesale replacement', () => {
    renderCard();

    expect(screen.getByText(summary(0, 0, 1))).toBeInTheDocument();
    expect(screen.getByText(sceneChange(1, 'narration'))).toBeInTheDocument();
  });

  it('lists every rewritten field of a shot', () => {
    renderCard({
      proposal: proposal({
        payload: {
          kind: 'replace_storyboard',
          sceneOrder: ['proposed-1'],
          scenes: { 'proposed-1': editableScene({ title: 'Cold open', narration: 'New narration' }) },
        },
      }),
    });

    expect(screen.getByText(sceneChange(1, 'title', 'narration'))).toBeInTheDocument();
  });

  it('counts shots the proposal adds beyond the current script', () => {
    renderCard({
      proposal: proposal({
        payload: {
          kind: 'replace_storyboard',
          sceneOrder: ['proposed-1', 'proposed-2'],
          scenes: { 'proposed-1': editableScene(), 'proposed-2': editableScene({ title: 'Finale' }) },
        },
      }),
    });

    expect(screen.getByText(summary(1, 0, 0))).toBeInTheDocument();
    expect(screen.queryByText(/proposalSceneChange/)).not.toBeInTheDocument();
  });

  it('says so plainly when a proposal changes nothing at all', () => {
    renderCard({
      proposal: proposal({
        payload: {
          kind: 'replace_storyboard',
          sceneOrder: ['proposed-1'],
          scenes: { 'proposed-1': editableScene() },
        },
      }),
    });

    expect(screen.getByText('conversation.creativeStudio.brief.proposalNoChanges')).toBeInTheDocument();
    expect(screen.queryByText(/proposalSummary/)).not.toBeInTheDocument();
  });

  it('renders the diff main froze rather than recomputing one against the current script', () => {
    renderCard({
      // The script has moved on, so a recompute here would be a guess; main's frozen diff is the truth.
      project: project({ revision: 9 }),
      proposal: proposal({
        diff: { added: 0, removed: 0, changed: [{ position: 2, fields: ['onScreenText'] }] },
      }),
    });

    expect(screen.getByText(summary(0, 0, 1))).toBeInTheDocument();
    expect(screen.getByText(sceneChange(2, 'onScreenText'))).toBeInTheDocument();
  });

  it('admits the summary is unknowable for a legacy proposal the script has already outrun', () => {
    renderCard({ project: project({ revision: 9 }), proposal: proposal() });

    expect(screen.getByText('conversation.creativeStudio.brief.proposalDiffUnavailable')).toBeInTheDocument();
    expect(screen.queryByText(/proposalSummary/)).not.toBeInTheDocument();
    expect(screen.queryByText(/proposalSceneChange/)).not.toBeInTheDocument();
  });

  it('still computes a legacy proposal locally while the script stands where it was drafted', () => {
    renderCard({ proposal: proposal({ diff: undefined }) });

    expect(screen.getByText(summary(0, 0, 1))).toBeInTheDocument();
    expect(screen.getByText(sceneChange(1, 'narration'))).toBeInTheDocument();
  });

  it('ignores a malformed diff from the boundary instead of rendering it', () => {
    renderCard({
      project: project({ revision: 9 }),
      proposal: proposal({ diff: { added: 1, removed: 0 } as StudioProposal['diff'] }),
    });

    expect(screen.getByText('conversation.creativeStudio.brief.proposalDiffUnavailable')).toBeInTheDocument();
  });

  it('lists the proposed scene titles', () => {
    renderCard({
      proposal: proposal({
        payload: {
          kind: 'replace_storyboard',
          sceneOrder: ['proposed-1', 'proposed-2'],
          scenes: { 'proposed-1': editableScene(), 'proposed-2': editableScene({ title: 'Finale' }) },
        },
      }),
    });

    expect(screen.getByText('Opening')).toBeInTheDocument();
    expect(screen.getByText('Finale')).toBeInTheDocument();
  });

  it('accept invokes acceptProposal and removes the resolved card', async () => {
    renderCard();

    fireEvent.click(screen.getByRole('button', { name: 'conversation.creativeStudio.brief.proposalAccept' }));

    await waitFor(() =>
      expect(acceptProposal).toHaveBeenCalledWith({ projectId: 'project-1', proposalId: 'proposal-1' })
    );
    expect(screen.queryByText('conversation.creativeStudio.brief.proposalTitle')).not.toBeInTheDocument();
  });

  it('stale accept fails closed and offers re-propose', async () => {
    const staleAccept = vi.fn(
      async (): Promise<StudioCommandResult<StudioProposalAcceptance>> => ({
        ok: false,
        error: { code: 'stale_project', messageKey: 'conversation.creativeStudio.errors.staleProject' },
      })
    );
    const currentProject = project();
    render(
      <DirectorProposalCard
        project={currentProject}
        proposal={proposal()}
        editor={editor()}
        acceptProposal={staleAccept}
        rejectProposal={rejectProposal}
        onRepropose={repropose}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'conversation.creativeStudio.brief.proposalAccept' }));

    expect(await screen.findByText('conversation.creativeStudio.brief.proposalStale')).toBeInTheDocument();
    expect(currentProject.revision).toBe(4);
    fireEvent.click(screen.getByRole('button', { name: 'conversation.creativeStudio.brief.proposalRepropose' }));
    expect(repropose).toHaveBeenCalledOnce();
  });

  it('reject invokes rejectProposal and removes the resolved card', async () => {
    renderCard();

    fireEvent.click(screen.getByRole('button', { name: 'conversation.creativeStudio.brief.proposalReject' }));

    await waitFor(() =>
      expect(rejectProposal).toHaveBeenCalledWith({ projectId: 'project-1', proposalId: 'proposal-1' })
    );
    expect(screen.queryByText('conversation.creativeStudio.brief.proposalTitle')).not.toBeInTheDocument();
  });

  it('flushes unsaved drafts first and refuses acceptance when the flush fails', async () => {
    const flushAllSceneDrafts = vi.fn(async () => ({ failed: ['scene-1'], dirtied: [] }));
    render(
      <DirectorProposalCard
        project={project()}
        proposal={proposal()}
        editor={editor({ hasUnsavedSceneDrafts: true, flushAllSceneDrafts })}
        acceptProposal={acceptProposal}
        rejectProposal={rejectProposal}
        onRepropose={repropose}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'conversation.creativeStudio.brief.proposalAccept' }));

    expect(await screen.findByText('conversation.creativeStudio.brief.proposalFlushRefused')).toBeInTheDocument();
    expect(flushAllSceneDrafts).toHaveBeenCalledOnce();
    expect(acceptProposal).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'conversation.creativeStudio.brief.proposalAccept' })).toBeEnabled();
  });
});
