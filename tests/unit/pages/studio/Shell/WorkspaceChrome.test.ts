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
    const rule = block(css(), '.workspaceHeader h1');
    expect(rule).toMatch(/font-size:\s*14\.5px/);
    expect(rule).toMatch(/font-family:\s*var\(--font-display\)/);
    expect(rule).toMatch(/font-weight:\s*var\(--fw-bold\)/);
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
    const views = JSON.parse(locale).creativeStudio.workspace.views as Record<string, string>;
    for (const [key, value] of Object.entries(views)) {
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
  });
});
