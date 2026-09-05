/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-disable no-await-in-loop -- Media materialization and ffmpeg analysis are intentionally ordered. */

import { createHash } from 'node:crypto';
import { constants as fsConstants, promises as fs } from 'node:fs';
import { mkdtemp, type FileHandle } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { resolveStudioFfmpegBinaries } from '../ffmpegBinaries';
import { studioChildProcessDetached, terminateStudioChildProcessTree } from '../childProcessTree';
import { readStudioVideoDurationProbeV2, type StudioVideoDurationProbeV2 } from './schema2/exports/mediaDuration';
import {
  STUDIO_BED_FADE_OUT_SECONDS,
  STUDIO_FILM_EXPORT_AUDIO_CHANNELS,
  STUDIO_FILM_EXPORT_AUDIO_SAMPLE_RATE,
  STUDIO_FILM_EXPORT_BED_GAIN,
  STUDIO_FILM_EXPORT_DISSOLVE_SECONDS,
  STUDIO_FILM_EXPORT_FACTS_SCHEMA_VERSION,
  STUDIO_FILM_EXPORT_FRAME_RATE,
  STUDIO_FILM_EXPORT_MEDIA_DURATION_TOLERANCE_SECONDS,
  STUDIO_FILM_EXPORT_TAKE_GAIN,
  type StudioAssetV2,
  type StudioFilmExportCapabilityV2,
  type StudioFilmExportFactsV2,
  type StudioFilmExportProgressV2,
  type StudioFilmExportTransitionV2,
  type StudioFilmRenderedTransitionV2,
  type StudioProjectV2,
} from '@/common/types/project/creativeStudioTypes';
import { composeStudioEditorFolderV2 } from './schema2/exports/editorFolder';

const NO_FOLLOW = typeof fsConstants.O_NOFOLLOW === 'number' ? fsConstants.O_NOFOLLOW : 0;
const MAX_DIAGNOSTIC_BYTES = 64 * 1024;
const MAX_OUTPUT_BYTES = 5 * 1024 * 1024 * 1024;
const CAPABILITY_TIMEOUT_MS = 20_000;
const MIN_RENDER_TIMEOUT_MS = 2 * 60_000;
const MAX_RENDER_TIMEOUT_MS = 30 * 60_000;
const DISK_SAFETY_MARGIN_BYTES = 64 * 1024 * 1024;
const OUTPUT_CONTAINER_MARGIN_BYTES = 16 * 1024 * 1024;
const OUTPUT_RATE_MARGIN_MULTIPLIER = 1.5;
const QUIET_TAIL_WINDOW_SECONDS = 1;
const QUIET_TAIL_SAMPLE_RATE = 8;
const QUIET_TAIL_WIDTH = 160;
const QUIET_TAIL_HEIGHT = 90;
const QUIET_TAIL_THRESHOLD = 1.25;
const QUIET_TAIL_MIN_DELTAS = 3;
const MAX_QUIET_TAIL_BYTES =
  QUIET_TAIL_WIDTH * QUIET_TAIL_HEIGHT * (Math.ceil(QUIET_TAIL_WINDOW_SECONDS * QUIET_TAIL_SAMPLE_RATE) + 1);
const SAFE_EXTENSION = /^[a-z0-9]{1,16}$/;
const LOWERCASE_SHA256 = /^[a-f0-9]{64}$/;
const HARDWARE_ENCODERS = ['h264_videotoolbox', 'h264_nvenc', 'h264_qsv', 'h264_amf', 'h264_mf'] as const;

type HardwareEncoder = (typeof HARDWARE_ENCODERS)[number];
type FileIdentity = {
  dev: string;
  ino: string;
  size: number;
  nlink: number;
  mtimeMs: number;
  ctimeMs: number;
};
type FileOwnership = Pick<FileIdentity, 'dev' | 'ino' | 'nlink'>;
type DirectoryOwnership = Pick<FileIdentity, 'dev' | 'ino'>;

export type StudioFilmExportErrorCodeV2 =
  | 'invalid_project'
  | 'invalid_media'
  | 'ffmpeg_unavailable'
  | 'unsupported_capabilities'
  | 'render_failed'
  | 'child_settlement_failed'
  | 'cancelled';

export class StudioFilmExportErrorV2 extends Error {
  constructor(
    readonly code: StudioFilmExportErrorCodeV2,
    readonly detail?: string
  ) {
    super(code);
    this.name = 'StudioFilmExportErrorV2';
  }
}

const fail = (code: StudioFilmExportErrorCodeV2): never => {
  throw new StudioFilmExportErrorV2(code);
};

export type StudioFilmVerifiedSourceV2 = {
  asset: StudioAssetV2;
  openVerifiedStream: () => Promise<AsyncIterable<Uint8Array>>;
};

export type StudioFilmRenderInputV2 = {
  project: StudioProjectV2;
  transition: StudioFilmExportTransitionV2;
  trimTails: boolean;
  sources: readonly StudioFilmVerifiedSourceV2[];
  signal: AbortSignal;
  onProgress: (progress: Omit<StudioFilmExportProgressV2, 'projectId' | 'renderId'>) => void;
};

export type StudioFilmRenderedOutputV2 = {
  facts: StudioFilmExportFactsV2;
  byteSize: number;
  sha256: string;
  openVerifiedStream: () => Promise<AsyncIterable<Uint8Array>>;
  cleanup: () => Promise<void>;
};

export type StudioFilmExporterV2 = {
  capability(): Promise<StudioFilmExportCapabilityV2>;
  render(input: StudioFilmRenderInputV2): Promise<StudioFilmRenderedOutputV2>;
  dispose(): void;
};

export type StudioFilmExporterDepsV2 = {
  ffmpegBinary?: string;
  ffprobeBinary?: string;
  spawnProcess?: typeof spawn;
  tempRoot?: string;
  getAvailableDiskBytes?: (directoryPath: string) => Promise<number>;
  onDiagnostic?: (code: 'cleanup_preserved') => void;
  /** Injectable composition authority for focused orchestration tests; production uses the canonical composer. */
  composeEditorFolder?: typeof composeStudioEditorFolderV2;
};

const ownValue = <Value>(record: Readonly<Record<string, Value>>, key: string): Value | undefined =>
  Object.hasOwn(record, key) ? record[key] : undefined;

/** Derives the exact even-pixel output geometry used by the film renderer. */
export const deriveStudioFilmDimensionsV2 = (project: StudioProjectV2): { width: number; height: number } => {
  const longEdge = project.resolution === '1080p' ? 1920 : 1280;
  const shortEdge = project.resolution === '1080p' ? 1080 : 720;
  switch (project.aspectRatio) {
    case '16:9':
      return { width: longEdge, height: shortEdge };
    case '9:16':
      return { width: shortEdge, height: longEdge };
    case '1:1':
      return { width: shortEdge, height: shortEdge };
    case '4:3':
      return { width: Math.round((shortEdge * 4) / 3), height: shortEdge };
    case '3:4':
      return { width: shortEdge, height: Math.round((shortEdge * 4) / 3) };
  }
};

const extensionForAsset = (asset: StudioAssetV2): string => {
  const separator = asset.managedAsset.fileName.lastIndexOf('.');
  const extension = separator < 0 ? '' : asset.managedAsset.fileName.slice(separator + 1).toLowerCase();
  if (!SAFE_EXTENSION.test(extension)) return fail('invalid_media');
  return extension;
};

export const deriveStudioFilmRequiredAssetIdsV2 = (project: StudioProjectV2): string[] => {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const beatId of project.beatOrder) {
    const beat = ownValue(project.beats, beatId);
    if (beat === undefined) return fail('invalid_project');
    for (const shotId of beat.shotOrder) {
      const shot = ownValue(project.shots, shotId);
      if (shot === undefined) return fail('invalid_project');
      if (shot.videoAssetId !== null && !seen.has(shot.videoAssetId)) {
        seen.add(shot.videoAssetId);
        ids.push(shot.videoAssetId);
      }
    }
  }
  if (project.bedAssetId !== null && !seen.has(project.bedAssetId)) ids.push(project.bedAssetId);
  return ids;
};

const identity = (stats: Awaited<ReturnType<typeof fs.stat>>): FileIdentity => ({
  dev: String(stats.dev),
  ino: String(stats.ino),
  size: Number(stats.size),
  nlink: Number(stats.nlink),
  mtimeMs: Number(stats.mtimeMs),
  ctimeMs: Number(stats.ctimeMs),
});

const sameIdentity = (left: FileIdentity, right: FileIdentity): boolean =>
  left.dev === right.dev &&
  left.ino === right.ino &&
  left.size === right.size &&
  left.nlink === right.nlink &&
  left.mtimeMs === right.mtimeMs &&
  left.ctimeMs === right.ctimeMs;

const sameFileObject = (left: FileIdentity, right: FileOwnership): boolean =>
  left.dev === right.dev && left.ino === right.ino && left.nlink === right.nlink;

const sameDirectoryObject = (left: FileIdentity, right: DirectoryOwnership): boolean =>
  left.dev === right.dev && left.ino === right.ino;

const pathMissing = (error: unknown): boolean => {
  const code = (error as NodeJS.ErrnoException).code;
  return code === 'ENOENT' || code === 'ENOTDIR' || code === 'ELOOP';
};

