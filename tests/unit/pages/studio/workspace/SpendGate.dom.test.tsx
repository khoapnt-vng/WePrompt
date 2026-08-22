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
  WorkspaceProjectMenu,
  formatMinorUnits,
  handoffGateDraft,
  initialSpendGateState,
  majorUnitsToMinorUnits,
  projectWorkspace,
  selectedSpendGateQuote,
  filmRenderBatchShotIds,
  selectionGateDraft,
  spendGateReducer,
  useWorkspaceDrafts,
  useSpendGate,
  type BeatPanelActions,
  type BoardActions,
  type WorkspaceDraftValue,
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
  acknowledgeRuleAdoption: vi.fn(),
  refreshRoutes: vi.fn(async () => true),
  undo: vi.fn(async () => true),
  retryConditioning: vi.fn(async () => true),
  cancelWaiting: vi.fn(async () => true),
  chooseCascadeAsset: vi.fn(async () => true),
});

const beatPanelActions = (): BeatPanelActions => ({
  saveBeat: vi.fn(async () => true),
  saveShot: vi.fn(async () => true),
  setHardCut: vi.fn(async () => true),
  setSeedStill: vi.fn(async () => true),
  trimShot: vi.fn(async () => true),
  reorderShots: vi.fn(async () => true),
  redetachLine: vi.fn(async () => true),
  restoreLine: vi.fn(async () => true),
  importSeedStill: vi.fn(async () => 'cancelled'),
  selectTake: vi.fn(async () => true),
  parkTake: vi.fn(async () => true),
  addAlternateTake: vi.fn(async () => true),
  restoreTake: vi.fn(async () => true),
  parkShot: vi.fn(async () => true),
  parkBeat: vi.fn(async () => true),
  reviewShot: vi.fn(),
  chooseCascadeAsset: vi.fn(async () => true),
  retryConditioning: vi.fn(async () => true),
  cancelWaiting: vi.fn(async () => true),
  requestReviewedRederive: vi.fn(),
  requestResplit: vi.fn(),
});

