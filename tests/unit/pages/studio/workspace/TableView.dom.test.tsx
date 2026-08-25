import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React, { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  WorkspaceBeatProjection,
  WorkspaceBoardPanelProjection,
  WorkspaceShotProjection,
} from '@/renderer/pages/studio/components/Workspace/workspaceProjection';

const tableCss = readFileSync(
  join(process.cwd(), 'packages/desktop/src/renderer/pages/studio/components/Workspace/Views/Table/Table.module.css'),
  'utf8'
);

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => {
      const copy: Record<string, string> = {
        'conversation.creativeStudio.workspace.table.label': 'Beat table',
        'conversation.creativeStudio.workspace.table.columns.position': '#',
        'conversation.creativeStudio.workspace.table.columns.panel': 'Panel',
        'conversation.creativeStudio.workspace.table.columns.beat': 'Beat',
        'conversation.creativeStudio.workspace.table.columns.story': 'Story',
        'conversation.creativeStudio.workspace.table.columns.shots': 'Shots',
        'conversation.creativeStudio.workspace.table.columns.length': 'Length',
        'conversation.creativeStudio.workspace.table.columns.state': 'State',
        'conversation.creativeStudio.workspace.table.targetPending': 'No target',
        'conversation.creativeStudio.workspace.table.actualPending': 'No actual',
        'conversation.creativeStudio.workspace.table.empty': 'No beats yet',
        'conversation.creativeStudio.workspace.table.state.durationPending': 'Duration pending',
        'conversation.creativeStudio.workspace.table.state.noCoverage': 'No coverage',
        'conversation.creativeStudio.workspace.table.state.seedPending': 'First frame pending',
        'conversation.creativeStudio.workspace.table.state.partDone': 'Part done',
        'conversation.creativeStudio.workspace.table.state.rendering': 'Rendering',
        'conversation.creativeStudio.workspace.table.state.stale': 'Stale',
        'conversation.creativeStudio.workspace.table.state.statusPending': 'Status pending',
        'conversation.creativeStudio.workspace.table.state.ready': 'Ready',
        'conversation.creativeStudio.workspace.table.state.draft': 'Draft',
        'conversation.creativeStudio.workspace.table.panel.openDetails': `Open Board panels for ${String(values?.title)}`,
        'conversation.creativeStudio.workspace.table.panel.closeDetails': `Close Board panels for ${String(values?.title)}`,
        'conversation.creativeStudio.workspace.table.panel.detailLabel': `Board panels for ${String(values?.title)}`,
        'conversation.creativeStudio.workspace.table.panel.head': 'Head',
        'conversation.creativeStudio.workspace.table.panel.status.missing': 'Not drawn',
        'conversation.creativeStudio.workspace.table.panel.status.current': 'Current',
        'conversation.creativeStudio.workspace.table.panel.status.stale': 'Stale',
        'conversation.creativeStudio.workspace.table.panel.status.statusPending': 'Status pending',
        'conversation.creativeStudio.workspace.table.panel.status.queued': 'Queued',
        'conversation.creativeStudio.workspace.table.panel.status.drawing': 'Drawing',
        'conversation.creativeStudio.workspace.table.panel.status.needsAttention': 'Needs attention',
        'conversation.creativeStudio.workspace.table.panel.status.failed': 'Failed',
        'conversation.creativeStudio.workspace.table.panel.status.cancelled': 'Cancelled',
        'conversation.creativeStudio.workspace.table.board.label': 'Director Board controls',
        'conversation.creativeStudio.workspace.table.board.progressLabel': 'Board completeness',
        'conversation.creativeStudio.workspace.table.board.style.label': 'Board style',
        'conversation.creativeStudio.workspace.table.board.style.greyTone': 'Grey tone',
        'conversation.creativeStudio.workspace.table.board.style.lineArt': 'Line art',
        'conversation.creativeStudio.workspace.table.board.style.colourKey': 'Colour key',
        'conversation.creativeStudio.workspace.table.board.drawNext': `Draw next batch (${String(values?.count)})`,
        'conversation.creativeStudio.workspace.table.board.stop': 'Stop drawing',
        'conversation.creativeStudio.workspace.table.board.stopNote':
          'Stop requests cancellation where possible. Completed panels and charges already incurred remain.',
        'conversation.creativeStudio.workspace.table.board.styleRequired': 'Choose a Board style before drawing.',
        'conversation.creativeStudio.workspace.table.panel.redrawBeat': 'Redraw Beat · paid',
        'conversation.creativeStudio.jobs.retry': 'Retry generation',
        'conversation.creativeStudio.jobs.retryDownload': 'Retry download',
        'conversation.creativeStudio.jobs.cancel': 'Cancel job',
        'conversation.creativeStudio.jobs.retryChargeTitle': 'Retry with possible duplicate charge?',
        'conversation.creativeStudio.jobs.retryChargeBody':
          'The previous submission outcome is unknown. A replacement may create another provider charge.',
        'conversation.creativeStudio.jobs.retryChargeConfirm': 'Acknowledge and review estimate',
        'conversation.creativeStudio.workspace.beatPanel.common.cancel': 'Cancel',
      };
      if (key === 'conversation.creativeStudio.workspace.table.panel.cardLabel') {
        return `Shot ${String(values?.position)}: ${String(values?.status)}`;
      }
      if (key === 'conversation.creativeStudio.workspace.table.board.progress') {
        return `${String(values?.drawn)} of ${String(values?.total)} panels drawn`;
      }
      if (key === 'conversation.creativeStudio.workspace.table.board.staleCount') {
        return `${String(values?.count)} stale`;
      }
      if (key === 'conversation.creativeStudio.workspace.table.board.busyCount') {
        return `${String(values?.count)} in progress`;
      }
      if (key === 'conversation.creativeStudio.workspace.table.panel.drawMissing') {
        return `Draw missing (${String(values?.count)})`;
      }
      if (key === 'conversation.creativeStudio.workspace.table.panel.redrawShot') {
        return `Redraw Shot ${String(values?.position)} · paid`;
      }
      if (key === 'conversation.creativeStudio.workspace.table.panel.useAsFirstFrame') {
        return `Use Shot ${String(values?.position)} panel as first frame`;
      }
      if (key === 'conversation.creativeStudio.workspace.table.shotCount') {
        const count = Number(values?.count ?? 0);
        return `${count} ${count === 1 ? 'shot' : 'shots'}`;
      }
      if (key === 'conversation.creativeStudio.workspace.table.targetDuration') {
        return `~${String(values?.seconds)}s target`;
      }
      if (key === 'conversation.creativeStudio.workspace.table.actualDuration') {
        return `${String(Math.round(Number(values?.seconds)))}s`;
      }
      return copy[key] ?? key;
    },
  }),
}));

