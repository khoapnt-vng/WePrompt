/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useState } from 'react';

import type { StudioLayoutMode } from '../PhaseShell/useStudioLayoutMode';

export type StudioPaneState = 'expanded' | 'collapsed';

export const STUDIO_DIRECTOR_COLLAPSED_STORAGE_KEY = 'studio.directorPane.collapsed';

/** Reads the persisted Director pane preference; treats unreadable storage as expanded. */
export const readPersistedDirectorCollapsed = (): boolean => {
  try {
    return localStorage.getItem(STUDIO_DIRECTOR_COLLAPSED_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
};

/** Persists the Director pane preference; silently ignores storage failures (e.g. private mode). */
export const persistDirectorCollapsed = (value: boolean): void => {
  try {
    localStorage.setItem(STUDIO_DIRECTOR_COLLAPSED_STORAGE_KEY, value ? '1' : '0');
  } catch {
    // ignore persistence errors
  }
};

export type StudioPanesResult = {
  /** What the user last chose. Only an explicit toggle changes this, and it is what persists. */
  directorPreference: StudioPaneState;
  /** What the pane should actually render as, once the available width is taken into account. */
  directorEffective: StudioPaneState;
  setDirectorPreference: (value: StudioPaneState) => void;
};

/**
 * Collapse state for the Studio panes.
 *
 * Preference and effective state are deliberately two values rather than one. Width-driven
 * collapse is a *presentation* override, not a change of intent: if narrowing the window wrote
 * `collapsed` into storage, widening it again would leave the pane shut and the user's choice
 * would be silently destroyed — worse than offering no control at all.
 *
 * This follows the app sidebar, which already draws the same distinction (`Layout.tsx`: explicit
 * toggles persist, "auto force-collapse paths … are intentionally NOT persisted, so narrowing the
 * window never writes a collapsed preference"). Breakpoints are not re-invented here either — the
 * caller passes `useStudioLayoutMode`'s shipped `inline` / `drawer` / `compact`.
 *
 * Below `inline` the pane cannot sit alongside the work panel, so it renders collapsed and opens
 * as an overlay on demand. That transient opening is a UI action, not a preference, and must not
 * call `setDirectorPreference`.
 */
export const useStudioPanes = (layoutMode: StudioLayoutMode): StudioPanesResult => {
  const [directorPreference, setDirectorPreferenceState] = useState<StudioPaneState>(() =>
    readPersistedDirectorCollapsed() ? 'collapsed' : 'expanded'
  );

  const setDirectorPreference = useCallback((value: StudioPaneState): void => {
    persistDirectorCollapsed(value === 'collapsed');
    setDirectorPreferenceState(value);
  }, []);

  const widthForcesCollapse = layoutMode !== 'inline';
  const directorEffective: StudioPaneState =
    widthForcesCollapse || directorPreference === 'collapsed' ? 'collapsed' : 'expanded';

  return { directorPreference, directorEffective, setDirectorPreference };
};
