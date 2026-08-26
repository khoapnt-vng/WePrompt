/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { IProvider } from '@/common/config/storage';
import { STUDIO_MUTATION_BATCH_SCHEMA_VERSION } from '@/common/types/project/creativeStudioTypes';
import {
  createStudioE2EFakeBundle,
  createStudioE2EFakeRemoteState,
} from '@process/services/creative-studio/adapters/e2eFakeAdapter';
import { createCreativeStudioServiceV2 } from '@process/services/creative-studio/service';
import { createStudioJobManager } from '@process/services/creative-studio/jobManager';
import { createStudioMediaStore } from '@process/services/creative-studio/mediaStore';
import {
  createStudioProviderResolver,
  type StudioProviderResolver,
} from '@process/services/creative-studio/providerResolver';
import { createStudioRateCardV2 } from '@process/services/creative-studio/service/schema2/pricing';
import { createCreativeStudioStore } from '@process/services/creative-studio/store';
import { describe, expect, it } from 'vitest';

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

const resolverFor = (
  store: ReturnType<typeof createCreativeStudioStore>,
  providers: () => Promise<IProvider[]>
): StudioProviderResolver =>
  createStudioProviderResolver({
    listProviders: providers,
    listConnections: () => store.listConnections(),
  });

describe('Creative Studio project recovery integration', () => {
  it('recovers paid shot work while its beat is active and retains history after parking', async () => {
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
      const videoRoute = catalog.routes.find((candidate) => candidate.kind === 'video');
      if (!imageRoute || !videoRoute) throw new Error('V2 recovery did not resolve the fake media routes');
      const created = await store.createProjectV2({
        name: 'Durable V2 film',
        brief: 'Recover already-paid shot work before parking',
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
            story: 'Keep the paid work durable at sunrise in a glass city.',
            targetSeconds: null,
            shotOrder: ['clip_recovery'],
          },
        },
        shots: {
          clip_recovery: {
            id: 'clip_recovery',
            shootingScript: 'A paper aircraft crosses the reflection.',
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
      const beforeClock = new ControlledPollClock();
      const before = createStudioJobManager({
        store,
        mediaStore,
        providerResolver,
        adapters: fake.adapters,
        listProviders,
        sleep: beforeClock.sleep,
        jitterMs: (baseMs) => baseMs,
      });
      managers.push({ manager: before, clock: beforeClock });
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
      const beforeService = createCreativeStudioServiceV2({
        store,
        mediaStore,
        providerResolver,
        jobManager: before,
        rateCard: async () => rateCard,
        createQuoteId: () => `quote_v2_recovery_${++quoteIndex}`,
        createJobId: () => (++jobIndex === 1 ? 'job_v2_recovery_reference' : 'job_v2_recovery'),
        createIdempotencyKey: () =>
          ++idempotencyIndex === 1 ? 'idempotency_v2_recovery_reference' : 'idempotency_v2_recovery',
        onProjectUpdated: () => {},
      });

      const referenceDefined = await beforeService.applyMutations(
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
                  label: 'Glass-city sunrise',
                  prompt: 'A sunrise reflected through a quiet glass city.',
                },
              ],
            },
          ],
        },
        { mutationId: 'define_v2_recovery_reference', capturedAt: new Date().toISOString() }
      );
      const referenceId = referenceDefined.project.referenceOrder[0]!;
      const referencePrepared = await beforeService.prepareProjectReferences({
        projectId: configured.id,
        expectedRevision: referenceDefined.project.revision,
        referenceIds: [referenceId],
      });
      await beforeService.confirmSubmission({
        projectId: configured.id,
        quoteId: referencePrepared.baseOnly.id,
        expectedRevision: referenceDefined.project.revision,
      });
      for (const delayMs of [2_000, 4_000, 8_000]) (await beforeClock.take(delayMs)).release();
      const referenceCompleted = await waitFor(async () => {
        try {
          const loaded = await store.getProjectV2(configured.id);
          if (loaded.status !== 'supported') return null;
          const job = loaded.project.jobs.job_v2_recovery_reference;
          return job?.status === 'succeeded' && job.outputAssetIdsByRole.primary !== null
            ? { project: loaded.project, assetId: job.outputAssetIdsByRole.primary }
            : null;
        } catch {
          // The active writer can replace project.json between the guarded lstat/open steps.
          return null;
        }
      });
      const approved = await beforeService.applyMutations(
        {
          schemaVersion: STUDIO_MUTATION_BATCH_SCHEMA_VERSION,
          projectId: configured.id,
          expectedRevision: referenceCompleted.project.revision,
          operations: [
            {
              kind: 'set_shot_reference_binding',
              shotId: 'clip_recovery',
              characterReferenceIds: [],
              backgroundReferenceId: referenceId,
            },
          ],
        },
        { mutationId: 'bind_v2_recovery_reference', capturedAt: new Date().toISOString() }
      );
      const prepared = await beforeService.prepareSubmission({
        projectId: configured.id,
        expectedRevision: approved.project.revision,
        originReferenceHandoffId: null,
        baseChoices: [
          {
            target: { kind: 'shot', shotId: 'clip_recovery' },
            purpose: 'seed_still',
          },
        ],
        cascadeChoices: [
          {
            target: { kind: 'shot', shotId: 'clip_recovery' },
            purpose: 'video_take',
          },
        ],
      });
      await expect(
        beforeService.confirmSubmission({
          projectId: configured.id,
          quoteId: prepared.baseOnly.id,
          expectedRevision: approved.project.revision,
        })
      ).resolves.toEqual({ projectId: configured.id, projectRevision: approved.project.revision + 1 });
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
      await beforeClock.take(2_000);
      beforeService.dispose();
      await before.dispose();

      const restartedStore = createCreativeStudioStore({ rootDir });
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
      await after.resumePendingJobsV2([configured.id]);
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
      const parked = await waitFor(async () => {
        try {
          return await restartedStore.updateProjectV2(
            configured.id,
            (project) => ({
              ...project,
              beatOrder: [],
              bin: [...project.bin, { kind: 'beat' as const, beatId: 'section_recovery', reason: 'lifted' as const }],
            }),
            recovered.revision,
            'park_recovered_beat'
          );
        } catch {
          // The terminal state can be observed one guarded file-replace before journal cleanup settles.
          return null;
        }
      });
      const recoveredJob = parked.jobs.job_v2_recovery;
      const primaryAssetId = recoveredJob.outputAssetIdsByRole.primary;
      expect({
        providerJobId: recoveredJob.providerJobId,
        status: recoveredJob.status,
        target: recoveredJob.target,
        purpose: recoveredJob.purpose,
        authorizationId: recoveredJob.authorizationId,
        receiptAuthorizationId: recoveredJob.spendReceipt?.authorizationId,
        outputAssetIds: recoveredJob.outputAssetIds,
        outputAssetIdsByRole: recoveredJob.outputAssetIdsByRole,
        shotJobIds: parked.shots.clip_recovery.jobIds,
        shotAssetIds: parked.shots.clip_recovery.assetIds,
        referenceJobIds: parked.references[referenceId]?.jobIds,
        referenceAssetProjectReferenceId: parked.assets[referenceCompleted.assetId]?.projectReferenceId,
        referenceAssetShotId: parked.assets[referenceCompleted.assetId]?.shotId,
        videoAssetId: parked.shots.clip_recovery.videoAssetId,
        assetShotId: primaryAssetId ? parked.assets[primaryAssetId]?.shotId : null,
        assetMediaKind: primaryAssetId ? parked.assets[primaryAssetId]?.mediaKind : null,
        authorizationIds: parked.spendAuthorizations.map((authorization) => authorization.id),
        beatOrder: parked.beatOrder,
        bin: parked.bin,
      }).toEqual({
        providerJobId: pending.providerJobId,
        status: 'succeeded',
        target: { kind: 'shot', shotId: 'clip_recovery' },
        purpose: 'seed_still',
        authorizationId: prepared.baseOnly.id,
        receiptAuthorizationId: prepared.baseOnly.id,
        outputAssetIds: [primaryAssetId],
        outputAssetIdsByRole: { primary: primaryAssetId, poster: null },
        shotJobIds: ['job_v2_recovery'],
        shotAssetIds: [primaryAssetId],
        referenceJobIds: ['job_v2_recovery_reference'],
        referenceAssetProjectReferenceId: referenceId,
        referenceAssetShotId: null,
        videoAssetId: null,
        assetShotId: 'clip_recovery',
        assetMediaKind: 'image',
        authorizationIds: [referencePrepared.baseOnly.id, prepared.baseOnly.id],
        beatOrder: [],
        bin: [{ kind: 'beat', beatId: 'section_recovery', reason: 'lifted' }],
      });
    } finally {
      for (const { clock } of managers) clock.releaseAll();
      await Promise.all(managers.map(({ manager }) => manager.dispose().catch((): undefined => undefined)));
      await fake.dispose().catch((): undefined => undefined);
      await rm(rootDir, { recursive: true, force: true });
    }
  });
});
