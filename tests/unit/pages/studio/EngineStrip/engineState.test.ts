/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import type {
  StudioMediaRouteCatalog,
  StudioRendererProject,
  StudioRouteCatalog,
  StudioRouteCatalogEntry,
} from '@/common/types/project/creativeStudioTypes';
import {
  getEnginePairVerdictKey,
  getProjectDurationBounds,
  getProjectEngineSlots,
  getReadySelectedRoutes,
} from '@renderer/pages/studio/components/EngineStrip/engineState';

const project = (overrides: Partial<StudioRendererProject> = {}): StudioRendererProject => ({
  schemaVersion: 1,
  revision: 4,
  id: 'project-1',
  name: 'Project',
  brief: 'Brief',
  aspectRatio: '16:9',
  targetDurationSeconds: 30,
  resolution: '1080p',
  sceneOrder: [],
  scenes: {},
  assets: {},
  jobs: {},
  routing: { storyboard: null, image: null, video: null },
  createdAt: '2026-08-14T00:00:00.000Z',
  updatedAt: '2026-08-14T00:00:00.000Z',
  ...overrides,
});

const route = (kind: 'image' | 'video', overrides: Partial<StudioRouteCatalogEntry> = {}): StudioRouteCatalogEntry => ({
  choiceId: `choice_${kind}`,
  providerId: `provider_${kind}`,
  providerName: `${kind} provider`,
  model: `${kind}-model`,
  integrationLabelKey: kind === 'image' ? 'imageApi' : 'selfHostedVideoGateway',
  health: 'available',
  kind,
  constraints: {
    aspectRatios: ['16:9'],
    resolutions: ['1080p'],
    minDurationSeconds: 4,
    maxDurationSeconds: 12,
    supportsFirstFrame: true,
    silentOutput: true,
  },
  ...overrides,
});

const media = (overrides: Partial<StudioMediaRouteCatalog> = {}): StudioMediaRouteCatalog => ({
  status: 'selection_required',
  selected: null,
  selectedRoute: null,
  selectionIssue: null,
  options: [],
  ...overrides,
});

const catalog = (overrides: Partial<StudioRouteCatalog> = {}): StudioRouteCatalog => ({
  storyboard: { status: 'selection_required', selected: null, options: [] },
  image: media(),
  video: media(),
  catalogVersion: 'catalog-1',
  ...overrides,
});

