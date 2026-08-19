import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React, { useRef } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  StudioAssetV2,
  StudioRendererChainStatusV2,
  StudioRendererJobV2,
  StudioRendererProjectV2,
  StudioRendererPreparedSubmissionOptionsV2,
  StudioRendererSubmissionQuoteV2,
  StudioRendererWorkspaceStatusV2,
  StudioRouteCatalogV2,
} from '@/common/types/project/creativeStudioTypes';

const mocks = vi.hoisted(() => ({
  prepare: vi.fn(),
  confirm: vi.fn(),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    creativeStudio: {
      prepareSubmission: { invoke: mocks.prepare },
      confirmSubmission: { invoke: mocks.confirm },
    },
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => {
      if (key === 'conversation.creativeStudio.workspace.controls.undoLabel.edit_shot') return 'edit shot';
      if (key === 'conversation.creativeStudio.workspace.controls.dirtyCause.continuity_stale') {
        return 'continuity changed';
      }
      return values === undefined ? key : `${key}:${JSON.stringify(values)}`;
    },
    i18n: { language: 'en-US', resolvedLanguage: 'en-US' },
  }),
}));

import {
  SpendGateModal,
  WorkspaceControls,
  formatMinorUnits,
  handoffGateDraft,
  projectWorkspace,
  selectionGateDraft,
  useWorkspaceDrafts,
  useSpendGate,
  type WorkspaceMutationCallbacks,
} from '@/renderer/pages/studio/components/Workspace';

const makeAsset = (
  id: string,
  shotId: string,
  mediaKind: StudioAssetV2['mediaKind'] = 'image',
  collection: StudioAssetV2['managedAsset']['collection'] = 'assets'
): StudioAssetV2 => ({
  id,
  projectId: 'project_1',
  shotId,
  mediaKind,
  mimeType: mediaKind === 'video' ? 'video/mp4' : 'image/png',
  managedAsset: { collection, fileName: `${id}.bin` },
  byteSize: 10,
  sha256: 'a'.repeat(64),
  ...(mediaKind === 'video' ? { durationSeconds: 4 } : {}),
  createdAt: '2026-08-19T00:00:00.000Z',
});

const makeJob = (id: string, shotId: string, overrides: Partial<StudioRendererJobV2>): StudioRendererJobV2 =>
  ({
    id,
    projectId: 'project_1',
    shotId,
    status: 'succeeded',
    provider: { choiceId: 'route_video', providerId: 'provider_safe', model: 'model_safe' },
    outputAssetIds: [],
    outputAssetIdsByRole: { primary: null, poster: null },
    error: null,
    canCancel: false,
    canRetryDownload: false,
    retryOfJobId: null,
    retryReason: null,
    duplicateChargeAcknowledged: false,
    duplicateChargeAcknowledgedAt: null,
    purpose: 'video_take',
    generationIndex: 0,
    spendReceipt: null,
    createdAt: '2026-08-19T00:00:00.000Z',
    updatedAt: '2026-08-19T00:00:00.000Z',
    ...overrides,
  }) as StudioRendererJobV2;

const makeProject = (): StudioRendererProjectV2 =>
  ({
    schemaVersion: 2,
    revision: 3,
    id: 'project_1',
    name: 'Launch film',
    brief: 'A launch film.',
    rules: [],
    aspectRatio: '16:9',
    targetDurationSeconds: 12,
    resolution: '720p',
    beatOrder: ['beat_1', 'beat_2'],
    beats: {
      beat_1: {
        id: 'beat_1',
        title: 'Opening',
        action: 'Open',
        look: 'Bright',
        actionRevision: 1,
        targetSeconds: 8,
        shotOrder: ['shot_1', 'shot_2'],
        lineHistory: [],
      },
      beat_2: {
        id: 'beat_2',
        title: 'Close',
        action: 'Close',
        look: 'Warm',
        actionRevision: 1,
        targetSeconds: 4,
        shotOrder: ['shot_3'],
        lineHistory: [],
      },
    },
    shots: Object.fromEntries(
      [
        ['shot_1', 'hard_cut'],
        ['shot_2', 'none'],
        ['shot_3', 'hard_cut'],
      ].map(([id, chainBreak]) => [
        id,
        {
          id,
          line: id,
          derivation: 'derived',
          derivedFromActionRevision: 1,
          narration: '',
          onScreenText: '',
          durationSeconds: 4,
          trimInSeconds: null,
          trimOutSeconds: null,
          chainBreak,
          seedStillId: null,
          selectedTakeId: null,
          assetIds: [],
          jobIds: [],
        },
      ])
    ),
    bin: [],
    bedAssetId: null,
    matchToShotId: null,
    spendPolicy: null,
    imageRouteId: 'route_image',
    videoRouteId: 'route_video',
    assets: {},
    jobs: {},
    createdAt: '2026-08-19T00:00:00.000Z',
    updatedAt: '2026-08-19T00:00:00.000Z',
  }) as StudioRendererProjectV2;

