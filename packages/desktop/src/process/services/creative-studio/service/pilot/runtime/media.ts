/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash, randomBytes } from 'node:crypto';
import { constants as fsConstants, promises as nodeFs } from 'node:fs';
import path from 'node:path';
import {
  STUDIO_MAX_ASSETS_V3,
  STUDIO_MAX_IMAGE_ASSET_BYTES_V3,
  STUDIO_MAX_PIECES_V3,
  isValidProviderJobId,
  type StudioAssetV3,
  type StudioImportPhotoResultV3,
  type StudioPieceGeneratedAssetV3,
  type StudioPieceImportedAssetV3,
  type StudioPieceJobV3,
  type StudioPieceProviderSubmissionKindV3,
  type StudioProjectV3,
} from '@/common/types/project/creativeStudioTypes';
import type { ProviderOutput } from '@process/services/creative-studio/adapters/types';
import type {
  CreativeStudioPilotStoreV3,
  StudioPilotProjectAuthoritySnapshotV3,
} from '@process/services/creative-studio/store/pilotStore';
import { studioPieceGenerationCompositionDigestV3 } from '../../schema2/generation/composition';
import { createStudioPieceSpendReceiptV3 } from '../../schema2/pricing';
import {
  deriveStudioPieceHandleFromImportFileNameV3,
  studioPieceHandleNamespaceV3,
} from '../../schema2/mutations/pieceHandles';
import { parseStudioImportPhotoRequestV3 } from '../contracts';
import { CreativeStudioPilotServiceErrorV3, normalizeCreativeStudioPilotErrorV3 } from '../errors';
import type { StudioPilotGeneratedUrlResolutionV3 } from './generatedUrlResolver';

const MEDIA_DIRECTORY = 'media-v3';
const IMPORTS_DIRECTORY = 'imports';
const GENERATED_SOURCE_CLEANUP_ATTEMPTS = 3;
const ASSETS_DIRECTORY = 'assets';
const PARTS_DIRECTORY = '.parts';
const INTENTS_DIRECTORY = '.intents';
const MEDIA_INTENT_SCHEMA_VERSION = 3 as const;
const MAX_INTENT_BYTES = 16_384;
const MAX_IMAGE_PIXELS = 40_000_000;
const SAFE_ID = /^[A-Za-z0-9_-]{1,256}$/;
const SAFE_TEMPORARY_ID = /^[A-Za-z0-9_-]{8,128}$/;
const LOWERCASE_SHA256 = /^[a-f0-9]{64}$/;
const MIME_TYPES = new Set<StudioPilotImageMimeTypeV3>(['image/jpeg', 'image/png', 'image/webp']);
const EXTENSION_BY_MIME: Readonly<Record<StudioPilotImageMimeTypeV3, 'jpg' | 'png' | 'webp'>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};
const INTENT_KEYS = new Set([
  'schemaVersion',
  'kind',
  'projectId',
  'pieceId',
  'assetId',
  'jobId',
  'providerSubmissionKind',
  'providerJobId',
  'intentId',
  'stageFileName',
  'collection',
  'finalFileName',
  'mimeType',
  'byteSize',
  'sha256',
  'width',
  'height',
  'createdAt',
]);

type StudioPilotImageMimeTypeV3 = 'image/jpeg' | 'image/png' | 'image/webp';
type StudioPilotMediaFileSystemV3 = typeof nodeFs;
type StudioPilotMediaIdentityKindV3 = 'piece' | 'asset' | 'media_intent';

export type StudioPilotNativePhotoSelectionV3 = { path: string; fileName: string };

export type StudioPilotGeneratedOutputInputV3 = {
  projectId: string;
  pieceId: string;
  jobId: string;
  providerSubmissionKind: StudioPieceProviderSubmissionKindV3;
  providerJobId: string | null;
  outputs: readonly ProviderOutput[];
  /** Receipt-safe publication intentionally completes after dispatch cancellation once paid output exists. */
  signal?: AbortSignal;
};

export type StudioPilotGeneratedOutputResultV3 = {
  status: 'published';
  projectId: string;
  pieceId: string;
  jobId: string;
  assetId: string;
  revision: number;
  authoringRevision: number;
};

export type StudioPilotGeneratedRecoveryClaimV3 = {
  projectId: string;
  pieceId: string;
  jobId: string;
  expectedRevision: number;
};

export type StudioPilotGeneratedOutputClaimInspectionV3 = {
  authority: StudioPilotProjectAuthoritySnapshotV3;
  pieceId: string;
  jobId: string;
};

export type StudioPilotGeneratedOutputClaimDispositionV3 = 'clear' | 'claimed';

export type StudioPilotVerifiedManagedAssetV3 = {
  asset: StudioAssetV3;
  /** Main-only path. Consumers must reverify bytes after the project authority queue is released. */
  absolutePath: string;
};

export type StudioPilotMediaStorageStepV3 =
  | 'media:stage_durable'
  | 'media:intent_durable'
  | 'media:final_durable'
  | 'media:project_committed'
  | 'media:cleanup_complete';

export type StudioPilotMediaStoreOptionsV3 = {
  store: CreativeStudioPilotStoreV3;
  pickPhoto: () => Promise<StudioPilotNativePhotoSelectionV3 | null>;
  /** Main-owned provider download boundary; renderer calls can never supply it. */
  resolveGeneratedUrl?: (url: string, signal: AbortSignal | undefined) => Promise<StudioPilotGeneratedUrlResolutionV3>;
  fs?: StudioPilotMediaFileSystemV3;
  now?: () => string;
  mintIdentity?: (kind: StudioPilotMediaIdentityKindV3) => string;
  createTemporaryId?: () => string;
  inspectImage?: (filePath: string) => Promise<StudioPilotInspectedImageV3>;
  detectVariationGrid?: (filePath: string) => Promise<boolean>;
  /** Main-only active create reservations share capacity and handle authority with imports. */
  reservedCreateHandles?: (projectId: string, authoringRevision: number) => readonly string[];
  onStorageStep?: (step: StudioPilotMediaStorageStepV3, projectId: string) => void | Promise<void>;
};

export type StudioPilotMediaStoreV3 = {
  importPhotoV3(input: unknown): Promise<StudioImportPhotoResultV3>;
  publishGeneratedOutputV3(input: StudioPilotGeneratedOutputInputV3): Promise<StudioPilotGeneratedOutputResultV3>;
  recoverGeneratedJobV3(input: StudioPilotGeneratedRecoveryClaimV3): Promise<StudioPilotGeneratedOutputResultV3>;
  /** Reads exact durable output authority while the caller holds the Project authority queue. */
  inspectGeneratedOutputClaimUnderAuthorityV3(
    input: StudioPilotGeneratedOutputClaimInspectionV3
  ): Promise<StudioPilotGeneratedOutputClaimDispositionV3>;
  recoverProjectMediaV3(projectId: string): Promise<void>;
  recoverAllMediaV3(): Promise<void>;
  verifyManagedAssetV3(input: { projectId: string; assetId: string }): Promise<StudioPilotVerifiedManagedAssetV3>;
};

type StudioPilotMediaDirectoriesV3 = {
  media: string;
  imports: string;
  assets: string;
  parts: string;
  intents: string;
};

type StudioPilotInspectedImageV3 = {
  mimeType: StudioPilotImageMimeTypeV3;
  width: number;
  height: number;
};

type StudioPilotStagedImageV3 = StudioPilotInspectedImageV3 & {
  stageFileName: string;
  stagePath: string;
  byteSize: number;
  sha256: string;
};

type StudioPilotMediaIntentV3 = {
  schemaVersion: typeof MEDIA_INTENT_SCHEMA_VERSION;
  kind: 'imported' | 'generated';
  projectId: string;
  pieceId: string;
  assetId: string;
  jobId: string | null;
  providerSubmissionKind: StudioPieceProviderSubmissionKindV3 | null;
  providerJobId: string | null;
  intentId: string;
  stageFileName: string;
  collection: 'imports' | 'assets';
  finalFileName: string;
  mimeType: StudioPilotImageMimeTypeV3;
  byteSize: number;
  sha256: string;
  width: number;
  height: number;
  createdAt: string;
};

type NodeError = { code?: unknown };
type CrashState = { preserveResidue: boolean };

const isNodeError = (error: unknown): error is NodeError => typeof error === 'object' && error !== null;
const hasErrorCode = (error: unknown, code: string): boolean => isNodeError(error) && error.code === code;
const isSafePositiveInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype;
const sha256 = (value: string | Uint8Array): string => createHash('sha256').update(value).digest('hex');
const canonicalJson = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

const invalidMedia = (): never => {
  throw new CreativeStudioPilotServiceErrorV3('invalid_media');
};

const storageFailure = (): never => {
  throw new CreativeStudioPilotServiceErrorV3('storage_error');
};