const openExactFile = async (
  filePath: string,
  expected: FileIdentity,
  errorCode: StudioFilmExportErrorCodeV2 = 'invalid_media'
): Promise<FileHandle> => {
  let handle: FileHandle;
  try {
    handle = await fs.open(filePath, fsConstants.O_RDONLY | NO_FOLLOW);
  } catch {
    return fail(errorCode);
  }
  try {
    const opened = identity(await handle.stat());
    const linked = await fs.lstat(filePath);
    if (
      !linked.isFile() ||
      linked.isSymbolicLink() ||
      !sameIdentity(opened, expected) ||
      !sameIdentity(identity(linked), expected)
    ) {
      return fail(errorCode);
    }
    return handle;
  } catch (error) {
    await handle.close();
    throw error;
  }
};

const appendBounded = (chunks: Buffer[], size: { value: number }, chunk: Buffer, limit: number): boolean => {
  if (size.value >= limit) return chunk.byteLength === 0;
  const retained = chunk.subarray(0, limit - size.value);
  chunks.push(retained);
  size.value += retained.byteLength;
  return retained.byteLength === chunk.byteLength;
};

const appendTail = (current: Buffer, chunk: Buffer, limit: number): Buffer => {
  if (chunk.byteLength >= limit) return Buffer.from(chunk.subarray(chunk.byteLength - limit));
  if (current.byteLength + chunk.byteLength <= limit) return Buffer.concat([current, chunk]);
  return Buffer.concat([current.subarray(current.byteLength + chunk.byteLength - limit), chunk]);
};

type ChildResult = { stdout: Buffer; stderr: Buffer };

type ChildTerminalCause =
  | { kind: 'abort'; error: StudioFilmExportErrorV2 }
  | { kind: 'error'; error: unknown }
  | { kind: 'timeout' }
  | { kind: 'close'; code: number | null };

const abortFailure = (signal: AbortSignal): StudioFilmExportErrorV2 =>
  signal.reason instanceof StudioFilmExportErrorV2 ? signal.reason : new StudioFilmExportErrorV2('cancelled');

const waitWithAbort = async <Value>(work: Promise<Value>, signal: AbortSignal): Promise<Value> => {
  if (signal.aborted) throw abortFailure(signal);
  let removeAbort = (): void => undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    const onAbort = (): void => reject(abortFailure(signal));
    signal.addEventListener('abort', onAbort, { once: true });
    removeAbort = (): void => signal.removeEventListener('abort', onAbort);
  });
  try {
    return await Promise.race([work, aborted]);
  } finally {
    removeAbort();
  }
};

const runChild = (
  spawnProcess: typeof spawn,
  binary: string,
  args: readonly string[],
  options: {
    signal?: AbortSignal;
    timeoutMs: number;
    cwd?: string;
    onStdout?: (chunk: Buffer) => void;
    completeStdoutLimitBytes?: number;
    inheritedFds?: readonly number[];
  }
): Promise<ChildResult> =>
  new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(abortFailure(options.signal));
      return;
    }
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawnProcess(binary, [...args], {
        cwd: options.cwd,
        detached: studioChildProcessDetached(),
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe', ...(options.inheritedFds ?? [])],
      }) as ChildProcessWithoutNullStreams;
    } catch {
      reject(new StudioFilmExportErrorV2('ffmpeg_unavailable'));
      return;
    }
    const stdout: Buffer[] = [];
    const stdoutSize = { value: 0 };
    let stderrTail: Buffer = Buffer.alloc(0);
    let settled = false;
    let terminalCause: ChildTerminalCause | null = null;
    let stdoutComplete = true;
    let termination: Promise<void> | null = null;
    let terminationFailure: unknown;
    const claimTerminalCause = (cause: ChildTerminalCause): void => {
      terminalCause ??= cause;
    };
    const finish = async (): Promise<void> => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      await termination;
      const detail = stderrTail.toString('utf8').trim() || undefined;
      if (terminationFailure !== undefined) reject(new StudioFilmExportErrorV2('child_settlement_failed', detail));
      else if (terminalCause?.kind === 'abort') reject(terminalCause.error);
      else if (terminalCause?.kind === 'error' && (terminalCause.error as NodeJS.ErrnoException).code === 'ENOENT') {
        reject(new StudioFilmExportErrorV2('ffmpeg_unavailable'));
      } else if (
        terminalCause?.kind === 'error' ||
        terminalCause?.kind === 'timeout' ||
        terminalCause?.kind !== 'close' ||
        terminalCause.code !== 0 ||
        (options.completeStdoutLimitBytes !== undefined && !stdoutComplete)
      )
        reject(new StudioFilmExportErrorV2('render_failed', detail));
      else resolve({ stdout: Buffer.concat(stdout), stderr: stderrTail });
    };
    const terminate = (): void => {
      if (termination !== null) return;
      termination = terminateStudioChildProcessTree(child, { nativeChild: spawnProcess === spawn }).catch(
        (error: unknown): void => {
          terminationFailure = error;
        }
      );
      void termination.then(() => {
        if (!settled && (terminalCause !== null || terminationFailure !== undefined)) {
          void finish();
        }
      });
    };
    const timer = setTimeout(() => {
      claimTerminalCause({ kind: 'timeout' });
      terminate();
    }, options.timeoutMs);
    timer.unref?.();
    const onAbort = (): void => {
      claimTerminalCause({ kind: 'abort', error: abortFailure(options.signal!) });
      terminate();
    };
    options.signal?.addEventListener('abort', onAbort, { once: true });
    if (options.signal?.aborted) onAbort();
    child.stdout.on('data', (value: Buffer) => {
      try {
        options.onStdout?.(value);
      } catch (error) {
        claimTerminalCause({ kind: 'error', error });
        terminate();
      }
      stdoutComplete =
        appendBounded(stdout, stdoutSize, value, options.completeStdoutLimitBytes ?? MAX_DIAGNOSTIC_BYTES) &&
        stdoutComplete;
    });
    child.stderr.on('data', (value: Buffer) => {
      stderrTail = appendTail(stderrTail, value, 4_096);
    });
    const rememberChildError = (error: unknown): void => {
      claimTerminalCause({ kind: 'error', error });
    };
    child.once('error', (error) => {
      rememberChildError(error);
      terminate();
    });
    child.stdout.on('error', (error) => {
      rememberChildError(error);
      terminate();
    });
    child.stderr.on('error', (error) => {
      rememberChildError(error);
      terminate();
    });
    child.once('close', (code) => {
      claimTerminalCause({ kind: 'close', code });
      void finish();
    });
  });

const parseEncoderList = (text: string): Set<string> =>
  new Set(
    text
      .split(/\r?\n/u)
      .map((line) => /^\s*[A-Z.]{6}\s+(\S+)/u.exec(line)?.[1])
      .filter((value): value is string => value !== undefined)
  );

const parseFlaggedNames = (text: string, pattern: RegExp): Set<string> => {
  const names = new Set<string>();
  for (const line of text.split(/\r?\n/u)) {
    const aliases = pattern.exec(line)?.[1];
    if (aliases === undefined) continue;
    for (const name of aliases.split(',')) names.add(name);
  }
  return names;
};

const parseProtocolList = (text: string): { input: Set<string>; output: Set<string> } => {
  const protocols = { input: new Set<string>(), output: new Set<string>() };
  let section: 'input' | 'output' | null = null;
  for (const line of text.split(/\r?\n/u)) {
    const value = line.trim();
    if (value === 'Input:') section = 'input';
    else if (value === 'Output:') section = 'output';
    else if (section !== null && /^[a-z0-9+._-]+$/u.test(value)) protocols[section].add(value);
  }
  return protocols;
};

type StudioFilmProbeJson = {
  streams?: Array<Record<string, unknown>>;
  format?: { format_name?: unknown; duration?: unknown };
};

type StudioFilmProbeContract = {
  video: Record<string, unknown>;
  audio: Record<string, unknown>;
  duration: number;
};

/** The capability smoke and final artifact proof must agree on the exact encoding contract. */
const validateFilmProbeContract = (value: StudioFilmProbeJson): StudioFilmProbeContract | null => {
  const streams = Array.isArray(value.streams) ? value.streams : [];
  const video = streams.filter(({ codec_type: kind }) => kind === 'video');
  const audio = streams.filter(({ codec_type: kind }) => kind === 'audio');
  const duration = Number(value.format?.duration);
  if (
    video.length !== 1 ||
    audio.length !== 1 ||
    typeof value.format?.format_name !== 'string' ||
    !value.format.format_name.split(',').includes('mp4') ||
    video[0]!.codec_name !== 'h264' ||
    video[0]!.profile !== 'High' ||
    video[0]!.level !== 42 ||
    video[0]!.pix_fmt !== 'yuv420p' ||
    video[0]!.sample_aspect_ratio !== '1:1' ||
    video[0]!.color_range !== 'tv' ||
    video[0]!.color_space !== 'bt709' ||
    video[0]!.color_transfer !== 'bt709' ||
    video[0]!.color_primaries !== 'bt709' ||
    video[0]!.r_frame_rate !== '24/1' ||
    video[0]!.avg_frame_rate !== '24/1' ||
    video[0]!.time_base !== '1/24000' ||
    audio[0]!.codec_name !== 'aac' ||
    audio[0]!.sample_fmt !== 'fltp' ||
    Number(audio[0]!.sample_rate) !== STUDIO_FILM_EXPORT_AUDIO_SAMPLE_RATE ||
    audio[0]!.channels !== STUDIO_FILM_EXPORT_AUDIO_CHANNELS ||
    audio[0]!.channel_layout !== 'stereo' ||
    !Number.isFinite(duration) ||
    duration <= 0
  ) {
    return null;
  }
  return { video: video[0]!, audio: audio[0]!, duration };
};

