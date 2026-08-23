/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { STUDIO_MAX_SHOT_SECONDS, STUDIO_MIN_SHOT_SECONDS } from '@/common/types/project/creativeStudioTypes';

import type { WorkspaceShotProjection } from '../workspaceProjection';

export const COVERAGE_TRIM_STEP_SECONDS = 0.5;
export const COVERAGE_MIN_PLAYED_SECONDS = 1;

export type CoverageDensity = 'narrow' | 'medium' | 'wide';

export type CoverageSegmentGeometry = {
  shotId: string;
  planningStartSeconds: number;
  planningEndSeconds: number;
  planningDurationSeconds: number;
  playbackWidthSeconds: number;
  playedStartSeconds: number;
  playedEndSeconds: number;
  playedDurationSeconds: number;
  hasCurrentPicture: boolean;
};

export type CoverageGeometry = {
  segments: CoverageSegmentGeometry[];
  planningTotalSeconds: number;
  playbackTotalSeconds: number;
};

export type CoveragePlanningDurationChange = {
  shotId: string;
  durationSeconds: number;
};

export type CoveragePlanningPairChange = readonly [CoveragePlanningDurationChange, CoveragePlanningDurationChange];

export type CoveragePlanningPairBounds = {
  minimumLeftSeconds: number;
  maximumLeftSeconds: number;
};

const finitePositive = (value: number): boolean => Number.isFinite(value) && value > 0;

/**
 * Keeps the shared planning boundary authoritative while deriving a distinct playback lane.
 * A current picture must have a probed source duration; invalid or partial facts fail closed.
 */
export const buildCoverageGeometry = (shots: readonly WorkspaceShotProjection[]): CoverageGeometry | null => {
  if (shots.length === 0) return { segments: [], planningTotalSeconds: 0, playbackTotalSeconds: 0 };

  const segments: CoverageSegmentGeometry[] = [];
  let expectedPlanningStart = 0;
  let playbackTotalSeconds = 0;
  for (const shot of shots) {
    const boundary = shot.planningBoundary;
    if (
      boundary === null ||
      boundary.shotId !== shot.id ||
      !Number.isSafeInteger(boundary.startSeconds) ||
      !Number.isSafeInteger(boundary.endSeconds) ||
      boundary.startSeconds !== expectedPlanningStart ||
      boundary.endSeconds - boundary.startSeconds !== shot.durationSeconds ||
      shot.durationSeconds < STUDIO_MIN_SHOT_SECONDS ||
      shot.durationSeconds > STUDIO_MAX_SHOT_SECONDS
    ) {
      return null;
    }

    const hasCurrentPicture = shot.currentPicture !== null;
    const playbackWidthSeconds = hasCurrentPicture ? shot.currentPicture!.sourceDurationSeconds : shot.durationSeconds;
    if (!finitePositive(playbackWidthSeconds)) return null;

    const trimInSeconds = hasCurrentPicture ? (shot.trimInSeconds ?? 0) : 0;
    const trimOutSeconds = hasCurrentPicture ? (shot.trimOutSeconds ?? 0) : 0;
    if (
      (!hasCurrentPicture && (shot.trimInSeconds !== null || shot.trimOutSeconds !== null)) ||
      !Number.isFinite(trimInSeconds) ||
      !Number.isFinite(trimOutSeconds) ||
      trimInSeconds < 0 ||
      trimOutSeconds < 0 ||
      Object.is(trimInSeconds, -0) ||
      Object.is(trimOutSeconds, -0) ||
      playbackWidthSeconds - trimInSeconds - trimOutSeconds < COVERAGE_MIN_PLAYED_SECONDS
    ) {
      return null;
    }

    const playedDurationSeconds = playbackWidthSeconds - trimInSeconds - trimOutSeconds;
    if (
      shot.playedDurationSeconds === null ||
      !finitePositive(shot.playedDurationSeconds) ||
      Math.abs(shot.playedDurationSeconds - playedDurationSeconds) > Number.EPSILON * 8
    ) {
      return null;
    }

    playbackTotalSeconds += playbackWidthSeconds;
    if (!Number.isFinite(playbackTotalSeconds) || playbackTotalSeconds > Number.MAX_SAFE_INTEGER) return null;
    segments.push({
      shotId: shot.id,
      planningStartSeconds: boundary.startSeconds,
      planningEndSeconds: boundary.endSeconds,
      planningDurationSeconds: shot.durationSeconds,
      playbackWidthSeconds,
      playedStartSeconds: trimInSeconds,
      playedEndSeconds: playbackWidthSeconds - trimOutSeconds,
      playedDurationSeconds,
      hasCurrentPicture,
    });
    expectedPlanningStart = boundary.endSeconds;
  }

  return {
    segments,
    planningTotalSeconds: expectedPlanningStart,
    playbackTotalSeconds,
  };
};

