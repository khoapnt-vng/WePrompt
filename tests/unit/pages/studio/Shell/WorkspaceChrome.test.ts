/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The workspace chrome's type is asserted against the CSS rather than the DOM because jsdom applies
 * no CSS-module rules, so a rendered element reports none of these values. Every number here was
 * measured off the pinned prototype and the designer's app-bar answer.
 */
const css = (): string =>
  readFileSync(
    resolve(process.cwd(), 'packages/desktop/src/renderer/pages/studio/components/Workspace/Workspace.module.css'),
    'utf8'
  );

/**
 * Every declaration that reaches `selector`, concatenated. A selector appears in more than one rule
 * here — shared chip styling plus an active-state override — and matching only the first block would
 * assert against whichever happens to come first in the file rather than against what the element
 * actually gets.
 */
const block = (source: string, selector: string): string =>
  [...source.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^}]*)\}/g)]
    .filter(([, selectors]) =>
      (selectors ?? '')
        .split(',')
        .map((one) => one.trim())
        .includes(selector)
    )
    .map(([, , body]) => body ?? '')
    .join('\n');

describe('workspace chrome type scale', () => {
  it('sets the project title at the drawn size rather than inheriting a heading default', () => {
    // Drawn: Manrope 700 at 14.5px. The build inherited a 29px h1 — twice the design, and larger
    // than the largest type anywhere in the drawing, which is the film clock at 23px.
    const rule = block(css(), '.projectTitle');
    expect(rule).toMatch(/font-size:\s*14\.5px/);
    expect(rule).toMatch(/font-family:\s*var\(--font-display\)/);
    expect(rule).toMatch(/font-weight:\s*var\(--fw-bold\)/);
  });

  it('gives the title a ceiling and a floor rather than a fixed width', () => {
    // The drawing rules a 320px ceiling and a 128px floor with tail ellipsis. The floor is what makes
    // the bar shed its own derived counts before it eats further into a name the user typed.
    const rule = block(css(), '.projectTitle');
    expect(rule).toMatch(/max-inline-size:\s*320px/);
    expect(rule).toMatch(/min-inline-size:\s*128px/);
    expect(rule).toMatch(/text-overflow:\s*ellipsis/);
    expect(rule).toMatch(/white-space:\s*nowrap/);
  });

  it('spans the surface with a spacer that absorbs the slack', () => {
    // The bar heads the project and both panes sit under it, so it must not reassemble itself when
    // the rail is toggled. The spacer is what keeps identity at the start and controls at the end.
    expect(block(css(), '.appBar')).toMatch(/display:\s*flex/);
    expect(block(css(), '.barSpacer')).toMatch(/flex:\s*1 1 auto/);
  });

  it('keeps the app bar at the 54px drawing height without wrapping translated controls', () => {
    const rule = block(css(), '.appBar');
    expect(rule).toMatch(/box-sizing:\s*border-box/);
    expect(rule).toMatch(/block-size:\s*54px/);
    expect(rule).toMatch(/flex-wrap:\s*nowrap/);
  });

  it('stacks the bar above the panes rather than beside them', () => {
    // The shell is a flex container holding the bar and the panes row. Left as a row — which it was
    // — the bar lays out beside the panes at a third of the width and the full height, and every
    // test still passes because jsdom applies none of this.
    expect(block(css(), '.shell')).toMatch(/flex-direction:\s*column/);
    expect(block(css(), '.panes')).toMatch(/display:\s*flex/);
  });

  it('carries no type larger than the drawing does', () => {
    const sizes = [...css().matchAll(/font-size:\s*([\d.]+)px/g)].map((match) => Number(match[1]));
    // 23px is the film clock, the largest thing in the whole design.
    expect(Math.max(...sizes, 0)).toBeLessThanOrEqual(23);
  });
});