const probeEncoder = async (
  spawnProcess: typeof spawn,
  ffmpeg: string,
  ffprobe: string,
  encoder: HardwareEncoder,
  tempRoot: string,
  signal?: AbortSignal,
  onDiagnostic?: (code: 'cleanup_preserved') => void
): Promise<boolean> => {
  const directory = await mkdtemp(path.join(tempRoot, 'weprompt-film-probe-'));
  const directoryOwnership: DirectoryOwnership = identity(await fs.lstat(directory));
  const output = path.join(directory, 'probe.mp4');
  let outputHandle: FileHandle | null = null;
  let outputOwnership: FileOwnership | null = null;
  try {
    const placeholder = await createOwnedPlaceholder(output);
    outputHandle = placeholder.handle;
    outputOwnership = placeholder.identity;
    await runChild(
      spawnProcess,
      ffmpeg,
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-f',
        'lavfi',
        '-i',
        'color=c=black:s=16x16:r=24:d=0.1',
        '-f',
        'lavfi',
        '-i',
        'anullsrc=channel_layout=stereo:sample_rate=48000',
        '-shortest',
        '-frames:v',
        '1',
        '-c:v',
        encoder,
        '-profile:v',
        'high',
        '-level:v',
        '4.2',
        '-pix_fmt',
        'yuv420p',
        '-color_primaries',
        'bt709',
        '-color_trc',
        'bt709',
        '-colorspace',
        'bt709',
        '-color_range',
        'tv',
        '-g',
        '48',
        '-b:v',
        '8M',
        '-bsf:v',
        'h264_metadata=video_full_range_flag=0:colour_primaries=1:transfer_characteristics=1:matrix_coefficients=1',
        '-c:a',
        'aac',
        '-b:a',
        '192k',
        '-ar',
        String(STUDIO_FILM_EXPORT_AUDIO_SAMPLE_RATE),
        '-ac',
        String(STUDIO_FILM_EXPORT_AUDIO_CHANNELS),
        '-video_track_timescale',
        '24000',
        '-map_metadata',
        '-1',
        '-map_chapters',
        '-1',
        '-f',
        'mp4',
        '-fd',
        '3',
        'fd:',
      ],
      { signal, timeoutMs: CAPABILITY_TIMEOUT_MS, inheritedFds: [outputHandle.fd] }
    );
    const stats = await outputHandle.stat();
    const linked = await fs.lstat(output);
    if (
      !stats.isFile() ||
      stats.nlink !== 1 ||
      stats.size < 1 ||
      !sameFileObject(identity(stats), placeholder.identity) ||
      !sameIdentity(identity(stats), identity(linked))
    ) {
      return false;
    }
    const exactProbe = await openExactFile(output, identity(stats));
    try {
      const probe = await runChild(
        spawnProcess,
        ffprobe,
        [
          '-v',
          'error',
          '-show_entries',
          'format=format_name,duration:stream=codec_type,codec_name,profile,level,pix_fmt,sample_aspect_ratio,color_range,color_space,color_transfer,color_primaries,r_frame_rate,avg_frame_rate,time_base,sample_fmt,sample_rate,channels,channel_layout',
          '-of',
          'json',
          '-fd',
          '3',
          'fd:',
        ],
        { signal, timeoutMs: CAPABILITY_TIMEOUT_MS, inheritedFds: [exactProbe.fd] }
      );
      if (validateFilmProbeContract(JSON.parse(probe.stdout.toString('utf8')) as StudioFilmProbeJson) === null) {
        return false;
      }
    } finally {
      await exactProbe.close();
    }
    const exactDecode = await openExactFile(output, identity(stats));
    try {
      await runChild(
        spawnProcess,
        ffmpeg,
        ['-hide_banner', '-loglevel', 'error', '-xerror', '-fd', '3', '-i', 'fd:', '-frames:v', '1', '-f', 'null', '-'],
        { signal, timeoutMs: CAPABILITY_TIMEOUT_MS, inheritedFds: [exactDecode.fd] }
      );
    } finally {
      await exactDecode.close();
    }
    return true;
  } catch (error) {
    if (error instanceof StudioFilmExportErrorV2 && error.code === 'child_settlement_failed') throw error;
    return false;
  } finally {
    let preserve = false;
    try {
      await outputHandle?.close();
    } catch {
      preserve = true;
    }
    try {
      const currentDirectory = await fs.lstat(directory);
      if (!currentDirectory.isDirectory() || !sameDirectoryObject(identity(currentDirectory), directoryOwnership)) {
        preserve = true;
      } else if (outputOwnership !== null) {
        try {
          const currentOutput = await fs.lstat(output);
          if (
            !currentOutput.isFile() ||
            currentOutput.isSymbolicLink() ||
            !sameFileObject(identity(currentOutput), outputOwnership)
          ) {
            preserve = true;
          } else if (!preserve) {
            await fs.unlink(output);
          }
        } catch (error) {
          if (!pathMissing(error)) preserve = true;
        }
      }
      if (!preserve) {
        const remaining = await fs.readdir(directory);
        if (remaining.length === 0) await fs.rmdir(directory);
        else preserve = true;
      }
    } catch (error) {
      if (!pathMissing(error)) preserve = true;
    }
    if (preserve) {
      try {
        onDiagnostic?.('cleanup_preserved');
      } catch {
        // Diagnostics cannot change capability semantics.
      }
    }
  }
};

const capabilityFor = async (
  deps: StudioFilmExporterDepsV2,
  spawnProcess: typeof spawn,
  signal?: AbortSignal
): Promise<StudioFilmExportCapabilityV2> => {
  const { ffmpeg, ffprobe } = resolveStudioFfmpegBinaries(deps);
  let encoderBytes: Buffer;
  let filterBytes: Buffer;
  let demuxerBytes: Buffer;
  let muxerBytes: Buffer;
  let protocolBytes: Buffer;
  try {
    const inventory = await Promise.allSettled([
      runChild(spawnProcess, ffmpeg, ['-hide_banner', '-encoders'], { signal, timeoutMs: CAPABILITY_TIMEOUT_MS }),
      runChild(spawnProcess, ffmpeg, ['-hide_banner', '-filters'], { signal, timeoutMs: CAPABILITY_TIMEOUT_MS }),
      runChild(spawnProcess, ffmpeg, ['-hide_banner', '-demuxers'], { signal, timeoutMs: CAPABILITY_TIMEOUT_MS }),
      runChild(spawnProcess, ffmpeg, ['-hide_banner', '-muxers'], { signal, timeoutMs: CAPABILITY_TIMEOUT_MS }),
      runChild(spawnProcess, ffmpeg, ['-hide_banner', '-protocols'], { signal, timeoutMs: CAPABILITY_TIMEOUT_MS }),
    ]);
    const rejected = inventory.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
    const settlementFailure = rejected.find(
      ({ reason }) => reason instanceof StudioFilmExportErrorV2 && reason.code === 'child_settlement_failed'
    );
    if (settlementFailure !== undefined) throw settlementFailure.reason;
    if (rejected[0] !== undefined) throw rejected[0].reason;
    [
      { stdout: encoderBytes },
      { stdout: filterBytes },
      { stdout: demuxerBytes },
      { stdout: muxerBytes },
      { stdout: protocolBytes },
    ] = inventory.map((result) => (result as PromiseFulfilledResult<ChildResult>).value);
  } catch (error) {
    if (error instanceof StudioFilmExportErrorV2 && error.code === 'child_settlement_failed') throw error;
    if (signal?.aborted && error instanceof StudioFilmExportErrorV2 && error.code === 'cancelled')
      return { status: 'unavailable', reason: 'unsupported_capabilities' };
    return { status: 'unavailable', reason: 'ffmpeg_unavailable' };
  }
  try {
    await runChild(spawnProcess, ffprobe, ['-hide_banner', '-version'], { signal, timeoutMs: CAPABILITY_TIMEOUT_MS });
  } catch (error) {
    if (error instanceof StudioFilmExportErrorV2 && error.code === 'child_settlement_failed') throw error;
    if (signal?.aborted && error instanceof StudioFilmExportErrorV2 && error.code === 'cancelled')
      return { status: 'unavailable', reason: 'unsupported_capabilities' };
    return { status: 'unavailable', reason: 'ffprobe_unavailable' };
  }
  try {
    const encoders = parseEncoderList(encoderBytes.toString('utf8'));
    // FFmpeg 8 prints three filter-capability columns (`TSC`), while FFmpeg 9
    // folds command support into two (`TS`). Accept both inventories; the
    // capability smoke below remains executable proof of the selected encoder,
    // container, and basic A/V contract; actual renders prove the complete graph.
    const filters = parseFlaggedNames(filterBytes.toString('utf8'), /^\s*[TSC.]{2,3}\s+(\S+)/u);
    const demuxers = parseFlaggedNames(demuxerBytes.toString('utf8'), /^\s*D\s+(\S+)/u);
    const muxers = parseFlaggedNames(muxerBytes.toString('utf8'), /^\s*E\s+(\S+)/u);
    const protocols = parseProtocolList(protocolBytes.toString('utf8'));
    if (
      !encoders.has('aac') ||
      ![
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
      ].every((name) => filters.has(name)) ||
      !['mov', 'mp4', 'matroska', 'webm', 'wav'].every((name) => demuxers.has(name)) ||
      !['mp4', 'rawvideo'].every((name) => muxers.has(name)) ||
      !['fd'].every((name) => protocols.input.has(name)) ||
      !['fd', 'pipe'].every((name) => protocols.output.has(name))
    ) {
      return { status: 'unavailable', reason: 'unsupported_capabilities' };
    }
    for (const encoder of HARDWARE_ENCODERS) {
      if (
        encoders.has(encoder) &&
        (await probeEncoder(
          spawnProcess,
          ffmpeg,
          ffprobe,
          encoder,
          deps.tempRoot ?? os.tmpdir(),
          signal,
          deps.onDiagnostic
        ))
      ) {
        return { status: 'ready', encoder };
      }
    }
    return { status: 'unavailable', reason: 'unsupported_capabilities' };
  } catch (error) {
    if (error instanceof StudioFilmExportErrorV2 && error.code === 'child_settlement_failed') throw error;
    return { status: 'unavailable', reason: 'unsupported_capabilities' };
  }
};

