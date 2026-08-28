/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React, { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type {
  StudioProjectStatusBlockerV2,
  StudioProjectStatusShotDetailV2,
  StudioProjectStatusStageV2,
  StudioProjectStatusV2,
  StudioRendererParkEligibilityV2,
} from '@/common/types/project/creativeStudioTypes';
import type {
  WorkspaceBeatProjection,
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
        'conversation.creativeStudio.workspace.board.actionsLabel': 'Actions for Beat A',
        'conversation.creativeStudio.workspace.board.selectedBeat': 'Selected Beat',
        'conversation.creativeStudio.workspace.board.noCoverage': 'No coverage',
        'conversation.creativeStudio.workspace.board.coverUnavailable': 'Preview unavailable',
        'conversation.creativeStudio.workspace.board.reorderFailed': 'Beat order was not changed.',
        'conversation.creativeStudio.workspace.board.liftBeat': 'Lift Beat',
        'conversation.creativeStudio.workspace.board.liftConfirmContent': 'All authored work is kept in the Bin.',
        'conversation.creativeStudio.workspace.board.liftUnavailable':
          'Refresh the current workspace status before lifting this Beat.',
        'conversation.creativeStudio.workspace.board.liftDirtyDraft': 'Save or reset local edits before lifting.',
        'conversation.creativeStudio.workspace.board.liftSucceeded': 'Beat moved to the Bin.',
        'conversation.creativeStudio.workspace.board.liftFailed': 'Beat was not moved to the Bin.',
        'conversation.creativeStudio.workspace.board.statusUnavailable': 'Board unavailable',
        'conversation.creativeStudio.workspace.board.shot.videoPreview': 'Current Shot video',
        'conversation.creativeStudio.workspace.board.shot.stale': 'Stale',
        'conversation.creativeStudio.workspace.board.shot.chainHead': 'Chain head',
        'conversation.creativeStudio.workspace.board.shot.scriptUnavailable': 'Shooting script not written',
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
        'conversation.creativeStudio.workspace.beatPanel.untitledBeat': 'Untitled Beat',
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
      };
      if (key === 'conversation.creativeStudio.workspace.board.ordinal') {
        return String(values?.index ?? 0).padStart(2, '0');
      }
      if (key === 'conversation.creativeStudio.workspace.board.shotCount') {
        const count = Number(values?.count ?? 0);
        return `${count} ${count === 1 ? 'shot' : 'shots'}`;
      }
      if (key === 'conversation.creativeStudio.workspace.board.targetDuration') {
        return `~${String(values?.seconds)}s target`;
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
      if (key === 'conversation.creativeStudio.workspace.board.actionsLabel') {
        return `Actions for ${String(values?.title)}`;
      }
      if (key === 'conversation.creativeStudio.workspace.board.dragHandle') {
        return `Reorder ${String(values?.title)} at position ${String(values?.position)}`;
      }
      if (key === 'conversation.creativeStudio.workspace.board.moveEarlier') {
        return `Move ${String(values?.title)} earlier`;
      }
      if (key === 'conversation.creativeStudio.workspace.board.moveLater') return `Move ${String(values?.title)} later`;
      if (key === 'conversation.creativeStudio.workspace.board.reorderAnnouncement') {
        return `Moved ${String(values?.title)} from ${String(values?.from)} to ${String(values?.to)} of ${String(values?.total)}.`;
      }
      if (key === 'conversation.creativeStudio.workspace.board.liftConfirmTitle') {
        return `Lift ${String(values?.title)}?`;
      }
      return copy[key] ?? key;
    },
  }),
}));

