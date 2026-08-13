/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@arco-design/web-react';

import { isCanonicalStudioGeneratedTake } from '@/common/types/project/creativeStudioCanonicalTake';
import { openExternalUrl } from '@renderer/utils/platform';
import { ReviewCut, createManagedStudioAssetUrl, studioShotNumbers } from '../../Preview';
import { useCutEditor } from '../../../hooks';
import type { ReviewPhaseController } from '../types';
import type { StudioLayoutMode } from '../useStudioLayoutMode';
import styles from './ReviewPhase.module.css';

export type ReviewPhaseProps = {
  controller: ReviewPhaseController;
  layoutMode?: StudioLayoutMode;
};

export const ReviewPhase: React.FC<ReviewPhaseProps> = ({ controller, layoutMode = 'inline' }) => {
  const { t } = useTranslation();
  const { readiness, editor, posterAsset, mutationPending, render, selectVariation } = controller;
  const cutEditor = useCutEditor(controller.project, controller.refreshProject);
  const { project } = cutEditor;
  const missingSlateCount = Math.max(0, readiness.totalSceneCount - readiness.selectedAssetCount);
  const canonicalMissingSceneIds = project.sceneOrder.filter((sceneId) => {
    const scene = project.scenes[sceneId];
    const asset = scene?.selectedAssetId === null ? undefined : project.assets[scene?.selectedAssetId ?? ''];
    return scene === undefined || asset === undefined || !isCanonicalStudioGeneratedTake(asset, project.id, scene);
  });
  const renderMissingSceneIds = render.missingSceneIds ?? canonicalMissingSceneIds;
  const renderSource = render.assetId === null ? null : createManagedStudioAssetUrl(project.id, render.assetId);
  const renderRunning = render.status === 'running';
  const renderPercent = Math.round(render.progress * 100);
  const busyReasonId = React.useId();
  const progressMessage = t(
    render.clipIndex === null || render.clipTotal === null
      ? 'conversation.creativeStudio.phase.review.render.progress'
      : 'conversation.creativeStudio.phase.review.render.progressWithClip',
    {
      percent: renderPercent,
      ...(render.clipIndex === null ? {} : { clip: render.clipIndex }),
      ...(render.clipTotal === null ? {} : { total: render.clipTotal }),
    }
  );
  const renderFailure = (() => {
    switch (render.errorCode) {
      case 'ffmpeg_unavailable':
        return {
          message: t('conversation.creativeStudio.phase.review.render.errors.ffmpegUnavailable'),
          action: t('conversation.creativeStudio.phase.review.render.installFfmpeg'),
          run: (): void => void openExternalUrl('https://ffmpeg.org/download.html'),
        };
      case 'render_failed':
        return {
          message:
            render.clipIndex === null || render.clipTotal === null
              ? t('conversation.creativeStudio.phase.review.render.errors.failed')
              : t('conversation.creativeStudio.phase.review.render.errors.failedClip', {
                  clip: render.clipIndex,
                  total: render.clipTotal,
                }),
          action: t('conversation.creativeStudio.phase.review.render.tryAgain'),
          run: (): void => void render.render(),
        };
      case 'no_renderable_scenes': {
        const shots = studioShotNumbers(project, render.missingSceneIds ?? canonicalMissingSceneIds);
        return {
          message:
            shots.length === 0
              ? t('conversation.creativeStudio.phase.review.render.errors.noRenderableScenes')
              : t('conversation.creativeStudio.phase.review.render.errors.noRenderableShots', {
                  count: shots.length,
                  shots: shots.join(', '),
                }),
          action: t('conversation.creativeStudio.phase.review.render.openProduce'),
          run: () => controller.requestTransition({ view: 'board' }),
        };
      }
      default:
        return null;
    }
  })();

  return (
    <section data-layout={layoutMode} className={styles.phase} aria-labelledby='studio-review-phase-heading'>
      <h2 id='studio-review-phase-heading' data-studio-phase-heading tabIndex={-1} className={styles.heading}>
        {t('conversation.creativeStudio.phase.review.title')}
      </h2>
      <p className={`${styles.description} m-0`}>{t('conversation.creativeStudio.phase.review.description')}</p>
      <div className={styles.workspace}>
        <ReviewCut
          cutEditor={cutEditor}
          layoutMode={layoutMode}
          readiness={readiness}
          selectedSceneId={editor.selectedSceneId}
          posterAsset={posterAsset}
          mutationPending={mutationPending || editor.hasUnsavedSceneDrafts}
          onSelectAsset={selectVariation}
          onSelectScene={editor.selectScene}
        />
        <footer aria-label={t('conversation.creativeStudio.phase.review.render.footer')} className={styles.renderFoot}>
          <div className={styles.handoffSummary}>
            <span data-render-count>
              {t('conversation.creativeStudio.phase.review.renderedShots', {
                count: readiness.selectedAssetCount,
              })}
            </span>
            <span data-render-count>
              {t('conversation.creativeStudio.phase.review.missingSlates', {
                count: missingSlateCount,
              })}
            </span>
          </div>
          <p data-render-footer-line className={`${styles.handoffDescription} m-0`}>
            {t('conversation.creativeStudio.phase.review.handoffDescription')}
          </p>
          {readiness.selectedAssetCount === 0 && (
            <p data-render-footer-line className={`${styles.handoffDescription} m-0`}>
              {t('conversation.creativeStudio.phase.review.noAssets')}
            </p>
          )}
          {renderMissingSceneIds.length > 0 && (
            <p data-render-footer-line className={`${styles.handoffDescription} m-0`}>
              {t('conversation.creativeStudio.phase.review.render.missingScenes', {
                count: renderMissingSceneIds.length,
              })}
            </p>
          )}
          <div
            data-render-state-slot
            data-render-state={
              render.busy
                ? 'busy'
                : renderRunning
                  ? 'running'
                  : renderFailure === null
                    ? render.status
                    : render.errorCode
            }
            className={styles.renderStateSlot}
          >
            {render.busy ? (
              <>
                <Button
                  type='primary'
                  data-render-primary-action
                  className={styles.renderPrimaryAction}
                  disabled
                  aria-describedby={busyReasonId}
                >
                  {progressMessage}
                </Button>
                <p id={busyReasonId} data-render-footer-line className={`${styles.handoffDescription} m-0`}>
                  {t('conversation.creativeStudio.phase.review.render.busyReason')}
                </p>
              </>
            ) : renderRunning ? (
              <>
                <Button
                  type='primary'
                  data-render-primary-action
                  className={styles.renderPrimaryAction}
                  disabled
                  loading
                >
                  {progressMessage}
                </Button>
                <div className={styles.renderStateSupport}>
                  <Button onClick={() => void render.cancel()}>
                    {t('conversation.creativeStudio.phase.review.render.cancel')}
                  </Button>
                </div>
              </>
            ) : renderFailure !== null ? (
              <>
                <Button
                  type='primary'
                  data-render-primary-action
                  className={styles.renderPrimaryAction}
                  onClick={renderFailure.run}
                >
                  {renderFailure.action}
                </Button>
                <p role='alert' data-render-footer-line className={`${styles.handoffDescription} m-0 text-danger`}>
                  {renderFailure.message}
                </p>
              </>
            ) : (
              <>
                <Button
                  type='primary'
                  data-render-primary-action
                  className={styles.renderPrimaryAction}
                  onClick={() => void render.render()}
                >
                  {t('conversation.creativeStudio.phase.review.render.action')}
                </Button>
                {render.errorCode === 'cancelled' && render.errorMessageKey !== null && (
                  <p role='status' data-render-footer-line className={`${styles.handoffDescription} m-0`}>
                    {t(render.errorMessageKey)}
                  </p>
                )}
              </>
            )}
          </div>
          {renderSource !== null && (
            <video
              aria-label={t('conversation.creativeStudio.phase.review.render.resultLabel')}
              className='w-full rounded-8px border border-border-2 bg-fill-1'
              src={renderSource}
              controls
              playsInline
              preload='metadata'
            />
          )}
        </footer>
      </div>
    </section>
  );
};
