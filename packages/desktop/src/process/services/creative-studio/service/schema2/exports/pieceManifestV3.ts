/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  STUDIO_EXPORT_SCHEMA_VERSION_V3,
  type StudioPieceExportManifestV3,
  type StudioProjectV3,
} from '@/common/types/project/creativeStudioTypes';
import { types as nodeTypes } from 'node:util';
import { validateStudioPieceExportManifestV3, validateStudioProjectV3 } from '../validation';

export type StudioPieceExportManifestErrorCodeV3 = 'invalid_manifest' | 'inconsistent_manifest';

export class StudioPieceExportManifestErrorV3 extends Error {
  readonly code: StudioPieceExportManifestErrorCodeV3;

  constructor(code: StudioPieceExportManifestErrorCodeV3) {
    super(code);
    this.name = 'StudioPieceExportManifestErrorV3';
    this.code = code;
  }
}

const fail = (code: StudioPieceExportManifestErrorCodeV3): never => {
  throw new StudioPieceExportManifestErrorV3(code);
};

const MAX_MANIFEST_BYTES_V3 = 1024 * 1024;

const canonicalJson = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .toSorted()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(',')}}`;
};

const sameValue = (left: unknown, right: unknown): boolean => canonicalJson(left) === canonicalJson(right);

/** Serializes an exact export-3 manifest to canonical, no-newline UTF-8 bytes. */
export const serializeStudioPieceExportManifestV3 = (value: unknown): Uint8Array => {
  if (!validateStudioPieceExportManifestV3(value)) return fail('invalid_manifest');
  let snapshot: StudioPieceExportManifestV3;
  try {
    snapshot = structuredClone(value);
  } catch {
    return fail('invalid_manifest');
  }
  const bytes = Buffer.from(canonicalJson(snapshot), 'utf8');
  if (bytes.byteLength > MAX_MANIFEST_BYTES_V3) return fail('invalid_manifest');
  return bytes;
};

/** Parses only canonical exact-key export-3 bytes; BOM, whitespace, and alternate key order fail. */
export const parseStudioPieceExportManifestV3 = (bytes: Uint8Array): StudioPieceExportManifestV3 => {
  if (
    !(bytes instanceof Uint8Array) ||
    nodeTypes.isProxy(bytes) ||
    bytes.byteLength === 0 ||
    bytes.byteLength > MAX_MANIFEST_BYTES_V3
  ) {
    return fail('invalid_manifest');
  }
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return fail('invalid_manifest');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return fail('invalid_manifest');
  }
  if (!validateStudioPieceExportManifestV3(parsed) || canonicalJson(parsed) !== text) {
    return fail('invalid_manifest');
  }
  return parsed;
};

/**
 * Proves that the sidecar describes the exact current Piece asset and its persisted provenance.
 * This function performs no IO and never initiates generation or spend.
 */
export const validateStudioPieceExportConsistencyV3 = (
  project: StudioProjectV3,
  manifest: StudioPieceExportManifestV3
): boolean => {
  if (!validateStudioProjectV3(project) || !validateStudioPieceExportManifestV3(manifest)) return false;
  if (
    manifest.projectId !== project.id ||
    manifest.sourceRevision !== project.revision ||
    manifest.exportedAt < project.updatedAt ||
    !project.pieceOrder.includes(manifest.piece.id)
  ) {
    return false;
  }
  const piece = Object.hasOwn(project.pieces, manifest.piece.id) ? project.pieces[manifest.piece.id] : undefined;
  const asset = Object.hasOwn(project.assets, manifest.asset.id) ? project.assets[manifest.asset.id] : undefined;
  if (
    piece === undefined ||
    asset === undefined ||
    piece.kind !== manifest.piece.kind ||
    piece.handle !== manifest.piece.handleAtExport ||
    piece.currentAssetId !== asset.id ||
    asset.projectId !== project.id ||
    asset.pieceId !== piece.id ||
    asset.id !== manifest.asset.id ||
    asset.sha256 !== manifest.asset.sha256 ||
    asset.mimeType !== manifest.asset.mimeType ||
    asset.byteSize !== manifest.asset.byteSize ||
    asset.width !== manifest.asset.width ||
    asset.height !== manifest.asset.height ||
    asset.createdAt !== manifest.asset.createdAt
  ) {
    return false;
  }
  if (asset.origin === 'imported') return manifest.provenance.origin === 'imported';
  if (manifest.provenance.origin !== 'generated') return false;
  const job = Object.hasOwn(project.jobs, asset.producerJobId) ? project.jobs[asset.producerJobId] : undefined;
  const authorization = job
    ? project.spendAuthorizations.find((candidate) => candidate.id === job.authorizationId)
    : undefined;
  return (
    job !== undefined &&
    authorization !== undefined &&
    job.status === 'succeeded' &&
    job.target.kind === 'piece' &&
    job.target.pieceId === piece.id &&
    job.purpose === 'piece_image' &&
    job.outputAssetId === asset.id &&
    job.spendReceipt !== null &&
    manifest.provenance.producerJobId === job.id &&
    sameValue(manifest.provenance.provider, job.provider) &&
    sameValue(manifest.provenance.composition, job.composition) &&
    sameValue(manifest.provenance.requestPlan, job.requestPlan) &&
    manifest.provenance.authorizationId === authorization.id &&
    manifest.provenance.quoteId === authorization.quote.id &&
    manifest.provenance.quoteRevision === authorization.quote.quoteRevision &&
    sameValue(manifest.provenance.receipt, job.spendReceipt) &&
    sameValue(authorization.quote.item.requestPlan, job.requestPlan)
  );
};

export type StudioPieceExportManifestBuildInputV3 = {
  exportId: string;
  pieceId: string;
  relativePath: string;
  exportedAt: string;
};

const BUILD_INPUT_KEYS_V3: ReadonlySet<string> = new Set(['exportId', 'pieceId', 'relativePath', 'exportedAt']);

const snapshotBuildInputV3 = (input: unknown): StudioPieceExportManifestBuildInputV3 => {
  try {
    if (typeof input !== 'object' || input === null || Array.isArray(input) || nodeTypes.isProxy(input)) {
      return fail('inconsistent_manifest');
    }
    const prototype = Object.getPrototypeOf(input);
    if (prototype !== Object.prototype && prototype !== null) return fail('inconsistent_manifest');
    const ownKeys = Reflect.ownKeys(input);
    if (
      ownKeys.length !== BUILD_INPUT_KEYS_V3.size ||
      ownKeys.some((key) => typeof key !== 'string' || !BUILD_INPUT_KEYS_V3.has(key))
    ) {
      return fail('inconsistent_manifest');
    }
    const snapshot: Record<string, string> = {};
    for (const key of BUILD_INPUT_KEYS_V3) {
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      if (
        descriptor === undefined ||
        !descriptor.enumerable ||
        !Object.hasOwn(descriptor, 'value') ||
        typeof descriptor.value !== 'string'
      ) {
        return fail('inconsistent_manifest');
      }
      snapshot[key] = descriptor.value;
    }
    return snapshot as StudioPieceExportManifestBuildInputV3;
  } catch (error) {
    if (error instanceof StudioPieceExportManifestErrorV3) throw error;
    return fail('inconsistent_manifest');
  }
};

/** Builds and self-validates exact provenance for the current asset of one Piece. */
export const buildStudioPieceExportManifestV3 = (
  project: StudioProjectV3,
  input: StudioPieceExportManifestBuildInputV3
): StudioPieceExportManifestV3 => {
  if (!validateStudioProjectV3(project)) return fail('inconsistent_manifest');
  const snapshot = snapshotBuildInputV3(input);
  const piece = Object.hasOwn(project.pieces, snapshot.pieceId) ? project.pieces[snapshot.pieceId] : undefined;
  const asset =
    piece?.currentAssetId && Object.hasOwn(project.assets, piece.currentAssetId)
      ? project.assets[piece.currentAssetId]
      : undefined;
  if (piece === undefined || asset === undefined) return fail('inconsistent_manifest');

  let provenance: StudioPieceExportManifestV3['provenance'];
  if (asset.origin === 'imported') {
    provenance = { origin: 'imported' };
  } else {
    const job = Object.hasOwn(project.jobs, asset.producerJobId) ? project.jobs[asset.producerJobId] : undefined;
    const authorization = job
      ? project.spendAuthorizations.find((candidate) => candidate.id === job.authorizationId)
      : undefined;
    if (job === undefined || job.spendReceipt === null || authorization === undefined) {
      return fail('inconsistent_manifest');
    }
    provenance = {
      origin: 'generated',
      producerJobId: job.id,
      provider: structuredClone(job.provider),
      composition: structuredClone(job.composition),
      requestPlan: structuredClone(job.requestPlan),
      authorizationId: authorization.id,
      quoteId: authorization.quote.id,
      quoteRevision: authorization.quote.quoteRevision,
      receipt: structuredClone(job.spendReceipt),
    };
  }

  const manifest: StudioPieceExportManifestV3 = {
    schemaVersion: STUDIO_EXPORT_SCHEMA_VERSION_V3,
    exportId: snapshot.exportId,
    projectId: project.id,
    sourceRevision: project.revision,
    piece: {
      id: piece.id,
      kind: piece.kind,
      handleAtExport: piece.handle,
    },
    asset: {
      id: asset.id,
      sha256: asset.sha256,
      mimeType: asset.mimeType,
      byteSize: asset.byteSize,
      width: asset.width,
      height: asset.height,
      createdAt: asset.createdAt,
      relativePath: snapshot.relativePath,
    },
    provenance,
    exportedAt: snapshot.exportedAt,
  };
  if (!validateStudioPieceExportConsistencyV3(project, manifest)) return fail('inconsistent_manifest');
  return manifest;
};
