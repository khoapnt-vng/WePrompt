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
const PHASE_SHELL_STYLESHEET = path.join(STUDIO_STYLES_ROOT, 'components/PhaseShell/StudioPhaseShell.module.css');
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

/**
 * The view switch is disabled whenever a generation review, a duplicate-charge prompt or the export
 * modal is open — the moments a reader is most likely to have lost track of which view is behind the
 * dialog. Arco paints every disabled text button one flat colour with a two-class selector that ties
 * with the module's own two-class rules, so without a more specific override the winner is decided by
 * stylesheet injection order and the active label can flatten into its neighbours.
 *
 * jsdom applies no cascade, so no rendering test can see this. This reads the shipped declarations.
 */
describe('Studio view switch disabled active marker', () => {
  type Rule = { selectors: string[]; declarations: Record<string, string> };

  // Comments must go first: a selector capture of `[^{}]+` otherwise swallows the comment above the
  // rule, and these very rules are documented with comments that name the Arco selectors involved.
  const parseRules = (css: string): Rule[] =>
    [...css.replaceAll(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((rule) => ({
      selectors: rule[1]!.split(',').map((candidate) => candidate.trim()),
      declarations: Object.fromEntries(
        [...rule[2]!.matchAll(/([\w-]+)\s*:\s*([^;]+);/g)].map((declaration) => [
          declaration[1]!,
          declaration[2]!.trim(),
        ])
      ),
    }));

  /** Class-compound count, the only specificity component any of these selectors varies. */
  const classWeight = (selector: string): number => (selector.match(/\.[\w-]+/g) ?? []).length;

  const shellRules = parseRules(readFileSync(PHASE_SHELL_STYLESHEET, 'utf8'));

  const disabledColour = (moduleClass: string): { colour: string; weight: number } => {
    const matches = shellRules.flatMap((rule) =>
      rule.selectors
        .filter(
          (selector) =>
            new RegExp(`\\.${moduleClass}(?![\\w-])`).test(selector) && selector.includes('.arco-btn-disabled')
        )
        .filter(() => rule.declarations.color !== undefined)
        .map((selector) => ({ colour: rule.declarations.color!, weight: classWeight(selector) }))
    );
    expect(matches, `${moduleClass} declares no colour for the disabled state`).toHaveLength(1);
    return matches[0]!;
  };

  /** Arco's competing rule, read rather than assumed, so a version bump re-opens the question. */
  const arcoDisabledTextWeight = (() => {
    const arcoCss = readFileSync(
      path.resolve(__dirname, '../../../../node_modules/@arco-design/web-react/dist/css/arco.css'),
      'utf8'
    );
    const weights = parseRules(arcoCss)
      .flatMap((rule) => rule.selectors)
      .filter((selector) => selector === '.arco-btn-text.arco-btn-disabled')
      .map(classWeight);
    expect(weights.length, 'Arco no longer ships .arco-btn-text.arco-btn-disabled').toBeGreaterThan(0);
    return Math.max(...weights);
  })();

  it('outranks the Arco disabled-text colour on specificity rather than on stylesheet order', () => {
    const active = disabledColour('viewButtonActive');
    const inactive = disabledColour('viewButton');

    expect(active.weight).toBeGreaterThan(arcoDisabledTextWeight);
    expect(inactive.weight).toBeGreaterThan(arcoDisabledTextWeight);
    expect(active.colour).not.toBe(inactive.colour);
  });

  it('declares the active underline unconditionally, so disabling cannot switch it off', () => {
    const markers = shellRules.filter(
      (rule) =>
        rule.selectors.includes('.viewButtonActive') && rule.declarations['box-shadow']?.includes('inset') === true
    );

    expect(markers, 'the active view marker is not declared on the bare .viewButtonActive class').toHaveLength(1);
    // A `:not(...)`-qualified or `:enabled` variant would silently drop the marker while blocked.
    expect(readFileSync(PHASE_SHELL_STYLESHEET, 'utf8')).not.toMatch(/\.viewButtonActive[^,{]*:(?:not\(|enabled)/);
  });
});
