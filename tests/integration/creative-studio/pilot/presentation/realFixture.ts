/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 * Shared public-runtime fixture builder for presentation and export assertions.
 */

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { IProvider } from '@/common/config/storage';
import type { StudioProjectV3 } from '@/common/types/project/creativeStudioTypes';
import type { GenerationProviderAdapter, ProviderOutput } from '@/process/services/creative-studio/adapters';
import type { StudioGenerationRouteCatalog } from '@/process/services/creative-studio/providerResolver';
import {
  createCreativeStudioPilotRuntimeV3,
  type CreativeStudioPilotRuntimeV3,
} from '@/process/services/creative-studio/service/pilot';
import sharp from 'sharp';
import { vi, type Mock } from 'vitest';

const BASE_TIME = Date.parse('2026-08-31T12:00:00.000Z');

export type PilotPhotoFixtureV3 = {
  rootDir: string;
  runtime: CreativeStudioPilotRuntimeV3;
  project: StudioProjectV3;
  pieceId: string;
  assetId: string | null;
  jobId: string | null;
  managedPhotoPath: string;
  sourceBytes: Buffer;
  submit: Mock;
  cleanup(): Promise<void>;
};

export type PilotPhotoFixtureOptionsV3 = {
  origin: 'generated' | 'imported';
  generatedOutcome?: 'succeeded' | 'failed';
  format?: 'jpeg' | 'png' | 'webp';
  fileName?: string;
  name?: string;
  brief?: string;
  words?: string;
  suggestedHandle?: string | null;
  aspectRatio?: '16:9' | '9:16' | '1:1' | '4:3' | '3:4';
};

const imageBytes = async (format: 'jpeg' | 'png' | 'webp'): Promise<Buffer> => {
  const image = sharp({
    create: { width: 32, height: 24, channels: 4, background: { r: 60, g: 40, b: 90, alpha: 1 } },
  });
  if (format === 'jpeg') return image.jpeg().toBuffer();
  if (format === 'webp') return image.webp().toBuffer();
  return image.png().toBuffer();
};

const route = (provider: IProvider): StudioGenerationRouteCatalog['routes'][number] => ({
  choiceId: 'route_image',
  providerId: provider.id,
  providerName: provider.name,
  adapterId: 'weprompt-image-v1',
  model: 'image-model-v1',
  health: 'available',
  kind: 'image',
  constraints: {
    aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4'],
    resolutions: ['720p', '1080p'],
    minDurationSeconds: 1,
    maxDurationSeconds: 60,
    supportsFirstFrame: false,
    maxConditioningImages: 0,
    silentOutput: true,
  },
  cancellationPolicy: 'queued_and_running',
});

/**
 * Builds durable schema-6 state exclusively through the isolated public Pilot entry point and its
 * native/provider boundaries. Tests may clone the returned project for a single explicit fault transform.
 */
export const createPilotPhotoFixtureV3 = async (options: PilotPhotoFixtureOptionsV3): Promise<PilotPhotoFixtureV3> => {
  const sandbox = await mkdtemp(path.join(os.tmpdir(), 'studio-pilot-real-fixture-'));
  const rootDir = path.join(sandbox, 'projects');
  const format = options.format ?? 'png';
  const extension = format === 'jpeg' ? 'jpg' : format;
  const sourcePath = path.join(sandbox, `native-photo.${extension}`);
  const sourceBytes = await imageBytes(format);
  await sharp(sourceBytes).toFile(sourcePath);

  const provider: IProvider = {
    id: 'provider_image',
    platform: 'gemini',
    name: 'Image provider',
    base_url: 'https://provider.invalid/v1',
    api_key: 'private-api-key',
    models: ['image-model-v1'],
    enabled: true,
    model_enabled: { 'image-model-v1': true },
    model_health: { 'image-model-v1': { status: 'healthy' } },
  };
  const output: ProviderOutput = {
    mediaKind: 'image',
    role: 'primary',
    source: { kind: 'url', url: 'https://provider.invalid/generated.png?secret=1' },
    mimeType: format === 'jpeg' ? 'image/jpeg' : `image/${format}`,
  };
  const submit = vi.fn(async () => {
    if (options.generatedOutcome === 'failed') {
      return { kind: 'remote' as const, providerJobId: 'provider_job_failed' };
    }
    return { kind: 'complete' as const, outputs: [output] };
  });
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
    submit,
    poll: vi.fn(async () => ({ status: 'failed' as const, error: { code: 'provider_unavailable' as const } })),
  };
  let milliseconds = BASE_TIME;
  const runtime = createCreativeStudioPilotRuntimeV3({
    rootDir,
    providerResolver: {
      listGenerationRoutes: async () => ({
        routes: [route(provider)],
        diagnostics: [],
        generationCatalogVersion: 'catalog_1',
      }),
    },
    adapters: new Map([['weprompt-image-v1', adapter]]),
    listProviders: async () => [provider],
    pickPhoto: async () => ({ path: sourcePath, fileName: options.fileName ?? `Native photo.${extension}` }),
    resolveGeneratedUrl: async () => ({ path: sourcePath, cleanup: async () => undefined }),
    now: () => milliseconds++,
    sleep: async () => undefined,
  });

  try {
    await runtime.startV3();
    const created = await runtime.entryPoint.createProjectV3({
      name: options.name ?? 'Real Pilot fixture',
      brief: options.brief ?? 'One quiet photograph.',
    });
    let pieceId: string;
    let jobId: string | null = null;
    if (options.origin === 'imported') {
      const imported = await runtime.entryPoint.importPhotoV3({
        projectId: created.summary.id,
        expectedAuthoringRevision: 1,
      });
      if (imported.status !== 'imported') throw new Error('real fixture import was cancelled');
      pieceId = imported.pieceId;
    } else {
      const prepared = await runtime.entryPoint.preparePhotoV3({
        mode: 'create',
        projectId: created.summary.id,
        expectedAuthoringRevision: 1,
        words: options.words ?? 'Moonlight reflected on calm water.',
        settings: { aspectRatio: options.aspectRatio ?? '16:9', resolution: '1080p' },
        suggestedHandle: options.suggestedHandle ?? null,
        referencePieceIds: [],
      });
      const confirmed = await runtime.entryPoint.confirmPreparedPhotoV3({
        reservationId: prepared.quote.reservationId,
        quoteId: prepared.quote.quoteId,
        quoteRevision: prepared.quote.quoteRevision,
        explicitHumanConfirmation: prepared.quote.requiresExplicitHumanAction,
        duplicateChargeAcknowledged: false,
      });
      pieceId = confirmed.pieceId;
      jobId = confirmed.jobId;
      await runtime.jobs.waitForIdleV3();
    }

    const project = await runtime.store.loadProjectV3(created.summary.id);
    const assetId = project.pieces[pieceId]?.currentAssetId ?? null;
    const managedPhotoPath =
      assetId === null
        ? sourcePath
        : (await runtime.media.verifyManagedAssetV3({ projectId: project.id, assetId })).absolutePath;
    return {
      rootDir,
      runtime,
      project,
      pieceId,
      assetId,
      jobId,
      managedPhotoPath,
      sourceBytes: await readFile(sourcePath),
      submit,
      async cleanup() {
        await runtime.dispose();
        await rm(sandbox, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await runtime.dispose();
    await rm(sandbox, { recursive: true, force: true });
    throw error;
  }
};
