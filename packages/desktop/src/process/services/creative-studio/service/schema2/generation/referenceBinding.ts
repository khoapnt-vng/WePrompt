/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  StudioGenerationReferenceInputSnapshot,
  StudioProjectV2,
  StudioReferenceBindingFailureReasonV2,
} from '@/common/types/project/creativeStudioTypes';

export type StudioReferenceBindingResolutionV2 =
  | { ok: true; referenceInputs: StudioGenerationReferenceInputSnapshot[] }
  | {
      ok: false;
      shotId: string;
      reason: StudioReferenceBindingFailureReasonV2;
    };

const fail = (
  shotId: string,
  reason: Exclude<StudioReferenceBindingResolutionV2, { ok: true }>['reason']
): StudioReferenceBindingResolutionV2 => ({ ok: false, shotId, reason });

/** Resolves a semantic Shot binding to immutable approved asset ids and hashes in canonical order. */
export const resolveStudioReferenceBindingV2 = (input: {
  project: StudioProjectV2;
  shotId: string;
  maxConditioningImages: number;
}): StudioReferenceBindingResolutionV2 => {
  const shot = Object.hasOwn(input.project.shots, input.shotId) ? input.project.shots[input.shotId] : undefined;
  if (shot === undefined) return fail(input.shotId, 'unknown_reference');
  if (shot.referenceBinding.status !== 'ready') return fail(input.shotId, 'unassigned');
  if (!Number.isSafeInteger(input.maxConditioningImages) || input.maxConditioningImages < 0) {
    return fail(input.shotId, 'capacity_exceeded');
  }

  const semanticReferences = [
    ...shot.referenceBinding.characterReferenceIds.map((referenceId) => ({ referenceId, kind: 'character' as const })),
    ...(shot.referenceBinding.backgroundReferenceId === null
      ? []
      : [{ referenceId: shot.referenceBinding.backgroundReferenceId, kind: 'background' as const }]),
  ];
  if (semanticReferences.length > input.maxConditioningImages) return fail(input.shotId, 'capacity_exceeded');

  const assetIds = new Set<string>();
  const referenceInputs: StudioGenerationReferenceInputSnapshot[] = [];
  for (const semantic of semanticReferences) {
    const reference = Object.hasOwn(input.project.references, semantic.referenceId)
      ? input.project.references[semantic.referenceId]
      : undefined;
    if (reference === undefined) return fail(input.shotId, 'unknown_reference');
    if (reference.kind !== semantic.kind) return fail(input.shotId, 'wrong_kind');
    if (reference.approvedAssetId === null) return fail(input.shotId, 'unapproved_reference');
    const asset = Object.hasOwn(input.project.assets, reference.approvedAssetId)
      ? input.project.assets[reference.approvedAssetId]
      : undefined;
    if (
      asset === undefined ||
      asset.projectId !== input.project.id ||
      asset.shotId !== null ||
      asset.projectReferenceId !== reference.id ||
      asset.mediaKind !== 'image' ||
      (asset.managedAsset.collection !== 'assets' &&
        (asset.managedAsset.collection !== 'imports' ||
          asset.producerJobId !== null ||
          asset.compositionDigest !== null ||
          asset.generationReferenceAssetIds.length !== 0)) ||
      assetIds.has(asset.id)
    ) {
      return fail(input.shotId, 'missing_asset');
    }
    assetIds.add(asset.id);
    referenceInputs.push({
      referenceId: reference.id,
      kind: reference.kind,
      assetId: asset.id,
      sha256: asset.sha256,
    });
  }
  return { ok: true, referenceInputs };
};
