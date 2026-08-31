/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-disable no-await-in-loop -- Export publication and recovery are deliberately ordered durability proofs. */

import { createHash, randomUUID } from 'node:crypto';
import { constants as fsConstants, promises as fs } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import path from 'node:path';
import {
  STUDIO_EXPORT_SCHEMA_VERSION_V3,
  STUDIO_MAX_IMAGE_ASSET_BYTES_V3,
  STUDIO_MAX_PIECE_EXPORTS_PER_PIECE_V3,
  STUDIO_MAX_PIECE_EXPORTS_PER_PROJECT_V3,
  type StudioAssetV3,
  type StudioExportPieceResultV3,
  type StudioPieceExportArtifactV3,
  type StudioPieceExportCatalogV3,
  type StudioProjectV3,
  type StudioRendererPieceExportCatalogV3,
} from '@/common/types/project/creativeStudioTypes';
import type {
  CreativeStudioPilotStoreV3,
  StudioPilotProjectAuthoritySnapshotV3,
} from '@process/services/creative-studio/store/pilotStore';
import {
  buildStudioPieceExportManifestV3,
  parseStudioPieceExportManifestV3,
  serializeStudioPieceExportManifestV3,
} from '../../schema2/exports/pieceManifestV3';
import { isCanonicalStudioPieceHandleV3 } from '../../schema2/mutations/pieceHandles';
import { parseStudioExportPieceRequestV3 } from '../contracts';
import { CreativeStudioPilotServiceErrorV3, normalizeCreativeStudioPilotErrorV3 } from '../errors';

const SAFE_PERSISTED_ID = /^[A-Za-z0-9_-]{1,256}$/;
const SAFE_EXPORT_ID = /^[A-Za-z0-9_-]{1,200}$/;
const SAFE_NONCE = /^[A-Za-z0-9_-]{1,32}$/;
const LOWERCASE_SHA256 = /^[a-f0-9]{64}$/;
const SAFE_FOLDER_NAME = /^[A-Za-z0-9._-]{1,256}$/;
const CATALOG_FILE_NAME = 'catalog-v3.json';
const MANIFEST_FILE_NAME = 'manifest.json';
const EXPORTS_DIRECTORY_NAME = 'exports';
const QUARANTINE_DIRECTORY_NAME = 'quarantine';
const CATALOG_MAX_BYTES = 1024 * 1024;
const MANIFEST_MAX_BYTES = 1024 * 1024;
const MARKER_MAX_BYTES = 64 * 1024;
const NO_FOLLOW = typeof fsConstants.O_NOFOLLOW === 'number' ? fsConstants.O_NOFOLLOW : 0;
const CATALOG_KEYS = new Set(['schemaVersion', 'projectId', 'revision', 'artifacts']);
const ARTIFACT_KEYS = new Set([
  'schemaVersion',
  'id',
  'projectId',
  'pieceId',
  'sourceRevision',
  'handleAtExport',
  'managedExport',
  'byteSize',
  'payloadFileCount',
  'manifestSha256',
  'createdAt',
]);
const MANAGED_EXPORT_KEYS = new Set(['collection', 'fileName']);
const PENDING_MARKER_KEYS = new Set(['schemaVersion', 'projectId', 'exportId', 'stageName', 'finalName']);

export type StudioPilotManagedAssetVerifierV3 = {
  verifyManagedAssetV3(input: {
    projectId: string;
    assetId: string;
  }): Promise<{ asset: StudioAssetV3; absolutePath: string }>;
};

export type StudioPieceExportRuntimeStepV3 =
  | 'photo_staged'
  | 'manifest_staged'
  | 'intent_committed'
  | 'artifact_published'
  | 'catalog_committed'
  | 'intent_removed'
  | 'eviction_complete'
  | 'recovery_complete';

export type StudioPieceExportRuntimeDepsV3 = {
  store: Pick<CreativeStudioPilotStoreV3, 'loadProjectV3' | 'withProjectAuthorityV3'>;
  media: StudioPilotManagedAssetVerifierV3;
  now?: () => string;
  createExportId?: () => string;
  createNonce?: () => string;
  onStep?: (step: StudioPieceExportRuntimeStepV3, projectId: string) => void | Promise<void>;
};

export type StudioPieceExportRuntimeV3 = {
  create(input: unknown): Promise<StudioExportPieceResultV3>;
  list(projectId: string): Promise<StudioRendererPieceExportCatalogV3>;
  recover(projectId: string): Promise<StudioRendererPieceExportCatalogV3>;
};

type PendingMarkerV3 = {
  schemaVersion: typeof STUDIO_EXPORT_SCHEMA_VERSION_V3;
  projectId: string;
  exportId: string;
  stageName: string;
  finalName: string;
};

type VerifiedArtifactV3 = {
  artifact: StudioPieceExportArtifactV3;
  directoryPath: string;
};

type OpenedSourceV3 = {
  bytes: Buffer;
  assertUnchanged(): Promise<void>;
  close(): Promise<void>;
};

const sha256 = (value: Uint8Array): string => createHash('sha256').update(value).digest('hex');

