/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { promises as dns } from 'node:dns';
import { createReadStream, promises as fs } from 'node:fs';
import type { IProvider, TProviderWithModel } from '@/common/config/storage';
import {
  STUDIO_MAX_GENERATION_ITEMS_PER_REQUEST,
  STUDIO_MAX_GENERATIONS_PER_SHOT_PER_SUBMISSION,
  type StudioJobV2,
  type StudioJobError,
  type StudioJobErrorCode,
  type StudioJobRequest,
  type StudioMediaKind,
  type StudioProjectV2,
  type StudioProviderAdapterId,
  type StudioRetryDownloadRequest,
  type StudioRetryJobRequest,
} from '@/common/types/project/creativeStudioTypes';
import {
  ProviderDeadlineError,
  runWithProviderDeadline,
  type GenerationProviderAdapter,
  type ProviderJobSnapshot,
  type ProviderOutput,
  type ResolvedStudioGenerationRequest,
} from './adapters';
import type { GenerationProviderAdapterRegistry } from './adapters';
import { resolveRemoteMediaBudget, type RemoteMediaBudget } from '../remote-media/remoteMediaBudget';
import { createNodeRemoteMediaRequest, type RemoteMediaDownloadDeps } from '../remote-media/remoteMediaDownloader';
import { CreativeStudioMediaError, type StudioMediaStore } from './mediaStore';
import type { StudioProviderResolver } from './providerResolver';
import { CreativeStudioStoreError, type CreativeStudioStore } from './store';
import { createStudioSpendReceiptV2 } from './service/schema2/pricing';
import {
  advanceStudioWaitingBindingsV2,
  terminalizeStudioUnboundDependenciesV2,
  type StudioVerifiedConditioningFrameV2,
  type StudioWaitingBindingAdvanceV2,
} from './service/schema2/lifecycle';

const SAFE_ID = /^[A-Za-z0-9_-]{1,256}$/;
const TERMINAL_STATUSES = new Set(['succeeded', 'failed', 'cancelled']);
const POLL_BASE_DELAYS_MS = [2_000, 4_000, 8_000] as const;
const MAX_POLL_DELAY_MS = 15_000;
const SUBMISSION_DEADLINE_MS = 5 * 60_000;
const REMOTE_POLL_ATTEMPT_TIMEOUT_MS = 60_000;
const REMOTE_POLL_DEADLINE_MS = 30 * 60_000;
const MAX_IN_FLIGHT_PAID_JOBS_PER_PROJECT = 2;
const DISPATCH_AUTHORIZED_JOBS_KEYS_V2 = new Set(['projectId', 'jobIds']);

type OutputDownloaderDeps = Omit<RemoteMediaDownloadDeps, 'write' | 'maxBytes'>;

export type StudioJobManagerDeps = {
  store: CreativeStudioStore;
  mediaStore: StudioMediaStore;
  providerResolver: StudioProviderResolver;
  adapters: GenerationProviderAdapterRegistry;
  listProviders: () => Promise<IProvider[]>;
  onProjectUpdated?: (projectId: string) => void;
  now?: () => string;
  nowEpochMs?: () => number;
  sleep?: (delayMs: number, signal: AbortSignal) => Promise<void>;
  jitterMs?: (baseMs: number, attempt: number) => number;
  outputDownloader?: (
    provider: TProviderWithModel,
    adapterId: StudioProviderAdapterId,
    signal: AbortSignal,
    budget: RemoteMediaBudget
  ) => OutputDownloaderDeps;
};

export type StudioJobManagerV2 = {
  dispatchAuthorizedJobsV2(input: StudioDispatchAuthorizedJobsRequestV2): Promise<StudioJobV2[]>;
  cancelJobV2(input: StudioJobRequest): Promise<StudioJobV2>;
  retryJobV2(input: StudioRetryJobRequest): Promise<StudioJobV2>;
  retryDownloadV2(input: StudioRetryDownloadRequest): Promise<StudioJobV2>;
  resumePendingJobsV2(supportedProjectIds: readonly string[]): Promise<void>;
  dispose(): Promise<void>;
};

export type StudioDispatchAuthorizedJobsRequestV2 = {
  projectId: string;
  jobIds: string[];
};

export type StudioJobManagerErrorCode =
  | 'invalid_request'
  | 'invalid_route'
  | 'rule_breach'
  | 'provider_error'
  | 'busy'
  | 'unsupported'
  | 'cancellation_refused'
  | 'duplicate_charge_acknowledgement_required';

/** Stable service-facing failures; provider details and signed URLs never enter these errors. */
export class StudioJobManagerError extends Error {
  readonly code: StudioJobManagerErrorCode;

  constructor(code: StudioJobManagerErrorCode) {
    super(code);
    this.name = 'StudioJobManagerError';
    this.code = code;
  }
}

type ExecutionContextV2 = {
  projectId: string;
  shotId: string;
  mediaKind: StudioMediaKind;
  purpose: StudioJobV2['purpose'];
  jobId: string;
  adapter: GenerationProviderAdapter;
  provider: TProviderWithModel;
};

type PreparedSubmissionV2 = ExecutionContextV2 & {
  request: ResolvedStudioGenerationRequest;
};

class JobMutationSkippedV2 extends Error {
  readonly job: StudioJobV2;

  constructor(job: StudioJobV2) {
    super('job_mutation_skipped_v2');
    this.name = 'JobMutationSkippedV2';
    this.job = structuredClone(job);
  }
}

class FifoSemaphore {
  private active = 0;
  private readonly waiting: Array<{
    signal: AbortSignal;
    resolve: (release: () => void) => void;
    reject: (error: Error) => void;
    onAbort: () => void;
  }> = [];

  constructor(private readonly capacity: number) {}

  acquire(signal: AbortSignal): Promise<() => void> {
    if (signal.aborted) return Promise.reject(abortError());
    return new Promise<() => void>((resolve, reject) => {
      const entry = {
        signal,
        resolve,
        reject,
        onAbort: (): void => {
          const index = this.waiting.indexOf(entry);
          if (index >= 0) this.waiting.splice(index, 1);
          reject(abortError());
        },
      };
      signal.addEventListener('abort', entry.onAbort, { once: true });
      this.waiting.push(entry);
      this.dispatch();
    });
  }

  private dispatch(): void {
    while (this.active < this.capacity && this.waiting.length > 0) {
      const entry = this.waiting.shift()!;
      entry.signal.removeEventListener('abort', entry.onAbort);
      if (entry.signal.aborted) {
        entry.reject(abortError());
        continue;
      }
      this.active += 1;
      let released = false;
      entry.resolve(() => {
        if (released) return;
        released = true;
        this.active -= 1;
        this.dispatch();
      });
    }
  }
}

const abortError = (): Error => {
  const error = new Error('aborted');
  error.name = 'AbortError';
  return error;
};

const defaultSleep = (delayMs: number, signal: AbortSignal): Promise<void> => {
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, delayMs);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(abortError());
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
};

const defaultJitter = (baseMs: number): number =>
  Math.min(MAX_POLL_DELAY_MS, Math.max(0, Math.round(baseMs * (0.9 + Math.random() * 0.2))));

const defaultOutputDownloader = (
  provider: TProviderWithModel,
  adapterId: StudioProviderAdapterId,
  signal: AbortSignal,
  budget: RemoteMediaBudget
): OutputDownloaderDeps => {
  let trustedPrivateGatewayOrigin: string | undefined;
  if (adapterId === 'weprompt-media-gateway-v1') {
    try {
      trustedPrivateGatewayOrigin = new URL(provider.base_url).origin;
    } catch {
      // Request validation rejects malformed gateway origins before output persistence.
    }
  }
  const openRouterAuth =
    adapterId === 'openrouter-video-v1' && provider.api_key.trim()
      ? { host: 'openrouter.ai', headers: { Authorization: `Bearer ${provider.api_key}` } }
      : undefined;
  return {
    lookup: async (hostname) => {
      const addresses = await dns.lookup(hostname, { all: true, verbatim: true });
      return addresses.flatMap((address) =>
        address.family === 4 || address.family === 6 ? [{ address: address.address, family: address.family }] : []
      );
    },
    request: createNodeRemoteMediaRequest(120_000, openRouterAuth),
    signal,
    timeoutMs: budget.timeoutMs,
    ...(trustedPrivateGatewayOrigin ? { trustedPrivateGatewayOrigin } : {}),
  };
};