const quote = (id: string, cascade = false): StudioRendererSubmissionQuoteV2 => ({
  id,
  projectId: 'project_1',
  projectRevision: 3,
  expiresAt: '2026-08-19T01:00:00.000Z',
  currency: 'USD',
  baseItems: [
    {
      shotId: 'shot_1',
      purpose: 'seed_still',
      route: { choiceId: 'image_choice', providerId: 'safe_provider', model: 'safe_model' },
      generationCount: 2,
      durationSeconds: null,
      oneGenerationMinorUnits: 125,
      requestedTotalMinorUnits: 250,
      waitsForTakeSelection: false,
    },
  ],
  cascadeItems: cascade
    ? [
        {
          shotId: 'shot_1',
          purpose: 'video_take',
          route: { choiceId: 'video_choice', providerId: 'safe_video', model: 'video_model' },
          generationCount: 1,
          durationSeconds: 4,
          oneGenerationMinorUnits: 400,
          requestedTotalMinorUnits: 400,
          waitsForTakeSelection: true,
        },
      ]
    : [],
  lowerMinorUnits: cascade ? 250 : 250,
  upperMinorUnits: cascade ? 650 : 250,
  budget: { kind: 'within_cap', policyCurrency: 'USD', maxPerBatchMinorUnits: 1_000 },
});

const options = (): StudioRendererPreparedSubmissionOptionsV2 => ({
  baseOnly: quote('quote_base'),
  withCascade: quote('quote_cascade', true),
});

const draft = {
  projectId: 'project_1',
  expectedRevision: 3,
  originReferenceHandoffId: null,
  baseChoices: [{ shotId: 'shot_1', purpose: 'seed_still' as const, generationCount: 2, referenceAssetId: null }],
  cascadeChoices: [{ shotId: 'shot_1', purpose: 'video_take' as const, generationCount: 1, referenceAssetId: null }],
};

const Harness: React.FC<{ reenterOnConfirmed?: boolean; rejectOnConfirmed?: boolean }> = ({
  reenterOnConfirmed = false,
  rejectOnConfirmed = false,
}) => {
  const gateRef = useRef<ReturnType<typeof useSpendGate> | null>(null);
  const gate = useSpendGate({
    onConfirmed: async () => {
      if (reenterOnConfirmed) await gateRef.current?.confirm();
      if (rejectOnConfirmed) throw new Error('refresh failed');
    },
  });
  gateRef.current = gate;
  return (
    <>
      <button onClick={() => gate.open(draft)}>Open review</button>
      <button onClick={() => void gate.confirm()}>Invoke confirm directly</button>
      <SpendGateModal {...gate} />
    </>
  );
};

const routeCatalog = (
  image: StudioRouteCatalogV2['image']['status'],
  video: StudioRouteCatalogV2['video']['status']
): StudioRouteCatalogV2 => ({
  image: { status: image, selected: null, selectedRoute: null, selectionIssue: null, options: [] },
  video: { status: video, selected: null, selectedRoute: null, selectionIssue: null, options: [] },
  catalogVersion: 'catalog_1',
});

const workspaceCallbacks = (): WorkspaceMutationCallbacks => ({
  editProject: vi.fn(async () => true),
  applyAuthoring: vi.fn(async () => true),
  setRules: vi.fn(async () => true),
  refreshRoutes: vi.fn(async () => true),
  undo: vi.fn(async () => true),
  retryConditioning: vi.fn(async () => true),
  cancelWaiting: vi.fn(async () => true),
  chooseCascadeAsset: vi.fn(async () => true),
});

