/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment node
 */

import { spawn as nativeSpawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { chmod, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StudioProjectV2 } from '@/common/types/project/creativeStudioTypes';
import {
  deriveStudioFilmRequiredAssetIdsV2,
  deriveStudioQuietTailTrimSecondsV2,
  createStudioFilmExporterV2,
} from '@/process/services/creative-studio/service/filmExporter';

const frame = (value: number): Uint8Array => new Uint8Array(160 * 90).fill(value);
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

const slateProject = (): StudioProjectV2 => ({
  schemaVersion: 5,
  revision: 1,
  id: 'project_1',
  name: 'Slate film',
  brief: 'A bounded local render.',
  rules: [],
  briefConversationId: null,
  aspectRatio: '16:9',
  targetDurationSeconds: 5,
  resolution: '720p',
  boardStyle: null,
  beatOrder: ['beat_1'],
  beats: {
    beat_1: { id: 'beat_1', title: 'Slate', story: 'Pending coverage', targetSeconds: 5, shotOrder: [] },
  },
  shots: {},
  referencePlanStatus: 'unplanned',
  referenceOrder: [],
  references: {},
  bin: [],
  bedAssetId: null,
  spendPolicy: null,
  spendAuthorizations: [],
  frameExtractions: {},
  undoHistory: [],
  imageRouteId: null,
  videoRouteId: null,
  assets: {},
  jobs: {},
  createdAt: '2026-08-20T00:00:00.000Z',
  updatedAt: '2026-08-20T00:00:00.000Z',
});

const fakeFfmpegPair = async (
  options: { hangFfmpegVersion?: boolean } = {}
): Promise<{ root: string; ffmpeg: string; ffprobe: string }> => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'studio-film-fake-'));
  temporaryDirectories.push(root);
  const ffmpeg = path.join(root, 'ffmpeg');
  const ffprobe = path.join(root, 'ffprobe');
  await writeFile(
    ffmpeg,
    `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
if (args.includes('-version')) {
  if (${options.hangFfmpegVersion === true ? 'true' : 'false'}) setInterval(() => undefined, 1000);
  else process.stdout.write('ffmpeg fake\\n');
} else if (args.includes('-encoders')) {
  if (${options.hangFfmpegVersion === true ? 'true' : 'false'}) setInterval(() => undefined, 1000);
  else process.stdout.write(' V..... h264_videotoolbox fake\\n A..... aac fake\\n');
} else if (args.includes('-filters')) {
  process.stdout.write(' T.. color\\n T.. anullsrc\\n T.. scale\\n T.. pad\\n T.. setsar\\n T.. fps\\n T.. trim\\n T.. setpts\\n T.. format\\n T.. aformat\\n T.. apad\\n T.. atrim\\n T.. asetpts\\n T.. concat\\n T.. xfade\\n T.. acrossfade\\n T.. volume\\n T.. amix\\n T.. afade\\n T.. alimiter\\n');
} else if (args.includes('-demuxers')) {
  process.stdout.write(' D mov,mp4\\n D matroska,webm\\n D wav\\n');
} else if (args.includes('-muxers')) {
  process.stdout.write(' E mp4\\n E rawvideo\\n');
} else if (args.includes('-protocols')) {
  process.stdout.write('Input:\\n  fd\\nOutput:\\n  fd\\n  pipe\\n');
} else if (args.includes('rawvideo')) {
  process.stdout.write(Buffer.alloc(160 * 90 * 4, 20));
} else if (args.at(-1) === '-') {
  // Decoder capability smoke test.
} else {
  const target = args.at(-1) === 'fd:' ? Number(args[args.lastIndexOf('-fd') + 1]) : args.at(-1);
  fs.writeFileSync(target, Buffer.from('film'));
  if (args.includes('-progress')) process.stdout.write('out_time_ms=5000000\\nprogress=end\\n');
}
`,
    { mode: 0o700 }
  );
  await writeFile(
    ffprobe,
    `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args.includes('-version')) {
  process.stdout.write('ffprobe fake\\n');
} else if (args.includes('stream=codec_type')) {
  process.stdout.write(JSON.stringify({ streams: [{ codec_type: 'video' }, { codec_type: 'audio' }] }));
} else {
  process.stdout.write(JSON.stringify({
    streams: [
      { codec_type: 'video', codec_name: 'h264', profile: 'High', level: 42, width: 1280, height: 720, pix_fmt: 'yuv420p', sample_aspect_ratio: '1:1', color_range: 'tv', color_space: 'bt709', color_transfer: 'bt709', color_primaries: 'bt709', r_frame_rate: '24/1', avg_frame_rate: '24/1', time_base: '1/24000', duration: '5.0', nb_frames: '120' },
      { codec_type: 'audio', codec_name: 'aac', sample_fmt: 'fltp', sample_rate: '48000', channels: 2, channel_layout: 'stereo', duration: '5.0' }
    ],
    format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2', duration: '5.0' }
  }));
}
`,
    { mode: 0o700 }
  );
  await Promise.all([chmod(ffmpeg, 0o700), chmod(ffprobe, 0o700)]);
  return { root, ffmpeg, ffprobe };
};

