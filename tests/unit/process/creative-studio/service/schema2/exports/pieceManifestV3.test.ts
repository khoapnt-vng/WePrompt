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
  type StudioAssetV3,
  type StudioPieceGenerationCompositionV3,
  type StudioPieceGenerationRequestPlanV3,
  type StudioPieceJobV3,
  type StudioPieceSpendAuthorizationV3,
  type StudioPieceSubmissionQuoteV3,
  type StudioProjectV3,
} from '@/common/types/project/creativeStudioTypes';
import {
  buildStudioPieceExportManifestV3,
  parseStudioPieceExportManifestV3,
  serializeStudioPieceExportManifestV3,
  validateStudioPieceExportConsistencyV3,
} from '@/process/services/creative-studio/service/schema2/exports/pieceManifestV3';
import { createEmptyStudioProjectV3 } from '@/process/services/creative-studio/service/schema2/factories';
import { createStudioPieceQuotedGenerationIdV3 } from '@/process/services/creative-studio/service/schema2/generation/submissionIdentity';
import { validateStudioProjectV3 } from '@/process/services/creative-studio/service/schema2/validation';

const T0 = '2026-08-30T00:00:00.000Z';
const T1 = '2026-08-30T00:00:01.000Z';
const T2 = '2026-08-30T00:00:02.000Z';
const T3 = '2026-08-30T00:00:03.000Z';
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
      schemaVersion: 2,
      projectRevisionAtPreparation: 1,
      authoringRevision: 1,
      authoringFingerprintVersion: 1,
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
      instructionProfile: 'weprompt-image-v1.piece-image.v1',
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
    authoringFingerprintVersion: 1,
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
    authoringFingerprintVersion: 1,
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
