/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { WorkspaceCutProjection } from '../../workspaceProjection';

export type CutFilmDeltaKind = 'under' | 'over' | 'on_target';

export type CutFilmDelta = {
  kind: CutFilmDeltaKind;
  seconds: number;
};

export type CutFilmSummary = {
  filmSeconds: number | null;
  targetSeconds: number | null;
  /** Null whenever either side is unknown; an unknown comparison must never read as on target. */
  delta: CutFilmDelta | null;
  beatCount: number;
  shotCount: number;
  slateCount: number;
};

type CutFilmSummaryInput = Pick<WorkspaceCutProjection, 'beats' | 'filmDurationSeconds' | 'targetDurationSeconds'>;

const usableSeconds = (value: number | null): value is number => value !== null && Number.isFinite(value) && value >= 0;

const buildDelta = (filmSeconds: number | null, targetSeconds: number | null): CutFilmDelta | null => {
  if (!usableSeconds(filmSeconds) || !usableSeconds(targetSeconds)) return null;
  if (filmSeconds === targetSeconds) return { kind: 'on_target', seconds: 0 };
  return filmSeconds < targetSeconds
    ? { kind: 'under', seconds: targetSeconds - filmSeconds }
    : { kind: 'over', seconds: filmSeconds - targetSeconds };
};

/**
 * The header the Cut is judged by: how long the film runs, what it was authored to run, and what
 * that gap is. A Beat carrying no coverage still occupies its authored length as a slate, so it is
 * counted separately — but only once it has a length to occupy.
 */
export const buildCutFilmSummary = (cut: CutFilmSummaryInput): CutFilmSummary => {
  const filmSeconds = usableSeconds(cut.filmDurationSeconds) ? cut.filmDurationSeconds : null;
  const targetSeconds = usableSeconds(cut.targetDurationSeconds) ? cut.targetDurationSeconds : null;
  let shotCount = 0;
  let slateCount = 0;
  for (const beat of cut.beats) {
    if (Number.isSafeInteger(beat.shotCount) && beat.shotCount > 0) {
      shotCount += beat.shotCount;
      continue;
    }
    if (usableSeconds(beat.durationSeconds)) slateCount += 1;
  }
  return {
    filmSeconds,
    targetSeconds,
    delta: buildDelta(filmSeconds, targetSeconds),
    beatCount: cut.beats.length,
    shotCount,
    slateCount,
  };
};

/** Renders a whole-second length as the design's `m:ss` clock. */
export const formatCutClock = (seconds: number | null): string | null => {
  if (!usableSeconds(seconds)) return null;
  const whole = Math.round(seconds);
  const minutes = Math.floor(whole / 60);
  return `${minutes}:${String(whole - minutes * 60).padStart(2, '0')}`;
};