import { useWorkspaceDrafts } from '@/renderer/pages/studio/components/Workspace';
import { TableView, type TableBoardActions } from '@/renderer/pages/studio/components/Workspace/Views/Table';

const makeShot = (id: string, overrides: Partial<WorkspaceShotProjection> = {}): WorkspaceShotProjection => ({
  id,
  shootingScript: id,
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
  title: `Beat ${id}`,
  story: `Story ${id}`,
  targetSeconds: 8,
  actualSeconds: 8,
  displayState: 'ready',
  shots: [makeShot(`${id}_shot`)],
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

const makeBoardDownloadRecovery = (jobId: string): NonNullable<WorkspaceBoardPanelProjection['recovery']> => ({
  jobId,
  canRetry: false,
  canCancel: false,
  canRetryDownload: true,
  submissionUnknown: false,
});

const makeTableBoardActions = (): TableBoardActions => ({
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

const tableBoardProps = (beats: readonly WorkspaceBeatProjection[], onOpenBeat = vi.fn()) => ({
  actions: makeTableBoardActions(),
  projectId: 'project_1',
  boardStyle: 'grey_tone' as const,
  boardPanels: beats.flatMap((beat) => beat.shots.map((shot) => makeBoardPanel(shot.id))),
  imageRouteReady: true,
  pending: false,
  gateLocked: false,
  onOpenBeat,
});

const rowForBeat = (beatId: string): HTMLElement => {
  const row = document.querySelector<HTMLElement>(`[role="row"][data-beat-id="${beatId}"]`);
  if (row === null) throw new Error(`Missing Beat row ${beatId}`);
  return row;
};

const cellAt = (row: HTMLElement, column: number): HTMLElement => within(row).getAllByRole('gridcell')[column]!;

describe('TableView', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it('renders the seven columns and one semantic data row per Beat in film order', () => {
    const beats = [
      makeBeat('opening', { title: 'Opening', story: '', shots: [makeShot('shot_1'), makeShot('shot_2')] }),
      makeBeat('close', { title: 'Close' }),
    ];
    render(<TableView {...tableBoardProps(beats)} beats={beats} selectedBeatId={null} onSelectBeat={vi.fn()} />);

    const grid = screen.getByRole('grid', { name: 'Beat table' });
    const rows = within(grid).getAllByRole('row');
    expect(
      within(rows[0]!)
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent)
    ).toEqual(['#', 'Panel', 'Beat', 'Story', 'Shots', 'Length', 'State']);
    expect(
      within(rows[0]!)
        .getAllByRole('columnheader')
        .map((cell) => cell.dataset.gridColumnName)
    ).toEqual(['position', 'panel', 'beat', 'story', 'shots', 'length', 'state']);
    expect(rows.slice(1).map((row) => cellAt(row, 2).textContent)).toEqual(['Opening', 'Close']);
    expect(rows.slice(1).every((row) => within(row).getAllByRole('gridcell').length === 7)).toBe(true);
    expect(rowForBeat('opening')).toHaveTextContent('2 shots');
    expect(cellAt(rowForBeat('opening'), 3)).toHaveTextContent('');
  });

  it('keeps an empty grid named and headed without inventing a data row', () => {
    render(<TableView {...tableBoardProps([])} beats={[]} selectedBeatId={null} onSelectBeat={vi.fn()} />);

    const grid = screen.getByRole('grid', { name: 'Beat table' });
    expect(within(grid).getAllByRole('row')).toHaveLength(1);
    expect(within(grid).queryAllByRole('gridcell')).toHaveLength(0);
    expect(screen.getByRole('status')).toHaveTextContent('No beats yet');
  });

  it('shows a fixed lead Panel thumbnail and the remaining Shot count from exact film-order status', () => {
    const beats = [
      makeBeat('opening', {
        title: 'Opening',
        shots: [makeShot('shot_1'), makeShot('shot_2'), makeShot('shot_3')],
      }),
    ];
    const boardPanels = [
      makeBoardPanel('shot_1', { assetId: 'board_1', producerJobId: 'job_1', freshness: 'current' }),
      makeBoardPanel('shot_2'),
      makeBoardPanel('shot_3'),
    ];
    render(
      <TableView
        {...tableBoardProps(beats)}
        beats={beats}
        boardPanels={boardPanels}
        selectedBeatId={null}
        onSelectBeat={vi.fn()}
      />
    );

    const panelColumn = screen
      .getByRole('grid', { name: 'Beat table' })
      .querySelector<HTMLTableColElement>('col[data-grid-column-name="panel"]');
    const disclosure = screen.getByRole('button', { name: 'Open Board panels for Opening' });
    expect(panelColumn).toHaveAttribute('data-fixed-inline-size', '96');
    expect(disclosure.querySelector('[data-asset-id="board_1"]')).not.toBeNull();
    expect(disclosure).toHaveTextContent('+2');
  });

  it('opens only one inline Beat detail without opening the BeatPanel and keeps ARIA row geometry exact', async () => {
    const user = userEvent.setup();
    const beats = [
      makeBeat('opening', { title: 'Opening', shots: [makeShot('shot_1'), makeShot('shot_2')] }),
      makeBeat('close', { title: 'Close', shots: [makeShot('shot_3')] }),
    ];
    const onOpenBeat = vi.fn();
    const onSelectBeat = vi.fn();
    render(
      <TableView
        {...tableBoardProps(beats, onOpenBeat)}
        beats={beats}
        selectedBeatId={null}
        onSelectBeat={onSelectBeat}
      />
    );

    const grid = screen.getByRole('grid', { name: 'Beat table' });
    const openingDisclosure = screen.getByRole('button', { name: 'Open Board panels for Opening' });
    await user.click(openingDisclosure);

    const openingDetail = screen.getByRole('region', { name: 'Board panels for Opening' });
    expect(onSelectBeat).toHaveBeenLastCalledWith('opening');
    expect(onOpenBeat).not.toHaveBeenCalled();
    expect(openingDisclosure).toHaveAttribute('aria-expanded', 'true');
    expect(openingDisclosure).toHaveAttribute('aria-controls', openingDetail.id);
    expect(grid).toHaveAttribute('aria-rowcount', '4');
    expect(rowForBeat('opening')).toHaveAttribute('aria-rowindex', '2');
    expect(openingDetail.closest('[role="row"]')).toHaveAttribute('aria-rowindex', '3');
    expect(rowForBeat('close')).toHaveAttribute('aria-rowindex', '4');

    await user.click(screen.getByRole('button', { name: 'Open Board panels for Close' }));
    expect(screen.queryByRole('region', { name: 'Board panels for Opening' })).toBeNull();
    expect(screen.getByRole('region', { name: 'Board panels for Close' })).toBeInTheDocument();
    expect(rowForBeat('close')).toHaveAttribute('aria-rowindex', '3');
    expect(screen.getByRole('region', { name: 'Board panels for Close' }).closest('[role="row"]')).toHaveAttribute(
      'aria-rowindex',
      '4'
    );

    await user.click(rowForBeat('opening'));
    expect(onOpenBeat).toHaveBeenLastCalledWith('opening');
  });

  it('fences disclosure activation from the Beat row and lets arrows leave a pointer-focused button', async () => {
    const user = userEvent.setup();
    const beats = [makeBeat('opening', { title: 'Opening' }), makeBeat('close', { title: 'Close' })];
    const onOpenBeat = vi.fn();
    const onSelectBeat = vi.fn();
    render(
      <TableView
        {...tableBoardProps(beats, onOpenBeat)}
        beats={beats}
        selectedBeatId={null}
        onSelectBeat={onSelectBeat}
      />
    );
    const disclosure = screen.getByRole('button', { name: 'Open Board panels for Opening' });

    act(() => disclosure.focus());
    await user.keyboard('{Enter}');
    expect(onSelectBeat).toHaveBeenCalledTimes(1);
    expect(onOpenBeat).not.toHaveBeenCalled();
    expect(screen.getByRole('region', { name: 'Board panels for Opening' })).toBeInTheDocument();

    await user.keyboard('{ArrowDown}');
    expect(cellAt(rowForBeat('close'), 1)).toHaveFocus();
    expect(onOpenBeat).not.toHaveBeenCalled();
    expect(
      screen.getByRole('grid', { name: 'Beat table' }).querySelectorAll('[role="gridcell"][tabindex="0"]')
    ).toHaveLength(1);
  });

  it('closes inline details with Escape from either detail content or its roving Panel cell and restores the button', async () => {
    const user = userEvent.setup();
    const beats = [makeBeat('opening', { title: 'Opening' })];
    render(<TableView {...tableBoardProps(beats)} beats={beats} selectedBeatId={null} onSelectBeat={vi.fn()} />);
    const disclosure = screen.getByRole('button', { name: 'Open Board panels for Opening' });
    await user.click(disclosure);
    const detail = screen.getByRole('region', { name: 'Board panels for Opening' });
    act(() => detail.focus());
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('region', { name: 'Board panels for Opening' })).toBeNull();
    expect(disclosure).toHaveFocus();

    act(() => cellAt(rowForBeat('opening'), 1).focus());
    await user.keyboard('{Enter}');
    expect(screen.getByRole('region', { name: 'Board panels for Opening' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('region', { name: 'Board panels for Opening' })).toBeNull();
    expect(disclosure).toHaveFocus();
  });

  it('renders one 104 by 59 card per Shot and tags every actual segment head', async () => {
    const user = userEvent.setup();
    const beats = [
      makeBeat('opening', {
        title: 'Opening',
        shots: [
          makeShot('shot_1', { segmentHead: true }),
          makeShot('shot_2', { segmentHead: false }),
          makeShot('shot_3', { segmentHead: true }),
        ],
      }),
    ];
    const boardPanels = [
      makeBoardPanel('shot_1', { assetId: 'board_1', producerJobId: 'job_1', freshness: 'current' }),
      makeBoardPanel('shot_2', { freshness: 'stale', staleCauses: ['request_out_of_date'] }),
      makeBoardPanel('shot_3', { activity: 'drawing', latestJobId: 'job_3' }),
    ];
    render(
      <TableView
        {...tableBoardProps(beats)}
        beats={beats}
        boardPanels={boardPanels}
        selectedBeatId={null}
        onSelectBeat={vi.fn()}
      />
    );
    await user.click(screen.getByRole('button', { name: 'Open Board panels for Opening' }));

    expect(screen.getAllByRole('article')).toHaveLength(3);
    expect(screen.getAllByText('Head')).toHaveLength(2);
    expect(screen.getByRole('article', { name: 'Shot 2: Stale' })).toHaveTextContent('Stale');
    expect(screen.getByRole('article', { name: 'Shot 3: Drawing' })).toHaveTextContent('Drawing');
    expect(tableCss).toMatch(/\.panelFrame\s*{[^}]*inline-size:\s*104px[^}]*block-size:\s*59px/s);
  });

  it('offers first-frame promotion only for a stable current Board panel on an actual segment head', async () => {
    const user = userEvent.setup();
    const actions = makeTableBoardActions();
    const beats = [
      makeBeat('opening', {
        title: 'Opening',
        shots: [
          makeShot('shot_head', { segmentHead: true }),
          makeShot('shot_continuous', { segmentHead: false }),
          makeShot('shot_already_pinned', { segmentHead: true, explicitSeedAssetId: 'board_pinned' }),
          makeShot('shot_stale_head', { segmentHead: true }),
          makeShot('shot_busy_head', { segmentHead: true }),
          makeShot('shot_attention_head', { segmentHead: true }),
        ],
      }),
    ];
    const boardPanels = [
      makeBoardPanel('shot_head', { assetId: 'board_head', producerJobId: 'job_head', freshness: 'current' }),
      makeBoardPanel('shot_continuous', {
        assetId: 'board_continuous',
        producerJobId: 'job_continuous',
        freshness: 'current',
      }),
      makeBoardPanel('shot_already_pinned', {
        assetId: 'board_pinned',
        producerJobId: 'job_pinned',
        freshness: 'current',
      }),
      makeBoardPanel('shot_stale_head', {
        assetId: 'board_stale',
        producerJobId: 'job_stale',
        freshness: 'stale',
        staleCauses: ['request_out_of_date'],
      }),
      makeBoardPanel('shot_busy_head', {
        assetId: 'board_busy',
        producerJobId: 'job_busy',
        latestJobId: 'job_redraw',
        freshness: 'current',
        activity: 'drawing',
      }),
      makeBoardPanel('shot_attention_head', {
        assetId: 'board_attention',
        producerJobId: 'job_attention_producer',
        latestJobId: 'job_attention',
        freshness: 'current',
        activity: 'needs_attention',
      }),
    ];
    const { rerender } = render(
      <TableView
        {...tableBoardProps(beats)}
        actions={actions}
        beats={beats}
        boardPanels={boardPanels}
        selectedBeatId={null}
        onSelectBeat={vi.fn()}
      />
    );
    await user.click(screen.getByRole('button', { name: 'Open Board panels for Opening' }));

    const promote = screen.getByRole('button', { name: 'Use Shot 1 panel as first frame' });
    expect(screen.queryByRole('button', { name: /Use Shot [2-6] panel as first frame/ })).toBeNull();
    await user.click(promote);
    expect(actions.promotePanel).toHaveBeenCalledExactlyOnceWith('shot_head', 'board_head');

    rerender(
      <TableView
        {...tableBoardProps(beats)}
        actions={actions}
        beats={beats}
        boardPanels={boardPanels}
        gateLocked
        selectedBeatId={null}
        onSelectBeat={vi.fn()}
      />
    );
    expect(screen.getByRole('button', { name: 'Use Shot 1 panel as first frame' })).toBeDisabled();
  });

  it('fails closed instead of cross-associating reordered Board panel status', async () => {
    const user = userEvent.setup();
    const beats = [makeBeat('opening', { title: 'Opening', shots: [makeShot('shot_1'), makeShot('shot_2')] })];
    const reordered = [
      makeBoardPanel('shot_2', { assetId: 'board_2', freshness: 'current' }),
      makeBoardPanel('shot_1', { assetId: 'board_1', freshness: 'current' }),
    ];
    render(
      <TableView
        {...tableBoardProps(beats)}
        beats={beats}
        boardPanels={reordered}
        selectedBeatId={null}
        onSelectBeat={vi.fn()}
      />
    );

    const disclosure = screen.getByRole('button', { name: 'Open Board panels for Opening' });
    expect(disclosure.querySelector('[data-asset-id]')).toBeNull();
    expect(disclosure.querySelector('[data-freshness="status_pending"]')).not.toBeNull();
    await user.click(disclosure);
    expect(screen.getAllByText('Status pending')).toHaveLength(2);
  });

  it('names exact Board completeness separately from the capped next paid batch and exposes style as radios', async () => {
    const user = userEvent.setup();
    const actions = makeTableBoardActions();
    const shots = Array.from({ length: 30 }, (_, index) => makeShot(`shot_${String(index + 1)}`));
    const beats = [makeBeat('opening', { title: 'Opening', shots })];
    const boardPanels = shots.map((shot, index) =>
      makeBoardPanel(
        shot.id,
        index === 0
          ? { assetId: 'board_1', producerJobId: 'job_1', freshness: 'current' }
          : index === 1
            ? {
                assetId: 'board_2',
                producerJobId: 'job_2',
                freshness: 'stale',
                staleCauses: ['request_out_of_date'],
              }
            : {}
      )
    );
    render(
      <TableView
        {...tableBoardProps(beats)}
        actions={actions}
        beats={beats}
        boardPanels={boardPanels}
        selectedBeatId={null}
        onSelectBeat={vi.fn()}
      />
    );

    const controls = screen.getByRole('region', { name: 'Director Board controls' });
    expect(within(controls).getByText('2 of 30 panels drawn')).toBeInTheDocument();
    expect(within(controls).getByText('1 stale')).toBeInTheDocument();
    expect(within(controls).getByText('0 in progress')).toBeInTheDocument();
    expect(within(controls).getByRole('progressbar', { name: 'Board completeness' })).toHaveAttribute('max', '30');
    expect(within(controls).getByRole('progressbar', { name: 'Board completeness' })).toHaveAttribute('value', '2');

    const drawNext = within(controls).getByRole('button', { name: 'Draw next batch (24)' });
    expect(drawNext).toBeEnabled();
    act(() => drawNext.focus());
    await user.keyboard('{Enter}');
    expect(actions.drawNext).toHaveBeenCalledTimes(1);

    const greyTone = within(controls).getByRole('radio', { name: 'Grey tone' });
    expect(greyTone).toBeChecked();
    await user.click(within(controls).getByRole('radio', { name: 'Line art' }));
    expect(actions.setStyle).toHaveBeenCalledWith('line_art');
  });

  it('fails Board generation controls closed when style, route, or exact panel status is unavailable', () => {
    const beats = [makeBeat('opening', { title: 'Opening' })];
    const actions = makeTableBoardActions();
    const { rerender } = render(
      <TableView
        {...tableBoardProps(beats)}
        actions={actions}
        beats={beats}
        boardStyle={null}
        selectedBeatId={null}
        onSelectBeat={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: 'Draw next batch (1)' })).toBeDisabled();
    expect(screen.getByText('Choose a Board style before drawing.')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Grey tone' })).toBeEnabled();

    rerender(
      <TableView
        {...tableBoardProps(beats)}
        actions={actions}
        beats={beats}
        imageRouteReady={false}
        selectedBeatId={null}
        onSelectBeat={vi.fn()}
      />
    );
    expect(screen.getByRole('button', { name: 'Draw next batch (1)' })).toBeDisabled();
    expect(screen.getByRole('radio', { name: 'Grey tone' })).toBeEnabled();

    rerender(
      <TableView
        {...tableBoardProps(beats)}
        actions={actions}
        beats={beats}
        boardPanels={[makeBoardPanel('opening_shot', { freshness: 'status_pending', activity: 'status_pending' })]}
        selectedBeatId={null}
        onSelectBeat={vi.fn()}
      />
    );
    expect(screen.getByRole('button', { name: 'Draw next batch (0)' })).toBeDisabled();
    expect(screen.getByRole('radio', { name: 'Grey tone' })).toBeDisabled();
    expect(actions.drawNext).not.toHaveBeenCalled();
  });

  it('offers Stop only for active Board work, preserves the completed/charged warning, and locks style changes', async () => {
    const user = userEvent.setup();
    const beats = [makeBeat('opening', { title: 'Opening' })];
    const actions = makeTableBoardActions();
    render(
      <TableView
        {...tableBoardProps(beats)}
        actions={actions}
        beats={beats}
        boardPanels={[
          makeBoardPanel('opening_shot', {
            assetId: 'retained_board',
            producerJobId: 'job_done',
            latestJobId: 'job_redraw',
            freshness: 'current',
            activity: 'drawing',
          }),
        ]}
        selectedBeatId={null}
        onSelectBeat={vi.fn()}
      />
    );

    expect(screen.getByText('1 of 1 panels drawn')).toBeInTheDocument();
    expect(screen.getByText('1 in progress')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Draw next batch/ })).toBeNull();
    expect(
      screen.getByText(
        'Stop requests cancellation where possible. Completed panels and charges already incurred remain.'
      )
    ).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Grey tone' })).toBeDisabled();
    const stop = screen.getByRole('button', { name: 'Stop drawing' });
    act(() => stop.focus());
    await user.keyboard('{Enter}');
    expect(actions.stop).toHaveBeenCalledTimes(1);
  });

  it('separates Board attention from active progress and exposes only sanitized retry/cancel authority', async () => {
    const user = userEvent.setup();
    const actions = makeTableBoardActions();
    const beats = [
      makeBeat('opening', {
        title: 'Opening',
        shots: [makeShot('shot_unknown'), makeShot('shot_retryable')],
      }),
    ];
    const boardPanels = [
      makeBoardPanel('shot_unknown', {
        activity: 'needs_attention',
        latestJobId: 'job_unknown',
        recovery: {
          jobId: 'job_unknown',
          canRetry: true,
          canCancel: false,
          canRetryDownload: false,
          submissionUnknown: true,
        },
      }),
      makeBoardPanel('shot_retryable', {
        activity: 'needs_attention',
        latestJobId: 'job_retryable',
        recovery: {
          jobId: 'job_retryable',
          canRetry: true,
          canCancel: true,
          canRetryDownload: false,
          submissionUnknown: false,
        },
      }),
    ];
    const { rerender } = render(
      <TableView
        {...tableBoardProps(beats)}
        actions={actions}
        beats={beats}
        boardPanels={boardPanels}
        selectedBeatId={null}
        onSelectBeat={vi.fn()}
      />
    );

    expect(screen.getByText('0 in progress')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Stop drawing' })).toBeNull();
    expect(screen.getByRole('radio', { name: 'Grey tone' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Open Board panels for Opening' }));

    const unknown = document.querySelector<HTMLElement>('[data-board-recovery-job-id="job_unknown"]');
    const retryable = document.querySelector<HTMLElement>('[data-board-recovery-job-id="job_retryable"]');
    if (unknown === null || retryable === null) throw new Error('Missing sanitized Board recovery controls');
    expect(within(unknown).queryByRole('button', { name: 'Cancel job' })).toBeNull();
    await user.click(within(unknown).getByRole('button', { name: 'Retry generation' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Acknowledge and review estimate' }));
    expect(actions.retryJob).toHaveBeenCalledWith('job_unknown', true);

    await user.click(within(retryable).getByRole('button', { name: 'Retry generation' }));
    expect(actions.retryJob).toHaveBeenCalledWith('job_retryable', false);
    await user.click(within(retryable).getByRole('button', { name: 'Cancel job' }));
    expect(actions.cancelJob).toHaveBeenCalledWith('job_retryable');

    rerender(
      <TableView
        {...tableBoardProps(beats)}
        actions={actions}
        beats={beats}
        boardPanels={boardPanels}
        gateLocked
        selectedBeatId={null}
        onSelectBeat={vi.fn()}
      />
    );
    expect(
      Array.from(document.querySelectorAll<HTMLElement>('[data-board-recovery-job-id] button')).every((button) =>
        button.hasAttribute('disabled')
      )
    ).toBe(true);
  });

  it('offers no-charge download recovery without offering a fresh paid Draw or Redraw', async () => {
    const user = userEvent.setup();
    const actions = makeTableBoardActions();
    const beats = [
      makeBeat('opening', {
        title: 'Opening',
        shots: [makeShot('shot_missing'), makeShot('shot_retained')],
      }),
    ];
    const boardPanels = [
      makeBoardPanel('shot_missing', {
        activity: 'failed',
        latestJobId: 'job_missing_download',
        recovery: makeBoardDownloadRecovery('job_missing_download'),
      }),
      makeBoardPanel('shot_retained', {
        assetId: 'board_retained',
        producerJobId: 'job_retained_producer',
        latestJobId: 'job_retained_download',
        freshness: 'current',
        activity: 'failed',
        recovery: makeBoardDownloadRecovery('job_retained_download'),
      }),
    ];
    render(
      <TableView
        {...tableBoardProps(beats)}
        actions={actions}
        beats={beats}
        boardPanels={boardPanels}
        selectedBeatId={null}
        onSelectBeat={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: 'Draw next batch (0)' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Open Board panels for Opening' }));
    expect(screen.queryByRole('button', { name: /Draw missing/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Redraw Beat · paid' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Redraw Shot/ })).toBeNull();

    const missing = document.querySelector<HTMLElement>('[data-board-recovery-job-id="job_missing_download"]');
    const retained = document.querySelector<HTMLElement>('[data-board-recovery-job-id="job_retained_download"]');
    if (missing === null || retained === null) throw new Error('Missing Board download recovery controls');
    await user.click(within(missing).getByRole('button', { name: 'Retry download' }));
    await user.click(within(retained).getByRole('button', { name: 'Retry download' }));
    expect(actions.retryDownload).toHaveBeenNthCalledWith(1, 'job_missing_download');
    expect(actions.retryDownload).toHaveBeenNthCalledWith(2, 'job_retained_download');
    expect(actions.drawNext).not.toHaveBeenCalled();
    expect(actions.drawBeat).not.toHaveBeenCalled();
    expect(actions.redrawShot).not.toHaveBeenCalled();
    expect(actions.redrawBeat).not.toHaveBeenCalled();
  });

  it('draws only exact drawable missing panels in one Beat and offers paid redraw only for existing panels', async () => {
    const user = userEvent.setup();
    const actions = makeTableBoardActions();
    const beats = [
      makeBeat('opening', {
        title: 'Opening',
        shots: [makeShot('shot_1'), makeShot('shot_2'), makeShot('shot_3'), makeShot('shot_4')],
      }),
    ];
    const boardPanels = [
      makeBoardPanel('shot_1', { assetId: 'board_1', producerJobId: 'job_1', freshness: 'current' }),
      makeBoardPanel('shot_2'),
      makeBoardPanel('shot_3', { activity: 'failed', latestJobId: 'job_3' }),
      makeBoardPanel('shot_4', { activity: 'queued', latestJobId: 'job_4' }),
    ];
    render(
      <TableView
        {...tableBoardProps(beats)}
        actions={actions}
        beats={beats}
        boardPanels={boardPanels}
        selectedBeatId={null}
        onSelectBeat={vi.fn()}
      />
    );
    await user.click(screen.getByRole('button', { name: 'Open Board panels for Opening' }));

    expect(screen.queryByRole('button', { name: 'Redraw Beat · paid' })).toBeNull();
    const drawMissing = screen.getByRole('button', { name: 'Draw missing (2)' });
    act(() => drawMissing.focus());
    await user.keyboard('{Enter}');
    expect(actions.drawBeat).toHaveBeenCalledWith('opening');
    const redrawShots = screen.getAllByRole('button', { name: /Redraw Shot/ });
    expect(redrawShots).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Redraw Shot 1 · paid' }));
    expect(actions.redrawShot).toHaveBeenCalledWith('shot_1');
  });

  it('offers paid Beat and per-panel redraw only when every panel exists and is exactly drawable', async () => {
    const user = userEvent.setup();
    const actions = makeTableBoardActions();
    const beats = [
      makeBeat('opening', {
        title: 'Opening',
        shots: [makeShot('shot_1'), makeShot('shot_2'), makeShot('shot_3')],
      }),
    ];
    const boardPanels = [
      makeBoardPanel('shot_1', { assetId: 'board_1', producerJobId: 'job_1', freshness: 'current' }),
      makeBoardPanel('shot_2', {
        assetId: 'board_2',
        producerJobId: 'job_2',
        freshness: 'stale',
        activity: 'failed',
        staleCauses: ['route_out_of_date'],
      }),
      makeBoardPanel('shot_3', {
        assetId: 'board_3',
        producerJobId: 'job_3',
        freshness: 'current',
        activity: 'cancelled',
      }),
    ];
    const { rerender } = render(
      <TableView
        {...tableBoardProps(beats)}
        actions={actions}
        beats={beats}
        boardPanels={boardPanels}
        selectedBeatId={null}
        onSelectBeat={vi.fn()}
      />
    );
    await user.click(screen.getByRole('button', { name: 'Open Board panels for Opening' }));

    expect(screen.queryByRole('button', { name: /Draw missing/ })).toBeNull();
    const redrawBeat = screen.getByRole('button', { name: 'Redraw Beat · paid' });
    expect(redrawBeat).toBeEnabled();
    await user.click(redrawBeat);
    expect(actions.redrawBeat).toHaveBeenCalledWith('opening');
    expect(screen.getAllByRole('button', { name: /Redraw Shot/ })).toHaveLength(3);

    rerender(
      <TableView
        {...tableBoardProps(beats)}
        actions={actions}
        beats={beats}
        boardPanels={boardPanels}
        gateLocked
        selectedBeatId={null}
        onSelectBeat={vi.fn()}
      />
    );
    expect(screen.getByRole('button', { name: 'Redraw Beat · paid' })).toBeDisabled();
    expect(
      screen.getAllByRole('button', { name: /Redraw Shot/ }).every((button) => button.hasAttribute('disabled'))
    ).toBe(true);
  });

  it('keeps roving ArrowDown navigation on Beat cells while an inline detail row is open', async () => {
    const user = userEvent.setup();
    const beats = [makeBeat('opening', { title: 'Opening' }), makeBeat('close', { title: 'Close' })];
    render(<TableView {...tableBoardProps(beats)} beats={beats} selectedBeatId={null} onSelectBeat={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Open Board panels for Opening' }));
    act(() => cellAt(rowForBeat('opening'), 0).focus());
    await user.keyboard('{ArrowDown}');
    expect(cellAt(rowForBeat('close'), 0)).toHaveFocus();
  });

  it('traverses all 24 Beat rows vertically with one clamped roving tab stop and no selection', async () => {
    const user = userEvent.setup();
    const onOpenBeat = vi.fn();
    const beats = Array.from({ length: 24 }, (_, index) => makeBeat(`beat_${index + 1}`));
    render(
      <TableView {...tableBoardProps(beats, onOpenBeat)} beats={beats} selectedBeatId={null} onSelectBeat={vi.fn()} />
    );
    const grid = screen.getByRole('grid', { name: 'Beat table' });
    const rows = within(grid).getAllByRole('row').slice(1);
    const first = cellAt(rows[0]!, 0);
    const last = cellAt(rows[23]!, 0);

    act(() => first.focus());
    await user.keyboard('{ArrowUp}');
    expect(first).toHaveFocus();
    for (let index = 0; index < 23; index += 1) {
      // eslint-disable-next-line no-await-in-loop -- each key must move focus before the next key is dispatched
      await user.keyboard('{ArrowDown}');
    }
    expect(last).toHaveFocus();
    expect(last).toHaveAttribute('tabindex', '0');
    expect(first).toHaveAttribute('tabindex', '-1');
    await user.keyboard('{ArrowDown}');
    expect(last).toHaveFocus();
    expect(grid.querySelectorAll('[role="gridcell"][tabindex="0"]')).toHaveLength(1);
    expect(onOpenBeat).not.toHaveBeenCalled();
  });

  it('moves across columns and supports clamped row and grid Home/End navigation', async () => {
    const user = userEvent.setup();
    const beats = [makeBeat('beat_1'), makeBeat('beat_2')];
    render(<TableView {...tableBoardProps(beats)} beats={beats} selectedBeatId={null} onSelectBeat={vi.fn()} />);
    const rows = screen.getAllByRole('row').slice(1);
    const first = cellAt(rows[0]!, 0);
    act(() => first.focus());

    await user.keyboard('{ArrowLeft}{ArrowRight}');
    expect(cellAt(rows[0]!, 1)).toHaveFocus();
    await user.keyboard('{End}');
    expect(cellAt(rows[0]!, 6)).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(cellAt(rows[0]!, 6)).toHaveFocus();
    fireEvent.keyDown(cellAt(rows[0]!, 6), { key: 'End', ctrlKey: true });
    expect(cellAt(rows[1]!, 6)).toHaveFocus();
    fireEvent.keyDown(cellAt(rows[1]!, 6), { key: 'Home', metaKey: true });
    expect(first).toHaveFocus();
  });

  it('selects the exact Beat by click, Enter, or Space while arrows only move focus', async () => {
    const user = userEvent.setup();
    const onOpenBeat = vi.fn();
    const onSelectBeat = vi.fn();
    const beats = [
      makeBeat('multi', { shots: [makeShot('shot_1'), makeShot('shot_2')] }),
      makeBeat('empty', { shots: [] }),
    ];
    render(
      <TableView
        {...tableBoardProps(beats, onOpenBeat)}
        beats={beats}
        selectedBeatId={null}
        onSelectBeat={onSelectBeat}
      />
    );
    const multi = rowForBeat('multi');
    const empty = rowForBeat('empty');
    fireEvent.click(multi);
    expect(onOpenBeat).toHaveBeenLastCalledWith('multi');

    act(() => cellAt(multi, 0).focus());
    await user.keyboard('{ArrowDown}{Enter}');
    expect(onOpenBeat).toHaveBeenLastCalledWith('empty');
    await user.keyboard('{Space}');
    expect(onOpenBeat).toHaveBeenLastCalledWith('empty');
    expect(onOpenBeat).toHaveBeenCalledTimes(3);
    expect(onSelectBeat).not.toHaveBeenCalled();
    expect(empty).toHaveAttribute('aria-selected', 'false');
  });

  it('keeps multi-shot and zero-shot Beat selection in the shared owner without changing paid Shot selection', () => {
    const beats = [
      makeBeat('multi', { shots: [makeShot('shot_1'), makeShot('shot_2')] }),
      makeBeat('empty', { shots: [], actualSeconds: null, displayState: 'no_coverage' }),
    ];
    window.sessionStorage.setItem(
      'aionui:creative-studio:v3:workspace-drafts:project_1',
      JSON.stringify({
        version: 3,
        projectId: 'project_1',
        sourceRevision: 3,
        entries: {},
        selection: { selectedBeatId: null, selectedShotIds: ['shot_2'], anchorShotId: 'shot_2' },
      })
    );

    const Harness = () => {
      const [showTable, setShowTable] = useState(true);
      const drafts = useWorkspaceDrafts({
        projectId: 'project_1',
        projectRevision: 3,
        canonicalValues: {},
        activeBeatIds: ['multi', 'empty'],
        activeShotIds: ['shot_1', 'shot_2'],
      });
      return (
        <>
          <button type='button' onClick={() => setShowTable((current) => !current)}>
            Toggle presentation
          </button>
          <output data-testid='selection'>{JSON.stringify(drafts.selection)}</output>
          {showTable ? (
            <TableView
              {...tableBoardProps(beats, drafts.selectBeat)}
              beats={beats}
              selectedBeatId={drafts.selection.selectedBeatId}
              onSelectBeat={drafts.selectBeat}
            />
          ) : (
            <div data-testid='alternate-presentation'>{drafts.selection.selectedBeatId}</div>
          )}
        </>
      );
    };

    render(<Harness />);
    const shotSelectionBytes = (): string => {
      const selection = JSON.parse(screen.getByTestId('selection').textContent ?? '{}') as {
        selectedShotIds?: unknown;
        anchorShotId?: unknown;
      };
      return JSON.stringify({
        selectedShotIds: selection.selectedShotIds,
        anchorShotId: selection.anchorShotId,
      });
    };
    const preservedShotSelection = shotSelectionBytes();
    fireEvent.click(rowForBeat('multi'));
    expect(JSON.parse(screen.getByTestId('selection').textContent ?? '{}')).toEqual({
      selectedBeatId: 'multi',
      selectedShotIds: ['shot_2'],
      anchorShotId: 'shot_2',
    });
    expect(shotSelectionBytes()).toBe(preservedShotSelection);
    fireEvent.click(rowForBeat('empty'));
    expect(JSON.parse(screen.getByTestId('selection').textContent ?? '{}')).toEqual({
      selectedBeatId: 'empty',
      selectedShotIds: ['shot_2'],
      anchorShotId: 'shot_2',
    });
    expect(shotSelectionBytes()).toBe(preservedShotSelection);

    fireEvent.click(screen.getByRole('button', { name: 'Toggle presentation' }));
    expect(screen.getByTestId('alternate-presentation')).toHaveTextContent('empty');
    fireEvent.click(screen.getByRole('button', { name: 'Toggle presentation' }));
    expect(rowForBeat('empty')).toHaveAttribute('aria-selected', 'true');
  });

  it('renders one rounded actual fact for a covered Beat even when it also has a target', () => {
    const beats = [makeBeat('equal', { targetSeconds: 9, actualSeconds: 9.52 })];
    render(<TableView {...tableBoardProps(beats)} beats={beats} selectedBeatId={null} onSelectBeat={vi.fn()} />);
    const length = cellAt(rowForBeat('equal'), 5);
    const facts = length.querySelectorAll<HTMLElement>('[data-duration-kind]');
    expect(facts).toHaveLength(1);
    const actual = facts[0];
    if (actual === undefined) throw new Error('Missing actual duration fact');
    expect(actual).toHaveAttribute('data-duration-kind', 'actual');
    expect(actual).toHaveTextContent('10s');
    expect(length).not.toHaveTextContent('~9s target');
  });

  it('shows exactly one coverage-appropriate duration fact and never invents zero seconds', () => {
    const beats = [
      makeBeat('duration_pending', {
        targetSeconds: null,
        actualSeconds: null,
        displayState: 'duration_pending',
        shots: [],
      }),
      makeBeat('no_coverage', {
        targetSeconds: 7,
        actualSeconds: null,
        displayState: 'no_coverage',
        shots: [],
      }),
      makeBeat('covered_pending', { targetSeconds: 7, actualSeconds: null }),
      makeBeat('covered', { targetSeconds: 7, actualSeconds: 8 }),
      makeBeat('max_target', {
        targetSeconds: 1440,
        actualSeconds: null,
        displayState: 'no_coverage',
        shots: [],
      }),
    ];
    render(<TableView {...tableBoardProps(beats)} beats={beats} selectedBeatId={null} onSelectBeat={vi.fn()} />);
    const pending = cellAt(rowForBeat('duration_pending'), 5);
    const uncovered = cellAt(rowForBeat('no_coverage'), 5);
    const coveredPending = cellAt(rowForBeat('covered_pending'), 5);
    const covered = cellAt(rowForBeat('covered'), 5);
    const maxTarget = cellAt(rowForBeat('max_target'), 5);

    expect(pending).toHaveTextContent('No target');
    expect(pending.querySelectorAll('[data-duration-kind]')).toHaveLength(1);
    expect(pending.querySelector('[data-duration-kind]')).toHaveAttribute('data-duration-kind', 'target');
    expect(uncovered).toHaveTextContent('~7s target');
    expect(uncovered.querySelectorAll('[data-duration-kind]')).toHaveLength(1);
    expect(uncovered.querySelector('[data-duration-kind]')).toHaveAttribute('data-duration-kind', 'target');
    expect(coveredPending).toHaveTextContent('No actual');
    expect(coveredPending.querySelectorAll('[data-duration-kind]')).toHaveLength(1);
    expect(coveredPending.querySelector('[data-duration-kind]')).toHaveAttribute('data-duration-kind', 'actual');
    expect(covered).toHaveTextContent('8s');
    expect(covered).not.toHaveTextContent('~7s target');
    expect(covered.querySelectorAll('[data-duration-kind]')).toHaveLength(1);
    expect(covered.querySelector('[data-duration-kind]')).toHaveAttribute('data-duration-kind', 'actual');
    expect(maxTarget).toHaveTextContent('~1440s target');
    expect(maxTarget.querySelectorAll('[data-duration-kind]')).toHaveLength(1);
    expect(maxTarget.querySelector('[data-duration-kind]')).toHaveAttribute('data-duration-kind', 'target');
    for (const length of [pending, uncovered, coveredPending, covered, maxTarget]) {
      expect(length.textContent).not.toMatch(/^~?0s(?:\s|$)/);
    }
  });

  it('names every Beat state in text rather than relying on color', () => {
    const states: Array<[WorkspaceBeatProjection['displayState'], string]> = [
      ['duration_pending', 'Duration pending'],
      ['no_coverage', 'No coverage'],
      ['seed_pending', 'First frame pending'],
      ['part_done', 'Part done'],
      ['rendering', 'Rendering'],
      ['stale', 'Stale'],
      ['status_pending', 'Status pending'],
      ['ready', 'Ready'],
      ['draft', 'Draft'],
    ];
    const beats = states.map(([state]) => makeBeat(state, { displayState: state }));
    render(<TableView {...tableBoardProps(beats)} beats={beats} selectedBeatId={null} onSelectBeat={vi.fn()} />);

    for (const [state, label] of states) {
      const stateCell = cellAt(rowForBeat(state), 6);
      expect(stateCell).toHaveTextContent(label);
      expect(stateCell.querySelector('[data-state]')).toHaveAttribute('data-state', state);
    }
  });
});

describe('the Table layout contract', () => {
  it('keeps one seven-column grid and addresses columns semantically', () => {
    expect(tableCss).toMatch(/\.grid\s*{[^}]*min-inline-size:\s*0/s);
    expect(tableCss).not.toContain('nth-child');
    const durationRule = tableCss.match(/\.durationFact\s*{([^}]*)}/s)?.[1] ?? '';
    expect(durationRule).not.toContain('overflow: hidden');
    expect(durationRule).not.toContain('text-overflow: ellipsis');
  });
});
