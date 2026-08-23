/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { StudioRendererParkEligibilityV2 } from '@/common/types/project/creativeStudioTypes';
import type {
  WorkspaceBeatProjection,
  WorkspaceBinnedBeatProjection,
  WorkspaceBinnedShotProjection,
  WorkspaceBinItemProjection,
  WorkspaceProjection,
  WorkspaceShotProjection,
} from '@/renderer/pages/studio/components/Workspace/workspaceProjection';

vi.mock('@arco-design/web-react', async () => {
  const ReactModule = await import('react');
  type MockButtonProps = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'type'> & {
    htmlType?: 'button' | 'submit' | 'reset';
    icon?: React.ReactNode;
    loading?: boolean;
    size?: string;
    type?: string;
  };
  type MockSelectProps = Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'onChange' | 'size'> & {
    onChange?: (value: string) => void;
    size?: string;
  };
  type MockSelectHandle = { dom: HTMLSelectElement | null };
  const Button = ReactModule.forwardRef<HTMLButtonElement, MockButtonProps>(
    ({ children, htmlType = 'button', icon, loading: _loading, size: _size, type: _type, ...props }, ref) => (
      <button ref={ref} type={htmlType} {...props}>
        {icon}
        {children}
      </button>
    )
  );
  const Select = Object.assign(
    ReactModule.forwardRef<MockSelectHandle, MockSelectProps>(
      ({ children, onChange, size: _size, value, ...props }, ref) => {
        const selectRef = ReactModule.useRef<HTMLSelectElement | null>(null);
        ReactModule.useImperativeHandle(ref, () => ({ dom: selectRef.current }));
        return (
          <select ref={selectRef} {...props} value={value} onChange={(event) => onChange?.(event.target.value)}>
            {children}
          </select>
        );
      }
    ),
    {
      Option: ({ children, value }: React.OptionHTMLAttributes<HTMLOptionElement>) => (
        <option value={value}>{children}</option>
      ),
    }
  );
  return { Button, Select };
});

vi.mock('@icon-park/react', () => ({
  Drag: (props: Record<string, unknown>) => <span data-icon='drag' {...props} />,
  Inbox: (props: Record<string, unknown>) => <span data-icon='inbox' {...props} />,
}));