vi.mock('@/renderer/pages/studio/components/Workspace/Views/Board/Bin', async () => {
  const ReactModule = await import('react');
  const Bin = ({ focusItemKey, onFocusItemSettled, onRestoreSuccess }: MockBinProps) => {
    const focusTarget = ReactModule.useRef<HTMLButtonElement | null>(null);
    ReactModule.useEffect(() => {
      if (focusItemKey === null || focusTarget.current === null) return;
      focusTarget.current.focus();
      onFocusItemSettled();
    }, [focusItemKey, onFocusItemSettled]);
    return (
      <section aria-label='Bin' data-testid='board-bin'>
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
  hasEffectiveSeed: false,
  ...overrides,
});

const makeBeat = (id: string, overrides: Partial<WorkspaceBeatProjection> = {}): WorkspaceBeatProjection => ({
  id,
  title: `Beat ${id.toUpperCase()}`,
  story: `Story ${id}`,
  targetSeconds: 8,
  actualSeconds: 8,
  displayState: 'ready',
  shots: [makeShot(`${id}_shot`)],
  coverAssetId: null,
  retainedWork: false,
  ...overrides,
});

const parkRow = (
  beatId: string,
  overrides: Partial<StudioRendererParkEligibilityV2> = {}
): StudioRendererParkEligibilityV2 => ({
  subject: 'beat',
  action: 'park',
  beatId,
  shotId: null,
  allowed: true,
  blockers: [],
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
  boardPanels: [],
  dirtyShots: [],
  cascadeProgress: [],
  parkEligibility: beats.map((beat) => parkRow(beat.id)),
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
  reorderBeats: vi.fn().mockResolvedValue(true),
  parkBeat: vi.fn().mockResolvedValue(true),
  restoreBeat: vi.fn().mockResolvedValue(true),
  restoreShot: vi.fn().mockResolvedValue(true),
  reorderBin: vi.fn().mockResolvedValue(true),
});

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
  selectedBeatId: null,
  dirtyBeatIds: [],
  pending: false,
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
        makeShot('shot_1', { currentPicture: picture, segmentState: { kind: 'stale' } }),
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
    expect(firstTile).toHaveTextContent('Rendered · Stale');
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
    expect(coveredCard.textContent).not.toMatch(/\b(?:1st|2nd|3rd|\d+th)\s+(?:in line|in queue|queued)\b/i);
    expect(coveredCard).not.toHaveTextContent('23%');
    expect(coveredCard).not.toHaveTextContent('job_hidden');
    expect(coveredCard).toHaveTextContent('6 shots');
    expect(coveredCard).toHaveTextContent('8s actual');
    expect(coveredCard).toHaveTextContent('~8s target');

    expect(cardFor(result.container, 'empty')).toHaveTextContent('No coverage');
    expect(cardFor(result.container, 'empty').querySelectorAll('[data-shot-tile]')).toHaveLength(0);
    expect(cardFor(result.container, 'empty')).not.toHaveTextContent('0s');

    fireEvent.error(firstTile.querySelector('img')!);
    expect(firstTile.querySelector('[data-media-kind="unavailable"]')).toHaveTextContent('Preview unavailable');
    expect(thirdTile.querySelector('img')).toHaveAttribute('src', 'weprompt-studio://asset/project_1/cover_third');
    const bin = screen.getByTestId('board-bin');
    expect(list.compareDocumentPosition(bin) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('uses a responsive Shot grid, neutral Beat openers, and no paid or recovery controls', () => {
    const actions = makeActions();
    const result = render(
      <BoardView {...boardProps(makeProjection([makeBeat('a'), makeBeat('b'), makeBeat('c')]), actions)} />
    );
    const list = screen.getByRole('list', { name: 'Beat board' });

    expect(screen.queryByRole('group', { name: 'Card size' })).toBeNull();
    expect(list).not.toHaveAttribute('data-card-size');
    for (const beatId of ['a', 'b', 'c']) {
      const card = cardFor(result.container, beatId);
      expect(within(card).getAllByRole('button')).toHaveLength(1);
      expect(within(card).getByRole('button', { name: `Open Beat ${beatId.toUpperCase()}` })).not.toHaveAttribute(
        'aria-current'
      );
      expect(within(card).queryByRole('button', { name: /(?:move|reorder|lift)/i })).toBeNull();
    }
    expect(screen.queryByRole('group', { name: /Actions for/ })).toBeNull();
    expect(actions.reorderBeats).not.toHaveBeenCalled();
    expect(actions.parkBeat).not.toHaveBeenCalled();
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
    expect(boardCss).toMatch(
      /\.liftBeat[^,{]*\[aria-disabled='true'\][^{]*\{[^}]*color:\s*var\(--text-disabled\)[^}]*cursor:\s*not-allowed/s
    );
    expect(result.container.querySelector('[data-composer-status-word="notReady"]')).not.toBeNull();
    expect(screen.queryByRole('button', { name: /generate|render|retry|cancel|prepare|confirm/i })).toBeNull();
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(result.container.textContent).not.toMatch(/\$\d|€\d|£\d/);
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

  it('opens from the neutral Beat target, exposes actions only on the selected Beat, and preserves paid Shots', async () => {
    const user = userEvent.setup();
    const projection = makeProjection([makeBeat('a'), makeBeat('b')]);
    const Harness = () => {
      const [selectedBeatId, setSelectedBeatId] = useState<string | null>('a');
      const [selectedShotIds] = useState(['a_shot']);
      return (
        <>
          <output data-testid='selection'>{JSON.stringify({ selectedBeatId, selectedShotIds })}</output>
          <BoardView {...boardProps(projection)} onOpenBeat={setSelectedBeatId} selectedBeatId={selectedBeatId} />
        </>
      );
    };
    const result = render(<Harness />);

    const firstCard = cardFor(result.container, 'a');
    const secondCard = cardFor(result.container, 'b');
    expect(within(firstCard).getByRole('button', { name: 'Open Beat A' })).toHaveAttribute('aria-current', 'true');
    expect(within(firstCard).getByRole('group', { name: 'Actions for Beat A' })).toBeVisible();
    expect(within(secondCard).getAllByRole('button')).toHaveLength(1);
    await user.click(within(secondCard).getByRole('button', { name: 'Open Beat B' }));
    expect(JSON.parse(screen.getByTestId('selection').textContent ?? '{}')).toEqual({
      selectedBeatId: 'b',
      selectedShotIds: ['a_shot'],
    });
    expect(within(secondCard).getByRole('button', { name: 'Open Beat B' })).toHaveAttribute('aria-current', 'true');
    const actionsGroup = within(secondCard).getByRole('group', { name: 'Actions for Beat B' });
    expect(actionsGroup.compareDocumentPosition(within(secondCard).getByRole('button', { name: 'Open Beat B' }))).toBe(
      Node.DOCUMENT_POSITION_PRECEDING
    );
    act(() => within(actionsGroup).getByRole('button', { name: 'Move Beat B earlier' }).focus());
    fireEvent.keyDown(actionsGroup, { key: 'Escape' });
    expect(within(secondCard).getByRole('button', { name: 'Open Beat B' })).toHaveFocus();
    fireEvent.click(cardFor(result.container, 'a'));
    expect(JSON.parse(screen.getByTestId('selection').textContent ?? '{}').selectedBeatId).toBe('b');
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('sends exact whole-order keyboard payloads, announces global positions, and restores moved identity focus', async () => {
    const actions = makeActions();
    const projection = makeProjection([makeBeat('a'), makeBeat('b'), makeBeat('c')]);
    const Harness = () => {
      const [selectedBeatId, setSelectedBeatId] = useState<string | null>('a');
      return (
        <BoardView
          {...boardProps(projection, actions)}
          onOpenBeat={setSelectedBeatId}
          selectedBeatId={selectedBeatId}
        />
      );
    };
    render(<Harness />);

    fireEvent.click(screen.getByRole('button', { name: 'Move Beat A later' }));
    await waitFor(() => expect(actions.reorderBeats).toHaveBeenLastCalledWith(['b', 'a', 'c']));
    expect(screen.getByRole('button', { name: 'Open Beat A' })).toHaveFocus();
    expect(document.querySelector('[aria-live="polite"]')).toHaveTextContent('Moved Beat A from 1 to 2 of 3.');

    fireEvent.click(screen.getByRole('button', { name: 'Open Beat C' }));
    fireEvent.keyDown(screen.getByRole('button', { name: 'Reorder Beat C at position 3' }), { key: 'Home' });
    await waitFor(() => expect(actions.reorderBeats).toHaveBeenLastCalledWith(['c', 'a', 'b']));
    expect(screen.getByRole('button', { name: 'Open Beat C' })).toHaveFocus();

    fireEvent.click(screen.getByRole('button', { name: 'Open Beat A' }));
    fireEvent.keyDown(screen.getByRole('button', { name: 'Reorder Beat A at position 1' }), { key: 'End' });
    await waitFor(() => expect(actions.reorderBeats).toHaveBeenLastCalledWith(['b', 'c', 'a']));
    expect(screen.getByRole('button', { name: 'Open Beat A' })).toHaveFocus();
    expect(actions.parkBeat).not.toHaveBeenCalled();
    expect(actions.reorderBin).not.toHaveBeenCalled();
  });

  it('keeps contextual reorder single-flight while the exact native action is pending', async () => {
    let finish!: (value: boolean) => void;
    const actions = makeActions();
    vi.mocked(actions.reorderBeats).mockReturnValueOnce(
      new Promise<boolean>((resolvePromise) => {
        finish = resolvePromise;
      })
    );
    render(<BoardView {...boardProps(makeProjection([makeBeat('a'), makeBeat('b')]), actions)} selectedBeatId='a' />);
    const moveLater = screen.getByRole('button', { name: 'Move Beat A later' });

    fireEvent.click(moveLater);
    fireEvent.click(moveLater);
    expect(actions.reorderBeats).toHaveBeenCalledTimes(1);
    expect(actions.reorderBeats).toHaveBeenCalledWith(['b', 'a']);
    const guardedLift = screen.getByRole('button', { name: 'Lift Beat' });
    expect(guardedLift).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(guardedLift);
    expect(actions.parkBeat).not.toHaveBeenCalled();

    finish(true);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Open Beat A' })).toHaveFocus());
  });

  it('uses pointer drag and canonical earlier/later semantics unchanged in RTL without optimistic DOM order', async () => {
    const actions = makeActions();
    const projection = makeProjection([makeBeat('a'), makeBeat('b'), makeBeat('c')]);
    const Harness = () => {
      const [selectedBeatId, setSelectedBeatId] = useState<string | null>('a');
      return (
        <BoardView
          {...boardProps(projection, actions)}
          onOpenBeat={setSelectedBeatId}
          selectedBeatId={selectedBeatId}
        />
      );
    };
    const result = render(
      <div dir='rtl'>
        <Harness />
      </div>
    );
    const transferBytes = new Map<string, string>();
    const dataTransfer = {
      effectAllowed: 'none',
      setData: (format: string, value: string) => transferBytes.set(format, value),
      getData: (format: string) => transferBytes.get(format) ?? '',
    };
    fireEvent.dragStart(screen.getByRole('button', { name: 'Reorder Beat A at position 1' }), { dataTransfer });
    fireEvent.dragOver(cardFor(result.container, 'c'), { dataTransfer });
    fireEvent.drop(cardFor(result.container, 'c'), { dataTransfer });
    await waitFor(() => expect(actions.reorderBeats).toHaveBeenLastCalledWith(['b', 'c', 'a']));
    expect(
      Array.from(screen.getByRole('list', { name: 'Beat board' }).children).map(
        (item) => (item as HTMLElement).dataset.beatId
      )
    ).toEqual(['a', 'b', 'c']);
    expect(screen.getByRole('button', { name: 'Open Beat A' })).toHaveFocus();

    fireEvent.click(screen.getByRole('button', { name: 'Open Beat B' }));
    fireEvent.keyDown(screen.getByRole('button', { name: 'Reorder Beat B at position 2' }), { key: 'ArrowUp' });
    await waitFor(() => expect(actions.reorderBeats).toHaveBeenLastCalledWith(['b', 'a', 'c']));

    vi.mocked(actions.reorderBeats).mockClear();
    dataTransfer.setData('text/plain', 'a');
    fireEvent.dragOver(cardFor(result.container, 'c'), { dataTransfer });
    fireEvent.drop(cardFor(result.container, 'c'), { dataTransfer });
    expect(actions.reorderBeats).not.toHaveBeenCalled();
  });

  it('fails closed for unavailable, duplicate, blocked, and dirty lift facts in deterministic blocker order', () => {
    const beats = [makeBeat('a'), makeBeat('b'), makeBeat('c'), makeBeat('d')];
    const projection = makeProjection(beats, {
      parkEligibility: [
        parkRow('a'),
        parkRow('a'),
        parkRow('b'),
        parkRow('c', {
          allowed: false,
          blockers: [
            { shotId: 'c_shot', code: 'own_pending_frame' },
            { shotId: 'c_shot', code: 'downstream_nonterminal_job' },
          ],
        }),
        parkRow('d'),
      ],
    });
    const actions = makeActions();
    const result = render(<BoardView {...boardProps(projection, actions)} dirtyBeatIds={['b']} selectedBeatId='a' />);

    const select = (beatId: string, nextProjection = projection, dirtyBeatIds: readonly string[] = ['b']) => {
      result.rerender(
        <BoardView {...boardProps(nextProjection, actions)} dirtyBeatIds={dirtyBeatIds} selectedBeatId={beatId} />
      );
      const card = cardFor(result.container, beatId);
      const group = within(card).getByRole('group', { name: `Actions for Beat ${beatId.toUpperCase()}` });
      expect(screen.getAllByRole('group', { name: /Actions for/ })).toHaveLength(1);
      return group;
    };

    let actionRegion = select('a');
    expect(actionRegion).toHaveTextContent('Refresh the current workspace status');
    expect(cardFor(result.container, 'b')).not.toHaveTextContent('Refresh the current workspace status');
    expect(within(actionRegion).getByRole('button', { name: 'Lift Beat' })).toHaveAttribute('aria-disabled', 'true');

    actionRegion = select('b');
    expect(actionRegion).toHaveTextContent('Save or reset local edits');
    expect(cardFor(result.container, 'a')).not.toHaveTextContent('Save or reset local edits');
    expect(within(actionRegion).getByRole('button', { name: 'Lift Beat' })).toHaveAttribute('aria-disabled', 'true');

    actionRegion = select('c');
    expect(actionRegion).toHaveTextContent('Own frame is pending');
    expect(actionRegion).toHaveTextContent('Downstream job is still running');
    expect(cardFor(result.container, 'd')).not.toHaveTextContent('Own frame is pending');
    const blockerList = within(actionRegion).getByRole('list');
    expect(blockerList).toHaveAttribute('aria-live', 'polite');
    expect(within(blockerList).getAllByRole('listitem')).toHaveLength(2);
    expect(actionRegion.textContent!.indexOf('Own frame is pending')).toBeLessThan(
      actionRegion.textContent!.indexOf('Downstream job is still running')
    );
    const blockedLift = within(actionRegion).getByRole('button', { name: 'Lift Beat' });
    expect(blockedLift).toBeEnabled();
    expect(blockedLift).toHaveAttribute('aria-disabled', 'true');
    expect(blockedLift).toHaveAttribute('aria-describedby', blockerList.id);
    act(() => blockedLift.focus());
    expect(blockedLift).toHaveFocus();
    fireEvent.click(blockedLift);
    fireEvent.keyDown(blockedLift, { key: 'Enter' });

    actionRegion = select('d');
    expect(within(actionRegion).getByRole('button', { name: 'Lift Beat' })).not.toHaveAttribute('aria-disabled');
    expect(actions.parkBeat).not.toHaveBeenCalled();

    actionRegion = select('d', { ...projection, workspaceStatusReady: false }, []);
    const unavailableLift = within(actionRegion).getByRole('button', { name: 'Lift Beat' });
    expect(unavailableLift).toBeEnabled();
    expect(unavailableLift).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(unavailableLift);
    expect(actions.parkBeat).not.toHaveBeenCalled();
  });

  it('keeps focus and calls nothing on lift cancel, then focuses the matching Bin item on exact success', async () => {
    const actions = makeActions();
    render(<BoardView {...boardProps(makeProjection([makeBeat('a')]), actions)} selectedBeatId='a' />);
    const actionGroup = within(cardFor(document.body, 'a')).getByRole('group', { name: 'Actions for Beat A' });
    const lift = within(actionGroup).getByRole('button', { name: 'Lift Beat' });

    act(() => lift.focus());
    fireEvent.click(lift);
    const firstConfirm = screen.getByRole('group', { name: 'Lift Beat A?' });
    expect(firstConfirm).toHaveTextContent('All authored work is kept');
    fireEvent.click(within(firstConfirm).getByRole('button', { name: 'Cancel' }));
    expect(actions.parkBeat).not.toHaveBeenCalled();
    expect(lift).toHaveFocus();

    fireEvent.click(lift);
    const secondConfirm = screen.getByRole('group', { name: 'Lift Beat A?' });
    fireEvent.click(within(secondConfirm).getByRole('button', { name: 'Lift Beat' }));
    await waitFor(() => expect(actions.parkBeat).toHaveBeenCalledWith('a'));
    await waitFor(() => expect(screen.getByTestId('bin-focus-target')).toHaveFocus());
    expect(document.querySelector('[aria-live="polite"]')).toHaveTextContent('Beat moved to the Bin.');
    const list = screen.getByRole('list', { name: 'Beat board' });
    const bin = screen.getByTestId('board-bin');
    expect(list.compareDocumentPosition(bin) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
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

  it('leaves order and focus stable on reorder or lift failure and focuses a restored owner Beat after projection refresh', async () => {
    const actions = makeActions();
    vi.mocked(actions.reorderBeats).mockResolvedValue(false);
    vi.mocked(actions.parkBeat).mockResolvedValue(false);
    const initial = makeProjection([makeBeat('a'), makeBeat('b')]);
    const result = render(<BoardView {...boardProps(initial, actions)} selectedBeatId='a' />);

    fireEvent.click(screen.getByRole('button', { name: 'Move Beat A later' }));
    await waitFor(() => expect(actions.reorderBeats).toHaveBeenCalledWith(['b', 'a']));
    expect(screen.getByRole('button', { name: 'Open Beat A' })).toHaveFocus();
    expect(document.querySelector('[aria-live="polite"]')).toHaveTextContent('Beat order was not changed.');
    expect(
      Array.from(screen.getByRole('list', { name: 'Beat board' }).children).map(
        (item) => (item as HTMLElement).dataset.beatId
      )
    ).toEqual(['a', 'b']);

    const lift = within(cardFor(result.container, 'a')).getByRole('button', { name: 'Lift Beat' });
    fireEvent.click(lift);
    fireEvent.click(
      within(screen.getByRole('group', { name: 'Lift Beat A?' })).getByRole('button', { name: 'Lift Beat' })
    );
    await waitFor(() => expect(actions.parkBeat).toHaveBeenCalledWith('a'));
    await waitFor(() => expect(lift).toHaveFocus());
    expect(document.querySelector('[aria-live="polite"]')).toHaveTextContent('Beat was not moved to the Bin.');

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
});
