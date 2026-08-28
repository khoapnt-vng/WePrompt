/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ArrowDown, ArrowUp, Drag } from '@icon-park/react';
import { Button, Popconfirm } from '@arco-design/web-react';
import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type {
  StudioBinItem,
  StudioProjectStatusBlockerCauseV2,
  StudioProjectStatusV2,
  StudioRendererParkBlockerCodeV2,
  StudioRendererParkEligibilityV2,
} from '@/common/types/project/creativeStudioTypes';
import { createManagedStudioAssetUrl } from '@/renderer/pages/studio/studioManagedAssetUrl';

import type { WorkspaceProjection } from '../../workspaceProjection';
import { Bin, binItemFocusKey } from './Bin';
import { deriveBoardShotTiles, type BoardShotTile, type BoardShotTileMedia } from './boardShotTiles';
import styles from './Board.module.css';

const KEY_ROOT = 'conversation.creativeStudio.workspace.board';
const BEAT_PANEL_ROOT = 'conversation.creativeStudio.workspace.beatPanel';
const WORKSPACE_CONTROLS_ROOT = 'conversation.creativeStudio.workspace.controls';

const BLOCKER_KEYS = {
  own_nonterminal_job: `${BEAT_PANEL_ROOT}.blocker.ownNonterminalJob`,
  own_pending_frame: `${BEAT_PANEL_ROOT}.blocker.ownPendingFrame`,
  downstream_nonterminal_job: `${BEAT_PANEL_ROOT}.blocker.downstreamNonterminalJob`,
  downstream_pending_frame: `${BEAT_PANEL_ROOT}.blocker.downstreamPendingFrame`,
  waiting_authorization_dependency: `${BEAT_PANEL_ROOT}.blocker.waitingAuthorizationDependency`,
  bound_nonterminal_request: `${BEAT_PANEL_ROOT}.blocker.boundNonterminalRequest`,
  beat_shot_capacity_reached: `${BEAT_PANEL_ROOT}.blocker.beatShotCapacityReached`,
} as const satisfies Record<StudioRendererParkBlockerCodeV2, string>;

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

export type BoardActions = {
  reorderBeats: (beatOrder: readonly string[]) => Promise<boolean>;
  parkBeat: (beatId: string) => Promise<boolean>;
  restoreBeat: (beatId: string, beforeBeatId: string | null) => Promise<boolean>;
  restoreShot: (shotId: string, beforeShotId: string | null) => Promise<boolean>;
  reorderBin: (bin: readonly StudioBinItem[]) => Promise<boolean>;
};

export type BoardViewProps = {
  projectId: string;
  projection: WorkspaceProjection;
  projectStatus: StudioProjectStatusV2 | null;
  selectedBeatId: string | null;
  dirtyBeatIds: readonly string[];
  pending: boolean;
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
};

const exactBeatParkEligibility = (
  projection: WorkspaceProjection,
  projectId: string,
  beatId: string
): StudioRendererParkEligibilityV2 | null => {
  if (projection.projectId !== projectId || !projection.workspaceStatusReady) return null;
  const matches = projection.parkEligibility.filter(
    (row) => row.subject === 'beat' && row.action === 'park' && row.beatId === beatId && row.shotId === null
  );
  return matches.length === 1 ? matches[0]! : null;
};

