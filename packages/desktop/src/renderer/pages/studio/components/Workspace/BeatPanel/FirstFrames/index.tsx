/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Dropdown, Input, Menu, Modal } from '@arco-design/web-react';
import { Copy, Delete, Download, Left, MoreOne, Pin, Plus, Right } from '@icon-park/react';
import classNames from 'classnames';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { createManagedStudioAssetUrl } from '@/renderer/pages/studio/studioManagedAssetUrl';
import { FullscreenMediaFrame } from '@/renderer/pages/studio/components/FullscreenMediaFrame';
import { copyText } from '@/renderer/utils/ui/clipboard';

import type { BeatPanelActions, BeatPanelImportResult } from '..';
import type {
  WorkspaceCurrentPictureProjection,
  WorkspaceSeedStillProjection,
  WorkspaceShotProjection,
} from '../../workspaceProjection';
import styles from './FirstFrames.module.css';

const KEY_ROOT = 'conversation.creativeStudio.workspace.beatPanel.firstFrames';
const POSTER_CAPTURE_RETRY_FALLBACK_MS = 250;
export type StudioPosterCaptureResult = 'settled' | 'frame_unavailable' | 'persistence_failed';
type StudioPosterCaptureFailure = Exclude<StudioPosterCaptureResult, 'settled'>;

export type FirstFramesStatus = 'notReady' | 'ready' | 'rendering' | 'rendered';

export const firstFramesStatus = (shot: WorkspaceShotProjection): FirstFramesStatus => {
  if (shot.videoGenerationInFlight || shot.seedGenerationInFlight) return 'rendering';
  if (shot.currentPicture !== null) return 'rendered';
  return (shot.firstFrames ?? []).some((frame) => frame.effectiveSeed) ? 'ready' : 'notReady';
};

type ViewerState = { kind: 'frame'; index: number } | { kind: 'picture' } | null;

type FirstFramesProps = {
  actions: BeatPanelActions;
  disabled: boolean;
  generationDescriptionId?: string;
  generateVideoDisabled: boolean;
  importDisabled: boolean;
  onGenerateVideo: () => Promise<void>;
  onImport: () => Promise<BeatPanelImportResult>;
  onPromptChange: (value: string) => void;
  onRegenerateFrame: () => Promise<void>;
  onSendLastFrame: (() => void) | null;
  projectId: string;
  prompt: string;
  shot: WorkspaceShotProjection;
  shotIndex: number;
  showGenerationAction?: boolean;
};

const safeDownloadName = (kind: 'frame' | 'picture', shotIndex: number, index: number): string =>
  `studio-shot-${shotIndex + 1}-${kind}-${index + 1}`;

