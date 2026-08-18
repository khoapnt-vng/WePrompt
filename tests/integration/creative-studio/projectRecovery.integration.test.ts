/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { IProvider } from '@/common/config/storage';
import type { StudioProject, StudioScene } from '@/common/types/project/creativeStudioTypes';
import {
  createStudioE2EFakeBundle,
  createStudioE2EFakeRemoteState,
  type StudioE2EFakeBundle,
  type StudioE2EFakeRemoteState,
} from '@process/services/creative-studio/adapters/e2eFakeAdapter';
import { createCreativeStudioService } from '@process/services/creative-studio/service';
import {
  createStudioJobManager,
  type StudioJobManager,
  type StudioResolvedShotRouteSnapshotV2,
  type StudioResolvedSceneRouteSnapshot,
} from '@process/services/creative-studio/jobManager';
import { createStudioMediaStore } from '@process/services/creative-studio/mediaStore';
import {
  createStudioProviderResolver,
  type StudioGenerationRouteCatalog,
  type StudioProviderResolver,
} from '@process/services/creative-studio/providerResolver';
import {
  createCreativeStudioRuntime,
  type CreativeStudioRuntime,
  type CreativeStudioRuntimeFactories,
} from '@process/services/creative-studio/runtime';
import { createCreativeStudioStore } from '@process/services/creative-studio/store';
import { afterEach, describe, expect, it, vi } from 'vitest';

const scene: StudioScene = {
  id: 'scene_recovery',
  title: 'Recovery scene',
  purpose: 'Prove durable generation recovery',
  visualPrompt: 'A sunrise reflected in a glass city',
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
  if (attemptsRemaining <= 1) throw new Error('Timed out waiting for Creative Studio recovery state');
  await new Promise<void>((resolve) => setTimeout(resolve, 5));
  return waitFor(read, attemptsRemaining - 1);
};

type PendingSleep = {
  delayMs: number;
  release(): void;
};

class ControlledPollClock {
  private readonly pending: PendingSleep[] = [];
  private autoRelease = false;

  readonly sleep = (delayMs: number, signal: AbortSignal): Promise<void> => {
    if (this.autoRelease) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error): void => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', onAbort);
        if (error) reject(error);
        else resolve();
      };
      const onAbort = (): void => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        finish(error);
      };
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
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

type RecoveryHarness = {
  rootDir: string;
  fake: ReturnType<typeof createStudioE2EFakeBundle>;
  project: StudioProject;
  route: StudioResolvedSceneRouteSnapshot;
  newerImageRoute: StudioResolvedSceneRouteSnapshot;
  catalog: StudioGenerationRouteCatalog;
  manager: StudioJobManager;
  clock: ControlledPollClock;
};

const harnesses: RecoveryHarness[] = [];
const extraManagers = new Set<{ manager: StudioJobManager; clock: ControlledPollClock }>();

const resolverFor = (
  store: ReturnType<typeof createCreativeStudioStore>,
  providers: () => Promise<IProvider[]>
): StudioProviderResolver =>
  createStudioProviderResolver({
    listProviders: providers,
    listConnections: () => store.listConnections(),
  });

