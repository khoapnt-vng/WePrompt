/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { StudioAspectRatio } from '@/common/types/project/creativeStudioTypes';

import { type StudioEntryArtFormat } from './artLanguage';
import { makeRng } from './makeRng';

/**
 * A project has no format field, so its cover art is chosen from the one shape fact it does have.
 *
 * Aspect ratio is not decoration here: a 9:16 project is a phone video and a 16:9 project is not,
 * and the art languages already encode that difference (the vertical languages draw a vertical
 * frame). Seeding the pick within the orientation's set from the project id gives neighbouring
 * cards distinct pictures while keeping every picture truthful about the project's shape.
 */
const FORMATS_BY_ORIENTATION: Record<'landscape' | 'portrait' | 'square', readonly StudioEntryArtFormat[]> = {
  landscape: ['motion-graphics', 'trailer'],
  portrait: ['tiktok', 'reels'],
  square: ['facebook-ad', 'motion-graphics'],
};

/**
 * Every ratio the app offers has a home here, and the mapping is exhaustive by type rather than by
 * a default branch: adding a sixth `StudioAspectRatio` should fail the build here, where somebody
 * has to decide what shape it draws as, instead of silently landing in whichever orientation a
 * fallback happened to name.
 */
const orientationOf = (aspectRatio: StudioAspectRatio): 'landscape' | 'portrait' | 'square' => {
  switch (aspectRatio) {
    case '9:16':
    case '3:4':
      return 'portrait';
    case '1:1':
      return 'square';
    case '16:9':
    case '4:3':
      return 'landscape';
  }
};

/**
 * The art language a project is drawn in: its orientation decides the set, its id decides which.
 *
 * Seeded through `makeRng` rather than a hash written here, because this directory already has one
 * definition of "a deterministic pick from an id" and the picture itself is drawn from it. A second
 * scheme three files away would be a drift hazard with nothing holding the two in step — and no
 * test could catch them diverging, since either alone looks stable.
 */
export const resolveProjectArtFormat = (projectId: string, aspectRatio: StudioAspectRatio): StudioEntryArtFormat => {
  const candidates = FORMATS_BY_ORIENTATION[orientationOf(aspectRatio)];
  // `makeRng` returns [0, 1), so the floor cannot reach `candidates.length`. The clamp costs
  // nothing and removes the undefined read outright rather than resting it on that argument.
  const index = Math.floor(makeRng(projectId)() * candidates.length);
  return candidates[Math.min(index, candidates.length - 1)]!;
};
