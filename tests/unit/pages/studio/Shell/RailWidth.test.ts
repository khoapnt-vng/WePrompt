/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import {
  RAIL_WIDTH_DEFAULT_PX,
  RAIL_WIDTH_MAX_PX,
  RAIL_WIDTH_MIN_PX,
  RAIL_WIDTH_STEP_PX,
  RAIL_RESIZER_WIDTH_PX,
  WORK_PANEL_MIN_WIDTH_PX,
  clampRailWidth,
  directorRailNeedsOverlay,
  railWidthFromKey,
} from '@/renderer/pages/studio/components/Workspace/WorkspaceShell';

describe('the Director rail width', () => {
  it('holds the drawn width between a floor and a ceiling', () => {
    expect(clampRailWidth(RAIL_WIDTH_DEFAULT_PX)).toBe(RAIL_WIDTH_DEFAULT_PX);
    expect(clampRailWidth(RAIL_WIDTH_MIN_PX - 200)).toBe(RAIL_WIDTH_MIN_PX);
    expect(clampRailWidth(RAIL_WIDTH_MAX_PX + 500)).toBe(RAIL_WIDTH_MAX_PX);
  });

  it('refuses a width that is not a usable number', () => {
    // A stored preference is untrusted input: it survives across releases and can be edited by hand.
    expect(clampRailWidth(Number.NaN)).toBe(RAIL_WIDTH_DEFAULT_PX);
    expect(clampRailWidth(Number.POSITIVE_INFINITY)).toBe(RAIL_WIDTH_DEFAULT_PX);
    expect(clampRailWidth(-1)).toBe(RAIL_WIDTH_MIN_PX);
  });

  it('uses a drawer one pixel before the rail, separator, and usable work surface can fit', () => {
    const exactSplitWidth = RAIL_WIDTH_MAX_PX + RAIL_RESIZER_WIDTH_PX + WORK_PANEL_MIN_WIDTH_PX;
    expect(directorRailNeedsOverlay(exactSplitWidth, RAIL_WIDTH_MAX_PX)).toBe(false);
    expect(directorRailNeedsOverlay(exactSplitWidth - 1, RAIL_WIDTH_MAX_PX)).toBe(true);
    // A zero measurement occurs before layout in DOM shims; it must not create a false drawer.
    expect(directorRailNeedsOverlay(0, RAIL_WIDTH_MAX_PX)).toBe(false);
  });

  it('moves by a step on the arrow keys, in the direction the pane grows', () => {
    expect(railWidthFromKey(400, 'ArrowRight')).toBe(400 + RAIL_WIDTH_STEP_PX);
    expect(railWidthFromKey(400, 'ArrowLeft')).toBe(400 - RAIL_WIDTH_STEP_PX);
  });

  it('jumps to the bounds on Home and End, and back to the drawn width on Enter', () => {
    expect(railWidthFromKey(400, 'Home')).toBe(RAIL_WIDTH_MIN_PX);
    expect(railWidthFromKey(400, 'End')).toBe(RAIL_WIDTH_MAX_PX);
    expect(railWidthFromKey(400, 'Enter')).toBe(RAIL_WIDTH_DEFAULT_PX);
  });

  it('stays put on a key it does not handle', () => {
    expect(railWidthFromKey(400, 'a')).toBeNull();
    expect(railWidthFromKey(400, 'Tab')).toBeNull();
  });

  it('clamps what the keys produce rather than running past the bounds', () => {
    expect(railWidthFromKey(RAIL_WIDTH_MAX_PX, 'ArrowRight')).toBe(RAIL_WIDTH_MAX_PX);
    expect(railWidthFromKey(RAIL_WIDTH_MIN_PX, 'ArrowLeft')).toBe(RAIL_WIDTH_MIN_PX);
  });
});
