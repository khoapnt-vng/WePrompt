/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { WorkspaceBeatProjection } from '../../workspaceProjection';
import { tableFoldsLook } from './lookFold';
import styles from './Table.module.css';

type TableColumnId = 'position' | 'beat' | 'action' | 'look' | 'shots' | 'length' | 'state';

type TableColumn = {
  id: TableColumnId;
  labelKey: string;
  fixedInlineSize?: number;
};

const COLUMNS = [
  {
    id: 'position',
    labelKey: 'conversation.creativeStudio.workspace.table.columns.position',
    fixedInlineSize: 46,
  },
  { id: 'beat', labelKey: 'conversation.creativeStudio.workspace.table.columns.beat', fixedInlineSize: 100 },
  { id: 'action', labelKey: 'conversation.creativeStudio.workspace.table.columns.action' },
  { id: 'look', labelKey: 'conversation.creativeStudio.workspace.table.columns.look' },
  { id: 'shots', labelKey: 'conversation.creativeStudio.workspace.table.columns.shots', fixedInlineSize: 68 },
  { id: 'length', labelKey: 'conversation.creativeStudio.workspace.table.columns.length', fixedInlineSize: 96 },
  { id: 'state', labelKey: 'conversation.creativeStudio.workspace.table.columns.state', fixedInlineSize: 96 },
] as const satisfies readonly TableColumn[];

/** The Look leaves the header and the Action heading names both. Nothing else moves. */
const FOLDED_COLUMNS = [
  {
    id: 'position',
    labelKey: 'conversation.creativeStudio.workspace.table.columns.position',
    fixedInlineSize: 46,
  },
  { id: 'beat', labelKey: 'conversation.creativeStudio.workspace.table.columns.beat', fixedInlineSize: 100 },
  { id: 'action', labelKey: 'conversation.creativeStudio.workspace.table.columns.actionLook' },
  { id: 'shots', labelKey: 'conversation.creativeStudio.workspace.table.columns.shots', fixedInlineSize: 68 },
  { id: 'length', labelKey: 'conversation.creativeStudio.workspace.table.columns.length', fixedInlineSize: 96 },
  { id: 'state', labelKey: 'conversation.creativeStudio.workspace.table.columns.state', fixedInlineSize: 96 },
] as const satisfies readonly TableColumn[];

const STATE_KEYS = {
  duration_pending: 'conversation.creativeStudio.workspace.table.state.durationPending',
  no_coverage: 'conversation.creativeStudio.workspace.table.state.noCoverage',
  seed_pending: 'conversation.creativeStudio.workspace.table.state.seedPending',
  part_done: 'conversation.creativeStudio.workspace.table.state.partDone',
  rendering: 'conversation.creativeStudio.workspace.table.state.rendering',
  stale: 'conversation.creativeStudio.workspace.table.state.stale',
  status_pending: 'conversation.creativeStudio.workspace.table.state.statusPending',
  ready: 'conversation.creativeStudio.workspace.table.state.ready',
  draft: 'conversation.creativeStudio.workspace.table.state.draft',
} as const satisfies Record<WorkspaceBeatProjection['displayState'], string>;

type FocusedCell = {
  row: number;
  column: TableColumnId;
};

export type TableViewProps = {
  beats: readonly WorkspaceBeatProjection[];
  selectedBeatId: string | null;
  onSelectBeat: (beatId: string) => void;
};

