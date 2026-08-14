/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { EngineStrip, getReadySelectedRoutes } from '../../EngineStrip';
import { GenerationJobList } from '../../Generation';
import type { ProducePhaseController } from '../types';
import type { StudioLayoutMode } from '../useStudioLayoutMode';
import { ConnectEngineCard, ShotGrid } from './produce';
import styles from './produce/produce.module.css';

export type ProducePhaseProps = {
  controller: ProducePhaseController;
  layoutMode?: StudioLayoutMode;
};

export const ProducePhase: React.FC<ProducePhaseProps> = ({ controller, layoutMode = 'inline' }) => {
  const { t } = useTranslation();
  const {
    project,
    readiness,
    editor,
    models,
    jobs,
    mutationPending,
    requestTransition,
    openSingleGenerationReview,
    openModelSettings,
    openDuplicateChargeConfirmation,
  } = controller;
  const orderedScenes = useMemo(
    () =>
      project.sceneOrder.flatMap((sceneId) => {
        const candidate = project.scenes[sceneId];
        return candidate?.id === sceneId ? [candidate] : [];
      }),
    [project]
  );
  const sceneTitles = useMemo(
    () => Object.fromEntries(orderedScenes.map((candidate) => [candidate.id, candidate.title])),
    [orderedScenes]
  );
  const readyRoutes = getReadySelectedRoutes(models.catalog);
  const generationBlocked =
    editor.hasUnsavedProjectDraft ||
    editor.hasUnsavedSceneDrafts ||
    editor.conflict !== null ||
    editor.drafting ||
    mutationPending;
  const generationActionIssue =
    jobs.issue?.jobId !== undefined && jobs.jobs.some((candidate) => candidate.id === jobs.issue?.jobId)
      ? { jobId: jobs.issue.jobId, code: jobs.issue.code, messageKey: jobs.issue.messageKey }
      : null;

  return (
    <section data-layout={layoutMode} className={styles.phase} aria-labelledby='studio-produce-phase-heading'>
      {/* The Board view's focus target. StudioPhaseShell focuses [data-studio-phase-heading] after
          every view change, so it must name the view — the engine strip names the engine. */}
      <h2 id='studio-produce-phase-heading' data-studio-phase-heading tabIndex={-1} className='sr-only'>
        {t('conversation.creativeStudio.phase.produce.title')}
      </h2>
      <EngineStrip
        project={project}
        models={models}
        variant='full'
        openModelSettings={openModelSettings}
      />

      {readyRoutes.length === 0 ? (
        <ConnectEngineCard disabled={mutationPending} onOpenSettings={openModelSettings} />
      ) : (
        <div className={styles.content}>
          <ShotGrid
            project={project}
            scenes={orderedScenes}
            sceneStatuses={readiness.sceneStatuses}
            selectedSceneId={editor.selectedSceneId}
            catalog={models.catalog}
            catalogLoading={models.loading}
            generationDisabled={generationBlocked}
            mutationPending={mutationPending}
            jobs={jobs.jobs}
            jobsMutationPending={jobs.mutationPending}
            onSelectScene={editor.selectScene}
            onWriteVisual={(sceneId) => {
              editor.selectScene(sceneId);
              requestTransition({
                view: 'table',
                state: { writeFocus: { sceneId, field: 'visualPrompt' } },
              });
            }}
            onOpenSingleReview={openSingleGenerationReview}
            onCancelJob={jobs.cancelJob}
          />

          {/* The activity feed only. The batch control that used to close this column is the
            document's one spend, so it moved to the frame's top bar with its advisory — a paid
            action reachable from one view was reachable only by knowing which view held it. */}
          <aside className={styles.activityColumn}>
            <div className={styles.activityList}>
              <GenerationJobList
                jobs={jobs.jobs}
                sceneTitles={sceneTitles}
                disabled={generationBlocked}
                pendingJobIds={jobs.mutationPending ? jobs.jobs.map((candidate) => candidate.id) : []}
                actionIssue={generationActionIssue}
                onCancelJob={jobs.cancelJob}
                onRetryJob={jobs.retryJob}
                onRetryDownload={jobs.retryDownload}
                onReviewUnknownSubmission={openDuplicateChargeConfirmation}
              />
            </div>
          </aside>
        </div>
      )}
    </section>
  );
};
