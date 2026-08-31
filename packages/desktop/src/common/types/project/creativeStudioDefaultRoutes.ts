/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { StudioMediaKind } from './creativeStudioTypes';

/** The subset of a catalogue route this picker needs. Narrow on purpose, so it is trivially testable. */
type RouteForDefaulting = {
  choiceId: string;
  kind: StudioMediaKind;
  health: 'available' | 'unknown' | 'unavailable';
  constraints: { supportsFirstFrame: boolean };
};

export type DefaultRouteChoice = {
  imageRouteId: string | null;
  videoRouteId: string | null;
  /** False when nothing could chain and a plain video route was bound instead. */
  videoSupportsFirstFrame: boolean;
};

/**
 * The routes a brand-new project should start with.
 *
 * Projects are created with both ids null, which leaves a finished script facing a Render button
 * that does nothing until someone finds the Brief form. Binding at creation removes that cliff.
 *
 * Video is chosen on `supportsFirstFrame` rather than on order or price, because shots condition on
 * the previous shot's last frame: a route without it does not fail, it quietly produces a film with
 * no continuity. When nothing can chain we still bind — a generable project beats a dead one — and
 * report it, so the caller can tell the two apart.
 *
 * `unknown` health means unprobed, not broken, so it is a fallback rather than a disqualification.
 * `unavailable` is never bound.
 */
export const pickDefaultRoutes = (routes: readonly RouteForDefaulting[]): DefaultRouteChoice => {
  const usable = routes.filter((route) => route.health !== 'unavailable');
  const byHealth = (kind: StudioMediaKind, extra: (route: RouteForDefaulting) => boolean) =>
    usable.find((route) => route.kind === kind && route.health === 'available' && extra(route)) ??
    usable.find((route) => route.kind === kind && extra(route)) ??
    null;

  const image = byHealth('image', () => true);
  const chaining = byHealth('video', (route) => route.constraints.supportsFirstFrame);
  const video = chaining ?? byHealth('video', () => true);

  return {
    imageRouteId: image?.choiceId ?? null,
    videoRouteId: video?.choiceId ?? null,
    videoSupportsFirstFrame: chaining !== null,
  };
};
