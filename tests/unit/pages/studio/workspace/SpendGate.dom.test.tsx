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
  prepareReferences: vi.fn(),
  confirm: vi.fn(),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    creativeStudio: {
      listRoutes: { invoke: mocks.listRoutes },
      prepareSubmission: { invoke: mocks.prepare },
      prepareProjectReferences: { invoke: mocks.prepareReferences },
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
        return `Confirm hard cut + ${String(values?.count)} ${values?.count === 1 ? 'generation' : 'generations'} · ${String(values?.cost)}`;
      }
      if (key === 'conversation.creativeStudio.workspace.gate.continuity.confirmRejoin') {
        return `Confirm rejoin + ${String(values?.count)} ${values?.count === 1 ? 'generation' : 'generations'} · ${String(values?.cost)}`;
      }
      if (key === 'conversation.creativeStudio.workspace.gate.continuity.severHeadline') {
        return `Hard cut · ${String(values?.count)} required ${values?.count === 1 ? 'generation' : 'generations'} · ${String(values?.cost)}`;
      }
      if (key === 'conversation.creativeStudio.workspace.gate.continuity.rejoinHeadline') {
        return `Rejoin · ${String(values?.count)} required ${values?.count === 1 ? 'generation' : 'generations'} · ${String(values?.cost)}`;
      }
      if (key === 'conversation.creativeStudio.workspace.gate.confirm') {
        return `${key} · Confirm ${String(values?.count)} ${values?.count === 1 ? 'generation' : 'generations'} · ${String(values?.cost)}`;
      }
      if (key === 'conversation.creativeStudio.workspace.gate.route') {
        return `${String(values?.provider)} · ${String(values?.model)} · ${String(values?.choice)}`;
      }
      if (key === 'conversation.creativeStudio.workspace.gate.routeShared') {
        return `All through ${String(values?.model)}`;
      }
      if (key === 'conversation.creativeStudio.workspace.gate.continuity.severConfirmed') {
        return 'Hard cut confirmed. Review the Shot for first-frame progress, replacement progress, or any required recovery.';
      }
      if (key === 'conversation.creativeStudio.workspace.gate.continuity.rejoinConfirmed') {
        return 'Rejoin confirmed. Review the Shot for frame extraction and replacement progress or any required recovery.';
      }
      if (key === 'conversation.creativeStudio.workspace.gate.promotion.summary') {
        return `Promote the current Board panel for Shot ${String(values?.shotId)}. This does not change the Shot's continuity boundary.`;
      }
      if (key === 'conversation.creativeStudio.workspace.gate.promotion.impactIntro') {
        return `${String(values?.count)} current takes will remain playable but become stale:`;
      }
      if (key === 'conversation.creativeStudio.workspace.gate.promotion.impactItem') {
        return `Shot ${String(values?.shotId)} current take`;
      }
      if (key === 'conversation.creativeStudio.workspace.gate.promotion.headline') {
        return `Promote + ${String(values?.count)} rerenders · ${String(values?.cost)}`;
      }
      if (key === 'conversation.creativeStudio.workspace.gate.promotion.confirm') {
        return `Confirm promotion + ${String(values?.count)} rerenders · ${String(values?.cost)}`;
      }
      const promotionCopy: Record<string, string> = {
        'conversation.creativeStudio.workspace.gate.promotion.title': 'Use panel as first frame',
        'conversation.creativeStudio.workspace.gate.promotion.impactNone': 'No current takes depend on this frame.',
        'conversation.creativeStudio.workspace.gate.promotion.optionsLabel': 'Choose how to handle current takes',
        'conversation.creativeStudio.workspace.gate.promotion.promoteOnly': 'Promote only — keep playable, stale takes',
        'conversation.creativeStudio.workspace.gate.promotion.freePrice': '$0',
        'conversation.creativeStudio.workspace.gate.promotion.promoteAndRerender':
          'Promote and review exact rerender work',
        'conversation.creativeStudio.workspace.gate.promotion.priceAfterReview': 'Price shown next',
        'conversation.creativeStudio.workspace.gate.promotion.promoteOnlyAction': 'Promote for $0',
        'conversation.creativeStudio.workspace.gate.promotion.reviewPaidAction': 'Review rerender price',
        'conversation.creativeStudio.workspace.gate.promotion.requiredWork':
          'The listed rerenders are exactly the current takes this promotion makes stale. Missing coverage is not included.',
        'conversation.creativeStudio.workspace.gate.promotion.promoted':
          'Panel promoted. Existing takes remain playable and are marked stale.',
        'conversation.creativeStudio.workspace.gate.promotion.confirmed':
          'Panel promoted and rerendering started for the confirmed takes.',
        'conversation.creativeStudio.workspace.gate.promotion.close': 'Close',
      };
      if (promotionCopy[key] !== undefined) return promotionCopy[key]!;
      return values === undefined ? key : `${key}:${JSON.stringify(values)}`;
    },
    i18n: { language: 'en-US', resolvedLanguage: 'en-US' },
  }),
}));

import {
  SpendGateModal,
  WorkspaceControls,
  WorkspaceProjectMenu,
  boardPromotionGatePlan,
  continuityGateDraft,
  formatMinorUnits,
  handoffGateDraft,
  initialSpendGateState,
  majorUnitsToMinorUnits,
  projectWorkspace,
  seedRegenerationGateDraft,
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
  type SpendGateBoardPromotionImpact,
  type SpendGateDraft,
  type SpendGateGenerationDisclosure,
  type TableBoardActions,
  type WorkspaceDraftValue,
  type WorkspaceMutationCallbacks,
} from '@/renderer/pages/studio/components/Workspace';
import { boardGateDraft, boardSelectionGateDraft } from '@/renderer/pages/studio/components/Workspace/spendGate';

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
  projectReferenceId: null,
  generationReferenceAssetIds: [],
  producerJobId: null,
  compositionDigest: null,
  ...(mediaKind === 'video' ? { durationSeconds: 4 } : {}),
  createdAt: '2026-08-19T00:00:00.000Z',
});

const makeJob = (id: string, shotId: string, overrides: Partial<StudioRendererJobV2>): StudioRendererJobV2 =>
  ({
    id,
    projectId: 'project_1',
    target: { kind: 'shot', shotId },
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
    composition: {
      inputs: {
        schemaVersion: 1,
        projectRevision: 3,
        brief: 'A launch film.',
        rules: [],
        source: { kind: 'shot', beatId: 'beat_1', story: 'Open', shotId, shootingScript: shotId },
        purpose: 'video_take',
        referenceInputs: [],
        aspectRatio: '16:9',
        resolution: '720p',
        route: { providerId: 'provider_safe', adapterId: 'openrouter-video-v1', model: 'model_safe' },
        boardStyle: null,
        instructionProfile: 'openrouter-video-v1.video-take.v1',
      },
      prompt: `Video prompt for ${shotId}`,
    },
    spendReceipt: null,
    createdAt: '2026-08-19T00:00:00.000Z',
    updatedAt: '2026-08-19T00:00:00.000Z',
    ...overrides,
  }) as StudioRendererJobV2;

const makeProject = (): StudioRendererProjectV2 =>
  ({
    schemaVersion: 5,
    revision: 3,
    id: 'project_1',
    name: 'Launch film',
    brief: 'A launch film.',
    rules: [],
    briefConversationId: null,
    aspectRatio: '16:9',
    targetDurationSeconds: 12,
    resolution: '720p',
    boardStyle: null,
    beatOrder: ['beat_1', 'beat_2'],
    beats: {
      beat_1: {
        id: 'beat_1',
        title: 'Opening',
        story: 'Open',
        targetSeconds: 8,
        shotOrder: ['shot_1', 'shot_2'],
      },
      beat_2: {
        id: 'beat_2',
        title: 'Close',
        story: 'Close',
        targetSeconds: 4,
        shotOrder: ['shot_3'],
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
          shootingScript: id,
          durationSeconds: 4,
          trimInSeconds: null,
          trimOutSeconds: null,
          chainBreak,
          referenceBinding: { status: 'ready', characterReferenceIds: [], backgroundReferenceId: null },
          seedStillId: null,
          dismissedSeedStillIds: [],
          boardAssetId: null,
          supersededBoardAssetIds: [],
          videoAssetId: null,
          supersededVideoAssetIds: [],
          assetIds: [],
          jobIds: [],
        },
      ])
    ),
    referencePlanStatus: 'planned',
    referenceOrder: [],
    references: {},
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

const makeBoardProject = (shotCount: number): StudioRendererProjectV2 => {
  const project = makeProject();
  const templateShot = project.shots.shot_1!;
  project.boardStyle = 'grey_tone';
  project.targetDurationSeconds = shotCount * 4;
  project.beatOrder = [];
  project.beats = {};
  project.shots = {};
  for (let offset = 0; offset < shotCount; offset += 8) {
    const beatNumber = offset / 8 + 1;
    const beatId = `board_beat_${beatNumber}`;
    const shotIds = Array.from({ length: Math.min(8, shotCount - offset) }, (_, index) => {
      const shotNumber = offset + index + 1;
      const shotId = `board_shot_${String(shotNumber).padStart(2, '0')}`;
      project.shots[shotId] = {
        ...templateShot,
        id: shotId,
        shootingScript: `Panel ${shotNumber}`,
        chainBreak: 'hard_cut',
        seedStillId: null,
        dismissedSeedStillIds: [],
        boardAssetId: null,
        supersededBoardAssetIds: [],
        videoAssetId: null,
        assetIds: [],
        jobIds: [],
      };
      return shotId;
    });
    project.beatOrder.push(beatId);
    project.beats[beatId] = {
      id: beatId,
      title: `Board Beat ${beatNumber}`,
      story: `Story ${beatNumber}`,
      targetSeconds: shotIds.length * 4,
      shotOrder: shotIds,
    };
  }
  return project;
};

