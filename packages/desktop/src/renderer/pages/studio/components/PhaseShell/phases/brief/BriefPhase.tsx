/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { StudioAspectRatio } from '@/common/types/project/creativeStudioTypes';
import { Button, Input, InputNumber, Select } from '@arco-design/web-react';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { BriefPhaseController } from '../../types';
import type { StudioLayoutMode } from '../../useStudioLayoutMode';
import styles from './BriefPhase.module.css';

const MAX_PROJECT_BRIEF_CHARS = 16 * 1024;
const ACTIVE_JOB_STATUSES = new Set(['queued_local', 'submitting', 'queued_remote', 'running', 'needs_attention']);
const ASPECT_RATIOS: StudioAspectRatio[] = ['16:9', '9:16', '1:1', '4:3', '3:4'];

const ASPECT_RATIO_LABEL_KEYS = {
  '16:9': 'conversation.creativeStudio.create.aspectRatio16x9',
  '9:16': 'conversation.creativeStudio.create.aspectRatio9x16',
  '1:1': 'conversation.creativeStudio.create.aspectRatio1x1',
  '4:3': 'conversation.creativeStudio.create.aspectRatio4x3',
  '3:4': 'conversation.creativeStudio.create.aspectRatio3x4',
} as const satisfies Record<StudioAspectRatio, string>;

export type BriefPhaseProps = {
  controller: BriefPhaseController;
  layoutMode?: StudioLayoutMode;
};

export const BriefPhase: React.FC<BriefPhaseProps> = ({ controller, layoutMode = 'inline' }) => {
  const { t } = useTranslation();
  const { project, editor, mutationPending, requestTransition } = controller;
  const [startingWrite, setStartingWrite] = useState(false);
  const projectConflict = editor.conflict?.operation === 'update_project' ? editor.conflict : null;
  const projectIssue = projectConflict ?? (editor.error?.operation === 'update_project' ? editor.error : null);
  const draft = editor.projectDraft ?? {
    brief: project.brief,
    aspectRatio: project.aspectRatio,
    targetDurationSeconds: project.targetDurationSeconds,
  };
  const invalidBrief = draft.brief.length > MAX_PROJECT_BRIEF_CHARS;
  const invalidDuration =
    !Number.isInteger(draft.targetDurationSeconds) ||
    draft.targetDurationSeconds < 5 ||
    draft.targetDurationSeconds > 60;
  const hasValidationError = invalidBrief || invalidDuration;
  const aspectLocked =
    Object.values(project.assets).some((asset) => asset.managedAsset.collection === 'assets') ||
    Object.values(project.jobs).some((job) => ACTIVE_JOB_STATUSES.has(job.status));
  const flushIfValid = (): void => {
    if (!hasValidationError) void editor.flushProjectDraft();
  };

  const startWriting = async (): Promise<void> => {
    if (hasValidationError || projectConflict !== null || mutationPending || startingWrite) return;
    setStartingWrite(true);
    try {
      if (await editor.flushProjectDraft()) requestTransition({ phase: 'write' });
    } finally {
      setStartingWrite(false);
    }
  };

  return (
    <section data-layout={layoutMode} className={styles.phase} aria-labelledby='studio-brief-phase-heading'>
      <div className={styles.intro}>
        <h2 id='studio-brief-phase-heading' data-studio-phase-heading tabIndex={-1} className={styles.heading}>
          {t('conversation.creativeStudio.phase.brief.title')}
        </h2>
        <p className={styles.introCopy}>{t('conversation.creativeStudio.phase.brief.description')}</p>
        <p className={styles.secondaryCopy}>{t('conversation.creativeStudio.phase.shared.noMediaGeneration')}</p>
      </div>

      <div className={styles.content}>
        <div className={styles.briefField}>
          <label htmlFor='studio-brief-text' className={styles.constraintLabel}>
            {t('conversation.creativeStudio.project.brief')}
          </label>
          <Input.TextArea
            id='studio-brief-text'
            value={draft.brief}
            error={invalidBrief}
            maxLength={MAX_PROJECT_BRIEF_CHARS}
            autoSize={{ minRows: 4, maxRows: 12 }}
            aria-label={t('conversation.creativeStudio.project.brief')}
            onChange={(brief) => editor.updateProjectDraft({ brief })}
            onBlur={flushIfValid}
          />
          {invalidBrief && (
            <span role='alert' className={styles.fieldError}>
              {t('conversation.creativeStudio.errors.invalidPayload')}
            </span>
          )}
        </div>

        <div className={styles.constraintsRow}>
          <div className={styles.constraint}>
            <label htmlFor='studio-brief-duration' className={styles.constraintLabel}>
              {t('conversation.creativeStudio.phase.brief.durationLabel')}
            </label>
            <InputNumber
              id='studio-brief-duration'
              aria-label={t('conversation.creativeStudio.phase.brief.durationLabel')}
              aria-valuemin={5}
              aria-valuemax={60}
              value={draft.targetDurationSeconds}
              min={5}
              max={60}
              precision={0}
              step={1}
              mode='button'
              className={styles.durationControl}
              error={invalidDuration}
              onChange={(targetDurationSeconds) => editor.updateProjectDraft({ targetDurationSeconds })}
              onBlur={flushIfValid}
            />
            {invalidDuration && (
              <span role='alert' className={styles.fieldError}>
                {t('conversation.creativeStudio.create.invalidDuration')}
              </span>
            )}
          </div>

          <div className={styles.constraint}>
            <label htmlFor='studio-brief-aspect' className={styles.constraintLabel}>
              {t('conversation.creativeStudio.phase.brief.aspectRatioLabel')}
            </label>
            <Select
              id='studio-brief-aspect'
              aria-label={t('conversation.creativeStudio.phase.brief.aspectRatioLabel')}
              className={styles.aspectControl}
              value={draft.aspectRatio}
              disabled={aspectLocked}
              onChange={(aspectRatio) => editor.updateProjectDraft({ aspectRatio: aspectRatio as StudioAspectRatio })}
              onBlur={flushIfValid}
            >
              {ASPECT_RATIOS.map((aspectRatio) => (
                <Select.Option key={aspectRatio} value={aspectRatio}>
                  {t(ASPECT_RATIO_LABEL_KEYS[aspectRatio])}
                </Select.Option>
              ))}
            </Select>
            {aspectLocked && (
              <div className={styles.lockHelp}>
                <strong>{t('conversation.creativeStudio.phase.brief.aspectLocked')}</strong>
                <span>{t('conversation.creativeStudio.phase.brief.aspectLockedHelp')}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {projectIssue !== null && (
        <div role='alert' className={styles.saveError}>
          {t(projectIssue.messageKey)}
        </div>
      )}
      {projectConflict !== null && (
        <div className={styles.conflictActions}>
          <Button type='primary' loading={mutationPending} onClick={() => void editor.retryConflict()}>
            {t('conversation.creativeStudio.storyboard.retry')}
          </Button>
          <Button disabled={mutationPending} onClick={editor.discardConflict}>
            {t('conversation.creativeStudio.storyboard.discard')}
          </Button>
        </div>
      )}
      {/* Save state is the frame's, not this phase's: StudioPhaseHeader carries the one live
          readout for the whole document. */}
      <footer className={styles.footer}>
        <Button
          type='primary'
          loading={startingWrite || editor.projectSaveState === 'saving'}
          disabled={hasValidationError || projectConflict !== null || mutationPending || startingWrite}
          onClick={() => void startWriting()}
        >
          {t('conversation.creativeStudio.phase.brief.startWriting')}
        </Button>
      </footer>
    </section>
  );
};
