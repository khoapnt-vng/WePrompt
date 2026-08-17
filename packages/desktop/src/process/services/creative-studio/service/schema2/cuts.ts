/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  StudioAssetV2,
  StudioClip,
  StudioCutClipV2,
  StudioCutV2,
  StudioProjectV2,
} from '@/common/types/project/creativeStudioTypes';

const MAXIMUM_ID_LENGTH = 256;

export type StudioCutReconciliationScopeV2 =
  | { kind: 'all' }
  | { kind: 'structure' }
  | { kind: 'selection'; clipId: string };

const ownValue = <T>(record: Record<string, T>, id: string): T | undefined =>
  Object.hasOwn(record, id) ? record[id] : undefined;

const isCanonicalGeneratedTake = (
  project: StudioProjectV2,
  clip: StudioClip,
  asset: StudioAssetV2,
  clipAssetIdsByClipId: ReadonlyMap<string, ReadonlySet<string>>
): boolean =>
  asset.projectId === project.id &&
  asset.clipId === clip.id &&
  asset.mediaKind === clip.mediaKind &&
  asset.managedAsset.collection === 'assets' &&
  clipAssetIdsByClipId.get(clip.id)?.has(asset.id) === true;

const selectedTake = (
  project: StudioProjectV2,
  clip: StudioClip,
  clipAssetIdsByClipId: ReadonlyMap<string, ReadonlySet<string>>
): StudioAssetV2 | null => {
  if (clip.selectedAssetId === null) return null;
  const asset = ownValue(project.assets, clip.selectedAssetId);
  return asset !== undefined && isCanonicalGeneratedTake(project, clip, asset, clipAssetIdsByClipId) ? asset : null;
};

const cutClipIdBase = (clipId: string, suffix = ''): string =>
  `clip_${clipId}`.slice(0, MAXIMUM_ID_LENGTH - suffix.length) + suffix;

const allocateCutClipId = (clipId: string, occupied: ReadonlySet<string>): string => {
  const base = cutClipIdBase(clipId);
  if (!occupied.has(base)) return base;
  let suffixIndex = 2;
  while (occupied.has(cutClipIdBase(clipId, `_${suffixIndex}`))) suffixIndex += 1;
  return cutClipIdBase(clipId, `_${suffixIndex}`);
};

const copyCutClip = (cutClip: StudioCutClipV2): StudioCutClipV2 => {
  const filters: StudioCutClipV2['filters'] = [];
  for (let index = 0; index < cutClip.filters.length; index += 1) {
    filters.push({ ...cutClip.filters[index]! });
  }
  return {
    ...cutClip,
    crop: cutClip.crop === null ? null : { ...cutClip.crop },
    filters,
  };
};

const clampCutClipToAsset = (cutClip: StudioCutClipV2, asset: StudioAssetV2): StudioCutClipV2 => {
  const next = { ...copyCutClip(cutClip), assetId: asset.id };
  if (asset.durationSeconds === undefined) return next;
  if (next.sourceInSeconds !== null && next.sourceInSeconds >= asset.durationSeconds) {
    return { ...next, sourceInSeconds: null, sourceOutSeconds: null };
  }
  return {
    ...next,
    sourceOutSeconds: next.sourceOutSeconds === null ? null : Math.min(next.sourceOutSeconds, asset.durationSeconds),
  };
};

const pristineCutClip = (clip: StudioClip, asset: StudioAssetV2, id: string): StudioCutClipV2 => ({
  id,
  clipId: clip.id,
  assetId: asset.id,
  sourceInSeconds: null,
  sourceOutSeconds: null,
  crop: null,
  filters: [],
});

const appendSectionClipOrder = (project: StudioProjectV2, sectionId: string, result: string[]): void => {
  const clipOrder = ownValue(project.sections, sectionId)?.clipOrder;
  if (clipOrder === undefined) return;
  for (let clipIndex = 0; clipIndex < clipOrder.length; clipIndex += 1) result.push(clipOrder[clipIndex]!);
};

const activeClipOrder = (project: StudioProjectV2): string[] => {
  const result: string[] = [];
  for (let sectionIndex = 0; sectionIndex < project.sectionOrder.length; sectionIndex += 1) {
    appendSectionClipOrder(project, project.sectionOrder[sectionIndex]!, result);
  }
  return result;
};

const parkedClipOrder = (project: StudioProjectV2): string[] => {
  const result: string[] = [];
  for (let shelfIndex = 0; shelfIndex < project.shelf.length; shelfIndex += 1) {
    const item = project.shelf[shelfIndex]!;
    if (item.kind === 'section') appendSectionClipOrder(project, item.sectionId, result);
  }
  return result;
};

const scopeOwnsSelection = (scope: StudioCutReconciliationScopeV2, clipId: string): boolean =>
  scope.kind === 'all' || (scope.kind === 'selection' && scope.clipId === clipId);

const scopeOwnsMissingStoryboardEntry = (scope: StudioCutReconciliationScopeV2, clipId: string): boolean =>
  scope.kind === 'all' || scope.kind === 'structure' || (scope.kind === 'selection' && scope.clipId === clipId);

