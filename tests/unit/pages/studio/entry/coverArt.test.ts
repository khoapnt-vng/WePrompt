/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { makeRng } from '@renderer/pages/studio/components/EntryKit/coverArt/makeRng';
import { resolveProjectArtFormat } from '@renderer/pages/studio/components/EntryKit/coverArt/projectArtFormat';

describe('makeRng', () => {
  it('replays the same sequence for one seed', () => {
    expect(makeRng('a')()).toBe(makeRng('a')());
  });

  it('diverges across seeds', () => {
    expect(makeRng('a')()).not.toBe(makeRng('b')());
  });

  it('stays inside the unit interval', () => {
    const rng = makeRng('seed');
    for (let index = 0; index < 64; index += 1) {
      const value = rng();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe('resolveProjectArtFormat', () => {
  it('is stable for one project id', () => {
    expect(resolveProjectArtFormat('p1', '16:9')).toBe(resolveProjectArtFormat('p1', '16:9'));
  });

  it('draws portrait projects with a portrait language', () => {
    expect(['tiktok', 'reels']).toContain(resolveProjectArtFormat('p1', '9:16'));
  });

  it('draws landscape projects with a landscape language', () => {
    expect(['motion-graphics', 'trailer']).toContain(resolveProjectArtFormat('p1', '16:9'));
  });

  it('resolves every aspect ratio the app supports', () => {
    for (const ratio of ['16:9', '9:16', '1:1', '4:3', '3:4'] as const) {
      expect(typeof resolveProjectArtFormat('p1', ratio)).toBe('string');
    }
  });

  /** One seeding scheme per directory: no second bespoke hash beside makeRng. */
  it('seeds from makeRng rather than its own hash', () => {
    expect(resolveProjectArtFormat.toString()).not.toMatch(/charCodeAt/);
  });
});