const addCurrentBoardPanel = (project: StudioRendererProjectV2, shotId: string): { assetId: string; jobId: string } => {
  const assetId = `board_${shotId}`;
  const jobId = `board_job_${shotId}`;
  const shot = project.shots[shotId]!;
  project.assets[assetId] = makeAsset(assetId, shotId, 'image', 'boardStills');
  shot.boardAssetId = assetId;
  shot.assetIds.push(assetId);
  shot.jobIds.push(jobId);
  project.jobs[jobId] = makeJob(jobId, shotId, {
    purpose: 'board_still',
    provider: { choiceId: 'route_image', providerId: 'provider_safe', model: 'model_safe' },
    outputAssetIds: [assetId],
    outputAssetIdsByRole: { primary: assetId, poster: null },
    spendReceipt: {
      purpose: 'board_still',
      routeId: 'route_image',
      currency: 'USD',
      rateUnit: 'generation',
      rateMinorUnits: 3,
      durationSeconds: null,
      generationCount: 1,
      totalMinorUnits: 3,
    },
  });
  return { assetId, jobId };
};

const addCurrentVideoTake = (project: StudioRendererProjectV2, shotId: string): string => {
  const assetId = `video_${shotId}`;
  const shot = project.shots[shotId]!;
  project.assets[assetId] = makeAsset(assetId, shotId, 'video', 'assets');
  shot.videoAssetId = assetId;
  shot.assetIds.push(assetId);
  return assetId;
};

const shotComposition = (
  shotId: string,
  purpose: 'seed_still' | 'board_still' | 'video_take',
  providerId: string,
  model: string
) => {
  const adapterId = purpose === 'video_take' ? ('openrouter-video-v1' as const) : ('weprompt-image-v1' as const);
  return {
    inputs: {
      schemaVersion: 1 as const,
      projectRevision: 3,
      brief: 'A launch film.',
      rules: [],
      source: {
        kind: 'shot' as const,
        beatId: shotId === 'shot_3' ? 'beat_2' : 'beat_1',
        story: shotId === 'shot_3' ? 'Close' : 'Open',
        shotId,
        shootingScript: shotId,
      },
      purpose,
      referenceInputs: [],
      aspectRatio: '16:9' as const,
      resolution: '720p' as const,
      route: { providerId, adapterId, model },
      boardStyle: purpose === 'board_still' ? ('grey_tone' as const) : null,
      instructionProfile: `${adapterId}.${purpose.replaceAll('_', '-')}.v1`,
    },
    prompt: `Exact ${purpose} prompt for ${shotId}`,
  };
};

const referenceComposition = (referenceId: string) => ({
  inputs: {
    schemaVersion: 1 as const,
    projectRevision: 3,
    brief: 'A launch film.',
    rules: [],
    source: {
      kind: 'project_reference' as const,
      referenceId,
      referenceKind: 'character' as const,
      prompt: 'Ming in a red jacket.',
    },
    purpose: 'reference_image' as const,
    referenceInputs: [],
    aspectRatio: '16:9' as const,
    resolution: '720p' as const,
    route: { providerId: 'safe_provider', adapterId: 'weprompt-image-v1' as const, model: 'safe_model' },
    boardStyle: null,
    instructionProfile: 'weprompt-image-v1.reference-character.v1',
  },
  prompt: `Exact reference prompt for ${referenceId}`,
});

