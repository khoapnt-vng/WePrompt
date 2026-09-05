/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-disable no-await-in-loop -- Filesystem proof and durability steps must remain ordered. */

import { createHash, randomUUID } from 'node:crypto';
import { constants as fsConstants, promises as fs } from 'node:fs';
import path from 'node:path';
import {
  STUDIO_MAX_EXPORT_DIRECTORY_DEPTH,
  STUDIO_MAX_EXPORT_FILES_PER_ARTIFACT,
  STUDIO_MAX_EXPORTS_PER_SHAPE,
  STUDIO_MAX_BEATS,
  STUDIO_MAX_SHOT_SECONDS,
  STUDIO_MAX_SHOTS_PER_PROJECT,
  STUDIO_EXPORT_SHAPES,
  STUDIO_EXPORT_SCHEMA_VERSION_V2,
  STUDIO_FILM_EXPORT_AUDIO_CHANNELS,
  STUDIO_FILM_EXPORT_AUDIO_SAMPLE_RATE,
  STUDIO_FILM_EXPORT_BED_GAIN,
  STUDIO_FILM_EXPORT_FACTS_SCHEMA_VERSION,
  STUDIO_FILM_EXPORT_FACTS_SCHEMA_VERSION_V1,
  STUDIO_FILM_EXPORT_FRAME_RATE,
  STUDIO_FILM_EXPORT_TAKE_GAIN,
  STUDIO_BED_FADE_OUT_SECONDS,
  type StudioCopyExportResultV2,
  type StudioExportArtifactV2,
  type StudioExportArtifactRequestV2,
  type StudioExportCatalogV2,
  type StudioExportShapeV2,
  type StudioFilmExportFactsAnyV2,
  type StudioFilmExportFactsV2,
  type StudioProjectV2,
  type StudioRendererExportCatalogV2,
} from '@/common/types/project/creativeStudioTypes';

const SAFE_ID = /^[A-Za-z0-9_-]{1,256}$/;
const LOWERCASE_SHA256 = /^[a-f0-9]{64}$/;
const DECIMAL_IDENTITY = /^(?:0|[1-9][0-9]*)$/;
const SAFE_PATH_SEGMENT = /^[A-Za-z0-9._-]{1,256}$/;
const ARTIFACT_KEYS = [
  'schemaVersion',
  'id',
  'projectId',
  'sourceRevision',
  'shape',
  'payloadKind',
  'managedExport',
  'byteSize',
  'payloadFileCount',
  'manifestSha256',
  'createdAt',
] as const;
const FILM_ARTIFACT_KEYS = [...ARTIFACT_KEYS, 'film'] as const;
const FILM_FACT_KEYS = [
  'schemaVersion',
  'nominalDurationSeconds',
  'renderedDurationSeconds',
  'transition',
  'dissolveCount',
  'trimTails',
  'segments',
  'video',
  'audio',
] as const;
const FILM_SHOT_SEGMENT_KEYS_V1 = [
  'kind',
  'shotId',
  'sourceAssetId',
  'sourceSha256',
  'sourceInSeconds',
  'sourceOutSeconds',
  'renderedSourceOutSeconds',
  'normalizedDurationSeconds',
  'chainBreak',
  'hasAudio',
] as const;
const FILM_SHOT_SEGMENT_KEYS_V2 = [
  'kind',
  'shotId',
  'sourceAssetId',
  'sourceSha256',
  'sourceInSeconds',
  'sourceOutSeconds',
  'effectiveSourceOutSeconds',
  'renderedSourceOutSeconds',
  'normalizedDurationSeconds',
  'chainBreak',
  'hasAudio',
] as const;
const FILM_SLATE_SEGMENT_KEYS = ['kind', 'beatId', 'shotId', 'durationSeconds', 'normalizedDurationSeconds'] as const;
const FILM_VIDEO_KEYS = [
  'container',
  'codec',
  'encoder',
  'profile',
  'level',
  'width',
  'height',
  'frameRate',
  'pixelFormat',
  'scaleMode',
  'sampleAspectRatio',
  'colorPrimaries',
  'colorTransfer',
  'colorSpace',
  'colorRange',
  'gopFrames',
  'bitrate',
  'trackTimeBase',
  'metadataStripped',
  'chaptersStripped',
  'fastStart',
] as const;
const FILM_AUDIO_KEYS = [
  'codec',
  'sampleRate',
  'channels',
  'channelLayout',
  'sampleFormat',
  'bitrate',
  'silenceForMissingStreams',
  'takeGain',
  'bedAssetId',
  'bedSha256',
  'bedGain',
  'bedFadeOutSeconds',
  'bedFadeCurve',
  'dissolveCrossfade',
  'dissolveCurve',
  'limiterPeak',
  'limiterLatencyCompensated',
] as const;
const CATALOG_KEYS = ['schemaVersion', 'projectId', 'revision', 'artifacts'] as const;
const MANAGED_EXPORT_KEYS = ['collection', 'fileName'] as const;
const MANIFEST_ENTRY_KEYS = ['relativePath', 'byteSize', 'sha256'] as const;
const GENERATED_PLAN_KEYS = ['kind', 'relativePath', 'bytes'] as const;
const VERIFIED_STREAM_PLAN_KEYS = ['kind', 'relativePath', 'byteSize', 'sha256', 'openVerifiedStream'] as const;
const CATALOG_FILE_NAME = 'exports-v2.json';
const CATALOG_TEMP_PREFIX = `.${CATALOG_FILE_NAME}-`;
const CATALOG_TEMP_SUFFIX = '.part';
const ACTIVE_DIRECTORY_NAME = 'exports';
const QUARANTINE_DIRECTORY_NAME = 'exports-quarantine';
const ARTIFACT_RECORD_NAME = 'artifact.json';
const MANIFEST_FILE_NAME = 'manifest.json';
const FINDER_METADATA_FILE_NAME = '.DS_Store';
const CATALOG_MAX_BYTES = 256 * 1024;
const ARTIFACT_RECORD_MAX_BYTES = 64 * 1024;
const MANIFEST_MAX_BYTES = 256 * 1024;
const DEFAULT_MAX_ARTIFACT_BYTES = 5 * 1024 * 1024 * 1024;
const COPY_BUFFER_BYTES = 64 * 1024;
const NO_FOLLOW = typeof fsConstants.O_NOFOLLOW === 'number' ? fsConstants.O_NOFOLLOW : 0;
const NON_BLOCK = typeof fsConstants.O_NONBLOCK === 'number' ? fsConstants.O_NONBLOCK : 0;

export type StudioExportManifestEntryV2 = {
  relativePath: string;
  byteSize: number;
  sha256: string;
};

export type StudioValidatedExportManifestV2 = {
  entries: StudioExportManifestEntryV2[];
  bytes: Uint8Array;
  byteSize: number;
  payloadFileCount: number;
  manifestSha256: string;
};

export type StudioExportCatalogValidationContextV2 = {
  projectId: string;
  currentProjectRevision: number;
};

export type StudioExportCatalogPublicationInputV2 = StudioExportCatalogValidationContextV2 & {
  expectedCatalogRevision: number;
  artifact: StudioExportArtifactV2;
};

export type StudioExportCatalogPublicationV2 = {
  catalog: StudioExportCatalogV2;
  evictedArtifacts: StudioExportArtifactV2[];
};

export type StudioExportOpenedIdentityV2 = {
  dev: string;
  ino: string;
};

export type StudioExportOpenedPayloadProofV2 = StudioExportOpenedIdentityV2 & {
  relativePath: string;
  nlink: number;
  byteSize: number;
  sha256: string;
};

export type StudioExportArtifactIdentityProofV2 = {
  artifactId: string;
  directory: StudioExportOpenedIdentityV2;
  payloads: StudioExportOpenedPayloadProofV2[];
};

export type StudioExportProjectAuthorityV2 = {
  project: StudioProjectV2;
  projectDir: string;
  assertCurrent?: () => Promise<void>;
  assertActive?: () => void;
};

export type StudioExportManagedByteFactsV2 = Readonly<{
  catalogRevision: number;
  managedByteSize: number;
}>;

export type StudioExportGeneratedPayloadFilePlanV2 = {
  kind: 'generated';
  relativePath: string;
  bytes: Uint8Array;
};

export type StudioExportVerifiedStreamPayloadFilePlanV2 = {
  kind: 'verified_stream';
  relativePath: string;
  byteSize: number;
  sha256: string;
  openVerifiedStream: () => Promise<AsyncIterable<Uint8Array>>;
};

export type StudioExportPayloadFilePlanV2 =
  | StudioExportGeneratedPayloadFilePlanV2
  | StudioExportVerifiedStreamPayloadFilePlanV2;

type StudioExportCreatePlanBaseV2 = {
  expectedProjectRevision: number;
  expectedCatalogRevision: number;
  artifactId: string;
  managedFileName: string;
  createdAt: string;
  files: readonly StudioExportPayloadFilePlanV2[];
};

export type StudioExportCreatePlanV2 =
  | (StudioExportCreatePlanBaseV2 & { shape: Exclude<StudioExportShapeV2, 'film'> })
  | (StudioExportCreatePlanBaseV2 & { shape: 'film'; film: StudioFilmExportFactsV2 });

export type StudioExportCopyDestinationDescriptionV2 = {
  artifactId: string;
  shape: StudioExportShapeV2;
  payloadKind: StudioExportArtifactV2['payloadKind'];
  suggestedName: string;
};

export type StudioExportCopyDestinationPickerV2 = (
  description: StudioExportCopyDestinationDescriptionV2
) => Promise<string | null>;

export type StudioExportCatalogStoreStepV2 =
  | 'payload_staged'
  | 'artifact_staged'
  | 'artifact_published'
  | 'catalog_temp_fsynced'
  | 'catalog_committed'
  | 'copy_temp_closed'
  | 'copy_temp_reproved'
  | 'physical_catalog_descendants_validated'
  | 'eviction_quarantined'
  | 'quarantine_claim_fsynced'
  | 'quarantine_directory_opened';

export type StudioExportCatalogStoreDepsV2 = {
  createNonce?: () => string;
  maxArtifactBytes?: number;
  maxProjectBytes?: number;
  onStep?: (step: StudioExportCatalogStoreStepV2) => void | Promise<void>;
  catalogDirectorySync?: (directoryPath: string) => Promise<void>;
};

export type StudioExportCatalogStoreV2 = {
  list(authority: StudioExportProjectAuthorityV2): Promise<StudioExportCatalogV2>;
  create(authority: StudioExportProjectAuthorityV2, plan: StudioExportCreatePlanV2): Promise<StudioExportCatalogV2>;
  copy(
    authority: StudioExportProjectAuthorityV2,
    request: StudioExportArtifactRequestV2,
    destination: string | StudioExportCopyDestinationPickerV2
  ): Promise<StudioCopyExportResultV2>;
  resolveRevealPath(authority: StudioExportProjectAuthorityV2, request: StudioExportArtifactRequestV2): Promise<string>;
  repair(authority: StudioExportProjectAuthorityV2): Promise<StudioExportCatalogV2>;
  withManagedMediaAuthority<T>(
    authority: StudioExportProjectAuthorityV2,
    operation: (facts: StudioExportManagedByteFactsV2) => Promise<T>
  ): Promise<T>;
};

export type StudioExportCatalogErrorCodeV2 =
  | 'invalid_catalog'
  | 'unsupported_catalog_schema'
  | 'invalid_manifest'
  | 'invalid_identity_proof'
  | 'stale_catalog_revision'
  | 'catalog_revision_overflow'
  | 'invalid_artifact'
  | 'invalid_create_plan'
  | 'stale_project_revision'
  | 'artifact_not_found'
  | 'invalid_destination'
  | 'project_capacity_exceeded'
  | 'storage_error';

export class StudioExportCatalogErrorV2 extends Error {
  readonly code: StudioExportCatalogErrorCodeV2;

  constructor(code: StudioExportCatalogErrorCodeV2) {
    super(code);
    this.name = 'StudioExportCatalogErrorV2';
    this.code = code;
  }
}

const fail = (code: StudioExportCatalogErrorCodeV2): never => {
  throw new StudioExportCatalogErrorV2(code);
};

const isDataRecord = (value: unknown): value is Record<string, unknown> => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !('value' in descriptor) || !descriptor.enumerable) return false;
  }
  return true;
};

const hasExactKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean => {
  const ownKeys = Object.keys(value);
  return ownKeys.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
};

const hasExactOrderedKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean => {
  const ownKeys = Object.keys(value);
  return ownKeys.length === keys.length && ownKeys.every((key, index) => key === keys[index]);
};

const isDenseDataArray = (value: unknown): value is unknown[] => {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return false;
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== value.length + 1 || ownKeys.at(-1) !== 'length') return false;
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (descriptor === undefined || !('value' in descriptor) || !descriptor.enumerable) return false;
  }
  return true;
};

const isSafePositiveInteger = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 1;

const isSafeNonnegativeInteger = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0;

const isCanonicalTimestamp = (value: unknown): value is string => {
  if (typeof value !== 'string' || value.length !== 24) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
};

const decodeExactUtf8 = (bytes: Uint8Array): string => {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return fail('invalid_manifest');
  }
};

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

/** Compares relative paths by their exact UTF-8 bytes. */
export const compareStudioExportRelativePathsV2 = (left: string, right: string): number =>
  Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));

const hasControlCharacter = (value: string): boolean =>
  Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0)!;
    return codePoint <= 0x1f || codePoint === 0x7f;
  });

/** Returns whether a payload path is a bounded, relative POSIX path. */
export const isSafeStudioExportRelativePathV2 = (value: unknown): value is string => {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\\') || hasControlCharacter(value)) {
    return false;
  }
  const segments = value.split('/');
  return (
    segments.length <= STUDIO_MAX_EXPORT_DIRECTORY_DEPTH &&
    segments.every((segment) => SAFE_PATH_SEGMENT.test(segment) && segment !== '.' && segment !== '..')
  );
};

const isReservedCatalogTempName = (value: string): boolean => {
  if (!value.startsWith(CATALOG_TEMP_PREFIX) || !value.endsWith(CATALOG_TEMP_SUFFIX)) return false;
  const nonce = value.slice(CATALOG_TEMP_PREFIX.length, -CATALOG_TEMP_SUFFIX.length);
  return SAFE_ID.test(nonce);
};

const validateManifestEntry = (value: unknown): value is StudioExportManifestEntryV2 =>
  isDataRecord(value) &&
  hasExactOrderedKeys(value, MANIFEST_ENTRY_KEYS) &&
  isSafeStudioExportRelativePathV2(value.relativePath) &&
  isSafeNonnegativeInteger(value.byteSize) &&
  typeof value.sha256 === 'string' &&
  LOWERCASE_SHA256.test(value.sha256);

const validateManifestEntries = (value: unknown): value is StudioExportManifestEntryV2[] => {
  if (
    !isDenseDataArray(value) ||
    value.length < 1 ||
    value.length > STUDIO_MAX_EXPORT_FILES_PER_ARTIFACT ||
    !value.every(validateManifestEntry)
  ) {
    return false;
  }
  let totalBytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const entry = value[index]!;
    if (index > 0 && compareStudioExportRelativePathsV2(value[index - 1]!.relativePath, entry.relativePath) >= 0) {
      return false;
    }
    totalBytes += entry.byteSize;
    if (!Number.isSafeInteger(totalBytes)) return false;
  }
  return true;
};

/** Validates and serializes a manifest to its canonical no-newline bytes. */
export const serializeStudioExportManifestV2 = (entries: readonly StudioExportManifestEntryV2[]): Uint8Array => {
  if (!isDenseDataArray(entries) || !entries.every(isDataRecord)) return fail('invalid_manifest');
  const snapshot = entries.map((entry) => ({
    relativePath: entry.relativePath,
    byteSize: entry.byteSize,
    sha256: entry.sha256,
  }));
  if (!validateManifestEntries(snapshot)) return fail('invalid_manifest');
  return Buffer.from(JSON.stringify(snapshot), 'utf8');
};

/** Exact-key parses and validates the canonical manifest bytes. */
export const parseStudioExportManifestV2 = (bytes: Uint8Array): StudioValidatedExportManifestV2 => {
  const text = decodeExactUtf8(bytes);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return fail('invalid_manifest');
  }
  if (!validateManifestEntries(parsed) || JSON.stringify(parsed) !== text) return fail('invalid_manifest');
  const entries = parsed;
  const byteSize = entries.reduce((total, entry) => total + entry.byteSize, 0);
  return {
    entries,
    bytes: Uint8Array.from(bytes),
    byteSize,
    payloadFileCount: entries.length,
    manifestSha256: sha256(bytes),
  };
};

const compareArtifacts = (left: StudioExportArtifactV2, right: StudioExportArtifactV2): number => {
  if (left.createdAt !== right.createdAt) return left.createdAt < right.createdAt ? -1 : 1;
  if (left.id === right.id) return 0;
  return left.id < right.id ? -1 : 1;
};

const isFinitePositive = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= Number.MAX_SAFE_INTEGER;

const closeEnough = (left: number, right: number): boolean => Math.abs(left - right) <= 0.000_001;

const STUDIO_FILM_DIMENSIONS = new Set([
  '1280x720',
  '720x1280',
  '720x720',
  '960x720',
  '720x960',
  '1920x1080',
  '1080x1920',
  '1080x1080',
  '1440x1080',
  '1080x1440',
]);

