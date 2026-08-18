/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawn, type ChildProcessWithoutNullStreams, type SpawnOptionsWithoutStdio } from 'node:child_process';
import { createReadStream, createWriteStream, promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type {
  StudioAspectRatio,
  StudioAsset,
  StudioCutClip,
  StudioCutFilter,
  StudioNormalisedRect,
  StudioProject,
  StudioRenderCutResult,
  StudioRenderErrorCode,
  StudioRenderProgressEvent,
  StudioResolution,
  StudioScene,
} from '@/common/types/project/creativeStudioTypes';
import { isCanonicalStudioGeneratedTake } from '@/common/types/project/creativeStudioCanonicalTake';
import type { StudioMediaStore } from './mediaStore';
import type { CreativeStudioStore } from './store';

const RENDER_FPS = 30;
const RENDER_PIXEL_FORMAT = 'yuv420p';
const STDERR_TAIL_BYTES = 16 * 1024;
const NORMALISE_PROGRESS_SHARE = 0.75;
const CONCAT_PROGRESS_SHARE = 0.24;
const DEFAULT_TERMINATION_GRACE_MS = 1_000;
const DEFAULT_SEGMENT_TIMEOUT_MS = 120_000;

const RENDER_DIMENSIONS = {
  '720p': {
    '16:9': { width: 1280, height: 720 },
    '9:16': { width: 720, height: 1280 },
    '1:1': { width: 720, height: 720 },
    '4:3': { width: 960, height: 720 },
    '3:4': { width: 720, height: 960 },
  },
  '1080p': {
    '16:9': { width: 1920, height: 1080 },
    '9:16': { width: 1080, height: 1920 },
    '1:1': { width: 1080, height: 1080 },
    '4:3': { width: 1440, height: 1080 },
    '3:4': { width: 1080, height: 1440 },
  },
} as const satisfies Record<StudioResolution, Record<StudioAspectRatio, { width: number; height: number }>>;

export const resolveStudioRenderDimensions = (
  resolution: StudioResolution,
  aspectRatio: StudioAspectRatio
): { width: number; height: number } => ({ ...RENDER_DIMENSIONS[resolution][aspectRatio] });

export type StudioRenderResult =
  | { status: 'rendered'; assetId: string; missingSceneIds: string[] }
  | { status: 'no_renderable_scenes'; missingSceneIds: string[] }
  | { status: 'cancelled'; missingSceneIds: string[] };

export type StudioRenderOperation = {
  result: Promise<StudioRenderResult>;
  cancel(): void;
};

export type StudioRenderSpawn = (
  command: string,
  args: string[],
  options: SpawnOptionsWithoutStdio
) => ChildProcessWithoutNullStreams;

export type StudioRenderProgress = {
  progress: number;
  clipIndex: number;
  clipTotal: number;
};

export type StudioRenderDeps = {
  store: Pick<CreativeStudioStore, 'getProject'>;
  mediaStore: Pick<StudioMediaStore, 'resolveAsset' | 'persistProjectOutput'>;
  onProgress?: (progress: StudioRenderProgress) => void;
  environment?: NodeJS.ProcessEnv;
  temporaryRoot?: string;
  spawnProcess?: StudioRenderSpawn;
  terminationGraceMs?: number;
  segmentTimeoutMs?: number;
};

export class CreativeStudioRenderError extends Error {
  readonly code: 'ffmpeg_unavailable' | 'render_failed';
  readonly stderrTail?: string;

  constructor(code: CreativeStudioRenderError['code'], stderrTail?: string) {
    super(code);
    this.name = 'CreativeStudioRenderError';
    this.code = code;
    if (stderrTail !== undefined) this.stderrTail = stderrTail;
  }
}

type RenderSegment = {
  scene: StudioScene;
  asset: StudioAsset;
  edits: Pick<StudioCutClip, 'sourceInSeconds' | 'sourceOutSeconds' | 'crop' | 'filters'>;
  openVerifiedStream: () => Promise<Readable>;
  inputPath?: string;
  outputPath?: string;
  renderedDurationSeconds?: number;
};

type RenderState = {
  cancelled: boolean;
  activeProcess: ChildProcessWithoutNullStreams | null;
  activeStream: Readable | null;
  activeTerminationTimer: NodeJS.Timeout | null;
};

type FfmpegRunResult = {
  code: number | null;
  stderrTail: string;
  stdoutTail: string;
};

class RenderCancelledError extends Error {}

type ColourMatrix = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

const IDENTITY_COLOUR_MATRIX: ColourMatrix = [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0];

const matrixValue = (matrix: ColourMatrix, row: number, column: number): number => matrix[row * 5 + column]!;

/** Composes affine RGBA matrices so the right operand is evaluated first. */
const multiplyColourMatrices = (left: ColourMatrix, right: ColourMatrix): ColourMatrix => {
  const output: number[] = [];
  for (let row = 0; row < 4; row += 1) {
    for (let column = 0; column < 4; column += 1) {
      let value = 0;
      for (let inner = 0; inner < 4; inner += 1) {
        value += matrixValue(left, row, inner) * matrixValue(right, inner, column);
      }
      output.push(Number(value.toFixed(12)));
    }
    let offset = matrixValue(left, row, 4);
    for (let inner = 0; inner < 4; inner += 1) {
      offset += matrixValue(left, row, inner) * matrixValue(right, inner, 4);
    }
    output.push(Number(offset.toFixed(12)));
  }
  return output as unknown as ColourMatrix;
};

const rgbScaleMatrix = (red: number, green: number, blue: number): ColourMatrix => [
  red,
  0,
  0,
  0,
  0,
  0,
  green,
  0,
  0,
  0,
  0,
  0,
  blue,
  0,
  0,
  0,
  0,
  0,
  1,
  0,
];

const contrastMatrix = (amount: number): ColourMatrix => {
  const scale = 1 + amount;
  const offset = (1 - scale) / 2;
  return [scale, 0, 0, 0, offset, 0, scale, 0, 0, offset, 0, 0, scale, 0, offset, 0, 0, 0, 1, 0];
};

const saturationMatrix = (amount: number): ColourMatrix => {
  const scale = 1 + amount;
  const inverse = 1 - scale;
  const redLuma = 0.2126 * inverse;
  const greenLuma = 0.7152 * inverse;
  const blueLuma = 0.0722 * inverse;
  return [
    scale + redLuma,
    greenLuma,
    blueLuma,
    0,
    0,
    redLuma,
    scale + greenLuma,
    blueLuma,
    0,
    0,
    redLuma,
    greenLuma,
    scale + blueLuma,
    0,
    0,
    0,
    0,
    0,
    1,
    0,
  ];
};

const deriveColourMatrix = (filters: readonly StudioCutFilter[]): ColourMatrix => {
  const amounts = { exposure: 0, temperature: 0, contrast: 0, saturation: 0 };
  for (const filter of filters) amounts[filter.id] = filter.amount;
  const exposure = rgbScaleMatrix(1 + amounts.exposure, 1 + amounts.exposure, 1 + amounts.exposure);
  const temperature = rgbScaleMatrix(1 + 0.2 * amounts.temperature, 1, 1 - 0.2 * amounts.temperature);
  return [exposure, temperature, contrastMatrix(amounts.contrast), saturationMatrix(amounts.saturation)].reduce(
    (matrix, operation) => multiplyColourMatrices(operation, matrix),
    IDENTITY_COLOUR_MATRIX
  );
};

const coefficient = (value: number): string => String(Object.is(value, -0) ? 0 : value);

const colourMatrixUsesMixerRange = (matrix: ColourMatrix): boolean => {
  const rgbIndexes = [0, 1, 2, 4, 5, 6, 7, 9, 10, 11, 12, 14] as const;
  return rgbIndexes.every((index) => Math.abs(matrix[index]) <= 2);
};

const colourMatrixFilter = (matrix: ColourMatrix): string => {
  if (colourMatrixUsesMixerRange(matrix)) {
    return [
      'format=gbrap,',
      'colorchannelmixer=',
      `rr=${coefficient(matrix[0])}:rg=${coefficient(matrix[1])}:rb=${coefficient(matrix[2])}:ra=${coefficient(matrix[4])}`,
      `:gr=${coefficient(matrix[5])}:gg=${coefficient(matrix[6])}:gb=${coefficient(matrix[7])}:ga=${coefficient(matrix[9])}`,
      `:br=${coefficient(matrix[10])}:bg=${coefficient(matrix[11])}:bb=${coefficient(matrix[12])}:ba=${coefficient(matrix[14])}`,
    ].join('');
  }
  const expression = (row: 0 | 1 | 2): string => {
    const offset = row * 5;
    return `clip(${coefficient(matrix[offset]!)}*r(X,Y)+${coefficient(matrix[offset + 1]!)}*g(X,Y)+${coefficient(matrix[offset + 2]!)}*b(X,Y)+${coefficient(matrix[offset + 4]! * 255)},0,255)`;
  };
  return `format=gbrp,geq=r='${expression(0)}':g='${expression(1)}':b='${expression(2)}'`;
};

const trimFilterOptions = (edits: RenderSegment['edits']): string[] => [
  ...(edits.sourceInSeconds === null ? [] : [`start=${edits.sourceInSeconds}`]),
  ...(edits.sourceOutSeconds === null ? [] : [`end=${edits.sourceOutSeconds}`]),
];

const cropFilter = (crop: StudioNormalisedRect): string =>
  `crop=w=iw*${crop.width}:h=ih*${crop.height}:x=iw*${crop.x}:y=ih*${crop.y}:exact=1`;

const uneditedClip = (): RenderSegment['edits'] => ({
  sourceInSeconds: null,
  sourceOutSeconds: null,
  crop: null,
  filters: [],
});

const appendTail = (current: string, chunk: Buffer): string => {
  const combined = current + chunk.toString('utf8');
  return Buffer.byteLength(combined, 'utf8') <= STDERR_TAIL_BYTES
    ? combined
    : Buffer.from(combined, 'utf8').subarray(-STDERR_TAIL_BYTES).toString('utf8');
};

const parseProgressTime = (line: string): number | null => {
  if (!line.startsWith('out_time=')) return null;
  const match = /^out_time=(\d+):(\d+):(\d+(?:\.\d+)?)$/.exec(line);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const value = hours * 3600 + minutes * 60 + seconds;
  return Number.isFinite(value) ? value : null;
};

const unavailableSpawnError = (error: unknown): boolean => {
  const code = (error as NodeJS.ErrnoException).code;
  return code === 'ENOENT' || code === 'EACCES' || code === 'ENOTDIR';
};

const positiveTimeout = (value: number | undefined, fallback: number): number =>
  value !== undefined && Number.isFinite(value) && value > 0 ? value : fallback;

const terminateProcess = (child: ChildProcessWithoutNullStreams, graceMs: number): NodeJS.Timeout => {
  child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), graceMs);
  timer.unref?.();
  return timer;
};

