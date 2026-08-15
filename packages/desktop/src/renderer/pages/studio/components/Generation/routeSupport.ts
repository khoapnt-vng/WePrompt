/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  StudioAspectRatio,
  StudioMediaKind,
  StudioResolution,
  StudioRouteCatalogEntry,
} from '@/common/types/project/creativeStudioTypes';

export type StudioRouteSupportContext = {
  kind?: StudioMediaKind;
  sceneId?: string;
  routeSceneId?: string;
  aspectRatio?: StudioAspectRatio;
  resolution?: StudioResolution;
  durationSeconds?: number;
  hasReference?: boolean;
  /** Active Brief inputs for an image reference plate. Undefined for ordinary takes and batches. */
  conditioningReferenceCount?: number;
};

export type StudioRouteSupportReason = 'health' | 'frame' | 'resolution' | 'duration' | 'first_frame' | 'conditioning';

export const explainRouteSupport = (
  route: StudioRouteCatalogEntry,
  context: Omit<StudioRouteSupportContext, 'kind' | 'sceneId' | 'routeSceneId'>
): StudioRouteSupportReason | null => {
  if (route.health === 'unavailable') return 'health';
  if (context.aspectRatio !== undefined && !route.constraints.aspectRatios.includes(context.aspectRatio)) {
    return 'frame';
  }
  if (context.resolution !== undefined && !route.constraints.resolutions.includes(context.resolution)) {
    return 'resolution';
  }
  if (
    context.durationSeconds !== undefined &&
    (context.durationSeconds < route.constraints.minDurationSeconds ||
      context.durationSeconds > route.constraints.maxDurationSeconds)
  ) {
    return 'duration';
  }
  if (context.hasReference === true && !route.constraints.supportsFirstFrame) return 'first_frame';
  if (
    context.conditioningReferenceCount !== undefined &&
    context.conditioningReferenceCount > route.constraints.maxConditioningImages
  ) {
    return 'conditioning';
  }
  return null;
};

/**
 * Checks renderer-visible compatibility for a scene and catalog route.
 *
 * `silentOutput` is intentionally not checked here. The main-process Creative
 * Studio service is the security boundary that rejects non-silent routes for
 * untrusted adapters; duplicating that gate in the renderer would incorrectly
 * hide legitimate audio-capable routes.
 */
export const routeSupportsScene = (
  route: StudioRouteCatalogEntry,
  {
    kind,
    sceneId,
    routeSceneId,
    aspectRatio,
    resolution,
    durationSeconds,
    hasReference,
    conditioningReferenceCount,
  }: StudioRouteSupportContext
): boolean =>
  (kind === undefined || route.kind === kind) &&
  (sceneId === undefined || routeSceneId === sceneId) &&
  explainRouteSupport(route, {
    aspectRatio,
    resolution,
    durationSeconds,
    hasReference,
    conditioningReferenceCount,
  }) === null;
