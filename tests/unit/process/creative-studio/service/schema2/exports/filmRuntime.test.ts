/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment node
 */

import { createHash } from 'node:crypto';
import { chmod, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  STUDIO_EXPORT_SCHEMA_VERSION_V2,
  type StudioAssetV2,
  type StudioProjectV2,
} from '@/common/types/project/creativeStudioTypes';
import type { StudioEditorFolderCompositionV2 } from '@/process/services/creative-studio/service/schema2/exports/editorFolder';
import {
  createStudioFilmExporterV2,
  deriveStudioFilmDimensionsV2,
  type StudioFilmVerifiedSourceV2,
} from '@/process/services/creative-studio/service/filmExporter';

const NOW = '2026-08-20T00:00:00.000Z';
const temporaryDirectories: string[] = [];
const REQUIRED_FILTER_NAMES = [
  'color',
  'anullsrc',
  'scale',
  'pad',
  'setsar',
  'fps',
  'trim',
  'setpts',
  'format',
  'aformat',
  'apad',
  'atrim',
  'asetpts',
  'concat',
  'xfade',
  'acrossfade',
  'volume',
  'amix',
  'afade',
  'alimiter',
] as const;
const FFMPEG_8_FILTER_INVENTORY = REQUIRED_FILTER_NAMES.map((name) => ` T.. ${name}`).join('\n') + '\n';
const FFMPEG_9_FILTER_INVENTORY =
  REQUIRED_FILTER_NAMES.map((name, index) => {
    const flags = index % 3 === 0 ? 'TS' : index % 3 === 1 ? 'T.' : '..';
    return ` ${flags} ${name.padEnd(17)} ${name === 'xfade' ? 'VV->V' : name === 'acrossfade' ? 'N->A' : 'A->A'}`;
  }).join('\n') + '\n';

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

type FakeBinaryOptions = {
  durationSeconds?: number;
  width?: number;
  height?: number;
  filters?: string;
  encoders?: string;
  renderFailure?: boolean;
  verifyDurationSeconds?: number;
  malformedMediaProbe?: boolean;
  mediaVideoDurationSeconds?: number | 'N/A';
  mediaVideoDurationTag?: string;
  mediaVideoDurationTicks?: number;
  mediaVideoTimeBase?: string;
  mediaAudioDurationSeconds?: number | 'N/A';
  mediaContainerDurationSeconds?: number;
  profile?: string;
  level?: number;
  colorPrimaries?: string;
  colorTransfer?: string;
  finalLevel?: number;
};

const fakeFfmpegPair = async (options: FakeBinaryOptions = {}) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'studio-film-runtime-'));
  temporaryDirectories.push(root);
  const ffmpeg = path.join(root, 'ffmpeg');
  const ffprobe = path.join(root, 'ffprobe');
  const invocationLog = path.join(root, 'invocations.ndjson');
  const durationSeconds = options.durationSeconds ?? 9;
  const mediaVideoStream = {
    codec_type: 'video',
    duration: String(options.mediaVideoDurationSeconds ?? 4),
    ...(options.mediaVideoDurationTag === undefined ? {} : { tags: { DURATION: options.mediaVideoDurationTag } }),
    ...(options.mediaVideoDurationTicks === undefined ? {} : { duration_ts: String(options.mediaVideoDurationTicks) }),
    ...(options.mediaVideoTimeBase === undefined ? {} : { time_base: options.mediaVideoTimeBase }),
  };
  const mediaAudioStream = {
    codec_type: 'audio',
    duration: String(options.mediaAudioDurationSeconds ?? options.mediaContainerDurationSeconds ?? 4),
  };
  await writeFile(
    ffmpeg,
    `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(invocationLog)}, JSON.stringify({ binary: 'ffmpeg', args }) + '\\n');
if (args.includes('-encoders')) {
  process.stdout.write(${JSON.stringify(options.encoders ?? ' V..... h264_videotoolbox fake\n A..... aac fake\n')});
} else if (args.includes('-filters')) {
  process.stdout.write(${JSON.stringify(options.filters ?? FFMPEG_8_FILTER_INVENTORY)});
} else if (args.includes('-demuxers')) {
  process.stdout.write(' D mov,mp4\\n D matroska,webm\\n D wav\\n');
} else if (args.includes('-muxers')) {
  process.stdout.write(' E mp4\\n E rawvideo\\n');
} else if (args.includes('-protocols')) {
  process.stdout.write('Input:\\n  fd\\nOutput:\\n  fd\\n  pipe\\n');
} else if (args.includes('rawvideo')) {
  process.stdout.write(Buffer.alloc(160 * 90 * 5, 20));
} else if (args.at(-1).endsWith('probe.mp4')) {
  fs.writeFileSync(args.at(-1), Buffer.from('probe'));
} else if (args.at(-1) === '-') {
  // Decoder capability smoke test.
} else if (${options.renderFailure === true ? 'true' : 'false'} && args.includes('-filter_complex')) {
  fs.writeFileSync(Number(args[args.lastIndexOf('-fd') + 1]), Buffer.alloc(128 * 1024, 7));
  process.exitCode = 9;
} else {
  fs.writeFileSync(Number(args[args.lastIndexOf('-fd') + 1]), Buffer.from('film'));
  if (args.includes('-progress')) process.stdout.write('out_time_ms=${Math.round(durationSeconds * 1_000_000)}\\nprogress=end\\n');
}
`,
    { mode: 0o700 }
  );
  await writeFile(
    ffprobe,
    `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(invocationLog)}, JSON.stringify({ binary: 'ffprobe', args }) + '\\n');
if (args.includes('-version')) {
  process.stdout.write('ffprobe fake\\n');
} else if (args.some((arg) => arg.startsWith('stream=codec_type'))) {
  if (${options.malformedMediaProbe === true ? 'true' : 'false'}) process.stdout.write('{');
  else {
    const source = fs.readFileSync(3, 'utf8');
    process.stdout.write(JSON.stringify({
      streams: source === 'video-one'
        ? [${JSON.stringify(mediaVideoStream)}, ${JSON.stringify(mediaAudioStream)}]
        : [${JSON.stringify(mediaVideoStream)}],
      format: { duration: '${options.mediaContainerDurationSeconds ?? 4}' }
    }));
  }
} else {
  const exactProbeCount = fs.readFileSync(${JSON.stringify(invocationLog)}, 'utf8')
    .trim()
    .split('\\n')
    .map((line) => JSON.parse(line))
    .filter((entry) => entry.binary === 'ffprobe' && !entry.args.includes('-version') && !entry.args.some((arg) => arg.startsWith('stream=codec_type')))
    .length;
  process.stdout.write(JSON.stringify({
    streams: [
      { codec_type: 'video', codec_name: 'h264', profile: ${JSON.stringify(options.profile ?? 'High')}, level: exactProbeCount > 1 ? ${options.finalLevel ?? options.level ?? 42} : ${options.level ?? 42}, width: ${options.width ?? 1080}, height: ${options.height ?? 1920}, pix_fmt: 'yuv420p', sample_aspect_ratio: '1:1', color_range: 'tv', color_space: 'bt709', color_transfer: ${JSON.stringify(options.colorTransfer ?? 'bt709')}, color_primaries: ${JSON.stringify(options.colorPrimaries ?? 'bt709')}, r_frame_rate: '24/1', avg_frame_rate: '24/1', time_base: '1/24000', duration: '${options.verifyDurationSeconds ?? durationSeconds}', nb_frames: '${Math.round((options.verifyDurationSeconds ?? durationSeconds) * 24)}' },
      { codec_type: 'audio', codec_name: 'aac', sample_fmt: 'fltp', sample_rate: '48000', channels: 2, channel_layout: 'stereo', duration: '${options.verifyDurationSeconds ?? durationSeconds}' }
    ],
    format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2', duration: '${options.verifyDurationSeconds ?? durationSeconds}' }
  }));
}
`,
    { mode: 0o700 }
  );
  await Promise.all([chmod(ffmpeg, 0o700), chmod(ffprobe, 0o700)]);
  return { root, ffmpeg, ffprobe, invocationLog };
};

