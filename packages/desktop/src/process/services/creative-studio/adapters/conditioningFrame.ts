/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { type ChildProcess, spawn, type SpawnOptions } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, rm, type FileHandle } from 'node:fs/promises';

export type StudioConditioningFrameFileExpectation = {
  byteSize: number;
  sha256: string;
};

export type StudioConditioningFrameExtractionInput = {
  sourcePath: string;
  sourceExpectation: StudioConditioningFrameFileExpectation;
  destinationPath: string;
  endpointSeconds: number;
  sourceDurationSeconds: number;
  providerLastFramePath: string | null;
  providerLastFrameExpectation: StudioConditioningFrameFileExpectation | null;
  allowProviderLastFrame: boolean;
};

export type StudioConditioningFrameExtractionResult = {
  source: 'provider_last_frame' | 'local_decode';
};

export type StudioConditioningFrameFailureCode = 'decode_failed' | 'source_missing' | 'storage_error';

export class StudioConditioningFrameError extends Error {
  readonly code: StudioConditioningFrameFailureCode;

  constructor(code: StudioConditioningFrameFailureCode) {
    super(code);
    this.name = 'StudioConditioningFrameError';
    this.code = code;
  }
}

export type StudioConditioningFrameSpawn = (command: string, args: string[], options: SpawnOptions) => ChildProcess;

export type StudioConditioningFrameDeps = {
  lstat?: typeof lstat;
  open?: typeof open;
  rm?: typeof rm;
  spawnProcess?: StudioConditioningFrameSpawn;
  ffmpegBinary?: string;
};

type FileIdentity = { dev: string; ino: string };
type OpenedFile = { handle: FileHandle; identity: FileIdentity };

const SHA256 = /^[a-f0-9]{64}$/;
const BUFFER_BYTES = 64 * 1024;
const noFollowFlag = typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0;

const identityOf = (stats: { dev: number | bigint; ino: number | bigint }): FileIdentity => ({
  dev: String(stats.dev),
  ino: String(stats.ino),
});

const sameIdentity = (left: FileIdentity, right: FileIdentity): boolean =>
  left.dev === right.dev && left.ino === right.ino;

const pathMissing = (error: unknown): boolean => {
  const code = (error as NodeJS.ErrnoException).code;
  return code === 'ENOENT' || code === 'ENOTDIR' || code === 'ELOOP';
};

const validExpectation = (value: StudioConditioningFrameFileExpectation | null): boolean =>
  value !== null && Number.isSafeInteger(value.byteSize) && value.byteSize > 0 && SHA256.test(value.sha256);

const invalidExtractionInput = (input: StudioConditioningFrameExtractionInput): boolean =>
  typeof input.sourcePath !== 'string' ||
  input.sourcePath.length === 0 ||
  !validExpectation(input.sourceExpectation) ||
  typeof input.destinationPath !== 'string' ||
  input.destinationPath.length === 0 ||
  input.sourcePath === input.destinationPath ||
  !Number.isFinite(input.endpointSeconds) ||
  input.endpointSeconds <= 0 ||
  !Number.isFinite(input.sourceDurationSeconds) ||
  input.sourceDurationSeconds <= 0 ||
  input.endpointSeconds > input.sourceDurationSeconds ||
  (input.providerLastFramePath !== null &&
    (typeof input.providerLastFramePath !== 'string' ||
      input.providerLastFramePath.length === 0 ||
      input.providerLastFramePath === input.sourcePath ||
      input.providerLastFramePath === input.destinationPath)) ||
  (input.allowProviderLastFrame && input.endpointSeconds !== input.sourceDurationSeconds) ||
  (input.allowProviderLastFrame &&
    input.providerLastFramePath !== null &&
    !validExpectation(input.providerLastFrameExpectation)) ||
  (input.providerLastFramePath === null && input.providerLastFrameExpectation !== null);

const closeQuietly = async (handle: FileHandle | null): Promise<void> => {
  if (handle === null) return;
  await handle.close().catch((): undefined => undefined);
};

