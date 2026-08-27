/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import path from 'node:path';

export type StudioFfmpegBinaryOverrides = {
  ffmpegBinary?: string;
  ffprobeBinary?: string;
};

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

/** Resolves the one coherent ffmpeg/ffprobe pair used by Creative Studio media operations. */
export const resolveStudioFfmpegBinaries = (
  overrides: StudioFfmpegBinaryOverrides = {}
): { ffmpeg: string; ffprobe: string } => {
  const explicitFfmpeg = configuredBinary(overrides.ffmpegBinary) ?? configuredBinary(process.env.FFMPEG_PATH);
  const explicitFfprobe = configuredBinary(overrides.ffprobeBinary) ?? configuredBinary(process.env.FFPROBE_PATH);
  const ffmpeg =
    explicitFfmpeg ?? (explicitFfprobe === null ? null : siblingBinary(explicitFfprobe, 'ffmpeg')) ?? 'ffmpeg';
  const ffprobe = explicitFfprobe ?? siblingBinary(ffmpeg, 'ffprobe') ?? 'ffprobe';
  return { ffmpeg, ffprobe };
};
