/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ReferenceWorkspaceItem } from './index';

export type ReferenceWorkspaceStatus = 'idle' | 'queued' | 'running' | 'failed' | 'current';

/** Derives the status of the one current image plus any active replacement job. */
export const referenceWorkspaceStatus = (item: ReferenceWorkspaceItem): ReferenceWorkspaceStatus => {
  if (item.generationStatus === 'queued' || item.generationStatus === 'running' || item.generationStatus === 'failed') {
    return item.generationStatus;
  }
  if (item.approvedAssetId !== null) return 'current';
  return 'idle';
};
