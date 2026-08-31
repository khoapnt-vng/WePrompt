/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment node
 */

import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { IProvider } from '@/common/config/storage';
import type { StudioGenerationRouteCatalog } from '@/process/services/creative-studio/providerResolver';
import type {
  GenerationProviderAdapter,
  ProviderJobSnapshot,
  ProviderOutput,
} from '@/process/services/creative-studio/adapters';
import {
  CreativeStudioPilotServiceErrorV3,
  createStudioPilotConfirmPhotoServiceV3,
  createStudioPilotJobManagerV3,
  createStudioPilotPreparePhotoServiceV3,
  type StudioPilotIdentityKindV3,
} from '@/process/services/creative-studio/service/pilot';
import { studioPieceGenerationCompositionDigestV3 } from '@/process/services/creative-studio/service/schema2/generation';
import {
  createStudioPieceSpendReceiptV3,
  StudioPreparedPhotoCacheV3,
} from '@/process/services/creative-studio/service/schema2/pricing';
import {
  createCreativeStudioPilotStoreV3,
  type StudioPilotProjectAuthoritySnapshotV3,
} from '@/process/services/creative-studio/store/pilotStore';
import { afterEach, describe, expect, it } from 'vitest';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

type AdapterMode =
  | 'remote_success'
  | 'remote_local_shaped_id'
  | 'local_success'
  | 'invalid_provider_job_id'
  | 'submission_auth'
  | 'submission_unknown'
  | 'poll_auth'
  | 'poll_invalid_request'
  | 'poll_unsupported'
  | 'poll_unknown'
  | 'poll_running_then_never'
  | 'never_submit'
  | 'never_poll'
  | 'never_cancel'
  | 'cancel_refused';

type HarnessOptions = {
  dispatchImmediately?: boolean;
  adapterMode?: AdapterMode;
  submitGate?: Promise<void>;
  listProvidersGate?: Promise<void>;
  publicationGate?: Promise<void>;
  cancellationGate?: Promise<void>;
  publicationErrorCodes?: readonly string[];
  preIntentPublicationErrorCodes?: readonly string[];
  markSubmissionUnknownBeforePublicationFailure?: boolean;
  submissionTimeoutMs?: number;
  pollAttemptTimeoutMs?: number;
  cancellationTimeoutMs?: number;
  cancellationPolicy?: 'none' | 'queued_only' | 'queued_and_running';
  omitPoll?: boolean;
  omitCancel?: boolean;
  useDefaultSleep?: boolean;
  pollDelayMs?: number;
  recoverGeneratedMedia?: boolean;
  durableOutputClaimInspections?: readonly ('clear' | 'claimed' | 'error')[];
  outputClaimInspectionGate?: Promise<void>;
  onProjectUpdated?: (projectId: string) => void;
};

const never = <T>(): Promise<T> => new Promise<T>(() => undefined);

