/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ArrowDown, ArrowUp, Drag } from '@icon-park/react';
import { Button, Popconfirm } from '@arco-design/web-react';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type {
  StudioBinItem,
  StudioRendererParkBlockerCodeV2,
  StudioRendererParkEligibilityV2,
} from '@/common/types/project/creativeStudioTypes';
import { createManagedStudioAssetUrl } from '@/renderer/pages/studio/studioManagedAssetUrl';

import type { WorkspaceBeatProjection, WorkspaceProjection } from '../../workspaceProjection';
import { Bin, binItemFocusKey } from './Bin';
import styles from './Board.module.css';

const KEY_ROOT = 'conversation.creativeStudio.workspace.board';
const BEAT_PANEL_ROOT = 'conversation.creativeStudio.workspace.beatPanel';

const STATE_KEYS = {
  duration_pending: 'conversation.creativeStudio.workspace.table.state.durationPending',
  no_coverage: 'conversation.creativeStudio.workspace.table.state.noCoverage',
  seed_pending: 'conversation.creativeStudio.workspace.table.state.seedPending',
  part_done: 'conversation.creativeStudio.workspace.table.state.partDone',
  rendering: 'conversation.creativeStudio.workspace.table.state.rendering',
  stale: 'conversation.creativeStudio.workspace.table.state.stale',
  status_pending: 'conversation.creativeStudio.workspace.table.state.statusPending',
  ready: 'conversation.creativeStudio.workspace.table.state.ready',
  draft: 'conversation.creativeStudio.workspace.table.state.draft',
} as const satisfies Record<WorkspaceBeatProjection['displayState'], string>;

const BLOCKER_KEYS = {
  current_match_to: `${BEAT_PANEL_ROOT}.blocker.currentMatchTo`,
  own_nonterminal_job: `${BEAT_PANEL_ROOT}.blocker.ownNonterminalJob`,
  own_pending_frame: `${BEAT_PANEL_ROOT}.blocker.ownPendingFrame`,
  downstream_nonterminal_job: `${BEAT_PANEL_ROOT}.blocker.downstreamNonterminalJob`,
  downstream_pending_frame: `${BEAT_PANEL_ROOT}.blocker.downstreamPendingFrame`,
  waiting_authorization_dependency: `${BEAT_PANEL_ROOT}.blocker.waitingAuthorizationDependency`,
  bound_nonterminal_request: `${BEAT_PANEL_ROOT}.blocker.boundNonterminalRequest`,
  current_selected_take: `${BEAT_PANEL_ROOT}.blocker.currentSelectedTake`,
  current_seed_still: `${BEAT_PANEL_ROOT}.blocker.currentSeedStill`,
  nonterminal_conditioning_use: `${BEAT_PANEL_ROOT}.blocker.nonterminalConditioningUse`,
  take_bin_capacity_reached: `${BEAT_PANEL_ROOT}.blocker.takeBinCapacityReached`,
  beat_shot_capacity_reached: `${BEAT_PANEL_ROOT}.blocker.beatShotCapacityReached`,
} as const satisfies Record<StudioRendererParkBlockerCodeV2, string>;

export type BoardActions = {
  reorderBeats: (beatOrder: readonly string[]) => Promise<boolean>;
  parkBeat: (beatId: string) => Promise<boolean>;
  restoreBeat: (beatId: string, beforeBeatId: string | null) => Promise<boolean>;
  restoreShot: (shotId: string, beforeShotId: string | null) => Promise<boolean>;
  restoreTake: (shotId: string, assetId: string) => Promise<boolean>;
  reorderBin: (bin: readonly StudioBinItem[]) => Promise<boolean>;
};

export type BoardViewProps = {
  projectId: string;
  projection: WorkspaceProjection;
  selectedBeatId: string | null;
  dirtyBeatIds: readonly string[];
  pending: boolean;
  actions: BoardActions;
  binFocusAnnouncement: string;
  binFocusItemKey: string | null;
  onBinFocusItemSettled: () => void;
  onOpenBeat: (beatId: string) => void;
};

