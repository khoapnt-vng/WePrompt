/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Alert, Button, Select } from '@arco-design/web-react';
import React, { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { FullscreenMediaFrame } from '@/renderer/pages/studio/components/FullscreenMediaFrame';
import { createManagedStudioAssetUrl } from '@/renderer/pages/studio/studioManagedAssetUrl';

import type { WorkspaceBeatProjection, WorkspaceBoardPanelProjection } from '../../workspaceProjection';
import type { ReferenceWorkspaceItem, StudioReferenceFocusIntent } from '../References';
import styles from './Table.module.css';

const REFERENCE_ROOT = 'conversation.creativeStudio.workspace.referenceWorkflow';
const REFERENCE_HIGHLIGHT_MS = 1_600;

type TableColumnId = 'position' | 'panel' | 'beat' | 'story' | 'shots' | 'length';

type TableColumn = {
  id: TableColumnId;
  labelKey: string;
  fixedInlineSize?: number;
};

const COLUMNS = [
  {
    id: 'position',
    labelKey: 'conversation.creativeStudio.workspace.table.columns.position',
    fixedInlineSize: 78,
  },
  { id: 'panel', labelKey: 'conversation.creativeStudio.workspace.table.columns.panel', fixedInlineSize: 176 },
  { id: 'beat', labelKey: 'conversation.creativeStudio.workspace.table.columns.beat', fixedInlineSize: 100 },
  { id: 'story', labelKey: 'conversation.creativeStudio.workspace.table.columns.story' },
  { id: 'shots', labelKey: 'conversation.creativeStudio.workspace.table.columns.shots', fixedInlineSize: 68 },
  { id: 'length', labelKey: 'conversation.creativeStudio.workspace.table.columns.length', fixedInlineSize: 96 },
] as const satisfies readonly TableColumn[];

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

const moveOrder = (order: readonly string[], from: number, to: number): string[] | null => {
  if (from < 0 || from >= order.length || to < 0 || to >= order.length || from === to) return null;
  const next = [...order];
  const [moved] = next.splice(from, 1);
  if (moved === undefined) return null;
  next.splice(to, 0, moved);
  return next;
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

export type ReferenceBindingWorkspaceItem = {
  shotId: string;
  status: 'unassigned' | 'ready' | 'invalid';
  characterReferenceIds: string[];
  backgroundReferenceId: string | null;
};

export type TableReferenceBindingActions = {
  saveBinding: (
    shotId: string,
    characterReferenceIds: readonly string[],
    backgroundReferenceId: string | null
  ) => Promise<boolean>;
};

/** Free authoring and Director-draft actions. None of these initiate generation or spend. */
export type TableAuthoringActions = {
  addBeat: () => Promise<boolean>;
  addShot: (beatId: string) => Promise<boolean>;
  askDirector: (beatId: string) => void;
  reorderBeats: (beatOrder: readonly string[]) => Promise<boolean>;
};

type ShotReferenceBindingEditorProps = {
  item: ReferenceBindingWorkspaceItem;
  characters: readonly ReferenceWorkspaceItem[];
  backgrounds: readonly ReferenceWorkspaceItem[];
  maxConditioningImages: number | null;
  pending: boolean;
  gateLocked: boolean;
  save: TableReferenceBindingActions['saveBinding'];
};

const ShotReferenceBindingEditor: React.FC<ShotReferenceBindingEditorProps> = ({
  item,
  characters,
  backgrounds,
  maxConditioningImages,
  pending,
  gateLocked,
  save,
}) => {
  const { t } = useTranslation();
  const [characterReferenceIds, setCharacterReferenceIds] = useState(item.characterReferenceIds);
  const [backgroundReferenceId, setBackgroundReferenceId] = useState(item.backgroundReferenceId);
  const authoritySignature = JSON.stringify([
    item.shotId,
    item.status,
    item.characterReferenceIds,
    item.backgroundReferenceId,
  ]);
  useEffect(() => {
    setCharacterReferenceIds(item.characterReferenceIds);
    setBackgroundReferenceId(item.backgroundReferenceId);
  }, [authoritySignature]);
  const selectedCount = characterReferenceIds.length + (backgroundReferenceId === null ? 0 : 1);
  const overCapacity = maxConditioningImages !== null && selectedCount > maxConditioningImages;
  const dirty =
    item.status !== 'ready' ||
    backgroundReferenceId !== item.backgroundReferenceId ||
    characterReferenceIds.length !== item.characterReferenceIds.length ||
    characterReferenceIds.some((referenceId, index) => referenceId !== item.characterReferenceIds[index]);
  const disabled = gateLocked || pending;

  return (
    <div className={styles.bindingEditor}>
      {item.status === 'unassigned' ? (
        <Alert type='warning' content={t(`${REFERENCE_ROOT}.bindings.unassigned`)} />
      ) : item.status === 'invalid' ? (
        <Alert type='error' content={t(`${REFERENCE_ROOT}.bindings.invalid`)} />
      ) : null}
      {overCapacity ? (
        <Alert
          type='error'
          content={t(`${REFERENCE_ROOT}.bindings.capacity`, { count: selectedCount, limit: maxConditioningImages })}
        />
      ) : null}
      {maxConditioningImages === null ? null : (
        <span className={styles.bindingCapacity} data-over-capacity={overCapacity ? 'true' : 'false'}>
          {t(`${REFERENCE_ROOT}.bindings.capacityUsage`, {
            count: selectedCount,
            limit: maxConditioningImages,
          })}
        </span>
      )}
      <label className={styles.bindingField}>
        <span>{t(`${REFERENCE_ROOT}.bindings.characters`)}</span>
        <Select
          aria-label={t(`${REFERENCE_ROOT}.bindings.characters`)}
          disabled={disabled}
          mode='multiple'
          onChange={(value) => setCharacterReferenceIds(Array.isArray(value) ? value.map(String) : [])}
          value={characterReferenceIds}
        >
          {characters.map((reference) => (
            <Select.Option key={reference.id} value={reference.id} disabled={reference.approvedAssetId === null}>
              <bdi dir='auto'>{reference.label}</bdi>
            </Select.Option>
          ))}
        </Select>
      </label>
      <label className={styles.bindingField}>
        <span>{t(`${REFERENCE_ROOT}.bindings.background`)}</span>
        <Select
          aria-label={t(`${REFERENCE_ROOT}.bindings.background`)}
          allowClear
          disabled={disabled}
          onChange={(value) => setBackgroundReferenceId(typeof value === 'string' ? value : null)}
          value={backgroundReferenceId ?? undefined}
        >
          {backgrounds.map((reference) => (
            <Select.Option key={reference.id} value={reference.id} disabled={reference.approvedAssetId === null}>
              <bdi dir='auto'>{reference.label}</bdi>
            </Select.Option>
          ))}
        </Select>
      </label>
      <Button
        type='primary'
        disabled={disabled || overCapacity || !dirty}
        loading={pending}
        onClick={() => void save(item.shotId, characterReferenceIds, backgroundReferenceId)}
        size='mini'
      >
        {t(`${REFERENCE_ROOT}.bindings.save`)}
      </Button>
    </div>
  );
};

export type TableViewProps = {
  authoringActions: TableAuthoringActions;
  projectId: string;
  beats: readonly WorkspaceBeatProjection[];
  coverageGapBeatIds: readonly string[];
  unscriptedShotIds: readonly string[];
  boardPanels: readonly WorkspaceBoardPanelProjection[];
  references: readonly ReferenceWorkspaceItem[];
  referenceBindings: readonly ReferenceBindingWorkspaceItem[];
  referenceMaxConditioningImages: number | null;
  referencePendingId: string | null;
  bindingActions: TableReferenceBindingActions;
  referenceFocusIntent?: StudioReferenceFocusIntent | null;
  onReferenceFocusIntentConsumed?: (intentId: string) => void;
  pending: boolean;
  gateLocked: boolean;
  selectedBeatId: string | null;
  onOpenBeat: (beatId: string) => void;
  onSelectBeat: (beatId: string) => void;
};

/** Beat-level workspace presentation. Selection is supplied by the shared draft owner. */
export const TableView: React.FC<TableViewProps> = ({
  authoringActions,
  projectId,
  beats,
  coverageGapBeatIds,
  unscriptedShotIds,
  boardPanels,
  references,
  referenceBindings,
  referenceMaxConditioningImages,
  referencePendingId,
  bindingActions,
  referenceFocusIntent = null,
  onReferenceFocusIntentConsumed,
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
  const reorderPendingRef = useRef(false);
  const bindingCardRefs = useRef(new Map<string, HTMLElement>());
  const bindingHighlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const consumedReferenceFocusIntentRef = useRef<{ projectId: string; intentId: string } | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const pendingPanelButtonFocusRef = useRef<string | null>(null);
  const [openBoardBeatId, setOpenBoardBeatId] = useState<string | null>(null);
  const [openShotDetailId, setOpenShotDetailId] = useState<string | null>(null);
  const [highlightedBindingShotId, setHighlightedBindingShotId] = useState<string | null>(null);
  const [reorderingBeatId, setReorderingBeatId] = useState<string | null>(null);
  const pendingFocusBeatIdRef = useRef<string | null>(null);
  const [reorderAnnouncement, setReorderAnnouncement] = useState({ message: '', sequence: 0 });
  const detailIdBase = useId();
  const safeDetailIdBase = `studio-table-${detailIdBase.replace(/[^A-Za-z0-9_-]/g, '') || 'details'}`;
  const exactBoardPanels = useMemo(() => exactFilmOrderBoardPanels(beats, boardPanels), [beats, boardPanels]);
  const panelByShotId = useMemo(
    () => new Map(exactBoardPanels.map((panel) => [panel.shotId, panel] as const)),
    [exactBoardPanels]
  );
  const bindingByShotId = useMemo(
    () => new Map(referenceBindings.map((binding) => [binding.shotId, binding] as const)),
    [referenceBindings]
  );
  const bindingSummary = useMemo(
    () => ({
      ready: referenceBindings.filter((binding) => binding.status === 'ready').length,
      total: beats.reduce((count, beat) => count + beat.shots.length, 0),
    }),
    [beats, referenceBindings]
  );
  const characters = useMemo(() => references.filter((item) => item.kind === 'character'), [references]);
  const backgrounds = useMemo(() => references.filter((item) => item.kind === 'background'), [references]);
  const interactionLocked = pending || gateLocked;
  const beatOrder = beats.map((beat) => beat.id);
  const canonicalOrderReady = new Set(beatOrder).size === beatOrder.length;
  const askDirectorBeatId =
    coverageGapBeatIds.find((beatId) => beats.some((beat) => beat.id === beatId && beat.shots.length === 0)) ??
    beats.find((beat) => beat.shots.some((shot) => shot.id === unscriptedShotIds[0]))?.id ??
    null;
  const authoringLabelId = `${safeDetailIdBase}-authoring-label`;

  const columns: readonly TableColumn[] = COLUMNS;
  const columnCount = columns.length;
  const focusedRow = Math.min(focusedCell.row, Math.max(0, beats.length - 1));
  const focusedColumn = columns.some((column) => column.id === focusedCell.column) ? focusedCell.column : 'story';
  const openBoardBeatIndex = beats.findIndex((beat) => beat.id === openBoardBeatId && beat.shots.length > 0);
  const openShotCount = openBoardBeatIndex < 0 ? 0 : (beats[openBoardBeatIndex]?.shots.length ?? 0);

  useEffect(() => {
    if (openBoardBeatId !== null && !beats.some((beat) => beat.id === openBoardBeatId && beat.shots.length > 0)) {
      setOpenBoardBeatId(null);
      setOpenShotDetailId(null);
      return;
    }
    if (
      openShotDetailId !== null &&
      !beats.some((beat) => beat.id === openBoardBeatId && beat.shots.some((shot) => shot.id === openShotDetailId))
    ) {
      setOpenShotDetailId(null);
    }
  }, [beats, openBoardBeatId, openShotDetailId]);

  useEffect(() => {
    if (referenceFocusIntent === null || referenceFocusIntent.projectId !== projectId) return;
    const target = beats
      .flatMap((beat) => beat.shots.map((shot) => ({ beatId: beat.id, shotId: shot.id })))
      .find(({ shotId }) => referenceFocusIntent.shotIds.includes(shotId));
    if (target === undefined) return;
    setOpenBoardBeatId(target.beatId);
    setOpenShotDetailId(target.shotId);
    setHighlightedBindingShotId(target.shotId);
    onSelectBeat(target.beatId);
  }, [beats, onSelectBeat, projectId, referenceFocusIntent]);

  useLayoutEffect(() => {
    if (
      referenceFocusIntent === null ||
      (consumedReferenceFocusIntentRef.current !== null &&
        consumedReferenceFocusIntentRef.current.projectId !== projectId)
    ) {
      consumedReferenceFocusIntentRef.current = null;
    }
  }, [projectId, referenceFocusIntent]);

  useLayoutEffect(() => {
    if (
      referenceFocusIntent === null ||
      referenceFocusIntent.projectId !== projectId ||
      highlightedBindingShotId === null ||
      !referenceFocusIntent.shotIds.includes(highlightedBindingShotId)
    ) {
      return;
    }
    if (
      consumedReferenceFocusIntentRef.current?.projectId === projectId &&
      consumedReferenceFocusIntentRef.current.intentId === referenceFocusIntent.id
    ) {
      return;
    }
    const node = bindingCardRefs.current.get(highlightedBindingShotId);
    if (node === undefined) return;
    node.scrollIntoView?.({ behavior: 'smooth', block: 'center', inline: 'center' });
    node.focus({ preventScroll: true });
    consumedReferenceFocusIntentRef.current = { projectId, intentId: referenceFocusIntent.id };
    onReferenceFocusIntentConsumed?.(referenceFocusIntent.id);
    if (bindingHighlightTimerRef.current !== null) clearTimeout(bindingHighlightTimerRef.current);
    bindingHighlightTimerRef.current = setTimeout(() => {
      setHighlightedBindingShotId((current) => (current === highlightedBindingShotId ? null : current));
      bindingHighlightTimerRef.current = null;
    }, REFERENCE_HIGHLIGHT_MS);
  }, [highlightedBindingShotId, onReferenceFocusIntentConsumed, projectId, referenceFocusIntent]);

  useEffect(
    () => () => {
      if (bindingHighlightTimerRef.current !== null) clearTimeout(bindingHighlightTimerRef.current);
    },
    []
  );

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

  const shotRowId = (row: number, shotIndex: number): string =>
    `${safeDetailIdBase}-beat-${String(row)}-shot-${String(shotIndex)}`;

  const shotDetailId = (row: number, shotIndex: number): string => `${shotRowId(row, shotIndex)}-details`;

  const closeBoardDetails = (beatId: string): void => {
    if (openBoardBeatId !== beatId) return;
    pendingPanelButtonFocusRef.current = beatId;
    setOpenBoardBeatId(null);
    setOpenShotDetailId(null);
  };

  const toggleBoardDetails = (beat: WorkspaceBeatProjection): void => {
    if (beat.shots.length === 0) return;
    onSelectBeat(beat.id);
    setOpenShotDetailId(null);
    setOpenBoardBeatId((current) => (current === beat.id ? null : beat.id));
  };

  const toggleShotDetails = (beatId: string, shotId: string): void => {
    if (openBoardBeatId !== beatId) return;
    setOpenShotDetailId((current) => (current === shotId ? null : shotId));
  };

  const handleCellKeyDown = (
    event: React.KeyboardEvent<HTMLTableCellElement>,
    row: number,
    column: number,
    beat: WorkspaceBeatProjection
  ): void => {
    if (columns[column]?.id === 'position' && event.altKey) {
      let destination: number | null = null;
      if (event.key === 'ArrowUp') destination = row - 1;
      else if (event.key === 'ArrowDown') destination = row + 1;
      else if (event.key === 'Home') destination = 0;
      else if (event.key === 'End') destination = beatOrder.length - 1;
      if (destination !== null) {
        event.preventDefault();
        void reorderBeat(beat.id, destination);
        return;
      }
    }
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

  const reorderBeat = async (beatId: string, destination: number): Promise<void> => {
    if (interactionLocked || reorderPendingRef.current || !canonicalOrderReady) return;
    const source = beatOrder.indexOf(beatId);
    const nextOrder = moveOrder(beatOrder, source, destination);
    if (nextOrder === null) return;
    reorderPendingRef.current = true;
    setReorderingBeatId(beatId);
    let reordered = false;
    try {
      reordered = await authoringActions.reorderBeats(nextOrder);
      const sourceBeat = beats[source];
      const sourceTitle =
        sourceBeat === undefined
          ? beatId
          : sourceBeat.title.trim() === ''
            ? t('conversation.creativeStudio.workspace.beatPanel.untitledBeat', {
                index: source + 1,
              })
            : sourceBeat.title;
      const message = reordered
        ? t('conversation.creativeStudio.workspace.table.reorder.announcement', {
            title: sourceTitle,
            from: source + 1,
            to: destination + 1,
            total: beatOrder.length,
          })
        : t('conversation.creativeStudio.workspace.table.reorder.failed');
      setReorderAnnouncement((current) => ({ message, sequence: current.sequence + 1 }));
    } catch {
      setReorderAnnouncement((current) => ({
        message: t('conversation.creativeStudio.workspace.table.reorder.failed'),
        sequence: current.sequence + 1,
      }));
    } finally {
      reorderPendingRef.current = false;
      setReorderingBeatId(null);
      pendingFocusBeatIdRef.current = beatId;
    }
  };

  useEffect(() => {
    const beatId = pendingFocusBeatIdRef.current;
    if (beatId === null) return;
    const row = beatOrder.indexOf(beatId);
    if (row < 0) {
      pendingFocusBeatIdRef.current = null;
      return;
    }
    const cell = cellRefs.current[row]?.position;
    if (cell === undefined || cell === null) return;
    pendingFocusBeatIdRef.current = null;
    cell.focus({ preventScroll: true });
  }, [beatOrder]);

  return (
    <section className={styles.root}>
      <section
        aria-labelledby={authoringLabelId}
        className={styles.authoringRegion}
        data-studio-table-authoring
        role='region'
      >
        <div className={styles.authoringFacts}>
          <strong id={authoringLabelId}>{t('conversation.creativeStudio.workspace.table.authoring.label')}</strong>
          {coverageGapBeatIds.length > 0 ? (
            <span data-coverage-gap-count={coverageGapBeatIds.length}>
              {t('conversation.creativeStudio.workspace.table.authoring.coverageGap', {
                count: coverageGapBeatIds.length,
                total: beats.length,
              })}
            </span>
          ) : null}
          {unscriptedShotIds.length > 0 ? (
            <span data-unscripted-shot-count={unscriptedShotIds.length}>
              {t('conversation.creativeStudio.workspace.table.authoring.unscriptedWarning', {
                count: unscriptedShotIds.length,
              })}
            </span>
          ) : null}
          <span data-reference-binding-progress>
            {t(`${REFERENCE_ROOT}.bindings.progress`, {
              ready: bindingSummary.ready,
              total: bindingSummary.total,
            })}
          </span>
          <span className={styles.authoringNote}>
            {t('conversation.creativeStudio.workspace.table.authoring.unassignedReferenceNote')}
          </span>
        </div>
        <div className={styles.authoringActions}>
          <Button
            disabled={interactionLocked || askDirectorBeatId === null}
            onClick={() => {
              if (!interactionLocked && askDirectorBeatId !== null) authoringActions.askDirector(askDirectorBeatId);
            }}
          >
            {t('conversation.creativeStudio.workspace.table.authoring.askDirector')}
          </Button>
          <Button
            disabled={interactionLocked}
            onClick={() => {
              if (!interactionLocked) void authoringActions.addBeat();
            }}
            type='primary'
          >
            {t('conversation.creativeStudio.workspace.table.authoring.addBeat')}
          </Button>
        </div>
      </section>
      <div ref={scrollRef} className={styles.scroll} data-studio-table-scroll>
        <table
          aria-colcount={columnCount}
          aria-label={t('conversation.creativeStudio.workspace.table.label')}
          aria-rowcount={beats.length + 1 + openShotCount}
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
              const beatDisplayTitle =
                beat.title.trim() === ''
                  ? t('conversation.creativeStudio.workspace.beatPanel.untitledBeat', { index: row + 1 })
                  : beat.title;
              const selected = beat.id === selectedBeatId;
              const hasCoverage = beat.shots.length > 0;
              const boardDetailsOpen = openBoardBeatIndex === row && hasCoverage;
              const boardPanelsForBeat = beat.shots.map(
                (shot) => panelByShotId.get(shot.id) ?? statusPendingPanel(shot.id)
              );
              const leadPanel = boardPanelsForBeat[0] ?? null;
              const beatAriaRowIndex =
                row + 2 + (openBoardBeatIndex >= 0 && row > openBoardBeatIndex ? openShotCount : 0);
              const durationSeconds = hasCoverage ? beat.sumSeconds : null;
              const duration =
                durationSeconds === null
                  ? t('conversation.creativeStudio.workspace.table.plannedPending')
                  : t('conversation.creativeStudio.workspace.table.actualDuration', { seconds: durationSeconds });
              const cells: Array<{ column: TableColumnId; content: React.ReactNode }> = [
                {
                  column: 'position',
                  content: (
                    <div className={styles.positionActions}>
                      <span className={styles.position}>
                        <bdi>{String(row + 1).padStart(2, '0')}</bdi>
                      </span>
                    </div>
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
                      {...(hasCoverage
                        ? {
                            'aria-controls': beat.shots.map((_shot, shotIndex) => shotRowId(row, shotIndex)).join(' '),
                            'aria-expanded': boardDetailsOpen,
                          }
                        : {})}
                      aria-label={t(
                        boardDetailsOpen
                          ? 'conversation.creativeStudio.workspace.table.panel.closeDetails'
                          : 'conversation.creativeStudio.workspace.table.panel.openDetails',
                        { title: beatDisplayTitle }
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
                      {beatDisplayTitle}
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
                    <div
                      className={styles.shotCountActions}
                      onClick={(event) => event.stopPropagation()}
                      onKeyDown={(event) => event.stopPropagation()}
                    >
                      <span className={styles.shotCount}>
                        <bdi>
                          {t('conversation.creativeStudio.workspace.table.shotCount', { count: beat.shots.length })}
                        </bdi>
                      </span>
                      <Button
                        aria-label={t('conversation.creativeStudio.workspace.table.authoring.addShotForBeat', {
                          title: beatDisplayTitle,
                        })}
                        disabled={interactionLocked}
                        onClick={() => {
                          if (!interactionLocked) void authoringActions.addShot(beat.id);
                        }}
                        size='mini'
                        type='text'
                      >
                        {t('conversation.creativeStudio.workspace.table.authoring.addShot')}
                      </Button>
                    </div>
                  ),
                },
                {
                  column: 'length',
                  content: (
                    <span className={styles.durationFact}>
                      <span
                        className={`${styles.plannedDuration} ${durationSeconds === null ? styles.pendingDuration : ''}`}
                        data-duration-kind='planned'
                      >
                        <bdi>{duration}</bdi>
                      </span>
                    </span>
                  ),
                },
              ];

              return (
                <React.Fragment key={beat.id}>
                  <tr
                    aria-rowindex={beatAriaRowIndex}
                    aria-selected={selected}
                    aria-busy={reorderingBeatId === beat.id}
                    className={styles.row}
                    data-beat-id={beat.id}
                    data-reordering={reorderingBeatId === beat.id ? 'true' : undefined}
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
                  {boardDetailsOpen
                    ? beat.shots.map((shot, shotIndex) => {
                        const panel = boardPanelsForBeat[shotIndex] ?? statusPendingPanel(shot.id);
                        const binding = bindingByShotId.get(shot.id) ?? {
                          shotId: shot.id,
                          status: 'invalid' as const,
                          characterReferenceIds: [],
                          backgroundReferenceId: null,
                        };
                        const status = t(panelStatusKey(panel));
                        const detailsOpen = openShotDetailId === shot.id;
                        const rowId = shotRowId(row, shotIndex);
                        const detailsId = shotDetailId(row, shotIndex);
                        const detailLabel = t('conversation.creativeStudio.workspace.table.panel.shotDetails', {
                          position: shotIndex + 1,
                        });
                        const shotCells: Array<{ column: TableColumnId; content: React.ReactNode }> = [
                          {
                            column: 'position',
                            content: (
                              <span className={styles.shotPosition} data-shot-position={shotIndex + 1}>
                                <bdi>
                                  {t('conversation.creativeStudio.workspace.table.shotPosition', {
                                    beat: row + 1,
                                    shot: shotIndex + 1,
                                  })}
                                </bdi>
                              </span>
                            ),
                          },
                          {
                            column: 'panel',
                            content: (
                              <FullscreenMediaFrame className={styles.shotPanelFrame} enabled={panel.assetId !== null}>
                                <BoardPanelArtwork panel={panel} projectId={projectId} />
                              </FullscreenMediaFrame>
                            ),
                          },
                          {
                            column: 'beat',
                            content: (
                              <span
                                className={styles.chainPosition}
                                data-chain-position={
                                  shot.segmentHead
                                    ? 'head'
                                    : shotIndex > 0
                                      ? `predecessor:${String(shotIndex)}`
                                      : 'pending'
                                }
                              >
                                {shot.segmentHead ? (
                                  t('conversation.creativeStudio.workspace.table.panel.head')
                                ) : shotIndex > 0 ? (
                                  <>
                                    <span aria-hidden='true'>← </span>
                                    <bdi>
                                      {t(`${REFERENCE_ROOT}.bindings.shot`, {
                                        position: shotIndex,
                                      })}
                                    </bdi>
                                  </>
                                ) : (
                                  t(PANEL_STATUS_KEYS.status_pending)
                                )}
                              </span>
                            ),
                          },
                          {
                            column: 'story',
                            content: (
                              <>
                                <span className={styles.shotScript} dir='auto'>
                                  {shot.shootingScript}
                                </span>
                                {detailsOpen ? (
                                  <section
                                    ref={(node) => {
                                      if (node === null) bindingCardRefs.current.delete(shot.id);
                                      else bindingCardRefs.current.set(shot.id, node);
                                    }}
                                    aria-label={detailLabel}
                                    className={styles.shotDetails}
                                    data-shot-binding-highlighted={highlightedBindingShotId === shot.id || undefined}
                                    id={detailsId}
                                    tabIndex={-1}
                                  >
                                    <ShotReferenceBindingEditor
                                      backgrounds={backgrounds}
                                      characters={characters}
                                      gateLocked={interactionLocked}
                                      item={binding}
                                      maxConditioningImages={referenceMaxConditioningImages}
                                      pending={referencePendingId === shot.id}
                                      save={bindingActions.saveBinding}
                                    />
                                  </section>
                                ) : null}
                              </>
                            ),
                          },
                          {
                            column: 'shots',
                            content: (
                              <Button
                                aria-controls={detailsId}
                                aria-expanded={detailsOpen}
                                aria-label={`${t(detailsOpen ? 'common.collapse' : 'common.expand')}: ${detailLabel}`}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  toggleShotDetails(beat.id, shot.id);
                                }}
                                size='mini'
                                type='text'
                              >
                                {t(detailsOpen ? 'common.collapse' : 'common.expand')}
                              </Button>
                            ),
                          },
                          {
                            column: 'length',
                            content: (
                              <span className={styles.durationFact} data-duration-kind='shot'>
                                <bdi>
                                  {t('conversation.creativeStudio.workspace.table.actualDuration', {
                                    seconds: shot.durationSeconds,
                                  })}
                                </bdi>
                              </span>
                            ),
                          },
                        ];
                        return (
                          <tr
                            key={shot.id}
                            aria-label={t('conversation.creativeStudio.workspace.table.panel.cardLabel', {
                              position: shotIndex + 1,
                              status,
                            })}
                            aria-rowindex={beatAriaRowIndex + shotIndex + 1}
                            className={`${styles.shotRow} ${highlightedBindingShotId === shot.id ? styles.bindingHighlighted : ''}`}
                            data-board-detail-for={beat.id}
                            data-shot-binding-highlighted={highlightedBindingShotId === shot.id || undefined}
                            data-shot-binding-status={binding.status}
                            data-shot-detail-open={detailsOpen}
                            data-shot-id={shot.id}
                            id={rowId}
                            onClick={(event) => event.stopPropagation()}
                            onKeyDown={(event) => {
                              if (event.key !== 'Escape') return;
                              event.preventDefault();
                              event.stopPropagation();
                              closeBoardDetails(beat.id);
                            }}
                            role='row'
                          >
                            {shotCells.map(({ column: columnId, content }, column) => (
                              <td
                                key={columnId}
                                aria-colindex={column + 1}
                                className={`${styles.cell} ${styles.shotCell}`}
                                data-grid-column={column}
                                data-grid-column-name={columnId}
                                role='gridcell'
                              >
                                {content}
                              </td>
                            ))}
                          </tr>
                        );
                      })
                    : null}
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
      <span aria-live='polite' className={styles.srOnly}>
        <span key={reorderAnnouncement.sequence}>{reorderAnnouncement.message}</span>
      </span>
    </section>
  );
};