export const coveragePlanningPairBounds = (
  leftDurationSeconds: number,
  rightDurationSeconds: number
): CoveragePlanningPairBounds | null => {
  if (
    !Number.isSafeInteger(leftDurationSeconds) ||
    !Number.isSafeInteger(rightDurationSeconds) ||
    leftDurationSeconds < STUDIO_MIN_SHOT_SECONDS ||
    leftDurationSeconds > STUDIO_MAX_SHOT_SECONDS ||
    rightDurationSeconds < STUDIO_MIN_SHOT_SECONDS ||
    rightDurationSeconds > STUDIO_MAX_SHOT_SECONDS
  ) {
    return null;
  }
  const total = leftDurationSeconds + rightDurationSeconds;
  const minimumLeftSeconds = Math.max(STUDIO_MIN_SHOT_SECONDS, total - STUDIO_MAX_SHOT_SECONDS);
  const maximumLeftSeconds = Math.min(STUDIO_MAX_SHOT_SECONDS, total - STUDIO_MIN_SHOT_SECONDS);
  return minimumLeftSeconds <= maximumLeftSeconds ? { minimumLeftSeconds, maximumLeftSeconds } : null;
};

/** Adjusts one adjacent integer boundary without changing the pair total. */
export const resizeCoveragePlanningPair = (input: {
  leftShotId: string;
  leftDurationSeconds: number;
  rightShotId: string;
  rightDurationSeconds: number;
  deltaSeconds: number;
}): CoveragePlanningPairChange | null => {
  if (input.leftShotId === input.rightShotId || !Number.isFinite(input.deltaSeconds)) {
    return null;
  }
  const bounds = coveragePlanningPairBounds(input.leftDurationSeconds, input.rightDurationSeconds);
  if (bounds === null) return null;
  const total = input.leftDurationSeconds + input.rightDurationSeconds;
  const leftDurationSeconds = Math.max(
    bounds.minimumLeftSeconds,
    Math.min(bounds.maximumLeftSeconds, input.leftDurationSeconds + Math.round(input.deltaSeconds))
  );
  return [
    { shotId: input.leftShotId, durationSeconds: leftDurationSeconds },
    { shotId: input.rightShotId, durationSeconds: total - leftDurationSeconds },
  ];
};

const floorToTrimStep = (value: number): number =>
  Math.floor(value / COVERAGE_TRIM_STEP_SECONDS) * COVERAGE_TRIM_STEP_SECONDS;

export const maximumCoverageTrim = (sourceDurationSeconds: number, oppositeTrimSeconds: number): number | null => {
  if (!finitePositive(sourceDurationSeconds) || !Number.isFinite(oppositeTrimSeconds) || oppositeTrimSeconds < 0) {
    return null;
  }
  const maximum = floorToTrimStep(sourceDurationSeconds - oppositeTrimSeconds - COVERAGE_MIN_PLAYED_SECONDS);
  return maximum >= 0 ? maximum : null;
};

/** Snaps a trim amount to half-seconds and keeps at least one played second. */
export const clampCoverageTrim = (input: {
  sourceDurationSeconds: number;
  oppositeTrimSeconds: number;
  requestedTrimSeconds: number;
}): number | null => {
  const maximum = maximumCoverageTrim(input.sourceDurationSeconds, input.oppositeTrimSeconds);
  if (maximum === null || !Number.isFinite(input.requestedTrimSeconds)) return null;
  const snapped = Math.round(input.requestedTrimSeconds / COVERAGE_TRIM_STEP_SECONDS) * COVERAGE_TRIM_STEP_SECONDS;
  return Math.max(0, Math.min(maximum, snapped));
};

/** Converts a physical horizontal pointer delta into logical seconds, including RTL. */
export const coveragePointerDeltaSeconds = (input: {
  clientX: number;
  startClientX: number;
  trackWidthPixels: number;
  trackSeconds: number;
  rtl: boolean;
}): number | null => {
  if (
    !Number.isFinite(input.clientX) ||
    !Number.isFinite(input.startClientX) ||
    !finitePositive(input.trackWidthPixels) ||
    !finitePositive(input.trackSeconds)
  ) {
    return null;
  }
  const direction = input.rtl ? -1 : 1;
  return ((input.clientX - input.startClientX) * input.trackSeconds * direction) / input.trackWidthPixels;
};

/** Maps an absolute pointer coordinate to a clamped logical rail position, including RTL. */
export const coveragePointerPositionSeconds = (input: {
  clientX: number;
  trackLeftPixels: number;
  trackWidthPixels: number;
  durationSeconds: number;
  rtl: boolean;
}): number | null => {
  if (
    !Number.isFinite(input.clientX) ||
    !Number.isFinite(input.trackLeftPixels) ||
    !finitePositive(input.trackWidthPixels) ||
    !finitePositive(input.durationSeconds)
  ) {
    return null;
  }
  const physicalRatio = Math.max(0, Math.min(1, (input.clientX - input.trackLeftPixels) / input.trackWidthPixels));
  return (input.rtl ? 1 - physicalRatio : physicalRatio) * input.durationSeconds;
};

