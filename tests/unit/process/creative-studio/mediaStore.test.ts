/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment node
 */

import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isCanonicalStudioGeneratedTake } from '@/common/types/project/creativeStudioCanonicalTake';
import type { StudioBriefReferenceRole, StudioProject } from '@/common/types/project/creativeStudioTypes';
import { STUDIO_E2E_BOUNDARY_SENTINELS } from '@process/services/creative-studio/adapters/e2eFakeAdapter';
import {
  createCreativeStudioStore,
  CreativeStudioStoreError,
  type CreativeStudioStore,
} from '@process/services/creative-studio/store';
import * as mediaStoreModule from '@process/services/creative-studio/mediaStore';
import type { CreativeStudioMediaError } from '@process/services/creative-studio/mediaStore';
import {
  acquireStudioExportDirectory,
  createStudioMediaStore,
  openVerifiedReadStream,
  sanitizeStudioExportFolderName,
} from '@process/services/creative-studio/mediaStore';
import { isCanonicalStudioPosterAsset } from '@renderer/pages/studio/components/Preview/managedStudioAssets';

const { createHashSpy } = vi.hoisted(() => ({ createHashSpy: vi.fn() }));

vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  return {
    ...actual,
    createHash: (...args: Parameters<typeof actual.createHash>) => {
      createHashSpy(...args);
      return actual.createHash(...args);
    },
  };
});

const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489', 'hex');
const mp4 = Buffer.from('000000186674797069736f6d00000000', 'hex');
const webm = Buffer.from('1a45dfa300000000', 'hex');
const created: string[] = [];

const makeStore = async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-media-'));
  created.push(rootDir);
  const store = createCreativeStudioStore({ rootDir, createId: () => 'project_1' });
  await store.createProject({
    name: 'Film',
    brief: '',
    aspectRatio: '16:9',
    targetDurationSeconds: 5,
    resolution: '720p',
  });
  return { rootDir, store };
};

const addImageScene = async (store: CreativeStudioStore): Promise<void> => {
  await store.updateProject(
    'project_1',
    (project) => ({
      ...project,
      sceneOrder: ['scene_1'],
      scenes: {
        scene_1: {
          id: 'scene_1',
          title: 'Opening',
          purpose: '',
          visualPrompt: '',
          narration: '',
          onScreenText: '',
          mediaKind: 'image',
          durationSeconds: 5,
          referenceAssetId: null,
          selectedAssetId: null,
          assetIds: [],
          jobIds: [],
          reviewState: 'draft',
        },
      },
    }),
    1
  );
};

const addActiveImageJob = async (store: CreativeStudioStore): Promise<void> => {
  await addImageScene(store);
  await store.updateProject('project_1', (project) => {
    const next = structuredClone(project);
    next.jobs.job_1 = {
      id: 'job_1',
      projectId: project.id,
      sceneId: 'scene_1',
      status: 'running',
      provider: {
        providerId: 'provider_1',
        adapterId: 'weprompt-image-v1',
        model: 'image-model',
      },
      idempotencyKey: 'key_1',
      providerJobId: null,
      cancellationPolicy: 'none',
      outputAssetIds: [],
      error: null,
      retryOfJobId: null,
      retryReason: null,
      duplicateChargeAcknowledged: false,
      duplicateChargeAcknowledgedAt: null,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    };
    next.scenes.scene_1.jobIds.push('job_1');
    next.scenes.scene_1.reviewState = 'generating';
    return next;
  });
};

const addActiveVideoJob = async (store: CreativeStudioStore): Promise<void> => {
  await addActiveImageJob(store);
  await store.updateProject('project_1', (project) => {
    const next = structuredClone(project);
    next.scenes.scene_1.mediaKind = 'video';
    next.jobs.job_1.provider = {
      providerId: 'provider_1',
      adapterId: 'weprompt-media-gateway-v1',
      model: 'video-model',
    };
    return next;
  });
};

const addActiveReferenceJob = async (store: CreativeStudioStore, visualPrompt = ''): Promise<void> => {
  await addActiveVideoJob(store);
  await store.updateProject('project_1', (project) => {
    const next = structuredClone(project);
    next.scenes.scene_1.visualPrompt = visualPrompt;
    next.jobs.job_1.provider = {
      providerId: 'provider_1',
      adapterId: 'weprompt-image-v1',
      model: 'image-model',
    };
    next.jobs.job_1.outputRole = 'reference';
    return next;
  });
};

const addBriefReferences = async (
  store: CreativeStudioStore,
  count: number,
  role: StudioBriefReferenceRole = 'cast'
): Promise<StudioProject> =>
  store.updateProject('project_1', (project) => {
    const next = structuredClone(project);
    for (let index = 1; index <= count; index += 1) {
      const assetId = `brief_${index}`;
      next.assets[assetId] = {
        id: assetId,
        projectId: project.id,
        sceneId: null,
        mediaKind: 'image',
        mimeType: 'image/png',
        managedAsset: { collection: 'imports', fileName: `${assetId}.png` },
        byteSize: 1,
        sha256: String(index).repeat(64).slice(0, 64),
        briefReferenceRole: role,
        briefReferenceLabel: `Reference ${index}`,
        createdAt: `2026-08-15T00:00:0${index}.000Z`,
      };
    }
    return next;
  });