const runFfmpeg = (
  binary: string,
  args: string[],
  options: {
    state: RenderState;
    environment: NodeJS.ProcessEnv;
    spawnProcess: StudioRenderSpawn;
    cwd?: string;
    onOutTime?: (seconds: number) => void;
    onFrame?: (frame: number) => void;
    timeoutMs?: number;
    terminationGraceMs: number;
  }
): Promise<FfmpegRunResult> => {
  if (options.state.cancelled) return Promise.reject(new RenderCancelledError());
  return new Promise<FfmpegRunResult>((resolve, reject) => {
    let child: ChildProcessWithoutNullStreams;
    try {
      child = options.spawnProcess(binary, args, {
        cwd: options.cwd,
        env: options.environment,
        windowsHide: true,
      });
    } catch (error) {
      reject(
        unavailableSpawnError(error)
          ? new CreativeStudioRenderError('ffmpeg_unavailable')
          : new CreativeStudioRenderError('render_failed')
      );
      return;
    }
    options.state.activeProcess = child;
    let settled = false;
    let stderrTail = '';
    let stdoutTail = '';
    let progressBuffer = '';
    let terminationTimer: NodeJS.Timeout | null = null;
    let timeoutTimer: NodeJS.Timeout | null = null;
    let timedOut = false;
    const finish = (work: () => void): void => {
      if (settled) return;
      settled = true;
      if (terminationTimer !== null) clearTimeout(terminationTimer);
      if (timeoutTimer !== null) clearTimeout(timeoutTimer);
      if (options.state.activeProcess === child) {
        if (options.state.activeTerminationTimer !== null) clearTimeout(options.state.activeTerminationTimer);
        options.state.activeTerminationTimer = null;
        options.state.activeProcess = null;
      }
      work();
    };
    child.stderr.on('data', (chunk: Buffer) => {
      stderrTail = appendTail(stderrTail, chunk);
    });
    child.stdout.on('data', (chunk: Buffer) => {
      stdoutTail = appendTail(stdoutTail, chunk);
      progressBuffer += chunk.toString('utf8');
      const lines = progressBuffer.split(/\r?\n/);
      progressBuffer = lines.pop() ?? '';
      for (const line of lines) {
        const seconds = parseProgressTime(line);
        if (seconds !== null) options.onOutTime?.(seconds);
        const frameMatch = /^frame=(\d+)$/.exec(line);
        if (frameMatch !== null) options.onFrame?.(Number(frameMatch[1]));
      }
    });
    child.once('error', (error) => {
      finish(() => {
        if (options.state.cancelled) reject(new RenderCancelledError());
        else if (unavailableSpawnError(error)) reject(new CreativeStudioRenderError('ffmpeg_unavailable'));
        else reject(new CreativeStudioRenderError('render_failed'));
      });
    });
    child.once('exit', (code, signal) => {
      if (code === 0 && signal === null) return;
      finish(() => {
        if (options.state.cancelled) reject(new RenderCancelledError());
        else if (timedOut) reject(new CreativeStudioRenderError('render_failed', stderrTail || undefined));
        else resolve({ code, stderrTail, stdoutTail });
      });
    });
    child.once('close', (code) => {
      finish(() => {
        if (options.state.cancelled) reject(new RenderCancelledError());
        else if (timedOut) reject(new CreativeStudioRenderError('render_failed', stderrTail || undefined));
        else resolve({ code, stderrTail, stdoutTail });
      });
    });
    if (options.timeoutMs !== undefined) {
      timeoutTimer = setTimeout(() => {
        timedOut = true;
        terminationTimer = terminateProcess(child, options.terminationGraceMs);
        options.state.activeTerminationTimer = terminationTimer;
      }, options.timeoutMs);
      timeoutTimer.unref?.();
    }
  });
};

