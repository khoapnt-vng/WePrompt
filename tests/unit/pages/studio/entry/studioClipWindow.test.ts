/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { resolveEngineClipWindow } from '@/common/types/project/studioClipWindow';

const entry = (min: number, max: number, id: string, supportedDurationSeconds?: number[]) => ({
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
    ...(supportedDurationSeconds === undefined ? {} : { supportedDurationSeconds }),
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

  /** A length only one engine admits is not safe while the project may still bind to the other. */
  it('intersects the exact lengths when every connected engine declares them', () => {
    expect(
      resolveEngineClipWindow(catalog(null, [entry(4, 12, 'a', [4, 8, 12]), entry(4, 10, 'b', [4, 8, 10])]) as never)
    ).toEqual({ minDurationSeconds: 4, maxDurationSeconds: 10, supportedDurationSeconds: [4, 8] });
  });

  it('carries the exact lengths of the route the project already selected', () => {
    expect(resolveEngineClipWindow(catalog(entry(5, 10, 'a', [5, 10]), [entry(4, 15, 'b')]) as never)).toEqual({
      minDurationSeconds: 5,
      maxDurationSeconds: 10,
      supportedDurationSeconds: [5, 10],
    });
  });

  /** A continuous engine renders anything in its range, so narrowing to a ladder would refuse work it accepts. */
  it('reports no exact lengths when any connected engine is continuous', () => {
    expect(resolveEngineClipWindow(catalog(null, [entry(4, 12, 'a', [4, 8, 12]), entry(4, 10, 'b')]) as never)).toEqual(
      { minDurationSeconds: 4, maxDurationSeconds: 10 }
    );
  });

  /** Overlapping ranges are not overlapping offers: no single length both engines would render. */
  it('reports unknown when the connected engines admit no length in common', () => {
    expect(
      resolveEngineClipWindow(catalog(null, [entry(4, 8, 'a', [4, 8]), entry(5, 10, 'b', [5, 10])]) as never)
    ).toBeNull();
  });
});
