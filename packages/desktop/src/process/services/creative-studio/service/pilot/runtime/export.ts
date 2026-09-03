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
import { syncDurableDirectory } from '../../durableDirectory';
import {
  STUDIO_EXPORT_SCHEMA_VERSION_V3,
  STUDIO_EXPORT_SCHEMA_VERSION_V4,
  STUDIO_MAX_IMAGE_ASSET_BYTES_V3,
  STUDIO_MAX_PIECE_EXPORTS_PER_PIECE_V3,
  STUDIO_MAX_PIECE_EXPORTS_PER_PROJECT_V3,
  type StudioAssetV3,
  type StudioAssetV4,
  type StudioDeliverPieceExportRequestV3,
  type StudioExportPieceResultV3,
  type StudioPieceExportArtifactRequestV3,
  type StudioPieceExportArtifactV3,
  type StudioPieceExportArtifactV4,
  type StudioPieceExportCatalogV3,
  type StudioProjectV3,
  type StudioProjectV4,
  type StudioRendererPieceExportCatalogV3,
  type StudioRendererPieceExportCatalogV4,
  type StudioExportPieceResultV4,
} from '@/common/types/project/creativeStudioTypes';
import type { CreativeStudioPilotStoreV3 } from '@process/services/creative-studio/store/pilot';
import { CreativeStudioPilotStoreErrorV4 } from '@process/services/creative-studio/store/pilot/v4';
import {
  buildStudioPieceExportManifestV3,
  parseStudioPieceExportManifestV3,
  serializeStudioPieceExportManifestV3,
} from '../../schema2/exports/pieceManifestV3';
import {
  buildStudioPieceExportManifestV4,
  isStudioPieceBinnedV4,
  parseStudioPieceExportManifestV4,
  serializeStudioPieceExportManifestV4,
} from '../../schema2/exports/pieceManifestV4';
import { isCanonicalStudioPieceHandleV3 } from '../../schema2/mutations/pieceHandles';
import { studioPersistentIdentitiesV4 } from '../../schema2/mutations/projectAuthorityV4';
import {
  parseStudioDeliverPieceExportRequestV3,
  parseStudioExportPieceRequestV3,
  parseStudioPieceExportArtifactRequestV3,
} from '../contracts';
import { CreativeStudioPilotServiceErrorV3, normalizeCreativeStudioPilotErrorV3 } from '../errors';

const SAFE_PERSISTED_ID = /^[A-Za-z0-9_-]{1,256}$/;
const SAFE_EXPORT_ID = /^[A-Za-z0-9_-]{1,200}$/;
const SAFE_NONCE = /^[A-Za-z0-9_-]{1,32}$/;
const LOWERCASE_SHA256 = /^[a-f0-9]{64}$/;
const SAFE_FOLDER_NAME = /^[A-Za-z0-9._-]{1,256}$/;
const CATALOG_FILE_NAME_V3 = 'catalog-v3.json';
const CATALOG_FILE_NAME_V4 = 'catalog-v4.json';
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
const COPY_INTENT_KEYS = new Set([
  'schemaVersion',
  'projectId',
  'artifactId',
  'catalogRevision',
  'artifactSha256',
  'destinationName',
  'stageName',
]);

export type StudioPilotManagedAssetVerifierV3 = {
  verifyManagedAssetV3(input: {
    projectId: string;
    assetId: string;
  }): Promise<{ asset: StudioAssetV3; absolutePath: string }>;
};

export type StudioPilotManagedAssetVerifierV4 = {
  verifyManagedAssetV4(input: {
    projectId: string;
    assetId: string;
  }): Promise<{ asset: StudioAssetV4; absolutePath: string }>;
};

export type StudioPieceExportRuntimeStepV3 =
  | 'photo_staged'
  | 'manifest_staged'
  | 'intent_committed'
  | 'artifact_published'
  | 'catalog_committed'
  | 'intent_removed'
  | 'eviction_complete'
  | 'recovery_complete'
  | 'copy_stage_closed'
  | 'copy_intent_committed'
  | 'copy_publish_ready'
  | 'copy_artifact_published'
  | 'copy_intent_removed';

export type StudioPieceExportRuntimeDepsV3 = {
  store: Pick<CreativeStudioPilotStoreV3, 'loadProjectV3' | 'withProjectAuthorityV3'>;
  media: StudioPilotManagedAssetVerifierV3;
  now?: () => string;
  createExportId?: () => string;
  createNonce?: () => string;
  onStep?: (step: StudioPieceExportRuntimeStepV3, projectId: string) => void | Promise<void>;
};

type StudioPieceExportProjectV3OrV4 = StudioProjectV3 | StudioProjectV4;

export type StudioPieceExportProjectAuthorityV4 = {
  project: StudioProjectV4;
  projectDir: string;
  assertCurrent(): Promise<void>;
};

/** Exact schema-7 store seam; no schema-6 project is admitted by either operation. */
export type StudioPieceExportProjectStoreV4 = {
  loadProjectV4(projectId: string): Promise<StudioProjectV4>;
  withProjectAuthorityV4<T>(
    projectId: string,
    operation: (snapshot: StudioPieceExportProjectAuthorityV4) => Promise<T>
  ): Promise<T>;
};

export type StudioPieceExportRuntimeDepsV4 = Omit<StudioPieceExportRuntimeDepsV3, 'store' | 'media'> & {
  store: StudioPieceExportProjectStoreV4;
  media: StudioPilotManagedAssetVerifierV4;
};

export type StudioPieceExportRuntimeV3 = {
  describe(input: unknown): Promise<{ suggestedName: string }>;
  create(input: unknown): Promise<StudioExportPieceResultV3>;
  copy(request: unknown, destinationPath: string): Promise<{ status: 'copied' }>;
  resolveRevealPath(request: unknown): Promise<string>;
  list(projectId: string): Promise<StudioRendererPieceExportCatalogV3>;
  recover(projectId: string): Promise<StudioRendererPieceExportCatalogV3>;
};

export type StudioPieceExportRuntimeV4 = Omit<StudioPieceExportRuntimeV3, 'create' | 'list' | 'recover'> & {
  create(input: unknown): Promise<StudioExportPieceResultV4>;
  list(projectId: string): Promise<StudioRendererPieceExportCatalogV4>;
  recover(projectId: string): Promise<StudioRendererPieceExportCatalogV4>;
};

type StudioPieceExportProjectAuthority<Project extends StudioPieceExportProjectV3OrV4> = {
  project: Project;
  projectDir: string;
  assertCurrent(): Promise<void>;
};

type StudioPieceExportProjectStore<Project extends StudioPieceExportProjectV3OrV4> = {
  loadProject(projectId: string): Promise<Project>;
  withProjectAuthority<T>(
    projectId: string,
    operation: (snapshot: StudioPieceExportProjectAuthority<Project>) => Promise<T>
  ): Promise<T>;
};

