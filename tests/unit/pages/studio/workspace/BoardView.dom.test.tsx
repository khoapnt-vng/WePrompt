/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import type {
  StudioProjectStatusBlockerV2,
  StudioProjectStatusShotDetailV2,
  StudioProjectStatusStageV2,
  StudioProjectStatusV2,
} from '@/common/types/project/creativeStudioTypes';
import type {
  WorkspaceBeatProjection,
  WorkspaceBoardPanelProjection,
  WorkspaceProjection,
  WorkspaceShotProjection,
} from '@/renderer/pages/studio/components/Workspace/workspaceProjection';

const boardCss = readFileSync(
  resolve(
    process.cwd(),
    'packages/desktop/src/renderer/pages/studio/components/Workspace/Views/Board/Board.module.css'
  ),
  'utf8'
);

type MockButtonProps = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'type'> & {
  icon?: React.ReactNode;
  loading?: boolean;
  long?: boolean;
  shape?: string;
  size?: string;
  status?: string;
  type?: string;
};

type MockPopconfirmProps = {
  cancelText: React.ReactNode;
  children: React.ReactElement<React.ButtonHTMLAttributes<HTMLButtonElement>>;
  content: React.ReactNode;
  disabled?: boolean;
  okText: React.ReactNode;
  onCancel?: () => void;
  onOk?: () => void | Promise<unknown>;
  title: React.ReactNode;
};

type MockBinProps = {
  focusItemKey: string | null;
  onFocusItemSettled: () => void;
  onRestoreSuccess: (
    result: { kind: 'beat'; beatId: string } | { kind: 'shot'; beatId: string; shotId: string }
  ) => void;
  pending: boolean;
};

vi.mock('@arco-design/web-react', async () => {
  const ReactModule = await import('react');
  const Button = ReactModule.forwardRef<HTMLButtonElement, MockButtonProps>(
    (
      {
        children,
        icon,
        loading: _loading,
        long: _long,
        shape: _shape,
        size: _size,
        status: _status,
        type: _type,
        ...props
      },
      ref
    ) => (
      <button ref={ref} type='button' {...props}>
        {icon}
        {children}
      </button>
    )
  );
  const Popconfirm = ({
    cancelText,
    children,
    content,
    disabled,
    okText,
    onCancel,
    onOk,
    title,
  }: MockPopconfirmProps) => {
    const [open, setOpen] = ReactModule.useState(false);
    const trigger = ReactModule.isValidElement<React.ButtonHTMLAttributes<HTMLButtonElement>>(children)
      ? ReactModule.cloneElement(children, {
          onClick: () => {
            if (!disabled) setOpen(true);
          },
        })
      : children;
    return (
      <>
        {trigger}
        {open ? (
          <section aria-label={String(title)} role='group'>
            <p>{content}</p>
            <button
              onClick={() => {
                void Promise.resolve(onOk?.()).then(() => setOpen(false));
              }}
              type='button'
            >
              {okText}
            </button>
            <button
              onClick={() => {
                setOpen(false);
                onCancel?.();
              }}
              type='button'
            >
              {cancelText}
            </button>
          </section>
        ) : null}
      </>
    );
  };
  return { Button, Popconfirm, default: ReactModule };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => {
      const copy: Record<string, string> = {
        'conversation.creativeStudio.workspace.board.ariaLabel': 'Beat board',
        'conversation.creativeStudio.workspace.board.selectedBeat': 'Selected Beat',
        'conversation.creativeStudio.workspace.board.noCoverage': 'No coverage',
        'conversation.creativeStudio.workspace.board.coverUnavailable': 'Preview unavailable',
        'conversation.creativeStudio.workspace.board.controls.label': 'Director Board controls',
        'conversation.creativeStudio.workspace.board.controls.progressLabel': 'Board completeness',
        'conversation.creativeStudio.workspace.board.controls.stop': 'Stop drawing',
        'conversation.creativeStudio.workspace.board.controls.stopNote':
          'Completed panels and charges already incurred remain.',
        'conversation.creativeStudio.workspace.board.panel.redrawBeat': 'Redraw Beat · paid',
        'conversation.creativeStudio.workspace.board.panel.status.missing': 'Not drawn',
        'conversation.creativeStudio.workspace.board.panel.status.current': 'Current',
        'conversation.creativeStudio.workspace.board.panel.status.stale': 'Stale',
        'conversation.creativeStudio.workspace.board.panel.status.statusPending': 'Status pending',
        'conversation.creativeStudio.workspace.board.panel.status.queued': 'Queued',
        'conversation.creativeStudio.workspace.board.panel.status.drawing': 'Drawing',
        'conversation.creativeStudio.workspace.board.panel.status.needsAttention': 'Needs attention',
        'conversation.creativeStudio.workspace.board.panel.status.failed': 'Failed',
        'conversation.creativeStudio.workspace.board.panel.status.cancelled': 'Cancelled',
        'conversation.creativeStudio.workspace.gate.purpose.board_still': 'Board panel',
        'conversation.creativeStudio.workspace.board.statusUnavailable': 'Board unavailable',
        'conversation.creativeStudio.workspace.board.shot.videoPreview': 'Current Shot video',
        'conversation.creativeStudio.workspace.board.shot.stale': 'Stale',
        'conversation.creativeStudio.workspace.board.shot.chainHead': 'Chain head',
        'conversation.creativeStudio.workspace.gate.errors.pricing.missingShootingScript':
          'Write this Shot’s Shooting script before generating media.',
        'conversation.creativeStudio.workspace.board.shot.statusUnavailable': 'Blocker details unavailable',
        'conversation.creativeStudio.workspace.board.shot.blocker.heading': 'Blocked by',
        'conversation.creativeStudio.workspace.board.shot.blocker.referenceBindingTable':
          'Reference binding must be fixed on the Table before generation.',
        'conversation.creativeStudio.workspace.board.shot.blocker.reviewOnTable': 'Review references on Table',
        'conversation.creativeStudio.workspace.board.shot.blocker.cause.referenceBindingUnassigned':
          'References are unassigned.',
        'conversation.creativeStudio.workspace.board.shot.blocker.cause.routeNotSelected':
          'A generation engine is not selected.',
        'conversation.creativeStudio.workspace.controls.imageRoute': 'Image route',
        'conversation.creativeStudio.workspace.controls.videoRoute': 'Video route',
        'conversation.creativeStudio.workspace.shotStatus.notReady': 'Not ready',
        'conversation.creativeStudio.workspace.shotStatus.ready': 'Ready to render',
        'conversation.creativeStudio.workspace.shotStatus.queued': 'Queued',
        'conversation.creativeStudio.workspace.shotStatus.rendering': 'Rendering',
        'conversation.creativeStudio.workspace.shotStatus.rendered': 'Rendered',
        'conversation.creativeStudio.workspace.shotStatus.failed': 'Failed',
        'conversation.creativeStudio.workspace.shotStatus.latestAttemptFailed': 'Latest attempt failed',
        'conversation.creativeStudio.workspace.beatPanel.untitledBeat': 'Untitled Beat',
        'conversation.creativeStudio.workspace.beatPanel.seeds.authorizationLocked':
          'Authorized video work has locked this Shot’s first frame.',
        'conversation.creativeStudio.workspace.table.state.durationPending': 'Duration pending',
        'conversation.creativeStudio.workspace.table.state.noCoverage': 'No coverage state',
        'conversation.creativeStudio.workspace.table.state.seedPending': 'First frame pending',
        'conversation.creativeStudio.workspace.table.state.partDone': 'Part done',
        'conversation.creativeStudio.workspace.table.state.needsAttention': 'Needs attention',
        'conversation.creativeStudio.workspace.table.state.rendering': 'Rendering',
        'conversation.creativeStudio.workspace.table.state.stale': 'Stale',
        'conversation.creativeStudio.workspace.table.state.statusPending': 'Status pending',
        'conversation.creativeStudio.workspace.table.state.ready': 'Ready',
        'conversation.creativeStudio.workspace.table.state.draft': 'Draft',
        'conversation.creativeStudio.workspace.beatPanel.blocker.ownNonterminalJob': 'Own job is still running',
        'conversation.creativeStudio.workspace.beatPanel.blocker.ownPendingFrame': 'Own frame is pending',
        'conversation.creativeStudio.workspace.beatPanel.blocker.downstreamNonterminalJob':
          'Downstream job is still running',
        'conversation.creativeStudio.workspace.beatPanel.blocker.downstreamPendingFrame': 'Downstream frame is pending',
        'conversation.creativeStudio.workspace.beatPanel.blocker.waitingAuthorizationDependency':
          'Authorization dependency is waiting',
        'conversation.creativeStudio.workspace.beatPanel.blocker.boundNonterminalRequest': 'Request is still bound',
        'conversation.creativeStudio.workspace.beatPanel.blocker.beatShotCapacityReached': 'Beat Shot limit reached',
        'conversation.creativeStudio.workspace.beatPanel.common.cancel': 'Cancel',
        'conversation.creativeStudio.jobs.retry': 'Retry',
        'conversation.creativeStudio.jobs.retryDownload': 'Retry download',
        'conversation.creativeStudio.jobs.cancel': 'Cancel job',
        'conversation.creativeStudio.jobs.retryChargeBody': 'The provider may already have accepted this job.',
        'conversation.creativeStudio.jobs.retryChargeConfirm': 'Retry and accept risk',
        'conversation.creativeStudio.jobs.retryChargeTitle': 'Possible duplicate charge',
      };
      if (key === 'conversation.creativeStudio.workspace.board.ordinal') {
        return String(values?.index ?? 0).padStart(2, '0');
      }
      if (key === 'conversation.creativeStudio.workspace.board.shotCount') {
        const count = Number(values?.count ?? 0);
        return `${count} ${count === 1 ? 'shot' : 'shots'}`;
      }
      if (key === 'conversation.creativeStudio.workspace.board.actualDuration') {
        return `${String(values?.seconds)}s actual`;
      }
      if (key === 'conversation.creativeStudio.workspace.board.renderedCount') {
        return `${String(values?.count)} of ${String(values?.total)} rendered`;
      }
      if (key === 'conversation.creativeStudio.workspace.board.staleCount') {
        return `${String(values?.count)} stale Shot`;
      }
      if (key === 'conversation.creativeStudio.workspace.board.inFlightCount') {
        return `${String(values?.count)} queued or rendering Shot`;
      }
      if (key === 'conversation.creativeStudio.workspace.board.shot.ariaLabel') {
        return `Beat ${String(values?.beat)}, Shot ${String(values?.shot)}`;
      }
      if (key === 'conversation.creativeStudio.workspace.board.shot.listLabel') {
        return `Shots in ${String(values?.title)}`;
      }
      if (key === 'conversation.creativeStudio.workspace.board.shot.position') {
        return `${String(values?.beat)}.${String(values?.shot)}`;
      }
      if (key === 'conversation.creativeStudio.workspace.board.shot.chainAfter') {
        return `After ${String(values?.beat)}.${String(values?.shot)}`;
      }
      if (key === 'conversation.creativeStudio.workspace.board.shot.duration') {
        return `${String(values?.seconds)}s`;
      }
      if (key === 'conversation.creativeStudio.workspace.board.openBeat') return `Open ${String(values?.title)}`;
      if (key === 'conversation.creativeStudio.workspace.board.controls.progress') {
        return `${String(values?.drawn)} of ${String(values?.total)} panels drawn`;
      }
      if (key === 'conversation.creativeStudio.workspace.board.controls.staleCount') {
        return `${String(values?.count)} stale`;
      }
      if (key === 'conversation.creativeStudio.workspace.board.controls.busyCount') {
        return `${String(values?.count)} in progress`;
      }
      if (key === 'conversation.creativeStudio.workspace.board.controls.drawNext') {
        return `Draw next batch (${String(values?.count)})`;
      }
      if (key === 'conversation.creativeStudio.workspace.board.panel.drawMissing') {
        return `Draw missing (${String(values?.count)})`;
      }
      if (key === 'conversation.creativeStudio.workspace.board.panel.beatActions') {
        return `Actions for ${String(values?.title)}`;
      }
      if (key === 'conversation.creativeStudio.workspace.board.panel.cardLabel') {
        return `Shot ${String(values?.position)}: ${String(values?.status)}`;
      }
      if (key === 'conversation.creativeStudio.workspace.board.panel.redrawShot') {
        return `Redraw Shot ${String(values?.position)} · paid`;
      }
      if (key === 'conversation.creativeStudio.workspace.board.panel.useAsFirstFrame') {
        return `Use Shot ${String(values?.position)} panel as first frame`;
      }
      return copy[key] ?? key;
    },
  }),
}));

