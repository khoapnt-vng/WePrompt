/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IProvider, TProviderWithModel } from '@/common/config/storage';
import {
  isValidProviderJobId,
  type StudioCancelPieceJobResultV3,
  type StudioPieceJobErrorCodeV3,
  type StudioPieceJobV3,
  type StudioProjectV3,
  type StudioResumePieceJobResultV3,
  type StudioRetryPieceDownloadResultV3,
} from '@/common/types/project/creativeStudioTypes';
import type {
  GenerationProviderAdapter,
  GenerationProviderAdapterRegistry,
  ProviderJobSnapshot,
  ProviderOutput,
  ResolvedStudioGenerationRequest,
} from '@process/services/creative-studio/adapters';
import { ProviderDeadlineError, runWithProviderDeadline } from '@process/services/creative-studio/adapters';
import type { StudioProviderResolver } from '@process/services/creative-studio/providerResolver';
import type {
  CreativeStudioPilotStoreV3,
  StudioPilotProjectAuthoritySnapshotV3,
} from '@process/services/creative-studio/store/pilotStore';
import { createStudioPieceSpendReceiptV3 } from '../../schema2/pricing';
import {
  parseStudioCancelPieceJobRequestV3,
  parseStudioResumePieceJobRequestV3,
  parseStudioRetryPieceDownloadRequestV3,
} from '../contracts';
import { CreativeStudioPilotServiceErrorV3, normalizeCreativeStudioPilotErrorV3 } from '../errors';

const ACTIVE_EXECUTION_STATUSES = new Set<StudioPieceJobV3['status']>([
  'queued_local',
  'submitting',
  'queued_remote',
  'running',
]);
const TERMINAL_STATUSES = new Set<StudioPieceJobV3['status']>(['succeeded', 'failed', 'cancelled']);
const DEFAULT_SUBMISSION_TIMEOUT_MS = 5 * 60_000;
const DEFAULT_POLL_ATTEMPT_TIMEOUT_MS = 60_000;
const DEFAULT_CANCELLATION_TIMEOUT_MS = 60_000;
const DEFINITIVE_SUBMISSION_FAILURES = new Set<StudioPieceJobErrorCodeV3>([
  'invalid_request',
  'content_rejected',
  'auth',
  'quota',
  'rate_limited',
  'provider_unavailable',
  'unsupported',
]);
const ERROR_MESSAGE_KEYS: Readonly<Record<StudioPieceJobErrorCodeV3, string>> = {
  invalid_request: 'conversation.creativeStudio.jobs.errors.invalidRequest',
  content_rejected: 'conversation.creativeStudio.jobs.errors.contentRejected',
  auth: 'conversation.creativeStudio.jobs.errors.auth',
  quota: 'conversation.creativeStudio.jobs.errors.quota',
  rate_limited: 'conversation.creativeStudio.jobs.errors.rateLimited',
  provider_unavailable: 'conversation.creativeStudio.jobs.errors.providerUnavailable',
  timeout: 'conversation.creativeStudio.jobs.errors.timeout',
  poll_deadline: 'conversation.creativeStudio.jobs.errors.pollDeadline',
  no_output: 'conversation.creativeStudio.jobs.errors.noOutput',
  variation_grid: 'conversation.creativeStudio.jobs.errors.seedStillVariationGrid',
  submission_unknown: 'conversation.creativeStudio.jobs.errors.submissionUnknown',
  download_failed: 'conversation.creativeStudio.jobs.errors.downloadFailed',
  unsupported: 'conversation.creativeStudio.jobs.errors.unsupported',
  unknown: 'conversation.creativeStudio.jobs.errors.unknown',
};

export type StudioPilotGeneratedMediaPublisherV3 = {
  publishGeneratedOutputV3(input: {
    projectId: string;
    pieceId: string;
    jobId: string;
    providerSubmissionKind: 'complete' | 'remote';
    providerJobId: string | null;
    outputs: readonly ProviderOutput[];
    signal: AbortSignal;
  }): Promise<unknown>;
  /** Reads exact durable paid-output authority without reacquiring the caller's Project queue. */
  inspectGeneratedOutputClaimUnderAuthorityV3(input: {
    authority: StudioPilotProjectAuthoritySnapshotV3;
    pieceId: string;
    jobId: string;
  }): Promise<'clear' | 'claimed'>;
  /** Replays an already-durable generated-media intent without another provider call. */
  recoverProjectMediaV3?(projectId: string): Promise<void>;
  /** Replays one exact failed download while retaining the caller's project-revision authority. */
  recoverGeneratedJobV3?(input: {
    projectId: string;
    pieceId: string;
    jobId: string;
    expectedRevision: number;
  }): Promise<unknown>;
};

export type StudioPilotJobManagerDepsV3 = {
  store: CreativeStudioPilotStoreV3;
  providerResolver: Pick<StudioProviderResolver, 'listGenerationRoutes'>;
  adapters: GenerationProviderAdapterRegistry;
  listProviders: () => Promise<IProvider[]>;
  media: StudioPilotGeneratedMediaPublisherV3;
  now?: () => number;
  nowEpochMs?: () => number;
  sleep?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  pollDelayMs?: (attempt: number) => number;
  pollDeadlineMs?: number;
  submissionTimeoutMs?: number;
  pollAttemptTimeoutMs?: number;
  cancellationTimeoutMs?: number;
  onProjectUpdated?: (projectId: string) => void;
};

export type StudioPilotJobManagerV3 = {
  dispatchCommittedJobV3(projectId: string, jobId: string): Promise<void>;
  activeJobIdsV3(projectId: string): ReadonlySet<string>;
  cancelJobV3(input: unknown): Promise<StudioCancelPieceJobResultV3>;
  resumeJobV3(input: unknown): Promise<StudioResumePieceJobResultV3>;
  retryDownloadV3(input: unknown): Promise<StudioRetryPieceDownloadResultV3>;
  resumePendingJobsV3(projectIds?: readonly string[]): Promise<void>;
  waitForIdleV3(): Promise<void>;
  dispose(): Promise<void>;
};

