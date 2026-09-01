/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  StudioCreateProjectRequestV3,
  StudioCreateProjectResultV3,
  StudioDeleteProjectRequestV3,
  StudioDeleteProjectResultV3,
  StudioProjectLibraryEntryV3,
  StudioProjectListResultV3,
  StudioProjectLoadResultV3,
} from '@/common/types/project/creativeStudioTypes';
import { Button, Input, Modal, Spin, Tag } from '@arco-design/web-react';
import { Delete, Refresh } from '@icon-park/react';
import type { TFunction } from 'i18next';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import styles from './PilotLibrary.module.css';

export type StudioPilotLibraryClientV3 = {
  listProjectsV3(): Promise<StudioProjectListResultV3>;
  createProjectV3(input: StudioCreateProjectRequestV3): Promise<StudioCreateProjectResultV3>;
  loadProjectV3(projectId: string): Promise<StudioProjectLoadResultV3>;
  deleteProjectV3(input: StudioDeleteProjectRequestV3): Promise<StudioDeleteProjectResultV3>;
};

export type PilotLibraryProps = {
  client: StudioPilotLibraryClientV3;
  onOpenProject: (projectId: string) => void;
};

type DeleteCandidate = {
  projectId: string;
  displayName: string;
  classification: StudioProjectLibraryEntryV3['status'];
  request: StudioDeleteProjectRequestV3;
};

type SupportedProjectEntryV3 = Extract<StudioProjectLibraryEntryV3, { status: 'supported' }>;
type UnreadableProjectEntryV3 = Extract<StudioProjectLibraryEntryV3, { status: 'unsupported' | 'quarantined' }>;

const PILOT_I18N_ROOT = 'conversation.creativeStudio.pilot';

const errorCopy = (_error: unknown, t: TFunction): string => t(`${PILOT_I18N_ROOT}.common.actionFailed`);

const classifyEntries = (
  entries: readonly StudioProjectLibraryEntryV3[]
): {
  supported: SupportedProjectEntryV3[];
  unsupported: UnreadableProjectEntryV3[];
  quarantined: UnreadableProjectEntryV3[];
} => {
  const supported: SupportedProjectEntryV3[] = [];
  const unsupported: UnreadableProjectEntryV3[] = [];
  const quarantined: UnreadableProjectEntryV3[] = [];

  for (const entry of entries) {
    if (entry.status === 'supported') supported.push(entry);
    else if (entry.status === 'unsupported') unsupported.push(entry);
    else quarantined.push(entry);
  }
  return { supported, unsupported, quarantined };
};