const writeVerifiedSource = async (
  targetPath: string,
  source: StudioFilmVerifiedSourceV2,
  registerOwnership: (ownership: FileOwnership) => void,
  signal: AbortSignal
): Promise<FileIdentity> => {
  let handle: FileHandle;
  try {
    handle = await fs.open(
      targetPath,
      fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | NO_FOLLOW,
      0o600
    );
  } catch {
    return fail('render_failed');
  }
  try {
    const created = await handle.stat();
    if (!created.isFile() || created.nlink !== 1 || created.size !== 0) return fail('render_failed');
    registerOwnership(identity(created));
    const digest = createHash('sha256');
    let byteSize = 0;
    // Acquisition is deliberately not raced with cancellation. A local opener that resolves after
    // abort still hands us a lease, which is then synchronously returned below before this job settles.
    const iterable = await source.openVerifiedStream();
    const iterator = iterable[Symbol.asyncIterator]();
    try {
      if (signal.aborted) throw abortFailure(signal);
      for (;;) {
        const next = await waitWithAbort(iterator.next(), signal);
        if (next.done) break;
        const chunk = next.value;
        if (!(chunk instanceof Uint8Array)) return fail('invalid_media');
        byteSize += chunk.byteLength;
        if (!Number.isSafeInteger(byteSize) || byteSize > source.asset.byteSize) return fail('invalid_media');
        digest.update(chunk);
        let offset = 0;
        while (offset < chunk.byteLength) {
          if (signal.aborted) throw abortFailure(signal);
          const result = await handle.write(chunk, offset, chunk.byteLength - offset);
          if (result.bytesWritten < 1) return fail('render_failed');
          offset += result.bytesWritten;
        }
      }
    } finally {
      const closing = iterator.return?.();
      if (closing !== undefined) {
        // Cancellation may interrupt reads, but not lease release: the job does not settle until
        // the exact verified source stream has closed its descriptor.
        await Promise.resolve(closing);
      }
    }
    if (signal.aborted) throw abortFailure(signal);
    await handle.sync();
    const stats = await handle.stat();
    if (
      !stats.isFile() ||
      stats.nlink !== 1 ||
      byteSize !== source.asset.byteSize ||
      stats.size !== source.asset.byteSize ||
      digest.digest('hex') !== source.asset.sha256
    ) {
      return fail('invalid_media');
    }
    const staged = identity(stats);
    const linked = await fs.lstat(targetPath);
    if (!linked.isFile() || linked.isSymbolicLink() || !sameIdentity(identity(linked), staged)) {
      return fail('invalid_media');
    }
    return staged;
  } catch (error) {
    if (error instanceof StudioFilmExportErrorV2) throw error;
    if (typeof error === 'object' && error !== null && 'code' in error) return fail('render_failed');
    return fail('invalid_media');
  } finally {
    await handle.close();
  }
};

const createOwnedPlaceholder = async (targetPath: string): Promise<{ handle: FileHandle; identity: FileIdentity }> => {
  let handle: FileHandle;
  try {
    handle = await fs.open(
      targetPath,
      fsConstants.O_RDWR | fsConstants.O_CREAT | fsConstants.O_EXCL | NO_FOLLOW,
      0o600
    );
  } catch {
    return fail('render_failed');
  }
  try {
    const created = await handle.stat();
    if (!created.isFile() || created.nlink !== 1 || created.size !== 0) return fail('render_failed');
    return { handle, identity: identity(created) };
  } catch (error) {
    await handle.close();
    throw error;
  }
};

type MediaProbe = StudioVideoDurationProbeV2;

const probeMedia = async (
  spawnProcess: typeof spawn,
  ffprobe: string,
  sourcePath: string,
  expectedIdentity: FileIdentity,
  signal: AbortSignal
): Promise<MediaProbe> => {
  const handle = await openExactFile(sourcePath, expectedIdentity);
  try {
    const result = await runChild(
      spawnProcess,
      ffprobe,
      [
        '-v',
        'error',
        '-show_entries',
        'stream=codec_type,duration,duration_ts,time_base:stream_tags=DURATION:format=duration',
        '-of',
        'json',
        '-fd',
        '3',
        'fd:',
      ],
      { signal, timeoutMs: CAPABILITY_TIMEOUT_MS, inheritedFds: [handle.fd] }
    );
    const parsed = readStudioVideoDurationProbeV2(JSON.parse(result.stdout.toString('utf8')));
    if (parsed === null) return fail('invalid_media');
    if (!sameIdentity(identity(await handle.stat()), expectedIdentity)) return fail('invalid_media');
    return parsed;
  } catch (error) {
    // An already-classified export failure keeps its own cause. Flattening it here
    // reported a cancellation, or a child that never settled, as invalid media —
    // blaming the user's Cut for a failure it did not cause.
    if (error instanceof StudioFilmExportErrorV2) throw error;
    return fail('invalid_media');
  } finally {
    await handle.close();
  }
};

export const deriveStudioQuietTailTrimSecondsV2 = (
  frames: readonly Uint8Array[],
  currentDurationSeconds: number,
  minimumDurationSeconds: number
): number => {
  if (frames.length < QUIET_TAIL_MIN_DELTAS + 1) return 0;
  const expectedBytes = QUIET_TAIL_WIDTH * QUIET_TAIL_HEIGHT;
  if (frames.some((frame) => frame.byteLength !== expectedBytes)) return 0;
  const deltas: number[] = [];
  for (let index = 1; index < frames.length; index += 1) {
    const previous = frames[index - 1]!;
    const current = frames[index]!;
    let sum = 0;
    for (let offset = 0; offset < expectedBytes; offset += 1) sum += Math.abs(current[offset]! - previous[offset]!);
    deltas.push(sum / expectedBytes);
  }
  let quietDeltas = 0;
  for (let index = deltas.length - 1; index >= 0 && deltas[index]! <= QUIET_TAIL_THRESHOLD; index -= 1) {
    quietDeltas += 1;
  }
  if (quietDeltas < QUIET_TAIL_MIN_DELTAS) return 0;
  const available = Math.max(0, currentDurationSeconds - minimumDurationSeconds);
  const raw = Math.min(QUIET_TAIL_WINDOW_SECONDS, quietDeltas / QUIET_TAIL_SAMPLE_RATE, available);
  return Math.max(0, Math.floor(raw * STUDIO_FILM_EXPORT_FRAME_RATE) / STUDIO_FILM_EXPORT_FRAME_RATE);
};

const analyzeQuietTail = async (
  spawnProcess: typeof spawn,
  ffmpeg: string,
  sourcePath: string,
  expectedIdentity: FileIdentity,
  sourceInSeconds: number,
  sourceOutSeconds: number,
  minimumDurationSeconds: number,
  signal: AbortSignal
): Promise<number> => {
  const duration = sourceOutSeconds - sourceInSeconds;
  const window = Math.min(QUIET_TAIL_WINDOW_SECONDS, duration);
  const handle = await openExactFile(sourcePath, expectedIdentity);
  try {
    const result = await runChild(
      spawnProcess,
      ffmpeg,
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-xerror',
        '-ss',
        String(sourceOutSeconds - window),
        '-t',
        String(window),
        '-fd',
        '3',
        '-i',
        'fd:',
        '-an',
        '-vf',
        `fps=${QUIET_TAIL_SAMPLE_RATE},scale=${QUIET_TAIL_WIDTH}:${QUIET_TAIL_HEIGHT}:force_original_aspect_ratio=decrease,pad=${QUIET_TAIL_WIDTH}:${QUIET_TAIL_HEIGHT}:(ow-iw)/2:(oh-ih)/2:black,format=gray`,
        '-f',
        'rawvideo',
        'pipe:1',
      ],
      {
        signal,
        timeoutMs: CAPABILITY_TIMEOUT_MS,
        completeStdoutLimitBytes: MAX_QUIET_TAIL_BYTES,
        inheritedFds: [handle.fd],
      }
    );
    const frameBytes = QUIET_TAIL_WIDTH * QUIET_TAIL_HEIGHT;
    if (result.stdout.byteLength % frameBytes !== 0) return fail('render_failed');
    const frames: Uint8Array[] = [];
    for (let offset = 0; offset < result.stdout.byteLength; offset += frameBytes) {
      frames.push(result.stdout.subarray(offset, offset + frameBytes));
    }
    if (!sameIdentity(identity(await handle.stat()), expectedIdentity)) return fail('invalid_media');
    return deriveStudioQuietTailTrimSecondsV2(frames, duration, minimumDurationSeconds);
  } finally {
    await handle.close();
  }
};

