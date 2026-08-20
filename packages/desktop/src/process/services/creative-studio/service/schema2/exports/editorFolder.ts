/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { isCanonicalStudioGeneratedTakeV2 } from '@/common/types/project/creativeStudioCanonicalTake';
import { isCanonicalStudioBedAudioAssetV2 } from '@/common/types/project/creativeStudioManagedAssetCollections';
import {
  STUDIO_BED_FADE_OUT_SECONDS,
  STUDIO_MAX_EXPORT_FILES_PER_ARTIFACT,
  STUDIO_PROJECT_SCHEMA_VERSION,
  type StudioAssetV2,
  type StudioEditorFolderTimelineBeatV2,
  type StudioEditorFolderTimelineV2,
  type StudioProjectV2,
} from '@/common/types/project/creativeStudioTypes';
import { validateStudioProjectV2 } from '../validation';
import {
  compareStudioExportRelativePathsV2,
  parseStudioExportManifestV2,
  serializeStudioExportManifestV2,
  type StudioExportManifestEntryV2,
} from './catalog';

const SAFE_ID = /^[A-Za-z0-9_-]{1,256}$/;
const LOWERCASE_SHA256 = /^[a-f0-9]{64}$/;
const SAFE_EXTENSION = /^[a-z0-9]{1,16}$/;

export type StudioEditorFolderVerifiedMediaV2 = {
  assetId: string;
  byteSize: number;
  sha256: string;
};

export type StudioEditorFolderGeneratedFileV2 = {
  kind: 'generated';
  relativePath: string;
  bytes: Uint8Array;
  byteSize: number;
  sha256: string;
};

export type StudioEditorFolderManagedFileV2 = {
  kind: 'managed_asset';
  relativePath: string;
  assetId: string;
  byteSize: number;
  sha256: string;
};

export type StudioEditorFolderPayloadFileV2 = StudioEditorFolderGeneratedFileV2 | StudioEditorFolderManagedFileV2;

export type StudioEditorFolderCompositionV2 = {
  timeline: StudioEditorFolderTimelineV2;
  timelineBytes: Uint8Array;
  files: StudioEditorFolderPayloadFileV2[];
  manifest: StudioExportManifestEntryV2[];
  manifestBytes: Uint8Array;
  manifestSha256: string;
  byteSize: number;
  fileCount: number;
};

export type StudioEditorFolderErrorCodeV2 =
  | 'invalid_project'
  | 'coverage_incomplete'
  | 'duration_pending'
  | 'invalid_media'
  | 'bed_too_short'
  | 'capacity_exceeded'
  | 'arithmetic_overflow';

export class StudioEditorFolderErrorV2 extends Error {
  readonly code: StudioEditorFolderErrorCodeV2;

  constructor(code: StudioEditorFolderErrorCodeV2) {
    super(code);
    this.name = 'StudioEditorFolderErrorV2';
    this.code = code;
  }
}

const fail = (code: StudioEditorFolderErrorCodeV2): never => {
  throw new StudioEditorFolderErrorV2(code);
};

const ownRecordValue = <Value>(record: Readonly<Record<string, Value>>, key: string): Value | undefined =>
  Object.hasOwn(record, key) ? record[key] : undefined;

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

const safeAdd = (left: number, right: number): number => {
  const result = left + right;
  if (
    !Number.isFinite(left) ||
    !Number.isFinite(right) ||
    left < 0 ||
    right < 0 ||
    !Number.isFinite(result) ||
    result > Number.MAX_SAFE_INTEGER
  ) {
    return fail('arithmetic_overflow');
  }
  return result;
};

const extensionForAsset = (asset: StudioAssetV2): string => {
  const separator = asset.managedAsset.fileName.lastIndexOf('.');
  const extension = separator < 0 ? '' : asset.managedAsset.fileName.slice(separator + 1);
  if (!SAFE_EXTENSION.test(extension)) return fail('invalid_media');
  return extension;
};

const dimensionsForProject = (project: StudioProjectV2): { width: number; height: number } => {
  const longEdge = project.resolution === '1080p' ? 1920 : 1280;
  const shortEdge = project.resolution === '1080p' ? 1080 : 720;
  switch (project.aspectRatio) {
    case '16:9':
      return { width: longEdge, height: shortEdge };
    case '9:16':
      return { width: shortEdge, height: longEdge };
    case '1:1':
      return { width: shortEdge, height: shortEdge };
    case '4:3':
      return { width: Math.round((shortEdge * 4) / 3), height: shortEdge };
    case '3:4':
      return { width: shortEdge, height: Math.round((shortEdge * 4) / 3) };
  }
};

