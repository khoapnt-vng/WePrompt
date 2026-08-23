import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Modal } from '@arco-design/web-react';
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
  listRoutes: vi.fn(),
  prepare: vi.fn(),
  confirm: vi.fn(),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    creativeStudio: {
      listRoutes: { invoke: mocks.listRoutes },
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
      if (key === 'conversation.creativeStudio.workspace.gate.continuity.confirmSever') {
        return `Confirm hard cut + ${String(values?.count)} generations · ${String(values?.cost)}`;
      }
      if (key === 'conversation.creativeStudio.workspace.gate.continuity.confirmRejoin') {
        return `Confirm rejoin + ${String(values?.count)} generations · ${String(values?.cost)}`;
      }
      if (key === 'conversation.creativeStudio.workspace.gate.continuity.severConfirmed') {
        return 'Hard cut confirmed. Review the Shot for seed and replacement progress or any required recovery.';
      }
      if (key === 'conversation.creativeStudio.workspace.gate.continuity.rejoinConfirmed') {
        return 'Rejoin confirmed. Review the Shot for frame extraction and replacement progress or any required recovery.';
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
  continuityGateDraft,
  formatMinorUnits,
  handoffGateDraft,
  initialSpendGateState,
  majorUnitsToMinorUnits,
  projectWorkspace,
  selectedSpendGateQuote,
  filmRenderBatchShotIds,
  selectionGateDraft,
  spendGateReducer,
  spendGateRouteIssue,
  useWorkspaceDrafts,
  useSpendGate,
  type BeatPanelActions,
  type BoardActions,
  type CutActions,
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
    canRetry: false,
    canRetryDownload: false,
    retryOfJobId: null,
    retryReason: null,
    duplicateChargeAcknowledged: false,
    duplicateChargeAcknowledgedAt: null,
    purpose: 'video_take',
    spendReceipt: null,
    createdAt: '2026-08-19T00:00:00.000Z',
    updatedAt: '2026-08-19T00:00:00.000Z',
    ...overrides,
  }) as StudioRendererJobV2;

const makeProject = (): StudioRendererProjectV2 =>
  ({
    schemaVersion: 3,
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
          videoAssetId: null,
          assetIds: [],
          jobIds: [],
        },
      ])
    ),
    bin: [],
    bedAssetId: null,
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
      generationCount: 1,
      durationSeconds: null,
      oneGenerationMinorUnits: 125,
      requestedTotalMinorUnits: 125,
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
        },
      ]
    : [],
  lowerMinorUnits: cascade ? 525 : 125,
  upperMinorUnits: cascade ? 525 : 125,
  budget: { kind: 'within_cap', policyCurrency: 'USD', maxPerBatchMinorUnits: 1_000 },
});

const options = (): StudioRendererPreparedSubmissionOptionsV2 => ({
  baseOnly: quote('quote_base'),
  withCascade: quote('quote_cascade', true),
});

const continuityQuote = (): StudioRendererSubmissionQuoteV2 => ({
  id: 'quote_continuity',
  projectId: 'project_1',
  projectRevision: 3,
  expiresAt: '2026-08-19T01:00:00.000Z',
  currency: 'USD',
  baseItems: [
    {
      shotId: 'shot_2',
      purpose: 'seed_still',
      route: { choiceId: 'image_choice', providerId: 'safe_provider', model: 'safe_model' },
      generationCount: 1,
      durationSeconds: null,
      oneGenerationMinorUnits: 125,
      requestedTotalMinorUnits: 125,
    },
    {
      shotId: 'shot_2',
      purpose: 'video_take',
      route: { choiceId: 'video_choice', providerId: 'safe_video', model: 'video_model' },
      generationCount: 1,
      durationSeconds: 4,
      oneGenerationMinorUnits: 400,
      requestedTotalMinorUnits: 400,
    },
  ],
  cascadeItems: [],
  lowerMinorUnits: 525,
  upperMinorUnits: 525,
  budget: { kind: 'within_cap', policyCurrency: 'USD', maxPerBatchMinorUnits: 1_000 },
});

