import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  const event = () => ({ on: vi.fn(() => vi.fn()) });
  return {
    callOrder: [] as string[],
    bridge: {
      getProject: { invoke: vi.fn() },
      listProposals: { invoke: vi.fn() },
      acceptProposal: { invoke: vi.fn() },
      rejectProposal: { invoke: vi.fn() },
      listReferenceRequests: { invoke: vi.fn() },
      decideReferenceRequest: { invoke: vi.fn() },
      listReferenceGenerationHandoffs: { invoke: vi.fn() },
      hasUnsavedWork: { provider: vi.fn(() => vi.fn()) },
      flushUnsavedWork: { provider: vi.fn(() => vi.fn()) },
      projectUpdated: event(),
      proposalUpdated: event(),
      referenceUpdated: event(),
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

describe('StudioPage schema-2 cutover', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.callOrder.length = 0;
    mocks.bridge.getProject.invoke.mockResolvedValue(ok({ status: 'supported', project: project() }));
    mocks.bridge.listProposals.invoke.mockResolvedValue(ok([]));
    mocks.bridge.listReferenceRequests.invoke.mockResolvedValue(ok([]));
    mocks.bridge.listReferenceGenerationHandoffs.invoke.mockResolvedValue(ok([]));
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

  it('renders reviewed proposals, pending references, and only one card for each open handoff', async () => {
    mocks.bridge.listProposals.invoke.mockResolvedValue(ok([proposal()]));
    mocks.bridge.listReferenceRequests.invoke.mockResolvedValue(ok([referenceRequest()]));
    mocks.bridge.listReferenceGenerationHandoffs.invoke.mockResolvedValue(
      ok([handoff(), handoff(), handoff('confirmed'), handoff('dismissed')])
    );

    renderStudio();

    expect(await screen.findByTestId('studio-proposal-proposal_1')).toBeVisible();
    expect(screen.getByTestId('studio-reference-reference_1')).toBeVisible();
    expect(screen.getAllByTestId('studio-handoff-handoff_open')).toHaveLength(1);
    expect(screen.queryByTestId('studio-handoff-handoff_confirmed')).not.toBeInTheDocument();
    expect(screen.queryByTestId('studio-handoff-handoff_dismissed')).not.toBeInTheDocument();
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
    expect(Object.keys(mocks.bridge)).not.toContain('prepareSubmission');
    expect(Object.keys(mocks.bridge)).not.toContain('confirmSubmission');
    expect(Object.keys(mocks.bridge)).not.toContain('dismissReferenceGenerationHandoff');
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
