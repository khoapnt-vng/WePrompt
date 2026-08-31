/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment node
 */

import { mkdir, readdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { STUDIO_E2E_OUTPUT_URL_SENTINEL } from '@/process/services/creative-studio/adapters/e2eFakeAdapter';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPhase4Harness, type Phase4Harness, type Phase4HarnessOptions } from './harness';

const harnesses = new Set<Phase4Harness>();

const phase4Harness = async (options: Phase4HarnessOptions = {}): Promise<Phase4Harness> => {
  const harness = await createPhase4Harness(options);
  harnesses.add(harness);
  return harness;
};

const projectIdFor = async (harness: Phase4Harness, name = 'Recovery matrix'): Promise<string> =>
  (await harness.createProject(name)).summary.id;

const createPhotoJob = async (harness: Phase4Harness, projectId: string) => {
  const prepared = await harness.prepareCreate(projectId);
  const queued = await harness.confirm(prepared);
  return { prepared, queued };
};

const yieldToRuntime = async (): Promise<void> => {
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
};

afterEach(async () => {
  const current = [...harnesses];
  harnesses.clear();
  await Promise.allSettled(current.map((harness) => harness.cleanup()));
});

describe('schema-6 Pilot Phase 4 failure and recovery lifecycle', () => {
  it('keeps a rejected Piece retry on the same Piece with a fresh exact quote and authorization', async () => {
    const harness = await phase4Harness();
    const projectId = await projectIdFor(harness, 'Rejected then retried');
    harness.enqueueTaskScript({ submit: { kind: 'rejected', code: 'content_rejected' } });

    const first = await createPhotoJob(harness, projectId);
    const rejected = await harness.waitForJob(projectId, first.queued.jobId, 'failed');
    expect(rejected).toMatchObject({
      pieceId: first.queued.pieceId,
      error: { code: 'content_rejected' },
      canRetry: true,
      recordedSpend: null,
    });
    const afterRejection = await harness.readProjectManifest(projectId);
    const firstAuthorization = afterRejection.spendAuthorizations[0]!;

    harness.enqueueTaskScript({
      pollSteps: [{ kind: 'succeeded', output: { kind: 'managed_file' } }],
    });
    const retryPrepared = await harness.prepareRetry(projectId, first.queued.pieceId, first.queued.jobId);
    expect(retryPrepared.quote).toMatchObject({
      mode: 'retry',
      targetPieceId: first.queued.pieceId,
      proposedHandle: null,
      words: first.prepared.quote.words,
      settings: first.prepared.quote.settings,
    });
    expect(retryPrepared.quote.reservationId).not.toBe(first.prepared.quote.reservationId);
    expect(retryPrepared.quote.quoteId).not.toBe(first.prepared.quote.quoteId);

    const retry = await harness.confirm(retryPrepared);
    expect(retry.pieceId).toBe(first.queued.pieceId);
    expect(retry.jobId).not.toBe(first.queued.jobId);
    await expect(harness.waitForJob(projectId, retry.jobId, 'succeeded')).resolves.toMatchObject({
      pieceId: first.queued.pieceId,
      recordedSpend: { currency: 'USD' },
    });

    const recovered = await harness.readProjectManifest(projectId);
    const piece = recovered.pieces[first.queued.pieceId]!;
    const retryJob = recovered.jobs[retry.jobId]!;
    const retryAuthorization = recovered.spendAuthorizations[1]!;
    expect(recovered.pieceOrder).toEqual([first.queued.pieceId]);
    expect(piece.jobIds).toEqual([first.queued.jobId, retry.jobId]);
    expect(piece.currentAssetId).toBe(retryJob.outputAssetId);
    expect(retryJob).toMatchObject({
      retryOfJobId: first.queued.jobId,
      retryReason: 'provider_failure',
      authorizationId: retryAuthorization.id,
      status: 'succeeded',
    });
    expect(retryAuthorization.id).not.toBe(firstAuthorization.id);
    expect(retryAuthorization.quote.id).not.toBe(firstAuthorization.quote.id);
    expect(retryAuthorization.quote.reservationId).not.toBe(firstAuthorization.quote.reservationId);
    expect(Object.values(recovered.assets)).toEqual([
      expect.objectContaining({ origin: 'generated', producerJobId: retry.jobId }),
    ]);
    expect(harness.fake.getProviderCallCounts().submit).toBe(2);
  });

  it('classifies a provider timeout and malformed poll without inventing paid output', async () => {
    const harness = await phase4Harness();
    const projectId = await projectIdFor(harness, 'Provider failures');
    harness.enqueueTaskScript({ pollSteps: [{ kind: 'failed', code: 'timeout' }] });

    const timedOut = await createPhotoJob(harness, projectId);
    await expect(harness.waitForJob(projectId, timedOut.queued.jobId, 'failed')).resolves.toMatchObject({
      error: { code: 'timeout' },
      canRetry: true,
      canResume: false,
      recordedSpend: null,
    });

    harness.enqueueTaskScript({ pollSteps: [{ kind: 'malformed' }] });
    const malformed = await createPhotoJob(harness, projectId);
    await expect(harness.waitForJob(projectId, malformed.queued.jobId, 'needs_attention')).resolves.toMatchObject({
      error: { code: 'poll_deadline' },
      canRetry: false,
      canResume: true,
      recordedSpend: null,
    });

    const manifest = await harness.readProjectManifest(projectId);
    expect(Object.values(manifest.assets)).toHaveLength(0);
    expect(Object.values(manifest.jobs).every((job) => job.spendReceipt === null)).toBe(true);
    expect(harness.fake.getProviderCallCounts()).toMatchObject({ submit: 2, poll: 2 });
  });

  it('resumes a real failed URL download on the same provider Job without a second submit', async () => {
    const harness = await phase4Harness();
    const projectId = await projectIdFor(harness, 'URL download recovery');
    harness.enqueueDownloadFailure();
    harness.enqueueTaskScript({
      pollSteps: [{ kind: 'succeeded', output: { kind: 'url' } }],
    });

    const created = await createPhotoJob(harness, projectId);
    await expect(harness.waitForJob(projectId, created.queued.jobId, 'needs_attention')).resolves.toMatchObject({
      pieceId: created.queued.pieceId,
      error: { code: 'poll_deadline' },
      canResume: true,
      recordedSpend: { currency: 'USD' },
    });
    const interrupted = await harness.loadSupported(projectId);
    const interruptedManifest = await harness.readProjectManifest(projectId);
    const providerJobId = interruptedManifest.jobs[created.queued.jobId]!.providerJobId;
    const beforeRecovery = harness.fake.getProviderCallCounts();
    expect(providerJobId).not.toBeNull();
    expect(harness.downloadRequestCount).toBe(1);
    expect(await readFile(harness.manifestPath(projectId), 'utf8')).not.toContain(STUDIO_E2E_OUTPUT_URL_SENTINEL);

    await expect(
      harness.entryPoint.resumeJobV3({
        projectId,
        pieceId: created.queued.pieceId,
        jobId: created.queued.jobId,
        expectedRevision: interrupted.canvas.revision,
      })
    ).resolves.toMatchObject({
      status: 'recovering',
      pieceId: created.queued.pieceId,
      jobId: created.queued.jobId,
    });
    await expect(harness.waitForJob(projectId, created.queued.jobId, 'succeeded')).resolves.toMatchObject({
      recordedSpend: { currency: 'USD' },
    });

    const recovered = await harness.readProjectManifest(projectId);
    expect(recovered.pieces[created.queued.pieceId]!.jobIds).toEqual([created.queued.jobId]);
    expect(recovered.jobs[created.queued.jobId]).toMatchObject({
      providerJobId,
      status: 'succeeded',
      spendReceipt: { jobId: created.queued.jobId },
    });
    expect(Object.values(recovered.assets)).toEqual([
      expect.objectContaining({ origin: 'generated', producerJobId: created.queued.jobId }),
    ]);
    expect(harness.downloadRequestCount).toBe(2);
    expect(harness.fake.getProviderCallCounts().submit).toBe(beforeRecovery.submit);
  });

  it('retries one durable-intent storage failure on the same paid Job', async () => {
    const harness = await phase4Harness();
    const projectId = await projectIdFor(harness, 'Durable intent recovery');
    const barrier = harness.pauseMediaStepOnce('media:intent_durable');
    harness.enqueueTaskScript({
      pollSteps: [{ kind: 'succeeded', output: { kind: 'managed_file' } }],
    });

    const created = await createPhotoJob(harness, projectId);
    await barrier.reached;
    const mediaRoot = path.join(harness.projectPath(projectId), 'media-v3');
    const intentsDirectory = path.join(mediaRoot, '.intents');
    const [intentFile] = await readdir(intentsDirectory);
    if (intentFile === undefined) throw new Error('Expected one durable generated-media intent');
    const intent = JSON.parse(await readFile(path.join(intentsDirectory, intentFile), 'utf8')) as {
      finalFileName?: unknown;
      stageFileName?: unknown;
    };
    if (typeof intent.stageFileName !== 'string' || typeof intent.finalFileName !== 'string') {
      throw new Error('Durable intent omitted its managed-file identity');
    }
    const finalPath = path.join(mediaRoot, 'assets', intent.finalFileName);
    try {
      // A conflicting directory models a final-publication storage refusal while preserving the
      // exact durable intent and staged bytes that same-Job retryDownload must later reclaim.
      await mkdir(finalPath);
    } finally {
      barrier.release();
    }
    await expect(harness.waitForJob(projectId, created.queued.jobId, 'failed')).resolves.toMatchObject({
      error: { code: 'download_failed' },
      canRetryDownload: true,
      recordedSpend: { currency: 'USD' },
    });
    expect(await readdir(intentsDirectory)).toEqual([intentFile]);
    expect(await readdir(path.join(mediaRoot, '.parts'))).toEqual([intent.stageFileName]);

    // Keep the obstruction in place until the scheduler tail has observed the failed recovery.
    // The peer models a fresh Main process before startup recovery, so retryDownload remains the
    // only operation that claims the durable intent and no internal scheduler wait is needed.
    await harness.stop();
    await rm(finalPath, { recursive: true });
    const beforeDownloadRetry = await harness.readProjectManifest(projectId);
    const providerCallsBeforeRetry = { ...harness.remoteState.providerCallCounts };
    const peer = await harness.createDetachedRuntime();

    try {
      await expect(
        peer.entryPoint.retryDownloadV3({
          projectId,
          pieceId: created.queued.pieceId,
          jobId: created.queued.jobId,
          expectedRevision: beforeDownloadRetry.revision,
        })
      ).resolves.toMatchObject({
        status: 'recovering',
        pieceId: created.queued.pieceId,
        jobId: created.queued.jobId,
      });
      const projected = await peer.entryPoint.loadProjectV3(projectId);
      expect(projected.status).toBe('supported');
      if (projected.status !== 'supported') throw new Error('Expected recovered schema-6 project');
      expect(projected.activity.jobs.find((job) => job.jobId === created.queued.jobId)).toMatchObject({
        jobId: created.queued.jobId,
        status: 'succeeded',
        recordedSpend: { currency: 'USD' },
      });
    } finally {
      await peer.dispose();
    }

    const recovered = await harness.readProjectManifest(projectId);
    expect(recovered.pieces[created.queued.pieceId]!.jobIds).toEqual([created.queued.jobId]);
    expect(recovered.jobs[created.queued.jobId]).toMatchObject({
      status: 'succeeded',
      spendReceipt: { jobId: created.queued.jobId },
      outputAssetId: recovered.pieces[created.queued.pieceId]!.currentAssetId,
    });
    expect(await readdir(intentsDirectory)).toEqual([]);
    expect(harness.remoteState.providerCallCounts).toEqual(providerCallsBeforeRetry);
  });

  it('refuses variation grids and duplicate primary outputs without publishing either Piece', async () => {
    const harness = await phase4Harness();
    const projectId = await projectIdFor(harness, 'Invalid paid output');
    harness.enqueueTaskScript({
      pollSteps: [{ kind: 'succeeded', output: { kind: 'variation_grid' } }],
    });

    const grid = await createPhotoJob(harness, projectId);
    await expect(harness.waitForJob(projectId, grid.queued.jobId, 'failed')).resolves.toMatchObject({
      error: { code: 'variation_grid' },
      canRetry: true,
      recordedSpend: { currency: 'USD' },
    });

    harness.enqueueTaskScript({
      pollSteps: [{ kind: 'succeeded', output: { kind: 'duplicate_outputs' } }],
    });
    const duplicate = await createPhotoJob(harness, projectId);
    await expect(harness.waitForJob(projectId, duplicate.queued.jobId, 'failed')).resolves.toMatchObject({
      error: { code: 'no_output' },
      canRetry: true,
      recordedSpend: { currency: 'USD' },
    });

    const manifest = await harness.readProjectManifest(projectId);
    expect(Object.values(manifest.assets)).toEqual([]);
    expect(manifest.pieces[grid.queued.pieceId]!.currentAssetId).toBeNull();
    expect(manifest.pieces[duplicate.queued.pieceId]!.currentAssetId).toBeNull();
    expect(Object.values(manifest.jobs).filter((job) => job.spendReceipt !== null)).toHaveLength(2);
  });

  it('cancels queued provider work without a receipt, asset, or replacement Job', async () => {
    const harness = await phase4Harness();
    const projectId = await projectIdFor(harness, 'Queued cancellation');
    harness.enqueueTaskScript({
      pollSteps: [
        { kind: 'hold', status: 'queued' },
        { kind: 'succeeded', output: { kind: 'managed_file' } },
      ],
    });

    const created = await createPhotoJob(harness, projectId);
    await expect(harness.waitForJob(projectId, created.queued.jobId, 'queued_remote')).resolves.toMatchObject({
      canCancel: true,
      recordedSpend: null,
    });
    await expect(
      harness.entryPoint.cancelJobV3({
        projectId,
        pieceId: created.queued.pieceId,
        jobId: created.queued.jobId,
      })
    ).resolves.toMatchObject({
      status: 'cancelled',
      pieceId: created.queued.pieceId,
      jobId: created.queued.jobId,
    });
    await expect(harness.waitForJob(projectId, created.queued.jobId, 'cancelled')).resolves.toMatchObject({
      canRetry: true,
      recordedSpend: null,
    });

    const manifest = await harness.readProjectManifest(projectId);
    expect(manifest.pieces[created.queued.pieceId]).toMatchObject({
      currentAssetId: null,
      jobIds: [created.queued.jobId],
    });
    expect(manifest.jobs[created.queued.jobId]).toMatchObject({ status: 'cancelled', spendReceipt: null });
    expect(manifest.assets).toEqual({});
    expect(harness.fake.getProviderCallCounts().cancel).toBe(1);
  });

  it('fences cancellation while a receipt-less generated-media intent is durable', async () => {
    const harness = await phase4Harness();
    const projectId = await projectIdFor(harness, 'Paid handoff cancellation fence');
    const barrier = harness.pauseMediaStepOnce('media:intent_durable');
    harness.enqueueTaskScript({
      pollSteps: [{ kind: 'succeeded', output: { kind: 'managed_file' } }],
    });

    const created = await createPhotoJob(harness, projectId);
    await barrier.reached;
    const interrupted = await harness.readProjectManifest(projectId);
    expect(interrupted.jobs[created.queued.jobId]).toMatchObject({
      status: 'queued_remote',
      spendReceipt: null,
      outputAssetId: null,
    });
    expect(await readdir(path.join(harness.projectPath(projectId), 'media-v3', '.intents'))).toHaveLength(1);
    const peer = await harness.createDetachedRuntime();
    const inspectClaim = vi.spyOn(peer.runtime.media, 'inspectGeneratedOutputClaimUnderAuthorityV3');
    try {
      await expect(
        peer.entryPoint.cancelJobV3({
          projectId,
          pieceId: created.queued.pieceId,
          jobId: created.queued.jobId,
        })
      ).rejects.toMatchObject({ code: 'cancellation_refused' });
      expect(inspectClaim).toHaveBeenCalledOnce();
      expect(harness.fake.getProviderCallCounts().cancel).toBe(0);
    } finally {
      await peer.dispose();
      barrier.release();
    }
    await expect(harness.waitForJob(projectId, created.queued.jobId, 'succeeded')).resolves.toMatchObject({
      recordedSpend: { currency: 'USD' },
    });
    expect(harness.fake.getProviderCallCounts().cancel).toBe(0);
  });
});

