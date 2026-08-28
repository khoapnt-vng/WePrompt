/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Modal, Spin } from '@arco-design/web-react';
import { ipcBridge } from '@/common';
import type {
  CreateStudioProjectInputV2,
  StudioProjectListResultV2,
  StudioProjectStatusV2,
  StudioProjectSummaryV2,
  StudioRendererProjectV2,
} from '@/common/types/project/creativeStudioTypes';
import { exactStudioProjectStatusV2 } from '@/common/types/project/creativeStudioProjectSummary';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { studioEntryPath, studioProjectPath } from '../../studioPhaseRoute';
import { purgeStoredStudioRuleDrafts } from '../Workspace/Views/WorkspaceProjectMenu';
import { purgeStoredWorkspaceDrafts } from '../Workspace/useWorkspaceDrafts';
import { Composer } from './Composer';
import { ProjectCard } from './ProjectCard';
import styles from './StudioLibrary.module.css';

type LibraryRefreshFlight = {
  promise: Promise<void>;
  trailing: { promise: Promise<void>; resolve: () => void } | null;
};

type LibrarySnapshot = {
  projects: StudioProjectSummaryV2[];
  projectRevisions: Record<string, number>;
  projectStatuses: Record<string, StudioProjectStatusV2 | null>;
  unsupportedProjectIds: string[];
  quarantinedProjectIds: string[];
};

const EMPTY_LIBRARY_SNAPSHOT: LibrarySnapshot = {
  projects: [],
  projectRevisions: {},
  projectStatuses: {},
  unsupportedProjectIds: [],
  quarantinedProjectIds: [],
};

