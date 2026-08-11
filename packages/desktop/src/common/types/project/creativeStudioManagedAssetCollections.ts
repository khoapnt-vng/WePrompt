/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { StudioManagedAssetRef } from './creativeStudioTypes';

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
