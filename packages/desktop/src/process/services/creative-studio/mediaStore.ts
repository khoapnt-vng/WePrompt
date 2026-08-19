/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { constants as fsConstants, createReadStream, createWriteStream, promises as fs } from 'node:fs';
import path from 'node:path';
import { PassThrough, Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type {
  StudioAssetV2,
  StudioBriefReferenceRole,
  StudioDetachBriefReferenceRequest,
  StudioFrameExtraction,
  StudioProjectV2,
} from '@/common/types/project/creativeStudioTypes';
import {
  extractConditioningFrame,
  StudioConditioningFrameError,
  type StudioConditioningFrameExtractionInput,
  type StudioConditioningFrameExtractionResult,
} from './adapters/conditioningFrame';
import {
  allocateStudioBriefReferenceLabel,
  STUDIO_MANAGED_ASSET_COLLECTIONS_V2,
  STUDIO_MAX_ACTIVE_BRIEF_REFERENCES,
  isStudioBriefReferenceLabel,
  isStudioReferenceImageMimeType,
} from '@/common/types/project/creativeStudioManagedAssetCollections';
import { validateStudioProjectV2, type StudioVerifiedConditioningFrameV2 } from './service/schema2';
import { CreativeStudioStoreError, STUDIO_PROJECT_V2_MAX_RECORD_BYTES, type CreativeStudioStore } from './store';
import { downloadRemoteMedia, type RemoteMediaDownloadDeps } from '../remote-media/remoteMediaDownloader';

const SAFE_ID = /^[A-Za-z0-9_-]{1,256}$/;
const ownRecordValue = <Value>(record: Readonly<Record<string, Value>>, key: string): Value | undefined =>
  Object.hasOwn(record, key) ? record[key] : undefined;

const owningBeatForShotV2 = (project: StudioProjectV2, shotId: string): StudioProjectV2['beats'][string] | null => {
  for (const beatId of project.beatOrder) {
    const beat = ownRecordValue(project.beats, beatId);
    if (beat?.shotOrder.includes(shotId)) return beat;
  }
  return null;
};

const defineRecordValue = <Value>(record: Record<string, Value>, key: string, value: Value): void => {
  Object.defineProperty(record, key, { value, writable: true, enumerable: true, configurable: true });
};

const resolveActiveStudioBriefReferencesV2 = (
  assets: Readonly<Record<string, StudioAssetV2>>
): StudioAssetV2[] | null => {
  const active: StudioAssetV2[] = [];
  for (const asset of Object.values(assets)) {
    const hasRole = asset.briefReferenceRole !== undefined;
    const hasLabel = asset.briefReferenceLabel !== undefined;
    if (hasRole !== hasLabel) return null;
    if (!hasRole) continue;
    if (
      (asset.briefReferenceRole !== 'cast' && asset.briefReferenceRole !== 'look') ||
      !isStudioBriefReferenceLabel(asset.briefReferenceLabel) ||
      asset.shotId !== null ||
      asset.mediaKind !== 'image' ||
      !isStudioReferenceImageMimeType(asset.mimeType) ||
      asset.managedAsset.collection !== 'imports'
    ) {
      return null;
    }
    active.push(asset);
  }
  if (active.length > STUDIO_MAX_ACTIVE_BRIEF_REFERENCES) return null;
  return active.toSorted((left, right) => {
    const byRole = Number(left.briefReferenceRole === 'look') - Number(right.briefReferenceRole === 'look');
    return (
      byRole ||
      (left.createdAt < right.createdAt ? -1 : left.createdAt > right.createdAt ? 1 : 0) ||
      (left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
    );
  });
};

type VerifiedIdentity = {
  dev: string;
  ino: string;
  size: number;
  mtimeMs: number;
  ctimeMs: number;
  sha256: string;
};
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
  readonly code: 'invalid_media' | 'storage_error' | 'stale_project' | 'not_found' | 'job_inactive' | 'media_in_use';

  constructor(code: CreativeStudioMediaError['code']) {
    super(code);
    this.name = 'CreativeStudioMediaError';
    this.code = code;
  }
}

const nonterminalJobNeedsBriefReferenceV2 = (project: StudioProjectV2, assetId: string): boolean =>
  Object.values(project.jobs).some((job) => {
    if (job.status === 'succeeded' || job.status === 'failed' || job.status === 'cancelled') return false;
    const referenceInput =
      job.requestPlan.kind === 'resolved'
        ? job.requestPlan.snapshot.referenceInput
        : job.requestPlan.template.referenceInput;
    return referenceInput?.assetId === assetId;
  });

export type InternalImportReferenceInputV2 = {
  projectId: string;
  sourcePath: string;
  shotId?: string;
  briefReferenceRole?: StudioBriefReferenceRole;
  expectedRevision: number;
  returnProject?: boolean;
};

export type StudioMediaImportResultV2 = { asset: StudioAssetV2; project: StudioProjectV2 };

export type PersistProviderJobOutputInputV2 = {
  projectId: string;
  shotId: string;
  jobId: string;
  mediaKind: 'image' | 'video';
  declaredMimeType: string;
  declaredByteSize?: number;
  width?: number;
  height?: number;
  durationSeconds?: number;
  body: AsyncIterable<Uint8Array>;
};

export type PersistProviderJobOutputUrlInputV2 = Omit<PersistProviderJobOutputInputV2, 'body'> & {
  url: string;
  downloader: Omit<RemoteMediaDownloadDeps, 'write' | 'maxBytes'>;
};

export type PersistProviderJobPosterInputV2 = {
  projectId: string;
  shotId: string;
  jobId: string;
  primaryAssetId: string;
  declaredMimeType: string;
  declaredByteSize?: number;
  width?: number;
  height?: number;
  body: AsyncIterable<Uint8Array>;
};

export type PersistProviderJobPosterUrlInputV2 = Omit<PersistProviderJobPosterInputV2, 'body'> & {
  url: string;
  downloader: Omit<RemoteMediaDownloadDeps, 'write' | 'maxBytes'>;
};

export type PersistCapturedPosterInputV2 = {
  projectId: string;
  shotId: string;
  videoAssetId: string;
  width: number;
  height: number;
  declaredByteSize?: number;
  body: AsyncIterable<Uint8Array>;
};

/** A derived project output whose lifecycle is independent from editable Beats and Shots. */
export type PersistProjectOutputInputV2 = {
  projectId: string;
  declaredMimeType: 'video/mp4';
  declaredByteSize?: number;
  width: number;
  height: number;
  durationSeconds?: number;
  body: AsyncIterable<Uint8Array>;
};

export type StudioConditioningFrameRequestV2 = {
  projectId: string;
  extractionId: string;
};

export type StudioMediaStore = {
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
  extractConditioningFrameV2(input: StudioConditioningFrameRequestV2): Promise<StudioFrameExtraction>;
  verifyConditioningFrameV2(input: StudioConditioningFrameRequestV2): Promise<StudioVerifiedConditioningFrameV2 | null>;
  resumeConditioningFramesV2(supportedProjectIds: readonly string[]): Promise<void>;
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
  /** V2 video duration is decoded from the finalized managed bytes, never trusted from provider metadata. */
  probeVideoDurationSecondsV2?: (input: { filePath: string; byteSize: number; sha256: string }) => Promise<number>;
  ffprobeBinary?: string;
  conditioningFrameExtractor?: (
    input: StudioConditioningFrameExtractionInput
  ) => Promise<StudioConditioningFrameExtractionResult>;
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
  ctimeMs: number;
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
      before.mtimeMs !== expected.mtimeMs ||
      before.ctimeMs !== expected.ctimeMs)
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
          opened.mtimeMs !== expected.mtimeMs ||
          opened.ctimeMs !== expected.ctimeMs))
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
        afterVerification.mtimeMs !== expected.mtimeMs ||
        afterVerification.ctimeMs !== expected.ctimeMs ||
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

