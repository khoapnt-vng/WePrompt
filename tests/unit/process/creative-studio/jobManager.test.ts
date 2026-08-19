/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { promises as nodeFs } from 'node:fs';
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import { Readable } from 'node:stream';
import type { IProvider, TProviderWithModel } from '@/common/config/storage';
import { buildFirstFramePrompt } from '@/common/types/project/creativeStudioReferencePrompt';
import type {
  StudioBriefRule,
  StudioCancellationPolicy,
  StudioDirectorCommandRecordV1,
  StudioGenerationRequestPlan,
  StudioJob,
  StudioJobV2,
  StudioJobStatus,
  StudioProject,
  StudioProjectV2,
  StudioProviderAdapterId,
  StudioProviderRef,
  StudioQuotedGeneration,
  StudioRouteConstraints,
  StudioScene,
  StudioSpendAuthorization,
} from '@/common/types/project/creativeStudioTypes';
import type {
  StudioGenerationRoute,
  StudioGenerationRouteCatalog,
} from '@process/services/creative-studio/providerResolver';
import {
  createImageGenerationAdapter,
  type GenerationProviderAdapter,
  ProviderDeadlineError,
  type ProviderJobSnapshot,
  type ProviderOutput,
  type ProviderSubmitResult,
  validateImageConditioningRequest,
} from '@process/services/creative-studio/adapters';
import {
  canCancelJob,
  canCancelJobV2,
  createStudioJobManager,
  type StudioJobManager,
  type StudioJobManagerV2,
  type StudioJobManagerDeps,
  type StudioResolvedSceneRouteSnapshot,
} from '@process/services/creative-studio/jobManager';
import { createOpenRouterVideoAdapter } from '@process/services/creative-studio/adapters/openRouterVideoAdapter';
import {
  CreativeStudioMediaError,
  createStudioMediaStore,
  type StudioMediaStore,
  type StudioMediaStoreDeps,
} from '@process/services/creative-studio/mediaStore';
import { createStudioDirectorCommandService } from '@process/services/creative-studio/service/directorCommandService';
import {
  calculateStudioQuoteTotals,
  createStudioQuotedGenerationId,
} from '@process/services/creative-studio/service/schema2/generation';
import { createStudioSpendReceiptV2 } from '@process/services/creative-studio/service/schema2/pricing';
import { createCreativeStudioStore, type CreativeStudioStore } from '@process/services/creative-studio/store';
import type { RemoteMediaBudget } from '@process/services/remote-media';
import { afterEach, describe, expect, it, vi } from 'vitest';

const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489', 'hex');
const mp4 = Buffer.from('000000186674797069736f6d00000000', 'hex');
const SUBMISSION_DEADLINE_MS = 5 * 60_000;
const REMOTE_POLL_ATTEMPT_TIMEOUT_MS = 60_000;
const REMOTE_POLL_DEADLINE_MS = 30 * 60_000;
// BUG-027: CI load can exhaust these two tests' fixed filesystem poll budget.
// Tracking: search BUG-027 in https://github.com/khoapnt-vng/WePrompt/blob/sprint3/TASKS.md
// (TASKS.md records bugs as list items, not headings, so a generated heading
// anchor does not resolve.)
const BUG_027_CI_RETRY = process.env.CI ? 2 : 0;

const provider: IProvider = {
  id: 'provider_1',
  platform: 'openai',
  name: 'Image provider',
  base_url: 'https://provider.example/v1',
  api_key: 'secret',
  models: ['image-model'],
};

const route: StudioResolvedSceneRouteSnapshot = {
  sceneId: 'scene_1',
  providerId: provider.id,
  adapterId: 'weprompt-image-v1',
  model: 'image-model',
  kind: 'image',
};

const selectionFor = (candidate: StudioResolvedSceneRouteSnapshot) => ({
  providerId: candidate.providerId,
  adapterId: candidate.adapterId,
  model: candidate.model,
});

const incompatibleConstraints: Array<[string, Partial<StudioRouteConstraints>]> = [
  ['aspect ratio', { aspectRatios: ['1:1'] }],
  ['resolution', { resolutions: ['1080p'] }],
  ['minimum duration', { minDurationSeconds: 6 }],
  ['maximum duration', { maxDurationSeconds: 4 }],
];

const catalog = (
  routes: StudioResolvedSceneRouteSnapshot[] = [route],
  cancellationPolicy: StudioCancellationPolicy = 'none'
): StudioGenerationRouteCatalog => ({
  routes: routes.map((candidate) => ({
    providerId: candidate.providerId,
    providerName: 'Provider',
    model: candidate.model,
    health: 'available',
    adapterId: candidate.adapterId,
    kind: candidate.kind,
    cancellationPolicy,
    constraints: {
      aspectRatios: ['16:9'],
      resolutions: ['720p'],
      minDurationSeconds: 1,
      maxDurationSeconds: 60,
      supportsFirstFrame: true,
      maxConditioningImages: 0,
      silentOutput: true,
    },
  })),
  diagnostics: [],
  generationCatalogVersion: 'catalog_1',
});

const scene = (overrides: Partial<StudioScene> = {}): StudioScene => ({
  id: 'scene_1',
  title: 'Opening',
  purpose: 'Introduce the product',
  visualPrompt: 'A paper airplane crossing a sunrise',
  narration: '',
  onScreenText: '',
  mediaKind: 'image',
  durationSeconds: 5,
  referenceAssetId: null,
  selectedAssetId: null,
  assetIds: [],
  jobIds: [],
  reviewState: 'ready',
  ...overrides,
});

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
};

const deferred = <T>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const rejectDeferredOnAbort = <T>(gate: Deferred<T>, signal: AbortSignal): void => {
  signal.addEventListener('abort', () => gate.reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), {
    once: true,
  });
};

const waitFor = async (assertion: () => void | Promise<void>, attempts = 100): Promise<void> => {
  let latestError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await assertion();
      return;
    } catch (error) {
      latestError = error;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }
  throw latestError;
};

const fsWithoutDiskBarriers = new Proxy(nodeFs, {
  get(target, property, receiver) {
    if (property !== 'open') return Reflect.get(target, property, receiver);
    return async (...args: Parameters<typeof nodeFs.open>) => {
      const handle = await nodeFs.open(...args);
      return new Proxy(handle, {
        get(handleTarget, handleProperty, handleReceiver) {
          if (handleProperty === 'sync') return async (): Promise<void> => undefined;
          const value = Reflect.get(handleTarget, handleProperty, handleReceiver) as unknown;
          return typeof value === 'function' ? value.bind(handleTarget) : value;
        },
      });
    };
  },
}) as typeof nodeFs;

type Harness = {
  rootDir: string;
  store: CreativeStudioStore;
  mediaStore: StudioMediaStore;
  project: StudioProject;
  manager: StudioJobManager;
};

const harnesses: Harness[] = [];

type HarnessOptions = {
  scenes?: StudioScene[];
  routes?: StudioResolvedSceneRouteSnapshot[];
  provider?: IProvider;
  additionalAdapters?: GenerationProviderAdapter[];
  jobIds?: string[];
  idempotencyKeys?: string[];
  sleep?: (delayMs: number, signal: AbortSignal) => Promise<void>;
  jitterMs?: (baseMs: number, attempt: number) => number;
  catalog?: () => Promise<StudioGenerationRouteCatalog>;
  decorateMediaStore?: (mediaStore: StudioMediaStore) => StudioMediaStore;
  onProjectUpdated?: (projectId: string) => void;
  cancellationPolicy?: StudioCancellationPolicy;
  isGenerationRouteAvailable?: (candidate: StudioResolvedSceneRouteSnapshot) => Promise<boolean>;
  now?: () => string;
  nowEpochMs?: () => number;
  outputDownloader?: StudioJobManagerDeps['outputDownloader'];
};

const sequence = (values: string[]): (() => string) => {
  let index = 0;
  return () => values[index++] ?? `generated_${index}`;
};

const createHarness = async (adapter: GenerationProviderAdapter, options: HarnessOptions = {}): Promise<Harness> => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'studio-job-manager-'));
  const store = createCreativeStudioStore({ rootDir, fs: fsWithoutDiskBarriers });
  const scenes = options.scenes ?? [scene()];
  const routes = options.routes ?? [route];
  const selectedProvider = options.provider ?? provider;
  const selectedRoute = (kind: StudioResolvedSceneRouteSnapshot['kind']) => {
    const candidate = routes.find((routeCandidate) => routeCandidate.kind === kind);
    return candidate ? selectionFor(candidate) : null;
  };
  const created = await store.createProject({
    name: 'Launch film',
    brief: 'A concise launch story',
    aspectRatio: '16:9',
    targetDurationSeconds: scenes.reduce((total, candidate) => total + candidate.durationSeconds, 0),
    resolution: '720p',
  });
  const project = await store.updateProject(created.id, (current) => ({
    ...current,
    sceneOrder: scenes.map((candidate) => candidate.id),
    scenes: Object.fromEntries(scenes.map((candidate) => [candidate.id, candidate])),
    routing: {
      storyboard: selectedRoute('storyboard'),
      image: selectedRoute('image'),
      video: selectedRoute('video'),
    },
  }));
  const mediaStore = createStudioMediaStore({ store });
  const managerMediaStore = options.decorateMediaStore?.(mediaStore) ?? mediaStore;
  const manager = createStudioJobManager({
    store,
    mediaStore: managerMediaStore,
    providerResolver: {
      listConnectionCandidates: async () => [],
      listGenerationRoutes: options.catalog ?? (async () => catalog(routes, options.cancellationPolicy)),
      isGenerationRouteAvailable:
        options.isGenerationRouteAvailable ??
        (async (candidate) =>
          routes.some(
            (available) =>
              available.providerId === candidate.providerId &&
              available.adapterId === candidate.adapterId &&
              available.model === candidate.model &&
              available.kind === candidate.kind
          )),
    },
    adapters: new Map([adapter, ...(options.additionalAdapters ?? [])].map((candidate) => [candidate.id, candidate])),
    listProviders: async () => [selectedProvider],
    createJobId: sequence(options.jobIds ?? ['job_1']),
    createIdempotencyKey: sequence(options.idempotencyKeys ?? ['key_1']),
    sleep: options.sleep,
    jitterMs: options.jitterMs ?? ((baseMs) => baseMs),
    now: options.now,
    nowEpochMs: options.nowEpochMs,
    ...(options.onProjectUpdated === undefined ? {} : { onProjectUpdated: options.onProjectUpdated }),
    ...(options.outputDownloader === undefined ? {} : { outputDownloader: options.outputDownloader }),
  });
  const harness = { rootDir, store, mediaStore, project, manager };
  harnesses.push(harness);
  return harness;
};

type V2Harness = {
  rootDir: string;
  store: CreativeStudioStore;
  mediaStore: StudioMediaStore;
  project: StudioProjectV2;
  manager: StudioJobManager & StudioJobManagerV2;
  providerResolver: StudioJobManagerDeps['providerResolver'];
  listProviders: StudioJobManagerDeps['listProviders'];
  authorization: StudioSpendAuthorization;
  item: StudioQuotedGeneration;
  jobs: StudioJobV2[];
  route: StudioGenerationRoute;
};

type V2HarnessOptions = {
  purpose?: StudioJobV2['purpose'];
  generationCount?: number;
  requestPlan?: StudioGenerationRequestPlan;
  jobIds?: string[];
  idempotencyKeys?: string[];
  sleep?: (delayMs: number, signal: AbortSignal) => Promise<void>;
  now?: () => string;
  nowEpochMs?: () => number;
  cancellationPolicy?: StudioCancellationPolicy;
  providerResolver?: StudioJobManagerDeps['providerResolver'];
  listProviders?: StudioJobManagerDeps['listProviders'];
  outputDownloader?: StudioJobManagerDeps['outputDownloader'];
  decorateMediaStore?: (mediaStore: StudioMediaStore) => StudioMediaStore;
  probeVideoDurationSecondsV2?: StudioMediaStoreDeps['probeVideoDurationSecondsV2'];
  jobOverrides?: (generationIndex: number) => Partial<StudioJobV2>;
};

const v2Harnesses: V2Harness[] = [];

const makeResolvedPlanV2 = (
  purpose: StudioJobV2['purpose']
): Extract<StudioGenerationRequestPlan, { kind: 'resolved' }> => ({
  kind: 'resolved',
  snapshot: {
    prompt: purpose === 'seed_still' ? 'A frozen seed prompt' : 'A frozen video prompt',
    aspectRatio: '16:9',
    resolution: '720p',
    durationSeconds: 5,
    referenceInput: null,
    conditioningInput: null,
  },
});

const createV2Harness = async (
  adapter: GenerationProviderAdapter,
  options: V2HarnessOptions = {}
): Promise<V2Harness> => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'studio-job-manager-v2-'));
  const fixedNow = options.now ?? (() => '2026-08-17T12:00:02.000Z');
  const store = createCreativeStudioStore({ rootDir, fs: fsWithoutDiskBarriers, now: fixedNow });
  const purpose = options.purpose ?? 'seed_still';
  const generationCount = options.generationCount ?? 1;
  const providerBinding: StudioProviderRef = {
    providerId: provider.id,
    adapterId: adapter.id,
    model: purpose === 'seed_still' ? 'image-model' : 'video-model',
  };
  const routeId = purpose === 'seed_still' ? 'route_image' : 'route_video';
  const route: StudioGenerationRoute = {
    choiceId: routeId,
    ...providerBinding,
    providerName: 'Provider',
    health: 'available',
    kind: purpose === 'seed_still' ? 'image' : 'video',
    cancellationPolicy: options.cancellationPolicy ?? 'queued_and_running',
    constraints: {
      aspectRatios: ['16:9'],
      resolutions: ['720p'],
      minDurationSeconds: 1,
      maxDurationSeconds: 60,
      supportsFirstFrame: true,
      maxConditioningImages: 6,
      silentOutput: true,
    },
  };
  const created = await store.createProjectV2({
    name: 'V2 launch film',
    brief: 'A concise shot-owned launch story',
    aspectRatio: '16:9',
    targetDurationSeconds: 5,
    resolution: '720p',
  });
  const authored = await store.updateProjectV2(created.id, (current) => ({
    ...current,
    beatOrder: ['beat_1'],
    beats: {
      beat_1: {
        id: 'beat_1',
        title: 'Opening',
        action: 'Introduce the product',
        look: 'A luminous paper world',
        actionRevision: 1,
        targetSeconds: null,
        shotOrder: ['shot_1'],
        lineHistory: [],
      },
    },
    shots: {
      shot_1: {
        id: 'shot_1',
        line: 'A paper airplane crosses a sunrise',
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
    },
    imageRouteId: purpose === 'seed_still' ? routeId : null,
    videoRouteId: purpose === 'video_take' ? routeId : null,
  }));
  let quotedProject = authored;
  if (purpose === 'video_take') {
    const importsDirectory = path.join(rootDir, authored.id, 'imports');
    await nodeFs.mkdir(importsDirectory, { recursive: true });
    await writeFile(path.join(importsDirectory, 'seed_v2.png'), png);
    quotedProject = await store.updateProjectV2(authored.id, (current) => {
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
      return current;
    });
  }
  const requestPlan =
    options.requestPlan ??
    (purpose === 'video_take'
      ? {
          kind: 'resolved' as const,
          snapshot: {
            ...makeResolvedPlanV2(purpose).snapshot,
            conditioningInput: { kind: 'seed_still' as const, assetId: 'seed_v2' },
          },
        }
      : makeResolvedPlanV2(purpose));
  const item: StudioQuotedGeneration = {
    id: createStudioQuotedGenerationId({
      projectId: quotedProject.id,
      projectRevision: quotedProject.revision,
      shotId: 'shot_1',
      purpose,
    }),
    shotId: 'shot_1',
    purpose,
    routeId,
    generationCount,
    requestPlan,
    rateUnit: purpose === 'seed_still' ? 'generation' : 'second',
    rateMinorUnits: 3,
  };
  const totals = calculateStudioQuoteTotals([item]);
  if (totals === null) throw new Error('invalid V2 quote fixture');
  const jobIds = options.jobIds ?? Array.from({ length: generationCount }, (_, index) => `job_v2_${index + 1}`);
  const idempotencyKeys =
    options.idempotencyKeys ?? Array.from({ length: generationCount }, (_, index) => `key_v2_${index + 1}`);
  const authorization: StudioSpendAuthorization = {
    id: 'authorization_v2',
    projectId: quotedProject.id,
    projectRevision: quotedProject.revision,
    originReferenceHandoffId: null,
    rateCardDigest: 'b'.repeat(64),
    currency: 'USD',
    baseItems: [item],
    cascadeItems: [],
    lowerMinorUnits: totals.lowerMinorUnits,
    upperMinorUnits: totals.upperMinorUnits,
    expiresAt: '2026-08-17T12:05:00.000Z',
    confirmedAt: '2026-08-17T12:00:01.000Z',
    providerBindings: [{ itemId: item.id, provider: providerBinding }],
    idempotencyKeys: idempotencyKeys.map((key, generationIndex) => ({
      itemId: item.id,
      generationIndex,
      key,
    })),
  };
  const timestamp = quotedProject.updatedAt;
  const jobs = jobIds.map<StudioJobV2>((id, generationIndex) => ({
    id,
    projectId: quotedProject.id,
    shotId: 'shot_1',
    status: requestPlan.kind === 'resolved' ? 'queued_local' : 'waiting_for_conditioning',
    provider: providerBinding,
    idempotencyKey: idempotencyKeys[generationIndex]!,
    providerJobId: null,
    remoteStartedAt: null,
    cancellationPolicy: route.cancellationPolicy,
    outputAssetIds: [],
    error: null,
    retryOfJobId: null,
    retryReason: null,
    duplicateChargeAcknowledged: false,
    duplicateChargeAcknowledgedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    purpose,
    authorizationId: authorization.id,
    authorizationItemId: item.id,
    generationIndex,
    requestPlan,
    requestSnapshot: requestPlan.kind === 'resolved' ? requestPlan.snapshot : null,
    spendReceipt: null,
    outputAssetIdsByRole: { primary: null, poster: null },
    ...options.jobOverrides?.(generationIndex),
  }));
  const project = await store.updateProjectV2(quotedProject.id, (current) => {
    current.spendAuthorizations = [authorization];
    current.jobs = Object.fromEntries(jobs.map((job) => [job.id, job]));
    current.shots.shot_1!.jobIds = jobs.map((job) => job.id);
    return current;
  });
  const baseMediaStore = createStudioMediaStore({
    store,
    ...(options.probeVideoDurationSecondsV2 === undefined
      ? {}
      : { probeVideoDurationSecondsV2: options.probeVideoDurationSecondsV2 }),
  });
  const mediaStore = options.decorateMediaStore?.(baseMediaStore) ?? baseMediaStore;
  const providerResolver =
    options.providerResolver ??
    ({
      listConnectionCandidates: async () => [],
      listGenerationRoutes: async () => ({ routes: [route], diagnostics: [], generationCatalogVersion: 'catalog_v2' }),
      isGenerationRouteAvailable: async (candidate) =>
        candidate.providerId === route.providerId &&
        candidate.adapterId === route.adapterId &&
        candidate.model === route.model &&
        candidate.kind === route.kind,
    } satisfies StudioJobManagerDeps['providerResolver']);
  const listProviders =
    options.listProviders ??
    (async () => [{ ...provider, models: [...new Set([...provider.models, providerBinding.model])] }]);
  const manager = createStudioJobManager({
    store,
    mediaStore,
    providerResolver,
    adapters: new Map([[adapter.id, adapter]]),
    listProviders,
    createJobId: sequence(['unused_job_v2']),
    createIdempotencyKey: sequence(['unused_key_v2']),
    sleep: options.sleep,
    jitterMs: (baseMs) => baseMs,
    now: options.now,
    nowEpochMs: options.nowEpochMs,
    ...(options.outputDownloader === undefined ? {} : { outputDownloader: options.outputDownloader }),
  });
  const harness = {
    rootDir,
    store,
    mediaStore,
    project,
    manager,
    providerResolver,
    listProviders,
    authorization,
    item,
    jobs,
    route,
  };
  v2Harnesses.push(harness);
  return harness;
};

const dispatchV2 = (harness: V2Harness, jobIds = harness.jobs.map((job) => job.id)) =>
  harness.manager.dispatchAuthorizedJobsV2({ projectId: harness.project.id, jobIds });

const expectV2Job = async (harness: V2Harness, expected: Partial<StudioJobV2>, jobId = 'job_v2_1'): Promise<void> =>
  waitFor(async () => {
    const loaded = await harness.store.getProjectV2(harness.project.id);
    if (loaded.status !== 'supported') throw new Error('V2 project disappeared');
    expect(loaded.project.jobs[jobId]).toMatchObject(expected);
  });

const createProjectFixture = async (
  store: CreativeStudioStore,
  name: string,
  scenes: StudioScene[],
  routes: StudioResolvedSceneRouteSnapshot[]
): Promise<StudioProject> => {
  const selectedRoute = (kind: StudioResolvedSceneRouteSnapshot['kind']) => {
    const candidate = routes.find((routeCandidate) => routeCandidate.kind === kind);
    return candidate ? selectionFor(candidate) : null;
  };
  const created = await store.createProject({
    name,
    brief: '',
    aspectRatio: '16:9',
    targetDurationSeconds: Math.max(
      5,
      scenes.reduce((total, candidate) => total + candidate.durationSeconds, 0)
    ),
    resolution: '720p',
  });
  return store.updateProject(created.id, (project) => ({
    ...project,
    sceneOrder: scenes.map((candidate) => candidate.id),
    scenes: Object.fromEntries(scenes.map((candidate) => [candidate.id, candidate])),
    routing: {
      storyboard: selectedRoute('storyboard'),
      image: selectedRoute('image'),
      video: selectedRoute('video'),
    },
  }));
};

const waitForProjectWrites = async (store: CreativeStudioStore, projectId: string): Promise<void> => {
  await store.updateProject(projectId, (project) => project);
};

const mixedSchedulingFixture = () => {
  const selectedProvider: IProvider = {
    ...provider,
    models: ['image-model', 'video-model'],
  };
  const scenes = [
    scene({
      id: 'scene_video',
      title: 'Video',
      visualPrompt: 'video_prompt',
      mediaKind: 'video',
      durationSeconds: 4,
    }),
    scene({ id: 'scene_image_first', title: 'First image', visualPrompt: 'image_prompt_first' }),
    scene({ id: 'scene_image_waiting', title: 'Waiting image', visualPrompt: 'image_prompt_waiting' }),
  ];
  const routes: StudioResolvedSceneRouteSnapshot[] = scenes.map((candidate) => ({
    sceneId: candidate.id,
    providerId: selectedProvider.id,
    adapterId: candidate.mediaKind === 'video' ? 'weprompt-media-gateway-v1' : 'weprompt-image-v1',
    model: `${candidate.mediaKind}-model`,
    kind: candidate.mediaKind,
  }));
  return { selectedProvider, scenes, routes };
};

type SeedRemoteJobOptions = {
  status?: 'queued_remote' | 'running' | 'needs_attention' | 'failed';
  providerJobId?: string;
  remoteStartedAt?: string | null;
  omitRemoteStartedAt?: boolean;
  createdAt?: string;
  cancellationPolicy?: StudioCancellationPolicy;
  error?: StudioJob['error'];
};

const seedRemoteJob = async (harness: Harness, options: SeedRemoteJobOptions = {}): Promise<StudioProject> =>
  harness.store.updateProject(harness.project.id, (project) => {
    const next = structuredClone(project);
    const status = options.status ?? 'queued_remote';
    const createdAt = options.createdAt ?? project.createdAt;
    const job: StudioJob = {
      id: 'job_1',
      projectId: project.id,
      sceneId: 'scene_1',
      status,
      provider: selectionFor(route),
      idempotencyKey: 'key_1',
      providerJobId: options.providerJobId ?? 'remote_1',
      remoteStartedAt: options.remoteStartedAt ?? createdAt,
      cancellationPolicy: options.cancellationPolicy ?? 'queued_and_running',
      outputAssetIds: [],
      error: options.error ?? null,
      retryOfJobId: null,
      retryReason: null,
      duplicateChargeAcknowledged: false,
      duplicateChargeAcknowledgedAt: null,
      createdAt,
      updatedAt: project.updatedAt,
    };
    if (options.omitRemoteStartedAt) delete job.remoteStartedAt;
    next.jobs.job_1 = job;
    next.scenes.scene_1.jobIds = ['job_1'];
    next.scenes.scene_1.reviewState = status === 'needs_attention' || status === 'failed' ? 'blocked' : 'generating';
    return next;
  });

const completeAdapter = (
  id: StudioProviderAdapterId,
  outputs: ProviderOutput[] | (() => ProviderOutput[])
): GenerationProviderAdapter => ({
  id,
  validateConnection: async () => ({ ok: true }),
  validateRequest: (request) => ({
    ok: true,
    normalized: {
      aspectRatio: request.aspectRatio,
      resolution: request.resolution,
      durationSeconds: request.durationSeconds,
    },
  }),
  submit: async () => ({ kind: 'complete', outputs: typeof outputs === 'function' ? outputs() : outputs }),
});

const controllableAdapter = (
  id: StudioProviderAdapterId,
  methods: Pick<GenerationProviderAdapter, 'submit'> & Partial<Pick<GenerationProviderAdapter, 'poll' | 'cancel'>>
): GenerationProviderAdapter => ({
  id,
  validateConnection: async () => ({ ok: true }),
  validateRequest: (request) => ({
    ok: true,
    normalized: {
      aspectRatio: request.aspectRatio,
      resolution: request.resolution,
      durationSeconds: request.durationSeconds,
    },
  }),
  ...methods,
});

const createRemoteOutputDownloader = (bytes: Buffer, contentType: string) =>
  vi.fn(
    (
      _provider: TProviderWithModel,
      _adapterId: StudioProviderAdapterId,
      signal: AbortSignal,
      budget?: RemoteMediaBudget
    ) => ({
      lookup: async () => [{ address: '8.8.8.8', family: 4 as const }],
      request: async () => ({
        statusCode: 200,
        headers: { 'content-length': String(bytes.length), 'content-type': contentType },
        remoteAddress: '8.8.8.8',
        body: Readable.from([bytes]),
      }),
      signal,
      timeoutMs: budget?.timeoutMs ?? 1,
    })
  );

afterEach(async () => {
  await Promise.all(
    harnesses.splice(0).map(async (harness) => {
      await harness.manager.dispose();
      await rm(harness.rootDir, { recursive: true, force: true });
    })
  );
  await Promise.all(
    v2Harnesses.splice(0).map(async (harness) => {
      await harness.manager.dispose();
      await rm(harness.rootDir, { recursive: true, force: true });
    })
  );
});

describe('StudioJobManager durable submission', () => {
  it('treats an absent legacy cancellation policy as none', () => {
    expect(
      canCancelJob({
        status: 'queued_remote',
        providerJobId: 'remote_legacy',
      } as StudioJob)
    ).toBe(false);
  });

  it('treats an absent schema-2 cancellation policy as none', () => {
    expect(
      canCancelJobV2({
        status: 'queued_remote',
        providerJobId: 'remote_schema_2',
        spendReceipt: null,
      } as StudioJobV2)
    ).toBe(false);
  });

  it('rejects a revision-N request after a real Director edit commits N+1 before any paid boundary or job write', async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'studio-job-manager-director-race-'));
    const store = createCreativeStudioStore({ rootDir });
    const created = await store.createProject({
      name: 'Director race',
      brief: 'Keep the paid review pinned',
      aspectRatio: '16:9',
      targetDurationSeconds: 5,
      resolution: '720p',
    });
    const reviewed = await store.updateProject(created.id, (current) => ({
      ...current,
      sceneOrder: ['scene_1'],
      scenes: { scene_1: scene({ visualPrompt: 'Prompt A' }) },
      routing: { storyboard: null, image: selectionFor(route), video: null },
    }));
    const commandCreatedAtMs = Date.now();
    const command: StudioDirectorCommandRecordV1 = {
      schemaVersion: 1,
      commandId: 'command_director_paid_race',
      projectId: reviewed.id,
      expectedRevision: reviewed.revision,
      createdAt: new Date(commandCreatedAtMs).toISOString(),
      deadlineAt: new Date(commandCreatedAtMs + 15_000).toISOString(),
      policy: 'auto_apply',
      operations: [{ kind: 'edit_scene', sceneId: 'scene_1', changes: { visualPrompt: 'Prompt B' } }],
    };
    const directorService = createStudioDirectorCommandService({ store, now: () => commandCreatedAtMs });
    const directorResult = await directorService.apply(command, commandCreatedAtMs + 13_000, {
      commitTag: command.commandId,
    });

    const listGenerationRoutes = vi.fn(async () => {
      throw new Error('provider catalog must stay unreachable');
    });
    const isGenerationRouteAvailable = vi.fn(async () => {
      throw new Error('provider resolver must stay unreachable');
    });
    const listProviders = vi.fn(async () => {
      throw new Error('provider inventory must stay unreachable');
    });
    const submit = vi.fn(async () => {
      throw new Error('adapter submit must stay unreachable');
    });
    const poll = vi.fn(async () => {
      throw new Error('adapter poll must stay unreachable');
    });
    const adapter = controllableAdapter('weprompt-image-v1', { submit, poll });
    const createJobId = vi.fn(() => {
      throw new Error('job id must stay unreachable');
    });
    const createIdempotencyKey = vi.fn(() => {
      throw new Error('idempotency key must stay unreachable');
    });
    const onProjectUpdated = vi.fn();
    const mediaStore = createStudioMediaStore({ store });
    const manager = createStudioJobManager({
      store,
      mediaStore,
      providerResolver: {
        listConnectionCandidates: async () => [],
        listGenerationRoutes,
        isGenerationRouteAvailable,
      },
      adapters: new Map([[adapter.id, adapter]]),
      listProviders,
      createJobId,
      createIdempotencyKey,
      onProjectUpdated,
    });
    harnesses.push({ rootDir, store, mediaStore, project: directorResult.project, manager });

    await expect(
      manager.submitScenes({
        projectId: reviewed.id,
        expectedRevision: reviewed.revision,
        sceneIds: ['scene_1'],
        routes: [route],
        catalogVersion: 'catalog_1',
      })
    ).rejects.toMatchObject({ code: 'stale_project' });

    const after = await store.getProject(reviewed.id);
    expect(after).toMatchObject({
      revision: reviewed.revision + 1,
      scenes: { scene_1: { visualPrompt: 'Prompt B', jobIds: [] } },
      jobs: {},
    });
    expect(onProjectUpdated).not.toHaveBeenCalled();
    expect(listGenerationRoutes).not.toHaveBeenCalled();
    expect(isGenerationRouteAvailable).not.toHaveBeenCalled();
    expect(listProviders).not.toHaveBeenCalled();
    expect(createJobId).not.toHaveBeenCalled();
    expect(createIdempotencyKey).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
    expect(poll).not.toHaveBeenCalled();
  });

  it('persists real same-count job lifecycle updates on a legacy 25-scene project', async () => {
    const submission = deferred<ProviderSubmitResult>();
    const submit = vi.fn(async () => submission.promise);
    const harness = await createHarness(
      controllableAdapter('weprompt-image-v1', {
        submit,
      })
    );
    const legacy = structuredClone(harness.project);
    for (let index = 1; index < 25; index += 1) {
      const sceneId = `scene_${index + 1}`;
      legacy.sceneOrder.push(sceneId);
      legacy.scenes[sceneId] = scene({ id: sceneId, title: `Scene ${index + 1}` });
    }
    await writeFile(path.join(harness.rootDir, legacy.id, 'project.json'), JSON.stringify(legacy));

    await expect(
      harness.manager.submitScenes({
        projectId: legacy.id,
        expectedRevision: legacy.revision,
        sceneIds: ['scene_1'],
        routes: [route],
        catalogVersion: 'catalog_1',
      })
    ).resolves.toMatchObject([{ id: 'job_1', status: 'queued_local' }]);
    await waitFor(async () =>
      expect((await harness.store.getProject(legacy.id))?.jobs.job_1.status).toBe('submitting')
    );
    await waitFor(() => expect(submit).toHaveBeenCalledOnce());

    submission.reject(new Error('transport interrupted'));
    await waitFor(async () => {
      const persisted = await harness.store.getProject(legacy.id);
      expect(persisted?.jobs.job_1).toMatchObject({ status: 'needs_attention' });
      expect(persisted?.sceneOrder).toHaveLength(25);
      expect(persisted?.sceneOrder.at(-1)).toBe('scene_25');
    });
  });

  it('persists the local job and idempotency key before adapter submission begins', async () => {
    const submission = deferred<ProviderSubmitResult>();
    let observedProject: StudioProject | null = null;
    const adapter: GenerationProviderAdapter = {
      id: 'weprompt-image-v1',
      validateConnection: async () => ({ ok: true }),
      validateRequest: (request) => ({
        ok: true,
        normalized: {
          aspectRatio: request.aspectRatio,
          resolution: request.resolution,
          durationSeconds: request.durationSeconds,
        },
      }),
      submit: async (request) => {
        observedProject = await store.getProject(project.id);
        expect(request.idempotencyKey).toBe('key_1');
        return submission.promise;
      },
    };
    const { store, project, manager } = await createHarness(adapter);

    const jobs = await manager.submitScenes({
      projectId: project.id,
      expectedRevision: project.revision,
      sceneIds: ['scene_1'],
      routes: [route],
      catalogVersion: 'catalog_1',
    });

    expect(jobs).toMatchObject([{ id: 'job_1', idempotencyKey: 'key_1', status: 'queued_local' }]);
    expect((await store.getProject(project.id))!.jobs.job_1).not.toHaveProperty('outputRole');
    await waitFor(() => expect(observedProject?.jobs.job_1.status).toBe('submitting'));
    expect(observedProject?.scenes.scene_1.jobIds).toContain('job_1');
    submission.reject(new Error('transport interrupted'));
    await waitFor(async () =>
      expect((await store.getProject(project.id))?.jobs.job_1).toMatchObject({
        status: 'needs_attention',
        error: { code: 'submission_unknown' },
      })
    );
  });

  it('snapshots the freshly resolved route cancellation policy on every new job', async () => {
    const submission = deferred<ProviderSubmitResult>();
    const adapter: GenerationProviderAdapter = {
      id: 'weprompt-image-v1',
      validateConnection: async () => ({ ok: true }),
      validateRequest: (input) => ({
        ok: true,
        normalized: {
          aspectRatio: input.aspectRatio,
          resolution: input.resolution,
          durationSeconds: input.durationSeconds,
        },
      }),
      submit: async () => submission.promise,
    };
    const harness = await createHarness(adapter, {
      catalog: async () => ({
        ...catalog(),
        routes: catalog().routes.map((candidate) => ({ ...candidate, cancellationPolicy: 'queued_only' })),
      }),
    });

    const [job] = await harness.manager.submitScenes({
      projectId: harness.project.id,
      expectedRevision: harness.project.revision,
      sceneIds: ['scene_1'],
      routes: [route],
      catalogVersion: 'catalog_1',
    });

    expect(job?.cancellationPolicy).toBe('queued_only');
    submission.resolve({ kind: 'complete', outputs: [] });
    await waitFor(async () =>
      expect((await harness.store.getProject(harness.project.id))?.jobs.job_1.status).toBe('failed')
    );
  });

  it('rejects another paid submission while the scene already has active generation work', async () => {
    const submission = deferred<ProviderSubmitResult>();
    const submit = vi.fn(async () => submission.promise);
    const adapter: GenerationProviderAdapter = {
      id: 'weprompt-image-v1',
      validateConnection: async () => ({ ok: true }),
      validateRequest: (request) => ({
        ok: true,
        normalized: {
          aspectRatio: request.aspectRatio,
          resolution: request.resolution,
          durationSeconds: request.durationSeconds,
        },
      }),
      submit,
    };
    const harness = await createHarness(adapter);
    await harness.manager.submitScenes({
      projectId: harness.project.id,
      expectedRevision: harness.project.revision,
      sceneIds: ['scene_1'],
      routes: [route],
      catalogVersion: 'catalog_1',
    });
    await waitFor(() => expect(submit).toHaveBeenCalledOnce());
    const active = (await harness.store.getProject(harness.project.id))!;

    await expect(
      harness.manager.submitScenes({
        projectId: active.id,
        expectedRevision: active.revision,
        sceneIds: ['scene_1'],
        routes: [route],
        catalogVersion: 'catalog_1',
      })
    ).rejects.toMatchObject({ code: 'busy' });
    expect(submit).toHaveBeenCalledOnce();

    submission.reject(new Error('transport interrupted'));
    await waitFor(async () =>
      expect((await harness.store.getProject(harness.project.id))?.jobs.job_1.status).toBe('needs_attention')
    );
  });

  it(
    'persists the remote identity before polling and uses the exact capped backoff schedule',
    { retry: BUG_027_CI_RETRY },
    async () => {
      const observedRemoteIdentity: Array<Pick<StudioJob, 'providerJobId' | 'remoteStartedAt' | 'status'>> = [];
      const delays: number[] = [];
      let outputPath = '';
      let harness!: Harness;
      let pollCount = 0;
      const adapter: GenerationProviderAdapter = {
        id: 'weprompt-image-v1',
        validateConnection: async () => ({ ok: true }),
        validateRequest: (request) => ({
          ok: true,
          normalized: {
            aspectRatio: request.aspectRatio,
            resolution: request.resolution,
            durationSeconds: request.durationSeconds,
          },
        }),
        submit: async () => ({ kind: 'remote', providerJobId: 'remote_1' }),
        poll: async () => {
          const current = (await harness.store.getProject(harness.project.id))!.jobs.job_1;
          observedRemoteIdentity.push({
            providerJobId: current.providerJobId,
            remoteStartedAt: current.remoteStartedAt,
            status: current.status,
          });
          pollCount += 1;
          if (pollCount < 5) return { status: 'queued' };
          return {
            status: 'succeeded',
            outputs: [
              {
                mediaKind: 'image',
                role: 'primary',
                source: { kind: 'file', path: outputPath },
                mimeType: 'image/png',
              },
            ],
          };
        },
      };
      harness = await createHarness(adapter, {
        sleep: async (delayMs) => {
          delays.push(delayMs);
        },
      });
      outputPath = path.join(harness.rootDir, 'generated.png');
      await writeFile(outputPath, png);

      const [submitted] = await harness.manager.submitScenes({
        projectId: harness.project.id,
        expectedRevision: harness.project.revision,
        sceneIds: ['scene_1'],
        routes: [route],
        catalogVersion: 'catalog_1',
      });

      expect(submitted?.remoteStartedAt).toBeNull();

      await waitFor(async () =>
        expect((await harness.store.getProject(harness.project.id))?.jobs.job_1.status).toBe('succeeded')
      );
      expect(observedRemoteIdentity).toHaveLength(5);
      expect(observedRemoteIdentity).toEqual(
        observedRemoteIdentity.map(() => ({
          providerJobId: 'remote_1',
          remoteStartedAt: observedRemoteIdentity[0]!.remoteStartedAt,
          status: expect.stringMatching(/queued_remote|running/),
        }))
      );
      expect(observedRemoteIdentity[0]!.remoteStartedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(delays).toEqual([2_000, 4_000, 8_000, 15_000, 15_000]);
    }
  );

  it('requires attention when a remote identity cannot be persisted after provider acceptance', async () => {
    const submission = deferred<ProviderSubmitResult>();
    const adapter: GenerationProviderAdapter = {
      id: 'weprompt-image-v1',
      validateConnection: async () => ({ ok: true }),
      validateRequest: (request) => ({
        ok: true,
        normalized: {
          aspectRatio: request.aspectRatio,
          resolution: request.resolution,
          durationSeconds: request.durationSeconds,
        },
      }),
      submit: async () => submission.promise,
    };
    const harness = await createHarness(adapter);
    await harness.manager.submitScenes({
      projectId: harness.project.id,
      expectedRevision: harness.project.revision,
      sceneIds: ['scene_1'],
      routes: [route],
      catalogVersion: 'catalog_1',
    });
    await waitFor(async () =>
      expect((await harness.store.getProject(harness.project.id))?.jobs.job_1.status).toBe('submitting')
    );
    vi.spyOn(harness.store, 'updateProject').mockRejectedValueOnce(new Error('disk write interrupted'));

    submission.resolve({ kind: 'remote', providerJobId: 'remote_accepted' });

    await waitFor(async () =>
      expect((await harness.store.getProject(harness.project.id))?.jobs.job_1).toMatchObject({
        status: 'needs_attention',
        providerJobId: null,
        error: { code: 'submission_unknown' },
      })
    );
  });

  it('retries the safety transition when both remote-ID persistence and its first attention write fail', async () => {
    const submission = deferred<ProviderSubmitResult>();
    const submit = vi.fn(async () => submission.promise);
    const adapter: GenerationProviderAdapter = {
      id: 'weprompt-image-v1',
      validateConnection: async () => ({ ok: true }),
      validateRequest: (request) => ({
        ok: true,
        normalized: {
          aspectRatio: request.aspectRatio,
          resolution: request.resolution,
          durationSeconds: request.durationSeconds,
        },
      }),
      submit,
    };
    const harness = await createHarness(adapter);
    await harness.manager.submitScenes({
      projectId: harness.project.id,
      expectedRevision: harness.project.revision,
      sceneIds: ['scene_1'],
      routes: [route],
      catalogVersion: 'catalog_1',
    });
    await waitFor(() => expect(submit).toHaveBeenCalledOnce());
    vi.spyOn(harness.store, 'updateProject')
      .mockRejectedValueOnce(new Error('remote identity write failed'))
      .mockRejectedValueOnce(new Error('first safety write failed'));

    submission.resolve({ kind: 'remote', providerJobId: 'remote_accepted' });

    await waitFor(async () =>
      expect((await harness.store.getProject(harness.project.id))?.jobs.job_1).toMatchObject({
        status: 'needs_attention',
        providerJobId: null,
        error: { code: 'submission_unknown' },
      })
    );
  });

  it('preserves ambiguous submit safety when the first attention write fails transiently', async () => {
    const submission = deferred<ProviderSubmitResult>();
    const submit = vi.fn(async () => submission.promise);
    const adapter: GenerationProviderAdapter = {
      id: 'weprompt-image-v1',
      validateConnection: async () => ({ ok: true }),
      validateRequest: (request) => ({
        ok: true,
        normalized: {
          aspectRatio: request.aspectRatio,
          resolution: request.resolution,
          durationSeconds: request.durationSeconds,
        },
      }),
      submit,
    };
    const harness = await createHarness(adapter);
    await harness.manager.submitScenes({
      projectId: harness.project.id,
      expectedRevision: harness.project.revision,
      sceneIds: ['scene_1'],
      routes: [route],
      catalogVersion: 'catalog_1',
    });
    await waitFor(async () =>
      expect((await harness.store.getProject(harness.project.id))?.jobs.job_1.status).toBe('submitting')
    );
    await waitFor(() => expect(submit).toHaveBeenCalledOnce());
    vi.spyOn(harness.store, 'updateProject').mockRejectedValueOnce(new Error('transient safety-write failure'));

    submission.reject(new Error('transport interrupted after request write'));

    await waitFor(async () =>
      expect((await harness.store.getProject(harness.project.id))?.jobs.job_1).toMatchObject({
        status: 'needs_attention',
        providerJobId: null,
        error: { code: 'submission_unknown' },
      })
    );
  });

  it('preserves durable remote safety when the first poll-error write fails transiently', async () => {
    const polled = deferred<ProviderJobSnapshot>();
    const submit = vi.fn(async () => ({ kind: 'remote' as const, providerJobId: 'remote_write_retry' }));
    const poll = vi.fn(async () => polled.promise);
    const adapter: GenerationProviderAdapter = {
      id: 'weprompt-image-v1',
      validateConnection: async () => ({ ok: true }),
      validateRequest: (request) => ({
        ok: true,
        normalized: {
          aspectRatio: request.aspectRatio,
          resolution: request.resolution,
          durationSeconds: request.durationSeconds,
        },
      }),
      submit,
      poll,
    };
    const harness = await createHarness(adapter, { sleep: async () => undefined });
    await harness.manager.submitScenes({
      projectId: harness.project.id,
      expectedRevision: harness.project.revision,
      sceneIds: ['scene_1'],
      routes: [route],
      catalogVersion: 'catalog_1',
    });
    await waitFor(() => expect(poll).toHaveBeenCalledOnce());
    vi.spyOn(harness.store, 'updateProject').mockRejectedValueOnce(new Error('transient safety-write failure'));

    polled.reject(Object.assign(new Error('poll transport lost'), { code: 'timeout' }));

    await waitFor(async () =>
      expect((await harness.store.getProject(harness.project.id))?.jobs.job_1).toMatchObject({
        status: 'needs_attention',
        providerJobId: 'remote_write_retry',
        error: { code: 'unknown' },
      })
    );
    expect(submit).toHaveBeenCalledOnce();
  });

  it('surfaces provider catalog outages without mislabeling them as storage failures', async () => {
    const adapter: GenerationProviderAdapter = {
      id: 'weprompt-image-v1',
      validateConnection: async () => ({ ok: true }),
      validateRequest: () => ({ ok: false, issues: [{ code: 'provider_unavailable' }] }),
      submit: vi.fn(),
    };
    const harness = await createHarness(adapter, {
      catalog: async () => {
        throw new Error('provider API unavailable');
      },
    });

    await expect(
      harness.manager.submitScenes({
        projectId: harness.project.id,
        expectedRevision: harness.project.revision,
        sceneIds: ['scene_1'],
        routes: [route],
        catalogVersion: 'catalog_1',
      })
    ).rejects.toMatchObject({ code: 'provider_error' });

    expect((await harness.store.getProject(harness.project.id))?.jobs).toEqual({});
  });
});

describe('StudioJobManager V2 durable authorized lifecycle', () => {
  it('rejects malformed dispatch descriptors before project, resolver, or provider work', async () => {
    const submit = vi.fn(async () => ({ kind: 'complete' as const, outputs: [] }));
    const harness = await createV2Harness(controllableAdapter('weprompt-image-v1', { submit }));
    const getProjectV2 = vi.spyOn(harness.store, 'getProjectV2');
    const listGenerationRoutes = vi.spyOn(harness.providerResolver, 'listGenerationRoutes');
    const sparse = ['job_v2_1'];
    sparse.length = 2;
    const cases: unknown[] = [
      null,
      'not-an-object',
      { projectId: '../unsafe', jobIds: ['job_v2_1'] },
      { projectId: harness.project.id, jobIds: [] },
      { projectId: harness.project.id, jobIds: ['job_v2_1', 'job_v2_1'] },
      { projectId: harness.project.id, jobIds: ['../unsafe_job'] },
      { projectId: harness.project.id, jobIds: [1] },
      {
        projectId: harness.project.id,
        jobIds: Array.from({ length: 193 }, (_, index) => `job_${index}`),
      },
      { projectId: harness.project.id, jobIds: sparse },
      { projectId: harness.project.id, jobIds: ['job_v2_1'], unexpected: true },
    ];

    for (const input of cases) {
      // eslint-disable-next-line no-await-in-loop
      await expect(harness.manager.dispatchAuthorizedJobsV2(input as never)).rejects.toMatchObject({
        code: 'invalid_request',
      });
    }

    expect(getProjectV2).not.toHaveBeenCalled();
    expect(listGenerationRoutes).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
  });

  it('rejects malformed V2 lifecycle commands and fences every command after disposal', async () => {
    const harness = await createV2Harness(controllableAdapter('weprompt-image-v1'));
    const malformed: Array<() => Promise<unknown>> = [
      () => harness.manager.cancelJobV2({ projectId: '../project', jobId: 'job_v2_1', expectedRevision: 1 }),
      () => harness.manager.cancelJobV2({ projectId: harness.project.id, jobId: '../job', expectedRevision: 1 }),
      () => harness.manager.cancelJobV2({ projectId: harness.project.id, jobId: 'job_v2_1', expectedRevision: 0 }),
      () => harness.manager.retryJobV2({ projectId: '../project', jobId: 'job_v2_1', expectedRevision: 1 }),
      () => harness.manager.retryJobV2({ projectId: harness.project.id, jobId: '../job', expectedRevision: 1 }),
      () => harness.manager.retryJobV2({ projectId: harness.project.id, jobId: 'job_v2_1', expectedRevision: 0 }),
      () => harness.manager.retryDownloadV2({ projectId: '../project', jobId: 'job_v2_1', expectedRevision: 1 }),
      () => harness.manager.retryDownloadV2({ projectId: harness.project.id, jobId: '../job', expectedRevision: 1 }),
      () => harness.manager.retryDownloadV2({ projectId: harness.project.id, jobId: 'job_v2_1', expectedRevision: 0 }),
    ];
    for (const invoke of malformed) {
      // eslint-disable-next-line no-await-in-loop -- Every public boundary must refuse independently.
      await expect(invoke()).rejects.toMatchObject({ code: 'invalid_request' });
    }
    const sparseProjects = [harness.project.id];
    sparseProjects.length = 2;
    for (const projectIds of [null, sparseProjects, ['../project'], [harness.project.id, harness.project.id]]) {
      expect(() => harness.manager.resumePendingJobsV2(projectIds as never)).toThrow(
        expect.objectContaining({ code: 'invalid_request' })
      );
    }
    await expect(
      harness.manager.cancelJobV2({ projectId: 'missing_project', jobId: 'job_v2_1', expectedRevision: 1 })
    ).rejects.toMatchObject({ code: 'not_found' });
    const legacy = await harness.store.createProject({
      name: 'Legacy project',
      brief: '',
      aspectRatio: '16:9',
      targetDurationSeconds: 5,
      resolution: '720p',
    });
    await expect(
      harness.manager.cancelJobV2({ projectId: legacy.id, jobId: 'job_v2_1', expectedRevision: legacy.revision })
    ).rejects.toMatchObject({ code: 'unsupported_prototype_schema' });
    await expect(
      harness.manager.cancelJobV2({
        projectId: harness.project.id,
        jobId: 'job_v2_1',
        expectedRevision: harness.project.revision + 1,
      })
    ).rejects.toMatchObject({ code: 'stale_project' });

    await harness.manager.dispose();
    await harness.manager.dispose();
    await expect(dispatchV2(harness)).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(
      harness.manager.cancelJobV2({
        projectId: harness.project.id,
        jobId: 'job_v2_1',
        expectedRevision: harness.project.revision,
      })
    ).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(
      harness.manager.retryJobV2({
        projectId: harness.project.id,
        jobId: 'job_v2_1',
        expectedRevision: harness.project.revision,
      })
    ).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(
      harness.manager.retryDownloadV2({
        projectId: harness.project.id,
        jobId: 'job_v2_1',
        expectedRevision: harness.project.revision,
      })
    ).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(harness.manager.resumePendingJobsV2([harness.project.id])).resolves.toBeUndefined();
  });

  it('refuses missing or non-runnable durable V2 jobs before resolver and provider work', async () => {
    const submit = vi.fn(async () => ({ kind: 'complete' as const, outputs: [] }));
    const harness = await createV2Harness(controllableAdapter('weprompt-image-v1', { submit }));
    const listGenerationRoutes = vi.spyOn(harness.providerResolver, 'listGenerationRoutes');

    await expect(dispatchV2(harness, ['missing_job'])).rejects.toMatchObject({ code: 'invalid_request' });
    const failed = await harness.store.updateProjectV2(harness.project.id, (project) => {
      const job = project.jobs.job_v2_1!;
      job.status = 'failed';
      job.error = { code: 'provider_unavailable', messageKey: 'providerUnavailable' };
      return project;
    });
    await expect(
      harness.manager.dispatchAuthorizedJobsV2({ projectId: failed.id, jobIds: ['job_v2_1'] })
    ).rejects.toMatchObject({ code: 'invalid_request' });

    expect(listGenerationRoutes).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
  });

  it('handles local, submitting, and remote V2 cancellation without crossing paid receipts', async () => {
    const local = await createV2Harness(controllableAdapter('weprompt-image-v1'));
    const firstCancelled = await local.manager.cancelJobV2({
      projectId: local.project.id,
      jobId: 'job_v2_1',
      expectedRevision: local.project.revision,
    });
    const localProject = await local.store.getProjectV2(local.project.id);
    if (localProject.status !== 'supported') throw new Error('local cancellation fixture missing');
    await expect(
      local.manager.cancelJobV2({
        projectId: local.project.id,
        jobId: 'job_v2_1',
        expectedRevision: localProject.project.revision,
      })
    ).resolves.toEqual(firstCancelled);

    const submitting = await createV2Harness(controllableAdapter('weprompt-image-v1'));
    const submittingProject = await submitting.store.updateProjectV2(submitting.project.id, (project) => {
      project.jobs.job_v2_1!.status = 'submitting';
      return project;
    });
    await expect(
      submitting.manager.cancelJobV2({
        projectId: submitting.project.id,
        jobId: 'job_v2_1',
        expectedRevision: submittingProject.revision,
      })
    ).resolves.toMatchObject({
      status: 'needs_attention',
      providerJobId: null,
      error: { code: 'submission_unknown' },
      spendReceipt: null,
    });

    const cancel = vi.fn(async () => ({ kind: 'cancelled' as const }));
    const remote = await createV2Harness(controllableAdapter('weprompt-image-v1', { cancel }));
    const remoteProject = await remote.store.updateProjectV2(remote.project.id, (project) => {
      const job = project.jobs.job_v2_1!;
      job.status = 'queued_remote';
      job.providerJobId = 'remote_cancel';
      job.remoteStartedAt = project.updatedAt;
      return project;
    });
    await expect(
      remote.manager.cancelJobV2({
        projectId: remote.project.id,
        jobId: 'job_v2_1',
        expectedRevision: remoteProject.revision,
      })
    ).resolves.toMatchObject({ status: 'cancelled', providerJobId: 'remote_cancel', spendReceipt: null });
    expect(cancel).toHaveBeenCalledWith(
      'remote_cancel',
      expect.objectContaining({ id: provider.id }),
      expect.anything()
    );
  });

  it('fails closed for unavailable/refused V2 cancellation and single-flights an accepted running cancellation', async () => {
    const seedRemote = (harness: V2Harness, status: 'queued_remote' | 'running', providerJobId: string) =>
      harness.store.updateProjectV2(harness.project.id, (project) => {
        const job = project.jobs.job_v2_1!;
        job.status = status;
        job.providerJobId = providerJobId;
        job.remoteStartedAt = project.updatedAt;
        return project;
      });

    const unsupported = await createV2Harness(controllableAdapter('weprompt-image-v1'));
    const unsupportedProject = await seedRemote(unsupported, 'queued_remote', 'remote_unsupported_cancel');
    await expect(
      unsupported.manager.cancelJobV2({
        projectId: unsupported.project.id,
        jobId: 'job_v2_1',
        expectedRevision: unsupportedProject.revision,
      })
    ).rejects.toMatchObject({ code: 'cancellation_refused' });

    const missingProvider = await createV2Harness(
      controllableAdapter('weprompt-image-v1', { cancel: async () => ({ kind: 'cancelled' }) }),
      { listProviders: async () => [] }
    );
    const missingProviderProject = await seedRemote(missingProvider, 'queued_remote', 'remote_missing_provider_cancel');
    await expect(
      missingProvider.manager.cancelJobV2({
        projectId: missingProvider.project.id,
        jobId: 'job_v2_1',
        expectedRevision: missingProviderProject.revision,
      })
    ).rejects.toMatchObject({ code: 'cancellation_refused' });

    for (const cancel of [
      vi.fn(async () => ({ kind: 'refused' as const, error: { code: 'cancellation_refused' as const } })),
      vi.fn(async () => {
        throw new Error('provider cancel unavailable');
      }),
    ]) {
      // eslint-disable-next-line no-await-in-loop -- Each refusal owns an independent provider transaction.
      const harness = await createV2Harness(controllableAdapter('weprompt-image-v1', { cancel }));
      // eslint-disable-next-line no-await-in-loop -- Seed one exact durable remote task.
      const persisted = await seedRemote(harness, 'running', `remote_refused_${harness.project.id}`);
      // eslint-disable-next-line no-await-in-loop -- Every adapter refusal must remain typed and byte-preserving.
      await expect(
        harness.manager.cancelJobV2({
          projectId: harness.project.id,
          jobId: 'job_v2_1',
          expectedRevision: persisted.revision,
        })
      ).rejects.toMatchObject({ code: 'cancellation_refused' });
    }

    const cancellation = deferred<{ kind: 'cancelled' }>();
    const cancel = vi.fn(async () => cancellation.promise);
    const accepted = await createV2Harness(controllableAdapter('weprompt-image-v1', { cancel }));
    const acceptedProject = await seedRemote(accepted, 'running', 'remote_singleflight_cancel');
    const request = {
      projectId: accepted.project.id,
      jobId: 'job_v2_1',
      expectedRevision: acceptedProject.revision,
    };
    const first = accepted.manager.cancelJobV2(request);
    await waitFor(() => expect(cancel).toHaveBeenCalledOnce());
    await expect(
      accepted.manager.cancelJobV2({ ...request, expectedRevision: request.expectedRevision - 1 })
    ).rejects.toMatchObject({ code: 'stale_project' });
    const second = accepted.manager.cancelJobV2(request);
    cancellation.resolve({ kind: 'cancelled' });
    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ status: 'cancelled' }),
      expect.objectContaining({ status: 'cancelled' }),
    ]);
    expect(cancel).toHaveBeenCalledOnce();

    const attentionCancel = vi.fn(async () => ({ kind: 'cancelled' as const }));
    const attention = await createV2Harness(controllableAdapter('weprompt-image-v1', { cancel: attentionCancel }));
    const attentionProject = await attention.store.updateProjectV2(attention.project.id, (project) => {
      const job = project.jobs.job_v2_1!;
      job.status = 'needs_attention';
      job.providerJobId = 'remote_attention_cancel';
      job.remoteStartedAt = project.updatedAt;
      job.error = { code: 'unknown', messageKey: 'conversation.creativeStudio.jobs.errors.unknown' };
      return project;
    });
    await expect(
      attention.manager.cancelJobV2({
        projectId: attention.project.id,
        jobId: 'job_v2_1',
        expectedRevision: attentionProject.revision,
      })
    ).resolves.toMatchObject({ status: 'cancelled', providerJobId: 'remote_attention_cancel' });
  });

  it('lets the durable V2 cancellation race winner override a late provider acknowledgement', async () => {
    const cases: Array<'already_cancelled' | 'failed' | 'replacement_remote'> = [
      'already_cancelled',
      'failed',
      'replacement_remote',
    ];
    for (const candidate of cases) {
      const gate = deferred<{ kind: 'cancelled' }>();
      const cancel = vi.fn(async () => gate.promise);
      // eslint-disable-next-line no-await-in-loop -- Each CAS race owns a fresh remote job.
      const harness = await createV2Harness(controllableAdapter('weprompt-image-v1', { cancel }));
      // eslint-disable-next-line no-await-in-loop -- Seed the exact cancellable provider identity.
      const persisted = await harness.store.updateProjectV2(harness.project.id, (project) => {
        const job = project.jobs.job_v2_1!;
        job.status = 'running';
        job.providerJobId = `remote_cancel_race_${candidate}`;
        job.remoteStartedAt = project.updatedAt;
        return project;
      });
      const operation = harness.manager.cancelJobV2({
        projectId: harness.project.id,
        jobId: 'job_v2_1',
        expectedRevision: persisted.revision,
      });
      // eslint-disable-next-line no-await-in-loop -- Wait until provider cancellation is in flight.
      await waitFor(() => expect(cancel).toHaveBeenCalledOnce());
      // eslint-disable-next-line no-await-in-loop -- Commit the competing durable winner first.
      await harness.store.updateProjectV2(harness.project.id, (project) => {
        const job = project.jobs.job_v2_1!;
        if (candidate === 'already_cancelled') {
          job.status = 'cancelled';
          job.error = null;
        } else if (candidate === 'failed') {
          job.status = 'failed';
          job.error = { code: 'provider_unavailable', messageKey: 'providerUnavailable' };
        } else {
          job.providerJobId = 'replacement_remote_cancel_race';
        }
        return project;
      });
      gate.resolve({ kind: 'cancelled' });
      if (candidate === 'already_cancelled') {
        // eslint-disable-next-line no-await-in-loop -- Idempotent durable cancellation wins.
        await expect(operation).resolves.toMatchObject({ status: 'cancelled' });
      } else {
        // eslint-disable-next-line no-await-in-loop -- A different durable winner refuses the stale acknowledgement.
        await expect(operation).rejects.toMatchObject({ code: 'cancellation_refused' });
      }
    }
  });

  it('refuses a partial generation-item sibling set before resolver or provider work', async () => {
    const submit = vi.fn(async () => ({ kind: 'complete' as const, outputs: [] }));
    const harness = await createV2Harness(controllableAdapter('weprompt-image-v1', { submit }), {
      generationCount: 2,
    });
    const listGenerationRoutes = vi.spyOn(harness.providerResolver, 'listGenerationRoutes');

    await expect(dispatchV2(harness, ['job_v2_1'])).rejects.toMatchObject({ code: 'invalid_request' });

    expect(listGenerationRoutes).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
    const loaded = await harness.store.getProjectV2(harness.project.id);
    expect(loaded.status === 'supported' ? Object.values(loaded.project.jobs).map((job) => job.status) : null).toEqual([
      'queued_local',
      'queued_local',
    ]);
  });

  it('resolves the complete item before either provider call and bills each generation exactly once', async () => {
    let harness!: V2Harness;
    let listGenerationRoutes!: ReturnType<typeof vi.spyOn>;
    const submit = vi.fn(async () => {
      expect(listGenerationRoutes).toHaveBeenCalledTimes(2);
      return { kind: 'complete' as const, outputs: [] };
    });
    harness = await createV2Harness(controllableAdapter('weprompt-image-v1', { submit }), {
      generationCount: 2,
    });
    listGenerationRoutes = vi.spyOn(harness.providerResolver, 'listGenerationRoutes');
    const before = structuredClone(harness.project);

    await expect(dispatchV2(harness)).resolves.toEqual([
      expect.objectContaining({ id: 'job_v2_1', status: 'queued_local', idempotencyKey: 'key_v2_1' }),
      expect.objectContaining({ id: 'job_v2_2', status: 'queued_local', idempotencyKey: 'key_v2_2' }),
    ]);
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(2));
    await expectV2Job(harness, { status: 'failed', error: { code: 'no_output' } }, 'job_v2_1');
    await expectV2Job(harness, { status: 'failed', error: { code: 'no_output' } }, 'job_v2_2');

    const loaded = await harness.store.getProjectV2(harness.project.id);
    if (loaded.status !== 'supported') throw new Error('V2 project disappeared');
    expect(loaded.project.spendAuthorizations).toEqual(before.spendAuthorizations);
    expect(Object.keys(loaded.project.jobs)).toEqual(['job_v2_1', 'job_v2_2']);
    expect(Object.values(loaded.project.jobs).map((job) => job.spendReceipt)).toEqual([
      expect.objectContaining({ jobId: 'job_v2_1', generationIndex: 0, totalMinorUnits: 3 }),
      expect.objectContaining({ jobId: 'job_v2_2', generationIndex: 1, totalMinorUnits: 3 }),
    ]);
    expect(submit.mock.calls.map(([request]) => request)).toEqual([
      expect.objectContaining({ prompt: 'A frozen seed prompt', idempotencyKey: 'key_v2_1' }),
      expect.objectContaining({ prompt: 'A frozen seed prompt', idempotencyKey: 'key_v2_2' }),
    ]);
  });

  it('persists a fresh V2 remote identity, queued/running progress, and one billable terminal receipt', async () => {
    let pollCount = 0;
    const submit = vi.fn(async () => ({ kind: 'remote' as const, providerJobId: 'remote_fresh_v2' }));
    const poll = vi.fn(async () => {
      pollCount += 1;
      if (pollCount === 1) return { status: 'queued' as const };
      if (pollCount === 2) return { status: 'running' as const, progress: 50 };
      return { status: 'succeeded' as const, outputs: [] };
    });
    const harness = await createV2Harness(controllableAdapter('weprompt-image-v1', { submit, poll }), {
      sleep: async () => undefined,
      nowEpochMs: () => Date.parse('2026-08-17T12:00:03.000Z'),
    });

    await dispatchV2(harness);
    await expectV2Job(harness, {
      status: 'failed',
      providerJobId: 'remote_fresh_v2',
      error: { code: 'no_output' },
      spendReceipt: { jobId: 'job_v2_1' },
    });
    expect(submit).toHaveBeenCalledOnce();
    expect(poll).toHaveBeenCalledTimes(3);
  });

  it('persists every V2 remote terminal class and bounds unavailable or rejected polling', async () => {
    const terminalCases: Array<{
      snapshot: ProviderJobSnapshot;
      expected: Partial<StudioJobV2>;
    }> = [
      {
        snapshot: { status: 'cancelled', error: { code: 'unknown' } },
        expected: { status: 'cancelled', error: null, spendReceipt: null },
      },
      {
        snapshot: { status: 'failed', error: { code: 'auth' } },
        expected: { status: 'failed', error: { code: 'auth' }, spendReceipt: null },
      },
      {
        snapshot: { status: 'failed', error: { code: 'invalid_response' } },
        expected: { status: 'failed', error: { code: 'unknown' }, spendReceipt: null },
      },
      {
        snapshot: { status: 'expired', error: { code: 'timeout' } },
        expected: { status: 'failed', error: { code: 'timeout' }, spendReceipt: null },
      },
      {
        snapshot: { status: 'invalid_remote_status' } as never,
        expected: { status: 'failed', error: { code: 'unknown' }, spendReceipt: null },
      },
    ];
    for (const [index, candidate] of terminalCases.entries()) {
      const submit = vi.fn(async () => ({ kind: 'remote' as const, providerJobId: `remote_terminal_${index}` }));
      const poll = vi.fn(async () => candidate.snapshot);
      // eslint-disable-next-line no-await-in-loop -- Each remote terminal owns a fresh durable authority tuple.
      const harness = await createV2Harness(controllableAdapter('weprompt-image-v1', { submit, poll }), {
        sleep: async () => undefined,
        nowEpochMs: () => Date.parse('2026-08-17T12:00:03.000Z'),
      });
      // eslint-disable-next-line no-await-in-loop -- Let the exact terminal transition settle before the next project.
      await dispatchV2(harness);
      // eslint-disable-next-line no-await-in-loop -- Observe the complete persisted terminal class.
      await expectV2Job(harness, candidate.expected);
      expect(poll).toHaveBeenCalledOnce();
    }

    const unsupportedSubmit = vi.fn(async () => ({ kind: 'remote' as const, providerJobId: 'remote_no_poll' }));
    const unsupported = await createV2Harness(controllableAdapter('weprompt-image-v1', { submit: unsupportedSubmit }), {
      sleep: async () => undefined,
      nowEpochMs: () => Date.parse('2026-08-17T12:00:03.000Z'),
    });
    await dispatchV2(unsupported);
    await expectV2Job(unsupported, { status: 'needs_attention', error: { code: 'unsupported' } });

    const rejectedPoll = vi.fn(async () => {
      throw Object.assign(new Error('private provider body'), { code: 'invalid_response' });
    });
    const rejected = await createV2Harness(
      controllableAdapter('weprompt-image-v1', {
        submit: async () => ({ kind: 'remote', providerJobId: 'remote_rejected_poll' }),
        poll: rejectedPoll,
      }),
      {
        sleep: async () => undefined,
        nowEpochMs: () => Date.parse('2026-08-17T12:00:03.000Z'),
      }
    );
    await dispatchV2(rejected);
    await expectV2Job(rejected, { status: 'needs_attention', error: { code: 'unknown' } });
    const loaded = await rejected.store.getProjectV2(rejected.project.id);
    expect(JSON.stringify(loaded)).not.toContain('private provider body');
  });

  it('ignores queued progress regression after a V2 remote job has entered running', async () => {
    const snapshots: ProviderJobSnapshot[] = [
      { status: 'running' },
      { status: 'queued', progress: 1 },
      { status: 'running', progress: 75 },
      { status: 'succeeded', outputs: [] },
    ];
    const poll = vi.fn(async () => snapshots.shift()!);
    const harness = await createV2Harness(
      controllableAdapter('weprompt-image-v1', {
        submit: async () => ({ kind: 'remote', providerJobId: 'remote_progress_regression' }),
        poll,
      }),
      {
        sleep: async () => undefined,
        nowEpochMs: () => Date.parse('2026-08-17T12:00:03.000Z'),
      }
    );

    await dispatchV2(harness);
    await expectV2Job(harness, {
      status: 'failed',
      providerJobId: 'remote_progress_regression',
      error: { code: 'no_output' },
      spendReceipt: { jobId: 'job_v2_1' },
    });
    expect(poll).toHaveBeenCalledTimes(4);
  });

  it('discards late V2 remote progress and terminal results after durable identity or status changes', async () => {
    const cases: Array<{
      snapshot: ProviderJobSnapshot;
      mutate: (job: StudioJobV2) => void;
      expected: Partial<StudioJobV2>;
    }> = [
      {
        snapshot: { status: 'running', progress: 40 },
        mutate: (job) => {
          job.providerJobId = 'replacement_remote_progress';
        },
        expected: { status: 'queued_remote', providerJobId: 'replacement_remote_progress' },
      },
      {
        snapshot: { status: 'running', progress: 40 },
        mutate: (job) => {
          job.status = 'failed';
          job.error = { code: 'provider_unavailable', messageKey: 'providerUnavailable' };
        },
        expected: { status: 'failed', error: { code: 'provider_unavailable' } },
      },
      {
        snapshot: { status: 'cancelled', error: { code: 'unknown' } },
        mutate: (job) => {
          job.providerJobId = 'replacement_remote_cancel';
        },
        expected: { status: 'queued_remote', providerJobId: 'replacement_remote_cancel' },
      },
      {
        snapshot: { status: 'cancelled', error: { code: 'unknown' } },
        mutate: (job) => {
          job.status = 'failed';
          job.error = { code: 'provider_unavailable', messageKey: 'providerUnavailable' };
        },
        expected: { status: 'failed', error: { code: 'provider_unavailable' } },
      },
      {
        snapshot: { status: 'failed', error: { code: 'auth' } },
        mutate: (job) => {
          job.providerJobId = 'replacement_remote_failure';
        },
        expected: { status: 'queued_remote', providerJobId: 'replacement_remote_failure' },
      },
      {
        snapshot: { status: 'failed', error: { code: 'auth' } },
        mutate: (job) => {
          job.status = 'needs_attention';
          job.error = { code: 'unknown', messageKey: 'conversation.creativeStudio.jobs.errors.unknown' };
        },
        expected: { status: 'needs_attention', error: { code: 'unknown' } },
      },
      {
        snapshot: { status: 'succeeded', outputs: [] },
        mutate: (job) => {
          job.providerJobId = 'replacement_remote_success';
        },
        expected: { status: 'queued_remote', providerJobId: 'replacement_remote_success', spendReceipt: null },
      },
    ];

    for (const [index, candidate] of cases.entries()) {
      const pollGate = deferred<ProviderJobSnapshot>();
      const poll = vi.fn(async () => pollGate.promise);
      // eslint-disable-next-line no-await-in-loop -- Each late result owns a separate durable race.
      const harness = await createV2Harness(
        controllableAdapter('weprompt-image-v1', {
          submit: async () => ({ kind: 'remote', providerJobId: `remote_late_${index}` }),
          poll,
        }),
        {
          sleep: async () => undefined,
          nowEpochMs: () => Date.parse('2026-08-17T12:00:03.000Z'),
        }
      );
      // eslint-disable-next-line no-await-in-loop -- Dispatch persists the original identity before polling.
      await dispatchV2(harness);
      // eslint-disable-next-line no-await-in-loop -- Observe the exact in-flight provider call.
      await waitFor(() => expect(poll).toHaveBeenCalledOnce());
      // eslint-disable-next-line no-await-in-loop -- Commit the concurrent durable winner before releasing provider I/O.
      await harness.store.updateProjectV2(harness.project.id, (project) => {
        candidate.mutate(project.jobs.job_v2_1!);
        return project;
      });
      pollGate.resolve(candidate.snapshot);
      // eslint-disable-next-line no-await-in-loop -- Let the late-result guard finish without aborting its controller.
      await new Promise((resolve) => setTimeout(resolve, 10));
      // eslint-disable-next-line no-await-in-loop -- The concurrent durable winner remains authoritative.
      await expectV2Job(harness, candidate.expected);
    }
  }, 30_000);

  it('bounds V2 polling before and after backoff and classifies per-attempt deadline errors', async () => {
    const startedAt = Date.parse('2026-08-17T12:00:00.000Z');
    const cases = [
      {
        times: [startedAt, startedAt + REMOTE_POLL_DEADLINE_MS],
        poll: vi.fn(async () => ({ status: 'running' as const })),
        expectedCode: 'poll_deadline' as const,
        expectedPolls: 0,
      },
      {
        times: [startedAt, startedAt + REMOTE_POLL_DEADLINE_MS - 1, startedAt + REMOTE_POLL_DEADLINE_MS],
        poll: vi.fn(async () => ({ status: 'running' as const })),
        expectedCode: 'poll_deadline' as const,
        expectedPolls: 0,
      },
      {
        times: [startedAt, startedAt, startedAt, startedAt],
        poll: vi.fn(async () => {
          throw new ProviderDeadlineError();
        }),
        expectedCode: 'timeout' as const,
        expectedPolls: 1,
      },
      {
        times: [startedAt, startedAt, startedAt, startedAt + REMOTE_POLL_DEADLINE_MS],
        poll: vi.fn(async () => {
          throw new ProviderDeadlineError();
        }),
        expectedCode: 'poll_deadline' as const,
        expectedPolls: 1,
      },
    ];

    for (const [index, candidate] of cases.entries()) {
      let timeIndex = 0;
      const nowEpochMs = () => candidate.times[Math.min(timeIndex++, candidate.times.length - 1)]!;
      // eslint-disable-next-line no-await-in-loop -- Each deadline boundary owns a fresh remote job.
      const harness = await createV2Harness(
        controllableAdapter('weprompt-image-v1', {
          submit: async () => ({ kind: 'remote', providerJobId: `remote_deadline_case_${index}` }),
          poll: candidate.poll,
        }),
        { sleep: async () => undefined, nowEpochMs }
      );
      // eslint-disable-next-line no-await-in-loop -- Run the exact bounded lifecycle to its persisted attention state.
      await dispatchV2(harness);
      // eslint-disable-next-line no-await-in-loop -- The deadline code distinguishes the four timer boundaries.
      await expectV2Job(harness, { status: 'needs_attention', error: { code: candidate.expectedCode } });
      expect(candidate.poll).toHaveBeenCalledTimes(candidate.expectedPolls);
    }
  });

  it('downloads and commits a V2 provider URL through the bounded managed-media seam', async () => {
    const outputDownloader = createRemoteOutputDownloader(png, 'image/png');
    const submit = vi.fn(async () => ({
      kind: 'complete' as const,
      outputs: [
        {
          mediaKind: 'image' as const,
          role: 'primary' as const,
          source: { kind: 'url' as const, url: 'https://provider.example/output.png' },
          mimeType: 'image/png',
          byteSize: png.length,
        },
      ],
    }));
    const harness = await createV2Harness(controllableAdapter('weprompt-image-v1', { submit }), {
      outputDownloader,
    });

    await dispatchV2(harness);
    await expectV2Job(harness, {
      status: 'succeeded',
      outputAssetIdsByRole: { primary: expect.any(String), poster: null },
      spendReceipt: { jobId: 'job_v2_1' },
    });
    expect(outputDownloader).toHaveBeenCalledWith(
      expect.objectContaining({ id: provider.id }),
      'weprompt-image-v1',
      expect.anything(),
      expect.objectContaining({ timeoutMs: expect.any(Number) })
    );
  });

  it('sanitizes every definitive and ambiguous V2 submit failure without losing paid authority', async () => {
    const cases = [
      ['auth', 'failed', 'auth'],
      ['quota', 'failed', 'quota'],
      ['rate_limited', 'failed', 'rate_limited'],
      ['no_output', 'needs_attention', 'submission_unknown'],
      ['unsupported', 'failed', 'unsupported'],
      ['timeout', 'needs_attention', 'submission_unknown'],
      ['provider_unavailable', 'needs_attention', 'submission_unknown'],
      ['submission_unknown', 'needs_attention', 'submission_unknown'],
      ['unknown', 'needs_attention', 'submission_unknown'],
    ] as const;
    for (const [providerCode, status, persistedCode] of cases) {
      const submit = vi.fn(async () => {
        throw Object.assign(new Error('secret provider body'), { code: providerCode });
      });
      // eslint-disable-next-line no-await-in-loop -- Every provider classification owns one durable transition.
      const harness = await createV2Harness(controllableAdapter('weprompt-image-v1', { submit }));
      // eslint-disable-next-line no-await-in-loop -- Dispatch persists before provider work.
      await dispatchV2(harness);
      // eslint-disable-next-line no-await-in-loop -- Observe the exact terminal classification.
      await expectV2Job(harness, { status, error: { code: persistedCode }, spendReceipt: null });
      const loaded = await harness.store.getProjectV2(harness.project.id);
      expect(JSON.stringify(loaded)).not.toContain('secret provider body');
    }
  });

  it('fails closed to needs-attention when the current route no longer byte-matches durable authority', async () => {
    const submit = vi.fn(async () => ({ kind: 'complete' as const, outputs: [] }));
    const harness = await createV2Harness(controllableAdapter('weprompt-image-v1', { submit }));
    vi.spyOn(harness.providerResolver, 'listGenerationRoutes').mockResolvedValue({
      routes: [{ ...harness.route, model: 'replacement-model' }],
      diagnostics: [],
      generationCatalogVersion: 'changed_catalog',
    });

    await expect(dispatchV2(harness)).rejects.toMatchObject({ code: 'invalid_route' });
    await expectV2Job(harness, {
      status: 'needs_attention',
      error: { code: 'provider_unavailable' },
      providerJobId: null,
      spendReceipt: null,
    });
    expect(submit).not.toHaveBeenCalled();
  });

  it('fails closed across V2 resolver, provider-health, policy, and adapter-validation drift', async () => {
    const submit = vi.fn(async () => ({ kind: 'complete' as const, outputs: [] }));
    const unavailableProviders: IProvider[] = [
      { ...provider, models: ['image-model'], enabled: false },
      { ...provider, models: ['image-model'], api_key: '' },
      { ...provider, models: ['image-model'], model_enabled: { 'image-model': false } },
      {
        ...provider,
        models: ['image-model'],
        model_health: { 'image-model': { status: 'unhealthy', checked_at: '2026-08-17T12:00:00.000Z' } },
      },
    ];
    const cases: Array<{
      harness: () => Promise<V2Harness>;
      code: 'provider_error' | 'invalid_route';
    }> = [
      {
        harness: () =>
          createV2Harness(controllableAdapter('weprompt-image-v1', { submit }), {
            providerResolver: {
              listConnectionCandidates: async () => [],
              listGenerationRoutes: async () => {
                throw new Error('catalog unavailable');
              },
              isGenerationRouteAvailable: async () => false,
            },
          }),
        code: 'provider_error',
      },
      {
        harness: () =>
          createV2Harness(controllableAdapter('weprompt-image-v1', { submit }), {
            listProviders: async () => {
              throw new Error('connections unavailable');
            },
          }),
        code: 'provider_error',
      },
      ...unavailableProviders.map((candidate) => ({
        harness: () =>
          createV2Harness(controllableAdapter('weprompt-image-v1', { submit }), {
            listProviders: async () => [candidate],
          }),
        code: 'invalid_route' as const,
      })),
      {
        harness: () =>
          createV2Harness(controllableAdapter('weprompt-image-v1', { submit }), {
            cancellationPolicy: 'none',
            jobOverrides: () => ({ cancellationPolicy: 'queued_and_running' }),
          }),
        code: 'invalid_route',
      },
      {
        harness: () =>
          createV2Harness({
            ...controllableAdapter('weprompt-image-v1', { submit }),
            validateRequest: () => ({ ok: false, issues: [{ code: 'invalid_resolution' }] }),
          }),
        code: 'invalid_route',
      },
      ...(['aspectRatio', 'resolution'] as const).map((field) => ({
        harness: () =>
          createV2Harness({
            ...controllableAdapter('weprompt-image-v1', { submit }),
            validateRequest: (request) => ({
              ok: true as const,
              normalized: {
                aspectRatio: field === 'aspectRatio' ? ('1:1' as const) : request.aspectRatio,
                resolution: field === 'resolution' ? ('1080p' as const) : request.resolution,
                durationSeconds: request.durationSeconds,
              },
            }),
          }),
        code: 'invalid_route' as const,
      })),
    ];

    for (const candidate of cases) {
      // eslint-disable-next-line no-await-in-loop -- Each authority drift has a separate durable project.
      const harness = await candidate.harness();
      // eslint-disable-next-line no-await-in-loop -- Dispatch must classify and persist before the next fixture.
      await expect(dispatchV2(harness)).rejects.toMatchObject({ code: candidate.code });
      // eslint-disable-next-line no-await-in-loop -- Every drift converges on one safe renderer-facing state.
      await expectV2Job(harness, {
        status: 'needs_attention',
        error: { code: 'provider_unavailable' },
        providerJobId: null,
        spendReceipt: null,
      });
    }
    expect(submit).not.toHaveBeenCalled();
  });

  it('resolves an immutable V2 Brief reference into bounded conditioning without exposing its path', async () => {
    const submit = vi.fn(async (request: { conditioningImages?: readonly unknown[] }) => {
      expect(request.conditioningImages).toHaveLength(1);
      return { kind: 'complete' as const, outputs: [] };
    });
    const harness = await createV2Harness(controllableAdapter('weprompt-image-v1', { submit }));
    const sourcePath = path.join(harness.rootDir, 'private-reference.png');
    await writeFile(sourcePath, png);
    const reference = await harness.mediaStore.importReferenceFromPathV2({
      projectId: harness.project.id,
      briefReferenceRole: 'cast',
      sourcePath,
      expectedRevision: harness.project.revision,
    });
    await harness.store.updateProjectV2(harness.project.id, (project) => {
      const job = project.jobs.job_v2_1!;
      const snapshot = {
        ...job.requestSnapshot!,
        referenceInput: { assetId: reference.id, sha256: reference.sha256 },
      };
      job.requestPlan = { kind: 'resolved', snapshot };
      job.requestSnapshot = snapshot;
      project.spendAuthorizations[0]!.baseItems[0]!.requestPlan = job.requestPlan;
      return project;
    });

    await dispatchV2(harness);
    await expectV2Job(harness, { status: 'failed', error: { code: 'no_output' } });
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({ conditioningImages: [expect.objectContaining({ assetId: reference.id })] }),
      expect.anything(),
      expect.anything()
    );
    expect(JSON.stringify(submit.mock.calls)).not.toContain(sourcePath);
  });

  it('refuses adapter normalization that would change the immutable paid request snapshot', async () => {
    const submit = vi.fn(async () => ({ kind: 'complete' as const, outputs: [] }));
    const adapter = controllableAdapter('weprompt-image-v1', { submit });
    adapter.validateRequest = (request) => ({
      ok: true,
      normalized: {
        aspectRatio: request.aspectRatio,
        resolution: request.resolution,
        durationSeconds: request.durationSeconds + 1,
      },
    });
    const harness = await createV2Harness(adapter);

    await expect(dispatchV2(harness)).rejects.toMatchObject({ code: 'invalid_route' });
    await expectV2Job(harness, {
      status: 'needs_attention',
      error: { code: 'provider_unavailable' },
      providerJobId: null,
      spendReceipt: null,
    });
    expect(submit).not.toHaveBeenCalled();
  });

  it('persists a billable primary under the role map without auto-selecting or pinning it', async () => {
    let outputPath = '';
    const submit = vi.fn(async () => ({
      kind: 'complete' as const,
      outputs: [
        {
          mediaKind: 'image' as const,
          role: 'primary' as const,
          source: { kind: 'file' as const, path: outputPath },
          mimeType: 'image/png',
        },
      ],
    }));
    const harness = await createV2Harness(controllableAdapter('weprompt-image-v1', { submit }));
    outputPath = path.join(harness.rootDir, 'provider-primary.png');
    await writeFile(outputPath, png);

    await dispatchV2(harness);
    await expectV2Job(harness, { status: 'succeeded', error: null });

    const loaded = await harness.store.getProjectV2(harness.project.id);
    if (loaded.status !== 'supported') throw new Error('V2 project disappeared');
    const job = loaded.project.jobs.job_v2_1!;
    const primaryId = job.outputAssetIdsByRole.primary;
    expect(primaryId).toEqual(expect.any(String));
    expect(job).toMatchObject({
      outputAssetIds: [primaryId],
      outputAssetIdsByRole: { primary: primaryId, poster: null },
      spendReceipt: { jobId: job.id, totalMinorUnits: 3 },
    });
    expect(loaded.project.shots.shot_1).toMatchObject({ selectedTakeId: null, seedStillId: null });
    expect(loaded.project.assets[primaryId!]).toMatchObject({
      shotId: 'shot_1',
      mediaKind: 'image',
      sourceLook: 'A frozen seed prompt',
    });
    expect(canCancelJobV2(job)).toBe(false);
  });

  it('persists a local V2 video primary and optional poster with bounded provider metadata', async () => {
    let primaryPath = '';
    let posterPath = '';
    const submit = vi.fn(async () => ({
      kind: 'complete' as const,
      outputs: [
        {
          mediaKind: 'video' as const,
          role: 'primary' as const,
          source: { kind: 'file' as const, path: primaryPath },
          mimeType: 'video/mp4' as const,
          byteSize: mp4.length,
          width: 1280,
          height: 720,
          durationSeconds: 5,
        },
        {
          mediaKind: 'image' as const,
          role: 'poster' as const,
          source: { kind: 'file' as const, path: posterPath },
          mimeType: 'image/png' as const,
          byteSize: png.length,
          width: 1,
          height: 1,
        },
      ],
    }));
    const harness = await createV2Harness(controllableAdapter('weprompt-media-gateway-v1', { submit }), {
      purpose: 'video_take',
      probeVideoDurationSecondsV2: async () => 5,
    });
    primaryPath = path.join(harness.rootDir, 'provider-primary.mp4');
    posterPath = path.join(harness.rootDir, 'provider-poster.png');
    await Promise.all([writeFile(primaryPath, mp4), writeFile(posterPath, png)]);

    await dispatchV2(harness);
    await expectV2Job(harness, {
      status: 'succeeded',
      outputAssetIdsByRole: { primary: expect.any(String), poster: expect.any(String) },
      spendReceipt: { totalMinorUnits: 15 },
    });
  });

  it('persists URL-backed V2 video and poster outputs through independent bounded downloads', async () => {
    const outputDownloader = vi.fn(
      (
        _provider: TProviderWithModel,
        _adapterId: StudioProviderAdapterId,
        signal: AbortSignal,
        budget?: RemoteMediaBudget
      ) => ({
        lookup: async () => [{ address: '8.8.8.8', family: 4 as const }],
        request: async (target: { url: URL }) => {
          const video = target.url.pathname.endsWith('.mp4');
          const bytes = video ? mp4 : png;
          return {
            statusCode: 200,
            headers: {
              'content-length': String(bytes.length),
              'content-type': video ? 'video/mp4' : 'image/png',
            },
            remoteAddress: '8.8.8.8',
            body: Readable.from([bytes]),
          };
        },
        signal,
        timeoutMs: budget?.timeoutMs ?? 1,
      })
    );
    const submit = vi.fn(async () => ({
      kind: 'complete' as const,
      outputs: [
        {
          mediaKind: 'video' as const,
          role: 'primary' as const,
          source: { kind: 'url' as const, url: 'https://provider.example/primary.mp4' },
          mimeType: 'video/mp4' as const,
          byteSize: mp4.length,
          width: 1920,
          height: 1080,
          durationSeconds: 5,
        },
        {
          mediaKind: 'image' as const,
          role: 'poster' as const,
          source: { kind: 'url' as const, url: 'https://provider.example/poster.png' },
          mimeType: 'image/png' as const,
          byteSize: png.length,
          width: 1,
          height: 1,
        },
      ],
    }));
    const harness = await createV2Harness(controllableAdapter('weprompt-media-gateway-v1', { submit }), {
      purpose: 'video_take',
      probeVideoDurationSecondsV2: async () => 5,
      outputDownloader,
    });

    await dispatchV2(harness);
    await expectV2Job(harness, {
      status: 'succeeded',
      outputAssetIdsByRole: { primary: expect.any(String), poster: expect.any(String) },
    });
    expect(outputDownloader).toHaveBeenCalledTimes(2);
  });

  it('derives omitted V2 video and poster metadata from bounded local and remote bytes', async () => {
    for (const remote of [false, true]) {
      let primaryPath = '';
      let posterPath = '';
      const outputDownloader = vi.fn(
        (
          _provider: TProviderWithModel,
          _adapterId: StudioProviderAdapterId,
          signal: AbortSignal,
          budget?: RemoteMediaBudget
        ) => ({
          lookup: async () => [{ address: '8.8.8.8', family: 4 as const }],
          request: async (target: { url: URL }) => {
            const video = target.url.pathname.endsWith('.mp4');
            const bytes = video ? mp4 : png;
            return {
              statusCode: 200,
              headers: {
                'content-length': String(bytes.length),
                'content-type': video ? 'video/mp4' : 'image/png',
              },
              remoteAddress: '8.8.8.8',
              body: Readable.from([bytes]),
            };
          },
          signal,
          timeoutMs: budget?.timeoutMs ?? 1,
        })
      );
      const submit = vi.fn(async () => ({
        kind: 'complete' as const,
        outputs: [
          {
            mediaKind: 'video' as const,
            role: 'primary' as const,
            source: remote
              ? { kind: 'url' as const, url: 'https://provider.example/unmeasured-primary.mp4' }
              : { kind: 'file' as const, path: primaryPath },
            mimeType: 'video/mp4' as const,
          },
          {
            mediaKind: 'image' as const,
            role: 'poster' as const,
            source: remote
              ? { kind: 'url' as const, url: 'https://provider.example/unmeasured-poster.png' }
              : { kind: 'file' as const, path: posterPath },
            mimeType: 'image/png' as const,
          },
        ],
      }));
      // eslint-disable-next-line no-await-in-loop -- Local and remote omission paths own isolated projects.
      const harness = await createV2Harness(controllableAdapter('weprompt-media-gateway-v1', { submit }), {
        purpose: 'video_take',
        probeVideoDurationSecondsV2: async () => 5,
        ...(remote ? { outputDownloader } : {}),
      });
      primaryPath = path.join(harness.rootDir, 'unmeasured-primary.mp4');
      posterPath = path.join(harness.rootDir, 'unmeasured-poster.png');
      if (!remote) {
        // eslint-disable-next-line no-await-in-loop -- Provider-owned local outputs exist before submission resolves.
        await Promise.all([writeFile(primaryPath, mp4), writeFile(posterPath, png)]);
      }
      // eslint-disable-next-line no-await-in-loop -- Persist each authority mode completely.
      await dispatchV2(harness);
      // eslint-disable-next-line no-await-in-loop -- Metadata omission must not change the durable terminal result.
      await expectV2Job(harness, {
        status: 'succeeded',
        outputAssetIdsByRole: { primary: expect.any(String), poster: expect.any(String) },
      });
    }
  });

  it('classifies wrong-media, missing-MIME, absent, and symbolic-link V2 primaries without losing receipts', async () => {
    const cases = [
      {
        name: 'wrong media',
        output: () => ({
          mediaKind: 'video' as const,
          role: 'primary' as const,
          source: { kind: 'file' as const, path: '/never-opened.mp4' },
          mimeType: 'video/mp4' as const,
        }),
        expectedCode: 'no_output' as const,
      },
      {
        name: 'missing MIME',
        output: () =>
          ({
            mediaKind: 'image' as const,
            role: 'primary' as const,
            source: { kind: 'url' as const, url: 'https://provider.example/missing-mime.png' },
            mimeType: undefined,
          }) as never,
        expectedCode: 'no_output' as const,
      },
      {
        name: 'absent local file',
        output: (rootDir: string) => ({
          mediaKind: 'image' as const,
          role: 'primary' as const,
          source: { kind: 'file' as const, path: path.join(rootDir, 'missing-primary.png') },
          mimeType: 'image/png' as const,
        }),
        expectedCode: 'download_failed' as const,
      },
      {
        name: 'symbolic link',
        output: (rootDir: string) => ({
          mediaKind: 'image' as const,
          role: 'primary' as const,
          source: { kind: 'file' as const, path: path.join(rootDir, 'linked-primary.png') },
          mimeType: 'image/png' as const,
        }),
        expectedCode: 'no_output' as const,
        seedSymlink: true,
      },
    ];

    for (const candidate of cases) {
      let harness!: V2Harness;
      const submit = vi.fn(async () => ({ kind: 'complete' as const, outputs: [candidate.output(harness.rootDir)] }));
      // eslint-disable-next-line no-await-in-loop -- Each output authority owns an isolated managed project.
      harness = await createV2Harness(controllableAdapter('weprompt-image-v1', { submit }));
      if (candidate.seedSymlink) {
        const target = path.join(harness.rootDir, 'real-primary.png');
        // eslint-disable-next-line no-await-in-loop -- Seed the one hostile leaf before dispatch.
        await writeFile(target, png);
        // eslint-disable-next-line no-await-in-loop -- The symlink itself is the provider-owned source.
        await nodeFs.symlink(target, path.join(harness.rootDir, 'linked-primary.png'));
      }
      // eslint-disable-next-line no-await-in-loop -- Complete the billable provider boundary before classification.
      await dispatchV2(harness);
      // eslint-disable-next-line no-await-in-loop -- Every local refusal retains exactly one paid receipt.
      await expectV2Job(harness, {
        status: 'failed',
        error: { code: candidate.expectedCode },
        spendReceipt: { jobId: 'job_v2_1' },
      });
    }
  });

  it('keeps one receipt and records no_output when a billable video has no proved duration', async () => {
    let outputPath = '';
    const submit = vi.fn(async () => ({
      kind: 'complete' as const,
      outputs: [
        {
          mediaKind: 'video' as const,
          role: 'primary' as const,
          source: { kind: 'file' as const, path: outputPath },
          mimeType: 'video/mp4',
        },
      ],
    }));
    const harness = await createV2Harness(controllableAdapter('weprompt-media-gateway-v1', { submit }), {
      purpose: 'video_take',
    });
    outputPath = path.join(harness.rootDir, 'provider-primary.mp4');
    await writeFile(outputPath, mp4);

    await dispatchV2(harness);
    await expectV2Job(harness, {
      status: 'failed',
      error: { code: 'no_output' },
      spendReceipt: { jobId: 'job_v2_1', totalMinorUnits: 15 },
      outputAssetIds: [],
    });
    const loaded = await harness.store.getProjectV2(harness.project.id);
    expect(loaded.status === 'supported' ? Object.keys(loaded.project.assets) : null).toEqual(['seed_v2']);
  });

  it('retains the same receipt through a local output storage failure', async () => {
    let outputPath = '';
    const persistProviderOutputForJobV2 = vi.fn(async () => {
      throw new Error('disk unavailable');
    });
    const submit = vi.fn(async () => ({
      kind: 'complete' as const,
      outputs: [
        {
          mediaKind: 'image' as const,
          role: 'primary' as const,
          source: { kind: 'file' as const, path: outputPath },
          mimeType: 'image/png',
        },
      ],
    }));
    const harness = await createV2Harness(controllableAdapter('weprompt-image-v1', { submit }), {
      decorateMediaStore: (mediaStore) => ({ ...mediaStore, persistProviderOutputForJobV2 }),
    });
    outputPath = path.join(harness.rootDir, 'provider-primary.png');
    await writeFile(outputPath, png);

    await dispatchV2(harness);
    await expectV2Job(harness, {
      status: 'failed',
      error: { code: 'download_failed' },
      spendReceipt: { jobId: 'job_v2_1', totalMinorUnits: 3 },
    });
    expect(persistProviderOutputForJobV2).toHaveBeenCalledOnce();
  });

  it('returns the current paid V2 job when a racing media commit reports it inactive', async () => {
    let outputPath = '';
    const persistProviderOutputForJobV2 = vi.fn(async (input: { body: AsyncIterable<Uint8Array> }) => {
      for await (const _chunk of input.body) {
        // Drain the provider stream before reporting the simulated transaction race.
      }
      throw new CreativeStudioMediaError('job_inactive');
    });
    const submit = vi.fn(async () => ({
      kind: 'complete' as const,
      outputs: [
        {
          mediaKind: 'image' as const,
          role: 'primary' as const,
          source: { kind: 'file' as const, path: outputPath },
          mimeType: 'image/png' as const,
        },
      ],
    }));
    const harness = await createV2Harness(controllableAdapter('weprompt-image-v1', { submit }), {
      decorateMediaStore: (mediaStore) => ({ ...mediaStore, persistProviderOutputForJobV2 }),
    });
    outputPath = path.join(harness.rootDir, 'raced-primary.png');
    await writeFile(outputPath, png);

    await dispatchV2(harness);
    await expectV2Job(harness, {
      status: 'running',
      error: null,
      outputAssetIds: [],
      spendReceipt: { jobId: 'job_v2_1' },
    });
  });

  it('keeps a successful V2 video primary when optional poster shape or storage is unusable', async () => {
    const cases: Array<'missing' | 'wrong_media' | 'symbolic_link'> = ['missing', 'wrong_media', 'symbolic_link'];
    for (const candidate of cases) {
      let primaryPath = '';
      let posterPath = '';
      const submit = vi.fn(async () => ({
        kind: 'complete' as const,
        outputs: [
          {
            mediaKind: 'video' as const,
            role: 'primary' as const,
            source: { kind: 'file' as const, path: primaryPath },
            mimeType: 'video/mp4' as const,
          },
          ...(candidate === 'missing'
            ? []
            : [
                {
                  mediaKind: candidate === 'wrong_media' ? ('video' as const) : ('image' as const),
                  role: 'poster' as const,
                  source: { kind: 'file' as const, path: posterPath },
                  mimeType: candidate === 'wrong_media' ? ('video/mp4' as const) : ('image/png' as const),
                },
              ]),
        ],
      }));
      // eslint-disable-next-line no-await-in-loop -- Each optional-poster refusal owns a fresh paid job.
      const harness = await createV2Harness(controllableAdapter('weprompt-media-gateway-v1', { submit }), {
        purpose: 'video_take',
        probeVideoDurationSecondsV2: async () => 5,
      });
      primaryPath = path.join(harness.rootDir, `${candidate}-primary.mp4`);
      posterPath = path.join(harness.rootDir, `${candidate}-poster.png`);
      // eslint-disable-next-line no-await-in-loop -- The canonical primary is always valid.
      await writeFile(primaryPath, mp4);
      if (candidate === 'symbolic_link') {
        const target = path.join(harness.rootDir, `${candidate}-poster-target.png`);
        // eslint-disable-next-line no-await-in-loop -- Seed one hostile optional poster leaf.
        await writeFile(target, png);
        // eslint-disable-next-line no-await-in-loop -- Provider poster authority may not cross a symlink.
        await nodeFs.symlink(target, posterPath);
      }
      // eslint-disable-next-line no-await-in-loop -- Poster failure must not roll back the primary.
      await dispatchV2(harness);
      // eslint-disable-next-line no-await-in-loop -- All optional poster failures converge on primary-only success.
      await expectV2Job(harness, {
        status: 'succeeded',
        outputAssetIdsByRole: { primary: expect.any(String), poster: null },
      });
    }
  });

  it('allows cancellation before completion but closes it after a receipt exists', async () => {
    const cancel = vi.fn(async () => ({ kind: 'cancelled' as const }));
    const submit = vi.fn(async () => ({ kind: 'complete' as const, outputs: [] }));
    const harness = await createV2Harness(controllableAdapter('weprompt-image-v1', { submit, cancel }));

    await expect(
      harness.manager.cancelJobV2({
        projectId: harness.project.id,
        jobId: 'job_v2_1',
        expectedRevision: harness.project.revision,
      })
    ).resolves.toMatchObject({ status: 'cancelled', spendReceipt: null });
    expect(cancel).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();

    const second = await createV2Harness(controllableAdapter('weprompt-image-v1', { submit, cancel }));
    const receipt = createStudioSpendReceiptV2({
      authorization: second.authorization,
      itemId: second.item.id,
      jobId: 'job_v2_1',
      generationIndex: 0,
    });
    const receiptBearing = await second.store.updateProjectV2(second.project.id, (project) => {
      const job = project.jobs.job_v2_1!;
      job.status = 'running';
      job.providerJobId = 'remote_paid';
      job.remoteStartedAt = project.updatedAt;
      job.spendReceipt = receipt;
      return project;
    });

    expect(canCancelJobV2(receiptBearing.jobs.job_v2_1!)).toBe(false);
    await expect(
      second.manager.cancelJobV2({
        projectId: second.project.id,
        jobId: 'job_v2_1',
        expectedRevision: receiptBearing.revision,
      })
    ).rejects.toMatchObject({ code: 'cancellation_refused' });
    expect(cancel).not.toHaveBeenCalled();
  });

  it('recovers a remote job from persisted provider binding without consulting the edited route catalog', async () => {
    const submit = vi.fn(async () => {
      throw new Error('must not submit again');
    });
    const poll = vi.fn(async () => ({ status: 'succeeded' as const, outputs: [] }));
    const harness = await createV2Harness(controllableAdapter('weprompt-image-v1', { submit, poll }), {
      sleep: async () => undefined,
      nowEpochMs: () => Date.parse('2026-08-17T12:00:03.000Z'),
    });
    const remote = await harness.store.updateProjectV2(harness.project.id, (project) => {
      const job = project.jobs.job_v2_1!;
      job.status = 'queued_remote';
      job.providerJobId = 'remote_1';
      job.remoteStartedAt = '2026-08-17T12:00:02.000Z';
      return project;
    });
    const isGenerationRouteAvailable = vi
      .spyOn(harness.providerResolver, 'isGenerationRouteAvailable')
      .mockRejectedValue(new Error('catalog unavailable'));
    const resumeConditioningFramesV2 = vi.spyOn(harness.mediaStore, 'resumeConditioningFramesV2');

    await harness.manager.resumePendingJobsV2([remote.id]);
    await expectV2Job(harness, {
      status: 'failed',
      error: { code: 'no_output' },
      spendReceipt: { jobId: 'job_v2_1' },
    });
    expect(resumeConditioningFramesV2).toHaveBeenCalledWith([remote.id]);
    expect(isGenerationRouteAvailable).not.toHaveBeenCalled();
    expect(poll).toHaveBeenCalledWith('remote_1', expect.objectContaining({ id: provider.id }), expect.anything());
    expect(submit).not.toHaveBeenCalled();
  });

  it('recovers or suppresses every durable V2 local, ambiguous, terminal, deadline, and missing-binding state', async () => {
    const missingProject = await createV2Harness(controllableAdapter('weprompt-image-v1'));
    await expect(missingProject.manager.resumePendingJobsV2(['missing_project'])).resolves.toBeUndefined();

    const submit = vi.fn(async () => ({ kind: 'complete' as const, outputs: [] }));
    const queued = await createV2Harness(controllableAdapter('weprompt-image-v1', { submit }));
    await queued.manager.resumePendingJobsV2([queued.project.id]);
    await expectV2Job(queued, { status: 'failed', error: { code: 'no_output' }, spendReceipt: expect.any(Object) });
    expect(submit).toHaveBeenCalledOnce();

    const submitting = await createV2Harness(controllableAdapter('weprompt-image-v1', { submit: vi.fn() }));
    await submitting.store.updateProjectV2(submitting.project.id, (project) => {
      project.jobs.job_v2_1!.status = 'submitting';
      return project;
    });
    await submitting.manager.resumePendingJobsV2([submitting.project.id]);
    await expectV2Job(submitting, {
      status: 'needs_attention',
      providerJobId: null,
      error: { code: 'submission_unknown' },
    });

    const skippedStates = [
      {
        status: 'failed' as const,
        providerJobId: null,
        error: { code: 'provider_unavailable' as const, messageKey: 'providerUnavailable' },
      },
      {
        status: 'needs_attention' as const,
        providerJobId: null,
        error: { code: 'submission_unknown' as const, messageKey: 'submissionUnknown' },
      },
      {
        status: 'needs_attention' as const,
        providerJobId: 'remote_deadline',
        error: { code: 'poll_deadline' as const, messageKey: 'pollDeadline' },
      },
    ];
    for (const [index, state] of skippedStates.entries()) {
      // eslint-disable-next-line no-await-in-loop -- Every durable suppression state owns an independent recovery run.
      const harness = await createV2Harness(controllableAdapter('weprompt-image-v1', { submit: vi.fn() }));
      // eslint-disable-next-line no-await-in-loop -- Persist the exact restart state before recovery.
      const persisted = await harness.store.updateProjectV2(harness.project.id, (project) => {
        const job = project.jobs.job_v2_1!;
        job.status = state.status;
        job.providerJobId = state.providerJobId;
        job.remoteStartedAt = state.providerJobId === null ? null : project.updatedAt;
        job.error = state.error;
        return project;
      });
      // eslint-disable-next-line no-await-in-loop -- Recovery is deterministic per project.
      await harness.manager.resumePendingJobsV2([harness.project.id]);
      const loaded = await harness.store.getProjectV2(harness.project.id);
      expect(loaded.status === 'supported' ? loaded.project.jobs.job_v2_1 : null, `skip state ${index}`).toEqual(
        persisted.jobs.job_v2_1
      );
    }

    const expiredPoll = vi.fn(async () => ({ status: 'running' as const }));
    const expired = await createV2Harness(
      controllableAdapter('weprompt-image-v1', { submit: vi.fn(), poll: expiredPoll }),
      {
        nowEpochMs: () => Date.parse('2026-08-17T13:00:00.000Z'),
      }
    );
    await expired.store.updateProjectV2(expired.project.id, (project) => {
      const job = project.jobs.job_v2_1!;
      job.status = 'queued_remote';
      job.providerJobId = 'remote_expired';
      job.remoteStartedAt = '2026-08-17T12:00:00.000Z';
      return project;
    });
    await expired.manager.resumePendingJobsV2([expired.project.id]);
    await expectV2Job(expired, { status: 'needs_attention', error: { code: 'poll_deadline' } });
    expect(expiredPoll).not.toHaveBeenCalled();

    const missingBinding = await createV2Harness(
      controllableAdapter('weprompt-image-v1', { submit: vi.fn(), poll: vi.fn() }),
      {
        listProviders: async () => [],
        nowEpochMs: () => Date.parse('2026-08-17T12:00:03.000Z'),
      }
    );
    await missingBinding.store.updateProjectV2(missingBinding.project.id, (project) => {
      const job = project.jobs.job_v2_1!;
      job.status = 'queued_remote';
      job.providerJobId = 'remote_missing_binding';
      job.remoteStartedAt = project.updatedAt;
      return project;
    });
    await missingBinding.manager.resumePendingJobsV2([missingBinding.project.id]);
    await expectV2Job(missingBinding, { status: 'needs_attention', error: { code: 'provider_unavailable' } });
  });

  it('reclaims only the same durable remote job on retry and never creates another paid submission', async () => {
    const submit = vi.fn(async () => {
      throw new Error('must not submit again');
    });
    const poll = vi.fn(async () => ({ status: 'succeeded' as const, outputs: [] }));
    const harness = await createV2Harness(controllableAdapter('weprompt-image-v1', { submit, poll }), {
      sleep: async () => undefined,
      nowEpochMs: () => Date.parse('2026-08-17T12:00:03.000Z'),
    });
    const attention = await harness.store.updateProjectV2(harness.project.id, (project) => {
      const job = project.jobs.job_v2_1!;
      job.status = 'needs_attention';
      job.providerJobId = 'remote_retry';
      job.remoteStartedAt = '2026-08-17T12:00:02.000Z';
      job.error = { code: 'unknown', messageKey: 'conversation.creativeStudio.jobs.errors.unknown' };
      return project;
    });

    await expect(
      harness.manager.retryJobV2({
        projectId: attention.id,
        jobId: 'job_v2_1',
        expectedRevision: attention.revision,
      })
    ).resolves.toMatchObject({ id: 'job_v2_1', status: 'queued_remote', providerJobId: 'remote_retry' });
    await expectV2Job(harness, { status: 'failed', error: { code: 'no_output' }, spendReceipt: { jobId: 'job_v2_1' } });
    expect(poll).toHaveBeenCalledOnce();
    expect(submit).not.toHaveBeenCalled();
    const loaded = await harness.store.getProjectV2(harness.project.id);
    expect(loaded.status === 'supported' ? Object.keys(loaded.project.jobs) : null).toEqual(['job_v2_1']);
  });

  it('requires explicit duplicate-charge acknowledgement before terminalizing an unknown submission', async () => {
    const submit = vi.fn(async () => {
      throw new Error('must not submit again');
    });
    const harness = await createV2Harness(controllableAdapter('weprompt-image-v1', { submit }));
    const attention = await harness.store.updateProjectV2(harness.project.id, (project) => {
      const job = project.jobs.job_v2_1!;
      job.status = 'needs_attention';
      job.providerJobId = null;
      job.error = {
        code: 'submission_unknown',
        messageKey: 'conversation.creativeStudio.jobs.errors.submissionUnknown',
      };
      return project;
    });

    await expect(
      harness.manager.retryJobV2({
        projectId: attention.id,
        jobId: 'job_v2_1',
        expectedRevision: attention.revision,
      })
    ).rejects.toMatchObject({ code: 'duplicate_charge_acknowledgement_required' });
    let loaded = await harness.store.getProjectV2(attention.id);
    expect(loaded.status === 'supported' ? loaded.project.jobs.job_v2_1 : null).toMatchObject({
      status: 'needs_attention',
      duplicateChargeAcknowledged: false,
      duplicateChargeAcknowledgedAt: null,
    });

    await expect(
      harness.manager.retryJobV2({
        projectId: attention.id,
        jobId: 'job_v2_1',
        expectedRevision: attention.revision,
        acknowledgePossibleDuplicateCharge: true,
      })
    ).resolves.toMatchObject({
      id: 'job_v2_1',
      status: 'failed',
      providerJobId: null,
      error: { code: 'submission_unknown' },
      duplicateChargeAcknowledged: false,
      duplicateChargeAcknowledgedAt: null,
    });
    loaded = await harness.store.getProjectV2(attention.id);
    expect(loaded.status === 'supported' ? Object.keys(loaded.project.jobs) : null).toEqual(['job_v2_1']);
    expect(submit).not.toHaveBeenCalled();
  });

  it('refuses every V2 retry state that would mint work, cross a parked Beat, or race a sibling', async () => {
    const harness = await createV2Harness(controllableAdapter('weprompt-image-v1'));
    await expect(
      harness.manager.retryJobV2({
        projectId: harness.project.id,
        jobId: 'missing_job',
        expectedRevision: harness.project.revision,
      })
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(
      harness.manager.retryJobV2({
        projectId: harness.project.id,
        jobId: 'job_v2_1',
        expectedRevision: harness.project.revision,
      })
    ).rejects.toMatchObject({ code: 'invalid_request' });

    const failed = await harness.store.updateProjectV2(harness.project.id, (project) => {
      const job = project.jobs.job_v2_1!;
      job.status = 'failed';
      job.error = { code: 'provider_unavailable', messageKey: 'providerUnavailable' };
      return project;
    });
    await expect(
      harness.manager.retryJobV2({ projectId: failed.id, jobId: 'job_v2_1', expectedRevision: failed.revision })
    ).rejects.toMatchObject({ code: 'invalid_request' });

    const parked = await harness.store.updateProjectV2(harness.project.id, (project) => {
      project.beatOrder = [];
      project.bin.push({ kind: 'beat', beatId: 'beat_1', reason: 'lifted' });
      return project;
    });
    await expect(
      harness.manager.retryJobV2({ projectId: parked.id, jobId: 'job_v2_1', expectedRevision: parked.revision })
    ).rejects.toMatchObject({ code: 'invalid_request' });

    const siblings = await createV2Harness(controllableAdapter('weprompt-image-v1'), { generationCount: 2 });
    const busy = await siblings.store.updateProjectV2(siblings.project.id, (project) => {
      const job = project.jobs.job_v2_1!;
      job.status = 'failed';
      job.error = { code: 'provider_unavailable', messageKey: 'providerUnavailable' };
      return project;
    });
    await expect(
      siblings.manager.retryJobV2({ projectId: busy.id, jobId: 'job_v2_1', expectedRevision: busy.revision })
    ).rejects.toMatchObject({ code: 'busy' });
  });

  it('bounds V2 download retry across absent remotes, adapters, siblings, and terminal provider results', async () => {
    const receiptFor = (harness: V2Harness) =>
      createStudioSpendReceiptV2({
        authorization: harness.authorization,
        itemId: harness.item.id,
        jobId: 'job_v2_1',
        generationIndex: 0,
      });
    const markDownloadFailed = (harness: V2Harness, providerJobId: string | null) =>
      harness.store.updateProjectV2(harness.project.id, (project) => {
        const job = project.jobs.job_v2_1!;
        job.status = 'failed';
        job.providerJobId = providerJobId;
        job.remoteStartedAt = providerJobId === null ? null : project.updatedAt;
        job.error = { code: 'download_failed', messageKey: 'downloadFailed' };
        job.spendReceipt = receiptFor(harness);
        return project;
      });

    const missingRemote = await createV2Harness(controllableAdapter('weprompt-image-v1'));
    await expect(
      missingRemote.manager.retryDownloadV2({
        projectId: missingRemote.project.id,
        jobId: 'missing_job',
        expectedRevision: missingRemote.project.revision,
      })
    ).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(
      missingRemote.manager.retryDownloadV2({
        projectId: missingRemote.project.id,
        jobId: 'job_v2_1',
        expectedRevision: missingRemote.project.revision,
      })
    ).rejects.toMatchObject({ code: 'invalid_request' });
    const localFailure = await markDownloadFailed(missingRemote, null);
    await expect(
      missingRemote.manager.retryDownloadV2({
        projectId: localFailure.id,
        jobId: 'job_v2_1',
        expectedRevision: localFailure.revision,
      })
    ).rejects.toMatchObject({ code: 'unsupported' });

    const noPoll = await createV2Harness(controllableAdapter('weprompt-image-v1'));
    const noPollFailure = await markDownloadFailed(noPoll, 'remote_no_poll');
    await expect(
      noPoll.manager.retryDownloadV2({
        projectId: noPollFailure.id,
        jobId: 'job_v2_1',
        expectedRevision: noPollFailure.revision,
      })
    ).rejects.toMatchObject({ code: 'unsupported' });

    const missingBinding = await createV2Harness(
      controllableAdapter('weprompt-image-v1', { poll: async () => ({ status: 'queued' }) }),
      { listProviders: async () => [] }
    );
    const missingBindingFailure = await markDownloadFailed(missingBinding, 'remote_missing_binding');
    await expect(
      missingBinding.manager.retryDownloadV2({
        projectId: missingBindingFailure.id,
        jobId: 'job_v2_1',
        expectedRevision: missingBindingFailure.revision,
      })
    ).rejects.toMatchObject({ code: 'invalid_route' });

    const busyHarness = await createV2Harness(
      controllableAdapter('weprompt-image-v1', { poll: async () => ({ status: 'queued' }) }),
      {
        generationCount: 2,
      }
    );
    const busyFailure = await markDownloadFailed(busyHarness, 'remote_busy');
    await expect(
      busyHarness.manager.retryDownloadV2({
        projectId: busyFailure.id,
        jobId: 'job_v2_1',
        expectedRevision: busyFailure.revision,
      })
    ).rejects.toMatchObject({ code: 'busy' });

    const snapshots = [
      { status: 'failed' as const, error: { code: 'unknown' as const } },
      { status: 'expired' as const, error: { code: 'unknown' as const } },
      { status: 'cancelled' as const, error: { code: 'unknown' as const } },
      { status: 'queued' as const },
    ];
    for (const [index, snapshot] of snapshots.entries()) {
      const poll = vi.fn(async () => snapshot);
      // eslint-disable-next-line no-await-in-loop -- Each provider terminal must transition independently.
      const harness = await createV2Harness(controllableAdapter('weprompt-image-v1', { poll }));
      // eslint-disable-next-line no-await-in-loop -- Each fixture owns one durable remote identity.
      const failed = await markDownloadFailed(harness, `remote_result_${index}`);
      // eslint-disable-next-line no-await-in-loop -- Retry is intentionally one bounded poll attempt.
      const result = await harness.manager
        .retryDownloadV2({
          projectId: failed.id,
          jobId: 'job_v2_1',
          expectedRevision: failed.revision,
        })
        .catch((error: unknown) => {
          throw new Error(`snapshot ${index} failed: ${error instanceof Error ? error.message : String(error)}`);
        });
      expect(result).toMatchObject({ status: 'failed', error: expect.any(Object) });
      expect(poll).toHaveBeenCalledOnce();
    }
  });

  it('rejects download retry for individually binned Shots and Shots in binned Beats before resolver or provider work', async () => {
    await Promise.all(
      (['shot', 'beat'] as const).map(async (binKind) => {
        const submit = vi.fn(async () => {
          throw new Error('inactive retry must not submit');
        });
        const poll = vi.fn(async () => ({ status: 'queued' as const }));
        const listProviders = vi.fn(async () => {
          throw new Error('inactive retry must not resolve providers');
        });
        const providerResolver = {
          listConnectionCandidates: vi.fn(async () => {
            throw new Error('inactive retry must not list connections');
          }),
          listGenerationRoutes: vi.fn(async () => {
            throw new Error('inactive retry must not list routes');
          }),
          isGenerationRouteAvailable: vi.fn(async () => {
            throw new Error('inactive retry must not resolve routes');
          }),
        } satisfies StudioJobManagerDeps['providerResolver'];
        const harness = await createV2Harness(controllableAdapter('weprompt-image-v1', { submit, poll }), {
          listProviders,
          providerResolver,
        });
        const receipt = createStudioSpendReceiptV2({
          authorization: harness.authorization,
          itemId: harness.item.id,
          jobId: 'job_v2_1',
          generationIndex: 0,
        });
        const parked = await harness.store.updateProjectV2(harness.project.id, (project) => {
          const job = project.jobs.job_v2_1!;
          job.status = 'failed';
          job.providerJobId = `remote_binned_${binKind}`;
          job.remoteStartedAt = project.updatedAt;
          job.error = { code: 'download_failed', messageKey: 'downloadFailed' };
          job.spendReceipt = receipt;
          if (binKind === 'shot') {
            project.beats.beat_1!.shotOrder = [];
            project.bin.push({ kind: 'shot', beatId: 'beat_1', shotId: 'shot_1', reason: 'lifted' });
          } else {
            project.beatOrder = [];
            project.bin.push({ kind: 'beat', beatId: 'beat_1', reason: 'lifted' });
          }
          return project;
        });
        const projectPath = path.join(harness.rootDir, parked.id, 'project.json');
        const bytesBefore = await nodeFs.readFile(projectPath);

        await expect(
          harness.manager.retryDownloadV2({
            projectId: parked.id,
            jobId: 'job_v2_1',
            expectedRevision: parked.revision,
          })
        ).rejects.toMatchObject({ code: 'invalid_request' });

        expect(await nodeFs.readFile(projectPath)).toEqual(bytesBefore);
        const loaded = await harness.store.getProjectV2(parked.id);
        expect(loaded.status === 'supported' ? loaded.project : null).toEqual(parked);
        expect(listProviders).not.toHaveBeenCalled();
        expect(providerResolver.listConnectionCandidates).not.toHaveBeenCalled();
        expect(providerResolver.listGenerationRoutes).not.toHaveBeenCalled();
        expect(providerResolver.isGenerationRouteAvailable).not.toHaveBeenCalled();
        expect(submit).not.toHaveBeenCalled();
        expect(poll).not.toHaveBeenCalled();
      })
    );
  });

  it('retry-download reuses the same job, provider identity, snapshot, and receipt', async () => {
    let outputPath = '';
    const submit = vi.fn(async () => {
      throw new Error('must not submit again');
    });
    const poll = vi.fn(async () => ({
      status: 'succeeded' as const,
      outputs: [
        {
          mediaKind: 'image' as const,
          role: 'primary' as const,
          source: { kind: 'file' as const, path: outputPath },
          mimeType: 'image/png',
        },
      ],
    }));
    const harness = await createV2Harness(controllableAdapter('weprompt-image-v1', { submit, poll }));
    outputPath = path.join(harness.rootDir, 'retried-primary.png');
    await writeFile(outputPath, png);
    const receipt = createStudioSpendReceiptV2({
      authorization: harness.authorization,
      itemId: harness.item.id,
      jobId: 'job_v2_1',
      generationIndex: 0,
    });
    const failed = await harness.store.updateProjectV2(harness.project.id, (project) => {
      const job = project.jobs.job_v2_1!;
      job.status = 'failed';
      job.providerJobId = 'remote_download';
      job.remoteStartedAt = '2026-08-17T12:00:02.000Z';
      job.error = { code: 'download_failed', messageKey: 'conversation.creativeStudio.jobs.errors.downloadFailed' };
      job.spendReceipt = receipt;
      return project;
    });

    await expect(
      harness.manager.retryDownloadV2({
        projectId: failed.id,
        jobId: 'job_v2_1',
        expectedRevision: failed.revision,
      })
    ).resolves.toMatchObject({ id: 'job_v2_1', status: 'succeeded', spendReceipt: receipt });
    expect(poll).toHaveBeenCalledWith('remote_download', expect.anything(), expect.anything());
    expect(submit).not.toHaveBeenCalled();
    const loaded = await harness.store.getProjectV2(harness.project.id);
    expect(loaded.status === 'supported' ? Object.keys(loaded.project.jobs) : null).toEqual(['job_v2_1']);
  });
});

describe('StudioJobManager remote polling deadlines', () => {
  it('bounds a poll attempt when the provider transport outlives its abort signal', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-04T00:00:00.000Z'));
    try {
      const poll = vi.fn(async () => new Promise<ProviderJobSnapshot>(() => undefined));
      const adapter: GenerationProviderAdapter = {
        id: 'weprompt-image-v1',
        validateConnection: async () => ({ ok: true }),
        validateRequest: (request) => ({
          ok: true,
          normalized: {
            aspectRatio: request.aspectRatio,
            resolution: request.resolution,
            durationSeconds: request.durationSeconds,
          },
        }),
        submit: async () => ({ kind: 'remote', providerJobId: 'remote_slow' }),
        poll,
      };
      const harness = await createHarness(adapter, {
        sleep: async () => undefined,
        now: () => new Date(Date.now()).toISOString(),
        nowEpochMs: () => Date.now(),
      });

      await harness.manager.submitScenes({
        projectId: harness.project.id,
        expectedRevision: harness.project.revision,
        sceneIds: ['scene_1'],
        routes: [route],
        catalogVersion: 'catalog_1',
      });
      await vi.waitFor(() => expect(poll).toHaveBeenCalledOnce());
      await vi.advanceTimersByTimeAsync(REMOTE_POLL_ATTEMPT_TIMEOUT_MS + 1_000);

      await vi.waitFor(async () =>
        expect((await harness.store.getProject(harness.project.id))?.jobs.job_1).toMatchObject({
          status: 'needs_attention',
          providerJobId: 'remote_slow',
          error: { code: 'timeout' },
        })
      );
      expect(poll).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it('ignores a successful poll result that arrives after its attempt timeout', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-04T00:00:00.000Z'));
    try {
      let outputPath = '';
      const poll = vi.fn(
        async () =>
          new Promise<ProviderJobSnapshot>((resolve) => {
            setTimeout(
              () =>
                resolve({
                  status: 'succeeded',
                  outputs: [
                    {
                      mediaKind: 'image',
                      role: 'primary',
                      source: { kind: 'file', path: outputPath },
                      mimeType: 'image/png',
                    },
                  ],
                }),
              REMOTE_POLL_ATTEMPT_TIMEOUT_MS + 1_000
            );
          })
      );
      const adapter: GenerationProviderAdapter = {
        id: 'weprompt-image-v1',
        validateConnection: async () => ({ ok: true }),
        validateRequest: (request) => ({
          ok: true,
          normalized: {
            aspectRatio: request.aspectRatio,
            resolution: request.resolution,
            durationSeconds: request.durationSeconds,
          },
        }),
        submit: async () => ({ kind: 'remote', providerJobId: 'remote_late_success' }),
        poll,
      };
      const harness = await createHarness(adapter, {
        sleep: async () => undefined,
        now: () => new Date(Date.now()).toISOString(),
        nowEpochMs: () => Date.now(),
      });
      outputPath = path.join(harness.rootDir, 'late-success.png');
      await writeFile(outputPath, png);

      await harness.manager.submitScenes({
        projectId: harness.project.id,
        expectedRevision: harness.project.revision,
        sceneIds: ['scene_1'],
        routes: [route],
        catalogVersion: 'catalog_1',
      });
      await vi.waitFor(() => expect(poll).toHaveBeenCalledOnce());
      await vi.advanceTimersByTimeAsync(REMOTE_POLL_ATTEMPT_TIMEOUT_MS + 1_000);

      await vi.waitFor(async () => {
        const project = await harness.store.getProject(harness.project.id);
        expect(project?.jobs.job_1).toMatchObject({ status: 'needs_attention', error: { code: 'timeout' } });
        expect(project?.assets).toEqual({});
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('consumes a poll rejection that arrives after its attempt timeout', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-04T00:00:00.000Z'));
    try {
      const poll = vi.fn(
        async () =>
          new Promise<ProviderJobSnapshot>((_resolve, reject) => {
            setTimeout(
              () => reject(Object.assign(new Error('late auth rejection'), { code: 'auth' })),
              REMOTE_POLL_ATTEMPT_TIMEOUT_MS + 1_000
            );
          })
      );
      const adapter: GenerationProviderAdapter = {
        id: 'weprompt-image-v1',
        validateConnection: async () => ({ ok: true }),
        validateRequest: (request) => ({
          ok: true,
          normalized: {
            aspectRatio: request.aspectRatio,
            resolution: request.resolution,
            durationSeconds: request.durationSeconds,
          },
        }),
        submit: async () => ({ kind: 'remote', providerJobId: 'remote_late_rejection' }),
        poll,
      };
      const harness = await createHarness(adapter, {
        sleep: async () => undefined,
        now: () => new Date(Date.now()).toISOString(),
        nowEpochMs: () => Date.now(),
      });

      await harness.manager.submitScenes({
        projectId: harness.project.id,
        expectedRevision: harness.project.revision,
        sceneIds: ['scene_1'],
        routes: [route],
        catalogVersion: 'catalog_1',
      });
      await vi.waitFor(() => expect(poll).toHaveBeenCalledOnce());
      await vi.advanceTimersByTimeAsync(REMOTE_POLL_ATTEMPT_TIMEOUT_MS + 1_000);

      await vi.waitFor(async () =>
        expect((await harness.store.getProject(harness.project.id))?.jobs.job_1).toMatchObject({
          status: 'needs_attention',
          error: { code: 'timeout' },
        })
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('discards a late success after the durable provider identity changes', async () => {
    let outputPath = '';
    const polled = deferred<ProviderJobSnapshot>();
    const poll = vi.fn(async () => polled.promise);
    const adapter: GenerationProviderAdapter = {
      id: 'weprompt-image-v1',
      validateConnection: async () => ({ ok: true }),
      validateRequest: (request) => ({
        ok: true,
        normalized: {
          aspectRatio: request.aspectRatio,
          resolution: request.resolution,
          durationSeconds: request.durationSeconds,
        },
      }),
      submit: async () => ({ kind: 'remote', providerJobId: 'remote_original' }),
      poll,
    };
    const nowMs = Date.parse('2026-08-04T00:00:00.000Z');
    const harness = await createHarness(adapter, {
      sleep: async () => undefined,
      now: () => new Date(nowMs).toISOString(),
      nowEpochMs: () => nowMs,
    });
    outputPath = path.join(harness.rootDir, 'stale-provider-success.png');
    await writeFile(outputPath, png);
    await harness.manager.submitScenes({
      projectId: harness.project.id,
      expectedRevision: harness.project.revision,
      sceneIds: ['scene_1'],
      routes: [route],
      catalogVersion: 'catalog_1',
    });
    await waitFor(() => expect(poll).toHaveBeenCalledOnce());
    await harness.store.updateProject(harness.project.id, (project) => {
      project.jobs.job_1.providerJobId = 'remote_replacement';
      project.jobs.job_1.remoteStartedAt = new Date(nowMs).toISOString();
      project.jobs.job_1.status = 'running';
      return project;
    });

    polled.resolve({
      status: 'succeeded',
      outputs: [
        {
          mediaKind: 'image',
          role: 'primary',
          source: { kind: 'file', path: outputPath },
          mimeType: 'image/png',
        },
      ],
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    await expect(harness.store.getProject(harness.project.id)).resolves.toMatchObject({
      jobs: { job_1: { status: 'running', providerJobId: 'remote_replacement', outputAssetIds: [] } },
      assets: {},
    });
  });

  it('discards a late poll error after the durable provider identity changes', async () => {
    const polled = deferred<ProviderJobSnapshot>();
    const poll = vi.fn(async () => polled.promise);
    const adapter: GenerationProviderAdapter = {
      id: 'weprompt-image-v1',
      validateConnection: async () => ({ ok: true }),
      validateRequest: (request) => ({
        ok: true,
        normalized: {
          aspectRatio: request.aspectRatio,
          resolution: request.resolution,
          durationSeconds: request.durationSeconds,
        },
      }),
      submit: async () => ({ kind: 'remote', providerJobId: 'remote_original' }),
      poll,
    };
    const nowMs = Date.parse('2026-08-04T00:00:00.000Z');
    const harness = await createHarness(adapter, {
      sleep: async () => undefined,
      now: () => new Date(nowMs).toISOString(),
      nowEpochMs: () => nowMs,
    });
    await harness.manager.submitScenes({
      projectId: harness.project.id,
      expectedRevision: harness.project.revision,
      sceneIds: ['scene_1'],
      routes: [route],
      catalogVersion: 'catalog_1',
    });
    await waitFor(() => expect(poll).toHaveBeenCalledOnce());
    const replacementAnchor = new Date(nowMs).toISOString();
    await harness.store.updateProject(harness.project.id, (project) => {
      project.jobs.job_1.providerJobId = 'remote_replacement';
      project.jobs.job_1.remoteStartedAt = replacementAnchor;
      project.jobs.job_1.status = 'running';
      return project;
    });

    polled.reject(Object.assign(new Error('stale provider error'), { code: 'auth' }));

    await new Promise((resolve) => setTimeout(resolve, 20));
    await expect(harness.store.getProject(harness.project.id)).resolves.toMatchObject({
      jobs: {
        job_1: {
          status: 'running',
          providerJobId: 'remote_replacement',
          remoteStartedAt: replacementAnchor,
          error: null,
        },
      },
    });
  });

  it(
    'stops repeated running snapshots at the thirty-minute lifecycle deadline',
    { retry: BUG_027_CI_RETRY },
    async () => {
      const startedAtMs = Date.parse('2026-08-04T00:00:00.000Z');
      const deadlineReached = deferred<void>();
      let epochMs = startedAtMs;
      let pollCount = 0;
      let harness!: Harness;
      const poll = vi.fn(async (): Promise<ProviderJobSnapshot> => {
        pollCount += 1;
        return pollCount < 130 ? { status: 'running' } : { status: 'failed', error: { code: 'unknown' } };
      });
      const adapter: GenerationProviderAdapter = {
        id: 'weprompt-image-v1',
        validateConnection: async () => ({ ok: true }),
        validateRequest: (request) => ({
          ok: true,
          normalized: {
            aspectRatio: request.aspectRatio,
            resolution: request.resolution,
            durationSeconds: request.durationSeconds,
          },
        }),
        submit: async () => ({ kind: 'remote', providerJobId: 'remote_running' }),
        poll,
      };
      harness = await createHarness(adapter, {
        sleep: async (delayMs) => void (epochMs += delayMs),
        now: () => new Date(epochMs).toISOString(),
        nowEpochMs: () => epochMs,
        onProjectUpdated: (projectId) => {
          if (poll.mock.calls.length < 122) return;
          void harness.store.getProject(projectId).then((project) => {
            const job = project?.jobs.job_1;
            if (job?.status === 'needs_attention' && job.error?.code === 'poll_deadline') deadlineReached.resolve();
          }, deadlineReached.reject);
        },
      });

      await harness.manager.submitScenes({
        projectId: harness.project.id,
        expectedRevision: harness.project.revision,
        sceneIds: ['scene_1'],
        routes: [route],
        catalogVersion: 'catalog_1',
      });

      await deadlineReached.promise;
      await waitFor(async () =>
        expect((await harness.store.getProject(harness.project.id))?.jobs.job_1).toMatchObject({
          status: 'needs_attention',
          remoteStartedAt: '2026-08-04T00:00:00.000Z',
          error: { code: 'poll_deadline' },
        })
      );
      expect(poll).toHaveBeenCalledTimes(122);
    }
  );

  it('clamps pre-poll backoff to the remaining lifecycle and does not dispatch at the deadline', async () => {
    const startedAtMs = Date.parse('2026-08-04T00:00:00.000Z');
    let epochMs = startedAtMs + REMOTE_POLL_DEADLINE_MS - 1_000;
    const delays: number[] = [];
    const poll = vi.fn(
      async (): Promise<ProviderJobSnapshot> => ({
        status: 'failed',
        error: { code: 'unknown' },
      })
    );
    const harness = await createHarness(
      {
        id: 'weprompt-image-v1',
        validateConnection: async () => ({ ok: true }),
        validateRequest: () => ({ ok: false, issues: [{ code: 'invalid_request' }] }),
        submit: vi.fn(),
        poll,
      },
      {
        sleep: async (delayMs) => {
          delays.push(delayMs);
          epochMs += delayMs;
        },
        now: () => new Date(epochMs).toISOString(),
        nowEpochMs: () => epochMs,
      }
    );
    await seedRemoteJob(harness, { remoteStartedAt: new Date(startedAtMs).toISOString() });

    await harness.manager.resumePendingJobs();

    await waitFor(async () =>
      expect((await harness.store.getProject(harness.project.id))?.jobs.job_1.error?.code).toBe('poll_deadline')
    );
    expect(delays).toEqual([1_000]);
    expect(poll).not.toHaveBeenCalled();
  });

  it('polls once just before the deadline but never polls at the deadline', async () => {
    const startedAtMs = Date.parse('2026-08-04T00:00:00.000Z');
    for (const [offsetMs, expectedPolls, expectedCode] of [
      [REMOTE_POLL_DEADLINE_MS - 1, 1, 'unknown'],
      [REMOTE_POLL_DEADLINE_MS, 0, 'poll_deadline'],
    ] as const) {
      let epochMs = startedAtMs + offsetMs;
      const poll = vi.fn(
        async (): Promise<ProviderJobSnapshot> => ({
          status: 'failed',
          error: { code: 'unknown' },
        })
      );
      const harness = await createHarness(
        {
          id: 'weprompt-image-v1',
          validateConnection: async () => ({ ok: true }),
          validateRequest: () => ({ ok: false, issues: [{ code: 'invalid_request' }] }),
          submit: vi.fn(),
          poll,
        },
        {
          sleep: async () => undefined,
          now: () => new Date(epochMs).toISOString(),
          nowEpochMs: () => epochMs,
        }
      );
      await seedRemoteJob(harness, { remoteStartedAt: new Date(startedAtMs).toISOString() });

      await harness.manager.resumePendingJobs();

      await waitFor(async () =>
        expect((await harness.store.getProject(harness.project.id))?.jobs.job_1.error?.code).toBe(expectedCode)
      );
      expect(poll).toHaveBeenCalledTimes(expectedPolls);
      epochMs += 1;
    }
  });

  it.each([
    {
      label: 'a valid legacy createdAt',
      createdAt: '2026-08-04T00:00:00.000Z',
      nowMs: Date.parse('2026-08-04T00:30:00.000Z'),
    },
    {
      label: 'an invalid legacy createdAt',
      createdAt: 'invalid-created-at',
      nowMs: Date.parse('2026-08-04T00:00:00.000Z'),
    },
  ])('fails closed without polling from $label', async ({ createdAt, nowMs }) => {
    const poll = vi.fn(async (): Promise<ProviderJobSnapshot> => ({ status: 'running' }));
    const harness = await createHarness(
      {
        id: 'weprompt-image-v1',
        validateConnection: async () => ({ ok: true }),
        validateRequest: () => ({ ok: false, issues: [{ code: 'invalid_request' }] }),
        submit: vi.fn(),
        poll,
      },
      {
        sleep: async () => undefined,
        now: () => new Date(nowMs).toISOString(),
        nowEpochMs: () => nowMs,
      }
    );
    await seedRemoteJob(harness, { createdAt, omitRemoteStartedAt: true });

    await harness.manager.resumePendingJobs();

    await waitFor(async () =>
      expect((await harness.store.getProject(harness.project.id))?.jobs.job_1.error?.code).toBe('poll_deadline')
    );
    expect(poll).not.toHaveBeenCalled();
  });

  it('leaves an existing poll_deadline recovery row unchanged without provider I/O', async () => {
    const nowMs = Date.parse('2026-08-04T00:05:00.000Z');
    const poll = vi.fn(
      async (): Promise<ProviderJobSnapshot> => ({
        status: 'failed',
        error: { code: 'unknown' },
      })
    );
    const harness = await createHarness(
      {
        id: 'weprompt-image-v1',
        validateConnection: async () => ({ ok: true }),
        validateRequest: () => ({ ok: false, issues: [{ code: 'invalid_request' }] }),
        submit: vi.fn(),
        poll,
      },
      {
        sleep: async () => undefined,
        now: () => new Date(nowMs).toISOString(),
        nowEpochMs: () => nowMs,
      }
    );
    const seeded = await seedRemoteJob(harness, {
      status: 'needs_attention',
      remoteStartedAt: '2026-08-04T00:00:00.000Z',
      error: {
        code: 'poll_deadline',
        messageKey: 'conversation.creativeStudio.jobs.errors.pollDeadline',
      },
    });
    const before = structuredClone(seeded.jobs.job_1);

    await harness.manager.resumePendingJobs();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect((await harness.store.getProject(seeded.id))?.jobs.job_1).toEqual(before);
    expect(poll).not.toHaveBeenCalled();
  });

  it('does not classify disposal of a hung attempt as a polling timeout', async () => {
    const poll = vi.fn(async () => new Promise<ProviderJobSnapshot>(() => undefined));
    const adapter: GenerationProviderAdapter = {
      id: 'weprompt-image-v1',
      validateConnection: async () => ({ ok: true }),
      validateRequest: (request) => ({
        ok: true,
        normalized: {
          aspectRatio: request.aspectRatio,
          resolution: request.resolution,
          durationSeconds: request.durationSeconds,
        },
      }),
      submit: async () => ({ kind: 'remote', providerJobId: 'remote_disposed' }),
      poll,
    };
    const nowMs = Date.parse('2026-08-04T00:00:00.000Z');
    const harness = await createHarness(adapter, {
      sleep: async () => undefined,
      now: () => new Date(nowMs).toISOString(),
      nowEpochMs: () => nowMs,
    });
    await harness.manager.submitScenes({
      projectId: harness.project.id,
      expectedRevision: harness.project.revision,
      sceneIds: ['scene_1'],
      routes: [route],
      catalogVersion: 'catalog_1',
    });
    await waitFor(() => expect(poll).toHaveBeenCalledOnce());

    await harness.manager.dispose();

    await expect(harness.store.getProject(harness.project.id)).resolves.toMatchObject({
      jobs: { job_1: { status: 'queued_remote', error: null } },
    });
  });
});

describe('StudioJobManager route and reference isolation', () => {
  const adapterWithSubmit = (submit: ReturnType<typeof vi.fn>): GenerationProviderAdapter => ({
    id: 'weprompt-image-v1',
    validateConnection: async () => ({ ok: true }),
    validateRequest: (request) => ({
      ok: true,
      normalized: {
        aspectRatio: request.aspectRatio,
        resolution: request.resolution,
        durationSeconds: request.durationSeconds,
      },
    }),
    submit,
  });

  it('rejects a submitted route that differs from the project model selection', async () => {
    const selected = { providerId: provider.id, adapterId: route.adapterId, model: 'image-a' };
    const selectedRoute = { sceneId: route.sceneId, kind: route.kind, ...selected };
    const submitted = { ...selectedRoute, model: 'image-b' };
    const selectedProvider = { ...provider, models: ['image-a', 'image-b'] };
    const harness = await createHarness(adapterWithSubmit(vi.fn()), {
      routes: [selectedRoute, submitted],
      provider: selectedProvider,
    });
    const project = await harness.store.updateProject(harness.project.id, (current) => ({
      ...current,
      routing: { ...current.routing, image: selected },
    }));

    await expect(
      harness.manager.submitScenes({
        projectId: project.id,
        expectedRevision: project.revision,
        sceneIds: ['scene_1'],
        routes: [submitted],
        catalogVersion: 'catalog_1',
      })
    ).rejects.toMatchObject({ code: 'invalid_route' });
  });

  it('rejects a new submission when its scene media kind has no project selection', async () => {
    const harness = await createHarness(adapterWithSubmit(vi.fn()));
    const project = await harness.store.updateProject(harness.project.id, (current) => ({
      ...current,
      routing: { ...current.routing, image: null },
    }));

    await expect(
      harness.manager.submitScenes({
        projectId: project.id,
        expectedRevision: project.revision,
        sceneIds: ['scene_1'],
        routes: [route],
        catalogVersion: 'catalog_1',
      })
    ).rejects.toMatchObject({ code: 'invalid_route' });
  });

  it('rejects a route whose media kind differs from the scene selection', async () => {
    const harness = await createHarness(adapterWithSubmit(vi.fn()));

    await expect(
      harness.manager.submitScenes({
        projectId: harness.project.id,
        expectedRevision: harness.project.revision,
        sceneIds: ['scene_1'],
        routes: [{ ...route, kind: 'video' }],
        catalogVersion: 'catalog_1',
      })
    ).rejects.toMatchObject({ code: 'invalid_route' });
  });

  it('rejects an unavailable project selection even when the submitted route matches it', async () => {
    const harness = await createHarness(adapterWithSubmit(vi.fn()), {
      catalog: async () => catalog([]),
    });

    await expect(
      harness.manager.submitScenes({
        projectId: harness.project.id,
        expectedRevision: harness.project.revision,
        sceneIds: ['scene_1'],
        routes: [route],
        catalogVersion: 'catalog_1',
      })
    ).rejects.toMatchObject({ code: 'invalid_route' });
  });

  it('rejects a matching selection when the submitted catalog version is stale', async () => {
    const harness = await createHarness(adapterWithSubmit(vi.fn()), {
      catalog: async () => ({ ...catalog(), generationCatalogVersion: 'catalog_2' }),
    });

    await expect(
      harness.manager.submitScenes({
        projectId: harness.project.id,
        expectedRevision: harness.project.revision,
        sceneIds: ['scene_1'],
        routes: [route],
        catalogVersion: 'catalog_1',
      })
    ).rejects.toMatchObject({ code: 'invalid_route' });
  });

  it('accepts a route that exactly matches the current project selection', async () => {
    const harness = await createHarness(adapterWithSubmit(vi.fn(async () => ({ kind: 'complete', outputs: [] }))));

    await expect(
      harness.manager.submitScenes({
        projectId: harness.project.id,
        expectedRevision: harness.project.revision,
        sceneIds: ['scene_1'],
        routes: [route],
        catalogVersion: 'catalog_1',
      })
    ).resolves.toMatchObject([{ provider: selectionFor(route) }]);
  });

  it.each(incompatibleConstraints)(
    'rejects a canonical route with incompatible %s before submit',
    async (_, override) => {
      const submit = vi.fn();
      const harness = await createHarness(adapterWithSubmit(submit), {
        catalog: async () => {
          const result = catalog();
          result.routes[0]!.constraints = {
            ...result.routes[0]!.constraints,
            ...override,
          };
          return result;
        },
      });

      await expect(
        harness.manager.submitScenes({
          projectId: harness.project.id,
          expectedRevision: harness.project.revision,
          sceneIds: ['scene_1'],
          routes: [route],
          catalogVersion: 'catalog_1',
        })
      ).rejects.toMatchObject({ code: 'invalid_route' });

      expect(submit).not.toHaveBeenCalled();
      expect((await harness.store.getProject(harness.project.id))?.jobs).toEqual({});
    }
  );

  it('rejects a scene that belongs to a different project before submit', async () => {
    const submit = vi.fn();
    const harness = await createHarness(adapterWithSubmit(submit));
    const foreignCreated = await harness.store.createProject({
      name: 'Foreign project',
      brief: '',
      aspectRatio: '16:9',
      targetDurationSeconds: 5,
      resolution: '720p',
    });
    await harness.store.updateProject(foreignCreated.id, (project) => ({
      ...project,
      sceneOrder: ['foreign_scene'],
      scenes: { foreign_scene: scene({ id: 'foreign_scene' }) },
    }));

    await expect(
      harness.manager.submitScenes({
        projectId: harness.project.id,
        expectedRevision: harness.project.revision,
        sceneIds: ['foreign_scene'],
        routes: [{ ...route, sceneId: 'foreign_scene' }],
        catalogVersion: 'catalog_1',
      })
    ).rejects.toMatchObject({ code: 'invalid_route' });

    expect(submit).not.toHaveBeenCalled();
  });

  it('rejects cross-project and foreign-scene references before resolving provider media', async () => {
    const submit = vi.fn();
    const harness = await createHarness(adapterWithSubmit(submit));
    const resolveProviderInput = vi.spyOn(harness.mediaStore, 'resolveProviderInput');
    const getProject = vi.spyOn(harness.store, 'getProject');

    for (const mismatch of [
      { projectId: 'foreign_project', sceneId: 'scene_1' },
      { projectId: harness.project.id, sceneId: 'foreign_scene' },
    ]) {
      const forged = structuredClone(harness.project);
      forged.assets.asset_reference = {
        id: 'asset_reference',
        projectId: mismatch.projectId,
        sceneId: mismatch.sceneId,
        mediaKind: 'image',
        mimeType: 'image/png',
        managedAsset: { collection: 'imports', fileName: 'asset_reference.png' },
        byteSize: png.length,
        sha256: '1'.repeat(64),
        createdAt: forged.createdAt,
      };
      forged.scenes.scene_1.referenceAssetId = 'asset_reference';
      getProject.mockResolvedValueOnce(forged);

      await expect(
        harness.manager.submitScenes({
          projectId: forged.id,
          expectedRevision: forged.revision,
          sceneIds: ['scene_1'],
          routes: [route],
          catalogVersion: 'catalog_1',
        })
      ).rejects.toMatchObject({ code: 'invalid_route' });
    }

    expect(resolveProviderInput).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
  });

  it('rejects unsupported and oversized first frames before submit', async () => {
    const submit = vi.fn();
    let supportsFirstFrame = false;
    const harness = await createHarness(adapterWithSubmit(submit), {
      catalog: async () => {
        const result = catalog();
        result.routes[0]!.constraints.supportsFirstFrame = supportsFirstFrame;
        return result;
      },
    });
    const sourcePath = path.join(harness.rootDir, 'reference.png');
    await writeFile(sourcePath, png);
    const imported = await harness.mediaStore.importReferenceFromPath({
      projectId: harness.project.id,
      sceneId: 'scene_1',
      sourcePath,
      expectedRevision: harness.project.revision,
    });
    const withReference = (await harness.store.getProject(harness.project.id))!;

    await expect(
      harness.manager.submitScenes({
        projectId: withReference.id,
        expectedRevision: withReference.revision,
        sceneIds: ['scene_1'],
        routes: [route],
        catalogVersion: 'catalog_1',
      })
    ).rejects.toMatchObject({ code: 'invalid_route' });
    expect(submit).not.toHaveBeenCalled();

    supportsFirstFrame = true;
    const resolveProviderInput = harness.mediaStore.resolveProviderInput.bind(harness.mediaStore);
    vi.spyOn(harness.mediaStore, 'resolveProviderInput').mockImplementation(async (projectId, assetId) => ({
      ...(await resolveProviderInput(projectId, assetId)),
      byteSize: 30 * 1024 * 1024 + 1,
    }));
    await expect(
      harness.manager.submitScenes({
        projectId: withReference.id,
        expectedRevision: withReference.revision,
        sceneIds: ['scene_1'],
        routes: [route],
        catalogVersion: 'catalog_1',
      })
    ).rejects.toMatchObject({ code: 'invalid_route' });

    expect(imported.id).toBe(withReference.scenes.scene_1.referenceAssetId);
    expect(submit).not.toHaveBeenCalled();
    expect((await harness.store.getProject(harness.project.id))?.jobs).toEqual({});
  });

  it('submits an image scene reference through the production image adapter as one image URI', async () => {
    const executeImageGeneration = vi.fn(async () => ({ success: false, text: 'none', error: 'no_output' }));
    const imageAdapter = createImageGenerationAdapter({
      executeImageGeneration,
      workspaceDir: '/private/studio',
    });
    const selectedProvider: IProvider = {
      ...provider,
      platform: 'gemini',
      base_url: 'https://generativelanguage.googleapis.com',
      models: ['gemini-2.5-flash-image'],
    };
    const selectedRoute: StudioResolvedSceneRouteSnapshot = {
      ...route,
      providerId: selectedProvider.id,
      model: 'gemini-2.5-flash-image',
    };
    const harness = await createHarness(imageAdapter, {
      provider: selectedProvider,
      routes: [selectedRoute],
    });
    const sourcePath = path.join(harness.rootDir, 'reference.png');
    await writeFile(sourcePath, png);
    await harness.mediaStore.importReferenceFromPath({
      projectId: harness.project.id,
      sceneId: 'scene_1',
      sourcePath,
      expectedRevision: harness.project.revision,
    });
    const withReference = (await harness.store.getProject(harness.project.id))!;

    await expect(
      harness.manager.submitScenes({
        projectId: withReference.id,
        expectedRevision: withReference.revision,
        sceneIds: ['scene_1'],
        routes: [selectedRoute],
        catalogVersion: 'catalog_1',
      })
    ).resolves.toHaveLength(1);

    await waitFor(() => expect(executeImageGeneration).toHaveBeenCalledOnce());
    expect(executeImageGeneration).toHaveBeenCalledWith(
      expect.objectContaining({ image_uris: [expect.stringMatching(/^data:image\/png;base64,/)] }),
      expect.objectContaining({ use_model: 'gemini-2.5-flash-image' }),
      '/private/studio',
      undefined,
      expect.any(AbortSignal),
      { hostedImageDownloader: expect.any(Function) }
    );
    await waitFor(async () =>
      expect((await harness.store.getProject(harness.project.id))?.jobs.job_1).toMatchObject({
        status: 'failed',
        error: { code: 'no_output' },
      })
    );
  });

  it('submits exactly one managed first frame through a fresh OpenRouter scene submission', async () => {
    const fetch = vi.fn(async () => ({
      status: 400,
      json: async () => ({ error: { metadata: { error_type: 'controlled_test_failure' } } }),
    }));
    const openRouterAdapter = createOpenRouterVideoAdapter({ fetch });
    const openRouterProvider: IProvider = {
      ...provider,
      base_url: 'https://openrouter.ai/api/v1',
      api_key: 'sk-or-test',
      models: ['bytedance/seedance-2.0'],
    };
    const openRouterRoute: StudioResolvedSceneRouteSnapshot = {
      sceneId: 'scene_1',
      providerId: openRouterProvider.id,
      adapterId: 'openrouter-video-v1',
      model: 'bytedance/seedance-2.0',
      kind: 'video',
    };
    const harness = await createHarness(openRouterAdapter, {
      provider: openRouterProvider,
      routes: [openRouterRoute],
      scenes: [scene({ mediaKind: 'video', durationSeconds: 5 })],
    });
    const sourcePath = path.join(harness.rootDir, 'reference.png');
    await writeFile(sourcePath, png);
    await harness.mediaStore.importReferenceFromPath({
      projectId: harness.project.id,
      sceneId: 'scene_1',
      sourcePath,
      expectedRevision: harness.project.revision,
    });
    const withReference = (await harness.store.getProject(harness.project.id))!;

    await expect(
      harness.manager.submitScenes({
        projectId: withReference.id,
        expectedRevision: withReference.revision,
        sceneIds: ['scene_1'],
        routes: [openRouterRoute],
        catalogVersion: 'catalog_1',
      })
    ).resolves.toHaveLength(1);

    await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('https://openrouter.ai/api/v1/videos');
    expect(init).toMatchObject({ method: 'POST' });
    expect(JSON.parse(String(init?.body))).toMatchObject({
      model: 'bytedance/seedance-2.0',
      frame_images: [
        {
          type: 'image_url',
          image_url: { url: expect.stringMatching(/^data:image\/png;base64,/) },
          frame_type: 'first_frame',
        },
      ],
    });
    await waitFor(async () =>
      expect((await harness.store.getProject(harness.project.id))?.jobs.job_1).toMatchObject({
        status: 'needs_attention',
        error: { code: 'submission_unknown' },
      })
    );
  });

  it('serializes deletion behind durable submission and refuses the active project atomically', async () => {
    const submission = deferred<ProviderSubmitResult>();
    const submit = vi.fn(async () => submission.promise);
    const harness = await createHarness(adapterWithSubmit(submit));
    const updateEnqueued = deferred<void>();
    const updateProject = harness.store.updateProject.bind(harness.store);
    let intercepted = false;
    vi.spyOn(harness.store, 'updateProject').mockImplementation((projectId, mutate, expectedRevision) => {
      const update = updateProject(projectId, mutate, expectedRevision);
      if (!intercepted) {
        intercepted = true;
        updateEnqueued.resolve(undefined);
      }
      return update;
    });

    const submitted = harness.manager.submitScenes({
      projectId: harness.project.id,
      expectedRevision: harness.project.revision,
      sceneIds: ['scene_1'],
      routes: [route],
      catalogVersion: 'catalog_1',
    });
    await updateEnqueued.promise;
    const deletion = harness.store.deleteProject(harness.project.id, harness.project.revision);

    await expect(submitted).resolves.toMatchObject([{ id: 'job_1', status: 'queued_local' }]);
    await expect(deletion).rejects.toMatchObject({ code: 'busy' });
    await waitFor(() => expect(submit).toHaveBeenCalledOnce());
    submission.reject(Object.assign(new Error('provider rejected'), { code: 'no_output' }));
    await waitFor(async () =>
      expect((await harness.store.getProject(harness.project.id))?.jobs.job_1.status).toBe('failed')
    );
  });
});

describe('StudioJobManager reference output routing', () => {
  const imageAdapterWithSubmit = (
    submit: ReturnType<typeof vi.fn>,
    currentSafetyLimit = 6
  ): GenerationProviderAdapter => ({
    id: 'weprompt-image-v1',
    validateConnection: async () => ({ ok: true }),
    validateRequest: (request) =>
      validateImageConditioningRequest(request, currentSafetyLimit, false).ok
        ? {
            ok: true,
            normalized: {
              aspectRatio: request.aspectRatio,
              resolution: request.resolution,
              durationSeconds: request.durationSeconds,
            },
          }
        : { ok: false, issues: [{ code: 'provider_unavailable' }] },
    submit,
  });

  const referenceProvider: IProvider = { ...provider, models: ['image-model', 'video-model'] };
  const imageRoute: StudioResolvedSceneRouteSnapshot = route;
  const videoRoute: StudioResolvedSceneRouteSnapshot = {
    sceneId: 'scene_1',
    providerId: provider.id,
    adapterId: 'weprompt-media-gateway-v1',
    model: 'video-model',
    kind: 'video',
  };

  /** Uses a non-default duration so the request assertion proves the scene duration is forwarded. */
  const videoScene = (): StudioScene =>
    scene({ id: 'scene_1', mediaKind: 'video', durationSeconds: 8, visualPrompt: 'video_prompt' });

  const createReferenceHarness = (
    submit: ReturnType<typeof vi.fn>,
    overrides: Partial<HarnessOptions> = {},
    currentSafetyLimit = 6
  ): Promise<Harness> =>
    createHarness(imageAdapterWithSubmit(submit, currentSafetyLimit), {
      scenes: [videoScene()],
      routes: [imageRoute, videoRoute],
      provider: referenceProvider,
      ...overrides,
    });

  const conditioningCatalog = (maximum: number): StudioGenerationRouteCatalog => {
    const built = catalog([imageRoute, videoRoute]);
    built.routes.find((candidate) => candidate.kind === 'image')!.constraints.maxConditioningImages = maximum;
    return built;
  };

  const importBriefReference = async (
    harness: Harness,
    role: 'cast' | 'look',
    index: number,
    bytes: Buffer = Buffer.concat([png, Buffer.from([index])])
  ) => {
    const sourcePath = path.join(harness.rootDir, `${role}-${index}.png`);
    await writeFile(sourcePath, bytes);
    const current = (await harness.store.getProject(harness.project.id))!;
    return harness.mediaStore.importReferenceFromPath({
      projectId: current.id,
      briefReferenceRole: role,
      sourcePath,
      expectedRevision: current.revision,
    });
  };

  const seedUnknownSubmission = (harness: Harness, outputRole: 'take' | 'reference'): Promise<StudioProject> =>
    harness.store.updateProject(harness.project.id, (project) => {
      const next = structuredClone(project);
      next.jobs.job_seed = {
        id: 'job_seed',
        projectId: project.id,
        sceneId: 'scene_1',
        status: 'needs_attention',
        provider: selectionFor(outputRole === 'reference' ? imageRoute : videoRoute),
        idempotencyKey: 'key_seed',
        providerJobId: null,
        remoteStartedAt: null,
        cancellationPolicy: 'none',
        ...(outputRole === 'reference' ? { outputRole: 'reference' as const } : {}),
        outputAssetIds: [],
        error: {
          code: 'submission_unknown',
          messageKey: 'conversation.creativeStudio.jobs.errors.submissionUnknown',
        },
        retryOfJobId: null,
        retryReason: null,
        duplicateChargeAcknowledged: false,
        duplicateChargeAcknowledgedAt: null,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
      };
      next.scenes.scene_1.jobIds = ['job_seed'];
      next.scenes.scene_1.reviewState = 'blocked';
      return next;
    });

  it('derives one active Brief reference in main before persisting and submitting a plate', async () => {
    const submit = vi.fn(async () => ({ kind: 'complete' as const, outputs: [] }));
    const validateRequest = vi.fn((request) => ({
      ok: true as const,
      normalized: {
        aspectRatio: request.aspectRatio,
        resolution: request.resolution,
        durationSeconds: request.durationSeconds,
      },
    }));
    const listGenerationRoutes = vi.fn(async () => conditioningCatalog(6));
    const onProjectUpdated = vi.fn();
    const harness = await createHarness(
      {
        ...imageAdapterWithSubmit(submit),
        validateRequest,
      },
      {
        scenes: [videoScene()],
        routes: [imageRoute, videoRoute],
        provider: referenceProvider,
        catalog: listGenerationRoutes,
        onProjectUpdated,
      }
    );
    const imported = await importBriefReference(harness, 'cast', 1);
    const withCast = (await harness.store.getProject(harness.project.id))!;
    onProjectUpdated.mockClear();

    const [job] = await harness.manager.submitScenes({
      projectId: withCast.id,
      expectedRevision: withCast.revision,
      sceneIds: ['scene_1'],
      routes: [imageRoute],
      catalogVersion: 'catalog_1',
      outputRole: 'reference',
      referencePrompts: [{ sceneId: 'scene_1', prompt: 'A calm establishing plate' }],
    });

    expect(job?.referenceInputSnapshot).toEqual({
      sourceVisualPrompt: 'A calm establishing plate',
      conditioningReferenceAssetIds: [imported.id],
      aspectRatio: '16:9',
      resolution: '720p',
    });
    await waitFor(() => expect(submit).toHaveBeenCalledOnce());
    expect(submit.mock.calls[0]?.[0]).toMatchObject({
      conditioningImageLimit: 6,
      conditioningImages: [{ assetId: imported.id }],
    });
    expect(listGenerationRoutes).toHaveBeenCalledOnce();
    expect(validateRequest).toHaveBeenCalled();
    expect(onProjectUpdated).toHaveBeenCalled();
  });

  it.each([
    { label: 'the route maximum', count: 3, maximum: 3 },
    { label: 'the application maximum', count: 6, maximum: 6 },
  ])('admits active Brief references at $label', async ({ count, maximum }) => {
    const submit = vi.fn(async () => ({ kind: 'complete' as const, outputs: [] }));
    const harness = await createReferenceHarness(submit, {
      catalog: async () => conditioningCatalog(maximum),
    });
    for (let index = 1; index <= count; index += 1) {
      await importBriefReference(harness, index % 2 === 0 ? 'look' : 'cast', index);
    }
    const current = (await harness.store.getProject(harness.project.id))!;

    await expect(
      harness.manager.submitScenes({
        projectId: current.id,
        expectedRevision: current.revision,
        sceneIds: ['scene_1'],
        routes: [imageRoute],
        catalogVersion: 'catalog_1',
        outputRole: 'reference',
        referencePrompts: [{ sceneId: 'scene_1', prompt: 'A calm establishing plate' }],
      })
    ).resolves.toMatchObject([{ outputRole: 'reference' }]);

    await waitFor(() => expect(submit).toHaveBeenCalledOnce());
    expect(submit.mock.calls[0]?.[0].conditioningImages).toHaveLength(count);
    expect(submit.mock.calls[0]?.[0].conditioningImageLimit).toBe(maximum);
  });

  it('preserves canonical cast/look order and the exact managed bytes without consuming the scene reference', async () => {
    const observedInputs: Array<{ assetId: string; sha256: string }> = [];
    const submit = vi.fn(async (request) => {
      for (const input of request.conditioningImages ?? []) {
        const chunks: Buffer[] = [];
        for await (const chunk of await input.openStream()) chunks.push(Buffer.from(chunk));
        observedInputs.push({
          assetId: input.assetId,
          sha256: createHash('sha256').update(Buffer.concat(chunks)).digest('hex'),
        });
      }
      return { kind: 'complete' as const, outputs: [] };
    });
    const harness = await createReferenceHarness(submit, {
      catalog: async () => conditioningCatalog(6),
    });
    const look = await importBriefReference(harness, 'look', 1);
    const castLater = await importBriefReference(harness, 'cast', 2);
    const castLatest = await importBriefReference(harness, 'cast', 3);
    const scenePath = path.join(harness.rootDir, 'scene-reference.png');
    await writeFile(scenePath, Buffer.concat([png, Buffer.from([99])]));
    const beforeSceneReference = (await harness.store.getProject(harness.project.id))!;
    const sceneReference = await harness.mediaStore.importReferenceFromPath({
      projectId: beforeSceneReference.id,
      sceneId: 'scene_1',
      sourcePath: scenePath,
      expectedRevision: beforeSceneReference.revision,
    });
    const current = (await harness.store.getProject(harness.project.id))!;

    await harness.manager.submitScenes({
      projectId: current.id,
      expectedRevision: current.revision,
      sceneIds: ['scene_1'],
      routes: [imageRoute],
      catalogVersion: 'catalog_1',
      outputRole: 'reference',
      referencePrompts: [{ sceneId: 'scene_1', prompt: 'A calm establishing plate' }],
    });

    await waitFor(() => expect(observedInputs).toHaveLength(3));
    expect(observedInputs).toEqual(
      [castLater, castLatest, look].map((asset) => ({ assetId: asset.id, sha256: asset.sha256 }))
    );
    expect(observedInputs.map(({ assetId }) => assetId).includes(sceneReference.id)).toBe(false);
    expect(submit.mock.calls[0]?.[0]).not.toHaveProperty('firstFrame');
  });

  it.each([
    { label: 'a zero-capacity route', maximum: 0, currentSafety: 6, count: 1 },
    { label: 'route maximum plus one', maximum: 2, currentSafety: 6, count: 3 },
    { label: 'a frozen route maximum above current safety', maximum: 6, currentSafety: 2, count: 1 },
  ])(
    'rejects $label before persistence, notification, or provider submit',
    async ({ maximum, currentSafety, count }) => {
      const submit = vi.fn();
      const onProjectUpdated = vi.fn();
      const harness = await createReferenceHarness(
        submit,
        {
          catalog: async () => conditioningCatalog(maximum),
          onProjectUpdated,
        },
        currentSafety
      );
      for (let index = 1; index <= count; index += 1) await importBriefReference(harness, 'cast', index);
      const before = (await harness.store.getProject(harness.project.id))!;
      onProjectUpdated.mockClear();

      await expect(
        harness.manager.submitScenes({
          projectId: before.id,
          expectedRevision: before.revision,
          sceneIds: ['scene_1'],
          routes: [imageRoute],
          catalogVersion: 'catalog_1',
          outputRole: 'reference',
          referencePrompts: [{ sceneId: 'scene_1', prompt: 'A calm establishing plate' }],
        })
      ).rejects.toMatchObject({ code: 'invalid_route' });

      expect(await harness.store.getProject(before.id)).toEqual(before);
      expect(onProjectUpdated).not.toHaveBeenCalled();
      expect(submit).not.toHaveBeenCalled();
    }
  );

  it('rejects aggregate conditioning bytes above 30 MiB before persistence or provider submit', async () => {
    const submit = vi.fn();
    const onProjectUpdated = vi.fn();
    const harness = await createReferenceHarness(submit, {
      catalog: async () => conditioningCatalog(6),
      onProjectUpdated,
      decorateMediaStore: (mediaStore) => ({
        ...mediaStore,
        resolveProviderInput: async (projectId, assetId) => ({
          ...(await mediaStore.resolveProviderInput(projectId, assetId)),
          byteSize: 30 * 1024 * 1024 + 1,
        }),
      }),
    });
    await importBriefReference(harness, 'cast', 1);
    const before = (await harness.store.getProject(harness.project.id))!;
    onProjectUpdated.mockClear();

    await expect(
      harness.manager.submitScenes({
        projectId: before.id,
        expectedRevision: before.revision,
        sceneIds: ['scene_1'],
        routes: [imageRoute],
        catalogVersion: 'catalog_1',
        outputRole: 'reference',
        referencePrompts: [{ sceneId: 'scene_1', prompt: 'A calm establishing plate' }],
      })
    ).rejects.toMatchObject({ code: 'invalid_route' });

    expect(await harness.store.getProject(before.id)).toEqual(before);
    expect(onProjectUpdated).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
  });

  it('rejects malformed active-Brief metadata before route lookup, persistence, notification or adapter activity', async () => {
    const submit = vi.fn();
    const validateRequest = vi.fn((request) => ({
      ok: true as const,
      normalized: {
        aspectRatio: request.aspectRatio,
        resolution: request.resolution,
        durationSeconds: request.durationSeconds,
      },
    }));
    const listGenerationRoutes = vi.fn(async () => catalog([imageRoute, videoRoute]));
    const onProjectUpdated = vi.fn();
    const harness = await createHarness(
      {
        ...imageAdapterWithSubmit(submit),
        validateRequest,
      },
      {
        scenes: [videoScene()],
        routes: [imageRoute, videoRoute],
        provider: referenceProvider,
        catalog: listGenerationRoutes,
        onProjectUpdated,
      }
    );
    const sourcePath = path.join(harness.rootDir, 'malformed-cast.png');
    await writeFile(sourcePath, png);
    await harness.mediaStore.importReferenceFromPath({
      projectId: harness.project.id,
      briefReferenceRole: 'cast',
      sourcePath,
      expectedRevision: harness.project.revision,
    });
    const stored = (await harness.store.getProject(harness.project.id))!;
    const malformed = structuredClone(stored);
    const imported = Object.values(malformed.assets).find((asset) => asset.briefReferenceRole === 'cast')!;
    delete imported.briefReferenceLabel;
    const getProject = vi.spyOn(harness.store, 'getProject').mockResolvedValueOnce(malformed);
    onProjectUpdated.mockClear();

    await expect(
      harness.manager.submitScenes({
        projectId: malformed.id,
        expectedRevision: malformed.revision,
        sceneIds: ['scene_1'],
        routes: [imageRoute],
        catalogVersion: 'catalog_1',
        outputRole: 'reference',
        referencePrompts: [{ sceneId: 'scene_1', prompt: 'A calm establishing plate' }],
      })
    ).rejects.toMatchObject({ code: 'invalid_request' });

    getProject.mockRestore();
    expect(await harness.store.getProject(stored.id)).toEqual(stored);
    expect(listGenerationRoutes).not.toHaveBeenCalled();
    expect(onProjectUpdated).not.toHaveBeenCalled();
    expect(validateRequest).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: 'missing',
      mutate: (project: StudioProject, importedId: string) => {
        const imported = project.assets[importedId]!;
        delete project.assets[importedId];
        project.assets.missing_reference = { ...imported, id: 'missing_reference' };
      },
    },
    {
      label: 'foreign',
      mutate: (project: StudioProject, importedId: string) => {
        project.assets[importedId]!.projectId = 'foreign_project';
      },
    },
    {
      label: 'scene-owned',
      mutate: (project: StudioProject, importedId: string) => {
        project.assets[importedId]!.sceneId = 'scene_1';
      },
    },
    {
      label: 'non-image',
      mutate: (project: StudioProject, importedId: string) => {
        project.assets[importedId]!.mediaKind = 'video';
        project.assets[importedId]!.mimeType = 'video/mp4';
      },
    },
  ])('rejects a $label canonical conditioning input with zero observable mutation', async ({ mutate }) => {
    const submit = vi.fn();
    const onProjectUpdated = vi.fn();
    const harness = await createReferenceHarness(submit, {
      catalog: async () => conditioningCatalog(6),
      onProjectUpdated,
    });
    const imported = await importBriefReference(harness, 'cast', 1);
    const stored = (await harness.store.getProject(harness.project.id))!;
    const forged = structuredClone(stored);
    mutate(forged, imported.id);
    vi.spyOn(harness.store, 'getProject').mockResolvedValueOnce(forged);
    onProjectUpdated.mockClear();

    await expect(
      harness.manager.submitScenes({
        projectId: forged.id,
        expectedRevision: forged.revision,
        sceneIds: ['scene_1'],
        routes: [imageRoute],
        catalogVersion: 'catalog_1',
        outputRole: 'reference',
        referencePrompts: [{ sceneId: 'scene_1', prompt: 'A calm establishing plate' }],
      })
    ).rejects.toMatchObject({ code: 'invalid_request' });

    expect(await harness.store.getProject(stored.id)).toEqual(stored);
    expect(onProjectUpdated).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
  });

  it('a reference job on a video scene resolves an image route', async () => {
    const submit = vi.fn(async () => ({ kind: 'complete', outputs: [] }));
    const harness = await createReferenceHarness(submit);

    const [job] = await harness.manager.submitScenes({
      projectId: harness.project.id,
      expectedRevision: harness.project.revision,
      sceneIds: ['scene_1'],
      routes: [imageRoute],
      catalogVersion: 'catalog_1',
      outputRole: 'reference',
      referencePrompts: [{ sceneId: 'scene_1', prompt: '  A calm establishing plate  ' }],
    });

    expect(job).toMatchObject({ id: 'job_1', outputRole: 'reference', provider: selectionFor(imageRoute) });
    await waitFor(() => expect(submit).toHaveBeenCalledOnce());
    expect(submit.mock.calls[0]?.[0]).toMatchObject({
      mediaKind: 'image',
      prompt: buildFirstFramePrompt('A calm establishing plate', '16:9'),
      durationSeconds: 8,
      conditioningImages: [],
      conditioningImageLimit: 0,
    });
    await waitFor(async () =>
      expect((await harness.store.getProject(harness.project.id))?.jobs.job_1).toMatchObject({
        status: 'failed',
        error: { code: 'no_output' },
      })
    );
  });

  it('paints each scene in a reference batch with that scene own prompt', async () => {
    // A reference plate is one scene's first frame. A batch that carried a single prompt could
    // only ever describe one of its scenes, so the prompt each provider call receives has to be
    // the one submitted for that scene - not the first, and not a shared one.
    const submit = vi.fn(async () => ({ kind: 'complete', outputs: [] }));
    const scenes = [
      scene({ id: 'scene_1', mediaKind: 'video', durationSeconds: 8, visualPrompt: 'video_prompt' }),
      scene({ id: 'scene_2', mediaKind: 'video', durationSeconds: 8, visualPrompt: 'video_prompt' }),
    ];
    const harness = await createReferenceHarness(submit, {
      scenes,
      routes: [imageRoute, videoRoute],
      jobIds: ['job_1', 'job_2'],
      idempotencyKeys: ['key_1', 'key_2'],
    });

    await harness.manager.submitScenes({
      projectId: harness.project.id,
      expectedRevision: harness.project.revision,
      sceneIds: ['scene_1', 'scene_2'],
      routes: [imageRoute, { ...imageRoute, sceneId: 'scene_2' }],
      catalogVersion: 'catalog_1',
      outputRole: 'reference',
      referencePrompts: [
        { sceneId: 'scene_1', prompt: 'A calm establishing plate' },
        { sceneId: 'scene_2', prompt: 'A rain-slicked alley at dusk' },
      ],
    });

    await waitFor(() => expect(submit).toHaveBeenCalledTimes(2));
    expect(submit.mock.calls.map((call) => (call[0] as { prompt: string }).prompt)).toEqual([
      buildFirstFramePrompt('A calm establishing plate', '16:9'),
      buildFirstFramePrompt('A rain-slicked alley at dusk', '16:9'),
    ]);
  });

  it('a take job still requires the route kind to match the scene', async () => {
    const submit = vi.fn();
    const harness = await createReferenceHarness(submit);

    await expect(
      harness.manager.submitScenes({
        projectId: harness.project.id,
        expectedRevision: harness.project.revision,
        sceneIds: ['scene_1'],
        routes: [imageRoute],
        catalogVersion: 'catalog_1',
      })
    ).rejects.toMatchObject({ code: 'invalid_route' });

    expect(submit).not.toHaveBeenCalled();
    expect((await harness.store.getProject(harness.project.id))?.jobs).toEqual({});
  });

  it('a reference job ignores scene.referenceAssetId', async () => {
    const submit = vi.fn(async () => ({ kind: 'complete', outputs: [] }));
    const harness = await createReferenceHarness(submit, {
      catalog: async () => {
        const built = catalog([imageRoute, videoRoute]);
        built.routes.find((candidate) => candidate.kind === 'image')!.constraints.supportsFirstFrame = false;
        return built;
      },
    });
    const sourcePath = path.join(harness.rootDir, 'reference.png');
    await writeFile(sourcePath, png);
    await harness.mediaStore.importReferenceFromPath({
      projectId: harness.project.id,
      sceneId: 'scene_1',
      sourcePath,
      expectedRevision: harness.project.revision,
    });
    const withReference = (await harness.store.getProject(harness.project.id))!;
    expect(withReference.scenes.scene_1.referenceAssetId).not.toBeNull();
    const resolveProviderInput = vi.spyOn(harness.mediaStore, 'resolveProviderInput');

    await expect(
      harness.manager.submitScenes({
        projectId: withReference.id,
        expectedRevision: withReference.revision,
        sceneIds: ['scene_1'],
        routes: [imageRoute],
        catalogVersion: 'catalog_1',
        outputRole: 'reference',
        referencePrompts: [{ sceneId: 'scene_1', prompt: 'A calm establishing plate' }],
      })
    ).resolves.toMatchObject([{ id: 'job_1', outputRole: 'reference' }]);

    await waitFor(() => expect(submit).toHaveBeenCalledOnce());
    expect(submit.mock.calls[0]?.[0]).not.toHaveProperty('firstFrame');
    expect(resolveProviderInput).not.toHaveBeenCalled();
    await waitFor(async () =>
      expect((await harness.store.getProject(harness.project.id))?.jobs.job_1).toMatchObject({
        status: 'failed',
        error: { code: 'no_output' },
      })
    );
  });

  it.each([
    { label: 'absent', referencePrompts: undefined },
    { label: 'blank', referencePrompts: [{ sceneId: 'scene_1', prompt: '   ' }] },
    { label: 'other-scene', referencePrompts: [{ sceneId: 'scene_2', prompt: 'A calm establishing plate' }] },
  ])('a reference job with a $label referencePrompt is rejected', async ({ referencePrompts }) => {
    const submit = vi.fn();
    const listGenerationRoutes = vi.fn(async () => catalog([imageRoute, videoRoute]));
    const harness = await createReferenceHarness(submit, { catalog: listGenerationRoutes });

    await expect(
      harness.manager.submitScenes({
        projectId: harness.project.id,
        expectedRevision: harness.project.revision,
        sceneIds: ['scene_1'],
        routes: [imageRoute],
        catalogVersion: 'stale_catalog',
        outputRole: 'reference',
        ...(referencePrompts === undefined ? {} : { referencePrompts }),
      })
    ).rejects.toMatchObject({ code: 'invalid_request' });

    expect(submit).not.toHaveBeenCalled();
    expect(listGenerationRoutes).not.toHaveBeenCalled();
    expect((await harness.store.getProject(harness.project.id))?.jobs).toEqual({});
  });

  it('applies the reference prompt limit after trimming', async () => {
    const submit = vi.fn(async () => ({ kind: 'complete', outputs: [] }));
    const harness = await createReferenceHarness(submit);
    const referencePrompt = `${'a'.repeat(4090)}${' '.repeat(10)}`;

    await expect(
      harness.manager.submitScenes({
        projectId: harness.project.id,
        expectedRevision: harness.project.revision,
        sceneIds: ['scene_1'],
        routes: [imageRoute],
        catalogVersion: 'catalog_1',
        outputRole: 'reference',
        referencePrompts: [{ sceneId: 'scene_1', prompt: referencePrompt }],
      })
    ).resolves.toMatchObject([{ id: 'job_1', outputRole: 'reference' }]);

    await waitFor(() => expect(submit).toHaveBeenCalledOnce());
    expect(submit.mock.calls[0]?.[0].prompt).toBe(buildFirstFramePrompt('a'.repeat(4090), '16:9'));
    await waitFor(async () =>
      expect((await harness.store.getProject(harness.project.id))?.jobs.job_1).toMatchObject({
        status: 'failed',
        error: { code: 'no_output' },
      })
    );
  });

  it('reference lineage does not cross-fire take lineage', async () => {
    const takeSeeded = await createReferenceHarness(vi.fn());
    const afterTake = await seedUnknownSubmission(takeSeeded, 'take');

    await expect(
      takeSeeded.manager.submitScenes({
        projectId: afterTake.id,
        expectedRevision: afterTake.revision,
        sceneIds: ['scene_1'],
        routes: [videoRoute],
        catalogVersion: 'catalog_1',
      })
    ).rejects.toMatchObject({ code: 'duplicate_charge_acknowledgement_required' });

    await expect(
      takeSeeded.manager.submitScenes({
        projectId: afterTake.id,
        expectedRevision: afterTake.revision,
        sceneIds: ['scene_1'],
        routes: [imageRoute],
        catalogVersion: 'catalog_1',
        outputRole: 'reference',
        referencePrompts: [{ sceneId: 'scene_1', prompt: 'A calm establishing plate' }],
      })
    ).rejects.toMatchObject({ code: 'busy' });

    const referenceSeeded = await createReferenceHarness(vi.fn());
    const afterReference = await seedUnknownSubmission(referenceSeeded, 'reference');

    await expect(
      referenceSeeded.manager.submitScenes({
        projectId: afterReference.id,
        expectedRevision: afterReference.revision,
        sceneIds: ['scene_1'],
        routes: [imageRoute],
        catalogVersion: 'catalog_1',
        outputRole: 'reference',
        referencePrompts: [{ sceneId: 'scene_1', prompt: 'A calm establishing plate' }],
      })
    ).rejects.toMatchObject({ code: 'duplicate_charge_acknowledgement_required' });

    await expect(
      referenceSeeded.manager.submitScenes({
        projectId: afterReference.id,
        expectedRevision: afterReference.revision,
        sceneIds: ['scene_1'],
        routes: [videoRoute],
        catalogVersion: 'catalog_1',
      })
    ).rejects.toMatchObject({ code: 'busy' });
  });

  it('refuses to retry a reference job rather than silently retrying it as a take', async () => {
    const submit = vi.fn();
    const harness = await createReferenceHarness(submit);
    const seeded = await harness.store.updateProject(harness.project.id, (project) => {
      const next = structuredClone(project);
      next.jobs.job_reference = {
        id: 'job_reference',
        projectId: project.id,
        sceneId: 'scene_1',
        status: 'failed',
        provider: selectionFor(imageRoute),
        idempotencyKey: 'key_reference',
        providerJobId: null,
        remoteStartedAt: null,
        cancellationPolicy: 'none',
        outputRole: 'reference',
        outputAssetIds: [],
        error: { code: 'unknown', messageKey: 'conversation.creativeStudio.jobs.errors.unknown' },
        retryOfJobId: null,
        retryReason: null,
        duplicateChargeAcknowledged: false,
        duplicateChargeAcknowledgedAt: null,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
      };
      next.scenes.scene_1.jobIds = ['job_reference'];
      next.scenes.scene_1.reviewState = 'blocked';
      return next;
    });

    await expect(
      harness.manager.retryJob({
        projectId: seeded.id,
        jobId: 'job_reference',
        expectedRevision: seeded.revision,
      })
    ).rejects.toMatchObject({ code: 'invalid_request' });

    expect(submit).not.toHaveBeenCalled();
    expect(Object.keys((await harness.store.getProject(harness.project.id))!.jobs)).toEqual(['job_reference']);
  });

  it('uses the durable reviewed snapshot when a reference job completes after restart and project drift', async () => {
    const firstPoll = deferred<ProviderJobSnapshot>();
    const submit = vi.fn(async () => ({ kind: 'remote' as const, providerJobId: 'remote_reference' }));
    const firstAdapter: GenerationProviderAdapter = {
      ...imageAdapterWithSubmit(submit),
      poll: vi.fn(async (_providerJobId, _provider, signal) => {
        rejectDeferredOnAbort(firstPoll, signal);
        return firstPoll.promise;
      }),
    };
    const harness = await createHarness(firstAdapter, {
      scenes: [videoScene()],
      routes: [imageRoute, videoRoute],
      provider: referenceProvider,
      catalog: async () => conditioningCatalog(6),
      sleep: async () => undefined,
    });
    const originalCast = await importBriefReference(harness, 'cast', 1);
    const admitted = (await harness.store.getProject(harness.project.id))!;

    await harness.manager.submitScenes({
      projectId: admitted.id,
      expectedRevision: admitted.revision,
      sceneIds: ['scene_1'],
      routes: [imageRoute],
      catalogVersion: 'catalog_1',
      outputRole: 'reference',
      referencePrompts: [{ sceneId: 'scene_1', prompt: '  Reviewed one-off plate  ' }],
    });
    await waitFor(() => expect(firstAdapter.poll).toHaveBeenCalled());
    const beforeRestart = (await harness.store.getProject(admitted.id))!;
    expect(beforeRestart.jobs.job_1.referenceInputSnapshot).toEqual({
      sourceVisualPrompt: 'Reviewed one-off plate',
      conditioningReferenceAssetIds: [originalCast.id],
      aspectRatio: '16:9',
      resolution: '720p',
    });

    await harness.manager.dispose();
    const newLook = await importBriefReference(harness, 'look', 2);
    await harness.store.updateProject(admitted.id, (project) => {
      const next = structuredClone(project);
      delete next.assets[originalCast.id].briefReferenceRole;
      delete next.assets[originalCast.id].briefReferenceLabel;
      next.scenes.scene_1.visualPrompt = 'Changed scene prompt';
      next.aspectRatio = '1:1';
      next.resolution = '1080p';
      return next;
    });
    const outputPath = path.join(harness.rootDir, 'recovered-reference.png');
    await writeFile(outputPath, png);
    const recoveredAdapter: GenerationProviderAdapter = {
      ...imageAdapterWithSubmit(vi.fn()),
      poll: vi.fn(async () => ({
        status: 'succeeded' as const,
        outputs: [
          {
            mediaKind: 'image' as const,
            role: 'primary' as const,
            source: { kind: 'file' as const, path: outputPath },
            mimeType: 'image/png' as const,
          },
        ],
      })),
    };
    const videoSubmit = vi.fn(async () => ({ kind: 'complete' as const, outputs: [] }));
    const recoveredVideoAdapter = controllableAdapter('weprompt-media-gateway-v1', { submit: videoSubmit });
    harness.manager = createStudioJobManager({
      store: harness.store,
      mediaStore: harness.mediaStore,
      providerResolver: {
        listConnectionCandidates: async () => [],
        listGenerationRoutes: async () => conditioningCatalog(6),
        isGenerationRouteAvailable: async () => true,
      },
      adapters: new Map([
        [recoveredAdapter.id, recoveredAdapter],
        [recoveredVideoAdapter.id, recoveredVideoAdapter],
      ]),
      listProviders: async () => [referenceProvider],
      sleep: async () => undefined,
    });

    await harness.manager.resumePendingJobs();
    await waitFor(async () =>
      expect((await harness.store.getProject(admitted.id))?.jobs.job_1.status).toBe('succeeded')
    );
    const completed = (await harness.store.getProject(admitted.id))!;
    const plate = completed.assets[completed.jobs.job_1.outputAssetIds[0]!]!;
    expect(plate).toMatchObject({
      sourceVisualPrompt: 'Reviewed one-off plate',
      sourceReferenceAssetIds: [originalCast.id],
      sourceAspectRatio: '16:9',
      sourceResolution: '720p',
    });
    expect(plate.sourceReferenceAssetIds).not.toContain(newLook.id);

    const readyForClip = await harness.store.updateProject(completed.id, (project) => ({
      ...project,
      aspectRatio: '16:9',
      resolution: '720p',
    }));
    await harness.manager.submitScenes({
      projectId: readyForClip.id,
      expectedRevision: readyForClip.revision,
      sceneIds: ['scene_1'],
      routes: [videoRoute],
      catalogVersion: 'catalog_1',
    });
    await waitFor(() => expect(videoSubmit).toHaveBeenCalledOnce());
    expect(videoSubmit.mock.calls[0]?.[0]).toMatchObject({ firstFrame: { assetId: plate.id } });
    expect(videoSubmit.mock.calls[0]?.[0]).not.toHaveProperty('conditioningImages');
    expect(videoSubmit.mock.calls[0]?.[0]).not.toHaveProperty('conditioningImageLimit');
  });

  it('retries a failed reference download against the durable snapshot without leaving a partial plate', async () => {
    const validOutputPath = path.join(os.tmpdir(), `studio-reference-retry-${Date.now()}.png`);
    await writeFile(validOutputPath, png);
    let pollAttempt = 0;
    const submit = vi.fn(async () => ({ kind: 'remote' as const, providerJobId: 'remote_download' }));
    const adapter: GenerationProviderAdapter = {
      ...imageAdapterWithSubmit(submit),
      poll: vi.fn(async () => {
        pollAttempt += 1;
        return {
          status: 'succeeded' as const,
          outputs: [
            {
              mediaKind: 'image' as const,
              role: 'primary' as const,
              source: {
                kind: 'file' as const,
                path: pollAttempt === 1 ? '/definitely/missing/reference-retry.png' : validOutputPath,
              },
              mimeType: 'image/png' as const,
            },
          ],
        };
      }),
    };
    const harness = await createHarness(adapter, {
      scenes: [videoScene()],
      routes: [imageRoute, videoRoute],
      provider: referenceProvider,
      catalog: async () => conditioningCatalog(6),
      sleep: async () => undefined,
    });
    const originalCast = await importBriefReference(harness, 'cast', 1);
    const admitted = (await harness.store.getProject(harness.project.id))!;

    await harness.manager.submitScenes({
      projectId: admitted.id,
      expectedRevision: admitted.revision,
      sceneIds: ['scene_1'],
      routes: [imageRoute],
      catalogVersion: 'catalog_1',
      outputRole: 'reference',
      referencePrompts: [{ sceneId: 'scene_1', prompt: 'Reviewed retry plate' }],
    });
    await waitFor(async () =>
      expect((await harness.store.getProject(admitted.id))?.jobs.job_1).toMatchObject({
        status: 'failed',
        error: { code: 'download_failed' },
      })
    );
    const afterFailure = (await harness.store.getProject(admitted.id))!;
    expect(afterFailure.jobs.job_1.outputAssetIds).toEqual([]);
    expect(
      Object.values(afterFailure.assets).filter((asset) => asset.managedAsset.collection === 'references')
    ).toEqual([]);
    const drifted = await harness.store.updateProject(admitted.id, (project) => {
      const next = structuredClone(project);
      next.scenes.scene_1.visualPrompt = 'Changed after failed download';
      next.aspectRatio = '1:1';
      next.resolution = '1080p';
      return next;
    });

    await harness.manager.retryDownload({
      projectId: drifted.id,
      jobId: 'job_1',
      expectedRevision: drifted.revision,
    });

    const completed = (await harness.store.getProject(admitted.id))!;
    const plate = completed.assets[completed.jobs.job_1.outputAssetIds[0]!]!;
    expect(plate).toMatchObject({
      sourceVisualPrompt: 'Reviewed retry plate',
      sourceReferenceAssetIds: [originalCast.id],
      sourceAspectRatio: '16:9',
      sourceResolution: '720p',
    });
    await rm(validOutputPath, { force: true });
  });
});

describe('StudioJobManager scheduling', () => {
  it('uses image semaphore capacity for reference jobs on video scenes', async () => {
    const scenes = Array.from({ length: 3 }, (_, index) =>
      scene({
        id: `scene_${index + 1}`,
        title: `Scene ${index + 1}`,
        visualPrompt: `video_prompt_${index + 1}`,
        mediaKind: 'video',
      })
    );
    const routes = scenes.map(
      (candidate): StudioResolvedSceneRouteSnapshot => ({
        sceneId: candidate.id,
        providerId: provider.id,
        adapterId: 'weprompt-image-v1',
        model: 'image-model',
        kind: 'image',
      })
    );
    const gates: Array<Deferred<ProviderSubmitResult>> = [];
    let active = 0;
    let maximumActive = 0;
    const adapter = controllableAdapter('weprompt-image-v1', {
      submit: async () => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        const gate = deferred<ProviderSubmitResult>();
        gates.push(gate);
        try {
          return await gate.promise;
        } finally {
          active -= 1;
        }
      },
    });
    const harness = await createHarness(adapter, {
      scenes,
      routes,
      jobIds: ['job_1', 'job_2', 'job_3'],
      idempotencyKeys: ['key_1', 'key_2', 'key_3'],
    });

    await harness.manager.submitScenes({
      projectId: harness.project.id,
      expectedRevision: harness.project.revision,
      sceneIds: scenes.map((candidate) => candidate.id),
      routes,
      catalogVersion: 'catalog_1',
      outputRole: 'reference',
      referencePrompts: scenes.map((candidate) => ({
        sceneId: candidate.id,
        prompt: `A reference plate for ${candidate.id}`,
      })),
    });

    await waitFor(() => expect(gates).toHaveLength(2));
    gates[0]!.reject(Object.assign(new Error('provider failed'), { code: 'no_output' }));
    await waitFor(() => expect(gates).toHaveLength(3));
    expect(maximumActive).toBe(2);
    for (const gate of gates) gate.reject(Object.assign(new Error('provider failed'), { code: 'no_output' }));
    await waitFor(async () => {
      const current = await harness.store.getProject(harness.project.id);
      expect(Object.values(current?.jobs ?? {}).every((job) => job.status === 'failed')).toBe(true);
    });
  });

  it.each([
    { kind: 'image' as const, adapterId: 'weprompt-image-v1' as const, capacity: 2, count: 3 },
    { kind: 'video' as const, adapterId: 'weprompt-media-gateway-v1' as const, capacity: 1, count: 2 },
  ])('runs $kind work FIFO with global capacity $capacity', async ({ kind, adapterId, capacity, count }) => {
    const selectedProvider: IProvider = {
      ...provider,
      models: [`${kind}-model`],
    };
    const scenes = Array.from({ length: count }, (_, index) =>
      scene({
        id: `scene_${index + 1}`,
        title: `Scene ${index + 1}`,
        visualPrompt: `prompt_${index + 1}`,
        mediaKind: kind,
        durationSeconds: kind === 'video' ? 4 : 2,
      })
    );
    const routes = scenes.map(
      (candidate): StudioResolvedSceneRouteSnapshot => ({
        sceneId: candidate.id,
        providerId: selectedProvider.id,
        adapterId,
        model: `${kind}-model`,
        kind,
      })
    );
    const gates: Array<Deferred<ProviderSubmitResult>> = [];
    const started: string[] = [];
    let active = 0;
    let maximumActive = 0;
    const adapter: GenerationProviderAdapter = {
      id: adapterId,
      validateConnection: async () => ({ ok: true }),
      validateRequest: (request) => ({
        ok: true,
        normalized: {
          aspectRatio: request.aspectRatio,
          resolution: request.resolution,
          durationSeconds: request.durationSeconds,
        },
      }),
      submit: async (request) => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        started.push(request.prompt);
        const gate = deferred<ProviderSubmitResult>();
        gates.push(gate);
        try {
          return await gate.promise;
        } finally {
          active -= 1;
        }
      },
    };
    const harness = await createHarness(adapter, {
      scenes,
      routes,
      provider: selectedProvider,
      jobIds: scenes.map((_, index) => `job_${index + 1}`),
      idempotencyKeys: scenes.map((_, index) => `key_${index + 1}`),
    });

    await harness.manager.submitScenes({
      projectId: harness.project.id,
      expectedRevision: harness.project.revision,
      sceneIds: scenes.map((candidate) => candidate.id),
      routes,
      catalogVersion: 'catalog_1',
    });

    await waitFor(() => expect(started).toHaveLength(capacity));
    expect(started).toEqual(scenes.slice(0, capacity).map((candidate) => candidate.visualPrompt));
    gates[0]!.reject(Object.assign(new Error('provider failed'), { code: 'no_output' }));
    await waitFor(() => expect(started).toHaveLength(Math.min(count, capacity + 1)));
    expect(started).toEqual(scenes.slice(0, Math.min(count, capacity + 1)).map((candidate) => candidate.visualPrompt));
    expect(maximumActive).toBe(capacity);
    for (const gate of gates) gate.reject(Object.assign(new Error('provider failed'), { code: 'no_output' }));
    await waitFor(async () => {
      const current = await harness.store.getProject(harness.project.id);
      expect(Object.values(current?.jobs ?? {}).every((job) => job.status === 'failed')).toBe(true);
    });
  });

  it('times out never-settling submissions and releases project and global slots', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-06T00:00:00.000Z'));
    try {
      const { selectedProvider, scenes, routes } = mixedSchedulingFixture();
      const started: string[] = [];
      const submit: GenerationProviderAdapter['submit'] = async (request) => {
        started.push(request.prompt);
        return new Promise<ProviderSubmitResult>(() => undefined);
      };
      const imageAdapter = controllableAdapter('weprompt-image-v1', { submit });
      const videoAdapter = controllableAdapter('weprompt-media-gateway-v1', { submit });
      const harness = await createHarness(imageAdapter, {
        scenes,
        routes,
        provider: selectedProvider,
        additionalAdapters: [videoAdapter],
        jobIds: ['job_1', 'job_2', 'job_3', 'job_4'],
        idempotencyKeys: ['key_1', 'key_2', 'key_3', 'key_4'],
        now: () => new Date(Date.now()).toISOString(),
        nowEpochMs: () => Date.now(),
      });
      const projectBScene = scene({
        id: 'scene_project_b',
        title: 'Project B video',
        visualPrompt: 'project_b_video_prompt',
        mediaKind: 'video',
      });
      const projectBRoute: StudioResolvedSceneRouteSnapshot = {
        ...routes[0]!,
        sceneId: projectBScene.id,
      };
      const projectB = await createProjectFixture(harness.store, 'Project B', [projectBScene], [projectBRoute]);

      await harness.manager.submitScenes({
        projectId: harness.project.id,
        expectedRevision: harness.project.revision,
        sceneIds: scenes.map((candidate) => candidate.id),
        routes,
        catalogVersion: 'catalog_1',
      });
      await vi.waitFor(async () => {
        const projectA = await harness.store.getProject(harness.project.id);
        expect(started).toEqual(['video_prompt', 'image_prompt_first']);
        expect(projectA?.jobs.job_3.status).toBe('queued_local');
      });

      await harness.manager.submitScenes({
        projectId: projectB.id,
        expectedRevision: projectB.revision,
        sceneIds: [projectBScene.id],
        routes: [projectBRoute],
        catalogVersion: 'catalog_1',
      });
      await vi.waitFor(async () => {
        const currentProjectB = await harness.store.getProject(projectB.id);
        expect(started).toEqual(['video_prompt', 'image_prompt_first']);
        expect(currentProjectB?.jobs.job_4.status).toBe('queued_local');
      });

      await vi.advanceTimersByTimeAsync(SUBMISSION_DEADLINE_MS);

      await vi.waitFor(async () => {
        const [projectA, currentProjectB] = await Promise.all([
          harness.store.getProject(harness.project.id),
          harness.store.getProject(projectB.id),
        ]);
        expect(projectA?.jobs).toMatchObject({
          job_1: { status: 'needs_attention', error: { code: 'submission_unknown' } },
          job_2: { status: 'needs_attention', error: { code: 'submission_unknown' } },
          job_3: { status: 'submitting' },
        });
        expect(currentProjectB?.jobs.job_4.status).toBe('submitting');
        expect(started.slice(0, 2)).toEqual(['video_prompt', 'image_prompt_first']);
        expect(started.slice(2).toSorted()).toEqual(['image_prompt_waiting', 'project_b_video_prompt']);
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('admits another project while two mixed-media jobs occupy the first project cap', async () => {
    const { selectedProvider, scenes, routes } = mixedSchedulingFixture();
    const started: string[] = [];
    const gates: Array<{ prompt: string; gate: Deferred<ProviderSubmitResult> }> = [];
    const submit: GenerationProviderAdapter['submit'] = async (request, _provider, signal) => {
      started.push(request.prompt);
      const gate = deferred<ProviderSubmitResult>();
      rejectDeferredOnAbort(gate, signal);
      gates.push({ prompt: request.prompt, gate });
      return gate.promise;
    };
    const imageAdapter = controllableAdapter('weprompt-image-v1', { submit });
    const videoAdapter = controllableAdapter('weprompt-media-gateway-v1', { submit });
    const harness = await createHarness(imageAdapter, {
      scenes,
      routes,
      provider: selectedProvider,
      additionalAdapters: [videoAdapter],
      jobIds: ['job_1', 'job_2', 'job_3', 'job_4'],
      idempotencyKeys: ['key_1', 'key_2', 'key_3', 'key_4'],
    });
    const projectBScene = scene({
      id: 'scene_project_b',
      title: 'Project B image',
      visualPrompt: 'project_b_image_prompt',
    });
    const projectBRoute: StudioResolvedSceneRouteSnapshot = {
      ...routes[1]!,
      sceneId: projectBScene.id,
    };
    const projectB = await createProjectFixture(harness.store, 'Project B', [projectBScene], [projectBRoute]);

    await harness.manager.submitScenes({
      projectId: harness.project.id,
      expectedRevision: harness.project.revision,
      sceneIds: scenes.map((candidate) => candidate.id),
      routes,
      catalogVersion: 'catalog_1',
    });
    await waitForProjectWrites(harness.store, harness.project.id);
    await waitFor(async () => {
      const projectA = await harness.store.getProject(harness.project.id);
      expect(started).toEqual(['video_prompt', 'image_prompt_first']);
      expect(projectA?.jobs).toMatchObject({
        job_1: { status: 'submitting' },
        job_2: { status: 'submitting' },
        job_3: { status: 'queued_local' },
      });
    });

    await harness.manager.submitScenes({
      projectId: projectB.id,
      expectedRevision: projectB.revision,
      sceneIds: [projectBScene.id],
      routes: [projectBRoute],
      catalogVersion: 'catalog_1',
    });

    await waitFor(async () => {
      const [projectA, currentProjectB] = await Promise.all([
        harness.store.getProject(harness.project.id),
        harness.store.getProject(projectB.id),
      ]);
      expect(started).toEqual(['video_prompt', 'image_prompt_first', 'project_b_image_prompt']);
      expect(projectA?.jobs.job_3.status).toBe('queued_local');
      expect(currentProjectB?.jobs.job_4.status).toBe('submitting');
    });

    for (const { gate } of gates) {
      gate.reject(Object.assign(new Error('provider failed'), { code: 'no_output' }));
    }
    await waitFor(() => expect(gates).toHaveLength(4));
    gates[3]!.gate.reject(Object.assign(new Error('provider failed'), { code: 'no_output' }));
    await waitFor(async () => {
      const [projectA, currentProjectB] = await Promise.all([
        harness.store.getProject(harness.project.id),
        harness.store.getProject(projectB.id),
      ]);
      expect(Object.values(projectA?.jobs ?? {}).every((job) => job.status === 'failed')).toBe(true);
      expect(Object.values(currentProjectB?.jobs ?? {}).every((job) => job.status === 'failed')).toBe(true);
    });
  });

  it('admits the waiting project job after a successful mixed-media job reaches terminal state', async () => {
    const { selectedProvider, scenes, routes } = mixedSchedulingFixture();
    const videoGate = deferred<ProviderSubmitResult>();
    const imageGates: Array<Deferred<ProviderSubmitResult>> = [];
    const videoAdapter = controllableAdapter('weprompt-media-gateway-v1', {
      submit: async (_request, _provider, signal) => {
        rejectDeferredOnAbort(videoGate, signal);
        return videoGate.promise;
      },
    });
    const imageAdapter = controllableAdapter('weprompt-image-v1', {
      submit: async (_request, _provider, signal) => {
        const gate = deferred<ProviderSubmitResult>();
        rejectDeferredOnAbort(gate, signal);
        imageGates.push(gate);
        return gate.promise;
      },
    });
    const harness = await createHarness(imageAdapter, {
      scenes,
      routes,
      provider: selectedProvider,
      additionalAdapters: [videoAdapter],
      jobIds: ['job_1', 'job_2', 'job_3'],
      idempotencyKeys: ['key_1', 'key_2', 'key_3'],
    });
    const outputPath = path.join(harness.rootDir, 'successful-release.png');
    await writeFile(outputPath, png);

    await harness.manager.submitScenes({
      projectId: harness.project.id,
      expectedRevision: harness.project.revision,
      sceneIds: scenes.map((candidate) => candidate.id),
      routes,
      catalogVersion: 'catalog_1',
    });
    await waitForProjectWrites(harness.store, harness.project.id);
    await waitFor(async () => {
      const project = await harness.store.getProject(harness.project.id);
      expect(imageGates).toHaveLength(1);
      expect(project?.jobs.job_3.status).toBe('queued_local');
    });

    imageGates[0]!.resolve({
      kind: 'complete',
      outputs: [
        {
          mediaKind: 'image',
          role: 'primary',
          source: { kind: 'file', path: outputPath },
          mimeType: 'image/png',
        },
      ],
    });

    await waitFor(async () => {
      const project = await harness.store.getProject(harness.project.id);
      expect(project?.jobs.job_2.status).toBe('succeeded');
      expect(project?.jobs.job_3.status).toBe('submitting');
      expect(imageGates).toHaveLength(2);
    });
    videoGate.reject(Object.assign(new Error('provider failed'), { code: 'no_output' }));
    imageGates[1]!.reject(Object.assign(new Error('provider failed'), { code: 'no_output' }));
    await waitFor(async () => {
      const project = await harness.store.getProject(harness.project.id);
      expect(project?.jobs).toMatchObject({
        job_1: { status: 'failed' },
        job_2: { status: 'succeeded' },
        job_3: { status: 'failed' },
      });
    });
  });

  it.each([
    { code: 'no_output' as const, expectedStatus: 'failed' as const },
    { code: 'unknown' as const, expectedStatus: 'needs_attention' as const },
  ])('reuses the project slot after provider $expectedStatus', async ({ code, expectedStatus }) => {
    const { selectedProvider, scenes, routes } = mixedSchedulingFixture();
    const videoGate = deferred<ProviderSubmitResult>();
    const imageGates: Array<Deferred<ProviderSubmitResult>> = [];
    const videoAdapter = controllableAdapter('weprompt-media-gateway-v1', {
      submit: async (_request, _provider, signal) => {
        rejectDeferredOnAbort(videoGate, signal);
        return videoGate.promise;
      },
    });
    const imageAdapter = controllableAdapter('weprompt-image-v1', {
      submit: async (_request, _provider, signal) => {
        const gate = deferred<ProviderSubmitResult>();
        rejectDeferredOnAbort(gate, signal);
        imageGates.push(gate);
        return gate.promise;
      },
    });
    const harness = await createHarness(imageAdapter, {
      scenes,
      routes,
      provider: selectedProvider,
      additionalAdapters: [videoAdapter],
      jobIds: ['job_1', 'job_2', 'job_3'],
      idempotencyKeys: ['key_1', 'key_2', 'key_3'],
    });

    await harness.manager.submitScenes({
      projectId: harness.project.id,
      expectedRevision: harness.project.revision,
      sceneIds: scenes.map((candidate) => candidate.id),
      routes,
      catalogVersion: 'catalog_1',
    });
    await waitForProjectWrites(harness.store, harness.project.id);
    await waitFor(async () => {
      const project = await harness.store.getProject(harness.project.id);
      expect(imageGates).toHaveLength(1);
      expect(project?.jobs.job_3.status).toBe('queued_local');
    });

    imageGates[0]!.reject(Object.assign(new Error('provider failed'), { code }));

    await waitFor(async () => {
      const project = await harness.store.getProject(harness.project.id);
      expect(project?.jobs.job_2.status).toBe(expectedStatus);
      expect(project?.jobs.job_3.status).toBe('submitting');
      expect(imageGates).toHaveLength(2);
    });
    videoGate.reject(Object.assign(new Error('provider failed'), { code: 'no_output' }));
    imageGates[1]!.reject(Object.assign(new Error('provider failed'), { code: 'no_output' }));
    await waitFor(async () => {
      const project = await harness.store.getProject(harness.project.id);
      expect(project?.jobs.job_1.status).toBe('failed');
      expect(project?.jobs.job_3.status).toBe('failed');
    });
  });

  it('reuses the project slot after confirmed remote cancellation', async () => {
    const { selectedProvider, scenes, routes } = mixedSchedulingFixture();
    const videoGate = deferred<ProviderSubmitResult>();
    const imageSubmissions: string[] = [];
    const pollGates = new Map<string, Deferred<ProviderJobSnapshot>>();
    const videoAdapter = controllableAdapter('weprompt-media-gateway-v1', {
      submit: async (_request, _provider, signal) => {
        rejectDeferredOnAbort(videoGate, signal);
        return videoGate.promise;
      },
    });
    const imageAdapter = controllableAdapter('weprompt-image-v1', {
      submit: async (request) => {
        imageSubmissions.push(request.prompt);
        return { kind: 'remote', providerJobId: `remote_${request.prompt}` };
      },
      poll: async (providerJobId, _provider, signal) => {
        const gate = deferred<ProviderJobSnapshot>();
        rejectDeferredOnAbort(gate, signal);
        pollGates.set(providerJobId, gate);
        return gate.promise;
      },
      cancel: async () => ({ kind: 'cancelled' }),
    });
    const harness = await createHarness(imageAdapter, {
      scenes,
      routes,
      provider: selectedProvider,
      additionalAdapters: [videoAdapter],
      jobIds: ['job_1', 'job_2', 'job_3'],
      idempotencyKeys: ['key_1', 'key_2', 'key_3'],
      sleep: async () => undefined,
      cancellationPolicy: 'queued_and_running',
    });

    await harness.manager.submitScenes({
      projectId: harness.project.id,
      expectedRevision: harness.project.revision,
      sceneIds: scenes.map((candidate) => candidate.id),
      routes,
      catalogVersion: 'catalog_1',
    });
    await waitForProjectWrites(harness.store, harness.project.id);
    await waitFor(async () => {
      const project = await harness.store.getProject(harness.project.id);
      expect(imageSubmissions).toEqual(['image_prompt_first']);
      expect(project?.jobs.job_2.status).toBe('queued_remote');
      expect(project?.jobs.job_3.status).toBe('queued_local');
    });
    const beforeCancel = (await harness.store.getProject(harness.project.id))!;

    await expect(
      harness.manager.cancelJob({
        projectId: beforeCancel.id,
        jobId: 'job_2',
        expectedRevision: beforeCancel.revision,
      })
    ).resolves.toMatchObject({ status: 'cancelled' });

    await waitFor(async () => {
      const project = await harness.store.getProject(harness.project.id);
      expect(imageSubmissions).toEqual(['image_prompt_first', 'image_prompt_waiting']);
      expect(project?.jobs.job_2.status).toBe('cancelled');
      expect(project?.jobs.job_3.status).toBe('queued_remote');
      expect(pollGates.has('remote_image_prompt_waiting')).toBe(true);
    });
    videoGate.reject(Object.assign(new Error('provider failed'), { code: 'no_output' }));
    pollGates.get('remote_image_prompt_waiting')!.resolve({
      status: 'failed',
      error: { code: 'no_output' },
    });
    await waitFor(async () => {
      const project = await harness.store.getProject(harness.project.id);
      expect(project?.jobs.job_1.status).toBe('failed');
      expect(project?.jobs.job_3.status).toBe('failed');
    });
  });

  it('keeps the global video capacity at one across different projects', async () => {
    const selectedProvider = { ...provider, models: ['video-model'] };
    const projectAScene = scene({
      id: 'scene_project_a',
      visualPrompt: 'project_a_video',
      mediaKind: 'video',
      durationSeconds: 5,
    });
    const projectARoute: StudioResolvedSceneRouteSnapshot = {
      sceneId: projectAScene.id,
      providerId: selectedProvider.id,
      adapterId: 'weprompt-media-gateway-v1',
      model: 'video-model',
      kind: 'video',
    };
    const gates: Array<Deferred<ProviderSubmitResult>> = [];
    const started: string[] = [];
    const adapter = controllableAdapter('weprompt-media-gateway-v1', {
      submit: async (request, _provider, signal) => {
        started.push(request.prompt);
        const gate = deferred<ProviderSubmitResult>();
        rejectDeferredOnAbort(gate, signal);
        gates.push(gate);
        return gate.promise;
      },
    });
    const harness = await createHarness(adapter, {
      scenes: [projectAScene],
      routes: [projectARoute],
      provider: selectedProvider,
      jobIds: ['job_1', 'job_2'],
      idempotencyKeys: ['key_1', 'key_2'],
    });
    const projectBScene = scene({
      id: 'scene_project_b',
      visualPrompt: 'project_b_video',
      mediaKind: 'video',
      durationSeconds: 5,
    });
    const projectBRoute = { ...projectARoute, sceneId: projectBScene.id };
    const projectB = await createProjectFixture(harness.store, 'Project B', [projectBScene], [projectBRoute]);

    await harness.manager.submitScenes({
      projectId: harness.project.id,
      expectedRevision: harness.project.revision,
      sceneIds: [projectAScene.id],
      routes: [projectARoute],
      catalogVersion: 'catalog_1',
    });
    await harness.manager.submitScenes({
      projectId: projectB.id,
      expectedRevision: projectB.revision,
      sceneIds: [projectBScene.id],
      routes: [projectBRoute],
      catalogVersion: 'catalog_1',
    });

    await waitFor(async () => {
      const [projectA, currentProjectB] = await Promise.all([
        harness.store.getProject(harness.project.id),
        harness.store.getProject(projectB.id),
      ]);
      expect(started).toEqual(['project_a_video']);
      expect(projectA?.jobs.job_1.status).toBe('submitting');
      expect(currentProjectB?.jobs.job_2.status).toBe('queued_local');
    });
    gates[0]!.reject(Object.assign(new Error('provider failed'), { code: 'no_output' }));
    await waitFor(async () => {
      const currentProjectB = await harness.store.getProject(projectB.id);
      expect(started).toEqual(['project_a_video', 'project_b_video']);
      expect(currentProjectB?.jobs.job_2.status).toBe('submitting');
    });
    gates[1]!.reject(Object.assign(new Error('provider failed'), { code: 'no_output' }));
    await waitFor(async () => {
      const [projectA, currentProjectB] = await Promise.all([
        harness.store.getProject(harness.project.id),
        harness.store.getProject(projectB.id),
      ]);
      expect(projectA?.jobs.job_1.status).toBe('failed');
      expect(currentProjectB?.jobs.job_2.status).toBe('failed');
    });
  });

  it('reuses a recovered project slot after restart reconciliation reaches terminal state', async () => {
    const { selectedProvider, scenes, routes } = mixedSchedulingFixture();
    const pollCounts = new Map<string, number>();
    const pollGates = new Map(
      ['remote_1', 'remote_2', 'remote_3'].map((providerJobId) => [providerJobId, deferred<ProviderJobSnapshot>()])
    );
    const poll: NonNullable<GenerationProviderAdapter['poll']> = async (providerJobId, _provider, signal) => {
      const count = (pollCounts.get(providerJobId) ?? 0) + 1;
      pollCounts.set(providerJobId, count);
      if (count === 1) return { status: 'running' };
      const gate = pollGates.get(providerJobId)!;
      rejectDeferredOnAbort(gate, signal);
      return gate.promise;
    };
    const unexpectedSubmit: GenerationProviderAdapter['submit'] = async () => {
      throw new Error('recovery must not submit generation again');
    };
    const imageAdapter = controllableAdapter('weprompt-image-v1', { submit: unexpectedSubmit, poll });
    const videoAdapter = controllableAdapter('weprompt-media-gateway-v1', { submit: unexpectedSubmit, poll });
    const harness = await createHarness(imageAdapter, {
      scenes,
      routes,
      provider: selectedProvider,
      additionalAdapters: [videoAdapter],
      sleep: async () => undefined,
    });
    await harness.store.updateProject(harness.project.id, (project) => {
      const next = structuredClone(project);
      next.jobs = {};
      scenes.forEach((candidate, index) => {
        const jobId = `job_${index + 1}`;
        const candidateRoute = routes[index]!;
        next.jobs[jobId] = {
          id: jobId,
          projectId: project.id,
          sceneId: candidate.id,
          status: 'queued_remote',
          provider: selectionFor(candidateRoute),
          idempotencyKey: `key_${index + 1}`,
          providerJobId: `remote_${index + 1}`,
          remoteStartedAt: project.createdAt,
          cancellationPolicy: 'queued_and_running',
          outputAssetIds: [],
          error: null,
          retryOfJobId: null,
          retryReason: null,
          duplicateChargeAcknowledged: false,
          duplicateChargeAcknowledgedAt: null,
          createdAt: project.createdAt,
          updatedAt: project.updatedAt,
        };
        next.scenes[candidate.id].jobIds = [jobId];
        next.scenes[candidate.id].reviewState = 'generating';
      });
      return next;
    });
    const outputPath = path.join(harness.rootDir, 'recovered-release.png');
    await writeFile(outputPath, png);

    await harness.manager.resumePendingJobs();
    await waitFor(() => {
      expect(pollCounts.get('remote_1')).toBe(2);
      expect(pollCounts.get('remote_2')).toBe(2);
    });
    await waitFor(async () => {
      const project = await harness.store.getProject(harness.project.id);
      expect(project?.jobs).toMatchObject({
        job_1: { status: 'running' },
        job_2: { status: 'running' },
        job_3: { status: 'queued_remote' },
      });
      expect(pollCounts.has('remote_3')).toBe(false);
    });

    pollGates.get('remote_2')!.resolve({
      status: 'succeeded',
      outputs: [
        {
          mediaKind: 'image',
          role: 'primary',
          source: { kind: 'file', path: outputPath },
          mimeType: 'image/png',
        },
      ],
    });

    await waitFor(async () => {
      const project = await harness.store.getProject(harness.project.id);
      expect(project?.jobs.job_2.status).toBe('succeeded');
      expect(project?.jobs.job_3.status).toBe('running');
      expect(pollCounts.has('remote_3')).toBe(true);
    });
    pollGates.get('remote_1')!.resolve({ status: 'failed', error: { code: 'no_output' } });
    pollGates.get('remote_3')!.resolve({ status: 'failed', error: { code: 'no_output' } });
    await waitFor(async () => {
      const project = await harness.store.getProject(harness.project.id);
      expect(project?.jobs).toMatchObject({
        job_1: { status: 'failed' },
        job_2: { status: 'succeeded' },
        job_3: { status: 'failed' },
      });
    });
  });

  it('isolates identical local job IDs that belong to different projects', async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'studio-job-project-isolation-'));
    const store = createCreativeStudioStore({ rootDir });
    const createProject = async (name: string): Promise<StudioProject> => {
      const created = await store.createProject({
        name,
        brief: '',
        aspectRatio: '16:9',
        targetDurationSeconds: 5,
        resolution: '720p',
      });
      return store.updateProject(created.id, (project) => ({
        ...project,
        sceneOrder: ['scene_1'],
        scenes: { scene_1: scene() },
        routing: { ...project.routing, image: selectionFor(route) },
      }));
    };
    const [firstProject, secondProject] = await Promise.all([createProject('First'), createProject('Second')]);
    const gates: Array<Deferred<ProviderSubmitResult>> = [];
    const submit = vi.fn(async () => {
      const gate = deferred<ProviderSubmitResult>();
      gates.push(gate);
      return gate.promise;
    });
    const adapter: GenerationProviderAdapter = {
      id: 'weprompt-image-v1',
      validateConnection: async () => ({ ok: true }),
      validateRequest: (request) => ({
        ok: true,
        normalized: {
          aspectRatio: request.aspectRatio,
          resolution: request.resolution,
          durationSeconds: request.durationSeconds,
        },
      }),
      submit,
    };
    const mediaStore = createStudioMediaStore({ store });
    const manager = createStudioJobManager({
      store,
      mediaStore,
      providerResolver: {
        listConnectionCandidates: async () => [],
        listGenerationRoutes: async () => catalog(),
        isGenerationRouteAvailable: async () => true,
      },
      adapters: new Map([['weprompt-image-v1', adapter]]),
      listProviders: async () => [provider],
      createJobId: () => 'job_same',
      createIdempotencyKey: sequence(['key_1', 'key_2']),
    });
    harnesses.push({ rootDir, store, mediaStore, project: firstProject, manager });

    await Promise.all(
      [firstProject, secondProject].map((project) =>
        manager.submitScenes({
          projectId: project.id,
          expectedRevision: project.revision,
          sceneIds: ['scene_1'],
          routes: [route],
          catalogVersion: 'catalog_1',
        })
      )
    );

    await waitFor(() => expect(submit).toHaveBeenCalledTimes(2));
    expect((await store.getProject(firstProject.id))?.jobs.job_same.status).toBe('submitting');
    expect((await store.getProject(secondProject.id))?.jobs.job_same.status).toBe('submitting');
    for (const gate of gates) gate.reject(Object.assign(new Error('provider failed'), { code: 'no_output' }));
  });

  it('commits concurrent completions for separate scenes without stale-revision loss', async () => {
    const gates: Array<Deferred<ProviderSubmitResult>> = [];
    let call = 0;
    let outputPaths: string[] = [];
    const adapter: GenerationProviderAdapter = {
      id: 'weprompt-image-v1',
      validateConnection: async () => ({ ok: true }),
      validateRequest: (request) => ({
        ok: true,
        normalized: {
          aspectRatio: request.aspectRatio,
          resolution: request.resolution,
          durationSeconds: request.durationSeconds,
        },
      }),
      submit: async () => {
        const index = call++;
        const gate = deferred<ProviderSubmitResult>();
        gates.push(gate);
        return gate.promise.then(() => ({
          kind: 'complete' as const,
          outputs: [
            {
              mediaKind: 'image' as const,
              role: 'primary' as const,
              source: { kind: 'file' as const, path: outputPaths[index]! },
              mimeType: 'image/png' as const,
            },
          ],
        }));
      },
    };
    const secondScene = scene({ id: 'scene_2', title: 'Closing' });
    const secondRoute = { ...route, sceneId: secondScene.id };
    const harness = await createHarness(adapter, {
      scenes: [scene(), secondScene],
      routes: [route, secondRoute],
      jobIds: ['job_1', 'job_2'],
      idempotencyKeys: ['key_1', 'key_2'],
    });
    outputPaths = [path.join(harness.rootDir, 'first.png'), path.join(harness.rootDir, 'second.png')];
    await Promise.all(outputPaths.map((outputPath) => writeFile(outputPath, png)));

    await harness.manager.submitScenes({
      projectId: harness.project.id,
      expectedRevision: harness.project.revision,
      sceneIds: ['scene_1', secondScene.id],
      routes: [route, secondRoute],
      catalogVersion: 'catalog_1',
    });
    await waitFor(() => expect(gates).toHaveLength(2));
    gates[0]!.resolve({ kind: 'complete', outputs: [] });
    gates[1]!.resolve({ kind: 'complete', outputs: [] });

    await waitFor(async () => {
      const project = await harness.store.getProject(harness.project.id);
      expect(project?.jobs.job_1.status).toBe('succeeded');
      expect(project?.jobs.job_2.status).toBe('succeeded');
      expect(Object.keys(project?.assets ?? {})).toHaveLength(2);
    });
  });
});

describe('StudioJobManager cancellation', () => {
  const seedCancellationJob = async (
    harness: Harness,
    status: StudioJobStatus,
    cancellationPolicy: StudioCancellationPolicy,
    providerJobId: string | null = status === 'queued_local' || status === 'submitting' ? null : 'remote_1'
  ): Promise<StudioProject> =>
    harness.store.updateProject(harness.project.id, (project) => {
      const next = structuredClone(project);
      next.jobs.job_1 = {
        id: 'job_1',
        projectId: project.id,
        sceneId: 'scene_1',
        status,
        provider: selectionFor(route),
        idempotencyKey: 'key_1',
        providerJobId,
        cancellationPolicy,
        outputAssetIds: [],
        error: null,
        retryOfJobId: null,
        retryReason: null,
        duplicateChargeAcknowledged: false,
        duplicateChargeAcknowledgedAt: null,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
      };
      next.scenes.scene_1.jobIds = ['job_1'];
      next.scenes.scene_1.reviewState = status === 'succeeded' ? 'complete' : 'generating';
      return next;
    });

  it.each([
    { status: 'queued_local', policy: 'none', outcome: 'cancelled', providerCalls: 0 },
    { status: 'submitting', policy: 'queued_and_running', outcome: 'needs_attention', providerCalls: 0 },
    { status: 'queued_remote', policy: 'none', outcome: 'refused', providerCalls: 0 },
    { status: 'queued_remote', policy: 'queued_only', outcome: 'cancelled', providerCalls: 1 },
    { status: 'queued_remote', policy: 'queued_and_running', outcome: 'cancelled', providerCalls: 1 },
    { status: 'running', policy: 'none', outcome: 'refused', providerCalls: 0 },
    { status: 'running', policy: 'queued_only', outcome: 'refused', providerCalls: 0 },
    { status: 'running', policy: 'queued_and_running', outcome: 'cancelled', providerCalls: 1 },
    { status: 'needs_attention', policy: 'none', outcome: 'refused', providerCalls: 0 },
    { status: 'needs_attention', policy: 'queued_only', outcome: 'refused', providerCalls: 0 },
    { status: 'needs_attention', policy: 'queued_and_running', outcome: 'cancelled', providerCalls: 1 },
    { status: 'succeeded', policy: 'queued_and_running', outcome: 'refused', providerCalls: 0 },
    { status: 'failed', policy: 'queued_and_running', outcome: 'refused', providerCalls: 0 },
    { status: 'cancelled', policy: 'queued_and_running', outcome: 'cancelled', providerCalls: 0 },
  ] as const)(
    '$status with $policy resolves as $outcome using $providerCalls provider calls',
    async ({ status, policy, outcome, providerCalls }) => {
      const cancel = vi.fn(async () => ({ kind: 'cancelled' as const }));
      const adapter: GenerationProviderAdapter = {
        id: 'weprompt-image-v1',
        validateConnection: async () => ({ ok: true }),
        validateRequest: () => ({ ok: false, issues: [{ code: 'provider_unavailable' }] }),
        submit: vi.fn(),
        cancel,
      };
      const harness = await createHarness(adapter);
      const seeded = await seedCancellationJob(harness, status, policy);
      const operation = harness.manager.cancelJob({
        projectId: seeded.id,
        jobId: 'job_1',
        expectedRevision: seeded.revision,
      });

      if (outcome === 'cancelled') await expect(operation).resolves.toMatchObject({ status: 'cancelled' });
      else if (outcome === 'needs_attention') {
        await expect(operation).resolves.toMatchObject({
          status: 'needs_attention',
          error: { code: 'submission_unknown' },
        });
      } else await expect(operation).rejects.toMatchObject({ code: 'cancellation_refused' });
      expect(cancel).toHaveBeenCalledTimes(providerCalls);
    }
  );

  it('cancels a never-settling submission without losing duplicate-charge safety or either slot', async () => {
    const { selectedProvider, scenes, routes } = mixedSchedulingFixture();
    const started: string[] = [];
    const submit: GenerationProviderAdapter['submit'] = async (request, _provider, signal) => {
      started.push(request.prompt);
      if (request.prompt === 'video_prompt') {
        return new Promise<ProviderSubmitResult>((resolve) => {
          signal.addEventListener('abort', () => resolve({ kind: 'complete', outputs: [] }), { once: true });
        });
      }
      return new Promise<ProviderSubmitResult>(() => undefined);
    };
    const imageAdapter = controllableAdapter('weprompt-image-v1', { submit });
    const videoAdapter = controllableAdapter('weprompt-media-gateway-v1', { submit });
    const harness = await createHarness(imageAdapter, {
      scenes,
      routes,
      provider: selectedProvider,
      additionalAdapters: [videoAdapter],
      jobIds: ['job_1', 'job_2', 'job_3', 'job_4'],
      idempotencyKeys: ['key_1', 'key_2', 'key_3', 'key_4'],
    });
    const projectBScene = scene({
      id: 'scene_project_b',
      title: 'Project B video',
      visualPrompt: 'project_b_video_prompt',
      mediaKind: 'video',
    });
    const projectBRoute: StudioResolvedSceneRouteSnapshot = {
      ...routes[0]!,
      sceneId: projectBScene.id,
    };
    const projectB = await createProjectFixture(harness.store, 'Project B', [projectBScene], [projectBRoute]);

    await harness.manager.submitScenes({
      projectId: harness.project.id,
      expectedRevision: harness.project.revision,
      sceneIds: scenes.map((candidate) => candidate.id),
      routes,
      catalogVersion: 'catalog_1',
    });
    await waitFor(async () => {
      const projectA = await harness.store.getProject(harness.project.id);
      expect(started).toEqual(['video_prompt', 'image_prompt_first']);
      expect(projectA?.jobs.job_3.status).toBe('queued_local');
    });
    await harness.manager.submitScenes({
      projectId: projectB.id,
      expectedRevision: projectB.revision,
      sceneIds: [projectBScene.id],
      routes: [projectBRoute],
      catalogVersion: 'catalog_1',
    });
    await waitFor(async () =>
      expect((await harness.store.getProject(projectB.id))?.jobs.job_4.status).toBe('queued_local')
    );
    const beforeCancel = (await harness.store.getProject(harness.project.id))!;

    await expect(
      harness.manager.cancelJob({
        projectId: beforeCancel.id,
        jobId: 'job_1',
        expectedRevision: beforeCancel.revision,
      })
    ).resolves.toMatchObject({
      status: 'needs_attention',
      providerJobId: null,
      error: { code: 'submission_unknown' },
    });

    await waitFor(async () => {
      const [projectA, currentProjectB] = await Promise.all([
        harness.store.getProject(harness.project.id),
        harness.store.getProject(projectB.id),
      ]);
      expect(projectA?.jobs.job_3.status).toBe('submitting');
      expect(currentProjectB?.jobs.job_4.status).toBe('submitting');
      expect(started.slice(0, 2)).toEqual(['video_prompt', 'image_prompt_first']);
      expect(started.slice(2).toSorted()).toEqual(['image_prompt_waiting', 'project_b_video_prompt']);
    });
    const afterCancel = (await harness.store.getProject(harness.project.id))!;
    await expect(
      harness.manager.retryJob({
        projectId: afterCancel.id,
        jobId: 'job_1',
        expectedRevision: afterCancel.revision,
      })
    ).rejects.toMatchObject({ code: 'duplicate_charge_acknowledgement_required' });
  });

  it('uses the durable job tuple after project selection and current route catalog both change', async () => {
    const cancel = vi.fn(async () => ({ kind: 'cancelled' as const }));
    const adapter: GenerationProviderAdapter = {
      id: 'weprompt-image-v1',
      validateConnection: async () => ({ ok: true }),
      validateRequest: () => ({ ok: false, issues: [{ code: 'provider_unavailable' }] }),
      submit: vi.fn(),
      cancel,
    };
    const harness = await createHarness(adapter, {
      provider: {
        ...provider,
        models: [],
        model_enabled: { 'image-model': false },
        model_health: { 'image-model': { status: 'unhealthy' } },
      },
      isGenerationRouteAvailable: async () => false,
    });
    const seeded = await seedCancellationJob(harness, 'queued_remote', 'queued_only');
    const changedSelection = await harness.store.updateProject(seeded.id, (project) => {
      project.routing.image = null;
      return project;
    });

    await expect(
      harness.manager.cancelJob({
        projectId: changedSelection.id,
        jobId: 'job_1',
        expectedRevision: changedSelection.revision,
      })
    ).resolves.toMatchObject({ status: 'cancelled' });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it.each([
    ['disabled provider', { ...provider, enabled: false }],
    ['missing credential', { ...provider, api_key: '   ' }],
    ['different provider identity', { ...provider, id: 'provider_2' }],
  ] as const)('refuses durable cancellation with a %s row', async (_label, currentProvider) => {
    const cancel = vi.fn(async () => ({ kind: 'cancelled' as const }));
    const adapter: GenerationProviderAdapter = {
      id: 'weprompt-image-v1',
      validateConnection: async () => ({ ok: true }),
      validateRequest: () => ({ ok: false, issues: [{ code: 'provider_unavailable' }] }),
      submit: vi.fn(),
      cancel,
    };
    const harness = await createHarness(adapter, { provider: currentProvider });
    const seeded = await seedCancellationJob(harness, 'queued_remote', 'queued_only');

    await expect(
      harness.manager.cancelJob({
        projectId: seeded.id,
        jobId: 'job_1',
        expectedRevision: seeded.revision,
      })
    ).rejects.toMatchObject({ code: 'cancellation_refused' });
    expect(cancel).not.toHaveBeenCalled();
  });

  it('single-flights concurrent remote cancellation by project and job', async () => {
    const providerResult = deferred<{ kind: 'cancelled' }>();
    const cancel = vi.fn(async () => providerResult.promise);
    const adapter: GenerationProviderAdapter = {
      id: 'weprompt-image-v1',
      validateConnection: async () => ({ ok: true }),
      validateRequest: () => ({ ok: false, issues: [{ code: 'provider_unavailable' }] }),
      submit: vi.fn(),
      cancel,
    };
    const harness = await createHarness(adapter);
    const seeded = await seedCancellationJob(harness, 'queued_remote', 'queued_only');
    const input = { projectId: seeded.id, jobId: 'job_1', expectedRevision: seeded.revision };

    const first = harness.manager.cancelJob(input);
    const second = harness.manager.cancelJob(input);
    await waitFor(() => expect(cancel).toHaveBeenCalledOnce());
    providerResult.resolve({ kind: 'cancelled' });

    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult).toEqual(secondResult);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('does not let a stale concurrent cancellation inherit an authorized flight', async () => {
    const providerResult = deferred<{ kind: 'cancelled' }>();
    const cancel = vi.fn(async () => providerResult.promise);
    const adapter: GenerationProviderAdapter = {
      id: 'weprompt-image-v1',
      validateConnection: async () => ({ ok: true }),
      validateRequest: () => ({ ok: false, issues: [{ code: 'provider_unavailable' }] }),
      submit: vi.fn(),
      cancel,
    };
    const harness = await createHarness(adapter);
    const seeded = await seedCancellationJob(harness, 'queued_remote', 'queued_only');
    const authorized = harness.manager.cancelJob({
      projectId: seeded.id,
      jobId: 'job_1',
      expectedRevision: seeded.revision,
    });
    await waitFor(() => expect(cancel).toHaveBeenCalledOnce());
    const stale = harness.manager.cancelJob({
      projectId: seeded.id,
      jobId: 'job_1',
      expectedRevision: seeded.revision - 1,
    });
    const staleAssertion = expect(stale).rejects.toMatchObject({ code: 'stale_project' });
    providerResult.resolve({ kind: 'cancelled' });

    await expect(authorized).resolves.toMatchObject({ status: 'cancelled' });
    await staleAssertion;
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('single-flights separately valid project revisions for the same remote job', async () => {
    const providerResult = deferred<{ kind: 'cancelled' }>();
    const cancel = vi.fn(async () => providerResult.promise);
    const adapter: GenerationProviderAdapter = {
      id: 'weprompt-image-v1',
      validateConnection: async () => ({ ok: true }),
      validateRequest: () => ({ ok: false, issues: [{ code: 'provider_unavailable' }] }),
      submit: vi.fn(),
      cancel,
    };
    const harness = await createHarness(adapter);
    const seeded = await seedCancellationJob(harness, 'queued_remote', 'queued_only');
    const first = harness.manager.cancelJob({
      projectId: seeded.id,
      jobId: 'job_1',
      expectedRevision: seeded.revision,
    });
    await waitFor(() => expect(cancel).toHaveBeenCalledOnce());
    const revised = await harness.store.updateProject(seeded.id, (project) => {
      project.name = 'Revised while cancellation is pending';
      return project;
    });
    const second = harness.manager.cancelJob({
      projectId: revised.id,
      jobId: 'job_1',
      expectedRevision: revised.revision,
    });

    await waitFor(() => expect(cancel).toHaveBeenCalledOnce());
    providerResult.resolve({ kind: 'cancelled' });
    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult).toEqual(secondResult);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('keeps local cancellation outside the remote flight when a newer valid revision arrives', async () => {
    const adapter: GenerationProviderAdapter = {
      id: 'weprompt-image-v1',
      validateConnection: async () => ({ ok: true }),
      validateRequest: () => ({ ok: false, issues: [{ code: 'provider_unavailable' }] }),
      submit: vi.fn(),
    };
    const harness = await createHarness(adapter);
    const seeded = await seedCancellationJob(harness, 'queued_local', 'none');
    const originalUpdate = harness.store.updateProject.bind(harness.store);
    let validationSnapshot = seeded;
    let newerCancellation: Promise<StudioJob> | undefined;
    let newerAssertion: Promise<void> | undefined;
    vi.spyOn(harness.store, 'getProject').mockImplementation(async () => structuredClone(validationSnapshot));
    let interceptFirstLocalMutation = true;
    vi.spyOn(harness.store, 'updateProject').mockImplementation(async (projectId, mutate, expectedRevision) => {
      if (interceptFirstLocalMutation && expectedRevision === seeded.revision) {
        interceptFirstLocalMutation = false;
        validationSnapshot = await originalUpdate(projectId, (project) => {
          project.name = 'Unrelated revision before local cancellation';
          return project;
        });
        newerCancellation = harness.manager.cancelJob({
          projectId,
          jobId: 'job_1',
          expectedRevision: validationSnapshot.revision,
        });
        newerAssertion = expect(newerCancellation).resolves.toMatchObject({ status: 'cancelled' });
        await Promise.resolve();
      }
      return originalUpdate(projectId, mutate, expectedRevision);
    });

    const staleCancellation = harness.manager.cancelJob({
      projectId: seeded.id,
      jobId: 'job_1',
      expectedRevision: seeded.revision,
    });
    const staleAssertion = expect(staleCancellation).rejects.toMatchObject({ code: 'stale_project' });
    await waitFor(() => expect(newerCancellation).toBeDefined());
    await staleAssertion;
    await newerAssertion;
  });

  it.each([
    ['timeout', 'conversation.creativeStudio.jobs.errors.timeout'],
    ['poll_deadline', 'conversation.creativeStudio.jobs.errors.pollDeadline'],
    ['provider_unavailable', 'conversation.creativeStudio.jobs.errors.providerUnavailable'],
  ] as const)(
    'commits an authorized queued-only cancellation after %s moves the same task to needs-attention',
    async (code, messageKey) => {
      const providerResult = deferred<{ kind: 'cancelled' }>();
      const cancel = vi.fn(async () => providerResult.promise);
      const adapter: GenerationProviderAdapter = {
        id: 'weprompt-image-v1',
        validateConnection: async () => ({ ok: true }),
        validateRequest: () => ({ ok: false, issues: [{ code: 'provider_unavailable' }] }),
        submit: vi.fn(),
        cancel,
      };
      const harness = await createHarness(adapter);
      const seeded = await seedCancellationJob(harness, 'queued_remote', 'queued_only');
      const cancellation = harness.manager.cancelJob({
        projectId: seeded.id,
        jobId: 'job_1',
        expectedRevision: seeded.revision,
      });
      await waitFor(() => expect(cancel).toHaveBeenCalledOnce());
      await harness.store.updateProject(seeded.id, (project) => {
        project.jobs.job_1.status = 'needs_attention';
        project.jobs.job_1.error = {
          code,
          messageKey,
        };
        return project;
      });
      providerResult.resolve({ kind: 'cancelled' });

      await expect(cancellation).resolves.toMatchObject({ status: 'cancelled', error: null });
    }
  );

  it.each([
    ['terminal success', (project: StudioProject) => void (project.jobs.job_1.status = 'succeeded')],
    ['terminal failure', (project: StudioProject) => void (project.jobs.job_1.status = 'failed')],
    ['changed provider identity', (project: StudioProject) => void (project.jobs.job_1.providerJobId = 'remote_2')],
  ] as const)('preserves %s when provider cancellation returns later', async (_label, mutate) => {
    const providerResult = deferred<{ kind: 'cancelled' }>();
    const cancel = vi.fn(async () => providerResult.promise);
    const adapter: GenerationProviderAdapter = {
      id: 'weprompt-image-v1',
      validateConnection: async () => ({ ok: true }),
      validateRequest: () => ({ ok: false, issues: [{ code: 'provider_unavailable' }] }),
      submit: vi.fn(),
      cancel,
    };
    const harness = await createHarness(adapter);
    const seeded = await seedCancellationJob(harness, 'queued_remote', 'queued_only');
    const cancellation = harness.manager.cancelJob({
      projectId: seeded.id,
      jobId: 'job_1',
      expectedRevision: seeded.revision,
    });
    await waitFor(() => expect(cancel).toHaveBeenCalledOnce());
    const raced = await harness.store.updateProject(seeded.id, (project) => {
      mutate(project);
      return project;
    });
    providerResult.resolve({ kind: 'cancelled' });

    await expect(cancellation).rejects.toMatchObject({ code: 'cancellation_refused' });
    await expect(harness.store.getProject(seeded.id)).resolves.toMatchObject({ jobs: { job_1: raced.jobs.job_1 } });
  });

  it('keeps provider refusal typed and leaves the durable job non-cancelled', async () => {
    const cancel = vi.fn(async () => ({ kind: 'refused' as const, error: { code: 'cancellation_refused' as const } }));
    const adapter: GenerationProviderAdapter = {
      id: 'weprompt-image-v1',
      validateConnection: async () => ({ ok: true }),
      validateRequest: () => ({ ok: false, issues: [{ code: 'provider_unavailable' }] }),
      submit: vi.fn(),
      cancel,
    };
    const harness = await createHarness(adapter);
    const seeded = await seedCancellationJob(harness, 'queued_remote', 'queued_only');

    await expect(
      harness.manager.cancelJob({ projectId: seeded.id, jobId: 'job_1', expectedRevision: seeded.revision })
    ).rejects.toMatchObject({ code: 'cancellation_refused' });
    await expect(harness.store.getProject(seeded.id)).resolves.toMatchObject({
      jobs: { job_1: { status: 'queued_remote' } },
    });
  });
  it('cancels FIFO work that is still queued locally without another provider call', async () => {
    const selectedProvider = { ...provider, models: ['video-model'] };
    const scenes = [
      scene({ id: 'scene_1', visualPrompt: 'first', mediaKind: 'video', durationSeconds: 4 }),
      scene({ id: 'scene_2', visualPrompt: 'second', mediaKind: 'video', durationSeconds: 4 }),
    ];
    const routes = scenes.map(
      (candidate): StudioResolvedSceneRouteSnapshot => ({
        sceneId: candidate.id,
        providerId: selectedProvider.id,
        adapterId: 'weprompt-media-gateway-v1',
        model: 'video-model',
        kind: 'video',
      })
    );
    const first = deferred<ProviderSubmitResult>();
    const submit = vi.fn(async () => first.promise);
    const adapter: GenerationProviderAdapter = {
      id: 'weprompt-media-gateway-v1',
      validateConnection: async () => ({ ok: true }),
      validateRequest: (request) => ({
        ok: true,
        normalized: {
          aspectRatio: request.aspectRatio,
          resolution: request.resolution,
          durationSeconds: request.durationSeconds,
        },
      }),
      submit,
    };
    const harness = await createHarness(adapter, {
      scenes,
      routes,
      provider: selectedProvider,
      jobIds: ['job_1', 'job_2'],
      idempotencyKeys: ['key_1', 'key_2'],
    });
    await harness.manager.submitScenes({
      projectId: harness.project.id,
      expectedRevision: harness.project.revision,
      sceneIds: ['scene_1', 'scene_2'],
      routes,
      catalogVersion: 'catalog_1',
    });
    await waitFor(async () => {
      const current = await harness.store.getProject(harness.project.id);
      expect(current?.jobs.job_1.status).toBe('submitting');
      expect(current?.jobs.job_2.status).toBe('queued_local');
    });
    const current = (await harness.store.getProject(harness.project.id))!;

    const cancelled = await harness.manager.cancelJob({
      projectId: current.id,
      jobId: 'job_2',
      expectedRevision: current.revision,
    });

    expect(cancelled.status).toBe('cancelled');
    expect(submit).toHaveBeenCalledOnce();
    first.reject(Object.assign(new Error('provider failed'), { code: 'unknown' }));
  });

  it('discards a provider success that arrives after confirmed queued cancellation', async () => {
    const selectedProvider = { ...provider, models: ['video-model'] };
    const videoRoute: StudioResolvedSceneRouteSnapshot = {
      sceneId: 'scene_1',
      providerId: selectedProvider.id,
      adapterId: 'weprompt-media-gateway-v1',
      model: 'video-model',
      kind: 'video',
    };
    const pollResult = deferred<ProviderJobSnapshot>();
    const poll = vi.fn(async () => pollResult.promise);
    const cancel = vi.fn(async () => ({ kind: 'cancelled' as const }));
    const adapter: GenerationProviderAdapter = {
      id: 'weprompt-media-gateway-v1',
      validateConnection: async () => ({ ok: true }),
      validateRequest: (request) => ({
        ok: true,
        normalized: {
          aspectRatio: request.aspectRatio,
          resolution: request.resolution,
          durationSeconds: request.durationSeconds,
        },
      }),
      submit: async () => ({ kind: 'remote', providerJobId: 'remote_1' }),
      poll,
      cancel,
    };
    const harness = await createHarness(adapter, {
      scenes: [scene({ mediaKind: 'video', durationSeconds: 5 })],
      routes: [videoRoute],
      provider: selectedProvider,
      sleep: async () => undefined,
      cancellationPolicy: 'queued_only',
    });
    const outputPath = path.join(harness.rootDir, 'late.mp4');
    await writeFile(outputPath, mp4);
    await harness.manager.submitScenes({
      projectId: harness.project.id,
      expectedRevision: harness.project.revision,
      sceneIds: ['scene_1'],
      routes: [videoRoute],
      catalogVersion: 'catalog_1',
    });
    await waitFor(() => expect(poll).toHaveBeenCalledOnce());
    const beforeCancel = (await harness.store.getProject(harness.project.id))!;

    await harness.manager.cancelJob({
      projectId: beforeCancel.id,
      jobId: 'job_1',
      expectedRevision: beforeCancel.revision,
    });
    const afterCancel = (await harness.store.getProject(beforeCancel.id))!;
    const repeated = await harness.manager.cancelJob({
      projectId: beforeCancel.id,
      jobId: 'job_1',
      expectedRevision: afterCancel.revision,
    });
    pollResult.resolve({
      status: 'succeeded',
      outputs: [
        {
          mediaKind: 'video',
          role: 'primary',
          source: { kind: 'file', path: outputPath },
          mimeType: 'video/mp4',
        },
      ],
    });

    expect(repeated.status).toBe('cancelled');
    expect(cancel).toHaveBeenCalledOnce();
    await waitFor(async () => {
      const project = await harness.store.getProject(harness.project.id);
      expect(project?.jobs.job_1.status).toBe('cancelled');
      expect(project?.assets).toEqual({});
      expect(project?.scenes.scene_1.selectedAssetId).toBeNull();
    });
  });

  it('returns a typed refusal for running work without calling provider cancellation', async () => {
    const selectedProvider = { ...provider, models: ['video-model'] };
    const videoRoute: StudioResolvedSceneRouteSnapshot = {
      sceneId: 'scene_1',
      providerId: selectedProvider.id,
      adapterId: 'weprompt-media-gateway-v1',
      model: 'video-model',
      kind: 'video',
    };
    const laterPoll = deferred<ProviderJobSnapshot>();
    let polls = 0;
    const cancel = vi.fn(async () => ({ kind: 'cancelled' as const }));
    const adapter: GenerationProviderAdapter = {
      id: 'weprompt-media-gateway-v1',
      validateConnection: async () => ({ ok: true }),
      validateRequest: (request) => ({
        ok: true,
        normalized: {
          aspectRatio: request.aspectRatio,
          resolution: request.resolution,
          durationSeconds: request.durationSeconds,
        },
      }),
      submit: async () => ({ kind: 'remote', providerJobId: 'remote_1' }),
      poll: async () => {
        polls += 1;
        return polls === 1 ? { status: 'running' } : laterPoll.promise;
      },
      cancel,
    };
    const harness = await createHarness(adapter, {
      scenes: [scene({ mediaKind: 'video', durationSeconds: 5 })],
      routes: [videoRoute],
      provider: selectedProvider,
      sleep: async () => undefined,
    });
    await harness.manager.submitScenes({
      projectId: harness.project.id,
      expectedRevision: harness.project.revision,
      sceneIds: ['scene_1'],
      routes: [videoRoute],
      catalogVersion: 'catalog_1',
    });
    await waitFor(async () =>
      expect((await harness.store.getProject(harness.project.id))?.jobs.job_1.status).toBe('running')
    );
    const current = (await harness.store.getProject(harness.project.id))!;

    await expect(
      harness.manager.cancelJob({
        projectId: current.id,
        jobId: 'job_1',
        expectedRevision: current.revision,
      })
    ).rejects.toMatchObject({ code: 'cancellation_refused' });
    expect(cancel).not.toHaveBeenCalled();
    laterPoll.resolve({ status: 'failed', error: { code: 'unknown' } });
  });

  it('records confirmed cancellation when polling advances queued work during the cancel call', async () => {
    const selectedProvider = { ...provider, models: ['video-model'] };
    const videoRoute: StudioResolvedSceneRouteSnapshot = {
      sceneId: 'scene_1',
      providerId: selectedProvider.id,
      adapterId: 'weprompt-media-gateway-v1',
      model: 'video-model',
      kind: 'video',
    };
    const firstSleep = deferred<void>();
    const cancellation = deferred<{ kind: 'cancelled' }>();
    const laterPoll = deferred<ProviderJobSnapshot>();
    let polls = 0;
    const cancel = vi.fn(async () => cancellation.promise);
    const adapter: GenerationProviderAdapter = {
      id: 'weprompt-media-gateway-v1',
      validateConnection: async () => ({ ok: true }),
      validateRequest: (request) => ({
        ok: true,
        normalized: {
          aspectRatio: request.aspectRatio,
          resolution: request.resolution,
          durationSeconds: request.durationSeconds,
        },
      }),
      submit: async () => ({ kind: 'remote', providerJobId: 'remote_1' }),
      poll: async () => {
        polls += 1;
        return polls === 1 ? { status: 'running' } : laterPoll.promise;
      },
      cancel,
    };
    const harness = await createHarness(adapter, {
      scenes: [scene({ mediaKind: 'video', durationSeconds: 5 })],
      routes: [videoRoute],
      provider: selectedProvider,
      sleep: async () => firstSleep.promise,
      cancellationPolicy: 'queued_only',
    });
    await harness.manager.submitScenes({
      projectId: harness.project.id,
      expectedRevision: harness.project.revision,
      sceneIds: ['scene_1'],
      routes: [videoRoute],
      catalogVersion: 'catalog_1',
    });
    await waitFor(async () =>
      expect((await harness.store.getProject(harness.project.id))?.jobs.job_1.status).toBe('queued_remote')
    );
    const queued = (await harness.store.getProject(harness.project.id))!;
    const cancellationResult = harness.manager.cancelJob({
      projectId: queued.id,
      jobId: 'job_1',
      expectedRevision: queued.revision,
    });
    await waitFor(() => expect(cancel).toHaveBeenCalledOnce());
    firstSleep.resolve();
    await waitFor(async () =>
      expect((await harness.store.getProject(harness.project.id))?.jobs.job_1.status).toBe('running')
    );
    cancellation.resolve({ kind: 'cancelled' });

    await expect(cancellationResult).resolves.toMatchObject({ status: 'cancelled' });
    laterPoll.resolve({ status: 'failed', error: { code: 'unknown' } });
  });

  it('waits for the full remote cancellation transaction during disposal', async () => {
    const cancellation = deferred<{ kind: 'cancelled' }>();
    const cancel = vi.fn(async () => cancellation.promise);
    const adapter: GenerationProviderAdapter = {
      id: 'weprompt-image-v1',
      validateConnection: async () => ({ ok: true }),
      validateRequest: (request) => ({
        ok: true,
        normalized: {
          aspectRatio: request.aspectRatio,
          resolution: request.resolution,
          durationSeconds: request.durationSeconds,
        },
      }),
      submit: vi.fn(),
      cancel,
    };
    const harness = await createHarness(adapter);
    const queued = await harness.store.updateProject(harness.project.id, (project) => {
      const next = structuredClone(project);
      next.jobs.job_1 = {
        id: 'job_1',
        projectId: project.id,
        sceneId: 'scene_1',
        status: 'queued_remote',
        provider: {
          providerId: route.providerId,
          adapterId: route.adapterId,
          model: route.model,
        },
        idempotencyKey: 'key_1',
        providerJobId: 'remote_1',
        cancellationPolicy: 'queued_only',
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
    const cancelResult = harness.manager.cancelJob({
      projectId: queued.id,
      jobId: 'job_1',
      expectedRevision: queued.revision,
    });
    await waitFor(() => expect(cancel).toHaveBeenCalledOnce());
    let disposed = false;
    const disposal = harness.manager.dispose().then(() => {
      disposed = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(disposed).toBe(false);

    cancellation.resolve({ kind: 'cancelled' });

    await expect(cancelResult).resolves.toMatchObject({ status: 'cancelled' });
    await disposal;
    expect(disposed).toBe(true);
    expect((await harness.store.getProject(queued.id))?.jobs.job_1.status).toBe('cancelled');
  });
});

describe('StudioJobManager retries', () => {
  it('rejects retry for poll_deadline without resetting or polling the durable task', async () => {
    const poll = vi.fn(
      async (): Promise<ProviderJobSnapshot> => ({
        status: 'failed',
        error: { code: 'unknown' },
      })
    );
    const submit = vi.fn();
    const harness = await createHarness({
      id: 'weprompt-image-v1',
      validateConnection: async () => ({ ok: true }),
      validateRequest: () => ({ ok: false, issues: [{ code: 'invalid_request' }] }),
      submit,
      poll,
    });
    const seeded = await seedRemoteJob(harness, {
      status: 'needs_attention',
      remoteStartedAt: '2026-08-04T00:00:00.000Z',
      error: {
        code: 'poll_deadline',
        messageKey: 'conversation.creativeStudio.jobs.errors.pollDeadline',
      },
    });
    const before = structuredClone(seeded.jobs.job_1);

    await expect(
      harness.manager.retryJob({ projectId: seeded.id, jobId: 'job_1', expectedRevision: seeded.revision })
    ).rejects.toMatchObject({ code: 'invalid_request' });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect((await harness.store.getProject(seeded.id))?.jobs.job_1).toEqual(before);
    expect(submit).not.toHaveBeenCalled();
    expect(poll).not.toHaveBeenCalled();
  });

  it('bounds retryDownload to one attempt without applying the remote lifecycle deadline', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-04T00:00:00.000Z'));
    try {
      let outputPath = '';
      const poll = vi.fn(
        async () =>
          new Promise<ProviderJobSnapshot>((resolve) => {
            setTimeout(
              () =>
                resolve({
                  status: 'succeeded',
                  outputs: [
                    {
                      mediaKind: 'image',
                      role: 'primary',
                      source: { kind: 'file', path: outputPath },
                      mimeType: 'image/png',
                    },
                  ],
                }),
              REMOTE_POLL_ATTEMPT_TIMEOUT_MS + 1_000
            );
          })
      );
      const harness = await createHarness({
        id: 'weprompt-image-v1',
        validateConnection: async () => ({ ok: true }),
        validateRequest: () => ({ ok: false, issues: [{ code: 'invalid_request' }] }),
        submit: vi.fn(),
        poll,
      });
      outputPath = path.join(harness.rootDir, 'late-download-retry.png');
      await writeFile(outputPath, png);
      const seeded = await seedRemoteJob(harness, {
        status: 'failed',
        remoteStartedAt: '2020-01-01T00:00:00.000Z',
        error: {
          code: 'download_failed',
          messageKey: 'conversation.creativeStudio.jobs.errors.downloadFailed',
        },
      });

      const operation = harness.manager.retryDownload({
        projectId: seeded.id,
        jobId: 'job_1',
        expectedRevision: seeded.revision,
      });
      await vi.waitFor(() => expect(poll).toHaveBeenCalledOnce());
      await vi.advanceTimersByTimeAsync(REMOTE_POLL_ATTEMPT_TIMEOUT_MS + 1_000);

      await expect(operation).resolves.toMatchObject({
        status: 'failed',
        remoteStartedAt: '2020-01-01T00:00:00.000Z',
        error: { code: 'download_failed' },
      });
      expect(poll).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it('restores download_failed on disposal so restart does not apply the generation lifecycle', async () => {
    const poll = vi.fn(async () => new Promise<ProviderJobSnapshot>(() => undefined));
    const adapter: GenerationProviderAdapter = {
      id: 'weprompt-image-v1',
      validateConnection: async () => ({ ok: true }),
      validateRequest: () => ({ ok: false, issues: [{ code: 'invalid_request' }] }),
      submit: vi.fn(),
      poll,
    };
    const harness = await createHarness(adapter);
    const seeded = await seedRemoteJob(harness, {
      status: 'failed',
      remoteStartedAt: '2020-01-01T00:00:00.000Z',
      error: {
        code: 'download_failed',
        messageKey: 'conversation.creativeStudio.jobs.errors.downloadFailed',
      },
    });
    const operation = harness.manager.retryDownload({
      projectId: seeded.id,
      jobId: 'job_1',
      expectedRevision: seeded.revision,
    });
    await waitFor(() => expect(poll).toHaveBeenCalledOnce());

    await harness.manager.dispose();

    await expect(operation).resolves.toMatchObject({
      status: 'failed',
      providerJobId: 'remote_1',
      remoteStartedAt: '2020-01-01T00:00:00.000Z',
      error: { code: 'download_failed' },
    });
    const recoveryPoll = vi.fn(async (): Promise<ProviderJobSnapshot> => ({ status: 'running' }));
    harness.manager = createStudioJobManager({
      store: harness.store,
      mediaStore: harness.mediaStore,
      providerResolver: {
        listConnectionCandidates: async () => [],
        listGenerationRoutes: async () => catalog(),
        isGenerationRouteAvailable: async () => true,
      },
      adapters: new Map([[adapter.id, { ...adapter, poll: recoveryPoll }]]),
      listProviders: async () => [provider],
      sleep: async () => undefined,
      now: () => '2026-08-04T00:00:00.000Z',
      nowEpochMs: () => Date.parse('2026-08-04T00:00:00.000Z'),
    });

    await harness.manager.resumePendingJobs();
    await new Promise((resolve) => setTimeout(resolve, 20));

    await expect(harness.store.getProject(seeded.id)).resolves.toMatchObject({
      jobs: { job_1: { status: 'failed', error: { code: 'download_failed' } } },
    });
    expect(recoveryPoll).not.toHaveBeenCalled();
  });

  it('restores download_failed when disposal aborts a retry waiting for same-kind capacity', async () => {
    const scenes = [scene(), scene({ id: 'scene_2' }), scene({ id: 'scene_3' })];
    const routes = scenes.map(
      (candidate): StudioResolvedSceneRouteSnapshot => ({
        ...route,
        sceneId: candidate.id,
      })
    );
    const submit = vi.fn(
      async (_request, _provider, signal: AbortSignal) =>
        new Promise<ProviderSubmitResult>((_resolve, reject) => {
          const rejectOnAbort = (): void => reject(new Error('submission aborted'));
          signal.addEventListener('abort', rejectOnAbort, { once: true });
          if (signal.aborted) rejectOnAbort();
        })
    );
    const poll = vi.fn(async (): Promise<ProviderJobSnapshot> => ({ status: 'running' }));
    const adapter: GenerationProviderAdapter = {
      id: 'weprompt-image-v1',
      validateConnection: async () => ({ ok: true }),
      validateRequest: (request) => ({
        ok: true,
        normalized: {
          aspectRatio: request.aspectRatio,
          resolution: request.resolution,
          durationSeconds: request.durationSeconds,
        },
      }),
      submit,
      poll,
    };
    const harness = await createHarness(adapter, {
      scenes,
      routes,
      jobIds: ['job_1', 'job_2'],
      idempotencyKeys: ['key_1', 'key_2'],
    });
    await harness.manager.submitScenes({
      projectId: harness.project.id,
      expectedRevision: harness.project.revision,
      sceneIds: ['scene_1', 'scene_2'],
      routes: routes.slice(0, 2),
      catalogVersion: 'catalog_1',
    });
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(2));
    const withFailedDownload = await harness.store.updateProject(harness.project.id, (project) => {
      project.jobs.job_3 = {
        id: 'job_3',
        projectId: project.id,
        sceneId: 'scene_3',
        status: 'failed',
        provider: selectionFor(routes[2]!),
        idempotencyKey: 'key_3',
        providerJobId: 'remote_3',
        remoteStartedAt: '2020-01-01T00:00:00.000Z',
        cancellationPolicy: 'none',
        outputAssetIds: [],
        error: {
          code: 'download_failed',
          messageKey: 'conversation.creativeStudio.jobs.errors.downloadFailed',
        },
        retryOfJobId: null,
        retryReason: null,
        duplicateChargeAcknowledged: false,
        duplicateChargeAcknowledgedAt: null,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
      };
      project.scenes.scene_3.jobIds = ['job_3'];
      project.scenes.scene_3.reviewState = 'blocked';
      return project;
    });
    const operation = harness.manager.retryDownload({
      projectId: withFailedDownload.id,
      jobId: 'job_3',
      expectedRevision: withFailedDownload.revision,
    });
    await waitFor(async () =>
      expect((await harness.store.getProject(withFailedDownload.id))?.jobs.job_3.status).toBe('running')
    );
    expect(poll).not.toHaveBeenCalled();
    const operationAssertion = expect(operation).resolves.toMatchObject({
      status: 'failed',
      providerJobId: 'remote_3',
      error: { code: 'download_failed' },
    });

    await harness.manager.dispose();
    await operationAssertion;

    const recoveryPoll = vi.fn(async (): Promise<ProviderJobSnapshot> => ({ status: 'running' }));
    harness.manager = createStudioJobManager({
      store: harness.store,
      mediaStore: harness.mediaStore,
      providerResolver: {
        listConnectionCandidates: async () => [],
        listGenerationRoutes: async () => catalog(routes),
        isGenerationRouteAvailable: async () => true,
      },
      adapters: new Map([[adapter.id, { ...adapter, poll: recoveryPoll }]]),
      listProviders: async () => [provider],
      sleep: async () => undefined,
      now: () => '2026-08-04T00:00:00.000Z',
      nowEpochMs: () => Date.parse('2026-08-04T00:00:00.000Z'),
    });
    await harness.manager.resumePendingJobs();
    await new Promise((resolve) => setTimeout(resolve, 20));

    await expect(harness.store.getProject(withFailedDownload.id)).resolves.toMatchObject({
      jobs: { job_3: { status: 'failed', error: { code: 'download_failed' } } },
    });
    expect(recoveryPoll).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: 'succeeded work',
      mutate: (job: StudioJob) => {
        job.status = 'succeeded';
        job.error = null;
      },
      expected: { status: 'succeeded', providerJobId: 'remote_1' },
    },
    {
      label: 'failed work',
      mutate: (job: StudioJob) => {
        job.status = 'failed';
        job.error = { code: 'unknown', messageKey: 'conversation.creativeStudio.jobs.errors.unknown' };
      },
      expected: { status: 'failed', providerJobId: 'remote_1', error: { code: 'unknown' } },
    },
    {
      label: 'cancelled work',
      mutate: (job: StudioJob) => {
        job.status = 'cancelled';
        job.error = null;
      },
      expected: { status: 'cancelled', providerJobId: 'remote_1' },
    },
    {
      label: 'a replacement provider identity',
      mutate: (job: StudioJob) => void (job.providerJobId = 'remote_replacement'),
      expected: { status: 'running', providerJobId: 'remote_replacement' },
    },
  ])('does not let retryDownload disposal overwrite $label', async ({ mutate, expected }) => {
    const poll = vi.fn(async () => new Promise<ProviderJobSnapshot>(() => undefined));
    const harness = await createHarness({
      id: 'weprompt-image-v1',
      validateConnection: async () => ({ ok: true }),
      validateRequest: () => ({ ok: false, issues: [{ code: 'invalid_request' }] }),
      submit: vi.fn(),
      poll,
    });
    const seeded = await seedRemoteJob(harness, {
      status: 'failed',
      remoteStartedAt: '2026-08-04T00:00:00.000Z',
      error: {
        code: 'download_failed',
        messageKey: 'conversation.creativeStudio.jobs.errors.downloadFailed',
      },
    });
    const operation = harness.manager.retryDownload({
      projectId: seeded.id,
      jobId: 'job_1',
      expectedRevision: seeded.revision,
    });
    await waitFor(() => expect(poll).toHaveBeenCalledOnce());
    await harness.store.updateProject(seeded.id, (project) => {
      mutate(project.jobs.job_1);
      return project;
    });

    await harness.manager.dispose();

    await expect(operation).resolves.toMatchObject(expected);
    await expect(harness.store.getProject(seeded.id)).resolves.toMatchObject({ jobs: { job_1: expected } });
  });

  it('retries with the immutable failed-job provider after the project default changes', async () => {
    const changedSelection = { ...route, model: 'image-b' };
    const adapter: GenerationProviderAdapter = {
      id: route.adapterId,
      validateConnection: async () => ({ ok: true }),
      validateRequest: (request) => ({
        ok: true,
        normalized: {
          aspectRatio: request.aspectRatio,
          resolution: request.resolution,
          durationSeconds: request.durationSeconds,
        },
      }),
      submit: vi.fn(async () => ({ kind: 'complete' as const, outputs: [] })),
    };
    const harness = await createHarness(adapter, {
      routes: [route, changedSelection],
      provider: { ...provider, models: [route.model, changedSelection.model] },
      jobIds: ['job_2'],
      idempotencyKeys: ['key_2'],
    });
    const failed = await harness.store.updateProject(harness.project.id, (project) => {
      const next = structuredClone(project);
      next.jobs.job_1 = {
        id: 'job_1',
        projectId: project.id,
        sceneId: 'scene_1',
        status: 'failed',
        provider: selectionFor(route),
        idempotencyKey: 'key_1',
        providerJobId: null,
        cancellationPolicy: 'none',
        outputAssetIds: [],
        error: {
          code: 'no_output',
          messageKey: 'conversation.creativeStudio.jobs.errors.noOutput',
        },
        retryOfJobId: null,
        retryReason: null,
        duplicateChargeAcknowledged: false,
        duplicateChargeAcknowledgedAt: null,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
      };
      next.scenes.scene_1.jobIds.push('job_1');
      next.scenes.scene_1.reviewState = 'blocked';
      next.routing.image = selectionFor(changedSelection);
      return next;
    });

    const retry = await harness.manager.retryJob({
      projectId: failed.id,
      jobId: 'job_1',
      expectedRevision: failed.revision,
    });

    expect(retry.provider.model).toBe(route.model);
    expect((await harness.store.getProject(failed.id))?.routing.image).toEqual(selectionFor(changedSelection));
  });

  it('returns unsupported when a successful provider output has no durable remote task to re-download', async () => {
    const adapter: GenerationProviderAdapter = {
      id: 'weprompt-image-v1',
      validateConnection: async () => ({ ok: true }),
      validateRequest: (request) => ({
        ok: true,
        normalized: {
          aspectRatio: request.aspectRatio,
          resolution: request.resolution,
          durationSeconds: request.durationSeconds,
        },
      }),
      submit: vi.fn(),
      poll: vi.fn(),
    };
    const harness = await createHarness(adapter);
    const failed = await harness.store.updateProject(harness.project.id, (project) => {
      const next = structuredClone(project);
      next.jobs.job_1 = {
        id: 'job_1',
        projectId: project.id,
        sceneId: 'scene_1',
        status: 'failed',
        provider: {
          providerId: route.providerId,
          adapterId: route.adapterId,
          model: route.model,
        },
        idempotencyKey: 'key_1',
        providerJobId: null,
        cancellationPolicy: 'none',
        outputAssetIds: [],
        error: {
          code: 'download_failed',
          messageKey: 'conversation.creativeStudio.jobs.errors.downloadFailed',
        },
        retryOfJobId: null,
        retryReason: null,
        duplicateChargeAcknowledged: false,
        duplicateChargeAcknowledgedAt: null,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
      };
      next.scenes.scene_1.jobIds.push('job_1');
      next.scenes.scene_1.reviewState = 'blocked';
      return next;
    });

    await expect(
      harness.manager.retryDownload({
        projectId: failed.id,
        jobId: 'job_1',
        expectedRevision: failed.revision,
      })
    ).rejects.toMatchObject({ code: 'unsupported' });
    expect(adapter.poll).not.toHaveBeenCalled();
    expect(adapter.submit).not.toHaveBeenCalled();
  });

  it('never treats a durable remote task without polling support as a confirmed provider failure', async () => {
    const submit = vi.fn(async () => ({ kind: 'remote' as const, providerJobId: 'remote_unpollable' }));
    const adapter: GenerationProviderAdapter = {
      id: 'weprompt-image-v1',
      validateConnection: async () => ({ ok: true }),
      validateRequest: (request) => ({
        ok: true,
        normalized: {
          aspectRatio: request.aspectRatio,
          resolution: request.resolution,
          durationSeconds: request.durationSeconds,
        },
      }),
      submit,
    };
    const harness = await createHarness(adapter);

    await harness.manager.submitScenes({
      projectId: harness.project.id,
      expectedRevision: harness.project.revision,
      sceneIds: ['scene_1'],
      routes: [route],
      catalogVersion: 'catalog_1',
    });
    await waitFor(async () =>
      expect((await harness.store.getProject(harness.project.id))?.jobs.job_1).toMatchObject({
        status: 'needs_attention',
        providerJobId: 'remote_unpollable',
        error: { code: 'unsupported' },
      })
    );
    const paused = (await harness.store.getProject(harness.project.id))!;

    await expect(
      harness.manager.retryJob({
        projectId: paused.id,
        jobId: 'job_1',
        expectedRevision: paused.revision,
      })
    ).resolves.toMatchObject({
      id: 'job_1',
      status: 'queued_remote',
      providerJobId: 'remote_unpollable',
    });
    await waitFor(async () =>
      expect((await harness.store.getProject(harness.project.id))?.jobs.job_1).toMatchObject({
        status: 'needs_attention',
        error: { code: 'unsupported' },
      })
    );
    expect(submit).toHaveBeenCalledOnce();
  });

  it('creates a new paid attempt only after a confirmed provider failure snapshot', async () => {
    let cancellationPolicy: 'queued_only' | 'none' = 'queued_only';
    let submissionCount = 0;
    const submit = vi.fn(async () => {
      submissionCount += 1;
      return { kind: 'remote' as const, providerJobId: `remote_${submissionCount}` };
    });
    const poll = vi.fn(
      async (): Promise<ProviderJobSnapshot> => ({
        status: 'failed',
        error: { code: 'no_output' },
      })
    );
    const adapter: GenerationProviderAdapter = {
      id: 'weprompt-image-v1',
      validateConnection: async () => ({ ok: true }),
      validateRequest: (request) => ({
        ok: true,
        normalized: {
          aspectRatio: request.aspectRatio,
          resolution: request.resolution,
          durationSeconds: request.durationSeconds,
        },
      }),
      submit,
      poll,
    };
    const harness = await createHarness(adapter, {
      jobIds: ['job_1', 'job_2'],
      idempotencyKeys: ['key_1', 'key_2'],
      sleep: async () => undefined,
      catalog: async () => ({
        ...catalog(),
        routes: catalog().routes.map((candidate) => ({ ...candidate, cancellationPolicy })),
      }),
    });

    await harness.manager.submitScenes({
      projectId: harness.project.id,
      expectedRevision: harness.project.revision,
      sceneIds: ['scene_1'],
      routes: [route],
      catalogVersion: 'catalog_1',
    });
    await waitFor(async () =>
      expect((await harness.store.getProject(harness.project.id))?.jobs.job_1).toMatchObject({
        status: 'failed',
        error: { code: 'no_output' },
      })
    );
    const confirmedFailure = (await harness.store.getProject(harness.project.id))!;
    expect(confirmedFailure.jobs.job_1.cancellationPolicy).toBe('queued_only');
    cancellationPolicy = 'none';

    const retry = await harness.manager.retryJob({
      projectId: confirmedFailure.id,
      jobId: 'job_1',
      expectedRevision: confirmedFailure.revision,
    });

    expect(retry).toMatchObject({
      id: 'job_2',
      idempotencyKey: 'key_2',
      retryOfJobId: 'job_1',
      retryReason: 'provider_failure',
      duplicateChargeAcknowledged: false,
      duplicateChargeAcknowledgedAt: null,
      cancellationPolicy: 'none',
    });
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(2));
    await waitFor(async () =>
      expect((await harness.store.getProject(harness.project.id))?.jobs.job_2.status).toBe('failed')
    );
    const retriedProject = (await harness.store.getProject(harness.project.id))!;
    expect(retriedProject.jobs.job_1).toMatchObject({
      status: 'failed',
      error: { code: 'no_output' },
    });
    await expect(
      harness.manager.retryJob({
        projectId: retriedProject.id,
        jobId: 'job_1',
        expectedRevision: retriedProject.revision,
      })
    ).rejects.toMatchObject({ code: 'busy' });
    expect(submit).toHaveBeenCalledTimes(2);
  });

  it('requires and audits duplicate-charge acknowledgement before retrying an unknown submission', async () => {
    const secondSubmission = deferred<ProviderSubmitResult>();
    let submissions = 0;
    const adapter: GenerationProviderAdapter = {
      id: 'weprompt-image-v1',
      validateConnection: async () => ({ ok: true }),
      validateRequest: (request) => ({
        ok: true,
        normalized: {
          aspectRatio: request.aspectRatio,
          resolution: request.resolution,
          durationSeconds: request.durationSeconds,
        },
      }),
      submit: async () => {
        submissions += 1;
        if (submissions === 1) throw new Error('transport interrupted after request write');
        return secondSubmission.promise;
      },
    };
    const harness = await createHarness(adapter, {
      jobIds: ['job_1', 'job_2'],
      idempotencyKeys: ['key_1', 'key_2'],
    });
    await harness.manager.submitScenes({
      projectId: harness.project.id,
      expectedRevision: harness.project.revision,
      sceneIds: ['scene_1'],
      routes: [route],
      catalogVersion: 'catalog_1',
    });
    await waitFor(async () =>
      expect((await harness.store.getProject(harness.project.id))?.jobs.job_1.status).toBe('needs_attention')
    );
    const unknown = (await harness.store.getProject(harness.project.id))!;
    expect(submissions).toBe(1);

    await expect(
      harness.manager.submitScenes({
        projectId: unknown.id,
        expectedRevision: unknown.revision,
        sceneIds: ['scene_1'],
        routes: [route],
        catalogVersion: 'catalog_1',
      })
    ).rejects.toMatchObject({ code: 'duplicate_charge_acknowledgement_required' });
    expect(submissions).toBe(1);

    await expect(
      harness.manager.retryJob({
        projectId: unknown.id,
        jobId: 'job_1',
        expectedRevision: unknown.revision,
      })
    ).rejects.toMatchObject({ code: 'duplicate_charge_acknowledgement_required' });
    expect(submissions).toBe(1);

    const retry = await harness.manager.retryJob({
      projectId: unknown.id,
      jobId: 'job_1',
      expectedRevision: unknown.revision,
      acknowledgePossibleDuplicateCharge: true,
    });

    expect(retry).toMatchObject({
      id: 'job_2',
      idempotencyKey: 'key_2',
      retryOfJobId: 'job_1',
      retryReason: 'submission_unknown',
      duplicateChargeAcknowledged: true,
    });
    expect(retry.duplicateChargeAcknowledgedAt).not.toBeNull();
    expect((await harness.store.getProject(harness.project.id))?.jobs.job_1).toMatchObject({
      status: 'failed',
      error: { code: 'submission_unknown' },
    });
    await waitFor(() => expect(submissions).toBe(2));
    secondSubmission.reject(Object.assign(new Error('provider rejected'), { code: 'no_output' }));
    await waitFor(async () =>
      expect((await harness.store.getProject(harness.project.id))?.jobs.job_2.status).toBe('failed')
    );
  });

  it.each([
    ['provider_unavailable', 'provider_unavailable'],
    ['timeout', 'timeout'],
    ['invalid_response', 'unknown'],
    [null, 'unknown'],
  ] as const)('re-polls the same durable remote task after %s poll uncertainty', async (thrownCode, storedCode) => {
    let outputPath = '';
    let pollCount = 0;
    const submit = vi.fn(async () => ({ kind: 'remote' as const, providerJobId: 'remote_uncertain' }));
    const poll = vi.fn(async (): Promise<ProviderJobSnapshot> => {
      pollCount += 1;
      if (pollCount === 1) {
        const error = new Error('poll transport lost');
        throw thrownCode === null ? error : Object.assign(error, { code: thrownCode });
      }
      return {
        status: 'succeeded',
        outputs: [
          {
            mediaKind: 'image',
            role: 'primary',
            source: { kind: 'file', path: outputPath },
            mimeType: 'image/png',
          },
        ],
      };
    });
    const adapter: GenerationProviderAdapter = {
      id: 'weprompt-image-v1',
      validateConnection: async () => ({ ok: true }),
      validateRequest: (request) => ({
        ok: true,
        normalized: {
          aspectRatio: request.aspectRatio,
          resolution: request.resolution,
          durationSeconds: request.durationSeconds,
        },
      }),
      submit,
      poll,
    };
    const harness = await createHarness(adapter, { sleep: async () => undefined });
    outputPath = path.join(harness.rootDir, 'repolled.png');
    await writeFile(outputPath, png);

    await harness.manager.submitScenes({
      projectId: harness.project.id,
      expectedRevision: harness.project.revision,
      sceneIds: ['scene_1'],
      routes: [route],
      catalogVersion: 'catalog_1',
    });
    await waitFor(async () =>
      expect((await harness.store.getProject(harness.project.id))?.jobs.job_1).toMatchObject({
        status: 'needs_attention',
        providerJobId: 'remote_uncertain',
        error: { code: storedCode },
      })
    );
    const uncertain = (await harness.store.getProject(harness.project.id))!;

    const resumed = await harness.manager.retryJob({
      projectId: uncertain.id,
      jobId: 'job_1',
      expectedRevision: uncertain.revision,
    });

    expect(resumed).toMatchObject({
      id: 'job_1',
      status: 'queued_remote',
      providerJobId: 'remote_uncertain',
    });
    await waitFor(async () =>
      expect((await harness.store.getProject(harness.project.id))?.jobs.job_1.status).toBe('succeeded')
    );
    expect(submit).toHaveBeenCalledOnce();
    expect(poll).toHaveBeenCalledTimes(2);
  });

  it('hands an immediate retry to a successor poll before the uncertain run releases its controller', async () => {
    let outputPath = '';
    let pollCount = 0;
    const submit = vi.fn(async () => ({ kind: 'remote' as const, providerJobId: 'remote_handoff' }));
    const poll = vi.fn(async (): Promise<ProviderJobSnapshot> => {
      pollCount += 1;
      if (pollCount === 1) {
        throw Object.assign(new Error('poll transport lost'), { code: 'provider_unavailable' });
      }
      return {
        status: 'succeeded',
        outputs: [
          {
            mediaKind: 'image',
            role: 'primary',
            source: { kind: 'file', path: outputPath },
            mimeType: 'image/png',
          },
        ],
      };
    });
    const adapter: GenerationProviderAdapter = {
      id: 'weprompt-image-v1',
      validateConnection: async () => ({ ok: true }),
      validateRequest: (request) => ({
        ok: true,
        normalized: {
          aspectRatio: request.aspectRatio,
          resolution: request.resolution,
          durationSeconds: request.durationSeconds,
        },
      }),
      submit,
      poll,
    };
    const harness = await createHarness(adapter, { sleep: async () => undefined });
    outputPath = path.join(harness.rootDir, 'handoff.png');
    await writeFile(outputPath, png);
    const updateProject = harness.store.updateProject.bind(harness.store);
    let heldAttentionTransition = false;
    let retryPromise: ReturnType<StudioJobManager['retryJob']> | null = null;
    vi.spyOn(harness.store, 'updateProject').mockImplementation(async (projectId, mutate, expectedRevision) => {
      const updated = await updateProject(projectId, mutate, expectedRevision);
      const job = updated.jobs.job_1;
      if (!heldAttentionTransition && job?.status === 'needs_attention' && job.providerJobId === 'remote_handoff') {
        heldAttentionTransition = true;
        retryPromise = harness.manager.retryJob({
          projectId: updated.id,
          jobId: job.id,
          expectedRevision: updated.revision,
        });
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      return updated;
    });

    await harness.manager.submitScenes({
      projectId: harness.project.id,
      expectedRevision: harness.project.revision,
      sceneIds: ['scene_1'],
      routes: [route],
      catalogVersion: 'catalog_1',
    });
    await waitFor(() => expect(retryPromise).not.toBeNull());

    await expect(retryPromise!).resolves.toMatchObject({
      id: 'job_1',
      status: 'queued_remote',
      providerJobId: 'remote_handoff',
    });
    await waitFor(async () =>
      expect((await harness.store.getProject(harness.project.id))?.jobs.job_1.status).toBe('succeeded')
    );
    expect(submit).toHaveBeenCalledOnce();
    expect(poll).toHaveBeenCalledTimes(2);
  });

  it('re-polls and persists a failed download without submitting generation again', async () => {
    let outputPath = '';
    const submit = vi.fn();
    const poll = vi.fn(async () => ({
      status: 'succeeded' as const,
      outputs: [
        {
          mediaKind: 'image' as const,
          role: 'primary' as const,
          source: { kind: 'file' as const, path: outputPath },
          mimeType: 'image/png' as const,
        },
      ],
    }));
    const adapter: GenerationProviderAdapter = {
      id: 'weprompt-image-v1',
      validateConnection: async () => ({ ok: true }),
      validateRequest: (request) => ({
        ok: true,
        normalized: {
          aspectRatio: request.aspectRatio,
          resolution: request.resolution,
          durationSeconds: request.durationSeconds,
        },
      }),
      submit,
      poll,
    };
    const harness = await createHarness(adapter);
    outputPath = path.join(harness.rootDir, 'download-retry.png');
    await writeFile(outputPath, png);
    const seeded = await harness.store.updateProject(harness.project.id, (project) => {
      const next = structuredClone(project);
      next.jobs.job_1 = {
        id: 'job_1',
        projectId: project.id,
        sceneId: 'scene_1',
        status: 'failed',
        provider: {
          providerId: route.providerId,
          adapterId: route.adapterId,
          model: route.model,
        },
        idempotencyKey: 'key_1',
        providerJobId: 'remote_1',
        cancellationPolicy: 'queued_only',
        outputAssetIds: [],
        error: {
          code: 'download_failed',
          messageKey: 'conversation.creativeStudio.jobs.errors.downloadFailed',
        },
        retryOfJobId: null,
        retryReason: null,
        duplicateChargeAcknowledged: false,
        duplicateChargeAcknowledgedAt: null,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
      };
      next.scenes.scene_1.jobIds.push('job_1');
      next.scenes.scene_1.reviewState = 'blocked';
      return next;
    });

    const completed = await harness.manager.retryDownload({
      projectId: seeded.id,
      jobId: 'job_1',
      expectedRevision: seeded.revision,
    });

    expect(completed.status).toBe('succeeded');
    expect(submit).not.toHaveBeenCalled();
    expect(poll).toHaveBeenCalledWith(
      'remote_1',
      expect.objectContaining({ use_model: 'image-model' }),
      expect.anything()
    );
    expect((await harness.store.getProject(seeded.id))?.scenes.scene_1.selectedAssetId).toBe(
      completed.outputAssetIds[0]
    );
  });
});

describe('StudioJobManager recovery', () => {
  it('does not reconcile live queued or submitting work owned by the current manager', async () => {
    const selectedProvider: IProvider = {
      ...provider,
      models: ['video-model'],
    };
    const scenes = [
      scene({
        id: 'scene_1',
        mediaKind: 'video',
        durationSeconds: 4,
        visualPrompt: 'First video',
      }),
      scene({
        id: 'scene_2',
        mediaKind: 'video',
        durationSeconds: 4,
        visualPrompt: 'Second video',
      }),
    ];
    const routes: StudioResolvedSceneRouteSnapshot[] = scenes.map((candidate) => ({
      sceneId: candidate.id,
      providerId: selectedProvider.id,
      adapterId: 'weprompt-media-gateway-v1',
      model: 'video-model',
      kind: 'video',
    }));
    const submissions = [deferred<ProviderSubmitResult>(), deferred<ProviderSubmitResult>()];
    const submit = vi.fn(async () => submissions[submit.mock.calls.length - 1]!.promise);
    const adapter: GenerationProviderAdapter = {
      id: 'weprompt-media-gateway-v1',
      validateConnection: async () => ({ ok: true }),
      validateRequest: (request) => ({
        ok: true,
        normalized: {
          aspectRatio: request.aspectRatio,
          resolution: request.resolution,
          durationSeconds: request.durationSeconds,
        },
      }),
      submit,
    };
    const harness = await createHarness(adapter, {
      scenes,
      routes,
      provider: selectedProvider,
      jobIds: ['job_1', 'job_2'],
      idempotencyKeys: ['key_1', 'key_2'],
    });

    await harness.manager.submitScenes({
      projectId: harness.project.id,
      expectedRevision: harness.project.revision,
      sceneIds: ['scene_1', 'scene_2'],
      routes,
      catalogVersion: 'catalog_1',
    });
    await waitFor(() => expect(submit).toHaveBeenCalledOnce());

    await harness.manager.resumePendingJobs();

    expect((await harness.store.getProject(harness.project.id))?.jobs).toMatchObject({
      job_1: { status: 'submitting', error: null },
      job_2: { status: 'queued_local', error: null },
    });
    submissions[0]!.reject(Object.assign(new Error('first provider failure'), { code: 'no_output' }));
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(2));
    submissions[1]!.reject(Object.assign(new Error('second provider failure'), { code: 'no_output' }));
    await waitFor(async () =>
      expect(
        Object.values((await harness.store.getProject(harness.project.id))?.jobs ?? {}).every(
          (job) => job.status === 'failed'
        )
      ).toBe(true)
    );
  });

  it('never auto-submits and resumes only jobs with a known available remote identity', async () => {
    let outputPath = '';
    const submit = vi.fn();
    const poll = vi.fn(async () => ({
      status: 'succeeded' as const,
      outputs: [
        {
          mediaKind: 'image' as const,
          role: 'primary' as const,
          source: { kind: 'file' as const, path: outputPath },
          mimeType: 'image/png' as const,
        },
      ],
    }));
    const adapter: GenerationProviderAdapter = {
      id: 'weprompt-image-v1',
      validateConnection: async () => ({ ok: true }),
      validateRequest: (request) => ({
        ok: true,
        normalized: {
          aspectRatio: request.aspectRatio,
          resolution: request.resolution,
          durationSeconds: request.durationSeconds,
        },
      }),
      submit,
      poll,
    };
    const harness = await createHarness(adapter, { sleep: async () => undefined });
    outputPath = path.join(harness.rootDir, 'recovered.png');
    await writeFile(outputPath, png);
    const timestamp = harness.project.createdAt;
    const baseJob = {
      projectId: harness.project.id,
      sceneId: 'scene_1',
      provider: {
        providerId: provider.id,
        adapterId: 'weprompt-image-v1' as const,
        model: 'image-model',
      },
      outputAssetIds: [],
      cancellationPolicy: 'none',
      error: null,
      retryOfJobId: null,
      retryReason: null,
      duplicateChargeAcknowledged: false,
      duplicateChargeAcknowledgedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await harness.store.updateProject(harness.project.id, (project) => {
      const next = structuredClone(project);
      next.jobs = {
        queued_job: {
          ...baseJob,
          id: 'queued_job',
          status: 'queued_local',
          idempotencyKey: 'key_queued',
          providerJobId: null,
        },
        submitting_job: {
          ...baseJob,
          id: 'submitting_job',
          status: 'submitting',
          idempotencyKey: 'key_submitting',
          providerJobId: null,
        },
        remote_job: {
          ...baseJob,
          id: 'remote_job',
          status: 'queued_remote',
          idempotencyKey: 'key_remote',
          providerJobId: 'remote_known',
        },
        missing_job: {
          ...baseJob,
          id: 'missing_job',
          status: 'queued_remote',
          provider: { ...baseJob.provider, providerId: 'provider_missing' },
          idempotencyKey: 'key_missing',
          providerJobId: 'remote_missing',
        },
      };
      next.scenes.scene_1.jobIds = ['queued_job', 'submitting_job', 'remote_job', 'missing_job'];
      next.scenes.scene_1.reviewState = 'generating';
      return next;
    });

    await harness.manager.resumePendingJobs();

    await waitFor(async () => {
      const project = await harness.store.getProject(harness.project.id);
      expect(project?.jobs.queued_job).toMatchObject({ status: 'failed', error: { code: 'unknown' } });
      expect(project?.jobs.submitting_job).toMatchObject({
        status: 'needs_attention',
        error: { code: 'submission_unknown' },
      });
      expect(project?.jobs.remote_job.status).toBe('succeeded');
      expect(project?.jobs.missing_job).toMatchObject({
        status: 'needs_attention',
        error: { code: 'provider_unavailable' },
      });
    });
    expect(submit).not.toHaveBeenCalled();
    expect(poll).toHaveBeenCalledOnce();
  });

  it('resumes a durable provider-unavailable job after its binding returns', async () => {
    let outputPath = '';
    const submit = vi.fn();
    const poll = vi.fn(async () => ({
      status: 'succeeded' as const,
      outputs: [
        {
          mediaKind: 'image' as const,
          role: 'primary' as const,
          source: { kind: 'file' as const, path: outputPath },
          mimeType: 'image/png' as const,
        },
      ],
    }));
    const adapter: GenerationProviderAdapter = {
      id: 'weprompt-image-v1',
      validateConnection: async () => ({ ok: true }),
      validateRequest: (request) => ({
        ok: true,
        normalized: {
          aspectRatio: request.aspectRatio,
          resolution: request.resolution,
          durationSeconds: request.durationSeconds,
        },
      }),
      submit,
      poll,
    };
    const harness = await createHarness(adapter, { sleep: async () => undefined });
    outputPath = path.join(harness.rootDir, 'returned-provider.png');
    await writeFile(outputPath, png);
    const seeded = await harness.store.updateProject(harness.project.id, (project) => {
      const next = structuredClone(project);
      const baseJob = {
        projectId: project.id,
        sceneId: 'scene_1',
        provider: {
          providerId: route.providerId,
          adapterId: route.adapterId,
          model: route.model,
        },
        outputAssetIds: [],
        cancellationPolicy: 'queued_and_running',
        retryOfJobId: null,
        retryReason: null,
        duplicateChargeAcknowledged: false,
        duplicateChargeAcknowledgedAt: null,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
      };
      next.jobs = {
        recoverable_job: {
          ...baseJob,
          id: 'recoverable_job',
          status: 'needs_attention',
          idempotencyKey: 'key_recoverable',
          providerJobId: 'remote_recoverable',
          error: {
            code: 'provider_unavailable',
            messageKey: 'conversation.creativeStudio.jobs.errors.providerUnavailable',
          },
        },
        unknown_job: {
          ...baseJob,
          id: 'unknown_job',
          status: 'needs_attention',
          idempotencyKey: 'key_unknown',
          providerJobId: null,
          error: {
            code: 'submission_unknown',
            messageKey: 'conversation.creativeStudio.jobs.errors.submissionUnknown',
          },
        },
      };
      next.scenes.scene_1.jobIds = ['recoverable_job', 'unknown_job'];
      next.scenes.scene_1.reviewState = 'blocked';
      return next;
    });

    await harness.manager.resumePendingJobs();

    await waitFor(async () => {
      const project = await harness.store.getProject(seeded.id);
      expect(project?.jobs.recoverable_job.status).toBe('succeeded');
      expect(project?.jobs.unknown_job).toMatchObject({
        status: 'needs_attention',
        providerJobId: null,
        error: { code: 'submission_unknown' },
      });
    });
    expect(submit).not.toHaveBeenCalled();
    expect(poll).toHaveBeenCalledOnce();
  });
});

describe('StudioJobManager disposal fencing', () => {
  it('awaits an admitted submit and prevents persistence or provider calls after disposal begins', async () => {
    const catalogStarted = deferred<void>();
    const catalogGate = deferred<StudioGenerationRouteCatalog>();
    const submit = vi.fn();
    const adapter: GenerationProviderAdapter = {
      id: 'weprompt-image-v1',
      validateConnection: async () => ({ ok: true }),
      validateRequest: (request) => ({
        ok: true,
        normalized: {
          aspectRatio: request.aspectRatio,
          resolution: request.resolution,
          durationSeconds: request.durationSeconds,
        },
      }),
      submit,
    };
    const harness = await createHarness(adapter, {
      catalog: async () => {
        catalogStarted.resolve(undefined);
        return catalogGate.promise;
      },
    });
    const submission = harness.manager.submitScenes({
      projectId: harness.project.id,
      expectedRevision: harness.project.revision,
      sceneIds: ['scene_1'],
      routes: [route],
      catalogVersion: 'catalog_1',
    });
    await catalogStarted.promise;

    const disposal = harness.manager.dispose();
    catalogGate.resolve(catalog());

    await expect(submission).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(disposal).resolves.toBeUndefined();
    expect(submit).not.toHaveBeenCalled();
    expect((await harness.store.getProject(harness.project.id))?.jobs).toEqual({});
  });

  it('prevents a delayed cancellation from starting provider I/O after disposal begins', async () => {
    const cancel = vi.fn();
    const adapter: GenerationProviderAdapter = {
      id: 'weprompt-image-v1',
      validateConnection: async () => ({ ok: true }),
      validateRequest: (request) => ({
        ok: true,
        normalized: {
          aspectRatio: request.aspectRatio,
          resolution: request.resolution,
          durationSeconds: request.durationSeconds,
        },
      }),
      submit: vi.fn(),
      cancel,
    };
    const harness = await createHarness(adapter);
    const queued = await harness.store.updateProject(harness.project.id, (project) => {
      const next = structuredClone(project);
      next.jobs.job_1 = {
        id: 'job_1',
        projectId: project.id,
        sceneId: 'scene_1',
        status: 'queued_remote',
        provider: {
          providerId: route.providerId,
          adapterId: route.adapterId,
          model: route.model,
        },
        idempotencyKey: 'key_1',
        providerJobId: 'remote_1',
        cancellationPolicy: 'queued_only',
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
    const projectRead = deferred<StudioProject | null>();
    const readStarted = deferred<void>();
    vi.spyOn(harness.store, 'getProject').mockImplementationOnce(async () => {
      readStarted.resolve(undefined);
      return projectRead.promise;
    });
    const cancellation = harness.manager.cancelJob({
      projectId: queued.id,
      jobId: 'job_1',
      expectedRevision: queued.revision,
    });
    await readStarted.promise;

    const disposal = harness.manager.dispose();
    projectRead.resolve(queued);

    await expect(cancellation).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(disposal).resolves.toBeUndefined();
    expect(cancel).not.toHaveBeenCalled();
  });
});

describe('StudioJobManager output download budgets', () => {
  const videoProvider: IProvider = {
    ...provider,
    name: 'Video provider',
    models: ['video-model'],
  };
  const videoRoute: StudioResolvedSceneRouteSnapshot = {
    sceneId: 'scene_1',
    providerId: videoProvider.id,
    adapterId: 'weprompt-media-gateway-v1',
    model: 'video-model',
    kind: 'video',
  };
  const videoScene = (): StudioScene => scene({ mediaKind: 'video', durationSeconds: 5 });

  it('passes a size-scaled budget to a known-size primary download', async () => {
    const outputDownloader = createRemoteOutputDownloader(mp4, 'video/mp4');
    const adapter = completeAdapter('weprompt-media-gateway-v1', () => [
      {
        mediaKind: 'video',
        role: 'primary',
        source: { kind: 'url', url: 'https://cdn.example/video.mp4' },
        mimeType: 'video/mp4',
        byteSize: 512 * 1024 * 1024,
      },
    ]);
    const harness = await createHarness(adapter, {
      scenes: [videoScene()],
      routes: [videoRoute],
      provider: videoProvider,
      outputDownloader,
    });

    await harness.manager.submitScenes({
      projectId: harness.project.id,
      expectedRevision: harness.project.revision,
      sceneIds: ['scene_1'],
      routes: [videoRoute],
      catalogVersion: 'catalog_1',
    });

    await waitFor(() => expect(outputDownloader).toHaveBeenCalledOnce());
    expect(outputDownloader.mock.calls[0]?.[3]).toEqual({ timeoutMs: 1_144_000 });
  });

  it('passes the video fallback budget to an unknown-size primary download', async () => {
    const outputDownloader = createRemoteOutputDownloader(mp4, 'video/mp4');
    const adapter = completeAdapter('weprompt-media-gateway-v1', () => [
      {
        mediaKind: 'video',
        role: 'primary',
        source: { kind: 'url', url: 'https://cdn.example/video.mp4' },
        mimeType: 'video/mp4',
      },
    ]);
    const harness = await createHarness(adapter, {
      scenes: [videoScene()],
      routes: [videoRoute],
      provider: videoProvider,
      outputDownloader,
    });

    await harness.manager.submitScenes({
      projectId: harness.project.id,
      expectedRevision: harness.project.revision,
      sceneIds: ['scene_1'],
      routes: [videoRoute],
      catalogVersion: 'catalog_1',
    });

    await waitFor(async () =>
      expect((await harness.store.getProject(harness.project.id))?.jobs.job_1.status).toBe('succeeded')
    );
    expect(outputDownloader.mock.calls[0]?.[3]).toEqual({ timeoutMs: 900_000 });
  });

  it('resolves a poster budget from the poster image instead of its primary video', async () => {
    let primaryPath = '';
    const outputDownloader = createRemoteOutputDownloader(png, 'image/png');
    const adapter = completeAdapter('weprompt-media-gateway-v1', () => [
      {
        mediaKind: 'video',
        role: 'primary',
        source: { kind: 'file', path: primaryPath },
        mimeType: 'video/mp4',
      },
      {
        mediaKind: 'image',
        role: 'poster',
        source: { kind: 'url', url: 'https://cdn.example/poster.png' },
        mimeType: 'image/png',
      },
    ]);
    const harness = await createHarness(adapter, {
      scenes: [videoScene()],
      routes: [videoRoute],
      provider: videoProvider,
      outputDownloader,
    });
    primaryPath = path.join(harness.rootDir, 'primary-with-remote-poster.mp4');
    await writeFile(primaryPath, mp4);

    await harness.manager.submitScenes({
      projectId: harness.project.id,
      expectedRevision: harness.project.revision,
      sceneIds: ['scene_1'],
      routes: [videoRoute],
      catalogVersion: 'catalog_1',
    });

    await waitFor(() => expect(outputDownloader).toHaveBeenCalledOnce());
    expect(outputDownloader.mock.calls[0]?.[3]).toEqual({ timeoutMs: 120_000 });
  });

  it('passes a freshly resolved budget through retry download', async () => {
    const outputDownloader = createRemoteOutputDownloader(png, 'image/png');
    const poll = vi.fn(
      async (): Promise<ProviderJobSnapshot> => ({
        status: 'succeeded',
        outputs: [
          {
            mediaKind: 'image',
            role: 'primary',
            source: { kind: 'url', url: 'https://cdn.example/retry.png' },
            mimeType: 'image/png',
            byteSize: png.length,
          },
        ],
      })
    );
    const adapter: GenerationProviderAdapter = {
      ...completeAdapter('weprompt-image-v1', []),
      poll,
    };
    const harness = await createHarness(adapter, { outputDownloader });
    const seeded = await harness.store.updateProject(harness.project.id, (project) => {
      const next = structuredClone(project);
      next.jobs.job_1 = {
        id: 'job_1',
        projectId: project.id,
        sceneId: 'scene_1',
        status: 'failed',
        provider: {
          providerId: route.providerId,
          adapterId: route.adapterId,
          model: route.model,
        },
        idempotencyKey: 'key_1',
        providerJobId: 'remote_1',
        remoteStartedAt: project.createdAt,
        cancellationPolicy: 'none',
        outputAssetIds: [],
        error: {
          code: 'download_failed',
          messageKey: 'conversation.creativeStudio.jobs.errors.downloadFailed',
        },
        retryOfJobId: null,
        retryReason: null,
        duplicateChargeAcknowledged: false,
        duplicateChargeAcknowledgedAt: null,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
      };
      next.scenes.scene_1.jobIds.push('job_1');
      next.scenes.scene_1.reviewState = 'blocked';
      return next;
    });

    await expect(
      harness.manager.retryDownload({ projectId: seeded.id, jobId: 'job_1', expectedRevision: seeded.revision })
    ).resolves.toMatchObject({ status: 'succeeded' });
    expect(outputDownloader.mock.calls[0]?.[3]).toEqual({ timeoutMs: 121_000 });
  });

  it('forwards the resolved whole-download budget while retaining a 120-second transport inactivity guard', async () => {
    let capturedDownloader:
      | Parameters<StudioMediaStore['persistProviderOutputFromUrlForJob']>[0]['downloader']
      | undefined;
    const adapter = completeAdapter('weprompt-media-gateway-v1', [
      {
        mediaKind: 'video',
        role: 'primary',
        source: { kind: 'url', url: 'https://cdn.example/video.mp4' },
        mimeType: 'video/mp4',
        byteSize: 512 * 1024 * 1024,
      },
    ]);
    const harness = await createHarness(adapter, {
      scenes: [videoScene()],
      routes: [videoRoute],
      provider: videoProvider,
      decorateMediaStore: (mediaStore) => ({
        ...mediaStore,
        persistProviderOutputFromUrlForJob: async (input) => {
          capturedDownloader = input.downloader;
          throw new Error('stop after observing downloader');
        },
      }),
    });

    await harness.manager.submitScenes({
      projectId: harness.project.id,
      expectedRevision: harness.project.revision,
      sceneIds: ['scene_1'],
      routes: [videoRoute],
      catalogVersion: 'catalog_1',
    });
    await waitFor(() => expect(capturedDownloader).toBeDefined());
    if (!capturedDownloader) throw new Error('downloader was not captured');
    expect(capturedDownloader.timeoutMs).toBe(1_144_000);

    const request = Object.assign(new EventEmitter(), {
      setTimeout: vi.fn(),
      end: vi.fn(),
    });
    request.end.mockImplementation(() => request.emit('error', new Error('stop transport')));
    const requestSpy = vi
      .spyOn(https, 'request')
      .mockReturnValue(request as unknown as ReturnType<typeof https.request>);
    try {
      await expect(
        capturedDownloader.request({
          url: new URL('https://cdn.example/video.mp4'),
          hostname: 'cdn.example',
          port: 443,
          address: '8.8.8.8',
          family: 4,
        })
      ).rejects.toMatchObject({ code: 'remote_download_failed' });
      expect(request.setTimeout).toHaveBeenCalledWith(120_000, expect.any(Function));
    } finally {
      requestSpy.mockRestore();
    }
  });

  it('attaches the OpenRouter bearer to its exact output host through the hardened downloader', async () => {
    let capturedDownloader:
      | Parameters<StudioMediaStore['persistProviderOutputFromUrlForJob']>[0]['downloader']
      | undefined;
    const openRouterProvider: IProvider = {
      ...videoProvider,
      base_url: 'https://openrouter.ai/api/v1',
      api_key: 'sk-or-test',
      models: ['bytedance/seedance-2.0-fast'],
    };
    const openRouterRoute: StudioResolvedSceneRouteSnapshot = {
      ...videoRoute,
      adapterId: 'openrouter-video-v1',
      model: 'bytedance/seedance-2.0-fast',
    };
    const adapter = completeAdapter('openrouter-video-v1', [
      {
        mediaKind: 'video',
        role: 'primary',
        source: { kind: 'url', url: 'https://openrouter.ai/api/v1/videos/job_1/content' },
        mimeType: 'video/mp4',
      },
    ]);
    const harness = await createHarness(adapter, {
      scenes: [videoScene()],
      routes: [openRouterRoute],
      provider: openRouterProvider,
      decorateMediaStore: (mediaStore) => ({
        ...mediaStore,
        persistProviderOutputFromUrlForJob: async (input) => {
          capturedDownloader = input.downloader;
          throw new Error('stop after observing downloader');
        },
      }),
    });

    await harness.manager.submitScenes({
      projectId: harness.project.id,
      expectedRevision: harness.project.revision,
      sceneIds: ['scene_1'],
      routes: [openRouterRoute],
      catalogVersion: 'catalog_1',
    });
    await waitFor(() => expect(capturedDownloader).toBeDefined());
    if (!capturedDownloader) throw new Error('downloader was not captured');

    const request = Object.assign(new EventEmitter(), {
      setTimeout: vi.fn(),
      end: vi.fn(),
    });
    request.end.mockImplementation(() => request.emit('error', new Error('stop transport')));
    let authorization: unknown;
    const requestSpy = vi.spyOn(https, 'request').mockImplementation(((options: unknown) => {
      authorization = (options as { headers?: Record<string, unknown> }).headers?.Authorization;
      return request as unknown as ReturnType<typeof https.request>;
    }) as typeof https.request);
    try {
      await expect(
        capturedDownloader.request({
          url: new URL('https://openrouter.ai/api/v1/videos/job_1/content'),
          hostname: 'openrouter.ai',
          port: 443,
          address: '8.8.8.8',
          family: 4,
        })
      ).rejects.toMatchObject({ code: 'remote_download_failed' });
      expect(authorization).toBe('Bearer sk-or-test');
    } finally {
      requestSpy.mockRestore();
    }
  });

  it('does not construct a downloader for local primary or poster outputs', async () => {
    let primaryPath = '';
    let posterPath = '';
    const outputDownloader = createRemoteOutputDownloader(png, 'image/png');
    const adapter = completeAdapter('weprompt-media-gateway-v1', () => [
      {
        mediaKind: 'video',
        role: 'primary',
        source: { kind: 'file', path: primaryPath },
        mimeType: 'video/mp4',
      },
      {
        mediaKind: 'image',
        role: 'poster',
        source: { kind: 'file', path: posterPath },
        mimeType: 'image/png',
      },
    ]);
    const harness = await createHarness(adapter, {
      scenes: [videoScene()],
      routes: [videoRoute],
      provider: videoProvider,
      outputDownloader,
    });
    primaryPath = path.join(harness.rootDir, 'local-output.mp4');
    posterPath = path.join(harness.rootDir, 'local-poster.png');
    await Promise.all([writeFile(primaryPath, mp4), writeFile(posterPath, png)]);

    await harness.manager.submitScenes({
      projectId: harness.project.id,
      expectedRevision: harness.project.revision,
      sceneIds: ['scene_1'],
      routes: [videoRoute],
      catalogVersion: 'catalog_1',
    });

    await waitFor(async () =>
      expect((await harness.store.getProject(harness.project.id))?.jobs.job_1.outputAssetIds).toHaveLength(2)
    );
    expect(outputDownloader).not.toHaveBeenCalled();
  });
});

describe('StudioJobManager video poster outputs', () => {
  const videoProvider: IProvider = {
    ...provider,
    name: 'Video provider',
    models: ['video-model'],
  };
  const videoRoute: StudioResolvedSceneRouteSnapshot = {
    sceneId: 'scene_1',
    providerId: videoProvider.id,
    adapterId: 'weprompt-media-gateway-v1',
    model: 'video-model',
    kind: 'video',
  };
  const videoScene = (): StudioScene => scene({ mediaKind: 'video', durationSeconds: 5 });

  it('persists a single provider poster beside the selected primary video', async () => {
    let primaryPath = '';
    let posterPath = '';
    const adapter: GenerationProviderAdapter = {
      id: 'weprompt-media-gateway-v1',
      validateConnection: async () => ({ ok: true }),
      validateRequest: (request) => ({
        ok: true,
        normalized: {
          aspectRatio: request.aspectRatio,
          resolution: request.resolution,
          durationSeconds: request.durationSeconds,
        },
      }),
      submit: async () => ({
        kind: 'complete',
        outputs: [
          {
            mediaKind: 'video',
            role: 'primary',
            source: { kind: 'file', path: primaryPath },
            mimeType: 'video/mp4',
          },
          {
            mediaKind: 'image',
            role: 'poster',
            source: { kind: 'file', path: posterPath },
            mimeType: 'image/png',
          },
        ],
      }),
    };
    const harness = await createHarness(adapter, {
      scenes: [videoScene()],
      routes: [videoRoute],
      provider: videoProvider,
    });
    primaryPath = path.join(harness.rootDir, 'primary.mp4');
    posterPath = path.join(harness.rootDir, 'poster.png');
    await Promise.all([writeFile(primaryPath, mp4), writeFile(posterPath, png)]);

    await harness.manager.submitScenes({
      projectId: harness.project.id,
      expectedRevision: harness.project.revision,
      sceneIds: ['scene_1'],
      routes: [videoRoute],
      catalogVersion: 'catalog_1',
    });

    await waitFor(async () =>
      expect((await harness.store.getProject(harness.project.id))?.jobs.job_1.outputAssetIds).toHaveLength(2)
    );
    const project = (await harness.store.getProject(harness.project.id))!;
    const [primaryAssetId, posterAssetId] = project.jobs.job_1.outputAssetIds;
    expect(project.jobs.job_1.status).toBe('succeeded');
    expect(project.scenes.scene_1).toMatchObject({
      assetIds: [primaryAssetId, posterAssetId],
      selectedAssetId: primaryAssetId,
      reviewState: 'complete',
    });
    expect(project.assets[primaryAssetId!]).toMatchObject({
      mediaKind: 'video',
      managedAsset: { collection: 'assets' },
    });
    expect(project.assets[posterAssetId!]).toMatchObject({
      mediaKind: 'image',
      managedAsset: { collection: 'thumbnails' },
    });
    expect(JSON.stringify(project)).not.toContain(primaryPath);
    expect(JSON.stringify(project)).not.toContain(posterPath);
  });

  it('releases the video generation slot after primary success while an optional poster is still persisting', async () => {
    let firstPrimaryPath = '';
    let secondPrimaryPath = '';
    let posterPath = '';
    let submission = 0;
    const posterStarted = deferred<void>();
    const releasePoster = deferred<void>();
    const adapter: GenerationProviderAdapter = {
      id: 'weprompt-media-gateway-v1',
      validateConnection: async () => ({ ok: true }),
      validateRequest: (request) => ({
        ok: true,
        normalized: {
          aspectRatio: request.aspectRatio,
          resolution: request.resolution,
          durationSeconds: request.durationSeconds,
        },
      }),
      submit: vi.fn(async () => {
        submission += 1;
        return {
          kind: 'complete' as const,
          outputs:
            submission === 1
              ? [
                  {
                    mediaKind: 'video' as const,
                    role: 'primary' as const,
                    source: { kind: 'file' as const, path: firstPrimaryPath },
                    mimeType: 'video/mp4',
                  },
                  {
                    mediaKind: 'image' as const,
                    role: 'poster' as const,
                    source: { kind: 'file' as const, path: posterPath },
                    mimeType: 'image/png',
                  },
                ]
              : [
                  {
                    mediaKind: 'video' as const,
                    role: 'primary' as const,
                    source: { kind: 'file' as const, path: secondPrimaryPath },
                    mimeType: 'video/mp4',
                  },
                ],
        };
      }),
    };
    const secondScene = videoScene();
    secondScene.id = 'scene_2';
    secondScene.title = 'Closing';
    const secondRoute = { ...videoRoute, sceneId: secondScene.id };
    const harness = await createHarness(adapter, {
      scenes: [videoScene(), secondScene],
      routes: [videoRoute, secondRoute],
      provider: videoProvider,
      jobIds: ['job_1', 'job_2'],
      idempotencyKeys: ['key_1', 'key_2'],
      decorateMediaStore: (mediaStore) => ({
        ...mediaStore,
        persistProviderPosterForJob: async (input) => {
          posterStarted.resolve(undefined);
          await releasePoster.promise;
          return mediaStore.persistProviderPosterForJob(input);
        },
      }),
    });
    firstPrimaryPath = path.join(harness.rootDir, 'primary-one.mp4');
    secondPrimaryPath = path.join(harness.rootDir, 'primary-two.mp4');
    posterPath = path.join(harness.rootDir, 'slow-poster.png');
    await Promise.all([
      writeFile(firstPrimaryPath, mp4),
      writeFile(secondPrimaryPath, mp4),
      writeFile(posterPath, png),
    ]);

    await harness.manager.submitScenes({
      projectId: harness.project.id,
      expectedRevision: harness.project.revision,
      sceneIds: ['scene_1', 'scene_2'],
      routes: [videoRoute, secondRoute],
      catalogVersion: 'catalog_1',
    });

    await posterStarted.promise;
    await waitFor(async () => {
      const project = await harness.store.getProject(harness.project.id);
      expect(project?.jobs.job_1.status).toBe('succeeded');
      expect(adapter.submit).toHaveBeenCalledTimes(2);
      expect(project?.jobs.job_2.status).toBe('succeeded');
    });

    releasePoster.resolve(undefined);
    await waitFor(async () =>
      expect((await harness.store.getProject(harness.project.id))?.jobs.job_1.outputAssetIds).toHaveLength(2)
    );
  });

  it('keeps a successful primary video when the provider omits its poster', async () => {
    let primaryPath = '';
    const adapter: GenerationProviderAdapter = {
      id: 'weprompt-media-gateway-v1',
      validateConnection: async () => ({ ok: true }),
      validateRequest: (request) => ({
        ok: true,
        normalized: {
          aspectRatio: request.aspectRatio,
          resolution: request.resolution,
          durationSeconds: request.durationSeconds,
        },
      }),
      submit: async () => ({
        kind: 'complete',
        outputs: [
          {
            mediaKind: 'video',
            role: 'primary',
            source: { kind: 'file', path: primaryPath },
            mimeType: 'video/mp4',
          },
        ],
      }),
    };
    const harness = await createHarness(adapter, {
      scenes: [videoScene()],
      routes: [videoRoute],
      provider: videoProvider,
    });
    primaryPath = path.join(harness.rootDir, 'primary-only.mp4');
    await writeFile(primaryPath, mp4);

    await harness.manager.submitScenes({
      projectId: harness.project.id,
      expectedRevision: harness.project.revision,
      sceneIds: ['scene_1'],
      routes: [videoRoute],
      catalogVersion: 'catalog_1',
    });

    await waitFor(async () =>
      expect((await harness.store.getProject(harness.project.id))?.jobs.job_1.status).toBe('succeeded')
    );
    const project = (await harness.store.getProject(harness.project.id))!;
    expect(project.jobs.job_1.outputAssetIds).toHaveLength(1);
    expect(project.scenes.scene_1.selectedAssetId).toBe(project.jobs.job_1.outputAssetIds[0]);
  });

  it('keeps a successful primary video when poster persistence fails', async () => {
    let primaryPath = '';
    const adapter: GenerationProviderAdapter = {
      id: 'weprompt-media-gateway-v1',
      validateConnection: async () => ({ ok: true }),
      validateRequest: (request) => ({
        ok: true,
        normalized: {
          aspectRatio: request.aspectRatio,
          resolution: request.resolution,
          durationSeconds: request.durationSeconds,
        },
      }),
      submit: async () => ({
        kind: 'complete',
        outputs: [
          {
            mediaKind: 'video',
            role: 'primary',
            source: { kind: 'file', path: primaryPath },
            mimeType: 'video/mp4',
          },
          {
            mediaKind: 'image',
            role: 'poster',
            source: { kind: 'file', path: path.join(path.dirname(primaryPath), 'missing-poster.png') },
            mimeType: 'image/png',
          },
        ],
      }),
    };
    const harness = await createHarness(adapter, {
      scenes: [videoScene()],
      routes: [videoRoute],
      provider: videoProvider,
    });
    primaryPath = path.join(harness.rootDir, 'primary-with-missing-poster.mp4');
    await writeFile(primaryPath, mp4);

    await harness.manager.submitScenes({
      projectId: harness.project.id,
      expectedRevision: harness.project.revision,
      sceneIds: ['scene_1'],
      routes: [videoRoute],
      catalogVersion: 'catalog_1',
    });

    await waitFor(async () =>
      expect((await harness.store.getProject(harness.project.id))?.jobs.job_1.status).toBe('succeeded')
    );
    const project = (await harness.store.getProject(harness.project.id))!;
    expect(project.jobs.job_1).toMatchObject({ status: 'succeeded', error: null });
    expect(project.jobs.job_1.outputAssetIds).toHaveLength(1);
    expect(project.scenes.scene_1.selectedAssetId).toBe(project.jobs.job_1.outputAssetIds[0]);
  });
});

describe('StudioJobManager provider failures', () => {
  it.each(['auth', 'quota', 'rate_limited', 'no_output', 'unsupported'] as const)(
    'persists only the sanitized %s provider error',
    async (code) => {
      const adapter: GenerationProviderAdapter = {
        id: 'weprompt-image-v1',
        validateConnection: async () => ({ ok: true }),
        validateRequest: (request) => ({
          ok: true,
          normalized: {
            aspectRatio: request.aspectRatio,
            resolution: request.resolution,
            durationSeconds: request.durationSeconds,
          },
        }),
        submit: async () => {
          throw Object.assign(new Error('secret provider response body'), { code });
        },
      };
      const harness = await createHarness(adapter);

      await harness.manager.submitScenes({
        projectId: harness.project.id,
        expectedRevision: harness.project.revision,
        sceneIds: ['scene_1'],
        routes: [route],
        catalogVersion: 'catalog_1',
      });

      await waitFor(async () =>
        expect((await harness.store.getProject(harness.project.id))?.jobs.job_1).toMatchObject({
          status: 'failed',
          error: { code },
        })
      );
      expect(JSON.stringify(await harness.store.getProject(harness.project.id))).not.toContain(
        'secret provider response body'
      );
    }
  );

  it.each(['timeout', 'provider_unavailable', 'submission_unknown', 'unknown'] as const)(
    'treats submit-time %s as ambiguous and requires duplicate-charge acknowledgement',
    async (code) => {
      const adapter: GenerationProviderAdapter = {
        id: 'weprompt-image-v1',
        validateConnection: async () => ({ ok: true }),
        validateRequest: (request) => ({
          ok: true,
          normalized: {
            aspectRatio: request.aspectRatio,
            resolution: request.resolution,
            durationSeconds: request.durationSeconds,
          },
        }),
        submit: async () => {
          throw Object.assign(new Error('ambiguous submit'), { code });
        },
      };
      const harness = await createHarness(adapter);
      await harness.manager.submitScenes({
        projectId: harness.project.id,
        expectedRevision: harness.project.revision,
        sceneIds: ['scene_1'],
        routes: [route],
        catalogVersion: 'catalog_1',
      });
      await waitFor(async () =>
        expect((await harness.store.getProject(harness.project.id))?.jobs.job_1).toMatchObject({
          status: 'needs_attention',
          error: { code: 'submission_unknown' },
        })
      );
      const current = (await harness.store.getProject(harness.project.id))!;

      await expect(
        harness.manager.retryJob({
          projectId: current.id,
          jobId: 'job_1',
          expectedRevision: current.revision,
        })
      ).rejects.toMatchObject({ code: 'duplicate_charge_acknowledgement_required' });
    }
  );

  it('marks provider success with unusable local output as download_failed', async () => {
    const adapter: GenerationProviderAdapter = {
      id: 'weprompt-image-v1',
      validateConnection: async () => ({ ok: true }),
      validateRequest: (request) => ({
        ok: true,
        normalized: {
          aspectRatio: request.aspectRatio,
          resolution: request.resolution,
          durationSeconds: request.durationSeconds,
        },
      }),
      submit: async () => ({
        kind: 'complete',
        outputs: [
          {
            mediaKind: 'image',
            role: 'primary',
            source: { kind: 'file', path: '/definitely/missing/studio-output.png' },
            mimeType: 'image/png',
          },
        ],
      }),
    };
    const harness = await createHarness(adapter);

    await harness.manager.submitScenes({
      projectId: harness.project.id,
      expectedRevision: harness.project.revision,
      sceneIds: ['scene_1'],
      routes: [route],
      catalogVersion: 'catalog_1',
    });

    await waitFor(async () =>
      expect((await harness.store.getProject(harness.project.id))?.jobs.job_1).toMatchObject({
        status: 'failed',
        error: { code: 'download_failed' },
        outputAssetIds: [],
      })
    );
  });
});

describe('StudioJobManager pinned rule gate', () => {
  // Same shape as the file's other local adapter helpers (:1365-1377, :1670-1682): the id must be
  // 'weprompt-image-v1' because that is what `route` resolves to.
  const adapterWithSubmit = (submit: ReturnType<typeof vi.fn>): GenerationProviderAdapter => ({
    id: 'weprompt-image-v1',
    validateConnection: async () => ({ ok: true }),
    validateRequest: (request) => ({
      ok: true,
      normalized: {
        aspectRatio: request.aspectRatio,
        resolution: request.resolution,
        durationSeconds: request.durationSeconds,
      },
    }),
    submit,
  });

  const enforcedRule: StudioBriefRule = {
    id: 'rule_1',
    scope: 'project',
    text: 'No competitor logos.',
    predicate: { kind: 'forbidden_terms', terms: ['acme'] },
    createdAt: '2026-08-13T00:00:00.000Z',
  };

  const nonmatchingRule: StudioBriefRule = {
    id: 'rule_2',
    scope: 'project',
    text: 'No horses.',
    predicate: { kind: 'forbidden_terms', terms: ['horse'] },
    createdAt: '2026-08-13T00:00:00.000Z',
  };

  /** Pins rules the only way anything pins them: through the store, which bumps the revision. */
  const withRules = (harness: Harness, rules: StudioBriefRule[]): Promise<StudioProject> =>
    harness.store.updateProject(harness.project.id, (current) => ({ ...current, rules }));

  it('refuses a submission whose visual prompt breaks an enforced rule, before anything is spent', async () => {
    const submit = vi.fn();
    const harness = await createHarness(adapterWithSubmit(submit), {
      scenes: [scene({ visualPrompt: 'An ACME billboard at dusk' })],
    });
    const guarded = await withRules(harness, [enforcedRule, nonmatchingRule]);

    await expect(
      harness.manager.submitScenes({
        projectId: guarded.id,
        expectedRevision: guarded.revision,
        sceneIds: ['scene_1'],
        routes: [route],
        catalogVersion: 'catalog_1',
      })
    ).rejects.toMatchObject({ code: 'rule_breach' });

    expect(submit).not.toHaveBeenCalled();
    // The gate sits before persistPreparedJobs (:1300) and trackRun (:1302), so the refusal leaves
    // no job record and no scene linkage behind either.
    const after = (await harness.store.getProject(guarded.id))!;
    expect(Object.keys(after.jobs)).toEqual([]);
    expect(after.scenes.scene_1.jobIds).toEqual([]);
  });

  it('refuses a reference plate whose own prompt breaks a rule, which the durable record never holds', async () => {
    const submit = vi.fn();
    const harness = await createHarness(adapterWithSubmit(submit), {
      scenes: [scene({ visualPrompt: 'A clean studio plate' })],
    });
    const guarded = await withRules(harness, [enforcedRule]);

    await expect(
      harness.manager.submitScenes({
        projectId: guarded.id,
        expectedRevision: guarded.revision,
        sceneIds: ['scene_1'],
        routes: [route],
        catalogVersion: 'catalog_1',
        outputRole: 'reference',
        referencePrompts: [{ sceneId: 'scene_1', prompt: 'An ACME logo, centred' }],
      })
    ).rejects.toMatchObject({ code: 'rule_breach' });

    expect(submit).not.toHaveBeenCalled();
    // This is the test that justifies the gate's placement: scene.visualPrompt is clean, the breach
    // exists only in baseRequest.prompt, and a store-side check would wave this through.
    expect((await harness.store.getProject(guarded.id))!.scenes.scene_1.visualPrompt).toBe('A clean studio plate');
  });

  it('refuses a retry that would resend a breaching prompt', async () => {
    const submit = vi.fn();
    const harness = await createHarness(adapterWithSubmit(submit), {
      scenes: [scene({ visualPrompt: 'An ACME billboard at dusk' })],
      jobIds: ['job_2'],
      idempotencyKeys: ['key_2'],
    });
    // Seeded exactly as the file's other retry tests do (:4001-4028): a failed job written straight
    // onto the record, plus the rule pinned in the same write. That is the real sequence — the user
    // reads the failure, pins the rule, and only then presses Retry.
    const failed = await harness.store.updateProject(harness.project.id, (project) => {
      const next = structuredClone(project);
      next.jobs.job_1 = {
        id: 'job_1',
        projectId: project.id,
        sceneId: 'scene_1',
        status: 'failed',
        provider: selectionFor(route),
        idempotencyKey: 'key_1',
        providerJobId: null,
        cancellationPolicy: 'none',
        outputAssetIds: [],
        error: { code: 'no_output', messageKey: 'conversation.creativeStudio.jobs.errors.noOutput' },
        retryOfJobId: null,
        retryReason: null,
        duplicateChargeAcknowledged: false,
        duplicateChargeAcknowledgedAt: null,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
      };
      next.scenes.scene_1.jobIds.push('job_1');
      next.scenes.scene_1.reviewState = 'blocked';
      next.rules = [enforcedRule];
      return next;
    });

    await expect(
      harness.manager.retryJob({ projectId: failed.id, jobId: 'job_1', expectedRevision: failed.revision })
    ).rejects.toMatchObject({ code: 'rule_breach' });

    expect(submit).not.toHaveBeenCalled();
    expect((await harness.store.getProject(failed.id))!.jobs.job_2).toBeUndefined();
  });

  it('lets a visual prompt through when an enforced rule does not match', async () => {
    const submit = vi.fn(async () => ({ kind: 'complete' as const, outputs: [] }));
    const harness = await createHarness(adapterWithSubmit(submit), {
      scenes: [scene({ visualPrompt: 'A generic kit on a plain background' })],
    });
    const guarded = await withRules(harness, [enforcedRule]);

    const [job] = await harness.manager.submitScenes({
      projectId: guarded.id,
      expectedRevision: guarded.revision,
      sceneIds: ['scene_1'],
      routes: [route],
      catalogVersion: 'catalog_1',
    });

    expect(job).toMatchObject({ id: 'job_1', sceneId: 'scene_1' });
    expect((await harness.store.getProject(guarded.id))!.jobs.job_1).toBeDefined();
    await waitFor(() => expect(submit).toHaveBeenCalledOnce());
  });

  it('lets a reference plate through when only the app-authored prefix matches an enforced rule', async () => {
    const submit = vi.fn(async () => ({ kind: 'complete' as const, outputs: [] }));
    const subject = 'A red bicycle leaning on a wall at dawn';
    const harness = await createHarness(adapterWithSubmit(submit), {
      scenes: [scene({ visualPrompt: subject })],
    });
    const guarded = await withRules(harness, [
      {
        id: 'rule_1',
        scope: 'project',
        text: 'No on-screen text.',
        predicate: { kind: 'forbidden_terms', terms: ['text'] },
        createdAt: '2026-08-13T00:00:00.000Z',
      },
    ]);

    const [job] = await harness.manager.submitScenes({
      projectId: guarded.id,
      expectedRevision: guarded.revision,
      sceneIds: ['scene_1'],
      routes: [route],
      catalogVersion: 'catalog_1',
      outputRole: 'reference',
      referencePrompts: [{ sceneId: 'scene_1', prompt: buildFirstFramePrompt(subject, guarded.aspectRatio) }],
    });

    expect(job).toMatchObject({ id: 'job_1', sceneId: 'scene_1', outputRole: 'reference' });
    await waitFor(() => expect(submit).toHaveBeenCalledOnce());
  });

  it('evaluates only the authored subject before adding conditioning-role instructions', async () => {
    const submit = vi.fn(async () => ({ kind: 'complete' as const, outputs: [] }));
    const harness = await createHarness(adapterWithSubmit(submit), {
      catalog: async () => {
        const built = catalog();
        built.routes[0]!.constraints.maxConditioningImages = 6;
        return built;
      },
    });
    const sourcePath = path.join(harness.rootDir, 'Hero headshot.png');
    await writeFile(sourcePath, png);
    await harness.mediaStore.importReferenceFromPath({
      projectId: harness.project.id,
      briefReferenceRole: 'cast',
      sourcePath,
      expectedRevision: harness.project.revision,
    });
    const current = (await harness.store.getProject(harness.project.id))!;
    const guarded = await harness.store.updateProject(current.id, (project) => ({
      ...project,
      rules: [
        {
          id: 'rule_instruction',
          scope: 'project',
          text: 'No conditioning instructions in authored content.',
          predicate: { kind: 'forbidden_terms', terms: ['conditioning image position'] },
          createdAt: '2026-08-13T00:00:00.000Z',
        },
      ],
    }));

    await harness.manager.submitScenes({
      projectId: guarded.id,
      expectedRevision: guarded.revision,
      sceneIds: ['scene_1'],
      routes: [route],
      catalogVersion: 'catalog_1',
      outputRole: 'reference',
      referencePrompts: [{ sceneId: 'scene_1', prompt: buildFirstFramePrompt('A quiet hero', '16:9') }],
    });

    await waitFor(() => expect(submit).toHaveBeenCalledOnce());
    expect(submit.mock.calls[0]?.[0].prompt).toContain('Conditioning image position 1 is a cast reference.');
    expect(submit.mock.calls[0]?.[0].prompt).not.toContain('Hero headshot');
    expect(submit.mock.calls[0]?.[0].prompt).not.toContain(harness.rootDir);
  });

  it('refuses a visual prompt when only the second pinned rule matches', async () => {
    const submit = vi.fn();
    const harness = await createHarness(adapterWithSubmit(submit), {
      scenes: [scene({ visualPrompt: 'An ACME billboard at dusk' })],
    });
    const guarded = await withRules(harness, [nonmatchingRule, enforcedRule]);

    await expect(
      harness.manager.submitScenes({
        projectId: guarded.id,
        expectedRevision: guarded.revision,
        sceneIds: ['scene_1'],
        routes: [route],
        catalogVersion: 'catalog_1',
      })
    ).rejects.toMatchObject({ code: 'rule_breach' });

    expect(submit).not.toHaveBeenCalled();
    expect(Object.keys((await harness.store.getProject(guarded.id))!.jobs)).toEqual([]);
  });

  it('lets a prompt through when the rule carries no predicate', async () => {
    const submit = vi.fn(async () => ({ kind: 'complete' as const, outputs: [] }));
    const harness = await createHarness(adapterWithSubmit(submit), {
      scenes: [scene({ visualPrompt: 'A generic kit on a plain background' })],
    });
    const guarded = await withRules(harness, [
      {
        id: 'rule_1',
        scope: 'project',
        text: 'Keep the kits generic.',
        predicate: null,
        createdAt: '2026-08-13T00:00:00.000Z',
      },
    ]);

    const [job] = await harness.manager.submitScenes({
      projectId: guarded.id,
      expectedRevision: guarded.revision,
      sceneIds: ['scene_1'],
      routes: [route],
      catalogVersion: 'catalog_1',
    });

    expect(job).toMatchObject({ id: 'job_1', sceneId: 'scene_1' });
    await waitFor(() => expect(submit).toHaveBeenCalledOnce());
  });
});
