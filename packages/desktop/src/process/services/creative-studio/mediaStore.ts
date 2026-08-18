/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash, randomUUID } from 'node:crypto';
import { constants as fsConstants, createReadStream, createWriteStream, promises as fs } from 'node:fs';
import path from 'node:path';
import { PassThrough, Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { jobOutputRole } from '@/common/types/project/creativeStudioOutputRole';
import type {
  StudioAsset,
  StudioAssetV2,
  StudioBriefReferenceRole,
  StudioDetachBriefReferenceRequest,
  StudioProject,
  StudioProjectV2,
} from '@/common/types/project/creativeStudioTypes';
import {
  allocateStudioBriefReferenceLabel,
  resolveActiveStudioBriefReferences,
  STUDIO_MANAGED_ASSET_COLLECTIONS,
  STUDIO_MAX_ACTIVE_BRIEF_REFERENCES,
} from '@/common/types/project/creativeStudioManagedAssetCollections';
import { reconcileStudioCutsV2, validateStudioProjectV2 } from './service/schema2';
import {
  CreativeStudioStoreError,
  reconcilePersistedStudioCuts,
  STUDIO_PROJECT_V2_MAX_RECORD_BYTES,
  type CreativeStudioStore,
} from './store';
import { downloadRemoteMedia, type RemoteMediaDownloadDeps } from '../remote-media/remoteMediaDownloader';

const SAFE_ID = /^[A-Za-z0-9_-]{1,256}$/;
const ownRecordValue = <Value>(record: Readonly<Record<string, Value>>, key: string): Value | undefined =>
  Object.hasOwn(record, key) ? record[key] : undefined;

const defineRecordValue = <Value>(record: Record<string, Value>, key: string, value: Value): void => {
  Object.defineProperty(record, key, { value, writable: true, enumerable: true, configurable: true });
};

const resolveActiveStudioBriefReferencesV2 = (
  assets: Readonly<Record<string, StudioAssetV2>>
): StudioAssetV2[] | null => {
  const compatibleAssets = Object.create(null) as Record<string, StudioAsset>;
  for (const [assetId, asset] of Object.entries(assets)) {
    defineRecordValue(compatibleAssets, assetId, { ...asset, sceneId: asset.clipId });
  }
  const resolved = resolveActiveStudioBriefReferences(compatibleAssets);
  if (resolved === null) return null;
  const originals = resolved.map((asset) => ownRecordValue(assets, asset.id));
  return originals.every((asset): asset is StudioAssetV2 => asset !== undefined) ? originals : null;
};

type VerifiedIdentity = { size: number; mtimeMs: number; sha256: string };
const verifiedFiles = new Map<string, VerifiedIdentity>();
const VERIFIED_FILE_CACHE_LIMIT = 256;

const cacheVerifiedIdentity = (filePath: string, identity: VerifiedIdentity): void => {
  verifiedFiles.delete(filePath);
  verifiedFiles.set(filePath, identity);
  if (verifiedFiles.size <= VERIFIED_FILE_CACHE_LIMIT) return;
  const oldestKey = verifiedFiles.keys().next().value;
  if (oldestKey !== undefined) verifiedFiles.delete(oldestKey);
};

export type StudioMediaLimits = {
  referenceMaxBytes: number;
  imageOutputMaxBytes: number;
  videoOutputMaxBytes: number;
  projectMaxBytes: number;
};

export const STUDIO_MEDIA_LIMITS: Readonly<StudioMediaLimits> = Object.freeze({
  referenceMaxBytes: 30 * 1024 * 1024,
  imageOutputMaxBytes: 50 * 1024 * 1024,
  videoOutputMaxBytes: 512 * 1024 * 1024,
  projectMaxBytes: 5 * 1024 * 1024 * 1024,
});
const MIME_SIGNATURES = [
  {
    mimeType: 'image/png',
    extension: 'png',
    match: (bytes: Buffer) => bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')),
  },
  {
    mimeType: 'image/jpeg',
    extension: 'jpg',
    match: (bytes: Buffer) => bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
  },
  {
    mimeType: 'image/webp',
    extension: 'webp',
    match: (bytes: Buffer) => bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP',
  },
  {
    mimeType: 'video/mp4',
    extension: 'mp4',
    match: (bytes: Buffer) => bytes.subarray(4, 8).toString() === 'ftyp',
  },
  {
    mimeType: 'video/webm',
    extension: 'webm',
    match: (bytes: Buffer) => bytes.subarray(0, 4).equals(Buffer.from('1a45dfa3', 'hex')),
  },
] as const;

export class CreativeStudioMediaError extends Error {
  readonly code: 'invalid_media' | 'storage_error' | 'stale_project' | 'not_found' | 'job_inactive';

  constructor(code: CreativeStudioMediaError['code']) {
    super(code);
    this.name = 'CreativeStudioMediaError';
    this.code = code;
  }
}

export type InternalImportReferenceInput = {
  projectId: string;
  sourcePath: string;
  sceneId?: string;
  briefReferenceRole?: StudioBriefReferenceRole;
  expectedRevision: number;
  returnProject?: boolean;
};

export type StudioMediaImportResult = { asset: StudioAsset; project: StudioProject };

export type InternalImportReferenceInputV2 = Omit<InternalImportReferenceInput, 'sceneId'> & {
  clipId?: string;
};

export type StudioMediaImportResultV2 = { asset: StudioAssetV2; project: StudioProjectV2 };

export type InternalExportStudioAssetsInput = {
  projectId: string;
  destinationDirectory: string;
  includeReferences: boolean;
  timestamp?: string;
};

export type PersistProviderOutputInput = {
  projectId: string;
  sceneId: string;
  expectedRevision: number;
  mediaKind: 'image' | 'video';
  declaredMimeType: string;
  declaredByteSize?: number;
  width?: number;
  height?: number;
  durationSeconds?: number;
  body: AsyncIterable<Uint8Array>;
};

export type PersistProviderOutputUrlInput = Omit<PersistProviderOutputInput, 'body'> & {
  url: string;
  downloader: Omit<RemoteMediaDownloadDeps, 'write' | 'maxBytes'>;
};

export type PersistProviderJobOutputInput = Omit<PersistProviderOutputInput, 'expectedRevision'> & {
  jobId: string;
};

export type PersistProviderJobOutputUrlInput = Omit<PersistProviderOutputUrlInput, 'expectedRevision'> & {
  jobId: string;
};

export type PersistProviderJobOutputInputV2 = Omit<PersistProviderJobOutputInput, 'sceneId'> & {
  clipId: string;
};

export type PersistProviderJobOutputUrlInputV2 = Omit<PersistProviderJobOutputUrlInput, 'sceneId'> & {
  clipId: string;
};

export type PersistProviderJobPosterInput = {
  projectId: string;
  sceneId: string;
  jobId: string;
  primaryAssetId: string;
  declaredMimeType: string;
  declaredByteSize?: number;
  width?: number;
  height?: number;
  body: AsyncIterable<Uint8Array>;
};

export type PersistProviderJobPosterUrlInput = Omit<PersistProviderJobPosterInput, 'body'> & {
  url: string;
  downloader: Omit<RemoteMediaDownloadDeps, 'write' | 'maxBytes'>;
};

export type PersistProviderJobPosterInputV2 = Omit<PersistProviderJobPosterInput, 'sceneId'> & {
  clipId: string;
};

export type PersistProviderJobPosterUrlInputV2 = Omit<PersistProviderJobPosterUrlInput, 'sceneId'> & {
  clipId: string;
};

export type PersistCapturedPosterInput = {
  projectId: string;
  sceneId: string;
  videoAssetId: string;
  width: number;
  height: number;
  declaredByteSize?: number;
  body: AsyncIterable<Uint8Array>;
};

export type PersistCapturedPosterInputV2 = Omit<PersistCapturedPosterInput, 'sceneId'> & {
  clipId: string;
};

/** A derived project output whose lifecycle is independent from editable scenes. */
export type PersistProjectOutputInput = {
  projectId: string;
  declaredMimeType: 'video/mp4';
  declaredByteSize?: number;
  width: number;
  height: number;
  durationSeconds?: number;
  body: AsyncIterable<Uint8Array>;
};

export type PersistProjectOutputInputV2 = PersistProjectOutputInput;

export type InternalStudioExportResult = {
  folderName: string;
  exported: Array<{ assetId: string; fileName: string }>;
  missingSceneIds: string[];
};

export type StudioMediaStore = {
  importReferenceFromPath(
    input: InternalImportReferenceInput & { returnProject: true }
  ): Promise<StudioMediaImportResult>;
  importReferenceFromPath(input: InternalImportReferenceInput): Promise<StudioAsset>;
  detachBriefReference(input: StudioDetachBriefReferenceRequest): Promise<StudioProject>;
  persistProviderOutput(input: PersistProviderOutputInput): Promise<StudioAsset>;
  persistProviderOutputFromUrl(input: PersistProviderOutputUrlInput): Promise<StudioAsset>;
  persistProviderOutputForJob(input: PersistProviderJobOutputInput): Promise<StudioAsset>;
  persistProviderOutputFromUrlForJob(input: PersistProviderJobOutputUrlInput): Promise<StudioAsset>;
  persistProviderPosterForJob(input: PersistProviderJobPosterInput): Promise<StudioAsset>;
  persistProviderPosterFromUrlForJob(input: PersistProviderJobPosterUrlInput): Promise<StudioAsset>;
  persistCapturedPoster(input: PersistCapturedPosterInput): Promise<StudioAsset>;
  persistProjectOutput(input: PersistProjectOutputInput): Promise<StudioAsset>;
  getLatestProjectOutput(projectId: string): Promise<StudioAsset | null>;
  resolveAsset(
    projectId: string,
    assetId: string
  ): Promise<{
    asset: StudioAsset;
    openVerifiedStream: (start?: number, end?: number) => Promise<Readable>;
  } | null>;
  resolveProviderInput(
    projectId: string,
    assetId: string
  ): Promise<{
    assetId: string;
    mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
    byteSize: number;
    openStream: () => Promise<Readable>;
    asDataUrl: (maxBytes: number) => Promise<string>;
  }>;
  exportAssetsToDirectory(input: InternalExportStudioAssetsInput): Promise<InternalStudioExportResult>;
  cleanupOrphanParts(): Promise<void>;
  importReferenceFromPathV2(
    input: InternalImportReferenceInputV2 & { returnProject: true }
  ): Promise<StudioMediaImportResultV2>;
  importReferenceFromPathV2(input: InternalImportReferenceInputV2): Promise<StudioAssetV2>;
  detachBriefReferenceV2(input: StudioDetachBriefReferenceRequest): Promise<StudioProjectV2>;
  persistProviderOutputForJobV2(input: PersistProviderJobOutputInputV2): Promise<StudioAssetV2>;
  persistProviderOutputFromUrlForJobV2(input: PersistProviderJobOutputUrlInputV2): Promise<StudioAssetV2>;
  persistProviderPosterForJobV2(input: PersistProviderJobPosterInputV2): Promise<StudioAssetV2>;
  persistProviderPosterFromUrlForJobV2(input: PersistProviderJobPosterUrlInputV2): Promise<StudioAssetV2>;
  persistCapturedPosterV2(input: PersistCapturedPosterInputV2): Promise<StudioAssetV2>;
  persistProjectOutputV2(input: PersistProjectOutputInputV2): Promise<StudioAssetV2>;
  getLatestProjectOutputV2(projectId: string): Promise<StudioAssetV2 | null>;
  resolveAssetV2(
    projectId: string,
    assetId: string
  ): Promise<{
    asset: StudioAssetV2;
    openVerifiedStream: (start?: number, end?: number) => Promise<Readable>;
  } | null>;
  resolveProviderInputV2(
    projectId: string,
    assetId: string
  ): Promise<{
    assetId: string;
    mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
    byteSize: number;
    openStream: () => Promise<Readable>;
    asDataUrl: (maxBytes: number) => Promise<string>;
  }>;
  cleanupOrphanPartsV2(): Promise<void>;
};

export type StudioMediaStoreDeps = {
  store: CreativeStudioStore;
  createId?: () => string;
  now?: () => string;
  /** Injectable to fail before starting a write when the volume cannot fit it. */
  getAvailableDiskBytes?: (directory: string) => Promise<number>;
  /** Test seam for byte-boundary coverage without allocating production-sized fixtures. */
  limits?: Partial<StudioMediaLimits>;
  /** Test seam for deterministic replacement exactly before cleanup takes ownership of a path. */
  beforeCleanupOwnership?: (filePath: string) => Promise<void>;
  /** Test seam for a replacement after no-replace restoration of a mismatched quarantine. */
  afterCleanupRestore?: (filePath: string, quarantinePath: string) => Promise<void>;
  /** Test seam for a directory replacement exactly before a schema-2 managed mutation fence. */
  beforeV2ManagedMutation?: (projectDirectory: string) => Promise<void>;
};

const truncateUtf8 = (value: string, maxBytes: number): string => {
  let result = '';
  let byteLength = 0;
  for (const character of value) {
    const characterBytes = Buffer.byteLength(character, 'utf8');
    if (byteLength + characterBytes > maxBytes) break;
    result += character;
    byteLength += characterBytes;
  }
  return result;
};

type FileIdentity = { dev: string; ino: string };

type VerifiedDirectory = {
  directory: string;
  identity: FileIdentity;
};

type StudioProjectPathAuthorityV2 = {
  projectId: string;
  projectDir: string;
  directoryIdentity: FileIdentity;
  manifestPath: string;
  manifestIdentity: FileIdentity;
  manifestByteLength: number;
  manifestSha256: string;
};

type ManagedPathCleanupOutcomeV2 = 'completed' | 'authority_changed';

type CapturedStudioProjectPathAuthorityV2 = {
  authority: StudioProjectPathAuthorityV2;
  project: StudioProjectV2;
};

const fileIdentity = (stats: { dev: number | bigint; ino: number | bigint }): FileIdentity => ({
  dev: String(stats.dev),
  ino: String(stats.ino),
});

const captureVerifiedDirectory = async (directory: string): Promise<VerifiedDirectory> => {
  try {
    const stats = await fs.lstat(directory);
    if (!stats.isDirectory() || stats.isSymbolicLink()) throw new CreativeStudioMediaError('storage_error');
    return { directory, identity: fileIdentity(stats) };
  } catch (error) {
    if (error instanceof CreativeStudioMediaError) throw error;
    throw new CreativeStudioMediaError('storage_error');
  }
};

const assertVerifiedDirectory = async (expected: VerifiedDirectory): Promise<void> => {
  const current = await captureVerifiedDirectory(expected.directory);
  if (current.identity.dev !== expected.identity.dev || current.identity.ino !== expected.identity.ino) {
    throw new CreativeStudioMediaError('storage_error');
  }
};

const captureStudioProjectPathAuthorityV2 = async (
  projectId: string,
  projectDir: string
): Promise<CapturedStudioProjectPathAuthorityV2> => {
  let handle: Awaited<ReturnType<typeof fs.open>> | null = null;
  try {
    const directoryStats = await fs.lstat(projectDir);
    if (
      !directoryStats.isDirectory() ||
      directoryStats.isSymbolicLink() ||
      (await fs.realpath(projectDir)) !== projectDir
    ) {
      throw new CreativeStudioMediaError('storage_error');
    }
    const manifestPath = path.join(projectDir, 'project.json');
    if (path.dirname(manifestPath) !== projectDir) throw new CreativeStudioMediaError('storage_error');
    const manifestStats = await fs.lstat(manifestPath);
    if (
      !manifestStats.isFile() ||
      manifestStats.isSymbolicLink() ||
      (await fs.realpath(manifestPath)) !== manifestPath
    ) {
      throw new CreativeStudioMediaError('storage_error');
    }
    const manifestIdentity = fileIdentity(manifestStats);
    handle = await fs.open(
      manifestPath,
      fsConstants.O_RDONLY | (typeof fsConstants.O_NOFOLLOW === 'number' ? fsConstants.O_NOFOLLOW : 0)
    );
    const before = await handle.stat();
    const beforeIdentity = fileIdentity(before);
    if (
      !before.isFile() ||
      beforeIdentity.dev !== manifestIdentity.dev ||
      beforeIdentity.ino !== manifestIdentity.ino ||
      before.size < 2 ||
      before.size > STUDIO_PROJECT_V2_MAX_RECORD_BYTES
    ) {
      throw new CreativeStudioMediaError('storage_error');
    }
    const bytes = await handle.readFile();
    const parsed = JSON.parse(bytes.toString('utf8')) as unknown;
    const after = await handle.stat();
    const afterIdentity = fileIdentity(after);
    if (
      afterIdentity.dev !== beforeIdentity.dev ||
      afterIdentity.ino !== beforeIdentity.ino ||
      bytes.length !== before.size ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs ||
      !validateStudioProjectV2(parsed) ||
      parsed.schemaVersion !== 2 ||
      parsed.id !== projectId
    ) {
      throw new CreativeStudioMediaError('storage_error');
    }
    const finalDirectoryStats = await fs.lstat(projectDir);
    const finalManifestStats = await fs.lstat(manifestPath);
    const finalDirectoryIdentity = fileIdentity(finalDirectoryStats);
    const finalManifestIdentity = fileIdentity(finalManifestStats);
    if (
      !finalDirectoryStats.isDirectory() ||
      finalDirectoryStats.isSymbolicLink() ||
      finalDirectoryIdentity.dev !== String(directoryStats.dev) ||
      finalDirectoryIdentity.ino !== String(directoryStats.ino) ||
      !finalManifestStats.isFile() ||
      finalManifestStats.isSymbolicLink() ||
      finalManifestIdentity.dev !== manifestIdentity.dev ||
      finalManifestIdentity.ino !== manifestIdentity.ino ||
      finalManifestStats.size !== before.size ||
      finalManifestStats.mtimeMs !== before.mtimeMs
    ) {
      throw new CreativeStudioMediaError('storage_error');
    }
    return {
      authority: {
        projectId,
        projectDir,
        directoryIdentity: fileIdentity(directoryStats),
        manifestPath,
        manifestIdentity,
        manifestByteLength: bytes.length,
        manifestSha256: createHash('sha256').update(bytes).digest('hex'),
      },
      project: parsed,
    };
  } catch (error) {
    if (error instanceof CreativeStudioMediaError) throw error;
    throw new CreativeStudioMediaError('storage_error');
  } finally {
    await handle?.close().catch((): undefined => undefined);
  }
};

const assertStudioProjectPathAuthorityV2 = async (authority: StudioProjectPathAuthorityV2): Promise<void> => {
  const current = (await captureStudioProjectPathAuthorityV2(authority.projectId, authority.projectDir)).authority;
  if (
    current.directoryIdentity.dev !== authority.directoryIdentity.dev ||
    current.directoryIdentity.ino !== authority.directoryIdentity.ino ||
    current.manifestPath !== authority.manifestPath ||
    current.manifestIdentity.dev !== authority.manifestIdentity.dev ||
    current.manifestIdentity.ino !== authority.manifestIdentity.ino ||
    current.manifestByteLength !== authority.manifestByteLength ||
    current.manifestSha256 !== authority.manifestSha256
  ) {
    throw new CreativeStudioMediaError('storage_error');
  }
};

/** Produces a portable basename; callers still acquire the directory atomically. */
export const sanitizeStudioExportFolderName = (projectName: string): string => {
  const sanitized = projectName
    .replace(/[<>:"/\\|?*]|\p{Cc}/gu, '_')
    .trim()
    .replace(/[. ]+$/g, '');
  return sanitized || 'creative-studio-project';
};

const MAX_SCENE_EXPORT_SLUG_LENGTH = 40;

/** Builds a portable scene filename while preserving the canonical scene-order number. */
export const buildStudioSceneExportFileName = (sceneNumber: number, title: string, extension: string): string => {
  const slug = title
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SCENE_EXPORT_SLUG_LENGTH)
    .replace(/-+$/g, '');
  const scenePrefix = `scene-${String(sceneNumber).padStart(2, '0')}`;
  return `${scenePrefix}${slug ? `-${slug}` : ''}${extension}`;
};

/** Creates a new directory only; a collision never causes an existing export to be reused. */
export const acquireStudioExportDirectory = async (
  destinationDirectory: string,
  projectName: string,
  timestamp: string
): Promise<{ folderName: string; directory: string; identity: FileIdentity }> => {
  if (!/^\d{8}-\d{6}$/.test(timestamp)) throw new CreativeStudioMediaError('storage_error');
  const verifiedDestination = await captureVerifiedDirectory(destinationDirectory);
  const sanitizedProjectName = sanitizeStudioExportFolderName(projectName);
  for (let suffix = 1; suffix < 10_000; suffix += 1) {
    const suffixText = `-${timestamp}${suffix === 1 ? '' : `-${suffix}`}`;
    const availableNameBytes = 255 - Buffer.byteLength(suffixText, 'utf8');
    const projectComponent = truncateUtf8(sanitizedProjectName, availableNameBytes);
    if (!projectComponent) throw new CreativeStudioMediaError('storage_error');
    const folderName = `${projectComponent}${suffixText}`;
    const directory = path.join(destinationDirectory, folderName);
    if (path.dirname(directory) !== destinationDirectory) throw new CreativeStudioMediaError('storage_error');
    try {
      await assertVerifiedDirectory(verifiedDestination);
      await fs.mkdir(directory);
      const verifiedDirectory = await captureVerifiedDirectory(directory);
      await assertVerifiedDirectory(verifiedDestination);
      return { folderName, directory, identity: verifiedDirectory.identity };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw new CreativeStudioMediaError('storage_error');
      await assertVerifiedDirectory(verifiedDestination);
    }
  }
  throw new CreativeStudioMediaError('storage_error');
};

const regularFile = async (file: string): Promise<Awaited<ReturnType<typeof fs.lstat>>> => {
  const stats = await fs.lstat(file);
  if (!stats.isFile() || stats.isSymbolicLink()) throw new CreativeStudioMediaError('storage_error');
  return stats;
};

type VerifiedReadExpectation = {
  dev: string;
  ino: string;
  byteSize: number;
  mtimeMs: number;
  sha256: string;
  mimeType: string;
  verifyContent?: boolean;
};

/** Opens a file only after comparing path and descriptor identity, so a swap after validation is rejected. */
export const openVerifiedReadStream = async (
  filePath: string,
  start?: number,
  end?: number,
  beforeOpen?: () => Promise<void>,
  expected?: VerifiedReadExpectation
): Promise<Readable> => {
  const before = await regularFile(filePath);
  const beforeIdentity = fileIdentity(before);
  if (
    expected &&
    (beforeIdentity.dev !== expected.dev ||
      beforeIdentity.ino !== expected.ino ||
      before.size !== expected.byteSize ||
      before.mtimeMs !== expected.mtimeMs)
  ) {
    throw new CreativeStudioMediaError('storage_error');
  }
  await beforeOpen?.();
  const handle = await fs.open(filePath, 'r');
  try {
    const opened = await handle.stat();
    const openedIdentity = fileIdentity(opened);
    if (
      beforeIdentity.dev !== openedIdentity.dev ||
      beforeIdentity.ino !== openedIdentity.ino ||
      !opened.isFile() ||
      (expected !== undefined &&
        (openedIdentity.dev !== expected.dev ||
          openedIdentity.ino !== expected.ino ||
          opened.size !== expected.byteSize ||
          opened.mtimeMs !== expected.mtimeMs))
    ) {
      throw new CreativeStudioMediaError('storage_error');
    }
    if (expected && expected.verifyContent !== false) {
      const hash = createHash('sha256');
      const readBuffer = Buffer.allocUnsafe(64 * 1024);
      let sample = Buffer.alloc(0);
      let position = 0;
      while (position < expected.byteSize) {
        const { bytesRead } = await handle.read(
          readBuffer,
          0,
          Math.min(readBuffer.length, expected.byteSize - position),
          position
        );
        if (bytesRead === 0) throw new CreativeStudioMediaError('storage_error');
        const bytes = readBuffer.subarray(0, bytesRead);
        hash.update(bytes);
        if (sample.length < 32) sample = Buffer.concat([sample, bytes]).subarray(0, 32);
        position += bytesRead;
      }
      const afterVerification = await handle.stat();
      const afterIdentity = fileIdentity(afterVerification);
      const signature = sniff(sample);
      if (
        afterIdentity.dev !== expected.dev ||
        afterIdentity.ino !== expected.ino ||
        afterVerification.size !== expected.byteSize ||
        hash.digest('hex') !== expected.sha256 ||
        !signature ||
        signature.mimeType !== expected.mimeType
      ) {
        throw new CreativeStudioMediaError('storage_error');
      }
    }
    const stream = createReadStream(filePath, {
      fd: handle.fd,
      autoClose: false,
      start,
      end,
    });
    let closed = false;
    const closeHandle = (): void => {
      if (closed) return;
      closed = true;
      void handle.close().catch((): undefined => undefined);
    };
    stream.once('end', closeHandle);
    stream.once('error', closeHandle);
    stream.once('close', closeHandle);
    return stream;
  } catch (error) {
    await handle.close().catch((): undefined => undefined);
    throw error;
  }
};

/** Default production disk preflight; injectable tests can still model exact capacity boundaries. */
export const getAvailableStudioDiskBytes = async (directory: string): Promise<number> => {
  try {
    const stats = await fs.statfs(directory);
    const available = stats.bavail * stats.bsize;
    if (!Number.isFinite(available) || available < 0) throw new CreativeStudioMediaError('storage_error');
    return Number.isSafeInteger(available) ? available : Number.MAX_SAFE_INTEGER;
  } catch (error) {
    if (error instanceof CreativeStudioMediaError) throw error;
    throw new CreativeStudioMediaError('storage_error');
  }
};

const ensureManagedDirectory = async (projectDir: string, name: string): Promise<string> => {
  const directory = path.join(projectDir, name);
  if (path.dirname(directory) !== projectDir) throw new CreativeStudioMediaError('storage_error');
  await fs.mkdir(directory, { recursive: true });
  const stats = await fs.lstat(directory);
  if (!stats.isDirectory() || stats.isSymbolicLink() || (await fs.realpath(directory)) !== directory) {
    throw new CreativeStudioMediaError('storage_error');
  }
  return directory;
};

/** fsyncs a fresh part, then links it into place without ever overwriting an existing asset. */
const finalizeManagedPart = async (
  partPath: string,
  partsDir: string,
  destinationPath: string,
  destinationDir: string
): Promise<FileIdentity> => {
  if (path.dirname(partPath) !== partsDir || path.dirname(destinationPath) !== destinationDir) {
    throw new CreativeStudioMediaError('storage_error');
  }
  await ensureManagedDirectory(path.dirname(partsDir), path.basename(partsDir));
  await ensureManagedDirectory(path.dirname(destinationDir), path.basename(destinationDir));
  const partStats = await regularFile(partPath);
  if ((await fs.realpath(partPath)) !== partPath) throw new CreativeStudioMediaError('storage_error');
  const handle = await fs.open(partPath, 'r');
  let linkedIdentity: FileIdentity | null = null;
  try {
    const opened = await handle.stat();
    const partIdentity = fileIdentity(partStats);
    const openedIdentity = fileIdentity(opened);
    if (openedIdentity.dev !== partIdentity.dev || openedIdentity.ino !== partIdentity.ino || !opened.isFile()) {
      throw new CreativeStudioMediaError('storage_error');
    }
    await handle.sync();
    const verifiedIdentity = openedIdentity;
    try {
      // Hard-link creation is atomic on the project volume and fails with
      // EEXIST, unlike rename(), which can silently replace an existing asset.
      await fs.link(partPath, destinationPath);
      const linkedStats = await fs.lstat(destinationPath);
      linkedIdentity = fileIdentity(linkedStats);
      if (!linkedStats.isFile() || linkedStats.isSymbolicLink()) {
        throw new CreativeStudioMediaError('storage_error');
      }
      const destinationHandle = await fs.open(destinationPath, 'r');
      try {
        const destinationStats = await destinationHandle.stat();
        const destinationIdentity = fileIdentity(destinationStats);
        if (
          !destinationStats.isFile() ||
          destinationIdentity.dev !== linkedIdentity.dev ||
          destinationIdentity.ino !== linkedIdentity.ino ||
          destinationIdentity.dev !== verifiedIdentity.dev ||
          destinationIdentity.ino !== verifiedIdentity.ino
        ) {
          throw new CreativeStudioMediaError('storage_error');
        }
      } finally {
        await destinationHandle.close();
      }
      await fs.unlink(partPath);
      verifiedFiles.delete(destinationPath);
      return verifiedIdentity;
    } catch (error) {
      if (linkedIdentity) {
        try {
          const destinationStats = await fs.lstat(destinationPath);
          const destinationIdentity = fileIdentity(destinationStats);
          if (destinationIdentity.dev === linkedIdentity.dev && destinationIdentity.ino === linkedIdentity.ino) {
            await fs.unlink(destinationPath);
          }
        } catch {
          // The outer operation reports a stable storage error.
        }
      }
      throw error;
    }
  } finally {
    await handle.close();
  }
};

/** Schema-2 finalization binds the pathname to the writer inode and a captured project authority. */
const finalizeManagedPartV2 = async (
  partPath: string,
  partsDir: string,
  destinationPath: string,
  destinationDir: string,
  expectedPartIdentity: FileIdentity,
  beforeMutation: () => Promise<void>,
  onDestinationLinked: (identity: FileIdentity) => void
): Promise<FileIdentity> => {
  if (path.dirname(partPath) !== partsDir || path.dirname(destinationPath) !== destinationDir) {
    throw new CreativeStudioMediaError('storage_error');
  }
  await beforeMutation();
  const partStats = await regularFile(partPath);
  const partIdentity = fileIdentity(partStats);
  if (
    partIdentity.dev !== expectedPartIdentity.dev ||
    partIdentity.ino !== expectedPartIdentity.ino ||
    (await fs.realpath(partPath)) !== partPath
  ) {
    throw new CreativeStudioMediaError('storage_error');
  }
  const handle = await fs.open(partPath, 'r');
  let linkedIdentity: FileIdentity | null = null;
  try {
    await beforeMutation();
    const opened = await handle.stat();
    const openedIdentity = fileIdentity(opened);
    if (
      !opened.isFile() ||
      openedIdentity.dev !== expectedPartIdentity.dev ||
      openedIdentity.ino !== expectedPartIdentity.ino
    ) {
      throw new CreativeStudioMediaError('storage_error');
    }
    await handle.sync();
    try {
      await beforeMutation();
      await fs.link(partPath, destinationPath);
      const linkedStats = await fs.lstat(destinationPath);
      const observedLinkedIdentity = fileIdentity(linkedStats);
      if (
        !linkedStats.isFile() ||
        linkedStats.isSymbolicLink() ||
        observedLinkedIdentity.dev !== expectedPartIdentity.dev ||
        observedLinkedIdentity.ino !== expectedPartIdentity.ino
      ) {
        throw new CreativeStudioMediaError('storage_error');
      }
      linkedIdentity = expectedPartIdentity;
      onDestinationLinked(expectedPartIdentity);
      await beforeMutation();
      const destinationHandle = await fs.open(destinationPath, 'r');
      try {
        await beforeMutation();
        const destinationStats = await destinationHandle.stat();
        const destinationIdentity = fileIdentity(destinationStats);
        if (
          !destinationStats.isFile() ||
          destinationIdentity.dev !== linkedIdentity.dev ||
          destinationIdentity.ino !== linkedIdentity.ino ||
          destinationIdentity.dev !== expectedPartIdentity.dev ||
          destinationIdentity.ino !== expectedPartIdentity.ino
        ) {
          throw new CreativeStudioMediaError('storage_error');
        }
      } finally {
        await destinationHandle.close();
      }
      await beforeMutation();
      await fs.unlink(partPath);
      verifiedFiles.delete(destinationPath);
      return expectedPartIdentity;
    } catch (error) {
      if (linkedIdentity !== null) {
        try {
          await beforeMutation();
          const destinationStats = await fs.lstat(destinationPath);
          const destinationIdentity = fileIdentity(destinationStats);
          if (destinationIdentity.dev === linkedIdentity.dev && destinationIdentity.ino === linkedIdentity.ino) {
            await fs.unlink(destinationPath);
          }
        } catch {
          // Never broaden cleanup when the schema-2 authority or linked identity changed.
        }
      }
      throw error;
    }
  } finally {
    await handle.close();
  }
};

/**
 * Atomically takes ownership of the current directory entry before inspecting it. A mismatched
 * entry may be restored without replacement, but is always retained in quarantine for recovery.
 */
const unlinkIfIdentityMatches = async (
  filePath: string,
  expected: FileIdentity,
  beforeOwnership?: (filePath: string) => Promise<void>,
  afterRestore?: (filePath: string, quarantinePath: string) => Promise<void>
): Promise<void> => {
  let quarantineDirectory: string | null = null;
  let quarantinePath: string | null = null;
  try {
    quarantineDirectory = await fs.mkdtemp(path.join(path.dirname(filePath), '.studio-cleanup-'));
    quarantinePath = path.join(quarantineDirectory, path.basename(filePath));
    await beforeOwnership?.(filePath);
    await fs.rename(filePath, quarantinePath);
  } catch {
    if (quarantineDirectory !== null) {
      await fs.rmdir(quarantineDirectory).catch((): undefined => undefined);
    }
    return;
  }
  if (quarantineDirectory === null || quarantinePath === null) return;

  try {
    const stats = await fs.lstat(quarantinePath);
    const current = fileIdentity(stats);
    if (stats.isFile() && !stats.isSymbolicLink() && current.dev === expected.dev && current.ino === expected.ino) {
      await fs.unlink(quarantinePath);
    } else {
      try {
        // link() never replaces a new owner at the original path. If that path is occupied or
        // restoration otherwise fails, the unverified entry remains in its private quarantine.
        // The quarantine is retained even after restoration so no later pathname race can remove
        // the final link to an inode that this cleanup operation does not own.
        await fs.link(quarantinePath, filePath);
        await afterRestore?.(filePath, quarantinePath);
      } catch {
        // Preserve the unverified entry in quarantine rather than broadening cleanup.
      }
    }
  } catch {
    // Cleanup is best-effort; unverifiable quarantine contents are preserved.
  } finally {
    await fs.rmdir(quarantineDirectory).catch((): undefined => undefined);
  }
};

const assertVerifiedDirectories = async (directories: VerifiedDirectory[]): Promise<void> => {
  await Promise.all(directories.map(assertVerifiedDirectory));
};

const createVerifiedExportSubdirectory = async (
  parent: VerifiedDirectory,
  name: string
): Promise<VerifiedDirectory> => {
  const directory = path.join(parent.directory, name);
  if (path.dirname(directory) !== parent.directory) throw new CreativeStudioMediaError('storage_error');
  try {
    await assertVerifiedDirectory(parent);
    await fs.mkdir(directory);
    const verified = await captureVerifiedDirectory(directory);
    await assertVerifiedDirectory(parent);
    return verified;
  } catch (error) {
    if (error instanceof CreativeStudioMediaError) throw error;
    throw new CreativeStudioMediaError('storage_error');
  }
};

/**
 * Opens a fresh export file without following its final component, verifies the
 * parent identity again before any bytes are written, and keeps all writes on
 * that descriptor if the pathname is moved later.
 */
const writeVerifiedExportFile = async (
  filePath: string,
  parent: VerifiedDirectory,
  ancestors: VerifiedDirectory[],
  write: (handle: Awaited<ReturnType<typeof fs.open>>) => Promise<void>
): Promise<void> => {
  if (path.dirname(filePath) !== parent.directory) throw new CreativeStudioMediaError('storage_error');
  const directories = [...ancestors, parent];
  let handle: Awaited<ReturnType<typeof fs.open>> | null = null;
  let openedIdentity: FileIdentity | null = null;
  const closeHandle = async (): Promise<void> => {
    if (handle === null) return;
    const openedHandle = handle;
    handle = null;
    await openedHandle.close().catch((): undefined => undefined);
  };
  try {
    await assertVerifiedDirectories(directories);
    handle = await fs.open(
      filePath,
      fsConstants.O_WRONLY |
        fsConstants.O_CREAT |
        fsConstants.O_EXCL |
        (typeof fsConstants.O_NOFOLLOW === 'number' ? fsConstants.O_NOFOLLOW : 0)
    );
    const opened = await handle.stat();
    openedIdentity = fileIdentity(opened);
    if (!opened.isFile()) throw new CreativeStudioMediaError('storage_error');
    await assertVerifiedDirectories(directories);
    const beforeWritePath = await regularFile(filePath);
    const beforeWriteIdentity = fileIdentity(beforeWritePath);
    if (beforeWriteIdentity.dev !== openedIdentity.dev || beforeWriteIdentity.ino !== openedIdentity.ino) {
      throw new CreativeStudioMediaError('storage_error');
    }
    await write(handle);
    const after = await handle.stat();
    const afterIdentity = fileIdentity(after);
    if (!after.isFile() || afterIdentity.dev !== openedIdentity.dev || afterIdentity.ino !== openedIdentity.ino) {
      throw new CreativeStudioMediaError('storage_error');
    }
    await assertVerifiedDirectories(directories);
    const afterWritePath = await regularFile(filePath);
    const afterWritePathIdentity = fileIdentity(afterWritePath);
    if (afterWritePathIdentity.dev !== openedIdentity.dev || afterWritePathIdentity.ino !== openedIdentity.ino) {
      throw new CreativeStudioMediaError('storage_error');
    }
  } catch (error) {
    await closeHandle();
    if (openedIdentity !== null) await unlinkIfIdentityMatches(filePath, openedIdentity);
    if (error instanceof CreativeStudioMediaError) throw error;
    throw new CreativeStudioMediaError('storage_error');
  } finally {
    await closeHandle();
  }
};

const sniff = (bytes: Buffer): (typeof MIME_SIGNATURES)[number] | null =>
  MIME_SIGNATURES.find((signature) => signature.match(bytes)) ?? null;

const mapStoreError = (error: unknown): never => {
  if (error instanceof CreativeStudioStoreError) throw error;
  if (error instanceof CreativeStudioMediaError) throw error;
  throw new CreativeStudioMediaError('storage_error');
};

/** Persists references in a project-owned collection; source paths never become manifest data. */
export const createStudioMediaStore = (deps: StudioMediaStoreDeps): StudioMediaStore => {
  const createId = deps.createId ?? (() => randomUUID().replaceAll('-', '_'));
  const now = deps.now ?? (() => new Date().toISOString());
  const getAvailableDiskBytes = deps.getAvailableDiskBytes ?? getAvailableStudioDiskBytes;
  const limits: StudioMediaLimits = { ...STUDIO_MEDIA_LIMITS, ...deps.limits };
  if (Object.values(limits).some((limit) => !Number.isSafeInteger(limit) || limit < 1)) {
    throw new CreativeStudioMediaError('storage_error');
  }

  type WriteCapacity = {
    maxBytes: number;
    overflowCode: 'invalid_media' | 'storage_error';
  };

  const planWriteCapacity = async (
    project: { assets: Record<string, { byteSize: number }> },
    directory: string,
    perAssetMaxBytes: number,
    declaredBytes?: number,
    additionalUsedBytes = 0
  ): Promise<WriteCapacity> => {
    if (
      (declaredBytes !== undefined && (!Number.isSafeInteger(declaredBytes) || declaredBytes < 0)) ||
      !Number.isSafeInteger(additionalUsedBytes) ||
      additionalUsedBytes < 0
    ) {
      throw new CreativeStudioMediaError('invalid_media');
    }
    const used = Object.values(project.assets).reduce((total, asset) => total + asset.byteSize, additionalUsedBytes);
    const projectRemaining = limits.projectMaxBytes - used;
    if (projectRemaining <= 0) throw new CreativeStudioMediaError('invalid_media');
    const reportedDiskBytes = await getAvailableDiskBytes(directory);
    if (!Number.isFinite(reportedDiskBytes) || reportedDiskBytes < 0) {
      throw new CreativeStudioMediaError('storage_error');
    }
    const availableDiskBytes = Math.min(Math.floor(reportedDiskBytes), Number.MAX_SAFE_INTEGER);
    if (availableDiskBytes <= 0) throw new CreativeStudioMediaError('storage_error');
    if (declaredBytes !== undefined && (declaredBytes > perAssetMaxBytes || declaredBytes > projectRemaining)) {
      throw new CreativeStudioMediaError('invalid_media');
    }
    if (declaredBytes !== undefined && declaredBytes > availableDiskBytes) {
      throw new CreativeStudioMediaError('storage_error');
    }
    const nonDiskCeiling = Math.min(perAssetMaxBytes, projectRemaining);
    return {
      maxBytes: Math.min(nonDiskCeiling, availableDiskBytes),
      overflowCode: availableDiskBytes <= nonDiskCeiling ? 'storage_error' : 'invalid_media',
    };
  };

  async function importReferenceFromPath(
    input: InternalImportReferenceInput & { returnProject: true }
  ): Promise<StudioMediaImportResult>;
  async function importReferenceFromPath(input: InternalImportReferenceInput): Promise<StudioAsset>;
  async function importReferenceFromPath(
    input: InternalImportReferenceInput
  ): Promise<StudioAsset | StudioMediaImportResult> {
    if (
      !SAFE_ID.test(input.projectId) ||
      (!SAFE_ID.test(input.sceneId ?? '') && input.sceneId !== undefined) ||
      (input.briefReferenceRole !== undefined &&
        input.briefReferenceRole !== 'cast' &&
        input.briefReferenceRole !== 'look') ||
      (input.sceneId !== undefined && input.briefReferenceRole !== undefined)
    ) {
      throw new CreativeStudioMediaError('invalid_media');
    }
    if (
      !Number.isSafeInteger(input.expectedRevision) ||
      input.expectedRevision < 1 ||
      typeof input.sourcePath !== 'string'
    ) {
      throw new CreativeStudioMediaError('invalid_media');
    }
    const assetId = createId();
    if (!SAFE_ID.test(assetId)) throw new CreativeStudioMediaError('storage_error');

    let partPath: string | null = null;
    let partIdentity: FileIdentity | null = null;
    let finalPath: string | null = null;
    let finalIdentity: FileIdentity | null = null;
    try {
      await regularFile(input.sourcePath);
      const sourceStats = await fs.stat(input.sourcePath);
      const projectDir = await deps.store.getVerifiedProjectDirectory(input.projectId);
      const project = await deps.store.getProject(input.projectId);
      if (projectDir === null || project === null) throw new CreativeStudioMediaError('not_found');
      if (project.revision !== input.expectedRevision) throw new CreativeStudioMediaError('stale_project');
      if (input.sceneId !== undefined && !Object.hasOwn(project.scenes, input.sceneId)) {
        throw new CreativeStudioMediaError('not_found');
      }
      if (input.briefReferenceRole !== undefined) {
        const activeReferences = resolveActiveStudioBriefReferences(project.assets);
        if (activeReferences === null || activeReferences.length >= STUDIO_MAX_ACTIVE_BRIEF_REFERENCES) {
          throw new CreativeStudioMediaError('invalid_media');
        }
      }
      const capacity = await planWriteCapacity(project, projectDir, limits.referenceMaxBytes, sourceStats.size);
      const partsDir = await ensureManagedDirectory(projectDir, 'parts');
      const importsDir = await ensureManagedDirectory(projectDir, 'imports');
      partPath = path.join(partsDir, `${assetId}.part`);
      if (path.dirname(partPath) !== partsDir) throw new CreativeStudioMediaError('storage_error');

      const hash = createHash('sha256');
      let byteSize = 0;
      let sample = Buffer.alloc(0);
      const checker = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          byteSize += chunk.length;
          if (byteSize > capacity.maxBytes) {
            callback(new CreativeStudioMediaError(capacity.overflowCode));
            return;
          }
          hash.update(chunk);
          if (sample.length < 32) sample = Buffer.concat([sample, chunk]).subarray(0, 32);
          callback(null, chunk);
        },
      });
      const partHandle = await fs.open(partPath, 'wx');
      try {
        const openedPart = await partHandle.stat();
        if (!openedPart.isFile()) throw new CreativeStudioMediaError('storage_error');
        partIdentity = fileIdentity(openedPart);
        await pipeline(
          await openVerifiedReadStream(input.sourcePath),
          checker,
          createWriteStream(partPath, { fd: partHandle.fd, autoClose: false })
        );
      } finally {
        await partHandle.close().catch((): undefined => undefined);
      }
      const completedPartIdentity = fileIdentity(await regularFile(partPath));
      if (completedPartIdentity.dev !== partIdentity.dev || completedPartIdentity.ino !== partIdentity.ino) {
        throw new CreativeStudioMediaError('storage_error');
      }
      const signature = sniff(sample);
      if (signature === null || !signature.mimeType.startsWith('image/')) {
        throw new CreativeStudioMediaError('invalid_media');
      }
      finalPath = path.join(importsDir, `${assetId}.${signature.extension}`);
      if (path.dirname(finalPath) !== importsDir) throw new CreativeStudioMediaError('storage_error');
      finalIdentity = await finalizeManagedPart(partPath, partsDir, finalPath, importsDir);
      partPath = null;
      partIdentity = null;

      const baseAsset: StudioAsset = {
        id: assetId,
        projectId: input.projectId,
        sceneId: input.sceneId ?? null,
        mediaKind: 'image',
        mimeType: signature.mimeType,
        managedAsset: { collection: 'imports', fileName: `${assetId}.${signature.extension}` },
        byteSize,
        sha256: hash.digest('hex'),
        createdAt: now(),
      };
      let importedAsset: StudioAsset | null = null;
      const updatedProject = await deps.store.updateProject(
        input.projectId,
        (current) => {
          const next = structuredClone(current);
          const activeReferences = resolveActiveStudioBriefReferences(current.assets);
          if (
            input.briefReferenceRole !== undefined &&
            (activeReferences === null || activeReferences.length >= STUDIO_MAX_ACTIVE_BRIEF_REFERENCES)
          ) {
            throw new CreativeStudioMediaError('invalid_media');
          }
          const asset: StudioAsset =
            input.briefReferenceRole === undefined
              ? baseAsset
              : {
                  ...baseAsset,
                  briefReferenceRole: input.briefReferenceRole,
                  briefReferenceLabel: allocateStudioBriefReferenceLabel(
                    path.basename(input.sourcePath),
                    activeReferences!.map((reference) => reference.briefReferenceLabel!)
                  ),
                };
          next.assets[asset.id] = asset;
          if (asset.sceneId !== null) {
            const scene = next.scenes[asset.sceneId];
            scene.assetIds.push(asset.id);
            scene.referenceAssetId = asset.id;
          }
          importedAsset = asset;
          return next;
        },
        input.expectedRevision
      );
      if (importedAsset === null) throw new CreativeStudioMediaError('storage_error');
      return input.returnProject ? { asset: importedAsset, project: updatedProject } : importedAsset;
    } catch (error) {
      if (partPath !== null && partIdentity !== null) {
        await unlinkIfIdentityMatches(partPath, partIdentity, deps.beforeCleanupOwnership, deps.afterCleanupRestore);
      }
      if (finalPath !== null && finalIdentity !== null) {
        await unlinkIfIdentityMatches(finalPath, finalIdentity, deps.beforeCleanupOwnership, deps.afterCleanupRestore);
      }
      return mapStoreError(error);
    }
  }

  const detachBriefReference = async (input: StudioDetachBriefReferenceRequest): Promise<StudioProject> => {
    if (
      !SAFE_ID.test(input.projectId) ||
      !SAFE_ID.test(input.assetId) ||
      !Number.isSafeInteger(input.expectedRevision) ||
      input.expectedRevision < 1
    ) {
      throw new CreativeStudioMediaError('invalid_media');
    }
    try {
      return await deps.store.updateProject(
        input.projectId,
        (current) => {
          const asset = current.assets[input.assetId];
          if (asset === undefined) throw new CreativeStudioMediaError('not_found');
          if (
            asset.projectId !== current.id ||
            asset.sceneId !== null ||
            asset.mediaKind !== 'image' ||
            asset.managedAsset.collection !== 'imports' ||
            (asset.briefReferenceRole !== 'cast' && asset.briefReferenceRole !== 'look') ||
            asset.briefReferenceLabel === undefined
          ) {
            throw new CreativeStudioMediaError('invalid_media');
          }
          const next = structuredClone(current);
          delete next.assets[input.assetId].briefReferenceRole;
          delete next.assets[input.assetId].briefReferenceLabel;
          return next;
        },
        input.expectedRevision
      );
    } catch (error) {
      return mapStoreError(error);
    }
  };

  const loadProjectContextV2 = async (
    projectId: string
  ): Promise<{ projectDir: string; project: StudioProjectV2; authority: StudioProjectPathAuthorityV2 }> => {
    const initial = await deps.store.getProjectV2(projectId);
    if (initial.status === 'unsupported_prototype_schema') {
      throw new CreativeStudioStoreError('unsupported_prototype_schema', 'Unsupported prototype Studio schema');
    }
    if (initial.status === 'not_found') throw new CreativeStudioMediaError('not_found');
    const projectDir = await deps.store.getVerifiedProjectDirectoryV2(projectId);
    if (projectDir === null) throw new CreativeStudioMediaError('not_found');
    const confirmed = await deps.store.getProjectV2(projectId);
    if (confirmed.status !== 'supported') {
      throw new CreativeStudioStoreError(
        confirmed.status === 'unsupported_prototype_schema' ? 'unsupported_prototype_schema' : 'not_found',
        confirmed.status === 'unsupported_prototype_schema'
          ? 'Unsupported prototype Studio schema'
          : 'Studio project not found'
      );
    }
    const captured = await captureStudioProjectPathAuthorityV2(projectId, projectDir);
    const final = await deps.store.getProjectV2(projectId);
    if (final.status !== 'supported') {
      throw new CreativeStudioStoreError(
        final.status === 'unsupported_prototype_schema' ? 'unsupported_prototype_schema' : 'not_found',
        final.status === 'unsupported_prototype_schema'
          ? 'Unsupported prototype Studio schema'
          : 'Studio project not found'
      );
    }
    await assertStudioProjectPathAuthorityV2(captured.authority);
    return { projectDir, project: captured.project, authority: captured.authority };
  };

  const assertV2ManagedMutation = async (
    authority: StudioProjectPathAuthorityV2,
    directories: readonly VerifiedDirectory[] = []
  ): Promise<void> => {
    await deps.beforeV2ManagedMutation?.(authority.projectDir);
    await assertStudioProjectPathAuthorityV2(authority);
    for (const directory of directories) {
      if (path.dirname(directory.directory) !== authority.projectDir) {
        throw new CreativeStudioMediaError('storage_error');
      }
      // eslint-disable-next-line no-await-in-loop
      await assertVerifiedDirectory(directory);
      // eslint-disable-next-line no-await-in-loop
      if ((await fs.realpath(directory.directory)) !== directory.directory) {
        throw new CreativeStudioMediaError('storage_error');
      }
    }
  };

  const captureManagedDirectoryV2 = async (
    authority: StudioProjectPathAuthorityV2,
    directory: string
  ): Promise<VerifiedDirectory> => {
    if (path.dirname(directory) !== authority.projectDir) throw new CreativeStudioMediaError('storage_error');
    const verified = await captureVerifiedDirectory(directory);
    if ((await fs.realpath(directory)) !== directory) throw new CreativeStudioMediaError('storage_error');
    await assertV2ManagedMutation(authority, [verified]);
    return verified;
  };

  const ensureManagedDirectoryV2 = async (
    authority: StudioProjectPathAuthorityV2,
    name: string
  ): Promise<VerifiedDirectory> => {
    await assertV2ManagedMutation(authority);
    const directory = await ensureManagedDirectory(authority.projectDir, name);
    return captureManagedDirectoryV2(authority, directory);
  };

  const cleanupManagedPathV2 = async (
    authority: StudioProjectPathAuthorityV2,
    filePath: string,
    identity: FileIdentity,
    directory: VerifiedDirectory
  ): Promise<ManagedPathCleanupOutcomeV2> => {
    try {
      await assertV2ManagedMutation(authority, [directory]);
    } catch {
      return 'authority_changed';
    }
    let authorityChanged = false;
    await unlinkIfIdentityMatches(
      filePath,
      identity,
      async (ownedPath) => {
        try {
          await deps.beforeCleanupOwnership?.(ownedPath);
          // The ownership hook is the last deterministic race boundary before rename. Recheck the
          // exact manifest and child-directory identities here so a concurrent CAS is retried from
          // a fresh schema-2 classification instead of being mistaken for successful cleanup.
          await assertV2ManagedMutation(authority, [directory]);
        } catch (error) {
          authorityChanged = true;
          throw error;
        }
      },
      deps.afterCleanupRestore
    );
    return authorityChanged ? 'authority_changed' : 'completed';
  };

  const cleanupUncommittedManagedPathsV2 = async (
    projectId: string,
    assetId: string,
    paths: Array<{ filePath: string | null; identity: FileIdentity | null }>
  ): Promise<void> => {
    for (const candidate of paths) {
      if (candidate.filePath === null || candidate.identity === null) continue;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          // Reclassify for every attempt: a valid CAS may have changed the manifest exactly at the
          // previous cleanup fence, but the generated path is removable only while it remains unowned.
          // eslint-disable-next-line no-await-in-loop
          const context = await loadProjectContextV2(projectId);
          if (ownRecordValue(context.project.assets, assetId) !== undefined) return;
          const directoryPath = path.dirname(candidate.filePath);
          if (path.dirname(directoryPath) !== context.projectDir) break;
          // Capture without invoking the mutation hook; cleanupManagedPathV2 owns the single cleanup fence.
          // eslint-disable-next-line no-await-in-loop
          const stats = await fs.lstat(directoryPath);
          if (!stats.isDirectory() || stats.isSymbolicLink()) break;
          // eslint-disable-next-line no-await-in-loop
          if ((await fs.realpath(directoryPath)) !== directoryPath) break;
          const directory: VerifiedDirectory = { directory: directoryPath, identity: fileIdentity(stats) };
          // eslint-disable-next-line no-await-in-loop
          const outcome = await cleanupManagedPathV2(
            context.authority,
            candidate.filePath,
            candidate.identity,
            directory
          );
          if (outcome === 'completed') break;
        } catch {
          // Uncommitted output cleanup is recoverable and bounded; retry after fresh classification.
        }
      }
    }
  };

  async function importReferenceFromPathV2(
    input: InternalImportReferenceInputV2 & { returnProject: true }
  ): Promise<StudioMediaImportResultV2>;
  async function importReferenceFromPathV2(input: InternalImportReferenceInputV2): Promise<StudioAssetV2>;
  async function importReferenceFromPathV2(
    input: InternalImportReferenceInputV2
  ): Promise<StudioAssetV2 | StudioMediaImportResultV2> {
    if (
      !SAFE_ID.test(input.projectId) ||
      (!SAFE_ID.test(input.clipId ?? '') && input.clipId !== undefined) ||
      (input.briefReferenceRole !== undefined &&
        input.briefReferenceRole !== 'cast' &&
        input.briefReferenceRole !== 'look') ||
      (input.clipId === undefined) === (input.briefReferenceRole === undefined) ||
      !Number.isSafeInteger(input.expectedRevision) ||
      input.expectedRevision < 1 ||
      typeof input.sourcePath !== 'string'
    ) {
      throw new CreativeStudioMediaError('invalid_media');
    }
    const assetId = createId();
    if (!SAFE_ID.test(assetId)) throw new CreativeStudioMediaError('storage_error');

    let partPath: string | null = null;
    let partIdentity: FileIdentity | null = null;
    let finalPath: string | null = null;
    let finalIdentity: FileIdentity | null = null;
    let authority: StudioProjectPathAuthorityV2 | null = null;
    try {
      await regularFile(input.sourcePath);
      const sourceStats = await fs.stat(input.sourcePath);
      const context = await loadProjectContextV2(input.projectId);
      const { projectDir, project } = context;
      authority = context.authority;
      if (project.revision !== input.expectedRevision) throw new CreativeStudioMediaError('stale_project');
      if (input.clipId !== undefined && !Object.hasOwn(project.clips, input.clipId)) {
        throw new CreativeStudioMediaError('not_found');
      }
      if (input.briefReferenceRole !== undefined) {
        const activeReferences = resolveActiveStudioBriefReferencesV2(project.assets);
        if (activeReferences === null || activeReferences.length >= STUDIO_MAX_ACTIVE_BRIEF_REFERENCES) {
          throw new CreativeStudioMediaError('invalid_media');
        }
      }
      const capacity = await planWriteCapacity(project, projectDir, limits.referenceMaxBytes, sourceStats.size);
      const partsDirectory = await ensureManagedDirectoryV2(authority, 'parts');
      const importsDirectory = await ensureManagedDirectoryV2(authority, 'imports');
      const partsDir = partsDirectory.directory;
      const importsDir = importsDirectory.directory;
      partPath = path.join(partsDir, `${assetId}.part`);
      if (path.dirname(partPath) !== partsDir) throw new CreativeStudioMediaError('storage_error');

      const hash = createHash('sha256');
      let byteSize = 0;
      let sample = Buffer.alloc(0);
      const checker = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          byteSize += chunk.length;
          if (byteSize > capacity.maxBytes) {
            callback(new CreativeStudioMediaError(capacity.overflowCode));
            return;
          }
          hash.update(chunk);
          if (sample.length < 32) sample = Buffer.concat([sample, chunk]).subarray(0, 32);
          callback(null, chunk);
        },
      });
      await assertV2ManagedMutation(authority, [partsDirectory]);
      const partHandle = await fs.open(partPath, 'wx');
      try {
        await assertV2ManagedMutation(authority, [partsDirectory]);
        const openedPart = await partHandle.stat();
        if (!openedPart.isFile()) throw new CreativeStudioMediaError('storage_error');
        partIdentity = fileIdentity(openedPart);
        await pipeline(
          await openVerifiedReadStream(input.sourcePath),
          checker,
          createWriteStream(partPath, { fd: partHandle.fd, autoClose: false })
        );
      } finally {
        await partHandle.close().catch((): undefined => undefined);
      }
      await assertV2ManagedMutation(authority, [partsDirectory]);
      const completedPartIdentity = fileIdentity(await regularFile(partPath));
      if (completedPartIdentity.dev !== partIdentity.dev || completedPartIdentity.ino !== partIdentity.ino) {
        throw new CreativeStudioMediaError('storage_error');
      }
      const signature = sniff(sample);
      if (signature === null || !signature.mimeType.startsWith('image/')) {
        throw new CreativeStudioMediaError('invalid_media');
      }
      finalPath = path.join(importsDir, `${assetId}.${signature.extension}`);
      if (path.dirname(finalPath) !== importsDir) throw new CreativeStudioMediaError('storage_error');
      finalIdentity = await finalizeManagedPartV2(
        partPath,
        partsDir,
        finalPath,
        importsDir,
        partIdentity,
        () => assertV2ManagedMutation(authority!, [partsDirectory, importsDirectory]),
        (identity) => {
          finalIdentity = identity;
        }
      );
      partPath = null;
      partIdentity = null;

      const baseAsset: StudioAssetV2 = {
        id: assetId,
        projectId: input.projectId,
        clipId: input.clipId ?? null,
        mediaKind: 'image',
        mimeType: signature.mimeType,
        managedAsset: { collection: 'imports', fileName: `${assetId}.${signature.extension}` },
        byteSize,
        sha256: hash.digest('hex'),
        createdAt: now(),
      };
      let importedAsset: StudioAssetV2 | null = null;
      await assertV2ManagedMutation(authority, [importsDirectory]);
      const updatedProject = await deps.store.updateProjectV2(
        input.projectId,
        (current) => {
          const next = structuredClone(current);
          const activeReferences = resolveActiveStudioBriefReferencesV2(current.assets);
          if (
            input.briefReferenceRole !== undefined &&
            (activeReferences === null || activeReferences.length >= STUDIO_MAX_ACTIVE_BRIEF_REFERENCES)
          ) {
            throw new CreativeStudioMediaError('invalid_media');
          }
          const asset: StudioAssetV2 =
            input.briefReferenceRole === undefined
              ? baseAsset
              : {
                  ...baseAsset,
                  briefReferenceRole: input.briefReferenceRole,
                  briefReferenceLabel: allocateStudioBriefReferenceLabel(
                    path.basename(input.sourcePath),
                    activeReferences!.map((reference) => reference.briefReferenceLabel!)
                  ),
                };
          defineRecordValue(next.assets, asset.id, asset);
          if (asset.clipId !== null) {
            const shot = ownRecordValue(next.clips, asset.clipId);
            if (shot === undefined) throw new CreativeStudioMediaError('not_found');
            shot.assetIds.push(asset.id);
            shot.referenceAssetId = asset.id;
          }
          importedAsset = asset;
          return next;
        },
        input.expectedRevision
      );
      if (importedAsset === null) throw new CreativeStudioMediaError('storage_error');
      return input.returnProject ? { asset: importedAsset, project: updatedProject } : importedAsset;
    } catch (error) {
      await cleanupUncommittedManagedPathsV2(input.projectId, assetId, [
        { filePath: partPath, identity: partIdentity },
        { filePath: finalPath, identity: finalIdentity },
      ]);
      return mapStoreError(error);
    }
  }

  const detachBriefReferenceV2 = async (input: StudioDetachBriefReferenceRequest): Promise<StudioProjectV2> => {
    if (
      !SAFE_ID.test(input.projectId) ||
      !SAFE_ID.test(input.assetId) ||
      !Number.isSafeInteger(input.expectedRevision) ||
      input.expectedRevision < 1
    ) {
      throw new CreativeStudioMediaError('invalid_media');
    }
    try {
      const { projectDir, project, authority } = await loadProjectContextV2(input.projectId);
      if (project.revision !== input.expectedRevision) throw new CreativeStudioMediaError('stale_project');
      const currentAsset = ownRecordValue(project.assets, input.assetId);
      if (
        currentAsset === undefined ||
        currentAsset.projectId !== project.id ||
        currentAsset.clipId !== null ||
        currentAsset.mediaKind !== 'image' ||
        currentAsset.managedAsset.collection !== 'imports' ||
        (currentAsset.briefReferenceRole !== 'cast' && currentAsset.briefReferenceRole !== 'look') ||
        currentAsset.briefReferenceLabel === undefined
      ) {
        throw new CreativeStudioMediaError(currentAsset === undefined ? 'not_found' : 'invalid_media');
      }
      const importsDir = path.join(projectDir, 'imports');
      const managedFile = path.join(importsDir, currentAsset.managedAsset.fileName);
      if (path.dirname(managedFile) !== importsDir) throw new CreativeStudioMediaError('storage_error');
      let importsDirectory: VerifiedDirectory | null = null;
      let managedIdentity: FileIdentity | null = null;
      try {
        const importsStats = await fs.lstat(importsDir);
        if (
          !importsStats.isDirectory() ||
          importsStats.isSymbolicLink() ||
          (await fs.realpath(importsDir)) !== importsDir
        ) {
          throw new CreativeStudioMediaError('storage_error');
        }
        importsDirectory = { directory: importsDir, identity: fileIdentity(importsStats) };
        await assertV2ManagedMutation(authority, [importsDirectory]);
        const managedStats = await regularFile(managedFile);
        if ((await fs.realpath(managedFile)) !== managedFile) throw new CreativeStudioMediaError('storage_error');
        managedIdentity = fileIdentity(managedStats);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      await assertV2ManagedMutation(authority, importsDirectory === null ? [] : [importsDirectory]);
      const updated = await deps.store.updateProjectV2(
        input.projectId,
        (current) => {
          const asset = ownRecordValue(current.assets, input.assetId);
          if (asset === undefined) throw new CreativeStudioMediaError('not_found');
          if (
            asset.projectId !== current.id ||
            asset.clipId !== null ||
            asset.mediaKind !== 'image' ||
            asset.managedAsset.collection !== 'imports' ||
            (asset.briefReferenceRole !== 'cast' && asset.briefReferenceRole !== 'look') ||
            asset.briefReferenceLabel === undefined
          ) {
            throw new CreativeStudioMediaError('invalid_media');
          }
          const next = structuredClone(current);
          if (!Object.hasOwn(next.assets, input.assetId)) throw new CreativeStudioMediaError('not_found');
          delete next.assets[input.assetId];
          return next;
        },
        input.expectedRevision
      );
      if (managedIdentity !== null) {
        for (let attempt = 0; attempt < 2; attempt += 1) {
          try {
            // A later valid commit may already have replaced the manifest inode. Reclassify and only
            // remove the exact managed inode while the detached asset remains absent.
            // eslint-disable-next-line no-await-in-loop
            const committed = await loadProjectContextV2(input.projectId);
            if (committed.project.revision < updated.revision) continue;
            if (Object.hasOwn(committed.project.assets, input.assetId)) break;
            // eslint-disable-next-line no-await-in-loop
            const committedImports = await captureManagedDirectoryV2(committed.authority, importsDir);
            // eslint-disable-next-line no-await-in-loop
            const outcome = await cleanupManagedPathV2(
              committed.authority,
              managedFile,
              managedIdentity,
              committedImports
            );
            if (outcome === 'completed') break;
          } catch {
            // Detach is already authoritative. Cleanup remains recoverable and cannot turn it into failure.
          }
        }
      }
      return updated;
    } catch (error) {
      return mapStoreError(error);
    }
  };

  const cleanupOrphanParts = async (): Promise<void> => {
    const projects = await deps.store.listProjects();
    for (const project of projects) {
      const projectDir = await deps.store.getVerifiedProjectDirectory(project.id);
      if (projectDir === null) continue;
      const partsDir = path.join(projectDir, 'parts');
      try {
        const stats = await fs.lstat(partsDir);
        if (!stats.isDirectory() || stats.isSymbolicLink() || (await fs.realpath(partsDir)) !== partsDir) continue;
        const entries = await fs.readdir(partsDir, { withFileTypes: true });
        await Promise.all(
          entries
            .filter((entry) => entry.name.endsWith('.part'))
            .map(async (entry) => {
              const target = path.join(partsDir, entry.name);
              const targetStats = await fs.lstat(target);
              if (targetStats.isFile() && !targetStats.isSymbolicLink()) await fs.rm(target);
            })
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new CreativeStudioMediaError('storage_error');
      }
    }
  };

  const cleanupOrphanPartsV2 = async (): Promise<void> => {
    const inventory = await deps.store.inspectProjectsV2();
    for (const projectId of inventory.supportedProjectIds) {
      let context: Awaited<ReturnType<typeof loadProjectContextV2>>;
      try {
        // Reclassify and bind both the directory and manifest immediately before cleanup.
        // eslint-disable-next-line no-await-in-loop
        context = await loadProjectContextV2(projectId);
      } catch (error) {
        if (
          error instanceof CreativeStudioStoreError &&
          (error.code === 'unsupported_prototype_schema' || error.code === 'not_found')
        ) {
          continue;
        }
        throw error;
      }
      const { projectDir, authority } = context;
      const partsDir = path.join(projectDir, 'parts');
      try {
        // eslint-disable-next-line no-await-in-loop
        const stats = await fs.lstat(partsDir);
        if (!stats.isDirectory() || stats.isSymbolicLink() || (await fs.realpath(partsDir)) !== partsDir) continue;
        const partsDirectory: VerifiedDirectory = { directory: partsDir, identity: fileIdentity(stats) };
        // eslint-disable-next-line no-await-in-loop
        await assertV2ManagedMutation(authority, [partsDirectory]);
        // eslint-disable-next-line no-await-in-loop
        const entries = await fs.readdir(partsDir, { withFileTypes: true });
        await Promise.all(
          entries
            .filter((entry) => entry.name.endsWith('.part'))
            .map(async (entry) => {
              const target = path.join(partsDir, entry.name);
              const targetStats = await fs.lstat(target);
              if (targetStats.isFile() && !targetStats.isSymbolicLink()) {
                await cleanupManagedPathV2(authority, target, fileIdentity(targetStats), partsDirectory);
              }
            })
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new CreativeStudioMediaError('storage_error');
      }
    }
  };

  const readProjectOutputAsset = async (
    projectDir: string,
    projectId: string,
    assetId: string
  ): Promise<StudioAsset | null> => {
    const assetsDir = path.join(projectDir, 'assets');
    const metadataPath = path.join(assetsDir, `${assetId}.render.json`);
    if (path.dirname(metadataPath) !== assetsDir) return null;
    let handle: Awaited<ReturnType<typeof fs.open>> | null = null;
    try {
      const assetsStats = await fs.lstat(assetsDir);
      if (!assetsStats.isDirectory() || assetsStats.isSymbolicLink() || (await fs.realpath(assetsDir)) !== assetsDir) {
        return null;
      }
      handle = await fs.open(
        metadataPath,
        fsConstants.O_RDONLY | (typeof fsConstants.O_NOFOLLOW === 'number' ? fsConstants.O_NOFOLLOW : 0)
      );
      const before = await handle.stat();
      if (!before.isFile() || before.size < 2 || before.size > 4096) return null;
      const parsed = JSON.parse(await handle.readFile({ encoding: 'utf8' })) as unknown;
      const after = await handle.stat();
      if (
        before.dev !== after.dev ||
        before.ino !== after.ino ||
        before.size !== after.size ||
        before.mtimeMs !== after.mtimeMs
      )
        return null;
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
      const candidate = parsed as Partial<StudioAsset>;
      const managedAsset = candidate.managedAsset;
      const keys = new Set([
        'id',
        'projectId',
        'sceneId',
        'mediaKind',
        'mimeType',
        'managedAsset',
        'byteSize',
        'sha256',
        'width',
        'height',
        'durationSeconds',
        'createdAt',
      ]);
      if (
        Object.keys(parsed).some((key) => !keys.has(key)) ||
        candidate.id !== assetId ||
        candidate.projectId !== projectId ||
        candidate.sceneId !== null ||
        candidate.mediaKind !== 'video' ||
        candidate.mimeType !== 'video/mp4' ||
        typeof managedAsset !== 'object' ||
        managedAsset === null ||
        Object.keys(managedAsset).length !== 2 ||
        managedAsset?.collection !== 'assets' ||
        managedAsset.fileName !== `${assetId}.mp4` ||
        !Number.isSafeInteger(candidate.byteSize) ||
        candidate.byteSize! < 1 ||
        typeof candidate.sha256 !== 'string' ||
        !/^[a-f0-9]{64}$/.test(candidate.sha256) ||
        !Number.isSafeInteger(candidate.width) ||
        candidate.width! < 1 ||
        !Number.isSafeInteger(candidate.height) ||
        candidate.height! < 1 ||
        (candidate.durationSeconds !== undefined &&
          (!Number.isFinite(candidate.durationSeconds) || candidate.durationSeconds <= 0)) ||
        typeof candidate.createdAt !== 'string' ||
        candidate.createdAt.length === 0
      ) {
        return null;
      }
      return candidate as StudioAsset;
    } catch {
      return null;
    } finally {
      await handle?.close().catch((): undefined => undefined);
    }
  };

  const listProjectOutputAssets = async (projectDir: string, projectId: string): Promise<StudioAsset[]> => {
    const assetsDir = path.join(projectDir, 'assets');
    const outputMetadata = await fs.readdir(assetsDir).catch((error: NodeJS.ErrnoException): string[] => {
      if (error.code === 'ENOENT') return [];
      throw error;
    });
    const outputAssets = await Promise.all(
      outputMetadata.flatMap((fileName) => {
        const match = /^([A-Za-z0-9_-]{1,256})\.render\.json$/.exec(fileName);
        return match ? [readProjectOutputAsset(projectDir, projectId, match[1]!)] : [];
      })
    );
    return outputAssets.filter((asset): asset is StudioAsset => asset !== null);
  };

  const readProjectOutputAssetV2 = async (
    projectDir: string,
    projectId: string,
    assetId: string
  ): Promise<StudioAssetV2 | null> => {
    const assetsDir = path.join(projectDir, 'assets');
    const metadataPath = path.join(assetsDir, `${assetId}.render-v2.json`);
    if (path.dirname(metadataPath) !== assetsDir) return null;
    let handle: Awaited<ReturnType<typeof fs.open>> | null = null;
    try {
      const assetsStats = await fs.lstat(assetsDir);
      if (!assetsStats.isDirectory() || assetsStats.isSymbolicLink() || (await fs.realpath(assetsDir)) !== assetsDir) {
        return null;
      }
      handle = await fs.open(
        metadataPath,
        fsConstants.O_RDONLY | (typeof fsConstants.O_NOFOLLOW === 'number' ? fsConstants.O_NOFOLLOW : 0)
      );
      const before = await handle.stat();
      if (!before.isFile() || before.size < 2 || before.size > 4096) return null;
      const parsed = JSON.parse(await handle.readFile({ encoding: 'utf8' })) as unknown;
      const after = await handle.stat();
      if (
        before.dev !== after.dev ||
        before.ino !== after.ino ||
        before.size !== after.size ||
        before.mtimeMs !== after.mtimeMs
      ) {
        return null;
      }
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
      const candidate = parsed as Partial<StudioAssetV2>;
      const managedAsset = candidate.managedAsset;
      const keys = new Set([
        'id',
        'projectId',
        'clipId',
        'mediaKind',
        'mimeType',
        'managedAsset',
        'byteSize',
        'sha256',
        'width',
        'height',
        'durationSeconds',
        'createdAt',
      ]);
      if (
        Object.keys(parsed).some((key) => !keys.has(key)) ||
        candidate.id !== assetId ||
        candidate.projectId !== projectId ||
        candidate.clipId !== null ||
        candidate.mediaKind !== 'video' ||
        candidate.mimeType !== 'video/mp4' ||
        typeof managedAsset !== 'object' ||
        managedAsset === null ||
        Object.keys(managedAsset).length !== 2 ||
        managedAsset.collection !== 'assets' ||
        managedAsset.fileName !== `${assetId}.mp4` ||
        !Number.isSafeInteger(candidate.byteSize) ||
        candidate.byteSize! < 1 ||
        typeof candidate.sha256 !== 'string' ||
        !/^[a-f0-9]{64}$/.test(candidate.sha256) ||
        !Number.isSafeInteger(candidate.width) ||
        candidate.width! < 1 ||
        !Number.isSafeInteger(candidate.height) ||
        candidate.height! < 1 ||
        (candidate.durationSeconds !== undefined &&
          (!Number.isFinite(candidate.durationSeconds) || candidate.durationSeconds <= 0)) ||
        typeof candidate.createdAt !== 'string' ||
        candidate.createdAt.length === 0
      ) {
        return null;
      }
      return candidate as StudioAssetV2;
    } catch {
      return null;
    } finally {
      await handle?.close().catch((): undefined => undefined);
    }
  };

  const listProjectOutputAssetsV2 = async (projectDir: string, projectId: string): Promise<StudioAssetV2[]> => {
    const assetsDir = path.join(projectDir, 'assets');
    const outputMetadata = await fs.readdir(assetsDir).catch((error: NodeJS.ErrnoException): string[] => {
      if (error.code === 'ENOENT') return [];
      throw error;
    });
    const outputAssets = await Promise.all(
      outputMetadata.flatMap((fileName) => {
        const match = /^([A-Za-z0-9_-]{1,256})\.render-v2\.json$/.exec(fileName);
        return match ? [readProjectOutputAssetV2(projectDir, projectId, match[1]!)] : [];
      })
    );
    return outputAssets.filter((asset): asset is StudioAssetV2 => asset !== null);
  };

  const resolveAsset = async (
    projectId: string,
    assetId: string
  ): Promise<{
    asset: StudioAsset;
    openVerifiedStream: (start?: number, end?: number) => Promise<Readable>;
  } | null> => {
    if (!SAFE_ID.test(projectId) || !SAFE_ID.test(assetId)) return null;
    try {
      const [projectDir, project] = await Promise.all([
        deps.store.getVerifiedProjectDirectory(projectId),
        deps.store.getProject(projectId),
      ]);
      if (!projectDir || !project) return null;
      const asset = project.assets[assetId] ?? (await readProjectOutputAsset(projectDir, projectId, assetId));
      if (!asset || asset.projectId !== projectId) return null;
      if (!STUDIO_MANAGED_ASSET_COLLECTIONS.has(asset.managedAsset.collection)) return null;
      if (!/^[A-Za-z0-9_-]+\.(?:jpg|png|webp|mp4|webm)$/.test(asset.managedAsset.fileName)) return null;
      const collectionDir = path.join(projectDir, asset.managedAsset.collection);
      if (path.dirname(collectionDir) !== projectDir) return null;
      const dirStats = await fs.lstat(collectionDir);
      if (!dirStats.isDirectory() || dirStats.isSymbolicLink() || (await fs.realpath(collectionDir)) !== collectionDir)
        return null;
      const filePath = path.join(collectionDir, asset.managedAsset.fileName);
      if (path.dirname(filePath) !== collectionDir) return null;
      const pathStats = await regularFile(filePath);
      if ((await fs.realpath(filePath)) !== filePath) return null;
      const stats = await fs.stat(filePath);
      const pathIdentity = fileIdentity(pathStats);
      const statsIdentity = fileIdentity(stats);
      if (pathIdentity.dev !== statsIdentity.dev || pathIdentity.ino !== statsIdentity.ino) return null;
      const cached = verifiedFiles.get(filePath);
      let sha256: string;
      let sample: Buffer;
      let shouldCache = false;
      if (cached?.size === stats.size && cached.mtimeMs === stats.mtimeMs) {
        sha256 = cached.sha256;
        const sampleHandle = await fs.open(filePath, 'r');
        try {
          const opened = await sampleHandle.stat();
          const openedIdentity = fileIdentity(opened);
          if (
            openedIdentity.dev !== pathIdentity.dev ||
            openedIdentity.ino !== pathIdentity.ino ||
            opened.size !== stats.size ||
            opened.mtimeMs !== stats.mtimeMs
          ) {
            return null;
          }
          const sampleBuffer = Buffer.alloc(32);
          const { bytesRead } = await sampleHandle.read(sampleBuffer, 0, sampleBuffer.length, 0);
          sample = sampleBuffer.subarray(0, bytesRead);
        } finally {
          await sampleHandle.close();
        }
      } else {
        const verifier = createHash('sha256');
        sample = Buffer.alloc(0);
        for await (const chunk of await openVerifiedReadStream(filePath)) {
          const bytes = Buffer.from(chunk);
          verifier.update(bytes);
          if (sample.length < 32) sample = Buffer.concat([sample, bytes]).subarray(0, 32);
        }
        sha256 = verifier.digest('hex');
        shouldCache = true;
      }
      const signature = sniff(sample);
      if (
        stats.size !== asset.byteSize ||
        sha256 !== asset.sha256 ||
        !signature ||
        signature.mimeType !== asset.mimeType
      )
        return null;
      const after = await fs.lstat(filePath);
      const afterIdentity = fileIdentity(after);
      if (
        pathIdentity.dev !== afterIdentity.dev ||
        pathIdentity.ino !== afterIdentity.ino ||
        after.size !== stats.size ||
        after.mtimeMs !== stats.mtimeMs
      )
        return null;
      if (shouldCache) cacheVerifiedIdentity(filePath, { size: stats.size, mtimeMs: stats.mtimeMs, sha256 });
      const expectation: VerifiedReadExpectation = {
        ...pathIdentity,
        byteSize: asset.byteSize,
        mtimeMs: stats.mtimeMs,
        sha256: asset.sha256,
        mimeType: asset.mimeType,
        verifyContent: false,
      };
      return {
        asset,
        openVerifiedStream: async (start, end) => {
          const current = await fs.stat(filePath);
          const currentCached = verifiedFiles.get(filePath);
          if (
            currentCached?.size !== current.size ||
            currentCached.mtimeMs !== current.mtimeMs ||
            currentCached.sha256 !== asset.sha256
          ) {
            const refreshed = await resolveAsset(projectId, assetId);
            if (refreshed === null) throw new CreativeStudioMediaError('storage_error');
          }
          return openVerifiedReadStream(filePath, start, end, undefined, expectation);
        },
      };
    } catch {
      return null;
    }
  };

  const resolveAssetV2 = async (
    projectId: string,
    assetId: string
  ): Promise<{
    asset: StudioAssetV2;
    openVerifiedStream: (start?: number, end?: number) => Promise<Readable>;
  } | null> => {
    if (!SAFE_ID.test(projectId) || !SAFE_ID.test(assetId)) return null;
    try {
      const { projectDir, project } = await loadProjectContextV2(projectId);
      const asset =
        ownRecordValue(project.assets, assetId) ?? (await readProjectOutputAssetV2(projectDir, projectId, assetId));
      if (!asset || asset.projectId !== projectId) return null;
      if (!STUDIO_MANAGED_ASSET_COLLECTIONS.has(asset.managedAsset.collection)) return null;
      if (!/^[A-Za-z0-9_-]+\.(?:jpg|png|webp|mp4|webm)$/.test(asset.managedAsset.fileName)) return null;
      const collectionDir = path.join(projectDir, asset.managedAsset.collection);
      if (path.dirname(collectionDir) !== projectDir) return null;
      const dirStats = await fs.lstat(collectionDir);
      if (!dirStats.isDirectory() || dirStats.isSymbolicLink() || (await fs.realpath(collectionDir)) !== collectionDir)
        return null;
      const filePath = path.join(collectionDir, asset.managedAsset.fileName);
      if (path.dirname(filePath) !== collectionDir) return null;
      const pathStats = await regularFile(filePath);
      if ((await fs.realpath(filePath)) !== filePath) return null;
      const stats = await fs.stat(filePath);
      const pathIdentity = fileIdentity(pathStats);
      const statsIdentity = fileIdentity(stats);
      if (pathIdentity.dev !== statsIdentity.dev || pathIdentity.ino !== statsIdentity.ino) return null;
      const cached = verifiedFiles.get(filePath);
      let sha256: string;
      let sample: Buffer;
      let shouldCache = false;
      if (cached?.size === stats.size && cached.mtimeMs === stats.mtimeMs) {
        sha256 = cached.sha256;
        const sampleHandle = await fs.open(filePath, 'r');
        try {
          const opened = await sampleHandle.stat();
          const openedIdentity = fileIdentity(opened);
          if (
            openedIdentity.dev !== pathIdentity.dev ||
            openedIdentity.ino !== pathIdentity.ino ||
            opened.size !== stats.size ||
            opened.mtimeMs !== stats.mtimeMs
          ) {
            return null;
          }
          const sampleBuffer = Buffer.alloc(32);
          const { bytesRead } = await sampleHandle.read(sampleBuffer, 0, sampleBuffer.length, 0);
          sample = sampleBuffer.subarray(0, bytesRead);
        } finally {
          await sampleHandle.close();
        }
      } else {
        const verifier = createHash('sha256');
        sample = Buffer.alloc(0);
        for await (const chunk of await openVerifiedReadStream(filePath)) {
          const bytes = Buffer.from(chunk);
          verifier.update(bytes);
          if (sample.length < 32) sample = Buffer.concat([sample, bytes]).subarray(0, 32);
        }
        sha256 = verifier.digest('hex');
        shouldCache = true;
      }
      const signature = sniff(sample);
      if (
        stats.size !== asset.byteSize ||
        sha256 !== asset.sha256 ||
        !signature ||
        signature.mimeType !== asset.mimeType
      ) {
        return null;
      }
      const after = await fs.lstat(filePath);
      const afterIdentity = fileIdentity(after);
      if (
        pathIdentity.dev !== afterIdentity.dev ||
        pathIdentity.ino !== afterIdentity.ino ||
        after.size !== stats.size ||
        after.mtimeMs !== stats.mtimeMs
      ) {
        return null;
      }
      if (shouldCache) cacheVerifiedIdentity(filePath, { size: stats.size, mtimeMs: stats.mtimeMs, sha256 });
      const expectation: VerifiedReadExpectation = {
        ...pathIdentity,
        byteSize: asset.byteSize,
        mtimeMs: stats.mtimeMs,
        sha256: asset.sha256,
        mimeType: asset.mimeType,
        verifyContent: false,
      };
      return {
        asset,
        openVerifiedStream: async (start, end) => {
          const current = await fs.stat(filePath);
          const currentCached = verifiedFiles.get(filePath);
          if (
            currentCached?.size !== current.size ||
            currentCached.mtimeMs !== current.mtimeMs ||
            currentCached.sha256 !== asset.sha256
          ) {
            const refreshed = await resolveAssetV2(projectId, assetId);
            if (refreshed === null) throw new CreativeStudioMediaError('storage_error');
          }
          return openVerifiedReadStream(filePath, start, end, undefined, expectation);
        },
      };
    } catch (error) {
      if (error instanceof CreativeStudioStoreError) throw error;
      return null;
    }
  };

  const resolveProviderInput = async (
    projectId: string,
    assetId: string
  ): Promise<{
    assetId: string;
    mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
    byteSize: number;
    openStream: () => Promise<Readable>;
    asDataUrl: (maxBytes: number) => Promise<string>;
  }> => {
    const resolved = await resolveAsset(projectId, assetId);
    if (!resolved || !['image/jpeg', 'image/png', 'image/webp'].includes(resolved.asset.mimeType)) {
      throw new CreativeStudioMediaError('invalid_media');
    }
    const mimeType = resolved.asset.mimeType as 'image/jpeg' | 'image/png' | 'image/webp';
    return {
      assetId,
      mimeType,
      byteSize: resolved.asset.byteSize,
      openStream: () => resolved.openVerifiedStream(),
      asDataUrl: async (maxBytes) => {
        if (!Number.isSafeInteger(maxBytes) || maxBytes < resolved.asset.byteSize) {
          throw new CreativeStudioMediaError('invalid_media');
        }
        const chunks: Buffer[] = [];
        for await (const chunk of await resolved.openVerifiedStream()) chunks.push(Buffer.from(chunk));
        const bytes = Buffer.concat(chunks);
        if (bytes.length !== resolved.asset.byteSize) throw new CreativeStudioMediaError('invalid_media');
        return `data:${mimeType};base64,${bytes.toString('base64')}`;
      },
    };
  };

  const resolveProviderInputV2 = async (
    projectId: string,
    assetId: string
  ): Promise<{
    assetId: string;
    mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
    byteSize: number;
    openStream: () => Promise<Readable>;
    asDataUrl: (maxBytes: number) => Promise<string>;
  }> => {
    const resolved = await resolveAssetV2(projectId, assetId);
    if (!resolved || !['image/jpeg', 'image/png', 'image/webp'].includes(resolved.asset.mimeType)) {
      throw new CreativeStudioMediaError('invalid_media');
    }
    const mimeType = resolved.asset.mimeType as 'image/jpeg' | 'image/png' | 'image/webp';
    return {
      assetId,
      mimeType,
      byteSize: resolved.asset.byteSize,
      openStream: () => resolved.openVerifiedStream(),
      asDataUrl: async (maxBytes) => {
        if (!Number.isSafeInteger(maxBytes) || maxBytes < resolved.asset.byteSize) {
          throw new CreativeStudioMediaError('invalid_media');
        }
        const chunks: Buffer[] = [];
        for await (const chunk of await resolved.openVerifiedStream()) chunks.push(Buffer.from(chunk));
        const bytes = Buffer.concat(chunks);
        if (bytes.length !== resolved.asset.byteSize) throw new CreativeStudioMediaError('invalid_media');
        return `data:${mimeType};base64,${bytes.toString('base64')}`;
      },
    };
  };

  type ProviderOutputMetadata = Omit<PersistProviderOutputInput, 'body'>;
  type ProviderJobOutputMetadata = Omit<PersistProviderJobOutputInput, 'body'>;
  type ProviderJobPosterMetadata = Omit<PersistProviderJobPosterInput, 'body'>;
  type ProviderJobOutputMetadataV2 = Omit<PersistProviderJobOutputInputV2, 'body'>;
  type ProviderJobPosterMetadataV2 = Omit<PersistProviderJobPosterInputV2, 'body'>;
  type ManagedWritePlan = {
    projectDir: string;
    project: StudioProject;
    capacity: WriteCapacity;
    collection: 'assets' | 'thumbnails' | 'references';
  };
  type ManagedWritePlanV2 = {
    projectDir: string;
    project: StudioProjectV2;
    authority: StudioProjectPathAuthorityV2;
    capacity: WriteCapacity;
    collection: 'assets' | 'thumbnails' | 'references';
  };

  const validateProviderOutputMetadata = (
    input: ProviderOutputMetadata | ProviderJobOutputMetadata,
    requireExpectedRevision: boolean
  ): void => {
    if (
      !SAFE_ID.test(input.projectId) ||
      !SAFE_ID.test(input.sceneId) ||
      (input.mediaKind !== 'image' && input.mediaKind !== 'video') ||
      typeof input.declaredMimeType !== 'string'
    ) {
      throw new CreativeStudioMediaError('invalid_media');
    }
    if (
      requireExpectedRevision &&
      (!('expectedRevision' in input) || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1)
    ) {
      throw new CreativeStudioMediaError('invalid_media');
    }
    if ('jobId' in input && !SAFE_ID.test(input.jobId)) throw new CreativeStudioMediaError('invalid_media');
    if (
      (input.width !== undefined && (!Number.isSafeInteger(input.width) || input.width < 1)) ||
      (input.height !== undefined && (!Number.isSafeInteger(input.height) || input.height < 1)) ||
      (input.durationSeconds !== undefined &&
        (!Number.isFinite(input.durationSeconds) ||
          input.durationSeconds <= 0 ||
          input.durationSeconds > Number.MAX_SAFE_INTEGER))
    ) {
      throw new CreativeStudioMediaError('invalid_media');
    }
    if (
      input.declaredByteSize !== undefined &&
      (!Number.isSafeInteger(input.declaredByteSize) || input.declaredByteSize < 0)
    ) {
      throw new CreativeStudioMediaError('invalid_media');
    }
  };

  const validateProviderOutputMetadataV2 = (input: ProviderJobOutputMetadataV2 | ProviderJobPosterMetadataV2): void => {
    if (
      !SAFE_ID.test(input.projectId) ||
      !SAFE_ID.test(input.clipId) ||
      !SAFE_ID.test(input.jobId) ||
      typeof input.declaredMimeType !== 'string' ||
      ('mediaKind' in input && input.mediaKind !== 'image' && input.mediaKind !== 'video') ||
      (input.width !== undefined && (!Number.isSafeInteger(input.width) || input.width < 1)) ||
      (input.height !== undefined && (!Number.isSafeInteger(input.height) || input.height < 1)) ||
      ('durationSeconds' in input &&
        input.durationSeconds !== undefined &&
        (!Number.isFinite(input.durationSeconds) ||
          input.durationSeconds <= 0 ||
          input.durationSeconds > Number.MAX_SAFE_INTEGER)) ||
      (input.declaredByteSize !== undefined &&
        (!Number.isSafeInteger(input.declaredByteSize) || input.declaredByteSize < 0))
    ) {
      throw new CreativeStudioMediaError('invalid_media');
    }
  };

  const owningBeatForShotV2 = (
    project: StudioProjectV2,
    shotId: string
  ): StudioProjectV2['sections'][string] | null => {
    const owners = Object.values(project.sections).filter((beat) => beat.clipOrder.includes(shotId));
    return owners.length === 1 ? owners[0]! : null;
  };

  const prepareProviderWrite = async (input: ProviderOutputMetadata): Promise<ManagedWritePlan> => {
    validateProviderOutputMetadata(input, true);
    const [projectDir, project] = await Promise.all([
      deps.store.getVerifiedProjectDirectory(input.projectId),
      deps.store.getProject(input.projectId),
    ]);
    if (!projectDir || !project || project.revision !== input.expectedRevision || !project.scenes[input.sceneId]) {
      throw new CreativeStudioMediaError(project?.revision !== input.expectedRevision ? 'stale_project' : 'not_found');
    }
    const perAssetMaxBytes = input.mediaKind === 'video' ? limits.videoOutputMaxBytes : limits.imageOutputMaxBytes;
    return {
      projectDir,
      project,
      capacity: await planWriteCapacity(project, projectDir, perAssetMaxBytes, input.declaredByteSize),
      collection: 'assets',
    };
  };

  const prepareProviderJobWrite = async (input: ProviderJobOutputMetadata): Promise<ManagedWritePlan> => {
    validateProviderOutputMetadata(input, false);
    const [projectDir, project] = await Promise.all([
      deps.store.getVerifiedProjectDirectory(input.projectId),
      deps.store.getProject(input.projectId),
    ]);
    const scene = project?.scenes[input.sceneId];
    const job = project?.jobs[input.jobId];
    // Must match commitProviderJobAsset: StudioJob.outputRole is immutable after creation.
    const role = job ? jobOutputRole(job) : null;
    const mediaKindMatchesRole =
      role === 'reference' ? input.mediaKind === 'image' : scene?.mediaKind === input.mediaKind;
    if (scene && !mediaKindMatchesRole) {
      throw new CreativeStudioMediaError('invalid_media');
    }
    const active =
      job?.status === 'submitting' ||
      job?.status === 'running' ||
      (job?.status === 'failed' && job.error?.code === 'download_failed');
    if (
      !projectDir ||
      !project ||
      !scene ||
      !mediaKindMatchesRole ||
      !job ||
      job.sceneId !== input.sceneId ||
      !active
    ) {
      throw new CreativeStudioMediaError(project && job ? 'job_inactive' : 'not_found');
    }
    // A reference is already required to be an image above, so the kind check alone is sufficient;
    // the references collection also keeps plates out of canonical-take predicates as defence in depth.
    const perAssetMaxBytes = input.mediaKind === 'video' ? limits.videoOutputMaxBytes : limits.imageOutputMaxBytes;
    return {
      projectDir,
      project,
      capacity: await planWriteCapacity(project, projectDir, perAssetMaxBytes, input.declaredByteSize),
      collection: role === 'reference' ? 'references' : 'assets',
    };
  };

  const prepareProviderJobWriteV2 = async (input: ProviderJobOutputMetadataV2): Promise<ManagedWritePlanV2> => {
    validateProviderOutputMetadataV2(input);
    const { projectDir, project, authority } = await loadProjectContextV2(input.projectId);
    const shot = ownRecordValue(project.clips, input.clipId);
    const job = ownRecordValue(project.jobs, input.jobId);
    const beat = owningBeatForShotV2(project, input.clipId);
    const role = job ? jobOutputRole(job) : null;
    const mediaKindMatchesRole =
      role === 'reference' ? input.mediaKind === 'image' : shot?.mediaKind === input.mediaKind;
    if (shot && !mediaKindMatchesRole) throw new CreativeStudioMediaError('invalid_media');
    const active =
      job?.status === 'submitting' ||
      job?.status === 'running' ||
      (job?.status === 'failed' && job.error?.code === 'download_failed');
    if (
      !shot ||
      !beat ||
      !job ||
      job.projectId !== input.projectId ||
      job.clipId !== input.clipId ||
      !shot.jobIds.includes(job.id) ||
      !mediaKindMatchesRole ||
      !active
    ) {
      throw new CreativeStudioMediaError(project && job ? 'job_inactive' : 'not_found');
    }
    const perAssetMaxBytes = input.mediaKind === 'video' ? limits.videoOutputMaxBytes : limits.imageOutputMaxBytes;
    return {
      projectDir,
      project,
      authority,
      capacity: await planWriteCapacity(project, projectDir, perAssetMaxBytes, input.declaredByteSize),
      collection: role === 'reference' ? 'references' : 'assets',
    };
  };

  const validateProviderPosterLineage = (
    project: StudioProject,
    input: ProviderJobPosterMetadata
  ): { scene: StudioProject['scenes'][string]; job: StudioProject['jobs'][string] } => {
    const scene = project.scenes[input.sceneId];
    const job = project.jobs[input.jobId];
    if (!scene || !job) throw new CreativeStudioMediaError('not_found');
    if (scene.mediaKind !== 'video') throw new CreativeStudioMediaError('invalid_media');
    if (job.status !== 'succeeded') throw new CreativeStudioMediaError('job_inactive');
    const primary = project.assets[input.primaryAssetId];
    if (
      !primary ||
      primary.projectId !== input.projectId ||
      primary.sceneId !== input.sceneId ||
      primary.mediaKind !== 'video' ||
      primary.managedAsset.collection !== 'assets'
    ) {
      throw new CreativeStudioMediaError('job_inactive');
    }
    if (
      job.projectId !== input.projectId ||
      job.sceneId !== input.sceneId ||
      job.outputAssetIds.length !== 1 ||
      job.outputAssetIds[0] !== input.primaryAssetId ||
      !scene.assetIds.includes(input.primaryAssetId)
    ) {
      throw new CreativeStudioMediaError('job_inactive');
    }
    return { scene, job };
  };

  const prepareProviderPosterWrite = async (input: ProviderJobPosterMetadata): Promise<ManagedWritePlan> => {
    validateProviderOutputMetadata({ ...input, mediaKind: 'image' }, false);
    if (!SAFE_ID.test(input.primaryAssetId) || !input.declaredMimeType.startsWith('image/')) {
      throw new CreativeStudioMediaError('invalid_media');
    }
    const [projectDir, project] = await Promise.all([
      deps.store.getVerifiedProjectDirectory(input.projectId),
      deps.store.getProject(input.projectId),
    ]);
    if (!projectDir || !project) throw new CreativeStudioMediaError('not_found');
    validateProviderPosterLineage(project, input);
    return {
      projectDir,
      project,
      capacity: await planWriteCapacity(project, projectDir, limits.imageOutputMaxBytes, input.declaredByteSize),
      collection: 'thumbnails',
    };
  };

  const validateProviderPosterLineageV2 = (
    project: StudioProjectV2,
    input: ProviderJobPosterMetadataV2
  ): { shot: StudioProjectV2['clips'][string]; job: StudioProjectV2['jobs'][string] } => {
    const shot = ownRecordValue(project.clips, input.clipId);
    const job = ownRecordValue(project.jobs, input.jobId);
    if (!shot || !job) throw new CreativeStudioMediaError('not_found');
    if (shot.mediaKind !== 'video') throw new CreativeStudioMediaError('invalid_media');
    if (job.status !== 'succeeded') throw new CreativeStudioMediaError('job_inactive');
    const primary = ownRecordValue(project.assets, input.primaryAssetId);
    if (
      !primary ||
      primary.projectId !== input.projectId ||
      primary.clipId !== input.clipId ||
      primary.mediaKind !== 'video' ||
      primary.managedAsset.collection !== 'assets'
    ) {
      throw new CreativeStudioMediaError('job_inactive');
    }
    if (
      jobOutputRole(job) === 'reference' ||
      job.projectId !== input.projectId ||
      job.clipId !== input.clipId ||
      job.outputAssetIds.length !== 1 ||
      job.outputAssetIds[0] !== input.primaryAssetId ||
      !shot.assetIds.includes(input.primaryAssetId) ||
      !shot.jobIds.includes(input.jobId)
    ) {
      throw new CreativeStudioMediaError('job_inactive');
    }
    return { shot, job };
  };

  const prepareProviderPosterWriteV2 = async (input: ProviderJobPosterMetadataV2): Promise<ManagedWritePlanV2> => {
    validateProviderOutputMetadataV2({ ...input, mediaKind: 'image' });
    if (!SAFE_ID.test(input.primaryAssetId) || !input.declaredMimeType.startsWith('image/')) {
      throw new CreativeStudioMediaError('invalid_media');
    }
    const { projectDir, project, authority } = await loadProjectContextV2(input.projectId);
    validateProviderPosterLineageV2(project, input);
    return {
      projectDir,
      project,
      authority,
      capacity: await planWriteCapacity(project, projectDir, limits.imageOutputMaxBytes, input.declaredByteSize),
      collection: 'thumbnails',
    };
  };

  type CapturedPosterMetadata = Omit<PersistCapturedPosterInput, 'body'>;

  const validateCapturedPosterLineage = (
    project: StudioProject,
    input: CapturedPosterMetadata
  ): { scene: StudioProject['scenes'][string]; job: StudioProject['jobs'][string] } => {
    const scene = project.scenes[input.sceneId];
    const video = project.assets[input.videoAssetId];
    if (!scene || !video) throw new CreativeStudioMediaError('not_found');
    if (
      scene.mediaKind !== 'video' ||
      scene.selectedAssetId !== input.videoAssetId ||
      !scene.assetIds.includes(input.videoAssetId) ||
      video.projectId !== input.projectId ||
      video.sceneId !== input.sceneId ||
      video.mediaKind !== 'video' ||
      video.managedAsset.collection !== 'assets'
    ) {
      throw new CreativeStudioMediaError('job_inactive');
    }
    const producers = scene.jobIds.flatMap((jobId) => {
      const job = project.jobs[jobId];
      return job?.projectId === input.projectId &&
        job.sceneId === input.sceneId &&
        job.status === 'succeeded' &&
        job.outputAssetIds.length === 1 &&
        job.outputAssetIds[0] === input.videoAssetId
        ? [job]
        : [];
    });
    if (producers.length !== 1) throw new CreativeStudioMediaError('job_inactive');
    return { scene, job: producers[0]! };
  };

  const prepareCapturedPosterWrite = async (input: CapturedPosterMetadata): Promise<ManagedWritePlan> => {
    if (
      !SAFE_ID.test(input.projectId) ||
      !SAFE_ID.test(input.sceneId) ||
      !SAFE_ID.test(input.videoAssetId) ||
      !Number.isSafeInteger(input.width) ||
      input.width < 1 ||
      !Number.isSafeInteger(input.height) ||
      input.height < 1 ||
      (input.declaredByteSize !== undefined &&
        (!Number.isSafeInteger(input.declaredByteSize) || input.declaredByteSize < 0))
    ) {
      throw new CreativeStudioMediaError('invalid_media');
    }
    const [projectDir, project] = await Promise.all([
      deps.store.getVerifiedProjectDirectory(input.projectId),
      deps.store.getProject(input.projectId),
    ]);
    if (!projectDir || !project) throw new CreativeStudioMediaError('not_found');
    validateCapturedPosterLineage(project, input);
    return {
      projectDir,
      project,
      capacity: await planWriteCapacity(project, projectDir, limits.imageOutputMaxBytes, input.declaredByteSize),
      collection: 'thumbnails',
    };
  };

  type CapturedPosterMetadataV2 = Omit<PersistCapturedPosterInputV2, 'body'>;

  const validateCapturedPosterLineageV2 = (
    project: StudioProjectV2,
    input: CapturedPosterMetadataV2
  ): { shot: StudioProjectV2['clips'][string]; job: StudioProjectV2['jobs'][string] } => {
    const shot = ownRecordValue(project.clips, input.clipId);
    const video = ownRecordValue(project.assets, input.videoAssetId);
    if (!shot || !video) throw new CreativeStudioMediaError('not_found');
    if (
      shot.mediaKind !== 'video' ||
      shot.selectedAssetId !== input.videoAssetId ||
      !shot.assetIds.includes(input.videoAssetId) ||
      video.projectId !== input.projectId ||
      video.clipId !== input.clipId ||
      video.mediaKind !== 'video' ||
      video.managedAsset.collection !== 'assets'
    ) {
      throw new CreativeStudioMediaError('job_inactive');
    }
    const producers = shot.jobIds.flatMap((jobId) => {
      const job = ownRecordValue(project.jobs, jobId);
      return job?.projectId === input.projectId &&
        job.clipId === input.clipId &&
        jobOutputRole(job) !== 'reference' &&
        job.status === 'succeeded' &&
        job.outputAssetIds.length === 1 &&
        job.outputAssetIds[0] === input.videoAssetId
        ? [job]
        : [];
    });
    if (producers.length !== 1) throw new CreativeStudioMediaError('job_inactive');
    return { shot, job: producers[0]! };
  };

  const prepareCapturedPosterWriteV2 = async (input: CapturedPosterMetadataV2): Promise<ManagedWritePlanV2> => {
    if (
      !SAFE_ID.test(input.projectId) ||
      !SAFE_ID.test(input.clipId) ||
      !SAFE_ID.test(input.videoAssetId) ||
      !Number.isSafeInteger(input.width) ||
      input.width < 1 ||
      !Number.isSafeInteger(input.height) ||
      input.height < 1 ||
      (input.declaredByteSize !== undefined &&
        (!Number.isSafeInteger(input.declaredByteSize) || input.declaredByteSize < 0))
    ) {
      throw new CreativeStudioMediaError('invalid_media');
    }
    const { projectDir, project, authority } = await loadProjectContextV2(input.projectId);
    validateCapturedPosterLineageV2(project, input);
    return {
      projectDir,
      project,
      authority,
      capacity: await planWriteCapacity(project, projectDir, limits.imageOutputMaxBytes, input.declaredByteSize),
      collection: 'thumbnails',
    };
  };

  type ManagedStreamInput = {
    projectId: string;
    sceneId: string | null;
    mediaKind: 'image' | 'video';
    declaredMimeType: string;
    declaredByteSize?: number;
    width?: number;
    height?: number;
    durationSeconds?: number;
    body: AsyncIterable<Uint8Array>;
  };

  type ManagedStreamInputV2 = Omit<ManagedStreamInput, 'sceneId'> & { clipId: string | null };

  const persistManagedOutputWithPlan = async (
    input: ManagedStreamInput,
    plan: ManagedWritePlan,
    commit: (asset: StudioAsset) => Promise<void>
  ): Promise<StudioAsset> => {
    const assetId = createId();
    if (!SAFE_ID.test(assetId)) throw new CreativeStudioMediaError('storage_error');
    let partPath: string | null = null;
    let finalPath: string | null = null;
    let finalIdentity: FileIdentity | null = null;
    try {
      const partsDir = await ensureManagedDirectory(plan.projectDir, 'parts');
      const collectionDir = await ensureManagedDirectory(plan.projectDir, plan.collection);
      partPath = path.join(partsDir, `${assetId}.part`);
      const writer = createWriteStream(partPath, { flags: 'wx' });
      const hash = createHash('sha256');
      let byteSize = 0;
      let sample = Buffer.alloc(0);
      const checker = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          byteSize += chunk.length;
          if (byteSize > plan.capacity.maxBytes) {
            return callback(new CreativeStudioMediaError(plan.capacity.overflowCode));
          }
          hash.update(chunk);
          if (sample.length < 32) sample = Buffer.concat([sample, chunk]).subarray(0, 32);
          callback(null, chunk);
        },
      });
      await pipeline(Readable.from(input.body), checker, writer);
      if (input.declaredByteSize !== undefined && byteSize !== input.declaredByteSize) {
        throw new CreativeStudioMediaError('invalid_media');
      }
      const signature = sniff(sample);
      const signatureKind = signature?.mimeType.startsWith('video/') ? 'video' : 'image';
      if (!signature || signature.mimeType !== input.declaredMimeType || input.mediaKind !== signatureKind) {
        throw new CreativeStudioMediaError('invalid_media');
      }
      finalPath = path.join(collectionDir, `${assetId}.${signature.extension}`);
      finalIdentity = await finalizeManagedPart(partPath, partsDir, finalPath, collectionDir);
      partPath = null;
      const asset: StudioAsset = {
        id: assetId,
        projectId: input.projectId,
        sceneId: input.sceneId,
        mediaKind: input.mediaKind,
        mimeType: signature.mimeType,
        managedAsset: { collection: plan.collection, fileName: `${assetId}.${signature.extension}` },
        byteSize,
        sha256: hash.digest('hex'),
        ...(input.width === undefined ? {} : { width: input.width }),
        ...(input.height === undefined ? {} : { height: input.height }),
        ...(input.durationSeconds === undefined ? {} : { durationSeconds: input.durationSeconds }),
        createdAt: now(),
      };
      await commit(asset);
      return asset;
    } catch (error) {
      if (partPath) await fs.rm(partPath, { force: true }).catch((): undefined => undefined);
      if (finalPath !== null && finalIdentity !== null) {
        await unlinkIfIdentityMatches(finalPath, finalIdentity);
      }
      return mapStoreError(error);
    }
  };

  const persistManagedOutputWithPlanV2 = async (
    input: ManagedStreamInputV2,
    plan: ManagedWritePlanV2,
    commit: (asset: StudioAssetV2) => Promise<void>
  ): Promise<StudioAssetV2> => {
    const assetId = createId();
    if (!SAFE_ID.test(assetId)) throw new CreativeStudioMediaError('storage_error');
    let partPath: string | null = null;
    let partIdentity: FileIdentity | null = null;
    let finalPath: string | null = null;
    let finalIdentity: FileIdentity | null = null;
    try {
      const partsDirectory = await ensureManagedDirectoryV2(plan.authority, 'parts');
      const collectionDirectory = await ensureManagedDirectoryV2(plan.authority, plan.collection);
      const partsDir = partsDirectory.directory;
      const collectionDir = collectionDirectory.directory;
      partPath = path.join(partsDir, `${assetId}.part`);
      const hash = createHash('sha256');
      let byteSize = 0;
      let sample = Buffer.alloc(0);
      const checker = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          byteSize += chunk.length;
          if (byteSize > plan.capacity.maxBytes) {
            return callback(new CreativeStudioMediaError(plan.capacity.overflowCode));
          }
          hash.update(chunk);
          if (sample.length < 32) sample = Buffer.concat([sample, chunk]).subarray(0, 32);
          callback(null, chunk);
        },
      });
      await assertV2ManagedMutation(plan.authority, [partsDirectory]);
      const partHandle = await fs.open(partPath, 'wx');
      try {
        await assertV2ManagedMutation(plan.authority, [partsDirectory]);
        const openedPart = await partHandle.stat();
        if (!openedPart.isFile()) throw new CreativeStudioMediaError('storage_error');
        partIdentity = fileIdentity(openedPart);
        await pipeline(
          Readable.from(input.body),
          checker,
          createWriteStream(partPath, { fd: partHandle.fd, autoClose: false })
        );
      } finally {
        await partHandle.close().catch((): undefined => undefined);
      }
      await assertV2ManagedMutation(plan.authority, [partsDirectory]);
      const completedPart = await regularFile(partPath);
      const completedPartIdentity = fileIdentity(completedPart);
      if (
        partIdentity === null ||
        completedPartIdentity.dev !== partIdentity.dev ||
        completedPartIdentity.ino !== partIdentity.ino
      ) {
        throw new CreativeStudioMediaError('storage_error');
      }
      if (input.declaredByteSize !== undefined && byteSize !== input.declaredByteSize) {
        throw new CreativeStudioMediaError('invalid_media');
      }
      const signature = sniff(sample);
      const signatureKind = signature?.mimeType.startsWith('video/') ? 'video' : 'image';
      if (!signature || signature.mimeType !== input.declaredMimeType || input.mediaKind !== signatureKind) {
        throw new CreativeStudioMediaError('invalid_media');
      }
      finalPath = path.join(collectionDir, `${assetId}.${signature.extension}`);
      finalIdentity = await finalizeManagedPartV2(
        partPath,
        partsDir,
        finalPath,
        collectionDir,
        partIdentity,
        () => assertV2ManagedMutation(plan.authority, [partsDirectory, collectionDirectory]),
        (identity) => {
          finalIdentity = identity;
        }
      );
      partPath = null;
      partIdentity = null;
      const asset: StudioAssetV2 = {
        id: assetId,
        projectId: input.projectId,
        clipId: input.clipId,
        mediaKind: input.mediaKind,
        mimeType: signature.mimeType,
        managedAsset: { collection: plan.collection, fileName: `${assetId}.${signature.extension}` },
        byteSize,
        sha256: hash.digest('hex'),
        ...(input.width === undefined ? {} : { width: input.width }),
        ...(input.height === undefined ? {} : { height: input.height }),
        ...(input.durationSeconds === undefined ? {} : { durationSeconds: input.durationSeconds }),
        createdAt: now(),
      };
      await assertV2ManagedMutation(plan.authority, [collectionDirectory]);
      await commit(asset);
      return asset;
    } catch (error) {
      await cleanupUncommittedManagedPathsV2(input.projectId, assetId, [
        { filePath: partPath, identity: partIdentity },
        { filePath: finalPath, identity: finalIdentity },
      ]);
      return mapStoreError(error);
    }
  };

  const commitProviderAsset = async (input: ProviderOutputMetadata, asset: StudioAsset): Promise<void> => {
    await deps.store.updateProject(
      input.projectId,
      (current) => {
        const next = structuredClone(current);
        next.assets[asset.id] = asset;
        next.scenes[input.sceneId].assetIds.push(asset.id);
        return next;
      },
      input.expectedRevision
    );
  };

  const persistProviderOutput = async (input: PersistProviderOutputInput): Promise<StudioAsset> => {
    const plan = await prepareProviderWrite(input);
    return persistManagedOutputWithPlan(input, plan, (asset) => commitProviderAsset(input, asset));
  };

  const prepareProjectOutputWrite = async (
    input: Omit<PersistProjectOutputInput, 'body'>
  ): Promise<ManagedWritePlan> => {
    if (
      !SAFE_ID.test(input.projectId) ||
      input.declaredMimeType !== 'video/mp4' ||
      !Number.isSafeInteger(input.width) ||
      input.width < 1 ||
      !Number.isSafeInteger(input.height) ||
      input.height < 1 ||
      (input.declaredByteSize !== undefined &&
        (!Number.isSafeInteger(input.declaredByteSize) || input.declaredByteSize < 1)) ||
      (input.durationSeconds !== undefined && (!Number.isFinite(input.durationSeconds) || input.durationSeconds <= 0))
    ) {
      throw new CreativeStudioMediaError('invalid_media');
    }
    const [projectDir, project] = await Promise.all([
      deps.store.getVerifiedProjectDirectory(input.projectId),
      deps.store.getProject(input.projectId),
    ]);
    if (!projectDir || !project) throw new CreativeStudioMediaError('not_found');
    const outputAssets = await listProjectOutputAssets(projectDir, input.projectId);
    const outputBytes = outputAssets.reduce((total, asset) => total + (asset?.byteSize ?? 0), 0);
    return {
      projectDir,
      project,
      capacity: await planWriteCapacity(
        project,
        projectDir,
        limits.videoOutputMaxBytes,
        input.declaredByteSize,
        outputBytes
      ),
      collection: 'assets',
    };
  };

  const persistProjectOutput = async (input: PersistProjectOutputInput): Promise<StudioAsset> => {
    const plan = await prepareProjectOutputWrite(input);
    return persistManagedOutputWithPlan({ ...input, sceneId: null, mediaKind: 'video' }, plan, async (asset) => {
      const partsDir = await ensureManagedDirectory(plan.projectDir, 'parts');
      const assetsDir = await ensureManagedDirectory(plan.projectDir, 'assets');
      const metadataPart = path.join(partsDir, `${asset.id}.render-metadata.part`);
      const metadataPath = path.join(assetsDir, `${asset.id}.render.json`);
      try {
        await fs.writeFile(metadataPart, JSON.stringify(asset), { encoding: 'utf8', flag: 'wx' });
        await finalizeManagedPart(metadataPart, partsDir, metadataPath, assetsDir);
      } catch (error) {
        await fs.rm(metadataPart, { force: true }).catch((): undefined => undefined);
        throw error;
      }
    });
  };

  const getLatestProjectOutput = async (projectId: string): Promise<StudioAsset | null> => {
    if (!SAFE_ID.test(projectId)) throw new CreativeStudioMediaError('invalid_media');
    const [projectDir, project] = await Promise.all([
      deps.store.getVerifiedProjectDirectory(projectId),
      deps.store.getProject(projectId),
    ]);
    if (projectDir === null || project === null) throw new CreativeStudioMediaError('not_found');
    const renderedCuts = (await listProjectOutputAssets(projectDir, projectId)).toSorted(
      (left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id)
    );
    for (const renderedCut of renderedCuts) {
      // eslint-disable-next-line no-await-in-loop
      const resolved = await resolveAsset(projectId, renderedCut.id);
      if (resolved !== null) return resolved.asset;
    }
    return null;
  };

  const prepareProjectOutputWriteV2 = async (
    input: Omit<PersistProjectOutputInputV2, 'body'>
  ): Promise<ManagedWritePlanV2> => {
    if (
      !SAFE_ID.test(input.projectId) ||
      input.declaredMimeType !== 'video/mp4' ||
      !Number.isSafeInteger(input.width) ||
      input.width < 1 ||
      !Number.isSafeInteger(input.height) ||
      input.height < 1 ||
      (input.declaredByteSize !== undefined &&
        (!Number.isSafeInteger(input.declaredByteSize) || input.declaredByteSize < 1)) ||
      (input.durationSeconds !== undefined && (!Number.isFinite(input.durationSeconds) || input.durationSeconds <= 0))
    ) {
      throw new CreativeStudioMediaError('invalid_media');
    }
    const { projectDir, project, authority } = await loadProjectContextV2(input.projectId);
    const outputAssets = await listProjectOutputAssetsV2(projectDir, input.projectId);
    const outputBytes = outputAssets.reduce((total, asset) => total + asset.byteSize, 0);
    return {
      projectDir,
      project,
      authority,
      capacity: await planWriteCapacity(
        project,
        projectDir,
        limits.videoOutputMaxBytes,
        input.declaredByteSize,
        outputBytes
      ),
      collection: 'assets',
    };
  };

  const persistProjectOutputV2 = async (input: PersistProjectOutputInputV2): Promise<StudioAssetV2> => {
    const plan = await prepareProjectOutputWriteV2(input);
    return persistManagedOutputWithPlanV2({ ...input, clipId: null, mediaKind: 'video' }, plan, async (asset) => {
      const partsDirectory = await ensureManagedDirectoryV2(plan.authority, 'parts');
      const assetsDirectory = await ensureManagedDirectoryV2(plan.authority, 'assets');
      const partsDir = partsDirectory.directory;
      const assetsDir = assetsDirectory.directory;
      let metadataPart: string | null = path.join(partsDir, `${asset.id}.render-v2-metadata.part`);
      const metadataPath = path.join(assetsDir, `${asset.id}.render-v2.json`);
      let metadataPartIdentity: FileIdentity | null = null;
      let metadataFinalIdentity: FileIdentity | null = null;
      try {
        await assertV2ManagedMutation(plan.authority, [partsDirectory]);
        const metadataHandle = await fs.open(metadataPart, 'wx');
        try {
          await assertV2ManagedMutation(plan.authority, [partsDirectory]);
          const openedMetadata = await metadataHandle.stat();
          if (!openedMetadata.isFile()) throw new CreativeStudioMediaError('storage_error');
          metadataPartIdentity = fileIdentity(openedMetadata);
          await metadataHandle.writeFile(JSON.stringify(asset), { encoding: 'utf8' });
        } finally {
          await metadataHandle.close().catch((): undefined => undefined);
        }
        await assertV2ManagedMutation(plan.authority, [partsDirectory]);
        const completedMetadata = await regularFile(metadataPart);
        const completedMetadataIdentity = fileIdentity(completedMetadata);
        if (
          metadataPartIdentity === null ||
          completedMetadataIdentity.dev !== metadataPartIdentity.dev ||
          completedMetadataIdentity.ino !== metadataPartIdentity.ino
        ) {
          throw new CreativeStudioMediaError('storage_error');
        }
        metadataFinalIdentity = await finalizeManagedPartV2(
          metadataPart,
          partsDir,
          metadataPath,
          assetsDir,
          metadataPartIdentity,
          () => assertV2ManagedMutation(plan.authority, [partsDirectory, assetsDirectory]),
          (identity) => {
            metadataFinalIdentity = identity;
          }
        );
        metadataPart = null;
        metadataPartIdentity = null;
      } catch (error) {
        await cleanupUncommittedManagedPathsV2(input.projectId, asset.id, [
          { filePath: metadataPart, identity: metadataPartIdentity },
          { filePath: metadataPath, identity: metadataFinalIdentity },
        ]);
        throw error;
      }
    });
  };

  const getLatestProjectOutputV2 = async (projectId: string): Promise<StudioAssetV2 | null> => {
    if (!SAFE_ID.test(projectId)) throw new CreativeStudioMediaError('invalid_media');
    const { projectDir } = await loadProjectContextV2(projectId);
    const renderedCuts = (await listProjectOutputAssetsV2(projectDir, projectId)).toSorted(
      (left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id)
    );
    for (const renderedCut of renderedCuts) {
      // eslint-disable-next-line no-await-in-loop
      const resolved = await resolveAssetV2(projectId, renderedCut.id);
      if (resolved !== null) return resolved.asset;
    }
    return null;
  };

  const commitProviderJobAsset = async (input: ProviderJobOutputMetadata, asset: StudioAsset): Promise<void> => {
    await deps.store.updateProject(input.projectId, (current) => {
      const job = current.jobs[input.jobId];
      const scene = current.scenes[input.sceneId];
      const active =
        job?.status === 'submitting' ||
        job?.status === 'running' ||
        (job?.status === 'failed' && job.error?.code === 'download_failed');
      if (!job || !scene || job.sceneId !== input.sceneId || !active) {
        throw new CreativeStudioMediaError('job_inactive');
      }
      // Must match prepareProviderJobWrite: StudioJob.outputRole is immutable after creation.
      const role = jobOutputRole(job);
      if (role === 'take' && scene.mediaKind !== input.mediaKind) {
        throw new CreativeStudioMediaError('job_inactive');
      }
      if (role === 'reference' && input.mediaKind !== 'image') {
        // Deliberately invalid_media: immutable outputRole and stable input.mediaKind cannot race like scene.mediaKind.
        throw new CreativeStudioMediaError('invalid_media');
      }
      const usedBytes = Object.values(current.assets).reduce((total, candidate) => total + candidate.byteSize, 0);
      if (usedBytes + asset.byteSize > limits.projectMaxBytes) {
        throw new CreativeStudioMediaError('invalid_media');
      }
      if (role === 'reference' && job.referenceInputSnapshot !== undefined) {
        asset.sourceVisualPrompt = job.referenceInputSnapshot.sourceVisualPrompt;
        asset.sourceReferenceAssetIds = [...job.referenceInputSnapshot.conditioningReferenceAssetIds];
        asset.sourceAspectRatio = job.referenceInputSnapshot.aspectRatio;
        asset.sourceResolution = job.referenceInputSnapshot.resolution;
      } else {
        // Legacy reference jobs predate the durable request snapshot. Preserve their historical
        // prompt-only provenance without inventing complete frame authority from current state.
        asset.sourceVisualPrompt = scene.visualPrompt.trim();
      }
      current.assets[asset.id] = asset;
      // Every scene-owned asset must be reverse-linked in assetIds (store.ts:993) —
      // exactly as imported references and posters already are — regardless of role.
      scene.assetIds.push(asset.id);
      if (role === 'reference') {
        scene.referenceAssetId = asset.id;
        // A plate settles the scene out of 'generating' but must never mark it produced.
        // A scene that already has a take stays complete - regenerating its plate does
        // not un-produce it. One with no take returns to its resting state.
        // The ready -> draft demotion is known and accepted while only the busy gate reads reviewState;
        // revisit this before making the distinction user-visible rather than duplicating readiness rules here.
        scene.reviewState = scene.selectedAssetId === null ? 'draft' : 'complete';
      } else {
        scene.selectedAssetId = asset.id;
        scene.reviewState = 'complete';
      }
      job.status = 'succeeded';
      job.outputAssetIds = [asset.id];
      job.error = null;
      delete job.progress;
      job.updatedAt = now();
      // reconcileCut derives clips solely from selectedTake (store.ts:769/:780), which a
      // reference commit never changes, so this is a no-op for the reference path today —
      // but keeping one path means reconciliation starting to read assetIds can't silently
      // let a plate become a clip without this call already being in place.
      return reconcilePersistedStudioCuts(current);
    });
  };

  const persistProviderOutputForJob = async (input: PersistProviderJobOutputInput): Promise<StudioAsset> =>
    persistManagedOutputWithPlan(input, await prepareProviderJobWrite(input), (asset) =>
      commitProviderJobAsset(input, asset)
    );

  const commitProviderJobAssetV2 = async (input: ProviderJobOutputMetadataV2, asset: StudioAssetV2): Promise<void> => {
    await deps.store.updateProjectV2(input.projectId, (current) => {
      const job = ownRecordValue(current.jobs, input.jobId);
      const shot = ownRecordValue(current.clips, input.clipId);
      const beat = owningBeatForShotV2(current, input.clipId);
      const active =
        job?.status === 'submitting' ||
        job?.status === 'running' ||
        (job?.status === 'failed' && job.error?.code === 'download_failed');
      if (
        !job ||
        !shot ||
        !beat ||
        job.projectId !== input.projectId ||
        job.clipId !== input.clipId ||
        !shot.jobIds.includes(job.id) ||
        !active
      ) {
        throw new CreativeStudioMediaError('job_inactive');
      }
      const role = jobOutputRole(job);
      if (role === 'take' && shot.mediaKind !== input.mediaKind) {
        throw new CreativeStudioMediaError('job_inactive');
      }
      if (role === 'reference' && input.mediaKind !== 'image') {
        throw new CreativeStudioMediaError('invalid_media');
      }
      if (
        asset.projectId !== current.id ||
        asset.clipId !== shot.id ||
        asset.mediaKind !== input.mediaKind ||
        asset.managedAsset.collection !== (role === 'reference' ? 'references' : 'assets')
      ) {
        throw new CreativeStudioMediaError('invalid_media');
      }
      const usedBytes = Object.values(current.assets).reduce((total, candidate) => total + candidate.byteSize, 0);
      if (usedBytes + asset.byteSize > limits.projectMaxBytes) {
        throw new CreativeStudioMediaError('invalid_media');
      }
      if (role === 'reference' && job.referenceInputSnapshot !== undefined) {
        asset.sourceVisualPrompt = job.referenceInputSnapshot.sourceVisualPrompt;
        asset.sourceReferenceAssetIds = [...job.referenceInputSnapshot.conditioningReferenceAssetIds];
        asset.sourceAspectRatio = job.referenceInputSnapshot.aspectRatio;
        asset.sourceResolution = job.referenceInputSnapshot.resolution;
      } else {
        asset.sourceVisualPrompt = `${beat.visualPrompt.trim()}\n\n${shot.shotPrompt.trim()}`;
      }
      defineRecordValue(current.assets, asset.id, asset);
      shot.assetIds.push(asset.id);
      if (role === 'reference') shot.referenceAssetId = asset.id;
      else shot.selectedAssetId = asset.id;
      job.status = 'succeeded';
      job.outputAssetIds = [asset.id];
      job.error = null;
      delete job.progress;
      job.updatedAt = now();
      return role === 'take' ? reconcileStudioCutsV2(current, { kind: 'selection', clipId: shot.id }) : current;
    });
  };

  const persistProviderOutputForJobV2 = async (input: PersistProviderJobOutputInputV2): Promise<StudioAssetV2> =>
    persistManagedOutputWithPlanV2(input, await prepareProviderJobWriteV2(input), (asset) =>
      commitProviderJobAssetV2(input, asset)
    );

  const commitProviderJobPoster = async (input: ProviderJobPosterMetadata, posterAsset: StudioAsset): Promise<void> => {
    await deps.store.updateProject(input.projectId, (current) => {
      const { scene, job } = validateProviderPosterLineage(current, input);
      if (posterAsset.mediaKind !== 'image' || posterAsset.managedAsset.collection !== 'thumbnails') {
        throw new CreativeStudioMediaError('invalid_media');
      }
      const usedBytes = Object.values(current.assets).reduce((total, candidate) => total + candidate.byteSize, 0);
      if (usedBytes + posterAsset.byteSize > limits.projectMaxBytes) {
        throw new CreativeStudioMediaError('invalid_media');
      }
      current.assets[posterAsset.id] = posterAsset;
      scene.assetIds.push(posterAsset.id);
      job.outputAssetIds.push(posterAsset.id);
      job.updatedAt = now();
      return current;
    });
  };

  const persistProviderPosterForJob = async (input: PersistProviderJobPosterInput): Promise<StudioAsset> => {
    const plan = await prepareProviderPosterWrite(input);
    return persistManagedOutputWithPlan({ ...input, mediaKind: 'image' }, plan, (asset) =>
      commitProviderJobPoster(input, asset)
    );
  };

  const commitProviderJobPosterV2 = async (
    input: ProviderJobPosterMetadataV2,
    posterAsset: StudioAssetV2
  ): Promise<void> => {
    await deps.store.updateProjectV2(input.projectId, (current) => {
      const { shot, job } = validateProviderPosterLineageV2(current, input);
      if (
        posterAsset.projectId !== current.id ||
        posterAsset.clipId !== shot.id ||
        posterAsset.mediaKind !== 'image' ||
        posterAsset.managedAsset.collection !== 'thumbnails'
      ) {
        throw new CreativeStudioMediaError('invalid_media');
      }
      const usedBytes = Object.values(current.assets).reduce((total, candidate) => total + candidate.byteSize, 0);
      if (usedBytes + posterAsset.byteSize > limits.projectMaxBytes) {
        throw new CreativeStudioMediaError('invalid_media');
      }
      defineRecordValue(current.assets, posterAsset.id, posterAsset);
      shot.assetIds.push(posterAsset.id);
      job.outputAssetIds.push(posterAsset.id);
      job.updatedAt = now();
      return current;
    });
  };

  const persistProviderPosterForJobV2 = async (input: PersistProviderJobPosterInputV2): Promise<StudioAssetV2> => {
    const plan = await prepareProviderPosterWriteV2(input);
    return persistManagedOutputWithPlanV2({ ...input, mediaKind: 'image' }, plan, (asset) =>
      commitProviderJobPosterV2(input, asset)
    );
  };

  const commitCapturedPoster = async (input: CapturedPosterMetadata, posterAsset: StudioAsset): Promise<void> => {
    await deps.store.updateProject(input.projectId, (current) => {
      const { scene, job } = validateCapturedPosterLineage(current, input);
      if (posterAsset.mediaKind !== 'image' || posterAsset.managedAsset.collection !== 'thumbnails') {
        throw new CreativeStudioMediaError('invalid_media');
      }
      const usedBytes = Object.values(current.assets).reduce((total, candidate) => total + candidate.byteSize, 0);
      if (usedBytes + posterAsset.byteSize > limits.projectMaxBytes) {
        throw new CreativeStudioMediaError('invalid_media');
      }
      current.assets[posterAsset.id] = posterAsset;
      scene.assetIds.push(posterAsset.id);
      job.outputAssetIds.push(posterAsset.id);
      job.updatedAt = now();
      return current;
    });
  };

  const persistCapturedPoster = async (input: PersistCapturedPosterInput): Promise<StudioAsset> => {
    const plan = await prepareCapturedPosterWrite(input);
    const normalized = { ...input, mediaKind: 'image' as const, declaredMimeType: 'image/png' as const };
    return persistManagedOutputWithPlan(normalized, plan, (asset) => commitCapturedPoster(input, asset));
  };

  const commitCapturedPosterV2 = async (input: CapturedPosterMetadataV2, posterAsset: StudioAssetV2): Promise<void> => {
    await deps.store.updateProjectV2(input.projectId, (current) => {
      const { shot, job } = validateCapturedPosterLineageV2(current, input);
      if (
        posterAsset.projectId !== current.id ||
        posterAsset.clipId !== shot.id ||
        posterAsset.mediaKind !== 'image' ||
        posterAsset.managedAsset.collection !== 'thumbnails'
      ) {
        throw new CreativeStudioMediaError('invalid_media');
      }
      const usedBytes = Object.values(current.assets).reduce((total, candidate) => total + candidate.byteSize, 0);
      if (usedBytes + posterAsset.byteSize > limits.projectMaxBytes) {
        throw new CreativeStudioMediaError('invalid_media');
      }
      defineRecordValue(current.assets, posterAsset.id, posterAsset);
      shot.assetIds.push(posterAsset.id);
      job.outputAssetIds.push(posterAsset.id);
      job.updatedAt = now();
      return current;
    });
  };

  const persistCapturedPosterV2 = async (input: PersistCapturedPosterInputV2): Promise<StudioAssetV2> => {
    const plan = await prepareCapturedPosterWriteV2(input);
    const normalized = { ...input, mediaKind: 'image' as const, declaredMimeType: 'image/png' as const };
    return persistManagedOutputWithPlanV2(normalized, plan, (asset) => commitCapturedPosterV2(input, asset));
  };

  /** Pipes the single SSRF-safe downloader into the same managed `.part` persistence path without buffering media. */
  const persistProviderOutputFromUrlWithPlan = async <Asset extends StudioAsset | StudioAssetV2>(
    input:
      | PersistProviderOutputUrlInput
      | PersistProviderJobOutputUrlInput
      | PersistProviderJobOutputUrlInputV2
      | (PersistProviderJobPosterUrlInput & { mediaKind: 'image' })
      | (PersistProviderJobPosterUrlInputV2 & { mediaKind: 'image' }),
    plan: { capacity: WriteCapacity },
    persistBody: (body: AsyncIterable<Uint8Array>) => Promise<Asset>
  ): Promise<Asset> => {
    const stream = new PassThrough();
    stream.on('error', (): undefined => undefined);
    const controller = new AbortController();
    const abortFromCaller = (): void => controller.abort();
    input.downloader.signal?.addEventListener('abort', abortFromCaller, { once: true });
    if (input.downloader.signal?.aborted) controller.abort();
    const persist = persistBody(stream);
    const download = (async () => {
      const result = await downloadRemoteMedia(input.url, {
        ...input.downloader,
        signal: controller.signal,
        maxBytes: plan.capacity.maxBytes,
        write: async (chunk) => {
          if (stream.destroyed) throw new CreativeStudioMediaError('storage_error');
          if (stream.write(chunk)) return;
          await new Promise<void>((resolve, reject) => {
            const cleanup = (): void => {
              stream.off('drain', onDrain);
              stream.off('error', onError);
              stream.off('close', onClose);
            };
            const onDrain = (): void => {
              cleanup();
              resolve();
            };
            const onError = (error: Error): void => {
              cleanup();
              reject(error);
            };
            const onClose = (): void => {
              cleanup();
              reject(new CreativeStudioMediaError('storage_error'));
            };
            stream.once('drain', onDrain);
            stream.once('error', onError);
            stream.once('close', onClose);
            if (stream.destroyed) onClose();
          });
        },
      });
      if (result.contentType === null || result.contentType !== input.declaredMimeType) {
        throw new CreativeStudioMediaError('invalid_media');
      }
      stream.end();
      return result;
    })();
    void persist.catch((): undefined => undefined);
    void download.catch((): undefined => undefined);
    try {
      const [asset] = await Promise.all([persist, download]);
      return asset;
    } catch (error) {
      controller.abort();
      stream.destroy(error instanceof Error ? error : new Error('remote_media_failed'));
      await Promise.allSettled([persist, download]);
      throw error;
    } finally {
      input.downloader.signal?.removeEventListener('abort', abortFromCaller);
    }
  };

  const persistProviderOutputFromUrl = async (input: PersistProviderOutputUrlInput): Promise<StudioAsset> => {
    const plan = await prepareProviderWrite(input);
    return persistProviderOutputFromUrlWithPlan(input, plan, (body) =>
      persistManagedOutputWithPlan({ ...input, body }, plan, (asset) => commitProviderAsset(input, asset))
    );
  };

  const persistProviderOutputFromUrlForJob = async (input: PersistProviderJobOutputUrlInput): Promise<StudioAsset> => {
    const plan = await prepareProviderJobWrite(input);
    return persistProviderOutputFromUrlWithPlan(input, plan, (body) =>
      persistManagedOutputWithPlan({ ...input, body }, plan, (asset) => commitProviderJobAsset(input, asset))
    );
  };

  const persistProviderOutputFromUrlForJobV2 = async (
    input: PersistProviderJobOutputUrlInputV2
  ): Promise<StudioAssetV2> => {
    const plan = await prepareProviderJobWriteV2(input);
    return persistProviderOutputFromUrlWithPlan(input, plan, (body) =>
      persistManagedOutputWithPlanV2({ ...input, body }, plan, (asset) => commitProviderJobAssetV2(input, asset))
    );
  };

  const persistProviderPosterFromUrlForJob = async (input: PersistProviderJobPosterUrlInput): Promise<StudioAsset> => {
    const plan = await prepareProviderPosterWrite(input);
    const normalized = { ...input, mediaKind: 'image' as const };
    return persistProviderOutputFromUrlWithPlan(normalized, plan, (body) =>
      persistManagedOutputWithPlan({ ...normalized, body }, plan, (asset) => commitProviderJobPoster(input, asset))
    );
  };

  const persistProviderPosterFromUrlForJobV2 = async (
    input: PersistProviderJobPosterUrlInputV2
  ): Promise<StudioAssetV2> => {
    const plan = await prepareProviderPosterWriteV2(input);
    const normalized = { ...input, mediaKind: 'image' as const };
    return persistProviderOutputFromUrlWithPlan(normalized, plan, (body) =>
      persistManagedOutputWithPlanV2({ ...normalized, body }, plan, (asset) => commitProviderJobPosterV2(input, asset))
    );
  };

  const exportAssetsToDirectory = async (
    input: InternalExportStudioAssetsInput
  ): Promise<InternalStudioExportResult> => {
    if (!SAFE_ID.test(input.projectId) || typeof input.destinationDirectory !== 'string') {
      throw new CreativeStudioMediaError('invalid_media');
    }
    const project = await deps.store.getProject(input.projectId);
    if (!project) throw new CreativeStudioMediaError('not_found');
    const timestamp = input.timestamp ?? new Date().toISOString().replace(/[-:]/g, '').slice(0, 15).replace('T', '-');
    const { directory, folderName, identity } = await acquireStudioExportDirectory(
      input.destinationDirectory,
      project.name,
      timestamp
    );
    const verifiedExportDirectory: VerifiedDirectory = { directory, identity };
    const exported: Array<{ assetId: string; fileName: string }> = [];
    const missingSceneIds: string[] = [];
    for (const [index, sceneId] of project.sceneOrder.entries()) {
      const selected = project.scenes[sceneId].selectedAssetId;
      const resolved = selected ? await resolveAsset(input.projectId, selected) : null;
      if (!resolved) {
        missingSceneIds.push(sceneId);
        continue;
      }
      const extension = path.extname(resolved.asset.managedAsset.fileName).toLowerCase();
      const fileName = buildStudioSceneExportFileName(index + 1, project.scenes[sceneId].title, extension);
      await writeVerifiedExportFile(path.join(directory, fileName), verifiedExportDirectory, [], async (handle) => {
        await pipeline(
          await resolved.openVerifiedStream(),
          createWriteStream(path.join(directory, fileName), { fd: handle.fd, autoClose: false })
        );
      });
      exported.push({ assetId: resolved.asset.id, fileName });
    }
    const renderedCut = await getLatestProjectOutput(input.projectId);
    if (renderedCut !== null) {
      // Resolve through the sidecar-aware verifier before any rendered bytes leave managed storage.
      const resolved = await resolveAsset(input.projectId, renderedCut.id);
      if (resolved !== null) {
        await writeVerifiedExportFile(path.join(directory, 'cut.mp4'), verifiedExportDirectory, [], async (handle) => {
          await pipeline(
            await resolved.openVerifiedStream(),
            createWriteStream(path.join(directory, 'cut.mp4'), { fd: handle.fd, autoClose: false })
          );
        });
        exported.push({ assetId: resolved.asset.id, fileName: 'cut.mp4' });
      }
    }
    if (input.includeReferences) {
      const verifiedReferenceDirectory = await createVerifiedExportSubdirectory(verifiedExportDirectory, 'references');
      for (const referenceAsset of Object.values(project.assets).filter(
        (candidate) => candidate.managedAsset.collection === 'imports'
      )) {
        const resolved = await resolveAsset(input.projectId, referenceAsset.id);
        if (!resolved) continue;
        const fileName = resolved.asset.managedAsset.fileName;
        await writeVerifiedExportFile(
          path.join(verifiedReferenceDirectory.directory, fileName),
          verifiedReferenceDirectory,
          [verifiedExportDirectory],
          async (handle) => {
            await pipeline(
              await resolved.openVerifiedStream(),
              createWriteStream(path.join(verifiedReferenceDirectory.directory, fileName), {
                fd: handle.fd,
                autoClose: false,
              })
            );
          }
        );
        exported.push({ assetId: referenceAsset.id, fileName: `references/${fileName}` });
      }
    }
    const storyboard = {
      schemaVersion: 1,
      id: project.id,
      name: project.name,
      brief: project.brief,
      aspectRatio: project.aspectRatio,
      targetDurationSeconds: project.targetDurationSeconds,
      resolution: project.resolution,
      sceneOrder: project.sceneOrder,
      scenes: project.sceneOrder.map((sceneId) => {
        const scene = project.scenes[sceneId];
        return {
          id: scene.id,
          title: scene.title,
          purpose: scene.purpose,
          visualPrompt: scene.visualPrompt,
          narration: scene.narration,
          onScreenText: scene.onScreenText,
          mediaKind: scene.mediaKind,
          durationSeconds: scene.durationSeconds,
          selectedAssetId: scene.selectedAssetId,
        };
      }),
    };
    await writeVerifiedExportFile(
      path.join(directory, 'storyboard.json'),
      verifiedExportDirectory,
      [],
      async (handle) => {
        await handle.writeFile(JSON.stringify(storyboard, null, 2), { encoding: 'utf8' });
      }
    );
    return { folderName, exported, missingSceneIds };
  };

  return {
    importReferenceFromPath,
    importReferenceFromPathV2,
    detachBriefReference,
    detachBriefReferenceV2,
    persistProviderOutput,
    persistProviderOutputFromUrl,
    persistProviderOutputForJob,
    persistProviderOutputForJobV2,
    persistProviderOutputFromUrlForJob,
    persistProviderOutputFromUrlForJobV2,
    persistProviderPosterForJob,
    persistProviderPosterForJobV2,
    persistProviderPosterFromUrlForJob,
    persistProviderPosterFromUrlForJobV2,
    persistCapturedPoster,
    persistCapturedPosterV2,
    persistProjectOutput,
    persistProjectOutputV2,
    getLatestProjectOutput,
    getLatestProjectOutputV2,
    resolveAsset,
    resolveAssetV2,
    resolveProviderInput,
    resolveProviderInputV2,
    exportAssetsToDirectory,
    cleanupOrphanParts,
    cleanupOrphanPartsV2,
  };
};
