/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  STUDIO_EXPORT_SCHEMA_VERSION_V4,
  type StudioPieceExportManifestV4,
  type StudioProjectV4,
} from '@/common/types/project/creativeStudioTypes';
import { types as nodeTypes } from 'node:util';
import {
  studioPieceGenerationCompositionDigestV4,
  validateStudioPieceExportManifestV4,
  validateStudioProjectV4,
} from '../validation';

export type StudioPieceExportManifestErrorCodeV4 = 'invalid_manifest' | 'inconsistent_manifest';

export class StudioPieceExportManifestErrorV4 extends Error {
  readonly code: StudioPieceExportManifestErrorCodeV4;

  constructor(code: StudioPieceExportManifestErrorCodeV4) {
    super(code);
    this.name = 'StudioPieceExportManifestErrorV4';
    this.code = code;
  }
}

const fail = (code: StudioPieceExportManifestErrorCodeV4): never => {
  throw new StudioPieceExportManifestErrorV4(code);
};

const MAX_MANIFEST_BYTES_V4 = 1024 * 1024;

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

/** A Piece retained in the Bin has only the signed Put-back action; it is not exportable. */
export const isStudioPieceBinnedV4 = (project: StudioProjectV4, pieceId: string): boolean =>
  project.bin.some((entry) => entry.subject.kind === 'piece' && entry.subject.pieceId === pieceId);

/** Serializes an exact export-4 manifest to canonical, no-newline UTF-8 bytes. */
export const serializeStudioPieceExportManifestV4 = (value: unknown): Uint8Array => {
  if (!validateStudioPieceExportManifestV4(value)) return fail('invalid_manifest');
  let snapshot: StudioPieceExportManifestV4;
  try {
    snapshot = structuredClone(value);
  } catch {
    return fail('invalid_manifest');
  }
  const bytes = Buffer.from(canonicalJson(snapshot), 'utf8');
  if (bytes.byteLength > MAX_MANIFEST_BYTES_V4) return fail('invalid_manifest');
  return bytes;
};

