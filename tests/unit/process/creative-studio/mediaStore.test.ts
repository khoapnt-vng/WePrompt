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
  StudioAssetV2,
  StudioBriefReferenceRole,
  StudioGenerationRequestPlan,
  StudioJobV2,
  StudioProject,
  StudioProjectV2,
  StudioQuotedGeneration,
  StudioSpendAuthorization,
} from '@/common/types/project/creativeStudioTypes';
import { STUDIO_E2E_BOUNDARY_SENTINELS } from '@process/services/creative-studio/adapters/e2eFakeAdapter';
import {
  createCreativeStudioStore,
  CreativeStudioStoreError,
  type CreativeStudioStore,
} from '@process/services/creative-studio/store';
import {
  calculateStudioQuoteTotals,
  createStudioFrameExtractionId,
  createStudioQuotedGenerationId,
} from '@process/services/creative-studio/service/schema2/generation';
import { createStudioSpendReceiptV2 } from '@process/services/creative-studio/service/schema2/pricing';
import { StudioConditioningFrameError } from '@process/services/creative-studio/adapters/conditioningFrame';
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
    purpose?: StudioJobV2['purpose'];
    addSecondShot?: boolean;
    includeAuthorizedJob?: boolean;
    briefReference?: boolean;
    adapterId?: StudioJobV2['provider']['adapterId'];
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
  const authored = await store.updateProjectV2(createdProject.id, (current) => ({
    ...current,
    beatOrder: options.addSecondShot ? ['beat_1', 'beat_2'] : ['beat_1'],
    beats: {
      beat_1: {
        id: 'beat_1',
        title: 'Opening',
        action: '',
        look: 'A visual language inherited by the shot',
        actionRevision: 1,
        targetSeconds: null,
        shotOrder: ['shot_1'],
        lineHistory: [],
      },
      ...(options.addSecondShot
        ? {
            beat_2: {
              id: 'beat_2',
              title: 'Closing',
              action: '',
              look: '',
              actionRevision: 1,
              targetSeconds: null,
              shotOrder: ['shot_2'],
              lineHistory: [],
            },
          }
        : {}),
    },
    shots: {
      shot_1: {
        id: 'shot_1',
        line: 'A precise opening frame',
        derivation: 'derived',
        derivedFromActionRevision: 1,
        narration: '',
        onScreenText: '',
        durationSeconds: 5,
        trimInSeconds: null,
        trimOutSeconds: null,
        chainBreak: 'none',
        seedStillId: null,
        selectedTakeId: null,
        assetIds: [],
        jobIds: [],
      },
      ...(options.addSecondShot
        ? {
            shot_2: {
              id: 'shot_2',
              line: 'A separate closing frame',
              derivation: 'derived' as const,
              derivedFromActionRevision: 1,
              narration: '',
              onScreenText: '',
              durationSeconds: 5,
              trimInSeconds: null,
              trimOutSeconds: null,
              chainBreak: 'none' as const,
              seedStillId: null,
              selectedTakeId: null,
              assetIds: [],
              jobIds: [],
            },
          }
        : {}),
    },
  }));
  let quoteBase = authored;
  const purpose = options.purpose ?? 'seed_still';
  if (purpose === 'video_take' || options.briefReference) {
    const importsDirectory = path.join(rootDir, authored.id, 'imports');
    await fs.mkdir(importsDirectory, { recursive: true });
    if (purpose === 'video_take') await fs.writeFile(path.join(importsDirectory, 'seed_v2.png'), png);
    if (options.briefReference) await fs.writeFile(path.join(importsDirectory, 'brief_v2.png'), png);
    quoteBase = await store.updateProjectV2(authored.id, (current) => {
      if (purpose === 'video_take') {
        current.assets.seed_v2 = {
          id: 'seed_v2',
          projectId: current.id,
          shotId: 'shot_1',
          mediaKind: 'image',
          mimeType: 'image/png',
          managedAsset: { collection: 'imports', fileName: 'seed_v2.png' },
          byteSize: png.length,
          sha256: createHash('sha256').update(png).digest('hex'),
          createdAt: current.updatedAt,
        };
        current.shots.shot_1!.assetIds.push('seed_v2');
        current.shots.shot_1!.seedStillId = 'seed_v2';
      }
      if (options.briefReference) {
        current.assets.brief_v2 = {
          id: 'brief_v2',
          projectId: current.id,
          shotId: null,
          mediaKind: 'image',
          mimeType: 'image/png',
          managedAsset: { collection: 'imports', fileName: 'brief_v2.png' },
          byteSize: png.length,
          sha256: createHash('sha256').update(png).digest('hex'),
          briefReferenceRole: 'cast',
          briefReferenceLabel: 'Cast reference',
          createdAt: current.updatedAt,
        };
      }
      return current;
    });
  }
  if (options.includeAuthorizedJob === false) {
    return { rootDir, store, project: quoteBase, authorization: null, item: null };
  }
  const requestPlan: Extract<StudioGenerationRequestPlan, { kind: 'resolved' }> = {
    kind: 'resolved',
    snapshot: {
      prompt: purpose === 'seed_still' ? 'A frozen seed prompt' : 'A frozen video prompt',
      aspectRatio: quoteBase.aspectRatio,
      resolution: quoteBase.resolution,
      durationSeconds: 5,
      referenceInput: options.briefReference
        ? { assetId: 'brief_v2', sha256: createHash('sha256').update(png).digest('hex') }
        : null,
      conditioningInput: purpose === 'video_take' ? { kind: 'seed_still', assetId: 'seed_v2' } : null,
    },
  };
  const item: StudioQuotedGeneration = {
    id: createStudioQuotedGenerationId({
      projectId: quoteBase.id,
      projectRevision: quoteBase.revision,
      shotId: 'shot_1',
      purpose,
    }),
    shotId: 'shot_1',
    purpose,
    routeId: purpose === 'seed_still' ? 'route_image' : 'route_video',
    generationCount: 1,
    requestPlan,
    rateUnit: purpose === 'seed_still' ? 'generation' : 'second',
    rateMinorUnits: 3,
  };
  const totals = calculateStudioQuoteTotals([item]);
  if (totals === null) throw new Error('invalid quote fixture');
  const provider = {
    providerId: 'provider_1',
    adapterId:
      options.adapterId ??
      (purpose === 'seed_still' ? ('weprompt-image-v1' as const) : ('weprompt-media-gateway-v1' as const)),
    model: purpose === 'seed_still' ? 'image-model' : 'video-model',
  };
  const authorization: StudioSpendAuthorization = {
    id: 'authorization_v2',
    projectId: quoteBase.id,
    projectRevision: quoteBase.revision,
    originReferenceHandoffId: null,
    rateCardDigest: 'b'.repeat(64),
    currency: 'USD',
    baseItems: [item],
    cascadeItems: [],
    lowerMinorUnits: totals.lowerMinorUnits,
    upperMinorUnits: totals.upperMinorUnits,
    expiresAt: '2026-08-17T12:05:00.000Z',
    confirmedAt: '2026-08-17T12:00:01.000Z',
    providerBindings: [{ itemId: item.id, provider }],
    idempotencyKeys: [{ itemId: item.id, generationIndex: 0, key: 'key_1' }],
  };
  const receipt = createStudioSpendReceiptV2({
    authorization,
    itemId: item.id,
    jobId: 'job_1',
    generationIndex: 0,
  });
  const project = await store.updateProjectV2(quoteBase.id, (current) => {
    const job: StudioJobV2 = {
      id: 'job_1',
      projectId: current.id,
      shotId: 'shot_1',
      status: 'running',
      provider,
      idempotencyKey: 'key_1',
      providerJobId: null,
      cancellationPolicy: 'none',
      outputAssetIds: [],
      error: null,
      retryOfJobId: null,
      retryReason: null,
      duplicateChargeAcknowledged: false,
      duplicateChargeAcknowledgedAt: null,
      createdAt: current.updatedAt,
      updatedAt: current.updatedAt,
      purpose,
      authorizationId: authorization.id,
      authorizationItemId: item.id,
      generationIndex: 0,
      requestPlan,
      requestSnapshot: requestPlan.snapshot,
      spendReceipt: receipt,
      outputAssetIdsByRole: { primary: null, poster: null },
    };
    current.spendAuthorizations = [authorization];
    current.jobs.job_1 = job;
    current.shots.shot_1!.jobIds.push('job_1');
    return current;
  });
  return { rootDir, store, project, authorization, item };
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

  it('rejects every malformed prototype media metadata scalar before consuming a body', async () => {
    const { store } = await makeStore();
    const createId = vi.fn(() => 'must_not_allocate');
    const media = createStudioMediaStore({ store, createId });
    const providerCases: Array<(input: Record<string, unknown>) => void> = [
      (input) => (input.projectId = '../project'),
      (input) => (input.sceneId = '../scene'),
      (input) => (input.mediaKind = 'audio'),
      (input) => (input.declaredMimeType = null),
      (input) => (input.expectedRevision = 1.5),
      (input) => (input.expectedRevision = 0),
      (input) => (input.width = 1.5),
      (input) => (input.width = 0),
      (input) => (input.height = 1.5),
      (input) => (input.height = 0),
      (input) => (input.durationSeconds = Number.NaN),
      (input) => (input.durationSeconds = 0),
      (input) => (input.durationSeconds = Number.MAX_SAFE_INTEGER + 1),
      (input) => (input.declaredByteSize = 1.5),
      (input) => (input.declaredByteSize = -1),
    ];
    for (const mutate of providerCases) {
      let consumed = false;
      const input: Record<string, unknown> = {
        projectId: 'project_1',
        sceneId: 'scene_1',
        expectedRevision: 1,
        mediaKind: 'image',
        declaredMimeType: 'image/png',
        body: (async function* () {
          consumed = true;
          yield png;
        })(),
      };
      mutate(input);
      // eslint-disable-next-line no-await-in-loop -- Every scalar boundary must refuse independently.
      await expect(media.persistProviderOutput(input as never)).rejects.toMatchObject({ code: 'invalid_media' });
      expect(consumed).toBe(false);
    }

    await expect(
      media.persistProviderOutputForJob({
        projectId: 'project_1',
        sceneId: 'scene_1',
        jobId: '../job',
        mediaKind: 'image',
        declaredMimeType: 'image/png',
        body: Readable.from([png]),
      })
    ).rejects.toMatchObject({ code: 'invalid_media' });

    const capturedCases: Array<(input: Record<string, unknown>) => void> = [
      (input) => (input.projectId = '../project'),
      (input) => (input.sceneId = '../scene'),
      (input) => (input.videoAssetId = '../video'),
      (input) => (input.width = 1.5),
      (input) => (input.width = 0),
      (input) => (input.height = 1.5),
      (input) => (input.height = 0),
      (input) => (input.declaredByteSize = 1.5),
      (input) => (input.declaredByteSize = -1),
    ];
    for (const mutate of capturedCases) {
      const input: Record<string, unknown> = {
        projectId: 'project_1',
        sceneId: 'scene_1',
        videoAssetId: 'video_1',
        width: 1,
        height: 1,
        body: Readable.from([png]),
      };
      mutate(input);
      // eslint-disable-next-line no-await-in-loop -- Every scalar boundary must refuse independently.
      await expect(media.persistCapturedPoster(input as never)).rejects.toMatchObject({ code: 'invalid_media' });
    }

    const outputCases: Array<(input: Record<string, unknown>) => void> = [
      (input) => (input.projectId = '../project'),
      (input) => (input.declaredMimeType = 'video/webm'),
      (input) => (input.width = 1.5),
      (input) => (input.width = 0),
      (input) => (input.height = 1.5),
      (input) => (input.height = 0),
      (input) => (input.declaredByteSize = 1.5),
      (input) => (input.declaredByteSize = 0),
      (input) => (input.durationSeconds = Number.NaN),
      (input) => (input.durationSeconds = 0),
    ];
    for (const mutate of outputCases) {
      const input: Record<string, unknown> = {
        projectId: 'project_1',
        declaredMimeType: 'video/mp4',
        width: 1,
        height: 1,
        body: Readable.from([mp4]),
      };
      mutate(input);
      // eslint-disable-next-line no-await-in-loop -- Every scalar boundary must refuse independently.
      await expect(media.persistProjectOutput(input as never)).rejects.toMatchObject({ code: 'invalid_media' });
    }
    expect(createId).not.toHaveBeenCalled();
  });
});

