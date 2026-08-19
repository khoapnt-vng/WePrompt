import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React, { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  WorkspaceBeatProjection,
  WorkspaceShotProjection,
} from '@/renderer/pages/studio/components/Workspace/workspaceProjection';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => {
      const copy: Record<string, string> = {
        'conversation.creativeStudio.workspace.table.label': 'Beat table',
        'conversation.creativeStudio.workspace.table.columns.position': '#',
        'conversation.creativeStudio.workspace.table.columns.beat': 'Beat',
        'conversation.creativeStudio.workspace.table.columns.action': 'Action',
        'conversation.creativeStudio.workspace.table.columns.look': 'Look',
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
        return `${String(values?.seconds)}s actual`;
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
  coverAssetId: null,
  takeCount: 0,
  displayState: 'draft',
  retainedWork: false,
  videoGenerationInFlight: false,
  seedGenerationInFlight: false,
  hasEffectiveSeed: false,
});

const makeBeat = (id: string, overrides: Partial<WorkspaceBeatProjection> = {}): WorkspaceBeatProjection => ({
  id,
  title: `Beat ${id}`,
  action: `Action ${id}`,
  look: `Look ${id}`,
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

  it('renders equal target and actual numbers as separately styled intent and fact', () => {
    render(
      <TableView
        beats={[makeBeat('equal', { targetSeconds: 9, actualSeconds: 9 })]}
        selectedBeatId={null}
        onSelectBeat={vi.fn()}
      />
    );
    const length = cellAt(rowForBeat('equal'), 5);
    const actual = length.querySelector<HTMLElement>('[data-duration-kind="actual"]');
    const target = length.querySelector<HTMLElement>('[data-duration-kind="target"]');
    if (actual === null || target === null) throw new Error('Missing separate actual and target duration facts');
    expect(actual).toHaveAttribute('data-duration-kind', 'actual');
    expect(target).toHaveAttribute('data-duration-kind', 'target');
    expect(actual).toHaveTextContent('9s actual');
    expect(target).toHaveTextContent('~9s target');
    expect(actual.className).not.toBe(target.className);
  });

  it('preserves missing target and actual facts as pending text and never zero seconds', () => {
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
          makeBeat('covered', { targetSeconds: null, actualSeconds: 8 }),
        ]}
        selectedBeatId={null}
        onSelectBeat={vi.fn()}
      />
    );
    const pending = cellAt(rowForBeat('duration_pending'), 5);
    const uncovered = cellAt(rowForBeat('no_coverage'), 5);
    const covered = cellAt(rowForBeat('covered'), 5);

    expect(pending).toHaveTextContent('No actual');
    expect(pending).toHaveTextContent('No target');
    expect(pending).not.toHaveTextContent('0s');
    expect(uncovered).toHaveTextContent('No actual');
    expect(uncovered).toHaveTextContent('~7s target');
    expect(covered).toHaveTextContent('8s actual');
    expect(covered).toHaveTextContent('No target');
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