vi.mock('@/renderer/pages/studio/components/Workspace/Views/Board/Bin', async () => {
  const ReactModule = await import('react');
  const Bin = ({ focusItemKey, onFocusItemSettled, onRestoreSuccess, pending }: MockBinProps) => {
    const focusTarget = ReactModule.useRef<HTMLButtonElement | null>(null);
    ReactModule.useEffect(() => {
      if (focusItemKey === null || focusTarget.current === null) return;
      focusTarget.current.focus();
      onFocusItemSettled();
    }, [focusItemKey, onFocusItemSettled]);
    return (
      <section aria-label='Bin' data-pending={pending} data-testid='board-bin'>
        <button
          ref={focusTarget}
          data-bin-focus-key={focusItemKey ?? undefined}
          data-testid='bin-focus-target'
          type='button'
        >
          Bin focus target
        </button>
        <button onClick={() => onRestoreSuccess({ kind: 'beat', beatId: 'restored' })} type='button'>
          Report restored Beat
        </button>
        <button
          onClick={() => onRestoreSuccess({ kind: 'shot', beatId: 'parked', shotId: 'restored_shot' })}
          type='button'
        >
          Report restored binned-owner Shot
        </button>
      </section>
    );
  };
  return {
    Bin,
    binItemFocusKey: (item: { kind: string; beatId?: string; shotId?: string }) =>
      item.kind === 'beat' ? `beat:${item.beatId}` : `shot:${item.shotId}`,
  };
});

import { BoardView, type BoardActions } from '@/renderer/pages/studio/components/Workspace/Views/Board';

const makeShot = (id: string, overrides: Partial<WorkspaceShotProjection> = {}): WorkspaceShotProjection => ({
  id,
  shootingScript: `Shooting script ${id}`,
  durationSeconds: 4,
  chainBreak: 'none',
  trimInSeconds: null,
  trimOutSeconds: null,
  currentPicture: null,
  playedDurationSeconds: 4,
  explicitSeedAssetId: null,
  effectiveSeedAssetId: null,
  seedAuthorityStatusReady: true,
  seedAuthorizationLock: null,
  segmentHead: true,
  planningBoundary: { shotId: id, startSeconds: 0, endSeconds: 4 },
  frameBoundary: null,
  segmentState: { kind: 'no_picture' },
  dirtyCauses: [],
  downstreamShotIds: [],
  seedStills: [],
  firstFrames: [],
  generationProgressPercent: null,
  activeGenerationJob: null,
  coverAssetId: null,
  displayState: 'draft',
  retainedWork: false,
  videoGenerationInFlight: false,
  seedGenerationInFlight: false,
  videoGenerationBlocked: false,
  seedGenerationBlocked: false,
  attentionJobs: [],
  latestVideoAttemptFailed: false,
  hasEffectiveSeed: false,
  ...overrides,
});

const makeBeat = (id: string, overrides: Partial<WorkspaceBeatProjection> = {}): WorkspaceBeatProjection => ({
  id,
  title: `Beat ${id.toUpperCase()}`,
  story: `Story ${id}`,
  targetSeconds: 8,
  sumSeconds: 8,
  actualSeconds: 8,
  displayState: 'ready',
  shots: [makeShot(`${id}_shot`)],
  coverAssetId: null,
  retainedWork: false,
  ...overrides,
});

const makeBoardPanel = (
  shotId: string,
  overrides: Partial<WorkspaceBoardPanelProjection> = {}
): WorkspaceBoardPanelProjection => ({
  shotId,
  assetId: null,
  producerJobId: null,
  latestJobId: null,
  staleCauses: [],
  freshness: 'missing',
  activity: 'idle',
  recovery: null,
  ...overrides,
});

