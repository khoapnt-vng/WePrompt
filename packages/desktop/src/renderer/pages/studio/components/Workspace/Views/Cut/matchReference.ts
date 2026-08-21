/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { WorkspaceProjection } from '../../workspaceProjection';

export type CutMatchReference = {
  beatId: string;
  shotId: string;
  /** 1-based position of the owning Beat in the film. */
  beatPosition: number;
  /** 1-based position of the Shot within its own Beat, not across the film. */
  shotPosition: number;
  beatLabel: string;
  shotLabel: string;
};

type CutMatchReferenceInput = {
  activeBeats: readonly Pick<WorkspaceProjection['activeBeats'][number], 'id' | 'shots'>[];
  selectedMatchShotId: string | null;
};

/**
 * Locates the Shot every other Shot is graded toward, and names it the way the drawing does: by
 * where its Beat sits in the film and where it sits in that Beat. A selection that no active Beat
 * owns has no name and yields nothing, so a parked or removed Shot is never announced as the
 * reference the film is being matched to.
 */
export const buildCutMatchReference = (input: CutMatchReferenceInput): CutMatchReference | null => {
  const { selectedMatchShotId } = input;
  if (selectedMatchShotId === null) return null;
  for (const [beatIndex, beat] of input.activeBeats.entries()) {
    const shotIndex = beat.shots.findIndex((shot) => shot.id === selectedMatchShotId);
    if (shotIndex === -1) continue;
    const beatPosition = beatIndex + 1;
    const shotPosition = shotIndex + 1;
    return {
      beatId: beat.id,
      shotId: selectedMatchShotId,
      beatPosition,
      shotPosition,
      beatLabel: String(beatPosition).padStart(2, '0'),
      shotLabel: String(shotPosition).padStart(2, '0'),
    };
  }
  return null;
};