const hashOpenedFile = async (
  opened: OpenedFile,
  expectation: StudioConditioningFrameFileExpectation
): Promise<void> => {
  const before = await opened.handle.stat();
  if (!before.isFile() || !sameIdentity(identityOf(before), opened.identity) || before.size !== expectation.byteSize) {
    throw new StudioConditioningFrameError('source_missing');
  }
  const hash = createHash('sha256');
  const buffer = Buffer.allocUnsafe(BUFFER_BYTES);
  let position = 0;
  while (position < expectation.byteSize) {
    // eslint-disable-next-line no-await-in-loop -- Ordered reads keep one bounded buffer and one exact digest.
    const { bytesRead } = await opened.handle.read(
      buffer,
      0,
      Math.min(buffer.length, expectation.byteSize - position),
      position
    );
    if (bytesRead === 0) throw new StudioConditioningFrameError('source_missing');
    hash.update(buffer.subarray(0, bytesRead));
    position += bytesRead;
  }
  const after = await opened.handle.stat();
  if (
    !sameIdentity(identityOf(after), opened.identity) ||
    after.size !== expectation.byteSize ||
    hash.digest('hex') !== expectation.sha256
  ) {
    throw new StudioConditioningFrameError('source_missing');
  }
};

const openVerifiedSource = async (
  filePath: string,
  expectation: StudioConditioningFrameFileExpectation,
  statPath: typeof lstat,
  openFile: typeof open
): Promise<OpenedFile> => {
  let handle: FileHandle | null = null;
  try {
    const pathStats = await statPath(filePath);
    if (pathStats.isSymbolicLink() || !pathStats.isFile() || pathStats.size !== expectation.byteSize) {
      throw new StudioConditioningFrameError('source_missing');
    }
    const pathIdentity = identityOf(pathStats);
    handle = await openFile(filePath, constants.O_RDONLY | noFollowFlag);
    const openedStats = await handle.stat();
    if (!openedStats.isFile() || !sameIdentity(identityOf(openedStats), pathIdentity)) {
      throw new StudioConditioningFrameError('source_missing');
    }
    const opened = { handle, identity: pathIdentity };
    await hashOpenedFile(opened, expectation);
    return opened;
  } catch (error) {
    await closeQuietly(handle);
    if (error instanceof StudioConditioningFrameError) throw error;
    throw new StudioConditioningFrameError(pathMissing(error) ? 'source_missing' : 'storage_error');
  }
};

const openExclusiveDestination = async (filePath: string, openFile: typeof open): Promise<OpenedFile> => {
  let handle: FileHandle | null = null;
  try {
    handle = await openFile(filePath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollowFlag, 0o600);
    const stats = await handle.stat();
    if (!stats.isFile()) throw new StudioConditioningFrameError('storage_error');
    return { handle, identity: identityOf(stats) };
  } catch (error) {
    await closeQuietly(handle);
    if (error instanceof StudioConditioningFrameError) throw error;
    throw new StudioConditioningFrameError('storage_error');
  }
};

const removeOwnedDestination = async (
  filePath: string,
  identity: FileIdentity,
  statPath: typeof lstat,
  remove: typeof rm
): Promise<void> => {
  try {
    const current = await statPath(filePath);
    if (current.isSymbolicLink() || !current.isFile() || !sameIdentity(identityOf(current), identity)) return;
    await remove(filePath, { force: true });
  } catch (error) {
    if (!pathMissing(error)) throw new StudioConditioningFrameError('storage_error');
  }
};

const copyVerifiedProviderFrame = async (
  source: OpenedFile,
  destination: OpenedFile,
  expectation: StudioConditioningFrameFileExpectation
): Promise<void> => {
  const hash = createHash('sha256');
  const buffer = Buffer.allocUnsafe(BUFFER_BYTES);
  let position = 0;
  while (position < expectation.byteSize) {
    // eslint-disable-next-line no-await-in-loop -- The copy and digest must observe the same ordered bytes.
    const { bytesRead } = await source.handle.read(
      buffer,
      0,
      Math.min(buffer.length, expectation.byteSize - position),
      position
    );
    if (bytesRead === 0) throw new StudioConditioningFrameError('source_missing');
    const bytes = buffer.subarray(0, bytesRead);
    hash.update(bytes);
    let written = 0;
    while (written < bytes.length) {
      // eslint-disable-next-line no-await-in-loop -- Partial writes advance one exclusive destination deterministically.
      const result = await destination.handle.write(bytes, written, bytes.length - written, position + written);
      if (result.bytesWritten === 0) throw new StudioConditioningFrameError('storage_error');
      written += result.bytesWritten;
    }
    position += bytesRead;
  }
  await destination.handle.sync();
  const destinationStats = await destination.handle.stat();
  if (
    !sameIdentity(identityOf(destinationStats), destination.identity) ||
    destinationStats.size !== expectation.byteSize
  ) {
    throw new StudioConditioningFrameError('storage_error');
  }
  if (hash.digest('hex') !== expectation.sha256) throw new StudioConditioningFrameError('source_missing');
  await hashOpenedFile(source, expectation);
};

