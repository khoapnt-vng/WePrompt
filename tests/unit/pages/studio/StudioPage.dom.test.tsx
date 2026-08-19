import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  StudioProposalV2,
  StudioReferenceRequestV2,
  StudioRendererProjectV2,
  StudioRendererReferenceGenerationHandoffV2,
} from '@/common/types/project/creativeStudioTypes';

const mocks = vi.hoisted(() => {
  type ProjectEventListener = (payload: { projectId: string }) => void;
  const listeners: {
    projectUpdated: ProjectEventListener | null;
    proposalUpdated: ProjectEventListener | null;
    referenceUpdated: ProjectEventListener | null;
  } = { projectUpdated: null, proposalUpdated: null, referenceUpdated: null };
  const closeHandlers: {
    hasUnsavedWork: (() => { dirtyDraftCount: number }) | null;
    flushUnsavedWork: (() => Promise<{ saved: boolean }>) | null;
  } = { hasUnsavedWork: null, flushUnsavedWork: null };
  const event = (name: keyof typeof listeners) => ({
    on: vi.fn((listener: ProjectEventListener) => {
      listeners[name] = listener;
      return vi.fn(() => {
        if (listeners[name] === listener) listeners[name] = null;
      });
    }),
  });
  return {
    callOrder: [] as string[],
    listeners,
    closeHandlers,
    bridge: {
      getProject: { invoke: vi.fn() },
      listProposals: { invoke: vi.fn() },
      acceptProposal: { invoke: vi.fn() },
      rejectProposal: { invoke: vi.fn() },
      listReferenceRequests: { invoke: vi.fn() },
      decideReferenceRequest: { invoke: vi.fn() },
      listReferenceGenerationHandoffs: { invoke: vi.fn() },
      getWorkspaceStatus: { invoke: vi.fn() },
      getChainStatus: { invoke: vi.fn() },
      listRoutes: { invoke: vi.fn() },
      prepareSubmission: { invoke: vi.fn() },
      confirmSubmission: { invoke: vi.fn() },
      dismissReferenceGenerationHandoff: { invoke: vi.fn() },
      applyAuthoringBatch: { invoke: vi.fn() },
      undoLast: { invoke: vi.fn() },
      retryConditioningFrame: { invoke: vi.fn() },
      cancelWaitingCascade: { invoke: vi.fn() },
      editProject: { invoke: vi.fn() },
      setRules: { invoke: vi.fn() },
      selectTake: { invoke: vi.fn() },
      hasUnsavedWork: {
        provider: vi.fn((handler: () => { dirtyDraftCount: number }) => {
          closeHandlers.hasUnsavedWork = handler;
          return vi.fn();
        }),
      },
      flushUnsavedWork: {
        provider: vi.fn((handler: () => Promise<{ saved: boolean }>) => {
          closeHandlers.flushUnsavedWork = handler;
          return vi.fn();
        }),
      },
      projectUpdated: event('projectUpdated'),
      proposalUpdated: event('proposalUpdated'),
      referenceUpdated: event('referenceUpdated'),
    },
  };
});

vi.mock('@/common', () => ({ ipcBridge: { creativeStudio: mocks.bridge } }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values === undefined ? key : `${key}:${JSON.stringify(values)}`,
    i18n: { language: 'en-US', resolvedLanguage: 'en-US' },
  }),
}));

import StudioPage from '@/renderer/pages/studio/StudioPage';

const ok = <T,>(data: T) => ({ ok: true as const, data });

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
};

