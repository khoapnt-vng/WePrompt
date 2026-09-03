/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment node
 */

import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  STUDIO_PROJECT_SCHEMA_VERSION_V4,
  type StudioAssetV3,
  type StudioPieceGenerationCompositionV3,
  type StudioPieceGenerationCompositionV4,
  type StudioPieceGenerationRequestPlanV3,
  type StudioPieceGenerationRequestPlanV4,
  type StudioPieceJobV3,
  type StudioPieceSpendAuthorizationV3,
  type StudioPieceSubmissionQuoteV3,
  type StudioProjectV3,
  type StudioProjectV4,
} from '@/common/types/project/creativeStudioTypes';
import {
  buildStudioPieceExportManifestV3,
  parseStudioPieceExportManifestV3,
  serializeStudioPieceExportManifestV3,
  validateStudioPieceExportConsistencyV3,
} from '@/process/services/creative-studio/service/schema2/exports/pieceManifestV3';
import {
  buildStudioPieceExportManifestV4,
  parseStudioPieceExportManifestV4,
  serializeStudioPieceExportManifestV4,
  validateStudioPieceExportConsistencyV4,
} from '@/process/services/creative-studio/service/schema2/exports/pieceManifestV4';
import { createEmptyStudioProjectV3 } from '@/process/services/creative-studio/service/schema2/factories';
import { createStudioPieceQuotedGenerationIdV3 } from '@/process/services/creative-studio/service/schema2/generation/submission/v3';
import {
  createStudioPieceQuotedGenerationIdV4,
  studioPieceGenerationCompositionDigestV4,
  validateStudioProjectV3,
  validateStudioProjectV4,
} from '@/process/services/creative-studio/service/schema2/validation';
import { makePhase6Project, PHASE_6_CURRENT_AT } from '../../../../../../fixtures/creative-studio/phase6Project';

