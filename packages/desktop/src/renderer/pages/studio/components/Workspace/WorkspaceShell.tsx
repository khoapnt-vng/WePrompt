/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import type { StudioRendererProjectV2 } from '@/common/types/project/creativeStudioTypes';
import { STUDIO_VIEWS, studioViewPath, type StudioView } from '@/renderer/pages/studio/studioPhaseRoute';
import { DirectorRail } from './DirectorRail';
import styles from './Workspace.module.css';

export type WorkspaceShellProps = {
  project: StudioRendererProjectV2;
  activeView: StudioView;
  reviewedOutput?: React.ReactNode;
  notice?: React.ReactNode;
  children: React.ReactNode;
};

/**
 * The Studio project frame. The Director and workspace are fixed siblings; changing views replaces
 * only the workspace presentation and cannot move or remount the conversation owner.
 */
export const WorkspaceShell: React.FC<WorkspaceShellProps> = ({
  project,
  activeView,
  reviewedOutput,
  notice,
  children,
}) => {
  const { t } = useTranslation();
  const viewHeadingId = `studio-${activeView}-heading`;

  return (
    <div className={styles.shell} data-studio-workspace-shell>
      <DirectorRail project={project} reviewedOutput={reviewedOutput} />
      <div className={styles.workPanel} data-studio-work-panel>
        <div className={styles.workScroll} data-studio-work-scroll>
          <header className={styles.workspaceHeader} data-studio-project-header>
            <Link to='/studio'>{t('conversation.creativeStudio.workspace.project.backToLibrary')}</Link>
            <h1>{project.name}</h1>
            <p>
              {t('conversation.creativeStudio.workspace.project.structure', {
                beats: project.beatOrder.length,
                shots: Object.keys(project.shots).length,
              })}
            </p>
          </header>
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
  );
};
