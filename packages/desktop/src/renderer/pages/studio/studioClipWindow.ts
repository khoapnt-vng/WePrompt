/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { StudioRouteCatalogV2 } from '@/common/types/project/creativeStudioTypes';

/** The clip lengths every connected video engine can render. */
export type StudioClipWindow = {
  minDurationSeconds: number;
  maxDurationSeconds: number;
};

/**
 * The window a clip must fit, read from what is actually connected.
 *
 * A selected route answers for itself. With nothing selected the answer is the *intersection* across
 * the options — the widest min and the narrowest max — because the project may end up on any of
 * them, and a window wider than the engine that wins is a promise the engine will refuse.
 *
 * Null rather than a guess when nothing is connected: a guessed window is indistinguishable to the
 * reader from a real one.
 */
export const resolveEngineClipWindow = (catalog: StudioRouteCatalogV2 | null): StudioClipWindow | null => {
  if (catalog === null) return null;
  const selected = catalog.video.selectedRoute;
  const routes = selected !== null ? [selected] : catalog.video.options;
  if (routes.length === 0) return null;

  const minDurationSeconds = Math.max(...routes.map((route) => route.constraints.minDurationSeconds));
  const maxDurationSeconds = Math.min(...routes.map((route) => route.constraints.maxDurationSeconds));
  if (!Number.isFinite(minDurationSeconds) || !Number.isFinite(maxDurationSeconds)) return null;
  if (minDurationSeconds > maxDurationSeconds) return null;

  return { minDurationSeconds, maxDurationSeconds };
};