vi.mock('@/renderer/pages/studio/studioManagedAssetUrl', () => ({
  createManagedStudioAssetUrl: (projectId: string, assetId: string) =>
    assetId.startsWith('unsafe_') ? null : `aion-studio://${projectId}/${assetId}`,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => {
      const copy: Record<string, string> = {
        'conversation.creativeStudio.workspace.bin.title': 'Bin',
        'conversation.creativeStudio.workspace.bin.description': 'Items outside the film',
        'conversation.creativeStudio.workspace.bin.empty': 'The Bin is empty',
        'conversation.creativeStudio.workspace.bin.listLabel': 'Ordered Bin items',
        'conversation.creativeStudio.workspace.bin.kind.beat': 'Beat',
        'conversation.creativeStudio.workspace.bin.kind.shot': 'Shot',
        'conversation.creativeStudio.workspace.bin.reason.lifted': 'Lifted',
        'conversation.creativeStudio.workspace.bin.reason.alternate': 'Alternate',
        'conversation.creativeStudio.workspace.bin.ownerLabel': 'Recorded owner Beat',
        'conversation.creativeStudio.workspace.bin.ownerUnavailable': 'Recorded owner unavailable',
        'conversation.creativeStudio.workspace.bin.retainedWork': 'Authored and generated work retained',
        'conversation.creativeStudio.workspace.bin.stale': 'Downstream continuity is out of date',
        'conversation.creativeStudio.workspace.bin.coverUnavailable': 'Preview unavailable',
        'conversation.creativeStudio.workspace.bin.restore.positionLabel': 'Restore position',
        'conversation.creativeStudio.workspace.bin.restore.atEnd': 'At the end',
        'conversation.creativeStudio.workspace.bin.restore.beat': 'Restore Beat',
        'conversation.creativeStudio.workspace.bin.restore.shot': 'Restore Shot',
        'conversation.creativeStudio.workspace.bin.blocker.statusUnavailable': 'Current status unavailable',
        'conversation.creativeStudio.workspace.bin.blocker.ownerUnavailable': 'Recorded owner is unavailable',
        'conversation.creativeStudio.workspace.bin.blocker.anchorUnavailable': 'Restore position is stale',
        'conversation.creativeStudio.workspace.beatPanel.blocker.beatShotCapacityReached': 'Beat is full',
        'conversation.creativeStudio.workspace.beatPanel.blocker.ownNonterminalJob': 'Own job is running',
        'conversation.creativeStudio.workspace.beatPanel.blocker.ownPendingFrame': 'Own frame is pending',
        'conversation.creativeStudio.workspace.beatPanel.blocker.downstreamNonterminalJob': 'Downstream job is running',
        'conversation.creativeStudio.workspace.beatPanel.blocker.downstreamPendingFrame': 'Downstream frame is pending',
        'conversation.creativeStudio.workspace.beatPanel.blocker.waitingAuthorizationDependency':
          'Authorization is waiting',
        'conversation.creativeStudio.workspace.beatPanel.blocker.boundNonterminalRequest': 'Request is bound',
      };
      if (key.endsWith('.bin.position')) {
        return `Position ${String(values?.position)} of ${String(values?.total)}`;
      }
      if (key.endsWith('.bin.itemLabel')) {
        return `${String(values?.kind)}, ${String(values?.reason)}, position ${String(values?.position)} of ${String(
          values?.total
        )}`;
      }
      if (key.endsWith('.bin.shotCount')) return `${String(values?.count)} shots`;
      if (key.endsWith('.bin.coverAlt')) {
        return `${String(values?.kind)} preview for ${String(values?.title)}`;
      }
      if (key.endsWith('.bin.dragHandle')) {
        return `Reorder ${String(values?.kind)} at position ${String(values?.position)}`;
      }
      if (key.endsWith('.bin.reorderAnnouncement')) {
        return `Moved ${String(values?.reason)} ${String(values?.kind)} from position ${String(
          values?.from
        )} to ${String(values?.to)} of ${String(values?.total)}`;
      }
      if (key.endsWith('.bin.restore.beforeBeat')) return `Before Beat ${String(values?.position)}`;
      if (key.endsWith('.bin.restore.beforeShot')) return `Before Shot ${String(values?.position)}`;
      return copy[key] ?? key;
    },
  }),
}));

import {
  Bin,
  binItemFocusKey,
  type BinActions,
  type BinProps,
} from '@/renderer/pages/studio/components/Workspace/Views/Board/Bin';

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
  currentPicture: null,
  playedDurationSeconds: null,
  explicitSeedAssetId: null,
  effectiveSeedAssetId: null,
  segmentHead: false,
  planningBoundary: null,
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

const makeBeat = (
  id: string,
  title: string,
  shots: WorkspaceShotProjection[],
  overrides: Partial<WorkspaceBeatProjection> = {}
): WorkspaceBeatProjection => ({
  id,
  title,
  action: `Action ${id}`,
  look: `Look ${id}`,
  actionRevision: 1,
  lineHistory: [],
  targetSeconds: 8,
  actualSeconds: null,
  displayState: shots.length === 0 ? 'no_coverage' : 'draft',
  shots,
  coverAssetId: shots.find((shot) => shot.coverAssetId !== null)?.coverAssetId ?? null,
  retainedWork: shots.some((shot) => shot.retainedWork),
  ...overrides,
});

const eligibility = (
  subject: StudioRendererParkEligibilityV2['subject'],
  beatId: string,
  shotId: string | null
): StudioRendererParkEligibilityV2 => ({
  subject,
  action: 'restore',
  beatId,
  shotId,
  allowed: true,
  blockers: [],
});

