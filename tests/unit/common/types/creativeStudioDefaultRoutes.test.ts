/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import { pickDefaultRoutes } from '@/common/types/project/creativeStudioDefaultRoutes';

const route = (
  choiceId: string,
  kind: 'image' | 'video',
  health: 'available' | 'unknown' | 'unavailable',
  supportsFirstFrame = false
) => ({ choiceId, kind, health, constraints: { supportsFirstFrame } });

describe("picking a new project's routes", () => {
  it('binds one route of each kind so a new project can generate immediately', () => {
    // Every project is created with both ids null, so without this a finished script meets a Render
    // button that does nothing until the user finds the Brief form.
    const picked = pickDefaultRoutes([
      route('img-1', 'image', 'available'),
      route('vid-1', 'video', 'available', true),
    ]);
    expect(picked).toEqual({ imageRouteId: 'img-1', videoRouteId: 'vid-1', videoSupportsFirstFrame: true });
  });

  it('prefers a first-frame-capable video route over one that came earlier', () => {
    // Shots condition on the previous shot's last frame. A route without it does not fail — it
    // quietly produces a film with no continuity, which is the worse failure.
    const picked = pickDefaultRoutes([
      route('vid-plain', 'video', 'available', false),
      route('vid-chain', 'video', 'available', true),
    ]);
    expect(picked.videoRouteId).toBe('vid-chain');
    expect(picked.videoSupportsFirstFrame).toBe(true);
  });

  it('still binds a video route when none can chain, and says so', () => {
    // A generable project beats a dead one, but the caller must be able to tell the difference.
    const picked = pickDefaultRoutes([route('vid-plain', 'video', 'available', false)]);
    expect(picked.videoRouteId).toBe('vid-plain');
    expect(picked.videoSupportsFirstFrame).toBe(false);
  });

  it('never binds a route known to be unavailable', () => {
    const picked = pickDefaultRoutes([
      route('img-dead', 'image', 'unavailable'),
      route('vid-dead', 'video', 'unavailable', true),
    ]);
    expect(picked).toEqual({ imageRouteId: null, videoRouteId: null, videoSupportsFirstFrame: false });
  });

  it('falls back to an unknown-health route rather than binding nothing', () => {
    // 'unknown' means unprobed, not broken. Refusing it would leave the project dead for a reason
    // the user cannot see or fix.
    const picked = pickDefaultRoutes([
      route('img-maybe', 'image', 'unknown'),
      route('vid-maybe', 'video', 'unknown', true),
    ]);
    expect(picked.imageRouteId).toBe('img-maybe');
    expect(picked.videoRouteId).toBe('vid-maybe');
  });

  it('prefers an available route over an unknown one of the same kind', () => {
    const picked = pickDefaultRoutes([route('img-maybe', 'image', 'unknown'), route('img-live', 'image', 'available')]);
    expect(picked.imageRouteId).toBe('img-live');
  });

  it('takes the catalogue in order, so two identical projects bind identically', () => {
    const catalogue = [route('img-a', 'image', 'available'), route('img-b', 'image', 'available')];
    expect(pickDefaultRoutes(catalogue).imageRouteId).toBe('img-a');
    expect(pickDefaultRoutes(catalogue).imageRouteId).toBe('img-a');
  });

  it('binds nothing when the catalogue is empty rather than throwing', () => {
    // Route listing fails on provider errors, and a project that cannot be created is worse than a
    // project that cannot yet generate.
    expect(pickDefaultRoutes([])).toEqual({
      imageRouteId: null,
      videoRouteId: null,
      videoSupportsFirstFrame: false,
    });
  });
});
