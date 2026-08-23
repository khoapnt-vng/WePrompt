import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React, { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  WorkspaceBeatProjection,
  WorkspaceShotProjection,
} from '@/renderer/pages/studio/components/Workspace/workspaceProjection';
import { tableFoldsLook } from '@/renderer/pages/studio/components/Workspace/Views/Table/lookFold';

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
        'conversation.creativeStudio.workspace.table.columns.beat': 'Beat',
        'conversation.creativeStudio.workspace.table.columns.action': 'Action',
        'conversation.creativeStudio.workspace.table.columns.look': 'Look',
        'conversation.creativeStudio.workspace.table.columns.actionLook': 'Action · Look',
        'conversation.creativeStudio.workspace.table.columns.shots': 'Shots',
        'conversation.creativeStudio.workspace.table.columns.length': 'Length',
        'conversation.creativeStudio.workspace.table.columns.state': 'State',
        'conversation.creativeStudio.workspace.table.lookMissing': 'No look written yet',
        'conversation.creativeStudio.workspace.table.targetPending': 'No target',
        'conversation.creativeStudio.workspace.table.actualPending': 'No actual',
        'conversation.creativeStudio.workspace.table.empty': 'No beats yet',
        'conversation.creativeStudio.workspace.table.state.durationPending': 'Duration pending',
        'conversation.creativeStudio.workspace.table.state.noCoverage': 'No coverage',
        'conversation.creativeStudio.workspace.table.state.seedPending': 'Seed pending',
        'conversation.creativeStudio.workspace.table.state.partDone': 'Part done',
        'conversation.creativeStudio.workspace.table.state.rendering': 'Rendering',
        'conversation.creativeStudio.workspace.table.state.stale': 'Stale',
        'conversation.creativeStudio.workspace.table.state.statusPending': 'Status pending',
        'conversation.creativeStudio.workspace.table.state.ready': 'Ready',
        'conversation.creativeStudio.workspace.table.state.draft': 'Draft',
      };
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
import { TableView } from '@/renderer/pages/studio/components/Workspace/Views/Table';

const makeShot = (id: string): WorkspaceShotProjection => ({
  id,
  line: id,
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
});