const sniff = (bytes: Buffer): (typeof MIME_SIGNATURES)[number] | null =>
  MIME_SIGNATURES.find((signature) => signature.match(bytes)) ?? null;

const digestOpenedFile = async (handle: Awaited<ReturnType<typeof fs.open>>): Promise<string> => {
  const hash = createHash('sha256');
  const buffer = Buffer.allocUnsafe(64 * 1024);
  for (let position = 0; ; ) {
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
    if (bytesRead === 0) return hash.digest('hex');
    hash.update(buffer.subarray(0, bytesRead));
    position += bytesRead;
  }
};

const resolveFfprobeBinaryV2 = (configured: string | undefined): string => {
  const explicit = configured?.trim() || process.env.FFPROBE_PATH?.trim();
  if (explicit) return explicit;
  const ffmpegBinary = process.env.FFMPEG_PATH?.trim();
  if (!ffmpegBinary || !ffmpegBinary.includes(path.sep)) return 'ffprobe';
  const extension = path.extname(ffmpegBinary).toLowerCase() === '.exe' ? '.exe' : '';
  return path.join(path.dirname(ffmpegBinary), `ffprobe${extension}`);
};

const runFfprobeDurationV2 = async (binary: string, handle: Awaited<ReturnType<typeof fs.open>>): Promise<number> =>
  new Promise<number>((resolve, reject) => {
    const child = spawn(
      binary,
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', 'pipe:3'],
      { stdio: ['ignore', 'pipe', 'ignore', handle.fd], windowsHide: true }
    );
    let stdout = '';
    let settled = false;
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(new CreativeStudioMediaError('invalid_media'));
    }, 60_000);
    timer.unref?.();
    const finish = (error?: Error, durationSeconds?: number): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(durationSeconds!);
    };
    child.stdout.on('data', (chunk: Buffer) => {
      if (stdout.length > 4_096) {
        child.kill('SIGKILL');
        finish(new CreativeStudioMediaError('invalid_media'));
        return;
      }
      stdout += chunk.toString('utf8');
    });
    child.once('error', () => finish(new CreativeStudioMediaError('invalid_media')));
    child.once('close', (code, signal) => {
      if (code !== 0 || signal !== null) {
        finish(new CreativeStudioMediaError('invalid_media'));
        return;
      }
      const durationSeconds = Number(stdout.trim());
      if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > Number.MAX_SAFE_INTEGER) {
        finish(new CreativeStudioMediaError('invalid_media'));
        return;
      }
      finish(undefined, durationSeconds);
    });
  });