const T0 = '2026-08-30T00:00:00.000Z';
const T1 = '2026-08-30T00:00:01.000Z';
const T2 = '2026-08-30T00:00:02.000Z';
const T3 = '2026-08-30T00:00:03.000Z';
const PHASE_6_EXPORTED_AT = '2026-09-02T00:00:03.000Z';
const digest = 'a'.repeat(64);
const provider = { providerId: 'provider_1', adapterId: 'weprompt-image-v1', model: 'model_1' } as const;
const canonicalJson = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .toSorted()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(',')}}`;
};

const importedProject = (): StudioProjectV3 => {
  const project = createEmptyStudioProjectV3({ name: 'Pilot', brief: '' }, 'project_1', T0);
  const asset: StudioAssetV3 = {
    id: 'asset_1',
    projectId: project.id,
    pieceId: 'piece_1',
    mediaKind: 'image',
    mimeType: 'image/png',
    managedAsset: { collection: 'imports', fileName: 'asset_1.png' },
    byteSize: 8,
    sha256: digest,
    width: 800,
    height: 600,
    createdAt: T2,
    origin: 'imported',
    producerJobId: null,
    compositionDigest: null,
  };
  project.pieceOrder = ['piece_1'];
  project.pieces.piece_1 = {
    id: 'piece_1',
    kind: 'photograph',
    handle: 'ảnh_đêm',
    priorHandles: [],
    currentAssetId: asset.id,
    jobIds: [],
    createdAt: T1,
    updatedAt: T2,
  };
  project.assets[asset.id] = asset;
  project.revision = 2;
  project.authoringRevision = 2;
  project.updatedAt = T2;
  expect(validateStudioProjectV3(project)).toBe(true);
  return project;
};

const generatedProject = (): StudioProjectV3 => {
  const project = createEmptyStudioProjectV3({ name: 'Pilot', brief: 'A quiet portrait' }, 'project_1', T0);
  const composition: StudioPieceGenerationCompositionV3 = {
    inputs: {
      schemaVersion: 3,
      projectRevisionAtPreparation: 1,
      authoringRevision: 1,
      authoringFingerprintVersion: 2,
      authoringFingerprint: digest,
      brief: project.brief,
      rules: [],
      source: {
        kind: 'piece',
        pieceId: 'piece_1',
        words: 'A quiet portrait',
        settings: { aspectRatio: '4:3', resolution: '1080p' },
      },
      purpose: 'piece_image',
      conditioningInputs: [],
      route: provider,
      instructionProfile: 'weprompt-image-v1.piece-image.v2',
    },
    prompt: 'A quiet portrait, soft window light.',
  };
  const requestPlan: StudioPieceGenerationRequestPlanV3 = {
    kind: 'resolved',
    snapshot: {
      composition,
      settings: { aspectRatio: '4:3', resolution: '1080p' },
      conditioningInputs: [],
    },
  };
  const quoteId = 'quote_1';
  const itemId = createStudioPieceQuotedGenerationIdV3({
    projectId: project.id,
    reservationId: 'reservation_1',
    quoteId,
    quoteRevision: 1,
    target: { kind: 'piece', pieceId: 'piece_1' },
    purpose: 'piece_image',
  });
  const quote: StudioPieceSubmissionQuoteV3 = {
    id: quoteId,
    reservationId: 'reservation_1',
    quoteRevision: 1,
    projectId: project.id,
    projectRevisionAtPreparation: 1,
    authoringRevision: 1,
    authoringFingerprintVersion: 2,
    authoringFingerprint: digest,
    rateCardDigest: 'b'.repeat(64),
    currency: 'USD',
    item: {
      id: itemId,
      target: { kind: 'piece', pieceId: 'piece_1' },
      purpose: 'piece_image',
      routeId: 'route_1',
      generationCount: 1,
      requestPlan,
      rateUnit: 'generation',
      rateMinorUnits: 125,
    },
    lowerMinorUnits: 125,
    upperMinorUnits: 125,
    expiresAt: '2026-08-30T00:05:00.000Z',
  };
  const authorization: StudioPieceSpendAuthorizationV3 = {
    id: 'authorization_1',
    quote,
    confirmedAt: T1,
    projectRevisionAtAuthorization: 2,
    cancellationPolicy: 'queued_and_running',
    providerBinding: { itemId: quote.item.id, provider },
    idempotencyKey: { itemId: quote.item.id, key: 'idempotency_1' },
  };
  const receipt = {
    authorizationId: authorization.id,
    quoteId: quote.id,
    quoteRevision: quote.quoteRevision,
    itemId: quote.item.id,
    jobId: 'job_1',
    purpose: 'piece_image',
    routeId: quote.item.routeId,
    currency: quote.currency,
    rateUnit: 'generation',
    rateMinorUnits: quote.item.rateMinorUnits,
    generationCount: 1,
    totalMinorUnits: quote.item.rateMinorUnits,
    recordedAt: T2,
  } as const;
  const job: StudioPieceJobV3 = {
    id: 'job_1',
    projectId: project.id,
    target: { kind: 'piece', pieceId: 'piece_1' },
    purpose: 'piece_image',
    status: 'succeeded',
    provider,
    idempotencyKey: 'idempotency_1',
    providerSubmissionKind: 'remote',
    providerJobId: 'provider_job_1',
    remoteStartedAt: T1,
    cancellationPolicy: 'queued_and_running',
    outputAssetId: 'asset_1',
    error: null,
    progress: 100,
    retryOfJobId: null,
    retryReason: null,
    duplicateChargeAcknowledged: false,
    duplicateChargeAcknowledgedAt: null,
    authorizationId: authorization.id,
    authorizationItemId: quote.item.id,
    composition,
    requestPlan,
    spendReceipt: receipt,
    authoringRevision: 1,
    authoringFingerprintVersion: 2,
    authoringFingerprint: digest,
    projectRevisionAtPreparation: 1,
    projectRevisionAtAuthorization: 2,
    createdAt: T1,
    updatedAt: T2,
  };
  const asset: StudioAssetV3 = {
    id: 'asset_1',
    projectId: project.id,
    pieceId: 'piece_1',
    mediaKind: 'image',
    mimeType: 'image/png',
    managedAsset: { collection: 'assets', fileName: 'asset_1.png' },
    byteSize: 8,
    sha256: 'c'.repeat(64),
    width: 800,
    height: 600,
    createdAt: T2,
    origin: 'generated',
    producerJobId: job.id,
    compositionDigest: createHash('sha256').update(canonicalJson(composition), 'utf8').digest('hex'),
  };
  project.revision = 3;
  project.authoringRevision = 2;
  project.updatedAt = T2;
  project.pieceOrder = ['piece_1'];
  project.pieces.piece_1 = {
    id: 'piece_1',
    kind: 'photograph',
    handle: 'quiet_portrait',
    priorHandles: [],
    currentAssetId: asset.id,
    jobIds: [job.id],
    createdAt: T1,
    updatedAt: T2,
  };
  project.spendAuthorizations = [authorization];
  project.assets[asset.id] = asset;
  project.jobs[job.id] = job;
  expect(validateStudioProjectV3(project)).toBe(true);
  return project;
};

const build = (project: StudioProjectV3) =>
  buildStudioPieceExportManifestV3(project, {
    exportId: 'export_1',
    pieceId: 'piece_1',
    relativePath: `${project.pieces.piece_1!.handle}.png`,
    exportedAt: T3,
  });

const schemaSevenProject = (project: StudioProjectV3): StudioProjectV4 => {
  const snapshot = structuredClone(project);
  const compositionByJobId = new Map<string, StudioPieceGenerationCompositionV4>();
  const requestByJobId = new Map<string, StudioPieceGenerationRequestPlanV4>();
  for (const [jobId, job] of Object.entries(snapshot.jobs)) {
    const settings = { kind: 'photograph' as const, ...job.composition.inputs.source.settings };
    const composition: StudioPieceGenerationCompositionV4 = {
      ...job.composition,
      inputs: {
        ...job.composition.inputs,
        schemaVersion: 4,
        authoringFingerprintVersion: 3,
        source: { ...job.composition.inputs.source, settings },
      },
    };
    compositionByJobId.set(jobId, composition);
    requestByJobId.set(jobId, {
      kind: 'resolved',
      snapshot: { composition, settings, conditioningInputs: [...job.requestPlan.snapshot.conditioningInputs] },
    });
  }
  const spendAuthorizations = snapshot.spendAuthorizations.map((authorization) => {
    const sourceJob = Object.values(snapshot.jobs).find((job) => job.authorizationId === authorization.id)!;
    const publication = { schemaVersion: 1 as const, kind: 'fill_empty' as const };
    const attempt =
      sourceJob.retryOfJobId === null
        ? ({ kind: 'first' } as const)
        : ({ kind: 'retry', sourceJobId: sourceJob.retryOfJobId, reason: sourceJob.retryReason! } as const);
    const itemId = createStudioPieceQuotedGenerationIdV4({
      projectId: snapshot.id,
      reservationId: authorization.quote.reservationId,
      quoteId: authorization.quote.id,
      quoteRevision: authorization.quote.quoteRevision,
      target: sourceJob.target,
      purpose: 'piece_image',
    });
    return {
      ...authorization,
      quote: {
        ...authorization.quote,
        authoringFingerprintVersion: 3 as const,
        item: {
          ...authorization.quote.item,
          id: itemId,
          requestPlan: requestByJobId.get(sourceJob.id)!,
          publication,
          attempt,
        },
      },
      providerBinding: { ...authorization.providerBinding, itemId },
      idempotencyKey: { ...authorization.idempotencyKey, itemId },
    };
  });
  const jobs = Object.fromEntries(
    Object.entries(snapshot.jobs).map(([jobId, job]) => {
      const {
        outputAssetId,
        retryOfJobId: _retryOfJobId,
        retryReason: _retryReason,
        composition: _composition,
        requestPlan: _requestPlan,
        ...base
      } = job;
      const authorization = spendAuthorizations.find((candidate) => candidate.id === job.authorizationId)!;
      return [
        jobId,
        {
          ...base,
          outputAssetIdsByRole: { primary: outputAssetId, poster: null },
          publication: authorization.quote.item.publication,
          attempt: authorization.quote.item.attempt,
          authorizationItemId: authorization.quote.item.id,
          composition: compositionByJobId.get(jobId)!,
          requestPlan: requestByJobId.get(jobId)!,
          spendReceipt: job.spendReceipt === null ? null : { ...job.spendReceipt, itemId: authorization.quote.item.id },
          authoringFingerprintVersion: 3 as const,
        },
      ];
    })
  ) as StudioProjectV4['jobs'];
  const value: StudioProjectV4 = {
    ...snapshot,
    schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION_V4,
    pieces: Object.fromEntries(
      Object.entries(snapshot.pieces).map(([pieceId, piece]) => [
        pieceId,
        { ...piece, runStem: null, assetHistory: [] },
      ])
    ),
    spendAuthorizations,
    assets: Object.fromEntries(
      Object.entries(snapshot.assets).map(([assetId, asset]) => {
        const producer = asset.producerJobId === null ? null : jobs[asset.producerJobId];
        return [
          assetId,
          {
            ...asset,
            role: 'primary' as const,
            compositionDigest:
              producer === null || producer === undefined
                ? null
                : studioPieceGenerationCompositionDigestV4(producer.composition),
          },
        ];
      })
    ) as StudioProjectV4['assets'],
    jobs,
    frameExtractions: {},
    derivedFrames: {},
    boardOrder: [],
    boards: {},
    assemblyOrder: [],
    assemblies: {},
    bin: [],
  };
  expect(validateStudioProjectV4(value)).toBe(true);
  return value;
};

const buildV4 = (project: StudioProjectV4) =>
  buildStudioPieceExportManifestV4(project, {
    exportId: 'export_1',
    pieceId: 'piece_1',
    relativePath: `${project.pieces.piece_1!.handle}.png`,
    exportedAt: T3,
  });

describe('schema-3 standalone Piece export manifest', () => {
  it('builds exact imported provenance and serializes deterministic canonical bytes', () => {
    const project = importedProject();
    const manifest = build(project);
    expect(manifest).toMatchObject({
      schemaVersion: 3,
      projectId: project.id,
      sourceRevision: project.revision,
      piece: { id: 'piece_1', handleAtExport: 'ảnh_đêm' },
      provenance: { origin: 'imported' },
    });
    expect(validateStudioPieceExportConsistencyV3(project, manifest)).toBe(true);

    const reordered = {
      exportedAt: manifest.exportedAt,
      provenance: manifest.provenance,
      asset: manifest.asset,
      piece: manifest.piece,
      sourceRevision: manifest.sourceRevision,
      projectId: manifest.projectId,
      exportId: manifest.exportId,
      schemaVersion: manifest.schemaVersion,
    };
    const bytes = serializeStudioPieceExportManifestV3(manifest);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(
      '315cfb0de8ad63ac079c36ea55f632ad609530ca04402822ef357a74d7c9499e'
    );
    expect(serializeStudioPieceExportManifestV3(reordered)).toEqual(bytes);
    expect(parseStudioPieceExportManifestV3(bytes)).toEqual(manifest);
    expect(Buffer.from(bytes).toString('utf8').endsWith('\n')).toBe(false);
  });

  it('rejects noncanonical bytes, extra keys, and accessors without invoking them', () => {
    const manifest = build(importedProject());
    expect(() => parseStudioPieceExportManifestV3(Buffer.from(JSON.stringify(manifest), 'utf8'))).toThrow(
      expect.objectContaining({ code: 'invalid_manifest' })
    );
    const canonical = serializeStudioPieceExportManifestV3(manifest);
    expect(() => parseStudioPieceExportManifestV3(Buffer.concat([canonical, Buffer.from('\n')]))).toThrow(
      expect.objectContaining({ code: 'invalid_manifest' })
    );
    expect(() => parseStudioPieceExportManifestV3(new Proxy(canonical, {}))).toThrow(
      expect.objectContaining({ code: 'invalid_manifest' })
    );
    expect(() => serializeStudioPieceExportManifestV3({ ...manifest, absolutePath: '/secret' })).toThrow(
      expect.objectContaining({ code: 'invalid_manifest' })
    );

    let getterCalls = 0;
    const hostile = { ...manifest };
    Object.defineProperty(hostile, 'asset', {
      enumerable: true,
      get() {
        getterCalls += 1;
        return manifest.asset;
      },
    });
    expect(() => serializeStudioPieceExportManifestV3(hostile)).toThrow(
      expect.objectContaining({ code: 'invalid_manifest' })
    );
    expect(getterCalls).toBe(0);
  });

  it('rejects accessor-backed build identity without selecting either Piece', () => {
    const project = importedProject();
    let getterCalls = 0;
    const input = {
      exportId: 'export_1',
      relativePath: 'piece.png',
      exportedAt: T3,
    } as Record<string, unknown>;
    Object.defineProperty(input, 'pieceId', {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        return 'piece_1';
      },
    });

    expect(() => buildStudioPieceExportManifestV3(project, input as never)).toThrow(
      expect.objectContaining({ code: 'inconsistent_manifest' })
    );
    expect(getterCalls).toBe(0);

    let nestedGetterCalls = 0;
    const nested = {} as Record<string, unknown>;
    Object.defineProperty(nested, 'value', {
      enumerable: true,
      get: () => {
        nestedGetterCalls += 1;
        return 'export_1';
      },
    });
    expect(() =>
      buildStudioPieceExportManifestV3(project, {
        exportId: nested,
        pieceId: 'piece_1',
        relativePath: 'piece.png',
        exportedAt: T3,
      } as never)
    ).toThrow(expect.objectContaining({ code: 'inconsistent_manifest' }));
    expect(nestedGetterCalls).toBe(0);
  });

  it.each(['ảnh_đêm/شب_تهران.png', '東京_夜.png', '서울/밤_사진.webp'])(
    'accepts an NFKC-safe Unicode relative path: %s',
    (relativePath) => {
      const project = importedProject();
      const manifest = buildStudioPieceExportManifestV3(project, {
        exportId: 'export_1',
        pieceId: 'piece_1',
        relativePath,
        exportedAt: T3,
      });
      expect(parseStudioPieceExportManifestV3(serializeStudioPieceExportManifestV3(manifest))).toEqual(manifest);
    }
  );

  it('accepts a 1,024-byte relative path and rejects 1,025 bytes independently of segment bounds', () => {
    const atLimit = ['a'.repeat(256), 'b'.repeat(255), 'c'.repeat(255), 'd'.repeat(255)].join('/');
    const overLimit = ['a'.repeat(256), 'b'.repeat(256), 'c'.repeat(255), 'd'.repeat(255)].join('/');
    expect(Buffer.byteLength(atLimit, 'utf8')).toBe(1_024);
    expect(Buffer.byteLength(overLimit, 'utf8')).toBe(1_025);
    expect(overLimit.split('/').every((segment) => [...segment].length <= 256)).toBe(true);

    const project = importedProject();
    const manifest = buildStudioPieceExportManifestV3(project, {
      exportId: 'export_1',
      pieceId: 'piece_1',
      relativePath: atLimit,
      exportedAt: T3,
    });
    expect(parseStudioPieceExportManifestV3(serializeStudioPieceExportManifestV3(manifest))).toEqual(manifest);
    expect(() =>
      serializeStudioPieceExportManifestV3({
        ...manifest,
        asset: { ...manifest.asset, relativePath: overLimit },
      })
    ).toThrow(expect.objectContaining({ code: 'invalid_manifest' }));
  });

  it('rejects bytes above the 1 MiB parser preflight without attempting JSON parsing', () => {
    const jsonParse = vi.spyOn(JSON, 'parse').mockImplementation(() => {
      throw new SyntaxError('boundary probe');
    });
    try {
      expect(() => parseStudioPieceExportManifestV3(Buffer.alloc(1_048_576, 0x20))).toThrow(
        expect.objectContaining({ code: 'invalid_manifest' })
      );
      expect(jsonParse).toHaveBeenCalledOnce();

      jsonParse.mockClear();
      expect(() => parseStudioPieceExportManifestV3(Buffer.alloc(1_048_577, 0x20))).toThrow(
        expect.objectContaining({ code: 'invalid_manifest' })
      );
      expect(jsonParse).not.toHaveBeenCalled();
    } finally {
      jsonParse.mockRestore();
    }
  });

  it.each([
    '/absolute.png',
    'C:/escape.png',
    'C:escape.png',
    'folder\\escape.png',
    '../escape.png',
    'folder/../escape.png',
    'folder//escape.png',
    'NUL.png',
    'con',
    'COM1.jpg',
    'trailing.',
    'trailing ',
    'nul\u0000.png',
    'spoof\u202Egnp.exe',
    'a\u0301nh.png',
    'one/two/three/four/five.png',
    'question?.png',
    'star*.png',
    'colon:name.png',
    'less<than.png',
    'greater>than.png',
    'pipe|name.png',
    'quote"name.png',
  ])('rejects a hostile or noncanonical relative path: %s', (relativePath) => {
    const manifest = build(importedProject());
    expect(() =>
      serializeStudioPieceExportManifestV3({
        ...manifest,
        asset: { ...manifest.asset, relativePath },
      })
    ).toThrow(expect.objectContaining({ code: 'invalid_manifest' }));
  });

  it('fails consistency when owner, current asset, hash, handle, or source revision changes', () => {
    const project = importedProject();
    const manifest = build(project);
    const mutations = [
      { ...manifest, sourceRevision: manifest.sourceRevision + 1 },
      { ...manifest, piece: { ...manifest.piece, id: 'piece_missing' } },
      { ...manifest, piece: { ...manifest.piece, handleAtExport: 'changed' } },
      { ...manifest, asset: { ...manifest.asset, id: 'asset_missing' } },
      { ...manifest, asset: { ...manifest.asset, sha256: 'b'.repeat(64) } },
    ];
    for (const changed of mutations) expect(validateStudioPieceExportConsistencyV3(project, changed)).toBe(false);
  });

  it('freezes exact generated Job, quote, provider, composition, request, and receipt provenance', () => {
    const project = generatedProject();
    const manifest = build(project);
    expect(manifest.provenance.origin).toBe('generated');
    expect(validateStudioPieceExportConsistencyV3(project, manifest)).toBe(true);
    if (manifest.provenance.origin !== 'generated') throw new Error('Expected generated provenance');
    expect(manifest.provenance).toMatchObject({
      producerJobId: 'job_1',
      authorizationId: 'authorization_1',
      quoteId: 'quote_1',
      quoteRevision: 1,
      provider,
    });

    const changedProvider = structuredClone(manifest);
    if (changedProvider.provenance.origin !== 'generated') throw new Error('Expected generated provenance');
    changedProvider.provenance.provider.model = 'different_model';
    expect(validateStudioPieceExportConsistencyV3(project, changedProvider)).toBe(false);

    const changedPrompt = structuredClone(manifest);
    if (changedPrompt.provenance.origin !== 'generated') throw new Error('Expected generated provenance');
    changedPrompt.provenance.composition.prompt = 'Unrecorded prompt';
    changedPrompt.provenance.requestPlan.snapshot.composition.prompt = 'Unrecorded prompt';
    expect(validateStudioPieceExportConsistencyV3(project, changedPrompt)).toBe(false);
  });
});

describe('schema-7 project to exact export-4 protocol', () => {
  it('keeps export 3 and export 4 disjoint at every builder, parser, and consistency entry point', () => {
    const schemaSix = importedProject();
    const schemaSeven = schemaSevenProject(schemaSix);
    const fromSix = build(schemaSix);
    const fromSeven = buildV4(schemaSeven);

    expect(fromSeven).toEqual({ ...fromSix, schemaVersion: 4 });
    expect(fromSeven.schemaVersion).toBe(4);
    expect(validateStudioPieceExportConsistencyV4(schemaSeven, fromSeven)).toBe(true);
    expect(validateStudioPieceExportConsistencyV3(schemaSeven as never, fromSeven)).toBe(false);
    expect(validateStudioPieceExportConsistencyV4(schemaSix as never, fromSix)).toBe(false);
    expect(() => parseStudioPieceExportManifestV3(serializeStudioPieceExportManifestV4(fromSeven))).toThrow(
      expect.objectContaining({ code: 'invalid_manifest' })
    );
    expect(() => parseStudioPieceExportManifestV4(serializeStudioPieceExportManifestV3(fromSix))).toThrow(
      expect.objectContaining({ code: 'invalid_manifest' })
    );
    expect(() => serializeStudioPieceExportManifestV3(fromSeven)).toThrow(
      expect.objectContaining({ code: 'invalid_manifest' })
    );
    expect(() => serializeStudioPieceExportManifestV4(fromSix)).toThrow(
      expect.objectContaining({ code: 'invalid_manifest' })
    );
    expect(() =>
      buildStudioPieceExportManifestV3(schemaSeven as never, {
        exportId: 'export_cross_schema',
        pieceId: 'piece_1',
        relativePath: 'photo.png',
        exportedAt: T3,
      })
    ).toThrow(expect.objectContaining({ code: 'inconsistent_manifest' }));
    expect(() =>
      buildStudioPieceExportManifestV4(schemaSix as never, {
        exportId: 'export_cross_schema',
        pieceId: 'piece_1',
        relativePath: 'photo.png',
        exportedAt: T3,
      })
    ).toThrow(expect.objectContaining({ code: 'inconsistent_manifest' }));
  });

  it('freezes complete generated provenance and fails closed for every correlated authority change', () => {
    const schemaSix = generatedProject();
    const project = schemaSevenProject(schemaSix);
    const manifest = buildV4(project);
    const schemaSixManifest = build(schemaSix);
    expect(manifest).not.toEqual(schemaSixManifest);
    expect(serializeStudioPieceExportManifestV4(manifest)).not.toEqual(
      serializeStudioPieceExportManifestV3(schemaSixManifest)
    );
    expect(manifest.provenance.origin).toBe('generated');
    expect(validateStudioPieceExportConsistencyV4(project, manifest)).toBe(true);
    if (manifest.provenance.origin !== 'generated') throw new Error('Expected generated provenance');
    expect(manifest.provenance.composition.inputs.schemaVersion).toBe(4);
    expect(manifest.provenance.composition.inputs.authoringFingerprintVersion).toBe(3);
    expect(manifest.provenance.requestPlan.snapshot.settings).toEqual({
      kind: 'photograph',
      aspectRatio: '4:3',
      resolution: '1080p',
    });
    expect(manifest.provenance.publication).toEqual({ schemaVersion: 1, kind: 'fill_empty' });
    expect(manifest.provenance.attempt).toEqual({ kind: 'first' });
    expect(parseStudioPieceExportManifestV4(serializeStudioPieceExportManifestV4(manifest))).toEqual(manifest);

    const changedHash = structuredClone(manifest);
    changedHash.asset.sha256 = 'd'.repeat(64);
    const changedOwner = structuredClone(manifest);
    changedOwner.piece.id = 'piece_other';
    const changedJob = structuredClone(manifest);
    if (changedJob.provenance.origin !== 'generated') throw new Error('Expected generated provenance');
    changedJob.provenance.producerJobId = 'job_other';
    const changedProvider = structuredClone(manifest);
    if (changedProvider.provenance.origin !== 'generated') throw new Error('Expected generated provenance');
    changedProvider.provenance.provider.model = 'model_other';
    const changedComposition = structuredClone(manifest);
    if (changedComposition.provenance.origin !== 'generated') throw new Error('Expected generated provenance');
    changedComposition.provenance.composition.prompt = 'Different provider prompt';
    const changedRequest = structuredClone(manifest);
    if (changedRequest.provenance.origin !== 'generated') throw new Error('Expected generated provenance');
    changedRequest.provenance.requestPlan.snapshot.composition.prompt = 'Different requested prompt';
    const changedAuthorization = structuredClone(manifest);
    if (changedAuthorization.provenance.origin !== 'generated') throw new Error('Expected generated provenance');
    changedAuthorization.provenance.authorizationId = 'authorization_other';
    const changedQuote = structuredClone(manifest);
    if (changedQuote.provenance.origin !== 'generated') throw new Error('Expected generated provenance');
    changedQuote.provenance.quoteId = 'quote_other';
    const changedReceipt = structuredClone(manifest);
    if (changedReceipt.provenance.origin !== 'generated') throw new Error('Expected generated provenance');
    changedReceipt.provenance.receipt.totalMinorUnits += 1;
    const changedPublication = structuredClone(manifest);
    if (changedPublication.provenance.origin !== 'generated') throw new Error('Expected generated provenance');
    changedPublication.provenance.publication = {
      schemaVersion: 1,
      kind: 'replace_current',
      currentAsset: {
        pieceId: 'piece_1',
        assetId: 'asset_other',
        mediaKind: 'image',
        role: 'primary',
        mimeType: 'image/png',
        byteSize: 100,
        sha256: digest,
        width: 1920,
        height: 1080,
        createdAt: T1,
        origin: 'imported',
        producerJobId: null,
        compositionDigest: null,
      },
    };
    const changedAttempt = structuredClone(manifest);
    if (changedAttempt.provenance.origin !== 'generated') throw new Error('Expected generated provenance');
    changedAttempt.provenance.attempt = {
      kind: 'retry',
      sourceJobId: 'job_other',
      reason: 'provider_failure',
    };

    for (const changed of [
      changedHash,
      changedOwner,
      changedJob,
      changedProvider,
      changedComposition,
      changedRequest,
      changedAuthorization,
      changedQuote,
      changedReceipt,
      changedPublication,
      changedAttempt,
    ]) {
      expect(validateStudioPieceExportConsistencyV4(project, changed)).toBe(false);
    }
  });

  it('rejects a stale or non-current export without mutating already serialized artifact bytes', () => {
    const project = schemaSevenProject(importedProject());
    const manifest = buildV4(project);
    const artifactBytes = serializeStudioPieceExportManifestV4(manifest);

    const nonCurrent = structuredClone(manifest);
    nonCurrent.asset.id = 'asset_other';
    expect(validateStudioPieceExportConsistencyV4(project, nonCurrent)).toBe(false);

    project.revision += 1;
    project.authoringRevision += 1;
    project.pieces.piece_1!.priorHandles.push(project.pieces.piece_1!.handle);
    project.pieces.piece_1!.handle = 'renamed_photo';
    project.pieces.piece_1!.updatedAt = T3;
    project.updatedAt = T3;
    expect(validateStudioProjectV4(project)).toBe(true);
    expect(validateStudioPieceExportConsistencyV4(project, manifest)).toBe(false);
    expect(serializeStudioPieceExportManifestV4(manifest)).toEqual(artifactBytes);

    const fresh = buildStudioPieceExportManifestV4(project, {
      exportId: 'export_2',
      pieceId: 'piece_1',
      relativePath: 'renamed_photo.png',
      exportedAt: T3,
    });
    expect(fresh.piece.handleAtExport).toBe('renamed_photo');
    expect(fresh.sourceRevision).toBe(project.revision);
    expect(fresh.exportId).toBe('export_2');
  });

  it('exports the real phase-6 project without leaking canvas or run metadata into the protocol', () => {
    const project = makePhase6Project();
    const manifest = buildStudioPieceExportManifestV4(project, {
      exportId: 'export_phase_6',
      pieceId: 'piece_photo_1',
      relativePath: 'harbour_morning.png',
      exportedAt: PHASE_6_EXPORTED_AT,
    });

    expect(project.updatedAt).toBe(PHASE_6_CURRENT_AT);
    expect(manifest.schemaVersion).toBe(4);
    expect(manifest.provenance).toEqual({ origin: 'imported' });
    expect(Object.keys(manifest.piece).toSorted()).toEqual(['handleAtExport', 'id', 'kind']);
    expect(manifest).not.toHaveProperty('runStem');
    expect(manifest).not.toHaveProperty('boardOrder');
    expect(manifest).not.toHaveProperty('boards');
    expect(manifest).not.toHaveProperty('assemblyOrder');
    expect(manifest).not.toHaveProperty('assemblies');
    expect(manifest).not.toHaveProperty('bin');
    expect(validateStudioPieceExportConsistencyV4(project, manifest)).toBe(true);
  });

  it('rejects manifest construction and consistency after a Piece is lifted to the Bin', () => {
    const project = makePhase6Project();
    const manifest = buildStudioPieceExportManifestV4(project, {
      exportId: 'export_before_bin',
      pieceId: 'piece_photo_1',
      relativePath: 'harbour_morning.png',
      exportedAt: PHASE_6_EXPORTED_AT,
    });
    project.assemblyOrder = [];
    project.assemblies = {};
    project.bin = [
      {
        id: 'bin_piece_photo_1',
        subject: { kind: 'piece', pieceId: 'piece_photo_1' },
        reason: 'lifted',
        liftedAt: PHASE_6_CURRENT_AT,
      },
    ];

    expect(validateStudioProjectV4(project)).toBe(true);
    expect(validateStudioPieceExportConsistencyV4(project, manifest)).toBe(false);
    expect(() =>
      buildStudioPieceExportManifestV4(project, {
        exportId: 'export_while_binned',
        pieceId: 'piece_photo_1',
        relativePath: 'harbour_morning.png',
        exportedAt: PHASE_6_EXPORTED_AT,
      })
    ).toThrow(expect.objectContaining({ code: 'inconsistent_manifest' }));
  });

  it('refuses motion and poster-shaped current assets instead of exporting them as photos', () => {
    const motion = makePhase6Project();
    motion.pieces.piece_photo_1!.kind = 'motion';
    motion.assets.asset_photo_1 = {
      ...motion.assets.asset_photo_1!,
      mediaKind: 'video',
      role: 'primary',
      mimeType: 'video/mp4',
      managedAsset: { collection: 'imports', fileName: 'asset_photo_1.mp4' },
      durationSeconds: 5,
    };
    expect(validateStudioProjectV4(motion)).toBe(true);
    expect(() =>
      buildStudioPieceExportManifestV4(motion, {
        exportId: 'export_motion',
        pieceId: 'piece_photo_1',
        relativePath: 'motion.mp4',
        exportedAt: PHASE_6_EXPORTED_AT,
      })
    ).toThrow(expect.objectContaining({ code: 'inconsistent_manifest' }));

    const poster = makePhase6Project();
    (poster.assets.asset_photo_1 as Record<string, unknown>).role = 'poster';
    expect(validateStudioProjectV4(poster)).toBe(false);
    expect(() =>
      buildStudioPieceExportManifestV4(poster, {
        exportId: 'export_poster',
        pieceId: 'piece_photo_1',
        relativePath: 'poster.png',
        exportedAt: PHASE_6_EXPORTED_AT,
      })
    ).toThrow(expect.objectContaining({ code: 'inconsistent_manifest' }));
  });

  it('rejects a schema-7 project with a missing or noncanonical Piece run stem', () => {
    const missing = makePhase6Project();
    delete (missing.pieces.piece_photo_1 as unknown as Record<string, unknown>).runStem;
    expect(validateStudioProjectV4(missing)).toBe(false);
    expect(() =>
      buildStudioPieceExportManifestV4(missing, {
        exportId: 'export_missing_run_stem',
        pieceId: 'piece_photo_1',
        relativePath: 'harbour_morning.png',
        exportedAt: PHASE_6_EXPORTED_AT,
      })
    ).toThrow(expect.objectContaining({ code: 'inconsistent_manifest' }));

    const invalid = makePhase6Project();
    invalid.pieces.piece_photo_1!.runStem = 'not canonical';
    expect(validateStudioProjectV4(invalid)).toBe(false);
    expect(() =>
      buildStudioPieceExportManifestV4(invalid, {
        exportId: 'export_invalid_run_stem',
        pieceId: 'piece_photo_1',
        relativePath: 'harbour_morning.png',
        exportedAt: PHASE_6_EXPORTED_AT,
      })
    ).toThrow(expect.objectContaining({ code: 'inconsistent_manifest' }));
  });
});
