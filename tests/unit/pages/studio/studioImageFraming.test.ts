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

  it('never lets a ratio variable collapse a box when it cannot be resolved', () => {
    /*
     * The variable is published on WorkspaceControls, but an Arco Modal with no getPopupContainer
     * portals its subtree to document.body. React keeps the component tree; CSS custom properties
     * inherit through the DOM, which the portal escapes. `aspect-ratio` is not inherited and its
     * initial value is `auto`, so an unresolvable var() silently un-shapes the box rather than
     * failing loudly. That regressed the Beat preview. A fallback makes the worst case a
     * wrong-but-shaped box instead of a collapsed one.
     */
    const offenders: string[] = [];
    for (const { path, css } of stylesheets()) {
      for (const [, value] of css.matchAll(/aspect-ratio:\s*(var\([^;]*\));/g)) {
        if (!/,\s*\d+\s*\/\s*\d+\s*\)$/.test(value.trim())) offenders.push(`${path}: aspect-ratio: ${value.trim()}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('publishes the ratio again on every surface that portals out of the workspace tree', () => {
    // The Beat panel is the one such surface today; it must declare what it consumes.
    const panel = stylesheets().find((s) => s.path.endsWith('BeatPanel/BeatPanel.module.css'));
    expect(panel, 'BeatPanel.module.css not found').toBeDefined();
    expect(panel!.css).toMatch(/aspect-ratio:\s*var\(--studio-frame-aspect-ratio/);
    for (const ratio of ['16:9', '9:16', '1:1', '4:3', '3:4']) {
      const [w, h] = ratio.split(':');
      expect(panel!.css, `BeatPanel must declare ${ratio}`).toMatch(
        new RegExp(
          `\\.root\\[data-aspect-ratio='${ratio}'\\]\\s*\\{[^}]*--studio-frame-aspect-ratio:\\s*${w} / ${h}`,
          's'
        )
      );
    }
    const markup = readFileSync(resolve(STUDIO_ROOT, 'components/Workspace/BeatPanel/index.tsx'), 'utf8');
    expect(markup).toMatch(/data-aspect-ratio=\{aspectRatio\}/);
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