describe('Engine Strip state', () => {
  it('returns both neutral unloaded roles before the catalog resolves', () => {
    const slots = getProjectEngineSlots(null, project());

    expect(slots.map(({ role, state, action }) => ({ role, state, action }))).toEqual([
      { role: 'image', state: 'unloaded', action: 'none' },
      { role: 'video', state: 'unloaded', action: 'none' },
    ]);
    expect(getEnginePairVerdictKey(slots)).toBeNull();
  });

  it('represents an ambiguous unselected role with its exact option count', () => {
    const options = [route('video'), route('video', { choiceId: 'choice_video_2', model: 'video-2' })];
    const [, video] = getProjectEngineSlots(catalog({ video: media({ options }) }), project());

    expect(video).toMatchObject({ state: 'not_set', action: 'menu', availableCount: 2, prearmedRoute: null });
  });

  it('pre-arms a sole option for display without treating it as selected', () => {
    const option = route('image');
    const [image] = getProjectEngineSlots(catalog({ image: media({ options: [option] }) }), project());

    expect(image).toMatchObject({ state: 'not_set', action: 'menu', availableCount: 1, prearmedRoute: option });
    expect(getReadySelectedRoutes(catalog({ image: media({ options: [option] }) }))).toEqual([]);
  });

  it('uses a no-fit state and Settings action when no compatible option exists', () => {
    const [image] = getProjectEngineSlots(catalog(), project());

    expect(image).toMatchObject({ state: 'no_fit', action: 'settings', availableCount: 0 });
  });

  it('returns a ready selection with the actual route constraints', () => {
    const selected = route('video');
    const [, video] = getProjectEngineSlots(
      catalog({
        video: media({
          status: 'ready',
          selected: { choiceId: selected.choiceId, providerId: selected.providerId, model: selected.model },
          selectedRoute: selected,
          options: [selected],
        }),
      }),
      project({ routing: { storyboard: null, image: null, video: selected } })
    );

    expect(video).toMatchObject({ state: 'ready', action: 'menu', selectedRoute: selected });
  });

  it('keeps a retired persisted model name and offers its surviving replacements', () => {
    const replacement = route('video', { choiceId: 'choice_video_2' });
    const persisted = { choiceId: 'dead', providerId: 'provider_dead', model: 'retired-video' };
    const [, video] = getProjectEngineSlots(
      catalog({
        video: media({
          status: 'unavailable',
          selected: persisted,
          selectionIssue: { code: 'retired' },
          options: [replacement],
        }),
      }),
      project({ routing: { storyboard: null, image: null, video: persisted } })
    );

    expect(video).toMatchObject({ state: 'retired', action: 'menu', selectedModel: 'retired-video' });
  });

  it('routes setup issues to Settings using only the sanitized provider name', () => {
    const [, video] = getProjectEngineSlots(
      catalog({
        video: media({
          status: 'setup_required',
          selected: { choiceId: 'dead', providerId: 'secret-provider-id', model: 'video-model' },
          selectionIssue: { code: 'needs_setup', providerName: 'BytePlus' },
        }),
      }),
      project()
    );

    expect(video).toMatchObject({ state: 'needs_setup', action: 'settings', providerName: 'BytePlus' });
    expect(JSON.stringify(video)).not.toContain('secret-provider-id');
  });

  it('offers no misleading action for a health failure', () => {
    const [, video] = getProjectEngineSlots(
      catalog({
        video: media({
          status: 'unavailable',
          selected: { choiceId: 'choice', providerId: 'provider', model: 'quiet-engine' },
          selectionIssue: { code: 'health' },
          options: [route('video')],
        }),
      }),
      project()
    );

    expect(video).toMatchObject({ state: 'health', action: 'none', selectedModel: 'quiet-engine' });
  });

  it('offers replacements when the selected engine no longer supports the project frame', () => {
    const [, video] = getProjectEngineSlots(
      catalog({
        video: media({
          status: 'unavailable',
          selected: { choiceId: 'choice', providerId: 'provider', model: 'frame-engine' },
          selectionIssue: { code: 'frame', aspectRatio: '16:9', resolution: '1080p' },
          options: [route('video')],
        }),
      }),
      project()
    );

    expect(video).toMatchObject({
      state: 'frame',
      action: 'menu',
      selectedModel: 'frame-engine',
      aspectRatio: '16:9',
      resolution: '1080p',
    });
  });

  it('keeps a first-frame-incompatible selected route ready and exposes the negative capability', () => {
    const selected = route('video', {
      constraints: { ...route('video').constraints, supportsFirstFrame: false },
    });
    const [, video] = getProjectEngineSlots(
      catalog({
        video: media({
          status: 'ready',
          selected: { choiceId: selected.choiceId, providerId: selected.providerId, model: selected.model },
          selectedRoute: selected,
          options: [selected],
        }),
      }),
      project()
    );

    expect(video).toMatchObject({ state: 'ready', supportsFirstFrame: false });
  });

  it('intersects fallback video bounds and never substitutes storage bounds when no option exists', () => {
    const options = [
      route('video', {
        choiceId: 'video-a',
        constraints: { ...route('video').constraints, minDurationSeconds: 4, maxDurationSeconds: 15 },
      }),
      route('video', {
        choiceId: 'video-b',
        constraints: { ...route('video').constraints, minDurationSeconds: 6, maxDurationSeconds: 12 },
      }),
    ];

    expect(getProjectDurationBounds(catalog({ video: media({ options }) }), project())).toEqual({
      min: 6,
      max: 12,
      source: 'options',
    });
    expect(getProjectDurationBounds(catalog(), project())).toEqual({ source: 'unbounded' });
  });

  it('treats a disjoint option intersection as unbounded rather than inventing a range', () => {
    const options = [
      route('video', {
        choiceId: 'video-a',
        constraints: { ...route('video').constraints, minDurationSeconds: 4, maxDurationSeconds: 5 },
      }),
      route('video', {
        choiceId: 'video-b',
        constraints: { ...route('video').constraints, minDurationSeconds: 8, maxDurationSeconds: 12 },
      }),
    ];

    expect(getProjectDurationBounds(catalog({ video: media({ options }) }), project())).toEqual({
      source: 'unbounded',
    });
  });
});