const createHarness = async (options: HarnessOptions = {}) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'studio-pilot-v3-jobs-'));
  roots.push(root);
  const timestamp = '2026-08-31T09:00:00.000Z';
  const epoch = Date.parse(timestamp);
  let temporarySequence = 0;
  let identitySequence = 0;
  let projectSequence = 0;
  const store = createCreativeStudioPilotStoreV3({
    rootDir: root,
    now: () => timestamp,
    createProjectId: () => `project_jobs_${++projectSequence}`,
    createTemporaryId: () => `temporary_${String(++temporarySequence).padStart(8, '0')}`,
  });
  let project = await store.createProjectV3({ name: 'Job pilot', brief: 'A silver train at night.' });
  project = await store.updateProjectV3(
    project.id,
    (draft) => ({ ...draft, spendPolicy: { currency: 'USD', maxPerBatchMinorUnits: 3 } }),
    { kind: 'authoring', expectedRevision: project.revision }
  );
  const provider: IProvider = {
    id: 'provider_image',
    platform: 'gemini',
    name: 'Image provider',
    base_url: 'https://provider.invalid/v1',
    api_key: 'secret',
    models: ['image-model'],
    enabled: true,
    model_enabled: { 'image-model': true },
    model_health: { 'image-model': { status: 'healthy' } },
  };
  const route: StudioGenerationRouteCatalog['routes'][number] = {
    choiceId: 'route_image',
    providerId: provider.id,
    providerName: provider.name,
    adapterId: 'weprompt-image-v1',
    model: 'image-model',
    health: 'available',
    kind: 'image',
    constraints: {
      aspectRatios: ['16:9', '1:1'],
      resolutions: ['720p', '1080p'],
      minDurationSeconds: 1,
      maxDurationSeconds: 60,
      supportsFirstFrame: false,
      maxConditioningImages: 0,
      silentOutput: true,
    },
    cancellationPolicy: options.cancellationPolicy ?? 'queued_and_running',
  };
  let availableRoutes = [route];
  let availableProviders = [provider];
  const providerResolver = {
    listGenerationRoutes: async (): Promise<StudioGenerationRouteCatalog> => ({
      routes: structuredClone(availableRoutes),
      diagnostics: [],
      generationCatalogVersion: 'catalog_1',
    }),
  };
  const output: ProviderOutput = {
    mediaKind: 'image',
    role: 'primary',
    source: { kind: 'file', path: '/private/provider-output.png' },
    mimeType: 'image/png',
    byteSize: 68,
    width: 1,
    height: 1,
  };
  const calls = {
    submit: 0,
    poll: 0,
    cancel: 0,
    listProviders: 0,
    publish: 0,
    recoverMedia: 0,
    inspectOutputClaim: 0,
    publicationSignals: [] as AbortSignal[],
    publishedProviderJobIds: [] as Array<string | null>,
    polledProviderJobIds: [] as string[],
    cancelledProviderJobIds: [] as string[],
  };
  const durableOutputClaimInspections = [...(options.durableOutputClaimInspections ?? [])];
  let pollSnapshots: unknown[] = [
    { status: 'queued' },
    { status: 'running', progress: 50 },
    { status: 'succeeded', outputs: [output] },
  ];
  let localShapedRemoteProviderJobId = 'local_unset_job';
  let pollGate: Promise<void> | undefined;
  const publicationErrorCodes = [...(options.publicationErrorCodes ?? [])];
  const preIntentPublicationErrorCodes = [...(options.preIntentPublicationErrorCodes ?? [])];
  const adapter: GenerationProviderAdapter = {
    id: 'weprompt-image-v1',
    async validateConnection() {
      return { ok: true };
    },
    validateRequest(request) {
      return {
        ok: true,
        normalized: {
          aspectRatio: request.aspectRatio,
          resolution: request.resolution,
          durationSeconds: request.durationSeconds,
        },
      };
    },
    async submit() {
      calls.submit += 1;
      await options.submitGate;
      if (options.adapterMode === 'never_submit') return never();
      if (options.adapterMode === 'local_success') return { kind: 'complete', outputs: [output] };
      if (options.adapterMode === 'remote_local_shaped_id') {
        return { kind: 'remote', providerJobId: localShapedRemoteProviderJobId };
      }
      if (options.adapterMode === 'invalid_provider_job_id') return { kind: 'remote', providerJobId: 'bad id' };
      if (options.adapterMode === 'submission_auth') {
        throw Object.assign(new Error('auth'), { code: 'auth' });
      }
      if (options.adapterMode === 'submission_unknown') throw Object.assign(new Error('unknown'), { code: 'unknown' });
      return { kind: 'remote', providerJobId: 'provider_job_1' };
    },
    async poll(providerJobId) {
      calls.poll += 1;
      calls.polledProviderJobIds.push(providerJobId);
      await pollGate;
      if (options.adapterMode === 'never_poll') return never();
      if (options.adapterMode === 'poll_running_then_never' && calls.poll > 1) return never();
      if (options.adapterMode === 'poll_auth') throw Object.assign(new Error('auth'), { code: 'auth' });
      if (options.adapterMode === 'poll_invalid_request') {
        throw Object.assign(new Error('invalid request'), { code: 'invalid_request' });
      }
      if (options.adapterMode === 'poll_unsupported') {
        throw Object.assign(new Error('unsupported'), { code: 'unsupported' });
      }
      if (options.adapterMode === 'poll_unknown') throw new Error('connection closed');
      return (
        pollSnapshots.length > 0 ? pollSnapshots.shift() : { status: 'succeeded', outputs: [output] }
      ) as ProviderJobSnapshot;
    },
    async cancel(providerJobId) {
      calls.cancel += 1;
      calls.cancelledProviderJobIds.push(providerJobId);
      await options.cancellationGate;
      if (options.adapterMode === 'never_cancel') return never();
      if (options.adapterMode === 'cancel_refused') {
        return { kind: 'refused', error: { code: 'cancellation_refused' } };
      }
      return { kind: 'cancelled' };
    },
  };
  if (options.omitPoll) delete adapter.poll;
  if (options.omitCancel) delete adapter.cancel;
  const adapters = new Map([['weprompt-image-v1', adapter]]);
  const persistGeneratedOutput = async (input: {
    projectId: string;
    pieceId: string;
    jobId: string;
    providerSubmissionKind: 'complete' | 'remote';
    providerJobId: string | null;
  }) =>
    store.withProjectAuthorityV3(input.projectId, async (authority) => {
      const current = authority.project;
      const job = current.jobs[input.jobId];
      const ownsCompletion =
        job !== undefined &&
        (input.providerSubmissionKind === 'complete'
          ? input.providerJobId === null &&
            ((job.providerSubmissionKind === null && job.status === 'submitting') ||
              (job.providerSubmissionKind === 'complete' &&
                job.status === 'failed' &&
                job.error?.code === 'download_failed'))
          : job.providerSubmissionKind === 'remote' &&
            job.providerJobId === input.providerJobId &&
            (job.status === 'queued_remote' || job.status === 'running' || job.status === 'needs_attention'));
      if (job === undefined || job.target.pieceId !== input.pieceId || !ownsCompletion) {
        throw new Error('invalid generated ownership');
      }
      const authorization = current.spendAuthorizations.find((candidate) => candidate.id === job.authorizationId)!;
      const receipt =
        job.spendReceipt ??
        createStudioPieceSpendReceiptV3({
          reservationId: authorization.quote.reservationId,
          authorization,
          jobId: job.id,
          recordedAt: timestamp,
        });
      const assetId = `asset_${input.jobId}`;
      return authority.commit(
        (draft) => {
          const draftJob = draft.jobs[input.jobId]!;
          draft.assets[assetId] = {
            id: assetId,
            projectId: draft.id,
            pieceId: input.pieceId,
            mediaKind: 'image',
            mimeType: 'image/png',
            managedAsset: { collection: 'assets', fileName: `${assetId}.png` },
            byteSize: 68,
            sha256: 'c'.repeat(64),
            width: 1,
            height: 1,
            createdAt: timestamp,
            origin: 'generated',
            producerJobId: input.jobId,
            compositionDigest: studioPieceGenerationCompositionDigestV3(draftJob.composition),
          };
          draft.pieces[input.pieceId]!.currentAssetId = assetId;
          draft.pieces[input.pieceId]!.updatedAt = timestamp;
          draftJob.providerSubmissionKind = input.providerSubmissionKind;
          draftJob.status = 'succeeded';
          draftJob.outputAssetId = assetId;
          draftJob.progress = 100;
          draftJob.error = null;
          draftJob.spendReceipt = receipt;
          draftJob.updatedAt = timestamp;
          return draft;
        },
        { kind: 'runtime', expectedRevision: current.revision }
      );
    });
  const media = {
    async publishGeneratedOutputV3(input: {
      projectId: string;
      pieceId: string;
      jobId: string;
      providerSubmissionKind: 'complete' | 'remote';
      providerJobId: string | null;
      outputs: readonly ProviderOutput[];
      signal: AbortSignal;
    }) {
      calls.publish += 1;
      calls.publicationSignals.push(input.signal);
      calls.publishedProviderJobIds.push(input.providerJobId);
      await options.publicationGate;
      const preIntentPublicationErrorCode = preIntentPublicationErrorCodes.shift();
      if (preIntentPublicationErrorCode !== undefined) {
        throw Object.assign(new Error(preIntentPublicationErrorCode), { code: preIntentPublicationErrorCode });
      }
      const publicationErrorCode = publicationErrorCodes.shift();
      if (publicationErrorCode !== undefined) {
        if (options.markSubmissionUnknownBeforePublicationFailure) {
          await store.withProjectAuthorityV3(input.projectId, async (authority) => {
            const current = authority.project;
            return authority.commit(
              (draft) => {
                const draftJob = draft.jobs[input.jobId]!;
                draftJob.status = 'needs_attention';
                draftJob.providerSubmissionKind = null;
                draftJob.providerJobId = null;
                draftJob.remoteStartedAt = null;
                draftJob.error = {
                  code: 'submission_unknown',
                  messageKey: 'conversation.creativeStudio.jobs.errors.submissionUnknown',
                };
                draftJob.progress = null;
                draftJob.spendReceipt = null;
                draftJob.updatedAt = timestamp;
                return draft;
              },
              { kind: 'runtime', expectedRevision: current.revision }
            );
          });
        }
        if (publicationErrorCode === 'download_failed' || publicationErrorCode === 'storage_error') {
          await store.withProjectAuthorityV3(input.projectId, async (authority) => {
            const current = authority.project;
            const job = current.jobs[input.jobId]!;
            const authorization = current.spendAuthorizations.find(
              (candidate) => candidate.id === job.authorizationId
            )!;
            const receipt = createStudioPieceSpendReceiptV3({
              reservationId: authorization.quote.reservationId,
              authorization,
              jobId: job.id,
              recordedAt: timestamp,
            });
            return authority.commit(
              (draft) => {
                const draftJob = draft.jobs[input.jobId]!;
                draftJob.providerSubmissionKind = input.providerSubmissionKind;
                draftJob.status = 'failed';
                draftJob.error = {
                  code: 'download_failed',
                  messageKey: 'conversation.creativeStudio.jobs.errors.downloadFailed',
                };
                draftJob.progress = null;
                draftJob.spendReceipt = receipt;
                draftJob.updatedAt = timestamp;
                return draft;
              },
              { kind: 'runtime', expectedRevision: current.revision }
            );
          });
        }
        throw Object.assign(new Error(publicationErrorCode), { code: publicationErrorCode });
      }
      if (input.signal.aborted || input.outputs.length !== 1 || input.outputs[0]?.mediaKind !== 'image') {
        throw Object.assign(new Error('invalid media'), { code: 'variation_grid' });
      }
      return persistGeneratedOutput(input);
    },
    async recoverGeneratedJobV3(input: {
      projectId: string;
      pieceId: string;
      jobId: string;
      expectedRevision: number;
    }) {
      calls.recoverMedia += 1;
      if (!options.recoverGeneratedMedia) {
        throw Object.assign(new Error('no durable intent'), { code: 'job_ineligible' });
      }
      const project = await store.loadProjectV3(input.projectId);
      if (project.revision !== input.expectedRevision) {
        throw new CreativeStudioPilotServiceErrorV3('stale_project');
      }
      const job = project.jobs[input.jobId];
      if (job?.providerSubmissionKind !== 'complete') {
        throw Object.assign(new Error('no complete intent'), { code: 'job_ineligible' });
      }
      return persistGeneratedOutput({ ...input, providerSubmissionKind: 'complete', providerJobId: null });
    },
    async inspectGeneratedOutputClaimUnderAuthorityV3(_input: {
      authority: StudioPilotProjectAuthoritySnapshotV3;
      pieceId: string;
      jobId: string;
    }): Promise<'clear' | 'claimed'> {
      calls.inspectOutputClaim += 1;
      await options.outputClaimInspectionGate;
      const disposition = durableOutputClaimInspections.shift() ?? 'clear';
      if (disposition === 'error') {
        throw new CreativeStudioPilotServiceErrorV3('storage_error');
      }
      return disposition;
    },
    async recoverProjectMediaV3(projectId: string) {
      calls.recoverMedia += 1;
      if (!options.recoverGeneratedMedia) return;
      const recoveryProject = await store.loadProjectV3(projectId);
      const job = Object.values(recoveryProject.jobs).find(
        (candidate) =>
          candidate.status === 'failed' &&
          candidate.error?.code === 'download_failed' &&
          candidate.providerSubmissionKind === 'complete'
      );
      if (job !== undefined) {
        await persistGeneratedOutput({
          projectId,
          pieceId: job.target.pieceId,
          jobId: job.id,
          providerSubmissionKind: 'complete',
          providerJobId: null,
        });
      }
    },
  };
  const manager = createStudioPilotJobManagerV3({
    store,
    providerResolver,
    adapters,
    listProviders: async () => {
      calls.listProviders += 1;
      await options.listProvidersGate;
      return structuredClone(availableProviders);
    },
    media,
    now: () => epoch,
    nowEpochMs: () => epoch,
    sleep: options.useDefaultSleep ? undefined : async () => undefined,
    pollDelayMs: options.pollDelayMs === undefined ? undefined : () => options.pollDelayMs!,
    submissionTimeoutMs: options.submissionTimeoutMs,
    pollAttemptTimeoutMs: options.pollAttemptTimeoutMs,
    cancellationTimeoutMs: options.cancellationTimeoutMs,
    onProjectUpdated: options.onProjectUpdated,
  });
  const preparedPhotos = new StudioPreparedPhotoCacheV3({ now: () => epoch });
  const prepare = createStudioPilotPreparePhotoServiceV3({
    store,
    preparedPhotos,
    providerResolver,
    now: () => epoch,
    mintIdentity: (kind: StudioPilotIdentityKindV3) => `${kind}_${++identitySequence}`,
  });
  const dispatchImmediately = options.dispatchImmediately ?? true;
  const confirm = createStudioPilotConfirmPhotoServiceV3({
    store,
    preparedPhotos,
    providerResolver,
    now: () => epoch,
    dispatchCommittedJob: dispatchImmediately
      ? (projectId, jobId) => manager.dispatchCommittedJobV3(projectId, jobId)
      : async () => undefined,
  });
  const prepared = await prepare.preparePhotoV3({
    mode: 'create',
    projectId: project.id,
    expectedAuthoringRevision: project.authoringRevision,
    words: 'Silver train under rain',
    settings: { aspectRatio: '16:9', resolution: '1080p' },
    suggestedHandle: null,
  });
  const confirmed = await confirm.confirmPreparedPhotoV3({
    reservationId: prepared.quote.reservationId,
    quoteId: prepared.quote.quoteId,
    quoteRevision: prepared.quote.quoteRevision,
    explicitHumanConfirmation: false,
    duplicateChargeAcknowledged: false,
  });
  const createAdditionalQueuedJob = async () => {
    let additional = await store.createProjectV3({ name: 'Recovery peer', brief: 'A second silver train.' });
    additional = await store.updateProjectV3(
      additional.id,
      (draft) => ({ ...draft, spendPolicy: { currency: 'USD', maxPerBatchMinorUnits: 3 } }),
      { kind: 'authoring', expectedRevision: additional.revision }
    );
    const additionalPrepared = await prepare.preparePhotoV3({
      mode: 'create',
      projectId: additional.id,
      expectedAuthoringRevision: additional.authoringRevision,
      words: 'Second silver train under rain',
      settings: { aspectRatio: '16:9', resolution: '1080p' },
      suggestedHandle: null,
    });
    const additionalConfirmed = await confirm.confirmPreparedPhotoV3({
      reservationId: additionalPrepared.quote.reservationId,
      quoteId: additionalPrepared.quote.quoteId,
      quoteRevision: additionalPrepared.quote.quoteRevision,
      explicitHumanConfirmation: false,
      duplicateChargeAcknowledged: false,
    });
    return { projectId: additional.id, confirmed: additionalConfirmed };
  };
  return {
    store,
    manager,
    calls,
    confirmed,
    projectId: project.id,
    timestamp,
    output,
    prepare,
    confirm,
    createAdditionalQueuedJob,
    setPollSnapshots: (snapshots: unknown[]) => {
      pollSnapshots = snapshots;
    },
    setDurableOutputClaimInspections: (inspections: readonly ('clear' | 'claimed' | 'error')[]) => {
      durableOutputClaimInspections.splice(0, durableOutputClaimInspections.length, ...inspections);
    },
    setPollGate: (gate: Promise<void> | undefined) => {
      pollGate = gate;
    },
    setLocalShapedRemoteProviderJobId: (providerJobId: string) => {
      localShapedRemoteProviderJobId = providerJobId;
    },
    setRoutes: (routes: StudioGenerationRouteCatalog['routes']) => {
      availableRoutes = structuredClone(routes);
    },
    setProviders: (providers: IProvider[]) => {
      availableProviders = structuredClone(providers);
    },
    removeAdapter: () => {
      adapters.delete('weprompt-image-v1');
    },
    restoreAdapter: () => {
      adapters.set('weprompt-image-v1', adapter);
    },
    provider,
    route,
  };
};

