/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Spin } from '@arco-design/web-react';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { ipcBridge } from '@/common';
import { StudioLibrary } from './components/Library';
import { DirectorProposals } from './components/Shell/DirectorProposals';
import { useStudioProject } from './hooks/useStudioProject';
import {
  STUDIO_VIEWS,
  parseStudioView,
  rememberStudioView,
  resolveStudioEntryView,
  studioViewPath,
  type StudioView,
} from './studioPhaseRoute';
import styles from './StudioPage.module.css';

type StudioReferenceDecisionIntent =
  | { kind: 'rejected' }
  | { kind: 'generation_gate' }
  | { kind: 'imported_reference'; assetId: string };

const StudioCloseResponse: React.FC = () => {
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

const ViewNavigation: React.FC<{ projectId: string; activeView: StudioView }> = ({ projectId, activeView }) => {
  const { t } = useTranslation();
  return (
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
          to={studioViewPath(projectId, view)}
        >
          {t(`conversation.creativeStudio.workspace.views.${view}`)}
        </Link>
      ))}
    </nav>
  );
};

const StudioProjectPage: React.FC<{ projectId: string; routeView: StudioView | null }> = ({ projectId, routeView }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const {
    project,
    proposals,
    referenceRequests,
    referenceGenerationHandoffs,
    loadState,
    errorMessageKey,
    proposalErrorMessageKey,
    referenceErrorMessageKey,
    refetchProject,
    refetchProposals,
    refetchReferences,
  } = useStudioProject(projectId);
  const [pendingActionId, setPendingActionId] = useState<string | null>(null);
  const [actionErrorMessageKey, setActionErrorMessageKey] = useState<string | null>(null);
  const activeView = routeView ?? resolveStudioEntryView(projectId);

  useEffect(() => {
    if (routeView !== null) {
      rememberStudioView(projectId, routeView);
      return;
    }
    navigate(studioViewPath(projectId, activeView), { replace: true });
  }, [activeView, navigate, projectId, routeView]);

  const acceptProposal = useCallback(
    async (proposalId: string): Promise<void> => {
      if (pendingActionId !== null) return;
      setPendingActionId(proposalId);
      setActionErrorMessageKey(null);
      try {
        const result = await ipcBridge.creativeStudio.acceptProposal.invoke({ projectId, proposalId });
        if (result.ok === false) {
          setActionErrorMessageKey(result.error.messageKey);
          return;
        }
        await Promise.all([refetchProject(), refetchProposals()]);
      } catch {
        setActionErrorMessageKey('conversation.creativeStudio.workspace.errors.storage');
      } finally {
        setPendingActionId(null);
      }
    },
    [pendingActionId, projectId, refetchProject, refetchProposals]
  );

  const rejectProposal = useCallback(
    async (proposalId: string): Promise<void> => {
      if (pendingActionId !== null) return;
      setPendingActionId(proposalId);
      setActionErrorMessageKey(null);
      try {
        const result = await ipcBridge.creativeStudio.rejectProposal.invoke({ projectId, proposalId });
        if (result.ok === false) {
          setActionErrorMessageKey(result.error.messageKey);
          return;
        }
        await refetchProposals();
      } catch {
        setActionErrorMessageKey('conversation.creativeStudio.workspace.errors.storage');
      } finally {
        setPendingActionId(null);
      }
    },
    [pendingActionId, projectId, refetchProposals]
  );

  const decideReferences = useCallback(
    async (requestId: string, outcome: StudioReferenceDecisionIntent): Promise<void> => {
      if (pendingActionId !== null || project === null) return;
      setPendingActionId(requestId);
      setActionErrorMessageKey(null);
      try {
        const result = await ipcBridge.creativeStudio.decideReferenceRequest.invoke({
          projectId,
          requestId,
          expectedRevision: project.revision,
          outcome,
        });
        if (result.ok === false) {
          setActionErrorMessageKey(result.error.messageKey);
          return;
        }
        await refetchReferences();
      } catch {
        setActionErrorMessageKey('conversation.creativeStudio.workspace.errors.storage');
      } finally {
        setPendingActionId(null);
      }
    },
    [pendingActionId, project, projectId, refetchReferences]
  );

  if (loadState === 'loading' || loadState === 'idle') {
    return (
      <div className={styles.centered}>
        <Spin tip={t('conversation.creativeStudio.workspace.project.loading')} />
      </div>
    );
  }

  if (loadState === 'unsupported') {
    return (
      <div className={styles.centered}>
        <p>{t('conversation.creativeStudio.workspace.project.unsupportedPrototype')}</p>
        <Link to='/studio'>{t('conversation.creativeStudio.workspace.project.backToLibrary')}</Link>
      </div>
    );
  }

  if (loadState === 'not_found') {
    return (
      <div className={styles.centered}>
        <p>{t('conversation.creativeStudio.workspace.project.notFound')}</p>
        <Link to='/studio'>{t('conversation.creativeStudio.workspace.project.backToLibrary')}</Link>
      </div>
    );
  }

  if (project === null) {
    return (
      <div className={styles.centered}>
        <p role='alert'>{t(errorMessageKey ?? 'conversation.creativeStudio.workspace.errors.storage')}</p>
        <Link to='/studio'>{t('conversation.creativeStudio.workspace.project.backToLibrary')}</Link>
      </div>
    );
  }

  return (
    <div className={styles.projectShell}>
      <StudioCloseResponse />
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
      <ViewNavigation projectId={project.id} activeView={activeView} />
      {actionErrorMessageKey !== null ? (
        <div role='alert' className={styles.projectAlert}>
          {t(actionErrorMessageKey)}
        </div>
      ) : null}
      <DirectorProposals
        proposals={proposals}
        referenceRequests={referenceRequests}
        referenceGenerationHandoffs={referenceGenerationHandoffs}
        pendingActionId={pendingActionId}
        proposalErrorMessageKey={proposalErrorMessageKey}
        referenceErrorMessageKey={referenceErrorMessageKey}
        onAcceptProposal={acceptProposal}
        onRejectProposal={rejectProposal}
        onGenerateReferences={(requestId) => decideReferences(requestId, { kind: 'generation_gate' })}
        onRejectReferences={(requestId) => decideReferences(requestId, { kind: 'rejected' })}
      />
      <main
        aria-labelledby={`studio-${activeView}-heading`}
        className={styles.viewSurface}
        data-studio-view={activeView}
      >
        <h2 id={`studio-${activeView}-heading`}>{t(`conversation.creativeStudio.workspace.views.${activeView}`)}</h2>
        <p>{t(`conversation.creativeStudio.workspace.views.${activeView}Pending`)}</p>
      </main>
    </div>
  );
};

const StudioPage: React.FC = () => {
  const { id, view } = useParams<{ id?: string; view?: string }>();
  const routeView = parseStudioView(view);
  return (
    <div className={`${styles.page} ${id ? styles.pageProject : ''}`} data-studio-workspace>
      {id ? <StudioProjectPage projectId={id} routeView={routeView} /> : <StudioLibrary />}
    </div>
  );
};

export default StudioPage;