const hasExactKeys = (value: Record<string, unknown>, keys: ReadonlySet<string>): boolean => {
  const ownKeys = Reflect.ownKeys(value);
  return (
    ownKeys.length === keys.size &&
    ownKeys.every((key) => {
      if (typeof key !== 'string' || !keys.has(key)) return false;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return descriptor !== undefined && descriptor.enumerable && Object.hasOwn(descriptor, 'value');
    })
  );
};

const isCanonicalTimestamp = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
  Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString() === value;

const mimeFromSignature = (bytes: Uint8Array): StudioPilotImageMimeTypeV3 | null => {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'image/webp';
  }
  return null;
};

const defaultInspectImage = async (filePath: string): Promise<StudioPilotInspectedImageV3> => {
  const sharp = (await import('sharp')).default;
  const metadata = await sharp(filePath, {
    limitInputPixels: MAX_IMAGE_PIXELS,
    sequentialRead: true,
    failOn: 'error',
  }).metadata();
  const mimeType =
    metadata.format === 'jpeg'
      ? 'image/jpeg'
      : metadata.format === 'png'
        ? 'image/png'
        : metadata.format === 'webp'
          ? 'image/webp'
          : null;
  if (
    mimeType === null ||
    !isSafePositiveInteger(metadata.width) ||
    !isSafePositiveInteger(metadata.height) ||
    metadata.width * metadata.height > MAX_IMAGE_PIXELS ||
    (metadata.pages !== undefined && metadata.pages !== 1)
  ) {
    return invalidMedia();
  }
  const swapsOrientation = metadata.orientation !== undefined && metadata.orientation >= 5 && metadata.orientation <= 8;
  return {
    mimeType,
    width: swapsOrientation ? metadata.height : metadata.width,
    height: swapsOrientation ? metadata.width : metadata.height,
  };
};

const cosineSimilarity = (left: readonly number[], right: readonly number[]): number => {
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index]! * right[index]!;
    leftMagnitude += left[index]! ** 2;
    rightMagnitude += right[index]! ** 2;
  }
  return leftMagnitude === 0 || rightMagnitude === 0 ? 0 : dot / Math.sqrt(leftMagnitude * rightMagnitude);
};

