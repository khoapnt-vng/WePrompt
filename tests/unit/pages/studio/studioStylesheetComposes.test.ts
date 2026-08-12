/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

// A CSS module `composes: … from '<path>'` whose target does not exist fails at
// PostCSS resolve time, which 500s the stylesheet, which fails the importing
// component's dynamic import, which can take a whole route down behind the error
// boundary - four levels from the cause. Neither `tsc` (it does not check CSS
// specifiers) nor the jsdom suites (they mock CSS modules) can see it, so the
// entire test suite passes against a dead phase. This walks the real files.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const STUDIO_STYLES_ROOT = path.resolve(__dirname, '../../../../packages/desktop/src/renderer/pages/studio');
const WRITE_STYLESHEET = path.join(STUDIO_STYLES_ROOT, 'components/PhaseShell/phases/write/write.module.css');
const COMPOSES_FROM = /composes:[^;]*from\s+["']([^"']+)["']/g;

const moduleStylesheets = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return moduleStylesheets(entryPath);
    return entry.name.endsWith('.module.css') ? [entryPath] : [];
  });

const unresolvedComposeTargets = (stylesheet: string): string[] =>
  [...readFileSync(stylesheet, 'utf8').matchAll(COMPOSES_FROM)]
    .map((match) => match[1])
    .filter((specifier) => !existsSync(path.resolve(path.dirname(stylesheet), specifier)))
    .map((specifier) => `${path.relative(STUDIO_STYLES_ROOT, stylesheet)} -> ${specifier}`);

describe('studio CSS module composes targets', () => {
  const stylesheets = moduleStylesheets(STUDIO_STYLES_ROOT);

  it('finds stylesheets to check', () => {
    // Guards the guard: a broken root path would make the assertion below vacuous.
    expect(stylesheets.length).toBeGreaterThan(10);
  });

  it('resolves every composes target on disk', () => {
    expect([...new Set(stylesheets.flatMap(unresolvedComposeTargets))]).toEqual([]);
  });
});

describe('Studio write table stylesheet', () => {
  const stylesheet = readFileSync(WRITE_STYLESHEET, 'utf8');

  const declarationsFor = (selector: string): Record<string, string> => {
    const declarations: Record<string, string> = {};
    for (const rule of stylesheet.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selectors = rule[1]!.split(',').map((candidate) => candidate.trim());
      if (!selectors.includes(selector)) continue;
      for (const declaration of rule[2]!.matchAll(/([\w-]+)\s*:\s*([^;]+);/g)) {
        declarations[declaration[1]!] = declaration[2]!.trim();
      }
    }
    return declarations;
  };

  it('keeps the header and scene cells aligned to the fixed 696px table width', () => {
    const expected = {
      'grid-template-columns': '56px 200px 320px 120px',
      'min-width': '696px',
    };

    expect(declarationsFor('.tableHeader')).toMatchObject(expected);
    expect(declarationsFor('.scriptRow')).toMatchObject(expected);
    expect(declarationsFor('.scriptRowItem')).toMatchObject({ 'min-width': '696px' });
  });
});