const readyWorkspaceStatus = (revision = 3): StudioRendererWorkspaceStatusV2 => ({
  projectId: 'project_1',
  projectRevision: revision,
  undoTop: null,
  dirtyShots: [],
  cascadeProgress: [],
  parkEligibility: [],
});

const readyChainStatus = (revision = 3): StudioRendererChainStatusV2 => ({
  projectId: 'project_1',
  projectRevision: revision,
  conditioningFailures: [],
});

const readyProjection = (project: StudioRendererProjectV2) =>
  projectWorkspace(project, readyWorkspaceStatus(project.revision), readyChainStatus(project.revision));

const ControlsHarness: React.FC<{
  routes: StudioRouteCatalogV2;
  open: ReturnType<typeof vi.fn>;
  seeded?: boolean;
  spendPolicy?: boolean;
  status?: StudioRendererWorkspaceStatusV2 | null;
  chain?: StudioRendererChainStatusV2 | null;
  pending?: boolean;
  gateLocked?: boolean;
  mutations?: WorkspaceMutationCallbacks;
}> = ({
  routes,
  open,
  seeded = false,
  spendPolicy = false,
  status,
  chain,
  pending = false,
  gateLocked = false,
  mutations = workspaceCallbacks(),
}) => {
  const project = makeProject();
  if (seeded) {
    const seed = makeAsset('seed_1', 'shot_1', 'image', 'imports');
    project.assets[seed.id] = seed;
    project.shots.shot_1!.assetIds.push(seed.id);
  }
  if (spendPolicy) project.spendPolicy = { currency: 'USD', maxPerBatchMinorUnits: 1_000 };
  const projection = projectWorkspace(
    project,
    status === undefined ? readyWorkspaceStatus(project.revision) : status,
    chain === undefined ? readyChainStatus(project.revision) : chain
  );
  const drafts = useWorkspaceDrafts({
    projectId: project.id,
    projectRevision: project.revision,
    canonicalValues: {
      'settings.name': project.name,
      'settings.targetDurationSeconds': project.targetDurationSeconds,
      'settings.aspectRatio': project.aspectRatio,
      'settings.resolution': project.resolution,
      'brief.text': project.brief,
      'brief.imageRouteId': project.imageRouteId ?? '',
      'brief.videoRouteId': project.videoRouteId ?? '',
      'brief.spendCurrency': project.spendPolicy?.currency ?? '',
      'brief.spendMajorUnits': project.spendPolicy === null ? '' : '10.00',
      'brief.rules': '[]',
      'gate.choices': '{}',
    },
    activeShotIds: projection.activeShotIds,
  });
  return (
    <WorkspaceControls
      activeView='table'
      project={project}
      projection={projection}
      routeCatalog={routes}
      drafts={drafts}
      pending={pending}
      gateLocked={gateLocked}
      errorMessageKey={null}
      mutations={mutations}
      openSpendGate={open}
    />
  );
};

const lockedWorkspaceStatus = (): StudioRendererWorkspaceStatusV2 => ({
  ...readyWorkspaceStatus(),
  parkEligibility: [
    {
      subject: 'shot',
      action: 'park',
      beatId: 'beat_1',
      shotId: 'shot_1',
      assetId: null,
      allowed: false,
      blockers: [{ shotId: 'shot_1', code: 'bound_nonterminal_request' }],
    },
  ],
});