type PlannedSegment =
  | {
      kind: 'shot';
      shotId: string;
      asset: StudioAssetV2;
      sourcePath: string;
      sourceIdentity: FileIdentity;
      sourceInSeconds: number;
      /** Authored exclusive endpoint retained for nominal-duration facts. */
      sourceOutSeconds: number;
      /** Decoded exclusive endpoint used before optional quiet-tail removal. */
      effectiveSourceOutSeconds: number;
      renderedSourceOutSeconds: number;
      normalizedDurationSeconds: number;
      chainBreak: 'none' | 'hard_cut';
      hasAudio: boolean;
    }
  | {
      kind: 'slate';
      beatId: string;
      shotId: string | null;
      nominalDurationSeconds: number;
      durationSeconds: number;
    };

const decimal = (value: number): string => Number(value.toFixed(12)).toString();

const exceedsDurationTolerance = (left: number, right: number, tolerance: number): boolean =>
  left - right - tolerance > Number.EPSILON * Math.max(1, Math.abs(left), Math.abs(right)) * 4;

const frameAlignedDuration = (seconds: number, errorCode: StudioFilmExportErrorCodeV2 = 'invalid_media'): number => {
  const frames = Math.floor(seconds * STUDIO_FILM_EXPORT_FRAME_RATE + 1e-9);
  if (!Number.isSafeInteger(frames) || frames < 1) return fail(errorCode);
  return frames / STUDIO_FILM_EXPORT_FRAME_RATE;
};

const defaultAvailableDiskBytes = async (directoryPath: string): Promise<number> => {
  const stats = await fs.statfs(directoryPath);
  const available = Number(stats.bavail) * Number(stats.bsize);
  if (!Number.isSafeInteger(available) || available < 0) return fail('render_failed');
  return available;
};

const deriveFilmOutputByteLimit = (durationSeconds: number, dimensions: { width: number; height: number }): number => {
  const videoBitsPerSecond = dimensions.width >= 1920 || dimensions.height >= 1920 ? 12_000_000 : 8_000_000;
  const targetBytes = Math.ceil((durationSeconds * (videoBitsPerSecond + 192_000)) / 8);
  const limit = Math.min(
    MAX_OUTPUT_BYTES,
    Math.ceil(targetBytes * OUTPUT_RATE_MARGIN_MULTIPLIER) + OUTPUT_CONTAINER_MARGIN_BYTES
  );
  if (!Number.isSafeInteger(limit) || limit < 1) return fail('render_failed');
  return limit;
};

const requiredFilmWorkspaceBytes = (sourceBytes: number, outputByteLimit: number): number => {
  const required = sourceBytes + outputByteLimit + DISK_SAFETY_MARGIN_BYTES;
  if (!Number.isSafeInteger(required) || required < 1) return fail('render_failed');
  return required;
};

const assertAvailableDisk = async (
  readAvailable: (directoryPath: string) => Promise<number>,
  directoryPath: string,
  requiredBytes: number
): Promise<void> => {
  try {
    const available = await readAvailable(directoryPath);
    if (!Number.isSafeInteger(available) || available < requiredBytes) return fail('render_failed');
  } catch (error) {
    if (error instanceof StudioFilmExportErrorV2) throw error;
    return fail('render_failed');
  }
};

const renderArguments = (input: {
  segments: readonly PlannedSegment[];
  sourceFds: readonly number[];
  bedFd: number | null;
  dimensions: { width: number; height: number };
  transition: StudioFilmRenderedTransitionV2;
  encoder: HardwareEncoder;
  outputFd: number;
  outputByteLimit: number;
  renderedDurationSeconds: number;
}): string[] => {
  const args = ['-hide_banner', '-loglevel', 'error', '-xerror', '-nostdin'];
  const videoInputs: number[] = [];
  const audioInputs: number[] = [];
  let inputIndex = 0;
  let sourceFdIndex = 0;
  for (const segment of input.segments) {
    const duration = segment.kind === 'shot' ? segment.normalizedDurationSeconds : segment.durationSeconds;
    if (segment.kind === 'shot') {
      const sourceFd = input.sourceFds[sourceFdIndex];
      if (sourceFd === undefined) return fail('render_failed');
      args.push('-ss', decimal(segment.sourceInSeconds), '-t', decimal(duration), '-fd', String(sourceFd), '-i', 'fd:');
      sourceFdIndex += 1;
    } else {
      args.push(
        '-f',
        'lavfi',
        '-t',
        decimal(duration),
        '-i',
        `color=c=black:s=${input.dimensions.width}x${input.dimensions.height}:r=${STUDIO_FILM_EXPORT_FRAME_RATE}`
      );
    }
    videoInputs.push(inputIndex);
    inputIndex += 1;
    if (segment.kind === 'shot' && segment.hasAudio) {
      audioInputs.push(videoInputs.at(-1)!);
    } else {
      args.push(
        '-f',
        'lavfi',
        '-t',
        decimal(duration),
        '-i',
        `anullsrc=channel_layout=stereo:sample_rate=${STUDIO_FILM_EXPORT_AUDIO_SAMPLE_RATE}`
      );
      audioInputs.push(inputIndex);
      inputIndex += 1;
    }
  }
  if (sourceFdIndex !== input.sourceFds.length) return fail('render_failed');
  const bedInput = input.bedFd === null ? null : inputIndex;
  if (input.bedFd !== null) {
    args.push('-t', decimal(input.renderedDurationSeconds), '-fd', String(input.bedFd), '-i', 'fd:');
  }

  const filters: string[] = [];
  input.segments.forEach((segment, index) => {
    const duration = segment.kind === 'shot' ? segment.normalizedDurationSeconds : segment.durationSeconds;
    filters.push(
      `[${videoInputs[index]}:v:0]scale=${input.dimensions.width}:${input.dimensions.height}:force_original_aspect_ratio=decrease,pad=${input.dimensions.width}:${input.dimensions.height}:(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps=${STUDIO_FILM_EXPORT_FRAME_RATE},trim=duration=${decimal(duration)},setpts=PTS-STARTPTS,format=yuv420p[v${index}]`
    );
    filters.push(
      `[${audioInputs[index]}:a:0]aformat=sample_fmts=fltp:sample_rates=${STUDIO_FILM_EXPORT_AUDIO_SAMPLE_RATE}:channel_layouts=stereo,apad,atrim=duration=${decimal(duration)},asetpts=PTS-STARTPTS[a${index}]`
    );
  });

  const dissolveSeconds = input.transition.kind === 'dissolve' ? input.transition.seconds : 0;
  const groups: number[][] = [];
  input.segments.forEach((segment, index) => {
    const previous = input.segments[index - 1];
    const canDissolve =
      dissolveSeconds > 0 &&
      index > 0 &&
      previous?.kind === 'shot' &&
      segment.kind === 'shot' &&
      segment.chainBreak === 'none';
    if (!canDissolve) groups.push([index]);
    else groups.at(-1)!.push(index);
  });
  const groupOutputs: Array<{ video: string; audio: string }> = [];
  let xfadeIndex = 0;
  for (const group of groups) {
    let video = `v${group[0]}`;
    let audio = `a${group[0]}`;
    let duration = (() => {
      const first = input.segments[group[0]!]!;
      return first.kind === 'shot' ? first.normalizedDurationSeconds : first.durationSeconds;
    })();
    for (const segmentIndex of group.slice(1)) {
      const next = input.segments[segmentIndex]!;
      const nextDuration = next.kind === 'shot' ? next.normalizedDurationSeconds : next.durationSeconds;
      const nextVideo = `vx${xfadeIndex}`;
      const nextAudio = `ax${xfadeIndex}`;
      filters.push(
        `[${video}][v${segmentIndex}]xfade=transition=fade:duration=${decimal(dissolveSeconds)}:offset=${decimal(duration - dissolveSeconds)}[${nextVideo}]`
      );
      filters.push(`[${audio}][a${segmentIndex}]acrossfade=d=${decimal(dissolveSeconds)}:c1=tri:c2=tri[${nextAudio}]`);
      video = nextVideo;
      audio = nextAudio;
      duration += nextDuration - dissolveSeconds;
      xfadeIndex += 1;
    }
    groupOutputs.push({ video, audio });
  }

  let videoOutput: string;
  let audioOutput: string;
  if (groupOutputs.length === 1) {
    videoOutput = groupOutputs[0]!.video;
    audioOutput = groupOutputs[0]!.audio;
  } else {
    const inputs = groupOutputs.map(({ video, audio }) => `[${video}][${audio}]`).join('');
    filters.push(`${inputs}concat=n=${groupOutputs.length}:v=1:a=1[vjoined][ajoined]`);
    videoOutput = 'vjoined';
    audioOutput = 'ajoined';
  }

  if (bedInput !== null) {
    const fadeDuration = Math.min(STUDIO_BED_FADE_OUT_SECONDS, input.renderedDurationSeconds);
    const fadeStart = Math.max(0, input.renderedDurationSeconds - fadeDuration);
    filters.push(`[${audioOutput}]volume=${STUDIO_FILM_EXPORT_TAKE_GAIN}[atakes]`);
    filters.push(
      `[${bedInput}:a:0]aformat=sample_fmts=fltp:sample_rates=${STUDIO_FILM_EXPORT_AUDIO_SAMPLE_RATE}:channel_layouts=stereo,atrim=duration=${decimal(input.renderedDurationSeconds)},asetpts=PTS-STARTPTS,volume=${STUDIO_FILM_EXPORT_BED_GAIN},afade=t=out:st=${decimal(fadeStart)}:d=${decimal(fadeDuration)}[abed]`
    );
    filters.push(
      '[atakes][abed]amix=inputs=2:duration=first:normalize=0:dropout_transition=0,alimiter=limit=0.95:latency=1[aout]'
    );
    audioOutput = 'aout';
  } else {
    filters.push(`[${audioOutput}]alimiter=limit=0.95:latency=1[aout]`);
    audioOutput = 'aout';
  }

  args.push(
    '-filter_complex',
    filters.join(';'),
    '-map',
    `[${videoOutput}]`,
    '-map',
    `[${audioOutput}]`,
    '-c:v',
    input.encoder,
    '-profile:v',
    'high',
    '-level:v',
    '4.2',
    '-pix_fmt',
    'yuv420p',
    '-color_primaries',
    'bt709',
    '-color_trc',
    'bt709',
    '-colorspace',
    'bt709',
    '-color_range',
    'tv',
    '-g',
    '48',
    '-b:v',
    input.dimensions.width >= 1920 || input.dimensions.height >= 1920 ? '12M' : '8M',
    '-bsf:v',
    'h264_metadata=video_full_range_flag=0:colour_primaries=1:transfer_characteristics=1:matrix_coefficients=1',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-ar',
    String(STUDIO_FILM_EXPORT_AUDIO_SAMPLE_RATE),
    '-ac',
    String(STUDIO_FILM_EXPORT_AUDIO_CHANNELS),
    '-video_track_timescale',
    '24000',
    '-map_metadata',
    '-1',
    '-map_chapters',
    '-1',
    '-fs',
    String(input.outputByteLimit),
    '-progress',
    'pipe:1',
    '-nostats',
    '-f',
    'mp4',
    '-fd',
    String(input.outputFd),
    'fd:'
  );
  return args;
};

