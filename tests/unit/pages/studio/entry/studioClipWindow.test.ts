/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { resolveEngineClipWindow } from '@renderer/pages/studio/studioClipWindow';

const entry = (min: number, max: number, id: string) => ({
  choiceId: id,
  providerId: 'p',
  providerName: 'P',
  model: id,
  integrationLabelKey: 'byteplus' as never,
  health: 'available' as const,
  kind: 'video' as const,
  constraints: {
    aspectRatios: ['16:9' as const],
    resolutions: ['720p' as const],
    minDurationSeconds: min,
    maxDurationSeconds: max,
    supportsFirstFrame: true,
    maxConditioningImages: 1,
    silentOutput: false,
  },
});

const catalog = (selectedRoute: unknown, options: unknown[]) => ({
  image: { status: 'ready', selected: null, selectedRoute: null, selectionIssue: null, options: [] },
  video: { status: 'ready', selected: null, selectedRoute, selectionIssue: null, options },
  catalogVersion: 'v1',
});

describe('resolveEngineClipWindow', () => {
  it('takes the selected route when the project has one', () => {
    expect(resolveEngineClipWindow(catalog(entry(2, 12, 'a'), [entry(4, 15, 'b')]) as never)).toEqual({
      minDurationSeconds: 2,
      maxDurationSeconds: 12,
    });
  });

  /** Before a route is chosen, only the range that renders on whichever engine wins is safe. */
  it('intersects the connected engines when nothing is selected', () => {
    expect(resolveEngineClipWindow(catalog(null, [entry(2, 12, 'a'), entry(4, 15, 'b')]) as never)).toEqual({
      minDurationSeconds: 4,
      maxDurationSeconds: 12,
    });
  });

  it('reports unknown rather than guessing when no video engine is connected', () => {
    expect(resolveEngineClipWindow(catalog(null, []) as never)).toBeNull();
    expect(resolveEngineClipWindow(null)).toBeNull();
  });

  /** A reversed range would read as a rule no clip can satisfy. */
  it('reports unknown when the connected engines share no overlap', () => {
    expect(resolveEngineClipWindow(catalog(null, [entry(2, 3, 'a'), entry(10, 15, 'b')]) as never)).toBeNull();
  });
});