const canonicalJson = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .toSorted()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(',')}}`;
};

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype;

const hasExactKeys = (value: Record<string, unknown>, expected: ReadonlySet<string>): boolean => {
  const keys = Reflect.ownKeys(value);
  return keys.length === expected.size && keys.every((key) => typeof key === 'string' && expected.has(key));
};

const isPositiveInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;

const isCanonicalTimestamp = (value: unknown): value is string => {
  if (typeof value !== 'string') return false;
  try {
    return new Date(value).toISOString() === value;
  } catch {
    return false;
  }
};

const hasErrorCode = (error: unknown, code: string): boolean =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === code;

const serviceFailure = (code: ConstructorParameters<typeof CreativeStudioPilotServiceErrorV3>[0]): never => {
  throw new CreativeStudioPilotServiceErrorV3(code);
};

const normalizeExportError = (error: unknown): never => {
  if (error instanceof CreativeStudioPilotServiceErrorV3) throw error;
  if (hasErrorCode(error, 'invalid_media')) return serviceFailure('invalid_media');
  if (hasErrorCode(error, 'not_found')) return serviceFailure('not_found');
  return normalizeCreativeStudioPilotErrorV3(error);
};

const syncDirectory = async (directoryPath: string): Promise<void> => {
  const handle = await fs.open(directoryPath, fsConstants.O_RDONLY | NO_FOLLOW);
  try {
    const stats = await handle.stat();
    if (!stats.isDirectory()) return serviceFailure('storage_error');
    await handle.sync();
  } finally {
    await handle.close().catch((): undefined => undefined);
  }
};

const ensureDirectory = async (parent: string, name: string): Promise<string> => {
  if (!SAFE_FOLDER_NAME.test(name)) return serviceFailure('storage_error');
  const directory = path.join(parent, name);
  if (path.dirname(directory) !== parent) return serviceFailure('storage_error');
  await fs.mkdir(directory, { recursive: true });
  const stats = await fs.lstat(directory);
  if (!stats.isDirectory() || stats.isSymbolicLink() || (await fs.realpath(directory)) !== directory) {
    return serviceFailure('storage_error');
  }
  return directory;
};

const writeExclusiveDurable = async (filePath: string, bytes: Uint8Array): Promise<void> => {
  const handle = await fs.open(
    filePath,
    fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | NO_FOLLOW,
    0o600
  );
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close().catch((): undefined => undefined);
  }
};

const writeCatalogDurable = async (
  exportsRoot: string,
  catalog: StudioPieceExportCatalogV3,
  nonce: string
): Promise<void> => {
  const catalogPath = path.join(exportsRoot, CATALOG_FILE_NAME);
  const temporaryPath = path.join(exportsRoot, `.${CATALOG_FILE_NAME}-${nonce}.part`);
  await writeExclusiveDurable(temporaryPath, Buffer.from(canonicalJson(catalog), 'utf8'));
  await fs.rename(temporaryPath, catalogPath);
  await syncDirectory(exportsRoot);
};

const identity = (stats: Awaited<ReturnType<FileHandle['stat']>>): string => `${stats.dev}:${stats.ino}`;

const readHandleBytes = async (handle: FileHandle, byteSize: number): Promise<Buffer> => {
  if (!Number.isSafeInteger(byteSize) || byteSize < 1 || byteSize > STUDIO_MAX_IMAGE_ASSET_BYTES_V3) {
    return serviceFailure('invalid_media');
  }
  const bytes = Buffer.alloc(byteSize);
  let offset = 0;
  while (offset < byteSize) {
    const read = await handle.read(bytes, offset, byteSize - offset, offset);
    if (read.bytesRead === 0) return serviceFailure('invalid_media');
    offset += read.bytesRead;
  }
  return bytes;
};

const imageExtension = (mimeType: string): 'png' | 'jpg' | 'webp' => {
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/jpeg') return 'jpg';
  if (mimeType === 'image/webp') return 'webp';
  return serviceFailure('invalid_media');
};

const verifyImageBytes = async (
  bytes: Uint8Array,
  expected: Pick<StudioAssetV3, 'mimeType' | 'byteSize' | 'sha256' | 'width' | 'height'>
): Promise<void> => {
  if (bytes.byteLength !== expected.byteSize || sha256(bytes) !== expected.sha256) {
    return serviceFailure('invalid_media');
  }
  let metadata: Awaited<ReturnType<ReturnType<(typeof import('sharp'))['default']>['metadata']>>;
  try {
    const sharp = (await import('sharp')).default;
    metadata = await sharp(bytes, { limitInputPixels: 40_000_000, sequentialRead: true }).metadata();
  } catch {
    return serviceFailure('invalid_media');
  }
  const format = expected.mimeType === 'image/jpeg' ? 'jpeg' : imageExtension(expected.mimeType);
  if (metadata.format !== format || metadata.width !== expected.width || metadata.height !== expected.height) {
    return serviceFailure('invalid_media');
  }
};

const readBoundedRegularFile = async (filePath: string, maximumBytes: number): Promise<Buffer> => {
  let handle: FileHandle | null = null;
  try {
    const beforePath = await fs.lstat(filePath);
    if (
      !beforePath.isFile() ||
      beforePath.isSymbolicLink() ||
      beforePath.nlink !== 1 ||
      beforePath.size > maximumBytes
    ) {
      return serviceFailure('storage_error');
    }
    handle = await fs.open(filePath, fsConstants.O_RDONLY | NO_FOLLOW);
    const before = await handle.stat();
    if (!before.isFile() || before.nlink !== 1 || before.size < 1 || before.size > maximumBytes) {
      return serviceFailure('storage_error');
    }
    const bytes = await readHandleBytes(handle, before.size);
    const [after, afterPath] = await Promise.all([handle.stat(), fs.lstat(filePath)]);
    if (
      identity(before) !== identity(after) ||
      identity(before) !== identity(afterPath) ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs ||
      afterPath.isSymbolicLink()
    ) {
      return serviceFailure('storage_error');
    }
    return bytes;
  } catch (error) {
    if (error instanceof CreativeStudioPilotServiceErrorV3) throw error;
    return serviceFailure('storage_error');
  } finally {
    await handle?.close().catch((): undefined => undefined);
  }
};

const openVerifiedSource = async (absolutePath: string, expected: StudioAssetV3): Promise<OpenedSourceV3> => {
  if (!path.isAbsolute(absolutePath)) return serviceFailure('invalid_media');
  let handle: FileHandle | null = null;
  try {
    const beforePath = await fs.lstat(absolutePath);
    if (!beforePath.isFile() || beforePath.isSymbolicLink() || beforePath.nlink !== 1) {
      return serviceFailure('invalid_media');
    }
    handle = await fs.open(absolutePath, fsConstants.O_RDONLY | NO_FOLLOW);
    const opened = await handle.stat();
    if (!opened.isFile() || opened.nlink !== 1 || identity(opened) !== identity(beforePath)) {
      return serviceFailure('invalid_media');
    }
    const bytes = await readHandleBytes(handle, opened.size);
    await verifyImageBytes(bytes, expected);
    const originalIdentity = identity(opened);
    const originalMtimeMs = opened.mtimeMs;
    const owned = handle;
    const assertUnchanged = async (): Promise<void> => {
      const reread = await readHandleBytes(owned, opened.size);
      await verifyImageBytes(reread, expected);
      const [current, currentPath] = await Promise.all([owned.stat(), fs.lstat(absolutePath)]);
      if (
        identity(current) !== originalIdentity ||
        identity(currentPath) !== originalIdentity ||
        current.size !== opened.size ||
        current.mtimeMs !== originalMtimeMs ||
        currentPath.isSymbolicLink()
      ) {
        return serviceFailure('invalid_media');
      }
    };
    handle = null;
    return {
      bytes,
      assertUnchanged,
      close: async () => owned.close(),
    };
  } catch (error) {
    if (error instanceof CreativeStudioPilotServiceErrorV3) throw error;
    return serviceFailure('invalid_media');
  } finally {
    await handle?.close().catch((): undefined => undefined);
  }
};

const assetFactsEqual = (left: StudioAssetV3, right: StudioAssetV3): boolean =>
  canonicalJson(left) === canonicalJson(right);

const folderNameForExport = (exportId: string): string => {
  if (!SAFE_EXPORT_ID.test(exportId)) return serviceFailure('storage_error');
  const value = `piece-${exportId}`;
  if (!SAFE_FOLDER_NAME.test(value)) return serviceFailure('storage_error');
  return value;
};

const stageNameForExport = (exportId: string, nonce: string): string => {
  if (!SAFE_EXPORT_ID.test(exportId) || !SAFE_NONCE.test(nonce)) return serviceFailure('storage_error');
  const value = `.stage-${exportId}-${nonce}`;
  if (!SAFE_FOLDER_NAME.test(value)) return serviceFailure('storage_error');
  return value;
};

const markerNameForExport = (exportId: string): string => `.pending-${exportId}.json`;

const validateArtifact = (value: unknown, projectId: string): value is StudioPieceExportArtifactV3 => {
  if (!isPlainRecord(value) || !hasExactKeys(value, ARTIFACT_KEYS)) return false;
  if (
    value.schemaVersion !== STUDIO_EXPORT_SCHEMA_VERSION_V3 ||
    typeof value.id !== 'string' ||
    !SAFE_EXPORT_ID.test(value.id) ||
    value.projectId !== projectId ||
    typeof value.pieceId !== 'string' ||
    !SAFE_PERSISTED_ID.test(value.pieceId) ||
    !isPositiveInteger(value.sourceRevision) ||
    !isCanonicalStudioPieceHandleV3(value.handleAtExport) ||
    !isPlainRecord(value.managedExport) ||
    !hasExactKeys(value.managedExport, MANAGED_EXPORT_KEYS) ||
    value.managedExport.collection !== 'exports' ||
    typeof value.managedExport.fileName !== 'string' ||
    value.managedExport.fileName !== folderNameForExport(value.id) ||
    !isPositiveInteger(value.byteSize) ||
    value.payloadFileCount !== 2 ||
    typeof value.manifestSha256 !== 'string' ||
    !LOWERCASE_SHA256.test(value.manifestSha256) ||
    !isCanonicalTimestamp(value.createdAt)
  ) {
    return false;
  }
  return true;
};

const artifactOrder = (left: StudioPieceExportArtifactV3, right: StudioPieceExportArtifactV3): number =>
  left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);

/** Applies the independent export-3 five-per-Piece and 480-per-project retention contract. */
export const retainStudioPieceExportArtifactsV3 = (
  artifacts: readonly StudioPieceExportArtifactV3[]
): StudioPieceExportArtifactV3[] => {
  const byPiece = new Map<string, StudioPieceExportArtifactV3[]>();
  for (const artifact of artifacts.toSorted(artifactOrder)) {
    const group = byPiece.get(artifact.pieceId) ?? [];
    group.push(artifact);
    byPiece.set(artifact.pieceId, group);
  }
  return [...byPiece.values()]
    .flatMap((group) => group.slice(-STUDIO_MAX_PIECE_EXPORTS_PER_PIECE_V3))
    .toSorted(artifactOrder)
    .slice(-STUDIO_MAX_PIECE_EXPORTS_PER_PROJECT_V3);
};

const validateCatalog = (value: unknown, projectId: string): value is StudioPieceExportCatalogV3 => {
  if (
    !isPlainRecord(value) ||
    !hasExactKeys(value, CATALOG_KEYS) ||
    value.schemaVersion !== STUDIO_EXPORT_SCHEMA_VERSION_V3 ||
    value.projectId !== projectId ||
    !isPositiveInteger(value.revision) ||
    !Array.isArray(value.artifacts) ||
    value.artifacts.length > STUDIO_MAX_PIECE_EXPORTS_PER_PROJECT_V3 ||
    Reflect.ownKeys(value.artifacts).length !== value.artifacts.length + 1
  ) {
    return false;
  }
  const ids = new Set<string>();
  const folders = new Set<string>();
  const artifacts = value.artifacts as unknown[];
  if (
    artifacts.some(
      (artifact) =>
        !validateArtifact(artifact, projectId) ||
        ids.has(artifact.id) ||
        folders.has(artifact.managedExport.fileName) ||
        (ids.add(artifact.id), folders.add(artifact.managedExport.fileName), false)
    )
  ) {
    return false;
  }
  const retained = retainStudioPieceExportArtifactsV3(artifacts as StudioPieceExportArtifactV3[]);
  return canonicalJson(retained) === canonicalJson(artifacts);
};

const logicalCatalog = (projectId: string): StudioPieceExportCatalogV3 => ({
  schemaVersion: STUDIO_EXPORT_SCHEMA_VERSION_V3,
  projectId,
  revision: 1,
  artifacts: [],
});

const parseCatalog = (bytes: Uint8Array, projectId: string): StudioPieceExportCatalogV3 | null => {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  return validateCatalog(value, projectId) && canonicalJson(value) === text ? value : null;
};

const parsePendingMarker = (bytes: Uint8Array, projectId: string): PendingMarkerV3 | null => {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  const exportId = isPlainRecord(value) && typeof value.exportId === 'string' ? value.exportId : '';
  const stageName = isPlainRecord(value) && typeof value.stageName === 'string' ? value.stageName : '';
  const stagePrefix = `.stage-${exportId}-`;
  const nonce = stageName.startsWith(stagePrefix) ? stageName.slice(stagePrefix.length) : '';
  if (
    !isPlainRecord(value) ||
    !hasExactKeys(value, PENDING_MARKER_KEYS) ||
    value.schemaVersion !== STUDIO_EXPORT_SCHEMA_VERSION_V3 ||
    value.projectId !== projectId ||
    !SAFE_EXPORT_ID.test(exportId) ||
    typeof value.stageName !== 'string' ||
    !SAFE_NONCE.test(nonce) ||
    !SAFE_FOLDER_NAME.test(stageName) ||
    typeof value.finalName !== 'string' ||
    value.finalName !== folderNameForExport(exportId) ||
    canonicalJson(value) !== text
  ) {
    return null;
  }
  return value as PendingMarkerV3;
};

const projectRendererCatalog = (catalog: StudioPieceExportCatalogV3): StudioRendererPieceExportCatalogV3 => ({
  revision: catalog.revision,
  artifacts: catalog.artifacts.map((artifact) => ({
    id: artifact.id,
    pieceId: artifact.pieceId,
    sourceRevision: artifact.sourceRevision,
    handleAtExport: artifact.handleAtExport,
    byteSize: artifact.byteSize,
    payloadFileCount: artifact.payloadFileCount,
    createdAt: artifact.createdAt,
    folderName: artifact.managedExport.fileName,
  })),
});

const artifactFromDirectory = async (
  projectId: string,
  directoryPath: string,
  finalName: string
): Promise<VerifiedArtifactV3 | null> => {
  try {
    const directoryStats = await fs.lstat(directoryPath);
    if (
      !directoryStats.isDirectory() ||
      directoryStats.isSymbolicLink() ||
      (await fs.realpath(directoryPath)) !== directoryPath
    ) {
      return null;
    }
    const entries = await fs.readdir(directoryPath, { withFileTypes: true });
    if (entries.length !== 2 || entries.some((entry) => !entry.isFile() || entry.isSymbolicLink())) return null;
    const manifestEntry = entries.find((entry) => entry.name === MANIFEST_FILE_NAME);
    const photoEntry = entries.find((entry) => entry.name !== MANIFEST_FILE_NAME);
    if (manifestEntry === undefined || photoEntry === undefined || !SAFE_FOLDER_NAME.test(photoEntry.name)) return null;
    const manifestBytes = await readBoundedRegularFile(
      path.join(directoryPath, MANIFEST_FILE_NAME),
      MANIFEST_MAX_BYTES
    );
    const manifest = parseStudioPieceExportManifestV3(manifestBytes);
    if (
      manifest.projectId !== projectId ||
      finalName !== folderNameForExport(manifest.exportId) ||
      manifest.asset.relativePath !== photoEntry.name ||
      photoEntry.name !== `photo.${imageExtension(manifest.asset.mimeType)}`
    ) {
      return null;
    }
    const photoBytes = await readBoundedRegularFile(
      path.join(directoryPath, photoEntry.name),
      STUDIO_MAX_IMAGE_ASSET_BYTES_V3
    );
    await verifyImageBytes(photoBytes, manifest.asset);
    const artifact: StudioPieceExportArtifactV3 = {
      schemaVersion: STUDIO_EXPORT_SCHEMA_VERSION_V3,
      id: manifest.exportId,
      projectId,
      pieceId: manifest.piece.id,
      sourceRevision: manifest.sourceRevision,
      handleAtExport: manifest.piece.handleAtExport,
      managedExport: { collection: 'exports', fileName: finalName },
      byteSize: photoBytes.byteLength + manifestBytes.byteLength,
      payloadFileCount: 2,
      manifestSha256: sha256(manifestBytes),
      createdAt: manifest.exportedAt,
    };
    return validateArtifact(artifact, projectId) ? { artifact, directoryPath } : null;
  } catch {
    return null;
  }
};

const quarantineEntry = async (
  exportsRoot: string,
  quarantineRoot: string,
  entryPath: string,
  nonce: string
): Promise<void> => {
  if (path.dirname(entryPath) !== exportsRoot) return serviceFailure('storage_error');
  const name = path.basename(entryPath);
  if (!SAFE_FOLDER_NAME.test(name)) return serviceFailure('storage_error');
  if (!SAFE_NONCE.test(nonce)) return serviceFailure('storage_error');
  const target = path.join(
    quarantineRoot,
    `quarantine-${sha256(Buffer.from(`${name}\0${nonce}`, 'utf8')).slice(0, 48)}`
  );
  if (path.dirname(target) !== quarantineRoot || !SAFE_FOLDER_NAME.test(path.basename(target))) {
    return serviceFailure('storage_error');
  }
  try {
    await fs.rename(entryPath, target);
    await Promise.all([syncDirectory(exportsRoot), syncDirectory(quarantineRoot)]);
  } catch (error) {
    if (!hasErrorCode(error, 'ENOENT')) throw error;
  }
};

const removeEvictedDirectory = async (
  exportsRoot: string,
  quarantineRoot: string,
  directoryPath: string,
  nonce: string
): Promise<void> => {
  if (path.dirname(directoryPath) !== exportsRoot) return serviceFailure('storage_error');
  const stats = await fs.lstat(directoryPath);
  if (!stats.isDirectory() || stats.isSymbolicLink() || (await fs.realpath(directoryPath)) !== directoryPath) {
    return quarantineEntry(exportsRoot, quarantineRoot, directoryPath, nonce);
  }
  if (!SAFE_NONCE.test(nonce)) return serviceFailure('storage_error');
  const quarantinePath = path.join(
    quarantineRoot,
    `evicted-${sha256(Buffer.from(`${path.basename(directoryPath)}\0${nonce}`, 'utf8')).slice(0, 48)}`
  );
  if (path.dirname(quarantinePath) !== quarantineRoot || !SAFE_FOLDER_NAME.test(path.basename(quarantinePath))) {
    return serviceFailure('storage_error');
  }
  await fs.rename(directoryPath, quarantinePath);
  await Promise.all([syncDirectory(exportsRoot), syncDirectory(quarantineRoot)]);
  await fs.rm(quarantinePath, { recursive: true });
  await syncDirectory(quarantineRoot);
};

const nextTimestamp = (requested: string, project: StudioProjectV3, catalog: StudioPieceExportCatalogV3): string => {
  if (!isCanonicalTimestamp(requested)) return serviceFailure('storage_error');
  const floor = Math.max(
    Date.parse(project.updatedAt),
    ...catalog.artifacts.map((artifact) => Date.parse(artifact.createdAt) + 1)
  );
  return new Date(Math.max(Date.parse(requested), floor)).toISOString();
};

const recoverInsideAuthority = async (
  authority: StudioPilotProjectAuthoritySnapshotV3,
  createNonce: () => string,
  onStep: (step: StudioPieceExportRuntimeStepV3, projectId: string) => Promise<void>
): Promise<StudioPieceExportCatalogV3> => {
  const project = authority.project;
  const projectDir = await fs.realpath(authority.projectDir);
  if (projectDir !== authority.projectDir) return serviceFailure('storage_error');
  const exportsRoot = await ensureDirectory(projectDir, EXPORTS_DIRECTORY_NAME);
  const quarantineRoot = await ensureDirectory(exportsRoot, QUARANTINE_DIRECTORY_NAME);
  const entries = await fs.readdir(exportsRoot, { withFileTypes: true });

  const pending = new Map<string, { marker: PendingMarkerV3; markerPath: string }>();
  for (const entry of entries) {
    if (!entry.name.startsWith('.pending-') || !entry.name.endsWith('.json')) continue;
    const markerPath = path.join(exportsRoot, entry.name);
    if (!entry.isFile() || entry.isSymbolicLink()) {
      await quarantineEntry(exportsRoot, quarantineRoot, markerPath, createNonce());
      continue;
    }
    let marker: PendingMarkerV3 | null = null;
    try {
      marker = parsePendingMarker(await readBoundedRegularFile(markerPath, MARKER_MAX_BYTES), project.id);
    } catch {
      // The bounded marker is isolated below.
    }
    if (marker === null || markerNameForExport(marker.exportId) !== entry.name || pending.has(marker.exportId)) {
      await quarantineEntry(exportsRoot, quarantineRoot, markerPath, createNonce());
      continue;
    }
    pending.set(marker.exportId, { marker, markerPath });
  }

  for (const { marker } of pending.values()) {
    const stagePath = path.join(exportsRoot, marker.stageName);
    const finalPath = path.join(exportsRoot, marker.finalName);
    let finalExists = true;
    try {
      await fs.lstat(finalPath);
    } catch (error) {
      if (!hasErrorCode(error, 'ENOENT')) throw error;
      finalExists = false;
    }
    if (!finalExists) {
      const staged = await artifactFromDirectory(project.id, stagePath, marker.finalName);
      if (staged !== null && staged.artifact.id === marker.exportId) {
        await fs.rename(stagePath, finalPath);
        await syncDirectory(exportsRoot);
      }
    } else {
      try {
        await fs.lstat(stagePath);
        await quarantineEntry(exportsRoot, quarantineRoot, stagePath, createNonce());
      } catch (error) {
        if (!hasErrorCode(error, 'ENOENT')) throw error;
      }
    }
  }

  const catalogPath = path.join(exportsRoot, CATALOG_FILE_NAME);
  let catalogStatus: 'missing' | 'valid' | 'malformed' = 'missing';
  let catalog = logicalCatalog(project.id);
  try {
    const bytes = await readBoundedRegularFile(catalogPath, CATALOG_MAX_BYTES);
    const parsed = parseCatalog(bytes, project.id);
    if (parsed === null) {
      catalogStatus = 'malformed';
      await quarantineEntry(exportsRoot, quarantineRoot, catalogPath, createNonce());
    } else {
      catalogStatus = 'valid';
      catalog = parsed;
    }
  } catch (error) {
    if (!hasErrorCode(error, 'ENOENT')) {
      if (error instanceof CreativeStudioPilotServiceErrorV3) {
        catalogStatus = 'malformed';
        await quarantineEntry(exportsRoot, quarantineRoot, catalogPath, createNonce());
      } else {
        throw error;
      }
    }
  }

  const currentEntries = await fs.readdir(exportsRoot, { withFileTypes: true });
  const verifiedByFolder = new Map<string, VerifiedArtifactV3>();
  for (const entry of currentEntries) {
    if (!entry.name.startsWith('piece-')) continue;
    const directoryPath = path.join(exportsRoot, entry.name);
    const verified =
      entry.isDirectory() && !entry.isSymbolicLink()
        ? await artifactFromDirectory(project.id, directoryPath, entry.name)
        : null;
    if (verified === null || verifiedByFolder.has(entry.name)) {
      await quarantineEntry(exportsRoot, quarantineRoot, directoryPath, createNonce());
      continue;
    }
    verifiedByFolder.set(entry.name, verified);
  }

  let trustedCatalog = catalogStatus === 'valid';
  if (trustedCatalog) {
    for (const artifact of catalog.artifacts) {
      const verified = verifiedByFolder.get(artifact.managedExport.fileName);
      if (verified === undefined || canonicalJson(verified.artifact) !== canonicalJson(artifact)) {
        trustedCatalog = false;
        await quarantineEntry(exportsRoot, quarantineRoot, catalogPath, createNonce());
        break;
      }
    }
  }

  const priorArtifacts = trustedCatalog
    ? catalog.artifacts
    : [...verifiedByFolder.values()].map(({ artifact }) => artifact);
  const recovered = [...priorArtifacts];
  const recoveredIds = new Set(recovered.map((artifact) => artifact.id));
  for (const [exportId, { marker }] of pending) {
    const verified =
      verifiedByFolder.get(marker.finalName) ??
      (await artifactFromDirectory(project.id, path.join(exportsRoot, marker.finalName), marker.finalName));
    if (verified !== null && verified.artifact.id === exportId && !recoveredIds.has(exportId)) {
      recovered.push(verified.artifact);
      recoveredIds.add(exportId);
      verifiedByFolder.set(marker.finalName, verified);
    }
  }
  const retained = retainStudioPieceExportArtifactsV3(recovered);
  const retainedIds = new Set(retained.map((artifact) => artifact.id));
  const changed = !trustedCatalog || canonicalJson(retained) !== canonicalJson(catalog.artifacts);
  const nextCatalog: StudioPieceExportCatalogV3 = {
    schemaVersion: STUDIO_EXPORT_SCHEMA_VERSION_V3,
    projectId: project.id,
    revision: trustedCatalog && changed ? catalog.revision + 1 : trustedCatalog ? catalog.revision : 1,
    artifacts: retained,
  };
  if (changed && (catalogStatus !== 'missing' || retained.length > 0)) {
    await writeCatalogDurable(exportsRoot, nextCatalog, createNonce());
  }

  for (const { marker, markerPath } of pending.values()) {
    await fs.rm(markerPath, { force: true });
    const stagePath = path.join(exportsRoot, marker.stageName);
    try {
      await quarantineEntry(exportsRoot, quarantineRoot, stagePath, createNonce());
    } catch (error) {
      if (!hasErrorCode(error, 'ENOENT')) throw error;
    }
  }
  if (pending.size > 0) await syncDirectory(exportsRoot);

  for (const [folder, verified] of verifiedByFolder) {
    if (retainedIds.has(verified.artifact.id)) continue;
    await removeEvictedDirectory(exportsRoot, quarantineRoot, path.join(exportsRoot, folder), createNonce());
  }
  const after = await fs.readdir(exportsRoot, { withFileTypes: true });
  for (const entry of after) {
    if (entry.name.startsWith('.stage-') || entry.name.startsWith(`.${CATALOG_FILE_NAME}-`)) {
      await quarantineEntry(exportsRoot, quarantineRoot, path.join(exportsRoot, entry.name), createNonce());
    }
  }
  await authority.assertCurrent();
  await onStep('recovery_complete', project.id);
  return nextCatalog;
};

const findCurrentAsset = (project: StudioProjectV3, pieceId: string): StudioAssetV3 => {
  const piece = project.pieces[pieceId];
  if (piece === undefined || piece.currentAssetId === null) return serviceFailure('export_unavailable');
  const asset = project.assets[piece.currentAssetId];
  if (asset === undefined || asset.pieceId !== piece.id || asset.projectId !== project.id) {
    return serviceFailure('export_unavailable');
  }
  return asset;
};

const uniqueExportId = (mint: () => string, catalog: StudioPieceExportCatalogV3, project: StudioProjectV3): string => {
  const unavailable = new Set([
    ...catalog.artifacts.map((artifact) => artifact.id),
    ...Object.keys(project.pieces),
    ...Object.keys(project.assets),
    ...Object.keys(project.jobs),
  ]);
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const candidate = mint();
    if (typeof candidate === 'string' && SAFE_EXPORT_ID.test(candidate) && !unavailable.has(candidate))
      return candidate;
  }
  return serviceFailure('storage_error');
};

/** Creates the isolated export-3 runtime; it has no generation, quote, provider, or spend dependency. */
export const createStudioPieceExportRuntimeV3 = (deps: StudioPieceExportRuntimeDepsV3): StudioPieceExportRuntimeV3 => {
  const now = deps.now ?? (() => new Date().toISOString());
  const createExportId = deps.createExportId ?? (() => `export_${randomUUID().replaceAll('-', '')}`);
  const mintNonce = deps.createNonce ?? (() => randomUUID().replaceAll('-', '').slice(0, 16));
  const createNonce = (): string => {
    const nonce = mintNonce();
    if (typeof nonce !== 'string' || !SAFE_NONCE.test(nonce)) return serviceFailure('storage_error');
    return nonce;
  };
  const onStep = async (step: StudioPieceExportRuntimeStepV3, projectId: string): Promise<void> => {
    await deps.onStep?.(step, projectId);
  };

  const recover = async (projectId: string): Promise<StudioRendererPieceExportCatalogV3> => {
    if (typeof projectId !== 'string' || !SAFE_PERSISTED_ID.test(projectId)) return serviceFailure('invalid_payload');
    try {
      return await deps.store.withProjectAuthorityV3(projectId, async (authority) =>
        projectRendererCatalog(await recoverInsideAuthority(authority, createNonce, onStep))
      );
    } catch (error) {
      return normalizeExportError(error);
    }
  };

  return {
    async create(input) {
      try {
        const request = parseStudioExportPieceRequestV3(input);
        const preliminaryProject = await deps.store.loadProjectV3(request.projectId);
        if (preliminaryProject.revision !== request.expectedRevision) return serviceFailure('stale_project');
        const preliminaryAsset = findCurrentAsset(preliminaryProject, request.pieceId);
        const mediaProof = await deps.media.verifyManagedAssetV3({
          projectId: request.projectId,
          assetId: preliminaryAsset.id,
        });
        return await deps.store.withProjectAuthorityV3(request.projectId, async (authority) => {
          const project = authority.project;
          if (project.revision !== request.expectedRevision) return serviceFailure('stale_project');
          const asset = findCurrentAsset(project, request.pieceId);
          if (asset.id !== mediaProof.asset.id || !assetFactsEqual(asset, mediaProof.asset)) {
            return serviceFailure('invalid_media');
          }
          const catalog = await recoverInsideAuthority(authority, createNonce, onStep);
          if (catalog.revision !== request.expectedCatalogRevision) {
            return serviceFailure('stale_export_catalog');
          }
          const source = await openVerifiedSource(mediaProof.absolutePath, asset);
          try {
            await authority.assertCurrent();
            const exportsRoot = await ensureDirectory(await fs.realpath(authority.projectDir), EXPORTS_DIRECTORY_NAME);
            const quarantineRoot = await ensureDirectory(exportsRoot, QUARANTINE_DIRECTORY_NAME);
            const exportId = uniqueExportId(createExportId, catalog, project);
            const nonce = createNonce();
            const finalName = folderNameForExport(exportId);
            const stageName = stageNameForExport(exportId, nonce);
            const stagePath = path.join(exportsRoot, stageName);
            const finalPath = path.join(exportsRoot, finalName);
            const markerPath = path.join(exportsRoot, markerNameForExport(exportId));
            const exportedAt = nextTimestamp(now(), project, catalog);
            const relativePhotoPath = `photo.${imageExtension(asset.mimeType)}`;
            const manifest = buildStudioPieceExportManifestV3(project, {
              exportId,
              pieceId: request.pieceId,
              relativePath: relativePhotoPath,
              exportedAt,
            });
            const manifestBytes = serializeStudioPieceExportManifestV3(manifest);

            await fs.mkdir(stagePath, { recursive: false, mode: 0o700 });
            await syncDirectory(exportsRoot);
            await writeExclusiveDurable(path.join(stagePath, relativePhotoPath), source.bytes);
            await syncDirectory(stagePath);
            await onStep('photo_staged', project.id);
            await writeExclusiveDurable(path.join(stagePath, MANIFEST_FILE_NAME), manifestBytes);
            await syncDirectory(stagePath);
            await onStep('manifest_staged', project.id);
            try {
              await source.assertUnchanged();
            } catch (error) {
              await fs.rm(stagePath, { recursive: true, force: true });
              await syncDirectory(exportsRoot);
              throw error;
            }
            const verifiedStage = await artifactFromDirectory(project.id, stagePath, finalName);
            if (verifiedStage === null) {
              await fs.rm(stagePath, { recursive: true, force: true });
              await syncDirectory(exportsRoot);
              return serviceFailure('storage_error');
            }
            const marker: PendingMarkerV3 = {
              schemaVersion: STUDIO_EXPORT_SCHEMA_VERSION_V3,
              projectId: project.id,
              exportId,
              stageName,
              finalName,
            };
            await writeExclusiveDurable(markerPath, Buffer.from(canonicalJson(marker), 'utf8'));
            await syncDirectory(exportsRoot);
            await onStep('intent_committed', project.id);
            await source.assertUnchanged();
            await fs.rename(stagePath, finalPath);
            await syncDirectory(exportsRoot);
            await onStep('artifact_published', project.id);
            await authority.assertCurrent();

            const artifacts = retainStudioPieceExportArtifactsV3([...catalog.artifacts, verifiedStage.artifact]);
            const nextCatalog: StudioPieceExportCatalogV3 = {
              schemaVersion: STUDIO_EXPORT_SCHEMA_VERSION_V3,
              projectId: project.id,
              revision: catalog.revision + 1,
              artifacts,
            };
            await writeCatalogDurable(exportsRoot, nextCatalog, createNonce());
            await onStep('catalog_committed', project.id);
            await fs.rm(markerPath);
            await syncDirectory(exportsRoot);
            await onStep('intent_removed', project.id);

            const retainedIds = new Set(artifacts.map((artifact) => artifact.id));
            for (const evicted of [...catalog.artifacts, verifiedStage.artifact]) {
              if (retainedIds.has(evicted.id)) continue;
              await removeEvictedDirectory(
                exportsRoot,
                quarantineRoot,
                path.join(exportsRoot, evicted.managedExport.fileName),
                createNonce()
              );
            }
            await onStep('eviction_complete', project.id);
            return { status: 'exported', catalog: projectRendererCatalog(nextCatalog) };
          } finally {
            await source.close().catch((): undefined => undefined);
          }
        });
      } catch (error) {
        return normalizeExportError(error);
      }
    },
    list: recover,
    recover,
  };
};
