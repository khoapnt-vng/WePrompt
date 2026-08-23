/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button } from '@arco-design/web-react';
import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { createManagedStudioAssetUrl } from '@/renderer/pages/studio/studioManagedAssetUrl';

import type { WorkspaceShotProjection } from '../workspaceProjection';
import styles from './BeatPanel.module.css';
import {
  COVERAGE_TRIM_STEP_SECONDS,
  buildCoverageGeometry,
  clampCoverageTrim,
  coverageDensityForWidth,
  coveragePlanningPairBounds,
  coveragePointerDeltaSeconds,
  coverageSeekLaneRatio,
  coverageSeekPositionSeconds,
  maximumCoverageTrim,
  resizeCoveragePlanningPair,
  type CoveragePlanningPairChange,
} from './coverageGeometry';
import { formatBeatPlaybackClock } from './beatPlaybackSequence';

const COVERAGE_KEY_ROOT = 'conversation.creativeStudio.workspace.beatPanel.coverage';

export type CoverageBarProps = {
  projectId: string;
  shots: readonly WorkspaceShotProjection[];
  disabled: boolean;
  inspectedShotId: string | null;
  playback?: CoveragePlayback;
  onCommitPlanningDurations: (changes: CoveragePlanningPairChange) => Promise<boolean>;
  onCommitTrim: (shotId: string, trimInSeconds: number | null, trimOutSeconds: number | null) => Promise<boolean>;
  onInspectShot: (shotId: string) => void;
};

export type CoveragePlayback = {
  available: boolean;
  durationSeconds: number;
  positionSeconds: number;
  onSeek: (positionSeconds: number) => void;
};

type PlanningPreview = Record<string, number>;
type TrimPreview = { shotId: string; trimInSeconds: number; trimOutSeconds: number };

type BoundaryDrag = {
  kind: 'boundary';
  pointerId: number;
  target: HTMLButtonElement;
  startClientX: number;
  trackWidthPixels: number;
  planningTotalSeconds: number;
  rtl: boolean;
  leftShotId: string;
  rightShotId: string;
  leftDurationSeconds: number;
  rightDurationSeconds: number;
  latest: CoveragePlanningPairChange;
};

type TrimDrag = {
  kind: 'trim';
  pointerId: number;
  target: HTMLButtonElement;
  startClientX: number;
  segmentWidthPixels: number;
  sourceDurationSeconds: number;
  rtl: boolean;
  edge: 'in' | 'out';
  shotId: string;
  trimInSeconds: number;
  trimOutSeconds: number;
  latest: TrimPreview;
};

type CoverageDrag = BoundaryDrag | TrimDrag;

type SeekDrag = {
  pointerId: number;
  target: HTMLButtonElement;
};

const asNullableTrim = (value: number): number | null => (value === 0 ? null : value);

const releasePointer = (drag: Pick<CoverageDrag, 'pointerId' | 'target'>): void => {
  try {
    if (drag.target.hasPointerCapture?.(drag.pointerId)) drag.target.releasePointerCapture?.(drag.pointerId);
  } catch {
    // Losing capture is safe: the preview is either committed explicitly or discarded.
  }
};

const isRtl = (element: Element | null): boolean =>
  element !== null && typeof window !== 'undefined' && window.getComputedStyle(element).direction === 'rtl';