type CoverageSeekMetrics = {
  laneTotalSeconds: number;
  playedTotalSeconds: number;
};

const finiteSafeSeekOffset = (value: number): boolean =>
  Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER && !Object.is(value, -0);

const coverageSeekMetrics = (geometry: CoverageGeometry): CoverageSeekMetrics | null => {
  if (geometry.segments.length === 0) return null;
  let laneTotalSeconds = 0;
  let playedTotalSeconds = 0;
  for (const segment of geometry.segments) {
    if (
      !finitePositive(segment.playbackWidthSeconds) ||
      !finiteSafeSeekOffset(segment.playedStartSeconds) ||
      !finiteSafeSeekOffset(segment.playedEndSeconds) ||
      segment.playedStartSeconds >= segment.playedEndSeconds ||
      segment.playedEndSeconds > segment.playbackWidthSeconds ||
      segment.playedDurationSeconds !== segment.playedEndSeconds - segment.playedStartSeconds
    ) {
      return null;
    }
    laneTotalSeconds += segment.playbackWidthSeconds;
    playedTotalSeconds += segment.playedDurationSeconds;
    if (!finitePositive(laneTotalSeconds) || !finitePositive(playedTotalSeconds)) return null;
  }
  if (geometry.playbackTotalSeconds !== laneTotalSeconds) return null;
  return { laneTotalSeconds, playedTotalSeconds };
};

/** Maps assembled played time to its truthful position inside the source-width coverage lane. */
export const coverageSeekLaneRatio = (geometry: CoverageGeometry, requestedSeconds: number): number | null => {
  const metrics = coverageSeekMetrics(geometry);
  if (metrics === null || !Number.isFinite(requestedSeconds)) return null;
  const positionSeconds = Math.min(metrics.playedTotalSeconds, Math.max(0, requestedSeconds));
  let laneCursor = 0;
  let playedCursor = 0;
  for (let index = 0; index < geometry.segments.length; index += 1) {
    const segment = geometry.segments[index]!;
    const playedEnd = playedCursor + segment.playedDurationSeconds;
    if (positionSeconds < playedEnd || index === geometry.segments.length - 1) {
      const localPlayed = Math.min(segment.playedDurationSeconds, Math.max(0, positionSeconds - playedCursor));
      return (laneCursor + segment.playedStartSeconds + localPlayed) / metrics.laneTotalSeconds;
    }
    laneCursor += segment.playbackWidthSeconds;
    playedCursor = playedEnd;
  }
  return null;
};

/** Maps a physical coverage-lane pointer through trimmed source gaps onto assembled Beat time. */
export const coverageSeekPositionSeconds = (input: {
  clientX: number;
  trackLeftPixels: number;
  trackWidthPixels: number;
  geometry: CoverageGeometry;
  rtl: boolean;
}): number | null => {
  const metrics = coverageSeekMetrics(input.geometry);
  if (
    metrics === null ||
    !Number.isFinite(input.clientX) ||
    !Number.isFinite(input.trackLeftPixels) ||
    !finitePositive(input.trackWidthPixels)
  ) {
    return null;
  }
  const physicalRatio = Math.max(0, Math.min(1, (input.clientX - input.trackLeftPixels) / input.trackWidthPixels));
  const lanePosition = (input.rtl ? 1 - physicalRatio : physicalRatio) * metrics.laneTotalSeconds;
  let laneCursor = 0;
  let playedCursor = 0;
  for (let index = 0; index < input.geometry.segments.length; index += 1) {
    const segment = input.geometry.segments[index]!;
    const laneEnd = laneCursor + segment.playbackWidthSeconds;
    if (lanePosition < laneEnd || index === input.geometry.segments.length - 1) {
      const localSource = Math.min(segment.playbackWidthSeconds, Math.max(0, lanePosition - laneCursor));
      const localPlayed = Math.min(
        segment.playedDurationSeconds,
        Math.max(0, localSource - segment.playedStartSeconds)
      );
      return playedCursor + localPlayed;
    }
    laneCursor = laneEnd;
    playedCursor += segment.playedDurationSeconds;
  }
  return null;
};

/** The whole bar adopts the tier of its narrowest playback segment. */
export const coverageDensityForWidth = (
  barWidthPixels: number,
  playbackWidthsSeconds: readonly number[]
): CoverageDensity => {
  const total = playbackWidthsSeconds.reduce((sum, value) => sum + (finitePositive(value) ? value : 0), 0);
  if (!finitePositive(barWidthPixels) || !finitePositive(total) || playbackWidthsSeconds.length === 0) return 'narrow';
  const narrowestPixels = Math.min(...playbackWidthsSeconds.map((value) => (barWidthPixels * value) / total));
  if (narrowestPixels < 88) return 'narrow';
  if (narrowestPixels <= 150) return 'medium';
  return 'wide';
};
