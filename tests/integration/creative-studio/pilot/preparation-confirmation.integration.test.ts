/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment node
 */

import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  STUDIO_GENERATION_COMPOSITION_SCHEMA_VERSION_V3,
  STUDIO_MAX_PIECES_V3,
} from '@/common/types/project/creativeStudioTypes';
import type { StudioGenerationRouteCatalog } from '@/process/services/creative-studio/providerResolver';
import {
  createStudioPilotConfirmPhotoServiceV3,
  createStudioPilotPreparePhotoServiceV3,
  resolveStudioPieceRouteAndRateV3,
  type StudioPilotIdentityKindV3,
} from '@/process/services/creative-studio/service/pilot';
import {
  createStudioPilotMediaStoreV3,
  type StudioPilotNativePhotoSelectionV3,
} from '@/process/services/creative-studio/service/pilot/runtime/media';
import { studioPieceGenerationCompositionDigestV3 } from '@/process/services/creative-studio/service/schema2/generation';
import {
  createStudioPieceSpendReceiptV3,
  StudioPreparedPhotoCacheV3,
} from '@/process/services/creative-studio/service/schema2/pricing';
import {
  createCreativeStudioPilotStoreV3,
  type StudioPilotStorageStepV3,
} from '@/process/services/creative-studio/store/pilot';
import sharp from 'sharp';
import { afterEach, describe, expect, it, vi } from 'vitest';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const temporaryRoot = async (): Promise<string> => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'studio-pilot-v3-prepare-'));
  roots.push(root);
  return root;
};

const writePng = async (file: string): Promise<string> => {
  await sharp({
    create: { width: 24, height: 16, channels: 3, background: { r: 28, g: 72, b: 118 } },
  })
    .png()
    .toFile(file);
  return file;
};

const record = (value: unknown): Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new TypeError('Expected record');
  return value as Record<string, unknown>;
};

const array = (value: unknown): unknown[] => {
  if (!Array.isArray(value)) throw new TypeError('Expected array');
  return value;
};

const compositionInputs = (composition: unknown): Record<string, unknown> => record(record(composition).inputs);

const requestPlanCompositionInputs = (requestPlan: unknown): Record<string, unknown> =>
  compositionInputs(record(record(requestPlan).snapshot).composition);

const rewritePersistedGenerationContract = (
  manifest: Record<string, unknown>,
  compositionSchemaVersion: number,
  authoringFingerprintVersion: number
): void => {
  for (const job of Object.values(record(manifest.jobs))) {
    const persistedJob = record(job);
    persistedJob.authoringFingerprintVersion = authoringFingerprintVersion;
    for (const inputs of [
      compositionInputs(persistedJob.composition),
      requestPlanCompositionInputs(persistedJob.requestPlan),
    ]) {
      inputs.schemaVersion = compositionSchemaVersion;
      inputs.authoringFingerprintVersion = authoringFingerprintVersion;
    }
  }
  for (const authorization of array(manifest.spendAuthorizations)) {
    const quote = record(record(authorization).quote);
    quote.authoringFingerprintVersion = authoringFingerprintVersion;
    const inputs = requestPlanCompositionInputs(record(quote.item).requestPlan);
    inputs.schemaVersion = compositionSchemaVersion;
    inputs.authoringFingerprintVersion = authoringFingerprintVersion;
  }
};

const route = (
  choiceId = 'route_image',
  maxConditioningImages = 0
): StudioGenerationRouteCatalog['routes'][number] => ({
  choiceId,
  providerId: `provider_${choiceId}`,
  providerName: 'Image provider',
  adapterId: 'weprompt-image-v1',
  model: `model_${choiceId}`,
  health: 'available',
  kind: 'image',
  constraints: {
    aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4'],
    resolutions: ['720p', '1080p'],
    minDurationSeconds: 1,
    maxDurationSeconds: 60,
    supportsFirstFrame: false,
    maxConditioningImages,
    silentOutput: true,
  },
  cancellationPolicy: 'queued_only',
});

const createHarness = async (
  options: {
    policy?: 'within_cap' | 'none';
    mintIdentity?: (kind: StudioPilotIdentityKindV3) => string;
  } = {}
) => {
  const root = await temporaryRoot();
  let clock = Date.parse('2026-08-31T08:00:00.000Z');
  let projectSequence = 0;
  let identitySequence = 0;
  let currentRoutes = [route()];
  let rateMinorUnits = 3;
  let failedUpdateStep: StudioPilotStorageStepV3 | null = null;
  let selectedPhoto: StudioPilotNativePhotoSelectionV3 | null = null;
  const store = createCreativeStudioPilotStoreV3({
    rootDir: root,
    now: () => new Date(clock).toISOString(),
    createProjectId: () => `project_${++projectSequence}`,
    createTemporaryId: (() => {
      let sequence = 0;
      return () => `temporary_${String(++sequence).padStart(8, '0')}`;
    })(),
    onStorageStep: (step) => {
      if (step !== failedUpdateStep) return;
      failedUpdateStep = null;
      throw new Error(`injected ${step}`);
    },
  });
  let project = await store.createProjectV3({ name: 'Pilot', brief: 'One luminous street photograph.' });
  if (options.policy === 'within_cap') {
    project = await store.updateProjectV3(
      project.id,
      (draft) => ({ ...draft, spendPolicy: { currency: 'USD', maxPerBatchMinorUnits: 3 } }),
      { kind: 'authoring', expectedRevision: project.revision }
    );
  }
  const preparedPhotos = new StudioPreparedPhotoCacheV3({ now: () => clock });
  const providerResolver = {
    listGenerationRoutes: async (): Promise<StudioGenerationRouteCatalog> => ({
      routes: currentRoutes,
      diagnostics: [],
      generationCatalogVersion: 'catalog_1',
    }),
  };
  const mintIdentity =
    options.mintIdentity ?? ((kind: StudioPilotIdentityKindV3): string => `${kind}_${++identitySequence}`);
  const resolveRouteAndRate: NonNullable<
    Parameters<typeof createStudioPilotPreparePhotoServiceV3>[0]['resolveRouteAndRate']
  > = vi.fn(async (resolver, settings, conditioningInputCount) => {
    const resolved = await resolveStudioPieceRouteAndRateV3(resolver, settings, conditioningInputCount);
    return rateMinorUnits === resolved.rateMinorUnits
      ? resolved
      : { ...resolved, rateMinorUnits, rateCardDigest: 'f'.repeat(64) };
  });
  const dispatch = vi.fn(async () => undefined);
  const prepare = createStudioPilotPreparePhotoServiceV3({
    store,
    preparedPhotos,
    providerResolver,
    resolveRouteAndRate,
    now: () => clock,
    mintIdentity,
  });
  const confirm = createStudioPilotConfirmPhotoServiceV3({
    store,
    preparedPhotos,
    providerResolver,
    resolveRouteAndRate,
    now: () => clock,
    dispatchCommittedJob: dispatch,
  });
  let mediaIdentitySequence = 0;
  let mediaTemporarySequence = 0;
  const media = createStudioPilotMediaStoreV3({
    store,
    pickPhoto: async () => selectedPhoto,
    now: () => new Date(clock).toISOString(),
    mintIdentity: (kind) => `${kind}_media_${++mediaIdentitySequence}`,
    createTemporaryId: () => `media_temporary_${String(++mediaTemporarySequence).padStart(8, '0')}`,
    reservedCreateHandles: (projectId, authoringRevision) =>
      preparedPhotos.reservedCreateHandles(projectId, authoringRevision),
  });
  return {
    root,
    store,
    preparedPhotos,
    prepare,
    confirm,
    media,
    resolveRouteAndRate,
    dispatch,
    project: () => project,
    setProject: (value: typeof project) => {
      project = value;
    },
    advance: (milliseconds: number) => {
      clock += milliseconds;
    },
    setRoutes: (routes: StudioGenerationRouteCatalog['routes']) => {
      currentRoutes = routes;
    },
    setRateMinorUnits: (value: number) => {
      rateMinorUnits = value;
    },
    setSelectedPhoto: (selection: StudioPilotNativePhotoSelectionV3 | null) => {
      selectedPhoto = selection;
    },
    failNextUpdateAt: (step: StudioPilotStorageStepV3) => {
      failedUpdateStep = step;
    },
  };
};

