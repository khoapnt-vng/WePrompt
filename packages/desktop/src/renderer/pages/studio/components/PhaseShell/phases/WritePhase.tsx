/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { buildSingleSceneReviewRequest } from '../../Generation/GenerationControls';
import { resolveSceneDurationBounds } from '../../../studioRouteConstraints';
import { AssistantDock } from '../AssistantDock';
import type { WritePhaseController } from '../types';
import type { StudioLayoutMode } from '../useStudioLayoutMode';
import { PacingBar, ScriptRow, ScriptTable } from './write';
import styles from './write/write.module.css';

const ACTIVE_JOB_STATUSES = new Set(['queued_local', 'submitting', 'queued_remote', 'running', 'needs_attention']);

export type WritePhaseProps = {
  controller: WritePhaseController;
  layoutMode?: StudioLayoutMode;
};

export const WritePhase: React.FC<WritePhaseProps> = ({ controller, layoutMode = 'inline' }) => {
  const { t } = useTranslation();
  const {
    project,
    readiness,
    editor,
    models,
    writeFocusIntent,
    advisory,
    mutationPending,
    openDraftReview,
    openSingleGenerationReview,
    importReference,
    clearWriteFocusIntent,
  } = controller;
  const [importingSceneId, setImportingSceneId] = useState<string | null>(null);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const saveConflict = editor.conflict?.operation === 'save_scene' ? editor.conflict : null;
  const nonSaveConflict =
    editor.conflict !== null &&
    editor.conflict.operation !== 'draft_storyboard' &&
    editor.conflict.operation !== 'save_scene'
      ? editor.conflict
      : null;
  const nonDraftError =
    editor.error !== null && editor.error.operation !== 'draft_storyboard' && editor.error.operation !== 'save_scene'
      ? editor.error
      : null;
  const firstSceneIssue = saveConflict ?? editor.saveIssues[0] ?? null;
  const panelConflict = firstSceneIssue?.code === 'stale_project' ? firstSceneIssue : nonSaveConflict;
  const currentFitOutcome =
    editor.latestFitOutcome !== null &&
    editor.latestFitOutcome.project.id === project.id &&
    editor.latestFitOutcome.project.revision === project.revision &&
    editor.latestFitCatalogVersion === models.catalog?.catalogVersion
      ? editor.latestFitOutcome
      : null;
  const hasLockedScenes = useMemo(
    () =>
      Object.values(project.assets).some(
        (asset) => asset.sceneId !== null && asset.managedAsset.collection === 'assets'
      ) || Object.values(project.jobs).some((job) => ACTIVE_JOB_STATUSES.has(job.status)),
    [project.assets, project.jobs]
  );
  const fitDisabled =
    editor.hasUnsavedSceneDrafts ||
    editor.conflict !== null ||
    models.loading ||
    models.catalog === null ||
    !models.catalog.catalogVersion ||
    mutationPending ||
    models.pendingRole !== null;

  useEffect(() => {
    setAssistantOpen(false);
  }, [project.id]);

  useEffect(() => {
    if (writeFocusIntent === null) return;
    if (!Object.hasOwn(project.scenes, writeFocusIntent.sceneId)) {
      clearWriteFocusIntent();
      return;
    }
    if (editor.selectedSceneId !== writeFocusIntent.sceneId) {
      editor.selectScene(writeFocusIntent.sceneId);
      return;
    }
    const focusRequestedField = (): boolean => {
      const field = document.getElementById(`studio-scene-prompt-${writeFocusIntent.sceneId}`);
      if (!(field instanceof HTMLElement)) return false;
      field.focus();
      if (document.activeElement !== field) return false;
      clearWriteFocusIntent();
      return true;
    };
    if (focusRequestedField()) return;
    const observer = new MutationObserver(() => {
      if (focusRequestedField()) observer.disconnect();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [clearWriteFocusIntent, editor, project.scenes, writeFocusIntent]);

  return (
    <section data-layout={layoutMode} className={styles.phase} aria-labelledby='studio-write-phase-heading'>
      <div className={styles.intro}>
        <div>
          <h2 id='studio-write-phase-heading' data-studio-phase-heading tabIndex={-1} className={styles.heading}>
            {t('conversation.creativeStudio.phase.write.title')}
          </h2>
          <p className={`${styles.secondaryCopy} mb-0 mt-4px`}>
            {t('conversation.creativeStudio.phase.shared.noMediaGeneration')}
          </p>
        </div>
        <p className={styles.briefLine}>
          <strong>{t('conversation.creativeStudio.project.brief')}</strong>
          <span>{project.brief}</span>
        </p>
      </div>
      <div className={styles.workspace} data-layout={layoutMode}>
        <div className={styles.mainColumn}>
          <ScriptTable
            orderedScenes={editor.orderedScenes}
            canAddScene={editor.canAddScene}
            mutationPending={mutationPending}
            errorMessageKey={panelConflict?.messageKey ?? firstSceneIssue?.messageKey ?? nonDraftError?.messageKey}
            statusMessageKey={
              firstSceneIssue || nonDraftError || panelConflict
                ? 'conversation.creativeStudio.inspector.unsavedChanges'
                : null
            }
            conflict={panelConflict !== null || firstSceneIssue !== null}
            onAddScene={editor.addScene}
            onReorderScenes={editor.reorderScenes}
            onRetryConflict={
              panelConflict !== null
                ? editor.retryConflict
                : firstSceneIssue?.sceneId !== undefined
                  ? () => editor.flushSceneDraftById(firstSceneIssue.sceneId!)
                  : editor.retryConflict
            }
            onDiscardConflict={
              panelConflict !== null
                ? editor.discardConflict
                : firstSceneIssue?.sceneId !== undefined
                  ? () => editor.discardSceneDraftById(firstSceneIssue.sceneId!)
                  : editor.discardConflict
            }
          >
            {editor.orderedScenes.map((scene, index) => {
              const draft = editor.sceneDrafts[scene.id];
              if (draft === undefined) return null;
              const saveIssue = editor.saveIssues.find((issue) => issue.sceneId === scene.id) ?? null;
              const staleConflict = saveConflict?.sceneId === scene.id ? saveConflict : null;
              const issue = staleConflict ?? saveIssue;
              const referenceAsset =
                scene.referenceAssetId === null ? null : (project.assets[scene.referenceAssetId] ?? null);
              return (
                <ScriptRow
                  key={scene.id}
                  projectId={project.id}
                  aspectRatio={project.aspectRatio}
                  scene={project.scenes[scene.id] ?? scene}
                  draft={draft}
                  index={index}
                  sceneCount={editor.orderedScenes.length}
                  status={readiness.sceneStatuses[scene.id] ?? 'needs_prompt'}
                  referenceAsset={referenceAsset}
                  saveState={editor.sceneSaveStates[scene.id] ?? 'saved'}
                  errorMessageKey={issue?.messageKey ?? null}
                  conflict={issue !== null}
                  selected={editor.selectedSceneId === scene.id}
                  mutationPending={mutationPending}
                  importingReference={importingSceneId === scene.id}
                  canGenerateReference={models.catalog?.image.status === 'ready'}
                  removeDisabled={scene.assetIds.length > 0 || scene.jobIds.length > 0}
                  moveUpDisabled={index === 0}
                  moveDownDisabled={index === editor.orderedScenes.length - 1}
                  durationBoundsByMediaKind={{
                    image: resolveSceneDurationBounds(project, models.catalog, 'image'),
                    video: resolveSceneDurationBounds(project, models.catalog, 'video'),
                  }}
                  onSelect={() => editor.selectScene(scene.id)}
                  onUpdate={(patch) => editor.updateSceneDraftById(scene.id, patch)}
                  onFlush={() => editor.flushSceneDraftById(scene.id)}
                  onRetryConflict={
                    staleConflict !== null ? editor.retryConflict : () => editor.flushSceneDraftById(scene.id)
                  }
                  onDiscardConflict={
                    staleConflict !== null ? editor.discardConflict : () => editor.discardSceneDraftById(scene.id)
                  }
                  onImportReference={() => {
                    if (importingSceneId !== null) return;
                    setImportingSceneId(scene.id);
                    void importReference(scene.id).finally(() => setImportingSceneId(null));
                  }}
                  onGenerateReference={(referencePrompt) => {
                    const request = buildSingleSceneReviewRequest({
                      project,
                      catalog: models.catalog,
                      scene: { id: scene.id, mediaKind: 'image' },
                      outputRole: 'reference',
                      referencePrompt,
                    });
                    if (request !== null) openSingleGenerationReview(request);
                  }}
                  onSuggestVisual={() => {
                    editor.selectScene(scene.id);
                    if (layoutMode === 'inline') {
                      document.querySelector<HTMLElement>("[data-assistant-presentation='inline']")?.focus();
                    } else {
                      setAssistantOpen(true);
                    }
                  }}
                  onRemove={() => editor.removeScene(scene.id)}
                  onMove={(direction) => editor.moveScene(scene.id, direction)}
                />
              );
            })}
          </ScriptTable>
          <PacingBar
            orderedScenes={editor.orderedScenes}
            selectedSceneId={editor.selectedSceneId}
            targetDurationSeconds={project.targetDurationSeconds}
            durationTotalSeconds={editor.durationTotalSeconds}
            durationMatchesTarget={editor.durationMatchesTarget}
            fitDisabled={fitDisabled}
            fitOutcome={currentFitOutcome}
            hasLockedScenes={hasLockedScenes || (currentFitOutcome?.lockedSceneIds.length ?? 0) > 0}
            advisoryMessageKey={advisory?.anchor === 'pacing' ? advisory.messageKey : null}
            onSelectScene={editor.selectScene}
            onFitToGoal={() => {
              const catalogVersion = models.catalog?.catalogVersion;
              if (fitDisabled || !catalogVersion) return;
              editor.clearLatestFitOutcome();
              void editor.fitToTarget(catalogVersion);
            }}
          />
        </div>

        <div className={styles.assistantSlot} data-write-assistant-column data-layout={layoutMode}>
          <AssistantDock
            kind='write'
            layoutMode={layoutMode}
            drawerVisible={assistantOpen}
            storyboard={models.catalog?.storyboard ?? null}
            catalogLoading={models.loading}
            drafting={editor.drafting}
            disabled={mutationPending || models.pendingRole !== null}
            onOpenChange={setAssistantOpen}
            onDraftStoryboard={() => {
              setAssistantOpen(false);
              openDraftReview();
            }}
          />
        </div>
      </div>
    </section>
  );
};