const sanitizedTail = (tail: string, temporaryDirectory: string): string =>
  tail.replaceAll(temporaryDirectory, '[render-temp]').trim().slice(-STDERR_TAIL_BYTES);

const requireSuccess = (result: FfmpegRunResult, temporaryDirectory: string): void => {
  if (result.code === 0) return;
  const tail = sanitizedTail(result.stderrTail, temporaryDirectory);
  throw new CreativeStudioRenderError('render_failed', tail || undefined);
};

const resolveFfprobeBinary = (ffmpegBinary: string, environment: NodeJS.ProcessEnv): string => {
  const configured = environment.FFPROBE_PATH?.trim();
  if (configured) return configured;
  if (!ffmpegBinary.includes(path.sep)) return 'ffprobe';
  const extension = path.extname(ffmpegBinary).toLowerCase() === '.exe' ? '.exe' : '';
  return path.join(path.dirname(ffmpegBinary), `ffprobe${extension}`);
};

const validateDecodedDimensions = async (
  ffmpegBinary: string,
  inputPath: string,
  runOptions: Parameters<typeof runFfmpeg>[2],
  temporaryDirectory: string,
  timeoutMs: number
): Promise<void> => {
  const result = await runFfmpeg(
    resolveFfprobeBinary(ffmpegBinary, runOptions.environment),
    ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'json', inputPath],
    { ...runOptions, timeoutMs }
  );
  requireSuccess(result, temporaryDirectory);
  try {
    const parsed = JSON.parse(result.stdoutTail) as { streams?: Array<{ width?: unknown; height?: unknown }> };
    const decodable = parsed.streams?.some(
      ({ width, height }) =>
        typeof width === 'number' &&
        Number.isFinite(width) &&
        width > 0 &&
        typeof height === 'number' &&
        Number.isFinite(height) &&
        height > 0
    );
    if (!decodable) throw new CreativeStudioRenderError('render_failed');
  } catch (error) {
    if (error instanceof CreativeStudioRenderError) throw error;
    throw new CreativeStudioRenderError('render_failed');
  }
};