afterEach(async () => {
  await Promise.all(created.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe('createStudioMediaStore', () => {
  it('keeps the production reference, image, and video byte ceilings explicit', () => {
    expect(
      (
        mediaStoreModule as typeof mediaStoreModule & {
          STUDIO_MEDIA_LIMITS?: Record<string, number>;
        }
      ).STUDIO_MEDIA_LIMITS
    ).toMatchObject({
      referenceMaxBytes: 30 * 1024 * 1024,
      imageOutputMaxBytes: 50 * 1024 * 1024,
      videoOutputMaxBytes: 512 * 1024 * 1024,
      projectMaxBytes: 5 * 1024 * 1024 * 1024,
    });
  });

  it('rejects a source that changes inode after validation and before open', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-swap-'));
    created.push(directory);
    const source = path.join(directory, 'source.png');
    const replacement = path.join(directory, 'replacement.png');
    await fs.writeFile(source, png);
    await fs.writeFile(replacement, png);

    await expect(
      openVerifiedReadStream(source, undefined, undefined, async () => {
        await fs.rename(replacement, source);
      })
    ).rejects.toMatchObject<Partial<CreativeStudioMediaError>>({ code: 'storage_error' });
  });

  it('creates collision-safe export folder names without invalid path characters', async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-export-'));
    created.push(rootDir);
    expect(sanitizeStudioExportFolderName('  A:/ launch.  ')).toBe('A__ launch');
    expect(sanitizeStudioExportFolderName('...')).toBe('creative-studio-project');
    await fs.mkdir(path.join(rootDir, 'A__ launch-20260730-120000'));

    await expect(acquireStudioExportDirectory(rootDir, 'A:/ launch.  ', '20260730-120000')).resolves.toMatchObject({
      folderName: 'A__ launch-20260730-120000-2',
    });
  });

  it('bounds export folder components to 255 UTF-8 bytes, including collision suffixes', async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-export-long-'));
    created.push(rootDir);
    const projectName = '界'.repeat(200);

    const first = await acquireStudioExportDirectory(rootDir, projectName, '20260730-120000');
    const second = await acquireStudioExportDirectory(rootDir, projectName, '20260730-120000');

    expect(Buffer.byteLength(first.folderName, 'utf8')).toBeLessThanOrEqual(255);
    expect(Buffer.byteLength(second.folderName, 'utf8')).toBeLessThanOrEqual(255);
    expect(second.folderName).toMatch(/-2$/);
  });

  it('copies a valid reference into imports with a durable hash and no source path', async () => {
    const { rootDir, store } = await makeStore();
    const sourcePath = path.join(rootDir, 'reference.png');
    await fs.writeFile(sourcePath, png);
    const media = createStudioMediaStore({ store, createId: () => 'asset_1' });

    const asset = await media.importReferenceFromPath({
      projectId: 'project_1',
      sourcePath,
      expectedRevision: 1,
    });

    expect(asset).toMatchObject({
      id: 'asset_1',
      sceneId: null,
      mimeType: 'image/png',
      managedAsset: { collection: 'imports', fileName: 'asset_1.png' },
      sha256: createHash('sha256').update(png).digest('hex'),
    });
    expect(JSON.stringify(asset)).not.toContain(sourcePath);
    await expect(fs.access(path.join(rootDir, 'project_1', 'imports', 'asset_1.png'))).resolves.toBeUndefined();
  });

  it('classifies a verified project reference and allocates its stable label in the same CAS mutation', async () => {
    const { rootDir, store } = await makeStore();
    const sourcePath = path.join(rootDir, '  Hero\t  Portrait.PNG');
    await fs.writeFile(sourcePath, png);
    const media = createStudioMediaStore({
      store,
      createId: () => 'asset_cast',
      now: () => '2026-08-15T01:02:03.000Z',
    });

    const imported = await media.importReferenceFromPath({
      projectId: 'project_1',
      sourcePath,
      expectedRevision: 1,
      briefReferenceRole: 'cast',
      returnProject: true,
    });

    expect(imported.asset).toMatchObject({
      id: 'asset_cast',
      sceneId: null,
      briefReferenceRole: 'cast',
      briefReferenceLabel: 'Hero Portrait',
      byteSize: png.length,
      sha256: createHash('sha256').update(png).digest('hex'),
    });
    expect(imported.project).toMatchObject({
      revision: 2,
      assets: { asset_cast: imported.asset },
    });
    await expect(fs.access(path.join(rootDir, 'project_1', 'imports', 'asset_cast.png'))).resolves.toBeUndefined();
  });

  it('suffixes a duplicate classified basename against labels in the successful project revision', async () => {
    const { rootDir, store } = await makeStore();
    const sourcePath = path.join(rootDir, 'Reference 1.png');
    await fs.writeFile(sourcePath, png);
    const seeded = await addBriefReferences(store, 1);
    const media = createStudioMediaStore({ store, createId: () => 'asset_look' });

    const imported = await media.importReferenceFromPath({
      projectId: 'project_1',
      sourcePath,
      expectedRevision: seeded.revision,
      briefReferenceRole: 'look',
      returnProject: true,
    });

    expect(imported.asset.briefReferenceLabel).toBe('Reference 1 (2)');
    expect(imported.project.assets.asset_look.briefReferenceLabel).toBe('Reference 1 (2)');
  });

  it('refuses a seventh active Brief reference before starting the manifest mutation', async () => {
    const { rootDir, store } = await makeStore();
    const sourcePath = path.join(rootDir, 'seventh.png');
    await fs.writeFile(sourcePath, png);
    const seeded = await addBriefReferences(store, 6);
    const updateProject = vi.fn(store.updateProject.bind(store));
    const media = createStudioMediaStore({ store: { ...store, updateProject }, createId: () => 'asset_seventh' });

    await expect(
      media.importReferenceFromPath({
        projectId: 'project_1',
        sourcePath,
        expectedRevision: seeded.revision,
        briefReferenceRole: 'cast',
      })
    ).rejects.toMatchObject<Partial<CreativeStudioMediaError>>({ code: 'invalid_media' });
    expect(updateProject).not.toHaveBeenCalled();
    await expect(fs.access(path.join(rootDir, 'project_1', 'imports', 'asset_seventh.png'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('rechecks Brief-reference capacity inside the import CAS and cleans every transient file', async () => {
    const { rootDir, store } = await makeStore();
    const sourcePath = path.join(rootDir, 'concurrent-sixth.png');
    await fs.writeFile(sourcePath, png);
    await addBriefReferences(store, 5);
    const fiveReferences = await store.getProject('project_1');
    if (fiveReferences === null) throw new Error('project fixture missing');
    const sixReferences = structuredClone(fiveReferences);
    sixReferences.assets.brief_6 = {
      id: 'brief_6',
      projectId: 'project_1',
      sceneId: null,
      mediaKind: 'image',
      mimeType: 'image/png',
      managedAsset: { collection: 'imports', fileName: 'brief_6.png' },
      byteSize: 1,
      sha256: '6'.repeat(64),
      briefReferenceRole: 'look',
      briefReferenceLabel: 'Concurrent sixth',
      createdAt: '2026-08-15T00:00:06.000Z',
    };
    const concurrentStore: CreativeStudioStore = {
      ...store,
      getProject: vi.fn(async () => fiveReferences),
      updateProject: vi.fn(async (_projectId, update) => update(sixReferences)),
    };
    const media = createStudioMediaStore({ store: concurrentStore, createId: () => 'asset_seventh' });

    await expect(
      media.importReferenceFromPath({
        projectId: 'project_1',
        sourcePath,
        expectedRevision: fiveReferences.revision,
        briefReferenceRole: 'cast',
      })
    ).rejects.toMatchObject<Partial<CreativeStudioMediaError>>({ code: 'invalid_media' });
    const imports = await fs.readdir(path.join(rootDir, 'project_1', 'imports')).catch(() => []);
    const parts = await fs.readdir(path.join(rootDir, 'project_1', 'parts')).catch(() => []);
    expect(imports).not.toContain('asset_seventh.png');
    expect(parts.filter((name) => name.endsWith('.part'))).toEqual([]);
  });

  it('clears only Brief classification in one revision while preserving the managed import and file', async () => {
    const { rootDir, store } = await makeStore();
    const sourcePath = path.join(rootDir, 'hero.png');
    await fs.writeFile(sourcePath, png);
    const media = createStudioMediaStore({ store, createId: () => 'asset_cast' });
    const imported = await media.importReferenceFromPath({
      projectId: 'project_1',
      sourcePath,
      expectedRevision: 1,
      briefReferenceRole: 'cast',
      returnProject: true,
    });

    const detached = await media.detachBriefReference({
      projectId: 'project_1',
      assetId: 'asset_cast',
      expectedRevision: imported.project.revision,
    });

    expect(detached.revision).toBe(imported.project.revision + 1);
    expect(detached.assets.asset_cast).toEqual({
      ...imported.asset,
      briefReferenceRole: undefined,
      briefReferenceLabel: undefined,
    });
    await expect(fs.readFile(path.join(rootDir, 'project_1', 'imports', 'asset_cast.png'))).resolves.toEqual(png);
  });

  it('rejects a stale detach without changing classification or the managed file', async () => {
    const { rootDir, store } = await makeStore();
    const sourcePath = path.join(rootDir, 'hero.png');
    await fs.writeFile(sourcePath, png);
    const media = createStudioMediaStore({ store, createId: () => 'asset_cast' });
    const imported = await media.importReferenceFromPath({
      projectId: 'project_1',
      sourcePath,
      expectedRevision: 1,
      briefReferenceRole: 'cast',
      returnProject: true,
    });
    await store.updateProject('project_1', (project) => ({ ...project, brief: 'Concurrent edit' }));

    await expect(
      media.detachBriefReference({
        projectId: 'project_1',
        assetId: 'asset_cast',
        expectedRevision: imported.project.revision,
      })
    ).rejects.toMatchObject({ code: 'stale_project' });
    await expect(store.getProject('project_1')).resolves.toMatchObject({
      brief: 'Concurrent edit',
      assets: {
        asset_cast: { briefReferenceRole: 'cast', briefReferenceLabel: 'hero' },
      },
    });
    await expect(fs.readFile(path.join(rootDir, 'project_1', 'imports', 'asset_cast.png'))).resolves.toEqual(png);
  });

  it.each(['missing', 'foreign', 'scene-owned', 'unclassified'] as const)(
    'refuses to detach a %s asset without changing the project',
    async (fixture) => {
      const { store } = await makeStore();
      const persisted = await store.getProject('project_1');
      if (persisted === null) throw new Error('project fixture missing');
      const candidate = structuredClone(persisted);
      if (fixture !== 'missing') {
        candidate.assets.asset_target = {
          id: 'asset_target',
          projectId: fixture === 'foreign' ? 'project_other' : candidate.id,
          sceneId: fixture === 'scene-owned' ? 'scene_1' : null,
          mediaKind: 'image',
          mimeType: 'image/png',
          managedAsset: { collection: 'imports', fileName: 'asset_target.png' },
          byteSize: 7,
          sha256: 'a'.repeat(64),
          ...(fixture === 'unclassified' ? {} : { briefReferenceRole: 'cast' as const, briefReferenceLabel: 'Target' }),
          createdAt: candidate.createdAt,
        };
      }
      const updateProject = vi.fn(async (_projectId, update) => update(candidate));
      const media = createStudioMediaStore({ store: { ...store, updateProject } });

      await expect(
        media.detachBriefReference({
          projectId: 'project_1',
          assetId: 'asset_target',
          expectedRevision: candidate.revision,
        })
      ).rejects.toMatchObject({ code: fixture === 'missing' ? 'not_found' : 'invalid_media' });
      await expect(store.getProject('project_1')).resolves.toEqual(persisted);
    }
  );

  it('rejects a non-image reference before it can enter the manifest', async () => {
    const { rootDir, store } = await makeStore();
    const sourcePath = path.join(rootDir, 'reference.txt');
    await fs.writeFile(sourcePath, 'not media');
    const media = createStudioMediaStore({ store, createId: () => 'asset_1' });

    await expect(
      media.importReferenceFromPath({ projectId: 'project_1', sourcePath, expectedRevision: 1 })
    ).rejects.toMatchObject<Partial<CreativeStudioMediaError>>({ code: 'invalid_media' });
    expect((await store.getProject('project_1'))?.assets).toEqual({});
  });

  it.each([
    ['MP4', mp4],
    ['WebM', webm],
  ])('rejects a magic-valid %s video from the image-reference import path', async (_label, bytes) => {
    const { rootDir, store } = await makeStore();
    const sourcePath = path.join(rootDir, 'reference.bin');
    await fs.writeFile(sourcePath, bytes);
    const media = createStudioMediaStore({ store, createId: () => 'asset_video_reference' });

    await expect(
      media.importReferenceFromPath({ projectId: 'project_1', sourcePath, expectedRevision: 1 })
    ).rejects.toMatchObject<Partial<CreativeStudioMediaError>>({ code: 'invalid_media' });
    expect((await store.getProject('project_1'))?.assets).toEqual({});
    const imports = await fs.readdir(path.join(rootDir, 'project_1', 'imports')).catch(() => []);
    expect(imports).toEqual([]);
  });

  it('fails reference import before writing when injected disk capacity is insufficient', async () => {
    const { rootDir, store } = await makeStore();
    const sourcePath = path.join(rootDir, 'reference.png');
    await fs.writeFile(sourcePath, png);
    const media = createStudioMediaStore({
      store,
      createId: () => 'asset_1',
      getAvailableDiskBytes: async () => 0,
    });

    await expect(
      media.importReferenceFromPath({ projectId: 'project_1', sourcePath, expectedRevision: 1 })
    ).rejects.toMatchObject<Partial<CreativeStudioMediaError>>({ code: 'storage_error' });
    await expect(fs.access(path.join(rootDir, 'project_1', 'imports', 'asset_1.png'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('accepts a reference at exact disk capacity without a second free-space charge', async () => {
    const { rootDir, store } = await makeStore();
    const sourcePath = path.join(rootDir, 'reference.png');
    await fs.writeFile(sourcePath, png);
    const getAvailableDiskBytes = vi
      .fn<(directory: string) => Promise<number>>()
      .mockResolvedValueOnce(png.length)
      .mockRejectedValue(new Error('disk capacity was charged twice'));
    const media = createStudioMediaStore({ store, createId: () => 'asset_actual', getAvailableDiskBytes });

    await expect(
      media.importReferenceFromPath({ projectId: 'project_1', sourcePath, expectedRevision: 1 })
    ).resolves.toMatchObject({ id: 'asset_actual', byteSize: png.length });
    expect(getAvailableDiskBytes).toHaveBeenCalledOnce();
  });

  it('rejects a zero-capacity reference before creating a part even when its pre-open size is stale', async () => {
    const { rootDir, store } = await makeStore();
    const sourcePath = path.join(rootDir, 'reference.png');
    await fs.writeFile(sourcePath, png);
    const actualSourceStats = await fs.stat(sourcePath);
    const originalStat = fs.stat.bind(fs);
    const statSpy = vi.spyOn(fs, 'stat').mockImplementation(async (target, options) => {
      if (target === sourcePath) return { ...actualSourceStats, size: 0 } as typeof actualSourceStats;
      return originalStat(target, options as never);
    });
    const media = createStudioMediaStore({
      store,
      createId: () => 'asset_zero',
      getAvailableDiskBytes: async () => 0,
    });

    await expect(
      media.importReferenceFromPath({ projectId: 'project_1', sourcePath, expectedRevision: 1 })
    ).rejects.toMatchObject<Partial<CreativeStudioMediaError>>({ code: 'storage_error' });

    statSpy.mockRestore();
    await expect(fs.access(path.join(rootDir, 'project_1', 'parts'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('stops a reference that grows past its nonzero pre-stream capacity ceiling', async () => {
    const { rootDir, store } = await makeStore();
    const sourcePath = path.join(rootDir, 'reference.png');
    await fs.writeFile(sourcePath, png);
    const actualSourceStats = await fs.stat(sourcePath);
    const originalStat = fs.stat.bind(fs);
    const statSpy = vi.spyOn(fs, 'stat').mockImplementation(async (target, options) => {
      if (target === sourcePath) return { ...actualSourceStats, size: 0 } as typeof actualSourceStats;
      return originalStat(target, options as never);
    });
    const getAvailableDiskBytes = vi
      .fn<(directory: string) => Promise<number>>()
      .mockResolvedValueOnce(png.length - 1)
      .mockRejectedValue(new Error('capacity must be planned only once'));
    const media = createStudioMediaStore({
      store,
      createId: () => 'asset_grew',
      getAvailableDiskBytes,
    });

    await expect(
      media.importReferenceFromPath({ projectId: 'project_1', sourcePath, expectedRevision: 1 })
    ).rejects.toMatchObject<Partial<CreativeStudioMediaError>>({ code: 'storage_error' });

    statSpy.mockRestore();
    expect(getAvailableDiskBytes).toHaveBeenCalledOnce();
    expect((await store.getProject('project_1'))?.assets).toEqual({});
    const parts = await fs.readdir(path.join(rootDir, 'project_1', 'parts')).catch(() => []);
    expect(parts.filter((name) => name.endsWith('.part'))).toEqual([]);
  });

  it('allows the exact project quota boundary but rejects one byte above it', async () => {
    const { rootDir, store } = await makeStore();
    const sourcePath = path.join(rootDir, 'reference.png');
    await fs.writeFile(sourcePath, png);
    const exact = 5 * 1024 * 1024 * 1024 - png.length;
    await store.updateProject(
      'project_1',
      (project) => ({
        ...project,
        assets: {
          quota_asset: {
            id: 'quota_asset',
            projectId: project.id,
            sceneId: null,
            mediaKind: 'image',
            mimeType: 'image/png',
            managedAsset: { collection: 'imports', fileName: 'quota_asset.png' },
            byteSize: exact,
            sha256: 'a'.repeat(64),
            createdAt: project.createdAt,
          },
        },
      }),
      1
    );
    const media = createStudioMediaStore({ store, createId: () => 'asset_1' });
    await expect(
      media.importReferenceFromPath({ projectId: 'project_1', sourcePath, expectedRevision: 2 })
    ).resolves.toMatchObject({ id: 'asset_1' });

    const overflowSource = path.join(rootDir, 'overflow.png');
    await fs.writeFile(overflowSource, png);
    await expect(
      media.importReferenceFromPath({ projectId: 'project_1', sourcePath: overflowSource, expectedRevision: 3 })
    ).rejects.toMatchObject<Partial<CreativeStudioMediaError>>({ code: 'invalid_media' });
  });

  it('preserves a replacement final import when the manifest CAS fails', async () => {
    const { rootDir, store } = await makeStore();
    const sourcePath = path.join(rootDir, 'reference.png');
    const replacementPath = path.join(rootDir, 'replacement-owned-by-user');
    const finalPath = path.join(rootDir, 'project_1', 'imports', 'asset_stale_import.png');
    await fs.writeFile(sourcePath, png);
    await fs.writeFile(replacementPath, 'replacement import');
    const staleStore: CreativeStudioStore = {
      ...store,
      async updateProject() {
        await fs.rm(finalPath);
        await fs.rename(replacementPath, finalPath);
        throw new CreativeStudioStoreError('stale_project', 'forced stale CAS');
      },
    };
    const media = createStudioMediaStore({ store: staleStore, createId: () => 'asset_stale_import' });

    await expect(
      media.importReferenceFromPath({ projectId: 'project_1', sourcePath, expectedRevision: 1 })
    ).rejects.toMatchObject({ code: 'stale_project' });
    await expect(fs.readFile(finalPath, 'utf8')).resolves.toBe('replacement import');
    expect((await store.getProject('project_1'))?.assets).toEqual({});
  });

  it('leaves no classified manifest entry, part, or unreferenced final import after a stale CAS', async () => {
    const { rootDir, store } = await makeStore();
    const sourcePath = path.join(rootDir, 'stale-cast.png');
    await fs.writeFile(sourcePath, png);
    const staleStore: CreativeStudioStore = {
      ...store,
      async updateProject() {
        throw new CreativeStudioStoreError('stale_project', 'forced stale CAS');
      },
    };
    const media = createStudioMediaStore({ store: staleStore, createId: () => 'asset_stale_cast' });

    await expect(
      media.importReferenceFromPath({
        projectId: 'project_1',
        sourcePath,
        expectedRevision: 1,
        briefReferenceRole: 'cast',
      })
    ).rejects.toMatchObject({ code: 'stale_project' });
    expect((await store.getProject('project_1'))?.assets).toEqual({});
    const parts = await fs.readdir(path.join(rootDir, 'project_1', 'parts')).catch(() => []);
    const imports = await fs.readdir(path.join(rootDir, 'project_1', 'imports')).catch(() => []);
    expect(parts.filter((name) => name.endsWith('.part'))).toEqual([]);
    expect(imports).not.toContain('asset_stale_cast.png');
  });

  it('persists a generated image stream with a verified hash and no provider URL', async () => {
    const { rootDir, store } = await makeStore();
    await store.updateProject(
      'project_1',
      (project) => ({
        ...project,
        sceneOrder: ['scene_1'],
        scenes: {
          scene_1: {
            id: 'scene_1',
            title: 'Opening',
            purpose: '',
            visualPrompt: '',
            narration: '',
            onScreenText: '',
            mediaKind: 'image',
            durationSeconds: 5,
            referenceAssetId: null,
            selectedAssetId: null,
            assetIds: [],
            jobIds: [],
            reviewState: 'draft',
          },
        },
      }),
      1
    );
    const media = createStudioMediaStore({ store, createId: () => 'asset_2' });

    const asset = await media.persistProviderOutput({
      projectId: 'project_1',
      sceneId: 'scene_1',
      expectedRevision: 2,
      mediaKind: 'image',
      declaredMimeType: 'image/png',
      body: Readable.from([png]),
    });

    expect(asset.managedAsset).toEqual({ collection: 'assets', fileName: 'asset_2.png' });
    expect(asset.sha256).toBe(createHash('sha256').update(png).digest('hex'));
    expect(JSON.stringify(await store.getProject('project_1'))).not.toContain('http');
    await expect(fs.access(path.join(rootDir, 'project_1', 'assets', 'asset_2.png'))).resolves.toBeUndefined();
  });

  it('rejects a job output whose media kind does not match its scene before manifest attachment', async () => {
    const { rootDir, store } = await makeStore();
    await addActiveImageJob(store);
    const media = createStudioMediaStore({ store, createId: () => 'asset_wrong_kind' });

    await expect(
      media.persistProviderOutputForJob({
        projectId: 'project_1',
        sceneId: 'scene_1',
        jobId: 'job_1',
        mediaKind: 'video',
        declaredMimeType: 'video/mp4',
        body: Readable.from([mp4]),
      })
    ).rejects.toMatchObject<Partial<CreativeStudioMediaError>>({ code: 'invalid_media' });

    expect((await store.getProject('project_1'))?.assets).toEqual({});
    await expect(fs.access(path.join(rootDir, 'project_1', 'assets', 'asset_wrong_kind.mp4'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('atomically attaches a staged job output and marks only that job succeeded', async () => {
    const { store } = await makeStore();
    await addActiveImageJob(store);
    const media = createStudioMediaStore({ store, createId: () => 'asset_job_1' });

    const asset = await media.persistProviderOutputForJob({
      projectId: 'project_1',
      sceneId: 'scene_1',
      jobId: 'job_1',
      mediaKind: 'image',
      declaredMimeType: 'image/png',
      body: Readable.from([png]),
    });

    const project = await store.getProject('project_1');
    expect(project?.jobs.job_1).toMatchObject({
      status: 'succeeded',
      outputAssetIds: [asset.id],
      error: null,
    });
    expect(project?.scenes.scene_1).toMatchObject({
      assetIds: [asset.id],
      selectedAssetId: asset.id,
      reviewState: 'complete',
    });
    expect(project?.routing.image).toBeNull();
  });

  it('commits a reference to the scene without selecting it as the take', async () => {
    const { rootDir, store } = await makeStore();
    await addActiveReferenceJob(store);
    const media = createStudioMediaStore({ store, createId: () => 'asset_reference_1' });

    const committed = await media.persistProviderOutputForJob({
      projectId: 'project_1',
      sceneId: 'scene_1',
      jobId: 'job_1',
      mediaKind: 'image',
      declaredMimeType: 'image/png',
      body: Readable.from([png]),
    });

    const project = await store.getProject('project_1');
    expect(project?.scenes.scene_1.referenceAssetId).toBe(committed.id);
    // assetIds is "assets owned by this scene", not "takes" — imports and posters
    // live there too, and store.ts:993 requires the reverse link. What must stay
    // true is that the plate is not the take and the scene is not produced.
    expect(project?.scenes.scene_1.assetIds).toContain(committed.id);
    expect(project?.scenes.scene_1.selectedAssetId).toBeNull();
    // Regression: a reference commit must clear the submit-time generating state without marking the scene produced.
    expect(project?.scenes.scene_1.reviewState).toBe('draft');
    expect(project?.assets[committed.id].sceneId).toBe('scene_1');
    expect(project?.assets[committed.id].managedAsset.collection).toBe('references');
    await expect(
      fs.access(path.join(rootDir, 'project_1', 'references', 'asset_reference_1.png'))
    ).resolves.toBeUndefined();
  });

  it('restores a produced scene to complete after committing a new reference', async () => {
    const { store } = await makeStore();
    await addActiveReferenceJob(store);
    await store.updateProject('project_1', (project) => {
      const next = structuredClone(project);
      next.assets.asset_existing_take = {
        id: 'asset_existing_take',
        projectId: project.id,
        sceneId: 'scene_1',
        mediaKind: 'video',
        mimeType: 'video/mp4',
        managedAsset: { collection: 'assets', fileName: 'asset_existing_take.mp4' },
        byteSize: 1,
        sha256: '0'.repeat(64),
        durationSeconds: 5,
        createdAt: project.createdAt,
      };
      next.scenes.scene_1.assetIds.push('asset_existing_take');
      next.scenes.scene_1.selectedAssetId = 'asset_existing_take';
      return next;
    });
    const media = createStudioMediaStore({ store, createId: () => 'asset_replacement_reference' });

    const committed = await media.persistProviderOutputForJob({
      projectId: 'project_1',
      sceneId: 'scene_1',
      jobId: 'job_1',
      mediaKind: 'image',
      declaredMimeType: 'image/png',
      body: Readable.from([png]),
    });

    const project = await store.getProject('project_1');
    expect(project?.scenes.scene_1.referenceAssetId).toBe(committed.id);
    expect(project?.scenes.scene_1.selectedAssetId).toBe('asset_existing_take');
    expect(project?.scenes.scene_1.reviewState).toBe('complete');
  });

  it('leaves a persisted cut untouched when committing a reference', async () => {
    const { store } = await makeStore();
    await addActiveReferenceJob(store);
    await store.updateProject('project_1', (project) => {
      const next = structuredClone(project);
      next.assets.asset_video_old = {
        id: 'asset_video_old',
        projectId: project.id,
        sceneId: 'scene_1',
        mediaKind: 'video',
        mimeType: 'video/mp4',
        managedAsset: { collection: 'assets', fileName: 'asset_video_old.mp4' },
        byteSize: 1,
        sha256: '0'.repeat(64),
        durationSeconds: 5.085,
        createdAt: project.createdAt,
      };
      next.scenes.scene_1.assetIds.push('asset_video_old');
      next.scenes.scene_1.selectedAssetId = 'asset_video_old';
      next.cuts = {
        cut_1: {
          id: 'cut_1',
          name: project.name,
          orderMode: 'storyboard',
          clipOrder: ['clip_scene_1'],
          clips: {
            clip_scene_1: {
              id: 'clip_scene_1',
              sceneId: 'scene_1',
              assetId: 'asset_video_old',
              sourceInSeconds: 0.5,
              sourceOutSeconds: 4.5,
              crop: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 },
              filters: [{ id: 'contrast', amount: 0.25 }],
            },
          },
        },
      };
      next.activeCutId = 'cut_1';
      return next;
    });
    const media = createStudioMediaStore({ store, createId: () => 'asset_reference_cut' });

    await media.persistProviderOutputForJob({
      projectId: 'project_1',
      sceneId: 'scene_1',
      jobId: 'job_1',
      mediaKind: 'image',
      declaredMimeType: 'image/png',
      body: Readable.from([png]),
    });

    // A plate must never become a clip in the rendered cut: reconciliation runs
    // unconditionally now, but it derives clips solely from selectedTake, which a
    // reference commit never changes, so the pre-existing take clip must survive as-is.
    expect((await store.getProject('project_1'))?.cuts?.cut_1?.clips.clip_scene_1).toMatchObject({
      assetId: 'asset_video_old',
      sourceInSeconds: 0.5,
      sourceOutSeconds: 4.5,
      crop: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 },
      filters: [{ id: 'contrast', amount: 0.25 }],
    });
  });

  it('does not create a canonical generated take when committing a reference', async () => {
    const { store } = await makeStore();
    await addActiveReferenceJob(store);
    const media = createStudioMediaStore({ store, createId: () => 'asset_reference_not_take' });

    await media.persistProviderOutputForJob({
      projectId: 'project_1',
      sceneId: 'scene_1',
      jobId: 'job_1',
      mediaKind: 'image',
      declaredMimeType: 'image/png',
      body: Readable.from([png]),
    });

    const project = await store.getProject('project_1');
    const scene = project?.scenes.scene_1;
    expect(
      project && scene
        ? Object.values(project.assets).some((asset) => isCanonicalStudioGeneratedTake(asset, project.id, scene))
        : true
    ).toBe(false);
  });

  it('records the visual prompt the image was generated from, trimmed', async () => {
    const { store } = await makeStore();
    await addActiveReferenceJob(store, '  Aerial, drifting.  ');
    const media = createStudioMediaStore({ store, createId: () => 'asset_reference_prompt' });

    const committed = await media.persistProviderOutputForJob({
      projectId: 'project_1',
      sceneId: 'scene_1',
      jobId: 'job_1',
      mediaKind: 'image',
      declaredMimeType: 'image/png',
      body: Readable.from([png]),
    });

    expect((await store.getProject('project_1'))?.assets[committed.id].sourceVisualPrompt).toBe('Aerial, drifting.');
  });

  it('still commits a take exactly as before', async () => {
    const { store } = await makeStore();
    await addActiveVideoJob(store);
    await store.updateProject('project_1', (project) => {
      const next = structuredClone(project);
      next.scenes.scene_1.visualPrompt = '  Aerial, drifting.  ';
      return next;
    });
    const media = createStudioMediaStore({ store, createId: () => 'asset_video_take' });

    const committed = await media.persistProviderOutputForJob({
      projectId: 'project_1',
      sceneId: 'scene_1',
      jobId: 'job_1',
      mediaKind: 'video',
      declaredMimeType: 'video/mp4',
      body: Readable.from([mp4]),
    });

    const project = await store.getProject('project_1');
    expect(project?.scenes.scene_1.selectedAssetId).toBe(committed.id);
    expect(project?.scenes.scene_1.assetIds).toContain(committed.id);
    expect(project?.scenes.scene_1.reviewState).toBe('complete');
    expect(project?.assets[committed.id].sourceVisualPrompt).toBe('Aerial, drifting.');
  });

  it('rejects a reference whose output is not an image', async () => {
    const { store } = await makeStore();
    await addActiveReferenceJob(store);
    const media = createStudioMediaStore({ store, createId: () => 'asset_reference_video' });

    await expect(
      media.persistProviderOutputForJob({
        projectId: 'project_1',
        sceneId: 'scene_1',
        jobId: 'job_1',
        mediaKind: 'video',
        declaredMimeType: 'video/mp4',
        body: Readable.from([mp4]),
      })
    ).rejects.toMatchObject<Partial<CreativeStudioMediaError>>({ code: 'invalid_media' });
  });

  it('persists a fractional provider-reported video duration', async () => {
    const { store } = await makeStore();
    await addActiveVideoJob(store);
    const media = createStudioMediaStore({ store, createId: () => 'asset_video_fractional' });

    const asset = await media.persistProviderOutputForJob({
      projectId: 'project_1',
      sceneId: 'scene_1',
      jobId: 'job_1',
      mediaKind: 'video',
      declaredMimeType: 'video/mp4',
      durationSeconds: 5.085,
      body: Readable.from([mp4]),
    });

    expect(asset.durationSeconds).toBe(5.085);
    expect((await store.getProject('project_1'))?.assets.asset_video_fractional?.durationSeconds).toBe(5.085);
  });

  it('reconciles a persisted cut when a completed provider job selects a new take', async () => {
    const { store } = await makeStore();
    await addActiveVideoJob(store);
    await store.updateProject('project_1', (project) => {
      const next = structuredClone(project);
      next.assets.asset_video_old = {
        id: 'asset_video_old',
        projectId: project.id,
        sceneId: 'scene_1',
        mediaKind: 'video',
        mimeType: 'video/mp4',
        managedAsset: { collection: 'assets', fileName: 'asset_video_old.mp4' },
        byteSize: 1,
        sha256: '0'.repeat(64),
        durationSeconds: 5.085,
        createdAt: project.createdAt,
      };
      next.scenes.scene_1.assetIds.push('asset_video_old');
      next.scenes.scene_1.selectedAssetId = 'asset_video_old';
      next.cuts = {
        cut_1: {
          id: 'cut_1',
          name: project.name,
          orderMode: 'storyboard',
          clipOrder: ['clip_scene_1'],
          clips: {
            clip_scene_1: {
              id: 'clip_scene_1',
              sceneId: 'scene_1',
              assetId: 'asset_video_old',
              sourceInSeconds: 0.5,
              sourceOutSeconds: 4.5,
              crop: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 },
              filters: [{ id: 'contrast', amount: 0.25 }],
            },
          },
        },
      };
      next.activeCutId = 'cut_1';
      return next;
    });
    const media = createStudioMediaStore({ store, createId: () => 'asset_video_new' });

    await media.persistProviderOutputForJob({
      projectId: 'project_1',
      sceneId: 'scene_1',
      jobId: 'job_1',
      mediaKind: 'video',
      declaredMimeType: 'video/mp4',
      durationSeconds: 3,
      body: Readable.from([mp4]),
    });

    expect((await store.getProject('project_1'))?.cuts?.cut_1?.clips.clip_scene_1).toMatchObject({
      assetId: 'asset_video_new',
      sourceInSeconds: 0.5,
      sourceOutSeconds: 3,
      crop: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 },
      filters: [{ id: 'contrast', amount: 0.25 }],
    });
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid provider-reported video duration %s before persistence',
    async (durationSeconds) => {
      const { store } = await makeStore();
      await addActiveVideoJob(store);
      const media = createStudioMediaStore({ store, createId: () => 'asset_video_invalid_duration' });

      await expect(
        media.persistProviderOutputForJob({
          projectId: 'project_1',
          sceneId: 'scene_1',
          jobId: 'job_1',
          mediaKind: 'video',
          declaredMimeType: 'video/mp4',
          durationSeconds,
          body: Readable.from([mp4]),
        })
      ).rejects.toMatchObject<Partial<CreativeStudioMediaError>>({ code: 'invalid_media' });
      expect((await store.getProject('project_1'))?.assets).toEqual({});
    }
  );

  it('attaches a completed asset without overwriting a newer project model selection', async () => {
    const { store } = await makeStore();
    await addActiveImageJob(store);
    const newer = {
      providerId: 'provider_1',
      adapterId: 'weprompt-image-v1',
      model: 'image-b',
    };
    let intercepted = false;
    const interleavingStore: CreativeStudioStore = {
      ...store,
      async updateProject(projectId, update, expectedRevision) {
        if (!intercepted && expectedRevision === undefined) {
          intercepted = true;
          await store.updateProject(projectId, (project) => ({
            ...project,
            routing: { ...project.routing, image: newer },
          }));
        }
        return store.updateProject(projectId, update, expectedRevision);
      },
    };
    const media = createStudioMediaStore({ store: interleavingStore, createId: () => 'asset_job_1' });

    await media.persistProviderOutputForJob({
      projectId: 'project_1',
      sceneId: 'scene_1',
      jobId: 'job_1',
      mediaKind: 'image',
      declaredMimeType: 'image/png',
      body: Readable.from([png]),
    });

    expect(intercepted).toBe(true);
    expect((await store.getProject('project_1'))?.routing.image).toEqual(newer);
  });

  it('atomically appends one poster thumbnail without replacing a newly selected video variation', async () => {
    const { rootDir, store } = await makeStore();
    await addActiveVideoJob(store);
    const assetIds = [
      'asset_video_primary',
      'asset_video_variation',
      'asset_video_poster',
      'asset_video_second_poster',
    ];
    let assetIndex = 0;
    const media = createStudioMediaStore({ store, createId: () => assetIds[assetIndex++]! });
    const primary = await media.persistProviderOutputForJob({
      projectId: 'project_1',
      sceneId: 'scene_1',
      jobId: 'job_1',
      mediaKind: 'video',
      declaredMimeType: 'video/mp4',
      body: Readable.from([mp4]),
    });
    await store.updateProject('project_1', (project) => {
      const next = structuredClone(project);
      next.jobs.job_2 = {
        ...next.jobs.job_1,
        id: 'job_2',
        status: 'running',
        idempotencyKey: 'key_2',
        outputAssetIds: [],
      };
      next.scenes.scene_1.jobIds.push('job_2');
      next.scenes.scene_1.reviewState = 'generating';
      return next;
    });
    const variation = await media.persistProviderOutputForJob({
      projectId: 'project_1',
      sceneId: 'scene_1',
      jobId: 'job_2',
      mediaKind: 'video',
      declaredMimeType: 'video/mp4',
      body: Readable.from([mp4]),
    });

    const poster = await media.persistProviderPosterForJob({
      projectId: 'project_1',
      sceneId: 'scene_1',
      jobId: 'job_1',
      primaryAssetId: primary.id,
      declaredMimeType: 'image/png',
      body: Readable.from([png]),
    });

    const project = await store.getProject('project_1');
    expect(poster).toMatchObject({
      mediaKind: 'image',
      managedAsset: { collection: 'thumbnails', fileName: 'asset_video_poster.png' },
    });
    expect(project?.jobs.job_1).toMatchObject({
      status: 'succeeded',
      outputAssetIds: [primary.id, poster.id],
      error: null,
    });
    expect(project?.scenes.scene_1).toMatchObject({
      assetIds: [primary.id, variation.id, poster.id],
      selectedAssetId: variation.id,
      reviewState: 'complete',
    });
    expect(JSON.stringify(project)).not.toContain(rootDir);
    await expect(
      fs.access(path.join(rootDir, 'project_1', 'thumbnails', 'asset_video_poster.png'))
    ).resolves.toBeUndefined();

    await expect(
      media.persistProviderPosterForJob({
        projectId: 'project_1',
        sceneId: 'scene_1',
        jobId: 'job_1',
        primaryAssetId: primary.id,
        declaredMimeType: 'image/png',
        body: Readable.from([png]),
      })
    ).rejects.toMatchObject<Partial<CreativeStudioMediaError>>({ code: 'job_inactive' });
    expect(Object.keys((await store.getProject('project_1'))?.assets ?? {})).toHaveLength(3);
  });

  it('persists a renderer-captured poster through its own video-take lineage and canonical thumbnail path', async () => {
    const { rootDir, store } = await makeStore();
    await addActiveVideoJob(store);
    const assetIds = ['asset_video_primary', 'asset_video_captured_poster'];
    let assetIndex = 0;
    const media = createStudioMediaStore({ store, createId: () => assetIds[assetIndex++]! });
    const primary = await media.persistProviderOutputForJob({
      projectId: 'project_1',
      sceneId: 'scene_1',
      jobId: 'job_1',
      mediaKind: 'video',
      declaredMimeType: 'video/mp4',
      body: Readable.from([mp4]),
    });

    const poster = await media.persistCapturedPoster({
      projectId: 'project_1',
      sceneId: 'scene_1',
      videoAssetId: primary.id,
      width: 1280,
      height: 720,
      body: Readable.from([png]),
    });

    const project = await store.getProject('project_1');
    const canonicalScene = project?.scenes.scene_1;
    expect(canonicalScene).toBeDefined();
    expect(isCanonicalStudioPosterAsset(poster, 'project_1', canonicalScene!)).toBe(true);
    expect(project?.jobs.job_1.outputAssetIds).toEqual([primary.id, poster.id]);
    await expect(
      fs.access(path.join(rootDir, 'project_1', 'thumbnails', 'asset_video_captured_poster.png'))
    ).resolves.toBeUndefined();
    await expect(
      media.persistCapturedPoster({
        projectId: 'project_1',
        sceneId: 'scene_1',
        videoAssetId: primary.id,
        width: 1280,
        height: 720,
        body: Readable.from([png]),
      })
    ).rejects.toMatchObject<Partial<CreativeStudioMediaError>>({ code: 'job_inactive' });
  });

  it('keeps provider poster lineage closed to a foreign scene', async () => {
    const { store } = await makeStore();
    await addActiveVideoJob(store);
    const media = createStudioMediaStore({ store, createId: () => 'asset_video_primary' });
    const primary = await media.persistProviderOutputForJob({
      projectId: 'project_1',
      sceneId: 'scene_1',
      jobId: 'job_1',
      mediaKind: 'video',
      declaredMimeType: 'video/mp4',
      body: Readable.from([mp4]),
    });
    await store.updateProject('project_1', (project) => {
      const next = structuredClone(project);
      next.sceneOrder.push('scene_2');
      next.scenes.scene_2 = {
        ...next.scenes.scene_1,
        id: 'scene_2',
        selectedAssetId: null,
        assetIds: [],
        jobIds: [],
      };
      return next;
    });

    await expect(
      media.persistProviderPosterForJob({
        projectId: 'project_1',
        sceneId: 'scene_2',
        jobId: 'job_1',
        primaryAssetId: primary.id,
        declaredMimeType: 'image/png',
        body: Readable.from([png]),
      })
    ).rejects.toMatchObject<Partial<CreativeStudioMediaError>>({ code: 'job_inactive' });
  });

  it('rejects inactive, wrong-kind, and invalid-lineage poster writes', async () => {
    const { store } = await makeStore();
    await addActiveVideoJob(store);
    const assetIds = ['asset_video_primary', 'asset_image_primary'];
    let assetIndex = 0;
    const media = createStudioMediaStore({ store, createId: () => assetIds[assetIndex++]! });
    const posterInput = {
      projectId: 'project_1',
      sceneId: 'scene_1',
      jobId: 'job_1',
      primaryAssetId: 'asset_video_primary',
      declaredMimeType: 'image/png',
      body: Readable.from([png]),
    };

    await expect(media.persistProviderPosterForJob(posterInput)).rejects.toMatchObject<
      Partial<CreativeStudioMediaError>
    >({ code: 'job_inactive' });

    const primary = await media.persistProviderOutputForJob({
      projectId: 'project_1',
      sceneId: 'scene_1',
      jobId: 'job_1',
      mediaKind: 'video',
      declaredMimeType: 'video/mp4',
      body: Readable.from([mp4]),
    });
    await expect(
      media.persistProviderPosterForJob({
        ...posterInput,
        primaryAssetId: 'asset_not_from_job',
        body: Readable.from([png]),
      })
    ).rejects.toMatchObject<Partial<CreativeStudioMediaError>>({ code: 'job_inactive' });

    const { store: imageStore } = await makeStore();
    await addActiveImageJob(imageStore);
    const imageMedia = createStudioMediaStore({ store: imageStore, createId: () => 'asset_image_primary' });
    const imagePrimary = await imageMedia.persistProviderOutputForJob({
      projectId: 'project_1',
      sceneId: 'scene_1',
      jobId: 'job_1',
      mediaKind: 'image',
      declaredMimeType: 'image/png',
      body: Readable.from([png]),
    });
    await expect(
      imageMedia.persistProviderPosterForJob({
        projectId: 'project_1',
        sceneId: 'scene_1',
        jobId: 'job_1',
        primaryAssetId: imagePrimary.id,
        declaredMimeType: 'image/png',
        body: Readable.from([png]),
      })
    ).rejects.toMatchObject<Partial<CreativeStudioMediaError>>({ code: 'invalid_media' });
    expect(primary.id).toBe('asset_video_primary');
  });

  it('unlinks a staged output when cancellation wins the final job-state compare-and-set', async () => {
    const { rootDir, store } = await makeStore();
    await addActiveImageJob(store);
    let intercepted = false;
    const cancellingStore: CreativeStudioStore = {
      ...store,
      async updateProject(projectId, update, expectedRevision) {
        if (!intercepted && expectedRevision === undefined) {
          intercepted = true;
          await store.updateProject(projectId, (project) => {
            const next = structuredClone(project);
            next.jobs.job_1.status = 'cancelled';
            return next;
          });
        }
        return store.updateProject(projectId, update, expectedRevision);
      },
    };
    const media = createStudioMediaStore({ store: cancellingStore, createId: () => 'asset_cancelled' });

    await expect(
      media.persistProviderOutputForJob({
        projectId: 'project_1',
        sceneId: 'scene_1',
        jobId: 'job_1',
        mediaKind: 'image',
        declaredMimeType: 'image/png',
        body: Readable.from([png]),
      })
    ).rejects.toMatchObject<Partial<CreativeStudioMediaError>>({ code: 'job_inactive' });

    expect((await store.getProject('project_1'))?.assets).toEqual({});
    await expect(fs.access(path.join(rootDir, 'project_1', 'assets', 'asset_cancelled.png'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('accepts a declared provider output at exact disk capacity without charging the part twice', async () => {
    const { store } = await makeStore();
    await addImageScene(store);
    const getAvailableDiskBytes = vi
      .fn<(directory: string) => Promise<number>>()
      .mockResolvedValueOnce(png.length)
      .mockRejectedValue(new Error('disk capacity was charged twice'));
    const media = createStudioMediaStore({
      store,
      createId: () => 'asset_exact_capacity',
      getAvailableDiskBytes,
    });

    await expect(
      media.persistProviderOutput({
        projectId: 'project_1',
        sceneId: 'scene_1',
        expectedRevision: 2,
        mediaKind: 'image',
        declaredMimeType: 'image/png',
        declaredByteSize: png.length,
        body: Readable.from([png]),
      })
    ).resolves.toMatchObject({ id: 'asset_exact_capacity', byteSize: png.length });
    expect(getAvailableDiskBytes).toHaveBeenCalledOnce();
  });

  it('rejects an unknown-size provider body at zero capacity before consuming it or creating a part', async () => {
    const { rootDir, store } = await makeStore();
    await addImageScene(store);
    let consumed = false;
    const body = {
      async *[Symbol.asyncIterator](): AsyncGenerator<Uint8Array> {
        consumed = true;
        yield png;
      },
    };
    const media = createStudioMediaStore({
      store,
      createId: () => 'asset_zero_capacity',
      getAvailableDiskBytes: async () => 0,
    });

    await expect(
      media.persistProviderOutput({
        projectId: 'project_1',
        sceneId: 'scene_1',
        expectedRevision: 2,
        mediaKind: 'image',
        declaredMimeType: 'image/png',
        body,
      })
    ).rejects.toMatchObject<Partial<CreativeStudioMediaError>>({ code: 'storage_error' });
    expect(consumed).toBe(false);
    await expect(fs.access(path.join(rootDir, 'project_1', 'parts'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects a declared output above capacity before consuming its body', async () => {
    const { store } = await makeStore();
    await addImageScene(store);
    let consumed = false;
    const body = {
      async *[Symbol.asyncIterator](): AsyncGenerator<Uint8Array> {
        consumed = true;
        yield png;
      },
    };
    const media = createStudioMediaStore({
      store,
      createId: () => 'asset_declared_over',
      getAvailableDiskBytes: async () => png.length - 1,
    });

    await expect(
      media.persistProviderOutput({
        projectId: 'project_1',
        sceneId: 'scene_1',
        expectedRevision: 2,
        mediaKind: 'image',
        declaredMimeType: 'image/png',
        declaredByteSize: png.length,
        body,
      })
    ).rejects.toMatchObject<Partial<CreativeStudioMediaError>>({ code: 'storage_error' });
    expect(consumed).toBe(false);
  });

  it('rejects a declared-size mismatch and cleans the part', async () => {
    const { rootDir, store } = await makeStore();
    await addImageScene(store);
    const media = createStudioMediaStore({ store, createId: () => 'asset_size_mismatch' });

    await expect(
      media.persistProviderOutput({
        projectId: 'project_1',
        sceneId: 'scene_1',
        expectedRevision: 2,
        mediaKind: 'image',
        declaredMimeType: 'image/png',
        declaredByteSize: png.length + 1,
        body: Readable.from([png]),
      })
    ).rejects.toMatchObject<Partial<CreativeStudioMediaError>>({ code: 'invalid_media' });
    const parts = await fs.readdir(path.join(rootDir, 'project_1', 'parts')).catch(() => []);
    expect(parts.filter((name) => name.endsWith('.part'))).toEqual([]);
  });

  it('enforces injected reference, image-output, and video-output ceilings with small streams', async () => {
    const { rootDir, store } = await makeStore();
    const sourcePath = path.join(rootDir, 'reference.png');
    await fs.writeFile(sourcePath, png);
    const media = createStudioMediaStore({
      store,
      createId: () => 'asset_limited',
      limits: {
        referenceMaxBytes: png.length - 1,
        imageOutputMaxBytes: png.length - 1,
        videoOutputMaxBytes: mp4.length - 1,
      },
    });

    await expect(
      media.importReferenceFromPath({ projectId: 'project_1', sourcePath, expectedRevision: 1 })
    ).rejects.toMatchObject<Partial<CreativeStudioMediaError>>({ code: 'invalid_media' });
    await addImageScene(store);
    await expect(
      media.persistProviderOutput({
        projectId: 'project_1',
        sceneId: 'scene_1',
        expectedRevision: 2,
        mediaKind: 'image',
        declaredMimeType: 'image/png',
        body: Readable.from([png]),
      })
    ).rejects.toMatchObject<Partial<CreativeStudioMediaError>>({ code: 'invalid_media' });
    await expect(
      media.persistProviderOutput({
        projectId: 'project_1',
        sceneId: 'scene_1',
        expectedRevision: 2,
        mediaKind: 'video',
        declaredMimeType: 'video/mp4',
        body: Readable.from([mp4]),
      })
    ).rejects.toMatchObject<Partial<CreativeStudioMediaError>>({ code: 'invalid_media' });
    expect((await store.getProject('project_1'))?.assets).toEqual({});
  });

  it('preserves a replacement final provider asset when the manifest CAS fails', async () => {
    const { rootDir, store } = await makeStore();
    await addImageScene(store);
    const replacementPath = path.join(rootDir, 'replacement-owned-by-user');
    const finalPath = path.join(rootDir, 'project_1', 'assets', 'asset_stale_provider.png');
    await fs.writeFile(replacementPath, 'replacement provider asset');
    const staleStore: CreativeStudioStore = {
      ...store,
      async updateProject() {
        await fs.rm(finalPath);
        await fs.rename(replacementPath, finalPath);
        throw new CreativeStudioStoreError('stale_project', 'forced stale CAS');
      },
    };
    const media = createStudioMediaStore({ store: staleStore, createId: () => 'asset_stale_provider' });

    await expect(
      media.persistProviderOutput({
        projectId: 'project_1',
        sceneId: 'scene_1',
        expectedRevision: 2,
        mediaKind: 'image',
        declaredMimeType: 'image/png',
        declaredByteSize: png.length,
        body: Readable.from([png]),
      })
    ).rejects.toMatchObject({ code: 'stale_project' });
    await expect(fs.readFile(finalPath, 'utf8')).resolves.toBe('replacement provider asset');
    expect((await store.getProject('project_1'))?.assets).toEqual({});
  });

  it('never overwrites an existing final asset when an id collides', async () => {
    const { rootDir, store } = await makeStore();
    await store.updateProject(
      'project_1',
      (project) => ({
        ...project,
        sceneOrder: ['scene_1'],
        scenes: {
          scene_1: {
            id: 'scene_1',
            title: 'Opening',
            purpose: '',
            visualPrompt: '',
            narration: '',
            onScreenText: '',
            mediaKind: 'image',
            durationSeconds: 5,
            referenceAssetId: null,
            selectedAssetId: null,
            assetIds: [],
            jobIds: [],
            reviewState: 'draft',
          },
        },
      }),
      1
    );
    const assetsDir = path.join(rootDir, 'project_1', 'assets');
    await fs.mkdir(assetsDir, { recursive: true });
    const existing = path.join(assetsDir, 'asset_collision.png');
    await fs.writeFile(existing, 'do not overwrite');
    const media = createStudioMediaStore({ store, createId: () => 'asset_collision' });

    await expect(
      media.persistProviderOutput({
        projectId: 'project_1',
        sceneId: 'scene_1',
        expectedRevision: 2,
        mediaKind: 'image',
        declaredMimeType: 'image/png',
        body: Readable.from([png]),
      })
    ).rejects.toMatchObject<Partial<CreativeStudioMediaError>>({ code: 'storage_error' });
    await expect(fs.readFile(existing, 'utf8')).resolves.toBe('do not overwrite');
    expect((await store.getProject('project_1'))?.assets).toEqual({});
  });

  it('requires remote Content-Type, declared MIME, and magic bytes to agree', async () => {
    const { rootDir, store } = await makeStore();
    await store.updateProject(
      'project_1',
      (project) => ({
        ...project,
        sceneOrder: ['scene_1'],
        scenes: {
          scene_1: {
            id: 'scene_1',
            title: 'Opening',
            purpose: '',
            visualPrompt: '',
            narration: '',
            onScreenText: '',
            mediaKind: 'image',
            durationSeconds: 5,
            referenceAssetId: null,
            selectedAssetId: null,
            assetIds: [],
            jobIds: [],
            reviewState: 'draft',
          },
        },
      }),
      1
    );
    const media = createStudioMediaStore({ store, createId: () => 'asset_mismatch' });

    await expect(
      media.persistProviderOutputFromUrl({
        projectId: 'project_1',
        sceneId: 'scene_1',
        expectedRevision: 2,
        mediaKind: 'image',
        declaredMimeType: 'image/png',
        url: 'https://media.example.test/output.png',
        downloader: {
          lookup: async () => [{ address: '8.8.8.8', family: 4 }],
          request: async () => ({
            statusCode: 200,
            headers: { 'content-type': 'image/jpeg' },
            remoteAddress: '8.8.8.8',
            body: Readable.from([png]),
          }),
        },
      })
    ).rejects.toMatchObject<Partial<CreativeStudioMediaError>>({ code: 'invalid_media' });
    expect((await store.getProject('project_1'))?.assets).toEqual({});
    const parts = await fs.readdir(path.join(rootDir, 'project_1', 'parts')).catch(() => []);
    expect(parts.filter((name) => name.endsWith('.part'))).toEqual([]);

    await expect(
      media.persistProviderOutputFromUrl({
        projectId: 'project_1',
        sceneId: 'scene_1',
        expectedRevision: 2,
        mediaKind: 'image',
        declaredMimeType: 'image/png',
        url: 'https://media.example.test/output.png',
        downloader: {
          lookup: async () => [{ address: '8.8.8.8', family: 4 }],
          request: async () => ({
            statusCode: 200,
            headers: { 'content-type': 'Image/PNG; charset=binary' },
            remoteAddress: '8.8.8.8',
            body: Readable.from([png]),
          }),
        },
      })
    ).resolves.toMatchObject({ id: 'asset_mismatch', mimeType: 'image/png' });
  });

  it('rejects an unknown-size provider URL at zero capacity before making the request', async () => {
    const { rootDir, store } = await makeStore();
    await addImageScene(store);
    const request = vi.fn(async () => ({
      statusCode: 200,
      headers: { 'content-type': 'image/png' },
      remoteAddress: '8.8.8.8',
      body: Readable.from([png]),
    }));
    const media = createStudioMediaStore({
      store,
      createId: () => 'asset_zero_url',
      getAvailableDiskBytes: async () => 0,
    });

    await expect(
      media.persistProviderOutputFromUrl({
        projectId: 'project_1',
        sceneId: 'scene_1',
        expectedRevision: 2,
        mediaKind: 'image',
        declaredMimeType: 'image/png',
        url: 'https://media.example.test/output.png',
        downloader: {
          lookup: async () => [{ address: '8.8.8.8', family: 4 }],
          request,
        },
      })
    ).rejects.toMatchObject<Partial<CreativeStudioMediaError>>({ code: 'storage_error' });
    expect(request).not.toHaveBeenCalled();
    await expect(fs.access(path.join(rootDir, 'project_1', 'parts'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('cleans the managed part and leaves no manifest asset when a provider URL stream fails', async () => {
    const { rootDir, store } = await makeStore();
    await store.updateProject(
      'project_1',
      (project) => ({
        ...project,
        sceneOrder: ['scene_1'],
        scenes: {
          scene_1: {
            id: 'scene_1',
            title: 'Opening',
            purpose: '',
            visualPrompt: '',
            narration: '',
            onScreenText: '',
            mediaKind: 'image',
            durationSeconds: 5,
            referenceAssetId: null,
            selectedAssetId: null,
            assetIds: [],
            jobIds: [],
            reviewState: 'draft',
          },
        },
      }),
      1
    );
    const media = createStudioMediaStore({ store, createId: () => 'asset_abort' });
    await expect(
      media.persistProviderOutputFromUrl({
        projectId: 'project_1',
        sceneId: 'scene_1',
        expectedRevision: 2,
        mediaKind: 'image',
        declaredMimeType: 'image/png',
        url: 'https://media.example.test/output.png',
        downloader: {
          lookup: async () => [{ address: '8.8.8.8', family: 4 }],
          request: async () => ({
            statusCode: 200,
            headers: {},
            remoteAddress: '8.8.8.8',
            body: {
              async *[Symbol.asyncIterator](): AsyncGenerator<Uint8Array> {
                yield Buffer.alloc(0);
                throw new Error('provider stream failed');
              },
            },
          }),
        },
      })
    ).rejects.toMatchObject({ code: 'remote_download_failed' });
    expect((await store.getProject('project_1'))?.assets).toEqual({});
    const parts = await fs.readdir(path.join(rootDir, 'project_1', 'parts')).catch(() => []);
    expect(parts.filter((name) => name.endsWith('.part'))).toEqual([]);
  });

  it('cleans the managed part and leaves no manifest asset when a provider URL is already aborted', async () => {
    const { rootDir, store } = await makeStore();
    await store.updateProject(
      'project_1',
      (project) => ({
        ...project,
        sceneOrder: ['scene_1'],
        scenes: {
          scene_1: {
            id: 'scene_1',
            title: 'Opening',
            purpose: '',
            visualPrompt: '',
            narration: '',
            onScreenText: '',
            mediaKind: 'image',
            durationSeconds: 5,
            referenceAssetId: null,
            selectedAssetId: null,
            assetIds: [],
            jobIds: [],
            reviewState: 'draft',
          },
        },
      }),
      1
    );
    const controller = new AbortController();
    controller.abort();
    const media = createStudioMediaStore({ store, createId: () => 'asset_abort' });
    await expect(
      media.persistProviderOutputFromUrl({
        projectId: 'project_1',
        sceneId: 'scene_1',
        expectedRevision: 2,
        mediaKind: 'image',
        declaredMimeType: 'image/png',
        url: 'https://media.example.test/output.png',
        downloader: {
          signal: controller.signal,
          lookup: async () => [{ address: '8.8.8.8', family: 4 }],
          request: async () => {
            throw new Error('must not contact');
          },
        },
      })
    ).rejects.toMatchObject({ code: 'remote_download_failed' });
    expect((await store.getProject('project_1'))?.assets).toEqual({});
    const parts = await fs.readdir(path.join(rootDir, 'project_1', 'parts')).catch(() => []);
    expect(parts.filter((name) => name.endsWith('.part'))).toEqual([]);
  });

  it('rejects a stale URL persistence plan before contacting the provider', async () => {
    const { store } = await makeStore();
    await addImageScene(store);
    const request = vi.fn();
    const media = createStudioMediaStore({ store, createId: () => 'asset_stale' });

    await expect(
      media.persistProviderOutputFromUrl({
        projectId: 'project_1',
        sceneId: 'scene_1',
        expectedRevision: 1,
        mediaKind: 'image',
        declaredMimeType: 'image/png',
        url: 'https://media.example.test/output.png',
        downloader: {
          lookup: async () => [{ address: '8.8.8.8', family: 4 }],
          request,
        },
      })
    ).rejects.toMatchObject<Partial<CreativeStudioMediaError>>({ code: 'stale_project' });
    expect(request).not.toHaveBeenCalled();
  });

  it('aborts a URL download when local persistence rejects before backpressure drains', async () => {
    const { rootDir, store } = await makeStore();
    await addImageScene(store);
    await fs.writeFile(path.join(rootDir, 'project_1', 'parts'), 'blocks the managed parts directory');
    let downloaderSignal: AbortSignal | undefined;
    const media = createStudioMediaStore({ store, createId: () => 'asset_stale' });
    const operation = media.persistProviderOutputFromUrl({
      projectId: 'project_1',
      sceneId: 'scene_1',
      expectedRevision: 2,
      mediaKind: 'image',
      declaredMimeType: 'image/png',
      url: 'https://media.example.test/output.png',
      downloader: {
        lookup: async () => [{ address: '8.8.8.8', family: 4 }],
        request: async (_target, options) => {
          downloaderSignal = options?.signal;
          return {
            statusCode: 200,
            headers: { 'content-type': 'image/png' },
            remoteAddress: '8.8.8.8',
            body: {
              async *[Symbol.asyncIterator](): AsyncGenerator<Uint8Array> {
                while (!options?.signal?.aborted) yield Buffer.alloc(64 * 1024);
              },
            },
          };
        },
      },
    });

    await expect(
      Promise.race([
        operation,
        new Promise((_, reject) => setTimeout(() => reject(new Error('deadlocked persistence')), 1_000)),
      ])
    ).rejects.toMatchObject<Partial<CreativeStudioMediaError>>({ code: 'storage_error' });
    expect(downloaderSignal?.aborted).toBe(true);
  });

  it('exports selected assets in scene order, reports gaps, and excludes internal paths', async () => {
    const { rootDir, store } = await makeStore();
    await store.updateProject(
      'project_1',
      (project) => ({
        ...project,
        sceneOrder: ['scene_1', 'scene_2'],
        scenes: {
          scene_1: {
            id: 'scene_1',
            title: 'Opening',
            purpose: '',
            visualPrompt: '',
            narration: '',
            onScreenText: '',
            mediaKind: 'image',
            durationSeconds: 2,
            referenceAssetId: null,
            selectedAssetId: null,
            assetIds: [],
            jobIds: [],
            reviewState: 'draft',
          },
          scene_2: {
            id: 'scene_2',
            title: 'Close',
            purpose: '',
            visualPrompt: '',
            narration: '',
            onScreenText: '',
            mediaKind: 'image',
            durationSeconds: 3,
            referenceAssetId: null,
            selectedAssetId: null,
            assetIds: [],
            jobIds: [],
            reviewState: 'draft',
          },
        },
      }),
      1
    );
    const media = createStudioMediaStore({ store, createId: () => 'asset_3' });
    await media.persistProviderOutput({
      projectId: 'project_1',
      sceneId: 'scene_1',
      expectedRevision: 2,
      mediaKind: 'image',
      declaredMimeType: 'image/png',
      body: Readable.from([png]),
    });
    await store.updateProject(
      'project_1',
      (project) => ({
        ...project,
        scenes: { ...project.scenes, scene_1: { ...project.scenes.scene_1, selectedAssetId: 'asset_3' } },
      }),
      3
    );
    const exportSource = await store.getProject('project_1');
    if (!exportSource) throw new Error('Export source project disappeared');
    Object.assign(exportSource.assets.asset_3, STUDIO_E2E_BOUNDARY_SENTINELS);
    vi.spyOn(store, 'getProject').mockResolvedValueOnce(exportSource);
    const destination = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-export-target-'));
    created.push(destination);

    const result = await media.exportAssetsToDirectory({
      projectId: 'project_1',
      destinationDirectory: destination,
      includeReferences: false,
      timestamp: '20260730-120000',
    });

    expect(result).toEqual({
      folderName: 'Film-20260730-120000',
      exported: [{ assetId: 'asset_3', fileName: 'scene-01-opening.png' }],
      missingSceneIds: ['scene_2'],
    });
    await expect(fs.readFile(path.join(destination, result.folderName, 'scene-01-opening.png'))).resolves.toEqual(png);
    const storyboard = await fs.readFile(path.join(destination, result.folderName, 'storyboard.json'), 'utf8');
    for (const sentinel of Object.values(STUDIO_E2E_BOUNDARY_SENTINELS)) {
      expect(storyboard).not.toContain(sentinel);
    }
    expect(storyboard).not.toContain(rootDir);
    await expect(fs.access(path.join(destination, result.folderName, 'cut.mp4'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('exports the newest verified rendered cut as cut.mp4', async () => {
    const { store } = await makeStore();
    const timestamps = ['2026-08-06T01:00:00.000Z', '2026-08-06T02:00:00.000Z'];
    const assetIds = ['render_old', 'render_new'];
    const oldCut = Buffer.concat([mp4, Buffer.from('old')]);
    const newCut = Buffer.concat([mp4, Buffer.from('newest')]);
    const media = createStudioMediaStore({
      store,
      createId: () => assetIds.shift()!,
      now: () => timestamps.shift()!,
    });
    await media.persistProjectOutput({
      projectId: 'project_1',
      declaredMimeType: 'video/mp4',
      declaredByteSize: oldCut.length,
      width: 1280,
      height: 720,
      body: Readable.from([oldCut]),
    });
    await media.persistProjectOutput({
      projectId: 'project_1',
      declaredMimeType: 'video/mp4',
      declaredByteSize: newCut.length,
      width: 1280,
      height: 720,
      body: Readable.from([newCut]),
    });
    await expect(media.getLatestProjectOutput('project_1')).resolves.toMatchObject({
      id: 'render_new',
      createdAt: '2026-08-06T02:00:00.000Z',
      sceneId: null,
    });
    const destination = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-export-rendered-cut-'));
    created.push(destination);

    const result = await media.exportAssetsToDirectory({
      projectId: 'project_1',
      destinationDirectory: destination,
      includeReferences: false,
      timestamp: '20260806-120000',
    });

    expect(result.exported).toEqual([{ assetId: 'render_new', fileName: 'cut.mp4' }]);
    await expect(fs.readFile(path.join(destination, result.folderName, 'cut.mp4'))).resolves.toEqual(newCut);
    await expect(fs.access(path.join(destination, result.folderName, 'storyboard.json'))).resolves.toBeUndefined();
  });

  it('slugifies export titles while scene numbers disambiguate empty, duplicate, and gapped names', async () => {
    expect(mediaStoreModule.buildStudioSceneExportFileName(1, 'Café Déjà Vu — Launch!!!', '.mp4')).toBe(
      'scene-01-cafe-deja-vu-launch.mp4'
    );
    expect(mediaStoreModule.buildStudioSceneExportFileName(2, '', '.mp4')).toBe('scene-02.mp4');
    expect(mediaStoreModule.buildStudioSceneExportFileName(3, 'A'.repeat(80), '.mp4')).toBe(
      `scene-03-${'a'.repeat(40)}.mp4`
    );
    const { store } = await makeStore();
    const sceneDefinitions = [
      { id: 'scene_1', title: 'Café Déjà Vu — Launch!!!' },
      { id: 'scene_2', title: 'Untitled' },
      { id: 'scene_3', title: 'Cold Open' },
      { id: 'scene_4', title: 'Missing gap' },
      { id: 'scene_5', title: 'Cold Open' },
    ];
    await store.updateProject(
      'project_1',
      (project) => ({
        ...project,
        sceneOrder: sceneDefinitions.map(({ id }) => id),
        scenes: Object.fromEntries(
          sceneDefinitions.map(({ id, title }) => [
            id,
            {
              id,
              title,
              purpose: '',
              visualPrompt: '',
              narration: '',
              onScreenText: '',
              mediaKind: 'image' as const,
              durationSeconds: 1,
              referenceAssetId: null,
              selectedAssetId: null,
              assetIds: [],
              jobIds: [],
              reviewState: 'draft' as const,
            },
          ])
        ),
      }),
      1
    );
    let assetNumber = 1;
    const media = createStudioMediaStore({
      store,
      createId: () => `asset_${assetNumber++}`,
    });
    const selectedAssetByScene: Record<string, string> = {};
    for (const sceneId of ['scene_1', 'scene_2', 'scene_3', 'scene_5']) {
      const current = await store.getProject('project_1');
      if (!current) throw new Error('Export source project disappeared');
      const persisted = await media.persistProviderOutput({
        projectId: 'project_1',
        sceneId,
        expectedRevision: current.revision,
        mediaKind: 'image',
        declaredMimeType: 'image/png',
        body: Readable.from([png]),
      });
      selectedAssetByScene[sceneId] = persisted.id;
    }
    const withAssets = await store.getProject('project_1');
    if (!withAssets) throw new Error('Export source project disappeared');
    await store.updateProject(
      'project_1',
      (project) => {
        const next = structuredClone(project);
        for (const [sceneId, assetId] of Object.entries(selectedAssetByScene)) {
          const selectedScene = next.scenes[sceneId];
          if (selectedScene !== undefined) selectedScene.selectedAssetId = assetId;
        }
        return next;
      },
      withAssets.revision
    );
    const destination = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-export-slugs-'));
    created.push(destination);

    const result = await media.exportAssetsToDirectory({
      projectId: 'project_1',
      destinationDirectory: destination,
      includeReferences: false,
      timestamp: '20260730-120000',
    });

    expect(result.exported.map(({ fileName }) => fileName)).toEqual([
      'scene-01-cafe-deja-vu-launch.png',
      'scene-02-untitled.png',
      'scene-03-cold-open.png',
      'scene-05-cold-open.png',
    ]);
    expect(result.missingSceneIds).toEqual(['scene_4']);
  });

  it('rejects an export directory swapped for a symlink before writing asset bytes', async () => {
    const { rootDir, store } = await makeStore();
    const sourcePath = path.join(rootDir, 'reference.png');
    await fs.writeFile(sourcePath, png);
    const seedMedia = createStudioMediaStore({ store, createId: () => 'asset_1' });
    await seedMedia.importReferenceFromPath({
      projectId: 'project_1',
      sourcePath,
      expectedRevision: 1,
    });
    const destination = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-export-swap-'));
    const redirected = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-export-redirected-'));
    created.push(destination, redirected);
    await fs.mkdir(path.join(redirected, 'references'));
    const exportDirectory = path.join(destination, 'Film-20260730-120000');
    const displacedDirectory = path.join(destination, 'displaced-export');
    let armed = true;
    const racingStore: CreativeStudioStore = {
      ...store,
      async getVerifiedProjectDirectory(projectId) {
        if (armed) {
          armed = false;
          await fs.rename(exportDirectory, displacedDirectory);
          await fs.symlink(redirected, exportDirectory, process.platform === 'win32' ? 'junction' : 'dir');
        }
        return store.getVerifiedProjectDirectory(projectId);
      },
    };
    const media = createStudioMediaStore({ store: racingStore });

    await expect(
      media.exportAssetsToDirectory({
        projectId: 'project_1',
        destinationDirectory: destination,
        includeReferences: true,
        timestamp: '20260730-120000',
      })
    ).rejects.toMatchObject<Partial<CreativeStudioMediaError>>({ code: 'storage_error' });
    await expect(fs.access(path.join(redirected, 'references', 'asset_1.png'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(fs.access(path.join(redirected, 'storyboard.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('returns a bounded main-only provider data URL after revalidating managed bytes', async () => {
    const { rootDir, store } = await makeStore();
    const sourcePath = path.join(rootDir, 'reference.png');
    await fs.writeFile(sourcePath, png);
    const media = createStudioMediaStore({ store, createId: () => 'asset_1' });
    await media.importReferenceFromPath({ projectId: 'project_1', sourcePath, expectedRevision: 1 });

    const providerInput = await media.resolveProviderInput('project_1', 'asset_1');
    await expect(providerInput.asDataUrl(png.length)).resolves.toMatch(/^data:image\/png;base64,/);
    await expect(providerInput.asDataUrl(png.length - 1)).rejects.toMatchObject({ code: 'invalid_media' });
  });

  it('verifies managed bytes once across subsequent range reads', async () => {
    const { rootDir, store } = await makeStore();
    const sourcePath = path.join(rootDir, 'reference.png');
    await fs.writeFile(sourcePath, png);
    const media = createStudioMediaStore({ store, createId: () => 'asset_1' });
    await media.importReferenceFromPath({ projectId: 'project_1', sourcePath, expectedRevision: 1 });
    createHashSpy.mockClear();

    for (const [start, end] of [
      [0, 7],
      [8, 15],
      [16, png.length - 1],
    ] as const) {
      const resolved = await media.resolveAsset('project_1', 'asset_1');
      expect(resolved).not.toBeNull();
      for await (const _chunk of await resolved!.openVerifiedStream(start, end)) {
        // Drain each range so its verified file handle closes before the next request.
      }
    }

    expect(createHashSpy).toHaveBeenCalledTimes(1);
  });

  it('re-verifies managed bytes when size or mtime changes on disk', async () => {
    const { rootDir, store } = await makeStore();
    const sourcePath = path.join(rootDir, 'reference.png');
    await fs.writeFile(sourcePath, png);
    const media = createStudioMediaStore({ store, createId: () => 'asset_1' });
    await media.importReferenceFromPath({ projectId: 'project_1', sourcePath, expectedRevision: 1 });
    expect(await media.resolveAsset('project_1', 'asset_1')).not.toBeNull();
    createHashSpy.mockClear();

    await fs.appendFile(path.join(rootDir, 'project_1', 'imports', 'asset_1.png'), Buffer.from([0]));

    await expect(media.resolveAsset('project_1', 'asset_1')).resolves.toBeNull();
    expect(createHashSpy).toHaveBeenCalledTimes(1);
  });

  it('drops a cached identity before returning a newly finalized asset at the same path', async () => {
    const { rootDir, store } = await makeStore();
    const sourcePath = path.join(rootDir, 'reference.png');
    await fs.writeFile(sourcePath, png);
    const media = createStudioMediaStore({ store, createId: () => 'asset_1' });
    await media.importReferenceFromPath({ projectId: 'project_1', sourcePath, expectedRevision: 1 });
    const managedPath = path.join(rootDir, 'project_1', 'imports', 'asset_1.png');
    const fixedTimestampSeconds = 1_700_000_000;
    await fs.utimes(managedPath, fixedTimestampSeconds, fixedTimestampSeconds);
    expect(await media.resolveAsset('project_1', 'asset_1')).not.toBeNull();

    await fs.unlink(managedPath);
    const replacement = Buffer.from(png);
    replacement[replacement.length - 1] ^= 0xff;
    await fs.writeFile(sourcePath, replacement);

    const replacementAsset = await media.importReferenceFromPath({
      projectId: 'project_1',
      sourcePath,
      expectedRevision: 2,
    });
    await fs.utimes(managedPath, fixedTimestampSeconds, fixedTimestampSeconds);

    await expect(media.resolveAsset('project_1', replacementAsset.id)).resolves.not.toBeNull();
  });

  it('rejects a same-size managed-byte overwrite through resolved, provider, and export consumers', async () => {
    const { rootDir, store } = await makeStore();
    const sourcePath = path.join(rootDir, 'reference.png');
    await fs.writeFile(sourcePath, png);
    const media = createStudioMediaStore({ store, createId: () => 'asset_1' });
    await media.importReferenceFromPath({ projectId: 'project_1', sourcePath, expectedRevision: 1 });
    const resolved = await media.resolveAsset('project_1', 'asset_1');
    const providerInput = await media.resolveProviderInput('project_1', 'asset_1');
    expect(resolved).not.toBeNull();

    const managedPath = path.join(rootDir, 'project_1', 'imports', 'asset_1.png');
    const replacement = Buffer.from(png);
    replacement[replacement.length - 1] ^= 0xff;
    await fs.writeFile(managedPath, replacement);

    await expect(resolved!.openVerifiedStream()).rejects.toMatchObject<Partial<CreativeStudioMediaError>>({
      code: 'storage_error',
    });
    await expect(providerInput.openStream()).rejects.toMatchObject<Partial<CreativeStudioMediaError>>({
      code: 'storage_error',
    });
    const destination = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-tampered-export-'));
    created.push(destination);
    await expect(
      media.exportAssetsToDirectory({
        projectId: 'project_1',
        destinationDirectory: destination,
        includeReferences: true,
        timestamp: '20260730-120000',
      })
    ).resolves.toMatchObject({ exported: [] });
    await expect(
      fs.access(path.join(destination, 'Film-20260730-120000', 'references', 'asset_1.png'))
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('removes only regular orphan part files from a verified project directory', async () => {
    const { rootDir, store } = await makeStore();
    const media = createStudioMediaStore({ store });
    const parts = path.join(rootDir, 'project_1', 'parts');
    await fs.mkdir(parts, { recursive: true });
    await fs.writeFile(path.join(parts, 'download.part'), 'partial');
    await fs.writeFile(path.join(parts, 'keep.txt'), 'keep');

    await media.cleanupOrphanParts();

    await expect(fs.access(path.join(parts, 'download.part'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.readFile(path.join(parts, 'keep.txt'), 'utf8')).resolves.toBe('keep');
  });
});