/** Displays played media and the distinct, helper-authored planning overlay. */
export const CoverageBar: React.FC<CoverageBarProps> = ({
  projectId,
  shots,
  disabled,
  inspectedShotId,
  playback,
  onCommitPlanningDurations,
  onCommitTrim,
  onInspectShot,
}) => {
  const { t } = useTranslation();
  const guidanceId = useId();
  const trimGuidanceId = `${guidanceId}-trim`;
  const boundaryGuidanceId = `${guidanceId}-boundary`;
  const seekGuidanceId = `${guidanceId}-seek`;
  const playbackTrackRef = useRef<HTMLDivElement | null>(null);
  const planningTrackRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<CoverageDrag | null>(null);
  const seekDragRef = useRef<SeekDrag | null>(null);
  const [barWidthPixels, setBarWidthPixels] = useState(0);
  const [planningPreview, setPlanningPreview] = useState<PlanningPreview | null>(null);
  const [trimPreview, setTrimPreview] = useState<TrimPreview | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const geometry = useMemo(() => buildCoverageGeometry(shots), [shots]);
  const coverageReady = shots.length > 0 && geometry !== null;
  const shotFingerprint = shots
    .map((shot) =>
      [
        shot.id,
        shot.durationSeconds,
        shot.selectedTakeId,
        shot.selectedTakeSourceDurationSeconds,
        shot.trimInSeconds,
        shot.trimOutSeconds,
      ].join(':')
    )
    .join('|');

  useEffect(() => {
    const node = playbackTrackRef.current;
    if (node === null) return;
    const measure = (): void => {
      const width = node.getBoundingClientRect().width;
      if (Number.isFinite(width) && width >= 0) setBarWidthPixels(width);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (typeof width === 'number' && Number.isFinite(width) && width >= 0) setBarWidthPixels(width);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [coverageReady]);

  useEffect(() => {
    if (dragRef.current !== null) releasePointer(dragRef.current);
    dragRef.current = null;
    setPlanningPreview(null);
    setTrimPreview(null);
  }, [shotFingerprint]);

  useEffect(() => {
    const drag = seekDragRef.current;
    if (drag !== null) releasePointer(drag);
    seekDragRef.current = null;
  }, [playback?.available, playback?.durationSeconds]);

  const segmentStateCopy = (shot: WorkspaceShotProjection): string => {
    const state = shot.segmentState;
    switch (state.kind) {
      case 'status_pending':
        return t(`${COVERAGE_KEY_ROOT}.segmentState.statusPending`);
      case 'no_take':
        return t(`${COVERAGE_KEY_ROOT}.segmentState.noTake`);
      case 'queued':
        return t(`${COVERAGE_KEY_ROOT}.segmentState.queued`);
      case 'waiting_on_shot':
        return t(`${COVERAGE_KEY_ROOT}.segmentState.waitingOnShot`, {
          position: String(state.upstreamShotNumber).padStart(2, '0'),
        });
      case 'waiting_on_frame':
        return t(`${COVERAGE_KEY_ROOT}.segmentState.waitingOnFrame`);
      case 'rendering':
        if (state.progressPercent !== null) {
          return t(`${COVERAGE_KEY_ROOT}.segmentState.renderingProgress`, {
            progress: state.progressPercent,
          });
        }
        return t(`${COVERAGE_KEY_ROOT}.segmentState.${state.showingStill ? 'renderingStill' : 'rendering'}`);
      case 'rendered':
        if (state.takeCount === 1) return t(`${COVERAGE_KEY_ROOT}.segmentState.renderedOneTake`);
        if (state.takeCount > 1 && state.selectedTakeNumber !== null) {
          return t(`${COVERAGE_KEY_ROOT}.segmentState.selectedTake`, {
            count: state.takeCount,
            take: state.selectedTakeNumber,
          });
        }
        return t(`${COVERAGE_KEY_ROOT}.segmentState.rendered`);
      case 'needs_rerender':
        return t(`${COVERAGE_KEY_ROOT}.segmentState.needsRerender`);
      case 'stale':
        return t(`${COVERAGE_KEY_ROOT}.segmentState.staleStillPlays`);
      case 'failed_unbilled':
        return t(`${COVERAGE_KEY_ROOT}.segmentState.failedNotBilled`);
      case 'never_dispatched':
        return t(`${COVERAGE_KEY_ROOT}.segmentState.neverDispatched`);
      case 'needs_attention':
        return t(`${COVERAGE_KEY_ROOT}.segmentState.needsAttention`);
    }
  };

  const segmentState = (shot: WorkspaceShotProjection, copy = segmentStateCopy(shot)): React.ReactNode => (
    <span className={styles.segmentState} data-segment-state={shot.segmentState.kind}>
      {copy}
    </span>
  );

  const boundaryMarker = (index: number): React.ReactNode => {
    const upstream = shots[index];
    const dependent = shots[index + 1];
    if (upstream === undefined || dependent === undefined) return null;

    const boundary = dependent.frameBoundary;
    const exactBoundary =
      !dependent.segmentHead &&
      boundary !== null &&
      boundary.upstreamShotId === upstream.id &&
      boundary.dependentShotId === dependent.id
        ? boundary
        : null;
    if (!dependent.segmentHead && exactBoundary === null) return null;

    const staleBoundary =
      !dependent.segmentHead &&
      (upstream.dirtyCauses.includes('generation_out_of_date') || dependent.dirtyCauses.includes('continuity_stale'));
    const source =
      !staleBoundary && exactBoundary?.status === 'on_disk'
        ? createManagedStudioAssetUrl(projectId, exactBoundary.frameAssetId)
        : null;
    const status =
      dependent.segmentHead || staleBoundary
        ? 'gone'
        : exactBoundary?.status === 'on_disk' && source === null
          ? 'gone'
          : exactBoundary?.status;
    if (status === undefined) return null;
    const copyKey = staleBoundary ? 'stale' : status === 'on_disk' ? 'ready' : status;
    return (
      <span
        aria-label={t(`${COVERAGE_KEY_ROOT}.boundaryFrame.${copyKey}`, {
          position: String(index + 1).padStart(2, '0'),
        })}
        className={styles.boundaryFrame}
        data-boundary-after-shot-id={upstream.id}
        data-boundary-frame={status}
        role='img'
      >
        {status === 'on_disk' && source !== null ? <img alt='' aria-hidden='true' src={source} /> : null}
      </span>
    );
  };

  if (shots.length === 0) {
    return (
      <section aria-label={t(`${COVERAGE_KEY_ROOT}.label`)} className={styles.coverageRoot} data-beat-coverage>
        <p className={styles.muted} role='status'>
          {t(`${COVERAGE_KEY_ROOT}.empty`)}
        </p>
      </section>
    );
  }

  if (geometry === null) {
    return (
      <section aria-label={t(`${COVERAGE_KEY_ROOT}.label`)} className={styles.coverageRoot} data-beat-coverage>
        <p className={styles.warning} role='alert'>
          {t(`${COVERAGE_KEY_ROOT}.unavailable`)}
        </p>
        <div
          aria-label={t(`${COVERAGE_KEY_ROOT}.playbackLane`)}
          className={styles.playbackTrack}
          data-density='narrow'
          data-testid='studio-coverage-playback'
          role='group'
        >
          {shots.map((shot, index) => {
            const shotCopy = t(`${COVERAGE_KEY_ROOT}.shotLabel`, { index: index + 1 });
            const stateCopy = segmentStateCopy(shot);
            return (
              <div
                key={shot.id}
                className={styles.playbackSegment}
                data-selected-take='false'
                data-shot-id={shot.id}
                style={{ flexBasis: 0, flexGrow: 1 }}
              >
                <Button
                  aria-label={`${shotCopy} · ${stateCopy}`}
                  aria-pressed={inspectedShotId === shot.id}
                  className={styles.segmentSelector}
                  data-coverage-shot-selector
                  onClick={() => onInspectShot(shot.id)}
                  type='text'
                >
                  <span className={styles.segmentLabel}>{shotCopy}</span>
                  <span className={styles.segmentMeta}>{segmentState(shot, stateCopy)}</span>
                </Button>
                {boundaryMarker(index)}
              </div>
            );
          })}
        </div>
      </section>
    );
  }

  const displayPlaybackWidths = geometry.segments.map((segment) =>
    segment.selectedTake
      ? segment.playbackWidthSeconds
      : (planningPreview?.[segment.shotId] ?? segment.playbackWidthSeconds)
  );
  const playbackTotal = displayPlaybackWidths.reduce((sum, seconds) => sum + seconds, 0);
  const density = coverageDensityForWidth(barWidthPixels, displayPlaybackWidths);

  const announceBoundary = (changes: CoveragePlanningPairChange): void => {
    setAnnouncement(
      t(`${COVERAGE_KEY_ROOT}.boundaryAnnouncement`, {
        leftSeconds: changes[0].durationSeconds,
        rightSeconds: changes[1].durationSeconds,
      })
    );
  };

  const commitBoundary = async (changes: CoveragePlanningPairChange): Promise<void> => {
    announceBoundary(changes);
    await onCommitPlanningDurations(changes);
    setPlanningPreview(null);
  };

  const beginBoundaryDrag = (event: React.PointerEvent<HTMLButtonElement>, index: number): void => {
    if (disabled) return;
    const left = geometry.segments[index];
    const right = geometry.segments[index + 1];
    const track = planningTrackRef.current;
    if (left === undefined || right === undefined || track === null) return;
    const width = track.getBoundingClientRect().width;
    if (!Number.isFinite(width) || width <= 0) return;
    const initial = resizeCoveragePlanningPair({
      leftShotId: left.shotId,
      leftDurationSeconds: planningPreview?.[left.shotId] ?? left.planningDurationSeconds,
      rightShotId: right.shotId,
      rightDurationSeconds: planningPreview?.[right.shotId] ?? right.planningDurationSeconds,
      deltaSeconds: 0,
    });
    if (initial === null) return;
    event.preventDefault();
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      // Window-level fallback is unnecessary because the canonical value remains unchanged.
    }
    dragRef.current = {
      kind: 'boundary',
      pointerId: event.pointerId,
      target: event.currentTarget,
      startClientX: event.clientX,
      trackWidthPixels: width,
      planningTotalSeconds: geometry.planningTotalSeconds,
      rtl: isRtl(track),
      leftShotId: initial[0].shotId,
      rightShotId: initial[1].shotId,
      leftDurationSeconds: initial[0].durationSeconds,
      rightDurationSeconds: initial[1].durationSeconds,
      latest: initial,
    };
  };

  const moveBoundaryDrag = (event: React.PointerEvent<HTMLButtonElement>): void => {
    const drag = dragRef.current;
    if (drag?.kind !== 'boundary' || drag.pointerId !== event.pointerId) return;
    const deltaSeconds = coveragePointerDeltaSeconds({
      clientX: event.clientX,
      startClientX: drag.startClientX,
      trackWidthPixels: drag.trackWidthPixels,
      trackSeconds: drag.planningTotalSeconds,
      rtl: drag.rtl,
    });
    if (deltaSeconds === null) return;
    const next = resizeCoveragePlanningPair({
      leftShotId: drag.leftShotId,
      leftDurationSeconds: drag.leftDurationSeconds,
      rightShotId: drag.rightShotId,
      rightDurationSeconds: drag.rightDurationSeconds,
      deltaSeconds,
    });
    if (next === null) return;
    drag.latest = next;
    setPlanningPreview({ [next[0].shotId]: next[0].durationSeconds, [next[1].shotId]: next[1].durationSeconds });
  };

  const finishBoundaryDrag = (event: React.PointerEvent<HTMLButtonElement>, commit: boolean): void => {
    const drag = dragRef.current;
    if (drag?.kind !== 'boundary' || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    releasePointer(drag);
    const changed =
      drag.latest[0].durationSeconds !== drag.leftDurationSeconds ||
      drag.latest[1].durationSeconds !== drag.rightDurationSeconds;
    if (commit && changed) void commitBoundary(drag.latest);
    else setPlanningPreview(null);
  };

  const boundaryKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number): void => {
    if (disabled) return;
    const left = geometry.segments[index];
    const right = geometry.segments[index + 1];
    if (left === undefined || right === undefined) return;
    const rtl = isRtl(planningTrackRef.current);
    let delta: number;
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') delta = event.key === 'ArrowRight' && rtl ? -1 : 1;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') delta = event.key === 'ArrowLeft' && rtl ? 1 : -1;
    else if (event.key === 'Home') delta = Number.MIN_SAFE_INTEGER;
    else if (event.key === 'End') delta = Number.MAX_SAFE_INTEGER;
    else return;
    event.preventDefault();
    const next = resizeCoveragePlanningPair({
      leftShotId: left.shotId,
      leftDurationSeconds: left.planningDurationSeconds,
      rightShotId: right.shotId,
      rightDurationSeconds: right.planningDurationSeconds,
      deltaSeconds: delta,
    });
    if (next !== null && next[0].durationSeconds !== left.planningDurationSeconds) void commitBoundary(next);
  };

  const beginTrimDrag = (
    event: React.PointerEvent<HTMLButtonElement>,
    shot: WorkspaceShotProjection,
    edge: 'in' | 'out'
  ): void => {
    if (disabled || shot.selectedTakeSourceDurationSeconds === null) return;
    const segment = event.currentTarget.parentElement;
    const width = segment?.getBoundingClientRect().width ?? 0;
    if (!Number.isFinite(width) || width <= 0) return;
    const current =
      trimPreview?.shotId === shot.id
        ? trimPreview
        : { shotId: shot.id, trimInSeconds: shot.trimInSeconds ?? 0, trimOutSeconds: shot.trimOutSeconds ?? 0 };
    event.preventDefault();
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      // A failed capture only discards the local preview on cancellation.
    }
    dragRef.current = {
      kind: 'trim',
      pointerId: event.pointerId,
      target: event.currentTarget,
      startClientX: event.clientX,
      segmentWidthPixels: width,
      sourceDurationSeconds: shot.selectedTakeSourceDurationSeconds,
      rtl: isRtl(segment),
      edge,
      shotId: shot.id,
      trimInSeconds: current.trimInSeconds,
      trimOutSeconds: current.trimOutSeconds,
      latest: current,
    };
  };

  const moveTrimDrag = (event: React.PointerEvent<HTMLButtonElement>): void => {
    const drag = dragRef.current;
    if (drag?.kind !== 'trim' || drag.pointerId !== event.pointerId) return;
    const physicalDelta = coveragePointerDeltaSeconds({
      clientX: event.clientX,
      startClientX: drag.startClientX,
      trackWidthPixels: drag.segmentWidthPixels,
      trackSeconds: drag.sourceDurationSeconds,
      rtl: drag.rtl,
    });
    if (physicalDelta === null) return;
    const requested = drag.edge === 'in' ? drag.trimInSeconds + physicalDelta : drag.trimOutSeconds - physicalDelta;
    const value = clampCoverageTrim({
      sourceDurationSeconds: drag.sourceDurationSeconds,
      oppositeTrimSeconds: drag.edge === 'in' ? drag.trimOutSeconds : drag.trimInSeconds,
      requestedTrimSeconds: requested,
    });
    if (value === null) return;
    drag.latest = {
      shotId: drag.shotId,
      trimInSeconds: drag.edge === 'in' ? value : drag.trimInSeconds,
      trimOutSeconds: drag.edge === 'out' ? value : drag.trimOutSeconds,
    };
    setTrimPreview(drag.latest);
  };

  const commitTrim = async (preview: TrimPreview): Promise<void> => {
    setAnnouncement(
      t(`${COVERAGE_KEY_ROOT}.trimAnnouncement`, {
        trimInSeconds: preview.trimInSeconds,
        trimOutSeconds: preview.trimOutSeconds,
      })
    );
    await onCommitTrim(preview.shotId, asNullableTrim(preview.trimInSeconds), asNullableTrim(preview.trimOutSeconds));
    setTrimPreview(null);
  };

  const finishTrimDrag = (event: React.PointerEvent<HTMLButtonElement>, commit: boolean): void => {
    const drag = dragRef.current;
    if (drag?.kind !== 'trim' || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    releasePointer(drag);
    const changed =
      drag.latest.trimInSeconds !== drag.trimInSeconds || drag.latest.trimOutSeconds !== drag.trimOutSeconds;
    if (commit && changed) void commitTrim(drag.latest);
    else setTrimPreview(null);
  };

  const trimKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    shot: WorkspaceShotProjection,
    edge: 'in' | 'out'
  ): void => {
    const source = shot.selectedTakeSourceDurationSeconds;
    if (disabled || source === null) return;
    const currentIn = shot.trimInSeconds ?? 0;
    const currentOut = shot.trimOutSeconds ?? 0;
    const rtl = isRtl(event.currentTarget.parentElement);
    let requested: number;
    const current = edge === 'in' ? currentIn : currentOut;
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
      requested =
        current + (event.key === 'ArrowRight' && rtl ? -COVERAGE_TRIM_STEP_SECONDS : COVERAGE_TRIM_STEP_SECONDS);
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
      requested =
        current + (event.key === 'ArrowLeft' && rtl ? COVERAGE_TRIM_STEP_SECONDS : -COVERAGE_TRIM_STEP_SECONDS);
    } else if (event.key === 'Home') requested = 0;
    else if (event.key === 'End') requested = Number.MAX_SAFE_INTEGER;
    else return;
    event.preventDefault();
    const value = clampCoverageTrim({
      sourceDurationSeconds: source,
      oppositeTrimSeconds: edge === 'in' ? currentOut : currentIn,
      requestedTrimSeconds: requested,
    });
    if (value === null || value === current) return;
    void commitTrim({
      shotId: shot.id,
      trimInSeconds: edge === 'in' ? value : currentIn,
      trimOutSeconds: edge === 'out' ? value : currentOut,
    });
  };

  const seekAvailable =
    playback?.available === true &&
    Number.isFinite(playback.durationSeconds) &&
    playback.durationSeconds > 0 &&
    Number.isFinite(playback.positionSeconds) &&
    Math.abs(
      playback.durationSeconds - geometry.segments.reduce((sum, segment) => sum + segment.playedDurationSeconds, 0)
    ) <=
      Number.EPSILON * 8 * Math.max(1, playback.durationSeconds);
  const seekPositionSeconds = seekAvailable
    ? Math.min(playback.durationSeconds, Math.max(0, playback.positionSeconds))
    : 0;
  const seekFromPointer = (event: React.PointerEvent<HTMLButtonElement>): void => {
    if (!seekAvailable || playback === undefined) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const position = coverageSeekPositionSeconds({
      clientX: event.clientX,
      trackLeftPixels: rect.left,
      trackWidthPixels: rect.width,
      geometry,
      rtl: isRtl(event.currentTarget),
    });
    if (position !== null) playback.onSeek(position);
  };
  const beginSeek = (event: React.PointerEvent<HTMLButtonElement>): void => {
    if (!seekAvailable) return;
    event.preventDefault();
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      // The initial seek is still authoritative when pointer capture is unavailable.
    }
    seekDragRef.current = { pointerId: event.pointerId, target: event.currentTarget };
    seekFromPointer(event);
  };
  const moveSeek = (event: React.PointerEvent<HTMLButtonElement>): void => {
    if (seekDragRef.current?.pointerId !== event.pointerId) return;
    seekFromPointer(event);
  };
  const finishSeek = (event: React.PointerEvent<HTMLButtonElement>, commit: boolean): void => {
    const drag = seekDragRef.current;
    if (drag?.pointerId !== event.pointerId) return;
    seekDragRef.current = null;
    releasePointer(drag);
    if (commit) seekFromPointer(event);
  };
  const seekKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>): void => {
    if (!seekAvailable || playback === undefined) return;
    const step = event.shiftKey ? 0.2 : 1;
    const rtl = isRtl(event.currentTarget);
    let next: number;
    if (event.key === 'ArrowRight') next = seekPositionSeconds + (rtl ? -step : step);
    else if (event.key === 'ArrowLeft') next = seekPositionSeconds + (rtl ? step : -step);
    else if (event.key === 'ArrowUp') next = seekPositionSeconds + step;
    else if (event.key === 'ArrowDown') next = seekPositionSeconds - step;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = playback.durationSeconds;
    else return;
    event.preventDefault();
    event.stopPropagation();
    playback.onSeek(Math.min(playback.durationSeconds, Math.max(0, next)));
  };

  const seekCurrentClock = formatBeatPlaybackClock(seekPositionSeconds, playback?.durationSeconds ?? 0) ?? '0:00';
  const seekTotalClock =
    formatBeatPlaybackClock(playback?.durationSeconds ?? 0, playback?.durationSeconds ?? 0) ?? '0:00';
  const seekLaneRatio = coverageSeekLaneRatio(geometry, seekPositionSeconds) ?? 0;

  return (
    <section aria-label={t(`${COVERAGE_KEY_ROOT}.label`)} className={styles.coverageRoot} data-beat-coverage>
      <div className={styles.coverageGuidance}>
        <span className={styles.trimGuidance} id={trimGuidanceId}>
          {t(`${COVERAGE_KEY_ROOT}.trimGuidance`)}
        </span>
        <span className={styles.boundaryGuidance} id={boundaryGuidanceId}>
          {t(`${COVERAGE_KEY_ROOT}.boundaryGuidance`)}
        </span>
        <span className={styles.seekGuidance} id={seekGuidanceId}>
          {t(`${COVERAGE_KEY_ROOT}.seekGuidance`)}
        </span>
      </div>
      <div className={styles.playbackSurface}>
        <div
          ref={playbackTrackRef}
          aria-label={t(`${COVERAGE_KEY_ROOT}.playbackLane`)}
          className={styles.playbackTrack}
          data-density={density}
          data-testid='studio-coverage-playback'
          role='group'
        >
          {geometry.segments.map((segment, index) => {
            const shot = shots[index]!;
            const widthSeconds = displayPlaybackWidths[index]!;
            const preview = trimPreview?.shotId === shot.id ? trimPreview : null;
            const trimInSeconds = preview?.trimInSeconds ?? shot.trimInSeconds ?? 0;
            const trimOutSeconds = preview?.trimOutSeconds ?? shot.trimOutSeconds ?? 0;
            const sourceDurationSeconds = segment.playbackWidthSeconds;
            const playedEndSeconds = sourceDurationSeconds - trimOutSeconds;
            const hasContinuitySuccessor = shots[index + 1] !== undefined && shots[index + 1]!.segmentHead === false;
            const tailWarning = segment.selectedTake && hasContinuitySuccessor && trimOutSeconds > 0;
            const tailWarningId = tailWarning ? `${guidanceId}-tail-${index}` : undefined;
            const maximumIn = maximumCoverageTrim(sourceDurationSeconds, trimOutSeconds) ?? 0;
            const maximumOut = maximumCoverageTrim(sourceDurationSeconds, trimInSeconds) ?? 0;
            const shotCopy = t(`${COVERAGE_KEY_ROOT}.shotLabel`, { index: index + 1 });
            const durationCopy = t(
              segment.selectedTake ? `${COVERAGE_KEY_ROOT}.sourceDuration` : `${COVERAGE_KEY_ROOT}.planningDuration`,
              { seconds: widthSeconds }
            );
            const stateCopy = segmentStateCopy(shot);
            return (
              <div
                key={segment.shotId}
                className={styles.playbackSegment}
                data-selected-take={segment.selectedTake}
                data-shot-id={segment.shotId}
                style={{ flexBasis: 0, flexGrow: widthSeconds / playbackTotal }}
              >
                <Button
                  aria-describedby={tailWarningId}
                  aria-label={`${shotCopy} · ${durationCopy} · ${stateCopy}`}
                  aria-pressed={inspectedShotId === shot.id}
                  className={styles.segmentSelector}
                  data-coverage-shot-selector
                  onClick={() => onInspectShot(shot.id)}
                  type='text'
                >
                  <span className={styles.segmentLabel}>{shotCopy}</span>
                  <span className={styles.segmentDuration}>
                    <bdi>{durationCopy}</bdi>
                  </span>
                  <span className={styles.segmentMeta}>{segmentState(shot, stateCopy)}</span>
                </Button>
                {tailWarning ? (
                  <span className={styles.trimWarning} id={tailWarningId} role='status'>
                    {t(`${COVERAGE_KEY_ROOT}.tailTrimWarning`)}
                  </span>
                ) : null}
                {segment.selectedTake ? (
                  <div className={styles.trimLane} data-coverage-trim-lane>
                    <span
                      aria-hidden='true'
                      className={styles.playedRange}
                      style={{
                        insetInlineStart: `${(trimInSeconds / sourceDurationSeconds) * 100}%`,
                        inlineSize: `${((playedEndSeconds - trimInSeconds) / sourceDurationSeconds) * 100}%`,
                      }}
                    />
                    <Button
                      aria-describedby={trimGuidanceId}
                      aria-disabled={disabled}
                      aria-label={t(`${COVERAGE_KEY_ROOT}.trimInLabel`, { index: index + 1 })}
                      aria-orientation='horizontal'
                      aria-valuemax={maximumIn}
                      aria-valuemin={0}
                      aria-valuenow={trimInSeconds}
                      aria-valuetext={t(`${COVERAGE_KEY_ROOT}.trimValue`, {
                        seconds: trimInSeconds,
                      })}
                      className={`${styles.trimHandle} ${styles.trimInHandle}`}
                      disabled={disabled}
                      onKeyDown={(event) => trimKeyDown(event, shot, 'in')}
                      onLostPointerCapture={(event) => finishTrimDrag(event, false)}
                      onPointerCancel={(event) => finishTrimDrag(event, false)}
                      onPointerDown={(event) => beginTrimDrag(event, shot, 'in')}
                      onPointerMove={moveTrimDrag}
                      onPointerUp={(event) => finishTrimDrag(event, true)}
                      role='slider'
                      style={{ insetInlineStart: `${(trimInSeconds / sourceDurationSeconds) * 100}%` }}
                      tabIndex={disabled ? -1 : 0}
                    />
                    <Button
                      aria-describedby={[trimGuidanceId, tailWarningId].filter(Boolean).join(' ')}
                      aria-disabled={disabled}
                      aria-label={t(`${COVERAGE_KEY_ROOT}.trimOutLabel`, { index: index + 1 })}
                      aria-orientation='horizontal'
                      aria-valuemax={maximumOut}
                      aria-valuemin={0}
                      aria-valuenow={trimOutSeconds}
                      aria-valuetext={t(`${COVERAGE_KEY_ROOT}.trimValue`, {
                        seconds: trimOutSeconds,
                      })}
                      className={`${styles.trimHandle} ${styles.trimOutHandle}`}
                      data-continuity-warning={tailWarning}
                      disabled={disabled}
                      onKeyDown={(event) => trimKeyDown(event, shot, 'out')}
                      onLostPointerCapture={(event) => finishTrimDrag(event, false)}
                      onPointerCancel={(event) => finishTrimDrag(event, false)}
                      onPointerDown={(event) => beginTrimDrag(event, shot, 'out')}
                      onPointerMove={moveTrimDrag}
                      onPointerUp={(event) => finishTrimDrag(event, true)}
                      role='slider'
                      style={{ insetInlineStart: `${(playedEndSeconds / sourceDurationSeconds) * 100}%` }}
                      tabIndex={disabled ? -1 : 0}
                    />
                  </div>
                ) : null}
                {boundaryMarker(index)}
              </div>
            );
          })}
        </div>
        <Button
          aria-describedby={seekGuidanceId}
          aria-disabled={!seekAvailable}
          aria-label={t(`${COVERAGE_KEY_ROOT}.seekLane`)}
          aria-orientation='horizontal'
          aria-valuemax={playback?.durationSeconds ?? 0}
          aria-valuemin={0}
          aria-valuenow={seekPositionSeconds}
          aria-valuetext={t(`${COVERAGE_KEY_ROOT}.seekValue`, {
            current: seekCurrentClock,
            total: seekTotalClock,
          })}
          className={styles.seekRail}
          data-studio-coverage-seek
          disabled={!seekAvailable}
          onKeyDown={seekKeyDown}
          onLostPointerCapture={(event) => finishSeek(event, false)}
          onPointerCancel={(event) => finishSeek(event, false)}
          onPointerDown={beginSeek}
          onPointerMove={moveSeek}
          onPointerUp={(event) => finishSeek(event, true)}
          role='slider'
          style={{ '--seek-position': `${seekLaneRatio * 100}%` } as React.CSSProperties}
          tabIndex={seekAvailable ? 0 : -1}
        />
      </div>

      <div
        ref={planningTrackRef}
        aria-label={t(`${COVERAGE_KEY_ROOT}.planningLane`)}
        className={styles.planningTrack}
        data-testid='studio-coverage-planning'
        role='group'
      >
        {geometry.segments.map((segment, index) => {
          const durationSeconds = planningPreview?.[segment.shotId] ?? segment.planningDurationSeconds;
          const next = geometry.segments[index + 1];
          const bounds =
            next === undefined
              ? null
              : coveragePlanningPairBounds(
                  durationSeconds,
                  planningPreview?.[next.shotId] ?? next.planningDurationSeconds
                );
          return (
            <div
              key={segment.shotId}
              className={styles.planningSegment}
              data-planning-end={segment.planningEndSeconds}
              data-shot-id={segment.shotId}
              style={{ flexBasis: 0, flexGrow: durationSeconds / geometry.planningTotalSeconds }}
            >
              <bdi>{t(`${COVERAGE_KEY_ROOT}.planningDuration`, { seconds: durationSeconds })}</bdi>
              {next !== undefined ? (
                <Button
                  aria-describedby={boundaryGuidanceId}
                  aria-disabled={disabled}
                  aria-label={t(`${COVERAGE_KEY_ROOT}.boundaryLabel`, { index: index + 1 })}
                  aria-orientation='horizontal'
                  aria-valuemax={bounds?.maximumLeftSeconds ?? durationSeconds}
                  aria-valuemin={bounds?.minimumLeftSeconds ?? durationSeconds}
                  aria-valuenow={durationSeconds}
                  aria-valuetext={t(`${COVERAGE_KEY_ROOT}.boundaryValue`, {
                    seconds: durationSeconds,
                  })}
                  className={styles.boundaryHandle}
                  disabled={disabled}
                  onKeyDown={(event) => boundaryKeyDown(event, index)}
                  onLostPointerCapture={(event) => finishBoundaryDrag(event, false)}
                  onPointerCancel={(event) => finishBoundaryDrag(event, false)}
                  onPointerDown={(event) => beginBoundaryDrag(event, index)}
                  onPointerMove={moveBoundaryDrag}
                  onPointerUp={(event) => finishBoundaryDrag(event, true)}
                  role='slider'
                  tabIndex={disabled ? -1 : 0}
                />
              ) : null}
            </div>
          );
        })}
      </div>
      <span aria-live='polite' className={styles.srOnly}>
        {announcement}
      </span>
    </section>
  );
};
