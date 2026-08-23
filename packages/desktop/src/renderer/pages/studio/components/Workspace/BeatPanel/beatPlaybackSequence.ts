/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { STUDIO_MAX_SHOT_SECONDS, STUDIO_MIN_SHOT_SECONDS } from '@/common/types/project/creativeStudioTypes';

import type { WorkspaceBeatProjection, WorkspaceProjection, WorkspaceShotProjection } from '../workspaceProjection';

const SAFE_STUDIO_ID = /^[A-Za-z0-9_-]{1,256}$/;

export type BeatPlaybackVideoSegment = {
  kind: 'video';
  shotId: string;
  shotPosition: number;
  shotLine: string;
  assetId: string;
  posterAssetId: string | null;
  sourceDurationSeconds: number;
  sourceInSeconds: number;
  sourceOutSeconds: number;
  durationSeconds: number;
  beatStartSeconds: number;
  beatEndSeconds: number;
};

export type BeatPlaybackSlateSegment = {
  kind: 'slate';
  shotId: string;
  shotPosition: number;
  shotLine: string;
  durationSeconds: number;
  beatStartSeconds: number;
  beatEndSeconds: number;
};

export type BeatPlaybackSegment = BeatPlaybackVideoSegment | BeatPlaybackSlateSegment;

export type BeatPlaybackSequence = {
  projectId: string;
  projectRevision: number;
  beatId: string;
  durationSeconds: number;
  segments: BeatPlaybackSegment[];
};

