/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { StudioProviderAdapterId } from '@/common/types/project/creativeStudioTypes';
import type { StudioGenerationRouteCatalog } from './providerResolver';
import {
  createStudioRateCardV2,
  StudioRateCardErrorV2,
  type StudioRateCardEntryV2,
  type StudioRateCardV2,
} from './service/schema2/pricing';

type StudioConfiguredRouteRateV2 = Omit<StudioRateCardEntryV2, 'routeId'>;

/** Main-owned v1 prices. Providers are never consulted for quote rates. */
const STUDIO_ROUTE_RATE_CONFIG_V2 = {
  'weprompt-image-v1': {
    kind: 'image',
    currency: 'USD',
    rateUnit: 'generation',
    rateMinorUnits: 3,
  },
  'byteplus-seedance-v1': {
    kind: 'video',
    currency: 'USD',
    rateUnit: 'second',
    rateMinorUnits: 5,
  },
  'weprompt-media-gateway-v1': {
    kind: 'video',
    currency: 'USD',
    rateUnit: 'second',
    rateMinorUnits: 5,
  },
  'openrouter-video-v1': {
    kind: 'video',
    currency: 'USD',
    rateUnit: 'second',
    rateMinorUnits: 5,
  },
} as const satisfies Record<StudioProviderAdapterId, StudioConfiguredRouteRateV2>;

/** Materializes one immutable rate entry for every route in the already validated catalog snapshot. */
export const createConfiguredStudioRateCardV2 = (
  generation: Pick<StudioGenerationRouteCatalog, 'routes'>
): StudioRateCardV2 =>
  createStudioRateCardV2(
    generation.routes.map((route): StudioRateCardEntryV2 => {
      const configured = STUDIO_ROUTE_RATE_CONFIG_V2[route.adapterId];
      if (configured.kind !== route.kind) throw new StudioRateCardErrorV2('route_kind_mismatch');
      return { routeId: route.choiceId, ...configured };
    })
  );