const crc32 = (bytes: Uint8Array): number => {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
};

const pngChunk = (name: 'IHDR' | 'IDAT' | 'IEND', data: Uint8Array): Buffer => {
  const type = Buffer.from(name, 'ascii');
  const chunk = Buffer.alloc(12 + data.byteLength);
  chunk.writeUInt32BE(data.byteLength, 0);
  type.copy(chunk, 4);
  Buffer.from(data).copy(chunk, 8);
  chunk.writeUInt32BE(crc32(chunk.subarray(4, 8 + data.byteLength)), 8 + data.byteLength);
  return chunk;
};

/** Generates a deterministic lossless black grayscale PNG with no text or remote content. */
export const createStudioBlackSlatePngV2 = (width: number, height: number): Uint8Array => {
  if (!Number.isSafeInteger(width) || width < 1 || !Number.isSafeInteger(height) || height < 1) {
    return fail('invalid_project');
  }
  const rowBytes = width + 1;
  const rawByteSize = rowBytes * height;
  if (!Number.isSafeInteger(rawByteSize)) return fail('arithmetic_overflow');
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 0;
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;
  const compressed = deflateSync(Buffer.alloc(rawByteSize), { level: 9 });
  return Uint8Array.from(
    Buffer.concat([
      Buffer.from('89504e470d0a1a0a', 'hex'),
      pngChunk('IHDR', header),
      pngChunk('IDAT', compressed),
      pngChunk('IEND', new Uint8Array()),
    ])
  );
};

const generatedFile = (relativePath: string, bytes: Uint8Array): StudioEditorFolderGeneratedFileV2 => ({
  kind: 'generated',
  relativePath,
  bytes: Uint8Array.from(bytes),
  byteSize: bytes.byteLength,
  sha256: sha256(bytes),
});

/**
 * Composes a complete non-stitched editor package from one canonical project revision and the exact
 * managed-media proofs revalidated by main immediately before publication.
 */