const reconcileCut = (
  project: StudioProjectV2,
  cut: StudioCutV2,
  scope: StudioCutReconciliationScopeV2,
  clipAssetIdsByClipId: ReadonlyMap<string, ReadonlySet<string>>
): StudioCutV2 => {
  const completePriorOrder: string[] = [];
  const orderedCutClipIds = new Set<string>();
  for (let index = 0; index < cut.clipOrder.length; index += 1) {
    const cutClipId = cut.clipOrder[index]!;
    completePriorOrder.push(cutClipId);
    orderedCutClipIds.add(cutClipId);
  }
  for (const cutClipId of Object.keys(cut.clips)) {
    if (!orderedCutClipIds.has(cutClipId)) completePriorOrder.push(cutClipId);
  }
  const retainedEntries: Array<[string, StudioCutClipV2]> = [];
  const cutClipIdByClipId = new Map<string, string>();

  for (const cutClipId of completePriorOrder) {
    const cutClip = ownValue(cut.clips, cutClipId);
    const clip = cutClip === undefined ? undefined : ownValue(project.clips, cutClip.clipId);
    const persistedAsset = cutClip === undefined ? undefined : ownValue(project.assets, cutClip.assetId);
    const asset =
      clip === undefined
        ? null
        : scopeOwnsSelection(scope, clip.id)
          ? selectedTake(project, clip, clipAssetIdsByClipId)
          : persistedAsset !== undefined &&
              isCanonicalGeneratedTake(project, clip, persistedAsset, clipAssetIdsByClipId)
            ? persistedAsset
            : null;
    if (cutClip === undefined || clip === undefined || asset === null) continue;
    retainedEntries.push([
      cutClipId,
      scopeOwnsSelection(scope, clip.id) ? clampCutClipToAsset(cutClip, asset) : copyCutClip(cutClip),
    ]);
    cutClipIdByClipId.set(clip.id, cutClipId);
  }

  const occupied = new Set(Object.keys(cut.clips));
  const storyboardClipOrder = activeClipOrder(project);
  const missingCandidateClipOrder =
    scope.kind === 'selection'
      ? [scope.clipId]
      : scope.kind === 'all'
        ? [...storyboardClipOrder, ...parkedClipOrder(project)]
        : storyboardClipOrder;
  if (cut.orderMode === 'storyboard') {
    for (const clipId of missingCandidateClipOrder) {
      if (cutClipIdByClipId.has(clipId) || !scopeOwnsMissingStoryboardEntry(scope, clipId)) continue;
      const clip = ownValue(project.clips, clipId);
      const asset = clip === undefined ? null : selectedTake(project, clip, clipAssetIdsByClipId);
      if (clip === undefined || asset === null) continue;
      const cutClipId = allocateCutClipId(clip.id, occupied);
      occupied.add(cutClipId);
      retainedEntries.push([cutClipId, pristineCutClip(clip, asset, cutClipId)]);
      cutClipIdByClipId.set(clip.id, cutClipId);
    }
  }

  const clips = Object.fromEntries(retainedEntries) as Record<string, StudioCutClipV2>;
  const retainedOrder: string[] = [];
  for (const cutClipId of completePriorOrder) {
    if (Object.hasOwn(clips, cutClipId)) retainedOrder.push(cutClipId);
  }
  if (cut.orderMode === 'manual') return { ...cut, clipOrder: retainedOrder, clips };

  const activeCutClipOrder = storyboardClipOrder.flatMap((clipId) => {
    const cutClipId = cutClipIdByClipId.get(clipId);
    return cutClipId === undefined ? [] : [cutClipId];
  });
  const activeCutClipIds = new Set(activeCutClipOrder);
  const dormantCutClipOrder: string[] = [];
  for (const [cutClipId] of retainedEntries) {
    if (!activeCutClipIds.has(cutClipId)) dormantCutClipOrder.push(cutClipId);
  }
  return { ...cut, clipOrder: [...activeCutClipOrder, ...dormantCutClipOrder], clips };
};

/** Returns whether any persisted cut prevents deletion of the named clip. */
export const studioClipHasCutDependencyV2 = (project: StudioProjectV2, clipId: string): boolean =>
  Object.values(project.cuts).some((cut) => Object.values(cut.clips).some((cutClip) => cutClip.clipId === clipId));

/** Reconciles every persisted cut with canonical selected takes without mutating the source project. */
export const reconcileStudioCutsV2 = (
  project: StudioProjectV2,
  scope: StudioCutReconciliationScopeV2 = { kind: 'all' }
): StudioProjectV2 => {
  const clipAssetIdsByClipId = new Map<string, ReadonlySet<string>>();
  for (const clip of Object.values(project.clips)) {
    const assetIds = new Set<string>();
    for (let assetIndex = 0; assetIndex < clip.assetIds.length; assetIndex += 1) {
      assetIds.add(clip.assetIds[assetIndex]!);
    }
    clipAssetIdsByClipId.set(clip.id, assetIds);
  }
  return {
    ...project,
    cuts: Object.fromEntries(
      Object.entries(project.cuts).map(([cutId, cut]) => [
        cutId,
        reconcileCut(project, cut, scope, clipAssetIdsByClipId),
      ])
    ) as Record<string, StudioCutV2>,
  };
};
