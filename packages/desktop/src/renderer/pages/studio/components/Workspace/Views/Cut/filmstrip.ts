/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { WorkspaceCutProjection } from '../../workspaceProjection';

export type CutFilmstripSegment = {
  beatId: string;
  /** 1-based play order. */
  position: number;
  /** The position as the drawing writes it: zero-padded to two digits, wider only past ninety-nine. */
  label: string;
  title: string;
  durationSeconds: number;
  /** The drawing gives each segment `flex: <seconds> 1 0%`, so the grow factor is the duration. */
  growFactor: number;
};

type CutFilmstripInput = Pick<WorkspaceCutProjection, 'beats'>;

const usableSeconds = (value: number | null): value is number => value !== null && Number.isFinite(value) && value >= 0;

/**
 * A proportional strip cannot place a Beat of unknown length, and rendering the remainder would draw
 * a film shorter than it is. One unusable length fails the whole strip closed.
 */
export const buildCutFilmstrip = (cut: CutFilmstripInput): CutFilmstripSegment[] | null => {
  const segments: CutFilmstripSegment[] = [];
  for (const [index, beat] of cut.beats.entries()) {
    if (!usableSeconds(beat.durationSeconds)) return null;
    const position = index + 1;
    segments.push({
      beatId: beat.id,
      position,
      label: String(position).padStart(2, '0'),
      title: beat.title,
      durationSeconds: beat.durationSeconds,
      growFactor: beat.durationSeconds,
    });
  }
  return segments;
};