const importDurablePieces = async (
  harness: Awaited<ReturnType<typeof createHarness>>,
  count: number
): Promise<void> => {
  const current = await harness.store.loadProjectV3(harness.project().id);
  const seeded = await harness.store.updateProjectV3(
    current.id,
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
          createdAt: current.updatedAt,
          updatedAt: current.updatedAt,
        };
        next.assets[assetId] = {
          id: assetId,
          projectId: current.id,
          pieceId,
          mediaKind: 'image',
          mimeType: 'image/png',
          managedAsset: { collection: 'imports', fileName: `${assetId}.png` },
          byteSize: 1,
          sha256: 'd'.repeat(64),
          width: 1,
          height: 1,
          createdAt: current.updatedAt,
          origin: 'imported',
          producerJobId: null,
          compositionDigest: null,
        };
      }
      return next;
    },
    { kind: 'authoring', expectedRevision: current.revision }
  );
  harness.setProject(seeded);
};

const prepareCreate = async (harness: Awaited<ReturnType<typeof createHarness>>) =>
  harness.prepare.preparePhotoV3({
    mode: 'create',
    projectId: harness.project().id,
    expectedAuthoringRevision: harness.project().authoringRevision,
    words: '  rain   on neon  ',
    settings: { aspectRatio: '16:9', resolution: '1080p' },
    suggestedHandle: null,
    referencePieceIds: [],
  });

const confirmPrepared = async (
  harness: Awaited<ReturnType<typeof createHarness>>,
  prepared: Awaited<ReturnType<typeof prepareCreate>>
) =>
  harness.confirm.confirmPreparedPhotoV3({
    reservationId: prepared.quote.reservationId,
    quoteId: prepared.quote.quoteId,
    quoteRevision: prepared.quote.quoteRevision,
    explicitHumanConfirmation: prepared.quote.requiresExplicitHumanAction,
    duplicateChargeAcknowledged: prepared.quote.duplicateChargeAcknowledgementRequired,
  });

const createRetryablePiece = async (
  harness: Awaited<ReturnType<typeof createHarness>>,
  errorCode: 'provider_unavailable' | 'submission_unknown'
) => {
  const prepared = await prepareCreate(harness);
  const confirmed = await confirmPrepared(harness, prepared);
  let project = await harness.store.loadProjectV3(harness.project().id);
  project = await harness.store.updateProjectV3(
    project.id,
    (draft) => {
      const job = draft.jobs[confirmed.jobId]!;
      job.status = errorCode === 'submission_unknown' ? 'needs_attention' : 'failed';
      job.error = {
        code: errorCode,
        messageKey:
          errorCode === 'submission_unknown'
            ? 'conversation.creativeStudio.jobs.errors.submissionUnknown'
            : 'conversation.creativeStudio.jobs.errors.providerUnavailable',
      };
      job.updatedAt = project.updatedAt;
      return draft;
    },
    { kind: 'runtime', expectedRevision: project.revision }
  );
  harness.setProject(project);
  return { firstPrepared: prepared, firstConfirmed: confirmed, project };
};

