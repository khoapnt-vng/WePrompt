/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment node
 */

import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { ProviderOutput } from '@/process/services/creative-studio/adapters/types';
import type { StudioGenerationRouteCatalog } from '@/process/services/creative-studio/providerResolver';
import { STUDIO_MAX_PIECES_V3 } from '@/common/types/project/creativeStudioTypes';
import {
  createStudioPilotConfirmPhotoServiceV3,
  createStudioPilotPreparePhotoServiceV3,
  type StudioPilotIdentityKindV3,
} from '@/process/services/creative-studio/service/pilot';
import {
  createStudioPilotMediaStoreV3,
  imageHasVariationGrid,
  type StudioPilotMediaStorageStepV3,
  type StudioPilotNativePhotoSelectionV3,
} from '@/process/services/creative-studio/service/pilot/runtime/media';
import type { StudioPilotGeneratedUrlResolutionV3 } from '@/process/services/creative-studio/service/pilot/runtime/generatedUrlResolver';
import { createStudioPieceSpendReceiptV3 } from '@/process/services/creative-studio/service/schema2/pricing';
import { StudioPreparedPhotoCacheV3 } from '@/process/services/creative-studio/service/schema2/pricing/preparedSubmissionCache';
import { createCreativeStudioPilotStoreV3 } from '@/process/services/creative-studio/store/pilotStore';
import sharp from 'sharp';
import { afterEach, describe, expect, it, vi } from 'vitest';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const temporaryRoot = async (): Promise<string> => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'studio-pilot-v3-media-'));
  roots.push(root);
  return root;
};

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

const writePng = async (file: string, color: { r: number; g: number; b: number } = { r: 20, g: 80, b: 140 }) => {
  await sharp({ create: { width: 40, height: 24, channels: 3, background: color } })
    .png()
    .toFile(file);
  return file;
};

const writeImage = async (file: string, format: 'jpeg' | 'webp'): Promise<string> => {
  const image = sharp({
    create: { width: 40, height: 24, channels: 3, background: { r: 40, g: 90, b: 150 } },
  });
  await (format === 'jpeg' ? image.jpeg() : image.webp()).toFile(file);
  return file;
};

const writeWidePatternPng = async (file: string): Promise<string> => {
  const width = 96;
  const height = 48;
  const bytes = Buffer.alloc(width * height * 3);
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      const band = Math.floor(column / 24);
      const localColumn = column % 24;
      const active =
        (band === 0 && row < 24) ||
        (band === 1 && row >= 24) ||
        (band === 2 && localColumn < 12) ||
        (band === 3 && localColumn >= 12);
      const value = active ? (row * 37 + column * 71 + row * column * 3) % 256 : 24 + band * 16;
      const offset = (row * width + column) * 3;
      bytes[offset] = value;
      bytes[offset + 1] = active ? (value * 3 + 41) % 256 : value;
      bytes[offset + 2] = active ? (value * 7 + 13) % 256 : value;
    }
  }
  await sharp(bytes, { raw: { width, height, channels: 3 } })
    .png()
    .toFile(file);
  return file;
};

const route = (): StudioGenerationRouteCatalog['routes'][number] => ({
  choiceId: 'route_image',
  providerId: 'provider_image',
  providerName: 'Image provider',
  adapterId: 'weprompt-image-v1',
  model: 'model_image',
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
  cancellationPolicy: 'queued_only',
});

const createClock = () => {
  let milliseconds = Date.parse('2026-08-31T09:00:00.000Z');
  return {
    nowIso: () => new Date(milliseconds++).toISOString(),
    nowMs: () => milliseconds,
    advance: (amount = 1_000) => {
      milliseconds += amount;
    },
  };
};

const storeOptions = (root: string, clock: ReturnType<typeof createClock>) => {
  let project = 0;
  let temporary = 0;
  return {
    rootDir: root,
    now: clock.nowIso,
    createProjectId: () => `project_${++project}`,
    createTemporaryId: () => `temporary_${String(++temporary).padStart(8, '0')}`,
  };
};

const createImportHarness = async (options: {
  pickPhoto: () => Promise<StudioPilotNativePhotoSelectionV3 | null>;
  onStorageStep?: (step: StudioPilotMediaStorageStepV3) => void;
  detectVariationGrid?: (filePath: string) => Promise<boolean>;
}) => {
  const root = await temporaryRoot();
  const clock = createClock();
  const store = createCreativeStudioPilotStoreV3(storeOptions(root, clock));
  const project = await store.createProjectV3({ name: 'Media Pilot', brief: 'One image.' });
  const preparedPhotos = new StudioPreparedPhotoCacheV3({ now: clock.nowMs });
  const identityCounters = new Map<string, number>();
  let mediaTemporary = 0;
  const media = createStudioPilotMediaStoreV3({
    store,
    pickPhoto: options.pickPhoto,
    now: clock.nowIso,
    mintIdentity: (kind) => {
      const next = (identityCounters.get(kind) ?? 0) + 1;
      identityCounters.set(kind, next);
      return `${kind}_${next}`;
    },
    createTemporaryId: () => `media_temp_${String(++mediaTemporary).padStart(8, '0')}`,
    detectVariationGrid: options.detectVariationGrid,
    onStorageStep: options.onStorageStep,
    reservedCreateHandles: (projectId, authoringRevision) =>
      preparedPhotos.reservedCreateHandles(projectId, authoringRevision),
  });
  return { root, clock, store, project, media, preparedPhotos };
};

const importDurablePieces = async (harness: Awaited<ReturnType<typeof createImportHarness>>, count: number) => {
  const project = await harness.store.loadProjectV3(harness.project.id);
  return harness.store.updateProjectV3(
    project.id,
    (draft) => {
      const next = structuredClone(draft);
      for (let index = 0; index < count; index += 1) {
        const suffix = String(index + 1).padStart(3, '0');
        const pieceId = `piece_seed_${suffix}`;
        const assetId = `asset_seed_${suffix}`;
        next.pieceOrder.push(pieceId);
        next.pieces[pieceId] = {
          id: pieceId,
          kind: 'photograph',
          handle: `seed_${suffix}`,
          priorHandles: [],
          currentAssetId: assetId,
          jobIds: [],
          createdAt: project.updatedAt,
          updatedAt: project.updatedAt,
        };
        next.assets[assetId] = {
          id: assetId,
          projectId: project.id,
          pieceId,
          mediaKind: 'image',
          mimeType: 'image/png',
          managedAsset: { collection: 'imports', fileName: `${assetId}.png` },
          byteSize: 1,
          sha256: 'd'.repeat(64),
          width: 1,
          height: 1,
          createdAt: project.updatedAt,
          origin: 'imported',
          producerJobId: null,
          compositionDigest: null,
        };
      }
      return next;
    },
    { kind: 'authoring', expectedRevision: project.revision }
  );
};

