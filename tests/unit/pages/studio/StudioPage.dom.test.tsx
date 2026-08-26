import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  StudioAssetV2,
  StudioBriefRuleDraft,
  StudioGenerationBlockV2,
  StudioGenerationCompositionV2,
  StudioGenerationCapabilityItemV2,
  StudioReferenceRequestV2,
  StudioRendererExportCatalogV2,
  StudioRendererChainStatusV2,
  StudioRendererJobV2,
  StudioRendererProjectV2,
  StudioRendererProposalV2,
  StudioRendererReferenceGenerationHandoffV2,
  StudioRendererSubmissionQuoteV2,
  StudioRendererWorkspaceStatusV2,
} from '@/common/types/project/creativeStudioTypes';
import type {
  BeatPanelActions,
  BeatPanelImportResult,
  BoardActions,
  CutActions,
  ReferencesViewActions,
  TableBoardActions,
  WorkspaceMutationCallbacks,
  WorkspaceProjectMenuProps,
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
    boardActions: null as BoardActions | null,
    tableBoardActions: null as TableBoardActions | null,
    cutActions: null as CutActions | null,
    referenceActions: null as ReferencesViewActions | null,
    workspaceMutations: null as WorkspaceMutationCallbacks | null,
    projectMenuProps: null as WorkspaceProjectMenuProps | null,
    directorProposalIntent: null as null | ((intent: 'accept' | 'reject') => Promise<void>),
    bridge: {
      getProject: { invoke: vi.fn() },
      getProjectWorkspace: { invoke: vi.fn() },
      listProposals: { invoke: vi.fn() },
      acceptProposal: { invoke: vi.fn() },
      rejectProposal: { invoke: vi.fn() },
      listReferenceRequests: { invoke: vi.fn() },
      decideReferenceRequest: { invoke: vi.fn() },
      listReferenceGenerationHandoffs: { invoke: vi.fn() },
      projectWorkspaceStatusFixture: { invoke: vi.fn() },
      projectWorkspaceChainFixture: { invoke: vi.fn() },
      listRoutes: { invoke: vi.fn() },
      getGenerationCapability: { invoke: vi.fn() },
      listConnectionCandidates: { invoke: vi.fn() },
      listConnections: { invoke: vi.fn() },
      validateConnection: { invoke: vi.fn() },
      saveConnection: { invoke: vi.fn() },
      importBedAudio: { invoke: vi.fn() },
      detachBedAudio: { invoke: vi.fn() },
      setBed: { invoke: vi.fn() },
      createExport: { invoke: vi.fn() },
      listExports: { invoke: vi.fn() },
      copyExport: { invoke: vi.fn() },
      revealExport: { invoke: vi.fn() },
      prepareSubmission: { invoke: vi.fn() },
      prepareProjectReferences: { invoke: vi.fn() },
      confirmSubmission: { invoke: vi.fn() },
      cancelJob: { invoke: vi.fn() },
      retryJob: { invoke: vi.fn() },
      retryDownload: { invoke: vi.fn() },
      dismissReferenceGenerationHandoff: { invoke: vi.fn() },
      applyAuthoringBatch: { invoke: vi.fn() },
      undoLast: { invoke: vi.fn() },
      retryConditioningFrame: { invoke: vi.fn() },
      cancelWaitingCascade: { invoke: vi.fn() },
      editProject: { invoke: vi.fn() },
      setRules: { invoke: vi.fn() },
      importSeedStill: { invoke: vi.fn() },
      persistCapturedPoster: { invoke: vi.fn() },
      parkShot: { invoke: vi.fn() },
      parkBeat: { invoke: vi.fn() },
      restoreBeat: { invoke: vi.fn() },
      restoreShot: { invoke: vi.fn() },
      reorderBin: { invoke: vi.fn() },
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
      mocks.boardActions = props.boardActions;
      mocks.tableBoardActions = props.tableBoardActions;
      mocks.cutActions = props.cutActions;
      mocks.referenceActions = props.referenceActions ?? null;
      mocks.workspaceMutations = props.mutations;
      return React.createElement(actual.WorkspaceControls, props);
    },
    WorkspaceProjectMenu: (props: React.ComponentProps<typeof actual.WorkspaceProjectMenu>) => {
      mocks.projectMenuProps = props;
      return React.createElement(actual.WorkspaceProjectMenu, props);
    },
  };
});

vi.mock('@/renderer/pages/studio/components/Workspace/DirectorRail', () => ({
  // Applies widthPixels the way the real pane does. A mock that drops the prop would let the shell
  // stop passing it without a single test noticing.
  DirectorRail: ({
    project,
    reviewedOutputs = [],
    collapsed,
    contentId,
    widthPixels,
    onProposalIntent,
  }: {
    project: StudioRendererProjectV2;
    reviewedOutputs?: readonly { id: string; content: React.ReactNode; createdAt: number }[];
    collapsed: boolean;
    contentId: string;
    widthPixels?: number;
    onProposalIntent?: (intent: 'accept' | 'reject') => Promise<void>;
  }) => {
    mocks.directorProposalIntent = onProposalIntent ?? null;
    return (
      <aside
        data-studio-director-rail
        style={collapsed || widthPixels === undefined ? undefined : { inlineSize: `${widthPixels}px` }}
      >
        <div id={contentId} data-studio-director-content aria-hidden={collapsed} inert={collapsed}>
          <span tabIndex={0} data-studio-director-focus-target>
            Director focus target
          </span>
          <div data-studio-director-conversation-owner>
            {project.id}
            <div data-testid='message-list-content'>
              {reviewedOutputs.map((output) => (
                <div data-studio-director-reviewed-output={output.id} key={output.id}>
                  {output.content}
                </div>
              ))}
            </div>
          </div>
        </div>
      </aside>
    );
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values === undefined ? key : `${key}:${JSON.stringify(values)}`,
    i18n: { language: 'en-US', resolvedLanguage: 'en-US' },
  }),
}));

import StudioPage from '@/renderer/pages/studio/StudioPage';
import { railPreferenceKey } from '@/renderer/pages/studio/components/Workspace/WorkspaceShell';
import { useStudioProject, type UseStudioProjectResult } from '@/renderer/pages/studio/hooks/useStudioProject';

const ok = <T,>(data: T) => ({ ok: true as const, data });

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
};

const sameCapabilityItem = (left: StudioGenerationCapabilityItemV2, right: StudioGenerationCapabilityItemV2): boolean =>
  left.purpose === right.purpose &&
  left.target.kind === right.target.kind &&
  (left.target.kind === 'shot' && right.target.kind === 'shot'
    ? left.target.shotId === right.target.shotId
    : left.target.kind === 'reference' && right.target.kind === 'reference'
      ? left.target.referenceId === right.target.referenceId
      : false);

const supportedCapabilityResult = (
  input: { projectId: string; expectedRevision: number; items: StudioGenerationCapabilityItemV2[] },
  catalogVersion = 'catalog_1'
) =>
  ok({
    projectId: input.projectId,
    projectRevision: input.expectedRevision,
    catalogVersion,
    supportedItems: structuredClone(input.items),
    blocks: [],
  });

const mockGenerationBlock = (item: StudioGenerationCapabilityItemV2, block: StudioGenerationBlockV2): void => {
  mocks.bridge.getGenerationCapability.invoke.mockImplementation(
    async (input: { projectId: string; expectedRevision: number; items: StudioGenerationCapabilityItemV2[] }) => {
      if (!input.items.some((candidate) => sameCapabilityItem(candidate, item))) {
        throw new Error(`Capability request omitted blocked item: ${JSON.stringify(item)}`);
      }
      const supportedItems = input.items.filter((candidate) => !sameCapabilityItem(candidate, item));
      return ok({
        projectId: input.projectId,
        projectRevision: input.expectedRevision,
        catalogVersion: 'catalog_1',
        supportedItems,
        blocks: [{ block, items: [structuredClone(item)] }],
      });
    }
  );
};