const createHarness = async (): Promise<RecoveryHarness> => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'studio-recovery-integration-'));
  const fake = createStudioE2EFakeBundle({ rootDir });
  const store = createCreativeStudioStore({ rootDir });
  await Promise.all(fake.connections.map((connection) => store.saveConnection(connection)));
  const created = await store.createProject({
    name: 'Durable film',
    brief: 'A restart-safe launch story',
    aspectRatio: '16:9',
    targetDurationSeconds: 5,
    resolution: '720p',
  });
  let project = await store.updateProject(created.id, (current) => ({
    ...current,
    sceneOrder: [scene.id],
    scenes: { [scene.id]: { ...structuredClone(scene), mediaKind: 'image' } },
  }));
  const listProviders = async () => [fake.provider];
  const providerResolver = resolverFor(store, listProviders);
  const catalog = await providerResolver.listGenerationRoutes();
  const imageRoutes = catalog.routes
    .filter((candidate) => candidate.kind === 'image')
    .toSorted((left, right) => left.model.localeCompare(right.model));
  const imageRoute = imageRoutes[0];
  const newerImage = imageRoutes[1];
  if (!imageRoute || !newerImage) throw new Error('E2E fake Image A/B routes were not resolved');
  const route: StudioResolvedSceneRouteSnapshot = {
    sceneId: scene.id,
    providerId: imageRoute.providerId,
    adapterId: imageRoute.adapterId,
    model: imageRoute.model,
    kind: imageRoute.kind,
  };
  const newerImageRoute: StudioResolvedSceneRouteSnapshot = {
    sceneId: scene.id,
    providerId: newerImage.providerId,
    adapterId: newerImage.adapterId,
    model: newerImage.model,
    kind: newerImage.kind,
  };
  project = await store.updateProject(project.id, (current) => ({
    ...current,
    routing: {
      ...current.routing,
      image: { providerId: route.providerId, adapterId: route.adapterId, model: route.model },
    },
  }));
  const clock = new ControlledPollClock();
  const manager = createStudioJobManager({
    store,
    mediaStore: createStudioMediaStore({ store }),
    providerResolver,
    adapters: fake.adapters,
    listProviders,
    createJobId: () => 'job_recovery',
    createIdempotencyKey: () => 'idempotency_recovery',
    sleep: clock.sleep,
    jitterMs: (baseMs) => baseMs,
  });
  const harness = { rootDir, fake, project, route, newerImageRoute, catalog, manager, clock };
  harnesses.push(harness);
  return harness;
};

const submitAndStopWithRemoteIdentity = async (harness: RecoveryHarness): Promise<{ providerJobId: string }> => {
  await harness.manager.submitScenes({
    projectId: harness.project.id,
    expectedRevision: harness.project.revision,
    sceneIds: [scene.id],
    routes: [harness.route],
    catalogVersion: harness.catalog.generationCatalogVersion,
  });
  const persisted = await waitFor(async () => {
    const project = await createCreativeStudioStore({ rootDir: harness.rootDir }).getProject(harness.project.id);
    const job = project?.jobs.job_recovery;
    return project && job?.status === 'queued_remote' && job.providerJobId ? { project, job } : null;
  });
  await harness.clock.take(2_000);
  const dispose = harness.manager.dispose();
  harness.clock.releaseAll();
  await dispose;
  return { providerJobId: persisted.job.providerJobId! };
};

const noProviders = async (): Promise<IProvider[]> => [];

type FreshRuntimeHarness = {
  runtime: CreativeStudioRuntime;
  clock: ControlledPollClock;
  bundle: StudioE2EFakeBundle;
};

const createFreshRuntimeHarness = (
  rootDir: string,
  remoteState: StudioE2EFakeRemoteState,
  jobId: string
): FreshRuntimeHarness => {
  const clock = new ControlledPollClock();
  let bundle: StudioE2EFakeBundle | null = null;
  const factories: CreativeStudioRuntimeFactories = {
    createStore: ({ rootDir: runtimeRoot }) => createCreativeStudioStore({ rootDir: runtimeRoot }),
    createMediaStore: ({ store }) => createStudioMediaStore({ store }),
    createAdapters: () => new Map(),
    createPlanner: () => ({
      listModels: async () => [],
      draft: async () => {
        throw new Error('Storyboard drafting was not expected during recovery');
      },
      dispose: async () => {},
    }),
    createProviderResolver: createStudioProviderResolver,
    createJobManager: (input) =>
      createStudioJobManager({
        ...input,
        createJobId: () => jobId,
        createIdempotencyKey: () => `idempotency_${jobId}`,
        sleep: clock.sleep,
        jitterMs: (baseMs) => baseMs,
      }),
    createService: createCreativeStudioService,
    createE2EFakeBundle: ({ rootDir: runtimeRoot }) => {
      bundle = createStudioE2EFakeBundle({ rootDir: runtimeRoot, remoteState });
      return bundle;
    },
  };
  const runtime = createCreativeStudioRuntime({
    rootDir,
    // Pending-job recovery is gated on the Studio release flag, which is off by
    // default. This suite exercises recovery itself, so it opts in explicitly.
    enabled: true,
    environment: { AIONUI_E2E_TEST: '1', AIONUI_E2E_STUDIO_FAKE: '1' },
    isPackaged: false,
    factories,
    listProviders: async () => [],
    onProjectUpdated: () => {},
    protocol: {
      install: () => ({ dispose: async () => {} }),
      uninstall: async (installation) => installation?.dispose(),
    },
  });
  if (bundle === null) throw new Error('Fresh runtime did not install its E2E fake bundle');
  return { runtime, clock, bundle };
};