export const composeStudioEditorFolderV2 = (
  project: StudioProjectV2,
  verifiedMedia: readonly StudioEditorFolderVerifiedMediaV2[]
): StudioEditorFolderCompositionV2 => {
  if (!validateStudioProjectV2(project)) return fail('invalid_project');
  const proofs = new Map<string, StudioEditorFolderVerifiedMediaV2>();
  for (const proof of verifiedMedia) {
    if (
      !SAFE_ID.test(proof.assetId) ||
      !Number.isSafeInteger(proof.byteSize) ||
      proof.byteSize < 0 ||
      !LOWERCASE_SHA256.test(proof.sha256) ||
      proofs.has(proof.assetId)
    ) {
      return fail('invalid_media');
    }
    proofs.set(proof.assetId, proof);
  }

  const usedProofIds = new Set<string>();
  const files: StudioEditorFolderPayloadFileV2[] = [];
  const timelineBeats: StudioEditorFolderTimelineBeatV2[] = [];
  let timelineStartSeconds = 0;
  let shotOrdinal = 0;
  let needsSlate = false;

  const requireVerifiedAsset = (asset: StudioAssetV2): void => {
    const proof = proofs.get(asset.id);
    if (proof === undefined || proof.byteSize !== asset.byteSize || proof.sha256 !== asset.sha256) {
      return fail('invalid_media');
    }
    usedProofIds.add(asset.id);
  };

  for (const beatId of project.beatOrder) {
    const beat = ownRecordValue(project.beats, beatId);
    if (beat === undefined) return fail('invalid_project');
    const beatStartSeconds = timelineStartSeconds;
    const entries: StudioEditorFolderTimelineBeatV2['entries'] = [];

    if (beat.shotOrder.length === 0) {
      if (beat.targetSeconds === null) return fail('duration_pending');
      if (!Number.isFinite(beat.targetSeconds) || beat.targetSeconds <= 0) return fail('invalid_project');
      needsSlate = true;
      entries.push({
        kind: 'slate',
        relativePath: 'media/slate.png',
        timelineStartSeconds,
        durationSeconds: beat.targetSeconds,
      });
      timelineStartSeconds = safeAdd(timelineStartSeconds, beat.targetSeconds);
    } else {
      for (const shotId of beat.shotOrder) {
        const shot = ownRecordValue(project.shots, shotId);
        if (shot === undefined) return fail('invalid_project');
        if (shot.selectedTakeId === null) return fail('coverage_incomplete');
        const take = ownRecordValue(project.assets, shot.selectedTakeId);
        if (
          take === undefined ||
          take.mediaKind !== 'video' ||
          !isCanonicalStudioGeneratedTakeV2(take, project.id, shot) ||
          project.bin.some((item) => item.kind === 'take' && item.assetId === take.id) ||
          !Number.isFinite(take.durationSeconds) ||
          take.durationSeconds === undefined ||
          take.durationSeconds <= 0
        ) {
          return fail('coverage_incomplete');
        }
        requireVerifiedAsset(take);
        const sourceInSeconds = shot.trimInSeconds ?? 0;
        const sourceOutSeconds = take.durationSeconds - (shot.trimOutSeconds ?? 0);
        const durationSeconds = sourceOutSeconds - sourceInSeconds;
        if (
          !Number.isFinite(sourceInSeconds) ||
          !Number.isFinite(sourceOutSeconds) ||
          !Number.isFinite(durationSeconds) ||
          sourceInSeconds < 0 ||
          sourceOutSeconds <= sourceInSeconds ||
          durationSeconds <= 0
        ) {
          return fail('invalid_media');
        }
        shotOrdinal += 1;
        const relativePath = `media/shot-${String(shotOrdinal).padStart(3, '0')}.${extensionForAsset(take)}`;
        entries.push({
          kind: 'shot',
          shotId,
          takeAssetId: take.id,
          relativePath,
          timelineStartSeconds,
          sourceInSeconds,
          sourceOutSeconds,
          durationSeconds,
          chainBreak: shot.chainBreak,
        });
        files.push({
          kind: 'managed_asset',
          relativePath,
          assetId: take.id,
          byteSize: take.byteSize,
          sha256: take.sha256,
        });
        timelineStartSeconds = safeAdd(timelineStartSeconds, durationSeconds);
      }
    }

    timelineBeats.push({
      beatId,
      title: beat.title,
      timelineStartSeconds: beatStartSeconds,
      durationSeconds: timelineStartSeconds - beatStartSeconds,
      entries,
    });
  }

  const durationSeconds = timelineStartSeconds;
  let bed: StudioEditorFolderTimelineV2['bed'] = null;
  if (project.bedAssetId !== null) {
    const bedAsset = ownRecordValue(project.assets, project.bedAssetId);
    if (bedAsset === undefined || bedAsset.projectId !== project.id || !isCanonicalStudioBedAudioAssetV2(bedAsset)) {
      return fail('invalid_media');
    }
    if (bedAsset.durationSeconds < durationSeconds) return fail('bed_too_short');
    requireVerifiedAsset(bedAsset);
    const relativePath = `media/bed.${extensionForAsset(bedAsset)}`;
    bed = {
      assetId: bedAsset.id,
      relativePath,
      sourceInSeconds: 0,
      sourceOutSeconds: durationSeconds,
      fadeOutStartSeconds: Math.max(0, durationSeconds - STUDIO_BED_FADE_OUT_SECONDS),
      fadeOutEndSeconds: durationSeconds,
    };
    files.push({
      kind: 'managed_asset',
      relativePath,
      assetId: bedAsset.id,
      byteSize: bedAsset.byteSize,
      sha256: bedAsset.sha256,
    });
  }

  if (usedProofIds.size !== proofs.size) return fail('invalid_media');
  const timeline: StudioEditorFolderTimelineV2 = {
    schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
    projectId: project.id,
    sourceRevision: project.revision,
    name: project.name,
    aspectRatio: project.aspectRatio,
    resolution: project.resolution,
    durationSeconds,
    beats: timelineBeats,
    bed,
  };
  const timelineBytes = Buffer.from(JSON.stringify(timeline), 'utf8');
  files.push(generatedFile('timeline.json', timelineBytes));
  if (needsSlate) {
    const { width, height } = dimensionsForProject(project);
    files.push(generatedFile('media/slate.png', createStudioBlackSlatePngV2(width, height)));
  }
  if (files.length > STUDIO_MAX_EXPORT_FILES_PER_ARTIFACT) return fail('capacity_exceeded');

  files.sort((left, right) => compareStudioExportRelativePathsV2(left.relativePath, right.relativePath));
  const manifest = files.map(({ relativePath, byteSize, sha256: digest }) => ({
    relativePath,
    byteSize,
    sha256: digest,
  }));
  const manifestBytes = serializeStudioExportManifestV2(manifest);
  const validatedManifest = parseStudioExportManifestV2(manifestBytes);
  return {
    timeline,
    timelineBytes: Uint8Array.from(timelineBytes),
    files,
    manifest,
    manifestBytes,
    manifestSha256: validatedManifest.manifestSha256,
    byteSize: validatedManifest.byteSize,
    fileCount: validatedManifest.fileCount,
  };
};