const UnreadableProjectList: React.FC<{
  classification: 'unsupported' | 'quarantined';
  entries: UnreadableProjectEntryV3[];
  busy: boolean;
  errors: Readonly<Record<string, string>>;
  onDelete: (entry: UnreadableProjectEntryV3) => void;
}> = ({ classification, entries, busy, errors, onDelete }) => {
  const { t } = useTranslation();
  if (entries.length === 0) return null;
  const unsupported = classification === 'unsupported';
  const title = t(
    unsupported ? `${PILOT_I18N_ROOT}.library.unsupported.title` : `${PILOT_I18N_ROOT}.library.quarantined.title`
  );
  const explanation = unsupported
    ? t(`${PILOT_I18N_ROOT}.library.unsupported.description`)
    : t(`${PILOT_I18N_ROOT}.library.quarantined.description`);

  return (
    <section className={styles.group} aria-labelledby={`pilot-library-${classification}`}>
      <header className={styles.groupHeader}>
        <div>
          <h2 id={`pilot-library-${classification}`} className={styles.groupTitle}>
            {title}
          </h2>
          <p className={styles.groupDescription}>{explanation}</p>
        </div>
        <Tag color={unsupported ? 'gray' : 'red'}>
          {t(unsupported ? `${PILOT_I18N_ROOT}.library.unsupported.tag` : `${PILOT_I18N_ROOT}.library.quarantined.tag`)}
        </Tag>
      </header>
      <ul className={styles.unreadableList}>
        {entries.map((entry) => (
          <li key={entry.projectId} className={styles.unreadableItem}>
            <div className={styles.unreadableIdentity}>
              <code dir='ltr'>{entry.projectId}</code>
              {errors[entry.projectId] === undefined ? null : (
                <p role='alert' className={styles.inlineError}>
                  {errors[entry.projectId]}
                </p>
              )}
            </div>
            <Button
              status='danger'
              icon={<Delete />}
              disabled={busy}
              aria-label={t(`${PILOT_I18N_ROOT}.library.deleteUnreadableAccessible`, {
                projectId: entry.projectId,
              })}
              onClick={() => onDelete(entry)}
            >
              {t(`${PILOT_I18N_ROOT}.common.delete`)}
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
};

/** Schema-6 project library. Callers inject the exact Pilot client boundary. */
export const PilotLibrary: React.FC<PilotLibraryProps> = ({ client, onOpenProject }) => {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<StudioProjectLibraryEntryV3[]>([]);
  const [hasSnapshot, setHasSnapshot] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [brief, setBrief] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [preparingDeleteId, setPreparingDeleteId] = useState<string | null>(null);
  const [deleteCandidate, setDeleteCandidate] = useState<DeleteCandidate | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [entryErrors, setEntryErrors] = useState<Record<string, string>>({});
  const requestRef = useRef(0);

  const refreshProjects = useCallback(async (): Promise<void> => {
    const request = ++requestRef.current;
    setRefreshing(true);
    setRefreshError(null);
    try {
      const result = await client.listProjectsV3();
      if (requestRef.current !== request) return;
      setEntries(result.entries);
      setHasSnapshot(true);
    } catch (error) {
      if (requestRef.current !== request) return;
      setRefreshError(errorCopy(error, t));
      setHasSnapshot(true);
    } finally {
      if (requestRef.current === request) setRefreshing(false);
    }
  }, [client, t]);

  useEffect(() => {
    void refreshProjects();
    return () => {
      requestRef.current += 1;
    };
  }, [refreshProjects]);

  const createProject = useCallback(async (): Promise<void> => {
    const normalizedName = name.trim();
    if (normalizedName.length === 0) {
      setCreateError(t(`${PILOT_I18N_ROOT}.library.nameRequired`));
      return;
    }
    setCreating(true);
    setCreateError(null);
    try {
      const result = await client.createProjectV3({ name: normalizedName, brief });
      setEntries((current) => [
        { status: 'supported', summary: result.summary },
        ...current.filter(
          (entry) => (entry.status === 'supported' ? entry.summary.id : entry.projectId) !== result.summary.id
        ),
      ]);
      setHasSnapshot(true);
      setName('');
      setBrief('');
      onOpenProject(result.summary.id);
    } catch (error) {
      setCreateError(errorCopy(error, t));
    } finally {
      setCreating(false);
    }
  }, [brief, client, name, onOpenProject, t]);

  const prepareHealthyDelete = useCallback(
    async (entry: SupportedProjectEntryV3): Promise<void> => {
      const projectId = entry.summary.id;
      setPreparingDeleteId(projectId);
      setEntryErrors((current) => {
        const next = { ...current };
        delete next[projectId];
        return next;
      });
      try {
        const loaded = await client.loadProjectV3(projectId);
        if (loaded.status === 'not_found') {
          setEntries((current) =>
            current.filter((candidate) =>
              candidate.status === 'supported' ? candidate.summary.id !== projectId : candidate.projectId !== projectId
            )
          );
          return;
        }
        if (loaded.status === 'supported') {
          setDeleteCandidate({
            projectId,
            displayName: loaded.summary.name,
            classification: 'supported',
            request: { mode: 'healthy', projectId, expectedRevision: loaded.canvas.revision },
          });
          return;
        }
        setDeleteCandidate({
          projectId,
          displayName: projectId,
          classification: loaded.status,
          request: { mode: 'unreadable', projectId, deletionClaim: loaded.deletionClaim },
        });
      } catch (error) {
        setEntryErrors((current) => ({ ...current, [projectId]: errorCopy(error, t) }));
      } finally {
        setPreparingDeleteId(null);
      }
    },
    [client, t]
  );

  const prepareUnreadableDelete = useCallback((entry: UnreadableProjectEntryV3): void => {
    setEntryErrors((current) => {
      const next = { ...current };
      delete next[entry.projectId];
      return next;
    });
    setDeleteCandidate({
      projectId: entry.projectId,
      displayName: entry.projectId,
      classification: entry.status,
      request: { mode: 'unreadable', projectId: entry.projectId, deletionClaim: entry.deletionClaim },
    });
  }, []);

  const confirmDelete = useCallback(async (): Promise<void> => {
    if (deleteCandidate === null) return;
    setDeleting(true);
    try {
      await client.deleteProjectV3(deleteCandidate.request);
      const deletedId = deleteCandidate.projectId;
      setEntries((current) =>
        current.filter((entry) =>
          entry.status === 'supported' ? entry.summary.id !== deletedId : entry.projectId !== deletedId
        )
      );
      setEntryErrors((current) => {
        const next = { ...current };
        delete next[deletedId];
        return next;
      });
      setDeleteCandidate(null);
    } catch (error) {
      const projectId = deleteCandidate.projectId;
      setEntryErrors((current) => ({ ...current, [projectId]: errorCopy(error, t) }));
    } finally {
      setDeleting(false);
    }
  }, [client, deleteCandidate, t]);

  const groups = classifyEntries(entries);
  const mutationBusy = creating || preparingDeleteId !== null || deleting || deleteCandidate !== null;
  const empty = entries.length === 0;

  return (
    <main className={styles.library} aria-labelledby='pilot-library-title'>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>{t(`${PILOT_I18N_ROOT}.library.eyebrow`)}</p>
          <h1 id='pilot-library-title' className={styles.title}>
            {t(`${PILOT_I18N_ROOT}.library.title`)}
          </h1>
          <p className={styles.subtitle}>{t(`${PILOT_I18N_ROOT}.library.subtitle`)}</p>
        </div>
        <Button
          icon={<Refresh />}
          loading={refreshing && hasSnapshot}
          disabled={refreshing}
          onClick={() => void refreshProjects()}
        >
          {t(`${PILOT_I18N_ROOT}.library.refresh`)}
        </Button>
      </header>

      <form
        className={styles.createForm}
        aria-labelledby='pilot-library-create-title'
        onSubmit={(event) => {
          event.preventDefault();
          void createProject();
        }}
      >
        <h2 id='pilot-library-create-title' className={styles.formTitle}>
          {t(`${PILOT_I18N_ROOT}.library.newProject`)}
        </h2>
        <label className={styles.field} htmlFor='pilot-library-project-name'>
          <span>{t(`${PILOT_I18N_ROOT}.library.projectName`)}</span>
          <Input
            id='pilot-library-project-name'
            value={name}
            dir='auto'
            maxLength={256}
            disabled={mutationBusy}
            onChange={(value) => {
              setName(value);
              if (value.trim().length > 0) setCreateError(null);
            }}
          />
        </label>
        <label className={styles.field} htmlFor='pilot-library-project-brief'>
          <span>{t(`${PILOT_I18N_ROOT}.library.brief`)}</span>
          <Input.TextArea
            id='pilot-library-project-brief'
            value={brief}
            dir='auto'
            maxLength={16 * 1024}
            autoSize={{ minRows: 3, maxRows: 8 }}
            disabled={mutationBusy}
            onChange={setBrief}
          />
        </label>
        {createError === null ? null : (
          <p role='alert' className={styles.inlineError}>
            {createError}
          </p>
        )}
        <div>
          <Button type='primary' htmlType='submit' loading={creating} disabled={mutationBusy}>
            {t(`${PILOT_I18N_ROOT}.library.createProject`)}
          </Button>
        </div>
      </form>

      {!hasSnapshot && refreshing ? (
        <div className={styles.initialState} role='status' aria-live='polite'>
          <Spin />
          <span>{t(`${PILOT_I18N_ROOT}.library.loading`)}</span>
        </div>
      ) : null}
      {hasSnapshot && refreshing ? (
        <p className={styles.refreshState} role='status' aria-live='polite'>
          {t(`${PILOT_I18N_ROOT}.library.refreshing`)}
        </p>
      ) : null}
      {refreshError === null ? null : (
        <p className={styles.refreshState} role='status' aria-live='polite'>
          {t(
            empty ? `${PILOT_I18N_ROOT}.library.projectsUnavailable` : `${PILOT_I18N_ROOT}.library.refreshUnavailable`
          )}{' '}
          <span className={styles.technicalError}>{refreshError}</span>
        </p>
      )}

      {hasSnapshot && empty && !refreshing && refreshError === null ? (
        <section className={styles.empty} aria-labelledby='pilot-library-empty-title'>
          <h2 id='pilot-library-empty-title'>{t(`${PILOT_I18N_ROOT}.library.emptyTitle`)}</h2>
          <p>{t(`${PILOT_I18N_ROOT}.library.emptyBody`)}</p>
        </section>
      ) : null}

      {groups.supported.length === 0 ? null : (
        <section className={styles.group} aria-labelledby='pilot-library-supported'>
          <header className={styles.groupHeader}>
            <div>
              <h2 id='pilot-library-supported' className={styles.groupTitle}>
                {t(`${PILOT_I18N_ROOT}.library.supported.title`)}
              </h2>
              <p className={styles.groupDescription}>{t(`${PILOT_I18N_ROOT}.library.supported.description`)}</p>
            </div>
            <Tag color='green'>{t(`${PILOT_I18N_ROOT}.library.supported.tag`)}</Tag>
          </header>
          <ul className={styles.projectGrid}>
            {groups.supported.map((entry) => {
              const project = entry.summary;
              const preparing = preparingDeleteId === project.id;
              return (
                <li key={project.id}>
                  <article className={styles.card} aria-labelledby={`pilot-project-${project.id}`}>
                    <header className={styles.cardHeader}>
                      <h3 id={`pilot-project-${project.id}`} className={styles.cardTitle} dir='auto'>
                        {project.name}
                      </h3>
                      <Button
                        type='text'
                        status='danger'
                        icon={<Delete />}
                        loading={preparing}
                        disabled={mutationBusy && !preparing}
                        aria-label={t(`${PILOT_I18N_ROOT}.library.deleteAccessible`, { name: project.name })}
                        onClick={() => void prepareHealthyDelete(entry)}
                      />
                    </header>
                    <dl className={styles.facts}>
                      <dt>{t(`${PILOT_I18N_ROOT}.library.facts.pieces`)}</dt>
                      <dd>{project.pieceCount}</dd>
                      <dt>{t(`${PILOT_I18N_ROOT}.library.facts.currentPhotos`)}</dt>
                      <dd>{project.currentPieceCount}</dd>
                      <dt>{t(`${PILOT_I18N_ROOT}.library.facts.updated`)}</dt>
                      <dd>
                        <time dateTime={project.updatedAt}>{project.updatedAt}</time>
                      </dd>
                    </dl>
                    {entryErrors[project.id] === undefined ? null : (
                      <p role='alert' className={styles.inlineError}>
                        {entryErrors[project.id]}
                      </p>
                    )}
                    <Button type='primary' disabled={mutationBusy} onClick={() => onOpenProject(project.id)}>
                      {t(`${PILOT_I18N_ROOT}.library.openProject`, { name: project.name })}
                    </Button>
                  </article>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <UnreadableProjectList
        classification='unsupported'
        entries={groups.unsupported}
        busy={mutationBusy}
        errors={entryErrors}
        onDelete={prepareUnreadableDelete}
      />
      <UnreadableProjectList
        classification='quarantined'
        entries={groups.quarantined}
        busy={mutationBusy}
        errors={entryErrors}
        onDelete={prepareUnreadableDelete}
      />

      <Modal
        visible={deleteCandidate !== null}
        title={t(
          deleteCandidate?.classification === 'supported'
            ? `${PILOT_I18N_ROOT}.library.deleteModal.healthyTitle`
            : `${PILOT_I18N_ROOT}.library.deleteModal.unreadableTitle`
        )}
        unmountOnExit
        onCancel={() => {
          if (!deleting) setDeleteCandidate(null);
        }}
        footer={
          <div className={styles.modalActions}>
            <Button disabled={deleting} onClick={() => setDeleteCandidate(null)}>
              {t(`${PILOT_I18N_ROOT}.library.deleteModal.keep`)}
            </Button>
            <Button
              type='primary'
              status='danger'
              loading={deleting}
              disabled={deleting}
              onClick={() => void confirmDelete()}
            >
              {t(`${PILOT_I18N_ROOT}.library.deleteModal.confirm`)}
            </Button>
          </div>
        }
      >
        <p>
          {deleteCandidate?.classification === 'supported'
            ? t(`${PILOT_I18N_ROOT}.library.deleteModal.healthyBody`, { name: deleteCandidate.displayName })
            : t(`${PILOT_I18N_ROOT}.library.deleteModal.unreadableBody`, {
                name: deleteCandidate?.displayName ?? '',
              })}
        </p>
        {deleteCandidate === null || entryErrors[deleteCandidate.projectId] === undefined ? null : (
          <p role='alert' className={styles.inlineError}>
            {entryErrors[deleteCandidate.projectId]}
          </p>
        )}
      </Modal>
    </main>
  );
};
