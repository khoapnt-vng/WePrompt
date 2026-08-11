/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
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
  type StudioResolvedSceneRouteSnapshot,
} from '@process/services/creative-studio/jobManager';
import { createStudioMediaStore } from '@process/services/creative-studio/mediaStore';
import { createStudioProviderResolver } from '@process/services/creative-studio/providerResolver';
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
  it('commits a scene-owned reference before using it as the first frame of a later take', async () => {
    const harness = await createHarness();
    const providerResolver = createStudioProviderResolver({
      listProviders: async () => [harness.fake.provider],
      listConnections: () => harness.store.listConnections(),
    });
    const catalog = await providerResolver.listGenerationRoutes();
    const imageRoute = catalog.routes.find((candidate) => candidate.kind === 'image');
    const videoRoute = catalog.routes.find((candidate) => candidate.kind === 'video');
    if (!imageRoute || !videoRoute) throw new Error('Reference lifecycle routes were not resolved');
    expect(videoRoute.constraints.supportsFirstFrame).toBe(true);

    const configured = await harness.store.updateProject(harness.project.id, (current) => ({
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
    const fakeVideoAdapter = adapters.get(videoRoute.adapterId);
    if (!fakeVideoAdapter) throw new Error('E2E fake video adapter was not resolved');
    const videoRequests: ResolvedStudioGenerationRequest[] = [];
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
      referencePrompt: '  A precise sunrise reference plate  ',
    });

    const plated = await waitFor(async () => {
      const current = await harness.store.getProject(configured.id);
      return current?.jobs.job_reference_lifecycle.status === 'succeeded' ? current : null;
    });
    const platedScene = plated.scenes[scene.id];
    const referenceAssetId = platedScene.referenceAssetId;
    if (!referenceAssetId) throw new Error('Reference job succeeded without a committed asset');
    const referenceAsset = plated.assets[referenceAssetId];
    expect({
      referenceAssetId,
      outputAssetIds: plated.jobs.job_reference_lifecycle.outputAssetIds,
      sceneId: referenceAsset?.sceneId,
      collection: referenceAsset?.managedAsset.collection,
      assetIds: platedScene.assetIds,
    }).toEqual({
      referenceAssetId,
      outputAssetIds: [referenceAssetId],
      sceneId: scene.id,
      collection: 'references',
      assetIds: [referenceAssetId],
    });
    expect(platedScene.selectedAssetId).toBeNull();
    expect(platedScene.reviewState).toBe('draft');
    expect(
      Object.values(plated.assets).some((asset) => isCanonicalStudioGeneratedTake(asset, plated.id, platedScene))
    ).toBe(false);

    await manager.submitScenes({
      projectId: plated.id,
      expectedRevision: plated.revision,
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
      catalogVersion: catalog.generationCatalogVersion,
    });

    const takeRequest = await waitFor(async () => videoRequests[0] ?? null);
    expect(takeRequest.firstFrame).toMatchObject({
      assetId: referenceAssetId,
      mimeType: 'image/png',
    });
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