const setRestartStatus = async (
  harness: Awaited<ReturnType<typeof createHarness>>,
  status: 'submitting' | 'queued_remote' | 'running' | 'needs_attention',
  withReceipt = false
) => {
  const current = await harness.store.loadProjectV3(harness.projectId);
  return harness.store.updateProjectV3(
    harness.projectId,
    (draft) => {
      const job = draft.jobs[harness.confirmed.jobId]!;
      job.status = status;
      job.providerSubmissionKind = status === 'submitting' ? null : 'remote';
      job.providerJobId = status === 'submitting' ? null : 'provider_job_existing';
      job.remoteStartedAt = status === 'submitting' ? null : harness.timestamp;
      job.progress = status === 'running' ? 50 : null;
      job.error =
        status === 'needs_attention'
          ? {
              code: 'poll_deadline',
              messageKey: 'conversation.creativeStudio.jobs.errors.pollDeadline',
            }
          : null;
      const authorization = draft.spendAuthorizations.find((candidate) => candidate.id === job.authorizationId);
      if (withReceipt && authorization !== undefined) {
        job.spendReceipt = createStudioPieceSpendReceiptV3({
          reservationId: authorization.quote.reservationId,
          authorization,
          jobId: job.id,
          recordedAt: harness.timestamp,
        });
      } else {
        job.spendReceipt = null;
      }
      job.updatedAt = harness.timestamp;
      return draft;
    },
    { kind: 'runtime', expectedRevision: current.revision }
  );
};

const settleWithin = async <T>(promise: Promise<T>, milliseconds = 1_000): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('operation did not settle')), milliseconds);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
};

