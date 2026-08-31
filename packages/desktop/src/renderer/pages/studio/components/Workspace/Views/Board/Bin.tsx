/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Select } from '@arco-design/web-react';
import { Drag, Inbox } from '@icon-park/react';
import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type {
  StudioBinItem,
  StudioRendererParkBlockerCodeV2,
  StudioRendererParkEligibilityV2,
} from '@/common/types/project/creativeStudioTypes';
import { createManagedStudioAssetUrl } from '@/renderer/pages/studio/studioManagedAssetUrl';

import type {
  WorkspaceBeatProjection,
  WorkspaceBinItemProjection,
  WorkspaceProjection,
  WorkspaceShotProjection,
} from '../../workspaceProjection';
import styles from './Board.module.css';

const KEY_ROOT = 'conversation.creativeStudio.workspace.bin';
const BEAT_PANEL_KEY_ROOT = 'conversation.creativeStudio.workspace.beatPanel';
const END_ANCHOR = ':bin-end:';

const BLOCKER_KEYS = {
  own_nonterminal_job: `${BEAT_PANEL_KEY_ROOT}.blocker.ownNonterminalJob`,
  own_pending_frame: `${BEAT_PANEL_KEY_ROOT}.blocker.ownPendingFrame`,
  downstream_nonterminal_job: `${BEAT_PANEL_KEY_ROOT}.blocker.downstreamNonterminalJob`,
  downstream_pending_frame: `${BEAT_PANEL_KEY_ROOT}.blocker.downstreamPendingFrame`,
  waiting_authorization_dependency: `${BEAT_PANEL_KEY_ROOT}.blocker.waitingAuthorizationDependency`,
  bound_nonterminal_request: `${BEAT_PANEL_KEY_ROOT}.blocker.boundNonterminalRequest`,
  beat_shot_capacity_reached: `${BEAT_PANEL_KEY_ROOT}.blocker.beatShotCapacityReached`,
} as const satisfies Record<StudioRendererParkBlockerCodeV2, string>;

export type BinActions = {
  restoreBeat: (beatId: string, beforeBeatId: string | null) => Promise<boolean>;
  restoreShot: (shotId: string, beforeShotId: string | null) => Promise<boolean>;
  reorderBin: (bin: readonly StudioBinItem[]) => Promise<boolean>;
};

export type BinRestoreResult = { kind: 'beat'; beatId: string } | { kind: 'shot'; beatId: string; shotId: string };

export type BinProps = {
  projectId: string;
  projection: WorkspaceProjection;
  pending: boolean;
  actions: BinActions;
  focusItemKey: string | null;
  onFocusItemSettled: () => void;
  onRestoreSuccess: (result: BinRestoreResult) => void;
};

export const binItemFocusKey = (item: StudioBinItem): string => {
  if (item.kind === 'beat') return `beat:${item.beatId}`;
  return `shot:${item.shotId}`;
};

const cloneBinIdentity = (item: StudioBinItem): StudioBinItem => {
  if (item.kind === 'beat') return { kind: 'beat', beatId: item.beatId, reason: item.reason };
  return { kind: 'shot', beatId: item.beatId, shotId: item.shotId, reason: item.reason };
};

const exactEligibility = (
  projection: WorkspaceProjection,
  identity: Pick<StudioRendererParkEligibilityV2, 'subject' | 'action' | 'beatId' | 'shotId'>
): StudioRendererParkEligibilityV2 | null => {
  if (!projection.workspaceStatusReady) return null;
  const matches = projection.parkEligibility.filter(
    (row) =>
      row.subject === identity.subject &&
      row.action === identity.action &&
      row.beatId === identity.beatId &&
      row.shotId === identity.shotId
  );
  return matches.length === 1 ? matches[0]! : null;
};

type OwnerBeat = Pick<WorkspaceBeatProjection, 'id' | 'title' | 'shots'>;

type ResolvedOwner = {
  beat: OwnerBeat;
  shot: WorkspaceShotProjection | null;
  shotIndex: number | null;
};

