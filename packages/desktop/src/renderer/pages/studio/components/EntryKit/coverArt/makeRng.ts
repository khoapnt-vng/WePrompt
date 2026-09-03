/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A seeded pseudo-random generator: FNV-1a over the seed text, then mulberry32.
 *
 * Seeded rather than `Math.random()` because cover art has to be *stable*. A card that reshuffles
 * its artwork on every render reads as a loading glitch, and the same project would look like a
 * different project after a re-mount. The seed is the entity id, so the art is a function of
 * identity: same id, same picture, forever, with no bytes stored anywhere.
 */
export const makeRng = (seedText: string): (() => number) => {
  let hash = 2166136261;
  for (let index = 0; index < seedText.length; index += 1) {
    hash ^= seedText.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return () => {
    hash += 0x6d2b79f5;
    let state = hash;
    state = Math.imul(state ^ (state >>> 15), state | 1);
    state ^= state + Math.imul(state ^ (state >>> 7), state | 61);
    return ((state ^ (state >>> 14)) >>> 0) / 4294967296;
  };
};
