/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { createContext, useContext } from 'react';

/**
 * Bringing the Director on screen, offered to the work panel.
 *
 * The pane is "always on" by design, but it is not always *visible*: the user can collapse it at
 * any width, and below the inline breakpoint it is an overlay that starts shut. Nothing inside the
 * work panel can open either one — both live in the shell — so a phase that wants to hand work to
 * the Director could previously only aim focus at it and hope, which is a silent no-op whenever the
 * pane happens to be hidden.
 *
 * Revealing is deliberately the *whole* contract. Focus is left to the caller: what should take the
 * caret depends on what the conversation is doing, and the shell has no business deciding that.
 */
const StudioDirectorRevealContext = createContext<(() => void) | null>(null);

export const StudioDirectorRevealProvider: React.FC<{
  reveal: () => void;
  children: React.ReactNode;
}> = ({ reveal, children }) => (
  <StudioDirectorRevealContext.Provider value={reveal}>{children}</StudioDirectorRevealContext.Provider>
);

const NO_SHELL = (): void => {};

/**
 * Falls back to doing nothing outside the shell rather than throwing.
 *
 * A phase rendered on its own — which is how most of them are unit-tested — has no pane to reveal,
 * and a hard error there would say nothing true about the app. It warns in development so a
 * forgotten provider in real code is not silent, and any test that asserts the reveal has to mount
 * the real shell for the assertion to mean anything.
 */
export const useRevealDirector = (): (() => void) => {
  const reveal = useContext(StudioDirectorRevealContext);
  if (reveal === null) {
    if (process.env.NODE_ENV === 'development') {
      // eslint-disable-next-line no-console
      console.warn('Studio: no StudioShell above this component; the Director cannot be revealed.');
    }
    return NO_SHELL;
  }
  return reveal;
};