const validateFilmFacts = (value: unknown): value is StudioFilmExportFactsAnyV2 => {
  if (
    !isDataRecord(value) ||
    !hasExactKeys(value, FILM_FACT_KEYS) ||
    (value.schemaVersion !== STUDIO_FILM_EXPORT_FACTS_SCHEMA_VERSION &&
      value.schemaVersion !== STUDIO_FILM_EXPORT_FACTS_SCHEMA_VERSION_V1) ||
    !isFinitePositive(value.nominalDurationSeconds) ||
    !isFinitePositive(value.renderedDurationSeconds) ||
    typeof value.trimTails !== 'boolean' ||
    !Number.isSafeInteger(value.dissolveCount) ||
    (value.dissolveCount as number) < 0 ||
    !isDenseDataArray(value.segments) ||
    value.segments.length < 1 ||
    value.segments.length > STUDIO_MAX_SHOTS_PER_PROJECT + STUDIO_MAX_BEATS ||
    !isDataRecord(value.transition) ||
    !isDataRecord(value.video) ||
    !hasExactKeys(value.video, FILM_VIDEO_KEYS) ||
    value.video.container !== 'mp4' ||
    value.video.codec !== 'h264' ||
    (value.video.encoder !== 'h264_videotoolbox' &&
      value.video.encoder !== 'h264_nvenc' &&
      value.video.encoder !== 'h264_qsv' &&
      value.video.encoder !== 'h264_amf' &&
      value.video.encoder !== 'h264_mf') ||
    value.video.profile !== 'high' ||
    value.video.level !== '4.2' ||
    !Number.isSafeInteger(value.video.width) ||
    !Number.isSafeInteger(value.video.height) ||
    !STUDIO_FILM_DIMENSIONS.has(`${value.video.width}x${value.video.height}`) ||
    value.video.frameRate !== STUDIO_FILM_EXPORT_FRAME_RATE ||
    value.video.pixelFormat !== 'yuv420p' ||
    value.video.scaleMode !== 'contain_black_pad' ||
    value.video.sampleAspectRatio !== '1:1' ||
    value.video.colorPrimaries !== 'bt709' ||
    value.video.colorTransfer !== 'bt709' ||
    value.video.colorSpace !== 'bt709' ||
    value.video.colorRange !== 'tv' ||
    value.video.gopFrames !== 48 ||
    (value.video.bitrate !== 8_000_000 && value.video.bitrate !== 12_000_000) ||
    value.video.bitrate !==
      ((value.video.width as number) >= 1920 || (value.video.height as number) >= 1920 ? 12_000_000 : 8_000_000) ||
    value.video.trackTimeBase !== '1/24000' ||
    value.video.metadataStripped !== true ||
    value.video.chaptersStripped !== true ||
    value.video.fastStart !== false ||
    !isDataRecord(value.audio) ||
    !hasExactKeys(value.audio, FILM_AUDIO_KEYS) ||
    value.audio.codec !== 'aac' ||
    value.audio.sampleRate !== STUDIO_FILM_EXPORT_AUDIO_SAMPLE_RATE ||
    value.audio.channels !== STUDIO_FILM_EXPORT_AUDIO_CHANNELS ||
    value.audio.channelLayout !== 'stereo' ||
    value.audio.sampleFormat !== 'fltp' ||
    value.audio.bitrate !== 192_000 ||
    value.audio.silenceForMissingStreams !== true ||
    typeof value.audio.takeGain !== 'number' ||
    !Number.isFinite(value.audio.takeGain) ||
    value.audio.takeGain <= 0 ||
    value.audio.takeGain > 1 ||
    typeof value.audio.dissolveCrossfade !== 'boolean' ||
    value.audio.dissolveCurve !== 'triangular' ||
    value.audio.limiterPeak !== 0.95 ||
    value.audio.limiterLatencyCompensated !== true
  ) {
    return false;
  }
  const transitionSeconds = (() => {
    if (hasExactKeys(value.transition, ['kind']) && value.transition.kind === 'cut') return 0;
    if (
      hasExactKeys(value.transition, ['kind', 'requestedSeconds', 'seconds']) &&
      value.transition.kind === 'dissolve' &&
      isFinitePositive(value.transition.requestedSeconds) &&
      value.transition.requestedSeconds >= 1 / STUDIO_FILM_EXPORT_FRAME_RATE &&
      value.transition.requestedSeconds <= 1 &&
      isFinitePositive(value.transition.seconds) &&
      value.transition.seconds >= 1 / STUDIO_FILM_EXPORT_FRAME_RATE &&
      value.transition.seconds <= value.transition.requestedSeconds &&
      value.transition.requestedSeconds - value.transition.seconds <
        1 / STUDIO_FILM_EXPORT_FRAME_RATE + Number.EPSILON &&
      closeEnough(
        value.transition.seconds * STUDIO_FILM_EXPORT_FRAME_RATE,
        Math.round(value.transition.seconds * STUDIO_FILM_EXPORT_FRAME_RATE)
      )
    ) {
      return value.transition.seconds;
    }
    return null;
  })();
  if (
    transitionSeconds === null ||
    (value.dissolveCount as number) > value.segments.length - 1 ||
    (transitionSeconds === 0 && value.dissolveCount !== 0) ||
    value.audio.dissolveCrossfade !== (value.dissolveCount as number) > 0
  ) {
    return false;
  }
  if (value.audio.bedAssetId === null) {
    if (
      value.audio.takeGain !== 1 ||
      value.audio.bedSha256 !== null ||
      value.audio.bedGain !== null ||
      value.audio.bedFadeOutSeconds !== null ||
      value.audio.bedFadeCurve !== null
    ) {
      return false;
    }
  } else if (
    typeof value.audio.bedAssetId !== 'string' ||
    !SAFE_ID.test(value.audio.bedAssetId) ||
    typeof value.audio.bedSha256 !== 'string' ||
    !LOWERCASE_SHA256.test(value.audio.bedSha256) ||
    typeof value.audio.bedGain !== 'number' ||
    !Number.isFinite(value.audio.bedGain) ||
    value.audio.bedGain <= 0 ||
    value.audio.bedGain !== STUDIO_FILM_EXPORT_BED_GAIN ||
    value.audio.takeGain !== STUDIO_FILM_EXPORT_TAKE_GAIN ||
    typeof value.audio.bedFadeOutSeconds !== 'number' ||
    !Number.isFinite(value.audio.bedFadeOutSeconds) ||
    value.audio.bedFadeOutSeconds < 0 ||
    !closeEnough(value.audio.bedFadeOutSeconds, Math.min(STUDIO_BED_FADE_OUT_SECONDS, value.renderedDurationSeconds)) ||
    value.audio.bedFadeCurve !== 'triangular'
  ) {
    return false;
  }

  const identities = new Set<string>();
  const representedShotIds = new Set<string>();
  const currentFacts = value.schemaVersion === STUDIO_FILM_EXPORT_FACTS_SCHEMA_VERSION;
  let nominalDuration = 0;
  let renderedDurationBeforeTransitions = 0;
  let finalShot: { effectiveSourceOutSeconds: number; renderedSourceOutSeconds: number } | null = null;
  const validatedSegments: Array<
    | { kind: 'shot'; chainBreak: 'none' | 'hard_cut'; normalizedDurationSeconds: number }
    | { kind: 'slate'; normalizedDurationSeconds: number }
  > = [];
  for (const segment of value.segments) {
    if (!isDataRecord(segment)) return false;
    if (segment.kind === 'shot') {
      if (!hasExactKeys(segment, currentFacts ? FILM_SHOT_SEGMENT_KEYS_V2 : FILM_SHOT_SEGMENT_KEYS_V1)) return false;
      const effectiveSourceOutSeconds = currentFacts ? segment.effectiveSourceOutSeconds : segment.sourceOutSeconds;
      if (
        typeof segment.shotId !== 'string' ||
        !SAFE_ID.test(segment.shotId) ||
        typeof segment.sourceAssetId !== 'string' ||
        !SAFE_ID.test(segment.sourceAssetId) ||
        typeof segment.sourceSha256 !== 'string' ||
        !LOWERCASE_SHA256.test(segment.sourceSha256) ||
        representedShotIds.has(segment.shotId) ||
        typeof segment.sourceInSeconds !== 'number' ||
        !Number.isFinite(segment.sourceInSeconds) ||
        segment.sourceInSeconds < 0 ||
        !isFinitePositive(segment.sourceOutSeconds) ||
        !isFinitePositive(effectiveSourceOutSeconds) ||
        !isFinitePositive(segment.renderedSourceOutSeconds) ||
        !isFinitePositive(segment.normalizedDurationSeconds) ||
        segment.sourceOutSeconds <= segment.sourceInSeconds ||
        (!currentFacts && segment.sourceOutSeconds - segment.sourceInSeconds > STUDIO_MAX_SHOT_SECONDS) ||
        effectiveSourceOutSeconds <= segment.sourceInSeconds ||
        effectiveSourceOutSeconds > segment.sourceOutSeconds ||
        segment.renderedSourceOutSeconds <= segment.sourceInSeconds ||
        segment.renderedSourceOutSeconds > effectiveSourceOutSeconds ||
        effectiveSourceOutSeconds - segment.renderedSourceOutSeconds > 1 + 0.000_001 ||
        segment.normalizedDurationSeconds > segment.renderedSourceOutSeconds - segment.sourceInSeconds ||
        segment.renderedSourceOutSeconds - segment.sourceInSeconds - segment.normalizedDurationSeconds >=
          1 / STUDIO_FILM_EXPORT_FRAME_RATE + Number.EPSILON ||
        !closeEnough(
          segment.normalizedDurationSeconds * STUDIO_FILM_EXPORT_FRAME_RATE,
          Math.round(segment.normalizedDurationSeconds * STUDIO_FILM_EXPORT_FRAME_RATE)
        ) ||
        (segment.chainBreak !== 'none' && segment.chainBreak !== 'hard_cut') ||
        typeof segment.hasAudio !== 'boolean'
      ) {
        return false;
      }
      identities.add(`shot:${segment.shotId}`);
      representedShotIds.add(segment.shotId);
      validatedSegments.push({
        kind: 'shot',
        chainBreak: segment.chainBreak,
        normalizedDurationSeconds: segment.normalizedDurationSeconds,
      });
      finalShot = { effectiveSourceOutSeconds, renderedSourceOutSeconds: segment.renderedSourceOutSeconds };
      nominalDuration += segment.sourceOutSeconds - segment.sourceInSeconds;
      renderedDurationBeforeTransitions += segment.normalizedDurationSeconds;
      if (!value.trimTails && segment.renderedSourceOutSeconds !== effectiveSourceOutSeconds) return false;
      if (
        segment.renderedSourceOutSeconds !== effectiveSourceOutSeconds &&
        segment.normalizedDurationSeconds + Number.EPSILON < 1 + transitionSeconds
      ) {
        return false;
      }
    } else if (segment.kind === 'slate') {
      if (
        !hasExactKeys(segment, FILM_SLATE_SEGMENT_KEYS) ||
        typeof segment.beatId !== 'string' ||
        !SAFE_ID.test(segment.beatId) ||
        (segment.shotId !== null && (typeof segment.shotId !== 'string' || !SAFE_ID.test(segment.shotId))) ||
        (typeof segment.shotId === 'string' && representedShotIds.has(segment.shotId)) ||
        identities.has(`slate:${segment.beatId}:${segment.shotId ?? 'empty'}`) ||
        !isFinitePositive(segment.durationSeconds) ||
        segment.durationSeconds > (segment.shotId === null ? 1_440 : STUDIO_MAX_SHOT_SECONDS) ||
        !isFinitePositive(segment.normalizedDurationSeconds) ||
        segment.normalizedDurationSeconds > segment.durationSeconds ||
        segment.durationSeconds - segment.normalizedDurationSeconds >=
          1 / STUDIO_FILM_EXPORT_FRAME_RATE + Number.EPSILON ||
        !closeEnough(
          segment.normalizedDurationSeconds * STUDIO_FILM_EXPORT_FRAME_RATE,
          Math.round(segment.normalizedDurationSeconds * STUDIO_FILM_EXPORT_FRAME_RATE)
        )
      ) {
        return false;
      }
      identities.add(`slate:${segment.beatId}:${segment.shotId ?? 'empty'}`);
      if (typeof segment.shotId === 'string') representedShotIds.add(segment.shotId);
      validatedSegments.push({ kind: 'slate', normalizedDurationSeconds: segment.normalizedDurationSeconds });
      nominalDuration += segment.durationSeconds;
      renderedDurationBeforeTransitions += segment.normalizedDurationSeconds;
    } else {
      return false;
    }
  }
  if (finalShot !== null && finalShot.renderedSourceOutSeconds !== finalShot.effectiveSourceOutSeconds) {
    return false;
  }
  let derivedDissolveCount = 0;
  for (let index = 1; index < validatedSegments.length; index += 1) {
    const previous = validatedSegments[index - 1]!;
    const current = validatedSegments[index]!;
    if (transitionSeconds > 0 && previous.kind === 'shot' && current.kind === 'shot' && current.chainBreak === 'none') {
      if (
        previous.normalizedDurationSeconds <= transitionSeconds ||
        current.normalizedDurationSeconds <= transitionSeconds
      ) {
        return false;
      }
      derivedDissolveCount += 1;
    }
  }
  if (derivedDissolveCount !== value.dissolveCount) return false;
  const renderedDuration = renderedDurationBeforeTransitions - transitionSeconds * (value.dissolveCount as number);
  return (
    closeEnough(nominalDuration, value.nominalDurationSeconds) &&
    closeEnough(renderedDuration, value.renderedDurationSeconds)
  );
};

const validateArtifact = (
  value: unknown,
  context: StudioExportCatalogValidationContextV2
): value is StudioExportArtifactV2 => {
  if (
    !isDataRecord(value) ||
    !hasExactKeys(value, value.shape === 'film' ? FILM_ARTIFACT_KEYS : ARTIFACT_KEYS) ||
    value.schemaVersion !== STUDIO_EXPORT_SCHEMA_VERSION_V2 ||
    typeof value.id !== 'string' ||
    !SAFE_ID.test(value.id) ||
    value.projectId !== context.projectId ||
    !isSafePositiveInteger(value.sourceRevision) ||
    value.sourceRevision > context.currentProjectRevision ||
    (value.shape !== 'editor_folder' &&
      value.shape !== 'still' &&
      value.shape !== 'script' &&
      value.shape !== 'film') ||
    !isDataRecord(value.managedExport) ||
    !hasExactKeys(value.managedExport, MANAGED_EXPORT_KEYS) ||
    value.managedExport.collection !== 'exports' ||
    typeof value.managedExport.fileName !== 'string' ||
    !SAFE_ID.test(value.managedExport.fileName) ||
    !isSafeNonnegativeInteger(value.byteSize) ||
    !isSafePositiveInteger(value.payloadFileCount) ||
    typeof value.manifestSha256 !== 'string' ||
    !LOWERCASE_SHA256.test(value.manifestSha256) ||
    !isCanonicalTimestamp(value.createdAt)
  ) {
    return false;
  }
  if (value.shape === 'editor_folder') {
    return value.payloadKind === 'directory' && value.payloadFileCount <= STUDIO_MAX_EXPORT_FILES_PER_ARTIFACT;
  }
  if (value.shape === 'film')
    return (
      value.payloadKind === 'file' &&
      value.payloadFileCount === 1 &&
      value.byteSize > 0 &&
      validateFilmFacts(value.film)
    );
  return value.payloadKind === 'file' && value.payloadFileCount === 1;
};

/** Validates a raw catalog against its owning project and current project revision. */
export const validateStudioExportCatalogV2 = (
  value: unknown,
  context: StudioExportCatalogValidationContextV2
): value is StudioExportCatalogV2 => {
  if (
    !SAFE_ID.test(context.projectId) ||
    !isSafePositiveInteger(context.currentProjectRevision) ||
    !isDataRecord(value) ||
    !hasExactKeys(value, CATALOG_KEYS) ||
    value.schemaVersion !== STUDIO_EXPORT_SCHEMA_VERSION_V2 ||
    value.projectId !== context.projectId ||
    !isSafePositiveInteger(value.revision) ||
    !isDenseDataArray(value.artifacts) ||
    value.artifacts.length > STUDIO_MAX_EXPORTS_PER_SHAPE * STUDIO_EXPORT_SHAPES.length ||
    !value.artifacts.every((artifact) => validateArtifact(artifact, context))
  ) {
    return false;
  }

  const artifactIds = new Set<string>();
  const managedNames = new Set<string>();
  const shapeCounts = new Map<StudioExportArtifactV2['shape'], number>();
  for (let index = 0; index < value.artifacts.length; index += 1) {
    const artifact = value.artifacts[index]!;
    if (
      artifactIds.has(artifact.id) ||
      managedNames.has(artifact.managedExport.fileName) ||
      (index > 0 && compareArtifacts(value.artifacts[index - 1]!, artifact) >= 0)
    ) {
      return false;
    }
    artifactIds.add(artifact.id);
    managedNames.add(artifact.managedExport.fileName);
    const count = (shapeCounts.get(artifact.shape) ?? 0) + 1;
    if (count > STUDIO_MAX_EXPORTS_PER_SHAPE) return false;
    shapeCounts.set(artifact.shape, count);
  }
  return true;
};

/** Returns the absent-catalog logical state without performing I/O. */
export const createLogicalStudioExportCatalogV2 = (projectId: string): StudioExportCatalogV2 => {
  if (!SAFE_ID.test(projectId)) return fail('invalid_catalog');
  return { schemaVersion: STUDIO_EXPORT_SCHEMA_VERSION_V2, projectId, revision: 1, artifacts: [] };
};

/** Exact-key parses canonical catalog bytes; absent bytes remain a non-writing logical catalog. */
export const parseStudioExportCatalogV2 = (
  bytes: Uint8Array | null,
  context: StudioExportCatalogValidationContextV2
): StudioExportCatalogV2 => {
  if (bytes === null) return createLogicalStudioExportCatalogV2(context.projectId);
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return fail('invalid_catalog');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return fail('invalid_catalog');
  }
  if (
    isDataRecord(parsed) &&
    parsed.projectId === context.projectId &&
    isSafePositiveInteger(parsed.schemaVersion) &&
    parsed.schemaVersion !== STUDIO_EXPORT_SCHEMA_VERSION_V2
  ) {
    return fail('unsupported_catalog_schema');
  }
  if (!validateStudioExportCatalogV2(parsed, context) || JSON.stringify(parsed) !== text) {
    return fail('invalid_catalog');
  }
  return parsed;
};

/** Serializes an exact validated catalog to canonical no-newline UTF-8 bytes. */
export const serializeStudioExportCatalogV2 = (
  catalog: StudioExportCatalogV2,
  context: StudioExportCatalogValidationContextV2
): Uint8Array => {
  if (!validateStudioExportCatalogV2(catalog, context)) return fail('invalid_catalog');
  return Buffer.from(JSON.stringify(catalog), 'utf8');
};

/** Removes every managed/storage authority field before a catalog crosses to the renderer. */
export const projectStudioRendererExportCatalogV2 = (
  catalog: StudioExportCatalogV2
): StudioRendererExportCatalogV2 => ({
  revision: catalog.revision,
  artifacts: catalog.artifacts.map((artifact) => {
    const projected = {
      id: artifact.id,
      sourceRevision: artifact.sourceRevision,
      folderName: artifact.managedExport.fileName,
      byteSize: artifact.byteSize,
      payloadFileCount: artifact.payloadFileCount,
      createdAt: artifact.createdAt,
    };
    if (artifact.shape === 'film') {
      const trimmedShotCount =
        artifact.film.schemaVersion === STUDIO_FILM_EXPORT_FACTS_SCHEMA_VERSION
          ? artifact.film.segments.filter(
              (segment) =>
                segment.kind === 'shot' && segment.renderedSourceOutSeconds < segment.effectiveSourceOutSeconds
            ).length
          : artifact.film.segments.filter(
              (segment) => segment.kind === 'shot' && segment.renderedSourceOutSeconds < segment.sourceOutSeconds
            ).length;
      return {
        ...projected,
        shape: 'film' as const,
        film: {
          nominalDurationSeconds: artifact.film.nominalDurationSeconds,
          renderedDurationSeconds: artifact.film.renderedDurationSeconds,
          transition: structuredClone(artifact.film.transition),
          trimTails: artifact.film.trimTails,
          trimmedShotCount,
        },
      };
    }
    return { ...projected, shape: artifact.shape };
  }),
});

/** Plans one CAS publication and exact per-shape retention update without touching storage. */
export const publishStudioExportArtifactInCatalogV2 = (
  catalog: StudioExportCatalogV2,
  input: StudioExportCatalogPublicationInputV2
): StudioExportCatalogPublicationV2 => {
  if (!validateStudioExportCatalogV2(catalog, input)) return fail('invalid_catalog');
  if (!isSafePositiveInteger(input.expectedCatalogRevision) || input.expectedCatalogRevision !== catalog.revision) {
    return fail('stale_catalog_revision');
  }
  if (catalog.revision === Number.MAX_SAFE_INTEGER) return fail('catalog_revision_overflow');
  if (
    !validateArtifact(input.artifact, input) ||
    input.artifact.sourceRevision !== input.currentProjectRevision ||
    catalog.artifacts.some(
      (artifact) =>
        artifact.id === input.artifact.id || artifact.managedExport.fileName === input.artifact.managedExport.fileName
    )
  ) {
    return fail('invalid_artifact');
  }

  const ordered = [...catalog.artifacts, structuredClone(input.artifact)].toSorted(compareArtifacts);
  const retainedIds = new Set<string>();
  for (const shape of STUDIO_EXPORT_SHAPES) {
    const artifacts = ordered.filter((artifact) => artifact.shape === shape);
    for (const artifact of artifacts.slice(-STUDIO_MAX_EXPORTS_PER_SHAPE)) retainedIds.add(artifact.id);
  }
  const artifacts = ordered.filter((artifact) => retainedIds.has(artifact.id));
  const evictedArtifacts = ordered.filter((artifact) => !retainedIds.has(artifact.id));
  const next: StudioExportCatalogV2 = {
    schemaVersion: STUDIO_EXPORT_SCHEMA_VERSION_V2,
    projectId: catalog.projectId,
    revision: catalog.revision + 1,
    artifacts,
  };
  if (!validateStudioExportCatalogV2(next, input)) return fail('invalid_catalog');
  return { catalog: next, evictedArtifacts };
};

const identityKey = (identity: StudioExportOpenedIdentityV2): string | null => {
  if (!DECIMAL_IDENTITY.test(identity.dev) || !DECIMAL_IDENTITY.test(identity.ino)) return null;
  return `${identity.dev}:${identity.ino}`;
};

/**
 * Validates the catalog-wide directory and payload identity proof produced by no-follow filesystem
 * opens. The caller remains responsible for reproving metadata before and after hashing.
 */
