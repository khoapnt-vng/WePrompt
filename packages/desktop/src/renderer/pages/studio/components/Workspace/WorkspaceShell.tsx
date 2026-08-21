/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button } from '@arco-design/web-react';
import React, { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import type { StudioRendererProjectV2 } from '@/common/types/project/creativeStudioTypes';
import SidebarIcon from '@/renderer/components/base/SidebarIcon';
import { STUDIO_VIEWS, studioViewPath, type StudioView } from '@/renderer/pages/studio/studioPhaseRoute';
import { DirectorRail } from './DirectorRail';
import styles from './Workspace.module.css';
import type { StudioBarStats } from './workspaceProjection';

export type WorkspaceShellProps = {
  project: StudioRendererProjectV2;
  activeView: StudioView;
  stats?: StudioBarStats;
  reviewedOutput?: React.ReactNode;
  notice?: React.ReactNode;
  children: React.ReactNode;
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
export const WorkspaceShell: React.FC<WorkspaceShellProps> = ({
  project,
  activeView,
  stats,
  reviewedOutput,
  notice,
  children,
}) => {
  const { t } = useTranslation();
  const viewHeadingId = `studio-${activeView}-heading`;
  const railContentId = useId();
  const [railCollapsed, setRailCollapsed] = useState(false);

  const toggleLabel = t(
    railCollapsed
      ? 'conversation.creativeStudio.workspace.director.show'
      : 'conversation.creativeStudio.workspace.director.hide'
  );
  const filmClock = clock(stats?.filmSeconds);
  const targetClock = clock(stats?.targetSeconds);

  return (
    <div className={styles.shell} data-studio-workspace-shell>
      <header className={styles.appBar} data-studio-app-bar>
        <Button
          type='text'
          shape='circle'
          icon={<SidebarIcon />}
          className={styles.railToggle}
          data-studio-director-toggle
          aria-controls={railContentId}
          aria-expanded={!railCollapsed}
          aria-label={toggleLabel}
          title={toggleLabel}
          onClick={() => setRailCollapsed((current) => !current)}
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
      </header>
      <div className={styles.panes} data-studio-panes>
        <DirectorRail
          project={project}
          reviewedOutput={reviewedOutput}
          collapsed={railCollapsed}
          contentId={railContentId}
        />
        <div className={styles.workPanel} data-studio-work-panel>
          <div className={styles.workScroll} data-studio-work-scroll>
            <Link className={styles.backLink} to='/studio'>
              {t('conversation.creativeStudio.workspace.project.backToLibrary')}
            </Link>
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
};