const project = (): StudioRendererProjectV2 => ({
  schemaVersion: 2,
  revision: 3,
  id: 'project_1',
  name: 'Launch film',
  brief: 'A small launch film.',
  rules: [],
  briefConversationId: null,
  aspectRatio: '16:9',
  targetDurationSeconds: 30,
  resolution: '720p',
  beatOrder: [],
  beats: {},
  shots: {},
  bin: [],
  bedAssetId: null,
  matchToShotId: null,
  spendPolicy: null,
  imageRouteId: null,
  videoRouteId: null,
  assets: {},
  jobs: {},
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

const workspaceStatus = (revision: number, locked = false) => ({
  projectId: 'project_1',
  projectRevision: revision,
  undoTop: null,
  dirtyShots: [],
  cascadeProgress: [],
  parkEligibility: locked
    ? [
        {
          subject: 'shot' as const,
          action: 'park' as const,
          beatId: 'beat_1',
          shotId: 'shot_1',
          assetId: null,
          allowed: false,
          blockers: [{ shotId: 'shot_1', code: 'bound_nonterminal_request' as const }],
        },
      ]
    : [],
});

const chainStatus = (revision: number) => ({
  projectId: 'project_1',
  projectRevision: revision,
  conditioningFailures: [],
});

const commit = (revision: number) =>
  ok({ projectId: 'project_1', projectRevision: revision, createdBeatIds: [], createdShotIds: [] });

const proposal = (): StudioProposalV2 => ({
  schemaVersion: 2,
  id: 'proposal_1',
  projectId: 'project_1',
  status: 'pending',
  baseRevision: 3,
  payload: { kind: 'mutation_batch', operations: [{ kind: 'set_brief', brief: 'A sharper launch film.' }] },
  createdAt: '2026-01-01T00:00:01.000Z',
  decidedAt: null,
});

const referenceRequest = (): StudioReferenceRequestV2 => ({
  schemaVersion: 2,
  id: 'reference_1',
  projectId: 'project_1',
  shotIds: ['shot_1', 'shot_2'],
  status: 'pending',
  createdAt: '2026-01-01T00:00:02.000Z',
});

const handoff = (
  status: StudioRendererReferenceGenerationHandoffV2['status'] = 'open'
): StudioRendererReferenceGenerationHandoffV2 => ({
  handoffId: status === 'open' ? 'handoff_open' : `handoff_${status}`,
  requestId: status === 'open' ? 'reference_2' : `reference_${status}`,
  shotIds: ['shot_3'],
  decidedAt: '2026-01-01T00:00:03.000Z',
  status,
  completedAt: status === 'open' ? null : '2026-01-01T00:00:04.000Z',
});

const LocationProbe = () => {
  const location = useLocation();
  return <output data-testid='location'>{location.pathname}</output>;
};

const renderStudio = (path = '/studio/project_1/table') =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path='/studio/:id/:view?'
          element={
            <>
              <StudioPage />
              <LocationProbe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>
  );

const seedWorkspaceDrafts = (entries: Record<string, { baseValue: unknown; value: unknown }>): void => {
  window.sessionStorage.setItem(
    'aionui:creative-studio:v2:workspace-drafts:project_1',
    JSON.stringify({
      version: 2,
      projectId: 'project_1',
      sourceRevision: 3,
      entries,
      selection: { selectedShotIds: [], anchorShotId: null },
    })
  );
};

describe('StudioPage schema-2 cutover', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
    mocks.callOrder.length = 0;
    mocks.listeners.projectUpdated = null;
    mocks.listeners.proposalUpdated = null;
    mocks.listeners.referenceUpdated = null;
    mocks.bridge.projectUpdated.on.mockImplementation((listener) => {
      mocks.listeners.projectUpdated = listener;
      return vi.fn(() => {
        if (mocks.listeners.projectUpdated === listener) mocks.listeners.projectUpdated = null;
      });
    });
    mocks.bridge.proposalUpdated.on.mockImplementation((listener) => {
      mocks.listeners.proposalUpdated = listener;
      return vi.fn(() => {
        if (mocks.listeners.proposalUpdated === listener) mocks.listeners.proposalUpdated = null;
      });
    });
    mocks.bridge.referenceUpdated.on.mockImplementation((listener) => {
      mocks.listeners.referenceUpdated = listener;
      return vi.fn(() => {
        if (mocks.listeners.referenceUpdated === listener) mocks.listeners.referenceUpdated = null;
      });
    });
    mocks.closeHandlers.hasUnsavedWork = null;
    mocks.closeHandlers.flushUnsavedWork = null;
    mocks.bridge.getProject.invoke.mockResolvedValue(ok({ status: 'supported', project: project() }));
    mocks.bridge.listProposals.invoke.mockResolvedValue(ok([]));
    mocks.bridge.listReferenceRequests.invoke.mockResolvedValue(ok([]));
    mocks.bridge.listReferenceGenerationHandoffs.invoke.mockResolvedValue(ok([]));
    mocks.bridge.getWorkspaceStatus.invoke.mockResolvedValue(ok(workspaceStatus(3)));
    mocks.bridge.getChainStatus.invoke.mockResolvedValue(ok(chainStatus(3)));
    mocks.bridge.listRoutes.invoke.mockResolvedValue(
      ok({
        image: { status: 'ready', selected: null, selectedRoute: null, selectionIssue: null, options: [] },
        video: { status: 'ready', selected: null, selectedRoute: null, selectionIssue: null, options: [] },
        catalogVersion: 'catalog_1',
      })
    );
    mocks.bridge.applyAuthoringBatch.invoke.mockResolvedValue(commit(4));
    mocks.bridge.undoLast.invoke.mockResolvedValue(commit(4));
    mocks.bridge.retryConditioningFrame.invoke.mockResolvedValue(commit(4));
    mocks.bridge.cancelWaitingCascade.invoke.mockResolvedValue(commit(4));
    mocks.bridge.editProject.invoke.mockResolvedValue(commit(4));
    mocks.bridge.setRules.invoke.mockResolvedValue(commit(4));
    mocks.bridge.selectTake.invoke.mockResolvedValue(commit(4));
    mocks.bridge.dismissReferenceGenerationHandoff.invoke.mockResolvedValue(
      ok({ status: 'dismissed', completedAt: '2026-01-01T00:00:05.000Z' })
    );
    mocks.bridge.acceptProposal.invoke.mockResolvedValue(
      ok({
        proposal: { ...proposal(), status: 'accepted', decidedAt: '2026-01-01T00:00:05.000Z' },
        project: project(),
        applied: true,
      })
    );
    mocks.bridge.rejectProposal.invoke.mockResolvedValue(
      ok({ ...proposal(), status: 'rejected', decidedAt: '2026-01-01T00:00:05.000Z' })
    );
    mocks.bridge.decideReferenceRequest.invoke.mockResolvedValue(
      ok({
        schemaVersion: 2,
        requestId: 'reference_1',
        projectId: 'project_1',
        decidedAt: '2026-01-01T00:00:05.000Z',
        outcome: { kind: 'generation_gate', handoffId: 'handoff_open', shotIds: ['shot_1', 'shot_2'] },
      })
    );
  });

  it('canonicalizes a retired route and keeps the shared Table, Board, and Cut views', async () => {
    renderStudio('/studio/project_1/write');

    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/studio/project_1/table'));
    expect(screen.getByRole('link', { name: 'conversation.creativeStudio.workspace.views.table' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'conversation.creativeStudio.workspace.views.board' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'conversation.creativeStudio.workspace.views.cut' })).toBeVisible();
  });

  it('keeps drafts and native snapshot counts stable across Table, Board, and Cut navigation', async () => {
    renderStudio();
    const name = await screen.findByLabelText('conversation.creativeStudio.workspace.controls.name');
    await waitFor(() => expect(mocks.bridge.listRoutes.invoke).toHaveBeenCalledTimes(1));
    const baseline = {
      project: mocks.bridge.getProject.invoke.mock.calls.length,
      workspace: mocks.bridge.getWorkspaceStatus.invoke.mock.calls.length,
      chain: mocks.bridge.getChainStatus.invoke.mock.calls.length,
      routes: mocks.bridge.listRoutes.invoke.mock.calls.length,
      proposals: mocks.bridge.listProposals.invoke.mock.calls.length,
      references: mocks.bridge.listReferenceRequests.invoke.mock.calls.length,
      handoffs: mocks.bridge.listReferenceGenerationHandoffs.invoke.mock.calls.length,
      edits: mocks.bridge.editProject.invoke.mock.calls.length,
      authoring: mocks.bridge.applyAuthoringBatch.invoke.mock.calls.length,
      rules: mocks.bridge.setRules.invoke.mock.calls.length,
      prepare: mocks.bridge.prepareSubmission.invoke.mock.calls.length,
      confirm: mocks.bridge.confirmSubmission.invoke.mock.calls.length,
    };
    fireEvent.change(name, { target: { value: 'Navigation-only local draft' } });

    fireEvent.click(screen.getByRole('link', { name: 'conversation.creativeStudio.workspace.views.board' }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/studio/project_1/board'));
    expect(screen.getByLabelText('conversation.creativeStudio.workspace.controls.name')).toHaveValue(
      'Navigation-only local draft'
    );
    fireEvent.click(screen.getByRole('link', { name: 'conversation.creativeStudio.workspace.views.cut' }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/studio/project_1/cut'));
    expect(screen.getByLabelText('conversation.creativeStudio.workspace.controls.name')).toHaveValue(
      'Navigation-only local draft'
    );

    expect({
      project: mocks.bridge.getProject.invoke.mock.calls.length,
      workspace: mocks.bridge.getWorkspaceStatus.invoke.mock.calls.length,
      chain: mocks.bridge.getChainStatus.invoke.mock.calls.length,
      routes: mocks.bridge.listRoutes.invoke.mock.calls.length,
      proposals: mocks.bridge.listProposals.invoke.mock.calls.length,
      references: mocks.bridge.listReferenceRequests.invoke.mock.calls.length,
      handoffs: mocks.bridge.listReferenceGenerationHandoffs.invoke.mock.calls.length,
      edits: mocks.bridge.editProject.invoke.mock.calls.length,
      authoring: mocks.bridge.applyAuthoringBatch.invoke.mock.calls.length,
      rules: mocks.bridge.setRules.invoke.mock.calls.length,
      prepare: mocks.bridge.prepareSubmission.invoke.mock.calls.length,
      confirm: mocks.bridge.confirmSubmission.invoke.mock.calls.length,
    }).toEqual(baseline);
  });

  it('subscribes to all three native streams before fetching their snapshots', async () => {
    mocks.bridge.projectUpdated.on.mockImplementation(() => {
      mocks.callOrder.push('subscribe-project');
      return vi.fn();
    });
    mocks.bridge.proposalUpdated.on.mockImplementation(() => {
      mocks.callOrder.push('subscribe-proposal');
      return vi.fn();
    });
    mocks.bridge.referenceUpdated.on.mockImplementation(() => {
      mocks.callOrder.push('subscribe-reference');
      return vi.fn();
    });
    mocks.bridge.getProject.invoke.mockImplementation(async () => {
      mocks.callOrder.push('get-project');
      return ok({ status: 'supported', project: project() });
    });
    mocks.bridge.listProposals.invoke.mockImplementation(async () => {
      mocks.callOrder.push('list-proposals');
      return ok([]);
    });
    mocks.bridge.listReferenceRequests.invoke.mockImplementation(async () => {
      mocks.callOrder.push('list-references');
      return ok([]);
    });
    mocks.bridge.listReferenceGenerationHandoffs.invoke.mockImplementation(async () => {
      mocks.callOrder.push('list-handoffs');
      return ok([]);
    });

    renderStudio();
    await screen.findByRole('heading', { name: 'Launch film' });

    expect(mocks.callOrder.indexOf('subscribe-project')).toBeLessThan(mocks.callOrder.indexOf('get-project'));
    expect(mocks.callOrder.indexOf('subscribe-proposal')).toBeLessThan(mocks.callOrder.indexOf('list-proposals'));
    expect(mocks.callOrder.indexOf('subscribe-reference')).toBeLessThan(mocks.callOrder.indexOf('list-references'));
    expect(mocks.callOrder.indexOf('subscribe-reference')).toBeLessThan(mocks.callOrder.indexOf('list-handoffs'));
  });

  it('renders reviewed proposals, pending references, and one persistent card for each handoff', async () => {
    mocks.bridge.listProposals.invoke.mockResolvedValue(ok([proposal()]));
    mocks.bridge.listReferenceRequests.invoke.mockResolvedValue(ok([referenceRequest()]));
    mocks.bridge.listReferenceGenerationHandoffs.invoke.mockResolvedValue(
      ok([handoff(), handoff(), handoff('confirmed'), handoff('dismissed')])
    );

    renderStudio();

    expect(await screen.findByTestId('studio-proposal-proposal_1')).toBeVisible();
    expect(screen.getByTestId('studio-reference-reference_1')).toBeVisible();
    expect(screen.getAllByTestId('studio-handoff-handoff_open')).toHaveLength(1);
    expect(screen.getByTestId('studio-handoff-handoff_confirmed')).toBeVisible();
    expect(screen.getByTestId('studio-handoff-handoff_dismissed')).toBeVisible();
  });

  it('blocks handoff review for unsaved generative intent while keeping free dismissal available', async () => {
    seedWorkspaceDrafts({
      'brief.text': { baseValue: 'A small launch film.', value: 'Unsaved generation Brief' },
    });
    mocks.bridge.listReferenceGenerationHandoffs.invoke.mockResolvedValue(ok([handoff(), handoff('confirmed')]));

    renderStudio();
    const card = within(await screen.findByTestId('studio-handoff-handoff_open'));
    expect(card.getByRole('button', { name: 'conversation.creativeStudio.workspace.handoffs.review' })).toBeDisabled();
    expect(card.getByText('conversation.creativeStudio.workspace.controls.saveBeforeReview')).toBeVisible();
    const dismiss = card.getByRole('button', { name: 'conversation.creativeStudio.workspace.handoffs.dismiss' });
    expect(dismiss).toBeEnabled();
    fireEvent.click(dismiss);

    await waitFor(() => expect(mocks.bridge.dismissReferenceGenerationHandoff.invoke).toHaveBeenCalledTimes(1));
    expect(mocks.bridge.prepareSubmission.invoke).not.toHaveBeenCalled();
    expect(screen.getByTestId('studio-handoff-handoff_confirmed')).toBeVisible();
  });

  it('blocks handoff review until both revision-matched status snapshots are ready', async () => {
    mocks.bridge.listReferenceGenerationHandoffs.invoke.mockResolvedValue(ok([handoff()]));
    mocks.bridge.getChainStatus.invoke.mockResolvedValue(ok(chainStatus(2)));

    renderStudio();
    const card = within(await screen.findByTestId('studio-handoff-handoff_open'));
    expect(card.getByRole('button', { name: 'conversation.creativeStudio.workspace.handoffs.review' })).toBeDisabled();
    expect(card.getByText('conversation.creativeStudio.workspace.controls.statusRequired')).toBeVisible();
    expect(card.getByRole('button', { name: 'conversation.creativeStudio.workspace.handoffs.dismiss' })).toBeEnabled();
  });

  it('decides a generation request without submitting or dismissing it and refreshes both reference lists', async () => {
    mocks.bridge.listReferenceRequests.invoke.mockResolvedValue(ok([referenceRequest()]));
    mocks.bridge.listReferenceGenerationHandoffs.invoke
      .mockResolvedValueOnce(ok([]))
      .mockResolvedValue(ok([handoff()]));

    renderStudio();
    fireEvent.click(
      await screen.findByRole('button', { name: 'conversation.creativeStudio.workspace.references.generate' })
    );

    await waitFor(() =>
      expect(mocks.bridge.decideReferenceRequest.invoke).toHaveBeenCalledWith({
        projectId: 'project_1',
        requestId: 'reference_1',
        expectedRevision: 3,
        outcome: { kind: 'generation_gate' },
      })
    );
    await waitFor(() => expect(screen.getByTestId('studio-handoff-handoff_open')).toBeVisible());
    expect(mocks.bridge.listReferenceRequests.invoke).toHaveBeenCalledTimes(2);
    expect(mocks.bridge.listReferenceGenerationHandoffs.invoke).toHaveBeenCalledTimes(2);
    expect(mocks.bridge.prepareSubmission.invoke).not.toHaveBeenCalled();
    expect(mocks.bridge.confirmSubmission.invoke).not.toHaveBeenCalled();
    expect(mocks.bridge.dismissReferenceGenerationHandoff.invoke).not.toHaveBeenCalled();
  });

  it('reports and flushes the shared draft owner, preserving drafts when the commit fails', async () => {
    const initial = project();
    const revised = { ...project(), revision: 4, name: 'Saved name' };
    mocks.bridge.getProject.invoke.mockResolvedValueOnce(ok({ status: 'supported', project: initial }));
    mocks.bridge.getProject.invoke.mockResolvedValue(ok({ status: 'supported', project: revised }));
    mocks.bridge.getWorkspaceStatus.invoke
      .mockResolvedValueOnce(ok(workspaceStatus(3)))
      .mockResolvedValue(ok(workspaceStatus(4)));
    mocks.bridge.getChainStatus.invoke.mockResolvedValueOnce(ok(chainStatus(3))).mockResolvedValue(ok(chainStatus(4)));

    const first = renderStudio();
    fireEvent.change(await screen.findByLabelText('conversation.creativeStudio.workspace.controls.name'), {
      target: { value: 'Saved name' },
    });
    await waitFor(() => expect(mocks.closeHandlers.hasUnsavedWork).not.toBeNull());
    expect(mocks.closeHandlers.hasUnsavedWork?.()).toEqual({ dirtyDraftCount: 1 });

    let saved: { saved: boolean } | undefined;
    await act(async () => {
      saved = await mocks.closeHandlers.flushUnsavedWork?.();
    });
    expect(saved).toEqual({ saved: true });
    expect(mocks.bridge.editProject.invoke).toHaveBeenCalledWith({
      projectId: 'project_1',
      expectedRevision: 3,
      changes: { name: 'Saved name' },
    });
    await waitFor(() => expect(mocks.closeHandlers.hasUnsavedWork?.()).toEqual({ dirtyDraftCount: 0 }));

    first.unmount();
    window.sessionStorage.clear();
    mocks.bridge.editProject.invoke.mockResolvedValue({
      ok: false,
      error: { code: 'storage_error', messageKey: 'conversation.creativeStudio.workspace.errors.storage' },
    });
    const second = renderStudio();
    fireEvent.change(await screen.findByLabelText('conversation.creativeStudio.workspace.controls.name'), {
      target: { value: 'Still dirty' },
    });
    await waitFor(() => expect(mocks.closeHandlers.hasUnsavedWork?.()).toEqual({ dirtyDraftCount: 1 }));
    await act(async () => {
      saved = await mocks.closeHandlers.flushUnsavedWork?.();
    });
    expect(saved).toEqual({ saved: false });
    expect(mocks.closeHandlers.hasUnsavedWork?.()).toEqual({ dirtyDraftCount: 1 });
    second.unmount();
  });

  it('continues close-save past locked shape drafts and commits later Brief and rule groups', async () => {
    seedWorkspaceDrafts({
      'settings.aspectRatio': { baseValue: '16:9', value: '9:16' },
      'brief.text': { baseValue: 'A small launch film.', value: 'A saved Brief.' },
      'brief.rules': {
        baseValue: '[]',
        value: '[{"id":"rule_1","text":"Keep it bright","predicate":null,"scope":"poison"}]',
      },
    });
    const initial = project();
    const revision4 = { ...project(), revision: 4, brief: 'A saved Brief.' };
    const revision5 = { ...revision4, revision: 5 };
    mocks.bridge.getProject.invoke
      .mockResolvedValueOnce(ok({ status: 'supported', project: initial }))
      .mockResolvedValueOnce(ok({ status: 'supported', project: revision4 }))
      .mockResolvedValue(ok({ status: 'supported', project: revision5 }));
    mocks.bridge.getWorkspaceStatus.invoke
      .mockResolvedValueOnce(ok(workspaceStatus(3, true)))
      .mockResolvedValueOnce(ok(workspaceStatus(4, true)))
      .mockResolvedValue(ok(workspaceStatus(5, true)));
    mocks.bridge.getChainStatus.invoke
      .mockResolvedValueOnce(ok(chainStatus(3)))
      .mockResolvedValueOnce(ok(chainStatus(4)))
      .mockResolvedValue(ok(chainStatus(5)));
    mocks.bridge.setRules.invoke.mockResolvedValue(commit(5));

    renderStudio();
    await screen.findByRole('heading', { name: 'Launch film' });
    await waitFor(() => expect(mocks.closeHandlers.flushUnsavedWork).not.toBeNull());
    let response: { saved: boolean } | undefined;
    await act(async () => {
      response = await mocks.closeHandlers.flushUnsavedWork?.();
    });

    expect(response).toEqual({ saved: false });
    expect(mocks.bridge.editProject.invoke).not.toHaveBeenCalled();
    expect(mocks.bridge.applyAuthoringBatch.invoke).toHaveBeenCalledWith({
      projectId: 'project_1',
      expectedRevision: 3,
      operations: [{ kind: 'set_brief', brief: 'A saved Brief.' }],
    });
    expect(mocks.bridge.setRules.invoke).toHaveBeenCalledWith({
      projectId: 'project_1',
      expectedRevision: 4,
      rules: [{ id: 'rule_1', text: 'Keep it bright', predicate: null }],
    });
    await waitFor(() => expect(mocks.closeHandlers.hasUnsavedWork?.()).toEqual({ dirtyDraftCount: 1 }));
    expect(window.sessionStorage.getItem('aionui:creative-studio:v2:workspace-drafts:project_1')).toContain(
      'settings.aspectRatio'
    );
  });

  it('disables settings, Brief, and rule editors while a deferred commit is pending', async () => {
    const initial = project();
    const revised = { ...project(), revision: 4, name: 'Pending name' };
    const edit = deferred<ReturnType<typeof commit>>();
    mocks.bridge.editProject.invoke.mockReturnValue(edit.promise);
    mocks.bridge.getProject.invoke
      .mockResolvedValueOnce(ok({ status: 'supported', project: initial }))
      .mockResolvedValue(ok({ status: 'supported', project: revised }));
    mocks.bridge.getWorkspaceStatus.invoke
      .mockResolvedValueOnce(ok(workspaceStatus(3)))
      .mockResolvedValue(ok(workspaceStatus(4)));
    mocks.bridge.getChainStatus.invoke.mockResolvedValueOnce(ok(chainStatus(3))).mockResolvedValue(ok(chainStatus(4)));

    renderStudio();
    const name = await screen.findByLabelText('conversation.creativeStudio.workspace.controls.name');
    fireEvent.change(name, { target: { value: 'Pending name' } });
    fireEvent.click(
      screen.getByRole('button', { name: 'conversation.creativeStudio.workspace.controls.saveSettings' })
    );

    await waitFor(() => expect(name).toBeDisabled());
    expect(screen.getByLabelText('conversation.creativeStudio.workspace.controls.brief')).toBeDisabled();
    expect(screen.getByLabelText('conversation.creativeStudio.workspace.controls.rules')).toBeDisabled();

    await act(async () => edit.resolve(commit(4)));
    await waitFor(() => expect(name).toBeEnabled());
    expect(name).toHaveValue('Pending name');
  });

  it('invalidates routes after an accepted set-routes proposal without invoking the resolver automatically', async () => {
    const routeProposal: StudioProposalV2 = {
      ...proposal(),
      payload: {
        kind: 'mutation_batch',
        operations: [{ kind: 'set_routes', imageRouteId: 'route_new', videoRouteId: null }],
      },
    };
    const changed = { ...project(), revision: 4, imageRouteId: 'route_new' };
    mocks.bridge.listProposals.invoke.mockResolvedValueOnce(ok([routeProposal])).mockResolvedValue(ok([]));
    mocks.bridge.getProject.invoke
      .mockResolvedValueOnce(ok({ status: 'supported', project: project() }))
      .mockResolvedValue(ok({ status: 'supported', project: changed }));

    renderStudio();
    await waitFor(() =>
      expect(screen.getAllByText('conversation.creativeStudio.workspace.controls.routeStatus.ready')).toHaveLength(2)
    );
    fireEvent.click(screen.getByRole('button', { name: 'conversation.creativeStudio.workspace.proposals.accept' }));

    await waitFor(() =>
      expect(
        screen.getAllByText('conversation.creativeStudio.workspace.controls.routeStatus.unavailable')
      ).toHaveLength(2)
    );
    expect(mocks.bridge.listRoutes.invoke).toHaveBeenCalledTimes(1);
  });

  it('invalidates a frame-dependent route after save and refreshes it only from the explicit action', async () => {
    seedWorkspaceDrafts({
      'settings.resolution': { baseValue: '720p', value: '1080p' },
    });
    const changed = { ...project(), revision: 4, resolution: '1080p' as const };
    mocks.bridge.getProject.invoke
      .mockResolvedValueOnce(ok({ status: 'supported', project: project() }))
      .mockResolvedValue(ok({ status: 'supported', project: changed }));
    mocks.bridge.getWorkspaceStatus.invoke
      .mockResolvedValueOnce(ok(workspaceStatus(3)))
      .mockResolvedValue(ok(workspaceStatus(4)));
    mocks.bridge.getChainStatus.invoke.mockResolvedValueOnce(ok(chainStatus(3))).mockResolvedValue(ok(chainStatus(4)));

    renderStudio();
    await waitFor(() =>
      expect(screen.getAllByText('conversation.creativeStudio.workspace.controls.routeStatus.ready')).toHaveLength(2)
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'conversation.creativeStudio.workspace.controls.saveSettings' })
    );

    await waitFor(() =>
      expect(mocks.bridge.editProject.invoke).toHaveBeenCalledWith({
        projectId: 'project_1',
        expectedRevision: 3,
        changes: { resolution: '1080p' },
      })
    );
    await waitFor(() =>
      expect(
        screen.getAllByText('conversation.creativeStudio.workspace.controls.routeStatus.unavailable')
      ).toHaveLength(2)
    );
    expect(mocks.bridge.listRoutes.invoke).toHaveBeenCalledTimes(1);

    fireEvent.click(
      screen.getByRole('button', { name: 'conversation.creativeStudio.workspace.controls.refreshRoutes' })
    );
    await waitFor(() => expect(mocks.bridge.listRoutes.invoke).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.getAllByText('conversation.creativeStudio.workspace.controls.routeStatus.ready')).toHaveLength(2)
    );
  });

  it('preserves a catalog across a paid-style project update with the same route signature', async () => {
    const changed = { ...project(), revision: 4, name: 'Paid update landed' };
    mocks.bridge.getProject.invoke
      .mockResolvedValueOnce(ok({ status: 'supported', project: project() }))
      .mockResolvedValue(ok({ status: 'supported', project: changed }));
    mocks.bridge.getWorkspaceStatus.invoke
      .mockResolvedValueOnce(ok(workspaceStatus(3)))
      .mockResolvedValue(ok(workspaceStatus(4)));
    mocks.bridge.getChainStatus.invoke.mockResolvedValueOnce(ok(chainStatus(3))).mockResolvedValue(ok(chainStatus(4)));

    renderStudio();
    await waitFor(() =>
      expect(screen.getAllByText('conversation.creativeStudio.workspace.controls.routeStatus.ready')).toHaveLength(2)
    );
    act(() => mocks.listeners.projectUpdated?.({ projectId: 'project_1' }));

    expect(await screen.findByRole('heading', { name: 'Paid update landed' })).toBeVisible();
    expect(screen.getAllByText('conversation.creativeStudio.workspace.controls.routeStatus.ready')).toHaveLength(2);
    expect(mocks.bridge.listRoutes.invoke).toHaveBeenCalledTimes(1);
  });

  it('discards an in-flight catalog when its bound route signature changes', async () => {
    const catalog = deferred<ReturnType<typeof ok>>();
    const changed = { ...project(), revision: 4, aspectRatio: '9:16' as const, name: 'New frame' };
    mocks.bridge.listRoutes.invoke.mockReturnValue(catalog.promise);
    mocks.bridge.getProject.invoke
      .mockResolvedValueOnce(ok({ status: 'supported', project: project() }))
      .mockResolvedValue(ok({ status: 'supported', project: changed }));
    mocks.bridge.getWorkspaceStatus.invoke
      .mockResolvedValueOnce(ok(workspaceStatus(3)))
      .mockResolvedValue(ok(workspaceStatus(4)));
    mocks.bridge.getChainStatus.invoke.mockResolvedValueOnce(ok(chainStatus(3))).mockResolvedValue(ok(chainStatus(4)));

    renderStudio();
    await screen.findByRole('heading', { name: 'Launch film' });
    await waitFor(() => expect(mocks.bridge.listRoutes.invoke).toHaveBeenCalledTimes(1));
    act(() => mocks.listeners.projectUpdated?.({ projectId: 'project_1' }));
    expect(await screen.findByRole('heading', { name: 'New frame' })).toBeVisible();
    await act(async () =>
      catalog.resolve(
        ok({
          image: { status: 'ready', selected: null, selectedRoute: null, selectionIssue: null, options: [] },
          video: { status: 'ready', selected: null, selectedRoute: null, selectionIssue: null, options: [] },
          catalogVersion: 'stale_catalog',
        })
      )
    );

    expect(
      screen.queryByText('conversation.creativeStudio.workspace.controls.routeStatus.ready')
    ).not.toBeInTheDocument();
    expect(screen.getAllByText('conversation.creativeStudio.workspace.controls.routeStatus.unavailable')).toHaveLength(
      2
    );
  });

  it('invalidates paid readiness when a non-initial project refresh fails', async () => {
    mocks.bridge.getProject.invoke
      .mockResolvedValueOnce(ok({ status: 'supported', project: project() }))
      .mockResolvedValue({
        ok: false,
        error: { code: 'storage_error', messageKey: 'conversation.creativeStudio.workspace.errors.storage' },
      });

    renderStudio();
    await waitFor(() =>
      expect(screen.getAllByText('conversation.creativeStudio.workspace.controls.routeStatus.ready')).toHaveLength(2)
    );
    act(() => mocks.listeners.projectUpdated?.({ projectId: 'project_1' }));

    expect(await screen.findByText('conversation.creativeStudio.workspace.controls.statusRequired')).toBeVisible();
    expect(screen.getAllByText('conversation.creativeStudio.workspace.controls.routeStatus.unavailable')).toHaveLength(
      2
    );
    expect(mocks.bridge.listRoutes.invoke).toHaveBeenCalledTimes(1);
  });

  it('renders the unsupported prototype state without fabricating a project', async () => {
    mocks.bridge.getProject.invoke.mockResolvedValue(
      ok({ status: 'unsupported_prototype_schema', projectId: 'project_1' })
    );

    renderStudio();

    expect(await screen.findByText('conversation.creativeStudio.workspace.project.unsupportedPrototype')).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Launch film' })).not.toBeInTheDocument();
  });
});
