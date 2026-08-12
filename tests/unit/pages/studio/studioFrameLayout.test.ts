/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The Studio project view is a frame, not a document, and that is a purely CSS property.
 *
 * jsdom performs no layout and mocks CSS modules, so every DOM suite in this directory passes
 * whether the frame fills the viewport or grows past it. The symptom was invisible to all of them:
 * `.projectShell` was content-sized, so `flex: 1` down the tree divided content height instead of
 * screen height, and the Director's composer floated mid-page on a short phase while sitting 418px
 * below the fold on Review. Only the stylesheets can say whether the chain is intact.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const STUDIO_ROOT = path.resolve(__dirname, '../../../../packages/desktop/src/renderer/pages/studio');
const PAGE_STYLESHEET = path.join(STUDIO_ROOT, 'StudioPage.module.css');
const SHELL_STYLESHEET = path.join(STUDIO_ROOT, 'components/Shell/StudioShell.module.css');

const RULE = /([^{}]+)\{([^{}]*)\}/g;

/**
 * Comments come out first. These stylesheets explain the height chain in prose that names the very
 * declarations under test — `min-height`, `margin: 0 auto`, `overflow: hidden` — and prose about a
 * declaration is not a declaration. Reading them as CSS is how the last stylesheet guard in this
 * suite produced a false failure.
 */
const declarationsFor = (stylesheet: string, className: string): string[] => {
  const css = readFileSync(stylesheet, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const selector = new RegExp(`\\.${className}(?![\\w-])`);
  return [...css.matchAll(RULE)]
    .filter((rule) => selector.test(rule[1]!) && !rule[1]!.includes(':global'))
    .flatMap((rule) => rule[2]!.split(';'))
    .map((declaration) => declaration.trim().replace(/\s+/g, ' '))
    .filter((declaration) => declaration.length > 0);
};

const valueOf = (declarations: string[], property: string): string | undefined =>
  declarations
    .find((declaration) => new RegExp(`^${property}\\s*:`).test(declaration))
    ?.replace(new RegExp(`^${property}\\s*:\\s*`), '');

describe('studio project frame layout', () => {
  const pageProject = declarationsFor(PAGE_STYLESHEET, 'pageProject');
  const projectShell = declarationsFor(PAGE_STYLESHEET, 'projectShell');
  const page = declarationsFor(PAGE_STYLESHEET, 'page');
  const workPanel = declarationsFor(SHELL_STYLESHEET, 'workPanel');
  const workScroll = declarationsFor(SHELL_STYLESHEET, 'workScroll');
  const paneToggle = declarationsFor(SHELL_STYLESHEET, 'paneToggle');

  it.each([
    ['pageProject', () => pageProject],
    ['projectShell', () => projectShell],
    ['page', () => page],
    ['workPanel', () => workPanel],
    ['workScroll', () => workScroll],
    ['paneToggle', () => paneToggle],
  ])('finds the .%s declarations to check', (_name, declarations) => {
    // Guards the guard: a renamed class silently empties every assertion that reads it.
    expect(declarations().length).toBeGreaterThan(0);
  });

  /**
   * `height` and not `min-height` is the whole fix. A min-height inside a bounded flex column lets
   * the box grow to its content, which is exactly the state that stranded the composer.
   */
  it('measures the project frame by the viewport rather than by its content', () => {
    expect(valueOf(pageProject, 'height')).toBe('100%');
    expect(valueOf(pageProject, 'min-height')).toBe('0');
    expect(valueOf(pageProject, 'flex-direction')).toBe('column');
    expect(valueOf(pageProject, 'display')).toBe('flex');
  });

  /** Scrolling belongs to the work panel; a scrolling frame takes the Director column with it. */
  it('keeps the frame itself from scrolling', () => {
    expect(valueOf(pageProject, 'overflow')).toBe('hidden');
  });

  /**
   * The library still scrolls as a document and keeps its margins — the frame is a modifier on the
   * same element, so a change that reached `.page` would silently reformat the project list too.
   */
  it('leaves the library page a scrolling document', () => {
    expect(valueOf(page, 'overflow')).toBe('auto');
    expect(valueOf(page, 'min-height')).toBe('100%');
    expect(valueOf(page, 'padding')).toMatch(/clamp/);
  });

  /** Without both of these the frame's bounded height stops here and never reaches the shell. */
  it('passes the frame height down to the shell', () => {
    expect(valueOf(projectShell, 'flex')).toBe('1');
    expect(valueOf(projectShell, 'min-height')).toBe('0');
  });

  /**
   * Flush against the app side menu, the way a conversation is. A centred `min(100%, 1560px)` put
   * dead page between the menu and the Director pane on any window wider than that.
   */
  it('leaves no page margin between the side menu and the Director pane', () => {
    expect(valueOf(pageProject, 'padding')).toBe('0');
    expect(valueOf(projectShell, 'width')).toBe('100%');
    expect(valueOf(projectShell, 'margin')).toBeUndefined();
  });

  /**
   * The scroll box is a child of the work panel rather than the panel itself, because the collapse
   * toggle is absolutely positioned against the panel: were the panel the scroller, the one control
   * that brings the Director back would scroll out of reach.
   */
  it('scrolls the work inside the panel and not the panel itself', () => {
    expect(valueOf(workScroll, 'overflow-y')).toBe('auto');
    expect(valueOf(workScroll, 'min-height')).toBe('0');
    expect(valueOf(workScroll, 'flex')).toBe('1');
    expect(valueOf(workPanel, 'overflow')).toBe('hidden');
  });

  /**
   * Absolute offsets are measured from the padding box, so the panel's block inset does not move
   * the toggle. Deriving `top` from the same custom property is what keeps it level with the header
   * row when that inset changes — a literal would drift the moment the inset did.
   */
  it('derives the toggle offset from the inset it has to clear', () => {
    expect(valueOf(workPanel, '--studio-work-inset-block')).toMatch(/clamp/);
    expect(valueOf(paneToggle, 'top')).toContain('--studio-work-inset-block');
    expect(valueOf(workScroll, 'padding')).toContain('--studio-work-inset-block');
  });

  /**
   * The gutter is what stops the collapse toggle reading as the back button for the breadcrumb it
   * precedes. Two controls 8px apart group into one; the separation only works as a measurement, so
   * this pins the number rather than the appearance. jsdom cannot see any of it: the toggle is
   * absolutely positioned and jsdom measures every box at zero.
   */
  it('leaves the toggle enough clear space not to group with the breadcrumb', () => {
    const clear = valueOf(workPanel, '--studio-toggle-clear');

    expect(clear).toBeDefined();
    // Below roughly 24px, proximity makes the two read as one control group.
    expect(Number.parseInt(clear!, 10)).toBeGreaterThanOrEqual(24);
  });

  /** The gutter is the sum of its parts, so widening the toggle cannot silently eat the clear space. */
  it('builds the work panel gutter from the toggle box and that clear space', () => {
    const padding = valueOf(workPanel, 'padding-left');

    expect(padding).toContain('--studio-toggle-inset');
    expect(padding).toContain('--studio-toggle-size');
    expect(padding).toContain('--studio-toggle-clear');
    // And the toggle sits at the same inset the gutter accounts for, not at its own literal.
    expect(valueOf(paneToggle, 'left')).toBe('var(--studio-toggle-inset)');
  });
});
