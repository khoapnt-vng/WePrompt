/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { WorkspaceProjection, WorkspaceShotProjection } from '../../workspaceProjection';

const SAFE_STUDIO_ID = /^[A-Za-z0-9_-]{1,256}$/;

export type CutPlaybackVideoSegment = {
  kind: 'video';
  beatId: string;
  beatPosition: number;
  beatTitle: string;
  shotId: string;
  shotPosition: number;
  shotTitle: string;
  assetId: string;
  posterAssetId: string | null;
  sourceDurationSeconds: number;
  /** Inclusive current-picture media boundary. */
  sourceInSeconds: number;
  /** Exclusive current-picture media boundary. */
  sourceOutSeconds: number;
  durationSeconds: number;
  filmStartSeconds: number;
  filmEndSeconds: number;
};

export type CutPlaybackSlateSegment = {
  kind: 'slate';
  beatId: string;
  beatPosition: number;
  beatTitle: string;
  durationSeconds: number;
  filmStartSeconds: number;
  filmEndSeconds: number;
};

export type CutPlaybackSegment = CutPlaybackVideoSegment | CutPlaybackSlateSegment;

export type CutPlaybackSequence = {
  projectId: string;
  projectRevision: number;
  durationSeconds: number;
  segments: CutPlaybackSegment[];
};

export type CutPlaybackLocation = {
  segmentIndex: number;
  positionSeconds: number;
  sourceTimeSeconds: number | null;
};

const safeId = (value: unknown): value is string => typeof value === 'string' && SAFE_STUDIO_ID.test(value);

const finiteSafeNonnegative = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isFinite(value) &&
  value >= 0 &&
  value <= Number.MAX_SAFE_INTEGER &&
  !Object.is(value, -0);

const finiteSafePositive = (value: unknown): value is number => finiteSafeNonnegative(value) && value > 0;

const addDuration = (left: number, right: number): number | null => {
  const sum = left + right;
  return finiteSafeNonnegative(sum) ? sum : null;
};

const addPositiveDuration = (left: number, right: number): number | null => {
  if (!finiteSafePositive(right)) return null;
  const sum = addDuration(left, right);
  return sum !== null && sum > left ? sum : null;
};

const normalizedTrim = (value: number | null): number | null => {
  if (value === null) return 0;
  return finiteSafeNonnegative(value) ? value : null;
};

const exactCurrentPicture = (
  shot: WorkspaceShotProjection
): {
  assetId: string;
  posterAssetId: string | null;
  sourceDurationSeconds: number;
  sourceInSeconds: number;
  sourceOutSeconds: number;
  durationSeconds: number;
} | null => {
  const picture = shot.currentPicture;
  if (picture === null) return null;
  const assetId = picture.assetId;
  const sourceDurationSeconds = picture.sourceDurationSeconds;
  const playedDurationSeconds = shot.playedDurationSeconds;
  if (!safeId(assetId) || !finiteSafePositive(sourceDurationSeconds) || !finiteSafePositive(playedDurationSeconds)) {
    return null;
  }

  const sourceInSeconds = normalizedTrim(shot.trimInSeconds);
  const trimOutSeconds = normalizedTrim(shot.trimOutSeconds);
  if (
    sourceInSeconds === null ||
    trimOutSeconds === null ||
    sourceInSeconds >= sourceDurationSeconds ||
    trimOutSeconds >= sourceDurationSeconds ||
    sourceInSeconds + trimOutSeconds >= sourceDurationSeconds
  ) {
    return null;
  }
  const sourceOutSeconds = sourceDurationSeconds - trimOutSeconds;
  // Match studioShotPlayedDurationV2's authoritative operation order exactly. Decimal subtraction
  // is not associative, so deriving this from sourceOutSeconds can reject a valid projection.
  const durationSeconds = sourceDurationSeconds - sourceInSeconds - trimOutSeconds;
  if (!finiteSafePositive(durationSeconds) || playedDurationSeconds !== durationSeconds) return null;

  if (picture.posterAssetId !== null && !safeId(picture.posterAssetId)) {
    return null;
  }

  return {
    assetId,
    posterAssetId: picture.posterAssetId,
    sourceDurationSeconds,
    sourceInSeconds,
    sourceOutSeconds,
    durationSeconds,
  };
};