type ExecutionContext = {
  project: StudioProjectV3;
  job: StudioPieceJobV3;
  adapter: GenerationProviderAdapter;
  provider: TProviderWithModel;
  request: ResolvedStudioGenerationRequest;
};

class JobTransitionSkipped extends Error {
  readonly project: StudioProjectV3;

  constructor(project: StudioProjectV3) {
    super('job_transition_skipped');
    this.name = 'JobTransitionSkipped';
    this.project = project;
  }
}

const defaultSleep = (milliseconds: number, signal: AbortSignal): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      return;
    }
    const finish = (): void => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      resolve();
    };
    const abort = (): void => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    };
    const timer = setTimeout(finish, milliseconds);
    signal.addEventListener('abort', abort, { once: true });
  });

const canonicalTimestamp = (now: () => number): string => {
  const value = now();
  if (!Number.isSafeInteger(value) || value < 0) throw new CreativeStudioPilotServiceErrorV3('storage_error');
  return new Date(value).toISOString();
};

const providerErrorCode = (error: unknown): StudioPieceJobErrorCodeV3 | null => {
  if (typeof error !== 'object' || error === null || !Object.hasOwn(error, 'code')) return null;
  const code = (error as { code: unknown }).code;
  return typeof code === 'string' && Object.hasOwn(ERROR_MESSAGE_KEYS, code)
    ? (code as StudioPieceJobErrorCodeV3)
    : code === 'invalid_response'
      ? 'unknown'
      : null;
};

const messageError = (code: StudioPieceJobErrorCodeV3): StudioPieceJobV3['error'] => ({
  code,
  messageKey: ERROR_MESSAGE_KEYS[code],
});

const providerWithModel = (provider: IProvider, model: string): TProviderWithModel => {
  const { models: _models, ...withoutModels } = provider;
  return { ...withoutModels, use_model: model };
};

const providerAvailable = (provider: IProvider, model: string): boolean =>
  provider.models.includes(model) &&
  provider.enabled !== false &&
  provider.model_enabled?.[model] !== false &&
  provider.model_health?.[model]?.status !== 'unhealthy' &&
  provider.api_key.trim().length > 0 &&
  provider.base_url.trim().length > 0;

const providerCredentialsAvailable = (provider: IProvider): boolean =>
  provider.api_key.trim().length > 0 && provider.base_url.trim().length > 0;

const isProviderJobSnapshot = (value: unknown): value is ProviderJobSnapshot => {
  if (typeof value !== 'object' || value === null || !Object.hasOwn(value, 'status')) return false;
  const snapshot = value as { status: unknown; progress?: unknown; outputs?: unknown; error?: unknown };
  if (snapshot.status === 'queued' || snapshot.status === 'running') {
    return (
      snapshot.progress === undefined ||
      (typeof snapshot.progress === 'number' &&
        Number.isFinite(snapshot.progress) &&
        snapshot.progress >= 0 &&
        snapshot.progress <= 100)
    );
  }
  if (snapshot.status === 'succeeded') return Array.isArray(snapshot.outputs);
  if (snapshot.status !== 'failed' && snapshot.status !== 'cancelled' && snapshot.status !== 'expired') return false;
  return (
    typeof snapshot.error === 'object' &&
    snapshot.error !== null &&
    Object.hasOwn(snapshot.error, 'code') &&
    typeof (snapshot.error as { code: unknown }).code === 'string'
  );
};

const executionKey = (projectId: string, jobId: string): string => `${projectId}\0${jobId}`;

const canCancelProviderJob = (job: StudioPieceJobV3): boolean => {
  if (job.spendReceipt !== null || job.providerJobId === null) return false;
  if (job.status === 'queued_remote') return job.cancellationPolicy !== 'none';
  if (job.status === 'running' || job.status === 'needs_attention') {
    return job.cancellationPolicy === 'queued_and_running';
  }
  return false;
};

const assertNoDurableGeneratedOutputClaim = async (
  media: StudioPilotGeneratedMediaPublisherV3,
  authority: StudioPilotProjectAuthoritySnapshotV3,
  pieceId: string,
  jobId: string
): Promise<void> => {
  let disposition: 'clear' | 'claimed';
  try {
    disposition = await media.inspectGeneratedOutputClaimUnderAuthorityV3({ authority, pieceId, jobId });
  } catch {
    // Cancellation is fail-closed: unreadable output authority is indistinguishable from paid output.
    throw new CreativeStudioPilotServiceErrorV3('cancellation_refused');
  }
  if (disposition === 'claimed') {
    throw new CreativeStudioPilotServiceErrorV3('cancellation_refused');
  }
};

