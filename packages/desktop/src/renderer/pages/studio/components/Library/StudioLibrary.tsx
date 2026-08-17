/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Modal, Spin } from '@arco-design/web-react';
import { ipcBridge } from '@/common';
import type {
  CreateStudioProjectInput,
  StudioProjectSummary,
  StudioRendererProject,
} from '@/common/types/project/creativeStudioTypes';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { Composer } from './Composer';
import { ProjectCard, type ProjectEngineReadiness } from './ProjectCard';
import styles from './StudioLibrary.module.css';
import { rememberStudioView, resolveStudioEntryView, studioViewPath } from '../../studioPhaseRoute';

const ACTIVE_JOB_STATUSES = new Set(['queued_local', 'submitting', 'queued_remote', 'running', 'needs_attention']);
const READINESS_WORKER_COUNT = 4;

const hasActiveWork = (jobs: Record<string, { status: string }>): boolean =>
  Object.values(jobs).some((job) => ACTIVE_JOB_STATUSES.has(job.status));

export const StudioLibrary: React.FC = () => {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [projects, setProjects] = useState<StudioProjectSummary[]>([]);
  const [engineReadiness, setEngineReadiness] = useState<Record<string, ProjectEngineReadiness>>({});
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [listErrorMessageKey, setListErrorMessageKey] = useState<string | null>(null);
  const [createErrorMessageKey, setCreateErrorMessageKey] = useState<string | null>(null);
  const [deleteErrorMessageKey, setDeleteErrorMessageKey] = useState<string | null>(null);
  const [deleteCandidate, setDeleteCandidate] = useState<StudioRendererProject | null>(null);
  const [creating, setCreating] = useState(false);
  const [deletePreparing, setDeletePreparing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const listRequestRef = useRef(0);
  const deletePreparationRef = useRef(0);
  const mutationBusy = creating || deletePreparing || deleting;

  const probeEngineReadiness = useCallback(async (request: number, projectIds: string[]): Promise<void> => {
    let nextProjectIndex = 0;
    const worker = async (): Promise<void> => {
      while (listRequestRef.current === request) {
        const projectId = projectIds[nextProjectIndex++];
        if (!projectId) return;

        let readiness: ProjectEngineReadiness = 'unknown';
        try {
          const result = await ipcBridge.creativeStudio.listRoutes.invoke({ projectId });
          if (result.ok) {
            readiness =
              result.data.image.status === 'ready' && result.data.video.status === 'ready' ? 'ready' : 'setup_required';
          }
        } catch {
          // A readiness badge is advisory; unavailable probes leave the card usable.
        }

        if (listRequestRef.current !== request) return;
        setEngineReadiness((current) =>
          listRequestRef.current === request ? { ...current, [projectId]: readiness } : current
        );
      }
    };

    await Promise.all(Array.from({ length: Math.min(READINESS_WORKER_COUNT, projectIds.length) }, worker));
  }, []);

  const refreshProjects = useCallback(async (): Promise<void> => {
    const request = ++listRequestRef.current;
    setEngineReadiness({});
    setProjectsLoading(true);
    try {
      const result = await ipcBridge.creativeStudio.listProjects.invoke();
      if (listRequestRef.current !== request) return;
      if (result.ok === false) {
        setListErrorMessageKey(result.error.messageKey);
        return;
      }
      setProjects(result.data);
      setListErrorMessageKey(null);
      void probeEngineReadiness(
        request,
        result.data.map((project) => project.id)
      );
    } catch {
      if (listRequestRef.current === request) {
        setListErrorMessageKey('conversation.creativeStudio.errors.storage');
      }
    } finally {
      if (listRequestRef.current === request) setProjectsLoading(false);
    }
  }, [probeEngineReadiness]);

  useEffect(() => {
    void refreshProjects();
    const unsubscribe = ipcBridge.creativeStudio.projectUpdated.on(() => {
      void refreshProjects();
    });
    return () => {
      listRequestRef.current += 1;
      deletePreparationRef.current += 1;
      unsubscribe();
    };
  }, [refreshProjects]);

  const createProject = useCallback(
    async (input: CreateStudioProjectInput): Promise<void> => {
      setCreating(true);
      setCreateErrorMessageKey(null);
      try {
        const result = await ipcBridge.creativeStudio.createProject.invoke(input);
        if (result.ok === false) {
          setCreateErrorMessageKey(result.error.messageKey);
          return;
        }
        rememberStudioView(result.data.id, 'table');
        navigate(studioViewPath(result.data.id, 'table'), { state: { openBrief: true } });
      } catch {
        setCreateErrorMessageKey('conversation.creativeStudio.errors.storage');
      } finally {
        setCreating(false);
      }
    },
    [navigate]
  );

  const prepareDelete = useCallback(async (candidate: StudioProjectSummary): Promise<void> => {
    const request = ++deletePreparationRef.current;
    setDeletePreparing(true);
    setDeleteErrorMessageKey(null);
    try {
      const canonical = await ipcBridge.creativeStudio.getProject.invoke({ projectId: candidate.id });
      if (deletePreparationRef.current !== request) return;
      if (canonical.ok === false) {
        setDeleteErrorMessageKey(canonical.error.messageKey);
        return;
      }
      if (!canonical.data) {
        setDeleteErrorMessageKey('conversation.creativeStudio.errors.projectNotFound');
        return;
      }
      if (hasActiveWork(canonical.data.jobs)) {
        setDeleteErrorMessageKey('conversation.creativeStudio.library.deleteActiveWork');
        return;
      }
      setDeleteCandidate(canonical.data);
    } catch {
      if (deletePreparationRef.current === request) {
        setDeleteErrorMessageKey('conversation.creativeStudio.errors.storage');
      }
    } finally {
      if (deletePreparationRef.current === request) setDeletePreparing(false);
    }
  }, []);

  const deleteProject = useCallback(async (): Promise<void> => {
    if (!deleteCandidate) return;
    setDeleting(true);
    setDeleteErrorMessageKey(null);
    try {
      const result = await ipcBridge.creativeStudio.deleteProject.invoke({
        projectId: deleteCandidate.id,
        expectedRevision: deleteCandidate.revision,
      });
      if (result.ok === false) {
        setDeleteErrorMessageKey(result.error.messageKey);
        return;
      }
      setDeleteCandidate(null);
      await refreshProjects();
    } catch {
      setDeleteErrorMessageKey('conversation.creativeStudio.errors.storage');
    } finally {
      setDeleting(false);
    }
  }, [deleteCandidate, refreshProjects]);

  return (
    <section aria-label={t('conversation.creativeStudio.library.title')} className={styles.library}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>{t('conversation.creativeStudio.library.title')}</h1>
          <p className={styles.subtitle}>{t('conversation.creativeStudio.library.subtitle')}</p>
        </div>
      </header>

      <Composer
        creating={creating}
        disabled={mutationBusy || deleteCandidate !== null}
        errorMessageKey={createErrorMessageKey}
        onSubmit={createProject}
      />
      {listErrorMessageKey && (
        <div role='alert' className={styles.alert}>
          {t(listErrorMessageKey)}
        </div>
      )}
      {deleteErrorMessageKey && !deleteCandidate && (
        <div role='alert' className={styles.alert}>
          {t(deleteErrorMessageKey)}
        </div>
      )}

      {projectsLoading && projects.length === 0 ? (
        <div className={styles.loading}>
          <Spin tip={t('conversation.creativeStudio.library.loading')} />
        </div>
      ) : projects.length === 0 ? (
        <p className={styles.emptyTitle}>{t('conversation.creativeStudio.empty.title')}</p>
      ) : (
        <div className={styles.projectsBlock}>
          <div className={styles.projectSectionHeader}>
            <span className={styles.projectSectionLabel}>{t('conversation.creativeStudio.library.sectionLabel')}</span>
            <span className={styles.projectCount}>
              {t('conversation.creativeStudio.library.projectCount', { count: projects.length })}
            </span>
            <span aria-hidden='true' className={styles.projectSectionHairline} />
          </div>
          <div className={styles.grid}>
            {projects.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                engineReadiness={engineReadiness[project.id]}
                locale={i18n.resolvedLanguage ?? i18n.language}
                disabled={mutationBusy || deleteCandidate !== null}
                onOpen={() => navigate(studioViewPath(project.id, resolveStudioEntryView(project.id)))}
                onDelete={() => void prepareDelete(project)}
              />
            ))}
          </div>
        </div>
      )}

      <Modal
        wrapClassName={styles.modalSurface}
        title={t('conversation.creativeStudio.library.deleteConfirmTitle')}
        visible={deleteCandidate !== null}
        onCancel={() => !deleting && setDeleteCandidate(null)}
        footer={
          <>
            <Button disabled={deleting} onClick={() => setDeleteCandidate(null)}>
              {t('conversation.creativeStudio.create.cancel')}
            </Button>
            <Button type='primary' status='danger' loading={deleting} onClick={() => void deleteProject()}>
              {t('conversation.creativeStudio.library.deleteConfirm')}
            </Button>
          </>
        }
      >
        {deleteErrorMessageKey && (
          <div role='alert' className={styles.alert}>
            {t(deleteErrorMessageKey)}
          </div>
        )}
        <p>{t('conversation.creativeStudio.library.deleteConfirmBody', { name: deleteCandidate?.name ?? '' })}</p>
      </Modal>
    </section>
  );
};