describe('createStudioMediaStore schema 2 final lifecycle', () => {
  it('commits a seed primary by purpose and role without auto-pinning or selecting it', async () => {
    const { store, project } = await makeStoreV2();
    const media = createStudioMediaStore({ store, createId: () => 'seed_output_1' });

    const asset = await media.persistProviderOutputForJobV2({
      projectId: project.id,
      shotId: 'shot_1',
      jobId: 'job_1',
      mediaKind: 'image',
      declaredMimeType: 'image/png',
      declaredByteSize: png.length,
      body: Readable.from([png]),
    });

    expect(asset).toMatchObject({
      id: 'seed_output_1',
      projectId: project.id,
      shotId: 'shot_1',
      mediaKind: 'image',
      managedAsset: { collection: 'assets', fileName: 'seed_output_1.png' },
      sourceLook: 'A frozen seed prompt',
    });
    expect(asset).not.toHaveProperty('durationSeconds');
    const loaded = await store.getProjectV2(project.id);
    expect(loaded).toMatchObject({
      status: 'supported',
      project: {
        shots: {
          shot_1: {
            seedStillId: null,
            selectedTakeId: null,
            assetIds: ['seed_output_1'],
            jobIds: ['job_1'],
          },
        },
        jobs: {
          job_1: {
            status: 'succeeded',
            outputAssetIds: ['seed_output_1'],
            outputAssetIdsByRole: { primary: 'seed_output_1', poster: null },
          },
        },
      },
    });
  });

  it('persists the decoded video duration and keeps it immutable after planning-duration edits', async () => {
    const { store, project } = await makeStoreV2({ purpose: 'video_take' });
    const probeVideoDurationSecondsV2 = vi.fn(async () => 10);
    const media = createStudioMediaStore({
      store,
      createId: () => 'take_1',
      probeVideoDurationSecondsV2,
    });

    const asset = await media.persistProviderOutputForJobV2({
      projectId: project.id,
      shotId: 'shot_1',
      jobId: 'job_1',
      mediaKind: 'video',
      declaredMimeType: 'video/mp4',
      declaredByteSize: mp4.length,
      durationSeconds: 5,
      body: Readable.from([mp4]),
    });

    expect(asset.durationSeconds).toBe(10);
    expect(probeVideoDurationSecondsV2).toHaveBeenCalledWith({
      filePath: expect.stringMatching(/[/\\]assets[/\\]take_1\.mp4$/),
      byteSize: mp4.length,
      sha256: createHash('sha256').update(mp4).digest('hex'),
    });
    const edited = await store.updateProjectV2(project.id, (current) => {
      current.shots.shot_1!.durationSeconds = 8;
      return current;
    });
    expect(edited.assets.take_1!.durationSeconds).toBe(10);
    const restarted = await store.getProjectV2(project.id);
    expect(restarted.status === 'supported' ? restarted.project.assets.take_1!.durationSeconds : null).toBe(10);
  });

  it('cleans a video whose finalized bytes cannot produce a decoded duration', async () => {
    const { rootDir, store, project } = await makeStoreV2({ purpose: 'video_take' });
    const media = createStudioMediaStore({
      store,
      createId: () => 'invalid_video',
      probeVideoDurationSecondsV2: async () => {
        throw new Error('undecodable');
      },
    });

    await expect(
      media.persistProviderOutputForJobV2({
        projectId: project.id,
        shotId: 'shot_1',
        jobId: 'job_1',
        mediaKind: 'video',
        declaredMimeType: 'video/mp4',
        body: Readable.from([mp4]),
      })
    ).rejects.toMatchObject({ code: 'invalid_media' });

    const loaded = await store.getProjectV2(project.id);
    expect(loaded.status === 'supported' ? Object.keys(loaded.project.assets) : null).toEqual(['seed_v2']);
    await expect(fs.access(path.join(rootDir, project.id, 'assets', 'invalid_video.mp4'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('cleans every V2 managed-output byte, signature, identity, and duration refusal', async () => {
    const imageFixture = await makeStoreV2();
    const imageMedia = createStudioMediaStore({
      store: imageFixture.store,
      createId: idSequence('size_mismatch', 'empty_output', 'mime_mismatch'),
    });
    await expect(
      imageMedia.persistProviderOutputForJobV2({
        projectId: imageFixture.project.id,
        shotId: 'shot_1',
        jobId: 'job_1',
        mediaKind: 'image',
        declaredMimeType: 'image/png',
        declaredByteSize: png.length + 1,
        body: Readable.from([png]),
      })
    ).rejects.toMatchObject({ code: 'invalid_media' });
    await expect(
      imageMedia.persistProviderOutputForJobV2({
        projectId: imageFixture.project.id,
        shotId: 'shot_1',
        jobId: 'job_1',
        mediaKind: 'image',
        declaredMimeType: 'image/png',
        body: Readable.from([]),
      })
    ).rejects.toMatchObject({ code: 'invalid_media' });
    await expect(
      imageMedia.persistProviderOutputForJobV2({
        projectId: imageFixture.project.id,
        shotId: 'shot_1',
        jobId: 'job_1',
        mediaKind: 'image',
        declaredMimeType: 'image/jpeg',
        body: Readable.from([png]),
      })
    ).rejects.toMatchObject({ code: 'invalid_media' });

    let overflowConsumed = false;
    const overflowMedia = createStudioMediaStore({
      store: imageFixture.store,
      createId: () => 'overflow_output',
      limits: { imageOutputMaxBytes: png.length - 1 },
    });
    await expect(
      overflowMedia.persistProviderOutputForJobV2({
        projectId: imageFixture.project.id,
        shotId: 'shot_1',
        jobId: 'job_1',
        mediaKind: 'image',
        declaredMimeType: 'image/png',
        body: (async function* () {
          overflowConsumed = true;
          yield png;
        })(),
      })
    ).rejects.toMatchObject({ code: 'invalid_media' });
    expect(overflowConsumed).toBe(true);

    const unsafeIdMedia = createStudioMediaStore({ store: imageFixture.store, createId: () => '../unsafe' });
    await expect(
      unsafeIdMedia.persistProviderOutputForJobV2({
        projectId: imageFixture.project.id,
        shotId: 'shot_1',
        jobId: 'job_1',
        mediaKind: 'image',
        declaredMimeType: 'image/png',
        body: Readable.from([png]),
      })
    ).rejects.toMatchObject({ code: 'storage_error' });

    const videoFixture = await makeStoreV2({ purpose: 'video_take' });
    const durations = [Number.NaN, 0, Number.MAX_SAFE_INTEGER + 1];
    let durationIndex = 0;
    const videoMedia = createStudioMediaStore({
      store: videoFixture.store,
      createId: idSequence('duration_nan', 'duration_zero', 'duration_oversized'),
      probeVideoDurationSecondsV2: async () => durations[durationIndex++]!,
    });
    for (const assetId of ['duration_nan', 'duration_zero', 'duration_oversized']) {
      // eslint-disable-next-line no-await-in-loop -- Every decoded-duration boundary must clean independently.
      await expect(
        videoMedia.persistProviderOutputForJobV2({
          projectId: videoFixture.project.id,
          shotId: 'shot_1',
          jobId: 'job_1',
          mediaKind: 'video',
          declaredMimeType: 'video/mp4',
          body: Readable.from([mp4]),
        })
      ).rejects.toMatchObject({ code: 'invalid_media' });
      // eslint-disable-next-line no-await-in-loop -- Each refused final identity must be absent.
      await expect(
        fs.access(path.join(videoFixture.rootDir, videoFixture.project.id, 'assets', `${assetId}.mp4`))
      ).rejects.toMatchObject({ code: 'ENOENT' });
    }
  });

  it('rejects purpose/media and image-duration mismatches before consuming provider bytes', async () => {
    const imageFixture = await makeStoreV2();
    const videoFixture = await makeStoreV2({ purpose: 'video_take' });
    const imageMedia = createStudioMediaStore({ store: imageFixture.store });
    const videoMedia = createStudioMediaStore({ store: videoFixture.store });
    let consumed = 0;
    const body = async function* (): AsyncGenerator<Buffer> {
      consumed += 1;
      yield png;
    };

    await expect(
      imageMedia.persistProviderOutputForJobV2({
        projectId: imageFixture.project.id,
        shotId: 'shot_1',
        jobId: 'job_1',
        mediaKind: 'video',
        declaredMimeType: 'video/mp4',
        body: body(),
      })
    ).rejects.toMatchObject({ code: 'invalid_media' });
    await expect(
      imageMedia.persistProviderOutputForJobV2({
        projectId: imageFixture.project.id,
        shotId: 'shot_1',
        jobId: 'job_1',
        mediaKind: 'image',
        declaredMimeType: 'image/png',
        durationSeconds: 5,
        body: body(),
      })
    ).rejects.toMatchObject({ code: 'invalid_media' });
    await expect(
      videoMedia.persistProviderOutputForJobV2({
        projectId: videoFixture.project.id,
        shotId: 'shot_1',
        jobId: 'job_1',
        mediaKind: 'image',
        declaredMimeType: 'image/png',
        body: body(),
      })
    ).rejects.toMatchObject({ code: 'invalid_media' });
    expect(consumed).toBe(0);
  });

  it('persists the video poster through the explicit role map and refuses a duplicate', async () => {
    const { store, project } = await makeStoreV2({ purpose: 'video_take' });
    const media = createStudioMediaStore({
      store,
      createId: idSequence('take_1', 'poster_1', 'must_not_allocate'),
      probeVideoDurationSecondsV2: async () => 10,
    });
    await media.persistProviderOutputForJobV2({
      projectId: project.id,
      shotId: 'shot_1',
      jobId: 'job_1',
      mediaKind: 'video',
      declaredMimeType: 'video/mp4',
      body: Readable.from([mp4]),
    });

    const poster = await media.persistProviderPosterForJobV2({
      projectId: project.id,
      shotId: 'shot_1',
      jobId: 'job_1',
      primaryAssetId: 'take_1',
      declaredMimeType: 'image/png',
      body: Readable.from([png]),
    });
    expect(poster).toMatchObject({
      id: 'poster_1',
      shotId: 'shot_1',
      mediaKind: 'image',
      managedAsset: { collection: 'thumbnails' },
    });
    const loaded = await store.getProjectV2(project.id);
    expect(loaded).toMatchObject({
      status: 'supported',
      project: {
        shots: { shot_1: { selectedTakeId: null } },
        jobs: {
          job_1: {
            outputAssetIds: ['take_1', 'poster_1'],
            outputAssetIdsByRole: { primary: 'take_1', poster: 'poster_1' },
          },
        },
      },
    });

    let consumed = false;
    await expect(
      media.persistProviderPosterForJobV2({
        projectId: project.id,
        shotId: 'shot_1',
        jobId: 'job_1',
        primaryAssetId: 'take_1',
        declaredMimeType: 'image/png',
        body: (async function* () {
          consumed = true;
          yield png;
        })(),
      })
    ).rejects.toMatchObject({ code: 'job_inactive' });
    expect(consumed).toBe(false);
  });

  it('persists a renderer-captured V2 poster only after the canonical video is selected', async () => {
    const { store, project } = await makeStoreV2({ purpose: 'video_take' });
    const media = createStudioMediaStore({
      store,
      createId: idSequence('take_captured', 'poster_captured'),
      probeVideoDurationSecondsV2: async () => 10,
    });
    await media.persistProviderOutputForJobV2({
      projectId: project.id,
      shotId: 'shot_1',
      jobId: 'job_1',
      mediaKind: 'video',
      declaredMimeType: 'video/mp4',
      body: Readable.from([mp4]),
    });

    const capturedInput = {
      projectId: project.id,
      shotId: 'shot_1',
      videoAssetId: 'take_captured',
      width: 1,
      height: 1,
      declaredByteSize: png.length,
      body: Readable.from([png]),
    };
    await expect(media.persistCapturedPosterV2(capturedInput)).rejects.toMatchObject({ code: 'job_inactive' });

    await store.updateProjectV2(project.id, (current) => {
      current.shots.shot_1!.selectedTakeId = 'take_captured';
      return current;
    });
    const poster = await media.persistCapturedPosterV2({ ...capturedInput, body: Readable.from([png]) });
    expect(poster).toMatchObject({
      id: 'poster_captured',
      shotId: 'shot_1',
      mediaKind: 'image',
      managedAsset: { collection: 'thumbnails' },
    });
    const loaded = await store.getProjectV2(project.id);
    expect(loaded).toMatchObject({
      status: 'supported',
      project: {
        jobs: {
          job_1: {
            outputAssetIds: ['take_captured', 'poster_captured'],
            outputAssetIdsByRole: { primary: 'take_captured', poster: 'poster_captured' },
          },
        },
        shots: { shot_1: { selectedTakeId: 'take_captured' } },
      },
    });
  });

  it('persists and reopens a V2 project render without attaching it to a shot', async () => {
    const { store, project } = await makeStoreV2({ includeAuthorizedJob: false });
    const media = createStudioMediaStore({
      store,
      createId: idSequence('render_v2', 'render_v2_new'),
      now: () => '2026-08-17T12:00:00.000Z',
      probeVideoDurationSecondsV2: async () => 12,
    });
    const rendered = await media.persistProjectOutputV2({
      projectId: project.id,
      declaredMimeType: 'video/mp4',
      declaredByteSize: mp4.length,
      width: 1920,
      height: 1080,
      durationSeconds: 12,
      body: Readable.from([mp4]),
    });
    expect(rendered).toMatchObject({
      id: 'render_v2',
      projectId: project.id,
      shotId: null,
      durationSeconds: 12,
      managedAsset: { collection: 'assets', fileName: 'render_v2.mp4' },
    });
    await expect(media.getLatestProjectOutputV2(project.id)).resolves.toEqual(rendered);
    const newer = await media.persistProjectOutputV2({
      projectId: project.id,
      declaredMimeType: 'video/mp4',
      width: 1920,
      height: 1080,
      body: Readable.from([mp4]),
    });
    await expect(createStudioMediaStore({ store }).getLatestProjectOutputV2(project.id)).resolves.toEqual(newer);
    await expect(media.getLatestProjectOutputV2('../project')).rejects.toMatchObject({ code: 'invalid_media' });
    await expect(media.getLatestProjectOutputV2('missing_project')).rejects.toMatchObject({ code: 'not_found' });
  });

  it('rejects non-finite and non-positive V2 render durations from managed metadata', async () => {
    const { rootDir, store, project } = await makeStoreV2({ includeAuthorizedJob: false });
    const media = createStudioMediaStore({
      store,
      createId: () => 'render_v2_duration_guard',
      probeVideoDurationSecondsV2: async () => 12,
    });
    const rendered = await media.persistProjectOutputV2({
      projectId: project.id,
      declaredMimeType: 'video/mp4',
      width: 1920,
      height: 1080,
      body: Readable.from([mp4]),
    });
    const metadataPath = path.join(rootDir, project.id, 'assets', `${rendered.id}.render-v2.json`);
    const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8')) as Record<string, unknown>;
    for (const durationSeconds of ['not-a-number', 0]) {
      metadata.durationSeconds = durationSeconds;
      // eslint-disable-next-line no-await-in-loop -- Each scalar proves a separate short-circuit branch.
      await fs.writeFile(metadataPath, JSON.stringify(metadata));
      // eslint-disable-next-line no-await-in-loop -- Reopen from disk for each hostile value.
      await expect(media.getLatestProjectOutputV2(project.id)).resolves.toBeNull();
    }
  });

  it('imports a human seed candidate without pinning, selecting, authorizing, or spending', async () => {
    const { rootDir, store, project } = await makeStoreV2({ includeAuthorizedJob: false });
    const sourcePath = path.join(rootDir, 'human-seed.png');
    await fs.writeFile(sourcePath, png);
    const media = createStudioMediaStore({ store, createId: () => 'human_seed_1' });

    const imported = await media.importReferenceFromPathV2({
      projectId: project.id,
      shotId: 'shot_1',
      sourcePath,
      expectedRevision: project.revision,
      returnProject: true,
    });

    expect(imported.asset).toMatchObject({
      id: 'human_seed_1',
      shotId: 'shot_1',
      mediaKind: 'image',
      managedAsset: { collection: 'imports' },
    });
    expect(imported.project).toMatchObject({
      spendAuthorizations: [],
      jobs: {},
      shots: {
        shot_1: {
          assetIds: ['human_seed_1'],
          seedStillId: null,
          selectedTakeId: null,
          jobIds: [],
        },
      },
    });
  });

  it('rejects imports for individually binned Shots and Shots contained by binned Beats before staging bytes', async () => {
    await Promise.all(
      (['shot', 'beat'] as const).map(async (binKind) => {
        const { rootDir, store, project } = await makeStoreV2({ includeAuthorizedJob: false });
        const sourcePath = path.join(rootDir, `${binKind}-binned-reference.png`);
        await fs.writeFile(sourcePath, png);
        const inactive = await store.updateProjectV2(project.id, (current) => {
          if (binKind === 'shot') {
            current.beats.beat_1!.shotOrder = [];
            current.bin.push({ kind: 'shot', beatId: 'beat_1', shotId: 'shot_1', reason: 'lifted' });
          } else {
            current.beatOrder = [];
            current.bin.push({ kind: 'beat', beatId: 'beat_1', reason: 'lifted' });
          }
          return current;
        });
        const projectDirectory = path.join(rootDir, project.id);
        const entriesBefore = (await fs.readdir(projectDirectory, { recursive: true })).sort();
        const projectBefore = JSON.stringify(inactive);
        const media = createStudioMediaStore({ store, createId: () => `inactive_${binKind}_asset` });

        await expect(
          media.importReferenceFromPathV2({
            projectId: project.id,
            shotId: 'shot_1',
            sourcePath,
            expectedRevision: inactive.revision,
          })
        ).rejects.toMatchObject({ code: 'invalid_media' });

        const loaded = await store.getProjectV2(project.id);
        expect(loaded.status).toBe('supported');
        expect(loaded.status === 'supported' ? JSON.stringify(loaded.project) : null).toBe(projectBefore);
        expect((await fs.readdir(projectDirectory, { recursive: true })).sort()).toEqual(entriesBefore);
      })
    );
  });

  it('rechecks active Beat ownership inside the import commit and cleans staged bytes on refusal', async () => {
    const { rootDir, store, project } = await makeStoreV2({ includeAuthorizedJob: false });
    const sourcePath = path.join(rootDir, 'concurrently-binned-reference.png');
    await fs.writeFile(sourcePath, png);
    const binned = structuredClone(project);
    binned.beatOrder = [];
    binned.bin.push({ kind: 'beat', beatId: 'beat_1', reason: 'lifted' });
    const updateProjectV2 = vi.fn(
      async (_projectId: string, update: (current: StudioProjectV2) => StudioProjectV2): Promise<StudioProjectV2> =>
        update(structuredClone(binned))
    );
    const concurrentStore: CreativeStudioStore = { ...store, updateProjectV2 };
    const media = createStudioMediaStore({
      store: concurrentStore,
      createId: () => 'concurrently_binned_asset',
    });

    await expect(
      media.importReferenceFromPathV2({
        projectId: project.id,
        shotId: 'shot_1',
        sourcePath,
        expectedRevision: project.revision,
      })
    ).rejects.toMatchObject({ code: 'invalid_media' });

    expect(updateProjectV2).toHaveBeenCalledOnce();
    expect(await fs.readdir(path.join(rootDir, project.id, 'parts')).catch(() => [])).toEqual([]);
    expect(await fs.readdir(path.join(rootDir, project.id, 'imports')).catch(() => [])).toEqual([]);
    const loaded = await store.getProjectV2(project.id);
    expect(loaded.status === 'supported' ? loaded.project : null).toEqual(project);
  });

  it('imports, labels, and safely detaches a V2 Brief reference', async () => {
    const { rootDir, store, project } = await makeStoreV2({ includeAuthorizedJob: false });
    const sourcePath = path.join(rootDir, 'cast portrait.png');
    await fs.writeFile(sourcePath, png);
    const media = createStudioMediaStore({ store, createId: () => 'brief_imported' });
    const asset = await media.importReferenceFromPathV2({
      projectId: project.id,
      briefReferenceRole: 'cast',
      sourcePath,
      expectedRevision: project.revision,
    });
    expect(asset).toMatchObject({
      id: 'brief_imported',
      shotId: null,
      briefReferenceRole: 'cast',
      briefReferenceLabel: 'cast portrait',
    });
    const imported = await store.getProjectV2(project.id);
    if (imported.status !== 'supported') throw new Error('Brief import fixture missing');
    const detached = await media.detachBriefReferenceV2({
      projectId: project.id,
      assetId: asset.id,
      expectedRevision: imported.project.revision,
    });
    expect(detached.assets).not.toHaveProperty(asset.id);
    await expect(fs.access(path.join(rootDir, project.id, 'imports', 'brief_imported.png'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('imports JPEG and WebP V2 references and safely detaches a Look reference', async () => {
    const { rootDir, store, project } = await makeStoreV2({ includeAuthorizedJob: false });
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.from([0x00])]);
    const jpegPath = path.join(rootDir, 'look-reference.jpg');
    const webpPath = path.join(rootDir, 'cast-reference.webp');
    await Promise.all([fs.writeFile(jpegPath, jpeg), fs.writeFile(webpPath, webp)]);
    const media = createStudioMediaStore({
      store,
      createId: idSequence('brief_look_jpeg', 'brief_cast_webp'),
    });
    const look = await media.importReferenceFromPathV2({
      projectId: project.id,
      briefReferenceRole: 'look',
      sourcePath: jpegPath,
      expectedRevision: project.revision,
    });
    expect(look).toMatchObject({ id: 'brief_look_jpeg', mimeType: 'image/jpeg', briefReferenceRole: 'look' });
    let loaded = await store.getProjectV2(project.id);
    if (loaded.status !== 'supported') throw new Error('V2 JPEG fixture missing');
    const cast = await media.importReferenceFromPathV2({
      projectId: project.id,
      briefReferenceRole: 'cast',
      sourcePath: webpPath,
      expectedRevision: loaded.project.revision,
    });
    expect(cast).toMatchObject({ id: 'brief_cast_webp', mimeType: 'image/webp', briefReferenceRole: 'cast' });
    loaded = await store.getProjectV2(project.id);
    if (loaded.status !== 'supported') throw new Error('V2 WebP fixture missing');
    await expect(
      media.detachBriefReferenceV2({
        projectId: project.id,
        assetId: look.id,
        expectedRevision: loaded.project.revision,
      })
    ).resolves.not.toHaveProperty(`assets.${look.id}`);
  });

  it('detaches valid V2 Brief metadata after its managed directory is already absent', async () => {
    const { store, project } = await makeStoreV2({ includeAuthorizedJob: false });
    const withMissingBytes = await store.updateProjectV2(project.id, (current) => {
      current.assets.brief_missing_bytes = {
        id: 'brief_missing_bytes',
        projectId: current.id,
        shotId: null,
        mediaKind: 'image',
        mimeType: 'image/png',
        managedAsset: { collection: 'imports', fileName: 'brief_missing_bytes.png' },
        byteSize: png.length,
        sha256: createHash('sha256').update(png).digest('hex'),
        briefReferenceRole: 'cast',
        briefReferenceLabel: 'Missing bytes',
        createdAt: current.updatedAt,
      };
      return current;
    });
    const media = createStudioMediaStore({ store });
    await expect(
      media.detachBriefReferenceV2({
        projectId: project.id,
        assetId: 'brief_missing_bytes',
        expectedRevision: withMissingBytes.revision,
      })
    ).resolves.not.toHaveProperty('assets.brief_missing_bytes');
  });

  it('refuses to detach a shot-owned V2 seed through the Brief-reference seam', async () => {
    const { store, project } = await makeStoreV2({ purpose: 'video_take', includeAuthorizedJob: false });
    const media = createStudioMediaStore({ store });
    await expect(
      media.detachBriefReferenceV2({
        projectId: project.id,
        assetId: 'seed_v2',
        expectedRevision: project.revision,
      })
    ).rejects.toMatchObject({ code: 'invalid_media' });
  });

  it('enforces V2 import media, revision, ownership, and Brief-capacity boundaries', async () => {
    const { rootDir, store, project } = await makeStoreV2({ includeAuthorizedJob: false });
    const imagePath = path.join(rootDir, 'reference.png');
    const videoPath = path.join(rootDir, 'reference.mp4');
    await fs.writeFile(imagePath, png);
    await fs.writeFile(videoPath, mp4);
    let idOrdinal = 0;
    const media = createStudioMediaStore({ store, createId: () => `import_case_${++idOrdinal}` });

    await expect(
      media.importReferenceFromPathV2({
        projectId: project.id,
        shotId: 'missing_shot',
        sourcePath: imagePath,
        expectedRevision: project.revision,
      })
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(
      media.importReferenceFromPathV2({
        projectId: project.id,
        shotId: 'shot_1',
        sourcePath: imagePath,
        expectedRevision: project.revision - 1,
      })
    ).rejects.toMatchObject({ code: 'stale_project' });
    await expect(
      media.importReferenceFromPathV2({
        projectId: project.id,
        briefReferenceRole: 'look',
        sourcePath: videoPath,
        expectedRevision: project.revision,
      })
    ).rejects.toMatchObject({ code: 'invalid_media' });
    await expect(
      createStudioMediaStore({ store, createId: () => '../unsafe' }).importReferenceFromPathV2({
        projectId: project.id,
        shotId: 'shot_1',
        sourcePath: imagePath,
        expectedRevision: project.revision,
      })
    ).rejects.toMatchObject({ code: 'storage_error' });

    const importedIds: string[] = [];
    for (let index = 0; index < 6; index += 1) {
      // eslint-disable-next-line no-await-in-loop -- Capacity must be proven at every committed revision.
      const loaded = await store.getProjectV2(project.id);
      if (loaded.status !== 'supported') throw new Error('Brief capacity fixture missing');
      // eslint-disable-next-line no-await-in-loop -- Imports are intentionally serialized by revision.
      const imported = await media.importReferenceFromPathV2({
        projectId: project.id,
        briefReferenceRole: index % 2 === 0 ? 'cast' : 'look',
        sourcePath: imagePath,
        expectedRevision: loaded.project.revision,
      });
      importedIds.push(imported.id);
    }
    const full = await store.getProjectV2(project.id);
    if (full.status !== 'supported') throw new Error('Brief capacity fixture missing');
    await expect(
      media.importReferenceFromPathV2({
        projectId: project.id,
        briefReferenceRole: 'cast',
        sourcePath: imagePath,
        expectedRevision: full.project.revision,
      })
    ).rejects.toMatchObject({ code: 'invalid_media' });
    await expect(
      media.detachBriefReferenceV2({
        projectId: project.id,
        assetId: importedIds[0]!,
        expectedRevision: full.project.revision - 1,
      })
    ).rejects.toMatchObject({ code: 'stale_project' });
    await expect(
      media.detachBriefReferenceV2({
        projectId: project.id,
        assetId: 'missing_asset',
        expectedRevision: full.project.revision,
      })
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('fails closed when a nonterminal immutable request still owns a Brief reference', async () => {
    const { rootDir, store, project } = await makeStoreV2({ briefReference: true });
    const media = createStudioMediaStore({ store });
    const managedPath = path.join(rootDir, project.id, 'imports', 'brief_v2.png');

    await expect(
      media.detachBriefReferenceV2({
        projectId: project.id,
        assetId: 'brief_v2',
        expectedRevision: project.revision,
      })
    ).rejects.toMatchObject({ code: 'media_in_use' });
    await expect(fs.readFile(managedPath)).resolves.toEqual(png);
    expect(await store.getProjectV2(project.id)).toEqual({ status: 'supported', project });

    const terminal = await store.updateProjectV2(project.id, (current) => {
      const job = current.jobs.job_1!;
      job.status = 'failed';
      job.error = { code: 'no_output', messageKey: 'conversation.creativeStudio.jobs.errors.noOutput' };
      return current;
    });
    const detached = await media.detachBriefReferenceV2({
      projectId: project.id,
      assetId: 'brief_v2',
      expectedRevision: terminal.revision,
    });
    expect(detached.assets).not.toHaveProperty('brief_v2');
    expect(detached.jobs.job_1!.requestSnapshot?.referenceInput).toEqual({
      assetId: 'brief_v2',
      sha256: createHash('sha256').update(png).digest('hex'),
    });
    await expect(fs.access(managedPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('re-proves V2 provider-input bytes and refuses a same-path replacement', async () => {
    const { rootDir, store, project } = await makeStoreV2({ briefReference: true });
    const media = createStudioMediaStore({ store });
    const input = await media.resolveProviderInputV2(project.id, 'brief_v2');
    const chunks: Buffer[] = [];
    for await (const chunk of await input.openStream()) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks)).toEqual(png);
    await expect(input.asDataUrl(1.5)).rejects.toMatchObject({ code: 'invalid_media' });
    await expect(input.asDataUrl(png.length - 1)).rejects.toMatchObject({ code: 'invalid_media' });
    await expect(input.asDataUrl(png.length)).resolves.toBe(`data:image/png;base64,${png.toString('base64')}`);

    const managedPath = path.join(rootDir, project.id, 'imports', 'brief_v2.png');
    await fs.writeFile(managedPath, Buffer.concat([png, Buffer.from('replacement')]));
    await expect(media.resolveProviderInputV2(project.id, 'brief_v2')).rejects.toMatchObject({ code: 'invalid_media' });
  });

  it('rejects hostile V2 provider metadata before allocating or consuming a body', async () => {
    const { rootDir, store, project } = await makeStoreV2();
    const createId = vi.fn(() => 'must_not_allocate');
    const media = createStudioMediaStore({ store, createId });
    const cases: Array<[string, (input: Record<string, unknown>) => void]> = [
      ['unsafe project', (input) => (input.projectId = '../project')],
      ['unsafe shot', (input) => (input.shotId = '../shot')],
      ['unsafe job', (input) => (input.jobId = '../job')],
      ['wrong kind', (input) => (input.mediaKind = 'audio')],
      ['missing MIME', (input) => (input.declaredMimeType = null)],
      ['fractional width', (input) => (input.width = 1.5)],
      ['zero width', (input) => (input.width = 0)],
      ['fractional height', (input) => (input.height = 1.5)],
      ['zero height', (input) => (input.height = 0)],
      ['fractional bytes', (input) => (input.declaredByteSize = 1.5)],
      ['negative bytes', (input) => (input.declaredByteSize = -1)],
      ['non-finite duration', (input) => (input.durationSeconds = Number.NaN)],
      ['zero duration', (input) => (input.durationSeconds = 0)],
      ['oversized duration', (input) => (input.durationSeconds = Number.MAX_SAFE_INTEGER + 1)],
    ];

    for (const [label, mutate] of cases) {
      let consumed = false;
      const input: Record<string, unknown> = {
        projectId: project.id,
        shotId: 'shot_1',
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
    expect(createId).not.toHaveBeenCalled();
    await expect(fs.access(path.join(rootDir, project.id, 'parts'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects malformed V2 media envelopes before allocating, reading, or mutating storage', async () => {
    const { store, project } = await makeStoreV2({ includeAuthorizedJob: false });
    const createId = vi.fn(() => 'unused_asset');
    const media = createStudioMediaStore({ store, createId });
    const sourcePath = '/must/not/be/read.png';
    const importCases: Array<Record<string, unknown>> = [
      {
        projectId: '../project',
        shotId: 'shot_1',
        expectedRevision: project.revision,
        sourcePath,
      },
      {
        projectId: project.id,
        shotId: '../shot',
        expectedRevision: project.revision,
        sourcePath,
      },
      {
        projectId: project.id,
        briefReferenceRole: 'organisation',
        expectedRevision: project.revision,
        sourcePath,
      },
      { projectId: project.id, expectedRevision: project.revision, sourcePath },
      {
        projectId: project.id,
        shotId: 'shot_1',
        briefReferenceRole: 'cast',
        expectedRevision: project.revision,
        sourcePath,
      },
      { projectId: project.id, shotId: 'shot_1', expectedRevision: 1.5, sourcePath },
      { projectId: project.id, shotId: 'shot_1', expectedRevision: 0, sourcePath },
      { projectId: project.id, shotId: 'shot_1', expectedRevision: project.revision, sourcePath: 42 },
    ];
    for (const input of importCases) {
      // eslint-disable-next-line no-await-in-loop -- Every hostile envelope must refuse independently.
      await expect(media.importReferenceFromPathV2(input as never)).rejects.toMatchObject({ code: 'invalid_media' });
    }

    const detachCases: Array<Record<string, unknown>> = [
      { projectId: '../project', assetId: 'asset_1', expectedRevision: 1 },
      { projectId: project.id, assetId: '../asset', expectedRevision: 1 },
      { projectId: project.id, assetId: 'asset_1', expectedRevision: 1.5 },
      { projectId: project.id, assetId: 'asset_1', expectedRevision: 0 },
    ];
    for (const input of detachCases) {
      // eslint-disable-next-line no-await-in-loop -- Every hostile envelope must refuse independently.
      await expect(media.detachBriefReferenceV2(input as never)).rejects.toMatchObject({ code: 'invalid_media' });
    }

    for (const input of [
      {
        projectId: project.id,
        shotId: 'shot_1',
        jobId: 'job_1',
        primaryAssetId: '../primary',
        declaredMimeType: 'image/png',
        body: Readable.from([png]),
      },
      {
        projectId: project.id,
        shotId: 'shot_1',
        jobId: 'job_1',
        primaryAssetId: 'primary_1',
        declaredMimeType: 'video/mp4',
        body: Readable.from([png]),
      },
    ]) {
      // eslint-disable-next-line no-await-in-loop -- Each poster authority field must refuse independently.
      await expect(media.persistProviderPosterForJobV2(input)).rejects.toMatchObject({ code: 'invalid_media' });
    }

    const capturedCases: Array<(input: Record<string, unknown>) => void> = [
      (input) => (input.projectId = '../project'),
      (input) => (input.shotId = '../shot'),
      (input) => (input.videoAssetId = '../video'),
      (input) => (input.width = 1.5),
      (input) => (input.width = 0),
      (input) => (input.height = 1.5),
      (input) => (input.height = 0),
      (input) => (input.declaredByteSize = 1.5),
      (input) => (input.declaredByteSize = -1),
    ];
    for (const mutate of capturedCases) {
      const input: Record<string, unknown> = {
        projectId: project.id,
        shotId: 'shot_1',
        videoAssetId: 'take_1',
        width: 1,
        height: 1,
        body: Readable.from([png]),
      };
      mutate(input);
      // eslint-disable-next-line no-await-in-loop -- Every scalar boundary must refuse independently.
      await expect(media.persistCapturedPosterV2(input as never)).rejects.toMatchObject({ code: 'invalid_media' });
    }

    const outputCases: Array<(input: Record<string, unknown>) => void> = [
      (input) => (input.projectId = '../project'),
      (input) => (input.declaredMimeType = 'video/webm'),
      (input) => (input.width = 1.5),
      (input) => (input.width = 0),
      (input) => (input.height = 1.5),
      (input) => (input.height = 0),
      (input) => (input.declaredByteSize = 1.5),
      (input) => (input.declaredByteSize = 0),
      (input) => (input.durationSeconds = Number.NaN),
      (input) => (input.durationSeconds = 0),
    ];
    for (const mutate of outputCases) {
      const input: Record<string, unknown> = {
        projectId: project.id,
        declaredMimeType: 'video/mp4',
        width: 1,
        height: 1,
        body: Readable.from([mp4]),
      };
      mutate(input);
      // eslint-disable-next-line no-await-in-loop -- Every scalar boundary must refuse independently.
      await expect(media.persistProjectOutputV2(input as never)).rejects.toMatchObject({ code: 'invalid_media' });
    }

    await expect(
      media.extractConditioningFrameV2({ projectId: '../project', extractionId: 'frame_1' })
    ).rejects.toMatchObject({ code: 'invalid_media' });
    await expect(
      media.extractConditioningFrameV2({ projectId: project.id, extractionId: '../frame' })
    ).rejects.toMatchObject({ code: 'invalid_media' });
    await expect(
      media.verifyConditioningFrameV2({ projectId: '../project', extractionId: 'frame_1' })
    ).resolves.toBeNull();
    await expect(
      media.verifyConditioningFrameV2({ projectId: project.id, extractionId: '../frame' })
    ).resolves.toBeNull();
    await expect(media.resolveAssetV2('../project', 'asset_1')).resolves.toBeNull();
    await expect(media.resolveAssetV2(project.id, '../asset')).resolves.toBeNull();
    await expect(media.resolveAssetV2(project.id, 'missing_asset')).resolves.toBeNull();
    await expect(media.resolveProviderInputV2(project.id, 'missing_asset')).rejects.toMatchObject({
      code: 'invalid_media',
    });

    const sparse: string[] = [];
    sparse.length = 1;
    for (const ids of [null, sparse, ['../project'], [project.id, project.id]] as unknown[]) {
      // eslint-disable-next-line no-await-in-loop -- Every hostile recovery list must refuse independently.
      await expect(media.resumeConditioningFramesV2(ids as never)).rejects.toMatchObject({ code: 'invalid_media' });
    }
    expect(createId).not.toHaveBeenCalled();
  });

  it('rejects every malformed ready-frame proof before touching managed bytes', async () => {
    const { store, project } = await makeStoreV2({ includeAuthorizedJob: false });
    const extractionId = 'extraction_1';
    const frameId = 'frame_1';
    const base = structuredClone(project);
    base.frameExtractions[extractionId] = {
      id: extractionId,
      shotId: 'shot_1',
      takeAssetId: 'take_1',
      endpointSeconds: 5,
      status: 'ready',
      frameAssetId: frameId,
      errorCode: null,
      createdAt: base.createdAt,
      updatedAt: base.updatedAt,
    };
    base.assets[frameId] = {
      id: frameId,
      projectId: base.id,
      shotId: 'shot_1',
      mediaKind: 'image',
      mimeType: 'image/png',
      managedAsset: { collection: 'conditioningFrames', fileName: 'frame_1.png' },
      byteSize: png.length,
      sha256: createHash('sha256').update(png).digest('hex'),
      createdAt: base.createdAt,
    };
    base.shots.shot_1!.assetIds.push(frameId);

    const cases: Array<StudioProjectV2 | null> = [
      null,
      { ...structuredClone(base), frameExtractions: {} },
      (() => {
        const candidate = structuredClone(base);
        candidate.frameExtractions[extractionId]!.status = 'pending';
        candidate.frameExtractions[extractionId]!.frameAssetId = null;
        return candidate;
      })(),
      (() => {
        const candidate = structuredClone(base);
        candidate.frameExtractions[extractionId]!.status = 'failed';
        candidate.frameExtractions[extractionId]!.frameAssetId = null;
        candidate.frameExtractions[extractionId]!.errorCode = 'decode_failed';
        return candidate;
      })(),
      (() => {
        const candidate = structuredClone(base);
        candidate.frameExtractions[extractionId]!.frameAssetId = null;
        return candidate;
      })(),
      (() => {
        const candidate = structuredClone(base);
        delete candidate.assets[frameId];
        return candidate;
      })(),
      (() => {
        const candidate = structuredClone(base);
        candidate.assets[frameId]!.projectId = 'foreign_project';
        return candidate;
      })(),
      (() => {
        const candidate = structuredClone(base);
        candidate.assets[frameId]!.shotId = 'foreign_shot';
        return candidate;
      })(),
      (() => {
        const candidate = structuredClone(base);
        candidate.assets[frameId]!.mediaKind = 'video';
        candidate.assets[frameId]!.mimeType = 'video/mp4';
        candidate.assets[frameId]!.durationSeconds = 5;
        return candidate;
      })(),
      (() => {
        const candidate = structuredClone(base);
        candidate.assets[frameId]!.managedAsset.collection = 'assets';
        return candidate;
      })(),
      (() => {
        const candidate = structuredClone(base);
        candidate.shots.shot_1!.assetIds = [];
        return candidate;
      })(),
    ];

    for (const candidate of cases) {
      const wrappedStore = {
        ...store,
        getProjectV2: vi.fn(async () =>
          candidate === null
            ? { status: 'unsupported_prototype_schema' as const, schemaVersion: 1 }
            : { status: 'supported' as const, project: structuredClone(candidate) }
        ),
      };
      const media = createStudioMediaStore({ store: wrappedStore as CreativeStudioStore });
      // eslint-disable-next-line no-await-in-loop -- Each malformed proof is independently authoritative.
      await expect(media.verifyConditioningFrameV2({ projectId: project.id, extractionId })).resolves.toBeNull();
      // eslint-disable-next-line no-await-in-loop -- Extraction must reject the same malformed durable authority.
      await expect(media.extractConditioningFrameV2({ projectId: project.id, extractionId })).rejects.toBeDefined();
    }
  });

  it('cleans only schema-2 orphan parts and leaves prototype storage untouched', async () => {
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
    await fs.mkdir(prototypeParts);
    await fs.mkdir(v2Parts);
    await fs.writeFile(path.join(prototypeParts, 'prototype.part'), 'prototype');
    await fs.writeFile(path.join(v2Parts, 'orphan.part'), 'partial');
    await fs.writeFile(path.join(v2Parts, 'keep.txt'), 'keep');

    await createStudioMediaStore({ store }).cleanupOrphanPartsV2();

    await expect(fs.readFile(path.join(prototypeParts, 'prototype.part'), 'utf8')).resolves.toBe('prototype');
    await expect(fs.access(path.join(v2Parts, 'orphan.part'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.readFile(path.join(v2Parts, 'keep.txt'), 'utf8')).resolves.toBe('keep');
  });

  it('extracts one trim-aware local conditioning frame and coalesces duplicate scheduling', async () => {
    const { rootDir, store, project } = await makeStoreV2({ purpose: 'video_take' });
    let releaseExtraction!: () => void;
    const extractionGate = new Promise<void>((resolve) => {
      releaseExtraction = resolve;
    });
    const conditioningFrameExtractor = vi.fn(async (input: { destinationPath: string }) => {
      await extractionGate;
      await fs.writeFile(input.destinationPath, png);
      return { source: 'local_decode' as const };
    });
    const media = createStudioMediaStore({
      store,
      createId: idSequence('take_1', 'frame_asset_1'),
      probeVideoDurationSecondsV2: async () => 10,
      conditioningFrameExtractor,
    });
    await media.persistProviderOutputForJobV2({
      projectId: project.id,
      shotId: 'shot_1',
      jobId: 'job_1',
      mediaKind: 'video',
      declaredMimeType: 'video/mp4',
      body: Readable.from([mp4]),
    });
    const extractionId = createStudioFrameExtractionId({
      shotId: 'shot_1',
      takeAssetId: 'take_1',
      endpointSeconds: 8,
    });
    await store.updateProjectV2(project.id, (current) => {
      current.shots.shot_1!.selectedTakeId = 'take_1';
      current.shots.shot_1!.trimOutSeconds = 2;
      current.frameExtractions[extractionId] = {
        id: extractionId,
        shotId: 'shot_1',
        takeAssetId: 'take_1',
        endpointSeconds: 8,
        frameAssetId: null,
        status: 'pending',
        errorCode: null,
      };
      return current;
    });

    const first = media.extractConditioningFrameV2({ projectId: project.id, extractionId });
    const duplicate = media.extractConditioningFrameV2({ projectId: project.id, extractionId });
    expect(duplicate).toBe(first);
    await vi.waitFor(() => expect(conditioningFrameExtractor).toHaveBeenCalledOnce());
    releaseExtraction();
    await expect(first).resolves.toMatchObject({
      id: extractionId,
      status: 'ready',
      frameAssetId: 'frame_asset_1',
      errorCode: null,
    });
    expect(conditioningFrameExtractor).toHaveBeenCalledWith({
      sourcePath: expect.stringMatching(/[/\\]assets[/\\]take_1\.mp4$/),
      sourceExpectation: {
        byteSize: mp4.length,
        sha256: createHash('sha256').update(mp4).digest('hex'),
      },
      destinationPath: expect.stringMatching(/[/\\]parts[/\\]frame_asset_1\.part$/),
      endpointSeconds: 8,
      sourceDurationSeconds: 10,
      providerLastFramePath: null,
      providerLastFrameExpectation: null,
      allowProviderLastFrame: false,
    });
    const loaded = await store.getProjectV2(project.id);
    expect(loaded).toMatchObject({
      status: 'supported',
      project: {
        assets: {
          frame_asset_1: {
            shotId: 'shot_1',
            mediaKind: 'image',
            managedAsset: { collection: 'conditioningFrames', fileName: 'frame_asset_1.png' },
          },
        },
        shots: { shot_1: { assetIds: ['seed_v2', 'take_1', 'frame_asset_1'] } },
      },
    });
    const resolved = await media.resolveAssetV2(project.id, 'frame_asset_1');
    const chunks: Buffer[] = [];
    for await (const chunk of await resolved!.openVerifiedStream()) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks)).toEqual(png);

    const framePath = path.join(rootDir, project.id, 'conditioningFrames', 'frame_asset_1.png');
    const originalStats = await fs.stat(framePath);
    await expect(media.verifyConditioningFrameV2({ projectId: project.id, extractionId })).resolves.toEqual({
      extractionId,
      shotId: 'shot_1',
      takeAssetId: 'take_1',
      endpointSeconds: 8,
      frameAssetId: 'frame_asset_1',
      byteSize: png.length,
      sha256: createHash('sha256').update(png).digest('hex'),
    });

    const replacement = Buffer.from(png);
    replacement[replacement.length - 1] ^= 0xff;
    await fs.writeFile(framePath, replacement);
    await fs.utimes(framePath, originalStats.atime, originalStats.mtime);
    await expect(media.verifyConditioningFrameV2({ projectId: project.id, extractionId })).resolves.toBeNull();

    await fs.writeFile(framePath, png);
    await fs.utimes(framePath, originalStats.atime, originalStats.mtime);
    await expect(media.verifyConditioningFrameV2({ projectId: project.id, extractionId })).resolves.not.toBeNull();
    const renamedReplacement = path.join(rootDir, 'same-header-replacement.png');
    await fs.writeFile(renamedReplacement, replacement);
    await fs.utimes(renamedReplacement, originalStats.atime, originalStats.mtime);
    await fs.rename(renamedReplacement, framePath);
    await fs.utimes(framePath, originalStats.atime, originalStats.mtime);
    await expect(media.verifyConditioningFrameV2({ projectId: project.id, extractionId })).resolves.toBeNull();
  });

  it('records a stable local extraction failure without creating frame bytes or paid work', async () => {
    const { rootDir, store, project } = await makeStoreV2({ purpose: 'video_take' });
    const media = createStudioMediaStore({
      store,
      createId: idSequence('take_1', 'frame_asset_1'),
      probeVideoDurationSecondsV2: async () => 10,
      conditioningFrameExtractor: async () => {
        throw new StudioConditioningFrameError('decode_failed');
      },
    });
    await media.persistProviderOutputForJobV2({
      projectId: project.id,
      shotId: 'shot_1',
      jobId: 'job_1',
      mediaKind: 'video',
      declaredMimeType: 'video/mp4',
      body: Readable.from([mp4]),
    });
    const extractionId = createStudioFrameExtractionId({
      shotId: 'shot_1',
      takeAssetId: 'take_1',
      endpointSeconds: 10,
    });
    const before = await store.updateProjectV2(project.id, (current) => {
      current.shots.shot_1!.selectedTakeId = 'take_1';
      current.frameExtractions[extractionId] = {
        id: extractionId,
        shotId: 'shot_1',
        takeAssetId: 'take_1',
        endpointSeconds: 10,
        frameAssetId: null,
        status: 'pending',
        errorCode: null,
      };
      return current;
    });

    await expect(media.extractConditioningFrameV2({ projectId: project.id, extractionId })).rejects.toMatchObject({
      code: 'decode_failed',
    });
    const loaded = await store.getProjectV2(project.id);
    expect(loaded).toMatchObject({
      status: 'supported',
      project: {
        frameExtractions: {
          [extractionId]: { status: 'failed', frameAssetId: null, errorCode: 'decode_failed' },
        },
        spendAuthorizations: before.spendAuthorizations,
        jobs: before.jobs,
      },
    });
    await expect(fs.access(path.join(rootDir, project.id, 'parts', 'frame_asset_1.part'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('persists each conditioning-frame byte, signature, quota, disk, and identity refusal', async () => {
    const { rootDir, store, project } = await makeStoreV2({ purpose: 'video_take' });
    const setupMedia = createStudioMediaStore({
      store,
      createId: () => 'take_for_failures',
      probeVideoDurationSecondsV2: async () => 10,
    });
    await setupMedia.persistProviderOutputForJobV2({
      projectId: project.id,
      shotId: 'shot_1',
      jobId: 'job_1',
      mediaKind: 'video',
      declaredMimeType: 'video/mp4',
      body: Readable.from([mp4]),
    });
    const extractionId = createStudioFrameExtractionId({
      shotId: 'shot_1',
      takeAssetId: 'take_for_failures',
      endpointSeconds: 10,
    });
    await store.updateProjectV2(project.id, (current) => {
      current.shots.shot_1!.selectedTakeId = 'take_for_failures';
      current.frameExtractions[extractionId] = {
        id: extractionId,
        shotId: 'shot_1',
        takeAssetId: 'take_for_failures',
        endpointSeconds: 10,
        frameAssetId: null,
        status: 'pending',
        errorCode: null,
      };
      return current;
    });

    const scenarios = [
      {
        id: 'frame_empty',
        expectedCode: 'decode_failed',
        extract: async (destinationPath: string) => fs.writeFile(destinationPath, Buffer.alloc(0)),
      },
      {
        id: 'frame_video',
        expectedCode: 'decode_failed',
        extract: async (destinationPath: string) => fs.writeFile(destinationPath, mp4),
      },
      {
        id: 'frame_asset_cap',
        expectedCode: 'invalid_media',
        limits: { imageOutputMaxBytes: png.length - 1 },
        extract: async (destinationPath: string) => fs.writeFile(destinationPath, png),
      },
      {
        id: 'frame_project_cap',
        expectedCode: 'invalid_media',
        limits: { projectMaxBytes: 1 },
        extract: async (destinationPath: string) => fs.writeFile(destinationPath, png),
      },
      {
        id: 'frame_no_disk',
        expectedCode: 'storage_error',
        diskBytes: 0,
        extract: async (destinationPath: string) => fs.writeFile(destinationPath, png),
      },
      {
        id: '../unsafe_frame',
        expectedCode: 'storage_error',
        extract: async (destinationPath: string) => fs.writeFile(destinationPath, png),
      },
    ] as const;

    for (const scenario of scenarios) {
      const conditioningFrameExtractor = vi.fn(async ({ destinationPath }: { destinationPath: string }) => {
        await scenario.extract(destinationPath);
        return { source: 'local_decode' as const };
      });
      const media = createStudioMediaStore({
        store,
        createId: () => scenario.id,
        conditioningFrameExtractor,
        ...('limits' in scenario ? { limits: scenario.limits } : {}),
        ...('diskBytes' in scenario ? { getAvailableDiskBytes: async () => scenario.diskBytes } : {}),
      });
      // eslint-disable-next-line no-await-in-loop -- Every frame refusal must persist independently.
      await expect(media.extractConditioningFrameV2({ projectId: project.id, extractionId })).rejects.toMatchObject({
        code: scenario.expectedCode,
      });
      // eslint-disable-next-line no-await-in-loop -- Reset is the explicit provider-free retry transition.
      await store.updateProjectV2(project.id, (current) => {
        const extraction = current.frameExtractions[extractionId]!;
        expect(extraction).toMatchObject({ status: 'failed', frameAssetId: null });
        extraction.status = 'pending';
        extraction.errorCode = null;
        return current;
      });
      expect(conditioningFrameExtractor).toHaveBeenCalledTimes(scenario.id.startsWith('../') ? 0 : 1);
    }
    expect(await fs.readdir(path.join(rootDir, project.id, 'conditioningFrames')).catch(() => [])).toEqual([]);
  });

  it('adopts only an exact untrimmed Seedance provider last frame', async () => {
    const { store, project } = await makeStoreV2({
      purpose: 'video_take',
      adapterId: 'byteplus-seedance-v1',
    });
    const conditioningFrameExtractor = vi.fn(async (input: { destinationPath: string }) => {
      await fs.writeFile(input.destinationPath, png);
      return { source: 'provider_last_frame' as const };
    });
    const media = createStudioMediaStore({
      store,
      createId: idSequence('take_1', 'poster_1', 'frame_asset_1'),
      probeVideoDurationSecondsV2: async () => 10,
      conditioningFrameExtractor,
    });
    await media.persistProviderOutputForJobV2({
      projectId: project.id,
      shotId: 'shot_1',
      jobId: 'job_1',
      mediaKind: 'video',
      declaredMimeType: 'video/mp4',
      body: Readable.from([mp4]),
    });
    await media.persistProviderPosterForJobV2({
      projectId: project.id,
      shotId: 'shot_1',
      jobId: 'job_1',
      primaryAssetId: 'take_1',
      declaredMimeType: 'image/png',
      body: Readable.from([png]),
    });
    const extractionId = createStudioFrameExtractionId({
      shotId: 'shot_1',
      takeAssetId: 'take_1',
      endpointSeconds: 10,
    });
    await store.updateProjectV2(project.id, (current) => {
      current.shots.shot_1!.selectedTakeId = 'take_1';
      current.frameExtractions[extractionId] = {
        id: extractionId,
        shotId: 'shot_1',
        takeAssetId: 'take_1',
        endpointSeconds: 10,
        frameAssetId: null,
        status: 'pending',
        errorCode: null,
      };
      return current;
    });

    await media.extractConditioningFrameV2({ projectId: project.id, extractionId });
    expect(conditioningFrameExtractor).toHaveBeenCalledWith(
      expect.objectContaining({
        allowProviderLastFrame: true,
        providerLastFramePath: expect.stringMatching(/[/\\]thumbnails[/\\]poster_1\.png$/),
        providerLastFrameExpectation: {
          byteSize: png.length,
          sha256: createHash('sha256').update(png).digest('hex'),
        },
      })
    );
  });

  it('re-derives a deleted ready frame into the same asset identity during recovery', async () => {
    const { rootDir, store, project } = await makeStoreV2({ purpose: 'video_take' });
    const conditioningFrameExtractor = vi.fn(async (input: { destinationPath: string }) => {
      await fs.writeFile(input.destinationPath, png);
      return { source: 'local_decode' as const };
    });
    const media = createStudioMediaStore({
      store,
      createId: idSequence('take_1', 'frame_asset_1', 'must_not_allocate'),
      probeVideoDurationSecondsV2: async () => 10,
      conditioningFrameExtractor,
    });
    await media.persistProviderOutputForJobV2({
      projectId: project.id,
      shotId: 'shot_1',
      jobId: 'job_1',
      mediaKind: 'video',
      declaredMimeType: 'video/mp4',
      body: Readable.from([mp4]),
    });
    const extractionId = createStudioFrameExtractionId({
      shotId: 'shot_1',
      takeAssetId: 'take_1',
      endpointSeconds: 10,
    });
    await store.updateProjectV2(project.id, (current) => {
      current.shots.shot_1!.selectedTakeId = 'take_1';
      current.frameExtractions[extractionId] = {
        id: extractionId,
        shotId: 'shot_1',
        takeAssetId: 'take_1',
        endpointSeconds: 10,
        frameAssetId: null,
        status: 'pending',
        errorCode: null,
      };
      return current;
    });
    await media.extractConditioningFrameV2({ projectId: project.id, extractionId });
    const framePath = path.join(rootDir, project.id, 'conditioningFrames', 'frame_asset_1.png');
    await fs.rm(framePath);

    await media.resumeConditioningFramesV2([project.id]);

    expect(conditioningFrameExtractor).toHaveBeenCalledTimes(2);
    const loaded = await store.getProjectV2(project.id);
    expect(loaded).toMatchObject({
      status: 'supported',
      project: {
        frameExtractions: { [extractionId]: { status: 'ready', frameAssetId: 'frame_asset_1' } },
        jobs: { job_1: { id: 'job_1', status: 'succeeded' } },
      },
    });
    await expect(fs.readFile(framePath)).resolves.toEqual(png);
  });
});