const rendererSafeKeys = (value: unknown, found: string[] = []): string[] => {
  if (Array.isArray(value)) {
    for (const item of value) rendererSafeKeys(item, found);
    return found;
  }
  if (typeof value !== 'object' || value === null) return found;
  for (const [key, nested] of Object.entries(value)) {
    const normalized = key.replaceAll(/[^A-Za-z0-9]/g, '').toLowerCase();
    if (
      [
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
      ].includes(normalized)
    ) {
      found.push(key);
    }
    rendererSafeKeys(nested, found);
  }
  return found;
};

afterEach(async () => {
  await Promise.all(
    [...extraManagers].map(async (entry) => {
      entry.clock.releaseAll();
      await entry.manager.dispose().catch((): undefined => undefined);
    })
  );
  extraManagers.clear();
  await Promise.all(
    harnesses.splice(0).map(async (harness) => {
      harness.clock.releaseAll();
      await harness.manager.dispose().catch((): undefined => undefined);
      await harness.fake.dispose().catch((): undefined => undefined);
      await rm(harness.rootDir, { recursive: true, force: true });
    })
  );
});

describe('Creative Studio project recovery integration', () => {
  it('reloads the three explicit project model selections without fallback', async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'studio-routing-restart-integration-'));
    try {
      const store = createCreativeStudioStore({ rootDir });
      const project = await store.createProject({
        name: 'Explicit routing film',
        brief: 'Keep every selected model across restart',
        aspectRatio: '16:9',
        targetDurationSeconds: 5,
        resolution: '720p',
      });
      await store.updateProject(project.id, (current) => ({
        ...current,
        routing: {
          storyboard: { providerId: 'text_provider', model: 'gpt-test' },
          image: { providerId: 'media_provider', adapterId: 'weprompt-image-v1', model: 'image-a' },
          video: { providerId: 'media_provider', adapterId: 'weprompt-media-gateway-v1', model: 'video-a' },
        },
      }));

      const reloaded = await createCreativeStudioStore({ rootDir }).getProject(project.id);

      expect(reloaded?.routing).toEqual({
        storyboard: { providerId: 'text_provider', model: 'gpt-test' },
        image: { providerId: 'media_provider', adapterId: 'weprompt-image-v1', model: 'image-a' },
        video: { providerId: 'media_provider', adapterId: 'weprompt-media-gateway-v1', model: 'video-a' },
      });
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it('drafts a storyboard from the stored text model without App Operations availability', async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'studio-storyboard-independent-integration-'));
    try {
      const store = createCreativeStudioStore({ rootDir });
      const project = await store.createProject({
        name: 'Independent storyboard film',
        brief: 'Draft without an App Operations resolver',
        aspectRatio: '16:9',
        targetDurationSeconds: 5,
        resolution: '720p',
      });
      const selected = await store.updateProject(project.id, (current) => ({
        ...current,
        routing: {
          ...current.routing,
          storyboard: { providerId: 'text_provider', model: 'gpt-test' },
        },
      }));
      let draftedWith: { providerId: string; model: string } | null = null;
      const service = createCreativeStudioService({
        store,
        onProjectUpdated: () => {},
        createSceneId: () => 'scene_storyboard',
        storyboardPlanner: {
          listModels: async () => [
            {
              providerId: 'text_provider',
              providerName: 'Text provider',
              model: 'gpt-test',
              health: 'available',
            },
          ],
          draft: async (_input, model) => {
            draftedWith = model;
            return {
              scenes: [
                {
                  title: 'Opening',
                  purpose: 'Introduce the product',
                  visualPrompt: 'A paper airplane crossing a sunrise',
                  narration: '',
                  onScreenText: '',
                  mediaKind: 'video',
                  durationSeconds: 5,
                },
              ],
            };
          },
          dispose: async () => {},
        },
      });

      const drafted = await service.proposeStoryboard({
        projectId: selected.id,
        expectedRevision: selected.revision,
        replaceExisting: false,
      });

      expect(draftedWith).toEqual({ providerId: 'text_provider', model: 'gpt-test' });
      expect(drafted.sceneOrder).toEqual(['scene_storyboard']);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it('recovers an old Image A job after routing changes to Image B without rewriting the canonical selection', async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'studio-runtime-recovery-integration-'));
    const remoteState = createStudioE2EFakeRemoteState();
    const runtimes: FreshRuntimeHarness[] = [];
    try {
      const beforeRestart = createFreshRuntimeHarness(rootDir, remoteState, 'job_runtime_recovery');
      runtimes.push(beforeRestart);
      await beforeRestart.runtime.start();
      const created = await beforeRestart.runtime.service.createProject({
        name: 'Durable runtime film',
        brief: 'A full runtime restart-safe launch story',
        aspectRatio: '16:9',
        targetDurationSeconds: 5,
        resolution: '720p',
      });
      const project = await beforeRestart.runtime.store.updateProject(created.id, (current) => ({
        ...current,
        sceneOrder: [scene.id],
        scenes: { [scene.id]: { ...structuredClone(scene), mediaKind: 'image' } },
      }));
      const catalog = await beforeRestart.runtime.service.listRoutes({ projectId: project.id });
      const imageRoutes = catalog.image.options
        .filter((candidate) => candidate.kind === 'image')
        .toSorted((left, right) => left.model.localeCompare(right.model));
      const imageRouteA = imageRoutes[0];
      const imageRouteB = imageRoutes[1];
      if (!imageRouteA || !imageRouteB) throw new Error('Fresh runtime did not resolve its E2E fake Image A/B routes');
      const selectedProject = await beforeRestart.runtime.service.updateModelSelection({
        projectId: project.id,
        expectedRevision: project.revision,
        role: 'image',
        selection: {
          choiceId: imageRouteA.choiceId,
        },
      });
      await beforeRestart.runtime.service.submitScenes({
        projectId: selectedProject.id,
        expectedRevision: selectedProject.revision,
        mode: 'single',
        sceneIds: [scene.id],
        routes: [
          {
            sceneId: scene.id,
            choiceId: imageRouteA.choiceId,
            kind: imageRouteA.kind,
          },
        ],
        catalogVersion: catalog.catalogVersion,
      });
      const persisted = await waitFor(async () => {
        const current = await beforeRestart.runtime.store.getProject(project.id);
        const job = current?.jobs.job_runtime_recovery;
        return job?.status === 'queued_remote' && job.providerJobId ? job : null;
      });
      const activeProject = await beforeRestart.runtime.store.getProject(project.id);
      if (!activeProject) throw new Error('Active recovery project disappeared');
      const withNewerImageSelection = await beforeRestart.runtime.service.updateModelSelection({
        projectId: project.id,
        expectedRevision: activeProject.revision,
        role: 'image',
        selection: {
          choiceId: imageRouteB.choiceId,
        },
      });
      expect(withNewerImageSelection.jobs.job_runtime_recovery.provider).toEqual({
        choiceId: imageRouteA.choiceId,
        providerId: imageRouteA.providerId,
        model: imageRouteA.model,
      });
      await beforeRestart.clock.take(2_000);
      const providerJobId = persisted.providerJobId!;
      beforeRestart.clock.releaseAll();
      await beforeRestart.runtime.dispose();

      const afterRestart = createFreshRuntimeHarness(rootDir, remoteState, 'unused_recovery_job_id');
      runtimes.push(afterRestart);
      expect(afterRestart.runtime).not.toBe(beforeRestart.runtime);
      expect(afterRestart.runtime.store).not.toBe(beforeRestart.runtime.store);
      expect(afterRestart.runtime.mediaStore).not.toBe(beforeRestart.runtime.mediaStore);
      expect(afterRestart.runtime.adapterRegistry).not.toBe(beforeRestart.runtime.adapterRegistry);
      expect(afterRestart.runtime.providerResolver).not.toBe(beforeRestart.runtime.providerResolver);
      expect(afterRestart.runtime.jobManager).not.toBe(beforeRestart.runtime.jobManager);
      expect(afterRestart.runtime.service).not.toBe(beforeRestart.runtime.service);

      await afterRestart.runtime.start();
      await afterRestart.runtime.onBackendReady();
      (await afterRestart.clock.take(2_000)).release();
      (await afterRestart.clock.take(4_000)).release();
      const finalPoll = await afterRestart.clock.take(8_000);
      const running = await waitFor(async () => {
        const job = (await afterRestart.runtime.store.getProject(project.id))?.jobs.job_runtime_recovery;
        return job?.status === 'running' ? job : null;
      });
      expect(running).toMatchObject({ providerJobId, progress: 50 });
      finalPoll.release();

      const recovered = await waitFor(async () => {
        const current = await afterRestart.runtime.store.getProject(project.id);
        return current?.jobs.job_runtime_recovery.status === 'succeeded' ? current : null;
      });
      const recoveredJob = recovered.jobs.job_runtime_recovery;
      const selectedAssetId = recovered.scenes.scene_recovery.selectedAssetId;
      expect({
        providerJobId: recoveredJob.providerJobId,
        outputAssetIds: recoveredJob.outputAssetIds,
        selectedAssetId,
        selectedAssetMediaKind: selectedAssetId ? recovered.assets[selectedAssetId]?.mediaKind : null,
        projectId: recovered.id,
        jobProvider: recoveredJob.provider,
        imageSelection: recovered.routing.image,
      }).toEqual({
        providerJobId,
        outputAssetIds: [selectedAssetId],
        selectedAssetId,
        selectedAssetMediaKind: 'image',
        projectId: project.id,
        jobProvider: {
          providerId: imageRouteA.providerId,
          adapterId: 'weprompt-image-v1',
          model: imageRouteA.model,
        },
        imageSelection: {
          providerId: imageRouteB.providerId,
          adapterId: 'weprompt-image-v1',
          model: imageRouteB.model,
        },
      });
      const resolved = selectedAssetId
        ? await afterRestart.runtime.mediaStore.resolveAsset(recovered.id, selectedAssetId)
        : null;
      expect(resolved?.asset.managedAsset.collection).toBe('assets');
      const rendererProject = await afterRestart.runtime.service.getProject(project.id);
      expect(rendererProject?.jobs.job_runtime_recovery).not.toHaveProperty('providerJobId');
      expect(rendererProject?.jobs.job_runtime_recovery).not.toHaveProperty('idempotencyKey');
      expect(rendererSafeKeys(recovered)).toEqual([]);
      const serialized = JSON.stringify(recovered);
      expect(serialized).not.toContain(rootDir);
      expect(serialized).not.toContain(afterRestart.bundle.provider.api_key);
      expect(serialized).not.toContain(afterRestart.bundle.provider.base_url);
    } finally {
      for (const harness of runtimes) harness.clock.releaseAll();
      await Promise.all(runtimes.map((harness) => harness.runtime.dispose().catch((): undefined => undefined)));
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it('retries an old Image A job after routing changes to Image B without rewriting the canonical selection', async () => {
    const harness = await createHarness();
    const beforeRestart = await submitAndStopWithRemoteIdentity(harness);
    const store = createCreativeStudioStore({ rootDir: harness.rootDir });
    await store.updateProject(harness.project.id, (current) => ({
      ...current,
      routing: {
        ...current.routing,
        image: {
          providerId: harness.newerImageRoute.providerId,
          adapterId: harness.newerImageRoute.adapterId,
          model: harness.newerImageRoute.model,
        },
      },
    }));
    const clock = new ControlledPollClock();
    const manager = createStudioJobManager({
      store,
      mediaStore: createStudioMediaStore({ store }),
      providerResolver: resolverFor(store, noProviders),
      adapters: harness.fake.adapters,
      listProviders: noProviders,
      sleep: clock.sleep,
      jitterMs: (baseMs) => baseMs,
    });
    extraManagers.add({ manager, clock });

    await manager.resumePendingJobs();

    const recovered = await waitFor(async () => {
      const project = await store.getProject(harness.project.id);
      return project?.jobs.job_recovery.status === 'needs_attention' ? project : null;
    });
    expect(recovered.jobs.job_recovery).toMatchObject({
      providerJobId: beforeRestart.providerJobId,
      status: 'needs_attention',
      error: { code: 'provider_unavailable' },
    });
    expect(recovered.routing.image).toEqual({
      providerId: harness.newerImageRoute.providerId,
      adapterId: harness.newerImageRoute.adapterId,
      model: harness.newerImageRoute.model,
    });
    expect(recovered.scenes.scene_recovery.jobIds).toEqual(['job_recovery']);

    const retryClock = new ControlledPollClock();
    const retryManager = createStudioJobManager({
      store,
      mediaStore: createStudioMediaStore({ store }),
      providerResolver: resolverFor(store, async () => [harness.fake.provider]),
      adapters: harness.fake.adapters,
      listProviders: async () => [harness.fake.provider],
      sleep: retryClock.sleep,
      jitterMs: (baseMs) => baseMs,
    });
    extraManagers.add({ manager: retryManager, clock: retryClock });
    const retried = await retryManager.retryJob({
      projectId: harness.project.id,
      jobId: 'job_recovery',
      expectedRevision: recovered.revision,
    });
    expect(retried).toMatchObject({
      id: 'job_recovery',
      provider: {
        providerId: harness.route.providerId,
        adapterId: harness.route.adapterId,
        model: harness.route.model,
      },
      providerJobId: beforeRestart.providerJobId,
      status: 'queued_remote',
    });
    (await retryClock.take(2_000)).release();
    (await retryClock.take(4_000)).release();
    (await retryClock.take(8_000)).release();
    const completed = await waitFor(async () => {
      const current = await store.getProject(harness.project.id);
      return current?.jobs.job_recovery.status === 'succeeded' ? current : null;
    });
    expect(completed.routing.image).toEqual({
      providerId: harness.newerImageRoute.providerId,
      adapterId: harness.newerImageRoute.adapterId,
      model: harness.newerImageRoute.model,
    });
    expect(completed.jobs.job_recovery.provider).toEqual({
      providerId: harness.route.providerId,
      adapterId: harness.route.adapterId,
      model: harness.route.model,
    });
  });

  it('recovers a shot-owned remote job after restart even when its beat was parked', async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'studio-v2-recovery-integration-'));
    const remoteState = createStudioE2EFakeRemoteState();
    const fake = createStudioE2EFakeBundle({ rootDir, remoteState });
    const managers: Array<{ manager: ReturnType<typeof createStudioJobManager>; clock: ControlledPollClock }> = [];
    try {
      const store = createCreativeStudioStore({ rootDir });
      await Promise.all(fake.connections.map((connection) => store.saveConnection(connection)));
      const listProviders = async () => [fake.provider];
      const providerResolver = resolverFor(store, listProviders);
      const catalog = await providerResolver.listGenerationRoutes();
      const imageRoute = catalog.routes.find((candidate) => candidate.kind === 'image');
      if (!imageRoute) throw new Error('V2 recovery did not resolve the fake image route');
      const route: StudioResolvedShotRouteSnapshotV2 = {
        shotId: 'clip_recovery',
        providerId: imageRoute.providerId,
        adapterId: imageRoute.adapterId,
        model: imageRoute.model,
        kind: 'image',
      };
      const created = await store.createProjectV2({
        name: 'Durable V2 film',
        brief: 'Recover already-paid shot work after parking',
        aspectRatio: '16:9',
        targetDurationSeconds: 5,
        resolution: '720p',
      });
      const unsupported = await store.createProject({
        name: 'Unsupported V1 neighbor',
        brief: 'Recovery must not enter this prototype',
        aspectRatio: '16:9',
        targetDurationSeconds: 5,
        resolution: '720p',
      });
      const configured = await store.updateProjectV2(created.id, (project) => ({
        ...project,
        beatOrder: ['section_recovery'],
        beats: {
          section_recovery: {
            id: 'section_recovery',
            title: 'Recovery beat',
            action: 'Keep the paid work durable',
            look: 'A sunrise reflected in a glass city',
            shotOrder: ['clip_recovery'],
          },
        },
        shots: {
          clip_recovery: {
            id: 'clip_recovery',
            line: 'A paper aircraft crosses the reflection',
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
          image: {
            providerId: route.providerId,
            adapterId: route.adapterId,
            model: route.model,
          },
          video: null,
        },
      }));
      const beforeClock = new ControlledPollClock();
      const before = createStudioJobManager({
        store,
        mediaStore: createStudioMediaStore({ store }),
        providerResolver,
        adapters: fake.adapters,
        listProviders,
        createJobId: () => 'job_v2_recovery',
        createIdempotencyKey: () => 'idempotency_v2_recovery',
        sleep: beforeClock.sleep,
        jitterMs: (baseMs) => baseMs,
      });
      managers.push({ manager: before, clock: beforeClock });

      await before.submitShots({
        projectId: configured.id,
        expectedRevision: configured.revision,
        shotIds: ['clip_recovery'],
        routes: [route],
        catalogVersion: catalog.generationCatalogVersion,
      });
      const pending = await waitFor(async () => {
        try {
          const loaded = await store.getProjectV2(configured.id);
          if (loaded.status !== 'supported') return null;
          const job = loaded.project.jobs.job_v2_recovery;
          return job?.status === 'queued_remote' && job.providerJobId ? job : null;
        } catch {
          return null;
        }
      });
      await store.updateProjectV2(configured.id, (project) => ({
        ...project,
        beatOrder: [],
        bin: [{ kind: 'beat', beatId: 'section_recovery' }],
      }));
      await beforeClock.take(2_000);
      await before.dispose();

      const restartedStore = createCreativeStudioStore({ rootDir });
      const listProjectsV1 = vi.spyOn(restartedStore, 'listProjects').mockImplementation(async () => {
        throw new Error('V1 project listing must stay unreachable from V2 recovery');
      });
      const getProjectV1 = vi.spyOn(restartedStore, 'getProject').mockImplementation(async () => {
        throw new Error('V1 project loading must stay unreachable from V2 recovery');
      });
      const restartedResolver = resolverFor(restartedStore, listProviders);
      const afterClock = new ControlledPollClock();
      const after = createStudioJobManager({
        store: restartedStore,
        mediaStore: createStudioMediaStore({ store: restartedStore }),
        providerResolver: restartedResolver,
        adapters: fake.adapters,
        listProviders,
        sleep: afterClock.sleep,
        jitterMs: (baseMs) => baseMs,
      });
      managers.push({ manager: after, clock: afterClock });
      await after.resumePendingJobsV2([unsupported.id, configured.id]);
      (await afterClock.take(2_000)).release();
      (await afterClock.take(4_000)).release();
      (await afterClock.take(8_000)).release();

      const recovered = await waitFor(async () => {
        try {
          const loaded = await restartedStore.getProjectV2(configured.id);
          return loaded.status === 'supported' && loaded.project.jobs.job_v2_recovery.status === 'succeeded'
            ? loaded.project
            : null;
        } catch {
          // A separate store instance can observe the guarded lstat/open identity changing across an atomic replace.
          return null;
        }
      });
      const recoveredJob = recovered.jobs.job_v2_recovery;
      const selectedTakeId = recovered.shots.clip_recovery.selectedTakeId;
      expect({
        providerJobId: recoveredJob.providerJobId,
        status: recoveredJob.status,
        shotId: recoveredJob.shotId,
        outputAssetIds: recoveredJob.outputAssetIds,
        selectedTakeId,
        assetShotId: selectedTakeId ? recovered.assets[selectedTakeId]?.shotId : null,
        beatOrder: recovered.beatOrder,
        bin: recovered.bin,
      }).toEqual({
        providerJobId: pending.providerJobId,
        status: 'succeeded',
        shotId: 'clip_recovery',
        outputAssetIds: [selectedTakeId],
        selectedTakeId,
        assetShotId: 'clip_recovery',
        beatOrder: [],
        bin: [{ kind: 'beat', beatId: 'section_recovery' }],
      });
      expect(listProjectsV1).not.toHaveBeenCalled();
      expect(getProjectV1).not.toHaveBeenCalled();
    } finally {
      for (const { clock } of managers) clock.releaseAll();
      await Promise.all(managers.map(({ manager }) => manager.dispose().catch((): undefined => undefined)));
      await fake.dispose().catch((): undefined => undefined);
      await rm(rootDir, { recursive: true, force: true });
    }
  });
});
