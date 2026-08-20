import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  StudioAssetV2,
  StudioProposalV2,
  StudioReferenceRequestV2,
  StudioRendererProjectV2,
  StudioRendererReferenceGenerationHandoffV2,
} from '@/common/types/project/creativeStudioTypes';
import type {
  BeatPanelActions,
  BeatPanelBriefReferenceOption,
  BeatPanelImportResult,
} from '@/renderer/pages/studio/components/Workspace';

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
    beatPanelActions: null as BeatPanelActions | null,
    beatPanelBriefReferenceOptions: null as readonly BeatPanelBriefReferenceOption[] | null,
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
      importSeedStill: { invoke: vi.fn() },
      selectTake: { invoke: vi.fn() },
      parkTake: { invoke: vi.fn() },
      addAlternateTake: { invoke: vi.fn() },
      restoreTake: { invoke: vi.fn() },
      parkShot: { invoke: vi.fn() },
      parkBeat: { invoke: vi.fn() },
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

vi.mock('@/renderer/pages/studio/components/Workspace', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/renderer/pages/studio/components/Workspace')>();
  return {
    ...actual,
    WorkspaceControls: (props: React.ComponentProps<typeof actual.WorkspaceControls>) => {
      mocks.beatPanelActions = props.beatPanelActions;
      mocks.beatPanelBriefReferenceOptions = props.beatPanelBriefReferenceOptions;
      return React.createElement(actual.WorkspaceControls, props);
    },
  };
});

vi.mock('@/renderer/pages/studio/components/Workspace/DirectorRail', () => ({
  DirectorRail: ({
    project,
    reviewedOutput,
  }: {
    project: StudioRendererProjectV2;
    reviewedOutput?: React.ReactNode;
  }) => (
    <aside data-studio-director-rail>
      <div data-studio-director-conversation-owner>{project.id}</div>
      {reviewedOutput === undefined ? null : <div data-studio-director-reviewed-output>{reviewedOutput}</div>}
    </aside>
  ),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values === undefined ? key : `${key}:${JSON.stringify(values)}`,
    i18n: { language: 'en-US', resolvedLanguage: 'en-US' },
  }),
}));

import StudioPage from '@/renderer/pages/studio/StudioPage';
import { useStudioProject, type UseStudioProjectResult } from '@/renderer/pages/studio/hooks/useStudioProject';

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

const projectWithHandoffShot = (): StudioRendererProjectV2 => {
  const value = project();
  value.beatOrder = ['beat_1'];
  value.beats.beat_1 = {
    id: 'beat_1',
    title: 'Opening',
    action: 'Open',
    look: 'Bright',
    actionRevision: 1,
    targetSeconds: 4,
    shotOrder: ['shot_3'],
    lineHistory: [],
  };
  value.shots.shot_3 = {
    id: 'shot_3',
    line: 'Opening frame',
    derivation: 'derived',
    derivedFromActionRevision: 1,
    narration: '',
    onScreenText: '',
    durationSeconds: 4,
    trimInSeconds: null,
    trimOutSeconds: null,
    chainBreak: 'hard_cut',
    seedStillId: null,
    selectedTakeId: null,
    assetIds: [],
    jobIds: [],
  };
  return value;
};

const projectWithDraftBatch = (beatCount: number): StudioRendererProjectV2 => {
  const value = project();
  for (let index = 0; index < beatCount; index += 1) {
    const beatId = `beat_${index}`;
    const shotId = `shot_${index}`;
    value.beatOrder.push(beatId);
    value.beats[beatId] = {
      id: beatId,
      title: `Beat ${index + 1}`,
      action: `Action ${index + 1}`,
      look: 'Natural',
      actionRevision: 1,
      targetSeconds: 4,
      shotOrder: [shotId],
      lineHistory: [],
    };
    value.shots[shotId] = {
      id: shotId,
      line: `Shot ${index + 1}`,
      derivation: 'derived',
      derivedFromActionRevision: 1,
      narration: '',
      onScreenText: '',
      durationSeconds: 4,
      trimInSeconds: null,
      trimOutSeconds: null,
      chainBreak: index === 0 ? 'hard_cut' : 'none',
      seedStillId: null,
      selectedTakeId: null,
      assetIds: [],
      jobIds: [],
    };
  }
  return value;
};

const recoveryAsset = (id: string, shotId: string, mediaKind: StudioAssetV2['mediaKind']): StudioAssetV2 => ({
  id,
  projectId: 'project_1',
  shotId,
  mediaKind,
  mimeType: mediaKind === 'video' ? 'video/mp4' : 'image/png',
  managedAsset: { collection: mediaKind === 'video' ? 'assets' : 'imports', fileName: `${id}.bin` },
  byteSize: 16,
  sha256: 'a'.repeat(64),
  ...(mediaKind === 'video' ? { durationSeconds: 4 } : {}),
  createdAt: '2026-01-01T00:00:00.000Z',
});

const projectWithRecovery = (revision = 3): StudioRendererProjectV2 => {
  const value = project();
  const shotIds = ['upstream_seed', 'dependent_seed', 'upstream_take', 'dependent_take'];
  value.revision = revision;
  value.beatOrder = ['beat_recovery'];
  value.beats.beat_recovery = {
    id: 'beat_recovery',
    title: 'Recovery Beat',
    action: 'Continue the authorized sequence',
    look: 'Warm daylight',
    actionRevision: 1,
    targetSeconds: 16,
    shotOrder: shotIds,
    lineHistory: [],
  };
  for (const [index, shotId] of shotIds.entries()) {
    value.shots[shotId] = {
      id: shotId,
      line: `Recovery Shot ${index + 1}`,
      derivation: 'derived',
      derivedFromActionRevision: 1,
      narration: '',
      onScreenText: '',
      durationSeconds: 4,
      trimInSeconds: null,
      trimOutSeconds: null,
      chainBreak: index === 0 || index === 2 ? 'hard_cut' : 'none',
      seedStillId: null,
      selectedTakeId: null,
      assetIds: [],
      jobIds: [],
    };
  }
  const seed = recoveryAsset('seed_asset', 'upstream_seed', 'image');
  const take = recoveryAsset('take_asset', 'upstream_take', 'video');
  value.assets = { [seed.id]: seed, [take.id]: take };
  value.shots.upstream_seed!.assetIds.push(seed.id);
  value.shots.upstream_take!.assetIds.push(take.id);
  return value;
};