/** Isolated schema-6 scheduler. It never imports or widens the schema-5 Job manager. */
export const createStudioPilotJobManagerV3 = (deps: StudioPilotJobManagerDepsV3): StudioPilotJobManagerV3 => {
  const now = deps.now ?? Date.now;
  const nowEpochMs = deps.nowEpochMs ?? Date.now;
  const sleep = deps.sleep ?? defaultSleep;
  const pollDelayMs = deps.pollDelayMs ?? ((attempt) => Math.min(15_000, 2_000 * 2 ** Math.min(attempt, 3)));
  const pollDeadlineMs = deps.pollDeadlineMs ?? 30 * 60_000;
  const submissionTimeoutMs = deps.submissionTimeoutMs ?? DEFAULT_SUBMISSION_TIMEOUT_MS;
  const pollAttemptTimeoutMs = deps.pollAttemptTimeoutMs ?? DEFAULT_POLL_ATTEMPT_TIMEOUT_MS;
  const cancellationTimeoutMs = deps.cancellationTimeoutMs ?? DEFAULT_CANCELLATION_TIMEOUT_MS;
  const controllers = new Map<string, AbortController>();
  const active = new Map<string, Promise<void>>();
  const paidOutputHandoffs = new Set<string>();
  const providerCancellationClaims = new Set<string>();
  const operationControllers = new Set<AbortController>();
  const activeOperations = new Set<Promise<unknown>>();
  let disposed = false;

  const notify = (projectId: string): void => {
    try {
      deps.onProjectUpdated?.(projectId);
    } catch {
      // Observers cannot change durable Job authority.
    }
  };

  const mutateJob = async (
    projectId: string,
    jobId: string,
    mutate: (project: StudioProjectV3, job: StudioPieceJobV3, timestamp: string) => boolean,
    allowDuringProviderCancellation = false
  ): Promise<{ project: StudioProjectV3; applied: boolean }> => {
    try {
      const project = await deps.store.withProjectAuthorityV3(projectId, async (authority) => {
        const current = authority.project;
        const job = current.jobs[jobId];
        if (job === undefined) throw new CreativeStudioPilotServiceErrorV3('not_found');
        if (!allowDuringProviderCancellation && providerCancellationClaims.has(executionKey(projectId, jobId))) {
          throw new JobTransitionSkipped(current);
        }
        const timestamp = canonicalTimestamp(now);
        if (timestamp < current.updatedAt) throw new CreativeStudioPilotServiceErrorV3('storage_error');
        const draft = structuredClone(current);
        const draftJob = draft.jobs[jobId]!;
        if (!mutate(draft, draftJob, timestamp)) throw new JobTransitionSkipped(current);
        draftJob.updatedAt = timestamp;
        return authority.commit(() => draft, { kind: 'runtime', expectedRevision: current.revision });
      });
      return { project, applied: true };
    } catch (error) {
      if (error instanceof JobTransitionSkipped) return { project: error.project, applied: false };
      throw error;
    }
  };

  const transitionError = async (
    projectId: string,
    jobId: string,
    status: 'failed' | 'needs_attention',
    code: StudioPieceJobErrorCodeV3
  ): Promise<void> => {
    await mutateJob(
      projectId,
      jobId,
      (_project, job) => {
        if (TERMINAL_STATUSES.has(job.status)) return false;
        if (job.spendReceipt !== null) {
          if (code === 'poll_deadline') {
            status = 'needs_attention';
          } else if (code !== 'no_output' && code !== 'variation_grid' && code !== 'download_failed') {
            code = 'download_failed';
            status = 'failed';
          }
        }
        job.status = status;
        job.error = messageError(code);
        job.progress = null;
        job.outputAssetId = null;
        return true;
      },
      true
    );
    notify(projectId);
  };

  const resolveContext = async (
    projectId: string,
    jobId: string,
    mode: 'auto' | 'submit' | 'continuation' = 'auto'
  ): Promise<ExecutionContext> => {
    const project = await deps.store.loadProjectV3(projectId);
    const job = project.jobs[jobId];
    if (job === undefined || job.target.kind !== 'piece' || project.pieces[job.target.pieceId] === undefined) {
      throw new CreativeStudioPilotServiceErrorV3('job_ineligible');
    }
    const authorization = project.spendAuthorizations.find((candidate) => candidate.id === job.authorizationId);
    if (authorization === undefined || authorization.quote.item.id !== job.authorizationItemId) {
      throw new CreativeStudioPilotServiceErrorV3('job_ineligible');
    }
    const settings = job.requestPlan.snapshot.settings;
    const provider = (await deps.listProviders()).find((candidate) => candidate.id === job.provider.providerId);
    const adapter = deps.adapters.get(job.provider.adapterId);
    const requiresLiveRoute = mode === 'submit' || (mode === 'auto' && job.status === 'queued_local');
    if (
      provider === undefined ||
      adapter === undefined ||
      (requiresLiveRoute ? !providerAvailable(provider, job.provider.model) : !providerCredentialsAvailable(provider))
    ) {
      throw new CreativeStudioPilotServiceErrorV3('route_unavailable');
    }
    const catalog = requiresLiveRoute ? await deps.providerResolver.listGenerationRoutes() : null;
    const route = catalog?.routes.find(
      (candidate) =>
        candidate.choiceId === authorization.quote.item.routeId &&
        candidate.kind === 'image' &&
        candidate.health !== 'unavailable' &&
        candidate.providerId === job.provider.providerId &&
        candidate.adapterId === job.provider.adapterId &&
        candidate.model === job.provider.model
    );
    if (
      requiresLiveRoute &&
      (route === undefined ||
        !route.constraints.aspectRatios.includes(settings.aspectRatio) ||
        !route.constraints.resolutions.includes(settings.resolution))
    ) {
      throw new CreativeStudioPilotServiceErrorV3('route_unavailable');
    }
    const request: ResolvedStudioGenerationRequest = {
      prompt: job.composition.prompt,
      mediaKind: 'image',
      aspectRatio: settings.aspectRatio,
      resolution: settings.resolution,
      durationSeconds: 1,
      idempotencyKey: job.idempotencyKey,
      ...(route === undefined ? {} : { routeConstraints: structuredClone(route.constraints) }),
      conditioningImages: [],
      conditioningImageLimit: 0,
    };
    const resolvedProvider = providerWithModel(provider, job.provider.model);
    if (requiresLiveRoute) {
      const validation = adapter.validateRequest(request, resolvedProvider);
      if (
        !validation.ok ||
        validation.normalized.aspectRatio !== settings.aspectRatio ||
        validation.normalized.resolution !== settings.resolution ||
        validation.normalized.durationSeconds !== 1
      ) {
        throw new CreativeStudioPilotServiceErrorV3('route_unavailable');
      }
    }
    return { project, job, adapter, provider: resolvedProvider, request };
  };

  const recordPaidOutputOutcome = async (
    projectId: string,
    jobId: string,
    providerSubmissionKind: 'complete' | 'remote',
    code: 'no_output' | 'variation_grid' | 'submission_unknown' | 'poll_deadline'
  ): Promise<void> => {
    await mutateJob(
      projectId,
      jobId,
      (project, job, timestamp) => {
        const ownsCompletion =
          providerSubmissionKind === 'complete'
            ? job.providerSubmissionKind === null &&
              job.providerJobId === null &&
              job.remoteStartedAt === null &&
              (job.status === 'submitting' ||
                (job.status === 'needs_attention' && job.error?.code === 'submission_unknown'))
            : job.providerSubmissionKind === 'remote' &&
              job.providerJobId !== null &&
              job.remoteStartedAt !== null &&
              (job.status === 'queued_remote' ||
                job.status === 'running' ||
                (job.status === 'needs_attention' && job.error?.code === 'poll_deadline'));
        if (!ownsCompletion) return false;
        const authorization = project.spendAuthorizations.find((candidate) => candidate.id === job.authorizationId);
        if (authorization === undefined || authorization.quote.item.id !== job.authorizationItemId) {
          throw new CreativeStudioPilotServiceErrorV3('job_ineligible');
        }
        job.providerSubmissionKind = providerSubmissionKind;
        job.status = code === 'submission_unknown' || code === 'poll_deadline' ? 'needs_attention' : 'failed';
        job.outputAssetId = null;
        job.error = messageError(code);
        job.progress = null;
        job.spendReceipt ??= createStudioPieceSpendReceiptV3({
          reservationId: authorization.quote.reservationId,
          authorization,
          jobId: job.id,
          recordedAt: timestamp,
        });
        return true;
      },
      true
    );
    notify(projectId);
  };

  const publishCompletion = async (
    context: ExecutionContext,
    providerSubmissionKind: 'complete' | 'remote',
    providerJobId: string | null,
    outputs: readonly ProviderOutput[]
  ): Promise<void> => {
    const key = executionKey(context.project.id, context.job.id);
    paidOutputHandoffs.add(key);
    // Once the provider has returned paid output, publication is receipt preservation rather than
    // cancellable generation work. Cancellation may stop only before this synchronous claim.
    const handoffSignal = new AbortController().signal;
    try {
      await deps.media.publishGeneratedOutputV3({
        projectId: context.project.id,
        pieceId: context.job.target.pieceId,
        jobId: context.job.id,
        providerSubmissionKind,
        providerJobId,
        outputs,
        signal: handoffSignal,
      });
      const loaded = await deps.store.loadProjectV3(context.project.id);
      if (loaded.jobs[context.job.id]?.status !== 'succeeded') {
        throw new CreativeStudioPilotServiceErrorV3('invalid_media');
      }
      notify(context.project.id);
    } catch (error) {
      const rawCode =
        typeof error === 'object' && error !== null && Object.hasOwn(error, 'code')
          ? (error as { code: unknown }).code
          : null;
      const loaded = await deps.store.loadProjectV3(context.project.id);
      const current = loaded.jobs[context.job.id];
      if (current?.status === 'succeeded' || current?.error?.code === 'download_failed') {
        notify(context.project.id);
        return;
      }
      if (rawCode === 'variation_grid' || rawCode === 'invalid_media') {
        await recordPaidOutputOutcome(
          context.project.id,
          context.job.id,
          providerSubmissionKind,
          rawCode === 'variation_grid' ? 'variation_grid' : 'no_output'
        );
        return;
      }
      if (providerSubmissionKind === 'remote') {
        // The provider has already returned a completed paid result. Even if URL resolution or
        // staging failed before media could publish an intent, persist the receipt and preserve
        // same-provider-Job polling recovery before releasing the cancellation handoff.
        await recordPaidOutputOutcome(context.project.id, context.job.id, 'remote', 'poll_deadline');
        return;
      }
      // A complete-only adapter returned after paid work, but Main could not durably secure its
      // output. Record the spend and require the explicit duplicate-charge retry acknowledgement.
      await recordPaidOutputOutcome(context.project.id, context.job.id, 'complete', 'submission_unknown');
    } finally {
      paidOutputHandoffs.delete(key);
    }
  };

  const pollRemote = async (context: ExecutionContext, providerJobId: string, signal: AbortSignal): Promise<void> => {
    if (context.adapter.poll === undefined) {
      await transitionError(context.project.id, context.job.id, 'needs_attention', 'poll_deadline');
      return;
    }
    const startedAt = nowEpochMs();
    for (let attempt = 0; ; attempt += 1) {
      if (signal.aborted || disposed) return;
      if (nowEpochMs() - startedAt >= pollDeadlineMs) {
        await transitionError(context.project.id, context.job.id, 'needs_attention', 'poll_deadline');
        return;
      }
      if (attempt > 0) await sleep(pollDelayMs(attempt - 1), signal);
      let snapshot: ProviderJobSnapshot;
      try {
        const remainingMs = Math.max(1, pollDeadlineMs - (nowEpochMs() - startedAt));
        snapshot = await runWithProviderDeadline(signal, Math.min(pollAttemptTimeoutMs, remainingMs), (attemptSignal) =>
          context.adapter.poll!(providerJobId, context.provider, attemptSignal)
        );
      } catch (error) {
        if (signal.aborted) return;
        if (error instanceof ProviderDeadlineError) {
          await transitionError(context.project.id, context.job.id, 'needs_attention', 'poll_deadline');
          return;
        }
        // Submission is already authoritative. Transport, credentials, adapter, or request
        // drift cannot prove the provider declined the work, so preserve the same paid Job.
        await transitionError(context.project.id, context.job.id, 'needs_attention', 'poll_deadline');
        return;
      }
      if (!isProviderJobSnapshot(snapshot)) {
        await transitionError(context.project.id, context.job.id, 'needs_attention', 'poll_deadline');
        return;
      }
      if (snapshot.status === 'queued') {
        await mutateJob(context.project.id, context.job.id, (_project, job) => {
          if (job.providerJobId !== providerJobId || job.status !== 'queued_remote') return false;
          const nextProgress = snapshot.progress ?? null;
          if (job.progress === nextProgress) return false;
          job.progress = nextProgress;
          return true;
        });
        continue;
      }
      if (snapshot.status === 'running') {
        await mutateJob(context.project.id, context.job.id, (_project, job) => {
          if (job.providerJobId !== providerJobId || (job.status !== 'queued_remote' && job.status !== 'running')) {
            return false;
          }
          job.status = 'running';
          job.progress = snapshot.progress ?? null;
          job.error = null;
          return true;
        });
        continue;
      }
      if (snapshot.status === 'succeeded') {
        await publishCompletion(context, 'remote', providerJobId, snapshot.outputs);
        return;
      }
      if (snapshot.status === 'cancelled') {
        if (context.job.spendReceipt !== null) {
          await transitionError(context.project.id, context.job.id, 'failed', 'download_failed');
          return;
        }
        await mutateJob(
          context.project.id,
          context.job.id,
          (_project, job) => {
            if (TERMINAL_STATUSES.has(job.status) || job.spendReceipt !== null) return false;
            job.status = 'cancelled';
            job.progress = null;
            job.error = null;
            return true;
          },
          true
        );
        notify(context.project.id);
        return;
      }
      if (snapshot.status !== 'failed' && snapshot.status !== 'expired') {
        await transitionError(context.project.id, context.job.id, 'needs_attention', 'poll_deadline');
        return;
      }
      const snapshotCode = snapshot.error.code === 'invalid_response' ? 'unknown' : snapshot.error.code;
      const code = Object.hasOwn(ERROR_MESSAGE_KEYS, snapshotCode)
        ? (snapshotCode as StudioPieceJobErrorCodeV3)
        : 'unknown';
      await transitionError(
        context.project.id,
        context.job.id,
        'failed',
        context.job.spendReceipt === null ? code : 'download_failed'
      );
      return;
    }
  };

  const runJob = async (projectId: string, jobId: string, signal: AbortSignal): Promise<void> => {
    let context: ExecutionContext;
    try {
      context = await resolveContext(projectId, jobId);
    } catch {
      if (!signal.aborted) {
        const project = await deps.store.loadProjectV3(projectId).catch((): null => null);
        const job = project?.jobs[jobId];
        if (
          job?.status === 'queued_remote' ||
          job?.status === 'running' ||
          (job?.status === 'needs_attention' && job.error?.code === 'poll_deadline')
        ) {
          await transitionError(projectId, jobId, 'needs_attention', 'poll_deadline');
        } else if (job?.status === 'submitting') {
          await transitionError(projectId, jobId, 'needs_attention', 'submission_unknown');
        } else if (job !== undefined) {
          await transitionError(projectId, jobId, 'failed', 'provider_unavailable');
        }
      }
      return;
    }
    if (context.job.status === 'queued_remote' || context.job.status === 'running') {
      if (context.job.providerJobId === null) {
        await transitionError(projectId, jobId, 'needs_attention', 'submission_unknown');
        return;
      }
      await pollRemote(context, context.job.providerJobId, signal);
      return;
    }
    if (context.job.status === 'needs_attention' && context.job.error?.code === 'poll_deadline') {
      if (context.job.providerJobId !== null) await pollRemote(context, context.job.providerJobId, signal);
      return;
    }
    if (context.job.status !== 'queued_local') return;
    const submitting = await mutateJob(projectId, jobId, (_project, job) => {
      if (job.status !== 'queued_local') return false;
      job.status = 'submitting';
      job.error = null;
      job.progress = null;
      return true;
    });
    if (!submitting.applied || submitting.project.jobs[jobId]?.status !== 'submitting' || signal.aborted) return;
    try {
      const submitted = await runWithProviderDeadline(signal, submissionTimeoutMs, (attemptSignal) =>
        context.adapter.submit(context.request, context.provider, attemptSignal)
      );
      if (signal.aborted) return;
      if (submitted.kind === 'complete') {
        await publishCompletion(context, 'complete', null, submitted.outputs);
        return;
      }
      if (!isValidProviderJobId(submitted.providerJobId)) {
        await transitionError(projectId, jobId, 'needs_attention', 'submission_unknown');
        return;
      }
      const remote = await mutateJob(projectId, jobId, (_project, job, timestamp) => {
        if (job.status !== 'submitting' || job.providerSubmissionKind !== null || job.providerJobId !== null) {
          return false;
        }
        job.status = 'queued_remote';
        job.providerSubmissionKind = 'remote';
        job.providerJobId = submitted.providerJobId;
        job.remoteStartedAt = timestamp;
        job.progress = null;
        job.error = null;
        return true;
      });
      if (remote.project.jobs[jobId]?.status === 'queued_remote') {
        await pollRemote(context, submitted.providerJobId, signal);
      }
    } catch (error) {
      if (signal.aborted) return;
      const code = providerErrorCode(error);
      if (code !== null && DEFINITIVE_SUBMISSION_FAILURES.has(code)) {
        await transitionError(projectId, jobId, 'failed', code);
      } else {
        await transitionError(projectId, jobId, 'needs_attention', 'submission_unknown');
      }
    }
  };

  const schedule = (projectId: string, jobId: string): void => {
    if (disposed) throw new CreativeStudioPilotServiceErrorV3('runtime_inactive');
    const key = executionKey(projectId, jobId);
    if (active.has(key) || providerCancellationClaims.has(key)) return;
    const controller = new AbortController();
    controllers.set(key, controller);
    const flight = runJob(projectId, jobId, controller.signal)
      .catch((): undefined => undefined)
      .finally(() => {
        controllers.delete(key);
        active.delete(key);
      });
    active.set(key, flight);
  };

  const recoverSameJob = async (
    input: unknown,
    kind: 'download' | 'poll'
  ): Promise<StudioRetryPieceDownloadResultV3> => {
    const request =
      kind === 'download' ? parseStudioRetryPieceDownloadRequestV3(input) : parseStudioResumePieceJobRequestV3(input);
    if (disposed) throw new CreativeStudioPilotServiceErrorV3('runtime_inactive');
    const key = executionKey(request.projectId, request.jobId);
    if (providerCancellationClaims.has(key)) {
      throw new CreativeStudioPilotServiceErrorV3('busy');
    }

    const loadEligibleCandidate = async (): Promise<StudioPieceJobV3> => {
      const candidate = await deps.store.loadProjectV3(request.projectId);
      if (candidate.revision !== request.expectedRevision) {
        throw new CreativeStudioPilotServiceErrorV3('stale_project');
      }
      const candidatePiece = candidate.pieces[request.pieceId];
      const candidateJob = candidate.jobs[request.jobId];
      if (
        candidatePiece === undefined ||
        candidateJob === undefined ||
        candidateJob.target.pieceId !== candidatePiece.id ||
        candidatePiece.currentAssetId !== null ||
        candidatePiece.jobIds.at(-1) !== candidateJob.id ||
        candidateJob.outputAssetId !== null ||
        (kind === 'download'
          ? candidateJob.status !== 'failed' ||
            candidateJob.error?.code !== 'download_failed' ||
            candidateJob.spendReceipt === null ||
            candidateJob.providerSubmissionKind === null
          : candidateJob.status !== 'needs_attention' ||
            candidateJob.error?.code !== 'poll_deadline' ||
            candidateJob.providerSubmissionKind !== 'remote' ||
            candidateJob.providerJobId === null ||
            candidateJob.remoteStartedAt === null)
      ) {
        throw new CreativeStudioPilotServiceErrorV3('job_ineligible');
      }
      return candidateJob;
    };

    const schedulerTail = kind === 'download' ? active.get(key) : undefined;
    let candidateJob: StudioPieceJobV3;
    if (active.has(key)) {
      // A download recovery can observe a terminal durable failure while the scheduler Promise is
      // only waiting for its final microtask to unwind. A poll-deadline recovery is nonterminal:
      // its active scheduler may keep polling for the full provider deadline, so a second public
      // resume must fail fast instead of joining that long-lived flight.
      if (schedulerTail === undefined) throw new CreativeStudioPilotServiceErrorV3('busy');
      try {
        await loadEligibleCandidate();
      } catch {
        // Preserve the public arbitration contract for ordinary queued/running work, stale
        // recovery requests, and mismatched targets while this Job is already owned in memory.
        throw new CreativeStudioPilotServiceErrorV3('busy');
      }
      // The terminal download failure is already renderer-actionable, but its scheduler Promise may
      // remain registered until the same microtask unwinds. Join only that proven terminal tail.
      await schedulerTail;
      if (disposed) throw new CreativeStudioPilotServiceErrorV3('runtime_inactive');
      if (providerCancellationClaims.has(key)) throw new CreativeStudioPilotServiceErrorV3('busy');
      candidateJob = await loadEligibleCandidate();
    } else {
      candidateJob = await loadEligibleCandidate();
    }

    if (kind === 'download' && deps.media.recoverGeneratedJobV3 !== undefined) {
      try {
        await deps.media.recoverGeneratedJobV3(request);
        const recovered = await deps.store.loadProjectV3(request.projectId);
        const recoveredPiece = recovered.pieces[request.pieceId];
        const recoveredJob = recovered.jobs[request.jobId];
        if (
          recoveredJob?.status !== 'succeeded' ||
          recoveredJob.outputAssetId === null ||
          recoveredPiece?.currentAssetId !== recoveredJob.outputAssetId
        ) {
          throw new CreativeStudioPilotServiceErrorV3('job_ineligible');
        }
        notify(request.projectId);
        return {
          status: 'recovering',
          projectId: request.projectId,
          pieceId: request.pieceId,
          jobId: request.jobId,
          revision: recovered.revision,
        };
      } catch (error) {
        const code =
          typeof error === 'object' && error !== null && Object.hasOwn(error, 'code')
            ? (error as { code: unknown }).code
            : null;
        if (candidateJob.providerSubmissionKind === 'complete' || code !== 'job_ineligible') throw error;
      }
    } else if (kind === 'download' && candidateJob.providerSubmissionKind === 'complete') {
      throw new CreativeStudioPilotServiceErrorV3('job_ineligible');
    }

    let context: ExecutionContext;
    try {
      context = await resolveContext(request.projectId, request.jobId, 'continuation');
    } catch (error) {
      if (kind === 'download') {
        await transitionError(request.projectId, request.jobId, 'needs_attention', 'poll_deadline');
      }
      throw error;
    }
    if (context.adapter.poll === undefined) {
      if (kind === 'download') {
        await transitionError(request.projectId, request.jobId, 'needs_attention', 'poll_deadline');
      }
      throw new CreativeStudioPilotServiceErrorV3('job_ineligible');
    }
    const committed = await deps.store.withProjectAuthorityV3(request.projectId, async (authority) => {
      const project = authority.project;
      if (providerCancellationClaims.has(key)) throw new CreativeStudioPilotServiceErrorV3('busy');
      if (project.revision !== request.expectedRevision) {
        throw new CreativeStudioPilotServiceErrorV3('stale_project');
      }
      const piece = project.pieces[request.pieceId];
      const job = project.jobs[request.jobId];
      if (
        piece === undefined ||
        job === undefined ||
        job.target.pieceId !== piece.id ||
        piece.currentAssetId !== null ||
        piece.jobIds.at(-1) !== job.id ||
        job.outputAssetId !== null ||
        job.providerSubmissionKind !== 'remote' ||
        job.providerJobId === null ||
        job.remoteStartedAt === null ||
        (kind === 'download'
          ? job.status !== 'failed' || job.error?.code !== 'download_failed' || job.spendReceipt === null
          : job.status !== 'needs_attention' || job.error?.code !== 'poll_deadline')
      ) {
        throw new CreativeStudioPilotServiceErrorV3('job_ineligible');
      }
      return authority.commit(
        (draft) => {
          const claimed = draft.jobs[request.jobId]!;
          claimed.status = kind === 'poll' && claimed.spendReceipt === null ? 'queued_remote' : 'running';
          claimed.error = null;
          claimed.progress = claimed.spendReceipt === null ? null : 100;
          claimed.updatedAt = canonicalTimestamp(now);
          return draft;
        },
        { kind: 'runtime', expectedRevision: project.revision }
      );
    });
    notify(request.projectId);
    schedule(request.projectId, request.jobId);
    return {
      status: 'recovering',
      projectId: request.projectId,
      pieceId: request.pieceId,
      jobId: request.jobId,
      revision: committed.revision,
    };
  };

  return {
    activeJobIdsV3(projectId) {
      const prefix = `${projectId}\0`;
      return new Set([...active.keys()].filter((key) => key.startsWith(prefix)).map((key) => key.slice(prefix.length)));
    },

    async dispatchCommittedJobV3(projectId, jobId) {
      if (disposed) throw new CreativeStudioPilotServiceErrorV3('runtime_inactive');
      if (providerCancellationClaims.has(executionKey(projectId, jobId))) {
        throw new CreativeStudioPilotServiceErrorV3('busy');
      }
      const project = await deps.store.loadProjectV3(projectId);
      const job = project.jobs[jobId];
      if (job === undefined || !ACTIVE_EXECUTION_STATUSES.has(job.status)) {
        throw new CreativeStudioPilotServiceErrorV3('job_ineligible');
      }
      schedule(projectId, jobId);
    },

    async cancelJobV3(input) {
      try {
        const request = parseStudioCancelPieceJobRequestV3(input);
        if (disposed) throw new CreativeStudioPilotServiceErrorV3('runtime_inactive');
        const project = await deps.store.loadProjectV3(request.projectId);
        const job = project.jobs[request.jobId];
        if (job === undefined || job.target.pieceId !== request.pieceId || TERMINAL_STATUSES.has(job.status)) {
          throw new CreativeStudioPilotServiceErrorV3('cancellation_refused');
        }
        const key = executionKey(request.projectId, request.jobId);
        if (paidOutputHandoffs.has(key)) {
          throw new CreativeStudioPilotServiceErrorV3('cancellation_refused');
        }
        if (job.status === 'queued_local') {
          const committed = await mutateJob(request.projectId, request.jobId, (_draft, current) => {
            if (paidOutputHandoffs.has(key) || current.status !== 'queued_local' || current.spendReceipt !== null) {
              return false;
            }
            current.status = 'cancelled';
            current.error = null;
            current.progress = null;
            return true;
          });
          if (committed.project.jobs[request.jobId]?.status !== 'cancelled') {
            throw new CreativeStudioPilotServiceErrorV3('cancellation_refused');
          }
          controllers.get(key)?.abort();
          notify(request.projectId);
          return {
            status: 'cancelled',
            projectId: request.projectId,
            pieceId: request.pieceId,
            jobId: request.jobId,
            revision: committed.project.revision,
          };
        }
        if (job.status === 'submitting') {
          await transitionError(request.projectId, request.jobId, 'needs_attention', 'submission_unknown');
          controllers.get(key)?.abort();
          throw new CreativeStudioPilotServiceErrorV3('cancellation_refused');
        }
        const providerJobId = job.providerJobId;
        if (providerJobId === null || !canCancelProviderJob(job)) {
          throw new CreativeStudioPilotServiceErrorV3('cancellation_refused');
        }
        const context = await resolveContext(request.projectId, request.jobId, 'continuation');
        if (disposed) throw new CreativeStudioPilotServiceErrorV3('runtime_inactive');
        if (context.adapter.cancel === undefined) {
          throw new CreativeStudioPilotServiceErrorV3('cancellation_refused');
        }
        let cancellationClaimed = false;
        let cancellationClaimRevision: number | null = null;
        try {
          await deps.store.withProjectAuthorityV3(request.projectId, async (authority) => {
            const current = authority.project.jobs[request.jobId];
            if (
              disposed ||
              current === undefined ||
              current.target.pieceId !== request.pieceId ||
              current.providerJobId !== providerJobId ||
              !canCancelProviderJob(current) ||
              paidOutputHandoffs.has(key) ||
              providerCancellationClaims.has(key)
            ) {
              throw new CreativeStudioPilotServiceErrorV3('cancellation_refused');
            }
            await assertNoDurableGeneratedOutputClaim(deps.media, authority, request.pieceId, request.jobId);
            if (disposed || paidOutputHandoffs.has(key) || providerCancellationClaims.has(key)) {
              throw new CreativeStudioPilotServiceErrorV3('cancellation_refused');
            }
            providerCancellationClaims.add(key);
            cancellationClaimed = true;
            cancellationClaimRevision = authority.project.revision;
          });
          await deps.store.withProjectAuthorityV3(request.projectId, async (authority) => {
            const current = authority.project.jobs[request.jobId];
            if (
              disposed ||
              cancellationClaimRevision === null ||
              authority.project.revision !== cancellationClaimRevision ||
              current === undefined ||
              current.target.pieceId !== request.pieceId ||
              current.providerJobId !== providerJobId ||
              !canCancelProviderJob(current) ||
              paidOutputHandoffs.has(key) ||
              !providerCancellationClaims.has(key)
            ) {
              throw new CreativeStudioPilotServiceErrorV3('cancellation_refused');
            }
            await assertNoDurableGeneratedOutputClaim(deps.media, authority, request.pieceId, request.jobId);
            if (disposed || paidOutputHandoffs.has(key) || !providerCancellationClaims.has(key)) {
              throw new CreativeStudioPilotServiceErrorV3('cancellation_refused');
            }
          });
          if (disposed || paidOutputHandoffs.has(key) || !providerCancellationClaims.has(key)) {
            throw new CreativeStudioPilotServiceErrorV3('cancellation_refused');
          }

          const cancellationController = new AbortController();
          operationControllers.add(cancellationController);
          const cancellation = runWithProviderDeadline(
            cancellationController.signal,
            cancellationTimeoutMs,
            (attemptSignal) => context.adapter.cancel!(providerJobId, context.provider, attemptSignal)
          );
          activeOperations.add(cancellation);
          let cancelled;
          try {
            cancelled = await cancellation;
          } catch {
            throw new CreativeStudioPilotServiceErrorV3('cancellation_refused');
          } finally {
            activeOperations.delete(cancellation);
            operationControllers.delete(cancellationController);
          }
          if (cancelled.kind !== 'cancelled') {
            throw new CreativeStudioPilotServiceErrorV3('cancellation_refused');
          }
          if (disposed || paidOutputHandoffs.has(key) || !providerCancellationClaims.has(key)) {
            throw new CreativeStudioPilotServiceErrorV3('cancellation_refused');
          }
          const committed = await deps.store.withProjectAuthorityV3(request.projectId, async (authority) => {
            const current = authority.project.jobs[request.jobId];
            if (
              disposed ||
              cancellationClaimRevision === null ||
              authority.project.revision !== cancellationClaimRevision ||
              current === undefined ||
              current.target.pieceId !== request.pieceId ||
              paidOutputHandoffs.has(key) ||
              !providerCancellationClaims.has(key) ||
              current.providerJobId !== providerJobId ||
              !canCancelProviderJob(current)
            ) {
              throw new CreativeStudioPilotServiceErrorV3('cancellation_refused');
            }
            await assertNoDurableGeneratedOutputClaim(deps.media, authority, request.pieceId, request.jobId);
            if (disposed || paidOutputHandoffs.has(key) || !providerCancellationClaims.has(key)) {
              throw new CreativeStudioPilotServiceErrorV3('cancellation_refused');
            }
            return authority.commit(
              (draft) => {
                const claimed = draft.jobs[request.jobId];
                if (
                  disposed ||
                  cancellationClaimRevision === null ||
                  draft.revision !== cancellationClaimRevision ||
                  claimed === undefined ||
                  claimed.target.pieceId !== request.pieceId ||
                  paidOutputHandoffs.has(key) ||
                  !providerCancellationClaims.has(key) ||
                  claimed.providerJobId !== providerJobId ||
                  !canCancelProviderJob(claimed)
                ) {
                  throw new CreativeStudioPilotServiceErrorV3('cancellation_refused');
                }
                claimed.status = 'cancelled';
                claimed.error = null;
                claimed.progress = null;
                return draft;
              },
              { kind: 'runtime', expectedRevision: authority.project.revision }
            );
          });
          if (committed.jobs[request.jobId]?.status !== 'cancelled') {
            throw new CreativeStudioPilotServiceErrorV3('cancellation_refused');
          }
          controllers.get(key)?.abort();
          notify(request.projectId);
          return {
            status: 'cancelled',
            projectId: request.projectId,
            pieceId: request.pieceId,
            jobId: request.jobId,
            revision: committed.revision,
          };
        } finally {
          if (cancellationClaimed) providerCancellationClaims.delete(key);
        }
      } catch (error) {
        return normalizeCreativeStudioPilotErrorV3(error);
      }
    },

    async resumeJobV3(input) {
      try {
        return await recoverSameJob(input, 'poll');
      } catch (error) {
        return normalizeCreativeStudioPilotErrorV3(error);
      }
    },

    async retryDownloadV3(input) {
      try {
        return await recoverSameJob(input, 'download');
      } catch (error) {
        return normalizeCreativeStudioPilotErrorV3(error);
      }
    },

    async resumePendingJobsV3(projectIds) {
      if (disposed) throw new CreativeStudioPilotServiceErrorV3('runtime_inactive');
      const ids = projectIds ?? (await deps.store.inspectProjectsV3()).healthyProjectIds;
      for (const projectId of [...ids].toSorted()) {
        let project: StudioProjectV3;
        try {
          // eslint-disable-next-line no-await-in-loop
          project = await deps.store.loadProjectV3(projectId);
        } catch {
          continue;
        }
        for (const jobId of Object.keys(project.jobs).toSorted()) {
          const job = project.jobs[jobId]!;
          try {
            if (job.status === 'submitting') {
              // One failed recovery write must not prevent later Projects or Jobs from resuming.
              // eslint-disable-next-line no-await-in-loop
              await transitionError(project.id, job.id, 'needs_attention', 'submission_unknown');
              continue;
            }
            if (
              job.status === 'queued_local' ||
              job.status === 'queued_remote' ||
              job.status === 'running' ||
              (job.status === 'needs_attention' && job.error?.code === 'poll_deadline' && job.providerJobId !== null)
            ) {
              schedule(project.id, job.id);
            }
          } catch {
            // Recovery is independently retryable on the next start; keep scanning healthy work.
          }
        }
      }
    },

    async waitForIdleV3() {
      while (active.size > 0) await Promise.all(active.values());
    },

    async dispose() {
      if (disposed) return;
      disposed = true;
      for (const controller of controllers.values()) controller.abort();
      for (const controller of operationControllers) controller.abort();
      await Promise.allSettled([...active.values(), ...activeOperations]);
      controllers.clear();
      active.clear();
      operationControllers.clear();
      activeOperations.clear();
    },
  };
};
