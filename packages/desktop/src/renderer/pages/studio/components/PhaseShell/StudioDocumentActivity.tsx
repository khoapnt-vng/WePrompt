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
 * flight" renders as an empty region rather than as no region. Nothing in the stylesheet may
 * take it out of the accessibility tree either, which is why the idle indicator collapses
 * through `data-idle` (a cancelled row gap) rather than through `display: none`.
 *
 * What the region holds is deliberately narrow. The job count changes on discrete status
 * transitions, so it is worth speaking. Render progress is not: `renderService` suppresses only
 * byte-identical updates and ffmpeg emits progress many times a second, so a single cut render
 * would queue on the order of a hundred spoken announcements. The percentage is therefore a
 * `progressbar` value outside the region — read on demand, never as a live-region update — and
 * stays visible text on screen.
 */
export const StudioDocumentActivity: React.FC<StudioDocumentActivityProps> = ({ jobs, render }) => {
  const { t } = useTranslation();
  const generatingCount = jobs.filter((job) => IN_FLIGHT_JOB_STATUSES.has(job.status)).length;
  // `busy` marks a render this document started in another window. It is still this document's
  // render, so the frame reports it rather than hiding work that is running.
  const rendering = render.status === 'running';
  const percent = renderPercent(render.progress);

  return (
    <div
      data-studio-document-activity
      data-idle={generatingCount === 0 && !rendering ? 'true' : undefined}
      className={styles.activity}
    >
      <span
        role='status'
        aria-live='polite'
        aria-atomic='true'
        aria-label={t('conversation.creativeStudio.phase.shared.activityLabel')}
        className={styles.activityLive}
      >
        {generatingCount > 0 &&
          t('conversation.creativeStudio.phase.shared.activityGenerating', { count: generatingCount })}
      </span>
      {generatingCount > 0 && rendering && (
        <span aria-hidden='true' className={styles.activitySeparator}>
          ·
        </span>
      )}
      {rendering && (
        <span
          role='progressbar'
          aria-label={t('conversation.creativeStudio.phase.shared.activityRenderingLabel')}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          className={styles.activityItem}
        >
          {t('conversation.creativeStudio.phase.shared.activityRendering', { percent })}
        </span>
      )}
    </div>
  );
};
