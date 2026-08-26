/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ReferenceWorkspaceItem } from './index';

export type ReferenceWorkspaceStatus = 'noPhoto' | 'current' | 'generating';

/** Keeps the three ruled reference states in one identity-row location. */
export const referenceWorkspaceStatus = (item: ReferenceWorkspaceItem): ReferenceWorkspaceStatus => {
  if (item.generationStatus === 'queued' || item.generationStatus === 'running') return 'generating';
  return item.approvedAssetId === null ? 'noPhoto' : 'current';
};
