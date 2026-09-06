/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

type ProbedMediaStream = {
  codec_type?: unknown;
  duration?: unknown;
  duration_ts?: unknown;
  time_base?: unknown;
  tags?: unknown;
};

export type StudioVideoDurationProbeV2 = {
  hasAudio: boolean;
  /** Decoded video endpoint, with the historical container fallback for supported WebM media. */
  videoDurationSeconds: number;
  /** Furthest current stream/container endpoint used to distinguish stale metadata from a live mux tail. */
  envelopeDurationSeconds: number;
};

const positiveDurationSeconds = (value: unknown): number | null => {
  const seconds = (() => {
    if (typeof value === 'number') return value;
    if (typeof value === 'string' && /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/u.test(value)) {
      return Number(value);
    }
    return Number.NaN;
  })();
  return Number.isFinite(seconds) && seconds > 0 && seconds <= Number.MAX_SAFE_INTEGER ? seconds : null;
};

const positiveTicks = (value: unknown): number | null => {
  const ticks =
    typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/u.test(value) ? Number(value) : Number.NaN;
  return Number.isSafeInteger(ticks) && ticks > 0 ? ticks : null;
};

const clockDurationSeconds = (value: unknown): number | null => {
  if (typeof value !== 'string') return null;
  const match = /^(\d+):([0-5]\d):([0-5]\d(?:\.\d+)?)$/u.exec(value);
  if (match === null) return null;
  return positiveDurationSeconds(Number(match[1]) * 3_600 + Number(match[2]) * 60 + Number(match[3]));
};

const streamDurationSeconds = (stream: ProbedMediaStream): number | null => {
  const ticks = positiveTicks(ownDataValue(stream, 'duration_ts'));
  const rawTimeBase = ownDataValue(stream, 'time_base');
  if (ticks !== null && typeof rawTimeBase === 'string') {
    const timeBase = /^(\d+)\/(\d+)$/u.exec(rawTimeBase);
    const numerator = positiveTicks(timeBase?.[1]);
    const denominator = positiveTicks(timeBase?.[2]);
    if (numerator !== null && denominator !== null) {
      const timed = positiveDurationSeconds((ticks * numerator) / denominator);
      if (timed !== null) return timed;
    }
  }
  const direct = positiveDurationSeconds(ownDataValue(stream, 'duration'));
  if (direct !== null) return direct;
  const tags = ownDataValue(stream, 'tags');
  if (!dataRecord(tags)) return null;
  return clockDurationSeconds(ownDataValue(tags, 'DURATION') ?? ownDataValue(tags, 'duration'));
};

const dataRecord = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  return Reflect.ownKeys(value).every((key) => {
    if (typeof key !== 'string') return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor !== undefined && 'value' in descriptor && descriptor.enumerable;
  });
};

const ownDataValue = (value: object, key: string): unknown => {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor !== undefined && 'value' in descriptor && descriptor.enumerable ? descriptor.value : undefined;
};

/**
 * Parses one bounded video topology from ffprobe output. Exact stream clocks take precedence over
 * decimal durations and WebM tags. The format fallback preserves previously supported files whose
 * video stream omits a duration; Film otherwise treats the decoded video endpoint as authoritative.
 */
export const readStudioVideoDurationProbeV2 = (value: unknown): StudioVideoDurationProbeV2 | null => {
  if (!dataRecord(value)) return null;
  const rawStreams = ownDataValue(value, 'streams');
  if (!Array.isArray(rawStreams) || rawStreams.some((stream) => !dataRecord(stream))) return null;
  const streams = rawStreams as ProbedMediaStream[];
  const video = streams.filter((stream) => ownDataValue(stream, 'codec_type') === 'video');
  const audio = streams.filter((stream) => ownDataValue(stream, 'codec_type') === 'audio');
  if (video.length !== 1 || audio.length > 1) return null;

  const rawFormat = ownDataValue(value, 'format');
  const formatDurationSeconds = dataRecord(rawFormat)
    ? positiveDurationSeconds(ownDataValue(rawFormat, 'duration'))
    : null;
  const videoDurationSeconds = streamDurationSeconds(video[0]!) ?? formatDurationSeconds;
  if (videoDurationSeconds === null) return null;
  const envelopeDurationSeconds = Math.max(
    videoDurationSeconds,
    formatDurationSeconds ?? 0,
    ...audio.map((stream) => streamDurationSeconds(stream) ?? 0)
  );
  return { hasAudio: audio.length === 1, videoDurationSeconds, envelopeDurationSeconds };
};