type StudioPieceExportSchemaVersion = typeof STUDIO_EXPORT_SCHEMA_VERSION_V3 | typeof STUDIO_EXPORT_SCHEMA_VERSION_V4;
type StudioPieceExportArtifact = Omit<StudioPieceExportArtifactV3, 'schemaVersion'> & {
  schemaVersion: StudioPieceExportSchemaVersion;
};
type StudioPieceExportCatalog = Omit<StudioPieceExportCatalogV3, 'schemaVersion' | 'artifacts'> & {
  schemaVersion: StudioPieceExportSchemaVersion;
  artifacts: StudioPieceExportArtifact[];
};
type StudioPieceExportManifest =
  | ReturnType<typeof buildStudioPieceExportManifestV3>
  | ReturnType<typeof buildStudioPieceExportManifestV4>;
type StudioPieceExportImageAsset = StudioAssetV3 | Extract<StudioAssetV4, { mediaKind: 'image'; role: 'primary' }>;
type StudioPieceExportManagedAsset = StudioAssetV3 | StudioAssetV4;

type StudioPieceExportProtocol<Project extends StudioPieceExportProjectV3OrV4> = {
  schemaVersion: StudioPieceExportSchemaVersion;
  catalogFileName: string;
  finalName(exportId: string): string;
  stageName(exportId: string, nonce: string): string;
  stageNonce(exportId: string, name: string): string | null;
  markerName(exportId: string): string;
  recognizesFinalName(name: string): boolean;
  recognizesStageName(name: string): boolean;
  recognizesMarkerName(name: string): boolean;
  isPieceAvailable(project: Project, pieceId: string): boolean;
  buildManifest(
    project: Project,
    input: Parameters<typeof buildStudioPieceExportManifestV3>[1]
  ): StudioPieceExportManifest;
  parseManifest(bytes: Uint8Array): StudioPieceExportManifest;
  serializeManifest(value: unknown): Uint8Array;
};
type StudioPieceExportReadProtocol = Pick<
  StudioPieceExportProtocol<StudioPieceExportProjectV3OrV4>,
  | 'schemaVersion'
  | 'catalogFileName'
  | 'finalName'
  | 'stageName'
  | 'stageNonce'
  | 'markerName'
  | 'recognizesFinalName'
  | 'recognizesStageName'
  | 'recognizesMarkerName'
  | 'parseManifest'
  | 'serializeManifest'
>;

type StudioPieceExportRuntimeCoreDeps<Project extends StudioPieceExportProjectV3OrV4> = Omit<
  StudioPieceExportRuntimeDepsV3,
  'store' | 'media'
> & {
  store: StudioPieceExportProjectStore<Project>;
  verifyManagedAsset(input: {
    projectId: string;
    assetId: string;
  }): Promise<{ asset: StudioPieceExportManagedAsset; absolutePath: string }>;
  protocol: StudioPieceExportProtocol<Project>;
  projectIdentities(project: Project): Iterable<string>;
};

type PendingMarker = {
  schemaVersion: StudioPieceExportSchemaVersion;
  projectId: string;
  exportId: string;
  stageName: string;
  finalName: string;
};

type CopyIntent = {
  schemaVersion: StudioPieceExportSchemaVersion;
  projectId: string;
  artifactId: string;
  catalogRevision: number;
  artifactSha256: string;
  destinationName: string;
  stageName: string;
};

type VerifiedArtifact = {
  artifact: StudioPieceExportArtifact;
  directoryPath: string;
};

type OpenedSourceV3 = {
  bytes: Buffer;
  assertUnchanged(): Promise<void>;
  close(): Promise<void>;
};

type ExportPayloadSnapshot = {
  artifact: StudioPieceExportArtifact;
  directoryPath: string;
  files: ReadonlyArray<{ name: string; bytes: Buffer }>;
};

type DirectoryIdentityV3 = {
  dev: number | bigint;
  ino: number | bigint;
};

type OwnedCopyProofV3 = {
  directory: DirectoryIdentityV3;
  files: Map<string, DirectoryIdentityV3>;
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
  if (error instanceof CreativeStudioPilotStoreErrorV4) {
    const code = {
      invalid_payload: 'invalid_payload',
      not_found: 'not_found',
      stale_project: 'stale_project',
      unsupported: 'unsupported_project',
      quarantined: 'project_quarantined',
      already_exists: 'storage_error',
      busy: 'busy',
      storage_error: 'storage_error',
    }[error.code] as ConstructorParameters<typeof CreativeStudioPilotServiceErrorV3>[0];
    return serviceFailure(code);
  }
  if (hasErrorCode(error, 'invalid_media')) return serviceFailure('invalid_media');
  if (hasErrorCode(error, 'not_found')) return serviceFailure('not_found');
  return normalizeCreativeStudioPilotErrorV3(error);
};

