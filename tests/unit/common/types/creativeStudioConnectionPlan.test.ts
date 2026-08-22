/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import { planStudioConnections } from '@/common/types/project/creativeStudioConnectionPlan';

const integrations = [
  { integrationId: 'int_img', kind: 'image' as const, labelKey: 'openRouterImage' },
  { integrationId: 'int_vid', kind: 'video' as const, labelKey: 'openRouterVideo' },
];

const candidate = (
  providerId: string,
  groups: {
    integrationLabelKey: string;
    models: { model: string; health: 'available' | 'unknown' | 'unavailable' }[];
  }[]
) => ({ providerId, providerName: providerId, models: [], integrationModels: groups });

describe('planning which Studio connections to try', () => {
  it('offers one attempt per kind when a provider has a model for each', () => {
    const plan = planStudioConnections({
      candidates: [
        candidate('p1', [
          { integrationLabelKey: 'openRouterImage', models: [{ model: 'img-a', health: 'available' }] },
          { integrationLabelKey: 'openRouterVideo', models: [{ model: 'vid-a', health: 'available' }] },
        ]),
      ],
      integrations,
      existing: [],
    });
    expect(plan).toEqual([
      { providerId: 'p1', integrationId: 'int_img', model: 'img-a', kind: 'image' },
      { providerId: 'p1', integrationId: 'int_vid', model: 'vid-a', kind: 'video' },
    ]);
  });

  it('skips a kind that is already connected, so nothing a person chose is touched', () => {
    const plan = planStudioConnections({
      candidates: [
        candidate('p1', [
          { integrationLabelKey: 'openRouterImage', models: [{ model: 'img-a', health: 'available' }] },
          { integrationLabelKey: 'openRouterVideo', models: [{ model: 'vid-a', health: 'available' }] },
        ]),
      ],
      integrations,
      existing: [{ integrationId: 'int_img' }],
    });
    expect(plan.map((attempt) => attempt.kind)).toEqual(['video']);
  });

  it('never attempts a model already known to be unavailable', () => {
    const plan = planStudioConnections({
      candidates: [
        candidate('p1', [
          { integrationLabelKey: 'openRouterImage', models: [{ model: 'img-dead', health: 'unavailable' }] },
        ]),
      ],
      integrations,
      existing: [],
    });
    expect(plan).toEqual([]);
  });

  it('tries an available model before an unprobed one', () => {
    const plan = planStudioConnections({
      candidates: [
        candidate('p1', [
          {
            integrationLabelKey: 'openRouterImage',
            models: [
              { model: 'img-maybe', health: 'unknown' },
              { model: 'img-live', health: 'available' },
            ],
          },
        ]),
      ],
      integrations,
      existing: [],
    });
    expect(plan.map((attempt) => attempt.model)).toEqual(['img-live', 'img-maybe']);
  });

  it('bounds the attempts per kind, because each one is a live network probe', () => {
    // Unbounded, a provider with forty models would probe forty times before a person sees anything.
    const plan = planStudioConnections({
      candidates: [
        candidate('p1', [
          {
            integrationLabelKey: 'openRouterVideo',
            models: Array.from({ length: 12 }, (_, index) => ({
              model: `vid-${index}`,
              health: 'available' as const,
            })),
          },
        ]),
      ],
      integrations,
      existing: [],
      maxAttemptsPerKind: 3,
    });
    expect(plan).toHaveLength(3);
  });

  it('ignores a group whose integration this build does not know', () => {
    // The label key is the only join between a candidate and an integration id. An unknown one has
    // no id to send, so it cannot become an attempt.
    const plan = planStudioConnections({
      candidates: [
        candidate('p1', [{ integrationLabelKey: 'somethingElse', models: [{ model: 'x', health: 'available' }] }]),
      ],
      integrations,
      existing: [],
    });
    expect(plan).toEqual([]);
  });

  it('plans nothing when there are no candidates, rather than throwing', () => {
    expect(planStudioConnections({ candidates: [], integrations, existing: [] })).toEqual([]);
  });
});