const makeProjection = (
  beats: readonly WorkspaceBeatProjection[],
  overrides: Partial<WorkspaceProjection> = {}
): WorkspaceProjection => ({
  projectId: 'project_1',
  projectRevision: 7,
  activeBeats: [...beats],
  activeBeatIds: beats.map((beat) => beat.id),
  activeShotIds: beats.flatMap((beat) => beat.shots.map((shot) => shot.id)),
  coverageGapBeatIds: beats.filter((beat) => beat.shots.length === 0).map((beat) => beat.id),
  unscriptedShotIds: beats.flatMap((beat) =>
    beat.shots.filter((shot) => shot.shootingScript.trim() === '').map((shot) => shot.id)
  ),
  workspaceStatusReady: true,
  chainStatusReady: true,
  requestShapeLocked: false,
  cut: {
    orderReady: true,
    beats: [],
    filmDurationSeconds: null,
    targetDurationSeconds: 30,
    audioImports: [],
    bed: { status: 'none', assetId: null },
    coverCandidates: [],
  },
  bin: { items: [], beats: [], shots: [] },
  undoTop: null,
  boardPanels: beats.flatMap((beat) => beat.shots.map((shot) => makeBoardPanel(shot.id))),
  dirtyShots: [],
  cascadeProgress: [],
  parkEligibility: [],
  conditioningFailures: [],
  ...overrides,
});

const statusStages = (projection: WorkspaceProjection): StudioProjectStatusStageV2[] => {
  const shotCount = projection.activeShotIds.length;
  const plannedSeconds = projection.activeBeats.reduce(
    (sum, beat) => sum + beat.shots.reduce((beatSum, shot) => beatSum + shot.durationSeconds, 0),
    0
  );
  const currentTakeCount = projection.activeBeats.reduce(
    (count, beat) => count + beat.shots.filter((shot) => shot.currentPicture !== null).length,
    0
  );
  return [
    { id: 'brief', state: 'complete', summary: { stage: 'brief', hasBrief: true }, blockers: [] },
    {
      id: 'engines',
      state: 'complete',
      summary: { stage: 'engines', image: 'ready', video: 'ready' },
      blockers: [],
    },
    {
      id: 'references',
      state: 'complete',
      summary: { stage: 'references', plannedCount: 0, approvedCount: 0 },
      blockers: [],
    },
    {
      id: 'storyboard',
      state: 'complete',
      summary: {
        stage: 'storyboard',
        beatCount: projection.activeBeatIds.length,
        shotCount,
        authoredShotCount: shotCount - projection.unscriptedShotIds.length,
        plannedSeconds,
        targetSeconds: 30,
      },
      blockers: [],
    },
    {
      id: 'bindings',
      state: 'complete',
      summary: { stage: 'bindings', readyShotCount: shotCount, shotCount, maxConditioningImages: 3 },
      blockers: [],
    },
    {
      id: 'production',
      state:
        currentTakeCount === 0
          ? 'not_started'
          : currentTakeCount === shotCount && shotCount > 0
            ? 'complete'
            : 'in_progress',
      summary: { stage: 'production', currentTakeCount, shotCount, activeJobCount: 0 },
      blockers: [],
    },
    {
      id: 'cut',
      state:
        currentTakeCount === 0
          ? 'not_started'
          : currentTakeCount === shotCount && shotCount > 0
            ? 'complete'
            : 'in_progress',
      summary: {
        stage: 'cut',
        currentTakeCount,
        shotCount,
        durationSeconds: shotCount > 0 && currentTakeCount === shotCount ? plannedSeconds : null,
        targetSeconds: 30,
        structurallyPlayable: shotCount > 0 && currentTakeCount === shotCount,
      },
      blockers: [],
    },
  ];
};

const statusDetails = (projection: WorkspaceProjection): StudioProjectStatusShotDetailV2[] =>
  projection.activeBeats.flatMap((beat, beatIndex) =>
    beat.shots.map((shot, shotIndex) => ({
      beatId: beat.id,
      shotId: shot.id,
      beatPosition: beatIndex + 1,
      shotPosition: shotIndex + 1,
      seedStillAssetId: shot.effectiveSeedAssetId,
      videoAssetId: shot.currentPicture?.assetId ?? null,
      latestGenerationJob: null,
      binding: { status: 'ready' as const, selectedCount: 0, limit: 3 },
      conditioning: null,
    }))
  );

const makeProjectStatus = (
  projection: WorkspaceProjection,
  overrides: Partial<StudioProjectStatusV2> = {}
): StudioProjectStatusV2 => ({
  projectId: projection.projectId,
  projectRevision: projection.projectRevision,
  catalogVersion: '0123456789abcdef',
  stages: statusStages(projection),
  blockerCount: 0,
  advisories: [],
  boards: {
    currentPictureCount: projection.activeBeats.reduce(
      (count, beat) => count + beat.shots.filter((shot) => shot.currentPicture !== null).length,
      0
    ),
    shotCount: projection.activeShotIds.length,
  },
  detail: { shots: statusDetails(projection), references: [] },
  ...overrides,
});

const makeActions = (): BoardActions => ({
  drawNext: vi.fn(),
  drawBeat: vi.fn(),
  redrawShot: vi.fn(),
  redrawBeat: vi.fn(),
  promotePanel: vi.fn(),
  stop: vi.fn(),
  retryJob: vi.fn(),
  retryDownload: vi.fn(),
  cancelJob: vi.fn(),
  restoreBeat: vi.fn().mockResolvedValue(true),
  restoreShot: vi.fn().mockResolvedValue(true),
  reorderBin: vi.fn().mockResolvedValue(true),
  persistCapturedPoster: vi.fn().mockResolvedValue(true),
});

const stubCanvasCapture = (options: { blank?: boolean } = {}): (() => void) => {
  const originalContext = HTMLCanvasElement.prototype.getContext;
  const originalDataUrl = HTMLCanvasElement.prototype.toDataURL;
  const pixel = (index: number): number => (options.blank === true ? 0 : index % 251);
  HTMLCanvasElement.prototype.getContext = (() => ({
    drawImage: () => undefined,
    getImageData: () => ({
      data: Uint8ClampedArray.from({ length: 4_096 * 4 }, (_value, index) => pixel(index)),
    }),
  })) as never;
  HTMLCanvasElement.prototype.toDataURL = (() => 'data:image/png;base64,AAAA') as never;
  return () => {
    HTMLCanvasElement.prototype.getContext = originalContext;
    HTMLCanvasElement.prototype.toDataURL = originalDataUrl;
  };
};

const cardFor = (container: HTMLElement, beatId: string): HTMLElement => {
  const card = container.querySelector<HTMLElement>(`[data-beat-id="${beatId}"]`);
  if (card === null) throw new Error(`Missing Board card ${beatId}`);
  return card;
};

const boardProps = (
  projection: WorkspaceProjection,
  actions = makeActions()
): React.ComponentProps<typeof BoardView> => ({
  projectId: projection.projectId,
  projection,
  projectStatus: makeProjectStatus(projection),
  projectStatusPending: false,
  selectedBeatId: null,
  pending: false,
  gateLocked: false,
  imageRouteReady: true,
  actions,
  binFocusAnnouncement: '',
  binFocusItemKey: null,
  onBinFocusItemSettled: vi.fn(),
  onOpenBeat: vi.fn(),
  onReviewReferenceBinding: vi.fn(),
});