export const validateStudioExportCatalogIdentityProofsV2 = (
  catalog: StudioExportCatalogV2,
  context: StudioExportCatalogValidationContextV2,
  proofs: readonly StudioExportArtifactIdentityProofV2[]
): boolean => {
  if (!validateStudioExportCatalogV2(catalog, context) || proofs.length !== catalog.artifacts.length) return false;
  const proofsById = new Map(proofs.map((proof) => [proof.artifactId, proof]));
  if (proofsById.size !== proofs.length) return false;
  const directoryIdentities = new Set<string>();
  const payloadIdentities = new Set<string>();

  for (const artifact of catalog.artifacts) {
    const proof = proofsById.get(artifact.id);
    if (proof === undefined) return false;
    const directoryKey = identityKey(proof.directory);
    if (directoryKey === null || directoryIdentities.has(directoryKey)) return false;
    directoryIdentities.add(directoryKey);

    const entries = proof.payloads.map(({ relativePath, byteSize, sha256: digest }) => ({
      relativePath,
      byteSize,
      sha256: digest,
    }));
    const manifestBytes = serializeStudioExportManifestV2(entries);
    if (
      !validateManifestEntries(entries) ||
      entries.length !== artifact.payloadFileCount ||
      entries.reduce((total, entry) => total + entry.byteSize, 0) !== artifact.byteSize ||
      sha256(manifestBytes) !== artifact.manifestSha256 ||
      (artifact.shape === 'film' &&
        (entries.length !== 1 || entries[0]?.relativePath !== 'film.mp4' || entries[0].byteSize < 1))
    ) {
      return false;
    }
    for (const payload of proof.payloads) {
      const payloadKey = identityKey(payload);
      if (payload.nlink !== 1 || payloadKey === null || payloadIdentities.has(payloadKey)) return false;
      payloadIdentities.add(payloadKey);
    }
  }
  return true;
};

type ExactFileIdentity = {
  dev: string;
  ino: string;
  size: number;
  mtimeMs: number;
  ctimeMs: number;
  nlink: number;
};

type CatalogReadState = {
  catalog: StudioExportCatalogV2;
  identity: ExactFileIdentity | null;
};

type PhysicalArtifact = {
  artifact: StudioExportArtifactV2;
  rootPath: string;
  manifest: StudioValidatedExportManifestV2;
  payloadPaths: Map<string, string>;
  treeProof: PhysicalTreeProof;
};

type PhysicalCatalog = CatalogReadState & {
  activeProof: PhysicalDirectoryProof | null;
  activeFinderMetadataFiles: Map<string, PhysicalFileProof>;
  artifacts: Map<string, PhysicalArtifact>;
};

type PhysicalDirectoryProof = {
  path: string;
  identity: ExactFileIdentity;
  childNames: readonly string[];
};

type PhysicalFileProof = {
  path: string;
  identity: ExactFileIdentity;
};

type PhysicalTreeNodeProof = {
  kind: 'file' | 'directory';
  identity: ExactFileIdentity;
};

type PhysicalTreeProof = {
  nodes: Map<string, PhysicalTreeNodeProof>;
};

type CopyDestinationAuthority = {
  parentPath: string;
  identity: ExactFileIdentity;
};

type CopyOwnedNode = {
  kind: 'file' | 'directory';
  dev: string;
  ino: string;
};

type CopyTempOwnership = CopyOwnedNode & {
  nodes: Map<string, CopyOwnedNode>;
};

type CopyOwnedProofNode = {
  kind: CopyOwnedNode['kind'];
  identity: ExactFileIdentity;
};

type CopyTempProof = {
  ownership: CopyTempOwnership;
  entries: readonly StudioExportManifestEntryV2[];
  nodes: Map<string, CopyOwnedProofNode>;
};

type QuarantineNodeProof =
  | {
      kind: 'directory';
      identity: ExactFileIdentity;
      children: Map<string, QuarantineNodeProof>;
    }
  | {
      kind: 'file' | 'symbolic_link' | 'other';
      identity: ExactFileIdentity;
    };

type QuarantineEntrySnapshot = {
  name: string;
  identity: ExactFileIdentity;
};

const exactIdentity = (stats: Awaited<ReturnType<Awaited<ReturnType<typeof fs.open>>['stat']>>): ExactFileIdentity => ({
  dev: String(stats.dev),
  ino: String(stats.ino),
  size: Number(stats.size),
  mtimeMs: Number(stats.mtimeMs),
  ctimeMs: Number(stats.ctimeMs),
  nlink: Number(stats.nlink),
});

const sameIdentity = (left: ExactFileIdentity, right: ExactFileIdentity): boolean =>
  left.dev === right.dev &&
  left.ino === right.ino &&
  left.size === right.size &&
  left.mtimeMs === right.mtimeMs &&
  left.ctimeMs === right.ctimeMs &&
  left.nlink === right.nlink;

const sameNodeIdentity = (
  left: Pick<ExactFileIdentity, 'dev' | 'ino'>,
  right: Pick<ExactFileIdentity, 'dev' | 'ino'>
): boolean => left.dev === right.dev && left.ino === right.ino;

const sameMovedIdentity = (left: ExactFileIdentity, right: ExactFileIdentity): boolean =>
  left.dev === right.dev &&
  left.ino === right.ino &&
  left.size === right.size &&
  left.mtimeMs === right.mtimeMs &&
  left.nlink === right.nlink;

const directCopyChildren = (
  expected: ReadonlyMap<string, CopyOwnedNode['kind']>,
  relativeDirectory: string
): string[] => {
  const prefix = relativeDirectory.length === 0 ? '' : `${relativeDirectory}/`;
  return [...expected.keys()]
    .filter((relativePath) => {
      if (relativePath.length === 0 || !relativePath.startsWith(prefix)) return false;
      return !relativePath.slice(prefix.length).includes('/');
    })
    .map((relativePath) => relativePath.slice(prefix.length))
    .toSorted();
};

const asOpenedIdentity = (identity: ExactFileIdentity): StudioExportOpenedIdentityV2 => ({
  dev: identity.dev,
  ino: identity.ino,
});

const mapStorageError = (error: unknown): never => {
  if (error instanceof StudioExportCatalogErrorV2) throw error;
  return fail('storage_error');
};

const isMissing = (error: unknown): boolean => (error as NodeJS.ErrnoException).code === 'ENOENT';

const isAlreadyExists = (error: unknown): boolean => (error as NodeJS.ErrnoException).code === 'EEXIST';

const isHardLinkUnavailable = (error: unknown): boolean =>
  ['EMLINK', 'ENOSYS', 'ENOTSUP', 'EOPNOTSUPP', 'EPERM', 'EXDEV'].includes((error as NodeJS.ErrnoException).code ?? '');

const readVerifiedDirectory = async (directoryPath: string): Promise<ExactFileIdentity> => {
  let handle: Awaited<ReturnType<typeof fs.open>> | null = null;
  try {
    handle = await fs.open(directoryPath, fsConstants.O_RDONLY | NO_FOLLOW);
    const openedStats = await handle.stat();
    const opened = exactIdentity(openedStats);
    const pathBefore = exactIdentity(await fs.lstat(directoryPath));
    if (
      !openedStats.isDirectory() ||
      openedStats.isSymbolicLink() ||
      !sameIdentity(opened, pathBefore) ||
      (await fs.realpath(directoryPath)) !== directoryPath
    ) {
      return fail('storage_error');
    }
    const pathAfter = exactIdentity(await fs.lstat(directoryPath));
    if (!sameIdentity(opened, exactIdentity(await handle.stat())) || !sameIdentity(opened, pathAfter)) {
      return fail('storage_error');
    }
    return opened;
  } finally {
    await handle?.close().catch((): undefined => undefined);
  }
};