export const imageHasVariationGrid = (input: {
  data: Uint8Array;
  width: number;
  height: number;
  channels: number;
}): boolean => {
  const { data, width, height, channels } = input;
  if (width < 8 || height < 8 || channels < 3 || channels > 4 || data.length !== width * height * channels) {
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
  const differences = Array.from({ length: width - 1 }, (_, index) => columnDifference(index + 1)).toSorted(
    (left, right) => left - right
  );
  const middle = Math.floor(differences.length / 2);
  const median =
    differences.length % 2 === 0 ? (differences[middle - 1]! + differences[middle]!) / 2 : differences[middle]!;
  const seams = [0.25, 0.5, 0.75].map((ratio) => Math.min(width - 1, Math.max(1, Math.round(width * ratio))));
  if (seams.filter((column) => columnDifference(column) - median >= 55).length >= 2) return true;
  if (width < 48 || height < 24) return false;

  const luminance = (row: number, column: number): number => {
    const offset = (row * width + column) * channels;
    return data[offset]! * 0.299 + data[offset + 1]! * 0.587 + data[offset + 2]! * 0.114;
  };
  const bandFeature = (divisionCount: number, bandIndex: number): number[] | null => {
    const start = Math.floor((bandIndex * width) / divisionCount);
    const end = Math.floor(((bandIndex + 1) * width) / divisionCount);
    const bandWidth = end - start;
    if (bandWidth < 12) return null;
    const cells = Array.from({ length: 72 }, () => 0);
    const rows = Array.from({ length: 12 }, () => 0);
    const columns = Array.from({ length: 6 }, () => 0);
    let total = 0;
    let samples = 0;
    for (let row = 1; row < height - 1; row += 1) {
      for (let column = start + 1; column < end - 1; column += 1) {
        const gradient =
          Math.abs(luminance(row, column + 1) - luminance(row, column - 1)) +
          Math.abs(luminance(row + 1, column) - luminance(row - 1, column));
        const rowBin = Math.min(11, Math.floor((row * 12) / height));
        const columnBin = Math.min(5, Math.floor(((column - start) * 6) / bandWidth));
        cells[rowBin * 6 + columnBin]! += gradient;
        rows[rowBin]! += gradient;
        columns[columnBin]! += gradient;
        total += gradient;
        samples += 1;
      }
    }
    if (samples === 0 || total / samples < 6) return null;
    if (rows.filter((value) => value >= total / 36).length < 4) return null;
    if (columns.filter((value) => value >= total / 18).length < 2) return null;
    return cells.map((value) => Math.sqrt(value / total));
  };
  const repeatedBands = (divisionCount: 3 | 4): boolean => {
    const features = Array.from({ length: divisionCount }, (_, index) => bandFeature(divisionCount, index));
    if (features.some((feature) => feature === null)) return false;
    let similarPairs = 0;
    for (let left = 0; left < divisionCount; left += 1) {
      for (let right = left + 1; right < divisionCount; right += 1) {
        if (cosineSimilarity(features[left]!, features[right]!) >= 0.9) similarPairs += 1;
      }
    }
    return similarPairs >= (divisionCount === 4 ? 4 : 3);
  };
  return repeatedBands(4) || repeatedBands(3);
};

const defaultDetectVariationGrid = async (filePath: string): Promise<boolean> => {
  const sharp = (await import('sharp')).default;
  const { data, info } = await sharp(filePath, { limitInputPixels: MAX_IMAGE_PIXELS, sequentialRead: true })
    .rotate()
    .resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return imageHasVariationGrid({ data, width: info.width, height: info.height, channels: info.channels });
};

const parseIntent = (bytes: string): StudioPilotMediaIntentV3 | null => {
  let value: unknown;
  try {
    value = JSON.parse(bytes) as unknown;
  } catch {
    return null;
  }
  if (!isPlainRecord(value) || !hasExactKeys(value, INTENT_KEYS)) return null;
  if (
    value.schemaVersion !== MEDIA_INTENT_SCHEMA_VERSION ||
    (value.kind !== 'imported' && value.kind !== 'generated') ||
    typeof value.projectId !== 'string' ||
    !SAFE_ID.test(value.projectId) ||
    typeof value.pieceId !== 'string' ||
    !SAFE_ID.test(value.pieceId) ||
    typeof value.assetId !== 'string' ||
    !SAFE_ID.test(value.assetId) ||
    typeof value.intentId !== 'string' ||
    !SAFE_TEMPORARY_ID.test(value.intentId) ||
    value.stageFileName !== `${value.intentId}.part` ||
    (value.collection !== 'imports' && value.collection !== 'assets') ||
    typeof value.mimeType !== 'string' ||
    !MIME_TYPES.has(value.mimeType as StudioPilotImageMimeTypeV3) ||
    value.finalFileName !== `${value.assetId}.${EXTENSION_BY_MIME[value.mimeType as StudioPilotImageMimeTypeV3]}` ||
    !isSafePositiveInteger(value.byteSize) ||
    value.byteSize > STUDIO_MAX_IMAGE_ASSET_BYTES_V3 ||
    typeof value.sha256 !== 'string' ||
    !LOWERCASE_SHA256.test(value.sha256) ||
    !isSafePositiveInteger(value.width) ||
    !isSafePositiveInteger(value.height) ||
    !isCanonicalTimestamp(value.createdAt) ||
    (value.kind === 'imported'
      ? value.jobId !== null ||
        value.providerSubmissionKind !== null ||
        value.providerJobId !== null ||
        value.collection !== 'imports'
      : value.collection !== 'assets') ||
    (value.kind === 'generated' &&
      (typeof value.jobId !== 'string' ||
        !SAFE_ID.test(value.jobId) ||
        (value.providerSubmissionKind !== 'complete' && value.providerSubmissionKind !== 'remote') ||
        (value.providerSubmissionKind === 'complete'
          ? value.providerJobId !== null
          : typeof value.providerJobId !== 'string' || !isValidProviderJobId(value.providerJobId))))
  ) {
    return null;
  }
  return value as StudioPilotMediaIntentV3;
};

const syncDirectory = async (fs: StudioPilotMediaFileSystemV3, directory: string): Promise<void> => {
  const handle = await fs.open(directory, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
};

const ensureDirectory = async (fs: StudioPilotMediaFileSystemV3, parent: string, name: string): Promise<string> => {
  const directory = path.join(parent, name);
  await fs.mkdir(directory).catch((error: unknown) => {
    if (!hasErrorCode(error, 'EEXIST')) throw error;
  });
  const stats = await fs.lstat(directory);
  if (!stats.isDirectory() || stats.isSymbolicLink() || (await fs.realpath(directory)) !== directory)
    return storageFailure();
  await syncDirectory(fs, parent);
  return directory;
};

const existingDirectory = async (
  fs: StudioPilotMediaFileSystemV3,
  parent: string,
  name: string
): Promise<string | null> => {
  const directory = path.join(parent, name);
  let stats;
  try {
    stats = await fs.lstat(directory);
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) return null;
    throw error;
  }
  if (!stats.isDirectory() || stats.isSymbolicLink() || (await fs.realpath(directory)) !== directory) {
    return storageFailure();
  }
  return directory;
};

const ensureMediaDirectories = async (
  fs: StudioPilotMediaFileSystemV3,
  projectDir: string
): Promise<StudioPilotMediaDirectoriesV3> => {
  const media = await ensureDirectory(fs, projectDir, MEDIA_DIRECTORY);
  const imports = await ensureDirectory(fs, media, IMPORTS_DIRECTORY);
  const assets = await ensureDirectory(fs, media, ASSETS_DIRECTORY);
  const parts = await ensureDirectory(fs, media, PARTS_DIRECTORY);
  const intents = await ensureDirectory(fs, media, INTENTS_DIRECTORY);
  return { media, imports, assets, parts, intents };
};

const writeExclusiveDurable = async (fs: StudioPilotMediaFileSystemV3, file: string, bytes: string): Promise<void> => {
  const handle = await fs.open(file, 'wx');
  try {
    await handle.writeFile(bytes, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
};

const removeRegularIfPresent = async (fs: StudioPilotMediaFileSystemV3, file: string): Promise<void> => {
  try {
    const stats = await fs.lstat(file);
    if (!stats.isFile() || stats.isSymbolicLink()) return storageFailure();
    await fs.rm(file);
  } catch (error) {
    if (!hasErrorCode(error, 'ENOENT')) throw error;
  }
};

const readBoundedRegular = async (
  fs: StudioPilotMediaFileSystemV3,
  file: string,
  maximumBytes: number
): Promise<Uint8Array | null> => {
  let preliminary;
  try {
    preliminary = await fs.lstat(file);
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) return null;
    throw error;
  }
  if (!preliminary.isFile() || preliminary.isSymbolicLink() || preliminary.size > maximumBytes) return storageFailure();
  const flags =
    process.platform === 'win32'
      ? fsConstants.O_RDONLY
      : fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK;
  const handle = await fs.open(file, flags);
  try {
    const stats = await handle.stat();
    if (!stats.isFile() || stats.dev !== preliminary.dev || stats.ino !== preliminary.ino) return storageFailure();
    const bytes = Buffer.alloc(maximumBytes + 1);
    let offset = 0;
    while (offset < bytes.length) {
      // eslint-disable-next-line no-await-in-loop
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    if (offset > maximumBytes) return storageFailure();
    const finalStats = await fs.lstat(file);
    if (finalStats.isSymbolicLink() || finalStats.dev !== stats.dev || finalStats.ino !== stats.ino) {
      return storageFailure();
    }
    return bytes.subarray(0, offset);
  } finally {
    await handle.close();
  }
};

const copySourceToStage = async (
  fs: StudioPilotMediaFileSystemV3,
  sourcePath: string,
  stagePath: string
): Promise<{ byteSize: number; sha256: string; signature: Uint8Array }> => {
  if (!path.isAbsolute(sourcePath) || sourcePath.includes('\0')) return invalidMedia();
  const preliminary = await fs.lstat(sourcePath).catch(() => invalidMedia());
  if (!preliminary.isFile() || preliminary.isSymbolicLink() || preliminary.size > STUDIO_MAX_IMAGE_ASSET_BYTES_V3) {
    return invalidMedia();
  }
  const flags =
    process.platform === 'win32'
      ? fsConstants.O_RDONLY
      : fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK;
  const source = await fs.open(sourcePath, flags).catch(() => invalidMedia());
  let destination: Awaited<ReturnType<StudioPilotMediaFileSystemV3['open']>>;
  try {
    destination = await fs.open(stagePath, 'wx');
  } catch {
    await source.close().catch((): undefined => undefined);
    return storageFailure();
  }
  const hash = createHash('sha256');
  const signature = Buffer.alloc(12);
  let signatureBytes = 0;
  let byteSize = 0;
  try {
    const sourceStats = await source.stat();
    if (!sourceStats.isFile() || sourceStats.dev !== preliminary.dev || sourceStats.ino !== preliminary.ino) {
      return invalidMedia();
    }
    const buffer = Buffer.alloc(64 * 1024);
    while (true) {
      // eslint-disable-next-line no-await-in-loop
      const { bytesRead } = await source.read(buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      byteSize += bytesRead;
      if (byteSize > STUDIO_MAX_IMAGE_ASSET_BYTES_V3) return invalidMedia();
      if (signatureBytes < signature.length) {
        const copied = Math.min(signature.length - signatureBytes, bytesRead);
        buffer.copy(signature, signatureBytes, 0, copied);
        signatureBytes += copied;
      }
      hash.update(buffer.subarray(0, bytesRead));
      let written = 0;
      while (written < bytesRead) {
        // eslint-disable-next-line no-await-in-loop
        const result = await destination.write(buffer, written, bytesRead - written, null);
        if (result.bytesWritten < 1) return storageFailure();
        written += result.bytesWritten;
      }
    }
    if (byteSize < 1) return invalidMedia();
    await destination.sync();
    const finalSourceStats = await fs.lstat(sourcePath);
    if (
      finalSourceStats.isSymbolicLink() ||
      finalSourceStats.dev !== sourceStats.dev ||
      finalSourceStats.ino !== sourceStats.ino
    ) {
      return invalidMedia();
    }
    return { byteSize, sha256: hash.digest('hex'), signature: signature.subarray(0, signatureBytes) };
  } finally {
    await Promise.all([source.close(), destination.close()]);
  }
};

const validateNativeSelection = (value: unknown): StudioPilotNativePhotoSelectionV3 => {
  if (
    !isPlainRecord(value) ||
    !hasExactKeys(value, new Set(['path', 'fileName'])) ||
    typeof value.path !== 'string' ||
    !path.isAbsolute(value.path) ||
    value.path.includes('\0') ||
    typeof value.fileName !== 'string' ||
    value.fileName.length === 0 ||
    value.fileName.length > 1024 ||
    value.fileName.includes('/') ||
    value.fileName.includes('\\')
  ) {
    return invalidMedia();
  }
  return { path: value.path, fileName: value.fileName };
};

const intentOwnedByProject = (project: StudioProjectV3, intent: StudioPilotMediaIntentV3): boolean => {
  const asset = project.assets[intent.assetId];
  const piece = project.pieces[intent.pieceId];
  if (
    asset === undefined ||
    piece === undefined ||
    piece.currentAssetId !== asset.id ||
    asset.projectId !== project.id ||
    asset.pieceId !== piece.id ||
    asset.mimeType !== intent.mimeType ||
    asset.byteSize !== intent.byteSize ||
    asset.sha256 !== intent.sha256 ||
    asset.width !== intent.width ||
    asset.height !== intent.height ||
    asset.managedAsset.collection !== intent.collection ||
    asset.managedAsset.fileName !== intent.finalFileName ||
    asset.createdAt !== intent.createdAt
  ) {
    return false;
  }
  return intent.kind === 'imported'
    ? asset.origin === 'imported' && intent.jobId === null
    : asset.origin === 'generated' &&
        asset.producerJobId === intent.jobId &&
        intent.jobId !== null &&
        project.jobs[intent.jobId]?.providerSubmissionKind === intent.providerSubmissionKind &&
        project.jobs[intent.jobId]?.providerJobId === intent.providerJobId;
};

const identityAvailable = (project: StudioProjectV3, ...identities: string[]): boolean => {
  const unavailable = new Set([
    project.id,
    ...project.pieceOrder,
    ...Object.keys(project.assets),
    ...Object.keys(project.jobs),
  ]);
  for (const authorization of project.spendAuthorizations) {
    unavailable.add(authorization.id);
    unavailable.add(authorization.quote.id);
    unavailable.add(authorization.quote.reservationId);
    unavailable.add(authorization.quote.item.id);
    unavailable.add(authorization.idempotencyKey.key);
  }
  return new Set(identities).size === identities.length && identities.every((identity) => !unavailable.has(identity));
};

export const createStudioPilotMediaStoreV3 = (options: StudioPilotMediaStoreOptionsV3): StudioPilotMediaStoreV3 => {
  const fs = options.fs ?? nodeFs;
  const readNow = options.now ?? (() => new Date().toISOString());
  const mintIdentity =
    options.mintIdentity ??
    ((kind: StudioPilotMediaIdentityKindV3) => `${kind}_${randomBytes(18).toString('base64url')}`);
  const mintTemporaryId = options.createTemporaryId ?? (() => randomBytes(12).toString('base64url'));
  const inspectImage = options.inspectImage ?? defaultInspectImage;
  const detectVariationGrid = options.detectVariationGrid ?? defaultDetectVariationGrid;

  const now = (): string => {
    const value = readNow();
    if (!isCanonicalTimestamp(value)) return storageFailure();
    return value;
  };

  const temporaryId = (): string => {
    const value = mintTemporaryId();
    if (typeof value !== 'string' || !SAFE_TEMPORARY_ID.test(value)) return storageFailure();
    return value;
  };

  const durableIdentity = (kind: StudioPilotMediaIdentityKindV3): string => {
    const value = mintIdentity(kind);
    if (typeof value !== 'string' || !SAFE_ID.test(value)) return storageFailure();
    return value;
  };

  const storageStep = async (
    state: CrashState,
    step: StudioPilotMediaStorageStepV3,
    projectId: string
  ): Promise<void> => {
    try {
      await options.onStorageStep?.(step, projectId);
    } catch (error) {
      state.preserveResidue = true;
      throw error;
    }
  };

  const inspectStagedImage = async (
    stagePath: string,
    copied: { byteSize: number; sha256: string; signature: Uint8Array }
  ): Promise<StudioPilotStagedImageV3> => {
    const signatureMime = mimeFromSignature(copied.signature);
    if (signatureMime === null) return invalidMedia();
    let inspected: StudioPilotInspectedImageV3;
    try {
      inspected = await inspectImage(stagePath);
    } catch (error) {
      if (error instanceof CreativeStudioPilotServiceErrorV3) throw error;
      return invalidMedia();
    }
    if (
      inspected.mimeType !== signatureMime ||
      !MIME_TYPES.has(inspected.mimeType) ||
      !isSafePositiveInteger(inspected.width) ||
      !isSafePositiveInteger(inspected.height)
    ) {
      return invalidMedia();
    }
    return {
      ...inspected,
      stageFileName: path.basename(stagePath),
      stagePath,
      byteSize: copied.byteSize,
      sha256: copied.sha256,
    };
  };

  const stageSource = async (
    directories: StudioPilotMediaDirectoriesV3,
    sourcePath: string,
    intentId: string,
    state: CrashState,
    projectId: string,
    reportDurableStep = true
  ): Promise<StudioPilotStagedImageV3> => {
    const stageFileName = `${intentId}.part`;
    const stagePath = path.join(directories.parts, stageFileName);
    const copied = await copySourceToStage(fs, sourcePath, stagePath);
    await syncDirectory(fs, directories.parts);
    if (reportDurableStep) await storageStep(state, 'media:stage_durable', projectId);
    return inspectStagedImage(stagePath, copied);
  };

  const publishIntent = async (
    directories: StudioPilotMediaDirectoriesV3,
    intent: StudioPilotMediaIntentV3
  ): Promise<string> => {
    const intentPath = path.join(directories.intents, `${intent.intentId}.json`);
    const temporaryPath = path.join(directories.intents, `.intent-${intent.intentId}.tmp`);
    await writeExclusiveDurable(fs, temporaryPath, canonicalJson(intent));
    try {
      await fs.link(temporaryPath, intentPath);
      await syncDirectory(fs, directories.intents);
    } finally {
      await removeRegularIfPresent(fs, temporaryPath).catch((): undefined => undefined);
    }
    return intentPath;
  };

  const finalPathFor = (directories: StudioPilotMediaDirectoriesV3, intent: StudioPilotMediaIntentV3): string =>
    path.join(intent.collection === 'imports' ? directories.imports : directories.assets, intent.finalFileName);

  const verifyFileFacts = async (
    filePath: string,
    expected: Pick<StudioPilotMediaIntentV3, 'mimeType' | 'byteSize' | 'sha256' | 'width' | 'height'>
  ): Promise<void> => {
    const bytes = await readBoundedRegular(fs, filePath, STUDIO_MAX_IMAGE_ASSET_BYTES_V3);
    if (
      bytes === null ||
      bytes.length !== expected.byteSize ||
      sha256(bytes) !== expected.sha256 ||
      mimeFromSignature(bytes.subarray(0, 12)) !== expected.mimeType
    ) {
      return storageFailure();
    }
    const inspected = await inspectImage(filePath).catch(() => storageFailure());
    if (
      inspected.mimeType !== expected.mimeType ||
      inspected.width !== expected.width ||
      inspected.height !== expected.height
    ) {
      return storageFailure();
    }
  };

  const removeExactFile = async (filePath: string, expectedSha256: string): Promise<void> => {
    const bytes = await readBoundedRegular(fs, filePath, STUDIO_MAX_IMAGE_ASSET_BYTES_V3);
    if (bytes === null) return;
    if (sha256(bytes) !== expectedSha256) return storageFailure();
    await fs.rm(filePath);
    await syncDirectory(fs, path.dirname(filePath));
  };

  const settleIntent = async (
    directories: StudioPilotMediaDirectoriesV3,
    project: StudioProjectV3,
    intent: StudioPilotMediaIntentV3,
    intentPath: string
  ): Promise<void> => {
    const finalPath = finalPathFor(directories, intent);
    const owned = intentOwnedByProject(project, intent);
    if (owned) {
      await verifyFileFacts(finalPath, intent);
    } else {
      const collidesWithManifest = Object.hasOwn(project.assets, intent.assetId);
      const generatedOwner = intent.jobId === null ? undefined : project.jobs[intent.jobId];
      const hasExpectedGeneratedOwner =
        intent.kind === 'generated' &&
        Object.hasOwn(project.pieces, intent.pieceId) &&
        generatedOwner !== undefined &&
        generatedOwner.target.pieceId === intent.pieceId;
      if (
        collidesWithManifest ||
        (intent.kind === 'imported' ? Object.hasOwn(project.pieces, intent.pieceId) : !hasExpectedGeneratedOwner)
      ) {
        return storageFailure();
      }
      // A generated intent with an exact durable Piece/Job owner is paid output authority, not
      // disposable staging. Recovery must either publish it on that same Job or preserve it.
      if (intent.kind === 'generated') return storageFailure();
      await removeExactFile(finalPath, intent.sha256);
    }
    await removeExactFile(path.join(directories.parts, intent.stageFileName), intent.sha256);
    await removeRegularIfPresent(fs, intentPath);
    await syncDirectory(fs, directories.intents);
  };

  const ensureGeneratedFinal = async (
    directories: StudioPilotMediaDirectoriesV3,
    intent: StudioPilotMediaIntentV3
  ): Promise<void> => {
    const finalPath = finalPathFor(directories, intent);
    const finalBytes = await readBoundedRegular(fs, finalPath, STUDIO_MAX_IMAGE_ASSET_BYTES_V3);
    if (finalBytes !== null) {
      await verifyFileFacts(finalPath, intent);
      return;
    }
    const stagePath = path.join(directories.parts, intent.stageFileName);
    await verifyFileFacts(stagePath, intent);
    try {
      await fs.link(stagePath, finalPath);
    } catch (error) {
      if (hasErrorCode(error, 'EEXIST')) return storageFailure();
      throw error;
    }
    await syncDirectory(fs, path.dirname(finalPath));
    await verifyFileFacts(finalPath, intent);
  };

  const generatedSubmissionMatches = (
    job: StudioPieceJobV3,
    providerSubmissionKind: StudioPieceProviderSubmissionKindV3,
    providerJobId: string | null
  ): boolean =>
    providerSubmissionKind === 'complete'
      ? providerJobId === null &&
        job.providerSubmissionKind === 'complete' &&
        job.providerJobId === null &&
        job.remoteStartedAt === null
      : providerJobId !== null &&
        job.providerSubmissionKind === 'remote' &&
        job.providerJobId === providerJobId &&
        job.remoteStartedAt !== null;

  const pendingIntentOwnsJob = (
    job: StudioPieceJobV3,
    providerSubmissionKind: StudioPieceProviderSubmissionKindV3,
    providerJobId: string | null
  ): boolean => {
    if (providerSubmissionKind === 'complete') {
      return (
        providerJobId === null &&
        job.providerSubmissionKind === null &&
        job.providerJobId === null &&
        job.remoteStartedAt === null &&
        job.spendReceipt === null &&
        (job.status === 'submitting' || (job.status === 'needs_attention' && job.error?.code === 'submission_unknown'))
      );
    }
    return (
      generatedSubmissionMatches(job, 'remote', providerJobId) &&
      job.spendReceipt === null &&
      (job.status === 'queued_remote' ||
        job.status === 'running' ||
        (job.status === 'needs_attention' && job.error?.code === 'poll_deadline'))
    );
  };

  const recoverableIntentOwnsJob = (
    job: StudioPieceJobV3,
    providerSubmissionKind: StudioPieceProviderSubmissionKindV3,
    providerJobId: string | null
  ): boolean =>
    pendingIntentOwnsJob(job, providerSubmissionKind, providerJobId) ||
    (generatedSubmissionMatches(job, providerSubmissionKind, providerJobId) &&
      job.spendReceipt !== null &&
      ((job.status === 'failed' && job.error?.code === 'download_failed') ||
        (providerSubmissionKind === 'complete' &&
          job.status === 'needs_attention' &&
          job.error?.code === 'submission_unknown') ||
        (providerSubmissionKind === 'remote' && job.status === 'running' && job.error === null) ||
        (providerSubmissionKind === 'remote' &&
          job.status === 'needs_attention' &&
          job.error?.code === 'poll_deadline')));

  const completionReceipt = (project: StudioProjectV3, job: StudioPieceJobV3, recordedAt: string) => {
    if (job.spendReceipt !== null) return structuredClone(job.spendReceipt);
    const authorization = project.spendAuthorizations.find((candidate) => candidate.id === job.authorizationId);
    if (authorization === undefined || authorization.quote.item.id !== job.authorizationItemId) {
      throw new CreativeStudioPilotServiceErrorV3('job_ineligible');
    }
    return createStudioPieceSpendReceiptV3({
      reservationId: authorization.quote.reservationId,
      authorization,
      jobId: job.id,
      recordedAt,
    });
  };

  const generatedIntentFailureCanBeMarked = (
    job: StudioPieceJobV3,
    providerSubmissionKind: StudioPieceProviderSubmissionKindV3,
    providerJobId: string | null
  ): boolean =>
    pendingIntentOwnsJob(job, providerSubmissionKind, providerJobId) ||
    (generatedSubmissionMatches(job, providerSubmissionKind, providerJobId) &&
      job.spendReceipt !== null &&
      ((providerSubmissionKind === 'complete' &&
        job.status === 'needs_attention' &&
        job.error?.code === 'submission_unknown') ||
        (providerSubmissionKind === 'remote' &&
          job.status === 'needs_attention' &&
          job.error?.code === 'poll_deadline')));

  const markGeneratedIntentDownloadFailure = async (
    authority: StudioPilotProjectAuthoritySnapshotV3,
    project: StudioProjectV3,
    intent: StudioPilotMediaIntentV3
  ): Promise<StudioProjectV3> => {
    const job = intent.jobId === null ? undefined : project.jobs[intent.jobId];
    const providerSubmissionKind = intent.providerSubmissionKind;
    const providerJobId = intent.providerJobId;
    if (
      intent.kind !== 'generated' ||
      intent.jobId === null ||
      providerSubmissionKind === null ||
      job === undefined ||
      !generatedIntentFailureCanBeMarked(job, providerSubmissionKind, providerJobId)
    ) {
      throw new CreativeStudioPilotServiceErrorV3('job_ineligible');
    }
    const recordedAt = now();
    if (recordedAt < intent.createdAt) return storageFailure();
    const spendReceipt = completionReceipt(project, job, recordedAt);
    return authority.commit(
      (draft) => {
        const next = structuredClone(draft);
        const nextJob = next.jobs[job.id];
        if (
          nextJob === undefined ||
          !generatedIntentFailureCanBeMarked(nextJob, providerSubmissionKind, providerJobId)
        ) {
          throw new CreativeStudioPilotServiceErrorV3('job_ineligible');
        }
        nextJob.providerSubmissionKind = providerSubmissionKind;
        nextJob.status = 'failed';
        nextJob.outputAssetId = null;
        nextJob.progress = null;
        nextJob.error = {
          code: 'download_failed',
          messageKey: 'conversation.creativeStudio.jobs.errors.downloadFailed',
        };
        nextJob.spendReceipt = spendReceipt;
        nextJob.updatedAt = recordedAt;
        return next;
      },
      { kind: 'runtime', expectedRevision: project.revision }
    );
  };

  const recoverGeneratedIntent = async (
    authority: StudioPilotProjectAuthoritySnapshotV3,
    directories: StudioPilotMediaDirectoriesV3,
    project: StudioProjectV3,
    intent: StudioPilotMediaIntentV3,
    intentPath: string
  ): Promise<StudioProjectV3> => {
    const piece = project.pieces[intent.pieceId];
    const job = intent.jobId === null ? undefined : project.jobs[intent.jobId];
    const providerSubmissionKind = intent.providerSubmissionKind;
    const providerJobId = intent.providerJobId;
    if (
      intent.kind !== 'generated' ||
      intent.jobId === null ||
      providerSubmissionKind === null ||
      piece === undefined ||
      job === undefined ||
      job.target.pieceId !== piece.id ||
      piece.jobIds.at(-1) !== job.id ||
      piece.currentAssetId !== null ||
      job.outputAssetId !== null ||
      !recoverableIntentOwnsJob(job, providerSubmissionKind, providerJobId) ||
      Object.hasOwn(project.assets, intent.assetId) ||
      Object.values(project.assets).some((asset) =>
        asset.origin === 'generated' ? asset.producerJobId === job.id : false
      ) ||
      Object.keys(project.assets).length >= STUDIO_MAX_ASSETS_V3 ||
      !identityAvailable(project, intent.assetId)
    ) {
      return storageFailure();
    }
    try {
      await ensureGeneratedFinal(directories, intent);
    } catch (error) {
      if (!(job.status === 'failed' && job.error?.code === 'download_failed')) {
        await markGeneratedIntentDownloadFailure(authority, project, intent);
      }
      throw error;
    }
    const completedAt = now();
    if (completedAt < intent.createdAt) return storageFailure();
    const spendReceipt = completionReceipt(project, job, completedAt);
    const generatedAsset: StudioPieceGeneratedAssetV3 = {
      id: intent.assetId,
      projectId: project.id,
      pieceId: piece.id,
      mediaKind: 'image',
      mimeType: intent.mimeType,
      managedAsset: { collection: 'assets', fileName: intent.finalFileName },
      byteSize: intent.byteSize,
      sha256: intent.sha256,
      width: intent.width,
      height: intent.height,
      createdAt: intent.createdAt,
      origin: 'generated',
      producerJobId: job.id,
      compositionDigest: studioPieceGenerationCompositionDigestV3(job.composition),
    };
    const committed = await authority.commit(
      (draft) => {
        const next = structuredClone(draft);
        const nextPiece = next.pieces[piece.id];
        const nextJob = next.jobs[job.id];
        if (
          nextPiece === undefined ||
          nextJob === undefined ||
          nextPiece.currentAssetId !== null ||
          nextJob.outputAssetId !== null ||
          !recoverableIntentOwnsJob(nextJob, providerSubmissionKind, providerJobId)
        ) {
          throw new CreativeStudioPilotServiceErrorV3('job_ineligible');
        }
        next.assets[intent.assetId] = generatedAsset;
        nextPiece.currentAssetId = intent.assetId;
        nextPiece.updatedAt = completedAt;
        nextJob.providerSubmissionKind = providerSubmissionKind;
        nextJob.status = 'succeeded';
        nextJob.outputAssetId = intent.assetId;
        nextJob.progress = 100;
        nextJob.error = null;
        nextJob.spendReceipt = spendReceipt;
        nextJob.updatedAt = completedAt;
        return next;
      },
      { kind: 'runtime', expectedRevision: project.revision }
    );
    await settleIntent(directories, committed, intent, intentPath);
    return committed;
  };

  const recoverInsideAuthority = async (
    authority: StudioPilotProjectAuthoritySnapshotV3,
    directories: StudioPilotMediaDirectoriesV3,
    project = authority.project
  ): Promise<boolean> => {
    const entries = await fs.readdir(directories.intents, { withFileTypes: true });
    const claimedStages = new Set<string>();
    for (const entry of entries.toSorted((left, right) => left.name.localeCompare(right.name))) {
      if (entry.name.startsWith('.intent-') && entry.name.endsWith('.tmp') && entry.isFile()) {
        // Control-record publication temps are never authoritative.
        // eslint-disable-next-line no-await-in-loop
        await removeRegularIfPresent(fs, path.join(directories.intents, entry.name));
        continue;
      }
      if (!entry.name.endsWith('.json') || !entry.isFile() || entry.isSymbolicLink()) continue;
      const intentPath = path.join(directories.intents, entry.name);
      // eslint-disable-next-line no-await-in-loop
      const bytes = await readBoundedRegular(fs, intentPath, MAX_INTENT_BYTES);
      let intent: StudioPilotMediaIntentV3 | null = null;
      if (bytes !== null) {
        try {
          intent = parseIntent(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
        } catch {
          intent = null;
        }
      }
      if (intent === null || intent.projectId !== project.id || entry.name !== `${intent.intentId}.json`) {
        // Preserve malformed evidence under an inert name; it cannot authorize file removal.
        // eslint-disable-next-line no-await-in-loop
        await fs.rename(intentPath, path.join(directories.intents, `.invalid-${temporaryId()}`));
        // eslint-disable-next-line no-await-in-loop
        await syncDirectory(fs, directories.intents);
        continue;
      }
      claimedStages.add(intent.stageFileName);
      if (intent.kind === 'generated' && !intentOwnedByProject(project, intent)) {
        // One authority snapshot permits one mutation. Stop after replaying one exact paid intent;
        // the outer recovery loop reopens authority before inspecting any remaining records.
        // eslint-disable-next-line no-await-in-loop
        await recoverGeneratedIntent(authority, directories, project, intent, intentPath);
        return true;
      }
      // eslint-disable-next-line no-await-in-loop
      await settleIntent(directories, project, intent, intentPath);
    }
    const parts = await fs.readdir(directories.parts, { withFileTypes: true });
    for (const entry of parts) {
      if (
        !entry.isFile() ||
        entry.isSymbolicLink() ||
        !SAFE_TEMPORARY_ID.test(entry.name.slice(0, -'.part'.length)) ||
        !entry.name.endsWith('.part') ||
        claimedStages.has(entry.name)
      ) {
        continue;
      }
      // A part without an authoritative intent cannot be referenced by a project manifest.
      // eslint-disable-next-line no-await-in-loop
      await removeRegularIfPresent(fs, path.join(directories.parts, entry.name));
    }
    await syncDirectory(fs, directories.parts);
    return false;
  };

  const publishFinal = async (
    directories: StudioPilotMediaDirectoriesV3,
    intent: StudioPilotMediaIntentV3
  ): Promise<string> => {
    const stagePath = path.join(directories.parts, intent.stageFileName);
    const finalPath = finalPathFor(directories, intent);
    try {
      await fs.link(stagePath, finalPath);
    } catch (error) {
      if (hasErrorCode(error, 'EEXIST')) return storageFailure();
      throw error;
    }
    await syncDirectory(fs, path.dirname(finalPath));
    await verifyFileFacts(finalPath, intent);
    return finalPath;
  };

  const withRecoveredProjectAuthority = async <T>(
    projectId: string,
    operation: (
      authority: StudioPilotProjectAuthoritySnapshotV3,
      directories: StudioPilotMediaDirectoriesV3
    ) => Promise<T>
  ): Promise<T> => {
    while (true) {
      // A recovery commit consumes the current authority snapshot. Reopen the queue before the
      // caller performs another mutation so every write retains exact revision authority.
      // eslint-disable-next-line no-await-in-loop
      const outcome = await options.store.withProjectAuthorityV3(projectId, async (authority) => {
        const directories = await ensureMediaDirectories(fs, authority.projectDir);
        if (await recoverInsideAuthority(authority, directories)) {
          return { kind: 'recovered' as const };
        }
        return { kind: 'result' as const, value: await operation(authority, directories) };
      });
      if (outcome.kind === 'result') return outcome.value;
    }
  };

  const inspectGeneratedOutputClaimUnderAuthorityV3 = async (
    input: StudioPilotGeneratedOutputClaimInspectionV3
  ): Promise<StudioPilotGeneratedOutputClaimDispositionV3> => {
    try {
      if (
        !isPlainRecord(input) ||
        !hasExactKeys(input, new Set(['authority', 'pieceId', 'jobId'])) ||
        !isPlainRecord(input.authority) ||
        !isPlainRecord(input.authority.project) ||
        typeof input.authority.assertCurrent !== 'function' ||
        typeof input.authority.project.id !== 'string' ||
        !SAFE_ID.test(input.authority.project.id) ||
        typeof input.authority.projectDir !== 'string' ||
        !path.isAbsolute(input.authority.projectDir) ||
        input.authority.projectDir.includes('\0') ||
        typeof input.pieceId !== 'string' ||
        !SAFE_ID.test(input.pieceId) ||
        typeof input.jobId !== 'string' ||
        !SAFE_ID.test(input.jobId)
      ) {
        throw new CreativeStudioPilotServiceErrorV3('invalid_payload');
      }
      await input.authority.assertCurrent();
      const mediaDirectory = await existingDirectory(fs, input.authority.projectDir, MEDIA_DIRECTORY);
      if (mediaDirectory === null) return 'clear';
      const intentsDirectory = await existingDirectory(fs, mediaDirectory, INTENTS_DIRECTORY);
      if (intentsDirectory === null) return 'clear';
      const entries = await fs.readdir(intentsDirectory, { withFileTypes: true });
      for (const entry of entries.toSorted((left, right) => left.name.localeCompare(right.name))) {
        if (!entry.name.endsWith('.json')) continue;
        if (!entry.isFile() || entry.isSymbolicLink()) return storageFailure();
        const intentPath = path.join(intentsDirectory, entry.name);
        // eslint-disable-next-line no-await-in-loop
        const bytes = await readBoundedRegular(fs, intentPath, MAX_INTENT_BYTES);
        if (bytes === null) return storageFailure();
        let intent: StudioPilotMediaIntentV3 | null;
        try {
          intent = parseIntent(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
        } catch {
          return storageFailure();
        }
        if (
          intent === null ||
          intent.projectId !== input.authority.project.id ||
          entry.name !== `${intent.intentId}.json`
        ) {
          return storageFailure();
        }
        if (intent.kind === 'generated' && intent.pieceId === input.pieceId && intent.jobId === input.jobId) {
          return 'claimed';
        }
      }
      return 'clear';
    } catch (error) {
      return normalizeCreativeStudioPilotErrorV3(error);
    }
  };

  const recoverProjectMediaV3 = async (projectId: string): Promise<void> => {
    if (typeof projectId !== 'string' || !SAFE_ID.test(projectId)) {
      throw new CreativeStudioPilotServiceErrorV3('invalid_payload');
    }
    try {
      await withRecoveredProjectAuthority(projectId, async (): Promise<void> => undefined);
    } catch (error) {
      return normalizeCreativeStudioPilotErrorV3(error);
    }
  };

  const recoverGeneratedJobV3 = async (
    input: StudioPilotGeneratedRecoveryClaimV3
  ): Promise<StudioPilotGeneratedOutputResultV3> => {
    try {
      if (
        !isPlainRecord(input) ||
        !hasExactKeys(input, new Set(['projectId', 'pieceId', 'jobId', 'expectedRevision'])) ||
        typeof input.projectId !== 'string' ||
        !SAFE_ID.test(input.projectId) ||
        typeof input.pieceId !== 'string' ||
        !SAFE_ID.test(input.pieceId) ||
        typeof input.jobId !== 'string' ||
        !SAFE_ID.test(input.jobId) ||
        !Number.isSafeInteger(input.expectedRevision) ||
        input.expectedRevision < 1
      ) {
        throw new CreativeStudioPilotServiceErrorV3('invalid_payload');
      }
      return await options.store.withProjectAuthorityV3(input.projectId, async (authority) => {
        const project = authority.project;
        if (project.revision !== input.expectedRevision) {
          throw new CreativeStudioPilotServiceErrorV3('stale_project');
        }
        const piece = project.pieces[input.pieceId];
        const job = project.jobs[input.jobId];
        if (
          piece === undefined ||
          job === undefined ||
          job.target.pieceId !== piece.id ||
          piece.jobIds.at(-1) !== job.id ||
          piece.currentAssetId !== null ||
          job.outputAssetId !== null ||
          job.status !== 'failed' ||
          job.error?.code !== 'download_failed' ||
          job.spendReceipt === null ||
          job.providerSubmissionKind === null
        ) {
          throw new CreativeStudioPilotServiceErrorV3('job_ineligible');
        }
        const directories = await ensureMediaDirectories(fs, authority.projectDir);
        const entries = await fs.readdir(directories.intents, { withFileTypes: true });
        const matches: { intent: StudioPilotMediaIntentV3; intentPath: string }[] = [];
        for (const entry of entries.toSorted((left, right) => left.name.localeCompare(right.name))) {
          if (!entry.name.endsWith('.json') || !entry.isFile() || entry.isSymbolicLink()) continue;
          const intentPath = path.join(directories.intents, entry.name);
          // Claim inspection is read-only until the caller's exact revision has been revalidated.
          // eslint-disable-next-line no-await-in-loop
          const bytes = await readBoundedRegular(fs, intentPath, MAX_INTENT_BYTES);
          if (bytes === null) continue;
          let intent: StudioPilotMediaIntentV3 | null = null;
          try {
            intent = parseIntent(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
          } catch {
            intent = null;
          }
          if (
            intent?.kind === 'generated' &&
            intent.projectId === project.id &&
            intent.pieceId === piece.id &&
            intent.jobId === job.id &&
            intent.providerSubmissionKind === job.providerSubmissionKind &&
            intent.providerJobId === job.providerJobId &&
            entry.name === `${intent.intentId}.json`
          ) {
            matches.push({ intent, intentPath });
          }
        }
        if (matches.length !== 1) throw new CreativeStudioPilotServiceErrorV3('job_ineligible');
        const match = matches[0]!;
        const committed = await recoverGeneratedIntent(authority, directories, project, match.intent, match.intentPath);
        return {
          status: 'published',
          projectId: project.id,
          pieceId: piece.id,
          jobId: job.id,
          assetId: match.intent.assetId,
          revision: committed.revision,
          authoringRevision: committed.authoringRevision,
        };
      });
    } catch (error) {
      return normalizeCreativeStudioPilotErrorV3(error);
    }
  };

  const recoverAfterAmbiguousCommit = async (projectId: string): Promise<void> => {
    await recoverProjectMediaV3(projectId).catch((): undefined => undefined);
  };

  const importPhotoV3 = async (rawInput: unknown): Promise<StudioImportPhotoResultV3> => {
    let projectId: string | null = null;
    let crashState: CrashState | null = null;
    try {
      const input = parseStudioImportPhotoRequestV3(rawInput);
      projectId = input.projectId;
      await options.store.withProjectAuthorityV3(input.projectId, async (authority) => {
        const reservedCreateHandles =
          options.reservedCreateHandles?.(authority.project.id, authority.project.authoringRevision) ?? [];
        if (
          authority.project.pieceOrder.length + reservedCreateHandles.length >= STUDIO_MAX_PIECES_V3 ||
          Object.keys(authority.project.assets).length >= STUDIO_MAX_ASSETS_V3
        ) {
          throw new CreativeStudioPilotServiceErrorV3('project_piece_capacity_reached');
        }
        if (authority.project.authoringRevision !== input.expectedAuthoringRevision) {
          throw new CreativeStudioPilotServiceErrorV3('stale_authoring');
        }
      });
      const selected = await options.pickPhoto();
      if (selected === null) return { status: 'cancelled' };
      const selection = validateNativeSelection(selected);
      crashState = { preserveResidue: false };
      return await withRecoveredProjectAuthority(input.projectId, async (authority, directories) => {
        const project = authority.project;
        const reservedCreateHandles = options.reservedCreateHandles?.(project.id, project.authoringRevision) ?? [];
        if (
          project.pieceOrder.length + reservedCreateHandles.length >= STUDIO_MAX_PIECES_V3 ||
          Object.keys(project.assets).length >= STUDIO_MAX_ASSETS_V3
        ) {
          throw new CreativeStudioPilotServiceErrorV3('project_piece_capacity_reached');
        }
        if (project.authoringRevision !== input.expectedAuthoringRevision) {
          throw new CreativeStudioPilotServiceErrorV3('stale_authoring');
        }
        const pieceId = durableIdentity('piece');
        const assetId = durableIdentity('asset');
        const intentId = durableIdentity('media_intent');
        if (!identityAvailable(project, pieceId, assetId)) return storageFailure();
        const handle = deriveStudioPieceHandleFromImportFileNameV3(
          selection.fileName,
          studioPieceHandleNamespaceV3(project, null, reservedCreateHandles)
        );
        let intent: StudioPilotMediaIntentV3 | null = null;
        let intentPath: string | null = null;
        let commitAttempted = false;
        try {
          const staged = await stageSource(directories, selection.path, intentId, crashState, project.id);
          const createdAt = now();
          const finalFileName = `${assetId}.${EXTENSION_BY_MIME[staged.mimeType]}`;
          intent = {
            schemaVersion: MEDIA_INTENT_SCHEMA_VERSION,
            kind: 'imported',
            projectId: project.id,
            pieceId,
            assetId,
            jobId: null,
            providerSubmissionKind: null,
            providerJobId: null,
            intentId,
            stageFileName: staged.stageFileName,
            collection: 'imports',
            finalFileName,
            mimeType: staged.mimeType,
            byteSize: staged.byteSize,
            sha256: staged.sha256,
            width: staged.width,
            height: staged.height,
            createdAt,
          };
          intentPath = await publishIntent(directories, intent);
          await storageStep(crashState, 'media:intent_durable', project.id);
          await publishFinal(directories, intent);
          await storageStep(crashState, 'media:final_durable', project.id);
          const importedAsset: StudioPieceImportedAssetV3 = {
            id: assetId,
            projectId: project.id,
            pieceId,
            mediaKind: 'image',
            mimeType: staged.mimeType,
            managedAsset: { collection: 'imports', fileName: finalFileName },
            byteSize: staged.byteSize,
            sha256: staged.sha256,
            width: staged.width,
            height: staged.height,
            createdAt,
            origin: 'imported',
            producerJobId: null,
            compositionDigest: null,
          };
          commitAttempted = true;
          const committed = await authority.commit(
            (draft) => {
              const next = structuredClone(draft);
              next.pieceOrder.push(pieceId);
              next.pieces[pieceId] = {
                id: pieceId,
                kind: 'photograph',
                handle,
                priorHandles: [],
                currentAssetId: assetId,
                jobIds: [],
                createdAt,
                updatedAt: createdAt,
              };
              next.assets[assetId] = importedAsset;
              return next;
            },
            { kind: 'authoring', expectedRevision: project.revision }
          );
          await storageStep(crashState, 'media:project_committed', project.id);
          await settleIntent(directories, committed, intent, intentPath);
          await storageStep(crashState, 'media:cleanup_complete', project.id);
          return {
            status: 'imported',
            projectId: project.id,
            pieceId,
            assetId,
            revision: committed.revision,
            authoringRevision: committed.authoringRevision,
          };
        } catch (error) {
          if (!crashState.preserveResidue && !commitAttempted) {
            if (intent !== null && intentPath !== null) {
              await settleIntent(directories, project, intent, intentPath).catch((): undefined => undefined);
            } else {
              await removeRegularIfPresent(fs, path.join(directories.parts, `${intentId}.part`)).catch(
                (): undefined => undefined
              );
              await syncDirectory(fs, directories.parts).catch((): undefined => undefined);
            }
          }
          throw error;
        }
      });
    } catch (error) {
      if (projectId !== null && crashState !== null && !crashState.preserveResidue) {
        await recoverAfterAmbiguousCommit(projectId);
      }
      return normalizeCreativeStudioPilotErrorV3(error);
    }
  };

  const resolveGeneratedSource = async (
    output: ProviderOutput,
    signal: AbortSignal | undefined
  ): Promise<{ path: string; cleanup: (() => Promise<void>) | null }> => {
    if (output.source.kind === 'file') return { path: output.source.path, cleanup: null };
    if (options.resolveGeneratedUrl === undefined) return invalidMedia();
    const resolved = await options.resolveGeneratedUrl(output.source.url, signal).catch(() => {
      throw new CreativeStudioPilotServiceErrorV3('download_failed');
    });
    if (
      !isPlainRecord(resolved) ||
      !hasExactKeys(resolved, new Set(['path', 'cleanup'])) ||
      typeof resolved.path !== 'string' ||
      typeof resolved.cleanup !== 'function'
    ) {
      throw new CreativeStudioPilotServiceErrorV3('download_failed');
    }
    return { path: resolved.path, cleanup: resolved.cleanup };
  };

  const cleanupGeneratedSource = async (cleanup: (() => Promise<void>) | null): Promise<void> => {
    if (cleanup === null) return;
    for (let attempt = 0; attempt < GENERATED_SOURCE_CLEANUP_ATTEMPTS; attempt += 1) {
      try {
        // eslint-disable-next-line no-await-in-loop -- cleanup retries are bounded and must remain ordered/idempotent.
        await cleanup();
        return;
      } catch {
        // A successful publication remains authoritative even if best-effort OS-temp cleanup exhausts its retries.
      }
    }
  };

  const assertGeneratedPublicationOwner = (
    project: StudioProjectV3,
    pieceId: string,
    jobId: string,
    providerSubmissionKind: StudioPieceProviderSubmissionKindV3,
    providerJobId: string | null
  ): void => {
    const piece = project.pieces[pieceId];
    const job = project.jobs[jobId];
    const publishableJobState =
      job !== undefined &&
      (providerSubmissionKind === 'complete'
        ? pendingIntentOwnsJob(job, 'complete', providerJobId)
        : generatedSubmissionMatches(job, 'remote', providerJobId) &&
          (job.status === 'queued_remote' ||
            job.status === 'running' ||
            (job.status === 'needs_attention' && job.error?.code === 'poll_deadline')));
    if (
      piece === undefined ||
      job === undefined ||
      job.target.pieceId !== piece.id ||
      piece.jobIds.at(-1) !== job.id ||
      piece.currentAssetId !== null ||
      job.outputAssetId !== null ||
      !publishableJobState ||
      Object.values(project.assets).some((asset) =>
        asset.origin === 'generated' ? asset.producerJobId === job.id : false
      )
    ) {
      throw new CreativeStudioPilotServiceErrorV3('job_ineligible');
    }
  };

  const publishGeneratedOutputV3 = async (
    input: StudioPilotGeneratedOutputInputV3
  ): Promise<StudioPilotGeneratedOutputResultV3> => {
    let projectId: string | null = null;
    let crashState: CrashState | null = null;
    try {
      if (
        !isPlainRecord(input) ||
        typeof input.projectId !== 'string' ||
        !SAFE_ID.test(input.projectId) ||
        typeof input.pieceId !== 'string' ||
        !SAFE_ID.test(input.pieceId) ||
        typeof input.jobId !== 'string' ||
        !SAFE_ID.test(input.jobId) ||
        (input.providerSubmissionKind !== 'complete' && input.providerSubmissionKind !== 'remote') ||
        (input.providerSubmissionKind === 'complete'
          ? input.providerJobId !== null
          : !isValidProviderJobId(input.providerJobId)) ||
        !Array.isArray(input.outputs) ||
        (input.signal !== undefined && !(input.signal instanceof AbortSignal))
      ) {
        throw new CreativeStudioPilotServiceErrorV3('invalid_payload');
      }
      projectId = input.projectId;
      if (input.outputs.length !== 1) return invalidMedia();
      const output = input.outputs[0]!;
      if (
        output.mediaKind !== 'image' ||
        output.role !== 'primary' ||
        !MIME_TYPES.has(output.mimeType as StudioPilotImageMimeTypeV3)
      ) {
        return invalidMedia();
      }
      await options.store.withProjectAuthorityV3(input.projectId, async (authority) => {
        assertGeneratedPublicationOwner(
          authority.project,
          input.pieceId,
          input.jobId,
          input.providerSubmissionKind,
          input.providerJobId
        );
      });
      const source = await resolveGeneratedSource(output, input.signal);
      crashState = { preserveResidue: false };
      return await withRecoveredProjectAuthority(input.projectId, async (authority, directories) => {
        const project = authority.project;
        const piece = project.pieces[input.pieceId];
        const job = project.jobs[input.jobId];
        assertGeneratedPublicationOwner(
          project,
          input.pieceId,
          input.jobId,
          input.providerSubmissionKind,
          input.providerJobId
        );
        if (piece === undefined || job === undefined) throw new CreativeStudioPilotServiceErrorV3('job_ineligible');
        if (Object.keys(project.assets).length >= STUDIO_MAX_ASSETS_V3) {
          throw new CreativeStudioPilotServiceErrorV3('project_piece_capacity_reached');
        }
        const assetId = durableIdentity('asset');
        const intentId = durableIdentity('media_intent');
        if (!identityAvailable(project, assetId)) return storageFailure();
        let intent: StudioPilotMediaIntentV3 | null = null;
        let intentPath: string | null = null;
        let commitAttempted = false;
        try {
          let staged: StudioPilotStagedImageV3;
          try {
            staged = await stageSource(directories, source.path, intentId, crashState, project.id, false);
          } catch (error) {
            if (output.source.kind === 'url') {
              throw new CreativeStudioPilotServiceErrorV3('download_failed');
            }
            throw error;
          }
          if (
            staged.mimeType !== output.mimeType ||
            (output.byteSize !== undefined && output.byteSize !== staged.byteSize) ||
            (output.width !== undefined && output.width !== staged.width) ||
            (output.height !== undefined && output.height !== staged.height)
          ) {
            return invalidMedia();
          }
          const variationGrid = await detectVariationGrid(staged.stagePath);
          if (typeof variationGrid !== 'boolean') return invalidMedia();
          if (variationGrid) {
            throw new CreativeStudioPilotServiceErrorV3('variation_grid');
          }
          const createdAt = now();
          const spendReceipt = completionReceipt(project, job, createdAt);
          const finalFileName = `${assetId}.${EXTENSION_BY_MIME[staged.mimeType]}`;
          intent = {
            schemaVersion: MEDIA_INTENT_SCHEMA_VERSION,
            kind: 'generated',
            projectId: project.id,
            pieceId: piece.id,
            assetId,
            jobId: job.id,
            providerSubmissionKind: input.providerSubmissionKind,
            providerJobId: input.providerJobId,
            intentId,
            stageFileName: staged.stageFileName,
            collection: 'assets',
            finalFileName,
            mimeType: staged.mimeType,
            byteSize: staged.byteSize,
            sha256: staged.sha256,
            width: staged.width,
            height: staged.height,
            createdAt,
          };
          intentPath = await publishIntent(directories, intent);
          // For generated media, a durable stage is not recoverable until the exact Piece/Job
          // ownership intent is also durable. Publish that authority before exposing the stage
          // boundary to crash injection or process lifecycle observers.
          await storageStep(crashState, 'media:stage_durable', project.id);
          await storageStep(crashState, 'media:intent_durable', project.id);
          await publishFinal(directories, intent);
          await storageStep(crashState, 'media:final_durable', project.id);
          const generatedAsset: StudioPieceGeneratedAssetV3 = {
            id: assetId,
            projectId: project.id,
            pieceId: piece.id,
            mediaKind: 'image',
            mimeType: staged.mimeType,
            managedAsset: { collection: 'assets', fileName: finalFileName },
            byteSize: staged.byteSize,
            sha256: staged.sha256,
            width: staged.width,
            height: staged.height,
            createdAt,
            origin: 'generated',
            producerJobId: job.id,
            compositionDigest: studioPieceGenerationCompositionDigestV3(job.composition),
          };
          commitAttempted = true;
          const committed = await authority.commit(
            (draft) => {
              const next = structuredClone(draft);
              const nextPiece = next.pieces[piece.id];
              const nextJob = next.jobs[job.id];
              if (nextPiece === undefined || nextJob === undefined) {
                throw new CreativeStudioPilotServiceErrorV3('job_ineligible');
              }
              assertGeneratedPublicationOwner(
                next,
                piece.id,
                job.id,
                input.providerSubmissionKind,
                input.providerJobId
              );
              next.assets[assetId] = generatedAsset;
              nextPiece.currentAssetId = assetId;
              nextPiece.updatedAt = createdAt;
              nextJob.providerSubmissionKind = input.providerSubmissionKind;
              nextJob.status = 'succeeded';
              nextJob.outputAssetId = assetId;
              nextJob.progress = 100;
              nextJob.error = null;
              nextJob.spendReceipt = spendReceipt;
              nextJob.updatedAt = createdAt;
              return next;
            },
            { kind: 'runtime', expectedRevision: project.revision }
          );
          await storageStep(crashState, 'media:project_committed', project.id);
          await settleIntent(directories, committed, intent, intentPath);
          await storageStep(crashState, 'media:cleanup_complete', project.id);
          return {
            status: 'published' as const,
            projectId: project.id,
            pieceId: piece.id,
            jobId: job.id,
            assetId,
            revision: committed.revision,
            authoringRevision: committed.authoringRevision,
          };
        } catch (error) {
          if (!crashState.preserveResidue && !commitAttempted && intent !== null && intentPath !== null) {
            try {
              await markGeneratedIntentDownloadFailure(authority, project, intent);
              commitAttempted = true;
            } catch {
              // The durable intent remains the authority if the failure marker itself cannot commit.
            }
          }
          if (!crashState.preserveResidue && !commitAttempted) {
            if (intent !== null && intentPath !== null) {
              await settleIntent(directories, project, intent, intentPath).catch((): undefined => undefined);
            } else {
              await removeRegularIfPresent(fs, path.join(directories.parts, `${intentId}.part`)).catch(
                (): undefined => undefined
              );
              await syncDirectory(fs, directories.parts).catch((): undefined => undefined);
            }
          }
          throw error;
        }
      }).finally(() => cleanupGeneratedSource(source.cleanup));
    } catch (error) {
      if (projectId !== null && crashState !== null && !crashState.preserveResidue) {
        await recoverAfterAmbiguousCommit(projectId);
      }
      return normalizeCreativeStudioPilotErrorV3(error);
    }
  };

  const verifyManagedAssetV3 = async (input: {
    projectId: string;
    assetId: string;
  }): Promise<StudioPilotVerifiedManagedAssetV3> => {
    try {
      if (
        !isPlainRecord(input) ||
        !hasExactKeys(input, new Set(['projectId', 'assetId'])) ||
        typeof input.projectId !== 'string' ||
        !SAFE_ID.test(input.projectId) ||
        typeof input.assetId !== 'string' ||
        !SAFE_ID.test(input.assetId)
      ) {
        throw new CreativeStudioPilotServiceErrorV3('invalid_payload');
      }
      return await withRecoveredProjectAuthority(input.projectId, async (authority, directories) => {
        const asset = authority.project.assets[input.assetId];
        if (asset === undefined) throw new CreativeStudioPilotServiceErrorV3('not_found');
        const absolutePath = path.join(
          asset.managedAsset.collection === 'imports' ? directories.imports : directories.assets,
          asset.managedAsset.fileName
        );
        if (!MIME_TYPES.has(asset.mimeType as StudioPilotImageMimeTypeV3)) return invalidMedia();
        await verifyFileFacts(absolutePath, {
          ...asset,
          mimeType: asset.mimeType as StudioPilotImageMimeTypeV3,
        });
        return { asset: structuredClone(asset), absolutePath };
      });
    } catch (error) {
      return normalizeCreativeStudioPilotErrorV3(error);
    }
  };

  return {
    importPhotoV3,
    publishGeneratedOutputV3,
    recoverGeneratedJobV3,
    inspectGeneratedOutputClaimUnderAuthorityV3,
    recoverProjectMediaV3,
    async recoverAllMediaV3() {
      const inventory = await options.store.inspectProjectsV3();
      for (const projectId of inventory.healthyProjectIds) {
        // Bound recovery to one project authority at a time so a corrupt project cannot stop later entries.
        // eslint-disable-next-line no-await-in-loop
        await recoverProjectMediaV3(projectId).catch((): undefined => undefined);
      }
    },
    verifyManagedAssetV3,
  };
};