const quote = (id: string, cascade = false): StudioRendererSubmissionQuoteV2 => ({
  id,
  projectId: 'project_1',
  projectRevision: 3,
  expiresAt: '2026-08-19T01:00:00.000Z',
  currency: 'USD',
  baseItems: [
    {
      target: { kind: 'shot', shotId: 'shot_1' },
      referenceTarget: null,
      purpose: 'seed_still',
      route: { choiceId: 'image_choice', providerId: 'safe_provider', model: 'safe_model' },
      generationCount: 1,
      durationSeconds: null,
      conditioningAssetId: null,
      oneGenerationMinorUnits: 125,
      requestedTotalMinorUnits: 125,
      composition: shotComposition('shot_1', 'seed_still', 'safe_provider', 'safe_model'),
    },
  ],
  cascadeItems: cascade
    ? [
        {
          target: { kind: 'shot', shotId: 'shot_1' },
          referenceTarget: null,
          purpose: 'video_take',
          route: { choiceId: 'video_choice', providerId: 'safe_video', model: 'video_model' },
          generationCount: 1,
          durationSeconds: 4,
          conditioningAssetId: 'seed_shot_1',
          oneGenerationMinorUnits: 400,
          requestedTotalMinorUnits: 400,
          composition: shotComposition('shot_1', 'video_take', 'safe_video', 'video_model'),
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

const referenceOptions = (): StudioRendererPreparedSubmissionOptionsV2 => ({
  baseOnly: {
    ...quote('quote_reference'),
    baseItems: [
      {
        ...quote('quote_reference').baseItems[0]!,
        target: { kind: 'reference', referenceId: 'reference_ming' },
        referenceTarget: { referenceId: 'reference_ming', kind: 'character', label: 'Ming' },
        purpose: 'reference_image',
        durationSeconds: null,
        composition: referenceComposition('reference_ming'),
      },
    ],
  },
  withCascade: null,
});

const continuityQuote = (): StudioRendererSubmissionQuoteV2 => ({
  id: 'quote_continuity',
  projectId: 'project_1',
  projectRevision: 3,
  expiresAt: '2026-08-19T01:00:00.000Z',
  currency: 'USD',
  baseItems: [
    {
      target: { kind: 'shot', shotId: 'shot_2' },
      referenceTarget: null,
      purpose: 'seed_still',
      route: { choiceId: 'image_choice', providerId: 'safe_provider', model: 'safe_model' },
      generationCount: 1,
      durationSeconds: null,
      conditioningAssetId: null,
      oneGenerationMinorUnits: 125,
      requestedTotalMinorUnits: 125,
      composition: shotComposition('shot_2', 'seed_still', 'safe_provider', 'safe_model'),
    },
    {
      target: { kind: 'shot', shotId: 'shot_2' },
      referenceTarget: null,
      purpose: 'video_take',
      route: { choiceId: 'video_choice', providerId: 'safe_video', model: 'video_model' },
      generationCount: 1,
      durationSeconds: 4,
      conditioningAssetId: 'seed_shot_2',
      oneGenerationMinorUnits: 400,
      requestedTotalMinorUnits: 400,
      composition: shotComposition('shot_2', 'video_take', 'safe_video', 'video_model'),
    },
  ],
  cascadeItems: [],
  lowerMinorUnits: 525,
  upperMinorUnits: 525,
  budget: { kind: 'within_cap', policyCurrency: 'USD', maxPerBatchMinorUnits: 1_000 },
});

const promotionQuote = (): StudioRendererSubmissionQuoteV2 => ({
  id: 'quote_promotion',
  projectId: 'project_1',
  projectRevision: 3,
  expiresAt: '2026-08-19T01:00:00.000Z',
  currency: 'USD',
  baseItems: ['shot_1', 'shot_2'].map((shotId) => ({
    target: { kind: 'shot' as const, shotId },
    referenceTarget: null,
    purpose: 'video_take' as const,
    route: { choiceId: 'video_choice', providerId: 'safe_video', model: 'video_model' },
    generationCount: 1,
    durationSeconds: 4,
    conditioningAssetId: `seed_${shotId}`,
    oneGenerationMinorUnits: 400,
    requestedTotalMinorUnits: 400,
    composition: shotComposition(shotId, 'video_take', 'safe_video', 'video_model'),
  })),
  cascadeItems: [],
  lowerMinorUnits: 800,
  upperMinorUnits: 800,
  budget: { kind: 'within_cap', policyCurrency: 'USD', maxPerBatchMinorUnits: 1_000 },
});

const oneItemContinuityQuote = (): StudioRendererSubmissionQuoteV2 => ({
  ...continuityQuote(),
  id: 'quote_continuity_one',
  baseItems: [continuityQuote().baseItems[1]!],
  lowerMinorUnits: 400,
  upperMinorUnits: 400,
});

const draft = {
  projectId: 'project_1',
  expectedRevision: 3,
  originReferenceHandoffId: null,
  baseChoices: [{ target: { kind: 'shot' as const, shotId: 'shot_1' }, purpose: 'seed_still' as const }],
  cascadeChoices: [{ target: { kind: 'shot' as const, shotId: 'shot_1' }, purpose: 'video_take' as const }],
};

const promotionDraft: SpendGateDraft = {
  projectId: 'project_1',
  expectedRevision: 3,
  originReferenceHandoffId: null,
  baseChoices: [],
  cascadeChoices: [],
  boardPromotion: { shotId: 'shot_1', boardAssetId: 'board_shot_1' },
};

const Harness: React.FC<{
  gateDraft?: SpendGateDraft;
  boardPromotionImpact?: SpendGateBoardPromotionImpact;
  generationDisclosure?: SpendGateGenerationDisclosure;
  onEditRoutes?: ReturnType<typeof vi.fn>;
  onPromoteOnly?: ReturnType<typeof vi.fn>;
  reenterOnConfirmed?: boolean;
  rejectOnConfirmed?: boolean;
  projectReferences?: React.ComponentProps<typeof SpendGateModal>['projectReferences'];
}> = ({
  gateDraft = draft,
  boardPromotionImpact,
  generationDisclosure,
  onEditRoutes = vi.fn(),
  onPromoteOnly = vi.fn(async () => true),
  reenterOnConfirmed = false,
  rejectOnConfirmed = false,
  projectReferences,
}) => {
  const gateRef = useRef<ReturnType<typeof useSpendGate> | null>(null);
  const gate = useSpendGate({
    onConfirmed: async () => {
      if (reenterOnConfirmed) await gateRef.current?.confirm();
      if (rejectOnConfirmed) throw new Error('refresh failed');
    },
    onPromoteOnly,
  });
  gateRef.current = gate;
  return (
    <>
      <button onClick={() => gate.open(gateDraft, boardPromotionImpact, generationDisclosure)}>Open review</button>
      <button onClick={() => void gate.prepare()}>Invoke prepare directly</button>
      <button onClick={() => void gate.confirm()}>Invoke confirm directly</button>
      <SpendGateModal
        {...gate}
        onEditRoutes={onEditRoutes}
        onReviewShotBinding={vi.fn()}
        projectReferences={projectReferences}
      />
    </>
  );
};

const openPreparedGate = async (preparedOptions: StudioRendererPreparedSubmissionOptionsV2): Promise<HTMLElement> => {
  mocks.prepare.mockResolvedValue({ ok: true, data: preparedOptions });
  render(<Harness />);
  fireEvent.click(screen.getByRole('button', { name: 'Open review' }));
  const modal = await screen.findByTestId('studio-spend-gate');
  await within(modal).findByRole('button', {
    name: 'conversation.creativeStudio.workspace.gate.showBreakdown',
  });
  return modal;
};

const showGateBreakdown = (modal: HTMLElement): void => {
  fireEvent.click(
    within(modal).getByRole('button', {
      name: 'conversation.creativeStudio.workspace.gate.showBreakdown',
    })
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
  importSeedStill: vi.fn(async () => 'cancelled'),
  persistCapturedPoster: vi.fn(async () => true),
  parkShot: vi.fn(async () => true),
  parkBeat: vi.fn(async () => true),
  reviewShot: vi.fn(),
  reviewContinuity: vi.fn(),
  retryGenerationJob: vi.fn(async () => true),
  cancelGenerationJob: vi.fn(async () => true),
  retryConditioning: vi.fn(async () => true),
  cancelWaiting: vi.fn(async () => true),
  requestResplit: vi.fn(),
});

const tableBoardActions = (): TableBoardActions => ({
  setStyle: vi.fn(),
  drawNext: vi.fn(),
  drawBeat: vi.fn(),
  redrawShot: vi.fn(),
  redrawBeat: vi.fn(),
  promotePanel: vi.fn(),
  stop: vi.fn(),
  retryJob: vi.fn(),
  retryDownload: vi.fn(),
  cancelJob: vi.fn(),
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
  const activeShotIds =
    typeof source === 'number'
      ? ['shot_1', 'shot_2', 'shot_3']
      : source.beatOrder.flatMap((beatId) => source.beats[beatId]?.shotOrder ?? []);
  const currentVideoJobs =
    typeof source === 'number'
      ? activeShotIds.map((shotId) => ({ shotId, jobIds: [] }))
      : source.beatOrder.flatMap((beatId) =>
          (source.beats[beatId]?.shotOrder ?? []).map((shotId) => ({
            shotId,
            jobIds: (source.shots[shotId]?.jobIds ?? []).filter((jobId) => {
              const job = source.jobs[jobId];
              return (
                job?.id === jobId &&
                job.target.kind === 'shot' &&
                job.target.shotId === shotId &&
                job.purpose === 'video_take'
              );
            }),
          }))
        );
  return {
    projectId: typeof source === 'number' ? 'project_1' : source.id,
    projectRevision: revision,
    undoTop: null,
    dirtyShots: [],
    boardPanels: activeShotIds.map((shotId) => ({
      shotId,
      assetId: null,
      producerJobId: null,
      latestJobId: null,
      staleCauses: [],
    })),
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
    canonicalValues[`beat.${beatId}.story`] = beat.story;
    canonicalValues[`beat.${beatId}.targetSeconds`] = beat.targetSeconds;
    for (const shotId of beat.shotOrder) {
      const shot = project.shots[shotId];
      if (shot === undefined) continue;
      canonicalValues[`shot.${shotId}.shootingScript`] = shot.shootingScript;
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
        generationCapability={null}
        exportCatalog={null}
        filmExportCapability={null}
        createEditorFolder={vi.fn(async () => ({ ok: false as const, messageKey: 'unavailable' }))}
        revealEditorFolder={vi.fn(async () => ({ ok: false as const, messageKey: 'unavailable' }))}
        createFilm={vi.fn(async () => ({ ok: false as const, messageKey: 'unavailable' }))}
        getFilmExportStatus={vi.fn(async () => ({ status: 'idle' as const }))}
        refreshExports={vi.fn(async () => true)}
        cancelFilmExport={vi.fn(async () => false)}
        acknowledgeFilmExport={vi.fn(async () => true)}
        revealFilm={vi.fn(async () => ({ ok: false as const, messageKey: 'unavailable' }))}
        detachBedAudio={vi.fn(async () => false)}
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
        imageRouteReady
        errorMessageKey={null}
        exportErrorMessageKey={null}
        mutations={mutations}
        tableBoardActions={tableBoardActions()}
        boardActions={boardActions()}
        cutActions={cutActions()}
        beatPanelActions={beatActions}
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
      baseChoices: [{ target: { kind: 'shot', shotId: 'shot_1' }, purpose: 'seed_still' }],
      cascadeChoices: [
        { target: { kind: 'shot', shotId: 'shot_1' }, purpose: 'video_take' },
        { target: { kind: 'shot', shotId: 'shot_2' }, purpose: 'video_take' },
      ],
    });
  });

  it('treats a normal downstream shot as video-conditioned and refuses two anchors in one segment', () => {
    const project = makeProject();
    const projection = readyProjection(project);

    expect(selectionGateDraft({ project, projection, orderedShotIds: ['shot_2'] })?.baseChoices).toEqual([
      { target: { kind: 'shot', shotId: 'shot_2' }, purpose: 'video_take' },
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
      baseChoices: [{ target: { kind: 'shot', shotId: 'shot_1' }, purpose: 'video_take' }],
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

  it('rejects renderer reference ids and legacy count authority, and refuses terminal handoff reopening', () => {
    const project = makeProject();
    const projection = readyProjection(project);
    const defaults = selectionGateDraft({ project, projection, orderedShotIds: ['shot_1'] })!;
    expect(
      selectionGateDraft({
        project,
        projection,
        orderedShotIds: ['shot_1'],
        baseChoices: [
          {
            ...defaults.baseChoices[0]!,
            referenceInputs: [{ referenceId: 'forged_reference', assetId: 'forged_asset' }],
          } as never,
        ],
        cascadeChoices: defaults.cascadeChoices,
      })
    ).toBeNull();
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
        baseChoices: [{ ...defaults.baseChoices[0]!, target: { kind: 'shot', shotId: 'shot_3' } }],
        cascadeChoices: defaults.cascadeChoices,
      })
    ).toBeNull();

    expect(
      handoffGateDraft(project, projection, {
        handoffId: 'handoff_1',
        requestId: 'request_1',
        referenceIds: ['reference_ming'],
        decidedAt: '2026-08-19T00:00:00.000Z',
        status: 'succeeded',
        completedAt: '2026-08-19T00:01:00.000Z',
        counts: { queued: 0, running: 0, succeeded: 1, failed: 0 },
        resultAssetIds: ['asset_ming'],
        failedReferenceIds: [],
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

  it('refreshes capability disclosure only while an unprepared gate is open', () => {
    const disclosure: SpendGateGenerationDisclosure = {
      groups: [
        {
          block: { code: 'catalog_unloaded', role: 'image' },
          items: [{ target: { kind: 'shot', shotId: 'shot_1' }, purpose: 'seed_still' }],
        },
      ],
      blocksPrepare: true,
    };
    const opened = spendGateReducer(initialSpendGateState(), {
      type: 'open',
      draft,
      generationDisclosure: disclosure,
    });
    expect(opened.phase).toBe('choices');
    expect(opened.generationDisclosure).toEqual(disclosure);
    const refreshed = spendGateReducer(opened, { type: 'generation_disclosure_changed' });
    expect(refreshed.phase).toBe('preparing');
    expect(refreshed.generationDisclosure).toBeNull();

    const reviewed = spendGateReducer(opened, { type: 'prepare_succeeded', options: options() });
    expect(spendGateReducer(reviewed, { type: 'generation_disclosure_changed' })).toBe(reviewed);
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

  it('builds the exact segment-head frame regeneration and dependent-picture wave', () => {
    const project = makeProject();
    const projection = readyProjection(project);

    expect(seedRegenerationGateDraft({ project, projection, shotId: 'shot_1' })).toEqual({
      projectId: project.id,
      expectedRevision: project.revision,
      originReferenceHandoffId: null,
      baseChoices: [{ target: { kind: 'shot', shotId: 'shot_1' }, purpose: 'seed_still' }],
      cascadeChoices: [
        { target: { kind: 'shot', shotId: 'shot_1' }, purpose: 'video_take' },
        { target: { kind: 'shot', shotId: 'shot_2' }, purpose: 'video_take' },
      ],
    });
    expect(seedRegenerationGateDraft({ project, projection, shotId: 'shot_2' })).toBeNull();
    expect(seedRegenerationGateDraft({ project, projection, shotId: 'shot_3' })).toEqual({
      projectId: project.id,
      expectedRevision: project.revision,
      originReferenceHandoffId: null,
      baseChoices: [{ target: { kind: 'shot', shotId: 'shot_3' }, purpose: 'seed_still' }],
      cascadeChoices: [{ target: { kind: 'shot', shotId: 'shot_3' }, purpose: 'video_take' }],
    });

    expect(
      seedRegenerationGateDraft({
        project,
        projection: { ...projection, projectRevision: projection.projectRevision + 1 },
        shotId: 'shot_1',
      })
    ).toBeNull();
    projection.activeBeats[0]!.shots[0]!.seedAuthorizationLock = {
      compatibleAssetIds: [],
      canCancelWaiting: true,
      waitingReason: 'choose_seed',
    };
    expect(seedRegenerationGateDraft({ project, projection, shotId: 'shot_1' })).toBeNull();
  });
});

describe('Board spend gate draft', () => {
  it('selects the next 24 missing panels in film order, then the remaining six after completion', () => {
    const project = makeBoardProject(30);
    const projection = projectWorkspace(project, readyWorkspaceStatus(project), null);

    const firstBatch = boardGateDraft({ project, projection });
    expect(firstBatch).toEqual({
      projectId: project.id,
      expectedRevision: project.revision,
      originReferenceHandoffId: null,
      baseChoices: Array.from({ length: 24 }, (_, index) => ({
        target: { kind: 'shot', shotId: `board_shot_${String(index + 1).padStart(2, '0')}` },
        purpose: 'board_still',
      })),
      cascadeChoices: [],
    });
    expect(spendGateRouteIssue(routeCatalog('unavailable', 'ready'), firstBatch!)).toBe('image');
    expect(spendGateRouteIssue(routeCatalog('ready', 'unavailable'), firstBatch!)).toBeNull();

    const afterCompletion = {
      ...projection,
      boardPanels: projection.boardPanels.map((panel, index) =>
        index < 24
          ? {
              ...panel,
              assetId: `board_asset_${index + 1}`,
              producerJobId: `board_job_${index + 1}`,
              latestJobId: `board_job_${index + 1}`,
              freshness: 'current' as const,
            }
          : panel
      ),
    };
    expect(boardGateDraft({ project, projection: afterCompletion })?.baseChoices).toEqual(
      Array.from({ length: 6 }, (_, index) => ({
        target: { kind: 'shot', shotId: `board_shot_${String(index + 25).padStart(2, '0')}` },
        purpose: 'board_still',
      }))
    );
  });

  it('selects only missing idle or terminal panels and excludes current, stale, nonterminal, and attention work', () => {
    const project = makeBoardProject(8);
    const projection = projectWorkspace(project, readyWorkspaceStatus(project), null);
    const states = [
      { freshness: 'current', activity: 'idle' },
      { freshness: 'stale', activity: 'idle' },
      { freshness: 'missing', activity: 'queued' },
      { freshness: 'missing', activity: 'drawing' },
      { freshness: 'missing', activity: 'needs_attention' },
      { freshness: 'missing', activity: 'idle' },
      { freshness: 'missing', activity: 'failed' },
      { freshness: 'missing', activity: 'cancelled' },
    ] as const;
    const exactProjection = {
      ...projection,
      boardPanels: projection.boardPanels.map((panel, index) => ({
        ...panel,
        ...states[index]!,
      })),
    };

    expect(boardGateDraft({ project, projection: exactProjection })?.baseChoices).toEqual(
      [6, 7, 8].map((shotNumber) => ({
        target: { kind: 'shot', shotId: `board_shot_${String(shotNumber).padStart(2, '0')}` },
        purpose: 'board_still',
      }))
    );
  });

  it('excludes a failed panel with no-charge download recovery from fresh paid draw and redraw drafts', () => {
    const project = makeBoardProject(2);
    const projection = projectWorkspace(project, readyWorkspaceStatus(project), null);
    const failedDownloadPanel = {
      ...projection.boardPanels[0]!,
      activity: 'failed' as const,
      recovery: {
        jobId: 'board_download_job',
        canRetry: false,
        canCancel: false,
        canRetryDownload: true,
        submissionUnknown: false,
      },
    };
    const failedDownloadProjection = {
      ...projection,
      boardPanels: [failedDownloadPanel, ...projection.boardPanels.slice(1)],
    };

    expect(boardGateDraft({ project, projection: failedDownloadProjection })?.baseChoices).toEqual([
      { target: { kind: 'shot', shotId: 'board_shot_02' }, purpose: 'board_still' },
    ]);
    expect(
      boardSelectionGateDraft({
        project,
        projection: failedDownloadProjection,
        orderedShotIds: ['board_shot_01'],
      })
    ).toBeNull();
    expect(
      boardSelectionGateDraft({
        project,
        projection: failedDownloadProjection,
        orderedShotIds: ['board_shot_02'],
      })
    ).not.toBeNull();
  });

  it('fails closed without a style or an exact project, revision, active order, and Board status', () => {
    const project = makeBoardProject(3);
    const projection = projectWorkspace(project, readyWorkspaceStatus(project), null);
    expect(boardGateDraft({ project, projection })).not.toBeNull();

    project.boardStyle = null;
    expect(boardGateDraft({ project, projection })).toBeNull();
    project.boardStyle = 'grey_tone';

    expect(boardGateDraft({ project, projection: { ...projection, projectId: 'project_other' } })).toBeNull();
    expect(
      boardGateDraft({ project, projection: { ...projection, projectRevision: project.revision - 1 } })
    ).toBeNull();
    expect(
      boardGateDraft({
        project,
        projection: { ...projection, activeShotIds: projection.activeShotIds.toReversed() },
      })
    ).toBeNull();
    expect(
      boardGateDraft({
        project,
        projection: { ...projection, boardPanels: projection.boardPanels.toReversed() },
      })
    ).toBeNull();
    expect(
      boardGateDraft({
        project,
        projection: {
          ...projection,
          boardPanels: projection.boardPanels.map((panel, index) =>
            index === 1
              ? { ...panel, freshness: 'status_pending' as const, activity: 'status_pending' as const }
              : panel
          ),
        },
      })
    ).toBeNull();

    const mismatchedStatus = readyWorkspaceStatus(project);
    mismatchedStatus.projectRevision -= 1;
    expect(boardGateDraft({ project, projection: projectWorkspace(project, mismatchedStatus, null) })).toBeNull();
  });

  it('builds an exact paid redraw for caller-selected missing, current, and stale panels', () => {
    const project = makeBoardProject(4);
    const projection = projectWorkspace(project, readyWorkspaceStatus(project), null);
    const redrawProjection = {
      ...projection,
      boardPanels: projection.boardPanels.map((panel, index) => {
        if (index === 0) return { ...panel, freshness: 'current' as const, activity: 'idle' as const };
        if (index === 1) return { ...panel, freshness: 'stale' as const, activity: 'failed' as const };
        if (index === 2) return { ...panel, freshness: 'missing' as const, activity: 'cancelled' as const };
        return { ...panel, activity: 'queued' as const };
      }),
    };

    expect(
      boardSelectionGateDraft({
        project,
        projection: redrawProjection,
        orderedShotIds: ['board_shot_01', 'board_shot_02', 'board_shot_03'],
      })
    ).toEqual({
      projectId: project.id,
      expectedRevision: project.revision,
      originReferenceHandoffId: null,
      baseChoices: [1, 2, 3].map((shotNumber) => ({
        target: { kind: 'shot', shotId: `board_shot_0${shotNumber}` },
        purpose: 'board_still',
      })),
      cascadeChoices: [],
    });
  });

  it('rejects busy selections, duplicates, non-film order, non-active Shots, and more than 24 panels', () => {
    const project = makeBoardProject(25);
    const projection = projectWorkspace(project, readyWorkspaceStatus(project), null);
    const busyProjection = {
      ...projection,
      boardPanels: projection.boardPanels.map((panel, index) =>
        index < 3 ? { ...panel, activity: (['queued', 'drawing', 'needs_attention'] as const)[index]! } : panel
      ),
    };
    for (const shotId of ['board_shot_01', 'board_shot_02', 'board_shot_03']) {
      expect(boardSelectionGateDraft({ project, projection: busyProjection, orderedShotIds: [shotId] })).toBeNull();
    }
    expect(boardSelectionGateDraft({ project, projection, orderedShotIds: [] })).toBeNull();
    expect(
      boardSelectionGateDraft({ project, projection, orderedShotIds: ['board_shot_01', 'board_shot_01'] })
    ).toBeNull();
    expect(
      boardSelectionGateDraft({ project, projection, orderedShotIds: ['board_shot_02', 'board_shot_01'] })
    ).toBeNull();
    expect(boardSelectionGateDraft({ project, projection, orderedShotIds: ['shot_in_bin'] })).toBeNull();
    expect(
      boardSelectionGateDraft({
        project,
        projection: {
          ...projection,
          boardPanels: projection.boardPanels.map((panel, index) =>
            index === 0
              ? { ...panel, freshness: 'status_pending' as const, activity: 'status_pending' as const }
              : panel
          ),
        },
        orderedShotIds: ['board_shot_01'],
      })
    ).toBeNull();
    expect(boardSelectionGateDraft({ project, projection, orderedShotIds: projection.activeShotIds })).toBeNull();
    expect(
      boardSelectionGateDraft({ project, projection, orderedShotIds: projection.activeShotIds.slice(0, 24) })
        ?.baseChoices
    ).toHaveLength(24);
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
      'aionui:creative-studio:v3:workspace-drafts:project_1',
      JSON.stringify({
        version: 3,
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
    expect(window.sessionStorage.getItem('aionui:creative-studio:v3:workspace-drafts:project_1')).toContain(
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
      'aionui:creative-studio:v3:workspace-drafts:project_1',
      JSON.stringify({
        version: 3,
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
        window.sessionStorage.getItem('aionui:creative-studio:v3:workspace-drafts:project_1') ?? '{}'
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
      'aionui:creative-studio:v3:workspace-drafts:project_1',
      JSON.stringify({
        version: 3,
        projectId: 'project_1',
        sourceRevision: 3,
        entries: {
          'shot.shot_1.shootingScript': { baseValue: 'shot_1', value: 'Unsaved replacement' },
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

describe('Board first-frame promotion gate plan', () => {
  const promotionProjection = (project: StudioRendererProjectV2, assetId: string, jobId: string) => {
    const status = readyWorkspaceStatus(project);
    status.boardPanels[0] = {
      shotId: 'shot_1',
      assetId,
      producerJobId: jobId,
      latestJobId: jobId,
      staleCauses: [],
    };
    return projectWorkspace(project, status, readyChainStatus(project));
  };

  it('derives only exact current takes in the selected segment and keeps the continuity boundary unchanged', () => {
    const project = makeProject();
    project.boardStyle = 'grey_tone';
    const { assetId, jobId } = addCurrentBoardPanel(project, 'shot_1');
    addCurrentVideoTake(project, 'shot_1');
    addCurrentVideoTake(project, 'shot_2');
    addCurrentVideoTake(project, 'shot_3');
    const projection = promotionProjection(project, assetId, jobId);
    const originalChainBreak = project.shots.shot_1!.chainBreak;

    const plan = boardPromotionGatePlan({ project, projection, shotId: 'shot_1', boardAssetId: assetId });

    expect(plan).toEqual({
      draft: {
        projectId: project.id,
        expectedRevision: project.revision,
        originReferenceHandoffId: null,
        baseChoices: [],
        cascadeChoices: [],
        boardPromotion: { shotId: 'shot_1', boardAssetId: assetId },
      },
      impact: { currentTakeShotIds: ['shot_1', 'shot_2'] },
    });
    expect(project.shots.shot_1!.chainBreak).toBe(originalChainBreak);
    expect(spendGateRouteIssue(routeCatalog('unavailable', 'ready'), plan!.draft)).toBeNull();
    expect(spendGateRouteIssue(routeCatalog('ready', 'unavailable'), plan!.draft)).toBe('video');
  });

  it('keeps free promotion available with no current takes while omitting paid rerender impact', () => {
    const project = makeProject();
    project.boardStyle = 'grey_tone';
    const { assetId, jobId } = addCurrentBoardPanel(project, 'shot_1');
    const projection = promotionProjection(project, assetId, jobId);

    expect(boardPromotionGatePlan({ project, projection, shotId: 'shot_1', boardAssetId: assetId })?.impact).toEqual({
      currentTakeShotIds: [],
    });
  });

  it('fails closed on forged downstream order, current-take identity, or generation activity', () => {
    const project = makeProject();
    project.boardStyle = 'grey_tone';
    const { assetId, jobId } = addCurrentBoardPanel(project, 'shot_1');
    addCurrentVideoTake(project, 'shot_1');
    addCurrentVideoTake(project, 'shot_2');
    const projection = promotionProjection(project, assetId, jobId);
    const build = (exactProjection: typeof projection) =>
      boardPromotionGatePlan({ project, projection: exactProjection, shotId: 'shot_1', boardAssetId: assetId });

    const forgedDownstream = structuredClone(projection);
    forgedDownstream.activeBeats[0]!.shots[0]!.downstreamShotIds = [];
    expect(build(forgedDownstream)).toBeNull();

    const forgedTake = structuredClone(projection);
    forgedTake.activeBeats[0]!.shots[1]!.currentPicture = {
      ...forgedTake.activeBeats[0]!.shots[1]!.currentPicture!,
      assetId: 'video_forged',
    };
    expect(build(forgedTake)).toBeNull();

    const blocked = structuredClone(projection);
    blocked.activeBeats[0]!.shots[1]!.videoGenerationBlocked = true;
    expect(build(blocked)).toBeNull();
  });

  it.each(['idle', 'failed', 'cancelled'] as const)(
    'accepts a current segment-head panel with stable %s activity',
    (activity) => {
      const project = makeProject();
      project.boardStyle = 'grey_tone';
      const { assetId, jobId } = addCurrentBoardPanel(project, 'shot_1');
      const projection = promotionProjection(project, assetId, jobId);

      expect(
        boardPromotionGatePlan({
          project,
          projection: {
            ...projection,
            boardPanels: projection.boardPanels.map((panel, index) => (index === 0 ? { ...panel, activity } : panel)),
          },
          shotId: 'shot_1',
          boardAssetId: assetId,
        })
      ).not.toBeNull();
    }
  );

  it('rejects a stable current panel on a non-head Shot', () => {
    const project = makeProject();
    project.boardStyle = 'grey_tone';
    const { assetId, jobId } = addCurrentBoardPanel(project, 'shot_2');
    const status = readyWorkspaceStatus(project);
    status.boardPanels[1] = {
      shotId: 'shot_2',
      assetId,
      producerJobId: jobId,
      latestJobId: jobId,
      staleCauses: [],
    };
    const projection = projectWorkspace(project, status, readyChainStatus(project));

    expect(boardPromotionGatePlan({ project, projection, shotId: 'shot_2', boardAssetId: assetId })).toBeNull();
  });

  it('rejects stale, busy, attention, already-promoted, pending, and mismatched panel authority', () => {
    const project = makeProject();
    project.boardStyle = 'grey_tone';
    const { assetId, jobId } = addCurrentBoardPanel(project, 'shot_1');
    const projection = promotionProjection(project, assetId, jobId);
    const build = (exactProjection = projection, shotId = 'shot_1', exactAssetId = assetId) =>
      boardPromotionGatePlan({ project, projection: exactProjection, shotId, boardAssetId: exactAssetId });

    expect(
      build({
        ...projection,
        boardPanels: projection.boardPanels.map((panel, index) =>
          index === 0 ? { ...panel, freshness: 'stale' as const, staleCauses: ['request_out_of_date'] } : panel
        ),
      })
    ).toBeNull();
    expect(
      build({
        ...projection,
        boardPanels: projection.boardPanels.map((panel, index) =>
          index === 0 ? { ...panel, activity: 'needs_attention' as const } : panel
        ),
      })
    ).toBeNull();
    expect(
      build({
        ...projection,
        boardPanels: projection.boardPanels.map((panel, index) =>
          index === 0 ? { ...panel, activity: 'drawing' as const } : panel
        ),
      })
    ).toBeNull();
    project.shots.shot_1!.seedStillId = assetId;
    expect(build(promotionProjection(project, assetId, jobId))).toBeNull();
    project.shots.shot_1!.seedStillId = null;
    expect(build({ ...projection, chainStatusReady: false })).toBeNull();
    expect(build(projection, 'shot_1', 'board_forged')).toBeNull();
  });
});

describe('SpendGateModal', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.listRoutes.mockResolvedValue({ ok: true, data: routeCatalog('ready', 'ready') });
    mocks.prepare.mockResolvedValue({ ok: true, data: options() });
    mocks.prepareReferences.mockResolvedValue({ ok: true, data: options() });
    mocks.confirm.mockResolvedValue({ ok: true, data: { projectId: 'project_1', projectRevision: 4 } });
  });

  it('automatically prepares a read-only estimate on open and never confirms on open or close', async () => {
    let resolvePrepare!: (value: unknown) => void;
    mocks.prepare.mockReturnValue(new Promise((resolve) => (resolvePrepare = resolve)));
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Open review' }));
    const gate = await screen.findByTestId('studio-spend-gate');
    expect(gate.closest('.arco-modal-wrapper')).toHaveStyle({ zIndex: '1101' });
    expect(document.querySelector('.arco-modal-mask')).toHaveStyle({ zIndex: '1100' });
    await waitFor(() => expect(mocks.prepare).toHaveBeenCalledExactlyOnceWith(draft));
    expect(mocks.confirm).not.toHaveBeenCalled();
    expect(
      within(gate).queryByRole('button', { name: 'conversation.creativeStudio.workspace.gate.prepare' })
    ).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'conversation.creativeStudio.workspace.gate.close' }));
    resolvePrepare({ ok: true, data: options() });
    await waitFor(() => expect(screen.queryByTestId('studio-spend-gate')).not.toBeVisible());
    expect(mocks.prepare).toHaveBeenCalledTimes(1);
    expect(mocks.confirm).not.toHaveBeenCalled();
  });

  it('shows the estimate directly and requires a deliberate click instead of Enter to confirm', async () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Open review' }));
    const modal = await screen.findByTestId('studio-spend-gate');
    const confirm = await within(modal).findByRole('button', {
      name: /conversation\.creativeStudio\.workspace\.gate\.confirm/,
    });

    expect(modal.querySelector('[data-free-estimate-note]')).toHaveTextContent(
      'conversation.creativeStudio.workspace.gate.reviewBeforeSpend'
    );
    expect(
      within(modal).queryByRole('button', { name: 'conversation.creativeStudio.workspace.gate.prepare' })
    ).toBeNull();
    expect(confirm).not.toHaveFocus();
    fireEvent.keyDown(modal, { key: 'Enter', code: 'Enter' });
    expect(mocks.confirm).not.toHaveBeenCalled();

    fireEvent.click(confirm);
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledTimes(1));
  });

  it('discloses a blocked exact intent and refuses both visible and direct prepare attempts', async () => {
    const generationDisclosure: SpendGateGenerationDisclosure = {
      groups: [
        {
          block: { code: 'no_engine', role: 'image' },
          items: [{ target: { kind: 'shot', shotId: 'shot_1' }, purpose: 'seed_still' }],
        },
      ],
      blocksPrepare: true,
    };
    render(<Harness generationDisclosure={generationDisclosure} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open review' }));

    const modal = await screen.findByTestId('studio-spend-gate');
    expect(modal.querySelector('[data-generation-block-code="no_engine"]')).toBeVisible();
    const exactScope = modal.querySelector('[data-generation-block-scope="exact"]');
    expect(exactScope).toHaveTextContent('conversation.creativeStudio.models.blocked.noEngine');
    expect(exactScope).toHaveTextContent('shot_1');
    expect(exactScope).not.toHaveTextContent('conversation.creativeStudio.phase.produce.batchExcluded');
    expect(
      within(modal).queryByRole('button', { name: 'conversation.creativeStudio.workspace.gate.prepare' })
    ).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Invoke prepare directly' }));
    expect(mocks.prepare).not.toHaveBeenCalled();
  });

  it('keeps a narrowed batch reviewable while retaining its grouped omission disclosure', async () => {
    const generationDisclosure: SpendGateGenerationDisclosure = {
      groups: [
        {
          block: { code: 'duration', role: 'video', seconds: 9 },
          items: [{ target: { kind: 'shot', shotId: 'shot_2' }, purpose: 'video_take' }],
        },
      ],
      blocksPrepare: false,
    };
    render(<Harness generationDisclosure={generationDisclosure} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open review' }));
    const modal = await screen.findByTestId('studio-spend-gate');

    await waitFor(() => expect(mocks.prepare).toHaveBeenCalledTimes(1));
    expect(modal.querySelector('[data-generation-block-code="duration"]')).toBeVisible();
    expect(modal.querySelector('[data-generation-block-scope="excluded"]')).toHaveTextContent(
      'conversation.creativeStudio.phase.produce.batchExcluded'
    );
  });

  it('prepares project references through their dedicated seam and names reference scope instead of proxy Shots', async () => {
    mocks.prepareReferences.mockResolvedValue({ ok: true, data: referenceOptions() });
    render(
      <Harness
        gateDraft={{ projectId: 'project_1', expectedRevision: 3, referenceIds: ['reference_ming'] }}
        projectReferences={[{ id: 'reference_ming', kind: 'character', label: 'Ming' }]}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Open review' }));
    const modal = await screen.findByTestId('studio-spend-gate');
    expect(modal).toHaveAttribute('data-gate-kind', 'project_references');
    await waitFor(() =>
      expect(mocks.prepareReferences).toHaveBeenCalledWith({
        projectId: 'project_1',
        expectedRevision: 3,
        referenceIds: ['reference_ming'],
      })
    );
    expect(mocks.prepare).not.toHaveBeenCalled();
    expect(modal.querySelector('[data-project-reference-scope]')).toHaveTextContent('Ming');

    showGateBreakdown(modal);
    const row = modal.querySelector('[data-project-reference-id="reference_ming"]');
    expect(row).toHaveTextContent('Ming');
    expect(row).not.toHaveTextContent('shot_1');
  });

  it('fails closed when reference preparation exposes a forbidden sibling quote', async () => {
    mocks.prepareReferences.mockResolvedValue({ ok: true, data: options() });
    render(<Harness gateDraft={{ projectId: 'project_1', expectedRevision: 3, referenceIds: ['reference_ming'] }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open review' }));

    expect(await screen.findByText('conversation.creativeStudio.workspace.gate.errors.generic')).toBeVisible();
    expect(mocks.confirm).not.toHaveBeenCalled();
  });

  it('defaults Board promotion to the exact $0 mutation and leaves every provider seam untouched', async () => {
    const onPromoteOnly = vi.fn(async () => true);
    render(
      <Harness
        gateDraft={promotionDraft}
        boardPromotionImpact={{ currentTakeShotIds: ['shot_1', 'shot_2'] }}
        onPromoteOnly={onPromoteOnly}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Open review' }));
    const modal = await screen.findByTestId('studio-spend-gate');

    expect(modal).toHaveAttribute('data-gate-kind', 'board_promotion');
    expect(screen.getByRole('dialog', { name: 'Use panel as first frame' })).toBeVisible();
    expect(within(modal).getByRole('radio', { name: /Promote only/ })).toBeChecked();
    expect(
      within(modal)
        .getAllByRole('listitem')
        .map((row) => row.getAttribute('data-promotion-stale-shot-id'))
    ).toEqual(['shot_1', 'shot_2']);
    expect(mocks.prepare).not.toHaveBeenCalled();
    expect(mocks.confirm).not.toHaveBeenCalled();

    fireEvent.click(within(modal).getByRole('button', { name: 'Promote for $0' }));
    await waitFor(() =>
      expect(onPromoteOnly).toHaveBeenCalledExactlyOnceWith({
        projectId: 'project_1',
        expectedRevision: 3,
        promotion: { shotId: 'shot_1', boardAssetId: 'board_shot_1' },
      })
    );
    expect(
      await within(modal).findByText('Panel promoted. Existing takes remain playable and are marked stale.')
    ).toBeVisible();
    expect(mocks.prepare).not.toHaveBeenCalled();
    expect(mocks.confirm).not.toHaveBeenCalled();
  });

  it('prepares the atomic paid promotion only after that option is chosen and confirms only on the explicit action', async () => {
    mocks.prepare.mockResolvedValue({ ok: true, data: { baseOnly: promotionQuote(), withCascade: null } });
    render(<Harness gateDraft={promotionDraft} boardPromotionImpact={{ currentTakeShotIds: ['shot_1', 'shot_2'] }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open review' }));
    const modal = await screen.findByTestId('studio-spend-gate');
    fireEvent.click(within(modal).getByRole('radio', { name: /Promote and review exact rerender work/ }));
    expect(mocks.prepare).not.toHaveBeenCalled();

    fireEvent.click(within(modal).getByRole('button', { name: 'Review rerender price' }));
    await waitFor(() => expect(mocks.prepare).toHaveBeenCalledExactlyOnceWith(promotionDraft));
    expect(mocks.confirm).not.toHaveBeenCalled();
    expect(await within(modal).findByRole('heading', { name: 'Promote + 2 rerenders · $8.00' })).toBeVisible();
    expect(
      within(modal).getByText(
        'The listed rerenders are exactly the current takes this promotion makes stale. Missing coverage is not included.'
      )
    ).toBeVisible();
    expect(within(modal).getByRole('button', { name: 'Promote for $0' })).toBeEnabled();

    fireEvent.click(within(modal).getByRole('button', { name: 'Confirm promotion + 2 rerenders · $8.00' }));
    await waitFor(() =>
      expect(mocks.confirm).toHaveBeenCalledExactlyOnceWith({
        projectId: 'project_1',
        quoteId: 'quote_promotion',
        expectedRevision: 3,
      })
    );
  });

  it('offers free-only promotion when there is no current take to rerender', async () => {
    render(<Harness gateDraft={promotionDraft} boardPromotionImpact={{ currentTakeShotIds: [] }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open review' }));
    const modal = await screen.findByTestId('studio-spend-gate');

    expect(within(modal).getByText('No current takes depend on this frame.')).toBeVisible();
    expect(within(modal).getAllByRole('radio')).toHaveLength(1);
    expect(within(modal).queryByRole('button', { name: 'Review rerender price' })).toBeNull();
    expect(within(modal).getByRole('button', { name: 'Promote for $0' })).toBeEnabled();
    expect(mocks.prepare).not.toHaveBeenCalled();
  });

  it('hides paid promotion when the video route is not ready without blocking the free choice', async () => {
    render(
      <Harness
        gateDraft={promotionDraft}
        boardPromotionImpact={{ currentTakeShotIds: ['shot_1', 'shot_2'], paidRouteReady: false }}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Open review' }));
    const modal = await screen.findByTestId('studio-spend-gate');

    expect(within(modal).getAllByRole('radio')).toHaveLength(1);
    expect(within(modal).queryByRole('button', { name: 'Review rerender price' })).toBeNull();
    expect(within(modal).getByRole('button', { name: 'Promote for $0' })).toBeEnabled();
    expect(mocks.prepare).not.toHaveBeenCalled();
  });

  it('retains the free promotion after paid route refusal', async () => {
    mocks.listRoutes.mockResolvedValue({ ok: true, data: routeCatalog('ready', 'unavailable') });
    mocks.prepare.mockResolvedValueOnce({ ok: false, error: { code: 'invalid_route' } });
    render(<Harness gateDraft={promotionDraft} boardPromotionImpact={{ currentTakeShotIds: ['shot_1', 'shot_2'] }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open review' }));
    const modal = screen.getByTestId('studio-spend-gate');
    fireEvent.click(within(modal).getByRole('radio', { name: /Promote and review exact rerender work/ }));
    fireEvent.click(within(modal).getByRole('button', { name: 'Review rerender price' }));

    expect(
      await within(modal).findByText('conversation.creativeStudio.workspace.controls.videoRouteBlocked')
    ).toBeVisible();
    expect(within(modal).getByRole('button', { name: 'Promote for $0' })).toBeEnabled();
    expect(within(modal).queryByRole('button', { name: 'Review rerender price' })).toBeNull();
  });

  it('retains the free promotion when the paid quote is over cap', async () => {
    mocks.prepare.mockResolvedValue({
      ok: true,
      data: {
        baseOnly: {
          ...promotionQuote(),
          budget: { kind: 'over_cap', policyCurrency: 'USD', maxPerBatchMinorUnits: 1 },
        },
        withCascade: null,
      },
    });
    render(<Harness gateDraft={promotionDraft} boardPromotionImpact={{ currentTakeShotIds: ['shot_1', 'shot_2'] }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open review' }));
    const modal = screen.getByTestId('studio-spend-gate');
    fireEvent.click(within(modal).getByRole('radio', { name: /Promote and review exact rerender work/ }));
    fireEvent.click(within(modal).getByRole('button', { name: 'Review rerender price' }));

    const confirm = await within(modal).findByRole('button', { name: 'Confirm promotion + 2 rerenders · $8.00' });
    expect(confirm).toBeDisabled();
    expect(within(modal).getByRole('button', { name: 'Promote for $0' })).toBeEnabled();
  });

  it('silently refreshes an expired paid-promotion quote while retaining the free choice', async () => {
    const refreshedPromotionQuote = { ...promotionQuote(), id: 'quote_promotion_refreshed' };
    mocks.prepare
      .mockResolvedValueOnce({ ok: true, data: { baseOnly: promotionQuote(), withCascade: null } })
      .mockResolvedValueOnce({ ok: true, data: { baseOnly: refreshedPromotionQuote, withCascade: null } });
    mocks.confirm.mockResolvedValue({ ok: false, error: { code: 'quote_not_found' } });
    render(<Harness gateDraft={promotionDraft} boardPromotionImpact={{ currentTakeShotIds: ['shot_1', 'shot_2'] }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open review' }));
    const modal = screen.getByTestId('studio-spend-gate');
    fireEvent.click(within(modal).getByRole('radio', { name: /Promote and review exact rerender work/ }));
    fireEvent.click(within(modal).getByRole('button', { name: 'Review rerender price' }));
    fireEvent.click(await within(modal).findByRole('button', { name: 'Confirm promotion + 2 rerenders · $8.00' }));

    await waitFor(() => expect(mocks.prepare).toHaveBeenCalledTimes(2));
    expect(within(modal).queryByText('conversation.creativeStudio.errors.quoteNotFound')).toBeNull();
    expect(within(modal).getByRole('button', { name: 'Confirm promotion + 2 rerenders · $8.00' })).toBeEnabled();
    expect(within(modal).getByRole('button', { name: 'Promote for $0' })).toBeEnabled();
    expect(mocks.confirm).toHaveBeenCalledTimes(1);
  });

  it('starts the generation breakdown closed again on every gate opening', async () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Open review' }));
    const modal = await screen.findByTestId('studio-spend-gate');
    await within(modal).findByRole('button', {
      name: 'conversation.creativeStudio.workspace.gate.showBreakdown',
    });
    showGateBreakdown(modal);
    expect(within(modal).getByText('conversation.creativeStudio.workspace.gate.rateCardSource')).toBeVisible();

    fireEvent.click(within(modal).getByRole('button', { name: 'conversation.creativeStudio.workspace.gate.close' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open review' }));

    const toggle = await within(modal).findByRole('button', {
      name: 'conversation.creativeStudio.workspace.gate.showBreakdown',
    });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(within(modal).queryByText('conversation.creativeStudio.workspace.gate.rateCardSource')).toBeNull();
  });

  it('starts the generation breakdown closed when the selected quote changes', async () => {
    const modal = await openPreparedGate(options());
    showGateBreakdown(modal);
    fireEvent.click(within(modal).getByText('conversation.creativeStudio.workspace.gate.withCascade'));

    expect(
      within(modal).getByRole('button', {
        name: 'conversation.creativeStudio.workspace.gate.showBreakdown',
      })
    ).toHaveAttribute('aria-expanded', 'false');
    expect(within(modal).queryByText('conversation.creativeStudio.workspace.gate.rateCardSource')).toBeNull();
  });

  it.each([
    [true, 'Hard cut · 1 required generation · $4.00', 'Confirm hard cut + 1 generation · $4.00'],
    [false, 'Rejoin · 1 required generation · $4.00', 'Confirm rejoin + 1 generation · $4.00'],
  ])('uses singular exact copy for a legal one-item continuity quote', async (hardCut, headline, action) => {
    const continuityDraft = {
      projectId: 'project_1',
      expectedRevision: 3,
      originReferenceHandoffId: null,
      baseChoices: [],
      cascadeChoices: [],
      continuityChange: { shotId: 'shot_2', hardCut, requiresSeedGeneration: false },
    };
    mocks.prepare.mockResolvedValue({
      ok: true,
      data: { baseOnly: oneItemContinuityQuote(), withCascade: null },
    });
    render(<Harness gateDraft={continuityDraft} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open review' }));
    const modal = await screen.findByTestId('studio-spend-gate');

    expect(await within(modal).findByRole('heading', { name: headline })).toBeVisible();
    expect(within(modal).getByRole('button', { name: action })).toBeEnabled();
  });

  it('names one exact shared route once with its human-readable model', async () => {
    const sharedQuote = quote('quote_shared');
    sharedQuote.baseItems.push({
      ...sharedQuote.baseItems[0]!,
      target: { kind: 'shot', shotId: 'shot_2' },
      composition: shotComposition('shot_2', 'seed_still', 'safe_provider', 'safe_model'),
    });
    sharedQuote.lowerMinorUnits = 250;
    sharedQuote.upperMinorUnits = 250;
    const modal = await openPreparedGate({ baseOnly: sharedQuote, withCascade: null });
    showGateBreakdown(modal);

    expect(within(modal).getByText('All through safe_model')).toBeVisible();
    expect(within(modal).getAllByRole('listitem')).toHaveLength(2);
  });

  it.each([
    ['providerId', 'safe_provider_2'],
    ['model', 'safe_model_2'],
    ['choiceId', 'image_choice_2'],
  ] as const)('keeps routes separate when their exact %s identities differ', async (field, value) => {
    const mixedRouteQuote = quote('quote_mixed_route');
    const secondRoute = { ...mixedRouteQuote.baseItems[0]!.route, [field]: value };
    mixedRouteQuote.baseItems.push({
      ...mixedRouteQuote.baseItems[0]!,
      target: { kind: 'shot', shotId: 'shot_2' },
      route: secondRoute,
      composition: shotComposition('shot_2', 'seed_still', secondRoute.providerId, secondRoute.model),
    });
    mixedRouteQuote.lowerMinorUnits = 250;
    mixedRouteQuote.upperMinorUnits = 250;
    const modal = await openPreparedGate({ baseOnly: mixedRouteQuote, withCascade: null });
    showGateBreakdown(modal);

    expect(within(modal).queryByText(/^All through /)).toBeNull();
    expect(within(modal).getByText('safe_provider · safe_model · image_choice')).toBeVisible();
    expect(
      within(modal).getByText(`${secondRoute.providerId} · ${secondRoute.model} · ${secondRoute.choiceId}`)
    ).toBeVisible();
  });

  it('shows group and purpose only when those facts vary between rows', async () => {
    const variedQuote = quote('quote_varied', true);
    const modal = await openPreparedGate({ baseOnly: variedQuote, withCascade: null });
    showGateBreakdown(modal);
    const rows = within(modal).getAllByRole('listitem');

    expect(rows[0]).toHaveTextContent('conversation.creativeStudio.workspace.gate.group.base');
    expect(rows[0]).toHaveTextContent('conversation.creativeStudio.workspace.gate.purpose.seed_still');
    expect(rows[1]).toHaveTextContent('conversation.creativeStudio.workspace.gate.group.cascade');
    expect(rows[1]).toHaveTextContent('conversation.creativeStudio.workspace.gate.purpose.video_take');
  });

  it('shows the exact persisted conditioning frame beside only the generation that consumes it', async () => {
    const modal = await openPreparedGate({ baseOnly: quote('quote_conditioning', true), withCascade: null });
    showGateBreakdown(modal);

    const image = within(modal).getByRole('img', {
      name: /conversation\.creativeStudio\.workspace\.gate\.conditioningFrameAlt/,
    });
    expect(image).toHaveAttribute('data-conditioning-asset-id', 'seed_shot_1');
    expect(image).toHaveAttribute('src', expect.stringContaining('seed_shot_1'));
    expect(modal.querySelectorAll('[data-conditioning-asset-id]')).toHaveLength(1);
  });

  it('omits homogeneous group and purpose labels from each compact row', async () => {
    const homogeneousQuote = quote('quote_homogeneous');
    homogeneousQuote.baseItems.push({
      ...homogeneousQuote.baseItems[0]!,
      target: { kind: 'shot', shotId: 'shot_2' },
      composition: shotComposition('shot_2', 'seed_still', 'safe_provider', 'safe_model'),
    });
    homogeneousQuote.lowerMinorUnits = 250;
    homogeneousQuote.upperMinorUnits = 250;
    const modal = await openPreparedGate({ baseOnly: homogeneousQuote, withCascade: null });
    showGateBreakdown(modal);

    expect(modal).not.toHaveTextContent('conversation.creativeStudio.workspace.gate.group.base');
    expect(modal).not.toHaveTextContent('conversation.creativeStudio.workspace.gate.purpose.seed_still');
  });

  it('shows only the group label when groups vary but purposes do not', async () => {
    const mixedGroupQuote = quote('quote_mixed_group', true);
    mixedGroupQuote.baseItems = [{ ...mixedGroupQuote.cascadeItems[0]!, requestedTotalMinorUnits: 400 }];
    mixedGroupQuote.lowerMinorUnits = 800;
    mixedGroupQuote.upperMinorUnits = 800;
    const modal = await openPreparedGate({ baseOnly: mixedGroupQuote, withCascade: null });
    showGateBreakdown(modal);

    expect(modal).toHaveTextContent('conversation.creativeStudio.workspace.gate.group.base');
    expect(modal).toHaveTextContent('conversation.creativeStudio.workspace.gate.group.cascade');
    expect(modal).not.toHaveTextContent('conversation.creativeStudio.workspace.gate.purpose.video_take');
  });

  it('shows only the purpose label when purposes vary but groups do not', async () => {
    const mixedPurposeQuote = continuityQuote();
    mixedPurposeQuote.id = 'quote_mixed_purpose';
    const modal = await openPreparedGate({ baseOnly: mixedPurposeQuote, withCascade: null });
    showGateBreakdown(modal);

    expect(modal).not.toHaveTextContent('conversation.creativeStudio.workspace.gate.group.base');
    expect(modal).toHaveTextContent('conversation.creativeStudio.workspace.gate.purpose.seed_still');
    expect(modal).toHaveTextContent('conversation.creativeStudio.workspace.gate.purpose.video_take');
  });

  it('names the unavailable image route before estimating and offers the Brief route picker', async () => {
    const onEditRoutes = vi.fn();
    mocks.listRoutes.mockResolvedValue({ ok: true, data: routeCatalog('selection_required', 'ready') });
    mocks.prepare.mockResolvedValue({ ok: false, error: { code: 'invalid_route' } });
    const imageOnlyDraft = { ...draft, cascadeChoices: [] };
    render(<Harness gateDraft={imageOnlyDraft} onEditRoutes={onEditRoutes} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open review' }));

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

    expect(await screen.findByText('conversation.creativeStudio.workspace.controls.videoRouteBlocked')).toBeVisible();
    expect(mocks.prepare).toHaveBeenCalledTimes(1);
    expect(mocks.listRoutes).toHaveBeenCalledTimes(1);
  });

  it('shows the original estimate failure without waiting for a stalled read-only route diagnosis', async () => {
    mocks.listRoutes.mockReturnValue(new Promise(() => undefined));
    mocks.prepare.mockResolvedValue({ ok: false, error: { code: 'invalid_route' } });
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Open review' }));

    expect(await screen.findByText('conversation.creativeStudio.workspace.gate.errors.generic')).toBeVisible();
    expect(mocks.prepare).toHaveBeenCalledTimes(1);
  });

  it('freezes duplicate prepare, renders every safe row fact, and confirms only the selected opaque quote', async () => {
    let resolvePrepare!: (value: unknown) => void;
    mocks.prepare.mockReturnValue(new Promise((resolve) => (resolvePrepare = resolve)));
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Open review' }));
    await waitFor(() => expect(mocks.prepare).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'Invoke prepare directly' }));
    expect(mocks.prepare).toHaveBeenCalledTimes(1);
    resolvePrepare({ ok: true, data: options() });

    const modal = await screen.findByTestId('studio-spend-gate');
    fireEvent.click(within(modal).getByText('conversation.creativeStudio.workspace.gate.withCascade'));
    fireEvent.click(
      within(modal).getByRole('button', {
        name: 'conversation.creativeStudio.workspace.gate.showBreakdown',
      })
    );
    expect(within(modal).getByText('safe_video · video_model · video_choice')).toBeVisible();
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
    expect(within(modal).queryByRole('radio')).toBeNull();

    await waitFor(() =>
      expect(
        within(modal).getByRole('button', {
          name: 'conversation.creativeStudio.workspace.gate.showBreakdown',
        })
      ).toBeVisible()
    );
    expect(within(modal).queryByRole('radio')).toBeNull();
    fireEvent.click(
      within(modal).getByRole('button', {
        name: 'conversation.creativeStudio.workspace.gate.showBreakdown',
      })
    );
    expect(within(modal).getByText('safe_video · video_model · video_choice')).toBeVisible();
    const requiredRows = within(modal).getAllByRole('listitem');
    expect(requiredRows[0]).toHaveAttribute('data-quote-group', 'required');
    // The panel already states that all listed work is required, so the row does not repeat it;
    // the group survives as the data attribute asserted above.
    expect(requiredRows[0]).toHaveTextContent('shot_2');
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
        'Hard cut confirmed. Review the Shot for first-frame progress, replacement progress, or any required recovery.'
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

    expect(await screen.findByText('conversation.creativeStudio.workspace.gate.errors.generic')).toBeVisible();
    expect(document.body).not.toHaveTextContent('route_secret_apiKey');
    expect(document.body).not.toHaveTextContent('provider body secret');
    expect(document.body).not.toHaveTextContent('private stack');
    expect(mocks.confirm).not.toHaveBeenCalled();
  });

  it('silently refreshes an expired quote and requires a fresh explicit confirmation', async () => {
    const refreshed = options();
    refreshed.baseOnly = { ...refreshed.baseOnly, id: 'quote_base_refreshed' };
    mocks.prepare.mockResolvedValueOnce({ ok: true, data: options() }).mockResolvedValueOnce({
      ok: true,
      data: refreshed,
    });
    mocks.confirm
      .mockResolvedValueOnce({
        ok: false,
        error: { code: 'quote_not_found', messageKey: 'native.quoteNotFound' },
      })
      .mockResolvedValueOnce({ ok: true, data: { projectId: 'project_1', projectRevision: 4 } });
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Open review' }));
    const modal = await screen.findByTestId('studio-spend-gate');
    const confirm = await within(modal).findByRole('button', {
      name: /conversation\.creativeStudio\.workspace\.gate\.confirm/,
    });
    fireEvent.click(confirm);

    await waitFor(() => expect(mocks.prepare).toHaveBeenCalledTimes(2));
    expect(within(modal).queryByText('conversation.creativeStudio.errors.quoteNotFound')).toBeNull();
    expect(
      within(modal).queryByRole('button', { name: 'conversation.creativeStudio.workspace.gate.prepareAgain' })
    ).toBeNull();
    expect(mocks.confirm).toHaveBeenCalledTimes(1);

    fireEvent.click(
      within(modal).getByRole('button', { name: /conversation\.creativeStudio\.workspace\.gate\.confirm/ })
    );
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledTimes(2));
    expect(mocks.confirm.mock.calls[1]?.[0]).toMatchObject({ quoteId: 'quote_base_refreshed' });
  });

  it('freezes the selected reviewed quote after confirm reports quote in use', async () => {
    mocks.confirm.mockResolvedValue({
      ok: false,
      error: { code: 'quote_in_use', messageKey: 'native.quoteInUse' },
    });
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Open review' }));
    const modal = await screen.findByTestId('studio-spend-gate');
    fireEvent.click(within(modal).getByText('conversation.creativeStudio.workspace.gate.withCascade'));
    fireEvent.click(
      within(modal).getByRole('button', { name: /conversation\.creativeStudio\.workspace\.gate\.confirm/ })
    );

    fireEvent.click(
      within(modal).getByRole('button', {
        name: 'conversation.creativeStudio.workspace.gate.showBreakdown',
      })
    );
    expect(await within(modal).findByText('conversation.creativeStudio.errors.quoteInUse')).toBeVisible();
    expect(within(modal).getByText('safe_video · video_model · video_choice')).toBeVisible();
    for (const option of within(modal).getAllByRole('radio')) expect(option).toBeDisabled();
    expect(
      within(modal).getByRole('button', { name: /conversation\.creativeStudio\.workspace\.gate\.confirm/ })
    ).toBeDisabled();
    expect(
      within(modal).getByRole('button', { name: 'conversation.creativeStudio.workspace.gate.close' })
    ).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Open review' }));
    expect(within(modal).getByText('safe_video · video_model · video_choice')).toBeVisible();
    expect(mocks.prepare).toHaveBeenCalledTimes(1);
    expect(mocks.confirm).toHaveBeenCalledTimes(1);
  });

  it('prevents a reentrant callback from confirming the same paid quote twice', async () => {
    render(<Harness reenterOnConfirmed />);
    fireEvent.click(screen.getByRole('button', { name: 'Open review' }));
    const modal = await screen.findByTestId('studio-spend-gate');
    fireEvent.click(
      within(modal).getByRole('button', { name: /conversation\.creativeStudio\.workspace\.gate\.confirm/ })
    );

    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledTimes(1));
  });

  it('keeps a successful paid commit terminal when its renderer refresh fails', async () => {
    render(<Harness rejectOnConfirmed />);
    fireEvent.click(screen.getByRole('button', { name: 'Open review' }));
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
