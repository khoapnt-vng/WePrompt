/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { lstat, mkdtemp, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { STUDIO_PROJECT_SCHEMA_VERSION } from '@/common/types/project/creativeStudioTypes';
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
  it('persists two project-reference jobs sharing one proxy Shot across a store reload', async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'studio-v2-shared-reference-proxy-integration-'));
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
      if (!imageRoute) throw new Error('Shared-reference lifecycle did not resolve the fake image route');

      const created = await store.createProjectV2({
        name: 'Shared reference proxy film',
        brief: 'Persist two character sheets anchored to one proxy Shot',
        aspectRatio: '16:9',
        targetDurationSeconds: 5,
        resolution: '720p',
      });
      const configured = await store.updateProjectV2(created.id, (project) => ({
        ...project,
        beatOrder: ['section_shared_proxy'],
        beats: {
          section_shared_proxy: {
            id: 'section_shared_proxy',
            title: 'Cast introduction',
            action: 'Introduce both recurring characters',
            look: 'Soft directional daylight',
            actionRevision: 1,
            targetSeconds: null,
            shotOrder: ['clip_shared_proxy'],
            lineHistory: [],
          },
        },
        shots: {
          clip_shared_proxy: {
            id: 'clip_shared_proxy',
            line: 'Ming and Mei enter the room together',
            derivation: 'derived',
            derivedFromActionRevision: 1,
            narration: '',
            onScreenText: '',
            durationSeconds: 5,
            trimInSeconds: null,
            trimOutSeconds: null,
            chainBreak: 'none',
            referenceIds: [],
            seedStillId: null,
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

      const referenceIds = ['reference_ming', 'reference_mei'];
      const defined = await service.applyMutations(
        {
          schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
          projectId: configured.id,
          expectedRevision: configured.revision,
          operations: [
            {
              kind: 'set_project_references',
              references: [
                {
                  id: referenceIds[0]!,
                  kind: 'character',
                  label: 'Ming',
                  prompt: 'A consistent character sheet for Ming.',
                  shotIds: ['clip_shared_proxy'],
                },
                {
                  id: referenceIds[1]!,
                  kind: 'character',
                  label: 'Mei',
                  prompt: 'A consistent character sheet for Mei.',
                  shotIds: ['clip_shared_proxy'],
                },
              ],
            },
          ],
        },
        { mutationId: 'define_shared_reference_proxy', capturedAt: new Date().toISOString() }
      );
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
        shotReferenceIds: reloaded.project.shots.clip_shared_proxy.referenceIds,
        authorizationItems: authorization?.baseItems.map((item) => [
          item.shotId,
          item.purpose,
          item.projectReferenceId,
        ]),
        jobs: reloaded.project.shots.clip_shared_proxy.jobIds.map((jobId) => {
          const job = reloaded.project.jobs[jobId]!;
          return [job.id, job.status, job.shotId, job.projectReferenceId];
        }),
        candidateJobIds: referenceIds.map((referenceId) => reloaded.project.references[referenceId]!.candidateJobId),
      }).toEqual({
        referenceOrder: referenceIds,
        shotReferenceIds: referenceIds,
        authorizationItems: [
          ['clip_shared_proxy', 'seed_still', referenceIds[0]],
          ['clip_shared_proxy', 'seed_still', referenceIds[1]],
        ],
        jobs: [
          ['job_shared_reference_1', 'queued_local', 'clip_shared_proxy', referenceIds[0]],
          ['job_shared_reference_2', 'queued_local', 'clip_shared_proxy', referenceIds[1]],
        ],
        candidateJobIds: ['job_shared_reference_1', 'job_shared_reference_2'],
      });
    } finally {
      service?.dispose();
      await fake.dispose().catch((): undefined => undefined);
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it('fails a paid handoff retry closed after its cancelled anchor Shot is parked and reloaded', async () => {
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
            action: 'Establish the recurring character before the fallback Shot',
            look: 'Soft daylight',
            actionRevision: 1,
            targetSeconds: null,
            shotOrder: ['clip_reference_anchor', 'clip_reference_fallback'],
            lineHistory: [],
          },
        },
        shots: Object.fromEntries(
          ['clip_reference_anchor', 'clip_reference_fallback'].map((shotId, index) => [
            shotId,
            {
              id: shotId,
              line: index === 0 ? 'Character reference anchor' : 'Unrelated active fallback Shot',
              derivation: 'derived' as const,
              derivedFromActionRevision: 1,
              narration: '',
              onScreenText: '',
              durationSeconds: 5,
              trimInSeconds: null,
              trimOutSeconds: null,
              chainBreak: 'none' as const,
              referenceIds: [],
              seedStillId: null,
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

      const referenceId = 'reference_parked_retry';
      const defined = await service.applyMutations(
        {
          schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
          projectId: configured.id,
          expectedRevision: configured.revision,
          operations: [
            {
              kind: 'set_project_references',
              references: [
                {
                  id: referenceId,
                  kind: 'character',
                  label: 'Recurring character',
                  prompt: 'One stable character sheet for the recurring character.',
                  shotIds: ['clip_reference_anchor'],
                },
              ],
            },
          ],
        },
        { mutationId: 'define_parked_reference', capturedAt: new Date().toISOString() }
      );
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
          shotId: 'clip_reference_anchor',
          projectReferenceId: referenceId,
          purpose: 'seed_still',
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
          status: 'confirmed',
          progress: { queued: 0, running: 0, succeeded: 0, failed: 1 },
          retryReferenceIds: [referenceId],
        }),
      ]);
      const parked = await service.applyMutations(
        {
          schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
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
      const listGenerationRoutes = vi.fn();
      const loadRateCard = vi.fn();
      const createQuoteId = vi.fn(() => 'quote_parked_reference_unexpected');
      const onProjectUpdated = vi.fn();
      service = createCreativeStudioServiceV2({
        store: restartedStore,
        providerResolver: { listGenerationRoutes } as never,
        jobManager: { dispatchAuthorizedJobsV2: retryDispatch } as never,
        rateCard: loadRateCard,
        createQuoteId,
        createJobId: () => 'job_parked_reference_unexpected',
        createIdempotencyKey: () => 'idempotency_parked_reference_unexpected',
        onProjectUpdated,
      });
      await expect(service.listReferenceGenerationHandoffs({ projectId: configured.id })).resolves.toEqual([
        expect.objectContaining({
          handoffId: decision.outcome.handoffId,
          status: 'confirmed',
          retryReferenceIds: [referenceId],
        }),
      ]);
      const before = {
        revision: reloaded.project.revision,
        authorizations: reloaded.project.spendAuthorizations.map((authorization) => authorization.id),
        jobs: Object.keys(reloaded.project.jobs),
        candidateJobId: reloaded.project.references[referenceId]?.candidateJobId,
      };

      await expect(
        service.prepareProjectReferences({
          projectId: configured.id,
          expectedRevision: reloaded.project.revision,
          referenceIds: [referenceId],
        })
      ).rejects.toMatchObject({ code: 'inactive_shot' });

      const after = await restartedStore.getProjectV2(configured.id);
      if (after.status !== 'supported') throw new Error('Refused retry damaged the reloaded project');
      expect({
        revision: after.project.revision,
        authorizations: after.project.spendAuthorizations.map((authorization) => authorization.id),
        jobs: Object.keys(after.project.jobs),
        candidateJobId: after.project.references[referenceId]?.candidateJobId,
      }).toEqual(before);
      expect(listGenerationRoutes).not.toHaveBeenCalled();
      expect(loadRateCard).not.toHaveBeenCalled();
      expect(createQuoteId).not.toHaveBeenCalled();
      expect(retryDispatch).not.toHaveBeenCalled();
      expect(onProjectUpdated).not.toHaveBeenCalled();
    } finally {
      service?.dispose();
      await fake.dispose().catch((): undefined => undefined);
      await rm(rootDir, { recursive: true, force: true });
    }
  });

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
            action: 'Introduce the product',
            look: 'A luminous folded-paper world',
            actionRevision: 1,
            targetSeconds: null,
            shotOrder: ['clip_lifecycle'],
            lineHistory: [],
          },
        },
        shots: {
          clip_lifecycle: {
            id: 'clip_lifecycle',
            line: 'A paper aircraft banks across a sunrise',
            derivation: 'derived',
            derivedFromActionRevision: 1,
            narration: '',
            onScreenText: '',
            durationSeconds: 5,
            trimInSeconds: null,
            trimOutSeconds: null,
            chainBreak: 'none',
            seedStillId: null,
            boardAssetId: null,
            supersededBoardAssetIds: [],
            videoAssetId: null,
            supersededVideoAssetIds: [],
            referenceIds: [],
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
      const service = createCreativeStudioServiceV2({
        store,
        mediaStore,
        providerResolver,
        jobManager: manager,
        rateCard: async () => rateCard,
        createQuoteId: () => `quote_v2_lifecycle_${++quoteIndex}`,
        createJobId: () => (++jobIndex === 1 ? 'job_v2_lifecycle_reference' : 'job_v2_lifecycle'),
        createIdempotencyKey: () =>
          ++idempotencyIndex === 1 ? 'idempotency_v2_lifecycle_reference' : 'idempotency_v2_lifecycle',
        onProjectUpdated: () => {},
      });

      const referenceId = 'reference_v2_lifecycle_background';
      const referenceDefined = await service.applyMutations(
        {
          schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
          projectId: configured.id,
          expectedRevision: configured.revision,
          operations: [
            {
              kind: 'set_project_references',
              references: [
                {
                  id: referenceId,
                  kind: 'background',
                  label: 'Folded-paper sunrise',
                  prompt: 'A luminous folded-paper sunrise world.',
                  shotIds: ['clip_lifecycle'],
                },
              ],
            },
          ],
        },
        { mutationId: 'define_v2_lifecycle_reference', capturedAt: new Date().toISOString() }
      );
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
        const loaded = await store.getProjectV2(configured.id);
        if (loaded.status !== 'supported') return null;
        const job = loaded.project.jobs.job_v2_lifecycle_reference;
        return job?.status === 'succeeded' && job.outputAssetIdsByRole.primary !== null
          ? { project: loaded.project, assetId: job.outputAssetIdsByRole.primary }
          : null;
      });
      const approved = await service.approveProjectReference({
        projectId: configured.id,
        expectedRevision: referenceCompleted.project.revision,
        referenceId,
        candidateAssetId: referenceCompleted.assetId,
      });
      const prepared = await service.prepareSubmission({
        projectId: configured.id,
        expectedRevision: approved.revision,
        originReferenceHandoffId: null,
        baseChoices: [
          {
            shotId: 'clip_lifecycle',
            purpose: 'seed_still',
            referenceAssetId: null,
          },
        ],
        cascadeChoices: [
          {
            shotId: 'clip_lifecycle',
            purpose: 'video_take',
            referenceAssetId: null,
          },
        ],
      });
      await expect(
        service.confirmSubmission({
          projectId: configured.id,
          quoteId: prepared.baseOnly.id,
          expectedRevision: approved.revision,
        })
      ).resolves.toEqual({ projectId: configured.id, projectRevision: approved.revision + 1 });
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
        jobShotId: job.shotId,
        purpose: job.purpose,
        authorizationId: job.authorizationId,
        authorizationCount: completed.spendAuthorizations.length,
        outputAssetIds: job.outputAssetIds,
        outputAssetIdsByRole: job.outputAssetIdsByRole,
        receiptAuthorizationId: job.spendReceipt?.authorizationId,
        shotJobIds: shot.jobIds,
        shotAssetIds: shot.assetIds,
        referenceAssetIds: asset?.referenceAssetIds,
        videoAssetId: shot.videoAssetId,
        assetShotId: asset?.shotId,
        mediaKind: asset?.mediaKind,
        collection: asset?.managedAsset.collection,
      }).toEqual({
        jobShotId: 'clip_lifecycle',
        purpose: 'seed_still',
        authorizationId: prepared.baseOnly.id,
        authorizationCount: 2,
        outputAssetIds: [primaryAssetId],
        outputAssetIdsByRole: { primary: primaryAssetId, poster: null },
        receiptAuthorizationId: prepared.baseOnly.id,
        shotJobIds: ['job_v2_lifecycle_reference', 'job_v2_lifecycle'],
        shotAssetIds: [referenceCompleted.assetId, primaryAssetId],
        referenceAssetIds: [referenceCompleted.assetId],
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
  });

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
            action: 'Reveal the product in one deliberate move',
            look: 'Restrained morning light with deep silhouettes',
            actionRevision: 1,
            targetSeconds: null,
            shotOrder: ['clip_board'],
            lineHistory: [],
          },
        },
        shots: {
          clip_board: {
            id: 'clip_board',
            line: 'A wide frame reveals the product on a quiet stage',
            derivation: 'derived',
            derivedFromActionRevision: 1,
            narration: '',
            onScreenText: '',
            durationSeconds: 5,
            trimInSeconds: null,
            trimOutSeconds: null,
            chainBreak: 'none',
            seedStillId: null,
            boardAssetId: null,
            supersededBoardAssetIds: [],
            videoAssetId: null,
            supersededVideoAssetIds: [],
            referenceIds: [],
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
          schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
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
            shotId: 'clip_board',
            purpose: 'board_still',
            referenceAssetId: null,
          },
        ],
        cascadeChoices: [],
      });
      expect(prepared).toMatchObject({
        baseOnly: {
          projectRevision: styled.project.revision,
          baseItems: [
            {
              shotId: 'clip_board',
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