/**
 * Cases here spawn export children and wait on their settlement, so they are bound by process
 * scheduling rather than by their assertions. The duration sweep of 2026-08-28 measured one at 5.7s.
 *
 * Two separate budgets are needed. The suite ceiling covers the test itself, which exceeded the 10s
 * global testTimeout under full-suite parallelism. `vi.waitFor` keeps its own 1000ms default, which
 * the suite ceiling does not raise — the push gate failed here on `expect(failedChild).not.toBeNull()`,
 * which is waitFor rethrowing its last assertion after giving up on a child that had not yet been
 * spawned, not a logic error. Both are hang-detectors rather than performance budgets: a genuine hang
 * still fails, just later, and no assertion is weakened.
 */
const FILM_EXPORT_TIMEOUT_MS = 120_000;
const FILM_EXPORT_WAIT = { timeout: 30_000 } as const;

describe('schema-2 film export contract', { timeout: FILM_EXPORT_TIMEOUT_MS }, () => {
  it('derives a bounded frame-quantized quiet-tail cut only from a three-delta suffix', () => {
    expect(deriveStudioQuietTailTrimSecondsV2([frame(20), frame(20), frame(20), frame(20)], 4, 1)).toBe(0.375);
    expect(deriveStudioQuietTailTrimSecondsV2([frame(0), frame(50), frame(100), frame(150)], 4, 1)).toBe(0);
    expect(deriveStudioQuietTailTrimSecondsV2([frame(20), frame(20), frame(20)], 4, 1)).toBe(0);
  });

  it('protects the minimum remaining duration and refuses malformed decoded frames', () => {
    expect(deriveStudioQuietTailTrimSecondsV2([frame(1), frame(1), frame(1), frame(1)], 1.2, 1)).toBe(4 / 24);
    expect(deriveStudioQuietTailTrimSecondsV2([frame(1), frame(1), frame(1), frame(1)], 1, 1)).toBe(0);
    expect(deriveStudioQuietTailTrimSecondsV2([new Uint8Array(2), frame(1), frame(1), frame(1)], 4, 1)).toBe(0);
  });

  it('freezes unique selected-video sources in film order and appends the bed once', () => {
    const project = {
      beatOrder: ['beat_1', 'beat_2'],
      beats: {
        beat_1: { shotOrder: ['shot_1', 'shot_2'] },
        beat_2: { shotOrder: ['shot_3'] },
      },
      shots: {
        shot_1: { videoAssetId: 'take_1' },
        shot_2: { videoAssetId: 'take_1' },
        shot_3: { videoAssetId: null },
      },
      bedAssetId: 'bed_1',
    } as unknown as StudioProjectV2;

    expect(deriveStudioFilmRequiredAssetIdsV2(project)).toEqual(['take_1', 'bed_1']);
  });

  it('fails closed when film order points to a missing Beat or Shot', () => {
    expect(() =>
      deriveStudioFilmRequiredAssetIdsV2({
        beatOrder: ['missing'],
        beats: {},
        shots: {},
        bedAssetId: null,
      } as unknown as StudioProjectV2)
    ).toThrow(expect.objectContaining({ code: 'invalid_project' }));
  });

  it('probes, renders, verifies, streams, and exactly cleans an all-slate film with a fake binary pair', async () => {
    const binaries = await fakeFfmpegPair();
    const exporter = createStudioFilmExporterV2({
      ffmpegBinary: binaries.ffmpeg,
      ffprobeBinary: binaries.ffprobe,
      tempRoot: binaries.root,
    });
    await expect(exporter.capability()).resolves.toEqual({
      status: 'ready',
      encoder: 'h264_videotoolbox',
    });
    const progress: Array<{ phase: string; progress: number | null }> = [];
    const rendered = await exporter.render({
      project: slateProject(),
      transition: { kind: 'cut' },
      trimTails: false,
      sources: [],
      signal: new AbortController().signal,
      onProgress: (value) => progress.push(value),
    });
    expect(rendered.facts).toMatchObject({
      nominalDurationSeconds: 5,
      renderedDurationSeconds: 5,
      transition: { kind: 'cut' },
      dissolveCount: 0,
      trimTails: false,
      segments: [{ kind: 'slate', beatId: 'beat_1', shotId: null, durationSeconds: 5 }],
      audio: { bedAssetId: null, takeGain: 1, dissolveCrossfade: false },
    });
    expect(rendered.byteSize).toBe(4);
    expect(rendered.sha256).toMatch(/^[a-f0-9]{64}$/u);
    const chunks: Buffer[] = [];
    for await (const chunk of await rendered.openVerifiedStream()) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks).toString('utf8')).toBe('film');
    expect(progress).toContainEqual({ phase: 'rendering', progress: 1 });
    await expect(rendered.cleanup()).resolves.toBeUndefined();
    exporter.dispose();
  });

  it('reports a missing executable and refuses aborted or invalid render requests before publication', async () => {
    const missing = createStudioFilmExporterV2({
      ffmpegBinary: '/definitely/missing/ffmpeg',
      ffprobeBinary: '/definitely/missing/ffprobe',
    });
    await expect(missing.capability()).resolves.toEqual({ status: 'unavailable', reason: 'ffmpeg_unavailable' });

    const binaries = await fakeFfmpegPair();
    const missingProbe = createStudioFilmExporterV2({
      ffmpegBinary: binaries.ffmpeg,
      ffprobeBinary: path.join(binaries.root, 'missing-ffprobe'),
      tempRoot: binaries.root,
    });
    await expect(missingProbe.capability()).resolves.toEqual({ status: 'unavailable', reason: 'ffprobe_unavailable' });
    const exporter = createStudioFilmExporterV2({
      ffmpegBinary: binaries.ffmpeg,
      ffprobeBinary: binaries.ffprobe,
      tempRoot: binaries.root,
    });
    const aborted = new AbortController();
    aborted.abort();
    await expect(
      exporter.render({
        project: slateProject(),
        transition: { kind: 'cut' },
        trimTails: false,
        sources: [],
        signal: aborted.signal,
        onProgress: () => undefined,
      })
    ).rejects.toMatchObject({ code: 'cancelled' });
    await expect(
      exporter.render({
        project: slateProject(),
        transition: { kind: 'dissolve', seconds: 0 },
        trimTails: false,
        sources: [],
        signal: new AbortController().signal,
        onProgress: () => undefined,
      })
    ).rejects.toMatchObject({ code: 'invalid_project' });
  });

  it('aborts in-flight capability discovery when the exporter is disposed', async () => {
    const binaries = await fakeFfmpegPair({ hangFfmpegVersion: true });
    const exporter = createStudioFilmExporterV2({
      ffmpegBinary: binaries.ffmpeg,
      ffprobeBinary: binaries.ffprobe,
      tempRoot: binaries.root,
    });
    const capability = exporter.capability();
    exporter.dispose();
    await expect(capability).resolves.toEqual({ status: 'unavailable', reason: 'unsupported_capabilities' });
    await expect(exporter.capability()).resolves.toEqual({
      status: 'unavailable',
      reason: 'unsupported_capabilities',
    });
  });

  it('awaits every capability child before bounded disposal settles', async () => {
    vi.useFakeTimers();
    try {
      const children: ChildProcessWithoutNullStreams[] = [];
      const spawnProcess = vi.fn(() => {
        const emitter = new EventEmitter();
        const childIndex = children.length;
        const child = Object.assign(emitter, {
          exitCode: null,
          signalCode: null,
          pid: undefined,
          stdin: new PassThrough(),
          stdout: new PassThrough(),
          stderr: new PassThrough(),
          kill: vi.fn(() => {
            if (childIndex === 0) queueMicrotask(() => emitter.emit('close', null, 'SIGKILL'));
            return true;
          }),
        }) as unknown as ChildProcessWithoutNullStreams;
        children.push(child);
        return child;
      });
      const exporter = createStudioFilmExporterV2({ spawnProcess });
      const capability = exporter.capability();
      let settled = false;
      const observed = capability.finally(() => {
        settled = true;
      });
      const outcome = expect(observed).rejects.toMatchObject({ code: 'child_settlement_failed' });
      await vi.waitFor(() => expect(children).toHaveLength(5), FILM_EXPORT_WAIT);
      exporter.dispose();
      await vi.advanceTimersByTimeAsync(4_999);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await outcome;
      expect(children.every((child) => vi.mocked(child.kill).mock.calls.some(([signal]) => signal === 'SIGKILL'))).toBe(
        true
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps child failure authoritative when cancellation arrives while tree settlement is pending', async () => {
    const binaries = await fakeFfmpegPair();
    let interceptRender = false;
    let failedChild: ChildProcessWithoutNullStreams | null = null;
    const spawnProcess = ((command: string, args: readonly string[], options: Parameters<typeof nativeSpawn>[2]) => {
      if (interceptRender && args.includes('-filter_complex') && args.includes('-progress')) {
        const emitter = new EventEmitter();
        failedChild = Object.assign(emitter, {
          exitCode: null,
          signalCode: null,
          pid: undefined,
          stdin: new PassThrough(),
          stdout: new PassThrough(),
          stderr: new PassThrough(),
          kill: vi.fn(() => true),
        }) as unknown as ChildProcessWithoutNullStreams;
        return failedChild;
      }
      return nativeSpawn(command, [...args], options);
    }) as typeof nativeSpawn;
    const exporter = createStudioFilmExporterV2({
      ffmpegBinary: binaries.ffmpeg,
      ffprobeBinary: binaries.ffprobe,
      tempRoot: binaries.root,
      spawnProcess,
    });
    await expect(exporter.capability()).resolves.toMatchObject({ status: 'ready' });
    interceptRender = true;
    const controller = new AbortController();
    const pending = exporter.render({
      project: slateProject(),
      transition: { kind: 'cut' },
      trimTails: false,
      sources: [],
      signal: controller.signal,
      onProgress: () => undefined,
    });
    const outcome = expect(pending).rejects.toMatchObject({ code: 'render_failed' });
    await vi.waitFor(() => expect(failedChild).not.toBeNull(), FILM_EXPORT_WAIT);
    failedChild!.emit('error', new Error('render child failed first'));
    await vi.waitFor(() => expect(vi.mocked(failedChild!.kill)).toHaveBeenCalledWith('SIGKILL'), FILM_EXPORT_WAIT);
    controller.abort();
    failedChild!.emit('close', null, 'SIGKILL');
    await outcome;
    expect((await readdir(binaries.root)).filter((name) => name.startsWith('weprompt-film-'))).toEqual([]);
    exporter.dispose();
  });

  it('reports child settlement failure when abort cannot prove child settlement', async () => {
    const binaries = await fakeFfmpegPair();
    let interceptRender = false;
    let stubbornChild: ChildProcessWithoutNullStreams | null = null;
    const spawnProcess = ((command: string, args: readonly string[], options: Parameters<typeof nativeSpawn>[2]) => {
      if (interceptRender && args.includes('-filter_complex') && args.includes('-progress')) {
        const emitter = new EventEmitter();
        stubbornChild = Object.assign(emitter, {
          exitCode: null,
          signalCode: null,
          pid: undefined,
          stdin: new PassThrough(),
          stdout: new PassThrough(),
          stderr: new PassThrough(),
          kill: vi.fn(() => true),
        }) as unknown as ChildProcessWithoutNullStreams;
        return stubbornChild;
      }
      return nativeSpawn(command, [...args], options);
    }) as typeof nativeSpawn;
    const exporter = createStudioFilmExporterV2({
      ffmpegBinary: binaries.ffmpeg,
      ffprobeBinary: binaries.ffprobe,
      tempRoot: binaries.root,
      spawnProcess,
    });
    await expect(exporter.capability()).resolves.toMatchObject({ status: 'ready' });
    interceptRender = true;
    const controller = new AbortController();
    const pending = exporter.render({
      project: slateProject(),
      transition: { kind: 'cut' },
      trimTails: false,
      sources: [],
      signal: controller.signal,
      onProgress: () => undefined,
    });
    const outcome = expect(pending).rejects.toMatchObject({ code: 'child_settlement_failed' });
    await vi.waitFor(() => expect(stubbornChild).not.toBeNull(), FILM_EXPORT_WAIT);
    controller.abort();
    await outcome;
    expect(vi.mocked(stubbornChild!.kill)).toHaveBeenCalledWith('SIGKILL');
    expect((await readdir(binaries.root)).filter((name) => name.startsWith('weprompt-film-'))).toEqual([]);
    exporter.dispose();
  }, 15_000);
});