const readOptionalVerifiedDirectory = async (directoryPath: string): Promise<ExactFileIdentity | null> => {
  try {
    return await readVerifiedDirectory(directoryPath);
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
};

const sameNames = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length && left.every((name, index) => name === right[index]);

const capturePhysicalDirectoryProof = async (
  directoryPath: string,
  expected?: ExactFileIdentity
): Promise<PhysicalDirectoryProof> => {
  const before = await readVerifiedDirectory(directoryPath);
  if (expected !== undefined && !sameIdentity(before, expected)) return fail('storage_error');
  const childNames = (await fs.readdir(directoryPath)).toSorted();
  const after = await readVerifiedDirectory(directoryPath);
  if (!sameIdentity(before, after)) return fail('storage_error');
  return { path: directoryPath, identity: before, childNames };
};

const reprovePhysicalDirectory = async (proof: PhysicalDirectoryProof): Promise<void> => {
  const current = await capturePhysicalDirectoryProof(proof.path);
  if (!sameIdentity(current.identity, proof.identity) || !sameNames(current.childNames, proof.childNames)) {
    return fail('storage_error');
  }
};

const capturePhysicalDirectoryTransition = async (
  proof: PhysicalDirectoryProof,
  removedName: string | null,
  addedName: string | null
): Promise<PhysicalDirectoryProof> => {
  const expected = new Set(proof.childNames);
  if (removedName !== null && !expected.delete(removedName)) return fail('storage_error');
  if (addedName !== null && expected.has(addedName)) return fail('storage_error');
  if (addedName !== null) expected.add(addedName);
  const current = await capturePhysicalDirectoryProof(proof.path);
  if (!sameNodeIdentity(current.identity, proof.identity) || !sameNames(current.childNames, [...expected].toSorted())) {
    return fail('storage_error');
  }
  return current;
};

const capturePhysicalFileProof = async (filePath: string): Promise<PhysicalFileProof> => {
  let handle: Awaited<ReturnType<typeof fs.open>> | null = null;
  try {
    handle = await fs.open(filePath, fsConstants.O_RDONLY | NO_FOLLOW | NON_BLOCK);
    const openedStats = await handle.stat();
    const opened = exactIdentity(openedStats);
    const pathBeforeStats = await fs.lstat(filePath);
    const pathBefore = exactIdentity(pathBeforeStats);
    if (
      !openedStats.isFile() ||
      openedStats.isSymbolicLink() ||
      pathBeforeStats.isSymbolicLink() ||
      !sameIdentity(opened, pathBefore)
    ) {
      return fail('storage_error');
    }
    const after = exactIdentity(await handle.stat());
    const pathAfter = exactIdentity(await fs.lstat(filePath));
    if (!sameIdentity(opened, after) || !sameIdentity(opened, pathAfter)) return fail('storage_error');
    return { path: filePath, identity: opened };
  } finally {
    await handle?.close().catch((): undefined => undefined);
  }
};

const reprovePhysicalFile = async (proof: PhysicalFileProof): Promise<void> => {
  const current = await capturePhysicalFileProof(proof.path);
  if (!sameIdentity(current.identity, proof.identity)) return fail('storage_error');
};

const physicalTreeNodePath = (rootPath: string, relativePath: string): string =>
  relativePath.length === 0 ? rootPath : path.join(rootPath, ...relativePath.split('/'));

const directPhysicalTreeChildren = (
  nodes: ReadonlyMap<string, PhysicalTreeNodeProof>,
  relativeDirectory: string
): string[] => {
  const prefix = relativeDirectory.length === 0 ? '' : `${relativeDirectory}/`;
  return [...nodes.keys()]
    .filter((relativePath) => {
      if (relativePath.length === 0 || !relativePath.startsWith(prefix)) return false;
      return !relativePath.slice(prefix.length).includes('/');
    })
    .map((relativePath) => relativePath.slice(prefix.length))
    .toSorted();
};

const capturePhysicalTreeProof = async (
  rootPath: string,
  expectedNodes: ReadonlyMap<string, PhysicalTreeNodeProof>,
  mode: 'exact' | 'construction' | 'root_children_changed' | 'moved_root' = 'exact'
): Promise<PhysicalTreeProof> => {
  if (expectedNodes.get('')?.kind !== 'directory') return fail('storage_error');
  const compareIdentity = (
    relativePath: string,
    kind: PhysicalTreeNodeProof['kind'],
    current: ExactFileIdentity,
    expected: ExactFileIdentity
  ): boolean => {
    if (mode === 'construction' && kind === 'directory') return sameNodeIdentity(current, expected);
    if (relativePath === '' && mode === 'root_children_changed') return sameNodeIdentity(current, expected);
    if (relativePath === '' && mode === 'moved_root') return sameMovedIdentity(current, expected);
    return sameIdentity(current, expected);
  };
  const nodes = new Map<string, PhysicalTreeNodeProof>();
  const identities = new Set<string>();
  for (const [relativePath, expected] of expectedNodes) {
    const nodePath = physicalTreeNodePath(rootPath, relativePath);
    let current: PhysicalTreeNodeProof;
    if (expected.kind === 'directory') {
      const proof = await capturePhysicalDirectoryProof(nodePath);
      if (
        !compareIdentity(relativePath, expected.kind, proof.identity, expected.identity) ||
        !sameNames(proof.childNames, directPhysicalTreeChildren(expectedNodes, relativePath))
      ) {
        return fail('storage_error');
      }
      current = { kind: 'directory', identity: proof.identity };
    } else {
      const proof = await capturePhysicalFileProof(nodePath);
      if (!compareIdentity(relativePath, expected.kind, proof.identity, expected.identity))
        return fail('storage_error');
      current = { kind: 'file', identity: proof.identity };
    }
    const key = identityKey(current.identity);
    if (key === null || identities.has(key)) return fail('storage_error');
    identities.add(key);
    nodes.set(relativePath, current);
  }
  for (const [relativePath, proof] of nodes) {
    const nodePath = physicalTreeNodePath(rootPath, relativePath);
    if (proof.kind === 'directory') {
      const current = await capturePhysicalDirectoryProof(nodePath);
      if (
        !sameIdentity(current.identity, proof.identity) ||
        !sameNames(current.childNames, directPhysicalTreeChildren(nodes, relativePath))
      ) {
        return fail('storage_error');
      }
    } else {
      await reprovePhysicalFile({ path: nodePath, identity: proof.identity });
    }
  }
  return { nodes };
};

const samePhysicalTreeProof = (left: PhysicalTreeProof, right: PhysicalTreeProof, movedRoot = false): boolean => {
  if (left.nodes.size !== right.nodes.size) return false;
  for (const [relativePath, leftNode] of left.nodes) {
    const rightNode = right.nodes.get(relativePath);
    if (
      rightNode === undefined ||
      leftNode.kind !== rightNode.kind ||
      !(movedRoot && relativePath === ''
        ? sameMovedIdentity(leftNode.identity, rightNode.identity)
        : sameIdentity(leftNode.identity, rightNode.identity))
    ) {
      return false;
    }
  }
  return true;
};

const reprovePhysicalArtifactLedgers = async (physical: PhysicalCatalog): Promise<void> => {
  for (const artifact of physical.artifacts.values()) {
    const current = await capturePhysicalTreeProof(artifact.rootPath, artifact.treeProof.nodes);
    if (!samePhysicalTreeProof(current, artifact.treeProof)) return fail('storage_error');
  }
};

const reprovePhysicalCatalogLedger = async (
  authority: StudioExportProjectAuthorityV2,
  physical: PhysicalCatalog
): Promise<void> => {
  const activePath = path.join(authority.projectDir, ACTIVE_DIRECTORY_NAME);
  if (physical.activeProof === null) {
    if ((await readOptionalVerifiedDirectory(activePath)) !== null) return fail('storage_error');
  } else {
    await reprovePhysicalDirectory(physical.activeProof);
  }
  for (const proof of physical.activeFinderMetadataFiles.values()) await reprovePhysicalFile(proof);
  await reprovePhysicalArtifactLedgers(physical);
};

const samePhysicalFileProofs = (
  left: ReadonlyMap<string, PhysicalFileProof>,
  right: ReadonlyMap<string, PhysicalFileProof>
): boolean => {
  if (left.size !== right.size) return false;
  for (const [name, leftProof] of left) {
    const rightProof = right.get(name);
    if (
      rightProof === undefined ||
      leftProof.path !== rightProof.path ||
      !sameIdentity(leftProof.identity, rightProof.identity)
    ) {
      return false;
    }
  }
  return true;
};

const retainedArtifactProofsMatch = (
  before: PhysicalCatalog,
  after: PhysicalCatalog,
  newArtifactId: string
): boolean => {
  for (const artifact of after.catalog.artifacts) {
    if (artifact.id === newArtifactId) continue;
    const beforeArtifact = before.artifacts.get(artifact.id);
    const afterArtifact = after.artifacts.get(artifact.id);
    if (
      beforeArtifact === undefined ||
      afterArtifact === undefined ||
      !samePhysicalTreeProof(beforeArtifact.treeProof, afterArtifact.treeProof)
    ) {
      return false;
    }
  }
  return true;
};

const samePhysicalCatalogLedger = (left: PhysicalCatalog, right: PhysicalCatalog): boolean => {
  if (JSON.stringify(left.catalog) !== JSON.stringify(right.catalog) || left.artifacts.size !== right.artifacts.size) {
    return false;
  }
  if (left.identity === null || right.identity === null) {
    if (left.identity !== right.identity) return false;
  } else if (!sameIdentity(left.identity, right.identity)) {
    return false;
  }
  if (left.activeProof === null || right.activeProof === null) {
    if (left.activeProof !== right.activeProof) return false;
  } else if (
    !sameIdentity(left.activeProof.identity, right.activeProof.identity) ||
    !sameNames(left.activeProof.childNames, right.activeProof.childNames)
  ) {
    return false;
  }
  if (!samePhysicalFileProofs(left.activeFinderMetadataFiles, right.activeFinderMetadataFiles)) return false;
  for (const [artifactId, leftArtifact] of left.artifacts) {
    const rightArtifact = right.artifacts.get(artifactId);
    if (rightArtifact === undefined || !samePhysicalTreeProof(leftArtifact.treeProof, rightArtifact.treeProof)) {
      return false;
    }
  }
  return true;
};

const syncDirectory = async (directoryPath: string): Promise<void> => {
  const handle = await fs.open(directoryPath, fsConstants.O_RDONLY | NO_FOLLOW);
  try {
    const stats = await handle.stat();
    if (!stats.isDirectory()) return fail('storage_error');
    await handle.sync();
  } finally {
    await handle.close().catch((): undefined => undefined);
  }
};

const assertAuthority = async (
  authority: StudioExportProjectAuthorityV2
): Promise<StudioExportCatalogValidationContextV2> => {
  if (
    !SAFE_ID.test(authority.project.id) ||
    !isSafePositiveInteger(authority.project.revision) ||
    !path.isAbsolute(authority.projectDir) ||
    path.resolve(authority.projectDir) !== authority.projectDir ||
    path.basename(authority.projectDir) !== authority.project.id ||
    (authority.assertCurrent !== undefined && typeof authority.assertCurrent !== 'function') ||
    (authority.assertActive !== undefined && typeof authority.assertActive !== 'function')
  ) {
    return fail('storage_error');
  }
  authority.assertActive?.();
  await authority.assertCurrent?.();
  await readVerifiedDirectory(authority.projectDir);
  return { projectId: authority.project.id, currentProjectRevision: authority.project.revision };
};

const ensureVerifiedChildDirectory = async (parentPath: string, name: string): Promise<string> => {
  if (!SAFE_PATH_SEGMENT.test(name) || name === '.' || name === '..') return fail('storage_error');
  const directoryPath = path.join(parentPath, name);
  if (path.dirname(directoryPath) !== parentPath) return fail('storage_error');
  try {
    await fs.mkdir(directoryPath, { mode: 0o700 });
    await syncDirectory(parentPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
  await readVerifiedDirectory(directoryPath);
  return directoryPath;
};

const readBoundedFileNoFollow = async (
  filePath: string,
  maxBytes: number,
  nonblocking = false
): Promise<{ bytes: Uint8Array; identity: ExactFileIdentity }> => {
  let handle: Awaited<ReturnType<typeof fs.open>> | null = null;
  try {
    handle = await fs.open(filePath, fsConstants.O_RDONLY | NO_FOLLOW | (nonblocking ? NON_BLOCK : 0));
    const beforeStats = await handle.stat();
    const before = exactIdentity(beforeStats);
    const pathBefore = exactIdentity(await fs.lstat(filePath));
    if (
      !beforeStats.isFile() ||
      beforeStats.isSymbolicLink() ||
      before.nlink !== 1 ||
      before.size < 1 ||
      before.size > maxBytes ||
      !sameIdentity(before, pathBefore)
    ) {
      return fail('storage_error');
    }
    const chunks: Buffer[] = [];
    let byteSize = 0;
    for (;;) {
      const buffer = Buffer.allocUnsafe(Math.min(COPY_BUFFER_BYTES, maxBytes - byteSize + 1));
      const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, null);
      if (bytesRead === 0) break;
      byteSize += bytesRead;
      if (byteSize > maxBytes) return fail('storage_error');
      chunks.push(buffer.subarray(0, bytesRead));
    }
    const after = exactIdentity(await handle.stat());
    const pathAfter = exactIdentity(await fs.lstat(filePath));
    if (byteSize !== before.size || !sameIdentity(before, after) || !sameIdentity(before, pathAfter)) {
      return fail('storage_error');
    }
    return { bytes: Buffer.concat(chunks, byteSize), identity: before };
  } finally {
    await handle?.close().catch((): undefined => undefined);
  }
};

const hashPayloadFileNoFollow = async (
  filePath: string,
  expected: StudioExportManifestEntryV2,
  expectedLinkCount = 1
): Promise<ExactFileIdentity> => {
  let handle: Awaited<ReturnType<typeof fs.open>> | null = null;
  try {
    handle = await fs.open(filePath, fsConstants.O_RDONLY | NO_FOLLOW);
    const beforeStats = await handle.stat();
    const before = exactIdentity(beforeStats);
    const pathBefore = exactIdentity(await fs.lstat(filePath));
    if (
      !beforeStats.isFile() ||
      beforeStats.isSymbolicLink() ||
      before.nlink !== expectedLinkCount ||
      before.size !== expected.byteSize ||
      !sameIdentity(before, pathBefore)
    ) {
      return fail('storage_error');
    }
    const digest = createHash('sha256');
    let byteSize = 0;
    for (;;) {
      const buffer = Buffer.allocUnsafe(COPY_BUFFER_BYTES);
      const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, null);
      if (bytesRead === 0) break;
      byteSize += bytesRead;
      if (byteSize > expected.byteSize) return fail('storage_error');
      digest.update(buffer.subarray(0, bytesRead));
    }
    const after = exactIdentity(await handle.stat());
    const pathAfter = exactIdentity(await fs.lstat(filePath));
    if (
      byteSize !== expected.byteSize ||
      digest.digest('hex') !== expected.sha256 ||
      !sameIdentity(before, after) ||
      !sameIdentity(before, pathAfter)
    ) {
      return fail('storage_error');
    }
    return before;
  } finally {
    await handle?.close().catch((): undefined => undefined);
  }
};

const writeAll = async (handle: Awaited<ReturnType<typeof fs.open>>, bytes: Uint8Array): Promise<void> => {
  let offset = 0;
  while (offset < bytes.byteLength) {
    const { bytesWritten } = await handle.write(bytes, offset, bytes.byteLength - offset, null);
    if (bytesWritten < 1) return fail('storage_error');
    offset += bytesWritten;
  }
};

const writeExactNewFile = async (filePath: string, bytes: Uint8Array): Promise<ExactFileIdentity> => {
  let handle: Awaited<ReturnType<typeof fs.open>> | null = null;
  try {
    handle = await fs.open(
      filePath,
      fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | NO_FOLLOW,
      0o600
    );
    await writeAll(handle, bytes);
    await handle.sync();
    const stats = await handle.stat();
    const identity = exactIdentity(stats);
    const pathIdentity = exactIdentity(await fs.lstat(filePath));
    if (
      !stats.isFile() ||
      identity.nlink !== 1 ||
      identity.size !== bytes.byteLength ||
      !sameIdentity(identity, pathIdentity)
    ) {
      return fail('storage_error');
    }
    return identity;
  } finally {
    await handle?.close().catch((): undefined => undefined);
  }
};

const ensurePayloadParent = async (
  rootPath: string,
  relativePath: string,
  directories: Set<string>,
  treeNodes: Map<string, PhysicalTreeNodeProof>
): Promise<string> => {
  const segments = relativePath.split('/');
  let current = rootPath;
  let relativeDirectory = '';
  for (const segment of segments.slice(0, -1)) {
    current = await ensureVerifiedChildDirectory(current, segment);
    relativeDirectory = relativeDirectory.length === 0 ? segment : `${relativeDirectory}/${segment}`;
    const identity = await readVerifiedDirectory(current);
    const retained = treeNodes.get(relativeDirectory);
    if (retained === undefined) {
      treeNodes.set(relativeDirectory, { kind: 'directory', identity });
    } else if (retained.kind !== 'directory' || !sameNodeIdentity(retained.identity, identity)) {
      return fail('storage_error');
    }
    directories.add(current);
  }
  return current;
};

const writePayloadPlanFile = async (
  rootPath: string,
  plan: StudioExportPayloadFilePlanV2,
  maxBytes: number,
  directories: Set<string>,
  treeNodes: Map<string, PhysicalTreeNodeProof>
): Promise<StudioExportManifestEntryV2> => {
  const parentPath = await ensurePayloadParent(rootPath, plan.relativePath, directories, treeNodes);
  const filePath = path.join(parentPath, path.basename(plan.relativePath));
  if (path.dirname(filePath) !== parentPath) return fail('storage_error');
  const expectedByteSize = plan.kind === 'generated' ? plan.bytes.byteLength : plan.byteSize;
  const expectedDigest = plan.kind === 'generated' ? sha256(plan.bytes) : plan.sha256;
  if (expectedByteSize > maxBytes) return fail('invalid_create_plan');
  const source: AsyncIterable<Uint8Array> =
    plan.kind === 'generated'
      ? (async function* (): AsyncIterable<Uint8Array> {
          yield plan.bytes;
        })()
      : await plan.openVerifiedStream();
  if (source === null || typeof source !== 'object' || !(Symbol.asyncIterator in source)) {
    return fail('invalid_create_plan');
  }

  let handle: Awaited<ReturnType<typeof fs.open>> | null = null;
  try {
    handle = await fs.open(
      filePath,
      fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | NO_FOLLOW,
      0o600
    );
    const digest = createHash('sha256');
    let byteSize = 0;
    for await (const chunk of source) {
      if (!(chunk instanceof Uint8Array)) return fail('storage_error');
      byteSize += chunk.byteLength;
      if (!Number.isSafeInteger(byteSize) || byteSize > expectedByteSize || byteSize > maxBytes) {
        return fail('storage_error');
      }
      digest.update(chunk);
      await writeAll(handle, chunk);
    }
    await handle.sync();
    const stats = await handle.stat();
    const identity = exactIdentity(stats);
    const pathIdentity = exactIdentity(await fs.lstat(filePath));
    if (
      !stats.isFile() ||
      identity.nlink !== 1 ||
      identity.size !== expectedByteSize ||
      byteSize !== expectedByteSize ||
      digest.digest('hex') !== expectedDigest ||
      !sameIdentity(identity, pathIdentity) ||
      treeNodes.has(plan.relativePath)
    ) {
      return fail('storage_error');
    }
    treeNodes.set(plan.relativePath, { kind: 'file', identity });
    return { relativePath: plan.relativePath, byteSize, sha256: expectedDigest };
  } finally {
    await handle?.close().catch((): undefined => undefined);
  }
};

const readCatalogState = async (
  authority: StudioExportProjectAuthorityV2,
  context: StudioExportCatalogValidationContextV2
): Promise<CatalogReadState> => {
  const catalogPath = path.join(authority.projectDir, CATALOG_FILE_NAME);
  try {
    const { bytes, identity } = await readBoundedFileNoFollow(catalogPath, CATALOG_MAX_BYTES);
    return { catalog: parseStudioExportCatalogV2(bytes, context), identity };
  } catch (error) {
    if (isMissing(error)) return { catalog: createLogicalStudioExportCatalogV2(context.projectId), identity: null };
    throw error;
  }
};

const walkPayloadTree = async (
  currentPath: string,
  relativeDirectory: string,
  currentProof: PhysicalDirectoryProof,
  manifestPaths: ReadonlySet<string>,
  files: Map<string, string>,
  directories: Map<string, PhysicalDirectoryProof>,
  finderMetadataFiles: Map<string, PhysicalFileProof>
): Promise<void> => {
  for (const entryName of currentProof.childNames) {
    if (relativeDirectory.length === 0 && (entryName === ARTIFACT_RECORD_NAME || entryName === MANIFEST_FILE_NAME)) {
      continue;
    }
    const relativePath = relativeDirectory.length === 0 ? entryName : `${relativeDirectory}/${entryName}`;
    if (!isSafeStudioExportRelativePathV2(relativePath)) return fail('storage_error');
    const entryPath = path.join(currentPath, entryName);
    if (path.dirname(entryPath) !== currentPath) return fail('storage_error');
    const stats = await fs.lstat(entryPath);
    if (stats.isSymbolicLink()) return fail('storage_error');
    if (stats.isDirectory()) {
      if ((await fs.realpath(entryPath)) !== entryPath) return fail('storage_error');
      const directoryProof = await capturePhysicalDirectoryProof(entryPath, exactIdentity(stats));
      directories.set(relativePath, directoryProof);
      await walkPayloadTree(
        entryPath,
        relativePath,
        directoryProof,
        manifestPaths,
        files,
        directories,
        finderMetadataFiles
      );
      continue;
    }
    if (!stats.isFile() || files.has(relativePath) || (await fs.realpath(entryPath)) !== entryPath) {
      return fail('storage_error');
    }
    if (entryName === FINDER_METADATA_FILE_NAME && !manifestPaths.has(relativePath)) {
      const proof = await capturePhysicalFileProof(entryPath);
      if (proof.identity.nlink !== 1 || finderMetadataFiles.has(relativePath)) return fail('storage_error');
      finderMetadataFiles.set(relativePath, proof);
      continue;
    }
    files.set(relativePath, entryPath);
  }
};

const validatePhysicalCatalog = async (
  authority: StudioExportProjectAuthorityV2,
  context: StudioExportCatalogValidationContextV2,
  state: CatalogReadState,
  onDescendantsValidated?: () => Promise<void>
): Promise<PhysicalCatalog> => {
  const activePath = path.join(authority.projectDir, ACTIVE_DIRECTORY_NAME);
  const activeIdentity = await readOptionalVerifiedDirectory(activePath);
  if (state.catalog.artifacts.length > 0 && activeIdentity === null) return fail('storage_error');
  const directoryProofs: PhysicalDirectoryProof[] = [];
  const fileProofs: PhysicalFileProof[] = [];
  const activeFinderMetadataFiles = new Map<string, PhysicalFileProof>();
  let activeProof: PhysicalDirectoryProof | null = null;
  if (activeIdentity !== null) {
    activeProof = await capturePhysicalDirectoryProof(activePath, activeIdentity);
    directoryProofs.push(activeProof);
    if (activeProof.childNames.includes(FINDER_METADATA_FILE_NAME)) {
      const finderMetadata = await capturePhysicalFileProof(path.join(activePath, FINDER_METADATA_FILE_NAME));
      if (finderMetadata.identity.nlink !== 1) return fail('storage_error');
      fileProofs.push(finderMetadata);
      activeFinderMetadataFiles.set(FINDER_METADATA_FILE_NAME, finderMetadata);
    }
  }
  const artifacts = new Map<string, PhysicalArtifact>();
  const proofs: StudioExportArtifactIdentityProofV2[] = [];

  for (const artifact of state.catalog.artifacts) {
    const rootPath = path.join(activePath, artifact.managedExport.fileName);
    if (path.dirname(rootPath) !== activePath) return fail('storage_error');
    const rootProof = await capturePhysicalDirectoryProof(rootPath);
    const rootIdentity = rootProof.identity;
    directoryProofs.push(rootProof);
    const artifactRecord = await readBoundedFileNoFollow(
      path.join(rootPath, ARTIFACT_RECORD_NAME),
      ARTIFACT_RECORD_MAX_BYTES
    );
    fileProofs.push({ path: path.join(rootPath, ARTIFACT_RECORD_NAME), identity: artifactRecord.identity });
    if (Buffer.from(artifactRecord.bytes).toString('utf8') !== JSON.stringify(artifact)) return fail('storage_error');
    const manifestFile = await readBoundedFileNoFollow(path.join(rootPath, MANIFEST_FILE_NAME), MANIFEST_MAX_BYTES);
    fileProofs.push({ path: path.join(rootPath, MANIFEST_FILE_NAME), identity: manifestFile.identity });
    const manifest = parseStudioExportManifestV2(manifestFile.bytes);
    if (
      manifest.manifestSha256 !== artifact.manifestSha256 ||
      manifest.payloadFileCount !== artifact.payloadFileCount ||
      manifest.byteSize !== artifact.byteSize ||
      (artifact.shape === 'film' &&
        (manifest.entries.length !== 1 ||
          manifest.entries[0]?.relativePath !== 'film.mp4' ||
          manifest.entries[0].byteSize < 1))
    ) {
      return fail('storage_error');
    }

    const payloadPaths = new Map<string, string>();
    const directories = new Map<string, PhysicalDirectoryProof>();
    const manifestPaths = new Set(manifest.entries.map(({ relativePath }) => relativePath));
    const finderMetadataFiles = new Map<string, PhysicalFileProof>();
    await walkPayloadTree(rootPath, '', rootProof, manifestPaths, payloadPaths, directories, finderMetadataFiles);
    directoryProofs.push(...directories.values());
    fileProofs.push(...finderMetadataFiles.values());
    if (
      payloadPaths.size !== manifestPaths.size ||
      [...payloadPaths.keys()].some((relativePath) => !manifestPaths.has(relativePath)) ||
      [...directories.keys()].some(
        (directory) => !manifest.entries.some(({ relativePath }) => relativePath.startsWith(`${directory}/`))
      )
    ) {
      return fail('storage_error');
    }

    const payloads: StudioExportOpenedPayloadProofV2[] = [];
    const treeNodes = new Map<string, PhysicalTreeNodeProof>([
      ['', { kind: 'directory', identity: rootProof.identity }],
      [ARTIFACT_RECORD_NAME, { kind: 'file', identity: artifactRecord.identity }],
      [MANIFEST_FILE_NAME, { kind: 'file', identity: manifestFile.identity }],
      ...[...directories].map(
        ([relativePath, proof]) => [relativePath, { kind: 'directory', identity: proof.identity }] as const
      ),
      ...[...finderMetadataFiles].map(
        ([relativePath, proof]) => [relativePath, { kind: 'file', identity: proof.identity }] as const
      ),
    ]);
    for (const entry of manifest.entries) {
      const payloadPath = payloadPaths.get(entry.relativePath);
      if (payloadPath === undefined) return fail('storage_error');
      const identity = await hashPayloadFileNoFollow(payloadPath, entry);
      fileProofs.push({ path: payloadPath, identity });
      treeNodes.set(entry.relativePath, { kind: 'file', identity });
      payloads.push({
        relativePath: entry.relativePath,
        ...asOpenedIdentity(identity),
        nlink: identity.nlink,
        byteSize: identity.size,
        sha256: entry.sha256,
      });
    }
    proofs.push({ artifactId: artifact.id, directory: asOpenedIdentity(rootIdentity), payloads });
    artifacts.set(artifact.id, { artifact, rootPath, manifest, payloadPaths, treeProof: { nodes: treeNodes } });
  }
  if (!validateStudioExportCatalogIdentityProofsV2(state.catalog, context, proofs)) {
    return fail('invalid_identity_proof');
  }
  await onDescendantsValidated?.();
  for (const proof of fileProofs) await reprovePhysicalFile(proof);
  for (const proof of directoryProofs) await reprovePhysicalDirectory(proof);
  if (activeIdentity === null && (await readOptionalVerifiedDirectory(activePath)) !== null) {
    return fail('storage_error');
  }
  return { ...state, activeProof, activeFinderMetadataFiles, artifacts };
};

const suggestedDirectoryName = (authority: StudioExportProjectAuthorityV2): string => {
  const stem = authority.project.name
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96);
  return `${stem.length === 0 ? 'studio' : stem}-editor-folder`;
};

