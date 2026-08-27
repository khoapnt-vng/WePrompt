/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment node
 */

import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveStudioFfmpegBinaries } from '@/process/services/creative-studio/ffmpegBinaries';

describe('Creative Studio ffmpeg binary resolution', () => {
  const temporaryRoots: string[] = [];

  beforeEach(() => {
    vi.stubEnv('FFMPEG_PATH', '');
    vi.stubEnv('FFPROBE_PATH', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  const createTemporaryResources = (): string => {
    const resourcesPath = mkdtempSync(path.join(tmpdir(), 'weprompt-ffmpeg-'));
    temporaryRoots.push(resourcesPath);
    return resourcesPath;
  };

  const expectedBundlePair = (
    resourcesPath: string,
    platform: NodeJS.Platform,
    arch: string
  ): { ffmpeg: string; ffprobe: string } => {
    const flavor = platform === 'win32' ? path.win32 : path.posix;
    const extension = platform === 'win32' ? '.exe' : '';
    const runtimeDirectory = flavor.join(resourcesPath, 'bundled-ffmpeg', `${platform}-${arch}`);
    return {
      ffmpeg: flavor.join(runtimeDirectory, `ffmpeg${extension}`),
      ffprobe: flavor.join(runtimeDirectory, `ffprobe${extension}`),
    };
  };

  it('uses and trims an explicit coherent pair', () => {
    expect(resolveStudioFfmpegBinaries({ ffmpegBinary: ' /tools/video ', ffprobeBinary: ' /tools/probe ' })).toEqual({
      ffmpeg: '/tools/video',
      ffprobe: '/tools/probe',
    });
  });

  it('keeps an injected member and its sibling independent from environment and bundle sources', () => {
    vi.stubEnv('FFMPEG_PATH', path.join('/environment', 'ffmpeg'));
    vi.stubEnv('FFPROBE_PATH', path.join('/environment', 'ffprobe'));
    const isExecutableFile = vi.fn(() => true);

    expect(
      resolveStudioFfmpegBinaries(
        { ffmpegBinary: path.join('/injected', 'ffmpeg') },
        { resourcesPath: '/application/resources', isExecutableFile }
      )
    ).toEqual({
      ffmpeg: path.join('/injected', 'ffmpeg'),
      ffprobe: path.join('/injected', 'ffprobe'),
    });
    expect(isExecutableFile).not.toHaveBeenCalled();
  });

  it('derives ffprobe beside an absolute ffmpeg environment override', () => {
    vi.stubEnv('FFMPEG_PATH', path.join('/bundle', 'ffmpeg'));
    const isExecutableFile = vi.fn(() => true);

    expect(resolveStudioFfmpegBinaries({}, { resourcesPath: '/application/resources', isExecutableFile })).toEqual({
      ffmpeg: path.join('/bundle', 'ffmpeg'),
      ffprobe: path.join('/bundle', 'ffprobe'),
    });
    expect(isExecutableFile).not.toHaveBeenCalled();
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

  it('uses a complete executable bundle pair for the current packaged target', () => {
    const resourcesPath = '/application/resources';
    const pair = expectedBundlePair(resourcesPath, 'darwin', 'arm64');
    const executableFiles = new Set([pair.ffmpeg, pair.ffprobe]);

    expect(
      resolveStudioFfmpegBinaries(
        {},
        {
          resourcesPath,
          platform: 'darwin',
          arch: 'arm64',
          isExecutableFile: (candidate) => executableFiles.has(candidate),
        }
      )
    ).toEqual(pair);
  });

  it('uses executable-suffixed bundle members on Windows', () => {
    const resourcesPath = 'C:\\Program Files\\WePrompt\\resources';
    const pair = expectedBundlePair(resourcesPath, 'win32', 'x64');

    expect(
      resolveStudioFfmpegBinaries(
        {},
        {
          resourcesPath,
          platform: 'win32',
          arch: 'x64',
          isExecutableFile: () => true,
        }
      )
    ).toEqual(pair);
  });

  it.each(['ffmpeg', 'ffprobe'] as const)('falls back to a PATH pair when bundled %s is unavailable', (missing) => {
    const resourcesPath = '/application/resources';
    const pair = expectedBundlePair(resourcesPath, 'linux', 'arm64');

    expect(
      resolveStudioFfmpegBinaries(
        {},
        {
          resourcesPath,
          platform: 'linux',
          arch: 'arm64',
          isExecutableFile: (candidate) => candidate !== pair[missing],
        }
      )
    ).toEqual({ ffmpeg: 'ffmpeg', ffprobe: 'ffprobe' });
  });

  it('accepts regular executable bundle members using the production file check', () => {
    const resourcesPath = createTemporaryResources();
    const pair = expectedBundlePair(resourcesPath, process.platform, process.arch);
    mkdirSync(path.dirname(pair.ffmpeg), { recursive: true });
    writeFileSync(pair.ffmpeg, 'ffmpeg');
    writeFileSync(pair.ffprobe, 'ffprobe');
    chmodSync(pair.ffmpeg, 0o755);
    chmodSync(pair.ffprobe, 0o755);

    expect(resolveStudioFfmpegBinaries({}, { resourcesPath })).toEqual(pair);
  });

  it('rejects a bundled member that is not a regular file', () => {
    const resourcesPath = createTemporaryResources();
    const pair = expectedBundlePair(resourcesPath, process.platform, process.arch);
    mkdirSync(path.dirname(pair.ffmpeg), { recursive: true });
    writeFileSync(pair.ffmpeg, 'ffmpeg');
    chmodSync(pair.ffmpeg, 0o755);
    mkdirSync(pair.ffprobe);

    expect(resolveStudioFfmpegBinaries({}, { resourcesPath })).toEqual({ ffmpeg: 'ffmpeg', ffprobe: 'ffprobe' });
  });

  it.skipIf(process.platform === 'win32')('rejects a bundled member that is not executable', () => {
    const resourcesPath = createTemporaryResources();
    const pair = expectedBundlePair(resourcesPath, process.platform, process.arch);
    mkdirSync(path.dirname(pair.ffmpeg), { recursive: true });
    writeFileSync(pair.ffmpeg, 'ffmpeg');
    writeFileSync(pair.ffprobe, 'ffprobe');
    chmodSync(pair.ffmpeg, 0o755);
    chmodSync(pair.ffprobe, 0o644);

    expect(resolveStudioFfmpegBinaries({}, { resourcesPath })).toEqual({ ffmpeg: 'ffmpeg', ffprobe: 'ffprobe' });
  });

  it('uses PATH command names when neither member has an absolute override', () => {
    expect(resolveStudioFfmpegBinaries({}, { resourcesPath: null })).toEqual({ ffmpeg: 'ffmpeg', ffprobe: 'ffprobe' });
    expect(resolveStudioFfmpegBinaries({ ffmpegBinary: 'custom-ffmpeg' })).toEqual({
      ffmpeg: 'custom-ffmpeg',
      ffprobe: 'ffprobe',
    });
  });
});
