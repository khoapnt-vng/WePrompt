/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ReferenceWorkspaceItem } from './index';

export type ReferenceWorkspaceStatus = 'idle' | 'queued' | 'running' | 'failed' | 'candidate' | 'approved';

/** Derives one visible status without collapsing a replacement candidate into the current approval. */
export const referenceWorkspaceStatus = (item: ReferenceWorkspaceItem): ReferenceWorkspaceStatus => {
  if (item.generationStatus === 'queued' || item.generationStatus === 'running' || item.generationStatus === 'failed') {
    return item.generationStatus;
  }
  if (item.candidateAssetId !== null && item.candidateAssetId !== item.approvedAssetId) return 'candidate';
  if (item.approvedAssetId !== null) return 'approved';
  if (item.candidateAssetId !== null) return 'candidate';
  return 'idle';
};