const draft = {
  projectId: 'project_1',
  expectedRevision: 3,
  originReferenceHandoffId: null,
  baseChoices: [{ shotId: 'shot_1', purpose: 'seed_still' as const, referenceAssetId: null }],
  cascadeChoices: [{ shotId: 'shot_1', purpose: 'video_take' as const, referenceAssetId: null }],
};

const Harness: React.FC<{
  gateDraft?: typeof draft;
  onEditRoutes?: ReturnType<typeof vi.fn>;
  reenterOnConfirmed?: boolean;
  rejectOnConfirmed?: boolean;
}> = ({ gateDraft = draft, onEditRoutes = vi.fn(), reenterOnConfirmed = false, rejectOnConfirmed = false }) => {
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
      <button onClick={() => gate.open(gateDraft)}>Open review</button>
      <button onClick={() => void gate.confirm()}>Invoke confirm directly</button>
      <SpendGateModal {...gate} onEditRoutes={onEditRoutes} />
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
});

const beatPanelActions = (): BeatPanelActions => ({
  saveBeat: vi.fn(async () => true),
  saveShot: vi.fn(async () => true),
  setSeedStill: vi.fn(async () => true),
  trimShot: vi.fn(async () => true),
  reorderShots: vi.fn(async () => true),
  redetachLine: vi.fn(async () => true),
  restoreLine: vi.fn(async () => true),
  importSeedStill: vi.fn(async () => 'cancelled'),
  parkShot: vi.fn(async () => true),
  parkBeat: vi.fn(async () => true),
  reviewShot: vi.fn(),
  reviewContinuity: vi.fn(),
  retryGenerationJob: vi.fn(async () => true),
  cancelGenerationJob: vi.fn(async () => true),
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
  reorderBin: vi.fn(async () => true),
});

const cutActions = (): CutActions => ({
  reorderBeats: vi.fn(async () => true),
  importBedAudio: vi.fn(async () => 'cancelled'),
  setBed: vi.fn(async () => true),
  detachBedAudio: vi.fn(async () => true),
  createExport: vi.fn(async () => true),
  refreshExports: vi.fn(async () => true),
  copyExport: vi.fn(async () => 'cancelled'),
  revealExport: vi.fn(async () => true),
});

const readyWorkspaceStatus = (source: number | StudioRendererProjectV2 = 3): StudioRendererWorkspaceStatusV2 => {
  const revision = typeof source === 'number' ? source : source.revision;
  const currentVideoJobs =
    typeof source === 'number'
      ? [
          { shotId: 'shot_1', jobIds: [] },
          { shotId: 'shot_2', jobIds: [] },
          { shotId: 'shot_3', jobIds: [] },
        ]
      : source.beatOrder.flatMap((beatId) =>
          (source.beats[beatId]?.shotOrder ?? []).map((shotId) => ({
            shotId,
            jobIds: (source.shots[shotId]?.jobIds ?? []).filter((jobId) => {
              const job = source.jobs[jobId];
              return job?.id === jobId && job.shotId === shotId && job.purpose === 'video_take';
            }),
          }))
        );
  return {
    projectId: typeof source === 'number' ? 'project_1' : source.id,
    projectRevision: revision,
    undoTop: null,
    dirtyShots: [],
    cascadeProgress: [],
    currentVideoJobs,
    parkEligibility: [],
  };
};

const parkableWorkspaceStatus = (projectId = 'project_1', revision = 3): StudioRendererWorkspaceStatusV2 => ({
  ...readyWorkspaceStatus(revision),
  projectId,
  parkEligibility: [
    {
      subject: 'shot',
      action: 'park',
      beatId: 'beat_1',
      shotId: 'shot_1',
      allowed: true,
      blockers: [],
    },
  ],
});

