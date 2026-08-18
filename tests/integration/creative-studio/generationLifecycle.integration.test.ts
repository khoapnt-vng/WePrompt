/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { isCanonicalStudioGeneratedTake } from '@/common/types/project/creativeStudioCanonicalTake';
import type { StudioProject, StudioScene } from '@/common/types/project/creativeStudioTypes';
import {
  createStudioE2EFakeBundle,
  STUDIO_E2E_CREDENTIAL_SENTINEL,
  STUDIO_E2E_PROVIDER_JOB_SENTINEL,
  STUDIO_E2E_PROVIDER_URL_SENTINEL,
  STUDIO_E2E_RAW_OUTPUT_BODY_SENTINEL,
  STUDIO_E2E_RAW_OUTPUT_PATH_SENTINEL,
} from '@process/services/creative-studio/adapters/e2eFakeAdapter';
import type { ResolvedStudioGenerationRequest } from '@process/services/creative-studio/adapters/types';
import {
  createStudioJobManager,
  type StudioJobManager,
  type StudioResolvedShotRouteSnapshotV2,
  type StudioResolvedSceneRouteSnapshot,
} from '@process/services/creative-studio/jobManager';
import { createStudioMediaStore } from '@process/services/creative-studio/mediaStore';
import { createStudioProviderResolver } from '@process/services/creative-studio/providerResolver';
import { createCreativeStudioService } from '@process/services/creative-studio/service';
import { createCreativeStudioStore } from '@process/services/creative-studio/store';
import { afterEach, describe, expect, it } from 'vitest';

const scene: StudioScene = {
  id: 'scene_1',
  title: 'Opening',
  purpose: 'Introduce the product',
  visualPrompt: 'A paper airplane crossing a sunrise',
  narration: '',
  onScreenText: '',
  mediaKind: 'video',
  durationSeconds: 5,
  referenceAssetId: null,
  selectedAssetId: null,
  assetIds: [],
  jobIds: [],
  reviewState: 'ready',
};

const waitFor = async <T>(read: () => Promise<T | null>, attemptsRemaining = 200): Promise<T> => {
  const value = await read();
  if (value !== null) return value;
  if (attemptsRemaining <= 1) throw new Error('Timed out waiting for Creative Studio integration state');
  await new Promise<void>((resolve) => setTimeout(resolve, 5));
  return waitFor(read, attemptsRemaining - 1);
};

type PendingSleep = {
  delayMs: number;
  release(): void;
};

class ControlledPollClock {
  readonly observedDelays: number[] = [];
  private readonly pending: PendingSleep[] = [];
  private autoRelease = false;

  readonly sleep = (delayMs: number, signal?: AbortSignal): Promise<void> => {
    this.observedDelays.push(delayMs);
    if (this.autoRelease) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error): void => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener('abort', onAbort);
        if (error) reject(error);
        else resolve();
      };
      const onAbort = (): void => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        finish(error);
      };
      if (signal?.aborted) {
        onAbort();
        return;
      }
      signal?.addEventListener('abort', onAbort, { once: true });
      this.pending.push({ delayMs, release: () => finish() });
    });
  };

  async take(expectedDelayMs: number): Promise<PendingSleep> {
    const pending = await waitFor(async () => this.pending.shift() ?? null);
    expect(pending.delayMs).toBe(expectedDelayMs);
    return pending;
  }

  releaseAll(): void {
    this.autoRelease = true;
    for (const pending of this.pending.splice(0)) pending.release();
  }
}

type Harness = {
  rootDir: string;
  project: StudioProject;
  route: StudioResolvedSceneRouteSnapshot;
  manager: StudioJobManager;
  clock: ControlledPollClock;
  store: ReturnType<typeof createCreativeStudioStore>;
  mediaStore: ReturnType<typeof createStudioMediaStore>;
  fake: ReturnType<typeof createStudioE2EFakeBundle>;
};

const REFERENCE_FIXTURE_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWMwTpv5HwAENAIyeXoBdAAAAABJRU5ErkJggg==',
  'base64'
);

const activeHarnesses: Harness[] = [];
const activeManagers: StudioJobManager[] = [];

const createHarness = async (): Promise<Harness> => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'studio-generation-integration-'));
  const fake = createStudioE2EFakeBundle({ rootDir });
  const store = createCreativeStudioStore({ rootDir });
  await Promise.all(fake.connections.map((connection) => store.saveConnection(connection)));
  const created = await store.createProject({
    name: 'Launch film',
    brief: 'A concise launch story',
    aspectRatio: '16:9',
    targetDurationSeconds: 5,
    resolution: '720p',
  });
  let project = await store.updateProject(created.id, (current) => ({
    ...current,
    sceneOrder: [scene.id],
    scenes: { [scene.id]: structuredClone(scene) },
  }));
  const listProviders = async () => [fake.provider];
  const providerResolver = createStudioProviderResolver({
    listProviders,
    listConnections: () => store.listConnections(),
  });
  const catalog = await providerResolver.listGenerationRoutes();
  const videoRoute = catalog.routes.find((candidate) => candidate.kind === 'video');
  if (!videoRoute) throw new Error('E2E fake video route was not resolved');
  const route: StudioResolvedSceneRouteSnapshot = {
    sceneId: scene.id,
    providerId: videoRoute.providerId,
    adapterId: videoRoute.adapterId,
    model: videoRoute.model,
    kind: videoRoute.kind,
  };
  project = await store.updateProject(project.id, (current) => ({
    ...current,
    routing: {
      ...current.routing,
      video: { providerId: route.providerId, adapterId: route.adapterId, model: route.model },
    },
  }));
  const mediaStore = createStudioMediaStore({ store });
  const clock = new ControlledPollClock();
  const manager = createStudioJobManager({
    store,
    mediaStore,
    providerResolver,
    adapters: fake.adapters,
    listProviders,
    createJobId: () => 'job_lifecycle',
    createIdempotencyKey: () => 'idempotency_lifecycle',
    sleep: clock.sleep,
    jitterMs: (baseMs) => baseMs,
  });
  const harness = { rootDir, project, route, manager, clock, store, mediaStore, fake };
  activeHarnesses.push(harness);
  return harness;
};

