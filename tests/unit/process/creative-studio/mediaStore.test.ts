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
import type {
  StudioBriefReferenceRole,
  StudioOutputRole,
  StudioProject,
  StudioProjectV2,
} from '@/common/types/project/creativeStudioTypes';
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
    if (visualPrompt.trim()) {
      next.jobs.job_1.referenceInputSnapshot = {
        sourceVisualPrompt: visualPrompt.trim(),
        conditioningReferenceAssetIds: [],
        aspectRatio: next.aspectRatio,
        resolution: next.resolution,
      };
    }
    return next;
  });
};

const seedLegacySceneCount = async (rootDir: string, store: CreativeStudioStore, count: number): Promise<void> => {
  const project = await store.getProject('project_1');
  if (project === null) throw new Error('project fixture missing');
  const legacy = structuredClone(project);
  for (let index = legacy.sceneOrder.length; index < count; index += 1) {
    const sceneId = `scene_${index + 1}`;
    legacy.sceneOrder.push(sceneId);
    legacy.scenes[sceneId] = {
      id: sceneId,
      title: `Scene ${index + 1}`,
      purpose: '',
      visualPrompt: '',
      narration: '',
      onScreenText: '',
      mediaKind: 'image',
      durationSeconds: 1,
      referenceAssetId: null,
      selectedAssetId: null,
      assetIds: [],
      jobIds: [],
      reviewState: 'draft',
    };
  }
  await fs.writeFile(path.join(rootDir, 'project_1', 'project.json'), JSON.stringify(legacy));
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

const makeStoreV2 = async (
  options: {
    mediaKind?: 'image' | 'video';
    outputRole?: StudioOutputRole;
    addSecondClip?: boolean;
  } = {}
) => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-media-v2-'));
  created.push(rootDir);
  const store = createCreativeStudioStore({
    rootDir,
    createId: () => 'project_v2',
    now: () => '2026-08-17T12:00:00.000Z',
  });
  const createdProject = await store.createProjectV2({
    name: 'Schema Two Film',
    brief: '',
    aspectRatio: '16:9',
    targetDurationSeconds: 12,
    resolution: '1080p',
  });
  const operations = [
    {
      kind: 'add_section' as const,
      sectionId: 'section_1',
      section: { title: 'Opening', storyLine: '', visualPrompt: 'A visual language inherited by the clip' },
      firstClipId: 'clip_1',
      firstClip: {
        shotPrompt: 'A precise opening frame',
        narration: '',
        onScreenText: '',
        mediaKind: options.mediaKind ?? ('image' as const),
        durationSeconds: options.mediaKind === 'video' ? 5 : 1,
        referenceAssetId: null,
      },
      beforeSectionId: null,
    },
    ...(options.addSecondClip
      ? [
          {
            kind: 'add_section' as const,
            sectionId: 'section_2',
            section: { title: 'Closing', storyLine: '', visualPrompt: '' },
            firstClipId: 'clip_2',
            firstClip: {
              shotPrompt: 'A separate closing frame',
              narration: '',
              onScreenText: '',
              mediaKind: options.mediaKind ?? ('image' as const),
              durationSeconds: options.mediaKind === 'video' ? 5 : 1,
              referenceAssetId: null,
            },
            beforeSectionId: null,
          },
        ]
      : []),
  ];
  const withClips = await store.applyMutationBatchV2({
    schemaVersion: 2,
    projectId: createdProject.id,
    expectedRevision: createdProject.revision,
    operations,
  });
  const project = await store.updateProjectV2(withClips.project.id, (current) => {
    const next = structuredClone(current);
    next.jobs.job_1 = {
      id: 'job_1',
      projectId: next.id,
      clipId: 'clip_1',
      status: 'running',
      provider: {
        providerId: 'provider_1',
        adapterId:
          options.mediaKind === 'video' && options.outputRole !== 'reference'
            ? 'weprompt-media-gateway-v1'
            : 'weprompt-image-v1',
        model: options.mediaKind === 'video' && options.outputRole !== 'reference' ? 'video-model' : 'image-model',
      },
      idempotencyKey: 'key_1',
      providerJobId: null,
      cancellationPolicy: 'none',
      ...(options.outputRole === undefined ? {} : { outputRole: options.outputRole }),
      ...(options.outputRole === 'reference'
        ? {
            referenceInputSnapshot: {
              sourceVisualPrompt: next.clips.clip_1.shotPrompt,
              conditioningReferenceAssetIds: [],
              aspectRatio: next.aspectRatio,
              resolution: next.resolution,
            },
          }
        : {}),
      outputAssetIds: [],
      error: null,
      retryOfJobId: null,
      retryReason: null,
      duplicateChargeAcknowledged: false,
      duplicateChargeAcknowledgedAt: null,
      createdAt: next.createdAt,
      updatedAt: next.updatedAt,
    };
    next.clips.clip_1.jobIds.push('job_1');
    return next;
  });
  return { rootDir, store, project };
};

