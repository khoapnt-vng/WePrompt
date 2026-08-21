/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { WorkspaceBeatProjection } from '../../workspaceProjection';
import { tableFoldsLook } from './lookFold';
import styles from './Table.module.css';

const COLUMN_KEYS = [
  'conversation.creativeStudio.workspace.table.columns.position',
  'conversation.creativeStudio.workspace.table.columns.beat',
  'conversation.creativeStudio.workspace.table.columns.action',
  'conversation.creativeStudio.workspace.table.columns.look',
  'conversation.creativeStudio.workspace.table.columns.shots',
  'conversation.creativeStudio.workspace.table.columns.length',
  'conversation.creativeStudio.workspace.table.columns.state',
] as const;

/** The Look leaves the header and the Action heading names both. Nothing else moves. */
const FOLDED_COLUMN_KEYS = [
  'conversation.creativeStudio.workspace.table.columns.position',
  'conversation.creativeStudio.workspace.table.columns.beat',
  'conversation.creativeStudio.workspace.table.columns.actionLook',
  'conversation.creativeStudio.workspace.table.columns.shots',
  'conversation.creativeStudio.workspace.table.columns.length',
  'conversation.creativeStudio.workspace.table.columns.state',
] as const;

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
  column: number;
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
    column: 0,
  });
  const cellRefs = useRef<Array<Array<HTMLTableCellElement | null>>>([]);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [columnWidthPixels, setColumnWidthPixels] = useState(0);

  // Measured the way the coverage bar's density tiers are: off the rendered width, not the window's.
  useEffect(() => {
    const node = scrollRef.current;
    if (node === null) return;
    const measure = (): void => {
      const width = node.getBoundingClientRect().width;
      if (Number.isFinite(width) && width >= 0) setColumnWidthPixels(width);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (typeof width === 'number' && Number.isFinite(width) && width >= 0) setColumnWidthPixels(width);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const foldsLook = tableFoldsLook(columnWidthPixels);
  const columnKeys: readonly string[] = foldsLook ? FOLDED_COLUMN_KEYS : COLUMN_KEYS;
  const columnCount = columnKeys.length;
  const focusedRow = Math.min(focusedCell.row, Math.max(0, beats.length - 1));
  const focusedColumn = Math.min(focusedCell.column, columnCount - 1);

  const focusCell = (row: number, column: number): void => {
    const next = {
      row: Math.max(0, Math.min(row, beats.length - 1)),
      column: Math.max(0, Math.min(column, columnCount - 1)),
    };
    setFocusedCell(next);
    cellRefs.current[next.row]?.[next.column]?.focus();
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
      <div ref={scrollRef} className={styles.scroll}>
        <table
          aria-colcount={columnCount}
          aria-label={t('conversation.creativeStudio.workspace.table.label')}
          aria-rowcount={beats.length + 1}
          className={styles.grid}
          role='grid'
        >
          <thead>
            <tr aria-rowindex={1} role='row'>
              {columnKeys.map((key, column) => (
                <th key={key} aria-colindex={column + 1} className={styles.headerCell} role='columnheader' scope='col'>
                  {t(key)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {beats.map((beat, row) => {
              const selected = beat.id === selectedBeatId;
              const actualDuration =
                beat.actualSeconds === null
                  ? t('conversation.creativeStudio.workspace.table.actualPending')
                  : t('conversation.creativeStudio.workspace.table.actualDuration', { seconds: beat.actualSeconds });
              const targetDuration =
                beat.targetSeconds === null
                  ? t('conversation.creativeStudio.workspace.table.targetPending')
                  : t('conversation.creativeStudio.workspace.table.targetDuration', { seconds: beat.targetSeconds });
              const cells: React.ReactNode[] = [
                <span key='position' className={styles.position}>
                  <bdi>{String(row + 1).padStart(2, '0')}</bdi>
                </span>,
                <span key='beat' className={styles.beatTitle} dir='auto'>
                  {beat.title || beat.id}
                </span>,
                <span key='action' className={foldsLook ? styles.actionFolded : undefined} dir='auto'>
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
                </span>,
                ...(foldsLook
                  ? []
                  : [
                      <span key='look' className={beat.look.length === 0 ? styles.lookMissing : undefined} dir='auto'>
                        {beat.look || t('conversation.creativeStudio.workspace.table.lookMissing')}
                      </span>,
                    ]),
                <span key='shots' className={styles.shotCount}>
                  <bdi>{t('conversation.creativeStudio.workspace.table.shotCount', { count: beat.shots.length })}</bdi>
                </span>,
                <span key='length' className={styles.durationFacts}>
                  <span
                    className={`${styles.actualDuration} ${beat.actualSeconds === null ? styles.pendingDuration : ''}`}
                    data-duration-kind='actual'
                  >
                    <bdi>{actualDuration}</bdi>
                  </span>
                  <span
                    className={`${styles.targetDuration} ${beat.targetSeconds === null ? styles.pendingDuration : ''}`}
                    data-duration-kind='target'
                  >
                    <bdi>{targetDuration}</bdi>
                  </span>
                </span>,
                <span key='state' className={styles.state} data-state={beat.displayState}>
                  <span aria-hidden='true' className={styles.stateDot} />
                  <span>{t(STATE_KEYS[beat.displayState])}</span>
                </span>,
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
                  {cells.map((content, column) => (
                    <td
                      key={column}
                      ref={(node) => {
                        cellRefs.current[row] ??= [];
                        cellRefs.current[row]![column] = node;
                      }}
                      aria-colindex={column + 1}
                      className={styles.cell}
                      data-grid-column={column}
                      data-grid-row={row}
                      onFocus={() => setFocusedCell({ row, column })}
                      onKeyDown={(event) => handleCellKeyDown(event, row, column, beat.id)}
                      role='gridcell'
                      tabIndex={row === focusedRow && column === focusedColumn ? 0 : -1}
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
