/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import type {
  StudioMediaRouteCatalog,
  StudioRouteCatalog,
  StudioRouteCatalogEntry,
} from '@/common/types/project/creativeStudioTypes';
import { resolveSoleRouteAdoptions } from '@renderer/pages/studio/studioRouteDefaults';

const route = (kind: 'image' | 'video', overrides: Partial<StudioRouteCatalogEntry> = {}): StudioRouteCatalogEntry => ({
  choiceId: `choice_${kind}`,
  providerId: `provider-${kind}`,
  providerName: `${kind} provider`,
  model: `${kind}-model`,
  integrationLabelKey: kind === 'image' ? 'imageApi' : 'selfHostedVideoGateway',
  health: 'available',
  kind,
  constraints: {
    aspectRatios: ['16:9'],
    resolutions: ['720p'],
    minDurationSeconds: 1,
    maxDurationSeconds: 60,
    supportsFirstFrame: true,
    silentOutput: true,
  },
  ...overrides,
});

const unbound: StudioMediaRouteCatalog = {
  status: 'setup_required',
  selected: null,
  selectedRoute: null,
  selectionIssue: null,
  options: [],
};

const catalog = (overrides: Partial<StudioRouteCatalog> = {}): StudioRouteCatalog => ({
  storyboard: { status: 'setup_required', selected: null, options: [] },
  image: unbound,
  video: unbound,
  catalogVersion: 'catalog-1',
  ...overrides,
});

const unchosen = (entry: StudioRouteCatalogEntry, ...rest: StudioRouteCatalogEntry[]): StudioMediaRouteCatalog => ({
  status: 'selection_required',
  selected: null,
  selectedRoute: null,
  selectionIssue: null,
  options: [entry, ...rest],
});

describe('resolveSoleRouteAdoptions', () => {
  it('adopts the only compatible engine for a role the project never chose', () => {
    expect(resolveSoleRouteAdoptions(catalog({ image: unchosen(route('image')) }))).toEqual([
      { role: 'image', choiceId: 'choice_image' },
    ]);
  });

  it('replaces a selection that can no longer render with the only engine that can', () => {
    const replacement = route('video', { choiceId: 'choice_video_replacement' });

    expect(
      resolveSoleRouteAdoptions(
        catalog({
          video: {
            status: 'unavailable',
            selected: { choiceId: 'choice_video_retired', providerId: 'provider-retired', model: 'retired-model' },
            selectedRoute: null,
            selectionIssue: { code: 'retired' },
            options: [replacement],
          },
        })
      )
    ).toEqual([{ role: 'video', choiceId: 'choice_video_replacement' }]);
  });

  it('leaves a role alone when several engines could serve it', () => {
    const alternate = route('image', { choiceId: 'choice_image_alternate', model: 'alternate-image-model' });

    expect(resolveSoleRouteAdoptions(catalog({ image: unchosen(route('image'), alternate) }))).toEqual([]);
  });

  it('leaves a role alone once it already renders through a selected route', () => {
    const entry = route('image');

    expect(
      resolveSoleRouteAdoptions(
        catalog({
          image: {
            status: 'ready',
            selected: { choiceId: entry.choiceId, providerId: entry.providerId, model: entry.model },
            selectedRoute: entry,
            selectionIssue: null,
            options: [entry],
          },
        })
      )
    ).toEqual([]);
  });

  it('adopts nothing when the workspace has no engine bound for either role', () => {
    expect(resolveSoleRouteAdoptions(catalog())).toEqual([]);
  });

  it('adopts nothing before the catalog has loaded', () => {
    expect(resolveSoleRouteAdoptions(null)).toEqual([]);
  });

  it('reports both roles in a stable order so neither blocks the other', () => {
    expect(
      resolveSoleRouteAdoptions(catalog({ image: unchosen(route('image')), video: unchosen(route('video')) }))
    ).toEqual([
      { role: 'image', choiceId: 'choice_image' },
      { role: 'video', choiceId: 'choice_video' },
    ]);
  });

  it('never adopts an option whose media kind does not match the role', () => {
    expect(resolveSoleRouteAdoptions(catalog({ video: unchosen(route('image')) }))).toEqual([]);
  });

  it('never adopts an option the catalog reports as unavailable', () => {
    expect(resolveSoleRouteAdoptions(catalog({ image: unchosen(route('image', { health: 'unavailable' })) }))).toEqual(
      []
    );
  });
});
