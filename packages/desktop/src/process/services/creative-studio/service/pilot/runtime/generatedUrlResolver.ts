/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomBytes } from 'node:crypto';
import { promises as dns } from 'node:dns';
import { promises as nodeFs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { STUDIO_MAX_IMAGE_ASSET_BYTES_V3 } from '@/common/types/project/creativeStudioTypes';
import {
  createNodeRemoteMediaRequest,
  downloadRemoteMedia,
  RemoteMediaError,
  type RemoteMediaDownloadDeps,
} from '@process/services/remote-media/remoteMediaDownloader';

const GENERATED_DOWNLOAD_PREFIX = '.weprompt-studio-pilot-generated-';
const GENERATED_DOWNLOAD_SUFFIX = '.part';
const TEMPORARY_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

type StudioPilotGeneratedUrlFileHandleV3 = {
  write(buffer: Uint8Array, offset: number, length: number, position: null): Promise<{ bytesWritten: number }>;
  sync(): Promise<void>;
  close(): Promise<void>;
};

type StudioPilotGeneratedUrlFileSystemV3 = {
  open(filePath: string, flags: 'wx', mode: number): Promise<StudioPilotGeneratedUrlFileHandleV3>;
  rm(filePath: string, options: { force: true }): Promise<void>;
};

export type StudioPilotGeneratedUrlResolutionV3 = {
  /** Main-only temporary path. The caller must invoke cleanup after copying it. */
  path: string;
  /** Idempotently removes the successful temporary download. */
  cleanup(): Promise<void>;
};

export type StudioPilotGeneratedUrlResolverV3 = (
  url: string,
  signal: AbortSignal | undefined
) => Promise<StudioPilotGeneratedUrlResolutionV3>;

export type StudioPilotGeneratedUrlResolverDepsV3 = {
  temporaryDirectory?: string;
  lookup?: RemoteMediaDownloadDeps['lookup'];
  request?: RemoteMediaDownloadDeps['request'];
  createTemporaryId?: () => string;
  /** Main-only file seam for deterministic durability and cleanup tests. */
  fs?: StudioPilotGeneratedUrlFileSystemV3;
};

const defaultFileSystem: StudioPilotGeneratedUrlFileSystemV3 = {
  open: (filePath, flags, mode) => nodeFs.open(filePath, flags, mode),
  rm: async (filePath, options) => {
    await nodeFs.rm(filePath, options);
  },
};

const remoteFailure = (): RemoteMediaError => new RemoteMediaError('remote_download_failed');

const defaultLookup: RemoteMediaDownloadDeps['lookup'] = async (hostname) => {
  const addresses = await dns.lookup(hostname, { all: true, verbatim: true });
  return addresses.flatMap((address) =>
    address.family === 4 || address.family === 6 ? [{ address: address.address, family: address.family }] : []
  );
};

const writeAll = async (handle: StudioPilotGeneratedUrlFileHandleV3, chunk: Buffer): Promise<void> => {
  let offset = 0;
  while (offset < chunk.length) {
    // eslint-disable-next-line no-await-in-loop -- one exclusive file handle owns this ordered byte stream.
    const result = await handle.write(chunk, offset, chunk.length - offset, null);
    if (!Number.isSafeInteger(result.bytesWritten) || result.bytesWritten < 1) throw remoteFailure();
    offset += result.bytesWritten;
  }
};

/**
 * Creates the Main-owned generated-URL resolver used by the schema-6 Pilot.
 * Network policy remains centralized in downloadRemoteMedia; this wrapper only
 * gives that bounded stream a durable, exclusively-created temporary file.
 */
export const createStudioPilotGeneratedUrlResolverV3 = (
  deps: StudioPilotGeneratedUrlResolverDepsV3 = {}
): StudioPilotGeneratedUrlResolverV3 => {
  const temporaryDirectory = deps.temporaryDirectory ?? os.tmpdir();
  const fs = deps.fs ?? defaultFileSystem;
  const lookup = deps.lookup ?? defaultLookup;
  const request = deps.request ?? createNodeRemoteMediaRequest(120_000);
  const createTemporaryId = deps.createTemporaryId ?? (() => randomBytes(18).toString('base64url'));

  return async (url, signal) => {
    if (!path.isAbsolute(temporaryDirectory) || temporaryDirectory.includes('\0')) throw remoteFailure();

    let temporaryId: string;
    try {
      temporaryId = createTemporaryId();
    } catch {
      throw remoteFailure();
    }
    if (!TEMPORARY_ID_PATTERN.test(temporaryId)) throw remoteFailure();

    const temporaryPath = path.join(
      temporaryDirectory,
      `${GENERATED_DOWNLOAD_PREFIX}${process.pid}-${temporaryId}${GENERATED_DOWNLOAD_SUFFIX}`
    );
    let handle: StudioPilotGeneratedUrlFileHandleV3;
    try {
      handle = await fs.open(temporaryPath, 'wx', 0o600);
    } catch {
      // The path may belong to another operation. Never remove a file this call did not create.
      throw remoteFailure();
    }

    let closed = false;
    try {
      await downloadRemoteMedia(url, {
        lookup,
        request,
        write: (chunk) => writeAll(handle, chunk),
        maxBytes: STUDIO_MAX_IMAGE_ASSET_BYTES_V3,
        signal,
      });
      await handle.sync();
      await handle.close();
      closed = true;

      let cleanupPromise: Promise<void> | null = null;
      return {
        path: temporaryPath,
        cleanup: () => {
          cleanupPromise ??= fs.rm(temporaryPath, { force: true }).catch((error: unknown) => {
            cleanupPromise = null;
            throw error;
          });
          return cleanupPromise;
        },
      };
    } catch (error) {
      if (!closed) await handle.close().catch((): undefined => undefined);
      await fs.rm(temporaryPath, { force: true }).catch((): undefined => undefined);
      if (error instanceof RemoteMediaError) throw error;
      throw remoteFailure();
    }
  };
};
