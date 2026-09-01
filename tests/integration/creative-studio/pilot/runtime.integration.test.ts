/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment node
 */

import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { IProvider } from '@/common/config/storage';
import type { GenerationProviderAdapter, ProviderOutput } from '@/process/services/creative-studio/adapters';
import type { StudioGenerationRouteCatalog } from '@/process/services/creative-studio/providerResolver';
import {
  createCreativeStudioPilotRuntimeV3,
  type CreativeStudioPilotRuntimeDepsV3,
  type StudioPilotRuntimeIdentityKindV3,
  type CreativeStudioPilotRuntimeV3,
} from '@/process/services/creative-studio/service/pilot';
import sharp from 'sharp';
import { afterEach, describe, expect, it, vi } from 'vitest';

const sandboxes: string[] = [];
const runtimes: CreativeStudioPilotRuntimeV3[] = [];

afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.dispose()));
  await Promise.all(sandboxes.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const makePng = async (filePath: string): Promise<Buffer> => {
  const width = 40;
  const height = 30;
  const pixels = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 3;
      pixels[offset] = (x * 5 + y * 3) % 256;
      pixels[offset + 1] = (x * 2 + y * 7) % 256;
      pixels[offset + 2] = (x * 11 + y) % 256;
    }
  }
  const bytes = await sharp(pixels, { raw: { width, height, channels: 3 } })
    .png()
    .toBuffer();
  await writeFile(filePath, bytes);
  return bytes;
};

const createMinimalRuntime = (
  rootDir: string,
  overrides: Partial<Pick<CreativeStudioPilotRuntimeDepsV3, 'now'>> = {}
): CreativeStudioPilotRuntimeV3 =>
  createCreativeStudioPilotRuntimeV3({
    rootDir,
    providerResolver: {
      listGenerationRoutes: async () => ({ routes: [], diagnostics: [], generationCatalogVersion: 'empty' }),
    },
    adapters: new Map(),
    listProviders: async () => [],
    pickPhoto: async () => null,
    resolveGeneratedUrl: async () => {
      throw new Error('no generated URL is expected');
    },
    ...overrides,
  });

