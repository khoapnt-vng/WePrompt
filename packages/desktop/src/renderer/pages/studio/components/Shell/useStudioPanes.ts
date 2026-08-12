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
  /** What the pane should actually render as, once width and any transient reveal are applied. */
  directorEffective: StudioPaneState;
  setDirectorPreference: (value: StudioPaneState) => void;
  /**
   * Show the pane for now without recording it as a choice.
   *
   * For controls outside the pane — "Suggest a visual" and friends — that need the Director on
   * screen to do their job. Nothing is written to storage, so a collapse the user made from the
   * toggle still applies the next time Studio opens.
   */
  revealDirectorTransiently: () => void;
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
 *
 * A reveal asked for by a control in the work panel is the same kind of thing, and gets the same
 * treatment through `revealDirectorTransiently`: it overrides a collapsed preference for the
 * effective state and writes nothing. Only the shell's own toggle records intent. Width is the one
 * override a reveal cannot beat — below `inline` there is nowhere for the pane to go, so the shell
 * opens the overlay instead.
 */
export const useStudioPanes = (layoutMode: StudioLayoutMode): StudioPanesResult => {
  const [directorPreference, setDirectorPreferenceState] = useState<StudioPaneState>(() =>
    readPersistedDirectorCollapsed() ? 'collapsed' : 'expanded'
  );
  const [transientlyRevealed, setTransientlyRevealed] = useState(false);

  const setDirectorPreference = useCallback((value: StudioPaneState): void => {
    persistDirectorCollapsed(value === 'collapsed');
    setDirectorPreferenceState(value);
    // An explicit choice supersedes the override, or the toggle could not shut a revealed pane.
    setTransientlyRevealed(false);
  }, []);

  const revealDirectorTransiently = useCallback((): void => setTransientlyRevealed(true), []);

  const widthForcesCollapse = layoutMode !== 'inline';
  const prefersCollapsed = directorPreference === 'collapsed' && !transientlyRevealed;
  const directorEffective: StudioPaneState = widthForcesCollapse || prefersCollapsed ? 'collapsed' : 'expanded';

  return { directorPreference, directorEffective, setDirectorPreference, revealDirectorTransiently };
};