const verifyOutput = async (
  spawnProcess: typeof spawn,
  ffmpeg: string,
  ffprobe: string,
  outputPath: string,
  outputHandle: FileHandle,
  outputOwnership: FileOwnership,
  expected: { width: number; height: number; durationSeconds: number; outputByteLimit: number },
  signal: AbortSignal
): Promise<{ identity: FileIdentity; byteSize: number; sha256: string }> => {
  if (signal.aborted) throw abortFailure(signal);
  const initial = await outputHandle.stat();
  const linked = await fs.lstat(outputPath);
  if (
    !initial.isFile() ||
    initial.nlink !== 1 ||
    initial.size < 1 ||
    initial.size > expected.outputByteLimit ||
    !linked.isFile() ||
    linked.isSymbolicLink() ||
    !sameFileObject(identity(initial), outputOwnership) ||
    !sameIdentity(identity(initial), identity(linked))
  ) {
    return fail('render_failed');
  }
  const probeHandle = await openExactFile(outputPath, identity(initial), 'render_failed');
  let result: ChildResult;
  try {
    result = await runChild(
      spawnProcess,
      ffprobe,
      [
        '-v',
        'error',
        '-show_entries',
        'format=format_name,duration:stream=codec_type,codec_name,profile,level,width,height,pix_fmt,sample_aspect_ratio,color_range,color_space,color_transfer,color_primaries,r_frame_rate,avg_frame_rate,time_base,duration,nb_frames,sample_fmt,sample_rate,channels,channel_layout',
        '-of',
        'json',
        '-fd',
        '3',
        'fd:',
      ],
      { signal, timeoutMs: CAPABILITY_TIMEOUT_MS, inheritedFds: [probeHandle.fd] }
    );
  } finally {
    await probeHandle.close();
  }
  try {
    const parsed = JSON.parse(result.stdout.toString('utf8')) as StudioFilmProbeJson;
    const contract = validateFilmProbeContract(parsed);
    if (contract === null) return fail('render_failed');
    const { video, audio, duration } = contract;
    const videoDuration = Number(video.duration);
    const audioDuration = Number(audio.duration);
    const videoFrames = Number(video.nb_frames);
    const expectedFrames = Math.round(expected.durationSeconds * STUDIO_FILM_EXPORT_FRAME_RATE);
    if (
      video.width !== expected.width ||
      video.height !== expected.height ||
      !Number.isSafeInteger(videoFrames) ||
      Math.abs(videoFrames - expectedFrames) > 1 ||
      !Number.isFinite(videoDuration) ||
      Math.abs(videoDuration - expected.durationSeconds) > 1 / STUDIO_FILM_EXPORT_FRAME_RATE + 1e-6 ||
      !Number.isFinite(audioDuration) ||
      Math.abs(audioDuration - expected.durationSeconds) > STUDIO_FILM_EXPORT_MEDIA_DURATION_TOLERANCE_SECONDS ||
      Math.abs(duration - expected.durationSeconds) > STUDIO_FILM_EXPORT_MEDIA_DURATION_TOLERANCE_SECONDS
    ) {
      return fail('render_failed');
    }
  } catch (error) {
    if (error instanceof StudioFilmExportErrorV2) throw error;
    return fail('render_failed');
  }
  const decodeHandle = await openExactFile(outputPath, identity(initial), 'render_failed');
  try {
    await runChild(
      spawnProcess,
      ffmpeg,
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-xerror',
        '-fd',
        '3',
        '-i',
        'fd:',
        '-map',
        '0:v:0',
        '-map',
        '0:a:0',
        '-f',
        'null',
        '-',
      ],
      {
        signal,
        timeoutMs: Math.min(
          MAX_RENDER_TIMEOUT_MS,
          Math.max(CAPABILITY_TIMEOUT_MS, Math.ceil(expected.durationSeconds * 5_000))
        ),
        inheritedFds: [decodeHandle.fd],
      }
    );
    if (!sameIdentity(identity(await decodeHandle.stat()), identity(initial))) return fail('render_failed');
  } finally {
    await decodeHandle.close();
  }
  if (signal.aborted) throw abortFailure(signal);
  const stats = await outputHandle.stat();
  const digest = createHash('sha256');
  const buffer = Buffer.allocUnsafe(64 * 1024);
  let position = 0;
  while (position < stats.size) {
    if (signal.aborted) throw abortFailure(signal);
    const read = await outputHandle.read(buffer, 0, Math.min(buffer.byteLength, stats.size - position), position);
    if (read.bytesRead < 1) return fail('render_failed');
    digest.update(buffer.subarray(0, read.bytesRead));
    position += read.bytesRead;
  }
  if (signal.aborted) throw abortFailure(signal);
  const after = await outputHandle.stat();
  const afterLink = await fs.lstat(outputPath);
  if (
    !sameIdentity(identity(stats), identity(after)) ||
    !afterLink.isFile() ||
    afterLink.isSymbolicLink() ||
    !sameIdentity(identity(after), identity(afterLink))
  )
    return fail('render_failed');
  return { identity: identity(stats), byteSize: stats.size, sha256: digest.digest('hex') };
};

