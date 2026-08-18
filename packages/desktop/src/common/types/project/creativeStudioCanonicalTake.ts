/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { StudioAsset, StudioAssetV2, StudioShot, StudioScene } from './creativeStudioTypes';

/** Returns whether an asset is the generated take owned and indexed by a scene. */
export const isCanonicalStudioGeneratedTake = (asset: StudioAsset, projectId: string, scene: StudioScene): boolean =>
  asset.projectId === projectId &&
  asset.sceneId === scene.id &&
  asset.mediaKind === scene.mediaKind &&
  asset.managedAsset.collection === 'assets' &&
  scene.assetIds.includes(asset.id);

/** Returns whether an asset is the generated take owned and indexed by a schema-2 shot. */
export const isCanonicalStudioGeneratedTakeV2 = (asset: StudioAssetV2, projectId: string, shot: StudioShot): boolean =>
  asset.projectId === projectId &&
  asset.shotId === shot.id &&
  asset.mediaKind === shot.mediaKind &&
  asset.managedAsset.collection === 'assets' &&
  shot.assetIds.includes(asset.id);
