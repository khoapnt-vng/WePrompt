/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  StudioMediaKind,
  StudioRendererProject,
  StudioRouteCatalog,
  StudioRouteCatalogEntry,
} from '@/common/types/project/creativeStudioTypes';

import { resolveSceneDurationBounds } from '../../studioRouteConstraints';

export type EngineRole = Extract<StudioMediaKind, 'image' | 'video'>;
export type EngineSlotAction = 'menu' | 'settings' | 'none';
export type EngineSlotState =
  | 'unloaded'
  | 'not_set'
  | 'no_fit'
  | 'ready'
  | 'retired'
  | 'needs_setup'
  | 'health'
  | 'frame';

type EngineSlotBase = {
  role: EngineRole;
  state: EngineSlotState;
  action: EngineSlotAction;
  options: StudioRouteCatalogEntry[];
  availableCount: number;
  selectedModel: string | null;
  selectedRoute: StudioRouteCatalogEntry | null;
  prearmedRoute: StudioRouteCatalogEntry | null;
  supportsFirstFrame: boolean | null;
  providerName: string | null;
  aspectRatio: StudioRendererProject['aspectRatio'] | null;
  resolution: StudioRendererProject['resolution'] | null;
};

export type EngineSlotView = EngineSlotBase &
  (
    | { state: 'unloaded'; action: 'none' }
    | { state: 'not_set'; action: 'menu' }
    | { state: 'no_fit'; action: 'settings' }
    | { state: 'ready'; action: 'menu'; selectedRoute: StudioRouteCatalogEntry; supportsFirstFrame: boolean }
    | { state: 'retired'; action: 'menu'; selectedModel: string }
    | { state: 'needs_setup'; action: 'settings'; selectedModel: string; providerName: string }
    | { state: 'health'; action: 'none'; selectedModel: string }
    | {
        state: 'frame';
        action: 'menu';
        selectedModel: string;
        aspectRatio: StudioRendererProject['aspectRatio'];
        resolution: StudioRendererProject['resolution'];
      }
  );

export type ProjectEngineDurationBounds =
  | { source: 'engine'; min: number; max: number; model: string }
  | { source: 'options'; min: number; max: number }
  | { source: 'unbounded' };

export type ReadyStudioRoute = {
  kind: EngineRole;
  route: StudioRouteCatalogEntry;
};

const baseSlot = (role: EngineRole, options: StudioRouteCatalogEntry[]): EngineSlotBase => ({
  role,
  state: 'unloaded',
  action: 'none',
  options,
  availableCount: options.length,
  selectedModel: null,
  selectedRoute: null,
  prearmedRoute: null,
  supportsFirstFrame: null,
  providerName: null,
  aspectRatio: null,
  resolution: null,
});

const deriveSlot = (
  role: EngineRole,
  catalog: StudioRouteCatalog | null,
  project: StudioRendererProject
): EngineSlotView => {
  if (catalog === null) return { ...baseSlot(role, []), state: 'unloaded', action: 'none' };

  const media = catalog[role];
  const options = media.options.filter((option) => option.kind === role);
  const base = baseSlot(role, options);
  const persisted = media.selected ?? project.routing[role];

  if (media.status === 'ready' && media.selectedRoute?.kind === role) {
    return {
      ...base,
      state: 'ready',
      action: 'menu',
      selectedModel: media.selectedRoute.model,
      selectedRoute: media.selectedRoute,
      supportsFirstFrame: media.selectedRoute.constraints.supportsFirstFrame,
    };
  }

  if (persisted !== null && media.selectionIssue !== null) {
    switch (media.selectionIssue.code) {
      case 'retired':
        return { ...base, state: 'retired', action: 'menu', selectedModel: persisted.model };
      case 'needs_setup':
        return {
          ...base,
          state: 'needs_setup',
          action: 'settings',
          selectedModel: persisted.model,
          providerName: media.selectionIssue.providerName,
        };
      case 'health':
        return { ...base, state: 'health', action: 'none', selectedModel: persisted.model };
      case 'frame':
        return {
          ...base,
          state: 'frame',
          action: 'menu',
          selectedModel: persisted.model,
          aspectRatio: media.selectionIssue.aspectRatio,
          resolution: media.selectionIssue.resolution,
        };
    }
  }

  if (options.length === 0) return { ...base, state: 'no_fit', action: 'settings' };
  return {
    ...base,
    state: 'not_set',
    action: 'menu',
    prearmedRoute: options.length === 1 ? options[0] : null,
  };
};

/** Returns image and video unconditionally; an absent role is a visible state, never a filtered result. */
export const getProjectEngineSlots = (
  catalog: StudioRouteCatalog | null,
  project: StudioRendererProject
): [EngineSlotView, EngineSlotView] => [deriveSlot('image', catalog, project), deriveSlot('video', catalog, project)];

/** Compatibility helper for the frame's existing availability predicate. */
export const getReadySelectedRoutes = (catalog: StudioRouteCatalog | null): ReadyStudioRoute[] =>
  (['video', 'image'] as const).flatMap((kind) => {
    const media = catalog?.[kind];
    const selectedRoute = media?.selectedRoute;
    return media?.status === 'ready' && selectedRoute?.kind === kind ? [{ kind, route: selectedRoute }] : [];
  });

/** Compact authoring bound: selected video engine first, otherwise the common range of its options. */
export const getProjectDurationBounds = (
  catalog: StudioRouteCatalog | null,
  project: StudioRendererProject
): ProjectEngineDurationBounds => {
  const selected = resolveSceneDurationBounds(project, catalog, 'video');
  if (selected.source === 'selected_route') {
    return {
      source: 'engine',
      min: selected.minDurationSeconds,
      max: selected.maxDurationSeconds,
      model: catalog?.video.selectedRoute?.model ?? '',
    };
  }

  const options = catalog?.video.options.filter((option) => option.kind === 'video') ?? [];
  if (options.length === 0) return { source: 'unbounded' };
  const min = Math.max(...options.map((option) => option.constraints.minDurationSeconds));
  const max = Math.min(...options.map((option) => option.constraints.maxDurationSeconds));
  return min <= max ? { min, max, source: 'options' } : { source: 'unbounded' };
};

export const getEnginePairVerdictKey = (
  slots: readonly EngineSlotView[]
):
  | 'conversation.creativeStudio.models.engine.pairNeedImage'
  | 'conversation.creativeStudio.models.engine.pairNeedVideo'
  | 'conversation.creativeStudio.models.engine.pairNeither'
  | null => {
  if (slots.every((slot) => slot.state === 'unloaded')) return null;
  const imageReady = slots.find((slot) => slot.role === 'image')?.state === 'ready';
  const videoReady = slots.find((slot) => slot.role === 'video')?.state === 'ready';
  if (imageReady && videoReady) return null;
  if (!imageReady && !videoReady) return 'conversation.creativeStudio.models.engine.pairNeither';
  return imageReady
    ? 'conversation.creativeStudio.models.engine.pairNeedVideo'
    : 'conversation.creativeStudio.models.engine.pairNeedImage';
};

export const integrationTranslationKey = (
  route: StudioRouteCatalogEntry
): `settings.mediaModels.integration.${StudioRouteCatalogEntry['integrationLabelKey']}` =>
  `settings.mediaModels.integration.${route.integrationLabelKey}`;