const runLocalDecode = (
  binary: string,
  input: StudioConditioningFrameExtractionInput,
  source: OpenedFile,
  destination: OpenedFile,
  spawnProcess: StudioConditioningFrameSpawn
): Promise<void> =>
  new Promise((resolve, reject) => {
    let child: ChildProcess;
    try {
      child = spawnProcess(
        binary,
        [
          '-hide_banner',
          '-loglevel',
          'error',
          '-nostdin',
          '-i',
          'pipe:3',
          '-map',
          '0:v:0',
          '-vf',
          `trim=end=${String(input.endpointSeconds)},reverse`,
          '-frames:v',
          '1',
          '-an',
          '-c:v',
          'png',
          '-f',
          'image2pipe',
          'pipe:4',
        ],
        { windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', source.handle.fd, destination.handle.fd] }
      );
    } catch {
      reject(new StudioConditioningFrameError('decode_failed'));
      return;
    }

    let settled = false;
    const finish = (work: () => void): void => {
      if (settled) return;
      settled = true;
      work();
    };
    child.once('error', () => finish(() => reject(new StudioConditioningFrameError('decode_failed'))));
    child.once('close', (code, signal) =>
      finish(() => {
        if (code === 0 && signal === null) resolve();
        else reject(new StudioConditioningFrameError('decode_failed'));
      })
    );
  });

export const createStudioConditioningFrameExtractor = (
  deps: StudioConditioningFrameDeps = {}
): ((input: StudioConditioningFrameExtractionInput) => Promise<StudioConditioningFrameExtractionResult>) => {
  const statPath = deps.lstat ?? lstat;
  const openFile = deps.open ?? open;
  const remove = deps.rm ?? rm;
  const spawnProcess = deps.spawnProcess ?? ((command, args, options) => spawn(command, args, options));
  const binary = deps.ffmpegBinary?.trim() || 'ffmpeg';

  return async (input) => {
    if (invalidExtractionInput(input)) throw new TypeError('invalid_conditioning_frame_input');

    const useProviderFrame = input.allowProviderLastFrame && input.providerLastFramePath !== null;
    const source = await openVerifiedSource(input.sourcePath, input.sourceExpectation, statPath, openFile);
    let providerSource: OpenedFile | null = null;
    let destination: OpenedFile | null = null;
    let result: StudioConditioningFrameExtractionResult | null = null;
    let failure: unknown = null;
    const decodeLocally = async (): Promise<void> => {
      await runLocalDecode(binary, input, source, destination!, spawnProcess);
      await destination!.handle.sync();
      const destinationStats = await destination!.handle.stat();
      if (
        !sameIdentity(identityOf(destinationStats), destination!.identity) ||
        !destinationStats.isFile() ||
        destinationStats.size <= 0
      ) {
        throw new StudioConditioningFrameError('storage_error');
      }
      await hashOpenedFile(source, input.sourceExpectation);
      result = { source: 'local_decode' };
    };
    try {
      if (useProviderFrame) {
        try {
          providerSource = await openVerifiedSource(
            input.providerLastFramePath!,
            input.providerLastFrameExpectation!,
            statPath,
            openFile
          );
        } catch {
          // Provider posters are an optional optimization. The immutable primary Take remains the
          // authority and must still be locally decodable when a poster is missing or corrupt.
          providerSource = null;
        }
      }
      destination = await openExclusiveDestination(input.destinationPath, openFile);
      if (providerSource !== null) {
        try {
          await copyVerifiedProviderFrame(providerSource, destination, input.providerLastFrameExpectation!);
          await hashOpenedFile(source, input.sourceExpectation);
          result = { source: 'provider_last_frame' };
        } catch (error) {
          if (!(error instanceof StudioConditioningFrameError) || error.code !== 'source_missing') throw error;
          await destination.handle.close();
          await removeOwnedDestination(input.destinationPath, destination.identity, statPath, remove);
          destination = await openExclusiveDestination(input.destinationPath, openFile);
          await decodeLocally();
        }
      } else {
        await decodeLocally();
      }
    } catch (error) {
      failure = error;
    }

    try {
      await destination?.handle.close();
    } catch {
      failure = new StudioConditioningFrameError('storage_error');
    }
    await closeQuietly(providerSource?.handle ?? null);
    await closeQuietly(source.handle);

    if (failure !== null) {
      if (destination !== null)
        await removeOwnedDestination(input.destinationPath, destination.identity, statPath, remove);
      if (failure instanceof StudioConditioningFrameError) throw failure;
      throw new StudioConditioningFrameError('storage_error');
    }
    return result!;
  };
};

export const extractConditioningFrame = createStudioConditioningFrameExtractor();
