/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Drawer, Tooltip } from '@arco-design/web-react';
import { Left, Right } from '@icon-park/react';
import React from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import { useStudioLayoutMode } from '../PhaseShell/useStudioLayoutMode';
import { StudioDirectorRevealProvider } from './StudioDirectorRevealContext';
import { StudioLayoutContext } from './StudioLayoutContext';
import styles from './StudioShell.module.css';
import { useStudioPanes } from './useStudioPanes';

export type StudioShellProps = {
  /** The Director conversation. Rendered once here, never per phase. */
  director: React.ReactNode;
  projectId: string;
  children: React.ReactNode;
};

/**
 * Studio's two-pane frame.
 *
 * The side menu is not included: it belongs to the application layout outside this page, so Studio
 * owns the Director pane and the work panel only.
 *
 * The Director is mounted **once, here**, rather than per phase. That is what makes a phase change
 * unable to tear down a streaming reply — there is one mount and it never unmounts, so the
 * multi-mount hazard the A15 smoke was written for does not arise. Collapsing does not unmount it
 * (see the CSS), and neither does changing presentation: the conversation lives in a host element
 * this component owns, which is moved between the inline pane and the overlay (see `directorHost`).
 *
 * Below `inline` the pane cannot sit beside the work panel, so it opens as an overlay instead.
 * Opening and closing that overlay is a UI action and deliberately does not touch the persisted
 * preference — and it belongs to that presentation, so leaving overlay mode clears it.
 */
