/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import { planStudioConnections } from '@/common/types/project/creativeStudioConnectionPlan';

const integrations = [
  { integrationId: 'int_img', kind: 'image' as const, labelKey: 'imageApi' },
  { integrationId: 'int_vid', kind: 'video' as const, labelKey: 'openRouterVideo' },
];

type Model = { model: string; health: 'available' | 'unknown' | 'unavailable' };

const candidate = (
  providerId: string,
  groups: { integrationLabelKey: string; models: Model[] }[],
  models: Model[] = []
) => ({ providerId, providerName: providerId, models, integrationModels: groups });

describe('planning which Studio connections to try', () => {
  it('offers one attempt per kind when a provider has a model for each', () => {
    const plan = planStudioConnections({
      candidates: [
        candidate('p1', [
          { integrationLabelKey: 'imageApi', models: [{ model: 'img-a', health: 'available' }] },
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
          { integrationLabelKey: 'imageApi', models: [{ model: 'img-a', health: 'available' }] },
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
        candidate('p1', [{ integrationLabelKey: 'imageApi', models: [{ model: 'img-dead', health: 'unavailable' }] }]),
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
            integrationLabelKey: 'imageApi',
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

describe("where a candidate's models come from", () => {
  it("falls back to the provider's own models for an integration with no group of its own", () => {
    // Only openRouterVideo ever appears in integrationModels. Image models live on candidate.models,
    // so a planner reading only the groups plans nothing at all for image — which is what shipped,
    // and why provisioning silently bound neither kind.
    const plan = planStudioConnections({
      candidates: [candidate('p1', [], [{ model: 'gemini-image', health: 'available' }])],
      integrations,
      existing: [],
    });
    expect(plan).toEqual([{ providerId: 'p1', integrationId: 'int_img', model: 'gemini-image', kind: 'image' }]);
  });

  it('never falls back for a closed integration, whose own model list is authoritative', () => {
    // openRouterVideo publishes its own catalogue. Offering the provider's text models there would
    // plan validation probes that cannot succeed.
    const plan = planStudioConnections({
      candidates: [candidate('p1', [], [{ model: 'some-text-model', health: 'available' }])],
      integrations: [{ integrationId: 'int_vid', kind: 'video', labelKey: 'openRouterVideo' }],
      existing: [],
    });
    expect(plan).toEqual([]);
  });

  it('prefers a group over the fallback when the integration has one', () => {
    const plan = planStudioConnections({
      candidates: [
        candidate(
          'p1',
          [{ integrationLabelKey: 'openRouterVideo', models: [{ model: 'seedance-2.0', health: 'available' }] }],
          [{ model: 'ignored-text-model', health: 'available' }]
        ),
      ],
      integrations: [{ integrationId: 'int_vid', kind: 'video', labelKey: 'openRouterVideo' }],
      existing: [],
    });
    expect(plan.map((attempt) => attempt.model)).toEqual(['seedance-2.0']);
  });

  it('plans both kinds from one provider, which is the whole point', () => {
    const plan = planStudioConnections({
      candidates: [
        candidate(
          'p1',
          [{ integrationLabelKey: 'openRouterVideo', models: [{ model: 'seedance-2.0', health: 'available' }] }],
          [{ model: 'gemini-image', health: 'available' }]
        ),
      ],
      integrations,
      existing: [],
    });
    expect(plan).toEqual([
      { providerId: 'p1', integrationId: 'int_img', model: 'gemini-image', kind: 'image' },
      { providerId: 'p1', integrationId: 'int_vid', model: 'seedance-2.0', kind: 'video' },
    ]);
  });
});
