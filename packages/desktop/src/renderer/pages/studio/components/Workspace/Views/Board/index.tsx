/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Popconfirm } from '@arco-design/web-react';
import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type {
  StudioBinItem,
  StudioProjectStatusBlockerCauseV2,
  StudioProjectStatusV2,
} from '@/common/types/project/creativeStudioTypes';
import { STUDIO_MAX_GENERATION_SHOTS_PER_REQUEST } from '@/common/types/project/creativeStudioTypes';
import {
  captureStudioVideoPoster,
  scheduleStudioPosterCaptureRetry,
  type StudioPosterCaptureResult,
} from '../../BeatPanel/FirstFrames';
import { createManagedStudioAssetUrl } from '@/renderer/pages/studio/studioManagedAssetUrl';

import {
  workspaceShotHasFreshCurrentTake,
  type WorkspaceBoardPanelProjection,
  type WorkspaceProjection,
} from '../../workspaceProjection';
import { Bin, binItemFocusKey } from './Bin';
import { deriveBoardShotTiles, type BoardShotTile, type BoardShotTileMedia } from './boardShotTiles';
import styles from './Board.module.css';

const KEY_ROOT = 'conversation.creativeStudio.workspace.board';
const BEAT_PANEL_ROOT = 'conversation.creativeStudio.workspace.beatPanel';
const WORKSPACE_CONTROLS_ROOT = 'conversation.creativeStudio.workspace.controls';

const SHOT_BLOCKER_CAUSE_KEYS = {
  route_inventory_unavailable: `${KEY_ROOT}.shot.blocker.cause.routeInventoryUnavailable`,
  route_not_selected: `${KEY_ROOT}.shot.blocker.cause.routeNotSelected`,
  route_setup_required: `${KEY_ROOT}.shot.blocker.cause.routeSetupRequired`,
  route_unavailable: `${KEY_ROOT}.shot.blocker.cause.routeUnavailable`,
  route_retired: `${KEY_ROOT}.shot.blocker.cause.routeRetired`,
  route_incompatible_frame: `${KEY_ROOT}.shot.blocker.cause.routeIncompatibleFrame`,
  route_first_frame_unsupported: `${KEY_ROOT}.shot.blocker.cause.routeFirstFrameUnsupported`,
  route_duration_unsupported: `${KEY_ROOT}.shot.blocker.cause.routeDurationUnsupported`,
  reference_plan_invalid: `${KEY_ROOT}.shot.blocker.cause.referencePlanInvalid`,
  reference_generation_required: `${KEY_ROOT}.shot.blocker.cause.referenceGenerationRequired`,
  reference_approval_required: `${KEY_ROOT}.shot.blocker.cause.referenceApprovalRequired`,
  reference_generation_failed: `${KEY_ROOT}.shot.blocker.cause.referenceGenerationFailed`,
  reference_binding_unassigned: `${KEY_ROOT}.shot.blocker.cause.referenceBindingUnassigned`,
  reference_binding_unknown_reference: `${KEY_ROOT}.shot.blocker.cause.referenceBindingUnknownReference`,
  reference_binding_wrong_kind: `${KEY_ROOT}.shot.blocker.cause.referenceBindingWrongKind`,
  reference_binding_unapproved_reference: `${KEY_ROOT}.shot.blocker.cause.referenceBindingUnapprovedReference`,
  reference_binding_missing_asset: `${KEY_ROOT}.shot.blocker.cause.referenceBindingMissingAsset`,
  reference_binding_capacity_exceeded: `${KEY_ROOT}.shot.blocker.cause.referenceBindingCapacityExceeded`,
  shooting_script_required: 'conversation.creativeStudio.workspace.gate.errors.pricing.missingShootingScript',
  seed_selection_required: `${KEY_ROOT}.shot.blocker.cause.seedSelectionRequired`,
  seed_generation_required: `${KEY_ROOT}.shot.blocker.cause.seedGenerationRequired`,
  conditioning_frame_required: `${KEY_ROOT}.shot.blocker.cause.conditioningFrameRequired`,
  extraction_failed: `${KEY_ROOT}.shot.blocker.cause.extractionFailed`,
  dependency_failed: `${KEY_ROOT}.shot.blocker.cause.dependencyFailed`,
  generation_invalid_request: `${KEY_ROOT}.shot.blocker.cause.generationInvalidRequest`,
  generation_content_rejected: `${KEY_ROOT}.shot.blocker.cause.generationContentRejected`,
  generation_auth: `${KEY_ROOT}.shot.blocker.cause.generationAuth`,
  generation_quota: `${KEY_ROOT}.shot.blocker.cause.generationQuota`,
  generation_rate_limited: `${KEY_ROOT}.shot.blocker.cause.generationRateLimited`,
  generation_provider_unavailable: `${KEY_ROOT}.shot.blocker.cause.generationProviderUnavailable`,
  generation_timeout: `${KEY_ROOT}.shot.blocker.cause.generationTimeout`,
  generation_poll_deadline: `${KEY_ROOT}.shot.blocker.cause.generationPollDeadline`,
  generation_no_output: `${KEY_ROOT}.shot.blocker.cause.generationNoOutput`,
  generation_variation_grid: `${KEY_ROOT}.shot.blocker.cause.generationVariationGrid`,
  generation_submission_unknown: `${KEY_ROOT}.shot.blocker.cause.generationSubmissionUnknown`,
  generation_download_failed: `${KEY_ROOT}.shot.blocker.cause.generationDownloadFailed`,
  generation_unsupported: `${KEY_ROOT}.shot.blocker.cause.generationUnsupported`,
  generation_unknown: `${KEY_ROOT}.shot.blocker.cause.generationUnknown`,
  cut_invalid_media: `${KEY_ROOT}.shot.blocker.cause.cutInvalidMedia`,
  cut_bed_too_short: `${KEY_ROOT}.shot.blocker.cause.cutBedTooShort`,
} as const satisfies Record<StudioProjectStatusBlockerCauseV2, string>;

const ROUTE_KIND_KEYS = {
  image: `${WORKSPACE_CONTROLS_ROOT}.imageRoute`,
  video: `${WORKSPACE_CONTROLS_ROOT}.videoRoute`,
} as const;