const createRunningGeneratedHarness = async (options: {
  outputFile: string;
  providerSubmissionKind?: 'complete' | 'remote';
  detectVariationGrid?: (filePath: string) => Promise<boolean>;
  onStorageStep?: (step: StudioPilotMediaStorageStepV3) => void;
  resolveGeneratedUrl?: (url: string, signal: AbortSignal | undefined) => Promise<StudioPilotGeneratedUrlResolutionV3>;
}) => {
  const root = await temporaryRoot();
  const clock = createClock();
  const store = createCreativeStudioPilotStoreV3(storeOptions(root, clock));
  const project = await store.createProjectV3({ name: 'Generated Pilot', brief: 'Rain on a quiet street.' });
  const preparedPhotos = new StudioPreparedPhotoCacheV3({ now: clock.nowMs });
  const providerResolver = {
    listGenerationRoutes: async (): Promise<StudioGenerationRouteCatalog> => ({
      routes: [route()],
      diagnostics: [],
      generationCatalogVersion: 'catalog_1',
    }),
  };
  let identity = 0;
  const mintIdentity = (kind: StudioPilotIdentityKindV3): string => `${kind}_${++identity}`;
  const prepare = createStudioPilotPreparePhotoServiceV3({
    store,
    preparedPhotos,
    providerResolver,
    now: clock.nowMs,
    mintIdentity,
  });
  const confirm = createStudioPilotConfirmPhotoServiceV3({
    store,
    preparedPhotos,
    providerResolver,
    now: clock.nowMs,
    dispatchCommittedJob: async () => undefined,
  });
  const prepared = await prepare.preparePhotoV3({
    mode: 'create',
    projectId: project.id,
    expectedAuthoringRevision: project.authoringRevision,
    words: 'rain on neon',
    settings: { aspectRatio: '16:9', resolution: '1080p' },
    suggestedHandle: null,
  });
  const confirmed = await confirm.confirmPreparedPhotoV3({
    reservationId: prepared.quote.reservationId,
    quoteId: prepared.quote.quoteId,
    quoteRevision: prepared.quote.quoteRevision,
    explicitHumanConfirmation: prepared.quote.requiresExplicitHumanAction,
    duplicateChargeAcknowledged: false,
  });
  clock.advance();
  const queued = await store.loadProjectV3(project.id);
  const authorization = queued.spendAuthorizations[0]!;
  const runningAt = clock.nowIso();
  const receipt = createStudioPieceSpendReceiptV3({
    reservationId: authorization.quote.reservationId,
    authorization,
    jobId: confirmed.jobId,
    recordedAt: runningAt,
  });
  const providerSubmissionKind = options.providerSubmissionKind ?? 'remote';
  const running = await store.updateProjectV3(
    project.id,
    (draft) => {
      const next = structuredClone(draft);
      const job = next.jobs[confirmed.jobId]!;
      job.status = providerSubmissionKind === 'complete' ? 'submitting' : 'running';
      job.providerSubmissionKind = providerSubmissionKind === 'complete' ? null : 'remote';
      job.providerJobId = providerSubmissionKind === 'complete' ? null : 'provider_job_1';
      job.remoteStartedAt = providerSubmissionKind === 'complete' ? null : runningAt;
      job.progress = providerSubmissionKind === 'complete' ? null : 50;
      job.spendReceipt = providerSubmissionKind === 'complete' ? null : receipt;
      job.updatedAt = runningAt;
      return next;
    },
    { kind: 'runtime', expectedRevision: queued.revision }
  );
  const mediaIdentity = new Map<string, number>();
  let mediaTemporary = 0;
  const media = createStudioPilotMediaStoreV3({
    store,
    pickPhoto: async () => null,
    now: clock.nowIso,
    mintIdentity: (kind) => {
      const next = (mediaIdentity.get(kind) ?? 0) + 1;
      mediaIdentity.set(kind, next);
      return `${kind}_generated_${next}`;
    },
    createTemporaryId: () => `generated_temp_${String(++mediaTemporary).padStart(8, '0')}`,
    detectVariationGrid: options.detectVariationGrid,
    onStorageStep: options.onStorageStep,
    resolveGeneratedUrl: options.resolveGeneratedUrl,
  });
  const outputBytes = await readFile(options.outputFile);
  const outputMetadata = await sharp(options.outputFile).metadata();
  if (outputMetadata.width === undefined || outputMetadata.height === undefined)
    throw new Error('missing image dimensions');
  return {
    root,
    clock,
    store,
    media,
    project: running,
    pieceId: confirmed.pieceId,
    jobId: confirmed.jobId,
    receipt,
    output: {
      mediaKind: 'image' as const,
      role: 'primary' as const,
      source: { kind: 'file' as const, path: options.outputFile },
      mimeType: 'image/png' as const,
      byteSize: outputBytes.length,
      width: outputMetadata.width,
      height: outputMetadata.height,
    },
  };
};

const expectPilotError = async (promise: Promise<unknown>, code: string): Promise<void> => {
  await expect(promise).rejects.toMatchObject({ name: 'CreativeStudioPilotServiceErrorV3', code });
};

