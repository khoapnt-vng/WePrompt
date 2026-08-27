/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment node
 */

import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveStudioFfmpegBinaries } from '@/process/services/creative-studio/ffmpegBinaries';

describe('Creative Studio ffmpeg binary resolution', () => {
  beforeEach(() => {
    vi.stubEnv('FFMPEG_PATH', '');
    vi.stubEnv('FFPROBE_PATH', '');
  });

  afterEach(() => vi.unstubAllEnvs());

  it('uses and trims an explicit coherent pair', () => {
    expect(resolveStudioFfmpegBinaries({ ffmpegBinary: ' /tools/video ', ffprobeBinary: ' /tools/probe ' })).toEqual({
      ffmpeg: '/tools/video',
      ffprobe: '/tools/probe',
    });
  });

  it('derives ffprobe beside an absolute ffmpeg environment override', () => {
    vi.stubEnv('FFMPEG_PATH', path.join('/bundle', 'ffmpeg'));
    expect(resolveStudioFfmpegBinaries()).toEqual({
      ffmpeg: path.join('/bundle', 'ffmpeg'),
      ffprobe: path.join('/bundle', 'ffprobe'),
    });
  });

  it('derives an executable-suffixed ffmpeg beside an explicit ffprobe', () => {
    expect(resolveStudioFfmpegBinaries({ ffprobeBinary: path.join('/bundle', 'ffprobe.exe') })).toEqual({
      ffmpeg: path.join('/bundle', 'ffmpeg.exe'),
      ffprobe: path.join('/bundle', 'ffprobe.exe'),
    });
  });

  it('canonicalizes path-like relative overrides before a render changes its working directory', () => {
    expect(resolveStudioFfmpegBinaries({ ffmpegBinary: 'tools/ffmpeg' })).toEqual({
      ffmpeg: path.resolve('tools/ffmpeg'),
      ffprobe: path.resolve('tools/ffprobe'),
    });
  });

  it('uses PATH command names when neither member has an absolute override', () => {
    expect(resolveStudioFfmpegBinaries()).toEqual({ ffmpeg: 'ffmpeg', ffprobe: 'ffprobe' });
    expect(resolveStudioFfmpegBinaries({ ffmpegBinary: 'custom-ffmpeg' })).toEqual({
      ffmpeg: 'custom-ffmpeg',
      ffprobe: 'ffprobe',
    });
  });
});