const downloadManagedAsset = (url: string, fileName: string): void => {
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

/**
 * A decoded video has not necessarily presented a frame yet. Drawing it at that point can produce
 * one flat colour (normally black), and persisting that is worse than having no poster because the
 * poster replaces the playable video everywhere. Sample roughly four thousand pixels at an odd
 * stride and refuse a canvas whose RGBA value never differs from its first pixel.
 */
const carriesPicture = (context: CanvasRenderingContext2D, width: number, height: number): boolean => {
  if (typeof context.getImageData !== 'function') return false;
  let pixels: Uint8ClampedArray;
  try {
    pixels = context.getImageData(0, 0, width, height).data;
  } catch {
    return false;
  }
  const total = Math.floor(pixels.length / 4);
  if (total === 0) return false;
  const step = Math.max(1, Math.floor(total / 4_096)) | 1;
  for (let index = 0; index < total; index += step) {
    const at = index * 4;
    if (
      pixels[at] !== pixels[0] ||
      pixels[at + 1] !== pixels[1] ||
      pixels[at + 2] !== pixels[2] ||
      pixels[at + 3] !== pixels[3]
    ) {
      return true;
    }
  }
  return false;
};

export const captureStudioVideoPoster = (
  video: Pick<HTMLVideoElement, 'videoWidth' | 'videoHeight'>,
  createCanvas: () => HTMLCanvasElement = () => document.createElement('canvas')
): { dataUrl: string; width: number; height: number } | null => {
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (
    !Number.isSafeInteger(width) ||
    width < 1 ||
    width > 16_384 ||
    !Number.isSafeInteger(height) ||
    height < 1 ||
    height > 16_384
  ) {
    return null;
  }
  const canvas = createCanvas();
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (context === null) return null;
  try {
    context.drawImage(video as CanvasImageSource, 0, 0, width, height);
    if (!carriesPicture(context, width, height)) return null;
    const dataUrl = canvas.toDataURL('image/png');
    return dataUrl.startsWith('data:image/png;base64,') ? { dataUrl, width, height } : null;
  } catch {
    return null;
  }
};

export const scheduleStudioPosterCaptureRetry = (
  video: HTMLVideoElement,
  captureKey: string,
  scheduled: Set<string>,
  failure: StudioPosterCaptureFailure,
  retry: () => Promise<StudioPosterCaptureResult>
): void => {
  if (!video.isConnected || scheduled.has(captureKey)) return;
  scheduled.add(captureKey);
  let finished = false;
  const finish = (): void => {
    if (finished) return;
    finished = true;
    scheduled.delete(captureKey);
  };
  const runRetry = (retryPersistenceFailure: boolean): void => {
    if (finished) return;
    if (!video.isConnected) {
      finish();
      return;
    }
    void retry().then((result) => {
      if (result === 'persistence_failed' && retryPersistenceFailure) {
        window.setTimeout(() => runRetry(false), POSTER_CAPTURE_RETRY_FALLBACK_MS);
      } else {
        finish();
      }
    }, finish);
  };
  if (failure === 'frame_unavailable' && typeof video.requestVideoFrameCallback === 'function') {
    // Only an unreadable/flat draw needs presentation. A persistence failure already had a good
    // frame, and paused videos are not guaranteed to issue another presentation callback.
    video.requestVideoFrameCallback(() => runRetry(true));
    return;
  }
  window.setTimeout(() => runRetry(failure === 'frame_unavailable'), POSTER_CAPTURE_RETRY_FALLBACK_MS);
};

export const FirstFrames: React.FC<FirstFramesProps> = ({
  actions,
  disabled,
  generationDescriptionId,
  generateVideoDisabled,
  importDisabled,
  onGenerateVideo,
  onImport,
  onPromptChange,
  onRegenerateFrame,
  onSendLastFrame,
  projectId,
  prompt,
  shot,
  shotIndex,
  showGenerationAction = true,
}) => {
  const { t } = useTranslation();
  const [viewer, setViewer] = useState<ViewerState>(null);
  const [importing, setImporting] = useState(false);
  const [working, setWorking] = useState(false);
  const posterCapturesRef = useRef(new Set<string>());
  const posterCaptureRetriesRef = useRef(new Set<string>());
  // Workspace projection is authoritative. Empty fallbacks keep a stale renderer
  // snapshot fail-closed while Main refreshes it after a schema cutover.
  const frames = shot.firstFrames ?? [];
  const currentPicture = shot.currentPicture;
  const status = firstFramesStatus(shot);
  const canSelectFrame = (frame: WorkspaceSeedStillProjection): boolean =>
    shot.segmentHead &&
    frame.origin !== 'inherited' &&
    (shot.seedAuthorizationLock === null || shot.seedAuthorizationLock.compatibleAssetIds.includes(frame.assetId));
  useEffect(() => {
    setViewer(null);
  }, [projectId, shot.id]);

  useEffect(() => {
    if (viewer === null) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      const active = document.activeElement;
      const editing = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement;
      if (event.key === 'Escape') {
        setViewer(null);
        return;
      }
      if (viewer.kind === 'frame' && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
        event.preventDefault();
        const delta = event.key === 'ArrowLeft' ? -1 : 1;
        setViewer((current) =>
          current === null || current.kind !== viewer.kind
            ? current
            : { ...current, index: (current.index + delta + frames.length) % frames.length }
        );
        return;
      }
      if (viewer.kind !== 'frame' || editing || working || disabled) return;
      const frame = frames[viewer.index];
      if (event.key.toLowerCase() === 'p' && frame !== undefined && !frame.effectiveSeed && canSelectFrame(frame)) {
        event.preventDefault();
        void actions.setSeedStill(shot.id, frame.assetId);
      } else if (event.key.toLowerCase() === 'r') {
        event.preventDefault();
        void run(onRegenerateFrame);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  });

  const run = async (operation: () => Promise<void>): Promise<void> => {
    if (working || disabled) return;
    setWorking(true);
    try {
      await operation();
    } finally {
      setWorking(false);
    }
  };

  const importFrame = async (): Promise<void> => {
    if (importing || disabled || importDisabled) return;
    setImporting(true);
    try {
      await onImport();
    } finally {
      setImporting(false);
    }
  };

  const cancelRun = async (): Promise<void> => {
    const job = shot.activeGenerationJob ?? null;
    if (job === null || !job.canCancel) return;
    await actions.cancelGenerationJob(job.id);
  };

  const persistPoster = async (
    video: HTMLVideoElement,
    picture: WorkspaceCurrentPictureProjection
  ): Promise<StudioPosterCaptureResult> => {
    const captureKey = `${projectId}:${shot.id}:${picture.assetId}`;
    if (posterCapturesRef.current.has(captureKey)) return 'settled';
    const captured = captureStudioVideoPoster(video);
    if (captured === null) return 'frame_unavailable';
    posterCapturesRef.current.add(captureKey);
    const persisted = await actions
      .persistCapturedPoster({
        shotId: shot.id,
        videoAssetId: picture.assetId,
        ...captured,
      })
      .catch(() => false);
    if (!persisted) posterCapturesRef.current.delete(captureKey);
    return persisted ? 'settled' : 'persistence_failed';
  };

  /*
   * loadeddata/canplay promise decoded data, not a composited frame. If the guarded capture is
   * blank, retry when the browser reports that a frame has actually been presented.
   */
  const scheduleCapture = (video: HTMLVideoElement, picture: WorkspaceCurrentPictureProjection): void => {
    void persistPoster(video, picture).then((result) => {
      if (result === 'settled') return;
      const captureKey = `${projectId}:${shot.id}:${picture.assetId}`;
      scheduleStudioPosterCaptureRetry(video, captureKey, posterCaptureRetriesRef.current, result, () =>
        persistPoster(video, picture)
      );
    });
  };

  const frameMenu = (frame: WorkspaceSeedStillProjection, index: number): React.ReactNode => {
    const url = createManagedStudioAssetUrl(projectId, frame.assetId);
    return (
      <Menu>
        <Menu.Item
          key='download'
          disabled={url === null}
          onClick={() => url !== null && downloadManagedAsset(url, safeDownloadName('frame', shotIndex, index))}
        >
          <Download aria-hidden='true' /> {t(`${KEY_ROOT}.menu.download`)}
        </Menu.Item>
        {frame.prompt === null ? null : (
          <Menu.Item key='copy-prompt' onClick={() => void copyText(frame.prompt!)}>
            <Copy aria-hidden='true' /> {t(`${KEY_ROOT}.menu.copyPrompt`)}
          </Menu.Item>
        )}
        <Menu.Item
          key='remove'
          className={styles.destructiveItem}
          disabled={disabled || importDisabled || frame.origin === 'inherited'}
          onClick={() => void actions.dismissSeedStill(shot.id, frame.assetId)}
        >
          <Delete aria-hidden='true' /> {t(`${KEY_ROOT}.menu.remove`)}
        </Menu.Item>
      </Menu>
    );
  };

  const pictureMenu = (picture: WorkspaceCurrentPictureProjection): React.ReactNode => {
    const url = createManagedStudioAssetUrl(projectId, picture.assetId);
    return (
      <Menu>
        <Menu.Item
          key='download'
          disabled={url === null}
          onClick={() => url !== null && downloadManagedAsset(url, safeDownloadName('picture', shotIndex, 0))}
        >
          <Download aria-hidden='true' /> {t(`${KEY_ROOT}.menu.download`)}
        </Menu.Item>
      </Menu>
    );
  };

  const frameCards = useMemo(
    () =>
      frames.map((frame, index) => {
        const url = createManagedStudioAssetUrl(projectId, frame.assetId);
        const label = t(`${KEY_ROOT}.frameLabel`, { index: index + 1 });
        const origin =
          frame.origin === 'inherited'
            ? t(`${KEY_ROOT}.origin.inherited`, { shot: frame.sourceShotNumber ?? Math.max(1, shotIndex) })
            : t(`${KEY_ROOT}.origin.${frame.origin}`);
        return (
          <article
            aria-label={label}
            key={frame.assetId}
            className={classNames(styles.frameCard, frame.effectiveSeed && styles.currentFrame)}
            data-asset-id={frame.assetId}
            data-current-first-frame={frame.effectiveSeed}
            data-first-frame-origin={frame.origin}
          >
            <div className={styles.frameMedia}>
              {url === null ? (
                <span>{t(`${KEY_ROOT}.unavailable`)}</span>
              ) : (
                <button
                  className={styles.frameOpenSurface}
                  onClick={() => setViewer({ kind: 'frame', index })}
                  type='button'
                >
                  <img alt={t(`${KEY_ROOT}.previewAlt`, { label })} src={url} />
                </button>
              )}
              {frame.effectiveSeed ? <span className={styles.currentBadge}>{t(`${KEY_ROOT}.current`)}</span> : null}
              <div className={styles.hoverActions}>
                <Button
                  aria-label={t(`${KEY_ROOT}.openFrame`, { label })}
                  disabled={url === null}
                  onClick={() => setViewer({ kind: 'frame', index })}
                  shape='circle'
                  size='mini'
                  type='secondary'
                >
                  ⛶
                </Button>
                <Button
                  aria-label={t(frame.effectiveSeed ? `${KEY_ROOT}.pinned` : `${KEY_ROOT}.pin`)}
                  disabled={disabled || frame.effectiveSeed || !canSelectFrame(frame)}
                  icon={<Pin aria-hidden='true' />}
                  onClick={() => void actions.setSeedStill(shot.id, frame.assetId)}
                  shape='circle'
                  size='mini'
                  type={frame.effectiveSeed ? 'primary' : 'secondary'}
                />
                <Dropdown droplist={frameMenu(frame, index)} position='br' trigger='click'>
                  <Button
                    aria-label={t('common.more')}
                    icon={<MoreOne aria-hidden='true' />}
                    shape='circle'
                    size='mini'
                    type='secondary'
                  />
                </Dropdown>
              </div>
            </div>
            <div className={styles.caption}>
              <span>{label}</span>
              <span>{origin}</span>
            </div>
            {frame.firstFrameChanged ? (
              <span className={styles.changedTag}>{t(`${KEY_ROOT}.firstFrameChanged`)}</span>
            ) : null}
            {frame.promptChanged ? <span className={styles.changedTag}>{t(`${KEY_ROOT}.promptChanged`)}</span> : null}
          </article>
        );
      }),
    [actions, disabled, frames, projectId, shot.id, shot.segmentHead, shot.seedAuthorizationLock, shotIndex, t]
  );

  const viewedFrame = viewer?.kind === 'frame' ? frames[viewer.index] : null;
  const viewedPicture = viewer?.kind === 'picture' ? currentPicture : null;
  const viewedAsset = viewedFrame ?? viewedPicture;
  const viewedUrl =
    viewedAsset === undefined || viewedAsset === null
      ? null
      : createManagedStudioAssetUrl(projectId, viewedAsset.assetId);

  return (
    <section className={styles.root} data-first-frames-band data-status={status}>
      <div
        aria-label={`${t(`${KEY_ROOT}.title`)} · ${t(`${KEY_ROOT}.shotChip`, { shot: shotIndex + 1 })}`}
        className={styles.inputHalf}
        role='region'
      >
        <header className={styles.sectionHeader}>
          <div>
            <span className={styles.eyebrow}>{t(`${KEY_ROOT}.title`)}</span>
            <span className={styles.shotChip}>{t(`${KEY_ROOT}.shotChip`, { shot: shotIndex + 1 })}</span>
          </div>
          <span className={styles.status} data-first-frames-status={status}>
            {t(`${KEY_ROOT}.status.${status}`)}
            {status === 'rendering' && shot.generationProgressPercent != null
              ? ` · ${Math.round(shot.generationProgressPercent)}%`
              : ''}
          </span>
        </header>
        <div className={styles.strip}>
          {frameCards}
          {shot.segmentHead ? (
            <Button
              aria-label={t(`${KEY_ROOT}.import`)}
              className={styles.importTile}
              disabled={disabled || importDisabled}
              icon={<Plus aria-hidden='true' />}
              loading={importing}
              onClick={() => void importFrame()}
              type='secondary'
            />
          ) : null}
          {frames.length === 0 ? <p className={styles.empty}>{t(`${KEY_ROOT}.empty`)}</p> : null}
        </div>
      </div>

      <div className={styles.divider} aria-hidden='true'>
        →
      </div>

      <div
        aria-label={t(`${KEY_ROOT}.pictureAlt`, { shot: shotIndex + 1 })}
        className={styles.outputHalf}
        role='region'
      >
        <header className={styles.sectionHeader}>
          <span className={styles.eyebrow}>{t(`${KEY_ROOT}.currentPicture`)}</span>
        </header>
        {currentPicture === null ? (
          <div className={styles.pictureEmpty}>
            <span>{t(`${KEY_ROOT}.pictureEmpty`)}</span>
          </div>
        ) : (
          <article className={styles.pictureCard} data-asset-id={currentPicture.assetId} data-current-picture>
            <Button className={styles.pictureMediaButton} onClick={() => setViewer({ kind: 'picture' })} type='text'>
              {currentPicture.posterAssetId === null ? (
                <video
                  aria-label={t(`${KEY_ROOT}.pictureAlt`, { shot: shotIndex + 1 })}
                  muted
                  onCanPlay={(event) => scheduleCapture(event.currentTarget, currentPicture)}
                  onLoadedData={(event) => scheduleCapture(event.currentTarget, currentPicture)}
                  preload='auto'
                  src={createManagedStudioAssetUrl(projectId, currentPicture.assetId) ?? undefined}
                />
              ) : (
                <img
                  alt={t(`${KEY_ROOT}.pictureAlt`, { shot: shotIndex + 1 })}
                  src={createManagedStudioAssetUrl(projectId, currentPicture.posterAssetId) ?? undefined}
                />
              )}
            </Button>
            <div className={styles.pictureHoverActions}>
              {onSendLastFrame === null ? null : (
                <Button
                  aria-label={t(`${KEY_ROOT}.sendLastFrame`, { shot: shotIndex + 2 })}
                  disabled={disabled}
                  icon={<Right aria-hidden='true' />}
                  onClick={onSendLastFrame}
                  shape='circle'
                  size='mini'
                  type='secondary'
                />
              )}
              <Dropdown droplist={pictureMenu(currentPicture)} position='br' trigger='click'>
                <Button
                  aria-label={t('common.more')}
                  icon={<MoreOne aria-hidden='true' />}
                  shape='circle'
                  size='mini'
                  type='secondary'
                />
              </Dropdown>
            </div>
            {currentPicture.firstFrameChanged ? (
              <span className={styles.changedTag}>{t(`${KEY_ROOT}.firstFrameChanged`)}</span>
            ) : null}
            {currentPicture.promptChanged ? (
              <span className={styles.changedTag}>{t(`${KEY_ROOT}.promptChanged`)}</span>
            ) : null}
          </article>
        )}
        {showGenerationAction ? (
          <Button
            aria-describedby={generationDescriptionId}
            disabled={
              status === 'rendering'
                ? shot.activeGenerationJob?.canCancel !== true
                : disabled || generateVideoDisabled || frames.every((frame) => !frame.effectiveSeed)
            }
            loading={working}
            onClick={() => void run(status === 'rendering' ? cancelRun : onGenerateVideo)}
            type='primary'
          >
            {t(
              status === 'rendering'
                ? `${KEY_ROOT}.cancelRun`
                : currentPicture === null
                  ? `${KEY_ROOT}.generateShot`
                  : `${KEY_ROOT}.generateAgain`,
              { shot: shotIndex + 1 }
            )}
          </Button>
        ) : null}
      </div>

      <Modal
        className={styles.viewerModal}
        footer={null}
        // The Beat panel is itself a Modal, so a translucent mask here stacks a second scrim and
        // leaves the panel half-lit, half-legible and wholly inert behind the viewer (BUG-177).
        // An opaque mask covers it completely, so exactly one scrim reads.
        maskStyle={{ background: 'var(--color-bg-1)', opacity: 1 }}
        onCancel={() => setViewer(null)}
        title={null}
        unmountOnExit
        visible={viewer !== null}
      >
        {viewer === null || viewedAsset === null || viewedAsset === undefined || viewedUrl === null ? null : (
          <div className={styles.viewer} data-viewer-kind={viewer.kind}>
            <div className={styles.viewerTopline}>
              <span>
                {t(viewer.kind === 'frame' ? `${KEY_ROOT}.viewer.currentFirstFrame` : `${KEY_ROOT}.currentPicture`)}
              </span>
              {viewer.kind === 'frame' ? (
                <span>
                  {t(`${KEY_ROOT}.viewer.counter`, {
                    current: viewer.index + 1,
                    total: frames.length,
                  })}
                </span>
              ) : null}
            </div>
            <div className={styles.viewerStage}>
              {viewer.kind === 'frame' ? (
                <Button
                  aria-label={t(`${KEY_ROOT}.viewer.previous`)}
                  disabled={frames.length < 2}
                  icon={<Left aria-hidden='true' />}
                  onClick={() => setViewer({ ...viewer, index: (viewer.index - 1 + frames.length) % frames.length })}
                  shape='circle'
                  type='secondary'
                />
              ) : null}
              <FullscreenMediaFrame className={styles.viewerMedia} enabled={false}>
                {viewer.kind === 'frame' ? (
                  <img alt={t(`${KEY_ROOT}.previewAlt`, { label: viewer.index + 1 })} src={viewedUrl} />
                ) : (
                  <video controls preload='metadata' src={viewedUrl} />
                )}
              </FullscreenMediaFrame>
              {viewer.kind === 'frame' ? (
                <Button
                  aria-label={t(`${KEY_ROOT}.viewer.next`)}
                  disabled={frames.length < 2}
                  icon={<Right aria-hidden='true' />}
                  onClick={() => setViewer({ ...viewer, index: (viewer.index + 1) % frames.length })}
                  shape='circle'
                  type='secondary'
                />
              ) : null}
            </div>
            {viewer.kind === 'frame' ? (
              <div className={styles.viewerFilmstrip}>
                {frames.map((item, index) => {
                  const thumbUrl = createManagedStudioAssetUrl(projectId, item.assetId);
                  return (
                    <Button
                      key={item.assetId}
                      aria-label={t(`${KEY_ROOT}.frameLabel`, { index: index + 1 })}
                      aria-pressed={viewer.index === index}
                      className={styles.viewerThumb}
                      onClick={() => setViewer({ ...viewer, index })}
                      type='text'
                    >
                      {thumbUrl === null ? null : <img alt='' src={thumbUrl} />}
                    </Button>
                  );
                })}
              </div>
            ) : null}
            <Input
              aria-label={t(`${KEY_ROOT}.promptLabel`)}
              disabled={disabled}
              onChange={onPromptChange}
              value={prompt}
            />
            {viewedAsset.promptChanged ? (
              <span className={styles.changedTag}>{t(`${KEY_ROOT}.promptChanged`)}</span>
            ) : null}
            <div className={styles.viewerActions}>
              {viewer.kind === 'frame' ? (
                <Button
                  disabled={
                    disabled || viewedFrame === null || viewedFrame === undefined || !canSelectFrame(viewedFrame)
                  }
                  onClick={() =>
                    viewedFrame?.effectiveSeed
                      ? undefined
                      : void actions.setSeedStill(shot.id, viewedFrame?.assetId ?? '')
                  }
                  type='primary'
                >
                  {t(viewedFrame?.effectiveSeed ? `${KEY_ROOT}.pinned` : `${KEY_ROOT}.pin`)}
                </Button>
              ) : null}
              <Button
                disabled={viewedUrl === null}
                icon={<Download aria-hidden='true' />}
                onClick={() =>
                  viewedUrl === null
                    ? undefined
                    : downloadManagedAsset(
                        viewedUrl,
                        safeDownloadName(
                          viewer.kind === 'frame' ? 'frame' : 'picture',
                          shotIndex,
                          viewer.kind === 'frame' ? viewer.index : 0
                        )
                      )
                }
              >
                {t(`${KEY_ROOT}.menu.download`)}
              </Button>
              {viewer.kind === 'frame' && viewedFrame !== null && viewedFrame !== undefined ? (
                <Button
                  className={styles.destructiveButton}
                  disabled={disabled || importDisabled || viewedFrame.origin === 'inherited'}
                  icon={<Delete aria-hidden='true' />}
                  onClick={() => {
                    const assetId = viewedFrame.assetId;
                    void run(async () => {
                      const removed = await actions.dismissSeedStill(shot.id, assetId);
                      if (removed) setViewer(null);
                    });
                  }}
                >
                  {t(`${KEY_ROOT}.menu.remove`)}
                </Button>
              ) : null}
              {viewer.kind === 'frame' ? (
                <Button
                  aria-describedby={generationDescriptionId}
                  disabled={
                    disabled || working || (status === 'rendering' && shot.activeGenerationJob?.canCancel !== true)
                  }
                  loading={working}
                  onClick={() => void run(status === 'rendering' ? cancelRun : onRegenerateFrame)}
                >
                  {t(status === 'rendering' ? `${KEY_ROOT}.cancelRun` : `${KEY_ROOT}.regenerate`)}
                </Button>
              ) : null}
            </div>
          </div>
        )}
      </Modal>
    </section>
  );
};
