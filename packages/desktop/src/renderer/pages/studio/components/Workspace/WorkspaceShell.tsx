/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button } from '@arco-design/web-react';
import React, { useCallback, useEffect, useId, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import type { StudioRendererProjectV2 } from '@/common/types/project/creativeStudioTypes';
import SidebarIcon from '@/renderer/components/base/SidebarIcon';
import { STUDIO_VIEWS, studioViewPath, type StudioView } from '@/renderer/pages/studio/studioPhaseRoute';
import { DirectorRail, type DirectorProposalChatIntent } from './DirectorRail';
import styles from './Workspace.module.css';
import type { StudioBarStats } from './workspaceProjection';

export type WorkspaceShellProps = {
  project: StudioRendererProjectV2;
  activeView: StudioView;
  stats?: StudioBarStats;
  reviewedOutput?: React.ReactNode;
  onDirectorProposalIntent?: (intent: DirectorProposalChatIntent) => Promise<void>;
  /** The bar's primary action. It spends money, so it is the control that never leaves the bar. */
  renderAction?: React.ReactNode;
  notice?: React.ReactNode;
  projectMenu?: React.ReactNode;
  children: React.ReactNode;
};

export type WorkspaceShellHandle = {
  /** Opens and focuses the Director without changing the person's persisted collapse choice. */
  revealDirector: (expectedScope: { projectId: string; view: StudioView }) => boolean;
};

type DirectorFocusRequest = {
  id: number;
  scopeKey: string;
};

/** The rail's drawn width, and the range a person may drag it through. */
export const RAIL_WIDTH_DEFAULT_PX = 431;
export const RAIL_WIDTH_MIN_PX = 280;
export const RAIL_WIDTH_MAX_PX = 720;
export const RAIL_WIDTH_STEP_PX = 16;

const RAIL_WIDTH_STORAGE_KEY = 'aionui.studio.railWidth';

/**
 * A stored preference is untrusted input — it outlives releases and can be edited by hand — so an
 * unusable width falls back to the drawn one rather than to zero.
 */
export const clampRailWidth = (width: number): number => {
  if (!Number.isFinite(width)) return RAIL_WIDTH_DEFAULT_PX;
  return Math.round(Math.min(RAIL_WIDTH_MAX_PX, Math.max(RAIL_WIDTH_MIN_PX, width)));
};

/** The width a key produces, or null when the key is not one this handle answers to. */
export const railWidthFromKey = (current: number, key: string): number | null => {
  switch (key) {
    case 'ArrowRight':
      return clampRailWidth(current + RAIL_WIDTH_STEP_PX);
    case 'ArrowLeft':
      return clampRailWidth(current - RAIL_WIDTH_STEP_PX);
    case 'Home':
      return RAIL_WIDTH_MIN_PX;
    case 'End':
      return RAIL_WIDTH_MAX_PX;
    case 'Enter':
      return RAIL_WIDTH_DEFAULT_PX;
    default:
      return null;
  }
};

const readStoredRailWidth = (): number => {
  try {
    const stored = window.localStorage.getItem(RAIL_WIDTH_STORAGE_KEY);
    return stored === null ? RAIL_WIDTH_DEFAULT_PX : clampRailWidth(Number.parseFloat(stored));
  } catch {
    return RAIL_WIDTH_DEFAULT_PX;
  }
};

const storeRailWidth = (width: number): void => {
  try {
    window.localStorage.setItem(RAIL_WIDTH_STORAGE_KEY, String(width));
  } catch {
    // A preference that cannot be stored is not worth failing the workspace over.
  }
};

/**
 * Where the Director is useful, per the division of labour: it acts before the picture exists and the
 * human decides after it does. References and the Table are pre-picture views and the rail opens
 * there; the Board and the Cut are judgements about pixels and motion the Director cannot see, so it
 * starts shut.
 */
export const railCollapsedDefaultForView = (view: StudioView): boolean => view === 'board' || view === 'cut';

/** One view of one project. Ids are opaque and may contain the separator, so the id is length-tagged. */
export const railPreferenceKey = (projectId: string, view: StudioView): string =>
  `aionui.studio.railCollapsed.${projectId.length}.${projectId}.${view}`;

/**
 * A choice outranks the default from then on, in both directions. This is what stops the default from
 * re-opening a rail somebody shut — the named failure mode.
 */
export const railCollapsedForView = (view: StudioView, stored: boolean | null): boolean =>
  stored ?? railCollapsedDefaultForView(view);

const readStoredRailCollapsed = (projectId: string, view: StudioView): boolean | null => {
  try {
    const stored = window.localStorage.getItem(railPreferenceKey(projectId, view));
    return stored === 'true' ? true : stored === 'false' ? false : null;
  } catch {
    return null;
  }
};

const storeRailCollapsed = (projectId: string, view: StudioView, collapsed: boolean): void => {
  try {
    window.localStorage.setItem(railPreferenceKey(projectId, view), String(collapsed));
  } catch {
    // A preference that cannot be stored is not worth failing the workspace over.
  }
};

const clock = (seconds: number | null | undefined): string | null => {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return null;
  const whole = Math.round(seconds);
  const minutes = Math.floor(whole / 60);
  return `${minutes}:${String(whole - minutes * 60).padStart(2, '0')}`;
};

/**
 * The Studio project frame. The app bar heads the project and both panes sit under it: everything it
 * carries is film-scoped, and it must not reassemble itself when the Director rail is toggled. The
 * rail therefore has no header of its own and its collapse control is the leftmost thing in the bar.
 */
export const WorkspaceShell = React.forwardRef<WorkspaceShellHandle, WorkspaceShellProps>(function WorkspaceShell(
  { project, activeView, stats, reviewedOutput, onDirectorProposalIntent, renderAction, notice, projectMenu, children },
  ref
) {
  const { t } = useTranslation();
  const viewHeadingId = `studio-${activeView}-heading`;
  const railContentId = useId();
  const railScopeKey = railPreferenceKey(project.id, activeView);
  const [railCollapsed, setRailCollapsed] = useState(() =>
    railCollapsedForView(activeView, readStoredRailCollapsed(project.id, activeView))
  );

  const railToggleRef = useRef<HTMLButtonElement | null>(null);
  const nextDirectorFocusRequestId = useRef(0);
  const [directorFocusRequest, setDirectorFocusRequest] = useState<DirectorFocusRequest | null>(null);

  // Reset before paint so one view never displays another view's choice. When a navigation leaves
  // focus inside a rail that starts collapsed, return focus to the control that can reveal it.
  useLayoutEffect(() => {
    setDirectorFocusRequest(null);
    const next = railCollapsedForView(activeView, readStoredRailCollapsed(project.id, activeView));
    const content = document.getElementById(railContentId);
    if (next && content?.contains(document.activeElement)) railToggleRef.current?.focus();
    setRailCollapsed(next);
  }, [activeView, project.id, railContentId]);

  const toggleRail = useCallback((): void => {
    setDirectorFocusRequest(null);
    const next = !railCollapsed;
    storeRailCollapsed(project.id, activeView, next);
    setRailCollapsed(next);
  }, [activeView, project.id, railCollapsed]);

  const revealDirector = useCallback(
    (expectedScope: { projectId: string; view: StudioView }): boolean => {
      if (expectedScope.projectId !== project.id || expectedScope.view !== activeView) return false;
      setRailCollapsed(false);
      nextDirectorFocusRequestId.current += 1;
      setDirectorFocusRequest({ id: nextDirectorFocusRequestId.current, scopeKey: railScopeKey });
      return true;
    },
    [activeView, project.id, railScopeKey]
  );

  useImperativeHandle(ref, () => ({ revealDirector }), [revealDirector]);

  useLayoutEffect(() => {
    if (railCollapsed || directorFocusRequest?.scopeKey !== railScopeKey) return;
    railToggleRef.current?.focus();
  }, [directorFocusRequest, railCollapsed, railScopeKey]);
  const [railWidth, setRailWidth] = useState(readStoredRailWidth);
  const dragRef = useRef<{ pointerId: number; startX: number; startWidth: number } | null>(null);
  const railRef = useRef<HTMLDivElement | null>(null);

  const applyRailWidth = useCallback((width: number): void => {
    const clamped = clampRailWidth(width);
    setRailWidth(clamped);
    storeRailWidth(clamped);
  }, []);

  useEffect(() => {
    if (!railCollapsed) return;
    dragRef.current = null;
  }, [railCollapsed]);

  const toggleLabel = t(
    railCollapsed
      ? 'conversation.creativeStudio.workspace.director.show'
      : 'conversation.creativeStudio.workspace.director.hide'
  );
  const filmClock = clock(stats?.filmSeconds);
  const targetClock = clock(stats?.targetSeconds);

  return (
    <div className={styles.shell} data-studio-workspace-shell>
      <header className={styles.appBar} data-studio-app-bar data-studio-project-header>
        <Button
          ref={(node) => {
            railToggleRef.current = node instanceof HTMLButtonElement ? node : null;
          }}
          type='text'
          shape='circle'
          icon={<SidebarIcon />}
          className={styles.railToggle}
          data-studio-director-toggle
          aria-controls={railContentId}
          aria-expanded={!railCollapsed}
          aria-label={toggleLabel}
          title={toggleLabel}
          onClick={toggleRail}
        />
        <span className={styles.projectDot} aria-hidden='true' />
        <h1 className={styles.projectTitle} title={project.name}>
          <bdi dir='auto'>{project.name}</bdi>
        </h1>
        <span className={styles.statStrip} data-studio-bar-stats>
          <bdi dir='auto'>
            {t('conversation.creativeStudio.workspace.project.structure', {
              beats: stats?.beatCount ?? project.beatOrder.length,
              shots: stats?.shotCount ?? Object.keys(project.shots).length,
            })}
          </bdi>
          {filmClock === null || targetClock === null ? null : (
            <bdi dir='auto' data-studio-bar-clock>
              {t('conversation.creativeStudio.workspace.project.against', {
                film: filmClock,
                target: targetClock,
              })}
            </bdi>
          )}
          {stats === undefined ? null : (
            <bdi dir='auto' data-studio-bar-ready>
              {t('conversation.creativeStudio.workspace.project.ready', { count: stats.readyCount })}
            </bdi>
          )}
        </span>
        <span className={styles.barSpacer} />
        <nav
          aria-label={t('conversation.creativeStudio.workspace.views.title')}
          className={styles.viewNavigation}
          data-studio-view-navigation
        >
          {STUDIO_VIEWS.map((view) => (
            <Link
              key={view}
              aria-current={view === activeView ? 'page' : undefined}
              className={view === activeView ? styles.viewLinkActive : styles.viewLink}
              to={studioViewPath(project.id, view)}
            >
              {t(`conversation.creativeStudio.workspace.views.${view}`)}
            </Link>
          ))}
        </nav>
        {renderAction === undefined ? null : <span className={styles.barAction}>{renderAction}</span>}
        {projectMenu}
      </header>
      <div className={styles.panes} data-studio-panes>
        <DirectorRail
          project={project}
          reviewedOutput={reviewedOutput}
          onProposalIntent={onDirectorProposalIntent}
          collapsed={railCollapsed}
          contentId={railContentId}
          widthPixels={railWidth}
        />
        {railCollapsed ? null : (
          <div
            ref={railRef}
            className={styles.railResizer}
            data-studio-rail-resizer
            role='separator'
            tabIndex={0}
            aria-orientation='vertical'
            aria-controls={railContentId}
            aria-label={t('conversation.creativeStudio.workspace.director.resize')}
            aria-valuenow={railWidth}
            aria-valuemin={RAIL_WIDTH_MIN_PX}
            aria-valuemax={RAIL_WIDTH_MAX_PX}
            onPointerDown={(event) => {
              dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startWidth: railWidth };
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              const drag = dragRef.current;
              if (drag === null || drag.pointerId !== event.pointerId) return;
              // Right-to-left grows the pane in the opposite physical direction.
              const direction = getComputedStyle(event.currentTarget).direction === 'rtl' ? -1 : 1;
              applyRailWidth(drag.startWidth + (event.clientX - drag.startX) * direction);
            }}
            onPointerUp={(event) => {
              dragRef.current = null;
              if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                event.currentTarget.releasePointerCapture(event.pointerId);
              }
            }}
            onDoubleClick={() => applyRailWidth(RAIL_WIDTH_DEFAULT_PX)}
            onKeyDown={(event) => {
              const next = railWidthFromKey(railWidth, event.key);
              if (next === null) return;
              event.preventDefault();
              applyRailWidth(next);
            }}
          />
        )}
        <div className={styles.workPanel} data-studio-work-panel>
          <div className={styles.workScroll} data-studio-work-scroll>
            {notice === undefined ? null : (
              <div role='alert' className={styles.projectAlert}>
                {notice}
              </div>
            )}
            <main aria-labelledby={viewHeadingId} className={styles.viewSurface} data-studio-view={activeView}>
              <h2 id={viewHeadingId}>{t(`conversation.creativeStudio.workspace.views.${activeView}`)}</h2>
              {children}
            </main>
          </div>
        </div>
      </div>
    </div>
  );
});
