/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { createContext, useContext } from 'react';

import type { StudioLayoutMode } from '../PhaseShell/useStudioLayoutMode';

/**
 * The one measured Studio layout, shared.
 *
 * Studio deliberately measures its own container rather than the viewport, and deliberately does it
 * **once** — a second ResizeObserver on a nested element is not just waste, it can disagree with
 * the first while both are live. The shell owns the measurement; everything below reads it here.
 */
export const StudioLayoutContext = createContext<StudioLayoutMode | null>(null);

export const useStudioLayoutContext = (fallback: StudioLayoutMode): StudioLayoutMode =>
  useContext(StudioLayoutContext) ?? fallback;