const selectEncoder = async (
  binary: string,
  dimensions: { width: number; height: number },
  runOptions: Omit<Parameters<typeof runFfmpeg>[2], 'onOutTime'>,
  temporaryDirectory: string
): Promise<'h264_videotoolbox' | 'libx264'> => {
  const probe = (encoder: 'h264_videotoolbox' | 'libx264') =>
    runFfmpeg(
      binary,
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-f',
        'lavfi',
        '-i',
        `color=c=black:s=${dimensions.width}x${dimensions.height}:r=${RENDER_FPS}:d=0.04`,
        '-frames:v',
        '1',
        '-an',
        '-c:v',
        encoder,
        '-pix_fmt',
        RENDER_PIXEL_FORMAT,
        '-f',
        'null',
        '-',
      ],
      runOptions
    );
  const hardware = await probe('h264_videotoolbox');
  if (hardware.code === 0) return 'h264_videotoolbox';
  const software = await probe('libx264');
  requireSuccess(software, temporaryDirectory);
  return 'libx264';
};

const videoHasAudio = async (
  binary: string,
  inputPath: string,
  runOptions: Omit<Parameters<typeof runFfmpeg>[2], 'onOutTime'>,
  temporaryDirectory: string
): Promise<boolean> => {
  const result = await runFfmpeg(
    binary,
    ['-hide_banner', '-loglevel', 'error', '-i', inputPath, '-map', '0:a:0', '-frames:a', '1', '-f', 'null', '-'],
    runOptions
  );
  if (result.code === 0) return true;
  if (/matches no streams|does not contain any stream/i.test(result.stderrTail)) return false;
  requireSuccess(result, temporaryDirectory);
  return false;
};

const normalizationFilter = (
  { width, height }: { width: number; height: number },
  edits: RenderSegment['edits'],
  stillDurationSeconds?: number
): string => {
  const trim = trimFilterOptions(edits);
  const colour = edits.filters.some(({ amount }) => amount !== 0)
    ? colourMatrixFilter(deriveColourMatrix(edits.filters))
    : null;
  return [
    ...(stillDurationSeconds === undefined
      ? []
      : [`tpad=stop_mode=clone:stop_duration=${stillDurationSeconds}`, `trim=duration=${stillDurationSeconds}`]),
    ...(trim.length === 0 ? [] : [`trim=${trim.join(':')}`, 'setpts=PTS-STARTPTS']),
    ...(edits.crop === null ? [] : [cropFilter(edits.crop)]),
    ...(colour === null ? [] : [colour]),
    `scale=${width}:${height}:force_original_aspect_ratio=decrease:force_divisible_by=2`,
    `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black`,
    'setsar=1',
    `fps=${RENDER_FPS}`,
    `format=${RENDER_PIXEL_FORMAT}`,
    'setpts=PTS-STARTPTS',
  ].join(',');
};

const audioFilterWithTrim = (baseFilter: string, edits: RenderSegment['edits']): string => {
  const trim = trimFilterOptions(edits);
  return trim.length === 0 ? baseFilter : `atrim=${trim.join(':')},asetpts=PTS-STARTPTS,${baseFilter}`;
};