export const StudioShell: React.FC<StudioShellProps> = ({ director, projectId, children }) => {
  const { t } = useTranslation();
  // Measured here rather than by the page: the page early-returns loading and error states, so a
  // ref attached out there is still null when the layout effect first runs, and the mode sticks at
  // its `compact` default forever. The shell's own root always exists whenever the shell renders.
  const { containerRef, layoutMode } = useStudioLayoutMode(projectId);
  const { directorEffective, setDirectorPreference } = useStudioPanes(layoutMode);
  const [directorOverlayOpen, setDirectorOverlayOpen] = React.useState(false);
  const overlays = layoutMode !== 'inline';
  const collapsed = directorEffective === 'collapsed';
  /** Whether the Director is on screen right now — the one thing the toggle talks about. */
  const directorShown = overlays ? directorOverlayOpen : !collapsed;
  const label = directorShown
    ? t('conversation.creativeStudio.shell.hideDirector')
    : t('conversation.creativeStudio.shell.showDirector');
  const toggleRef = React.useRef<HTMLButtonElement>(null);

  /**
   * The Director's one home in the DOM.
   *
   * Inline and overlay are two *presentations* of the same conversation, but they are different
   * elements — an `<aside>` beside the work panel and Arco's `Drawer`. Rendering `{director}` into
   * whichever one is current would put two element types in one child slot, so React would tear the
   * subtree down and rebuild it on every crossing of the 1120px boundary: the composer text goes,
   * and a reply streaming into the chat is re-created mid-stream. Instead the conversation is
   * portalled into this host, which is created once and never replaced, and only the *host* moves
   * between the two slots. React's tree is unchanged by the move, so the mount survives.
   */
  const [directorHost] = React.useState(() => {
    const host = document.createElement('div');
    host.className = styles.directorHost;
    host.dataset.studioDirectorHost = 'true';
    return host;
  });
  const [inlineSlot, setInlineSlot] = React.useState<HTMLElement | null>(null);
  const [overlaySlot, setOverlaySlot] = React.useState<HTMLElement | null>(null);

  // Where the caret was inside the Director. Read from a listener rather than from
  // `document.activeElement` at move time, because by then the browser has already dropped focus:
  // the drawer's DOM is removed in the same commit's mutation phase, before any layout effect runs.
  const directorFocusRef = React.useRef<HTMLElement | null>(null);
  React.useEffect(() => {
    const trackDirectorFocus = (event: FocusEvent): void => {
      const target = event.target;
      directorFocusRef.current = target instanceof HTMLElement && directorHost.contains(target) ? target : null;
    };
    document.addEventListener('focusin', trackDirectorFocus, true);
    return () => document.removeEventListener('focusin', trackDirectorFocus, true);
  }, [directorHost]);

  React.useLayoutEffect(() => {
    const target = overlays ? overlaySlot : inlineSlot;
    if (target === null || directorHost.parentNode === target) return;
    target.appendChild(directorHost);
    // Re-parenting detaches the subtree for an instant and focus goes to `<body>` with it. Put it
    // back where the user left it: AssistantDock already treats a presentation flip as something
    // that must not cost the keyboard user their place. Only recover focus that was actually
    // dropped — if it has since moved somewhere else on purpose, leave it there.
    const stranded = directorFocusRef.current;
    const active = document.activeElement;
    if (stranded !== null && directorHost.contains(stranded) && (active === null || active === document.body)) {
      stranded.focus();
    }
  }, [directorHost, inlineSlot, overlaySlot, overlays]);

  // Opening the overlay belongs to the narrow presentation, not to the project. Leaving overlay
  // mode has to clear it, or narrowing the window again re-opens a masked 352px panel over the work
  // panel that the user never asked for.
  React.useEffect(() => {
    if (!overlays && directorOverlayOpen) setDirectorOverlayOpen(false);
  }, [directorOverlayOpen, overlays]);

  // Whenever the Director stops being shown, focus that was inside it has nowhere to go: Arco hides
  // the drawer wrapper with `display: none` on the same render, and the collapsed pane is
  // `visibility: hidden`. react-focus-lock does not return focus (`returnFocus` defaults to false
  // and Arco never passes it), so the toggle — the control that can bring the pane back — takes it.
  const directorShownRef = React.useRef(directorShown);
  React.useLayoutEffect(() => {
    const wasShown = directorShownRef.current;
    directorShownRef.current = directorShown;
    if (!wasShown || directorShown) return;
    const active = document.activeElement;
    // Only recover focus that was actually stranded. Anything else the user is looking at — the
    // phase heading StudioPhaseShell focuses after a transition, say — keeps it.
    if (active === null || active === document.body || directorHost.contains(active)) toggleRef.current?.focus();
  }, [directorHost, directorShown]);

  /**
   * Put the Director on screen, whichever way it is currently presented.
   *
   * The two presentations are revealed by two different pieces of state, and conflating them is a
   * real hazard rather than a tidiness point. Below inline width the pane is an overlay: opening it
   * belongs to that presentation, so this must NOT write the stored preference — doing so would
   * overwrite a collapse the user chose at full width with a decision they never made. At inline
   * width the opposite holds: the user asked to see the pane, so that *is* their preference and it
   * persists, exactly as the toggle's own expand does.
   */
  const revealDirector = React.useCallback((): void => {
    if (overlays) setDirectorOverlayOpen(true);
    else setDirectorPreference('expanded');
  }, [overlays, setDirectorPreference]);

  const toggle = (
    <Tooltip content={label}>
      <Button
        ref={toggleRef}
        type='text'
        size='small'
        aria-label={label}
        aria-expanded={directorShown}
        className={styles.paneToggle}
        icon={directorShown ? <Left aria-hidden='true' /> : <Right aria-hidden='true' />}
        onClick={() =>
          overlays
            ? setDirectorOverlayOpen(!directorOverlayOpen)
            : setDirectorPreference(collapsed ? 'expanded' : 'collapsed')
        }
      />
    </Tooltip>
  );

  return (
    <StudioLayoutContext.Provider value={layoutMode}>
      <div
        ref={containerRef}
        data-studio-layout-root
        data-studio-shell
        data-layout={layoutMode}
        className={styles.shell}
      >
        {createPortal(director, directorHost)}
        <aside
          ref={setInlineSlot}
          data-studio-director-pane
          data-collapsed={collapsed ? 'true' : 'false'}
          aria-hidden={collapsed ? 'true' : undefined}
          className={`${styles.directorPane} ${collapsed ? styles.directorPaneCollapsed : ''}`}
        />
        {overlays && (
          // `mountOnEnter={false}` and `unmountOnExit={false}` are load-bearing, not defaults.
          // Arco's Drawer otherwise defers rendering its children until first open and removes them
          // again on close, so the slot the Director is parked in would come and go and a reply
          // streaming into a shut overlay would have nowhere to live. Note AssistantDock does pass
          // `unmountOnExit`, so it is not a precedent for keeping children alive.
          <Drawer
            visible={directorOverlayOpen}
            placement='left'
            width={352}
            footer={null}
            title={null}
            maskClosable
            mountOnEnter={false}
            unmountOnExit={false}
            onCancel={() => setDirectorOverlayOpen(false)}
          >
            <div ref={setOverlaySlot} className={styles.overlayBody} />
          </Drawer>
        )}
        <div className={styles.workPanel} data-studio-work-panel>
          {toggle}
          <StudioDirectorRevealProvider reveal={revealDirector}>{children}</StudioDirectorRevealProvider>
        </div>
      </div>
    </StudioLayoutContext.Provider>
  );
};