type CardSize = 'small' | 'medium' | 'large';

type BoardCoverProps = {
  beat: WorkspaceBeatProjection;
  projectId: string;
};

const exactBeatParkEligibility = (
  projection: WorkspaceProjection,
  projectId: string,
  beatId: string
): StudioRendererParkEligibilityV2 | null => {
  if (projection.projectId !== projectId || !projection.workspaceStatusReady) return null;
  const matches = projection.parkEligibility.filter(
    (row) =>
      row.subject === 'beat' &&
      row.action === 'park' &&
      row.beatId === beatId &&
      row.shotId === null &&
      row.assetId === null
  );
  return matches.length === 1 ? matches[0]! : null;
};

const BoardCover: React.FC<BoardCoverProps> = ({ beat, projectId }) => {
  const { t } = useTranslation();
  const coverAssetId = beat.shots.find((shot) => shot.coverAssetId !== null)?.coverAssetId ?? null;
  const coverUrl = coverAssetId === null ? null : createManagedStudioAssetUrl(projectId, coverAssetId);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const noCoverage = beat.shots.length === 0;
  const showImage = coverUrl !== null && failedUrl !== coverUrl;

  useEffect(() => setFailedUrl(null), [coverUrl]);

  return (
    <div className={styles.cover} data-cover-kind={noCoverage ? 'no-coverage' : showImage ? 'image' : 'unavailable'}>
      {showImage ? (
        <img
          alt=''
          className={styles.coverImage}
          loading='lazy'
          onError={() => setFailedUrl(coverUrl)}
          src={coverUrl}
        />
      ) : (
        <span className={styles.coverPlaceholder}>
          {t(noCoverage ? `${KEY_ROOT}.noCoverage` : `${KEY_ROOT}.coverUnavailable`)}
        </span>
      )}
    </div>
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
  selectedBeatId,
  dirtyBeatIds,
  pending,
  actions,
  binFocusAnnouncement,
  binFocusItemKey,
  onBinFocusItemSettled,
  onOpenBeat,
}) => {
  const { t } = useTranslation();
  const [cardSize, setCardSize] = useState<CardSize>('medium');
  const [announcement, setAnnouncement] = useState('');
  const [busyBeatId, setBusyBeatId] = useState<string | null>(null);
  const [localFocusItemKey, setLocalFocusItemKey] = useState<string | null>(null);
  const [restoreFocusIntent, setRestoreFocusIntent] = useState<{ projectId: string; beatId: string } | null>(null);
  const [failedLiftFocusId, setFailedLiftFocusId] = useState<string | null>(null);
  const titleRefs = useRef(new Map<string, HTMLButtonElement>());
  const liftRefs = useRef(new Map<string, HTMLButtonElement>());
  const reorderPendingRef = useRef(false);
  const draggedBeatIdRef = useRef<string | null>(null);
  const dirtyBeatIdSet = useMemo(() => new Set(dirtyBeatIds), [dirtyBeatIds]);
  const beatOrder = projection.activeBeats.map((beat) => beat.id);
  const canonicalOrderReady = projectId === projection.projectId && new Set(beatOrder).size === beatOrder.length;
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
    if (control === undefined) return;
    control.focus();
    setFailedLiftFocusId(null);
  }, [busyBeatId, failedLiftFocusId, projection.activeBeatIds]);

  const focusBeatTitle = (beatId: string): void => {
    titleRefs.current.get(beatId)?.focus();
  };

  const reorderBeat = async (beatId: string, destination: number): Promise<void> => {
    if (pending || reorderPendingRef.current || !canonicalOrderReady) return;
    const source = beatOrder.indexOf(beatId);
    const nextOrder = moveOrder(beatOrder, source, destination);
    if (nextOrder === null) return;

    reorderPendingRef.current = true;
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
      reorderPendingRef.current = false;
      setBusyBeatId(null);
      focusBeatTitle(beatId);
    }
  };

  const liftBeat = async (beatId: string): Promise<void> => {
    if (pending || busyBeatId !== null) return;
    setBusyBeatId(beatId);
    let lifted = false;
    try {
      lifted = await actions.parkBeat(beatId);
      setAnnouncement(t(lifted ? `${KEY_ROOT}.liftSucceeded` : `${KEY_ROOT}.liftFailed`));
      if (lifted) setLocalFocusItemKey(binItemFocusKey({ kind: 'beat', beatId, reason: 'lifted' }));
    } catch {
      setAnnouncement(t(`${KEY_ROOT}.liftFailed`));
    } finally {
      setBusyBeatId(null);
      if (!lifted) setFailedLiftFocusId(beatId);
    }
  };

  const requestedBinFocusItemKey = binFocusItemKey ?? localFocusItemKey;

  return (
    <section className={styles.root} data-card-size={cardSize}>
      <header className={styles.header}>
        <h2 className={styles.heading}>{t(`${KEY_ROOT}.ariaLabel`)}</h2>
        <div aria-label={t(`${KEY_ROOT}.cardSizeLabel`)} className={styles.cardSizeControls} role='group'>
          {(['small', 'medium', 'large'] as const).map((size) => (
            <Button
              key={size}
              aria-pressed={cardSize === size}
              disabled={pending}
              onClick={() => setCardSize(size)}
              size='small'
              type={cardSize === size ? 'primary' : 'secondary'}
            >
              {t(`${KEY_ROOT}.cardSize${size[0]!.toUpperCase()}${size.slice(1)}`)}
            </Button>
          ))}
        </div>
      </header>

      <ol aria-label={t(`${KEY_ROOT}.ariaLabel`)} className={styles.beatList} data-card-size={cardSize}>
        {projection.activeBeats.map((beat, index) => {
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
          const title = beat.title.trim() || beat.id;
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
              <div className={styles.coverWrap}>
                <BoardCover beat={beat} projectId={managedProjectId} />
                <span className={styles.ordinal}>
                  <bdi>{t(`${KEY_ROOT}.ordinal`, { index: String(index + 1).padStart(2, '0') })}</bdi>
                </span>
              </div>

              <div className={styles.cardBody}>
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
                <p className={styles.action} dir='auto'>
                  {beat.action}
                </p>

                <div className={styles.facts}>
                  <span>
                    <bdi>{t(`${KEY_ROOT}.shotCount`, { count: beat.shots.length })}</bdi>
                  </span>
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

                <p className={styles.state} data-state={beat.displayState}>
                  <span aria-hidden='true' className={styles.stateDot} />
                  <span>{t(STATE_KEYS[beat.displayState])}</span>
                </p>

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
                    disabled={mutationLocked || !liftAllowed}
                    okText={t(`${KEY_ROOT}.liftBeat`)}
                    onCancel={() => liftRefs.current.get(beat.id)?.focus()}
                    onOk={() => liftBeat(beat.id)}
                    title={t(`${KEY_ROOT}.liftConfirmTitle`, { title })}
                  >
                    <Button
                      ref={(node) => {
                        if (node === null) liftRefs.current.delete(beat.id);
                        else if (node instanceof HTMLButtonElement) liftRefs.current.set(beat.id, node);
                      }}
                      disabled={mutationLocked || !liftAllowed}
                      size='small'
                      status='danger'
                    >
                      {t(`${KEY_ROOT}.liftBeat`)}
                    </Button>
                  </Popconfirm>
                </div>
                {blockerKeys.length === 0 ? null : (
                  <ul aria-atomic='true' aria-live='polite' className={styles.blocker}>
                    {blockerKeys.map((blockerKey, blockerIndex) => (
                      <li key={`${blockerKey}:${blockerIndex}`}>{t(blockerKey)}</li>
                    ))}
                  </ul>
                )}
              </div>
            </li>
          );
        })}
      </ol>

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