const recoveryStatus = (revision: number) => ({
  ...workspaceStatus(revision),
  cascadeProgress: [
    {
      dependentShotId: 'dependent_seed',
      upstreamShotId: 'upstream_seed',
      eligiblePrimaryAssetIds: ['seed_asset'],
      canRetryConditioningFrame: false,
      canCancelWaiting: false,
      waitingReason: 'choose_seed' as const,
    },
    {
      dependentShotId: 'dependent_take',
      upstreamShotId: 'upstream_take',
      eligiblePrimaryAssetIds: ['take_asset'],
      canRetryConditioningFrame: true,
      canCancelWaiting: true,
      waitingReason: 'conditioning_failed' as const,
    },
  ],
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

const pinRuleProposal = (): StudioProposalV2 => ({
  ...proposal(),
  id: 'proposal_rule',
  payload: { kind: 'pin_rule', rule: { text: 'Never show a logo', predicate: null } },
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

let latestHookResult: UseStudioProjectResult | null = null;

const HookProbe: React.FC<{ projectId?: string }> = ({ projectId }) => {
  latestHookResult = useStudioProject(projectId);
  return <output data-testid='hook-state'>{latestHookResult.loadState}</output>;
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
      selection: { selectedBeatId: null, selectedShotIds: [], anchorShotId: null },
    })
  );
};

const capturedBeatPanelActions = (): BeatPanelActions => {
  expect(mocks.beatPanelActions).not.toBeNull();
  return mocks.beatPanelActions!;
};

const expectSuccessfulBeatPanelAction = async (invoke: () => Promise<boolean>): Promise<void> => {
  let result: boolean | undefined;
  await act(async () => {
    result = await invoke();
  });
  expect(result).toBe(true);
};

const invokeBeatPanelImport = async (invoke: () => Promise<BeatPanelImportResult>): Promise<BeatPanelImportResult> => {
  let result: BeatPanelImportResult | undefined;
  await act(async () => {
    result = await invoke();
  });
  return result!;
};

describe('StudioPage schema-2 cutover', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
    latestHookResult = null;
    mocks.beatPanelActions = null;
    mocks.beatPanelBriefReferenceOptions = null;
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
    mocks.bridge.importSeedStill.invoke.mockResolvedValue(ok({ status: 'cancelled' }));
    mocks.bridge.selectTake.invoke.mockResolvedValue(commit(4));
    mocks.bridge.parkTake.invoke.mockResolvedValue(commit(4));
    mocks.bridge.addAlternateTake.invoke.mockResolvedValue(commit(4));
    mocks.bridge.restoreTake.invoke.mockResolvedValue(commit(4));
    mocks.bridge.parkShot.invoke.mockResolvedValue(commit(4));
    mocks.bridge.parkBeat.invoke.mockResolvedValue(commit(4));
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

  it('omits the reviewed-output rail section when there are no cards or review errors', async () => {
    renderStudio();

    await screen.findByLabelText('conversation.creativeStudio.workspace.controls.name');
    expect(document.querySelector('[data-studio-director-reviewed-output]')).toBeNull();
  });

  it('keeps drafts and native snapshot counts stable across Table, Board, and Cut navigation', async () => {
    mocks.bridge.getProject.invoke.mockResolvedValue(ok({ status: 'supported', project: projectWithHandoffShot() }));
    renderStudio();
    const name = await screen.findByLabelText('conversation.creativeStudio.workspace.controls.name');
    const shell = document.querySelector('[data-studio-workspace-shell]');
    const directorRail = document.querySelector('[data-studio-director-rail]');
    const workPanel = document.querySelector('[data-studio-work-panel]');
    const conversationOwner = document.querySelector('[data-studio-director-conversation-owner]');
    expect(shell).not.toBeNull();
    expect(directorRail?.parentElement).toBe(shell);
    expect(workPanel?.parentElement).toBe(shell);
    expect(directorRail?.nextElementSibling).toBe(workPanel);
    expect(conversationOwner).not.toBeNull();
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
      acceptProposal: mocks.bridge.acceptProposal.invoke.mock.calls.length,
      rejectProposal: mocks.bridge.rejectProposal.invoke.mock.calls.length,
      decideReference: mocks.bridge.decideReferenceRequest.invoke.mock.calls.length,
      dismissHandoff: mocks.bridge.dismissReferenceGenerationHandoff.invoke.mock.calls.length,
      undo: mocks.bridge.undoLast.invoke.mock.calls.length,
      retryConditioning: mocks.bridge.retryConditioningFrame.invoke.mock.calls.length,
      cancelWaiting: mocks.bridge.cancelWaitingCascade.invoke.mock.calls.length,
      importSeedStill: mocks.bridge.importSeedStill.invoke.mock.calls.length,
      selectTake: mocks.bridge.selectTake.invoke.mock.calls.length,
      parkTake: mocks.bridge.parkTake.invoke.mock.calls.length,
      addAlternateTake: mocks.bridge.addAlternateTake.invoke.mock.calls.length,
      restoreTake: mocks.bridge.restoreTake.invoke.mock.calls.length,
      parkShot: mocks.bridge.parkShot.invoke.mock.calls.length,
      parkBeat: mocks.bridge.parkBeat.invoke.mock.calls.length,
      prepare: mocks.bridge.prepareSubmission.invoke.mock.calls.length,
      confirm: mocks.bridge.confirmSubmission.invoke.mock.calls.length,
    };
    fireEvent.change(name, { target: { value: 'Navigation-only local draft' } });
    const table = screen.getByRole('grid', { name: 'conversation.creativeStudio.workspace.table.label' });
    const selectedRow = within(table).getAllByRole('row')[1]!;
    fireEvent.click(within(selectedRow).getAllByRole('gridcell')[1]!);
    expect(selectedRow).toHaveAttribute('aria-selected', 'true');
    const beatDialog = screen.getByRole('dialog');
    expect(beatDialog).toBeVisible();
    fireEvent.keyDown(
      within(beatDialog).getByLabelText('conversation.creativeStudio.workspace.beatPanel.fields.action'),
      { key: 'Escape' }
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(selectedRow).toHaveAttribute('aria-selected', 'true');

    fireEvent.click(screen.getByRole('link', { name: 'conversation.creativeStudio.workspace.views.board' }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/studio/project_1/board'));
    expect(screen.getByLabelText('conversation.creativeStudio.workspace.controls.name')).toHaveValue(
      'Navigation-only local draft'
    );
    expect(document.querySelector('[data-studio-director-conversation-owner]')).toBe(conversationOwner);
    fireEvent.click(screen.getByRole('link', { name: 'conversation.creativeStudio.workspace.views.cut' }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/studio/project_1/cut'));
    expect(screen.getByLabelText('conversation.creativeStudio.workspace.controls.name')).toHaveValue(
      'Navigation-only local draft'
    );
    expect(document.querySelector('[data-studio-director-conversation-owner]')).toBe(conversationOwner);
    fireEvent.click(screen.getByRole('link', { name: 'conversation.creativeStudio.workspace.views.table' }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/studio/project_1/table'));
    expect(screen.getByLabelText('conversation.creativeStudio.workspace.controls.name')).toHaveValue(
      'Navigation-only local draft'
    );
    expect(document.querySelector('[data-studio-director-conversation-owner]')).toBe(conversationOwner);
    expect(
      within(screen.getByRole('grid', { name: 'conversation.creativeStudio.workspace.table.label' })).getAllByRole(
        'row'
      )[1]
    ).toHaveAttribute('aria-selected', 'true');

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
      acceptProposal: mocks.bridge.acceptProposal.invoke.mock.calls.length,
      rejectProposal: mocks.bridge.rejectProposal.invoke.mock.calls.length,
      decideReference: mocks.bridge.decideReferenceRequest.invoke.mock.calls.length,
      dismissHandoff: mocks.bridge.dismissReferenceGenerationHandoff.invoke.mock.calls.length,
      undo: mocks.bridge.undoLast.invoke.mock.calls.length,
      retryConditioning: mocks.bridge.retryConditioningFrame.invoke.mock.calls.length,
      cancelWaiting: mocks.bridge.cancelWaitingCascade.invoke.mock.calls.length,
      importSeedStill: mocks.bridge.importSeedStill.invoke.mock.calls.length,
      selectTake: mocks.bridge.selectTake.invoke.mock.calls.length,
      parkTake: mocks.bridge.parkTake.invoke.mock.calls.length,
      addAlternateTake: mocks.bridge.addAlternateTake.invoke.mock.calls.length,
      restoreTake: mocks.bridge.restoreTake.invoke.mock.calls.length,
      parkShot: mocks.bridge.parkShot.invoke.mock.calls.length,
      parkBeat: mocks.bridge.parkBeat.invoke.mock.calls.length,
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
    const reviewedOutput = document.querySelector('[data-studio-director-reviewed-output]');
    expect(reviewedOutput).toContainElement(screen.getByTestId('studio-proposal-proposal_1'));
    expect(reviewedOutput).toContainElement(screen.getByTestId('studio-reference-reference_1'));
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

  it('refuses an open handoff whose shot identities are absent from the active project', async () => {
    mocks.bridge.listReferenceGenerationHandoffs.invoke.mockResolvedValue(ok([handoff()]));
    renderStudio();
    const card = within(await screen.findByTestId('studio-handoff-handoff_open'));
    fireEvent.click(card.getByRole('button', { name: 'conversation.creativeStudio.workspace.handoffs.review' }));

    expect(await screen.findByText('conversation.creativeStudio.workspace.controls.selectionNotPayable')).toBeVisible();
    expect(mocks.bridge.prepareSubmission.invoke).not.toHaveBeenCalled();
    expect(mocks.bridge.confirmSubmission.invoke).not.toHaveBeenCalled();
  });

  it('opens choices for an exact active-shot handoff without preparing paid work', async () => {
    mocks.bridge.getProject.invoke.mockResolvedValue(ok({ status: 'supported', project: projectWithHandoffShot() }));
    mocks.bridge.listReferenceGenerationHandoffs.invoke.mockResolvedValue(ok([handoff()]));
    renderStudio();
    const card = within(await screen.findByTestId('studio-handoff-handoff_open'));
    fireEvent.click(card.getByRole('button', { name: 'conversation.creativeStudio.workspace.handoffs.review' }));

    expect(await screen.findByTestId('studio-spend-gate')).toBeVisible();
    expect(screen.getByRole('button', { name: 'conversation.creativeStudio.workspace.gate.prepare' })).toBeEnabled();
    expect(mocks.bridge.prepareSubmission.invoke).not.toHaveBeenCalled();
    expect(mocks.bridge.confirmSubmission.invoke).not.toHaveBeenCalled();
  });

  it('preserves the complete reviewed per-choice graph while an unavailable cascade route leaves seed review open', async () => {
    const generativeProject = projectWithHandoffShot();
    const briefReference: StudioAssetV2 = {
      id: 'brief_ref',
      projectId: 'project_1',
      shotId: null,
      mediaKind: 'image',
      mimeType: 'image/png',
      managedAsset: { collection: 'imports', fileName: 'brief_ref.png' },
      byteSize: 16,
      sha256: 'b'.repeat(64),
      createdAt: '2026-01-01T00:00:00.000Z',
      briefReferenceRole: 'cast',
      briefReferenceLabel: 'Hero portrait',
    };
    generativeProject.assets[briefReference.id] = briefReference;
    seedWorkspaceDrafts({
      'gate.choices': {
        baseValue: '{}',
        value: JSON.stringify({
          'shot_3:seed_still': { generationCount: 2, referenceAssetId: 'brief_ref' },
          'shot_3:video_take': { generationCount: 3, referenceAssetId: null },
        }),
      },
    });
    mocks.bridge.getProject.invoke.mockResolvedValue(ok({ status: 'supported', project: generativeProject }));
    mocks.bridge.listRoutes.invoke.mockResolvedValue(
      ok({
        image: { status: 'ready', selected: null, selectedRoute: null, selectionIssue: null, options: [] },
        video: {
          status: 'unavailable',
          selected: null,
          selectedRoute: null,
          selectionIssue: { code: 'frame', aspectRatio: '16:9', resolution: '720p' },
          options: [],
        },
        catalogVersion: 'catalog_1',
      })
    );
    mocks.bridge.prepareSubmission.invoke.mockRejectedValueOnce(new Error('stop after request capture'));

    renderStudio();
    fireEvent.click(await screen.findByRole('row', { name: /Opening/ }));
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'conversation.creativeStudio.workspace.beatPanel.generation.generateSeed',
      })
    );

    expect(await screen.findByTestId('studio-spend-gate')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'conversation.creativeStudio.workspace.gate.prepare' }));
    await waitFor(() =>
      expect(mocks.bridge.prepareSubmission.invoke).toHaveBeenCalledWith({
        projectId: 'project_1',
        expectedRevision: 3,
        originReferenceHandoffId: null,
        baseChoices: [
          {
            shotId: 'shot_3',
            purpose: 'seed_still',
            generationCount: 2,
            referenceAssetId: 'brief_ref',
          },
        ],
        cascadeChoices: [
          {
            shotId: 'shot_3',
            purpose: 'video_take',
            generationCount: 3,
            referenceAssetId: null,
          },
        ],
      })
    );
    expect(mocks.bridge.confirmSubmission.invoke).not.toHaveBeenCalled();
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

  it('flushes Beat and Shot drafts in revisioned batches without exceeding the mutation limit', async () => {
    const initial = projectWithDraftBatch(17);
    const revision4 = { ...initial, revision: 4 };
    const revision5 = { ...initial, revision: 5 };
    const entries: Record<string, { baseValue: unknown; value: unknown }> = {};
    for (let index = 0; index < 17; index += 1) {
      entries[`beat.beat_${index}.action`] = {
        baseValue: `Action ${index + 1}`,
        value: `Revised action ${index + 1}`,
      };
      entries[`shot.shot_${index}.line`] = {
        baseValue: `Shot ${index + 1}`,
        value: `Revised shot ${index + 1}`,
      };
    }
    seedWorkspaceDrafts(entries);
    mocks.bridge.getProject.invoke
      .mockResolvedValueOnce(ok({ status: 'supported', project: initial }))
      .mockResolvedValueOnce(ok({ status: 'supported', project: revision4 }))
      .mockResolvedValue(ok({ status: 'supported', project: revision5 }));
    mocks.bridge.applyAuthoringBatch.invoke.mockResolvedValueOnce(commit(4)).mockResolvedValueOnce(commit(5));

    renderStudio();
    await screen.findByRole('heading', { name: 'Launch film' });
    let response: { saved: boolean } | undefined;
    await act(async () => {
      response = await mocks.closeHandlers.flushUnsavedWork?.();
    });

    expect(response).toEqual({ saved: true });
    expect(mocks.bridge.applyAuthoringBatch.invoke).toHaveBeenCalledTimes(2);
    expect(mocks.bridge.applyAuthoringBatch.invoke.mock.calls[0]?.[0]).toMatchObject({
      projectId: 'project_1',
      expectedRevision: 3,
    });
    expect(mocks.bridge.applyAuthoringBatch.invoke.mock.calls[0]?.[0].operations).toHaveLength(32);
    expect(mocks.bridge.applyAuthoringBatch.invoke.mock.calls[1]?.[0]).toMatchObject({
      projectId: 'project_1',
      expectedRevision: 4,
    });
    expect(mocks.bridge.applyAuthoringBatch.invoke.mock.calls[1]?.[0].operations).toHaveLength(2);
    await waitFor(() => expect(mocks.closeHandlers.hasUnsavedWork?.()).toEqual({ dirtyDraftCount: 0 }));
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

    await waitFor(() => expect(mocks.bridge.getProject.invoke).toHaveBeenCalledTimes(2));
    expect(screen.getAllByText('conversation.creativeStudio.workspace.controls.routeStatus.unavailable')).toHaveLength(
      2
    );
    expect(mocks.bridge.listRoutes.invoke).toHaveBeenCalledTimes(1);
  });

  it('renders not-found and storage-failure load states without mounting a workspace owner', async () => {
    mocks.bridge.getProject.invoke.mockResolvedValue(ok({ status: 'not_found', projectId: 'project_1' }));
    const first = renderStudio();
    expect(await screen.findByText('conversation.creativeStudio.workspace.project.notFound')).toBeVisible();
    expect(document.querySelector('[data-studio-director-conversation-owner]')).toBeNull();
    first.unmount();

    mocks.bridge.getProject.invoke.mockRejectedValue(new Error('offline'));
    renderStudio();
    expect(await screen.findByRole('alert')).toHaveTextContent('conversation.creativeStudio.workspace.errors.storage');
    expect(document.querySelector('[data-studio-director-conversation-owner]')).toBeNull();
  });

  it('surfaces independent snapshot failures while preserving the supported project shell', async () => {
    mocks.bridge.listProposals.invoke.mockResolvedValue({
      ok: false,
      error: { code: 'storage_error', messageKey: 'native.proposalsFailed' },
    });
    mocks.bridge.listReferenceRequests.invoke.mockRejectedValue(new Error('request list offline'));
    mocks.bridge.listReferenceGenerationHandoffs.invoke.mockResolvedValue({
      ok: false,
      error: { code: 'storage_error', messageKey: 'native.handoffsFailed' },
    });
    mocks.bridge.getWorkspaceStatus.invoke.mockRejectedValue(new Error('workspace offline'));
    mocks.bridge.getChainStatus.invoke.mockResolvedValue({
      ok: false,
      error: { code: 'storage_error', messageKey: 'native.chainFailed' },
    });
    mocks.bridge.listRoutes.invoke.mockResolvedValue({
      ok: false,
      error: { code: 'storage_error', messageKey: 'native.routesFailed' },
    });

    renderStudio();

    expect(await screen.findByRole('heading', { name: 'Launch film' })).toBeVisible();
    expect(screen.getByText('native.proposalsFailed')).toBeVisible();
    expect(screen.getAllByText('conversation.creativeStudio.workspace.errors.storage')).toHaveLength(2);
    expect(screen.getAllByText('conversation.creativeStudio.workspace.controls.routeStatus.unavailable')).toHaveLength(
      2
    );
    expect(mocks.bridge.listProposals.invoke).toHaveBeenCalledTimes(1);
    expect(mocks.bridge.listReferenceRequests.invoke).toHaveBeenCalledTimes(1);
    expect(mocks.bridge.listReferenceGenerationHandoffs.invoke).toHaveBeenCalledTimes(1);
    expect(mocks.bridge.getWorkspaceStatus.invoke).toHaveBeenCalledTimes(1);
    expect(mocks.bridge.getChainStatus.invoke).toHaveBeenCalledTimes(1);
    expect(mocks.bridge.listRoutes.invoke).toHaveBeenCalledTimes(1);
  });

  it('handles the opposite asynchronous snapshot failures without combining their authority', async () => {
    mocks.bridge.listProposals.invoke.mockRejectedValue(new Error('proposal list offline'));
    mocks.bridge.listReferenceRequests.invoke.mockResolvedValue(ok([]));
    mocks.bridge.listReferenceGenerationHandoffs.invoke.mockRejectedValue(new Error('handoff list offline'));
    mocks.bridge.getWorkspaceStatus.invoke.mockResolvedValue({
      ok: false,
      error: { code: 'storage_error', messageKey: 'native.workspaceFailed' },
    });
    mocks.bridge.getChainStatus.invoke.mockRejectedValue(new Error('chain offline'));
    mocks.bridge.listRoutes.invoke.mockRejectedValue(new Error('route list offline'));

    renderStudio();

    expect(await screen.findByRole('heading', { name: 'Launch film' })).toBeVisible();
    expect(screen.getAllByText('conversation.creativeStudio.workspace.errors.storage').length).toBeGreaterThan(0);
    expect(screen.getByText('native.workspaceFailed')).toBeVisible();
    expect(screen.getAllByText('conversation.creativeStudio.workspace.controls.routeStatus.unavailable')).toHaveLength(
      2
    );
    expect(mocks.bridge.listProposals.invoke).toHaveBeenCalledTimes(1);
    expect(mocks.bridge.listReferenceRequests.invoke).toHaveBeenCalledTimes(1);
    expect(mocks.bridge.listReferenceGenerationHandoffs.invoke).toHaveBeenCalledTimes(1);
  });

  it('ignores native events for another project identity', async () => {
    renderStudio();
    await screen.findByRole('heading', { name: 'Launch film' });
    const counts = {
      project: mocks.bridge.getProject.invoke.mock.calls.length,
      proposals: mocks.bridge.listProposals.invoke.mock.calls.length,
      references: mocks.bridge.listReferenceRequests.invoke.mock.calls.length,
      handoffs: mocks.bridge.listReferenceGenerationHandoffs.invoke.mock.calls.length,
    };

    act(() => {
      mocks.listeners.projectUpdated?.({ projectId: 'project_other' });
      mocks.listeners.proposalUpdated?.({ projectId: 'project_other' });
      mocks.listeners.referenceUpdated?.({ projectId: 'project_other' });
    });

    expect(mocks.bridge.getProject.invoke).toHaveBeenCalledTimes(counts.project);
    expect(mocks.bridge.listProposals.invoke).toHaveBeenCalledTimes(counts.proposals);
    expect(mocks.bridge.listReferenceRequests.invoke).toHaveBeenCalledTimes(counts.references);
    expect(mocks.bridge.listReferenceGenerationHandoffs.invoke).toHaveBeenCalledTimes(counts.handoffs);
  });

  it('keeps every explicit refetch inert when no project identity is bound', async () => {
    render(<HookProbe />);
    expect(screen.getByTestId('hook-state')).toHaveTextContent('idle');

    await act(async () => {
      expect(await latestHookResult?.refetchProject()).toBeNull();
      await latestHookResult?.refetchProposals();
      await latestHookResult?.refetchReferences();
      await latestHookResult?.refetchWorkspace();
      expect(await latestHookResult?.refetchRoutes()).toBe(false);
      await latestHookResult?.refetchAll();
    });

    expect(mocks.bridge.getProject.invoke).not.toHaveBeenCalled();
    expect(mocks.bridge.listProposals.invoke).not.toHaveBeenCalled();
    expect(mocks.bridge.listReferenceRequests.invoke).not.toHaveBeenCalled();
    expect(mocks.bridge.getWorkspaceStatus.invoke).not.toHaveBeenCalled();
    expect(mocks.bridge.listRoutes.invoke).not.toHaveBeenCalled();
  });

  it('routes projected recovery choices through exact revisioned providers', async () => {
    const projects = [3, 4, 5].map(projectWithRecovery);
    mocks.bridge.getProject.invoke
      .mockResolvedValueOnce(ok({ status: 'supported', project: projects[0]! }))
      .mockResolvedValueOnce(ok({ status: 'supported', project: projects[1]! }))
      .mockResolvedValue(ok({ status: 'supported', project: projects[2]! }));
    for (const revision of [3, 4, 5]) {
      mocks.bridge.getWorkspaceStatus.invoke.mockResolvedValueOnce(ok(recoveryStatus(revision)));
      mocks.bridge.getChainStatus.invoke.mockResolvedValueOnce(ok(chainStatus(revision)));
    }
    mocks.bridge.applyAuthoringBatch.invoke.mockResolvedValue(commit(4));
    mocks.bridge.selectTake.invoke.mockResolvedValue(commit(5));

    renderStudio();
    const recoveryRow = await screen.findByRole('row', {
      name: /Recovery Beat/,
    });
    fireEvent.click(recoveryRow);

    fireEvent.click(
      await screen.findByRole('button', {
        name: /conversation\.creativeStudio\.workspace\.beatPanel\.recovery\.chooseImage/,
      })
    );
    await waitFor(() =>
      expect(mocks.bridge.applyAuthoringBatch.invoke).toHaveBeenCalledWith({
        projectId: 'project_1',
        expectedRevision: 3,
        operations: [{ kind: 'set_seed_still', shotId: 'upstream_seed', assetId: 'seed_asset' }],
      })
    );

    fireEvent.click(
      await screen.findByRole('button', {
        name: /conversation\.creativeStudio\.workspace\.beatPanel\.recovery\.chooseVideo/,
      })
    );
    await waitFor(() =>
      expect(mocks.bridge.selectTake.invoke).toHaveBeenCalledWith({
        projectId: 'project_1',
        expectedRevision: 4,
        shotId: 'upstream_take',
        assetId: 'take_asset',
      })
    );

    expect(mocks.bridge.prepareSubmission.invoke).not.toHaveBeenCalled();
    expect(mocks.bridge.confirmSubmission.invoke).not.toHaveBeenCalled();
  });

  it('routes projected recovery retry and cancellation through exact revisioned providers', async () => {
    const projects = [3, 4, 5].map(projectWithRecovery);
    mocks.bridge.getProject.invoke
      .mockResolvedValueOnce(ok({ status: 'supported', project: projects[0]! }))
      .mockResolvedValueOnce(ok({ status: 'supported', project: projects[1]! }))
      .mockResolvedValue(ok({ status: 'supported', project: projects[2]! }));
    for (const revision of [3, 4, 5]) {
      mocks.bridge.getWorkspaceStatus.invoke.mockResolvedValueOnce(ok(recoveryStatus(revision)));
      mocks.bridge.getChainStatus.invoke.mockResolvedValueOnce(ok(chainStatus(revision)));
    }
    mocks.bridge.retryConditioningFrame.invoke.mockResolvedValue(commit(4));
    mocks.bridge.cancelWaitingCascade.invoke.mockResolvedValue(commit(5));

    renderStudio();
    const recoveryRow = await screen.findByRole('row', {
      name: /Recovery Beat/,
    });
    fireEvent.click(recoveryRow);

    fireEvent.click(
      await screen.findByRole('button', {
        name: 'conversation.creativeStudio.workspace.beatPanel.recovery.retryFree',
      })
    );
    await waitFor(() =>
      expect(mocks.bridge.retryConditioningFrame.invoke).toHaveBeenCalledWith({
        projectId: 'project_1',
        expectedRevision: 3,
        dependentShotId: 'dependent_take',
      })
    );

    fireEvent.click(
      await screen.findByRole('button', {
        name: 'conversation.creativeStudio.workspace.beatPanel.recovery.cancelWaiting',
      })
    );
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'conversation.creativeStudio.workspace.beatPanel.recovery.cancelConfirm',
      })
    );
    await waitFor(() =>
      expect(mocks.bridge.cancelWaitingCascade.invoke).toHaveBeenCalledWith({
        projectId: 'project_1',
        expectedRevision: 4,
        dependentShotId: 'dependent_take',
      })
    );
    expect(mocks.bridge.prepareSubmission.invoke).not.toHaveBeenCalled();
    expect(mocks.bridge.confirmSubmission.invoke).not.toHaveBeenCalled();
  });

  it('keeps seed import cancellation inert and refreshes exact authority after an imported receipt', async () => {
    const initial = projectWithRecovery(3);
    const imported = projectWithRecovery(4);
    const importedSeed = recoveryAsset('imported_seed', 'upstream_seed', 'image');
    imported.assets[importedSeed.id] = importedSeed;
    imported.shots.upstream_seed!.assetIds.push(importedSeed.id);
    mocks.bridge.getProject.invoke
      .mockResolvedValueOnce(ok({ status: 'supported', project: initial }))
      .mockResolvedValue(ok({ status: 'supported', project: imported }));
    mocks.bridge.getWorkspaceStatus.invoke
      .mockResolvedValueOnce(ok(recoveryStatus(3)))
      .mockResolvedValue(ok(recoveryStatus(4)));
    mocks.bridge.getChainStatus.invoke.mockResolvedValueOnce(ok(chainStatus(3))).mockResolvedValue(ok(chainStatus(4)));

    renderStudio();
    fireEvent.click(await screen.findByRole('row', { name: /Recovery Beat/ }));
    const seedCard = document.querySelector<HTMLElement>('article[data-shot-id="upstream_seed"]');
    expect(seedCard).not.toBeNull();
    const importButton = within(seedCard!).getByRole('button', {
      name: 'conversation.creativeStudio.workspace.beatPanel.seeds.import',
    });

    fireEvent.click(importButton);
    await waitFor(() =>
      expect(mocks.bridge.importSeedStill.invoke).toHaveBeenLastCalledWith({
        projectId: 'project_1',
        expectedRevision: 3,
        shotId: 'upstream_seed',
      })
    );
    expect(mocks.bridge.getProject.invoke).toHaveBeenCalledTimes(1);
    expect(mocks.bridge.getWorkspaceStatus.invoke).toHaveBeenCalledTimes(1);
    expect(mocks.bridge.getChainStatus.invoke).toHaveBeenCalledTimes(1);

    mocks.bridge.importSeedStill.invoke.mockResolvedValueOnce(
      ok({ status: 'imported' as const, assetId: 'imported_seed', projectRevision: 4 })
    );
    fireEvent.click(importButton);
    await waitFor(() => expect(mocks.bridge.importSeedStill.invoke).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(mocks.bridge.getProject.invoke).toHaveBeenCalledTimes(2));
    expect(mocks.bridge.getWorkspaceStatus.invoke).toHaveBeenCalledTimes(2);
    expect(mocks.bridge.getChainStatus.invoke).toHaveBeenCalledTimes(2);
    expect(mocks.bridge.importSeedStill.invoke).toHaveBeenLastCalledWith({
      projectId: 'project_1',
      expectedRevision: 3,
      shotId: 'upstream_seed',
    });
    expect(document.querySelector('[data-asset-id="imported_seed"]')).not.toBeNull();
  });

  it('routes every captured Beat Panel edit and lifecycle action through revision-pinned providers', async () => {
    const authority = projectWithDraftBatch(1);
    let revision = authority.revision;
    mocks.bridge.getProject.invoke.mockImplementation(async () =>
      ok({ status: 'supported' as const, project: { ...authority, revision } })
    );
    mocks.bridge.getWorkspaceStatus.invoke.mockImplementation(async () => ok(workspaceStatus(revision)));
    mocks.bridge.getChainStatus.invoke.mockImplementation(async () => ok(chainStatus(revision)));
    const nextCommit = async () => {
      revision += 1;
      return commit(revision);
    };
    mocks.bridge.applyAuthoringBatch.invoke.mockImplementation(nextCommit);
    mocks.bridge.selectTake.invoke.mockImplementation(nextCommit);
    mocks.bridge.parkTake.invoke.mockImplementation(nextCommit);
    mocks.bridge.addAlternateTake.invoke.mockImplementation(nextCommit);
    mocks.bridge.restoreTake.invoke.mockImplementation(nextCommit);
    mocks.bridge.parkShot.invoke.mockImplementation(nextCommit);
    mocks.bridge.parkBeat.invoke.mockImplementation(nextCommit);

    renderStudio();
    await screen.findByRole('heading', { name: 'Launch film' });
    await waitFor(() => expect(mocks.beatPanelActions).not.toBeNull());
    const actions = capturedBeatPanelActions();

    const duplicateUpdates = [
      { shotId: 'shot_0', changes: { line: 'First duplicate' } },
      { shotId: 'shot_0', changes: { line: 'Second duplicate' } },
    ] as const;
    expect(await actions.saveShot(duplicateUpdates)).toBe(false);
    const oversizedUpdates = Array.from({ length: 33 }, (_, index) => ({
      shotId: `shot_${index}`,
      changes: { line: `Shot ${index}` },
    })) as unknown as Parameters<BeatPanelActions['saveShot']>[0];
    expect(await actions.saveShot(oversizedUpdates)).toBe(false);
    expect(mocks.bridge.applyAuthoringBatch.invoke).not.toHaveBeenCalled();

    await expectSuccessfulBeatPanelAction(() =>
      actions.saveBeat('beat_0', { action: 'Revised action', look: 'Moonlit', targetSeconds: 8 })
    );
    await expectSuccessfulBeatPanelAction(() =>
      actions.saveShot([
        {
          shotId: 'shot_0',
          changes: { line: 'Revised line', narration: 'Voice-over', onScreenText: 'Launch', durationSeconds: 8 },
        },
      ])
    );
    await expectSuccessfulBeatPanelAction(() => actions.setHardCut('shot_0', true));
    await expectSuccessfulBeatPanelAction(() => actions.setSeedStill('shot_0', 'seed_asset'));
    await expectSuccessfulBeatPanelAction(() => actions.trimShot('shot_0', 1, 2));
    await expectSuccessfulBeatPanelAction(() => actions.reorderShots('beat_0', ['shot_1', 'shot_0']));
    await expectSuccessfulBeatPanelAction(() => actions.redetachLine('shot_0', 'Detached line'));
    await expectSuccessfulBeatPanelAction(() => actions.restoreLine('shot_0', 'history_1'));
    await expectSuccessfulBeatPanelAction(() => actions.selectTake('shot_0', 'take_1'));
    await expectSuccessfulBeatPanelAction(() => actions.parkTake('shot_0', 'take_1'));
    await expectSuccessfulBeatPanelAction(() => actions.addAlternateTake('shot_0', 'take_2'));
    await expectSuccessfulBeatPanelAction(() => actions.restoreTake('shot_0', 'take_1'));
    await expectSuccessfulBeatPanelAction(() => actions.parkShot('shot_0'));
    await expectSuccessfulBeatPanelAction(() => actions.parkBeat('beat_0'));

    expect(mocks.bridge.applyAuthoringBatch.invoke.mock.calls.map(([request]) => request)).toEqual([
      {
        projectId: 'project_1',
        expectedRevision: 3,
        operations: [
          {
            kind: 'edit_beat',
            beatId: 'beat_0',
            changes: { action: 'Revised action', look: 'Moonlit', targetSeconds: 8 },
          },
        ],
      },
      {
        projectId: 'project_1',
        expectedRevision: 4,
        operations: [
          {
            kind: 'edit_shot',
            shotId: 'shot_0',
            changes: { line: 'Revised line', narration: 'Voice-over', onScreenText: 'Launch', durationSeconds: 8 },
          },
        ],
      },
      {
        projectId: 'project_1',
        expectedRevision: 5,
        operations: [{ kind: 'set_hard_cut', shotId: 'shot_0', hardCut: true }],
      },
      {
        projectId: 'project_1',
        expectedRevision: 6,
        operations: [{ kind: 'set_seed_still', shotId: 'shot_0', assetId: 'seed_asset' }],
      },
      {
        projectId: 'project_1',
        expectedRevision: 7,
        operations: [{ kind: 'trim_shot', shotId: 'shot_0', trimInSeconds: 1, trimOutSeconds: 2 }],
      },
      {
        projectId: 'project_1',
        expectedRevision: 8,
        operations: [{ kind: 'reorder_shots', beatId: 'beat_0', shotOrder: ['shot_1', 'shot_0'] }],
      },
      {
        projectId: 'project_1',
        expectedRevision: 9,
        operations: [{ kind: 'redetach_line', shotId: 'shot_0', line: 'Detached line' }],
      },
      {
        projectId: 'project_1',
        expectedRevision: 10,
        operations: [{ kind: 'restore_line', shotId: 'shot_0', historyEntryId: 'history_1' }],
      },
    ]);
    expect(mocks.bridge.selectTake.invoke).toHaveBeenCalledWith({
      projectId: 'project_1',
      expectedRevision: 11,
      shotId: 'shot_0',
      assetId: 'take_1',
    });
    expect(mocks.bridge.parkTake.invoke).toHaveBeenCalledWith({
      projectId: 'project_1',
      expectedRevision: 12,
      shotId: 'shot_0',
      assetId: 'take_1',
    });
    expect(mocks.bridge.addAlternateTake.invoke).toHaveBeenCalledWith({
      projectId: 'project_1',
      expectedRevision: 13,
      shotId: 'shot_0',
      assetId: 'take_2',
    });
    expect(mocks.bridge.restoreTake.invoke).toHaveBeenCalledWith({
      projectId: 'project_1',
      expectedRevision: 14,
      shotId: 'shot_0',
      assetId: 'take_1',
    });
    expect(mocks.bridge.parkShot.invoke).toHaveBeenCalledWith({
      projectId: 'project_1',
      expectedRevision: 15,
      shotId: 'shot_0',
    });
    expect(mocks.bridge.parkBeat.invoke).toHaveBeenCalledWith({
      projectId: 'project_1',
      expectedRevision: 16,
      beatId: 'beat_0',
    });
    expect(revision).toBe(17);
  });

  it('projects malformed topology defensively through both render and close-save traversal', async () => {
    const malformed = projectWithDraftBatch(1);
    malformed.beatOrder.unshift('missing_beat');
    malformed.beats.beat_0!.shotOrder.unshift('missing_shot');
    mocks.bridge.getProject.invoke.mockResolvedValue(ok({ status: 'supported', project: malformed }));

    renderStudio();
    await screen.findByRole('heading', { name: 'Launch film' });
    let saved: { saved: boolean } | undefined;
    await act(async () => {
      saved = await mocks.closeHandlers.flushUnsavedWork?.();
    });

    expect(saved).toEqual({ saved: true });
    expect(mocks.bridge.applyAuthoringBatch.invoke).not.toHaveBeenCalled();
  });

  it('sorts captured cast and look references deterministically by label and asset identity', async () => {
    const referenced = projectWithHandoffShot();
    referenced.rules = [{ id: 'rule_null', text: 'Keep the launch clean', predicate: null }];
    const briefReference = (
      id: string,
      label: string,
      role: NonNullable<StudioAssetV2['briefReferenceRole']>
    ): StudioAssetV2 => ({
      id,
      projectId: 'project_1',
      shotId: null,
      mediaKind: 'image',
      mimeType: 'image/png',
      managedAsset: { collection: 'imports', fileName: `${id}.png` },
      byteSize: 16,
      sha256: 'c'.repeat(64),
      createdAt: '2026-01-01T00:00:00.000Z',
      briefReferenceRole: role,
      briefReferenceLabel: label,
    });
    referenced.assets = {
      zulu: briefReference('ref_z', 'Zulu', 'look'),
      beta: briefReference('ref_b', 'Alpha', 'look'),
      alpha: briefReference('ref_a', 'Alpha', 'cast'),
      duplicate: briefReference('ref_a', 'Alpha', 'cast'),
    };
    mocks.bridge.getProject.invoke.mockResolvedValue(ok({ status: 'supported', project: referenced }));

    renderStudio();
    await screen.findByRole('heading', { name: 'Launch film' });
    await waitFor(() => expect(mocks.beatPanelBriefReferenceOptions).not.toBeNull());

    expect(mocks.beatPanelBriefReferenceOptions).toEqual([
      { assetId: 'ref_a', label: 'Alpha' },
      { assetId: 'ref_a', label: 'Alpha' },
      { assetId: 'ref_b', label: 'Alpha' },
      { assetId: 'ref_z', label: 'Zulu' },
    ]);
  });

  it('focuses the Director toggle from both captured reviewed-request actions', async () => {
    mocks.bridge.getProject.invoke.mockResolvedValue(ok({ status: 'supported', project: projectWithHandoffShot() }));
    renderStudio();
    await screen.findByRole('heading', { name: 'Launch film' });
    await waitFor(() => expect(mocks.beatPanelActions).not.toBeNull());
    const actions = capturedBeatPanelActions();
    const toggle = document.createElement('button');
    toggle.dataset.studioDirectorToggle = '';
    toggle.setAttribute('aria-expanded', 'false');
    document.querySelector('[data-studio-workspace]')?.append(toggle);
    const click = vi.spyOn(toggle, 'click');

    act(() => actions.requestReviewedRederive('shot_3'));
    await waitFor(() => expect(document.activeElement).toBe(toggle));
    expect(click).toHaveBeenCalledTimes(1);
    expect(screen.getByText('conversation.creativeStudio.workspace.beatPanel.directorRequestHint')).toBeVisible();

    toggle.setAttribute('aria-expanded', 'true');
    act(() => actions.requestResplit('beat_1'));
    await waitFor(() => expect(document.activeElement).toBe(toggle));
    expect(click).toHaveBeenCalledTimes(1);
  });

  it('keeps captured seed imports fail-closed across native, transport, stale, and concurrent outcomes', async () => {
    const authority = projectWithDraftBatch(1);
    mocks.bridge.getProject.invoke.mockResolvedValue(ok({ status: 'supported', project: authority }));
    renderStudio();
    await screen.findByRole('heading', { name: 'Launch film' });
    await waitFor(() => expect(mocks.beatPanelActions).not.toBeNull());
    const actions = capturedBeatPanelActions();

    mocks.bridge.importSeedStill.invoke.mockResolvedValueOnce({
      ok: false,
      error: { code: 'storage_error', messageKey: 'native.importFailed' },
    });
    await expect(invokeBeatPanelImport(() => actions.importSeedStill('shot_0'))).resolves.toBe('failed');
    expect(await screen.findByText('native.importFailed')).toBeVisible();

    mocks.bridge.importSeedStill.invoke.mockRejectedValueOnce(new Error('picker offline'));
    await expect(invokeBeatPanelImport(() => actions.importSeedStill('shot_0'))).resolves.toBe('failed');
    expect(await screen.findByText('conversation.creativeStudio.workspace.errors.storage')).toBeVisible();

    mocks.bridge.importSeedStill.invoke.mockResolvedValueOnce(
      ok({ status: 'imported' as const, assetId: 'stale_seed', projectRevision: 4 })
    );
    await expect(invokeBeatPanelImport(() => actions.importSeedStill('shot_0'))).resolves.toBe('failed');
    expect(mocks.bridge.getProject.invoke).toHaveBeenCalledTimes(2);

    mocks.bridge.importSeedStill.invoke.mockClear();
    const pendingImport = deferred<ReturnType<typeof ok>>();
    mocks.bridge.importSeedStill.invoke.mockReturnValueOnce(pendingImport.promise);
    let firstImport!: Promise<'cancelled' | 'imported' | 'failed'>;
    act(() => {
      firstImport = actions.importSeedStill('shot_0');
    });
    await waitFor(() => expect(mocks.bridge.importSeedStill.invoke).toHaveBeenCalledTimes(1));
    await expect(invokeBeatPanelImport(() => actions.importSeedStill('shot_0'))).resolves.toBe('failed');
    expect(mocks.bridge.importSeedStill.invoke).toHaveBeenCalledTimes(1);
    await act(async () => {
      pendingImport.resolve(ok({ status: 'cancelled' as const }));
      await expect(firstImport).resolves.toBe('cancelled');
    });
  });

  it('rejects malformed reviewed choice graphs at the captured Beat Panel boundary', async () => {
    mocks.bridge.getProject.invoke.mockResolvedValue(ok({ status: 'supported', project: projectWithHandoffShot() }));
    renderStudio();
    await screen.findByRole('heading', { name: 'Launch film' });
    await waitFor(() => expect(mocks.beatPanelActions).not.toBeNull());
    const actions = capturedBeatPanelActions();
    const validChoices = () =>
      [
        { shotId: 'shot_3', purpose: 'seed_still' as const, generationCount: 1 as const, referenceAssetId: null },
        { shotId: 'shot_3', purpose: 'video_take' as const, generationCount: 1 as const, referenceAssetId: null },
      ] as const;

    act(() => actions.reviewShot('missing_shot', validChoices()));
    act(() =>
      actions.reviewShot('shot_3', [validChoices()[0]] as unknown as Parameters<BeatPanelActions['reviewShot']>[1])
    );
    for (const choices of [
      [{ ...validChoices()[0], shotId: 'shot_other' }, validChoices()[1]],
      [{ ...validChoices()[0], purpose: 'video_take' as const }, validChoices()[1]],
      [{ ...validChoices()[0], generationCount: 1.5 }, validChoices()[1]],
      [{ ...validChoices()[0], generationCount: 0 }, validChoices()[1]],
      [{ ...validChoices()[0], generationCount: 5 }, validChoices()[1]],
      [validChoices()[0], { ...validChoices()[1], referenceAssetId: 'brief_ref' }],
      [{ ...validChoices()[0], referenceAssetId: 'unknown_reference' }, validChoices()[1]],
    ]) {
      act(() => actions.reviewShot('shot_3', choices as unknown as Parameters<BeatPanelActions['reviewShot']>[1]));
    }

    expect(await screen.findByText('conversation.creativeStudio.workspace.controls.selectionNotPayable')).toBeVisible();
    expect(mocks.bridge.prepareSubmission.invoke).not.toHaveBeenCalled();
    expect(mocks.bridge.confirmSubmission.invoke).not.toHaveBeenCalled();
  });

  it('reports deterministic failures from each reviewed-output action without auto-retrying', async () => {
    mocks.bridge.listProposals.invoke.mockResolvedValue(ok([proposal()]));
    mocks.bridge.listReferenceRequests.invoke.mockResolvedValue(ok([referenceRequest()]));
    mocks.bridge.listReferenceGenerationHandoffs.invoke.mockResolvedValue(ok([handoff()]));
    mocks.bridge.acceptProposal.invoke.mockResolvedValue({
      ok: false,
      error: { code: 'stale_revision', messageKey: 'native.acceptFailed' },
    });
    mocks.bridge.rejectProposal.invoke.mockRejectedValue(new Error('offline'));
    mocks.bridge.decideReferenceRequest.invoke.mockResolvedValue({
      ok: false,
      error: { code: 'stale_revision', messageKey: 'native.referenceFailed' },
    });
    mocks.bridge.dismissReferenceGenerationHandoff.invoke.mockRejectedValue(new Error('offline'));
    renderStudio();

    fireEvent.click(
      await screen.findByRole('button', { name: 'conversation.creativeStudio.workspace.proposals.accept' })
    );
    expect(await screen.findByText('native.acceptFailed')).toBeVisible();
    expect(mocks.bridge.acceptProposal.invoke).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'conversation.creativeStudio.workspace.proposals.reject' }));
    expect(await screen.findByText('conversation.creativeStudio.workspace.errors.storage')).toBeVisible();
    expect(mocks.bridge.rejectProposal.invoke).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'conversation.creativeStudio.workspace.references.reject' }));
    expect(await screen.findByText('native.referenceFailed')).toBeVisible();
    expect(mocks.bridge.decideReferenceRequest.invoke).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'conversation.creativeStudio.workspace.handoffs.dismiss' }));
    expect(await screen.findByText('conversation.creativeStudio.workspace.errors.storage')).toBeVisible();
    expect(mocks.bridge.dismissReferenceGenerationHandoff.invoke).toHaveBeenCalledTimes(1);
  });

  it('refuses structural proposal acceptance while local Shot drafts are unsaved', async () => {
    const draftedProject = projectWithDraftBatch(1);
    seedWorkspaceDrafts({
      'shot.shot_0.line': { baseValue: 'Shot 1', value: 'Unsaved local line' },
    });
    mocks.bridge.getProject.invoke.mockResolvedValue(ok({ status: 'supported', project: draftedProject }));
    mocks.bridge.listProposals.invoke.mockResolvedValue(ok([proposal()]));

    renderStudio();

    const accept = await screen.findByRole('button', {
      name: 'conversation.creativeStudio.workspace.proposals.accept',
    });
    expect(accept).toBeDisabled();
    expect(screen.getByText('conversation.creativeStudio.workspace.proposals.saveBeforeApply')).toBeVisible();
    fireEvent.click(accept);
    expect(mocks.bridge.acceptProposal.invoke).not.toHaveBeenCalled();
    expect(
      screen.getByRole('button', { name: 'conversation.creativeStudio.workspace.proposals.reject' })
    ).toBeEnabled();
  });

  it('keeps an independent rule-pin proposal actionable while local Shot drafts are unsaved', async () => {
    const draftedProject = projectWithDraftBatch(1);
    const ruleProposal = pinRuleProposal();
    seedWorkspaceDrafts({
      'shot.shot_0.line': { baseValue: 'Shot 1', value: 'Unsaved local line' },
    });
    mocks.bridge.getProject.invoke.mockResolvedValue(ok({ status: 'supported', project: draftedProject }));
    mocks.bridge.listProposals.invoke.mockResolvedValueOnce(ok([ruleProposal])).mockResolvedValue(ok([]));
    mocks.bridge.acceptProposal.invoke.mockResolvedValue(
      ok({
        proposal: { ...ruleProposal, status: 'accepted', decidedAt: '2026-01-01T00:00:05.000Z' },
        project: draftedProject,
        applied: true,
      })
    );

    renderStudio();
    const accept = await screen.findByRole('button', {
      name: 'conversation.creativeStudio.workspace.proposals.accept',
    });
    expect(accept).toBeEnabled();
    fireEvent.click(accept);

    await waitFor(() =>
      expect(mocks.bridge.acceptProposal.invoke).toHaveBeenCalledWith({
        projectId: 'project_1',
        proposalId: 'proposal_rule',
      })
    );
    expect(mocks.closeHandlers.hasUnsavedWork?.()).toEqual({ dirtyDraftCount: 1 });
  });

  it('removes a revision-stale proposal after a refused acceptance refreshes project authority', async () => {
    const current = project();
    const advanced = { ...project(), revision: 4 };
    mocks.bridge.getProject.invoke
      .mockResolvedValueOnce(ok({ status: 'supported', project: current }))
      .mockResolvedValue(ok({ status: 'supported', project: advanced }));
    mocks.bridge.listProposals.invoke.mockResolvedValue(ok([proposal()]));
    mocks.bridge.getWorkspaceStatus.invoke
      .mockResolvedValueOnce(ok(workspaceStatus(3)))
      .mockResolvedValue(ok(workspaceStatus(4)));
    mocks.bridge.getChainStatus.invoke.mockResolvedValueOnce(ok(chainStatus(3))).mockResolvedValue(ok(chainStatus(4)));
    mocks.bridge.acceptProposal.invoke.mockResolvedValue({
      ok: false,
      error: { code: 'stale_revision', messageKey: 'native.acceptFailed' },
    });
    renderStudio();

    fireEvent.click(
      await screen.findByRole('button', { name: 'conversation.creativeStudio.workspace.proposals.accept' })
    );

    expect(await screen.findByText('native.acceptFailed')).toBeVisible();
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'conversation.creativeStudio.workspace.proposals.accept' })
      ).toBeNull()
    );
    expect(mocks.bridge.getProject.invoke).toHaveBeenCalledTimes(2);
    expect(mocks.bridge.listProposals.invoke).toHaveBeenCalledTimes(2);
    expect(mocks.bridge.getWorkspaceStatus.invoke).toHaveBeenCalledTimes(2);
    expect(mocks.bridge.getChainStatus.invoke).toHaveBeenCalledTimes(2);
  });

  it('keeps a setting draft dirty when the post-commit snapshot is older than the commit receipt', async () => {
    mocks.bridge.getProject.invoke.mockResolvedValue(ok({ status: 'supported', project: project() }));
    renderStudio();
    const name = await screen.findByLabelText('conversation.creativeStudio.workspace.controls.name');
    fireEvent.change(name, { target: { value: 'Awaiting durable refresh' } });
    fireEvent.click(
      screen.getByRole('button', { name: 'conversation.creativeStudio.workspace.controls.saveSettings' })
    );

    expect(await screen.findByText('conversation.creativeStudio.workspace.errors.storage')).toBeVisible();
    expect(name).toHaveValue('Awaiting durable refresh');
    expect(mocks.bridge.editProject.invoke).toHaveBeenCalledTimes(1);
    expect(mocks.bridge.getWorkspaceStatus.invoke).toHaveBeenCalledTimes(1);
  });

  it('stops a chained close-save when another writer advances past the commit receipt', async () => {
    seedWorkspaceDrafts({
      'settings.name': { baseValue: 'Launch film', value: 'Saved local name' },
      'brief.text': { baseValue: 'A small launch film.', value: 'Unsaved local Brief.' },
    });
    const concurrentlyAdvanced = {
      ...project(),
      revision: 5,
      name: 'Saved local name',
      brief: 'A concurrent Brief.',
    };
    mocks.bridge.getProject.invoke
      .mockResolvedValueOnce(ok({ status: 'supported', project: project() }))
      .mockResolvedValue(ok({ status: 'supported', project: concurrentlyAdvanced }));

    renderStudio();
    await screen.findByRole('heading', { name: 'Launch film' });
    let saved: { saved: boolean } | undefined;
    await act(async () => {
      saved = await mocks.closeHandlers.flushUnsavedWork?.();
    });

    expect(saved).toEqual({ saved: false });
    expect(mocks.bridge.editProject.invoke).toHaveBeenCalledWith({
      projectId: 'project_1',
      expectedRevision: 3,
      changes: { name: 'Saved local name' },
    });
    expect(mocks.bridge.applyAuthoringBatch.invoke).not.toHaveBeenCalled();
    expect(mocks.closeHandlers.hasUnsavedWork?.()).toEqual({ dirtyDraftCount: 1 });
    expect(screen.getByLabelText('conversation.creativeStudio.workspace.controls.brief')).toHaveValue(
      'Unsaved local Brief.'
    );
  });

  it('pins a close-save chain when a project update lands during the receipt workspace refresh', async () => {
    seedWorkspaceDrafts({
      'settings.name': { baseValue: 'Launch film', value: 'Saved local name' },
      'brief.text': { baseValue: 'A small launch film.', value: 'Unsaved local Brief.' },
    });
    const committed = { ...project(), revision: 4, name: 'Saved local name' };
    const concurrentlyAdvanced = {
      ...committed,
      revision: 5,
      brief: 'A concurrent Brief.',
    };
    const stalledWorkspaceResult = ok(workspaceStatus(4));
    const stalledWorkspace = deferred<typeof stalledWorkspaceResult>();
    mocks.bridge.getProject.invoke
      .mockResolvedValueOnce(ok({ status: 'supported', project: project() }))
      .mockResolvedValueOnce(ok({ status: 'supported', project: committed }))
      .mockResolvedValue(ok({ status: 'supported', project: concurrentlyAdvanced }));
    mocks.bridge.getWorkspaceStatus.invoke
      .mockResolvedValueOnce(ok(workspaceStatus(3)))
      .mockReturnValueOnce(stalledWorkspace.promise)
      .mockResolvedValue(ok(workspaceStatus(5)));
    mocks.bridge.getChainStatus.invoke
      .mockResolvedValueOnce(ok(chainStatus(3)))
      .mockResolvedValueOnce(ok(chainStatus(4)))
      .mockResolvedValue(ok(chainStatus(5)));

    renderStudio();
    await screen.findByRole('heading', { name: 'Launch film' });
    let flushPromise: Promise<{ saved: boolean }> | undefined;
    act(() => {
      flushPromise = mocks.closeHandlers.flushUnsavedWork?.();
    });
    expect(flushPromise).toBeDefined();
    await waitFor(() => expect(mocks.bridge.getWorkspaceStatus.invoke).toHaveBeenCalledTimes(2));

    act(() => {
      mocks.listeners.projectUpdated?.({ projectId: 'project_1' });
    });
    await waitFor(() => expect(mocks.bridge.getProject.invoke).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(mocks.bridge.getWorkspaceStatus.invoke).toHaveBeenCalledTimes(3));
    await screen.findByRole('heading', { name: 'Saved local name' });

    let saved: { saved: boolean } | undefined;
    await act(async () => {
      stalledWorkspace.resolve(stalledWorkspaceResult);
      saved = await flushPromise;
    });

    expect(saved).toEqual({ saved: false });
    expect(mocks.bridge.editProject.invoke).toHaveBeenCalledWith({
      projectId: 'project_1',
      expectedRevision: 3,
      changes: { name: 'Saved local name' },
    });
    expect(mocks.bridge.applyAuthoringBatch.invoke).not.toHaveBeenCalled();
    expect(mocks.closeHandlers.hasUnsavedWork?.()).toEqual({ dirtyDraftCount: 1 });
    expect(screen.getByLabelText('conversation.creativeStudio.workspace.controls.brief')).toHaveValue(
      'Unsaved local Brief.'
    );
  });

  it.each([
    [42],
    ['not-json'],
    ['{}'],
    ['[null]'],
    ['[1]'],
    ['[{"id":1,"text":"Avoid marks","predicate":null}]'],
    ['[{"id":"rule_1","text":1,"predicate":null}]'],
    ['[{"id":"rule_1","text":"Avoid marks","predicate":1}]'],
    ['[{"id":"rule_1","text":"Avoid marks","predicate":{"kind":"forbidden_terms","terms":[1]}}]'],
  ])('refuses a malformed close-save rule document: %s', async (value) => {
    seedWorkspaceDrafts({ 'brief.rules': { baseValue: '[]', value } });
    renderStudio();
    await screen.findByRole('heading', { name: 'Launch film' });

    let saved: { saved: boolean } | undefined;
    await act(async () => {
      saved = await mocks.closeHandlers.flushUnsavedWork?.();
    });

    expect(saved).toEqual({ saved: false });
    expect(mocks.bridge.setRules.invoke).not.toHaveBeenCalled();
    expect(mocks.closeHandlers.hasUnsavedWork?.()).toEqual({ dirtyDraftCount: 1 });
  });

  it.each([
    ['beat.beat_0.targetSeconds', 4, 1.5],
    ['beat.beat_0.action', 'Action 1', 42],
    ['shot.shot_0.durationSeconds', 4, 1.5],
    ['shot.shot_0.line', 'Shot 1', 42],
  ])('refuses malformed dynamic authoring draft %s', async (key, baseValue, value) => {
    seedWorkspaceDrafts({ [key]: { baseValue, value } });
    mocks.bridge.getProject.invoke.mockResolvedValue(ok({ status: 'supported', project: projectWithDraftBatch(1) }));
    renderStudio();
    await screen.findByRole('heading', { name: 'Launch film' });

    let saved: { saved: boolean } | undefined;
    await act(async () => {
      saved = await mocks.closeHandlers.flushUnsavedWork?.();
    });

    expect(saved).toEqual({ saved: false });
    expect(mocks.bridge.applyAuthoringBatch.invoke).not.toHaveBeenCalled();
    expect(mocks.closeHandlers.hasUnsavedWork?.()).toEqual({ dirtyDraftCount: 1 });
  });

  it('clears semantically unchanged Beat and Shot drafts without issuing authoring work', async () => {
    seedWorkspaceDrafts({
      'beat.beat_0.action': { baseValue: 'Stale action base', value: 'Action 1' },
      'shot.shot_0.line': { baseValue: 'Stale Shot base', value: 'Shot 1' },
    });
    mocks.bridge.getProject.invoke.mockResolvedValue(ok({ status: 'supported', project: projectWithDraftBatch(2) }));
    renderStudio();
    await screen.findByRole('heading', { name: 'Launch film' });

    let saved: { saved: boolean } | undefined;
    await act(async () => {
      saved = await mocks.closeHandlers.flushUnsavedWork?.();
    });

    expect(saved).toEqual({ saved: true });
    expect(mocks.bridge.applyAuthoringBatch.invoke).not.toHaveBeenCalled();
    expect(mocks.closeHandlers.hasUnsavedWork?.()).toEqual({ dirtyDraftCount: 0 });
  });

  it('clears a semantically unchanged rules draft during close-save without issuing a no-op mutation', async () => {
    seedWorkspaceDrafts({ 'brief.rules': { baseValue: '[]', value: '  [  ]  ' } });
    renderStudio();
    await screen.findByRole('heading', { name: 'Launch film' });

    let saved: { saved: boolean } | undefined;
    await act(async () => {
      saved = await mocks.closeHandlers.flushUnsavedWork?.();
    });

    expect(saved).toEqual({ saved: true });
    expect(mocks.bridge.setRules.invoke).not.toHaveBeenCalled();
    expect(mocks.closeHandlers.hasUnsavedWork?.()).toEqual({ dirtyDraftCount: 0 });
    expect(screen.getByLabelText('conversation.creativeStudio.workspace.controls.rules')).toHaveValue('[]');
  });

  it('rejects an invalid spend currency during close-save without issuing authoring work', async () => {
    seedWorkspaceDrafts({
      'brief.spendCurrency': { baseValue: '', value: 'US' },
      'brief.spendMajorUnits': { baseValue: '', value: '12.34' },
    });
    renderStudio();
    await screen.findByRole('heading', { name: 'Launch film' });

    let saved: { saved: boolean } | undefined;
    await act(async () => {
      saved = await mocks.closeHandlers.flushUnsavedWork?.();
    });

    expect(saved).toEqual({ saved: false });
    expect(mocks.bridge.applyAuthoringBatch.invoke).not.toHaveBeenCalled();
    expect(mocks.closeHandlers.hasUnsavedWork?.()).toEqual({ dirtyDraftCount: 2 });
  });

  it('preserves a forbidden-terms rule and a spend policy in the close-save authority surface', async () => {
    const governed = {
      ...project(),
      spendPolicy: { currency: 'USD', maxPerBatchMinorUnits: 1_234 },
      rules: [
        {
          id: 'rule_1',
          text: 'Avoid marks',
          predicate: { kind: 'forbidden_terms' as const, terms: ['logo'] },
        },
      ],
    };
    seedWorkspaceDrafts({
      'brief.rules': {
        baseValue: JSON.stringify(governed.rules, null, 2),
        value: JSON.stringify([
          {
            id: 'rule_1',
            text: 'Avoid every mark',
            predicate: { kind: 'forbidden_terms', terms: ['logo', 'watermark'] },
          },
        ]),
      },
    });
    const revised = { ...governed, revision: 4 };
    mocks.bridge.getProject.invoke
      .mockResolvedValueOnce(ok({ status: 'supported', project: governed }))
      .mockResolvedValue(ok({ status: 'supported', project: revised }));
    mocks.bridge.getWorkspaceStatus.invoke
      .mockResolvedValueOnce(ok(workspaceStatus(3)))
      .mockResolvedValue(ok(workspaceStatus(4)));
    mocks.bridge.getChainStatus.invoke.mockResolvedValueOnce(ok(chainStatus(3))).mockResolvedValue(ok(chainStatus(4)));
    renderStudio();
    await screen.findByRole('heading', { name: 'Launch film' });

    let saved: { saved: boolean } | undefined;
    await act(async () => {
      saved = await mocks.closeHandlers.flushUnsavedWork?.();
    });

    expect(saved).toEqual({ saved: true });
    expect(mocks.bridge.setRules.invoke).toHaveBeenCalledWith({
      projectId: 'project_1',
      expectedRevision: 3,
      rules: [
        {
          id: 'rule_1',
          text: 'Avoid every mark',
          predicate: { kind: 'forbidden_terms', terms: ['logo', 'watermark'] },
        },
      ],
    });
    expect(screen.getByLabelText('conversation.creativeStudio.workspace.controls.spendCap')).toHaveValue('12.34');
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
