/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { readStudioVideoDurationProbeV2 } from '@process/services/creative-studio/service/schema2/exports/mediaDuration';

describe('Creative Studio media duration', () => {
  it('prefers exact video ticks while retaining the current container endpoint', () => {
    expect(
      readStudioVideoDurationProbeV2({
        streams: [
          {
            codec_type: 'video',
            duration: '10.041667',
            duration_ts: '241000',
            time_base: '1/24000',
            tags: { DURATION: '00:00:10.041667000' },
          },
          { codec_type: 'audio', duration: '10.100000' },
        ],
        format: { duration: '10.100000' },
      })
    ).toEqual({ hasAudio: true, videoDurationSeconds: 241 / 24, envelopeDurationSeconds: 10.1 });
  });

  it('uses direct duration, WebM duration tags, and silent-container fallback in that order', () => {
    expect(
      readStudioVideoDurationProbeV2({
        streams: [{ codec_type: 'video', duration: '5.25', duration_ts: 'N/A', time_base: 'invalid' }],
        format: { duration: '5.3' },
      })
    ).toEqual({ hasAudio: false, videoDurationSeconds: 5.25, envelopeDurationSeconds: 5.3 });
    expect(
      readStudioVideoDurationProbeV2({
        streams: [
          { codec_type: 'video', duration: 'N/A', tags: { DURATION: '00:00:06.125000000' } },
          { codec_type: 'audio', duration: 'N/A', tags: { duration: '00:00:06.200000000' } },
        ],
        format: { duration: '6.2' },
      })
    ).toEqual({ hasAudio: true, videoDurationSeconds: 6.125, envelopeDurationSeconds: 6.2 });
    expect(
      readStudioVideoDurationProbeV2({
        streams: [{ codec_type: 'video', duration: 'N/A', tags: null }],
        format: { duration: '4' },
      })
    ).toEqual({ hasAudio: false, videoDurationSeconds: 4, envelopeDurationSeconds: 4 });
  });

  it('retains supported audible media that exposes only a container duration', () => {
    expect(
      readStudioVideoDurationProbeV2({
        streams: [
          { codec_type: 'video', duration: 'N/A', tags: [] },
          { codec_type: 'audio', duration: 'N/A' },
        ],
        format: { duration: '4' },
      })
    ).toEqual({ hasAudio: true, videoDurationSeconds: 4, envelopeDurationSeconds: 4 });
  });

  it('fails closed on malformed or ambiguous probe topology', () => {
    for (const value of [
      null,
      [],
      {},
      { streams: [null], format: { duration: '4' } },
      { streams: [], format: { duration: '4' } },
      {
        streams: [
          { codec_type: 'video', duration: '4' },
          { codec_type: 'video', duration: '4' },
        ],
        format: { duration: '4' },
      },
      {
        streams: [
          { codec_type: 'video', duration: '4' },
          { codec_type: 'audio', duration: '4' },
          { codec_type: 'audio', duration: '4' },
        ],
        format: { duration: '4' },
      },
      {
        streams: [{ codec_type: 'video', duration: 'N/A', duration_ts: '10', time_base: '0/1' }],
        format: { duration: 'N/A' },
      },
    ]) {
      expect(readStudioVideoDurationProbeV2(value)).toBeNull();
    }
  });

  it('rejects JavaScript-coercible values that ffprobe cannot emit as durations', () => {
    for (const duration of [true, [4], { valueOf: () => 4 }, ' ', '0x10']) {
      expect(readStudioVideoDurationProbeV2({ streams: [{ codec_type: 'video', duration }] })).toBeNull();
      expect(
        readStudioVideoDurationProbeV2({
          streams: [{ codec_type: 'video', duration: 'N/A', duration_ts: duration, time_base: '1/24' }],
        })
      ).toBeNull();
    }
  });

  it('rejects inherited fields and accessor-shaped records instead of reading ambient state', () => {
    const inheritedStream = Object.assign(Object.create({ duration: '4' }), { codec_type: 'video' });
    const accessorStream = { codec_type: 'video' } as Record<string, unknown>;
    Object.defineProperty(accessorStream, 'duration', {
      enumerable: true,
      get: () => {
        throw new Error('must not execute');
      },
    });

    expect(readStudioVideoDurationProbeV2({ streams: [inheritedStream], format: { duration: 'N/A' } })).toBeNull();
    expect(() => readStudioVideoDurationProbeV2({ streams: [accessorStream] })).not.toThrow();
    expect(readStudioVideoDurationProbeV2({ streams: [accessorStream] })).toBeNull();
  });
});