const encodeSegment = async (
  binary: string,
  encoder: 'h264_videotoolbox' | 'libx264',
  segment: RenderSegment,
  dimensions: { width: number; height: number },
  runOptions: Omit<Parameters<typeof runFfmpeg>[2], 'onOutTime'>,
  temporaryDirectory: string,
  onOutTime: (seconds: number) => void
): Promise<void> => {
  const inputPath = segment.inputPath!;
  const outputPath = segment.outputPath!;
  const inputArgs: string[] = [];
  const mappingArgs: string[] = ['-map', '0:v:0'];
  const durationArgs: string[] = [];
  let audioFilter: string;
  if (segment.scene.mediaKind === 'image') {
    inputArgs.push('-i', inputPath);
    inputArgs.push('-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000');
    mappingArgs.push('-map', '1:a:0');
    durationArgs.push(
      '-t',
      String(segment.scene.durationSeconds),
      '-frames:v',
      String(Math.ceil(segment.scene.durationSeconds * RENDER_FPS))
    );
    audioFilter = audioFilterWithTrim('asetpts=PTS-STARTPTS', segment.edits);
  } else if (await videoHasAudio(binary, inputPath, runOptions, temporaryDirectory)) {
    inputArgs.push('-i', inputPath);
    mappingArgs.push('-map', '0:a:0');
    audioFilter = audioFilterWithTrim(
      trimFilterOptions(segment.edits).length === 0
        ? 'aresample=48000:async=1:first_pts=0,apad,asetpts=PTS-STARTPTS'
        : 'aresample=48000:async=1:first_pts=0,asetpts=PTS-STARTPTS',
      segment.edits
    );
  } else {
    inputArgs.push('-i', inputPath);
    inputArgs.push('-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000');
    mappingArgs.push('-map', '1:a:0');
    audioFilter = audioFilterWithTrim('asetpts=PTS-STARTPTS', segment.edits);
  }
  const result = await runFfmpeg(
    binary,
    [
      '-hide_banner',
      '-loglevel',
      'error',
      ...inputArgs,
      ...mappingArgs,
      '-vf',
      normalizationFilter(
        dimensions,
        segment.edits,
        segment.scene.mediaKind === 'image' ? segment.scene.durationSeconds : undefined
      ),
      '-af',
      audioFilter,
      ...durationArgs,
      '-shortest',
      '-c:v',
      encoder,
      '-profile:v',
      'high',
      '-pix_fmt',
      RENDER_PIXEL_FORMAT,
      '-r',
      String(RENDER_FPS),
      '-fps_mode',
      'cfr',
      '-g',
      String(RENDER_FPS * 2),
      '-b:v',
      dimensions.height >= 1080 || dimensions.width >= 1920 ? '8M' : '5M',
      '-video_track_timescale',
      '90000',
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      '-ar',
      '48000',
      '-ac',
      '2',
      '-avoid_negative_ts',
      'make_zero',
      '-movflags',
      '+faststart',
      '-progress',
      'pipe:1',
      '-nostats',
      '-y',
      outputPath,
    ],
    { ...runOptions, onOutTime, timeoutMs: runOptions.timeoutMs }
  );
  requireSuccess(result, temporaryDirectory);
};

const countEncodedVideoFrames = async (
  binary: string,
  inputPath: string,
  runOptions: Omit<Parameters<typeof runFfmpeg>[2], 'onOutTime' | 'onFrame'>,
  temporaryDirectory: string
): Promise<number> => {
  let frameCount = 0;
  const result = await runFfmpeg(
    binary,
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      inputPath,
      '-map',
      '0:v:0',
      '-c',
      'copy',
      '-progress',
      'pipe:1',
      '-nostats',
      '-f',
      'null',
      '-',
    ],
    { ...runOptions, onFrame: (frame) => (frameCount = frame) }
  );
  requireSuccess(result, temporaryDirectory);
  if (frameCount < 1) throw new CreativeStudioRenderError('render_failed');
  return frameCount;
};

const concatSegments = async (
  binary: string,
  segments: RenderSegment[],
  temporaryDirectory: string,
  runOptions: Omit<Parameters<typeof runFfmpeg>[2], 'onOutTime'>,
  onOutTime: (seconds: number) => void
): Promise<string> => {
  const concatPath = path.join(temporaryDirectory, 'concat.txt');
  await fs.writeFile(
    concatPath,
    segments
      .flatMap((segment) => [
        `file '${path.basename(segment.outputPath!)}'`,
        ...(segment.renderedDurationSeconds === undefined
          ? []
          : [`duration ${segment.renderedDurationSeconds}`, `outpoint ${segment.renderedDurationSeconds}`]),
      ])
      .join('\n') + '\n',
    'utf8'
  );
  const outputPath = path.join(temporaryDirectory, 'render.mp4');
  const result = await runFfmpeg(
    binary,
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'concat',
      '-safe',
      '1',
      '-i',
      path.basename(concatPath),
      '-map',
      '0:v:0',
      '-map',
      '0:a:0',
      '-c',
      'copy',
      '-movflags',
      '+faststart',
      '-progress',
      'pipe:1',
      '-nostats',
      '-y',
      path.basename(outputPath),
    ],
    { ...runOptions, cwd: temporaryDirectory, onOutTime }
  );
  requireSuccess(result, temporaryDirectory);
  return outputPath;
};

