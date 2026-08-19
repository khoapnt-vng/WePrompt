/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

const SAFE_STUDIO_ID = /^[A-Za-z0-9_-]{1,256}$/;

/** Builds the renderer-safe managed-media URL without carrying scene preview policy. */
export const createManagedStudioAssetUrl = (projectId: string, assetId: string): string | null => {
  if (!SAFE_STUDIO_ID.test(projectId) || !SAFE_STUDIO_ID.test(assetId)) return null;
  return `weprompt-studio://asset/${encodeURIComponent(projectId)}/${encodeURIComponent(assetId)}`;
};
