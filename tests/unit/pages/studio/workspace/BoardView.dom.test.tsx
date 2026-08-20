/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React, { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { StudioRendererParkEligibilityV2 } from '@/common/types/project/creativeStudioTypes';
import type {
  WorkspaceBeatProjection,
  WorkspaceProjection,
  WorkspaceShotProjection,
} from '@/renderer/pages/studio/components/Workspace/workspaceProjection';

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
    result:
      | { kind: 'beat'; beatId: string }
      | { kind: 'shot'; beatId: string; shotId: string }
      | { kind: 'take'; beatId: string; shotId: string; assetId: string }
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
        'conversation.creativeStudio.workspace.board.cardSizeLabel': 'Card size',
        'conversation.creativeStudio.workspace.board.cardSizeSmall': 'S',
        'conversation.creativeStudio.workspace.board.cardSizeMedium': 'M',
        'conversation.creativeStudio.workspace.board.cardSizeLarge': 'L',
        'conversation.creativeStudio.workspace.board.selectedBeat': 'Selected Beat',
        'conversation.creativeStudio.workspace.board.noCoverage': 'No coverage',
        'conversation.creativeStudio.workspace.board.coverUnavailable': 'Preview unavailable',
        'conversation.creativeStudio.workspace.board.reorderFailed': 'Beat order was not changed.',
        'conversation.creativeStudio.workspace.board.liftBeat': 'Lift Beat',
        'conversation.creativeStudio.workspace.board.liftConfirmContent':
          'All authored work and Takes are kept in the Bin.',
        'conversation.creativeStudio.workspace.board.liftUnavailable':
          'Refresh the current workspace status before lifting this Beat.',
        'conversation.creativeStudio.workspace.board.liftDirtyDraft': 'Save or reset local edits before lifting.',
        'conversation.creativeStudio.workspace.board.liftSucceeded': 'Beat moved to the Bin.',
        'conversation.creativeStudio.workspace.board.liftFailed': 'Beat was not moved to the Bin.',
        'conversation.creativeStudio.workspace.table.state.durationPending': 'Duration pending',
        'conversation.creativeStudio.workspace.table.state.noCoverage': 'No coverage state',
        'conversation.creativeStudio.workspace.table.state.seedPending': 'Seed pending',
        'conversation.creativeStudio.workspace.table.state.partDone': 'Part done',
        'conversation.creativeStudio.workspace.table.state.rendering': 'Rendering',
        'conversation.creativeStudio.workspace.table.state.stale': 'Stale',
        'conversation.creativeStudio.workspace.table.state.statusPending': 'Status pending',
        'conversation.creativeStudio.workspace.table.state.ready': 'Ready',
        'conversation.creativeStudio.workspace.table.state.draft': 'Draft',
        'conversation.creativeStudio.workspace.beatPanel.blocker.currentMatchTo': 'Current match dependency',
        'conversation.creativeStudio.workspace.beatPanel.blocker.ownNonterminalJob': 'Own job is still running',
        'conversation.creativeStudio.workspace.beatPanel.blocker.ownPendingFrame': 'Own frame is pending',
        'conversation.creativeStudio.workspace.beatPanel.blocker.downstreamNonterminalJob':
          'Downstream job is still running',
        'conversation.creativeStudio.workspace.beatPanel.blocker.downstreamPendingFrame': 'Downstream frame is pending',
        'conversation.creativeStudio.workspace.beatPanel.blocker.waitingAuthorizationDependency':
          'Authorization dependency is waiting',
        'conversation.creativeStudio.workspace.beatPanel.blocker.boundNonterminalRequest': 'Request is still bound',
        'conversation.creativeStudio.workspace.beatPanel.blocker.currentSelectedTake': 'Take is selected',
        'conversation.creativeStudio.workspace.beatPanel.blocker.currentSeedStill': 'Still is the current seed',
        'conversation.creativeStudio.workspace.beatPanel.blocker.nonterminalConditioningUse':
          'Conditioning is still using this work',
        'conversation.creativeStudio.workspace.beatPanel.blocker.takeBinCapacityReached': 'Take Bin is full',
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
        <button ref={focusTarget} data-testid='bin-focus-target' type='button'>
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
    binItemFocusKey: (item: { kind: string; beatId?: string; shotId?: string; assetId?: string }) =>
      item.kind === 'beat'
        ? `beat:${item.beatId}`
        : item.kind === 'shot'
          ? `shot:${item.shotId}`
          : `take:${item.assetId}`,
  };
});

import { BoardView, type BoardActions } from '@/renderer/pages/studio/components/Workspace/Views/Board';