const isPositiveRevision = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0;

const invalidRequest = (): never => {
  throw new StudioJobManagerError('invalid_request');
};

const requireSafeId = (value: unknown): string => {
  if (typeof value !== 'string' || !SAFE_ID.test(value)) invalidRequest();
  return value as string;
};

const providerWithModel = (provider: IProvider, model: string): TProviderWithModel => {
  const { models: _models, ...providerWithoutModels } = provider;
  return { ...providerWithoutModels, use_model: model };
};

const providerIsAvailable = (provider: IProvider, model: string): boolean =>
  provider.enabled !== false &&
  provider.model_enabled?.[model] !== false &&
  provider.model_health?.[model]?.status !== 'unhealthy' &&
  provider.api_key.trim().length > 0;

const providerCredentialsAreUsable = (provider: IProvider): boolean =>
  provider.enabled !== false && provider.api_key.trim().length > 0;

const ownValueV2 = <T>(record: Record<string, T>, id: string): T | undefined =>
  Object.hasOwn(record, id) ? record[id] : undefined;

const isDenseArrayV2 = (value: unknown, maximumLength: number): value is unknown[] => {
  try {
    if (!Array.isArray(value) || value.length > maximumLength || Reflect.ownKeys(value).length !== value.length + 1) {
      return false;
    }
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.hasOwn(value, index)) return false;
    }
    return true;
  } catch {
    return false;
  }
};

const hasExactKeysV2 = (
  value: unknown,
  required: ReadonlySet<string>,
  optional: ReadonlySet<string> = new Set()
): value is Record<string, unknown> => {
  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
    const keys = Reflect.ownKeys(value);
    if (
      keys.length < required.size ||
      keys.length > required.size + optional.size ||
      keys.some((key) => typeof key !== 'string' || (!required.has(key) && !optional.has(key)))
    ) {
      return false;
    }
    for (const key of required) {
      if (!Object.hasOwn(value, key)) return false;
    }
    return true;
  } catch {
    return false;
  }
};

const jobMediaKindV2 = (job: StudioJobV2): StudioMediaKind => (job.purpose === 'seed_still' ? 'image' : 'video');

const activeBeatForShotV2 = (project: StudioProjectV2, shotId: string): StudioProjectV2['beats'][string] | null => {
  for (const beatId of project.beatOrder) {
    const beat = ownValueV2(project.beats, beatId);
    if (beat?.shotOrder.includes(shotId)) return beat;
  }
  return null;
};

const authorizationItemForJobV2 = (project: StudioProjectV2, job: StudioJobV2) => {
  const authorization = project.spendAuthorizations.find((candidate) => candidate.id === job.authorizationId);
  const item = authorization
    ? [...authorization.baseItems, ...authorization.cascadeItems].find(
        (candidate) => candidate.id === job.authorizationItemId
      )
    : undefined;
  return authorization && item ? { authorization, item } : null;
};

const errorMessageKey = (code: StudioJobErrorCode): string =>
  ({
    invalid_request: 'conversation.creativeStudio.jobs.errors.invalidRequest',
    auth: 'conversation.creativeStudio.jobs.errors.auth',
    quota: 'conversation.creativeStudio.jobs.errors.quota',
    rate_limited: 'conversation.creativeStudio.jobs.errors.rateLimited',
    provider_unavailable: 'conversation.creativeStudio.jobs.errors.providerUnavailable',
    timeout: 'conversation.creativeStudio.jobs.errors.timeout',
    poll_deadline: 'conversation.creativeStudio.jobs.errors.pollDeadline',
    no_output: 'conversation.creativeStudio.jobs.errors.noOutput',
    submission_unknown: 'conversation.creativeStudio.jobs.errors.submissionUnknown',
    download_failed: 'conversation.creativeStudio.jobs.errors.downloadFailed',
    unsupported: 'conversation.creativeStudio.jobs.errors.unsupported',
    unknown: 'conversation.creativeStudio.jobs.errors.unknown',
  })[code];

const jobError = (code: StudioJobErrorCode): StudioJobError => ({
  code,
  messageKey: errorMessageKey(code),
});

const providerErrorCode = (error: unknown): StudioJobErrorCode | 'invalid_response' | null => {
  if (typeof error !== 'object' || error === null || !('code' in error)) return null;
  const code = (error as { code?: unknown }).code;
  switch (code) {
    case 'invalid_request':
    case 'auth':
    case 'quota':
    case 'rate_limited':
    case 'provider_unavailable':
    case 'timeout':
    case 'no_output':
    case 'submission_unknown':
    case 'download_failed':
    case 'unsupported':
    case 'unknown':
    case 'invalid_response':
      return code;
    default:
      return null;
  }
};

const pollUncertaintyCode = (error: unknown): StudioJobErrorCode => {
  const code = providerErrorCode(error);
  return code === null || code === 'invalid_response' || code === 'submission_unknown' ? 'unknown' : code;
};

const snapshotFailureCode = (
  snapshot: Extract<ProviderJobSnapshot, { status: 'failed' | 'cancelled' | 'expired' }>
): StudioJobErrorCode => {
  const code = snapshot.error.code;
  return code === 'invalid_response' ? 'unknown' : code;
};

const pollBaseDelay = (attempt: number): number => POLL_BASE_DELAYS_MS[attempt] ?? MAX_POLL_DELAY_MS;
const executionKey = (projectId: string, jobId: string): string => `${projectId}\u0000${jobId}`;

export const canCancelJobV2 = (job: StudioJobV2): boolean => {
  if (job.spendReceipt !== null) return false;
  const policy = job.cancellationPolicy ?? 'none';
  if (job.status === 'queued_local' || job.status === 'submitting') return true;
  if (job.status === 'queued_remote') return policy !== 'none' && job.providerJobId !== null;
  if (job.status === 'running' || job.status === 'needs_attention') {
    return policy === 'queued_and_running' && job.providerJobId !== null;
  }
  return false;
};

