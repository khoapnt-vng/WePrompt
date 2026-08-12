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
import type { WritePhaseController } from '../types';
import type { StudioLayoutMode } from '../useStudioLayoutMode';
import { ScriptRow, ScriptTable } from './write';
import styles from './write/write.module.css';
import { useBriefConversationContext } from '../../Shell/BriefConversationContext';
import { useRevealDirector } from '../../Shell/StudioDirectorRevealContext';

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
    openSingleGenerationReview,
    importReference,
    clearWriteFocusIntent,
  } = controller;
  const [importingSceneId, setImportingSceneId] = useState<string | null>(null);
  const briefConversation = useBriefConversationContext();
  const revealDirector = useRevealDirector();
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

  /**
   * Where a "suggest a visual" click lands, now that Write hosts no assistant of its own.
   *
   * The Director is the only writing assistant in Studio, and the phase cannot reach into it: the
   * pane is collapsible at any width and is an overlay below 1120px, and both of those belong to
   * the shell. So ask the shell to reveal it, then take the caret — aiming at a hidden pane and
   * hoping is what made this a silent no-op the first time.
   *
   * Focus is claimed only once the thread exists. The pane's other composer sends the *first*
   * message, which becomes the project brief, and a note about one shot has no business being that.
   * Revealing still happens in that state, and is the legible degradation for it: the user sees the
   * Director with nothing in it and an invitation to start, rather than a click that did nothing.
   */
  const directorReady = briefConversation.state.kind === 'ready';
  const [visualSuggestions, setVisualSuggestions] = useState(0);

  useEffect(() => {
    if (visualSuggestions === 0 || !directorReady) return;
    const focusComposer = (): boolean => {
      const composer = document.querySelector<HTMLElement>('[data-studio-director] textarea');
      if (composer === null) return false;
      composer.focus();
      return document.activeElement === composer;
    };
    // The reveal commits with this effect's own render, so the composer is normally focusable by
    // now. It is not guaranteed to be — the overlay animates in — so keep watching until it takes.
    if (focusComposer()) return;
    const observer = new MutationObserver(() => {
      if (focusComposer()) observer.disconnect();
    });
    observer.observe(document.body, { attributes: true, childList: true, subtree: true });
    return () => observer.disconnect();
  }, [directorReady, visualSuggestions]);

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
                  revealDirector();
                  setVisualSuggestions((count) => count + 1);
                }}
                onRemove={() => editor.removeScene(scene.id)}
                onMove={(direction) => editor.moveScene(scene.id, direction)}
              />
            );
          })}
        </ScriptTable>
      </div>
    </section>
  );
};
