/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Popconfirm } from '@arco-design/web-react';
import React, { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  STUDIO_MAX_GENERATION_SHOTS_PER_REQUEST,
  type StudioBoardStyleV2,
} from '@/common/types/project/creativeStudioTypes';
import { FullscreenMediaFrame } from '@/renderer/pages/studio/components/FullscreenMediaFrame';
import { createManagedStudioAssetUrl } from '@/renderer/pages/studio/studioManagedAssetUrl';

import type { WorkspaceBeatProjection, WorkspaceBoardPanelProjection } from '../../workspaceProjection';
import styles from './Table.module.css';

type TableColumnId = 'position' | 'panel' | 'beat' | 'story' | 'shots' | 'length' | 'state';

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
  { id: 'panel', labelKey: 'conversation.creativeStudio.workspace.table.columns.panel', fixedInlineSize: 176 },
  { id: 'beat', labelKey: 'conversation.creativeStudio.workspace.table.columns.beat', fixedInlineSize: 100 },
  { id: 'story', labelKey: 'conversation.creativeStudio.workspace.table.columns.story' },
  { id: 'shots', labelKey: 'conversation.creativeStudio.workspace.table.columns.shots', fixedInlineSize: 68 },
  { id: 'length', labelKey: 'conversation.creativeStudio.workspace.table.columns.length', fixedInlineSize: 96 },
  { id: 'state', labelKey: 'conversation.creativeStudio.workspace.table.columns.state', fixedInlineSize: 96 },
] as const satisfies readonly TableColumn[];