describe('BoardView', () => {
  it('keeps complete Shot and projection fixtures so new live facts cannot pass as undefined', () => {
    expect(Object.keys(makeShot('shot_fixture')).toSorted()).toEqual(
      [
        'activeGenerationJob',
        'attentionJobs',
        'chainBreak',
        'coverAssetId',
        'currentPicture',
        'dirtyCauses',
        'displayState',
        'downstreamShotIds',
        'durationSeconds',
        'effectiveSeedAssetId',
        'explicitSeedAssetId',
        'firstFrames',
        'frameBoundary',
        'generationProgressPercent',
        'hasEffectiveSeed',
        'id',
        'latestVideoAttemptFailed',
        'planningBoundary',
        'playedDurationSeconds',
        'retainedWork',
        'seedAuthorityStatusReady',
        'seedAuthorizationLock',
        'seedGenerationBlocked',
        'seedGenerationInFlight',
        'seedStills',
        'segmentHead',
        'segmentState',
        'shootingScript',
        'trimInSeconds',
        'trimOutSeconds',
        'videoGenerationBlocked',
        'videoGenerationInFlight',
      ].toSorted()
    );
    expect(Object.keys(makeProjection([makeBeat('fixture')])).toSorted()).toEqual(
      [
        'activeBeatIds',
        'activeBeats',
        'activeShotIds',
        'bin',
        'boardPanels',
        'cascadeProgress',
        'chainStatusReady',
        'conditioningFailures',
        'coverageGapBeatIds',
        'cut',
        'dirtyShots',
        'parkEligibility',
        'projectId',
        'projectRevision',
        'requestShapeLocked',
        'undoTop',
        'unscriptedShotIds',
        'workspaceStatusReady',
      ].toSorted()
    );
  });

  it('renders every Shot once with its own picture, status, chain and exact Beat counts', () => {
    const picture = {
      assetId: 'video_first',
      posterAssetId: 'poster_first',
      sourceDurationSeconds: 4,
      createdAt: '2026-08-28T00:00:00.000Z',
      prompt: 'First Shot',
      promptChanged: false,
      firstFrameChanged: false,
    };
    const covered = makeBeat('covered', {
      title: 'Covered',
      shots: [
        makeShot('shot_1', {
          currentPicture: picture,
          segmentState: { kind: 'failed_unbilled' },
          dirtyCauses: ['continuity_stale'],
          latestVideoAttemptFailed: true,
        }),
        makeShot('shot_2', {
          currentPicture: { ...picture, assetId: 'video_second', posterAssetId: null },
          segmentHead: false,
          videoGenerationInFlight: true,
          seedGenerationInFlight: true,
          generationProgressPercent: 23,
          activeGenerationJob: { id: 'job_hidden', purpose: 'video_take', canCancel: true },
        }),
        makeShot('shot_3', {
          chainBreak: 'hard_cut',
          segmentHead: true,
          coverAssetId: 'cover_third',
          effectiveSeedAssetId: 'cover_third',
          hasEffectiveSeed: true,
        }),
        makeShot('shot_4', { chainBreak: 'hard_cut' }),
        makeShot('shot_5', { segmentHead: false, segmentState: { kind: 'queued' } }),
        makeShot('shot_6', { chainBreak: 'hard_cut', segmentState: { kind: 'failed_unbilled' } }),
      ],
    });
    const empty = makeBeat('empty', {
      title: 'Empty',
      shots: [],
      targetSeconds: null,
      actualSeconds: null,
      displayState: 'no_coverage',
    });
    const projection = makeProjection([covered, empty]);
    const result = render(<BoardView {...boardProps(projection)} />);

    const list = screen.getByRole('list', { name: 'Beat board' });
    expect(Array.from(list.children).map((item) => (item as HTMLElement).dataset.beatId)).toEqual(['covered', 'empty']);
    const coveredCard = cardFor(result.container, 'covered');
    const tiles = coveredCard.querySelectorAll<HTMLElement>('[data-shot-tile]');
    expect(Array.from(tiles).map((tile) => tile.dataset.shotId)).toEqual([
      'shot_1',
      'shot_2',
      'shot_3',
      'shot_4',
      'shot_5',
      'shot_6',
    ]);
    expect(result.container.querySelectorAll('[data-shot-id="shot_1"]')).toHaveLength(1);
    expect(result.container.querySelectorAll('[data-shot-id="shot_2"]')).toHaveLength(1);
    expect(result.container.querySelectorAll('[data-shot-id="shot_3"]')).toHaveLength(1);
    expect(result.container.querySelectorAll('[data-shot-id="shot_4"]')).toHaveLength(1);
    expect(result.container.querySelectorAll('[data-shot-id="shot_5"]')).toHaveLength(1);
    expect(result.container.querySelectorAll('[data-shot-id="shot_6"]')).toHaveLength(1);
    const firstTile = result.container.querySelector<HTMLElement>('[data-shot-id="shot_1"]')!;
    const secondTile = result.container.querySelector<HTMLElement>('[data-shot-id="shot_2"]')!;
    const thirdTile = result.container.querySelector<HTMLElement>('[data-shot-id="shot_3"]')!;
    const fourthTile = result.container.querySelector<HTMLElement>('[data-shot-id="shot_4"]')!;
    expect(firstTile.querySelector('img')).toHaveAttribute('src', 'weprompt-studio://asset/project_1/poster_first');
    expect(secondTile.querySelector('video')).toHaveAttribute('src', 'weprompt-studio://asset/project_1/video_second');
    expect(thirdTile.querySelector('img')).toHaveAttribute('src', 'weprompt-studio://asset/project_1/cover_third');
    expect(fourthTile.querySelector('[data-media-kind="unavailable"]')).toHaveTextContent('Preview unavailable');
    expect(firstTile.querySelector('[data-composer-status-word]')).toHaveAttribute(
      'data-composer-status-word',
      'rendered'
    );
    expect(firstTile.querySelector('[data-composer-status-word]')).toHaveAttribute(
      'data-latest-attempt-failed',
      'true'
    );
    expect(firstTile).toHaveTextContent('Rendered · Stale · Latest attempt failed');
    expect(secondTile).toHaveTextContent('After 1.1');
    expect(thirdTile).toHaveTextContent('Chain head');
    expect(
      Array.from(coveredCard.querySelectorAll<HTMLElement>('[data-composer-status-word]')).map(
        (status) => status.dataset.composerStatusWord
      )
    ).toEqual(['rendered', 'rendering', 'ready', 'notReady', 'queued', 'failed']);
    expect(coveredCard).toHaveTextContent('2 of 6 rendered');
    expect(coveredCard).toHaveTextContent('1 stale Shot');
    expect(coveredCard).toHaveTextContent('1 queued or rendering Shot');
    expect(
      result.container.querySelector('[data-shot-id="shot_6"] [data-composer-status-word="failed"]')
    ).not.toBeNull();
    expect(coveredCard.textContent).not.toMatch(/\b(?:1st|2nd|3rd|\d+th)\s+(?:in line|in queue|queued)\b/i);
    expect(coveredCard).not.toHaveTextContent('23%');
    expect(coveredCard).not.toHaveTextContent('job_hidden');
    expect(coveredCard).toHaveTextContent('6 shots');
    expect(coveredCard).toHaveTextContent('8s actual');
    expect(coveredCard.querySelector('[data-duration-kind="target"]')).toBeNull();

    expect(cardFor(result.container, 'empty')).toHaveTextContent('No coverage');
    expect(cardFor(result.container, 'empty').querySelectorAll('[data-shot-tile]')).toHaveLength(0);
    expect(cardFor(result.container, 'empty')).not.toHaveTextContent('0s');

    fireEvent.error(firstTile.querySelector('img')!);
    expect(firstTile.querySelector('[data-media-kind="unavailable"]')).toHaveTextContent('Preview unavailable');
    expect(thirdTile.querySelector('img')).toHaveAttribute('src', 'weprompt-studio://asset/project_1/cover_third');
    const bin = screen.getByTestId('board-bin');
    expect(list.compareDocumentPosition(bin) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('uses a responsive Shot grid, neutral Beat openers, and Board-owned drawing without structural actions', () => {
    const actions = makeActions();
    const result = render(
      <BoardView {...boardProps(makeProjection([makeBeat('a'), makeBeat('b'), makeBeat('c')]), actions)} />
    );
    const list = screen.getByRole('list', { name: 'Beat board' });

    expect(screen.queryByRole('group', { name: 'Card size' })).toBeNull();
    expect(list).not.toHaveAttribute('data-card-size');
    for (const beatId of ['a', 'b', 'c']) {
      const card = cardFor(result.container, beatId);
      expect(within(card).getByRole('button', { name: `Open Beat ${beatId.toUpperCase()}` })).not.toHaveAttribute(
        'aria-current'
      );
      expect(within(card).queryByRole('button', { name: /(?:move|reorder|lift)/i })).toBeNull();
    }
    expect(screen.getByRole('region', { name: 'Director Board controls' })).toBeVisible();
    expect(screen.getByRole('region', { name: 'Bin' })).toBeVisible();
    expect(result.container.querySelector('[data-board-panel-shot-id][role="region"]')).toBeNull();
    expect(screen.getByRole('button', { name: 'Draw next batch (3)' })).toBeEnabled();
    expect(screen.getByRole('progressbar', { name: 'Board completeness' })).toBeVisible();
    expect(actions).not.toHaveProperty('reorderBeats');
    expect(actions).not.toHaveProperty('parkBeat');
    expect(actions.reorderBin).not.toHaveBeenCalled();

    expect(boardCss).toMatch(/\.beatList\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s);
    expect(boardCss).toMatch(
      /\.shotGrid\s*\{[^}]*grid-template-columns:\s*repeat\(auto-fill,\s*minmax\(min\(100%,\s*260px\),\s*1fr\)\)/s
    );
    expect(boardCss).toMatch(
      /\.shotScript\s*\{[^}]*overflow:\s*hidden[^}]*-webkit-box-orient:\s*vertical[^}]*-webkit-line-clamp:\s*2/s
    );
    expect(boardCss).not.toMatch(/nth-child/);
    expect(boardCss).toMatch(/\.beatTitle\s*\{[^}]*color:\s*var\(--text-primary\)/s);
    expect(boardCss).toMatch(/\.beatTitle\s*\{[^}]*font-family:\s*var\(--font-display\)/s);
    expect(boardCss).toMatch(/\.beatTitle\s*\{[^}]*font-size:\s*13px/s);
    expect(boardCss).toMatch(/\.beatTitle\s*\{[^}]*font-weight:\s*var\(--fw-semibold\)/s);
    expect(boardCss).toMatch(/\.beatTitle\s*\{[^}]*composes:\s*inkTextAction/s);
    expect(boardCss).toMatch(
      /\.beatTitle:global\(\.arco-btn-text\)[^{]*\{[^}]*border-color:\s*transparent[^}]*background-color:\s*transparent[^}]*box-shadow:\s*none/s
    );
    expect(boardCss).toMatch(/\.panelCard\s*\{[^}]*grid-template-columns:\s*96px\s+minmax\(0,\s*1fr\)/s);
    expect(boardCss).toMatch(/\.shotStatus\[data-latest-attempt-failed='true'\]/);
    expect(result.container.querySelector('[data-composer-status-word="notReady"]')).not.toBeNull();
    expect(screen.queryByRole('button', { name: /render|retry|cancel|prepare|confirm/i })).toBeNull();
    expect(result.container.textContent).not.toMatch(/\$\d|€\d|£\d/);
  });

  it('qualifies paid Beat actions by film position when authored titles repeat', () => {
    render(
      <BoardView
        {...boardProps(
          makeProjection([makeBeat('first', { title: 'Same title' }), makeBeat('second', { title: 'Same title' })])
        )}
      />
    );

    expect(screen.getByRole('group', { name: 'Actions for 1. Same title' })).toBeVisible();
    expect(screen.getByRole('group', { name: 'Actions for 2. Same title' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Draw missing (1) · 1. Same title' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Draw missing (1) · 2. Same title' })).toBeVisible();
  });

  it('summarizes 30 exact panels and caps the next paid batch at 24 drawable missing Shots', async () => {
    const user = userEvent.setup();
    const actions = makeActions();
    const shots = Array.from({ length: 30 }, (_, index) => makeShot(`shot_${index + 1}`));
    const panels = shots.map((shot, index) => {
      if (index < 2) {
        return makeBoardPanel(shot.id, {
          assetId: `panel_${index + 1}`,
          producerJobId: `job_${index + 1}`,
          latestJobId: `job_${index + 1}`,
          freshness: 'current',
        });
      }
      if (index === 2) {
        return makeBoardPanel(shot.id, {
          assetId: 'panel_stale',
          producerJobId: 'job_stale',
          latestJobId: 'job_stale',
          freshness: 'stale',
          staleCauses: ['request_out_of_date'],
        });
      }
      if (index === 3) return makeBoardPanel(shot.id, { activity: 'drawing', latestJobId: 'job_drawing' });
      if (index === 4) return makeBoardPanel(shot.id, { activity: 'queued', latestJobId: 'job_queued' });
      if (index === 5) return makeBoardPanel(shot.id, { activity: 'failed', latestJobId: 'job_failed' });
      return makeBoardPanel(shot.id);
    });
    const projection = makeProjection([makeBeat('large', { shots })], { boardPanels: panels });
    const result = render(<BoardView {...boardProps(projection, actions)} />);

    const controls = screen.getByRole('region', { name: 'Director Board controls' });
    expect(controls).toHaveTextContent('3 of 30 panels drawn');
    expect(controls).toHaveTextContent('1 stale');
    expect(controls).toHaveTextContent('2 in progress');
    expect(within(controls).getByRole('button', { name: 'Stop drawing' })).toBeEnabled();

    const settledPanels = panels.map((panel, index) => {
      if (index === 3) return makeBoardPanel(panel.shotId, { activity: 'failed', latestJobId: 'job_failed_4' });
      if (index === 4) return makeBoardPanel(panel.shotId, { activity: 'cancelled', latestJobId: 'job_cancelled_5' });
      return panel;
    });
    result.rerender(
      <BoardView
        {...boardProps(makeProjection([makeBeat('large', { shots })], { boardPanels: settledPanels }), actions)}
      />
    );

    const settledControls = screen.getByRole('region', { name: 'Director Board controls' });
    const drawNext = within(settledControls).getByRole('button', { name: 'Draw next batch (24)' });
    expect(drawNext).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Draw missing (27) · 1. Beat LARGE' })).toBeDisabled();
    await user.click(drawNext);
    expect(actions.drawNext).toHaveBeenCalledTimes(1);
  });

  it('locks paid and Bin controls when route, status, gate, or project authority is not exact', () => {
    const projection = makeProjection([makeBeat('a')]);
    const result = render(<BoardView {...boardProps(projection)} imageRouteReady={false} />);
    expect(screen.getByRole('button', { name: 'Draw next batch (1)' })).toBeDisabled();

    const statusPending = {
      ...projection,
      boardPanels: [makeBoardPanel('a_shot', { activity: 'status_pending', freshness: 'status_pending' })],
    };
    result.rerender(<BoardView {...boardProps(statusPending)} />);
    expect(screen.getByRole('button', { name: 'Draw next batch (0)' })).toBeDisabled();

    result.rerender(<BoardView {...boardProps(projection)} gateLocked />);
    expect(screen.getByRole('button', { name: 'Draw next batch (1)' })).toBeDisabled();
    expect(screen.getByTestId('board-bin')).toHaveAttribute('data-pending', 'true');

    result.rerender(<BoardView {...boardProps(projection)} projectId='project_other' />);
    expect(screen.getByText('Board unavailable')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Draw next batch (1)' })).toBeDisabled();
    expect(screen.getByTestId('board-bin')).toHaveAttribute('data-pending', 'true');
  });

  it('offers whole-Beat redraw only when every exact panel exists', () => {
    const first = makeShot('first');
    const second = makeShot('second');
    const beat = makeBeat('pair', { shots: [first, second] });
    const current = (shotId: string) =>
      makeBoardPanel(shotId, {
        assetId: `panel_${shotId}`,
        producerJobId: `job_${shotId}`,
        latestJobId: `job_${shotId}`,
        freshness: 'current',
      });
    const complete = makeProjection([beat], { boardPanels: [current(first.id), current(second.id)] });
    const result = render(<BoardView {...boardProps(complete)} />);
    expect(screen.getByRole('button', { name: 'Redraw Beat · paid · 1. Beat PAIR' })).toBeEnabled();

    const partial = makeProjection([beat], { boardPanels: [current(first.id), makeBoardPanel(second.id)] });
    result.rerender(<BoardView {...boardProps(partial)} />);
    expect(screen.queryByRole('button', { name: 'Redraw Beat · paid · 1. Beat PAIR' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Draw missing (1) · 1. Beat PAIR' })).toBeEnabled();
  });

  it('shows project and route blockers once at Board scope without mislabelling a rendered Shot', () => {
    const picture = {
      assetId: 'video_current',
      posterAssetId: 'poster_current',
      sourceDurationSeconds: 4,
      createdAt: '2026-08-28T00:00:00.000Z',
      prompt: 'Current Shot',
      promptChanged: false,
      firstFrameChanged: false,
    };
    const projection = makeProjection([makeBeat('a', { shots: [makeShot('a_shot', { currentPicture: picture })] })]);
    const status = makeProjectStatus(projection);
    status.stages = status.stages.map((stage) =>
      stage.id === 'engines'
        ? ({
            ...stage,
            state: 'blocked',
            blockers: [
              {
                cause: 'route_not_selected',
                where: { kind: 'route', routeKind: 'image' },
                remedy: { kind: 'owner_only', reason: 'select_engine' },
              },
              {
                cause: 'route_not_selected',
                where: { kind: 'route', routeKind: 'video' },
                remedy: { kind: 'owner_only', reason: 'select_engine' },
              },
            ],
          } as StudioProjectStatusStageV2)
        : stage
    );
    status.blockerCount = 2;

    const result = render(<BoardView {...boardProps(projection)} projectStatus={status} />);
    const globalBlockers = result.container.querySelector<HTMLElement>('[data-board-blockers]')!;
    const tile = result.container.querySelector<HTMLElement>('[data-shot-id="a_shot"]')!;
    expect(globalBlockers).toHaveTextContent('Image route · A generation engine is not selected.');
    expect(globalBlockers).toHaveTextContent('Video route · A generation engine is not selected.');
    expect(tile).toHaveTextContent('Rendered');
    expect(tile).not.toHaveTextContent('A generation engine is not selected.');
    expect(tile.querySelector('[data-blocker-status="available"]')).toBeNull();
  });

  it('routes an exact reference-binding blocker to Table without opening the Beat', async () => {
    const user = userEvent.setup();
    const projection = makeProjection([makeBeat('a')]);
    const referenceBlocker: StudioProjectStatusBlockerV2 = {
      cause: 'reference_binding_unassigned',
      where: {
        kind: 'shot',
        beatId: 'a',
        shotId: 'a_shot',
        beatPosition: 1,
        shotPosition: 1,
        jobId: null,
      },
      remedy: { kind: 'free_fix', op: 'set_shot_reference_binding', shotId: 'a_shot' },
    };
    const status = makeProjectStatus(projection);
    status.stages = status.stages.map((stage) =>
      stage.id === 'bindings'
        ? ({
            ...stage,
            state: 'blocked',
            summary: { ...stage.summary, readyShotCount: 0 },
            blockers: [referenceBlocker],
          } as StudioProjectStatusStageV2)
        : stage
    );
    status.detail = {
      shots: statusDetails(projection).map((detail) => ({
        ...detail,
        binding: { status: 'unassigned' as const, selectedCount: 0, limit: 3 },
      })),
      references: [],
    };
    status.blockerCount = 1;
    const onReviewReferenceBinding = vi.fn();
    const onOpenBeat = vi.fn();
    const result = render(
      <BoardView
        {...boardProps(projection)}
        onOpenBeat={onOpenBeat}
        onReviewReferenceBinding={onReviewReferenceBinding}
        projectStatus={status}
      />
    );

    const tile = result.container.querySelector<HTMLElement>('[data-shot-id="a_shot"]')!;
    expect(tile).toHaveTextContent('References are unassigned.');
    expect(tile).toHaveTextContent('Reference binding must be fixed on the Table before generation.');
    await user.click(within(tile).getByRole('button', { name: 'Review references on Table' }));
    expect(onReviewReferenceBinding).toHaveBeenCalledTimes(1);
    expect(onReviewReferenceBinding).toHaveBeenCalledWith('a_shot');
    expect(onOpenBeat).not.toHaveBeenCalled();
  });

  it('shows the shared blank-script refusal once on only the affected Shot', () => {
    const blank = makeShot('blank_shot', { shootingScript: ' \n ' });
    const authored = makeShot('authored_shot');
    const projection = makeProjection([makeBeat('a', { shots: [blank, authored] })]);
    const status = makeProjectStatus(projection);
    status.stages = status.stages.map((stage) =>
      stage.id === 'storyboard'
        ? ({
            ...stage,
            state: 'blocked',
            blockers: [
              {
                cause: 'shooting_script_required',
                where: {
                  kind: 'shot',
                  beatId: 'a',
                  shotId: 'blank_shot',
                  beatPosition: 1,
                  shotPosition: 1,
                  jobId: null,
                },
                remedy: { kind: 'owner_only', reason: 'review_project_data' },
              },
            ],
          } as StudioProjectStatusStageV2)
        : stage
    );
    status.blockerCount = 1;

    const result = render(<BoardView {...boardProps(projection)} projectStatus={status} />);
    const blankTile = result.container.querySelector<HTMLElement>('[data-shot-id="blank_shot"]')!;
    const authoredTile = result.container.querySelector<HTMLElement>('[data-shot-id="authored_shot"]')!;
    const copy = 'Write this Shot’s Shooting script before generating media.';

    expect(within(blankTile).getAllByText(copy)).toHaveLength(1);
    expect(blankTile.querySelector('[data-blocker-status="available"]')).toBeNull();
    expect(blankTile).not.toHaveTextContent('Blocked by');
    expect(authoredTile).not.toHaveTextContent(copy);
  });

  it('keeps blocker authority quiet while project status is still loading', () => {
    const projection = makeProjection([makeBeat('a'), makeBeat('b')]);
    const result = render(<BoardView {...boardProps(projection)} projectStatus={null} projectStatusPending />);

    expect(result.container.querySelectorAll('[data-composer-status-word]')).toHaveLength(2);
    expect(result.container.querySelector('[data-blocker-status="unavailable"]')).toBeNull();
    expect(result.container).not.toHaveTextContent('Blocker details unavailable');
    expect(result.container.querySelector('[data-blocker-status="available"]')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Review references on Table' })).toBeNull();

    result.rerender(<BoardView {...boardProps(projection)} projectStatus={null} projectStatusPending={false} />);
    expect(result.container.querySelectorAll('[data-blocker-status="unavailable"]')).toHaveLength(2);
  });

  it('withholds actionable blocker copy for stale or malformed status while keeping live Shot status', () => {
    const projection = makeProjection([makeBeat('a')]);
    const result = render(
      <BoardView
        {...boardProps(projection)}
        projectStatus={makeProjectStatus(projection, { projectRevision: projection.projectRevision + 1 })}
      />
    );

    const tile = result.container.querySelector<HTMLElement>('[data-shot-id="a_shot"]')!;
    expect(tile.querySelector('[data-composer-status-word]')).toHaveAttribute('data-composer-status-word', 'notReady');
    expect(tile.querySelector('[data-blocker-status="unavailable"]')).toHaveTextContent('Blocker details unavailable');
    expect(within(tile).queryByRole('button', { name: 'Review references on Table' })).toBeNull();
  });

  it('owns exact Board-panel drawing, redraw, and promotion while leaving structure elsewhere', async () => {
    const user = userEvent.setup();
    const actions = makeActions();
    const missingBeat = makeBeat('missing');
    const currentBeat = makeBeat('current');
    const projection = makeProjection([missingBeat, currentBeat], {
      boardPanels: [
        makeBoardPanel('missing_shot'),
        makeBoardPanel('current_shot', {
          assetId: 'panel_current',
          producerJobId: 'panel_job',
          latestJobId: 'panel_job',
          freshness: 'current',
        }),
      ],
    });
    const result = render(<BoardView {...boardProps(projection, actions)} />);

    await user.click(screen.getByRole('button', { name: 'Draw next batch (1)' }));
    await user.click(
      within(cardFor(result.container, 'missing')).getByRole('button', {
        name: 'Draw missing (1) · 1. Beat MISSING',
      })
    );
    const currentCard = cardFor(result.container, 'current');
    await user.click(within(currentCard).getByRole('button', { name: 'Redraw Beat · paid · 2. Beat CURRENT' }));
    const currentTile = currentCard.querySelector<HTMLElement>('[data-shot-id="current_shot"]')!;
    const panelCard = currentTile.querySelector<HTMLElement>('[data-board-panel-shot-id="current_shot"]')!;
    expect(panelCard).toHaveTextContent('Board panel');
    expect(panelCard.querySelector('img')).toHaveAttribute('src', 'weprompt-studio://asset/project_1/panel_current');
    await user.click(within(panelCard).getByRole('button', { name: 'Redraw Shot 2.1 · paid' }));
    await user.click(within(panelCard).getByRole('button', { name: 'Use Shot 2.1 panel as first frame' }));

    expect(actions.drawNext).toHaveBeenCalledTimes(1);
    expect(actions.drawBeat).toHaveBeenCalledWith('missing');
    expect(actions.redrawBeat).toHaveBeenCalledWith('current');
    expect(actions.redrawShot).toHaveBeenCalledWith('current_shot');
    expect(actions.promotePanel).toHaveBeenCalledWith('current_shot', 'panel_current');
    expect(screen.queryByRole('button', { name: /(?:move|reorder|lift).*(?:Beat|beat)/ })).toBeNull();
  });

  it('keeps retry, duplicate-charge acknowledgement, download recovery, and cancellation on exact Shot panels', async () => {
    const user = userEvent.setup();
    const actions = makeActions();
    const beat = makeBeat('a', {
      shots: [makeShot('retry'), makeShot('unknown'), makeShot('download')],
    });
    const projection = makeProjection([beat], {
      boardPanels: [
        makeBoardPanel('retry', {
          activity: 'needs_attention',
          latestJobId: 'job_retry',
          recovery: {
            jobId: 'job_retry',
            canRetry: true,
            canCancel: false,
            canRetryDownload: false,
            submissionUnknown: false,
          },
        }),
        makeBoardPanel('unknown', {
          activity: 'needs_attention',
          latestJobId: 'job_unknown',
          recovery: {
            jobId: 'job_unknown',
            canRetry: true,
            canCancel: true,
            canRetryDownload: false,
            submissionUnknown: true,
          },
        }),
        makeBoardPanel('download', {
          assetId: 'panel_download',
          activity: 'failed',
          freshness: 'current',
          latestJobId: 'job_download',
          recovery: {
            jobId: 'job_download',
            canRetry: false,
            canCancel: false,
            canRetryDownload: true,
            submissionUnknown: false,
          },
        }),
      ],
    });
    const result = render(<BoardView {...boardProps(projection, actions)} />);
    const retryPanel = result.container.querySelector<HTMLElement>('[data-board-panel-shot-id="retry"]')!;
    const unknownPanel = result.container.querySelector<HTMLElement>('[data-board-panel-shot-id="unknown"]')!;
    const downloadPanel = result.container.querySelector<HTMLElement>('[data-board-panel-shot-id="download"]')!;
    expect(within(downloadPanel).getByRole('button', { name: 'Retry download · 1.3' })).toBeVisible();
    expect(within(downloadPanel).queryByRole('button', { name: /Redraw Shot/ })).toBeNull();

    await user.click(within(retryPanel).getByRole('button', { name: 'Retry · 1.1' }));
    expect(actions.retryJob).toHaveBeenCalledWith('job_retry', false);
    expect(retryPanel).toHaveFocus();

    await user.click(within(unknownPanel).getByRole('button', { name: 'Retry · 1.2' }));
    expect(actions.retryJob).not.toHaveBeenCalledWith('job_unknown', true);
    const confirmation = screen.getByRole('group', { name: 'Possible duplicate charge' });
    expect(confirmation).toHaveTextContent('provider may already have accepted');
    await user.click(within(confirmation).getByRole('button', { name: 'Retry and accept risk' }));
    expect(actions.retryJob).toHaveBeenCalledWith('job_unknown', true);

    await user.click(within(unknownPanel).getByRole('button', { name: 'Cancel job · 1.2' }));
    await user.click(within(downloadPanel).getByRole('button', { name: 'Retry download · 1.3' }));
    expect(actions.cancelJob).toHaveBeenCalledWith('job_unknown');
    expect(actions.retryDownload).toHaveBeenCalledWith('job_download');
    expect(downloadPanel).toHaveFocus();

    result.rerender(<BoardView {...boardProps(projection, actions)} gateLocked />);
    expect(within(retryPanel).getByRole('button', { name: 'Retry · 1.1' })).toBeDisabled();
    expect(within(unknownPanel).getByRole('button', { name: 'Cancel job · 1.2' })).toBeDisabled();
    expect(within(downloadPanel).getByRole('button', { name: 'Retry download · 1.3' })).toBeDisabled();

    const recoveredProjection = {
      ...projection,
      boardPanels: projection.boardPanels.map((panel) => (panel.shotId === 'retry' ? makeBoardPanel('retry') : panel)),
    };
    result.rerender(<BoardView {...boardProps(recoveredProjection, actions)} />);
    await waitFor(() => expect(downloadPanel).toHaveFocus());
  });

  it('explains and disables Board-panel promotion while authorized work locks the first frame', async () => {
    const user = userEvent.setup();
    const actions = makeActions();
    const lockedShot = makeShot('locked_shot', {
      seedAuthorizationLock: {
        compatibleAssetIds: [],
        canCancelWaiting: true,
        waitingReason: 'choose_seed',
      },
    });
    const lockedDownstream = makeShot('locked_downstream', {
      segmentHead: false,
      videoGenerationBlocked: true,
    });
    const projection = makeProjection([makeBeat('locked', { shots: [lockedShot, lockedDownstream] })], {
      boardPanels: [
        makeBoardPanel('locked_shot', {
          assetId: 'locked_panel',
          producerJobId: 'panel_job',
          latestJobId: 'panel_job',
          freshness: 'current',
        }),
        makeBoardPanel('locked_downstream', {
          assetId: 'downstream_panel',
          producerJobId: 'downstream_panel_job',
          latestJobId: 'downstream_panel_job',
          freshness: 'current',
        }),
      ],
    });
    render(<BoardView {...boardProps(projection, actions)} />);

    const promote = screen.getByRole('button', { name: 'Use Shot 1.1 panel as first frame' });
    expect(promote).toBeDisabled();
    expect(promote.closest('[data-board-panel-shot-id]')).toHaveTextContent(
      'Authorized video work has locked this Shot’s first frame.'
    );
    await user.click(promote);
    expect(actions.promotePanel).not.toHaveBeenCalled();
  });

  it('stops exact busy Board work and locks the control during another confirmation', async () => {
    const user = userEvent.setup();
    const actions = makeActions();
    const projection = makeProjection([makeBeat('a')], {
      boardPanels: [
        makeBoardPanel('a_shot', {
          activity: 'drawing',
          latestJobId: 'job_drawing',
        }),
      ],
    });
    const result = render(<BoardView {...boardProps(projection, actions)} />);

    const stop = screen.getByRole('button', { name: 'Stop drawing' });
    expect(stop).toBeEnabled();
    expect(screen.getByRole('region', { name: 'Director Board controls' })).toHaveTextContent(
      'Completed panels and charges already incurred remain.'
    );
    await user.click(stop);
    expect(actions.stop).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('region', { name: 'Director Board controls' })).toHaveFocus();

    result.rerender(<BoardView {...boardProps(projection, actions)} gateLocked />);
    expect(screen.getByRole('button', { name: 'Stop drawing' })).toBeDisabled();
    expect(screen.getByTestId('board-bin')).toHaveAttribute('data-pending', 'true');

    result.rerender(<BoardView {...boardProps(makeProjection([makeBeat('a')]), actions)} />);
    expect(screen.getByRole('region', { name: 'Director Board controls' })).toHaveFocus();
  });

  it('fails closed when Board panel order cannot be correlated to exact film order', () => {
    const actions = makeActions();
    const projection = makeProjection([makeBeat('a', { shots: [makeShot('first'), makeShot('second')] })], {
      boardPanels: [
        makeBoardPanel('second', {
          activity: 'needs_attention',
          latestJobId: 'job_second',
          recovery: {
            jobId: 'job_second',
            canRetry: true,
            canCancel: true,
            canRetryDownload: false,
            submissionUnknown: false,
          },
        }),
        makeBoardPanel('first', {
          assetId: 'wrong_panel',
          freshness: 'current',
        }),
      ],
    });
    const result = render(<BoardView {...boardProps(projection, actions)} />);

    expect(result.container.querySelectorAll('[data-panel-activity="status_pending"]')).toHaveLength(2);
    expect(result.container.querySelector('[data-board-recovery-job-id]')).toBeNull();
    expect(screen.getByRole('button', { name: 'Draw next batch (0)' })).toBeDisabled();
    expect(actions.retryJob).not.toHaveBeenCalled();
    expect(actions.promotePanel).not.toHaveBeenCalled();
  });

  it('hands an external rendered-Shot request to the exact Bin focus model and does nothing without a request', async () => {
    const projection = makeProjection([makeBeat('a')]);
    const onBinFocusItemSettled = vi.fn();
    const result = render(<BoardView {...boardProps(projection)} onBinFocusItemSettled={onBinFocusItemSettled} />);
    const focusTarget = screen.getByTestId('bin-focus-target');
    const selectedBeat = screen.getByRole('button', { name: 'Open Beat A' });
    act(() => selectedBeat.focus());

    expect(focusTarget).not.toHaveAttribute('data-bin-focus-key');
    expect(focusTarget).not.toHaveFocus();
    expect(onBinFocusItemSettled).not.toHaveBeenCalled();

    result.rerender(
      <BoardView
        {...boardProps(projection)}
        binFocusAnnouncement='Shot moved to the Bin.'
        binFocusItemKey='shot:rendered_shot'
        onBinFocusItemSettled={onBinFocusItemSettled}
        selectedBeatId='a'
      />
    );

    await waitFor(() => expect(focusTarget).toHaveFocus());
    expect(focusTarget).toHaveAttribute('data-bin-focus-key', 'shot:rendered_shot');
    expect(onBinFocusItemSettled).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Open Beat A' })).toHaveAttribute('aria-current', 'true');
    const announcement = result.container.querySelector('[data-studio-shot-lift-announcement]');
    expect(announcement).toHaveAttribute('aria-live', 'polite');
    expect(announcement).toHaveAttribute('aria-atomic', 'true');
    expect(announcement).toHaveTextContent('Shot moved to the Bin.');
  });

  it('focuses a restored owner Beat after the projection refreshes', async () => {
    const actions = makeActions();
    const initial = makeProjection([makeBeat('a')]);
    const result = render(<BoardView {...boardProps(initial, actions)} selectedBeatId='a' />);

    fireEvent.click(screen.getByRole('button', { name: 'Report restored Beat' }));
    result.rerender(
      <BoardView {...boardProps(makeProjection([makeBeat('a'), makeBeat('restored')]), actions)} selectedBeatId='a' />
    );
    await waitFor(() => expect(screen.getByRole('button', { name: 'Open Beat RESTORED' })).toHaveFocus());
  });

  it('focuses the retained Bin owner when a restored Shot belongs to a still-binned Beat', async () => {
    const parked = makeBeat('parked');
    const projection = makeProjection([makeBeat('active')], {
      bin: {
        items: [
          {
            kind: 'beat',
            position: 1,
            identity: { kind: 'beat', beatId: 'parked', reason: 'lifted' },
            value: { ...parked, reason: 'lifted', shotCount: parked.shots.length },
          },
        ],
        beats: [{ ...parked, reason: 'lifted', shotCount: parked.shots.length }],
        shots: [],
      },
    });
    render(<BoardView {...boardProps(projection)} />);

    fireEvent.click(screen.getByRole('button', { name: 'Report restored binned-owner Shot' }));
    await waitFor(() => expect(screen.getByTestId('bin-focus-target')).toHaveFocus());
  });
  it('captures a poster the first time the Board decodes a Shot video, and only once', async () => {
    // BUG-166: a Shot only gained a poster when someone opened its Beat panel, so the Board — the
    // one surface that shows every Shot at once — had none to show for any Shot nobody had opened.
    const restoreCanvas = stubCanvasCapture();
    try {
      const actions = makeActions();
      const projection = makeProjection([
        makeBeat('beat_1', {
          shots: [
            makeShot('shot_1', {
              currentPicture: {
                assetId: 'video_first',
                posterAssetId: null,
                sourceDurationSeconds: 4,
                createdAt: '2026-08-28T00:00:00.000Z',
                prompt: 'First Shot',
                promptChanged: false,
                firstFrameChanged: false,
              },
            }),
          ],
        }),
      ]);
      render(<BoardView {...boardProps(projection)} actions={actions} />);

      const video = screen.getByLabelText('Current Shot video') as HTMLVideoElement;
      Object.defineProperty(video, 'videoWidth', { configurable: true, value: 1920 });
      Object.defineProperty(video, 'videoHeight', { configurable: true, value: 1080 });

      fireEvent.loadedData(video);
      await waitFor(() =>
        expect(actions.persistCapturedPoster).toHaveBeenCalledWith({
          shotId: 'shot_1',
          videoAssetId: 'video_first',
          dataUrl: 'data:image/png;base64,AAAA',
          width: 1920,
          height: 1080,
        })
      );

      // A tile can fire loadedData repeatedly; the capture must not be paid for twice.
      fireEvent.loadedData(video);
      await waitFor(() => expect(actions.persistCapturedPoster).toHaveBeenCalledTimes(1));
    } finally {
      restoreCanvas();
    }
  });

  it('refuses a blank decoded frame and retries after a frame is presented', async () => {
    const restoreCanvas = stubCanvasCapture({ blank: true });
    const presented: Array<() => void> = [];
    try {
      const actions = makeActions();
      const projection = makeProjection([
        makeBeat('beat_1', {
          shots: [
            makeShot('shot_1', {
              currentPicture: {
                assetId: 'video_first',
                posterAssetId: null,
                sourceDurationSeconds: 4,
                createdAt: '2026-08-28T00:00:00.000Z',
                prompt: 'First Shot',
                promptChanged: false,
                firstFrameChanged: false,
              },
            }),
          ],
        }),
      ]);
      render(<BoardView {...boardProps(projection)} actions={actions} />);

      const video = screen.getByLabelText('Current Shot video') as HTMLVideoElement;
      Object.defineProperty(video, 'videoWidth', { configurable: true, value: 1920 });
      Object.defineProperty(video, 'videoHeight', { configurable: true, value: 1080 });
      Object.defineProperty(video, 'requestVideoFrameCallback', {
        configurable: true,
        value: (callback: () => void) => presented.push(callback),
      });

      fireEvent.loadedData(video);
      await waitFor(() => expect(presented).toHaveLength(1));
      expect(actions.persistCapturedPoster).not.toHaveBeenCalled();

      restoreCanvas();
      const restorePresentedCanvas = stubCanvasCapture();
      try {
        presented[0]!();
        await waitFor(() =>
          expect(actions.persistCapturedPoster).toHaveBeenCalledWith({
            shotId: 'shot_1',
            videoAssetId: 'video_first',
            dataUrl: 'data:image/png;base64,AAAA',
            width: 1920,
            height: 1080,
          })
        );
      } finally {
        restorePresentedCanvas();
      }
    } finally {
      restoreCanvas();
    }
  });

  it('does not persist a presented frame after its Board video disconnects', async () => {
    const restoreCanvas = stubCanvasCapture({ blank: true });
    const presented: Array<() => void> = [];
    try {
      const actions = makeActions();
      const projection = makeProjection([
        makeBeat('beat_1', {
          shots: [
            makeShot('shot_1', {
              currentPicture: {
                assetId: 'video_first',
                posterAssetId: null,
                sourceDurationSeconds: 4,
                createdAt: '2026-08-28T00:00:00.000Z',
                prompt: 'First Shot',
                promptChanged: false,
                firstFrameChanged: false,
              },
            }),
          ],
        }),
      ]);
      const rendered = render(<BoardView {...boardProps(projection)} actions={actions} />);
      const video = screen.getByLabelText('Current Shot video') as HTMLVideoElement;
      Object.defineProperty(video, 'videoWidth', { configurable: true, value: 1920 });
      Object.defineProperty(video, 'videoHeight', { configurable: true, value: 1080 });
      Object.defineProperty(video, 'requestVideoFrameCallback', {
        configurable: true,
        value: (callback: () => void) => presented.push(callback),
      });

      fireEvent.loadedData(video);
      await waitFor(() => expect(presented).toHaveLength(1));
      rendered.unmount();
      presented[0]!();
      await Promise.resolve();

      expect(actions.persistCapturedPoster).not.toHaveBeenCalled();
    } finally {
      restoreCanvas();
    }
  });
});
