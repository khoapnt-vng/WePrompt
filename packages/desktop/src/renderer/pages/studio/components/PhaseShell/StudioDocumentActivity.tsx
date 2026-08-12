/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { StudioRendererJob } from '@/common/types/project/creativeStudioTypes';
import React from 'react';
import { useTranslation } from 'react-i18next';

import type { UseStudioRenderResult } from '../../hooks/useStudioRender';
import styles from './StudioPhaseShell.module.css';

/**
 * Work the provider is actually doing. `needs_attention` is deliberately absent: it is a job
 * that has stopped and is waiting on a human, so counting it here would report generation in
 * progress when none is. This is the same set studioReadiness, ShotGrid and the Produce feed's
 * own running count already use.
 */
const IN_FLIGHT_JOB_STATUSES = new Set<StudioRendererJob['status']>([
  'queued_local',
  'submitting',
  'queued_remote',
  'running',
]);

export type StudioDocumentActivityProps = {
  jobs: StudioRendererJob[];
  render: UseStudioRenderResult;
};

const renderPercent = (progress: number): number => {
  if (!Number.isFinite(progress)) return 0;
  return Math.min(100, Math.max(0, Math.round(progress * 100)));
};

/**
 * The document's in-flight work, aggregated for the app frame.
 *
 * Only totals live here. Per-job detail belongs to Produce's feed and per-shot progress to the
 * shot card; restating either would put the same fact in two places that can disagree.
 *
 * The live region is mounted for the document's whole life and only its text changes: a region
 * inserted into the DOM already carrying content is unreliably announced, so "nothing in
 * flight" renders as an empty region rather than as no region.
 */
export const StudioDocumentActivity: React.FC<StudioDocumentActivityProps> = ({ jobs, render }) => {
  const { t } = useTranslation();
  const generatingCount = jobs.filter((job) => IN_FLIGHT_JOB_STATUSES.has(job.status)).length;
  // `busy` marks a render this document started in another window. It is still this document's
  // render, so the frame reports it rather than hiding work that is running.
  const rendering = render.status === 'running';

  return (
    <div
      role='status'
      aria-live='polite'
      aria-atomic='true'
      aria-label={t('conversation.creativeStudio.phase.shared.activityLabel')}
      data-studio-document-activity
      className={styles.activity}
    >
      {generatingCount > 0 && (
        <span className={styles.activityItem}>
          {t('conversation.creativeStudio.phase.shared.activityGenerating', { count: generatingCount })}
        </span>
      )}
      {generatingCount > 0 && rendering && (
        <span aria-hidden='true' className={styles.activitySeparator}>
          ·
        </span>
      )}
      {rendering && (
        <span className={styles.activityItem}>
          {t('conversation.creativeStudio.phase.shared.activityRendering', { percent: renderPercent(render.progress) })}
        </span>
      )}
    </div>
  );
};