describe('composed schema-6 Pilot runtime', () => {
  it('uses safe process-owned defaults when optional clocks and schedulers are omitted', async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'studio-pilot-v3-default-runtime-'));
    sandboxes.push(rootDir);
    const runtime = createMinimalRuntime(rootDir);
    runtimes.push(runtime);

    await runtime.startV3();
    const created = await runtime.entryPoint.createProjectV3({ name: 'Default runtime', brief: '' });

    expect(Date.parse(created.summary.createdAt)).toBeGreaterThan(0);
  });

  it('forwards one deterministic Main identity source across the composed runtime', async () => {
    const sandbox = await mkdtemp(path.join(os.tmpdir(), 'studio-pilot-v3-identities-'));
    sandboxes.push(sandbox);
    const rootDir = path.join(sandbox, 'projects');
    const sourcePath = path.join(sandbox, 'identity-source.png');
    await makePng(sourcePath);
    const route: StudioGenerationRouteCatalog['routes'][number] = {
      choiceId: 'route_identity',
      providerId: 'provider_identity',
      providerName: 'Identity provider',
      adapterId: 'weprompt-image-v1',
      model: 'identity-model',
      health: 'available',
      kind: 'image',
      constraints: {
        aspectRatios: ['16:9'],
        resolutions: ['1080p'],
        minDurationSeconds: 1,
        maxDurationSeconds: 60,
        supportsFirstFrame: false,
        maxConditioningImages: 0,
        silentOutput: true,
      },
      cancellationPolicy: 'none',
    };
    const identityCounts = new Map<StudioPilotRuntimeIdentityKindV3, number>();
    const mintIdentity = vi.fn((kind: StudioPilotRuntimeIdentityKindV3): string => {
      const next = (identityCounts.get(kind) ?? 0) + 1;
      identityCounts.set(kind, next);
      return `${kind}_${String(next).padStart(8, '0')}`;
    });
    let clock = Date.parse('2026-08-31T12:00:00.000Z');
    const runtime = createCreativeStudioPilotRuntimeV3({
      rootDir,
      providerResolver: {
        listGenerationRoutes: async () => ({
          routes: [route],
          diagnostics: [],
          generationCatalogVersion: 'identity-catalog',
        }),
      },
      adapters: new Map(),
      listProviders: async () => [],
      pickPhoto: async () => ({ path: sourcePath, fileName: 'Identity source.png' }),
      resolveGeneratedUrl: async () => {
        throw new Error('identity test does not download generated output');
      },
      now: () => clock++,
      mintIdentity,
    });
    runtimes.push(runtime);
    await runtime.startV3();

    const created = await runtime.entryPoint.createProjectV3({ name: 'Identity runtime', brief: '' });
    const imported = await runtime.entryPoint.importPhotoV3({
      projectId: created.summary.id,
      expectedAuthoringRevision: 1,
    });
    if (imported.status !== 'imported') throw new Error('identity fixture import was cancelled');
    const intentsDirectory = path.join(rootDir, created.summary.id, 'media-v3', '.intents');
    await writeFile(path.join(intentsDirectory, 'malformed.json'), '{}\n');
    await runtime.media.recoverProjectMediaV3(created.summary.id);
    const edited = await runtime.entryPoint.applyMutationBatchV3({
      schemaVersion: 6,
      projectId: created.summary.id,
      expectedAuthoringRevision: imported.authoringRevision,
      operations: [{ kind: 'set_brief', brief: 'A deterministic identity fixture.' }],
    });
    const prepared = await runtime.entryPoint.preparePhotoV3({
      mode: 'create',
      projectId: created.summary.id,
      expectedAuthoringRevision: edited.authoringRevision,
      words: 'A second photograph',
      settings: { aspectRatio: '16:9', resolution: '1080p' },
      suggestedHandle: null,
      referencePieceIds: [],
    });
    const exportCatalog = await runtime.entryPoint.listPieceExportsV3(created.summary.id);
    const exported = await runtime.entryPoint.exportPieceV3({
      projectId: created.summary.id,
      pieceId: imported.pieceId,
      expectedRevision: edited.revision,
      expectedCatalogRevision: exportCatalog.revision,
    });

    expect({
      projectId: created.summary.id,
      pieceId: imported.pieceId,
      assetId: imported.assetId,
      reservationId: prepared.quote.reservationId,
      quoteId: prepared.quote.quoteId,
      targetPieceId: prepared.quote.targetPieceId,
      exportId: exported.catalog.artifacts[0]?.id,
    }).toEqual({
      projectId: 'project_00000001',
      pieceId: 'piece_00000001',
      assetId: 'asset_00000001',
      reservationId: 'reservation_00000001',
      quoteId: 'quote_00000001',
      targetPieceId: 'piece_00000002',
      exportId: 'export_00000001',
    });
    expect(new Set(mintIdentity.mock.calls.map(([kind]) => kind))).toEqual(
      new Set<StudioPilotRuntimeIdentityKindV3>([
        'project',
        'store_temporary',
        'piece',
        'asset',
        'media_intent',
        'media_temporary',
        'mutation',
        'reservation',
        'job',
        'authorization',
        'quote',
        'idempotency',
        'export',
        'export_nonce',
      ])
    );
  });

  it('fails closed when a custom process clock cannot produce a durable timestamp', async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'studio-pilot-v3-invalid-clock-'));
    sandboxes.push(rootDir);
    const runtime = createMinimalRuntime(rootDir, { now: () => -1 });
    runtimes.push(runtime);

    await expect(runtime.entryPoint.createProjectV3({ name: 'Invalid clock', brief: '' })).rejects.toMatchObject({
      code: 'storage_error',
    });
  });

  it('restores prepared create and retry quotes on renderer reload but clears both on Main restart', async () => {
    const sandbox = await mkdtemp(path.join(os.tmpdir(), 'studio-pilot-v3-prepared-restart-'));
    sandboxes.push(sandbox);
    const rootDir = path.join(sandbox, 'projects');
    const provider: IProvider = {
      id: 'provider_retry',
      platform: 'gemini',
      name: 'Retry provider',
      base_url: 'https://provider.invalid/v1',
      api_key: 'private-api-key',
      models: ['retry-model'],
      enabled: true,
      model_enabled: { 'retry-model': true },
      model_health: { 'retry-model': { status: 'healthy' } },
    };
    const route: StudioGenerationRouteCatalog['routes'][number] = {
      choiceId: 'route_retry',
      providerId: provider.id,
      providerName: provider.name,
      adapterId: 'weprompt-image-v1',
      model: 'retry-model',
      health: 'available',
      kind: 'image',
      constraints: {
        aspectRatios: ['16:9'],
        resolutions: ['1080p'],
        minDurationSeconds: 1,
        maxDurationSeconds: 60,
        supportsFirstFrame: false,
        maxConditioningImages: 0,
        silentOutput: true,
      },
      cancellationPolicy: 'none',
    };
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
      submit: vi.fn(async () => ({ kind: 'remote' as const, providerJobId: 'provider_job_failed' })),
      poll: vi.fn(async () => ({ status: 'failed' as const, error: { code: 'provider_unavailable' as const } })),
    };
    const deps: CreativeStudioPilotRuntimeDepsV3 = {
      rootDir,
      providerResolver: {
        listGenerationRoutes: async () => ({
          routes: [route],
          diagnostics: [],
          generationCatalogVersion: 'retry-catalog',
        }),
      },
      adapters: new Map([['weprompt-image-v1', adapter]]),
      listProviders: async () => [provider],
      pickPhoto: async () => null,
      resolveGeneratedUrl: async () => {
        throw new Error('failed provider work has no generated URL');
      },
      now: () => Date.parse('2026-08-31T11:00:00.000Z'),
      sleep: async () => undefined,
    };

    const firstMain = createCreativeStudioPilotRuntimeV3(deps);
    runtimes.push(firstMain);
    await firstMain.startV3();
    const created = await firstMain.entryPoint.createProjectV3({ name: 'Prepared restart', brief: '' });
    const preparedCreate = await firstMain.entryPoint.preparePhotoV3({
      mode: 'create',
      projectId: created.summary.id,
      expectedAuthoringRevision: 1,
      words: 'A transient first photograph',
      settings: { aspectRatio: '16:9', resolution: '1080p' },
      suggestedHandle: null,
      referencePieceIds: [],
    });
    await expect(firstMain.entryPoint.loadProjectV3(created.summary.id)).resolves.toMatchObject({
      status: 'supported',
      activity: {
        preparedPhotoQuotes: [{ reservationId: preparedCreate.quote.reservationId, mode: 'create' }],
      },
    });

    await firstMain.dispose();
    const secondMain = createCreativeStudioPilotRuntimeV3(deps);
    runtimes.push(secondMain);
    await secondMain.startV3();
    await expect(secondMain.entryPoint.loadProjectV3(created.summary.id)).resolves.toMatchObject({
      status: 'supported',
      summary: { pieceCount: 0 },
      activity: { preparedPhotoQuotes: [] },
    });

    const replacementCreate = await secondMain.entryPoint.preparePhotoV3({
      mode: 'create',
      projectId: created.summary.id,
      expectedAuthoringRevision: 1,
      words: 'A durable failed photograph',
      settings: { aspectRatio: '16:9', resolution: '1080p' },
      suggestedHandle: null,
      referencePieceIds: [],
    });
    const confirmed = await secondMain.entryPoint.confirmPreparedPhotoV3({
      reservationId: replacementCreate.quote.reservationId,
      quoteId: replacementCreate.quote.quoteId,
      quoteRevision: replacementCreate.quote.quoteRevision,
      explicitHumanConfirmation: true,
      duplicateChargeAcknowledged: false,
    });
    await secondMain.jobs.waitForIdleV3();
    const failed = await secondMain.store.loadProjectV3(created.summary.id);
    expect(failed.jobs[confirmed.jobId]).toMatchObject({
      status: 'failed',
      error: { code: 'provider_unavailable' },
    });

    const preparedRetry = await secondMain.entryPoint.preparePhotoV3({
      mode: 'retry',
      projectId: failed.id,
      expectedAuthoringRevision: failed.authoringRevision,
      pieceId: confirmed.pieceId,
      sourceJobId: confirmed.jobId,
    });
    await expect(secondMain.entryPoint.loadProjectV3(failed.id)).resolves.toMatchObject({
      status: 'supported',
      activity: {
        preparedPhotoQuotes: [
          {
            reservationId: preparedRetry.quote.reservationId,
            mode: 'retry',
            targetPieceId: confirmed.pieceId,
          },
        ],
      },
    });
    const durableBeforeRestart = structuredClone({
      piece: failed.pieces[confirmed.pieceId],
      job: failed.jobs[confirmed.jobId],
      authorizations: failed.spendAuthorizations,
    });

    await secondMain.dispose();
    const thirdMain = createCreativeStudioPilotRuntimeV3(deps);
    runtimes.push(thirdMain);
    await thirdMain.startV3();
    const afterRestart = await thirdMain.store.loadProjectV3(failed.id);
    await expect(thirdMain.entryPoint.loadProjectV3(failed.id)).resolves.toMatchObject({
      status: 'supported',
      activity: { preparedPhotoQuotes: [] },
    });
    expect({
      piece: afterRestart.pieces[confirmed.pieceId],
      job: afterRestart.jobs[confirmed.jobId],
      authorizations: afterRestart.spendAuthorizations,
    }).toEqual(durableBeforeRestart);
  });

  it('replays a complete-only provider result after a publication crash without a second submit or authorization', async () => {
    const sandbox = await mkdtemp(path.join(os.tmpdir(), 'studio-pilot-v3-complete-recovery-'));
    sandboxes.push(sandbox);
    const rootDir = path.join(sandbox, 'projects');
    const outputPath = path.join(sandbox, 'complete-output.png');
    const outputBytes = await makePng(outputPath);
    const provider: IProvider = {
      id: 'provider_complete',
      platform: 'gemini',
      name: 'Complete-only provider',
      base_url: 'https://provider.invalid/v1',
      api_key: 'private-api-key',
      models: ['complete-model'],
      enabled: true,
      model_enabled: { 'complete-model': true },
      model_health: { 'complete-model': { status: 'healthy' } },
    };
    const route: StudioGenerationRouteCatalog['routes'][number] = {
      choiceId: 'route_complete',
      providerId: provider.id,
      providerName: provider.name,
      adapterId: 'weprompt-image-v1',
      model: 'complete-model',
      health: 'available',
      kind: 'image',
      constraints: {
        aspectRatios: ['16:9'],
        resolutions: ['1080p'],
        minDurationSeconds: 1,
        maxDurationSeconds: 60,
        supportsFirstFrame: false,
        maxConditioningImages: 0,
        silentOutput: true,
      },
      cancellationPolicy: 'none',
    };
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
      submit: vi.fn(async () => ({
        kind: 'complete' as const,
        outputs: [
          {
            mediaKind: 'image' as const,
            role: 'primary' as const,
            source: { kind: 'file' as const, path: outputPath },
            mimeType: 'image/png',
            byteSize: outputBytes.length,
            width: 40,
            height: 30,
          },
        ],
      })),
    };
    let failFinalPublication = true;
    const deps: CreativeStudioPilotRuntimeDepsV3 = {
      rootDir,
      providerResolver: {
        listGenerationRoutes: async () => ({
          routes: [route],
          diagnostics: [],
          generationCatalogVersion: 'complete-catalog',
        }),
      },
      adapters: new Map([['weprompt-image-v1', adapter]]),
      listProviders: async () => [provider],
      pickPhoto: async () => null,
      resolveGeneratedUrl: async () => {
        throw new Error('complete output is already a local provider file');
      },
      now: () => Date.parse('2026-08-31T11:30:00.000Z'),
      sleep: async () => undefined,
      onMediaStorageStep: (step) => {
        if (failFinalPublication && step === 'media:final_durable') {
          failFinalPublication = false;
          throw new Error('simulated process death');
        }
      },
    };
    const runtime = createCreativeStudioPilotRuntimeV3(deps);
    runtimes.push(runtime);
    await runtime.startV3();
    const created = await runtime.entryPoint.createProjectV3({ name: 'Recover complete', brief: 'One exact photo.' });
    const prepared = await runtime.entryPoint.preparePhotoV3({
      mode: 'create',
      projectId: created.summary.id,
      expectedAuthoringRevision: 1,
      words: 'One recovered photograph',
      settings: { aspectRatio: '16:9', resolution: '1080p' },
      suggestedHandle: null,
      referencePieceIds: [],
    });
    const confirmed = await runtime.entryPoint.confirmPreparedPhotoV3({
      reservationId: prepared.quote.reservationId,
      quoteId: prepared.quote.quoteId,
      quoteRevision: prepared.quote.quoteRevision,
      explicitHumanConfirmation: true,
      duplicateChargeAcknowledged: false,
    });
    await runtime.jobs.waitForIdleV3();
    const failed = await runtime.store.loadProjectV3(created.summary.id);
    expect(failed.jobs[confirmed.jobId]).toMatchObject({
      status: 'needs_attention',
      providerSubmissionKind: 'complete',
      providerJobId: null,
      error: { code: 'submission_unknown' },
    });
    expect(failed.jobs[confirmed.jobId]!.spendReceipt).not.toBeNull();
    expect(failed.pieces[confirmed.pieceId]!.currentAssetId).toBeNull();
    expect(failed.spendAuthorizations).toHaveLength(1);
    expect(adapter.submit).toHaveBeenCalledOnce();

    await runtime.dispose();
    const restarted = createCreativeStudioPilotRuntimeV3(deps);
    runtimes.push(restarted);
    await restarted.startV3();
    await restarted.jobs.waitForIdleV3();
    const recovered = await restarted.store.loadProjectV3(created.summary.id);
    const recoveredJob = recovered.jobs[confirmed.jobId]!;
    expect(recoveredJob).toMatchObject({
      status: 'succeeded',
      providerSubmissionKind: 'complete',
      providerJobId: null,
      outputAssetId: recovered.pieces[confirmed.pieceId]!.currentAssetId,
    });
    expect(recoveredJob.spendReceipt).toEqual(failed.jobs[confirmed.jobId]!.spendReceipt);
    expect(recovered.spendAuthorizations).toEqual(failed.spendAuthorizations);
    expect(Object.keys(recovered.jobs)).toEqual([confirmed.jobId]);
    expect(Object.keys(recovered.assets)).toEqual([recoveredJob.outputAssetId]);
    expect(adapter.submit).toHaveBeenCalledOnce();
    expect(await readdir(path.join(rootDir, recovered.id, 'media-v3', '.parts'))).toEqual([]);
    expect(await readdir(path.join(rootDir, recovered.id, 'media-v3', '.intents'))).toEqual([]);
  });

  it('keeps a durable remote output claim ahead of cancellation across a Main restart', async () => {
    const sandbox = await mkdtemp(path.join(os.tmpdir(), 'studio-pilot-v3-cancel-output-fence-'));
    sandboxes.push(sandbox);
    const rootDir = path.join(sandbox, 'projects');
    const outputPath = path.join(sandbox, 'remote-output.png');
    const outputBytes = await makePng(outputPath);
    const provider: IProvider = {
      id: 'provider_remote_fence',
      platform: 'gemini',
      name: 'Remote fence provider',
      base_url: 'https://provider.invalid/v1',
      api_key: 'private-api-key',
      models: ['remote-fence-model'],
      enabled: true,
      model_enabled: { 'remote-fence-model': true },
      model_health: { 'remote-fence-model': { status: 'healthy' } },
    };
    const route: StudioGenerationRouteCatalog['routes'][number] = {
      choiceId: 'route_remote_fence',
      providerId: provider.id,
      providerName: provider.name,
      adapterId: 'weprompt-image-v1',
      model: 'remote-fence-model',
      health: 'available',
      kind: 'image',
      constraints: {
        aspectRatios: ['16:9'],
        resolutions: ['1080p'],
        minDurationSeconds: 1,
        maxDurationSeconds: 60,
        supportsFirstFrame: false,
        maxConditioningImages: 0,
        silentOutput: true,
      },
      cancellationPolicy: 'queued_and_running',
    };
    const output: ProviderOutput = {
      mediaKind: 'image',
      role: 'primary',
      source: { kind: 'file', path: outputPath },
      mimeType: 'image/png',
      byteSize: outputBytes.length,
      width: 40,
      height: 30,
    };
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
      submit: vi.fn(async () => ({ kind: 'remote' as const, providerJobId: 'provider_job_remote_fence' })),
      poll: vi.fn(async () => ({ status: 'succeeded' as const, outputs: [output] })),
      cancel: vi.fn(async () => ({ kind: 'cancelled' as const })),
    };
    let failFinalPublication = true;
    const deps: CreativeStudioPilotRuntimeDepsV3 = {
      rootDir,
      providerResolver: {
        listGenerationRoutes: async () => ({
          routes: [route],
          diagnostics: [],
          generationCatalogVersion: 'remote-fence-catalog',
        }),
      },
      adapters: new Map([['weprompt-image-v1', adapter]]),
      listProviders: async () => [provider],
      pickPhoto: async () => null,
      resolveGeneratedUrl: async () => {
        throw new Error('remote output is already a local provider file');
      },
      now: () => Date.parse('2026-08-31T11:45:00.000Z'),
      sleep: async () => undefined,
      onMediaStorageStep: (step) => {
        if (failFinalPublication && step === 'media:final_durable') {
          failFinalPublication = false;
          throw new Error('simulated process death');
        }
      },
    };
    const firstMain = createCreativeStudioPilotRuntimeV3(deps);
    runtimes.push(firstMain);
    await firstMain.startV3();
    const created = await firstMain.entryPoint.createProjectV3({
      name: 'Remote output fence',
      brief: 'One paid photograph survives cancellation.',
    });
    const prepared = await firstMain.entryPoint.preparePhotoV3({
      mode: 'create',
      projectId: created.summary.id,
      expectedAuthoringRevision: 1,
      words: 'A photograph that survives a cancellation race',
      settings: { aspectRatio: '16:9', resolution: '1080p' },
      suggestedHandle: null,
      referencePieceIds: [],
    });
    const confirmed = await firstMain.entryPoint.confirmPreparedPhotoV3({
      reservationId: prepared.quote.reservationId,
      quoteId: prepared.quote.quoteId,
      quoteRevision: prepared.quote.quoteRevision,
      explicitHumanConfirmation: true,
      duplicateChargeAcknowledged: false,
    });
    await firstMain.jobs.waitForIdleV3();

    const interrupted = await firstMain.store.loadProjectV3(created.summary.id);
    expect(interrupted.jobs[confirmed.jobId]).toMatchObject({
      status: 'needs_attention',
      providerSubmissionKind: 'remote',
      providerJobId: 'provider_job_remote_fence',
      spendReceipt: { jobId: confirmed.jobId },
      error: { code: 'poll_deadline' },
    });
    expect(await readdir(path.join(rootDir, interrupted.id, 'media-v3', '.intents'))).toHaveLength(1);
    await expect(
      firstMain.jobs.cancelJobV3({
        projectId: interrupted.id,
        pieceId: confirmed.pieceId,
        jobId: confirmed.jobId,
      })
    ).rejects.toMatchObject({ code: 'cancellation_refused' });
    expect(adapter.cancel).not.toHaveBeenCalled();

    await firstMain.dispose();
    const restarted = createCreativeStudioPilotRuntimeV3(deps);
    runtimes.push(restarted);
    await expect(
      restarted.jobs.cancelJobV3({
        projectId: interrupted.id,
        pieceId: confirmed.pieceId,
        jobId: confirmed.jobId,
      })
    ).rejects.toMatchObject({ code: 'cancellation_refused' });
    expect(adapter.cancel).not.toHaveBeenCalled();

    await restarted.startV3();
    await restarted.jobs.waitForIdleV3();
    const recovered = await restarted.store.loadProjectV3(interrupted.id);
    expect(recovered.jobs[confirmed.jobId]).toMatchObject({
      status: 'succeeded',
      providerJobId: 'provider_job_remote_fence',
      outputAssetId: recovered.pieces[confirmed.pieceId]!.currentAssetId,
      spendReceipt: { jobId: confirmed.jobId },
    });
    expect(adapter.submit).toHaveBeenCalledOnce();
    expect(adapter.cancel).not.toHaveBeenCalled();
    expect(await readdir(path.join(rootDir, recovered.id, 'media-v3', '.intents'))).toEqual([]);
  });

  it('generates, restarts, projects, and exports one URL-backed Piece without leaking Main paths', async () => {
    const sandbox = await mkdtemp(path.join(os.tmpdir(), 'studio-pilot-v3-runtime-'));
    sandboxes.push(sandbox);
    const rootDir = path.join(sandbox, 'projects');
    const privateProviderDirectory = path.join(sandbox, 'private-provider-cache');
    const privateProviderPath = path.join(privateProviderDirectory, 'generated-secret.png');
    const privateProviderUrl = 'https://provider.invalid/results/generated-secret.png?token=do-not-persist';
    await mkdir(privateProviderDirectory, { recursive: true });
    const sourceBytes = await makePng(privateProviderPath);

    const provider: IProvider = {
      id: 'provider_image',
      platform: 'gemini',
      name: 'Image provider',
      base_url: 'https://provider.invalid/v1',
      api_key: 'private-api-key',
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
        aspectRatios: ['16:9'],
        resolutions: ['1080p'],
        minDurationSeconds: 1,
        maxDurationSeconds: 60,
        supportsFirstFrame: false,
        maxConditioningImages: 0,
        silentOutput: true,
      },
      cancellationPolicy: 'queued_and_running',
    };
    const providerResolver = {
      listGenerationRoutes: vi.fn(
        async (): Promise<StudioGenerationRouteCatalog> => ({
          routes: [route],
          diagnostics: [],
          generationCatalogVersion: 'catalog_1',
        })
      ),
    };
    const output: ProviderOutput = {
      mediaKind: 'image',
      role: 'primary',
      source: { kind: 'url', url: privateProviderUrl },
      mimeType: 'image/png',
    };
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
      submit: vi.fn(async () => ({ kind: 'complete' as const, outputs: [output] })),
    };
    const listProviders = vi.fn(async () => [provider]);
    const pickPhoto = vi.fn(async () => null);
    const cleanupGeneratedUrl = vi.fn(async () => undefined);
    const resolveGeneratedUrl = vi.fn(async (url: string) => {
      if (url !== privateProviderUrl) throw new Error('unexpected provider URL');
      return { path: privateProviderPath, cleanup: cleanupGeneratedUrl };
    });
    const runtimeDeps = {
      rootDir,
      providerResolver,
      adapters: new Map([['weprompt-image-v1' as const, adapter]]),
      listProviders,
      pickPhoto,
      resolveGeneratedUrl,
      now: () => Date.parse('2026-08-31T12:00:00.000Z'),
      sleep: async () => undefined,
    };

    const runtime = createCreativeStudioPilotRuntimeV3(runtimeDeps);
    runtimes.push(runtime);
    await runtime.startV3();
    await expect(runtime.entryPoint.listProjectsV3()).resolves.toEqual({ entries: [] });

    const created = await runtime.entryPoint.createProjectV3({
      name: 'URL image Pilot',
      brief: 'A luminous aurora over still water.',
    });
    const prepared = await runtime.entryPoint.preparePhotoV3({
      mode: 'create',
      projectId: created.summary.id,
      expectedAuthoringRevision: 1,
      words: 'Aurora reflected in still water',
      settings: { aspectRatio: '16:9', resolution: '1080p' },
      suggestedHandle: null,
      referencePieceIds: [],
    });
    expect(prepared.quote).toMatchObject({
      requiresExplicitHumanAction: true,
      spendPolicyClassification: 'no_policy',
    });
    const confirmed = await runtime.entryPoint.confirmPreparedPhotoV3({
      reservationId: prepared.quote.reservationId,
      quoteId: prepared.quote.quoteId,
      quoteRevision: prepared.quote.quoteRevision,
      explicitHumanConfirmation: true,
      duplicateChargeAcknowledged: false,
    });
    await runtime.jobs.waitForIdleV3();

    const firstProjection = await runtime.entryPoint.loadProjectV3(created.summary.id);
    expect(firstProjection).toMatchObject({
      status: 'supported',
      summary: { pieceCount: 1, currentPieceCount: 1 },
      canvas: {
        pieces: [
          {
            id: confirmed.pieceId,
            state: 'current',
            currentAsset: {
              mediaKind: 'image',
              mimeType: 'image/png',
              width: 40,
              height: 30,
              provenance: {
                origin: 'generated',
                producerJobId: confirmed.jobId,
                model: 'image-model',
                recordedSpend: { currency: 'USD', totalMinorUnits: 3 },
              },
            },
          },
        ],
      },
      activity: {
        preparedPhotoQuotes: [],
        jobs: [{ jobId: confirmed.jobId, status: 'succeeded', recordedSpend: { totalMinorUnits: 3 } }],
      },
    });
    expect(adapter.submit).toHaveBeenCalledOnce();
    expect(resolveGeneratedUrl).toHaveBeenCalledOnce();
    expect(resolveGeneratedUrl).toHaveBeenCalledWith(privateProviderUrl, expect.any(AbortSignal));
    expect(cleanupGeneratedUrl).toHaveBeenCalledOnce();
    expect(pickPhoto).not.toHaveBeenCalled();

    const rendererPayload = JSON.stringify(firstProjection);
    const persistedBeforeRestart = await readFile(path.join(rootDir, created.summary.id, 'project.json'), 'utf8');
    for (const payload of [rendererPayload, persistedBeforeRestart]) {
      expect(payload).not.toContain(privateProviderUrl);
      expect(payload).not.toContain(privateProviderPath);
    }

    await runtime.dispose();
    await expect(runtime.entryPoint.loadProjectV3(created.summary.id)).rejects.toMatchObject({
      code: 'runtime_inactive',
    });

    const restarted = createCreativeStudioPilotRuntimeV3(runtimeDeps);
    runtimes.push(restarted);
    await restarted.startV3();
    const restartedProjection = await restarted.entryPoint.loadProjectV3(created.summary.id);
    expect(restartedProjection).toEqual(firstProjection);

    const projectBeforeExport = await restarted.store.loadProjectV3(created.summary.id);
    const exportCatalogBefore = await restarted.entryPoint.listPieceExportsV3(created.summary.id);
    expect({
      authorizationCount: projectBeforeExport.spendAuthorizations.length,
      jobIds: Object.keys(projectBeforeExport.jobs),
    }).toEqual({ authorizationCount: 1, jobIds: [confirmed.jobId] });
    const paidAuthorityBeforeExport = structuredClone({
      spendAuthorizations: projectBeforeExport.spendAuthorizations,
      jobs: projectBeforeExport.jobs,
    });
    const providerCallsBeforeExport = {
      routes: providerResolver.listGenerationRoutes.mock.calls.length,
      providers: listProviders.mock.calls.length,
      submits: adapter.submit.mock.calls.length,
      resolves: resolveGeneratedUrl.mock.calls.length,
    };
    if (restartedProjection.status !== 'supported') throw new Error('schema-6 project became unreadable');
    const exported = await restarted.entryPoint.exportPieceV3({
      projectId: created.summary.id,
      pieceId: confirmed.pieceId,
      expectedRevision: restartedProjection.canvas.revision,
      expectedCatalogRevision: exportCatalogBefore.revision,
    });
    const artifact = exported.catalog.artifacts[0]!;
    const exportedPhoto = await readFile(
      path.join(rootDir, created.summary.id, 'exports', artifact.folderName, 'photo.png')
    );
    const projectAfterExport = await restarted.store.loadProjectV3(created.summary.id);

    expect(exported).toMatchObject({
      status: 'exported',
      catalog: { revision: exportCatalogBefore.revision + 1 },
    });
    expect(exportedPhoto).toEqual(sourceBytes);
    expect({
      routes: providerResolver.listGenerationRoutes.mock.calls.length,
      providers: listProviders.mock.calls.length,
      submits: adapter.submit.mock.calls.length,
      resolves: resolveGeneratedUrl.mock.calls.length,
    }).toEqual(providerCallsBeforeExport);
    expect({
      spendAuthorizations: projectAfterExport.spendAuthorizations,
      jobs: projectAfterExport.jobs,
    }).toEqual(paidAuthorityBeforeExport);
  });
});