const makeProjection = (): WorkspaceProjection => {
  const activeShot = makeShot('active_shot', { line: 'Active owner shot' });
  const activeOwner = makeBeat('active_owner', 'Active owner', [activeShot]);
  const activeSecond = makeBeat('active_second', 'Second active Beat', [makeShot('second_shot')]);
  const ownerAnchorA = makeShot('owner_anchor_a', {
    line: 'Owner anchor A',
    coverAssetId: 'cover_beat',
    segmentState: { kind: 'status_pending' },
  });
  const ownerAnchorB = makeShot('owner_anchor_b', { segmentState: { kind: 'status_pending' } });
  const binnedBeat: WorkspaceBinnedBeatProjection = {
    ...makeBeat('beat_parked', 'Parked owner', [ownerAnchorA, ownerAnchorB], {
      coverAssetId: 'cover_beat',
      retainedWork: true,
      displayState: 'stale',
    }),
    reason: 'lifted',
    shotCount: 2,
  };
  const binnedShot: WorkspaceBinnedShotProjection = {
    ...makeShot('shot_parked', {
      line: 'Lifted retained shot',
      coverAssetId: 'cover_shot',
      dirtyCauses: ['continuity_stale'],
      segmentState: { kind: 'status_pending' },
      retainedWork: true,
    }),
    beatId: 'beat_parked',
    beatTitle: 'Parked owner',
    ownerBeatBinned: true,
    reason: 'lifted',
  };
  const items: WorkspaceBinItemProjection[] = [
    {
      kind: 'shot',
      position: 1,
      identity: { kind: 'shot', beatId: 'beat_parked', shotId: 'shot_parked', reason: 'lifted' },
      value: binnedShot,
    },
    {
      kind: 'beat',
      position: 2,
      identity: { kind: 'beat', beatId: 'beat_parked', reason: 'lifted' },
      value: binnedBeat,
    },
  ];
  return {
    projectId: 'project_1',
    projectRevision: 12,
    activeBeats: [activeOwner, activeSecond],
    activeBeatIds: ['active_owner', 'active_second'],
    activeShotIds: ['active_shot', 'second_shot'],
    coverageGapBeatIds: [],
    workspaceStatusReady: true,
    chainStatusReady: true,
    requestShapeLocked: false,
    bin: { items, beats: [binnedBeat], shots: [binnedShot] },
    undoTop: null,
    dirtyShots: [],
    cascadeProgress: [],
    parkEligibility: [eligibility('shot', 'beat_parked', 'shot_parked'), eligibility('beat', 'beat_parked', null)],
    conditioningFailures: [],
  };
};

const makeActions = (result = true): BinActions => ({
  restoreBeat: vi.fn(async () => result),
  restoreShot: vi.fn(async () => result),
  reorderBin: vi.fn(async () => result),
});

const renderBin = (
  projection: WorkspaceProjection,
  actions: BinActions = makeActions(),
  overrides: Partial<Pick<BinProps, 'focusItemKey' | 'onFocusItemSettled' | 'onRestoreSuccess' | 'pending'>> = {}
) => {
  const props: BinProps = {
    projectId: projection.projectId,
    projection,
    pending: false,
    actions,
    focusItemKey: null,
    onFocusItemSettled: vi.fn(),
    onRestoreSuccess: vi.fn(),
    ...overrides,
  };
  return { ...render(<Bin {...props} />), props };
};

const itemFor = (key: string): HTMLElement => {
  const item = document.querySelector<HTMLElement>(`[data-bin-item-key="${key}"]`);
  if (item === null) throw new Error(`Missing Bin item ${key}`);
  return item;
};

const dragHandleFor = (key: string): HTMLButtonElement =>
  within(itemFor(key)).getByRole('button', { name: /Reorder/u }) as HTMLButtonElement;

