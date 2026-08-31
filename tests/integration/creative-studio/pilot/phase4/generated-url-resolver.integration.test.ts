/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment node
 */

import { open, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { STUDIO_MAX_IMAGE_ASSET_BYTES_V3 } from '@/common/types/project/creativeStudioTypes';
import { createStudioPilotGeneratedUrlResolverV3 } from '@/process/services/creative-studio/service/pilot/runtime/generatedUrlResolver';
import type { RemoteMediaResponse } from '@/process/services/remote-media/remoteMediaDownloader';
import { afterEach, describe, expect, it, vi } from 'vitest';

const sandboxes: string[] = [];
const PUBLIC_ADDRESS = '8.8.8.8';

afterEach(async () => {
  await Promise.all(sandboxes.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const sandbox = async (): Promise<string> => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'studio-pilot-generated-url-'));
  sandboxes.push(root);
  return root;
};

const response = (
  chunks: AsyncIterable<Uint8Array> | readonly Uint8Array[],
  headers: Record<string, string> = {}
): RemoteMediaResponse => ({
  statusCode: 200,
  headers,
  remoteAddress: PUBLIC_ADDRESS,
  body: Symbol.asyncIterator in chunks ? chunks : Readable.from(chunks),
});

const publicLookup = async (): Promise<[{ address: string; family: 4 }]> => [{ address: PUBLIC_ADDRESS, family: 4 }];

describe('schema-6 Pilot generated URL resolver', () => {
  it('streams partial writes into one exclusive mode-0600 file and durably closes it', async () => {
    const root = await sandbox();
    const sync = vi.fn<() => Promise<void>>();
    const close = vi.fn<() => Promise<void>>();
    const openExclusive = vi.fn(async (filePath: string, flags: 'wx', mode: number) => {
      const handle = await open(filePath, flags, mode);
      sync.mockImplementation(() => handle.sync());
      close.mockImplementation(() => handle.close());
      return {
        write: (bytes: Uint8Array, offset: number, length: number, position: null) =>
          handle.write(bytes, offset, Math.min(length, 2), position),
        sync,
        close,
      };
    });
    const resolver = createStudioPilotGeneratedUrlResolverV3({
      temporaryDirectory: root,
      lookup: publicLookup,
      request: async () => response([Buffer.from('abc'), Buffer.from('def')], { 'content-type': 'image/png' }),
      createTemporaryId: () => 'durable',
      fs: { open: openExclusive, rm: (filePath, options) => rm(filePath, options) },
    });

    const result = await resolver('https://media.example.test/output.png', undefined);

    expect(await readFile(result.path, 'utf8')).toBe('abcdef');
    expect((await stat(result.path)).mode & 0o777).toBe(0o600);
    expect(openExclusive).toHaveBeenCalledWith(result.path, 'wx', 0o600);
    expect(sync).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });

  it('returns idempotent cleanup that can be retried after a filesystem refusal', async () => {
    const root = await sandbox();
    let removalAttempts = 0;
    const resolver = createStudioPilotGeneratedUrlResolverV3({
      temporaryDirectory: root,
      lookup: publicLookup,
      request: async () => response([Buffer.from('png')]),
      createTemporaryId: () => 'cleanup',
      fs: {
        open: (filePath, flags, mode) => open(filePath, flags, mode),
        rm: async (filePath, options) => {
          removalAttempts += 1;
          if (removalAttempts === 1) throw new Error('busy');
          await rm(filePath, options);
        },
      },
    });
    const result = await resolver('https://media.example.test/output.png', undefined);

    await expect(result.cleanup()).rejects.toThrow('busy');
    await result.cleanup();
    await result.cleanup();

    expect(removalAttempts).toBe(2);
    await expect(stat(result.path)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('preserves the bounded downloader size refusal and removes its empty partial', async () => {
    const root = await sandbox();
    const resolver = createStudioPilotGeneratedUrlResolverV3({
      temporaryDirectory: root,
      lookup: publicLookup,
      request: async () =>
        response([], { 'content-length': String(STUDIO_MAX_IMAGE_ASSET_BYTES_V3 + 1), 'content-type': 'image/png' }),
      createTemporaryId: () => 'oversized',
    });

    await expect(resolver('https://media.example.test/output.png', undefined)).rejects.toMatchObject({
      code: 'remote_too_large',
    });
    expect(await readdir(root)).toEqual([]);
  });

  it('preserves SSRF and content-header validation without invoking an unsafe transport', async () => {
    const privateRoot = await sandbox();
    const malformedRoot = await sandbox();
    const request = vi.fn(async () => response([Buffer.from('private')]));
    const privateResolver = createStudioPilotGeneratedUrlResolverV3({
      temporaryDirectory: privateRoot,
      lookup: async () => [{ address: '127.0.0.1', family: 4 }],
      request,
      createTemporaryId: () => 'private',
    });
    const malformedResolver = createStudioPilotGeneratedUrlResolverV3({
      temporaryDirectory: malformedRoot,
      lookup: publicLookup,
      request: async () => response([Buffer.from('not-media')], { 'content-type': 'not a media type' }),
      createTemporaryId: () => 'malformed',
    });

    await expect(privateResolver('https://localhost/output.png', undefined)).rejects.toMatchObject({
      code: 'unsafe_remote_address',
    });
    await expect(malformedResolver('https://media.example.test/output.png', undefined)).rejects.toMatchObject({
      code: 'remote_download_failed',
    });
    expect(request).not.toHaveBeenCalled();
    expect(await readdir(privateRoot)).toEqual([]);
    expect(await readdir(malformedRoot)).toEqual([]);
  });

  it('closes and removes bytes when the transport or final fsync fails', async () => {
    const transportRoot = await sandbox();
    const syncRoot = await sandbox();
    const brokenBody = (async function* (): AsyncIterable<Uint8Array> {
      yield Buffer.from('partial');
      throw new Error('transport failed');
    })();
    const transportResolver = createStudioPilotGeneratedUrlResolverV3({
      temporaryDirectory: transportRoot,
      lookup: publicLookup,
      request: async () => response(brokenBody),
      createTemporaryId: () => 'transport',
    });
    const close = vi.fn<() => Promise<void>>();
    const syncResolver = createStudioPilotGeneratedUrlResolverV3({
      temporaryDirectory: syncRoot,
      lookup: publicLookup,
      request: async () => response([Buffer.from('complete')]),
      createTemporaryId: () => 'sync',
      fs: {
        open: async (filePath, flags, mode) => {
          const handle = await open(filePath, flags, mode);
          close.mockImplementation(() => handle.close());
          return {
            write: handle.write.bind(handle),
            sync: async () => {
              throw new Error('sync failed');
            },
            close,
          };
        },
        rm: (filePath, options) => rm(filePath, options),
      },
    });

    await expect(transportResolver('https://media.example.test/output.png', undefined)).rejects.toMatchObject({
      code: 'remote_download_failed',
    });
    await expect(syncResolver('https://media.example.test/output.png', undefined)).rejects.toMatchObject({
      code: 'remote_download_failed',
    });
    expect(close).toHaveBeenCalledOnce();
    expect(await readdir(transportRoot)).toEqual([]);
    expect(await readdir(syncRoot)).toEqual([]);
  });

  it('never overwrites or removes a colliding exclusive path', async () => {
    const root = await sandbox();
    const expectedPath = path.join(root, `.weprompt-studio-pilot-generated-${process.pid}-collision.part`);
    await writeFile(expectedPath, 'owned elsewhere', { flag: 'wx' });
    const request = vi.fn(async () => response([Buffer.from('replacement')]));
    const resolver = createStudioPilotGeneratedUrlResolverV3({
      temporaryDirectory: root,
      lookup: publicLookup,
      request,
      createTemporaryId: () => 'collision',
    });

    await expect(resolver('https://media.example.test/output.png', undefined)).rejects.toMatchObject({
      code: 'remote_download_failed',
    });
    expect(await readFile(expectedPath, 'utf8')).toBe('owned elsewhere');
    expect(request).not.toHaveBeenCalled();
  });

  it('rejects unsafe injected paths and identifiers before transport', async () => {
    const root = await sandbox();
    const request = vi.fn(async () => response([Buffer.from('unexpected')]));
    const relativeResolver = createStudioPilotGeneratedUrlResolverV3({
      temporaryDirectory: 'relative',
      lookup: publicLookup,
      request,
      createTemporaryId: () => 'safe',
    });
    const escapingResolver = createStudioPilotGeneratedUrlResolverV3({
      temporaryDirectory: root,
      lookup: publicLookup,
      request,
      createTemporaryId: () => '../escape',
    });
    const throwingResolver = createStudioPilotGeneratedUrlResolverV3({
      temporaryDirectory: root,
      lookup: publicLookup,
      request,
      createTemporaryId: () => {
        throw new Error('entropy unavailable');
      },
    });

    await expect(relativeResolver('https://media.example.test/output.png', undefined)).rejects.toMatchObject({
      code: 'remote_download_failed',
    });
    await expect(escapingResolver('https://media.example.test/output.png', undefined)).rejects.toMatchObject({
      code: 'remote_download_failed',
    });
    await expect(throwingResolver('https://media.example.test/output.png', undefined)).rejects.toMatchObject({
      code: 'remote_download_failed',
    });
    expect(request).not.toHaveBeenCalled();
  });

  it('uses production DNS and temporary-file defaults without weakening private-address refusal', async () => {
    const request = vi.fn(async () => response([Buffer.from('unexpected')]));
    const resolver = createStudioPilotGeneratedUrlResolverV3({ request });

    await expect(resolver('https://localhost/output.png', undefined)).rejects.toMatchObject({
      code: 'unsafe_remote_address',
    });
    expect(request).not.toHaveBeenCalled();
  });
});
