/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { ipcBridge } from '@/common';
import { PilotCanvas, PilotDirectorRail, PilotLibrary } from '@/renderer/pages/studio/components/Pilot';
import { createManagedStudioAssetUrl } from '@/renderer/pages/studio/studioManagedAssetUrl';
import styles from '../StudioPage.module.css';
import { studioPilotClientV3 } from './pilotClient';

const projectPath = (projectId: string): string => `/studio/${encodeURIComponent(projectId)}`;

/** Pilot has no browser-owned durable drafts; paid intent lives in the Main quote cache. */
const PilotCloseResponse: React.FC = () => {
  useEffect(() => {
    const disposeHasUnsavedWork = ipcBridge.creativeStudio.hasUnsavedWork.provider(() => ({ dirtyDraftCount: 0 }));
    const disposeFlushUnsavedWork = ipcBridge.creativeStudio.flushUnsavedWork.provider(() => ({ saved: true }));
    return () => {
      disposeHasUnsavedWork();
      disposeFlushUnsavedWork();
    };
  }, []);
  return null;
};

const StudioPage: React.FC = () => {
  const { id } = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();

  return (
    <>
      <PilotCloseResponse />
      <div className={`${styles.page} ${id === undefined ? '' : styles.pageProject}`} data-studio-pilot>
        {id === undefined ? (
          <PilotLibrary client={studioPilotClientV3} onOpenProject={(projectId) => navigate(projectPath(projectId))} />
        ) : (
          <>
            <nav className={styles.pilotBreadcrumb} aria-label={t('conversation.creativeStudio.pilot.library.title')}>
              <Link to='/studio'>{t('conversation.creativeStudio.pilot.library.title')}</Link>
            </nav>
            <div className={styles.pilotWorkspace}>
              <PilotCanvas
                key={id}
                projectId={id}
                client={studioPilotClientV3}
                assetUrlFor={(projectId, asset) => createManagedStudioAssetUrl(projectId, asset.id)}
              />
              <PilotDirectorRail projectId={id} client={studioPilotClientV3} />
            </div>
          </>
        )}
      </div>
    </>
  );
};

export default StudioPage;
