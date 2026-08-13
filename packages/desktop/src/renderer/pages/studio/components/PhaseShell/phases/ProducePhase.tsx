/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button } from '@arco-design/web-react';
import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { buildBatchGenerationReviewRequest, GenerationJobList } from '../../Generation';
import { StudioModelBar } from '../../Models';
import type { ProducePhaseController } from '../types';
import type { StudioLayoutMode } from '../useStudioLayoutMode';
import { ConnectEngineCard, getReadySelectedRoutes, ShotGrid } from './produce';
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
    advisory,
    mutationPending,
    requestTransition,
    openSingleGenerationReview,
    openBatchGenerationReview,
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
  const batchReviewRequest = useMemo(
    () => buildBatchGenerationReviewRequest({ project, catalog: models.catalog }),
    [models.catalog, project]
  );
  const batchDisabled = generationBlocked || models.loading || readiness.readySceneIds.length < 1;

  if (readyRoutes.length === 0) {
    return (
      <section data-layout={layoutMode} className={styles.phase} aria-labelledby='studio-produce-phase-heading'>
        <ConnectEngineCard disabled={mutationPending} onOpenSettings={openModelSettings} />
      </section>
    );
  }

  return (
    <section data-layout={layoutMode} className={styles.phase} aria-labelledby='studio-produce-phase-heading'>
      <StudioModelBar
        catalog={models.catalog}
        disabled={mutationPending || editor.drafting || jobs.mutationPending}
        onOpenSettings={openModelSettings}
      />

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
          <div className={styles.batchFooter}>
            <Button
              type='primary'
              long
              disabled={batchDisabled}
              onClick={() => {
                if (!batchDisabled) openBatchGenerationReview(batchReviewRequest);
              }}
            >
              {t('conversation.creativeStudio.review.generateReadyScenes', {
                count: readiness.readySceneIds.length,
              })}
            </Button>
            {advisory?.anchor === 'batch' && (
              <p aria-live='polite' className={styles.batchAdvisory}>
                {t(advisory.messageKey)}
              </p>
            )}
          </div>
        </aside>
      </div>
    </section>
  );
};