/** Creates the crash-aware, main-only export catalog filesystem store. */
export const createStudioExportCatalogStoreV2 = (
  deps: StudioExportCatalogStoreDepsV2 = {}
): StudioExportCatalogStoreV2 => {
  const createNonce = deps.createNonce ?? randomUUID;
  const maxArtifactBytes = deps.maxArtifactBytes ?? DEFAULT_MAX_ARTIFACT_BYTES;
  const maxProjectBytes = deps.maxProjectBytes ?? DEFAULT_MAX_ARTIFACT_BYTES;
  const catalogDirectorySync = deps.catalogDirectorySync ?? syncDirectory;
  if (!isSafePositiveInteger(maxArtifactBytes) || !isSafePositiveInteger(maxProjectBytes)) {
    return fail('storage_error');
  }
  const tails = new Map<string, Promise<void>>();

  const nextNonce = (): string => {
    const nonce = createNonce();
    if (!SAFE_ID.test(nonce)) return fail('storage_error');
    return nonce;
  };

  const step = async (value: StudioExportCatalogStoreStepV2): Promise<void> => {
    await deps.onStep?.(value);
  };

  const readRetainedDirectoryNames = async (
    directoryPath: string,
    expected: ExactFileIdentity,
    compareExpected: (current: ExactFileIdentity, retained: ExactFileIdentity) => boolean,
    onOpened?: () => Promise<void>
  ): Promise<string[]> => {
    const before = await readVerifiedDirectory(directoryPath);
    if (!compareExpected(before, expected)) return fail('storage_error');
    const directory = await fs.opendir(directoryPath);
    try {
      const afterOpen = await readVerifiedDirectory(directoryPath);
      if (!sameIdentity(before, afterOpen) || !compareExpected(afterOpen, expected)) {
        return fail('storage_error');
      }
      await onOpened?.();
      const names: string[] = [];
      for (;;) {
        const entry = await directory.read();
        if (entry === null) break;
        names.push(entry.name);
      }
      const afterRead = await readVerifiedDirectory(directoryPath);
      if (!sameIdentity(before, afterRead) || !compareExpected(afterRead, expected)) {
        return fail('storage_error');
      }
      return names.toSorted();
    } finally {
      await directory.close().catch((): undefined => undefined);
    }
  };

  const captureQuarantineNodeProof = async (
    nodePath: string,
    emitDirectoryStep = true
  ): Promise<QuarantineNodeProof> => {
    const initialStats = await fs.lstat(nodePath);
    const initial = exactIdentity(initialStats);
    if (initialStats.isSymbolicLink()) {
      const currentStats = await fs.lstat(nodePath);
      if (!currentStats.isSymbolicLink() || !sameIdentity(exactIdentity(currentStats), initial)) {
        return fail('storage_error');
      }
      return { kind: 'symbolic_link', identity: initial };
    }
    if (initialStats.isDirectory()) {
      const names = await readRetainedDirectoryNames(
        nodePath,
        initial,
        sameIdentity,
        emitDirectoryStep ? () => step('quarantine_directory_opened') : undefined
      );
      const children = new Map<string, QuarantineNodeProof>();
      for (const name of names) {
        const parentBefore = await readVerifiedDirectory(nodePath);
        if (!sameIdentity(parentBefore, initial)) return fail('storage_error');
        const childPath = path.join(nodePath, name);
        if (path.dirname(childPath) !== nodePath) return fail('storage_error');
        children.set(name, await captureQuarantineNodeProof(childPath, emitDirectoryStep));
        const parentAfter = await readVerifiedDirectory(nodePath);
        if (!sameIdentity(parentAfter, initial)) return fail('storage_error');
      }
      return { kind: 'directory', identity: initial, children };
    }
    if (initialStats.isFile()) {
      let handle: Awaited<ReturnType<typeof fs.open>> | null = null;
      try {
        handle = await fs.open(nodePath, fsConstants.O_RDONLY | NO_FOLLOW | NON_BLOCK);
        const openedStats = await handle.stat();
        const opened = exactIdentity(openedStats);
        const pathIdentity = exactIdentity(await fs.lstat(nodePath));
        if (
          !openedStats.isFile() ||
          openedStats.isSymbolicLink() ||
          !sameIdentity(opened, initial) ||
          !sameIdentity(opened, pathIdentity)
        ) {
          return fail('storage_error');
        }
      } finally {
        await handle?.close();
      }
      const currentStats = await fs.lstat(nodePath);
      if (!currentStats.isFile() || !sameIdentity(exactIdentity(currentStats), initial)) {
        return fail('storage_error');
      }
      return { kind: 'file', identity: initial };
    }
    const currentStats = await fs.lstat(nodePath);
    if (!sameIdentity(exactIdentity(currentStats), initial)) return fail('storage_error');
    return { kind: 'other', identity: initial };
  };

  const sameQuarantineNodeProof = (
    left: QuarantineNodeProof,
    right: QuarantineNodeProof,
    movedRoot = false,
    isRoot = true
  ): boolean => {
    if (left.kind !== right.kind) return false;
    const same =
      movedRoot && isRoot
        ? sameMovedIdentity(left.identity, right.identity)
        : sameIdentity(left.identity, right.identity);
    if (!same) return false;
    if (left.kind !== 'directory' || right.kind !== 'directory') return true;
    if (left.children.size !== right.children.size) return false;
    for (const [name, child] of left.children) {
      const other = right.children.get(name);
      if (other === undefined || !sameQuarantineNodeProof(child, other, movedRoot, false)) return false;
    }
    return true;
  };

  const removeExactlyProvedQuarantineNode = async (nodePath: string, proof: QuarantineNodeProof): Promise<void> => {
    const initialStats = await fs.lstat(nodePath);
    if (!sameIdentity(exactIdentity(initialStats), proof.identity)) return fail('storage_error');
    if (proof.kind === 'directory') {
      if (!initialStats.isDirectory() || initialStats.isSymbolicLink()) return fail('storage_error');
      const expectedNames = [...proof.children.keys()].toSorted();
      let parentProof = await capturePhysicalDirectoryProof(nodePath, proof.identity);
      if (!sameNames(parentProof.childNames, expectedNames)) return fail('storage_error');
      for (const name of expectedNames) {
        const child = proof.children.get(name);
        if (child === undefined) return fail('storage_error');
        await reprovePhysicalDirectory(parentProof);
        const childPath = path.join(nodePath, name);
        if (path.dirname(childPath) !== nodePath) return fail('storage_error');
        const currentChild = await captureQuarantineNodeProof(childPath, false);
        if (!sameQuarantineNodeProof(currentChild, child)) return fail('storage_error');
        await removeExactlyProvedQuarantineNode(childPath, child);
        parentProof = await capturePhysicalDirectoryTransition(parentProof, name, null);
      }
      await reprovePhysicalDirectory(parentProof);
      if (parentProof.childNames.length !== 0) return fail('storage_error');
      await fs.rmdir(nodePath);
      return;
    }
    if (proof.kind === 'file') {
      if (!initialStats.isFile() || initialStats.isSymbolicLink()) return fail('storage_error');
      let handle: Awaited<ReturnType<typeof fs.open>> | null = null;
      try {
        handle = await fs.open(nodePath, fsConstants.O_RDONLY | NO_FOLLOW | NON_BLOCK);
        const openedStats = await handle.stat();
        const opened = exactIdentity(openedStats);
        const pathIdentity = exactIdentity(await fs.lstat(nodePath));
        if (
          !openedStats.isFile() ||
          openedStats.isSymbolicLink() ||
          !sameIdentity(opened, proof.identity) ||
          !sameIdentity(opened, pathIdentity)
        ) {
          return fail('storage_error');
        }
      } finally {
        await handle?.close();
      }
    } else if (proof.kind === 'symbolic_link') {
      if (!initialStats.isSymbolicLink()) return fail('storage_error');
    } else if (initialStats.isDirectory() || initialStats.isSymbolicLink() || initialStats.isFile()) {
      return fail('storage_error');
    }
    const finalStats = await fs.lstat(nodePath);
    if (!sameIdentity(exactIdentity(finalStats), proof.identity)) return fail('storage_error');
    await fs.unlink(nodePath);
  };

  const snapshotQuarantineEntries = async (
    quarantinePath: string
  ): Promise<{ identity: ExactFileIdentity; entries: QuarantineEntrySnapshot[] } | null> => {
    const identity = await readOptionalVerifiedDirectory(quarantinePath);
    if (identity === null) return null;
    const names = await readRetainedDirectoryNames(quarantinePath, identity, sameIdentity);
    const entries: QuarantineEntrySnapshot[] = [];
    for (const name of names) {
      const parentBefore = await readVerifiedDirectory(quarantinePath);
      if (!sameIdentity(parentBefore, identity)) return fail('storage_error');
      const targetPath = path.join(quarantinePath, name);
      if (path.dirname(targetPath) !== quarantinePath) return fail('storage_error');
      entries.push({ name, identity: exactIdentity(await fs.lstat(targetPath)) });
      const parentAfter = await readVerifiedDirectory(quarantinePath);
      if (!sameIdentity(parentAfter, identity)) return fail('storage_error');
    }
    return { identity, entries };
  };

  const removeQuarantineEntry = async (
    quarantinePath: string,
    quarantineIdentity: ExactFileIdentity,
    snapshot: QuarantineEntrySnapshot
  ): Promise<void> => {
    const targetPath = path.join(quarantinePath, snapshot.name);
    if (path.dirname(targetPath) !== quarantinePath) return fail('storage_error');
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const quarantineBeforeClaim = await capturePhysicalDirectoryProof(quarantinePath);
      if (!sameNodeIdentity(quarantineBeforeClaim.identity, quarantineIdentity)) return fail('storage_error');
      const currentTarget = exactIdentity(await fs.lstat(targetPath));
      if (!sameIdentity(currentTarget, snapshot.identity)) return fail('storage_error');
      const claimName = `.cleanup-${nextNonce()}`;
      const claimDirectory = path.join(quarantinePath, claimName);
      try {
        await fs.mkdir(claimDirectory, { mode: 0o700 });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') continue;
        throw error;
      }
      const emptyClaim = await capturePhysicalDirectoryProof(claimDirectory);
      if (emptyClaim.childNames.length !== 0) return fail('storage_error');
      await syncDirectory(quarantinePath);
      const quarantineWithClaim = await capturePhysicalDirectoryTransition(quarantineBeforeClaim, null, claimName);
      await step('quarantine_claim_fsynced');
      const claimedPath = path.join(claimDirectory, 'entry');
      await reprovePhysicalDirectory(quarantineWithClaim);
      await reprovePhysicalDirectory(emptyClaim);
      const beforeMove = exactIdentity(await fs.lstat(targetPath));
      if (!sameIdentity(beforeMove, snapshot.identity)) return fail('storage_error');
      await fs.rename(targetPath, claimedPath);
      await syncDirectory(quarantinePath);
      await syncDirectory(claimDirectory);
      const quarantineAfterMove = await capturePhysicalDirectoryTransition(quarantineWithClaim, snapshot.name, null);
      const claimWithEntry = await capturePhysicalDirectoryTransition(emptyClaim, null, 'entry');
      const claimedIdentity = exactIdentity(await fs.lstat(claimedPath));
      if (!sameMovedIdentity(claimedIdentity, snapshot.identity)) return fail('storage_error');
      const proof = await captureQuarantineNodeProof(claimedPath);
      await removeExactlyProvedQuarantineNode(claimedPath, proof);
      const emptiedClaim = await capturePhysicalDirectoryTransition(claimWithEntry, 'entry', null);
      await syncDirectory(claimDirectory);
      await reprovePhysicalDirectory(emptiedClaim);
      await reprovePhysicalDirectory(quarantineAfterMove);
      await fs.rmdir(claimDirectory);
      await syncDirectory(quarantinePath);
      await capturePhysicalDirectoryTransition(quarantineAfterMove, claimName, null);
      return;
    }
    return fail('storage_error');
  };

  const enqueue = async <Result>(projectId: string, operation: () => Promise<Result>): Promise<Result> => {
    const predecessor = tails.get(projectId) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = predecessor.then(() => gate);
    tails.set(projectId, tail);
    await predecessor;
    try {
      return await operation();
    } finally {
      release();
      if (tails.get(projectId) === tail) tails.delete(projectId);
    }
  };

  const ensureQuarantineDirectory = async (authority: StudioExportProjectAuthorityV2): Promise<string> =>
    ensureVerifiedChildDirectory(authority.projectDir, QUARANTINE_DIRECTORY_NAME);

  const movePhysicalTreeToQuarantine = async (
    authority: StudioExportProjectAuthorityV2,
    sourcePath: string,
    treeProof: PhysicalTreeProof,
    sourceParentProof: PhysicalDirectoryProof,
    quarantineProof: PhysicalDirectoryProof
  ): Promise<{ sourceParentProof: PhysicalDirectoryProof; quarantineProof: PhysicalDirectoryProof }> => {
    if (
      path.dirname(sourcePath) !== sourceParentProof.path ||
      quarantineProof.path !== path.join(authority.projectDir, QUARANTINE_DIRECTORY_NAME)
    ) {
      return fail('storage_error');
    }
    await reprovePhysicalDirectory(sourceParentProof);
    const sourceProof = await capturePhysicalTreeProof(sourcePath, treeProof.nodes);
    if (!samePhysicalTreeProof(sourceProof, treeProof)) return fail('storage_error');
    await reprovePhysicalDirectory(quarantineProof);

    for (let attempt = 0; attempt < 8; attempt += 1) {
      const claimName = nextNonce();
      const claimDirectory = path.join(quarantineProof.path, claimName);
      try {
        await fs.mkdir(claimDirectory, { mode: 0o700 });
      } catch (error) {
        if (isAlreadyExists(error)) continue;
        throw error;
      }
      await syncDirectory(quarantineProof.path);
      const quarantineWithClaim = await capturePhysicalDirectoryTransition(quarantineProof, null, claimName);
      const emptyClaim = await capturePhysicalDirectoryProof(claimDirectory);
      if (emptyClaim.childNames.length !== 0) return fail('storage_error');
      await reprovePhysicalDirectory(sourceParentProof);
      const beforeMove = await capturePhysicalTreeProof(sourcePath, sourceProof.nodes);
      if (!samePhysicalTreeProof(beforeMove, sourceProof)) return fail('storage_error');
      await reprovePhysicalDirectory(quarantineWithClaim);
      await reprovePhysicalDirectory(emptyClaim);

      const claimedPath = path.join(claimDirectory, 'entry');
      await fs.rename(sourcePath, claimedPath);
      await syncDirectory(sourceParentProof.path);
      await syncDirectory(claimDirectory);
      const sourceParentAfter = await capturePhysicalDirectoryTransition(
        sourceParentProof,
        path.basename(sourcePath),
        null
      );
      const claimAfter = await capturePhysicalDirectoryTransition(emptyClaim, null, 'entry');
      const movedProof = await capturePhysicalTreeProof(claimedPath, beforeMove.nodes, 'moved_root');
      if (!samePhysicalTreeProof(movedProof, beforeMove, true)) return fail('storage_error');
      await reprovePhysicalDirectory(claimAfter);
      await reprovePhysicalDirectory(quarantineWithClaim);
      return { sourceParentProof: sourceParentAfter, quarantineProof: quarantineWithClaim };
    }
    return fail('storage_error');
  };

  const moveOwnedDirectoryRootToQuarantine = async (
    authority: StudioExportProjectAuthorityV2,
    sourcePath: string,
    ownedRoot: PhysicalTreeNodeProof,
    sourceParentProof: PhysicalDirectoryProof,
    quarantineProof: PhysicalDirectoryProof
  ): Promise<{ sourceParentProof: PhysicalDirectoryProof; quarantineProof: PhysicalDirectoryProof }> => {
    if (
      ownedRoot.kind !== 'directory' ||
      path.dirname(sourcePath) !== sourceParentProof.path ||
      quarantineProof.path !== path.join(authority.projectDir, QUARANTINE_DIRECTORY_NAME)
    ) {
      return fail('storage_error');
    }
    await reprovePhysicalDirectory(sourceParentProof);
    const sourceIdentity = await readVerifiedDirectory(sourcePath);
    if (!sameNodeIdentity(sourceIdentity, ownedRoot.identity)) return fail('storage_error');
    await reprovePhysicalDirectory(quarantineProof);

    for (let attempt = 0; attempt < 8; attempt += 1) {
      const claimName = nextNonce();
      const claimDirectory = path.join(quarantineProof.path, claimName);
      try {
        await fs.mkdir(claimDirectory, { mode: 0o700 });
      } catch (error) {
        if (isAlreadyExists(error)) continue;
        throw error;
      }
      await syncDirectory(quarantineProof.path);
      const quarantineWithClaim = await capturePhysicalDirectoryTransition(quarantineProof, null, claimName);
      const emptyClaim = await capturePhysicalDirectoryProof(claimDirectory);
      if (emptyClaim.childNames.length !== 0) return fail('storage_error');
      await reprovePhysicalDirectory(sourceParentProof);
      const beforeMove = await readVerifiedDirectory(sourcePath);
      if (!sameNodeIdentity(beforeMove, ownedRoot.identity)) return fail('storage_error');
      await reprovePhysicalDirectory(quarantineWithClaim);
      await reprovePhysicalDirectory(emptyClaim);

      const claimedPath = path.join(claimDirectory, 'entry');
      await fs.rename(sourcePath, claimedPath);
      await syncDirectory(sourceParentProof.path);
      await syncDirectory(claimDirectory);
      const sourceParentAfter = await capturePhysicalDirectoryTransition(
        sourceParentProof,
        path.basename(sourcePath),
        null
      );
      const claimAfter = await capturePhysicalDirectoryTransition(emptyClaim, null, 'entry');
      const claimedIdentity = await readVerifiedDirectory(claimedPath);
      if (!sameNodeIdentity(claimedIdentity, ownedRoot.identity)) return fail('storage_error');
      await reprovePhysicalDirectory(claimAfter);
      await reprovePhysicalDirectory(quarantineWithClaim);
      return { sourceParentProof: sourceParentAfter, quarantineProof: quarantineWithClaim };
    }
    return fail('storage_error');
  };

  const moveProvedNodeToQuarantine = async (
    authority: StudioExportProjectAuthorityV2,
    sourcePath: string,
    nodeProof: QuarantineNodeProof,
    sourceParentProof: PhysicalDirectoryProof,
    quarantineProof: PhysicalDirectoryProof
  ): Promise<{ sourceParentProof: PhysicalDirectoryProof; quarantineProof: PhysicalDirectoryProof }> => {
    if (
      path.dirname(sourcePath) !== sourceParentProof.path ||
      quarantineProof.path !== path.join(authority.projectDir, QUARANTINE_DIRECTORY_NAME)
    ) {
      return fail('storage_error');
    }
    await reprovePhysicalDirectory(sourceParentProof);
    const sourceProof = await captureQuarantineNodeProof(sourcePath, false);
    if (!sameQuarantineNodeProof(sourceProof, nodeProof)) return fail('storage_error');
    await reprovePhysicalDirectory(quarantineProof);
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const claimName = nextNonce();
      const claimDirectory = path.join(quarantineProof.path, claimName);
      try {
        await fs.mkdir(claimDirectory, { mode: 0o700 });
      } catch (error) {
        if (isAlreadyExists(error)) continue;
        throw error;
      }
      await syncDirectory(quarantineProof.path);
      const quarantineWithClaim = await capturePhysicalDirectoryTransition(quarantineProof, null, claimName);
      const emptyClaim = await capturePhysicalDirectoryProof(claimDirectory);
      if (emptyClaim.childNames.length !== 0) return fail('storage_error');
      await reprovePhysicalDirectory(sourceParentProof);
      const beforeMove = await captureQuarantineNodeProof(sourcePath, false);
      if (!sameQuarantineNodeProof(beforeMove, sourceProof)) return fail('storage_error');
      await reprovePhysicalDirectory(quarantineWithClaim);
      await reprovePhysicalDirectory(emptyClaim);

      const claimedPath = path.join(claimDirectory, 'entry');
      await fs.rename(sourcePath, claimedPath);
      await syncDirectory(sourceParentProof.path);
      await syncDirectory(claimDirectory);
      const sourceParentAfter = await capturePhysicalDirectoryTransition(
        sourceParentProof,
        path.basename(sourcePath),
        null
      );
      const claimAfter = await capturePhysicalDirectoryTransition(emptyClaim, null, 'entry');
      const movedProof = await captureQuarantineNodeProof(claimedPath, false);
      if (!sameQuarantineNodeProof(movedProof, beforeMove, true)) return fail('storage_error');
      await reprovePhysicalDirectory(claimAfter);
      await reprovePhysicalDirectory(quarantineWithClaim);
      return { sourceParentProof: sourceParentAfter, quarantineProof: quarantineWithClaim };
    }
    return fail('storage_error');
  };

  const quarantineUnsupportedCatalog = async (
    authority: StudioExportProjectAuthorityV2,
    context: StudioExportCatalogValidationContextV2
  ): Promise<void> => {
    try {
      await readCatalogState(authority, context);
      return;
    } catch (error) {
      if (!(error instanceof StudioExportCatalogErrorV2) || error.code !== 'unsupported_catalog_schema') {
        throw error;
      }
    }

    const catalogPath = path.join(authority.projectDir, CATALOG_FILE_NAME);
    const activePath = path.join(authority.projectDir, ACTIVE_DIRECTORY_NAME);
    const quarantinePath = await ensureQuarantineDirectory(authority);
    await authority.assertCurrent?.();
    authority.assertActive?.();

    const verifiedCatalog = await readBoundedFileNoFollow(catalogPath, CATALOG_MAX_BYTES);
    try {
      parseStudioExportCatalogV2(verifiedCatalog.bytes, context);
      return;
    } catch (error) {
      if (!(error instanceof StudioExportCatalogErrorV2) || error.code !== 'unsupported_catalog_schema') {
        throw error;
      }
    }

    let projectProof = await capturePhysicalDirectoryProof(authority.projectDir);
    let quarantineProof = await capturePhysicalDirectoryProof(quarantinePath);
    const catalogProof = await captureQuarantineNodeProof(catalogPath, false);
    if (catalogProof.kind !== 'file' || !sameIdentity(catalogProof.identity, verifiedCatalog.identity)) {
      return fail('storage_error');
    }
    ({ sourceParentProof: projectProof, quarantineProof } = await moveProvedNodeToQuarantine(
      authority,
      catalogPath,
      catalogProof,
      projectProof,
      quarantineProof
    ));

    try {
      await fs.lstat(activePath);
      const activeProof = await captureQuarantineNodeProof(activePath, false);
      ({ sourceParentProof: projectProof, quarantineProof } = await moveProvedNodeToQuarantine(
        authority,
        activePath,
        activeProof,
        projectProof,
        quarantineProof
      ));
    } catch (error) {
      if (!isMissing(error)) throw error;
    }

    await reprovePhysicalDirectory(projectProof);
    await reprovePhysicalDirectory(quarantineProof);
    await authority.assertCurrent?.();
    authority.assertActive?.();
  };

  const claimCatalogTempInQuarantine = async (
    authority: StudioExportProjectAuthorityV2,
    sourcePath: string,
    expected: ExactFileIdentity
  ): Promise<{
    quarantinePath: string;
    targetDirectory: string;
    targetPath: string;
    projectProof: PhysicalDirectoryProof;
    quarantineProof: PhysicalDirectoryProof;
    targetDirectoryProof: PhysicalDirectoryProof;
  } | null> => {
    if (path.dirname(sourcePath) !== authority.projectDir || !isReservedCatalogTempName(path.basename(sourcePath))) {
      return fail('storage_error');
    }
    const quarantinePath = await ensureQuarantineDirectory(authority);
    const projectBeforeClaim = await capturePhysicalDirectoryProof(authority.projectDir);
    const quarantineBeforeClaim = await capturePhysicalDirectoryProof(quarantinePath);
    for (let attempt = 0; attempt < 8; attempt += 1) {
      let before: ExactFileIdentity;
      try {
        before = exactIdentity(await fs.lstat(sourcePath));
      } catch (error) {
        if (isMissing(error)) return null;
        throw error;
      }
      if (!sameIdentity(before, expected)) return fail('storage_error');
      const claimName = nextNonce();
      const targetDirectory = path.join(quarantinePath, claimName);
      try {
        await fs.mkdir(targetDirectory, { mode: 0o700 });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') continue;
        throw error;
      }
      const emptyClaim = await capturePhysicalDirectoryProof(targetDirectory);
      if (emptyClaim.childNames.length !== 0) return fail('storage_error');
      await syncDirectory(quarantinePath);
      const quarantineWithClaim = await capturePhysicalDirectoryTransition(quarantineBeforeClaim, null, claimName);
      await step('quarantine_claim_fsynced');
      const targetPath = path.join(targetDirectory, 'entry');
      await reprovePhysicalDirectory(projectBeforeClaim);
      await reprovePhysicalDirectory(quarantineWithClaim);
      await reprovePhysicalDirectory(emptyClaim);
      const beforeMove = exactIdentity(await fs.lstat(sourcePath));
      if (!sameIdentity(beforeMove, expected)) return fail('storage_error');
      try {
        await fs.rename(sourcePath, targetPath);
      } catch (error) {
        if (isMissing(error)) return null;
        throw error;
      }
      await syncDirectory(authority.projectDir);
      await syncDirectory(targetDirectory);
      await syncDirectory(quarantinePath);
      const projectAfterMove = await capturePhysicalDirectoryTransition(
        projectBeforeClaim,
        path.basename(sourcePath),
        null
      );
      const targetDirectoryAfterMove = await capturePhysicalDirectoryTransition(emptyClaim, null, 'entry');
      await reprovePhysicalDirectory(quarantineWithClaim);
      const claimed = exactIdentity(await fs.lstat(targetPath));
      if (!sameMovedIdentity(claimed, expected)) return fail('storage_error');
      return {
        quarantinePath,
        targetDirectory,
        targetPath,
        projectProof: projectAfterMove,
        quarantineProof: quarantineWithClaim,
        targetDirectoryProof: targetDirectoryAfterMove,
      };
    }
    return fail('storage_error');
  };

  const recoverCatalogTemp = async (
    authority: StudioExportProjectAuthorityV2,
    context: StudioExportCatalogValidationContextV2,
    name: string
  ): Promise<void> => {
    if (!isReservedCatalogTempName(name)) return;
    const sourcePath = path.join(authority.projectDir, name);
    if (path.dirname(sourcePath) !== authority.projectDir) return fail('storage_error');

    let initialStats: Awaited<ReturnType<typeof fs.lstat>>;
    try {
      initialStats = await fs.lstat(sourcePath);
    } catch (error) {
      if (isMissing(error)) return;
      throw error;
    }
    const initial = exactIdentity(initialStats);
    let removeAfterClaim = false;
    if (
      initialStats.isFile() &&
      !initialStats.isSymbolicLink() &&
      initial.nlink === 1 &&
      initial.size >= 1 &&
      initial.size <= CATALOG_MAX_BYTES
    ) {
      try {
        const verified = await readBoundedFileNoFollow(sourcePath, CATALOG_MAX_BYTES, true);
        parseStudioExportCatalogV2(verified.bytes, context);
        removeAfterClaim = sameIdentity(initial, verified.identity);
      } catch {
        // A non-authoritative malformed or replaced temp is retained in quarantine for inspection.
      }
    }

    let current: ExactFileIdentity;
    try {
      current = exactIdentity(await fs.lstat(sourcePath));
    } catch (error) {
      if (isMissing(error)) return;
      throw error;
    }
    if (!sameIdentity(current, initial)) removeAfterClaim = false;
    const claimed = await claimCatalogTempInQuarantine(authority, sourcePath, current);
    if (claimed === null || !removeAfterClaim) return;
    await reprovePhysicalDirectory(claimed.projectProof);
    await reprovePhysicalDirectory(claimed.quarantineProof);
    await reprovePhysicalDirectory(claimed.targetDirectoryProof);
    const claimedIdentity = exactIdentity(await fs.lstat(claimed.targetPath));
    if (!sameMovedIdentity(claimedIdentity, current)) return fail('storage_error');
    await fs.unlink(claimed.targetPath);
    const emptiedClaim = await capturePhysicalDirectoryTransition(
      claimed.targetDirectoryProof,
      path.basename(claimed.targetPath),
      null
    );
    await syncDirectory(claimed.targetDirectory);
    await reprovePhysicalDirectory(emptiedClaim);
    await reprovePhysicalDirectory(claimed.quarantineProof);
    await fs.rmdir(claimed.targetDirectory);
    await syncDirectory(claimed.quarantinePath);
    await capturePhysicalDirectoryTransition(claimed.quarantineProof, path.basename(claimed.targetDirectory), null);
  };

  const recoverCatalogTemps = async (
    authority: StudioExportProjectAuthorityV2,
    context: StudioExportCatalogValidationContextV2
  ): Promise<void> => {
    const entries = (await fs.readdir(authority.projectDir)).filter(isReservedCatalogTempName).toSorted();
    for (const entry of entries) await recoverCatalogTemp(authority, context, entry);
  };

  const assertCatalogPathIdentity = async (
    authority: StudioExportProjectAuthorityV2,
    expected: ExactFileIdentity | null,
    mismatchCode: StudioExportCatalogErrorCodeV2 = 'stale_catalog_revision'
  ): Promise<void> => {
    const catalogPath = path.join(authority.projectDir, CATALOG_FILE_NAME);
    try {
      const current = exactIdentity(await fs.lstat(catalogPath));
      if (expected === null || !sameIdentity(current, expected)) return fail(mismatchCode);
    } catch (error) {
      if (isMissing(error) && expected === null) return;
      if (isMissing(error) && mismatchCode === 'storage_error') return fail('storage_error');
      throw error;
    }
  };

  const loadPhysicalCatalogWithContext = async (
    authority: StudioExportProjectAuthorityV2,
    context: StudioExportCatalogValidationContextV2
  ): Promise<PhysicalCatalog> => {
    const state = await readCatalogState(authority, context);
    const physical = await validatePhysicalCatalog(authority, context, state, async () => {
      await step('physical_catalog_descendants_validated');
    });
    authority.assertActive?.();
    await authority.assertCurrent?.();
    await assertCatalogPathIdentity(authority, state.identity, 'storage_error');
    return physical;
  };

  const loadPhysicalCatalog = async (authority: StudioExportProjectAuthorityV2): Promise<PhysicalCatalog> => {
    const context = await assertAuthority(authority);
    return loadPhysicalCatalogWithContext(authority, context);
  };

  const replaceCatalog = async (
    authority: StudioExportProjectAuthorityV2,
    context: StudioExportCatalogValidationContextV2,
    priorIdentity: ExactFileIdentity | null,
    catalog: StudioExportCatalogV2,
    expectedPhysical: PhysicalCatalog,
    reprovePublicationSources: () => Promise<void>,
    onTempClaimed: (quarantineProof: PhysicalDirectoryProof) => void,
    onRenamed: () => void
  ): Promise<ExactFileIdentity> => {
    const catalogPath = path.join(authority.projectDir, CATALOG_FILE_NAME);
    const tempPath = path.join(authority.projectDir, `.${CATALOG_FILE_NAME}-${nextNonce()}.part`);
    let tempIdentity: ExactFileIdentity | null = null;
    let renamed = false;
    try {
      const catalogBytes = serializeStudioExportCatalogV2(catalog, context);
      tempIdentity = await writeExactNewFile(tempPath, catalogBytes);
      await catalogDirectorySync(authority.projectDir);
      await step('catalog_temp_fsynced');
      await authority.assertCurrent?.();
      await assertCatalogPathIdentity(authority, priorIdentity);
      const physical = await validatePhysicalCatalog(authority, context, { catalog, identity: null });
      if (!samePhysicalCatalogLedger(physical, expectedPhysical)) return fail('storage_error');
      const verifiedTemp = await readBoundedFileNoFollow(tempPath, CATALOG_MAX_BYTES, true);
      if (
        !sameIdentity(verifiedTemp.identity, tempIdentity) ||
        !Buffer.from(verifiedTemp.bytes).equals(Buffer.from(catalogBytes))
      ) {
        return fail('storage_error');
      }
      await authority.assertCurrent?.();
      await assertCatalogPathIdentity(authority, priorIdentity);
      await reprovePhysicalCatalogLedger(authority, expectedPhysical);
      await reprovePublicationSources();
      authority.assertActive?.();
      const finalTemp = await readBoundedFileNoFollow(tempPath, CATALOG_MAX_BYTES, true);
      if (
        !sameIdentity(finalTemp.identity, tempIdentity) ||
        !Buffer.from(finalTemp.bytes).equals(Buffer.from(catalogBytes))
      ) {
        return fail('storage_error');
      }
      authority.assertActive?.();
      await fs.rename(tempPath, catalogPath);
      renamed = true;
      onRenamed();
      const published = await readBoundedFileNoFollow(catalogPath, CATALOG_MAX_BYTES, true);
      if (
        !sameMovedIdentity(published.identity, tempIdentity) ||
        !Buffer.from(published.bytes).equals(Buffer.from(catalogBytes))
      ) {
        return fail('storage_error');
      }
      await catalogDirectorySync(authority.projectDir);
      await authority.assertCurrent?.();
      const durable = await readBoundedFileNoFollow(catalogPath, CATALOG_MAX_BYTES, true);
      if (
        !sameIdentity(durable.identity, published.identity) ||
        !Buffer.from(durable.bytes).equals(Buffer.from(catalogBytes))
      ) {
        return fail('storage_error');
      }
      authority.assertActive?.();
      return durable.identity;
    } catch (error) {
      if (!renamed && tempIdentity !== null) {
        const claimed = await claimCatalogTempInQuarantine(authority, tempPath, tempIdentity).catch((): null => null);
        if (claimed !== null) onTempClaimed(claimed.quarantineProof);
      }
      throw error;
    }
  };

  const normalizeCreatePlan = (
    authority: StudioExportProjectAuthorityV2,
    plan: StudioExportCreatePlanV2
  ): StudioExportCreatePlanV2 => {
    if (plan.expectedProjectRevision !== authority.project.revision) return fail('stale_project_revision');
    if (
      !isSafePositiveInteger(plan.expectedCatalogRevision) ||
      !SAFE_ID.test(plan.artifactId) ||
      !SAFE_ID.test(plan.managedFileName) ||
      (plan.shape !== 'editor_folder' && plan.shape !== 'still' && plan.shape !== 'script' && plan.shape !== 'film') ||
      !isCanonicalTimestamp(plan.createdAt) ||
      !isDenseDataArray(plan.files) ||
      plan.files.length < 1 ||
      plan.files.length > STUDIO_MAX_EXPORT_FILES_PER_ARTIFACT ||
      (plan.shape !== 'editor_folder' && plan.files.length !== 1) ||
      (plan.shape === 'film' && !validateFilmFacts(plan.film))
    ) {
      return fail('invalid_create_plan');
    }
    const paths = new Set<string>();
    let declaredBytes = 0;
    const files: StudioExportPayloadFilePlanV2[] = [];
    for (const value of plan.files) {
      if (!isDataRecord(value) || !isSafeStudioExportRelativePathV2(value.relativePath)) {
        return fail('invalid_create_plan');
      }
      if (
        value.relativePath === ARTIFACT_RECORD_NAME ||
        value.relativePath === MANIFEST_FILE_NAME ||
        paths.has(value.relativePath)
      ) {
        return fail('invalid_create_plan');
      }
      paths.add(value.relativePath);
      if (value.kind === 'generated') {
        if (!hasExactKeys(value, GENERATED_PLAN_KEYS) || !(value.bytes instanceof Uint8Array)) {
          return fail('invalid_create_plan');
        }
        const bytes = Uint8Array.from(value.bytes);
        declaredBytes += bytes.byteLength;
        files.push({ kind: 'generated', relativePath: value.relativePath, bytes });
      } else if (value.kind === 'verified_stream') {
        if (
          !hasExactKeys(value, VERIFIED_STREAM_PLAN_KEYS) ||
          !isSafeNonnegativeInteger(value.byteSize) ||
          typeof value.sha256 !== 'string' ||
          !LOWERCASE_SHA256.test(value.sha256) ||
          typeof value.openVerifiedStream !== 'function'
        ) {
          return fail('invalid_create_plan');
        }
        declaredBytes += value.byteSize;
        files.push({
          kind: 'verified_stream',
          relativePath: value.relativePath,
          byteSize: value.byteSize,
          sha256: value.sha256,
          openVerifiedStream: value.openVerifiedStream as () => Promise<AsyncIterable<Uint8Array>>,
        });
      } else {
        return fail('invalid_create_plan');
      }
      if (!Number.isSafeInteger(declaredBytes) || declaredBytes > maxArtifactBytes) {
        return fail('invalid_create_plan');
      }
    }
    if (
      plan.shape === 'film' &&
      (files.length !== 1 ||
        files[0]?.kind !== 'verified_stream' ||
        files[0].relativePath !== 'film.mp4' ||
        files[0].byteSize < 1)
    ) {
      return fail('invalid_create_plan');
    }
    const normalized = {
      expectedProjectRevision: plan.expectedProjectRevision,
      expectedCatalogRevision: plan.expectedCatalogRevision,
      artifactId: plan.artifactId,
      managedFileName: plan.managedFileName,
      shape: plan.shape,
      createdAt: plan.createdAt,
      files: files.toSorted((left, right) => compareStudioExportRelativePathsV2(left.relativePath, right.relativePath)),
    };
    return plan.shape === 'film'
      ? { ...normalized, shape: 'film', film: structuredClone(plan.film) }
      : { ...normalized, shape: plan.shape };
  };

  const assertPublicationCapacity = (
    authority: StudioExportProjectAuthorityV2,
    current: PhysicalCatalog,
    nextCatalog: StudioExportCatalogV2,
    artifact: StudioExportArtifactV2,
    manifestBytes: Uint8Array
  ): void => {
    let totalBytes = 0;
    const add = (byteSize: number): void => {
      if (!isSafeNonnegativeInteger(byteSize)) return fail('storage_error');
      totalBytes += byteSize;
      if (!Number.isSafeInteger(totalBytes) || totalBytes > maxProjectBytes) {
        return fail('project_capacity_exceeded');
      }
    };
    for (const asset of Object.values(authority.project.assets)) add(asset.byteSize);
    for (const retained of current.catalog.artifacts) {
      add(retained.byteSize);
      const physical = current.artifacts.get(retained.id);
      if (physical === undefined) return fail('storage_error');
      add(physical.manifest.bytes.byteLength);
      add(Buffer.byteLength(JSON.stringify(retained), 'utf8'));
    }
    add(artifact.byteSize);
    add(manifestBytes.byteLength);
    add(Buffer.byteLength(JSON.stringify(artifact), 'utf8'));
    add(
      serializeStudioExportCatalogV2(nextCatalog, {
        projectId: authority.project.id,
        currentProjectRevision: authority.project.revision,
      }).byteLength
    );
  };

  const managedByteFacts = (physical: PhysicalCatalog): StudioExportManagedByteFactsV2 => {
    let managedByteSize = physical.identity?.size ?? 0;
    const add = (byteSize: number): void => {
      if (!isSafeNonnegativeInteger(byteSize)) return fail('storage_error');
      managedByteSize += byteSize;
      if (!Number.isSafeInteger(managedByteSize)) return fail('storage_error');
    };
    for (const artifact of physical.catalog.artifacts) {
      const resolved = physical.artifacts.get(artifact.id);
      if (resolved === undefined) return fail('storage_error');
      add(artifact.byteSize);
      add(resolved.manifest.bytes.byteLength);
      add(Buffer.byteLength(JSON.stringify(artifact), 'utf8'));
    }
    return Object.freeze({ catalogRevision: physical.catalog.revision, managedByteSize });
  };

  const create = async (
    authority: StudioExportProjectAuthorityV2,
    untrustedPlan: StudioExportCreatePlanV2
  ): Promise<StudioExportCatalogV2> =>
    enqueue(authority.project.id, async () => {
      try {
        const context = await assertAuthority(authority);
        const plan = normalizeCreatePlan(authority, untrustedPlan);
        const current = await loadPhysicalCatalogWithContext(authority, context);
        if (current.catalog.revision !== plan.expectedCatalogRevision) return fail('stale_catalog_revision');
        if (
          current.catalog.artifacts.some(
            (artifact) => artifact.id === plan.artifactId || artifact.managedExport.fileName === plan.managedFileName
          )
        ) {
          return fail('invalid_artifact');
        }

        const quarantinePath = await ensureQuarantineDirectory(authority);
        const quarantineBeforeStage = await capturePhysicalDirectoryProof(quarantinePath);
        const stagingPath = path.join(quarantinePath, `stage-${nextNonce()}`);
        await fs.mkdir(stagingPath, { mode: 0o700 });
        const stagingIdentity = await readVerifiedDirectory(stagingPath);
        await syncDirectory(quarantinePath);
        let quarantineProof = await capturePhysicalDirectoryTransition(
          quarantineBeforeStage,
          null,
          path.basename(stagingPath)
        );
        const directories = new Set<string>([stagingPath]);
        const stagingNodes = new Map<string, PhysicalTreeNodeProof>([
          ['', { kind: 'directory', identity: stagingIdentity }],
        ]);
        let activePath: string | null = null;
        let catalogCommitted = false;
        let catalogRenameOccurred = false;
        let publishedTreeProof: PhysicalTreeProof | null = null;
        let activeParentProof: PhysicalDirectoryProof | null = null;
        try {
          const entries: StudioExportManifestEntryV2[] = [];
          let remainingBytes = maxArtifactBytes;
          for (const filePlan of plan.files) {
            const entry = await writePayloadPlanFile(stagingPath, filePlan, remainingBytes, directories, stagingNodes);
            entries.push(entry);
            remainingBytes -= entry.byteSize;
          }
          await step('payload_staged');
          const payloadTreeProof = await capturePhysicalTreeProof(stagingPath, stagingNodes, 'construction');
          const manifestBytes = serializeStudioExportManifestV2(entries);
          const manifest = parseStudioExportManifestV2(manifestBytes);
          const artifactBase = {
            schemaVersion: STUDIO_EXPORT_SCHEMA_VERSION_V2,
            id: plan.artifactId,
            projectId: authority.project.id,
            sourceRevision: authority.project.revision,
            payloadKind: plan.shape === 'editor_folder' ? ('directory' as const) : ('file' as const),
            managedExport: { collection: 'exports' as const, fileName: plan.managedFileName },
            byteSize: manifest.byteSize,
            payloadFileCount: manifest.payloadFileCount,
            manifestSha256: manifest.manifestSha256,
            createdAt: plan.createdAt,
          };
          const artifact: StudioExportArtifactV2 =
            plan.shape === 'film'
              ? { ...artifactBase, shape: 'film', payloadKind: 'file', film: structuredClone(plan.film) }
              : { ...artifactBase, shape: plan.shape };
          const publication = publishStudioExportArtifactInCatalogV2(current.catalog, {
            ...context,
            expectedCatalogRevision: plan.expectedCatalogRevision,
            artifact,
          });
          assertPublicationCapacity(authority, current, publication.catalog, artifact, manifestBytes);
          const manifestIdentity = await writeExactNewFile(path.join(stagingPath, MANIFEST_FILE_NAME), manifestBytes);
          const artifactRecordIdentity = await writeExactNewFile(
            path.join(stagingPath, ARTIFACT_RECORD_NAME),
            Buffer.from(JSON.stringify(artifact))
          );
          const stagedNodes = new Map(payloadTreeProof.nodes);
          stagedNodes.set(MANIFEST_FILE_NAME, { kind: 'file', identity: manifestIdentity });
          stagedNodes.set(ARTIFACT_RECORD_NAME, { kind: 'file', identity: artifactRecordIdentity });
          for (const directory of [...directories].toSorted((left, right) => right.length - left.length)) {
            await syncDirectory(directory);
          }
          let stagedTreeProof = await capturePhysicalTreeProof(stagingPath, stagedNodes, 'root_children_changed');
          await step('artifact_staged');
          stagedTreeProof = await capturePhysicalTreeProof(stagingPath, stagedTreeProof.nodes);
          authority.assertActive?.();
          await authority.assertCurrent?.();

          const activeDirectory = await ensureVerifiedChildDirectory(authority.projectDir, ACTIVE_DIRECTORY_NAME);
          let activeBeforePublication = await capturePhysicalDirectoryProof(activeDirectory);
          if (current.activeProof === null) {
            if (activeBeforePublication.childNames.length !== 0) return fail('storage_error');
          } else if (
            !sameIdentity(activeBeforePublication.identity, current.activeProof.identity) ||
            !sameNames(activeBeforePublication.childNames, current.activeProof.childNames)
          ) {
            return fail('storage_error');
          }
          activePath = path.join(activeDirectory, plan.managedFileName);
          try {
            await fs.lstat(activePath);
            return fail('storage_error');
          } catch (error) {
            if (!isMissing(error)) throw error;
          }
          await authority.assertCurrent?.();
          await assertCatalogPathIdentity(authority, current.identity);
          await reprovePhysicalArtifactLedgers(current);
          for (const proof of current.activeFinderMetadataFiles.values()) await reprovePhysicalFile(proof);
          stagedTreeProof = await capturePhysicalTreeProof(stagingPath, stagedTreeProof.nodes);
          await reprovePhysicalDirectory(quarantineProof);
          await reprovePhysicalDirectory(activeBeforePublication);
          try {
            await fs.lstat(activePath);
            return fail('storage_error');
          } catch (error) {
            if (!isMissing(error)) throw error;
          }
          authority.assertActive?.();
          await fs.rename(stagingPath, activePath);
          await syncDirectory(quarantinePath);
          await syncDirectory(activeDirectory);
          quarantineProof = await capturePhysicalDirectoryTransition(quarantineProof, path.basename(stagingPath), null);
          activeParentProof = await capturePhysicalDirectoryTransition(
            activeBeforePublication,
            null,
            plan.managedFileName
          );
          publishedTreeProof = await capturePhysicalTreeProof(activePath, stagedTreeProof.nodes, 'moved_root');
          if (!samePhysicalTreeProof(publishedTreeProof, stagedTreeProof, true)) return fail('storage_error');
          await step('artifact_published');
          publishedTreeProof = await capturePhysicalTreeProof(activePath, publishedTreeProof.nodes);
          await reprovePhysicalDirectory(quarantineProof);
          await reprovePhysicalDirectory(activeParentProof);
          const prospective = await validatePhysicalCatalog(authority, context, {
            catalog: publication.catalog,
            identity: null,
          });
          const prospectiveArtifact = prospective.artifacts.get(artifact.id);
          const newArtifactRetained = publication.catalog.artifacts.some(({ id }) => id === artifact.id);
          if (
            (newArtifactRetained &&
              (prospectiveArtifact === undefined ||
                !samePhysicalTreeProof(prospectiveArtifact.treeProof, publishedTreeProof))) ||
            (!newArtifactRetained && prospectiveArtifact !== undefined) ||
            prospective.activeProof === null ||
            !sameIdentity(prospective.activeProof.identity, activeParentProof.identity) ||
            !sameNames(prospective.activeProof.childNames, activeParentProof.childNames) ||
            !samePhysicalFileProofs(current.activeFinderMetadataFiles, prospective.activeFinderMetadataFiles) ||
            !retainedArtifactProofsMatch(current, prospective, artifact.id)
          ) {
            return fail('storage_error');
          }
          await reprovePhysicalDirectory(quarantineProof);
          authority.assertActive?.();
          await authority.assertCurrent?.();
          const committedCatalogIdentity = await replaceCatalog(
            authority,
            context,
            current.identity,
            publication.catalog,
            prospective,
            async () => {
              await reprovePhysicalArtifactLedgers(current);
              for (const proof of current.activeFinderMetadataFiles.values()) await reprovePhysicalFile(proof);
              const currentPublished = await capturePhysicalTreeProof(activePath, publishedTreeProof.nodes);
              if (!samePhysicalTreeProof(currentPublished, publishedTreeProof)) return fail('storage_error');
              await reprovePhysicalDirectory(activeParentProof);
              await reprovePhysicalDirectory(quarantineProof);
            },
            (claimedQuarantineProof) => {
              quarantineProof = claimedQuarantineProof;
            },
            () => {
              catalogRenameOccurred = true;
            }
          );
          catalogCommitted = true;
          await step('catalog_committed');

          const committed = await loadPhysicalCatalogWithContext(authority, context);
          const committedExpected: PhysicalCatalog = { ...prospective, identity: committedCatalogIdentity };
          if (!samePhysicalCatalogLedger(committed, committedExpected)) return fail('storage_error');
          if (
            committed.activeProof === null ||
            !sameIdentity(committed.activeProof.identity, activeParentProof.identity) ||
            !sameNames(committed.activeProof.childNames, activeParentProof.childNames)
          ) {
            return fail('storage_error');
          }
          activeParentProof = committed.activeProof;
          await reprovePhysicalDirectory(quarantineProof);

          let evictionFailed = false;
          for (const evicted of publication.evictedArtifacts) {
            try {
              const evictedPhysical =
                evicted.id === artifact.id
                  ? { rootPath: activePath, treeProof: publishedTreeProof }
                  : current.artifacts.get(evicted.id);
              if (evictedPhysical === undefined || evictedPhysical.rootPath === null) return fail('storage_error');
              const moved = await movePhysicalTreeToQuarantine(
                authority,
                evictedPhysical.rootPath,
                evictedPhysical.treeProof,
                activeParentProof,
                quarantineProof
              );
              activeParentProof = moved.sourceParentProof;
              quarantineProof = moved.quarantineProof;
              await step('eviction_quarantined');
              await reprovePhysicalDirectory(activeParentProof);
              await reprovePhysicalDirectory(quarantineProof);
            } catch {
              evictionFailed = true;
              break;
            }
          }
          if (evictionFailed) return fail('storage_error');
          const finalPhysical = await loadPhysicalCatalogWithContext(authority, context);
          if (
            finalPhysical.identity === null ||
            !sameIdentity(finalPhysical.identity, committedCatalogIdentity) ||
            !samePhysicalFileProofs(committed.activeFinderMetadataFiles, finalPhysical.activeFinderMetadataFiles) ||
            !retainedArtifactProofsMatch(prospective, finalPhysical, '') ||
            finalPhysical.activeProof === null ||
            !sameIdentity(finalPhysical.activeProof.identity, activeParentProof.identity) ||
            !sameNames(finalPhysical.activeProof.childNames, activeParentProof.childNames)
          ) {
            return fail('storage_error');
          }
          const finalQuarantine = await capturePhysicalDirectoryProof(quarantinePath);
          if (
            !sameIdentity(finalQuarantine.identity, quarantineProof.identity) ||
            !sameNames(finalQuarantine.childNames, quarantineProof.childNames)
          ) {
            return fail('storage_error');
          }
          return publication.catalog;
        } catch (error) {
          if (
            !catalogCommitted &&
            !catalogRenameOccurred &&
            activePath !== null &&
            publishedTreeProof !== null &&
            activeParentProof !== null
          ) {
            const ownedRoot = publishedTreeProof.nodes.get('');
            if (ownedRoot !== undefined) {
              await moveOwnedDirectoryRootToQuarantine(
                authority,
                activePath,
                ownedRoot,
                activeParentProof,
                quarantineProof
              ).catch((): undefined => undefined);
            }
          }
          throw error;
        }
      } catch (error) {
        return mapStorageError(error);
      }
    });

  const exactArtifactRequest = (
    authority: StudioExportProjectAuthorityV2,
    request: StudioExportArtifactRequestV2,
    catalog: StudioExportCatalogV2
  ): StudioExportArtifactV2 => {
    const record = request as unknown as Record<string, unknown>;
    if (
      !isDataRecord(request) ||
      !hasExactKeys(record, ['projectId', 'expectedCatalogRevision', 'artifactId']) ||
      request.projectId !== authority.project.id ||
      !isSafePositiveInteger(request.expectedCatalogRevision) ||
      request.expectedCatalogRevision !== catalog.revision ||
      !SAFE_ID.test(request.artifactId)
    ) {
      return fail('stale_catalog_revision');
    }
    const artifact = catalog.artifacts.find(({ id }) => id === request.artifactId);
    if (artifact === undefined) return fail('artifact_not_found');
    return artifact;
  };

  const validateDestinationPath = async (
    authority: StudioExportProjectAuthorityV2,
    destinationPath: string
  ): Promise<CopyDestinationAuthority> => {
    if (
      typeof destinationPath !== 'string' ||
      !path.isAbsolute(destinationPath) ||
      path.resolve(destinationPath) !== destinationPath ||
      path.basename(destinationPath).length === 0
    ) {
      return fail('invalid_destination');
    }
    const relativeToProject = path.relative(authority.projectDir, destinationPath);
    const escapesProject =
      relativeToProject === '..' || relativeToProject.startsWith(`..${path.sep}`) || path.isAbsolute(relativeToProject);
    if (relativeToProject === '' || !escapesProject) {
      return fail('invalid_destination');
    }
    const parentPath = path.dirname(destinationPath);
    const identity = await readVerifiedDirectory(parentPath);
    try {
      await fs.lstat(destinationPath);
      return fail('invalid_destination');
    } catch (error) {
      if (isMissing(error)) return { parentPath, identity };
      throw error;
    }
  };

  const reproveDestinationParent = async (authority: CopyDestinationAuthority): Promise<void> => {
    const current = await readVerifiedDirectory(authority.parentPath);
    if (!sameNodeIdentity(current, authority.identity)) return fail('storage_error');
  };

  const assertDestinationAbsent = async (destinationPath: string): Promise<void> => {
    try {
      await fs.lstat(destinationPath);
      return fail('invalid_destination');
    } catch (error) {
      if (isMissing(error)) return;
      throw error;
    }
  };

  const copyNodePath = (rootPath: string, relativePath: string): string =>
    relativePath.length === 0 ? rootPath : path.join(rootPath, ...relativePath.split('/'));

  const expectedCopyNodeKinds = (
    ownership: CopyTempOwnership,
    entries: readonly StudioExportManifestEntryV2[]
  ): Map<string, CopyOwnedNode['kind']> => {
    const expected = new Map<string, CopyOwnedNode['kind']>([['', ownership.kind]]);
    if (ownership.kind === 'file') {
      if (entries.length !== 1 || ownership.nodes.size !== 1) return fail('storage_error');
      return expected;
    }
    for (const entry of entries) {
      const segments = entry.relativePath.split('/');
      let relativeDirectory = '';
      for (const segment of segments.slice(0, -1)) {
        relativeDirectory = relativeDirectory.length === 0 ? segment : `${relativeDirectory}/${segment}`;
        const existing = expected.get(relativeDirectory);
        if (existing !== undefined && existing !== 'directory') return fail('storage_error');
        expected.set(relativeDirectory, 'directory');
      }
      if (expected.has(entry.relativePath)) return fail('storage_error');
      expected.set(entry.relativePath, 'file');
    }
    if (expected.size !== ownership.nodes.size) return fail('storage_error');
    return expected;
  };

  const captureCopyTempProof = async (
    rootPath: string,
    ownership: CopyTempOwnership,
    entries: readonly StudioExportManifestEntryV2[]
  ): Promise<CopyTempProof> => {
    const expected = expectedCopyNodeKinds(ownership, entries);
    const manifestEntries = new Map(entries.map((entry) => [entry.relativePath, entry]));
    const nodes = new Map<string, CopyOwnedProofNode>();
    const identities = new Set<string>();
    for (const [relativePath, kind] of expected) {
      const owned = ownership.nodes.get(relativePath);
      if (owned === undefined || owned.kind !== kind) return fail('storage_error');
      const nodePath = copyNodePath(rootPath, relativePath);
      let identity: ExactFileIdentity;
      if (kind === 'directory') {
        identity = await readVerifiedDirectory(nodePath);
        const actualChildren = (await fs.readdir(nodePath)).toSorted();
        if (JSON.stringify(actualChildren) !== JSON.stringify(directCopyChildren(expected, relativePath))) {
          return fail('storage_error');
        }
      } else {
        const entry = ownership.kind === 'file' ? entries[0] : manifestEntries.get(relativePath);
        if (entry === undefined) return fail('storage_error');
        identity = await hashPayloadFileNoFollow(nodePath, entry);
      }
      if (!sameNodeIdentity(identity, owned)) return fail('storage_error');
      const key = identityKey(identity);
      if (key === null || identities.has(key)) return fail('storage_error');
      identities.add(key);
      nodes.set(relativePath, { kind, identity });
    }
    for (const [relativePath, proof] of nodes) {
      if (proof.kind !== 'directory') continue;
      const nodePath = copyNodePath(rootPath, relativePath);
      const current = await readVerifiedDirectory(nodePath);
      const actualChildren = (await fs.readdir(nodePath)).toSorted();
      if (
        !sameIdentity(current, proof.identity) ||
        JSON.stringify(actualChildren) !== JSON.stringify(directCopyChildren(expected, relativePath))
      ) {
        return fail('storage_error');
      }
    }
    return { ownership, entries, nodes };
  };

  const sameCopyTempProof = (left: CopyTempProof, right: CopyTempProof, moved: boolean): boolean => {
    if (left.nodes.size !== right.nodes.size) return false;
    const compareIdentity = moved ? sameMovedIdentity : sameIdentity;
    for (const [relativePath, leftNode] of left.nodes) {
      const rightNode = right.nodes.get(relativePath);
      if (
        rightNode === undefined ||
        leftNode.kind !== rightNode.kind ||
        !compareIdentity(leftNode.identity, rightNode.identity)
      ) {
        return false;
      }
    }
    return true;
  };

  const ensureOwnedCopyPayloadParent = async (
    rootPath: string,
    relativePath: string,
    ownership: CopyTempOwnership,
    directories: Set<string>
  ): Promise<string> => {
    const segments = relativePath.split('/');
    let current = rootPath;
    let relativeDirectory = '';
    for (const segment of segments.slice(0, -1)) {
      const child = path.join(current, segment);
      if (path.dirname(child) !== current) return fail('storage_error');
      relativeDirectory = relativeDirectory.length === 0 ? segment : `${relativeDirectory}/${segment}`;
      const owned = ownership.nodes.get(relativeDirectory);
      if (owned === undefined) {
        await fs.mkdir(child, { mode: 0o700 });
        const identity = await readVerifiedDirectory(child);
        ownership.nodes.set(relativeDirectory, { kind: 'directory', dev: identity.dev, ino: identity.ino });
        await syncDirectory(current);
      } else {
        const identity = await readVerifiedDirectory(child);
        if (owned.kind !== 'directory' || !sameNodeIdentity(identity, owned)) return fail('storage_error');
      }
      directories.add(child);
      current = child;
    }
    return current;
  };

  const removeExactlyProvedCopyNode = async (
    rootPath: string,
    relativePath: string,
    proof: CopyTempProof
  ): Promise<void> => {
    const node = proof.nodes.get(relativePath);
    if (node === undefined) return fail('storage_error');
    const nodePath = copyNodePath(rootPath, relativePath);
    if (node.kind === 'file') {
      let handle: Awaited<ReturnType<typeof fs.open>> | null = null;
      try {
        handle = await fs.open(nodePath, fsConstants.O_RDONLY | NO_FOLLOW | NON_BLOCK);
        const openedStats = await handle.stat();
        const opened = exactIdentity(openedStats);
        const pathIdentity = exactIdentity(await fs.lstat(nodePath));
        if (
          !openedStats.isFile() ||
          openedStats.isSymbolicLink() ||
          opened.nlink !== 1 ||
          !sameIdentity(opened, node.identity) ||
          !sameIdentity(opened, pathIdentity)
        ) {
          return fail('storage_error');
        }
      } finally {
        await handle?.close();
      }
      const finalStats = await fs.lstat(nodePath);
      if (
        !finalStats.isFile() ||
        finalStats.isSymbolicLink() ||
        !sameIdentity(exactIdentity(finalStats), node.identity)
      ) {
        return fail('storage_error');
      }
      await fs.unlink(nodePath);
      return;
    }

    const before = await readVerifiedDirectory(nodePath);
    if (!sameIdentity(before, node.identity)) return fail('storage_error');
    const expectedChildren = directCopyChildren(
      new Map([...proof.nodes].map(([childPath, child]) => [childPath, child.kind])),
      relativePath
    );
    if (JSON.stringify((await fs.readdir(nodePath)).toSorted()) !== JSON.stringify(expectedChildren)) {
      return fail('storage_error');
    }
    const prefix = relativePath.length === 0 ? '' : `${relativePath}/`;
    for (const child of expectedChildren) {
      const childPath = prefix.length === 0 ? child : `${prefix}${child}`;
      await removeExactlyProvedCopyNode(rootPath, childPath, proof);
    }
    const after = await readVerifiedDirectory(nodePath);
    if (!sameNodeIdentity(after, node.identity) || (await fs.readdir(nodePath)).length !== 0) {
      return fail('storage_error');
    }
    await fs.rmdir(nodePath);
  };

  const cleanupOwnedCopyTemp = async (
    destinationAuthority: CopyDestinationAuthority,
    temporaryPath: string,
    proof: CopyTempProof
  ): Promise<void> => {
    try {
      await reproveDestinationParent(destinationAuthority);
      const currentProof = await captureCopyTempProof(temporaryPath, proof.ownership, proof.entries);
      if (!sameCopyTempProof(currentProof, proof, false)) return;
    } catch {
      return;
    }

    const claimDirectory = `${temporaryPath}.cleanup`;
    let claimIdentity: ExactFileIdentity;
    try {
      await fs.mkdir(claimDirectory, { mode: 0o700 });
      claimIdentity = await readVerifiedDirectory(claimDirectory);
      await syncDirectory(destinationAuthority.parentPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') return;
      throw error;
    }
    const abandonEmptyClaim = async (): Promise<void> => {
      const currentClaim = await readVerifiedDirectory(claimDirectory);
      if (!sameIdentity(currentClaim, claimIdentity)) return;
      await fs.rmdir(claimDirectory);
      await syncDirectory(destinationAuthority.parentPath);
    };
    try {
      await reproveDestinationParent(destinationAuthority);
      const currentProof = await captureCopyTempProof(temporaryPath, proof.ownership, proof.entries);
      if (!sameCopyTempProof(currentProof, proof, false)) {
        await abandonEmptyClaim();
        return;
      }
      const currentClaimBeforeMove = await readVerifiedDirectory(claimDirectory);
      if (!sameIdentity(currentClaimBeforeMove, claimIdentity)) return;
      const claimedPath = path.join(claimDirectory, 'entry');
      await fs.rename(temporaryPath, claimedPath);
      await syncDirectory(destinationAuthority.parentPath);
      await syncDirectory(claimDirectory);
      const claimedProof = await captureCopyTempProof(claimedPath, proof.ownership, proof.entries);
      if (!sameCopyTempProof(claimedProof, proof, true)) return;
      await removeExactlyProvedCopyNode(claimedPath, '', claimedProof);
      await syncDirectory(claimDirectory);
      const currentClaim = await readVerifiedDirectory(claimDirectory);
      if (!sameNodeIdentity(currentClaim, claimIdentity)) return;
      await fs.rmdir(claimDirectory);
      await syncDirectory(destinationAuthority.parentPath);
    } catch (error) {
      if (!isMissing(error)) throw error;
      await abandonEmptyClaim().catch((): undefined => undefined);
    }
  };

  const copyPayloadFile = async (
    sourcePath: string,
    destinationPath: string,
    entry: StudioExportManifestEntryV2,
    onCreated?: (identity: ExactFileIdentity) => void,
    expectedSourceIdentity?: ExactFileIdentity
  ): Promise<ExactFileIdentity> => {
    let source: Awaited<ReturnType<typeof fs.open>> | null = null;
    let destination: Awaited<ReturnType<typeof fs.open>> | null = null;
    let completed: ExactFileIdentity | null = null;
    let operationFailed = false;
    let operationError: unknown;
    try {
      source = await fs.open(sourcePath, fsConstants.O_RDONLY | NO_FOLLOW);
      destination = await fs.open(
        destinationPath,
        fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | NO_FOLLOW,
        0o600
      );
      const createdStats = await destination.stat();
      const created = exactIdentity(createdStats);
      if (!createdStats.isFile() || createdStats.isSymbolicLink() || created.nlink !== 1 || created.size !== 0) {
        return fail('storage_error');
      }
      onCreated?.(created);
      const beforeStats = await source.stat();
      const before = exactIdentity(beforeStats);
      const pathBefore = exactIdentity(await fs.lstat(sourcePath));
      if (
        !beforeStats.isFile() ||
        before.nlink !== 1 ||
        before.size !== entry.byteSize ||
        (expectedSourceIdentity !== undefined && !sameIdentity(before, expectedSourceIdentity)) ||
        !sameIdentity(before, pathBefore)
      ) {
        return fail('storage_error');
      }
      const digest = createHash('sha256');
      let byteSize = 0;
      for (;;) {
        const buffer = Buffer.allocUnsafe(COPY_BUFFER_BYTES);
        const { bytesRead } = await source.read(buffer, 0, buffer.byteLength, null);
        if (bytesRead === 0) break;
        byteSize += bytesRead;
        if (byteSize > entry.byteSize) return fail('storage_error');
        const chunk = buffer.subarray(0, bytesRead);
        digest.update(chunk);
        await writeAll(destination, chunk);
      }
      await destination.sync();
      const after = exactIdentity(await source.stat());
      const pathAfter = exactIdentity(await fs.lstat(sourcePath));
      const destinationStats = await destination.stat();
      const destinationIdentity = exactIdentity(destinationStats);
      const destinationPathIdentity = exactIdentity(await fs.lstat(destinationPath));
      if (
        byteSize !== entry.byteSize ||
        digest.digest('hex') !== entry.sha256 ||
        !sameIdentity(before, after) ||
        !sameIdentity(before, pathAfter) ||
        !destinationStats.isFile() ||
        destinationStats.isSymbolicLink() ||
        destinationIdentity.size !== entry.byteSize ||
        destinationIdentity.nlink !== 1 ||
        !sameIdentity(destinationIdentity, destinationPathIdentity)
      ) {
        return fail('storage_error');
      }
      completed = destinationIdentity;
    } catch (error) {
      operationFailed = true;
      operationError = error;
    }
    let closeFailed = false;
    let closeError: unknown;
    try {
      await source?.close();
    } catch (error) {
      closeFailed = true;
      closeError = error;
    }
    try {
      await destination?.close();
    } catch (error) {
      closeFailed = true;
      closeError ??= error;
    }
    if (operationFailed) throw operationError;
    if (closeFailed) throw closeError;
    return completed ?? fail('storage_error');
  };

  const rollbackOwnedCopyFileLink = async (
    destinationAuthority: CopyDestinationAuthority,
    temporaryPath: string,
    destinationPath: string,
    completedProof: CopyTempProof
  ): Promise<void> => {
    const entry = completedProof.entries[0];
    const owned = completedProof.nodes.get('');
    if (entry === undefined || owned === undefined || owned.kind !== 'file') return;
    try {
      await reproveDestinationParent(destinationAuthority);
      const temporary = await hashPayloadFileNoFollow(temporaryPath, entry, 2);
      const destination = await hashPayloadFileNoFollow(destinationPath, entry, 2);
      if (
        !sameIdentity(temporary, destination) ||
        !sameNodeIdentity(temporary, owned.identity) ||
        temporary.size !== owned.identity.size ||
        temporary.mtimeMs !== owned.identity.mtimeMs
      ) {
        return;
      }
      await fs.unlink(destinationPath);
      await syncDirectory(destinationAuthority.parentPath);
    } catch {
      // A missing or replaced path is no longer exclusively owned by this copy attempt.
    }
  };

  const publishCopyFileNoReplace = async (
    destinationAuthority: CopyDestinationAuthority,
    temporaryPath: string,
    destinationPath: string,
    completedProof: CopyTempProof,
    onProved: (proof: CopyTempProof) => void
  ): Promise<CopyTempProof> => {
    const entry = completedProof.entries[0];
    const owned = completedProof.nodes.get('');
    if (
      completedProof.ownership.kind !== 'file' ||
      completedProof.entries.length !== 1 ||
      entry === undefined ||
      owned === undefined ||
      owned.kind !== 'file'
    ) {
      return fail('storage_error');
    }
    try {
      await fs.link(temporaryPath, destinationPath);
    } catch (error) {
      if (isAlreadyExists(error)) return fail('invalid_destination');
      if (!isHardLinkUnavailable(error)) throw error;
      const holder: { ownership: CopyTempOwnership | null } = { ownership: null };
      let completedIdentity: ExactFileIdentity;
      try {
        completedIdentity = await copyPayloadFile(
          temporaryPath,
          destinationPath,
          entry,
          (created) => {
            const root: CopyOwnedNode = { kind: 'file', dev: created.dev, ino: created.ino };
            holder.ownership = { ...root, nodes: new Map([['', root]]) };
          },
          owned.identity
        );
      } catch (copyError) {
        if (isAlreadyExists(copyError)) return fail('invalid_destination');
        throw copyError;
      }
      if (holder.ownership === null || !sameNodeIdentity(completedIdentity, holder.ownership)) {
        return fail('storage_error');
      }
      await reproveDestinationParent(destinationAuthority);
      const publishedProof = await captureCopyTempProof(destinationPath, holder.ownership, [entry]);
      const currentTempProof = await captureCopyTempProof(
        temporaryPath,
        completedProof.ownership,
        completedProof.entries
      );
      if (!sameCopyTempProof(currentTempProof, completedProof, false)) return fail('storage_error');
      await reproveDestinationParent(destinationAuthority);
      onProved(publishedProof);
      await syncDirectory(destinationAuthority.parentPath);
      await cleanupOwnedCopyTemp(destinationAuthority, temporaryPath, completedProof);
      const finalPublishedProof = await captureCopyTempProof(destinationPath, holder.ownership, [entry]);
      if (!sameCopyTempProof(finalPublishedProof, publishedProof, false)) return fail('storage_error');
      return finalPublishedProof;
    }
    try {
      await reproveDestinationParent(destinationAuthority);
      const temporary = await hashPayloadFileNoFollow(temporaryPath, entry, 2);
      const destination = await hashPayloadFileNoFollow(destinationPath, entry, 2);
      if (
        !sameIdentity(temporary, destination) ||
        !sameNodeIdentity(temporary, owned.identity) ||
        temporary.size !== owned.identity.size ||
        temporary.mtimeMs !== owned.identity.mtimeMs
      ) {
        return fail('storage_error');
      }
      await syncDirectory(destinationAuthority.parentPath);
      await fs.unlink(temporaryPath);
      await syncDirectory(destinationAuthority.parentPath);
      const publishedProof = await captureCopyTempProof(
        destinationPath,
        completedProof.ownership,
        completedProof.entries
      );
      if (!sameCopyTempProof(publishedProof, completedProof, true)) return fail('storage_error');
      await reproveDestinationParent(destinationAuthority);
      onProved(publishedProof);
      return publishedProof;
    } catch (error) {
      await rollbackOwnedCopyFileLink(destinationAuthority, temporaryPath, destinationPath, completedProof);
      throw error;
    }
  };

  const publishCopyDirectoryNoReplace = async (
    destinationAuthority: CopyDestinationAuthority,
    temporaryPath: string,
    destinationPath: string,
    completedProof: CopyTempProof,
    onProved: (proof: CopyTempProof) => void
  ): Promise<CopyTempProof> => {
    if (completedProof.ownership.kind !== 'directory') return fail('storage_error');
    try {
      await fs.mkdir(destinationPath, { mode: 0o700 });
    } catch (error) {
      if (isAlreadyExists(error)) return fail('invalid_destination');
      throw error;
    }
    const created = await readVerifiedDirectory(destinationPath);
    const root: CopyOwnedNode = { kind: 'directory', dev: created.dev, ino: created.ino };
    const ownership: CopyTempOwnership = { ...root, nodes: new Map([['', root]]) };
    const directories = new Set<string>([destinationPath]);
    for (const entry of completedProof.entries) {
      const sourceNode = completedProof.nodes.get(entry.relativePath);
      if (sourceNode === undefined || sourceNode.kind !== 'file') return fail('storage_error');
      const payloadParent = await ensureOwnedCopyPayloadParent(
        destinationPath,
        entry.relativePath,
        ownership,
        directories
      );
      const targetPath = path.join(payloadParent, path.basename(entry.relativePath));
      const completedIdentity = await copyPayloadFile(
        copyNodePath(temporaryPath, entry.relativePath),
        targetPath,
        entry,
        (createdFile) => {
          if (ownership.nodes.has(entry.relativePath)) return fail('storage_error');
          ownership.nodes.set(entry.relativePath, {
            kind: 'file',
            dev: createdFile.dev,
            ino: createdFile.ino,
          });
        },
        sourceNode.identity
      );
      const ownedFile = ownership.nodes.get(entry.relativePath);
      if (ownedFile === undefined || !sameNodeIdentity(completedIdentity, ownedFile)) {
        return fail('storage_error');
      }
    }
    for (const directory of [...directories].toSorted((left, right) => right.length - left.length)) {
      await syncDirectory(directory);
    }
    await reproveDestinationParent(destinationAuthority);
    const publishedProof = await captureCopyTempProof(destinationPath, ownership, completedProof.entries);
    const currentTempProof = await captureCopyTempProof(
      temporaryPath,
      completedProof.ownership,
      completedProof.entries
    );
    if (!sameCopyTempProof(currentTempProof, completedProof, false)) return fail('storage_error');
    await reproveDestinationParent(destinationAuthority);
    onProved(publishedProof);
    await syncDirectory(destinationAuthority.parentPath);
    return publishedProof;
  };

  const copy = async (
    authority: StudioExportProjectAuthorityV2,
    request: StudioExportArtifactRequestV2,
    destination: string | StudioExportCopyDestinationPickerV2
  ): Promise<StudioCopyExportResultV2> =>
    enqueue(authority.project.id, async () => {
      try {
        const physical = await loadPhysicalCatalog(authority);
        const artifact = exactArtifactRequest(authority, request, physical.catalog);
        const source = physical.artifacts.get(artifact.id);
        if (source === undefined) return fail('storage_error');
        const suggestedName =
          artifact.payloadKind === 'file'
            ? path.basename(source.manifest.entries[0]!.relativePath)
            : suggestedDirectoryName(authority);
        const destinationPath =
          typeof destination === 'function'
            ? await destination({
                artifactId: artifact.id,
                shape: artifact.shape,
                payloadKind: artifact.payloadKind,
                suggestedName,
              })
            : destination;
        if (destinationPath === null) return { status: 'cancelled' };
        const afterPicker = await loadPhysicalCatalog(authority);
        if (!samePhysicalCatalogLedger(afterPicker, physical)) return fail('storage_error');
        const destinationAuthority = await validateDestinationPath(authority, destinationPath);
        await reprovePhysicalCatalogLedger(authority, physical);
        await reproveDestinationParent(destinationAuthority);
        const parentPath = destinationAuthority.parentPath;
        const temporaryPath = path.join(parentPath, `.${path.basename(destinationPath)}-${nextNonce()}.part`);
        let ownership: CopyTempOwnership | null = null;
        let completedProof: CopyTempProof | null = null;
        let publishedProof: CopyTempProof | null = null;
        try {
          if (artifact.payloadKind === 'file') {
            const entry = source.manifest.entries[0]!;
            const sourceNode = source.treeProof.nodes.get(entry.relativePath);
            if (sourceNode === undefined || sourceNode.kind !== 'file') return fail('storage_error');
            const holder: { ownership: CopyTempOwnership | null } = { ownership: null };
            const completedIdentity = await copyPayloadFile(
              source.payloadPaths.get(entry.relativePath)!,
              temporaryPath,
              entry,
              (created) => {
                const root: CopyOwnedNode = { kind: 'file', dev: created.dev, ino: created.ino };
                holder.ownership = { ...root, nodes: new Map([['', root]]) };
              },
              sourceNode.identity
            );
            if (holder.ownership === null || !sameNodeIdentity(completedIdentity, holder.ownership)) {
              return fail('storage_error');
            }
            ownership = holder.ownership;
            completedProof = await captureCopyTempProof(temporaryPath, ownership, [entry]);
          } else {
            await fs.mkdir(temporaryPath, { mode: 0o700 });
            const created = await readVerifiedDirectory(temporaryPath);
            const root: CopyOwnedNode = { kind: 'directory', dev: created.dev, ino: created.ino };
            const directoryOwnership: CopyTempOwnership = { ...root, nodes: new Map([['', root]]) };
            ownership = directoryOwnership;
            const directories = new Set<string>([temporaryPath]);
            for (const entry of source.manifest.entries) {
              const sourceNode = source.treeProof.nodes.get(entry.relativePath);
              if (sourceNode === undefined || sourceNode.kind !== 'file') return fail('storage_error');
              const payloadParent = await ensureOwnedCopyPayloadParent(
                temporaryPath,
                entry.relativePath,
                directoryOwnership,
                directories
              );
              const targetPath = path.join(payloadParent, path.basename(entry.relativePath));
              const completedIdentity = await copyPayloadFile(
                source.payloadPaths.get(entry.relativePath)!,
                targetPath,
                entry,
                (createdFile) => {
                  if (directoryOwnership.nodes.has(entry.relativePath)) return fail('storage_error');
                  directoryOwnership.nodes.set(entry.relativePath, {
                    kind: 'file',
                    dev: createdFile.dev,
                    ino: createdFile.ino,
                  });
                },
                sourceNode.identity
              );
              const ownedFile = directoryOwnership.nodes.get(entry.relativePath);
              if (ownedFile === undefined || !sameNodeIdentity(completedIdentity, ownedFile)) {
                return fail('storage_error');
              }
            }
            for (const directory of [...directories].toSorted((left, right) => right.length - left.length)) {
              await syncDirectory(directory);
            }
            completedProof = await captureCopyTempProof(temporaryPath, directoryOwnership, source.manifest.entries);
            const completedRoot = completedProof.nodes.get('');
            if (completedRoot === undefined || !sameNodeIdentity(created, completedRoot.identity)) {
              return fail('storage_error');
            }
          }
          await step('copy_temp_closed');
          authority.assertActive?.();
          await reproveDestinationParent(destinationAuthority);
          await assertDestinationAbsent(destinationPath);
          if (ownership === null || completedProof === null) return fail('storage_error');
          await step('copy_temp_reproved');
          const finalProof = await captureCopyTempProof(temporaryPath, ownership, completedProof.entries);
          if (!sameCopyTempProof(finalProof, completedProof, false)) return fail('storage_error');
          await reproveDestinationParent(destinationAuthority);
          await assertDestinationAbsent(destinationPath);
          authority.assertActive?.();
          if (ownership.kind === 'file') {
            publishedProof = await publishCopyFileNoReplace(
              destinationAuthority,
              temporaryPath,
              destinationPath,
              completedProof,
              (proof) => {
                publishedProof = proof;
              }
            );
          } else {
            publishedProof = await publishCopyDirectoryNoReplace(
              destinationAuthority,
              temporaryPath,
              destinationPath,
              completedProof,
              (proof) => {
                publishedProof = proof;
              }
            );
            await cleanupOwnedCopyTemp(destinationAuthority, temporaryPath, completedProof);
          }
          await reproveDestinationParent(destinationAuthority);
          const finalPublishedProof = await captureCopyTempProof(
            destinationPath,
            publishedProof.ownership,
            publishedProof.entries
          );
          if (!sameCopyTempProof(finalPublishedProof, publishedProof, false)) {
            return fail('storage_error');
          }
          await reproveDestinationParent(destinationAuthority);
          await syncDirectory(parentPath);
          const finalSource = await loadPhysicalCatalog(authority);
          if (!samePhysicalCatalogLedger(finalSource, physical)) return fail('storage_error');
        } catch (error) {
          if (publishedProof !== null) {
            const proofToRemove = publishedProof;
            await reproveDestinationParent(destinationAuthority)
              .then(async () => {
                await removeExactlyProvedCopyNode(destinationPath, '', proofToRemove);
                await syncDirectory(parentPath);
              })
              .catch((): undefined => undefined);
          }
          if (completedProof !== null) {
            await cleanupOwnedCopyTemp(destinationAuthority, temporaryPath, completedProof).catch(
              (): undefined => undefined
            );
          }
          throw error;
        }
        return { status: 'copied' };
      } catch (error) {
        return mapStorageError(error);
      }
    });

  const resolveRevealPath = async (
    authority: StudioExportProjectAuthorityV2,
    request: StudioExportArtifactRequestV2
  ): Promise<string> =>
    enqueue(authority.project.id, async () => {
      try {
        const physical = await loadPhysicalCatalog(authority);
        const artifact = exactArtifactRequest(authority, request, physical.catalog);
        const resolved = physical.artifacts.get(artifact.id);
        if (resolved === undefined) return fail('storage_error');
        const revealPath =
          artifact.payloadKind === 'directory'
            ? resolved.rootPath
            : resolved.payloadPaths.get(resolved.manifest.entries[0]!.relativePath)!;
        const finalPhysical = await loadPhysicalCatalog(authority);
        if (!samePhysicalCatalogLedger(finalPhysical, physical)) return fail('storage_error');
        return revealPath;
      } catch (error) {
        return mapStorageError(error);
      }
    });

  const repair = async (authority: StudioExportProjectAuthorityV2): Promise<StudioExportCatalogV2> =>
    enqueue(authority.project.id, async () => {
      try {
        const context = await assertAuthority(authority);
        const quarantinePath = path.join(authority.projectDir, QUARANTINE_DIRECTORY_NAME);
        const initialQuarantine = await snapshotQuarantineEntries(quarantinePath);
        await quarantineUnsupportedCatalog(authority, context);
        const physical = await loadPhysicalCatalogWithContext(authority, context);
        authority.assertActive?.();
        await recoverCatalogTemps(authority, context);
        const activePath = path.join(authority.projectDir, ACTIVE_DIRECTORY_NAME);
        let activeProof = physical.activeProof;
        let quarantineProof: PhysicalDirectoryProof | null = null;
        const currentQuarantineIdentity = await readOptionalVerifiedDirectory(quarantinePath);
        if (currentQuarantineIdentity !== null) {
          quarantineProof = await capturePhysicalDirectoryProof(quarantinePath, currentQuarantineIdentity);
          if (initialQuarantine !== null && !sameNodeIdentity(quarantineProof.identity, initialQuarantine.identity)) {
            return fail('storage_error');
          }
        }
        await reprovePhysicalArtifactLedgers(physical);
        await authority.assertCurrent?.();
        await assertCatalogPathIdentity(authority, physical.identity, 'storage_error');

        const retainedNames = new Set(physical.catalog.artifacts.map(({ managedExport }) => managedExport.fileName));
        const retainedActiveNames = new Set(retainedNames);
        for (const name of physical.activeFinderMetadataFiles.keys()) retainedActiveNames.add(name);
        const orphanNames =
          activeProof === null ? [] : activeProof.childNames.filter((entry) => !retainedActiveNames.has(entry));
        for (const entry of orphanNames) {
          if (activeProof === null) return fail('storage_error');
          await reprovePhysicalDirectory(activeProof);
          await reprovePhysicalArtifactLedgers(physical);
          await authority.assertCurrent?.();
          await assertCatalogPathIdentity(authority, physical.identity, 'storage_error');
          const orphanPath = path.join(activePath, entry);
          if (path.dirname(orphanPath) !== activePath) return fail('storage_error');
          const orphanProof = await captureQuarantineNodeProof(orphanPath, false);
          await reprovePhysicalDirectory(activeProof);
          if (quarantineProof === null) {
            const ensuredQuarantine = await ensureQuarantineDirectory(authority);
            quarantineProof = await capturePhysicalDirectoryProof(ensuredQuarantine);
          }
          const moved = await moveProvedNodeToQuarantine(
            authority,
            orphanPath,
            orphanProof,
            activeProof,
            quarantineProof
          );
          activeProof = moved.sourceParentProof;
          quarantineProof = moved.quarantineProof;
        }
        if (initialQuarantine !== null) {
          const currentQuarantine = await readVerifiedDirectory(quarantinePath);
          if (!sameNodeIdentity(currentQuarantine, initialQuarantine.identity)) return fail('storage_error');
          for (const entry of initialQuarantine.entries) {
            try {
              if (activeProof !== null) await reprovePhysicalDirectory(activeProof);
              await reprovePhysicalArtifactLedgers(physical);
              await authority.assertCurrent?.();
              await assertCatalogPathIdentity(authority, physical.identity, 'storage_error');
              authority.assertActive?.();
              await removeQuarantineEntry(quarantinePath, initialQuarantine.identity, entry);
              quarantineProof = await capturePhysicalDirectoryProof(quarantinePath);
              if (!sameNodeIdentity(quarantineProof.identity, initialQuarantine.identity)) {
                return fail('storage_error');
              }
            } catch (error) {
              if (!isMissing(error)) throw error;
            }
          }
          await syncDirectory(quarantinePath);
        }
        const finalPhysical = await loadPhysicalCatalogWithContext(authority, context);
        if (
          JSON.stringify(finalPhysical.catalog) !== JSON.stringify(physical.catalog) ||
          (finalPhysical.identity === null) !== (physical.identity === null) ||
          (finalPhysical.identity !== null &&
            physical.identity !== null &&
            !sameIdentity(finalPhysical.identity, physical.identity)) ||
          !samePhysicalFileProofs(physical.activeFinderMetadataFiles, finalPhysical.activeFinderMetadataFiles) ||
          !retainedArtifactProofsMatch(physical, finalPhysical, '')
        ) {
          return fail('storage_error');
        }
        if (physical.activeProof === null || finalPhysical.activeProof === null) {
          if (physical.activeProof !== finalPhysical.activeProof) return fail('storage_error');
        } else if (
          !sameNodeIdentity(finalPhysical.activeProof.identity, physical.activeProof.identity) ||
          !sameNames(finalPhysical.activeProof.childNames, [...retainedActiveNames].toSorted())
        ) {
          return fail('storage_error');
        }
        if (quarantineProof !== null) {
          const finalQuarantine = await capturePhysicalDirectoryProof(quarantinePath);
          if (!sameNodeIdentity(finalQuarantine.identity, quarantineProof.identity)) return fail('storage_error');
        }
        return finalPhysical.catalog;
      } catch (error) {
        return mapStorageError(error);
      }
    });

  const withManagedMediaAuthority = async <T>(
    authority: StudioExportProjectAuthorityV2,
    operation: (facts: StudioExportManagedByteFactsV2) => Promise<T>
  ): Promise<T> => {
    if (typeof operation !== 'function') return fail('storage_error');
    return enqueue(authority.project.id, async () => {
      let facts: StudioExportManagedByteFactsV2;
      try {
        const physical = await loadPhysicalCatalog(authority);
        facts = managedByteFacts(physical);
        authority.assertActive?.();
      } catch (error) {
        return mapStorageError(error);
      }
      return operation(facts);
    });
  };

  return {
    list: (authority) =>
      enqueue(authority.project.id, async () => {
        try {
          return (await loadPhysicalCatalog(authority)).catalog;
        } catch (error) {
          return mapStorageError(error);
        }
      }),
    create,
    copy,
    resolveRevealPath,
    repair,
    withManagedMediaAuthority,
  };
};
