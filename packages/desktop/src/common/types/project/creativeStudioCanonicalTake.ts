/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { StudioAssetV2, StudioShot } from './creativeStudioTypes';

/** Returns whether an asset is the generated take owned and indexed by a schema-2 shot. */
export const isCanonicalStudioGeneratedTakeV2 = (asset: StudioAssetV2, projectId: string, shot: StudioShot): boolean =>
  asset.projectId === projectId &&
  asset.shotId === shot.id &&
  (asset.mediaKind === 'image' || asset.mediaKind === 'video') &&
  asset.managedAsset.collection === 'assets' &&
  shot.assetIds.includes(asset.id);