const beatEntries = (projection: WorkspaceProjection): OwnerBeat[] => [
  ...projection.activeBeats,
  ...projection.bin.items.flatMap((entry) => (entry.kind === 'beat' ? [entry.value] : [])),
];

const exactOwnerBeat = (projection: WorkspaceProjection, beatId: string): OwnerBeat | null => {
  const matches = beatEntries(projection).filter((beat) => beat.id === beatId);
  return matches.length === 1 ? matches[0]! : null;
};

const exactOwner = (projection: WorkspaceProjection, beatId: string, shotId: string | null): ResolvedOwner | null => {
  const beat = exactOwnerBeat(projection, beatId);
  if (beat === null) return null;
  if (shotId === null) return { beat, shot: null, shotIndex: null };

  const currentMatches: ResolvedOwner[] = beat.shots.flatMap((shot, shotIndex) =>
    shot.id === shotId ? [{ beat, shot, shotIndex }] : []
  );
  const binnedMatches: ResolvedOwner[] = projection.bin.items.flatMap((entry) =>
    entry.kind === 'shot' &&
    entry.identity.beatId === beatId &&
    entry.identity.shotId === shotId &&
    entry.value.beatId === beatId &&
    entry.value.id === shotId
      ? [{ beat, shot: entry.value, shotIndex: null as number | null }]
      : []
  );
  const matches = [...currentMatches, ...binnedMatches];
  return matches.length === 1 ? matches[0]! : null;
};

const uniqueIds = (ids: readonly string[]): string[] => {
  const counts = new Map<string, number>();
  ids.forEach((id) => counts.set(id, (counts.get(id) ?? 0) + 1));
  return ids.filter((id) => counts.get(id) === 1);
};

const moveItem = <Value,>(values: readonly Value[], from: number, to: number): Value[] => {
  const result = [...values];
  const [value] = result.splice(from, 1);
  if (value !== undefined) result.splice(to, 0, value);
  return result;
};

const labelSelectHandle = (handle: unknown, label: string): void => {
  if (typeof handle !== 'object' || handle === null) return;
  const dom = (handle as { dom?: unknown }).dom;
  if (dom instanceof HTMLElement) dom.setAttribute('aria-label', label);
};

const exactEntryIdentity = (entry: WorkspaceBinItemProjection, index: number): boolean => {
  if (entry.position !== index + 1 || entry.kind !== entry.identity.kind) return false;
  if (entry.kind === 'beat') {
    return entry.value.id === entry.identity.beatId && entry.value.reason === entry.identity.reason;
  }
  return (
    entry.value.id === entry.identity.shotId &&
    entry.value.beatId === entry.identity.beatId &&
    entry.value.reason === entry.identity.reason
  );
};

const exactGlobalItems = (items: readonly WorkspaceBinItemProjection[]): boolean => {
  const keys = new Set<string>();
  for (let index = 0; index < items.length; index += 1) {
    const entry = items[index]!;
    const key = binItemFocusKey(entry.identity);
    if (!exactEntryIdentity(entry, index) || keys.has(key)) return false;
    keys.add(key);
  }
  return true;
};

type CoverProps = {
  assetId: string | null;
  projectId: string;
  title: string;
};

const Cover: React.FC<CoverProps & { kind: string }> = ({ assetId, kind, projectId, title }) => {
  const { t } = useTranslation();
  const url = assetId === null ? null : createManagedStudioAssetUrl(projectId, assetId);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const showImage = url !== null && failedUrl !== url;

  useEffect(() => setFailedUrl(null), [url]);

  return (
    <div className={styles.binCover}>
      {!showImage ? (
        <span className={styles.binPlaceholder}>{t(`${KEY_ROOT}.coverUnavailable`)}</span>
      ) : (
        <img
          className={styles.binCoverImage}
          src={url}
          alt={t(`${KEY_ROOT}.coverAlt`, { kind, title })}
          onError={() => setFailedUrl(url)}
        />
      )}
    </div>
  );
};

