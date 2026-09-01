/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { StudioPiecePhotoSettingsV3, StudioProviderRef } from '@/common/types/project/creativeStudioTypes';
import type { StudioGenerationRoute, StudioProviderResolver } from '@process/services/creative-studio/providerResolver';
import { createConfiguredStudioRateCardV2 } from '@process/services/creative-studio/rateCardConfig';

export type StudioPieceRouteAndRateV3 = {
  routeId: string;
  provider: StudioProviderRef;
  cancellationPolicy: StudioGenerationRoute['cancellationPolicy'];
  rateCardDigest: string;
  currency: string;
  rateUnit: 'generation';
  rateMinorUnits: number;
};

export class StudioPieceRouteResolutionErrorV3 extends Error {
  readonly code: 'route_catalog_unavailable' | 'route_incompatible';

  constructor(code: 'route_catalog_unavailable' | 'route_incompatible' = 'route_incompatible') {
    super(code);
    this.name = 'StudioPieceRouteResolutionErrorV3';
    this.code = code;
  }
}

const routeSupportsSettings = (route: StudioGenerationRoute, settings: StudioPiecePhotoSettingsV3): boolean =>
  route.kind === 'image' &&
  route.adapterId === 'weprompt-image-v1' &&
  route.health !== 'unavailable' &&
  route.constraints.aspectRatios.includes(settings.aspectRatio) &&
  route.constraints.resolutions.includes(settings.resolution);

/**
 * Resolves the first eligible route from Main's already deterministic catalog and joins it to the
 * app-owned fixed rate card. Provider responses never supply quote arithmetic.
 */
export const resolveStudioPieceRouteAndRateV3 = async (
  resolver: Pick<StudioProviderResolver, 'listGenerationRoutes'>,
  settings: StudioPiecePhotoSettingsV3
): Promise<StudioPieceRouteAndRateV3> => {
  let catalog: Awaited<ReturnType<StudioProviderResolver['listGenerationRoutes']>>;
  try {
    catalog = await resolver.listGenerationRoutes();
  } catch {
    throw new StudioPieceRouteResolutionErrorV3('route_catalog_unavailable');
  }
  const route = catalog.routes.find((candidate) => routeSupportsSettings(candidate, settings));
  if (route === undefined) throw new StudioPieceRouteResolutionErrorV3('route_incompatible');

  const rateCard = createConfiguredStudioRateCardV2(catalog);
  const rate = rateCard.entries.find((candidate) => candidate.routeId === route.choiceId);
  if (rate === undefined || rate.kind !== 'image' || rate.rateUnit !== 'generation') {
    throw new StudioPieceRouteResolutionErrorV3('route_incompatible');
  }
  return {
    routeId: route.choiceId,
    provider: {
      providerId: route.providerId,
      adapterId: route.adapterId,
      model: route.model,
    },
    cancellationPolicy: route.cancellationPolicy,
    rateCardDigest: rateCard.digest,
    currency: rate.currency,
    rateUnit: rate.rateUnit,
    rateMinorUnits: rate.rateMinorUnits,
  };
};
