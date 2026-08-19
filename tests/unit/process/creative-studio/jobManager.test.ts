/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { promises as nodeFs } from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import type { IProvider, TProviderWithModel } from '@/common/config/storage';
import type {
  StudioCancellationPolicy,
  StudioGenerationRequestPlan,
  StudioJobV2,
  StudioProjectV2,
  StudioProviderAdapterId,
  StudioProviderRef,
  StudioQuotedGeneration,
  StudioSpendAuthorization,
} from '@/common/types/project/creativeStudioTypes';
import type { StudioGenerationRoute } from '@process/services/creative-studio/providerResolver';
import {
  type GenerationProviderAdapter,
  ProviderDeadlineError,
  type ProviderJobSnapshot,
} from '@process/services/creative-studio/adapters';
import {
  canCancelJobV2,
  createStudioJobManager,
  type StudioJobManagerV2,
  type StudioJobManagerDeps,
} from '@process/services/creative-studio/jobManager';
import {
  CreativeStudioMediaError,
  createStudioMediaStore,
  type StudioMediaStore,
  type StudioMediaStoreDeps,
} from '@process/services/creative-studio/mediaStore';
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
const REMOTE_POLL_DEADLINE_MS = 30 * 60_000;
const provider: IProvider = {
  id: 'provider_1',
  platform: 'openai',
  name: 'Image provider',
  base_url: 'https://provider.example/v1',
  api_key: 'secret',
  models: ['image-model'],
};

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

type V2Harness = {
  rootDir: string;
  store: CreativeStudioStore;
  mediaStore: StudioMediaStore;
  project: StudioProjectV2;
  manager: StudioJobManagerV2;
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
    v2Harnesses.splice(0).map(async (harness) => {
      await harness.manager.dispose();
      await rm(harness.rootDir, { recursive: true, force: true });
    })
  );
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
    const getProjectV2 = harness.store.getProjectV2.bind(harness.store);
    vi.spyOn(harness.store, 'getProjectV2').mockImplementation((projectId) =>
      projectId === 'legacy_project'
        ? Promise.resolve({ status: 'unsupported_prototype_schema', schemaVersion: 1 })
        : getProjectV2(projectId)
    );
    await expect(
      harness.manager.cancelJobV2({ projectId: 'legacy_project', jobId: 'job_v2_1', expectedRevision: 1 })
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