const idSequence = (...ids: string[]): (() => string) => {
  let index = 0;
  return () => ids[index++] ?? `asset_${index}`;
};

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

  it('allocates a classified label against a competing reference in the CAS candidate', async () => {
    const { rootDir, store } = await makeStore();
    const sourcePath = path.join(rootDir, 'Hero.png');
    await fs.writeFile(sourcePath, png);
    const preflightProject = await store.getProject('project_1');
    if (preflightProject === null) throw new Error('project fixture missing');
    const casCandidate = structuredClone(preflightProject);
    casCandidate.assets.competing_reference = {
      id: 'competing_reference',
      projectId: 'project_1',
      sceneId: null,
      mediaKind: 'image',
      mimeType: 'image/png',
      managedAsset: { collection: 'imports', fileName: 'competing_reference.png' },
      byteSize: 1,
      sha256: 'c'.repeat(64),
      briefReferenceRole: 'look',
      briefReferenceLabel: 'Hero',
      createdAt: '2026-08-15T00:00:01.000Z',
    };
    const updateProject = vi.fn(async (_projectId, update) => update(casCandidate));
    const media = createStudioMediaStore({
      store: { ...store, getProject: vi.fn(async () => preflightProject), updateProject },
      createId: () => 'asset_cast',
    });

    const imported = await media.importReferenceFromPath({
      projectId: 'project_1',
      sourcePath,
      expectedRevision: preflightProject.revision,
      briefReferenceRole: 'cast',
      returnProject: true,
    });

    expect(imported.asset.briefReferenceLabel).toBe('Hero (2)');
    expect(imported.project.assets.asset_cast.briefReferenceLabel).toBe('Hero (2)');
  });

  it('preserves the legacy scene reference association in the manifest', async () => {
    const { rootDir, store } = await makeStore();
    await addImageScene(store);
    const project = await store.getProject('project_1');
    if (project === null) throw new Error('project fixture missing');
    const sourcePath = path.join(rootDir, 'scene-reference.png');
    await fs.writeFile(sourcePath, png);
    const media = createStudioMediaStore({ store, createId: () => 'asset_scene_reference' });

    const asset = await media.importReferenceFromPath({
      projectId: 'project_1',
      sceneId: 'scene_1',
      sourcePath,
      expectedRevision: project.revision,
    });

    expect(asset.sceneId).toBe('scene_1');
    await expect(store.getProject('project_1')).resolves.toMatchObject({
      assets: { asset_scene_reference: { sceneId: 'scene_1' } },
      scenes: {
        scene_1: {
          assetIds: ['asset_scene_reference'],
          referenceAssetId: 'asset_scene_reference',
        },
      },
    });
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

  it('never deletes a replacement part installed at the cleanup ownership boundary', async () => {
    const { rootDir, store } = await makeStore();
    const canonicalRootDir = await fs.realpath(rootDir);
    const sourcePath = path.join(rootDir, 'invalid-reference.txt');
    const replacementPath = path.join(rootDir, 'replacement-part');
    const partPath = path.join(canonicalRootDir, 'project_1', 'parts', 'asset_part_race.part');
    await fs.writeFile(sourcePath, 'not media');
    await fs.writeFile(replacementPath, 'replacement part');
    let swapped = false;
    const cleanupTargets: string[] = [];
    const media = createStudioMediaStore({
      store,
      createId: () => 'asset_part_race',
      beforeCleanupOwnership: async (target) => {
        cleanupTargets.push(target);
        if (target !== partPath) return;
        await fs.rm(partPath, { force: true });
        await fs.rename(replacementPath, partPath);
        swapped = true;
      },
    });

    await expect(
      media.importReferenceFromPath({ projectId: 'project_1', sourcePath, expectedRevision: 1 })
    ).rejects.toMatchObject({ code: 'invalid_media' });

    expect(cleanupTargets).toEqual([partPath]);
    expect(swapped).toBe(true);
    await expect(fs.readFile(partPath, 'utf8')).resolves.toBe('replacement part');
  });

  it('retains a mismatched quarantine across a replacement after no-replace restoration', async () => {
    const { rootDir, store } = await makeStore();
    const canonicalRootDir = await fs.realpath(rootDir);
    const sourcePath = path.join(rootDir, 'invalid-reference.txt');
    const replacementPath = path.join(rootDir, 'unverified-replacement-part');
    const laterOwnerPath = path.join(rootDir, 'later-owner-part');
    const partPath = path.join(canonicalRootDir, 'project_1', 'parts', 'asset_restore_race.part');
    await fs.writeFile(sourcePath, 'not media');
    await fs.writeFile(replacementPath, 'unverified replacement bytes');
    await fs.writeFile(laterOwnerPath, 'later owner bytes');
    let quarantinePath: string | null = null;
    let restorationWindowReached = false;
    const media = createStudioMediaStore({
      store,
      createId: () => 'asset_restore_race',
      beforeCleanupOwnership: async (target) => {
        if (target !== partPath) return;
        await fs.rm(partPath, { force: true });
        await fs.rename(replacementPath, partPath);
      },
      afterCleanupRestore: async (target, quarantined) => {
        if (target !== partPath) return;
        quarantinePath = quarantined;
        await fs.unlink(partPath);
        await fs.rename(laterOwnerPath, partPath);
        restorationWindowReached = true;
      },
    });

    await expect(
      media.importReferenceFromPath({ projectId: 'project_1', sourcePath, expectedRevision: 1 })
    ).rejects.toMatchObject({ code: 'invalid_media' });

    expect(restorationWindowReached).toBe(true);
    expect(quarantinePath).not.toBeNull();
    await expect(fs.readFile(partPath, 'utf8')).resolves.toBe('later owner bytes');
    await expect(fs.readFile(quarantinePath!, 'utf8')).resolves.toBe('unverified replacement bytes');
  });

  it('never deletes a final-path replacement installed after the old identity-check window', async () => {
    const { rootDir, store } = await makeStore();
    const canonicalRootDir = await fs.realpath(rootDir);
    const sourcePath = path.join(rootDir, 'reference.png');
    const replacementPath = path.join(rootDir, 'replacement-final');
    const finalPath = path.join(canonicalRootDir, 'project_1', 'imports', 'asset_final_race.png');
    await fs.writeFile(sourcePath, png);
    await fs.writeFile(replacementPath, 'replacement final');
    let cleanupReady = false;
    const staleStore: CreativeStudioStore = {
      ...store,
      async updateProject() {
        cleanupReady = true;
        throw new CreativeStudioStoreError('stale_project', 'forced stale CAS');
      },
    };
    let swapped = false;
    const cleanupTargets: string[] = [];
    const media = createStudioMediaStore({
      store: staleStore,
      createId: () => 'asset_final_race',
      beforeCleanupOwnership: async (target) => {
        cleanupTargets.push(target);
        if (target !== finalPath || !cleanupReady) return;
        await fs.rm(finalPath, { force: true });
        await fs.rename(replacementPath, finalPath);
        swapped = true;
      },
    });

    await expect(
      media.importReferenceFromPath({ projectId: 'project_1', sourcePath, expectedRevision: 1 })
    ).rejects.toMatchObject({ code: 'stale_project' });

    expect(cleanupTargets).toEqual([finalPath]);
    expect(swapped).toBe(true);
    await expect(fs.readFile(finalPath, 'utf8')).resolves.toBe('replacement final');
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

  it('commits a real generated output without rewriting or truncating a legacy 25-scene project', async () => {
    const { rootDir, store } = await makeStore();
    await addActiveImageJob(store);
    await seedLegacySceneCount(rootDir, store, 25);
    const media = createStudioMediaStore({ store, createId: () => 'asset_legacy_take' });

    const asset = await media.persistProviderOutputForJob({
      projectId: 'project_1',
      sceneId: 'scene_1',
      jobId: 'job_1',
      mediaKind: 'image',
      declaredMimeType: 'image/png',
      body: Readable.from([png]),
    });

    const project = await store.getProject('project_1');
    expect(project?.sceneOrder).toHaveLength(25);
    expect(project?.sceneOrder.at(-1)).toBe('scene_25');
    expect(project?.scenes.scene_1.selectedAssetId).toBe(asset.id);
    expect(project?.jobs.job_1).toMatchObject({ status: 'succeeded', outputAssetIds: [asset.id] });
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

  it('commits a real reference output without rewriting or truncating a legacy 25-scene project', async () => {
    const { rootDir, store } = await makeStore();
    await addActiveReferenceJob(store, 'A supporting plate');
    await seedLegacySceneCount(rootDir, store, 25);
    const media = createStudioMediaStore({ store, createId: () => 'asset_legacy_reference' });

    const asset = await media.persistProviderOutputForJob({
      projectId: 'project_1',
      sceneId: 'scene_1',
      jobId: 'job_1',
      mediaKind: 'image',
      declaredMimeType: 'image/png',
      body: Readable.from([png]),
    });

    const project = await store.getProject('project_1');
    expect(project?.sceneOrder).toHaveLength(25);
    expect(project?.sceneOrder.at(-1)).toBe('scene_25');
    expect(project?.scenes.scene_1).toMatchObject({ referenceAssetId: asset.id, selectedAssetId: null });
    expect(project?.assets[asset.id].managedAsset.collection).toBe('references');
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

  it('copies complete reference provenance from the durable job snapshot instead of current project state', async () => {
    const { store } = await makeStore();
    await addActiveReferenceJob(store, 'Original reviewed plate');
    const withSources = await addBriefReferences(store, 2);
    await store.updateProject(
      'project_1',
      (project) => {
        const next = structuredClone(project);
        next.jobs.job_1.referenceInputSnapshot = {
          sourceVisualPrompt: 'Original reviewed plate',
          conditioningReferenceAssetIds: ['brief_1', 'brief_2'],
          aspectRatio: '16:9',
          resolution: '720p',
        };
        next.scenes.scene_1.visualPrompt = 'Changed while provider was running';
        next.aspectRatio = '1:1';
        next.resolution = '1080p';
        return next;
      },
      withSources.revision
    );
    const media = createStudioMediaStore({ store, createId: () => 'asset_reference_snapshot' });

    const committed = await media.persistProviderOutputForJob({
      projectId: 'project_1',
      sceneId: 'scene_1',
      jobId: 'job_1',
      mediaKind: 'image',
      declaredMimeType: 'image/png',
      body: Readable.from([png]),
    });

    expect((await store.getProject('project_1'))?.assets[committed.id]).toMatchObject({
      sourceVisualPrompt: 'Original reviewed plate',
      sourceReferenceAssetIds: ['brief_1', 'brief_2'],
      sourceAspectRatio: '16:9',
      sourceResolution: '720p',
    });
  });

  it('retains scene-prompt fallback only for a legacy reference job without a snapshot', async () => {
    const { store } = await makeStore();
    await addActiveReferenceJob(store, '  Legacy scene prompt  ');
    await store.updateProject('project_1', (project) => {
      const next = structuredClone(project);
      delete next.jobs.job_1.referenceInputSnapshot;
      return next;
    });
    const media = createStudioMediaStore({ store, createId: () => 'asset_reference_legacy' });

    const committed = await media.persistProviderOutputForJob({
      projectId: 'project_1',
      sceneId: 'scene_1',
      jobId: 'job_1',
      mediaKind: 'image',
      declaredMimeType: 'image/png',
      body: Readable.from([png]),
    });

    expect((await store.getProject('project_1'))?.assets[committed.id]).toMatchObject({
      sourceVisualPrompt: 'Legacy scene prompt',
    });
    expect((await store.getProject('project_1'))?.assets[committed.id]).not.toHaveProperty('sourceReferenceAssetIds');
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

describe('createStudioMediaStore schema 2', () => {
  it('commits a clip-owned take, selects it, and resolves the verified bytes', async () => {
    const { store, project } = await makeStoreV2();
    const media = createStudioMediaStore({ store, createId: () => 'take_1' });

    const asset = await media.persistProviderOutputForJobV2({
      projectId: project.id,
      clipId: 'clip_1',
      jobId: 'job_1',
      mediaKind: 'image',
      declaredMimeType: 'image/png',
      declaredByteSize: png.length,
      body: Readable.from([png]),
    });

    expect(asset).toMatchObject({
      id: 'take_1',
      projectId: project.id,
      clipId: 'clip_1',
      mediaKind: 'image',
      managedAsset: { collection: 'assets', fileName: 'take_1.png' },
      sourceVisualPrompt: 'A visual language inherited by the clip\n\nA precise opening frame',
    });
    expect(asset).not.toHaveProperty('sceneId');
    const loaded = await store.getProjectV2(project.id);
    expect(loaded).toMatchObject({
      status: 'supported',
      project: {
        revision: project.revision + 1,
        clips: { clip_1: { selectedAssetId: 'take_1', assetIds: ['take_1'] } },
        jobs: { job_1: { status: 'succeeded', outputAssetIds: ['take_1'], error: null } },
      },
    });
    const resolved = await media.resolveAssetV2(project.id, asset.id);
    expect(resolved?.asset).toEqual(asset);
    const chunks: Buffer[] = [];
    for await (const chunk of await resolved!.openVerifiedStream()) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks)).toEqual(png);
  });

  it('rejects foreign-clip and wrong-kind outputs before consuming either body', async () => {
    const { rootDir, store, project } = await makeStoreV2({ addSecondClip: true });
    const media = createStudioMediaStore({ store, createId: idSequence('foreign_take', 'wrong_kind_take') });
    let consumed = 0;
    const body = async function* (bytes: Buffer): AsyncGenerator<Buffer> {
      consumed += 1;
      yield bytes;
    };

    await expect(
      media.persistProviderOutputForJobV2({
        projectId: project.id,
        clipId: 'clip_2',
        jobId: 'job_1',
        mediaKind: 'image',
        declaredMimeType: 'image/png',
        body: body(png),
      })
    ).rejects.toMatchObject({ code: 'job_inactive' });
    await expect(
      media.persistProviderOutputForJobV2({
        projectId: project.id,
        clipId: 'clip_1',
        jobId: 'job_1',
        mediaKind: 'video',
        declaredMimeType: 'video/mp4',
        body: body(mp4),
      })
    ).rejects.toMatchObject({ code: 'invalid_media' });

    expect(consumed).toBe(0);
    expect(await store.getProjectV2(project.id)).toMatchObject({
      status: 'supported',
      project: { revision: project.revision, assets: {} },
    });
    await expect(fs.access(path.join(rootDir, project.id, 'parts'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects malformed V2 provider metadata field-by-field before consuming a body', async () => {
    const { rootDir, store, project } = await makeStoreV2();
    const media = createStudioMediaStore({ store, createId: () => 'must_not_allocate' });
    const cases: Array<[string, (input: Record<string, unknown>) => void]> = [
      ['project id', (input) => (input.projectId = 'bad/project')],
      ['clip id', (input) => (input.clipId = 'bad/clip')],
      ['job id', (input) => (input.jobId = 'bad/job')],
      ['MIME type', (input) => (input.declaredMimeType = 7)],
      ['media kind', (input) => (input.mediaKind = 'audio')],
      ['fractional width', (input) => (input.width = 1.5)],
      ['zero width', (input) => (input.width = 0)],
      ['fractional height', (input) => (input.height = 1.5)],
      ['zero height', (input) => (input.height = 0)],
      ['non-finite duration', (input) => (input.durationSeconds = Number.NaN)],
      ['zero duration', (input) => (input.durationSeconds = 0)],
      ['oversized duration', (input) => (input.durationSeconds = Number.MAX_SAFE_INTEGER + 1)],
      ['fractional declared bytes', (input) => (input.declaredByteSize = 1.5)],
      ['negative declared bytes', (input) => (input.declaredByteSize = -1)],
    ];

    for (const [label, mutate] of cases) {
      let consumed = false;
      const input: Record<string, unknown> = {
        projectId: project.id,
        clipId: 'clip_1',
        jobId: 'job_1',
        mediaKind: 'image',
        declaredMimeType: 'image/png',
        body: (async function* () {
          consumed = true;
          yield png;
        })(),
      };
      mutate(input);
      // eslint-disable-next-line no-await-in-loop
      await expect(media.persistProviderOutputForJobV2(input as never), label).rejects.toMatchObject({
        code: 'invalid_media',
      });
      expect(consumed, label).toBe(false);
    }
    await expect(fs.access(path.join(rootDir, project.id, 'parts'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects malformed V2 render and captured-poster dimensions before storage access', async () => {
    const { rootDir, store, project } = await makeStoreV2();
    const media = createStudioMediaStore({ store, createId: () => 'must_not_allocate' });
    const renderCases: Array<[string, (input: Record<string, unknown>) => void]> = [
      ['project id', (input) => (input.projectId = 'bad/project')],
      ['MIME type', (input) => (input.declaredMimeType = 'image/png')],
      ['fractional width', (input) => (input.width = 1.5)],
      ['zero width', (input) => (input.width = 0)],
      ['fractional height', (input) => (input.height = 1.5)],
      ['zero height', (input) => (input.height = 0)],
      ['fractional declared bytes', (input) => (input.declaredByteSize = 1.5)],
      ['zero declared bytes', (input) => (input.declaredByteSize = 0)],
      ['non-finite duration', (input) => (input.durationSeconds = Number.NaN)],
      ['zero duration', (input) => (input.durationSeconds = 0)],
    ];
    for (const [label, mutate] of renderCases) {
      let consumed = false;
      const input: Record<string, unknown> = {
        projectId: project.id,
        declaredMimeType: 'video/mp4',
        width: 1920,
        height: 1080,
        body: (async function* () {
          consumed = true;
          yield mp4;
        })(),
      };
      mutate(input);
      // eslint-disable-next-line no-await-in-loop
      await expect(media.persistProjectOutputV2(input as never), `render ${label}`).rejects.toMatchObject({
        code: 'invalid_media',
      });
      expect(consumed, `render ${label}`).toBe(false);
    }

    const posterCases: Array<[string, (input: Record<string, unknown>) => void]> = [
      ['project id', (input) => (input.projectId = 'bad/project')],
      ['clip id', (input) => (input.clipId = 'bad/clip')],
      ['video id', (input) => (input.videoAssetId = 'bad/video')],
      ['fractional width', (input) => (input.width = 1.5)],
      ['zero width', (input) => (input.width = 0)],
      ['fractional height', (input) => (input.height = 1.5)],
      ['zero height', (input) => (input.height = 0)],
      ['fractional declared bytes', (input) => (input.declaredByteSize = 1.5)],
      ['negative declared bytes', (input) => (input.declaredByteSize = -1)],
    ];
    for (const [label, mutate] of posterCases) {
      let consumed = false;
      const input: Record<string, unknown> = {
        projectId: project.id,
        clipId: 'clip_1',
        videoAssetId: 'video_1',
        width: 640,
        height: 360,
        body: (async function* () {
          consumed = true;
          yield png;
        })(),
      };
      mutate(input);
      // eslint-disable-next-line no-await-in-loop
      await expect(media.persistCapturedPosterV2(input as never), `poster ${label}`).rejects.toMatchObject({
        code: 'invalid_media',
      });
      expect(consumed, `poster ${label}`).toBe(false);
    }
    await expect(fs.access(path.join(rootDir, project.id, 'parts'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('preserves distinct V2 context errors across every classification fence', async () => {
    const { store, project } = await makeStoreV2();
    const supported = await store.getProjectV2(project.id);
    if (supported.status !== 'supported') throw new Error('schema-2 fixture missing');
    const unsupported = { status: 'unsupported_prototype_schema' as const, projectId: project.id };
    const missing = { status: 'not_found' as const, projectId: project.id };
    const scenarios: Array<{
      label: string;
      replies: Array<typeof supported | typeof unsupported | typeof missing>;
      verifiedMissing?: boolean;
      code?: 'unsupported_prototype_schema' | 'not_found';
    }> = [
      { label: 'initial missing', replies: [missing] },
      { label: 'verified directory missing', replies: [supported], verifiedMissing: true },
      { label: 'confirmed prototype', replies: [supported, unsupported], code: 'unsupported_prototype_schema' },
      { label: 'confirmed missing', replies: [supported, missing], code: 'not_found' },
      {
        label: 'final prototype',
        replies: [supported, supported, unsupported],
        code: 'unsupported_prototype_schema',
      },
      { label: 'final missing', replies: [supported, supported, missing], code: 'not_found' },
    ];

    for (const scenario of scenarios) {
      let readIndex = 0;
      const scenarioStore: CreativeStudioStore = {
        ...store,
        async getProjectV2() {
          const reply = scenario.replies[Math.min(readIndex, scenario.replies.length - 1)]!;
          readIndex += 1;
          return reply;
        },
        getVerifiedProjectDirectoryV2: scenario.verifiedMissing
          ? async () => null
          : store.getVerifiedProjectDirectoryV2,
      };
      const result = createStudioMediaStore({ store: scenarioStore }).resolveAssetV2(project.id, 'missing_asset');
      if (scenario.code === undefined) {
        // eslint-disable-next-line no-await-in-loop
        await expect(result, scenario.label).resolves.toBeNull();
      } else {
        // eslint-disable-next-line no-await-in-loop
        await expect(result, scenario.label).rejects.toMatchObject({ code: scenario.code });
      }
    }
  });

  it('rejects V2 import race boundaries and supports the asset-only return contract', async () => {
    const { rootDir, store, project } = await makeStoreV2();
    const source = path.join(rootDir, 'import-boundaries.png');
    const videoSource = path.join(rootDir, 'import-boundaries.mp4');
    await fs.writeFile(source, png);
    await fs.writeFile(videoSource, mp4);

    await expect(
      createStudioMediaStore({ store, createId: () => 'bad/id' }).importReferenceFromPathV2({
        projectId: project.id,
        sourcePath: source,
        briefReferenceRole: 'cast',
        expectedRevision: project.revision,
      })
    ).rejects.toMatchObject({ code: 'storage_error' });
    await expect(
      createStudioMediaStore({ store, createId: () => 'stale_import' }).importReferenceFromPathV2({
        projectId: project.id,
        sourcePath: source,
        briefReferenceRole: 'cast',
        expectedRevision: project.revision + 1,
      })
    ).rejects.toMatchObject({ code: 'stale_project' });
    await expect(
      createStudioMediaStore({ store, createId: () => 'missing_clip_import' }).importReferenceFromPathV2({
        projectId: project.id,
        clipId: 'missing_clip',
        sourcePath: source,
        expectedRevision: project.revision,
      })
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(
      createStudioMediaStore({ store, createId: () => 'video_import' }).importReferenceFromPathV2({
        projectId: project.id,
        sourcePath: videoSource,
        briefReferenceRole: 'cast',
        expectedRevision: project.revision,
      })
    ).rejects.toMatchObject({ code: 'invalid_media' });

    const asset = await createStudioMediaStore({
      store,
      createId: () => 'asset_only_import',
    }).importReferenceFromPathV2({
      projectId: project.id,
      sourcePath: source,
      briefReferenceRole: 'look',
      expectedRevision: project.revision,
    });
    expect(asset).toMatchObject({ id: 'asset_only_import', projectId: project.id, clipId: null });
    expect(asset).not.toHaveProperty('project');
    expect(
      (await fs.readdir(path.join(rootDir, project.id, 'parts'))).filter((name) => name.endsWith('.part'))
    ).toEqual([]);
  });

  it('distinguishes invalid, stale, and missing V2 detach requests', async () => {
    const { rootDir, store, project } = await makeStoreV2();
    const source = path.join(rootDir, 'detach-boundaries.png');
    await fs.writeFile(source, png);
    const imported = await createStudioMediaStore({
      store,
      createId: () => 'detach_boundary',
    }).importReferenceFromPathV2({
      projectId: project.id,
      sourcePath: source,
      briefReferenceRole: 'cast',
      expectedRevision: project.revision,
      returnProject: true,
    });
    const media = createStudioMediaStore({ store });
    await expect(
      media.detachBriefReferenceV2({ projectId: 'bad/project', assetId: imported.asset.id, expectedRevision: 1 })
    ).rejects.toMatchObject({ code: 'invalid_media' });
    await expect(
      media.detachBriefReferenceV2({
        projectId: project.id,
        assetId: imported.asset.id,
        expectedRevision: imported.project.revision + 1,
      })
    ).rejects.toMatchObject({ code: 'stale_project' });
    await expect(
      media.detachBriefReferenceV2({
        projectId: project.id,
        assetId: 'missing_asset',
        expectedRevision: imported.project.revision,
      })
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('validates V2 provider-input kind, byte bounds, and refreshed content', async () => {
    const { rootDir, store, project } = await makeStoreV2();
    const canonicalRoot = await fs.realpath(rootDir);
    const media = createStudioMediaStore({ store, createId: () => 'provider_input' });
    const asset = await media.persistProviderOutputForJobV2({
      projectId: project.id,
      clipId: 'clip_1',
      jobId: 'job_1',
      mediaKind: 'image',
      declaredMimeType: 'image/png',
      body: Readable.from([png]),
    });
    const providerInput = await media.resolveProviderInputV2(project.id, asset.id);
    await expect(providerInput.asDataUrl(Number.NaN)).rejects.toMatchObject({ code: 'invalid_media' });
    await expect(providerInput.asDataUrl(asset.byteSize - 1)).rejects.toMatchObject({ code: 'invalid_media' });
    await expect(providerInput.asDataUrl(asset.byteSize)).resolves.toBe(
      `data:image/png;base64,${png.toString('base64')}`
    );
    const opened: Buffer[] = [];
    for await (const chunk of await providerInput.openStream()) opened.push(Buffer.from(chunk));
    expect(Buffer.concat(opened)).toEqual(png);
    await expect(media.resolveProviderInputV2(project.id, 'missing_asset')).rejects.toMatchObject({
      code: 'invalid_media',
    });

    const resolved = await media.resolveAssetV2(project.id, asset.id);
    const managed = path.join(canonicalRoot, project.id, 'assets', asset.managedAsset.fileName);
    const tampered = Buffer.from(png);
    tampered[tampered.length - 1] ^= 0xff;
    await fs.writeFile(managed, tampered);
    const future = new Date(Date.now() + 10_000);
    await fs.utimes(managed, future, future);
    await expect(resolved!.openVerifiedStream()).rejects.toMatchObject({ code: 'storage_error' });

    const videoFixture = await makeStoreV2({ mediaKind: 'video' });
    const video = await createStudioMediaStore({
      store: videoFixture.store,
      createId: () => 'provider_video',
    }).persistProviderOutputForJobV2({
      projectId: videoFixture.project.id,
      clipId: 'clip_1',
      jobId: 'job_1',
      mediaKind: 'video',
      declaredMimeType: 'video/mp4',
      body: Readable.from([mp4]),
    });
    await expect(
      createStudioMediaStore({ store: videoFixture.store }).resolveProviderInputV2(videoFixture.project.id, video.id)
    ).rejects.toMatchObject({ code: 'invalid_media' });
  });

  it('accepts every recoverable V2 provider status', async () => {
    for (const status of ['submitting', 'failed'] as const) {
      const { store, project } = await makeStoreV2();
      await store.updateProjectV2(project.id, (current) => {
        const next = structuredClone(current);
        next.jobs.job_1.status = status;
        next.jobs.job_1.error = status === 'failed' ? { code: 'download_failed', messageKey: 'downloadFailed' } : null;
        return next;
      });
      const asset = await createStudioMediaStore({
        store,
        createId: () => `recoverable_${status}`,
      }).persistProviderOutputForJobV2({
        projectId: project.id,
        clipId: 'clip_1',
        jobId: 'job_1',
        mediaKind: 'image',
        declaredMimeType: 'image/png',
        body: Readable.from([png]),
      });
      expect(asset.id).toBe(`recoverable_${status}`);
    }
  });

  it('rejects malformed V2 provider-poster metadata before consuming poster bytes', async () => {
    const { rootDir, store, project } = await makeStoreV2({ mediaKind: 'video' });
    const primary = await createStudioMediaStore({
      store,
      createId: () => 'poster_primary',
    }).persistProviderOutputForJobV2({
      projectId: project.id,
      clipId: 'clip_1',
      jobId: 'job_1',
      mediaKind: 'video',
      declaredMimeType: 'video/mp4',
      body: Readable.from([mp4]),
    });
    for (const [label, override] of [
      ['unsafe primary id', { primaryAssetId: 'bad/id' }],
      ['non-image MIME', { declaredMimeType: 'video/mp4' }],
    ] as const) {
      let consumed = false;
      // eslint-disable-next-line no-await-in-loop
      await expect(
        createStudioMediaStore({ store }).persistProviderPosterForJobV2({
          projectId: project.id,
          clipId: 'clip_1',
          jobId: 'job_1',
          primaryAssetId: primary.id,
          declaredMimeType: 'image/png',
          ...override,
          body: (async function* () {
            consumed = true;
            yield png;
          })(),
        }),
        label
      ).rejects.toMatchObject({ code: 'invalid_media' });
      expect(consumed, label).toBe(false);
    }
    expect(await fs.readdir(path.join(rootDir, project.id, 'thumbnails')).catch(() => [])).toEqual([]);
  });

  it('neither adopts nor deletes a replacement installed over a V2 managed writer part', async () => {
    const { rootDir, store, project } = await makeStoreV2();
    const canonicalRoot = await fs.realpath(rootDir);
    const partPath = path.join(canonicalRoot, project.id, 'parts', 'replaced_part.part');
    const replacement = path.join(canonicalRoot, 'replacement-part');
    await fs.writeFile(replacement, 'replacement bytes');
    const media = createStudioMediaStore({ store, createId: () => 'replaced_part' });

    await expect(
      media.persistProviderOutputForJobV2({
        projectId: project.id,
        clipId: 'clip_1',
        jobId: 'job_1',
        mediaKind: 'image',
        declaredMimeType: 'image/png',
        body: (async function* () {
          yield png;
          await fs.rm(partPath, { force: true });
          await fs.rename(replacement, partPath);
        })(),
      })
    ).rejects.toMatchObject({ code: 'storage_error' });

    await expect(fs.readFile(partPath, 'utf8')).resolves.toBe('replacement bytes');
    await expect(fs.access(path.join(canonicalRoot, project.id, 'assets', 'replaced_part.png'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    expect(await store.getProjectV2(project.id)).toMatchObject({
      status: 'supported',
      project: { revision: project.revision, assets: {}, jobs: { job_1: { status: 'running' } } },
    });
  });

  it('identity-cleans a failed V2 render while preserving a replacement metadata part', async () => {
    const { rootDir, store, project } = await makeStoreV2();
    const canonicalRoot = await fs.realpath(rootDir);
    const metadataPart = path.join(canonicalRoot, project.id, 'parts', 'render_race.render-v2-metadata.part');
    const replacement = path.join(canonicalRoot, 'replacement-metadata');
    await fs.writeFile(replacement, 'replacement metadata');
    let swapped = false;
    const media = createStudioMediaStore({
      store,
      createId: () => 'render_race',
      beforeV2ManagedMutation: async () => {
        if (swapped) return;
        try {
          await fs.access(metadataPart);
        } catch {
          return;
        }
        await fs.rm(metadataPart, { force: true });
        await fs.rename(replacement, metadataPart);
        swapped = true;
      },
    });

    await expect(
      media.persistProjectOutputV2({
        projectId: project.id,
        declaredMimeType: 'video/mp4',
        width: 1920,
        height: 1080,
        body: Readable.from([mp4]),
      })
    ).rejects.toMatchObject({ code: 'storage_error' });

    expect(swapped).toBe(true);
    await expect(fs.readFile(metadataPart, 'utf8')).resolves.toBe('replacement metadata');
    await expect(fs.access(path.join(canonicalRoot, project.id, 'assets', 'render_race.mp4'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(
      fs.access(path.join(canonicalRoot, project.id, 'assets', 'render_race.render-v2.json'))
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('does not consume or mutate a V1 tree swapped under captured V2 path authority', async () => {
    const { rootDir, store, project } = await makeStoreV2();
    const prototypeRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-media-prototype-swap-'));
    created.push(prototypeRoot);
    const prototypeStore = createCreativeStudioStore({
      rootDir: prototypeRoot,
      createId: () => 'prototype_1',
      now: () => '2026-08-17T12:00:00.000Z',
    });
    await prototypeStore.createProject({
      name: 'Protected prototype',
      brief: '',
      aspectRatio: '16:9',
      targetDurationSeconds: 5,
      resolution: '720p',
    });
    const canonicalRoot = await fs.realpath(rootDir);
    const v2Directory = path.join(canonicalRoot, project.id);
    const v1Directory = path.join(canonicalRoot, 'prototype_1');
    const parkedV2Directory = path.join(canonicalRoot, 'parked_v2');
    await fs.cp(path.join(prototypeRoot, 'prototype_1'), v1Directory, { recursive: true });
    await fs.copyFile(path.join(prototypeRoot, 'projects.json'), path.join(canonicalRoot, 'projects.json'));
    const sentinel = path.join(v1Directory, 'prototype-sidecar.bin');
    await fs.writeFile(sentinel, Buffer.from([0, 1, 2, 3]));
    const manifestBefore = await fs.readFile(path.join(v1Directory, 'project.json'));
    const sidecarBefore = await fs.readFile(sentinel);
    const indexBefore = await fs.readFile(path.join(canonicalRoot, 'projects.json'));
    const entriesBefore = (await fs.readdir(v1Directory)).toSorted();
    let swapped = false;
    let consumed = false;
    const media = createStudioMediaStore({
      store,
      createId: () => 'must_not_write',
      beforeV2ManagedMutation: async () => {
        if (swapped) return;
        await fs.rename(v2Directory, parkedV2Directory);
        await fs.rename(v1Directory, v2Directory);
        swapped = true;
      },
    });

    await expect(
      media.persistProviderOutputForJobV2({
        projectId: project.id,
        clipId: 'clip_1',
        jobId: 'job_1',
        mediaKind: 'image',
        declaredMimeType: 'image/png',
        body: (async function* () {
          consumed = true;
          yield png;
        })(),
      })
    ).rejects.toMatchObject({ code: 'storage_error' });

    expect(swapped).toBe(true);
    expect(consumed).toBe(false);
    expect((await fs.readdir(v2Directory)).toSorted()).toEqual(entriesBefore);
    await expect(fs.readFile(path.join(v2Directory, 'project.json'))).resolves.toEqual(manifestBefore);
    await expect(fs.readFile(path.join(v2Directory, 'prototype-sidecar.bin'))).resolves.toEqual(sidecarBefore);
    await expect(fs.readFile(path.join(canonicalRoot, 'projects.json'))).resolves.toEqual(indexBefore);
    await expect(fs.access(path.join(v2Directory, 'parts'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.access(path.join(v2Directory, 'assets'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects an in-place V2-to-V1 manifest rewrite before creating or consuming managed output', async () => {
    const { rootDir, store, project } = await makeStoreV2();
    const prototypeRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-media-prototype-manifest-'));
    created.push(prototypeRoot);
    const prototypeStore = createCreativeStudioStore({
      rootDir: prototypeRoot,
      createId: () => project.id,
      now: () => '2026-08-17T12:00:00.000Z',
    });
    await prototypeStore.createProject({
      name: 'Protected prototype',
      brief: '',
      aspectRatio: '16:9',
      targetDurationSeconds: 5,
      resolution: '720p',
    });
    const prototypeManifest = await fs.readFile(path.join(prototypeRoot, project.id, 'project.json'));
    const manifestPath = path.join(await fs.realpath(rootDir), project.id, 'project.json');
    const identityBefore = await fs.lstat(manifestPath);
    let identityAfter: Awaited<ReturnType<typeof fs.lstat>> | null = null;
    let rewritten = false;
    let consumed = false;
    const media = createStudioMediaStore({
      store,
      createId: () => 'must_not_write',
      beforeV2ManagedMutation: async () => {
        if (rewritten) return;
        await fs.writeFile(manifestPath, prototypeManifest);
        identityAfter = await fs.lstat(manifestPath);
        rewritten = true;
      },
    });

    await expect(
      media.persistProviderOutputForJobV2({
        projectId: project.id,
        clipId: 'clip_1',
        jobId: 'job_1',
        mediaKind: 'image',
        declaredMimeType: 'image/png',
        body: (async function* () {
          consumed = true;
          yield png;
        })(),
      })
    ).rejects.toMatchObject({ code: 'storage_error' });

    expect(rewritten).toBe(true);
    expect(identityAfter).not.toBeNull();
    expect(String(identityAfter!.dev)).toBe(String(identityBefore.dev));
    expect(String(identityAfter!.ino)).toBe(String(identityBefore.ino));
    expect(consumed).toBe(false);
    await expect(fs.readFile(manifestPath)).resolves.toEqual(prototypeManifest);
    await expect(fs.access(path.join(rootDir, project.id, 'parts'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.access(path.join(rootDir, project.id, 'assets'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects a same-inode rewrite to different valid V2 manifest bytes before managed output mutation', async () => {
    const { rootDir, store, project } = await makeStoreV2();
    const manifestPath = path.join(await fs.realpath(rootDir), project.id, 'project.json');
    const original = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as StudioProjectV2;
    const rewritten = { ...original, name: 'Different valid schema-two project' };
    const rewrittenBytes = Buffer.from(JSON.stringify(rewritten));
    const identityBefore = await fs.lstat(manifestPath);
    let identityAfter: Awaited<ReturnType<typeof fs.lstat>> | null = null;
    let didRewrite = false;
    let consumed = false;
    const media = createStudioMediaStore({
      store,
      createId: () => 'must_not_write_valid_rewrite',
      beforeV2ManagedMutation: async () => {
        if (didRewrite) return;
        await fs.writeFile(manifestPath, rewrittenBytes);
        identityAfter = await fs.lstat(manifestPath);
        didRewrite = true;
      },
    });

    await expect(
      media.persistProviderOutputForJobV2({
        projectId: project.id,
        clipId: 'clip_1',
        jobId: 'job_1',
        mediaKind: 'image',
        declaredMimeType: 'image/png',
        body: (async function* () {
          consumed = true;
          yield png;
        })(),
      })
    ).rejects.toMatchObject({ code: 'storage_error' });

    expect(didRewrite).toBe(true);
    expect(identityAfter).not.toBeNull();
    expect(String(identityAfter!.dev)).toBe(String(identityBefore.dev));
    expect(String(identityAfter!.ino)).toBe(String(identityBefore.ino));
    expect(consumed).toBe(false);
    await expect(fs.readFile(manifestPath)).resolves.toEqual(rewrittenBytes);
    await expect(store.getProjectV2(project.id)).resolves.toMatchObject({
      status: 'supported',
      project: { id: project.id, name: rewritten.name },
    });
    await expect(fs.access(path.join(rootDir, project.id, 'parts'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.access(path.join(rootDir, project.id, 'assets'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.each(['parts', 'assets'] as const)(
    'rejects a bound %s directory replacement before opening the V2 writer',
    async (directoryName) => {
      const { rootDir, store, project } = await makeStoreV2();
      const canonicalRoot = await fs.realpath(rootDir);
      const projectDirectory = path.join(canonicalRoot, project.id);
      const managedDirectory = path.join(projectDirectory, directoryName);
      const parkedDirectory = path.join(projectDirectory, `${directoryName}-parked`);
      const replacementDirectory = path.join(canonicalRoot, `${directoryName}-replacement`);
      await fs.mkdir(replacementDirectory);
      const sentinel = path.join(replacementDirectory, 'owned-elsewhere.bin');
      await fs.writeFile(sentinel, Buffer.from([9, 8, 7, 6]));
      const manifestBefore = await fs.readFile(path.join(projectDirectory, 'project.json'));
      let swapped = false;
      let consumed = false;
      const media = createStudioMediaStore({
        store,
        createId: () => `swapped_${directoryName}`,
        beforeV2ManagedMutation: async () => {
          if (swapped) return;
          try {
            const stats = await fs.lstat(managedDirectory);
            if (!stats.isDirectory()) return;
          } catch {
            return;
          }
          await fs.rename(managedDirectory, parkedDirectory);
          await fs.rename(replacementDirectory, managedDirectory);
          swapped = true;
        },
      });

      await expect(
        media.persistProviderOutputForJobV2({
          projectId: project.id,
          clipId: 'clip_1',
          jobId: 'job_1',
          mediaKind: 'image',
          declaredMimeType: 'image/png',
          body: (async function* () {
            consumed = true;
            yield png;
          })(),
        })
      ).rejects.toMatchObject({ code: 'storage_error' });

      expect(swapped).toBe(true);
      expect(consumed).toBe(false);
      await expect(fs.readFile(path.join(managedDirectory, 'owned-elsewhere.bin'))).resolves.toEqual(
        Buffer.from([9, 8, 7, 6])
      );
      expect(await fs.readdir(managedDirectory)).toEqual(['owned-elsewhere.bin']);
      await expect(fs.readFile(path.join(projectDirectory, 'project.json'))).resolves.toEqual(manifestBefore);
    }
  );

  it('freshly identity-cleans a linked V2 output when the post-link authority fence fails', async () => {
    const { rootDir, store, project } = await makeStoreV2();
    const canonicalRoot = await fs.realpath(rootDir);
    const finalPath = path.join(canonicalRoot, project.id, 'assets', 'post_link_race.png');
    const partPath = path.join(canonicalRoot, project.id, 'parts', 'post_link_race.part');
    let raced = false;
    const media = createStudioMediaStore({
      store,
      createId: () => 'post_link_race',
      beforeV2ManagedMutation: async () => {
        if (raced) return;
        try {
          await fs.access(finalPath);
        } catch {
          return;
        }
        raced = true;
        await store.updateProjectV2(project.id, (current) => ({ ...current, name: 'Concurrent valid edit' }));
      },
    });

    await expect(
      media.persistProviderOutputForJobV2({
        projectId: project.id,
        clipId: 'clip_1',
        jobId: 'job_1',
        mediaKind: 'image',
        declaredMimeType: 'image/png',
        body: Readable.from([png]),
      })
    ).rejects.toMatchObject({ code: 'storage_error' });

    expect(raced).toBe(true);
    await expect(fs.access(partPath)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.access(finalPath)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await store.getProjectV2(project.id)).toMatchObject({
      status: 'supported',
      project: { revision: project.revision + 1, name: 'Concurrent valid edit', assets: {} },
    });
  });

  it('freshly identity-cleans linked render metadata and video after a post-link authority failure', async () => {
    const { rootDir, store, project } = await makeStoreV2();
    const canonicalRoot = await fs.realpath(rootDir);
    const assetsDirectory = path.join(canonicalRoot, project.id, 'assets');
    const partsDirectory = path.join(canonicalRoot, project.id, 'parts');
    const metadataPath = path.join(assetsDirectory, 'metadata_link_race.render-v2.json');
    let raced = false;
    const media = createStudioMediaStore({
      store,
      createId: () => 'metadata_link_race',
      beforeV2ManagedMutation: async () => {
        if (raced) return;
        try {
          await fs.access(metadataPath);
        } catch {
          return;
        }
        raced = true;
        await store.updateProjectV2(project.id, (current) => ({ ...current, name: 'Concurrent render edit' }));
      },
    });

    await expect(
      media.persistProjectOutputV2({
        projectId: project.id,
        declaredMimeType: 'video/mp4',
        width: 1920,
        height: 1080,
        body: Readable.from([mp4]),
      })
    ).rejects.toMatchObject({ code: 'storage_error' });

    expect(raced).toBe(true);
    await expect(fs.access(path.join(assetsDirectory, 'metadata_link_race.mp4'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(fs.access(metadataPath)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(
      fs.access(path.join(partsDirectory, 'metadata_link_race.render-v2-metadata.part'))
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('freshly cleans an uncommitted V2 import after a concurrent valid manifest CAS', async () => {
    const { rootDir, store, project } = await makeStoreV2();
    const source = path.join(rootDir, 'stale-import-source.png');
    await fs.writeFile(source, png);
    const concurrentStore: CreativeStudioStore = {
      ...store,
      async updateProjectV2(projectId) {
        await store.updateProjectV2(projectId, (current) => ({ ...current, name: 'Concurrent import edit' }));
        throw new CreativeStudioStoreError('stale_project', 'forced concurrent V2 CAS');
      },
    };
    const media = createStudioMediaStore({ store: concurrentStore, createId: () => 'stale_import_v2' });

    await expect(
      media.importReferenceFromPathV2({
        projectId: project.id,
        sourcePath: source,
        briefReferenceRole: 'cast',
        expectedRevision: project.revision,
      })
    ).rejects.toMatchObject({ code: 'stale_project' });

    await expect(fs.readFile(source)).resolves.toEqual(png);
    await expect(fs.access(path.join(rootDir, project.id, 'parts', 'stale_import_v2.part'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(fs.access(path.join(rootDir, project.id, 'imports', 'stale_import_v2.png'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    expect(await store.getProjectV2(project.id)).toMatchObject({
      status: 'supported',
      project: { revision: project.revision + 1, name: 'Concurrent import edit', assets: {} },
    });
  });

  it('preserves a finalized uncommitted output when a cleanup-fence CAS claims its exact asset', async () => {
    const { rootDir, store, project } = await makeStoreV2();
    const canonicalRoot = await fs.realpath(rootDir);
    const finalPath = path.join(canonicalRoot, project.id, 'assets', 'cleanup_owned_output.png');
    const partPath = path.join(canonicalRoot, project.id, 'parts', 'cleanup_owned_output.part');
    let stagedProject: StudioProjectV2 | null = null;
    let commitAttempted = false;
    let raced = false;
    const staleStore: CreativeStudioStore = {
      ...store,
      async updateProjectV2(projectId, update) {
        const loaded = await store.getProjectV2(projectId);
        if (loaded.status !== 'supported') throw new Error('schema-2 fixture missing');
        stagedProject = update(structuredClone(loaded.project));
        commitAttempted = true;
        throw new CreativeStudioStoreError('stale_project', 'forced stale CAS');
      },
    };
    const media = createStudioMediaStore({
      store: staleStore,
      createId: () => 'cleanup_owned_output',
      beforeCleanupOwnership: async (target) => {
        if (!commitAttempted || raced || target !== finalPath || stagedProject === null) return;
        raced = true;
        const claimed = structuredClone(stagedProject);
        await store.updateProjectV2(project.id, () => claimed);
      },
    });

    await expect(
      media.persistProviderOutputForJobV2({
        projectId: project.id,
        clipId: 'clip_1',
        jobId: 'job_1',
        mediaKind: 'image',
        declaredMimeType: 'image/png',
        body: Readable.from([png]),
      })
    ).rejects.toMatchObject({ code: 'stale_project' });

    expect(commitAttempted).toBe(true);
    expect(raced).toBe(true);
    await expect(fs.readFile(finalPath)).resolves.toEqual(png);
    await expect(fs.access(partPath)).rejects.toMatchObject({ code: 'ENOENT' });
    const loaded = await store.getProjectV2(project.id);
    expect(loaded).toMatchObject({
      status: 'supported',
      project: {
        revision: project.revision + 1,
        assets: { cleanup_owned_output: { id: 'cleanup_owned_output' } },
        clips: {
          clip_1: { selectedAssetId: 'cleanup_owned_output', assetIds: ['cleanup_owned_output'] },
        },
        jobs: { job_1: { status: 'succeeded', outputAssetIds: ['cleanup_owned_output'] } },
      },
    });
  });

  it('returns a committed V2 detach while a later revision lands before best-effort cleanup', async () => {
    const { rootDir, store, project } = await makeStoreV2();
    const source = path.join(rootDir, 'detach-later-revision.png');
    await fs.writeFile(source, png);
    const imported = await createStudioMediaStore({ store, createId: () => 'detach_later' }).importReferenceFromPathV2({
      projectId: project.id,
      sourcePath: source,
      briefReferenceRole: 'look',
      expectedRevision: project.revision,
      returnProject: true,
    });
    let laterRevision = 0;
    const racingStore: CreativeStudioStore = {
      ...store,
      async updateProjectV2(projectId, update, expectedRevision, commitTag) {
        const detached = await store.updateProjectV2(projectId, update, expectedRevision, commitTag);
        const later = await store.updateProjectV2(projectId, (current) => ({ ...current, name: 'Later valid edit' }));
        laterRevision = later.revision;
        return detached;
      },
    };

    const detached = await createStudioMediaStore({ store: racingStore }).detachBriefReferenceV2({
      projectId: project.id,
      assetId: imported.asset.id,
      expectedRevision: imported.project.revision,
    });

    expect(detached.revision).toBe(imported.project.revision + 1);
    expect(laterRevision).toBe(detached.revision + 1);
    await expect(fs.readFile(source)).resolves.toEqual(png);
    await expect(fs.access(path.join(rootDir, project.id, 'imports', 'detach_later.png'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    expect(await store.getProjectV2(project.id)).toMatchObject({
      status: 'supported',
      project: { revision: laterRevision, name: 'Later valid edit', assets: {} },
    });
  });

  it('preserves a detached managed import when a cleanup-fence CAS reclaims the exact asset', async () => {
    const { rootDir, store, project } = await makeStoreV2();
    const source = path.join(rootDir, 'detach-reclaimed-source.png');
    await fs.writeFile(source, png);
    const imported = await createStudioMediaStore({
      store,
      createId: () => 'detach_reclaimed',
    }).importReferenceFromPathV2({
      projectId: project.id,
      sourcePath: source,
      briefReferenceRole: 'cast',
      expectedRevision: project.revision,
      returnProject: true,
    });
    const managed = path.join(await fs.realpath(rootDir), project.id, 'imports', 'detach_reclaimed.png');
    const detachedAsset = structuredClone(imported.asset);
    let detachCommitted = false;
    let cleanupHookCalls = 0;
    const detachingStore: CreativeStudioStore = {
      ...store,
      async updateProjectV2(projectId, update, expectedRevision, commitTag) {
        const detached = await store.updateProjectV2(projectId, update, expectedRevision, commitTag);
        detachCommitted = true;
        return detached;
      },
    };
    const media = createStudioMediaStore({
      store: detachingStore,
      beforeCleanupOwnership: async (target) => {
        if (!detachCommitted || target !== managed || cleanupHookCalls > 0) return;
        cleanupHookCalls += 1;
        await store.updateProjectV2(project.id, (current) => {
          const next = structuredClone(current);
          next.assets[detachedAsset.id] = detachedAsset;
          return next;
        });
      },
    });

    const detached = await media.detachBriefReferenceV2({
      projectId: project.id,
      assetId: detachedAsset.id,
      expectedRevision: imported.project.revision,
    });

    expect(Object.hasOwn(detached.assets, detachedAsset.id)).toBe(false);
    expect(cleanupHookCalls).toBe(1);
    await expect(fs.readFile(managed)).resolves.toEqual(png);
    await expect(fs.readFile(source)).resolves.toEqual(png);
    expect(await store.getProjectV2(project.id)).toMatchObject({
      status: 'supported',
      project: {
        revision: detached.revision + 1,
        assets: { detach_reclaimed: detachedAsset },
      },
    });
  });

  it('commits a reference plate without selecting it and preserves the frozen request provenance', async () => {
    const { store, project } = await makeStoreV2({ mediaKind: 'video', outputRole: 'reference' });
    const media = createStudioMediaStore({ store, createId: () => 'plate_1' });

    const asset = await media.persistProviderOutputForJobV2({
      projectId: project.id,
      clipId: 'clip_1',
      jobId: 'job_1',
      mediaKind: 'image',
      declaredMimeType: 'image/png',
      body: Readable.from([png]),
    });

    expect(asset).toMatchObject({
      clipId: 'clip_1',
      managedAsset: { collection: 'references' },
      sourceVisualPrompt: 'A precise opening frame',
      sourceReferenceAssetIds: [],
      sourceAspectRatio: '16:9',
      sourceResolution: '1080p',
    });
    expect(await store.getProjectV2(project.id)).toMatchObject({
      status: 'supported',
      project: {
        clips: { clip_1: { referenceAssetId: 'plate_1', selectedAssetId: null, assetIds: ['plate_1'] } },
        jobs: { job_1: { status: 'succeeded', outputAssetIds: ['plate_1'] } },
      },
    });
  });

  it('imports a clip-owned reference without classifying it as a project-level Cast or Look', async () => {
    const { rootDir, store, project } = await makeStoreV2();
    const source = path.join(rootDir, 'clip-reference.png');
    await fs.writeFile(source, png);
    const media = createStudioMediaStore({ store, createId: () => 'clip_reference_1' });

    const imported = await media.importReferenceFromPathV2({
      projectId: project.id,
      clipId: 'clip_1',
      sourcePath: source,
      expectedRevision: project.revision,
      returnProject: true,
    });

    expect(imported.asset).toMatchObject({
      id: 'clip_reference_1',
      projectId: project.id,
      clipId: 'clip_1',
      mediaKind: 'image',
      managedAsset: { collection: 'imports', fileName: 'clip_reference_1.png' },
    });
    expect(imported.asset).not.toHaveProperty('briefReferenceRole');
    expect(imported.asset).not.toHaveProperty('briefReferenceLabel');
    expect(imported.project.clips.clip_1).toMatchObject({
      referenceAssetId: 'clip_reference_1',
      selectedAssetId: null,
      assetIds: ['clip_reference_1'],
    });
    await expect(fs.readFile(source)).resolves.toEqual(png);
    await expect(fs.readFile(path.join(rootDir, project.id, 'imports', 'clip_reference_1.png'))).resolves.toEqual(png);
  });

  it('attaches a provider poster to its exact video lineage without replacing a newer selection', async () => {
    const { store, project } = await makeStoreV2({ mediaKind: 'video', addSecondClip: true });
    const media = createStudioMediaStore({ store, createId: idSequence('video_1', 'poster_1') });
    const primary = await media.persistProviderOutputForJobV2({
      projectId: project.id,
      clipId: 'clip_1',
      jobId: 'job_1',
      mediaKind: 'video',
      declaredMimeType: 'video/mp4',
      body: Readable.from([mp4]),
    });
    let foreignBodyConsumed = false;
    await expect(
      media.persistProviderPosterForJobV2({
        projectId: project.id,
        clipId: 'clip_2',
        jobId: 'job_1',
        primaryAssetId: primary.id,
        declaredMimeType: 'image/png',
        body: (async function* () {
          foreignBodyConsumed = true;
          yield png;
        })(),
      })
    ).rejects.toMatchObject({ code: 'job_inactive' });
    expect(foreignBodyConsumed).toBe(false);
    await store.updateProjectV2(project.id, (current) => {
      const next = structuredClone(current);
      next.assets.newer_take = {
        ...primary,
        id: 'newer_take',
        managedAsset: { collection: 'assets', fileName: 'newer_take.mp4' },
        createdAt: '2026-08-17T12:00:01.000Z',
      };
      next.clips.clip_1.assetIds.push('newer_take');
      next.clips.clip_1.selectedAssetId = 'newer_take';
      return next;
    });

    const poster = await media.persistProviderPosterForJobV2({
      projectId: project.id,
      clipId: 'clip_1',
      jobId: 'job_1',
      primaryAssetId: primary.id,
      declaredMimeType: 'image/png',
      body: Readable.from([png]),
    });

    expect(poster).toMatchObject({
      id: 'poster_1',
      clipId: 'clip_1',
      mediaKind: 'image',
      managedAsset: { collection: 'thumbnails' },
    });
    expect(await store.getProjectV2(project.id)).toMatchObject({
      status: 'supported',
      project: {
        clips: { clip_1: { selectedAssetId: 'newer_take', assetIds: ['video_1', 'newer_take', 'poster_1'] } },
        jobs: { job_1: { outputAssetIds: ['video_1', 'poster_1'] } },
      },
    });
  });

  it('persists and resolves a V2 project render through its versioned sidecar only', async () => {
    const { rootDir, store, project } = await makeStoreV2();
    const media = createStudioMediaStore({ store, createId: () => 'render_1' });

    const output = await media.persistProjectOutputV2({
      projectId: project.id,
      declaredMimeType: 'video/mp4',
      declaredByteSize: mp4.length,
      width: 1920,
      height: 1080,
      durationSeconds: 5.5,
      body: Readable.from([mp4]),
    });

    expect(output).toMatchObject({
      id: 'render_1',
      clipId: null,
      mediaKind: 'video',
      managedAsset: { collection: 'assets', fileName: 'render_1.mp4' },
    });
    await expect(media.getLatestProjectOutputV2(project.id)).resolves.toEqual(output);
    await expect(
      fs.access(path.join(rootDir, project.id, 'assets', 'render_1.render-v2.json'))
    ).resolves.toBeUndefined();
    await expect(fs.access(path.join(rootDir, project.id, 'assets', 'render_1.render.json'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    expect(await store.getProjectV2(project.id)).toMatchObject({
      status: 'supported',
      project: { revision: project.revision, assets: {} },
    });
  });

  it('captures a poster only while exactly one succeeded take job owns the selected video', async () => {
    const { store, project } = await makeStoreV2({ mediaKind: 'video' });
    const media = createStudioMediaStore({ store, createId: idSequence('video_1', 'captured_1', 'captured_2') });
    const primary = await media.persistProviderOutputForJobV2({
      projectId: project.id,
      clipId: 'clip_1',
      jobId: 'job_1',
      mediaKind: 'video',
      declaredMimeType: 'video/mp4',
      body: Readable.from([mp4]),
    });
    const captured = await media.persistCapturedPosterV2({
      projectId: project.id,
      clipId: 'clip_1',
      videoAssetId: primary.id,
      width: 640,
      height: 360,
      declaredByteSize: png.length,
      body: Readable.from([png]),
    });
    expect(captured).toMatchObject({
      id: 'captured_1',
      clipId: 'clip_1',
      managedAsset: { collection: 'thumbnails' },
    });
    let consumed = false;
    await expect(
      media.persistCapturedPosterV2({
        projectId: project.id,
        clipId: 'clip_1',
        videoAssetId: primary.id,
        width: 640,
        height: 360,
        body: (async function* () {
          consumed = true;
          yield png;
        })(),
      })
    ).rejects.toMatchObject({ code: 'job_inactive' });
    expect(consumed).toBe(false);
    expect(await store.getProjectV2(project.id)).toMatchObject({
      status: 'supported',
      project: { jobs: { job_1: { outputAssetIds: ['video_1', 'captured_1'] } } },
    });
  });

  it('classifies six project-level references, rejects the seventh, and supports magic own IDs', async () => {
    const { rootDir, store, project } = await makeStoreV2();
    const sources = await Promise.all(
      Array.from({ length: 7 }, async (_, index) => {
        const source = path.join(rootDir, `Cast ${index + 1}.png`);
        await fs.writeFile(source, png);
        return source;
      })
    );
    const media = createStudioMediaStore({
      store,
      createId: idSequence('__proto__', 'brief_2', 'brief_3', 'brief_4', 'brief_5', 'brief_6', 'brief_7'),
    });
    await expect(
      media.importReferenceFromPathV2({
        projectId: project.id,
        sourcePath: sources[0]!,
        expectedRevision: project.revision,
      })
    ).rejects.toMatchObject({ code: 'invalid_media' });
    let revision = project.revision;
    for (let index = 0; index < 6; index += 1) {
      // eslint-disable-next-line no-await-in-loop
      const imported = await media.importReferenceFromPathV2({
        projectId: project.id,
        sourcePath: sources[index]!,
        briefReferenceRole: 'cast',
        expectedRevision: revision,
        returnProject: true,
      });
      revision = imported.project.revision;
    }

    const loaded = await store.getProjectV2(project.id);
    expect(loaded.status).toBe('supported');
    if (loaded.status !== 'supported') throw new Error('schema-2 fixture missing');
    expect(Object.keys(loaded.project.assets)).toHaveLength(6);
    expect(Object.hasOwn(loaded.project.assets, '__proto__')).toBe(true);
    await expect(
      media.importReferenceFromPathV2({
        projectId: project.id,
        sourcePath: sources[6]!,
        briefReferenceRole: 'look',
        expectedRevision: revision,
      })
    ).rejects.toMatchObject({ code: 'invalid_media' });
    await expect(fs.access(path.join(rootDir, project.id, 'imports', 'brief_7.png'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('detaches only the managed copy, preserves the source, and restarts with a valid manifest', async () => {
    const { rootDir, store, project } = await makeStoreV2();
    const source = path.join(rootDir, 'source-cast.png');
    await fs.writeFile(source, png);
    const media = createStudioMediaStore({ store, createId: () => 'brief_1' });
    const imported = await media.importReferenceFromPathV2({
      projectId: project.id,
      sourcePath: source,
      briefReferenceRole: 'cast',
      expectedRevision: project.revision,
      returnProject: true,
    });
    const managed = path.join(rootDir, project.id, 'imports', 'brief_1.png');

    const detached = await media.detachBriefReferenceV2({
      projectId: project.id,
      assetId: 'brief_1',
      expectedRevision: imported.project.revision,
    });

    expect(Object.hasOwn(detached.assets, 'brief_1')).toBe(false);
    await expect(fs.readFile(source)).resolves.toEqual(png);
    await expect(fs.access(managed)).rejects.toMatchObject({ code: 'ENOENT' });
    const restarted = createCreativeStudioStore({ rootDir });
    await expect(restarted.getProjectV2(project.id)).resolves.toMatchObject({
      status: 'supported',
      project: { revision: detached.revision, assets: {} },
    });
  });

  it('commits a V2 detach when its managed import directory is already absent', async () => {
    const { rootDir, store, project } = await makeStoreV2();
    const source = path.join(rootDir, 'missing-managed-look.png');
    await fs.writeFile(source, png);
    const media = createStudioMediaStore({ store, createId: () => 'missing_managed' });
    const imported = await media.importReferenceFromPathV2({
      projectId: project.id,
      sourcePath: source,
      briefReferenceRole: 'look',
      expectedRevision: project.revision,
      returnProject: true,
    });
    await fs.rm(path.join(rootDir, project.id, 'imports'), { recursive: true });

    const detached = await media.detachBriefReferenceV2({
      projectId: project.id,
      assetId: imported.asset.id,
      expectedRevision: imported.project.revision,
    });

    expect(Object.hasOwn(detached.assets, imported.asset.id)).toBe(false);
    await expect(fs.readFile(source)).resolves.toEqual(png);
  });

  it('preserves a replacement installed at the detach cleanup ownership boundary', async () => {
    const { rootDir, store, project } = await makeStoreV2();
    const source = path.join(rootDir, 'source-look.png');
    const replacement = path.join(rootDir, 'replacement-import');
    await fs.writeFile(source, png);
    await fs.writeFile(replacement, 'replacement owned elsewhere');
    const canonicalRoot = await fs.realpath(rootDir);
    const managed = path.join(canonicalRoot, project.id, 'imports', 'brief_1.png');
    const media = createStudioMediaStore({
      store,
      createId: () => 'brief_1',
      beforeCleanupOwnership: async (target) => {
        if (target !== managed) return;
        await fs.rm(target, { force: true });
        await fs.rename(replacement, target);
      },
    });
    const imported = await media.importReferenceFromPathV2({
      projectId: project.id,
      sourcePath: source,
      briefReferenceRole: 'look',
      expectedRevision: project.revision,
      returnProject: true,
    });

    await media.detachBriefReferenceV2({
      projectId: project.id,
      assetId: 'brief_1',
      expectedRevision: imported.project.revision,
    });

    await expect(fs.readFile(managed, 'utf8')).resolves.toBe('replacement owned elsewhere');
    await expect(fs.readFile(source)).resolves.toEqual(png);
    expect(await store.getProjectV2(project.id)).toMatchObject({ status: 'supported', project: { assets: {} } });
  });

  it('cleans only schema-2 regular parts and leaves prototype storage untouched', async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-media-v2-cleanup-'));
    created.push(rootDir);
    const store = createCreativeStudioStore({
      rootDir,
      createId: idSequence('prototype_1', 'project_v2'),
      now: () => '2026-08-17T12:00:00.000Z',
    });
    await store.createProject({
      name: 'Prototype',
      brief: '',
      aspectRatio: '16:9',
      targetDurationSeconds: 5,
      resolution: '720p',
    });
    await store.createProjectV2({
      name: 'Schema Two',
      brief: '',
      aspectRatio: '16:9',
      targetDurationSeconds: 5,
      resolution: '720p',
    });
    const canonicalRoot = await fs.realpath(rootDir);
    const prototypeParts = path.join(canonicalRoot, 'prototype_1', 'parts');
    const v2Parts = path.join(canonicalRoot, 'project_v2', 'parts');
    const racedPart = path.join(v2Parts, 'raced.part');
    const replacement = path.join(rootDir, 'replacement-part');
    await fs.mkdir(prototypeParts);
    await fs.mkdir(v2Parts);
    await fs.writeFile(path.join(prototypeParts, 'prototype.part'), 'prototype');
    await fs.writeFile(path.join(v2Parts, 'orphan.part'), 'partial');
    await fs.writeFile(racedPart, 'old partial');
    await fs.writeFile(replacement, 'replacement partial');
    await fs.writeFile(path.join(v2Parts, 'keep.txt'), 'keep');

    await createStudioMediaStore({
      store,
      beforeCleanupOwnership: async (target) => {
        if (target !== racedPart) return;
        await fs.rm(target, { force: true });
        await fs.rename(replacement, target);
      },
    }).cleanupOrphanPartsV2();

    await expect(fs.readFile(path.join(prototypeParts, 'prototype.part'), 'utf8')).resolves.toBe('prototype');
    await expect(fs.access(path.join(v2Parts, 'orphan.part'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.readFile(racedPart, 'utf8')).resolves.toBe('replacement partial');
    await expect(fs.readFile(path.join(v2Parts, 'keep.txt'), 'utf8')).resolves.toBe('keep');
  });
});
