/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  StudioAsset,
  StudioRendererProject,
  StudioRouteCatalog,
  StudioScene,
  StudioNormalisedRect,
} from '@/common/types/project/creativeStudioTypes';
import { Button, Slider } from '@arco-design/web-react';
import { Picture, VideoOne, VolumeUp } from '@icon-park/react';
import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { buildSingleSceneReviewRequest, type GenerationSingleReviewRequest } from '../Generation/generationRequests';
import { canOpenSingleSceneReview, deriveStudioReadiness } from '../../studioReadiness';
import studioType from '../../StudioTypography.module.css';
import {
  createManagedStudioAssetUrl,
  isCanonicalStudioPosterAsset,
  isCanonicalStudioSelectedAsset,
  isSafeStudioId,
} from './managedStudioAssets';
import styles from './CutEditor/cut-editor.module.css';

const SLATE_PREVIEW_STYLE = {
  background: 'var(--studio-slate-surface)',
  border: '1px dashed var(--studio-slate-border)',
} satisfies React.CSSProperties;

export type StagePreviewProps = {
  projectId: string;
  project?: StudioRendererProject;
  catalog?: StudioRouteCatalog | null;
  selectedScene: StudioScene | null;
  /** Canonical metadata for the selected generated output. Omitted only for the legacy ID-only caller. */
  selectedAsset?: StudioAsset | null;
  /** Canonical thumbnail resolved by the controller from the selected video's job lineage. */
  posterAsset?: StudioAsset | null;
  catalogLoading?: boolean;
  generationDisabled?: boolean;
  /** Review opts into a non-generating slate; Produce remains the default presentation. */
  presentation?: 'produce' | 'review';
  slate?: {
    title: string;
    durationSeconds: number;
  } | null;
  onOpenSingleReview?: (request: GenerationSingleReviewRequest) => void;
  crop?: StudioNormalisedRect | null;
  cropOverlayVisible?: boolean;
  cropDisabled?: boolean;
  seekSeconds?: number;
  playbackEndSeconds?: number;
  onPlaybackTimeChange?: (seconds: number) => void;
  onNudgeCrop?: (deltaX: number, deltaY: number) => void;
};