const project = (): StudioRendererProjectV2 => ({
  schemaVersion: 5,
  revision: 3,
  id: 'project_1',
  name: 'Launch film',
  brief: 'A small launch film.',
  rules: [],
  briefConversationId: null,
  aspectRatio: '16:9',
  targetDurationSeconds: 30,
  resolution: '720p',
  boardStyle: null,
  beatOrder: [],
  beats: {},
  shots: {},
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
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

const unassignedReferenceBinding = () => ({
  status: 'unassigned' as const,
  characterReferenceIds: [],
  backgroundReferenceId: null,
});

const readyReferenceBinding = (characterReferenceIds: string[], backgroundReferenceId: string | null) => ({
  status: 'ready' as const,
  characterReferenceIds,
  backgroundReferenceId,
});

const testComposition = (
  target: StudioRendererJobV2['target'],
  purpose: StudioRendererJobV2['purpose'],
  input: {
    projectRevision?: number;
    referenceInputs?: StudioGenerationCompositionV2['inputs']['referenceInputs'];
    boardStyle?: StudioGenerationCompositionV2['inputs']['boardStyle'];
  } = {}
): StudioGenerationCompositionV2 => {
  const route = {
    choiceId: purpose === 'video_take' ? 'route_video' : 'route_image',
    providerId: 'provider_safe',
    model: 'model_safe',
  };
  const source =
    target.kind === 'reference'
      ? {
          kind: 'project_reference' as const,
          referenceId: target.referenceId,
          referenceKind: target.referenceId.includes('background') ? ('background' as const) : ('character' as const),
          prompt: `Reference prompt for ${target.referenceId}`,
        }
      : {
          kind: 'shot' as const,
          beatId: `beat_for_${target.shotId}`,
          story: `Story for ${target.shotId}`,
          shotId: target.shotId,
          shootingScript: `Shooting script for ${target.shotId}`,
        };
  return {
    inputs: {
      schemaVersion: 1,
      projectRevision: input.projectRevision ?? 3,
      brief: 'A small launch film.',
      rules: [],
      source,
      purpose,
      referenceInputs: input.referenceInputs ?? [],
      aspectRatio: '16:9',
      resolution: '720p',
      route,
      boardStyle: input.boardStyle ?? null,
      instructionProfile: 'studio_generation_v1',
    },
    prompt: `Expanded ${purpose} prompt for ${target.kind === 'shot' ? target.shotId : target.referenceId}`,
  };
};

const projectWithHandoffShot = (): StudioRendererProjectV2 => {
  const value = project();
  value.beatOrder = ['beat_1'];
  value.beats.beat_1 = {
    id: 'beat_1',
    title: 'Opening',
    story: 'Open on the hero in bright daylight.',
    targetSeconds: 4,
    shotOrder: ['shot_3'],
  };
  value.shots.shot_3 = {
    id: 'shot_3',
    shootingScript: 'Opening frame',
    durationSeconds: 4,
    trimInSeconds: null,
    trimOutSeconds: null,
    chainBreak: 'hard_cut',
    referenceBinding: unassignedReferenceBinding(),
    seedStillId: null,
    dismissedSeedStillIds: [],
    boardAssetId: null,
    supersededBoardAssetIds: [],
    videoAssetId: null,
    supersededVideoAssetIds: [],
    assetIds: [],
    jobIds: [],
  };
  return value;
};

const projectWithReferenceHandoff = (): StudioRendererProjectV2 => {
  const value = projectWithHandoffShot();
  value.referencePlanStatus = 'planned';
  value.referenceOrder = ['reference_3'];
  value.references.reference_3 = {
    id: 'reference_3',
    kind: 'character',
    label: 'Hero',
    prompt: 'Stable character sheet for the hero',
    approvedAssetId: null,
    supersededAssetIds: [],
    jobIds: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
  value.shots.shot_3!.referenceBinding = readyReferenceBinding(['reference_3'], null);
  return value;
};

const projectWithCandidateReference = (): StudioRendererProjectV2 => {
  const value = projectWithReferenceHandoff();
  value.imageRouteId = 'route_image';
  value.references.reference_3!.approvedAssetId = 'asset_reference_3';
  value.references.reference_3!.supersededAssetIds = ['asset_reference_3_old'];
  return value;
};

const projectWithReferenceCandidateJob = (
  overrides: Partial<Pick<StudioRendererJobV2, 'status' | 'error' | 'canCancel' | 'canRetry' | 'canRetryDownload'>> = {}
): StudioRendererProjectV2 => {
  const value = projectWithReferenceHandoff();
  const jobId = 'job_reference_3';
  value.imageRouteId = 'route_image';
  value.references.reference_3!.jobIds.push(jobId);
  value.jobs[jobId] = {
    id: jobId,
    projectId: value.id,
    target: { kind: 'reference', referenceId: 'reference_3' },
    status: 'needs_attention',
    provider: { choiceId: 'route_image', providerId: 'provider_safe', model: 'model_safe' },
    outputAssetIds: [],
    outputAssetIdsByRole: { primary: null, poster: null },
    error: {
      code: 'provider_unavailable',
      messageKey: 'conversation.creativeStudio.jobs.errors.providerUnavailable',
    },
    canCancel: true,
    canRetry: true,
    canRetryDownload: false,
    retryOfJobId: null,
    retryReason: null,
    duplicateChargeAcknowledged: false,
    duplicateChargeAcknowledgedAt: null,
    purpose: 'reference_image',
    composition: testComposition({ kind: 'reference', referenceId: 'reference_3' }, 'reference_image'),
    spendReceipt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
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
      story: `Story ${index + 1}`,
      targetSeconds: 4,
      shotOrder: [shotId],
    };
    value.shots[shotId] = {
      id: shotId,
      shootingScript: `Shot ${index + 1}`,
      durationSeconds: 4,
      trimInSeconds: null,
      trimOutSeconds: null,
      chainBreak: index === 0 ? 'hard_cut' : 'none',
      referenceBinding: unassignedReferenceBinding(),
      seedStillId: null,
      dismissedSeedStillIds: [],
      boardAssetId: null,
      supersededBoardAssetIds: [],
      videoAssetId: null,
      supersededVideoAssetIds: [],
      assetIds: [],
      jobIds: [],
    };
  }
  return value;
};

const projectWithGenerationReferences = (
  beatCount: number,
  input: { approvedBackground?: boolean; assignedBackgroundShotIds?: readonly string[] } = {}
): StudioRendererProjectV2 => {
  const value = projectWithDraftBatch(beatCount);
  const approvedBackground = input.approvedBackground ?? true;
  const assignedBackgroundShotIds = new Set(input.assignedBackgroundShotIds ?? []);
  value.imageRouteId = 'route_image';
  value.referencePlanStatus = 'planned';
  value.referenceOrder = ['reference_character', 'reference_background'];

  const addApprovedReference = (referenceId: string, kind: 'character' | 'background', label: string): void => {
    const assetId = `asset_${referenceId}`;
    const jobId = `job_${referenceId}`;
    value.references[referenceId] = {
      id: referenceId,
      kind,
      label,
      prompt: label,
      approvedAssetId: assetId,
      supersededAssetIds: [],
      jobIds: [jobId],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    value.assets[assetId] = {
      id: assetId,
      projectId: value.id,
      shotId: null,
      mediaKind: 'image',
      mimeType: 'image/png',
      managedAsset: { collection: 'assets', fileName: `${assetId}.png` },
      byteSize: 16,
      sha256: (kind === 'character' ? 'a' : 'b').repeat(64),
      createdAt: '2026-01-01T00:00:00.000Z',
      projectReferenceId: referenceId,
      generationReferenceAssetIds: [],
      producerJobId: jobId,
      compositionDigest: (kind === 'character' ? 'c' : 'd').repeat(64),
    };
    value.jobs[jobId] = {
      id: jobId,
      projectId: value.id,
      target: { kind: 'reference', referenceId },
      status: 'succeeded',
      provider: { choiceId: 'route_image', providerId: 'provider_safe', model: 'model_safe' },
      outputAssetIds: [assetId],
      outputAssetIdsByRole: { primary: assetId, poster: null },
      error: null,
      canCancel: false,
      canRetry: false,
      canRetryDownload: false,
      retryOfJobId: null,
      retryReason: null,
      duplicateChargeAcknowledged: false,
      duplicateChargeAcknowledgedAt: null,
      purpose: 'reference_image',
      composition: testComposition({ kind: 'reference', referenceId }, 'reference_image'),
      spendReceipt: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
  };

  addApprovedReference('reference_character', 'character', 'Hero');
  if (approvedBackground) {
    addApprovedReference('reference_background', 'background', 'City park');
  } else {
    value.references.reference_background = {
      id: 'reference_background',
      kind: 'background',
      label: 'City park',
      prompt: 'City park',
      approvedAssetId: null,
      supersededAssetIds: [],
      jobIds: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
  }
  for (let index = 0; index < beatCount; index += 1) {
    const shotId = `shot_${index}`;
    value.shots[shotId]!.referenceBinding = readyReferenceBinding(
      ['reference_character'],
      assignedBackgroundShotIds.has(shotId) ? 'reference_background' : null
    );
  }
  return value;
};

const projectWithBoardJobs = (shotCount: number, includeJobs = true): StudioRendererProjectV2 => {
  const value = project();
  value.boardStyle = 'grey_tone';
  value.imageRouteId = 'route_image';
  value.targetDurationSeconds = shotCount * 4;
  for (let offset = 0; offset < shotCount; offset += 8) {
    const beatId = `board_beat_${offset / 8 + 1}`;
    const shotIds = Array.from({ length: Math.min(8, shotCount - offset) }, (_, index) => {
      const shotNumber = offset + index + 1;
      const shotId = `board_shot_${String(shotNumber).padStart(2, '0')}`;
      const jobId = `board_job_${String(shotNumber).padStart(2, '0')}`;
      value.shots[shotId] = {
        id: shotId,
        shootingScript: `Board Shot ${shotNumber}`,
        durationSeconds: 4,
        trimInSeconds: null,
        trimOutSeconds: null,
        chainBreak: 'hard_cut',
        referenceBinding: unassignedReferenceBinding(),
        seedStillId: null,
        dismissedSeedStillIds: [],
        boardAssetId: null,
        supersededBoardAssetIds: [],
        videoAssetId: null,
        supersededVideoAssetIds: [],
        assetIds: [],
        jobIds: includeJobs ? [jobId] : [],
      };
      if (includeJobs) {
        value.jobs[jobId] = {
          id: jobId,
          projectId: value.id,
          target: { kind: 'shot', shotId },
          status: 'queued_local',
          provider: { choiceId: 'route_image', providerId: 'provider_safe', model: 'model_safe' },
          outputAssetIds: [],
          outputAssetIdsByRole: { primary: null, poster: null },
          error: null,
          canCancel: true,
          canRetry: false,
          canRetryDownload: false,
          retryOfJobId: null,
          retryReason: null,
          duplicateChargeAcknowledged: false,
          duplicateChargeAcknowledgedAt: null,
          purpose: 'board_still',
          composition: testComposition({ kind: 'shot', shotId }, 'board_still', { boardStyle: 'grey_tone' }),
          spendReceipt: null,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        };
      }
      return shotId;
    });
    value.beatOrder.push(beatId);
    value.beats[beatId] = {
      id: beatId,
      title: `Board Beat ${offset / 8 + 1}`,
      story: `Board story ${offset / 8 + 1}`,
      targetSeconds: shotIds.length * 4,
      shotOrder: shotIds,
    };
  }
  return value;
};

const withCancelledBoardJobs = (source: StudioRendererProjectV2, cancelledCount: number): StudioRendererProjectV2 => {
  const value = structuredClone(source);
  value.revision = source.revision + cancelledCount;
  for (let shotNumber = 1; shotNumber <= cancelledCount; shotNumber += 1) {
    const jobId = `board_job_${String(shotNumber).padStart(2, '0')}`;
    const job = value.jobs[jobId];
    if (job === undefined) continue;
    job.status = 'cancelled';
    job.canCancel = false;
    job.updatedAt = `2026-01-01T00:00:${String(shotNumber).padStart(2, '0')}.000Z`;
  }
  return value;
};

const withCurrentBoardPanels = (
  source: StudioRendererProjectV2,
  shotNumbers: readonly number[]
): StudioRendererProjectV2 => {
  const value = structuredClone(source);
  for (const shotNumber of shotNumbers) {
    const suffix = String(shotNumber).padStart(2, '0');
    const shotId = `board_shot_${suffix}`;
    const assetId = `board_asset_${suffix}`;
    const jobId = `board_current_job_${suffix}`;
    const shot = value.shots[shotId];
    if (shot === undefined) continue;
    value.assets[assetId] = {
      id: assetId,
      projectId: value.id,
      shotId,
      mediaKind: 'image',
      mimeType: 'image/png',
      managedAsset: { collection: 'boardStills', fileName: `${assetId}.png` },
      byteSize: 16,
      sha256: 'b'.repeat(64),
      createdAt: '2026-01-01T00:00:00.000Z',
      projectReferenceId: null,
      generationReferenceAssetIds: [],
      producerJobId: jobId,
      compositionDigest: 'd'.repeat(64),
    };
    shot.boardAssetId = assetId;
    shot.assetIds.push(assetId);
    shot.jobIds.push(jobId);
    value.jobs[jobId] = {
      id: jobId,
      projectId: value.id,
      target: { kind: 'shot', shotId },
      status: 'succeeded',
      provider: { choiceId: 'route_image', providerId: 'provider_safe', model: 'model_safe' },
      outputAssetIds: [assetId],
      outputAssetIdsByRole: { primary: assetId, poster: null },
      error: null,
      canCancel: false,
      canRetry: false,
      canRetryDownload: false,
      retryOfJobId: null,
      retryReason: null,
      duplicateChargeAcknowledged: false,
      duplicateChargeAcknowledgedAt: null,
      purpose: 'board_still',
      composition: testComposition({ kind: 'shot', shotId }, 'board_still', {
        projectRevision: value.revision,
        boardStyle: value.boardStyle,
      }),
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
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
  }
  return value;
};

const withCurrentVideoTakes = (
  source: StudioRendererProjectV2,
  shotNumbers: readonly number[]
): StudioRendererProjectV2 => {
  const value = structuredClone(source);
  for (const shotNumber of shotNumbers) {
    const suffix = String(shotNumber).padStart(2, '0');
    const shotId = `board_shot_${suffix}`;
    const assetId = `video_asset_${suffix}`;
    const shot = value.shots[shotId];
    if (shot === undefined) continue;
    value.assets[assetId] = {
      id: assetId,
      projectId: value.id,
      shotId,
      mediaKind: 'video',
      mimeType: 'video/mp4',
      managedAsset: { collection: 'assets', fileName: `${assetId}.mp4` },
      byteSize: 16,
      sha256: 'c'.repeat(64),
      durationSeconds: 4,
      createdAt: '2026-01-01T00:00:00.000Z',
      projectReferenceId: null,
      generationReferenceAssetIds: [],
      producerJobId: null,
      compositionDigest: null,
    };
    shot.videoAssetId = assetId;
    shot.assetIds.push(assetId);
  }
  return value;
};

const boardPromotionQuote = (
  authority: StudioRendererProjectV2,
  shotIds: readonly string[]
): StudioRendererSubmissionQuoteV2 => ({
  id: 'quote_board_promotion',
  projectId: authority.id,
  projectRevision: authority.revision,
  expiresAt: '2026-01-01T01:00:00.000Z',
  currency: 'USD',
  baseItems: shotIds.map((shotId) => ({
    target: { kind: 'shot' as const, shotId },
    purpose: 'video_take',
    route: { choiceId: 'route_video', providerId: 'provider_safe', model: 'model_safe' },
    generationCount: 1,
    durationSeconds: 4,
    oneGenerationMinorUnits: 400,
    requestedTotalMinorUnits: 400,
    composition: testComposition({ kind: 'shot', shotId }, 'video_take', {
      projectRevision: authority.revision,
      boardStyle: authority.boardStyle,
    }),
  })),
  cascadeItems: [],
  lowerMinorUnits: shotIds.length * 400,
  upperMinorUnits: shotIds.length * 400,
  budget: { kind: 'within_cap', policyCurrency: 'USD', maxPerBatchMinorUnits: 10_000 },
});

const withBoardAttention = (
  source: StudioRendererProjectV2,
  input: { submissionUnknown: boolean; canCancel: boolean }
): StudioRendererProjectV2 => {
  const value = structuredClone(source);
  const job = value.jobs.board_job_01!;
  job.status = 'needs_attention';
  job.error = {
    code: input.submissionUnknown ? 'submission_unknown' : 'provider_unavailable',
    messageKey: input.submissionUnknown
      ? 'conversation.creativeStudio.jobs.errors.submissionUnknown'
      : 'conversation.creativeStudio.jobs.errors.providerUnavailable',
  };
  job.canRetry = true;
  job.canCancel = input.canCancel;
  return value;
};

const recoveryAsset = (id: string, shotId: string | null, mediaKind: StudioAssetV2['mediaKind']): StudioAssetV2 => ({
  id,
  projectId: 'project_1',
  shotId,
  mediaKind,
  mimeType: mediaKind === 'video' ? 'video/mp4' : mediaKind === 'audio' ? 'audio/wav' : 'image/png',
  managedAsset: { collection: mediaKind === 'video' ? 'assets' : 'imports', fileName: `${id}.bin` },
  byteSize: 16,
  sha256: 'a'.repeat(64),
  ...(mediaKind === 'video' || mediaKind === 'audio' ? { durationSeconds: 4 } : {}),
  createdAt: '2026-01-01T00:00:00.000Z',
  projectReferenceId: null,
  generationReferenceAssetIds: [],
  producerJobId: null,
  compositionDigest: null,
});

const projectWithRecovery = (revision = 3): StudioRendererProjectV2 => {
  const value = project();
  const shotIds = ['upstream_seed', 'dependent_seed', 'upstream_take', 'dependent_take'];
  value.revision = revision;
  value.beatOrder = ['beat_recovery'];
  value.beats.beat_recovery = {
    id: 'beat_recovery',
    title: 'Recovery Beat',
    story: 'Continue the authorized sequence in warm daylight.',
    targetSeconds: 16,
    shotOrder: shotIds,
  };
  for (const [index, shotId] of shotIds.entries()) {
    value.shots[shotId] = {
      id: shotId,
      shootingScript: `Recovery Shot ${index + 1}`,
      durationSeconds: 4,
      trimInSeconds: null,
      trimOutSeconds: null,
      chainBreak: index === 0 || index === 2 ? 'hard_cut' : 'none',
      referenceBinding: unassignedReferenceBinding(),
      seedStillId: null,
      dismissedSeedStillIds: [],
      boardAssetId: null,
      supersededBoardAssetIds: [],
      videoAssetId: null,
      supersededVideoAssetIds: [],
      assetIds: [],
      jobIds: [],
    };
  }
  const seed = recoveryAsset('seed_asset', 'upstream_seed', 'image');
  const take = recoveryAsset('take_asset', 'upstream_take', 'video');
  value.assets = { [seed.id]: seed, [take.id]: take };
  value.shots.upstream_seed!.assetIds.push(seed.id);
  value.shots.upstream_take!.assetIds.push(take.id);
  value.shots.upstream_take!.videoAssetId = take.id;
  return value;
};

const projectWithAuthorizedSeedLock = (revision = 3): StudioRendererProjectV2 => {
  const value = projectWithGenerationReferences(1, { assignedBackgroundShotIds: ['shot_0'] });
  value.revision = revision;
  value.targetDurationSeconds = 8;
  value.beats.beat_0!.targetSeconds = 8;
  value.beats.beat_0!.shotOrder.push('shot_locked');
  value.shots.shot_locked = {
    ...value.shots.shot_0!,
    id: 'shot_locked',
    shootingScript: 'Authorized locked Shot',
    chainBreak: 'hard_cut',
    seedStillId: null,
    dismissedSeedStillIds: [],
    boardAssetId: null,
    supersededBoardAssetIds: [],
    videoAssetId: null,
    supersededVideoAssetIds: [],
    assetIds: ['authorized_seed', 'imported_seed'],
    jobIds: [],
  };
  value.assets.authorized_seed = {
    ...recoveryAsset('authorized_seed', 'shot_locked', 'image'),
    managedAsset: { collection: 'assets', fileName: 'authorized_seed.png' },
    createdAt: '2026-01-01T00:00:01.000Z',
    sha256: 'd'.repeat(64),
  };
  value.assets.imported_seed = {
    ...recoveryAsset('imported_seed', 'shot_locked', 'image'),
    managedAsset: { collection: 'imports', fileName: 'imported_seed.png' },
    createdAt: '2026-01-01T00:00:02.000Z',
    sha256: 'e'.repeat(64),
  };
  return value;
};

const projectWithAttentionJob = (
  status: 'needs_attention' | 'queued_remote' | 'failed' | 'cancelled'
): StudioRendererProjectV2 => {
  const value = projectWithHandoffShot();
  value.revision = status === 'needs_attention' ? 3 : 4;
  value.shots.shot_3!.jobIds = ['job_attention'];
  value.jobs.job_attention = {
    id: 'job_attention',
    projectId: value.id,
    target: { kind: 'shot', shotId: 'shot_3' },
    status,
    provider: { choiceId: 'route_video', providerId: 'provider_safe', model: 'model_safe' },
    outputAssetIds: [],
    outputAssetIdsByRole: { primary: null, poster: null },
    error:
      status === 'needs_attention'
        ? {
            code: 'provider_unavailable',
            messageKey: 'conversation.creativeStudio.jobs.errors.providerUnavailable',
          }
        : null,
    canCancel: status === 'needs_attention',
    canRetry: status === 'needs_attention',
    canRetryDownload: false,
    retryOfJobId: null,
    retryReason: null,
    duplicateChargeAcknowledged: false,
    duplicateChargeAcknowledgedAt: null,
    purpose: 'video_take',
    composition: testComposition({ kind: 'shot', shotId: 'shot_3' }, 'video_take', {
      projectRevision: value.revision,
    }),
    spendReceipt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
  return value;
};

const statusProject = (authority: number | StudioRendererProjectV2): StudioRendererProjectV2 => {
  if (typeof authority !== 'number') return authority;
  return { ...project(), revision: authority };
};

const currentVideoJobs = (authority: StudioRendererProjectV2): StudioRendererWorkspaceStatusV2['currentVideoJobs'] =>
  authority.beatOrder.flatMap((beatId) => {
    const beat = authority.beats[beatId];
    if (beat?.id !== beatId) return [];
    return beat.shotOrder.map((shotId) => {
      const shot = authority.shots[shotId];
      return {
        shotId,
        jobIds:
          shot?.id === shotId
            ? shot.jobIds.filter((jobId) => {
                const job = authority.jobs[jobId];
                return (
                  job?.id === jobId &&
                  job.target.kind === 'shot' &&
                  job.target.shotId === shotId &&
                  job.purpose === 'video_take'
                );
              })
            : [],
      };
    });
  });

const boardPanels = (authority: StudioRendererProjectV2): StudioRendererWorkspaceStatusV2['boardPanels'] =>
  authority.beatOrder.flatMap((beatId) => {
    const beat = authority.beats[beatId];
    if (beat?.id !== beatId) return [];
    return beat.shotOrder.flatMap((shotId) => {
      const shot = authority.shots[shotId];
      if (shot?.id !== shotId) return [];
      const latestBoardJob = shot.jobIds.reduce<StudioRendererJobV2 | null>((latest, jobId) => {
        const job = authority.jobs[jobId];
        return job?.id === jobId &&
          job.projectId === authority.id &&
          job.target.kind === 'shot' &&
          job.target.shotId === shot.id &&
          job.purpose === 'board_still'
          ? job
          : latest;
      }, null);
      const producer = shot.jobIds
        .map((jobId) => authority.jobs[jobId])
        .find(
          (job) =>
            job?.id !== undefined &&
            job.projectId === authority.id &&
            job.target.kind === 'shot' &&
            job.target.shotId === shot.id &&
            job.purpose === 'board_still' &&
            job.status === 'succeeded' &&
            job.outputAssetIdsByRole.primary === shot.boardAssetId
        );
      return [
        {
          shotId,
          assetId: shot.boardAssetId,
          producerJobId: producer?.id ?? null,
          latestJobId: latestBoardJob?.id ?? null,
          staleCauses: [],
        },
      ];
    });
  });

const chainBoundaries = (authority: StudioRendererProjectV2): StudioRendererChainStatusV2['boundaries'] =>
  authority.beatOrder.flatMap((beatId) => {
    const beat = authority.beats[beatId];
    if (beat?.id !== beatId) return [];
    return beat.shotOrder.slice(1).flatMap((dependentShotId, index) => {
      const upstreamShotId = beat.shotOrder[index]!;
      const upstream = authority.shots[upstreamShotId];
      const dependent = authority.shots[dependentShotId];
      if (upstream?.id !== upstreamShotId || dependent?.id !== dependentShotId || dependent.chainBreak === 'hard_cut') {
        return [];
      }
      return [{ upstreamShotId, dependentShotId, status: 'empty' as const, frameAssetId: null }];
    });
  });

const recoveryStatus = (authority: number | StudioRendererProjectV2): StudioRendererWorkspaceStatusV2 => ({
  ...workspaceStatus(typeof authority === 'number' ? projectWithRecovery(authority) : authority),
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

const workspaceStatus = (source: number | StudioRendererProjectV2, locked = false): StudioRendererWorkspaceStatusV2 => {
  const authority = statusProject(source);
  return {
    projectId: authority.id,
    projectRevision: authority.revision,
    undoTop: null,
    dirtyShots: [],
    boardPanels: boardPanels(authority),
    cascadeProgress: [],
    currentVideoJobs: currentVideoJobs(authority),
    parkEligibility: locked
      ? [
          {
            subject: 'shot' as const,
            action: 'park' as const,
            beatId: 'beat_1',
            shotId: 'shot_1',
            allowed: false,
            blockers: [{ shotId: 'shot_1', code: 'bound_nonterminal_request' as const }],
          },
        ]
      : [],
  };
};

const authorizedSeedLockStatus = (
  authority: StudioRendererProjectV2,
  waitingReason: 'choose_seed' | 'cancelled' = 'choose_seed'
): StudioRendererWorkspaceStatusV2 => ({
  ...workspaceStatus(authority),
  cascadeProgress: [
    {
      dependentShotId: 'shot_locked',
      upstreamShotId: 'shot_locked',
      eligiblePrimaryAssetIds: waitingReason === 'choose_seed' ? ['authorized_seed'] : [],
      canRetryConditioningFrame: false,
      canCancelWaiting: waitingReason === 'choose_seed',
      waitingReason,
    },
  ],
});

const chainStatus = (source: number | StudioRendererProjectV2): StudioRendererChainStatusV2 => {
  const authority = statusProject(source);
  return {
    projectId: authority.id,
    projectRevision: authority.revision,
    conditioningFailures: [],
    boundaries: chainBoundaries(authority),
  };
};

const projectWorkspaceLoad = (
  authority: StudioRendererProjectV2,
  workspace = workspaceStatus(authority),
  chain = chainStatus(authority)
) =>
  ok({
    status: 'supported' as const,
    snapshot: { project: authority, workspaceStatus: workspace, chainStatus: chain },
  });

const mockSupportedProject = (authority: StudioRendererProjectV2): void => {
  mocks.bridge.getProject.invoke.mockResolvedValue(ok({ status: 'supported', project: authority }));
  mocks.bridge.projectWorkspaceStatusFixture.invoke.mockResolvedValue(ok(workspaceStatus(authority)));
  mocks.bridge.projectWorkspaceChainFixture.invoke.mockResolvedValue(ok(chainStatus(authority)));
};

const installCompositeProjectWorkspaceRead = (): void => {
  mocks.bridge.getProjectWorkspace.invoke.mockImplementation(async (input: { projectId: string }) => {
    const projectResult = await mocks.bridge.getProject.invoke(input);
    if (projectResult.ok === false) return projectResult;
    if (projectResult.data.status !== 'supported') return projectResult;
    const workspaceResult = await mocks.bridge.projectWorkspaceStatusFixture.invoke(input);
    if (workspaceResult.ok === false) return workspaceResult;
    const chainResult = await mocks.bridge.projectWorkspaceChainFixture.invoke(input);
    if (chainResult.ok === false) return chainResult;
    return ok({
      status: 'supported' as const,
      snapshot: {
        project: projectResult.data.project,
        workspaceStatus: workspaceResult.data,
        chainStatus: chainResult.data,
      },
    });
  });
};

const commit = (revision: number) =>
  ok({ projectId: 'project_1', projectRevision: revision, createdBeatIds: [], createdShotIds: [] });

const proposal = (): StudioRendererProposalV2 => ({
  schemaVersion: 5,
  id: 'proposal_1',
  projectId: 'project_1',
  status: 'pending',
  baseRevision: 3,
  payload: { kind: 'mutation_batch', operations: [{ kind: 'set_brief', brief: 'A sharper launch film.' }] },
  createdAt: '2026-01-01T00:00:01.000Z',
  decidedAt: null,
  review: {
    status: 'ready',
    groups: [
      {
        change: 'edited',
        subject: {
          kind: 'project',
          id: 'project_1',
          title: 'Launch film',
          position: null,
          ownerBeatId: null,
          ownerBeatTitle: null,
        },
        fields: [
          {
            key: 'brief',
            before: { kind: 'text', value: 'A small launch film.' },
            after: { kind: 'text', value: 'A sharper launch film.' },
          },
        ],
      },
    ],
  },
});

const pinRuleProposal = (): StudioRendererProposalV2 => ({
  ...proposal(),
  id: 'proposal_rule',
  payload: { kind: 'pin_rule', rule: { text: 'Never show a logo', predicate: null } },
});

const referenceRequest = (): StudioReferenceRequestV2 => ({
  schemaVersion: 5,
  id: 'reference_1',
  projectId: 'project_1',
  referenceIds: ['reference_1', 'reference_2'],
  status: 'pending',
  createdAt: '2026-01-01T00:00:02.000Z',
});

const handoff = (
  status: StudioRendererReferenceGenerationHandoffV2['status'] = 'awaiting_spend'
): StudioRendererReferenceGenerationHandoffV2 => ({
  handoffId: `handoff_${status}`,
  requestId: `reference_${status}`,
  referenceIds: ['reference_3'],
  decidedAt: '2026-01-01T00:00:03.000Z',
  status,
  counts: {
    queued: status === 'awaiting_spend' ? 1 : 0,
    running: status === 'running' ? 1 : 0,
    succeeded: status === 'succeeded' ? 1 : 0,
    failed: status === 'partially_failed' || status === 'failed' ? 1 : 0,
  },
  resultAssetIds: status === 'succeeded' ? ['asset_reference_3'] : [],
  failedReferenceIds: status === 'partially_failed' || status === 'failed' ? ['reference_3'] : [],
  completedAt: status === 'awaiting_spend' || status === 'running' ? null : '2026-01-01T00:00:04.000Z',
});

const LocationProbe = () => {
  const location = useLocation();
  return <output data-testid='location'>{location.pathname}</output>;
};

const ProjectSwitchProbe = () => {
  const navigate = useNavigate();
  return (
    <>
      <button onClick={() => navigate('/studio/project_2/table')}>Switch project</button>
      <button onClick={() => navigate('/studio/project_1/table')}>Return to first project</button>
      <button onClick={() => navigate('/studio')}>Return to library</button>
    </>
  );
};

let latestHookResult: UseStudioProjectResult | null = null;

const HookProbe: React.FC<{ projectId?: string }> = ({ projectId }) => {
  latestHookResult = useStudioProject(projectId);
  return <output data-testid='hook-state'>{latestHookResult.loadState}</output>;
};

const attachedProject = () => ({ ...project(), briefConversationId: 'conversation_director' });

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
        <Route
          path='/studio'
          element={
            <>
              <StudioPage />
              <LocationProbe />
              <ProjectSwitchProbe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>
  );

const renderStudioWithProjectSwitch = () =>
  render(
    <MemoryRouter initialEntries={['/studio/project_1/table']}>
      <Routes>
        <Route
          path='/studio/:id/:view?'
          element={
            <>
              <StudioPage />
              <LocationProbe />
              <ProjectSwitchProbe />
            </>
          }
        />
        <Route
          path='/studio'
          element={
            <>
              <StudioPage />
              <LocationProbe />
              <ProjectSwitchProbe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>
  );

const MORE = 'common.more';
const SETTINGS_TITLE = 'conversation.creativeStudio.workspace.controls.settingsTitle';
const BRIEF_RULES_TITLE = 'conversation.creativeStudio.workspace.controls.briefAndRulesTitle';
const NAME = 'conversation.creativeStudio.workspace.controls.name';
const BRIEF = 'conversation.creativeStudio.workspace.controls.brief';
const IMAGE_ROUTE = 'conversation.creativeStudio.workspace.controls.imageRoute';
const VIDEO_ROUTE = 'conversation.creativeStudio.workspace.controls.videoRoute';
const RULE_TEXT = 'conversation.creativeStudio.rules.textLabel';
const RULE_TERMS = 'conversation.creativeStudio.rules.termsLabel';

const openProjectDialog = async (title: typeof SETTINGS_TITLE | typeof BRIEF_RULES_TITLE): Promise<HTMLElement> => {
  fireEvent.click(await screen.findByRole('button', { name: MORE }));
  const menu = await screen.findByRole('menu');
  fireEvent.click(within(menu).getByRole('menuitem', { name: title }));
  return screen.findByRole('dialog', { name: title });
};

const closeProjectDialog = async (dialog: HTMLElement, title: string): Promise<void> => {
  fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: title })).toBeNull());
};

const expectProjectFormsAbsentFromMain = (view: 'table' | 'board' | 'cut'): void => {
  const main = document.querySelector<HTMLElement>(`main[data-studio-view="${view}"]`);
  expect(main).not.toBeNull();
  expect(within(main!).queryByLabelText(NAME)).toBeNull();
  expect(within(main!).queryByLabelText(BRIEF)).toBeNull();
};

const seedWorkspaceDrafts = (
  entries: Record<string, { baseValue: unknown; value: unknown }>,
  projectId = 'project_1',
  sourceRevision = 3
): void => {
  window.sessionStorage.setItem(
    `aionui:creative-studio:v3:workspace-drafts:${projectId}`,
    JSON.stringify({
      version: 3,
      projectId,
      sourceRevision,
      entries,
      selection: { selectedBeatId: null, selectedShotIds: [], anchorShotId: null },
    })
  );
};

const capturedBeatPanelActions = (): BeatPanelActions => {
  expect(mocks.beatPanelActions).not.toBeNull();
  return mocks.beatPanelActions!;
};

const capturedBoardActions = (): BoardActions => {
  expect(mocks.boardActions).not.toBeNull();
  return mocks.boardActions!;
};

const capturedTableBoardActions = (): TableBoardActions => {
  expect(mocks.tableBoardActions).not.toBeNull();
  return mocks.tableBoardActions!;
};

const capturedCutActions = (): CutActions => {
  expect(mocks.cutActions).not.toBeNull();
  return mocks.cutActions!;
};

const capturedReferenceActions = (): ReferencesViewActions => {
  expect(mocks.referenceActions).not.toBeNull();
  return mocks.referenceActions!;
};

const capturedWorkspaceMutations = (): WorkspaceMutationCallbacks => {
  expect(mocks.workspaceMutations).not.toBeNull();
  return mocks.workspaceMutations!;
};

const capturedProjectMenuProps = (): WorkspaceProjectMenuProps => {
  expect(mocks.projectMenuProps).not.toBeNull();
  return mocks.projectMenuProps!;
};

const capturedDirectorProposalIntent = (): ((intent: 'accept' | 'reject') => Promise<void>) => {
  expect(mocks.directorProposalIntent).not.toBeNull();
  return mocks.directorProposalIntent!;
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

const invokeStudioAction = async <Result,>(invoke: () => Promise<Result>): Promise<Result> => {
  let result!: Result;
  await act(async () => {
    result = await invoke();
  });
  return result;
};

describe('StudioPage schema-5 cutover', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
    // The rail's collapse choice and width persist per project and view, so a test that toggles the
    // rail would otherwise decide the starting state of every test after it.
    window.localStorage.clear();
    latestHookResult = null;
    mocks.beatPanelActions = null;
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
    mocks.boardActions = null;
    mocks.tableBoardActions = null;
    mocks.cutActions = null;
    mocks.referenceActions = null;
    mocks.workspaceMutations = null;
    mocks.projectMenuProps = null;
    mocks.directorProposalIntent = null;
    mocks.bridge.getProject.invoke.mockResolvedValue(ok({ status: 'supported', project: project() }));
    mocks.bridge.listProposals.invoke.mockResolvedValue(ok([]));
    mocks.bridge.listReferenceRequests.invoke.mockResolvedValue(ok([]));
    mocks.bridge.listReferenceGenerationHandoffs.invoke.mockResolvedValue(ok([]));
    mocks.bridge.projectWorkspaceStatusFixture.invoke.mockResolvedValue(ok(workspaceStatus(3)));
    mocks.bridge.projectWorkspaceChainFixture.invoke.mockResolvedValue(ok(chainStatus(3)));
    installCompositeProjectWorkspaceRead();
    mocks.bridge.listRoutes.invoke.mockResolvedValue(
      ok({
        image: { status: 'ready', selected: null, selectedRoute: null, selectionIssue: null, options: [] },
        video: { status: 'ready', selected: null, selectedRoute: null, selectionIssue: null, options: [] },
        catalogVersion: 'catalog_1',
      })
    );
    mocks.bridge.getGenerationCapability.invoke.mockImplementation(
      async (input: { projectId: string; expectedRevision: number; items: StudioGenerationCapabilityItemV2[] }) =>
        supportedCapabilityResult(input)
    );
    mocks.bridge.listConnectionCandidates.invoke.mockResolvedValue(ok([]));
    mocks.bridge.listConnections.invoke.mockResolvedValue(ok({ integrations: [], connections: [] }));
    mocks.bridge.validateConnection.invoke.mockResolvedValue(ok({}));
    mocks.bridge.saveConnection.invoke.mockResolvedValue(ok({}));
    mocks.bridge.listExports.invoke.mockResolvedValue(ok({ revision: 1, artifacts: [] }));
    mocks.bridge.applyAuthoringBatch.invoke.mockResolvedValue(commit(4));
    mocks.bridge.undoLast.invoke.mockResolvedValue(commit(4));
    mocks.bridge.retryConditioningFrame.invoke.mockResolvedValue(commit(4));
    mocks.bridge.cancelWaitingCascade.invoke.mockResolvedValue(commit(4));
    mocks.bridge.editProject.invoke.mockResolvedValue(commit(4));
    mocks.bridge.setRules.invoke.mockResolvedValue(commit(4));
    mocks.bridge.importSeedStill.invoke.mockResolvedValue(ok({ status: 'cancelled' }));
    mocks.bridge.importBedAudio.invoke.mockResolvedValue(ok({ status: 'cancelled' }));
    mocks.bridge.detachBedAudio.invoke.mockResolvedValue(ok({ status: 'detached', projectRevision: 4 }));
    mocks.bridge.setBed.invoke.mockResolvedValue(commit(4));
    mocks.bridge.createExport.invoke.mockResolvedValue(ok({ revision: 2, artifacts: [] }));
    mocks.bridge.copyExport.invoke.mockResolvedValue(ok({ status: 'cancelled' }));
    mocks.bridge.revealExport.invoke.mockResolvedValue(ok({ status: 'revealed' }));
    mocks.bridge.parkShot.invoke.mockResolvedValue(commit(4));
    mocks.bridge.parkBeat.invoke.mockResolvedValue(commit(4));
    mocks.bridge.restoreBeat.invoke.mockResolvedValue(commit(4));
    mocks.bridge.restoreShot.invoke.mockResolvedValue(commit(4));
    mocks.bridge.reorderBin.invoke.mockResolvedValue(commit(4));
    mocks.bridge.prepareProjectReferences.invoke.mockResolvedValue({
      ok: false,
      error: { code: 'invalid_prepare_request', messageKey: 'native.prepareReferencesFailed' },
    });
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
        schemaVersion: 5,
        requestId: 'reference_1',
        projectId: 'project_1',
        decidedAt: '2026-01-01T00:00:05.000Z',
        outcome: {
          kind: 'generation_gate',
          handoffId: 'handoff_open',
          referenceIds: ['reference_1', 'reference_2'],
        },
      })
    );
  });

  it('requests the exact ordered capability matrix for every Shot and semantic reference', async () => {
    const authority = projectWithGenerationReferences(2);
    mockSupportedProject(authority);

    render(<HookProbe projectId='project_1' />);

    await waitFor(() => expect(mocks.bridge.getGenerationCapability.invoke).toHaveBeenCalledOnce());
    expect(mocks.bridge.getGenerationCapability.invoke).toHaveBeenCalledWith({
      projectId: authority.id,
      expectedRevision: authority.revision,
      items: [
        { target: { kind: 'shot', shotId: 'shot_0' }, purpose: 'seed_still' },
        { target: { kind: 'shot', shotId: 'shot_0' }, purpose: 'board_still' },
        { target: { kind: 'shot', shotId: 'shot_0' }, purpose: 'video_take' },
        { target: { kind: 'shot', shotId: 'shot_1' }, purpose: 'seed_still' },
        { target: { kind: 'shot', shotId: 'shot_1' }, purpose: 'board_still' },
        { target: { kind: 'shot', shotId: 'shot_1' }, purpose: 'video_take' },
        { target: { kind: 'reference', referenceId: 'reference_character' }, purpose: 'reference_image' },
        { target: { kind: 'reference', referenceId: 'reference_background' }, purpose: 'reference_image' },
      ],
    });
    expect(mocks.bridge.listRoutes.invoke.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.bridge.getGenerationCapability.invoke.mock.invocationCallOrder[0]!
    );
  });

  it('refreshes the shared catalogue after provisioning, so a bound route stops reading Unavailable', async () => {
    // Binding from our own read is not enough: the workspace keeps its pre-provisioning snapshot,
    // the bound choice id resolves to no route, and the Brief reports a working route as
    // "Unavailable" until the user finds Refresh routes. Observed live before this call existed.
    mocks.bridge.getProject.invoke.mockResolvedValue(ok({ status: 'supported', project: attachedProject() }));
    mocks.bridge.listConnectionCandidates.invoke.mockResolvedValue(
      ok([
        {
          providerId: 'p1',
          providerName: 'OpenRouter',
          models: [],
          integrationModels: [
            { integrationLabelKey: 'openRouterImage', models: [{ model: 'img-a', health: 'available' }] },
          ],
        },
      ])
    );
    mocks.bridge.listConnections.invoke.mockResolvedValue(
      ok({
        integrations: [{ integrationId: 'int_img', kind: 'image', labelKey: 'openRouterImage' }],
        connections: [],
      })
    );
    // Empty first, so provisioning fires; populated afterwards, as it would be once a model binds.
    mocks.bridge.listRoutes.invoke
      .mockResolvedValueOnce(
        ok({
          image: { status: 'ready', selected: null, selectedRoute: null, selectionIssue: null, options: [] },
          video: { status: 'ready', selected: null, selectedRoute: null, selectionIssue: null, options: [] },
          catalogVersion: 'catalog_1',
        })
      )
      .mockResolvedValue(
        ok({
          image: {
            status: 'ready',
            selected: null,
            selectedRoute: null,
            selectionIssue: null,
            options: [
              { choiceId: 'img_1', kind: 'image', health: 'available', constraints: { supportsFirstFrame: false } },
            ],
          },
          video: { status: 'ready', selected: null, selectedRoute: null, selectionIssue: null, options: [] },
          catalogVersion: 'catalog_2',
        })
      );
    mocks.bridge.getGenerationCapability.invoke
      .mockImplementationOnce(
        async (input: { projectId: string; expectedRevision: number; items: StudioGenerationCapabilityItemV2[] }) =>
          supportedCapabilityResult(input, 'catalog_1')
      )
      .mockImplementation(
        async (input: { projectId: string; expectedRevision: number; items: StudioGenerationCapabilityItemV2[] }) =>
          supportedCapabilityResult(input, 'catalog_2')
      );
    renderStudio();

    await waitFor(() => expect(mocks.bridge.saveConnection.invoke).toHaveBeenCalled());
    // One read for the workspace's own catalogue, one inside provisioning, and one refresh after it.
    await waitFor(() => expect(mocks.bridge.listRoutes.invoke.mock.calls.length).toBeGreaterThanOrEqual(3));
    expect(mocks.bridge.getGenerationCapability.invoke.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('writes nothing until the Director has attached, so the bind is not invalidated', async () => {
    // The Director's bind carries an expected revision. A set_routes landing in between fails it as
    // "the project changed elsewhere" and the rail reports Director setup as interrupted — which is
    // exactly what shipping this convenience without the guard did.
    mocks.bridge.getProject.invoke.mockResolvedValue(
      ok({ status: 'supported', project: { ...project(), briefConversationId: null } })
    );
    mocks.bridge.listRoutes.invoke.mockResolvedValue(
      ok({
        image: {
          status: 'ready',
          selected: null,
          selectedRoute: null,
          selectionIssue: null,
          options: [
            { choiceId: 'img_1', kind: 'image', health: 'available', constraints: { supportsFirstFrame: false } },
          ],
        },
        video: { status: 'ready', selected: null, selectedRoute: null, selectionIssue: null, options: [] },
        catalogVersion: 'catalog_1',
      })
    );
    renderStudio();

    await waitFor(() => expect(mocks.bridge.listRoutes.invoke).toHaveBeenCalled());
    expect(mocks.bridge.applyAuthoringBatch.invoke).not.toHaveBeenCalled();
    expect(mocks.bridge.saveConnection.invoke).not.toHaveBeenCalled();
  });

  it('binds a Studio media model when none exists, so the catalogue stops being empty', async () => {
    mocks.bridge.getProject.invoke.mockResolvedValue(ok({ status: 'supported', project: attachedProject() }));
    // A route needs a connection binding, not just a configured provider. Without one the catalogue
    // is empty, the project has nothing to bind, and the only way through is a visit to Settings.
    mocks.bridge.listConnectionCandidates.invoke.mockResolvedValue(
      ok([
        {
          providerId: 'p1',
          providerName: 'OpenRouter',
          models: [],
          integrationModels: [
            { integrationLabelKey: 'openRouterImage', models: [{ model: 'img-a', health: 'available' }] },
          ],
        },
      ])
    );
    mocks.bridge.listConnections.invoke.mockResolvedValue(
      ok({
        integrations: [{ integrationId: 'int_img', kind: 'image', labelKey: 'openRouterImage' }],
        connections: [],
      })
    );
    mocks.bridge.listRoutes.invoke.mockResolvedValue(
      ok({
        image: {
          status: 'ready',
          selected: null,
          selectedRoute: null,
          selectionIssue: null,
          options: [
            { choiceId: 'img_1', kind: 'image', health: 'available', constraints: { supportsFirstFrame: false } },
          ],
        },
        video: { status: 'ready', selected: null, selectedRoute: null, selectionIssue: null, options: [] },
        catalogVersion: 'catalog_2',
      })
    );
    mocks.bridge.listRoutes.invoke.mockResolvedValueOnce(
      ok({
        image: { status: 'ready', selected: null, selectedRoute: null, selectionIssue: null, options: [] },
        video: { status: 'ready', selected: null, selectedRoute: null, selectionIssue: null, options: [] },
        catalogVersion: 'catalog_1',
      })
    );
    mocks.bridge.getGenerationCapability.invoke
      .mockImplementationOnce(
        async (input: { projectId: string; expectedRevision: number; items: StudioGenerationCapabilityItemV2[] }) =>
          supportedCapabilityResult(input, 'catalog_1')
      )
      .mockImplementation(
        async (input: { projectId: string; expectedRevision: number; items: StudioGenerationCapabilityItemV2[] }) =>
          supportedCapabilityResult(input, 'catalog_2')
      );
    renderStudio();

    await waitFor(() =>
      expect(mocks.bridge.saveConnection.invoke).toHaveBeenCalledWith({
        providerId: 'p1',
        integrationId: 'int_img',
        model: 'img-a',
      })
    );
  });

  it('never reconsiders a connection someone already chose', async () => {
    mocks.bridge.getProject.invoke.mockResolvedValue(ok({ status: 'supported', project: attachedProject() }));
    mocks.bridge.listConnectionCandidates.invoke.mockResolvedValue(
      ok([
        {
          providerId: 'p1',
          providerName: 'OpenRouter',
          models: [],
          integrationModels: [
            { integrationLabelKey: 'openRouterImage', models: [{ model: 'img-a', health: 'available' }] },
          ],
        },
      ])
    );
    mocks.bridge.listConnections.invoke.mockResolvedValue(
      ok({
        integrations: [{ integrationId: 'int_img', kind: 'image', labelKey: 'openRouterImage' }],
        connections: [{ integrationId: 'int_img' }],
      })
    );
    renderStudio();

    await waitFor(() => expect(mocks.bridge.listConnections.invoke).toHaveBeenCalled());
    expect(mocks.bridge.saveConnection.invoke).not.toHaveBeenCalled();
  });

  it('binds a route of each kind on a project that has none, so Render is reachable', async () => {
    mocks.bridge.getProject.invoke.mockResolvedValue(ok({ status: 'supported', project: attachedProject() }));
    // Projects are created with both ids null. Without this a finished script meets a Render button
    // that does nothing until the user finds the Brief form.
    mocks.bridge.listRoutes.invoke.mockResolvedValue(
      ok({
        image: {
          status: 'ready',
          selected: null,
          selectedRoute: null,
          selectionIssue: null,
          options: [
            { choiceId: 'img_1', kind: 'image', health: 'available', constraints: { supportsFirstFrame: false } },
          ],
        },
        video: {
          status: 'ready',
          selected: null,
          selectedRoute: null,
          selectionIssue: null,
          options: [
            { choiceId: 'vid_plain', kind: 'video', health: 'available', constraints: { supportsFirstFrame: false } },
            { choiceId: 'vid_chain', kind: 'video', health: 'available', constraints: { supportsFirstFrame: true } },
          ],
        },
        catalogVersion: 'catalog_1',
      })
    );
    renderStudio();

    await waitFor(() => expect(mocks.bridge.applyAuthoringBatch.invoke).toHaveBeenCalled());
    const batch = mocks.bridge.applyAuthoringBatch.invoke.mock.calls[0][0];
    // The chaining route wins even though the plain one comes first: shots condition on the previous
    // shot's last frame, and a route without that produces a film with no continuity rather than an
    // error.
    expect(batch.operations).toEqual([{ kind: 'set_routes', imageRouteId: 'img_1', videoRouteId: 'vid_chain' }]);
  });

  it('leaves a project that already has a route alone', async () => {
    mocks.bridge.getProject.invoke.mockResolvedValue(
      ok({ status: 'supported', project: { ...attachedProject(), imageRouteId: 'chosen_by_hand' } })
    );
    mocks.bridge.listRoutes.invoke.mockResolvedValue(
      ok({
        image: {
          status: 'ready',
          selected: null,
          selectedRoute: null,
          selectionIssue: null,
          options: [
            { choiceId: 'img_1', kind: 'image', health: 'available', constraints: { supportsFirstFrame: false } },
          ],
        },
        video: { status: 'ready', selected: null, selectedRoute: null, selectionIssue: null, options: [] },
        catalogVersion: 'catalog_1',
      })
    );
    renderStudio();

    await waitFor(() => expect(mocks.bridge.listRoutes.invoke).toHaveBeenCalled());
    expect(mocks.bridge.applyAuthoringBatch.invoke).not.toHaveBeenCalled();
  });

  it('canonicalizes a retired route and keeps the shared Table, Board, and Cut views', async () => {
    renderStudio('/studio/project_1/write');

    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/studio/project_1/table'));
    expect(screen.getByRole('link', { name: 'conversation.creativeStudio.workspace.views.references' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'conversation.creativeStudio.workspace.views.table' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'conversation.creativeStudio.workspace.views.board' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'conversation.creativeStudio.workspace.views.cut' })).toBeVisible();
  });

  it('opens first-time Director-defined reference work before the Table', async () => {
    mockSupportedProject(projectWithReferenceHandoff());

    renderStudio('/studio/project_1');

    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/studio/project_1/references'));
    expect(
      screen.getByRole('heading', { name: 'conversation.creativeStudio.workspace.views.references' })
    ).toBeVisible();
  });

  it('keeps a new empty project view-less until its first Director reference plan arrives', async () => {
    renderStudio('/studio/project_1');

    await screen.findByRole('heading', { name: 'Launch film' });
    expect(screen.getByTestId('location')).toHaveTextContent('/studio/project_1');
    expect(screen.getByTestId('location')).not.toHaveTextContent('/studio/project_1/table');
    expect(screen.getByRole('heading', { name: 'conversation.creativeStudio.workspace.views.table' })).toBeVisible();

    const updated = projectWithReferenceHandoff();
    updated.revision = 4;
    mockSupportedProject(updated);
    act(() => mocks.listeners.projectUpdated?.({ projectId: 'project_1' }));

    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/studio/project_1/references'));
    expect(
      screen.getByRole('heading', { name: 'conversation.creativeStudio.workspace.views.references' })
    ).toBeVisible();
  });

  it('does not steal navigation when reference work arrives after an explicit Table entry', async () => {
    renderStudio('/studio/project_1/table');
    await screen.findByRole('heading', { name: 'Launch film' });
    const updated = projectWithReferenceHandoff();
    updated.revision = 4;
    mockSupportedProject(updated);

    act(() => mocks.listeners.projectUpdated?.({ projectId: 'project_1' }));

    await waitFor(() => expect(mocks.bridge.getProjectWorkspace.invoke).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId('location')).toHaveTextContent('/studio/project_1/table');
    expect(screen.getByRole('heading', { name: 'conversation.creativeStudio.workspace.views.table' })).toBeVisible();
  });

  it('keeps an empty, coherent reference plan navigable with completion disabled until references are current', async () => {
    renderStudio('/studio/project_1/references');

    await screen.findByRole('heading', { name: 'conversation.creativeStudio.workspace.views.references' });
    expect(
      screen.getByRole('button', {
        name: 'conversation.creativeStudio.workspace.referenceWorkflow.panel.bindShots',
      })
    ).toBeDisabled();
    fireEvent.click(screen.getByRole('link', { name: 'conversation.creativeStudio.workspace.views.table' }));

    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/studio/project_1/table'));
  });

  it('hands a complete References panel to the per-Shot Table binding flow without writing a binding', async () => {
    mockSupportedProject(projectWithCandidateReference());
    renderStudio('/studio/project_1/references');

    fireEvent.click(
      await screen.findByRole('button', {
        name: 'conversation.creativeStudio.workspace.referenceWorkflow.panel.bindShots',
      })
    );

    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/studio/project_1/table'));
    expect(mocks.bridge.applyAuthoringBatch.invoke).not.toHaveBeenCalled();
  });

  it('adds a background from References through the shared typed amendment operation', async () => {
    const authority = projectWithReferenceHandoff();
    authority.references.reference_3!.approvedAssetId = 'asset_reference_3';
    mockSupportedProject(authority);
    renderStudio('/studio/project_1/references');

    fireEvent.click(
      await screen.findByRole('button', {
        name: 'conversation.creativeStudio.workspace.referenceWorkflow.panel.addPlace',
      })
    );
    fireEvent.change(
      screen.getByLabelText('conversation.creativeStudio.workspace.referenceWorkflow.backgrounds.nameLabel'),
      { target: { value: 'Dai pai dong' } }
    );
    fireEvent.change(
      screen.getByLabelText('conversation.creativeStudio.workspace.referenceWorkflow.backgrounds.promptLabel'),
      { target: { value: 'A compact food stall beneath a red awning.' } }
    );

    const amended = structuredClone(authority);
    amended.revision = 4;
    amended.referenceOrder.push('reference_background');
    amended.references.reference_background = {
      id: 'reference_background',
      kind: 'background',
      label: 'Dai pai dong',
      prompt: 'A compact food stall beneath a red awning.',
      approvedAssetId: null,
      supersededAssetIds: [],
      jobIds: [],
      createdAt: '2026-01-01T00:00:01.000Z',
      updatedAt: '2026-01-01T00:00:01.000Z',
    };
    mocks.bridge.applyAuthoringBatch.invoke.mockResolvedValue(commit(4));
    mockSupportedProject(amended);

    fireEvent.click(
      screen.getByRole('button', {
        name: 'conversation.creativeStudio.workspace.referenceWorkflow.backgrounds.confirm',
      })
    );

    await waitFor(() =>
      expect(mocks.bridge.applyAuthoringBatch.invoke).toHaveBeenCalledExactlyOnceWith({
        projectId: 'project_1',
        expectedRevision: 3,
        operations: [
          {
            kind: 'amend_reference_plan',
            additions: [
              {
                kind: 'background',
                label: 'Dai pai dong',
                prompt: 'A compact food stall beneath a red awning.',
              },
            ],
          },
        ],
      })
    );
    expect(await screen.findByDisplayValue('Dai pai dong')).toBeVisible();
    expect(screen.getAllByDisplayValue('Hero')).not.toHaveLength(0);
    expect(amended.shots.shot_3!.referenceBinding).toEqual(authority.shots.shot_3!.referenceBinding);
  });

  it('keeps a refused background amendment open and leaves project authority unchanged', async () => {
    const authority = projectWithReferenceHandoff();
    authority.references.reference_3!.approvedAssetId = 'asset_reference_3';
    mockSupportedProject(authority);
    mocks.bridge.applyAuthoringBatch.invoke.mockResolvedValueOnce({
      ok: false,
      error: { code: 'stale_revision', messageKey: 'native.amendReferencePlanFailed' },
    });
    renderStudio('/studio/project_1/references');
    await screen.findAllByDisplayValue('Hero');
    const references = capturedReferenceActions();

    await expect(
      invokeStudioAction(() =>
        references.addBackground({ label: 'Dai pai dong', prompt: 'A compact food stall beneath a red awning.' })
      )
    ).resolves.toBe(false);

    expect(mocks.bridge.applyAuthoringBatch.invoke).toHaveBeenCalledExactlyOnceWith({
      projectId: 'project_1',
      expectedRevision: 3,
      operations: [
        {
          kind: 'amend_reference_plan',
          additions: [
            {
              kind: 'background',
              label: 'Dai pai dong',
              prompt: 'A compact food stall beneath a red awning.',
            },
          ],
        },
      ],
    });
    expect(await screen.findByText('native.amendReferencePlanFailed')).toBeVisible();
    expect(mocks.bridge.getProjectWorkspace.invoke).toHaveBeenCalledTimes(1);
    expect(authority.referenceOrder).toEqual(['reference_3']);
  });

  it('rejects malformed reference prompt inputs before any mutation or spend review', async () => {
    const authority = projectWithCandidateReference();
    mockSupportedProject(authority);
    renderStudio('/studio/project_1/references');
    await screen.findByRole('heading', { name: 'conversation.creativeStudio.workspace.views.references' });
    const references = capturedReferenceActions();

    await expect(
      references.addBackground({ label: 'Dai pai dong', prompt: undefined as unknown as string })
    ).resolves.toBe(false);
    await expect(references.regenerate('reference_3', undefined as unknown as string)).resolves.toBe(false);

    expect(mocks.bridge.applyAuthoringBatch.invoke).not.toHaveBeenCalled();
    expect(screen.queryByTestId('studio-spend-gate')).toBeNull();
  });

  it('selects an exact historical reference image and installs the committed revision', async () => {
    const candidate = projectWithCandidateReference();
    mockSupportedProject(candidate);
    renderStudio('/studio/project_1/references');
    const choose = (
      await screen.findAllByRole('button', {
        name: /conversation\.creativeStudio\.workspace\.referenceWorkflow\.panel\.choosePhoto/u,
      })
    ).find((button) => !button.hasAttribute('disabled'));
    expect(choose).toBeDefined();
    const approved = structuredClone(candidate);
    approved.revision = 4;
    approved.references.reference_3!.approvedAssetId = 'asset_reference_3_old';
    approved.references.reference_3!.supersededAssetIds = ['asset_reference_3'];
    mocks.bridge.applyAuthoringBatch.invoke.mockResolvedValue(commit(4));
    mockSupportedProject(approved);

    fireEvent.click(choose!);

    await waitFor(() =>
      expect(mocks.bridge.applyAuthoringBatch.invoke).toHaveBeenCalledExactlyOnceWith({
        projectId: 'project_1',
        expectedRevision: 3,
        operations: [
          {
            kind: 'select_reference_image',
            referenceId: 'reference_3',
            assetId: 'asset_reference_3_old',
          },
        ],
      })
    );
    expect(
      await screen.findByText('conversation.creativeStudio.workspace.referenceWorkflow.panel.status.current')
    ).toBeVisible();
  });

  it('fails closed across missing, refused, malformed, and stale reference selections', async () => {
    const authority = projectWithCandidateReference();
    const missingReferenceRefresh = structuredClone(authority);
    missingReferenceRefresh.revision = 4;
    missingReferenceRefresh.referenceOrder = [];
    missingReferenceRefresh.references = {};
    mocks.bridge.getProjectWorkspace.invoke
      .mockResolvedValueOnce(projectWorkspaceLoad(authority))
      .mockResolvedValue(projectWorkspaceLoad(missingReferenceRefresh));
    mocks.bridge.applyAuthoringBatch.invoke
      .mockResolvedValueOnce({ ok: false, error: { code: 'stale_revision', messageKey: 'native.approveFailed' } })
      .mockResolvedValueOnce(commit(9))
      .mockResolvedValueOnce(commit(4));

    renderStudio('/studio/project_1/references');
    await screen.findByRole('heading', { name: 'conversation.creativeStudio.workspace.views.references' });
    const references = capturedReferenceActions();

    await expect(
      invokeStudioAction(() => references.selectImage('missing_reference', 'asset_reference_3_old'))
    ).resolves.toBe(false);
    await expect(
      invokeStudioAction(() => references.selectImage('reference_3', 'asset_reference_3_old'))
    ).resolves.toBe(false);
    expect(await screen.findByText('native.approveFailed')).toBeVisible();
    await expect(
      invokeStudioAction(() => references.selectImage('reference_3', 'asset_reference_3_old'))
    ).resolves.toBe(false);
    await expect(
      invokeStudioAction(() => references.selectImage('reference_3', 'asset_reference_3_old'))
    ).resolves.toBe(false);
    expect(mocks.bridge.applyAuthoringBatch.invoke).toHaveBeenCalledTimes(2);
  });

  it('serializes Cut and reference commands behind one workspace authority lock', async () => {
    const authority = projectWithCandidateReference();
    mockSupportedProject(authority);
    const leader = deferred<ReturnType<typeof ok>>();
    mocks.bridge.importBedAudio.invoke.mockReturnValueOnce(leader.promise);
    renderStudio('/studio/project_1/cut');
    await screen.findByRole('heading', { name: 'Launch film' });
    await waitFor(() => expect(mocks.cutActions).not.toBeNull());
    const cut = capturedCutActions();
    const projectMenu = capturedProjectMenuProps();
    const references = capturedReferenceActions();

    let pendingImport!: Promise<'cancelled' | 'imported' | 'failed'>;
    act(() => {
      pendingImport = cut.importBedAudio();
    });
    await waitFor(() => expect(mocks.bridge.importBedAudio.invoke).toHaveBeenCalledTimes(1));

    await expect(cut.importBedAudio()).resolves.toBe('failed');
    await expect(cut.detachBedAudio('audio_other')).resolves.toBe(false);
    await expect(projectMenu.createEditorFolder()).resolves.toEqual({
      ok: false,
      messageKey: 'conversation.creativeStudio.workspace.editorFolderExport.errors.busy',
    });
    await expect(projectMenu.revealEditorFolder('missing_export')).resolves.toEqual({
      ok: false,
      messageKey: 'conversation.creativeStudio.workspace.editorFolderExport.errors.busy',
    });
    await expect(references.selectImage('reference_3', 'asset_reference_3_old')).resolves.toBe(false);
    await act(async () => {
      await references.regenerate('reference_3', 'Stable character sheet for the hero');
    });

    expect(mocks.bridge.detachBedAudio.invoke).not.toHaveBeenCalled();
    expect(mocks.bridge.createExport.invoke).not.toHaveBeenCalled();
    expect(mocks.bridge.copyExport.invoke).not.toHaveBeenCalled();
    expect(mocks.bridge.revealExport.invoke).not.toHaveBeenCalled();
    expect(mocks.bridge.applyAuthoringBatch.invoke).not.toHaveBeenCalled();
    expect(screen.queryByTestId('studio-spend-gate')).toBeNull();

    await act(async () => {
      leader.resolve(ok({ status: 'cancelled' as const }));
      await expect(pendingImport).resolves.toBe('cancelled');
    });
  });

  it('opens and prepares regeneration only through the dedicated project-reference seam', async () => {
    const authority = projectWithCandidateReference();
    mockSupportedProject(authority);
    mocks.bridge.prepareProjectReferences.invoke.mockRejectedValueOnce(new Error('stop after exact capture'));
    renderStudio('/studio/project_1/references');

    fireEvent.click(
      await screen.findByRole('button', {
        name: 'conversation.creativeStudio.workspace.referenceWorkflow.panel.action.generateAnother',
      })
    );
    const modal = await screen.findByTestId('studio-spend-gate');
    expect(modal).toHaveAttribute('data-gate-kind', 'project_references');

    await waitFor(() =>
      expect(mocks.bridge.prepareProjectReferences.invoke).toHaveBeenCalledExactlyOnceWith({
        projectId: 'project_1',
        expectedRevision: 3,
        referenceIds: ['reference_3'],
      })
    );
    expect(mocks.bridge.prepareSubmission.invoke).not.toHaveBeenCalled();
  });

  it('persists an edited reference prompt before opening review at the committed revision', async () => {
    const authority = projectWithCandidateReference();
    const updated = structuredClone(authority);
    updated.revision = 4;
    updated.updatedAt = '2026-01-01T00:00:01.000Z';
    updated.references.reference_3!.prompt = 'Hero character sheet with a blue rain jacket';
    updated.references.reference_3!.updatedAt = updated.updatedAt;
    mocks.bridge.getProjectWorkspace.invoke
      .mockResolvedValueOnce(projectWorkspaceLoad(authority))
      .mockResolvedValue(projectWorkspaceLoad(updated));
    mocks.bridge.applyAuthoringBatch.invoke.mockResolvedValue(commit(4));
    renderStudio('/studio/project_1/references');
    await screen.findByRole('heading', { name: 'conversation.creativeStudio.workspace.views.references' });

    await expect(
      invokeStudioAction(() =>
        capturedReferenceActions().regenerate('reference_3', '  Hero character sheet with a blue rain jacket  ')
      )
    ).resolves.toBe(true);

    expect(mocks.bridge.applyAuthoringBatch.invoke).toHaveBeenCalledExactlyOnceWith({
      projectId: 'project_1',
      expectedRevision: 3,
      operations: [
        {
          kind: 'set_reference_prompt',
          referenceId: 'reference_3',
          prompt: 'Hero character sheet with a blue rain jacket',
        },
      ],
    });
    expect(await screen.findByTestId('studio-spend-gate')).toBeVisible();
    await waitFor(() =>
      expect(mocks.bridge.prepareProjectReferences.invoke).toHaveBeenCalledWith({
        projectId: 'project_1',
        expectedRevision: 4,
        referenceIds: ['reference_3'],
      })
    );
  });

  it('saves an inline reference name and prompt in one renderer-only typed batch', async () => {
    const authority = projectWithCandidateReference();
    const updated = structuredClone(authority);
    updated.revision = 4;
    updated.updatedAt = '2026-01-01T00:00:01.000Z';
    updated.references.reference_3!.label = 'Hero Wong';
    updated.references.reference_3!.prompt = 'Hero character sheet with a blue rain jacket';
    updated.references.reference_3!.updatedAt = updated.updatedAt;
    mocks.bridge.getProjectWorkspace.invoke
      .mockResolvedValueOnce(projectWorkspaceLoad(authority))
      .mockResolvedValue(projectWorkspaceLoad(updated));
    mocks.bridge.applyAuthoringBatch.invoke.mockResolvedValue(commit(4));
    renderStudio('/studio/project_1/references');
    await screen.findByRole('heading', { name: 'conversation.creativeStudio.workspace.views.references' });

    await expect(
      invokeStudioAction(() =>
        capturedReferenceActions().updateDetails('reference_3', {
          label: '  Hero Wong  ',
          prompt: '  Hero character sheet with a blue rain jacket  ',
        })
      )
    ).resolves.toBe(true);

    expect(mocks.bridge.applyAuthoringBatch.invoke).toHaveBeenCalledExactlyOnceWith({
      projectId: 'project_1',
      expectedRevision: 3,
      operations: [
        { kind: 'set_reference_label', referenceId: 'reference_3', label: 'Hero Wong' },
        {
          kind: 'set_reference_prompt',
          referenceId: 'reference_3',
          prompt: 'Hero character sheet with a blue rain jacket',
        },
      ],
    });
    expect(updated.references.reference_3!.approvedAssetId).toBe(authority.references.reference_3!.approvedAssetId);
    expect(updated.shots.shot_3!.referenceBinding).toEqual(authority.shots.shot_3!.referenceBinding);
  });

  it('discloses and blocks an exact project-reference request outside Main route capability', async () => {
    const authority = projectWithCandidateReference();
    mockSupportedProject(authority);
    mocks.bridge.listRoutes.invoke.mockResolvedValue(
      ok({
        image: {
          status: 'unavailable',
          selected: null,
          selectedRoute: null,
          selectionIssue: { code: 'health' },
          options: [],
        },
        video: { status: 'ready', selected: null, selectedRoute: null, selectionIssue: null, options: [] },
        catalogVersion: 'catalog_1',
      })
    );
    mockGenerationBlock(
      { target: { kind: 'reference', referenceId: 'reference_3' }, purpose: 'reference_image' },
      { code: 'duration', role: 'image', seconds: 4 }
    );
    renderStudio('/studio/project_1/references');

    fireEvent.click(
      await screen.findByRole('button', {
        name: 'conversation.creativeStudio.workspace.referenceWorkflow.panel.action.generateAnother',
      })
    );
    const modal = await screen.findByTestId('studio-spend-gate');
    expect(modal.querySelector('[data-generation-block-code="duration"]')).toBeVisible();
    expect(
      within(modal).queryByRole('button', { name: 'conversation.creativeStudio.workspace.gate.prepare' })
    ).toBeNull();
    expect(mocks.bridge.prepareProjectReferences.invoke).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: 'an existing request',
      messageKey: 'conversation.creativeStudio.workspace.gate.errors.pricing.inFlight',
      configure: (_authority: StudioRendererProjectV2) => {
        mocks.bridge.listReferenceRequests.invoke.mockResolvedValue(
          ok([{ ...referenceRequest(), referenceIds: ['reference_3'] }])
        );
      },
    },
    {
      label: 'unsaved generative drafts',
      messageKey: 'conversation.creativeStudio.workspace.controls.saveBeforeReview',
      configure: (_authority: StudioRendererProjectV2) => {
        seedWorkspaceDrafts({
          'brief.text': { baseValue: 'A small launch film.', value: 'Unsaved reference direction.' },
        });
      },
    },
    {
      label: 'an unavailable route catalog',
      messageKey: 'conversation.creativeStudio.workspace.controls.routeCatalogRequired',
      configure: (_authority: StudioRendererProjectV2) => {
        mocks.bridge.listRoutes.invoke.mockResolvedValue({
          ok: false,
          error: { code: 'storage_error', messageKey: 'native.routesFailed' },
        });
      },
    },
    {
      label: 'an unapproved character before a background',
      messageKey: 'conversation.creativeStudio.workspace.referenceWorkflow.backgrounds.charactersRequired',
      configure: (authority: StudioRendererProjectV2) => {
        authority.references.reference_3!.kind = 'background';
        authority.references.reference_character = {
          id: 'reference_character',
          kind: 'character',
          label: 'Ming',
          prompt: 'Ming in a red rain jacket.',
          approvedAssetId: null,
          supersededAssetIds: [],
          jobIds: [],
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        };
        authority.referenceOrder = ['reference_character', 'reference_3'];
      },
    },
  ])('blocks reference regeneration behind $label', async ({ messageKey, configure }) => {
    const authority = projectWithCandidateReference();
    configure(authority);
    mockSupportedProject(authority);
    renderStudio('/studio/project_1/references');
    await screen.findByRole('heading', { name: 'conversation.creativeStudio.workspace.views.references' });
    await waitFor(() => expect(mocks.bridge.listReferenceRequests.invoke).toHaveBeenCalled());

    await act(async () => {
      await capturedReferenceActions().regenerate('reference_3', 'Stable character sheet for the hero');
    });

    expect((await screen.findAllByText(messageKey)).length).toBeGreaterThan(0);
    expect(screen.queryByTestId('studio-spend-gate')).toBeNull();
    expect(mocks.bridge.prepareProjectReferences.invoke).not.toHaveBeenCalled();
  });

  it('discloses Main authority when an unbound image route blocks reference regeneration', async () => {
    const authority = projectWithCandidateReference();
    authority.imageRouteId = null;
    mockSupportedProject(authority);
    mockGenerationBlock(
      { target: { kind: 'reference', referenceId: 'reference_3' }, purpose: 'reference_image' },
      { code: 'no_engine', role: 'image' }
    );
    renderStudio('/studio/project_1/references');
    await screen.findByRole('heading', { name: 'conversation.creativeStudio.workspace.views.references' });

    await act(async () => {
      await capturedReferenceActions().regenerate('reference_3', 'Stable character sheet for the hero');
    });

    const modal = await screen.findByTestId('studio-spend-gate');
    expect(modal.querySelector('[data-generation-block-code="no_engine"]')).toBeVisible();
    expect(
      within(modal).queryByRole('button', { name: 'conversation.creativeStudio.workspace.gate.prepare' })
    ).toBeNull();
    expect(mocks.bridge.prepareProjectReferences.invoke).not.toHaveBeenCalled();
  });

  it('recovers only the exact current reference candidate job and refreshes durable handoffs', async () => {
    const authority = projectWithReferenceCandidateJob();
    const recovered = structuredClone(authority);
    recovered.revision = 4;
    recovered.jobs.job_reference_3!.status = 'queued_local';
    recovered.jobs.job_reference_3!.error = null;
    recovered.jobs.job_reference_3!.canRetry = false;
    mocks.bridge.getProjectWorkspace.invoke
      .mockResolvedValueOnce(projectWorkspaceLoad(authority))
      .mockResolvedValue(projectWorkspaceLoad(recovered));
    mocks.bridge.retryJob.invoke.mockResolvedValue(ok(recovered.jobs.job_reference_3!));

    renderStudio('/studio/project_1/references');
    await screen.findByRole('button', { name: 'conversation.creativeStudio.jobs.retry' });
    expect(await capturedReferenceActions().retryJob('reference_3', 'job_not_current', false)).toBe(false);
    expect(mocks.bridge.retryJob.invoke).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'conversation.creativeStudio.jobs.retry' }));

    await waitFor(() =>
      expect(mocks.bridge.retryJob.invoke).toHaveBeenCalledExactlyOnceWith({
        projectId: 'project_1',
        jobId: 'job_reference_3',
        expectedRevision: 3,
        acknowledgePossibleDuplicateCharge: false,
      })
    );
    await waitFor(() => expect(mocks.bridge.listReferenceGenerationHandoffs.invoke).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('button', { name: 'conversation.creativeStudio.jobs.retry' })).toBeNull();
    expect(
      screen.getByText('conversation.creativeStudio.workspace.referenceWorkflow.panel.status.generating')
    ).toBeVisible();
  });

  it('rejects refused, mismatched, stale, and missing reference-job recovery authority', async () => {
    const authority = projectWithReferenceCandidateJob();
    const missingJob = structuredClone(authority);
    missingJob.revision = 4;
    missingJob.references.reference_3!.jobIds = [];
    missingJob.jobs = {};
    const exactJob = authority.jobs.job_reference_3!;
    mocks.bridge.getProjectWorkspace.invoke
      .mockResolvedValueOnce(projectWorkspaceLoad(authority))
      .mockResolvedValueOnce(projectWorkspaceLoad(authority))
      .mockResolvedValue(projectWorkspaceLoad(missingJob));
    mocks.bridge.retryJob.invoke
      .mockResolvedValueOnce({ ok: false, error: { code: 'storage_error', messageKey: 'native.retryFailed' } })
      .mockResolvedValueOnce(ok({ ...exactJob, target: { kind: 'reference', referenceId: 'reference_other' } }))
      .mockResolvedValueOnce(ok(exactJob))
      .mockResolvedValueOnce(ok(exactJob));

    renderStudio('/studio/project_1/references');
    await screen.findByRole('button', { name: 'conversation.creativeStudio.jobs.retry' });
    const references = capturedReferenceActions();

    await expect(invokeStudioAction(() => references.retryJob('reference_3', 'job_reference_3', false))).resolves.toBe(
      false
    );
    await expect(invokeStudioAction(() => references.retryJob('reference_3', 'job_reference_3', false))).resolves.toBe(
      false
    );
    await expect(invokeStudioAction(() => references.retryJob('reference_3', 'job_reference_3', false))).resolves.toBe(
      false
    );
    await expect(invokeStudioAction(() => references.retryJob('reference_3', 'job_reference_3', false))).resolves.toBe(
      false
    );
    expect(mocks.bridge.retryJob.invoke).toHaveBeenCalledTimes(4);
    expect(mocks.bridge.listReferenceGenerationHandoffs.invoke).toHaveBeenCalledTimes(1);
  });

  it.each([
    { label: 'cancelled', status: 'cancelled' as const, error: null },
    {
      label: 'poll deadline',
      status: 'failed' as const,
      error: {
        code: 'poll_deadline' as const,
        messageKey: 'conversation.creativeStudio.jobs.errors.pollDeadline',
      },
    },
  ])('keeps $label project-reference failures eligible for the paid handoff retry', async ({ status, error }) => {
    const authority = projectWithReferenceCandidateJob({
      status,
      error,
      canCancel: false,
      canRetry: false,
      canRetryDownload: false,
    });
    mockSupportedProject(authority);
    mocks.bridge.listReferenceGenerationHandoffs.invoke.mockResolvedValue(
      ok([
        {
          ...handoff('failed'),
        },
      ])
    );

    renderStudio('/studio/project_1/references');
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'conversation.creativeStudio.workspace.handoffs.retryFailed',
      })
    );

    const modal = await screen.findByTestId('studio-spend-gate');
    expect(modal).toHaveAttribute('data-gate-kind', 'project_references');
    await waitFor(() =>
      expect(mocks.bridge.prepareProjectReferences.invoke).toHaveBeenCalledExactlyOnceWith({
        projectId: 'project_1',
        expectedRevision: 3,
        referenceIds: ['reference_3'],
      })
    );
  });

  it.each([
    {
      label: 'attention',
      status: 'needs_attention' as const,
      error: {
        code: 'provider_unavailable' as const,
        messageKey: 'conversation.creativeStudio.jobs.errors.providerUnavailable',
      },
      canRetryDownload: false,
    },
    {
      label: 'download failure',
      status: 'failed' as const,
      error: {
        code: 'download_failed' as const,
        messageKey: 'conversation.creativeStudio.jobs.errors.downloadFailed',
      },
      canRetryDownload: true,
    },
    {
      label: 'dependency failure',
      status: 'failed' as const,
      error: {
        code: 'dependency_failed' as const,
        messageKey: 'conversation.creativeStudio.jobs.errors.dependencyFailed',
      },
      canRetryDownload: false,
    },
  ])(
    'rejects a stale handoff retry claim for an exact $label candidate',
    async ({ status, error, canRetryDownload }) => {
      const authority = projectWithReferenceCandidateJob({
        status,
        error,
        canCancel: false,
        canRetry: status === 'needs_attention',
        canRetryDownload,
      });
      mockSupportedProject(authority);
      mocks.bridge.listReferenceGenerationHandoffs.invoke.mockResolvedValue(
        ok([
          {
            ...handoff('failed'),
          },
        ])
      );

      renderStudio('/studio/project_1/references');
      fireEvent.click(
        await screen.findByRole('button', {
          name: 'conversation.creativeStudio.workspace.handoffs.retryFailed',
        })
      );

      expect(
        await screen.findByText('conversation.creativeStudio.workspace.controls.selectionNotPayable')
      ).toBeVisible();
      expect(screen.queryByTestId('studio-spend-gate')).toBeNull();
      expect(mocks.bridge.prepareProjectReferences.invoke).not.toHaveBeenCalled();
    }
  );

  it('explains when the app-bar Render action has no payable Shot', async () => {
    renderStudio();
    await screen.findByRole('heading', { name: 'Launch film' });

    fireEvent.click(screen.getByRole('button', { name: 'conversation.creativeStudio.workspace.controls.renderFilm' }));

    expect(await screen.findByText('conversation.creativeStudio.workspace.controls.renderFilmEmpty')).toBeVisible();
    expect(mocks.bridge.prepareSubmission.invoke).not.toHaveBeenCalled();
  });

  it('blocks the app-bar Render action while visible generation drafts are unsaved', async () => {
    const authority = projectWithGenerationReferences(1, { assignedBackgroundShotIds: ['shot_0'] });
    mockSupportedProject(authority);
    seedWorkspaceDrafts({
      'brief.text': { baseValue: authority.brief, value: 'Visible but unsaved generation direction.' },
    });
    renderStudio();
    await screen.findByRole('heading', { name: 'Launch film' });

    fireEvent.click(screen.getByRole('button', { name: 'conversation.creativeStudio.workspace.controls.renderFilm' }));

    expect(await screen.findByText('conversation.creativeStudio.workspace.controls.saveBeforeReview')).toBeVisible();
    expect(screen.queryByTestId('studio-spend-gate')).toBeNull();
    expect(mocks.bridge.prepareSubmission.invoke).not.toHaveBeenCalled();
  });

  it('opens one automatically estimated spend gate from the app-bar Render action without spending', async () => {
    const authority = projectWithGenerationReferences(1, { assignedBackgroundShotIds: ['shot_0'] });
    mockSupportedProject(authority);
    mocks.bridge.prepareSubmission.invoke.mockResolvedValue(
      ok({ baseOnly: boardPromotionQuote(authority, ['shot_0']), withCascade: null })
    );
    renderStudio();
    await screen.findByRole('heading', { name: 'Launch film' });

    fireEvent.click(screen.getByRole('button', { name: 'conversation.creativeStudio.workspace.controls.renderFilm' }));

    expect(await screen.findByTestId('studio-spend-gate')).toBeVisible();
    expect(screen.getByText('conversation.creativeStudio.workspace.gate.reviewBeforeSpend')).toBeVisible();
    await waitFor(() => expect(mocks.bridge.prepareSubmission.invoke).toHaveBeenCalledTimes(1));
    expect(mocks.bridge.confirmSubmission.invoke).not.toHaveBeenCalled();
  });

  it('wires exact generation remedies to the affected route role and Shot reference editor', async () => {
    const authority = projectWithGenerationReferences(1, { assignedBackgroundShotIds: ['shot_0'] });
    mockSupportedProject(authority);
    renderStudio();
    await waitFor(() => expect(mocks.beatPanelActions).not.toBeNull());

    act(() => capturedBeatPanelActions().resolveGenerationBlock('shot_0', { code: 'no_engine', role: 'video' }));
    const dialog = await screen.findByRole('dialog', { name: BRIEF_RULES_TITLE });
    await waitFor(() => expect(within(dialog).getByRole('combobox', { name: VIDEO_ROUTE })).toHaveFocus());
    expect(within(dialog).getByRole('combobox', { name: IMAGE_ROUTE })).not.toHaveFocus();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));

    act(() =>
      capturedBeatPanelActions().resolveGenerationBlock('shot_0', {
        code: 'reference_binding',
        role: 'image',
        reason: 'unassigned',
        selectedCount: 0,
        limit: 3,
      })
    );
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/studio/project_1/table'));
    await waitFor(() =>
      expect(document.querySelector('[data-shot-id="shot_0"]')).toHaveAttribute('data-shot-binding-highlighted', 'true')
    );
  });

  it('filters a Main-blocked independent Film anchor out of paid review', async () => {
    const authority = projectWithGenerationReferences(2, {
      assignedBackgroundShotIds: ['shot_0', 'shot_1'],
    });
    authority.shots.shot_1!.chainBreak = 'hard_cut';
    mockSupportedProject(authority);
    mockGenerationBlock(
      { target: { kind: 'shot', shotId: 'shot_0' }, purpose: 'seed_still' },
      { code: 'no_engine', role: 'image' }
    );
    mocks.bridge.prepareSubmission.invoke.mockRejectedValueOnce(new Error('stop after request capture'));
    renderStudio();
    await waitFor(() => expect(mocks.bridge.getGenerationCapability.invoke).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: 'conversation.creativeStudio.workspace.controls.renderFilm' }));
    const modal = await screen.findByTestId('studio-spend-gate');
    expect(modal.querySelector('[data-generation-block-code="no_engine"]')).toBeVisible();

    await waitFor(() =>
      expect(mocks.bridge.prepareSubmission.invoke).toHaveBeenCalledWith({
        projectId: authority.id,
        expectedRevision: authority.revision,
        originReferenceHandoffId: null,
        baseChoices: [{ target: { kind: 'shot', shotId: 'shot_1' }, purpose: 'seed_still' }],
        cascadeChoices: [{ target: { kind: 'shot', shotId: 'shot_1' }, purpose: 'video_take' }],
      })
    );
  });

  it('shows an all-blocked exact Film intent without allowing preparation', async () => {
    const authority = projectWithGenerationReferences(1, { assignedBackgroundShotIds: ['shot_0'] });
    mockSupportedProject(authority);
    mockGenerationBlock(
      { target: { kind: 'shot', shotId: 'shot_0' }, purpose: 'seed_still' },
      { code: 'no_engine', role: 'image' }
    );
    renderStudio();
    await waitFor(() => expect(mocks.bridge.getGenerationCapability.invoke).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: 'conversation.creativeStudio.workspace.controls.renderFilm' }));
    const modal = await screen.findByTestId('studio-spend-gate');
    expect(modal.querySelector('[data-generation-block-code="no_engine"]')).toBeVisible();
    expect(
      within(modal).queryByRole('button', { name: 'conversation.creativeStudio.workspace.gate.prepare' })
    ).toBeNull();
    expect(mocks.bridge.prepareSubmission.invoke).not.toHaveBeenCalled();
  });

  it('keeps a blocked downstream video out by excluding its entire continuous Film cascade', async () => {
    const authority = projectWithGenerationReferences(3, {
      assignedBackgroundShotIds: ['shot_0', 'shot_1', 'shot_2'],
    });
    authority.beats.beat_0!.shotOrder = ['shot_0', 'shot_1'];
    authority.beatOrder = ['beat_0', 'beat_2'];
    delete authority.beats.beat_1;
    authority.shots.shot_1!.chainBreak = 'none';
    authority.shots.shot_2!.chainBreak = 'hard_cut';
    mockSupportedProject(authority);
    mockGenerationBlock(
      { target: { kind: 'shot', shotId: 'shot_1' }, purpose: 'video_take' },
      { code: 'duration', role: 'video', seconds: 4 }
    );
    mocks.bridge.prepareSubmission.invoke.mockRejectedValueOnce(new Error('stop after request capture'));
    renderStudio();
    await waitFor(() => expect(mocks.bridge.getGenerationCapability.invoke).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: 'conversation.creativeStudio.workspace.controls.renderFilm' }));
    const modal = await screen.findByTestId('studio-spend-gate');
    expect(modal.querySelector('[data-generation-block-code="duration"]')).toBeVisible();

    await waitFor(() =>
      expect(mocks.bridge.prepareSubmission.invoke).toHaveBeenCalledWith({
        projectId: authority.id,
        expectedRevision: authority.revision,
        originReferenceHandoffId: null,
        baseChoices: [{ target: { kind: 'shot', shotId: 'shot_2' }, purpose: 'seed_still' }],
        cascadeChoices: [{ target: { kind: 'shot', shotId: 'shot_2' }, purpose: 'video_take' }],
      })
    );
  });

  it('never invents or mutates a missing Shot reference binding during paid review', async () => {
    const authority = projectWithGenerationReferences(1);
    mockSupportedProject(authority);
    mocks.bridge.prepareSubmission.invoke.mockResolvedValueOnce({
      ok: false,
      error: {
        code: 'pricing_refused',
        messageKey: 'native.invalidReferenceBinding',
        reason: 'invalid_reference',
        details: { kind: 'reference_binding', shotId: 'shot_0', reason: 'unassigned' },
      },
    });
    renderStudio();
    await screen.findByRole('heading', { name: 'Launch film' });

    fireEvent.click(screen.getByRole('button', { name: 'conversation.creativeStudio.workspace.controls.renderFilm' }));
    const modal = await screen.findByTestId('studio-spend-gate');

    expect(
      await within(modal).findByText('conversation.creativeStudio.workspace.gate.errors.pricing.invalidReference')
    ).toBeVisible();
    expect(mocks.bridge.applyAuthoringBatch.invoke).not.toHaveBeenCalled();
    expect(mocks.bridge.confirmSubmission.invoke).not.toHaveBeenCalled();
  });

  it('bypasses free assignment when the seed-still Shot already has one exact approved background', async () => {
    const authority = projectWithGenerationReferences(1, { assignedBackgroundShotIds: ['shot_0'] });
    mockSupportedProject(authority);
    mocks.bridge.prepareSubmission.invoke.mockRejectedValueOnce(new Error('stop after request capture'));
    renderStudio();
    await screen.findByRole('heading', { name: 'Launch film' });

    fireEvent.click(screen.getByRole('button', { name: 'conversation.creativeStudio.workspace.controls.renderFilm' }));
    const modal = await screen.findByTestId('studio-spend-gate');
    expect(modal.querySelector('[data-background-choice-plan]')).toBeNull();

    await waitFor(() =>
      expect(mocks.bridge.prepareSubmission.invoke).toHaveBeenCalledWith(
        expect.objectContaining({ projectId: authority.id, expectedRevision: authority.revision })
      )
    );
    expect(mocks.bridge.applyAuthoringBatch.invoke).not.toHaveBeenCalled();
  });

  it('automatically estimates the exact next 24 missing Board panels without spending', async () => {
    const authority = projectWithBoardJobs(30, false);
    mockSupportedProject(authority);
    mocks.bridge.prepareSubmission.invoke.mockRejectedValueOnce(new Error('stop after request capture'));
    renderStudio();
    await waitFor(() => expect(mocks.tableBoardActions).not.toBeNull());

    act(() => capturedTableBoardActions().drawNext());
    await screen.findByTestId('studio-spend-gate');

    await waitFor(() =>
      expect(mocks.bridge.prepareSubmission.invoke).toHaveBeenCalledWith({
        projectId: authority.id,
        expectedRevision: authority.revision,
        originReferenceHandoffId: null,
        baseChoices: Array.from({ length: 24 }, (_, index) => ({
          target: { kind: 'shot', shotId: `board_shot_${String(index + 1).padStart(2, '0')}` },
          purpose: 'board_still',
        })),
        cascadeChoices: [],
      })
    );
    expect(mocks.bridge.confirmSubmission.invoke).not.toHaveBeenCalled();
  });

  it('filters an exact Main-blocked Board item while retaining eligible panels', async () => {
    const authority = projectWithBoardJobs(3, false);
    mockSupportedProject(authority);
    mocks.bridge.listRoutes.invoke.mockResolvedValue(
      ok({
        image: {
          status: 'unavailable',
          selected: null,
          selectedRoute: null,
          selectionIssue: { code: 'health' },
          options: [],
        },
        video: { status: 'ready', selected: null, selectedRoute: null, selectionIssue: null, options: [] },
        catalogVersion: 'catalog_1',
      })
    );
    mockGenerationBlock(
      { target: { kind: 'shot', shotId: 'board_shot_02' }, purpose: 'board_still' },
      { code: 'reference_binding', role: 'image', reason: 'unassigned', selectedCount: 0, limit: 3 }
    );
    mocks.bridge.prepareSubmission.invoke.mockRejectedValueOnce(new Error('stop after request capture'));
    renderStudio();
    await waitFor(() => expect(mocks.bridge.getGenerationCapability.invoke).toHaveBeenCalled());
    await waitFor(() => expect(mocks.tableBoardActions).not.toBeNull());

    act(() => capturedTableBoardActions().drawNext());
    const modal = await screen.findByTestId('studio-spend-gate');
    expect(modal.querySelector('[data-generation-block-code="reference_binding"]')).toBeVisible();

    await waitFor(() =>
      expect(mocks.bridge.prepareSubmission.invoke).toHaveBeenCalledWith({
        projectId: authority.id,
        expectedRevision: authority.revision,
        originReferenceHandoffId: null,
        baseChoices: ['01', '03'].map((suffix) => ({
          target: { kind: 'shot', shotId: `board_shot_${suffix}` },
          purpose: 'board_still',
        })),
        cascadeChoices: [],
      })
    );
  });

  it('routes a Board style choice through the revisioned project-settings owner', async () => {
    const authority = projectWithBoardJobs(2, false);
    mockSupportedProject(authority);
    mocks.bridge.editProject.invoke.mockResolvedValue(commit(authority.revision));
    renderStudio();
    await waitFor(() => expect(mocks.tableBoardActions).not.toBeNull());

    act(() => capturedTableBoardActions().setStyle('line_art'));

    await waitFor(() =>
      expect(mocks.bridge.editProject.invoke).toHaveBeenCalledWith({
        projectId: authority.id,
        expectedRevision: authority.revision,
        changes: { boardStyle: 'line_art' },
      })
    );
  });

  it('promotes one exact current Board panel for $0 without preparing or confirming provider work', async () => {
    const initial = withCurrentVideoTakes(withCurrentBoardPanels(projectWithBoardJobs(3, false), [1]), [1, 2, 3]);
    initial.videoRouteId = 'route_video';
    initial.shots.board_shot_02!.chainBreak = 'none';
    const promoted = structuredClone(initial);
    promoted.revision += 1;
    promoted.shots.board_shot_01!.seedStillId = 'board_asset_01';
    mocks.bridge.getProjectWorkspace.invoke
      .mockResolvedValueOnce(projectWorkspaceLoad(initial))
      .mockResolvedValue(projectWorkspaceLoad(promoted));
    mocks.bridge.applyAuthoringBatch.invoke.mockResolvedValue(commit(promoted.revision));
    renderStudio();
    await waitFor(() => expect(mocks.tableBoardActions).not.toBeNull());

    act(() => capturedTableBoardActions().promotePanel('board_shot_01', 'board_asset_01'));
    const modal = await screen.findByTestId('studio-spend-gate');
    expect(modal).toHaveAttribute('data-gate-kind', 'board_promotion');
    expect(
      within(modal)
        .getAllByRole('listitem')
        .map((row) => row.getAttribute('data-promotion-stale-shot-id'))
    ).toEqual(['board_shot_01', 'board_shot_02']);
    expect(mocks.bridge.prepareSubmission.invoke).not.toHaveBeenCalled();
    expect(mocks.bridge.confirmSubmission.invoke).not.toHaveBeenCalled();

    fireEvent.click(
      within(modal).getByRole('button', {
        name: 'conversation.creativeStudio.workspace.gate.promotion.promoteOnlyAction',
      })
    );

    await waitFor(() =>
      expect(mocks.bridge.applyAuthoringBatch.invoke).toHaveBeenCalledExactlyOnceWith({
        projectId: initial.id,
        expectedRevision: initial.revision,
        operations: [
          {
            kind: 'promote_board_panel',
            shotId: 'board_shot_01',
            boardAssetId: 'board_asset_01',
          },
        ],
      })
    );
    expect(
      await within(modal).findByText('conversation.creativeStudio.workspace.gate.promotion.promoted')
    ).toBeVisible();
    expect(promoted.shots.board_shot_01!.chainBreak).toBe(initial.shots.board_shot_01!.chainBreak);
    expect(promoted.shots.board_shot_01!.videoAssetId).toBe(initial.shots.board_shot_01!.videoAssetId);
    expect(promoted.shots.board_shot_02!.videoAssetId).toBe(initial.shots.board_shot_02!.videoAssetId);
    expect(mocks.bridge.prepareSubmission.invoke).not.toHaveBeenCalled();
    expect(mocks.bridge.confirmSubmission.invoke).not.toHaveBeenCalled();
  });

  it('prepares and confirms atomic paid Board promotion only from its two explicit actions', async () => {
    const authority = withCurrentVideoTakes(withCurrentBoardPanels(projectWithBoardJobs(3, false), [1]), [1, 2, 3]);
    authority.videoRouteId = 'route_video';
    authority.shots.board_shot_02!.chainBreak = 'none';
    mockSupportedProject(authority);
    const quote = boardPromotionQuote(authority, ['board_shot_01', 'board_shot_02']);
    mocks.bridge.prepareSubmission.invoke.mockResolvedValue(ok({ baseOnly: quote, withCascade: null }));
    mocks.bridge.confirmSubmission.invoke.mockResolvedValue(
      ok({ projectId: authority.id, projectRevision: authority.revision + 1 })
    );
    renderStudio();
    await waitFor(() => expect(mocks.tableBoardActions).not.toBeNull());

    act(() => capturedTableBoardActions().promotePanel('board_shot_01', 'board_asset_01'));
    const modal = await screen.findByTestId('studio-spend-gate');
    expect(mocks.bridge.prepareSubmission.invoke).not.toHaveBeenCalled();
    expect(mocks.bridge.confirmSubmission.invoke).not.toHaveBeenCalled();
    expect(mocks.bridge.applyAuthoringBatch.invoke).not.toHaveBeenCalled();

    fireEvent.click(
      within(modal).getByRole('radio', {
        name: /conversation\.creativeStudio\.workspace\.gate\.promotion\.promoteAndRerender/,
      })
    );
    expect(mocks.bridge.prepareSubmission.invoke).not.toHaveBeenCalled();
    fireEvent.click(
      within(modal).getByRole('button', {
        name: 'conversation.creativeStudio.workspace.gate.promotion.reviewPaidAction',
      })
    );

    await waitFor(() =>
      expect(mocks.bridge.prepareSubmission.invoke).toHaveBeenCalledExactlyOnceWith({
        projectId: authority.id,
        expectedRevision: authority.revision,
        originReferenceHandoffId: null,
        baseChoices: [],
        cascadeChoices: [],
        boardPromotion: { shotId: 'board_shot_01', boardAssetId: 'board_asset_01' },
      })
    );
    expect(mocks.bridge.confirmSubmission.invoke).not.toHaveBeenCalled();
    expect(mocks.bridge.applyAuthoringBatch.invoke).not.toHaveBeenCalled();

    fireEvent.click(
      await within(modal).findByRole('button', {
        name: /conversation\.creativeStudio\.workspace\.gate\.promotion\.confirm/,
      })
    );
    await waitFor(() =>
      expect(mocks.bridge.confirmSubmission.invoke).toHaveBeenCalledExactlyOnceWith({
        projectId: authority.id,
        quoteId: quote.id,
        expectedRevision: authority.revision,
      })
    );
    expect(mocks.bridge.applyAuthoringBatch.invoke).not.toHaveBeenCalled();
  });

  it('rejects Board draw, style, and Stop callbacks while paid confirmation is locked', async () => {
    const authority = projectWithBoardJobs(2);
    authority.jobs.board_job_01!.status = 'needs_attention';
    authority.jobs.board_job_01!.error = {
      code: 'provider_unavailable',
      messageKey: 'conversation.creativeStudio.jobs.errors.providerUnavailable',
    };
    authority.jobs.board_job_01!.canRetry = true;
    authority.jobs.board_job_01!.canCancel = true;
    const secondJobId = authority.shots.board_shot_02!.jobIds[0]!;
    authority.shots.board_shot_02!.jobIds = [];
    delete authority.jobs[secondJobId];
    mockSupportedProject(authority);
    mocks.bridge.prepareSubmission.invoke.mockResolvedValue(
      ok({
        baseOnly: {
          id: 'quote_board',
          projectId: authority.id,
          projectRevision: authority.revision,
          expiresAt: '2026-01-01T01:00:00.000Z',
          currency: 'USD',
          baseItems: [
            {
              target: { kind: 'shot', shotId: 'board_shot_02' },
              purpose: 'board_still',
              route: { choiceId: 'route_image', providerId: 'provider_safe', model: 'model_safe' },
              generationCount: 1,
              durationSeconds: null,
              oneGenerationMinorUnits: 3,
              requestedTotalMinorUnits: 3,
              composition: testComposition({ kind: 'shot', shotId: 'board_shot_02' }, 'board_still', {
                projectRevision: authority.revision,
                boardStyle: authority.boardStyle,
              }),
            },
          ],
          cascadeItems: [],
          lowerMinorUnits: 3,
          upperMinorUnits: 3,
          budget: { kind: 'no_policy' },
        },
        withCascade: null,
      })
    );
    const confirmation = deferred<{
      ok: true;
      data: { projectId: string; projectRevision: number };
    }>();
    mocks.bridge.confirmSubmission.invoke.mockReturnValue(confirmation.promise);
    renderStudio();
    await waitFor(() => expect(mocks.tableBoardActions).not.toBeNull());

    act(() => capturedTableBoardActions().drawNext());
    const modal = await screen.findByTestId('studio-spend-gate');
    const confirm = await within(modal).findByRole('button', {
      name: /conversation\.creativeStudio\.workspace\.gate\.confirm/,
    });
    fireEvent.click(confirm);
    await waitFor(() => expect(mocks.bridge.confirmSubmission.invoke).toHaveBeenCalledTimes(1));

    act(() => {
      capturedTableBoardActions().setStyle('line_art');
      capturedTableBoardActions().drawNext();
      capturedTableBoardActions().retryJob('board_job_01', false);
      capturedTableBoardActions().retryDownload('board_job_01');
      capturedTableBoardActions().cancelJob('board_job_01');
      capturedTableBoardActions().stop();
    });
    expect(mocks.bridge.editProject.invoke).not.toHaveBeenCalled();
    expect(mocks.bridge.cancelJob.invoke).not.toHaveBeenCalled();
    expect(mocks.bridge.retryJob.invoke).not.toHaveBeenCalled();
    expect(mocks.bridge.retryDownload.invoke).not.toHaveBeenCalled();
    expect(mocks.bridge.prepareSubmission.invoke).toHaveBeenCalledTimes(1);

    await act(async () => {
      confirmation.resolve(ok({ projectId: authority.id, projectRevision: authority.revision + 1 }));
      await confirmation.promise;
    });
  });

  it('opens only the requested Beat for a paid Board draw or redraw', async () => {
    const authority = projectWithBoardJobs(10, false);
    mockSupportedProject(authority);
    mocks.bridge.prepareSubmission.invoke.mockRejectedValueOnce(new Error('stop after request capture'));
    renderStudio();
    await waitFor(() => expect(mocks.tableBoardActions).not.toBeNull());

    act(() => capturedTableBoardActions().drawBeat('board_beat_2'));
    await screen.findByTestId('studio-spend-gate');

    await waitFor(() =>
      expect(mocks.bridge.prepareSubmission.invoke).toHaveBeenCalledWith({
        projectId: authority.id,
        expectedRevision: authority.revision,
        originReferenceHandoffId: null,
        baseChoices: [9, 10].map((shotNumber) => ({
          target: { kind: 'shot', shotId: `board_shot_${String(shotNumber).padStart(2, '0')}` },
          purpose: 'board_still',
        })),
        cascadeChoices: [],
      })
    );
  });

  it('keeps free Board promotion available while a Main blocker removes the paid rerender choice', async () => {
    const authority = withCurrentVideoTakes(withCurrentBoardPanels(projectWithBoardJobs(3, false), [1]), [1, 2, 3]);
    authority.videoRouteId = 'route_video';
    authority.shots.board_shot_02!.chainBreak = 'none';
    mockSupportedProject(authority);
    mockGenerationBlock(
      { target: { kind: 'shot', shotId: 'board_shot_01' }, purpose: 'video_take' },
      { code: 'first_frame', role: 'video' }
    );
    renderStudio();
    await waitFor(() => expect(mocks.tableBoardActions).not.toBeNull());

    act(() => capturedTableBoardActions().promotePanel('board_shot_01', 'board_asset_01'));
    const modal = await screen.findByTestId('studio-spend-gate');
    expect(modal.querySelector('[data-generation-block-code="first_frame"]')).toBeVisible();
    expect(
      within(modal).getByRole('button', {
        name: 'conversation.creativeStudio.workspace.gate.promotion.promoteOnlyAction',
      })
    ).toBeEnabled();
    expect(
      within(modal).queryByRole('radio', {
        name: /conversation\.creativeStudio\.workspace\.gate\.promotion\.promoteAndRerender/,
      })
    ).toBeNull();
    expect(mocks.bridge.prepareSubmission.invoke).not.toHaveBeenCalled();
  });

  it('rejects empty stop sets and forged Beat or panel identities before pricing', async () => {
    const authority = projectWithBoardJobs(2, false);
    mockSupportedProject(authority);
    renderStudio('/studio/project_1/table');
    await screen.findByRole('heading', { name: 'Launch film' });
    await waitFor(() => expect(mocks.tableBoardActions).not.toBeNull());
    const board = capturedTableBoardActions();

    act(() => board.stop());
    act(() => board.drawBeat('missing_beat'));
    act(() => board.redrawBeat('missing_beat'));
    act(() => board.promotePanel('missing_shot', 'missing_asset'));

    expect(mocks.bridge.cancelJob.invoke).not.toHaveBeenCalled();
    expect(mocks.bridge.prepareSubmission.invoke).not.toHaveBeenCalled();
    expect(mocks.bridge.confirmSubmission.invoke).not.toHaveBeenCalled();
    expect(screen.queryByTestId('studio-spend-gate')).toBeNull();
    expect(await screen.findByText('conversation.creativeStudio.workspace.controls.selectionNotPayable')).toBeVisible();
  });

  it('opens only the exact requested Shot for a paid Board redraw', async () => {
    const authority = withCurrentBoardPanels(projectWithBoardJobs(3, false), [2]);
    mockSupportedProject(authority);
    mocks.bridge.prepareSubmission.invoke.mockRejectedValueOnce(new Error('stop after request capture'));
    renderStudio();
    await waitFor(() => expect(mocks.tableBoardActions).not.toBeNull());

    act(() => capturedTableBoardActions().redrawShot('board_shot_02'));
    await screen.findByTestId('studio-spend-gate');

    await waitFor(() =>
      expect(mocks.bridge.prepareSubmission.invoke).toHaveBeenCalledWith({
        projectId: authority.id,
        expectedRevision: authority.revision,
        originReferenceHandoffId: null,
        baseChoices: [{ target: { kind: 'shot', shotId: 'board_shot_02' }, purpose: 'board_still' }],
        cascadeChoices: [],
      })
    );
  });

  it('rejects Redraw for a missing Shot or a partially boarded Beat', async () => {
    const authority = withCurrentBoardPanels(projectWithBoardJobs(2, false), [1]);
    mockSupportedProject(authority);
    renderStudio();
    await waitFor(() => expect(mocks.tableBoardActions).not.toBeNull());

    act(() => capturedTableBoardActions().redrawShot('board_shot_02'));
    expect(await screen.findByText('conversation.creativeStudio.workspace.controls.selectionNotPayable')).toBeVisible();
    expect(screen.queryByTestId('studio-spend-gate')).toBeNull();

    act(() => capturedTableBoardActions().redrawBeat('board_beat_1'));
    expect(screen.queryByTestId('studio-spend-gate')).toBeNull();
    expect(mocks.bridge.prepareSubmission.invoke).not.toHaveBeenCalled();
  });

  it('blocks Board spend review while generation-affecting drafts are dirty', async () => {
    const authority = withCurrentBoardPanels(projectWithBoardJobs(2, false), [1]);
    mockSupportedProject(authority);
    seedWorkspaceDrafts({
      'brief.text': { baseValue: authority.brief, value: 'Unsaved replacement brief' },
    });
    renderStudio();
    await waitFor(() => expect(mocks.tableBoardActions).not.toBeNull());

    act(() => capturedTableBoardActions().setStyle('line_art'));
    act(() => capturedTableBoardActions().drawNext());
    act(() => capturedTableBoardActions().promotePanel('board_shot_01', 'board_asset_01'));

    expect(await screen.findByText('conversation.creativeStudio.workspace.controls.saveBeforeReview')).toBeVisible();
    expect(mocks.bridge.editProject.invoke).not.toHaveBeenCalled();
    expect(screen.queryByTestId('studio-spend-gate')).toBeNull();
    expect(mocks.bridge.prepareSubmission.invoke).not.toHaveBeenCalled();
  });

  it('blocks Board spend review when the Board status is not exact', async () => {
    const authority = withCurrentBoardPanels(projectWithBoardJobs(2, false), [1]);
    mockSupportedProject(authority);
    const pendingStatus = workspaceStatus(authority);
    pendingStatus.boardPanels[0]!.latestJobId = 'forged_job';
    mocks.bridge.projectWorkspaceStatusFixture.invoke.mockResolvedValue(ok(pendingStatus));
    renderStudio();
    await waitFor(() => expect(mocks.tableBoardActions).not.toBeNull());

    act(() => capturedTableBoardActions().drawNext());

    expect(await screen.findByText('conversation.creativeStudio.workspace.controls.statusRequired')).toBeVisible();
    expect(screen.queryByTestId('studio-spend-gate')).toBeNull();
    expect(mocks.bridge.prepareSubmission.invoke).not.toHaveBeenCalled();
  });

  it('discloses Main authority when a missing image route blocks Board spend review', async () => {
    const authority = projectWithBoardJobs(1, false);
    authority.imageRouteId = null;
    mockSupportedProject(authority);
    mockGenerationBlock(
      { target: { kind: 'shot', shotId: 'board_shot_01' }, purpose: 'board_still' },
      { code: 'no_engine', role: 'image' }
    );
    renderStudio();
    await waitFor(() => expect(mocks.tableBoardActions).not.toBeNull());

    act(() => capturedTableBoardActions().drawNext());

    const modal = await screen.findByTestId('studio-spend-gate');
    expect(modal.querySelector('[data-generation-block-code="no_engine"]')).toBeVisible();
    expect(
      within(modal).queryByRole('button', { name: 'conversation.creativeStudio.workspace.gate.prepare' })
    ).toBeNull();
    expect(mocks.bridge.prepareSubmission.invoke).not.toHaveBeenCalled();
  });

  it('blocks Board spend review until the project has a Board style', async () => {
    const authority = projectWithBoardJobs(2, false);
    authority.boardStyle = null;
    mockSupportedProject(authority);
    renderStudio();
    await waitFor(() => expect(mocks.tableBoardActions).not.toBeNull());

    act(() => capturedTableBoardActions().drawNext());

    expect(await screen.findByText('conversation.creativeStudio.workspace.controls.selectionNotPayable')).toBeVisible();
    expect(screen.queryByTestId('studio-spend-gate')).toBeNull();
    expect(mocks.bridge.prepareSubmission.invoke).not.toHaveBeenCalled();
  });

  it('stops all 30 exact cancellable Board jobs against sequentially refreshed revisions', async () => {
    const initial = projectWithBoardJobs(30);
    const authorities = Array.from({ length: 31 }, (_, cancelledCount) =>
      withCancelledBoardJobs(initial, cancelledCount)
    );
    let workspaceRead = 0;
    mocks.bridge.getProjectWorkspace.invoke.mockImplementation(async () => {
      const authority = authorities[Math.min(workspaceRead, 30)]!;
      workspaceRead += 1;
      return projectWorkspaceLoad(authority);
    });
    mocks.bridge.cancelJob.invoke.mockImplementation(async ({ jobId }: { jobId: string }) => {
      const shotNumber = Number(jobId.slice(-2));
      return ok(authorities[shotNumber]!.jobs[jobId]!);
    });
    renderStudio();
    await waitFor(() => expect(mocks.tableBoardActions).not.toBeNull());

    act(() => capturedTableBoardActions().stop());

    await waitFor(() => expect(mocks.bridge.cancelJob.invoke).toHaveBeenCalledTimes(30), { timeout: 15_000 });
    expect(mocks.bridge.cancelJob.invoke.mock.calls.map(([request]) => request)).toEqual(
      Array.from({ length: 30 }, (_, index) => ({
        projectId: initial.id,
        jobId: `board_job_${String(index + 1).padStart(2, '0')}`,
        expectedRevision: initial.revision + index,
      }))
    );
    expect(workspaceRead).toBe(31);
  });

  it('stops a busy Board job without cancelling a separate job that needs attention', async () => {
    const initial = projectWithBoardJobs(2);
    initial.jobs.board_job_02!.status = 'needs_attention';
    initial.jobs.board_job_02!.error = {
      code: 'provider_unavailable',
      messageKey: 'conversation.creativeStudio.jobs.errors.providerUnavailable',
    };
    initial.jobs.board_job_02!.canRetry = true;
    initial.jobs.board_job_02!.canCancel = true;
    const afterBusyCancellation = withCancelledBoardJobs(initial, 1);
    mocks.bridge.getProjectWorkspace.invoke
      .mockResolvedValueOnce(projectWorkspaceLoad(initial))
      .mockResolvedValue(projectWorkspaceLoad(afterBusyCancellation));
    mocks.bridge.cancelJob.invoke.mockResolvedValue(ok(afterBusyCancellation.jobs.board_job_01));
    renderStudio();
    await waitFor(() => expect(mocks.tableBoardActions).not.toBeNull());

    act(() => capturedTableBoardActions().stop());

    await waitFor(() => expect(mocks.bridge.getProjectWorkspace.invoke).toHaveBeenCalledTimes(2));
    expect(mocks.bridge.cancelJob.invoke).toHaveBeenCalledExactlyOnceWith({
      projectId: initial.id,
      jobId: 'board_job_01',
      expectedRevision: initial.revision,
    });
    expect(afterBusyCancellation.jobs.board_job_02).toMatchObject({
      status: 'needs_attention',
      canCancel: true,
    });
  });

  it('retries only an exact Board attention job with the required duplicate-charge acknowledgement', async () => {
    const current = withBoardAttention(projectWithBoardJobs(1), { submissionUnknown: true, canCancel: false });
    const retried = structuredClone(current);
    retried.revision += 1;
    retried.jobs.board_job_01!.status = 'queued_local';
    retried.jobs.board_job_01!.error = null;
    retried.jobs.board_job_01!.canRetry = false;
    retried.jobs.board_job_01!.canCancel = true;
    mocks.bridge.getProject.invoke
      .mockResolvedValueOnce(ok({ status: 'supported', project: current }))
      .mockResolvedValue(ok({ status: 'supported', project: retried }));
    mocks.bridge.projectWorkspaceStatusFixture.invoke
      .mockResolvedValueOnce(ok(workspaceStatus(current)))
      .mockResolvedValue(ok(workspaceStatus(retried)));
    mocks.bridge.projectWorkspaceChainFixture.invoke
      .mockResolvedValueOnce(ok(chainStatus(current)))
      .mockResolvedValue(ok(chainStatus(retried)));
    mocks.bridge.retryJob.invoke.mockResolvedValue(ok(retried.jobs.board_job_01));
    renderStudio();
    await waitFor(() => expect(mocks.tableBoardActions).not.toBeNull());

    await expect(capturedBeatPanelActions().retryGenerationJob('board_job_01', true)).resolves.toBe(false);
    act(() => capturedTableBoardActions().retryJob('board_job_01', false));
    expect(mocks.bridge.retryJob.invoke).not.toHaveBeenCalled();

    act(() => capturedTableBoardActions().retryJob('board_job_01', true));
    await waitFor(() =>
      expect(mocks.bridge.retryJob.invoke).toHaveBeenCalledExactlyOnceWith({
        projectId: current.id,
        jobId: 'board_job_01',
        expectedRevision: current.revision,
        acknowledgePossibleDuplicateCharge: true,
      })
    );
  });

  it('retries an exact Board download failure without opening a fresh paid generation gate', async () => {
    const current = projectWithBoardJobs(1);
    const failed = current.jobs.board_job_01!;
    failed.status = 'failed';
    failed.error = {
      code: 'download_failed',
      messageKey: 'conversation.creativeStudio.jobs.errors.downloadFailed',
    };
    failed.canCancel = false;
    failed.canRetry = false;
    failed.canRetryDownload = true;
    const retried = structuredClone(current);
    retried.revision += 1;
    retried.jobs.board_job_01!.updatedAt = '2026-01-01T00:00:01.000Z';
    mocks.bridge.getProject.invoke
      .mockResolvedValueOnce(ok({ status: 'supported', project: current }))
      .mockResolvedValue(ok({ status: 'supported', project: retried }));
    mocks.bridge.projectWorkspaceStatusFixture.invoke
      .mockResolvedValueOnce(ok(workspaceStatus(current)))
      .mockResolvedValue(ok(workspaceStatus(retried)));
    mocks.bridge.projectWorkspaceChainFixture.invoke
      .mockResolvedValueOnce(ok(chainStatus(current)))
      .mockResolvedValue(ok(chainStatus(retried)));
    mocks.bridge.retryDownload.invoke.mockResolvedValue(ok(retried.jobs.board_job_01));
    renderStudio();
    await waitFor(() => expect(mocks.tableBoardActions).not.toBeNull());

    act(() => capturedTableBoardActions().drawNext());
    expect(screen.queryByTestId('studio-spend-gate')).toBeNull();
    expect(mocks.bridge.prepareSubmission.invoke).not.toHaveBeenCalled();

    act(() => capturedTableBoardActions().retryDownload('board_job_01'));
    await waitFor(() =>
      expect(mocks.bridge.retryDownload.invoke).toHaveBeenCalledExactlyOnceWith({
        projectId: current.id,
        jobId: 'board_job_01',
        expectedRevision: current.revision,
      })
    );
    await waitFor(() => expect(mocks.bridge.getProject.invoke).toHaveBeenCalledTimes(2));
    expect(mocks.bridge.retryJob.invoke).not.toHaveBeenCalled();
    expect(mocks.bridge.prepareSubmission.invoke).not.toHaveBeenCalled();
    expect(mocks.bridge.confirmSubmission.invoke).not.toHaveBeenCalled();
  });

  it('cancels only an exact provider-cancellable Board attention job through the Table owner', async () => {
    const current = withBoardAttention(projectWithBoardJobs(1), { submissionUnknown: false, canCancel: true });
    const cancelled = structuredClone(current);
    cancelled.revision += 1;
    cancelled.jobs.board_job_01!.status = 'cancelled';
    cancelled.jobs.board_job_01!.error = null;
    cancelled.jobs.board_job_01!.canRetry = false;
    cancelled.jobs.board_job_01!.canCancel = false;
    mocks.bridge.getProject.invoke
      .mockResolvedValueOnce(ok({ status: 'supported', project: current }))
      .mockResolvedValue(ok({ status: 'supported', project: cancelled }));
    mocks.bridge.projectWorkspaceStatusFixture.invoke
      .mockResolvedValueOnce(ok(workspaceStatus(current)))
      .mockResolvedValue(ok(workspaceStatus(cancelled)));
    mocks.bridge.projectWorkspaceChainFixture.invoke
      .mockResolvedValueOnce(ok(chainStatus(current)))
      .mockResolvedValue(ok(chainStatus(cancelled)));
    mocks.bridge.cancelJob.invoke.mockResolvedValue(ok(cancelled.jobs.board_job_01));
    renderStudio();
    await waitFor(() => expect(mocks.tableBoardActions).not.toBeNull());

    await expect(capturedBeatPanelActions().cancelGenerationJob('board_job_01')).resolves.toBe(false);
    act(() => capturedTableBoardActions().cancelJob('board_job_01'));

    await waitFor(() =>
      expect(mocks.bridge.cancelJob.invoke).toHaveBeenCalledExactlyOnceWith({
        projectId: current.id,
        jobId: 'board_job_01',
        expectedRevision: current.revision,
      })
    );
  });

  it('opens an exact paid continuity draft without using the free authoring bridge', async () => {
    const authority = projectWithGenerationReferences(1, { assignedBackgroundShotIds: ['shot_0'] });
    authority.beats.beat_0!.shotOrder.push('shot_1');
    authority.beats.beat_0!.targetSeconds = 8;
    authority.shots.shot_1 = {
      ...authority.shots.shot_0!,
      id: 'shot_1',
      shootingScript: 'Shot 2',
      chainBreak: 'none',
    };
    mockSupportedProject(authority);
    mocks.bridge.prepareSubmission.invoke.mockRejectedValueOnce(new Error('stop after request capture'));
    renderStudio();
    await screen.findByRole('heading', { name: 'Launch film' });
    await waitFor(() => expect(mocks.beatPanelActions).not.toBeNull());

    act(() => capturedBeatPanelActions().reviewContinuity('shot_1', true));
    const modal = await screen.findByTestId('studio-spend-gate');
    expect(modal).toHaveAttribute('data-gate-kind', 'continuity_change');
    expect(mocks.bridge.applyAuthoringBatch.invoke).not.toHaveBeenCalled();

    await waitFor(() =>
      expect(mocks.bridge.prepareSubmission.invoke).toHaveBeenCalledWith({
        projectId: 'project_1',
        expectedRevision: 3,
        originReferenceHandoffId: null,
        baseChoices: [],
        cascadeChoices: [],
        continuityChange: { shotId: 'shot_1', hardCut: true, requiresSeedGeneration: true },
      })
    );
    expect(mocks.bridge.applyAuthoringBatch.invoke).not.toHaveBeenCalled();
    expect(mocks.bridge.confirmSubmission.invoke).not.toHaveBeenCalled();
  });

  it('discloses a Main capability blocker on exact continuity work and disables prepare', async () => {
    const authority = projectWithGenerationReferences(1, { assignedBackgroundShotIds: ['shot_0'] });
    authority.beats.beat_0!.shotOrder.push('shot_1', 'shot_2');
    authority.beats.beat_0!.targetSeconds = 12;
    authority.shots.shot_1 = {
      ...authority.shots.shot_0!,
      id: 'shot_1',
      shootingScript: 'Shot 2',
      chainBreak: 'none',
    };
    authority.shots.shot_2 = {
      ...authority.shots.shot_0!,
      id: 'shot_2',
      shootingScript: 'Shot 3',
      chainBreak: 'none',
    };
    mockSupportedProject(authority);
    mockGenerationBlock(
      { target: { kind: 'shot', shotId: 'shot_2' }, purpose: 'video_take' },
      { code: 'first_frame', role: 'video' }
    );
    renderStudio();
    await waitFor(() => expect(mocks.beatPanelActions).not.toBeNull());

    act(() => capturedBeatPanelActions().reviewContinuity('shot_1', true));
    const modal = await screen.findByTestId('studio-spend-gate');
    expect(modal.querySelector('[data-generation-block-code="first_frame"]')).toBeVisible();
    expect(
      within(modal).queryByRole('button', { name: 'conversation.creativeStudio.workspace.gate.prepare' })
    ).toBeNull();
    expect(mocks.bridge.prepareSubmission.invoke).not.toHaveBeenCalled();
  });

  it('refreshes an open generation gate and clears a stale catalog blocker without reopening it', async () => {
    const authority = projectWithDraftBatch(1);
    mockSupportedProject(authority);
    const refreshedCapability = deferred<ReturnType<typeof supportedCapabilityResult>>();
    let capabilityCall = 0;
    mocks.bridge.getGenerationCapability.invoke.mockImplementation(
      async (input: { projectId: string; expectedRevision: number; items: StudioGenerationCapabilityItemV2[] }) => {
        capabilityCall += 1;
        if (capabilityCall > 1) return refreshedCapability.promise;
        const imageItems = input.items.filter((item) => item.purpose !== 'video_take');
        const videoItems = input.items.filter((item) => item.purpose === 'video_take');
        return ok({
          projectId: input.projectId,
          projectRevision: input.expectedRevision,
          catalogVersion: 'catalog_1',
          supportedItems: [],
          blocks: [
            ...(imageItems.length === 0
              ? []
              : [{ block: { code: 'catalog_unloaded' as const, role: 'image' as const }, items: imageItems }]),
            ...(videoItems.length === 0
              ? []
              : [{ block: { code: 'catalog_unloaded' as const, role: 'video' as const }, items: videoItems }]),
          ],
        });
      }
    );
    renderStudio();
    await waitFor(() => expect(mocks.bridge.getGenerationCapability.invoke).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mocks.beatPanelActions).not.toBeNull());

    act(() =>
      capturedBeatPanelActions().reviewShot('shot_0', [
        { shotId: 'shot_0', purpose: 'seed_still' },
        { shotId: 'shot_0', purpose: 'video_take' },
      ])
    );
    const modal = await screen.findByTestId('studio-spend-gate');
    expect(
      within(modal).queryByRole('button', { name: 'conversation.creativeStudio.workspace.gate.prepare' })
    ).toBeNull();
    expect(modal.querySelector('[data-generation-block-code="catalog_unloaded"]')).toBeVisible();
    await waitFor(() => expect(mocks.bridge.getGenerationCapability.invoke).toHaveBeenCalledTimes(2));

    const refreshInput = mocks.bridge.getGenerationCapability.invoke.mock.calls[1]![0];
    await act(async () => refreshedCapability.resolve(supportedCapabilityResult(refreshInput)));
    await waitFor(() => expect(mocks.bridge.prepareSubmission.invoke).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(modal.querySelector('[data-generation-block-code="catalog_unloaded"]')).toBeNull());
    expect(screen.getByTestId('studio-spend-gate')).toBe(modal);
  });

  it('uses the exact Main blocker for continuity even when the generic route catalog is unavailable', async () => {
    const authority = projectWithDraftBatch(1);
    authority.beats.beat_0!.shotOrder.push('shot_1');
    authority.beats.beat_0!.targetSeconds = 8;
    authority.shots.shot_1 = {
      ...authority.shots.shot_0!,
      id: 'shot_1',
      shootingScript: 'Shot 2',
      chainBreak: 'none',
    };
    mockSupportedProject(authority);
    mocks.bridge.listRoutes.invoke.mockResolvedValue(
      ok({
        image: {
          status: 'unavailable',
          selected: null,
          selectedRoute: null,
          selectionIssue: { code: 'health' },
          options: [],
        },
        video: {
          status: 'unavailable',
          selected: null,
          selectedRoute: null,
          selectionIssue: { code: 'health' },
          options: [],
        },
        catalogVersion: 'catalog_1',
      })
    );
    mockGenerationBlock(
      { target: { kind: 'shot', shotId: 'shot_1' }, purpose: 'video_take' },
      { code: 'no_engine', role: 'video' }
    );
    renderStudio();
    await screen.findByRole('heading', { name: 'Launch film' });
    await waitFor(() => expect(mocks.beatPanelActions).not.toBeNull());

    act(() => capturedBeatPanelActions().reviewContinuity('shot_1', true));

    const modal = await screen.findByTestId('studio-spend-gate');
    expect(modal.querySelector('[data-generation-block-code="no_engine"]')).toBeVisible();
    expect(
      within(modal).queryByRole('button', { name: 'conversation.creativeStudio.workspace.gate.prepare' })
    ).toBeNull();
    expect(screen.queryByText('conversation.creativeStudio.workspace.gate.errors.routesUnavailable')).toBeNull();
    expect(mocks.bridge.prepareSubmission.invoke).not.toHaveBeenCalled();
    expect(mocks.bridge.applyAuthoringBatch.invoke).not.toHaveBeenCalled();
  });

  it('exposes exactly one level-two heading for the Cut view', async () => {
    renderStudio('/studio/project_1/cut');

    await screen.findByRole('heading', { name: 'Launch film' });
    const cutView = document.querySelector<HTMLElement>('main[data-studio-view="cut"]');
    expect(cutView).not.toBeNull();
    const headings = within(cutView!).getAllByRole('heading', { level: 2 });
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveAttribute('id', 'studio-cut-heading');
  });

  it('omits the reviewed-output rail section when there are no cards or review errors', async () => {
    renderStudio();

    await screen.findByRole('heading', { name: 'Launch film' });
    expect(document.querySelector('[data-studio-director-reviewed-output]')).toBeNull();
  });

  it('keeps app-bar project drafts and native snapshot counts stable across Table, Board, and Cut navigation', async () => {
    mockSupportedProject(projectWithHandoffShot());
    renderStudio();
    await screen.findByRole('heading', { name: 'Launch film' });
    expectProjectFormsAbsentFromMain('table');
    let settingsDialog = await openProjectDialog(SETTINGS_TITLE);
    const name = within(settingsDialog).getByLabelText(NAME);
    const shell = document.querySelector('[data-studio-workspace-shell]');
    const directorRail = document.querySelector('[data-studio-director-rail]');
    const workPanel = document.querySelector('[data-studio-work-panel]');
    const conversationOwner = document.querySelector('[data-studio-director-conversation-owner]');
    // The app bar heads the project and both panes sit under it, so the rail and the work panel are
    // siblings inside the panes row rather than direct children of the shell. What this guards is
    // unchanged: they are fixed siblings and a view change remounts neither.
    const panes = document.querySelector('[data-studio-panes]');
    expect(shell).not.toBeNull();
    expect(panes?.parentElement).toBe(shell);
    expect(directorRail?.parentElement).toBe(panes);
    expect(workPanel?.parentElement).toBe(panes);
    // The rail's drag handle sits between them, so they are adjacent across it rather than directly.
    const resizer = document.querySelector('[data-studio-rail-resizer]');
    expect(resizer?.parentElement).toBe(panes);
    expect(directorRail?.nextElementSibling).toBe(resizer);
    expect(resizer?.nextElementSibling).toBe(workPanel);
    expect(conversationOwner).not.toBeNull();
    await waitFor(() => expect(mocks.bridge.listRoutes.invoke).toHaveBeenCalledTimes(1));
    const baseline = {
      project: mocks.bridge.getProject.invoke.mock.calls.length,
      workspace: mocks.bridge.projectWorkspaceStatusFixture.invoke.mock.calls.length,
      chain: mocks.bridge.projectWorkspaceChainFixture.invoke.mock.calls.length,
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
      parkShot: mocks.bridge.parkShot.invoke.mock.calls.length,
      parkBeat: mocks.bridge.parkBeat.invoke.mock.calls.length,
      restoreBeat: mocks.bridge.restoreBeat.invoke.mock.calls.length,
      restoreShot: mocks.bridge.restoreShot.invoke.mock.calls.length,
      reorderBin: mocks.bridge.reorderBin.invoke.mock.calls.length,
      prepare: mocks.bridge.prepareSubmission.invoke.mock.calls.length,
      confirm: mocks.bridge.confirmSubmission.invoke.mock.calls.length,
    };
    fireEvent.change(name, { target: { value: 'Navigation-only local draft' } });
    await closeProjectDialog(settingsDialog, SETTINGS_TITLE);
    const table = screen.getByRole('grid', { name: 'conversation.creativeStudio.workspace.table.label' });
    const selectedRow = within(table).getAllByRole('row')[1]!;
    fireEvent.click(within(selectedRow).getAllByRole('gridcell')[1]!);
    expect(selectedRow).toHaveAttribute('aria-selected', 'true');
    const beatDialog = screen.getByRole('dialog');
    expect(beatDialog).toBeVisible();
    fireEvent.keyDown(
      within(beatDialog).getByLabelText('conversation.creativeStudio.workspace.beatPanel.fields.story'),
      { key: 'Escape' }
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(selectedRow).toHaveAttribute('aria-selected', 'true');

    fireEvent.click(screen.getByRole('link', { name: 'conversation.creativeStudio.workspace.views.board' }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/studio/project_1/board'));
    expectProjectFormsAbsentFromMain('board');
    settingsDialog = await openProjectDialog(SETTINGS_TITLE);
    expect(within(settingsDialog).getByLabelText(NAME)).toHaveValue('Navigation-only local draft');
    await closeProjectDialog(settingsDialog, SETTINGS_TITLE);
    expect(document.querySelector('[data-studio-director-conversation-owner]')).toBe(conversationOwner);
    fireEvent.click(screen.getAllByLabelText(/conversation\.creativeStudio\.workspace\.board\.openBeat/)[0]!);
    expect(screen.getByRole('dialog')).toBeVisible();
    fireEvent.click(screen.getByRole('link', { name: 'conversation.creativeStudio.workspace.views.cut' }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/studio/project_1/cut'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expectProjectFormsAbsentFromMain('cut');
    settingsDialog = await openProjectDialog(SETTINGS_TITLE);
    expect(within(settingsDialog).getByLabelText(NAME)).toHaveValue('Navigation-only local draft');
    await closeProjectDialog(settingsDialog, SETTINGS_TITLE);
    expect(document.querySelector('[data-studio-director-conversation-owner]')).toBe(conversationOwner);
    fireEvent.click(screen.getByRole('link', { name: 'conversation.creativeStudio.workspace.views.table' }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/studio/project_1/table'));
    expectProjectFormsAbsentFromMain('table');
    settingsDialog = await openProjectDialog(SETTINGS_TITLE);
    expect(within(settingsDialog).getByLabelText(NAME)).toHaveValue('Navigation-only local draft');
    await closeProjectDialog(settingsDialog, SETTINGS_TITLE);
    expect(document.querySelector('[data-studio-director-conversation-owner]')).toBe(conversationOwner);
    expect(
      within(screen.getByRole('grid', { name: 'conversation.creativeStudio.workspace.table.label' })).getAllByRole(
        'row'
      )[1]
    ).toHaveAttribute('aria-selected', 'true');

    expect({
      project: mocks.bridge.getProject.invoke.mock.calls.length,
      workspace: mocks.bridge.projectWorkspaceStatusFixture.invoke.mock.calls.length,
      chain: mocks.bridge.projectWorkspaceChainFixture.invoke.mock.calls.length,
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
      parkShot: mocks.bridge.parkShot.invoke.mock.calls.length,
      parkBeat: mocks.bridge.parkBeat.invoke.mock.calls.length,
      restoreBeat: mocks.bridge.restoreBeat.invoke.mock.calls.length,
      restoreShot: mocks.bridge.restoreShot.invoke.mock.calls.length,
      reorderBin: mocks.bridge.reorderBin.invoke.mock.calls.length,
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
      ok([handoff(), handoff(), handoff('succeeded'), handoff('dismissed')])
    );

    renderStudio();

    expect(await screen.findByTestId('studio-proposal-proposal_1')).toBeVisible();
    expect(screen.getByTestId('studio-reference-reference_1')).toBeVisible();
    expect(screen.getAllByTestId('studio-handoff-handoff_awaiting_spend')).toHaveLength(1);
    expect(screen.getByTestId('studio-handoff-handoff_succeeded')).toBeVisible();
    expect(screen.getByTestId('studio-handoff-handoff_dismissed')).toBeVisible();
    const transcript = screen.getByTestId('message-list-content');
    const proposalOutput = screen
      .getByTestId('studio-proposal-proposal_1')
      .closest('[data-studio-director-reviewed-output]');
    const referenceOutput = screen
      .getByTestId('studio-reference-reference_1')
      .closest('[data-studio-director-reviewed-output]');
    expect(transcript).toContainElement(proposalOutput);
    expect(transcript).toContainElement(referenceOutput);
    expect(proposalOutput).not.toBe(referenceOutput);
  });

  it('refreshes running handoff progress and thumbnails when project-owned jobs change', async () => {
    const current = projectWithCandidateReference();
    mockSupportedProject(current);
    const queued = {
      ...handoff('running'),
      counts: { queued: 1, running: 0, succeeded: 0, failed: 0 },
      resultAssetIds: [],
    };
    const succeeded = {
      ...queued,
      status: 'succeeded' as const,
      counts: { queued: 0, running: 0, succeeded: 1, failed: 0 },
      resultAssetIds: ['asset_reference_3'],
      completedAt: '2026-01-01T00:00:04.000Z',
    };
    mocks.bridge.listReferenceGenerationHandoffs.invoke
      .mockResolvedValueOnce(ok([queued]))
      .mockResolvedValue(ok([succeeded]));

    renderStudio();
    const card = within(await screen.findByTestId('studio-handoff-handoff_running'));
    expect(
      card.getByText(
        'conversation.creativeStudio.workspace.handoffs.progress:{"queued":1,"running":0,"succeeded":0,"failed":0}'
      )
    ).toBeVisible();

    act(() => mocks.listeners.projectUpdated?.({ projectId: 'project_1' }));

    await waitFor(() => expect(mocks.bridge.listReferenceGenerationHandoffs.invoke).toHaveBeenCalledTimes(2));
    expect(
      await card.findByText(
        'conversation.creativeStudio.workspace.handoffs.progress:{"queued":0,"running":0,"succeeded":1,"failed":0}'
      )
    ).toBeVisible();
    expect(
      await card.findByRole('img', {
        name: 'conversation.creativeStudio.workspace.referenceWorkflow.previewAlt:{"label":"Hero"}',
      })
    ).toHaveAttribute('src', expect.stringContaining('asset_reference_3'));
  });

  it('blocks handoff review for unsaved generative intent while keeping free dismissal available', async () => {
    seedWorkspaceDrafts({
      'brief.text': { baseValue: 'A small launch film.', value: 'Unsaved generation Brief' },
    });
    mocks.bridge.listReferenceGenerationHandoffs.invoke.mockResolvedValue(ok([handoff(), handoff('succeeded')]));

    renderStudio();
    const card = within(await screen.findByTestId('studio-handoff-handoff_awaiting_spend'));
    await waitFor(() =>
      expect(card.getByRole('button', { name: 'conversation.creativeStudio.workspace.handoffs.review' })).toBeDisabled()
    );
    expect(card.getByText('conversation.creativeStudio.workspace.controls.saveBeforeReview')).toBeVisible();
    const dismiss = card.getByRole('button', { name: 'conversation.creativeStudio.workspace.handoffs.dismiss' });
    expect(dismiss).toBeEnabled();
    fireEvent.click(dismiss);

    await waitFor(() => expect(mocks.bridge.dismissReferenceGenerationHandoff.invoke).toHaveBeenCalledTimes(1));
    expect(mocks.bridge.prepareSubmission.invoke).not.toHaveBeenCalled();
    expect(screen.getByTestId('studio-handoff-handoff_succeeded')).toBeVisible();
  });

  it('blocks paid handoff review while the active project has an unsaved structured rule', async () => {
    mocks.bridge.listReferenceGenerationHandoffs.invoke.mockResolvedValue(ok([handoff()]));

    renderStudio();
    const dialog = await openProjectDialog(BRIEF_RULES_TITLE);
    fireEvent.change(within(dialog).getByLabelText(RULE_TEXT), {
      target: { value: 'Do not render the competitor logo.' },
    });
    await closeProjectDialog(dialog, BRIEF_RULES_TITLE);

    const card = within(await screen.findByTestId('studio-handoff-handoff_awaiting_spend'));
    await waitFor(() =>
      expect(card.getByRole('button', { name: 'conversation.creativeStudio.workspace.handoffs.review' })).toBeDisabled()
    );
    expect(card.getByText('conversation.creativeStudio.workspace.controls.saveBeforeReview')).toBeVisible();
    expect(mocks.bridge.prepareSubmission.invoke).not.toHaveBeenCalled();
  });

  it('keeps visible revision-matched controls installed while a newer composite snapshot is pending', async () => {
    const initial = projectWithHandoffShot();
    const updated = { ...projectWithHandoffShot(), revision: 4, name: 'Updated without a blink' };
    const pending = deferred<ReturnType<typeof projectWorkspaceLoad>>();
    mocks.bridge.getProjectWorkspace.invoke
      .mockReset()
      .mockResolvedValueOnce(projectWorkspaceLoad(initial))
      .mockReturnValueOnce(pending.promise);
    mocks.bridge.listReferenceGenerationHandoffs.invoke.mockResolvedValue(ok([handoff()]));

    renderStudio();
    const card = within(await screen.findByTestId('studio-handoff-handoff_awaiting_spend'));
    const review = card.getByRole('button', { name: 'conversation.creativeStudio.workspace.handoffs.review' });
    expect(review).toBeEnabled();
    expect(card.queryByText('conversation.creativeStudio.workspace.controls.statusRequired')).toBeNull();

    act(() => mocks.listeners.projectUpdated?.({ projectId: 'project_1' }));
    await waitFor(() => expect(mocks.bridge.getProjectWorkspace.invoke).toHaveBeenCalledTimes(2));
    expect(review).toBeEnabled();
    expect(card.queryByText('conversation.creativeStudio.workspace.controls.statusRequired')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Launch film' })).toBeVisible();

    await act(async () => {
      pending.resolve(projectWorkspaceLoad(updated));
      await pending.promise;
    });
    expect(await screen.findByRole('heading', { name: 'Updated without a blink' })).toBeVisible();
    expect(card.getByRole('button', { name: 'conversation.creativeStudio.workspace.handoffs.review' })).toBeEnabled();
    expect(card.queryByText('conversation.creativeStudio.workspace.controls.statusRequired')).toBeNull();
  });

  it('rejects a successful composite response whose three revisions do not match', async () => {
    mocks.bridge.listReferenceGenerationHandoffs.invoke.mockResolvedValue(ok([handoff()]));
    const authority = project();
    mocks.bridge.getProjectWorkspace.invoke.mockResolvedValue(
      projectWorkspaceLoad(authority, workspaceStatus(authority), chainStatus(2))
    );

    renderStudio();
    expect(await screen.findByRole('alert')).toHaveTextContent('conversation.creativeStudio.workspace.errors.storage');
    expect(screen.queryByTestId('studio-handoff-handoff_awaiting_spend')).toBeNull();
    expect(mocks.bridge.getProjectWorkspace.invoke).toHaveBeenCalledTimes(2);
  });

  it('refuses an awaiting-spend handoff whose reference identities are absent from the active project', async () => {
    mocks.bridge.listReferenceGenerationHandoffs.invoke.mockResolvedValue(ok([handoff()]));
    renderStudio();
    const card = within(await screen.findByTestId('studio-handoff-handoff_awaiting_spend'));
    fireEvent.click(card.getByRole('button', { name: 'conversation.creativeStudio.workspace.handoffs.review' }));

    expect(await screen.findByText('conversation.creativeStudio.workspace.controls.selectionNotPayable')).toBeVisible();
    expect(mocks.bridge.prepareProjectReferences.invoke).not.toHaveBeenCalled();
    expect(mocks.bridge.prepareSubmission.invoke).not.toHaveBeenCalled();
    expect(mocks.bridge.confirmSubmission.invoke).not.toHaveBeenCalled();
  });

  it('automatically estimates an exact project-reference handoff without spending', async () => {
    mockSupportedProject(projectWithReferenceHandoff());
    mocks.bridge.listReferenceGenerationHandoffs.invoke.mockResolvedValue(ok([handoff()]));
    renderStudio();
    const card = within(await screen.findByTestId('studio-handoff-handoff_awaiting_spend'));
    fireEvent.click(card.getByRole('button', { name: 'conversation.creativeStudio.workspace.handoffs.review' }));

    const modal = await screen.findByTestId('studio-spend-gate');
    expect(
      within(modal).queryByRole('button', { name: 'conversation.creativeStudio.workspace.gate.prepare' })
    ).toBeNull();
    await waitFor(() =>
      expect(mocks.bridge.prepareProjectReferences.invoke).toHaveBeenCalledExactlyOnceWith({
        projectId: 'project_1',
        expectedRevision: 3,
        referenceIds: ['reference_3'],
      })
    );
    expect(mocks.bridge.prepareSubmission.invoke).not.toHaveBeenCalled();
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
    await waitFor(() => expect(screen.getByTestId('studio-handoff-handoff_awaiting_spend')).toBeVisible());
    expect(mocks.bridge.listReferenceRequests.invoke).toHaveBeenCalledTimes(2);
    expect(mocks.bridge.listReferenceGenerationHandoffs.invoke).toHaveBeenCalledTimes(2);
    expect(mocks.bridge.prepareSubmission.invoke).not.toHaveBeenCalled();
    expect(mocks.bridge.confirmSubmission.invoke).not.toHaveBeenCalled();
    expect(mocks.bridge.dismissReferenceGenerationHandoff.invoke).not.toHaveBeenCalled();
  });

  it('records a rejected reference request without creating a paid handoff', async () => {
    mocks.bridge.listReferenceRequests.invoke.mockResolvedValueOnce(ok([referenceRequest()])).mockResolvedValue(ok([]));
    mocks.bridge.decideReferenceRequest.invoke.mockResolvedValue(
      ok({
        schemaVersion: 5,
        requestId: 'reference_1',
        projectId: 'project_1',
        decidedAt: '2026-01-01T00:00:05.000Z',
        outcome: { kind: 'rejected' as const },
      })
    );

    renderStudio();
    fireEvent.click(
      await screen.findByRole('button', { name: 'conversation.creativeStudio.workspace.references.reject' })
    );

    await waitFor(() =>
      expect(mocks.bridge.decideReferenceRequest.invoke).toHaveBeenCalledWith({
        projectId: 'project_1',
        requestId: 'reference_1',
        expectedRevision: 3,
        outcome: { kind: 'rejected' },
      })
    );
    expect(screen.queryByTestId('studio-spend-gate')).toBeNull();
    expect(mocks.bridge.prepareProjectReferences.invoke).not.toHaveBeenCalled();
    expect(mocks.bridge.confirmSubmission.invoke).not.toHaveBeenCalled();
  });

  it('reports and flushes the shared draft owner, preserving drafts when the commit fails', async () => {
    const initial = project();
    const revised = { ...project(), revision: 4, name: 'Saved name' };
    mocks.bridge.getProject.invoke.mockResolvedValueOnce(ok({ status: 'supported', project: initial }));
    mocks.bridge.getProject.invoke.mockResolvedValue(ok({ status: 'supported', project: revised }));
    mocks.bridge.projectWorkspaceStatusFixture.invoke
      .mockResolvedValueOnce(ok(workspaceStatus(3)))
      .mockResolvedValue(ok(workspaceStatus(4)));
    mocks.bridge.projectWorkspaceChainFixture.invoke
      .mockResolvedValueOnce(ok(chainStatus(3)))
      .mockResolvedValue(ok(chainStatus(4)));

    const first = renderStudio();
    let settingsDialog = await openProjectDialog(SETTINGS_TITLE);
    fireEvent.change(within(settingsDialog).getByLabelText(NAME), {
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
    settingsDialog = await openProjectDialog(SETTINGS_TITLE);
    fireEvent.change(within(settingsDialog).getByLabelText(NAME), {
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

  it('drops persisted draft values whose runtime type disagrees with project authority', async () => {
    seedWorkspaceDrafts({
      'settings.name': { baseValue: 'Launch film', value: 42 },
      'brief.text': { baseValue: 'A small launch film.', value: 42 },
    });

    renderStudio();
    await screen.findByRole('heading', { name: 'Launch film' });
    await waitFor(() => expect(mocks.closeHandlers.hasUnsavedWork?.()).toEqual({ dirtyDraftCount: 0 }));
    let response: { saved: boolean } | undefined;
    await act(async () => {
      response = await mocks.closeHandlers.flushUnsavedWork?.();
    });

    expect(response).toEqual({ saved: true });
    expect(mocks.bridge.editProject.invoke).not.toHaveBeenCalled();
    expect(mocks.bridge.applyAuthoringBatch.invoke).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(window.sessionStorage.getItem('aionui:creative-studio:v2:workspace-drafts:project_1')).toBeNull()
    );
  });

  it('blocks close-save and preserves structured rule drafts across project navigation', async () => {
    const projectB = { ...project(), id: 'project_2', revision: 4, name: 'Second project' };
    mocks.bridge.getProject.invoke.mockImplementation(async ({ projectId }: { projectId: string }) =>
      ok({ status: 'supported' as const, project: projectId === 'project_2' ? projectB : project() })
    );
    mocks.bridge.projectWorkspaceStatusFixture.invoke.mockImplementation(async ({ projectId }: { projectId: string }) =>
      ok(projectId === 'project_2' ? { ...workspaceStatus(4), projectId: 'project_2' } : workspaceStatus(3))
    );
    mocks.bridge.projectWorkspaceChainFixture.invoke.mockImplementation(async ({ projectId }: { projectId: string }) =>
      ok(projectId === 'project_2' ? { ...chainStatus(4), projectId: 'project_2' } : chainStatus(3))
    );

    renderStudioWithProjectSwitch();
    let briefDialog = await openProjectDialog(BRIEF_RULES_TITLE);
    fireEvent.change(within(briefDialog).getByLabelText(BRIEF), {
      target: { value: 'Keep this unrelated Brief draft too.' },
    });
    fireEvent.change(within(briefDialog).getByLabelText(RULE_TEXT), {
      target: { value: 'Keep this structured rule draft.' },
    });
    fireEvent.change(within(briefDialog).getByLabelText(RULE_TERMS), { target: { value: 'Acme, Globex' } });

    await waitFor(() => expect(mocks.closeHandlers.hasUnsavedWork?.()).toEqual({ dirtyDraftCount: 2 }));
    let saved: { saved: boolean } | undefined;
    await act(async () => {
      saved = await mocks.closeHandlers.flushUnsavedWork?.();
    });
    expect(saved).toEqual({ saved: false });
    expect(mocks.bridge.applyAuthoringBatch.invoke).not.toHaveBeenCalled();
    expect(mocks.bridge.setRules.invoke).not.toHaveBeenCalled();
    expect(within(briefDialog).getByLabelText(BRIEF)).toHaveValue('Keep this unrelated Brief draft too.');
    expect(within(briefDialog).getByLabelText(RULE_TEXT)).toHaveValue('Keep this structured rule draft.');

    fireEvent.click(screen.getByRole('button', { name: 'Switch project' }));
    expect(await screen.findByRole('heading', { name: 'Second project' })).toBeVisible();
    await waitFor(() => expect(mocks.closeHandlers.hasUnsavedWork?.()).toEqual({ dirtyDraftCount: 2 }));
    await act(async () => {
      saved = await mocks.closeHandlers.flushUnsavedWork?.();
    });
    expect(saved).toEqual({ saved: false });

    fireEvent.click(screen.getByRole('button', { name: 'Return to first project' }));
    expect(await screen.findByRole('heading', { name: 'Launch film' })).toBeVisible();
    briefDialog = await openProjectDialog(BRIEF_RULES_TITLE);
    expect(within(briefDialog).getByLabelText(BRIEF)).toHaveValue('Keep this unrelated Brief draft too.');
    expect(within(briefDialog).getByLabelText(RULE_TEXT)).toHaveValue('Keep this structured rule draft.');
    expect(within(briefDialog).getByLabelText(RULE_TERMS)).toHaveValue('Acme, Globex');
    await waitFor(() => expect(mocks.closeHandlers.hasUnsavedWork?.()).toEqual({ dirtyDraftCount: 2 }));
  });

  it('keeps the close contract active for stored rule drafts after returning to the library', async () => {
    renderStudioWithProjectSwitch();
    const briefDialog = await openProjectDialog(BRIEF_RULES_TITLE);
    fireEvent.change(within(briefDialog).getByLabelText(RULE_TEXT), {
      target: { value: 'Keep this draft when the project page unmounts.' },
    });
    await waitFor(() => expect(mocks.closeHandlers.hasUnsavedWork?.()).toEqual({ dirtyDraftCount: 1 }));

    fireEvent.click(screen.getByRole('button', { name: 'Return to library' }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/studio'));
    await waitFor(() => expect(mocks.closeHandlers.hasUnsavedWork?.()).toEqual({ dirtyDraftCount: 1 }));
    let saved: { saved: boolean } | undefined;
    await act(async () => {
      saved = await mocks.closeHandlers.flushUnsavedWork?.();
    });
    expect(saved).toEqual({ saved: false });
    expect(mocks.bridge.setRules.invoke).not.toHaveBeenCalled();
  });

  it('keeps relocated settings and Brief drafts protected outside their project', async () => {
    const projectB = { ...project(), id: 'project_2', revision: 4, name: 'Second project' };
    mocks.bridge.getProject.invoke.mockImplementation(async ({ projectId }: { projectId: string }) =>
      ok({ status: 'supported' as const, project: projectId === 'project_2' ? projectB : project() })
    );
    mocks.bridge.projectWorkspaceStatusFixture.invoke.mockImplementation(async ({ projectId }: { projectId: string }) =>
      ok(projectId === 'project_2' ? { ...workspaceStatus(4), projectId: 'project_2' } : workspaceStatus(3))
    );
    mocks.bridge.projectWorkspaceChainFixture.invoke.mockImplementation(async ({ projectId }: { projectId: string }) =>
      ok(projectId === 'project_2' ? { ...chainStatus(4), projectId: 'project_2' } : chainStatus(3))
    );

    renderStudioWithProjectSwitch();
    const briefDialog = await openProjectDialog(BRIEF_RULES_TITLE);
    fireEvent.change(within(briefDialog).getByLabelText(BRIEF), {
      target: { value: 'Keep this relocated Brief draft.' },
    });
    await waitFor(() => expect(mocks.closeHandlers.hasUnsavedWork?.()).toEqual({ dirtyDraftCount: 1 }));

    fireEvent.click(screen.getByRole('button', { name: 'Switch project' }));
    expect(await screen.findByRole('heading', { name: 'Second project' })).toBeVisible();
    await waitFor(() => expect(mocks.closeHandlers.hasUnsavedWork?.()).toEqual({ dirtyDraftCount: 1 }));
    let saved: { saved: boolean } | undefined;
    await act(async () => {
      saved = await mocks.closeHandlers.flushUnsavedWork?.();
    });
    expect(saved).toEqual({ saved: false });

    fireEvent.click(screen.getByRole('button', { name: 'Return to library' }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/studio'));
    await waitFor(() => expect(mocks.closeHandlers.hasUnsavedWork?.()).toEqual({ dirtyDraftCount: 1 }));
    await act(async () => {
      saved = await mocks.closeHandlers.flushUnsavedWork?.();
    });
    expect(saved).toEqual({ saved: false });
    expect(mocks.bridge.applyAuthoringBatch.invoke).not.toHaveBeenCalled();
  });

  it('does not let a deferred project-A settings continuation reset project-B drafts after direct navigation', async () => {
    const projectB = {
      ...project(),
      id: 'project_2',
      revision: 4,
      name: 'Second project',
    };
    seedWorkspaceDrafts({ 'settings.name': { baseValue: 'Second project', value: 'B local draft' } }, 'project_2', 4);
    const projectACommitted = { ...project(), revision: 4, name: 'Deferred A' };
    let projectALoads = 0;
    const edit = deferred<ReturnType<typeof commit>>();
    mocks.bridge.editProject.invoke.mockReturnValue(edit.promise);
    mocks.bridge.getProject.invoke.mockImplementation(async ({ projectId }: { projectId: string }) => {
      if (projectId === 'project_2') return ok({ status: 'supported' as const, project: projectB });
      projectALoads += 1;
      return ok({ status: 'supported' as const, project: projectALoads === 1 ? project() : projectACommitted });
    });
    mocks.bridge.projectWorkspaceStatusFixture.invoke.mockImplementation(async ({ projectId }: { projectId: string }) =>
      ok(projectId === 'project_2' ? { ...workspaceStatus(4), projectId: 'project_2' } : workspaceStatus(3))
    );
    mocks.bridge.projectWorkspaceChainFixture.invoke.mockImplementation(async ({ projectId }: { projectId: string }) =>
      ok(projectId === 'project_2' ? { ...chainStatus(4), projectId: 'project_2' } : chainStatus(3))
    );

    renderStudioWithProjectSwitch();
    const projectADialog = await openProjectDialog(SETTINGS_TITLE);
    fireEvent.change(within(projectADialog).getByLabelText(NAME), { target: { value: 'Deferred A' } });
    fireEvent.click(
      within(projectADialog).getByRole('button', {
        name: 'conversation.creativeStudio.workspace.controls.saveSettings',
      })
    );
    await waitFor(() =>
      expect(mocks.bridge.editProject.invoke).toHaveBeenCalledWith({
        projectId: 'project_1',
        expectedRevision: 3,
        changes: { name: 'Deferred A' },
      })
    );

    fireEvent.click(screen.getByRole('button', { name: 'Switch project' }));
    expect(await screen.findByRole('heading', { name: 'Second project' })).toBeVisible();
    await waitFor(() => expect(screen.queryByRole('dialog', { name: SETTINGS_TITLE })).toBeNull());
    const projectBDialog = await openProjectDialog(SETTINGS_TITLE);
    const projectBName = within(projectBDialog).getByLabelText(NAME);
    expect(projectBName).toHaveValue('B local draft');

    await act(async () => edit.resolve(commit(4)));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Second project' })).toBeVisible());

    expect(projectBName).toHaveValue('B local draft');
    expect(mocks.closeHandlers.hasUnsavedWork?.()).toEqual({ dirtyDraftCount: 2 });
    expect(window.sessionStorage.getItem('aionui:creative-studio:v3:workspace-drafts:project_2')).toContain(
      'B local draft'
    );
  });

  it('continues close-save past locked shape drafts, commits Brief, and discards retired rule drafts', async () => {
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
    mocks.bridge.getProject.invoke
      .mockResolvedValueOnce(ok({ status: 'supported', project: initial }))
      .mockResolvedValue(ok({ status: 'supported', project: revision4 }));
    mocks.bridge.projectWorkspaceStatusFixture.invoke
      .mockResolvedValueOnce(ok(workspaceStatus(3, true)))
      .mockResolvedValue(ok(workspaceStatus(4, true)));
    mocks.bridge.projectWorkspaceChainFixture.invoke
      .mockResolvedValueOnce(ok(chainStatus(3)))
      .mockResolvedValue(ok(chainStatus(4)));

    renderStudio();
    await screen.findByRole('heading', { name: 'Launch film' });
    await waitFor(() => expect(mocks.closeHandlers.hasUnsavedWork?.()).toEqual({ dirtyDraftCount: 2 }));
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
    expect(mocks.bridge.setRules.invoke).not.toHaveBeenCalled();
    await waitFor(() => expect(mocks.closeHandlers.hasUnsavedWork?.()).toEqual({ dirtyDraftCount: 1 }));
    const persisted = window.sessionStorage.getItem('aionui:creative-studio:v3:workspace-drafts:project_1') ?? '';
    expect(persisted).toContain('settings.aspectRatio');
    expect(persisted).not.toContain('brief.rules');
  });

  it('flushes Beat and Shot drafts in revisioned batches without exceeding the mutation limit', async () => {
    const initial = projectWithDraftBatch(17);
    const revision4 = { ...initial, revision: 4 };
    const revision5 = { ...initial, revision: 5 };
    const entries: Record<string, { baseValue: unknown; value: unknown }> = {};
    for (let index = 0; index < 17; index += 1) {
      entries[`beat.beat_${index}.story`] = {
        baseValue: `Story ${index + 1}`,
        value: `Revised story ${index + 1}`,
      };
      entries[`shot.shot_${index}.shootingScript`] = {
        baseValue: `Shot ${index + 1}`,
        value: `Revised shot ${index + 1}`,
      };
    }
    seedWorkspaceDrafts(entries);
    mocks.bridge.getProject.invoke
      .mockResolvedValueOnce(ok({ status: 'supported', project: initial }))
      .mockResolvedValueOnce(ok({ status: 'supported', project: revision4 }))
      .mockResolvedValue(ok({ status: 'supported', project: revision5 }));
    mocks.bridge.projectWorkspaceStatusFixture.invoke
      .mockResolvedValueOnce(ok(workspaceStatus(initial)))
      .mockResolvedValueOnce(ok(workspaceStatus(revision4)))
      .mockResolvedValue(ok(workspaceStatus(revision5)));
    mocks.bridge.projectWorkspaceChainFixture.invoke
      .mockResolvedValueOnce(ok(chainStatus(initial)))
      .mockResolvedValueOnce(ok(chainStatus(revision4)))
      .mockResolvedValue(ok(chainStatus(revision5)));
    mocks.bridge.applyAuthoringBatch.invoke.mockResolvedValueOnce(commit(4)).mockResolvedValueOnce(commit(5));

    renderStudio();
    await screen.findByRole('heading', { name: 'Launch film' });
    // The close bridge has a bounded wire count. Saving still sees and flushes all 34 drafts.
    await waitFor(() => expect(mocks.closeHandlers.hasUnsavedWork?.()).toEqual({ dirtyDraftCount: 24 }));
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

  it('disables project editors while a deferred settings commit is pending', async () => {
    const initial = project();
    const revised = { ...project(), revision: 4, name: 'Pending name' };
    const edit = deferred<ReturnType<typeof commit>>();
    mocks.bridge.editProject.invoke.mockReturnValue(edit.promise);
    mocks.bridge.getProject.invoke
      .mockResolvedValueOnce(ok({ status: 'supported', project: initial }))
      .mockResolvedValue(ok({ status: 'supported', project: revised }));
    mocks.bridge.projectWorkspaceStatusFixture.invoke
      .mockResolvedValueOnce(ok(workspaceStatus(3)))
      .mockResolvedValue(ok(workspaceStatus(4)));
    mocks.bridge.projectWorkspaceChainFixture.invoke
      .mockResolvedValueOnce(ok(chainStatus(3)))
      .mockResolvedValue(ok(chainStatus(4)));

    renderStudio();
    const settingsDialog = await openProjectDialog(SETTINGS_TITLE);
    const name = within(settingsDialog).getByLabelText(NAME);
    fireEvent.change(name, { target: { value: 'Pending name' } });
    fireEvent.click(
      within(settingsDialog).getByRole('button', {
        name: 'conversation.creativeStudio.workspace.controls.saveSettings',
      })
    );

    await waitFor(() => expect(name).toBeDisabled());
    await closeProjectDialog(settingsDialog, SETTINGS_TITLE);
    const briefDialog = await openProjectDialog(BRIEF_RULES_TITLE);
    const brief = within(briefDialog).getByLabelText(BRIEF);
    expect(brief).toBeDisabled();
    expect(within(briefDialog).getByLabelText('conversation.creativeStudio.rules.textLabel')).toBeDisabled();

    await act(async () => edit.resolve(commit(4)));
    await waitFor(() => expect(brief).toBeEnabled());
  });

  it('fails closed when an inadmissible set-routes operation reaches a Director proposal', async () => {
    const routeProposal: StudioRendererProposalV2 = {
      ...proposal(),
      payload: {
        kind: 'mutation_batch',
        operations: [{ kind: 'set_routes', imageRouteId: 'route_new', videoRouteId: null }],
      },
      review: { status: 'unavailable', groups: [], reason: 'reducer_rejected' },
    };
    mocks.bridge.listProposals.invoke.mockResolvedValue(ok([routeProposal]));

    renderStudio();
    const accept = await screen.findByRole('button', {
      name: 'conversation.creativeStudio.workspace.proposals.accept',
    });

    expect(accept).toBeDisabled();
    expect(screen.getByText('conversation.creativeStudio.workspace.proposals.reviewUnavailable')).toBeVisible();
    fireEvent.click(accept);
    expect(mocks.bridge.acceptProposal.invoke).not.toHaveBeenCalled();
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
    mocks.bridge.projectWorkspaceStatusFixture.invoke
      .mockResolvedValueOnce(ok(workspaceStatus(3)))
      .mockResolvedValue(ok(workspaceStatus(4)));
    mocks.bridge.projectWorkspaceChainFixture.invoke
      .mockResolvedValueOnce(ok(chainStatus(3)))
      .mockResolvedValue(ok(chainStatus(4)));

    renderStudio();
    let briefDialog = await openProjectDialog(BRIEF_RULES_TITLE);
    await waitFor(() =>
      expect(
        within(briefDialog).getAllByText('conversation.creativeStudio.workspace.controls.routeStatus.ready')
      ).toHaveLength(2)
    );
    await closeProjectDialog(briefDialog, BRIEF_RULES_TITLE);
    const settingsDialog = await openProjectDialog(SETTINGS_TITLE);
    fireEvent.click(
      within(settingsDialog).getByRole('button', {
        name: 'conversation.creativeStudio.workspace.controls.saveSettings',
      })
    );

    await waitFor(() =>
      expect(mocks.bridge.editProject.invoke).toHaveBeenCalledWith({
        projectId: 'project_1',
        expectedRevision: 3,
        changes: { resolution: '1080p' },
      })
    );
    await closeProjectDialog(settingsDialog, SETTINGS_TITLE);
    briefDialog = await openProjectDialog(BRIEF_RULES_TITLE);
    await waitFor(() =>
      expect(
        within(briefDialog).getAllByText('conversation.creativeStudio.workspace.controls.routeStatus.unavailable')
      ).toHaveLength(2)
    );
    expect(mocks.bridge.listRoutes.invoke).toHaveBeenCalledTimes(1);

    fireEvent.click(
      within(briefDialog).getByRole('button', {
        name: 'conversation.creativeStudio.workspace.controls.refreshRoutes',
      })
    );
    await waitFor(() => expect(mocks.bridge.listRoutes.invoke).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(
        within(briefDialog).getAllByText('conversation.creativeStudio.workspace.controls.routeStatus.ready')
      ).toHaveLength(2)
    );
  });

  it('refreshes revision-owned capability while preserving a ready catalog after a paid update', async () => {
    const initial = projectWithGenerationReferences(1, { assignedBackgroundShotIds: ['shot_0'] });
    const changed = { ...initial, revision: 4, name: 'Paid update landed' };
    mocks.bridge.getProject.invoke
      .mockResolvedValueOnce(ok({ status: 'supported', project: initial }))
      .mockResolvedValue(ok({ status: 'supported', project: changed }));
    mocks.bridge.projectWorkspaceStatusFixture.invoke
      .mockResolvedValueOnce(ok(workspaceStatus(3)))
      .mockResolvedValue(ok(workspaceStatus(4)));
    mocks.bridge.projectWorkspaceChainFixture.invoke
      .mockResolvedValueOnce(ok(chainStatus(3)))
      .mockResolvedValue(ok(chainStatus(4)));
    mocks.bridge.getGenerationCapability.invoke.mockImplementation(
      async (input: { projectId: string; expectedRevision: number; items: StudioGenerationCapabilityItemV2[] }) => {
        if (input.expectedRevision !== 4) return supportedCapabilityResult(input);
        const blockedItem = input.items.find(
          (item) => item.target.kind === 'shot' && item.target.shotId === 'shot_0' && item.purpose === 'video_take'
        )!;
        return ok({
          projectId: input.projectId,
          projectRevision: input.expectedRevision,
          catalogVersion: 'catalog_1',
          supportedItems: input.items.filter((item) => !sameCapabilityItem(item, blockedItem)),
          blocks: [{ block: { code: 'no_engine' as const, role: 'video' as const }, items: [blockedItem] }],
        });
      }
    );

    renderStudio();
    const briefDialog = await openProjectDialog(BRIEF_RULES_TITLE);
    await waitFor(() =>
      expect(
        within(briefDialog).getAllByText('conversation.creativeStudio.workspace.controls.routeStatus.ready')
      ).toHaveLength(2)
    );
    act(() => mocks.listeners.projectUpdated?.({ projectId: 'project_1' }));

    expect(await screen.findByRole('heading', { name: 'Paid update landed' })).toBeVisible();
    expect(
      within(briefDialog).getAllByText('conversation.creativeStudio.workspace.controls.routeStatus.ready')
    ).toHaveLength(2);
    expect(mocks.bridge.listRoutes.invoke).toHaveBeenCalledTimes(1);
    expect(mocks.bridge.getGenerationCapability.invoke).toHaveBeenCalledTimes(2);
    expect(mocks.bridge.getGenerationCapability.invoke.mock.calls[1]?.[0]).toMatchObject({ expectedRevision: 4 });
    expect(await within(briefDialog).findByText('conversation.creativeStudio.models.blocked.noEngine')).toBeVisible();
  });

  it('fails closed when route and capability catalog versions do not match', async () => {
    mocks.bridge.listRoutes.invoke.mockResolvedValue(
      ok({
        image: { status: 'ready', selected: null, selectedRoute: null, selectionIssue: null, options: [] },
        video: { status: 'ready', selected: null, selectedRoute: null, selectionIssue: null, options: [] },
        catalogVersion: 'catalog_2',
      })
    );
    mocks.bridge.getGenerationCapability.invoke.mockImplementation(
      async (input: { projectId: string; expectedRevision: number; items: StudioGenerationCapabilityItemV2[] }) =>
        supportedCapabilityResult(input, 'catalog_1')
    );

    render(<HookProbe projectId='project_1' />);

    await waitFor(() => expect(mocks.bridge.getGenerationCapability.invoke).toHaveBeenCalledOnce());
    expect(latestHookResult?.routeCatalog).toBeNull();
    expect(latestHookResult?.generationCapability).toBeNull();
    expect(latestHookResult?.routeErrorMessageKey).toBe('conversation.creativeStudio.workspace.errors.storage');
  });

  it('coalesces each active composite read into one trailing epoch without starving earlier callers', async () => {
    const initial = project();
    const revision4 = { ...project(), revision: 4, name: 'Revision four' };
    const revision5 = { ...project(), revision: 5, name: 'Revision five' };
    const revision6 = { ...project(), revision: 6, name: 'Revision six' };
    const leader = deferred<ReturnType<typeof projectWorkspaceLoad>>();
    const firstTrailing = deferred<ReturnType<typeof projectWorkspaceLoad>>();
    const secondTrailing = deferred<ReturnType<typeof projectWorkspaceLoad>>();
    mocks.bridge.getProjectWorkspace.invoke
      .mockReset()
      .mockResolvedValueOnce(projectWorkspaceLoad(initial))
      .mockReturnValueOnce(leader.promise)
      .mockReturnValueOnce(firstTrailing.promise)
      .mockReturnValueOnce(secondTrailing.promise);

    render(<HookProbe projectId='project_1' />);
    await waitFor(() => expect(latestHookResult?.project?.revision).toBe(3));

    let leaderPromise!: Promise<StudioRendererProjectV2 | null>;
    act(() => {
      leaderPromise = latestHookResult!.refetchProjectWorkspace();
    });
    await waitFor(() => expect(mocks.bridge.getProjectWorkspace.invoke).toHaveBeenCalledTimes(2));
    expect(latestHookResult?.project?.revision).toBe(3);
    expect(latestHookResult?.workspaceStatus?.projectRevision).toBe(3);
    expect(latestHookResult?.chainStatus?.projectRevision).toBe(3);

    let firstWaiter!: Promise<StudioRendererProjectV2 | null>;
    let sharedWaiter!: Promise<StudioRendererProjectV2 | null>;
    act(() => {
      firstWaiter = latestHookResult!.refetchProjectWorkspace();
      sharedWaiter = latestHookResult!.refetchProjectWorkspace();
      mocks.listeners.projectUpdated?.({ projectId: 'project_1' });
      mocks.listeners.projectUpdated?.({ projectId: 'project_1' });
    });
    expect(mocks.bridge.getProjectWorkspace.invoke).toHaveBeenCalledTimes(2);

    let leaderResult: StudioRendererProjectV2 | null = null;
    await act(async () => {
      leader.resolve(projectWorkspaceLoad(revision4));
      leaderResult = await leaderPromise;
    });
    expect(leaderResult?.revision).toBe(4);
    await waitFor(() => expect(mocks.bridge.getProjectWorkspace.invoke).toHaveBeenCalledTimes(3));

    let secondWaiter!: Promise<StudioRendererProjectV2 | null>;
    let secondWaiterSettled = false;
    act(() => {
      secondWaiter = latestHookResult!.refetchProjectWorkspace();
      void secondWaiter.then(() => {
        secondWaiterSettled = true;
      });
      mocks.listeners.projectUpdated?.({ projectId: 'project_1' });
    });
    expect(mocks.bridge.getProjectWorkspace.invoke).toHaveBeenCalledTimes(3);

    let firstResult: StudioRendererProjectV2 | null = null;
    let sharedResult: StudioRendererProjectV2 | null = null;
    await act(async () => {
      firstTrailing.resolve(projectWorkspaceLoad(revision5));
      [firstResult, sharedResult] = await Promise.all([firstWaiter, sharedWaiter]);
    });
    expect(firstResult?.revision).toBe(5);
    expect(sharedResult?.revision).toBe(5);
    expect(secondWaiterSettled).toBe(false);
    await waitFor(() => expect(mocks.bridge.getProjectWorkspace.invoke).toHaveBeenCalledTimes(4));

    let secondResult: StudioRendererProjectV2 | null = null;
    await act(async () => {
      secondTrailing.resolve(projectWorkspaceLoad(revision6));
      secondResult = await secondWaiter;
    });
    expect(secondResult?.revision).toBe(6);
    expect(latestHookResult?.project?.revision).toBe(6);
  });

  it('settles an obsolete binding leader and trailing waiter without reviving them after a project switch', async () => {
    const projectA = project();
    const projectARevision4 = { ...projectA, revision: 4, name: 'Obsolete project A' };
    const projectB = { ...project(), id: 'project_2', revision: 8, name: 'Current project B' };
    const delayedA = deferred<ReturnType<typeof projectWorkspaceLoad>>();
    let projectAReads = 0;
    mocks.bridge.getProjectWorkspace.invoke.mockImplementation(({ projectId }: { projectId: string }) => {
      if (projectId === projectB.id) return Promise.resolve(projectWorkspaceLoad(projectB));
      projectAReads += 1;
      return projectAReads === 1 ? Promise.resolve(projectWorkspaceLoad(projectA)) : delayedA.promise;
    });

    const view = render(<HookProbe projectId={projectA.id} />);
    await waitFor(() => expect(latestHookResult?.project?.id).toBe(projectA.id));

    let leader!: Promise<StudioRendererProjectV2 | null>;
    let trailing!: Promise<StudioRendererProjectV2 | null>;
    act(() => {
      leader = latestHookResult!.refetchProjectWorkspace();
      trailing = latestHookResult!.refetchProjectWorkspace();
    });
    await waitFor(() => expect(projectAReads).toBe(2));

    view.rerender(<HookProbe projectId={projectB.id} />);
    await expect(Promise.all([leader, trailing])).resolves.toEqual([null, null]);
    await waitFor(() => expect(latestHookResult?.project?.id).toBe(projectB.id));

    await act(async () => {
      delayedA.resolve(projectWorkspaceLoad(projectARevision4));
      await delayedA.promise;
    });
    expect(latestHookResult?.project?.id).toBe(projectB.id);
    expect(latestHookResult?.project?.revision).toBe(projectB.revision);
    expect(latestHookResult?.workspaceStatus?.projectId).toBe(projectB.id);
    expect(latestHookResult?.chainStatus?.projectId).toBe(projectB.id);
  });

  it('settles a pending composite leader and trailing waiter before an unmounted provider read resolves', async () => {
    const initial = project();
    const delayedRevision4 = deferred<ReturnType<typeof projectWorkspaceLoad>>();
    mocks.bridge.getProjectWorkspace.invoke
      .mockReset()
      .mockResolvedValueOnce(projectWorkspaceLoad(initial))
      .mockReturnValueOnce(delayedRevision4.promise);

    const view = render(<HookProbe projectId={initial.id} />);
    await waitFor(() => expect(latestHookResult?.project?.revision).toBe(initial.revision));

    let leader!: Promise<StudioRendererProjectV2 | null>;
    let trailing!: Promise<StudioRendererProjectV2 | null>;
    act(() => {
      leader = latestHookResult!.refetchProjectWorkspace();
      trailing = latestHookResult!.refetchProjectWorkspace();
    });
    await waitFor(() => expect(mocks.bridge.getProjectWorkspace.invoke).toHaveBeenCalledTimes(2));

    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      let settled: Array<StudioRendererProjectV2 | null> = [initial, initial];
      await act(async () => {
        view.unmount();
        settled = await Promise.all([leader, trailing]);
      });
      expect(settled).toEqual([null, null]);

      await act(async () => {
        delayedRevision4.resolve(projectWorkspaceLoad({ ...initial, revision: 4, name: 'Too late' }));
        await delayedRevision4.promise;
      });
      expect(mocks.bridge.getProjectWorkspace.invoke).toHaveBeenCalledTimes(2);
      expect(latestHookResult?.project?.revision).toBe(initial.revision);
      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });

  it('keeps a stale project-A composite callback from displacing the active project-B flight', async () => {
    const projectA = project();
    const projectARevision4 = { ...project(), revision: 4, name: 'Late project A' };
    const projectB = { ...project(), id: 'project_2', revision: 7, name: 'Project B' };
    const delayedA = deferred<ReturnType<typeof projectWorkspaceLoad>>();
    const delayedB = deferred<ReturnType<typeof projectWorkspaceLoad>>();
    let projectAReads = 0;
    mocks.bridge.getProjectWorkspace.invoke.mockImplementation(({ projectId }: { projectId: string }) => {
      if (projectId === projectA.id) {
        projectAReads += 1;
        return projectAReads === 1 ? Promise.resolve(projectWorkspaceLoad(projectA)) : delayedA.promise;
      }
      return delayedB.promise;
    });

    const view = render(<HookProbe projectId={projectA.id} />);
    await waitFor(() => expect(latestHookResult?.project?.id).toBe(projectA.id));
    const staleRefetch = latestHookResult!.refetchProjectWorkspace;

    view.rerender(<HookProbe projectId={projectB.id} />);
    await waitFor(() =>
      expect(mocks.bridge.getProjectWorkspace.invoke).toHaveBeenCalledWith({ projectId: projectB.id })
    );

    let stalePromise!: Promise<StudioRendererProjectV2 | null>;
    act(() => {
      stalePromise = staleRefetch();
    });
    delayedA.resolve(projectWorkspaceLoad(projectARevision4));
    const staleResult = await stalePromise;

    expect(staleResult).toBeNull();
    expect(projectAReads).toBe(1);
    expect(latestHookResult?.project?.id).not.toBe(projectA.id);
    expect(
      mocks.bridge.getProjectWorkspace.invoke.mock.calls.filter(([input]) => input.projectId === projectB.id)
    ).toHaveLength(1);

    await act(async () => {
      delayedB.resolve(projectWorkspaceLoad(projectB));
      await delayedB.promise;
    });
    await waitFor(() => expect(latestHookResult?.project?.id).toBe(projectB.id));
    expect(latestHookResult?.workspaceStatus?.projectId).toBe(projectB.id);
    expect(latestHookResult?.chainStatus?.projectId).toBe(projectB.id);
  });

  it('keeps every stale project binding callback inert across an A-to-B-to-A rebinding', async () => {
    const firstA = project();
    const projectB = { ...project(), id: 'project_2', revision: 4, name: 'Project B' };
    const reboundA = { ...project(), revision: 5, name: 'Rebound project A' };
    let projectAReads = 0;
    mocks.bridge.getProjectWorkspace.invoke.mockImplementation(({ projectId }: { projectId: string }) => {
      if (projectId === projectB.id) return Promise.resolve(projectWorkspaceLoad(projectB));
      projectAReads += 1;
      return Promise.resolve(projectWorkspaceLoad(projectAReads === 1 ? firstA : reboundA));
    });

    const view = render(<HookProbe projectId={firstA.id} />);
    await waitFor(() => expect(latestHookResult?.project?.revision).toBe(firstA.revision));
    const staleCallbacks = {
      projectWorkspace: latestHookResult!.refetchProjectWorkspace,
      proposals: latestHookResult!.refetchProposals,
      references: latestHookResult!.refetchReferences,
      routes: latestHookResult!.refetchRoutes,
      exports: latestHookResult!.refetchExports,
      all: latestHookResult!.refetchAll,
      installExportCatalog: latestHookResult!.installExportCatalog,
    };

    view.rerender(<HookProbe projectId={projectB.id} />);
    await waitFor(() => expect(latestHookResult?.project?.id).toBe(projectB.id));
    view.rerender(<HookProbe projectId={firstA.id} />);
    await waitFor(() => expect(latestHookResult?.project?.revision).toBe(reboundA.revision));

    mocks.bridge.getProjectWorkspace.invoke.mockClear();
    mocks.bridge.listProposals.invoke.mockClear();
    mocks.bridge.listReferenceRequests.invoke.mockClear();
    mocks.bridge.listReferenceGenerationHandoffs.invoke.mockClear();
    mocks.bridge.listRoutes.invoke.mockClear();
    mocks.bridge.listExports.invoke.mockClear();

    let staleProject: StudioRendererProjectV2 | null = reboundA;
    let staleRouteResult = true;
    let staleExportResult = true;
    await act(async () => {
      [staleProject, staleRouteResult, staleExportResult] = await Promise.all([
        staleCallbacks.projectWorkspace(),
        staleCallbacks.routes(),
        staleCallbacks.exports(),
      ]);
      await Promise.all([staleCallbacks.proposals(), staleCallbacks.references(), staleCallbacks.all()]);
    });

    expect(staleProject).toBeNull();
    expect(staleRouteResult).toBe(false);
    expect(staleExportResult).toBe(false);
    expect(staleCallbacks.installExportCatalog({ revision: 2, artifacts: [] })).toBe(false);
    expect(mocks.bridge.getProjectWorkspace.invoke).not.toHaveBeenCalled();
    expect(mocks.bridge.listProposals.invoke).not.toHaveBeenCalled();
    expect(mocks.bridge.listReferenceRequests.invoke).not.toHaveBeenCalled();
    expect(mocks.bridge.listReferenceGenerationHandoffs.invoke).not.toHaveBeenCalled();
    expect(mocks.bridge.listRoutes.invoke).not.toHaveBeenCalled();
    expect(mocks.bridge.listExports.invoke).not.toHaveBeenCalled();
    expect(latestHookResult?.project?.revision).toBe(reboundA.revision);
  });

  it('discards delayed proposal, reference, and export results from the previous project binding', async () => {
    const projectA = project();
    const projectB = { ...project(), id: 'project_2', revision: 6, name: 'Project B' };
    const delayedProposals = deferred<{ ok: true; data: StudioRendererProposalV2[] }>();
    const delayedReferenceRequests = deferred<{ ok: true; data: StudioReferenceRequestV2[] }>();
    const delayedHandoffs = deferred<{ ok: true; data: StudioRendererReferenceGenerationHandoffV2[] }>();
    const delayedExports = deferred<{ ok: true; data: StudioRendererExportCatalogV2 }>();
    mocks.bridge.getProjectWorkspace.invoke.mockImplementation(({ projectId }: { projectId: string }) =>
      Promise.resolve(projectWorkspaceLoad(projectId === projectB.id ? projectB : projectA))
    );

    const view = render(<HookProbe projectId={projectA.id} />);
    await waitFor(() => expect(latestHookResult?.project?.id).toBe(projectA.id));
    await waitFor(() => expect(mocks.bridge.listExports.invoke).toHaveBeenCalledTimes(1));
    mocks.bridge.listProposals.invoke.mockReturnValueOnce(delayedProposals.promise);
    mocks.bridge.listReferenceRequests.invoke.mockReturnValueOnce(delayedReferenceRequests.promise);
    mocks.bridge.listReferenceGenerationHandoffs.invoke.mockReturnValueOnce(delayedHandoffs.promise);
    mocks.bridge.listExports.invoke.mockReturnValueOnce(delayedExports.promise);

    let proposals!: Promise<void>;
    let references!: Promise<void>;
    let exports!: Promise<boolean>;
    act(() => {
      proposals = latestHookResult!.refetchProposals();
      references = latestHookResult!.refetchReferences();
      exports = latestHookResult!.refetchExports();
    });
    await waitFor(() => expect(mocks.bridge.listProposals.invoke).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(mocks.bridge.listReferenceRequests.invoke).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(mocks.bridge.listReferenceGenerationHandoffs.invoke).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(mocks.bridge.listExports.invoke).toHaveBeenCalledTimes(2));

    view.rerender(<HookProbe projectId={projectB.id} />);
    await waitFor(() => expect(latestHookResult?.project?.id).toBe(projectB.id));
    await waitFor(() => expect(mocks.bridge.listExports.invoke).toHaveBeenCalledTimes(3));

    await act(async () => {
      delayedProposals.resolve(ok([{ ...proposal(), id: 'stale_proposal' }]));
      delayedReferenceRequests.resolve(ok([{ ...referenceRequest(), id: 'stale_reference' }]));
      delayedHandoffs.resolve(ok([{ ...handoff(), handoffId: 'stale_handoff' }]));
      delayedExports.resolve(ok({ revision: 9, artifacts: [] }));
      await Promise.all([proposals, references, exports]);
    });

    expect(latestHookResult?.project?.id).toBe(projectB.id);
    expect(latestHookResult?.proposals).toEqual([]);
    expect(latestHookResult?.referenceRequests).toEqual([]);
    expect(latestHookResult?.referenceGenerationHandoffs).toEqual([]);
    expect(latestHookResult?.exportCatalog).toEqual({ revision: 1, artifacts: [] });
  });

  it('keeps export catalog authority sanitized, monotonic, and isolated from an older in-flight list', async () => {
    const listing = deferred<{ ok: true; data: StudioRendererExportCatalogV2 }>();
    mocks.bridge.listExports.invoke.mockReturnValueOnce(listing.promise);
    render(<HookProbe projectId='project_1' />);

    await waitFor(() => expect(mocks.bridge.listExports.invoke).toHaveBeenCalledTimes(1));
    const newest: StudioRendererExportCatalogV2 = {
      revision: 3,
      artifacts: [
        {
          id: 'export_new',
          sourceRevision: 3,
          shape: 'script',
          folderName: 'export_new',
          byteSize: 24,
          fileCount: 1,
          createdAt: '2026-01-01T00:00:03.000Z',
        },
      ],
    };
    act(() => {
      expect(latestHookResult?.installExportCatalog(newest)).toBe(true);
    });
    expect(latestHookResult?.exportCatalog).toEqual(newest);

    await act(async () => {
      listing.resolve(ok({ revision: 1, artifacts: [] }));
      await listing.promise;
    });
    expect(latestHookResult?.exportCatalog).toEqual(newest);

    const conflicting = {
      ...newest,
      artifacts: [{ ...newest.artifacts[0]!, byteSize: 25 }],
    };
    act(() => {
      expect(latestHookResult?.installExportCatalog(conflicting)).toBe(false);
    });
    expect(latestHookResult?.exportCatalog).toBeNull();
    expect(latestHookResult?.exportErrorMessageKey).toBe('conversation.creativeStudio.workspace.errors.storage');

    const hostile = {
      revision: 4,
      artifacts: [
        {
          ...newest.artifacts[0]!,
          managedExport: { collection: 'exports', fileName: 'private.zip' },
        },
      ],
    };
    act(() => {
      expect(latestHookResult?.installExportCatalog(hostile as unknown as StudioRendererExportCatalogV2)).toBe(false);
    });
    expect(latestHookResult?.exportCatalog).toBeNull();

    const overRetained = {
      revision: 5,
      artifacts: Array.from({ length: 6 }, (_, index) => ({
        ...newest.artifacts[0]!,
        id: `export_over_${index}`,
        createdAt: `2026-01-01T00:00:0${index}.000Z`,
      })),
    };
    act(() => {
      expect(latestHookResult?.installExportCatalog(overRetained)).toBe(false);
    });
    expect(latestHookResult?.exportCatalog).toBeNull();

    const futureSource = {
      revision: 6,
      artifacts: [{ ...newest.artifacts[0]!, id: 'export_future', sourceRevision: 4 }],
    };
    act(() => {
      expect(latestHookResult?.installExportCatalog(futureSource)).toBe(false);
    });
    expect(latestHookResult?.exportCatalog).toBeNull();
  });

  it('keeps a fresh route catalog and trails capability when project revision advances during refresh', async () => {
    render(<HookProbe projectId='project_1' />);
    await waitFor(() => expect(latestHookResult?.generationCapability?.projectRevision).toBe(3));

    const capability = deferred<ReturnType<typeof supportedCapabilityResult>>();
    mocks.bridge.getGenerationCapability.invoke.mockReturnValueOnce(capability.promise);
    let refresh!: Promise<boolean>;
    act(() => {
      refresh = latestHookResult!.refetchRoutes();
    });
    await waitFor(() => expect(mocks.bridge.getGenerationCapability.invoke).toHaveBeenCalledTimes(2));

    const changed = { ...project(), revision: 4, name: 'Progress revision' };
    mocks.bridge.getProject.invoke.mockResolvedValue(ok({ status: 'supported', project: changed }));
    mocks.bridge.projectWorkspaceStatusFixture.invoke.mockResolvedValue(ok(workspaceStatus(changed)));
    mocks.bridge.projectWorkspaceChainFixture.invoke.mockResolvedValue(ok(chainStatus(changed)));
    act(() => mocks.listeners.projectUpdated?.({ projectId: 'project_1' }));
    await waitFor(() => expect(latestHookResult?.project?.revision).toBe(4));

    const staleInput = mocks.bridge.getGenerationCapability.invoke.mock.calls[1]![0];
    await act(async () => {
      capability.resolve(supportedCapabilityResult(staleInput));
      await refresh;
    });

    await waitFor(() => expect(mocks.bridge.getGenerationCapability.invoke).toHaveBeenCalledTimes(3));
    expect(mocks.bridge.getGenerationCapability.invoke.mock.calls[2]?.[0]).toMatchObject({ expectedRevision: 4 });
    expect(mocks.bridge.listRoutes.invoke).toHaveBeenCalledTimes(2);
    expect(latestHookResult?.routeCatalog?.catalogVersion).toBe('catalog_1');
    expect(latestHookResult?.generationCapability?.projectRevision).toBe(4);
  });

  it('discards an in-flight catalog when its bound route signature changes', async () => {
    const catalog = deferred<ReturnType<typeof ok>>();
    const changed = { ...project(), revision: 4, aspectRatio: '9:16' as const, name: 'New frame' };
    mocks.bridge.listRoutes.invoke.mockReturnValue(catalog.promise);
    mocks.bridge.getProject.invoke
      .mockResolvedValueOnce(ok({ status: 'supported', project: project() }))
      .mockResolvedValue(ok({ status: 'supported', project: changed }));
    mocks.bridge.projectWorkspaceStatusFixture.invoke
      .mockResolvedValueOnce(ok(workspaceStatus(3)))
      .mockResolvedValue(ok(workspaceStatus(4)));
    mocks.bridge.projectWorkspaceChainFixture.invoke
      .mockResolvedValueOnce(ok(chainStatus(3)))
      .mockResolvedValue(ok(chainStatus(4)));

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

    const briefDialog = await openProjectDialog(BRIEF_RULES_TITLE);
    expect(
      within(briefDialog).queryByText('conversation.creativeStudio.workspace.controls.routeStatus.ready')
    ).not.toBeInTheDocument();
    expect(
      within(briefDialog).getAllByText('conversation.creativeStudio.workspace.controls.routeStatus.unavailable')
    ).toHaveLength(2);
  });

  it('invalidates paid readiness when a non-initial project refresh fails', async () => {
    mocks.bridge.getProject.invoke
      .mockResolvedValueOnce(ok({ status: 'supported', project: project() }))
      .mockResolvedValue({
        ok: false,
        error: { code: 'storage_error', messageKey: 'conversation.creativeStudio.workspace.errors.storage' },
      });

    renderStudio();
    const briefDialog = await openProjectDialog(BRIEF_RULES_TITLE);
    await waitFor(() =>
      expect(
        within(briefDialog).getAllByText('conversation.creativeStudio.workspace.controls.routeStatus.ready')
      ).toHaveLength(2)
    );
    act(() => mocks.listeners.projectUpdated?.({ projectId: 'project_1' }));

    await waitFor(() => expect(mocks.bridge.getProject.invoke).toHaveBeenCalledTimes(2));
    expect(
      within(briefDialog).getAllByText('conversation.creativeStudio.workspace.controls.routeStatus.unavailable')
    ).toHaveLength(2);
    expect(mocks.bridge.listRoutes.invoke).toHaveBeenCalledTimes(1);
  });

  it('renders not-found and storage-failure load states without mounting a workspace owner', async () => {
    mocks.bridge.getProject.invoke.mockResolvedValue(ok({ status: 'not_found', projectId: 'project_1' }));
    const first = renderStudio();
    expect(await screen.findByText('conversation.creativeStudio.workspace.project.notFound')).toBeVisible();
    expect(document.querySelector('[data-studio-director-conversation-owner]')).toBeNull();
    expect(mocks.bridge.getProjectWorkspace.invoke).toHaveBeenCalledTimes(1);
    first.unmount();

    mocks.bridge.getProjectWorkspace.invoke.mockClear();
    mocks.bridge.getProject.invoke.mockRejectedValue(new Error('offline'));
    renderStudio();
    expect(await screen.findByRole('alert')).toHaveTextContent('conversation.creativeStudio.workspace.errors.storage');
    expect(document.querySelector('[data-studio-director-conversation-owner]')).toBeNull();
    expect(mocks.bridge.getProjectWorkspace.invoke).toHaveBeenCalledTimes(2);
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
    renderStudio();

    expect(await screen.findByRole('heading', { name: 'Launch film' })).toBeVisible();
    const briefDialog = await openProjectDialog(BRIEF_RULES_TITLE);
    await waitFor(() =>
      expect(
        within(briefDialog).getAllByText('conversation.creativeStudio.workspace.controls.routeStatus.ready')
      ).toHaveLength(2)
    );
    mocks.bridge.getProjectWorkspace.invoke.mockRejectedValue(new Error('workspace offline'));
    act(() => mocks.listeners.projectUpdated?.({ projectId: 'project_1' }));

    await waitFor(() => expect(mocks.bridge.getProjectWorkspace.invoke).toHaveBeenCalledTimes(3));
    expect(screen.getByRole('heading', { name: 'Launch film' })).toBeVisible();
    expect(screen.getByText('native.proposalsFailed')).toBeVisible();
    expect(screen.getAllByText('conversation.creativeStudio.workspace.errors.storage')).toHaveLength(3);
    expect(
      within(briefDialog).getAllByText('conversation.creativeStudio.workspace.controls.routeStatus.unavailable')
    ).toHaveLength(2);
    expect(mocks.bridge.listProposals.invoke).toHaveBeenCalledTimes(1);
    expect(mocks.bridge.listReferenceRequests.invoke).toHaveBeenCalledTimes(2);
    expect(mocks.bridge.listReferenceGenerationHandoffs.invoke).toHaveBeenCalledTimes(2);
    expect(mocks.bridge.getProjectWorkspace.invoke).toHaveBeenCalledTimes(3);
    expect(mocks.bridge.listRoutes.invoke).toHaveBeenCalledTimes(1);
  });

  it('recovers one composite command failure with exactly one bounded retry', async () => {
    const authority = project();
    mocks.bridge.getProjectWorkspace.invoke.mockResolvedValueOnce({
      ok: false,
      error: { code: 'storage_error', messageKey: 'native.workspaceFailed' },
    });
    mocks.bridge.getProjectWorkspace.invoke.mockResolvedValueOnce(projectWorkspaceLoad(authority));

    renderStudio();

    expect(await screen.findByRole('heading', { name: 'Launch film' })).toBeVisible();
    expect(mocks.bridge.getProjectWorkspace.invoke).toHaveBeenCalledTimes(2);
    expect(screen.queryByText('native.workspaceFailed')).toBeNull();
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
      expect(await latestHookResult?.refetchProjectWorkspace()).toBeNull();
      await latestHookResult?.refetchProposals();
      await latestHookResult?.refetchReferences();
      expect(await latestHookResult?.refetchRoutes()).toBe(false);
      expect(await latestHookResult?.refetchExports()).toBe(false);
      await latestHookResult?.refetchAll();
    });

    expect(mocks.bridge.getProjectWorkspace.invoke).not.toHaveBeenCalled();
    expect(mocks.bridge.listProposals.invoke).not.toHaveBeenCalled();
    expect(mocks.bridge.listReferenceRequests.invoke).not.toHaveBeenCalled();
    expect(mocks.bridge.listRoutes.invoke).not.toHaveBeenCalled();
    expect(mocks.bridge.listExports.invoke).not.toHaveBeenCalled();
  });

  it('routes projected recovery retry and cancellation through exact revisioned providers', async () => {
    const projects = [3, 4, 5].map(projectWithRecovery);
    mocks.bridge.getProject.invoke
      .mockResolvedValueOnce(ok({ status: 'supported', project: projects[0]! }))
      .mockResolvedValueOnce(ok({ status: 'supported', project: projects[1]! }))
      .mockResolvedValue(ok({ status: 'supported', project: projects[2]! }));
    for (const authority of projects) {
      mocks.bridge.projectWorkspaceStatusFixture.invoke.mockResolvedValueOnce(ok(recoveryStatus(authority)));
      mocks.bridge.projectWorkspaceChainFixture.invoke.mockResolvedValueOnce(ok(chainStatus(authority)));
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

  it('rejects an incompatible imported seed against exact authorized work before invoking Main', async () => {
    const authority = projectWithAuthorizedSeedLock(3);
    mocks.bridge.getProjectWorkspace.invoke.mockResolvedValue(
      projectWorkspaceLoad(authority, authorizedSeedLockStatus(authority), chainStatus(authority))
    );
    renderStudio();
    await screen.findByRole('heading', { name: 'Launch film' });
    await waitFor(() => expect(mocks.beatPanelActions).not.toBeNull());

    let result: boolean | undefined;
    await act(async () => {
      result = await capturedBeatPanelActions().setSeedStill('shot_locked', 'imported_seed');
    });

    expect(result).toBe(false);
    expect(mocks.bridge.applyAuthoringBatch.invoke).not.toHaveBeenCalled();
    expect(
      await screen.findByText('conversation.creativeStudio.workspace.beatPanel.seeds.authorizationLocked')
    ).toBeVisible();
    expect(screen.queryByText('conversation.creativeStudio.workspace.errors.storage')).toBeNull();
  });

  it.each([
    {
      path: 'continuity',
      invoke: (actions: BeatPanelActions) => actions.reviewContinuity('shot_locked', false),
    },
    {
      path: 'Shot generation',
      invoke: (actions: BeatPanelActions) =>
        actions.reviewShot('shot_locked', [{ shotId: 'shot_locked', purpose: 'seed_still' }]),
    },
    {
      path: 'first-frame regeneration',
      invoke: (actions: BeatPanelActions) => actions.reviewSeedStill('shot_locked'),
    },
  ])('blocks the ordinary $path review path while authorized work owns the seed', async ({ invoke }) => {
    const authority = projectWithAuthorizedSeedLock(3);
    mocks.bridge.getProjectWorkspace.invoke.mockResolvedValue(
      projectWorkspaceLoad(authority, authorizedSeedLockStatus(authority), chainStatus(authority))
    );
    renderStudio();
    await screen.findByRole('heading', { name: 'Launch film' });
    await waitFor(() => expect(mocks.beatPanelActions).not.toBeNull());

    act(() => invoke(capturedBeatPanelActions()));

    expect(
      await screen.findByText('conversation.creativeStudio.workspace.beatPanel.seeds.authorizationLocked')
    ).toBeVisible();
    expect(screen.queryByText('conversation.creativeStudio.workspace.errors.storage')).toBeNull();
    expect(screen.queryByTestId('studio-spend-gate')).toBeNull();
    expect(mocks.bridge.prepareSubmission.invoke).not.toHaveBeenCalled();
    expect(mocks.bridge.confirmSubmission.invoke).not.toHaveBeenCalled();
  });

  it('opens first-frame regeneration only for an exact payable segment head', async () => {
    mockSupportedProject(projectWithHandoffShot());
    renderStudio();
    await screen.findByRole('heading', { name: 'Launch film' });
    await waitFor(() => expect(mocks.beatPanelActions).not.toBeNull());
    const actions = capturedBeatPanelActions();

    act(() => actions.reviewSeedStill('missing_shot'));
    expect(await screen.findByText('conversation.creativeStudio.workspace.controls.selectionNotPayable')).toBeVisible();
    expect(screen.queryByTestId('studio-spend-gate')).toBeNull();

    act(() => actions.reviewSeedStill('shot_3'));
    const modal = await screen.findByTestId('studio-spend-gate');
    expect(modal).toHaveAttribute('data-gate-kind', 'generation');
    await waitFor(() => expect(mocks.bridge.prepareSubmission.invoke).toHaveBeenCalledTimes(1));
  });

  it('fails first-frame regeneration closed while image capability refreshes against an unavailable route', async () => {
    const initial = projectWithHandoffShot();
    const changed = structuredClone(initial);
    changed.revision = 4;
    mocks.bridge.listRoutes.invoke.mockResolvedValue(
      ok({
        image: {
          status: 'unavailable',
          selected: null,
          selectedRoute: null,
          selectionIssue: { code: 'health' },
          options: [],
        },
        video: { status: 'ready', selected: null, selectedRoute: null, selectionIssue: null, options: [] },
        catalogVersion: 'catalog_1',
      })
    );
    mockSupportedProject(initial);
    renderStudio();
    await screen.findByRole('heading', { name: 'Launch film' });
    await waitFor(() => expect(mocks.bridge.getGenerationCapability.invoke).toHaveBeenCalledOnce());

    const capability = deferred<ReturnType<typeof supportedCapabilityResult>>();
    mocks.bridge.getGenerationCapability.invoke.mockReturnValueOnce(capability.promise);
    mockSupportedProject(changed);
    act(() => mocks.listeners.projectUpdated?.({ projectId: 'project_1' }));
    await waitFor(() => expect(mocks.bridge.getGenerationCapability.invoke).toHaveBeenCalledTimes(2));

    act(() => capturedBeatPanelActions().reviewSeedStill('shot_3'));
    expect(await screen.findByText('conversation.creativeStudio.workspace.controls.imageRouteBlocked')).toBeVisible();
    expect(screen.queryByTestId('studio-spend-gate')).toBeNull();

    const request = mocks.bridge.getGenerationCapability.invoke.mock.calls[1]![0];
    await act(async () => capability.resolve(supportedCapabilityResult(request)));
  });

  it('cancels an exact authorized seed wait once and rebuilds rejoin review from the committed revision', async () => {
    const initial = projectWithAuthorizedSeedLock(3);
    const refreshed = projectWithAuthorizedSeedLock(4);
    mocks.bridge.getProjectWorkspace.invoke
      .mockResolvedValueOnce(projectWorkspaceLoad(initial, authorizedSeedLockStatus(initial), chainStatus(initial)))
      .mockResolvedValue(
        projectWorkspaceLoad(refreshed, authorizedSeedLockStatus(refreshed, 'cancelled'), chainStatus(refreshed))
      );
    mocks.bridge.cancelWaitingCascade.invoke.mockResolvedValue(commit(4));
    mocks.bridge.prepareSubmission.invoke.mockRejectedValueOnce(new Error('stop after request capture'));
    renderStudio();
    await screen.findByRole('heading', { name: 'Launch film' });
    await waitFor(() => expect(mocks.beatPanelActions).not.toBeNull());

    let result: boolean | undefined;
    await act(async () => {
      result = await capturedBeatPanelActions().cancelAndReviewRejoin('shot_locked');
    });

    expect(result).toBe(true);
    expect(mocks.bridge.cancelWaitingCascade.invoke).toHaveBeenCalledExactlyOnceWith({
      projectId: 'project_1',
      expectedRevision: 3,
      dependentShotId: 'shot_locked',
    });
    expect(mocks.bridge.getProjectWorkspace.invoke).toHaveBeenCalledTimes(2);
    const modal = await screen.findByTestId('studio-spend-gate');
    expect(modal).toHaveAttribute('data-gate-kind', 'continuity_change');
    expect(mocks.bridge.confirmSubmission.invoke).not.toHaveBeenCalled();

    await waitFor(() =>
      expect(mocks.bridge.prepareSubmission.invoke).toHaveBeenCalledExactlyOnceWith({
        projectId: 'project_1',
        expectedRevision: 4,
        originReferenceHandoffId: null,
        baseChoices: [],
        cascadeChoices: [],
        continuityChange: { shotId: 'shot_locked', hardCut: false, requiresSeedGeneration: false },
      })
    );
    expect(mocks.bridge.confirmSubmission.invoke).not.toHaveBeenCalled();
  });

  it('reports a committed cancellation whose exact reload cannot be confirmed without opening review', async () => {
    const initial = projectWithAuthorizedSeedLock(3);
    const unexpected = projectWithAuthorizedSeedLock(5);
    mocks.bridge.getProjectWorkspace.invoke
      .mockResolvedValueOnce(projectWorkspaceLoad(initial, authorizedSeedLockStatus(initial), chainStatus(initial)))
      .mockResolvedValue(
        projectWorkspaceLoad(unexpected, authorizedSeedLockStatus(unexpected, 'cancelled'), chainStatus(unexpected))
      );
    mocks.bridge.cancelWaitingCascade.invoke.mockResolvedValue(commit(4));
    renderStudio();
    await screen.findByRole('heading', { name: 'Launch film' });
    await waitFor(() => expect(mocks.beatPanelActions).not.toBeNull());

    let result: boolean | undefined;
    await act(async () => {
      result = await capturedBeatPanelActions().cancelAndReviewRejoin('shot_locked');
    });

    expect(result).toBe(false);
    expect(mocks.bridge.cancelWaitingCascade.invoke).toHaveBeenCalledOnce();
    expect(
      await screen.findByText(
        'conversation.creativeStudio.workspace.beatPanel.recovery.cancelAndReviewRejoinUnconfirmed'
      )
    ).toBeVisible();
    expect(screen.queryByText('conversation.creativeStudio.workspace.errors.storage')).toBeNull();
    expect(screen.queryByTestId('studio-spend-gate')).toBeNull();
    expect(mocks.bridge.prepareSubmission.invoke).not.toHaveBeenCalled();
    expect(mocks.bridge.confirmSubmission.invoke).not.toHaveBeenCalled();
  });

  it('reports an unknown cancellation outcome once without retrying or opening review', async () => {
    const authority = projectWithAuthorizedSeedLock(3);
    mocks.bridge.getProjectWorkspace.invoke.mockResolvedValue(
      projectWorkspaceLoad(authority, authorizedSeedLockStatus(authority), chainStatus(authority))
    );
    mocks.bridge.cancelWaitingCascade.invoke.mockRejectedValueOnce(new Error('transport stopped after dispatch'));
    renderStudio();
    await screen.findByRole('heading', { name: 'Launch film' });
    await waitFor(() => expect(mocks.beatPanelActions).not.toBeNull());

    let result: boolean | undefined;
    await act(async () => {
      result = await capturedBeatPanelActions().cancelAndReviewRejoin('shot_locked');
    });

    expect(result).toBe(false);
    expect(mocks.bridge.cancelWaitingCascade.invoke).toHaveBeenCalledOnce();
    expect(mocks.bridge.getProjectWorkspace.invoke).toHaveBeenCalledOnce();
    expect(
      await screen.findByText(
        'conversation.creativeStudio.workspace.beatPanel.recovery.cancelAndReviewRejoinOutcomeUnknown'
      )
    ).toBeVisible();
    expect(screen.queryByText('conversation.creativeStudio.workspace.errors.storage')).toBeNull();
    expect(screen.queryByTestId('studio-spend-gate')).toBeNull();
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
    mocks.bridge.projectWorkspaceStatusFixture.invoke
      .mockResolvedValueOnce(ok(recoveryStatus(initial)))
      .mockResolvedValue(ok(recoveryStatus(imported)));
    mocks.bridge.projectWorkspaceChainFixture.invoke
      .mockResolvedValueOnce(ok(chainStatus(initial)))
      .mockResolvedValue(ok(chainStatus(imported)));

    renderStudio();
    fireEvent.click(await screen.findByRole('row', { name: /Recovery Beat/ }));
    const seedCard = document.querySelector<HTMLElement>('article[data-shot-id="upstream_seed"]');
    expect(seedCard).not.toBeNull();
    const importButton = within(seedCard!).getByRole('button', {
      name: 'conversation.creativeStudio.workspace.beatPanel.firstFrames.import',
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
    expect(mocks.bridge.projectWorkspaceStatusFixture.invoke).toHaveBeenCalledTimes(1);
    expect(mocks.bridge.projectWorkspaceChainFixture.invoke).toHaveBeenCalledTimes(1);

    mocks.bridge.importSeedStill.invoke.mockResolvedValueOnce(
      ok({ status: 'imported' as const, assetId: 'imported_seed', projectRevision: 4 })
    );
    fireEvent.click(importButton);
    await waitFor(() => expect(mocks.bridge.importSeedStill.invoke).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(mocks.bridge.getProject.invoke).toHaveBeenCalledTimes(2));
    expect(mocks.bridge.projectWorkspaceStatusFixture.invoke).toHaveBeenCalledTimes(2);
    expect(mocks.bridge.projectWorkspaceChainFixture.invoke).toHaveBeenCalledTimes(2);
    expect(mocks.bridge.importSeedStill.invoke).toHaveBeenLastCalledWith({
      projectId: 'project_1',
      expectedRevision: 3,
      shotId: 'upstream_seed',
    });
    expect(document.querySelector('[data-asset-id="imported_seed"]')).not.toBeNull();
  });

  it('routes Cut media changes and project-menu export through exact revisions without paid work', async () => {
    const projectAt = (revision: number): StudioRendererProjectV2 => {
      const value = projectWithHandoffShot();
      value.revision = revision;
      const current = recoveryAsset('audio_current', null, 'audio');
      current.durationSeconds = 20;
      const old = recoveryAsset('audio_old', null, 'audio');
      old.durationSeconds = 18;
      value.assets[current.id] = current;
      value.assets[old.id] = old;
      value.bedAssetId = revision >= 5 ? current.id : null;
      if (revision >= 8) {
        const imported = recoveryAsset('audio_imported', null, 'audio');
        imported.durationSeconds = 22;
        value.assets[imported.id] = imported;
        value.bedAssetId = imported.id;
      }
      return value;
    };
    const projects = [3, 4, 5, 6, 7, 8].map(projectAt);
    mocks.bridge.getProject.invoke
      .mockReset()
      .mockResolvedValueOnce(ok({ status: 'supported', project: projects[0]! }))
      .mockResolvedValueOnce(ok({ status: 'supported', project: projects[1]! }))
      .mockResolvedValueOnce(ok({ status: 'supported', project: projects[2]! }))
      .mockResolvedValueOnce(ok({ status: 'supported', project: projects[3]! }))
      .mockResolvedValueOnce(ok({ status: 'supported', project: projects[4]! }))
      .mockResolvedValue(ok({ status: 'supported', project: projects[5]! }));
    mocks.bridge.projectWorkspaceStatusFixture.invoke
      .mockReset()
      .mockResolvedValueOnce(ok(workspaceStatus(projects[0]!)))
      .mockResolvedValueOnce(ok(workspaceStatus(projects[1]!)))
      .mockResolvedValueOnce(ok(workspaceStatus(projects[2]!)))
      .mockResolvedValueOnce(ok(workspaceStatus(projects[3]!)))
      .mockResolvedValueOnce(ok(workspaceStatus(projects[4]!)))
      .mockResolvedValue(ok(workspaceStatus(projects[5]!)));
    mocks.bridge.projectWorkspaceChainFixture.invoke
      .mockReset()
      .mockResolvedValueOnce(ok(chainStatus(projects[0]!)))
      .mockResolvedValueOnce(ok(chainStatus(projects[1]!)))
      .mockResolvedValueOnce(ok(chainStatus(projects[2]!)))
      .mockResolvedValueOnce(ok(chainStatus(projects[3]!)))
      .mockResolvedValueOnce(ok(chainStatus(projects[4]!)))
      .mockResolvedValue(ok(chainStatus(projects[5]!)));
    mocks.bridge.applyAuthoringBatch.invoke.mockResolvedValue(commit(4));
    mocks.bridge.setBed.invoke.mockResolvedValue(commit(5));
    mocks.bridge.detachBedAudio.invoke.mockResolvedValue(ok({ status: 'detached', projectRevision: 6 }));
    mocks.bridge.importBedAudio.invoke
      .mockResolvedValueOnce(ok({ status: 'cancelled' as const }))
      .mockResolvedValueOnce(ok({ status: 'imported' as const, assetId: 'audio_imported', projectRevision: 7 }));
    const catalog1: StudioRendererExportCatalogV2 = { revision: 1, artifacts: [] };
    const artifact = {
      id: 'export_1',
      sourceRevision: 7,
      shape: 'editor_folder' as const,
      folderName: 'editor-folder-20260101-000008-000-0123456789abcdef',
      byteSize: 64,
      fileCount: 1,
      createdAt: '2026-01-01T00:00:08.000Z',
    };
    const catalog2: StudioRendererExportCatalogV2 = { revision: 2, artifacts: [artifact] };
    const catalog3: StudioRendererExportCatalogV2 = { revision: 3, artifacts: [artifact] };
    mocks.bridge.listExports.invoke.mockReset().mockResolvedValueOnce(ok(catalog1)).mockResolvedValue(ok(catalog3));
    mocks.bridge.createExport.invoke.mockResolvedValue(ok(catalog2));
    mocks.bridge.copyExport.invoke.mockResolvedValue(ok({ status: 'cancelled' as const }));
    mocks.bridge.revealExport.invoke.mockResolvedValue(ok({ status: 'revealed' as const }));

    renderStudio('/studio/project_1/cut');
    await screen.findByRole('heading', { name: 'Launch film' });
    await waitFor(() => expect(mocks.cutActions).not.toBeNull());
    await waitFor(() => expect(mocks.bridge.listExports.invoke).toHaveBeenCalledWith({ projectId: 'project_1' }));
    const cutApi = capturedCutActions();
    const projectMenu = capturedProjectMenuProps();

    let importResult: Awaited<ReturnType<CutActions['importBedAudio']>> | undefined;
    await act(async () => {
      importResult = await cutApi.importBedAudio();
    });
    expect(importResult).toBe('cancelled');
    expect(mocks.bridge.importBedAudio.invoke).toHaveBeenLastCalledWith({
      projectId: 'project_1',
      expectedRevision: 3,
    });
    expect(mocks.bridge.getProject.invoke).toHaveBeenCalledTimes(1);

    await expectSuccessfulBeatPanelAction(() => cutApi.reorderBeats(['beat_1']));
    expect(mocks.bridge.applyAuthoringBatch.invoke).toHaveBeenLastCalledWith({
      projectId: 'project_1',
      expectedRevision: 3,
      operations: [{ kind: 'reorder_beats', beatOrder: ['beat_1'] }],
    });
    await expectSuccessfulBeatPanelAction(() => cutApi.setBed('audio_current'));
    expect(mocks.bridge.setBed.invoke).toHaveBeenLastCalledWith({
      projectId: 'project_1',
      expectedRevision: 4,
      assetId: 'audio_current',
    });
    await expectSuccessfulBeatPanelAction(() => cutApi.detachBedAudio('audio_old'));
    expect(mocks.bridge.detachBedAudio.invoke).toHaveBeenLastCalledWith({
      projectId: 'project_1',
      expectedRevision: 5,
      assetId: 'audio_old',
    });
    await act(async () => {
      importResult = await cutApi.importBedAudio();
    });
    expect(importResult).toBe('imported');
    expect(mocks.bridge.importBedAudio.invoke).toHaveBeenLastCalledWith({
      projectId: 'project_1',
      expectedRevision: 6,
    });

    const projectReadsBeforeExports = mocks.bridge.getProject.invoke.mock.calls.length;
    await act(async () => {
      await expect(projectMenu.createEditorFolder()).resolves.toEqual({ ok: true, catalog: catalog2 });
    });
    expect(mocks.bridge.createExport.invoke).toHaveBeenLastCalledWith({
      projectId: 'project_1',
      expectedRevision: 7,
      expectedCatalogRevision: 1,
      shape: 'editor_folder',
    });
    expect(mocks.bridge.getProject.invoke).toHaveBeenCalledTimes(projectReadsBeforeExports);
    await waitFor(() => expect(capturedProjectMenuProps().exportCatalog?.revision).toBe(2));

    await expect(capturedProjectMenuProps().revealEditorFolder('export_1')).resolves.toEqual({ ok: true });
    expect(mocks.bridge.revealExport.invoke).toHaveBeenLastCalledWith({
      projectId: 'project_1',
      expectedCatalogRevision: 2,
      artifactId: 'export_1',
    });
    expect(mocks.bridge.prepareSubmission.invoke).not.toHaveBeenCalled();
    expect(mocks.bridge.confirmSubmission.invoke).not.toHaveBeenCalled();
  });

  it('keeps Cut media and project-menu export boundaries fail-closed', async () => {
    const authority = projectWithHandoffShot();
    const selectedBed = recoveryAsset('audio_current', null, 'audio');
    selectedBed.durationSeconds = 20;
    const detachedBed = recoveryAsset('audio_other', null, 'audio');
    detachedBed.durationSeconds = 18;
    authority.assets[selectedBed.id] = selectedBed;
    authority.assets[detachedBed.id] = detachedBed;
    authority.bedAssetId = selectedBed.id;
    mockSupportedProject(authority);
    const artifact = {
      id: 'export_1',
      sourceRevision: authority.revision,
      shape: 'editor_folder' as const,
      folderName: 'editor-folder-20260101-000008-000-0123456789abcdef',
      byteSize: 64,
      fileCount: 1,
      createdAt: '2026-01-01T00:00:08.000Z',
    };
    const catalog: StudioRendererExportCatalogV2 = { revision: 1, artifacts: [artifact] };
    mocks.bridge.listExports.invoke
      .mockResolvedValueOnce(ok(catalog))
      .mockResolvedValue({ ok: false, error: { code: 'storage_error', messageKey: 'native.exportsFailed' } });
    mocks.bridge.importBedAudio.invoke
      .mockResolvedValueOnce({ ok: false, error: { code: 'storage_error', messageKey: 'native.importFailed' } })
      .mockResolvedValueOnce(
        ok({ status: 'imported' as const, assetId: 'audio_imported', projectRevision: authority.revision + 1 })
      );
    mocks.bridge.detachBedAudio.invoke
      .mockResolvedValueOnce({ ok: false, error: { code: 'storage_error', messageKey: 'native.detachFailed' } })
      .mockResolvedValueOnce(ok({ status: 'detached' as const, projectRevision: authority.revision + 1 }));
    mocks.bridge.createExport.invoke
      .mockResolvedValueOnce({ ok: false, error: { code: 'storage_error', messageKey: 'native.exportFailed' } })
      .mockResolvedValueOnce(ok({ revision: 3, artifacts: [{ ...artifact, sourceRevision: 99 }] }));
    mocks.bridge.copyExport.invoke.mockResolvedValue({
      ok: false,
      error: { code: 'storage_error', messageKey: 'native.copyFailed' },
    });
    mocks.bridge.revealExport.invoke.mockResolvedValue({
      ok: false,
      error: { code: 'storage_error', messageKey: 'native.revealFailed' },
    });

    renderStudio('/studio/project_1/cut');
    await screen.findByRole('heading', { name: 'Launch film' });
    await waitFor(() => expect(mocks.cutActions).not.toBeNull());
    const cut = capturedCutActions();
    const projectMenu = capturedProjectMenuProps();

    await expect(invokeStudioAction(cut.importBedAudio)).resolves.toBe('failed');
    await expect(invokeStudioAction(cut.importBedAudio)).resolves.toBe('failed');
    await expect(invokeStudioAction(() => cut.detachBedAudio('audio_current'))).resolves.toBe(false);
    await expect(invokeStudioAction(() => cut.detachBedAudio('audio_other'))).resolves.toBe(false);
    await expect(invokeStudioAction(() => cut.detachBedAudio('audio_other'))).resolves.toBe(false);
    await expect(invokeStudioAction(projectMenu.createEditorFolder)).resolves.toEqual({
      ok: false,
      messageKey: 'conversation.creativeStudio.workspace.editorFolderExport.errors.mediaUnavailable',
    });
    await expect(invokeStudioAction(() => projectMenu.revealEditorFolder('missing_export'))).resolves.toEqual({
      ok: false,
      messageKey: 'conversation.creativeStudio.workspace.editorFolderExport.errors.artifactUnavailable',
    });
    await expect(invokeStudioAction(() => projectMenu.revealEditorFolder('export_1'))).resolves.toEqual({
      ok: false,
      messageKey: 'native.revealFailed',
    });
    await expect(invokeStudioAction(projectMenu.createEditorFolder)).resolves.toEqual({
      ok: true,
      catalog: { revision: 3, artifacts: [{ ...artifact, sourceRevision: 99 }] },
    });

    expect(mocks.bridge.getProject.invoke.mock.calls.length).toBeGreaterThan(1);
    expect(mocks.bridge.createExport.invoke).toHaveBeenLastCalledWith({
      projectId: 'project_1',
      expectedRevision: 3,
      expectedCatalogRevision: 1,
      shape: 'editor_folder',
    });
  });

  it('rejects a stale renderer hard-cut batch before it reaches the native bridge', async () => {
    renderStudio();
    await screen.findByRole('heading', { name: 'Launch film' });
    await waitFor(() => expect(mocks.workspaceMutations).not.toBeNull());
    const staleApplyAuthoring = capturedWorkspaceMutations().applyAuthoring as unknown as (
      operations: Array<
        { kind: 'set_brief'; brief: string } | { kind: 'set_hard_cut'; shotId: string; hardCut: boolean }
      >
    ) => Promise<boolean>;

    let result: boolean | undefined;
    await act(async () => {
      result = await staleApplyAuthoring([
        { kind: 'set_brief', brief: 'Do not partially apply this batch.' },
        { kind: 'set_hard_cut', shotId: 'shot_0', hardCut: true },
      ]);
    });

    expect(result).toBe(false);
    expect(mocks.bridge.applyAuthoringBatch.invoke).not.toHaveBeenCalled();
  });

  it('routes every captured Beat Panel edit and lifecycle action through revision-pinned providers', async () => {
    const authority = projectWithDraftBatch(1);
    let revision = authority.revision;
    mocks.bridge.getProject.invoke.mockImplementation(async () =>
      ok({ status: 'supported' as const, project: { ...authority, revision } })
    );
    mocks.bridge.projectWorkspaceStatusFixture.invoke.mockImplementation(async () =>
      ok(workspaceStatus({ ...authority, revision }))
    );
    mocks.bridge.projectWorkspaceChainFixture.invoke.mockImplementation(async () =>
      ok(chainStatus({ ...authority, revision }))
    );
    const nextCommit = async () => {
      revision += 1;
      return commit(revision);
    };
    mocks.bridge.applyAuthoringBatch.invoke.mockImplementation(nextCommit);
    mocks.bridge.parkShot.invoke.mockImplementation(nextCommit);
    mocks.bridge.parkBeat.invoke.mockImplementation(nextCommit);
    mocks.bridge.restoreBeat.invoke.mockImplementation(nextCommit);
    mocks.bridge.restoreShot.invoke.mockImplementation(nextCommit);
    mocks.bridge.reorderBin.invoke.mockImplementation(nextCommit);

    renderStudio();
    await screen.findByRole('heading', { name: 'Launch film' });
    await waitFor(() => expect(mocks.beatPanelActions).not.toBeNull());
    const actions = capturedBeatPanelActions();
    const board = capturedBoardActions();

    const duplicateUpdates = [
      { shotId: 'shot_0', changes: { shootingScript: 'First duplicate' } },
      { shotId: 'shot_0', changes: { shootingScript: 'Second duplicate' } },
    ] as const;
    expect(await actions.saveShot(duplicateUpdates)).toBe(false);
    const oversizedUpdates = Array.from({ length: 33 }, (_, index) => ({
      shotId: `shot_${index}`,
      changes: { shootingScript: `Shot ${index}` },
    })) as unknown as Parameters<BeatPanelActions['saveShot']>[0];
    expect(await actions.saveShot(oversizedUpdates)).toBe(false);
    expect(mocks.bridge.applyAuthoringBatch.invoke).not.toHaveBeenCalled();

    await expectSuccessfulBeatPanelAction(() =>
      actions.saveBeat('beat_0', { story: 'Revised moonlit story', targetSeconds: 8 })
    );
    await expectSuccessfulBeatPanelAction(() =>
      actions.saveShot([
        {
          shotId: 'shot_0',
          changes: { shootingScript: 'Revised shooting script', durationSeconds: 8 },
        },
      ])
    );
    expect(actions).not.toHaveProperty('setHardCut');
    await expectSuccessfulBeatPanelAction(() => actions.setSeedStill('shot_0', 'seed_asset'));
    await expectSuccessfulBeatPanelAction(() => actions.dismissSeedStill('shot_0', 'seed_asset'));
    await expectSuccessfulBeatPanelAction(() => actions.selectVideoTake('shot_0', 'video_old'));
    await expectSuccessfulBeatPanelAction(() => actions.removeVideoTake('shot_0', 'video_old'));
    await expectSuccessfulBeatPanelAction(() => actions.trimShot('shot_0', 1, 2));
    await expectSuccessfulBeatPanelAction(() => actions.reorderShots('beat_0', ['shot_1', 'shot_0']));
    expect(actions).not.toHaveProperty('redetachLine');
    expect(actions).not.toHaveProperty('restoreLine');
    expect(actions).not.toHaveProperty('selectTake');
    expect(actions).not.toHaveProperty('parkTake');
    expect(actions).not.toHaveProperty('addAlternateTake');
    expect(actions).not.toHaveProperty('restoreTake');
    await expectSuccessfulBeatPanelAction(() => actions.parkShot('shot_0'));
    await expectSuccessfulBeatPanelAction(() => actions.parkBeat('beat_0'));
    await expectSuccessfulBeatPanelAction(() => board.reorderBeats(['beat_1', 'beat_0']));
    await expectSuccessfulBeatPanelAction(() => board.restoreBeat('beat_2', 'beat_1'));
    await expectSuccessfulBeatPanelAction(() => board.restoreShot('shot_2', 'shot_1'));
    expect(board).not.toHaveProperty('restoreTake');
    await expectSuccessfulBeatPanelAction(() =>
      board.reorderBin([
        { kind: 'beat', beatId: 'beat_2', reason: 'lifted' },
        { kind: 'shot', beatId: 'beat_0', shotId: 'shot_2', reason: 'lifted' },
      ])
    );

    expect(mocks.bridge.applyAuthoringBatch.invoke.mock.calls.map(([request]) => request)).toEqual([
      {
        projectId: 'project_1',
        expectedRevision: 3,
        operations: [
          {
            kind: 'edit_beat',
            beatId: 'beat_0',
            changes: { story: 'Revised moonlit story', targetSeconds: 8 },
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
            changes: { shootingScript: 'Revised shooting script', durationSeconds: 8 },
          },
        ],
      },
      {
        projectId: 'project_1',
        expectedRevision: 5,
        operations: [{ kind: 'set_seed_still', shotId: 'shot_0', assetId: 'seed_asset' }],
      },
      {
        projectId: 'project_1',
        expectedRevision: 6,
        operations: [{ kind: 'dismiss_seed_still', shotId: 'shot_0', assetId: 'seed_asset' }],
      },
      {
        projectId: 'project_1',
        expectedRevision: 7,
        operations: [{ kind: 'select_video_take', shotId: 'shot_0', assetId: 'video_old' }],
      },
      {
        projectId: 'project_1',
        expectedRevision: 8,
        operations: [{ kind: 'remove_video_take', shotId: 'shot_0', assetId: 'video_old' }],
      },
      {
        projectId: 'project_1',
        expectedRevision: 9,
        operations: [{ kind: 'trim_shot', shotId: 'shot_0', trimInSeconds: 1, trimOutSeconds: 2 }],
      },
      {
        projectId: 'project_1',
        expectedRevision: 10,
        operations: [{ kind: 'reorder_shots', beatId: 'beat_0', shotOrder: ['shot_1', 'shot_0'] }],
      },
      {
        projectId: 'project_1',
        expectedRevision: 13,
        operations: [{ kind: 'reorder_beats', beatOrder: ['beat_1', 'beat_0'] }],
      },
    ]);
    expect(mocks.bridge.parkShot.invoke).toHaveBeenCalledWith({
      projectId: 'project_1',
      expectedRevision: 11,
      shotId: 'shot_0',
    });
    expect(mocks.bridge.parkBeat.invoke).toHaveBeenCalledWith({
      projectId: 'project_1',
      expectedRevision: 12,
      beatId: 'beat_0',
    });
    expect(mocks.bridge.restoreBeat.invoke).toHaveBeenCalledWith({
      projectId: 'project_1',
      expectedRevision: 14,
      beatId: 'beat_2',
      beforeBeatId: 'beat_1',
    });
    expect(mocks.bridge.restoreShot.invoke).toHaveBeenCalledWith({
      projectId: 'project_1',
      expectedRevision: 15,
      shotId: 'shot_2',
      beforeShotId: 'shot_1',
    });
    expect(mocks.bridge.reorderBin.invoke).toHaveBeenCalledWith({
      projectId: 'project_1',
      expectedRevision: 16,
      bin: [
        { kind: 'beat', beatId: 'beat_2', reason: 'lifted' },
        { kind: 'shot', beatId: 'beat_0', shotId: 'shot_2', reason: 'lifted' },
      ],
    });
    expect(revision).toBe(17);
  });

  it('projects malformed topology defensively through both render and close-save traversal', async () => {
    const malformed = projectWithDraftBatch(1);
    malformed.beatOrder.unshift('missing_beat');
    malformed.beats.beat_0!.shotOrder.unshift('missing_shot');
    malformed.referencePlanStatus = 'planned';
    malformed.referenceOrder = ['missing_reference'];
    mockSupportedProject(malformed);

    renderStudio();
    await screen.findByRole('heading', { name: 'Launch film' });
    let saved: { saved: boolean } | undefined;
    await act(async () => {
      saved = await mocks.closeHandlers.flushUnsavedWork?.();
    });

    expect(saved).toEqual({ saved: true });
    expect(mocks.bridge.applyAuthoringBatch.invoke).not.toHaveBeenCalled();
  });

  it('applies view defaults without remounting and returns focus before hiding the Director', async () => {
    renderStudio('/studio/project_1/table');
    await screen.findByRole('heading', { name: 'Launch film' });
    const toggle = document.querySelector<HTMLButtonElement>('[data-studio-director-toggle]')!;
    const content = document.getElementById(toggle.getAttribute('aria-controls')!)!;
    const owner = document.querySelector('[data-studio-director-conversation-owner]');
    const focusTarget = within(content).getByText('Director focus target');

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(content).toHaveAttribute('aria-hidden', 'false');
    expect(content).not.toHaveAttribute('inert');
    expect(screen.queryByRole('separator')).not.toBeNull();

    focusTarget.focus();
    fireEvent.click(screen.getByRole('link', { name: 'conversation.creativeStudio.workspace.views.board' }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/studio/project_1/board'));
    await waitFor(() => expect(toggle).toHaveAttribute('aria-expanded', 'false'));

    expect(document.getElementById(toggle.getAttribute('aria-controls')!)).toBe(content);
    expect(document.querySelector('[data-studio-director-conversation-owner]')).toBe(owner);
    expect(content).toHaveAttribute('aria-hidden', 'true');
    expect(content).toHaveAttribute('inert');
    expect(screen.queryByRole('separator')).toBeNull();
    expect(document.activeElement).toBe(toggle);
  });

  it('restores a manual rail choice only for its project view during live navigation', async () => {
    renderStudio('/studio/project_1/board');
    await screen.findByRole('heading', { name: 'Launch film' });
    const toggle = document.querySelector<HTMLButtonElement>('[data-studio-director-toggle]')!;
    const content = document.getElementById(toggle.getAttribute('aria-controls')!)!;
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(toggle);
    await waitFor(() => expect(content).toHaveAttribute('aria-hidden', 'false'));
    expect(window.localStorage.getItem(railPreferenceKey('project_1', 'board'))).toBe('false');

    fireEvent.click(screen.getByRole('link', { name: 'conversation.creativeStudio.workspace.views.cut' }));
    await waitFor(() => expect(toggle).toHaveAttribute('aria-expanded', 'false'));
    expect(content).toHaveAttribute('inert');

    fireEvent.click(screen.getByRole('link', { name: 'conversation.creativeStudio.workspace.views.board' }));
    await waitFor(() => expect(toggle).toHaveAttribute('aria-expanded', 'true'));
    expect(content).not.toHaveAttribute('inert');

    fireEvent.click(screen.getByRole('link', { name: 'conversation.creativeStudio.workspace.views.table' }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/studio/project_1/table'));
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
  });

  it('sizes the Director rail from the keyboard through an announced separator', async () => {
    renderStudio();
    await screen.findByRole('heading', { name: 'Launch film' });

    const resizer = await screen.findByRole('separator', {
      name: 'conversation.creativeStudio.workspace.director.resize',
    });
    expect(resizer).toHaveAttribute('aria-orientation', 'vertical');
    const before = Number(resizer.getAttribute('aria-valuenow'));
    expect(before).toBeGreaterThan(0);

    fireEvent.keyDown(resizer, { key: 'ArrowRight' });
    await waitFor(() => expect(Number(resizer.getAttribute('aria-valuenow'))).toBeGreaterThan(before));

    // The pane itself follows the value, not just the announcement.
    const rail = document.querySelector<HTMLElement>('[data-studio-director-rail]');
    expect(rail?.style.inlineSize).toBe(`${resizer.getAttribute('aria-valuenow')}px`);

    fireEvent.keyDown(resizer, { key: 'Home' });
    await waitFor(() => expect(resizer.getAttribute('aria-valuenow')).toBe(resizer.getAttribute('aria-valuemin')));
  });

  it('hides the rail separator when the rail is collapsed', async () => {
    renderStudio();
    await screen.findByRole('heading', { name: 'Launch film' });
    expect(screen.queryByRole('separator')).not.toBeNull();

    fireEvent.click(document.querySelector<HTMLButtonElement>('[data-studio-director-toggle]')!);
    // A pane with no width to give has nothing to drag.
    await waitFor(() => expect(screen.queryByRole('separator')).toBeNull());
  });

  it('reveals reviewed requests without replacing a manually closed rail preference', async () => {
    mockSupportedProject(projectWithHandoffShot());
    renderStudio();
    await screen.findByRole('heading', { name: 'Launch film' });
    await waitFor(() => expect(mocks.beatPanelActions).not.toBeNull());
    const actions = capturedBeatPanelActions();
    // The app bar carries the real control, so this drives that rather than an injected stand-in.
    const toggle = document.querySelector<HTMLButtonElement>('[data-studio-director-toggle]');
    expect(toggle).not.toBeNull();
    // Collapse it first: a request made while the rail is shut has to reopen it.
    fireEvent.click(toggle!);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(window.localStorage.getItem(railPreferenceKey('project_1', 'table'))).toBe('true');

    act(() => actions.requestResplit('beat_1'));
    await waitFor(() => expect(document.activeElement).toBe(toggle));
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(window.localStorage.getItem(railPreferenceKey('project_1', 'table'))).toBe('true');
    expect(screen.getByText('conversation.creativeStudio.workspace.beatPanel.directorRequestHint')).toBeVisible();

    // Now open, a further request waits for the panel-closing commit before moving focus. Focusing
    // synchronously would let Arco's still-mounted modal focus lock pull it back into the panel.
    const focusTarget = document.querySelector<HTMLElement>('[data-studio-director-focus-target]')!;
    focusTarget.focus();
    let focusDuringRequest: Element | null = null;
    act(() => {
      actions.requestResplit('beat_1');
      focusDuringRequest = document.activeElement;
    });
    expect(focusDuringRequest).toBe(focusTarget);
    await waitFor(() => expect(document.activeElement).toBe(toggle));
    expect(window.localStorage.getItem(railPreferenceKey('project_1', 'table'))).toBe('true');

    fireEvent.click(screen.getByRole('link', { name: 'conversation.creativeStudio.workspace.views.board' }));
    await waitFor(() => expect(toggle).toHaveAttribute('aria-expanded', 'false'));
    fireEvent.click(screen.getByRole('link', { name: 'conversation.creativeStudio.workspace.views.table' }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/studio/project_1/table'));
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('ignores a reviewed-request reveal captured for a view that is no longer active', async () => {
    mockSupportedProject(projectWithHandoffShot());
    renderStudio();
    await screen.findByRole('heading', { name: 'Launch film' });
    await waitFor(() => expect(mocks.beatPanelActions).not.toBeNull());
    const tableActions = capturedBeatPanelActions();

    fireEvent.click(screen.getByRole('link', { name: 'conversation.creativeStudio.workspace.views.board' }));
    const toggle = document.querySelector<HTMLButtonElement>('[data-studio-director-toggle]')!;
    await waitFor(() => expect(toggle).toHaveAttribute('aria-expanded', 'false'));

    act(() => tableActions.requestResplit('beat_1'));
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('conversation.creativeStudio.workspace.beatPanel.directorRequestHint')).toBeNull();
  });

  it('keeps captured seed imports fail-closed across native, transport, stale, and concurrent outcomes', async () => {
    const authority = projectWithDraftBatch(1);
    mockSupportedProject(authority);
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

  it('persists a captured poster only for the exact projected current video', async () => {
    const authority = projectWithRecovery();
    mockSupportedProject(authority);
    mocks.bridge.persistCapturedPoster.invoke.mockResolvedValue(
      ok(recoveryAsset('captured_poster', 'upstream_take', 'image'))
    );
    renderStudio();
    await screen.findByRole('heading', { name: 'Launch film' });
    await waitFor(() => expect(mocks.beatPanelActions).not.toBeNull());
    const actions = capturedBeatPanelActions();
    const capture = {
      shotId: 'upstream_take',
      videoAssetId: 'take_asset',
      dataUrl: 'data:image/png;base64,cG9zdGVy',
      width: 1280,
      height: 720,
    };

    await expect(invokeStudioAction(() => actions.persistCapturedPoster(capture))).resolves.toBe(true);
    expect(mocks.bridge.persistCapturedPoster.invoke).toHaveBeenCalledWith({
      projectId: authority.id,
      ...capture,
    });

    await expect(
      invokeStudioAction(() => actions.persistCapturedPoster({ ...capture, videoAssetId: 'superseded_video' }))
    ).resolves.toBe(false);
    expect(mocks.bridge.persistCapturedPoster.invoke).toHaveBeenCalledTimes(1);
  });

  it('rejects malformed reviewed choice graphs at the captured Beat Panel boundary', async () => {
    mockSupportedProject(projectWithHandoffShot());
    renderStudio();
    await screen.findByRole('heading', { name: 'Launch film' });
    await waitFor(() => expect(mocks.beatPanelActions).not.toBeNull());
    const actions = capturedBeatPanelActions();
    const validChoices = () =>
      [
        { shotId: 'shot_3', purpose: 'seed_still' as const },
        { shotId: 'shot_3', purpose: 'video_take' as const },
      ] as const;

    act(() => actions.reviewShot('missing_shot', validChoices()));
    act(() =>
      actions.reviewShot('shot_3', [validChoices()[0]] as unknown as Parameters<BeatPanelActions['reviewShot']>[1])
    );
    for (const choices of [
      [{ ...validChoices()[0], shotId: 'shot_other' }, validChoices()[1]],
      [{ ...validChoices()[0], purpose: 'video_take' as const }, validChoices()[1]],
      [{ ...validChoices()[0], generationCount: 1 }, validChoices()[1]],
      [validChoices()[0], { ...validChoices()[1], unexpected: 'field' }],
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
      'shot.shot_0.shootingScript': { baseValue: 'Shot 1', value: 'Unsaved local script' },
    });
    mockSupportedProject(draftedProject);
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

  it('accepts the one exact current proposal from human Director chat without entering the spend gate', async () => {
    mocks.bridge.listProposals.invoke.mockResolvedValueOnce(ok([proposal()])).mockResolvedValue(ok([]));
    renderStudio();

    await screen.findByTestId('studio-proposal-proposal_1');
    await act(async () => capturedDirectorProposalIntent()('accept'));

    expect(mocks.bridge.acceptProposal.invoke).toHaveBeenCalledWith({
      projectId: 'project_1',
      proposalId: 'proposal_1',
    });
    expect(mocks.bridge.rejectProposal.invoke).not.toHaveBeenCalled();
    expect(await screen.findByText('conversation.creativeStudio.workspace.proposals.chatAccepted')).toBeVisible();
    expect(mocks.bridge.prepareSubmission.invoke).not.toHaveBeenCalled();
    expect(mocks.bridge.confirmSubmission.invoke).not.toHaveBeenCalled();
  });

  it('rejects the one exact current proposal from human Director chat', async () => {
    mocks.bridge.listProposals.invoke.mockResolvedValueOnce(ok([proposal()])).mockResolvedValue(ok([]));
    renderStudio();

    await screen.findByTestId('studio-proposal-proposal_1');
    await act(async () => capturedDirectorProposalIntent()('reject'));

    expect(mocks.bridge.rejectProposal.invoke).toHaveBeenCalledWith({
      projectId: 'project_1',
      proposalId: 'proposal_1',
    });
    expect(mocks.bridge.acceptProposal.invoke).not.toHaveBeenCalled();
    expect(await screen.findByText('conversation.creativeStudio.workspace.proposals.chatRejected')).toBeVisible();
  });

  it('fails closed when Director chat has no pending proposal', async () => {
    renderStudio();
    await screen.findByRole('heading', { name: 'Launch film' });
    await waitFor(() => expect(mocks.bridge.listProposals.invoke).toHaveBeenCalledTimes(1));

    await act(async () => capturedDirectorProposalIntent()('accept'));

    expect(await screen.findByText('conversation.creativeStudio.workspace.proposals.chatNoPending')).toBeVisible();
    expect(mocks.bridge.acceptProposal.invoke).not.toHaveBeenCalled();
    expect(mocks.bridge.rejectProposal.invoke).not.toHaveBeenCalled();
  });

  it('fails closed when Director chat has more than one pending proposal', async () => {
    mocks.bridge.listProposals.invoke.mockResolvedValue(
      ok([proposal(), { ...proposal(), id: 'proposal_2', createdAt: '2026-01-01T00:00:02.000Z' }])
    );
    renderStudio();
    await screen.findByTestId('studio-proposal-proposal_2');

    await act(async () => capturedDirectorProposalIntent()('accept'));

    expect(
      await screen.findByText('conversation.creativeStudio.workspace.proposals.chatMultiplePending')
    ).toBeVisible();
    expect(mocks.bridge.acceptProposal.invoke).not.toHaveBeenCalled();
    expect(mocks.bridge.rejectProposal.invoke).not.toHaveBeenCalled();
  });

  it('fails closed while another reviewed proposal action is in progress', async () => {
    mocks.bridge.listProposals.invoke.mockResolvedValue(ok([proposal()]));
    mocks.bridge.acceptProposal.invoke.mockReturnValue(new Promise(() => {}));
    renderStudio();
    fireEvent.click(
      await screen.findByRole('button', { name: 'conversation.creativeStudio.workspace.proposals.accept' })
    );
    await waitFor(() => expect(mocks.bridge.acceptProposal.invoke).toHaveBeenCalledTimes(1));

    await act(async () => capturedDirectorProposalIntent()('reject'));

    expect(
      screen.getAllByText('conversation.creativeStudio.workspace.proposals.chatDecisionBusy').length
    ).toBeGreaterThan(0);
    expect(mocks.bridge.rejectProposal.invoke).not.toHaveBeenCalled();
  });

  it('latches a proposal decision synchronously against a re-entrant chat decision', async () => {
    const acceptance = deferred<{
      ok: true;
      data: {
        proposal: StudioRendererProposalV2;
        project: StudioRendererProjectV2;
        applied: boolean;
      };
    }>();
    mocks.bridge.listProposals.invoke.mockResolvedValueOnce(ok([proposal()])).mockResolvedValue(ok([]));
    mocks.bridge.acceptProposal.invoke.mockReturnValue(acceptance.promise);
    renderStudio();
    await screen.findByTestId('studio-proposal-proposal_1');

    let firstDecision!: Promise<void>;
    await act(async () => {
      firstDecision = capturedDirectorProposalIntent()('accept');
      await capturedDirectorProposalIntent()('reject');
    });

    expect(mocks.bridge.acceptProposal.invoke).toHaveBeenCalledTimes(1);
    expect(mocks.bridge.rejectProposal.invoke).not.toHaveBeenCalled();
    expect(
      screen.getAllByText('conversation.creativeStudio.workspace.proposals.chatDecisionBusy').length
    ).toBeGreaterThan(0);

    await act(async () => {
      acceptance.resolve(
        ok({
          proposal: { ...proposal(), status: 'accepted', decidedAt: '2026-01-01T00:00:05.000Z' },
          project: project(),
          applied: true,
        })
      );
      await firstDecision;
    });
  });

  it('fails closed when the sole pending proposal is stale', async () => {
    mockSupportedProject({ ...project(), revision: 4 });
    mocks.bridge.listProposals.invoke.mockResolvedValue(ok([proposal()]));
    renderStudio();
    await screen.findByRole('heading', { name: 'Launch film' });
    await waitFor(() => expect(mocks.bridge.listProposals.invoke).toHaveBeenCalledTimes(1));

    await act(async () => capturedDirectorProposalIntent()('accept'));

    expect(await screen.findByText('conversation.creativeStudio.workspace.proposals.chatStale')).toBeVisible();
    expect(mocks.bridge.acceptProposal.invoke).not.toHaveBeenCalled();
    expect(mocks.bridge.rejectProposal.invoke).not.toHaveBeenCalled();
  });

  it('fails closed when a non-Shot workspace draft is dirty', async () => {
    mocks.bridge.listProposals.invoke.mockResolvedValue(ok([proposal()]));
    renderStudio();
    await screen.findByTestId('studio-proposal-proposal_1');
    const briefDialog = await openProjectDialog(BRIEF_RULES_TITLE);
    fireEvent.change(within(briefDialog).getByLabelText(RULE_TEXT), {
      target: { value: 'Keep this rule draft local.' },
    });
    await waitFor(() => expect(mocks.closeHandlers.hasUnsavedWork?.()).toEqual({ dirtyDraftCount: 1 }));

    await act(async () => capturedDirectorProposalIntent()('accept'));

    expect(screen.getAllByText('conversation.creativeStudio.workspace.proposals.chatDirty').length).toBeGreaterThan(0);
    expect(mocks.bridge.acceptProposal.invoke).not.toHaveBeenCalled();
    expect(mocks.bridge.rejectProposal.invoke).not.toHaveBeenCalled();
  });

  it('keeps an independent rule-pin proposal actionable while local Shot drafts are unsaved', async () => {
    const draftedProject = projectWithDraftBatch(1);
    const ruleProposal = pinRuleProposal();
    seedWorkspaceDrafts({
      'shot.shot_0.shootingScript': { baseValue: 'Shot 1', value: 'Unsaved local script' },
    });
    mockSupportedProject(draftedProject);
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
    mocks.bridge.projectWorkspaceStatusFixture.invoke
      .mockResolvedValueOnce(ok(workspaceStatus(current)))
      .mockResolvedValue(ok(workspaceStatus(advanced)));
    mocks.bridge.projectWorkspaceChainFixture.invoke
      .mockResolvedValueOnce(ok(chainStatus(current)))
      .mockResolvedValue(ok(chainStatus(advanced)));
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
    expect(mocks.bridge.projectWorkspaceStatusFixture.invoke).toHaveBeenCalledTimes(2);
    expect(mocks.bridge.projectWorkspaceChainFixture.invoke).toHaveBeenCalledTimes(2);
  });

  it('keeps a setting draft dirty when the post-commit snapshot is older than the commit receipt', async () => {
    mocks.bridge.getProject.invoke.mockResolvedValue(ok({ status: 'supported', project: project() }));
    renderStudio();
    const settingsDialog = await openProjectDialog(SETTINGS_TITLE);
    const name = within(settingsDialog).getByLabelText(NAME);
    fireEvent.change(name, { target: { value: 'Awaiting durable refresh' } });
    fireEvent.click(
      within(settingsDialog).getByRole('button', {
        name: 'conversation.creativeStudio.workspace.controls.saveSettings',
      })
    );

    expect(
      await within(settingsDialog).findByText('conversation.creativeStudio.workspace.errors.storage')
    ).toBeVisible();
    expect(name).toHaveValue('Awaiting durable refresh');
    expect(mocks.bridge.editProject.invoke).toHaveBeenCalledTimes(1);
    expect(mocks.bridge.getProjectWorkspace.invoke).toHaveBeenCalledTimes(2);
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
    mocks.bridge.projectWorkspaceStatusFixture.invoke
      .mockResolvedValueOnce(ok(workspaceStatus(3)))
      .mockResolvedValue(ok(workspaceStatus(concurrentlyAdvanced)));
    mocks.bridge.projectWorkspaceChainFixture.invoke
      .mockResolvedValueOnce(ok(chainStatus(3)))
      .mockResolvedValue(ok(chainStatus(concurrentlyAdvanced)));

    renderStudio();
    await screen.findByRole('heading', { name: 'Launch film' });
    await waitFor(() => expect(mocks.closeHandlers.hasUnsavedWork?.()).toEqual({ dirtyDraftCount: 2 }));
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
    const briefDialog = await openProjectDialog(BRIEF_RULES_TITLE);
    expect(within(briefDialog).getByLabelText(BRIEF)).toHaveValue('Unsaved local Brief.');
  });

  it('coalesces an update during close-save refresh and retains the next draft when authority advances', async () => {
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
    mocks.bridge.projectWorkspaceStatusFixture.invoke
      .mockResolvedValueOnce(ok(workspaceStatus(3)))
      .mockReturnValueOnce(stalledWorkspace.promise)
      .mockResolvedValue(ok(workspaceStatus(5)));
    mocks.bridge.projectWorkspaceChainFixture.invoke
      .mockResolvedValueOnce(ok(chainStatus(3)))
      .mockResolvedValueOnce(ok(chainStatus(4)))
      .mockResolvedValue(ok(chainStatus(5)));

    renderStudio();
    await screen.findByRole('heading', { name: 'Launch film' });
    await waitFor(() => expect(mocks.closeHandlers.hasUnsavedWork?.()).toEqual({ dirtyDraftCount: 2 }));
    await waitFor(() => expect(mocks.bridge.getProjectWorkspace.invoke).toHaveBeenCalledTimes(1));
    let flushPromise: Promise<{ saved: boolean }> | undefined;
    act(() => {
      flushPromise = mocks.closeHandlers.flushUnsavedWork?.();
    });
    expect(flushPromise).toBeDefined();
    await waitFor(() => expect(mocks.bridge.getProjectWorkspace.invoke).toHaveBeenCalledTimes(2));

    act(() => {
      mocks.listeners.projectUpdated?.({ projectId: 'project_1' });
    });
    expect(mocks.bridge.getProjectWorkspace.invoke).toHaveBeenCalledTimes(2);

    let saved: { saved: boolean } | undefined;
    act(() => {
      stalledWorkspace.resolve(stalledWorkspaceResult);
    });
    await waitFor(() => expect(mocks.bridge.getProjectWorkspace.invoke).toHaveBeenCalledTimes(4));
    await screen.findByRole('heading', { name: 'Saved local name' });
    await act(async () => {
      saved = await flushPromise;
    });

    expect(saved).toEqual({ saved: false });
    expect(mocks.bridge.editProject.invoke).toHaveBeenCalledWith({
      projectId: 'project_1',
      expectedRevision: 3,
      changes: { name: 'Saved local name' },
    });
    expect(mocks.bridge.applyAuthoringBatch.invoke).toHaveBeenCalledWith({
      projectId: 'project_1',
      expectedRevision: 4,
      operations: [{ kind: 'set_brief', brief: 'Unsaved local Brief.' }],
    });
    expect(mocks.closeHandlers.hasUnsavedWork?.()).toEqual({ dirtyDraftCount: 1 });
    const briefDialog = await openProjectDialog(BRIEF_RULES_TITLE);
    expect(within(briefDialog).getByLabelText(BRIEF)).toHaveValue('Unsaved local Brief.');
  });

  it('silently discards a retired brief.rules draft without treating it as unsaved work', async () => {
    seedWorkspaceDrafts({
      'brief.rules': {
        baseValue: '[]',
        value: '[{"id":"rule_1","text":"Legacy raw JSON","predicate":null,"scope":"poison"}]',
      },
    });
    renderStudio();
    await screen.findByRole('heading', { name: 'Launch film' });

    await waitFor(() => expect(mocks.closeHandlers.hasUnsavedWork?.()).toEqual({ dirtyDraftCount: 0 }));
    expect(window.sessionStorage.getItem('aionui:creative-studio:v2:workspace-drafts:project_1') ?? '').not.toContain(
      'brief.rules'
    );

    let saved: { saved: boolean } | undefined;
    await act(async () => {
      saved = await mocks.closeHandlers.flushUnsavedWork?.();
    });

    expect(saved).toEqual({ saved: true });
    expect(mocks.bridge.setRules.invoke).not.toHaveBeenCalled();
    expect(mocks.closeHandlers.hasUnsavedWork?.()).toEqual({ dirtyDraftCount: 0 });
  });

  it.each([
    ['beat.beat_0.targetSeconds', 4, 1.5, 1, false],
    ['beat.beat_0.story', 'Story 1', 42, 0, true],
    ['shot.shot_0.durationSeconds', 4, 1.5, 1, false],
    ['shot.shot_0.shootingScript', 'Shot 1', 42, 0, true],
  ])(
    'refuses or discards malformed dynamic authoring draft %s',
    async (key, baseValue, value, expectedDirtyCount, expectedSaved) => {
      seedWorkspaceDrafts({ [key]: { baseValue, value } });
      mockSupportedProject(projectWithDraftBatch(1));
      renderStudio();
      await screen.findByRole('heading', { name: 'Launch film' });
      await waitFor(() =>
        expect(mocks.closeHandlers.hasUnsavedWork?.()).toEqual({ dirtyDraftCount: expectedDirtyCount })
      );

      let saved: { saved: boolean } | undefined;
      await act(async () => {
        saved = await mocks.closeHandlers.flushUnsavedWork?.();
      });

      expect(saved).toEqual({ saved: expectedSaved });
      expect(mocks.bridge.applyAuthoringBatch.invoke).not.toHaveBeenCalled();
      expect(mocks.closeHandlers.hasUnsavedWork?.()).toEqual({ dirtyDraftCount: expectedDirtyCount });
    }
  );

  it('clears semantically unchanged Beat and Shot drafts without issuing authoring work', async () => {
    seedWorkspaceDrafts({
      'beat.beat_0.story': { baseValue: 'Stale story base', value: 'Story 1' },
      'shot.shot_0.shootingScript': { baseValue: 'Stale Shot base', value: 'Shot 1' },
    });
    mockSupportedProject(projectWithDraftBatch(2));
    renderStudio();
    await screen.findByRole('heading', { name: 'Launch film' });
    await waitFor(() => expect(mocks.closeHandlers.hasUnsavedWork?.()).toEqual({ dirtyDraftCount: 0 }));

    let saved: { saved: boolean } | undefined;
    await act(async () => {
      saved = await mocks.closeHandlers.flushUnsavedWork?.();
    });

    expect(saved).toEqual({ saved: true });
    expect(mocks.bridge.applyAuthoringBatch.invoke).not.toHaveBeenCalled();
    expect(mocks.closeHandlers.hasUnsavedWork?.()).toEqual({ dirtyDraftCount: 0 });
  });

  it('rejects an invalid spend currency during close-save without issuing authoring work', async () => {
    seedWorkspaceDrafts({
      'brief.spendCurrency': { baseValue: '', value: 'US' },
      'brief.spendMajorUnits': { baseValue: '', value: '12.34' },
    });
    renderStudio();
    await screen.findByRole('heading', { name: 'Launch film' });
    await waitFor(() => expect(mocks.closeHandlers.hasUnsavedWork?.()).toEqual({ dirtyDraftCount: 2 }));

    let saved: { saved: boolean } | undefined;
    await act(async () => {
      saved = await mocks.closeHandlers.flushUnsavedWork?.();
    });

    expect(saved).toEqual({ saved: false });
    expect(mocks.bridge.applyAuthoringBatch.invoke).not.toHaveBeenCalled();
    expect(mocks.closeHandlers.hasUnsavedWork?.()).toEqual({ dirtyDraftCount: 2 });
  });

  it('recognizes an exact canonical rule snapshot without issuing a duplicate native mutation', async () => {
    const governed = project();
    governed.rules = [
      {
        id: 'rule_prose',
        scope: 'project',
        text: 'Keep the launch clean.',
        predicate: null,
        createdAt: '2026-01-01T00:00:01.000Z',
      },
      {
        id: 'rule_terms',
        scope: 'project',
        text: 'Avoid product marks.',
        predicate: { kind: 'forbidden_terms', terms: ['logo', 'watermark'] },
        createdAt: '2026-01-01T00:00:02.000Z',
      },
    ];
    const exactDrafts: StudioBriefRuleDraft[] = governed.rules.map(({ id, text, predicate }) => ({
      id,
      text,
      predicate,
    }));
    mocks.bridge.getProject.invoke.mockResolvedValue(ok({ status: 'supported', project: governed }));

    renderStudio();
    await screen.findByRole('heading', { name: 'Launch film' });
    let adopted = false;
    await act(async () => {
      adopted = await capturedWorkspaceMutations().setRules(() => exactDrafts, 'exact-rule-snapshot');
    });

    expect(adopted).toBe(true);
    expect(mocks.bridge.setRules.invoke).not.toHaveBeenCalled();
  });

  it('does not mistake sparse or near-matching rule drafts for an adopted canonical snapshot', async () => {
    const governed = project();
    governed.rules = [
      {
        id: 'rule_prose',
        scope: 'project',
        text: 'Keep the launch clean.',
        predicate: null,
        createdAt: '2026-01-01T00:00:01.000Z',
      },
      {
        id: 'rule_terms',
        scope: 'project',
        text: 'Avoid product marks.',
        predicate: { kind: 'forbidden_terms', terms: ['logo', 'watermark'] },
        createdAt: '2026-01-01T00:00:02.000Z',
      },
    ];
    const exactDrafts: StudioBriefRuleDraft[] = governed.rules.map(({ id, text, predicate }) => ({
      id,
      text,
      predicate,
    }));
    const sparseDrafts = Array<StudioBriefRuleDraft>(exactDrafts.length);
    sparseDrafts[1] = exactDrafts[1]!;
    const nearMatches: ReadonlyArray<readonly [string, StudioBriefRuleDraft[]]> = [
      ['shorter', [exactDrafts[0]!]],
      ['sparse', sparseDrafts],
      ['different-id', [{ ...exactDrafts[0]!, id: 'rule_other' }, exactDrafts[1]!]],
      ['different-text', [{ ...exactDrafts[0]!, text: 'Keep only one launch clean.' }, exactDrafts[1]!]],
      [
        'prose-became-executable',
        [{ ...exactDrafts[0]!, predicate: { kind: 'forbidden_terms', terms: ['logo'] } }, exactDrafts[1]!],
      ],
      ['predicate-removed', [exactDrafts[0]!, { ...exactDrafts[1]!, predicate: null }]],
      [
        'future-predicate-kind',
        [
          exactDrafts[0]!,
          {
            ...exactDrafts[1]!,
            predicate: { kind: 'future_rule', terms: ['logo', 'watermark'] } as unknown as NonNullable<
              StudioBriefRuleDraft['predicate']
            >,
          },
        ],
      ],
      [
        'different-term-count',
        [exactDrafts[0]!, { ...exactDrafts[1]!, predicate: { kind: 'forbidden_terms', terms: ['logo'] } }],
      ],
      [
        'different-term',
        [exactDrafts[0]!, { ...exactDrafts[1]!, predicate: { kind: 'forbidden_terms', terms: ['logo', 'brand'] } }],
      ],
    ];
    mocks.bridge.getProject.invoke.mockResolvedValue(ok({ status: 'supported', project: governed }));
    mocks.bridge.setRules.invoke.mockResolvedValue({
      ok: false,
      error: { code: 'storage_error', messageKey: 'native.ruleMismatch' },
    });

    renderStudio();
    await screen.findByRole('heading', { name: 'Launch film' });
    const results: boolean[] = [];
    const attemptNearMatch = async (index: number): Promise<void> => {
      const attempt = nearMatches[index];
      if (attempt === undefined) return;
      const [label, drafts] = attempt;
      results.push(await capturedWorkspaceMutations().setRules(() => drafts, `near-match-${label}`));
      await attemptNearMatch(index + 1);
    };
    await act(async () => {
      await attemptNearMatch(0);
    });

    expect(results).toEqual(nearMatches.map(() => false));
    expect(mocks.bridge.setRules.invoke).toHaveBeenCalledTimes(nearMatches.length);
    expect(mocks.bridge.setRules.invoke.mock.calls.map(([request]) => request.rules)).toEqual(
      nearMatches.map(([, drafts]) => drafts)
    );
  });

  it('keeps typed rule input and idempotently recognizes an ambiguously adopted rule on retry', async () => {
    const initial = project();
    const omittedRuleSnapshot = { ...project(), revision: 4, rules: [] };
    mocks.bridge.getProject.invoke
      .mockResolvedValueOnce(ok({ status: 'supported', project: initial }))
      .mockResolvedValue(ok({ status: 'supported', project: omittedRuleSnapshot }));
    mocks.bridge.projectWorkspaceStatusFixture.invoke
      .mockResolvedValueOnce(ok(workspaceStatus(initial)))
      .mockResolvedValue(ok(workspaceStatus(omittedRuleSnapshot)));
    mocks.bridge.projectWorkspaceChainFixture.invoke
      .mockResolvedValueOnce(ok(chainStatus(initial)))
      .mockResolvedValue(ok(chainStatus(omittedRuleSnapshot)));

    renderStudio();
    const briefDialog = await openProjectDialog(BRIEF_RULES_TITLE);
    const textInput = within(briefDialog).getByLabelText('conversation.creativeStudio.rules.textLabel');
    const termsInput = within(briefDialog).getByLabelText('conversation.creativeStudio.rules.termsLabel');
    fireEvent.change(textInput, { target: { value: 'Keep every frame bright' } });
    fireEvent.change(termsInput, { target: { value: 'logo, watermark' } });
    fireEvent.click(within(briefDialog).getByRole('button', { name: 'conversation.creativeStudio.rules.add' }));

    expect(await within(briefDialog).findByText('conversation.creativeStudio.workspace.errors.storage')).toBeVisible();
    expect(mocks.bridge.setRules.invoke).toHaveBeenCalledTimes(1);
    expect(mocks.bridge.setRules.invoke.mock.calls[0]?.[0]).toMatchObject({
      projectId: 'project_1',
      expectedRevision: 3,
      rules: [
        {
          text: 'Keep every frame bright',
          predicate: { kind: 'forbidden_terms', terms: ['logo', 'watermark'] },
        },
      ],
    });
    expect(textInput).toHaveValue('Keep every frame bright');
    expect(termsInput).toHaveValue('logo, watermark');
    expect(document.querySelector('[data-studio-project-rule]')).toBeNull();

    const submittedRule = mocks.bridge.setRules.invoke.mock.calls[0]?.[0].rules[0];
    expect(submittedRule?.id).toMatch(/^[A-Za-z0-9_]+$/);
    mocks.bridge.getProject.invoke.mockResolvedValue(
      ok({ status: 'supported', project: { ...omittedRuleSnapshot, rules: [submittedRule] } })
    );
    act(() => mocks.listeners.projectUpdated?.({ projectId: 'project_1' }));
    expect(await within(briefDialog).findByText('Keep every frame bright')).toBeVisible();
    await waitFor(() => expect(textInput).toHaveValue(''));
    expect(termsInput).toHaveValue('');
    expect(mocks.bridge.setRules.invoke).toHaveBeenCalledTimes(1);
    expect(
      within(briefDialog).queryByText('conversation.creativeStudio.workspace.errors.storage')
    ).not.toBeInTheDocument();
  });

  it('does not let delayed rule adoption clear a newer action error', async () => {
    const initial = project();
    const omittedRuleSnapshot = { ...project(), revision: 4, rules: [] };
    mocks.bridge.getProject.invoke
      .mockResolvedValueOnce(ok({ status: 'supported', project: initial }))
      .mockResolvedValue(ok({ status: 'supported', project: omittedRuleSnapshot }));
    mocks.bridge.projectWorkspaceStatusFixture.invoke
      .mockResolvedValueOnce(ok(workspaceStatus(initial)))
      .mockResolvedValue(ok(workspaceStatus(omittedRuleSnapshot)));
    mocks.bridge.projectWorkspaceChainFixture.invoke
      .mockResolvedValueOnce(ok(chainStatus(initial)))
      .mockResolvedValue(ok(chainStatus(omittedRuleSnapshot)));

    renderStudio();
    const briefDialog = await openProjectDialog(BRIEF_RULES_TITLE);
    const textInput = within(briefDialog).getByLabelText('conversation.creativeStudio.rules.textLabel');
    fireEvent.change(textInput, { target: { value: 'Retain the correlated failure.' } });
    fireEvent.click(within(briefDialog).getByRole('button', { name: 'conversation.creativeStudio.rules.add' }));
    expect(await within(briefDialog).findByText('conversation.creativeStudio.workspace.errors.storage')).toBeVisible();

    mocks.bridge.applyAuthoringBatch.invoke.mockResolvedValueOnce({
      ok: false,
      error: { code: 'storage_error', messageKey: 'native.newerActionFailure' },
    });
    let saved = true;
    await act(async () => {
      saved = await capturedBeatPanelActions().saveBeat('beat_0', { story: 'A later story edit.' });
    });
    expect(saved).toBe(false);
    expect(await within(briefDialog).findByText('native.newerActionFailure')).toBeVisible();

    const submittedRule = mocks.bridge.setRules.invoke.mock.calls[0]?.[0].rules[0]!;
    mocks.bridge.getProject.invoke.mockResolvedValue(
      ok({ status: 'supported', project: { ...omittedRuleSnapshot, rules: [submittedRule] } })
    );
    act(() => mocks.listeners.projectUpdated?.({ projectId: 'project_1' }));

    expect(await within(briefDialog).findByText('Retain the correlated failure.')).toBeVisible();
    await waitFor(() => expect(textInput).toHaveValue(''));
    expect(within(briefDialog).getByText('native.newerActionFailure')).toBeVisible();
    expect(mocks.bridge.setRules.invoke).toHaveBeenCalledTimes(1);
  });

  it('renders authoritative rules and spend policy in Brief & rules without legacy JSON mutation', async () => {
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
    mocks.bridge.getProject.invoke.mockResolvedValue(ok({ status: 'supported', project: governed }));
    renderStudio();
    const briefDialog = await openProjectDialog(BRIEF_RULES_TITLE);

    expect(within(briefDialog).getByText('Avoid marks')).toBeVisible();
    expect(within(briefDialog).getByText('logo')).toBeVisible();
    expect(within(briefDialog).getByLabelText('conversation.creativeStudio.workspace.controls.spendCap')).toHaveValue(
      '12.34'
    );
    expect(
      within(briefDialog).queryByLabelText('conversation.creativeStudio.workspace.controls.rules')
    ).not.toBeInTheDocument();

    let saved: { saved: boolean } | undefined;
    await act(async () => {
      saved = await mocks.closeHandlers.flushUnsavedWork?.();
    });

    expect(saved).toEqual({ saved: true });
    expect(mocks.bridge.setRules.invoke).not.toHaveBeenCalled();
    expect(mocks.bridge.applyAuthoringBatch.invoke).not.toHaveBeenCalled();
  });

  it('recovers only the exact current attention job and refreshes its committed revision', async () => {
    const current = projectWithAttentionJob('needs_attention');
    const recovered = projectWithAttentionJob('queued_remote');
    mocks.bridge.getProject.invoke
      .mockResolvedValueOnce(ok({ status: 'supported', project: current }))
      .mockResolvedValue(ok({ status: 'supported', project: recovered }));
    mocks.bridge.projectWorkspaceStatusFixture.invoke
      .mockResolvedValueOnce(ok(workspaceStatus(current)))
      .mockResolvedValue(ok(workspaceStatus(recovered)));
    mocks.bridge.projectWorkspaceChainFixture.invoke
      .mockResolvedValueOnce(ok(chainStatus(current)))
      .mockResolvedValue(ok(chainStatus(recovered)));
    mocks.bridge.retryJob.invoke.mockResolvedValue(ok(recovered.jobs.job_attention));

    renderStudio();
    await waitFor(() => expect(mocks.beatPanelActions).not.toBeNull());
    let retried = false;
    await act(async () => {
      retried = await capturedBeatPanelActions().retryGenerationJob('job_attention', false);
    });

    expect(retried).toBe(true);
    expect(mocks.bridge.retryJob.invoke).toHaveBeenCalledExactlyOnceWith({
      projectId: 'project_1',
      jobId: 'job_attention',
      expectedRevision: 3,
      acknowledgePossibleDuplicateCharge: false,
    });
    expect(mocks.bridge.projectWorkspaceStatusFixture.invoke).toHaveBeenCalledTimes(2);

    await expect(capturedBeatPanelActions().retryGenerationJob('job_attention', false)).resolves.toBe(false);
    await expect(capturedBeatPanelActions().cancelGenerationJob('forged_job')).resolves.toBe(false);
    expect(mocks.bridge.retryJob.invoke).toHaveBeenCalledTimes(1);
    expect(mocks.bridge.cancelJob.invoke).not.toHaveBeenCalled();
  });

  it('requires the exact unknown-submission acknowledgement before unlocking a replacement quote', async () => {
    const current = projectWithAttentionJob('needs_attention');
    current.jobs.job_attention!.error = {
      code: 'submission_unknown',
      messageKey: 'conversation.creativeStudio.jobs.errors.submissionUnknown',
    };
    current.jobs.job_attention!.canCancel = false;
    const acknowledged = projectWithAttentionJob('failed');
    acknowledged.jobs.job_attention!.error = { ...current.jobs.job_attention!.error };
    mocks.bridge.getProject.invoke
      .mockResolvedValueOnce(ok({ status: 'supported', project: current }))
      .mockResolvedValue(ok({ status: 'supported', project: acknowledged }));
    mocks.bridge.projectWorkspaceStatusFixture.invoke
      .mockResolvedValueOnce(ok(workspaceStatus(current)))
      .mockResolvedValue(ok(workspaceStatus(acknowledged)));
    mocks.bridge.projectWorkspaceChainFixture.invoke
      .mockResolvedValueOnce(ok(chainStatus(current)))
      .mockResolvedValue(ok(chainStatus(acknowledged)));
    mocks.bridge.retryJob.invoke.mockResolvedValue(ok(acknowledged.jobs.job_attention));

    renderStudio();
    await waitFor(() => expect(mocks.beatPanelActions).not.toBeNull());
    await expect(capturedBeatPanelActions().retryGenerationJob('job_attention', false)).resolves.toBe(false);
    expect(mocks.bridge.retryJob.invoke).not.toHaveBeenCalled();

    let acknowledgedResult = false;
    await act(async () => {
      acknowledgedResult = await capturedBeatPanelActions().retryGenerationJob('job_attention', true);
    });
    expect(acknowledgedResult).toBe(true);
    expect(mocks.bridge.retryJob.invoke).toHaveBeenCalledExactlyOnceWith({
      projectId: 'project_1',
      jobId: 'job_attention',
      expectedRevision: 3,
      acknowledgePossibleDuplicateCharge: true,
    });
  });

  it('cancels only the exact current provider-cancellable attention job', async () => {
    const current = projectWithAttentionJob('needs_attention');
    const cancelled = projectWithAttentionJob('cancelled');
    mocks.bridge.getProject.invoke
      .mockResolvedValueOnce(ok({ status: 'supported', project: current }))
      .mockResolvedValue(ok({ status: 'supported', project: cancelled }));
    mocks.bridge.projectWorkspaceStatusFixture.invoke
      .mockResolvedValueOnce(ok(workspaceStatus(current)))
      .mockResolvedValue(ok(workspaceStatus(cancelled)));
    mocks.bridge.projectWorkspaceChainFixture.invoke
      .mockResolvedValueOnce(ok(chainStatus(current)))
      .mockResolvedValue(ok(chainStatus(cancelled)));
    mocks.bridge.cancelJob.invoke.mockResolvedValue(ok(cancelled.jobs.job_attention));

    renderStudio();
    await waitFor(() => expect(mocks.beatPanelActions).not.toBeNull());
    let cancelledResult = false;
    await act(async () => {
      cancelledResult = await capturedBeatPanelActions().cancelGenerationJob('job_attention');
    });
    expect(cancelledResult).toBe(true);
    expect(mocks.bridge.cancelJob.invoke).toHaveBeenCalledExactlyOnceWith({
      projectId: 'project_1',
      jobId: 'job_attention',
      expectedRevision: 3,
    });
  });

  it('renders the unsupported prototype state without fabricating a project', async () => {
    mocks.bridge.getProject.invoke.mockResolvedValue(
      ok({ status: 'unsupported_prototype_schema', projectId: 'project_1' })
    );

    renderStudio();

    expect(await screen.findByText('conversation.creativeStudio.workspace.project.unsupportedPrototype')).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Launch film' })).not.toBeInTheDocument();
    expect(mocks.bridge.getProjectWorkspace.invoke).toHaveBeenCalledTimes(1);
  });
});