describe('spend gate draft graph', () => {
  it('fails closed until both revision-matched status snapshots are ready', () => {
    const project = makeProject();
    expect(
      selectionGateDraft({ project, projection: projectWorkspace(project, null, null), orderedShotIds: ['shot_1'] })
    ).toBeNull();
    expect(
      selectionGateDraft({
        project,
        projection: projectWorkspace(project, readyWorkspaceStatus(), readyChainStatus(2)),
        orderedShotIds: ['shot_1'],
      })
    ).toBeNull();
  });

  it('derives seed then same-shot/downstream video cascade with null video references', () => {
    const project = makeProject();
    const projection = readyProjection(project);

    expect(selectionGateDraft({ project, projection, orderedShotIds: ['shot_1'] })).toMatchObject({
      baseChoices: [{ shotId: 'shot_1', purpose: 'seed_still', referenceAssetId: null }],
      cascadeChoices: [
        { shotId: 'shot_1', purpose: 'video_take', referenceAssetId: null },
        { shotId: 'shot_2', purpose: 'video_take', referenceAssetId: null },
      ],
    });
  });

  it('treats a normal downstream shot as video-conditioned and refuses two anchors in one segment', () => {
    const project = makeProject();
    const projection = readyProjection(project);

    expect(selectionGateDraft({ project, projection, orderedShotIds: ['shot_2'] })?.baseChoices).toEqual([
      { shotId: 'shot_2', purpose: 'video_take', generationCount: 1, referenceAssetId: null },
    ]);
    expect(selectionGateDraft({ project, projection, orderedShotIds: ['shot_1', 'shot_2'] })).toBeNull();
  });

  it('uses effective imported seed, stops cascade at in-flight video, and blocks current conditioning failures', () => {
    const project = makeProject();
    const seed = makeAsset('seed_import', 'shot_1', 'image', 'imports');
    project.assets[seed.id] = seed;
    project.shots.shot_1!.assetIds.push(seed.id);
    project.jobs.job_2 = makeJob('job_2', 'shot_2', { status: 'running' });
    project.shots.shot_2!.jobIds.push('job_2');
    let projection = readyProjection(project);
    expect(selectionGateDraft({ project, projection, orderedShotIds: ['shot_1'] })).toMatchObject({
      baseChoices: [{ shotId: 'shot_1', purpose: 'video_take' }],
      cascadeChoices: [],
    });

    projection = projectWorkspace(project, readyWorkspaceStatus(), {
      projectId: project.id,
      projectRevision: project.revision,
      conditioningFailures: [{ dependentShotId: 'shot_1', reason: 'conditioning_failed', canRetry: true }],
    });
    expect(selectionGateDraft({ project, projection, orderedShotIds: ['shot_1'] })).toBeNull();
  });

  it('accepts bounded per-pair counts/reference and refuses terminal handoff reopening', () => {
    const project = makeProject();
    const projection = readyProjection(project);
    const defaults = selectionGateDraft({ project, projection, orderedShotIds: ['shot_1'] })!;
    const customized = selectionGateDraft({
      project,
      projection,
      orderedShotIds: ['shot_1'],
      baseChoices: [{ ...defaults.baseChoices[0]!, generationCount: 4, referenceAssetId: 'brief_ref' }],
      cascadeChoices: defaults.cascadeChoices.map((choice) => ({ ...choice, generationCount: 3 })),
    });
    expect(customized?.baseChoices[0]).toMatchObject({ generationCount: 4, referenceAssetId: 'brief_ref' });
    expect(customized?.cascadeChoices.every((choice) => choice.generationCount === 3)).toBe(true);
    expect(
      selectionGateDraft({
        project,
        projection,
        orderedShotIds: ['shot_1'],
        baseChoices: [{ ...defaults.baseChoices[0]!, shotId: 'shot_3' }],
        cascadeChoices: defaults.cascadeChoices,
      })
    ).toBeNull();

    expect(
      handoffGateDraft(project, projection, {
        handoffId: 'handoff_1',
        requestId: 'request_1',
        shotIds: ['shot_1'],
        decidedAt: '2026-08-19T00:00:00.000Z',
        status: 'confirmed',
        completedAt: '2026-08-19T00:01:00.000Z',
      })
    ).toBeNull();
  });

  it('formats maximum safe integer cents without rounding them through a float', () => {
    expect(formatMinorUnits(Number.MAX_SAFE_INTEGER, 'USD', 'en-US')).toBe('$90,071,992,547,409.91');
  });
});