const readSegments = async (
  project: StudioProject,
  mediaStore: StudioRenderDeps['mediaStore'],
  state: RenderState
): Promise<{ segments: RenderSegment[]; missingSceneIds: string[] }> => {
  const segments: RenderSegment[] = [];
  const missingSceneIds: string[] = [];
  const missingSceneIdSet = new Set<string>();
  const reportMissingScene = (sceneId: string): void => {
    if (missingSceneIdSet.has(sceneId)) return;
    missingSceneIdSet.add(sceneId);
    missingSceneIds.push(sceneId);
  };
  const activeCut =
    project.activeCutId === null || project.activeCutId === undefined ? undefined : project.cuts?.[project.activeCutId];
  const candidates: Array<{
    sceneId: string;
    assetId: string | null;
    edits: RenderSegment['edits'];
  }> =
    activeCut === undefined
      ? project.sceneOrder.map((sceneId) => ({
          sceneId,
          assetId: project.scenes[sceneId]?.selectedAssetId ?? null,
          edits: uneditedClip(),
        }))
      : activeCut.clipOrder.flatMap((clipId) => {
          const clip = activeCut.clips[clipId];
          if (clip === undefined) return [];
          const filterIds = clip.filters.map(({ id }) => id);
          if (new Set(filterIds).size !== filterIds.length) throw new CreativeStudioRenderError('render_failed');
          return [
            {
              sceneId: clip.sceneId,
              assetId: clip.assetId,
              edits: {
                sourceInSeconds: clip.sourceInSeconds,
                sourceOutSeconds: clip.sourceOutSeconds,
                crop: clip.crop,
                filters: clip.filters,
              },
            },
          ];
        });
  const clippedSceneIds = activeCut === undefined ? null : new Set(candidates.map(({ sceneId }) => sceneId));
  for (const candidate of candidates) {
    if (state.cancelled) throw new RenderCancelledError();
    const scene = project.scenes[candidate.sceneId];
    const asset = candidate.assetId === null ? undefined : project.assets[candidate.assetId];
    if (!scene || !asset || !isCanonicalStudioGeneratedTake(asset, project.id, scene)) {
      reportMissingScene(candidate.sceneId);
      continue;
    }
    // Selection and verification stay ordered so cancellation never leaves parallel reads alive.
    // eslint-disable-next-line no-await-in-loop
    const resolved = await mediaStore.resolveAsset(project.id, asset.id);
    if (
      !resolved ||
      resolved.asset.id !== asset.id ||
      !isCanonicalStudioGeneratedTake(resolved.asset, project.id, scene)
    ) {
      reportMissingScene(candidate.sceneId);
      continue;
    }
    segments.push({
      scene,
      asset: resolved.asset,
      edits: candidate.edits,
      openVerifiedStream: resolved.openVerifiedStream,
    });
  }
  if (clippedSceneIds !== null) {
    for (const sceneId of project.sceneOrder) {
      if (state.cancelled) throw new RenderCancelledError();
      if (!clippedSceneIds.has(sceneId)) reportMissingScene(sceneId);
    }
  }
  return { segments, missingSceneIds };
};

const expectedSegmentDuration = (segment: RenderSegment): number | undefined => {
  const sourceDuration =
    segment.scene.mediaKind === 'image' ? segment.scene.durationSeconds : segment.asset.durationSeconds;
  if (sourceDuration === undefined) return undefined;
  const sourceIn = Math.min(segment.edits.sourceInSeconds ?? 0, sourceDuration);
  const sourceOut = Math.min(segment.edits.sourceOutSeconds ?? sourceDuration, sourceDuration);
  return Math.max(0, sourceOut - sourceIn);
};