const defaultProbeVideoDurationSecondsV2 = async (input: {
  filePath: string;
  byteSize: number;
  sha256: string;
  ffprobeBinary: string;
}): Promise<number> => {
  const noFollow = process.platform === 'win32' ? 0 : fsConstants.O_NOFOLLOW;
  let handle: Awaited<ReturnType<typeof fs.open>>;
  try {
    handle = await fs.open(input.filePath, fsConstants.O_RDONLY | noFollow);
  } catch {
    throw new CreativeStudioMediaError('invalid_media');
  }
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size !== input.byteSize || (await digestOpenedFile(handle)) !== input.sha256) {
      throw new CreativeStudioMediaError('invalid_media');
    }
    const durationSeconds = await runFfprobeDurationV2(input.ffprobeBinary, handle);
    const after = await handle.stat();
    if (
      !after.isFile() ||
      after.dev !== before.dev ||
      after.ino !== before.ino ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs ||
      after.ctimeMs !== before.ctimeMs ||
      (await digestOpenedFile(handle)) !== input.sha256
    ) {
      throw new CreativeStudioMediaError('invalid_media');
    }
    return durationSeconds;
  } finally {
    await handle.close().catch((): undefined => undefined);
  }
};

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
  const probeVideoDurationSecondsV2 =
    deps.probeVideoDurationSecondsV2 ??
    ((input: { filePath: string; byteSize: number; sha256: string }) =>
      defaultProbeVideoDurationSecondsV2({
        ...input,
        ffprobeBinary: resolveFfprobeBinaryV2(deps.ffprobeBinary),
      }));
  const conditioningFrameExtractor = deps.conditioningFrameExtractor ?? extractConditioningFrame;
  const conditioningFrameFlights = new Map<string, Promise<StudioFrameExtraction>>();
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
      (!SAFE_ID.test(input.shotId ?? '') && input.shotId !== undefined) ||
      (input.briefReferenceRole !== undefined &&
        input.briefReferenceRole !== 'cast' &&
        input.briefReferenceRole !== 'look') ||
      (input.shotId === undefined) === (input.briefReferenceRole === undefined) ||
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
      if (input.shotId !== undefined) {
        if (!Object.hasOwn(project.shots, input.shotId)) throw new CreativeStudioMediaError('not_found');
        if (owningBeatForShotV2(project, input.shotId) === null) {
          throw new CreativeStudioMediaError('invalid_media');
        }
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
        shotId: input.shotId ?? null,
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
          if (input.shotId !== undefined && owningBeatForShotV2(current, input.shotId) === null) {
            throw new CreativeStudioMediaError('invalid_media');
          }
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
          if (asset.shotId !== null) {
            const shot = ownRecordValue(next.shots, asset.shotId);
            if (shot === undefined) throw new CreativeStudioMediaError('not_found');
            shot.assetIds.push(asset.id);
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
        currentAsset.shotId !== null ||
        currentAsset.mediaKind !== 'image' ||
        currentAsset.managedAsset.collection !== 'imports' ||
        (currentAsset.briefReferenceRole !== 'cast' && currentAsset.briefReferenceRole !== 'look') ||
        currentAsset.briefReferenceLabel === undefined
      ) {
        throw new CreativeStudioMediaError(currentAsset === undefined ? 'not_found' : 'invalid_media');
      }
      if (nonterminalJobNeedsBriefReferenceV2(project, input.assetId)) {
        throw new CreativeStudioMediaError('media_in_use');
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
            asset.shotId !== null ||
            asset.mediaKind !== 'image' ||
            asset.managedAsset.collection !== 'imports' ||
            (asset.briefReferenceRole !== 'cast' && asset.briefReferenceRole !== 'look') ||
            asset.briefReferenceLabel === undefined
          ) {
            throw new CreativeStudioMediaError('invalid_media');
          }
          if (nonterminalJobNeedsBriefReferenceV2(current, input.assetId)) {
            throw new CreativeStudioMediaError('media_in_use');
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
        'shotId',
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
        candidate.shotId !== null ||
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
      if (!STUDIO_MANAGED_ASSET_COLLECTIONS_V2.has(asset.managedAsset.collection)) return null;
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
      if (
        cached?.dev === pathIdentity.dev &&
        cached.ino === pathIdentity.ino &&
        cached.size === stats.size &&
        cached.mtimeMs === stats.mtimeMs &&
        cached.ctimeMs === stats.ctimeMs
      ) {
        sha256 = cached.sha256;
        const sampleHandle = await fs.open(filePath, 'r');
        try {
          const opened = await sampleHandle.stat();
          const openedIdentity = fileIdentity(opened);
          if (
            openedIdentity.dev !== pathIdentity.dev ||
            openedIdentity.ino !== pathIdentity.ino ||
            opened.size !== stats.size ||
            opened.mtimeMs !== stats.mtimeMs ||
            opened.ctimeMs !== stats.ctimeMs
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
        after.mtimeMs !== stats.mtimeMs ||
        after.ctimeMs !== stats.ctimeMs
      ) {
        return null;
      }
      if (shouldCache) {
        cacheVerifiedIdentity(filePath, {
          ...pathIdentity,
          size: stats.size,
          mtimeMs: stats.mtimeMs,
          ctimeMs: stats.ctimeMs,
          sha256,
        });
      }
      const expectation: VerifiedReadExpectation = {
        ...pathIdentity,
        byteSize: asset.byteSize,
        mtimeMs: stats.mtimeMs,
        ctimeMs: stats.ctimeMs,
        sha256: asset.sha256,
        mimeType: asset.mimeType,
        verifyContent: false,
      };
      return {
        asset,
        openVerifiedStream: async (start, end) => {
          const current = await fs.stat(filePath);
          const currentIdentity = fileIdentity(current);
          const currentCached = verifiedFiles.get(filePath);
          if (
            currentCached?.dev !== currentIdentity.dev ||
            currentCached.ino !== currentIdentity.ino ||
            currentCached.size !== current.size ||
            currentCached.mtimeMs !== current.mtimeMs ||
            currentCached.ctimeMs !== current.ctimeMs ||
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

  const conditioningFramePathV2 = (projectDir: string, asset: StudioAssetV2): string => {
    if (
      !STUDIO_MANAGED_ASSET_COLLECTIONS_V2.has(asset.managedAsset.collection) ||
      !/^[A-Za-z0-9_-]+\.(?:jpg|png|webp|mp4|webm)$/.test(asset.managedAsset.fileName)
    ) {
      throw new CreativeStudioMediaError('storage_error');
    }
    const collectionDirectory = path.join(projectDir, asset.managedAsset.collection);
    const filePath = path.join(collectionDirectory, asset.managedAsset.fileName);
    if (path.dirname(collectionDirectory) !== projectDir || path.dirname(filePath) !== collectionDirectory) {
      throw new CreativeStudioMediaError('storage_error');
    }
    return filePath;
  };

  const markConditioningFrameFailedV2 = async (
    projectId: string,
    extractionId: string,
    errorCode: Exclude<StudioFrameExtraction['errorCode'], null>
  ): Promise<void> => {
    await deps.store
      .updateProjectV2(projectId, (project) => {
        const extraction = ownRecordValue(project.frameExtractions, extractionId);
        if (extraction?.status !== 'extracting' || extraction.frameAssetId !== null) return project;
        extraction.status = 'failed';
        extraction.errorCode = errorCode;
        return project;
      })
      .catch((): undefined => undefined);
  };

  const extractConditioningFrameOnceV2 = async (
    input: StudioConditioningFrameRequestV2
  ): Promise<StudioFrameExtraction> => {
    const loaded = await deps.store.getProjectV2(input.projectId);
    if (loaded.status !== 'supported') throw new CreativeStudioMediaError('not_found');
    const initial = ownRecordValue(loaded.project.frameExtractions, input.extractionId);
    if (initial === undefined) throw new CreativeStudioMediaError('not_found');
    if (initial.status === 'failed') throw new CreativeStudioMediaError('job_inactive');

    let repairingReadyAsset: StudioAssetV2 | null = null;
    if (initial.status === 'ready') {
      const frameAsset =
        initial.frameAssetId === null ? undefined : ownRecordValue(loaded.project.assets, initial.frameAssetId);
      if (
        frameAsset === undefined ||
        frameAsset.shotId !== initial.shotId ||
        frameAsset.mediaKind !== 'image' ||
        frameAsset.managedAsset.collection !== 'conditioningFrames'
      ) {
        throw new CreativeStudioMediaError('storage_error');
      }
      if ((await resolveAssetV2(input.projectId, frameAsset.id)) !== null) return structuredClone(initial);
      repairingReadyAsset = frameAsset;
    } else if (initial.status === 'pending') {
      await deps.store.updateProjectV2(input.projectId, (project) => {
        const extraction = ownRecordValue(project.frameExtractions, input.extractionId);
        if (extraction?.status !== 'pending' || extraction.frameAssetId !== null) {
          throw new CreativeStudioMediaError('job_inactive');
        }
        extraction.status = 'extracting';
        extraction.errorCode = null;
        return project;
      });
    }

    let partPath: string | null = null;
    let partIdentity: FileIdentity | null = null;
    let finalPath: string | null = null;
    let finalIdentity: FileIdentity | null = null;
    let frameAssetId: string | null = repairingReadyAsset?.id ?? null;
    try {
      const { projectDir, project, authority } = await loadProjectContextV2(input.projectId);
      const extraction = ownRecordValue(project.frameExtractions, input.extractionId);
      if (
        extraction === undefined ||
        (repairingReadyAsset === null
          ? extraction.status !== 'extracting' || extraction.frameAssetId !== null
          : extraction.status !== 'ready' || extraction.frameAssetId !== repairingReadyAsset.id)
      ) {
        throw new CreativeStudioMediaError('job_inactive');
      }
      const take = ownRecordValue(project.assets, extraction.takeAssetId);
      const shot = ownRecordValue(project.shots, extraction.shotId);
      if (
        take === undefined ||
        shot === undefined ||
        take.projectId !== project.id ||
        take.shotId !== shot.id ||
        take.mediaKind !== 'video' ||
        take.managedAsset.collection !== 'assets' ||
        take.durationSeconds === undefined ||
        extraction.endpointSeconds > take.durationSeconds ||
        !shot.assetIds.includes(take.id)
      ) {
        throw new StudioConditioningFrameError('source_missing');
      }
      const producers = Object.values(project.jobs).filter(
        (job) =>
          job.status === 'succeeded' &&
          job.purpose === 'video_take' &&
          job.shotId === shot.id &&
          job.outputAssetIdsByRole.primary === take.id
      );
      if (producers.length !== 1) throw new StudioConditioningFrameError('source_missing');
      const producer = producers[0]!;
      const posterId = producer.outputAssetIdsByRole.poster;
      const poster = posterId === null ? undefined : ownRecordValue(project.assets, posterId);
      const allowProviderLastFrame =
        producer.provider.adapterId === 'byteplus-seedance-v1' &&
        extraction.endpointSeconds === take.durationSeconds &&
        poster !== undefined &&
        poster.projectId === project.id &&
        poster.shotId === shot.id &&
        poster.mediaKind === 'image' &&
        poster.managedAsset.collection === 'thumbnails';
      const partsDirectory = await ensureManagedDirectoryV2(authority, 'parts');
      const framesDirectory = await ensureManagedDirectoryV2(authority, 'conditioningFrames');
      frameAssetId ??= createId();
      if (!SAFE_ID.test(frameAssetId)) throw new CreativeStudioMediaError('storage_error');
      partPath = path.join(partsDirectory.directory, `${frameAssetId}.part`);
      await assertV2ManagedMutation(authority, [partsDirectory, framesDirectory]);
      await conditioningFrameExtractor({
        sourcePath: conditioningFramePathV2(projectDir, take),
        sourceExpectation: { byteSize: take.byteSize, sha256: take.sha256 },
        destinationPath: partPath,
        endpointSeconds: extraction.endpointSeconds,
        sourceDurationSeconds: take.durationSeconds,
        providerLastFramePath: allowProviderLastFrame ? conditioningFramePathV2(projectDir, poster!) : null,
        providerLastFrameExpectation: allowProviderLastFrame
          ? { byteSize: poster!.byteSize, sha256: poster!.sha256 }
          : null,
        allowProviderLastFrame,
      });
      await assertV2ManagedMutation(authority, [partsDirectory, framesDirectory]);
      const completedPart = await regularFile(partPath);
      partIdentity = fileIdentity(completedPart);
      const completedByteSize = Number(completedPart.size);
      if (!Number.isSafeInteger(completedByteSize) || completedByteSize < 1) {
        throw new StudioConditioningFrameError('decode_failed');
      }
      const existingBytes = repairingReadyAsset?.byteSize ?? 0;
      const usedBytes =
        Object.values(project.assets).reduce((total, asset) => total + asset.byteSize, 0) - existingBytes;
      if (completedByteSize > limits.imageOutputMaxBytes || usedBytes + completedByteSize > limits.projectMaxBytes) {
        throw new CreativeStudioMediaError('invalid_media');
      }
      if (completedByteSize > (await getAvailableDiskBytes(projectDir))) {
        throw new CreativeStudioMediaError('storage_error');
      }
      const hash = createHash('sha256');
      let sample = Buffer.alloc(0);
      for await (const chunk of await openVerifiedReadStream(partPath)) {
        const bytes = Buffer.from(chunk);
        hash.update(bytes);
        if (sample.length < 32) sample = Buffer.concat([sample, bytes]).subarray(0, 32);
      }
      const signature = sniff(sample);
      if (signature === null || !signature.mimeType.startsWith('image/')) {
        throw new StudioConditioningFrameError('decode_failed');
      }
      finalPath = path.join(framesDirectory.directory, `${frameAssetId}.${signature.extension}`);
      finalIdentity = await finalizeManagedPartV2(
        partPath,
        partsDirectory.directory,
        finalPath,
        framesDirectory.directory,
        partIdentity,
        () => assertV2ManagedMutation(authority, [partsDirectory, framesDirectory]),
        (identity) => {
          finalIdentity = identity;
        }
      );
      partPath = null;
      partIdentity = null;
      const frameAsset: StudioAssetV2 = {
        id: frameAssetId,
        projectId: project.id,
        shotId: shot.id,
        mediaKind: 'image',
        mimeType: signature.mimeType,
        managedAsset: { collection: 'conditioningFrames', fileName: `${frameAssetId}.${signature.extension}` },
        byteSize: completedByteSize,
        sha256: hash.digest('hex'),
        createdAt: repairingReadyAsset?.createdAt ?? now(),
      };
      const committed = await deps.store.updateProjectV2(project.id, (current) => {
        const currentExtraction = ownRecordValue(current.frameExtractions, extraction.id);
        const currentShot = ownRecordValue(current.shots, shot.id);
        const currentTake = ownRecordValue(current.assets, take.id);
        if (
          currentExtraction === undefined ||
          currentShot === undefined ||
          currentTake === undefined ||
          currentExtraction.takeAssetId !== take.id ||
          currentExtraction.endpointSeconds !== extraction.endpointSeconds ||
          (repairingReadyAsset === null
            ? currentExtraction.status !== 'extracting' || currentExtraction.frameAssetId !== null
            : currentExtraction.status !== 'ready' || currentExtraction.frameAssetId !== frameAssetId)
        ) {
          throw new CreativeStudioMediaError('job_inactive');
        }
        defineRecordValue(current.assets, frameAsset.id, frameAsset);
        if (!currentShot.assetIds.includes(frameAsset.id)) currentShot.assetIds.push(frameAsset.id);
        currentExtraction.frameAssetId = frameAsset.id;
        currentExtraction.status = 'ready';
        currentExtraction.errorCode = null;
        return current;
      });
      finalPath = null;
      finalIdentity = null;
      return structuredClone(committed.frameExtractions[input.extractionId]!);
    } catch (error) {
      await cleanupUncommittedManagedPathsV2(input.projectId, frameAssetId ?? input.extractionId, [
        { filePath: partPath, identity: partIdentity },
        { filePath: finalPath, identity: finalIdentity },
      ]);
      if (repairingReadyAsset === null) {
        await markConditioningFrameFailedV2(
          input.projectId,
          input.extractionId,
          error instanceof StudioConditioningFrameError ? error.code : 'storage_error'
        );
      }
      if (error instanceof CreativeStudioMediaError || error instanceof StudioConditioningFrameError) throw error;
      throw new CreativeStudioMediaError('storage_error');
    }
  };

  const extractConditioningFrameV2 = (input: StudioConditioningFrameRequestV2): Promise<StudioFrameExtraction> => {
    if (!SAFE_ID.test(input.projectId) || !SAFE_ID.test(input.extractionId)) {
      return Promise.reject(new CreativeStudioMediaError('invalid_media'));
    }
    const key = `${input.projectId}\u0000${input.extractionId}`;
    const existing = conditioningFrameFlights.get(key);
    if (existing !== undefined) return existing;
    const request = structuredClone(input);
    const flight = extractConditioningFrameOnceV2(request).finally(() => {
      if (conditioningFrameFlights.get(key) === flight) conditioningFrameFlights.delete(key);
    });
    conditioningFrameFlights.set(key, flight);
    return flight;
  };

  const verifyConditioningFrameV2 = async (
    input: StudioConditioningFrameRequestV2
  ): Promise<StudioVerifiedConditioningFrameV2 | null> => {
    if (!SAFE_ID.test(input.projectId) || !SAFE_ID.test(input.extractionId)) return null;
    const loaded = await deps.store.getProjectV2(input.projectId);
    if (loaded.status !== 'supported') return null;
    const extraction = ownRecordValue(loaded.project.frameExtractions, input.extractionId);
    if (extraction?.status !== 'ready' || extraction.frameAssetId === null) return null;
    const frameAsset = ownRecordValue(loaded.project.assets, extraction.frameAssetId);
    if (
      frameAsset === undefined ||
      frameAsset.projectId !== loaded.project.id ||
      frameAsset.shotId !== extraction.shotId ||
      frameAsset.mediaKind !== 'image' ||
      frameAsset.managedAsset.collection !== 'conditioningFrames' ||
      !loaded.project.shots[extraction.shotId]?.assetIds.includes(frameAsset.id)
    ) {
      return null;
    }
    if ((await resolveAssetV2(input.projectId, frameAsset.id)) === null) return null;
    return {
      extractionId: extraction.id,
      shotId: extraction.shotId,
      takeAssetId: extraction.takeAssetId,
      endpointSeconds: extraction.endpointSeconds,
      frameAssetId: frameAsset.id,
      byteSize: frameAsset.byteSize,
      sha256: frameAsset.sha256,
    };
  };

  const resumeConditioningFramesV2 = async (supportedProjectIds: readonly string[]): Promise<void> => {
    if (
      !Array.isArray(supportedProjectIds) ||
      Object.keys(supportedProjectIds).length !== supportedProjectIds.length ||
      supportedProjectIds.some((projectId) => typeof projectId !== 'string' || !SAFE_ID.test(projectId)) ||
      new Set(supportedProjectIds).size !== supportedProjectIds.length
    ) {
      throw new CreativeStudioMediaError('invalid_media');
    }
    for (const projectId of supportedProjectIds) {
      // eslint-disable-next-line no-await-in-loop -- Recovery keeps deterministic project ordering and one local decoder.
      const loadedProject = await deps.store.getProjectV2(projectId);
      if (loadedProject.status !== 'supported') continue;
      for (const extraction of Object.values(loadedProject.project.frameExtractions)) {
        if (extraction.status === 'failed') continue;
        // eslint-disable-next-line no-await-in-loop -- One decoder bounds local CPU and memory use during recovery.
        await extractConditioningFrameV2({ projectId, extractionId: extraction.id }).catch((): undefined => undefined);
      }
    }
  };

  type ProviderJobOutputMetadataV2 = Omit<PersistProviderJobOutputInputV2, 'body'>;
  type ProviderJobPosterMetadataV2 = Omit<PersistProviderJobPosterInputV2, 'body'>;
  type ManagedWritePlanV2 = {
    projectDir: string;
    project: StudioProjectV2;
    authority: StudioProjectPathAuthorityV2;
    capacity: WriteCapacity;
    collection: 'assets' | 'thumbnails';
  };

  const validateProviderOutputMetadataV2 = (input: ProviderJobOutputMetadataV2 | ProviderJobPosterMetadataV2): void => {
    if (
      !SAFE_ID.test(input.projectId) ||
      !SAFE_ID.test(input.shotId) ||
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
    if ('mediaKind' in input && input.mediaKind === 'image' && input.durationSeconds !== undefined) {
      throw new CreativeStudioMediaError('invalid_media');
    }
  };

  const prepareProviderJobWriteV2 = async (input: ProviderJobOutputMetadataV2): Promise<ManagedWritePlanV2> => {
    validateProviderOutputMetadataV2(input);
    const { projectDir, project, authority } = await loadProjectContextV2(input.projectId);
    const shot = ownRecordValue(project.shots, input.shotId);
    const job = ownRecordValue(project.jobs, input.jobId);
    const beat = owningBeatForShotV2(project, input.shotId);
    const expectedMediaKind = job?.purpose === 'seed_still' ? 'image' : job?.purpose === 'video_take' ? 'video' : null;
    const mediaKindMatchesRole = expectedMediaKind === input.mediaKind;
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
      job.shotId !== input.shotId ||
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
      collection: 'assets',
    };
  };

  const validateProviderPosterLineageV2 = (
    project: StudioProjectV2,
    input: ProviderJobPosterMetadataV2
  ): { shot: StudioProjectV2['shots'][string]; job: StudioProjectV2['jobs'][string] } => {
    const shot = ownRecordValue(project.shots, input.shotId);
    const job = ownRecordValue(project.jobs, input.jobId);
    if (!shot || !job) throw new CreativeStudioMediaError('not_found');
    if (job.status !== 'succeeded') throw new CreativeStudioMediaError('job_inactive');
    const primary = ownRecordValue(project.assets, input.primaryAssetId);
    if (
      !primary ||
      primary.projectId !== input.projectId ||
      primary.shotId !== input.shotId ||
      primary.mediaKind !== 'video' ||
      primary.managedAsset.collection !== 'assets'
    ) {
      throw new CreativeStudioMediaError('job_inactive');
    }
    if (
      job.purpose !== 'video_take' ||
      job.projectId !== input.projectId ||
      job.shotId !== input.shotId ||
      job.outputAssetIdsByRole.primary !== input.primaryAssetId ||
      job.outputAssetIdsByRole.poster !== null ||
      !job.outputAssetIds.includes(input.primaryAssetId) ||
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

  type CapturedPosterMetadataV2 = Omit<PersistCapturedPosterInputV2, 'body'>;

  const validateCapturedPosterLineageV2 = (
    project: StudioProjectV2,
    input: CapturedPosterMetadataV2
  ): { shot: StudioProjectV2['shots'][string]; job: StudioProjectV2['jobs'][string] } => {
    const shot = ownRecordValue(project.shots, input.shotId);
    const video = ownRecordValue(project.assets, input.videoAssetId);
    if (!shot || !video) throw new CreativeStudioMediaError('not_found');
    if (
      shot.selectedTakeId !== input.videoAssetId ||
      !shot.assetIds.includes(input.videoAssetId) ||
      video.projectId !== input.projectId ||
      video.shotId !== input.shotId ||
      video.mediaKind !== 'video' ||
      video.managedAsset.collection !== 'assets'
    ) {
      throw new CreativeStudioMediaError('job_inactive');
    }
    const producers = shot.jobIds.flatMap((jobId) => {
      const job = ownRecordValue(project.jobs, jobId);
      return job?.projectId === input.projectId &&
        job.shotId === input.shotId &&
        job.purpose === 'video_take' &&
        job.status === 'succeeded' &&
        job.outputAssetIdsByRole.primary === input.videoAssetId &&
        job.outputAssetIds.includes(input.videoAssetId)
        ? [job]
        : [];
    });
    if (producers.length !== 1) throw new CreativeStudioMediaError('job_inactive');
    return { shot, job: producers[0]! };
  };

  const prepareCapturedPosterWriteV2 = async (input: CapturedPosterMetadataV2): Promise<ManagedWritePlanV2> => {
    if (
      !SAFE_ID.test(input.projectId) ||
      !SAFE_ID.test(input.shotId) ||
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

  type ManagedStreamInputV2 = {
    projectId: string;
    shotId: string | null;
    mediaKind: 'image' | 'video';
    declaredMimeType: string;
    declaredByteSize?: number;
    width?: number;
    height?: number;
    durationSeconds?: number;
    body: AsyncIterable<Uint8Array>;
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
      const sha256 = hash.digest('hex');
      let durationSeconds: number | undefined;
      if (input.mediaKind === 'video') {
        try {
          durationSeconds = await probeVideoDurationSecondsV2({ filePath: finalPath, byteSize, sha256 });
        } catch {
          throw new CreativeStudioMediaError('invalid_media');
        }
        if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > Number.MAX_SAFE_INTEGER) {
          throw new CreativeStudioMediaError('invalid_media');
        }
      }
      const asset: StudioAssetV2 = {
        id: assetId,
        projectId: input.projectId,
        shotId: input.shotId,
        mediaKind: input.mediaKind,
        mimeType: signature.mimeType,
        managedAsset: { collection: plan.collection, fileName: `${assetId}.${signature.extension}` },
        byteSize,
        sha256,
        ...(input.width === undefined ? {} : { width: input.width }),
        ...(input.height === undefined ? {} : { height: input.height }),
        ...(durationSeconds === undefined ? {} : { durationSeconds }),
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
    return persistManagedOutputWithPlanV2({ ...input, shotId: null, mediaKind: 'video' }, plan, async (asset) => {
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

  const commitProviderJobAssetV2 = async (input: ProviderJobOutputMetadataV2, asset: StudioAssetV2): Promise<void> => {
    await deps.store.updateProjectV2(input.projectId, (current) => {
      const job = ownRecordValue(current.jobs, input.jobId);
      const shot = ownRecordValue(current.shots, input.shotId);
      const beat = owningBeatForShotV2(current, input.shotId);
      const active =
        job?.status === 'submitting' ||
        job?.status === 'running' ||
        (job?.status === 'failed' && job.error?.code === 'download_failed');
      if (
        !job ||
        !shot ||
        !beat ||
        job.projectId !== input.projectId ||
        job.shotId !== input.shotId ||
        !shot.jobIds.includes(job.id) ||
        !active
      ) {
        throw new CreativeStudioMediaError('job_inactive');
      }
      const expectedMediaKind = job.purpose === 'seed_still' ? 'image' : 'video';
      if (expectedMediaKind !== input.mediaKind) {
        throw new CreativeStudioMediaError('job_inactive');
      }
      if (
        asset.projectId !== current.id ||
        asset.shotId !== shot.id ||
        asset.mediaKind !== input.mediaKind ||
        asset.managedAsset.collection !== 'assets'
      ) {
        throw new CreativeStudioMediaError('invalid_media');
      }
      const usedBytes = Object.values(current.assets).reduce((total, candidate) => total + candidate.byteSize, 0);
      if (usedBytes + asset.byteSize > limits.projectMaxBytes) {
        throw new CreativeStudioMediaError('invalid_media');
      }
      asset.sourceLook = job.requestSnapshot?.prompt ?? `${beat.look.trim()}\n\n${shot.line.trim()}`;
      defineRecordValue(current.assets, asset.id, asset);
      shot.assetIds.push(asset.id);
      job.status = 'succeeded';
      job.outputAssetIds = [asset.id];
      job.outputAssetIdsByRole.primary = asset.id;
      job.error = null;
      delete job.progress;
      job.updatedAt = now();
      return current;
    });
  };

  const persistProviderOutputForJobV2 = async (input: PersistProviderJobOutputInputV2): Promise<StudioAssetV2> =>
    persistManagedOutputWithPlanV2(input, await prepareProviderJobWriteV2(input), (asset) =>
      commitProviderJobAssetV2(input, asset)
    );

  const commitProviderJobPosterV2 = async (
    input: ProviderJobPosterMetadataV2,
    posterAsset: StudioAssetV2
  ): Promise<void> => {
    await deps.store.updateProjectV2(input.projectId, (current) => {
      const { shot, job } = validateProviderPosterLineageV2(current, input);
      if (
        posterAsset.projectId !== current.id ||
        posterAsset.shotId !== shot.id ||
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
      job.outputAssetIdsByRole.poster = posterAsset.id;
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

  const commitCapturedPosterV2 = async (input: CapturedPosterMetadataV2, posterAsset: StudioAssetV2): Promise<void> => {
    await deps.store.updateProjectV2(input.projectId, (current) => {
      const { shot, job } = validateCapturedPosterLineageV2(current, input);
      if (
        posterAsset.projectId !== current.id ||
        posterAsset.shotId !== shot.id ||
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
      job.outputAssetIdsByRole.poster = posterAsset.id;
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
  const persistProviderOutputFromUrlWithPlan = async (
    input: PersistProviderJobOutputUrlInputV2 | (PersistProviderJobPosterUrlInputV2 & { mediaKind: 'image' }),
    plan: { capacity: WriteCapacity },
    persistBody: (body: AsyncIterable<Uint8Array>) => Promise<StudioAssetV2>
  ): Promise<StudioAssetV2> => {
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

  const persistProviderOutputFromUrlForJobV2 = async (
    input: PersistProviderJobOutputUrlInputV2
  ): Promise<StudioAssetV2> => {
    const plan = await prepareProviderJobWriteV2(input);
    return persistProviderOutputFromUrlWithPlan(input, plan, (body) =>
      persistManagedOutputWithPlanV2({ ...input, body }, plan, (asset) => commitProviderJobAssetV2(input, asset))
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

  return {
    importReferenceFromPathV2,
    detachBriefReferenceV2,
    persistProviderOutputForJobV2,
    persistProviderOutputFromUrlForJobV2,
    persistProviderPosterForJobV2,
    persistProviderPosterFromUrlForJobV2,
    persistCapturedPosterV2,
    persistProjectOutputV2,
    getLatestProjectOutputV2,
    resolveAssetV2,
    resolveProviderInputV2,
    extractConditioningFrameV2,
    verifyConditioningFrameV2,
    resumeConditioningFramesV2,
    cleanupOrphanPartsV2,
  };
};
