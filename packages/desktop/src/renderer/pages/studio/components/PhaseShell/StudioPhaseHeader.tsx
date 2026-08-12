/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { StudioRendererProject } from '@/common/types/project/creativeStudioTypes';
import { Button, Input, Tooltip } from '@arco-design/web-react';
import React from 'react';
import { useTranslation } from 'react-i18next';

import type { SelectedSceneSaveState } from '../../hooks/useStoryboardEditor';
import styles from './StudioPhaseShell.module.css';

const MAX_PROJECT_NAME_CHARS = 256;

export type StudioPhaseHeaderProps = {
  project: StudioRendererProject;
  saveState: SelectedSceneSaveState;
  onBack: () => void;
  onRenameProject?: (name: string) => Promise<boolean>;
  /** The document's in-flight work, supplied by the frame; see StudioDocumentActivity. */
  activity?: React.ReactNode;
  actions?: React.ReactNode;
};

type StudioDocumentSummary = { shotCount: number; durationSeconds: number };

/**
 * What the document contains, as the frame states it beneath the title.
 *
 * `sceneOrder` is the document's own ordering and may repeat an id or name one the scene map
 * no longer holds, so it is walked rather than counted. The total is rounded to a tenth: scene
 * durations are floats, and a subtitle is not the place for their full precision.
 */
const documentSummary = (project: StudioRendererProject): StudioDocumentSummary => {
  const seen = new Set<string>();
  let durationSeconds = 0;
  for (const sceneId of project.sceneOrder) {
    if (seen.has(sceneId)) continue;
    const scene = project.scenes[sceneId];
    if (scene === undefined) continue;
    seen.add(sceneId);
    if (Number.isFinite(scene.durationSeconds)) durationSeconds += scene.durationSeconds;
  }
  return { shotCount: seen.size, durationSeconds: Math.round(durationSeconds * 10) / 10 };
};

const SAVE_STATE_KEYS: Record<SelectedSceneSaveState, string> = {
  saved: 'conversation.creativeStudio.phase.nav.saved',
  dirty: 'conversation.creativeStudio.phase.nav.saving',
  saving: 'conversation.creativeStudio.phase.nav.saving',
  failed: 'conversation.creativeStudio.inspector.saveFailed',
};

export const StudioPhaseHeader: React.FC<StudioPhaseHeaderProps> = ({
  project,
  saveState,
  onBack,
  onRenameProject,
  activity,
  actions,
}) => {
  const { t } = useTranslation();
  const summary = documentSummary(project);
  const [editingName, setEditingName] = React.useState(false);
  const [nameDraft, setNameDraft] = React.useState(project.name);
  const [renamePending, setRenamePending] = React.useState(false);
  const renameCommitPendingRef = React.useRef(false);
  const renameCancelledRef = React.useRef(false);
  const invalidName = nameDraft.trim().length === 0 || nameDraft.length > MAX_PROJECT_NAME_CHARS;

  React.useEffect(() => {
    if (!editingName) setNameDraft(project.name);
  }, [editingName, project.name]);

  const startRenaming = (): void => {
    if (onRenameProject === undefined) return;
    renameCancelledRef.current = false;
    setNameDraft(project.name);
    setEditingName(true);
  };

  const commitRename = async (): Promise<void> => {
    if (onRenameProject === undefined || invalidName || renameCommitPendingRef.current) return;
    const trimmedName = nameDraft.trim();
    if (trimmedName === project.name) {
      setEditingName(false);
      return;
    }
    renameCommitPendingRef.current = true;
    setRenamePending(true);
    try {
      if (await onRenameProject(trimmedName)) setEditingName(false);
    } finally {
      renameCommitPendingRef.current = false;
      setRenamePending(false);
    }
  };

  return (
    <header className={styles.header}>
      <div className={styles.headerCopy}>
        <nav aria-label={t('conversation.creativeStudio.phase.shared.backToLibrary')} className={styles.breadcrumb}>
          {/* No aria-label on the crumb: it carries visible text now, and an aria-label would
              replace that name with words the user cannot see (WCAG 2.5.3, Label in Name).
              Where it leads is carried by the landmark name and the tooltip instead. */}
          <Tooltip content={t('conversation.creativeStudio.phase.shared.backToLibrary')}>
            <Button type='text' size='small' className={styles.breadcrumbButton} onClick={onBack}>
              {t('conversation.creativeStudio.library.title')}
            </Button>
          </Tooltip>
          <span aria-hidden='true' className={styles.breadcrumbSeparator}>
            /
          </span>
        </nav>
        <div className={styles.headerIdentity}>
          <h1 aria-label={project.name} className={styles.projectTitle}>
            {editingName ? (
              <span className={styles.projectTitleEditor}>
                <Input
                  autoFocus
                  value={nameDraft}
                  error={invalidName}
                  disabled={renamePending}
                  maxLength={MAX_PROJECT_NAME_CHARS}
                  aria-label={t('conversation.creativeStudio.phase.shared.renameProject')}
                  aria-describedby={invalidName ? 'studio-project-name-error' : undefined}
                  className={styles.projectTitleInput}
                  onChange={setNameDraft}
                  onFocus={(event) => event.target.select()}
                  onPressEnter={() => void commitRename()}
                  onBlur={() => {
                    if (renameCancelledRef.current) {
                      renameCancelledRef.current = false;
                      return;
                    }
                    void commitRename();
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== 'Escape') return;
                    renameCancelledRef.current = true;
                    setNameDraft(project.name);
                    setEditingName(false);
                  }}
                />
                {invalidName && (
                  <span id='studio-project-name-error' role='alert' className={styles.projectTitleError}>
                    {t('conversation.creativeStudio.phase.shared.invalidProjectName')}
                  </span>
                )}
              </span>
            ) : onRenameProject === undefined ? (
              project.name
            ) : (
              <Tooltip content={t('conversation.creativeStudio.phase.shared.renameProject')}>
                <Button
                  type='text'
                  aria-label={t('conversation.creativeStudio.phase.shared.renameProject')}
                  className={styles.projectTitleButton}
                  onClick={startRenaming}
                >
                  <span className={styles.projectTitleText}>{project.name}</span>
                </Button>
              </Tooltip>
            )}
          </h1>
          <p className={styles.projectSubtitle}>
            {summary.shotCount === 0
              ? t('conversation.creativeStudio.phase.shared.documentSummaryEmpty')
              : t('conversation.creativeStudio.phase.shared.documentSummary', {
                  count: summary.shotCount,
                  seconds: summary.durationSeconds,
                })}
          </p>
        </div>
      </div>
      <div className={styles.headerMeta}>
        {/* The header holds more than one live region now, so the save chip carries its own
            hook: `header [role="status"]` no longer identifies it. */}
        <span
          role='status'
          aria-live='polite'
          aria-atomic='true'
          data-studio-save-state
          data-state={saveState}
          className={styles.saveState}
        >
          {t(SAVE_STATE_KEYS[saveState])}
        </span>
        {activity}
        {actions !== undefined && (
          <div data-studio-phase-actions className={styles.headerActions}>
            {actions}
          </div>
        )}
      </div>
    </header>
  );
};
