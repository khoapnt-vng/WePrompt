/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  StudioAspectRatio,
  StudioMediaChoiceRef,
  StudioMediaKind,
  StudioRendererProject,
  StudioResolution,
  StudioRouteCatalog,
  StudioRouteCatalogEntry,
  StudioSceneGenerationChoice,
  StudioSubmitScenesRequest,
} from '@/common/types/project/creativeStudioTypes';
import { resolveShotEngine } from '../../studioRouteConstraints';
import { routeSupportsScene } from './routeSupport';

export type GenerationControlScene = {
  id: string;
  mediaKind: StudioMediaKind;
  hasSelectedAsset?: boolean;
};

export type GenerationSingleReviewRequest = {
  sceneId: string;
  route: GenerationReviewRouteSnapshot | null;
  routeStatus: 'valid' | 'invalid' | 'missing';
  catalogVersion: string | null;
  availableRoutes: StudioRouteCatalogEntry[];
  outputRole?: StudioSubmitScenesRequest['outputRole'];
  /** The one reviewed scene's reference prompt - a single review is a batch of one. */
  referencePrompt?: string;
};

export type GenerationReviewRouteSnapshot = StudioSceneGenerationChoice &
  Pick<StudioMediaChoiceRef, 'providerId' | 'model'>;

export type GenerationResolvedRoute = {
  route: Omit<GenerationReviewRouteSnapshot, 'sceneId'>;
  routeStatus: 'valid' | 'invalid';
};

export type GenerationBatchReviewRequest = {
  catalogVersion: string | null;
  routes: Record<StudioMediaKind, GenerationResolvedRoute | null>;
  availableRoutes: StudioRouteCatalogEntry[];
};

export type BuildSingleSceneReviewRequestInput = {
  project: StudioRendererProject;
  catalog: StudioRouteCatalog | null;
  scene: GenerationControlScene;
  aspectRatio?: StudioAspectRatio;
  resolution?: StudioResolution;
  durationSeconds?: number;
  hasReference?: boolean;
  outputRole?: StudioSubmitScenesRequest['outputRole'];
  /** The one reviewed scene's reference prompt - a single review is a batch of one. */
  referencePrompt?: string;
};

export type BuildBatchGenerationReviewRequestInput = {
  project: StudioRendererProject;
  catalog: StudioRouteCatalog | null;
};

const copyCatalogEntry = (route: StudioRouteCatalogEntry): StudioRouteCatalogEntry => ({
  choiceId: route.choiceId,
  providerId: route.providerId,
  providerName: route.providerName,
  model: route.model,
  integrationLabelKey: route.integrationLabelKey,
  health: route.health,
  kind: route.kind,
  constraints: {
    aspectRatios: [...route.constraints.aspectRatios],
    resolutions: [...route.constraints.resolutions],
    minDurationSeconds: route.constraints.minDurationSeconds,
    maxDurationSeconds: route.constraints.maxDurationSeconds,
    supportsFirstFrame: route.constraints.supportsFirstFrame,
    silentOutput: route.constraints.silentOutput,
  },
});

const catalogRoutes = (catalog: StudioRouteCatalog | null): StudioRouteCatalogEntry[] =>
  catalog === null ? [] : [...catalog.image.options, ...catalog.video.options].map(copyCatalogEntry);

const resolvePersistedRoute = (
  project: StudioRendererProject,
  kind: StudioMediaKind,
  catalog: StudioRouteCatalog | null,
  routeContext: Parameters<typeof routeSupportsScene>[1]
): GenerationResolvedRoute | null => {
  const selected = resolveShotEngine(project, { mediaKind: kind });
  if (selected === null) return null;
  const catalogRoute = catalog?.[kind].options.find(
    (candidate) => candidate.kind === kind && candidate.choiceId === selected.choiceId
  );
  const route = {
    choiceId: selected.choiceId,
    providerId: selected.providerId,
    model: selected.model,
    kind,
  };
  return {
    route,
    routeStatus:
      catalog !== null &&
      catalog[kind].status === 'ready' &&
      catalogRoute !== undefined &&
      routeSupportsScene(catalogRoute, { ...routeContext, kind })
        ? 'valid'
        : 'invalid',
  };
};

/** Builds a paid single-scene review request only for a canonical, compatible persisted route. */
export const buildSingleSceneReviewRequest = ({
  project,
  catalog,
  scene,
  aspectRatio = project.aspectRatio,
  resolution = project.resolution,
  durationSeconds,
  hasReference,
  outputRole,
  referencePrompt,
}: BuildSingleSceneReviewRequestInput): GenerationSingleReviewRequest | null => {
  if (catalog === null || catalog.catalogVersion.trim().length === 0 || catalog[scene.mediaKind].status !== 'ready') {
    return null;
  }
  const selected = resolveShotEngine(project, scene);
  if (selected === null) return null;
  const route = catalog[scene.mediaKind].options.find(
    (candidate) =>
      candidate.kind === scene.mediaKind &&
      candidate.choiceId === selected.choiceId &&
      candidate.providerId === selected.providerId &&
      candidate.model === selected.model
  );
  if (
    route === undefined ||
    !routeSupportsScene(route, { kind: scene.mediaKind, aspectRatio, resolution, durationSeconds, hasReference })
  ) {
    return null;
  }
  return {
    sceneId: scene.id,
    route: {
      sceneId: scene.id,
      choiceId: route.choiceId,
      providerId: route.providerId,
      model: route.model,
      kind: route.kind,
    },
    routeStatus: 'valid',
    catalogVersion: catalog.catalogVersion,
    availableRoutes: catalogRoutes(catalog),
    ...(outputRole === undefined ? {} : { outputRole }),
    ...(referencePrompt === undefined ? {} : { referencePrompt }),
  };
};

/** Builds the project-wide review snapshot from the persisted image and video selections. */
export const buildBatchGenerationReviewRequest = ({
  project,
  catalog,
}: BuildBatchGenerationReviewRequestInput): GenerationBatchReviewRequest => ({
  catalogVersion: catalog?.catalogVersion ?? null,
  routes: {
    image: resolvePersistedRoute(project, 'image', catalog, {}),
    video: resolvePersistedRoute(project, 'video', catalog, {}),
  },
  availableRoutes: catalogRoutes(catalog),
});
