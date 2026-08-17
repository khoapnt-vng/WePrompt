/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { StudioRendererJob, StudioScene } from '@/common/types/project/creativeStudioTypes';
import { Button, Progress } from '@arco-design/web-react';
import { VideoOne } from '@icon-park/react';
import React from 'react';
import { useTranslation } from 'react-i18next';

import type { StudioSceneStatus } from '../../../../studioReadiness';
import { useStudioVideoPosterCapture } from '../../../../hooks/useStudioVideoPosterCapture';
import { describeSceneRenderBlockMessage, type StudioSceneRenderBlock } from '../../../Generation/generationRequests';
import styles from './produce.module.css';

export type ShotCardProps = {
  projectId: string;
  scene: StudioScene;
  index: number;
  status: StudioSceneStatus;
  selected: boolean;
  selectedTakeSource: string | null;
  selectedTakeId: string | null;
  posterSource: string | null;
  takeCurrent: number;
  takeTotal: number;
  displayedJob: StudioRendererJob | null;
  mutationPending: boolean;
  cancelPending: boolean;
  renderBlock: StudioSceneRenderBlock | null;
  renderDisabled: boolean;
  onSelect: () => void;
  onOpenPreview: () => void;
  onWriteVisual: () => void;
  onFocusEngineRole: () => void;
  onRemoveReference: () => void;
  onShorten: () => void;
  onOpenReview: () => void;
  onCancelJob: (jobId: string) => void | Promise<unknown>;
};

