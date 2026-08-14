/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button } from '@arco-design/web-react';
import { Download } from '@icon-park/react';
import React, { useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import type { SelectedSceneSaveState } from '../../hooks/useStoryboardEditor';
import type { StudioView } from '../../studioPhaseRoute';
import { buildBatchGenerationReviewRequest } from '../Generation';
import { ProducePhase, ReviewPhase, WritePhase } from './phases';
import { getReadySelectedRoutes } from './phases/produce';
import { StudioDocumentActivity } from './StudioDocumentActivity';
import { StudioPhaseHeader } from './StudioPhaseHeader';
import { StudioViewSwitch } from './StudioViewSwitch';
import type { StudioPhaseControllers } from './types';
import { useStudioLayoutMode } from './useStudioLayoutMode';
import { useStudioLayoutContext } from '../Shell/StudioLayoutContext';
import styles from './StudioPhaseShell.module.css';

export type StudioPhaseShellProps = {
  activeView: StudioView;
  controller: StudioPhaseControllers;
  navigationDisabled: boolean;
  notice?: React.ReactNode;
  onBack: () => void;
};

export const StudioPhaseShell: React.FC<StudioPhaseShellProps> = ({
  activeView,
  controller,
  navigationDisabled,
  notice,
  onBack,
}) => {
  const { t } = useTranslation();
  const previousViewRef = useRef(activeView);
  // The shell owns the single measurement; fall back to measuring only if rendered without it.
  const measured = useStudioLayoutMode(controller.project.id);
  const layoutMode = useStudioLayoutContext(measured.layoutMode);

  useEffect(() => {
    if (previousViewRef.current === activeView) return;
    previousViewRef.current = activeView;
    if (activeView === 'table' && controller.writeFocusIntent !== null) return;
    const frame = requestAnimationFrame(() => {
      document.querySelector<HTMLElement>('[data-studio-phase-heading]')?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [activeView, controller.writeFocusIntent]);

  const shellSaveState: SelectedSceneSaveState = (() => {
    const states = new Set([controller.editor.projectSaveState, ...Object.values(controller.editor.sceneSaveStates)]);
    if (states.has('failed')) return 'failed';
    if (states.has('saving')) return 'saving';
    if (controller.editor.hasUnsavedProjectDraft || controller.editor.hasUnsavedSceneDrafts) return 'dirty';
    return 'saved';
  })();
  /**
   * The header carries an action only where one acts on the document.
   *
   * Table and Board offer none. They used to hold the phase rail's step-forward
   * buttons, which outlived the rail here; a switch has no next step, since every view is already
   * visible and one click away, and both buttons read "Continue" while going to different places.
   * Cut's handoff stays because it opens export — an action on the document, not progression
   * through it.
   */
  const headerAction = (() => {
    switch (activeView) {
      case 'table':
      case 'board':
        return undefined;
      case 'cut':
        return (
          <Button
            type='primary'
            icon={<Download />}
            disabled={navigationDisabled || controller.mutationPending || controller.readiness.selectedAssetCount === 0}
            onClick={controller.openExport}
          >
            {t('conversation.creativeStudio.phase.review.handoff')}
          </Button>
        );
    }
  })();

  /**
   * The document's one paid control.
   *
   * `studioJobs.submitScenes` is the only spend Studio has — rendering the cut shells out to a
   * local ffmpeg with no provider — so it belongs to the frame rather than to one view, and the
   * frame is where a reader can find it without first guessing which view holds it.
   *
   * It disappears rather than greys out when the workspace has no ready engine, which is the same
   * predicate that puts Board behind `ConnectEngineCard`: there is nothing to spend against, and a
   * disabled button named "Generate…" still tells a screen reader that generation is on this screen.
   */
  const batchReviewRequest = useMemo(
    () => buildBatchGenerationReviewRequest({ project: controller.project, catalog: controller.models.catalog }),
    [controller.models.catalog, controller.project]
  );
  const readyRouteCount = getReadySelectedRoutes(controller.models.catalog).length;
  // Carried over from Produce term for term, and every term is load-bearing: a click here submits
  // paid work against whatever the main process last persisted, so an unflushed draft, an
  // unresolved conflict or an in-flight mutation must all hold it shut. `navigationDisabled` is the
  // one addition — the control now sits beside Brief, Rules and the handoff, which it already
  // blocks, and it is raised exactly while a review, duplicate-charge or export dialog is open.
  const batchDisabled =
    navigationDisabled ||
    controller.editor.hasUnsavedProjectDraft ||
    controller.editor.hasUnsavedSceneDrafts ||
    controller.editor.conflict !== null ||
    controller.editor.drafting ||
    controller.mutationPending ||
    controller.models.loading ||
    controller.readiness.readySceneIds.length < 1;
  const batchAction =
    readyRouteCount === 0 ? undefined : (
      <div data-studio-batch-control className={styles.batchControl}>
        {/*
         * Weight tracks availability, which is not a style preference here.
         *
         * The label counts the shots a click would charge for, so it spends most of a project's
         * life reading "Generate 0 ready scenes" — everything generated, or nothing ready yet. A
         * permanent primary block in the frame saying "0" is the loudest thing on every view while
         * being the one thing that cannot be done. Rendered flat while it is shut, it sits with
         * Brief and Rules and takes the emphasis back the moment there is something to spend on.
         * `size='small'` for the same reason: this row is small buttons.
         */}
        <Button
          size='small'
          type={batchDisabled ? 'default' : 'primary'}
          disabled={batchDisabled}
          onClick={() => {
            if (!batchDisabled) controller.openBatchGenerationReview(batchReviewRequest);
          }}
        >
          {t('conversation.creativeStudio.review.generateReadyScenes', {
            count: controller.readiness.readySceneIds.length,
          })}
        </Button>
        {/* Follows its control into the frame, and stays out of the shell's `role='alert'` region:
            the advisory is about this button, so it is announced politely beside it rather than
            interrupting as a document-level alert. `anchor` is what keeps the two distinguishable. */}
        {controller.advisory?.anchor === 'batch' && (
          <p aria-live='polite' className={styles.batchAdvisory}>
            {t(controller.advisory.messageKey)}
          </p>
        )}
      </div>
    );

  // Named so the e2e spec can address the phase shell's own header and advisory directly. It used
  // to reach them by counting anonymous divs down from the work panel, which broke the moment the
  // panel gained a scroll box — a hook cannot be broken by inserting a wrapper above it.
  return (
    <div data-studio-phase-shell data-layout={layoutMode} className={styles.shell}>
      <StudioPhaseHeader
        project={controller.project}
        saveState={shellSaveState}
        onBack={onBack}
        onRenameProject={async (name) => {
          controller.editor.updateProjectDraft({ name });
          return controller.editor.flushProjectDraft();
        }}
        activity={<StudioDocumentActivity jobs={controller.jobs.jobs} render={controller.render} />}
        actions={
          <>
            <Button size='small' disabled={navigationDisabled} onClick={controller.openBrief}>
              {t('conversation.creativeStudio.phase.brief.title')}
            </Button>
            <Button size='small' disabled={navigationDisabled} onClick={controller.openRules}>
              {t('conversation.creativeStudio.rules.open')}
            </Button>
            {batchAction}
            {headerAction}
          </>
        }
      />
      <StudioViewSwitch
        activeView={activeView}
        disabled={navigationDisabled}
        onSelect={(view) => {
          if (view !== activeView) controller.requestTransition({ view });
        }}
      />
      {controller.advisory?.anchor === 'shell' && (
        <div role='alert' className={styles.shellAdvisory}>
          {t(controller.advisory.messageKey)}
        </div>
      )}
      {notice}
      <div className={styles.phaseFrame}>
        {activeView === 'table' && <WritePhase controller={controller} layoutMode={layoutMode} />}
        {activeView === 'board' && <ProducePhase controller={controller} layoutMode={layoutMode} />}
        {activeView === 'cut' && <ReviewPhase controller={controller} layoutMode={layoutMode} />}
      </div>
    </div>
  );
};
