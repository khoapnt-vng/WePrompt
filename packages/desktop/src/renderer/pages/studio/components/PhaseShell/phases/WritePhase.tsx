/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { buildSingleSceneReviewRequest } from '../../Generation/GenerationControls';
import { requestedMediaKind } from '@/common/types/project/creativeStudioOutputRole';
import { resolveSceneDurationBounds } from '../../../studioRouteConstraints';
import { AssistantDock } from '../AssistantDock';
import type { WritePhaseController } from '../types';
import type { StudioLayoutMode } from '../useStudioLayoutMode';
import { ScriptRow, ScriptTable } from './write';
import styles from './write/write.module.css';
import { useBriefConversationContext } from '../../Shell/BriefConversationContext';

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
    mutationPending,
    openDraftReview,
    openSingleGenerationReview,
    importReference,
    clearWriteFocusIntent,
  } = controller;
  const [importingSceneId, setImportingSceneId] = useState<string | null>(null);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const briefConversation = useBriefConversationContext();
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
  const generationBlocked =
    editor.hasUnsavedProjectDraft ||
    editor.hasUnsavedSceneDrafts ||
    editor.conflict !== null ||
    editor.drafting ||
    mutationPending;
  const canGenerateReference = models.catalog?.image.status === 'ready' && !generationBlocked;

  useEffect(() => {
    setAssistantOpen(false);
  }, [project.id]);

  /**
   * Where a "suggest a visual" click should land now that the conversation left the phase.
   *
   * It used to focus the composer of the conversation Write mounted itself. The shell owns that
   * conversation and renders it in the Director pane, which Write cannot open: below 1120px it is
   * an overlay, and at any width the user can collapse it. So aim at the Director's composer and
   * let the DOM answer whether the click actually landed — a collapsed pane is `visibility: hidden`
   * and a shut overlay is `display: none`, and neither takes focus. When it does not land, Write
   * falls back to the assistant it does own and can always open, rather than doing nothing at all.
   *
   * Only when the thread already exists: the pane's other composer sends the *first* message, which
   * becomes the project brief, and a note about one shot has no business being that.
   */
  const focusDirectorComposer = (): boolean => {
    if (briefConversation.state.kind !== 'ready') return false;
    const composer = document.querySelector<HTMLElement>('[data-studio-director] textarea');
    if (composer === null) return false;
    composer.focus();
    return document.activeElement === composer;
  };

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
      <h2 id='studio-write-phase-heading' data-studio-phase-heading tabIndex={-1} className='sr-only'>
        {t('conversation.creativeStudio.phase.write.title')}
      </h2>
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
                  canGenerateReference={canGenerateReference}
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
                    if (generationBlocked) return;
                    const request = buildSingleSceneReviewRequest({
                      project,
                      catalog: models.catalog,
                      scene: { id: scene.id, mediaKind: requestedMediaKind(scene.mediaKind, 'reference') },
                      outputRole: 'reference',
                      referencePrompt,
                    });
                    if (request !== null) openSingleGenerationReview(request);
                  }}
                  onSuggestVisual={() => {
                    editor.selectScene(scene.id);
                    if (focusDirectorComposer()) return;
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
        </div>

        {/*
          One assistant, whatever the Director is doing. The rail that used to replace it once the
          conversation existed was a leftover of Write hosting that conversation: with the surface
          gone it was an empty bordered box carrying a "Brief conversation" landmark name that
          matched the Director pane's, so screen-reader users landed in a region holding nothing
          but a button. Write keeps the assistant it owns and can always open.
        */}
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