describe('schema-6 Piece job manager', () => {
  it('dispatches the one committed Job through queued, running, receipt, media, and succeeded', async () => {
    const harness = await createHarness();
    await harness.manager.waitForIdleV3();

    const project = await harness.store.loadProjectV3(harness.projectId);
    const job = project.jobs[harness.confirmed.jobId]!;
    expect(harness.calls).toMatchObject({ submit: 1, poll: 3, publish: 1 });
    expect(job).toMatchObject({ status: 'succeeded', progress: 100 });
    expect(job.spendReceipt).toMatchObject({ jobId: job.id, totalMinorUnits: 3, currency: 'USD' });
    expect(harness.calls.publishedProviderJobIds).toEqual(['provider_job_1']);
    expect(project.pieces[harness.confirmed.pieceId]?.currentAssetId).toBe(job.outputAssetId);
    expect(Object.keys(project.jobs)).toEqual([job.id]);
  });

  it('records receipt and publishes when the provider completes during submission', async () => {
    const harness = await createHarness({ adapterMode: 'local_success' });
    await harness.manager.waitForIdleV3();

    const job = (await harness.store.loadProjectV3(harness.projectId)).jobs[harness.confirmed.jobId]!;
    expect(job).toMatchObject({ status: 'succeeded', providerSubmissionKind: 'complete', providerJobId: null });
    expect(job.spendReceipt).toMatchObject({ jobId: job.id });
    expect(harness.calls).toMatchObject({ submit: 1, poll: 0, publish: 1 });
  });

  it('treats a remote provider ID shaped like the former local sentinel as remote authority', async () => {
    const harness = await createHarness({
      adapterMode: 'remote_local_shaped_id',
      publicationErrorCodes: ['download_failed'],
      dispatchImmediately: false,
    });
    const exactProviderJobId = `local_${harness.confirmed.jobId}`;
    harness.setLocalShapedRemoteProviderJobId(exactProviderJobId);
    await harness.manager.dispatchCommittedJobV3(harness.projectId, harness.confirmed.jobId);
    await harness.manager.waitForIdleV3();

    const failed = await harness.store.loadProjectV3(harness.projectId);
    const failedJob = failed.jobs[harness.confirmed.jobId]!;
    expect(failedJob).toMatchObject({
      status: 'failed',
      providerSubmissionKind: 'remote',
      providerJobId: exactProviderJobId,
      error: { code: 'download_failed' },
    });
    expect(harness.calls.polledProviderJobIds).toEqual([exactProviderJobId, exactProviderJobId, exactProviderJobId]);

    harness.setPollSnapshots([{ status: 'succeeded', outputs: [harness.output] }]);
    await harness.manager.retryDownloadV3({
      projectId: harness.projectId,
      pieceId: harness.confirmed.pieceId,
      jobId: failedJob.id,
      expectedRevision: failed.revision,
    });
    await harness.manager.waitForIdleV3();

    const recovered = await harness.store.loadProjectV3(harness.projectId);
    expect(recovered.jobs[failedJob.id]).toMatchObject({
      status: 'succeeded',
      providerSubmissionKind: 'remote',
      providerJobId: exactProviderJobId,
    });
    expect(harness.calls.polledProviderJobIds.at(-1)).toBe(exactProviderJobId);
    expect(harness.calls.submit).toBe(1);
  });

  it('requires a fresh acknowledged retry when complete-only output fails before durable media intent', async () => {
    const harness = await createHarness({
      adapterMode: 'local_success',
      publicationErrorCodes: ['before_media_intent'],
    });
    await harness.manager.waitForIdleV3();

    const waiting = await harness.store.loadProjectV3(harness.projectId);
    const waitingJob = waiting.jobs[harness.confirmed.jobId]!;
    const authorization = waiting.spendAuthorizations.find((candidate) => candidate.id === waitingJob.authorizationId)!;
    expect(waitingJob).toMatchObject({
      status: 'needs_attention',
      providerSubmissionKind: 'complete',
      providerJobId: null,
      remoteStartedAt: null,
      outputAssetId: null,
      error: { code: 'submission_unknown' },
    });
    expect(waitingJob.spendReceipt).toEqual(
      createStudioPieceSpendReceiptV3({
        reservationId: authorization.quote.reservationId,
        authorization,
        jobId: waitingJob.id,
        recordedAt: harness.timestamp,
      })
    );

    await expect(
      harness.manager.retryDownloadV3({
        projectId: harness.projectId,
        pieceId: harness.confirmed.pieceId,
        jobId: waitingJob.id,
        expectedRevision: waiting.revision,
      })
    ).rejects.toMatchObject({ code: 'job_ineligible' });
    await expect(
      harness.manager.resumeJobV3({
        projectId: harness.projectId,
        pieceId: harness.confirmed.pieceId,
        jobId: waitingJob.id,
        expectedRevision: waiting.revision,
      })
    ).rejects.toMatchObject({ code: 'job_ineligible' });
    await harness.manager.resumePendingJobsV3([harness.projectId]);
    await harness.manager.waitForIdleV3();
    expect(harness.calls).toMatchObject({ submit: 1, poll: 0, publish: 1, recoverMedia: 0 });

    const retry = await harness.prepare.preparePhotoV3({
      mode: 'retry',
      projectId: harness.projectId,
      expectedAuthoringRevision: waiting.authoringRevision,
      pieceId: harness.confirmed.pieceId,
      sourceJobId: waitingJob.id,
    });
    expect(retry.quote).toMatchObject({
      duplicateChargeAcknowledgementRequired: true,
      requiresExplicitHumanAction: true,
    });
    await expect(
      harness.confirm.confirmPreparedPhotoV3({
        reservationId: retry.quote.reservationId,
        quoteId: retry.quote.quoteId,
        quoteRevision: retry.quote.quoteRevision,
        explicitHumanConfirmation: true,
        duplicateChargeAcknowledged: false,
      })
    ).rejects.toMatchObject({ code: 'duplicate_charge_acknowledgement_required' });

    const retried = await harness.confirm.confirmPreparedPhotoV3({
      reservationId: retry.quote.reservationId,
      quoteId: retry.quote.quoteId,
      quoteRevision: retry.quote.quoteRevision,
      explicitHumanConfirmation: true,
      duplicateChargeAcknowledged: true,
    });
    await harness.manager.waitForIdleV3();

    const recovered = await harness.store.loadProjectV3(harness.projectId);
    expect(retried.jobId).not.toBe(waitingJob.id);
    expect(recovered.jobs[retried.jobId]).toMatchObject({
      status: 'succeeded',
      retryOfJobId: waitingJob.id,
      retryReason: 'submission_unknown',
      duplicateChargeAcknowledged: true,
    });
    expect(harness.calls).toMatchObject({ submit: 2, poll: 0, publish: 2, recoverMedia: 0 });
  });

  it('retains complete-only kind and receipt when an ambiguity transition wins before pre-intent failure', async () => {
    const harness = await createHarness({
      adapterMode: 'local_success',
      publicationErrorCodes: ['before_media_intent'],
      markSubmissionUnknownBeforePublicationFailure: true,
    });
    await harness.manager.waitForIdleV3();

    const project = await harness.store.loadProjectV3(harness.projectId);
    const job = project.jobs[harness.confirmed.jobId]!;
    expect(job).toMatchObject({
      status: 'needs_attention',
      providerSubmissionKind: 'complete',
      providerJobId: null,
      remoteStartedAt: null,
      outputAssetId: null,
      error: { code: 'submission_unknown' },
      spendReceipt: { jobId: job.id, totalMinorUnits: 3, currency: 'USD' },
    });
    expect(project.pieces[harness.confirmed.pieceId]!.currentAssetId).toBeNull();
    expect(Object.keys(project.assets)).toEqual([]);
    expect(harness.calls).toMatchObject({ submit: 1, poll: 0, publish: 1 });
  });

  it.each([
    ['remote_success', 'remote', 'invalid_media', 'no_output'],
    ['remote_success', 'remote', 'variation_grid', 'variation_grid'],
    ['local_success', 'complete', 'invalid_media', 'no_output'],
    ['local_success', 'complete', 'variation_grid', 'variation_grid'],
  ] as const)(
    'records exact %s %s authority and spend for %s content',
    async (adapterMode, providerSubmissionKind, rawCode, errorCode) => {
      const harness = await createHarness({ adapterMode, publicationErrorCodes: [rawCode] });
      await harness.manager.waitForIdleV3();

      const project = await harness.store.loadProjectV3(harness.projectId);
      const job = project.jobs[harness.confirmed.jobId]!;
      const authorization = project.spendAuthorizations.find((candidate) => candidate.id === job.authorizationId)!;
      expect(job).toMatchObject({
        status: 'failed',
        providerSubmissionKind,
        providerJobId: providerSubmissionKind === 'remote' ? 'provider_job_1' : null,
        remoteStartedAt: providerSubmissionKind === 'remote' ? harness.timestamp : null,
        outputAssetId: null,
        error: { code: errorCode },
      });
      expect(job.spendReceipt).toEqual(
        createStudioPieceSpendReceiptV3({
          reservationId: authorization.quote.reservationId,
          authorization,
          jobId: job.id,
          recordedAt: harness.timestamp,
        })
      );
      expect(project.pieces[harness.confirmed.pieceId]?.currentAssetId).toBeNull();
    }
  );

  it('keeps durable execution independent from a failing project-update observer', async () => {
    const harness = await createHarness({
      onProjectUpdated: () => {
        throw new Error('observer failed');
      },
    });
    await harness.manager.waitForIdleV3();

    expect((await harness.store.loadProjectV3(harness.projectId)).jobs[harness.confirmed.jobId]?.status).toBe(
      'succeeded'
    );
    expect(harness.calls.publish).toBe(1);
  });

  it.each([
    ['invalid_provider_job_id', 'needs_attention', 'submission_unknown'],
    ['submission_auth', 'failed', 'auth'],
  ] as const)('fails %s submission without polling or publishing', async (adapterMode, status, code) => {
    const harness = await createHarness({ adapterMode });
    await harness.manager.waitForIdleV3();

    const job = (await harness.store.loadProjectV3(harness.projectId)).jobs[harness.confirmed.jobId]!;
    expect(job).toMatchObject({ status, error: { code }, spendReceipt: null });
    expect(harness.calls).toMatchObject({ submit: 1, poll: 0, publish: 0 });
  });

  it('fails an ambiguous submission into explicit duplicate-charge review without inventing another Job', async () => {
    const harness = await createHarness({ adapterMode: 'submission_unknown' });
    await harness.manager.waitForIdleV3();

    const project = await harness.store.loadProjectV3(harness.projectId);
    const job = project.jobs[harness.confirmed.jobId]!;
    expect(job).toMatchObject({
      status: 'needs_attention',
      error: { code: 'submission_unknown' },
      spendReceipt: null,
    });
    expect(project.pieces[harness.confirmed.pieceId]?.currentAssetId).toBeNull();
    expect(Object.keys(project.jobs)).toEqual([job.id]);
    expect(harness.calls.publish).toBe(0);
  });

  it.each([
    [{ status: 'cancelled', error: { code: 'unknown' } }, 'cancelled', null],
    [{ status: 'failed', error: { code: 'auth' } }, 'failed', 'auth'],
    [{ status: 'failed', error: { code: 'invalid_response' } }, 'failed', 'unknown'],
    [{ status: 'expired', error: { code: 'unknown' } }, 'failed', 'unknown'],
  ] as const)('persists remote terminal outcome %# without recording spend', async (snapshot, status, code) => {
    const harness = await createHarness({ dispatchImmediately: false });
    harness.setPollSnapshots([snapshot]);

    await harness.manager.dispatchCommittedJobV3(harness.projectId, harness.confirmed.jobId);
    await harness.manager.waitForIdleV3();

    const job = (await harness.store.loadProjectV3(harness.projectId)).jobs[harness.confirmed.jobId]!;
    expect(job).toMatchObject({ status, error: code === null ? null : { code }, spendReceipt: null });
    expect(harness.calls).toMatchObject({ submit: 1, poll: 1, publish: 0 });
  });

  it.each(['poll_auth', 'poll_invalid_request', 'poll_unsupported'] as const)(
    'keeps %s exceptions on the same recoverable provider Job',
    async (adapterMode) => {
      const harness = await createHarness({ adapterMode });
      await harness.manager.waitForIdleV3();

      const job = (await harness.store.loadProjectV3(harness.projectId)).jobs[harness.confirmed.jobId]!;
      expect(job).toMatchObject({
        status: 'needs_attention',
        error: { code: 'poll_deadline' },
        providerJobId: 'provider_job_1',
        spendReceipt: null,
      });
      expect(harness.calls).toMatchObject({ submit: 1, poll: 1, publish: 0 });
    }
  );

  it('keeps an unclassified polling exception recoverable', async () => {
    const harness = await createHarness({ adapterMode: 'poll_unknown' });
    await harness.manager.waitForIdleV3();

    const job = (await harness.store.loadProjectV3(harness.projectId)).jobs[harness.confirmed.jobId]!;
    expect(job).toMatchObject({ status: 'needs_attention', error: { code: 'poll_deadline' }, spendReceipt: null });
    expect(harness.calls).toMatchObject({ submit: 1, poll: 1, publish: 0 });
  });

  it('fails closed when a selected adapter cannot poll its remote Job', async () => {
    const harness = await createHarness({ omitPoll: true });
    await harness.manager.waitForIdleV3();

    const job = (await harness.store.loadProjectV3(harness.projectId)).jobs[harness.confirmed.jobId]!;
    expect(job).toMatchObject({
      status: 'needs_attention',
      error: { code: 'poll_deadline' },
      providerJobId: 'provider_job_1',
      spendReceipt: null,
    });
    expect(harness.calls).toMatchObject({ submit: 1, poll: 0, publish: 0 });
  });

  it.each([
    null,
    {},
    { status: 'mystery' },
    { status: 'running', progress: Number.NaN },
    { status: 'succeeded', outputs: 'not-an-array' },
    { status: 'failed' },
  ])('fails malformed polling snapshot %# closed to exact same-Job recovery', async (snapshot) => {
    const harness = await createHarness({ dispatchImmediately: false });
    harness.setPollSnapshots([snapshot]);

    await harness.manager.dispatchCommittedJobV3(harness.projectId, harness.confirmed.jobId);
    await harness.manager.waitForIdleV3();

    const waiting = await harness.store.loadProjectV3(harness.projectId);
    expect(waiting.jobs[harness.confirmed.jobId]).toMatchObject({
      status: 'needs_attention',
      providerJobId: 'provider_job_1',
      error: { code: 'poll_deadline' },
    });
    expect(waiting.spendAuthorizations).toHaveLength(1);
    expect(harness.calls).toMatchObject({ submit: 1, poll: 1, publish: 0 });

    harness.setPollSnapshots([{ status: 'succeeded', outputs: [harness.output] }]);
    await harness.manager.resumeJobV3({
      projectId: harness.projectId,
      pieceId: harness.confirmed.pieceId,
      jobId: harness.confirmed.jobId,
      expectedRevision: waiting.revision,
    });
    await harness.manager.waitForIdleV3();

    const recovered = await harness.store.loadProjectV3(harness.projectId);
    expect(recovered.jobs[harness.confirmed.jobId]?.status).toBe('succeeded');
    expect(Object.keys(recovered.jobs)).toEqual([harness.confirmed.jobId]);
    expect(recovered.spendAuthorizations).toHaveLength(1);
    expect(harness.calls).toMatchObject({ submit: 1, poll: 2, publish: 1 });
  });

  it('resumes queued-local work without creating a second authorization or Job', async () => {
    const harness = await createHarness({ dispatchImmediately: false });
    expect(harness.calls.submit).toBe(0);

    await harness.manager.resumePendingJobsV3([harness.projectId]);
    await harness.manager.waitForIdleV3();

    const project = await harness.store.loadProjectV3(harness.projectId);
    expect(project.jobs[harness.confirmed.jobId]?.status).toBe('succeeded');
    expect(project.spendAuthorizations).toHaveLength(1);
    expect(Object.keys(project.jobs)).toEqual([harness.confirmed.jobId]);
    expect(harness.calls.submit).toBe(1);
  });

  it.each(['queued_remote', 'running', 'needs_attention'] as const)(
    'resumes %s by polling the same provider Job and never resubmits',
    async (status) => {
      const harness = await createHarness({ dispatchImmediately: false });
      await setRestartStatus(harness, status);
      harness.setPollSnapshots([{ status: 'succeeded', outputs: [harness.output] }]);

      await harness.manager.resumePendingJobsV3([harness.projectId]);
      await harness.manager.waitForIdleV3();

      const project = await harness.store.loadProjectV3(harness.projectId);
      expect(project.jobs[harness.confirmed.jobId]?.status).toBe('succeeded');
      expect(harness.calls.submit).toBe(0);
      expect(harness.calls.poll).toBe(1);
      expect(Object.keys(project.jobs)).toEqual([harness.confirmed.jobId]);
    }
  );

  it('continues a submitted Job from its frozen provider binding after route and model removal', async () => {
    const harness = await createHarness({ dispatchImmediately: false });
    await setRestartStatus(harness, 'queued_remote');
    harness.setRoutes([]);
    harness.setProviders([
      {
        ...harness.provider,
        models: [],
        enabled: false,
        model_enabled: { 'image-model': false },
        model_health: { 'image-model': { status: 'unhealthy' } },
      },
    ]);
    harness.setPollSnapshots([{ status: 'succeeded', outputs: [harness.output] }]);

    await harness.manager.resumePendingJobsV3([harness.projectId]);
    await harness.manager.waitForIdleV3();

    const project = await harness.store.loadProjectV3(harness.projectId);
    expect(project.jobs[harness.confirmed.jobId]).toMatchObject({
      status: 'succeeded',
      providerJobId: 'provider_job_existing',
    });
    expect(project.spendAuthorizations).toHaveLength(1);
    expect(Object.keys(project.jobs)).toEqual([harness.confirmed.jobId]);
    expect(harness.calls).toMatchObject({ submit: 0, poll: 1, publish: 1 });
  });

  it.each(['credentials', 'adapter'] as const)(
    'keeps a submitted Job in exact same-Job attention when its %s are temporarily missing',
    async (missingAuthority) => {
      const harness = await createHarness({ dispatchImmediately: false });
      await setRestartStatus(harness, 'queued_remote');
      if (missingAuthority === 'credentials') {
        harness.setProviders([{ ...harness.provider, api_key: '' }]);
      } else {
        harness.removeAdapter();
      }

      await harness.manager.resumePendingJobsV3([harness.projectId]);
      await harness.manager.waitForIdleV3();

      const waiting = await harness.store.loadProjectV3(harness.projectId);
      expect(waiting.jobs[harness.confirmed.jobId]).toMatchObject({
        status: 'needs_attention',
        providerJobId: 'provider_job_existing',
        error: { code: 'poll_deadline' },
      });
      expect(waiting.spendAuthorizations).toHaveLength(1);
      expect(harness.calls).toMatchObject({ submit: 0, poll: 0, publish: 0 });

      harness.setProviders([harness.provider]);
      harness.restoreAdapter();
      harness.setPollSnapshots([{ status: 'succeeded', outputs: [harness.output] }]);
      await harness.manager.resumeJobV3({
        projectId: harness.projectId,
        pieceId: harness.confirmed.pieceId,
        jobId: harness.confirmed.jobId,
        expectedRevision: waiting.revision,
      });
      await harness.manager.waitForIdleV3();

      const recovered = await harness.store.loadProjectV3(harness.projectId);
      expect(recovered.jobs[harness.confirmed.jobId]?.status).toBe('succeeded');
      expect(Object.keys(recovered.jobs)).toEqual([harness.confirmed.jobId]);
      expect(recovered.spendAuthorizations).toHaveLength(1);
      expect(harness.calls).toMatchObject({ submit: 0, poll: 1, publish: 1 });
    }
  );

  it('turns an interrupted submitting state into submission_unknown without a second provider call', async () => {
    const harness = await createHarness({ dispatchImmediately: false });
    await setRestartStatus(harness, 'submitting');

    await harness.manager.resumePendingJobsV3([harness.projectId]);
    await harness.manager.waitForIdleV3();

    const project = await harness.store.loadProjectV3(harness.projectId);
    expect(project.jobs[harness.confirmed.jobId]).toMatchObject({
      status: 'needs_attention',
      error: { code: 'submission_unknown' },
    });
    expect(harness.calls.submit).toBe(0);
    expect(harness.calls.poll).toBe(0);
  });

  it('cancels a durable queued-local Job without provider work or deleting authorization history', async () => {
    const harness = await createHarness({ dispatchImmediately: false });

    const result = await harness.manager.cancelJobV3({
      projectId: harness.projectId,
      pieceId: harness.confirmed.pieceId,
      jobId: harness.confirmed.jobId,
    });

    const project = await harness.store.loadProjectV3(harness.projectId);
    expect(result).toMatchObject({ status: 'cancelled', jobId: harness.confirmed.jobId });
    expect(project.jobs[harness.confirmed.jobId]?.status).toBe('cancelled');
    expect(project.spendAuthorizations).toHaveLength(1);
    expect(harness.calls).toMatchObject({ submit: 0, poll: 0, cancel: 0, publish: 0 });
  });

  it('cancels queued remote work through the selected provider and keeps the Job record', async () => {
    const harness = await createHarness({ dispatchImmediately: false });
    await setRestartStatus(harness, 'queued_remote');

    const result = await harness.manager.cancelJobV3({
      projectId: harness.projectId,
      pieceId: harness.confirmed.pieceId,
      jobId: harness.confirmed.jobId,
    });

    const project = await harness.store.loadProjectV3(harness.projectId);
    expect(result).toMatchObject({ status: 'cancelled', jobId: harness.confirmed.jobId });
    expect(project.jobs[harness.confirmed.jobId]).toMatchObject({ status: 'cancelled', spendReceipt: null });
    expect(harness.calls.cancelledProviderJobIds).toEqual(['provider_job_existing']);
  });

  it('cancels submitted work from the frozen provider binding after its current route is removed', async () => {
    const harness = await createHarness({ dispatchImmediately: false });
    await setRestartStatus(harness, 'queued_remote');
    harness.setRoutes([]);
    harness.setProviders([
      {
        ...harness.provider,
        models: [],
        enabled: false,
        model_enabled: { 'image-model': false },
      },
    ]);

    const result = await harness.manager.cancelJobV3({
      projectId: harness.projectId,
      pieceId: harness.confirmed.pieceId,
      jobId: harness.confirmed.jobId,
    });

    const project = await harness.store.loadProjectV3(harness.projectId);
    expect(result).toMatchObject({ status: 'cancelled', jobId: harness.confirmed.jobId });
    expect(project.jobs[harness.confirmed.jobId]?.status).toBe('cancelled');
    expect(project.spendAuthorizations).toHaveLength(1);
    expect(harness.calls).toMatchObject({ submit: 0, poll: 0, cancel: 1, publish: 0 });
    expect(harness.calls.cancelledProviderJobIds).toEqual(['provider_job_existing']);
  });

  it('reserves queued-only cancellation authority while a concurrent poll tries to advance the Job', async () => {
    let releasePoll: (() => void) | undefined;
    let releaseCancellation: (() => void) | undefined;
    const pollGate = new Promise<void>((resolve) => {
      releasePoll = resolve;
    });
    const cancellationGate = new Promise<void>((resolve) => {
      releaseCancellation = resolve;
    });
    const harness = await createHarness({
      dispatchImmediately: false,
      cancellationPolicy: 'queued_only',
      adapterMode: 'poll_running_then_never',
      cancellationGate,
    });
    await setRestartStatus(harness, 'queued_remote');
    harness.setPollSnapshots([{ status: 'running', progress: 50 }]);
    harness.setPollGate(pollGate);
    await harness.manager.dispatchCommittedJobV3(harness.projectId, harness.confirmed.jobId);
    await expect.poll(() => harness.calls.poll).toBe(1);

    const cancellation = harness.manager.cancelJobV3({
      projectId: harness.projectId,
      pieceId: harness.confirmed.pieceId,
      jobId: harness.confirmed.jobId,
    });
    await expect.poll(() => harness.calls.cancel).toBe(1);
    releasePoll!();
    await expect
      .poll(async () => (await harness.store.loadProjectV3(harness.projectId)).jobs[harness.confirmed.jobId]?.status)
      .toBe('queued_remote');

    releaseCancellation!();
    await expect(cancellation).resolves.toMatchObject({ status: 'cancelled', jobId: harness.confirmed.jobId });
    await harness.manager.waitForIdleV3();
    expect((await harness.store.loadProjectV3(harness.projectId)).jobs[harness.confirmed.jobId]?.status).toBe(
      'cancelled'
    );
    expect(harness.calls.cancel).toBe(1);
  });

  it('preserves a concurrent terminal poll result when provider cancellation is refused', async () => {
    let releasePoll: (() => void) | undefined;
    let releaseCancellation: (() => void) | undefined;
    const pollGate = new Promise<void>((resolve) => {
      releasePoll = resolve;
    });
    const cancellationGate = new Promise<void>((resolve) => {
      releaseCancellation = resolve;
    });
    const harness = await createHarness({
      dispatchImmediately: false,
      adapterMode: 'cancel_refused',
      cancellationGate,
    });
    await setRestartStatus(harness, 'queued_remote');
    harness.setPollSnapshots([{ status: 'failed', error: { code: 'auth' } }]);
    harness.setPollGate(pollGate);
    await harness.manager.dispatchCommittedJobV3(harness.projectId, harness.confirmed.jobId);
    await expect.poll(() => harness.calls.poll).toBe(1);

    const cancellation = harness.manager.cancelJobV3({
      projectId: harness.projectId,
      pieceId: harness.confirmed.pieceId,
      jobId: harness.confirmed.jobId,
    });
    await expect.poll(() => harness.calls.cancel).toBe(1);
    releasePoll!();
    await harness.manager.waitForIdleV3();
    expect((await harness.store.loadProjectV3(harness.projectId)).jobs[harness.confirmed.jobId]).toMatchObject({
      status: 'failed',
      error: { code: 'auth' },
      spendReceipt: null,
    });

    releaseCancellation!();
    await expect(cancellation).rejects.toMatchObject({ code: 'cancellation_refused' });
    expect((await harness.store.loadProjectV3(harness.projectId)).jobs[harness.confirmed.jobId]?.status).toBe('failed');
  });

  it('preserves a concurrent provider-cancelled result when the cancellation request is refused', async () => {
    let releasePoll: (() => void) | undefined;
    let releaseCancellation: (() => void) | undefined;
    const pollGate = new Promise<void>((resolve) => {
      releasePoll = resolve;
    });
    const cancellationGate = new Promise<void>((resolve) => {
      releaseCancellation = resolve;
    });
    const harness = await createHarness({
      dispatchImmediately: false,
      adapterMode: 'cancel_refused',
      cancellationGate,
    });
    await setRestartStatus(harness, 'queued_remote');
    harness.setPollSnapshots([{ status: 'cancelled', error: { code: 'unknown' } }]);
    harness.setPollGate(pollGate);
    await harness.manager.dispatchCommittedJobV3(harness.projectId, harness.confirmed.jobId);
    await expect.poll(() => harness.calls.poll).toBe(1);

    const cancellation = harness.manager.cancelJobV3({
      projectId: harness.projectId,
      pieceId: harness.confirmed.pieceId,
      jobId: harness.confirmed.jobId,
    });
    await expect.poll(() => harness.calls.cancel).toBe(1);
    releasePoll!();
    await harness.manager.waitForIdleV3();
    expect((await harness.store.loadProjectV3(harness.projectId)).jobs[harness.confirmed.jobId]).toMatchObject({
      status: 'cancelled',
      error: null,
      spendReceipt: null,
    });

    releaseCancellation!();
    await expect(cancellation).rejects.toMatchObject({ code: 'cancellation_refused' });
    expect((await harness.store.loadProjectV3(harness.projectId)).jobs[harness.confirmed.jobId]?.status).toBe(
      'cancelled'
    );
  });

  it('admits only one provider cancellation while two requests race for the same Job', async () => {
    let releaseCancellation: (() => void) | undefined;
    const cancellationGate = new Promise<void>((resolve) => {
      releaseCancellation = resolve;
    });
    const harness = await createHarness({ dispatchImmediately: false, cancellationGate });
    await setRestartStatus(harness, 'queued_remote');

    const first = harness.manager.cancelJobV3({
      projectId: harness.projectId,
      pieceId: harness.confirmed.pieceId,
      jobId: harness.confirmed.jobId,
    });
    await expect.poll(() => harness.calls.cancel).toBe(1);
    await expect(
      harness.manager.cancelJobV3({
        projectId: harness.projectId,
        pieceId: harness.confirmed.pieceId,
        jobId: harness.confirmed.jobId,
      })
    ).rejects.toMatchObject({ code: 'cancellation_refused' });
    expect(harness.calls.cancel).toBe(1);

    releaseCancellation!();
    await expect(first).resolves.toMatchObject({ status: 'cancelled', jobId: harness.confirmed.jobId });
    expect(harness.calls.cancel).toBe(1);
  });

  it('does not strand cancellation authority across an unresolved provider lookup and disposal', async () => {
    let releaseProviders: (() => void) | undefined;
    const listProvidersGate = new Promise<void>((resolve) => {
      releaseProviders = resolve;
    });
    const harness = await createHarness({ dispatchImmediately: false, listProvidersGate });
    await setRestartStatus(harness, 'queued_remote');

    const cancellation = harness.manager.cancelJobV3({
      projectId: harness.projectId,
      pieceId: harness.confirmed.pieceId,
      jobId: harness.confirmed.jobId,
    });
    await expect.poll(() => harness.calls.listProviders).toBe(1);

    await expect(settleWithin(harness.manager.dispose())).resolves.toBeUndefined();
    expect(harness.calls.cancel).toBe(0);
    releaseProviders!();
    await expect(settleWithin(cancellation)).rejects.toMatchObject({ code: 'runtime_inactive' });

    expect(harness.calls.cancel).toBe(0);
    expect((await harness.store.loadProjectV3(harness.projectId)).jobs[harness.confirmed.jobId]).toMatchObject({
      status: 'queued_remote',
      providerJobId: 'provider_job_existing',
      spendReceipt: null,
    });
  });

  it('does not install a cancellation claim after disposal during durable-output inspection', async () => {
    let releaseInspection: (() => void) | undefined;
    const outputClaimInspectionGate = new Promise<void>((resolve) => {
      releaseInspection = resolve;
    });
    const harness = await createHarness({ dispatchImmediately: false, outputClaimInspectionGate });
    await setRestartStatus(harness, 'queued_remote');

    const cancellation = harness.manager.cancelJobV3({
      projectId: harness.projectId,
      pieceId: harness.confirmed.pieceId,
      jobId: harness.confirmed.jobId,
    });
    await expect.poll(() => harness.calls.inspectOutputClaim).toBe(1);
    await expect(settleWithin(harness.manager.dispose())).resolves.toBeUndefined();

    releaseInspection!();
    await expect(settleWithin(cancellation)).rejects.toMatchObject({ code: 'cancellation_refused' });
    expect(harness.calls.cancel).toBe(0);
    expect((await harness.store.loadProjectV3(harness.projectId)).jobs[harness.confirmed.jobId]).toMatchObject({
      status: 'queued_remote',
      providerJobId: 'provider_job_existing',
      spendReceipt: null,
    });
  });

  it('records paid remote output before a pre-intent publication failure can lose to cancellation', async () => {
    let releasePoll: (() => void) | undefined;
    let releaseCancellation: (() => void) | undefined;
    const pollGate = new Promise<void>((resolve) => {
      releasePoll = resolve;
    });
    const cancellationGate = new Promise<void>((resolve) => {
      releaseCancellation = resolve;
    });
    const harness = await createHarness({
      dispatchImmediately: false,
      cancellationGate,
      preIntentPublicationErrorCodes: ['download_failed'],
    });
    await setRestartStatus(harness, 'queued_remote');
    const before = await harness.store.loadProjectV3(harness.projectId);
    const beforeJob = structuredClone(before.jobs[harness.confirmed.jobId]!);
    harness.setPollSnapshots([{ status: 'succeeded', outputs: [harness.output] }]);
    harness.setPollGate(pollGate);
    await harness.manager.dispatchCommittedJobV3(harness.projectId, harness.confirmed.jobId);
    await expect.poll(() => harness.calls.poll).toBe(1);

    const cancellation = harness.manager.cancelJobV3({
      projectId: harness.projectId,
      pieceId: harness.confirmed.pieceId,
      jobId: harness.confirmed.jobId,
    });
    await expect.poll(() => harness.calls.cancel).toBe(1);
    releasePoll!();
    await expect.poll(() => harness.calls.publish).toBe(1);
    await harness.manager.waitForIdleV3();

    const paid = await harness.store.loadProjectV3(harness.projectId);
    expect(paid.jobs[harness.confirmed.jobId]).toMatchObject({
      status: 'needs_attention',
      providerSubmissionKind: 'remote',
      providerJobId: beforeJob.providerJobId,
      authorizationId: beforeJob.authorizationId,
      error: { code: 'poll_deadline' },
      spendReceipt: { jobId: harness.confirmed.jobId },
    });
    expect(paid.pieces[harness.confirmed.pieceId]).toMatchObject({
      currentAssetId: null,
      jobIds: before.pieces[harness.confirmed.pieceId]!.jobIds,
    });

    releaseCancellation!();
    await expect(cancellation).rejects.toMatchObject({ code: 'cancellation_refused' });
    expect(harness.calls.cancel).toBe(1);
    expect((await harness.store.loadProjectV3(harness.projectId)).jobs[harness.confirmed.jobId]?.status).not.toBe(
      'cancelled'
    );
  });

  it('keeps receipt-bearing same-Job polling recoverable after another pre-intent publication failure', async () => {
    const harness = await createHarness({
      dispatchImmediately: false,
      preIntentPublicationErrorCodes: ['download_failed'],
    });
    const waiting = await setRestartStatus(harness, 'needs_attention', true);
    const originalReceipt = structuredClone(waiting.jobs[harness.confirmed.jobId]!.spendReceipt);
    harness.setPollSnapshots([{ status: 'succeeded', outputs: [harness.output] }]);

    await expect(
      harness.manager.resumeJobV3({
        projectId: harness.projectId,
        pieceId: harness.confirmed.pieceId,
        jobId: harness.confirmed.jobId,
        expectedRevision: waiting.revision,
      })
    ).resolves.toMatchObject({ status: 'recovering', jobId: harness.confirmed.jobId });
    await harness.manager.waitForIdleV3();

    const retriable = await harness.store.loadProjectV3(harness.projectId);
    expect(retriable.jobs[harness.confirmed.jobId]).toMatchObject({
      status: 'needs_attention',
      providerSubmissionKind: 'remote',
      providerJobId: 'provider_job_existing',
      error: { code: 'poll_deadline' },
      spendReceipt: originalReceipt,
    });
    expect(harness.calls).toMatchObject({ poll: 1, publish: 1, cancel: 0 });
    await expect(
      harness.manager.cancelJobV3({
        projectId: harness.projectId,
        pieceId: harness.confirmed.pieceId,
        jobId: harness.confirmed.jobId,
      })
    ).rejects.toMatchObject({ code: 'cancellation_refused' });
    expect(harness.calls.cancel).toBe(0);
  });

  it.each([
    [{ adapterMode: 'cancel_refused' as const }, 'provider refusal'],
    [{ omitCancel: true }, 'missing cancellation support'],
    [{ cancellationPolicy: 'none' as const }, 'non-cancellable route'],
  ])('keeps queued remote work when cancellation meets $1', async (options) => {
    const harness = await createHarness({ dispatchImmediately: false, ...options });
    await setRestartStatus(harness, 'queued_remote');

    await expect(
      harness.manager.cancelJobV3({
        projectId: harness.projectId,
        pieceId: harness.confirmed.pieceId,
        jobId: harness.confirmed.jobId,
      })
    ).rejects.toMatchObject({ code: 'cancellation_refused' });
    expect((await harness.store.loadProjectV3(harness.projectId)).jobs[harness.confirmed.jobId]?.status).toBe(
      'queued_remote'
    );
  });

  it('refuses to cancel running work when the route only permits queued cancellation', async () => {
    const harness = await createHarness({ dispatchImmediately: false, cancellationPolicy: 'queued_only' });
    await setRestartStatus(harness, 'running');

    await expect(
      harness.manager.cancelJobV3({
        projectId: harness.projectId,
        pieceId: harness.confirmed.pieceId,
        jobId: harness.confirmed.jobId,
      })
    ).rejects.toMatchObject({ code: 'cancellation_refused' });
    expect(harness.calls.cancel).toBe(0);
  });

  it('refuses to cancel needs-attention work when the route only permits queued cancellation', async () => {
    const harness = await createHarness({ dispatchImmediately: false, cancellationPolicy: 'queued_only' });
    await setRestartStatus(harness, 'needs_attention');

    await expect(
      harness.manager.cancelJobV3({
        projectId: harness.projectId,
        pieceId: harness.confirmed.pieceId,
        jobId: harness.confirmed.jobId,
      })
    ).rejects.toMatchObject({ code: 'cancellation_refused' });
    expect(harness.calls.cancel).toBe(0);
    expect((await harness.store.loadProjectV3(harness.projectId)).jobs[harness.confirmed.jobId]).toMatchObject({
      status: 'needs_attention',
      error: { code: 'poll_deadline' },
      spendReceipt: null,
    });
  });

  it.each(['running', 'needs_attention'] as const)(
    'refuses to call provider cancellation for receipt-bearing %s work',
    async (status) => {
      const harness = await createHarness({ dispatchImmediately: false });
      await setRestartStatus(harness, status, true);

      await expect(
        harness.manager.cancelJobV3({
          projectId: harness.projectId,
          pieceId: harness.confirmed.pieceId,
          jobId: harness.confirmed.jobId,
        })
      ).rejects.toMatchObject({ code: 'cancellation_refused' });
      expect(harness.calls.cancel).toBe(0);
      expect((await harness.store.loadProjectV3(harness.projectId)).jobs[harness.confirmed.jobId]).toMatchObject({
        status,
        spendReceipt: { jobId: harness.confirmed.jobId },
      });
    }
  );

  it('refuses provider cancellation when a durable generated-output claim survived the in-memory handoff', async () => {
    const harness = await createHarness({
      dispatchImmediately: false,
      durableOutputClaimInspections: ['claimed'],
    });
    await setRestartStatus(harness, 'needs_attention');

    await expect(
      harness.manager.cancelJobV3({
        projectId: harness.projectId,
        pieceId: harness.confirmed.pieceId,
        jobId: harness.confirmed.jobId,
      })
    ).rejects.toMatchObject({ code: 'cancellation_refused' });

    expect(harness.calls).toMatchObject({ cancel: 0, inspectOutputClaim: 1 });
    expect((await harness.store.loadProjectV3(harness.projectId)).jobs[harness.confirmed.jobId]).toMatchObject({
      status: 'needs_attention',
      error: { code: 'poll_deadline' },
      spendReceipt: null,
      providerJobId: 'provider_job_existing',
    });
  });

  it('refuses the cancellation commit when paid output becomes durable during the provider call', async () => {
    const harness = await createHarness({
      dispatchImmediately: false,
      durableOutputClaimInspections: ['clear', 'clear', 'claimed'],
    });
    await setRestartStatus(harness, 'queued_remote');

    await expect(
      harness.manager.cancelJobV3({
        projectId: harness.projectId,
        pieceId: harness.confirmed.pieceId,
        jobId: harness.confirmed.jobId,
      })
    ).rejects.toMatchObject({ code: 'cancellation_refused' });

    expect(harness.calls).toMatchObject({ cancel: 1, inspectOutputClaim: 3 });
    expect((await harness.store.loadProjectV3(harness.projectId)).jobs[harness.confirmed.jobId]).toMatchObject({
      status: 'queued_remote',
      spendReceipt: null,
      providerJobId: 'provider_job_existing',
    });
  });

  it('fails cancellation closed when durable output authority cannot be inspected', async () => {
    const harness = await createHarness({
      dispatchImmediately: false,
      durableOutputClaimInspections: ['error'],
    });
    await setRestartStatus(harness, 'running');

    await expect(
      harness.manager.cancelJobV3({
        projectId: harness.projectId,
        pieceId: harness.confirmed.pieceId,
        jobId: harness.confirmed.jobId,
      })
    ).rejects.toMatchObject({ code: 'cancellation_refused' });

    expect(harness.calls).toMatchObject({ cancel: 0, inspectOutputClaim: 1 });
    expect((await harness.store.loadProjectV3(harness.projectId)).jobs[harness.confirmed.jobId]?.status).toBe(
      'running'
    );
  });

  it('refuses cancellation when the request names a different Piece', async () => {
    const harness = await createHarness({ dispatchImmediately: false });

    await expect(
      harness.manager.cancelJobV3({
        projectId: harness.projectId,
        pieceId: 'piece_different',
        jobId: harness.confirmed.jobId,
      })
    ).rejects.toMatchObject({ code: 'cancellation_refused' });
    expect((await harness.store.loadProjectV3(harness.projectId)).jobs[harness.confirmed.jobId]?.status).toBe(
      'queued_local'
    );
  });

  it('marks submitting work ambiguous when cancellation cannot prove no charge', async () => {
    const harness = await createHarness({ dispatchImmediately: false });
    await setRestartStatus(harness, 'submitting');

    await expect(
      harness.manager.cancelJobV3({
        projectId: harness.projectId,
        pieceId: harness.confirmed.pieceId,
        jobId: harness.confirmed.jobId,
      })
    ).rejects.toMatchObject({ code: 'cancellation_refused' });
    expect((await harness.store.loadProjectV3(harness.projectId)).jobs[harness.confirmed.jobId]).toMatchObject({
      status: 'needs_attention',
      error: { code: 'submission_unknown' },
    });
  });

  it('refuses cancellation after paid output handoff begins and publishes with a non-cancellable signal', async () => {
    let releasePublication: (() => void) | undefined;
    const publicationGate = new Promise<void>((resolve) => {
      releasePublication = resolve;
    });
    const harness = await createHarness({ publicationGate });
    await expect.poll(() => harness.calls.publish).toBe(1);

    await expect(
      harness.manager.cancelJobV3({
        projectId: harness.projectId,
        pieceId: harness.confirmed.pieceId,
        jobId: harness.confirmed.jobId,
      })
    ).rejects.toMatchObject({ code: 'cancellation_refused' });
    expect(harness.calls.cancel).toBe(0);
    expect(harness.calls.publicationSignals).toHaveLength(1);
    expect(harness.calls.publicationSignals[0]!.aborted).toBe(false);

    releasePublication!();
    await harness.manager.waitForIdleV3();
    const project = await harness.store.loadProjectV3(harness.projectId);
    expect(project.jobs[harness.confirmed.jobId]).toMatchObject({
      status: 'succeeded',
      providerSubmissionKind: 'remote',
      providerJobId: 'provider_job_1',
      spendReceipt: { jobId: harness.confirmed.jobId },
    });
    expect(project.pieces[harness.confirmed.pieceId]!.currentAssetId).toBe(
      project.jobs[harness.confirmed.jobId]!.outputAssetId
    );
  });

  it('never reports cancelled when a stale queued snapshot races with submission', async () => {
    let releaseSubmit: (() => void) | undefined;
    const submitGate = new Promise<void>((resolve) => {
      releaseSubmit = resolve;
    });
    const harness = await createHarness({ dispatchImmediately: false, submitGate });
    const originalLoad = harness.store.loadProjectV3.bind(harness.store);
    let interceptCancellationLoad = true;
    harness.store.loadProjectV3 = async (projectId) => {
      const staleSnapshot = await originalLoad(projectId);
      if (!interceptCancellationLoad) return staleSnapshot;
      interceptCancellationLoad = false;
      await harness.manager.dispatchCommittedJobV3(harness.projectId, harness.confirmed.jobId);
      await expect.poll(() => harness.calls.submit).toBe(1);
      return staleSnapshot;
    };

    await expect(
      harness.manager.cancelJobV3({
        projectId: harness.projectId,
        pieceId: harness.confirmed.pieceId,
        jobId: harness.confirmed.jobId,
      })
    ).rejects.toMatchObject({ code: 'cancellation_refused' });
    expect((await originalLoad(harness.projectId)).jobs[harness.confirmed.jobId]?.status).toBe('submitting');

    releaseSubmit!();
    await harness.manager.waitForIdleV3();
    expect((await originalLoad(harness.projectId)).jobs[harness.confirmed.jobId]?.status).toBe('succeeded');
  });

  it('retries paid output download on the same Job and refuses stale or duplicate recovery requests', async () => {
    const harness = await createHarness({ publicationErrorCodes: ['download_failed'] });
    await harness.manager.waitForIdleV3();

    const failed = await harness.store.loadProjectV3(harness.projectId);
    const failedJob = structuredClone(failed.jobs[harness.confirmed.jobId]!);
    expect(failedJob).toMatchObject({
      status: 'failed',
      providerJobId: 'provider_job_1',
      error: { code: 'download_failed' },
    });
    expect(failedJob.spendReceipt).not.toBeNull();

    await expect(
      harness.manager.retryDownloadV3({
        projectId: harness.projectId,
        pieceId: harness.confirmed.pieceId,
        jobId: harness.confirmed.jobId,
        expectedRevision: failed.revision - 1,
      })
    ).rejects.toMatchObject({ code: 'stale_project' });

    let releasePoll: (() => void) | undefined;
    harness.setPollGate(
      new Promise<void>((resolve) => {
        releasePoll = resolve;
      })
    );
    harness.setPollSnapshots([{ status: 'succeeded', outputs: [harness.output] }]);
    const recovery = await harness.manager.retryDownloadV3({
      projectId: harness.projectId,
      pieceId: harness.confirmed.pieceId,
      jobId: harness.confirmed.jobId,
      expectedRevision: failed.revision,
    });

    await expect(
      harness.manager.retryDownloadV3({
        projectId: harness.projectId,
        pieceId: harness.confirmed.pieceId,
        jobId: harness.confirmed.jobId,
        expectedRevision: recovery.revision,
      })
    ).rejects.toMatchObject({ code: 'busy' });
    releasePoll!();
    await harness.manager.waitForIdleV3();

    const succeeded = await harness.store.loadProjectV3(harness.projectId);
    const succeededJob = succeeded.jobs[harness.confirmed.jobId]!;
    expect(succeededJob).toMatchObject({
      id: failedJob.id,
      status: 'succeeded',
      providerJobId: failedJob.providerJobId,
      authorizationId: failedJob.authorizationId,
      spendReceipt: failedJob.spendReceipt,
    });
    expect(harness.calls.submit).toBe(1);
    expect(harness.calls.polledProviderJobIds.at(-1)).toBe('provider_job_1');
    expect(Object.keys(succeeded.jobs)).toEqual([failedJob.id]);
    expect(succeeded.spendAuthorizations).toHaveLength(1);
  });

  it('replays durable media for an explicit complete-only Job without polling or resubmitting', async () => {
    const harness = await createHarness({
      adapterMode: 'local_success',
      publicationErrorCodes: ['download_failed'],
      recoverGeneratedMedia: true,
    });
    await harness.manager.waitForIdleV3();

    const failed = await harness.store.loadProjectV3(harness.projectId);
    const failedJob = structuredClone(failed.jobs[harness.confirmed.jobId]!);
    expect(failedJob).toMatchObject({
      status: 'failed',
      providerSubmissionKind: 'complete',
      providerJobId: null,
      error: { code: 'download_failed' },
    });
    expect(failedJob.spendReceipt).not.toBeNull();

    const recovery = await harness.manager.retryDownloadV3({
      projectId: harness.projectId,
      pieceId: harness.confirmed.pieceId,
      jobId: harness.confirmed.jobId,
      expectedRevision: failed.revision,
    });

    const recovered = await harness.store.loadProjectV3(harness.projectId);
    expect(recovery).toMatchObject({ status: 'recovering', jobId: failedJob.id, revision: recovered.revision });
    expect(recovered.jobs[failedJob.id]).toMatchObject({
      id: failedJob.id,
      status: 'succeeded',
      providerJobId: failedJob.providerJobId,
      authorizationId: failedJob.authorizationId,
      spendReceipt: failedJob.spendReceipt,
    });
    expect(recovered.pieces[harness.confirmed.pieceId]?.currentAssetId).toBe(
      recovered.jobs[failedJob.id]?.outputAssetId
    );
    expect(recovered.spendAuthorizations).toHaveLength(1);
    expect(Object.keys(recovered.jobs)).toEqual([failedJob.id]);
    expect(harness.calls).toMatchObject({ submit: 1, poll: 0, publish: 1, recoverMedia: 1 });
  });

  it('refuses complete-only media recovery when the Project changes after the initial retry claim', async () => {
    const harness = await createHarness({
      adapterMode: 'local_success',
      publicationErrorCodes: ['download_failed'],
      recoverGeneratedMedia: true,
    });
    await harness.manager.waitForIdleV3();

    const failed = await harness.store.loadProjectV3(harness.projectId);
    const failedJob = failed.jobs[harness.confirmed.jobId]!;
    const originalLoad = harness.store.loadProjectV3.bind(harness.store);
    let raceInitialRetryLoad = true;
    harness.store.loadProjectV3 = async (projectId) => {
      const snapshot = await originalLoad(projectId);
      if (raceInitialRetryLoad) {
        raceInitialRetryLoad = false;
        await harness.store.updateProjectV3(projectId, (draft) => draft, {
          kind: 'runtime',
          expectedRevision: snapshot.revision,
        });
      }
      return snapshot;
    };

    await expect(
      harness.manager.retryDownloadV3({
        projectId: harness.projectId,
        pieceId: harness.confirmed.pieceId,
        jobId: failedJob.id,
        expectedRevision: failed.revision,
      })
    ).rejects.toMatchObject({ code: 'stale_project' });

    const raced = await originalLoad(harness.projectId);
    expect(raced.jobs[failedJob.id]).toMatchObject({
      status: 'failed',
      providerSubmissionKind: 'complete',
      providerJobId: null,
      outputAssetId: null,
      error: { code: 'download_failed' },
    });
    expect(raced.pieces[harness.confirmed.pieceId]?.currentAssetId).toBeNull();
    expect(harness.calls).toMatchObject({ submit: 1, poll: 0, publish: 1, recoverMedia: 1 });
  });

  it.each([false, true])(
    'resumes a poll-deadline Job with receipt=%s on the same provider Job',
    async (withReceipt) => {
      const harness = await createHarness({ dispatchImmediately: false });
      const waiting = await setRestartStatus(harness, 'needs_attention', withReceipt);
      harness.setPollSnapshots([{ status: 'succeeded', outputs: [harness.output] }]);

      const recovery = await harness.manager.resumeJobV3({
        projectId: harness.projectId,
        pieceId: harness.confirmed.pieceId,
        jobId: harness.confirmed.jobId,
        expectedRevision: waiting.revision,
      });
      await harness.manager.waitForIdleV3();

      const project = await harness.store.loadProjectV3(harness.projectId);
      expect(recovery).toMatchObject({ status: 'recovering', jobId: harness.confirmed.jobId });
      expect(project.jobs[harness.confirmed.jobId]).toMatchObject({
        status: 'succeeded',
        providerJobId: 'provider_job_existing',
      });
      expect(harness.calls).toMatchObject({ submit: 0, poll: 1, publish: 1 });
      expect(harness.calls.polledProviderJobIds).toEqual(['provider_job_existing']);
      expect(Object.keys(project.jobs)).toEqual([harness.confirmed.jobId]);
      expect(project.spendAuthorizations).toHaveLength(1);
    }
  );

  it.each([
    ['invalid_media', 'no_output'],
    ['variation_grid', 'variation_grid'],
    ['download_failed', 'download_failed'],
    ['storage_error', 'download_failed'],
  ] as const)('classifies publication error %s as %s after recording spend', async (rawCode, expectedCode) => {
    const harness = await createHarness({ publicationErrorCodes: [rawCode] });
    await harness.manager.waitForIdleV3();

    const project = await harness.store.loadProjectV3(harness.projectId);
    const job = project.jobs[harness.confirmed.jobId]!;
    expect(job).toMatchObject({ status: 'failed', error: { code: expectedCode }, outputAssetId: null });
    expect(job.spendReceipt).not.toBeNull();
    expect(project.pieces[harness.confirmed.pieceId]?.currentAssetId).toBeNull();
  });

  it('bounds a provider submission that never resolves and disposes cleanly', async () => {
    const harness = await createHarness({ adapterMode: 'never_submit', submissionTimeoutMs: 20 });

    await settleWithin(harness.manager.waitForIdleV3());
    const project = await harness.store.loadProjectV3(harness.projectId);
    expect(project.jobs[harness.confirmed.jobId]).toMatchObject({
      status: 'needs_attention',
      error: { code: 'submission_unknown' },
    });
    expect(harness.calls.submit).toBe(1);
    await expect(settleWithin(harness.manager.dispose())).resolves.toBeUndefined();
  });

  it('bounds provider polling that never resolves and disposes cleanly', async () => {
    const harness = await createHarness({ adapterMode: 'never_poll', pollAttemptTimeoutMs: 20 });

    await settleWithin(harness.manager.waitForIdleV3());
    const project = await harness.store.loadProjectV3(harness.projectId);
    expect(project.jobs[harness.confirmed.jobId]).toMatchObject({
      status: 'needs_attention',
      error: { code: 'poll_deadline' },
    });
    expect(harness.calls).toMatchObject({ submit: 1, poll: 1, publish: 0 });
    await expect(settleWithin(harness.manager.dispose())).resolves.toBeUndefined();
  });

  it('bounds provider cancellation that never resolves and disposes cleanly', async () => {
    const harness = await createHarness({
      dispatchImmediately: false,
      adapterMode: 'never_cancel',
      cancellationTimeoutMs: 20,
    });
    await setRestartStatus(harness, 'queued_remote');

    await expect(
      settleWithin(
        harness.manager.cancelJobV3({
          projectId: harness.projectId,
          pieceId: harness.confirmed.pieceId,
          jobId: harness.confirmed.jobId,
        })
      )
    ).rejects.toMatchObject({ code: 'cancellation_refused' });
    expect(harness.calls.cancelledProviderJobIds).toEqual(['provider_job_existing']);
    expect((await harness.store.loadProjectV3(harness.projectId)).jobs[harness.confirmed.jobId]?.status).toBe(
      'queued_remote'
    );
    await expect(settleWithin(harness.manager.dispose())).resolves.toBeUndefined();
  });

  it('continues startup recovery after one Project transition fails', async () => {
    const harness = await createHarness({ dispatchImmediately: false });
    const peer = await harness.createAdditionalQueuedJob();
    await setRestartStatus(harness, 'submitting');
    const withAuthority = harness.store.withProjectAuthorityV3.bind(harness.store);
    let failFirstTransition = true;
    harness.store.withProjectAuthorityV3 = async <T>(
      projectId: string,
      operation: (snapshot: StudioPilotProjectAuthoritySnapshotV3) => Promise<T>
    ): Promise<T> => {
      if (projectId === harness.projectId && failFirstTransition) {
        failFirstTransition = false;
        throw new Error('injected recovery write failure');
      }
      return withAuthority(projectId, operation);
    };

    await harness.manager.resumePendingJobsV3([harness.projectId, peer.projectId]);
    await harness.manager.waitForIdleV3();

    const failedProject = await harness.store.loadProjectV3(harness.projectId);
    const recoveredPeer = await harness.store.loadProjectV3(peer.projectId);
    expect(failedProject.jobs[harness.confirmed.jobId]?.status).toBe('submitting');
    expect(recoveredPeer.jobs[peer.confirmed.jobId]?.status).toBe('succeeded');
    expect(harness.calls.submit).toBe(1);
    expect(Object.keys(recoveredPeer.jobs)).toEqual([peer.confirmed.jobId]);
  });

  it('discovers queued work from the healthy-project inventory when no recovery list is supplied', async () => {
    const harness = await createHarness({ dispatchImmediately: false });

    await harness.manager.resumePendingJobsV3();
    await harness.manager.waitForIdleV3();

    expect((await harness.store.loadProjectV3(harness.projectId)).jobs[harness.confirmed.jobId]?.status).toBe(
      'succeeded'
    );
    expect(harness.calls.submit).toBe(1);
  });

  it('rejects dispatching a terminal Job', async () => {
    const harness = await createHarness();
    await harness.manager.waitForIdleV3();

    await expect(
      harness.manager.dispatchCommittedJobV3(harness.projectId, harness.confirmed.jobId)
    ).rejects.toMatchObject({ code: 'job_ineligible' });
    expect(harness.calls.submit).toBe(1);
  });

  it('makes disposal idempotent and refuses every scheduling entry point afterward', async () => {
    const harness = await createHarness({ dispatchImmediately: false });
    await harness.manager.dispose();

    await expect(harness.manager.dispose()).resolves.toBeUndefined();
    await expect(
      harness.manager.dispatchCommittedJobV3(harness.projectId, harness.confirmed.jobId)
    ).rejects.toMatchObject({ code: 'runtime_inactive' });
    await expect(harness.manager.resumePendingJobsV3()).rejects.toMatchObject({ code: 'runtime_inactive' });
    await expect(
      harness.manager.resumeJobV3({
        projectId: harness.projectId,
        pieceId: harness.confirmed.pieceId,
        jobId: harness.confirmed.jobId,
        expectedRevision: harness.confirmed.revision,
      })
    ).rejects.toMatchObject({ code: 'runtime_inactive' });
  });
});
