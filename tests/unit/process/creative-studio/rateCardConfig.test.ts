/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment node
 */

import type { StudioProviderAdapterId } from '@/common/types/project/creativeStudioTypes';
import {
  createStudioMediaChoiceId,
  type StudioGenerationRoute,
} from '@process/services/creative-studio/providerResolver';
import { createConfiguredStudioRateCardV2 } from '@process/services/creative-studio/rateCardConfig';
import { describe, expect, it } from 'vitest';

const route = (
  adapterId: StudioProviderAdapterId,
  kind: StudioGenerationRoute['kind'],
  model: string
): StudioGenerationRoute => ({
  choiceId: createStudioMediaChoiceId({
    providerId: 'weprompt_studio_e2e',
    adapterId,
    model,
    kind,
  }),
  providerId: 'weprompt_studio_e2e',
  providerName: 'WePrompt Studio E2E',
  adapterId,
  model,
  health: 'available',
  kind,
  cancellationPolicy: 'queued_only',
  constraints: {
    aspectRatios: ['16:9'],
    resolutions: ['1080p'],
    minDurationSeconds: 1,
    maxDurationSeconds: 60,
    supportsFirstFrame: true,
    maxConditioningImages: kind === 'image' ? 6 : 0,
    silentOutput: true,
  },
});

describe('Creative Studio config rate card', () => {
  it('prices every production adapter and the E2E fake route identities from fixed main config', () => {
    const routes = [
      route('weprompt-media-gateway-v1', 'video', 'dreamina-seedance-2-0-260128'),
      route('weprompt-image-v1', 'image', 'weprompt-e2e-image'),
      route('openrouter-video-v1', 'video', 'openrouter-video'),
      route('byteplus-seedance-v1', 'video', 'dreamina-seedance-2-0-260128'),
    ];
    const card = createConfiguredStudioRateCardV2({ routes });

    expect(card.entries).toEqual(
      routes
        .map((candidate) =>
          candidate.kind === 'image'
            ? {
                routeId: candidate.choiceId,
                kind: 'image' as const,
                currency: 'USD',
                rateUnit: 'generation' as const,
                rateMinorUnits: 3,
              }
            : {
                routeId: candidate.choiceId,
                kind: 'video' as const,
                currency: 'USD',
                rateUnit: 'second' as const,
                rateMinorUnits: 5,
              }
        )
        .toSorted((left, right) => left.routeId.localeCompare(right.routeId))
    );
    expect(card.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(createConfiguredStudioRateCardV2({ routes: routes.toReversed() })).toEqual(card);
  });

  it('rejects an adapter/kind mismatch instead of inventing a route price', () => {
    expect(() =>
      createConfiguredStudioRateCardV2({
        routes: [route('weprompt-image-v1', 'video', 'wrong-kind')],
      })
    ).toThrow(expect.objectContaining({ code: 'route_kind_mismatch' }));
  });
});
