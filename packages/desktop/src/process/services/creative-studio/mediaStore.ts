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
  StudioDetachBedAudioRequestV2,
  StudioFrameExtraction,
  StudioJobPurpose,
  StudioProjectV2,
} from '@/common/types/project/creativeStudioTypes';
import {
  STUDIO_MUTATION_BATCH_SCHEMA_VERSION,
  STUDIO_PROJECT_SCHEMA_VERSION,
} from '@/common/types/project/creativeStudioTypes';
import {
  extractConditioningFrame,
  StudioConditioningFrameError,
  type StudioConditioningFrameExtractionInput,
  type StudioConditioningFrameExtractionResult,
} from './adapters/conditioningFrame';
import { STUDIO_MANAGED_ASSET_COLLECTIONS_V2 } from '@/common/types/project/creativeStudioManagedAssetCollections';
import {
  applyStudioMutationBatchV2,
  createStudioFrameExtractionId,
  studioGenerationCompositionDigestV2,
  type StudioVerifiedConditioningFrameV2,
} from './service/schema2';
import {
  decodeStudioProjectManifestV2,
  STUDIO_BRIEF_FILE_MAX_BYTES,
  STUDIO_BRIEF_FILE_NAME,
} from './service/briefFile';
import {
  CreativeStudioStoreError,
  STUDIO_PROJECT_V2_MAX_RECORD_BYTES,
  type CreativeStudioStore,
  type StudioProjectAuthoritySnapshotV2,
} from './store';
import { downloadRemoteMedia, type RemoteMediaDownloadDeps } from '../remote-media/remoteMediaDownloader';

const SAFE_ID = /^[A-Za-z0-9_-]{1,256}$/;
const LOWERCASE_SHA256 = /^[a-f0-9]{64}$/;
const CANONICAL_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const BED_MEDIA_INTENT_MAX_BYTES = 16 * 1024;
/** Bed publication journal version. This sidecar contract is independent from the project manifest schema. */
export const STUDIO_BED_MEDIA_INTENT_SCHEMA_VERSION = 1 as const;
const STUDIO_CLEANUP_QUARANTINE_DIRECTORY = /^\.studio-cleanup-[A-Za-z0-9]{6}$/;
const hasExactOwnKeys = (value: unknown, keys: readonly string[]): value is Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  try {
    const ownKeys = Reflect.ownKeys(value);
    return (
      ownKeys.length === keys.length &&
      ownKeys.every((key) => typeof key === 'string' && keys.includes(key)) &&
      ownKeys.every((key) => {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        return descriptor?.enumerable === true && Object.hasOwn(descriptor, 'value');
      })
    );
  } catch {
    return false;
  }
};
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

const isCanonicalBedAudioAssetForProjectV2 = (projectId: string, asset: StudioAssetV2): boolean =>
  asset.projectId === projectId &&
  SAFE_ID.test(asset.id) &&
  asset.shotId === null &&
  asset.mediaKind === 'audio' &&
  asset.mimeType === 'audio/wav' &&
  asset.managedAsset.collection === 'imports' &&
  asset.managedAsset.fileName === `${asset.id}.wav` &&
  Number.isFinite(asset.durationSeconds) &&
  asset.durationSeconds! > 0 &&
  asset.durationSeconds! <= Number.MAX_SAFE_INTEGER &&
  asset.width === undefined &&
  asset.height === undefined &&
  asset.projectReferenceId === null &&
  asset.generationReferenceAssetIds.length === 0 &&
  asset.producerJobId === null &&
  asset.compositionDigest === null;

const isCanonicalBedAudioAssetV2 = (project: StudioProjectV2, asset: StudioAssetV2): boolean =>
  isCanonicalBedAudioAssetForProjectV2(project.id, asset);

const sameCanonicalBedAudioAssetV2 = (left: StudioAssetV2, right: StudioAssetV2): boolean =>
  left.id === right.id &&
  left.projectId === right.projectId &&
  left.shotId === right.shotId &&
  left.mediaKind === right.mediaKind &&
  left.mimeType === right.mimeType &&
  left.managedAsset.collection === right.managedAsset.collection &&
  left.managedAsset.fileName === right.managedAsset.fileName &&
  left.byteSize === right.byteSize &&
  left.sha256 === right.sha256 &&
  left.durationSeconds === right.durationSeconds &&
  left.createdAt === right.createdAt;

type StudioBedMediaIntentV2 = {
  schemaVersion: typeof STUDIO_BED_MEDIA_INTENT_SCHEMA_VERSION;
  kind: 'import_bed_audio' | 'detach_bed_audio';
  projectId: string;
  expectedRevision: number;
  asset: StudioAssetV2;
  managedIdentity: FileIdentity;
};

type PublishedStudioBedMediaIntentV2 = {
  intent: StudioBedMediaIntentV2;
  filePath: string;
  identity: FileIdentity;
  directory: VerifiedDirectory;
};

const bedMediaIntentFileNameV2 = (intent: Pick<StudioBedMediaIntentV2, 'kind' | 'asset'>): string =>
  `${intent.kind === 'import_bed_audio' ? 'bed-import' : 'bed-detach'}-${intent.asset.id}.json`;

const isStudioBedMediaIntentV2 = (value: unknown): value is StudioBedMediaIntentV2 => {
  if (
    !hasExactOwnKeys(value, ['schemaVersion', 'kind', 'projectId', 'expectedRevision', 'asset', 'managedIdentity']) ||
    value.schemaVersion !== STUDIO_BED_MEDIA_INTENT_SCHEMA_VERSION ||
    (value.kind !== 'import_bed_audio' && value.kind !== 'detach_bed_audio') ||
    typeof value.projectId !== 'string' ||
    !SAFE_ID.test(value.projectId) ||
    typeof value.expectedRevision !== 'number' ||
    !Number.isSafeInteger(value.expectedRevision) ||
    value.expectedRevision < 1 ||
    value.expectedRevision >= Number.MAX_SAFE_INTEGER ||
    !hasExactOwnKeys(value.managedIdentity, ['dev', 'ino']) ||
    typeof value.managedIdentity.dev !== 'string' ||
    value.managedIdentity.dev.length < 1 ||
    typeof value.managedIdentity.ino !== 'string' ||
    value.managedIdentity.ino.length < 1 ||
    !hasExactOwnKeys(value.asset, [
      'id',
      'projectId',
      'shotId',
      'mediaKind',
      'mimeType',
      'managedAsset',
      'byteSize',
      'sha256',
      'durationSeconds',
      'projectReferenceId',
      'generationReferenceAssetIds',
      'producerJobId',
      'compositionDigest',
      'createdAt',
    ])
  ) {
    return false;
  }
  const asset = value.asset;
  return (
    typeof asset.id === 'string' &&
    SAFE_ID.test(asset.id) &&
    typeof asset.projectId === 'string' &&
    asset.projectId === value.projectId &&
    asset.shotId === null &&
    asset.mediaKind === 'audio' &&
    asset.mimeType === 'audio/wav' &&
    hasExactOwnKeys(asset.managedAsset, ['collection', 'fileName']) &&
    asset.managedAsset.collection === 'imports' &&
    asset.managedAsset.fileName === `${asset.id}.wav` &&
    typeof asset.byteSize === 'number' &&
    Number.isSafeInteger(asset.byteSize) &&
    asset.byteSize >= 12 &&
    typeof asset.sha256 === 'string' &&
    LOWERCASE_SHA256.test(asset.sha256) &&
    typeof asset.durationSeconds === 'number' &&
    Number.isFinite(asset.durationSeconds) &&
    asset.durationSeconds > 0 &&
    asset.durationSeconds <= Number.MAX_SAFE_INTEGER &&
    asset.projectReferenceId === null &&
    Array.isArray(asset.generationReferenceAssetIds) &&
    asset.generationReferenceAssetIds.length === 0 &&
    asset.producerJobId === null &&
    asset.compositionDigest === null &&
    typeof asset.createdAt === 'string' &&
    CANONICAL_TIMESTAMP.test(asset.createdAt)
  );
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
    mimeType: 'audio/wav',
    extension: 'wav',
    match: (bytes: Buffer) => bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WAVE',
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
  readonly code:
    | 'invalid_media'
    | 'seed_still_variation_grid'
    | 'storage_error'
    | 'stale_project'
    | 'not_found'
    | 'job_inactive'
    | 'media_in_use';

  constructor(code: CreativeStudioMediaError['code']) {
    super(code);
    this.name = 'CreativeStudioMediaError';
    this.code = code;
  }
}

const providerPrimaryMediaKindV2 = (purpose: StudioJobPurpose): 'image' | 'video' => {
  switch (purpose) {
    case 'seed_still':
    case 'board_still':
    case 'reference_image':
      return 'image';
    case 'video_take':
      return 'video';
  }
};

const providerPrimaryCollectionV2 = (
  purpose: StudioJobPurpose
): Extract<StudioAssetV2['managedAsset']['collection'], 'assets' | 'boardStills'> => {
  switch (purpose) {
    case 'seed_still':
    case 'reference_image':
    case 'video_take':
      return 'assets';
    case 'board_still':
      return 'boardStills';
  }
};

export type InternalImportSeedStillInputV2 = {
  projectId: string;
  sourcePath: string;
  shotId: string;
  expectedRevision: number;
  returnProject?: boolean;
};

export type StudioMediaImportResultV2 = { asset: StudioAssetV2; project: StudioProjectV2 };

export type InternalImportBedAudioInputV2 = {
  projectId: string;
  sourcePath: string;
  expectedRevision: number;
  /** Main-only lifecycle fence; never accepted from the renderer payload. */
  assertActive?: () => void;
};

export type InternalDetachBedAudioInputV2 = StudioDetachBedAudioRequestV2 & {
  /** Main-only lifecycle fence; never accepted from the renderer payload. */
  assertActive?: () => void;
};

export type PersistProviderJobOutputInputV2 = {
  projectId: string;
  shotId: string | null;
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

export type StudioConditioningFrameRequestV2 = {
  projectId: string;
  extractionId: string;
};

export type StudioResolvedAssetV2 = {
  asset: StudioAssetV2;
  openVerifiedStream: (start?: number, end?: number) => Promise<Readable>;
};

export type StudioMediaStore = {
  importSeedStillFromPathV2(
    input: InternalImportSeedStillInputV2 & { returnProject: true }
  ): Promise<StudioMediaImportResultV2>;
  importSeedStillFromPathV2(input: InternalImportSeedStillInputV2): Promise<StudioAssetV2>;
  importBedAudioFromPathV2(input: InternalImportBedAudioInputV2): Promise<StudioMediaImportResultV2>;
  detachBedAudioV2(input: InternalDetachBedAudioInputV2): Promise<StudioProjectV2>;
  persistProviderOutputForJobV2(input: PersistProviderJobOutputInputV2): Promise<StudioAssetV2>;
  persistProviderOutputFromUrlForJobV2(input: PersistProviderJobOutputUrlInputV2): Promise<StudioAssetV2>;
  persistProviderPosterForJobV2(input: PersistProviderJobPosterInputV2): Promise<StudioAssetV2>;
  persistProviderPosterFromUrlForJobV2(input: PersistProviderJobPosterUrlInputV2): Promise<StudioAssetV2>;
  persistCapturedPosterV2(input: PersistCapturedPosterInputV2): Promise<StudioAssetV2>;
  resolveAssetV2(projectId: string, assetId: string): Promise<StudioResolvedAssetV2 | null>;
  /** Resolves media while the caller already owns the Store project queue; never re-enters that queue. */
  resolveAssetWithProjectAuthorityV2(
    authority: Pick<StudioProjectAuthoritySnapshotV2, 'project' | 'projectDir' | 'assertCurrent'>,
    assetId: string
  ): Promise<StudioResolvedAssetV2 | null>;
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
  /** Acquires the shared export-catalog lock after the project queue and holds it through one media commit. */
  withManagedMediaAuthority?: <T>(
    authority: StudioProjectAuthoritySnapshotV2,
    operation: (facts: Readonly<{ catalogRevision: number; managedByteSize: number }>) => Promise<T>
  ) => Promise<T>;
  createId?: () => string;
  createMutationId?: () => string;
  now?: () => string;
  /** Process lifecycle fence used again inside the queued project commit. */
  assertActive?: () => void;
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
  /** Test seam for observing or faulting a verified managed-directory sync after the real fsync succeeds. */
  afterV2ManagedDirectorySync?: (directory: string) => void | Promise<void>;
  /** V2 video duration is decoded from the finalized managed bytes, never trusted from provider metadata. */
  probeVideoDurationSecondsV2?: (input: { filePath: string; byteSize: number; sha256: string }) => Promise<number>;
  /** Rejects multi-panel provider images before they can become a current first frame or reference. */
  detectImageVariationGridV2?: (input: { filePath: string }) => Promise<boolean>;
  /** V2 bed metadata is decoded from finalized managed bytes and must describe one audio-only stream. */
  probeBedAudioV2?: (input: {
    filePath: string;
    byteSize: number;
    sha256: string;
  }) => Promise<{ durationSeconds: number; audioStreamCount: number; otherStreamCount: number }>;
  ffprobeBinary?: string;
  ffmpegBinary?: string;
  conditioningFrameExtractor?: (
    input: StudioConditioningFrameExtractionInput
  ) => Promise<StudioConditioningFrameExtractionResult>;
};

type FileIdentity = { dev: string; ino: string };

const VARIATION_GRID_SEAM_EXCESS_THRESHOLD = 48;

/**
 * Detects the repeated full-height separators characteristic of a four-panel generation sheet.
 * A single strong central edge is ordinary composition, so two of the three quartile seams must
 * exceed the image's own median adjacent-column change by the calibrated margin.
 */
export const studioImageHasVariationGridV2 = (input: {
  data: Uint8Array;
  width: number;
  height: number;
  channels: number;
}): boolean => {
  const { data, width, height, channels } = input;
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    !Number.isSafeInteger(channels) ||
    width < 8 ||
    height < 8 ||
    channels < 3 ||
    channels > 4 ||
    data.length !== width * height * channels
  ) {
    return false;
  }
  const columnDifference = (column: number): number => {
    let total = 0;
    for (let row = 0; row < height; row += 1) {
      const right = (row * width + column) * channels;
      const left = right - channels;
      total +=
        Math.abs(data[right]! - data[left]!) +
        Math.abs(data[right + 1]! - data[left + 1]!) +
        Math.abs(data[right + 2]! - data[left + 2]!);
    }
    return total / (height * 3);
  };
  const adjacentDifferences = Array.from({ length: width - 1 }, (_, index) => columnDifference(index + 1)).toSorted(
    (left, right) => left - right
  );
  const middle = Math.floor(adjacentDifferences.length / 2);
  const median =
    adjacentDifferences.length % 2 === 0
      ? (adjacentDifferences[middle - 1]! + adjacentDifferences[middle]!) / 2
      : adjacentDifferences[middle]!;
  const seams = [0.25, 0.5, 0.75].map((ratio) => Math.min(width - 1, Math.max(1, Math.round(width * ratio))));
  return (
    seams.filter((column) => columnDifference(column) - median >= VARIATION_GRID_SEAM_EXCESS_THRESHOLD).length >= 2
  );
};