const PANEL_STATUS_KEYS = {
  missing: `${KEY_ROOT}.panel.status.missing`,
  current: `${KEY_ROOT}.panel.status.current`,
  stale: `${KEY_ROOT}.panel.status.stale`,
  status_pending: `${KEY_ROOT}.panel.status.statusPending`,
  queued: `${KEY_ROOT}.panel.status.queued`,
  drawing: `${KEY_ROOT}.panel.status.drawing`,
  needs_attention: `${KEY_ROOT}.panel.status.needsAttention`,
  failed: `${KEY_ROOT}.panel.status.failed`,
  cancelled: `${KEY_ROOT}.panel.status.cancelled`,
} as const;

const DRAWABLE_BOARD_ACTIVITIES = new Set<WorkspaceBoardPanelProjection['activity']>(['idle', 'failed', 'cancelled']);
const BUSY_BOARD_ACTIVITIES = new Set<WorkspaceBoardPanelProjection['activity']>(['queued', 'drawing']);
const MAX_CONCURRENT_BOARD_VIDEO_PROBES = 1;
const BOARD_VIDEO_PROBE_LEASE_WINDOWS_MS = [5_000, 15_000, 30_000] as const;

type BoardVideoProbeQueueEntry = {
  grant: () => void;
  state: 'queued' | 'active' | 'released';
};

/**
 * A Board can expose many rendered Shots in one viewport. Loading every posterless video together
 * competes with the video the owner is actually watching in the Beat panel, so Board probes pass
 * through one small per-Board gate. Releasing a queued lease removes it without ever touching the
 * network; releasing an active lease immediately admits the next still-visible tile.
 */
class BoardVideoProbeScheduler {
  private active = 0;
  private readonly queue: BoardVideoProbeQueueEntry[] = [];

  acquire(grant: () => void): () => void {
    const entry: BoardVideoProbeQueueEntry = { grant, state: 'queued' };
    this.queue.push(entry);
    this.drain();
    return () => {
      if (entry.state === 'released') return;
      if (entry.state === 'active') this.active -= 1;
      else {
        const queuedIndex = this.queue.indexOf(entry);
        if (queuedIndex >= 0) this.queue.splice(queuedIndex, 1);
      }
      entry.state = 'released';
      this.drain();
    };
  }

  private drain(): void {
    while (this.active < MAX_CONCURRENT_BOARD_VIDEO_PROBES) {
      const entry = this.queue.shift();
      if (entry === undefined) return;
      if (entry.state !== 'queued') continue;
      entry.state = 'active';
      this.active += 1;
      try {
        entry.grant();
      } catch {
        entry.state = 'released';
        this.active -= 1;
      }
    }
  }
}

const tearDownBoardVideoProbe = (video: HTMLVideoElement): void => {
  try {
    video.pause();
  } catch {
    // A detached or failed media element can reject control calls; src removal still releases it.
  }
  video.removeAttribute('src');
  try {
    video.load();
  } catch {
    // Best effort: removing src is still safer than admitting the next probe with it attached.
  }
};

const isDrawableBoardPanel = (panel: WorkspaceBoardPanelProjection): boolean =>
  DRAWABLE_BOARD_ACTIVITIES.has(panel.activity) &&
  panel.freshness !== 'status_pending' &&
  panel.activity !== 'status_pending' &&
  panel.recovery?.canRetryDownload !== true;

const isPromotableBoardPanel = (
  panel: WorkspaceBoardPanelProjection
): panel is WorkspaceBoardPanelProjection & { assetId: string } =>
  panel.assetId !== null && panel.freshness === 'current' && isDrawableBoardPanel(panel);

const panelStatusKey = (panel: WorkspaceBoardPanelProjection): string =>
  panel.activity === 'idle' ? PANEL_STATUS_KEYS[panel.freshness] : PANEL_STATUS_KEYS[panel.activity];

const statusPendingPanel = (shotId: string): WorkspaceBoardPanelProjection => ({
  shotId,
  assetId: null,
  newSpendSeedAssetId: null,
  producerJobId: null,
  latestJobId: null,
  staleCauses: [],
  freshness: 'status_pending',
  activity: 'status_pending',
  recovery: null,
});

const exactFilmOrderBoardPanels = (projection: WorkspaceProjection): WorkspaceBoardPanelProjection[] => {
  if (
    projection.boardPanels.length !== projection.activeShotIds.length ||
    projection.boardPanels.some((panel, index) => panel?.shotId !== projection.activeShotIds[index]) ||
    new Set(projection.activeShotIds).size !== projection.activeShotIds.length
  ) {
    return projection.activeShotIds.map(statusPendingPanel);
  }
  return projection.boardPanels.map((panel) => ({ ...panel, staleCauses: [...panel.staleCauses] }));
};

export type BoardActions = {
  drawNext: () => void;
  drawBeat: (beatId: string) => void;
  redrawShot: (shotId: string) => void;
  redrawBeat: (beatId: string) => void;
  promotePanel: (shotId: string, boardAssetId: string) => void;
  stop: () => void;
  retryJob: (jobId: string, acknowledgePossibleDuplicateCharge: boolean) => void;
  retryDownload: (jobId: string) => void;
  cancelJob: (jobId: string) => void;
  restoreBeat: (beatId: string, beforeBeatId: string | null) => Promise<boolean>;
  restoreShot: (shotId: string, beforeShotId: string | null) => Promise<boolean>;
  reorderBin: (bin: readonly StudioBinItem[]) => Promise<boolean>;
  persistCapturedPoster: (input: {
    shotId: string;
    videoAssetId: string;
    dataUrl: string;
    width: number;
    height: number;
  }) => Promise<boolean>;
};

export type BoardViewProps = {
  projectId: string;
  projection: WorkspaceProjection;
  projectStatus: StudioProjectStatusV2 | null;
  projectStatusPending: boolean;
  previewSuspended: boolean;
  selectedBeatId: string | null;
  pending: boolean;
  gateLocked: boolean;
  imageRouteReady: boolean;
  actions: BoardActions;
  binFocusAnnouncement: string;
  binFocusItemKey: string | null;
  onBinFocusItemSettled: () => void;
  onOpenBeat: (beatId: string) => void;
  onReviewReferenceBinding: (shotId: string) => void;
};