const bytesFor = (value: string): Uint8Array => Buffer.from(value, 'utf8');
const digestFor = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

const asset = (input: {
  id: string;
  shotId: string | null;
  kind: 'video' | 'audio';
  bytes: Uint8Array;
  durationSeconds: number;
}): StudioAssetV2 => ({
  id: input.id,
  projectId: 'project_1',
  shotId: input.shotId,
  mediaKind: input.kind,
  mimeType: input.kind === 'video' ? 'video/mp4' : 'audio/wav',
  managedAsset: { collection: 'assets', fileName: `${input.id}.${input.kind === 'video' ? 'mp4' : 'wav'}` },
  byteSize: input.bytes.byteLength,
  sha256: digestFor(input.bytes),
  durationSeconds: input.durationSeconds,
  projectReferenceId: null,
  generationReferenceAssetIds: [],
  producerJobId: null,
  compositionDigest: null,
  createdAt: NOW,
});

const sourceFor = (sourceAsset: StudioAssetV2, bytes: Uint8Array): StudioFilmVerifiedSourceV2 => ({
  asset: sourceAsset,
  openVerifiedStream: async () =>
    (async function* stream() {
      yield bytes;
    })(),
});

const VIDEO_ONE_BYTES = bytesFor('video-one');
const VIDEO_TWO_BYTES = bytesFor('video-two');
const BED_BYTES = bytesFor('audio-bed');
const VIDEO_ONE = asset({ id: 'video_1', shotId: 'shot_1', kind: 'video', bytes: VIDEO_ONE_BYTES, durationSeconds: 4 });
const VIDEO_TWO = asset({ id: 'video_2', shotId: 'shot_2', kind: 'video', bytes: VIDEO_TWO_BYTES, durationSeconds: 4 });
const BED = asset({ id: 'bed_1', shotId: null, kind: 'audio', bytes: BED_BYTES, durationSeconds: 10 });

const project = (overrides: Partial<StudioProjectV2> = {}): StudioProjectV2 =>
  ({
    id: 'project_1',
    revision: 4,
    name: 'Runtime film',
    aspectRatio: '9:16',
    resolution: '1080p',
    beatOrder: ['beat_1'],
    beats: { beat_1: { id: 'beat_1', shotOrder: ['shot_1', 'shot_2'] } },
    shots: {
      shot_1: { id: 'shot_1', videoAssetId: VIDEO_ONE.id },
      shot_2: { id: 'shot_2', videoAssetId: VIDEO_TWO.id },
    },
    assets: { [VIDEO_ONE.id]: VIDEO_ONE, [VIDEO_TWO.id]: VIDEO_TWO, [BED.id]: BED },
    bedAssetId: BED.id,
    ...overrides,
  }) as StudioProjectV2;

const composition = (): StudioEditorFolderCompositionV2 => ({
  timeline: {
    schemaVersion: STUDIO_EXPORT_SCHEMA_VERSION_V2,
    projectId: 'project_1',
    sourceRevision: 4,
    name: 'Runtime film',
    aspectRatio: '9:16',
    resolution: '1080p',
    durationSeconds: 10,
    beats: [
      {
        beatId: 'beat_1',
        title: 'Beat',
        timelineStartSeconds: 0,
        durationSeconds: 10,
        entries: [
          {
            kind: 'shot',
            shotOrdinal: 1,
            shotId: 'shot_1',
            videoAssetId: VIDEO_ONE.id,
            relativePath: 'media/video_1.mp4',
            timelineStartSeconds: 0,
            sourceInSeconds: 0,
            sourceOutSeconds: 4,
            durationSeconds: 4,
            chainBreak: 'none',
          },
          {
            kind: 'shot',
            shotOrdinal: 2,
            shotId: 'shot_2',
            videoAssetId: VIDEO_TWO.id,
            relativePath: 'media/video_2.mp4',
            timelineStartSeconds: 4,
            sourceInSeconds: 0,
            sourceOutSeconds: 4,
            durationSeconds: 4,
            chainBreak: 'none',
          },
          {
            kind: 'slate',
            shotOrdinal: null,
            shotId: null,
            relativePath: 'media/slate.png',
            timelineStartSeconds: 8,
            durationSeconds: 2,
          },
        ],
      },
    ],
    bed: {
      assetId: BED.id,
      relativePath: 'media/bed.wav',
      sourceInSeconds: 0,
      sourceOutSeconds: 10,
      fadeOutStartSeconds: 8,
      fadeOutEndSeconds: 10,
    },
  },
  timelineBytes: new Uint8Array(),
  files: [],
  manifest: [],
  manifestBytes: new Uint8Array(),
  manifestSha256: 'a'.repeat(64),
  byteSize: 0,
  payloadFileCount: 0,
});

const sources = (): StudioFilmVerifiedSourceV2[] => [
  sourceFor(VIDEO_ONE, VIDEO_ONE_BYTES),
  sourceFor(VIDEO_TWO, VIDEO_TWO_BYTES),
  sourceFor(BED, BED_BYTES),
];