describe('WorkspaceControls', () => {
  beforeEach(() => window.sessionStorage.clear());

  it('resets only settings while preserving Brief and rule drafts', () => {
    render(<ControlsHarness routes={routeCatalog('ready', 'ready')} open={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('conversation.creativeStudio.workspace.controls.name'), {
      target: { value: 'Changed name' },
    });
    fireEvent.change(screen.getByLabelText('conversation.creativeStudio.workspace.controls.brief'), {
      target: { value: 'Changed brief' },
    });
    fireEvent.change(screen.getByLabelText('conversation.creativeStudio.workspace.controls.rules'), {
      target: { value: '[{"id":"rule_1","text":"Keep","predicate":null}]' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'conversation.creativeStudio.workspace.controls.reset' }));
    expect(screen.getByLabelText('conversation.creativeStudio.workspace.controls.name')).toHaveValue('Launch film');
    expect(screen.getByLabelText('conversation.creativeStudio.workspace.controls.brief')).toHaveValue('Changed brief');
    expect(screen.getByLabelText('conversation.creativeStudio.workspace.controls.rules')).toHaveValue(
      '[{"id":"rule_1","text":"Keep","predicate":null}]'
    );
  });

  it('keeps the exact full cascade when only an optional video route is unavailable', () => {
    const open = vi.fn();
    render(<ControlsHarness routes={routeCatalog('ready', 'unavailable')} open={open} />);
    fireEvent.click(screen.getByLabelText('shot_1'));
    fireEvent.click(
      screen.getByRole('button', { name: 'conversation.creativeStudio.workspace.controls.reviewRender' })
    );
    expect(open).toHaveBeenCalledWith(
      expect.objectContaining({
        baseChoices: [expect.objectContaining({ purpose: 'seed_still' })],
        cascadeChoices: [
          expect.objectContaining({ shotId: 'shot_1', purpose: 'video_take' }),
          expect.objectContaining({ shotId: 'shot_2', purpose: 'video_take' }),
        ],
      })
    );
  });

  it('blocks only the missing route required by the base purpose', () => {
    const missingImage = render(<ControlsHarness routes={routeCatalog('unavailable', 'ready')} open={vi.fn()} />);
    fireEvent.click(screen.getByLabelText('shot_1'));
    fireEvent.click(
      screen.getByRole('button', { name: 'conversation.creativeStudio.workspace.controls.reviewRender' })
    );
    expect(screen.getByText('conversation.creativeStudio.workspace.controls.imageRouteBlocked')).toBeVisible();
    missingImage.unmount();
    window.sessionStorage.clear();

    render(<ControlsHarness routes={routeCatalog('ready', 'unavailable')} open={vi.fn()} seeded />);
    fireEvent.click(screen.getByLabelText('shot_1'));
    fireEvent.click(
      screen.getByRole('button', { name: 'conversation.creativeStudio.workspace.controls.reviewRender' })
    );
    expect(screen.getByText('conversation.creativeStudio.workspace.controls.videoRouteBlocked')).toBeVisible();
  });

  it('keeps name and target drafts eligible for review but blocks generation-affecting drafts', () => {
    const open = vi.fn();
    const first = render(<ControlsHarness routes={routeCatalog('ready', 'ready')} open={open} />);
    fireEvent.change(screen.getByLabelText('conversation.creativeStudio.workspace.controls.name'), {
      target: { value: 'Renamed without generation' },
    });
    fireEvent.change(screen.getByLabelText('conversation.creativeStudio.workspace.controls.targetDuration'), {
      target: { value: '18' },
    });
    fireEvent.click(screen.getByLabelText('shot_1'));
    const review = screen.getByRole('button', {
      name: 'conversation.creativeStudio.workspace.controls.reviewRender',
    });
    expect(review).toBeEnabled();
    fireEvent.click(review);
    expect(open).toHaveBeenCalledTimes(1);

    first.unmount();
    window.sessionStorage.clear();
    render(<ControlsHarness routes={routeCatalog('ready', 'ready')} open={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('conversation.creativeStudio.workspace.controls.brief'), {
      target: { value: 'Unsaved generative intent' },
    });
    fireEvent.click(screen.getByLabelText('shot_1'));
    expect(
      screen.getByRole('button', { name: 'conversation.creativeStudio.workspace.controls.reviewRender' })
    ).toBeDisabled();
    expect(screen.getByText('conversation.creativeStudio.workspace.controls.saveBeforeReview')).toBeVisible();
  });

  it('freezes paid review and choice controls while confirmation authority is live', () => {
    render(<ControlsHarness routes={routeCatalog('ready', 'ready')} open={vi.fn()} gateLocked />);
    fireEvent.click(screen.getByLabelText('shot_1'));

    expect(
      screen.getByRole('button', { name: 'conversation.creativeStudio.workspace.controls.reviewRender' })
    ).toBeDisabled();
    for (const select of within(screen.getByTestId('studio-generation-choices')).getAllByRole('combobox')) {
      expect(select).toHaveAttribute('aria-disabled', 'true');
    }
  });

  it('blocks review when either revision-matched status snapshot is absent or stale', () => {
    const first = render(<ControlsHarness routes={routeCatalog('ready', 'ready')} open={vi.fn()} status={null} />);
    fireEvent.click(screen.getByLabelText('shot_1'));
    expect(
      screen.getByRole('button', { name: 'conversation.creativeStudio.workspace.controls.reviewRender' })
    ).toBeDisabled();
    expect(screen.getByText('conversation.creativeStudio.workspace.controls.statusRequired')).toBeVisible();

    first.unmount();
    window.sessionStorage.clear();
    render(<ControlsHarness routes={routeCatalog('ready', 'ready')} open={vi.fn()} chain={readyChainStatus(2)} />);
    fireEvent.click(screen.getByLabelText('shot_1'));
    expect(
      screen.getByRole('button', { name: 'conversation.creativeStudio.workspace.controls.reviewRender' })
    ).toBeDisabled();
    expect(screen.getByText('conversation.creativeStudio.workspace.controls.statusRequired')).toBeVisible();
  });

  it('uses the native checkbox event for contiguous shift-range selection', () => {
    render(<ControlsHarness routes={routeCatalog('ready', 'ready')} open={vi.fn()} />);
    fireEvent.click(screen.getByLabelText('shot_1'));
    fireEvent.click(screen.getByLabelText('shot_3'), { shiftKey: true });

    expect(screen.getByLabelText('shot_1')).toBeChecked();
    expect(screen.getByLabelText('shot_2')).toBeChecked();
    expect(screen.getByLabelText('shot_3')).toBeChecked();
  });

  it('saves unlocked settings while preserving a pre-lock request-shape draft', async () => {
    window.sessionStorage.setItem(
      'aionui:creative-studio:v2:workspace-drafts:project_1',
      JSON.stringify({
        version: 2,
        projectId: 'project_1',
        sourceRevision: 3,
        entries: {
          'settings.name': { baseValue: 'Launch film', value: 'Renamed while locked' },
          'settings.aspectRatio': { baseValue: '16:9', value: '9:16' },
        },
        selection: { selectedShotIds: [], anchorShotId: null },
      })
    );
    const mutations = workspaceCallbacks();
    render(
      <ControlsHarness
        routes={routeCatalog('ready', 'ready')}
        open={vi.fn()}
        status={lockedWorkspaceStatus()}
        mutations={mutations}
      />
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'conversation.creativeStudio.workspace.controls.saveSettings' })
    );
    await waitFor(() => expect(mutations.editProject).toHaveBeenCalledWith({ name: 'Renamed while locked' }));
    await waitFor(() => {
      const persisted = JSON.parse(
        window.sessionStorage.getItem('aionui:creative-studio:v2:workspace-drafts:project_1') ?? '{}'
      ) as { entries?: Record<string, unknown> };
      expect(persisted.entries).not.toHaveProperty('settings.name');
      expect(persisted.entries).toHaveProperty('settings.aspectRatio');
    });
  });

  it('translates stable undo and dirty-cause codes instead of rendering raw identifiers', () => {
    const status: StudioRendererWorkspaceStatusV2 = {
      ...lockedWorkspaceStatus(),
      undoTop: { entryId: 'undo_1', label: 'edit_shot', sourceRevision: 2 },
      dirtyShots: [{ shotId: 'shot_1', causes: ['continuity_stale'] }],
      parkEligibility: [],
    };
    const { container } = render(
      <ControlsHarness routes={routeCatalog('ready', 'ready')} open={vi.fn()} status={status} />
    );

    expect(container).toHaveTextContent('edit shot');
    expect(container).toHaveTextContent('continuity changed');
    expect(container).not.toHaveTextContent('edit_shot');
    expect(container).not.toHaveTextContent('continuity_stale');
  });

  it('clears normalized no-op setting and spend drafts without issuing a commit', async () => {
    const mutations = workspaceCallbacks();
    render(
      <ControlsHarness routes={routeCatalog('ready', 'ready')} open={vi.fn()} spendPolicy mutations={mutations} />
    );
    fireEvent.change(screen.getByLabelText('conversation.creativeStudio.workspace.controls.name'), {
      target: { value: ' Launch film ' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'conversation.creativeStudio.workspace.controls.saveSettings' })
    );
    await waitFor(() =>
      expect(screen.getByLabelText('conversation.creativeStudio.workspace.controls.name')).toHaveValue('Launch film')
    );
    expect(mutations.editProject).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('conversation.creativeStudio.workspace.controls.spendCap'), {
      target: { value: '10.0' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'conversation.creativeStudio.workspace.controls.saveBrief' }));
    await waitFor(() =>
      expect(screen.getByLabelText('conversation.creativeStudio.workspace.controls.spendCap')).toHaveValue('10.00')
    );
    expect(mutations.applyAuthoring).not.toHaveBeenCalled();
  });
});