const ShotMedia: React.FC<ShotMediaProps> = ({ media, projectId }) => {
  const { t } = useTranslation();
  const assetUrl = media === null ? null : createManagedStudioAssetUrl(projectId, media.assetId);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const showMedia = media !== null && assetUrl !== null && failedUrl !== assetUrl;

  useEffect(() => setFailedUrl(null), [assetUrl]);

  return (
    <div className={styles.shotMedia} data-media-kind={showMedia ? media.kind : 'unavailable'}>
      {showMedia && media.kind === 'video' ? (
        <video
          aria-label={t(`${KEY_ROOT}.shot.videoPreview`)}
          className={styles.shotMediaAsset}
          muted
          onError={() => setFailedUrl(assetUrl)}
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

type ShotTileProps = {
  projectId: string;
  shot: BoardShotTile;
  onReviewReferenceBinding: (shotId: string) => void;
};

const ShotTile: React.FC<ShotTileProps> = ({ projectId, shot, onReviewReferenceBinding }) => {
  const { t } = useTranslation();
  const canReviewReferenceBinding = shot.blockers.some((blocker) => blocker.reviewReferenceBinding);
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
      <ShotMedia media={shot.media} projectId={projectId} />
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
            data-stale={shot.status.stale}
          >
            {t(`conversation.creativeStudio.workspace.shotStatus.${shot.status.word}`)}
            {shot.status.stale ? ` · ${t(`${KEY_ROOT}.shot.stale`)}` : ''}
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
          {shot.shootingScript.trim() || t(`${KEY_ROOT}.shot.scriptUnavailable`)}
        </p>
        {!shot.blockersAvailable ? (
          <p className={styles.shotStatusUnavailable} data-blocker-status='unavailable'>
            {t(`${KEY_ROOT}.shot.statusUnavailable`)}
          </p>
        ) : shot.blockers.length === 0 ? null : (
          <div className={styles.shotBlockers} data-blocker-status='available'>
            <p className={styles.shotBlockerHeading}>{t(`${KEY_ROOT}.shot.blocker.heading`)}</p>
            <ul>
              {shot.blockers.map((blocker, index) => (
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

const moveOrder = (order: readonly string[], from: number, to: number): string[] | null => {
  if (from < 0 || from >= order.length || to < 0 || to >= order.length || from === to) return null;
  const next = [...order];
  const [moved] = next.splice(from, 1);
  if (moved === undefined) return null;
  next.splice(to, 0, moved);
  return next;
};

/** Film-order Board backed only by sanitized workspace projection facts and exact native actions. */
export const BoardView: React.FC<BoardViewProps> = ({
  projectId,
  projection,
  projectStatus,
  selectedBeatId,
  dirtyBeatIds,
  pending,
  actions,
  binFocusAnnouncement,
  binFocusItemKey,
  onBinFocusItemSettled,
  onOpenBeat,
  onReviewReferenceBinding,
}) => {
  const { t } = useTranslation();
  const [announcement, setAnnouncement] = useState('');
  const [busyBeatId, setBusyBeatId] = useState<string | null>(null);
  const [localFocusItemKey, setLocalFocusItemKey] = useState<string | null>(null);
  const [restoreFocusIntent, setRestoreFocusIntent] = useState<{ projectId: string; beatId: string } | null>(null);
  const [failedLiftFocusId, setFailedLiftFocusId] = useState<string | null>(null);
  const titleRefs = useRef(new Map<string, HTMLButtonElement>());
  const liftRefs = useRef(new Map<string, HTMLButtonElement>());
  const liftBlockerDescriptionId = useId();
  const mutationPendingRef = useRef(false);
  const draggedBeatIdRef = useRef<string | null>(null);
  const dirtyBeatIdSet = useMemo(() => new Set(dirtyBeatIds), [dirtyBeatIds]);
  const tileBoard = useMemo(
    () => (projectId === projection.projectId ? deriveBoardShotTiles(projection, projectStatus) : null),
    [projectId, projectStatus, projection]
  );
  const beatOrder = projection.activeBeats.map((beat) => beat.id);
  const canonicalOrderReady =
    tileBoard !== null && projectId === projection.projectId && new Set(beatOrder).size === beatOrder.length;
  const managedProjectId = projectId === projection.projectId ? projectId : '';

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

  useEffect(() => {
    if (failedLiftFocusId === null || busyBeatId !== null) return;
    if (!projection.activeBeatIds.includes(failedLiftFocusId)) {
      setFailedLiftFocusId(null);
      return;
    }
    const control = liftRefs.current.get(failedLiftFocusId);
    (control ?? titleRefs.current.get(failedLiftFocusId))?.focus();
    setFailedLiftFocusId(null);
  }, [busyBeatId, failedLiftFocusId, projection.activeBeatIds]);

  const focusBeatTitle = (beatId: string): void => {
    titleRefs.current.get(beatId)?.focus();
  };

  const reorderBeat = async (beatId: string, destination: number): Promise<void> => {
    if (pending || mutationPendingRef.current || !canonicalOrderReady) return;
    const source = beatOrder.indexOf(beatId);
    const nextOrder = moveOrder(beatOrder, source, destination);
    if (nextOrder === null) return;

    mutationPendingRef.current = true;
    setBusyBeatId(beatId);
    let reordered = false;
    try {
      reordered = await actions.reorderBeats(nextOrder);
      setAnnouncement(
        reordered
          ? t(`${KEY_ROOT}.reorderAnnouncement`, {
              title: projection.activeBeats[source]?.title || beatId,
              from: source + 1,
              to: destination + 1,
              total: beatOrder.length,
            })
          : t(`${KEY_ROOT}.reorderFailed`)
      );
    } catch {
      setAnnouncement(t(`${KEY_ROOT}.reorderFailed`));
    } finally {
      mutationPendingRef.current = false;
      setBusyBeatId(null);
      focusBeatTitle(beatId);
    }
  };

  const liftBeat = async (beatId: string, liftAllowed: boolean): Promise<void> => {
    if (!liftAllowed || pending || mutationPendingRef.current) return;
    mutationPendingRef.current = true;
    setBusyBeatId(beatId);
    let lifted = false;
    try {
      lifted = await actions.parkBeat(beatId);
      setAnnouncement(t(lifted ? `${KEY_ROOT}.liftSucceeded` : `${KEY_ROOT}.liftFailed`));
      if (lifted) setLocalFocusItemKey(binItemFocusKey({ kind: 'beat', beatId, reason: 'lifted' }));
    } catch {
      setAnnouncement(t(`${KEY_ROOT}.liftFailed`));
    } finally {
      mutationPendingRef.current = false;
      setBusyBeatId(null);
      if (!lifted) setFailedLiftFocusId(beatId);
    }
  };

  const requestedBinFocusItemKey = binFocusItemKey ?? localFocusItemKey;

  return (
    <section className={styles.root}>
      <header className={styles.header}>
        <h2 className={styles.heading}>{t(`${KEY_ROOT}.ariaLabel`)}</h2>
      </header>

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
            const eligibility = exactBeatParkEligibility(projection, projectId, beat.id);
            const dirty = dirtyBeatIdSet.has(beat.id);
            const liftAllowed =
              canonicalOrderReady && eligibility?.allowed === true && eligibility.blockers.length === 0 && !dirty;
            const blockerKeys = dirty
              ? [`${KEY_ROOT}.liftDirtyDraft`]
              : !canonicalOrderReady || eligibility === null
                ? [`${KEY_ROOT}.liftUnavailable`]
                : eligibility.blockers.length > 0
                  ? eligibility.blockers.map((blocker) => BLOCKER_KEYS[blocker.code])
                  : eligibility.allowed
                    ? []
                    : [`${KEY_ROOT}.liftUnavailable`];
            const mutationLocked = pending || busyBeatId !== null || !canonicalOrderReady;
            const liftGuarded = mutationLocked || !liftAllowed;
            const title =
              beat.title.trim() ||
              t('conversation.creativeStudio.workspace.beatPanel.untitledBeat', { index: beatTiles.beatPosition });
            const actualDuration =
              beat.actualSeconds === null ? null : t(`${KEY_ROOT}.actualDuration`, { seconds: beat.actualSeconds });
            const targetDuration =
              beat.targetSeconds === null ? null : t(`${KEY_ROOT}.targetDuration`, { seconds: beat.targetSeconds });

            return (
              <li
                key={beat.id}
                className={styles.beatCard}
                data-beat-id={beat.id}
                data-selected={selected}
                onDragOver={(event) => {
                  if (draggedBeatIdRef.current !== null && draggedBeatIdRef.current !== beat.id) event.preventDefault();
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  const draggedBeatId = draggedBeatIdRef.current;
                  draggedBeatIdRef.current = null;
                  if (draggedBeatId !== null) void reorderBeat(draggedBeatId, index);
                }}
              >
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
                      {targetDuration === null ? null : (
                        <span data-duration-kind='target'>
                          <bdi>{targetDuration}</bdi>
                        </span>
                      )}
                    </div>
                  </div>
                  {selected ? (
                    <div
                      aria-label={t(`${KEY_ROOT}.actionsLabel`, { title })}
                      className={styles.selectionActions}
                      onKeyDown={(event) => {
                        if (event.key !== 'Escape') return;
                        event.preventDefault();
                        event.stopPropagation();
                        focusBeatTitle(beat.id);
                      }}
                      role='group'
                    >
                      <div className={styles.cardActions}>
                        <Button
                          aria-label={t(`${KEY_ROOT}.dragHandle`, { title, position: index + 1 })}
                          className={styles.dragHandle}
                          disabled={mutationLocked}
                          draggable={!mutationLocked}
                          icon={<Drag />}
                          onDragEnd={() => {
                            draggedBeatIdRef.current = null;
                          }}
                          onDragStart={(event) => {
                            draggedBeatIdRef.current = beat.id;
                            event.dataTransfer.effectAllowed = 'move';
                            event.dataTransfer.setData('text/plain', beat.id);
                          }}
                          onKeyDown={(event) => {
                            let destination: number | null = null;
                            if (event.key === 'ArrowUp') destination = index - 1;
                            else if (event.key === 'ArrowDown') destination = index + 1;
                            else if (event.key === 'Home') destination = 0;
                            else if (event.key === 'End') destination = beatOrder.length - 1;
                            if (destination === null) return;
                            event.preventDefault();
                            void reorderBeat(beat.id, destination);
                          }}
                          size='small'
                        />
                        <Button
                          aria-label={t(`${KEY_ROOT}.moveEarlier`, { title })}
                          disabled={mutationLocked || index === 0}
                          icon={<ArrowUp />}
                          onClick={() => void reorderBeat(beat.id, index - 1)}
                          size='small'
                        />
                        <Button
                          aria-label={t(`${KEY_ROOT}.moveLater`, { title })}
                          disabled={mutationLocked || index === beatOrder.length - 1}
                          icon={<ArrowDown />}
                          onClick={() => void reorderBeat(beat.id, index + 1)}
                          size='small'
                        />
                        <Popconfirm
                          cancelText={t(`${BEAT_PANEL_ROOT}.common.cancel`)}
                          content={t(`${KEY_ROOT}.liftConfirmContent`)}
                          disabled={liftGuarded}
                          okText={t(`${KEY_ROOT}.liftBeat`)}
                          onCancel={() => liftRefs.current.get(beat.id)?.focus()}
                          onOk={() => liftBeat(beat.id, liftAllowed)}
                          title={t(`${KEY_ROOT}.liftConfirmTitle`, { title })}
                        >
                          <Button
                            ref={(node) => {
                              if (node === null) liftRefs.current.delete(beat.id);
                              else if (node instanceof HTMLButtonElement) liftRefs.current.set(beat.id, node);
                            }}
                            aria-describedby={blockerKeys.length === 0 ? undefined : liftBlockerDescriptionId}
                            aria-disabled={liftGuarded || undefined}
                            className={styles.liftBeat}
                            onClick={(event) => {
                              if (!liftGuarded) return;
                              event.preventDefault();
                              event.stopPropagation();
                            }}
                            onKeyDown={(event) => {
                              if (!liftGuarded || (event.key !== 'Enter' && event.key !== ' ')) return;
                              event.preventDefault();
                              event.stopPropagation();
                            }}
                            size='small'
                            status='danger'
                            type='secondary'
                          >
                            {t(`${KEY_ROOT}.liftBeat`)}
                          </Button>
                        </Popconfirm>
                      </div>
                      {blockerKeys.length === 0 ? null : (
                        <ul
                          id={liftBlockerDescriptionId}
                          aria-atomic='true'
                          aria-live='polite'
                          className={styles.blocker}
                        >
                          {blockerKeys.map((blockerKey, blockerIndex) => (
                            <li key={`${blockerKey}:${blockerIndex}`}>{t(blockerKey)}</li>
                          ))}
                        </ul>
                      )}
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
                        onReviewReferenceBinding={onReviewReferenceBinding}
                        projectId={managedProjectId}
                        shot={shot}
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
        pending={pending}
        projectId={projectId}
        projection={projection}
      />

      <span aria-atomic='true' aria-live='polite' className={styles.srOnly}>
        {announcement}
      </span>
      <span aria-atomic='true' aria-live='polite' className={styles.srOnly} data-studio-shot-lift-announcement>
        {binFocusAnnouncement}
      </span>
    </section>
  );
};

export { binItemFocusKey } from './Bin';
