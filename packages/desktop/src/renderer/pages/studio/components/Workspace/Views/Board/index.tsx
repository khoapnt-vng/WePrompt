/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Popconfirm } from '@arco-design/web-react';
import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type {
  StudioBinItem,
  StudioProjectStatusBlockerCauseV2,
  StudioProjectStatusV2,
} from '@/common/types/project/creativeStudioTypes';
import { STUDIO_MAX_GENERATION_SHOTS_PER_REQUEST } from '@/common/types/project/creativeStudioTypes';
import { captureStudioVideoPoster } from '../../BeatPanel/FirstFrames';
import { createManagedStudioAssetUrl } from '@/renderer/pages/studio/studioManagedAssetUrl';

import type { WorkspaceBoardPanelProjection, WorkspaceProjection } from '../../workspaceProjection';
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
  projectId: string;
  shotId: string;
  onPosterCaptured: (input: {
    shotId: string;
    videoAssetId: string;
    dataUrl: string;
    width: number;
    height: number;
  }) => Promise<boolean>;
};

const ShotMedia: React.FC<ShotMediaProps> = ({ media, projectId, shotId, onPosterCaptured }) => {
  const { t } = useTranslation();
  const assetUrl = media === null ? null : createManagedStudioAssetUrl(projectId, media.assetId);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const capturedRef = useRef(new Set<string>());
  const showMedia = media !== null && assetUrl !== null && failedUrl !== assetUrl;

  useEffect(() => setFailedUrl(null), [assetUrl]);

  /*
   * The Board is a monitor: it shows every Shot at once, and a poster only ever existed for a Shot
   * whose Beat panel someone had opened (BUG-166). Capturing here means the first Board visit that
   * decodes a tile's video leaves an image behind, so later visits paint from a still rather than
   * from dozens of concurrent video elements.
   */
  const capturePoster = async (video: HTMLVideoElement): Promise<void> => {
    if (media === null || media.kind !== 'video') return;
    const captureKey = `${projectId}:${shotId}:${media.assetId}`;
    if (capturedRef.current.has(captureKey)) return;
    const captured = captureStudioVideoPoster(video);
    if (captured === null) return;
    capturedRef.current.add(captureKey);
    const persisted = await onPosterCaptured({ shotId, videoAssetId: media.assetId, ...captured });
    if (!persisted) capturedRef.current.delete(captureKey);
  };

  return (
    <div className={styles.shotMedia} data-media-kind={showMedia ? media.kind : 'unavailable'}>
      {showMedia && media.kind === 'video' ? (
        <video
          aria-label={t(`${KEY_ROOT}.shot.videoPreview`)}
          className={styles.shotMediaAsset}
          muted
          onError={() => setFailedUrl(assetUrl)}
          onLoadedData={(event) => void capturePoster(event.currentTarget)}
          playsInline
          preload='metadata'
          src={assetUrl}
        />
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
  projectId: string;
  shot: BoardShotTile;
  statusPending: boolean;
  onReviewReferenceBinding: (shotId: string) => void;
};

const ShotTile: React.FC<ShotTileProps> = ({
  actions,
  generationLocked,
  interactionLocked,
  panel,
  projectId,
  shot,
  statusPending,
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
        projectId={projectId}
        shotId={shot.shotId}
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
    const drawn = exactBoardPanels.filter((panel) => panel.assetId !== null).length;
    const stale = exactBoardPanels.filter((panel) => panel.freshness === 'stale').length;
    const busy = exactBoardPanels.filter((panel) => BUSY_BOARD_ACTIVITIES.has(panel.activity)).length;
    const statusPending = exactBoardPanels.some(
      (panel) => panel.freshness === 'status_pending' || panel.activity === 'status_pending'
    );
    const drawableMissing = exactBoardPanels.filter(
      (panel) => panel.freshness === 'missing' && isDrawableBoardPanel(panel)
    ).length;
    return {
      drawn,
      stale,
      busy,
      statusPending,
      nextBatch: Math.min(STUDIO_MAX_GENERATION_SHOTS_PER_REQUEST, drawableMissing),
      total: exactBoardPanels.length,
    };
  }, [exactBoardPanels]);
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
        <div className={styles.boardProgressBlock}>
          <strong className={styles.boardProgressText}>
            {t(`${KEY_ROOT}.controls.progress`, {
              drawn: boardSummary.drawn,
              total: boardSummary.total,
            })}
          </strong>
          <progress
            aria-label={t(`${KEY_ROOT}.controls.progressLabel`)}
            className={styles.boardProgress}
            max={Math.max(1, boardSummary.total)}
            value={boardSummary.drawn}
          />
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
            const drawableMissingCount = boardPanelsForBeat.filter(
              (panel) => panel.freshness === 'missing' && isDrawableBoardPanel(panel)
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
                        projectId={managedProjectId}
                        shot={shot}
                        statusPending={blockerStatusPending}
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
