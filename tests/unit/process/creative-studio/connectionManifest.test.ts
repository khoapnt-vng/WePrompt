import { promises as nodeFs } from 'node:fs';
import { mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import type { StudioConnectionBinding } from '@/common/types/project/creativeStudioTypes';
import { durableDirectoryOpenFlags } from '@process/services/creative-studio/service/durableDirectory';
import type { RecordIoFileSystem } from '@process/services/creative-studio/service/recordIo';
import { createStudioConnectionManifestV1 } from '@process/services/creative-studio/store/connectionManifest';

const roots: string[] = [];

const createRoot = async (): Promise<string> => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'weprompt-connections-v1-'));
  roots.push(root);
  return root;
};

const imageBinding = (id = 'image_binding'): StudioConnectionBinding => ({
  schemaVersion: 1,
  id,
  providerId: 'provider_image',
  adapterId: 'weprompt-image-v1',
  model: 'gpt-image-1',
  capabilities: {
    mediaKinds: ['image'],
    supportsFirstFrame: false,
    maxConditioningImages: 0,
    cancellationPolicy: 'none',
  },
  validatedAt: '2026-09-01T00:00:00.000Z',
});

const videoBinding = (): StudioConnectionBinding => ({
  schemaVersion: 1,
  id: 'video_binding',
  providerId: 'provider_video',
  adapterId: 'byteplus-seedance-v1',
  model: 'seedance-1-0-pro-250528',
  capabilities: {
    mediaKinds: ['video'],
    audioModes: ['none'],
    aspectRatios: ['16:9'],
    resolutions: ['720p'],
    minDurationSeconds: 2,
    maxDurationSeconds: 12,
    supportsFirstFrame: true,
    maxConditioningImages: 0,
    cancellationPolicy: 'queued_only',
  },
  validatedAt: '2026-09-01T00:00:00.000Z',
});

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('schema-independent Studio connection manifest', () => {
  it('atomically upserts and removes image rows without touching retained video rows', async () => {
    const root = await createRoot();
    const manifest = createStudioConnectionManifestV1({ rootDir: root });

    await manifest.saveConnection(videoBinding());
    await manifest.saveConnection(imageBinding('image_old'));
    const replacement = await manifest.saveConnection({
      ...imageBinding('image_new'),
      validatedAt: '2026-09-01T00:01:00.000Z',
    });

    await expect(manifest.listConnections()).resolves.toEqual([replacement, videoBinding()]);
    await expect(manifest.removeConnection('image_new')).resolves.toBe(true);
    await expect(manifest.removeConnection('image_new')).resolves.toBe(false);
    await expect(manifest.listConnections()).resolves.toEqual([videoBinding()]);
    expect((await readdir(root)).filter((entry) => entry.endsWith('.tmp'))).toEqual([]);
  });

  it('treats a missing manifest as empty without inspecting project children', async () => {
    const root = await createRoot();
    await writeFile(path.join(root, 'legacy_project_poison'), '{ definitely not a project');
    const manifest = createStudioConnectionManifestV1({ rootDir: root });

    await expect(manifest.listConnections()).resolves.toEqual([]);
  });

  it.each([
    ['malformed', JSON.stringify({ schemaVersion: 1, connections: [{ secret: 'must-not-load' }] })],
    ['oversized', ' '.repeat(1024 * 1024 + 1)],
  ])('fails closed for a %s manifest', async (_case, bytes) => {
    const root = await createRoot();
    await writeFile(path.join(root, 'connections.json'), bytes);
    const manifest = createStudioConnectionManifestV1({ rootDir: root });

    await expect(manifest.listConnections()).rejects.toMatchObject({ code: 'storage_error' });
  });

  it('refuses a symlink manifest and leaves its target unchanged', async () => {
    const root = await createRoot();
    const target = path.join(root, 'outside.json');
    const original = JSON.stringify({ schemaVersion: 1, connections: [] });
    await writeFile(target, original);
    await symlink(target, path.join(root, 'connections.json'));
    const manifest = createStudioConnectionManifestV1({ rootDir: root });

    await expect(manifest.saveConnection(imageBinding())).rejects.toMatchObject({ code: 'storage_error' });
    await expect(readFile(target, 'utf8')).resolves.toBe(original);
  });

  it('fails closed when the storage parent is replaced after manifest publication', async () => {
    const root = await createRoot();
    const canonicalRoot = await nodeFs.realpath(root);
    const detached = `${canonicalRoot}-detached`;
    roots.push(detached);
    const manifestPath = path.join(canonicalRoot, 'connections.json');
    let swapped = false;
    const fs: RecordIoFileSystem = {
      ...nodeFs,
      rename: async (source, destination) => {
        await nodeFs.rename(source, destination);
        if (!swapped && path.resolve(destination.toString()) === manifestPath) {
          swapped = true;
          await nodeFs.rename(canonicalRoot, detached);
          await nodeFs.mkdir(canonicalRoot);
        }
      },
    };
    const manifest = createStudioConnectionManifestV1({ rootDir: root, fs });

    await expect(manifest.saveConnection(imageBinding())).rejects.toMatchObject({ code: 'storage_error' });
    await expect(readdir(root)).resolves.not.toContain('connections.json');
    await expect(readFile(path.join(detached, 'connections.json'), 'utf8')).resolves.toContain('image_binding');
  });

  it('fails closed when the storage parent is replaced during its durability sync', async () => {
    const root = await createRoot();
    const canonicalRoot = await nodeFs.realpath(root);
    const detached = `${canonicalRoot}-sync-detached`;
    roots.push(detached);
    let swapped = false;
    const fs: RecordIoFileSystem = {
      ...nodeFs,
      open: async (...args) => {
        const handle = await nodeFs.open(...args);
        if (path.resolve(args[0].toString()) !== canonicalRoot || args[1] !== durableDirectoryOpenFlags()) {
          return handle;
        }
        return new Proxy(handle, {
          get(target, property) {
            if (property === 'sync') {
              return async () => {
                await target.sync();
                if (!swapped) {
                  swapped = true;
                  await nodeFs.rename(canonicalRoot, detached);
                  await nodeFs.mkdir(canonicalRoot);
                }
              };
            }
            const value = Reflect.get(target, property, target) as unknown;
            return typeof value === 'function' ? value.bind(target) : value;
          },
        }) as Awaited<ReturnType<RecordIoFileSystem['open']>>;
      },
    };
    const manifest = createStudioConnectionManifestV1({ rootDir: root, fs });

    await expect(manifest.saveConnection(imageBinding())).rejects.toMatchObject({ code: 'storage_error' });
    await expect(readdir(root)).resolves.not.toContain('connections.json');
    await expect(readFile(path.join(detached, 'connections.json'), 'utf8')).resolves.toContain('image_binding');
  });

  it('rejects unknown credential-shaped fields before persistence', async () => {
    const root = await createRoot();
    const manifest = createStudioConnectionManifestV1({ rootDir: root });

    await expect(
      manifest.saveConnection({ ...imageBinding(), apiKey: 'must-not-persist' } as never)
    ).rejects.toMatchObject({ code: 'invalid_payload' });
    await expect(manifest.listConnections()).resolves.toEqual([]);
  });
});