const makeBeat = (id: string, overrides: Partial<WorkspaceBeatProjection> = {}): WorkspaceBeatProjection => ({
  id,
  title: `Beat ${id}`,
  action: `Action ${id}`,
  look: `Look ${id}`,
  actionRevision: 1,
  lineHistory: [],
  targetSeconds: 8,
  actualSeconds: 8,
  displayState: 'ready',
  shots: [makeShot(`${id}_shot`)],
  ...overrides,
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

  it('renders the seven prototype columns and one semantic data row per Beat in film order', () => {
    render(
      <TableView
        beats={[
          makeBeat('opening', { title: 'Opening', look: '', shots: [makeShot('shot_1'), makeShot('shot_2')] }),
          makeBeat('close', { title: 'Close' }),
        ]}
        selectedBeatId={null}
        onSelectBeat={vi.fn()}
      />
    );

    const grid = screen.getByRole('grid', { name: 'Beat table' });
    const rows = within(grid).getAllByRole('row');
    expect(
      within(rows[0]!)
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent)
    ).toEqual(['#', 'Beat', 'Action', 'Look', 'Shots', 'Length', 'State']);
    expect(
      within(rows[0]!)
        .getAllByRole('columnheader')
        .map((cell) => cell.dataset.gridColumnName)
    ).toEqual(['position', 'beat', 'action', 'look', 'shots', 'length', 'state']);
    expect(rows.slice(1).map((row) => cellAt(row, 1).textContent)).toEqual(['Opening', 'Close']);
    expect(rows.slice(1).every((row) => within(row).getAllByRole('gridcell').length === 7)).toBe(true);
    expect(rowForBeat('opening')).toHaveTextContent('2 shots');
    expect(rowForBeat('opening')).toHaveTextContent('No look written yet');
  });

  it('keeps an empty grid named and headed without inventing a data row', () => {
    render(<TableView beats={[]} selectedBeatId={null} onSelectBeat={vi.fn()} />);

    const grid = screen.getByRole('grid', { name: 'Beat table' });
    expect(within(grid).getAllByRole('row')).toHaveLength(1);
    expect(within(grid).queryAllByRole('gridcell')).toHaveLength(0);
    expect(screen.getByRole('status')).toHaveTextContent('No beats yet');
  });

  it('traverses all 24 Beat rows vertically with one clamped roving tab stop and no selection', async () => {
    const user = userEvent.setup();
    const onSelectBeat = vi.fn();
    render(
      <TableView
        beats={Array.from({ length: 24 }, (_, index) => makeBeat(`beat_${index + 1}`))}
        selectedBeatId={null}
        onSelectBeat={onSelectBeat}
      />
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
    expect(onSelectBeat).not.toHaveBeenCalled();
  });

  it('moves across columns and supports clamped row and grid Home/End navigation', async () => {
    const user = userEvent.setup();
    render(<TableView beats={[makeBeat('beat_1'), makeBeat('beat_2')]} selectedBeatId={null} onSelectBeat={vi.fn()} />);
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
    const onSelectBeat = vi.fn();
    render(
      <TableView
        beats={[
          makeBeat('multi', { shots: [makeShot('shot_1'), makeShot('shot_2')] }),
          makeBeat('empty', { shots: [] }),
        ]}
        selectedBeatId={null}
        onSelectBeat={onSelectBeat}
      />
    );
    const multi = rowForBeat('multi');
    const empty = rowForBeat('empty');
    fireEvent.click(multi);
    expect(onSelectBeat).toHaveBeenLastCalledWith('multi');

    act(() => cellAt(multi, 0).focus());
    await user.keyboard('{ArrowDown}{Enter}');
    expect(onSelectBeat).toHaveBeenLastCalledWith('empty');
    await user.keyboard('{Space}');
    expect(onSelectBeat).toHaveBeenLastCalledWith('empty');
    expect(onSelectBeat).toHaveBeenCalledTimes(3);
    expect(empty).toHaveAttribute('aria-selected', 'false');
  });

  it('keeps multi-shot and zero-shot Beat selection in the shared owner without changing paid Shot selection', () => {
    const beats = [
      makeBeat('multi', { shots: [makeShot('shot_1'), makeShot('shot_2')] }),
      makeBeat('empty', { shots: [], actualSeconds: null, displayState: 'no_coverage' }),
    ];
    window.sessionStorage.setItem(
      'aionui:creative-studio:v2:workspace-drafts:project_1',
      JSON.stringify({
        version: 2,
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
    render(
      <TableView
        beats={[makeBeat('equal', { targetSeconds: 9, actualSeconds: 9.52 })]}
        selectedBeatId={null}
        onSelectBeat={vi.fn()}
      />
    );
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
    render(
      <TableView
        beats={[
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
        ]}
        selectedBeatId={null}
        onSelectBeat={vi.fn()}
      />
    );
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
      ['seed_pending', 'Seed pending'],
      ['part_done', 'Part done'],
      ['rendering', 'Rendering'],
      ['stale', 'Stale'],
      ['status_pending', 'Status pending'],
      ['ready', 'Ready'],
      ['draft', 'Draft'],
    ];
    render(
      <TableView
        beats={states.map(([state]) => makeBeat(state, { displayState: state }))}
        selectedBeatId={null}
        onSelectBeat={vi.fn()}
      />
    );

    for (const [state, label] of states) {
      const stateCell = cellAt(rowForBeat(state), 6);
      expect(stateCell).toHaveTextContent(label);
      expect(stateCell.querySelector('[data-state]')).toHaveAttribute('data-state', state);
    }
  });
});

describe('the Look fold threshold', () => {
  it('folds the Look at 860px of column width and below', () => {
    // The designer's ruling: one threshold, one change. 780px is the Table's real target, so the
    // folded form is the common case rather than a degraded one.
    expect(tableFoldsLook(780)).toBe(true);
    expect(tableFoldsLook(860)).toBe(true);
  });

  it('keeps the Look a column above the threshold', () => {
    expect(tableFoldsLook(861)).toBe(false);
    expect(tableFoldsLook(1158)).toBe(false);
  });

  it('does not fold on an unmeasured width', () => {
    // Before the first measurement the width is zero. Folding on that would render the folded form
    // and then unfold it on almost every desktop window, which is a visible reflow on every mount.
    expect(tableFoldsLook(0)).toBe(false);
    expect(tableFoldsLook(Number.NaN)).toBe(false);
    expect(tableFoldsLook(-40)).toBe(false);
  });
});

describe('the Table layout contract', () => {
  it('keeps the 860px floor only on the unfolded grid and addresses columns semantically', () => {
    expect(tableCss).toMatch(/\.grid\s*{[^}]*min-inline-size:\s*860px/s);
    expect(tableCss).toMatch(/\.gridFolded\s*{[^}]*min-inline-size:\s*0/s);
    expect(tableCss).not.toContain('nth-child');
    const durationRule = tableCss.match(/\.durationFact\s*{([^}]*)}/s)?.[1] ?? '';
    expect(durationRule).not.toContain('overflow: hidden');
    expect(durationRule).not.toContain('text-overflow: ellipsis');
  });
});

describe('folding the Look at the Table target width', () => {
  let resizeCallback: ResizeObserverCallback | null = null;
  let measuredWidth = 0;

  class FoldResizeObserver implements ResizeObserver {
    constructor(callback: ResizeObserverCallback) {
      resizeCallback = callback;
    }
    disconnect = vi.fn();
    observe = vi.fn();
    unobserve = vi.fn();
  }

  const renderAtWidth = (width: number) => {
    measuredWidth = width;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      () =>
        ({
          bottom: 0,
          height: 200,
          left: 0,
          right: measuredWidth,
          toJSON: () => ({}),
          top: 0,
          width: measuredWidth,
          x: 0,
          y: 0,
        }) as DOMRect
    );
    vi.stubGlobal('ResizeObserver', FoldResizeObserver);
    render(<TableView beats={[makeBeat('beat_1')]} selectedBeatId={null} onSelectBeat={vi.fn()} />);
    act(() => {
      resizeCallback?.([{ contentRect: { width } } as ResizeObserverEntry], {} as ResizeObserver);
    });
  };

  const resizeToWidth = (width: number): void => {
    measuredWidth = width;
    act(() => {
      resizeCallback?.([{ contentRect: { width: width - 2 } } as ResizeObserverEntry], {} as ResizeObserver);
    });
  };

  beforeEach(() => {
    resizeCallback = null;
    vi.restoreAllMocks();
  });

  it('keeps the Look a column when the Table has room for one', () => {
    renderAtWidth(1158);

    const rows = within(screen.getByRole('grid', { name: 'Beat table' })).getAllByRole('row');
    expect(
      within(rows[0]!)
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent)
    ).toEqual(['#', 'Beat', 'Action', 'Look', 'Shots', 'Length', 'State']);
    expect(within(rows[1]!).getAllByRole('gridcell')).toHaveLength(7);
  });

  it('folds the Look into the Action cell at the 780px target', () => {
    renderAtWidth(780);

    const rows = within(screen.getByRole('grid', { name: 'Beat table' })).getAllByRole('row');
    expect(
      within(rows[0]!)
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent)
    ).toEqual(['#', 'Beat', 'Action · Look', 'Shots', 'Length', 'State']);
    expect(
      within(rows[0]!)
        .getAllByRole('columnheader')
        .map((cell) => cell.dataset.gridColumnName)
    ).toEqual(['position', 'beat', 'action', 'shots', 'length', 'state']);
    const grid = screen.getByRole('grid', { name: 'Beat table' });
    expect(grid).toHaveAttribute('data-look-folded', 'true');
    const fixedColumns = Array.from(grid.querySelectorAll<HTMLTableColElement>('col[data-fixed-inline-size]'));
    expect(fixedColumns.map((column) => column.dataset.gridColumnName)).toEqual([
      'position',
      'beat',
      'shots',
      'length',
      'state',
    ]);
    const fixedWidth = fixedColumns.reduce((total, column) => total + Number(column.dataset.fixedInlineSize), 0);
    expect(fixedWidth).toBe(406);
    expect(780 - fixedWidth).toBe(374);
    expect(document.querySelector('[data-studio-table-scroll]')).not.toBeNull();

    // The five fixed columns keep their places; only the Look leaves.
    const cells = within(rows[1]!).getAllByRole('gridcell');
    expect(cells).toHaveLength(6);
    // The Look now lives inside the Action cell rather than beside it, and is marked as folded.
    expect(cells[2]?.textContent).toContain('Action beat_1');
    expect(cells[2]?.textContent).toContain('Look beat_1');
    expect(cells[2]?.querySelector('[data-look-folded]')).not.toBeNull();
    // And it is not also still a column of its own.
    expect(within(rows[0]!).queryByText('Look')).toBeNull();
  });

  it('keeps the grid own column count honest when folded', () => {
    renderAtWidth(780);
    expect(screen.getByRole('grid', { name: 'Beat table' })).toHaveAttribute('aria-colcount', '6');
  });

  it('uses the same rendered border box for the initial and observer fold measurements', () => {
    renderAtWidth(861);
    const grid = screen.getByRole('grid', { name: 'Beat table' });

    act(() => {
      resizeCallback?.([{ contentRect: { width: 859 } } as ResizeObserverEntry], {} as ResizeObserver);
    });
    expect(grid).toHaveAttribute('data-look-folded', 'false');

    resizeToWidth(860);
    expect(grid).toHaveAttribute('data-look-folded', 'true');
  });

  it('keeps the focused State cell and roving tab stop stable when the Look folds away', () => {
    renderAtWidth(1158);
    const stateCell = rowForBeat('beat_1').querySelector<HTMLElement>('[data-grid-column-name="state"]');
    if (stateCell === null) throw new Error('Missing State cell before the Look fold');
    act(() => stateCell.focus());

    resizeToWidth(780);

    const foldedStateCell = rowForBeat('beat_1').querySelector<HTMLElement>('[data-grid-column-name="state"]');
    expect(foldedStateCell).toBe(stateCell);
    expect(foldedStateCell).toHaveFocus();
    expect(foldedStateCell).toHaveAttribute('tabindex', '0');
    expect(
      screen.getByRole('grid', { name: 'Beat table' }).querySelectorAll('[role="gridcell"][tabindex="0"]')
    ).toHaveLength(1);
  });

  it('moves focus from the removed Look cell to the folded Action cell', () => {
    renderAtWidth(1158);
    const lookCell = rowForBeat('beat_1').querySelector<HTMLElement>('[data-grid-column-name="look"]');
    if (lookCell === null) throw new Error('Missing Look cell before the fold');
    act(() => lookCell.focus());

    resizeToWidth(780);

    const actionCell = rowForBeat('beat_1').querySelector<HTMLElement>('[data-grid-column-name="action"]');
    expect(actionCell).toHaveFocus();
    expect(actionCell).toHaveAttribute('tabindex', '0');
  });
});