export type BeatPlaybackLocation = {
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

const exactCurrentPicture = (
  shot: WorkspaceShotProjection
): Pick<
  BeatPlaybackVideoSegment,
  'assetId' | 'posterAssetId' | 'sourceDurationSeconds' | 'sourceInSeconds' | 'sourceOutSeconds' | 'durationSeconds'
> | null => {
  const picture = shot.currentPicture;
  if (picture === null) return null;
  const assetId = picture.assetId;
  const sourceDurationSeconds = picture.sourceDurationSeconds;
  if (!safeId(assetId) || !finiteSafePositive(sourceDurationSeconds)) return null;

  const sourceInSeconds = shot.trimInSeconds ?? 0;
  const trimOutSeconds = shot.trimOutSeconds ?? 0;
  if (
    !finiteSafeNonnegative(sourceInSeconds) ||
    !finiteSafeNonnegative(trimOutSeconds) ||
    sourceInSeconds >= sourceDurationSeconds ||
    trimOutSeconds >= sourceDurationSeconds ||
    sourceInSeconds + trimOutSeconds >= sourceDurationSeconds
  ) {
    return null;
  }
  const sourceOutSeconds = sourceDurationSeconds - trimOutSeconds;
  // Match the persisted duration helper's operation order exactly; decimal subtraction is not associative.
  const durationSeconds = sourceDurationSeconds - sourceInSeconds - trimOutSeconds;
  if (!finiteSafePositive(durationSeconds) || shot.playedDurationSeconds !== durationSeconds) return null;

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

const exactSlateDuration = (shot: WorkspaceShotProjection): number | null => {
  if (
    shot.currentPicture !== null ||
    shot.trimInSeconds !== null ||
    shot.trimOutSeconds !== null ||
    !Number.isSafeInteger(shot.durationSeconds) ||
    shot.durationSeconds < STUDIO_MIN_SHOT_SECONDS ||
    shot.durationSeconds > STUDIO_MAX_SHOT_SECONDS ||
    shot.playedDurationSeconds !== shot.durationSeconds
  ) {
    return null;
  }
  return shot.durationSeconds;
};

/** Builds the exact current-picture/slate sequence owned by one active Beat. */
export const buildBeatPlaybackSequence = (
  projectId: string,
  beat: WorkspaceBeatProjection,
  projection: WorkspaceProjection
): BeatPlaybackSequence | null => {
  if (
    !safeId(projectId) ||
    projection.projectId !== projectId ||
    !Number.isSafeInteger(projection.projectRevision) ||
    projection.projectRevision < 0 ||
    !safeId(beat.id) ||
    beat.shots.length === 0 ||
    projection.activeBeats.length !== projection.activeBeatIds.length
  ) {
    return null;
  }

  const beatMatches = projection.activeBeats.filter((candidate) => candidate.id === beat.id);
  if (beatMatches.length !== 1 || beatMatches[0] !== beat) return null;
  const beatIndex = projection.activeBeats.indexOf(beat);
  if (beatIndex < 0 || projection.activeBeatIds[beatIndex] !== beat.id) return null;

  const seenBeatIds = new Set<string>();
  const seenActiveShotIds = new Set<string>();
  const flattenedShotIds: string[] = [];
  for (let activeBeatIndex = 0; activeBeatIndex < projection.activeBeats.length; activeBeatIndex += 1) {
    const activeBeat = projection.activeBeats[activeBeatIndex]!;
    if (
      !safeId(activeBeat.id) ||
      seenBeatIds.has(activeBeat.id) ||
      projection.activeBeatIds[activeBeatIndex] !== activeBeat.id
    ) {
      return null;
    }
    seenBeatIds.add(activeBeat.id);
    for (const activeShot of activeBeat.shots) {
      if (!safeId(activeShot.id) || seenActiveShotIds.has(activeShot.id)) return null;
      seenActiveShotIds.add(activeShot.id);
      flattenedShotIds.push(activeShot.id);
    }
  }
  if (
    flattenedShotIds.length !== projection.activeShotIds.length ||
    flattenedShotIds.some((shotId, index) => projection.activeShotIds[index] !== shotId)
  ) {
    return null;
  }

  const segments: BeatPlaybackSegment[] = [];
  const seenShotIds = new Set<string>();
  let beatCursor = 0;
  let planningCursor = 0;
  for (let shotIndex = 0; shotIndex < beat.shots.length; shotIndex += 1) {
    const shot = beat.shots[shotIndex]!;
    const boundary = shot.planningBoundary;
    if (
      !safeId(shot.id) ||
      seenShotIds.has(shot.id) ||
      typeof shot.line !== 'string' ||
      boundary === null ||
      boundary.shotId !== shot.id ||
      !Number.isSafeInteger(boundary.startSeconds) ||
      Object.is(boundary.startSeconds, -0) ||
      boundary.startSeconds !== planningCursor ||
      !Number.isSafeInteger(boundary.endSeconds) ||
      Object.is(boundary.endSeconds, -0) ||
      !Number.isSafeInteger(shot.durationSeconds) ||
      shot.durationSeconds < STUDIO_MIN_SHOT_SECONDS ||
      shot.durationSeconds > STUDIO_MAX_SHOT_SECONDS ||
      boundary.endSeconds - boundary.startSeconds !== shot.durationSeconds
    ) {
      return null;
    }
    seenShotIds.add(shot.id);
    planningCursor = boundary.endSeconds;

    const picture = shot.currentPicture === null ? null : exactCurrentPicture(shot);
    const durationSeconds = picture?.durationSeconds ?? exactSlateDuration(shot);
    if (durationSeconds === null) return null;
    const beatEndSeconds = beatCursor + durationSeconds;
    if (!finiteSafePositive(beatEndSeconds) || beatEndSeconds <= beatCursor) return null;

    const common = {
      shotId: shot.id,
      shotPosition: shotIndex + 1,
      shotLine: shot.line,
      durationSeconds,
      beatStartSeconds: beatCursor,
      beatEndSeconds,
    };
    segments.push(picture === null ? { kind: 'slate', ...common } : { kind: 'video', ...common, ...picture });
    beatCursor = beatEndSeconds;
  }

  if (!finiteSafePositive(beat.actualSeconds) || beat.actualSeconds !== beatCursor) return null;
  return {
    projectId,
    projectRevision: projection.projectRevision,
    beatId: beat.id,
    durationSeconds: beatCursor,
    segments,
  };
};

/** Floors and clamps a Beat-relative playback clock. */
export const formatBeatPlaybackClock = (seconds: number, maximumSeconds: number): string | null => {
  if (!finiteSafeNonnegative(maximumSeconds) || typeof seconds !== 'number' || !Number.isFinite(seconds)) return null;
  const whole = Math.floor(Math.min(maximumSeconds, Math.max(0, seconds)));
  const minutes = Math.floor(whole / 60);
  return `${minutes}:${String(whole - minutes * 60).padStart(2, '0')}`;
};

/** Resolves one Beat-relative position to its exact Shot and current-picture offset. */
export const resolveBeatPlaybackLocation = (
  sequence: BeatPlaybackSequence,
  requestedSeconds: number
): BeatPlaybackLocation | null => {
  if (!Number.isFinite(requestedSeconds) || sequence.segments.length === 0) return null;
  const positionSeconds = Math.min(sequence.durationSeconds, Math.max(0, requestedSeconds));
  const segmentIndex =
    positionSeconds >= sequence.durationSeconds
      ? sequence.segments.length - 1
      : sequence.segments.findIndex((segment) => positionSeconds < segment.beatEndSeconds);
  const segment = sequence.segments[segmentIndex];
  if (segment === undefined) return null;
  return {
    segmentIndex,
    positionSeconds,
    sourceTimeSeconds:
      segment.kind === 'video'
        ? Math.min(
            segment.sourceOutSeconds,
            segment.sourceInSeconds + Math.max(0, positionSeconds - segment.beatStartSeconds)
          )
        : null,
  };
};

/** Shot joins are the Beat positions at which the next authored Shot begins. */
export const beatPlaybackJoins = (sequence: BeatPlaybackSequence): number[] =>
  sequence.segments.slice(1).map((segment) => segment.beatStartSeconds);
