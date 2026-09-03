/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The work area used to open with two nested bordered boxes and two headings saying the same
 * thing, while the Beat's own name — the only text identifying which part of the film a card is —
 * was the smallest text on it (BUG-171, BUG-175). These guard the corrected order.
 */

const read = (relativePath: string): string =>
  readFileSync(resolve(process.cwd(), 'packages/desktop/src/renderer/pages/studio', relativePath), 'utf8');

const fontSize = (css: string, selector: string): number => {
  const rule = new RegExp(`${selector}[^{}]*\\{([^}]*)\\}`, 's').exec(css);
  expect(rule, `no rule for ${selector}`).not.toBeNull();
  const size = /font-size:\s*([\d.]+)px/.exec(rule![1]);
  expect(size, `no font-size in ${selector}`).not.toBeNull();
  return Number(size![1]);
};

describe('studio view chrome', () => {
  it('states the view name once, keeping it only as the region label', () => {
    const shell = read('components/Workspace/WorkspaceShell.tsx');
    // The heading must stay in the DOM: it is the work area's accessible name.
    expect(shell).toMatch(/aria-labelledby=\{viewHeadingId\}/);
    expect(shell).toMatch(/<h2 className=\{styles\.viewHeading\} id=\{viewHeadingId\}>/);

    const css = read('components/Workspace/Workspace.module.css');
    const rule = /\.viewHeading\s*\{([^}]*)\}/s.exec(css);
    expect(rule).not.toBeNull();
    expect(rule![1]).toMatch(/clip:\s*rect\(0, 0, 0, 0\)/);
    expect(rule![1]).toMatch(/position:\s*absolute/);
  });

  it('gives each view one surface, not a box inside an identical box', () => {
    const references = read('components/Workspace/Views/References/References.module.css');
    const root = /^\.root\s*\{([^}]*)\}/ms.exec(references);
    expect(root).not.toBeNull();
    // The outer .viewSurface already draws the border, radius and card background.
    expect(root![1]).not.toMatch(/border:/);
    expect(root![1]).not.toMatch(/border-radius:/);
    expect(root![1]).not.toMatch(/box-shadow:/);
    // The width constraint is layout, not chrome, and stays.
    expect(root![1]).toMatch(/inline-size:\s*min\(100%, 1000px\)/);

    const workspace = read('components/Workspace/Workspace.module.css');
    expect(workspace).toMatch(/\.viewSurface\s*\{[^}]*border:\s*1px solid/s);
  });

  it('paints one scrim over the Beat panel, not two', () => {
    const firstFrames = read('components/Workspace/BeatPanel/FirstFrames/index.tsx');
    // The Beat panel is a Modal too, so a translucent viewer mask stacks a second scrim.
    expect(firstFrames).toMatch(/maskStyle=\{\{ background: 'var\(--color-bg-1\)', opacity: 1 \}\}/);
  });

  it('keeps the frame counter clear of the close button Arco puts in the same corner', () => {
    // Found live: "1 of 1" ran to x1242 while the close icon began at x1230, so the counter's
    // last character was painted over. Arco positions the close button absolutely, which no
    // amount of flex layout inside the topline can account for.
    const css = read('components/Workspace/BeatPanel/FirstFrames/FirstFrames.module.css');
    expect(css).toMatch(/\.viewerTopline\s*\{[^}]*padding-inline-end:\s*24px/s);
  });

  it('makes the whole Beat card the target while keeping one keyboard-reachable control', () => {
    const board = read('components/Workspace/Views/Board/Board.module.css');
    // A 712x19 strip was the Board's primary navigation, far under the 24px target-size floor.
    expect(board).toMatch(/\.beatCard\s*\{[^}]*position:\s*relative/s);
    expect(board).toMatch(/\.beatTitle::after\s*\{[^}]*inset:\s*0/s);
    // The overlay must resolve against the card, not the button.
    expect(board).toMatch(/\.beatTitle:global\(\.arco-btn-text\)\s*\{[^}]*position:\s*static/s);
    // Interior controls stay reachable above it.
    // Lift the tiles, not the grid: lifting the container blankets the card's empty space and
    // leaves the overlay reachable only in the header strip (found by probing the running app).
    expect(board).toMatch(/\.beatPanelActions,\s*\n\.shotTile\s*\{[^}]*z-index:\s*1/s);
    expect(board).not.toMatch(/\.shotGrid,\s*\n?[^{]*\{[^}]*z-index:\s*1/s);

    // It must remain a real <button>: attaching onClick to the container would lose the keyboard.
    const markup = read('components/Workspace/Views/Board/index.tsx');
    expect(markup).toMatch(/className=\{styles\.beatTitle\}/);
    expect(markup).toMatch(/onClick=\{\(\) => onOpenBeat\(beat\.id\)\}/);
  });

  it('ranks a Beat name above the chrome that names the screen it is on', () => {
    const board = read('components/Workspace/Views/Board/Board.module.css');
    const beatName = fontSize(board, '\\.beatTitle');
    const sectionHeading = fontSize(board, '\\.heading,\\s*\\n\\.binTitle');
    expect(beatName).toBeGreaterThan(sectionHeading);
    // The project title is 14.5px; a section heading must not shout over it.
    expect(sectionHeading).toBeLessThanOrEqual(14.5);
  });
});