const StagePreview: React.FC<StagePreviewProps> = ({
  projectId,
  project,
  catalog,
  selectedScene,
  selectedAsset,
  posterAsset = null,
  catalogLoading = false,
  generationDisabled = false,
  presentation = 'produce',
  slate = null,
  onOpenSingleReview,
  crop = null,
  cropOverlayVisible = false,
  cropDisabled = false,
  seekSeconds,
  playbackEndSeconds,
  onPlaybackTimeChange,
  onNudgeCrop,
}) => {
  const { t } = useTranslation();
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const [volume, setVolume] = useState(1);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const volumeControlRef = useRef<HTMLLabelElement | null>(null);
  const mediaKind = selectedScene?.mediaKind ?? 'image';
  const accessibleName = t(
    mediaKind === 'video'
      ? 'conversation.creativeStudio.preview.videoLabel'
      : 'conversation.creativeStudio.preview.imageAlt'
  );
  const selectedAssetId = selectedScene?.selectedAssetId ?? null;
  const canonicalScene =
    project?.id === projectId && selectedScene !== null && project.scenes[selectedScene.id]?.id === selectedScene.id
      ? project.scenes[selectedScene.id]!
      : null;
  const sceneStatus =
    project === undefined || canonicalScene === null
      ? null
      : deriveStudioReadiness(project).sceneStatuses[canonicalScene.id];
  const singleReviewEligible =
    canonicalScene !== null && canOpenSingleSceneReview(sceneStatus, canonicalScene.visualPrompt);
  const singleReviewRequest =
    catalogLoading ||
    generationDisabled ||
    onOpenSingleReview === undefined ||
    canonicalScene === null ||
    !singleReviewEligible
      ? null
      : buildSingleSceneReviewRequest({
          project: project!,
          catalog: catalog ?? null,
          scene: canonicalScene,
          durationSeconds: canonicalScene.durationSeconds,
          hasReference: canonicalScene.referenceAssetId !== null,
        });

  useEffect(() => {
    setFailedSource(null);
  }, [selectedAssetId]);

  useEffect(() => {
    const video = videoRef.current;
    if (video === null || seekSeconds === undefined || !Number.isFinite(seekSeconds)) return;
    if (Math.abs(video.currentTime - seekSeconds) > 0.02) video.currentTime = seekSeconds;
  }, [seekSeconds, selectedAssetId]);

  useEffect(() => {
    volumeControlRef.current
      ?.querySelector<HTMLElement>('[role="slider"]')
      ?.setAttribute('aria-label', t('conversation.creativeStudio.phase.review.cut.volume'));
  }, [t, volume]);

  if (selectedAssetId === null) {
    const PlaceholderIcon = mediaKind === 'video' ? VideoOne : Picture;
    if (presentation === 'review' && slate !== null) {
      return (
        <section
          aria-label={t('conversation.creativeStudio.preview.title')}
          className='flex min-h-320px flex-col items-center justify-center gap-10px rounded-12px p-24px text-center'
          style={SLATE_PREVIEW_STYLE}
        >
          <div
            role='img'
            aria-label={accessibleName}
            className='flex h-64px w-64px items-center justify-center rounded-full bg-fill-2 text-30px text-t-tertiary'
          >
            <PlaceholderIcon />
          </div>
          <p className={`${studioType.eyebrow} m-0 text-t-tertiary`}>
            {t('conversation.creativeStudio.phase.review.slateLabel')}
          </p>
          <h2 className={`${studioType.cardTitle} m-0`}>{slate.title}</h2>
          <p className={`${studioType.meta} m-0`}>
            {t('conversation.creativeStudio.scene.durationSeconds', {
              count: slate.durationSeconds,
              seconds: slate.durationSeconds,
            })}
          </p>
          <p className={`${studioType.body} m-0 max-w-480px`}>
            {t('conversation.creativeStudio.phase.review.slateDescription')}
          </p>
          <p className={`${studioType.body} m-0 max-w-480px`}>
            {t('conversation.creativeStudio.phase.review.excludedFromHandoff')}
          </p>
        </section>
      );
    }
    return (
      <section
        aria-label={t('conversation.creativeStudio.preview.title')}
        className='flex min-h-320px flex-col items-center justify-center gap-10px rounded-12px p-24px text-center'
        style={SLATE_PREVIEW_STYLE}
      >
        <div
          role='img'
          aria-label={accessibleName}
          className='flex h-64px w-64px items-center justify-center rounded-full bg-fill-2 text-30px text-t-tertiary'
        >
          <PlaceholderIcon />
        </div>
        <h2 className={`${studioType.cardTitle} m-0`}>{t('conversation.creativeStudio.preview.noAssetTitle')}</h2>
        <p className={`${studioType.body} m-0 max-w-420px`}>
          {catalogLoading
            ? t('conversation.creativeStudio.models.loading')
            : selectedScene !== null && selectedScene.visualPrompt.trim().length === 0
              ? t('conversation.creativeStudio.preview.missingVisualPrompt')
              : project !== undefined && !generationDisabled && singleReviewEligible && singleReviewRequest === null
                ? t('conversation.creativeStudio.preview.missingModel')
                : t('conversation.creativeStudio.preview.noAssetBody')}
        </p>
        {singleReviewRequest !== null && (
          <Button type='primary' onClick={() => onOpenSingleReview(singleReviewRequest)}>
            {t('conversation.creativeStudio.preview.generateThisScene')}
          </Button>
        )}
      </section>
    );
  }

  const source = createManagedStudioAssetUrl(projectId, selectedAssetId);
  const hasCanonicalSceneIdentity = selectedScene !== null && isSafeStudioId(selectedScene.id);
  const hasCanonicalAssetIdentity =
    selectedScene?.assetIds.includes(selectedAssetId) === true &&
    (selectedAsset === undefined ||
      (selectedAsset !== null &&
        isCanonicalStudioSelectedAsset(selectedAsset, projectId, selectedScene, selectedAssetId)));
  if (source === null || !hasCanonicalSceneIdentity || !hasCanonicalAssetIdentity || failedSource === source) {
    return (
      <div
        role='alert'
        className='flex min-h-320px items-center justify-center rounded-12px border border-danger-3 bg-danger-light-1 p-24px text-center text-danger'
      >
        {t('conversation.creativeStudio.preview.loadFailed')}
      </div>
    );
  }

  const posterSource =
    mediaKind === 'video' &&
    selectedScene !== null &&
    posterAsset !== null &&
    isCanonicalStudioPosterAsset(posterAsset, projectId, selectedScene)
      ? createManagedStudioAssetUrl(projectId, posterAsset.id)
      : null;

  return (
    <figure
      aria-label={t('conversation.creativeStudio.preview.title')}
      className='m-0 flex min-h-320px flex-col items-center justify-center gap-10px overflow-hidden rounded-12px border border-border-2 bg-fill-1'
    >
      <div className={styles.stageFrame}>
        {mediaKind === 'video' ? (
          <video
            ref={videoRef}
            aria-label={accessibleName}
            className='max-h-70vh max-w-full object-contain'
            src={source}
            poster={posterSource ?? undefined}
            controls
            playsInline
            preload='metadata'
            onLoadedMetadata={(event) => {
              event.currentTarget.volume = volume;
            }}
            onPlay={(event) => {
              if (playbackEndSeconds !== undefined && event.currentTarget.currentTime >= playbackEndSeconds - 0.02) {
                event.currentTarget.currentTime = seekSeconds ?? 0;
              }
            }}
            onTimeUpdate={(event) => {
              if (playbackEndSeconds !== undefined && event.currentTarget.currentTime >= playbackEndSeconds) {
                event.currentTarget.pause();
                event.currentTarget.currentTime = playbackEndSeconds;
                onPlaybackTimeChange?.(playbackEndSeconds);
                return;
              }
              onPlaybackTimeChange?.(event.currentTarget.currentTime);
            }}
            onError={() => setFailedSource(source)}
          />
        ) : (
          <img
            alt={accessibleName}
            className='max-h-70vh max-w-full object-contain'
            src={source}
            onError={() => setFailedSource(source)}
          />
        )}
        {cropOverlayVisible && (
          <div
            role='group'
            tabIndex={cropDisabled ? -1 : 0}
            aria-label={t('conversation.creativeStudio.phase.review.cut.cropOverlay')}
            className={styles.cropOverlay}
            style={{
              left: `${(crop?.x ?? 0) * 100}%`,
              top: `${(crop?.y ?? 0) * 100}%`,
              width: `${(crop?.width ?? 1) * 100}%`,
              height: `${(crop?.height ?? 1) * 100}%`,
            }}
            onKeyDown={(event) => {
              const jump = event.shiftKey ? 0.1 : 0.01;
              const delta = (() => {
                switch (event.key) {
                  case 'ArrowLeft':
                    return [-jump, 0] as const;
                  case 'ArrowRight':
                    return [jump, 0] as const;
                  case 'ArrowUp':
                    return [0, -jump] as const;
                  case 'ArrowDown':
                    return [0, jump] as const;
                  default:
                    return null;
                }
              })();
              if (delta === null || cropDisabled) return;
              event.preventDefault();
              onNudgeCrop?.(delta[0], delta[1]);
            }}
          />
        )}
      </div>
      {mediaKind === 'video' ? (
        <>
          <label ref={volumeControlRef} className={styles.volumeControl}>
            <VolumeUp aria-hidden='true' />
            <span className='sr-only'>{t('conversation.creativeStudio.phase.review.cut.volume')}</span>
            <Slider
              aria-label={t('conversation.creativeStudio.phase.review.cut.volume')}
              min={0}
              max={1}
              step={0.05}
              value={volume}
              onChange={(value) => {
                if (typeof value !== 'number') return;
                setVolume(value);
                if (videoRef.current !== null) videoRef.current.volume = value;
              }}
            />
          </label>
          {posterSource === null && (
            <div role='status' className={`${studioType.body} flex items-center gap-6px px-12px pb-12px`}>
              <VideoOne aria-hidden='true' />
              <span>{t('conversation.creativeStudio.preview.videoReady')}</span>
            </div>
          )}
        </>
      ) : null}
    </figure>
  );
};

export { StagePreview };
export { createManagedStudioAssetUrl, isCanonicalStudioPosterAsset, isCanonicalStudioSelectedAsset };