const readyChainStatus = (source: number | StudioRendererProjectV2 = 3): StudioRendererChainStatusV2 => ({
  projectId: typeof source === 'number' ? 'project_1' : source.id,
  projectRevision: typeof source === 'number' ? source : source.revision,
  conditioningFailures: [],
  boundaries:
    typeof source === 'number'
      ? [
          {
            upstreamShotId: 'shot_1',
            dependentShotId: 'shot_2',
            status: 'empty',
            frameAssetId: null,
          },
        ]
      : source.beatOrder.flatMap((beatId) => {
          const shotOrder = source.beats[beatId]?.shotOrder ?? [];
          return shotOrder.slice(1).flatMap((dependentShotId, index) => {
            const upstreamShotId = shotOrder[index]!;
            return source.shots[dependentShotId]?.chainBreak === 'hard_cut'
              ? []
              : [{ upstreamShotId, dependentShotId, status: 'empty' as const, frameAssetId: null }];
          });
        }),
});

const readyProjection = (project: StudioRendererProjectV2) =>
  projectWorkspace(project, readyWorkspaceStatus(project), readyChainStatus(project));

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
  beatActions?: BeatPanelActions;
  briefDialogRequest?: number;
  activeView?: 'table' | 'board' | 'cut';
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
  beatActions = beatPanelActions(),
  briefDialogRequest = 0,
  activeView = 'table',
}) => {
  const project = projectOverride === undefined ? makeProject() : { ...projectOverride };
  if (spendPolicy) project.spendPolicy = { currency: 'USD', maxPerBatchMinorUnits: 1_000 };
  const projection = projectWorkspace(
    project,
    status === undefined ? readyWorkspaceStatus(project) : status,
    chain === undefined ? readyChainStatus(project) : chain
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
        briefDialogRequest={briefDialogRequest}
      />
      <WorkspaceControls
        activeView={activeView}
        project={project}
        projection={projection}
        exportCatalog={null}
        drafts={drafts}
        pending={pending}
        gateLocked={gateLocked}
        errorMessageKey={null}
        exportErrorMessageKey={null}
        mutations={mutations}
        boardActions={boardActions()}
        cutActions={cutActions()}
        beatPanelActions={beatActions}
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

  it('honours the per-request shot cap, counting the cascade against it', () => {
    // shot_1 cannot be rendered alone: choosing it commits shot_2 with it, so a cap of one admits no
    // segment at all. Returning shot_1 here would hand back a batch the spend gate then refuses.
    const project = makeProject();
    const batch = filmRenderBatchShotIds({
      project,
      projection: projectWorkspace(project, readyWorkspaceStatus(), readyChainStatus(3)),
      maxShots: 1,
    });
    expect(batch).toEqual([]);
  });

  it('starts an incomplete segment at the Shot that needs work, not at its head', () => {
    // beat_1 chains shot_1 -> shot_2. If shot_1 is already rendered and shot_2 is not, re-rendering
    // shot_1 pays again for a finished Shot and drags shot_2 along behind it. The missing Shot is the
    // one to start from; its upstream frame already exists.
    const project = makeProject();
    const assetId = 'shot_1_take';
    project.assets[assetId] = {
      id: assetId,
      projectId: project.id,
      shotId: 'shot_1',
      mediaKind: 'video',
      mimeType: 'video/mp4',
      managedAsset: { collection: 'assets', fileName: `${assetId}.mp4` },
      byteSize: 1024,
      sha256: 'b'.repeat(64),
      createdAt: '2026-08-23T00:00:00.000Z',
      durationSeconds: 4,
    } as StudioAssetV2;
    project.shots.shot_1!.assetIds = [assetId];
    project.shots.shot_1!.videoAssetId = assetId;
    const projection = projectWorkspace(project, readyWorkspaceStatus(project), readyChainStatus(project));

    expect(filmRenderBatchShotIds({ project, projection })).toEqual(['shot_2', 'shot_3']);
  });

  it('skips a segment that is already covered, so the film-wide batch means render what is missing', () => {
    // A partly-rendered film re-offered its finished Beats and never reached the unrendered ones,
    // because segments were packed in film order regardless of coverage. Confirming that would have
    // charged again for work already paid for and still left the film unfinished.
    const project = makeProject();
    for (const shotId of ['shot_1', 'shot_2'] as const) {
      const assetId = `${shotId}_take`;
      project.assets[assetId] = {
        id: assetId,
        projectId: project.id,
        shotId,
        mediaKind: 'video',
        mimeType: 'video/mp4',
        managedAsset: { collection: 'assets', fileName: `${assetId}.mp4` },
        byteSize: 1024,
        sha256: 'a'.repeat(64),
        createdAt: '2026-08-23T00:00:00.000Z',
        durationSeconds: 4,
      } as StudioAssetV2;
      project.shots[shotId]!.assetIds = [assetId];
      project.shots[shotId]!.videoAssetId = assetId;
    }
    const projection = projectWorkspace(project, readyWorkspaceStatus(project), readyChainStatus(project));

    expect(filmRenderBatchShotIds({ project, projection })).toEqual(['shot_3']);
  });

  it('counts the cascade each segment drags in, not only the segment heads', () => {
    // beat_1's head cascades to shot_2 as well, so a batch of two heads touches three Shots. The cap
    // is on distinct Shot ids across the whole selection, so counting heads lets the batch exceed it
    // and the draft is then refused as unpayable — which is what a 30-Shot film hit in practice.
    const project = makeProject();
    const projection = projectWorkspace(project, readyWorkspaceStatus(), readyChainStatus(3));

    expect(filmRenderBatchShotIds({ project, projection, maxShots: 2 })).toEqual(['shot_1']);
  });

  it('only ever returns a batch the spend gate will accept', () => {
    const project = makeProject();
    const projection = projectWorkspace(project, readyWorkspaceStatus(), readyChainStatus(3));

    for (const maxShots of [1, 2, 3, 24]) {
      const batch = filmRenderBatchShotIds({ project, projection, maxShots });
      if (batch.length === 0) continue;
      expect(selectionGateDraft({ project, projection, orderedShotIds: batch }), `maxShots=${maxShots}`).not.toBeNull();
    }
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
    expect(batch).toEqual(batch.toSorted((left, right) => (left < right ? -1 : 1)));
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
      { shotId: 'shot_2', purpose: 'video_take', referenceAssetId: null },
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

    projection = projectWorkspace(project, readyWorkspaceStatus(project), {
      projectId: project.id,
      projectRevision: project.revision,
      conditioningFailures: [{ dependentShotId: 'shot_1', reason: 'conditioning_failed', canRetry: true }],
      boundaries: [
        {
          upstreamShotId: 'shot_1',
          dependentShotId: 'shot_2',
          status: 'empty',
          frameAssetId: null,
        },
      ],
    });
    expect(selectionGateDraft({ project, projection, orderedShotIds: ['shot_1'] })).toBeNull();
  });

  it('accepts one reference per seed choice, rejects legacy count authority, and refuses terminal handoff reopening', () => {
    const project = makeProject();
    const projection = readyProjection(project);
    const defaults = selectionGateDraft({ project, projection, orderedShotIds: ['shot_1'] })!;
    const customized = selectionGateDraft({
      project,
      projection,
      orderedShotIds: ['shot_1'],
      baseChoices: [{ ...defaults.baseChoices[0]!, referenceAssetId: 'brief_ref' }],
      cascadeChoices: defaults.cascadeChoices,
    });
    expect(customized?.baseChoices[0]).toEqual({
      shotId: 'shot_1',
      purpose: 'seed_still',
      referenceAssetId: 'brief_ref',
    });
    expect(
      selectionGateDraft({
        project,
        projection,
        orderedShotIds: ['shot_1'],
        baseChoices: [{ ...defaults.baseChoices[0]!, generationCount: 1 } as never],
        cascadeChoices: defaults.cascadeChoices,
      })
    ).toBeNull();
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

    const continuityDraft = {
      ...draft,
      baseChoices: [],
      cascadeChoices: [],
      continuityChange: { shotId: 'shot_2', hardCut: true, requiresSeedGeneration: true },
    };
    const continuityOpened = spendGateReducer(closed, { type: 'open', draft: continuityDraft });
    const refusedSiblingQuote = spendGateReducer(continuityOpened, {
      type: 'prepare_succeeded',
      options: options(),
    });
    expect(refusedSiblingQuote).toMatchObject({ phase: 'error', options: null, errorCode: 'storage_error' });
    expect(selectedSpendGateQuote(refusedSiblingQuote)).toBeNull();
  });

  it('builds only exact non-first continuity drafts and diagnoses their required video route', () => {
    const project = makeProject();
    const projection = readyProjection(project);
    expect(continuityGateDraft({ project, projection, shotId: 'shot_1', hardCut: true })).toBeNull();
    expect(continuityGateDraft({ project, projection, shotId: 'shot_2', hardCut: false })).toBeNull();
    expect(continuityGateDraft({ project, projection, shotId: 'shot_2', hardCut: true })).toEqual({
      projectId: 'project_1',
      expectedRevision: 3,
      originReferenceHandoffId: null,
      baseChoices: [],
      cascadeChoices: [],
      continuityChange: { shotId: 'shot_2', hardCut: true, requiresSeedGeneration: true },
    });

    const continuityDraft = continuityGateDraft({ project, projection, shotId: 'shot_2', hardCut: true });
    expect(continuityDraft).not.toBeNull();
    expect(spendGateRouteIssue(routeCatalog('ready', 'unavailable'), continuityDraft!)).toBe('video');
    expect(spendGateRouteIssue(routeCatalog('unavailable', 'ready'), continuityDraft!)).toBe('image');
    expect(spendGateRouteIssue(routeCatalog('unavailable', 'unavailable'), continuityDraft!)).toBe('image_and_video');

    project.assets.seed_existing = makeAsset('seed_existing', 'shot_2');
    project.shots.shot_2!.assetIds.push('seed_existing');
    const reusable = continuityGateDraft({
      project,
      projection: readyProjection(project),
      shotId: 'shot_2',
      hardCut: true,
    });
    expect(reusable?.continuityChange).toEqual({
      shotId: 'shot_2',
      hardCut: true,
      requiresSeedGeneration: false,
    });
    expect(spendGateRouteIssue(routeCatalog('unavailable', 'ready'), reusable!)).toBeNull();

    project.shots.shot_2!.chainBreak = 'hard_cut';
    expect(
      continuityGateDraft({
        project,
        projection: readyProjection(project),
        shotId: 'shot_2',
        hardCut: false,
      })?.continuityChange
    ).toEqual({ shotId: 'shot_2', hardCut: false, requiresSeedGeneration: false });
  });
});