/** A 16:9 Produce canvas with canonical take, progress, and review actions. */
export const ShotCard: React.FC<ShotCardProps> = ({
  projectId,
  scene,
  index,
  status,
  selected,
  selectedTakeSource,
  selectedTakeId,
  posterSource,
  takeCurrent,
  takeTotal,
  displayedJob,
  mutationPending,
  cancelPending,
  renderBlock,
  renderDisabled,
  onSelect,
  onOpenPreview,
  onWriteVisual,
  onFocusEngineRole,
  onRemoveReference,
  onShorten,
  onOpenReview,
  onCancelJob,
}) => {
  const { t } = useTranslation();
  const sceneLabel = t('conversation.creativeStudio.scene.accessibleName', {
    number: index + 1,
    title: scene.title,
  });
  const hasSelectedTake = selectedTakeSource !== null;
  const previewLabel = t('conversation.creativeStudio.phase.produce.openPreview', { title: scene.title });
  const posterCaptureState = useStudioVideoPosterCapture({
    projectId,
    sceneId: scene.id,
    videoAssetId: selectedTakeId,
    enabled: scene.mediaKind === 'video' && selectedTakeId !== null && posterSource === null,
  });
  const renderBlockMessage = renderBlock === null ? null : describeSceneRenderBlockMessage(renderBlock);
  const renderBlockReason = renderBlockMessage === null ? null : t(renderBlockMessage.key, renderBlockMessage.values);
  const renderBlockDescriptionId = `studio-shot-render-block-${scene.id}`;
  const canSetEngines =
    renderBlock !== null &&
    ['no_engine', 'needs_setup', 'retired', 'project_frame', 'frame', 'resolution', 'first_frame'].includes(
      renderBlock.code
    );

  return (
    <li aria-label={sceneLabel} data-selected={selected || undefined} className={styles.shotCard}>
      <div className={styles.canvas}>
        {hasSelectedTake ? (
          <Button type='text' className={styles.previewButton} aria-label={previewLabel} onClick={onOpenPreview}>
            {scene.mediaKind === 'image' ? (
              <img
                alt={t('conversation.creativeStudio.preview.imageAlt')}
                className={styles.previewImage}
                src={selectedTakeSource}
              />
            ) : posterSource !== null ? (
              <img
                alt={t('conversation.creativeStudio.preview.videoLabel')}
                className={styles.previewImage}
                src={posterSource}
              />
            ) : (
              <span
                role='img'
                aria-label={t('conversation.creativeStudio.preview.videoLabel')}
                className={styles.videoPlaceholder}
                data-poster-capture={posterCaptureState}
              >
                <VideoOne aria-hidden='true' />
                <span>{t('conversation.creativeStudio.preview.videoReady')}</span>
              </span>
            )}
          </Button>
        ) : (
          <div className={styles.emptyCanvas}>
            <span className={styles.emptyLabel}>{t('conversation.creativeStudio.phase.produce.noVisualYet')}</span>
            <Button size='small' disabled={mutationPending} onClick={onWriteVisual}>
              {t('conversation.creativeStudio.phase.produce.writeVisual')}
            </Button>
          </div>
        )}
      </div>

      <div className={styles.shotBody}>
        <div className={styles.shotTitleRow}>
          <Button
            type='text'
            className={styles.shotTitleButton}
            aria-label={sceneLabel}
            aria-current={selected ? 'true' : undefined}
            disabled={mutationPending}
            onClick={onSelect}
          >
            <span className={styles.shotNumber}>
              {t('conversation.creativeStudio.scene.number', { number: index + 1 })}
            </span>
            <span className={styles.shotTitle}>{scene.title}</span>
          </Button>
          <span className={styles.takeRatio}>
            {t('conversation.creativeStudio.phase.produce.takeRatio', {
              current: takeCurrent,
              total: takeTotal,
            })}
          </span>
        </div>

        <div className={styles.shotMeta}>
          <span className={styles.statusLabel}>
            <span aria-hidden='true' data-status={status} className={styles.statusDot} />
            {t(`conversation.creativeStudio.scene.status.${status}`)}
          </span>
          <span>
            {t('conversation.creativeStudio.scene.durationSeconds', {
              count: scene.durationSeconds,
              seconds: scene.durationSeconds,
            })}
          </span>
        </div>

        {typeof displayedJob?.progress === 'number' && (
          <div className={styles.progressRow}>
            <Progress percent={displayedJob.progress} size='small' showText={false} />
            <span>{t('conversation.creativeStudio.jobs.progress', { percent: displayedJob.progress })}</span>
          </div>
        )}

        <div className={styles.shotActions}>
          {displayedJob?.canCancel === true && (
            <Button size='mini' disabled={cancelPending} onClick={() => void onCancelJob(displayedJob.id)}>
              {t('conversation.creativeStudio.jobs.cancel')}
            </Button>
          )}
          {renderBlock?.code === 'first_frame' && (
            <Button size='mini' disabled={mutationPending} onClick={onRemoveReference}>
              {t('conversation.creativeStudio.models.blocked.actionRemoveReference')}
            </Button>
          )}
          {canSetEngines && (
            <Button size='mini' disabled={mutationPending} onClick={onFocusEngineRole}>
              {t('conversation.creativeStudio.models.blocked.actionSetEngines')}
            </Button>
          )}
          {renderBlock?.code === 'duration' && (
            <Button size='mini' disabled={mutationPending} onClick={onShorten}>
              {t('conversation.creativeStudio.models.blocked.actionShorten')}
            </Button>
          )}
          <Button
            type='primary'
            size='small'
            disabled={mutationPending || renderDisabled || renderBlock !== null}
            aria-describedby={renderBlock === null ? undefined : renderBlockDescriptionId}
            onClick={onOpenReview}
          >
            {t(
              takeTotal > 0
                ? 'conversation.creativeStudio.phase.produce.renderAnother'
                : 'conversation.creativeStudio.phase.produce.render'
            )}
          </Button>
        </div>
        {renderBlockReason !== null && (
          <>
            <span className='text-12px text-t-secondary'>{renderBlockReason}</span>
            <span id={renderBlockDescriptionId} className='sr-only'>
              {t('conversation.creativeStudio.models.blocked.aria', { reason: renderBlockReason })}
            </span>
          </>
        )}
      </div>
    </li>
  );
};