const executeRender = async (
  projectId: string,
  deps: StudioRenderDeps,
  state: RenderState,
  reportProgress: (progress: StudioRenderProgress) => void
): Promise<StudioRenderResult> => {
  let temporaryDirectory: string | null = null;
  let missingSceneIds: string[] = [];
  try {
    const project = await deps.store.getProject(projectId);
    if (project === null) throw new CreativeStudioRenderError('render_failed');
    const selection = await readSegments(project, deps.mediaStore, state);
    missingSceneIds = selection.missingSceneIds;
    if (selection.segments.length === 0) {
      return { status: 'no_renderable_scenes', missingSceneIds };
    }
    if (state.cancelled) throw new RenderCancelledError();
    temporaryDirectory = await fs.mkdtemp(
      path.join(
        deps.temporaryRoot === undefined ? os.tmpdir() : path.resolve(deps.temporaryRoot),
        'aionui-studio-render-'
      )
    );
    const clipTotal = selection.segments.length;
    reportProgress({ progress: 0, clipIndex: 1, clipTotal });
    for (const [index, segment] of selection.segments.entries()) {
      if (state.cancelled) throw new RenderCancelledError();
      const extension = path.extname(segment.asset.managedAsset.fileName);
      segment.inputPath = path.join(temporaryDirectory, `input-${String(index).padStart(4, '0')}${extension}`);
      segment.outputPath = path.join(temporaryDirectory, `segment-${String(index).padStart(4, '0')}.mp4`);
      // One active stream makes cancellation deterministic and bounds temporary disk writes.
      // eslint-disable-next-line no-await-in-loop
      const input = await segment.openVerifiedStream();
      state.activeStream = input;
      // eslint-disable-next-line no-await-in-loop
      await pipeline(input, createWriteStream(segment.inputPath, { flags: 'wx' }));
      if (state.activeStream === input) state.activeStream = null;
    }
    const environment = deps.environment ?? process.env;
    const binary = environment.FFMPEG_PATH?.trim() || 'ffmpeg';
    const spawnProcess: StudioRenderSpawn =
      deps.spawnProcess ?? ((command, args, options) => spawn(command, args, options));
    const terminationGraceMs = positiveTimeout(deps.terminationGraceMs, DEFAULT_TERMINATION_GRACE_MS);
    const segmentTimeoutMs = positiveTimeout(deps.segmentTimeoutMs, DEFAULT_SEGMENT_TIMEOUT_MS);
    const runOptions = { state, environment, spawnProcess, terminationGraceMs };
    const dimensions = resolveStudioRenderDimensions(project.resolution, project.aspectRatio);
    for (const segment of selection.segments) {
      // Validate every copied asset before any segment encoder can enter an unbounded decode loop.
      // eslint-disable-next-line no-await-in-loop
      await validateDecodedDimensions(
        binary,
        segment.inputPath!,
        runOptions,
        temporaryDirectory,
        DEFAULT_SEGMENT_TIMEOUT_MS
      );
    }
    const encoder = await selectEncoder(binary, dimensions, runOptions, temporaryDirectory);
    const expectedDurations = selection.segments.map(expectedSegmentDuration);
    const hasKnownDuration = expectedDurations.every((duration): duration is number => duration !== undefined);
    const totalDuration = hasKnownDuration ? expectedDurations.reduce((total, duration) => total + duration, 0) : null;
    let completedDuration = 0;
    for (const [index, segment] of selection.segments.entries()) {
      const segmentDuration = expectedDurations[index];
      // Sequential encoding keeps ffmpeg resource use bounded and produces deterministic progress.
      // eslint-disable-next-line no-await-in-loop
      await encodeSegment(
        binary,
        encoder,
        segment,
        dimensions,
        { ...runOptions, timeoutMs: segmentTimeoutMs },
        temporaryDirectory,
        (outTime) => {
          if (totalDuration !== null) {
            reportProgress({
              progress: NORMALISE_PROGRESS_SHARE * Math.min(1, (completedDuration + outTime) / totalDuration),
              clipIndex: index + 1,
              clipTotal,
            });
          }
        }
      );
      if (trimFilterOptions(segment.edits).length !== 0) {
        // The concat demuxer otherwise advances by AAC-padded container duration and leaves a frame gap.
        // eslint-disable-next-line no-await-in-loop
        const frameCount = await countEncodedVideoFrames(binary, segment.outputPath!, runOptions, temporaryDirectory);
        segment.renderedDurationSeconds = frameCount / RENDER_FPS;
      }
      if (totalDuration !== null && segmentDuration !== undefined) {
        completedDuration += segmentDuration;
        reportProgress({
          progress: NORMALISE_PROGRESS_SHARE * Math.min(1, completedDuration / totalDuration),
          clipIndex: index + 1,
          clipTotal,
        });
      } else {
        reportProgress({
          progress: NORMALISE_PROGRESS_SHARE * ((index + 1) / selection.segments.length),
          clipIndex: index + 1,
          clipTotal,
        });
      }
    }
    const outputPath = await concatSegments(binary, selection.segments, temporaryDirectory, runOptions, (outTime) => {
      if (totalDuration !== null) {
        reportProgress({
          progress: NORMALISE_PROGRESS_SHARE + CONCAT_PROGRESS_SHARE * Math.min(1, outTime / totalDuration),
          clipIndex: clipTotal,
          clipTotal,
        });
      }
    });
    reportProgress({
      progress: NORMALISE_PROGRESS_SHARE + CONCAT_PROGRESS_SHARE,
      clipIndex: clipTotal,
      clipTotal,
    });
    if (state.cancelled) throw new RenderCancelledError();
    const stats = await fs.stat(outputPath);
    const output = createReadStream(outputPath);
    state.activeStream = output;
    const asset = await deps.mediaStore.persistProjectOutput({
      projectId,
      declaredMimeType: 'video/mp4',
      declaredByteSize: stats.size,
      width: dimensions.width,
      height: dimensions.height,
      ...(totalDuration === null ? {} : { durationSeconds: totalDuration }),
      body: output,
    });
    if (state.activeStream === output) state.activeStream = null;
    if (state.cancelled) throw new RenderCancelledError();
    reportProgress({ progress: 1, clipIndex: clipTotal, clipTotal });
    return { status: 'rendered', assetId: asset.id, missingSceneIds };
  } catch (error) {
    if (state.cancelled || error instanceof RenderCancelledError) return { status: 'cancelled', missingSceneIds };
    if (error instanceof CreativeStudioRenderError) throw error;
    throw new CreativeStudioRenderError('render_failed');
  } finally {
    state.activeStream = null;
    state.activeProcess = null;
    if (state.activeTerminationTimer !== null) clearTimeout(state.activeTerminationTimer);
    state.activeTerminationTimer = null;
    if (temporaryDirectory !== null) {
      await fs.rm(temporaryDirectory, { recursive: true, force: true }).catch((): undefined => undefined);
    }
  }
};

/** Starts an active-cut render without entering the project's serialized mutation queue. */
export const renderCut = (projectId: string, deps: StudioRenderDeps): StudioRenderOperation => {
  const state: RenderState = {
    cancelled: false,
    activeProcess: null,
    activeStream: null,
    activeTerminationTimer: null,
  };
  let lastProgress = 0;
  let lastClipIndex = 0;
  const reportProgress = (update: StudioRenderProgress): void => {
    const next = Math.max(lastProgress, Math.min(1, update.progress));
    if (next === lastProgress && update.clipIndex === lastClipIndex && next !== 0) return;
    lastProgress = next;
    lastClipIndex = update.clipIndex;
    try {
      deps.onProgress?.({ ...update, progress: next });
    } catch {
      // A relay callback cannot invalidate a local render.
    }
  };
  const operation: StudioRenderOperation = {
    result: executeRender(projectId, deps, state, reportProgress),
    cancel(): void {
      if (state.cancelled) return;
      state.cancelled = true;
      state.activeStream?.destroy(new RenderCancelledError());
      if (state.activeProcess !== null) {
        state.activeTerminationTimer = terminateProcess(
          state.activeProcess,
          positiveTimeout(deps.terminationGraceMs, DEFAULT_TERMINATION_GRACE_MS)
        );
      }
    },
  };
  return operation;
};