describe('WorkspaceControls', () => {
  beforeEach(() => window.sessionStorage.clear());

  const openFirstBeatPanel = (): HTMLElement => {
    const table = screen.getByRole('grid', { name: 'conversation.creativeStudio.workspace.table.label' });
    fireEvent.click(within(within(table).getAllByRole('row')[1]!).getAllByRole('gridcell')[1]!);
    return screen.getByRole('dialog');
  };

  const confirmFirstShotMoveToBin = async (): Promise<void> => {
    const modalConfirm = vi.spyOn(Modal, 'confirm').mockImplementation(() => ({
      close: vi.fn(),
      update: vi.fn(),
    }));
    try {
      const shot = document.querySelector<HTMLElement>('article[data-shot-id="shot_1"]');
      if (shot === null) throw new Error('Shot 1 was unavailable');
      const overflow = shot.querySelector<HTMLButtonElement>('[data-shot-overflow-trigger]');
      if (overflow === null) throw new Error('Shot 1 overflow was unavailable');
      expect(overflow).toBeEnabled();
      fireEvent.click(overflow);
      const menu = await screen.findByRole('menu');
      fireEvent.click(
        within(menu).getByRole('menuitem', {
          name: 'conversation.creativeStudio.workspace.beatPanel.lift.shot',
        })
      );
      const confirmation = modalConfirm.mock.calls.at(-1)?.[0];
      if (confirmation === undefined) throw new Error('Shot confirmation was unavailable');
      expect(confirmation.okText).toBe('conversation.creativeStudio.workspace.beatPanel.lift.confirmShot');
      act(() => {
        void confirmation.onOk?.();
      });
    } finally {
      modalConfirm.mockRestore();
    }
  };

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

  it('closes the panel and announces the exact Bin handoff only after a committed Shot park', async () => {
    const actions = beatPanelActions();
    vi.mocked(actions.parkShot).mockImplementation(async (_shotId, onCommitted) => {
      onCommitted?.();
      return true;
    });
    const { container } = render(
      <ControlsHarness
        routes={routeCatalog('ready', 'ready')}
        open={vi.fn()}
        status={parkableWorkspaceStatus()}
        beatActions={actions}
      />
    );
    openFirstBeatPanel();

    await confirmFirstShotMoveToBin();

    await waitFor(() => expect(actions.parkShot).toHaveBeenCalledWith('shot_1', expect.any(Function)));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(container.querySelector('[data-studio-shot-lift-announcement]')).toHaveTextContent(
      'conversation.creativeStudio.workspace.beatPanel.lift.shotSucceeded'
    );
  });

  it('does not let a stale Shot-park completion close the newly opened project panel', async () => {
    let releasePark: (() => void) | undefined;
    let finishPark: (() => void) | undefined;
    const parkGate = new Promise<void>((resolve) => {
      releasePark = resolve;
    });
    const parkFinished = new Promise<void>((resolve) => {
      finishPark = resolve;
    });
    const actions = beatPanelActions();
    vi.mocked(actions.parkShot).mockImplementation(async (_shotId, onCommitted) => {
      await parkGate;
      onCommitted?.();
      finishPark?.();
      return true;
    });
    const routes = routeCatalog('ready', 'ready');
    const projectOne = makeProject();
    const projectTwo = { ...makeProject(), id: 'project_2' };
    const projectTwoStatus = parkableWorkspaceStatus(projectTwo.id);
    const projectTwoChain = { ...readyChainStatus(), projectId: projectTwo.id };
    const result = render(
      <ControlsHarness
        routes={routes}
        open={vi.fn()}
        project={projectOne}
        status={parkableWorkspaceStatus()}
        beatActions={actions}
      />
    );
    openFirstBeatPanel();
    await confirmFirstShotMoveToBin();
    await waitFor(() => expect(actions.parkShot).toHaveBeenCalledWith('shot_1', expect.any(Function)));

    result.rerender(
      <ControlsHarness
        routes={routes}
        open={vi.fn()}
        project={projectTwo}
        status={projectTwoStatus}
        chain={projectTwoChain}
        beatActions={actions}
      />
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const projectTwoPanel = openFirstBeatPanel();

    await act(async () => {
      releasePark?.();
      await parkFinished;
    });

    expect(projectTwoPanel).toBeVisible();
    expect(screen.getByRole('dialog')).toBe(projectTwoPanel);
  });

  it('opens the exact Beat panel from the Cut and dismisses it when the workspace view changes', async () => {
    const { rerender } = render(
      <ControlsHarness activeView='cut' routes={routeCatalog('ready', 'ready')} open={vi.fn()} />
    );

    const secondBeat = document.querySelector<HTMLButtonElement>('[data-cut-filmstrip] [data-beat-id="beat_2"] button');
    if (secondBeat === null) throw new Error('Second Cut Beat was unavailable');
    fireEvent.click(secondBeat);
    fireEvent.click(screen.getByRole('button', { name: /conversation\.creativeStudio\.workspace\.cut\.openBeat/ }));

    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeVisible();
    expect(within(dialog).getByRole('heading', { name: 'Close' })).toBeVisible();
    expect(
      within(dialog).getByRole('region', { name: /conversation\.creativeStudio\.workspace\.beatPanel\.label/ })
    ).toBeVisible();

    rerender(<ControlsHarness activeView='table' routes={routeCatalog('ready', 'ready')} open={vi.fn()} />);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
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

  it('sends an enabled structural undo through its exact durable entry identity', async () => {
    const mutations = workspaceCallbacks();
    const status: StudioRendererWorkspaceStatusV2 = {
      ...readyWorkspaceStatus(),
      undoTop: { entryId: 'undo_exact', label: 'edit_shot', sourceRevision: 2 },
    };
    render(
      <ControlsHarness routes={routeCatalog('ready', 'ready')} open={vi.fn()} status={status} mutations={mutations} />
    );

    fireEvent.click(screen.getByRole('button', { name: /conversation\.creativeStudio\.workspace\.controls\.undo/ }));

    await waitFor(() => expect(mutations.undo).toHaveBeenCalledExactlyOnceWith('undo_exact'));
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

  it('opens Brief and rules directly when the spend gate requests route recovery', async () => {
    const view = render(
      <ControlsHarness routes={routeCatalog('selection_required', 'ready')} open={vi.fn()} briefDialogRequest={0} />
    );
    expect(
      screen.queryByRole('dialog', { name: 'conversation.creativeStudio.workspace.controls.briefAndRulesTitle' })
    ).toBeNull();

    view.rerender(
      <ControlsHarness routes={routeCatalog('selection_required', 'ready')} open={vi.fn()} briefDialogRequest={1} />
    );

    const dialog = await screen.findByRole('dialog', {
      name: 'conversation.creativeStudio.workspace.controls.briefAndRulesTitle',
    });
    expect(within(dialog).getByLabelText('conversation.creativeStudio.workspace.controls.imageRoute')).toBeVisible();
    expect(within(dialog).getByLabelText('conversation.creativeStudio.workspace.controls.videoRoute')).toBeVisible();
  });
});

describe('SpendGateModal', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.listRoutes.mockResolvedValue({ ok: true, data: routeCatalog('ready', 'ready') });
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

  it('names the unavailable image route before estimating and offers the Brief route picker', async () => {
    const onEditRoutes = vi.fn();
    mocks.listRoutes.mockResolvedValue({ ok: true, data: routeCatalog('selection_required', 'ready') });
    mocks.prepare.mockResolvedValue({ ok: false, error: { code: 'invalid_route' } });
    const imageOnlyDraft = { ...draft, cascadeChoices: [] };
    render(<Harness gateDraft={imageOnlyDraft} onEditRoutes={onEditRoutes} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open review' }));
    fireEvent.click(screen.getByRole('button', { name: 'conversation.creativeStudio.workspace.gate.prepare' }));

    expect(await screen.findByText('conversation.creativeStudio.workspace.controls.imageRouteBlocked')).toBeVisible();
    expect(mocks.prepare).toHaveBeenCalledTimes(1);
    fireEvent.click(
      screen.getByRole('button', { name: 'conversation.creativeStudio.workspace.controls.briefAndRulesTitle' })
    );
    expect(onEditRoutes).toHaveBeenCalledWith('image');
  });

  it('names both unavailable routes instead of presenting two contradictory partial-route messages', async () => {
    mocks.listRoutes.mockResolvedValue({ ok: true, data: routeCatalog('setup_required', 'unavailable') });
    mocks.prepare.mockResolvedValue({ ok: false, error: { code: 'invalid_route' } });
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Open review' }));
    fireEvent.click(screen.getByRole('button', { name: 'conversation.creativeStudio.workspace.gate.prepare' }));

    expect(
      await screen.findByText('conversation.creativeStudio.workspace.gate.errors.routesUnavailable')
    ).toBeVisible();
    expect(mocks.prepare).toHaveBeenCalledTimes(1);
  });

  it('checks routes after a failed estimate and replaces the generic error with the exact route', async () => {
    mocks.listRoutes.mockResolvedValue({ ok: true, data: routeCatalog('ready', 'unavailable') });
    mocks.prepare.mockResolvedValue({ ok: false, error: { code: 'invalid_route' } });
    const videoOnlyDraft = { ...draft, baseChoices: [], cascadeChoices: draft.cascadeChoices };
    render(<Harness gateDraft={videoOnlyDraft} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open review' }));
    fireEvent.click(screen.getByRole('button', { name: 'conversation.creativeStudio.workspace.gate.prepare' }));

    expect(await screen.findByText('conversation.creativeStudio.workspace.controls.videoRouteBlocked')).toBeVisible();
    expect(mocks.prepare).toHaveBeenCalledTimes(1);
    expect(mocks.listRoutes).toHaveBeenCalledTimes(1);
  });

  it('shows the original estimate failure without waiting for a stalled read-only route diagnosis', async () => {
    mocks.listRoutes.mockReturnValue(new Promise(() => undefined));
    mocks.prepare.mockResolvedValue({ ok: false, error: { code: 'invalid_route' } });
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Open review' }));
    fireEvent.click(screen.getByRole('button', { name: 'conversation.creativeStudio.workspace.gate.prepare' }));

    expect(await screen.findByText('conversation.creativeStudio.workspace.gate.errors.generic')).toBeVisible();
    expect(mocks.prepare).toHaveBeenCalledTimes(1);
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

  it('makes a continuity cascade mandatory, hides optional radios, and names the exact paid action', async () => {
    const continuityDraft = {
      projectId: 'project_1',
      expectedRevision: 3,
      originReferenceHandoffId: null,
      baseChoices: [],
      cascadeChoices: [],
      continuityChange: { shotId: 'shot_2', hardCut: true, requiresSeedGeneration: true },
    };
    mocks.prepare.mockResolvedValue({
      ok: true,
      data: { baseOnly: continuityQuote(), withCascade: null },
    });
    render(<Harness gateDraft={continuityDraft} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open review' }));
    const modal = await screen.findByTestId('studio-spend-gate');
    expect(modal).toHaveAttribute('data-gate-kind', 'continuity_change');
    expect(modal).toHaveAttribute('data-chain-change-intent', 'sever');
    expect(within(modal).getByTestId('studio-chain-change-summary')).toBeVisible();
    expect(within(modal).queryByRole('radio')).toBeNull();
    fireEvent.click(within(modal).getByRole('button', { name: 'conversation.creativeStudio.workspace.gate.prepare' }));

    await waitFor(() => expect(within(modal).getByText(/safe_video/)).toBeVisible());
    expect(within(modal).queryByRole('radio')).toBeNull();
    const requiredRows = within(modal).getAllByRole('listitem');
    expect(requiredRows[0]).toHaveAttribute('data-quote-group', 'required');
    expect(requiredRows[0]).toHaveTextContent('conversation.creativeStudio.workspace.gate.group.required');
    const confirm = within(modal).getByRole('button', {
      name: 'Confirm hard cut + 2 generations · $5.25',
    });
    expect(confirm).toHaveAttribute('data-chain-change-confirm');
    expect(confirm).not.toHaveTextContent(/up to/i);
    fireEvent.click(confirm);

    await waitFor(() =>
      expect(mocks.confirm).toHaveBeenCalledWith({
        projectId: 'project_1',
        quoteId: 'quote_continuity',
        expectedRevision: 3,
      })
    );
    expect(
      await within(modal).findByText(
        'Hard cut confirmed. Review the Shot for seed and replacement progress or any required recovery.'
      )
    ).toBeVisible();
  });

  it('fails closed when a continuity prepare response exposes a forbidden sibling quote', async () => {
    const continuityDraft = {
      projectId: 'project_1',
      expectedRevision: 3,
      originReferenceHandoffId: null,
      baseChoices: [],
      cascadeChoices: [],
      continuityChange: { shotId: 'shot_2', hardCut: true, requiresSeedGeneration: true },
    };
    mocks.prepare.mockResolvedValue({ ok: true, data: options() });
    render(<Harness gateDraft={continuityDraft} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open review' }));
    const modal = await screen.findByTestId('studio-spend-gate');
    fireEvent.click(within(modal).getByRole('button', { name: 'conversation.creativeStudio.workspace.gate.prepare' }));

    expect(await within(modal).findByText('conversation.creativeStudio.workspace.gate.errors.generic')).toBeVisible();
    expect(within(modal).queryByRole('radio')).toBeNull();
    expect(within(modal).queryByText(/safe_provider/)).toBeNull();
    expect(within(modal).queryByRole('button', { name: /workspace\.gate\.continuity\.confirm/ })).toBeNull();
    expect(mocks.confirm).not.toHaveBeenCalled();
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