/** Beat-level workspace presentation. Selection is supplied by the shared draft owner. */
export const TableView: React.FC<TableViewProps> = ({ beats, selectedBeatId, onSelectBeat }) => {
  const { t } = useTranslation();
  const initialSelectedRow = beats.findIndex((beat) => beat.id === selectedBeatId);
  const [focusedCell, setFocusedCell] = useState<FocusedCell>({
    row: initialSelectedRow < 0 ? 0 : initialSelectedRow,
    column: 'position',
  });
  const cellRefs = useRef<Array<Partial<Record<TableColumnId, HTMLTableCellElement | null>>>>([]);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const pendingFoldFocusRowRef = useRef<number | null>(null);
  const [columnWidthPixels, setColumnWidthPixels] = useState(0);

  // Measured the way the coverage bar's density tiers are: off the rendered width, not the window's.
  useEffect(() => {
    const node = scrollRef.current;
    if (node === null) return;
    const commitWidth = (width: number): void => {
      if (!Number.isFinite(width) || width < 0) return;
      const activeElement = document.activeElement;
      if (
        tableFoldsLook(width) &&
        activeElement instanceof HTMLElement &&
        activeElement.dataset.gridColumnName === 'look' &&
        node.contains(activeElement)
      ) {
        const activeRow = Number(activeElement.dataset.gridRow);
        if (Number.isInteger(activeRow) && activeRow >= 0) pendingFoldFocusRowRef.current = activeRow;
      }
      setColumnWidthPixels(width);
    };
    commitWidth(node.getBoundingClientRect().width);
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      // Match the initial border-box measurement. Mixing it with contentRect moves the fold by the
      // scroll surface's two borders and makes the threshold depend on which callback ran last.
      commitWidth(node.getBoundingClientRect().width);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const foldsLook = tableFoldsLook(columnWidthPixels);
  const columns: readonly TableColumn[] = foldsLook ? FOLDED_COLUMNS : COLUMNS;
  const columnCount = columns.length;
  const focusedRow = Math.min(focusedCell.row, Math.max(0, beats.length - 1));
  const focusedColumn = columns.some((column) => column.id === focusedCell.column) ? focusedCell.column : 'action';

  useLayoutEffect(() => {
    if (!foldsLook) return;
    const pendingRow = pendingFoldFocusRowRef.current;
    if (pendingRow === null) return;
    pendingFoldFocusRowRef.current = null;
    cellRefs.current[pendingRow]?.action?.focus({ preventScroll: true });
  }, [foldsLook]);

  const focusCell = (row: number, column: number): void => {
    const next = {
      row: Math.max(0, Math.min(row, beats.length - 1)),
      column: Math.max(0, Math.min(column, columnCount - 1)),
    };
    const nextColumn = columns[next.column]?.id ?? 'position';
    setFocusedCell({ row: next.row, column: nextColumn });
    cellRefs.current[next.row]?.[nextColumn]?.focus();
  };

  const handleCellKeyDown = (
    event: React.KeyboardEvent<HTMLTableCellElement>,
    row: number,
    column: number,
    beatId: string
  ): void => {
    if (event.key === 'Enter' || event.key === ' ' || event.key === 'Space' || event.key === 'Spacebar') {
      event.preventDefault();
      onSelectBeat(beatId);
      return;
    }

    let nextRow = row;
    let nextColumn = column;
    if (event.key === 'ArrowUp') nextRow -= 1;
    else if (event.key === 'ArrowDown') nextRow += 1;
    else if (event.key === 'ArrowLeft') nextColumn -= 1;
    else if (event.key === 'ArrowRight') nextColumn += 1;
    else if (event.key === 'Home') {
      nextRow = event.ctrlKey || event.metaKey ? 0 : row;
      nextColumn = 0;
    } else if (event.key === 'End') {
      nextRow = event.ctrlKey || event.metaKey ? beats.length - 1 : row;
      nextColumn = columnCount - 1;
    } else return;

    event.preventDefault();
    focusCell(nextRow, nextColumn);
  };

  return (
    <section className={styles.root}>
      <div ref={scrollRef} className={styles.scroll} data-studio-table-scroll>
        <table
          aria-colcount={columnCount}
          aria-label={t('conversation.creativeStudio.workspace.table.label')}
          aria-rowcount={beats.length + 1}
          className={`${styles.grid} ${foldsLook ? styles.gridFolded : ''}`}
          data-look-folded={foldsLook}
          role='grid'
        >
          <colgroup>
            {columns.map((column) => (
              <col
                key={column.id}
                data-fixed-inline-size={column.fixedInlineSize}
                data-grid-column-name={column.id}
                style={
                  column.fixedInlineSize === undefined
                    ? undefined
                    : { inlineSize: `${String(column.fixedInlineSize)}px` }
                }
              />
            ))}
          </colgroup>
          <thead>
            <tr aria-rowindex={1} role='row'>
              {columns.map((columnDefinition, column) => (
                <th
                  key={columnDefinition.id}
                  aria-colindex={column + 1}
                  className={styles.headerCell}
                  data-grid-column-name={columnDefinition.id}
                  role='columnheader'
                  scope='col'
                >
                  {t(columnDefinition.labelKey)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {beats.map((beat, row) => {
              const selected = beat.id === selectedBeatId;
              const hasCoverage = beat.shots.length > 0;
              const durationKind = hasCoverage ? 'actual' : 'target';
              const durationSeconds = hasCoverage ? beat.actualSeconds : beat.targetSeconds;
              const duration =
                durationSeconds === null
                  ? t(
                      hasCoverage
                        ? 'conversation.creativeStudio.workspace.table.actualPending'
                        : 'conversation.creativeStudio.workspace.table.targetPending'
                    )
                  : t(
                      hasCoverage
                        ? 'conversation.creativeStudio.workspace.table.actualDuration'
                        : 'conversation.creativeStudio.workspace.table.targetDuration',
                      { seconds: durationSeconds }
                    );
              const cells: Array<{ column: TableColumnId; content: React.ReactNode }> = [
                {
                  column: 'position',
                  content: (
                    <span className={styles.position}>
                      <bdi>{String(row + 1).padStart(2, '0')}</bdi>
                    </span>
                  ),
                },
                {
                  column: 'beat',
                  content: (
                    <span className={styles.beatTitle} dir='auto'>
                      {beat.title || beat.id}
                    </span>
                  ),
                },
                {
                  column: 'action',
                  content: (
                    <span className={foldsLook ? styles.actionFolded : undefined} dir='auto'>
                      <span className={foldsLook ? styles.actionLine : undefined}>{beat.action}</span>
                      {foldsLook ? (
                        <span
                          className={`${styles.lookLine} ${beat.look.length === 0 ? styles.lookMissing : ''}`}
                          data-look-folded
                          dir='auto'
                        >
                          {beat.look || t('conversation.creativeStudio.workspace.table.lookMissing')}
                        </span>
                      ) : null}
                    </span>
                  ),
                },
                ...(foldsLook
                  ? []
                  : [
                      {
                        column: 'look' as const,
                        content: (
                          <span className={beat.look.length === 0 ? styles.lookMissing : undefined} dir='auto'>
                            {beat.look || t('conversation.creativeStudio.workspace.table.lookMissing')}
                          </span>
                        ),
                      },
                    ]),
                {
                  column: 'shots',
                  content: (
                    <span className={styles.shotCount}>
                      <bdi>
                        {t('conversation.creativeStudio.workspace.table.shotCount', { count: beat.shots.length })}
                      </bdi>
                    </span>
                  ),
                },
                {
                  column: 'length',
                  content: (
                    <span className={styles.durationFact}>
                      <span
                        className={`${durationKind === 'actual' ? styles.actualDuration : styles.targetDuration} ${durationSeconds === null ? styles.pendingDuration : ''}`}
                        data-duration-kind={durationKind}
                      >
                        <bdi>{duration}</bdi>
                      </span>
                    </span>
                  ),
                },
                {
                  column: 'state',
                  content: (
                    <span className={styles.state} data-state={beat.displayState}>
                      <span aria-hidden='true' className={styles.stateDot} />
                      <span>{t(STATE_KEYS[beat.displayState])}</span>
                    </span>
                  ),
                },
              ];

              return (
                <tr
                  key={beat.id}
                  aria-rowindex={row + 2}
                  aria-selected={selected}
                  className={styles.row}
                  data-beat-id={beat.id}
                  onClick={() => onSelectBeat(beat.id)}
                  role='row'
                >
                  {cells.map(({ column: columnId, content }, column) => (
                    <td
                      key={columnId}
                      ref={(node) => {
                        cellRefs.current[row] ??= {};
                        cellRefs.current[row]![columnId] = node;
                      }}
                      aria-colindex={column + 1}
                      className={styles.cell}
                      data-grid-column={column}
                      data-grid-column-name={columnId}
                      data-grid-row={row}
                      onFocus={() => setFocusedCell({ row, column: columnId })}
                      onKeyDown={(event) => handleCellKeyDown(event, row, column, beat.id)}
                      role='gridcell'
                      tabIndex={row === focusedRow && columnId === focusedColumn ? 0 : -1}
                    >
                      {content}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {beats.length === 0 ? (
        <p className={styles.empty} role='status'>
          {t('conversation.creativeStudio.workspace.table.empty')}
        </p>
      ) : null}
    </section>
  );
};
