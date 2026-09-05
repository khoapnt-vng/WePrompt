/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Badge, Button, Input, Tooltip } from '@arco-design/web-react';
import React, { useCallback, useEffect, useId, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import type { StudioRendererProjectV2 } from '@/common/types/project/creativeStudioTypes';
import SidebarIcon from '@/renderer/components/base/SidebarIcon';
import { STUDIO_VIEWS, studioViewPath, type StudioView } from '@/renderer/pages/studio/studioPhaseRoute';
import { DirectorRail, type DirectorProposalChatIntent } from './DirectorRail';
import type { WorkspaceProjectEditAuthority } from './Views/viewTypes';
import styles from './Workspace.module.css';
import type {
  StudioBarStats,
  StudioWorkspaceNextActionKind,
  StudioWorkspaceProgress,
  StudioWorkspaceViewProgress,
} from './workspaceProjection';

export type WorkspaceShellProps = {
  project: StudioRendererProjectV2;
  activeView: StudioView;
  workspaceProgress?: StudioWorkspaceProgress | null;
  nextActionText?: string | null;
  nextActionLabel?: string | null;
  nextActionKind?: StudioWorkspaceNextActionKind | null;
  nextActionView?: StudioView | null;
  onOpenFilmSetup?: () => void;
  stats?: StudioBarStats;
  reviewedOutputs?: readonly WorkspaceReviewedOutput[];
  onDirectorProposalIntent?: (intent: DirectorProposalChatIntent) => Promise<void>;
  directorDraftRequest?: WorkspaceDirectorDraftRequest | null;
  onDirectorDraftRequestConsumed?: (requestId: number) => void;
  directorPendingProposalCount?: number;
  directorPendingProposalIds?: readonly string[];
  directorProposalTargetId?: string;
  /** The bar's primary action. It spends money, so it is the control that never leaves the bar. */
  renderAction?: React.ReactNode;
  /** Owner-only, revision-checked rename. The Director still has no edit_project disposition. */
  onRenameProject?: (name: string, authority: WorkspaceProjectEditAuthority) => Promise<boolean>;
  renamePending?: boolean;
  notice?: React.ReactNode;
  projectMenu?: React.ReactNode;
  children: React.ReactNode;
};

const MAX_PROJECT_NAME_CHARS = 256;

export type WorkspaceProjectTitleProps = {
  projectId: string;
  projectRevision: number;
  name: string;
  pending: boolean;
  onRename?: (name: string, authority: WorkspaceProjectEditAuthority) => Promise<boolean>;
};

/** Cheap owner rename, using the same click/Enter/blur and Escape gesture as a chat title. */
export const WorkspaceProjectTitle: React.FC<WorkspaceProjectTitleProps> = ({
  projectId,
  projectRevision,
  name,
  pending,
  onRename,
}) => {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const [committing, setCommitting] = useState(false);
  const commitPendingRef = useRef(false);
  const cancelledRef = useRef(false);
  const editAuthorityRef = useRef<(WorkspaceProjectEditAuthority & { name: string }) | null>(null);
  const invalid = draft.trim().length === 0 || draft.length > MAX_PROJECT_NAME_CHARS;

  useEffect(() => {
    setEditing(false);
    setDraft(name);
    setCommitting(false);
    commitPendingRef.current = false;
    cancelledRef.current = false;
    editAuthorityRef.current = null;
  }, [projectId]);

  useEffect(() => {
    if (!editing) setDraft(name);
  }, [editing, name]);

  useEffect(() => {
    const authority = editAuthorityRef.current;
    if (
      !editing ||
      committing ||
      authority === null ||
      (authority.projectId === projectId && authority.expectedRevision === projectRevision && authority.name === name)
    ) {
      return;
    }
    cancelledRef.current = true;
    editAuthorityRef.current = null;
    setDraft(name);
    setEditing(false);
  }, [committing, editing, name, projectId, projectRevision]);

  const begin = (): void => {
    if (onRename === undefined || pending || committing) return;
    cancelledRef.current = false;
    editAuthorityRef.current = { projectId, expectedRevision: projectRevision, name };
    setDraft(name);
    setEditing(true);
  };

  const commit = async (): Promise<void> => {
    if (onRename === undefined || pending || committing || invalid || commitPendingRef.current) return;
    const authority = editAuthorityRef.current;
    if (
      authority === null ||
      authority.projectId !== projectId ||
      authority.expectedRevision !== projectRevision ||
      authority.name !== name
    ) {
      cancelledRef.current = true;
      editAuthorityRef.current = null;
      setDraft(name);
      setEditing(false);
      return;
    }
    const nextName = draft.trim();
    if (nextName === name) {
      editAuthorityRef.current = null;
      setDraft(name);
      setEditing(false);
      return;
    }
    commitPendingRef.current = true;
    setCommitting(true);
    try {
      if (
        await onRename(nextName, {
          projectId: authority.projectId,
          expectedRevision: authority.expectedRevision,
        })
      ) {
        editAuthorityRef.current = null;
        setEditing(false);
      }
    } finally {
      commitPendingRef.current = false;
      setCommitting(false);
    }
  };

  const renameLabel = t('conversation.creativeStudio.phase.shared.renameProject');
  return (
    <h1 aria-label={name} className={styles.projectTitle} title={name}>
      {editing ? (
        <span className={styles.projectTitleEditor}>
          <Input
            autoFocus
            aria-describedby={invalid ? 'studio-project-name-error' : undefined}
            aria-label={renameLabel}
            className={styles.projectTitleInput}
            disabled={pending || committing}
            error={invalid}
            maxLength={MAX_PROJECT_NAME_CHARS}
            value={draft}
            onBlur={() => {
              if (cancelledRef.current) {
                cancelledRef.current = false;
                return;
              }
              if (invalid) {
                editAuthorityRef.current = null;
                setDraft(name);
                setEditing(false);
                return;
              }
              void commit();
            }}
            onChange={setDraft}
            onFocus={(event) => event.target.select()}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void commit();
                return;
              }
              if (event.key === 'Escape') {
                cancelledRef.current = true;
                editAuthorityRef.current = null;
                setDraft(name);
                setEditing(false);
              }
            }}
          />
          {invalid ? (
            <span className={styles.projectTitleError} id='studio-project-name-error' role='alert'>
              {t('conversation.creativeStudio.phase.shared.invalidProjectName')}
            </span>
          ) : null}
        </span>
      ) : onRename === undefined ? (
        <bdi className={styles.projectTitleText} dir='auto'>
          {name}
        </bdi>
      ) : (
        <Tooltip content={renameLabel}>
          <Button
            aria-label={`${renameLabel}: ${name}`}
            className={styles.projectTitleButton}
            disabled={pending}
            type='text'
            onClick={begin}
          >
            <bdi className={styles.projectTitleText} dir='auto'>
              {name}
            </bdi>
          </Button>
        </Tooltip>
      )}
    </h1>
  );
};