describe('SpendGateModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prepare.mockResolvedValue({ ok: true, data: options() });
    mocks.confirm.mockResolvedValue({ ok: true, data: { projectId: 'project_1', projectRevision: 4 } });
  });

  it('does no native work on open/close and invokes prepare only from the explicit action', async () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Open review' }));
    expect(mocks.prepare).not.toHaveBeenCalled();
    expect(mocks.confirm).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'conversation.creativeStudio.workspace.gate.close' }));
    expect(mocks.prepare).not.toHaveBeenCalled();
    expect(mocks.confirm).not.toHaveBeenCalled();
  });

  it('freezes duplicate prepare, renders every safe row fact, and confirms only the selected opaque quote', async () => {
    let resolvePrepare!: (value: unknown) => void;
    mocks.prepare.mockReturnValue(new Promise((resolve) => (resolvePrepare = resolve)));
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Open review' }));
    const prepare = screen.getByRole('button', { name: 'conversation.creativeStudio.workspace.gate.prepare' });
    fireEvent.click(prepare);
    fireEvent.click(prepare);
    expect(mocks.prepare).toHaveBeenCalledTimes(1);
    resolvePrepare({ ok: true, data: options() });

    const modal = await screen.findByTestId('studio-spend-gate');
    fireEvent.click(within(modal).getByText('conversation.creativeStudio.workspace.gate.withCascade'));
    expect(within(modal).getByText(/safe_video/)).toHaveTextContent('video_choice');
    expect(within(modal).getByText('conversation.creativeStudio.workspace.gate.rateCardSource')).toBeVisible();
    expect(within(modal).getByText('conversation.creativeStudio.workspace.gate.waitsForTakeSelection')).toBeVisible();
    expect(within(modal).getByText(/budgetPolicy/)).toHaveTextContent('$10.00');

    fireEvent.click(
      within(modal).getByRole('button', { name: /conversation\.creativeStudio\.workspace\.gate\.confirm/ })
    );
    await waitFor(() =>
      expect(mocks.confirm).toHaveBeenCalledWith({
        projectId: 'project_1',
        quoteId: 'quote_cascade',
        expectedRevision: 3,
      })
    );
  });

  it.each([
    ['quote_cache_full', 'quoteCacheFull'],
    ['quote_too_large', 'quoteTooLarge'],
  ])('maps prepare failure %s without automatic retry', async (code, key) => {
    mocks.prepare.mockResolvedValue({ ok: false, error: { code, messageKey: `native.${key}` } });
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Open review' }));
    fireEvent.click(screen.getByRole('button', { name: 'conversation.creativeStudio.workspace.gate.prepare' }));

    expect(await screen.findByText(`conversation.creativeStudio.errors.${key}`)).toBeVisible();
    expect(mocks.prepare).toHaveBeenCalledTimes(1);
    expect(mocks.confirm).not.toHaveBeenCalled();
  });

  it('refreshes explicitly after an expired quote without retaining or auto-confirming it', async () => {
    mocks.confirm.mockResolvedValue({
      ok: false,
      error: { code: 'quote_not_found', messageKey: 'native.quoteNotFound' },
    });
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Open review' }));
    fireEvent.click(screen.getByRole('button', { name: 'conversation.creativeStudio.workspace.gate.prepare' }));
    const modal = await screen.findByTestId('studio-spend-gate');
    fireEvent.click(
      within(modal).getByRole('button', { name: /conversation\.creativeStudio\.workspace\.gate\.confirm/ })
    );

    expect(await within(modal).findByText('conversation.creativeStudio.errors.quoteNotFound')).toBeVisible();
    expect(
      within(modal).getByRole('button', { name: 'conversation.creativeStudio.workspace.gate.prepareAgain' })
    ).toBeEnabled();
    expect(within(modal).queryByText(/safe_provider/)).not.toBeInTheDocument();
    expect(mocks.prepare).toHaveBeenCalledTimes(1);
    expect(mocks.confirm).toHaveBeenCalledTimes(1);
  });

  it('freezes the selected reviewed quote after confirm reports quote in use', async () => {
    mocks.confirm.mockResolvedValue({
      ok: false,
      error: { code: 'quote_in_use', messageKey: 'native.quoteInUse' },
    });
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Open review' }));
    fireEvent.click(screen.getByRole('button', { name: 'conversation.creativeStudio.workspace.gate.prepare' }));
    const modal = await screen.findByTestId('studio-spend-gate');
    fireEvent.click(within(modal).getByText('conversation.creativeStudio.workspace.gate.withCascade'));
    fireEvent.click(
      within(modal).getByRole('button', { name: /conversation\.creativeStudio\.workspace\.gate\.confirm/ })
    );

    expect(await within(modal).findByText('conversation.creativeStudio.errors.quoteInUse')).toBeVisible();
    expect(within(modal).getByText(/safe_video/)).toHaveTextContent('video_choice');
    for (const option of within(modal).getAllByRole('radio')) expect(option).toBeDisabled();
    expect(
      within(modal).getByRole('button', { name: /conversation\.creativeStudio\.workspace\.gate\.confirm/ })
    ).toBeDisabled();
    expect(
      within(modal).getByRole('button', { name: 'conversation.creativeStudio.workspace.gate.close' })
    ).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Open review' }));
    expect(within(modal).getByText(/safe_video/)).toHaveTextContent('video_choice');
    expect(mocks.prepare).toHaveBeenCalledTimes(1);
    expect(mocks.confirm).toHaveBeenCalledTimes(1);
  });

  it('prevents a reentrant callback from confirming the same paid quote twice', async () => {
    render(<Harness reenterOnConfirmed />);
    fireEvent.click(screen.getByRole('button', { name: 'Open review' }));
    fireEvent.click(screen.getByRole('button', { name: 'conversation.creativeStudio.workspace.gate.prepare' }));
    const modal = await screen.findByTestId('studio-spend-gate');
    fireEvent.click(
      within(modal).getByRole('button', { name: /conversation\.creativeStudio\.workspace\.gate\.confirm/ })
    );

    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledTimes(1));
  });

  it('keeps a successful paid commit terminal when its renderer refresh fails', async () => {
    render(<Harness rejectOnConfirmed />);
    fireEvent.click(screen.getByRole('button', { name: 'Open review' }));
    fireEvent.click(screen.getByRole('button', { name: 'conversation.creativeStudio.workspace.gate.prepare' }));
    const modal = await screen.findByTestId('studio-spend-gate');
    fireEvent.click(
      within(modal).getByRole('button', { name: /conversation\.creativeStudio\.workspace\.gate\.confirm/ })
    );

    expect(await within(modal).findByText('conversation.creativeStudio.workspace.gate.confirmed')).toBeVisible();
    expect(
      within(modal).getByRole('button', { name: 'conversation.creativeStudio.workspace.gate.close' })
    ).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Invoke confirm directly' }));
    expect(mocks.confirm).toHaveBeenCalledTimes(1);
  });
});