describe('workspace view switch treatment', () => {
  it('sets the chips in the mono face at the drawn size and tracking', () => {
    // Drawn: IBM Plex Mono 9.5px, 0.76px tracking. The build used the body face at 14.5px.
    const rule = block(css(), '.viewLink');
    expect(rule).toMatch(/font-family:\s*var\(--font-mono\)/);
    expect(rule).toMatch(/font-size:\s*9\.5px/);
    expect(rule).toMatch(/letter-spacing:\s*0\.76px/);
  });

  it('uppercases the chips in CSS rather than in the translated string', () => {
    // The prototype types the capitals into its own strings and computes text-transform: none.
    // Copying that would bake English casing into the eleven locales that fall back to en-US, and
    // into scripts that have no case at all.
    expect(block(css(), '.viewLink')).toMatch(/text-transform:\s*uppercase/);
    const locale = readFileSync(
      resolve(process.cwd(), 'packages/desktop/src/renderer/services/i18n/locales/en-US/conversation.json'),
      'utf8'
    );
    const views = JSON.parse(locale).creativeStudio.workspace.views as Record<string, unknown>;
    for (const key of ['title', 'references', 'table', 'board', 'cut']) {
      const value = views[key];
      expect(typeof value, key).toBe('string');
      if (typeof value !== 'string') continue;
      expect(value, key).not.toBe(value.toUpperCase());
    }
  });

  it('squares the chip corners to the drawn radius instead of a pill', () => {
    expect(block(css(), '.viewLink')).toMatch(/border-radius:\s*6px/);
  });

  it('marks the active chip by its ground, not by making its text heavier', () => {
    // Both chips compute weight 400 in the drawing; the active one is distinguished by a white
    // ground and a darker ink. Bolding one chip reflows the row every time the view changes.
    const active = block(css(), '.viewLinkActive');
    expect(active).toMatch(/background:/);
    expect(active).not.toMatch(/font-weight/);

    // A ground only marks the chip if it differs from the bar's. Both set to the same token marks
    // the active view with nothing — which is what shipped until it was looked at.
    const barGround = /background:\s*([^;]+);/.exec(block(css(), '.appBar'))?.[1]?.trim();
    const chipGround = /background:\s*([^;]+);/.exec(active)?.[1]?.trim();
    expect(barGround).toBeDefined();
    expect(chipGround).toBeDefined();
    expect(chipGround).not.toBe(barGround);
  });

  it('keeps inspectable empty links legible and gives keyboard focus an explicit ring', () => {
    expect(css()).not.toMatch(/data-studio-view-readiness[^}]*opacity:/s);
    expect(block(css(), '.viewLink:focus-visible')).toMatch(/outline:\s*2px solid/);
    expect(block(css(), '.viewLink:focus-visible')).toMatch(/outline-offset:\s*-2px/);
    expect(block(css(), '.viewLinkActive:focus-visible')).toMatch(/outline:\s*2px solid/);
  });

  it('keeps every translated view reachable in the 400px window without wrapping the app bar', () => {
    const navigation = block(css(), '.viewNavigation');
    expect(navigation).toMatch(/min-inline-size:\s*0/);
    expect(navigation).toMatch(/flex:\s*0 1 auto/);
    expect(navigation).toMatch(/overflow-x:\s*auto/);
    expect(navigation).toMatch(/overflow-y:\s*hidden/);
    expect(block(css(), '.viewLink')).toMatch(/flex:\s*0 0 auto/);

    const narrow = /@media \(max-width: 600px\) \{([\s\S]*)\}\s*$/.exec(css())?.[1] ?? '';
    expect(block(narrow, '.appBar')).toMatch(/overflow-x:\s*auto/);
    expect(block(narrow, '.appBar')).toMatch(/padding-inline:\s*6px/);
    expect(block(narrow, '.projectDot')).toMatch(/display:\s*none/);
    expect(block(narrow, '.statStrip')).toMatch(/display:\s*none/);
    expect(block(narrow, '.projectTitle')).toMatch(/min-inline-size:\s*64px/);
    expect(block(narrow, '.projectTitle')).toMatch(/max-inline-size:\s*80px/);
    expect(block(narrow, '.viewNavigation')).toMatch(/min-inline-size:\s*96px/);
    expect(block(narrow, '.viewNavigation')).toMatch(/flex:\s*1 0 96px/);
  });

  it('draws distinct visible markers for dormant work and the one next view', () => {
    const dormant = block(css(), '.viewLinkDormantMark');
    const next = block(css(), '.viewLinkNext');
    expect(dormant).toMatch(/inline-size:\s*5px/);
    expect(dormant).toMatch(/block-size:\s*5px/);
    expect(dormant).toMatch(/border:\s*1px solid currentColor/);
    expect(next).toMatch(/border:\s*1px solid currentColor/);
  });
});

describe('workspace view surface', () => {
  it('lets the surface take its content height instead of being squeezed to the window', () => {
    /*
     * .viewSurface is a flex item of .workScroll, a bounded scrolling column. Left shrinkable it
     * was compressed to the viewport while its content was not -- the bordered card measured 779px
     * around 1649px of content -- and because the surface keeps overflow: visible, the rows simply
     * painted straight through the bottom border. The fix is to stop it shrinking, not to clip it:
     * .workScroll already scrolls, and a second scroller here would nest two.
     */
    const surface = block(css(), '.viewSurface');
    expect(surface).toContain('flex: 0 0 auto');
    expect(surface).toContain('min-block-size: 220px');
    expect(surface).not.toContain('overflow');
  });
});
