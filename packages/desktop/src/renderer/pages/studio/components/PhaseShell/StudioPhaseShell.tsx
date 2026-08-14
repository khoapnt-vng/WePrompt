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

/**
 * A runtime, written the way runtimes are written: `2:58`, and `1:04:12` past the hour.
 *
 * Not `178s`. The number this formats is what the finished cut will last, and a bare seconds count
 * stops being readable as a duration somewhere around a minute — which is inside this app's range,
 * not beyond it.
 */
const formatRuntime = (totalSeconds: number): string => {
  const whole = Number.isFinite(totalSeconds) && totalSeconds > 0 ? Math.round(totalSeconds) : 0;
  const seconds = String(whole % 60).padStart(2, '0');
  const minutes = Math.floor(whole / 60) % 60;
  const hours = Math.floor(whole / 3600);
  return hours === 0 ? `${minutes}:${seconds}` : `${hours}:${String(minutes).padStart(2, '0')}:${seconds}`;
};

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
      <div className={styles.viewRow}>
        <StudioViewSwitch
          activeView={activeView}
          disabled={navigationDisabled}
          onSelect={(view) => {
            if (view !== activeView) controller.requestTransition({ view });
          }}
        />
        {/*
         * Where the document stands, in the three numbers that answer it: how many shots, how long
         * they run, how many are finished. It replaces the rail's completion markers, which could
         * only say which of four steps you had walked past.
         *
         * The third number is `selectedAssetCount`, not `readySceneIds.length`. "Ready" means ready
         * *to generate*, so it empties out as shots get made — a progress reading taken from it
         * would count down to zero exactly as the film was finished.
         *
         * Not a live region, deliberately. Editing a shot's duration moves these numbers on every
         * keystroke, and `StudioDocumentActivity` already reserves the frame's one polite region
         * for job transitions, which are discrete and worth speaking.
         *
         * The `{' '}` are load-bearing. The middle dots are `aria-hidden`, so without a real text
         * node between the terms the paragraph's accessible text is "9 shots2:58 total2 rendered" —
         * three numbers spoken as one word. Whitespace-only text between flex items is not
         * rendered, so the spaces cost nothing on screen; the visible spacing is the row's `gap`.
         */}
        <p data-studio-state-readout className={styles.stateReadout}>
          <span>
            {t('conversation.creativeStudio.phase.shared.readoutShots', {
              count: controller.readiness.totalSceneCount,
            })}
          </span>{' '}
          <span aria-hidden='true' className={styles.activitySeparator}>
            ·
          </span>{' '}
          <span>
            {t('conversation.creativeStudio.phase.shared.readoutDuration', {
              duration: formatRuntime(controller.readiness.durationTotalSeconds),
            })}
          </span>{' '}
          <span aria-hidden='true' className={styles.activitySeparator}>
            ·
          </span>{' '}
          <span>
            {t('conversation.creativeStudio.phase.shared.readoutRendered', {
              count: controller.readiness.selectedAssetCount,
            })}
          </span>
        </p>
      </div>
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