const importBriefReferences = async (
  harness: Harness
): Promise<{ project: StudioProject; castAssetId: string; lookAssetId: string }> => {
  const castPath = path.join(harness.rootDir, 'Lead Hero.png');
  const lookPath = path.join(harness.rootDir, 'Golden Atrium.png');
  await Promise.all([writeFile(castPath, REFERENCE_FIXTURE_BYTES), writeFile(lookPath, REFERENCE_FIXTURE_BYTES)]);
  const cast = await harness.mediaStore.importReferenceFromPath({
    projectId: harness.project.id,
    expectedRevision: harness.project.revision,
    sourcePath: castPath,
    briefReferenceRole: 'cast',
    returnProject: true,
  });
  const look = await harness.mediaStore.importReferenceFromPath({
    projectId: harness.project.id,
    expectedRevision: cast.project.revision,
    sourcePath: lookPath,
    briefReferenceRole: 'look',
    returnProject: true,
  });
  return { project: look.project, castAssetId: cast.asset.id, lookAssetId: look.asset.id };
};

const submitReferenceAndStopWithRemoteIdentity = async (
  harness: Harness
): Promise<{
  configured: StudioProject;
  providerResolver: ReturnType<typeof createStudioProviderResolver>;
}> => {
  const listProviders = async () => [harness.fake.provider];
  const providerResolver = createStudioProviderResolver({
    listProviders,
    listConnections: () => harness.store.listConnections(),
  });
  const catalog = await providerResolver.listGenerationRoutes();
  const catalogImageRoute = catalog.routes.find((candidate) => candidate.kind === 'image');
  if (!catalogImageRoute) throw new Error('E2E fake image route was not resolved');
  const imageRoute: StudioResolvedSceneRouteSnapshot = {
    sceneId: scene.id,
    providerId: catalogImageRoute.providerId,
    adapterId: catalogImageRoute.adapterId,
    model: catalogImageRoute.model,
    kind: catalogImageRoute.kind,
  };
  const configured = await harness.store.updateProject(harness.project.id, (current) => ({
    ...current,
    routing: {
      ...current.routing,
      image: {
        providerId: imageRoute.providerId,
        adapterId: imageRoute.adapterId,
        model: imageRoute.model,
      },
    },
  }));

  await harness.manager.submitScenes({
    projectId: configured.id,
    expectedRevision: configured.revision,
    sceneIds: [scene.id],
    routes: [imageRoute],
    catalogVersion: catalog.generationCatalogVersion,
    outputRole: 'reference',
    referencePrompts: [{ sceneId: scene.id, prompt: 'A restart-safe reference plate' }],
  });
  await waitFor(async () => {
    const job = (await harness.store.getProject(configured.id))?.jobs.job_lifecycle;
    return job?.status === 'queued_remote' && job.providerJobId ? job : null;
  });
  await harness.clock.take(2_000);
  const disposal = harness.manager.dispose();
  harness.clock.releaseAll();
  await disposal;

  return { configured, providerResolver };
};

const createRestartedManager = (
  harness: Harness,
  providerResolver: ReturnType<typeof createStudioProviderResolver>
): StudioJobManager => {
  const manager = createStudioJobManager({
    store: harness.store,
    mediaStore: harness.mediaStore,
    providerResolver,
    adapters: harness.fake.adapters,
    listProviders: async () => [harness.fake.provider],
    sleep: async () => undefined,
    jitterMs: (baseMs) => baseMs,
  });
  activeManagers.push(manager);
  return manager;
};

const forbiddenDtoKeys = new Set([
  'path',
  'filepath',
  'sourcepath',
  'destinationpath',
  'url',
  'signedurl',
  'apikey',
  'credential',
  'credentials',
  'authorization',
  'bytes',
  'base64',
  'secret',
]);

const collectForbiddenDtoKeys = (value: unknown, found: string[] = []): string[] => {
  if (Array.isArray(value)) {
    for (const item of value) collectForbiddenDtoKeys(item, found);
    return found;
  }
  if (typeof value !== 'object' || value === null) return found;
  for (const [key, nested] of Object.entries(value)) {
    const normalized = key.replaceAll(/[^A-Za-z0-9]/g, '').toLowerCase();
    if (forbiddenDtoKeys.has(normalized)) found.push(key);
    collectForbiddenDtoKeys(nested, found);
  }
  return found;
};