export const Bin: React.FC<BinProps> = ({
  projectId,
  projection,
  pending,
  actions,
  focusItemKey,
  onFocusItemSettled,
  onRestoreSuccess,
}) => {
  const { t } = useTranslation();
  const titleId = useId();
  const rootRef = useRef<HTMLElement | null>(null);
  const handledFocusRequest = useRef<string | null>(null);
  const draggedItemKey = useRef<string | null>(null);
  const operationPending = useRef(false);
  const projectIdentity = `${projectId}\u0000${projection.projectId}`;
  const currentProjectIdentity = useRef(projectIdentity);
  currentProjectIdentity.current = projectIdentity;
  const [anchors, setAnchors] = useState<Record<string, string | null>>({});
  const [busyItemKey, setBusyItemKey] = useState<string | null>(null);
  const [focusAfterReorder, setFocusAfterReorder] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');

  const items = projection.bin.items;
  const itemKeys = useMemo(() => items.map((entry) => binItemFocusKey(entry.identity)), [items]);
  const projectMatches = projectId === projection.projectId;
  const validGlobalItems = projectMatches && exactGlobalItems(items);

  const focusHandle = useCallback((key: string): boolean => {
    const handles = rootRef.current?.querySelectorAll<HTMLButtonElement>('[data-bin-focus-key]');
    if (handles === undefined) return false;
    const handle = Array.from(handles).find((candidate: HTMLButtonElement) => candidate.dataset.binFocusKey === key);
    if (handle === undefined) return false;
    handle.focus();
    return true;
  }, []);

  useEffect(() => {
    if (focusItemKey === null) {
      handledFocusRequest.current = null;
      return;
    }
    const requestIdentity = `${projectIdentity}\u0000${focusItemKey}`;
    if (handledFocusRequest.current === requestIdentity || !focusHandle(focusItemKey)) return;
    handledFocusRequest.current = requestIdentity;
    onFocusItemSettled();
  }, [focusHandle, focusItemKey, itemKeys, onFocusItemSettled, projectIdentity]);

  useEffect(() => {
    if (focusAfterReorder === null || !focusHandle(focusAfterReorder)) return;
    setFocusAfterReorder(null);
  }, [focusAfterReorder, focusHandle, itemKeys]);

  useEffect(() => {
    setAnchors({});
    setAnnouncement('');
    setFocusAfterReorder(null);
    draggedItemKey.current = null;
  }, [projectId, projection.projectId]);

  useEffect(() => {
    const currentKeys = new Set(itemKeys);
    setAnchors((current) => {
      const retainedEntries = Object.entries(current).filter(([key]) => currentKeys.has(key));
      return retainedEntries.length === Object.keys(current).length ? current : Object.fromEntries(retainedEntries);
    });
  }, [itemKeys]);

  const selectedAnchor = (key: string): string | null => anchors[key] ?? null;

  const restoreBlockers = (
    entry: WorkspaceBinItemProjection,
    owner: ResolvedOwner | null,
    eligibility: StudioRendererParkEligibilityV2 | null,
    anchorValid: boolean,
    anchorSetValid: boolean
  ): string[] => {
    if (!validGlobalItems) return [`${KEY_ROOT}.blocker.statusUnavailable`];
    if (owner === null) return [`${KEY_ROOT}.blocker.ownerUnavailable`];
    if (!anchorValid || !anchorSetValid) return [`${KEY_ROOT}.blocker.anchorUnavailable`];
    if (!projection.workspaceStatusReady || eligibility === null) {
      return [`${KEY_ROOT}.blocker.statusUnavailable`];
    }
    if (eligibility.blockers.length > 0) {
      return eligibility.blockers.map((blocker) => BLOCKER_KEYS[blocker.code]);
    }
    return eligibility.allowed ? [] : [`${KEY_ROOT}.blocker.statusUnavailable`];
  };

  const reorder = async (key: string, targetIndex: number): Promise<void> => {
    if (pending || operationPending.current || !validGlobalItems) return;
    const sourceIndex = items.findIndex((entry) => binItemFocusKey(entry.identity) === key);
    if (sourceIndex < 0 || targetIndex < 0 || targetIndex >= items.length || targetIndex === sourceIndex) return;

    const reordered = moveItem(items, sourceIndex, targetIndex);
    const payload = reordered.map((entry) => cloneBinIdentity(entry.identity));
    const operationProjectIdentity = currentProjectIdentity.current;
    operationPending.current = true;
    setBusyItemKey(key);
    try {
      if (!(await actions.reorderBin(payload)) || currentProjectIdentity.current !== operationProjectIdentity) return;
      const moved = items[sourceIndex]!;
      setAnnouncement(
        t(`${KEY_ROOT}.reorderAnnouncement`, {
          kind: t(`${KEY_ROOT}.kind.${moved.kind}`),
          reason: t(`${KEY_ROOT}.reason.${moved.identity.reason}`),
          from: sourceIndex + 1,
          to: targetIndex + 1,
          total: items.length,
        })
      );
      setFocusAfterReorder(key);
    } catch {
      // The action owner presents commit errors. A rejected provider is never treated as success.
    } finally {
      operationPending.current = false;
      setBusyItemKey(null);
    }
  };

  const restore = async (
    entry: WorkspaceBinItemProjection,
    owner: ResolvedOwner,
    anchor: string | null
  ): Promise<void> => {
    const key = binItemFocusKey(entry.identity);
    if (pending || operationPending.current) return;
    const operationProjectIdentity = currentProjectIdentity.current;
    operationPending.current = true;
    setBusyItemKey(key);
    try {
      let restored = false;
      let result: BinRestoreResult;
      if (entry.kind === 'beat') {
        restored = await actions.restoreBeat(entry.identity.beatId, anchor);
        result = { kind: 'beat', beatId: entry.identity.beatId };
      } else {
        restored = await actions.restoreShot(entry.identity.shotId, anchor);
        result = { kind: 'shot', beatId: owner.beat.id, shotId: entry.identity.shotId };
      }
      if (restored && currentProjectIdentity.current === operationProjectIdentity) {
        setAnchors((current) => {
          if (!Object.hasOwn(current, key)) return current;
          const next = { ...current };
          delete next[key];
          return next;
        });
        onRestoreSuccess(result);
      }
    } catch {
      // The action owner presents commit errors. A rejected provider is never treated as success.
    } finally {
      operationPending.current = false;
      setBusyItemKey(null);
    }
  };

  return (
    <section ref={rootRef} className={styles.bin} aria-labelledby={titleId} data-studio-bin>
      <header className={styles.binHeader}>
        <Inbox aria-hidden='true' />
        <div>
          <h2 id={titleId} className={styles.binTitle}>
            {t(`${KEY_ROOT}.title`)}
          </h2>
          <p>{t(`${KEY_ROOT}.description`)}</p>
        </div>
      </header>

      {items.length === 0 ? (
        <p className={styles.binEmpty} role='status'>
          {t(`${KEY_ROOT}.empty`)}
        </p>
      ) : (
        <ol className={styles.binList} aria-label={t(`${KEY_ROOT}.listLabel`)}>
          {items.map((entry, index) => {
            const key = binItemFocusKey(entry.identity);
            const beatId = entry.identity.beatId;
            const shotId = entry.kind === 'shot' ? entry.identity.shotId : null;
            const candidateOwner = typeof beatId === 'string' ? exactOwner(projection, beatId, shotId) : null;
            const owner =
              candidateOwner !== null && (entry.kind === 'beat' || entry.value.beatTitle === candidateOwner.beat.title)
                ? candidateOwner
                : null;
            const title = entry.kind === 'beat' ? entry.value.title : entry.value.shootingScript;
            const coverAssetId = entry.value.coverAssetId;
            const reason = entry.identity.reason;
            const kindLabel = t(`${KEY_ROOT}.kind.${entry.kind}`);
            const reasonLabel = t(`${KEY_ROOT}.reason.${reason}`);
            const ownerLabel = owner === null ? t(`${KEY_ROOT}.ownerUnavailable`) : owner.beat.title;
            const positionLabel = t(`${KEY_ROOT}.position`, { position: index + 1, total: items.length });
            const restorePositionLabel = [t(`${KEY_ROOT}.restore.positionLabel`), kindLabel, title, positionLabel].join(
              ' '
            );
            const anchor = selectedAnchor(key);
            const beatAnchorIds = uniqueIds(projection.activeBeats.map((beat) => beat.id));
            const shotAnchorIds = owner === null ? [] : uniqueIds(owner.beat.shots.map((shot) => shot.id));
            const anchorIds = entry.kind === 'beat' ? beatAnchorIds : shotAnchorIds;
            const anchorValid = anchor === null || anchorIds.includes(anchor);
            const anchorSetValid =
              entry.kind === 'beat'
                ? beatAnchorIds.length === projection.activeBeats.length
                : owner !== null && shotAnchorIds.length === owner.beat.shots.length;
            const eligibility =
              owner === null
                ? null
                : exactEligibility(projection, {
                    subject: entry.kind,
                    action: 'restore',
                    beatId: owner.beat.id,
                    shotId: entry.kind === 'beat' ? null : (owner.shot?.id ?? null),
                  });
            const blockers = restoreBlockers(entry, owner, eligibility, anchorValid, anchorSetValid);
            const disabled = pending || busyItemKey !== null || blockers.length > 0;
            const retainedWork = entry.value.retainedWork;
            const stale =
              entry.kind === 'shot' ? entry.value.dirtyCauses.length > 0 : entry.value.displayState === 'stale';

            return (
              <li
                key={key}
                className={styles.binItem}
                aria-posinset={index + 1}
                aria-setsize={items.length}
                aria-label={[
                  t(`${KEY_ROOT}.itemLabel`, {
                    kind: kindLabel,
                    reason: reasonLabel,
                    owner: ownerLabel,
                    position: index + 1,
                    total: items.length,
                  }),
                  entry.kind === 'beat' ? null : `${t(`${KEY_ROOT}.ownerLabel`, { owner: ownerLabel })} ${ownerLabel}`,
                ]
                  .filter((part): part is string => part !== null)
                  .join(' ')}
                data-bin-kind={entry.kind}
                data-bin-reason={reason}
                data-bin-item-key={key}
                data-retained-work={retainedWork}
                data-stale={stale}
                onDragOver={(event) => {
                  if (draggedItemKey.current !== null) event.preventDefault();
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  const draggedKey = draggedItemKey.current;
                  draggedItemKey.current = null;
                  if (draggedKey !== null) void reorder(draggedKey, index);
                }}
              >
                <article className={styles.binCard}>
                  <div className={styles.binCardHeader}>
                    <span className={styles.binKind}>{kindLabel}</span>
                    <span className={styles.binReason}>{reasonLabel}</span>
                    <span className={styles.binPosition}>{positionLabel}</span>
                  </div>

                  <Cover
                    assetId={projectMatches ? coverAssetId : null}
                    kind={kindLabel}
                    projectId={projectId}
                    title={title}
                  />

                  <div className={styles.binBody}>
                    <h3 className={styles.binItemTitle}>{title}</h3>
                    {entry.kind !== 'beat' && (
                      <p className={styles.binMeta}>
                        <span>{t(`${KEY_ROOT}.ownerLabel`, { owner: ownerLabel })}</span> <b>{ownerLabel}</b>
                      </p>
                    )}
                    {entry.kind === 'beat' && (
                      <p className={styles.binMeta}>{t(`${KEY_ROOT}.shotCount`, { count: entry.value.shotCount })}</p>
                    )}
                    {retainedWork && (
                      <p className={styles.binStatus}>
                        {t(`${KEY_ROOT}.retainedWork`, {
                          count: entry.kind === 'shot' ? 1 : entry.value.shotCount,
                          retained: retainedWork,
                        })}
                      </p>
                    )}
                    {stale && <p className={styles.binStatus}>{t(`${KEY_ROOT}.stale`)}</p>}

                    {blockers.length > 0 && (
                      <ul aria-atomic='true' aria-live='polite' className={styles.binBlockers}>
                        {blockers.map((blocker, blockerIndex) => (
                          <li key={`${blocker}:${blockerIndex}`}>{t(blocker)}</li>
                        ))}
                      </ul>
                    )}

                    <div className={styles.binActions}>
                      <Button
                        className={styles.binDragHandle}
                        type='secondary'
                        size='small'
                        icon={<Drag aria-hidden='true' />}
                        aria-label={t(`${KEY_ROOT}.dragHandle`, { kind: kindLabel, position: index + 1, title })}
                        data-bin-focus-key={key}
                        draggable={!pending && busyItemKey === null && validGlobalItems}
                        disabled={pending || busyItemKey !== null || !validGlobalItems}
                        onDragStart={(event: React.DragEvent<HTMLButtonElement>) => {
                          draggedItemKey.current = key;
                          event.dataTransfer.effectAllowed = 'move';
                          event.dataTransfer.setData('text/plain', key);
                        }}
                        onDragEnd={() => {
                          draggedItemKey.current = null;
                        }}
                        onKeyDown={(event: React.KeyboardEvent<HTMLButtonElement>) => {
                          let targetIndex: number | null = null;
                          if (event.key === 'ArrowUp') targetIndex = index - 1;
                          if (event.key === 'ArrowDown') targetIndex = index + 1;
                          if (event.key === 'Home') targetIndex = 0;
                          if (event.key === 'End') targetIndex = items.length - 1;
                          if (targetIndex === null) return;
                          event.preventDefault();
                          void reorder(key, targetIndex);
                        }}
                      />

                      <Select
                        ref={(handle) => labelSelectHandle(handle, restorePositionLabel)}
                        className={styles.binAnchor}
                        size='small'
                        value={anchor ?? END_ANCHOR}
                        disabled={pending || busyItemKey !== null || owner === null}
                        onChange={(nextValue) => {
                          const value = String(nextValue);
                          setAnchors((current) => ({ ...current, [key]: value === END_ANCHOR ? null : value }));
                        }}
                      >
                        <Select.Option value={END_ANCHOR}>{t(`${KEY_ROOT}.restore.atEnd`)}</Select.Option>
                        {anchorIds.map((anchorId) => {
                          const label =
                            entry.kind === 'beat'
                              ? (projection.activeBeats.find((beat) => beat.id === anchorId)?.title ?? anchorId)
                              : (owner?.beat.shots.find((shot) => shot.id === anchorId)?.shootingScript ?? anchorId);
                          return (
                            <Select.Option key={anchorId} value={anchorId}>
                              {t(`${KEY_ROOT}.restore.${entry.kind === 'beat' ? 'beforeBeat' : 'beforeShot'}`, {
                                title: label,
                                position:
                                  entry.kind === 'beat'
                                    ? projection.activeBeats.findIndex((beat) => beat.id === anchorId) + 1
                                    : (owner?.beat.shots.findIndex((shot) => shot.id === anchorId) ?? -1) + 1,
                              })}
                            </Select.Option>
                          );
                        })}
                      </Select>

                      <Button
                        type='primary'
                        size='small'
                        loading={busyItemKey === key}
                        disabled={disabled}
                        onClick={() => {
                          if (owner === null || blockers.length > 0) return;
                          void restore(entry, owner, anchor);
                        }}
                      >
                        {t(`${KEY_ROOT}.restore.${entry.kind}`)}
                      </Button>
                    </div>
                  </div>
                </article>
              </li>
            );
          })}
        </ol>
      )}

      <p className={styles.srOnly} aria-live='polite' aria-atomic='true'>
        {announcement}
      </p>
    </section>
  );
};
