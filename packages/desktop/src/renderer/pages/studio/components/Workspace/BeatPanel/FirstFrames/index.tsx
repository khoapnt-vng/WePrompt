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
  WorkspaceSeedStillProjection,
  WorkspaceShotProjection,
  WorkspaceVideoTakeProjection,
} from '../../workspaceProjection';
import styles from './FirstFrames.module.css';

const KEY_ROOT = 'conversation.creativeStudio.workspace.beatPanel.firstFrames';

export type FirstFramesStatus = 'notReady' | 'ready' | 'rendering' | 'rendered';

export const firstFramesStatus = (shot: WorkspaceShotProjection): FirstFramesStatus => {
  if (shot.videoGenerationInFlight || shot.seedGenerationInFlight) return 'rendering';
  if (shot.currentPicture !== null) return 'rendered';
  return (shot.firstFrames ?? []).some((frame) => frame.effectiveSeed) ? 'ready' : 'notReady';
};

type ViewerState = { kind: 'frame'; index: number } | { kind: 'picture'; index: number } | null;

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

const safeDownloadName = (kind: 'frame' | 'take', shotIndex: number, index: number): string =>
  `studio-shot-${shotIndex + 1}-${kind}-${index + 1}`;

const downloadManagedAsset = (url: string, fileName: string): void => {
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
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
    const dataUrl = canvas.toDataURL('image/png');
    return dataUrl.startsWith('data:image/png;base64,') ? { dataUrl, width, height } : null;
  } catch {
    return null;
  }
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
  // Workspace projection is authoritative. Empty fallbacks keep a stale renderer
  // snapshot fail-closed while Main refreshes it after a schema cutover.
  const frames = shot.firstFrames ?? [];
  const takes = shot.videoTakes ?? [];
  const currentTake = takes.find((take) => take.current) ?? null;
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
      const items = viewer.kind === 'frame' ? frames : takes;
      if (event.key === 'Escape') {
        setViewer(null);
        return;
      }
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        const delta = event.key === 'ArrowLeft' ? -1 : 1;
        setViewer((current) =>
          current === null || current.kind !== viewer.kind
            ? current
            : { ...current, index: (current.index + delta + items.length) % items.length }
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

  const persistPoster = async (video: HTMLVideoElement, take: WorkspaceVideoTakeProjection): Promise<void> => {
    const captureKey = `${projectId}:${shot.id}:${take.assetId}`;
    if (posterCapturesRef.current.has(captureKey)) return;
    const captured = captureStudioVideoPoster(video);
    if (captured === null) return;
    posterCapturesRef.current.add(captureKey);
    const persisted = await actions.persistCapturedPoster({
      shotId: shot.id,
      videoAssetId: take.assetId,
      ...captured,
    });
    if (!persisted) posterCapturesRef.current.delete(captureKey);
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

  const pictureMenu = (take: WorkspaceVideoTakeProjection, index: number): React.ReactNode => {
    const url = createManagedStudioAssetUrl(projectId, take.assetId);
    return (
      <Menu>
        <Menu.Item
          key='download'
          disabled={url === null}
          onClick={() => url !== null && downloadManagedAsset(url, safeDownloadName('take', shotIndex, index))}
        >
          <Download aria-hidden='true' /> {t(`${KEY_ROOT}.menu.download`)}
        </Menu.Item>
        <Menu.Item key='history' disabled={takes.length < 2} onClick={() => setViewer({ kind: 'picture', index: 0 })}>
          {t(`${KEY_ROOT}.menu.previousTakes`)}
        </Menu.Item>
        <Menu.Item
          key='remove'
          className={styles.destructiveItem}
          disabled={disabled || !take.current}
          onClick={() => void actions.removeVideoTake(shot.id, take.assetId)}
        >
          <Delete aria-hidden='true' /> {t(`${KEY_ROOT}.menu.removeTake`)}
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
  const viewedTake = viewer?.kind === 'picture' ? takes[viewer.index] : null;
  const viewedAsset = viewedFrame ?? viewedTake;
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
        {currentTake === null ? (
          <div className={styles.pictureEmpty}>
            <span>{t(`${KEY_ROOT}.pictureEmpty`)}</span>
            {takes.length === 0 ? null : (
              <Button onClick={() => setViewer({ kind: 'picture', index: 0 })} size='mini' type='text'>
                {t(`${KEY_ROOT}.menu.previousTakes`)}
              </Button>
            )}
          </div>
        ) : (
          <article className={styles.pictureCard} data-asset-id={currentTake.assetId} data-current-picture>
            <Button
              className={styles.pictureMediaButton}
              onClick={() => setViewer({ kind: 'picture', index: 0 })}
              type='text'
            >
              {currentTake.posterAssetId === null ? (
                <video
                  aria-label={t(`${KEY_ROOT}.pictureAlt`, { shot: shotIndex + 1 })}
                  onCanPlay={(event) => void persistPoster(event.currentTarget, currentTake)}
                  onLoadedData={(event) => void persistPoster(event.currentTarget, currentTake)}
                  preload='auto'
                  src={createManagedStudioAssetUrl(projectId, currentTake.assetId) ?? undefined}
                />
              ) : (
                <img
                  alt={t(`${KEY_ROOT}.pictureAlt`, { shot: shotIndex + 1 })}
                  src={createManagedStudioAssetUrl(projectId, currentTake.posterAssetId) ?? undefined}
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
              <Dropdown droplist={pictureMenu(currentTake, 0)} position='br' trigger='click'>
                <Button
                  aria-label={t('common.more')}
                  icon={<MoreOne aria-hidden='true' />}
                  shape='circle'
                  size='mini'
                  type='secondary'
                />
              </Dropdown>
            </div>
            {currentTake.firstFrameChanged ? (
              <span className={styles.changedTag}>{t(`${KEY_ROOT}.firstFrameChanged`)}</span>
            ) : null}
            {currentTake.promptChanged ? (
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
            {t(status === 'rendering' ? `${KEY_ROOT}.cancelRun` : `${KEY_ROOT}.generateShot`, {
              shot: shotIndex + 1,
            })}
          </Button>
        ) : null}
      </div>

      <Modal
        className={styles.viewerModal}
        footer={null}
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
              <span>
                {t(`${KEY_ROOT}.viewer.counter`, {
                  current: viewer.index + 1,
                  total: viewer.kind === 'frame' ? frames.length : takes.length,
                })}
              </span>
            </div>
            <div className={styles.viewerStage}>
              <Button
                aria-label={t(`${KEY_ROOT}.viewer.previous`)}
                disabled={(viewer.kind === 'frame' ? frames : takes).length < 2}
                icon={<Left aria-hidden='true' />}
                onClick={() =>
                  setViewer({
                    ...viewer,
                    index:
                      (viewer.index - 1 + (viewer.kind === 'frame' ? frames.length : takes.length)) %
                      (viewer.kind === 'frame' ? frames.length : takes.length),
                  })
                }
                shape='circle'
                type='secondary'
              />
              <FullscreenMediaFrame className={styles.viewerMedia} enabled={false}>
                {viewer.kind === 'frame' ? (
                  <img alt={t(`${KEY_ROOT}.previewAlt`, { label: viewer.index + 1 })} src={viewedUrl} />
                ) : (
                  <video controls preload='metadata' src={viewedUrl} />
                )}
              </FullscreenMediaFrame>
              <Button
                aria-label={t(`${KEY_ROOT}.viewer.next`)}
                disabled={(viewer.kind === 'frame' ? frames : takes).length < 2}
                icon={<Right aria-hidden='true' />}
                onClick={() =>
                  setViewer({
                    ...viewer,
                    index: (viewer.index + 1) % (viewer.kind === 'frame' ? frames.length : takes.length),
                  })
                }
                shape='circle'
                type='secondary'
              />
            </div>
            <div className={styles.viewerFilmstrip}>
              {(viewer.kind === 'frame' ? frames : takes).map((item, index) => {
                const thumbId =
                  'posterAssetId' in item && item.posterAssetId !== null ? item.posterAssetId : item.assetId;
                const thumbUrl = createManagedStudioAssetUrl(projectId, thumbId);
                return (
                  <Button
                    key={item.assetId}
                    aria-label={
                      viewer.kind === 'frame'
                        ? t(`${KEY_ROOT}.frameLabel`, { index: index + 1 })
                        : t(`${KEY_ROOT}.viewer.take`, { index: index + 1 })
                    }
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
              ) : viewedTake?.current ? null : (
                <Button
                  disabled={disabled}
                  onClick={() =>
                    viewedTake !== null &&
                    viewedTake !== undefined &&
                    void actions.selectVideoTake(shot.id, viewedTake.assetId)
                  }
                  type='primary'
                >
                  {t(`${KEY_ROOT}.viewer.useTake`)}
                </Button>
              )}
              <Button
                disabled={viewedUrl === null}
                icon={<Download aria-hidden='true' />}
                onClick={() =>
                  viewedUrl === null
                    ? undefined
                    : downloadManagedAsset(
                        viewedUrl,
                        safeDownloadName(viewer.kind === 'frame' ? 'frame' : 'take', shotIndex, viewer.index)
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
              ) : viewer.kind === 'picture' && viewedTake?.current ? (
                <Button
                  className={styles.destructiveButton}
                  disabled={disabled}
                  icon={<Delete aria-hidden='true' />}
                  onClick={() => {
                    const assetId = viewedTake.assetId;
                    void run(async () => {
                      const removed = await actions.removeVideoTake(shot.id, assetId);
                      if (removed) setViewer(null);
                    });
                  }}
                >
                  {t(`${KEY_ROOT}.menu.removeTake`)}
                </Button>
              ) : null}
              <Button
                aria-describedby={generationDescriptionId}
                disabled={
                  disabled || working || (status === 'rendering' && shot.activeGenerationJob?.canCancel !== true)
                }
                loading={working}
                onClick={() =>
                  void run(
                    status === 'rendering' ? cancelRun : viewer.kind === 'frame' ? onRegenerateFrame : onGenerateVideo
                  )
                }
              >
                {t(
                  status === 'rendering'
                    ? `${KEY_ROOT}.cancelRun`
                    : viewer.kind === 'frame'
                      ? `${KEY_ROOT}.regenerate`
                      : `${KEY_ROOT}.generateShot`,
                  { shot: shotIndex + 1 }
                )}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </section>
  );
};