const syncDirectory = async (directoryPath: string): Promise<void> => {
  await syncDurableDirectory(fs, directoryPath, { additionalFlags: NO_FOLLOW });
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

const writeExclusiveDurable = async (
  filePath: string,
  bytes: Uint8Array,
  onCreated?: (identity: DirectoryIdentityV3) => void
): Promise<void> => {
  const handle = await fs.open(
    filePath,
    fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | NO_FOLLOW,
    0o600
  );
  try {
    const created = await handle.stat();
    if (!created.isFile() || created.isSymbolicLink() || created.nlink !== 1 || created.size !== 0) {
      return serviceFailure('storage_error');
    }
    onCreated?.(directoryIdentity(created));
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close().catch((): undefined => undefined);
  }
};

const writeCatalogDurable = async (
  exportsRoot: string,
  catalog: StudioPieceExportCatalog,
  nonce: string,
  catalogFileName: string
): Promise<void> => {
  const catalogPath = path.join(exportsRoot, catalogFileName);
  const temporaryPath = path.join(exportsRoot, `.${catalogFileName}-${nonce}.part`);
  await writeExclusiveDurable(temporaryPath, Buffer.from(canonicalJson(catalog), 'utf8'));
  await fs.rename(temporaryPath, catalogPath);
  await syncDirectory(exportsRoot);
};

const identity = (stats: Awaited<ReturnType<FileHandle['stat']>>): string => `${stats.dev}:${stats.ino}`;

const directoryIdentity = (
  stats: Awaited<ReturnType<FileHandle['stat']>> | Awaited<ReturnType<typeof fs.lstat>>
): DirectoryIdentityV3 => ({ dev: stats.dev, ino: stats.ino });

const sameDirectoryIdentity = (left: DirectoryIdentityV3, right: DirectoryIdentityV3): boolean =>
  left.dev === right.dev && left.ino === right.ino;

const readVerifiedDirectoryIdentity = async (directoryPath: string): Promise<DirectoryIdentityV3> => {
  let handle: FileHandle | null = null;
  try {
    handle = await fs.open(directoryPath, fsConstants.O_RDONLY | NO_FOLLOW);
    const opened = await handle.stat();
    const pathStats = await fs.lstat(directoryPath);
    if (
      !opened.isDirectory() ||
      !pathStats.isDirectory() ||
      pathStats.isSymbolicLink() ||
      !sameDirectoryIdentity(directoryIdentity(opened), directoryIdentity(pathStats)) ||
      (await fs.realpath(directoryPath)) !== directoryPath
    ) {
      return serviceFailure('storage_error');
    }
    const finalOpened = await handle.stat();
    const finalPath = await fs.lstat(directoryPath);
    if (
      !sameDirectoryIdentity(directoryIdentity(opened), directoryIdentity(finalOpened)) ||
      !sameDirectoryIdentity(directoryIdentity(opened), directoryIdentity(finalPath))
    ) {
      return serviceFailure('storage_error');
    }
    return directoryIdentity(opened);
  } catch (error) {
    if (error instanceof CreativeStudioPilotServiceErrorV3) throw error;
    return serviceFailure('storage_error');
  } finally {
    await handle?.close().catch((): undefined => undefined);
  }
};

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

const openVerifiedSource = async (
  absolutePath: string,
  expected: StudioPieceExportImageAsset
): Promise<OpenedSourceV3> => {
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

const assetFactsEqual = (left: StudioPieceExportManagedAsset, right: StudioPieceExportManagedAsset): boolean =>
  canonicalJson(left) === canonicalJson(right);

const legacyFolderNameForExport = (exportId: string): string => {
  if (!SAFE_EXPORT_ID.test(exportId)) return serviceFailure('storage_error');
  const value = `piece-${exportId}`;
  if (!SAFE_FOLDER_NAME.test(value)) return serviceFailure('storage_error');
  return value;
};

const legacyStageNameForExport = (exportId: string, nonce: string): string => {
  if (!SAFE_EXPORT_ID.test(exportId) || !SAFE_NONCE.test(nonce)) return serviceFailure('storage_error');
  const value = `.stage-${exportId}-${nonce}`;
  if (!SAFE_FOLDER_NAME.test(value)) return serviceFailure('storage_error');
  return value;
};

const legacyMarkerNameForExport = (exportId: string): string => `.pending-${exportId}.json`;

const v4FolderNameForExport = (exportId: string): string => {
  if (!SAFE_EXPORT_ID.test(exportId)) return serviceFailure('storage_error');
  const value = `v4-piece-${exportId}`;
  if (!SAFE_FOLDER_NAME.test(value)) return serviceFailure('storage_error');
  return value;
};

const v4StageNameForExport = (exportId: string, nonce: string): string => {
  if (!SAFE_EXPORT_ID.test(exportId) || !SAFE_NONCE.test(nonce)) return serviceFailure('storage_error');
  const value = `.v4-stage-${exportId}-${nonce}`;
  if (!SAFE_FOLDER_NAME.test(value)) return serviceFailure('storage_error');
  return value;
};

const v4MarkerNameForExport = (exportId: string): string => `.v4-pending-${exportId}.json`;

const LEGACY_FINAL_PREFIX = 'piece-';
const LEGACY_STAGE_PREFIX = '.stage-';
const LEGACY_MARKER_PREFIX = '.pending-';
const V4_FINAL_PREFIX = 'v4-piece-';
const V4_STAGE_PREFIX = '.v4-stage-';
const V4_MARKER_PREFIX = '.v4-pending-';

const recognizesName = (name: string, prefix: string, suffix = ''): boolean =>
  name.startsWith(prefix) && name.endsWith(suffix) && name.length > prefix.length + suffix.length;

const stageNonceFromName = (name: string, prefix: string, exportId: string): string | null => {
  const exactPrefix = `${prefix}${exportId}-`;
  if (!SAFE_EXPORT_ID.test(exportId) || !name.startsWith(exactPrefix)) return null;
  const nonce = name.slice(exactPrefix.length);
  return SAFE_NONCE.test(nonce) ? nonce : null;
};

const validateArtifact = (
  value: unknown,
  projectId: string,
  protocol: StudioPieceExportReadProtocol
): value is StudioPieceExportArtifact => {
  if (!isPlainRecord(value) || !hasExactKeys(value, ARTIFACT_KEYS)) return false;
  if (
    value.schemaVersion !== protocol.schemaVersion ||
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
    value.managedExport.fileName !== protocol.finalName(value.id) ||
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

const artifactOrder = (left: StudioPieceExportArtifact, right: StudioPieceExportArtifact): number =>
  left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);

const retainStudioPieceExportArtifacts = <Artifact extends StudioPieceExportArtifact>(
  artifacts: readonly Artifact[]
): Artifact[] => {
  const byPiece = new Map<string, Artifact[]>();
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

/** Applies the independent export-3 five-per-Piece and 480-per-project retention contract. */
export const retainStudioPieceExportArtifactsV3 = (
  artifacts: readonly StudioPieceExportArtifactV3[]
): StudioPieceExportArtifactV3[] => retainStudioPieceExportArtifacts(artifacts);

/** Applies the identical cardinality policy to the distinct export-4 artifact family. */
export const retainStudioPieceExportArtifactsV4 = (
  artifacts: readonly StudioPieceExportArtifactV4[]
): StudioPieceExportArtifactV4[] => retainStudioPieceExportArtifacts(artifacts);

const validateCatalog = (
  value: unknown,
  projectId: string,
  protocol: StudioPieceExportReadProtocol
): value is StudioPieceExportCatalog => {
  if (
    !isPlainRecord(value) ||
    !hasExactKeys(value, CATALOG_KEYS) ||
    value.schemaVersion !== protocol.schemaVersion ||
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
        !validateArtifact(artifact, projectId, protocol) ||
        ids.has(artifact.id) ||
        folders.has(artifact.managedExport.fileName) ||
        (ids.add(artifact.id), folders.add(artifact.managedExport.fileName), false)
    )
  ) {
    return false;
  }
  const retained = retainStudioPieceExportArtifacts(artifacts as StudioPieceExportArtifact[]);
  return canonicalJson(retained) === canonicalJson(artifacts);
};

const logicalCatalog = (
  projectId: string,
  schemaVersion: StudioPieceExportSchemaVersion
): StudioPieceExportCatalog => ({
  schemaVersion,
  projectId,
  revision: 1,
  artifacts: [],
});

const parseCatalog = (
  bytes: Uint8Array,
  projectId: string,
  protocol: StudioPieceExportReadProtocol
): StudioPieceExportCatalog | null => {
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
  return validateCatalog(value, projectId, protocol) && canonicalJson(value) === text ? value : null;
};

const parsePendingMarker = (
  bytes: Uint8Array,
  projectId: string,
  protocol: StudioPieceExportReadProtocol
): PendingMarker | null => {
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
  const nonce = protocol.stageNonce(exportId, stageName) ?? '';
  if (
    !isPlainRecord(value) ||
    !hasExactKeys(value, PENDING_MARKER_KEYS) ||
    value.schemaVersion !== protocol.schemaVersion ||
    value.projectId !== projectId ||
    !SAFE_EXPORT_ID.test(exportId) ||
    typeof value.stageName !== 'string' ||
    !SAFE_NONCE.test(nonce) ||
    !SAFE_FOLDER_NAME.test(stageName) ||
    typeof value.finalName !== 'string' ||
    value.finalName !== protocol.finalName(exportId) ||
    canonicalJson(value) !== text
  ) {
    return null;
  }
  return value as PendingMarker;
};

const projectRendererCatalog = (catalog: StudioPieceExportCatalog): StudioRendererPieceExportCatalogV3 => ({
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
  finalName: string,
  protocol: StudioPieceExportReadProtocol
): Promise<VerifiedArtifact | null> => {
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
    const manifest = protocol.parseManifest(manifestBytes);
    if (
      manifest.projectId !== projectId ||
      finalName !== protocol.finalName(manifest.exportId) ||
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
    const artifact: StudioPieceExportArtifact = {
      schemaVersion: protocol.schemaVersion,
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
    return validateArtifact(artifact, projectId, protocol) ? { artifact, directoryPath } : null;
  } catch {
    return null;
  }
};

const exactCatalogArtifact = (
  request: StudioPieceExportArtifactRequestV3,
  catalog: StudioPieceExportCatalog
): StudioPieceExportArtifact => {
  if (request.projectId !== catalog.projectId || request.expectedCatalogRevision !== catalog.revision) {
    return serviceFailure('stale_export_catalog');
  }
  const artifact = catalog.artifacts.find((candidate) => candidate.id === request.artifactId);
  if (artifact === undefined) return serviceFailure('export_unavailable');
  return artifact;
};

const readExportPayloadSnapshot = async (
  projectId: string,
  artifact: StudioPieceExportArtifact,
  directoryPath: string,
  protocol: StudioPieceExportReadProtocol
): Promise<ExportPayloadSnapshot> => {
  const firstProof = await artifactFromDirectory(projectId, directoryPath, artifact.managedExport.fileName, protocol);
  if (firstProof === null || canonicalJson(firstProof.artifact) !== canonicalJson(artifact)) {
    return serviceFailure('storage_error');
  }
  const manifestBytes = await readBoundedRegularFile(path.join(directoryPath, MANIFEST_FILE_NAME), MANIFEST_MAX_BYTES);
  const manifest = protocol.parseManifest(manifestBytes);
  const photoName = manifest.asset.relativePath;
  if (
    !SAFE_FOLDER_NAME.test(photoName) ||
    path.basename(photoName) !== photoName ||
    photoName !== `photo.${imageExtension(manifest.asset.mimeType)}`
  ) {
    return serviceFailure('storage_error');
  }
  const photoBytes = await readBoundedRegularFile(path.join(directoryPath, photoName), STUDIO_MAX_IMAGE_ASSET_BYTES_V3);
  await verifyImageBytes(photoBytes, manifest.asset);
  if (
    sha256(manifestBytes) !== artifact.manifestSha256 ||
    manifestBytes.byteLength + photoBytes.byteLength !== artifact.byteSize
  ) {
    return serviceFailure('storage_error');
  }
  const finalProof = await artifactFromDirectory(projectId, directoryPath, artifact.managedExport.fileName, protocol);
  if (finalProof === null || canonicalJson(finalProof.artifact) !== canonicalJson(artifact)) {
    return serviceFailure('storage_error');
  }
  return {
    artifact,
    directoryPath,
    files: [
      { name: photoName, bytes: photoBytes },
      { name: MANIFEST_FILE_NAME, bytes: manifestBytes },
    ],
  };
};

const assertDestinationAbsent = async (destinationPath: string): Promise<void> => {
  try {
    await fs.lstat(destinationPath);
    return serviceFailure('storage_error');
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) return;
    if (error instanceof CreativeStudioPilotServiceErrorV3) throw error;
    return serviceFailure('storage_error');
  }
};

const validateCopyDestination = async (
  projectDir: string,
  destinationPath: string
): Promise<{ parentPath: string; parentIdentity: DirectoryIdentityV3 }> => {
  if (
    typeof destinationPath !== 'string' ||
    !path.isAbsolute(destinationPath) ||
    path.resolve(destinationPath) !== destinationPath ||
    path.basename(destinationPath).length === 0
  ) {
    return serviceFailure('storage_error');
  }
  const relativeToProject = path.relative(projectDir, destinationPath);
  const outsideProject =
    relativeToProject === '..' || relativeToProject.startsWith(`..${path.sep}`) || path.isAbsolute(relativeToProject);
  if (relativeToProject === '' || !outsideProject) return serviceFailure('storage_error');
  const parentPath = path.dirname(destinationPath);
  const parentIdentity = await readVerifiedDirectoryIdentity(parentPath);
  return { parentPath, parentIdentity };
};

const pathExists = async (entryPath: string): Promise<boolean> => {
  try {
    await fs.lstat(entryPath);
    return true;
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) return false;
    return serviceFailure('storage_error');
  }
};

const copyPublicationNames = (
  request: StudioPieceExportArtifactRequestV3,
  artifact: StudioPieceExportArtifact,
  destinationName: string,
  schemaVersion: StudioPieceExportSchemaVersion
): { stageName: string; intentName: string; intent: CopyIntent; intentBytes: Buffer } => {
  const artifactSha256 = sha256(Buffer.from(canonicalJson(artifact), 'utf8'));
  const digest = sha256(
    Buffer.from(
      canonicalJson({
        projectId: request.projectId,
        artifactId: request.artifactId,
        catalogRevision: request.expectedCatalogRevision,
        artifactSha256,
        destinationName,
      }),
      'utf8'
    )
  ).slice(0, 48);
  const stageName = `.copy-${digest}.part`;
  const intentName = `.copy-${digest}.intent.json`;
  const intent: CopyIntent = {
    schemaVersion,
    projectId: request.projectId,
    artifactId: request.artifactId,
    catalogRevision: request.expectedCatalogRevision,
    artifactSha256,
    destinationName,
    stageName,
  };
  return { stageName, intentName, intent, intentBytes: Buffer.from(canonicalJson(intent), 'utf8') };
};

const parseCopyIntent = (bytes: Uint8Array, expected: CopyIntent): CopyIntent | null => {
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
  if (
    !isPlainRecord(value) ||
    !hasExactKeys(value, COPY_INTENT_KEYS) ||
    value.schemaVersion !== expected.schemaVersion ||
    typeof value.projectId !== 'string' ||
    !SAFE_PERSISTED_ID.test(value.projectId) ||
    typeof value.artifactId !== 'string' ||
    !SAFE_EXPORT_ID.test(value.artifactId) ||
    !isPositiveInteger(value.catalogRevision) ||
    typeof value.artifactSha256 !== 'string' ||
    !LOWERCASE_SHA256.test(value.artifactSha256) ||
    typeof value.destinationName !== 'string' ||
    path.basename(value.destinationName) !== value.destinationName ||
    typeof value.stageName !== 'string' ||
    !SAFE_FOLDER_NAME.test(value.stageName) ||
    canonicalJson(value) !== text ||
    canonicalJson(value) !== canonicalJson(expected)
  ) {
    return null;
  }
  return value as CopyIntent;
};

const readCopyIntent = async (intentPath: string, expected: CopyIntent): Promise<Buffer | null> => {
  if (!(await pathExists(intentPath))) return null;
  const bytes = await readBoundedRegularFile(intentPath, MARKER_MAX_BYTES);
  return parseCopyIntent(bytes, expected) === null ? serviceFailure('storage_error') : bytes;
};

const removeExactCopyIntent = async (intentPath: string, expectedBytes: Buffer): Promise<void> => {
  const bytes = await readBoundedRegularFile(intentPath, MARKER_MAX_BYTES);
  if (!bytes.equals(expectedBytes)) return serviceFailure('storage_error');
  const stats = await fs.lstat(intentPath);
  if (!stats.isFile() || stats.isSymbolicLink() || stats.nlink !== 1) return serviceFailure('storage_error');
  await fs.unlink(intentPath);
  await syncDirectory(path.dirname(intentPath));
};

const verifyCopyDirectory = async (
  directoryPath: string,
  snapshot: ExportPayloadSnapshot,
  expected?: OwnedCopyProofV3
): Promise<OwnedCopyProofV3> => {
  const openedDirectory = await readVerifiedDirectoryIdentity(directoryPath);
  if (expected !== undefined && !sameDirectoryIdentity(openedDirectory, expected.directory)) {
    return serviceFailure('storage_error');
  }
  const expectedNames = snapshot.files.map(({ name }) => name).toSorted();
  const entries = await fs.readdir(directoryPath, { withFileTypes: true });
  if (
    entries.length !== expectedNames.length ||
    entries.some((entry) => !entry.isFile() || entry.isSymbolicLink()) ||
    canonicalJson(entries.map(({ name }) => name).toSorted()) !== canonicalJson(expectedNames)
  ) {
    return serviceFailure('storage_error');
  }
  const files = new Map<string, DirectoryIdentityV3>();
  for (const source of snapshot.files) {
    const filePath = path.join(directoryPath, source.name);
    const maximumBytes = source.name === MANIFEST_FILE_NAME ? MANIFEST_MAX_BYTES : STUDIO_MAX_IMAGE_ASSET_BYTES_V3;
    const bytes = await readBoundedRegularFile(filePath, maximumBytes);
    if (!bytes.equals(source.bytes)) return serviceFailure('storage_error');
    const stats = await fs.lstat(filePath);
    if (!stats.isFile() || stats.isSymbolicLink() || stats.nlink !== 1) return serviceFailure('storage_error');
    const currentIdentity = directoryIdentity(stats);
    const expectedIdentity = expected?.files.get(source.name);
    if (expectedIdentity !== undefined && !sameDirectoryIdentity(currentIdentity, expectedIdentity)) {
      return serviceFailure('storage_error');
    }
    files.set(source.name, currentIdentity);
  }
  return { directory: openedDirectory, files };
};

const writeCopyDirectory = async (
  directoryPath: string,
  snapshot: ExportPayloadSnapshot
): Promise<OwnedCopyProofV3> => {
  let proof: OwnedCopyProofV3 | null = null;
  try {
    await fs.mkdir(directoryPath, { recursive: false, mode: 0o700 });
    proof = { directory: await readVerifiedDirectoryIdentity(directoryPath), files: new Map() };
    for (const source of snapshot.files) {
      const currentDirectory = await readVerifiedDirectoryIdentity(directoryPath);
      if (!sameDirectoryIdentity(currentDirectory, proof.directory)) return serviceFailure('storage_error');
      await writeExclusiveDurable(path.join(directoryPath, source.name), source.bytes, (created) => {
        proof?.files.set(source.name, created);
      });
    }
    await syncDirectory(directoryPath);
    return verifyCopyDirectory(directoryPath, snapshot, proof);
  } catch (error) {
    if (proof !== null) await removeOwnedCopyDirectory(directoryPath, proof);
    throw error;
  }
};

const removeOwnedCopyDirectory = async (directoryPath: string, proof: OwnedCopyProofV3): Promise<void> => {
  try {
    const currentDirectory = await readVerifiedDirectoryIdentity(directoryPath);
    if (!sameDirectoryIdentity(currentDirectory, proof.directory)) return;
    const entries = await fs.readdir(directoryPath, { withFileTypes: true });
    const expectedNames = [...proof.files.keys()].toSorted();
    if (
      entries.some((entry) => !entry.isFile() || entry.isSymbolicLink()) ||
      canonicalJson(entries.map(({ name }) => name).toSorted()) !== canonicalJson(expectedNames)
    ) {
      return;
    }
    for (const [name, expectedIdentity] of proof.files) {
      const filePath = path.join(directoryPath, name);
      let handle: FileHandle | null = null;
      try {
        handle = await fs.open(filePath, fsConstants.O_RDONLY | NO_FOLLOW);
        const [opened, pathStats] = await Promise.all([handle.stat(), fs.lstat(filePath)]);
        if (
          !opened.isFile() ||
          opened.nlink !== 1 ||
          pathStats.isSymbolicLink() ||
          !sameDirectoryIdentity(directoryIdentity(opened), expectedIdentity) ||
          !sameDirectoryIdentity(directoryIdentity(pathStats), expectedIdentity)
        ) {
          return;
        }
      } finally {
        await handle?.close().catch((): undefined => undefined);
      }
      const finalStats = await fs.lstat(filePath);
      if (
        !finalStats.isFile() ||
        finalStats.isSymbolicLink() ||
        !sameDirectoryIdentity(directoryIdentity(finalStats), expectedIdentity)
      ) {
        return;
      }
      await fs.unlink(filePath);
    }
    const finalDirectory = await readVerifiedDirectoryIdentity(directoryPath);
    if (!sameDirectoryIdentity(finalDirectory, proof.directory) || (await fs.readdir(directoryPath)).length !== 0) {
      return;
    }
    await fs.rmdir(directoryPath);
    await syncDirectory(path.dirname(directoryPath));
  } catch {
    // Never delete a destination whose exact ownership can no longer be proved.
  }
};

const sameExportPayloadSnapshot = (left: ExportPayloadSnapshot, right: ExportPayloadSnapshot): boolean =>
  canonicalJson(left.artifact) === canonicalJson(right.artifact) &&
  left.directoryPath === right.directoryPath &&
  left.files.length === right.files.length &&
  left.files.every((file, index) => {
    const candidate = right.files[index];
    return candidate !== undefined && file.name === candidate.name && file.bytes.equals(candidate.bytes);
  });

const reproveDestinationParent = async (authority: {
  parentPath: string;
  parentIdentity: DirectoryIdentityV3;
}): Promise<void> => {
  const current = await readVerifiedDirectoryIdentity(authority.parentPath);
  if (!sameDirectoryIdentity(current, authority.parentIdentity)) return serviceFailure('storage_error');
};

const quarantineEntry = async (
  exportsRoot: string,
  quarantineRoot: string,
  entryPath: string,
  nonce: string
): Promise<void> => {
  if (path.dirname(entryPath) !== exportsRoot) return serviceFailure('storage_error');
  const name = path.basename(entryPath);
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

const nextTimestamp = (
  requested: string,
  project: StudioPieceExportProjectV3OrV4,
  catalog: StudioPieceExportCatalog
): string => {
  if (!isCanonicalTimestamp(requested)) return serviceFailure('storage_error');
  const floor = Math.max(
    Date.parse(project.updatedAt),
    ...catalog.artifacts.map((artifact) => Date.parse(artifact.createdAt) + 1)
  );
  return new Date(Math.max(Date.parse(requested), floor)).toISOString();
};

const recoverInsideAuthority = async <Project extends StudioPieceExportProjectV3OrV4>(
  authority: StudioPieceExportProjectAuthority<Project>,
  createNonce: () => string,
  onStep: (step: StudioPieceExportRuntimeStepV3, projectId: string) => Promise<void>,
  protocol: StudioPieceExportProtocol<Project>
): Promise<StudioPieceExportCatalog> => {
  const project = authority.project;
  const projectDir = await fs.realpath(authority.projectDir);
  if (projectDir !== authority.projectDir) return serviceFailure('storage_error');
  const exportsRoot = await ensureDirectory(projectDir, EXPORTS_DIRECTORY_NAME);
  const quarantineRoot = await ensureDirectory(exportsRoot, QUARANTINE_DIRECTORY_NAME);
  const entries = await fs.readdir(exportsRoot, { withFileTypes: true });

  const pending = new Map<string, { marker: PendingMarker; markerPath: string }>();
  for (const entry of entries) {
    if (!protocol.recognizesMarkerName(entry.name)) continue;
    const markerPath = path.join(exportsRoot, entry.name);
    if (!entry.isFile() || entry.isSymbolicLink()) {
      await quarantineEntry(exportsRoot, quarantineRoot, markerPath, createNonce());
      continue;
    }
    let marker: PendingMarker | null = null;
    try {
      marker = parsePendingMarker(await readBoundedRegularFile(markerPath, MARKER_MAX_BYTES), project.id, protocol);
    } catch {
      // The bounded marker is isolated below.
    }
    if (marker === null || protocol.markerName(marker.exportId) !== entry.name || pending.has(marker.exportId)) {
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
      const staged = await artifactFromDirectory(project.id, stagePath, marker.finalName, protocol);
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

  const catalogPath = path.join(exportsRoot, protocol.catalogFileName);
  let catalogStatus: 'missing' | 'valid' | 'malformed' = 'missing';
  let catalog = logicalCatalog(project.id, protocol.schemaVersion);
  try {
    const bytes = await readBoundedRegularFile(catalogPath, CATALOG_MAX_BYTES);
    const parsed = parseCatalog(bytes, project.id, protocol);
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
  const verifiedByFolder = new Map<string, VerifiedArtifact>();
  for (const entry of currentEntries) {
    if (!protocol.recognizesFinalName(entry.name)) continue;
    const directoryPath = path.join(exportsRoot, entry.name);
    const verified =
      entry.isDirectory() && !entry.isSymbolicLink()
        ? await artifactFromDirectory(project.id, directoryPath, entry.name, protocol)
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
      (await artifactFromDirectory(project.id, path.join(exportsRoot, marker.finalName), marker.finalName, protocol));
    if (verified !== null && verified.artifact.id === exportId && !recoveredIds.has(exportId)) {
      recovered.push(verified.artifact);
      recoveredIds.add(exportId);
      verifiedByFolder.set(marker.finalName, verified);
    }
  }
  const retained = retainStudioPieceExportArtifacts(recovered);
  const retainedIds = new Set(retained.map((artifact) => artifact.id));
  const changed = !trustedCatalog || canonicalJson(retained) !== canonicalJson(catalog.artifacts);
  const nextCatalog: StudioPieceExportCatalog = {
    schemaVersion: protocol.schemaVersion,
    projectId: project.id,
    revision: trustedCatalog && changed ? catalog.revision + 1 : trustedCatalog ? catalog.revision : 1,
    artifacts: retained,
  };
  if (changed && (catalogStatus !== 'missing' || retained.length > 0)) {
    await writeCatalogDurable(exportsRoot, nextCatalog, createNonce(), protocol.catalogFileName);
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
    if (protocol.recognizesStageName(entry.name) || entry.name.startsWith(`.${protocol.catalogFileName}-`)) {
      await quarantineEntry(exportsRoot, quarantineRoot, path.join(exportsRoot, entry.name), createNonce());
    }
  }
  await authority.assertCurrent();
  await onStep('recovery_complete', project.id);
  return nextCatalog;
};

const findCurrentAsset = (
  project: StudioPieceExportProjectV3OrV4,
  pieceId: string,
  isPieceAvailable: (project: StudioPieceExportProjectV3OrV4, pieceId: string) => boolean
): StudioPieceExportImageAsset => {
  if (!isPieceAvailable(project, pieceId)) return serviceFailure('export_unavailable');
  const piece = project.pieces[pieceId];
  if (piece === undefined || piece.kind !== 'photograph' || piece.currentAssetId === null) {
    return serviceFailure('export_unavailable');
  }
  const asset = project.assets[piece.currentAssetId];
  if (
    asset === undefined ||
    asset.pieceId !== piece.id ||
    asset.projectId !== project.id ||
    asset.mediaKind !== 'image' ||
    ('role' in asset && asset.role !== 'primary')
  ) {
    return serviceFailure('export_unavailable');
  }
  return asset as StudioPieceExportImageAsset;
};

const uniqueExportId = (
  mint: () => string,
  catalog: StudioPieceExportCatalog,
  projectIdentities: Iterable<string>
): string => {
  const unavailable = new Set([...catalog.artifacts.map((artifact) => artifact.id), ...projectIdentities]);
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const candidate = mint();
    if (typeof candidate === 'string' && SAFE_EXPORT_ID.test(candidate) && !unavailable.has(candidate))
      return candidate;
  }
  return serviceFailure('storage_error');
};

const createStudioPieceExportRuntime = <Project extends StudioPieceExportProjectV3OrV4>(
  deps: StudioPieceExportRuntimeCoreDeps<Project>
): StudioPieceExportRuntimeV3 => {
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
      return await deps.store.withProjectAuthority(projectId, async (authority) =>
        projectRendererCatalog(await recoverInsideAuthority(authority, createNonce, onStep, deps.protocol))
      );
    } catch (error) {
      return normalizeExportError(error);
    }
  };

  const describe = async (input: unknown): Promise<{ suggestedName: string }> => {
    try {
      const request: StudioDeliverPieceExportRequestV3 = parseStudioDeliverPieceExportRequestV3(input);
      const project = await deps.store.loadProject(request.projectId);
      if (project.revision !== request.expectedRevision) return serviceFailure('stale_project');
      findCurrentAsset(project, request.pieceId, deps.protocol.isPieceAvailable);
      // The selected exact project decoder guarantees a canonical handle; findCurrentAsset proved ownership.
      const piece = project.pieces[request.pieceId]!;
      return { suggestedName: `piece-${piece.handle}-export` };
    } catch (error) {
      return normalizeExportError(error);
    }
  };

  return {
    describe,
    async create(input) {
      try {
        const request = parseStudioExportPieceRequestV3(input);
        const preliminaryProject = await deps.store.loadProject(request.projectId);
        if (preliminaryProject.revision !== request.expectedRevision) return serviceFailure('stale_project');
        const preliminaryAsset = findCurrentAsset(preliminaryProject, request.pieceId, deps.protocol.isPieceAvailable);
        const mediaProof = await deps.verifyManagedAsset({
          projectId: request.projectId,
          assetId: preliminaryAsset.id,
        });
        return await deps.store.withProjectAuthority(request.projectId, async (authority) => {
          const project = authority.project;
          if (project.revision !== request.expectedRevision) return serviceFailure('stale_project');
          const asset = findCurrentAsset(project, request.pieceId, deps.protocol.isPieceAvailable);
          if (
            mediaProof.asset.mediaKind !== 'image' ||
            ('role' in mediaProof.asset && mediaProof.asset.role !== 'primary') ||
            asset.id !== mediaProof.asset.id ||
            !assetFactsEqual(asset, mediaProof.asset)
          ) {
            return serviceFailure('invalid_media');
          }
          const catalog = await recoverInsideAuthority(authority, createNonce, onStep, deps.protocol);
          if (catalog.revision !== request.expectedCatalogRevision) {
            return serviceFailure('stale_export_catalog');
          }
          const source = await openVerifiedSource(mediaProof.absolutePath, asset);
          try {
            await authority.assertCurrent();
            const exportsRoot = await ensureDirectory(await fs.realpath(authority.projectDir), EXPORTS_DIRECTORY_NAME);
            const quarantineRoot = await ensureDirectory(exportsRoot, QUARANTINE_DIRECTORY_NAME);
            const exportId = uniqueExportId(createExportId, catalog, deps.projectIdentities(project));
            const nonce = createNonce();
            const finalName = deps.protocol.finalName(exportId);
            const stageName = deps.protocol.stageName(exportId, nonce);
            const stagePath = path.join(exportsRoot, stageName);
            const finalPath = path.join(exportsRoot, finalName);
            const markerPath = path.join(exportsRoot, deps.protocol.markerName(exportId));
            const exportedAt = nextTimestamp(now(), project, catalog);
            const relativePhotoPath = `photo.${imageExtension(asset.mimeType)}`;
            const manifest = deps.protocol.buildManifest(project, {
              exportId,
              pieceId: request.pieceId,
              relativePath: relativePhotoPath,
              exportedAt,
            });
            const manifestBytes = deps.protocol.serializeManifest(manifest);

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
            const verifiedStage = await artifactFromDirectory(project.id, stagePath, finalName, deps.protocol);
            if (verifiedStage === null) {
              await fs.rm(stagePath, { recursive: true, force: true });
              await syncDirectory(exportsRoot);
              return serviceFailure('storage_error');
            }
            const marker: PendingMarker = {
              schemaVersion: deps.protocol.schemaVersion,
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

            const artifacts = retainStudioPieceExportArtifacts([...catalog.artifacts, verifiedStage.artifact]);
            const nextCatalog: StudioPieceExportCatalog = {
              schemaVersion: deps.protocol.schemaVersion,
              projectId: project.id,
              revision: catalog.revision + 1,
              artifacts,
            };
            await writeCatalogDurable(exportsRoot, nextCatalog, createNonce(), deps.protocol.catalogFileName);
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
    async copy(rawRequest, destinationPath) {
      try {
        const request = parseStudioPieceExportArtifactRequestV3(rawRequest);
        return await deps.store.withProjectAuthority(request.projectId, async (authority) => {
          const catalog = await recoverInsideAuthority(authority, createNonce, onStep, deps.protocol);
          const artifact = exactCatalogArtifact(request, catalog);
          const projectDir = await fs.realpath(authority.projectDir);
          if (projectDir !== authority.projectDir) return serviceFailure('storage_error');
          const exportsRoot = await ensureDirectory(projectDir, EXPORTS_DIRECTORY_NAME);
          const sourcePath = path.join(exportsRoot, artifact.managedExport.fileName);
          const snapshot = await readExportPayloadSnapshot(request.projectId, artifact, sourcePath, deps.protocol);
          const destination = await validateCopyDestination(projectDir, destinationPath);
          const publication = copyPublicationNames(
            request,
            artifact,
            path.basename(destinationPath),
            deps.protocol.schemaVersion
          );
          const stagePath = path.join(destination.parentPath, publication.stageName);
          const intentPath = path.join(destination.parentPath, publication.intentName);

          const assertCopyAuthority = async (): Promise<void> => {
            await reproveDestinationParent(destination);
            const currentSource = await readExportPayloadSnapshot(
              request.projectId,
              artifact,
              sourcePath,
              deps.protocol
            );
            if (!sameExportPayloadSnapshot(snapshot, currentSource)) return serviceFailure('storage_error');
            const currentCatalog = await recoverInsideAuthority(authority, createNonce, onStep, deps.protocol);
            if (currentCatalog.revision !== request.expectedCatalogRevision) {
              return serviceFailure('stale_export_catalog');
            }
            const currentArtifact = exactCatalogArtifact(request, currentCatalog);
            if (canonicalJson(currentArtifact) !== canonicalJson(artifact)) {
              return serviceFailure('stale_export_catalog');
            }
            await authority.assertCurrent();
          };

          let intentBytes = await readCopyIntent(intentPath, publication.intent);
          const stageExists = await pathExists(stagePath);
          const destinationExists = await pathExists(destinationPath);
          if (intentBytes === null && destinationExists) return serviceFailure('storage_error');
          if (intentBytes !== null && stageExists && destinationExists) return serviceFailure('storage_error');
          if (intentBytes !== null && !stageExists && !destinationExists) return serviceFailure('storage_error');

          if (intentBytes !== null && destinationExists) {
            await verifyCopyDirectory(destinationPath, snapshot);
            await assertCopyAuthority();
            await onStep('copy_intent_removed', request.projectId);
            await removeExactCopyIntent(intentPath, intentBytes);
            return { status: 'copied' };
          }

          let stageProof: OwnedCopyProofV3;
          if (stageExists) {
            stageProof = await verifyCopyDirectory(stagePath, snapshot);
          } else {
            await assertDestinationAbsent(destinationPath);
            stageProof = await writeCopyDirectory(stagePath, snapshot);
            await syncDirectory(destination.parentPath);
            await onStep('copy_stage_closed', request.projectId);
          }

          if (intentBytes === null) {
            await reproveDestinationParent(destination);
            await assertDestinationAbsent(destinationPath);
            await writeExclusiveDurable(intentPath, publication.intentBytes);
            await syncDirectory(destination.parentPath);
            intentBytes = publication.intentBytes;
            await onStep('copy_intent_committed', request.projectId);
          }

          await assertCopyAuthority();
          await verifyCopyDirectory(stagePath, snapshot, stageProof);
          await assertDestinationAbsent(destinationPath);
          await onStep('copy_publish_ready', request.projectId);
          await reproveDestinationParent(destination);
          await assertDestinationAbsent(destinationPath);
          await fs.rename(stagePath, destinationPath);
          await syncDirectory(destination.parentPath);
          await verifyCopyDirectory(destinationPath, snapshot, stageProof);
          await onStep('copy_artifact_published', request.projectId);
          await assertCopyAuthority();
          await onStep('copy_intent_removed', request.projectId);
          await removeExactCopyIntent(intentPath, intentBytes);
          return { status: 'copied' };
        });
      } catch (error) {
        return normalizeExportError(error);
      }
    },
    async resolveRevealPath(rawRequest) {
      try {
        const request = parseStudioPieceExportArtifactRequestV3(rawRequest);
        return await deps.store.withProjectAuthority(request.projectId, async (authority) => {
          const catalog = await recoverInsideAuthority(authority, createNonce, onStep, deps.protocol);
          const artifact = exactCatalogArtifact(request, catalog);
          const projectDir = await fs.realpath(authority.projectDir);
          if (projectDir !== authority.projectDir) return serviceFailure('storage_error');
          const exportsRoot = await ensureDirectory(projectDir, EXPORTS_DIRECTORY_NAME);
          const directoryPath = path.join(exportsRoot, artifact.managedExport.fileName);
          if (path.dirname(directoryPath) !== exportsRoot) return serviceFailure('storage_error');
          await readExportPayloadSnapshot(request.projectId, artifact, directoryPath, deps.protocol);
          await authority.assertCurrent();
          return directoryPath;
        });
      } catch (error) {
        return normalizeExportError(error);
      }
    },
    list: recover,
    recover,
  };
};

const studioPieceExportPersistentIdentitiesV3 = (project: StudioProjectV3): Set<string> =>
  new Set([...Object.keys(project.pieces), ...Object.keys(project.assets), ...Object.keys(project.jobs)]);

/** Creates the isolated schema-6/export-3 runtime; it has no generation, quote, provider, or spend dependency. */
export const createStudioPieceExportRuntimeV3 = (deps: StudioPieceExportRuntimeDepsV3): StudioPieceExportRuntimeV3 =>
  createStudioPieceExportRuntime({
    ...deps,
    store: {
      loadProject: (projectId) => deps.store.loadProjectV3(projectId),
      withProjectAuthority: (projectId, operation) =>
        deps.store.withProjectAuthorityV3(projectId, (authority) => operation(authority)),
    },
    verifyManagedAsset: (input) => deps.media.verifyManagedAssetV3(input),
    protocol: {
      schemaVersion: STUDIO_EXPORT_SCHEMA_VERSION_V3,
      catalogFileName: CATALOG_FILE_NAME_V3,
      finalName: legacyFolderNameForExport,
      stageName: legacyStageNameForExport,
      markerName: legacyMarkerNameForExport,
      stageNonce: (exportId, name) => stageNonceFromName(name, LEGACY_STAGE_PREFIX, exportId),
      recognizesFinalName: (name) => recognizesName(name, LEGACY_FINAL_PREFIX),
      recognizesStageName: (name) => recognizesName(name, LEGACY_STAGE_PREFIX),
      recognizesMarkerName: (name) => recognizesName(name, LEGACY_MARKER_PREFIX, '.json'),
      isPieceAvailable: () => true,
      buildManifest: buildStudioPieceExportManifestV3,
      parseManifest: parseStudioPieceExportManifestV3,
      serializeManifest: serializeStudioPieceExportManifestV3,
    },
    projectIdentities: studioPieceExportPersistentIdentitiesV3,
  });

/**
 * Creates the exact schema-7/export-4 runtime without admitting schema 6 or any export-3 record.
 */
export const createStudioPieceExportRuntimeV4 = (deps: StudioPieceExportRuntimeDepsV4): StudioPieceExportRuntimeV4 =>
  createStudioPieceExportRuntime({
    ...deps,
    store: {
      loadProject: (projectId) => deps.store.loadProjectV4(projectId),
      withProjectAuthority: (projectId, operation) =>
        deps.store.withProjectAuthorityV4(projectId, (authority) => operation(authority)),
    },
    verifyManagedAsset: (input) => deps.media.verifyManagedAssetV4(input),
    protocol: {
      schemaVersion: STUDIO_EXPORT_SCHEMA_VERSION_V4,
      catalogFileName: CATALOG_FILE_NAME_V4,
      finalName: v4FolderNameForExport,
      stageName: v4StageNameForExport,
      markerName: v4MarkerNameForExport,
      stageNonce: (exportId, name) => stageNonceFromName(name, V4_STAGE_PREFIX, exportId),
      recognizesFinalName: (name) => recognizesName(name, V4_FINAL_PREFIX),
      recognizesStageName: (name) => recognizesName(name, V4_STAGE_PREFIX),
      recognizesMarkerName: (name) => recognizesName(name, V4_MARKER_PREFIX, '.json'),
      isPieceAvailable: (project, pieceId) => !isStudioPieceBinnedV4(project, pieceId),
      buildManifest: buildStudioPieceExportManifestV4,
      parseManifest: parseStudioPieceExportManifestV4,
      serializeManifest: serializeStudioPieceExportManifestV4,
    },
    projectIdentities: studioPersistentIdentitiesV4,
  });
