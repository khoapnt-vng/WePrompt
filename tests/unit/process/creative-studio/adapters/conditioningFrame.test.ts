/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { writeSync } from 'node:fs';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createStudioConditioningFrameExtractor,
  StudioConditioningFrameError,
  type StudioConditioningFrameExtractionInput,
  type StudioConditioningFrameFileExpectation,
  type StudioConditioningFrameSpawn,
} from '@process/services/creative-studio/adapters/conditioningFrame';

const temporaryDirectories: string[] = [];

const makeDirectory = async (): Promise<string> => {
  const directory = await mkdtemp(path.join(tmpdir(), 'studio-conditioning-frame-'));
  temporaryDirectories.push(directory);
  return directory;
};

const expectation = (bytes: string | Buffer): StudioConditioningFrameFileExpectation => {
  const value = Buffer.from(bytes);
  return { byteSize: value.length, sha256: createHash('sha256').update(value).digest('hex') };
};

const makeChild = (): ChildProcess => {
  const child = new EventEmitter() as ChildProcess;
  Object.assign(child, { kill: vi.fn(() => true) });
  return child;
};

const destinationFd = (options: Parameters<StudioConditioningFrameSpawn>[2]): number => {
  const stdio = options.stdio;
  if (!Array.isArray(stdio) || typeof stdio[4] !== 'number') throw new Error('missing destination fd');
  return stdio[4];
};

const successfulSpawn = (bytes = 'decoded-frame'): StudioConditioningFrameSpawn =>
  vi.fn((_command, _args, options) => {
    const child = makeChild();
    if (bytes.length > 0) writeSync(destinationFd(options), Buffer.from(bytes));
    queueMicrotask(() => child.emit('close', 0, null));
    return child;
  });