export const createStudioFilmExporterV2 = (deps: StudioFilmExporterDepsV2 = {}): StudioFilmExporterV2 => {
  const spawnProcess = deps.spawnProcess ?? spawn;
  const { ffmpeg, ffprobe } = resolveStudioFfmpegBinaries(deps);
  const activeChildren = new Set<AbortController>();
  const readAvailableDiskBytes = deps.getAvailableDiskBytes ?? defaultAvailableDiskBytes;
  let capabilityFlight: Promise<StudioFilmExportCapabilityV2> | null = null;
  let disposed = false;

  const readCapability = (): Promise<StudioFilmExportCapabilityV2> => {
    if (disposed) return Promise.resolve({ status: 'unavailable', reason: 'unsupported_capabilities' });
    if (capabilityFlight !== null) return capabilityFlight;
    const lifecycleController = new AbortController();
    activeChildren.add(lifecycleController);
    const flight = capabilityFor(deps, spawnProcess, lifecycleController.signal).finally(() => {
      activeChildren.delete(lifecycleController);
      if (capabilityFlight === flight) capabilityFlight = null;
    });
    capabilityFlight = flight;
    return capabilityFlight;
  };

  return {
    capability: readCapability,
    async render(input): Promise<StudioFilmRenderedOutputV2> {
      if (disposed || input.signal.aborted) return fail('cancelled');
      const lifecycleController = new AbortController();
      const abortLifecycle = (): void =>
        lifecycleController.abort(
          input.signal.reason instanceof StudioFilmExportErrorV2
            ? input.signal.reason
            : new StudioFilmExportErrorV2('cancelled')
        );
      input.signal.addEventListener('abort', abortLifecycle, { once: true });
      activeChildren.add(lifecycleController);
      const renderSignal = lifecycleController.signal;
      const lifecycleTimer = setTimeout(
        () => lifecycleController.abort(new StudioFilmExportErrorV2('render_failed', 'film_deadline_elapsed')),
        MAX_RENDER_TIMEOUT_MS
      );
      lifecycleTimer.unref?.();
      try {
        const capability = await capabilityFor(deps, spawnProcess, renderSignal);
        if (renderSignal.aborted) throw abortFailure(renderSignal);
        if (disposed) return fail('cancelled');
        if (capability.status !== 'ready') {
          return fail(
            capability.reason === 'unsupported_capabilities' ? 'unsupported_capabilities' : 'ffmpeg_unavailable'
          );
        }
        if (
          (input.transition.kind === 'dissolve' &&
            (!Number.isFinite(input.transition.seconds) ||
              input.transition.seconds < 1 / STUDIO_FILM_EXPORT_FRAME_RATE ||
              input.transition.seconds > 1)) ||
          (input.transition.kind !== 'cut' && input.transition.kind !== 'dissolve')
        ) {
          return fail('invalid_project');
        }
        const renderedTransition: StudioFilmRenderedTransitionV2 =
          input.transition.kind === 'cut'
            ? { kind: 'cut' }
            : {
                kind: 'dissolve',
                requestedSeconds: input.transition.seconds,
                seconds: frameAlignedDuration(input.transition.seconds, 'invalid_project'),
              };
        const sourceById = new Map(input.sources.map((source) => [source.asset.id, source]));
        if (sourceById.size !== input.sources.length) return fail('invalid_media');
        const composition = (deps.composeEditorFolder ?? composeStudioEditorFolderV2)(
          input.project,
          input.sources.map(({ asset }) => ({ assetId: asset.id, byteSize: asset.byteSize, sha256: asset.sha256 }))
        );
        const requiredIds = deriveStudioFilmRequiredAssetIdsV2(input.project);
        if (
          requiredIds.length !== input.sources.length ||
          requiredIds.some((assetId) => !sourceById.has(assetId)) ||
          input.sources.some(({ asset }) => !LOWERCASE_SHA256.test(asset.sha256))
        ) {
          return fail('invalid_media');
        }
        const dimensions = deriveStudioFilmDimensionsV2(input.project);
        const sourceBytes = input.sources.reduce((total, { asset }) => total + asset.byteSize, 0);
        const outputByteLimit = deriveFilmOutputByteLimit(composition.timeline.durationSeconds, dimensions);
        const tempRoot = deps.tempRoot ?? os.tmpdir();
        await assertAvailableDisk(
          readAvailableDiskBytes,
          tempRoot,
          requiredFilmWorkspaceBytes(sourceBytes, outputByteLimit)
        );

        input.onProgress({ phase: 'preparing', progress: 0 });
        const workspace = await mkdtemp(path.join(tempRoot, 'weprompt-film-'));
        const workspaceOwnership: DirectoryOwnership = identity(await fs.lstat(workspace));
        const ownedFiles = new Map<string, FileOwnership>();
        const ownedHandles = new Set<FileHandle>();
        let outputPublished = false;
        const cleanup = async (): Promise<void> => {
          const preserve = (): void => {
            try {
              deps.onDiagnostic?.('cleanup_preserved');
            } catch {
              // Diagnostics cannot change cleanup or publication semantics.
            }
          };
          const handles = [...ownedHandles];
          ownedHandles.clear();
          const closeResults = await Promise.allSettled(handles.map((handle) => handle.close()));
          if (closeResults.some((result) => result.status === 'rejected')) {
            preserve();
            return;
          }
          try {
            const currentDirectory = await fs.lstat(workspace);
            if (
              !currentDirectory.isDirectory() ||
              !sameDirectoryObject(identity(currentDirectory), workspaceOwnership)
            ) {
              preserve();
              return;
            }
            const names = await fs.readdir(workspace);
            if (names.some((name) => !ownedFiles.has(name))) {
              preserve();
              return;
            }
            for (const name of names) {
              const expected = ownedFiles.get(name)!;
              const target = path.join(workspace, name);
              const current = await fs.lstat(target);
              if (!current.isFile() || current.isSymbolicLink() || !sameFileObject(identity(current), expected)) {
                preserve();
                return;
              }
            }
            for (const name of names) await fs.unlink(path.join(workspace, name));
            await fs.rmdir(workspace);
          } catch {
            // A changed temp tree is deliberately preserved instead of deleting an unproved replacement.
            preserve();
          }
        };

        try {
          const materialized = new Map<string, { filePath: string; identity: FileIdentity }>();
          for (let index = 0; index < requiredIds.length; index += 1) {
            if (renderSignal.aborted) throw abortFailure(renderSignal);
            if (disposed) return fail('cancelled');
            const assetId = requiredIds[index]!;
            const source = sourceById.get(assetId);
            if (source === undefined || source.asset.id !== assetId) return fail('invalid_media');
            const name = `source-${String(index).padStart(3, '0')}.${extensionForAsset(source.asset)}`;
            const target = path.join(workspace, name);
            const stagedIdentity = await writeVerifiedSource(
              target,
              source,
              (ownership) => ownedFiles.set(name, ownership),
              renderSignal
            );
            materialized.set(assetId, { filePath: target, identity: stagedIdentity });
            input.onProgress({ phase: 'preparing', progress: (index + 1) / Math.max(1, requiredIds.length) });
          }

          const timelineEntries = composition.timeline.beats.flatMap((beat) => beat.entries);
          const lastShotEntryIndex = timelineEntries.findLastIndex((entry) => entry.kind === 'shot');
          const segments: PlannedSegment[] = [];
          input.onProgress({ phase: 'analyzing', progress: 0 });
          for (let index = 0; index < timelineEntries.length; index += 1) {
            const entry = timelineEntries[index]!;
            if (entry.kind === 'slate') {
              segments.push({
                kind: 'slate',
                beatId: composition.timeline.beats.find((beat) => beat.entries.includes(entry))!.beatId,
                shotId: entry.shotId,
                nominalDurationSeconds: entry.durationSeconds,
                durationSeconds: frameAlignedDuration(entry.durationSeconds),
              });
            } else {
              const asset = ownValue(input.project.assets, entry.videoAssetId);
              const staged = materialized.get(entry.videoAssetId);
              if (asset === undefined || staged === undefined) return fail('invalid_media');
              const sourceInSeconds = entry.sourceInSeconds;
              const sourceOutSeconds = entry.sourceOutSeconds;
              const authoredDurationSeconds = sourceOutSeconds - sourceInSeconds;
              if (
                !Number.isFinite(authoredDurationSeconds) ||
                authoredDurationSeconds <= 0 ||
                authoredDurationSeconds > Number.MAX_SAFE_INTEGER
              ) {
                return fail('invalid_media');
              }
              const media = await probeMedia(spawnProcess, ffprobe, staged.filePath, staged.identity, renderSignal);
              const requestedEnvelopeEndSeconds = Math.min(sourceOutSeconds, media.envelopeDurationSeconds);
              if (
                exceedsDurationTolerance(
                  requestedEnvelopeEndSeconds,
                  media.videoDurationSeconds,
                  STUDIO_FILM_EXPORT_MEDIA_DURATION_TOLERANCE_SECONDS
                )
              ) {
                return fail('invalid_media');
              }
              const effectiveSourceOutSeconds = Math.min(sourceOutSeconds, media.videoDurationSeconds);
              const effectiveDurationSeconds = effectiveSourceOutSeconds - sourceInSeconds;
              if (
                !Number.isFinite(effectiveDurationSeconds) ||
                effectiveDurationSeconds <= 0 ||
                effectiveDurationSeconds > Number.MAX_SAFE_INTEGER
              ) {
                return fail('invalid_media');
              }
              const minimumDuration = Math.max(
                1,
                renderedTransition.kind === 'dissolve' ? 1 + renderedTransition.seconds : 1
              );
              const trimmedSeconds =
                input.trimTails && index !== lastShotEntryIndex
                  ? await analyzeQuietTail(
                      spawnProcess,
                      ffmpeg,
                      staged.filePath,
                      staged.identity,
                      sourceInSeconds,
                      effectiveSourceOutSeconds,
                      minimumDuration,
                      renderSignal
                    )
                  : 0;
              const renderedDuration = frameAlignedDuration(effectiveDurationSeconds - trimmedSeconds);
              segments.push({
                kind: 'shot',
                shotId: entry.shotId,
                asset,
                sourcePath: staged.filePath,
                sourceIdentity: staged.identity,
                sourceInSeconds,
                sourceOutSeconds,
                effectiveSourceOutSeconds,
                renderedSourceOutSeconds: effectiveSourceOutSeconds - trimmedSeconds,
                normalizedDurationSeconds: renderedDuration,
                chainBreak: entry.chainBreak,
                hasAudio: media.hasAudio,
              });
            }
            input.onProgress({ phase: 'analyzing', progress: (index + 1) / timelineEntries.length });
          }
          if (segments.length === 0) return fail('invalid_project');
          const dissolveSeconds = renderedTransition.kind === 'dissolve' ? renderedTransition.seconds : 0;
          let transitionCount = 0;
          for (let index = 1; index < segments.length; index += 1) {
            const previous = segments[index - 1]!;
            const current = segments[index]!;
            if (
              dissolveSeconds > 0 &&
              previous.kind === 'shot' &&
              current.kind === 'shot' &&
              current.chainBreak === 'none'
            ) {
              const previousDuration = previous.normalizedDurationSeconds;
              const currentDuration = current.normalizedDurationSeconds;
              if (previousDuration <= dissolveSeconds || currentDuration <= dissolveSeconds)
                return fail('invalid_media');
              transitionCount += 1;
            }
          }
          const nominalDurationSeconds = segments.reduce(
            (sum, segment) =>
              sum +
              (segment.kind === 'shot'
                ? segment.sourceOutSeconds - segment.sourceInSeconds
                : segment.nominalDurationSeconds),
            0
          );
          const renderedDurationSeconds =
            segments.reduce(
              (sum, segment) =>
                sum + (segment.kind === 'shot' ? segment.normalizedDurationSeconds : segment.durationSeconds),
              0
            ) -
            transitionCount * dissolveSeconds;
          const bedAsset =
            input.project.bedAssetId === null ? null : ownValue(input.project.assets, input.project.bedAssetId);
          const bedSource =
            bedAsset === null || bedAsset === undefined ? null : (materialized.get(bedAsset.id) ?? null);
          if ((input.project.bedAssetId === null) !== (bedSource === null)) return fail('invalid_media');
          const outputName = 'film.mp4';
          await assertAvailableDisk(readAvailableDiskBytes, workspace, requiredFilmWorkspaceBytes(0, outputByteLimit));
          const outputPath = path.join(workspace, outputName);
          const output = await createOwnedPlaceholder(outputPath);
          ownedFiles.set(outputName, output.identity);
          ownedHandles.add(output.handle);
          let progressText = '';
          input.onProgress({ phase: 'rendering', progress: 0 });
          const timeoutMs = Math.min(
            MAX_RENDER_TIMEOUT_MS,
            Math.max(MIN_RENDER_TIMEOUT_MS, Math.ceil(renderedDurationSeconds * 15_000))
          );
          const renderSourceHandles: FileHandle[] = [];
          const renderedShots = segments.filter(
            (segment): segment is Extract<PlannedSegment, { kind: 'shot' }> => segment.kind === 'shot'
          );
          let bedHandle: FileHandle | null = null;
          let renderFailure: unknown;
          try {
            for (const segment of renderedShots) {
              renderSourceHandles.push(await openExactFile(segment.sourcePath, segment.sourceIdentity));
            }
            if (bedSource !== null) bedHandle = await openExactFile(bedSource.filePath, bedSource.identity);
            const sourceFds = renderSourceHandles.map((_, index) => 3 + index);
            const bedFd = bedHandle === null ? null : 3 + renderSourceHandles.length;
            const outputFd = 3 + renderSourceHandles.length + (bedHandle === null ? 0 : 1);
            await runChild(
              spawnProcess,
              ffmpeg,
              renderArguments({
                segments,
                sourceFds,
                bedFd,
                dimensions,
                transition: renderedTransition,
                encoder: capability.encoder,
                outputFd,
                outputByteLimit,
                renderedDurationSeconds,
              }),
              {
                signal: renderSignal,
                timeoutMs,
                inheritedFds: [
                  ...renderSourceHandles.map((handle) => handle.fd),
                  ...(bedHandle === null ? [] : [bedHandle.fd]),
                  output.handle.fd,
                ],
                onStdout: (chunk) => {
                  progressText = `${progressText}${chunk.toString('utf8')}`.slice(-4096);
                  const match = Array.from(progressText.matchAll(/out_time_ms=(\d+)/gu)).at(-1);
                  if (match?.[1] !== undefined) {
                    const ratio = Number(match[1]) / 1_000_000 / renderedDurationSeconds;
                    input.onProgress({ phase: 'rendering', progress: Math.max(0, Math.min(1, ratio)) });
                  }
                },
              }
            );
            for (let index = 0; index < renderSourceHandles.length; index += 1) {
              if (
                !sameIdentity(identity(await renderSourceHandles[index]!.stat()), renderedShots[index]!.sourceIdentity)
              )
                return fail('invalid_media');
            }
            if (bedHandle !== null && bedSource !== null) {
              if (!sameIdentity(identity(await bedHandle.stat()), bedSource.identity)) return fail('invalid_media');
            }
          } catch (error) {
            renderFailure = error;
          }
          const closeResults = await Promise.allSettled([
            ...renderSourceHandles.map((handle) => handle.close()),
            ...(bedHandle === null ? [] : [bedHandle.close()]),
          ]);
          if (closeResults.some((result) => result.status === 'rejected')) return fail('render_failed');
          if (renderFailure !== undefined) throw renderFailure;
          const verified = await verifyOutput(
            spawnProcess,
            ffmpeg,
            ffprobe,
            outputPath,
            output.handle,
            output.identity,
            { ...dimensions, durationSeconds: renderedDurationSeconds, outputByteLimit },
            renderSignal
          );
          if (renderSignal.aborted) throw abortFailure(renderSignal);
          if (disposed) return fail('cancelled');
          const facts: StudioFilmExportFactsV2 = {
            schemaVersion: STUDIO_FILM_EXPORT_FACTS_SCHEMA_VERSION,
            nominalDurationSeconds,
            renderedDurationSeconds,
            transition: structuredClone(renderedTransition),
            dissolveCount: transitionCount,
            trimTails: input.trimTails,
            segments: segments.map((segment) =>
              segment.kind === 'shot'
                ? {
                    kind: 'shot',
                    shotId: segment.shotId,
                    sourceAssetId: segment.asset.id,
                    sourceSha256: segment.asset.sha256,
                    sourceInSeconds: segment.sourceInSeconds,
                    sourceOutSeconds: segment.sourceOutSeconds,
                    effectiveSourceOutSeconds: segment.effectiveSourceOutSeconds,
                    renderedSourceOutSeconds: segment.renderedSourceOutSeconds,
                    normalizedDurationSeconds: segment.normalizedDurationSeconds,
                    chainBreak: segment.chainBreak,
                    hasAudio: segment.hasAudio,
                  }
                : {
                    kind: 'slate',
                    beatId: segment.beatId,
                    shotId: segment.shotId,
                    durationSeconds: segment.nominalDurationSeconds,
                    normalizedDurationSeconds: segment.durationSeconds,
                  }
            ),
            video: {
              container: 'mp4',
              codec: 'h264',
              encoder: capability.encoder,
              profile: 'high',
              level: '4.2',
              ...dimensions,
              frameRate: STUDIO_FILM_EXPORT_FRAME_RATE,
              pixelFormat: 'yuv420p',
              scaleMode: 'contain_black_pad',
              sampleAspectRatio: '1:1',
              colorPrimaries: 'bt709',
              colorTransfer: 'bt709',
              colorSpace: 'bt709',
              colorRange: 'tv',
              gopFrames: 48,
              bitrate: dimensions.width >= 1920 || dimensions.height >= 1920 ? 12_000_000 : 8_000_000,
              trackTimeBase: '1/24000',
              metadataStripped: true,
              chaptersStripped: true,
              fastStart: false,
            },
            audio: {
              codec: 'aac',
              sampleRate: STUDIO_FILM_EXPORT_AUDIO_SAMPLE_RATE,
              channels: STUDIO_FILM_EXPORT_AUDIO_CHANNELS,
              channelLayout: 'stereo',
              sampleFormat: 'fltp',
              bitrate: 192_000,
              silenceForMissingStreams: true,
              takeGain: bedAsset === null ? 1 : STUDIO_FILM_EXPORT_TAKE_GAIN,
              bedAssetId: bedAsset?.id ?? null,
              bedSha256: bedAsset?.sha256 ?? null,
              bedGain: bedAsset === null ? null : STUDIO_FILM_EXPORT_BED_GAIN,
              bedFadeOutSeconds:
                bedAsset === null ? null : Math.min(STUDIO_BED_FADE_OUT_SECONDS, renderedDurationSeconds),
              bedFadeCurve: bedAsset === null ? null : 'triangular',
              dissolveCrossfade: transitionCount > 0,
              dissolveCurve: 'triangular',
              limiterPeak: 0.95,
              limiterLatencyCompensated: true,
            },
          };
          let streamOpened = false;
          const openVerifiedStream = async (): Promise<AsyncIterable<Uint8Array>> => {
            if (streamOpened || !ownedHandles.has(output.handle)) return fail('render_failed');
            const current = identity(await output.handle.stat());
            const linked = await fs.lstat(outputPath);
            if (
              !sameIdentity(current, verified.identity) ||
              !linked.isFile() ||
              linked.isSymbolicLink() ||
              !sameIdentity(identity(linked), verified.identity)
            )
              return fail('render_failed');
            streamOpened = true;
            return output.handle.createReadStream({ autoClose: false, start: 0 });
          };
          outputPublished = true;
          return { facts, byteSize: verified.byteSize, sha256: verified.sha256, openVerifiedStream, cleanup };
        } finally {
          if (!outputPublished) await cleanup();
        }
      } finally {
        clearTimeout(lifecycleTimer);
        input.signal.removeEventListener('abort', abortLifecycle);
        activeChildren.delete(lifecycleController);
      }
    },
    dispose(): void {
      disposed = true;
      for (const controller of activeChildren) controller.abort(new StudioFilmExportErrorV2('cancelled'));
      activeChildren.clear();
    },
  };
};

export const DEFAULT_STUDIO_FILM_TRANSITION_V2: StudioFilmExportTransitionV2 = {
  kind: 'dissolve',
  seconds: STUDIO_FILM_EXPORT_DISSOLVE_SECONDS,
};