export type WorkspaceReviewedOutput = { id: string; content: React.ReactNode; createdAt: number };

export type WorkspaceDirectorDraftRequest = {
  requestId: number;
  projectId: string;
  prompt: string;
  /** Exact proposal authority carried privately; never interpolate it into the visible prompt. */
  proposalTargetId: string | null;
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
export const RAIL_RESIZER_WIDTH_PX = 8;
export const WORK_PANEL_MIN_WIDTH_PX = 320;

const RAIL_WIDTH_STORAGE_KEY = 'aionui.studio.railWidth';

/** The drawer is required when a split cannot show the chosen rail and a usable work surface. */
export const directorRailNeedsOverlay = (availableWidth: number, railWidth: number): boolean =>
  Number.isFinite(availableWidth) &&
  availableWidth > 0 &&
  availableWidth < railWidth + RAIL_RESIZER_WIDTH_PX + WORK_PANEL_MIN_WIDTH_PX;

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
 * Pre-picture work opens with the Director. Pixel- and motion-review views stay unobstructed by
 * default, especially when the rail becomes a compact overlay; the persistent handoff card remains
 * visible and an explicit per-view preference still wins in either direction.
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
  {
    project,
    activeView,
    workspaceProgress = null,
    nextActionText = null,
    nextActionLabel = null,
    nextActionKind = null,
    nextActionView = null,
    onOpenFilmSetup,
    stats,
    reviewedOutputs,
    onDirectorProposalIntent,
    directorDraftRequest,
    onDirectorDraftRequestConsumed,
    directorPendingProposalCount = 0,
    directorPendingProposalIds,
    directorProposalTargetId,
    renderAction,
    onRenameProject,
    renamePending = false,
    notice,
    projectMenu,
    children,
  },
  ref
) {
  const { t } = useTranslation();
  const viewHeadingId = `studio-${activeView}-heading`;
  const railContentId = useId();
  const viewStatusDescriptionPrefix = useId();
  const [railWidth, setRailWidth] = useState(readStoredRailWidth);
  const [compactLayout, setCompactLayout] = useState(false);
  const railScopeKey = railPreferenceKey(project.id, activeView);
  const [railCollapsed, setRailCollapsed] = useState(() =>
    railCollapsedForView(activeView, readStoredRailCollapsed(project.id, activeView))
  );

  const railToggleRef = useRef<HTMLButtonElement | null>(null);
  const panesRef = useRef<HTMLDivElement | null>(null);
  const workPanelRef = useRef<HTMLDivElement | null>(null);
  const railResizerRef = useRef<HTMLDivElement | null>(null);
  const railBackdropRef = useRef<HTMLButtonElement | null>(null);
  const railCollapsedRef = useRef(railCollapsed);
  railCollapsedRef.current = railCollapsed;
  const nextDirectorFocusRequestId = useRef(0);
  const [directorFocusRequest, setDirectorFocusRequest] = useState<DirectorFocusRequest | null>(null);

  useLayoutEffect(() => {
    const panes = panesRef.current;
    if (panes === null) return;
    const update = (availableWidth: number): void => {
      const next = directorRailNeedsOverlay(availableWidth, railWidth);
      const active = document.activeElement;
      const focusWillDisappear = next
        ? !railCollapsedRef.current &&
          (workPanelRef.current?.contains(active) || railResizerRef.current?.contains(active))
        : railBackdropRef.current?.contains(active);
      if (focusWillDisappear) railToggleRef.current?.focus();
      setCompactLayout(next);
    };
    const measure = (): void => update(panes.getBoundingClientRect().width);
    measure();

    if (typeof ResizeObserver === 'function') {
      const observer = new ResizeObserver((entries) => {
        const entry = entries.find(({ target }) => target === panes);
        update(entry?.contentRect.width ?? panes.getBoundingClientRect().width);
      });
      observer.observe(panes);
      return () => observer.disconnect();
    }

    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [railWidth]);

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

  const closeRail = useCallback((): void => {
    // Focus must leave the overlay before its contents become inert and hidden.
    railToggleRef.current?.focus();
    setDirectorFocusRequest(null);
    storeRailCollapsed(project.id, activeView, true);
    setRailCollapsed(true);
  }, [activeView, project.id]);

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
  const compactOverlayOpen = compactLayout && !railCollapsed;

  useLayoutEffect(() => {
    if (!compactOverlayOpen || !workPanelRef.current?.contains(document.activeElement)) return;
    railToggleRef.current?.focus();
  }, [compactOverlayOpen]);

  useEffect(() => {
    if (!compactOverlayOpen) return;
    const dismiss = (event: KeyboardEvent): void => {
      const active = document.activeElement;
      const railContent = document.getElementById(railContentId);
      if (
        event.key !== 'Escape' ||
        event.defaultPrevented ||
        event.isComposing ||
        (active !== railToggleRef.current && !railContent?.contains(active))
      ) {
        return;
      }
      event.preventDefault();
      closeRail();
    };
    window.addEventListener('keydown', dismiss);
    return () => window.removeEventListener('keydown', dismiss);
  }, [closeRail, compactOverlayOpen, railContentId]);

  const dragRef = useRef<{ pointerId: number; startX: number; startWidth: number } | null>(null);

  const applyRailWidth = useCallback((width: number): void => {
    const clamped = clampRailWidth(width);
    setRailWidth(clamped);
    storeRailWidth(clamped);
  }, []);

  useEffect(() => {
    if (!railCollapsed && !compactLayout) return;
    dragRef.current = null;
  }, [compactLayout, railCollapsed]);

  const toggleBaseLabel = t(
    railCollapsed
      ? 'conversation.creativeStudio.workspace.director.show'
      : 'conversation.creativeStudio.workspace.director.hide'
  );
  const toggleLabel =
    directorPendingProposalCount > 0
      ? `${toggleBaseLabel} · ${t('conversation.creativeStudio.workspace.proposals.waitingCount', {
          count: directorPendingProposalCount,
        })}`
      : toggleBaseLabel;
  const filmClock = clock(stats?.filmSeconds);
  const targetClock = clock(stats?.targetSeconds);
  const activeViewProgress = workspaceProgress?.views[activeView] ?? null;
  const viewLabel = (view: StudioView): string => t(`conversation.creativeStudio.workspace.views.${view}`);
  const noContentText = (view: StudioView, progress: StudioWorkspaceViewProgress): string | null => {
    if (view === 'references') {
      return progress.readiness === 'empty'
        ? t('conversation.creativeStudio.workspace.views.guidance.noReferences')
        : null;
    }
    if (view === 'table') {
      return progress.readiness === 'ready'
        ? null
        : t('conversation.creativeStudio.workspace.views.guidance.noStoryboard');
    }
    if (view === 'board' && workspaceProgress !== null) {
      const production = workspaceProgress.production;
      return production.currentVideoCount === 0 && production.currentFrameCount < production.shotCount
        ? t('conversation.creativeStudio.workspace.views.guidance.frameProgress', {
            current: production.currentFrameCount,
            total: production.shotCount,
          })
        : t('conversation.creativeStudio.workspace.views.guidance.videoProgress', {
            current: production.currentVideoCount,
            total: production.shotCount,
          });
    }
    if (progress.currentCount === 0 && progress.totalCount > 0) {
      return t('conversation.creativeStudio.workspace.views.guidance.noTakes', {
        view: viewLabel(view),
        current: progress.currentCount,
        total: progress.totalCount,
      });
    }
    return progress.totalCount === 0 && progress.readiness !== 'ready'
      ? t('conversation.creativeStudio.workspace.views.guidance.noStoryboard')
      : null;
  };
  const activeViewEmptyText = activeViewProgress === null ? null : noContentText(activeView, activeViewProgress);

  return (
    <div className={styles.shell} data-studio-workspace-shell>
      <header className={styles.appBar} data-studio-app-bar data-studio-project-header>
        <Badge
          count={
            railCollapsed && directorPendingProposalCount > 0 ? (
              <span aria-hidden='true' className={styles.pendingDirectorBadge}>
                {directorPendingProposalCount}
              </span>
            ) : (
              0
            )
          }
          data-studio-director-pending-badge={
            railCollapsed && directorPendingProposalCount > 0 ? directorPendingProposalCount : undefined
          }
        >
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
        </Badge>
        <span className={styles.projectDot} aria-hidden='true' />
        <WorkspaceProjectTitle
          projectId={project.id}
          projectRevision={project.revision}
          name={project.name}
          pending={renamePending}
          onRename={onRenameProject}
        />
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
          {stats === undefined ? null : stats.blockerCount === null ? (
            <bdi dir='auto' data-status='unavailable' data-studio-bar-blockers>
              {t('conversation.creativeStudio.workspace.project.statusUnavailable')}
            </bdi>
          ) : (
            <bdi dir='auto' data-status={stats.blockerCount === 0 ? 'clear' : 'blocked'} data-studio-bar-blockers>
              {t('conversation.creativeStudio.workspace.project.blockers', { count: stats.blockerCount })}
            </bdi>
          )}
        </span>
        <span className={styles.barSpacer} />
        <nav
          aria-label={t('conversation.creativeStudio.workspace.views.title')}
          className={styles.viewNavigation}
          data-studio-view-navigation
        >
          {STUDIO_VIEWS.map((view) => {
            const progress = workspaceProgress?.views[view] ?? null;
            const emptyText = progress === null ? null : noContentText(view, progress);
            const description =
              progress === null
                ? null
                : [
                    progress.recommended ? t('conversation.creativeStudio.workspace.views.status.next') : null,
                    emptyText,
                  ]
                    .filter((part): part is string => part !== null)
                    .join(' — ');
            const descriptionId = `${viewStatusDescriptionPrefix}-${view}`;
            return (
              <React.Fragment key={view}>
                <Link
                  aria-current={view === activeView ? 'page' : undefined}
                  aria-describedby={description === null || description.length === 0 ? undefined : descriptionId}
                  className={view === activeView ? styles.viewLinkActive : styles.viewLink}
                  data-studio-view-readiness={progress?.readiness}
                  data-studio-view-recommended={progress?.recommended ? 'true' : undefined}
                  data-studio-view-stage-state={progress?.state}
                  title={
                    description === null || description.length === 0 ? undefined : `${viewLabel(view)} · ${description}`
                  }
                  to={studioViewPath(project.id, view)}
                >
                  {viewLabel(view)}
                  {progress?.recommended ? (
                    <span aria-hidden='true' className={styles.viewLinkNext} data-studio-view-marker='next'>
                      {t('conversation.creativeStudio.workspace.views.status.next')}
                    </span>
                  ) : progress !== null && progress.readiness !== 'ready' ? (
                    <span aria-hidden='true' className={styles.viewLinkDormantMark} data-studio-view-marker='dormant' />
                  ) : null}
                </Link>
                {description === null || description.length === 0 ? null : (
                  <span className={styles.srOnly} id={descriptionId}>
                    {description}
                  </span>
                )}
              </React.Fragment>
            );
          })}
        </nav>
        {renderAction === undefined ? null : <span className={styles.barAction}>{renderAction}</span>}
        {projectMenu}
      </header>
      <div
        ref={panesRef}
        className={`${styles.panes} ${compactLayout ? styles.panesCompact : ''}`}
        data-studio-panes
        data-studio-director-layout={compactLayout ? 'overlay' : 'split'}
      >
        <DirectorRail
          project={project}
          reviewedOutputs={reviewedOutputs}
          pendingProposalCount={directorPendingProposalCount}
          pendingProposalIds={directorPendingProposalIds}
          pendingProposalTargetId={directorProposalTargetId}
          onProposalIntent={onDirectorProposalIntent}
          draftRequest={directorDraftRequest}
          onDraftRequestConsumed={onDirectorDraftRequestConsumed}
          collapsed={railCollapsed}
          contentId={railContentId}
          widthPixels={railWidth}
          overlay={compactLayout}
        />
        {railCollapsed || compactLayout ? null : (
          <div
            ref={railResizerRef}
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
            onPointerCancel={() => {
              dragRef.current = null;
            }}
            onLostPointerCapture={() => {
              dragRef.current = null;
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
        {compactOverlayOpen ? (
          <button
            ref={railBackdropRef}
            type='button'
            aria-controls={railContentId}
            aria-label={toggleBaseLabel}
            className={styles.railBackdrop}
            data-studio-director-backdrop
            onClick={closeRail}
            tabIndex={-1}
          />
        ) : null}
        <div ref={workPanelRef} className={styles.workPanel} data-studio-work-panel inert={compactOverlayOpen}>
          <div className={styles.workScroll} data-studio-work-scroll>
            {notice === undefined ? null : (
              <div role='alert' className={styles.projectAlert}>
                {notice}
              </div>
            )}
            <main aria-labelledby={viewHeadingId} className={styles.viewSurface} data-studio-view={activeView}>
              <h2 className={styles.viewHeading} id={viewHeadingId}>
                {t(`conversation.creativeStudio.workspace.views.${activeView}`)}
              </h2>
              {activeViewEmptyText === null && nextActionText === null ? null : (
                <div
                  className={styles.viewGuidance}
                  data-studio-view-guidance
                  data-studio-view-guidance-view={activeView}
                >
                  {activeViewEmptyText === null ? null : (
                    <p className={styles.viewGuidanceEmpty}>{activeViewEmptyText}</p>
                  )}
                  {nextActionText === null ? null : (
                    <div className={styles.viewGuidanceAction} data-studio-next-action={nextActionKind ?? undefined}>
                      <p className={styles.viewGuidanceNext}>{nextActionText}</p>
                      {nextActionLabel === null ? null : nextActionView === null ? (
                        onOpenFilmSetup === undefined ? null : (
                          <Button size='small' type='primary' onClick={onOpenFilmSetup}>
                            {nextActionLabel}
                          </Button>
                        )
                      ) : nextActionView === activeView ? null : (
                        <Link className={styles.viewGuidanceLink} to={studioViewPath(project.id, nextActionView)}>
                          {nextActionLabel}
                        </Link>
                      )}
                    </div>
                  )}
                </div>
              )}
              {children}
            </main>
          </div>
        </div>
      </div>
    </div>
  );
});
