/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createStudioE2EFakeBundle } from '@process/services/creative-studio/adapters/e2eFakeAdapter';
import { createStudioJobManager } from '@process/services/creative-studio/jobManager';
import { createStudioMediaStore } from '@process/services/creative-studio/mediaStore';
import { createStudioProviderResolver } from '@process/services/creative-studio/providerResolver';
import { createCreativeStudioServiceV2 } from '@process/services/creative-studio/service';
import { createStudioRateCardV2 } from '@process/services/creative-studio/service/schema2/pricing';
import { createCreativeStudioStore } from '@process/services/creative-studio/store';
import { describe, expect, it } from 'vitest';

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
            selectedTakeId: null,
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
      const service = createCreativeStudioServiceV2({
        store,
        mediaStore,
        providerResolver,
        jobManager: manager,
        rateCard: async () => rateCard,
        createQuoteId: () => `quote_v2_lifecycle_${++quoteIndex}`,
        createJobId: () => 'job_v2_lifecycle',
        createIdempotencyKey: () => 'idempotency_v2_lifecycle',
        onProjectUpdated: () => {},
      });
      const prepared = await service.prepareSubmission({
        projectId: configured.id,
        expectedRevision: configured.revision,
        originReferenceHandoffId: null,
        baseChoices: [
          {
            shotId: 'clip_lifecycle',
            purpose: 'seed_still',
            generationCount: 1,
            referenceAssetId: null,
          },
        ],
        cascadeChoices: [
          {
            shotId: 'clip_lifecycle',
            purpose: 'video_take',
            generationCount: 1,
            referenceAssetId: null,
          },
        ],
      });
      await expect(
        service.confirmSubmission({
          projectId: configured.id,
          quoteId: prepared.baseOnly.id,
          expectedRevision: configured.revision,
        })
      ).resolves.toEqual({ projectId: configured.id, projectRevision: configured.revision + 1 });
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
        selectedTakeId: shot.selectedTakeId,
        assetShotId: asset?.shotId,
        mediaKind: asset?.mediaKind,
        collection: asset?.managedAsset.collection,
      }).toEqual({
        jobShotId: 'clip_lifecycle',
        purpose: 'seed_still',
        authorizationId: prepared.baseOnly.id,
        authorizationCount: 1,
        outputAssetIds: [primaryAssetId],
        outputAssetIdsByRole: { primary: primaryAssetId, poster: null },
        receiptAuthorizationId: prepared.baseOnly.id,
        shotJobIds: ['job_v2_lifecycle'],
        shotAssetIds: [primaryAssetId],
        selectedTakeId: null,
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
});
