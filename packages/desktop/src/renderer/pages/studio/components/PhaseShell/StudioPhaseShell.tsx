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
import type { StudioPhase } from '../../studioPhaseRoute';
import { BriefPhase, ProducePhase, ReviewPhase, WritePhase } from './phases';
import { StudioPhaseHeader } from './StudioPhaseHeader';
import { StudioPhaseNav } from './StudioPhaseNav';
import type { StudioPhaseControllers } from './types';
import { useStudioLayoutMode } from './useStudioLayoutMode';
import styles from './StudioPhaseShell.module.css';

export type StudioPhaseShellProps = {
  activePhase: StudioPhase;
  controller: StudioPhaseControllers;
  navigationDisabled: boolean;
  notice?: React.ReactNode;
  onBack: () => void;
};

export const StudioPhaseShell: React.FC<StudioPhaseShellProps> = ({
  activePhase,
  controller,
  navigationDisabled,
  notice,
  onBack,
}) => {
  const { t } = useTranslation();
  const previousPhaseRef = useRef(activePhase);
  const { containerRef, layoutMode } = useStudioLayoutMode(controller.project.id);

  useEffect(() => {
    if (previousPhaseRef.current === activePhase) return;
    previousPhaseRef.current = activePhase;
    if (activePhase === 'write' && controller.writeFocusIntent !== null) return;
    const frame = requestAnimationFrame(() => {
      document.querySelector<HTMLElement>('[data-studio-phase-heading]')?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [activePhase, controller.writeFocusIntent]);

  const shellSaveState: SelectedSceneSaveState = (() => {
    const states = new Set([controller.editor.projectSaveState, ...Object.values(controller.editor.sceneSaveStates)]);
    if (states.has('failed')) return 'failed';
    if (states.has('saving')) return 'saving';
    if (controller.editor.hasUnsavedProjectDraft || controller.editor.hasUnsavedSceneDrafts) return 'dirty';
    return 'saved';
  })();
  const headerAction = (() => {
    switch (activePhase) {
      case 'brief':
        return undefined;
      case 'write':
        return (
          <Button
            type='primary'
            disabled={navigationDisabled || controller.mutationPending}
            onClick={() => controller.requestTransition({ phase: 'produce' })}
          >
            {t('conversation.creativeStudio.phase.write.continueToProduce')}
            <Right aria-hidden='true' />
          </Button>
        );
      case 'produce':
        return (
          <Button
            type='primary'
            disabled={navigationDisabled || controller.mutationPending}
            onClick={() => controller.requestTransition({ phase: 'review' })}
          >
            {t('conversation.creativeStudio.phase.produce.reviewCut')}
            <Right aria-hidden='true' />
          </Button>
        );
      case 'review':
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

  return (
    <div ref={containerRef} data-studio-layout-root data-layout={layoutMode} className={styles.shell}>
      <StudioPhaseHeader
        project={controller.project}
        saveState={shellSaveState}
        onBack={onBack}
        onRenameProject={async (name) => {
          controller.editor.updateProjectDraft({ name });
          return controller.editor.flushProjectDraft();
        }}
        navigation={
          <StudioPhaseNav
            activePhase={activePhase}
            project={controller.project}
            readiness={controller.readiness}
            disabled={navigationDisabled}
            onSelect={(phase) => {
              if (phase !== activePhase) controller.requestTransition({ phase });
            }}
          />
        }
        actions={headerAction}
      />
      {controller.advisory?.anchor === 'shell' && (
        <div role='alert' className={styles.shellAdvisory}>
          {t(controller.advisory.messageKey)}
        </div>
      )}
      {notice}
      <div className={styles.phaseFrame}>
        {activePhase === 'brief' && <BriefPhase controller={controller} layoutMode={layoutMode} />}
        {activePhase === 'write' && <WritePhase controller={controller} layoutMode={layoutMode} />}
        {activePhase === 'produce' && <ProducePhase controller={controller} layoutMode={layoutMode} />}
        {activePhase === 'review' && <ReviewPhase controller={controller} layoutMode={layoutMode} />}
      </div>
    </div>
  );
};
