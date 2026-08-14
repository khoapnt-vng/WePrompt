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
import { Alert, Button, Spin } from '@arco-design/web-react';
import { Refresh } from '@icon-park/react';
import React from 'react';
import { useTranslation } from 'react-i18next';

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

export type GenerationControlsProps = {
  project: StudioRendererProject;
  catalog: StudioRouteCatalog | null;
  catalogLoading: boolean;
  catalogErrorMessageKey: string | null;
  onRefreshCatalog: () => void | Promise<void>;
  scene: GenerationControlScene | null;
  aspectRatio?: StudioAspectRatio;
  resolution?: StudioResolution;
  sceneDurationSeconds?: number;
  hasReference?: boolean;
  batchSceneCount: number;
  batchAdvisoryMessageKey?: string | null;
  disabled?: boolean;
  singleDisabled?: boolean;
  showSettingsAction?: boolean;
  onOpenSettings: (path: '/settings/model') => void;
  onOpenSingleReview: (request: GenerationSingleReviewRequest) => void;
  onOpenBatchReview: (request: GenerationBatchReviewRequest) => void;
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
  const selected = project.routing[kind];
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
  const selected = project.routing[scene.mediaKind];
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

/** Builds the project-wide review snapshot with the same persisted-route validation as the legacy controls. */
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

/**
 * Persisted project route reviewer.
 *
 * Every button here opens review or setup; it never submits paid generation directly.
 */
export const GenerationControls: React.FC<GenerationControlsProps> = ({
  project,
  catalog,
  catalogLoading,
  catalogErrorMessageKey,
  onRefreshCatalog,
  scene,
  aspectRatio,
  resolution,
  sceneDurationSeconds,
  hasReference,
  batchSceneCount,
  batchAdvisoryMessageKey = null,
  disabled = false,
  singleDisabled = false,
  showSettingsAction = true,
  onOpenSettings,
  onOpenSingleReview,
  onOpenBatchReview,
}) => {
  const { t } = useTranslation();
  const kind = scene?.mediaKind ?? null;
  const routeContext = {
    ...(aspectRatio === undefined ? {} : { aspectRatio }),
    ...(resolution === undefined ? {} : { resolution }),
    ...(sceneDurationSeconds === undefined ? {} : { durationSeconds: sceneDurationSeconds }),
    ...(hasReference === undefined ? {} : { hasReference }),
  };
  const resolvedRoute = kind === null ? null : resolvePersistedRoute(project, kind, catalog, routeContext);
  const effectiveRoute =
    scene === null || resolvedRoute === null
      ? null
      : {
          sceneId: scene.id,
          ...resolvedRoute.route,
        };
  const effectiveRouteStatus: GenerationSingleReviewRequest['routeStatus'] =
    effectiveRoute === null ? 'missing' : resolvedRoute!.routeStatus;
  const singleReviewRequest =
    scene === null
      ? null
      : buildSingleSceneReviewRequest({
          project,
          catalog,
          scene,
          aspectRatio,
          resolution,
          durationSeconds: sceneDurationSeconds,
          hasReference,
        });

  const openSingleReview = (): void => {
    if (catalogLoading || singleReviewRequest === null) return;
    onOpenSingleReview(singleReviewRequest);
  };

  const openBatchReview = (): void => {
    if (disabled || batchSceneCount < 1 || catalogLoading) return;
    onOpenBatchReview(buildBatchGenerationReviewRequest({ project, catalog }));
  };

  return (
    <section aria-label={t('conversation.creativeStudio.routing.title')} className='flex flex-col gap-14px'>
      <div className='flex flex-wrap items-center justify-between gap-8px'>
        <h2 className='m-0 text-16px font-600 text-t-primary'>{t('conversation.creativeStudio.routing.title')}</h2>
        <div className='flex flex-wrap gap-8px'>
          <Button
            type='text'
            icon={
              <span aria-hidden='true'>
                <Refresh />
              </span>
            }
            loading={catalogLoading}
            disabled={disabled}
            onClick={() => void onRefreshCatalog()}
          >
            {t('conversation.creativeStudio.models.refresh')}
          </Button>
          {showSettingsAction && (
            <Button disabled={disabled} onClick={() => onOpenSettings('/settings/model')}>
              {t('conversation.creativeStudio.models.openSettings')}
            </Button>
          )}
        </div>
      </div>

      {catalogLoading && catalog === null ? (
        <div className='flex min-h-80px items-center justify-center'>
          <Spin />
        </div>
      ) : (
        <>
          {catalogErrorMessageKey && <Alert type='error' content={t(catalogErrorMessageKey)} />}

          {effectiveRoute === null ? (
            <Alert type='warning' content={t('conversation.creativeStudio.routing.missingRoute')} />
          ) : (
            <section className='rounded-8px border border-border-2 bg-fill-1 p-12px'>
              <dl className='m-0 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-10px gap-y-5px'>
                <dt className='text-12px text-t-tertiary'>{t('conversation.creativeStudio.routing.modelLabel')}</dt>
                <dd className='m-0 break-all text-12px text-t-primary'>{effectiveRoute.model}</dd>
              </dl>
              {effectiveRouteStatus === 'invalid' && (
                <Alert
                  className='mt-8px'
                  type='error'
                  content={t('conversation.creativeStudio.routing.invalidRoute')}
                />
              )}
            </section>
          )}
        </>
      )}

      <div className='flex flex-wrap gap-8px'>
        <Button
          type='primary'
          disabled={disabled || singleDisabled || singleReviewRequest === null || catalogLoading}
          onClick={openSingleReview}
        >
          {t(
            scene?.hasSelectedAsset
              ? 'conversation.creativeStudio.review.regenerateScene'
              : 'conversation.creativeStudio.review.generateScene'
          )}
        </Button>
        <Button disabled={disabled || batchSceneCount < 1 || catalogLoading} onClick={openBatchReview}>
          {t('conversation.creativeStudio.review.generateReadyScenes', { count: batchSceneCount })}
        </Button>
      </div>
      {batchAdvisoryMessageKey !== null && (
        <p aria-live='polite' className='m-0 text-12px text-warning'>
          {t(batchAdvisoryMessageKey)}
        </p>
      )}
    </section>
  );
};