const makeShot = (id: string, overrides: Partial<WorkspaceShotProjection> = {}): WorkspaceShotProjection => ({
  id,
  line: `Line ${id}`,
  narration: '',
  onScreenText: '',
  durationSeconds: 4,
  chainBreak: 'none',
  derivation: 'derived',
  derivedFromActionRevision: 1,
  derivationStale: false,
  trimInSeconds: null,
  trimOutSeconds: null,
  selectedTakeId: null,
  selectedTakeSourceDurationSeconds: null,
  playedDurationSeconds: 4,
  explicitSeedAssetId: null,
  effectiveSeedAssetId: null,
  segmentHead: true,
  planningBoundary: { shotId: id, startSeconds: 0, endSeconds: 4 },
  dirtyCauses: [],
  downstreamShotIds: [],
  imageTakes: [],
  videoTakes: [],
  coverAssetId: null,
  takeCount: 0,
  displayState: 'draft',
  retainedWork: false,
  videoGenerationInFlight: false,
  seedGenerationInFlight: false,
  hasEffectiveSeed: false,
  ...overrides,
});

const makeBeat = (id: string, overrides: Partial<WorkspaceBeatProjection> = {}): WorkspaceBeatProjection => ({
  id,
  title: `Beat ${id.toUpperCase()}`,
  action: `Action ${id}`,
  look: `Look ${id}`,
  actionRevision: 1,
  lineHistory: [],
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
  assetId: null,
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
  bin: { items: [], beats: [], shots: [], takes: [] },
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
  restoreTake: vi.fn().mockResolvedValue(true),
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
    const result = render(<BoardView {...boardProps(makeProjection([covered, empty, unavailable]))} />);

    const list = screen.getByRole('list', { name: 'Beat board' });
    expect(
      within(list)
        .getAllByRole('listitem')
        .map((item) => item.dataset.beatId)
    ).toEqual(['covered', 'empty', 'unavailable']);
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

    fireEvent.error(image!);
    expect(coveredCard.querySelector('[data-cover-kind="unavailable"]')).toHaveTextContent('Preview unavailable');
  });

  it('keeps S, M, and L local presentation state with M as default and no action callback', async () => {
    const user = userEvent.setup();
    const actions = makeActions();
    render(<BoardView {...boardProps(makeProjection([makeBeat('a')]), actions)} />);
    const list = screen.getByRole('list', { name: 'Beat board' });
    const sizeGroup = screen.getByRole('group', { name: 'Card size' });

    expect(list).toHaveAttribute('data-card-size', 'medium');
    expect(within(sizeGroup).getByRole('button', { name: 'M' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(within(sizeGroup).getByRole('button', { name: 'S' }));
    expect(list).toHaveAttribute('data-card-size', 'small');
    await user.click(within(sizeGroup).getByRole('button', { name: 'L' }));
    expect(list).toHaveAttribute('data-card-size', 'large');
    await user.click(within(sizeGroup).getByRole('button', { name: 'M' }));
    expect(list).toHaveAttribute('data-card-size', 'medium');
    expect(actions.reorderBeats).not.toHaveBeenCalled();
    expect(actions.parkBeat).not.toHaveBeenCalled();
    expect(actions.reorderBin).not.toHaveBeenCalled();
  });

  it('opens only the exact shared Beat selection and never changes paid Shot selection', async () => {
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

    expect(screen.getByRole('button', { name: 'Open Beat A' })).toHaveAttribute('aria-current', 'true');
    await user.click(screen.getByRole('button', { name: 'Open Beat B' }));
    expect(JSON.parse(screen.getByTestId('selection').textContent ?? '{}')).toEqual({
      selectedBeatId: 'b',
      selectedShotIds: ['a_shot'],
    });
    expect(screen.getByRole('button', { name: 'Open Beat B' })).toHaveAttribute('aria-current', 'true');
    fireEvent.click(cardFor(result.container, 'a'));
    expect(JSON.parse(screen.getByTestId('selection').textContent ?? '{}').selectedBeatId).toBe('b');
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('sends exact whole-order keyboard payloads, announces global positions, and restores moved identity focus', async () => {
    const actions = makeActions();
    render(<BoardView {...boardProps(makeProjection([makeBeat('a'), makeBeat('b'), makeBeat('c')]), actions)} />);

    fireEvent.click(screen.getByRole('button', { name: 'Move Beat A later' }));
    await waitFor(() => expect(actions.reorderBeats).toHaveBeenLastCalledWith(['b', 'a', 'c']));
    expect(screen.getByRole('button', { name: 'Open Beat A' })).toHaveFocus();
    expect(document.querySelector('[aria-live="polite"]')).toHaveTextContent('Moved Beat A from 1 to 2 of 3.');

    fireEvent.keyDown(screen.getByRole('button', { name: 'Reorder Beat C at position 3' }), { key: 'Home' });
    await waitFor(() => expect(actions.reorderBeats).toHaveBeenLastCalledWith(['c', 'a', 'b']));
    expect(screen.getByRole('button', { name: 'Open Beat C' })).toHaveFocus();

    fireEvent.keyDown(screen.getByRole('button', { name: 'Reorder Beat A at position 1' }), { key: 'End' });
    await waitFor(() => expect(actions.reorderBeats).toHaveBeenLastCalledWith(['b', 'c', 'a']));
    expect(screen.getByRole('button', { name: 'Open Beat A' })).toHaveFocus();
    expect(actions.parkBeat).not.toHaveBeenCalled();
    expect(actions.reorderBin).not.toHaveBeenCalled();
  });

  it('uses pointer drag and canonical earlier/later semantics unchanged in RTL without optimistic DOM order', async () => {
    const actions = makeActions();
    const result = render(
      <div dir='rtl'>
        <BoardView {...boardProps(makeProjection([makeBeat('a'), makeBeat('b'), makeBeat('c')]), actions)} />
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
            { shotId: 'c_shot', code: 'current_match_to' },
          ],
        }),
        parkRow('d'),
      ],
    });
    const actions = makeActions();
    const result = render(<BoardView {...boardProps(projection, actions)} dirtyBeatIds={['b']} />);

    expect(cardFor(result.container, 'a')).toHaveTextContent('Refresh the current workspace status');
    expect(cardFor(result.container, 'b')).toHaveTextContent('Save or reset local edits');
    const blockedCard = cardFor(result.container, 'c');
    expect(blockedCard).toHaveTextContent('Own frame is pending');
    expect(blockedCard).toHaveTextContent('Current match dependency');
    const blockerList = within(blockedCard).getByRole('list');
    expect(blockerList).toHaveAttribute('aria-live', 'polite');
    expect(within(blockerList).getAllByRole('listitem')).toHaveLength(2);
    expect(blockedCard.textContent!.indexOf('Own frame is pending')).toBeLessThan(
      blockedCard.textContent!.indexOf('Current match dependency')
    );
    expect(within(cardFor(result.container, 'd')).getByRole('button', { name: 'Lift Beat' })).toBeEnabled();
    for (const beatId of ['a', 'b', 'c']) {
      const button = within(cardFor(result.container, beatId)).getByRole('button', { name: 'Lift Beat' });
      expect(button).toBeDisabled();
      fireEvent.click(button);
    }
    expect(actions.parkBeat).not.toHaveBeenCalled();

    result.rerender(
      <BoardView {...boardProps({ ...projection, workspaceStatusReady: false }, actions)} dirtyBeatIds={[]} />
    );
    expect(within(cardFor(result.container, 'd')).getByRole('button', { name: 'Lift Beat' })).toBeDisabled();
    fireEvent.click(within(cardFor(result.container, 'd')).getByRole('button', { name: 'Lift Beat' }));
    expect(actions.parkBeat).not.toHaveBeenCalled();
  });

  it('keeps focus and calls nothing on lift cancel, then focuses the matching Bin item on exact success', async () => {
    const actions = makeActions();
    const result = render(<BoardView {...boardProps(makeProjection([makeBeat('a')]), actions)} />);
    const lift = within(cardFor(result.container, 'a')).getByRole('button', { name: 'Lift Beat' });

    act(() => lift.focus());
    fireEvent.click(lift);
    const firstConfirm = screen.getByRole('group', { name: 'Lift Beat A?' });
    expect(firstConfirm).toHaveTextContent('Takes are kept');
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

  it('leaves order and focus stable on reorder or lift failure and focuses a restored owner Beat after projection refresh', async () => {
    const actions = makeActions();
    vi.mocked(actions.reorderBeats).mockResolvedValue(false);
    vi.mocked(actions.parkBeat).mockResolvedValue(false);
    const initial = makeProjection([makeBeat('a'), makeBeat('b')]);
    const result = render(<BoardView {...boardProps(initial, actions)} />);

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
    result.rerender(<BoardView {...boardProps(makeProjection([makeBeat('a'), makeBeat('restored')]), actions)} />);
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
        takes: [],
      },
    });
    render(<BoardView {...boardProps(projection)} />);

    fireEvent.click(screen.getByRole('button', { name: 'Report restored binned-owner Shot' }));
    await waitFor(() => expect(screen.getByTestId('bin-focus-target')).toHaveFocus());
  });
});