describe('schema-6 Pilot Phase 4 restart matrix', () => {
  it('restarts one durable queued_local Job through the public commit observer', async () => {
    const harness = await phase4Harness();
    const projectId = await projectIdFor(harness, 'Restart queued local');
    const prepared = await harness.prepareCreate(projectId);
    const before = await harness.loadSupported(projectId);
    let stopFlight: Promise<void> | undefined;
    const unwatch = harness.entryPoint.watchProjectUpdatesV3((update) => {
      if (
        update.source === 'durable' &&
        update.facts.projectId === projectId &&
        update.facts.committedRevision === before.canvas.revision + 1 &&
        stopFlight === undefined
      ) {
        stopFlight = harness.stop();
      }
    });

    const queued = await harness.confirm(prepared);
    unwatch();
    if (stopFlight === undefined) throw new Error('Queued-local commit observer did not stop the runtime');
    await stopFlight;
    const interrupted = await harness.readProjectManifest(projectId);
    expect(interrupted.jobs[queued.jobId]).toMatchObject({
      status: 'queued_local',
      providerSubmissionKind: null,
      providerJobId: null,
      spendReceipt: null,
    });
    expect(harness.remoteState.providerCallCounts.submit).toBe(0);

    await harness.restart();
    await expect(harness.waitForJob(projectId, queued.jobId, 'succeeded')).resolves.toMatchObject({
      pieceId: queued.pieceId,
      recordedSpend: { currency: 'USD' },
    });
    expect(harness.fake.getProviderCallCounts().submit).toBe(1);
    expect((await harness.readProjectManifest(projectId)).pieces[queued.pieceId]!.jobIds).toEqual([queued.jobId]);
  });

  it('turns an interrupted submitting Job into submission_unknown without a second provider task', async () => {
    const harness = await phase4Harness();
    const projectId = await projectIdFor(harness, 'Restart submitting');
    harness.enqueueTaskScript({ submit: { kind: 'hold' } });
    const created = await createPhotoJob(harness, projectId);
    await harness.waitForJob(projectId, created.queued.jobId, 'submitting');
    const idempotencyKey = (await harness.readProjectManifest(projectId)).jobs[created.queued.jobId]!.idempotencyKey;
    expect(harness.remoteState.submissionHolds.get(idempotencyKey)).toMatchObject({ aborted: false, released: false });

    await harness.stop();
    expect((await harness.readProjectManifest(projectId)).jobs[created.queued.jobId]!.status).toBe('submitting');
    expect(harness.remoteState.submissionHolds.get(idempotencyKey)).toMatchObject({ aborted: true, released: false });
    expect(harness.remoteState.tasks).toHaveLength(0);

    await harness.restart();
    await expect(harness.waitForJob(projectId, created.queued.jobId, 'needs_attention')).resolves.toMatchObject({
      error: { code: 'submission_unknown' },
      canRetry: true,
      recordedSpend: null,
    });
    expect(harness.fake.getProviderCallCounts().submit).toBe(1);
    expect(harness.remoteState.tasks).toHaveLength(0);
  });

  it.each([
    ['queued_remote', 'queued'],
    ['running', 'running'],
  ] as const)('restarts one durable %s Job on its existing provider task', async (durableStatus, holdStatus) => {
    const harness = await phase4Harness();
    const projectId = await projectIdFor(harness, `Restart ${durableStatus}`);
    harness.enqueueTaskScript({
      pollSteps: [
        { kind: 'hold', status: holdStatus, ...(holdStatus === 'running' ? { progress: 40 } : {}) },
        { kind: 'succeeded', output: { kind: 'managed_file' } },
      ],
    });
    const created = await createPhotoJob(harness, projectId);
    await harness.waitForJob(projectId, created.queued.jobId, durableStatus);

    await harness.stop();
    const interrupted = await harness.readProjectManifest(projectId);
    const providerJobId = interrupted.jobs[created.queued.jobId]!.providerJobId;
    expect(interrupted.jobs[created.queued.jobId]).toMatchObject({
      status: durableStatus,
      providerSubmissionKind: 'remote',
      spendReceipt: null,
    });
    expect(providerJobId).not.toBeNull();

    await harness.restart();
    expect(harness.releaseTaskHold(providerJobId!)).toBe(true);
    await expect(harness.waitForJob(projectId, created.queued.jobId, 'succeeded')).resolves.toMatchObject({
      pieceId: created.queued.pieceId,
      recordedSpend: { currency: 'USD' },
    });
    const recovered = await harness.readProjectManifest(projectId);
    expect(recovered.jobs[created.queued.jobId]).toMatchObject({ providerJobId, status: 'succeeded' });
    expect(recovered.pieces[created.queued.pieceId]!.jobIds).toEqual([created.queued.jobId]);
    expect(harness.fake.getProviderCallCounts().submit).toBe(1);
  });

  it('restarts a durable poll-deadline Job and resumes its existing provider task', async () => {
    const harness = await phase4Harness();
    const projectId = await projectIdFor(harness, 'Restart needs attention');
    harness.enqueueTaskScript({
      pollSteps: [{ kind: 'malformed' }, { kind: 'succeeded', output: { kind: 'managed_file' } }],
    });
    const created = await createPhotoJob(harness, projectId);
    await expect(harness.waitForJob(projectId, created.queued.jobId, 'needs_attention')).resolves.toMatchObject({
      error: { code: 'poll_deadline' },
      canResume: true,
    });
    await yieldToRuntime();

    await harness.stop();
    const interrupted = await harness.readProjectManifest(projectId);
    const providerJobId = interrupted.jobs[created.queued.jobId]!.providerJobId;
    expect(interrupted.jobs[created.queued.jobId]).toMatchObject({
      status: 'needs_attention',
      error: { code: 'poll_deadline' },
      spendReceipt: null,
    });

    await harness.restart();
    await expect(harness.waitForJob(projectId, created.queued.jobId, 'succeeded')).resolves.toMatchObject({
      pieceId: created.queued.pieceId,
      recordedSpend: { currency: 'USD' },
    });
    expect((await harness.readProjectManifest(projectId)).jobs[created.queued.jobId]).toMatchObject({
      providerJobId,
      status: 'succeeded',
    });
    expect(harness.fake.getProviderCallCounts().submit).toBe(1);
  });
});
