/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Studio renders generated assets so a person can judge them. These guards prevent the recurring
 * BUG-138/172/178 failure modes: fixed 16:9 project previews, cropped judging surfaces, and clipped
 * grid rows where object-fit never gets a definite box to fit inside. Compact control thumbnails
 * may keep a stable outer size, but their media must remain fully visible.
 */

const STUDIO_ROOT = resolve(process.cwd(), 'packages/desktop/src/renderer/pages/studio');
const BEAT_PANEL_CSS = 'components/Workspace/BeatPanel/BeatPanel.module.css';
const LIBRARY_CSS = 'components/Library/StudioLibrary.module.css';
const BOUNDARY_GLYPH_SELECTOR = ".boundaryFrame[data-boundary-frame='on_disk'] img";

type StudioSource = { path: string; source: string };

const studioSources = (extension: '.module.css' | '.tsx'): StudioSource[] => {
  const found: StudioSource[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith(extension)) {
        found.push({ path: relative(STUDIO_ROOT, full), source: readFileSync(full, 'utf8') });
      }
    }
  };
  walk(STUDIO_ROOT);
  return found;
};

const cssRules = (css: string): { selector: string; body: string }[] =>
  Array.from(css.matchAll(/([^{}]+)\{([^}]*)\}/g), ([, selector, body]) => ({
    selector: selector.trim(),
    body,
  }));

describe('studio image framing', () => {
  it('finds Studio stylesheets to check, so a move cannot silently empty this guard', () => {
    expect(studioSources('.module.css').length).toBeGreaterThan(5);
  });

  it('never hardcodes the aspect-ratio property on a project preview', () => {
    const offenders: string[] = [];
    for (const { path, source } of studioSources('.module.css')) {
      for (const { selector, body } of cssRules(source)) {
        for (const [, value] of body.matchAll(/(?:^|[;\n])\s*aspect-ratio:\s*([^;]+);/g)) {
          const literal = value.trim();
          if (literal.startsWith('var(') || literal === 'auto' || literal === 'inherit') continue;
          if (path === LIBRARY_CSS && selector === '.poster' && literal === '16 / 9') continue;
          if (/^\d+ \/ \d+$/.test(literal)) offenders.push(`${path}: ${selector}: ${literal}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('never crops an asset a person is asked to judge', () => {
    const offenders: string[] = [];
    for (const { path, source } of studioSources('.module.css')) {
      for (const { selector, body } of cssRules(source)) {
        if (!/object-fit:\s*cover/.test(body)) continue;
        if (path === BEAT_PANEL_CSS && selector === BOUNDARY_GLYPH_SELECTOR) continue;
        offenders.push(`${path}: ${selector}`);
      }
    }
    for (const { path, source } of studioSources('.tsx')) {
      if (/\bobject-cover\b/.test(source) || /objectFit:\s*['"]cover['"]/.test(source)) {
        offenders.push(`${path}: JSX cover utility/style`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('gives every ratio variable a numeric fallback', () => {
    const offenders: string[] = [];
    for (const { path, source } of studioSources('.module.css')) {
      for (const [, value] of source.matchAll(/aspect-ratio:\s*(var\([^;]*\));/g)) {
        if (!/,\s*\d+\s*\/\s*\d+\s*\)$/.test(value.trim())) {
          offenders.push(`${path}: aspect-ratio: ${value.trim()}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('republishes the ratio inside the portalled Beat panel', () => {
    const panel = studioSources('.module.css').find(({ path }) => path === BEAT_PANEL_CSS);
    expect(panel, 'BeatPanel.module.css not found').toBeDefined();
    expect(panel!.source).toMatch(/aspect-ratio:\s*var\(--studio-frame-aspect-ratio/);
    for (const ratio of ['16:9', '9:16', '1:1', '4:3', '3:4']) {
      const [width, height] = ratio.split(':');
      expect(panel!.source, `BeatPanel must declare ${ratio}`).toMatch(
        new RegExp(
          `\\.root\\[data-aspect-ratio='${ratio}'\\]\\s*\\{[^}]*--studio-frame-aspect-ratio:\\s*${width} / ${height}`,
          's'
        )
      );
    }
    const markup = readFileSync(resolve(STUDIO_ROOT, 'components/Workspace/BeatPanel/index.tsx'), 'utf8');
    expect(markup).toMatch(/data-aspect-ratio=\{aspectRatio\}/);
  });

  it('gives clipped grid boxes a definite row so object-fit remains effective', () => {
    const offenders: string[] = [];
    for (const { path, source } of studioSources('.module.css')) {
      for (const { selector, body } of cssRules(source)) {
        const isGrid = /display:\s*grid/.test(body);
        const clips = /overflow:\s*hidden/.test(body);
        const centres = /place-items:\s*center/.test(body) || /align-items:\s*center/.test(body);
        const sized = /block-size:\s*\d/.test(body) || /aspect-ratio:/.test(body);
        if (isGrid && clips && centres && sized && !/grid-template-rows:/.test(body)) {
          offenders.push(`${path}: ${selector}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
