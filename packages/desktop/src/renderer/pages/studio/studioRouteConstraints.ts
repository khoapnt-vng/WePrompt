/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  StudioMediaChoiceRef,
  StudioMediaKind,
  StudioRendererProject,
  StudioRouteCatalog,
  StudioScene,
} from '@/common/types/project/creativeStudioTypes';

const STORAGE_BOUNDS = { minDurationSeconds: 1, maxDurationSeconds: 60 } as const;

export type StudioSceneDurationBounds = {
  minDurationSeconds: number;
  maxDurationSeconds: number;
  source: 'selected_route' | 'fallback';
};

export const resolveShotEngine = (
  project: Pick<StudioRendererProject, 'routing'>,
  shot: Pick<StudioScene, 'mediaKind'>
): StudioMediaChoiceRef | null => project.routing[shot.mediaKind];

/** Resolves the editable duration range for the selected route and media kind. */
export const resolveSceneDurationBounds = (
  project: StudioRendererProject,
  catalog: StudioRouteCatalog | null,
  mediaKind: StudioMediaKind
): StudioSceneDurationBounds => {
  const selected = resolveShotEngine(project, { mediaKind });
  const route = catalog?.[mediaKind].selectedRoute ?? null;
  const matches =
    selected !== null &&
    route !== null &&
    route.kind === mediaKind &&
    route.choiceId === selected.choiceId &&
    route.providerId === selected.providerId &&
    route.model === selected.model;
  if (!matches) return { ...STORAGE_BOUNDS, source: 'fallback' };
  return {
    minDurationSeconds: Math.max(STORAGE_BOUNDS.minDurationSeconds, route.constraints.minDurationSeconds),
    maxDurationSeconds: Math.min(STORAGE_BOUNDS.maxDurationSeconds, route.constraints.maxDurationSeconds),
    source: 'selected_route',
  };
};
