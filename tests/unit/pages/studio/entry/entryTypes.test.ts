/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { clampToClipWindow, studioShortDurations } from '@renderer/pages/studio/components/EntryKit/types';

describe('studioShortDurations', () => {
  it('offers every second step the engine can hold, including both bounds', () => {
    expect(studioShortDurations({ minDurationSeconds: 4, maxDurationSeconds: 12 })).toEqual([4, 6, 8, 10, 12]);
  });

  it('always includes the maximum even when the step would overshoot it', () => {
    expect(studioShortDurations({ minDurationSeconds: 5, maxDurationSeconds: 8 })).toEqual([5, 7, 8]);
  });

  it('offers the single length an engine with a fixed duration allows', () => {
    expect(studioShortDurations({ minDurationSeconds: 6, maxDurationSeconds: 6 })).toEqual([6]);
  });

  it('offers nothing at all when no engine is connected', () => {
    expect(studioShortDurations(null)).toEqual([]);
  });

  it('offers nothing rather than a reversed range', () => {
    expect(studioShortDurations({ minDurationSeconds: 10, maxDurationSeconds: 4 })).toEqual([]);
  });

  it('offers nothing for a non-integer or non-positive window', () => {
    expect(studioShortDurations({ minDurationSeconds: 0, maxDurationSeconds: 8 })).toEqual([]);
    expect(studioShortDurations({ minDurationSeconds: 4.5, maxDurationSeconds: 8 })).toEqual([]);
  });

  /** seedance-1-0-pro accepts 2s, but the store's schema rejects the add_shot that would follow. */
  it('never offers a length below the store floor even when the engine allows it', () => {
    expect(studioShortDurations({ minDurationSeconds: 2, maxDurationSeconds: 12 })).toEqual([4, 6, 8, 10, 12]);
  });

  it('never offers a length above the store ceiling even when the engine allows it', () => {
    expect(studioShortDurations({ minDurationSeconds: 4, maxDurationSeconds: 20 })).toEqual([4, 6, 8, 10, 12, 14, 15]);
  });

  it('offers nothing when the engine range sits entirely outside what the store accepts', () => {
    expect(studioShortDurations({ minDurationSeconds: 1, maxDurationSeconds: 3 })).toEqual([]);
  });
});

describe('clampToClipWindow', () => {
  it('keeps a duration the engine can hold', () => {
    expect(clampToClipWindow(8, { minDurationSeconds: 4, maxDurationSeconds: 12 })).toBe(8);
  });

  it('raises a too-short duration to the engine minimum', () => {
    expect(clampToClipWindow(2, { minDurationSeconds: 4, maxDurationSeconds: 12 })).toBe(4);
  });

  it('lowers a too-long duration to the engine maximum', () => {
    expect(clampToClipWindow(30, { minDurationSeconds: 4, maxDurationSeconds: 12 })).toBe(12);
  });

  it('returns null when there is no window to clamp into', () => {
    expect(clampToClipWindow(8, null)).toBeNull();
  });

  it('raises to the store floor rather than the lower engine minimum', () => {
    expect(clampToClipWindow(2, { minDurationSeconds: 2, maxDurationSeconds: 12 })).toBe(4);
  });

  it('lowers to the store ceiling rather than the higher engine maximum', () => {
    expect(clampToClipWindow(20, { minDurationSeconds: 4, maxDurationSeconds: 20 })).toBe(15);
  });
});
