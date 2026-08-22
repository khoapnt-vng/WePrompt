/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Alert, Button, Drawer, Popconfirm, Select, Slider } from '@arco-design/web-react';
import React, { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { StudioRendererExportCatalogV2 } from '@/common/types/project/creativeStudioTypes';
import { createManagedStudioAssetUrl } from '@/renderer/pages/studio/studioManagedAssetUrl';
import type { WorkspaceBeatProjection, WorkspaceProjection } from '../../workspaceProjection';
import {
  CutPlayer,
  EMPTY_CUT_PLAYBACK_NAVIGATION,
  type CutPlaybackNavigation,
  type CutPlayerHandle,
} from './CutPlayer';
import { buildCutFilmSummary, buildCutSlateWarnings, formatCutClock } from './filmSummary';
import { buildCutFilmstrip } from './filmstrip';
import { buildCutMatchReference } from './matchReference';
import styles from './Cut.module.css';

const CUT_ROOT = 'conversation.creativeStudio.workspace.cut';
const ASSETS_ROOT = 'conversation.creativeStudio.workspace.assets';

const CUT_STATE_KEYS = {
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

// Cut workspace copy is currently authored in en-US and eagerly merged into deferred locales.
// Resolve the source language's one/other category before translation so an active locale cannot
// apply its own plural categories to English fallback copy (for example, CJK `1 Slates`).
const englishFallbackPluralKey = (base: string, count: number): string => `${base}_${count === 1 ? 'one' : 'other'}`;

export type CutImportResult = 'cancelled' | 'imported' | 'failed';
export type CutCopyResult = 'cancelled' | 'copied' | 'failed';

export type CutCreateExportInput =
  | { shape: 'editor_folder' }
  | { shape: 'script' }
  | { shape: 'still'; shotId: string };

export type CutActions = {
  reorderBeats: (order: readonly string[]) => Promise<boolean>;
  importBedAudio: () => Promise<CutImportResult>;
  setBed: (assetId: string | null) => Promise<boolean>;
  detachBedAudio: (assetId: string) => Promise<boolean>;
  setMatchTo: (shotId: string | null) => Promise<boolean>;
  createExport: (input: CutCreateExportInput) => Promise<boolean>;
  refreshExports: () => Promise<boolean>;
  copyExport: (artifactId: string) => Promise<CutCopyResult>;
  revealExport: (artifactId: string) => Promise<boolean>;
};

export type CutViewProps = {
  projectId: string;
  projection: WorkspaceProjection;
  exportCatalog: StudioRendererExportCatalogV2 | null;
  pending: boolean;
  exportErrorMessageKey: string | null;
  actions: CutActions;
  onOpenBeat: (beatId: string) => void;
};

const moveOrder = (order: readonly string[], from: number, to: number): string[] | null => {
  if (from < 0 || from >= order.length || to < 0 || to >= order.length || from === to) return null;
  const next = [...order];
  const [moved] = next.splice(from, 1);
  if (moved === undefined) return null;
  next.splice(to, 0, moved);
  return next;
};

const selectedBedId = (projection: WorkspaceProjection): string | null =>
  projection.cut.bed.status === 'none' || projection.cut.bed.status === 'invalid' ? null : projection.cut.bed.assetId;

const exportShapeKey = (shape: StudioRendererExportCatalogV2['artifacts'][number]['shape']): string =>
  `${ASSETS_ROOT}.shape.${shape}`;

/** Film-level Cut controls. Beat internals and paid generation remain outside this surface. */
export const CutView: React.FC<CutViewProps> = ({
  projectId,
  projection,
  exportCatalog,
  pending,
  exportErrorMessageKey,
  actions,
  onOpenBeat,
}) => {
  const { t } = useTranslation();
  const [announcement, setAnnouncement] = useState('');
  const [assetsVisible, setAssetsVisible] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [reorderFocusId, setReorderFocusId] = useState<string | null>(null);
  const [selectedBeatId, setSelectedBeatId] = useState<string | null>(() => projection.cut.beats[0]?.id ?? null);
  const [stillShotId, setStillShotId] = useState<string | null>(null);
  const [playback, setPlayback] = useState<CutPlaybackNavigation>(EMPTY_CUT_PLAYBACK_NAVIGATION);
  const summaryTitleId = useId();
  const actionPendingRef = useRef(false);
  const draggedBeatIdRef = useRef<string | null>(null);
  const segmentRefs = useRef(new Map<string, HTMLButtonElement>());
  const playerRef = useRef<CutPlayerHandle>(null);
  const seekSliderRootRef = useRef<HTMLDivElement | null>(null);
  const seekRailLabel = t(`${CUT_ROOT}.preview.seekLabel`);
  const setSeekSliderRoot = useCallback((node: unknown): void => {
    seekSliderRootRef.current = node instanceof HTMLDivElement ? node : null;
  }, []);

  const beatOrder = projection.cut.beats.map((beat) => beat.id);
  const canonicalOrderReady =
    projectId === projection.projectId &&
    projection.cut.orderReady &&
    beatOrder.length === projection.activeBeatIds.length &&
    beatOrder.every((beatId, index) => beatId === projection.activeBeatIds[index]);
  const locked = pending || actionPendingRef.current || projectId !== projection.projectId;
  const currentBedId = selectedBedId(projection);
  const currentBed = projection.cut.audioImports.find((asset) => asset.assetId === currentBedId) ?? null;
  const stillCandidates = useMemo(
    () => projection.cut.matchCandidates.filter((candidate) => candidate.coverAssetId !== null),
    [projection.cut.matchCandidates]
  );

  useEffect(() => {
    setStillShotId((current) => {
      if (current !== null && stillCandidates.some((candidate) => candidate.shotId === current)) return current;
      return stillCandidates[0]?.shotId ?? null;
    });
  }, [projectId, stillCandidates]);

  useEffect(() => {
    if (reorderFocusId === null || busyKey !== null) return;
    const control = segmentRefs.current.get(reorderFocusId);
    if (control === undefined) {
      setReorderFocusId(null);
      return;
    }
    control.focus();
    setReorderFocusId(null);
  }, [busyKey, projection.cut.beats, reorderFocusId]);

  useEffect(() => {
    setSelectedBeatId((current) =>
      current !== null && projection.cut.beats.some((beat) => beat.id === current)
        ? current
        : (projection.cut.beats[0]?.id ?? null)
    );
  }, [projection.cut.beats]);

  useLayoutEffect(() => {
    const handle = seekSliderRootRef.current?.querySelector<HTMLElement>('[role="slider"]') ?? null;
    if (handle === null) return;
    handle.setAttribute('aria-label', seekRailLabel);
    return () => handle.removeAttribute('aria-label');
  }, [playback.available, projection.cut.beats.length, seekRailLabel]);

  const runAction = async <Result,>(key: string, action: () => Promise<Result>): Promise<Result | null> => {
    if (locked || actionPendingRef.current) return null;
    actionPendingRef.current = true;
    setBusyKey(key);
    try {
      return await action();
    } catch {
      return null;
    } finally {
      actionPendingRef.current = false;
      setBusyKey(null);
    }
  };

  const reorderBeat = async (beatId: string, destination: number): Promise<void> => {
    if (!canonicalOrderReady) return;
    const source = beatOrder.indexOf(beatId);
    const next = moveOrder(beatOrder, source, destination);
    if (next === null) return;
    const reordered = await runAction(`beat:${beatId}`, () => actions.reorderBeats(next));
    setAnnouncement(
      reordered === true
        ? t(`${CUT_ROOT}.reorderAnnouncement`, {
            title: projection.cut.beats[source]?.title || beatId,
            from: source + 1,
            to: destination + 1,
            total: beatOrder.length,
          })
        : t(`${CUT_ROOT}.reorderFailed`)
    );
    setReorderFocusId(beatId);
  };

  const importBed = async (): Promise<void> => {
    const result = await runAction('bed:import', actions.importBedAudio);
    const key = result === 'imported' ? 'imported' : result === 'cancelled' ? 'importCancelled' : 'importFailed';
    setAnnouncement(t(`${CUT_ROOT}.bed.${key}`));
  };

  const chooseBed = async (value: unknown): Promise<void> => {
    const assetId =
      typeof value === 'string' && projection.cut.audioImports.some((asset) => asset.assetId === value) ? value : null;
    if (assetId === currentBedId) return;
    const changed = await runAction('bed:select', () => actions.setBed(assetId));
    setAnnouncement(
      t(`${CUT_ROOT}.bed.${changed === true ? (assetId === null ? 'cleared' : 'selected') : 'setFailed'}`)
    );
  };

  const chooseMatch = async (value: unknown): Promise<void> => {
    const shotId =
      typeof value === 'string' && projection.cut.matchCandidates.some((candidate) => candidate.shotId === value)
        ? value
        : null;
    if (shotId === projection.cut.selectedMatchShotId) return;
    const changed = await runAction('match:select', () => actions.setMatchTo(shotId));
    setAnnouncement(
      t(`${CUT_ROOT}.match.${changed === true ? (shotId === null ? 'cleared' : 'selected') : 'setFailed'}`)
    );
  };

  const createExport = async (input: CutCreateExportInput): Promise<void> => {
    const created = await runAction(`export:${input.shape}`, () => actions.createExport(input));
    setAnnouncement(t(`${CUT_ROOT}.exports.${created === true ? 'created' : 'createFailed'}`));
  };

  const refreshExports = async (): Promise<void> => {
    const refreshed = await runAction('exports:refresh', actions.refreshExports);
    setAnnouncement(t(`${CUT_ROOT}.exports.${refreshed === true ? 'refreshed' : 'refreshFailed'}`));
  };

  const copyExport = async (artifactId: string): Promise<void> => {
    const result = await runAction(`copy:${artifactId}`, () => actions.copyExport(artifactId));
    const key = result === 'copied' ? 'copied' : result === 'cancelled' ? 'copyCancelled' : 'copyFailed';
    setAnnouncement(t(`${ASSETS_ROOT}.${key}`));
  };

  const revealExport = async (artifactId: string): Promise<void> => {
    const revealed = await runAction(`reveal:${artifactId}`, () => actions.revealExport(artifactId));
    setAnnouncement(t(`${ASSETS_ROOT}.${revealed === true ? 'revealed' : 'revealFailed'}`));
  };

  const detachAudio = async (assetId: string): Promise<void> => {
    if (assetId === currentBedId) return;
    const detached = await runAction(`detach:${assetId}`, () => actions.detachBedAudio(assetId));
    setAnnouncement(t(`${ASSETS_ROOT}.${detached === true ? 'detached' : 'detachFailed'}`));
  };

  const bedStatus = projection.cut.bed;
  const film = buildCutFilmSummary(projection.cut);
  const filmClock = formatCutClock(film.filmSeconds);
  const targetClock = formatCutClock(film.targetSeconds);
  const deltaClock = formatCutClock(film.delta?.seconds ?? null);
  const slates = buildCutSlateWarnings(projection.cut);
  const filmstrip = buildCutFilmstrip(projection.cut);
  const filmstripByBeatId = new Map(filmstrip?.map((segment) => [segment.beatId, segment]) ?? []);
  let filmstripCursor = 0;
  const filmstripJoinMarks = (filmstrip ?? []).slice(0, -1).map((filmstripSegment) => {
    filmstripCursor += filmstripSegment.durationSeconds;
    return filmstripCursor;
  });
  const displayStateByBeatId = new Map(projection.activeBeats.map((beat) => [beat.id, beat.displayState]));
  const selectedBeatIndex = Math.max(
    0,
    projection.cut.beats.findIndex((beat) => beat.id === selectedBeatId)
  );
  const selectedBeat = projection.cut.beats[selectedBeatIndex] ?? null;
  const matchReference = buildCutMatchReference({
    activeBeats: projection.activeBeats,
    selectedMatchShotId: projection.cut.selectedMatchShotId,
  });
  const bedScaleSeconds = Math.max(currentBed?.durationSeconds ?? 0, projection.cut.filmDurationSeconds ?? 0);
  const bedFilmPercent =
    bedScaleSeconds > 0 && projection.cut.filmDurationSeconds !== null
      ? (projection.cut.filmDurationSeconds / bedScaleSeconds) * 100
      : 0;
  const bedSourcePercent =
    bedScaleSeconds > 0 && currentBed !== null ? (currentBed.durationSeconds / bedScaleSeconds) * 100 : 0;

  const onCutKeyDown = (event: React.KeyboardEvent<HTMLElement>): void => {
    if (event.target !== event.currentTarget || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === ' ') playerRef.current?.togglePlayback();
    else if (event.key === 'ArrowLeft') playerRef.current?.nudge(event.shiftKey ? -0.2 : -1);
    else if (event.key === 'ArrowRight') playerRef.current?.nudge(event.shiftKey ? 0.2 : 1);
    else if (event.key === '[') playerRef.current?.stepJoin(-1);
    else if (event.key === ']') playerRef.current?.stepJoin(1);
    else if (event.key.toLowerCase() === 'l') playerRef.current?.toggleJoinLoop();
    else return;
    event.preventDefault();
  };

  return (
    <section
      aria-label={t(`${CUT_ROOT}.ariaLabel`)}
      className={styles.root}
      data-studio-cut
      onKeyDown={onCutKeyDown}
      tabIndex={0}
    >
      <header className={styles.header}>
        <div>
          <p>{t(`${CUT_ROOT}.description`)}</p>
        </div>
        <div className={styles.headerActions}>
          <span className={styles.filmDuration}>
            <bdi>
              {projection.cut.filmDurationSeconds === null
                ? t(`${CUT_ROOT}.durationPending`)
                : t(`${CUT_ROOT}.filmDuration`, { seconds: projection.cut.filmDurationSeconds })}
            </bdi>
          </span>
          <Button disabled={locked} onClick={() => setAssetsVisible(true)}>
            {t(`${ASSETS_ROOT}.show`)}
          </Button>
        </div>
      </header>

      <div className={styles.hero} data-cut-hero>
        <div className={styles.playerColumn}>
          <CutPlayer
            ref={playerRef}
            onNavigationChange={setPlayback}
            pending={pending || busyKey !== null}
            projectId={projectId}
            projection={projection}
          />
        </div>
        <aside aria-labelledby={summaryTitleId} className={styles.summary} data-cut-summary>
          <div className={styles.film} data-cut-film data-film-delta={film.delta?.kind ?? 'unknown'}>
            <span className={styles.filmHeading} id={summaryTitleId}>
              {t(`${CUT_ROOT}.film.title`)}
            </span>
            {filmClock === null ? null : (
              <span className={styles.filmClock}>
                <bdi dir='auto'>{filmClock}</bdi>
              </span>
            )}
            <span className={styles.filmTarget}>
              <bdi dir='auto'>
                {targetClock === null
                  ? t(`${CUT_ROOT}.film.targetUnknown`)
                  : t(`${CUT_ROOT}.film.ofTarget`, { clock: targetClock })}
              </bdi>
            </span>
            {film.delta === null ? null : (
              <span className={styles.filmDelta}>
                <bdi dir='auto'>
                  {film.delta.kind === 'on_target'
                    ? t(`${CUT_ROOT}.film.onTarget`)
                    : t(`${CUT_ROOT}.film.${film.delta.kind}`, { clock: deltaClock })}
                </bdi>
              </span>
            )}
            <span className={styles.filmCounts}>
              <bdi dir='auto'>
                {t(`${CUT_ROOT}.film.counts`, {
                  beats: t(englishFallbackPluralKey(`${CUT_ROOT}.film.beatCount`, film.beatCount), {
                    count: film.beatCount,
                  }),
                  shots: t(englishFallbackPluralKey(`${CUT_ROOT}.shotCount`, film.shotCount), {
                    count: film.shotCount,
                  }),
                  slates: t(englishFallbackPluralKey(`${CUT_ROOT}.film.slateCount`, film.slateCount), {
                    count: film.slateCount,
                  }),
                })}
              </bdi>
            </span>
          </div>

          <div className={styles.joinControls} data-cut-join-controls role='group'>
            <Button
              aria-label={t(`${CUT_ROOT}.preview.previousJoin`)}
              data-cut-previous-join
              disabled={
                !playback.available || playback.joinCount === 0 || !playback.canStepPreviousJoin || playback.failed
              }
              onClick={() => playerRef.current?.stepJoin(-1)}
              size='small'
            >
              {t(`${CUT_ROOT}.preview.previousJoin`)}
            </Button>
            <Button
              aria-label={t(`${CUT_ROOT}.preview.nextJoin`)}
              data-cut-next-join
              disabled={!playback.available || playback.joinCount === 0 || !playback.canStepNextJoin || playback.failed}
              onClick={() => playerRef.current?.stepJoin(1)}
              size='small'
            >
              {t(`${CUT_ROOT}.preview.nextJoin`)}
            </Button>
            <Button
              aria-label={t(`${CUT_ROOT}.preview.loopJoin`)}
              aria-pressed={playback.loopJoinIndex !== null}
              data-cut-loop-join
              disabled={!playback.available || playback.joinCount === 0 || playback.failed}
              onClick={() => playerRef.current?.toggleJoinLoop()}
              size='small'
              type={playback.loopJoinIndex === null ? 'secondary' : 'primary'}
            >
              {t(`${CUT_ROOT}.preview.loopJoin`)}
            </Button>
          </div>

          {slates.length === 0 ? null : (
            <ul className={styles.slates}>
              {slates.map((slate) => (
                <li key={slate.beatId} className={styles.slate} data-cut-slate data-slate-beat-id={slate.beatId}>
                  <span className={styles.slateBadge}>
                    <bdi dir='auto'>{t(`${CUT_ROOT}.slate.label`, { label: slate.label })}</bdi>
                  </span>
                  <span className={styles.slateText}>
                    <bdi dir='auto'>{t(`${CUT_ROOT}.slate.warning`, { seconds: slate.durationSeconds })}</bdi>
                  </span>
                  <Button
                    aria-label={t(`${CUT_ROOT}.slate.openBeat`)}
                    onClick={() => onOpenBeat(slate.beatId)}
                    size='mini'
                  >
                    {t(`${CUT_ROOT}.slate.openBeat`)}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>

      {!canonicalOrderReady ? <Alert type='warning' content={t(`${CUT_ROOT}.orderUnavailable`)} /> : null}

      {projection.cut.beats.length === 0 ? (
        <p className={styles.empty}>{t(`${CUT_ROOT}.empty`)}</p>
      ) : (
        <>
          <div className={styles.filmstripShell}>
            <ol aria-label={t(`${CUT_ROOT}.railLabel`)} className={styles.rail} data-cut-filmstrip>
              {projection.cut.beats.map((beat, index) => {
                const title = beat.title.trim() || beat.id;
                const filmstripSegment = filmstripByBeatId.get(beat.id);
                const mutationLocked = locked || !canonicalOrderReady;
                const displayState =
                  displayStateByBeatId.get(beat.id) ??
                  (beat.durationKind === 'actual'
                    ? 'ready'
                    : beat.durationKind === 'target'
                      ? 'no_coverage'
                      : 'duration_pending');
                return (
                  <li
                    key={beat.id}
                    className={styles.beat}
                    data-beat-id={beat.id}
                    data-duration-kind={beat.durationKind}
                    data-selected={beat.id === selectedBeat?.id}
                    data-state={displayState}
                    style={filmstripSegment === undefined ? undefined : { flexGrow: filmstripSegment.growFactor }}
                    onDragOver={(event) => {
                      if (draggedBeatIdRef.current !== null && draggedBeatIdRef.current !== beat.id)
                        event.preventDefault();
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      const draggedBeatId = draggedBeatIdRef.current;
                      draggedBeatIdRef.current = null;
                      if (draggedBeatId !== null) void reorderBeat(draggedBeatId, index);
                    }}
                  >
                    <Button
                      ref={(node) => {
                        if (node === null) segmentRefs.current.delete(beat.id);
                        else if (node instanceof HTMLButtonElement) segmentRefs.current.set(beat.id, node);
                      }}
                      aria-pressed={beat.id === selectedBeat?.id}
                      className={styles.segmentButton}
                      draggable={!mutationLocked}
                      onClick={() => setSelectedBeatId(beat.id)}
                      onDragEnd={() => {
                        draggedBeatIdRef.current = null;
                      }}
                      onDragStart={(event) => {
                        draggedBeatIdRef.current = beat.id;
                        event.dataTransfer.effectAllowed = 'move';
                        event.dataTransfer.setData('text/plain', beat.id);
                      }}
                      onKeyDown={(event) => {
                        let destination: number | null = null;
                        if (event.key === 'ArrowUp') destination = index - 1;
                        else if (event.key === 'ArrowDown') destination = index + 1;
                        else if (event.key === 'Home') destination = 0;
                        else if (event.key === 'End') destination = beatOrder.length - 1;
                        if (destination === null) return;
                        event.preventDefault();
                        void reorderBeat(beat.id, destination);
                      }}
                    >
                      <span className={styles.segmentHeader}>
                        <span className={styles.ordinal} aria-hidden='true'>
                          <bdi>{filmstripSegment?.label ?? String(index + 1).padStart(2, '0')}</bdi>
                        </span>
                        <span className={styles.stateDot} aria-hidden='true' />
                      </span>
                      <span className={styles.beatTitle} dir='auto'>
                        {title}
                      </span>
                      <span className={styles.segmentDuration} data-duration-kind={beat.durationKind}>
                        <bdi>
                          {beat.durationSeconds === null
                            ? t(`${CUT_ROOT}.beatDurationPending`)
                            : t(`${CUT_ROOT}.filmstripDuration`, {
                                seconds: beat.durationSeconds,
                              })}
                        </bdi>
                      </span>
                      <span className={styles.srOnly}>
                        {t(`${CUT_ROOT}.beatPosition`, { position: index + 1, total: beatOrder.length })}
                      </span>
                      <span className={styles.srOnly}>{t(CUT_STATE_KEYS[displayState])}</span>
                    </Button>
                  </li>
                );
              })}
            </ol>
            <div className={styles.seekRail} data-cut-seek-rail>
              <Slider
                ref={setSeekSliderRoot}
                data-cut-seek
                disabled={!playback.available || playback.failed}
                max={playback.durationSeconds > 0 ? playback.durationSeconds : 1}
                min={0}
                onChange={(value) => {
                  if (typeof value === 'number') playerRef.current?.seek(value);
                }}
                step={0.1}
                value={playback.positionSeconds}
              />
              <span aria-hidden='true' className={styles.seekTicks}>
                {filmstripJoinMarks.map((join) => (
                  <span
                    key={join}
                    style={{
                      insetInlineStart: `${playback.durationSeconds > 0 ? (join / playback.durationSeconds) * 100 : 0}%`,
                    }}
                  />
                ))}
              </span>
            </div>
          </div>
          {selectedBeat === null ? null : (
            <div className={styles.filmstripSelection} data-cut-filmstrip-selection>
              <div className={styles.selectionIdentity}>
                <span className={styles.selectionPosition}>
                  <bdi>
                    {t(`${CUT_ROOT}.beatPosition`, {
                      position: selectedBeatIndex + 1,
                      total: beatOrder.length,
                    })}
                  </bdi>
                </span>
                <strong dir='auto'>{selectedBeat.title.trim() || selectedBeat.id}</strong>
                <span>
                  <bdi>
                    {t(englishFallbackPluralKey(`${CUT_ROOT}.shotCount`, selectedBeat.shotCount), {
                      count: selectedBeat.shotCount,
                    })}
                  </bdi>
                </span>
              </div>
              <div className={styles.selectionActions}>
                <Button onClick={() => onOpenBeat(selectedBeat.id)} size='small' type='primary'>
                  {t(`${CUT_ROOT}.openBeat`)}
                </Button>
                <Button
                  aria-label={t(`${CUT_ROOT}.moveEarlier`, { title: selectedBeat.title.trim() || selectedBeat.id })}
                  disabled={locked || !canonicalOrderReady || selectedBeatIndex === 0}
                  loading={busyKey === `beat:${selectedBeat.id}`}
                  onClick={() => void reorderBeat(selectedBeat.id, selectedBeatIndex - 1)}
                  size='small'
                >
                  {t(`${CUT_ROOT}.moveEarlier`, { title: selectedBeat.title.trim() || selectedBeat.id })}
                </Button>
                <Button
                  aria-label={t(`${CUT_ROOT}.moveLater`, { title: selectedBeat.title.trim() || selectedBeat.id })}
                  disabled={locked || !canonicalOrderReady || selectedBeatIndex === beatOrder.length - 1}
                  loading={busyKey === `beat:${selectedBeat.id}`}
                  onClick={() => void reorderBeat(selectedBeat.id, selectedBeatIndex + 1)}
                  size='small'
                >
                  {t(`${CUT_ROOT}.moveLater`, { title: selectedBeat.title.trim() || selectedBeat.id })}
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      <div className={styles.sections}>
        <section className={styles.panel}>
          <div className={styles.panelHeading}>
            <div>
              <h3>{t(`${CUT_ROOT}.bed.title`)}</h3>
              <p>{t(`${CUT_ROOT}.bed.description`)}</p>
            </div>
            <Button disabled={locked} loading={busyKey === 'bed:import'} onClick={() => void importBed()}>
              {t(`${CUT_ROOT}.bed.import`)}
            </Button>
          </div>
          {currentBed === null || projection.cut.filmDurationSeconds === null ? null : (
            <div
              className={styles.bedExtent}
              data-cut-bed-extent
              data-film-seconds={projection.cut.filmDurationSeconds}
              data-source-seconds={currentBed.durationSeconds}
            >
              <div className={styles.bedExtentCopy}>
                <strong>
                  <bdi>
                    {t(`${CUT_ROOT}.bed.option`, {
                      position: currentBed.position,
                      seconds: currentBed.durationSeconds,
                    })}
                  </bdi>
                </strong>
                <span>
                  <bdi>{t(`${CUT_ROOT}.bed.extent`, { seconds: currentBed.durationSeconds })}</bdi>
                </span>
                <span>{t(`${CUT_ROOT}.bed.silentPreview`)}</span>
              </div>
              <div aria-hidden='true' className={styles.bedExtentTrack}>
                <span
                  className={styles.bedSourceExtent}
                  data-bed-source-extent
                  style={{ inlineSize: `${bedSourcePercent}%` }}
                />
                <span
                  className={styles.bedFilmExtent}
                  data-bed-film-extent
                  style={{ inlineSize: `${bedFilmPercent}%` }}
                />
              </div>
            </div>
          )}
          <label>
            <span>{t(`${CUT_ROOT}.bed.label`)}</span>
            <Select
              allowClear
              aria-label={t(`${CUT_ROOT}.bed.label`)}
              disabled={locked}
              onChange={(value) => void chooseBed(value)}
              placeholder={t(`${CUT_ROOT}.bed.none`)}
              value={currentBedId ?? undefined}
            >
              {projection.cut.audioImports.map((asset) => (
                <Select.Option key={asset.assetId} value={asset.assetId}>
                  <bdi>
                    {t(`${CUT_ROOT}.bed.option`, {
                      position: asset.position,
                      seconds: asset.durationSeconds,
                    })}
                  </bdi>
                </Select.Option>
              ))}
            </Select>
          </label>
          {bedStatus.status === 'ready' ? (
            <p className={styles.status} data-bed-status='ready'>
              <bdi>
                {t(`${CUT_ROOT}.bed.fade`, {
                  sourceSeconds: bedStatus.sourceDurationSeconds,
                  startSeconds: bedStatus.fadeOutStartSeconds,
                  endSeconds: bedStatus.fadeOutEndSeconds,
                })}
              </bdi>
            </p>
          ) : bedStatus.status === 'too_short' ? (
            <Alert
              type='warning'
              content={t(`${CUT_ROOT}.bed.tooShort`, {
                sourceSeconds: bedStatus.sourceDurationSeconds,
                requiredSeconds: bedStatus.requiredDurationSeconds,
              })}
            />
          ) : bedStatus.status === 'duration_pending' ? (
            <Alert type='warning' content={t(`${CUT_ROOT}.bed.durationPending`)} />
          ) : bedStatus.status === 'invalid' ? (
            <Alert type='error' content={t(`${CUT_ROOT}.bed.invalid`)} />
          ) : (
            <p className={styles.status}>{t(`${CUT_ROOT}.bed.empty`)}</p>
          )}
        </section>

        <section className={styles.panel}>
          <div className={styles.panelHeading}>
            <div>
              <h3>{t(`${CUT_ROOT}.match.title`)}</h3>
              <p>{t(`${CUT_ROOT}.match.description`)}</p>
            </div>
          </div>
          <div
            aria-label={t(`${CUT_ROOT}.match.title`)}
            className={styles.matchThumbnails}
            data-cut-match-thumbnails
            role='group'
          >
            {projection.cut.matchCandidates.map((candidate) => {
              const thumbnailSource =
                candidate.coverAssetId === null ? null : createManagedStudioAssetUrl(projectId, candidate.coverAssetId);
              const label = t(`${CUT_ROOT}.match.option`, {
                beatTitle: candidate.beatTitle,
                line: candidate.line,
              });
              return (
                <Button
                  key={candidate.shotId}
                  aria-label={label}
                  aria-pressed={candidate.shotId === projection.cut.selectedMatchShotId}
                  className={styles.matchThumbnail}
                  data-match-shot-id={candidate.shotId}
                  disabled={locked}
                  onClick={() => void chooseMatch(candidate.shotId)}
                >
                  {thumbnailSource === null ? (
                    <span aria-hidden='true' className={styles.matchThumbnailPlaceholder} />
                  ) : (
                    <img alt='' aria-hidden='true' src={thumbnailSource} />
                  )}
                  <span dir='auto'>{candidate.line || candidate.shotId}</span>
                </Button>
              );
            })}
          </div>
          <label>
            <span>{t(`${CUT_ROOT}.match.label`)}</span>
            <Select
              allowClear
              aria-label={t(`${CUT_ROOT}.match.label`)}
              disabled={locked}
              onChange={(value) => void chooseMatch(value)}
              placeholder={t(`${CUT_ROOT}.match.none`)}
              value={projection.cut.selectedMatchShotId ?? undefined}
            >
              {projection.cut.matchCandidates.map((candidate) => (
                <Select.Option key={candidate.shotId} value={candidate.shotId}>
                  <span dir='auto'>
                    {t(`${CUT_ROOT}.match.option`, {
                      beatTitle: candidate.beatTitle,
                      line: candidate.line,
                    })}
                  </span>
                </Select.Option>
              ))}
            </Select>
          </label>
          {matchReference === null ? null : (
            <p className={styles.matchReference} data-cut-match-reference data-shot-id={matchReference.shotId}>
              <bdi dir='auto'>
                {t(`${CUT_ROOT}.match.reference`, {
                  beat: matchReference.beatLabel,
                  shot: matchReference.shotLabel,
                })}
              </bdi>
            </p>
          )}
          {projection.cut.matchSelectionInvalid ? (
            <Alert type='warning' content={t(`${CUT_ROOT}.match.invalid`)} />
          ) : null}
        </section>
      </div>

      <section className={styles.exports}>
        <div className={styles.panelHeading}>
          <div>
            <h3>{t(`${CUT_ROOT}.exports.title`)}</h3>
            <p>{t(`${CUT_ROOT}.exports.description`)}</p>
          </div>
          <Button disabled={locked} loading={busyKey === 'exports:refresh'} onClick={() => void refreshExports()}>
            {t(`${CUT_ROOT}.exports.refresh`)}
          </Button>
        </div>
        {exportErrorMessageKey === null ? null : <Alert type='warning' content={t(exportErrorMessageKey)} />}
        {exportCatalog === null ? <p className={styles.status}>{t(`${CUT_ROOT}.exports.catalogUnavailable`)}</p> : null}
        <div className={styles.exportGrid}>
          <article className={styles.exportCard} data-export-shape='editor_folder'>
            <h4>{t(`${CUT_ROOT}.exports.editorFolderTitle`)}</h4>
            <p>{t(`${CUT_ROOT}.exports.editorFolderDescription`)}</p>
            <Button
              disabled={locked || exportCatalog === null}
              loading={busyKey === 'export:editor_folder'}
              onClick={() => void createExport({ shape: 'editor_folder' })}
              type='primary'
            >
              {t(`${CUT_ROOT}.exports.createEditorFolder`)}
            </Button>
          </article>
          <article className={styles.exportCard} data-export-shape='still'>
            <h4>{t(`${CUT_ROOT}.exports.stillTitle`)}</h4>
            <p>{t(`${CUT_ROOT}.exports.stillDescription`)}</p>
            <label>
              <span>{t(`${CUT_ROOT}.exports.stillLabel`)}</span>
              <Select
                aria-label={t(`${CUT_ROOT}.exports.stillLabel`)}
                disabled={locked || stillCandidates.length === 0}
                onChange={(value) => {
                  setStillShotId(
                    typeof value === 'string' && stillCandidates.some((candidate) => candidate.shotId === value)
                      ? value
                      : null
                  );
                }}
                placeholder={t(`${CUT_ROOT}.exports.noStill`)}
                value={stillShotId ?? undefined}
              >
                {stillCandidates.map((candidate) => (
                  <Select.Option key={candidate.shotId} value={candidate.shotId}>
                    <span dir='auto'>{candidate.line || candidate.shotId}</span>
                  </Select.Option>
                ))}
              </Select>
            </label>
            <Button
              disabled={locked || exportCatalog === null || stillShotId === null}
              loading={busyKey === 'export:still'}
              onClick={() => {
                if (stillShotId !== null) void createExport({ shape: 'still', shotId: stillShotId });
              }}
              type='primary'
            >
              {t(`${CUT_ROOT}.exports.createStill`)}
            </Button>
          </article>
          <article className={styles.exportCard} data-export-shape='script'>
            <h4>{t(`${CUT_ROOT}.exports.scriptTitle`)}</h4>
            <p>{t(`${CUT_ROOT}.exports.scriptDescription`)}</p>
            <Button
              disabled={locked || exportCatalog === null}
              loading={busyKey === 'export:script'}
              onClick={() => void createExport({ shape: 'script' })}
              type='primary'
            >
              {t(`${CUT_ROOT}.exports.createScript`)}
            </Button>
          </article>
        </div>
      </section>

      <Drawer
        footer={<Button onClick={() => setAssetsVisible(false)}>{t(`${ASSETS_ROOT}.close`)}</Button>}
        onCancel={() => setAssetsVisible(false)}
        title={t(`${ASSETS_ROOT}.title`)}
        visible={assetsVisible}
        width={560}
      >
        <div className={styles.drawerContent} data-studio-assets-drawer>
          <p>{t(`${ASSETS_ROOT}.description`)}</p>
          <section>
            <h3>{t(`${ASSETS_ROOT}.audioTitle`)}</h3>
            {projection.cut.audioImports.length === 0 ? (
              <p>{t(`${ASSETS_ROOT}.audioEmpty`)}</p>
            ) : (
              <ul className={styles.assetList}>
                {projection.cut.audioImports.map((asset) => {
                  const selected = asset.assetId === currentBedId;
                  return (
                    <li key={asset.assetId} data-audio-position={asset.position}>
                      <div>
                        <strong>
                          <bdi>{t(`${ASSETS_ROOT}.audioItem`, { position: asset.position })}</bdi>
                        </strong>
                        <p>
                          <bdi>
                            {t(`${ASSETS_ROOT}.audioFacts`, {
                              seconds: asset.durationSeconds,
                              bytes: asset.byteSize,
                            })}
                          </bdi>
                        </p>
                        {selected ? <span>{t(`${ASSETS_ROOT}.selectedBed`)}</span> : null}
                      </div>
                      <Popconfirm
                        cancelText={t(`${ASSETS_ROOT}.cancel`)}
                        content={t(`${ASSETS_ROOT}.detachContent`)}
                        disabled={locked || selected}
                        okText={t(`${ASSETS_ROOT}.detach`)}
                        onOk={() => detachAudio(asset.assetId)}
                        title={t(`${ASSETS_ROOT}.detachTitle`)}
                      >
                        <Button
                          disabled={locked || selected}
                          loading={busyKey === `detach:${asset.assetId}`}
                          status='danger'
                        >
                          {t(`${ASSETS_ROOT}.detach`)}
                        </Button>
                      </Popconfirm>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
          <section>
            <h3>{t(`${ASSETS_ROOT}.exportsTitle`)}</h3>
            {exportCatalog === null || exportCatalog.artifacts.length === 0 ? (
              <p>{t(`${ASSETS_ROOT}.exportsEmpty`)}</p>
            ) : (
              <ul className={styles.assetList}>
                {exportCatalog.artifacts.map((artifact) => (
                  <li key={artifact.id} data-export-artifact-id={artifact.id}>
                    <div>
                      <strong>{t(exportShapeKey(artifact.shape))}</strong>
                      <p>
                        <bdi>
                          {t(`${ASSETS_ROOT}.exportFacts`, {
                            bytes: artifact.byteSize,
                            count: artifact.fileCount,
                            revision: artifact.sourceRevision,
                          })}
                        </bdi>
                      </p>
                    </div>
                    <div className={styles.assetActions}>
                      <Button
                        disabled={locked}
                        loading={busyKey === `copy:${artifact.id}`}
                        onClick={() => void copyExport(artifact.id)}
                      >
                        {t(`${ASSETS_ROOT}.copy`)}
                      </Button>
                      <Button
                        disabled={locked}
                        loading={busyKey === `reveal:${artifact.id}`}
                        onClick={() => void revealExport(artifact.id)}
                      >
                        {t(`${ASSETS_ROOT}.reveal`)}
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </Drawer>

      <span aria-atomic='true' aria-live='polite' className={styles.srOnly}>
        {announcement}
      </span>
    </section>
  );
};
