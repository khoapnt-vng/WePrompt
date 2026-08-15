/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Drawer, Input, InputNumber, Select } from '@arco-design/web-react';
import { CloseSmall } from '@icon-park/react';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { StudioAspectRatio, StudioBriefReferenceRole } from '@/common/types/project/creativeStudioTypes';
import { EngineStrip } from '../../EngineStrip';
import type { StudioPhaseControllers } from '../types';
import styles from './StudioBriefDrawer.module.css';
import { StudioBriefReferences } from './StudioBriefReferences';

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

export type StudioBriefDrawerController = Pick<
  StudioPhaseControllers,
  'project' | 'editor' | 'models' | 'mutationPending' | 'generationReviewOpen'
> & {
  briefReferenceMutationPending: boolean;
  briefReferenceIssueMessageKey: string | null;
  addBriefReference: (role: StudioBriefReferenceRole) => Promise<string | null>;
  removeBriefReference: (assetId: string) => Promise<boolean>;
  openModelSettings: (path: '/settings/model') => void;
};

export type StudioBriefDrawerProps = {
  visible: boolean;
  controller: StudioBriefDrawerController;
  onClose: () => void;
};

/** Project-draft settings that stay available from every Studio view. */
export const StudioBriefDrawer: React.FC<StudioBriefDrawerProps> = ({ visible, controller, onClose }) => {
  const { t } = useTranslation();
  const {
    project,
    editor,
    models,
    mutationPending,
    generationReviewOpen,
    briefReferenceMutationPending,
    briefReferenceIssueMessageKey,
    addBriefReference,
    removeBriefReference,
    openModelSettings,
  } = controller;
  const [closing, setClosing] = useState(false);
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

  const close = async (): Promise<void> => {
    if (closing) return;
    setClosing(true);
    try {
      await editor.flushProjectDraft();
    } finally {
      setClosing(false);
      onClose();
    }
  };

  return (
    <Drawer
      visible={visible}
      title={t('conversation.creativeStudio.phase.brief.title')}
      width={480}
      footer={null}
      closable={false}
      unmountOnExit
      maskClosable={!closing}
      escToExit={!closing}
      onCancel={() => void close()}
    >
      <div role='dialog' aria-label={t('conversation.creativeStudio.phase.brief.title')} className={styles.body}>
        <Button
          type='text'
          aria-label={t('common.close')}
          className={styles.close}
          icon={<CloseSmall aria-hidden='true' />}
          loading={closing}
          onClick={() => void close()}
        />
        <div className={styles.intro}>
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

          <div className={styles.constraintsRow} data-studio-brief-constraints>
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
          <StudioBriefReferences
            project={project}
            models={models}
            pending={briefReferenceMutationPending}
            issueMessageKey={briefReferenceIssueMessageKey}
            onAdd={addBriefReference}
            onRemove={removeBriefReference}
            openModelSettings={() => openModelSettings('/settings/model')}
          />
          <div className={styles.engineStrip} data-studio-engine-scope={visible ? 'brief' : undefined}>
            <EngineStrip
              project={project}
              models={models}
              variant='compact'
              locked={generationReviewOpen}
              openModelSettings={openModelSettings}
            />
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
      </div>
    </Drawer>
  );
};
