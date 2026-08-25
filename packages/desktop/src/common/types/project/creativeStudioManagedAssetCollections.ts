/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { StudioAssetV2, StudioManagedAssetRefV2 } from './creativeStudioTypes';

/**
 * Single source of truth for every managed-asset collection the store durably recognises.
 * store.ts's write-side validator and mediaStore.ts's read-side resolver gate must both consume
 * this set instead of each declaring their own copy of the union, so the two can never drift.
 */
/** Exact managed-asset collections accepted by the Beat/Shot store and media resolver. */
export const STUDIO_MANAGED_ASSET_COLLECTIONS_V2: ReadonlySet<StudioManagedAssetRefV2['collection']> = new Set([
  'assets',
  'imports',
  'thumbnails',
  'conditioningFrames',
  'boardStills',
]);

const STUDIO_REFERENCE_IMAGE_MIME_TYPES: ReadonlySet<string> = new Set(['image/jpeg', 'image/png', 'image/webp']);

export const isStudioReferenceImageMimeType = (value: unknown): value is string =>
  typeof value === 'string' && STUDIO_REFERENCE_IMAGE_MIME_TYPES.has(value);

/** Returns whether one project-owned audio record has the exact canonical WAV import shape. */
export const isCanonicalStudioBedAudioAssetV2 = (asset: StudioAssetV2): boolean =>
  asset.shotId === null &&
  asset.mediaKind === 'audio' &&
  asset.mimeType === 'audio/wav' &&
  asset.managedAsset.collection === 'imports' &&
  asset.managedAsset.fileName === `${asset.id}.wav` &&
  Number.isSafeInteger(asset.byteSize) &&
  asset.byteSize > 0 &&
  typeof asset.durationSeconds === 'number' &&
  Number.isFinite(asset.durationSeconds) &&
  asset.durationSeconds > 0 &&
  !Object.hasOwn(asset, 'width') &&
  !Object.hasOwn(asset, 'height');