describe('schema-6 managed photo transactions', () => {
  it('detects a deterministic four-panel image through the real variation-grid heuristic', () => {
    const width = 16;
    const height = 16;
    const data = Uint8Array.from({ length: width * height * 3 }, (_value, offset) => {
      const column = Math.floor(offset / 3) % width;
      return Math.floor(column / 4) % 2 === 0 ? 0 : 255;
    });

    expect(imageHasVariationGrid({ data, width, height, channels: 3 })).toBe(true);
  });

  it('does not label one continuous image as a variation grid', () => {
    const width = 16;
    const height = 16;
    const data = Uint8Array.from({ length: width * height * 3 }, (_value, offset) => {
      const pixel = Math.floor(offset / 3);
      return (pixel + (offset % 3) * 17) % 256;
    });

    expect(imageHasVariationGrid({ data, width, height, channels: 3 })).toBe(false);
  });

  it('imports a verified image with a Unicode handle and persists no source path', async () => {
    const sourceRoot = await temporaryRoot();
    const source = await writePng(path.join(sourceRoot, 'private-source.png'));
    const harness = await createImportHarness({
      pickPhoto: async () => ({ path: source, fileName: 'Ảnh phố.png' }),
    });

    const result = await harness.media.importPhotoV3({
      projectId: harness.project.id,
      expectedAuthoringRevision: harness.project.authoringRevision,
    });
    expect(result).toMatchObject({ status: 'imported', pieceId: 'piece_1', assetId: 'asset_1' });
    if (result.status !== 'imported') throw new Error('expected import');
    const project = await harness.store.loadProjectV3(harness.project.id);
    expect(project.pieces[result.pieceId]).toMatchObject({
      kind: 'photograph',
      handle: 'ảnh_phố',
      currentAssetId: result.assetId,
      jobIds: [],
    });
    expect(project.assets[result.assetId]).toMatchObject({
      origin: 'imported',
      mimeType: 'image/png',
      width: 40,
      height: 24,
      managedAsset: { collection: 'imports', fileName: 'asset_1.png' },
    });
    expect(JSON.stringify(project)).not.toContain(source);
    expect(await readFile(path.join(harness.root, project.id, 'project.json'), 'utf8')).not.toContain(source);
    const verified = await harness.media.verifyManagedAssetV3({ projectId: project.id, assetId: result.assetId });
    expect(verified.asset.sha256).toBe(sha256(await readFile(source)));
    expect(verified.absolutePath).toBe(
      await realpath(path.join(harness.root, project.id, 'media-v3', 'imports', 'asset_1.png'))
    );
    expect(await readdir(path.join(harness.root, project.id, 'media-v3', '.parts'))).toEqual([]);
    expect(await readdir(path.join(harness.root, project.id, 'media-v3', '.intents'))).toEqual([]);
  });

  it.each([
    {
      format: 'jpeg' as const,
      extension: 'jpg',
      mimeType: 'image/jpeg',
      fileName: 'عکس‌های تهران.jpg',
      handle: 'عکس‌های_تهران',
    },
    {
      format: 'webp' as const,
      extension: 'webp',
      mimeType: 'image/webp',
      fileName: '東京 写真.webp',
      handle: '東京_写真',
    },
  ])('imports a verified $format image and preserves the Unicode/RTL handle', async (sample) => {
    const sourceRoot = await temporaryRoot();
    const source = await writeImage(path.join(sourceRoot, `source.${sample.extension}`), sample.format);
    const harness = await createImportHarness({ pickPhoto: async () => ({ path: source, fileName: sample.fileName }) });

    const result = await harness.media.importPhotoV3({
      projectId: harness.project.id,
      expectedAuthoringRevision: harness.project.authoringRevision,
    });
    expect(result.status).toBe('imported');
    if (result.status !== 'imported') throw new Error('expected import');
    const project = await harness.store.loadProjectV3(harness.project.id);
    expect(project.pieces[result.pieceId]!.handle).toBe(sample.handle);
    expect(project.assets[result.assetId]).toMatchObject({
      mimeType: sample.mimeType,
      managedAsset: { collection: 'imports', fileName: `asset_1.${sample.extension}` },
    });
  });

  it('cancels without creating media storage or changing the project', async () => {
    const picker = vi.fn(async () => null);
    const harness = await createImportHarness({ pickPhoto: picker });
    const projectDirectory = path.join(harness.root, harness.project.id);
    const before = await readdir(projectDirectory);

    await expect(
      harness.media.importPhotoV3({
        projectId: harness.project.id,
        expectedAuthoringRevision: harness.project.authoringRevision,
      })
    ).resolves.toEqual({ status: 'cancelled' });
    expect(picker).toHaveBeenCalledOnce();
    expect(await readdir(projectDirectory)).toEqual(before);
    expect(await harness.store.loadProjectV3(harness.project.id)).toEqual(harness.project);
  });

  it('refuses an authoring change made while the native picker is open', async () => {
    const sourceRoot = await temporaryRoot();
    const source = await writePng(path.join(sourceRoot, 'stale-picker.png'));
    let resolvePicker: ((selection: StudioPilotNativePhotoSelectionV3) => void) | undefined;
    const harness = await createImportHarness({
      pickPhoto: () =>
        new Promise((resolve) => {
          resolvePicker = resolve;
        }),
    });
    const pending = harness.media.importPhotoV3({
      projectId: harness.project.id,
      expectedAuthoringRevision: harness.project.authoringRevision,
    });
    await expect.poll(() => resolvePicker !== undefined).toBe(true);
    const changed = await harness.store.updateProjectV3(
      harness.project.id,
      (draft) => ({ ...draft, name: 'Changed while choosing' }),
      { kind: 'authoring', expectedRevision: harness.project.revision }
    );
    resolvePicker!({ path: source, fileName: 'Stale picker.png' });

    await expectPilotError(pending, 'stale_authoring');
    const project = await harness.store.loadProjectV3(harness.project.id);
    expect(project).toEqual(changed);
    expect(project.pieceOrder).toEqual([]);
    expect(Object.keys(project.assets)).toEqual([]);
  });

  it('rejects invalid bytes without a Piece, asset, or managed file', async () => {
    const sourceRoot = await temporaryRoot();
    const source = path.join(sourceRoot, 'not-an-image.png');
    await writeFile(source, 'not an image', 'utf8');
    const harness = await createImportHarness({
      pickPhoto: async () => ({ path: source, fileName: 'not-an-image.png' }),
    });

    await expectPilotError(
      harness.media.importPhotoV3({
        projectId: harness.project.id,
        expectedAuthoringRevision: harness.project.authoringRevision,
      }),
      'invalid_media'
    );
    const project = await harness.store.loadProjectV3(harness.project.id);
    expect(project.pieceOrder).toEqual([]);
    expect(project.assets).toEqual({});
    expect(await readdir(path.join(harness.root, project.id, 'media-v3', '.parts'))).toEqual([]);
  });

  it('assigns deterministic suffixes to sequential same-name imports under exact authoring authority', async () => {
    const sourceRoot = await temporaryRoot();
    const first = await writePng(path.join(sourceRoot, 'first.png'), { r: 100, g: 20, b: 20 });
    const second = await writePng(path.join(sourceRoot, 'second.png'), { r: 20, g: 100, b: 20 });
    const selections: StudioPilotNativePhotoSelectionV3[] = [
      { path: first, fileName: 'Same name.png' },
      { path: second, fileName: 'Same name.png' },
    ];
    const pickPhoto = async (): Promise<StudioPilotNativePhotoSelectionV3> => selections.shift()!;
    const harness = await createImportHarness({ pickPhoto });
    const firstRequest = {
      projectId: harness.project.id,
      expectedAuthoringRevision: harness.project.authoringRevision,
    };
    await expect(harness.media.importPhotoV3(firstRequest)).resolves.toMatchObject({ status: 'imported' });
    const afterFirst = await harness.store.loadProjectV3(harness.project.id);
    await expect(
      harness.media.importPhotoV3({
        projectId: harness.project.id,
        expectedAuthoringRevision: afterFirst.authoringRevision,
      })
    ).resolves.toMatchObject({ status: 'imported' });
    const project = await harness.store.loadProjectV3(harness.project.id);
    expect(project.pieceOrder.map((pieceId) => project.pieces[pieceId]!.handle)).toEqual(['same_name', 'same_name_2']);
    expect(Object.keys(project.assets)).toHaveLength(2);
    expect(project.authoringRevision).toBe(harness.project.authoringRevision + 2);
  });

  it('enforces the shared 96-Piece/asset ceiling under the project authority queue', async () => {
    const sourceRoot = await temporaryRoot();
    const seed = await writePng(path.join(sourceRoot, 'capacity-seed.png'));
    const first = await writePng(path.join(sourceRoot, 'capacity-first.png'), { r: 70, g: 30, b: 120 });
    const second = await writePng(path.join(sourceRoot, 'capacity-second.png'), { r: 110, g: 50, b: 30 });
    let seeding = true;
    let seedIndex = 0;
    const waiters: Array<(selection: StudioPilotNativePhotoSelectionV3) => void> = [];
    const harness = await createImportHarness({
      pickPhoto: () => {
        if (seeding) {
          seedIndex += 1;
          return Promise.resolve({ path: seed, fileName: `Capacity seed ${seedIndex}.png` });
        }
        return new Promise((resolve) => {
          waiters.push(resolve);
          if (waiters.length === 2) {
            waiters[0]!({ path: first, fileName: 'Capacity.png' });
            waiters[1]!({ path: second, fileName: 'Capacity.png' });
          }
        });
      },
    });
    const seeded = await importDurablePieces(harness, STUDIO_MAX_PIECES_V3 - 1);
    seeding = false;
    const request = { projectId: seeded.id, expectedAuthoringRevision: seeded.authoringRevision };

    const outcomes = await Promise.allSettled([
      harness.media.importPhotoV3(request),
      harness.media.importPhotoV3(request),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(1);
    const refusal = outcomes.find((outcome) => outcome.status === 'rejected');
    expect(refusal).toMatchObject({
      status: 'rejected',
      reason: { name: 'CreativeStudioPilotServiceErrorV3', code: 'project_piece_capacity_reached' },
    });
    const project = await harness.store.loadProjectV3(seeded.id);
    expect(project.pieceOrder).toHaveLength(STUDIO_MAX_PIECES_V3);
    expect(Object.keys(project.assets)).toHaveLength(STUDIO_MAX_PIECES_V3);
  });

  it('leases one final slot against an in-flight import while ignoring stale reservation capacity', async () => {
    const sourceRoot = await temporaryRoot();
    const seed = await writePng(path.join(sourceRoot, 'mixed-capacity-seed.png'));
    const advance = await writePng(path.join(sourceRoot, 'mixed-capacity-advance.png'), { r: 40, g: 120, b: 60 });
    const blocked = await writePng(path.join(sourceRoot, 'mixed-capacity-blocked.png'), { r: 130, g: 45, b: 20 });
    let pickerMode: 'seed' | 'advance' | 'blocked' = 'seed';
    let seedIndex = 0;
    let resolvePicker: ((selection: StudioPilotNativePhotoSelectionV3) => void) | undefined;
    const harness = await createImportHarness({
      pickPhoto: () => {
        if (pickerMode === 'seed') {
          seedIndex += 1;
          return Promise.resolve({ path: seed, fileName: `Mixed seed ${seedIndex}.png` });
        }
        if (pickerMode === 'advance') {
          return Promise.resolve({ path: advance, fileName: 'Authoring advance.png' });
        }
        return new Promise((resolve) => {
          resolvePicker = resolve;
        });
      },
    });
    const seeded = await importDurablePieces(harness, STUDIO_MAX_PIECES_V3 - 2);
    const providerResolver = {
      listGenerationRoutes: async (): Promise<StudioGenerationRouteCatalog> => ({
        routes: [route()],
        diagnostics: [],
        generationCatalogVersion: 'catalog_1',
      }),
    };
    let identity = 0;
    const prepare = createStudioPilotPreparePhotoServiceV3({
      store: harness.store,
      preparedPhotos: harness.preparedPhotos,
      providerResolver,
      now: harness.clock.nowMs,
      mintIdentity: (kind) => `${kind}_mixed_${++identity}`,
    });
    const dispatch = vi.fn(async () => undefined);
    const confirm = createStudioPilotConfirmPhotoServiceV3({
      store: harness.store,
      preparedPhotos: harness.preparedPhotos,
      providerResolver,
      now: harness.clock.nowMs,
      dispatchCommittedJob: dispatch,
    });
    const staleReservation = await prepare.preparePhotoV3({
      mode: 'create',
      projectId: seeded.id,
      expectedAuthoringRevision: seeded.authoringRevision,
      words: 'A reservation that will become stale',
      settings: { aspectRatio: '16:9', resolution: '1080p' },
      suggestedHandle: 'stale_capacity_lease',
    });
    pickerMode = 'advance';
    const advanced = await harness.media.importPhotoV3({
      projectId: seeded.id,
      expectedAuthoringRevision: seeded.authoringRevision,
    });
    if (advanced.status !== 'imported') throw new Error('authoring advance import was cancelled');
    const atBoundary = await harness.store.loadProjectV3(seeded.id);
    expect(atBoundary.pieceOrder).toHaveLength(STUDIO_MAX_PIECES_V3 - 1);
    expect(harness.preparedPhotos.list(seeded.id)).toEqual([
      expect.objectContaining({ reservationId: staleReservation.quote.reservationId }),
    ]);

    pickerMode = 'blocked';
    const importFlight = harness.media.importPhotoV3({
      projectId: atBoundary.id,
      expectedAuthoringRevision: atBoundary.authoringRevision,
    });
    await expect.poll(() => resolvePicker !== undefined).toBe(true);
    const currentReservation = await prepare.preparePhotoV3({
      mode: 'create',
      projectId: atBoundary.id,
      expectedAuthoringRevision: atBoundary.authoringRevision,
      words: 'The generated final slot',
      settings: { aspectRatio: '16:9', resolution: '1080p' },
      suggestedHandle: 'current_capacity_lease',
    });
    resolvePicker!({ path: blocked, fileName: 'Imported final slot.png' });

    await expect(importFlight).rejects.toMatchObject({ code: 'project_piece_capacity_reached' });
    const confirmed = await confirm.confirmPreparedPhotoV3({
      reservationId: currentReservation.quote.reservationId,
      quoteId: currentReservation.quote.quoteId,
      quoteRevision: currentReservation.quote.quoteRevision,
      explicitHumanConfirmation: currentReservation.quote.requiresExplicitHumanAction,
      duplicateChargeAcknowledged: currentReservation.quote.duplicateChargeAcknowledgementRequired,
    });
    expect(confirmed.status).toBe('queued');
    const project = await harness.store.loadProjectV3(atBoundary.id);
    expect(project.pieceOrder).toHaveLength(STUDIO_MAX_PIECES_V3);
    expect(project.spendAuthorizations).toHaveLength(1);
    expect(Object.keys(project.jobs)).toHaveLength(1);
    expect(dispatch).toHaveBeenCalledOnce();
    // The stale lease is ignored while admitting the current quote, then removed once that
    // quote's create commit advances authoring authority.
    expect(harness.preparedPhotos.list(project.id)).toEqual([]);
    await expect(
      prepare.preparePhotoV3({
        mode: 'create',
        projectId: project.id,
        expectedAuthoringRevision: project.authoringRevision,
        words: 'Impossible ninety-seventh Piece',
        settings: { aspectRatio: '16:9', resolution: '1080p' },
        suggestedHandle: null,
      })
    ).rejects.toMatchObject({ code: 'project_piece_capacity_reached' });
    expect(harness.preparedPhotos.list(project.id)).toHaveLength(0);
  });

  it.each<StudioPilotMediaStorageStepV3>([
    'media:stage_durable',
    'media:intent_durable',
    'media:final_durable',
    'media:project_committed',
  ])('recovers import state deterministically after %s', async (failureStep) => {
    const sourceRoot = await temporaryRoot();
    const source = await writePng(path.join(sourceRoot, `${failureStep.replaceAll(':', '-')}.png`));
    const harness = await createImportHarness({
      pickPhoto: async () => ({ path: source, fileName: 'Recovery.png' }),
      onStorageStep: (step) => {
        if (step === failureStep) throw new Error('simulated process death');
      },
    });

    await expectPilotError(
      harness.media.importPhotoV3({
        projectId: harness.project.id,
        expectedAuthoringRevision: harness.project.authoringRevision,
      }),
      'storage_error'
    );
    const restartedStore = createCreativeStudioPilotStoreV3(storeOptions(harness.root, harness.clock));
    const restartedMedia = createStudioPilotMediaStoreV3({
      store: restartedStore,
      pickPhoto: async () => null,
      now: harness.clock.nowIso,
      createTemporaryId: (() => {
        let temporary = 0;
        return () => `restart_temp_${String(++temporary).padStart(8, '0')}`;
      })(),
    });
    await restartedMedia.recoverProjectMediaV3(harness.project.id);
    const project = await restartedStore.loadProjectV3(harness.project.id);
    const committed = failureStep === 'media:project_committed';
    expect(project.pieceOrder).toHaveLength(committed ? 1 : 0);
    expect(Object.keys(project.assets)).toHaveLength(committed ? 1 : 0);
    const mediaRoot = path.join(harness.root, project.id, 'media-v3');
    expect(await readdir(path.join(mediaRoot, '.parts'))).toEqual([]);
    expect(await readdir(path.join(mediaRoot, '.intents'))).toEqual([]);
    expect(await readdir(path.join(mediaRoot, 'imports'))).toHaveLength(committed ? 1 : 0);
  });

  it('recovers malformed control records and orphan stages without blocking healthy projects', async () => {
    const sourceRoot = await temporaryRoot();
    const source = await writePng(path.join(sourceRoot, 'healthy.png'));
    const harness = await createImportHarness({
      pickPhoto: async () => ({ path: source, fileName: 'Healthy.png' }),
    });
    await harness.media.importPhotoV3({
      projectId: harness.project.id,
      expectedAuthoringRevision: harness.project.authoringRevision,
    });
    const mediaRoot = path.join(harness.root, harness.project.id, 'media-v3');
    const intents = path.join(mediaRoot, '.intents');
    const parts = path.join(mediaRoot, '.parts');
    await writeFile(path.join(intents, '.intent-abandoned.tmp'), '{}', 'utf8');
    await writeFile(path.join(intents, 'broken.json'), '{', 'utf8');
    await writeFile(path.join(intents, 'binary.json'), Buffer.from([0xff]));
    await writeFile(path.join(parts, 'orphan_temp_00000001.part'), 'orphan', 'utf8');

    await harness.media.recoverAllMediaV3();
    expect((await readdir(intents)).filter((name) => name.startsWith('.invalid-'))).toHaveLength(2);
    expect(await readdir(parts)).toEqual([]);
    await expectPilotError(harness.media.recoverProjectMediaV3('bad/project'), 'invalid_payload');
    expect((await harness.store.loadProjectV3(harness.project.id)).pieceOrder).toHaveLength(1);
  });

  it('rejects the previous media-intent protocol version without defaulting its missing provider identity', async () => {
    const sourceRoot = await temporaryRoot();
    const source = await writePng(path.join(sourceRoot, 'old-intent.png'));
    const harness = await createRunningGeneratedHarness({
      outputFile: source,
      onStorageStep: (step) => {
        if (step === 'media:intent_durable') throw new Error('simulated process death');
      },
    });
    await expectPilotError(
      harness.media.publishGeneratedOutputV3({
        projectId: harness.project.id,
        pieceId: harness.pieceId,
        jobId: harness.jobId,
        providerSubmissionKind: 'remote',
        providerJobId: 'provider_job_1',
        outputs: [harness.output],
      }),
      'storage_error'
    );
    const mediaRoot = path.join(harness.root, harness.project.id, 'media-v3');
    const intents = path.join(mediaRoot, '.intents');
    const [intentName] = await readdir(intents);
    const intentPath = path.join(intents, intentName!);
    const oldIntent = JSON.parse(await readFile(intentPath, 'utf8')) as Record<string, unknown>;
    oldIntent.schemaVersion = 2;
    delete oldIntent.providerJobId;
    await writeFile(intentPath, JSON.stringify(oldIntent), 'utf8');
    const beforeRecovery = await harness.store.loadProjectV3(harness.project.id);

    const restartedStore = createCreativeStudioPilotStoreV3(storeOptions(harness.root, harness.clock));
    const restartedMedia = createStudioPilotMediaStoreV3({
      store: restartedStore,
      pickPhoto: async () => null,
      now: harness.clock.nowIso,
    });
    await restartedMedia.recoverProjectMediaV3(harness.project.id);

    expect(await restartedStore.loadProjectV3(harness.project.id)).toEqual(beforeRecovery);
    expect((await readdir(intents)).filter((name) => name.startsWith('.invalid-'))).toHaveLength(1);
    expect(await readdir(path.join(mediaRoot, '.parts'))).toEqual([]);
  });

  it('finds an exact durable generated-output claim despite mutable Job status and provider drift', async () => {
    const sourceRoot = await temporaryRoot();
    const source = await writePng(path.join(sourceRoot, 'durable-output-claim.png'));
    const harness = await createRunningGeneratedHarness({
      outputFile: source,
      onStorageStep: (step) => {
        if (step === 'media:final_durable') throw new Error('simulated process death');
      },
    });
    await expectPilotError(
      harness.media.publishGeneratedOutputV3({
        projectId: harness.project.id,
        pieceId: harness.pieceId,
        jobId: harness.jobId,
        providerSubmissionKind: 'remote',
        providerJobId: 'provider_job_1',
        outputs: [harness.output],
      }),
      'storage_error'
    );
    const interrupted = await harness.store.loadProjectV3(harness.project.id);
    await harness.store.updateProjectV3(
      interrupted.id,
      (draft) => {
        const next = structuredClone(draft);
        const job = next.jobs[harness.jobId]!;
        job.status = 'needs_attention';
        job.providerJobId = 'provider_job_drifted';
        job.progress = null;
        job.error = {
          code: 'poll_deadline',
          messageKey: 'conversation.creativeStudio.jobs.errors.pollDeadline',
        };
        job.updatedAt = harness.clock.nowIso();
        return next;
      },
      { kind: 'runtime', expectedRevision: interrupted.revision }
    );

    const disposition = await harness.store.withProjectAuthorityV3(harness.project.id, (authority) =>
      harness.media.inspectGeneratedOutputClaimUnderAuthorityV3({
        authority,
        pieceId: harness.pieceId,
        jobId: harness.jobId,
      })
    );

    expect(disposition).toBe('claimed');
  });

  it('reports clear when the media root or intent directory does not exist', async () => {
    const harness = await createImportHarness({ pickPhoto: async () => null });
    const inspect = () =>
      harness.store.withProjectAuthorityV3(harness.project.id, (authority) =>
        harness.media.inspectGeneratedOutputClaimUnderAuthorityV3({
          authority,
          pieceId: 'piece_missing',
          jobId: 'job_missing',
        })
      );

    await expect(inspect()).resolves.toBe('clear');
    await mkdir(path.join(harness.root, harness.project.id, 'media-v3'));
    await expect(inspect()).resolves.toBe('clear');
  });

  it('does not claim imported or unrelated generated intents', async () => {
    const sourceRoot = await temporaryRoot();
    const importedSource = await writePng(path.join(sourceRoot, 'imported-residue.png'));
    const imported = await createImportHarness({
      pickPhoto: async () => ({ path: importedSource, fileName: 'Imported residue.png' }),
      onStorageStep: (step) => {
        if (step === 'media:intent_durable') throw new Error('simulated process death');
      },
    });
    await expectPilotError(
      imported.media.importPhotoV3({
        projectId: imported.project.id,
        expectedAuthoringRevision: imported.project.authoringRevision,
      }),
      'storage_error'
    );
    const importedDisposition = await imported.store.withProjectAuthorityV3(imported.project.id, (authority) =>
      imported.media.inspectGeneratedOutputClaimUnderAuthorityV3({
        authority,
        pieceId: 'piece_1',
        jobId: 'job_missing',
      })
    );

    const generatedSource = await writePng(path.join(sourceRoot, 'unrelated-generated-residue.png'));
    const generated = await createRunningGeneratedHarness({
      outputFile: generatedSource,
      onStorageStep: (step) => {
        if (step === 'media:final_durable') throw new Error('simulated process death');
      },
    });
    await expectPilotError(
      generated.media.publishGeneratedOutputV3({
        projectId: generated.project.id,
        pieceId: generated.pieceId,
        jobId: generated.jobId,
        providerSubmissionKind: 'remote',
        providerJobId: 'provider_job_1',
        outputs: [generated.output],
      }),
      'storage_error'
    );
    const generatedDisposition = await generated.store.withProjectAuthorityV3(generated.project.id, (authority) =>
      generated.media.inspectGeneratedOutputClaimUnderAuthorityV3({
        authority,
        pieceId: generated.pieceId,
        jobId: 'job_unrelated',
      })
    );

    expect(importedDisposition).toBe('clear');
    expect(generatedDisposition).toBe('clear');
  });

  it('fails closed on malformed and unsafe intent control records', async () => {
    const harness = await createImportHarness({ pickPhoto: async () => null });
    const intentsDirectory = path.join(harness.root, harness.project.id, 'media-v3', '.intents');
    await mkdir(intentsDirectory, { recursive: true });
    const inspect = () =>
      harness.store.withProjectAuthorityV3(harness.project.id, (authority) =>
        harness.media.inspectGeneratedOutputClaimUnderAuthorityV3({
          authority,
          pieceId: 'piece_missing',
          jobId: 'job_missing',
        })
      );

    const malformedPath = path.join(intentsDirectory, 'malformed.json');
    await writeFile(malformedPath, '{', 'utf8');
    await expectPilotError(inspect(), 'storage_error');
    await rm(malformedPath);

    const outsideIntent = path.join(harness.root, 'outside-intent.json');
    await writeFile(outsideIntent, '{}', 'utf8');
    await symlink(outsideIntent, path.join(intentsDirectory, 'unsafe.json'));
    await expectPilotError(inspect(), 'storage_error');
  });

  it('publishes one exact generated output and preserves the pre-recorded spend receipt', async () => {
    const sourceRoot = await temporaryRoot();
    const source = await writePng(path.join(sourceRoot, 'generated.png'));
    const harness = await createRunningGeneratedHarness({ outputFile: source });

    const result = await harness.media.publishGeneratedOutputV3({
      projectId: harness.project.id,
      pieceId: harness.pieceId,
      jobId: harness.jobId,
      providerSubmissionKind: 'remote',
      providerJobId: 'provider_job_1',
      outputs: [harness.output],
    });
    const project = await harness.store.loadProjectV3(harness.project.id);
    expect(result).toMatchObject({ status: 'published', assetId: 'asset_generated_1' });
    expect(project.authoringRevision).toBe(harness.project.authoringRevision);
    expect(project.pieces[harness.pieceId]).toMatchObject({ currentAssetId: result.assetId });
    expect(project.jobs[harness.jobId]).toMatchObject({
      status: 'succeeded',
      outputAssetId: result.assetId,
      progress: 100,
      spendReceipt: harness.receipt,
    });
    expect(project.assets[result.assetId]).toMatchObject({
      origin: 'generated',
      producerJobId: harness.jobId,
      managedAsset: { collection: 'assets', fileName: 'asset_generated_1.png' },
    });
    const verified = await harness.media.verifyManagedAssetV3({ projectId: project.id, assetId: result.assetId });
    expect(verified.asset.sha256).toBe(sha256(await readFile(source)));
  });

  it('runs the built-in variation-grid detector on a wide non-grid image', async () => {
    const sourceRoot = await temporaryRoot();
    const source = await writeWidePatternPng(path.join(sourceRoot, 'wide-pattern.png'));
    const harness = await createRunningGeneratedHarness({ outputFile: source });

    const result = await harness.media.publishGeneratedOutputV3({
      projectId: harness.project.id,
      pieceId: harness.pieceId,
      jobId: harness.jobId,
      providerSubmissionKind: 'remote',
      providerJobId: 'provider_job_1',
      outputs: [harness.output],
    });
    expect(result.status).toBe('published');
    expect((await harness.store.loadProjectV3(harness.project.id)).assets[result.assetId]).toMatchObject({
      width: 96,
      height: 48,
    });
  });

  it.each<StudioPilotMediaStorageStepV3>([
    'media:stage_durable',
    'media:intent_durable',
    'media:final_durable',
    'media:project_committed',
  ])('recovers generated publication deterministically after %s', async (failureStep) => {
    const sourceRoot = await temporaryRoot();
    const source = await writePng(path.join(sourceRoot, `generated-${failureStep.replaceAll(':', '-')}.png`));
    const harness = await createRunningGeneratedHarness({
      outputFile: source,
      onStorageStep: (step) => {
        if (step === failureStep) throw new Error('simulated process death');
      },
    });

    await expectPilotError(
      harness.media.publishGeneratedOutputV3({
        projectId: harness.project.id,
        pieceId: harness.pieceId,
        jobId: harness.jobId,
        providerSubmissionKind: 'remote',
        providerJobId: 'provider_job_1',
        outputs: [harness.output],
      }),
      'storage_error'
    );
    const restartedStore = createCreativeStudioPilotStoreV3(storeOptions(harness.root, harness.clock));
    const restartedMedia = createStudioPilotMediaStoreV3({
      store: restartedStore,
      pickPhoto: async () => null,
      now: harness.clock.nowIso,
    });
    await restartedMedia.recoverProjectMediaV3(harness.project.id);
    const project = await restartedStore.loadProjectV3(harness.project.id);
    expect(project.pieces[harness.pieceId]!.currentAssetId).not.toBeNull();
    expect(project.jobs[harness.jobId]!.status).toBe('succeeded');
    expect(project.jobs[harness.jobId]!.spendReceipt).toEqual(harness.receipt);
    expect(project.jobs[harness.jobId]!.outputAssetId).toBe(project.pieces[harness.pieceId]!.currentAssetId);
    expect(Object.keys(project.assets)).toHaveLength(1);
    expect(project.authoringRevision).toBe(harness.project.authoringRevision);
    const mediaRoot = path.join(harness.root, project.id, 'media-v3');
    expect(await readdir(path.join(mediaRoot, '.parts'))).toEqual([]);
    expect(await readdir(path.join(mediaRoot, '.intents'))).toEqual([]);
    expect(await readdir(path.join(mediaRoot, 'assets'))).toHaveLength(1);
  });

  it.each<StudioPilotMediaStorageStepV3>([
    'media:stage_durable',
    'media:intent_durable',
    'media:final_durable',
    'media:project_committed',
  ])(
    'recovers complete-only output after %s without a pre-intent receipt or provider-id sentinel',
    async (failureStep) => {
      const sourceRoot = await temporaryRoot();
      const source = await writePng(path.join(sourceRoot, `complete-${failureStep.replaceAll(':', '-')}.png`));
      const harness = await createRunningGeneratedHarness({
        outputFile: source,
        providerSubmissionKind: 'complete',
        onStorageStep: (step) => {
          if (step === failureStep) throw new Error('simulated process death');
        },
      });

      await expectPilotError(
        harness.media.publishGeneratedOutputV3({
          projectId: harness.project.id,
          pieceId: harness.pieceId,
          jobId: harness.jobId,
          providerSubmissionKind: 'complete',
          providerJobId: null,
          outputs: [harness.output],
        }),
        'storage_error'
      );
      const interrupted = await harness.store.loadProjectV3(harness.project.id);
      if (failureStep !== 'media:project_committed') {
        expect(interrupted.jobs[harness.jobId]).toMatchObject({
          status: 'submitting',
          providerSubmissionKind: null,
          providerJobId: null,
          spendReceipt: null,
        });
      }

      const restartedStore = createCreativeStudioPilotStoreV3(storeOptions(harness.root, harness.clock));
      const restartedMedia = createStudioPilotMediaStoreV3({
        store: restartedStore,
        pickPhoto: async () => null,
        now: harness.clock.nowIso,
      });
      await restartedMedia.recoverProjectMediaV3(harness.project.id);
      const recovered = await restartedStore.loadProjectV3(harness.project.id);
      expect(recovered.jobs[harness.jobId]).toMatchObject({
        status: 'succeeded',
        providerSubmissionKind: 'complete',
        providerJobId: null,
        remoteStartedAt: null,
        spendReceipt: { jobId: harness.jobId, totalMinorUnits: 3, currency: 'USD' },
        outputAssetId: recovered.pieces[harness.pieceId]!.currentAssetId,
      });
      expect(recovered.jobs[harness.jobId]!.spendReceipt!.recordedAt).toBe(recovered.jobs[harness.jobId]!.updatedAt);
      expect(Object.keys(recovered.jobs)).toEqual([harness.jobId]);
      expect(Object.keys(recovered.assets)).toHaveLength(1);
      const mediaRoot = path.join(harness.root, recovered.id, 'media-v3');
      expect(await readdir(path.join(mediaRoot, '.parts'))).toEqual([]);
      expect(await readdir(path.join(mediaRoot, '.intents'))).toEqual([]);
    }
  );

  it('marks a complete intent as same-Job download recovery when restart cannot read its staged bytes', async () => {
    const sourceRoot = await temporaryRoot();
    const source = await writePng(path.join(sourceRoot, 'complete-missing-stage.png'));
    const harness = await createRunningGeneratedHarness({
      outputFile: source,
      providerSubmissionKind: 'complete',
      onStorageStep: (step) => {
        if (step === 'media:intent_durable') throw new Error('simulated process death');
      },
    });
    await expectPilotError(
      harness.media.publishGeneratedOutputV3({
        projectId: harness.project.id,
        pieceId: harness.pieceId,
        jobId: harness.jobId,
        providerSubmissionKind: 'complete',
        providerJobId: null,
        outputs: [harness.output],
      }),
      'storage_error'
    );
    const mediaRoot = path.join(harness.root, harness.project.id, 'media-v3');
    const partsDirectory = path.join(mediaRoot, '.parts');
    const stagedFiles = await readdir(partsDirectory);
    expect(stagedFiles).toHaveLength(1);
    await rm(path.join(partsDirectory, stagedFiles[0]!));

    const restartedStore = createCreativeStudioPilotStoreV3(storeOptions(harness.root, harness.clock));
    const restartedMedia = createStudioPilotMediaStoreV3({
      store: restartedStore,
      pickPhoto: async () => null,
      now: harness.clock.nowIso,
    });
    await expectPilotError(restartedMedia.recoverProjectMediaV3(harness.project.id), 'storage_error');
    const blocked = await restartedStore.loadProjectV3(harness.project.id);
    expect(blocked.jobs[harness.jobId]).toMatchObject({
      status: 'failed',
      providerSubmissionKind: 'complete',
      providerJobId: null,
      error: { code: 'download_failed' },
      spendReceipt: { jobId: harness.jobId, totalMinorUnits: 3, currency: 'USD' },
    });
    expect(blocked.jobs[harness.jobId]!.spendReceipt!.recordedAt).toBe(blocked.jobs[harness.jobId]!.updatedAt);
    expect(blocked.pieces[harness.pieceId]!.currentAssetId).toBeNull();
    expect(await readdir(path.join(mediaRoot, '.intents'))).toHaveLength(1);
  });

  it('replays durable generated bytes from a paid download failure onto the same Job', async () => {
    const sourceRoot = await temporaryRoot();
    const source = await writePng(path.join(sourceRoot, 'generated-download-recovery.png'));
    const harness = await createRunningGeneratedHarness({
      outputFile: source,
      onStorageStep: (step) => {
        if (step === 'media:final_durable') throw new Error('simulated process death');
      },
    });

    await expectPilotError(
      harness.media.publishGeneratedOutputV3({
        projectId: harness.project.id,
        pieceId: harness.pieceId,
        jobId: harness.jobId,
        providerSubmissionKind: 'remote',
        providerJobId: 'provider_job_1',
        outputs: [harness.output],
      }),
      'storage_error'
    );
    const beforeFailure = await harness.store.loadProjectV3(harness.project.id);
    const failedAt = harness.clock.nowIso();
    await harness.store.updateProjectV3(
      beforeFailure.id,
      (draft) => {
        const next = structuredClone(draft);
        const job = next.jobs[harness.jobId]!;
        job.status = 'failed';
        job.progress = null;
        job.error = {
          code: 'download_failed',
          messageKey: 'conversation.creativeStudio.jobs.errors.downloadFailed',
        };
        job.updatedAt = failedAt;
        return next;
      },
      { kind: 'runtime', expectedRevision: beforeFailure.revision }
    );

    const restartedStore = createCreativeStudioPilotStoreV3(storeOptions(harness.root, harness.clock));
    const restartedMedia = createStudioPilotMediaStoreV3({
      store: restartedStore,
      pickPhoto: async () => null,
      now: harness.clock.nowIso,
    });
    await restartedMedia.recoverProjectMediaV3(harness.project.id);

    const recovered = await restartedStore.loadProjectV3(harness.project.id);
    expect(recovered.jobs[harness.jobId]).toMatchObject({
      status: 'succeeded',
      spendReceipt: harness.receipt,
      outputAssetId: recovered.pieces[harness.pieceId]!.currentAssetId,
    });
    expect(Object.values(recovered.assets)).toHaveLength(1);
    expect(recovered.authoringRevision).toBe(harness.project.authoringRevision);
  });

  it('claims one exact paid download residue before replaying it onto the same Job', async () => {
    const sourceRoot = await temporaryRoot();
    const source = await writePng(path.join(sourceRoot, 'claimed-download-recovery.png'));
    const harness = await createRunningGeneratedHarness({
      outputFile: source,
      onStorageStep: (step) => {
        if (step === 'media:final_durable') throw new Error('simulated process death');
      },
    });

    await expectPilotError(
      harness.media.publishGeneratedOutputV3({
        projectId: harness.project.id,
        pieceId: harness.pieceId,
        jobId: harness.jobId,
        providerSubmissionKind: 'remote',
        providerJobId: 'provider_job_1',
        outputs: [harness.output],
      }),
      'storage_error'
    );
    const interrupted = await harness.store.loadProjectV3(harness.project.id);
    const failed = await harness.store.updateProjectV3(
      interrupted.id,
      (draft) => {
        const next = structuredClone(draft);
        const job = next.jobs[harness.jobId]!;
        job.status = 'failed';
        job.progress = null;
        job.error = {
          code: 'download_failed',
          messageKey: 'conversation.creativeStudio.jobs.errors.downloadFailed',
        };
        job.updatedAt = harness.clock.nowIso();
        return next;
      },
      { kind: 'runtime', expectedRevision: interrupted.revision }
    );

    const result = await harness.media.recoverGeneratedJobV3({
      projectId: failed.id,
      pieceId: harness.pieceId,
      jobId: harness.jobId,
      expectedRevision: failed.revision,
    });
    const recovered = await harness.store.loadProjectV3(failed.id);

    expect(result).toMatchObject({
      status: 'published',
      projectId: failed.id,
      pieceId: harness.pieceId,
      jobId: harness.jobId,
      assetId: recovered.pieces[harness.pieceId]!.currentAssetId,
    });
    expect(recovered.jobs[harness.jobId]).toMatchObject({
      status: 'succeeded',
      spendReceipt: harness.receipt,
      outputAssetId: recovered.pieces[harness.pieceId]!.currentAssetId,
    });
    expect(await readdir(path.join(harness.root, failed.id, 'media-v3', '.intents'))).toEqual([]);
  });

  it('refuses output from a different remote provider Job without changing durable authority or sidecars', async () => {
    const sourceRoot = await temporaryRoot();
    const source = await writePng(path.join(sourceRoot, 'stale-provider-flight.png'));
    const harness = await createRunningGeneratedHarness({ outputFile: source });
    const projectDirectory = path.join(harness.root, harness.project.id);
    const beforeProject = await harness.store.loadProjectV3(harness.project.id);
    const beforeEntries = await readdir(projectDirectory);

    await expectPilotError(
      harness.media.publishGeneratedOutputV3({
        projectId: harness.project.id,
        pieceId: harness.pieceId,
        jobId: harness.jobId,
        providerSubmissionKind: 'remote',
        providerJobId: 'provider_job_stale',
        outputs: [harness.output],
      }),
      'job_ineligible'
    );

    expect(await harness.store.loadProjectV3(harness.project.id)).toEqual(beforeProject);
    expect(await readdir(projectDirectory)).toEqual(beforeEntries);
  });

  it('rejects late, duplicate, multi-output, and ownership-mismatched publication without substitution', async () => {
    const sourceRoot = await temporaryRoot();
    const source = await writePng(path.join(sourceRoot, 'one.png'));
    const harness = await createRunningGeneratedHarness({ outputFile: source });
    const input = {
      projectId: harness.project.id,
      pieceId: harness.pieceId,
      jobId: harness.jobId,
      providerSubmissionKind: 'remote' as const,
      providerJobId: 'provider_job_1',
      outputs: [harness.output],
    };

    await expectPilotError(
      harness.media.publishGeneratedOutputV3({ ...input, pieceId: 'piece_other' }),
      'job_ineligible'
    );
    await expectPilotError(
      harness.media.publishGeneratedOutputV3({ ...input, outputs: [harness.output, harness.output] }),
      'invalid_media'
    );
    const published = await harness.media.publishGeneratedOutputV3(input);
    await expectPilotError(harness.media.publishGeneratedOutputV3(input), 'job_ineligible');
    const project = await harness.store.loadProjectV3(harness.project.id);
    expect(Object.keys(project.assets)).toEqual([published.assetId]);
    expect(project.pieces[harness.pieceId]!.currentAssetId).toBe(published.assetId);
  });

  it('rejects MIME disagreement and variation grids while leaving the running paid Job intact', async () => {
    const sourceRoot = await temporaryRoot();
    const source = await writePng(path.join(sourceRoot, 'grid.png'));
    const mismatch = await createRunningGeneratedHarness({ outputFile: source });
    await expectPilotError(
      mismatch.media.publishGeneratedOutputV3({
        projectId: mismatch.project.id,
        pieceId: mismatch.pieceId,
        jobId: mismatch.jobId,
        providerSubmissionKind: 'remote',
        providerJobId: 'provider_job_1',
        outputs: [{ ...mismatch.output, mimeType: 'image/jpeg' }],
      }),
      'invalid_media'
    );
    expect(
      (await mismatch.store.loadProjectV3(mismatch.project.id)).pieces[mismatch.pieceId]!.currentAssetId
    ).toBeNull();

    const grid = await createRunningGeneratedHarness({ outputFile: source, detectVariationGrid: async () => true });
    await expectPilotError(
      grid.media.publishGeneratedOutputV3({
        projectId: grid.project.id,
        pieceId: grid.pieceId,
        jobId: grid.jobId,
        providerSubmissionKind: 'remote',
        providerJobId: 'provider_job_1',
        outputs: [grid.output],
      }),
      'variation_grid'
    );
    const project = await grid.store.loadProjectV3(grid.project.id);
    expect(project.assets).toEqual({});
    expect(project.pieces[grid.pieceId]!.currentAssetId).toBeNull();
    expect(project.jobs[grid.jobId]).toMatchObject({ status: 'running', spendReceipt: grid.receipt });
  });

  it('rejects provider-declared byte and dimension disagreements', async () => {
    const sourceRoot = await temporaryRoot();
    const source = await writePng(path.join(sourceRoot, 'declared-facts.png'));
    const harness = await createRunningGeneratedHarness({ outputFile: source });
    const mismatches: ProviderOutput[] = [
      { ...harness.output, byteSize: harness.output.byteSize! + 1 },
      { ...harness.output, width: harness.output.width! + 1 },
      { ...harness.output, height: harness.output.height! + 1 },
    ];
    for (const output of mismatches) {
      // eslint-disable-next-line no-await-in-loop
      await expectPilotError(
        harness.media.publishGeneratedOutputV3({
          projectId: harness.project.id,
          pieceId: harness.pieceId,
          jobId: harness.jobId,
          providerSubmissionKind: 'remote',
          providerJobId: 'provider_job_1',
          outputs: [output],
        }),
        'invalid_media'
      );
    }
    const project = await harness.store.loadProjectV3(harness.project.id);
    expect(project.assets).toEqual({});
    expect(project.jobs[harness.jobId]).toMatchObject({ status: 'running', spendReceipt: harness.receipt });
  });

  it('resolves a generated URL in Main without persisting it', async () => {
    const sourceRoot = await temporaryRoot();
    const source = await writePng(path.join(sourceRoot, 'downloaded.png'));
    const secretUrl = 'https://provider.invalid/private-token/image';
    let cleanupAttempt = 0;
    const cleanup = vi.fn(async () => {
      cleanupAttempt += 1;
      if (cleanupAttempt === 1) throw new Error('transient cleanup refusal');
    });
    const resolver = vi.fn(async (_url: string, _signal: AbortSignal | undefined) => ({ path: source, cleanup }));
    const harness = await createRunningGeneratedHarness({ outputFile: source, resolveGeneratedUrl: resolver });
    const signal = new AbortController().signal;

    await harness.media.publishGeneratedOutputV3({
      projectId: harness.project.id,
      pieceId: harness.pieceId,
      jobId: harness.jobId,
      providerSubmissionKind: 'remote',
      providerJobId: 'provider_job_1',
      outputs: [{ ...harness.output, source: { kind: 'url', url: secretUrl } }],
      signal,
    });
    expect(resolver).toHaveBeenCalledExactlyOnceWith(secretUrl, signal);
    expect(cleanup).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(await harness.store.loadProjectV3(harness.project.id))).not.toContain(secretUrl);

    resolver.mockClear();
    await expectPilotError(
      harness.media.publishGeneratedOutputV3({
        projectId: harness.project.id,
        pieceId: harness.pieceId,
        jobId: harness.jobId,
        providerSubmissionKind: 'remote',
        providerJobId: 'provider_job_1',
        outputs: [{ ...harness.output, source: { kind: 'url', url: secretUrl } }],
        signal,
      }),
      'job_ineligible'
    );
    expect(resolver).not.toHaveBeenCalled();
  });

  it('bounds generated URL cleanup without changing a successful publication', async () => {
    const sourceRoot = await temporaryRoot();
    const source = await writePng(path.join(sourceRoot, 'cleanup-refused.png'));
    const cleanup = vi.fn(async () => {
      throw new Error('persistent cleanup refusal');
    });
    const harness = await createRunningGeneratedHarness({
      outputFile: source,
      resolveGeneratedUrl: async () => ({ path: source, cleanup }),
    });

    await expect(
      harness.media.publishGeneratedOutputV3({
        projectId: harness.project.id,
        pieceId: harness.pieceId,
        jobId: harness.jobId,
        providerSubmissionKind: 'remote',
        providerJobId: 'provider_job_1',
        outputs: [{ ...harness.output, source: { kind: 'url', url: 'https://provider.invalid/image' } }],
      })
    ).resolves.toMatchObject({ status: 'published' });
    expect(cleanup).toHaveBeenCalledTimes(3);
    expect((await harness.store.loadProjectV3(harness.project.id)).jobs[harness.jobId]).toMatchObject({
      status: 'succeeded',
      outputAssetId: expect.any(String),
    });
  });

  it('fails closed on invalid publication and verification boundaries', async () => {
    const sourceRoot = await temporaryRoot();
    const source = await writePng(path.join(sourceRoot, 'boundary.png'));
    const harness = await createRunningGeneratedHarness({ outputFile: source });
    const base = {
      projectId: harness.project.id,
      pieceId: harness.pieceId,
      jobId: harness.jobId,
      providerSubmissionKind: 'remote' as const,
      providerJobId: 'provider_job_1',
      outputs: [harness.output],
    };

    await expectPilotError(
      harness.media.publishGeneratedOutputV3({ ...base, projectId: 'bad/project' }),
      'invalid_payload'
    );
    await expectPilotError(
      harness.media.publishGeneratedOutputV3({
        ...base,
        outputs: [{ ...harness.output, source: { kind: 'url', url: 'https://provider.invalid/missing' } }],
      }),
      'invalid_media'
    );
    await expectPilotError(
      harness.media.publishGeneratedOutputV3({
        ...base,
        outputs: [{ ...harness.output, source: { kind: 'url', url: 'https://provider.invalid/bad' } }],
        resolveUrl: async () => ({ path: 42 }) as unknown as { path: string },
      }),
      'invalid_media'
    );
    await expectPilotError(
      harness.media.publishGeneratedOutputV3({
        ...base,
        outputs: [{ ...harness.output, mediaKind: 'video' }],
      }),
      'invalid_media'
    );
    await expectPilotError(
      harness.media.verifyManagedAssetV3({ projectId: 'bad/project', assetId: 'asset' }),
      'invalid_payload'
    );
    await expectPilotError(
      harness.media.verifyManagedAssetV3({ projectId: harness.project.id, assetId: 'asset_missing' }),
      'not_found'
    );
  });
});
