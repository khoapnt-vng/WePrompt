/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { StudioAspectRatio, StudioAsset, StudioManagedAssetRef, StudioResolution } from './creativeStudioTypes';

/**
 * Single source of truth for every managed-asset collection the store durably recognises.
 * store.ts's write-side validator and mediaStore.ts's read-side resolver gate must both consume
 * this set instead of each declaring their own copy of the union, so the two can never drift.
 */
export const STUDIO_MANAGED_ASSET_COLLECTIONS: ReadonlySet<StudioManagedAssetRef['collection']> = new Set([
  'assets',
  'imports',
  'thumbnails',
  'references',
]);

export const STUDIO_MAX_ACTIVE_BRIEF_REFERENCES = 6;
export const STUDIO_BRIEF_REFERENCE_LABEL_MAX_LENGTH = 160;

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

/**
 * Returns active Brief references in provider order, or null when any classification is malformed
 * or the application-wide active-reference ceiling is exceeded.
 */
export const resolveActiveStudioBriefReferences = (
  assets: Readonly<Record<string, StudioAsset>>
): StudioAsset[] | null => {
  const active: StudioAsset[] = [];
  for (const asset of Object.values(assets)) {
    const hasRole = asset.briefReferenceRole !== undefined;
    const hasLabel = asset.briefReferenceLabel !== undefined;
    if (hasRole !== hasLabel) return null;
    if (!hasRole) continue;
    if (
      (asset.briefReferenceRole !== 'cast' && asset.briefReferenceRole !== 'look') ||
      !isStudioBriefReferenceLabel(asset.briefReferenceLabel) ||
      asset.sceneId !== null ||
      asset.mediaKind !== 'image' ||
      asset.managedAsset.collection !== 'imports'
    ) {
      return null;
    }
    active.push(asset);
  }
  if (active.length > STUDIO_MAX_ACTIVE_BRIEF_REFERENCES) return null;
  return active.toSorted((left, right) => {
    const byRole = Number(left.briefReferenceRole === 'look') - Number(right.briefReferenceRole === 'look');
    return byRole || left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
  });
};

export type StudioReferencePlateFreshness = 'current' | 'out_of_date' | 'unknown';

type CurrentStudioReferencePlateInputs = {
  visualPrompt: string;
  referenceAssetIds: readonly string[];
  aspectRatio: StudioAspectRatio;
  resolution: StudioResolution;
};

/** Compares every frame-defining input while treating absent legacy provenance as unknown, never stale. */
export const getStudioReferencePlateFreshness = (
  asset: StudioAsset,
  current: CurrentStudioReferencePlateInputs
): StudioReferencePlateFreshness => {
  if (
    asset.sourceVisualPrompt === undefined ||
    asset.sourceReferenceAssetIds === undefined ||
    asset.sourceAspectRatio === undefined ||
    asset.sourceResolution === undefined
  ) {
    return 'unknown';
  }
  const referencesMatch =
    asset.sourceReferenceAssetIds.length === current.referenceAssetIds.length &&
    asset.sourceReferenceAssetIds.every((assetId, index) => assetId === current.referenceAssetIds[index]);
  return asset.sourceVisualPrompt === current.visualPrompt &&
    referencesMatch &&
    asset.sourceAspectRatio === current.aspectRatio &&
    asset.sourceResolution === current.resolution
    ? 'current'
    : 'out_of_date';
};
