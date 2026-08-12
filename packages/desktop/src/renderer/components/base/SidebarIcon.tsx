/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';

export type SidebarIconProps = {
  size?: number;
  strokeWidth?: number;
  /**
   * Only `Layout`'s copy of this icon carried `display: inline-block; vertical-align: middle`, and
   * dropping it there would have shifted the mobile sider button. It stays opt-in rather than
   * becoming the shared default so the titlebar renders byte-identically to before the extraction.
   */
  style?: React.CSSProperties;
};

/**
 * The application's sidebar-toggle glyph: a rounded rectangle with a vertical divider near the left
 * edge, reading as a collapsible side panel. Rendered inline because @icon-park ships no such shape.
 *
 * This is the glyph for "show or hide a panel" across the app, and it is deliberately *not* a
 * chevron. A chevron is the back affordance, and a chevron placed beside a breadcrumb is read as
 * that breadcrumb's back button no matter what its label says — which is exactly what went wrong
 * when Studio's Director toggle used one next to the trail leading back to the library.
 *
 * Note it does not change with state. Which way a panel will move is not information a glyph carries
 * reliably; `aria-expanded` and the button's label carry it instead, in one place, translated.
 *
 * Uses a 48-unit viewBox to match @icon-park's stroke scale, so passing the same `strokeWidth` here
 * and to an @icon-park icon produces visually identical lines. The rect spans y=10..38 (height 28),
 * slightly taller than @icon-park's ArrowLeft/ArrowRight (y=12..36) so the sidebar icon reads a
 * touch larger, while staying centred at y=24 so all three sit on one visual baseline.
 */
const SidebarIcon: React.FC<SidebarIconProps> = ({ size = 18, strokeWidth = 4, style }) => (
  <svg
    width={size}
    height={size}
    viewBox='0 0 48 48'
    fill='none'
    stroke='currentColor'
    strokeWidth={strokeWidth}
    strokeLinecap='round'
    strokeLinejoin='round'
    aria-hidden='true'
    focusable='false'
    data-icon='sidebar-panel'
    style={style}
  >
    <rect x='6' y='10' width='36' height='28' rx='5' />
    <line x1='18' y1='10' x2='18' y2='38' />
  </svg>
);

export default SidebarIcon;
