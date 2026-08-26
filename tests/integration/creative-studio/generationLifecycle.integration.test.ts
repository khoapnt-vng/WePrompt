/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { lstat, mkdtemp, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { STUDIO_MUTATION_BATCH_SCHEMA_VERSION } from '@/common/types/project/creativeStudioTypes';
import { writeReferenceRequestRecordV2 } from '@process/resources/builtinMcp/studioReferenceRequestWriter';
import {
  createStudioE2EFakeBundle,
  createStudioE2EFakeRemoteState,
} from '@process/services/creative-studio/adapters/e2eFakeAdapter';
import { createStudioJobManager } from '@process/services/creative-studio/jobManager';
import { createStudioMediaStore } from '@process/services/creative-studio/mediaStore';
import { createStudioProviderResolver } from '@process/services/creative-studio/providerResolver';
import { createCreativeStudioServiceV2 } from '@process/services/creative-studio/service';
import { createStudioRateCardV2 } from '@process/services/creative-studio/service/schema2/pricing';
import { createCreativeStudioStore } from '@process/services/creative-studio/store';
import { describe, expect, it, vi } from 'vitest';

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

describe('Creative Studio generation lifecycle integration', () => {
  it('persists two direct semantic-reference jobs across a store reload', async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'studio-v2-direct-reference-integration-'));
    const fake = createStudioE2EFakeBundle({ rootDir });
    let service: ReturnType<typeof createCreativeStudioServiceV2> | null = null;
    let restartedManager: ReturnType<typeof createStudioJobManager> | null = null;
    try {
      const store = createCreativeStudioStore({ rootDir });
      await Promise.all(fake.connections.map((connection) => store.saveConnection(connection)));
      const providerResolver = createStudioProviderResolver({
        listProviders: async () => [fake.provider],
        listConnections: () => store.listConnections(),
      });
      const imageRoute = (await providerResolver.listGenerationRoutes()).routes.find(
        (candidate) => candidate.kind === 'image'
      );
      if (!imageRoute) throw new Error('Shared-reference lifecycle did not resolve the fake image route');

      const created = await store.createProjectV2({
        name: 'Direct reference film',
        brief: 'Persist two independently targeted character sheets.',
        aspectRatio: '16:9',
        targetDurationSeconds: 5,
        resolution: '720p',
      });
      const configured = await store.updateProjectV2(created.id, (project) => ({
        ...project,
        beatOrder: ['section_reunion'],
        beats: {
          section_reunion: {
            id: 'section_reunion',
            title: 'Cast introduction',
            story: 'Ming and Mei meet again in soft directional daylight.',
            targetSeconds: null,
            shotOrder: ['shot_reunion'],
          },
        },
        shots: {
          shot_reunion: {
            id: 'shot_reunion',
            shootingScript: 'Ming and Mei enter the room together.',
            durationSeconds: 5,
            trimInSeconds: null,
            trimOutSeconds: null,
            chainBreak: 'none',
            referenceBinding: { status: 'unassigned', characterReferenceIds: [], backgroundReferenceId: null },
            seedStillId: null,
            dismissedSeedStillIds: [],
            boardAssetId: null,
            supersededBoardAssetIds: [],
            videoAssetId: null,
            supersededVideoAssetIds: [],
            assetIds: [],
            jobIds: [],
          },
        },
        imageRouteId: imageRoute.choiceId,
      }));
      const rateCard = createStudioRateCardV2([
        {
          routeId: imageRoute.choiceId,
          kind: 'image',
          currency: 'USD',
          rateUnit: 'generation',
          rateMinorUnits: 3,
        },
      ]);
      const dispatchedJobIds: string[][] = [];
      let jobIndex = 0;
      let idempotencyIndex = 0;
      service = createCreativeStudioServiceV2({
        store,
        providerResolver,
        jobManager: {
          dispatchAuthorizedJobsV2: async ({ jobIds }: { jobIds: string[] }) => {
            dispatchedJobIds.push([...jobIds]);
            return [];
          },
        } as never,
        rateCard: async () => rateCard,
        createQuoteId: () => 'quote_shared_reference_proxy',
        createJobId: () => `job_shared_reference_${++jobIndex}`,
        createIdempotencyKey: () => `idempotency_shared_reference_${++idempotencyIndex}`,
        onProjectUpdated: () => {},
      });

      const defined = await service.applyMutations(
        {
          schemaVersion: STUDIO_MUTATION_BATCH_SCHEMA_VERSION,
          projectId: configured.id,
          expectedRevision: configured.revision,
          operations: [
            {
              kind: 'set_reference_plan',
              references: [
                {
                  kind: 'character',
                  label: 'Ming',
                  prompt: 'A consistent character sheet for Ming.',
                },
                {
                  kind: 'character',
                  label: 'Mei',
                  prompt: 'A consistent character sheet for Mei.',
                },
              ],
            },
          ],
        },
        { mutationId: 'define_shared_reference_proxy', capturedAt: new Date().toISOString() }
      );
      const referenceIds = defined.project.referenceOrder;
      const prepared = await service.prepareProjectReferences({
        projectId: configured.id,
        expectedRevision: defined.project.revision,
        referenceIds,
      });
      await expect(
        service.confirmSubmission({
          projectId: configured.id,
          quoteId: prepared.baseOnly.id,
          expectedRevision: defined.project.revision,
        })
      ).resolves.toEqual({ projectId: configured.id, projectRevision: defined.project.revision + 1 });
      expect(dispatchedJobIds).toEqual([['job_shared_reference_1', 'job_shared_reference_2']]);

      service.dispose();
      service = null;
      const restartedStore = createCreativeStudioStore({ rootDir });
      const reloaded = await restartedStore.getProjectV2(configured.id);
      expect(reloaded.status).toBe('supported');
      if (reloaded.status !== 'supported') throw new Error('Shared-reference project did not survive reload');
      const authorization = reloaded.project.spendAuthorizations.at(-1);
      expect({
        referenceOrder: reloaded.project.referenceOrder,
        shotBinding: reloaded.project.shots.shot_reunion.referenceBinding,
        shotJobIds: reloaded.project.shots.shot_reunion.jobIds,
        authorizationItems: authorization?.baseItems.map((item) => [item.target, item.purpose]),
        referenceJobs: referenceIds.map((referenceId) => {
          const reference = reloaded.project.references[referenceId]!;
          const job = reloaded.project.jobs[reference.jobIds[0]!]!;
          return [reference.jobIds, job.id, job.status, job.target, job.purpose];
        }),
      }).toEqual({
        referenceOrder: referenceIds,
        shotBinding: { status: 'unassigned', characterReferenceIds: [], backgroundReferenceId: null },
        shotJobIds: [],
        authorizationItems: [
          [{ kind: 'reference', referenceId: referenceIds[0] }, 'reference_image'],
          [{ kind: 'reference', referenceId: referenceIds[1] }, 'reference_image'],
        ],
        referenceJobs: [
          [
            ['job_shared_reference_1'],
            'job_shared_reference_1',
            'queued_local',
            { kind: 'reference', referenceId: referenceIds[0] },
            'reference_image',
          ],
          [
            ['job_shared_reference_2'],
            'job_shared_reference_2',
            'queued_local',
            { kind: 'reference', referenceId: referenceIds[1] },
            'reference_image',
          ],
        ],
      });

      const restartedMediaStore = createStudioMediaStore({ store: restartedStore });
      restartedManager = createStudioJobManager({
        store: restartedStore,
        mediaStore: restartedMediaStore,
        providerResolver: createStudioProviderResolver({
          listProviders: async () => [fake.provider],
          listConnections: () => restartedStore.listConnections(),
        }),
        adapters: fake.adapters,
        listProviders: async () => [fake.provider],
        sleep: async () => undefined,
        jitterMs: (baseMs) => baseMs,
      });
      await restartedManager.dispatchAuthorizedJobsV2({
        projectId: configured.id,
        jobIds: ['job_shared_reference_1', 'job_shared_reference_2'],
      });
      const completedAfterRestart = await waitFor(async () => {
        const loaded = await restartedStore.getProjectV2(configured.id);
        if (loaded.status !== 'supported') return null;
        return ['job_shared_reference_1', 'job_shared_reference_2'].every(
          (jobId) => loaded.project.jobs[jobId]?.status === 'succeeded'
        )
          ? loaded.project
          : null;
      });
      expect(referenceIds.map((referenceId) => completedAfterRestart.references[referenceId]?.approvedAssetId)).toEqual(
        [expect.any(String), expect.any(String)]
      );
    } finally {
      service?.dispose();
      await restartedManager?.dispose().catch((): undefined => undefined);
      await fake.dispose().catch((): undefined => undefined);
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it('retries a paid direct reference after an unrelated Shot is parked and the project is reloaded', async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'studio-v2-parked-reference-retry-integration-'));
    const fake = createStudioE2EFakeBundle({ rootDir });
    let service: ReturnType<typeof createCreativeStudioServiceV2> | null = null;
    try {
      const store = createCreativeStudioStore({ rootDir });
      await Promise.all(fake.connections.map((connection) => store.saveConnection(connection)));
      const providerResolver = createStudioProviderResolver({
        listProviders: async () => [fake.provider],
        listConnections: () => store.listConnections(),
      });
      const imageRoute = (await providerResolver.listGenerationRoutes()).routes.find(
        (candidate) => candidate.kind === 'image'
      );
      if (!imageRoute) throw new Error('Parked-reference retry did not resolve the fake image route');

      const created = await store.createProjectV2({
        name: 'Parked reference retry film',
        brief: 'Keep a paid reference retry attached to its durable handoff.',
        aspectRatio: '16:9',
        targetDurationSeconds: 10,
        resolution: '720p',
      });
      const configured = await store.updateProjectV2(created.id, (project) => ({
        ...project,
        beatOrder: ['section_parked_retry'],
        beats: {
          section_parked_retry: {
            id: 'section_parked_retry',
            title: 'Reference anchors',
            story: 'Establish the recurring character before the fallback Shot in soft daylight.',
            targetSeconds: null,
            shotOrder: ['clip_reference_anchor', 'clip_reference_fallback'],
          },
        },
        shots: Object.fromEntries(
          ['clip_reference_anchor', 'clip_reference_fallback'].map((shotId, index) => [
            shotId,
            {
              id: shotId,
              shootingScript: index === 0 ? 'An unrelated establishing Shot.' : 'An active fallback Shot.',
              durationSeconds: 5,
              trimInSeconds: null,
              trimOutSeconds: null,
              chainBreak: 'none' as const,
              referenceBinding: {
                status: 'unassigned' as const,
                characterReferenceIds: [],
                backgroundReferenceId: null,
              },
              seedStillId: null,
              dismissedSeedStillIds: [],
              boardAssetId: null,
              supersededBoardAssetIds: [],
              videoAssetId: null,
              supersededVideoAssetIds: [],
              assetIds: [],
              jobIds: [],
            },
          ])
        ),
        imageRouteId: imageRoute.choiceId,
      }));
      const rateCard = createStudioRateCardV2([
        {
          routeId: imageRoute.choiceId,
          kind: 'image',
          currency: 'USD',
          rateUnit: 'generation',
          rateMinorUnits: 3,
        },
      ]);
      const initialDispatch = vi.fn(async () => []);
      service = createCreativeStudioServiceV2({
        store,
        providerResolver,
        jobManager: { dispatchAuthorizedJobsV2: initialDispatch } as never,
        rateCard: async () => rateCard,
        createQuoteId: () => 'quote_parked_reference_initial',
        createJobId: () => 'job_parked_reference_initial',
        createIdempotencyKey: () => 'idempotency_parked_reference_initial',
        onProjectUpdated: () => {},
      });

      const defined = await service.applyMutations(
        {
          schemaVersion: STUDIO_MUTATION_BATCH_SCHEMA_VERSION,
          projectId: configured.id,
          expectedRevision: configured.revision,
          operations: [
            {
              kind: 'set_reference_plan',
              references: [
                {
                  kind: 'character',
                  label: 'Recurring character',
                  prompt: 'One stable character sheet for the recurring character.',
                },
              ],
            },
          ],
        },
        { mutationId: 'define_parked_reference', capturedAt: new Date().toISOString() }
      );
      const referenceId = defined.project.referenceOrder[0]!;
      const requestPaths = await store.resolveReferenceRequestPathsV2(configured.id);
      const canonicalRoot = await realpath(requestPaths.projectDir);
      const rootStats = await lstat(canonicalRoot);
      const request = await writeReferenceRequestRecordV2({
        pendingDir: requestPaths.pendingDir,
        projectId: configured.id,
        requestId: 'request_parked_reference',
        referenceIds: [referenceId],
        projectAuthority: {
          canonicalRoot,
          rootIdentity: { dev: rootStats.dev, ino: rootStats.ino },
        },
      });
      const decision = await service.decideReferenceRequest({
        projectId: configured.id,
        requestId: request.id,
        expectedRevision: defined.project.revision,
        outcome: { kind: 'generation_gate' },
      });
      if (decision.outcome.kind !== 'generation_gate') throw new Error('Expected a generation handoff');
      const prepared = await service.prepareProjectReferences({
        projectId: configured.id,
        expectedRevision: defined.project.revision,
        referenceIds: [referenceId],
      });
      expect(prepared.baseOnly.baseItems).toEqual([
        expect.objectContaining({
          target: { kind: 'reference', referenceId },
          purpose: 'reference_image',
        }),
      ]);
      const confirmed = await service.confirmSubmission({
        projectId: configured.id,
        quoteId: prepared.baseOnly.id,
        expectedRevision: defined.project.revision,
      });
      expect(initialDispatch).toHaveBeenCalledExactlyOnceWith({
        projectId: configured.id,
        jobIds: ['job_parked_reference_initial'],
      });

      const cancelled = await store.updateProjectV2(
        configured.id,
        (project) => {
          const next = structuredClone(project);
          const job = next.jobs.job_parked_reference_initial;
          if (job === undefined) throw new Error('Confirmed reference job was not persisted');
          job.status = 'cancelled';
          job.providerJobId = null;
          delete job.remoteStartedAt;
          job.outputAssetIds = [];
          job.outputAssetIdsByRole = { primary: null, poster: null };
          job.error = null;
          job.spendReceipt = null;
          job.updatedAt = new Date().toISOString();
          return next;
        },
        confirmed.projectRevision,
        'test:cancel-parked-reference'
      );
      await expect(service.listReferenceGenerationHandoffs({ projectId: configured.id })).resolves.toEqual([
        expect.objectContaining({
          handoffId: decision.outcome.handoffId,
          status: 'failed',
          counts: { queued: 0, running: 0, succeeded: 0, failed: 1 },
          failedReferenceIds: [referenceId],
        }),
      ]);
      const parked = await service.applyMutations(
        {
          schemaVersion: STUDIO_MUTATION_BATCH_SCHEMA_VERSION,
          projectId: configured.id,
          expectedRevision: cancelled.revision,
          operations: [{ kind: 'park_shot', shotId: 'clip_reference_anchor' }],
        },
        { mutationId: 'park_reference_anchor', capturedAt: new Date().toISOString() }
      );
      expect(parked.project.beats.section_parked_retry?.shotOrder).toEqual(['clip_reference_fallback']);

      service.dispose();
      service = null;
      const restartedStore = createCreativeStudioStore({ rootDir });
      const reloaded = await restartedStore.getProjectV2(configured.id);
      if (reloaded.status !== 'supported') throw new Error('Parked-reference project did not survive reload');
      const retryDispatch = vi.fn(async () => []);
      const restartedProviderResolver = createStudioProviderResolver({
        listProviders: async () => [fake.provider],
        listConnections: () => restartedStore.listConnections(),
      });
      const listGenerationRoutes = vi.spyOn(restartedProviderResolver, 'listGenerationRoutes');
      const loadRateCard = vi.fn(async () => rateCard);
      const createQuoteId = vi.fn(() => 'quote_parked_reference_retry');
      const onProjectUpdated = vi.fn();
      service = createCreativeStudioServiceV2({
        store: restartedStore,
        providerResolver: restartedProviderResolver,
        jobManager: { dispatchAuthorizedJobsV2: retryDispatch } as never,
        rateCard: loadRateCard,
        createQuoteId,
        createJobId: () => 'job_parked_reference_retry',
        createIdempotencyKey: () => 'idempotency_parked_reference_retry',
        onProjectUpdated,
      });
      await expect(service.listReferenceGenerationHandoffs({ projectId: configured.id })).resolves.toEqual([
        expect.objectContaining({
          handoffId: decision.outcome.handoffId,
          status: 'failed',
          failedReferenceIds: [referenceId],
        }),
      ]);
      const retryPrepared = await service.prepareProjectReferences({
        projectId: configured.id,
        expectedRevision: reloaded.project.revision,
        referenceIds: [referenceId],
      });
      expect(retryPrepared.baseOnly.baseItems).toEqual([
        expect.objectContaining({ target: { kind: 'reference', referenceId }, purpose: 'reference_image' }),
      ]);
      await expect(
        service.confirmSubmission({
          projectId: configured.id,
          quoteId: retryPrepared.baseOnly.id,
          expectedRevision: reloaded.project.revision,
        })
      ).resolves.toEqual({ projectId: configured.id, projectRevision: reloaded.project.revision + 1 });

      const after = await restartedStore.getProjectV2(configured.id);
      if (after.status !== 'supported') throw new Error('Reference retry damaged the reloaded project');
      expect(after.project.references[referenceId]?.jobIds).toEqual([
        'job_parked_reference_initial',
        'job_parked_reference_retry',
      ]);
      expect(after.project.jobs.job_parked_reference_retry).toMatchObject({
        target: { kind: 'reference', referenceId },
        purpose: 'reference_image',
        status: 'queued_local',
      });
      expect(after.project.shots.clip_reference_anchor?.jobIds).toEqual([]);
      expect(after.project.shots.clip_reference_fallback?.jobIds).toEqual([]);
      expect(listGenerationRoutes).toHaveBeenCalled();
      expect(loadRateCard).toHaveBeenCalled();
      expect(createQuoteId).toHaveBeenCalledOnce();
      expect(retryDispatch).toHaveBeenCalledExactlyOnceWith({
        projectId: configured.id,
        jobIds: ['job_parked_reference_retry'],
      });
      expect(onProjectUpdated).toHaveBeenCalled();
    } finally {
      service?.dispose();
      await fake.dispose().catch((): undefined => undefined);
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it('retains two successful references and retries only one failed reference after restart', async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'studio-v2-partial-reference-integration-'));
    const fake = createStudioE2EFakeBundle({ rootDir });
    let manager: ReturnType<typeof createStudioJobManager> | null = null;
    let service: ReturnType<typeof createCreativeStudioServiceV2> | null = null;
    try {
      const store = createCreativeStudioStore({ rootDir });
      await Promise.all(fake.connections.map((connection) => store.saveConnection(connection)));
      const listProviders = async () => [fake.provider];
      const providerResolver = createStudioProviderResolver({
        listProviders,
        listConnections: () => store.listConnections(),
      });
      const imageRoute = (await providerResolver.listGenerationRoutes()).routes.find(
        (candidate) => candidate.kind === 'image'
      );
      if (imageRoute === undefined) throw new Error('Partial-reference lifecycle did not resolve the fake image route');
      const created = await store.createProjectV2({
        name: 'Partial reference retry film',
        brief: 'Generate three recurring character references and retain partial success.',
        aspectRatio: '16:9',
        targetDurationSeconds: 12,
        resolution: '720p',
      });
      const configured = await store.updateProjectV2(created.id, (project) => ({
        ...project,
        imageRouteId: imageRoute.choiceId,
      }));
      const mediaStore = createStudioMediaStore({ store });
      const baseImageAdapter = fake.adapters.get('weprompt-image-v1');
      if (baseImageAdapter === undefined || baseImageAdapter.poll === undefined) {
        throw new Error('Partial-reference fake image adapter was unavailable');
      }
      const failedProviderJobId = 'forced_reference_failure';
      const failingAdapters = new Map(fake.adapters);
      failingAdapters.set('weprompt-image-v1', {
        ...baseImageAdapter,
        async submit(request, provider, signal) {
          if (request.prompt.includes('FORCE_REFERENCE_FAILURE')) {
            signal.throwIfAborted();
            return { kind: 'remote', providerJobId: failedProviderJobId };
          }
          return baseImageAdapter.submit(request, provider, signal);
        },
        async poll(providerJobId, provider, signal) {
          if (providerJobId === failedProviderJobId) {
            signal.throwIfAborted();
            return { status: 'failed', error: { code: 'unknown' } };
          }
          return baseImageAdapter.poll!(providerJobId, provider, signal);
        },
      });
      manager = createStudioJobManager({
        store,
        mediaStore,
        providerResolver,
        adapters: failingAdapters,
        listProviders,
        sleep: async () => undefined,
        jitterMs: (baseMs) => baseMs,
      });
      const rateCard = createStudioRateCardV2([
        {
          routeId: imageRoute.choiceId,
          kind: 'image',
          currency: 'USD',
          rateUnit: 'generation',
          rateMinorUnits: 3,
        },
      ]);
      let initialJobIndex = 0;
      service = createCreativeStudioServiceV2({
        store,
        mediaStore,
        providerResolver,
        jobManager: manager,
        rateCard: async () => rateCard,
        createQuoteId: () => 'quote_partial_reference_initial',
        createJobId: () => `job_partial_reference_${++initialJobIndex}`,
        createIdempotencyKey: () => `idempotency_partial_reference_${initialJobIndex}`,
        onProjectUpdated: () => {},
      });
      const planned = await service.applyMutations(
        {
          schemaVersion: STUDIO_MUTATION_BATCH_SCHEMA_VERSION,
          projectId: configured.id,
          expectedRevision: configured.revision,
          operations: [
            {
              kind: 'set_reference_plan',
              references: [
                { kind: 'character', label: 'Ming', prompt: 'Stable character sheet for Ming.' },
                {
                  kind: 'character',
                  label: 'Mei',
                  prompt: 'FORCE_REFERENCE_FAILURE while generating Mei.',
                },
                { kind: 'character', label: 'Jun', prompt: 'Stable character sheet for Jun.' },
              ],
            },
          ],
        },
        { mutationId: 'plan_partial_references', capturedAt: new Date().toISOString() }
      );
      const [mingId, failedReferenceId, junId] = planned.project.referenceOrder;
      if (mingId === undefined || failedReferenceId === undefined || junId === undefined) {
        throw new Error('Partial-reference identities were unavailable');
      }
      const requestPaths = await store.resolveReferenceRequestPathsV2(configured.id);
      const canonicalRoot = await realpath(requestPaths.projectDir);
      const rootStats = await lstat(canonicalRoot);
      const request = await writeReferenceRequestRecordV2({
        pendingDir: requestPaths.pendingDir,
        projectId: configured.id,
        requestId: 'request_partial_references',
        referenceIds: [mingId, failedReferenceId, junId],
        projectAuthority: {
          canonicalRoot,
          rootIdentity: { dev: rootStats.dev, ino: rootStats.ino },
        },
      });
      const decision = await service.decideReferenceRequest({
        projectId: configured.id,
        requestId: request.id,
        expectedRevision: planned.project.revision,
        outcome: { kind: 'generation_gate' },
      });
      if (decision.outcome.kind !== 'generation_gate') throw new Error('Expected a partial-reference handoff');
      const prepared = await service.prepareProjectReferences({
        projectId: configured.id,
        expectedRevision: planned.project.revision,
        referenceIds: [mingId, failedReferenceId, junId],
      });
      await service.confirmSubmission({
        projectId: configured.id,
        quoteId: prepared.baseOnly.id,
        expectedRevision: planned.project.revision,
      });
      const partiallyFailed = await waitFor(async () => {
        const loaded = await store.getProjectV2(configured.id);
        if (loaded.status !== 'supported') return null;
        const jobs = ['job_partial_reference_1', 'job_partial_reference_2', 'job_partial_reference_3'].map(
          (jobId) => loaded.project.jobs[jobId]?.status
        );
        return jobs.every((status) => status === 'succeeded' || status === 'failed') ? loaded.project : null;
      });
      expect([
        partiallyFailed.jobs.job_partial_reference_1?.status,
        partiallyFailed.jobs.job_partial_reference_2?.status,
        partiallyFailed.jobs.job_partial_reference_3?.status,
      ]).toEqual(['succeeded', 'failed', 'succeeded']);
      await expect(service.listReferenceGenerationHandoffs({ projectId: configured.id })).resolves.toEqual([
        expect.objectContaining({
          handoffId: decision.outcome.handoffId,
          status: 'partially_failed',
          counts: { queued: 0, running: 0, succeeded: 2, failed: 1 },
          failedReferenceIds: [failedReferenceId],
        }),
      ]);
      const successfulCandidateIds = [
        partiallyFailed.references[mingId]?.approvedAssetId,
        partiallyFailed.references[junId]?.approvedAssetId,
      ];
      expect(successfulCandidateIds).toEqual([expect.any(String), expect.any(String)]);
      const successfulCandidateSnapshots = successfulCandidateIds.map((assetId) => {
        if (assetId === null || assetId === undefined) throw new Error('Successful reference candidate was missing');
        const asset = partiallyFailed.assets[assetId];
        if (asset === undefined) throw new Error('Successful reference asset was missing');
        return { assetId, sha256: asset.sha256, producerJobId: asset.producerJobId };
      });
      expect(partiallyFailed.references[failedReferenceId]?.approvedAssetId).toBeNull();

      service.dispose();
      service = null;
      await manager.dispose();
      manager = null;

      const restartedStore = createCreativeStudioStore({ rootDir });
      const restartedMediaStore = createStudioMediaStore({ store: restartedStore });
      const restartedProviderResolver = createStudioProviderResolver({
        listProviders,
        listConnections: () => restartedStore.listConnections(),
      });
      manager = createStudioJobManager({
        store: restartedStore,
        mediaStore: restartedMediaStore,
        providerResolver: restartedProviderResolver,
        adapters: fake.adapters,
        listProviders,
        sleep: async () => undefined,
        jitterMs: (baseMs) => baseMs,
      });
      service = createCreativeStudioServiceV2({
        store: restartedStore,
        mediaStore: restartedMediaStore,
        providerResolver: restartedProviderResolver,
        jobManager: manager,
        rateCard: async () => rateCard,
        createQuoteId: () => 'quote_partial_reference_retry',
        createJobId: () => 'job_partial_reference_retry',
        createIdempotencyKey: () => 'idempotency_partial_reference_retry',
        onProjectUpdated: () => {},
      });
      await expect(service.listReferenceGenerationHandoffs({ projectId: configured.id })).resolves.toEqual([
        expect.objectContaining({
          handoffId: decision.outcome.handoffId,
          status: 'partially_failed',
          failedReferenceIds: [failedReferenceId],
        }),
      ]);
      const reloaded = await restartedStore.getProjectV2(configured.id);
      if (reloaded.status !== 'supported') throw new Error('Partial-reference project did not survive restart');
      const retryPrepared = await service.prepareProjectReferences({
        projectId: configured.id,
        expectedRevision: reloaded.project.revision,
        referenceIds: [failedReferenceId],
      });
      expect(retryPrepared.baseOnly.baseItems).toEqual([
        expect.objectContaining({
          target: { kind: 'reference', referenceId: failedReferenceId },
          purpose: 'reference_image',
        }),
      ]);
      await service.confirmSubmission({
        projectId: configured.id,
        quoteId: retryPrepared.baseOnly.id,
        expectedRevision: reloaded.project.revision,
      });
      const recovered = await waitFor(async () => {
        const loaded = await restartedStore.getProjectV2(configured.id);
        if (loaded.status !== 'supported') return null;
        return loaded.project.jobs.job_partial_reference_retry?.status === 'succeeded' ? loaded.project : null;
      });
      expect(recovered.references[mingId]?.jobIds).toEqual(['job_partial_reference_1']);
      expect(recovered.references[junId]?.jobIds).toEqual(['job_partial_reference_3']);
      expect(recovered.references[failedReferenceId]?.jobIds).toEqual([
        'job_partial_reference_2',
        'job_partial_reference_retry',
      ]);
      expect(
        [recovered.references[mingId]?.approvedAssetId, recovered.references[junId]?.approvedAssetId].map((assetId) => {
          if (assetId === null || assetId === undefined) throw new Error('Recovered reference candidate was missing');
          const asset = recovered.assets[assetId];
          if (asset === undefined) throw new Error('Recovered reference asset was missing');
          return { assetId, sha256: asset.sha256, producerJobId: asset.producerJobId };
        })
      ).toEqual(successfulCandidateSnapshots);
      expect(recovered.references[failedReferenceId]?.approvedAssetId).toEqual(expect.any(String));
      expect(recovered.spendAuthorizations).toHaveLength(2);
      await expect(service.listReferenceGenerationHandoffs({ projectId: configured.id })).resolves.toEqual([
        expect.objectContaining({
          handoffId: decision.outcome.handoffId,
          status: 'succeeded',
          counts: { queued: 0, running: 0, succeeded: 3, failed: 0 },
          failedReferenceIds: [],
        }),
      ]);
    } finally {
      service?.dispose();
      await manager?.dispose().catch((): undefined => undefined);
      await fake.dispose().catch((): undefined => undefined);
      await rm(rootDir, { recursive: true, force: true });
    }
  }, 60_000);

  it('runs a real V2 paid seed submission through durable authorization, job, and primary ownership', async () => {
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
      const videoRoute = catalog.routes.find((candidate) => candidate.kind === 'video');
      if (!imageRoute || !videoRoute) throw new Error('V2 lifecycle did not resolve the fake media routes');
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
            story: 'Introduce the product in a luminous folded-paper world.',
            targetSeconds: null,
            shotOrder: ['clip_lifecycle'],
          },
        },
        shots: {
          clip_lifecycle: {
            id: 'clip_lifecycle',
            shootingScript: 'A paper aircraft banks across a sunrise.',
            durationSeconds: 5,
            trimInSeconds: null,
            trimOutSeconds: null,
            chainBreak: 'none',
            seedStillId: null,
            dismissedSeedStillIds: [],
            boardAssetId: null,
            supersededBoardAssetIds: [],
            videoAssetId: null,
            supersededVideoAssetIds: [],
            referenceBinding: { status: 'unassigned', characterReferenceIds: [], backgroundReferenceId: null },
            assetIds: [],
            jobIds: [],
          },
        },
        imageRouteId: imageRoute.choiceId,
        videoRouteId: videoRoute.choiceId,
      }));
      const mediaStore = createStudioMediaStore({ store });
      manager = createStudioJobManager({
        store,
        mediaStore,
        providerResolver,
        adapters: fake.adapters,
        listProviders,
        sleep: clock.sleep,
        jitterMs: (baseMs) => baseMs,
      });
      const rateCard = createStudioRateCardV2([
        {
          routeId: imageRoute.choiceId,
          kind: 'image',
          currency: 'USD',
          rateUnit: 'generation',
          rateMinorUnits: 3,
        },
        {
          routeId: videoRoute.choiceId,
          kind: 'video',
          currency: 'USD',
          rateUnit: 'second',
          rateMinorUnits: 5,
        },
      ]);
      let quoteIndex = 0;
      let jobIndex = 0;
      let idempotencyIndex = 0;
      const lifecycleJobIds = [
        'job_v2_lifecycle_reference',
        'job_v2_lifecycle_reference_replacement',
        'job_v2_lifecycle',
      ] as const;
      const service = createCreativeStudioServiceV2({
        store,
        mediaStore,
        providerResolver,
        jobManager: manager,
        rateCard: async () => rateCard,
        createQuoteId: () => `quote_v2_lifecycle_${++quoteIndex}`,
        createJobId: () => lifecycleJobIds[jobIndex++] ?? `job_v2_lifecycle_extra_${jobIndex}`,
        createIdempotencyKey: () => `idempotency_v2_lifecycle_${++idempotencyIndex}`,
        onProjectUpdated: () => {},
      });

      const seedChoice = {
        target: { kind: 'shot' as const, shotId: 'clip_lifecycle' },
        purpose: 'seed_still' as const,
      };
      const unassignedBefore = await store.getProjectV2(configured.id);
      await expect(
        service.prepareSubmission({
          projectId: configured.id,
          expectedRevision: configured.revision,
          originReferenceHandoffId: null,
          baseChoices: [seedChoice],
          cascadeChoices: [],
        })
      ).rejects.toMatchObject({ code: 'invalid_reference' });
      await expect(store.getProjectV2(configured.id)).resolves.toEqual(unassignedBefore);

      const referenceDefined = await service.applyMutations(
        {
          schemaVersion: STUDIO_MUTATION_BATCH_SCHEMA_VERSION,
          projectId: configured.id,
          expectedRevision: configured.revision,
          operations: [
            {
              kind: 'set_reference_plan',
              references: [
                {
                  kind: 'background',
                  label: 'Folded-paper sunrise',
                  prompt: 'A luminous folded-paper sunrise world.',
                },
              ],
            },
          ],
        },
        { mutationId: 'define_v2_lifecycle_reference', capturedAt: new Date().toISOString() }
      );
      const referenceId = referenceDefined.project.referenceOrder[0]!;
      const referencePrepared = await service.prepareProjectReferences({
        projectId: configured.id,
        expectedRevision: referenceDefined.project.revision,
        referenceIds: [referenceId],
      });
      await service.confirmSubmission({
        projectId: configured.id,
        quoteId: referencePrepared.baseOnly.id,
        expectedRevision: referenceDefined.project.revision,
      });
      for (const delayMs of [2_000, 4_000, 8_000]) (await clock.take(delayMs)).release();
      const referenceCompleted = await waitFor(async () => {
        try {
          const loaded = await store.getProjectV2(configured.id);
          if (loaded.status !== 'supported') return null;
          const job = loaded.project.jobs.job_v2_lifecycle_reference;
          return job?.status === 'succeeded' && job.outputAssetIdsByRole.primary !== null
            ? { project: loaded.project, assetId: job.outputAssetIdsByRole.primary }
            : null;
        } catch {
          return null;
        }
      });
      const bound = await service.applyMutations(
        {
          schemaVersion: STUDIO_MUTATION_BATCH_SCHEMA_VERSION,
          projectId: configured.id,
          expectedRevision: referenceCompleted.project.revision,
          operations: [
            {
              kind: 'set_shot_reference_binding',
              shotId: 'clip_lifecycle',
              characterReferenceIds: [],
              backgroundReferenceId: referenceId,
            },
          ],
        },
        { mutationId: 'bind_v2_lifecycle_reference', capturedAt: new Date().toISOString() }
      );

      const replacementPrepared = await service.prepareProjectReferences({
        projectId: configured.id,
        expectedRevision: bound.project.revision,
        referenceIds: [referenceId],
      });
      await service.confirmSubmission({
        projectId: configured.id,
        quoteId: replacementPrepared.baseOnly.id,
        expectedRevision: bound.project.revision,
      });
      for (const delayMs of [2_000, 4_000, 8_000]) (await clock.take(delayMs)).release();
      const replacementCurrent = await waitFor(async () => {
        try {
          const loaded = await store.getProjectV2(configured.id);
          if (loaded.status !== 'supported') return null;
          const job = loaded.project.jobs.job_v2_lifecycle_reference_replacement;
          const currentAssetId = loaded.project.references[referenceId]?.approvedAssetId;
          return job?.status === 'succeeded' && currentAssetId !== null && currentAssetId !== undefined
            ? { project: loaded.project, assetId: currentAssetId }
            : null;
        } catch {
          return null;
        }
      });
      expect(replacementCurrent.assetId).not.toBe(referenceCompleted.assetId);

      const replacementStaleQuote = await service.prepareSubmission({
        projectId: configured.id,
        expectedRevision: replacementCurrent.project.revision,
        originReferenceHandoffId: null,
        baseChoices: [seedChoice],
        cascadeChoices: [],
      });
      const replacementApproved = await service.applyMutations(
        {
          schemaVersion: STUDIO_MUTATION_BATCH_SCHEMA_VERSION,
          projectId: configured.id,
          expectedRevision: replacementCurrent.project.revision,
          operations: [{ kind: 'select_reference_image', referenceId, assetId: referenceCompleted.assetId }],
        },
        { mutationId: 'select_v2_lifecycle_reference_image', capturedAt: new Date().toISOString() }
      );
      expect(replacementApproved.project.references[referenceId]).toMatchObject({
        approvedAssetId: referenceCompleted.assetId,
        supersededAssetIds: [replacementCurrent.assetId],
      });
      const afterReplacementApproval = await store.getProjectV2(configured.id);
      await expect(
        service.confirmSubmission({
          projectId: configured.id,
          quoteId: replacementStaleQuote.baseOnly.id,
          expectedRevision: replacementStaleQuote.baseOnly.projectRevision,
        })
      ).rejects.toBeDefined();
      await expect(store.getProjectV2(configured.id)).resolves.toEqual(afterReplacementApproval);

      const imageBinding = fake.connections.find(
        (connection) =>
          connection.providerId === imageRoute.providerId &&
          connection.adapterId === imageRoute.adapterId &&
          connection.model === imageRoute.model
      );
      if (imageBinding === undefined) throw new Error('V2 lifecycle image binding was unavailable');
      await store.saveConnection({
        ...structuredClone(imageBinding),
        capabilities: { ...structuredClone(imageBinding.capabilities), maxConditioningImages: 0 },
      });
      const beforeCapacityRefusal = await store.getProjectV2(configured.id);
      await expect(
        service.prepareSubmission({
          projectId: configured.id,
          expectedRevision: replacementApproved.project.revision,
          originReferenceHandoffId: null,
          baseChoices: [seedChoice],
          cascadeChoices: [],
        })
      ).rejects.toMatchObject({ code: 'invalid_reference' });
      await expect(store.getProjectV2(configured.id)).resolves.toEqual(beforeCapacityRefusal);
      await store.saveConnection(imageBinding);

      const routeStaleQuote = await service.prepareSubmission({
        projectId: configured.id,
        expectedRevision: replacementApproved.project.revision,
        originReferenceHandoffId: null,
        baseChoices: [seedChoice],
        cascadeChoices: [],
      });
      const nextImageBinding = fake.connections.find(
        (connection) => connection.adapterId === imageBinding.adapterId && connection.model !== imageBinding.model
      );
      if (nextImageBinding === undefined) throw new Error('V2 lifecycle replacement image route was unavailable');
      await store.saveConnection({ ...structuredClone(imageBinding), model: nextImageBinding.model });
      const beforeRouteRefusal = await store.getProjectV2(configured.id);
      await expect(
        service.confirmSubmission({
          projectId: configured.id,
          quoteId: routeStaleQuote.baseOnly.id,
          expectedRevision: routeStaleQuote.baseOnly.projectRevision,
        })
      ).rejects.toBeDefined();
      await expect(store.getProjectV2(configured.id)).resolves.toEqual(beforeRouteRefusal);
      await store.saveConnection(imageBinding);

      const prepared = await service.prepareSubmission({
        projectId: configured.id,
        expectedRevision: replacementApproved.project.revision,
        originReferenceHandoffId: null,
        baseChoices: [seedChoice],
        cascadeChoices: [
          {
            target: { kind: 'shot', shotId: 'clip_lifecycle' },
            purpose: 'video_take',
          },
        ],
      });
      await expect(
        service.confirmSubmission({
          projectId: configured.id,
          quoteId: prepared.baseOnly.id,
          expectedRevision: replacementApproved.project.revision,
        })
      ).resolves.toEqual({
        projectId: configured.id,
        projectRevision: replacementApproved.project.revision + 1,
      });
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
      const primaryAssetId = job.outputAssetIdsByRole.primary;
      const asset = primaryAssetId ? completed.assets[primaryAssetId] : null;
      expect({
        jobTarget: job.target,
        purpose: job.purpose,
        authorizationId: job.authorizationId,
        authorizationCount: completed.spendAuthorizations.length,
        outputAssetIds: job.outputAssetIds,
        outputAssetIdsByRole: job.outputAssetIdsByRole,
        receiptAuthorizationId: job.spendReceipt?.authorizationId,
        shotJobIds: shot.jobIds,
        shotAssetIds: shot.assetIds,
        generationReferenceAssetIds: asset?.generationReferenceAssetIds,
        videoAssetId: shot.videoAssetId,
        assetShotId: asset?.shotId,
        mediaKind: asset?.mediaKind,
        collection: asset?.managedAsset.collection,
      }).toEqual({
        jobTarget: { kind: 'shot', shotId: 'clip_lifecycle' },
        purpose: 'seed_still',
        authorizationId: prepared.baseOnly.id,
        authorizationCount: 3,
        outputAssetIds: [primaryAssetId],
        outputAssetIdsByRole: { primary: primaryAssetId, poster: null },
        receiptAuthorizationId: prepared.baseOnly.id,
        shotJobIds: ['job_v2_lifecycle'],
        shotAssetIds: [primaryAssetId],
        generationReferenceAssetIds: [referenceCompleted.assetId],
        videoAssetId: null,
        assetShotId: 'clip_lifecycle',
        mediaKind: 'image',
        collection: 'assets',
      });
      expect(primaryAssetId ? await mediaStore.resolveAssetV2(completed.id, primaryAssetId) : null).not.toBeNull();
      service.dispose();
    } finally {
      clock.releaseAll();
      await manager?.dispose().catch((): undefined => undefined);
      await fake.dispose().catch((): undefined => undefined);
      await rm(rootDir, { recursive: true, force: true });
    }
  }, 30_000);

  it('runs a publicly selected Board style through confirmation before one image dispatch and atomic ownership', async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'studio-v2-board-generation-integration-'));
    const remoteState = createStudioE2EFakeRemoteState();
    const fake = createStudioE2EFakeBundle({ rootDir, remoteState });
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
      if (!imageRoute) throw new Error('Board lifecycle did not resolve the fake image route');
      const created = await store.createProjectV2({
        name: 'Board lifecycle film',
        brief: 'Draw one confirmed production storyboard panel',
        aspectRatio: '16:9',
        targetDurationSeconds: 5,
        resolution: '720p',
      });
      const configured = await store.updateProjectV2(created.id, (project) => ({
        ...project,
        beatOrder: ['section_board'],
        beats: {
          section_board: {
            id: 'section_board',
            title: 'Opening',
            story: 'Reveal the product in one deliberate move under restrained morning light.',
            targetSeconds: null,
            shotOrder: ['clip_board'],
          },
        },
        shots: {
          clip_board: {
            id: 'clip_board',
            shootingScript: 'A wide frame reveals the product on a quiet stage.',
            durationSeconds: 5,
            trimInSeconds: null,
            trimOutSeconds: null,
            chainBreak: 'none',
            seedStillId: null,
            dismissedSeedStillIds: [],
            boardAssetId: null,
            supersededBoardAssetIds: [],
            videoAssetId: null,
            supersededVideoAssetIds: [],
            referenceBinding: { status: 'ready', characterReferenceIds: [], backgroundReferenceId: null },
            assetIds: [],
            jobIds: [],
          },
        },
        imageRouteId: imageRoute.choiceId,
      }));
      const mediaStore = createStudioMediaStore({ store });
      manager = createStudioJobManager({
        store,
        mediaStore,
        providerResolver,
        adapters: fake.adapters,
        listProviders,
        sleep: clock.sleep,
        jitterMs: (baseMs) => baseMs,
      });
      const rateCard = createStudioRateCardV2([
        {
          routeId: imageRoute.choiceId,
          kind: 'image',
          currency: 'USD',
          rateUnit: 'generation',
          rateMinorUnits: 3,
        },
      ]);
      const service = createCreativeStudioServiceV2({
        store,
        mediaStore,
        providerResolver,
        jobManager: manager,
        rateCard: async () => rateCard,
        createQuoteId: () => 'quote_v2_board_lifecycle',
        createJobId: () => 'job_v2_board_lifecycle',
        createIdempotencyKey: () => 'idempotency_v2_board_lifecycle',
        onProjectUpdated: () => {},
      });

      const styled = await service.applyMutations(
        {
          schemaVersion: STUDIO_MUTATION_BATCH_SCHEMA_VERSION,
          projectId: configured.id,
          expectedRevision: configured.revision,
          operations: [{ kind: 'edit_project', changes: { boardStyle: 'line_art' } }],
        },
        { mutationId: 'select_board_style', capturedAt: new Date().toISOString() }
      );
      expect(styled.project.boardStyle).toBe('line_art');

      const prepared = await service.prepareSubmission({
        projectId: configured.id,
        expectedRevision: styled.project.revision,
        originReferenceHandoffId: null,
        baseChoices: [
          {
            target: { kind: 'shot', shotId: 'clip_board' },
            purpose: 'board_still',
          },
        ],
        cascadeChoices: [],
      });
      expect(prepared).toMatchObject({
        baseOnly: {
          projectRevision: styled.project.revision,
          baseItems: [
            {
              target: { kind: 'shot', shotId: 'clip_board' },
              purpose: 'board_still',
              route: { choiceId: imageRoute.choiceId },
              generationCount: 1,
              durationSeconds: null,
            },
          ],
          cascadeItems: [],
        },
        withCascade: null,
      });
      expect(remoteState.taskCounter).toBe(0);

      await expect(
        service.confirmSubmission({
          projectId: configured.id,
          quoteId: prepared.baseOnly.id,
          expectedRevision: styled.project.revision,
        })
      ).resolves.toEqual({ projectId: configured.id, projectRevision: styled.project.revision + 1 });
      clock.releaseAll();

      const completed = await waitFor(async () => {
        try {
          const loaded = await store.getProjectV2(configured.id);
          return loaded.status === 'supported' && loaded.project.jobs.job_v2_board_lifecycle.status === 'succeeded'
            ? loaded.project
            : null;
        } catch {
          return null;
        }
      });
      const job = completed.jobs.job_v2_board_lifecycle;
      const shot = completed.shots.clip_board;
      const boardAssetId = job.outputAssetIdsByRole.primary;
      const asset = boardAssetId ? completed.assets[boardAssetId] : null;
      expect(remoteState.taskCounter).toBe(1);
      expect({
        purpose: job.purpose,
        boardAssetId: shot.boardAssetId,
        supersededBoardAssetIds: shot.supersededBoardAssetIds,
        assetId: boardAssetId,
        assetShotId: asset?.shotId,
        mediaKind: asset?.mediaKind,
        collection: asset?.managedAsset.collection,
      }).toEqual({
        purpose: 'board_still',
        boardAssetId,
        supersededBoardAssetIds: [],
        assetId: boardAssetId,
        assetShotId: 'clip_board',
        mediaKind: 'image',
        collection: 'boardStills',
      });
      expect(boardAssetId ? await mediaStore.resolveAssetV2(completed.id, boardAssetId) : null).not.toBeNull();
      service.dispose();
    } finally {
      clock.releaseAll();
      await manager?.dispose().catch((): undefined => undefined);
      await fake.dispose().catch((): undefined => undefined);
      await rm(rootDir, { recursive: true, force: true });
    }
  });
});
