/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest';
import type { StudioGenerationRouteCatalog } from '@/process/services/creative-studio/providerResolver';
import {
  resolveStudioPieceRouteAndRateV3,
  StudioPieceRouteResolutionErrorV3,
} from '@/process/services/creative-studio/service/pilot/pricing';

const route = (
  choiceId: string,
  overrides: Partial<StudioGenerationRouteCatalog['routes'][number]> = {}
): StudioGenerationRouteCatalog['routes'][number] => ({
  choiceId,
  providerId: `provider_${choiceId}`,
  providerName: choiceId,
  adapterId: 'weprompt-image-v1',
  model: `model_${choiceId}`,
  health: 'available',
  kind: 'image',
  constraints: {
    aspectRatios: ['16:9', '1:1'],
    resolutions: ['720p', '1080p'],
    minDurationSeconds: 1,
    maxDurationSeconds: 60,
    supportsFirstFrame: false,
    maxConditioningImages: 0,
    silentOutput: true,
  },
  cancellationPolicy: 'queued_only',
  ...overrides,
});

const resolver = (routes: StudioGenerationRouteCatalog['routes']) => ({
  listGenerationRoutes: async (): Promise<StudioGenerationRouteCatalog> => ({
    routes,
    diagnostics: [],
    generationCatalogVersion: 'catalog_1',
  }),
});

describe('resolveStudioPieceRouteAndRateV3', () => {
  it('uses the first eligible Main-catalog route and the app-owned fixed image price', async () => {
    const resolved = await resolveStudioPieceRouteAndRateV3(resolver([route('first'), route('second')]), {
      aspectRatio: '16:9',
      resolution: '1080p',
    });

    expect(resolved.routeId).toBe('first');
    expect(resolved.provider.model).toBe('model_first');
    expect(resolved.rateMinorUnits).toBe(3);
  });

  it('skips routes that do not support the invocation settings', async () => {
    const resolved = await resolveStudioPieceRouteAndRateV3(
      resolver([
        route('wrong_ratio', {
          constraints: { ...route('base').constraints, aspectRatios: ['1:1'] },
        }),
        route('eligible'),
      ]),
      { aspectRatio: '16:9', resolution: '720p' }
    );

    expect(resolved.routeId).toBe('eligible');
  });

  it('fails closed when no eligible image route exists', async () => {
    const refusal = resolveStudioPieceRouteAndRateV3(resolver([route('offline', { health: 'unavailable' })]), {
      aspectRatio: '16:9',
      resolution: '720p',
    });
    await expect(refusal).rejects.toBeInstanceOf(StudioPieceRouteResolutionErrorV3);
    await expect(refusal).rejects.toMatchObject({ code: 'route_incompatible' });
  });

  it('distinguishes an unreadable route catalogue from incompatible settings', async () => {
    const refusal = resolveStudioPieceRouteAndRateV3(
      {
        listGenerationRoutes: async () => {
          throw new Error('provider storage unavailable');
        },
      },
      { aspectRatio: '16:9', resolution: '720p' }
    );

    await expect(refusal).rejects.toMatchObject({ code: 'route_catalog_unavailable' });
  });
});