describe('Bin', () => {
  beforeEach(() => {
    document.documentElement.dir = 'ltr';
  });

  it('surfaces only parked Beats and Shots, never a Take restore surface', () => {
    renderBin(makeProjection());

    const list = screen.getByRole('list', { name: 'Ordered Bin items' });
    expect(
      within(list)
        .getAllByRole('listitem')
        .map((item) => item.dataset.binKind)
    ).toEqual(['shot', 'beat']);
    expect(document.querySelector('[data-bin-kind="take"]')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Restore Take' })).toBeNull();
  });

  it('renders exactly Beat and Shot in global heterogeneous order with reason, owner, position, and retained facts', () => {
    renderBin(makeProjection());

    const list = screen.getByRole('list', { name: 'Ordered Bin items' });
    const items = within(list).getAllByRole('listitem');
    expect(items.map((item) => item.dataset.binKind)).toEqual(['shot', 'beat']);
    expect(items.map((item) => item.dataset.binReason)).toEqual(['lifted', 'lifted']);
    expect(items.map((item) => item.getAttribute('aria-posinset'))).toEqual(['1', '2']);
    expect(items.every((item) => item.getAttribute('aria-setsize') === '2')).toBe(true);

    const shot = itemFor('shot:shot_parked');
    expect(shot).toHaveAccessibleName(/Shot, Lifted, position 1 of 2 Recorded owner Beat Parked owner/u);
    expect(shot).toHaveTextContent('Lifted retained shot');
    expect(shot).toHaveTextContent('Recorded owner Beat Parked owner');
    expect(shot).toHaveTextContent('Authored and generated work retained');
    expect(shot).toHaveTextContent('Downstream continuity is out of date');
    expect(shot).toHaveAttribute('data-retained-work', 'true');
    expect(shot).toHaveAttribute('data-stale', 'true');
    expect(within(shot).getByRole('img', { name: 'Shot preview for Lifted retained shot' })).toHaveAttribute(
      'src',
      'aion-studio://project_1/cover_shot'
    );

    expect(itemFor('beat:beat_parked')).toHaveTextContent('2 shots');
    expect(screen.getAllByRole('button', { name: /^Restore (Beat|Shot)$/u })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: /^Reorder/u })).toHaveLength(2);
    expect(screen.queryByRole('button', { name: /generate|retry|select|remove/u })).not.toBeInTheDocument();
  });

  it('omits the retained-work claim when the parked Shot has no retained work', () => {
    const projection = makeProjection();
    const shotEntry = projection.bin.items.find((entry) => entry.kind === 'shot')!;
    if (shotEntry.kind !== 'shot') throw new Error('Missing Shot fixture');
    shotEntry.value.retainedWork = false;
    shotEntry.value.coverAssetId = null;
    projection.bin.shots = [shotEntry.value];
    renderBin(projection);
    const shot = itemFor('shot:shot_parked');
    expect(shot).toHaveAttribute('data-retained-work', 'false');
    expect(within(shot).queryByText('Authored and generated work retained')).not.toBeInTheDocument();
  });

  it('suppresses every managed preview and mutation when the prop project does not match the projection project', () => {
    const projection = makeProjection();
    const actions = makeActions();
    render(
      <Bin
        projectId='foreign_project'
        projection={projection}
        pending={false}
        actions={actions}
        focusItemKey={null}
        onFocusItemSettled={vi.fn()}
        onRestoreSuccess={vi.fn()}
      />
    );

    expect(screen.queryAllByRole('img')).toHaveLength(0);
    expect(screen.getAllByText('Preview unavailable')).toHaveLength(2);
    expect(screen.getAllByRole('button').every((button) => button.hasAttribute('disabled'))).toBe(true);
    expect(document.body.innerHTML).not.toContain('aion-studio://foreign_project');
    expect(actions.restoreBeat).not.toHaveBeenCalled();
    expect(actions.restoreShot).not.toHaveBeenCalled();
    expect(actions.reorderBin).not.toHaveBeenCalled();
  });

  it('restores through only the exact named providers and offers anchors from active Beats or the recorded binned owner', async () => {
    const actions = makeActions();
    const onRestoreSuccess = vi.fn();
    renderBin(makeProjection(), actions, { onRestoreSuccess });

    const beatPosition = screen.getByRole('combobox', {
      name: 'Restore position Beat Parked owner Position 2 of 2',
    });
    expect(
      within(beatPosition)
        .getAllByRole('option')
        .map((option) => option.getAttribute('value'))
    ).toEqual([':bin-end:', 'active_owner', 'active_second']);
    fireEvent.change(beatPosition, { target: { value: 'active_second' } });
    const restoreBeat = within(itemFor('beat:beat_parked')).getByRole('button', { name: 'Restore Beat' });
    fireEvent.click(restoreBeat);
    await waitFor(() => expect(actions.restoreBeat).toHaveBeenCalledWith('beat_parked', 'active_second'));
    expect(onRestoreSuccess).toHaveBeenLastCalledWith({ kind: 'beat', beatId: 'beat_parked' });
    await waitFor(() => expect(restoreBeat).not.toBeDisabled());

    const shotPosition = screen.getByRole('combobox', {
      name: 'Restore position Shot Lifted retained shot Position 1 of 2',
    });
    expect(
      within(shotPosition)
        .getAllByRole('option')
        .map((option) => option.getAttribute('value'))
    ).toEqual([':bin-end:', 'owner_anchor_a', 'owner_anchor_b']);
    expect(within(shotPosition).queryByRole('option', { name: /Active owner shot/u })).not.toBeInTheDocument();
    fireEvent.change(shotPosition, { target: { value: 'owner_anchor_b' } });
    const restoreShot = within(itemFor('shot:shot_parked')).getByRole('button', { name: 'Restore Shot' });
    fireEvent.click(restoreShot);
    await waitFor(() => expect(actions.restoreShot).toHaveBeenCalledWith('shot_parked', 'owner_anchor_b'));
    expect(onRestoreSuccess).toHaveBeenLastCalledWith({
      kind: 'shot',
      beatId: 'beat_parked',
      shotId: 'shot_parked',
    });
    await waitFor(() => expect(restoreShot).not.toBeDisabled());

    expect(actions.reorderBin).not.toHaveBeenCalled();
  });

  it('fails closed for full, missing, and duplicate eligibility rows without calling any provider', () => {
    const projection = makeProjection();
    const shotRow = projection.parkEligibility.find((row) => row.subject === 'shot')!;
    shotRow.allowed = false;
    shotRow.blockers = [{ shotId: 'shot_parked', code: 'beat_shot_capacity_reached' }];
    const beatRow = projection.parkEligibility.find((row) => row.subject === 'beat')!;
    projection.parkEligibility.push({ ...beatRow, blockers: [] });
    const actions = makeActions();
    const onRestoreSuccess = vi.fn();
    renderBin(projection, actions, { onRestoreSuccess });

    expect(screen.getByText('Beat is full')).toBeInTheDocument();
    const blockerList = screen.getByText('Beat is full').closest('ul');
    expect(blockerList).toHaveAttribute('aria-live', 'polite');
    expect(within(blockerList!).getAllByRole('listitem')).toHaveLength(1);
    expect(screen.getAllByText('Current status unavailable')).toHaveLength(1);
    for (const button of screen.getAllByRole('button', { name: /^Restore (Beat|Shot)$/u })) {
      expect(button).toBeDisabled();
      fireEvent.click(button);
    }
    expect(actions.restoreBeat).not.toHaveBeenCalled();
    expect(actions.restoreShot).not.toHaveBeenCalled();
    expect(onRestoreSuccess).not.toHaveBeenCalled();
  });

  it('fails closed for stale status, wrong owner facts, and an anchor that changed after selection', () => {
    const staleProjection = makeProjection();
    staleProjection.workspaceStatusReady = false;
    const staleActions = makeActions();
    const staleView = renderBin(staleProjection, staleActions);
    expect(screen.getAllByText('Current status unavailable')).toHaveLength(2);
    expect(
      screen.getAllByRole('button', { name: /^Restore/u }).every((button) => button.hasAttribute('disabled'))
    ).toBe(true);
    staleView.unmount();

    const wrongOwnerProjection = makeProjection();
    const shotEntry = wrongOwnerProjection.bin.items.find((entry) => entry.kind === 'shot')!;
    if (shotEntry.kind === 'shot') shotEntry.value.beatTitle = 'Wrong owner';
    const wrongActions = makeActions();
    const wrongView = renderBin(wrongOwnerProjection, wrongActions);
    expect(within(itemFor('shot:shot_parked')).getByText('Recorded owner is unavailable')).toBeInTheDocument();
    expect(within(itemFor('shot:shot_parked')).getByRole('button', { name: 'Restore Shot' })).toBeDisabled();
    wrongView.unmount();

    const projection = makeProjection();
    const actions = makeActions();
    const view = renderBin(projection, actions);
    const position = screen.getByRole('combobox', {
      name: 'Restore position Beat Parked owner Position 2 of 2',
    });
    fireEvent.change(position, { target: { value: 'active_second' } });
    const changed = makeProjection();
    changed.activeBeats = changed.activeBeats.filter((beat) => beat.id !== 'active_second');
    changed.activeBeatIds = ['active_owner'];
    changed.activeShotIds = ['active_shot'];
    view.rerender(<Bin {...view.props} projection={changed} />);
    expect(screen.getByText('Restore position is stale')).toBeInTheDocument();
    const restoreBeat = within(itemFor('beat:beat_parked')).getByRole('button', { name: 'Restore Beat' });
    expect(restoreBeat).toBeDisabled();
    fireEvent.click(restoreBeat);
    expect(actions.restoreBeat).not.toHaveBeenCalled();
  });

  it('clears a saved restore anchor across project switches and item disappearance before re-bin', async () => {
    const projection = makeProjection();
    const actions = makeActions();
    const view = renderBin(projection, actions);
    const label = 'Restore position Beat Parked owner Position 2 of 2';
    fireEvent.change(screen.getByRole('combobox', { name: label }), { target: { value: 'active_second' } });
    expect(screen.getByRole('combobox', { name: label })).toHaveValue('active_second');

    const secondProject = makeProjection();
    secondProject.projectId = 'project_2';
    view.rerender(<Bin {...view.props} projectId='project_2' projection={secondProject} />);
    await waitFor(() => expect(screen.getByRole('combobox', { name: label })).toHaveValue(':bin-end:'));

    fireEvent.change(screen.getByRole('combobox', { name: label }), { target: { value: 'active_second' } });
    const withoutBeatItem = makeProjection();
    withoutBeatItem.projectId = 'project_2';
    const restoredBeat = withoutBeatItem.bin.beats[0]!;
    withoutBeatItem.activeBeats.push(restoredBeat);
    withoutBeatItem.activeBeatIds.push(restoredBeat.id);
    withoutBeatItem.activeShotIds.push(...restoredBeat.shots.map((shot) => shot.id));
    withoutBeatItem.bin.items = withoutBeatItem.bin.items.filter((entry) => entry.kind !== 'beat');
    withoutBeatItem.bin.items.forEach((entry, index) => {
      entry.position = index + 1;
    });
    withoutBeatItem.bin.beats = [];
    withoutBeatItem.parkEligibility = withoutBeatItem.parkEligibility.filter((row) => row.subject !== 'beat');
    view.rerender(<Bin {...view.props} projectId='project_2' projection={withoutBeatItem} />);

    const rebinned = makeProjection();
    rebinned.projectId = 'project_2';
    view.rerender(<Bin {...view.props} projectId='project_2' projection={rebinned} />);
    await waitFor(() => expect(screen.getByRole('combobox', { name: label })).toHaveValue(':bin-end:'));
    expect(actions.restoreBeat).not.toHaveBeenCalled();
  });

  it('treats a named-provider refusal as failure, keeps focus, and sends no success notification', async () => {
    const actions = makeActions(false);
    const onRestoreSuccess = vi.fn();
    renderBin(makeProjection(), actions, { onRestoreSuccess });
    const button = within(itemFor('shot:shot_parked')).getByRole('button', { name: 'Restore Shot' });
    act(() => button.focus());
    fireEvent.click(button);

    await waitFor(() => expect(actions.restoreShot).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(button).not.toBeDisabled());
    expect(button).toHaveFocus();
    expect(onRestoreSuccess).not.toHaveBeenCalled();
  });

  it('reorders the one global list with Arrow keys and Home/End in canonical RTL order, preserving exact identities and focus', async () => {
    document.documentElement.dir = 'rtl';
    const projection = makeProjection();
    const actions = makeActions();
    renderBin(projection, actions);
    const expected = projection.bin.items.map((entry) => entry.identity);

    const shotHandle = dragHandleFor('shot:shot_parked');
    act(() => shotHandle.focus());
    fireEvent.keyDown(shotHandle, { key: 'ArrowDown' });
    await waitFor(() => expect(actions.reorderBin).toHaveBeenCalledTimes(1));
    expect(actions.reorderBin).toHaveBeenLastCalledWith([expected[1], expected[0]]);
    const firstPayload = vi.mocked(actions.reorderBin).mock.calls[0]![0];
    firstPayload.forEach((item, index) => {
      const source = [expected[1], expected[0]][index]!;
      expect(item).toEqual(source);
      expect(item).not.toBe(source);
    });
    await waitFor(() => expect(shotHandle).toHaveFocus());
    expect(screen.getByText('Moved Lifted Shot from position 1 to 2 of 2')).toBeInTheDocument();

    const beatHandle = dragHandleFor('beat:beat_parked');
    fireEvent.keyDown(beatHandle, { key: 'Home' });
    await waitFor(() => expect(actions.reorderBin).toHaveBeenCalledTimes(2));
    expect(actions.reorderBin).toHaveBeenLastCalledWith([expected[1], expected[0]]);
    await waitFor(() => expect(beatHandle).toHaveFocus());

    fireEvent.keyDown(shotHandle, { key: 'End' });
    await waitFor(() => expect(actions.reorderBin).toHaveBeenCalledTimes(3));
    expect(actions.reorderBin).toHaveBeenLastCalledWith([expected[1], expected[0]]);
    await waitFor(() => expect(shotHandle).toHaveFocus());
    expect(actions.restoreBeat).not.toHaveBeenCalled();
    expect(actions.restoreShot).not.toHaveBeenCalled();
  });

  it('uses the same exact reorder provider for native drag and restores focus to the moved handle', async () => {
    const projection = makeProjection();
    const actions = makeActions();
    renderBin(projection, actions);
    const identities = projection.bin.items.map((entry) => entry.identity);
    const handle = dragHandleFor('shot:shot_parked');
    const target = itemFor('beat:beat_parked');
    const setData = vi.fn();
    const dataTransfer = { effectAllowed: 'none', setData };
    act(() => handle.focus());

    fireEvent.dragStart(handle, { dataTransfer });
    fireEvent.dragOver(target, { dataTransfer });
    fireEvent.drop(target, { dataTransfer });
    await waitFor(() => expect(actions.reorderBin).toHaveBeenCalledWith([identities[1], identities[0]]));
    expect(setData).toHaveBeenCalledWith('text/plain', 'shot:shot_parked');
    await waitFor(() => expect(handle).toHaveFocus());
    expect(screen.getByText('Moved Lifted Shot from position 1 to 2 of 2')).toBeInTheDocument();
  });

  it('makes endpoint keys, foreign drops, and cancelled drags exact zero-provider no-ops', () => {
    const actions = makeActions();
    renderBin(makeProjection(), actions);
    const first = dragHandleFor('shot:shot_parked');
    const last = dragHandleFor('beat:beat_parked');
    const target = itemFor('shot:shot_parked');
    const dataTransfer = { effectAllowed: 'none', setData: vi.fn() };

    fireEvent.keyDown(first, { key: 'ArrowUp' });
    fireEvent.keyDown(first, { key: 'Home' });
    fireEvent.keyDown(last, { key: 'ArrowDown' });
    fireEvent.keyDown(last, { key: 'End' });
    fireEvent.drop(target, { dataTransfer });
    fireEvent.dragStart(first, { dataTransfer });
    fireEvent.dragEnd(first, { dataTransfer });
    fireEvent.drop(target, { dataTransfer });

    expect(actions.reorderBin).not.toHaveBeenCalled();
    expect(actions.restoreBeat).not.toHaveBeenCalled();
    expect(actions.restoreShot).not.toHaveBeenCalled();
  });

  it('settles a requested post-lift focus key once and follows later exact requests', async () => {
    const projection = makeProjection();
    const actions = makeActions();
    const onFocusItemSettled = vi.fn();
    const view = renderBin(projection, actions, {
      focusItemKey: binItemFocusKey({
        kind: 'shot',
        beatId: 'beat_parked',
        shotId: 'shot_parked',
        reason: 'lifted',
      }),
      onFocusItemSettled,
    });

    await waitFor(() => expect(dragHandleFor('shot:shot_parked')).toHaveFocus());
    expect(onFocusItemSettled).toHaveBeenCalledTimes(1);
    view.rerender(<Bin {...view.props} />);
    expect(onFocusItemSettled).toHaveBeenCalledTimes(1);

    view.rerender(<Bin {...view.props} focusItemKey='missing:item' />);
    expect(onFocusItemSettled).toHaveBeenCalledTimes(1);
    view.rerender(<Bin {...view.props} focusItemKey='beat:beat_parked' />);
    await waitFor(() => expect(dragHandleFor('beat:beat_parked')).toHaveFocus());
    expect(onFocusItemSettled).toHaveBeenCalledTimes(2);
  });
});