const detectImageVariationGridV2 = async (input: { filePath: string }): Promise<boolean> => {
  const sharp = (await import('sharp')).default;
  const { data, info } = await sharp(input.filePath, { limitInputPixels: 40_000_000, sequentialRead: true })
    .rotate()
    .resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return studioImageHasVariationGridV2({
    data,
    width: info.width,
    height: info.height,
    channels: info.channels,
  });
};

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
  briefPath: string;
  briefIdentity: FileIdentity;
  briefByteLength: number;
  briefSha256: string;
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
  let briefHandle: Awaited<ReturnType<typeof fs.open>> | null = null;
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
    const briefPath = path.join(projectDir, STUDIO_BRIEF_FILE_NAME);
    if (path.dirname(briefPath) !== projectDir) throw new CreativeStudioMediaError('storage_error');
    const briefStats = await fs.lstat(briefPath);
    if (!briefStats.isFile() || briefStats.isSymbolicLink() || (await fs.realpath(briefPath)) !== briefPath) {
      throw new CreativeStudioMediaError('storage_error');
    }
    const briefIdentity = fileIdentity(briefStats);
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
    const parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
    briefHandle = await fs.open(
      briefPath,
      fsConstants.O_RDONLY | (typeof fsConstants.O_NOFOLLOW === 'number' ? fsConstants.O_NOFOLLOW : 0)
    );
    const briefBefore = await briefHandle.stat();
    const briefBeforeIdentity = fileIdentity(briefBefore);
    if (
      !briefBefore.isFile() ||
      briefBeforeIdentity.dev !== briefIdentity.dev ||
      briefBeforeIdentity.ino !== briefIdentity.ino ||
      briefBefore.size > STUDIO_BRIEF_FILE_MAX_BYTES
    ) {
      throw new CreativeStudioMediaError('storage_error');
    }
    const briefBytes = await briefHandle.readFile();
    const briefAfter = await briefHandle.stat();
    const briefAfterIdentity = fileIdentity(briefAfter);
    const decoded = decodeStudioProjectManifestV2(parsed, new TextDecoder('utf-8', { fatal: true }).decode(briefBytes));
    const after = await handle.stat();
    const afterIdentity = fileIdentity(after);
    if (
      afterIdentity.dev !== beforeIdentity.dev ||
      afterIdentity.ino !== beforeIdentity.ino ||
      bytes.length !== before.size ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs ||
      briefAfterIdentity.dev !== briefBeforeIdentity.dev ||
      briefAfterIdentity.ino !== briefBeforeIdentity.ino ||
      briefBytes.length !== briefBefore.size ||
      briefAfter.size !== briefBefore.size ||
      briefAfter.mtimeMs !== briefBefore.mtimeMs ||
      decoded === null ||
      !decoded.synchronized ||
      decoded.project.schemaVersion !== STUDIO_PROJECT_SCHEMA_VERSION ||
      decoded.project.id !== projectId
    ) {
      throw new CreativeStudioMediaError('storage_error');
    }
    const finalDirectoryStats = await fs.lstat(projectDir);
    const finalManifestStats = await fs.lstat(manifestPath);
    const finalBriefStats = await fs.lstat(briefPath);
    const finalDirectoryIdentity = fileIdentity(finalDirectoryStats);
    const finalManifestIdentity = fileIdentity(finalManifestStats);
    const finalBriefIdentity = fileIdentity(finalBriefStats);
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
      finalManifestStats.mtimeMs !== before.mtimeMs ||
      !finalBriefStats.isFile() ||
      finalBriefStats.isSymbolicLink() ||
      finalBriefIdentity.dev !== briefIdentity.dev ||
      finalBriefIdentity.ino !== briefIdentity.ino ||
      finalBriefStats.size !== briefBefore.size ||
      finalBriefStats.mtimeMs !== briefBefore.mtimeMs
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
        briefPath,
        briefIdentity,
        briefByteLength: briefBytes.length,
        briefSha256: createHash('sha256').update(briefBytes).digest('hex'),
      },
      project: decoded.project,
    };
  } catch (error) {
    if (error instanceof CreativeStudioMediaError) throw error;
    throw new CreativeStudioMediaError('storage_error');
  } finally {
    await handle?.close().catch((): undefined => undefined);
    await briefHandle?.close().catch((): undefined => undefined);
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
    current.manifestSha256 !== authority.manifestSha256 ||
    current.briefPath !== authority.briefPath ||
    current.briefIdentity.dev !== authority.briefIdentity.dev ||
    current.briefIdentity.ino !== authority.briefIdentity.ino ||
    current.briefByteLength !== authority.briefByteLength ||
    current.briefSha256 !== authority.briefSha256
  ) {
    throw new CreativeStudioMediaError('storage_error');
  }
};

