/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The width at and below which the Look stops being a column and becomes a second line inside the
 * Action cell. Ruled by the designer on 2026-08-21 and measured, as the coverage bar's density tiers
 * are, against the rendered column width rather than the window's.
 */
export const TABLE_LOOK_FOLD_MAX_WIDTH_PX = 956;

/**
 * Whether a Table of this rendered width folds its Look column into the Action cell.
 *
 * An unmeasured width does not fold. Before the first measurement the width is zero, and folding on
 * that would render the folded form and immediately unfold it on almost every desktop window.
 */
export const tableFoldsLook = (columnWidthPixels: number): boolean =>
  Number.isFinite(columnWidthPixels) && columnWidthPixels > 0 && columnWidthPixels <= TABLE_LOOK_FOLD_MAX_WIDTH_PX;