export type StudioRenderRunner = {
  renderCut(projectId: string): Promise<StudioRenderCutResult>;
  cancelRender(projectId: string): boolean;
  getState(projectId: string): StudioRenderProgressEvent | null;
  dispose(): Promise<void>;
};

export type StudioRenderRunnerDeps = {
  startOperation(projectId: string, onProgress: (progress: StudioRenderProgress) => void): StudioRenderOperation;
  onStateChanged(state: StudioRenderProgressEvent): void;
};

export class StudioRenderRunnerError extends Error {
  readonly code: StudioRenderErrorCode;

  constructor(code: StudioRenderErrorCode) {
    super(code);
    this.name = 'StudioRenderRunnerError';
    this.code = code;
  }
}

const cloneRenderState = (state: StudioRenderProgressEvent): StudioRenderProgressEvent => {
  switch (state.status) {
    case 'succeeded':
      return { ...state, missingSceneIds: [...state.missingSceneIds] };
    case 'failed':
      return state.missingSceneIds === undefined
        ? { ...state }
        : { ...state, missingSceneIds: [...state.missingSceneIds] };
    case 'cancelled':
      return { ...state, missingSceneIds: [...state.missingSceneIds] };
    default:
      return { ...state };
  }
};

/** Owns local render concurrency and observable terminal state without using provider jobs. */
export const createStudioRenderRunner = (deps: StudioRenderRunnerDeps): StudioRenderRunner => {
  const activeOperations = new Map<string, StudioRenderOperation>();
  const states = new Map<string, StudioRenderProgressEvent>();

  const publish = (state: StudioRenderProgressEvent): void => {
    const snapshot = cloneRenderState(state);
    states.set(state.projectId, snapshot);
    try {
      deps.onStateChanged(cloneRenderState(snapshot));
    } catch {
      // A renderer relay cannot invalidate a local render.
    }
  };

  const start = async (projectId: string): Promise<StudioRenderCutResult> => {
    if (activeOperations.has(projectId)) throw new StudioRenderRunnerError('busy');
    let progress = 0;
    let clipProgress: Pick<StudioRenderProgress, 'clipIndex' | 'clipTotal'> | null = null;
    let operation: StudioRenderOperation | null = null;
    publish({ projectId, status: 'running', progress });
    try {
      operation = deps.startOperation(projectId, (reportedProgress) => {
        if (!Number.isFinite(reportedProgress.progress)) return;
        const next = Math.max(progress, Math.min(1, Math.max(0, reportedProgress.progress)));
        const hasValidClipProgress =
          Number.isSafeInteger(reportedProgress.clipIndex) &&
          Number.isSafeInteger(reportedProgress.clipTotal) &&
          reportedProgress.clipIndex > 0 &&
          reportedProgress.clipTotal > 0 &&
          reportedProgress.clipIndex <= reportedProgress.clipTotal;
        const reportedClipProgress = hasValidClipProgress
          ? { clipIndex: reportedProgress.clipIndex, clipTotal: reportedProgress.clipTotal }
          : null;
        const nextClipProgress =
          reportedClipProgress !== null &&
          clipProgress !== null &&
          reportedClipProgress.clipTotal === clipProgress.clipTotal &&
          reportedClipProgress.clipIndex < clipProgress.clipIndex
            ? clipProgress
            : reportedClipProgress;
        if (
          next === progress &&
          nextClipProgress?.clipIndex === clipProgress?.clipIndex &&
          nextClipProgress?.clipTotal === clipProgress?.clipTotal
        ) {
          return;
        }
        progress = next;
        clipProgress = nextClipProgress;
        publish({ projectId, status: 'running', progress, ...clipProgress });
      });
      activeOperations.set(projectId, operation);
      const result = await operation.result;
      if (result.status === 'rendered') {
        const rendered = { assetId: result.assetId, missingSceneIds: [...result.missingSceneIds] };
        publish({ projectId, status: 'succeeded', progress: 1, ...rendered });
        return rendered;
      }
      if (result.status === 'cancelled') {
        publish({
          projectId,
          status: 'cancelled',
          progress,
          missingSceneIds: [...result.missingSceneIds],
        });
        throw new StudioRenderRunnerError('cancelled');
      }
      publish({
        projectId,
        status: 'failed',
        progress,
        errorCode: 'no_renderable_scenes',
        missingSceneIds: [...result.missingSceneIds],
      });
      throw new StudioRenderRunnerError('no_renderable_scenes');
    } catch (error) {
      if (error instanceof StudioRenderRunnerError) throw error;
      const code = error instanceof CreativeStudioRenderError ? error.code : 'render_failed';
      publish({ projectId, status: 'failed', progress, errorCode: code, ...clipProgress });
      throw new StudioRenderRunnerError(code);
    } finally {
      if (operation !== null && activeOperations.get(projectId) === operation) {
        activeOperations.delete(projectId);
      }
    }
  };

  return {
    renderCut: start,
    cancelRender(projectId): boolean {
      const operation = activeOperations.get(projectId);
      if (operation === undefined) return false;
      operation.cancel();
      return true;
    },
    getState(projectId): StudioRenderProgressEvent | null {
      const state = states.get(projectId);
      return state === undefined ? null : cloneRenderState(state);
    },
    async dispose(): Promise<void> {
      const operations = [...activeOperations.values()];
      for (const operation of operations) operation.cancel();
      await Promise.allSettled(operations.map(({ result }) => result));
    },
  };
};