/**
 * Builds the one sequence that the Cut may truthfully preview.
 *
 * Covered Shots never degrade to slates: every active Shot must carry one exact current canonical
 * video picture. Only a genuinely zero-Shot Beat with a positive target becomes a slate. Any ambiguous
 * order, identity, duration, or aggregate refuses the complete sequence rather than drawing a
 * shorter film.
 */
export type CutShotAwaitingPicture = { beatPosition: number; shotPosition: number; shotId: string };

/**
 * The one ordinary reason a covered Shot refuses the finished-film preview: it has not rendered a
 * current picture yet. Every other refusal in `buildCutPlaybackSequence` remains a projection fault.
 */
export const cutPlaybackShotsAwaitingPicture = (projection: WorkspaceProjection): readonly CutShotAwaitingPicture[] => {
  const awaiting: CutShotAwaitingPicture[] = [];
  if (!Array.isArray(projection?.activeBeats)) return awaiting;
  projection.activeBeats.forEach((beat, beatIndex) => {
    if (!Array.isArray(beat?.shots)) return;
    beat.shots.forEach((shot, shotIndex) => {
      if (shot?.currentPicture !== null || !safeId(shot?.id)) return;
      awaiting.push({ beatPosition: beatIndex + 1, shotPosition: shotIndex + 1, shotId: shot.id });
    });
  });
  return awaiting;
};

export const buildCutPlaybackSequence = (projection: WorkspaceProjection): CutPlaybackSequence | null => {
  if (
    !safeId(projection.projectId) ||
    !Number.isSafeInteger(projection.projectRevision) ||
    projection.projectRevision < 0 ||
    !projection.cut.orderReady ||
    projection.activeBeats.length !== projection.activeBeatIds.length ||
    projection.activeBeats.length !== projection.cut.beats.length
  ) {
    return null;
  }

  const seenBeatIds = new Set<string>();
  const seenShotIds = new Set<string>();
  const flattenedShotIds: string[] = [];
  const segments: CutPlaybackSegment[] = [];
  let filmCursor = 0;

  for (let beatIndex = 0; beatIndex < projection.activeBeats.length; beatIndex += 1) {
    const beat = projection.activeBeats[beatIndex]!;
    const cutBeat = projection.cut.beats[beatIndex]!;
    if (
      !safeId(beat.id) ||
      seenBeatIds.has(beat.id) ||
      projection.activeBeatIds[beatIndex] !== beat.id ||
      cutBeat.id !== beat.id ||
      typeof beat.title !== 'string' ||
      cutBeat.title !== beat.title ||
      cutBeat.shotCount !== beat.shots.length
    ) {
      return null;
    }
    seenBeatIds.add(beat.id);

    if (beat.shots.length === 0) {
      if (
        !finiteSafePositive(beat.targetSeconds) ||
        beat.actualSeconds !== null ||
        cutBeat.durationKind !== 'target' ||
        cutBeat.durationSeconds !== beat.targetSeconds
      ) {
        return null;
      }
      const filmEndSeconds = addPositiveDuration(filmCursor, beat.targetSeconds);
      if (filmEndSeconds === null) return null;
      segments.push({
        kind: 'slate',
        beatId: beat.id,
        beatPosition: beatIndex + 1,
        beatTitle: beat.title,
        durationSeconds: beat.targetSeconds,
        filmStartSeconds: filmCursor,
        filmEndSeconds,
      });
      filmCursor = filmEndSeconds;
      continue;
    }

    if (
      cutBeat.durationKind !== 'actual' ||
      !finiteSafePositive(cutBeat.durationSeconds) ||
      !finiteSafePositive(beat.actualSeconds)
    ) {
      return null;
    }
    let beatCursor = 0;
    for (let shotIndex = 0; shotIndex < beat.shots.length; shotIndex += 1) {
      const shot = beat.shots[shotIndex]!;
      if (!safeId(shot.id) || seenShotIds.has(shot.id) || typeof shot.shootingScript !== 'string') return null;
      seenShotIds.add(shot.id);
      flattenedShotIds.push(shot.id);
      const picture = exactCurrentPicture(shot);
      if (picture === null) return null;
      const beatEndSeconds = addPositiveDuration(beatCursor, picture.durationSeconds);
      const filmStartSeconds = addDuration(filmCursor, beatCursor);
      const filmEndSeconds = beatEndSeconds === null ? null : addPositiveDuration(filmCursor, beatEndSeconds);
      if (
        beatEndSeconds === null ||
        filmStartSeconds === null ||
        filmEndSeconds === null ||
        filmEndSeconds <= filmStartSeconds
      ) {
        return null;
      }
      segments.push({
        kind: 'video',
        beatId: beat.id,
        beatPosition: beatIndex + 1,
        beatTitle: beat.title,
        shotId: shot.id,
        shotPosition: shotIndex + 1,
        shotTitle: shot.shootingScript.trim() || shot.id,
        ...picture,
        filmStartSeconds,
        filmEndSeconds,
      });
      beatCursor = beatEndSeconds;
    }
    if (beatCursor !== beat.actualSeconds || beatCursor !== cutBeat.durationSeconds) return null;
    const nextFilmCursor = addPositiveDuration(filmCursor, beat.actualSeconds);
    if (nextFilmCursor === null) return null;
    filmCursor = nextFilmCursor;
  }

  if (
    segments.length === 0 ||
    flattenedShotIds.length !== projection.activeShotIds.length ||
    flattenedShotIds.some((shotId, index) => projection.activeShotIds[index] !== shotId) ||
    !finiteSafeNonnegative(projection.cut.filmDurationSeconds) ||
    projection.cut.filmDurationSeconds !== filmCursor
  ) {
    return null;
  }

  return {
    projectId: projection.projectId,
    projectRevision: projection.projectRevision,
    durationSeconds: filmCursor,
    segments,
  };
};