const boardActions = (): BoardActions => ({
  reorderBeats: vi.fn(async () => true),
  parkBeat: vi.fn(async () => true),
  restoreBeat: vi.fn(async () => true),
  restoreShot: vi.fn(async () => true),
  restoreTake: vi.fn(async () => true),
  reorderBin: vi.fn(async () => true),
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
  routes: StudioRouteCatalogV2 | null;
  open: ReturnType<typeof vi.fn>;
  project?: StudioRendererProjectV2;
  spendPolicy?: boolean;
  status?: StudioRendererWorkspaceStatusV2 | null;
  chain?: StudioRendererChainStatusV2 | null;
  pending?: boolean;
  gateLocked?: boolean;
  mutations?: WorkspaceMutationCallbacks;
}> = ({
  routes,
  open: _open,
  project: projectOverride,
  spendPolicy = false,
  status,
  chain,
  pending = false,
  gateLocked = false,
  mutations = workspaceCallbacks(),
}) => {
  const project = projectOverride === undefined ? makeProject() : { ...projectOverride };
  if (spendPolicy) project.spendPolicy = { currency: 'USD', maxPerBatchMinorUnits: 1_000 };
  const projection = projectWorkspace(
    project,
    status === undefined ? readyWorkspaceStatus(project.revision) : status,
    chain === undefined ? readyChainStatus(project.revision) : chain
  );
  const canonicalValues: Record<string, WorkspaceDraftValue> = {
    'settings.name': project.name,
    'settings.targetDurationSeconds': project.targetDurationSeconds,
    'settings.aspectRatio': project.aspectRatio,
    'settings.resolution': project.resolution,
    'brief.text': project.brief,
    'brief.imageRouteId': project.imageRouteId ?? '',
    'brief.videoRouteId': project.videoRouteId ?? '',
    'brief.spendCurrency': project.spendPolicy?.currency ?? '',
    'brief.spendMajorUnits': project.spendPolicy === null ? '' : '10.00',
    'gate.choices': '{}',
  };
  for (const beatId of project.beatOrder) {
    const beat = project.beats[beatId];
    if (beat === undefined) continue;
    canonicalValues[`beat.${beatId}.action`] = beat.action;
    canonicalValues[`beat.${beatId}.look`] = beat.look;
    canonicalValues[`beat.${beatId}.targetSeconds`] = beat.targetSeconds;
    for (const shotId of beat.shotOrder) {
      const shot = project.shots[shotId];
      if (shot === undefined) continue;
      canonicalValues[`shot.${shotId}.line`] = shot.line;
      canonicalValues[`shot.${shotId}.narration`] = shot.narration;
      canonicalValues[`shot.${shotId}.onScreenText`] = shot.onScreenText;
      canonicalValues[`shot.${shotId}.durationSeconds`] = shot.durationSeconds;
    }
  }
  const drafts = useWorkspaceDrafts({
    projectId: project.id,
    projectRevision: project.revision,
    canonicalValues,
    activeBeatIds: projection.activeBeatIds,
    activeShotIds: projection.activeShotIds,
  });
  return (
    <>
      <WorkspaceProjectMenu
        project={project}
        projection={projection}
        routeCatalog={routes}
        drafts={drafts}
        pending={pending}
        errorMessageKey={null}
        mutations={mutations}
      />
      <WorkspaceControls
        activeView='table'
        project={project}
        projection={projection}
        drafts={drafts}
        pending={pending}
        gateLocked={gateLocked}
        errorMessageKey={null}
        mutations={mutations}
        boardActions={boardActions()}
        beatPanelActions={beatPanelActions()}
        beatPanelBriefReferenceOptions={[]}
        beatPanelReviewGraphs={[]}
        beatPanelReviewBlockedMessageKey={null}
      />
    </>
  );
};

const openProjectMenuDialog = async (
  title:
    | 'conversation.creativeStudio.workspace.controls.settingsTitle'
    | 'conversation.creativeStudio.workspace.controls.briefAndRulesTitle'
): Promise<HTMLElement> => {
  fireEvent.click(screen.getByRole('button', { name: 'common.more' }));
  const menu = await screen.findByRole('menu');
  fireEvent.click(within(menu).getByRole('menuitem', { name: title }));
  return screen.findByRole('dialog', { name: title });
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

describe('the largest legal render batch', () => {
  it('takes one shot per chain segment, because the second cannot start before the first exists', () => {
    // beat_1 chains shot_1 -> shot_2, beat_2 holds shot_3. Rendering shot_2 now would condition it
    // on a last frame shot_1 has not produced yet, so the ceiling is one shot per segment.
    const project = makeProject();
    const batch = filmRenderBatchShotIds({
      project,
      projection: projectWorkspace(project, readyWorkspaceStatus(), readyChainStatus(3)),
    });
    expect(batch).toEqual(['shot_1', 'shot_3']);
  });

  it('honours the per-request shot cap', () => {
    const project = makeProject();
    const batch = filmRenderBatchShotIds({
      project,
      projection: projectWorkspace(project, readyWorkspaceStatus(), readyChainStatus(3)),
      maxShots: 1,
    });
    expect(batch).toEqual(['shot_1']);
  });

  it('renders nothing until both revision-matched status snapshots are ready', () => {
    // Same fail-closed rule the draft builder uses: an unready projection cannot be reasoned about.
    const project = makeProject();
    expect(filmRenderBatchShotIds({ project, projection: projectWorkspace(project, null, null) })).toEqual([]);
  });

  it('returns shots in film order, so the batch reads the way the film does', () => {
    const project = makeProject();
    const batch = filmRenderBatchShotIds({
      project,
      projection: projectWorkspace(project, readyWorkspaceStatus(), readyChainStatus(3)),
    });
    expect(batch).toEqual([...batch].sort((left, right) => (left < right ? -1 : 1)));
  });
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

  it('rejects invalid currency drafts and unsafe formatter inputs at their numeric boundaries', () => {
    expect(majorUnitsToMinorUnits('12')).toBe(1_200);
    expect(majorUnitsToMinorUnits('12.3')).toBe(1_230);
    expect(majorUnitsToMinorUnits('-1')).toBeNull();
    expect(majorUnitsToMinorUnits('900719925474099.99')).toBeNull();
    expect(formatMinorUnits(-1, 'USD', 'en-US')).toBe('');
  });

  it('refuses impossible gate transitions and classifies an unreviewed quote-in-use as an ordinary error', () => {
    const closed = initialSpendGateState();
    expect(spendGateReducer(closed, { type: 'prepare_started' })).toBe(closed);
    expect(spendGateReducer(closed, { type: 'prepare_succeeded', options: options() })).toBe(closed);
    expect(spendGateReducer(closed, { type: 'confirm_started' })).toBe(closed);
    expect(spendGateReducer(closed, { type: 'confirmed' })).toBe(closed);
    expect(spendGateReducer(closed, { type: 'select_option', option: 'withCascade' })).toBe(closed);

    const opened = spendGateReducer(closed, { type: 'open', draft });
    const baseOnly = { ...options(), withCascade: null };
    const reviewed = spendGateReducer(opened, { type: 'prepare_succeeded', options: baseOnly });
    expect(spendGateReducer(reviewed, { type: 'select_option', option: 'withCascade' })).toBe(reviewed);
    expect(
      selectedSpendGateQuote(spendGateReducer(closed, { type: 'confirm_failed', error: { code: 'quote_in_use' } }))
    ).toBeNull();
    expect(spendGateReducer(closed, { type: 'confirm_failed', error: { code: 'unexpected_failure' } }).phase).toBe(
      'error'
    );
  });
});

describe('WorkspaceControls', () => {
  beforeEach(() => window.sessionStorage.clear());

  it('resets only settings while preserving a Brief draft', async () => {
    window.sessionStorage.setItem(
      'aionui:creative-studio:v2:workspace-drafts:project_1',
      JSON.stringify({
        version: 2,
        projectId: 'project_1',
        sourceRevision: 3,
        entries: {
          'brief.text': { baseValue: 'A launch film.', value: 'Changed brief' },
        },
        selection: { selectedBeatId: null, selectedShotIds: [], anchorShotId: null },
      })
    );
    render(<ControlsHarness routes={routeCatalog('ready', 'ready')} open={vi.fn()} />);
    const settings = await openProjectMenuDialog('conversation.creativeStudio.workspace.controls.settingsTitle');
    fireEvent.change(within(settings).getByLabelText('conversation.creativeStudio.workspace.controls.name'), {
      target: { value: 'Changed name' },
    });
    fireEvent.click(
      within(settings).getByRole('button', { name: 'conversation.creativeStudio.workspace.controls.reset' })
    );
    expect(within(settings).getByLabelText('conversation.creativeStudio.workspace.controls.name')).toHaveValue(
      'Launch film'
    );
    expect(window.sessionStorage.getItem('aionui:creative-studio:v2:workspace-drafts:project_1')).toContain(
      'Changed brief'
    );
  });

  it('does not reopen a dismissed panel when a lifted Beat returns to the active film', async () => {
    const initial = makeProject();
    const lifted = makeProject();
    lifted.revision = 4;
    lifted.beatOrder = ['beat_2'];
    const restored = makeProject();
    restored.revision = 5;

    const { rerender } = render(
      <ControlsHarness routes={routeCatalog('ready', 'ready')} open={vi.fn()} project={initial} />
    );
    const table = screen.getByRole('grid', { name: 'conversation.creativeStudio.workspace.table.label' });
    fireEvent.click(within(within(table).getAllByRole('row')[1]!).getAllByRole('gridcell')[1]!);
    expect(screen.getByRole('dialog')).toBeVisible();

    rerender(<ControlsHarness routes={routeCatalog('ready', 'ready')} open={vi.fn()} project={lifted} />);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    rerender(<ControlsHarness routes={routeCatalog('ready', 'ready')} open={vi.fn()} project={restored} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(within(screen.getByRole('grid')).getAllByRole('row')[1]).toHaveAttribute('aria-selected', 'false');
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
        selection: { selectedBeatId: null, selectedShotIds: [], anchorShotId: null },
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

    await openProjectMenuDialog('conversation.creativeStudio.workspace.controls.settingsTitle');

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

  it('translates the stable undo code instead of rendering its raw identifier', () => {
    const status: StudioRendererWorkspaceStatusV2 = {
      ...lockedWorkspaceStatus(),
      undoTop: { entryId: 'undo_1', label: 'edit_shot', sourceRevision: 2 },
      dirtyShots: [],
      parkEligibility: [],
    };
    const { container } = render(
      <ControlsHarness routes={routeCatalog('ready', 'ready')} open={vi.fn()} status={status} />
    );

    expect(container).toHaveTextContent('edit shot');
    expect(container).not.toHaveTextContent('edit_shot');
  });

  it('keeps structural undo disabled while an authored Shot draft is unsaved', () => {
    window.sessionStorage.setItem(
      'aionui:creative-studio:v2:workspace-drafts:project_1',
      JSON.stringify({
        version: 2,
        projectId: 'project_1',
        sourceRevision: 3,
        entries: {
          'shot.shot_1.line': { baseValue: 'shot_1', value: 'Unsaved replacement' },
        },
        selection: { selectedBeatId: null, selectedShotIds: [], anchorShotId: null },
      })
    );
    const mutations = workspaceCallbacks();
    const status: StudioRendererWorkspaceStatusV2 = {
      ...readyWorkspaceStatus(),
      undoTop: { entryId: 'undo_1', label: 'edit_shot', sourceRevision: 2 },
    };
    render(
      <ControlsHarness routes={routeCatalog('ready', 'ready')} open={vi.fn()} status={status} mutations={mutations} />
    );

    const undo = screen.getByRole('button', { name: /conversation\.creativeStudio\.workspace\.controls\.undo/ });
    expect(undo).toBeDisabled();
    fireEvent.click(undo);
    expect(mutations.undo).not.toHaveBeenCalled();
    expect(screen.getByText('conversation.creativeStudio.workspace.beatPanel.blocker.unsavedDrafts')).toBeVisible();
  });

  it('clears normalized no-op setting and spend drafts without issuing a commit', async () => {
    const mutations = workspaceCallbacks();
    render(
      <ControlsHarness routes={routeCatalog('ready', 'ready')} open={vi.fn()} spendPolicy mutations={mutations} />
    );
    const settings = await openProjectMenuDialog('conversation.creativeStudio.workspace.controls.settingsTitle');
    fireEvent.change(within(settings).getByLabelText('conversation.creativeStudio.workspace.controls.name'), {
      target: { value: ' Launch film ' },
    });
    fireEvent.click(
      within(settings).getByRole('button', { name: 'conversation.creativeStudio.workspace.controls.saveSettings' })
    );
    await waitFor(() =>
      expect(within(settings).getByLabelText('conversation.creativeStudio.workspace.controls.name')).toHaveValue(
        'Launch film'
      )
    );
    expect(mutations.editProject).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    const brief = await openProjectMenuDialog('conversation.creativeStudio.workspace.controls.briefAndRulesTitle');
    fireEvent.change(within(brief).getByLabelText('conversation.creativeStudio.workspace.controls.spendCap'), {
      target: { value: '10.0' },
    });
    fireEvent.click(
      within(brief).getByRole('button', { name: 'conversation.creativeStudio.workspace.controls.saveBrief' })
    );
    await waitFor(() =>
      expect(within(brief).getByLabelText('conversation.creativeStudio.workspace.controls.spendCap')).toHaveValue(
        '10.00'
      )
    );
    expect(mutations.applyAuthoring).not.toHaveBeenCalled();
  });

  it('blocks malformed spend policy and saves the normalized Brief and policy together', async () => {
    const mutations = workspaceCallbacks();
    render(<ControlsHarness routes={routeCatalog('ready', 'ready')} open={vi.fn()} mutations={mutations} />);
    const dialog = await openProjectMenuDialog('conversation.creativeStudio.workspace.controls.briefAndRulesTitle');
    const brief = within(dialog).getByLabelText('conversation.creativeStudio.workspace.controls.brief');
    const currency = within(dialog).getByLabelText('conversation.creativeStudio.workspace.controls.spendCurrency');
    const cap = within(dialog).getByLabelText('conversation.creativeStudio.workspace.controls.spendCap');
    const save = within(dialog).getByRole('button', {
      name: 'conversation.creativeStudio.workspace.controls.saveBrief',
    });

    fireEvent.change(currency, { target: { value: 'US' } });
    fireEvent.change(cap, { target: { value: '12.34' } });
    fireEvent.click(save);
    expect(await screen.findByText('conversation.creativeStudio.workspace.controls.invalidSpendPolicy')).toBeVisible();
    expect(mutations.applyAuthoring).not.toHaveBeenCalled();

    fireEvent.change(brief, { target: { value: 'A more exact launch film.' } });
    fireEvent.change(currency, { target: { value: 'eur' } });
    fireEvent.click(save);

    await waitFor(() =>
      expect(mutations.applyAuthoring).toHaveBeenCalledWith([
        { kind: 'set_brief', brief: 'A more exact launch film.' },
        { kind: 'set_spend_policy', policy: { currency: 'EUR', maxPerBatchMinorUnits: 1_234 } },
      ])
    );
    expect(screen.queryByText('conversation.creativeStudio.workspace.controls.invalidSpendPolicy')).toBeNull();
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

  it('renders the structured pricing refusal reason without retrying or confirming', async () => {
    mocks.prepare.mockResolvedValue({
      ok: false,
      error: {
        code: 'pricing_refused',
        reason: 'missing_conditioning',
        messageKey: 'conversation.creativeStudio.errors.pricingRefused',
      },
    });
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Open review' }));
    fireEvent.click(screen.getByRole('button', { name: 'conversation.creativeStudio.workspace.gate.prepare' }));

    expect(
      await screen.findByText('conversation.creativeStudio.workspace.gate.errors.pricing.missingConditioning')
    ).toBeVisible();
    expect(mocks.prepare).toHaveBeenCalledTimes(1);
    expect(mocks.confirm).not.toHaveBeenCalled();
  });

  it('projects an unknown pricing reason to the generic refusal without exposing hostile diagnostics', async () => {
    mocks.prepare.mockResolvedValue({
      ok: false,
      error: {
        code: 'pricing_refused',
        reason: 'route_secret_apiKey',
        messageKey: 'provider body secret',
        stack: 'private stack',
      },
    });
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Open review' }));
    fireEvent.click(screen.getByRole('button', { name: 'conversation.creativeStudio.workspace.gate.prepare' }));

    expect(await screen.findByText('conversation.creativeStudio.workspace.gate.errors.generic')).toBeVisible();
    expect(document.body).not.toHaveTextContent('route_secret_apiKey');
    expect(document.body).not.toHaveTextContent('provider body secret');
    expect(document.body).not.toHaveTextContent('private stack');
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
