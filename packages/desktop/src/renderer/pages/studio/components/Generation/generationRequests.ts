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
  StudioScene,
  StudioSceneGenerationChoice,
  StudioSubmitScenesRequest,
} from '@/common/types/project/creativeStudioTypes';
import { resolveShotEngine } from '../../studioRouteConstraints';
import { explainRouteSupport, routeSupportsScene } from './routeSupport';

export type GenerationControlScene = Pick<StudioScene, 'id' | 'mediaKind'> &
  Partial<Pick<StudioScene, 'durationSeconds' | 'referenceAssetId' | 'selectedAssetId'>> & {
    hasSelectedAsset?: boolean;
  };

export type StudioSceneRenderBlock =
  | { code: 'catalog_unloaded'; role: StudioMediaKind }
  | { code: 'no_engine'; role: StudioMediaKind }
  | { code: 'needs_setup'; role: StudioMediaKind }
  | { code: 'health'; role: StudioMediaKind }
  | { code: 'retired'; role: StudioMediaKind }
  | {
      code: 'project_frame';
      role: StudioMediaKind;
      model: string;
      ratio: StudioAspectRatio;
      resolution: StudioResolution;
    }
  | { code: 'frame'; role: StudioMediaKind; ratio: StudioAspectRatio }
  | { code: 'resolution'; role: StudioMediaKind; resolution: StudioResolution }
  | { code: 'duration'; role: StudioMediaKind; seconds: number }
  | { code: 'first_frame'; role: StudioMediaKind };

export type StudioSceneRenderBlockMessageKey =
  | 'conversation.creativeStudio.models.blocked.catalogUnloaded'
  | 'conversation.creativeStudio.models.blocked.noEngine'
  | 'conversation.creativeStudio.models.blocked.needsSetup'
  | 'conversation.creativeStudio.models.blocked.notAnswering'
  | 'conversation.creativeStudio.models.blocked.retired'
  | 'conversation.creativeStudio.models.engine.frameMismatch'
  | 'conversation.creativeStudio.models.blocked.frame'
  | 'conversation.creativeStudio.models.blocked.resolution'
  | 'conversation.creativeStudio.models.blocked.duration'
  | 'conversation.creativeStudio.models.blocked.firstFrame';

export type StudioSceneRenderBlockMessage = {
  key: StudioSceneRenderBlockMessageKey;
  values?: Record<string, string | number>;
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
  sceneIds: string[];
  exclusions: GenerationBatchReviewExclusion[];
  catalogVersion: string | null;
  routes: Record<StudioMediaKind, GenerationResolvedRoute | null>;
  availableRoutes: StudioRouteCatalogEntry[];
};