const baseInput = (
  directory: string,
  overrides: Partial<StudioConditioningFrameExtractionInput> = {}
): StudioConditioningFrameExtractionInput => ({
  sourcePath: path.join(directory, 'take.mp4'),
  sourceExpectation: expectation('video'),
  destinationPath: path.join(directory, 'conditioning.png'),
  endpointSeconds: 10,
  sourceDurationSeconds: 10,
  providerLastFramePath: path.join(directory, 'provider-last-frame.png'),
  providerLastFrameExpectation: expectation('provider-frame'),
  allowProviderLastFrame: true,
  ...overrides,
});

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('conditioning frame extraction', () => {
  it('adopts an allowed provider last frame only after proving the exact take and provider bytes', async () => {
    const directory = await makeDirectory();
    const input = baseInput(directory);
    await writeFile(input.sourcePath, 'video');
    await writeFile(input.providerLastFramePath!, 'provider-frame');
    const spawnProcess = vi.fn(() => {
      throw new Error('local decode must not run');
    });

    await expect(createStudioConditioningFrameExtractor({ spawnProcess })(input)).resolves.toEqual({
      source: 'provider_last_frame',
    });
    await expect(readFile(input.destinationPath, 'utf8')).resolves.toBe('provider-frame');
    expect(spawnProcess).not.toHaveBeenCalled();
  });

  it.each([
    ['missing', null],
    ['digest-mismatched', 'provider-framo'],
  ] as const)('falls back to local decode when the optional provider frame is %s', async (_label, bytes) => {
    const directory = await makeDirectory();
    const input = baseInput(directory);
    await writeFile(input.sourcePath, 'video');
    if (bytes !== null) await writeFile(input.providerLastFramePath!, bytes);
    const spawnProcess = successfulSpawn('local-fallback');

    await expect(createStudioConditioningFrameExtractor({ spawnProcess })(input)).resolves.toEqual({
      source: 'local_decode',
    });
    await expect(readFile(input.destinationPath, 'utf8')).resolves.toBe('local-fallback');
    expect(spawnProcess).toHaveBeenCalledOnce();
  });

  it('locally decodes the trim-aware endpoint through exact inherited file descriptors', async () => {
    const directory = await makeDirectory();
    const input = baseInput(directory, { endpointSeconds: 8, allowProviderLastFrame: false });
    await writeFile(input.sourcePath, 'video');
    await writeFile(input.providerLastFramePath!, 'provider-frame');
    const spawnProcess = successfulSpawn('eight-second-frame');

    await expect(
      createStudioConditioningFrameExtractor({ spawnProcess, ffmpegBinary: 'test-ffmpeg' })(input)
    ).resolves.toEqual({ source: 'local_decode' });
    await expect(readFile(input.destinationPath, 'utf8')).resolves.toBe('eight-second-frame');
    const [binary, args, options] = vi.mocked(spawnProcess).mock.calls[0]!;
    expect(binary).toBe('test-ffmpeg');
    expect(args).toEqual([
      '-hide_banner',
      '-loglevel',
      'error',
      '-nostdin',
      '-i',
      'pipe:3',
      '-map',
      '0:v:0',
      '-vf',
      'trim=end=8,reverse',
      '-frames:v',
      '1',
      '-an',
      '-c:v',
      'png',
      '-f',
      'image2pipe',
      'pipe:4',
    ]);
    expect(options.windowsHide).toBe(true);
    expect(options.stdio).toEqual(['ignore', 'ignore', 'ignore', expect.any(Number), expect.any(Number)]);
  });

  it('locally decodes the final available frame at an untrimmed endpoint when adoption is not authorized', async () => {
    const directory = await makeDirectory();
    const input = baseInput(directory, { allowProviderLastFrame: false });
    await writeFile(input.sourcePath, 'video');
    await writeFile(input.providerLastFramePath!, 'provider-frame');
    const spawnProcess = successfulSpawn();

    await expect(createStudioConditioningFrameExtractor({ spawnProcess })(input)).resolves.toEqual({
      source: 'local_decode',
    });
    expect(vi.mocked(spawnProcess).mock.calls[0]![1]).toContain('trim=end=10,reverse');
  });

  it.each([
    { endpointSeconds: 0 },
    { endpointSeconds: Number.NaN },
    { endpointSeconds: 11 },
    { sourceDurationSeconds: 0 },
    { sourceDurationSeconds: Number.POSITIVE_INFINITY },
    { endpointSeconds: 8, allowProviderLastFrame: true },
    { sourceExpectation: { byteSize: 5, sha256: 'not-a-digest' } },
    { providerLastFramePath: null, providerLastFrameExpectation: expectation('provider-frame') },
    { providerLastFrameExpectation: null },
  ])('rejects invalid extraction authority before filesystem or ffmpeg work: %j', async (overrides) => {
    const directory = await makeDirectory();
    const lstat = vi.fn();
    const spawnProcess = vi.fn();
    const input = baseInput(directory, overrides);

    await expect(createStudioConditioningFrameExtractor({ lstat, spawnProcess })(input)).rejects.toThrow(
      'invalid_conditioning_frame_input'
    );
    expect(lstat).not.toHaveBeenCalled();
    expect(spawnProcess).not.toHaveBeenCalled();
  });

  it('maps a missing, replaced, or non-regular take to source_missing without spawning ffmpeg', async () => {
    const directory = await makeDirectory();
    const missing = baseInput(directory, {
      providerLastFramePath: null,
      providerLastFrameExpectation: null,
      allowProviderLastFrame: false,
    });
    const spawnProcess = vi.fn();

    await expect(createStudioConditioningFrameExtractor({ spawnProcess })(missing)).rejects.toMatchObject({
      code: 'source_missing',
    });
    await writeFile(missing.sourcePath, 'videz');
    await expect(createStudioConditioningFrameExtractor({ spawnProcess })(missing)).rejects.toMatchObject({
      code: 'source_missing',
    });
    expect(spawnProcess).not.toHaveBeenCalled();
  });

  it('rejects a symlinked take and locally decodes instead of following an optional provider symlink', async () => {
    const directory = await makeDirectory();
    const outside = path.join(directory, 'outside');
    await writeFile(outside, 'video');

    const takeInput = baseInput(directory, {
      providerLastFramePath: null,
      providerLastFrameExpectation: null,
      allowProviderLastFrame: false,
    });
    await symlink(outside, takeInput.sourcePath);
    await expect(createStudioConditioningFrameExtractor()(takeInput)).rejects.toMatchObject({ code: 'source_missing' });

    await rm(takeInput.sourcePath);
    const providerInput = baseInput(directory);
    await writeFile(providerInput.sourcePath, 'video');
    await symlink(outside, providerInput.providerLastFramePath!);
    const spawnProcess = successfulSpawn('local-without-symlink');
    await expect(createStudioConditioningFrameExtractor({ spawnProcess })(providerInput)).resolves.toEqual({
      source: 'local_decode',
    });
    await expect(readFile(providerInput.destinationPath, 'utf8')).resolves.toBe('local-without-symlink');
  });

  it('refuses a pre-existing destination and preserves its bytes', async () => {
    const directory = await makeDirectory();
    const input = baseInput(directory, {
      providerLastFramePath: null,
      providerLastFrameExpectation: null,
      allowProviderLastFrame: false,
    });
    await writeFile(input.sourcePath, 'video');
    await writeFile(input.destinationPath, 'existing');
    const spawnProcess = successfulSpawn();

    await expect(createStudioConditioningFrameExtractor({ spawnProcess })(input)).rejects.toMatchObject({
      code: 'storage_error',
    });
    await expect(readFile(input.destinationPath, 'utf8')).resolves.toBe('existing');
    expect(spawnProcess).not.toHaveBeenCalled();
  });

  it('maps a failed local decode to decode_failed and removes its exact partial destination', async () => {
    const directory = await makeDirectory();
    const input = baseInput(directory, {
      providerLastFramePath: null,
      providerLastFrameExpectation: null,
      allowProviderLastFrame: false,
    });
    await writeFile(input.sourcePath, 'video');
    const spawnProcess: StudioConditioningFrameSpawn = vi.fn((_command, _args, options) => {
      const child = makeChild();
      writeSync(destinationFd(options), Buffer.from('partial'));
      queueMicrotask(() => child.emit('close', 1, null));
      return child;
    });

    await expect(createStudioConditioningFrameExtractor({ spawnProcess })(input)).rejects.toEqual(
      new StudioConditioningFrameError('decode_failed')
    );
    await expect(readFile(input.destinationPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects and removes an empty local-decode output as storage_error', async () => {
    const directory = await makeDirectory();
    const input = baseInput(directory, {
      providerLastFramePath: null,
      providerLastFrameExpectation: null,
      allowProviderLastFrame: false,
    });
    await writeFile(input.sourcePath, 'video');

    await expect(
      createStudioConditioningFrameExtractor({ spawnProcess: successfulSpawn('') })(input)
    ).rejects.toMatchObject({ code: 'storage_error' });
    await expect(readFile(input.destinationPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('replaces a partial provider copy with a local decode when the verified poster changes', async () => {
    const directory = await makeDirectory();
    const input = baseInput(directory);
    await writeFile(input.sourcePath, 'video');
    await writeFile(input.providerLastFramePath!, 'provider-frame');
    const realOpen = (await import('node:fs/promises')).open;
    let opens = 0;
    const openFile = vi.fn(async (...args: Parameters<typeof realOpen>) => {
      opens += 1;
      const handle = await realOpen(...args);
      if (opens === 3) await writeFile(input.providerLastFramePath!, 'changed-frame!');
      return handle;
    }) as unknown as typeof realOpen;

    const spawnProcess = successfulSpawn('local-after-race');
    await expect(createStudioConditioningFrameExtractor({ open: openFile, spawnProcess })(input)).resolves.toEqual({
      source: 'local_decode',
    });
    await expect(readFile(input.destinationPath, 'utf8')).resolves.toBe('local-after-race');
    expect(spawnProcess).toHaveBeenCalledOnce();
  });
});