const STATE_KEYS = {
  duration_pending: 'conversation.creativeStudio.workspace.table.state.durationPending',
  no_coverage: 'conversation.creativeStudio.workspace.table.state.noCoverage',
  seed_pending: 'conversation.creativeStudio.workspace.table.state.seedPending',
  part_done: 'conversation.creativeStudio.workspace.table.state.partDone',
  needs_attention: 'conversation.creativeStudio.workspace.table.state.needsAttention',
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

const PANEL_STATUS_KEYS = {
  missing: 'conversation.creativeStudio.workspace.table.panel.status.missing',
  current: 'conversation.creativeStudio.workspace.table.panel.status.current',
  stale: 'conversation.creativeStudio.workspace.table.panel.status.stale',
  status_pending: 'conversation.creativeStudio.workspace.table.panel.status.statusPending',
  queued: 'conversation.creativeStudio.workspace.table.panel.status.queued',
  drawing: 'conversation.creativeStudio.workspace.table.panel.status.drawing',
  needs_attention: 'conversation.creativeStudio.workspace.table.panel.status.needsAttention',
  failed: 'conversation.creativeStudio.workspace.table.panel.status.failed',
  cancelled: 'conversation.creativeStudio.workspace.table.panel.status.cancelled',
} as const;

const DRAWABLE_BOARD_ACTIVITIES = new Set<WorkspaceBoardPanelProjection['activity']>(['idle', 'failed', 'cancelled']);
const BUSY_BOARD_ACTIVITIES = new Set<WorkspaceBoardPanelProjection['activity']>(['queued', 'drawing']);

const isDrawableBoardPanel = (panel: WorkspaceBoardPanelProjection): boolean =>
  DRAWABLE_BOARD_ACTIVITIES.has(panel.activity) &&
  panel.freshness !== 'status_pending' &&
  panel.activity !== 'status_pending' &&
  panel.recovery?.canRetryDownload !== true;

const isPromotableBoardPanel = (
  panel: WorkspaceBoardPanelProjection
): panel is WorkspaceBoardPanelProjection & {
  assetId: string;
} => panel.assetId !== null && panel.freshness === 'current' && isDrawableBoardPanel(panel);

const panelStatusKey = (panel: WorkspaceBoardPanelProjection): string =>
  panel.activity === 'idle' ? PANEL_STATUS_KEYS[panel.freshness] : PANEL_STATUS_KEYS[panel.activity];

const statusPendingPanel = (shotId: string): WorkspaceBoardPanelProjection => ({
  shotId,
  assetId: null,
  producerJobId: null,
  latestJobId: null,
  staleCauses: [],
  freshness: 'status_pending',
  activity: 'status_pending',
  recovery: null,
});

const exactFilmOrderBoardPanels = (
  beats: readonly WorkspaceBeatProjection[],
  panels: readonly WorkspaceBoardPanelProjection[]
): WorkspaceBoardPanelProjection[] => {
  const shotIds = beats.flatMap((beat) => beat.shots.map((shot) => shot.id));
  if (
    panels.length !== shotIds.length ||
    panels.some((panel, index) => panel?.shotId !== shotIds[index]) ||
    new Set(shotIds).size !== shotIds.length
  ) {
    return shotIds.map(statusPendingPanel);
  }
  return panels.map((panel) => ({ ...panel, staleCauses: [...panel.staleCauses] }));
};

type BoardPanelArtworkProps = {
  panel: WorkspaceBoardPanelProjection;
  projectId: string;
};

const BoardPanelArtwork: React.FC<BoardPanelArtworkProps> = ({ panel, projectId }) => {
  const assetUrl = panel.assetId === null ? null : createManagedStudioAssetUrl(projectId, panel.assetId);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const showImage = assetUrl !== null && failedUrl !== assetUrl;

  useEffect(() => setFailedUrl(null), [assetUrl]);

  return (
    <span
      aria-hidden='true'
      className={styles.panelArtwork}
      data-activity={panel.activity}
      data-asset-id={panel.assetId ?? undefined}
      data-freshness={panel.freshness}
    >
      {showImage ? <img alt='' loading='lazy' onError={() => setFailedUrl(assetUrl)} src={assetUrl} /> : null}
      <span className={styles.panelActivityMark} />
    </span>
  );
};

type BoardPanelRecoveryControlsProps = {
  actions: TableBoardActions;
  describedBy: string;
  disabled: boolean;
  panel: WorkspaceBoardPanelProjection;
};

const BoardPanelRecoveryControls: React.FC<BoardPanelRecoveryControlsProps> = ({
  actions,
  describedBy,
  disabled,
  panel,
}) => {
  const { t } = useTranslation();
  const recovery = panel.recovery;
  if (recovery === null) return null;
  return (
    <div className={styles.panelRecovery} data-board-recovery-job-id={recovery.jobId}>
      {recovery.canRetryDownload ? (
        <Button
          aria-describedby={describedBy}
          disabled={disabled}
          onClick={() => {
            if (!disabled) actions.retryDownload(recovery.jobId);
          }}
          size='mini'
        >
          {t('conversation.creativeStudio.jobs.retryDownload')}
        </Button>
      ) : null}
      {recovery.canRetry && recovery.submissionUnknown ? (
        <Popconfirm
          cancelText={t('conversation.creativeStudio.workspace.beatPanel.common.cancel')}
          content={t('conversation.creativeStudio.jobs.retryChargeBody')}
          disabled={disabled}
          okText={t('conversation.creativeStudio.jobs.retryChargeConfirm')}
          onOk={() => {
            if (!disabled) actions.retryJob(recovery.jobId, true);
          }}
          title={t('conversation.creativeStudio.jobs.retryChargeTitle')}
        >
          <Button aria-describedby={describedBy} disabled={disabled} size='mini'>
            {t('conversation.creativeStudio.jobs.retry')}
          </Button>
        </Popconfirm>
      ) : recovery.canRetry ? (
        <Button
          aria-describedby={describedBy}
          disabled={disabled}
          onClick={() => {
            if (!disabled) actions.retryJob(recovery.jobId, false);
          }}
          size='mini'
        >
          {t('conversation.creativeStudio.jobs.retry')}
        </Button>
      ) : null}
      {recovery.canCancel ? (
        <Button
          aria-describedby={describedBy}
          disabled={disabled}
          onClick={() => {
            if (!disabled) actions.cancelJob(recovery.jobId);
          }}
          size='mini'
        >
          {t('conversation.creativeStudio.jobs.cancel')}
        </Button>
      ) : null}
    </div>
  );
};

/** Action-owner contract for Table controls; spend and persistence policy remain upstream. */
export type TableBoardActions = {
  setStyle: (style: StudioBoardStyleV2) => void;
  drawNext: () => void;
  drawBeat: (beatId: string) => void;
  redrawShot: (shotId: string) => void;
  redrawBeat: (beatId: string) => void;
  promotePanel: (shotId: string, boardAssetId: string) => void;
  stop: () => void;
  retryJob: (jobId: string, acknowledgePossibleDuplicateCharge: boolean) => void;
  retryDownload: (jobId: string) => void;
  cancelJob: (jobId: string) => void;
};

export type TableViewProps = {
  actions: TableBoardActions;
  projectId: string;
  beats: readonly WorkspaceBeatProjection[];
  boardStyle: StudioBoardStyleV2 | null;
  boardPanels: readonly WorkspaceBoardPanelProjection[];
  imageRouteReady: boolean;
  pending: boolean;
  gateLocked: boolean;
  selectedBeatId: string | null;
  onOpenBeat: (beatId: string) => void;
  onSelectBeat: (beatId: string) => void;
};

/** Beat-level workspace presentation. Selection is supplied by the shared draft owner. */
export const TableView: React.FC<TableViewProps> = ({
  actions,
  projectId,
  beats,
  boardStyle,
  boardPanels,
  imageRouteReady,
  pending,
  gateLocked,
  selectedBeatId,
  onOpenBeat,
  onSelectBeat,
}) => {
  const { t } = useTranslation();
  const initialSelectedRow = beats.findIndex((beat) => beat.id === selectedBeatId);
  const [focusedCell, setFocusedCell] = useState<FocusedCell>({
    row: initialSelectedRow < 0 ? 0 : initialSelectedRow,
    column: 'position',
  });
  const cellRefs = useRef<Array<Partial<Record<TableColumnId, HTMLTableCellElement | null>>>>([]);
  const panelButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const pendingPanelButtonFocusRef = useRef<string | null>(null);
  const [openBoardBeatId, setOpenBoardBeatId] = useState<string | null>(null);
  const detailIdBase = useId();
  const exactBoardPanels = useMemo(() => exactFilmOrderBoardPanels(beats, boardPanels), [beats, boardPanels]);
  const panelByShotId = useMemo(
    () => new Map(exactBoardPanels.map((panel) => [panel.shotId, panel] as const)),
    [exactBoardPanels]
  );
  const boardSummary = useMemo(() => {
    const drawn = exactBoardPanels.filter((panel) => panel.assetId !== null).length;
    const stale = exactBoardPanels.filter((panel) => panel.freshness === 'stale').length;
    const busy = exactBoardPanels.filter((panel) => BUSY_BOARD_ACTIVITIES.has(panel.activity)).length;
    const needsAttention = exactBoardPanels.some((panel) => panel.activity === 'needs_attention');
    const statusPending = exactBoardPanels.some(
      (panel) => panel.freshness === 'status_pending' || panel.activity === 'status_pending'
    );
    const drawableMissing = exactBoardPanels.filter(
      (panel) => panel.freshness === 'missing' && isDrawableBoardPanel(panel)
    ).length;
    return {
      drawn,
      stale,
      busy,
      needsAttention,
      statusPending,
      drawableMissing,
      nextBatch: Math.min(STUDIO_MAX_GENERATION_SHOTS_PER_REQUEST, drawableMissing),
      total: exactBoardPanels.length,
    };
  }, [exactBoardPanels]);
  const interactionLocked = pending || gateLocked;
  const generationLocked = interactionLocked || boardStyle === null || boardSummary.statusPending || !imageRouteReady;
  const canDrawNext = !generationLocked && boardSummary.nextBatch > 0;
  const canStop = !interactionLocked && boardSummary.busy > 0;

  const columns: readonly TableColumn[] = COLUMNS;
  const columnCount = columns.length;
  const focusedRow = Math.min(focusedCell.row, Math.max(0, beats.length - 1));
  const focusedColumn = columns.some((column) => column.id === focusedCell.column) ? focusedCell.column : 'story';
  const openBoardBeatIndex = beats.findIndex((beat) => beat.id === openBoardBeatId && beat.shots.length > 0);

  useEffect(() => {
    if (openBoardBeatId !== null && !beats.some((beat) => beat.id === openBoardBeatId && beat.shots.length > 0)) {
      setOpenBoardBeatId(null);
    }
  }, [beats, openBoardBeatId]);

  useLayoutEffect(() => {
    if (openBoardBeatId !== null) return;
    const beatId = pendingPanelButtonFocusRef.current;
    if (beatId === null) return;
    pendingPanelButtonFocusRef.current = null;
    panelButtonRefs.current.get(beatId)?.focus({ preventScroll: true });
  }, [openBoardBeatId]);

  const focusCell = (row: number, column: number): void => {
    const next = {
      row: Math.max(0, Math.min(row, beats.length - 1)),
      column: Math.max(0, Math.min(column, columnCount - 1)),
    };
    const nextColumn = columns[next.column]?.id ?? 'position';
    setFocusedCell({ row: next.row, column: nextColumn });
    cellRefs.current[next.row]?.[nextColumn]?.focus();
  };

  const detailId = (row: number): string => `${detailIdBase}-board-detail-${String(row)}`;

  const closeBoardDetails = (beatId: string): void => {
    if (openBoardBeatId !== beatId) return;
    pendingPanelButtonFocusRef.current = beatId;
    setOpenBoardBeatId(null);
  };

  const toggleBoardDetails = (beat: WorkspaceBeatProjection): void => {
    if (beat.shots.length === 0) return;
    onSelectBeat(beat.id);
    setOpenBoardBeatId((current) => (current === beat.id ? null : beat.id));
  };

  const handleCellKeyDown = (
    event: React.KeyboardEvent<HTMLTableCellElement>,
    row: number,
    column: number,
    beat: WorkspaceBeatProjection
  ): void => {
    if (event.key === 'Escape' && columns[column]?.id === 'panel') {
      event.preventDefault();
      closeBoardDetails(beat.id);
      return;
    }
    if (event.key === 'Enter' || event.key === ' ' || event.key === 'Space' || event.key === 'Spacebar') {
      event.preventDefault();
      if (columns[column]?.id === 'panel') toggleBoardDetails(beat);
      else onOpenBeat(beat.id);
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
      <section
        aria-label={t('conversation.creativeStudio.workspace.table.board.label')}
        className={styles.boardStrip}
        role='region'
      >
        <div className={styles.boardProgressBlock}>
          <strong className={styles.boardProgressText}>
            {t('conversation.creativeStudio.workspace.table.board.progress', {
              drawn: boardSummary.drawn,
              total: boardSummary.total,
            })}
          </strong>
          <progress
            aria-label={t('conversation.creativeStudio.workspace.table.board.progressLabel')}
            className={styles.boardProgress}
            max={Math.max(1, boardSummary.total)}
            value={boardSummary.drawn}
          />
          <span className={styles.boardProgressFacts}>
            <span>
              {t('conversation.creativeStudio.workspace.table.board.staleCount', { count: boardSummary.stale })}
            </span>
            <span>
              {t('conversation.creativeStudio.workspace.table.board.busyCount', { count: boardSummary.busy })}
            </span>
          </span>
        </div>
        <div className={styles.boardPrimaryAction}>
          {boardSummary.busy > 0 ? (
            <>
              <Button
                disabled={!canStop}
                onClick={() => {
                  if (canStop) actions.stop();
                }}
                status='danger'
              >
                {t('conversation.creativeStudio.workspace.table.board.stop')}
              </Button>
              <p>{t('conversation.creativeStudio.workspace.table.board.stopNote')}</p>
            </>
          ) : (
            <Button
              disabled={!canDrawNext}
              onClick={() => {
                if (canDrawNext) actions.drawNext();
              }}
              type='primary'
            >
              {t('conversation.creativeStudio.workspace.table.board.drawNext', {
                count: boardSummary.nextBatch,
              })}
            </Button>
          )}
        </div>
      </section>
      <div ref={scrollRef} className={styles.scroll} data-studio-table-scroll>
        <table
          aria-colcount={columnCount}
          aria-label={t('conversation.creativeStudio.workspace.table.label')}
          aria-rowcount={beats.length + 1 + (openBoardBeatIndex < 0 ? 0 : 1)}
          className={styles.grid}
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
              const boardDetailsOpen = openBoardBeatId === beat.id && hasCoverage;
              const boardPanelsForBeat = beat.shots.map(
                (shot) => panelByShotId.get(shot.id) ?? statusPendingPanel(shot.id)
              );
              const drawableMissingCount = boardPanelsForBeat.filter(
                (panel) => panel.freshness === 'missing' && isDrawableBoardPanel(panel)
              ).length;
              const canDrawMissing =
                !generationLocked &&
                drawableMissingCount > 0 &&
                drawableMissingCount <= STUDIO_MAX_GENERATION_SHOTS_PER_REQUEST;
              const canOfferRedrawBeat =
                boardPanelsForBeat.length > 0 &&
                boardPanelsForBeat.length <= STUDIO_MAX_GENERATION_SHOTS_PER_REQUEST &&
                boardPanelsForBeat.every((panel) => panel.assetId !== null && isDrawableBoardPanel(panel));
              const leadPanel = boardPanelsForBeat[0] ?? null;
              const beatAriaRowIndex = row + 2 + (openBoardBeatIndex >= 0 && row > openBoardBeatIndex ? 1 : 0);
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
                  column: 'panel',
                  content: (
                    <Button
                      ref={(node) => {
                        if (node instanceof HTMLButtonElement) panelButtonRefs.current.set(beat.id, node);
                        else panelButtonRefs.current.delete(beat.id);
                      }}
                      {...(hasCoverage ? { 'aria-controls': detailId(row), 'aria-expanded': boardDetailsOpen } : {})}
                      aria-label={t(
                        boardDetailsOpen
                          ? 'conversation.creativeStudio.workspace.table.panel.closeDetails'
                          : 'conversation.creativeStudio.workspace.table.panel.openDetails',
                        { title: beat.title || beat.id }
                      )}
                      className={styles.panelThumbButton}
                      disabled={!hasCoverage}
                      onClick={(event) => {
                        event.stopPropagation();
                        toggleBoardDetails(beat);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Escape') {
                          event.preventDefault();
                          event.stopPropagation();
                          closeBoardDetails(beat.id);
                          return;
                        }
                        if (
                          event.key === 'Enter' ||
                          event.key === ' ' ||
                          event.key === 'Space' ||
                          event.key === 'Spacebar'
                        ) {
                          event.stopPropagation();
                        }
                      }}
                      tabIndex={-1}
                      type='text'
                    >
                      {leadPanel === null ? (
                        <span aria-hidden='true' className={styles.panelArtwork} data-freshness='missing' />
                      ) : (
                        <BoardPanelArtwork panel={leadPanel} projectId={projectId} />
                      )}
                      {beat.shots.length > 1 && !boardDetailsOpen ? (
                        <bdi className={styles.panelMore}>+{String(beat.shots.length - 1)}</bdi>
                      ) : null}
                    </Button>
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
                  column: 'story',
                  content: <span dir='auto'>{beat.story}</span>,
                },
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
                <React.Fragment key={beat.id}>
                  <tr
                    aria-rowindex={beatAriaRowIndex}
                    aria-selected={selected}
                    className={styles.row}
                    data-beat-id={beat.id}
                    data-board-details-open={boardDetailsOpen}
                    onClick={() => onOpenBeat(beat.id)}
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
                        onKeyDown={(event) => handleCellKeyDown(event, row, column, beat)}
                        role='gridcell'
                        tabIndex={row === focusedRow && columnId === focusedColumn ? 0 : -1}
                      >
                        {content}
                      </td>
                    ))}
                  </tr>
                  {boardDetailsOpen ? (
                    <tr
                      aria-rowindex={beatAriaRowIndex + 1}
                      className={styles.detailRow}
                      data-board-detail-for={beat.id}
                      role='row'
                    >
                      <td
                        aria-colindex={1}
                        aria-colspan={columnCount}
                        className={styles.detailCell}
                        colSpan={columnCount}
                        role='gridcell'
                      >
                        <section
                          aria-label={t('conversation.creativeStudio.workspace.table.panel.detailLabel', {
                            title: beat.title || beat.id,
                          })}
                          className={styles.detail}
                          id={detailId(row)}
                          onClick={(event) => event.stopPropagation()}
                          onKeyDown={(event) => {
                            if (event.key !== 'Escape') return;
                            event.preventDefault();
                            event.stopPropagation();
                            closeBoardDetails(beat.id);
                          }}
                          tabIndex={-1}
                        >
                          <div className={styles.detailActions}>
                            {drawableMissingCount > 0 ? (
                              <Button
                                disabled={!canDrawMissing}
                                onClick={() => {
                                  if (canDrawMissing) actions.drawBeat(beat.id);
                                }}
                                size='small'
                                type='primary'
                              >
                                {t('conversation.creativeStudio.workspace.table.panel.drawMissing', {
                                  count: drawableMissingCount,
                                })}
                              </Button>
                            ) : null}
                            {canOfferRedrawBeat ? (
                              <Button
                                disabled={generationLocked}
                                onClick={() => {
                                  if (!generationLocked) actions.redrawBeat(beat.id);
                                }}
                                size='small'
                              >
                                {t('conversation.creativeStudio.workspace.table.panel.redrawBeat')}
                              </Button>
                            ) : null}
                          </div>
                          <ol className={styles.detailPanels}>
                            {beat.shots.map((shot, shotIndex) => {
                              const panel = boardPanelsForBeat[shotIndex] ?? statusPendingPanel(shot.id);
                              const status = t(panelStatusKey(panel));
                              const panelStatusId = `${detailId(row)}-shot-${String(shotIndex)}-status`;
                              return (
                                <li key={shot.id} className={styles.panelCardItem}>
                                  <article
                                    aria-label={t('conversation.creativeStudio.workspace.table.panel.cardLabel', {
                                      position: shotIndex + 1,
                                      status,
                                    })}
                                    className={styles.panelCard}
                                    data-shot-id={shot.id}
                                  >
                                    <FullscreenMediaFrame
                                      className={styles.panelFrame}
                                      enabled={panel.assetId !== null}
                                    >
                                      <BoardPanelArtwork panel={panel} projectId={projectId} />
                                      {shot.segmentHead ? (
                                        <span className={styles.panelHead}>
                                          {t('conversation.creativeStudio.workspace.table.panel.head')}
                                        </span>
                                      ) : null}
                                    </FullscreenMediaFrame>
                                    <div className={styles.panelCaption}>
                                      <bdi>{String(shotIndex + 1).padStart(2, '0')}</bdi>
                                      <bdi>
                                        {t('conversation.creativeStudio.workspace.table.actualDuration', {
                                          seconds: shot.durationSeconds,
                                        })}
                                      </bdi>
                                      <span id={panelStatusId} className={styles.panelStatus}>
                                        {status}
                                      </span>
                                    </div>
                                    <BoardPanelRecoveryControls
                                      actions={actions}
                                      describedBy={panelStatusId}
                                      disabled={interactionLocked}
                                      panel={panel}
                                    />
                                    <div className={styles.panelActions}>
                                      {shot.segmentHead &&
                                      shot.explicitSeedAssetId !== panel.assetId &&
                                      isPromotableBoardPanel(panel) ? (
                                        <Button
                                          aria-describedby={panelStatusId}
                                          className={styles.panelPromote}
                                          disabled={interactionLocked}
                                          onClick={() => {
                                            if (!interactionLocked) actions.promotePanel(shot.id, panel.assetId);
                                          }}
                                          size='mini'
                                        >
                                          {t('conversation.creativeStudio.workspace.table.panel.useAsFirstFrame', {
                                            position: shotIndex + 1,
                                          })}
                                        </Button>
                                      ) : null}
                                      {panel.assetId !== null && panel.recovery?.canRetryDownload !== true ? (
                                        <Button
                                          className={styles.panelRedraw}
                                          disabled={generationLocked || !isDrawableBoardPanel(panel)}
                                          onClick={() => {
                                            if (!generationLocked && isDrawableBoardPanel(panel)) {
                                              actions.redrawShot(shot.id);
                                            }
                                          }}
                                          size='mini'
                                        >
                                          {t('conversation.creativeStudio.workspace.table.panel.redrawShot', {
                                            position: shotIndex + 1,
                                          })}
                                        </Button>
                                      ) : null}
                                    </div>
                                  </article>
                                </li>
                              );
                            })}
                          </ol>
                        </section>
                      </td>
                    </tr>
                  ) : null}
                </React.Fragment>
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