/** Creates one runtime-owned durable scheduler for all schema-2 Studio projects. */
export const createStudioJobManager = (deps: StudioJobManagerDeps): StudioJobManagerV2 => {
  const now = deps.now ?? (() => new Date().toISOString());
  const nowEpochMs = deps.nowEpochMs ?? Date.now;
  const sleep = deps.sleep ?? defaultSleep;
  const jitterMs = deps.jitterMs ?? defaultJitter;
  const outputDownloader = deps.outputDownloader ?? defaultOutputDownloader;
  const semaphores = { image: new FifoSemaphore(2), video: new FifoSemaphore(1) };
  const projectSemaphores = new Map<string, FifoSemaphore>();
  const controllers = new Map<string, AbortController>();
  const executionReservations = new Set<string>();
  const operationControllers = new Set<AbortController>();
  const cancellationFlightsV2 = new Map<string, Promise<StudioJobV2>>();
  const activeRuns = new Set<Promise<unknown>>();
  const activeRunByKey = new Map<string, Promise<unknown>>();
  const admittedOperations = new Set<Promise<void>>();
  let disposed = false;
  let recoveryPromiseV2: Promise<void> | null = null;
  let disposePromise: Promise<void> | null = null;

  const acquireJobSlot = async (
    projectId: string,
    mediaKind: StudioMediaKind,
    signal: AbortSignal
  ): Promise<() => void> => {
    let projectSemaphore = projectSemaphores.get(projectId);
    if (!projectSemaphore) {
      projectSemaphore = new FifoSemaphore(MAX_IN_FLIGHT_PAID_JOBS_PER_PROJECT);
      projectSemaphores.set(projectId, projectSemaphore);
    }
    const releaseProject = await projectSemaphore.acquire(signal);
    try {
      const releaseGlobal = await semaphores[mediaKind].acquire(signal);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        releaseGlobal();
        releaseProject();
      };
    } catch (error) {
      releaseProject();
      throw error;
    }
  };

  const admitOperation = <T>(operation: () => Promise<T>): Promise<T> => {
    if (disposed) return Promise.reject(new StudioJobManagerError('invalid_request'));
    let release!: () => void;
    const fence = new Promise<void>((resolve) => {
      release = resolve;
    });
    admittedOperations.add(fence);
    let result: Promise<T>;
    try {
      result = operation();
    } catch (error) {
      admittedOperations.delete(fence);
      release();
      return Promise.reject(error);
    }
    return result.finally(() => {
      admittedOperations.delete(fence);
      release();
    });
  };

  const notify = (projectId: string): void => deps.onProjectUpdated?.(projectId);

  const requireExpectedProjectV2 = async (projectId: string, expectedRevision: number): Promise<StudioProjectV2> => {
    requireSafeId(projectId);
    if (!isPositiveRevision(expectedRevision)) invalidRequest();
    const loaded = await deps.store.getProjectV2(projectId);
    if (loaded.status === 'not_found') {
      throw new CreativeStudioStoreError('not_found', 'Studio project not found');
    }
    if (loaded.status === 'unsupported_prototype_schema') {
      throw new CreativeStudioStoreError('unsupported_prototype_schema', 'Unsupported prototype Studio schema');
    }
    if (loaded.project.revision !== expectedRevision) {
      throw new CreativeStudioStoreError('stale_project', 'Studio project has changed');
    }
    return loaded.project;
  };

  const loadSupportedProjectV2 = async (projectId: string): Promise<StudioProjectV2 | null> => {
    const loaded = await deps.store.getProjectV2(projectId);
    return loaded.status === 'supported' ? loaded.project : null;
  };

  const mutateJobV2 = async (
    projectId: string,
    jobId: string,
    mutate: (project: StudioProjectV2, job: StudioJobV2) => boolean,
    expectedRevision?: number
  ): Promise<StudioJobV2> => {
    try {
      const updated = await deps.store.updateProjectV2(
        projectId,
        (project) => {
          const job = ownValueV2(project.jobs, jobId);
          if (!job) throw new CreativeStudioStoreError('not_found', 'Studio job not found');
          if (!mutate(project, job)) throw new JobMutationSkippedV2(job);
          const updatedAt = now();
          job.updatedAt = updatedAt;
          terminalizeStudioUnboundDependenciesV2(project, updatedAt);
          return project;
        },
        expectedRevision,
        'studio_job_manager_v2'
      );
      notify(projectId);
      return ownValueV2(updated.jobs, jobId)!;
    } catch (error) {
      if (error instanceof JobMutationSkippedV2) return error.job;
      throw error;
    }
  };

  const transitionFailureV2 = async (
    projectId: string,
    jobId: string,
    status: 'failed' | 'needs_attention',
    code: StudioJobErrorCode
  ): Promise<StudioJobV2> =>
    mutateJobV2(projectId, jobId, (_project, job) => {
      if (TERMINAL_STATUSES.has(job.status)) return false;
      job.status = status;
      job.error = jobError(code);
      delete job.progress;
      return true;
    });

  const transitionRemoteFailureV2 = async (
    projectId: string,
    jobId: string,
    providerJobId: string,
    status: 'failed' | 'needs_attention',
    code: StudioJobErrorCode
  ): Promise<StudioJobV2> =>
    mutateJobV2(projectId, jobId, (_project, job) => {
      if (job.providerJobId !== providerJobId || (job.status !== 'queued_remote' && job.status !== 'running')) {
        return false;
      }
      job.status = status;
      job.error = jobError(code);
      delete job.progress;
      return true;
    });

  const transitionPollDeadlineV2 = (projectId: string, jobId: string, providerJobId: string): Promise<StudioJobV2> =>
    transitionRemoteFailureV2(projectId, jobId, providerJobId, 'needs_attention', 'poll_deadline');

  const transitionRetryDownloadFailureV2 = (
    projectId: string,
    jobId: string,
    providerJobId: string,
    code: StudioJobErrorCode
  ): Promise<StudioJobV2> =>
    mutateJobV2(projectId, jobId, (_project, currentJob) => {
      if (currentJob.status !== 'running' || currentJob.providerJobId !== providerJobId) return false;
      currentJob.status = 'failed';
      currentJob.error = jobError(code);
      delete currentJob.progress;
      return true;
    });

  const resolvePreparedSubmissionV2 = async (
    project: StudioProjectV2,
    job: StudioJobV2
  ): Promise<PreparedSubmissionV2> => {
    const shot = ownValueV2(project.shots, job.shotId);
    const snapshot = job.requestSnapshot;
    const authority = authorizationItemForJobV2(project, job);
    if (
      !shot ||
      !activeBeatForShotV2(project, shot.id) ||
      !shot.jobIds.includes(job.id) ||
      job.status !== 'queued_local' ||
      snapshot === null ||
      authority === null
    ) {
      throw new StudioJobManagerError('invalid_request');
    }
    const mediaKind = jobMediaKindV2(job);
    let catalog: Awaited<ReturnType<StudioProviderResolver['listGenerationRoutes']>>;
    let providers: IProvider[];
    try {
      [catalog, providers] = await Promise.all([deps.providerResolver.listGenerationRoutes(), deps.listProviders()]);
    } catch {
      throw new StudioJobManagerError('provider_error');
    }
    const route = catalog.routes.find(
      (candidate) =>
        candidate.choiceId === authority.item.routeId &&
        candidate.kind === mediaKind &&
        candidate.providerId === job.provider.providerId &&
        candidate.adapterId === job.provider.adapterId &&
        candidate.model === job.provider.model
    );
    const provider = providers.find((candidate) => candidate.id === job.provider.providerId);
    const adapter = deps.adapters.get(job.provider.adapterId);
    if (
      !route ||
      !provider ||
      !adapter ||
      !providerIsAvailable(provider, job.provider.model) ||
      job.cancellationPolicy !== route.cancellationPolicy
    ) {
      throw new StudioJobManagerError('invalid_route');
    }
    const resolvedProvider = providerWithModel(provider, job.provider.model);
    const baseRequest = {
      prompt: snapshot.prompt,
      mediaKind,
      aspectRatio: snapshot.aspectRatio,
      resolution: snapshot.resolution,
      durationSeconds: snapshot.durationSeconds,
      idempotencyKey: job.idempotencyKey,
    } as const;
    let firstFrame: ResolvedStudioGenerationRequest['firstFrame'];
    let conditioningImages: ResolvedStudioGenerationRequest['conditioningImages'];
    if (snapshot.referenceInput !== null) {
      const reference = ownValueV2(project.assets, snapshot.referenceInput.assetId);
      if (reference?.sha256 !== snapshot.referenceInput.sha256) throw new StudioJobManagerError('invalid_request');
      conditioningImages = [await deps.mediaStore.resolveProviderInputV2(project.id, reference.id)];
    }
    if (snapshot.conditioningInput !== null) {
      const inputAssetId =
        snapshot.conditioningInput.kind === 'seed_still'
          ? snapshot.conditioningInput.assetId
          : snapshot.conditioningInput.frameAssetId;
      firstFrame = await deps.mediaStore.resolveProviderInputV2(project.id, inputAssetId);
    }
    const resolvedRequest: ResolvedStudioGenerationRequest = {
      ...baseRequest,
      ...(firstFrame === undefined ? {} : { firstFrame }),
      ...(conditioningImages === undefined
        ? {}
        : { conditioningImages, conditioningImageLimit: route.constraints.maxConditioningImages }),
    };
    const resolvedValidation = adapter.validateRequest(resolvedRequest, resolvedProvider);
    if (!resolvedValidation.ok) throw new StudioJobManagerError('invalid_route');
    if (
      resolvedValidation.normalized.aspectRatio !== snapshot.aspectRatio ||
      resolvedValidation.normalized.resolution !== snapshot.resolution ||
      !Object.is(resolvedValidation.normalized.durationSeconds, snapshot.durationSeconds)
    ) {
      throw new StudioJobManagerError('invalid_route');
    }
    return {
      projectId: project.id,
      shotId: shot.id,
      mediaKind,
      purpose: job.purpose,
      jobId: job.id,
      adapter,
      provider: resolvedProvider,
      request: resolvedRequest,
    };
  };

  const resolveExistingContextV2 = async (
    project: StudioProjectV2,
    job: StudioJobV2
  ): Promise<ExecutionContextV2 | null> => {
    const shot = ownValueV2(project.shots, job.shotId);
    const authority = authorizationItemForJobV2(project, job);
    const binding = authority?.authorization.providerBindings.find(
      (candidate) => candidate.itemId === job.authorizationItemId
    );
    if (
      !shot ||
      !shot.jobIds.includes(job.id) ||
      !binding ||
      binding.provider.providerId !== job.provider.providerId ||
      binding.provider.adapterId !== job.provider.adapterId ||
      binding.provider.model !== job.provider.model
    ) {
      return null;
    }
    try {
      const mediaKind = jobMediaKindV2(job);
      const provider = (await deps.listProviders()).find((candidate) => candidate.id === job.provider.providerId);
      const adapter = deps.adapters.get(job.provider.adapterId);
      if (!provider || !adapter || !providerIsAvailable(provider, job.provider.model)) return null;
      return {
        projectId: project.id,
        shotId: shot.id,
        mediaKind,
        purpose: job.purpose,
        jobId: job.id,
        adapter,
        provider: providerWithModel(provider, job.provider.model),
      };
    } catch {
      return null;
    }
  };

  const resolveCancellationContextV2 = async (
    project: StudioProjectV2,
    job: StudioJobV2
  ): Promise<ExecutionContextV2 | null> => {
    const shot = ownValueV2(project.shots, job.shotId);
    if (!shot || !shot.jobIds.includes(job.id)) return null;
    try {
      const provider = (await deps.listProviders()).find((candidate) => candidate.id === job.provider.providerId);
      const adapter = deps.adapters.get(job.provider.adapterId);
      if (!provider || !adapter || !providerCredentialsAreUsable(provider)) return null;
      return {
        projectId: project.id,
        shotId: shot.id,
        mediaKind: jobMediaKindV2(job),
        purpose: job.purpose,
        jobId: job.id,
        adapter,
        provider: providerWithModel(provider, job.provider.model),
      };
    } catch {
      return null;
    }
  };

  const recordBillableCompletionV2 = async (
    context: ExecutionContextV2,
    providerJobId: string | null
  ): Promise<boolean> => {
    const job = await mutateJobV2(context.projectId, context.jobId, (project, current) => {
      if (providerJobId === null) {
        if (current.providerJobId !== null || current.status !== 'submitting') return false;
      } else if (
        current.providerJobId !== providerJobId ||
        (current.status !== 'queued_remote' && current.status !== 'running')
      ) {
        return false;
      }
      const authority = authorizationItemForJobV2(project, current);
      if (authority === null) return false;
      if (current.spendReceipt === null) {
        current.spendReceipt = createStudioSpendReceiptV2({
          authorization: authority.authorization,
          itemId: current.authorizationItemId,
          jobId: current.id,
          generationIndex: current.generationIndex,
        });
      }
      current.status = 'running';
      delete current.progress;
      return true;
    });
    return job.status === 'running' && job.spendReceipt !== null && job.providerJobId === providerJobId;
  };

  const persistPosterOutputV2 = async (
    context: ExecutionContextV2,
    outputs: ProviderOutput[],
    primaryAssetId: string,
    signal: AbortSignal
  ): Promise<boolean> => {
    if (context.mediaKind !== 'video') return false;
    const posters = outputs.filter((output) => output.role === 'poster');
    if (posters.length !== 1 || posters[0]!.mediaKind !== 'image') return false;
    const poster = posters[0]!;
    try {
      if (poster.source.kind === 'url') {
        const budget = resolveRemoteMediaBudget({ byteSize: poster.byteSize, mediaKind: poster.mediaKind });
        await deps.mediaStore.persistProviderPosterFromUrlForJobV2({
          projectId: context.projectId,
          shotId: context.shotId,
          jobId: context.jobId,
          primaryAssetId,
          declaredMimeType: poster.mimeType,
          ...(poster.byteSize === undefined ? {} : { declaredByteSize: poster.byteSize }),
          ...(poster.width === undefined ? {} : { width: poster.width }),
          ...(poster.height === undefined ? {} : { height: poster.height }),
          url: poster.source.url,
          downloader: outputDownloader(context.provider, context.adapter.id, signal, budget),
        });
        return true;
      }
      const stats = await fs.lstat(poster.source.path);
      if (!stats.isFile() || stats.isSymbolicLink()) throw new CreativeStudioMediaError('invalid_media');
      const body = createReadStream(poster.source.path);
      const abortBody = (): void => {
        body.destroy(abortError());
      };
      signal.addEventListener('abort', abortBody, { once: true });
      if (signal.aborted) abortBody();
      try {
        await deps.mediaStore.persistProviderPosterForJobV2({
          projectId: context.projectId,
          shotId: context.shotId,
          jobId: context.jobId,
          primaryAssetId,
          declaredMimeType: poster.mimeType,
          declaredByteSize: poster.byteSize ?? stats.size,
          ...(poster.width === undefined ? {} : { width: poster.width }),
          ...(poster.height === undefined ? {} : { height: poster.height }),
          body,
        });
        return true;
      } finally {
        signal.removeEventListener('abort', abortBody);
        if (signal.aborted && !body.destroyed) body.destroy(abortError());
      }
    } catch {
      return false;
    }
  };

  const persistPrimaryOutputV2 = async (
    context: ExecutionContextV2,
    outputs: ProviderOutput[],
    signal: AbortSignal
  ): Promise<StudioJobV2> => {
    const primaries = outputs.filter((output) => output.role === 'primary');
    if (primaries.length !== 1) {
      return transitionFailureV2(context.projectId, context.jobId, 'failed', 'no_output');
    }
    const output = primaries[0]!;
    if (output.mediaKind !== context.mediaKind) {
      return transitionFailureV2(context.projectId, context.jobId, 'failed', 'no_output');
    }
    try {
      let primaryAssetId: string;
      if (output.source.kind === 'url') {
        if (!output.mimeType) throw new CreativeStudioMediaError('invalid_media');
        const budget = resolveRemoteMediaBudget({ byteSize: output.byteSize, mediaKind: output.mediaKind });
        const primaryAsset = await deps.mediaStore.persistProviderOutputFromUrlForJobV2({
          projectId: context.projectId,
          shotId: context.shotId,
          jobId: context.jobId,
          mediaKind: output.mediaKind,
          declaredMimeType: output.mimeType,
          ...(output.byteSize === undefined ? {} : { declaredByteSize: output.byteSize }),
          ...(output.width === undefined ? {} : { width: output.width }),
          ...(output.height === undefined ? {} : { height: output.height }),
          ...(output.durationSeconds === undefined ? {} : { durationSeconds: output.durationSeconds }),
          url: output.source.url,
          downloader: outputDownloader(context.provider, context.adapter.id, signal, budget),
        });
        primaryAssetId = primaryAsset.id;
      } else {
        const stats = await fs.lstat(output.source.path);
        if (!stats.isFile() || stats.isSymbolicLink()) throw new CreativeStudioMediaError('invalid_media');
        const body = createReadStream(output.source.path);
        const abortBody = (): void => {
          body.destroy(abortError());
        };
        signal.addEventListener('abort', abortBody, { once: true });
        if (signal.aborted) abortBody();
        try {
          const primaryAsset = await deps.mediaStore.persistProviderOutputForJobV2({
            projectId: context.projectId,
            shotId: context.shotId,
            jobId: context.jobId,
            mediaKind: output.mediaKind,
            declaredMimeType: output.mimeType,
            declaredByteSize: output.byteSize ?? stats.size,
            ...(output.width === undefined ? {} : { width: output.width }),
            ...(output.height === undefined ? {} : { height: output.height }),
            ...(output.durationSeconds === undefined ? {} : { durationSeconds: output.durationSeconds }),
            body,
          });
          primaryAssetId = primaryAsset.id;
        } finally {
          signal.removeEventListener('abort', abortBody);
          if (signal.aborted && !body.destroyed) body.destroy(abortError());
        }
      }
      if (context.mediaKind === 'video' && !disposed && !signal.aborted) {
        await persistPosterOutputV2(context, outputs, primaryAssetId, signal);
      }
      notify(context.projectId);
      const project = await loadSupportedProjectV2(context.projectId);
      const committed = project ? ownValueV2(project.jobs, context.jobId) : undefined;
      if (!committed) throw new CreativeStudioStoreError('not_found', 'Studio job not found');
      return committed;
    } catch (error) {
      if (error instanceof CreativeStudioMediaError && error.code === 'job_inactive') {
        const project = await loadSupportedProjectV2(context.projectId);
        const current = project ? ownValueV2(project.jobs, context.jobId) : undefined;
        if (current) return current;
      }
      if (error instanceof CreativeStudioMediaError && error.code === 'invalid_media') {
        return transitionFailureV2(context.projectId, context.jobId, 'failed', 'no_output');
      }
      return transitionFailureV2(context.projectId, context.jobId, 'failed', 'download_failed');
    }
  };

  const handleRemoteSnapshotV2 = async (
    context: ExecutionContextV2,
    providerJobId: string,
    snapshot: ProviderJobSnapshot,
    signal: AbortSignal
  ): Promise<'continue' | 'terminal'> => {
    if (snapshot.status === 'queued' || snapshot.status === 'running') {
      await mutateJobV2(context.projectId, context.jobId, (_project, job) => {
        if (job.providerJobId !== providerJobId) return false;
        if (job.status === 'cancelled' || TERMINAL_STATUSES.has(job.status)) return false;
        if (job.status !== 'queued_remote' && job.status !== 'running') return false;
        if (snapshot.status === 'queued' && job.status === 'running') return false;
        job.status = snapshot.status === 'queued' ? 'queued_remote' : 'running';
        if (snapshot.progress === undefined) delete job.progress;
        else job.progress = snapshot.progress;
        return true;
      });
      return 'continue';
    }
    if (snapshot.status === 'succeeded') {
      if (!(await recordBillableCompletionV2(context, providerJobId))) return 'terminal';
      await persistPrimaryOutputV2(context, snapshot.outputs, signal);
      return 'terminal';
    }
    if (snapshot.status === 'cancelled') {
      await mutateJobV2(context.projectId, context.jobId, (_project, job) => {
        if (job.providerJobId !== providerJobId) return false;
        if (TERMINAL_STATUSES.has(job.status)) return false;
        if (job.status !== 'queued_remote' && job.status !== 'running') return false;
        job.status = 'cancelled';
        job.error = null;
        delete job.progress;
        return true;
      });
      return 'terminal';
    }
    if (!('error' in snapshot)) {
      await transitionRemoteFailureV2(context.projectId, context.jobId, providerJobId, 'failed', 'unknown');
      return 'terminal';
    }
    await transitionRemoteFailureV2(
      context.projectId,
      context.jobId,
      providerJobId,
      'failed',
      snapshotFailureCode(snapshot)
    );
    return 'terminal';
  };

  const pollRemoteV2 = async (
    context: ExecutionContextV2,
    providerJobId: string,
    remoteStartedAt: string,
    signal: AbortSignal
  ): Promise<void> => {
    if (!context.adapter.poll) {
      await transitionRemoteFailureV2(
        context.projectId,
        context.jobId,
        providerJobId,
        'needs_attention',
        'unsupported'
      );
      return;
    }
    const startedAtMs = Date.parse(remoteStartedAt);
    if (!Number.isFinite(startedAtMs)) {
      await transitionPollDeadlineV2(context.projectId, context.jobId, providerJobId);
      return;
    }
    const deadlineAtMs = startedAtMs + REMOTE_POLL_DEADLINE_MS;
    for (let attempt = 0; !signal.aborted; attempt += 1) {
      const remainingBeforeBackoffMs = deadlineAtMs - nowEpochMs();
      if (remainingBeforeBackoffMs <= 0) {
        await transitionPollDeadlineV2(context.projectId, context.jobId, providerJobId);
        return;
      }
      const baseDelay = pollBaseDelay(attempt);
      const requestedDelayMs = Math.min(MAX_POLL_DELAY_MS, Math.max(0, jitterMs(baseDelay, attempt)));
      await sleep(Math.min(requestedDelayMs, remainingBeforeBackoffMs), signal);
      if (signal.aborted) return;
      const remainingMs = deadlineAtMs - nowEpochMs();
      if (remainingMs <= 0) {
        await transitionPollDeadlineV2(context.projectId, context.jobId, providerJobId);
        return;
      }
      let snapshot: ProviderJobSnapshot;
      try {
        snapshot = await runWithProviderDeadline(
          signal,
          Math.min(REMOTE_POLL_ATTEMPT_TIMEOUT_MS, remainingMs),
          (attemptSignal) => context.adapter.poll!(providerJobId, context.provider, attemptSignal)
        );
      } catch (error) {
        if (signal.aborted) return;
        if (error instanceof ProviderDeadlineError) {
          if (nowEpochMs() >= deadlineAtMs) {
            await transitionPollDeadlineV2(context.projectId, context.jobId, providerJobId);
          } else {
            await transitionRemoteFailureV2(
              context.projectId,
              context.jobId,
              providerJobId,
              'needs_attention',
              'timeout'
            );
          }
          return;
        }
        throw error;
      }
      if (signal.aborted) return;
      if ((await handleRemoteSnapshotV2(context, providerJobId, snapshot, signal)) === 'terminal') return;
    }
  };

  const transitionUnexpectedRunFailureV2 = async (projectId: string, jobId: string): Promise<void> => {
    const project = await loadSupportedProjectV2(projectId);
    const job = project ? ownValueV2(project.jobs, jobId) : undefined;
    if (!job || TERMINAL_STATUSES.has(job.status) || job.status === 'needs_attention') return;
    if (job.providerJobId !== null) {
      await transitionFailureV2(projectId, jobId, 'needs_attention', 'unknown');
      return;
    }
    if (job.status === 'submitting' || job.status === 'queued_remote' || job.status === 'running') {
      await transitionFailureV2(projectId, jobId, 'needs_attention', 'submission_unknown');
      return;
    }
    await transitionFailureV2(projectId, jobId, 'failed', 'unknown');
  };

  const trackRunV2 = (projectId: string, jobId: string, run: (signal: AbortSignal) => Promise<void>): void => {
    const key = executionKey(projectId, jobId);
    if (controllers.has(key) || disposed) {
      executionReservations.delete(key);
      return;
    }
    const controller = new AbortController();
    controllers.set(key, controller);
    executionReservations.delete(key);
    const task = run(controller.signal)
      .catch(async () => {
        if (!controller.signal.aborted) {
          await transitionUnexpectedRunFailureV2(projectId, jobId).catch((): undefined => undefined);
        }
      })
      .finally(() => {
        if (controllers.get(key) === controller) controllers.delete(key);
        if (activeRunByKey.get(key) === task) activeRunByKey.delete(key);
        activeRuns.delete(task);
      });
    activeRuns.add(task);
    activeRunByKey.set(key, task);
  };

  const runSubmissionV2 = async (prepared: PreparedSubmissionV2, signal: AbortSignal): Promise<void> => {
    const release = await acquireJobSlot(prepared.projectId, prepared.mediaKind, signal);
    try {
      const submitting = await mutateJobV2(prepared.projectId, prepared.jobId, (_project, job) => {
        if (job.status !== 'queued_local') return false;
        job.status = 'submitting';
        job.error = null;
        return true;
      });
      if (submitting.status !== 'submitting' || signal.aborted) return;
      let result;
      try {
        result = await runWithProviderDeadline(signal, SUBMISSION_DEADLINE_MS, (submissionSignal) =>
          prepared.adapter.submit(prepared.request, prepared.provider, submissionSignal)
        );
      } catch (error) {
        if (signal.aborted) return;
        const code = providerErrorCode(error);
        if (
          code === null ||
          code === 'invalid_response' ||
          code === 'no_output' ||
          code === 'submission_unknown' ||
          code === 'timeout' ||
          code === 'provider_unavailable' ||
          code === 'unknown'
        ) {
          await transitionFailureV2(prepared.projectId, prepared.jobId, 'needs_attention', 'submission_unknown');
        } else {
          await transitionFailureV2(prepared.projectId, prepared.jobId, 'failed', code);
        }
        return;
      }
      if (result.kind === 'complete') {
        if (!(await recordBillableCompletionV2(prepared, null))) return;
        await persistPrimaryOutputV2(prepared, result.outputs, signal);
        return;
      }
      let queued: StudioJobV2;
      try {
        const remoteStartedAt = new Date(nowEpochMs()).toISOString();
        queued = await mutateJobV2(prepared.projectId, prepared.jobId, (_project, job) => {
          if (job.status !== 'submitting') return false;
          job.providerJobId = result.providerJobId;
          job.remoteStartedAt = remoteStartedAt;
          job.status = 'queued_remote';
          return true;
        });
      } catch {
        await transitionFailureV2(prepared.projectId, prepared.jobId, 'needs_attention', 'submission_unknown');
        return;
      }
      if (queued.status !== 'queued_remote' || queued.providerJobId !== result.providerJobId) return;
      const remoteStartedAt = queued.remoteStartedAt;
      if (typeof remoteStartedAt !== 'string') {
        await transitionPollDeadlineV2(prepared.projectId, prepared.jobId, result.providerJobId);
        return;
      }
      try {
        await pollRemoteV2(prepared, result.providerJobId, remoteStartedAt, signal);
      } catch (error) {
        if (signal.aborted) return;
        await transitionRemoteFailureV2(
          prepared.projectId,
          prepared.jobId,
          result.providerJobId,
          'needs_attention',
          pollUncertaintyCode(error)
        );
      }
    } finally {
      release();
    }
  };

  const runRecoveredRemoteV2 = async (
    context: ExecutionContextV2,
    providerJobId: string,
    remoteStartedAt: string,
    signal: AbortSignal
  ): Promise<void> => {
    const release = await acquireJobSlot(context.projectId, context.mediaKind, signal);
    try {
      await pollRemoteV2(context, providerJobId, remoteStartedAt, signal);
    } catch (error) {
      if (signal.aborted) return;
      await transitionRemoteFailureV2(
        context.projectId,
        context.jobId,
        providerJobId,
        'needs_attention',
        pollUncertaintyCode(error)
      );
    } finally {
      release();
    }
  };

  const dispatchAuthorizedJobsV2 = async (input: StudioDispatchAuthorizedJobsRequestV2): Promise<StudioJobV2[]> => {
    if (
      disposed ||
      !hasExactKeysV2(input, DISPATCH_AUTHORIZED_JOBS_KEYS_V2) ||
      typeof input.projectId !== 'string' ||
      !SAFE_ID.test(input.projectId) ||
      !isDenseArrayV2(
        input.jobIds,
        STUDIO_MAX_GENERATION_ITEMS_PER_REQUEST * STUDIO_MAX_GENERATIONS_PER_SHOT_PER_SUBMISSION
      ) ||
      input.jobIds.length === 0 ||
      input.jobIds.some((jobId) => typeof jobId !== 'string' || !SAFE_ID.test(jobId)) ||
      new Set(input.jobIds).size !== input.jobIds.length
    ) {
      invalidRequest();
    }
    const project = await loadSupportedProjectV2(input.projectId);
    if (project === null || disposed) throw new StudioJobManagerError('invalid_request');
    const requestedJobIds = new Set(input.jobIds);
    const candidateJobs = input.jobIds.map((jobId) => {
      const job = ownValueV2(project.jobs, jobId);
      if (
        job === undefined ||
        job.projectId !== project.id ||
        job.status !== 'queued_local' ||
        job.requestSnapshot === null ||
        !activeBeatForShotV2(project, job.shotId) ||
        authorizationItemForJobV2(project, job) === null
      ) {
        invalidRequest();
      }
      return job;
    });
    const checkedItems = new Set<string>();
    for (const job of candidateJobs) {
      const itemKey = `${job.authorizationId}\u0000${job.authorizationItemId}`;
      if (checkedItems.has(itemKey)) continue;
      checkedItems.add(itemKey);
      const queuedSiblings = Object.values(project.jobs)
        .filter(
          (candidate) =>
            candidate.authorizationId === job.authorizationId &&
            candidate.authorizationItemId === job.authorizationItemId &&
            candidate.status === 'queued_local'
        )
        .sort((left, right) => left.generationIndex - right.generationIndex);
      const requestedSiblings = candidateJobs.filter(
        (candidate) =>
          candidate.authorizationId === job.authorizationId && candidate.authorizationItemId === job.authorizationItemId
      );
      if (
        queuedSiblings.length !== requestedSiblings.length ||
        queuedSiblings.some(
          (candidate, index) => !requestedJobIds.has(candidate.id) || requestedSiblings[index]?.id !== candidate.id
        )
      ) {
        invalidRequest();
      }
    }
    const prepared: Array<{ job: StudioJobV2; submission: PreparedSubmissionV2 }> = [];
    const reservedKeys: string[] = [];
    try {
      for (const job of candidateJobs) {
        const key = executionKey(project.id, job.id);
        if (controllers.has(key) || executionReservations.has(key)) throw new StudioJobManagerError('busy');
        executionReservations.add(key);
        reservedKeys.push(key);
        try {
          prepared.push({ job, submission: await resolvePreparedSubmissionV2(project, job) });
        } catch (error) {
          if (
            error instanceof StudioJobManagerError &&
            (error.code === 'invalid_route' || error.code === 'provider_error')
          ) {
            await transitionFailureV2(project.id, job.id, 'needs_attention', 'provider_unavailable');
          }
          throw error;
        }
      }
    } catch (error) {
      for (const key of reservedKeys) executionReservations.delete(key);
      throw error;
    }
    if (disposed) {
      for (const key of reservedKeys) executionReservations.delete(key);
      throw new StudioJobManagerError('invalid_request');
    }
    for (const { job, submission } of prepared) {
      trackRunV2(project.id, job.id, (signal) => runSubmissionV2(submission, signal));
    }
    return prepared.map(({ job }) => structuredClone(job));
  };

  const cancelJobV2Once = async (input: StudioJobRequest, project: StudioProjectV2): Promise<StudioJobV2> => {
    if (disposed) throw new StudioJobManagerError('invalid_request');
    const current = ownValueV2(project.jobs, input.jobId);
    if (!current) throw new CreativeStudioStoreError('not_found', 'Studio job not found');
    if (current.status === 'cancelled') return current;
    if (current.status === 'queued_local') {
      const cancelled = await mutateJobV2(
        project.id,
        current.id,
        (_nextProject, job) => {
          if (job.status !== 'queued_local') return false;
          job.status = 'cancelled';
          job.error = null;
          return true;
        },
        input.expectedRevision
      );
      if (cancelled.status !== 'cancelled') throw new StudioJobManagerError('cancellation_refused');
      controllers.get(executionKey(project.id, current.id))?.abort();
      return cancelled;
    }
    if (current.status === 'submitting') {
      const uncertain = await mutateJobV2(
        project.id,
        current.id,
        (_nextProject, job) => {
          if (job.status !== 'submitting' || job.providerJobId !== null) return false;
          job.status = 'needs_attention';
          job.error = jobError('submission_unknown');
          return true;
        },
        input.expectedRevision
      );
      if (uncertain.status !== 'needs_attention' || uncertain.error?.code !== 'submission_unknown') {
        throw new StudioJobManagerError('cancellation_refused');
      }
      const key = executionKey(project.id, current.id);
      const activeRun = activeRunByKey.get(key);
      controllers.get(key)?.abort();
      await activeRun;
      return uncertain;
    }
    if (!canCancelJobV2(current) || current.providerJobId === null) {
      throw new StudioJobManagerError('cancellation_refused');
    }
    const providerJobId = current.providerJobId;
    const context = await resolveCancellationContextV2(project, current);
    if (disposed) throw new StudioJobManagerError('invalid_request');
    if (!context?.adapter.cancel) throw new StudioJobManagerError('cancellation_refused');
    const cancellationController = new AbortController();
    operationControllers.add(cancellationController);
    const cancellationOperation = (async (): Promise<StudioJobV2> => {
      let result;
      try {
        result = await context.adapter.cancel!(providerJobId, context.provider, cancellationController.signal);
      } catch {
        throw new StudioJobManagerError('cancellation_refused');
      }
      if (result.kind !== 'cancelled') throw new StudioJobManagerError('cancellation_refused');
      const cancelled = await mutateJobV2(project.id, current.id, (_nextProject, job) => {
        if (job.status === 'cancelled') return false;
        if (
          (job.status !== 'queued_remote' && job.status !== 'running' && job.status !== 'needs_attention') ||
          job.providerJobId !== providerJobId
        ) {
          return false;
        }
        job.status = 'cancelled';
        job.error = null;
        delete job.progress;
        return true;
      });
      if (cancelled.status !== 'cancelled') throw new StudioJobManagerError('cancellation_refused');
      controllers.get(executionKey(project.id, current.id))?.abort();
      return cancelled;
    })();
    activeRuns.add(cancellationOperation);
    try {
      return await cancellationOperation;
    } finally {
      activeRuns.delete(cancellationOperation);
      operationControllers.delete(cancellationController);
    }
  };

  const cancelJobV2 = async (input: StudioJobRequest): Promise<StudioJobV2> => {
    if (disposed) throw new StudioJobManagerError('invalid_request');
    requireSafeId(input.projectId);
    requireSafeId(input.jobId);
    if (!isPositiveRevision(input.expectedRevision)) invalidRequest();
    const key = `${executionKey(input.projectId, input.jobId)}:${input.expectedRevision}`;
    const inFlight = cancellationFlightsV2.get(key);
    if (inFlight) return inFlight;
    const project = await requireExpectedProjectV2(input.projectId, input.expectedRevision);
    if (disposed) throw new StudioJobManagerError('invalid_request');
    const current = ownValueV2(project.jobs, input.jobId);
    if (
      current === undefined ||
      current.status === 'queued_local' ||
      current.status === 'cancelled' ||
      !canCancelJobV2(current) ||
      current.providerJobId === null
    ) {
      return cancelJobV2Once(input, project);
    }
    const existing = cancellationFlightsV2.get(key);
    if (existing) return existing;
    const operation = cancelJobV2Once(input, project);
    cancellationFlightsV2.set(key, operation);
    void operation
      .finally(() => {
        if (cancellationFlightsV2.get(key) === operation) cancellationFlightsV2.delete(key);
      })
      .catch((): undefined => undefined);
    return operation;
  };

  const retryJobV2 = async (input: StudioRetryJobRequest): Promise<StudioJobV2> => {
    if (disposed) throw new StudioJobManagerError('invalid_request');
    requireSafeId(input.projectId);
    requireSafeId(input.jobId);
    const project = await requireExpectedProjectV2(input.projectId, input.expectedRevision);
    if (disposed) throw new StudioJobManagerError('invalid_request');
    const previous = ownValueV2(project.jobs, input.jobId);
    if (!previous) throw new CreativeStudioStoreError('not_found', 'Studio job not found');
    const shot = ownValueV2(project.shots, previous.shotId);
    if (!shot || !shot.jobIds.includes(previous.id)) {
      throw new CreativeStudioStoreError('not_found', 'Studio shot not found');
    }
    if (!activeBeatForShotV2(project, shot.id)) throw new StudioJobManagerError('invalid_request');
    const shotJobs = shot.jobIds.flatMap((jobId) => {
      const job = ownValueV2(project.jobs, jobId);
      return job?.projectId === project.id && job.shotId === shot.id ? [job] : [];
    });
    if (
      shotJobs.some((job) => job.retryOfJobId === previous.id) ||
      shotJobs.some((job) => job.id !== previous.id && !TERMINAL_STATUSES.has(job.status))
    ) {
      throw new StudioJobManagerError('busy');
    }
    if (
      (previous.status !== 'failed' && previous.status !== 'needs_attention') ||
      previous.error?.code === 'download_failed' ||
      previous.error?.code === 'poll_deadline'
    ) {
      throw new StudioJobManagerError('invalid_request');
    }
    if (
      previous.status === 'needs_attention' &&
      previous.error?.code === 'submission_unknown' &&
      previous.providerJobId === null
    ) {
      if (input.acknowledgePossibleDuplicateCharge !== true) {
        throw new StudioJobManagerError('duplicate_charge_acknowledgement_required');
      }
      const acknowledged = await mutateJobV2(
        project.id,
        previous.id,
        (_currentProject, currentJob) => {
          if (
            currentJob.status !== 'needs_attention' ||
            currentJob.error?.code !== 'submission_unknown' ||
            currentJob.providerJobId !== null ||
            currentJob.spendReceipt !== null
          ) {
            return false;
          }
          currentJob.status = 'failed';
          return true;
        },
        input.expectedRevision
      );
      if (acknowledged.status !== 'failed') {
        throw new StudioJobManagerError('invalid_request');
      }
      return acknowledged;
    }
    if (previous.status === 'needs_attention' && previous.providerJobId !== null) {
      const key = executionKey(project.id, previous.id);
      executionReservations.add(key);
      try {
        await activeRunByKey.get(key);
        if (disposed) throw new StudioJobManagerError('invalid_request');
        const context = await resolveExistingContextV2(project, previous);
        if (disposed) throw new StudioJobManagerError('invalid_request');
        if (!context) throw new StudioJobManagerError('invalid_route');
        const reclaimed = await mutateJobV2(
          project.id,
          previous.id,
          (_currentProject, currentJob) => {
            if (currentJob.status !== 'needs_attention' || currentJob.providerJobId !== previous.providerJobId) {
              return false;
            }
            currentJob.status = 'queued_remote';
            currentJob.error = null;
            return true;
          },
          input.expectedRevision
        );
        if (reclaimed.status !== 'queued_remote') throw new StudioJobManagerError('invalid_request');
        const remoteStartedAt = previous.remoteStartedAt ?? previous.createdAt;
        trackRunV2(project.id, previous.id, (signal) =>
          runRecoveredRemoteV2(context, previous.providerJobId!, remoteStartedAt, signal)
        );
        return reclaimed;
      } catch (error) {
        executionReservations.delete(key);
        throw error;
      }
    }
    // Any retry that would submit a new paid provider job must return to prepare/confirm.
    // This legacy seam may only resume or poll the same durable remote job above.
    throw new StudioJobManagerError('invalid_request');
  };
  const retryDownloadV2 = async (input: StudioRetryDownloadRequest): Promise<StudioJobV2> => {
    if (disposed) throw new StudioJobManagerError('invalid_request');
    requireSafeId(input.projectId);
    requireSafeId(input.jobId);
    const project = await requireExpectedProjectV2(input.projectId, input.expectedRevision);
    if (disposed) throw new StudioJobManagerError('invalid_request');
    const job = ownValueV2(project.jobs, input.jobId);
    if (!job || job.status !== 'failed' || job.error?.code !== 'download_failed') {
      throw new StudioJobManagerError('invalid_request');
    }
    const shot = ownValueV2(project.shots, job.shotId);
    if (
      !shot ||
      job.projectId !== project.id ||
      !shot.jobIds.includes(job.id) ||
      activeBeatForShotV2(project, shot.id) === null
    ) {
      throw new StudioJobManagerError('invalid_request');
    }
    const shotJobs = shot.jobIds.flatMap((jobId) => {
      const candidate = ownValueV2(project.jobs, jobId);
      return candidate?.projectId === project.id && candidate.shotId === job.shotId ? [candidate] : [];
    });
    if (
      shotJobs.some((candidate) => candidate.retryOfJobId === job.id) ||
      shotJobs.some((candidate) => candidate.id !== job.id && !TERMINAL_STATUSES.has(candidate.status))
    ) {
      throw new StudioJobManagerError('busy');
    }
    if (job.providerJobId === null) throw new StudioJobManagerError('unsupported');
    const context = await resolveExistingContextV2(project, job);
    if (disposed) throw new StudioJobManagerError('invalid_request');
    if (!context?.adapter.poll) throw new StudioJobManagerError(context ? 'unsupported' : 'invalid_route');
    const key = executionKey(project.id, job.id);
    if (controllers.has(key)) throw new StudioJobManagerError('invalid_request');
    const controller = new AbortController();
    controllers.set(key, controller);
    const operation = (async (): Promise<StudioJobV2> => {
      const claimed = await mutateJobV2(
        project.id,
        job.id,
        (_currentProject, currentJob) => {
          if (currentJob.status !== 'failed' || currentJob.error?.code !== 'download_failed') return false;
          currentJob.status = 'running';
          currentJob.error = null;
          return true;
        },
        input.expectedRevision
      );
      if (claimed.status !== 'running') throw new StudioJobManagerError('invalid_request');
      let release: (() => void) | undefined;
      try {
        release = await acquireJobSlot(context.projectId, context.mediaKind, controller.signal);
        const snapshot = await runWithProviderDeadline(
          controller.signal,
          REMOTE_POLL_ATTEMPT_TIMEOUT_MS,
          (attemptSignal) => context.adapter.poll!(job.providerJobId!, context.provider, attemptSignal)
        );
        if (snapshot.status !== 'succeeded') {
          return transitionRetryDownloadFailureV2(project.id, job.id, job.providerJobId!, 'download_failed');
        }
        return persistPrimaryOutputV2(context, snapshot.outputs, controller.signal);
      } catch {
        return transitionRetryDownloadFailureV2(project.id, job.id, job.providerJobId!, 'download_failed');
      } finally {
        release?.();
      }
    })();
    activeRuns.add(operation);
    try {
      return await operation;
    } finally {
      activeRuns.delete(operation);
      if (controllers.get(key) === controller) controllers.delete(key);
    }
  };

  const advanceWaitingBindingsForRecoveryV2 = async (projectId: string): Promise<void> => {
    const advanceOnce = async (
      verifiedReadyExtractions: ReadonlyMap<string, StudioVerifiedConditioningFrameV2> = new Map()
    ): Promise<StudioWaitingBindingAdvanceV2 | null> => {
      const loaded = await deps.store.getProjectV2(projectId);
      if (loaded.status !== 'supported') return null;
      const capturedAt = now();
      const probe = advanceStudioWaitingBindingsV2(
        structuredClone(loaded.project),
        capturedAt,
        verifiedReadyExtractions
      );
      if (!probe.projectChanged) return probe;

      let committedAdvance: StudioWaitingBindingAdvanceV2 = {
        dispatchJobIds: [],
        extractionIds: [],
        projectChanged: false,
      };
      try {
        await deps.store.updateProjectV2(
          projectId,
          (project) => {
            committedAdvance = advanceStudioWaitingBindingsV2(project, capturedAt, verifiedReadyExtractions);
            return project;
          },
          loaded.project.revision,
          'resume_waiting_bindings'
        );
      } catch (error) {
        if (error instanceof CreativeStudioStoreError && error.code === 'stale_project') return null;
        throw error;
      }
      return committedAdvance;
    };

    let advance = await advanceOnce();
    if (advance === null) advance = await advanceOnce();
    if (advance === null || disposed) return;
    const verifiedReadyExtractions = new Map<string, StudioVerifiedConditioningFrameV2>();
    for (const extractionId of advance.extractionIds) {
      try {
        // eslint-disable-next-line no-await-in-loop -- recovery deliberately bounds local decoder concurrency.
        const extraction = await deps.mediaStore.extractConditioningFrameV2({ projectId, extractionId });
        if (extraction.status === 'ready') {
          const verification = await deps.mediaStore.verifyConditioningFrameV2({ projectId, extractionId });
          if (verification !== null) verifiedReadyExtractions.set(verification.extractionId, verification);
        }
      } catch {
        // The durable failed extraction remains visible to the explicit provider-free retry action.
      }
    }
    if (verifiedReadyExtractions.size > 0 && !disposed) {
      advance = await advanceOnce(verifiedReadyExtractions);
      if (advance === null) await advanceOnce(verifiedReadyExtractions);
    }
  };

  const resumePendingJobsV2 = (supportedProjectIds: readonly string[]): Promise<void> => {
    if (!isDenseArrayV2(supportedProjectIds, Number.MAX_SAFE_INTEGER)) invalidRequest();
    const uniqueProjectIds = new Set<string>();
    for (const projectId of supportedProjectIds) {
      if (typeof projectId !== 'string' || !SAFE_ID.test(projectId) || uniqueProjectIds.has(projectId)) {
        invalidRequest();
      }
      uniqueProjectIds.add(projectId);
    }
    recoveryPromiseV2 ??= (async () => {
      if (disposed) return;
      for (const projectId of supportedProjectIds) {
        if (disposed) return;
        await deps.mediaStore.resumeConditioningFramesV2([projectId]);
        if (disposed) return;
        await advanceWaitingBindingsForRecoveryV2(projectId);
        if (disposed) return;
        const loaded = await deps.store.getProjectV2(projectId);
        if (loaded.status !== 'supported') continue;
        const project = loaded.project;
        for (const job of Object.values(project.jobs)) {
          if (disposed) return;
          try {
            if (TERMINAL_STATUSES.has(job.status)) continue;
            if (job.status === 'waiting_for_conditioning') continue;
            if (job.status === 'needs_attention' && job.error?.code === 'poll_deadline') continue;
            const key = executionKey(project.id, job.id);
            if (controllers.has(key) || executionReservations.has(key)) continue;
            if (job.status === 'needs_attention' && !job.providerJobId) continue;
            if (job.status === 'queued_local' && job.providerJobId === null) {
              const prepared = await resolvePreparedSubmissionV2(project, job);
              if (disposed) return;
              trackRunV2(project.id, job.id, (signal) => runSubmissionV2(prepared, signal));
              continue;
            }
            if (job.status === 'submitting' && job.providerJobId === null) {
              await transitionFailureV2(project.id, job.id, 'needs_attention', 'submission_unknown');
              continue;
            }
            if (!job.providerJobId) {
              await transitionFailureV2(project.id, job.id, 'needs_attention', 'submission_unknown');
              continue;
            }
            const freshProject = await loadSupportedProjectV2(project.id);
            const freshJob = freshProject ? ownValueV2(freshProject.jobs, job.id) : undefined;
            if (!freshProject || !freshJob) continue;
            if (freshJob.status === 'needs_attention' && freshJob.error?.code === 'poll_deadline') continue;
            const remoteStartedAt = freshJob.remoteStartedAt ?? freshJob.createdAt;
            const remoteStartedAtMs = Date.parse(remoteStartedAt);
            if (
              (freshJob.status === 'queued_remote' || freshJob.status === 'running') &&
              (!Number.isFinite(remoteStartedAtMs) || nowEpochMs() >= remoteStartedAtMs + REMOTE_POLL_DEADLINE_MS)
            ) {
              await transitionPollDeadlineV2(project.id, job.id, freshJob.providerJobId!);
              continue;
            }
            const context = await resolveExistingContextV2(freshProject, freshJob);
            if (!context) {
              await transitionFailureV2(project.id, job.id, 'needs_attention', 'provider_unavailable');
              continue;
            }
            if (freshJob.status === 'needs_attention') {
              const reclaimed = await mutateJobV2(project.id, job.id, (_currentProject, currentJob) => {
                if (currentJob.status !== 'needs_attention' || currentJob.providerJobId !== job.providerJobId) {
                  return false;
                }
                currentJob.status = 'queued_remote';
                currentJob.error = null;
                return true;
              });
              if (reclaimed.status !== 'queued_remote') continue;
            }
            if (disposed) return;
            trackRunV2(project.id, job.id, (signal) =>
              runRecoveredRemoteV2(context, freshJob.providerJobId!, remoteStartedAt, signal)
            );
          } catch {
            await transitionFailureV2(project.id, job.id, 'needs_attention', 'provider_unavailable').catch(
              (): undefined => undefined
            );
          }
        }
      }
    })();
    return recoveryPromiseV2;
  };

  const dispose = (): Promise<void> => {
    disposePromise ??= (async () => {
      disposed = true;
      for (const controller of controllers.values()) controller.abort();
      for (const controller of operationControllers) controller.abort();
      await recoveryPromiseV2?.catch((): undefined => undefined);
      await Promise.allSettled(admittedOperations);
      await Promise.allSettled(activeRuns);
      controllers.clear();
      executionReservations.clear();
      operationControllers.clear();
      cancellationFlightsV2.clear();
      activeRunByKey.clear();
      projectSemaphores.clear();
    })();
    return disposePromise;
  };

  return {
    dispatchAuthorizedJobsV2: (input) => admitOperation(() => dispatchAuthorizedJobsV2(input)),
    cancelJobV2: (input) => admitOperation(() => cancelJobV2(input)),
    retryJobV2: (input) => admitOperation(() => retryJobV2(input)),
    retryDownloadV2: (input) => admitOperation(() => retryDownloadV2(input)),
    resumePendingJobsV2,
    dispose,
  };
};
