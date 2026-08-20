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
]);

export const STUDIO_MAX_ACTIVE_BRIEF_REFERENCES = 6;
export const STUDIO_BRIEF_REFERENCE_LABEL_MAX_LENGTH = 160;
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
  !Object.hasOwn(asset, 'height') &&
  !Object.hasOwn(asset, 'sourceLook') &&
  !Object.hasOwn(asset, 'briefReferenceRole') &&
  !Object.hasOwn(asset, 'briefReferenceLabel');

const isUnsafeLabelCharacter = (character: string): boolean => {
  const codePoint = character.codePointAt(0)!;
  return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f) || (codePoint >= 0xd800 && codePoint <= 0xdfff);
};

export const isStudioBriefReferenceLabel = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= STUDIO_BRIEF_REFERENCE_LABEL_MAX_LENGTH &&
  value === value.trim() &&
  !Array.from(value).some(isUnsafeLabelCharacter);

const truncateLabel = (value: string, maximumLength: number): string => {
  let result = '';
  for (const character of value) {
    if (result.length + character.length > maximumLength) break;
    result += character;
  }
  return result;
};

/** Derives one stable display label from a portable source basename and allocates its first free suffix. */
export const allocateStudioBriefReferenceLabel = (sourceName: string, existingLabels: readonly string[]): string => {
  const basename = sourceName.replaceAll('\\', '/').split('/').at(-1) ?? '';
  const extensionStart = basename.lastIndexOf('.');
  const stem = extensionStart > 0 ? basename.slice(0, extensionStart) : basename;
  const sanitized = Array.from(stem, (character) => (isUnsafeLabelCharacter(character) ? ' ' : character))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  const base = truncateLabel(sanitized || 'reference', STUDIO_BRIEF_REFERENCE_LABEL_MAX_LENGTH);
  const occupied = new Set(existingLabels);
  if (!occupied.has(base)) return base;
  for (let suffixNumber = 2; ; suffixNumber += 1) {
    const suffix = ` (${suffixNumber})`;
    const candidate = `${truncateLabel(base, STUDIO_BRIEF_REFERENCE_LABEL_MAX_LENGTH - suffix.length)}${suffix}`;
    if (!occupied.has(candidate)) return candidate;
  }
};