const assertStudioProjectDirectoryAuthorityV2 = async (authority: StudioProjectPathAuthorityV2): Promise<void> => {
  try {
    const stats = await fs.lstat(authority.projectDir);
    const identity = fileIdentity(stats);
    if (
      !stats.isDirectory() ||
      stats.isSymbolicLink() ||
      path.basename(authority.projectDir) !== authority.projectId ||
      (await fs.realpath(authority.projectDir)) !== authority.projectDir ||
      identity.dev !== authority.directoryIdentity.dev ||
      identity.ino !== authority.directoryIdentity.ino
    ) {
      throw new CreativeStudioMediaError('storage_error');
    }
  } catch (error) {
    if (error instanceof CreativeStudioMediaError) throw error;
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

type ManagedFileProofV2 = Required<Omit<VerifiedReadExpectation, 'verifyContent'>>;

const assertManagedFileProofV2 = async (filePath: string, proof: ManagedFileProofV2): Promise<void> => {
  const stream = await openVerifiedReadStream(filePath, undefined, undefined, undefined, {
    ...proof,
    verifyContent: true,
  });
  stream.destroy();
  if (!stream.closed) {
    await new Promise<void>((resolve) => stream.once('close', resolve));
  }
};

const captureManagedFileProofV2 = async (
  filePath: string,
  expectedIdentity: FileIdentity,
  asset: Pick<StudioAssetV2, 'byteSize' | 'sha256' | 'mimeType'>
): Promise<ManagedFileProofV2> => {
  const stats = await regularFile(filePath);
  const identity = fileIdentity(stats);
  const byteSize = Number(stats.size);
  const mtimeMs = Number(stats.mtimeMs);
  const ctimeMs = Number(stats.ctimeMs);
  if (
    identity.dev !== expectedIdentity.dev ||
    identity.ino !== expectedIdentity.ino ||
    byteSize !== asset.byteSize ||
    !Number.isFinite(mtimeMs) ||
    !Number.isFinite(ctimeMs)
  ) {
    throw new CreativeStudioMediaError('storage_error');
  }
  const proof: ManagedFileProofV2 = {
    ...identity,
    byteSize: asset.byteSize,
    mtimeMs,
    ctimeMs,
    sha256: asset.sha256,
    mimeType: asset.mimeType,
  };
  await assertManagedFileProofV2(filePath, proof);
  return proof;
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

type ManagedPartPublicationDurabilityV2 = {
  syncDestinationDirectory: () => Promise<void>;
  syncPartsDirectory: () => Promise<void>;
};

/** fsyncs a fresh part, then links it into place without ever overwriting an existing asset. */
const finalizeManagedPartV2 = async (
  partPath: string,
  partsDir: string,
  destinationPath: string,
  destinationDir: string,
  expectedPartIdentity: FileIdentity,
  beforeMutation: () => Promise<void>,
  onDestinationLinked: (identity: FileIdentity) => void,
  publicationDurability?: ManagedPartPublicationDurabilityV2
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
      if (publicationDurability !== undefined) {
        await beforeMutation();
        await publicationDurability.syncDestinationDirectory();
      }
      await beforeMutation();
      await fs.unlink(partPath);
      if (publicationDurability !== undefined) {
        await beforeMutation();
        await publicationDurability.syncPartsDirectory();
      }
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

const resolveFfmpegBinaryV2 = (configured: string | undefined, ffprobeBinary: string): string => {
  const explicit = configured?.trim() || process.env.FFMPEG_PATH?.trim();
  if (explicit) return explicit;
  if (!ffprobeBinary.includes(path.sep)) return 'ffmpeg';
  const extension = path.extname(ffprobeBinary).toLowerCase() === '.exe' ? '.exe' : '';
  return path.join(path.dirname(ffprobeBinary), `ffmpeg${extension}`);
};

const runFfprobeDurationV2 = async (binary: string, handle: Awaited<ReturnType<typeof fs.open>>): Promise<number> =>
  new Promise<number>((resolve, reject) => {
    const child = spawn(
      binary,
      [
        '-v',
        'error',
        '-show_entries',
        'format=duration',
        '-of',
        'default=noprint_wrappers=1:nokey=1',
        '-fd',
        '3',
        'fd:',
      ],
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

type StudioBedAudioProbeV2 = {
  durationSeconds: number;
  audioStreamCount: number;
  otherStreamCount: number;
};

const runFfprobeBedAudioV2 = async (
  binary: string,
  handle: Awaited<ReturnType<typeof fs.open>>
): Promise<StudioBedAudioProbeV2> =>
  new Promise<StudioBedAudioProbeV2>((resolve, reject) => {
    const child = spawn(
      binary,
      ['-v', 'error', '-show_entries', 'stream=codec_type,duration:format=duration', '-of', 'json', '-fd', '3', 'fd:'],
      { stdio: ['ignore', 'pipe', 'ignore', handle.fd], windowsHide: true }
    );
    let stdout = '';
    let settled = false;
    const finish = (error?: Error, result?: StudioBedAudioProbeV2): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(result!);
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(new CreativeStudioMediaError('invalid_media'));
    }, 60_000);
    timer.unref?.();
    child.stdout.on('data', (chunk: Buffer) => {
      if (stdout.length + chunk.length > 64 * 1024) {
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
      try {
        const parsed = JSON.parse(stdout) as unknown;
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          finish(new CreativeStudioMediaError('invalid_media'));
          return;
        }
        const streams = Reflect.get(parsed, 'streams');
        const format = Reflect.get(parsed, 'format');
        if (!Array.isArray(streams) || typeof format !== 'object' || format === null || Array.isArray(format)) {
          finish(new CreativeStudioMediaError('invalid_media'));
          return;
        }
        let audioStreamCount = 0;
        let otherStreamCount = 0;
        let audioStreamDurationSeconds = Number.NaN;
        for (const stream of streams) {
          if (typeof stream !== 'object' || stream === null || Array.isArray(stream)) {
            finish(new CreativeStudioMediaError('invalid_media'));
            return;
          }
          if (Reflect.get(stream, 'codec_type') === 'audio') {
            audioStreamCount += 1;
            audioStreamDurationSeconds = Number(Reflect.get(stream, 'duration'));
          } else otherStreamCount += 1;
        }
        const formatDurationSeconds = Number(Reflect.get(format, 'duration'));
        const durationSeconds =
          Number.isFinite(formatDurationSeconds) && formatDurationSeconds > 0
            ? formatDurationSeconds
            : audioStreamDurationSeconds;
        if (audioStreamCount !== 1 || otherStreamCount !== 0) {
          finish(new CreativeStudioMediaError('invalid_media'));
          return;
        }
        finish(undefined, { durationSeconds, audioStreamCount, otherStreamCount });
      } catch {
        finish(new CreativeStudioMediaError('invalid_media'));
      }
    });
  });

const runFfmpegBedAudioDecodeV2 = async (
  binary: string,
  handle: Awaited<ReturnType<typeof fs.open>>
): Promise<number> =>
  new Promise<number>((resolve, reject) => {
    const child = spawn(
      binary,
      [
        '-nostdin',
        '-v',
        'error',
        '-xerror',
        '-fd',
        '3',
        '-i',
        'fd:',
        '-map',
        '0:a:0',
        '-progress',
        'pipe:1',
        '-nostats',
        '-f',
        'null',
        '-',
      ],
      {
        stdio: ['ignore', 'pipe', 'ignore', handle.fd],
        windowsHide: true,
      }
    );
    let stdout = '';
    let settled = false;
    const finish = (error?: Error, durationSeconds?: number): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(durationSeconds!);
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(new CreativeStudioMediaError('invalid_media'));
    }, 60_000);
    timer.unref?.();
    child.stdout.on('data', (chunk: Buffer) => {
      if (stdout.length + chunk.length > 64 * 1024) {
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
      const progressValues = Array.from(stdout.matchAll(/^out_time_us=(\d+)$/gmu));
      const durationMicroseconds = Number(progressValues.at(-1)?.[1]);
      const durationSeconds = durationMicroseconds / 1_000_000;
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

const defaultProbeBedAudioV2 = async (input: {
  filePath: string;
  byteSize: number;
  sha256: string;
  ffprobeBinary: string;
  ffmpegBinary: string;
}): Promise<StudioBedAudioProbeV2> => {
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
    const result = await runFfprobeBedAudioV2(input.ffprobeBinary, handle);
    let decodeHandle: Awaited<ReturnType<typeof fs.open>>;
    let decodedDurationSeconds: number;
    try {
      decodeHandle = await fs.open(input.filePath, fsConstants.O_RDONLY | noFollow);
    } catch {
      throw new CreativeStudioMediaError('invalid_media');
    }
    try {
      const decodeBefore = await decodeHandle.stat();
      if (
        !decodeBefore.isFile() ||
        decodeBefore.dev !== before.dev ||
        decodeBefore.ino !== before.ino ||
        decodeBefore.size !== before.size ||
        decodeBefore.mtimeMs !== before.mtimeMs ||
        decodeBefore.ctimeMs !== before.ctimeMs
      ) {
        throw new CreativeStudioMediaError('invalid_media');
      }
      decodedDurationSeconds = await runFfmpegBedAudioDecodeV2(input.ffmpegBinary, decodeHandle);
      const decodeAfter = await decodeHandle.stat();
      if (
        !decodeAfter.isFile() ||
        decodeAfter.dev !== decodeBefore.dev ||
        decodeAfter.ino !== decodeBefore.ino ||
        decodeAfter.size !== decodeBefore.size ||
        decodeAfter.mtimeMs !== decodeBefore.mtimeMs ||
        decodeAfter.ctimeMs !== decodeBefore.ctimeMs
      ) {
        throw new CreativeStudioMediaError('invalid_media');
      }
    } finally {
      await decodeHandle.close().catch((): undefined => undefined);
    }
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
    return { ...result, durationSeconds: decodedDurationSeconds };
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
  const createMutationId = deps.createMutationId ?? (() => randomUUID().replaceAll('-', '_'));
  const now = deps.now ?? (() => new Date().toISOString());
  const getAvailableDiskBytes = deps.getAvailableDiskBytes ?? getAvailableStudioDiskBytes;
  const probeVideoDurationSecondsV2 =
    deps.probeVideoDurationSecondsV2 ??
    ((input: { filePath: string; byteSize: number; sha256: string }) =>
      defaultProbeVideoDurationSecondsV2({
        ...input,
        ffprobeBinary: resolveFfprobeBinaryV2(deps.ffprobeBinary),
      }));
  const probeBedAudioV2 =
    deps.probeBedAudioV2 ??
    ((input: { filePath: string; byteSize: number; sha256: string }) => {
      const ffprobeBinary = resolveFfprobeBinaryV2(deps.ffprobeBinary);
      return defaultProbeBedAudioV2({
        ...input,
        ffprobeBinary,
        ffmpegBinary: resolveFfmpegBinaryV2(deps.ffmpegBinary, ffprobeBinary),
      });
    });
  const conditioningFrameExtractor = deps.conditioningFrameExtractor ?? extractConditioningFrame;
  const conditioningFrameFlights = new Map<string, Promise<StudioFrameExtraction>>();
  const limits: StudioMediaLimits = { ...STUDIO_MEDIA_LIMITS, ...deps.limits };
  if (Object.values(limits).some((limit) => !Number.isSafeInteger(limit) || limit < 1)) {
    throw new CreativeStudioMediaError('storage_error');
  }
  const activeBedAudioReadClaims = new Map<string, number>();
  const detachingBedAudio = new Set<string>();
  const bedAudioClaimKey = (projectId: string, assetId: string): string => `${projectId}\u0000${assetId}`;
  const assertOperationActive = (operationAssertActive?: () => void): void => {
    deps.assertActive?.();
    operationAssertActive?.();
  };
  const withManagedMediaAuthority =
    deps.withManagedMediaAuthority ??
    (async <T>(
      _authority: StudioProjectAuthoritySnapshotV2,
      operation: (facts: Readonly<{ catalogRevision: number; managedByteSize: number }>) => Promise<T>
    ): Promise<T> => operation(Object.freeze({ catalogRevision: 1, managedByteSize: 0 })));
  const withManagedProjectAuthority = <T>(
    projectId: string,
    operation: (
      authority: StudioProjectAuthoritySnapshotV2,
      facts: Readonly<{ catalogRevision: number; managedByteSize: number }>
    ) => Promise<T>
  ): Promise<T> =>
    deps.store.withProjectAuthorityV2(projectId, (authority) =>
      withManagedMediaAuthority(authority, (facts) => operation(authority, facts))
    );

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

  const assertManagedProjectCapacity = (
    project: { assets: Record<string, { byteSize: number }> },
    retainedExportBytes: number,
    addedBytes: number,
    replacedBytes = 0
  ): void => {
    if (
      !Number.isSafeInteger(retainedExportBytes) ||
      retainedExportBytes < 0 ||
      !Number.isSafeInteger(addedBytes) ||
      addedBytes < 0 ||
      !Number.isSafeInteger(replacedBytes) ||
      replacedBytes < 0
    ) {
      throw new CreativeStudioMediaError('storage_error');
    }
    let usedBytes = retainedExportBytes;
    for (const asset of Object.values(project.assets)) {
      if (!Number.isSafeInteger(asset.byteSize) || asset.byteSize < 0) {
        throw new CreativeStudioMediaError('storage_error');
      }
      usedBytes += asset.byteSize;
      if (!Number.isSafeInteger(usedBytes) || usedBytes > limits.projectMaxBytes) {
        throw new CreativeStudioMediaError('invalid_media');
      }
    }
    usedBytes = usedBytes - replacedBytes + addedBytes;
    if (usedBytes < 0) throw new CreativeStudioMediaError('storage_error');
    if (!Number.isSafeInteger(usedBytes) || usedBytes > limits.projectMaxBytes) {
      throw new CreativeStudioMediaError('invalid_media');
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

  /**
   * Captures a coherent provider-output plan while the Store's short project queue is held. Paid
   * sibling jobs may commit while bytes are streamed, but they cannot split this initial project
   * snapshot from its directory authority and turn a valid output into a download failure.
   */
  const loadProviderOutputContextV2 = (
    projectId: string
  ): Promise<{ projectDir: string; project: StudioProjectV2; authority: StudioProjectPathAuthorityV2 }> =>
    deps.store.withProjectAuthorityV2(projectId, async (projectAuthority) => {
      if (
        projectAuthority.project.id !== projectId ||
        path.basename(projectAuthority.projectDir) !== projectId ||
        (await fs.realpath(projectAuthority.projectDir)) !== projectAuthority.projectDir
      ) {
        throw new CreativeStudioMediaError('storage_error');
      }
      await projectAuthority.assertCurrent?.();
      const captured = await captureStudioProjectPathAuthorityV2(projectId, projectAuthority.projectDir);
      await projectAuthority.assertCurrent?.();
      if (
        captured.project.id !== projectAuthority.project.id ||
        captured.project.revision !== projectAuthority.project.revision ||
        captured.project.updatedAt !== projectAuthority.project.updatedAt
      ) {
        throw new CreativeStudioMediaError('storage_error');
      }
      return {
        projectDir: projectAuthority.projectDir,
        project: structuredClone(projectAuthority.project),
        authority: captured.authority,
      };
    });

  const assertManagedDirectoriesV2 = async (
    authority: StudioProjectPathAuthorityV2,
    directories: readonly VerifiedDirectory[]
  ): Promise<void> => {
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

  const assertV2ManagedMutation = async (
    authority: StudioProjectPathAuthorityV2,
    directories: readonly VerifiedDirectory[] = []
  ): Promise<void> => {
    await deps.beforeV2ManagedMutation?.(authority.projectDir);
    await assertStudioProjectPathAuthorityV2(authority);
    await assertManagedDirectoriesV2(authority, directories);
  };

  const assertV2ProviderOutputPathMutation = async (
    authority: StudioProjectPathAuthorityV2,
    directories: readonly VerifiedDirectory[] = []
  ): Promise<void> => {
    await deps.beforeV2ManagedMutation?.(authority.projectDir);
    await assertStudioProjectDirectoryAuthorityV2(authority);
    await assertManagedDirectoriesV2(authority, directories);
  };

  const captureManagedDirectoryV2 = async (
    authority: StudioProjectPathAuthorityV2,
    directory: string,
    assertMutation: (
      authority: StudioProjectPathAuthorityV2,
      directories?: readonly VerifiedDirectory[]
    ) => Promise<void> = assertV2ManagedMutation
  ): Promise<VerifiedDirectory> => {
    if (path.dirname(directory) !== authority.projectDir) throw new CreativeStudioMediaError('storage_error');
    const verified = await captureVerifiedDirectory(directory);
    if ((await fs.realpath(directory)) !== directory) throw new CreativeStudioMediaError('storage_error');
    await assertMutation(authority, [verified]);
    return verified;
  };

  const ensureManagedDirectoryV2 = async (
    authority: StudioProjectPathAuthorityV2,
    name: string,
    assertMutation: (
      authority: StudioProjectPathAuthorityV2,
      directories?: readonly VerifiedDirectory[]
    ) => Promise<void> = assertV2ManagedMutation
  ): Promise<VerifiedDirectory> => {
    await assertMutation(authority);
    const directory = await ensureManagedDirectory(authority.projectDir, name);
    return captureManagedDirectoryV2(authority, directory, assertMutation);
  };

  const cleanupManagedPathV2 = async (
    authority: StudioProjectPathAuthorityV2,
    filePath: string,
    identity: FileIdentity,
    directory: VerifiedDirectory,
    verifyOwnership?: (ownedPath: string) => Promise<void>
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
          await verifyOwnership?.(ownedPath);
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
          const committedAsset = ownRecordValue(context.project.assets, assetId);
          if (committedAsset !== undefined) {
            const committedDirectory = path.join(context.projectDir, committedAsset.managedAsset.collection);
            const committedPath = path.join(committedDirectory, committedAsset.managedAsset.fileName);
            if (
              STUDIO_MANAGED_ASSET_COLLECTIONS_V2.has(committedAsset.managedAsset.collection) &&
              path.dirname(committedDirectory) === context.projectDir &&
              path.dirname(committedPath) === committedDirectory &&
              committedPath === candidate.filePath
            ) {
              try {
                // An ambiguous post-rename failure may already have committed this exact asset.
                // Preserve it only when the current record and exact owned inode still agree.
                // eslint-disable-next-line no-await-in-loop
                await captureManagedFileProofV2(candidate.filePath, candidate.identity, committedAsset);
                return;
              } catch {
                // A same-id stale record must not retain a different uncommitted inode.
              }
            }
          }
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

  const syncVerifiedDirectoryV2 = async (directory: VerifiedDirectory): Promise<void> => {
    await assertVerifiedDirectory(directory);
    const handle = await fs.open(directory.directory, 'r');
    try {
      const opened = await handle.stat();
      const openedIdentity = fileIdentity(opened);
      if (
        !opened.isDirectory() ||
        openedIdentity.dev !== directory.identity.dev ||
        openedIdentity.ino !== directory.identity.ino
      ) {
        throw new CreativeStudioMediaError('storage_error');
      }
      await handle.sync();
      await deps.afterV2ManagedDirectorySync?.(directory.directory);
    } catch (error) {
      if (error instanceof CreativeStudioMediaError) throw error;
      throw new CreativeStudioMediaError('storage_error');
    } finally {
      await handle.close().catch((): undefined => undefined);
    }
  };

  const quarantineRemoveExactManagedPathV2 = async (
    authority: StudioProjectPathAuthorityV2,
    filePath: string,
    identity: FileIdentity,
    directory: VerifiedDirectory
  ): Promise<void> => {
    if (path.dirname(filePath) !== directory.directory) throw new CreativeStudioMediaError('storage_error');
    const quarantinePath = `${filePath}.bed-quarantine`;
    if (path.dirname(quarantinePath) !== directory.directory) throw new CreativeStudioMediaError('storage_error');
    let moved = false;
    try {
      await assertV2ManagedMutation(authority, [directory]);
      const before = await regularFile(filePath);
      const beforeIdentity = fileIdentity(before);
      if (
        beforeIdentity.dev !== identity.dev ||
        beforeIdentity.ino !== identity.ino ||
        (await fs.realpath(filePath)) !== filePath
      ) {
        throw new CreativeStudioMediaError('storage_error');
      }
      try {
        await fs.lstat(quarantinePath);
        throw new CreativeStudioMediaError('storage_error');
      } catch (error) {
        if (error instanceof CreativeStudioMediaError) throw error;
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new CreativeStudioMediaError('storage_error');
      }
      await fs.rename(filePath, quarantinePath);
      moved = true;
      const quarantined = await regularFile(quarantinePath);
      const quarantinedIdentity = fileIdentity(quarantined);
      if (
        quarantinedIdentity.dev !== identity.dev ||
        quarantinedIdentity.ino !== identity.ino ||
        (await fs.realpath(quarantinePath)) !== quarantinePath
      ) {
        throw new CreativeStudioMediaError('storage_error');
      }
      try {
        await fs.lstat(filePath);
        throw new CreativeStudioMediaError('storage_error');
      } catch (error) {
        if (error instanceof CreativeStudioMediaError) throw error;
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new CreativeStudioMediaError('storage_error');
      }
      await syncVerifiedDirectoryV2(directory);
      await assertV2ManagedMutation(authority, [directory]);
      const finalQuarantine = await regularFile(quarantinePath);
      const finalIdentity = fileIdentity(finalQuarantine);
      if (finalIdentity.dev !== identity.dev || finalIdentity.ino !== identity.ino) {
        throw new CreativeStudioMediaError('storage_error');
      }
      await fs.unlink(quarantinePath);
      moved = false;
      await syncVerifiedDirectoryV2(directory);
    } catch (error) {
      if (moved) {
        try {
          const quarantined = await regularFile(quarantinePath);
          const quarantinedIdentity = fileIdentity(quarantined);
          if (quarantinedIdentity.dev === identity.dev && quarantinedIdentity.ino === identity.ino) {
            try {
              await fs.link(quarantinePath, filePath);
              await syncVerifiedDirectoryV2(directory);
            } catch {
              // A replacement or changed authority leaves the exact quarantine and journal for repair.
            }
          }
        } catch {
          // Preserve every unverifiable residue and fail loud through the durable journal.
        }
      }
      if (error instanceof CreativeStudioMediaError) throw error;
      throw new CreativeStudioMediaError('storage_error');
    }
  };

  const publishBedMediaIntentV2 = async (
    authority: StudioProjectPathAuthorityV2,
    partsDirectory: VerifiedDirectory,
    intent: StudioBedMediaIntentV2
  ): Promise<PublishedStudioBedMediaIntentV2> => {
    if (!isStudioBedMediaIntentV2(intent)) throw new CreativeStudioMediaError('storage_error');
    const filePath = path.join(partsDirectory.directory, bedMediaIntentFileNameV2(intent));
    const temporaryPath = path.join(
      partsDirectory.directory,
      `.${intent.asset.id}.${process.pid}_${randomUUID().replaceAll('-', '_')}.bed-intent.tmp`
    );
    if (
      path.dirname(filePath) !== partsDirectory.directory ||
      path.dirname(temporaryPath) !== partsDirectory.directory
    ) {
      throw new CreativeStudioMediaError('storage_error');
    }
    const bytes = Buffer.from(`${JSON.stringify(intent)}\n`, 'utf8');
    if (bytes.length < 2 || bytes.length > BED_MEDIA_INTENT_MAX_BYTES) {
      throw new CreativeStudioMediaError('storage_error');
    }
    let temporaryIdentity: FileIdentity | null = null;
    let publishedIdentity: FileIdentity | null = null;
    try {
      await assertV2ManagedMutation(authority, [partsDirectory]);
      try {
        await fs.lstat(filePath);
        throw new CreativeStudioMediaError('storage_error');
      } catch (error) {
        if (error instanceof CreativeStudioMediaError) throw error;
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new CreativeStudioMediaError('storage_error');
      }
      const handle = await fs.open(temporaryPath, 'wx');
      try {
        const opened = await handle.stat();
        if (!opened.isFile()) throw new CreativeStudioMediaError('storage_error');
        temporaryIdentity = fileIdentity(opened);
        await handle.writeFile(bytes);
        await handle.sync();
        const completed = await handle.stat();
        const completedIdentity = fileIdentity(completed);
        if (
          completedIdentity.dev !== temporaryIdentity.dev ||
          completedIdentity.ino !== temporaryIdentity.ino ||
          completed.size !== bytes.length
        ) {
          throw new CreativeStudioMediaError('storage_error');
        }
      } finally {
        await handle.close().catch((): undefined => undefined);
      }
      await assertV2ManagedMutation(authority, [partsDirectory]);
      await fs.link(temporaryPath, filePath);
      const published = await regularFile(filePath);
      publishedIdentity = fileIdentity(published);
      if (
        publishedIdentity.dev !== temporaryIdentity.dev ||
        publishedIdentity.ino !== temporaryIdentity.ino ||
        published.size !== bytes.length
      ) {
        throw new CreativeStudioMediaError('storage_error');
      }
      await syncVerifiedDirectoryV2(partsDirectory);
      await fs.unlink(temporaryPath);
      temporaryIdentity = null;
      await syncVerifiedDirectoryV2(partsDirectory);
      return { intent, filePath, identity: publishedIdentity, directory: partsDirectory };
    } catch (error) {
      if (publishedIdentity !== null) {
        await unlinkIfIdentityMatches(filePath, publishedIdentity).catch((): undefined => undefined);
      }
      if (temporaryIdentity !== null) {
        await unlinkIfIdentityMatches(temporaryPath, temporaryIdentity).catch((): undefined => undefined);
      }
      return mapStoreError(error);
    }
  };

  const readBedMediaIntentV2 = async (
    filePath: string,
    partsDirectory: VerifiedDirectory
  ): Promise<PublishedStudioBedMediaIntentV2> => {
    if (path.dirname(filePath) !== partsDirectory.directory) throw new CreativeStudioMediaError('storage_error');
    const pathStats = await regularFile(filePath);
    if (
      Number(pathStats.size) < 2 ||
      Number(pathStats.size) > BED_MEDIA_INTENT_MAX_BYTES ||
      (await fs.realpath(filePath)) !== filePath
    ) {
      throw new CreativeStudioMediaError('storage_error');
    }
    const identity = fileIdentity(pathStats);
    const noFollow = process.platform === 'win32' ? 0 : fsConstants.O_NOFOLLOW;
    const handle = await fs.open(filePath, fsConstants.O_RDONLY | noFollow);
    try {
      const before = await handle.stat();
      const beforeIdentity = fileIdentity(before);
      if (
        !before.isFile() ||
        beforeIdentity.dev !== identity.dev ||
        beforeIdentity.ino !== identity.ino ||
        before.size !== pathStats.size
      ) {
        throw new CreativeStudioMediaError('storage_error');
      }
      const bytes = await handle.readFile();
      const after = await handle.stat();
      const afterIdentity = fileIdentity(after);
      if (
        afterIdentity.dev !== identity.dev ||
        afterIdentity.ino !== identity.ino ||
        after.size !== before.size ||
        after.mtimeMs !== before.mtimeMs ||
        after.ctimeMs !== before.ctimeMs ||
        bytes.length !== before.size
      ) {
        throw new CreativeStudioMediaError('storage_error');
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(bytes.toString('utf8')) as unknown;
      } catch {
        throw new CreativeStudioMediaError('storage_error');
      }
      if (!isStudioBedMediaIntentV2(parsed) || bedMediaIntentFileNameV2(parsed) !== path.basename(filePath)) {
        throw new CreativeStudioMediaError('storage_error');
      }
      return { intent: parsed, filePath, identity, directory: partsDirectory };
    } finally {
      await handle.close().catch((): undefined => undefined);
    }
  };

  const resolveIntentManagedBedV2 = async (
    context: Awaited<ReturnType<typeof loadProjectContextV2>>,
    intent: StudioBedMediaIntentV2,
    required: boolean
  ): Promise<{ files: Array<{ filePath: string; identity: FileIdentity }>; directory: VerifiedDirectory } | null> => {
    const importsDir = path.join(context.projectDir, 'imports');
    let importsStats: Awaited<ReturnType<typeof fs.lstat>>;
    try {
      importsStats = await fs.lstat(importsDir);
    } catch (error) {
      if (!required && (error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw new CreativeStudioMediaError('storage_error');
    }
    if (
      !importsStats.isDirectory() ||
      importsStats.isSymbolicLink() ||
      (await fs.realpath(importsDir)) !== importsDir
    ) {
      throw new CreativeStudioMediaError('storage_error');
    }
    const directory: VerifiedDirectory = { directory: importsDir, identity: fileIdentity(importsStats) };
    await assertV2ManagedMutation(context.authority, [directory]);
    const filePath = path.join(importsDir, intent.asset.managedAsset.fileName);
    if (path.dirname(filePath) !== importsDir) throw new CreativeStudioMediaError('storage_error');
    const verifyCandidate = async (
      candidatePath: string
    ): Promise<{ filePath: string; identity: FileIdentity } | null> => {
      let stats: Awaited<ReturnType<typeof fs.lstat>>;
      try {
        stats = await fs.lstat(candidatePath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw new CreativeStudioMediaError('storage_error');
      }
      const identity = fileIdentity(stats);
      if (
        !stats.isFile() ||
        stats.isSymbolicLink() ||
        (await fs.realpath(candidatePath)) !== candidatePath ||
        identity.dev !== intent.managedIdentity.dev ||
        identity.ino !== intent.managedIdentity.ino ||
        Number(stats.size) !== intent.asset.byteSize
      ) {
        throw new CreativeStudioMediaError('storage_error');
      }
      const stream = await openVerifiedReadStream(candidatePath, undefined, undefined, undefined, {
        ...identity,
        byteSize: intent.asset.byteSize,
        mtimeMs: stats.mtimeMs,
        ctimeMs: stats.ctimeMs,
        sha256: intent.asset.sha256,
        mimeType: intent.asset.mimeType,
      });
      let observedBytes = 0;
      for await (const chunk of stream) observedBytes += Buffer.from(chunk).length;
      if (observedBytes !== intent.asset.byteSize) throw new CreativeStudioMediaError('storage_error');
      return { filePath: candidatePath, identity };
    };
    let canonical = await verifyCandidate(filePath);
    const quarantinePath = `${filePath}.bed-quarantine`;
    const quarantine = await verifyCandidate(quarantinePath);
    if (canonical === null && quarantine === null) {
      if (required) throw new CreativeStudioMediaError('storage_error');
      return null;
    }
    if (required && canonical === null) {
      await assertV2ManagedMutation(context.authority, [directory]);
      await fs.link(quarantine!.filePath, filePath);
      await syncVerifiedDirectoryV2(directory);
      canonical = await verifyCandidate(filePath);
      if (canonical === null) throw new CreativeStudioMediaError('storage_error');
    }
    if (required && quarantine !== null) {
      await assertV2ManagedMutation(context.authority, [directory]);
      const current = await regularFile(quarantine.filePath);
      const currentIdentity = fileIdentity(current);
      if (currentIdentity.dev !== quarantine.identity.dev || currentIdentity.ino !== quarantine.identity.ino) {
        throw new CreativeStudioMediaError('storage_error');
      }
      await fs.unlink(quarantine.filePath);
      await syncVerifiedDirectoryV2(directory);
    }
    return {
      files: required ? [canonical!] : [quarantine, canonical].filter((value) => value !== null),
      directory,
    };
  };

  const removePublishedBedMediaIntentV2 = async (
    context: Awaited<ReturnType<typeof loadProjectContextV2>>,
    published: PublishedStudioBedMediaIntentV2
  ): Promise<void> => {
    const partsDir = path.join(context.projectDir, 'parts');
    if (path.dirname(published.filePath) !== partsDir) throw new CreativeStudioMediaError('storage_error');
    const partsDirectory = await captureManagedDirectoryV2(context.authority, partsDir);
    await quarantineRemoveExactManagedPathV2(context.authority, published.filePath, published.identity, partsDirectory);
  };

  const repairPublishedBedMediaIntentV2 = async (published: PublishedStudioBedMediaIntentV2): Promise<void> => {
    const context = await loadProjectContextV2(published.intent.projectId);
    const { intent } = published;
    const liveAsset = ownRecordValue(context.project.assets, intent.asset.id);
    if (liveAsset !== undefined) {
      if (
        context.project.revision < intent.expectedRevision ||
        !isCanonicalBedAudioAssetV2(context.project, liveAsset) ||
        !sameCanonicalBedAudioAssetV2(liveAsset, intent.asset) ||
        (intent.kind === 'import_bed_audio' && context.project.revision < intent.expectedRevision + 1)
      ) {
        throw new CreativeStudioMediaError('storage_error');
      }
      await resolveIntentManagedBedV2(context, intent, true);
      await removePublishedBedMediaIntentV2(context, published);
      return;
    }
    if (intent.kind === 'detach_bed_audio' && context.project.revision < intent.expectedRevision + 1) {
      throw new CreativeStudioMediaError('storage_error');
    }
    const managed = await resolveIntentManagedBedV2(context, intent, false);
    if (managed !== null) {
      for (const candidate of managed.files) {
        // eslint-disable-next-line no-await-in-loop
        await quarantineRemoveExactManagedPathV2(
          context.authority,
          candidate.filePath,
          candidate.identity,
          managed.directory
        );
      }
    }
    await removePublishedBedMediaIntentV2(context, published);
  };

  async function importSeedStillFromPathV2(
    input: InternalImportSeedStillInputV2 & { returnProject: true }
  ): Promise<StudioMediaImportResultV2>;
  async function importSeedStillFromPathV2(input: InternalImportSeedStillInputV2): Promise<StudioAssetV2>;
  async function importSeedStillFromPathV2(
    input: InternalImportSeedStillInputV2
  ): Promise<StudioAssetV2 | StudioMediaImportResultV2> {
    if (
      (!hasExactOwnKeys(input, ['projectId', 'sourcePath', 'shotId', 'expectedRevision']) &&
        !hasExactOwnKeys(input, ['projectId', 'sourcePath', 'shotId', 'expectedRevision', 'returnProject'])) ||
      !SAFE_ID.test(input.projectId) ||
      !SAFE_ID.test(input.shotId) ||
      !Number.isSafeInteger(input.expectedRevision) ||
      input.expectedRevision < 1 ||
      typeof input.sourcePath !== 'string' ||
      input.sourcePath.length === 0 ||
      (input.returnProject !== undefined && input.returnProject !== true)
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
      if (!Object.hasOwn(project.shots, input.shotId)) throw new CreativeStudioMediaError('not_found');
      if (owningBeatForShotV2(project, input.shotId) === null) {
        throw new CreativeStudioMediaError('invalid_media');
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
        shotId: input.shotId,
        mediaKind: 'image',
        mimeType: signature.mimeType,
        managedAsset: { collection: 'imports', fileName: `${assetId}.${signature.extension}` },
        byteSize,
        sha256: hash.digest('hex'),
        projectReferenceId: null,
        generationReferenceAssetIds: [],
        producerJobId: null,
        compositionDigest: null,
        createdAt: now(),
      };
      if (finalPath === null || finalIdentity === null) throw new CreativeStudioMediaError('storage_error');
      const importedFilePath = finalPath;
      const importedFileProof = await captureManagedFileProofV2(importedFilePath, finalIdentity, baseAsset);
      let importedAsset: StudioAssetV2 | null = null;
      await assertV2ManagedMutation(authority, [importsDirectory]);
      const updatedProject = await withManagedProjectAuthority(input.projectId, async (projectAuthority, facts) => {
        if (projectAuthority.projectDir !== projectDir) throw new CreativeStudioMediaError('storage_error');
        await projectAuthority.assertCurrent?.();
        await assertV2ManagedMutation(authority, [importsDirectory]);
        assertManagedProjectCapacity(projectAuthority.project, facts.managedByteSize, byteSize);
        return projectAuthority.commit(
          (current) => {
            assertManagedProjectCapacity(current, facts.managedByteSize, byteSize);
            const next = structuredClone(current);
            if (owningBeatForShotV2(current, input.shotId) === null) {
              throw new CreativeStudioMediaError('invalid_media');
            }
            const asset: StudioAssetV2 = baseAsset;
            defineRecordValue(next.assets, asset.id, asset);
            if (asset.shotId !== null) {
              const shot = ownRecordValue(next.shots, asset.shotId);
              if (shot === undefined) throw new CreativeStudioMediaError('not_found');
              shot.assetIds.push(asset.id);
            }
            importedAsset = asset;
            return next;
          },
          input.expectedRevision,
          undefined,
          async () => {
            assertOperationActive();
            await assertManagedFileProofV2(importedFilePath, importedFileProof);
          }
        );
      });
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

  const importBedAudioFromPathV2 = async (input: InternalImportBedAudioInputV2): Promise<StudioMediaImportResultV2> => {
    if (
      (!hasExactOwnKeys(input, ['projectId', 'sourcePath', 'expectedRevision']) &&
        !hasExactOwnKeys(input, ['projectId', 'sourcePath', 'expectedRevision', 'assertActive'])) ||
      !SAFE_ID.test(input.projectId) ||
      typeof input.sourcePath !== 'string' ||
      input.sourcePath.length === 0 ||
      !Number.isSafeInteger(input.expectedRevision) ||
      input.expectedRevision < 1 ||
      (input.assertActive !== undefined && typeof input.assertActive !== 'function')
    ) {
      throw new CreativeStudioMediaError('invalid_media');
    }
    assertOperationActive(input.assertActive);
    const assetId = createId();
    const mutationId = createMutationId();
    if (!SAFE_ID.test(assetId) || !SAFE_ID.test(mutationId)) {
      throw new CreativeStudioMediaError('storage_error');
    }

    let partPath: string | null = null;
    let partIdentity: FileIdentity | null = null;
    let finalPath: string | null = null;
    let finalIdentity: FileIdentity | null = null;
    let publishedIntent: PublishedStudioBedMediaIntentV2 | null = null;
    let projectCommitAttempted = false;
    let authority: StudioProjectPathAuthorityV2 | null = null;
    try {
      const sourceStats = await regularFile(input.sourcePath);
      const sourceIdentity = fileIdentity(sourceStats);
      const sourceByteSize = Number(sourceStats.size);
      if (!Number.isSafeInteger(sourceByteSize) || sourceByteSize < 1) {
        throw new CreativeStudioMediaError('invalid_media');
      }
      const context = await loadProjectContextV2(input.projectId);
      const { projectDir, project } = context;
      authority = context.authority;
      if (project.revision !== input.expectedRevision) throw new CreativeStudioMediaError('stale_project');
      const capacity = await planWriteCapacity(project, projectDir, limits.videoOutputMaxBytes, sourceByteSize);
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
        const sourceStream = await openVerifiedReadStream(input.sourcePath, undefined, undefined, async () => {
          const current = await regularFile(input.sourcePath);
          const currentIdentity = fileIdentity(current);
          if (
            currentIdentity.dev !== sourceIdentity.dev ||
            currentIdentity.ino !== sourceIdentity.ino ||
            Number(current.size) !== sourceByteSize ||
            current.mtimeMs !== sourceStats.mtimeMs ||
            current.ctimeMs !== sourceStats.ctimeMs
          ) {
            throw new CreativeStudioMediaError('invalid_media');
          }
        });
        await pipeline(sourceStream, checker, createWriteStream(partPath, { fd: partHandle.fd, autoClose: false }));
      } finally {
        await partHandle.close().catch((): undefined => undefined);
      }
      const currentSource = await regularFile(input.sourcePath);
      const currentSourceIdentity = fileIdentity(currentSource);
      if (
        currentSourceIdentity.dev !== sourceIdentity.dev ||
        currentSourceIdentity.ino !== sourceIdentity.ino ||
        Number(currentSource.size) !== sourceByteSize ||
        currentSource.mtimeMs !== sourceStats.mtimeMs ||
        currentSource.ctimeMs !== sourceStats.ctimeMs
      ) {
        throw new CreativeStudioMediaError('invalid_media');
      }
      await assertV2ManagedMutation(authority, [partsDirectory]);
      const completedPart = await regularFile(partPath);
      const completedPartIdentity = fileIdentity(completedPart);
      if (
        completedPartIdentity.dev !== partIdentity.dev ||
        completedPartIdentity.ino !== partIdentity.ino ||
        completedPart.size !== byteSize ||
        byteSize < 12
      ) {
        throw new CreativeStudioMediaError('invalid_media');
      }
      const signature = sniff(sample);
      if (signature?.mimeType !== 'audio/wav') throw new CreativeStudioMediaError('invalid_media');
      const sha256 = hash.digest('hex');
      const probe = await probeBedAudioV2({ filePath: partPath, byteSize, sha256 });
      if (
        probe.audioStreamCount !== 1 ||
        probe.otherStreamCount !== 0 ||
        !Number.isFinite(probe.durationSeconds) ||
        probe.durationSeconds <= 0 ||
        probe.durationSeconds > Number.MAX_SAFE_INTEGER
      ) {
        throw new CreativeStudioMediaError('invalid_media');
      }
      assertOperationActive(input.assertActive);
      await assertV2ManagedMutation(authority, [partsDirectory, importsDirectory]);
      finalPath = path.join(importsDir, `${assetId}.wav`);
      if (path.dirname(finalPath) !== importsDir) throw new CreativeStudioMediaError('storage_error');
      const capturedAt = now();
      const importedAsset: StudioAssetV2 = {
        id: assetId,
        projectId: input.projectId,
        shotId: null,
        mediaKind: 'audio',
        mimeType: 'audio/wav',
        managedAsset: { collection: 'imports', fileName: `${assetId}.wav` },
        byteSize,
        sha256,
        durationSeconds: probe.durationSeconds,
        projectReferenceId: null,
        generationReferenceAssetIds: [],
        producerJobId: null,
        compositionDigest: null,
        createdAt: capturedAt,
      };
      if (partPath === null || partIdentity === null || finalPath === null) {
        throw new CreativeStudioMediaError('storage_error');
      }
      const stagedPartPath = partPath;
      const stagedPartIdentity = partIdentity;
      const intendedFinalPath = finalPath;
      const updatedProject = await withManagedProjectAuthority(input.projectId, async (projectAuthority, facts) => {
        if (
          projectAuthority.projectDir !== projectDir ||
          projectAuthority.project.revision !== input.expectedRevision
        ) {
          throw new CreativeStudioMediaError('stale_project');
        }
        assertOperationActive(input.assertActive);
        const finalSource = await regularFile(input.sourcePath);
        const finalSourceIdentity = fileIdentity(finalSource);
        if (
          finalSourceIdentity.dev !== sourceIdentity.dev ||
          finalSourceIdentity.ino !== sourceIdentity.ino ||
          Number(finalSource.size) !== sourceByteSize ||
          finalSource.mtimeMs !== sourceStats.mtimeMs ||
          finalSource.ctimeMs !== sourceStats.ctimeMs
        ) {
          throw new CreativeStudioMediaError('invalid_media');
        }
        await projectAuthority.assertCurrent?.();
        await assertV2ManagedMutation(authority, [partsDirectory, importsDirectory]);
        assertManagedProjectCapacity(projectAuthority.project, facts.managedByteSize, byteSize);
        publishedIntent = await publishBedMediaIntentV2(authority, partsDirectory, {
          schemaVersion: STUDIO_BED_MEDIA_INTENT_SCHEMA_VERSION,
          kind: 'import_bed_audio',
          projectId: input.projectId,
          expectedRevision: input.expectedRevision,
          asset: importedAsset,
          managedIdentity: stagedPartIdentity,
        });
        finalIdentity = await finalizeManagedPartV2(
          stagedPartPath,
          partsDir,
          intendedFinalPath,
          importsDir,
          stagedPartIdentity,
          () => assertV2ManagedMutation(authority!, [partsDirectory, importsDirectory]),
          (identity) => {
            finalIdentity = identity;
          },
          {
            syncDestinationDirectory: () => syncVerifiedDirectoryV2(importsDirectory),
            syncPartsDirectory: () => syncVerifiedDirectoryV2(partsDirectory),
          }
        );
        partPath = null;
        partIdentity = null;
        if (finalIdentity === null) throw new CreativeStudioMediaError('storage_error');
        const importedFileProof = await captureManagedFileProofV2(intendedFinalPath, finalIdentity, importedAsset);
        await assertV2ManagedMutation(authority, [importsDirectory]);
        assertOperationActive(input.assertActive);
        projectCommitAttempted = true;
        return projectAuthority.commit(
          (current) => {
            assertOperationActive(input.assertActive);
            if (ownRecordValue(current.assets, assetId) !== undefined) {
              throw new CreativeStudioMediaError('storage_error');
            }
            assertManagedProjectCapacity(current, facts.managedByteSize, byteSize);
            const withAsset = structuredClone(current);
            defineRecordValue(withAsset.assets, assetId, importedAsset);
            return applyStudioMutationBatchV2(
              withAsset,
              {
                schemaVersion: STUDIO_MUTATION_BATCH_SCHEMA_VERSION,
                projectId: current.id,
                expectedRevision: current.revision,
                operations: [{ kind: 'set_bed', assetId }],
              },
              { mutationId, capturedAt }
            ).project;
          },
          input.expectedRevision,
          'import_bed_audio',
          async () => {
            assertOperationActive(input.assertActive);
            await assertManagedFileProofV2(intendedFinalPath, importedFileProof);
          }
        );
      });
      if (publishedIntent !== null) {
        await repairPublishedBedMediaIntentV2(publishedIntent).catch((): undefined => undefined);
      }
      return { asset: importedAsset, project: updatedProject };
    } catch (error) {
      if (!projectCommitAttempted) {
        await cleanupUncommittedManagedPathsV2(input.projectId, assetId, [
          { filePath: partPath, identity: partIdentity },
          { filePath: finalPath, identity: finalIdentity },
        ]);
        if (publishedIntent !== null) {
          await repairPublishedBedMediaIntentV2(publishedIntent).catch((): undefined => undefined);
        }
      }
      return mapStoreError(error);
    }
  };

  const detachBedAudioV2 = async (input: InternalDetachBedAudioInputV2): Promise<StudioProjectV2> => {
    if (
      (!hasExactOwnKeys(input, ['projectId', 'expectedRevision', 'assetId']) &&
        !hasExactOwnKeys(input, ['projectId', 'expectedRevision', 'assetId', 'assertActive'])) ||
      !SAFE_ID.test(input.projectId) ||
      !SAFE_ID.test(input.assetId) ||
      !Number.isSafeInteger(input.expectedRevision) ||
      input.expectedRevision < 1 ||
      (input.assertActive !== undefined && typeof input.assertActive !== 'function')
    ) {
      throw new CreativeStudioMediaError('invalid_media');
    }
    assertOperationActive(input.assertActive);
    const claimKey = bedAudioClaimKey(input.projectId, input.assetId);
    let publishedIntent: PublishedStudioBedMediaIntentV2 | null = null;
    let projectCommitAttempted = false;
    try {
      const { projectDir, project, authority } = await loadProjectContextV2(input.projectId);
      if (project.revision !== input.expectedRevision) throw new CreativeStudioMediaError('stale_project');
      const asset = ownRecordValue(project.assets, input.assetId);
      if (asset === undefined) throw new CreativeStudioMediaError('not_found');
      if (!isCanonicalBedAudioAssetV2(project, asset)) throw new CreativeStudioMediaError('invalid_media');
      if (project.bedAssetId === asset.id) throw new CreativeStudioMediaError('media_in_use');
      if ((activeBedAudioReadClaims.get(claimKey) ?? 0) > 0 || detachingBedAudio.has(claimKey)) {
        throw new CreativeStudioMediaError('media_in_use');
      }

      const resolved = await resolveAssetV2(input.projectId, input.assetId);
      if (
        resolved === null ||
        !isCanonicalBedAudioAssetV2(project, resolved.asset) ||
        !sameCanonicalBedAudioAssetV2(asset, resolved.asset)
      ) {
        throw new CreativeStudioMediaError('storage_error');
      }
      const importsDir = path.join(projectDir, 'imports');
      const managedFile = path.join(importsDir, asset.managedAsset.fileName);
      if (path.dirname(managedFile) !== importsDir) throw new CreativeStudioMediaError('storage_error');
      const importsDirectory = await captureManagedDirectoryV2(authority, importsDir);
      const before = await regularFile(managedFile);
      if ((await fs.realpath(managedFile)) !== managedFile) throw new CreativeStudioMediaError('storage_error');
      const managedIdentity = fileIdentity(before);
      let observedBytes = 0;
      for await (const chunk of await resolved.openVerifiedStream()) observedBytes += Buffer.from(chunk).length;
      if (observedBytes !== asset.byteSize) throw new CreativeStudioMediaError('storage_error');
      const after = await regularFile(managedFile);
      const afterIdentity = fileIdentity(after);
      if (
        afterIdentity.dev !== managedIdentity.dev ||
        afterIdentity.ino !== managedIdentity.ino ||
        after.size !== before.size ||
        after.mtimeMs !== before.mtimeMs ||
        after.ctimeMs !== before.ctimeMs
      ) {
        throw new CreativeStudioMediaError('storage_error');
      }
      const managedFileProof = await captureManagedFileProofV2(managedFile, managedIdentity, asset);
      assertOperationActive(input.assertActive);
      if ((activeBedAudioReadClaims.get(claimKey) ?? 0) > 0 || detachingBedAudio.has(claimKey)) {
        throw new CreativeStudioMediaError('media_in_use');
      }
      const partsDirectory = await ensureManagedDirectoryV2(authority, 'parts');
      const updated = await withManagedProjectAuthority(input.projectId, async (projectAuthority) => {
        if (
          projectAuthority.projectDir !== projectDir ||
          projectAuthority.project.revision !== input.expectedRevision
        ) {
          throw new CreativeStudioMediaError('stale_project');
        }
        await projectAuthority.assertCurrent?.();
        await assertV2ManagedMutation(authority, [importsDirectory]);
        assertOperationActive(input.assertActive);
        if ((activeBedAudioReadClaims.get(claimKey) ?? 0) > 0 || detachingBedAudio.has(claimKey)) {
          throw new CreativeStudioMediaError('media_in_use');
        }
        const currentAsset = ownRecordValue(projectAuthority.project.assets, input.assetId);
        if (
          currentAsset === undefined ||
          !isCanonicalBedAudioAssetV2(projectAuthority.project, currentAsset) ||
          !sameCanonicalBedAudioAssetV2(asset, currentAsset)
        ) {
          throw new CreativeStudioMediaError('invalid_media');
        }
        if (projectAuthority.project.bedAssetId === input.assetId) {
          throw new CreativeStudioMediaError('media_in_use');
        }
        const currentManaged = await regularFile(managedFile);
        const currentManagedIdentity = fileIdentity(currentManaged);
        if (
          currentManagedIdentity.dev !== managedIdentity.dev ||
          currentManagedIdentity.ino !== managedIdentity.ino ||
          currentManaged.size !== before.size ||
          currentManaged.mtimeMs !== before.mtimeMs ||
          currentManaged.ctimeMs !== before.ctimeMs
        ) {
          throw new CreativeStudioMediaError('storage_error');
        }
        publishedIntent = await publishBedMediaIntentV2(authority, partsDirectory, {
          schemaVersion: STUDIO_BED_MEDIA_INTENT_SCHEMA_VERSION,
          kind: 'detach_bed_audio',
          projectId: input.projectId,
          expectedRevision: input.expectedRevision,
          asset,
          managedIdentity,
        });
        detachingBedAudio.add(claimKey);
        projectCommitAttempted = true;
        return projectAuthority.commit(
          (current) => {
            assertOperationActive(input.assertActive);
            if ((activeBedAudioReadClaims.get(claimKey) ?? 0) > 0 || !detachingBedAudio.has(claimKey)) {
              throw new CreativeStudioMediaError('media_in_use');
            }
            const committedAsset = ownRecordValue(current.assets, input.assetId);
            if (committedAsset === undefined) throw new CreativeStudioMediaError('not_found');
            if (
              !isCanonicalBedAudioAssetV2(current, committedAsset) ||
              !sameCanonicalBedAudioAssetV2(asset, committedAsset)
            ) {
              throw new CreativeStudioMediaError('invalid_media');
            }
            if (current.bedAssetId === input.assetId) throw new CreativeStudioMediaError('media_in_use');
            const next = structuredClone(current);
            delete next.assets[input.assetId];
            return next;
          },
          input.expectedRevision,
          'detach_bed_audio',
          async () => {
            assertOperationActive(input.assertActive);
            if ((activeBedAudioReadClaims.get(claimKey) ?? 0) > 0 || !detachingBedAudio.has(claimKey)) {
              throw new CreativeStudioMediaError('media_in_use');
            }
            await assertManagedFileProofV2(managedFile, managedFileProof);
          }
        );
      });
      if (publishedIntent !== null) {
        await repairPublishedBedMediaIntentV2(publishedIntent).catch((): undefined => undefined);
      }
      return updated;
    } catch (error) {
      if (!projectCommitAttempted && publishedIntent !== null) {
        await repairPublishedBedMediaIntentV2(publishedIntent).catch((): undefined => undefined);
      }
      return mapStoreError(error);
    } finally {
      detachingBedAudio.delete(claimKey);
    }
  };

  const captureOrphanBoardFileV2 = async (
    authority: StudioProjectPathAuthorityV2,
    directory: VerifiedDirectory,
    filePath: string
  ): Promise<FileIdentity> => {
    if (path.dirname(filePath) !== directory.directory) throw new CreativeStudioMediaError('storage_error');
    await assertV2ManagedMutation(authority, [directory]);
    const pathStats = await fs.lstat(filePath);
    const pathIdentity = fileIdentity(pathStats);
    if (
      !pathStats.isFile() ||
      pathStats.isSymbolicLink() ||
      pathStats.nlink !== 1 ||
      (await fs.realpath(filePath)) !== filePath
    ) {
      throw new CreativeStudioMediaError('storage_error');
    }
    const noFollow = process.platform === 'win32' ? 0 : fsConstants.O_NOFOLLOW;
    let handle: Awaited<ReturnType<typeof fs.open>>;
    try {
      handle = await fs.open(filePath, fsConstants.O_RDONLY | noFollow);
    } catch {
      throw new CreativeStudioMediaError('storage_error');
    }
    try {
      const opened = await handle.stat();
      const openedIdentity = fileIdentity(opened);
      if (
        !opened.isFile() ||
        opened.nlink !== 1 ||
        openedIdentity.dev !== pathIdentity.dev ||
        openedIdentity.ino !== pathIdentity.ino ||
        opened.size !== pathStats.size ||
        opened.mtimeMs !== pathStats.mtimeMs ||
        opened.ctimeMs !== pathStats.ctimeMs
      ) {
        throw new CreativeStudioMediaError('storage_error');
      }
      await assertV2ManagedMutation(authority, [directory]);
      const finalPathStats = await fs.lstat(filePath);
      const finalPathIdentity = fileIdentity(finalPathStats);
      if (
        !finalPathStats.isFile() ||
        finalPathStats.isSymbolicLink() ||
        finalPathStats.nlink !== 1 ||
        finalPathIdentity.dev !== openedIdentity.dev ||
        finalPathIdentity.ino !== openedIdentity.ino ||
        finalPathStats.size !== opened.size ||
        finalPathStats.mtimeMs !== opened.mtimeMs ||
        finalPathStats.ctimeMs !== opened.ctimeMs ||
        (await fs.realpath(filePath)) !== filePath
      ) {
        throw new CreativeStudioMediaError('storage_error');
      }
      return openedIdentity;
    } finally {
      await handle.close().catch((): undefined => undefined);
    }
  };

  const cleanupOrphanBoardStillsV2 = async (
    context: Awaited<ReturnType<typeof loadProjectContextV2>>
  ): Promise<void> => {
    const boardDirectoryPath = path.join(context.projectDir, 'boardStills');
    let boardDirectoryStats: Awaited<ReturnType<typeof fs.lstat>>;
    try {
      boardDirectoryStats = await fs.lstat(boardDirectoryPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw new CreativeStudioMediaError('storage_error');
    }
    if (
      !boardDirectoryStats.isDirectory() ||
      boardDirectoryStats.isSymbolicLink() ||
      (await fs.realpath(boardDirectoryPath)) !== boardDirectoryPath
    ) {
      throw new CreativeStudioMediaError('storage_error');
    }
    const boardDirectory: VerifiedDirectory = {
      directory: boardDirectoryPath,
      identity: fileIdentity(boardDirectoryStats),
    };
    await assertV2ManagedMutation(context.authority, [boardDirectory]);
    const referencedFileNames = new Set(
      Object.values(context.project.assets)
        .filter((asset) => asset.managedAsset.collection === 'boardStills')
        .map((asset) => asset.managedAsset.fileName)
    );
    const entries = await fs.readdir(boardDirectoryPath, { withFileTypes: true });
    type RestoredBoardQuarantineLink = {
      directory: VerifiedDirectory;
      filePath: string;
      identity: FileIdentity;
    };
    const quarantinedNameCounts = new Map<string, number>();
    const restoredQuarantineLinks = new Map<string, RestoredBoardQuarantineLink>();
    for (const entry of entries) {
      if (!STUDIO_CLEANUP_QUARANTINE_DIRECTORY.test(entry.name)) continue;
      const quarantinePath = path.join(boardDirectoryPath, entry.name);
      // `unlinkIfIdentityMatches` deliberately quarantines an entry before deciding whether it owns
      // the inode. A crash may therefore leave either an empty private directory or one containing
      // bytes whose ownership was never proved. Empty shells are safe to retire; populated shells
      // must remain quarantined rather than broadening startup cleanup to unknown bytes.
      // eslint-disable-next-line no-await-in-loop -- Every quarantine decision gets a fresh authority fence.
      await assertV2ManagedMutation(context.authority, [boardDirectory]);
      // eslint-disable-next-line no-await-in-loop -- The exact private directory identity is captured before inspection.
      const quarantineStats = await fs.lstat(quarantinePath);
      const quarantineDirectory: VerifiedDirectory = {
        directory: quarantinePath,
        identity: fileIdentity(quarantineStats),
      };
      if (
        !quarantineStats.isDirectory() ||
        quarantineStats.isSymbolicLink() ||
        path.dirname(quarantinePath) !== boardDirectoryPath ||
        // eslint-disable-next-line no-await-in-loop -- Never follow a winning replacement outside Board storage.
        (await fs.realpath(quarantinePath)) !== quarantinePath
      ) {
        throw new CreativeStudioMediaError('storage_error');
      }
      // eslint-disable-next-line no-await-in-loop -- Populated quarantines preserve ambiguous bytes for recovery.
      const quarantineEntries = await fs.readdir(quarantinePath, { withFileTypes: true });
      if (quarantineEntries.length === 0) {
        // eslint-disable-next-line no-await-in-loop -- Re-prove both parent authority and the empty child identity.
        await assertV2ManagedMutation(context.authority, [boardDirectory]);
        // eslint-disable-next-line no-await-in-loop -- A replaced or populated child is preserved and rejected by rmdir.
        await assertVerifiedDirectory(quarantineDirectory);
        try {
          // eslint-disable-next-line no-await-in-loop -- rmdir cannot remove a nonempty race winner.
          await fs.rmdir(quarantinePath);
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          if (code === 'ENOENT' || code === 'ENOTEMPTY' || code === 'EEXIST') continue;
          throw new CreativeStudioMediaError('storage_error');
        }
        // eslint-disable-next-line no-await-in-loop -- Make retirement of the empty shell crash durable.
        await syncVerifiedDirectoryV2(boardDirectory);
        continue;
      }
      for (const quarantineEntry of quarantineEntries) {
        quarantinedNameCounts.set(quarantineEntry.name, (quarantinedNameCounts.get(quarantineEntry.name) ?? 0) + 1);
      }
      if (quarantineEntries.length !== 1) continue;
      const quarantineEntry = quarantineEntries[0]!;
      const quarantinedFilePath = path.join(quarantinePath, quarantineEntry.name);
      if (path.dirname(quarantinedFilePath) !== quarantinePath) throw new CreativeStudioMediaError('storage_error');
      // eslint-disable-next-line no-await-in-loop -- Capture only the exact two-link state created by safe restoration.
      const quarantinedStats = await fs.lstat(quarantinedFilePath);
      const quarantinedIdentity = fileIdentity(quarantinedStats);
      if (
        !quarantinedStats.isFile() ||
        quarantinedStats.isSymbolicLink() ||
        quarantinedStats.nlink !== 2 ||
        // eslint-disable-next-line no-await-in-loop -- A private candidate may not resolve outside its quarantine.
        (await fs.realpath(quarantinedFilePath)) !== quarantinedFilePath
      ) {
        continue;
      }
      // eslint-disable-next-line no-await-in-loop -- Bind the candidate to the still-current quarantine directory.
      await assertVerifiedDirectory(quarantineDirectory);
      if (!restoredQuarantineLinks.has(quarantineEntry.name)) {
        restoredQuarantineLinks.set(quarantineEntry.name, {
          directory: quarantineDirectory,
          filePath: quarantinedFilePath,
          identity: quarantinedIdentity,
        });
      }
    }
    for (const entry of entries) {
      if (STUDIO_CLEANUP_QUARANTINE_DIRECTORY.test(entry.name)) continue;
      const filePath = path.join(boardDirectoryPath, entry.name);
      const quarantineNameCount = quarantinedNameCounts.get(entry.name) ?? 0;
      if (quarantineNameCount > 0) {
        const candidate = quarantineNameCount === 1 ? restoredQuarantineLinks.get(entry.name) : undefined;
        if (referencedFileNames.has(entry.name) || candidate === undefined) {
          throw new CreativeStudioMediaError('storage_error');
        }
        // `unlinkIfIdentityMatches` may have restored an unverified replacement without overwrite and
        // deliberately retained the other link in quarantine. This exact pair remains ambiguous, so
        // recovery only recognizes and preserves it; it never acquires deletion authority over either link.
        // eslint-disable-next-line no-await-in-loop -- Re-prove the project, parent, and private child authority.
        await assertV2ManagedMutation(context.authority, [boardDirectory]);
        // eslint-disable-next-line no-await-in-loop -- The quarantine directory must still be the captured inode.
        await assertVerifiedDirectory(candidate.directory);
        // eslint-disable-next-line no-await-in-loop -- Both paths are inspected together before the preserve decision.
        const [topLevelStats, quarantinedStats, currentQuarantineEntries] = await Promise.all([
          fs.lstat(filePath),
          fs.lstat(candidate.filePath),
          fs.readdir(candidate.directory.directory, { withFileTypes: true }),
        ]);
        const topLevelIdentity = fileIdentity(topLevelStats);
        const quarantinedIdentity = fileIdentity(quarantinedStats);
        if (
          !topLevelStats.isFile() ||
          topLevelStats.isSymbolicLink() ||
          topLevelStats.nlink !== 2 ||
          !quarantinedStats.isFile() ||
          quarantinedStats.isSymbolicLink() ||
          quarantinedStats.nlink !== 2 ||
          currentQuarantineEntries.length !== 1 ||
          currentQuarantineEntries[0]?.name !== entry.name ||
          topLevelIdentity.dev !== candidate.identity.dev ||
          topLevelIdentity.ino !== candidate.identity.ino ||
          quarantinedIdentity.dev !== candidate.identity.dev ||
          quarantinedIdentity.ino !== candidate.identity.ino ||
          // eslint-disable-next-line no-await-in-loop -- Neither preserved hardlink may resolve through a symlinked parent.
          (await fs.realpath(filePath)) !== filePath ||
          // eslint-disable-next-line no-await-in-loop -- The private peer must remain inside the verified quarantine.
          (await fs.realpath(candidate.filePath)) !== candidate.filePath
        ) {
          throw new CreativeStudioMediaError('storage_error');
        }
        // eslint-disable-next-line no-await-in-loop -- Bind the final preserve decision to the captured private directory.
        await assertVerifiedDirectory(candidate.directory);
        continue;
      }
      // eslint-disable-next-line no-await-in-loop -- Every deletion gets a fresh manifest/directory fence.
      const identity = await captureOrphanBoardFileV2(context.authority, boardDirectory, filePath);
      if (referencedFileNames.has(entry.name)) continue;
      // eslint-disable-next-line no-await-in-loop -- Cleanup ownership must remain deterministic and fail closed.
      const outcome = await cleanupManagedPathV2(
        context.authority,
        filePath,
        identity,
        boardDirectory,
        async (ownedPath) => {
          const ownedIdentity = await captureOrphanBoardFileV2(context.authority, boardDirectory, ownedPath);
          if (ownedIdentity.dev !== identity.dev || ownedIdentity.ino !== identity.ino) {
            throw new CreativeStudioMediaError('storage_error');
          }
        }
      );
      if (outcome !== 'completed') throw new CreativeStudioMediaError('storage_error');
      try {
        // eslint-disable-next-line no-await-in-loop -- A winning pathname replacement must be retained and rejected.
        await fs.lstat(filePath);
        throw new CreativeStudioMediaError('storage_error');
      } catch (error) {
        if (error instanceof CreativeStudioMediaError) throw error;
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new CreativeStudioMediaError('storage_error');
      }
      // eslint-disable-next-line no-await-in-loop -- Persist each recovered capacity release before the next candidate.
      await assertV2ManagedMutation(context.authority, [boardDirectory]);
      // eslint-disable-next-line no-await-in-loop -- Directory fsync makes the orphan removal crash durable.
      await syncVerifiedDirectoryV2(boardDirectory);
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
        let entries = await fs.readdir(partsDir, { withFileTypes: true });
        for (const entry of entries) {
          const match = /^(bed-(?:import|detach)-[A-Za-z0-9_-]{1,256}\.json)\.bed-quarantine$/.exec(entry.name);
          if (match === null) continue;
          if (!entry.isFile() || entry.isSymbolicLink()) throw new CreativeStudioMediaError('storage_error');
          const quarantinePath = path.join(partsDir, entry.name);
          const intentPath = path.join(partsDir, match[1]!);
          // eslint-disable-next-line no-await-in-loop
          const quarantineStats = await regularFile(quarantinePath);
          const quarantineIdentity = fileIdentity(quarantineStats);
          try {
            // eslint-disable-next-line no-await-in-loop
            const intentStats = await regularFile(intentPath);
            const intentIdentity = fileIdentity(intentStats);
            if (intentIdentity.dev !== quarantineIdentity.dev || intentIdentity.ino !== quarantineIdentity.ino) {
              throw new CreativeStudioMediaError('storage_error');
            }
          } catch (error) {
            if (error instanceof CreativeStudioMediaError) throw error;
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new CreativeStudioMediaError('storage_error');
            // eslint-disable-next-line no-await-in-loop
            await fs.link(quarantinePath, intentPath);
          }
          // eslint-disable-next-line no-await-in-loop
          await syncVerifiedDirectoryV2(partsDirectory);
          // eslint-disable-next-line no-await-in-loop
          const currentQuarantine = await regularFile(quarantinePath);
          const currentIdentity = fileIdentity(currentQuarantine);
          if (currentIdentity.dev !== quarantineIdentity.dev || currentIdentity.ino !== quarantineIdentity.ino) {
            throw new CreativeStudioMediaError('storage_error');
          }
          // eslint-disable-next-line no-await-in-loop
          await fs.unlink(quarantinePath);
          // eslint-disable-next-line no-await-in-loop
          await syncVerifiedDirectoryV2(partsDirectory);
        }
        // eslint-disable-next-line no-await-in-loop
        entries = await fs.readdir(partsDir, { withFileTypes: true });
        for (const entry of entries) {
          if (!/^bed-(?:import|detach)-[A-Za-z0-9_-]{1,256}\.json$/.test(entry.name)) continue;
          if (!entry.isFile() || entry.isSymbolicLink()) throw new CreativeStudioMediaError('storage_error');
          // eslint-disable-next-line no-await-in-loop
          const published = await readBedMediaIntentV2(path.join(partsDir, entry.name), partsDirectory);
          // eslint-disable-next-line no-await-in-loop
          await repairPublishedBedMediaIntentV2(published);
        }
        await Promise.all(
          entries
            .filter(
              (entry) =>
                entry.name.endsWith('.part') ||
                (/^\.[A-Za-z0-9_-]{1,256}\.[A-Za-z0-9_]+\.bed-intent\.tmp$/.test(entry.name) && entry.isFile())
            )
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
      try {
        // eslint-disable-next-line no-await-in-loop -- Startup recovery remains serialized by project inventory order.
        await cleanupOrphanBoardStillsV2(context);
      } catch (error) {
        if (error instanceof CreativeStudioMediaError) throw error;
        throw new CreativeStudioMediaError('storage_error');
      }
    }
  };

  type StudioAssetResolutionContextV2 = { projectDir: string; project: StudioProjectV2 };
  type StudioAssetResolutionContextLoaderV2 = () => Promise<StudioAssetResolutionContextV2>;

  const resolveAssetFromContextV2 = async (
    context: StudioAssetResolutionContextV2,
    assetId: string,
    loadCurrentContext: StudioAssetResolutionContextLoaderV2
  ): Promise<StudioResolvedAssetV2 | null> => {
    const { projectDir, project } = context;
    const projectId = project.id;
    if (!SAFE_ID.test(projectId) || !SAFE_ID.test(assetId)) return null;
    try {
      const asset = ownRecordValue(project.assets, assetId);
      if (!asset || asset.projectId !== projectId) return null;
      const isBedAudio = isCanonicalBedAudioAssetV2(project, asset);
      const claimKey = bedAudioClaimKey(projectId, assetId);
      if (isBedAudio && detachingBedAudio.has(claimKey)) return null;
      if (!STUDIO_MANAGED_ASSET_COLLECTIONS_V2.has(asset.managedAsset.collection)) return null;
      if (!/^[A-Za-z0-9_-]+\.(?:jpg|png|webp|mp4|webm|wav)$/.test(asset.managedAsset.fileName)) return null;
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
          if (isBedAudio) {
            if (detachingBedAudio.has(claimKey)) throw new CreativeStudioMediaError('storage_error');
            const live = await loadCurrentContext();
            const liveAsset = ownRecordValue(live.project.assets, assetId);
            if (
              liveAsset === undefined ||
              !isCanonicalBedAudioAssetV2(live.project, liveAsset) ||
              !sameCanonicalBedAudioAssetV2(asset, liveAsset) ||
              detachingBedAudio.has(claimKey)
            ) {
              throw new CreativeStudioMediaError('storage_error');
            }
          }
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
            const refreshedContext = await loadCurrentContext();
            const refreshed = await resolveAssetFromContextV2(refreshedContext, assetId, loadCurrentContext);
            if (refreshed === null) throw new CreativeStudioMediaError('storage_error');
          }
          const stream = await openVerifiedReadStream(filePath, start, end, undefined, expectation);
          if (!isBedAudio) return stream;
          if (detachingBedAudio.has(claimKey)) {
            stream.destroy();
            throw new CreativeStudioMediaError('storage_error');
          }
          activeBedAudioReadClaims.set(claimKey, (activeBedAudioReadClaims.get(claimKey) ?? 0) + 1);
          let released = false;
          const release = (): void => {
            if (released) return;
            released = true;
            const remaining = (activeBedAudioReadClaims.get(claimKey) ?? 1) - 1;
            if (remaining <= 0) activeBedAudioReadClaims.delete(claimKey);
            else activeBedAudioReadClaims.set(claimKey, remaining);
          };
          stream.once('end', release);
          stream.once('error', release);
          stream.once('close', release);
          return stream;
        },
      };
    } catch (error) {
      if (error instanceof CreativeStudioStoreError) throw error;
      return null;
    }
  };

  const resolveAssetV2 = async (projectId: string, assetId: string): Promise<StudioResolvedAssetV2 | null> => {
    if (!SAFE_ID.test(projectId) || !SAFE_ID.test(assetId)) return null;
    const loadCurrentContext = async (): Promise<StudioAssetResolutionContextV2> => {
      const { projectDir, project } = await loadProjectContextV2(projectId);
      return { projectDir, project };
    };
    return resolveAssetFromContextV2(await loadCurrentContext(), assetId, loadCurrentContext);
  };

  const resolveAssetWithProjectAuthorityV2 = async (
    authority: Pick<StudioProjectAuthoritySnapshotV2, 'project' | 'projectDir' | 'assertCurrent'>,
    assetId: string
  ): Promise<StudioResolvedAssetV2 | null> => {
    if (
      !SAFE_ID.test(assetId) ||
      !SAFE_ID.test(authority.project.id) ||
      typeof authority.projectDir !== 'string' ||
      typeof authority.assertCurrent !== 'function'
    ) {
      return null;
    }
    const loadCurrentContext = async (): Promise<StudioAssetResolutionContextV2> => {
      await authority.assertCurrent!();
      return { projectDir: authority.projectDir, project: authority.project };
    };
    return resolveAssetFromContextV2(await loadCurrentContext(), assetId, loadCurrentContext);
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
    let staleReadyHandle: Awaited<ReturnType<typeof fs.open>> | null = null;
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
      const take = ownRecordValue(project.assets, extraction.videoAssetId);
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
          job.target.kind === 'shot' &&
          job.target.shotId === shot.id &&
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
      let staleReadyPath: string | null = null;
      let staleReadyIdentity: FileIdentity | null = null;
      if (repairingReadyAsset !== null) {
        staleReadyPath = conditioningFramePathV2(projectDir, repairingReadyAsset);
        try {
          const staleStats = await regularFile(staleReadyPath);
          if ((await fs.realpath(staleReadyPath)) !== staleReadyPath) {
            throw new CreativeStudioMediaError('storage_error');
          }
          staleReadyIdentity = fileIdentity(staleStats);
          staleReadyHandle = await fs.open(staleReadyPath, 'r');
          const openedStats = await staleReadyHandle.stat();
          const openedIdentity = fileIdentity(openedStats);
          if (
            !openedStats.isFile() ||
            openedIdentity.dev !== staleReadyIdentity.dev ||
            openedIdentity.ino !== staleReadyIdentity.ino
          ) {
            throw new CreativeStudioMediaError('storage_error');
          }
          try {
            await captureManagedFileProofV2(staleReadyPath, staleReadyIdentity, repairingReadyAsset);
            return structuredClone(extraction);
          } catch {
            await assertV2ManagedMutation(authority, [framesDirectory]);
            const currentStats = await regularFile(staleReadyPath);
            const currentIdentity = fileIdentity(currentStats);
            if (
              currentIdentity.dev !== staleReadyIdentity.dev ||
              currentIdentity.ino !== staleReadyIdentity.ino ||
              (await fs.realpath(staleReadyPath)) !== staleReadyPath
            ) {
              throw new CreativeStudioMediaError('storage_error');
            }
          }
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
          staleReadyPath = null;
          staleReadyIdentity = null;
        }
      }
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
      if (staleReadyPath !== null && staleReadyIdentity !== null) {
        const cleanup = await cleanupManagedPathV2(authority, staleReadyPath, staleReadyIdentity, framesDirectory);
        if (cleanup !== 'completed') throw new CreativeStudioMediaError('storage_error');
        try {
          await fs.lstat(staleReadyPath);
          throw new CreativeStudioMediaError('storage_error');
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
      }
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
        projectReferenceId: null,
        generationReferenceAssetIds: [],
        producerJobId: null,
        compositionDigest: null,
        createdAt: repairingReadyAsset?.createdAt ?? now(),
      };
      if (finalPath === null || finalIdentity === null) throw new CreativeStudioMediaError('storage_error');
      const frameFilePath = finalPath;
      const frameFileProof = await captureManagedFileProofV2(frameFilePath, finalIdentity, frameAsset);
      const committed = await withManagedProjectAuthority(project.id, async (projectAuthority, facts) => {
        if (projectAuthority.projectDir !== projectDir) throw new CreativeStudioMediaError('storage_error');
        await projectAuthority.assertCurrent?.();
        await assertV2ManagedMutation(authority, [framesDirectory]);
        assertManagedProjectCapacity(
          projectAuthority.project,
          facts.managedByteSize,
          frameAsset.byteSize,
          repairingReadyAsset?.byteSize ?? 0
        );
        return projectAuthority.commit(
          (current) => {
            const currentExtraction = ownRecordValue(current.frameExtractions, extraction.id);
            const currentShot = ownRecordValue(current.shots, shot.id);
            const currentTake = ownRecordValue(current.assets, take.id);
            const currentFrame = ownRecordValue(current.assets, frameAsset.id);
            if (
              currentExtraction === undefined ||
              currentShot === undefined ||
              currentTake === undefined ||
              currentExtraction.videoAssetId !== take.id ||
              currentExtraction.endpointSeconds !== extraction.endpointSeconds ||
              (repairingReadyAsset === null
                ? currentExtraction.status !== 'extracting' ||
                  currentExtraction.frameAssetId !== null ||
                  currentFrame !== undefined
                : currentExtraction.status !== 'ready' ||
                  currentExtraction.frameAssetId !== frameAssetId ||
                  currentFrame?.id !== repairingReadyAsset.id)
            ) {
              throw new CreativeStudioMediaError('job_inactive');
            }
            assertManagedProjectCapacity(
              current,
              facts.managedByteSize,
              frameAsset.byteSize,
              repairingReadyAsset?.byteSize ?? 0
            );
            defineRecordValue(current.assets, frameAsset.id, frameAsset);
            if (!currentShot.assetIds.includes(frameAsset.id)) currentShot.assetIds.push(frameAsset.id);
            currentExtraction.frameAssetId = frameAsset.id;
            currentExtraction.status = 'ready';
            currentExtraction.errorCode = null;
            return current;
          },
          projectAuthority.project.revision,
          undefined,
          async () => {
            assertOperationActive();
            await assertManagedFileProofV2(frameFilePath, frameFileProof);
          }
        );
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
    } finally {
      await staleReadyHandle?.close().catch((): undefined => undefined);
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
      videoAssetId: extraction.videoAssetId,
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
    collection: 'assets' | 'thumbnails' | 'boardStills';
    rejectVariationGrid: boolean;
  };

  const validateProviderOutputMetadataV2 = (input: ProviderJobOutputMetadataV2 | ProviderJobPosterMetadataV2): void => {
    if (
      !SAFE_ID.test(input.projectId) ||
      (input.shotId !== null && !SAFE_ID.test(input.shotId)) ||
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
    const { projectDir, project, authority } = await loadProviderOutputContextV2(input.projectId);
    const job = ownRecordValue(project.jobs, input.jobId);
    const targetShotId = job?.target.kind === 'shot' ? job.target.shotId : null;
    const shot = targetShotId === null ? undefined : ownRecordValue(project.shots, targetShotId);
    const beat = targetShotId === null ? null : owningBeatForShotV2(project, targetShotId);
    const reference =
      job?.target.kind === 'reference' ? ownRecordValue(project.references, job.target.referenceId) : undefined;
    const ownerHasJob =
      job?.target.kind === 'shot' ? shot?.jobIds.includes(job.id) : reference?.jobIds.includes(job?.id ?? '');
    const expectedMediaKind = job === undefined ? null : providerPrimaryMediaKindV2(job.purpose);
    const mediaKindMatchesRole = expectedMediaKind === input.mediaKind;
    const active =
      job?.status === 'submitting' ||
      job?.status === 'running' ||
      (job?.status === 'failed' && job.error?.code === 'download_failed');
    if (
      !job ||
      job.projectId !== input.projectId ||
      targetShotId !== input.shotId ||
      !ownerHasJob ||
      (job.target.kind === 'shot' && (!shot || !beat || job.purpose === 'reference_image')) ||
      (job.target.kind === 'reference' &&
        (!reference ||
          project.referencePlanStatus !== 'planned' ||
          !project.referenceOrder.includes(reference.id) ||
          job.purpose !== 'reference_image')) ||
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
      collection: providerPrimaryCollectionV2(job.purpose),
      rejectVariationGrid: job.purpose === 'seed_still' || job.purpose === 'reference_image',
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
      job.target.kind !== 'shot' ||
      job.target.shotId !== input.shotId ||
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
    const { projectDir, project, authority } = await loadProviderOutputContextV2(input.projectId);
    validateProviderPosterLineageV2(project, input);
    return {
      projectDir,
      project,
      authority,
      capacity: await planWriteCapacity(project, projectDir, limits.imageOutputMaxBytes, input.declaredByteSize),
      collection: 'thumbnails',
      rejectVariationGrid: false,
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
      shot.videoAssetId !== input.videoAssetId ||
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
        job.target.kind === 'shot' &&
        job.target.shotId === input.shotId &&
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
    const { projectDir, project, authority } = await loadProviderOutputContextV2(input.projectId);
    validateCapturedPosterLineageV2(project, input);
    return {
      projectDir,
      project,
      authority,
      capacity: await planWriteCapacity(project, projectDir, limits.imageOutputMaxBytes, input.declaredByteSize),
      collection: 'thumbnails',
      rejectVariationGrid: false,
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
    commit: (asset: StudioAssetV2, authorizeManagedFile: () => Promise<void>) => Promise<void>
  ): Promise<StudioAssetV2> => {
    const assetId = createId();
    if (!SAFE_ID.test(assetId)) throw new CreativeStudioMediaError('storage_error');
    let partPath: string | null = null;
    let partIdentity: FileIdentity | null = null;
    let finalPath: string | null = null;
    let finalIdentity: FileIdentity | null = null;
    try {
      const partsDirectory = await ensureManagedDirectoryV2(
        plan.authority,
        'parts',
        assertV2ProviderOutputPathMutation
      );
      const collectionDirectory = await ensureManagedDirectoryV2(
        plan.authority,
        plan.collection,
        assertV2ProviderOutputPathMutation
      );
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
      await assertV2ProviderOutputPathMutation(plan.authority, [partsDirectory]);
      const partHandle = await fs.open(partPath, 'wx');
      try {
        await assertV2ProviderOutputPathMutation(plan.authority, [partsDirectory]);
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
      await assertV2ProviderOutputPathMutation(plan.authority, [partsDirectory]);
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
        () => assertV2ProviderOutputPathMutation(plan.authority, [partsDirectory, collectionDirectory]),
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
      if (input.mediaKind === 'image' && plan.rejectVariationGrid) {
        let isVariationGrid: boolean;
        try {
          isVariationGrid = await (deps.detectImageVariationGridV2 ?? detectImageVariationGridV2)({
            filePath: finalPath,
          });
        } catch {
          throw new CreativeStudioMediaError('invalid_media');
        }
        if (isVariationGrid) throw new CreativeStudioMediaError('seed_still_variation_grid');
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
        projectReferenceId: null,
        generationReferenceAssetIds: [],
        producerJobId: null,
        compositionDigest: null,
        createdAt: now(),
      };
      if (finalPath === null || finalIdentity === null) throw new CreativeStudioMediaError('storage_error');
      const managedFilePath = finalPath;
      const managedFileProof = await captureManagedFileProofV2(managedFilePath, finalIdentity, asset);
      await assertV2ProviderOutputPathMutation(plan.authority, [collectionDirectory]);
      await commit(asset, async () => {
        await assertV2ProviderOutputPathMutation(plan.authority, [collectionDirectory]);
        await assertManagedFileProofV2(managedFilePath, managedFileProof);
      });
      return asset;
    } catch (error) {
      await cleanupUncommittedManagedPathsV2(input.projectId, assetId, [
        { filePath: partPath, identity: partIdentity },
        { filePath: finalPath, identity: finalIdentity },
      ]);
      return mapStoreError(error);
    }
  };

  const commitManagedAssetV2 = async (
    projectId: string,
    asset: StudioAssetV2,
    update: (project: StudioProjectV2) => StudioProjectV2,
    authorizeManagedFile: () => Promise<void>
  ): Promise<void> => {
    await withManagedProjectAuthority(projectId, async (projectAuthority, facts) => {
      await projectAuthority.assertCurrent?.();
      assertManagedProjectCapacity(projectAuthority.project, facts.managedByteSize, asset.byteSize);
      await projectAuthority.commit(
        (current) => {
          if (ownRecordValue(current.assets, asset.id) !== undefined) {
            throw new CreativeStudioMediaError('storage_error');
          }
          assertManagedProjectCapacity(current, facts.managedByteSize, asset.byteSize);
          return update(current);
        },
        projectAuthority.project.revision,
        undefined,
        async () => {
          assertOperationActive();
          await authorizeManagedFile();
        }
      );
    });
  };

  const commitProviderJobAssetV2 = async (
    input: ProviderJobOutputMetadataV2,
    asset: StudioAssetV2,
    authorizeManagedFile: () => Promise<void>
  ): Promise<void> => {
    await commitManagedAssetV2(
      input.projectId,
      asset,
      (current) => {
        const job = ownRecordValue(current.jobs, input.jobId);
        const targetShotId = job?.target.kind === 'shot' ? job.target.shotId : null;
        const shot = targetShotId === null ? undefined : ownRecordValue(current.shots, targetShotId);
        const beat = targetShotId === null ? null : owningBeatForShotV2(current, targetShotId);
        const reference =
          job?.target.kind === 'reference' ? ownRecordValue(current.references, job.target.referenceId) : undefined;
        const active =
          job?.status === 'submitting' ||
          job?.status === 'running' ||
          (job?.status === 'failed' && job.error?.code === 'download_failed');
        if (
          !job ||
          job.projectId !== input.projectId ||
          targetShotId !== input.shotId ||
          job.requestSnapshot === null ||
          (job.target.kind === 'shot' && (!shot || !beat || !shot.jobIds.includes(job.id))) ||
          (job.target.kind === 'reference' && (!reference || !reference.jobIds.includes(job.id))) ||
          !active
        ) {
          throw new CreativeStudioMediaError('job_inactive');
        }
        const expectedMediaKind = providerPrimaryMediaKindV2(job.purpose);
        const expectedCollection = providerPrimaryCollectionV2(job.purpose);
        if (expectedMediaKind !== input.mediaKind) {
          throw new CreativeStudioMediaError('job_inactive');
        }
        if (
          asset.projectId !== current.id ||
          asset.shotId !== targetShotId ||
          asset.mediaKind !== input.mediaKind ||
          asset.managedAsset.collection !== expectedCollection
        ) {
          throw new CreativeStudioMediaError('invalid_media');
        }
        asset.projectReferenceId = job.target.kind === 'reference' ? job.target.referenceId : null;
        asset.generationReferenceAssetIds = job.requestSnapshot.referenceInputs.map((input) => input.assetId);
        asset.producerJobId = job.id;
        asset.compositionDigest = studioGenerationCompositionDigestV2(job.composition);
        defineRecordValue(current.assets, asset.id, asset);
        if (job.target.kind === 'shot') {
          if (shot === undefined) throw new CreativeStudioMediaError('job_inactive');
          shot.assetIds.push(asset.id);
          if (job.purpose === 'video_take') {
            shot.supersededVideoAssetIds = shot.jobIds.flatMap((jobId) => {
              const completed = ownRecordValue(current.jobs, jobId);
              return completed?.status === 'succeeded' &&
                completed.purpose === 'video_take' &&
                completed.outputAssetIdsByRole.primary !== null
                ? [completed.outputAssetIdsByRole.primary]
                : [];
            });
            shot.videoAssetId = asset.id;
            if (asset.durationSeconds === undefined) throw new CreativeStudioMediaError('invalid_media');
            const endpointSeconds = asset.durationSeconds - (shot.trimOutSeconds ?? 0);
            const extractionId = createStudioFrameExtractionId({
              shotId: shot.id,
              videoAssetId: asset.id,
              endpointSeconds,
            });
            if (ownRecordValue(current.frameExtractions, extractionId) === undefined) {
              defineRecordValue(current.frameExtractions, extractionId, {
                id: extractionId,
                shotId: shot.id,
                videoAssetId: asset.id,
                endpointSeconds,
                frameAssetId: null,
                status: 'pending',
                errorCode: null,
              });
            }
          } else if (job.purpose === 'board_still') {
            if (shot.boardAssetId !== null) shot.supersededBoardAssetIds.push(shot.boardAssetId);
            shot.boardAssetId = asset.id;
          }
        } else {
          if (reference === undefined || job.purpose !== 'reference_image') {
            throw new CreativeStudioMediaError('job_inactive');
          }
          reference.supersededAssetIds = reference.supersededAssetIds.filter(
            (supersededAssetId) => supersededAssetId !== asset.id
          );
          if (
            reference.approvedAssetId !== null &&
            reference.approvedAssetId !== asset.id &&
            !reference.supersededAssetIds.includes(reference.approvedAssetId)
          ) {
            reference.supersededAssetIds.push(reference.approvedAssetId);
          }
          reference.approvedAssetId = asset.id;
        }
        job.status = 'succeeded';
        job.outputAssetIds = [asset.id];
        job.outputAssetIdsByRole.primary = asset.id;
        job.error = null;
        delete job.progress;
        job.updatedAt = now();
        if (reference !== undefined) {
          reference.updatedAt = job.updatedAt;
        }
        return current;
      },
      authorizeManagedFile
    );
  };

  const persistProviderOutputForJobV2 = async (input: PersistProviderJobOutputInputV2): Promise<StudioAssetV2> =>
    persistManagedOutputWithPlanV2(input, await prepareProviderJobWriteV2(input), (asset, authorizeManagedFile) =>
      commitProviderJobAssetV2(input, asset, authorizeManagedFile)
    );

  const commitProviderJobPosterV2 = async (
    input: ProviderJobPosterMetadataV2,
    posterAsset: StudioAssetV2,
    authorizeManagedFile: () => Promise<void>
  ): Promise<void> => {
    await commitManagedAssetV2(
      input.projectId,
      posterAsset,
      (current) => {
        const { shot, job } = validateProviderPosterLineageV2(current, input);
        if (
          posterAsset.projectId !== current.id ||
          posterAsset.shotId !== shot.id ||
          posterAsset.mediaKind !== 'image' ||
          posterAsset.managedAsset.collection !== 'thumbnails'
        ) {
          throw new CreativeStudioMediaError('invalid_media');
        }
        posterAsset.projectReferenceId = null;
        posterAsset.generationReferenceAssetIds = (job.requestSnapshot?.referenceInputs ?? []).map(
          (reference) => reference.assetId
        );
        posterAsset.producerJobId = job.id;
        posterAsset.compositionDigest = studioGenerationCompositionDigestV2(job.composition);
        defineRecordValue(current.assets, posterAsset.id, posterAsset);
        shot.assetIds.push(posterAsset.id);
        job.outputAssetIds.push(posterAsset.id);
        job.outputAssetIdsByRole.poster = posterAsset.id;
        job.updatedAt = now();
        return current;
      },
      authorizeManagedFile
    );
  };

  const persistProviderPosterForJobV2 = async (input: PersistProviderJobPosterInputV2): Promise<StudioAssetV2> => {
    const plan = await prepareProviderPosterWriteV2(input);
    return persistManagedOutputWithPlanV2({ ...input, mediaKind: 'image' }, plan, (asset, authorizeManagedFile) =>
      commitProviderJobPosterV2(input, asset, authorizeManagedFile)
    );
  };

  const commitCapturedPosterV2 = async (
    input: CapturedPosterMetadataV2,
    posterAsset: StudioAssetV2,
    authorizeManagedFile: () => Promise<void>
  ): Promise<void> => {
    await commitManagedAssetV2(
      input.projectId,
      posterAsset,
      (current) => {
        const { shot, job } = validateCapturedPosterLineageV2(current, input);
        if (
          posterAsset.projectId !== current.id ||
          posterAsset.shotId !== shot.id ||
          posterAsset.mediaKind !== 'image' ||
          posterAsset.managedAsset.collection !== 'thumbnails'
        ) {
          throw new CreativeStudioMediaError('invalid_media');
        }
        posterAsset.projectReferenceId = null;
        posterAsset.generationReferenceAssetIds = (job.requestSnapshot?.referenceInputs ?? []).map(
          (reference) => reference.assetId
        );
        posterAsset.producerJobId = job.id;
        posterAsset.compositionDigest = studioGenerationCompositionDigestV2(job.composition);
        defineRecordValue(current.assets, posterAsset.id, posterAsset);
        shot.assetIds.push(posterAsset.id);
        job.outputAssetIds.push(posterAsset.id);
        job.outputAssetIdsByRole.poster = posterAsset.id;
        job.updatedAt = now();
        return current;
      },
      authorizeManagedFile
    );
  };

  const persistCapturedPosterV2 = async (input: PersistCapturedPosterInputV2): Promise<StudioAssetV2> => {
    const plan = await prepareCapturedPosterWriteV2(input);
    const normalized = { ...input, mediaKind: 'image' as const, declaredMimeType: 'image/png' as const };
    return persistManagedOutputWithPlanV2(normalized, plan, (asset, authorizeManagedFile) =>
      commitCapturedPosterV2(input, asset, authorizeManagedFile)
    );
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
      persistManagedOutputWithPlanV2({ ...input, body }, plan, (asset, authorizeManagedFile) =>
        commitProviderJobAssetV2(input, asset, authorizeManagedFile)
      )
    );
  };

  const persistProviderPosterFromUrlForJobV2 = async (
    input: PersistProviderJobPosterUrlInputV2
  ): Promise<StudioAssetV2> => {
    const plan = await prepareProviderPosterWriteV2(input);
    const normalized = { ...input, mediaKind: 'image' as const };
    return persistProviderOutputFromUrlWithPlan(normalized, plan, (body) =>
      persistManagedOutputWithPlanV2({ ...normalized, body }, plan, (asset, authorizeManagedFile) =>
        commitProviderJobPosterV2(input, asset, authorizeManagedFile)
      )
    );
  };

  return {
    importSeedStillFromPathV2,
    importBedAudioFromPathV2,
    detachBedAudioV2,
    persistProviderOutputForJobV2,
    persistProviderOutputFromUrlForJobV2,
    persistProviderPosterForJobV2,
    persistProviderPosterFromUrlForJobV2,
    persistCapturedPosterV2,
    resolveAssetV2,
    resolveAssetWithProjectAuthorityV2,
    resolveProviderInputV2,
    extractConditioningFrameV2,
    verifyConditioningFrameV2,
    resumeConditioningFramesV2,
    cleanupOrphanPartsV2,
  };
};