export type GenerationBatchReviewExclusion = {
  block: StudioSceneRenderBlock;
  sceneIds: string[];
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
  candidateSceneIds: readonly string[];
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
    maxConditioningImages: route.constraints.maxConditioningImages,
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

const canonicalSelectedRoute = (
  catalog: StudioRouteCatalog,
  role: StudioMediaKind,
  selected: StudioMediaChoiceRef
): StudioRouteCatalogEntry | null =>
  catalog[role].options.find(
    (candidate) =>
      candidate.kind === role &&
      candidate.choiceId === selected.choiceId &&
      candidate.providerId === selected.providerId &&
      candidate.model === selected.model
  ) ?? null;

/** Explains why a shot cannot enter paid review without inventing a route mutation. */
export const describeSceneRenderBlock = (
  project: StudioRendererProject,
  catalog: StudioRouteCatalog | null,
  scene: Pick<StudioScene, 'mediaKind'> & Partial<Pick<StudioScene, 'durationSeconds' | 'referenceAssetId'>>
): StudioSceneRenderBlock | null => {
  const role = scene.mediaKind;
  if (catalog === null || catalog.catalogVersion.trim().length === 0) return { code: 'catalog_unloaded', role };

  const selected = resolveShotEngine(project, scene);
  if (selected === null) return { code: 'no_engine', role };

  const media = catalog[role];
  switch (media.selectionIssue?.code) {
    case 'needs_setup':
      return { code: 'needs_setup', role };
    case 'health':
      return { code: 'health', role };
    case 'retired':
      return { code: 'retired', role };
    case 'frame':
      return {
        code: 'project_frame',
        role,
        model: selected.model,
        ratio: media.selectionIssue.aspectRatio,
        resolution: media.selectionIssue.resolution,
      };
  }
  if (media.status === 'setup_required') return { code: 'needs_setup', role };
  if (media.status === 'unavailable') return { code: 'health', role };

  const route = canonicalSelectedRoute(catalog, role, selected);
  if (route === null || media.status !== 'ready') return { code: 'retired', role };
  const reason = explainRouteSupport(route, {
    aspectRatio: project.aspectRatio,
    resolution: project.resolution,
    durationSeconds: scene.durationSeconds,
    hasReference: scene.referenceAssetId !== null && scene.referenceAssetId !== undefined,
  });
  switch (reason) {
    case 'health':
      return { code: 'health', role };
    case 'frame':
      return { code: 'frame', role, ratio: project.aspectRatio };
    case 'resolution':
      return { code: 'resolution', role, resolution: project.resolution };
    case 'duration':
      return { code: 'duration', role, seconds: scene.durationSeconds ?? 0 };
    case 'first_frame':
      return { code: 'first_frame', role };
    case null:
      return null;
  }
};

export const describeSceneRenderBlockMessage = (block: StudioSceneRenderBlock): StudioSceneRenderBlockMessage => {
  switch (block.code) {
    case 'catalog_unloaded':
      return { key: 'conversation.creativeStudio.models.blocked.catalogUnloaded' };
    case 'no_engine':
      return { key: 'conversation.creativeStudio.models.blocked.noEngine' };
    case 'needs_setup':
      return { key: 'conversation.creativeStudio.models.blocked.needsSetup' };
    case 'health':
      return { key: 'conversation.creativeStudio.models.blocked.notAnswering' };
    case 'retired':
      return { key: 'conversation.creativeStudio.models.blocked.retired' };
    case 'project_frame':
      return {
        key: 'conversation.creativeStudio.models.engine.frameMismatch',
        values: { model: block.model, ratio: block.ratio, resolution: block.resolution },
      };
    case 'frame':
      return { key: 'conversation.creativeStudio.models.blocked.frame', values: { ratio: block.ratio } };
    case 'resolution':
      return { key: 'conversation.creativeStudio.models.blocked.resolution', values: { resolution: block.resolution } };
    case 'duration':
      return { key: 'conversation.creativeStudio.models.blocked.duration', values: { seconds: block.seconds } };
    case 'first_frame':
      return { key: 'conversation.creativeStudio.models.blocked.firstFrame' };
  }
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
  const renderTarget = {
    ...scene,
    ...(durationSeconds === undefined ? {} : { durationSeconds }),
    ...(hasReference === undefined
      ? {}
      : { referenceAssetId: hasReference ? (scene.referenceAssetId ?? '__review_reference__') : null }),
  };
  if (describeSceneRenderBlock(project, catalog, renderTarget) !== null || catalog === null) return null;
  const selected = resolveShotEngine(project, scene);
  if (selected === null) return null;
  const route = canonicalSelectedRoute(catalog, scene.mediaKind, selected);
  if (
    route === null ||
    !routeSupportsScene(route, { kind: scene.mediaKind, aspectRatio, resolution, durationSeconds, hasReference })
  )
    return null;
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
  candidateSceneIds,
}: BuildBatchGenerationReviewRequestInput): GenerationBatchReviewRequest => {
  const sceneIds: string[] = [];
  const exclusions: GenerationBatchReviewExclusion[] = [];
  const exclusionByBlock = new Map<string, GenerationBatchReviewExclusion>();
  for (const sceneId of candidateSceneIds) {
    const scene = project.scenes[sceneId];
    if (scene?.id !== sceneId) continue;
    const block = describeSceneRenderBlock(project, catalog, scene);
    if (block === null) {
      sceneIds.push(sceneId);
      continue;
    }
    const key = JSON.stringify(block);
    const existing = exclusionByBlock.get(key);
    if (existing !== undefined) {
      existing.sceneIds.push(sceneId);
      continue;
    }
    const group = { block, sceneIds: [sceneId] };
    exclusions.push(group);
    exclusionByBlock.set(key, group);
  }
  return {
    sceneIds,
    exclusions,
    catalogVersion: catalog?.catalogVersion ?? null,
    routes: {
      image: resolvePersistedRoute(project, 'image', catalog, {}),
      video: resolvePersistedRoute(project, 'video', catalog, {}),
    },
    availableRoutes: catalogRoutes(catalog),
  };
};