/** Floors the live transport clock after clamping it to the authoritative stored film duration. */
export const formatCutPlaybackClock = (seconds: number, maximumSeconds: number): string | null => {
  if (!finiteSafeNonnegative(maximumSeconds) || typeof seconds !== 'number' || !Number.isFinite(seconds)) return null;
  const whole = Math.floor(Math.min(maximumSeconds, Math.max(0, seconds)));
  const minutes = Math.floor(whole / 60);
  return `${minutes}:${String(whole - minutes * 60).padStart(2, '0')}`;
};

/** Resolves one film position against the exact sequence; Beat/Shot selection is never involved. */
export const resolveCutPlaybackLocation = (
  sequence: CutPlaybackSequence,
  requestedSeconds: number
): CutPlaybackLocation | null => {
  if (!Number.isFinite(requestedSeconds) || sequence.segments.length === 0) return null;
  const positionSeconds = Math.min(sequence.durationSeconds, Math.max(0, requestedSeconds));
  const segmentIndex =
    positionSeconds >= sequence.durationSeconds
      ? sequence.segments.length - 1
      : sequence.segments.findIndex((segment) => positionSeconds < segment.filmEndSeconds);
  const segment = sequence.segments[segmentIndex];
  if (segment === undefined) return null;
  return {
    segmentIndex,
    positionSeconds,
    sourceTimeSeconds:
      segment.kind === 'video'
        ? Math.min(
            segment.sourceOutSeconds,
            segment.sourceInSeconds + Math.max(0, positionSeconds - segment.filmStartSeconds)
          )
        : null,
  };
};

/** Beat joins are the film positions at which the next authored Beat begins. */
export const cutPlaybackBeatJoins = (sequence: CutPlaybackSequence): number[] => {
  const joins: number[] = [];
  for (let index = 1; index < sequence.segments.length; index += 1) {
    const segment = sequence.segments[index]!;
    if (segment.beatId !== sequence.segments[index - 1]!.beatId) joins.push(segment.filmStartSeconds);
  }
  return joins;
};
