/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { accessSync, constants, statSync } from 'node:fs';
import path from 'node:path';

export type StudioFfmpegBinaryOverrides = {
  ffmpegBinary?: string;
  ffprobeBinary?: string;
};

export type StudioFfmpegBinaryRuntime = {
  resourcesPath?: string | null;
  platform?: NodeJS.Platform;
  arch?: string;
  isExecutableFile?: (candidate: string) => boolean;
};

type StudioFfmpegBinaries = { ffmpeg: string; ffprobe: string };

const pathFlavor = (value: string): typeof path.posix | typeof path.win32 =>
  value.includes('\\') || /^[a-zA-Z]:[\\/]/u.test(value) ? path.win32 : path.posix;

const configuredBinary = (value: string | undefined): string | null => {
  const trimmed = value?.trim() || null;
  if (trimmed === null || (!trimmed.includes('/') && !trimmed.includes('\\'))) return trimmed;
  return pathFlavor(trimmed).resolve(trimmed);
};

const siblingBinary = (binary: string, siblingName: 'ffmpeg' | 'ffprobe'): string | null => {
  if (!binary.includes('/') && !binary.includes('\\')) return null;
  const flavor = pathFlavor(binary);
  const extension = flavor.extname(binary).toLowerCase() === '.exe' ? '.exe' : '';
  return flavor.join(flavor.dirname(binary), `${siblingName}${extension}`);
};

const configuredPair = (
  ffmpegValue: string | undefined,
  ffprobeValue: string | undefined
): StudioFfmpegBinaries | null => {
  const ffmpegBinary = configuredBinary(ffmpegValue);
  const ffprobeBinary = configuredBinary(ffprobeValue);
  if (ffmpegBinary === null && ffprobeBinary === null) return null;

  const ffmpeg = ffmpegBinary ?? (ffprobeBinary === null ? null : siblingBinary(ffprobeBinary, 'ffmpeg')) ?? 'ffmpeg';
  const ffprobe = ffprobeBinary ?? siblingBinary(ffmpeg, 'ffprobe') ?? 'ffprobe';
  return { ffmpeg, ffprobe };
};

const isExecutableFile = (candidate: string): boolean => {
  try {
    if (!statSync(candidate).isFile()) return false;
    accessSync(candidate, constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

const bundledPair = (runtime: StudioFfmpegBinaryRuntime): StudioFfmpegBinaries | null => {
  const resourcesPath =
    runtime.resourcesPath === undefined
      ? (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
      : runtime.resourcesPath;
  if (!resourcesPath) return null;

  const platform = runtime.platform ?? process.platform;
  const arch = runtime.arch ?? process.arch;
  const flavor = platform === 'win32' ? path.win32 : path.posix;
  const extension = platform === 'win32' ? '.exe' : '';
  const runtimeDirectory = flavor.join(resourcesPath, 'bundled-ffmpeg', `${platform}-${arch}`);
  const ffmpeg = flavor.join(runtimeDirectory, `ffmpeg${extension}`);
  const ffprobe = flavor.join(runtimeDirectory, `ffprobe${extension}`);
  const executableFile = runtime.isExecutableFile ?? isExecutableFile;

  try {
    return executableFile(ffmpeg) && executableFile(ffprobe) ? { ffmpeg, ffprobe } : null;
  } catch {
    return null;
  }
};

/** Resolves the one coherent ffmpeg/ffprobe pair used by Creative Studio media operations. */
export const resolveStudioFfmpegBinaries = (
  overrides: StudioFfmpegBinaryOverrides = {},
  runtime: StudioFfmpegBinaryRuntime = {}
): StudioFfmpegBinaries => {
  const injectedPair = configuredPair(overrides.ffmpegBinary, overrides.ffprobeBinary);
  if (injectedPair !== null) return injectedPair;

  const environmentPair = configuredPair(process.env.FFMPEG_PATH, process.env.FFPROBE_PATH);
  if (environmentPair !== null) return environmentPair;

  return bundledPair(runtime) ?? { ffmpeg: 'ffmpeg', ffprobe: 'ffprobe' };
};