afterEach(async () => {
  await Promise.all(activeManagers.splice(0).map((manager) => manager.dispose().catch((): undefined => undefined)));
  await Promise.all(
    activeHarnesses.splice(0).map(async (harness) => {
      harness.clock.releaseAll();
      await harness.manager.dispose().catch((): undefined => undefined);
      await harness.fake.dispose().catch((): undefined => undefined);
      await rm(harness.rootDir, { recursive: true, force: true });
    })
  );
});

describe('Creative Studio generation lifecycle integration', () => {
  it('runs a real V2 shot submission through durable job, asset, and selected-take ownership', async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'studio-v2-generation-integration-'));
    const fake = createStudioE2EFakeBundle({ rootDir });
    const clock = new ControlledPollClock();
    let manager: ReturnType<typeof createStudioJobManager> | null = null;
    try {
      const store = createCreativeStudioStore({ rootDir });
      await Promise.all(fake.connections.map((connection) => store.saveConnection(connection)));
      const listProviders = async () => [fake.provider];
      const providerResolver = createStudioProviderResolver({
        listProviders,
        listConnections: () => store.listConnections(),
      });
      const catalog = await providerResolver.listGenerationRoutes();
      const imageRoute = catalog.routes.find((candidate) => candidate.kind === 'image');
      if (!imageRoute) throw new Error('V2 lifecycle did not resolve the fake image route');
      const route: StudioResolvedShotRouteSnapshotV2 = {
        shotId: 'clip_lifecycle',
        providerId: imageRoute.providerId,
        adapterId: imageRoute.adapterId,
        model: imageRoute.model,
        kind: 'image',
      };
      const created = await store.createProjectV2({
        name: 'V2 lifecycle film',
        brief: 'Persist one clip-owned generated take',
        aspectRatio: '16:9',
        targetDurationSeconds: 5,
        resolution: '720p',
      });
      const configured = await store.updateProjectV2(created.id, (project) => ({
        ...project,
        beatOrder: ['section_lifecycle'],
        beats: {
          section_lifecycle: {
            id: 'section_lifecycle',
            title: 'Opening',
            action: 'Introduce the product',
            look: 'A luminous folded-paper world',
            shotOrder: ['clip_lifecycle'],
          },
        },
        shots: {
          clip_lifecycle: {
            id: 'clip_lifecycle',
            line: 'A paper aircraft banks across a sunrise',
            narration: '',
            onScreenText: '',
            mediaKind: 'image',
            durationSeconds: 5,
            referenceAssetId: null,
            selectedTakeId: null,
            assetIds: [],
            jobIds: [],
          },
        },
        routing: {
          image: { providerId: route.providerId, adapterId: route.adapterId, model: route.model },
          video: null,
        },
      }));
      const mediaStore = createStudioMediaStore({ store });
      manager = createStudioJobManager({
        store,
        mediaStore,
        providerResolver,
        adapters: fake.adapters,
        listProviders,
        createJobId: () => 'job_v2_lifecycle',
        createIdempotencyKey: () => 'idempotency_v2_lifecycle',
        sleep: clock.sleep,
        jitterMs: (baseMs) => baseMs,
      });

      await expect(
        manager.submitShots({
          projectId: configured.id,
          expectedRevision: configured.revision,
          shotIds: ['clip_lifecycle'],
          routes: [route],
          catalogVersion: catalog.generationCatalogVersion,
        })
      ).resolves.toMatchObject([
        {
          id: 'job_v2_lifecycle',
          shotId: 'clip_lifecycle',
          idempotencyKey: 'idempotency_v2_lifecycle',
          status: 'queued_local',
        },
      ]);
      clock.releaseAll();

      const completed = await waitFor(async () => {
        try {
          const loaded = await store.getProjectV2(configured.id);
          return loaded.status === 'supported' && loaded.project.jobs.job_v2_lifecycle.status === 'succeeded'
            ? loaded.project
            : null;
        } catch {
          return null;
        }
      });
      const job = completed.jobs.job_v2_lifecycle;
      const shot = completed.shots.clip_lifecycle;
      const selectedTakeId = shot.selectedTakeId;
      const asset = selectedTakeId ? completed.assets[selectedTakeId] : null;
      expect({
        jobShotId: job.shotId,
        outputAssetIds: job.outputAssetIds,
        shotJobIds: shot.jobIds,
        shotAssetIds: shot.assetIds,
        selectedTakeId,
        assetShotId: asset?.shotId,
        collection: asset?.managedAsset.collection,
      }).toEqual({
        jobShotId: 'clip_lifecycle',
        outputAssetIds: [selectedTakeId],
        shotJobIds: ['job_v2_lifecycle'],
        shotAssetIds: [selectedTakeId],
        selectedTakeId,
        assetShotId: 'clip_lifecycle',
        collection: 'assets',
      });
      expect(selectedTakeId ? await mediaStore.resolveAssetV2(completed.id, selectedTakeId) : null).not.toBeNull();
    } finally {
      clock.releaseAll();
      await manager?.dispose().catch((): undefined => undefined);
      await fake.dispose().catch((): undefined => undefined);
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it('resumes a reference job on a video scene through its durable image route', async () => {
    const harness = await createHarness();
    const { configured, providerResolver } = await submitReferenceAndStopWithRemoteIdentity(harness);
    const manager = createRestartedManager(harness, providerResolver);

    await manager.resumePendingJobs();

    const recovered = await waitFor(async () => {
      const current = await harness.store.getProject(configured.id);
      const status = current?.jobs.job_lifecycle.status;
      return current && (status === 'succeeded' || status === 'needs_attention') ? current : null;
    });
    expect(recovered.jobs.job_lifecycle).toMatchObject({
      status: 'succeeded',
      outputRole: 'reference',
      error: null,
    });
    expect(recovered.jobs.job_lifecycle.error?.code).not.toBe('provider_unavailable');
  });

  it('retries a reference download on a video scene through its durable image route', async () => {
    const harness = await createHarness();
    const { configured, providerResolver } = await submitReferenceAndStopWithRemoteIdentity(harness);
    const failed = await harness.store.updateProject(configured.id, (current) => {
      const next = structuredClone(current);
      next.jobs.job_lifecycle.status = 'failed';
      next.jobs.job_lifecycle.error = {
        code: 'download_failed',
        messageKey: 'conversation.creativeStudio.jobs.errors.downloadFailed',
      };
      next.scenes[scene.id].reviewState = 'blocked';
      return next;
    });
    const manager = createRestartedManager(harness, providerResolver);

    const retried = await manager.retryDownload({
      projectId: failed.id,
      jobId: 'job_lifecycle',
      expectedRevision: failed.revision,
    });

    expect(retried).toMatchObject({
      status: 'failed',
      outputRole: 'reference',
      error: { code: 'download_failed' },
    });
  });

  it('persists Cast-before-Look still provenance and reloads only the selected plate into video', async () => {
    const harness = await createHarness();
    const imported = await importBriefReferences(harness);
    const providerResolver = createStudioProviderResolver({
      listProviders: async () => [harness.fake.provider],
      listConnections: () => harness.store.listConnections(),
    });
    const catalog = await providerResolver.listGenerationRoutes();
    const imageRoute = catalog.routes.find((candidate) => candidate.kind === 'image');
    const videoRoute = catalog.routes.find((candidate) => candidate.kind === 'video');
    if (!imageRoute || !videoRoute) throw new Error('Reference lifecycle routes were not resolved');
    expect(videoRoute.constraints.supportsFirstFrame).toBe(true);
    expect(videoRoute.constraints.maxConditioningImages).toBe(0);
    expect(imageRoute.constraints.maxConditioningImages).toBe(6);

    const configured = await harness.store.updateProject(imported.project.id, (current) => ({
      ...current,
      routing: {
        ...current.routing,
        image: {
          providerId: imageRoute.providerId,
          adapterId: imageRoute.adapterId,
          model: imageRoute.model,
        },
        video: {
          providerId: videoRoute.providerId,
          adapterId: videoRoute.adapterId,
          model: videoRoute.model,
        },
      },
    }));
    const adapters = new Map(harness.fake.adapters);
    const fakeImageAdapter = adapters.get(imageRoute.adapterId);
    const fakeVideoAdapter = adapters.get(videoRoute.adapterId);
    if (!fakeImageAdapter || !fakeVideoAdapter) throw new Error('E2E fake lifecycle adapters were not resolved');
    const imageRequests: ResolvedStudioGenerationRequest[] = [];
    const videoRequests: ResolvedStudioGenerationRequest[] = [];
    adapters.set(imageRoute.adapterId, {
      ...fakeImageAdapter,
      submit: async (request, provider, signal) => {
        imageRequests.push(request);
        return fakeImageAdapter.submit(request, provider, signal);
      },
    });
    adapters.set(videoRoute.adapterId, {
      ...fakeVideoAdapter,
      submit: async (request, provider, signal) => {
        videoRequests.push(request);
        return fakeVideoAdapter.submit(request, provider, signal);
      },
    });
    const jobIds = ['job_reference_lifecycle', 'job_take_lifecycle'];
    const idempotencyKeys = ['idempotency_reference_lifecycle', 'idempotency_take_lifecycle'];
    const manager = createStudioJobManager({
      store: harness.store,
      mediaStore: harness.mediaStore,
      providerResolver,
      adapters,
      listProviders: async () => [harness.fake.provider],
      createJobId: () => jobIds.shift() ?? 'job_unexpected_lifecycle',
      createIdempotencyKey: () => idempotencyKeys.shift() ?? 'idempotency_unexpected_lifecycle',
      sleep: harness.clock.sleep,
      jitterMs: (baseMs) => baseMs,
    });
    activeManagers.push(manager);
    harness.clock.releaseAll();

    await manager.submitScenes({
      projectId: configured.id,
      expectedRevision: configured.revision,
      sceneIds: [scene.id],
      routes: [
        {
          sceneId: scene.id,
          providerId: imageRoute.providerId,
          adapterId: imageRoute.adapterId,
          model: imageRoute.model,
          kind: 'image',
        },
      ],
      catalogVersion: catalog.generationCatalogVersion,
      outputRole: 'reference',
      referencePrompts: [{ sceneId: scene.id, prompt: '  A precise sunrise reference plate  ' }],
    });

    const plated = await waitFor(async () => {
      const current = await harness.store.getProject(configured.id);
      return current?.jobs.job_reference_lifecycle.status === 'succeeded' ? current : null;
    });
    const platedScene = plated.scenes[scene.id];
    const referenceAssetId = platedScene.referenceAssetId;
    if (!referenceAssetId) throw new Error('Reference job succeeded without a committed asset');
    const referenceAsset = plated.assets[referenceAssetId];
    expect(imageRequests).toHaveLength(1);
    expect(imageRequests[0]?.conditioningImages?.map(({ assetId }) => assetId)).toEqual([
      imported.castAssetId,
      imported.lookAssetId,
    ]);
    expect(imageRequests[0]?.firstFrame).toBeUndefined();
    expect(plated.jobs.job_reference_lifecycle).toMatchObject({
      status: 'succeeded',
      outputRole: 'reference',
      referenceInputSnapshot: {
        sourceVisualPrompt: 'A precise sunrise reference plate',
        conditioningReferenceAssetIds: [imported.castAssetId, imported.lookAssetId],
        aspectRatio: '16:9',
        resolution: '720p',
      },
    });
    expect({
      outputAssetIds: plated.jobs.job_reference_lifecycle.outputAssetIds,
      sceneId: referenceAsset?.sceneId,
      collection: referenceAsset?.managedAsset.collection,
      assetIds: platedScene.assetIds,
      sourceVisualPrompt: referenceAsset?.sourceVisualPrompt,
      sourceReferenceAssetIds: referenceAsset?.sourceReferenceAssetIds,
      sourceAspectRatio: referenceAsset?.sourceAspectRatio,
      sourceResolution: referenceAsset?.sourceResolution,
    }).toEqual({
      outputAssetIds: [referenceAssetId],
      sceneId: scene.id,
      collection: 'references',
      assetIds: [referenceAssetId],
      sourceVisualPrompt: 'A precise sunrise reference plate',
      sourceReferenceAssetIds: [imported.castAssetId, imported.lookAssetId],
      sourceAspectRatio: '16:9',
      sourceResolution: '720p',
    });
    expect(platedScene.selectedAssetId).toBeNull();
    expect(platedScene.reviewState).toBe('draft');
    expect(
      Object.values(plated.assets).some((asset) => isCanonicalStudioGeneratedTake(asset, plated.id, platedScene))
    ).toBe(false);

    await manager.dispose();
    const reloadedStore = createCreativeStudioStore({ rootDir: harness.rootDir });
    const reloadedMediaStore = createStudioMediaStore({ store: reloadedStore });
    const reloadedProviderResolver = createStudioProviderResolver({
      listProviders: async () => [harness.fake.provider],
      listConnections: () => reloadedStore.listConnections(),
    });
    const reloaded = await reloadedStore.getProject(plated.id);
    if (!reloaded) throw new Error('Persisted reference lifecycle project did not reload');
    expect(reloaded.scenes[scene.id].referenceAssetId).toBe(referenceAssetId);
    expect(reloaded.jobs.job_reference_lifecycle.referenceInputSnapshot).toEqual({
      sourceVisualPrompt: 'A precise sunrise reference plate',
      conditioningReferenceAssetIds: [imported.castAssetId, imported.lookAssetId],
      aspectRatio: '16:9',
      resolution: '720p',
    });
    const reloadedReferenceAsset = reloaded.assets[referenceAssetId];
    expect({
      sceneId: reloadedReferenceAsset?.sceneId,
      collection: reloadedReferenceAsset?.managedAsset.collection,
      sourceVisualPrompt: reloadedReferenceAsset?.sourceVisualPrompt,
      sourceReferenceAssetIds: reloadedReferenceAsset?.sourceReferenceAssetIds,
      sourceAspectRatio: reloadedReferenceAsset?.sourceAspectRatio,
      sourceResolution: reloadedReferenceAsset?.sourceResolution,
    }).toEqual({
      sceneId: scene.id,
      collection: 'references',
      sourceVisualPrompt: 'A precise sunrise reference plate',
      sourceReferenceAssetIds: [imported.castAssetId, imported.lookAssetId],
      sourceAspectRatio: '16:9',
      sourceResolution: '720p',
    });
    const rendererProject = await createCreativeStudioService({
      store: reloadedStore,
      onProjectUpdated: () => undefined,
      storyboardPlanner: {
        listModels: async () => [],
        draft: async () => {
          throw new Error('Storyboard planning is not part of this lifecycle');
        },
        dispose: async () => undefined,
      },
    }).getProject(reloaded.id);
    expect(rendererProject?.jobs.job_reference_lifecycle).toMatchObject({
      status: 'succeeded',
      outputRole: 'reference',
    });
    expect(rendererProject?.jobs.job_reference_lifecycle).not.toHaveProperty('referenceInputSnapshot');

    const reloadedCatalog = await reloadedProviderResolver.listGenerationRoutes();
    const reloadedManager = createStudioJobManager({
      store: reloadedStore,
      mediaStore: reloadedMediaStore,
      providerResolver: reloadedProviderResolver,
      adapters,
      listProviders: async () => [harness.fake.provider],
      createJobId: () => jobIds.shift() ?? 'job_unexpected_lifecycle',
      createIdempotencyKey: () => idempotencyKeys.shift() ?? 'idempotency_unexpected_lifecycle',
      sleep: async () => undefined,
      jitterMs: (baseMs) => baseMs,
    });
    activeManagers.push(reloadedManager);

    await reloadedManager.submitScenes({
      projectId: reloaded.id,
      expectedRevision: reloaded.revision,
      sceneIds: [scene.id],
      routes: [
        {
          sceneId: scene.id,
          providerId: videoRoute.providerId,
          adapterId: videoRoute.adapterId,
          model: videoRoute.model,
          kind: 'video',
        },
      ],
      catalogVersion: reloadedCatalog.generationCatalogVersion,
    });

    const takeRequest = await waitFor(async () => videoRequests[0] ?? null);
    expect(takeRequest.firstFrame).toMatchObject({
      assetId: referenceAssetId,
      mimeType: 'image/png',
    });
    expect(takeRequest).not.toHaveProperty('conditioningImages');
    expect(takeRequest).not.toHaveProperty('conditioningImageLimit');
  });

  it('rejects active Brief references at route capacity zero before persistence or provider spend', async () => {
    const harness = await createHarness();
    const imported = await importBriefReferences(harness);
    const imageConnection = harness.fake.connections.find((connection) =>
      connection.capabilities.mediaKinds.includes('image')
    );
    if (!imageConnection) throw new Error('E2E fake image connection was not resolved');
    await harness.store.saveConnection({
      ...imageConnection,
      capabilities: { ...imageConnection.capabilities, maxConditioningImages: 0 },
    });
    const providerResolver = createStudioProviderResolver({
      listProviders: async () => [harness.fake.provider],
      listConnections: () => harness.store.listConnections(),
    });
    const catalog = await providerResolver.listGenerationRoutes();
    const imageRoute = catalog.routes.find(
      (candidate) => candidate.kind === 'image' && candidate.model === imageConnection.model
    );
    if (!imageRoute) throw new Error('Capacity-zero image route was not resolved');
    expect(imageRoute.constraints.maxConditioningImages).toBe(0);
    const configured = await harness.store.updateProject(imported.project.id, (current) => ({
      ...current,
      routing: {
        ...current.routing,
        image: {
          providerId: imageRoute.providerId,
          adapterId: imageRoute.adapterId,
          model: imageRoute.model,
        },
      },
    }));
    const adapters = new Map(harness.fake.adapters);
    const imageAdapter = adapters.get(imageRoute.adapterId);
    const videoAdapter = [...adapters.values()].find((adapter) => adapter.id !== imageRoute.adapterId);
    if (!imageAdapter || !videoAdapter) throw new Error('E2E fake spend-boundary adapters were not resolved');
    const imageRequests: ResolvedStudioGenerationRequest[] = [];
    const videoRequests: ResolvedStudioGenerationRequest[] = [];
    adapters.set(imageRoute.adapterId, {
      ...imageAdapter,
      submit: async (request, provider, signal) => {
        imageRequests.push(request);
        return imageAdapter.submit(request, provider, signal);
      },
    });
    adapters.set(videoAdapter.id, {
      ...videoAdapter,
      submit: async (request, provider, signal) => {
        videoRequests.push(request);
        return videoAdapter.submit(request, provider, signal);
      },
    });
    const manager = createStudioJobManager({
      store: harness.store,
      mediaStore: harness.mediaStore,
      providerResolver,
      adapters,
      listProviders: async () => [harness.fake.provider],
      createJobId: () => 'job_capacity_zero',
      createIdempotencyKey: () => 'idempotency_capacity_zero',
      sleep: harness.clock.sleep,
      jitterMs: (baseMs) => baseMs,
    });
    activeManagers.push(manager);
    const before = await harness.store.getProject(configured.id);
    const delaysBefore = [...harness.clock.observedDelays];

    await expect(
      manager.submitScenes({
        projectId: configured.id,
        expectedRevision: configured.revision,
        sceneIds: [scene.id],
        routes: [
          {
            sceneId: scene.id,
            providerId: imageRoute.providerId,
            adapterId: imageRoute.adapterId,
            model: imageRoute.model,
            kind: 'image',
          },
        ],
        catalogVersion: catalog.generationCatalogVersion,
        outputRole: 'reference',
        referencePrompts: [{ sceneId: scene.id, prompt: 'A capacity-zero reference plate' }],
      })
    ).rejects.toMatchObject({ code: 'invalid_route' });

    expect(await harness.store.getProject(configured.id)).toEqual(before);
    expect(imageRequests).toEqual([]);
    expect(videoRequests).toEqual([]);
    expect(harness.clock.observedDelays).toEqual(delaysBefore);
  });

  it('uses one selected model per kind across a batch and only applies changes to later submissions', async () => {
    const harness = await createHarness();
    const providerResolver = createStudioProviderResolver({
      listProviders: async () => [harness.fake.provider],
      listConnections: () => harness.store.listConnections(),
    });
    const catalog = await providerResolver.listGenerationRoutes();
    const imageRoutes = catalog.routes
      .filter((candidate) => candidate.kind === 'image')
      .toSorted((left, right) => left.model.localeCompare(right.model));
    const videoRoute = catalog.routes.find((candidate) => candidate.kind === 'video');
    expect(imageRoutes.map((candidate) => candidate.model)).toEqual(['weprompt-e2e-image', 'weprompt-e2e-image-next']);
    if (!imageRoutes[0] || !imageRoutes[1] || !videoRoute) throw new Error('Acceptance routes were not resolved');

    const imageSceneOne = { ...structuredClone(scene), id: 'scene_image_one', mediaKind: 'image' as const };
    const imageSceneTwo = { ...structuredClone(scene), id: 'scene_image_two', mediaKind: 'image' as const };
    const imageSceneLater = { ...structuredClone(scene), id: 'scene_image_later', mediaKind: 'image' as const };
    const videoScene = { ...structuredClone(scene), id: 'scene_video' };
    const configured = await harness.store.updateProject(harness.project.id, (current) => ({
      ...current,
      sceneOrder: [imageSceneOne.id, imageSceneTwo.id, imageSceneLater.id, videoScene.id],
      scenes: {
        [imageSceneOne.id]: imageSceneOne,
        [imageSceneTwo.id]: imageSceneTwo,
        [imageSceneLater.id]: imageSceneLater,
        [videoScene.id]: videoScene,
      },
      routing: {
        ...current.routing,
        image: {
          providerId: imageRoutes[0].providerId,
          adapterId: imageRoutes[0].adapterId,
          model: imageRoutes[0].model,
        },
        video: {
          providerId: videoRoute.providerId,
          adapterId: videoRoute.adapterId,
          model: videoRoute.model,
        },
      },
    }));
    let jobIndex = 0;
    let idempotencyIndex = 0;
    const manager = createStudioJobManager({
      store: harness.store,
      mediaStore: harness.mediaStore,
      providerResolver,
      adapters: harness.fake.adapters,
      listProviders: async () => [harness.fake.provider],
      createJobId: () => `job_acceptance_${++jobIndex}`,
      createIdempotencyKey: () => `idempotency_acceptance_${++idempotencyIndex}`,
      sleep: harness.clock.sleep,
      jitterMs: (baseMs) => baseMs,
    });
    activeManagers.push(manager);

    const submittedBatch = await manager.submitScenes({
      projectId: configured.id,
      expectedRevision: configured.revision,
      sceneIds: [imageSceneOne.id, imageSceneTwo.id, videoScene.id],
      routes: [
        {
          sceneId: imageSceneOne.id,
          providerId: imageRoutes[0].providerId,
          adapterId: imageRoutes[0].adapterId,
          model: imageRoutes[0].model,
          kind: 'image',
        },
        {
          sceneId: imageSceneTwo.id,
          providerId: imageRoutes[0].providerId,
          adapterId: imageRoutes[0].adapterId,
          model: imageRoutes[0].model,
          kind: 'image',
        },
        {
          sceneId: videoScene.id,
          providerId: videoRoute.providerId,
          adapterId: videoRoute.adapterId,
          model: videoRoute.model,
          kind: 'video',
        },
      ],
      catalogVersion: catalog.generationCatalogVersion,
    });
    expect(submittedBatch.map(({ sceneId: submittedSceneId, provider }) => [submittedSceneId, provider])).toEqual([
      [
        imageSceneOne.id,
        {
          providerId: imageRoutes[0].providerId,
          adapterId: imageRoutes[0].adapterId,
          model: imageRoutes[0].model,
        },
      ],
      [
        imageSceneTwo.id,
        {
          providerId: imageRoutes[0].providerId,
          adapterId: imageRoutes[0].adapterId,
          model: imageRoutes[0].model,
        },
      ],
      [
        videoScene.id,
        {
          providerId: videoRoute.providerId,
          adapterId: videoRoute.adapterId,
          model: videoRoute.model,
        },
      ],
    ]);

    // The per-project cap admits two paid jobs at a time, so this batch of three settles
    // at two `queued_remote` and one still `queued_local` — waiting for all three to reach
    // `queued_remote` would hang forever. Wait for that capped state specifically: it is
    // quiescent until the harness clock is released, so the revision read here stays valid
    // for the compare-and-set below.
    const activeProject = await waitFor(async () => {
      const current = await harness.store.getProject(configured.id);
      const batch = [current?.jobs.job_acceptance_1, current?.jobs.job_acceptance_2, current?.jobs.job_acceptance_3];
      const remote = batch.filter((job) => job?.status === 'queued_remote').length;
      const local = batch.filter((job) => job?.status === 'queued_local').length;
      return current && remote === 2 && local === 1 ? current : null;
    });
    const changed = await harness.store.updateProject(
      configured.id,
      (current) => ({
        ...current,
        routing: {
          ...current.routing,
          image: {
            providerId: imageRoutes[1].providerId,
            adapterId: imageRoutes[1].adapterId,
            model: imageRoutes[1].model,
          },
        },
      }),
      activeProject.revision
    );
    const later = await manager.submitScenes({
      projectId: changed.id,
      expectedRevision: changed.revision,
      sceneIds: [imageSceneLater.id],
      routes: [
        {
          sceneId: imageSceneLater.id,
          providerId: imageRoutes[1].providerId,
          adapterId: imageRoutes[1].adapterId,
          model: imageRoutes[1].model,
          kind: 'image',
        },
      ],
      catalogVersion: catalog.generationCatalogVersion,
    });
    expect(later[0]?.provider).toEqual({
      providerId: imageRoutes[1].providerId,
      adapterId: imageRoutes[1].adapterId,
      model: imageRoutes[1].model,
    });
    harness.clock.releaseAll();
    const persisted = await waitFor(async () => {
      const current = await harness.store.getProject(configured.id);
      return current &&
        Object.values(current.jobs).every((job) =>
          ['succeeded', 'failed', 'cancelled', 'needs_attention'].includes(job.status)
        )
        ? current
        : null;
    });
    expect(persisted.jobs.job_acceptance_1.status).toBe('succeeded');
    expect(persisted.jobs.job_acceptance_1.provider.model).toBe('weprompt-e2e-image');
    expect(persisted.jobs.job_acceptance_2.provider.model).toBe('weprompt-e2e-image');
    expect(persisted.jobs.job_acceptance_4.provider.model).toBe('weprompt-e2e-image-next');
    expect(persisted.routing.image).toEqual({
      providerId: imageRoutes[1].providerId,
      adapterId: imageRoutes[1].adapterId,
      model: imageRoutes[1].model,
    });
  });

  it('moves a remote video through queued and running states before selecting a managed output', async () => {
    const harness = await createHarness();
    const catalog = await createStudioProviderResolver({
      listProviders: async () => [harness.fake.provider],
      listConnections: () => harness.store.listConnections(),
    }).listGenerationRoutes();

    const submitted = await harness.manager.submitScenes({
      projectId: harness.project.id,
      expectedRevision: harness.project.revision,
      sceneIds: [scene.id],
      routes: [harness.route],
      catalogVersion: catalog.generationCatalogVersion,
    });

    expect(submitted).toMatchObject([{ id: 'job_lifecycle', status: 'queued_local', providerJobId: null }]);
    const queued = await waitFor(async () => {
      const job = (await harness.store.getProject(harness.project.id))?.jobs.job_lifecycle;
      return job?.status === 'queued_remote' ? job : null;
    });
    expect(queued.providerJobId).toBe(`${STUDIO_E2E_PROVIDER_JOB_SENTINEL}_1`);

    const firstPoll = await harness.clock.take(2_000);
    firstPoll.release();
    const secondPoll = await harness.clock.take(4_000);
    secondPoll.release();
    const thirdPoll = await harness.clock.take(8_000);
    const running = await waitFor(async () => {
      const job = (await harness.store.getProject(harness.project.id))?.jobs.job_lifecycle;
      return job?.status === 'running' ? job : null;
    });
    expect(running.progress).toBe(50);
    thirdPoll.release();

    const completed = await waitFor(async () => {
      const project = await harness.store.getProject(harness.project.id);
      return project &&
        ['succeeded', 'failed', 'cancelled', 'needs_attention'].includes(project.jobs.job_lifecycle.status)
        ? project
        : null;
    });
    const completedJob = completed.jobs.job_lifecycle;
    expect(completedJob).toMatchObject({ status: 'succeeded', error: null });
    const selectedAssetId = completed.scenes.scene_1.selectedAssetId;
    expect({
      outputAssetIds: completedJob.outputAssetIds,
      selectedAssetId,
      assetIds: completed.scenes.scene_1.assetIds,
      mediaKind: selectedAssetId ? completed.assets[selectedAssetId]?.mediaKind : null,
      collection: selectedAssetId ? completed.assets[selectedAssetId]?.managedAsset.collection : null,
    }).toEqual({
      outputAssetIds: [selectedAssetId],
      selectedAssetId,
      assetIds: [selectedAssetId],
      mediaKind: 'video',
      collection: 'assets',
    });
    const resolved = selectedAssetId ? await harness.mediaStore.resolveAsset(completed.id, selectedAssetId) : null;
    expect(resolved?.asset.id).toBe(selectedAssetId);
    expect(collectForbiddenDtoKeys(completed)).toEqual([]);
    const serialized = JSON.stringify(completed);
    expect(serialized).not.toContain(harness.rootDir);
    const projectManifest = await readFile(path.join(harness.rootDir, completed.id, 'project.json'), 'utf8');
    const connectionManifest = await readFile(path.join(harness.rootDir, 'connections.json'), 'utf8');
    const exportDirectory = path.join(harness.rootDir, 'safe-export');
    await mkdir(exportDirectory);
    const exported = await harness.mediaStore.exportAssetsToDirectory({
      projectId: completed.id,
      destinationDirectory: exportDirectory,
      includeReferences: false,
      timestamp: '20260731-120000',
    });
    const exportedMetadata = await readFile(path.join(exportDirectory, exported.folderName, 'storyboard.json'), 'utf8');
    const mainProcessOnlySentinels = [
      STUDIO_E2E_CREDENTIAL_SENTINEL,
      STUDIO_E2E_PROVIDER_URL_SENTINEL,
      STUDIO_E2E_RAW_OUTPUT_BODY_SENTINEL,
      STUDIO_E2E_RAW_OUTPUT_PATH_SENTINEL,
      harness.rootDir,
    ];
    for (const sentinel of mainProcessOnlySentinels) {
      expect(serialized).not.toContain(sentinel);
      expect(projectManifest).not.toContain(sentinel);
      expect(connectionManifest).not.toContain(sentinel);
      expect(exportedMetadata).not.toContain(sentinel);
    }
    expect(projectManifest).toContain(`${STUDIO_E2E_PROVIDER_JOB_SENTINEL}_1`);
    expect(connectionManifest).not.toContain(STUDIO_E2E_PROVIDER_JOB_SENTINEL);
    expect(exportedMetadata).not.toContain(STUDIO_E2E_PROVIDER_JOB_SENTINEL);
  });

  it('rejects a stale route catalog without persisting or submitting a job', async () => {
    const harness = await createHarness();

    await expect(
      harness.manager.submitScenes({
        projectId: harness.project.id,
        expectedRevision: harness.project.revision,
        sceneIds: [scene.id],
        routes: [harness.route],
        catalogVersion: 'stale_catalog',
      })
    ).rejects.toMatchObject({ code: 'invalid_route' });

    expect((await harness.store.getProject(harness.project.id))?.jobs).toEqual({});
    expect(harness.clock.observedDelays).toEqual([]);
  });
});