export const StudioLibrary: React.FC = () => {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [librarySnapshot, setLibrarySnapshot] = useState<LibrarySnapshot>(EMPTY_LIBRARY_SNAPSHOT);
  const { projects, projectRevisions, projectStatuses, unsupportedProjectIds, quarantinedProjectIds } = librarySnapshot;
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [listErrorMessageKey, setListErrorMessageKey] = useState<string | null>(null);
  const [createErrorMessageKey, setCreateErrorMessageKey] = useState<string | null>(null);
  const [deleteErrorMessageKey, setDeleteErrorMessageKey] = useState<string | null>(null);
  const [deleteCandidate, setDeleteCandidate] = useState<StudioRendererProjectV2 | null>(null);
  const [creating, setCreating] = useState(false);
  const [deletePreparing, setDeletePreparing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const listRequestRef = useRef(0);
  const refreshFlightRef = useRef<LibraryRefreshFlight | null>(null);
  const deletePreparationRef = useRef(0);
  const mutationBusy = creating || deletePreparing || deleting;

  const performRefreshProjects = useCallback(async (): Promise<void> => {
    const request = ++listRequestRef.current;
    setProjectsLoading(true);
    try {
      const result = await ipcBridge.creativeStudio.listProjects.invoke();
      if (listRequestRef.current !== request) return;
      if (result.ok === false) {
        setListErrorMessageKey(result.error.messageKey);
        return;
      }
      const listing = result.data as StudioProjectListResultV2;
      const revisionByProjectId = new Map<string, number>();
      const invalidRevisionIds = new Set<string>();
      for (const entry of listing.projectRevisions) {
        if (
          invalidRevisionIds.has(entry.projectId) ||
          revisionByProjectId.has(entry.projectId) ||
          !Number.isSafeInteger(entry.revision) ||
          entry.revision < 0
        ) {
          revisionByProjectId.delete(entry.projectId);
          invalidRevisionIds.add(entry.projectId);
          continue;
        }
        revisionByProjectId.set(entry.projectId, entry.revision);
      }
      const statusEntries = await Promise.all(
        listing.projects.map(async (project): Promise<readonly [string, StudioProjectStatusV2 | null]> => {
          const projectRevision = revisionByProjectId.get(project.id);
          if (projectRevision === undefined) return [project.id, null] as const;
          try {
            const statusResult = await ipcBridge.creativeStudio.getProjectStatus.invoke({ projectId: project.id });
            if (statusResult.ok === false || statusResult.data.detail !== null) {
              return [project.id, null] as const;
            }
            const exactStatus = exactStudioProjectStatusV2(statusResult.data, project.id, projectRevision);
            return [
              project.id,
              exactStatus === null ? null : (structuredClone(exactStatus) as StudioProjectStatusV2),
            ] as const;
          } catch {
            return [project.id, null] as const;
          }
        })
      );
      if (listRequestRef.current !== request) return;
      setLibrarySnapshot({
        projects: listing.projects,
        projectRevisions: Object.fromEntries(revisionByProjectId),
        projectStatuses: Object.fromEntries(statusEntries),
        unsupportedProjectIds: listing.unsupportedProjectIds,
        quarantinedProjectIds: listing.quarantinedProjectIds,
      });
      setListErrorMessageKey(null);
    } catch {
      if (listRequestRef.current === request) {
        setListErrorMessageKey('conversation.creativeStudio.workspace.errors.storage');
      }
    } finally {
      if (listRequestRef.current === request) setProjectsLoading(false);
    }
  }, []);

  const refreshProjects = useCallback((): Promise<void> => {
    const start = (): Promise<void> => {
      const flight: LibraryRefreshFlight = {
        promise: performRefreshProjects(),
        trailing: null,
      };
      refreshFlightRef.current = flight;
      const settle = (): void => {
        if (refreshFlightRef.current !== flight) return;
        const trailing = flight.trailing;
        refreshFlightRef.current = null;
        if (trailing !== null) void start().then(trailing.resolve, trailing.resolve);
      };
      void flight.promise.then(settle, settle);
      return flight.promise;
    };

    const active = refreshFlightRef.current;
    if (active === null) return start();
    if (active.trailing === null) {
      let resolve!: () => void;
      const promise = new Promise<void>((done) => {
        resolve = done;
      });
      active.trailing = { promise, resolve };
    }
    return active.trailing.promise;
  }, [performRefreshProjects]);

  useEffect(() => {
    const unsubscribe = ipcBridge.creativeStudio.projectUpdated.on(() => {
      void refreshProjects();
    });
    // Provider inventory is live Main-owned authority and can change without mutating a project.
    // Re-read it when the owner returns to the Library; the refresh flight bounds focus/update bursts
    // to one active read and one trailing read.
    const refreshOnFocus = (): void => {
      void refreshProjects();
    };
    window.addEventListener('focus', refreshOnFocus);
    void refreshProjects();
    return () => {
      listRequestRef.current += 1;
      deletePreparationRef.current += 1;
      const active = refreshFlightRef.current;
      refreshFlightRef.current = null;
      active?.trailing?.resolve();
      window.removeEventListener('focus', refreshOnFocus);
      unsubscribe();
    };
  }, [refreshProjects]);

  const createProject = useCallback(
    async (input: CreateStudioProjectInputV2): Promise<void> => {
      setCreating(true);
      setCreateErrorMessageKey(null);
      try {
        const result = await ipcBridge.creativeStudio.createProject.invoke(input);
        if (result.ok === false) {
          setCreateErrorMessageKey(result.error.messageKey);
          return;
        }
        const created = result.data as StudioRendererProjectV2;
        navigate(studioProjectPath(created.id));
      } catch {
        setCreateErrorMessageKey('conversation.creativeStudio.workspace.errors.storage');
      } finally {
        setCreating(false);
      }
    },
    [navigate]
  );

  const prepareDelete = useCallback(async (candidate: StudioProjectSummaryV2): Promise<void> => {
    const request = ++deletePreparationRef.current;
    setDeletePreparing(true);
    setDeleteErrorMessageKey(null);
    try {
      const result = await ipcBridge.creativeStudio.getProject.invoke({ projectId: candidate.id });
      if (deletePreparationRef.current !== request) return;
      if (result.ok === false) {
        setDeleteErrorMessageKey(result.error.messageKey);
        return;
      }
      if (result.data.status !== 'supported') {
        setDeleteErrorMessageKey(
          result.data.status === 'not_found'
            ? 'conversation.creativeStudio.workspace.project.notFound'
            : 'conversation.creativeStudio.workspace.project.unsupportedPrototype'
        );
        return;
      }
      setDeleteCandidate(result.data.project);
    } catch {
      if (deletePreparationRef.current === request) {
        setDeleteErrorMessageKey('conversation.creativeStudio.workspace.errors.storage');
      }
    } finally {
      if (deletePreparationRef.current === request) setDeletePreparing(false);
    }
  }, []);

  const deleteProject = useCallback(async (): Promise<void> => {
    if (deleteCandidate === null) return;
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
      purgeStoredStudioRuleDrafts(deleteCandidate.id);
      purgeStoredWorkspaceDrafts(deleteCandidate.id);
      setDeleteCandidate(null);
      await refreshProjects();
    } catch {
      setDeleteErrorMessageKey('conversation.creativeStudio.workspace.errors.storage');
    } finally {
      setDeleting(false);
    }
  }, [deleteCandidate, refreshProjects]);

  const listingEmpty =
    projects.length === 0 && unsupportedProjectIds.length === 0 && quarantinedProjectIds.length === 0;

  return (
    <section aria-label={t('conversation.creativeStudio.workspace.library.title')} className={styles.library}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>{t('conversation.creativeStudio.workspace.library.title')}</h1>
          <p className={styles.subtitle}>{t('conversation.creativeStudio.workspace.library.subtitle')}</p>
        </div>
      </header>

      <Composer
        creating={creating}
        disabled={mutationBusy || deleteCandidate !== null}
        errorMessageKey={createErrorMessageKey}
        onSubmit={createProject}
      />
      {listErrorMessageKey !== null ? (
        <div role='alert' className={styles.alert}>
          {t(listErrorMessageKey)}
        </div>
      ) : null}
      {deleteErrorMessageKey !== null && deleteCandidate === null ? (
        <div role='alert' className={styles.alert}>
          {t(deleteErrorMessageKey)}
        </div>
      ) : null}

      {projectsLoading && listingEmpty ? (
        <div className={styles.loading}>
          <Spin tip={t('conversation.creativeStudio.workspace.library.loading')} />
        </div>
      ) : listingEmpty ? (
        <p className={styles.emptyTitle}>{t('conversation.creativeStudio.workspace.library.empty')}</p>
      ) : (
        <>
          {projects.length > 0 ? (
            <div className={styles.projectsBlock}>
              <div className={styles.projectSectionHeader}>
                <span className={styles.projectSectionLabel}>
                  {t('conversation.creativeStudio.workspace.library.sectionLabel')}
                </span>
                <span className={styles.projectCount}>
                  {t('conversation.creativeStudio.workspace.library.projectCount', { count: projects.length })}
                </span>
                <span aria-hidden='true' className={styles.projectSectionHairline} />
              </div>
              <div className={styles.grid}>
                {projects.map((candidate) => (
                  <ProjectCard
                    key={candidate.id}
                    project={candidate}
                    projectRevision={projectRevisions[candidate.id] ?? null}
                    projectStatus={projectStatuses[candidate.id] ?? null}
                    locale={i18n.resolvedLanguage ?? i18n.language}
                    disabled={mutationBusy || deleteCandidate !== null}
                    onOpen={() => navigate(studioEntryPath(candidate.id))}
                    onDelete={() => void prepareDelete(candidate)}
                  />
                ))}
              </div>
            </div>
          ) : null}
          {unsupportedProjectIds.length > 0 ? (
            <section aria-labelledby='studio-unsupported-projects'>
              <h2 id='studio-unsupported-projects'>
                {t('conversation.creativeStudio.workspace.library.unsupportedTitle')}
              </h2>
              <ul>
                {unsupportedProjectIds.map((projectId) => (
                  <li key={projectId}>{projectId}</li>
                ))}
              </ul>
            </section>
          ) : null}
          {quarantinedProjectIds.length > 0 ? (
            <section aria-labelledby='studio-quarantined-projects'>
              <h2 id='studio-quarantined-projects'>
                {t('conversation.creativeStudio.workspace.library.quarantinedTitle')}
              </h2>
              <ul>
                {quarantinedProjectIds.map((projectId) => (
                  <li key={projectId}>{projectId}</li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}

      <Modal
        wrapClassName={styles.modalSurface}
        title={t('conversation.creativeStudio.workspace.library.deleteConfirmTitle')}
        visible={deleteCandidate !== null}
        onCancel={() => !deleting && setDeleteCandidate(null)}
        footer={
          <>
            <Button disabled={deleting} onClick={() => setDeleteCandidate(null)}>
              {t('conversation.creativeStudio.workspace.library.cancel')}
            </Button>
            <Button type='primary' status='danger' loading={deleting} onClick={() => void deleteProject()}>
              {t('conversation.creativeStudio.workspace.library.deleteConfirm')}
            </Button>
          </>
        }
      >
        {deleteErrorMessageKey !== null ? (
          <div role='alert' className={styles.alert}>
            {t(deleteErrorMessageKey)}
          </div>
        ) : null}
        <p>
          {t('conversation.creativeStudio.workspace.library.deleteConfirmBody', {
            name: deleteCandidate?.name ?? '',
          })}
        </p>
      </Modal>
    </section>
  );
};