const singleShotFixture = (input: {
  storedDurationSeconds: number;
  sourceInSeconds?: number;
  trimOutSeconds?: number;
  mimeType?: 'video/mp4' | 'video/webm';
}) => {
  const sourceInSeconds = input.sourceInSeconds ?? 0;
  const trimOutSeconds = input.trimOutSeconds ?? 0;
  const sourceOutSeconds = input.storedDurationSeconds - trimOutSeconds;
  const baseAsset = asset({
    id: VIDEO_ONE.id,
    shotId: 'shot_1',
    kind: 'video',
    bytes: VIDEO_ONE_BYTES,
    durationSeconds: input.storedDurationSeconds,
  });
  const sourceAsset: StudioAssetV2 =
    input.mimeType === 'video/webm'
      ? {
          ...baseAsset,
          mimeType: 'video/webm',
          managedAsset: { collection: 'assets', fileName: `${baseAsset.id}.webm` },
        }
      : baseAsset;
  const baseProject = project();
  const sourceProject = project({
    beatOrder: ['beat_1'],
    beats: { beat_1: { ...baseProject.beats.beat_1!, shotOrder: ['shot_1'] } },
    shots: {
      shot_1: {
        ...baseProject.shots.shot_1!,
        videoAssetId: sourceAsset.id,
        trimInSeconds: sourceInSeconds === 0 ? null : sourceInSeconds,
        trimOutSeconds: trimOutSeconds === 0 ? null : trimOutSeconds,
      },
    },
    assets: { [sourceAsset.id]: sourceAsset },
    bedAssetId: null,
  });
  const compose = (): StudioEditorFolderCompositionV2 => {
    const base = composition();
    return {
      ...base,
      timeline: {
        ...base.timeline,
        durationSeconds: sourceOutSeconds - sourceInSeconds,
        beats: [
          {
            ...base.timeline.beats[0]!,
            durationSeconds: sourceOutSeconds - sourceInSeconds,
            entries: [
              {
                kind: 'shot',
                shotOrdinal: 1,
                shotId: 'shot_1',
                videoAssetId: sourceAsset.id,
                relativePath: 'media/video_1.mp4',
                timelineStartSeconds: 0,
                sourceInSeconds,
                sourceOutSeconds,
                durationSeconds: sourceOutSeconds - sourceInSeconds,
                chainBreak: 'none',
              },
            ],
          },
        ],
        bed: null,
      },
    };
  };
  const source = sourceFor(sourceAsset, VIDEO_ONE_BYTES);
  return {
    project: sourceProject,
    source,
    compose,
  };
};

/**
 * Every case in this file writes a fake ffmpeg/ffprobe pair to disk and runs the real exporter
 * over it, so each one is dominated by process spawning rather than by its assertions. Measured
 * in isolation on a quiet machine the original cases ran 0ms-3.9s, but under full-suite parallelism
 * one of them exceeded the 10s global testTimeout — and the case that lost the race was a 1.35s
 * one, not the slowest, so no per-case ceiling derived from isolated timings would be safe.
 *
 * The suite-wide ceiling below matches the reasoning already recorded for the fake POSIX
 * toolchain cases in tests/unit/assets/prepareAioncoreActionsArtifact.test.ts, where 30s was
 * tried and still proved too tight. These cases are I/O bound, so a generous ceiling costs
 * nothing and only prevents false failures; a genuine hang still fails, just later. The
 * assertions are untouched by it. Do not lower this toward the global default without
 * re-measuring under full-suite load.
 */
const FAKE_FFMPEG_TIMEOUT_MS = 120_000;

