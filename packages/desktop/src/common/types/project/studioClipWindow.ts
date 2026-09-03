/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { StudioRouteCatalogV2 } from '@/common/types/project/creativeStudioTypes';

/**
 * The clip lengths every connected video engine can render.
 *
 * Lives in `common/` rather than with the entry screen because both processes have to answer the
 * same question: the renderer to decide what to *offer*, the main process to decide what to accept.
 * Two implementations of "what will the engine render" is two chances to offer a length that is
 * then refused after the person has been charged for the attempt.
 */
export type StudioClipWindow = {
  minDurationSeconds: number;
  maxDurationSeconds: number;
  /** Exact admissible lengths when every eligible route declares them; absent for continuous engines. */
  supportedDurationSeconds?: number[];
};

/**
 * The window a clip must fit, read from what is actually connected.
 *
 * A selected route answers for itself. With nothing selected the answer is the *intersection* across
 * the options — the widest min and the narrowest max — because the project may end up on any of
 * them, and a window wider than the engine that wins is a promise the engine will refuse.
 *
 * A range is not the whole answer. Some engines render only an enumerated set of lengths and refuse
 * everything between the rungs (`invalid_duration` from `openRouterVideoAdapter`), so a window that
 * reported only its endpoints would read as continuous and the offer built from it would include
 * lengths the engine rejects. The set is therefore intersected too, and by the same rule: a length
 * only one candidate engine admits is not safe while the project may still bind to another.
 *
 * One continuous route makes the whole window continuous — it renders everything in its range, so
 * narrowing the answer to some other engine's ladder would refuse work this one would honour.
 *
 * Null rather than a guess when nothing is connected: a guessed window is indistinguishable to the
 * reader from a real one. Null too when the declared sets share no member, because overlapping
 * *ranges* do not imply a single length both engines would render.
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

  const declaredSets: number[][] = [];
  for (const route of routes) {
    const declared = route.constraints.supportedDurationSeconds;
    if (!Array.isArray(declared)) return { minDurationSeconds, maxDurationSeconds };
    declaredSets.push(declared);
  }

  const supportedDurationSeconds = [...new Set(declaredSets[0])]
    .filter((seconds) => declaredSets.every((set) => set.includes(seconds)))
    .toSorted((left, right) => left - right);
  if (supportedDurationSeconds.length === 0) return null;

  return { minDurationSeconds, maxDurationSeconds, supportedDurationSeconds };
};
