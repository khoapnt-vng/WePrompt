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

import type { StudioRendererParkEligibilityV2 } from '@/common/types/project/creativeStudioTypes';
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
  segmentHead: true,
  planningBoundary: { shotId: id, startSeconds: 0, endSeconds: 4 },
  frameBoundary: null,
  segmentState: { kind: 'no_picture' },
  dirtyCauses: [],
  downstreamShotIds: [],
  seedStills: [],
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
  workspaceStatusReady: true,
  chainStatusReady: true,
  requestShapeLocked: false,
  bin: { items: [], beats: [], shots: [] },
  undoTop: null,
  dirtyShots: [],
  cascadeProgress: [],
  parkEligibility: beats.map((beat) => parkRow(beat.id)),
  conditioningFailures: [],
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
  selectedBeatId: null,
  dirtyBeatIds: [],
  pending: false,
  actions,
  binFocusAnnouncement: '',
  binFocusItemKey: null,
  onBinFocusItemSettled: vi.fn(),
  onOpenBeat: vi.fn(),
});

describe('BoardView', () => {
  it('renders film order, the first Shot cover, distinct placeholders, and aggregate state facts', () => {
    const covered = makeBeat('covered', {
      title: 'Covered',
      shots: [
        makeShot('shot_1'),
        makeShot('shot_2', { coverAssetId: 'cover_second' }),
        makeShot('shot_3', { coverAssetId: 'cover_third' }),
      ],
      displayState: 'rendering',
    });
    const empty = makeBeat('empty', {
      title: 'Empty',
      shots: [],
      targetSeconds: null,
      actualSeconds: null,
      displayState: 'no_coverage',
    });
    const unavailable = makeBeat('unavailable', {
      title: 'Unavailable',
      shots: [makeShot('shot_4'), makeShot('shot_5')],
      displayState: 'draft',
    });
    const needsAttention = makeBeat('attention', { title: 'Attention', displayState: 'needs_attention' });
    const result = render(<BoardView {...boardProps(makeProjection([covered, empty, unavailable, needsAttention]))} />);

    const list = screen.getByRole('list', { name: 'Beat board' });
    expect(
      within(list)
        .getAllByRole('listitem')
        .map((item) => item.dataset.beatId)
    ).toEqual(['covered', 'empty', 'unavailable', 'attention']);
    const coveredCard = cardFor(result.container, 'covered');
    const image = coveredCard.querySelector<HTMLImageElement>('img');
    expect(image).not.toBeNull();
    expect(image).toHaveAttribute('src', 'weprompt-studio://asset/project_1/cover_second');
    expect(image).toHaveAttribute('loading', 'lazy');
    expect(coveredCard).toHaveTextContent('Rendering');
    expect(coveredCard).toHaveTextContent('3 shots');
    expect(coveredCard).toHaveTextContent('8s actual');
    expect(coveredCard).toHaveTextContent('~8s target');

    expect(cardFor(result.container, 'empty').querySelector('[data-cover-kind="no-coverage"]')).toHaveTextContent(
      'No coverage'
    );
    expect(cardFor(result.container, 'empty')).toHaveTextContent('No coverage state');
    expect(cardFor(result.container, 'empty')).not.toHaveTextContent('0s');
    expect(cardFor(result.container, 'unavailable').querySelector('[data-cover-kind="unavailable"]')).toHaveTextContent(
      'Preview unavailable'
    );
    const attentionState = cardFor(result.container, 'attention').querySelector('[data-state]');
    expect(attentionState).toHaveAttribute('data-state', 'needs_attention');
    expect(attentionState).toHaveTextContent('Needs attention');

    fireEvent.error(image!);
    expect(coveredCard.querySelector('[data-cover-kind="unavailable"]')).toHaveTextContent('Preview unavailable');
  });

  it('uses a fixed responsive three-up grid with neutral full-card openers and exact title type', () => {
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

    expect(boardCss).toMatch(/\.beatList\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/s);
    expect(boardCss).toMatch(/\.beatTitle\s*\{[^}]*color:\s*var\(--text-primary\)/s);
    expect(boardCss).toMatch(/\.beatTitle\s*\{[^}]*font-family:\s*var\(--font-display\)/s);
    expect(boardCss).toMatch(/\.beatTitle\s*\{[^}]*font-size:\s*13px/s);
    expect(boardCss).toMatch(/\.beatTitle\s*\{[^}]*font-weight:\s*var\(--fw-semibold\)/s);
    expect(boardCss).toMatch(/\.beatTitle\s*\{[^}]*composes:\s*inkTextAction/s);
    expect(boardCss).toMatch(/\.beatCard\s*\{[^}]*position:\s*relative/s);
    expect(boardCss).toMatch(/\.beatTitle\s*\{[^}]*position:\s*static/s);
    expect(boardCss).toMatch(
      /\.beatTitle:global\(\.arco-btn-text\)[^{]*\{[^}]*border-color:\s*transparent[^}]*background-color:\s*transparent[^}]*box-shadow:\s*none/s
    );
    expect(boardCss).toMatch(/\.beatTitle::before\s*\{[^}]*position:\s*absolute[^}]*inset:\s*0/s);
    expect(boardCss).toMatch(/\.selectionActions\s*\{[^}]*z-index:\s*2/s);
    expect(boardCss).toMatch(
      /\.liftBeat[^,{]*\[aria-disabled='true'\][^{]*\{[^}]*color:\s*var\(--text-disabled\)[^}]*cursor:\s*not-allowed/s
    );
    for (const state of [
      'duration_pending',
      'no_coverage',
      'seed_pending',
      'part_done',
      'needs_attention',
      'rendering',
      'stale',
      'status_pending',
      'ready',
      'draft',
    ]) {
      expect(boardCss).toContain(`.state[data-state='${state}']`);
    }
    expect(boardCss).toMatch(
      /\.state\[data-state='needs_attention'\]\s*\{[^}]*color:\s*var\(--color-danger-7\)[^}]*font-weight:\s*var\(--fw-bold\)/s
    );
    expect(boardCss).toMatch(/\.state\[data-state='stale'\][^{]*\{[^}]*color:\s*var\(--color-danger-6\)/s);
  });

  it('opens from the neutral full-card target, exposes actions only on the selected card, and preserves paid Shots', async () => {
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
      within(screen.getByRole('list', { name: 'Beat board' }))
        .getAllByRole('listitem')
        .map((item) => item.dataset.beatId)
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
      within(screen.getByRole('list', { name: 'Beat board' }))
        .getAllByRole('listitem')
        .map((item) => item.dataset.beatId)
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
