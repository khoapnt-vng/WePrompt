/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button } from '@arco-design/web-react';
import { Download, Right } from '@icon-park/react';
import React, { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import type { SelectedSceneSaveState } from '../../hooks/useStoryboardEditor';
import type { StudioView } from '../../studioPhaseRoute';
import { BriefPhase, ProducePhase, ReviewPhase, WritePhase } from './phases';
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
  const headerAction = (() => {
    switch (activeView) {
      case 'brief':
        return undefined;
      case 'table':
        return (
          <Button
            type='primary'
            disabled={navigationDisabled || controller.mutationPending}
            onClick={() => controller.requestTransition({ view: 'board' })}
          >
            {t('conversation.creativeStudio.phase.write.continueToProduce')}
            <Right aria-hidden='true' />
          </Button>
        );
      case 'board':
        return (
          <Button
            type='primary'
            disabled={navigationDisabled || controller.mutationPending}
            onClick={() => controller.requestTransition({ view: 'cut' })}
          >
            {t('conversation.creativeStudio.phase.produce.reviewCut')}
            <Right aria-hidden='true' />
          </Button>
        );
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
            <Button size='small' disabled={navigationDisabled} onClick={controller.openRules}>
              {t('conversation.creativeStudio.rules.open')}
            </Button>
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
        {activeView === 'brief' && <BriefPhase controller={controller} layoutMode={layoutMode} />}
        {activeView === 'table' && <WritePhase controller={controller} layoutMode={layoutMode} />}
        {activeView === 'board' && <ProducePhase controller={controller} layoutMode={layoutMode} />}
        {activeView === 'cut' && <ReviewPhase controller={controller} layoutMode={layoutMode} />}
      </div>
    </div>
  );
};