/** Parses only canonical exact-key export-4 bytes; export 3 and alternate encodings fail closed. */
export const parseStudioPieceExportManifestV4 = (bytes: Uint8Array): StudioPieceExportManifestV4 => {
  if (
    !(bytes instanceof Uint8Array) ||
    nodeTypes.isProxy(bytes) ||
    bytes.byteLength === 0 ||
    bytes.byteLength > MAX_MANIFEST_BYTES_V4
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
  if (!validateStudioPieceExportManifestV4(parsed) || canonicalJson(parsed) !== text) {
    return fail('invalid_manifest');
  }
  return parsed;
};

/**
 * Proves that an export-4 sidecar describes the exact current photograph and its schema-7
 * generation, publication, and attempt provenance. This function performs no IO or spend.
 */
export const validateStudioPieceExportConsistencyV4 = (
  project: StudioProjectV4,
  manifest: StudioPieceExportManifestV4
): boolean => {
  if (!validateStudioProjectV4(project) || !validateStudioPieceExportManifestV4(manifest)) return false;
  if (
    manifest.projectId !== project.id ||
    manifest.sourceRevision !== project.revision ||
    manifest.exportedAt < project.updatedAt ||
    !project.pieceOrder.includes(manifest.piece.id) ||
    isStudioPieceBinnedV4(project, manifest.piece.id)
  ) {
    return false;
  }
  const piece = Object.hasOwn(project.pieces, manifest.piece.id) ? project.pieces[manifest.piece.id] : undefined;
  const asset = Object.hasOwn(project.assets, manifest.asset.id) ? project.assets[manifest.asset.id] : undefined;
  if (
    piece === undefined ||
    piece.kind !== 'photograph' ||
    asset === undefined ||
    asset.mediaKind !== 'image' ||
    asset.role !== 'primary' ||
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
    job.purpose === 'piece_image' &&
    authorization !== undefined &&
    job.status === 'succeeded' &&
    job.target.kind === 'piece' &&
    job.target.pieceId === piece.id &&
    job.outputAssetIdsByRole.primary === asset.id &&
    job.outputAssetIdsByRole.poster === null &&
    job.spendReceipt !== null &&
    asset.compositionDigest === studioPieceGenerationCompositionDigestV4(job.composition) &&
    manifest.provenance.producerJobId === job.id &&
    sameValue(manifest.provenance.provider, job.provider) &&
    sameValue(manifest.provenance.composition, job.composition) &&
    sameValue(manifest.provenance.requestPlan, job.requestPlan) &&
    sameValue(manifest.provenance.publication, job.publication) &&
    sameValue(manifest.provenance.attempt, job.attempt) &&
    manifest.provenance.authorizationId === authorization.id &&
    manifest.provenance.quoteId === authorization.quote.id &&
    manifest.provenance.quoteRevision === authorization.quote.quoteRevision &&
    sameValue(manifest.provenance.receipt, job.spendReceipt) &&
    sameValue(authorization.quote.item.requestPlan, job.requestPlan) &&
    sameValue(authorization.quote.item.publication, job.publication) &&
    sameValue(authorization.quote.item.attempt, job.attempt)
  );
};

export type StudioPieceExportManifestBuildInputV4 = {
  exportId: string;
  pieceId: string;
  relativePath: string;
  exportedAt: string;
};

const BUILD_INPUT_KEYS_V4: ReadonlySet<string> = new Set(['exportId', 'pieceId', 'relativePath', 'exportedAt']);

const snapshotBuildInputV4 = (input: unknown): StudioPieceExportManifestBuildInputV4 => {
  try {
    if (typeof input !== 'object' || input === null || Array.isArray(input) || nodeTypes.isProxy(input)) {
      return fail('inconsistent_manifest');
    }
    const prototype = Object.getPrototypeOf(input);
    if (prototype !== Object.prototype && prototype !== null) return fail('inconsistent_manifest');
    const ownKeys = Reflect.ownKeys(input);
    if (
      ownKeys.length !== BUILD_INPUT_KEYS_V4.size ||
      ownKeys.some((key) => typeof key !== 'string' || !BUILD_INPUT_KEYS_V4.has(key))
    ) {
      return fail('inconsistent_manifest');
    }
    const snapshot: Record<string, string> = {};
    for (const key of BUILD_INPUT_KEYS_V4) {
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
    return snapshot as StudioPieceExportManifestBuildInputV4;
  } catch (error) {
    if (error instanceof StudioPieceExportManifestErrorV4) throw error;
    return fail('inconsistent_manifest');
  }
};

/** Builds and self-validates export-4 provenance for the current primary photograph of one Piece. */
export const buildStudioPieceExportManifestV4 = (
  project: StudioProjectV4,
  input: StudioPieceExportManifestBuildInputV4
): StudioPieceExportManifestV4 => {
  if (!validateStudioProjectV4(project)) return fail('inconsistent_manifest');
  const snapshot = snapshotBuildInputV4(input);
  if (isStudioPieceBinnedV4(project, snapshot.pieceId)) return fail('inconsistent_manifest');
  const piece = Object.hasOwn(project.pieces, snapshot.pieceId) ? project.pieces[snapshot.pieceId] : undefined;
  const asset =
    piece?.currentAssetId && Object.hasOwn(project.assets, piece.currentAssetId)
      ? project.assets[piece.currentAssetId]
      : undefined;
  if (
    piece === undefined ||
    piece.kind !== 'photograph' ||
    asset === undefined ||
    asset.mediaKind !== 'image' ||
    asset.role !== 'primary'
  ) {
    return fail('inconsistent_manifest');
  }

  let provenance: StudioPieceExportManifestV4['provenance'];
  if (asset.origin === 'imported') {
    provenance = { origin: 'imported' };
  } else {
    const job = Object.hasOwn(project.jobs, asset.producerJobId) ? project.jobs[asset.producerJobId] : undefined;
    const authorization = job
      ? project.spendAuthorizations.find((candidate) => candidate.id === job.authorizationId)
      : undefined;
    if (
      job === undefined ||
      job.purpose !== 'piece_image' ||
      job.spendReceipt === null ||
      authorization === undefined
    ) {
      return fail('inconsistent_manifest');
    }
    provenance = {
      origin: 'generated',
      producerJobId: job.id,
      provider: structuredClone(job.provider),
      composition: structuredClone(job.composition),
      requestPlan: structuredClone(job.requestPlan),
      publication: structuredClone(job.publication),
      attempt: structuredClone(job.attempt),
      authorizationId: authorization.id,
      quoteId: authorization.quote.id,
      quoteRevision: authorization.quote.quoteRevision,
      receipt: structuredClone(job.spendReceipt),
    };
  }

  const manifest: StudioPieceExportManifestV4 = {
    schemaVersion: STUDIO_EXPORT_SCHEMA_VERSION_V4,
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
  if (!validateStudioPieceExportConsistencyV4(project, manifest)) return fail('inconsistent_manifest');
  return manifest;
};