describe('schema-6 photo preparation and confirmation', () => {
  it('prepares a normalized, renderer-safe quote without touching durable project records', async () => {
    const harness = await createHarness({ policy: 'within_cap' });
    const directory = path.join(harness.root, harness.project().id);
    const beforeManifest = await readFile(path.join(directory, 'project.json'), 'utf8');
    const beforeBrief = await readFile(path.join(directory, 'brief.md'), 'utf8');
    const beforeEntries = await readdir(directory);

    const prepared = await prepareCreate(harness);

    expect(prepared).toMatchObject({
      status: 'prepared',
      quote: {
        mode: 'create',
        words: 'rain on neon',
        proposedHandle: 'rain_on_neon',
        currency: 'USD',
        lowerMinorUnits: 3,
        upperMinorUnits: 3,
        spendPolicyClassification: 'within_cap',
        requiresExplicitHumanAction: false,
      },
    });
    expect(await readFile(path.join(directory, 'project.json'), 'utf8')).toBe(beforeManifest);
    expect(await readFile(path.join(directory, 'brief.md'), 'utf8')).toBe(beforeBrief);
    expect(await readdir(directory)).toEqual(beforeEntries);
    expect((await harness.store.loadProjectV3(harness.project().id)).pieceOrder).toEqual([]);

    const restartedCache = new StudioPreparedPhotoCacheV3();
    expect(restartedCache.list(harness.project().id)).toEqual([]);
    expect(harness.preparedPhotos.list(harness.project().id)).toHaveLength(1);
  });

  it('reports a complete pre-bump nested generation contract as unsupported without rewriting it', async () => {
    const harness = await createHarness({ policy: 'within_cap' });
    const confirmed = await confirmPrepared(harness, await prepareCreate(harness));
    const manifestPath = path.join(harness.root, harness.project().id, 'project.json');
    const manifest = record(JSON.parse(await readFile(manifestPath, 'utf8')) as unknown);
    rewritePersistedGenerationContract(manifest, 2, 1);
    const legacyBytes = `${JSON.stringify(manifest, null, 2)}\n`;
    await writeFile(manifestPath, legacyBytes, 'utf8');

    const restarted = createCreativeStudioPilotStoreV3({ rootDir: harness.root });
    expect(await restarted.getProjectV3(harness.project().id)).toEqual({
      status: 'unsupported',
      catalogueId: harness.project().id,
    });
    await expect(restarted.loadProjectV3(harness.project().id)).rejects.toMatchObject({ code: 'unsupported' });
    expect(await readFile(manifestPath, 'utf8')).toBe(legacyBytes);
    expect(Object.keys(record(manifest.jobs))).toEqual([confirmed.jobId]);
  });

  it('quarantines an internally mixed nested contract while a healthy schema-6 sibling remains available', async () => {
    const harness = await createHarness({ policy: 'within_cap' });
    const confirmed = await confirmPrepared(harness, await prepareCreate(harness));
    const healthySibling = await harness.store.createProjectV3({ name: 'Healthy sibling', brief: 'Still opens.' });
    const manifestPath = path.join(harness.root, harness.project().id, 'project.json');
    const manifest = record(JSON.parse(await readFile(manifestPath, 'utf8')) as unknown);
    rewritePersistedGenerationContract(manifest, 2, 1);
    const job = record(record(manifest.jobs)[confirmed.jobId]);
    compositionInputs(job.composition).schemaVersion = STUDIO_GENERATION_COMPOSITION_SCHEMA_VERSION_V3;
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

    const restarted = createCreativeStudioPilotStoreV3({ rootDir: harness.root });
    expect(await restarted.inspectProjectsV3()).toEqual({
      healthyProjectIds: [healthySibling.id],
      unsupportedProjectIds: [],
      quarantinedProjectIds: [harness.project().id],
    });
    expect((await restarted.loadProjectV3(healthySibling.id)).name).toBe('Healthy sibling');
  });

  it('freezes two exact current Piece assets and retains them unchanged across a retry', async () => {
    const harness = await createHarness({ policy: 'within_cap' });
    await importDurablePieces(harness, 2);
    harness.setRoutes([route('route_image', 2)]);
    const referencePieceIds = ['piece_seed_001', 'piece_seed_002'];

    const prepared = await harness.prepare.preparePhotoV3({
      mode: 'create',
      projectId: harness.project().id,
      expectedAuthoringRevision: harness.project().authoringRevision,
      words: 'A red coat beneath the rainy awning.',
      settings: { aspectRatio: '16:9', resolution: '1080p' },
      suggestedHandle: null,
      referencePieceIds,
    });
    expect(prepared.quote.referencePieceIds).toEqual(referencePieceIds);
    const expectedInputs = [
      {
        pieceId: 'piece_seed_001',
        assetId: 'asset_seed_001',
        sha256: 'd'.repeat(64),
        mimeType: 'image/png',
        byteSize: 1,
      },
      {
        pieceId: 'piece_seed_002',
        assetId: 'asset_seed_002',
        sha256: 'd'.repeat(64),
        mimeType: 'image/png',
        byteSize: 1,
      },
    ];
    const confirmed = await confirmPrepared(harness, prepared);
    let project = await harness.store.loadProjectV3(harness.project().id);
    expect(project.jobs[confirmed.jobId]?.requestPlan.snapshot.conditioningInputs).toEqual(expectedInputs);
    project = await harness.store.updateProjectV3(
      project.id,
      (draft) => {
        const job = draft.jobs[confirmed.jobId]!;
        job.status = 'failed';
        job.error = {
          code: 'provider_unavailable',
          messageKey: 'conversation.creativeStudio.jobs.errors.providerUnavailable',
        };
        return draft;
      },
      { kind: 'runtime', expectedRevision: project.revision }
    );
    harness.setProject(project);

    const retry = await harness.prepare.preparePhotoV3({
      mode: 'retry',
      projectId: project.id,
      expectedAuthoringRevision: project.authoringRevision,
      pieceId: confirmed.pieceId,
      sourceJobId: confirmed.jobId,
    });

    expect(retry.quote.referencePieceIds).toEqual(referencePieceIds);
    const retryConfirmed = await confirmPrepared(harness, retry);
    expect(
      (await harness.store.loadProjectV3(project.id)).jobs[retryConfirmed.jobId]?.requestPlan.snapshot
        .conditioningInputs
    ).toEqual(expectedInputs);
  });

  it('fails before route or spend work for a missing reference Piece', async () => {
    const harness = await createHarness({ policy: 'within_cap' });
    harness.setRoutes([route('route_image', 2)]);
    harness.resolveRouteAndRate.mockClear();

    await expect(
      harness.prepare.preparePhotoV3({
        mode: 'create',
        projectId: harness.project().id,
        expectedAuthoringRevision: harness.project().authoringRevision,
        words: 'A red coat beneath the rainy awning.',
        settings: { aspectRatio: '16:9', resolution: '1080p' },
        suggestedHandle: null,
        referencePieceIds: ['piece_missing'],
      })
    ).rejects.toMatchObject({ code: 'invalid_reference' });
    expect(harness.resolveRouteAndRate).not.toHaveBeenCalled();
    expect(harness.preparedPhotos.list(harness.project().id)).toEqual([]);
    expect((await harness.store.loadProjectV3(harness.project().id)).spendAuthorizations).toEqual([]);
  });

  it('fails before quote or spend when the selected route cannot carry the frozen references', async () => {
    const harness = await createHarness({ policy: 'within_cap' });
    await importDurablePieces(harness, 1);
    harness.resolveRouteAndRate.mockClear();

    await expect(
      harness.prepare.preparePhotoV3({
        mode: 'create',
        projectId: harness.project().id,
        expectedAuthoringRevision: harness.project().authoringRevision,
        words: 'A red coat beneath the rainy awning.',
        settings: { aspectRatio: '16:9', resolution: '1080p' },
        suggestedHandle: null,
        referencePieceIds: ['piece_seed_001'],
      })
    ).rejects.toMatchObject({ code: 'route_incompatible' });
    expect(harness.resolveRouteAndRate).toHaveBeenCalledOnce();
    expect(harness.preparedPhotos.list(harness.project().id)).toEqual([]);
    expect((await harness.store.loadProjectV3(harness.project().id)).spendAuthorizations).toEqual([]);
  });

  it('rejects a prepared reference snapshot after its current asset changes and spends nothing', async () => {
    const harness = await createHarness({ policy: 'within_cap' });
    await importDurablePieces(harness, 1);
    harness.setRoutes([route('route_image', 2)]);
    const prepared = await harness.prepare.preparePhotoV3({
      mode: 'create',
      projectId: harness.project().id,
      expectedAuthoringRevision: harness.project().authoringRevision,
      words: 'A red coat beneath the rainy awning.',
      settings: { aspectRatio: '16:9', resolution: '1080p' },
      suggestedHandle: null,
      referencePieceIds: ['piece_seed_001'],
    });
    const current = await harness.store.loadProjectV3(harness.project().id);
    const changed = await harness.store.updateProjectV3(
      current.id,
      (draft) => {
        draft.assets.asset_seed_001!.sha256 = 'e'.repeat(64);
        return draft;
      },
      { kind: 'authoring', expectedRevision: current.revision }
    );
    harness.setProject(changed);

    await expect(confirmPrepared(harness, prepared)).rejects.toMatchObject({ code: 'stale_quote' });
    const after = await harness.store.loadProjectV3(current.id);
    expect(after.spendAuthorizations).toEqual([]);
    expect(Object.keys(after.jobs)).toEqual([]);
    expect(harness.dispatch).not.toHaveBeenCalled();
  });

  it('retries a reservation identity that collides with persisted authorization history', async () => {
    let collision: string | null = null;
    let returnedCollision = false;
    let sequence = 0;
    const harness = await createHarness({
      policy: 'within_cap',
      mintIdentity: (kind) => {
        if (kind === 'reservation' && collision !== null && !returnedCollision) {
          returnedCollision = true;
          return collision;
        }
        return `${kind}_collision_${++sequence}`;
      },
    });
    const first = await createRetryablePiece(harness, 'provider_unavailable');
    collision = first.firstPrepared.quote.reservationId;

    const second = await prepareCreate(harness);

    expect(returnedCollision).toBe(true);
    expect(second.quote.reservationId).not.toBe(collision);
    expect(harness.preparedPhotos.list(harness.project().id)).toHaveLength(1);
  });

  it('leases exactly one 96th create quote before a competing preparation reaches route work', async () => {
    const harness = await createHarness({ policy: 'within_cap' });
    await importDurablePieces(harness, STUDIO_MAX_PIECES_V3 - 1);
    harness.resolveRouteAndRate.mockClear();

    const outcomes = await Promise.allSettled([prepareCreate(harness), prepareCreate(harness)]);

    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.find((outcome) => outcome.status === 'rejected')).toMatchObject({
      status: 'rejected',
      reason: { code: 'project_piece_capacity_reached' },
    });
    expect(harness.resolveRouteAndRate).toHaveBeenCalledOnce();
    expect(harness.preparedPhotos.list(harness.project().id)).toHaveLength(1);
    expect((await harness.store.loadProjectV3(harness.project().id)).pieceOrder).toHaveLength(STUDIO_MAX_PIECES_V3 - 1);
  });

  it('rechecks the 96-Piece ceiling at confirmation before authorization, Job, spend, or dispatch', async () => {
    const sourceRoot = await temporaryRoot();
    const source = await writePng(path.join(sourceRoot, 'confirmation-capacity-seed.png'));
    const harness = await createHarness({ policy: 'within_cap' });
    await importDurablePieces(harness, STUDIO_MAX_PIECES_V3 - 1);
    const prepared = await prepareCreate(harness);
    const beforeCompetingCommit = await harness.store.loadProjectV3(harness.project().id);

    // Model a second Main process that cannot see this process-local prepared reservation. Storage
    // authority still admits only its own exact 96th commit; confirmation must re-read that result.
    let identitySequence = 0;
    const competingMedia = createStudioPilotMediaStoreV3({
      store: harness.store,
      pickPhoto: async () => ({ path: source, fileName: 'Competing final slot.png' }),
      now: () => '2026-08-31T08:00:00.000Z',
      mintIdentity: (kind) => `${kind}_competing_${++identitySequence}`,
      createTemporaryId: () => `temporary_competing_${++identitySequence}`,
      reservedCreateHandles: () => [],
    });
    await expect(
      competingMedia.importPhotoV3({
        projectId: beforeCompetingCommit.id,
        expectedAuthoringRevision: beforeCompetingCommit.authoringRevision,
      })
    ).resolves.toMatchObject({ status: 'imported' });

    await expect(confirmPrepared(harness, prepared)).rejects.toMatchObject({
      code: 'project_piece_capacity_reached',
    });
    const full = await harness.store.loadProjectV3(beforeCompetingCommit.id);
    expect(full.pieceOrder).toHaveLength(STUDIO_MAX_PIECES_V3);
    expect(full.spendAuthorizations).toEqual([]);
    expect(Object.keys(full.jobs)).toEqual([]);
    expect(harness.dispatch).not.toHaveBeenCalled();
  });

  it('uses one commit path for automatic and explicit confirmation and persists before dispatch', async () => {
    const automatic = await createHarness({ policy: 'within_cap' });
    const automaticPrepared = await prepareCreate(automatic);
    const automaticResult = await confirmPrepared(automatic, automaticPrepared);
    const automaticProject = await automatic.store.loadProjectV3(automatic.project().id);

    expect(automaticResult).toMatchObject({ status: 'queued', revision: 3, authoringRevision: 3 });
    expect(automatic.dispatch).toHaveBeenCalledOnce();
    expect(automaticProject.pieceOrder).toEqual([automaticResult.pieceId]);
    expect(automaticProject.pieces[automaticResult.pieceId]?.jobIds).toEqual([automaticResult.jobId]);
    expect(automaticProject.jobs[automaticResult.jobId]?.status).toBe('queued_local');
    expect(automaticProject.spendAuthorizations).toHaveLength(1);
    expect(automatic.preparedPhotos.list(automatic.project().id)).toEqual([]);

    const explicit = await createHarness({ policy: 'none' });
    const explicitPrepared = await prepareCreate(explicit);
    expect(explicitPrepared.quote.requiresExplicitHumanAction).toBe(true);
    const explicitResult = await confirmPrepared(explicit, explicitPrepared);
    const explicitProject = await explicit.store.loadProjectV3(explicit.project().id);
    expect(explicitResult.status).toBe('queued');
    expect(explicitProject.pieces[explicitResult.pieceId]?.jobIds).toEqual([explicitResult.jobId]);
    expect(explicitProject.jobs[explicitResult.jobId]?.status).toBe('queued_local');
  });

  it('keeps a committed queued job recoverable when immediate dispatch throws', async () => {
    const harness = await createHarness({ policy: 'within_cap' });
    const prepared = await prepareCreate(harness);
    harness.dispatch.mockRejectedValueOnce(new Error('adapter unavailable'));

    const result = await confirmPrepared(harness, prepared);

    expect(result.status).toBe('queued');
    expect((await harness.store.loadProjectV3(harness.project().id)).jobs[result.jobId]?.status).toBe('queued_local');
    expect(harness.preparedPhotos.list(harness.project().id)).toEqual([]);
  });

  it('keeps create and retry lineage unchanged when the durable commit fails before its journal', async () => {
    const create = await createHarness({ policy: 'within_cap' });
    const createPrepared = await prepareCreate(create);
    const createBefore = await create.store.loadProjectV3(create.project().id);
    create.failNextUpdateAt('update:candidates_durable');

    await expect(confirmPrepared(create, createPrepared)).rejects.toMatchObject({ code: 'storage_error' });
    expect(await create.store.loadProjectV3(create.project().id)).toEqual(createBefore);
    expect(create.preparedPhotos.list(create.project().id)).toHaveLength(1);
    expect(create.dispatch).not.toHaveBeenCalled();
    await expect(confirmPrepared(create, createPrepared)).resolves.toMatchObject({ status: 'queued' });
    expect(create.dispatch).toHaveBeenCalledOnce();

    const retry = await createHarness({ policy: 'within_cap' });
    const predecessor = await createRetryablePiece(retry, 'provider_unavailable');
    const retryPrepared = await retry.prepare.preparePhotoV3({
      mode: 'retry',
      projectId: predecessor.project.id,
      expectedAuthoringRevision: predecessor.project.authoringRevision,
      pieceId: predecessor.firstConfirmed.pieceId,
      sourceJobId: predecessor.firstConfirmed.jobId,
    });
    const retryBefore = await retry.store.loadProjectV3(predecessor.project.id);
    retry.dispatch.mockClear();
    retry.failNextUpdateAt('update:candidates_durable');

    await expect(confirmPrepared(retry, retryPrepared)).rejects.toMatchObject({ code: 'storage_error' });
    expect(await retry.store.loadProjectV3(predecessor.project.id)).toEqual(retryBefore);
    expect(retry.preparedPhotos.list(predecessor.project.id)).toHaveLength(1);
    expect(retry.dispatch).not.toHaveBeenCalled();
    await expect(confirmPrepared(retry, retryPrepared)).resolves.toMatchObject({ status: 'queued' });
    expect(retry.dispatch).toHaveBeenCalledOnce();
  });

  it.each(['update:journal_durable', 'update:brief_published'] as const)(
    'reconciles an exact create commit after an ambiguous %s failure',
    async (step) => {
      const harness = await createHarness({ policy: 'within_cap' });
      const prepared = await prepareCreate(harness);
      harness.failNextUpdateAt(step);

      const result = await confirmPrepared(harness, prepared);
      const reloaded = await harness.store.loadProjectV3(harness.project().id);

      expect(result).toMatchObject({ status: 'queued', revision: 3, authoringRevision: 3 });
      expect(reloaded.pieceOrder).toEqual([result.pieceId]);
      expect(reloaded.pieces[result.pieceId]?.jobIds).toEqual([result.jobId]);
      expect(reloaded.jobs[result.jobId]).toMatchObject({
        status: 'queued_local',
        authorizationId: reloaded.spendAuthorizations[0]?.id,
      });
      expect(reloaded.spendAuthorizations).toHaveLength(1);
      expect(harness.preparedPhotos.list(reloaded.id)).toEqual([]);
      expect(harness.dispatch).toHaveBeenCalledOnce();
      await expect(confirmPrepared(harness, prepared)).rejects.toMatchObject({ code: 'quote_not_found' });
      expect(harness.dispatch).toHaveBeenCalledOnce();
    }
  );

  it.each(['update:journal_durable', 'update:brief_published'] as const)(
    'reconciles an exact retry commit and lineage after an ambiguous %s failure',
    async (step) => {
      const harness = await createHarness({ policy: 'within_cap' });
      const predecessor = await createRetryablePiece(harness, 'provider_unavailable');
      const prepared = await harness.prepare.preparePhotoV3({
        mode: 'retry',
        projectId: predecessor.project.id,
        expectedAuthoringRevision: predecessor.project.authoringRevision,
        pieceId: predecessor.firstConfirmed.pieceId,
        sourceJobId: predecessor.firstConfirmed.jobId,
      });
      harness.dispatch.mockClear();
      harness.failNextUpdateAt(step);

      const result = await confirmPrepared(harness, prepared);
      const reloaded = await harness.store.loadProjectV3(predecessor.project.id);

      expect(result).toMatchObject({
        status: 'queued',
        pieceId: predecessor.firstConfirmed.pieceId,
        authoringRevision: predecessor.project.authoringRevision,
      });
      expect(reloaded.authoringRevision).toBe(predecessor.project.authoringRevision);
      expect(reloaded.pieceOrder).toEqual([predecessor.firstConfirmed.pieceId]);
      expect(reloaded.pieces[predecessor.firstConfirmed.pieceId]?.jobIds).toEqual([
        predecessor.firstConfirmed.jobId,
        result.jobId,
      ]);
      expect(reloaded.jobs[result.jobId]).toMatchObject({
        status: 'queued_local',
        retryOfJobId: predecessor.firstConfirmed.jobId,
        retryReason: 'provider_failure',
      });
      expect(reloaded.spendAuthorizations).toHaveLength(2);
      expect(harness.preparedPhotos.list(reloaded.id)).toEqual([]);
      expect(harness.dispatch).toHaveBeenCalledOnce();
      await expect(confirmPrepared(harness, prepared)).rejects.toMatchObject({ code: 'quote_not_found' });
      expect(harness.dispatch).toHaveBeenCalledOnce();
    }
  );

  it('admits only one concurrent confirmation for one reservation', async () => {
    const harness = await createHarness({ policy: 'within_cap' });
    const prepared = await prepareCreate(harness);
    const request = {
      reservationId: prepared.quote.reservationId,
      quoteId: prepared.quote.quoteId,
      quoteRevision: prepared.quote.quoteRevision,
      explicitHumanConfirmation: false,
      duplicateChargeAcknowledged: false,
    };

    const settled = await Promise.allSettled([
      harness.confirm.confirmPreparedPhotoV3(request),
      harness.confirm.confirmPreparedPhotoV3(request),
    ]);

    expect(settled.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(settled.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const project = await harness.store.loadProjectV3(harness.project().id);
    expect(project.pieceOrder).toHaveLength(1);
    expect(project.spendAuthorizations).toHaveLength(1);
    expect(Object.keys(project.jobs)).toHaveLength(1);
    expect(harness.dispatch).toHaveBeenCalledOnce();
  });

  it('allows unrelated runtime revision movement but refuses authoring and route movement', async () => {
    const runtime = await createHarness({ policy: 'within_cap' });
    const runtimePrepared = await prepareCreate(runtime);
    const runtimeProject = await runtime.store.updateProjectV3(runtime.project().id, (draft) => draft, {
      kind: 'runtime',
      expectedRevision: runtime.project().revision,
    });
    runtime.setProject(runtimeProject);
    await expect(confirmPrepared(runtime, runtimePrepared)).resolves.toMatchObject({ status: 'queued' });

    const authored = await createHarness({ policy: 'within_cap' });
    const authoredPrepared = await prepareCreate(authored);
    const authoredProject = await authored.store.updateProjectV3(
      authored.project().id,
      (draft) => ({ ...draft, name: 'Changed title' }),
      { kind: 'authoring', expectedRevision: authored.project().revision }
    );
    authored.setProject(authoredProject);
    await expect(confirmPrepared(authored, authoredPrepared)).rejects.toMatchObject({ code: 'stale_quote' });
    expect(authored.dispatch).not.toHaveBeenCalled();

    const routed = await createHarness({ policy: 'within_cap' });
    const routedPrepared = await prepareCreate(routed);
    routed.setRoutes([route('replacement')]);
    await expect(confirmPrepared(routed, routedPrepared)).rejects.toMatchObject({ code: 'stale_quote' });
    expect(routed.dispatch).not.toHaveBeenCalled();

    const rerated = await createHarness({ policy: 'within_cap' });
    const reratedPrepared = await prepareCreate(rerated);
    rerated.setRateMinorUnits(4);
    await expect(confirmPrepared(rerated, reratedPrepared)).rejects.toMatchObject({ code: 'stale_quote' });
    const reratedProject = await rerated.store.loadProjectV3(rerated.project().id);
    expect(reratedProject.pieceOrder).toEqual([]);
    expect(reratedProject.spendAuthorizations).toEqual([]);
    expect(Object.keys(reratedProject.jobs)).toEqual([]);
    expect(rerated.dispatch).not.toHaveBeenCalled();
  });

  it('keeps a prepared create valid across unrelated progress and receipt commits', async () => {
    const harness = await createHarness({ policy: 'within_cap' });
    const firstPrepared = await prepareCreate(harness);
    const first = await confirmPrepared(harness, firstPrepared);
    let project = await harness.store.loadProjectV3(harness.project().id);
    project = await harness.store.updateProjectV3(
      project.id,
      (draft) => {
        const job = draft.jobs[first.jobId]!;
        job.status = 'running';
        job.providerSubmissionKind = 'remote';
        job.providerJobId = 'provider_job_progress';
        job.remoteStartedAt = job.createdAt;
        job.progress = 25;
        return draft;
      },
      { kind: 'runtime', expectedRevision: project.revision }
    );
    harness.setProject(project);
    const secondPrepared = await prepareCreate(harness);

    project = await harness.store.updateProjectV3(
      project.id,
      (draft) => {
        const job = draft.jobs[first.jobId]!;
        const authorization = draft.spendAuthorizations.find((candidate) => candidate.id === job.authorizationId)!;
        job.progress = 90;
        job.spendReceipt = createStudioPieceSpendReceiptV3({
          reservationId: authorization.quote.reservationId,
          authorization,
          jobId: job.id,
          recordedAt: job.updatedAt,
        });
        return draft;
      },
      { kind: 'runtime', expectedRevision: project.revision }
    );
    harness.setProject(project);

    await expect(confirmPrepared(harness, secondPrepared)).resolves.toMatchObject({ status: 'queued' });
    const reloaded = await harness.store.loadProjectV3(project.id);
    expect(reloaded.pieceOrder).toHaveLength(2);
    expect(reloaded.spendAuthorizations).toHaveLength(2);
    expect(Object.keys(reloaded.jobs)).toHaveLength(2);
  });

  it('invalidates sibling prepared intents after a create changes authored canvas meaning', async () => {
    const harness = await createHarness({ policy: 'within_cap' });
    const first = await prepareCreate(harness);
    const sibling = await prepareCreate(harness);

    expect(harness.preparedPhotos.list(harness.project().id)).toEqual([
      expect.objectContaining({ reservationId: first.quote.reservationId }),
      expect.objectContaining({ reservationId: sibling.quote.reservationId }),
    ]);

    await expect(confirmPrepared(harness, first)).resolves.toMatchObject({ status: 'queued' });
    expect(harness.preparedPhotos.list(harness.project().id)).toEqual([]);
    await expect(confirmPrepared(harness, sibling)).rejects.toMatchObject({ code: 'quote_not_found' });
    expect((await harness.store.loadProjectV3(harness.project().id)).pieceOrder).toHaveLength(1);
  });

  it('records retry confirmation as runtime activity without staling an unrelated prepared create', async () => {
    const harness = await createHarness({ policy: 'within_cap' });
    const predecessor = await createRetryablePiece(harness, 'provider_unavailable');
    const unrelatedCreate = await prepareCreate(harness);
    const retry = await harness.prepare.preparePhotoV3({
      mode: 'retry',
      projectId: predecessor.project.id,
      expectedAuthoringRevision: predecessor.project.authoringRevision,
      pieceId: predecessor.firstConfirmed.pieceId,
      sourceJobId: predecessor.firstConfirmed.jobId,
    });

    const retried = await confirmPrepared(harness, retry);
    const afterRetry = await harness.store.loadProjectV3(predecessor.project.id);

    expect(retried.authoringRevision).toBe(predecessor.project.authoringRevision);
    expect(afterRetry.authoringRevision).toBe(predecessor.project.authoringRevision);
    expect(harness.preparedPhotos.list(afterRetry.id)).toEqual([
      expect.objectContaining({ reservationId: unrelatedCreate.quote.reservationId, mode: 'create' }),
    ]);
    await expect(
      harness.prepare.preparePhotoV3({
        mode: 'retry',
        projectId: afterRetry.id,
        expectedAuthoringRevision: afterRetry.authoringRevision,
        pieceId: predecessor.firstConfirmed.pieceId,
        sourceJobId: predecessor.firstConfirmed.jobId,
      })
    ).rejects.toMatchObject({ code: 'job_ineligible' });

    const created = await confirmPrepared(harness, unrelatedCreate);
    expect(created.authoringRevision).toBe(afterRetry.authoringRevision + 1);
    expect((await harness.store.loadProjectV3(afterRetry.id)).pieceOrder).toHaveLength(2);
  });

  it('keeps a prepared retry for another Piece valid while refusing the consumed source lineage', async () => {
    const harness = await createHarness({ policy: 'within_cap' });
    const first = await createRetryablePiece(harness, 'provider_unavailable');
    const second = await createRetryablePiece(harness, 'provider_unavailable');
    const firstRetry = await harness.prepare.preparePhotoV3({
      mode: 'retry',
      projectId: second.project.id,
      expectedAuthoringRevision: second.project.authoringRevision,
      pieceId: first.firstConfirmed.pieceId,
      sourceJobId: first.firstConfirmed.jobId,
    });
    const secondRetry = await harness.prepare.preparePhotoV3({
      mode: 'retry',
      projectId: second.project.id,
      expectedAuthoringRevision: second.project.authoringRevision,
      pieceId: second.firstConfirmed.pieceId,
      sourceJobId: second.firstConfirmed.jobId,
    });

    const firstResult = await confirmPrepared(harness, firstRetry);
    const afterFirstRetry = await harness.store.loadProjectV3(second.project.id);

    expect(firstResult.authoringRevision).toBe(second.project.authoringRevision);
    expect(afterFirstRetry.authoringRevision).toBe(second.project.authoringRevision);
    expect(harness.preparedPhotos.list(afterFirstRetry.id)).toEqual([
      expect.objectContaining({ reservationId: secondRetry.quote.reservationId, mode: 'retry' }),
    ]);
    await expect(
      harness.prepare.preparePhotoV3({
        mode: 'retry',
        projectId: afterFirstRetry.id,
        expectedAuthoringRevision: afterFirstRetry.authoringRevision,
        pieceId: first.firstConfirmed.pieceId,
        sourceJobId: first.firstConfirmed.jobId,
      })
    ).rejects.toMatchObject({ code: 'job_ineligible' });

    const secondResult = await confirmPrepared(harness, secondRetry);
    expect(secondResult.authoringRevision).toBe(second.project.authoringRevision);
    expect((await harness.store.loadProjectV3(afterFirstRetry.id)).authoringRevision).toBe(
      second.project.authoringRevision
    );
  });

  it('refuses expiry, cap removal/reduction, and currency changes before creating authorization or Job', async () => {
    const expired = await createHarness({ policy: 'within_cap' });
    const expiredPrepared = await prepareCreate(expired);
    expired.advance(5 * 60 * 1_000);
    await expect(confirmPrepared(expired, expiredPrepared)).rejects.toMatchObject({ code: 'quote_not_found' });
    expect((await expired.store.loadProjectV3(expired.project().id)).pieceOrder).toEqual([]);
    expect(expired.dispatch).not.toHaveBeenCalled();

    const policy = await createHarness({ policy: 'within_cap' });
    const policyPrepared = await prepareCreate(policy);
    const changed = await policy.store.updateProjectV3(
      policy.project().id,
      (draft) => ({ ...draft, spendPolicy: null }),
      { kind: 'authoring', expectedRevision: policy.project().revision }
    );
    policy.setProject(changed);
    await expect(confirmPrepared(policy, policyPrepared)).rejects.toMatchObject({ code: 'stale_quote' });
    expect(policy.dispatch).not.toHaveBeenCalled();

    for (const spendPolicy of [
      { currency: 'USD', maxPerBatchMinorUnits: 2 },
      { currency: 'EUR', maxPerBatchMinorUnits: 3 },
    ]) {
      const changedPolicy = await createHarness({ policy: 'within_cap' });
      const prepared = await prepareCreate(changedPolicy);
      const changedProject = await changedPolicy.store.updateProjectV3(
        changedPolicy.project().id,
        (draft) => ({ ...draft, spendPolicy }),
        { kind: 'authoring', expectedRevision: changedPolicy.project().revision }
      );
      changedPolicy.setProject(changedProject);
      await expect(confirmPrepared(changedPolicy, prepared)).rejects.toMatchObject({ code: 'stale_quote' });
      expect(changedPolicy.dispatch).not.toHaveBeenCalled();
      expect((await changedPolicy.store.loadProjectV3(changedProject.id)).spendAuthorizations).toEqual([]);
    }
  });

  it('retries the same Piece through a fresh exact quote, authorization, and predecessor link', async () => {
    const harness = await createHarness({ policy: 'within_cap' });
    const first = await createRetryablePiece(harness, 'provider_unavailable');

    const retry = await harness.prepare.preparePhotoV3({
      mode: 'retry',
      projectId: first.project.id,
      expectedAuthoringRevision: first.project.authoringRevision,
      pieceId: first.firstConfirmed.pieceId,
      sourceJobId: first.firstConfirmed.jobId,
    });
    expect(retry.quote).toMatchObject({
      mode: 'retry',
      targetPieceId: first.firstConfirmed.pieceId,
      proposedHandle: null,
      lowerMinorUnits: first.firstPrepared.quote.lowerMinorUnits,
      upperMinorUnits: first.firstPrepared.quote.upperMinorUnits,
      requiresExplicitHumanAction: false,
      duplicateChargeAcknowledgementRequired: false,
    });
    expect(retry.quote.quoteId).not.toBe(first.firstPrepared.quote.quoteId);

    const result = await confirmPrepared(harness, retry);
    const reloaded = await harness.store.loadProjectV3(first.project.id);
    expect(reloaded.pieceOrder).toEqual([first.firstConfirmed.pieceId]);
    expect(reloaded.pieces[first.firstConfirmed.pieceId]?.jobIds).toEqual([first.firstConfirmed.jobId, result.jobId]);
    expect(reloaded.jobs[result.jobId]).toMatchObject({
      retryOfJobId: first.firstConfirmed.jobId,
      retryReason: 'provider_failure',
      status: 'queued_local',
    });
    expect(reloaded.pieces[first.firstConfirmed.pieceId]).toMatchObject({
      id: first.firstConfirmed.pieceId,
      handle: first.project.pieces[first.firstConfirmed.pieceId]!.handle,
      currentAssetId: first.project.pieces[first.firstConfirmed.pieceId]!.currentAssetId,
    });
    expect(reloaded.spendAuthorizations).toHaveLength(2);
    const restarted = createCreativeStudioPilotStoreV3({ rootDir: harness.root });
    const restartedProject = await restarted.loadProjectV3(first.project.id);
    expect(restartedProject.pieces[first.firstConfirmed.pieceId]?.jobIds).toEqual([
      first.firstConfirmed.jobId,
      result.jobId,
    ]);
    expect(restartedProject.jobs[result.jobId]).toMatchObject({
      retryOfJobId: first.firstConfirmed.jobId,
      retryReason: 'provider_failure',
    });
    restarted.close();
    await expect(confirmPrepared(harness, first.firstPrepared)).rejects.toMatchObject({ code: 'quote_not_found' });
  });

  it('requires and persists exact duplicate-charge acknowledgement for submission_unknown retry', async () => {
    const harness = await createHarness({ policy: 'within_cap' });
    const first = await createRetryablePiece(harness, 'submission_unknown');
    const retry = await harness.prepare.preparePhotoV3({
      mode: 'retry',
      projectId: first.project.id,
      expectedAuthoringRevision: first.project.authoringRevision,
      pieceId: first.firstConfirmed.pieceId,
      sourceJobId: first.firstConfirmed.jobId,
    });
    expect(retry.quote).toMatchObject({
      requiresExplicitHumanAction: true,
      duplicateChargeAcknowledgementRequired: true,
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

    const confirmed = await confirmPrepared(harness, retry);
    const reloaded = await harness.store.loadProjectV3(first.project.id);
    expect(reloaded.jobs[confirmed.jobId]).toMatchObject({
      retryReason: 'submission_unknown',
      duplicateChargeAcknowledged: true,
      duplicateChargeAcknowledgedAt: expect.any(String),
    });
  });

  it('fails closed for edited retry input, a second child, completed work, and imported targets', async () => {
    const harness = await createHarness({ policy: 'within_cap' });
    const first = await createRetryablePiece(harness, 'provider_unavailable');

    await expect(
      harness.prepare.preparePhotoV3({
        mode: 'retry',
        projectId: first.project.id,
        expectedAuthoringRevision: first.project.authoringRevision,
        pieceId: first.firstConfirmed.pieceId,
        sourceJobId: first.firstConfirmed.jobId,
        words: 'replacement wording',
      })
    ).rejects.toMatchObject({ code: 'invalid_payload' });

    const retry = await harness.prepare.preparePhotoV3({
      mode: 'retry',
      projectId: first.project.id,
      expectedAuthoringRevision: first.project.authoringRevision,
      pieceId: first.firstConfirmed.pieceId,
      sourceJobId: first.firstConfirmed.jobId,
    });
    await confirmPrepared(harness, retry);
    const withChild = await harness.store.loadProjectV3(first.project.id);
    harness.setProject(withChild);
    await expect(
      harness.prepare.preparePhotoV3({
        mode: 'retry',
        projectId: first.project.id,
        expectedAuthoringRevision: withChild.authoringRevision,
        pieceId: first.firstConfirmed.pieceId,
        sourceJobId: first.firstConfirmed.jobId,
      })
    ).rejects.toMatchObject({ code: 'job_ineligible' });

    const latestJobId = withChild.pieces[first.firstConfirmed.pieceId]!.jobIds.at(-1)!;
    const completed = await harness.store.updateProjectV3(
      withChild.id,
      (draft) => {
        const job = draft.jobs[latestJobId]!;
        const authorization = draft.spendAuthorizations.find((candidate) => candidate.id === job.authorizationId)!;
        job.status = 'succeeded';
        job.providerSubmissionKind = 'remote';
        job.providerJobId = 'provider_job_completed';
        job.remoteStartedAt = job.createdAt;
        job.outputAssetId = 'asset_completed';
        job.progress = 100;
        job.error = null;
        job.spendReceipt = {
          authorizationId: authorization.id,
          quoteId: authorization.quote.id,
          quoteRevision: authorization.quote.quoteRevision,
          itemId: authorization.quote.item.id,
          jobId: job.id,
          purpose: 'piece_image',
          routeId: authorization.quote.item.routeId,
          currency: authorization.quote.currency,
          rateUnit: 'generation',
          rateMinorUnits: authorization.quote.item.rateMinorUnits,
          generationCount: 1,
          totalMinorUnits: authorization.quote.item.rateMinorUnits,
          recordedAt: job.createdAt,
        };
        draft.assets.asset_completed = {
          id: 'asset_completed',
          projectId: draft.id,
          pieceId: first.firstConfirmed.pieceId,
          mediaKind: 'image',
          mimeType: 'image/png',
          managedAsset: { collection: 'assets', fileName: 'asset_completed.png' },
          byteSize: 68,
          sha256: 'e'.repeat(64),
          width: 1,
          height: 1,
          createdAt: draft.updatedAt,
          origin: 'generated',
          producerJobId: job.id,
          compositionDigest: studioPieceGenerationCompositionDigestV3(job.composition),
        };
        draft.pieces[first.firstConfirmed.pieceId]!.currentAssetId = 'asset_completed';
        draft.pieces[first.firstConfirmed.pieceId]!.updatedAt = draft.updatedAt;
        return draft;
      },
      { kind: 'runtime', expectedRevision: withChild.revision }
    );
    harness.setProject(completed);
    await expect(
      harness.prepare.preparePhotoV3({
        mode: 'retry',
        projectId: completed.id,
        expectedAuthoringRevision: completed.authoringRevision,
        pieceId: first.firstConfirmed.pieceId,
        sourceJobId: latestJobId,
      })
    ).rejects.toMatchObject({ code: 'job_ineligible' });

    const imported = await harness.store.updateProjectV3(
      completed.id,
      (draft) => {
        draft.pieceOrder.push('piece_imported');
        draft.pieces.piece_imported = {
          id: 'piece_imported',
          kind: 'photograph',
          handle: 'imported_photo',
          priorHandles: [],
          currentAssetId: 'asset_imported',
          jobIds: [],
          createdAt: draft.updatedAt,
          updatedAt: draft.updatedAt,
        };
        draft.assets.asset_imported = {
          id: 'asset_imported',
          projectId: draft.id,
          pieceId: 'piece_imported',
          mediaKind: 'image',
          mimeType: 'image/png',
          managedAsset: { collection: 'imports', fileName: 'asset_imported.png' },
          byteSize: 68,
          sha256: 'f'.repeat(64),
          width: 1,
          height: 1,
          createdAt: draft.updatedAt,
          origin: 'imported',
          producerJobId: null,
          compositionDigest: null,
        };
        return draft;
      },
      { kind: 'authoring', expectedRevision: completed.revision }
    );
    harness.setProject(imported);
    await expect(
      harness.prepare.preparePhotoV3({
        mode: 'retry',
        projectId: imported.id,
        expectedAuthoringRevision: imported.authoringRevision,
        pieceId: 'piece_imported',
        sourceJobId: latestJobId,
      })
    ).rejects.toMatchObject({ code: 'job_ineligible' });
  });
});