describe('schema-2 film runtime', { timeout: FAKE_FFMPEG_TIMEOUT_MS }, () => {
  it('accepts both FFmpeg 8 and FFmpeg 9 filter-inventory column formats', async () => {
    for (const filters of [FFMPEG_8_FILTER_INVENTORY, FFMPEG_9_FILTER_INVENTORY]) {
      const binaries = await fakeFfmpegPair({ filters });
      const exporter = createStudioFilmExporterV2({
        ffmpegBinary: binaries.ffmpeg,
        ffprobeBinary: binaries.ffprobe,
        tempRoot: binaries.root,
      });
      await expect(exporter.capability()).resolves.toEqual({
        status: 'ready',
        encoder: 'h264_videotoolbox',
      });
    }
  });

  it('keeps Film unavailable when the encoder smoke violates the exact H.264 or BT.709 contract', async () => {
    for (const options of [
      { profile: 'Main' },
      { level: 41 },
      { colorPrimaries: 'smpte170m' },
      { colorTransfer: 'smpte170m' },
    ]) {
      const binaries = await fakeFfmpegPair(options);
      const exporter = createStudioFilmExporterV2({
        ffmpegBinary: binaries.ffmpeg,
        ffprobeBinary: binaries.ffprobe,
        tempRoot: binaries.root,
      });
      await expect(exporter.capability()).resolves.toEqual({
        status: 'unavailable',
        reason: 'unsupported_capabilities',
      });
    }
  });

  it('stages verified media and renders trimmed shot dissolves, silence, slates, and a bounded audio bed', async () => {
    const binaries = await fakeFfmpegPair();
    const exporter = createStudioFilmExporterV2({
      ffmpegBinary: binaries.ffmpeg,
      ffprobeBinary: binaries.ffprobe,
      tempRoot: binaries.root,
      composeEditorFolder: composition,
    });
    const phases: string[] = [];
    const result = await exporter.render({
      project: project(),
      transition: { kind: 'dissolve', seconds: 0.5 },
      trimTails: true,
      sources: sources(),
      signal: new AbortController().signal,
      onProgress: ({ phase }) => phases.push(phase),
    });

    expect(result.facts).toMatchObject({
      nominalDurationSeconds: 10,
      renderedDurationSeconds: 9,
      dissolveCount: 1,
      trimTails: true,
      video: {
        width: 1080,
        height: 1920,
        frameRate: 24,
        pixelFormat: 'yuv420p',
        profile: 'high',
        level: '4.2',
        colorPrimaries: 'bt709',
        colorTransfer: 'bt709',
        colorSpace: 'bt709',
        colorRange: 'tv',
      },
      audio: {
        takeGain: 0.85,
        bedAssetId: BED.id,
        bedSha256: BED.sha256,
        bedGain: 0.2,
        bedFadeOutSeconds: 2,
        dissolveCrossfade: true,
      },
      segments: [
        { kind: 'shot', shotId: 'shot_1', renderedSourceOutSeconds: 3.5 },
        { kind: 'shot', shotId: 'shot_2', renderedSourceOutSeconds: 4 },
        { kind: 'slate', beatId: 'beat_1', shotId: null, durationSeconds: 2 },
      ],
    });
    expect(phases).toEqual(expect.arrayContaining(['preparing', 'analyzing', 'rendering']));

    const invocations = (await readFile(binaries.invocationLog, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { binary: string; args: string[] });
    const render = invocations.find(
      ({ binary, args }) => binary === 'ffmpeg' && args.includes('-filter_complex') && args.at(-1) === 'fd:'
    );
    expect(render).toBeDefined();
    const graph = render!.args[render!.args.indexOf('-filter_complex') + 1]!;
    expect(graph).toContain('xfade=transition=fade:duration=0.5');
    expect(graph).toContain('acrossfade=d=0.5');
    expect(graph).toContain('concat=n=2:v=1:a=1');
    expect(graph).toContain('amix=inputs=2');
    expect(graph).toContain('alimiter=limit=0.95');
    expect(render!.args).toContain('12M');
    expect(render!.args).toEqual(
      expect.arrayContaining([
        '-profile:v',
        'high',
        '-level:v',
        '4.2',
        '-g',
        '48',
        '-b:a',
        '192k',
        '-ar',
        '48000',
        '-ac',
        '2',
        '-video_track_timescale',
        '24000',
        '-map_metadata',
        '-1',
        '-map_chapters',
        '-1',
        '-bsf:v',
        'h264_metadata=video_full_range_flag=0:colour_primaries=1:transfer_characteristics=1:matrix_coefficients=1',
        '-color_primaries',
        'bt709',
        '-color_trc',
        'bt709',
        '-colorspace',
        'bt709',
        '-color_range',
        'tv',
      ])
    );
    expect(render!.args).not.toContain('-movflags');
    await result.cleanup();
  });

  it('clamps a bounded AAC/container tail to decoded video while retaining authored Film facts', async () => {
    const decodedVideoDurationSeconds = 241 / 24;
    const normalizedDurationSeconds = 241 / 24;
    const fixture = singleShotFixture({ storedDurationSeconds: 10.1 });
    const binaries = await fakeFfmpegPair({
      durationSeconds: normalizedDurationSeconds,
      verifyDurationSeconds: normalizedDurationSeconds,
      mediaVideoDurationSeconds: decodedVideoDurationSeconds,
      mediaVideoDurationTicks: 241_000,
      mediaVideoTimeBase: '1/24000',
      mediaAudioDurationSeconds: 10.1,
      mediaContainerDurationSeconds: 10.1,
    });
    const exporter = createStudioFilmExporterV2({
      ffmpegBinary: binaries.ffmpeg,
      ffprobeBinary: binaries.ffprobe,
      tempRoot: binaries.root,
      composeEditorFolder: fixture.compose,
    });

    const result = await exporter.render({
      project: fixture.project,
      transition: { kind: 'cut' },
      trimTails: false,
      sources: [fixture.source],
      signal: new AbortController().signal,
      onProgress: () => undefined,
    });

    expect(result.facts).toMatchObject({
      schemaVersion: 2,
      nominalDurationSeconds: 10.1,
      renderedDurationSeconds: normalizedDurationSeconds,
      segments: [
        {
          kind: 'shot',
          sourceOutSeconds: 10.1,
          effectiveSourceOutSeconds: decodedVideoDurationSeconds,
          renderedSourceOutSeconds: decodedVideoDurationSeconds,
          normalizedDurationSeconds,
        },
      ],
    });
    const invocations = (await readFile(binaries.invocationLog, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { binary: string; args: string[] });
    const render = invocations.find(({ binary, args }) => binary === 'ffmpeg' && args.includes('-filter_complex'));
    const graph = render?.args[render.args.indexOf('-filter_complex') + 1];
    expect(graph).toContain(`trim=duration=${decodedVideoDurationSeconds.toFixed(12)}`);
    expect(graph).not.toContain('tpad=');
    await result.cleanup();
  });

  it('reads an audio-bearing WebM video endpoint from its stream duration tag', async () => {
    const decodedVideoDurationSeconds = 10.041667;
    const normalizedDurationSeconds = 241 / 24;
    const fixture = singleShotFixture({ storedDurationSeconds: 10.1, mimeType: 'video/webm' });
    const binaries = await fakeFfmpegPair({
      durationSeconds: normalizedDurationSeconds,
      verifyDurationSeconds: normalizedDurationSeconds,
      mediaVideoDurationSeconds: 'N/A',
      mediaVideoDurationTag: '00:00:10.041667000',
      mediaAudioDurationSeconds: 'N/A',
      mediaContainerDurationSeconds: 10.1,
    });
    const exporter = createStudioFilmExporterV2({
      ffmpegBinary: binaries.ffmpeg,
      ffprobeBinary: binaries.ffprobe,
      tempRoot: binaries.root,
      composeEditorFolder: fixture.compose,
    });

    const result = await exporter.render({
      project: fixture.project,
      transition: { kind: 'cut' },
      trimTails: false,
      sources: [fixture.source],
      signal: new AbortController().signal,
      onProgress: () => undefined,
    });

    expect(result.facts.segments[0]).toMatchObject({
      kind: 'shot',
      sourceOutSeconds: 10.1,
      effectiveSourceOutSeconds: decodedVideoDurationSeconds,
      normalizedDurationSeconds,
    });
    await result.cleanup();
  });

  it('applies a nonzero authored trim-in before clamping to the decoded video endpoint', async () => {
    const decodedVideoDurationSeconds = 241 / 24;
    const sourceInSeconds = 1.25;
    const normalizedDurationSeconds = 211 / 24;
    const fixture = singleShotFixture({ storedDurationSeconds: 10.1, sourceInSeconds });
    const binaries = await fakeFfmpegPair({
      durationSeconds: normalizedDurationSeconds,
      verifyDurationSeconds: normalizedDurationSeconds,
      mediaVideoDurationSeconds: decodedVideoDurationSeconds,
      mediaVideoDurationTicks: 241_000,
      mediaVideoTimeBase: '1/24000',
      mediaAudioDurationSeconds: 10.1,
      mediaContainerDurationSeconds: 10.1,
    });
    const exporter = createStudioFilmExporterV2({
      ffmpegBinary: binaries.ffmpeg,
      ffprobeBinary: binaries.ffprobe,
      tempRoot: binaries.root,
      composeEditorFolder: fixture.compose,
    });

    const result = await exporter.render({
      project: fixture.project,
      transition: { kind: 'cut' },
      trimTails: false,
      sources: [fixture.source],
      signal: new AbortController().signal,
      onProgress: () => undefined,
    });

    expect(result.facts).toMatchObject({
      nominalDurationSeconds: 8.85,
      renderedDurationSeconds: normalizedDurationSeconds,
      segments: [
        {
          kind: 'shot',
          sourceInSeconds,
          sourceOutSeconds: 10.1,
          effectiveSourceOutSeconds: decodedVideoDurationSeconds,
          renderedSourceOutSeconds: decodedVideoDurationSeconds,
          normalizedDurationSeconds,
        },
      ],
    });
    const invocations = (await readFile(binaries.invocationLog, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { binary: string; args: string[] });
    const render = invocations.find(({ binary, args }) => binary === 'ffmpeg' && args.includes('-filter_complex'));
    expect(render?.args).toEqual(expect.arrayContaining(['-ss', '1.25', '-t', '8.791666666667']));
    await result.cleanup();
  });

  it('keeps supported audio-bearing WebM media that exposes only its container duration', async () => {
    const normalizedDurationSeconds = 242 / 24;
    const fixture = singleShotFixture({ storedDurationSeconds: 10.1, mimeType: 'video/webm' });
    const binaries = await fakeFfmpegPair({
      durationSeconds: normalizedDurationSeconds,
      verifyDurationSeconds: normalizedDurationSeconds,
      mediaVideoDurationSeconds: 'N/A',
      mediaAudioDurationSeconds: 'N/A',
      mediaContainerDurationSeconds: 10.1,
    });
    const exporter = createStudioFilmExporterV2({
      ffmpegBinary: binaries.ffmpeg,
      ffprobeBinary: binaries.ffprobe,
      tempRoot: binaries.root,
      composeEditorFolder: fixture.compose,
    });

    const result = await exporter.render({
      project: fixture.project,
      transition: { kind: 'cut' },
      trimTails: false,
      sources: [fixture.source],
      signal: new AbortController().signal,
      onProgress: () => undefined,
    });

    expect(result.facts.segments[0]).toMatchObject({
      kind: 'shot',
      sourceOutSeconds: 10.1,
      effectiveSourceOutSeconds: 10.1,
      normalizedDurationSeconds,
    });
    await result.cleanup();
  });

  it('preserves authored head and tail trims against the decoded video interval', async () => {
    const decodedVideoDurationSeconds = 10.041667;
    const sourceInSeconds = 1.25;
    const trimOutSeconds = 0.5;
    const expectedSourceOutSeconds = 10.1 - trimOutSeconds;
    const normalizedDurationSeconds = 200 / 24;
    const fixture = singleShotFixture({ storedDurationSeconds: 10.1, sourceInSeconds, trimOutSeconds });
    const binaries = await fakeFfmpegPair({
      durationSeconds: normalizedDurationSeconds,
      verifyDurationSeconds: normalizedDurationSeconds,
      mediaVideoDurationSeconds: decodedVideoDurationSeconds,
      mediaAudioDurationSeconds: 10.1,
      mediaContainerDurationSeconds: 10.1,
    });
    const exporter = createStudioFilmExporterV2({
      ffmpegBinary: binaries.ffmpeg,
      ffprobeBinary: binaries.ffprobe,
      tempRoot: binaries.root,
      composeEditorFolder: fixture.compose,
    });

    const result = await exporter.render({
      project: fixture.project,
      transition: { kind: 'cut' },
      trimTails: false,
      sources: [fixture.source],
      signal: new AbortController().signal,
      onProgress: () => undefined,
    });

    expect(result.facts.segments[0]).toMatchObject({
      kind: 'shot',
      sourceInSeconds,
      sourceOutSeconds: expectedSourceOutSeconds,
      effectiveSourceOutSeconds: expectedSourceOutSeconds,
      renderedSourceOutSeconds: expectedSourceOutSeconds,
      normalizedDurationSeconds,
    });
    expect(result.facts).toMatchObject({
      nominalDurationSeconds: 8.35,
      renderedDurationSeconds: normalizedDurationSeconds,
    });
    const invocations = (await readFile(binaries.invocationLog, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { binary: string; args: string[] });
    const render = invocations.find(({ binary, args }) => binary === 'ffmpeg' && args.includes('-filter_complex'));
    expect(render?.args).toEqual(expect.arrayContaining(['-ss', '1.25', '-t', '8.333333333333']));
    await result.cleanup();
  });

  it('does not extend the Film cut when the decoded video track outlives its stored endpoint', async () => {
    const fixture = singleShotFixture({ storedDurationSeconds: 10 });
    const binaries = await fakeFfmpegPair({
      durationSeconds: 10,
      verifyDurationSeconds: 10,
      mediaVideoDurationSeconds: 10.05,
      mediaAudioDurationSeconds: 10.05,
      mediaContainerDurationSeconds: 10,
    });
    const exporter = createStudioFilmExporterV2({
      ffmpegBinary: binaries.ffmpeg,
      ffprobeBinary: binaries.ffprobe,
      tempRoot: binaries.root,
      composeEditorFolder: fixture.compose,
    });

    const result = await exporter.render({
      project: fixture.project,
      transition: { kind: 'cut' },
      trimTails: false,
      sources: [fixture.source],
      signal: new AbortController().signal,
      onProgress: () => undefined,
    });

    expect(result.facts.segments[0]).toMatchObject({
      kind: 'shot',
      sourceOutSeconds: 10,
      effectiveSourceOutSeconds: 10,
      normalizedDurationSeconds: 10,
    });
    await result.cleanup();
  });

  it('rejects a gross audio and container tail instead of hiding a truncated video track', async () => {
    const fixture = singleShotFixture({ storedDurationSeconds: 10.1 });
    const binaries = await fakeFfmpegPair({
      mediaVideoDurationSeconds: 9,
      mediaAudioDurationSeconds: 10.1,
      mediaContainerDurationSeconds: 10.1,
    });
    const exporter = createStudioFilmExporterV2({
      ffmpegBinary: binaries.ffmpeg,
      ffprobeBinary: binaries.ffprobe,
      tempRoot: binaries.root,
      composeEditorFolder: fixture.compose,
    });

    await expect(
      exporter.render({
        project: fixture.project,
        transition: { kind: 'cut' },
        trimTails: false,
        sources: [fixture.source],
        signal: new AbortController().signal,
        onProgress: () => undefined,
      })
    ).rejects.toMatchObject({ code: 'invalid_media' });
  });

  it('accepts a gross mux tail when the authored Cut ends before the decoded video endpoint', async () => {
    const normalizedDurationSeconds = 194 / 24;
    const fixture = singleShotFixture({ storedDurationSeconds: 10.1, trimOutSeconds: 2 });
    const binaries = await fakeFfmpegPair({
      durationSeconds: normalizedDurationSeconds,
      verifyDurationSeconds: normalizedDurationSeconds,
      mediaVideoDurationSeconds: 9,
      mediaAudioDurationSeconds: 10.1,
      mediaContainerDurationSeconds: 10.1,
    });
    const exporter = createStudioFilmExporterV2({
      ffmpegBinary: binaries.ffmpeg,
      ffprobeBinary: binaries.ffprobe,
      tempRoot: binaries.root,
      composeEditorFolder: fixture.compose,
    });

    const result = await exporter.render({
      project: fixture.project,
      transition: { kind: 'cut' },
      trimTails: false,
      sources: [fixture.source],
      signal: new AbortController().signal,
      onProgress: () => undefined,
    });

    expect(result.facts).toMatchObject({
      nominalDurationSeconds: 8.1,
      renderedDurationSeconds: normalizedDurationSeconds,
      segments: [{ kind: 'shot', sourceOutSeconds: 8.1, effectiveSourceOutSeconds: 8.1 }],
    });
    await result.cleanup();
  });

  it('clamps stale advisory metadata when every current media endpoint ends earlier', async () => {
    const fixture = singleShotFixture({ storedDurationSeconds: 10.1 });
    const binaries = await fakeFfmpegPair({
      durationSeconds: 9,
      verifyDurationSeconds: 9,
      mediaVideoDurationSeconds: 9,
      mediaAudioDurationSeconds: 9,
      mediaContainerDurationSeconds: 9,
    });
    const exporter = createStudioFilmExporterV2({
      ffmpegBinary: binaries.ffmpeg,
      ffprobeBinary: binaries.ffprobe,
      tempRoot: binaries.root,
      composeEditorFolder: fixture.compose,
    });

    const result = await exporter.render({
      project: fixture.project,
      transition: { kind: 'cut' },
      trimTails: false,
      sources: [fixture.source],
      signal: new AbortController().signal,
      onProgress: () => undefined,
    });

    expect(result.facts).toMatchObject({
      nominalDurationSeconds: 10.1,
      renderedDurationSeconds: 9,
      segments: [
        {
          kind: 'shot',
          sourceOutSeconds: 10.1,
          effectiveSourceOutSeconds: 9,
          renderedSourceOutSeconds: 9,
        },
      ],
    });
    await result.cleanup();
  });

  it('accepts exactly the video-tail tolerance and rejects the next measurable overhang', async () => {
    const render = async (storedDurationSeconds: number, videoDurationSeconds = 10) => {
      const normalizedDurationSeconds = Math.floor(videoDurationSeconds * 24 + 1e-9) / 24;
      const fixture = singleShotFixture({ storedDurationSeconds });
      const binaries = await fakeFfmpegPair({
        durationSeconds: normalizedDurationSeconds,
        verifyDurationSeconds: normalizedDurationSeconds,
        mediaVideoDurationSeconds: videoDurationSeconds,
        mediaAudioDurationSeconds: storedDurationSeconds,
        mediaContainerDurationSeconds: storedDurationSeconds,
      });
      const exporter = createStudioFilmExporterV2({
        ffmpegBinary: binaries.ffmpeg,
        ffprobeBinary: binaries.ffprobe,
        tempRoot: binaries.root,
        composeEditorFolder: fixture.compose,
      });
      return exporter.render({
        project: fixture.project,
        transition: { kind: 'cut' },
        trimTails: false,
        sources: [fixture.source],
        signal: new AbortController().signal,
        onProgress: () => undefined,
      });
    };

    const accepted = await render(10.125);
    expect(accepted.facts.segments[0]).toMatchObject({
      kind: 'shot',
      sourceOutSeconds: 10.125,
      effectiveSourceOutSeconds: 10,
    });
    await accepted.cleanup();
    const fractionalBoundary = await render(4.0002, 3.8752);
    expect(fractionalBoundary.facts).toMatchObject({
      renderedDurationSeconds: 3.875,
      segments: [{ kind: 'shot', sourceOutSeconds: 4.0002, effectiveSourceOutSeconds: 3.8752 }],
    });
    await fractionalBoundary.cleanup();
    await expect(render(10.125_001)).rejects.toMatchObject({ code: 'invalid_media' });
  });

  it('retains a bounded fractional provider overrun at the fifteen-second Film boundary', async () => {
    const decodedVideoDurationSeconds = 15.069002;
    const normalizedDurationSeconds = 361 / 24;
    const fixture = singleShotFixture({ storedDurationSeconds: 15.1 });
    const binaries = await fakeFfmpegPair({
      durationSeconds: normalizedDurationSeconds,
      verifyDurationSeconds: normalizedDurationSeconds,
      mediaVideoDurationSeconds: decodedVideoDurationSeconds,
      mediaAudioDurationSeconds: 15.1,
      mediaContainerDurationSeconds: 15.1,
    });
    const exporter = createStudioFilmExporterV2({
      ffmpegBinary: binaries.ffmpeg,
      ffprobeBinary: binaries.ffprobe,
      tempRoot: binaries.root,
      composeEditorFolder: fixture.compose,
    });

    const result = await exporter.render({
      project: fixture.project,
      transition: { kind: 'cut' },
      trimTails: false,
      sources: [fixture.source],
      signal: new AbortController().signal,
      onProgress: () => undefined,
    });

    expect(result.facts).toMatchObject({
      nominalDurationSeconds: 15.1,
      renderedDurationSeconds: normalizedDurationSeconds,
      segments: [
        {
          kind: 'shot',
          sourceOutSeconds: 15.1,
          effectiveSourceOutSeconds: decodedVideoDurationSeconds,
        },
      ],
    });
    await result.cleanup();
  });

  it('does not impose the requested Shot ceiling on a longer canonical provider take', async () => {
    const normalizedDurationSeconds = 388 / 24;
    const fixture = singleShotFixture({ storedDurationSeconds: 16.2 });
    const binaries = await fakeFfmpegPair({
      durationSeconds: normalizedDurationSeconds,
      verifyDurationSeconds: normalizedDurationSeconds,
      mediaVideoDurationSeconds: 16.2,
      mediaAudioDurationSeconds: 16.2,
      mediaContainerDurationSeconds: 16.2,
    });
    const exporter = createStudioFilmExporterV2({
      ffmpegBinary: binaries.ffmpeg,
      ffprobeBinary: binaries.ffprobe,
      tempRoot: binaries.root,
      composeEditorFolder: fixture.compose,
    });

    const result = await exporter.render({
      project: fixture.project,
      transition: { kind: 'cut' },
      trimTails: false,
      sources: [fixture.source],
      signal: new AbortController().signal,
      onProgress: () => undefined,
    });

    expect(result.facts).toMatchObject({
      nominalDurationSeconds: 16.2,
      renderedDurationSeconds: normalizedDurationSeconds,
      segments: [
        {
          kind: 'shot',
          sourceOutSeconds: 16.2,
          effectiveSourceOutSeconds: 16.2,
          renderedSourceOutSeconds: 16.2,
          normalizedDurationSeconds,
        },
      ],
    });
    await result.cleanup();
  });

  it('applies the final limiter even when no optional audio bed is selected', async () => {
    const binaries = await fakeFfmpegPair({ durationSeconds: 10 });
    const noBedComposition = (): StudioEditorFolderCompositionV2 => {
      const value = composition();
      return { ...value, timeline: { ...value.timeline, bed: null } };
    };
    const exporter = createStudioFilmExporterV2({
      ffmpegBinary: binaries.ffmpeg,
      ffprobeBinary: binaries.ffprobe,
      tempRoot: binaries.root,
      composeEditorFolder: noBedComposition,
    });
    const noBedProject = project({
      bedAssetId: null,
      assets: { [VIDEO_ONE.id]: VIDEO_ONE, [VIDEO_TWO.id]: VIDEO_TWO },
    });
    const result = await exporter.render({
      project: noBedProject,
      transition: { kind: 'cut' },
      trimTails: false,
      sources: sources().slice(0, 2),
      signal: new AbortController().signal,
      onProgress: () => undefined,
    });
    expect(result.facts.audio).toMatchObject({ bedAssetId: null, takeGain: 1, dissolveCrossfade: false });
    const invocations = (await readFile(binaries.invocationLog, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { binary: string; args: string[] });
    const render = invocations.find(({ binary, args }) => binary === 'ffmpeg' && args.includes('-filter_complex'));
    const graph = render!.args[render!.args.indexOf('-filter_complex') + 1]!;
    expect(graph).toContain('alimiter=limit=0.95');
    expect(graph).not.toContain('amix=inputs=2');
    await result.cleanup();
  });

  it('waits for a late source acquisition and returns its lease before cancellation settles', async () => {
    const binaries = await fakeFfmpegPair();
    const exporter = createStudioFilmExporterV2({
      ffmpegBinary: binaries.ffmpeg,
      ffprobeBinary: binaries.ffprobe,
      tempRoot: binaries.root,
      composeEditorFolder: composition,
    });
    let markOpenStarted!: () => void;
    const openStarted = new Promise<void>((resolve) => {
      markOpenStarted = resolve;
    });
    let releaseOpen!: () => void;
    const openReleased = new Promise<void>((resolve) => {
      releaseOpen = resolve;
    });
    const returnLease = vi.fn(async () => ({ done: true as const, value: undefined }));
    const lateSource: StudioFilmVerifiedSourceV2 = {
      asset: VIDEO_ONE,
      openVerifiedStream: async () => {
        markOpenStarted();
        await openReleased;
        return {
          [Symbol.asyncIterator]: () => ({
            next: async () => new Promise<IteratorResult<Uint8Array>>(() => undefined),
            return: returnLease,
          }),
        };
      },
    };
    const controller = new AbortController();
    const pending = exporter.render({
      project: project(),
      transition: { kind: 'cut' },
      trimTails: false,
      sources: [lateSource, ...sources().slice(1)],
      signal: controller.signal,
      onProgress: () => undefined,
    });
    await openStarted;
    let settled = false;
    const observed = pending.finally(() => {
      settled = true;
    });
    controller.abort();
    await Promise.resolve();
    expect(settled).toBe(false);
    releaseOpen();
    await expect(observed).rejects.toMatchObject({ code: 'cancelled' });
    expect(returnLease).toHaveBeenCalledOnce();
  });
  it('reports a cancellation during media analysis as cancelled, not as invalid media', async () => {
    const binaries = await fakeFfmpegPair();
    const exporter = createStudioFilmExporterV2({
      ffmpegBinary: binaries.ffmpeg,
      ffprobeBinary: binaries.ffprobe,
      tempRoot: binaries.root,
      composeEditorFolder: composition,
    });
    const controller = new AbortController();
    // Aborting from the analyzing callback lands inside probeMedia, whose child
    // process carries the same signal. The media itself is valid.
    await expect(
      exporter.render({
        project: project(),
        transition: { kind: 'cut' },
        trimTails: false,
        sources: sources(),
        signal: controller.signal,
        onProgress: ({ phase }) => {
          if (phase === 'analyzing') controller.abort();
        },
      })
    ).rejects.toMatchObject({ code: 'cancelled' });
  });

  it('derives every supported geometry without reading mutable state', () => {
    expect(deriveStudioFilmDimensionsV2(project({ aspectRatio: '16:9', resolution: '720p' }))).toEqual({
      width: 1280,
      height: 720,
    });
    expect(deriveStudioFilmDimensionsV2(project({ aspectRatio: '9:16', resolution: '720p' }))).toEqual({
      width: 720,
      height: 1280,
    });
    expect(deriveStudioFilmDimensionsV2(project({ aspectRatio: '1:1', resolution: '720p' }))).toEqual({
      width: 720,
      height: 720,
    });
    expect(deriveStudioFilmDimensionsV2(project({ aspectRatio: '4:3', resolution: '720p' }))).toEqual({
      width: 960,
      height: 720,
    });
    expect(deriveStudioFilmDimensionsV2(project({ aspectRatio: '3:4', resolution: '720p' }))).toEqual({
      width: 720,
      height: 960,
    });
  });

  it('fails closed on duplicate, omitted, malformed-hash, and unsafe-extension source sets', async () => {
    const binaries = await fakeFfmpegPair();
    const exporter = createStudioFilmExporterV2({
      ffmpegBinary: binaries.ffmpeg,
      ffprobeBinary: binaries.ffprobe,
      tempRoot: binaries.root,
      composeEditorFolder: composition,
    });
    const render = (inputSources: StudioFilmVerifiedSourceV2[]) =>
      exporter.render({
        project: project(),
        transition: { kind: 'cut' },
        trimTails: false,
        sources: inputSources,
        signal: new AbortController().signal,
        onProgress: () => undefined,
      });
    await expect(render([sources()[0]!, sources()[0]!, sources()[2]!])).rejects.toMatchObject({
      code: 'invalid_media',
    });
    await expect(render(sources().slice(0, 2))).rejects.toMatchObject({ code: 'invalid_media' });
    await expect(
      render(
        sources().map((source, index) =>
          index === 0 ? { ...source, asset: { ...source.asset, sha256: 'BAD' } } : source
        )
      )
    ).rejects.toMatchObject({ code: 'invalid_media' });
    const unsafe = { ...VIDEO_ONE, managedAsset: { ...VIDEO_ONE.managedAsset, fileName: 'video_1' } };
    await expect(render([sourceFor(unsafe, VIDEO_ONE_BYTES), ...sources().slice(1)])).rejects.toMatchObject({
      code: 'invalid_media',
    });
  });

  it('rejects source bytes and media probes that no longer match the frozen facts', async () => {
    const wrongBytesBinaries = await fakeFfmpegPair();
    const wrongBytesExporter = createStudioFilmExporterV2({
      ffmpegBinary: wrongBytesBinaries.ffmpeg,
      ffprobeBinary: wrongBytesBinaries.ffprobe,
      tempRoot: wrongBytesBinaries.root,
      composeEditorFolder: composition,
    });
    await expect(
      wrongBytesExporter.render({
        project: project(),
        transition: { kind: 'cut' },
        trimTails: false,
        sources: [sourceFor(VIDEO_ONE, bytesFor('wrong-one')), ...sources().slice(1)],
        signal: new AbortController().signal,
        onProgress: () => undefined,
      })
    ).rejects.toMatchObject({ code: 'invalid_media' });
    const interruptedSource: StudioFilmVerifiedSourceV2 = {
      asset: VIDEO_ONE,
      openVerifiedStream: async () =>
        (async function* stream() {
          yield VIDEO_ONE_BYTES.subarray(0, 2);
          throw new Error('source interrupted');
        })(),
    };
    await expect(
      wrongBytesExporter.render({
        project: project(),
        transition: { kind: 'cut' },
        trimTails: false,
        sources: [interruptedSource, ...sources().slice(1)],
        signal: new AbortController().signal,
        onProgress: () => undefined,
      })
    ).rejects.toMatchObject({ code: 'invalid_media' });
    await expect(readdir(wrongBytesBinaries.root)).resolves.not.toEqual(
      expect.arrayContaining([expect.stringMatching(/^weprompt-film-/u)])
    );

    const malformedBinaries = await fakeFfmpegPair({ malformedMediaProbe: true });
    const malformedExporter = createStudioFilmExporterV2({
      ffmpegBinary: malformedBinaries.ffmpeg,
      ffprobeBinary: malformedBinaries.ffprobe,
      tempRoot: malformedBinaries.root,
      composeEditorFolder: composition,
    });
    await expect(
      malformedExporter.render({
        project: project(),
        transition: { kind: 'cut' },
        trimTails: false,
        sources: sources(),
        signal: new AbortController().signal,
        onProgress: () => undefined,
      })
    ).rejects.toMatchObject({ code: 'invalid_media' });
  });

  it('reports unsupported toolchains, render failure, and verification mismatch without publishing output', async () => {
    const unsupported = await fakeFfmpegPair({ filters: 'concat only\n' });
    const unsupportedExporter = createStudioFilmExporterV2({
      ffmpegBinary: unsupported.ffmpeg,
      ffprobeBinary: unsupported.ffprobe,
      tempRoot: unsupported.root,
      composeEditorFolder: composition,
    });
    await expect(unsupportedExporter.capability()).resolves.toEqual({
      status: 'unavailable',
      reason: 'unsupported_capabilities',
    });
    await expect(
      unsupportedExporter.render({
        project: project(),
        transition: { kind: 'cut' },
        trimTails: false,
        sources: sources(),
        signal: new AbortController().signal,
        onProgress: () => undefined,
      })
    ).rejects.toMatchObject({ code: 'unsupported_capabilities' });

    const failed = await fakeFfmpegPair({ renderFailure: true });
    const failedExporter = createStudioFilmExporterV2({
      ffmpegBinary: failed.ffmpeg,
      ffprobeBinary: failed.ffprobe,
      tempRoot: failed.root,
      composeEditorFolder: composition,
    });
    await expect(
      failedExporter.render({
        project: project(),
        transition: { kind: 'cut' },
        trimTails: false,
        sources: sources(),
        signal: new AbortController().signal,
        onProgress: () => undefined,
      })
    ).rejects.toMatchObject({ code: 'render_failed' });
    await expect(readdir(failed.root)).resolves.not.toEqual(
      expect.arrayContaining([expect.stringMatching(/^weprompt-film-/u)])
    );

    const mismatch = await fakeFfmpegPair({ verifyDurationSeconds: 100 });
    const mismatchExporter = createStudioFilmExporterV2({
      ffmpegBinary: mismatch.ffmpeg,
      ffprobeBinary: mismatch.ffprobe,
      tempRoot: mismatch.root,
      composeEditorFolder: composition,
    });
    await expect(
      mismatchExporter.render({
        project: project(),
        transition: { kind: 'dissolve', seconds: 0.5 },
        trimTails: true,
        sources: sources(),
        signal: new AbortController().signal,
        onProgress: () => undefined,
      })
    ).rejects.toMatchObject({ code: 'render_failed' });
    await expect(readdir(mismatch.root)).resolves.not.toEqual(
      expect.arrayContaining([expect.stringMatching(/^weprompt-film-/u)])
    );

    const invalidEncoding = await fakeFfmpegPair({ finalLevel: 41 });
    const invalidEncodingExporter = createStudioFilmExporterV2({
      ffmpegBinary: invalidEncoding.ffmpeg,
      ffprobeBinary: invalidEncoding.ffprobe,
      tempRoot: invalidEncoding.root,
      composeEditorFolder: composition,
    });
    await expect(
      invalidEncodingExporter.render({
        project: project(),
        transition: { kind: 'cut' },
        trimTails: false,
        sources: sources(),
        signal: new AbortController().signal,
        onProgress: () => undefined,
      })
    ).rejects.toMatchObject({ code: 'render_failed' });
    await expect(readdir(invalidEncoding.root)).resolves.not.toEqual(
      expect.arrayContaining([expect.stringMatching(/^weprompt-film-/u)])
    );
  }, 30_000);

  it('preserves a replaced output inode and rejects it when publication reopens the film', async () => {
    const binaries = await fakeFfmpegPair();
    const exporter = createStudioFilmExporterV2({
      ffmpegBinary: binaries.ffmpeg,
      ffprobeBinary: binaries.ffprobe,
      tempRoot: binaries.root,
      composeEditorFolder: composition,
    });
    const result = await exporter.render({
      project: project(),
      transition: { kind: 'dissolve', seconds: 0.5 },
      trimTails: true,
      sources: sources(),
      signal: new AbortController().signal,
      onProgress: () => undefined,
    });
    const workspaces = (await readdir(binaries.root)).filter((name) => name.startsWith('weprompt-film-'));
    expect(workspaces).toHaveLength(1);
    const output = path.join(binaries.root, workspaces[0]!, 'film.mp4');
    await rm(output);
    await writeFile(output, 'evil');
    await expect(result.openVerifiedStream()).rejects.toMatchObject({ code: 'render_failed' });
    await result.cleanup();
    await expect(readFile(output, 'utf8')).resolves.toBe('evil');
  });
});
