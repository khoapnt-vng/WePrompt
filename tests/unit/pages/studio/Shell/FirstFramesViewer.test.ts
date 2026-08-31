/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Asserted against the stylesheet rather than the DOM because jsdom applies no CSS-module rules, so
 * a rendered element reports none of these values. The collision this guards is between our content
 * and an Arco control positioned outside the flow, which a DOM test could not see either.
 */
const css = (): string =>
  readFileSync(
    resolve(
      process.cwd(),
      'packages/desktop/src/renderer/pages/studio/components/Workspace/BeatPanel/FirstFrames/FirstFrames.module.css'
    ),
    'utf8'
  );

/** Every declaration reaching `selector`: the topline is styled by a shared rule and its own. */
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

describe('first-frame viewer chrome', () => {
  it('reserves the corner that Arco paints its close button into', () => {
    /*
     * Arco positions .arco-modal-close-icon absolutely at right 20px, over whatever the content
     * puts there. The topline's right-hand slot is the frame counter, and because .viewerModal
     * zeroes the modal content's padding while .viewer supplies 20px, the counter's right edge
     * landed exactly under the icon and its last character was painted over.
     */
    expect(block(css(), '.viewerTopline')).toContain('padding-inline-end: 24px');
  });

  it('reserves it logically, so Persian does not reserve the wrong side', () => {
    /*
     * fa-IR is one of the twelve locales, and Arco flips the icon under RTL
     * (.arco-modal-rtl .arco-modal-close-icon { right: initial; left: 20px }). A physical
     * padding-right would hold open the corner the button has just left.
     */
    const topline = block(css(), '.viewerTopline');
    expect(topline).not.toContain('padding-right');
  });
});
