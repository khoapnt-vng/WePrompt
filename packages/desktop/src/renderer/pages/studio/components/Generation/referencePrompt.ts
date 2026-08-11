/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

export const buildProductSheetPrompt = (visualPrompt: string): string =>
  `Product reference sheet. Pure white catalog background with thin labeled dividers.
[SECTION 1]: Three-view turnaround — straight-on, 3/4 angle, side profile.
[SECTION 2]: In-context scale reference.
[SECTION 3]: Macro close-ups of material and texture.
[SECTION 4]: A flat color swatch.
Identical geometry, placement, and material finish in every section.
Subject: ${visualPrompt.trim()}`;
