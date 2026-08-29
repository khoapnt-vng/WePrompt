/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Studio renders every generated asset so a person can judge it. Two habits defeat that, and both
 * recurred often enough to be filed three times (BUG-138, BUG-172, BUG-178):
 *
 *  1. hardcoding `aspect-ratio: 16 / 9` when `StudioAspectRatio` has five values, so every portrait
 *     and square project gets a box shaped for a ratio it never had; and
 *  2. combining a definite box with `place-items: center` and a child at `block-size: 100%`, which
 *     puts the image in a cyclic auto row that takes its intrinsic height and is then clipped —
 *     `object-fit` never runs at all.
 *
 * These are source-text guards. They cannot prove the rendered result, but they are exactly what
 * BUG-138's fix lacked: it was deleted wholesale by a later redesign with no test to notice.
 */

const STUDIO_ROOT = resolve(process.cwd(), 'packages/desktop/src/renderer/pages/studio');

/** The one deliberate crop: a 24x34 status glyph no one can judge an image in. */
const DELIBERATE_CROP_ALLOWLIST = new Set(['components/Workspace/BeatPanel/BeatPanel.module.css']);

/** A uniform gallery tile keeps project cards on a grid; its image is matted, never cropped. */
const UNIFORM_TILE_ALLOWLIST = new Set(['components/Library/StudioLibrary.module.css']);

const stylesheets = (): { path: string; css: string }[] => {
  const found: { path: string; css: string }[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith('.module.css')) {
        found.push({ path: relative(STUDIO_ROOT, full), css: readFileSync(full, 'utf8') });
      }
    }
  };
  walk(STUDIO_ROOT);
  return found;
};

describe('studio image framing', () => {
  it('finds stylesheets to check, so a move never silently empties this guard', () => {
    expect(stylesheets().length).toBeGreaterThan(5);
  });

  it('never hardcodes a project ratio, because a project has five of them', () => {
    const offenders: string[] = [];
    for (const { path, css } of stylesheets()) {
      if (UNIFORM_TILE_ALLOWLIST.has(path)) continue;
      for (const [, value] of css.matchAll(/aspect-ratio:\s*([^;]+);/g)) {
        const literal = value.trim();
        // `var(...)`, `auto` and `inherit` all defer to the project; a bare ratio does not.
        if (literal.startsWith('var(') || literal === 'auto' || literal === 'inherit') continue;
        // The five-way mapping declarations are the definition of the property, not a use of it.
        if (/^\d+ \/ \d+$/.test(literal) && css.includes('--studio-frame-aspect-ratio: ' + literal)) continue;
        if (/^\d+ \/ \d+$/.test(literal) && css.includes('--studio-reference-aspect-ratio: ' + literal)) continue;
        offenders.push(`${path}: aspect-ratio: ${literal}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('never crops an asset a person is asked to judge', () => {
    const offenders: string[] = [];
    for (const { path, css } of stylesheets()) {
      if (DELIBERATE_CROP_ALLOWLIST.has(path)) continue;
      if (/object-fit:\s*cover/.test(css)) offenders.push(`${path}: object-fit: cover`);
    }
    expect(offenders).toEqual([]);
  });

  it('gives every clipped grid box a definite row, so object-fit is not inert', () => {
    const offenders: string[] = [];
    for (const { path, css } of stylesheets()) {
      // A rule that is display:grid, clips, and centres its items is the shape that overflowed.
      for (const [, selector, body] of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
        const isGrid = /display:\s*grid/.test(body);
        const clips = /overflow:\s*hidden/.test(body);
        const centres = /place-items:\s*center/.test(body) || /align-items:\s*center/.test(body);
        const sized = /block-size:\s*\d/.test(body) || /aspect-ratio:/.test(body);
        if (isGrid && clips && centres && sized && !/grid-template-rows:/.test(body)) {
          offenders.push(`${path}: ${selector.trim()}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