type ShotMediaProps = {
  media: BoardShotTileMedia;
  previewSuspended: boolean;
  projectId: string;
  shotId: string;
  videoProbeScheduler: BoardVideoProbeScheduler;
  onPosterCaptured: (input: {
    shotId: string;
    videoAssetId: string;
    dataUrl: string;
    width: number;
    height: number;
  }) => Promise<boolean>;
};

const ShotMedia: React.FC<ShotMediaProps> = ({
  media,
  previewSuspended,
  projectId,
  shotId,
  videoProbeScheduler,
  onPosterCaptured,
}) => {
  const { t } = useTranslation();
  const assetUrl = media === null ? null : createManagedStudioAssetUrl(projectId, media.assetId);
  const videoProbeKey = media?.kind === 'video' ? `${projectId}:${shotId}:${media.assetId}` : null;
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const [visibility, setVisibility] = useState(() => ({
    intersecting: typeof window === 'undefined' || typeof window.IntersectionObserver !== 'function',
    epoch: 0,
  }));
  const [probeAttemptState, setProbeAttemptState] = useState<{ attempt: number; key: string | null }>(() => ({
    attempt: 0,
    key: videoProbeKey,
  }));
  const [grantedProbeRequestKey, setGrantedProbeRequestKey] = useState<string | null>(null);
  const [finishedProbeKey, setFinishedProbeKey] = useState<string | null>(null);
  const [localPoster, setLocalPoster] = useState<{ key: string; url: string } | null>(null);
  const mediaRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const captureAttemptsRef = useRef(new Map<string, Promise<StudioPosterCaptureResult>>());
  const captureRetriesRef = useRef(new Set<string>());
  const captureRetryCancelByVideoRef = useRef(new WeakMap<HTMLVideoElement, () => void>());
  const captureRetryKeyByVideoRef = useRef(new WeakMap<HTMLVideoElement, string>());
  const nextVideoProbeInstanceRef = useRef(0);
  const showMedia = media !== null && assetUrl !== null && failedUrl !== assetUrl;
  const probeAttempt = probeAttemptState.key === videoProbeKey ? probeAttemptState.attempt : 0;
  const videoProbeRequestKey = videoProbeKey === null ? null : `${videoProbeKey}:${visibility.epoch}:${probeAttempt}`;
  const localPosterUrl = videoProbeKey !== null && localPoster?.key === videoProbeKey ? localPoster.url : null;
  const currentVideoProbeKeyRef = useRef(videoProbeKey);
  currentVideoProbeKeyRef.current = videoProbeKey;
  const currentVideoProbeRequestKeyRef = useRef(videoProbeRequestKey);
  currentVideoProbeRequestKeyRef.current = videoProbeRequestKey;
  const wantsVideoProbe =
    showMedia &&
    media?.kind === 'video' &&
    !previewSuspended &&
    visibility.intersecting &&
    localPosterUrl === null &&
    finishedProbeKey !== videoProbeKey;
  const showVideoProbe = wantsVideoProbe && grantedProbeRequestKey === videoProbeRequestKey;
  const setVideoProbeRef = useCallback((video: HTMLVideoElement | null) => {
    const previous = videoRef.current;
    if (video === null && previous !== null) {
      captureRetryCancelByVideoRef.current.get(previous)?.();
      captureRetryCancelByVideoRef.current.delete(previous);
      const retryKey = captureRetryKeyByVideoRef.current.get(previous);
      if (retryKey !== undefined) captureRetriesRef.current.delete(retryKey);
      captureRetryKeyByVideoRef.current.delete(previous);
      tearDownBoardVideoProbe(previous);
    }
    videoRef.current = video;
    if (video !== null) {
      nextVideoProbeInstanceRef.current += 1;
      captureRetryKeyByVideoRef.current.set(
        video,
        `${currentVideoProbeKeyRef.current ?? 'video'}:${nextVideoProbeInstanceRef.current}`
      );
    }
  }, []);

  useEffect(() => setFailedUrl(null), [assetUrl]);

  useEffect(() => {
    setLocalPoster((current) => (current === null || current.key === videoProbeKey ? current : null));
    setFinishedProbeKey((current) => (current === null || current === videoProbeKey ? current : null));
    setProbeAttemptState((current) => (current.key === videoProbeKey ? current : { attempt: 0, key: videoProbeKey }));
  }, [videoProbeKey]);

  useEffect(() => {
    if (previewSuspended) {
      setGrantedProbeRequestKey(null);
      setProbeAttemptState((current) => (current.attempt === 0 ? current : { ...current, attempt: 0 }));
    }
  }, [previewSuspended]);

  useEffect(() => {
    if (media?.kind !== 'video') return;
    const element = mediaRef.current;
    if (element === null) return;
    if (typeof window.IntersectionObserver !== 'function') {
      setVisibility((current) => (current.intersecting ? current : { intersecting: true, epoch: current.epoch + 1 }));
      return;
    }
    setVisibility((current) => (current.intersecting ? { intersecting: false, epoch: current.epoch + 1 } : current));
    const observer = new window.IntersectionObserver(
      (entries) => {
        const entry = entries.at(-1);
        const nextIntersecting = entry?.isIntersecting === true;
        if (!nextIntersecting) {
          setFinishedProbeKey((current) => (current === videoProbeKey ? null : current));
          setProbeAttemptState((current) =>
            current.key === videoProbeKey && current.attempt !== 0 ? { ...current, attempt: 0 } : current
          );
        }
        setVisibility((current) =>
          current.intersecting === nextIntersecting
            ? current
            : { intersecting: nextIntersecting, epoch: current.epoch + 1 }
        );
      },
      { threshold: 0.01 }
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [media?.kind, videoProbeKey]);

  useEffect(() => {
    if (!wantsVideoProbe || videoProbeRequestKey === null) return;
    let watchdog: number | null = null;
    const release = videoProbeScheduler.acquire(() => {
      setGrantedProbeRequestKey(videoProbeRequestKey);
      watchdog = window.setTimeout(
        () => {
          if (currentVideoProbeRequestKeyRef.current !== videoProbeRequestKey) return;
          if (probeAttempt + 1 < BOARD_VIDEO_PROBE_LEASE_WINDOWS_MS.length) {
            setProbeAttemptState((current) =>
              current.key === videoProbeKey && current.attempt === probeAttempt
                ? { ...current, attempt: probeAttempt + 1 }
                : current
            );
            return;
          }
          setFinishedProbeKey(videoProbeKey);
        },
        BOARD_VIDEO_PROBE_LEASE_WINDOWS_MS[probeAttempt] ?? BOARD_VIDEO_PROBE_LEASE_WINDOWS_MS.at(-1)
      );
    });
    return () => {
      if (watchdog !== null) window.clearTimeout(watchdog);
      setGrantedProbeRequestKey((current) => (current === videoProbeRequestKey ? null : current));
      release();
    };
  }, [probeAttempt, videoProbeKey, videoProbeRequestKey, videoProbeScheduler, wantsVideoProbe]);

  /*
   * The Board is a monitor: it shows every Shot at once, and a poster only ever existed for a Shot
   * whose Beat panel someone had opened (BUG-166). Capturing here means the first Board visit that
   * decodes a tile's video leaves an image behind, so later visits paint from a still rather than
   * from dozens of concurrent video elements.
   */
  const capturePoster = async (video: HTMLVideoElement): Promise<StudioPosterCaptureResult> => {
    if (media === null || media.kind !== 'video') return 'settled';
    const captureKey = `${projectId}:${shotId}:${media.assetId}`;
    const activeAttempt = captureAttemptsRef.current.get(captureKey);
    if (activeAttempt !== undefined) return activeAttempt;
    const captured = captureStudioVideoPoster(video);
    if (captured === null) return 'frame_unavailable';
    const attempt = Promise.resolve()
      .then(() => onPosterCaptured({ shotId, videoAssetId: media.assetId, ...captured }))
      .then((persisted): StudioPosterCaptureResult => {
        if (persisted && currentVideoProbeKeyRef.current === captureKey && mediaRef.current !== null) {
          setLocalPoster({ key: captureKey, url: captured.dataUrl });
        }
        return persisted ? 'settled' : 'persistence_failed';
      })
      .catch((): StudioPosterCaptureResult => 'persistence_failed');
    captureAttemptsRef.current.set(captureKey, attempt);
    void attempt.then(() => {
      if (captureAttemptsRef.current.get(captureKey) === attempt) captureAttemptsRef.current.delete(captureKey);
    });
    return attempt;
  };

  const scheduleCapture = (video: HTMLVideoElement): void => {
    void capturePoster(video).then((result) => {
      if (result === 'settled') return;
      if (media === null || media.kind !== 'video') return;
      const captureKey = `${projectId}:${shotId}:${media.assetId}`;
      const retryKey = captureRetryKeyByVideoRef.current.get(video);
      if (retryKey === undefined) return;
      let retryCount = 0;
      const cancel = scheduleStudioPosterCaptureRetry(video, retryKey, captureRetriesRef.current, result, async () => {
        const retryResult = await capturePoster(video);
        retryCount += 1;
        const helperWillRetryPersistence =
          result === 'frame_unavailable' && retryCount === 1 && retryResult === 'persistence_failed';
        const stillCurrentProbe =
          videoRef.current === video && captureRetryKeyByVideoRef.current.get(video) === retryKey;
        if (retryResult !== 'settled' && !helperWillRetryPersistence && stillCurrentProbe) {
          setFinishedProbeKey(captureKey);
        }
        return retryResult;
      });
      if (cancel !== null) captureRetryCancelByVideoRef.current.set(video, cancel);
    });
  };

  return (
    <div
      ref={mediaRef}
      className={styles.shotMedia}
      data-media-kind={showMedia ? media.kind : 'unavailable'}
      data-video-preview-state={
        media?.kind !== 'video'
          ? undefined
          : localPosterUrl !== null
            ? 'captured'
            : !showMedia || finishedProbeKey === videoProbeKey
              ? 'unavailable'
              : showVideoProbe
                ? 'probing'
                : visibility.intersecting
                  ? 'queued'
                  : 'deferred'
      }
    >
      {localPosterUrl !== null ? (
        <img alt='' className={styles.shotMediaAsset} src={localPosterUrl} />
      ) : showVideoProbe ? (
        <video
          ref={setVideoProbeRef}
          aria-label={t(`${KEY_ROOT}.shot.videoPreview`)}
          className={styles.shotMediaAsset}
          muted
          onError={() => setFailedUrl(assetUrl)}
          onLoadedData={(event) => scheduleCapture(event.currentTarget)}
          playsInline
          preload='metadata'
          src={assetUrl}
        />
      ) : showMedia && media.kind === 'video' ? (
        <span aria-label={t(`${KEY_ROOT}.shot.videoPreview`)} className={styles.coverPlaceholder} role='img'>
          {t(`${KEY_ROOT}.shot.videoPreview`)}
        </span>
      ) : showMedia ? (
        <img
          alt=''
          className={styles.shotMediaAsset}
          loading='lazy'
          onError={() => setFailedUrl(assetUrl)}
          src={assetUrl}
        />
      ) : (
        <span className={styles.coverPlaceholder}>{t(`${KEY_ROOT}.coverUnavailable`)}</span>
      )}
    </div>
  );
};

type BoardPanelArtworkProps = {
  panel: WorkspaceBoardPanelProjection;
  projectId: string;
};

const BoardPanelArtwork: React.FC<BoardPanelArtworkProps> = ({ panel, projectId }) => {
  const assetUrl = panel.assetId === null ? null : createManagedStudioAssetUrl(projectId, panel.assetId);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const showImage = assetUrl !== null && failedUrl !== assetUrl;

  useEffect(() => setFailedUrl(null), [assetUrl]);

  return (
    <span
      aria-hidden='true'
      className={styles.panelArtwork}
      data-activity={panel.activity}
      data-asset-id={panel.assetId ?? undefined}
      data-freshness={panel.freshness}
    >
      {showImage ? <img alt='' loading='lazy' onError={() => setFailedUrl(assetUrl)} src={assetUrl} /> : null}
      <span className={styles.panelActivityMark} />
    </span>
  );
};

type BoardPanelRecoveryControlsProps = {
  actions: BoardActions;
  describedBy: string;
  disabled: boolean;
  onAction: () => void;
  panel: WorkspaceBoardPanelProjection;
  shotLabel: string;
};

const BoardPanelRecoveryControls: React.FC<BoardPanelRecoveryControlsProps> = ({
  actions,
  describedBy,
  disabled,
  onAction,
  panel,
  shotLabel,
}) => {
  const { t } = useTranslation();
  const recovery = panel.recovery;
  if (recovery === null) return null;
  const retryLabel = `${t('conversation.creativeStudio.jobs.retry')} · ${shotLabel}`;
  const retryDownloadLabel = `${t('conversation.creativeStudio.jobs.retryDownload')} · ${shotLabel}`;
  const cancelLabel = `${t('conversation.creativeStudio.jobs.cancel')} · ${shotLabel}`;
  return (
    <div className={styles.panelRecovery} data-board-recovery-job-id={recovery.jobId}>
      {recovery.canRetryDownload ? (
        <Button
          aria-describedby={describedBy}
          aria-label={retryDownloadLabel}
          disabled={disabled}
          onClick={() => {
            if (!disabled) {
              onAction();
              actions.retryDownload(recovery.jobId);
            }
          }}
          size='mini'
        >
          {t('conversation.creativeStudio.jobs.retryDownload')}
        </Button>
      ) : null}
      {recovery.canRetry && recovery.submissionUnknown ? (
        <Popconfirm
          cancelText={t(`${BEAT_PANEL_ROOT}.common.cancel`)}
          content={t('conversation.creativeStudio.jobs.retryChargeBody')}
          disabled={disabled}
          okText={t('conversation.creativeStudio.jobs.retryChargeConfirm')}
          onOk={() => {
            if (!disabled) {
              onAction();
              actions.retryJob(recovery.jobId, true);
            }
          }}
          title={t('conversation.creativeStudio.jobs.retryChargeTitle')}
        >
          <Button aria-describedby={describedBy} aria-label={retryLabel} disabled={disabled} size='mini'>
            {t('conversation.creativeStudio.jobs.retry')}
          </Button>
        </Popconfirm>
      ) : recovery.canRetry ? (
        <Button
          aria-describedby={describedBy}
          aria-label={retryLabel}
          disabled={disabled}
          onClick={() => {
            if (!disabled) {
              onAction();
              actions.retryJob(recovery.jobId, false);
            }
          }}
          size='mini'
        >
          {t('conversation.creativeStudio.jobs.retry')}
        </Button>
      ) : null}
      {recovery.canCancel ? (
        <Button
          aria-describedby={describedBy}
          aria-label={cancelLabel}
          disabled={disabled}
          onClick={() => {
            if (!disabled) {
              onAction();
              actions.cancelJob(recovery.jobId);
            }
          }}
          size='mini'
        >
          {t('conversation.creativeStudio.jobs.cancel')}
        </Button>
      ) : null}
    </div>
  );
};

type ShotTileProps = {
  actions: BoardActions;
  generationLocked: boolean;
  interactionLocked: boolean;
  panel: WorkspaceBoardPanelProjection;
  previewSuspended: boolean;
  projectId: string;
  shot: BoardShotTile;
  statusPending: boolean;
  videoProbeScheduler: BoardVideoProbeScheduler;
  onReviewReferenceBinding: (shotId: string) => void;
};

const ShotTile: React.FC<ShotTileProps> = ({
  actions,
  generationLocked,
  interactionLocked,
  panel,
  previewSuspended,
  projectId,
  shot,
  statusPending,
  videoProbeScheduler,
  onReviewReferenceBinding,
}) => {
  const { t } = useTranslation();
  const shootingScriptMissing = shot.shootingScript.trim().length === 0;
  const visibleBlockers = shootingScriptMissing
    ? shot.blockers.filter((blocker) => blocker.value.cause !== 'shooting_script_required')
    : shot.blockers;
  const canReviewReferenceBinding = visibleBlockers.some((blocker) => blocker.reviewReferenceBinding);
  const panelStatusId = useId();
  const panelCardRef = useRef<HTMLDivElement | null>(null);
  const shotLabel = t(`${KEY_ROOT}.shot.position`, {
    beat: shot.beatPosition,
    shot: shot.shotPosition,
  });
  return (
    <li
      aria-label={t(`${KEY_ROOT}.shot.ariaLabel`, {
        beat: shot.beatPosition,
        shot: shot.shotPosition,
      })}
      className={styles.shotTile}
      data-shot-id={shot.shotId}
      data-shot-tile
    >
      <ShotMedia
        media={shot.media}
        onPosterCaptured={actions.persistCapturedPoster}
        previewSuspended={previewSuspended}
        projectId={projectId}
        shotId={shot.shotId}
        videoProbeScheduler={videoProbeScheduler}
      />
      <div
        ref={panelCardRef}
        aria-label={t(`${KEY_ROOT}.panel.cardLabel`, { position: shotLabel, status: t(panelStatusKey(panel)) })}
        className={styles.panelCard}
        data-board-panel-shot-id={shot.shotId}
        role='group'
        tabIndex={-1}
      >
        <BoardPanelArtwork panel={panel} projectId={projectId} />
        <div className={styles.panelBody}>
          <span className={styles.panelLabel}>
            {t('conversation.creativeStudio.workspace.gate.purpose.board_still')}
          </span>
          <span
            className={styles.panelStatus}
            data-panel-activity={panel.activity}
            data-panel-freshness={panel.freshness}
            id={panelStatusId}
          >
            {t(panelStatusKey(panel))}
          </span>
          <BoardPanelRecoveryControls
            actions={actions}
            describedBy={panelStatusId}
            disabled={interactionLocked}
            onAction={() => {
              panelCardRef.current?.focus({ preventScroll: true });
            }}
            panel={panel}
            shotLabel={shotLabel}
          />
          <div className={styles.panelActions}>
            {shot.chain.kind === 'head' &&
            shot.explicitSeedAssetId !== panel.assetId &&
            isPromotableBoardPanel(panel) ? (
              <Button
                aria-describedby={panelStatusId}
                disabled={interactionLocked || shot.promotionBlocked}
                onClick={() => {
                  if (!interactionLocked && !shot.promotionBlocked) actions.promotePanel(shot.shotId, panel.assetId);
                }}
                size='mini'
              >
                {t(`${KEY_ROOT}.panel.useAsFirstFrame`, { position: shotLabel })}
              </Button>
            ) : null}
            {panel.assetId !== null && panel.recovery?.canRetryDownload !== true ? (
              <Button
                aria-describedby={panelStatusId}
                disabled={generationLocked || !isDrawableBoardPanel(panel)}
                onClick={() => {
                  if (!generationLocked && isDrawableBoardPanel(panel)) actions.redrawShot(shot.shotId);
                }}
                size='mini'
              >
                {t(`${KEY_ROOT}.panel.redrawShot`, { position: shotLabel })}
              </Button>
            ) : null}
          </div>
          {shot.seedAuthorizationLocked && isPromotableBoardPanel(panel) ? (
            <p className={styles.panelLockCopy}>
              {t('conversation.creativeStudio.workspace.beatPanel.seeds.authorizationLocked')}
            </p>
          ) : null}
        </div>
      </div>
      <div className={styles.shotBody}>
        <div className={styles.shotHeading}>
          <span className={styles.shotPosition}>
            <bdi>
              {t(`${KEY_ROOT}.shot.position`, {
                beat: shot.beatPosition,
                shot: shot.shotPosition,
              })}
            </bdi>
          </span>
          <span
            className={styles.shotStatus}
            data-composer-status-word={shot.status.word}
            data-latest-attempt-failed={shot.status.latestAttemptFailed}
            data-stale={shot.status.stale}
          >
            {t(`conversation.creativeStudio.workspace.shotStatus.${shot.status.word}`)}
            {shot.status.stale ? ` · ${t(`${KEY_ROOT}.shot.stale`)}` : ''}
            {shot.status.latestAttemptFailed
              ? ` · ${t('conversation.creativeStudio.workspace.shotStatus.latestAttemptFailed')}`
              : ''}
          </span>
        </div>
        <div className={styles.shotFacts}>
          <span data-chain-kind={shot.chain.kind}>
            <bdi>
              {shot.chain.kind === 'head'
                ? t(`${KEY_ROOT}.shot.chainHead`)
                : t(`${KEY_ROOT}.shot.chainAfter`, {
                    beat: shot.chain.beatPosition,
                    shot: shot.chain.shotPosition,
                  })}
            </bdi>
          </span>
          <span>
            <bdi>{t(`${KEY_ROOT}.shot.duration`, { seconds: shot.durationSeconds })}</bdi>
          </span>
        </div>
        <p className={styles.shotScript} dir='auto'>
          {shot.shootingScript.trim() ||
            t('conversation.creativeStudio.workspace.gate.errors.pricing.missingShootingScript')}
        </p>
        {!shot.blockersAvailable && statusPending ? null : !shot.blockersAvailable ? (
          <p className={styles.shotStatusUnavailable} data-blocker-status='unavailable'>
            {t(`${KEY_ROOT}.shot.statusUnavailable`)}
          </p>
        ) : visibleBlockers.length === 0 ? null : (
          <div className={styles.shotBlockers} data-blocker-status='available'>
            <p className={styles.shotBlockerHeading}>{t(`${KEY_ROOT}.shot.blocker.heading`)}</p>
            <ul>
              {visibleBlockers.map((blocker, index) => (
                <li key={`${blocker.stage}:${blocker.value.cause}:${index}`}>
                  {t(SHOT_BLOCKER_CAUSE_KEYS[blocker.value.cause])}
                </li>
              ))}
            </ul>
            {canReviewReferenceBinding ? (
              <div className={styles.referenceReview}>
                <p>{t(`${KEY_ROOT}.shot.blocker.referenceBindingTable`)}</p>
                <Button
                  onClick={(event) => {
                    event.stopPropagation();
                    onReviewReferenceBinding(shot.shotId);
                  }}
                  size='small'
                  type='secondary'
                >
                  {t(`${KEY_ROOT}.shot.blocker.reviewOnTable`)}
                </Button>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </li>
  );
};

/** Film-order Board backed only by sanitized workspace projection facts and exact native actions. */
export const BoardView: React.FC<BoardViewProps> = ({
  projectId,
  projection,
  projectStatus,
  projectStatusPending,
  previewSuspended,
  selectedBeatId,
  pending,
  gateLocked,
  imageRouteReady,
  actions,
  binFocusAnnouncement,
  binFocusItemKey,
  onBinFocusItemSettled,
  onOpenBeat,
  onReviewReferenceBinding,
}) => {
  const { t } = useTranslation();
  const [localFocusItemKey, setLocalFocusItemKey] = useState<string | null>(null);
  const [restoreFocusIntent, setRestoreFocusIntent] = useState<{ projectId: string; beatId: string } | null>(null);
  const [videoProbeScheduler] = useState(() => new BoardVideoProbeScheduler());
  const titleRefs = useRef(new Map<string, HTMLButtonElement>());
  const tileBoard = useMemo(
    () => (projectId === projection.projectId ? deriveBoardShotTiles(projection, projectStatus) : null),
    [projectId, projectStatus, projection]
  );
  const blockerStatusPending = projectStatus === null && projectStatusPending;
  const exactBoardPanels = useMemo(() => exactFilmOrderBoardPanels(projection), [projection]);
  const panelByShotId = useMemo(
    () => new Map(exactBoardPanels.map((panel) => [panel.shotId, panel] as const)),
    [exactBoardPanels]
  );
  const boardSummary = useMemo(() => {
    const currentFrames = exactBoardPanels.filter((panel) => panel.freshness === 'current').length;
    const videos = tileBoard?.beats.reduce((total, beat) => total + beat.renderedCount, 0) ?? 0;
    const unrenderedShotIds = new Set(
      projection.activeBeats.flatMap((beat) =>
        beat.shots.filter((shot) => !workspaceShotHasFreshCurrentTake(shot)).map((shot) => shot.id)
      )
    );
    const stale = exactBoardPanels.filter((panel) => panel.freshness === 'stale').length;
    const busy = exactBoardPanels.filter((panel) => BUSY_BOARD_ACTIVITIES.has(panel.activity)).length;
    const statusPending = exactBoardPanels.some(
      (panel) => panel.freshness === 'status_pending' || panel.activity === 'status_pending'
    );
    const drawableMissing = exactBoardPanels.filter(
      (panel) => unrenderedShotIds.has(panel.shotId) && panel.freshness === 'missing' && isDrawableBoardPanel(panel)
    ).length;
    return {
      currentFrames,
      videos,
      stale,
      busy,
      statusPending,
      nextBatch: Math.min(STUDIO_MAX_GENERATION_SHOTS_PER_REQUEST, drawableMissing),
      total: exactBoardPanels.length,
    };
  }, [exactBoardPanels, projection.activeBeats, tileBoard]);
  const boardControlsRef = useRef<HTMLElement | null>(null);
  const interactionLocked = pending || gateLocked || tileBoard === null;
  const generationLocked = interactionLocked || boardSummary.statusPending || !imageRouteReady;
  const canDrawNext = !generationLocked && boardSummary.nextBatch > 0;
  const canStop = !interactionLocked && boardSummary.busy > 0;
  const managedProjectId = projectId === projection.projectId ? projectId : '';
  const requestedBinFocusItemKey = binFocusItemKey ?? localFocusItemKey;

  useEffect(() => {
    if (restoreFocusIntent === null) return;
    if (restoreFocusIntent.projectId !== projectId || projection.projectId !== projectId) {
      setRestoreFocusIntent(null);
      return;
    }
    if (projection.activeBeatIds.includes(restoreFocusIntent.beatId)) {
      const control = titleRefs.current.get(restoreFocusIntent.beatId);
      if (control === undefined) return;
      control.focus();
      setRestoreFocusIntent(null);
      return;
    }
    const binnedOwner = projection.bin.items.find(
      (entry) => entry.kind === 'beat' && entry.identity.beatId === restoreFocusIntent.beatId
    );
    if (binnedOwner !== undefined) {
      setLocalFocusItemKey(binItemFocusKey(binnedOwner.identity));
      setRestoreFocusIntent(null);
    }
  }, [projectId, projection.activeBeatIds, projection.bin.items, projection.projectId, restoreFocusIntent]);

  return (
    <section className={styles.root}>
      <header className={styles.header}>
        <h2 className={styles.heading}>{t(`${KEY_ROOT}.ariaLabel`)}</h2>
      </header>

      <section
        ref={boardControlsRef}
        aria-label={t(`${KEY_ROOT}.controls.label`)}
        className={styles.boardControls}
        role='region'
        tabIndex={-1}
      >
        <div className={styles.boardProgressGroup}>
          <div className={styles.boardProgressBlock}>
            <strong className={styles.boardProgressText}>
              {t(`${KEY_ROOT}.controls.progress`, {
                current: boardSummary.currentFrames,
                total: boardSummary.total,
              })}
            </strong>
            <progress
              aria-label={t(`${KEY_ROOT}.controls.progressLabel`)}
              className={styles.boardProgress}
              max={Math.max(1, boardSummary.total)}
              value={boardSummary.currentFrames}
            />
          </div>
          <div className={styles.boardProgressBlock}>
            <strong className={styles.boardProgressText}>
              {t(`${KEY_ROOT}.controls.videoProgress`, {
                current: boardSummary.videos,
                total: boardSummary.total,
              })}
            </strong>
            <progress
              aria-label={t(`${KEY_ROOT}.controls.videoProgressLabel`)}
              className={styles.boardProgress}
              max={Math.max(1, boardSummary.total)}
              value={boardSummary.videos}
            />
          </div>
          <span className={styles.boardProgressFacts}>
            <span>{t(`${KEY_ROOT}.controls.staleCount`, { count: boardSummary.stale })}</span>
            <span>{t(`${KEY_ROOT}.controls.busyCount`, { count: boardSummary.busy })}</span>
          </span>
        </div>
        <div className={styles.boardPrimaryAction}>
          {boardSummary.busy > 0 ? (
            <>
              <Button
                disabled={!canStop}
                onClick={() => {
                  if (canStop) {
                    boardControlsRef.current?.focus({ preventScroll: true });
                    actions.stop();
                  }
                }}
                status='danger'
              >
                {t(`${KEY_ROOT}.controls.stop`)}
              </Button>
              <p>{t(`${KEY_ROOT}.controls.stopNote`)}</p>
            </>
          ) : (
            <Button
              disabled={!canDrawNext}
              onClick={() => {
                if (canDrawNext) actions.drawNext();
              }}
              type='primary'
            >
              {t(`${KEY_ROOT}.controls.drawNext`, { count: boardSummary.nextBatch })}
            </Button>
          )}
        </div>
      </section>

      {tileBoard !== null && tileBoard.globalBlockers.length > 0 ? (
        <section
          aria-label={t(`${KEY_ROOT}.shot.blocker.heading`)}
          className={styles.boardBlockers}
          data-board-blockers
        >
          <p className={styles.shotBlockerHeading}>{t(`${KEY_ROOT}.shot.blocker.heading`)}</p>
          <ul>
            {tileBoard.globalBlockers.map((blocker, index) => (
              <li key={`${blocker.stage}:${blocker.value.cause}:${index}`}>
                {blocker.value.where.kind === 'route' ? `${t(ROUTE_KIND_KEYS[blocker.value.where.routeKind])} · ` : ''}
                {t(SHOT_BLOCKER_CAUSE_KEYS[blocker.value.cause])}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {tileBoard === null ? (
        <p className={styles.boardUnavailable} role='status'>
          {t(`${KEY_ROOT}.statusUnavailable`)}
        </p>
      ) : (
        <ol aria-label={t(`${KEY_ROOT}.ariaLabel`)} className={styles.beatList}>
          {tileBoard.beats.map((beatTiles, index) => {
            const { beat } = beatTiles;
            const selected = beat.id === selectedBeatId;
            const boardPanelsForBeat = beatTiles.shots.map(
              (shot) => panelByShotId.get(shot.shotId) ?? statusPendingPanel(shot.shotId)
            );
            const unrenderedShotIds = new Set(
              beatTiles.shots.filter((shot) => !shot.hasFreshCurrentTake).map((shot) => shot.shotId)
            );
            const drawableMissingCount = boardPanelsForBeat.filter(
              (panel) =>
                unrenderedShotIds.has(panel.shotId) && panel.freshness === 'missing' && isDrawableBoardPanel(panel)
            ).length;
            const canDrawMissing =
              !generationLocked &&
              drawableMissingCount > 0 &&
              drawableMissingCount <= STUDIO_MAX_GENERATION_SHOTS_PER_REQUEST;
            const canOfferRedrawBeat =
              boardPanelsForBeat.length > 0 &&
              boardPanelsForBeat.length <= STUDIO_MAX_GENERATION_SHOTS_PER_REQUEST &&
              boardPanelsForBeat.every((panel) => panel.assetId !== null && isDrawableBoardPanel(panel));
            const title =
              beat.title.trim() ||
              t('conversation.creativeStudio.workspace.beatPanel.untitledBeat', { index: beatTiles.beatPosition });
            const accessibleBeatTitle = `${beatTiles.beatPosition}. ${title}`;
            const actualDuration =
              beat.actualSeconds === null ? null : t(`${KEY_ROOT}.actualDuration`, { seconds: beat.actualSeconds });

            return (
              <li key={beat.id} className={styles.beatCard} data-beat-id={beat.id} data-selected={selected}>
                <header className={styles.beatHeader}>
                  <span className={styles.ordinal}>
                    <bdi>{t(`${KEY_ROOT}.ordinal`, { index: String(index + 1).padStart(2, '0') })}</bdi>
                  </span>
                  <div className={styles.beatCopy}>
                    <Button
                      ref={(node) => {
                        if (node === null) titleRefs.current.delete(beat.id);
                        else if (node instanceof HTMLButtonElement) titleRefs.current.set(beat.id, node);
                      }}
                      aria-current={selected ? 'true' : undefined}
                      aria-label={t(`${KEY_ROOT}.openBeat`, { title })}
                      className={styles.beatTitle}
                      onClick={() => onOpenBeat(beat.id)}
                      type='text'
                    >
                      <span dir='auto'>{title}</span>
                      {selected ? <span className={styles.srOnly}>{t(`${KEY_ROOT}.selectedBeat`)}</span> : null}
                    </Button>
                    <p className={styles.story} dir='auto'>
                      {beat.story}
                    </p>
                    <div className={styles.facts}>
                      <span>
                        <bdi>{t(`${KEY_ROOT}.shotCount`, { count: beatTiles.shotCount })}</bdi>
                      </span>
                      <span data-count-kind='rendered'>
                        <bdi>
                          {t(`${KEY_ROOT}.renderedCount`, {
                            count: beatTiles.renderedCount,
                            total: beatTiles.shotCount,
                          })}
                        </bdi>
                      </span>
                      {beatTiles.staleCount === 0 ? null : (
                        <span data-count-kind='stale'>
                          <bdi>{t(`${KEY_ROOT}.staleCount`, { count: beatTiles.staleCount })}</bdi>
                        </span>
                      )}
                      {beatTiles.inFlightCount === 0 ? null : (
                        <span data-count-kind='in-flight'>
                          <bdi>{t(`${KEY_ROOT}.inFlightCount`, { count: beatTiles.inFlightCount })}</bdi>
                        </span>
                      )}
                      {actualDuration === null ? null : (
                        <span data-duration-kind='actual'>
                          <bdi>{actualDuration}</bdi>
                        </span>
                      )}
                    </div>
                  </div>
                  {drawableMissingCount > 0 || canOfferRedrawBeat ? (
                    <div
                      aria-label={t(`${KEY_ROOT}.panel.beatActions`, { title: accessibleBeatTitle })}
                      className={styles.beatPanelActions}
                      role='group'
                    >
                      {drawableMissingCount > 0 ? (
                        <Button
                          aria-label={`${t(`${KEY_ROOT}.panel.drawMissing`, { count: drawableMissingCount })} · ${accessibleBeatTitle}`}
                          disabled={!canDrawMissing}
                          onClick={() => {
                            if (canDrawMissing) actions.drawBeat(beat.id);
                          }}
                          size='small'
                          type='primary'
                        >
                          {t(`${KEY_ROOT}.panel.drawMissing`, { count: drawableMissingCount })}
                        </Button>
                      ) : null}
                      {canOfferRedrawBeat ? (
                        <Button
                          aria-label={`${t(`${KEY_ROOT}.panel.redrawBeat`)} · ${accessibleBeatTitle}`}
                          disabled={generationLocked}
                          onClick={() => {
                            if (!generationLocked) actions.redrawBeat(beat.id);
                          }}
                          size='small'
                        >
                          {t(`${KEY_ROOT}.panel.redrawBeat`)}
                        </Button>
                      ) : null}
                    </div>
                  ) : null}
                </header>

                {beatTiles.shots.length === 0 ? (
                  <p className={styles.noCoverage}>{t(`${KEY_ROOT}.noCoverage`)}</p>
                ) : (
                  <ol aria-label={t(`${KEY_ROOT}.shot.listLabel`, { title })} className={styles.shotGrid}>
                    {beatTiles.shots.map((shot) => (
                      <ShotTile
                        key={shot.shotId}
                        actions={actions}
                        generationLocked={generationLocked}
                        interactionLocked={interactionLocked}
                        onReviewReferenceBinding={onReviewReferenceBinding}
                        panel={panelByShotId.get(shot.shotId) ?? statusPendingPanel(shot.shotId)}
                        previewSuspended={previewSuspended}
                        projectId={managedProjectId}
                        shot={shot}
                        statusPending={blockerStatusPending}
                        videoProbeScheduler={videoProbeScheduler}
                      />
                    ))}
                  </ol>
                )}
              </li>
            );
          })}
        </ol>
      )}

      <Bin
        actions={actions}
        focusItemKey={requestedBinFocusItemKey}
        onFocusItemSettled={() => {
          if (binFocusItemKey !== null) onBinFocusItemSettled();
          else setLocalFocusItemKey(null);
        }}
        onRestoreSuccess={(result) => {
          setRestoreFocusIntent({ projectId, beatId: result.beatId });
        }}
        pending={interactionLocked}
        projectId={projectId}
        projection={projection}
      />

      <span aria-atomic='true' aria-live='polite' className={styles.srOnly} data-studio-shot-lift-announcement>
        {binFocusAnnouncement}
      </span>
    </section>
  );
};

export { binItemFocusKey } from './Bin';
