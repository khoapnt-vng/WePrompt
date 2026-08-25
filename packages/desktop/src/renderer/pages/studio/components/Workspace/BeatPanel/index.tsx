/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Alert, Button, Dropdown, Input, InputNumber, Menu, Modal, Popconfirm } from '@arco-design/web-react';
import { MoreOne } from '@icon-park/react';
import React, { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  type StudioEditableBeatChanges,
  type StudioEditableShotChanges,
  type StudioGenerationBlockV2,
  type StudioRendererParkBlockerCodeV2,
  type StudioRendererParkEligibilityV2,
} from '@/common/types/project/creativeStudioTypes';
import { createManagedStudioAssetUrl } from '@/renderer/pages/studio/studioManagedAssetUrl';
import { FullscreenMediaFrame } from '@/renderer/pages/studio/components/FullscreenMediaFrame';

import type { UseWorkspaceDraftsResult } from '../useWorkspaceDrafts';
import type { WorkspaceBeatProjection, WorkspaceProjection, WorkspaceShotProjection } from '../workspaceProjection';
import { generationBlockAction, generationBlockMessage } from '../Gate/generationBlockers';
import styles from './BeatPanel.module.css';
import { BeatPlayer } from './BeatPlayer';
import { CoverageBar } from './CoverageBar';
import type { CoveragePlanningPairChange } from './coverageGeometry';

const KEY_ROOT = 'conversation.creativeStudio.workspace.beatPanel';
const JOB_KEY_ROOT = 'conversation.creativeStudio.jobs';

export type BeatPanelImportResult = 'cancelled' | 'imported' | 'failed';

type ModalConfirmationHandle = ReturnType<typeof Modal.confirm>;

export type BeatPanelReviewPreference = {
  purpose: 'seed_still' | 'video_take';
};

export type BeatPanelReviewChoiceIdentity = Pick<BeatPanelReviewPreference, 'purpose'> & {
  shotId: string;
};

export type BeatPanelReviewChoice = BeatPanelReviewChoiceIdentity;

export type BeatPanelReviewGraph = {
  triggerShotId: string;
  choices: readonly [BeatPanelReviewChoiceIdentity, ...BeatPanelReviewChoiceIdentity[]];
  block: {
    item: BeatPanelReviewChoiceIdentity;
    reason: StudioGenerationBlockV2;
  } | null;
};

export type BeatPanelShotSave = {
  shotId: string;
  changes: StudioEditableShotChanges;
};

export type BeatPanelActions = {
  saveBeat: (beatId: string, changes: StudioEditableBeatChanges) => Promise<boolean>;
  saveShot: (updates: readonly [BeatPanelShotSave, ...BeatPanelShotSave[]]) => Promise<boolean>;
  setSeedStill: (shotId: string, assetId: string | null) => Promise<boolean>;
  trimShot: (shotId: string, trimInSeconds: number | null, trimOutSeconds: number | null) => Promise<boolean>;
  reorderShots: (beatId: string, shotOrder: readonly string[]) => Promise<boolean>;
  importSeedStill: (shotId: string) => Promise<BeatPanelImportResult>;
  parkShot: (shotId: string, onCommitted?: () => void) => Promise<boolean>;
  parkBeat: (beatId: string) => Promise<boolean>;
  reviewShot: (triggerShotId: string, choices: readonly [BeatPanelReviewChoice, ...BeatPanelReviewChoice[]]) => void;
  reviewContinuity: (shotId: string, hardCut: boolean) => void;
  resolveGenerationBlock: (shotId: string, block: StudioGenerationBlockV2) => void;
  retryGenerationJob: (jobId: string, acknowledgePossibleDuplicateCharge: boolean) => Promise<boolean>;
  cancelGenerationJob: (jobId: string) => Promise<boolean>;
  retryConditioning: (dependentShotId: string) => Promise<boolean>;
  cancelWaiting: (dependentShotId: string) => Promise<boolean>;
  cancelAndReviewRejoin: (dependentShotId: string) => Promise<boolean>;
  requestResplit: (beatId: string) => void;
};

export type BeatPanelProps = {
  projectId: string;
  beat: WorkspaceBeatProjection;
  beatIds: readonly string[];
  beatIndex: number;
  projection: WorkspaceProjection;
  drafts: UseWorkspaceDraftsResult;
  reviewGraphs: readonly BeatPanelReviewGraph[];
  errorMessageKey: string | null;
  pending: boolean;
  gateLocked: boolean;
  reviewBlockedMessageKey: string | null;
  onParkShotSuccess: (shotId: string) => void;
  onSelectBeat: (beatId: string) => void;
  onClose: () => void;
  actions: BeatPanelActions;
};

const beatDraftKey = (beatId: string, field: 'story' | 'targetSeconds'): string => `beat.${beatId}.${field}`;

const shotDraftKey = (shotId: string, field: 'shootingScript' | 'durationSeconds'): string => `shot.${shotId}.${field}`;

const draftString = (drafts: UseWorkspaceDraftsResult, key: string, fallback: string): string => {
  const value = drafts.value(key);
  return typeof value === 'string' ? value : fallback;
};

const draftNullableNumber = (drafts: UseWorkspaceDraftsResult, key: string, fallback: number | null): number | null => {
  const value = drafts.value(key);
  if (value === null) return null;
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : fallback;
};

const draftNumber = (drafts: UseWorkspaceDraftsResult, key: string, fallback: number): number => {
  const value = drafts.value(key);
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : fallback;
};

const hasDraft = (drafts: UseWorkspaceDraftsResult, key: string): boolean => Object.hasOwn(drafts.entries, key);

const SAFE_STUDIO_ID = /^[A-Za-z0-9_-]{1,256}$/;

const reviewPreferenceKey = (shotId: string, purpose: BeatPanelReviewPreference['purpose']): string =>
  `${shotId}:${purpose}`;

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

type ShotPosition = {
  beatIndex: number;
  shotIndex: number;
};

const exactShotPosition = (projection: WorkspaceProjection, shotId: string): ShotPosition | null => {
  const matches = projection.activeBeats.flatMap((beat, beatIndex) =>
    beat.shots.flatMap((shot, shotIndex) => (shot.id === shotId ? [{ beatIndex, shotIndex }] : []))
  );
  return matches.length === 1 ? matches[0]! : null;
};

const exactShotProjection = (projection: WorkspaceProjection, shotId: string): WorkspaceShotProjection | null => {
  const matches = projection.activeBeats.flatMap((beat) => beat.shots.filter((shot) => shot.id === shotId));
  return matches.length === 1 ? matches[0]! : null;
};

const exactReviewGraph = (
  projection: WorkspaceProjection,
  graphs: readonly BeatPanelReviewGraph[],
  triggerShotId: string,
  expectedPurpose: BeatPanelReviewPreference['purpose']
): BeatPanelReviewGraph | null => {
  const matches = graphs.filter((graph) => graph.triggerShotId === triggerShotId);
  if (matches.length !== 1) return null;
  const choices = matches[0]!.choices;
  if (choices.length === 0 || choices[0]!.shotId !== triggerShotId || choices[0]!.purpose !== expectedPurpose) {
    return null;
  }
  const identities = new Set<string>();
  for (const choice of choices) {
    if (
      !SAFE_STUDIO_ID.test(choice.shotId) ||
      (choice.purpose !== 'seed_still' && choice.purpose !== 'video_take') ||
      exactShotPosition(projection, choice.shotId) === null
    ) {
      return null;
    }
    const identity = reviewPreferenceKey(choice.shotId, choice.purpose);
    if (identities.has(identity)) return null;
    identities.add(identity);
  }
  const block = matches[0]!.block ?? null;
  if (
    block !== null &&
    !choices.some((choice) => choice.shotId === block.item.shotId && choice.purpose === block.item.purpose)
  ) {
    return null;
  }
  return { triggerShotId, choices, block };
};

const BLOCKER_KEYS = {
  own_nonterminal_job: `${KEY_ROOT}.blocker.ownNonterminalJob`,
  own_pending_frame: `${KEY_ROOT}.blocker.ownPendingFrame`,
  downstream_nonterminal_job: `${KEY_ROOT}.blocker.downstreamNonterminalJob`,
  downstream_pending_frame: `${KEY_ROOT}.blocker.downstreamPendingFrame`,
  waiting_authorization_dependency: `${KEY_ROOT}.blocker.waitingAuthorizationDependency`,
  bound_nonterminal_request: `${KEY_ROOT}.blocker.boundNonterminalRequest`,
  beat_shot_capacity_reached: `${KEY_ROOT}.blocker.beatShotCapacityReached`,
} as const satisfies Record<StudioRendererParkBlockerCodeV2, string>;

const useLatestDrafts = (drafts: UseWorkspaceDraftsResult): React.MutableRefObject<UseWorkspaceDraftsResult> => {
  const ref = useRef(drafts);
  ref.current = drafts;
  return ref;
};

type SeedStillCardProps = {
  actions: BeatPanelActions;
  canManageSeed: boolean;
  disabled: boolean;
  projectId: string;
  shot: WorkspaceShotProjection;
  shotIndex: number;
  still: WorkspaceShotProjection['seedStills'][number];
  stillIndex: number;
};

const SeedStillCard: React.FC<SeedStillCardProps> = ({
  actions,
  canManageSeed,
  disabled,
  projectId,
  shot,
  shotIndex,
  still,
  stillIndex,
}) => {
  const { t } = useTranslation();
  const assetUrl = createManagedStudioAssetUrl(projectId, still.assetId);
  const pinBlockedByAuthorization =
    shot.seedAuthorizationLock !== null && !shot.seedAuthorizationLock.compatibleAssetIds.includes(still.assetId);
  const canClearSeed = shot.seedAuthorityStatusReady && shot.seedAuthorizationLock === null && still.explicitSeed;
  const canPinSeed = shot.seedAuthorityStatusReady && !still.explicitSeed && !pinBlockedByAuthorization;
  const stillLabel = t(`${KEY_ROOT}.seeds.stillLabel`, {
    shotIndex: shotIndex + 1,
    stillIndex: stillIndex + 1,
  });
  if (assetUrl === null) {
    return (
      <article className={styles.mediaCard} data-asset-id={still.assetId}>
        <p className={styles.warning} role='alert'>
          {t(`${KEY_ROOT}.picture.unavailable`)}
        </p>
      </article>
    );
  }
  return (
    <article
      aria-label={stillLabel}
      className={styles.mediaCard}
      data-asset-id={still.assetId}
      data-effective-seed={still.effectiveSeed}
      data-explicit-seed={still.explicitSeed}
      data-seed-still
    >
      <FullscreenMediaFrame className={styles.mediaPreviewFrame}>
        <img
          alt={t(`${KEY_ROOT}.seeds.previewAlt`, { label: stillLabel })}
          className={styles.mediaPreview}
          src={assetUrl}
        />
      </FullscreenMediaFrame>
      <div className={styles.mediaDetails}>
        <span className={styles.mediaIdentity} dir='auto'>
          {stillLabel}
        </span>
        <div className={styles.badges}>
          {still.effectiveSeed ? <span>{t(`${KEY_ROOT}.seeds.effective`)}</span> : null}
          {still.explicitSeed ? <span>{t(`${KEY_ROOT}.seeds.pinnedBadge`)}</span> : null}
          {pinBlockedByAuthorization ? <span>{t(`${KEY_ROOT}.seeds.authorizationIncompatible`)}</span> : null}
        </div>
      </div>
      {canManageSeed ? (
        <div className={styles.actions}>
          {canClearSeed ? (
            <Button disabled={disabled} onClick={() => void actions.setSeedStill(shot.id, null)} size='small'>
              {t(`${KEY_ROOT}.seeds.clearPin`)}
            </Button>
          ) : canPinSeed ? (
            <Button disabled={disabled} onClick={() => void actions.setSeedStill(shot.id, still.assetId)} size='small'>
              {t(`${KEY_ROOT}.seeds.pin`)}
            </Button>
          ) : null}
        </div>
      ) : null}
    </article>
  );
};

type ShotCardProps = {
  actions: BeatPanelActions;
  beat: WorkspaceBeatProjection;
  canMoveNext: boolean;
  canMovePrevious: boolean;
  drafts: UseWorkspaceDraftsResult;
  disabled: boolean;
  hidden: boolean;
  index: number;
  onMove: (index: number, delta: -1 | 1) => void;
  onParkSettled: (shotId: string, parked: boolean) => void;
  projectId: string;
  projection: WorkspaceProjection;
  reviewBlocked: boolean;
  reviewGraph: BeatPanelReviewGraph | null;
  shot: WorkspaceShotProjection;
};

const ShotCard: React.FC<ShotCardProps> = ({
  actions,
  beat,
  canMoveNext,
  canMovePrevious,
  drafts,
  disabled,
  hidden,
  index,
  onMove,
  onParkSettled,
  projectId,
  projection,
  reviewBlocked,
  reviewGraph,
  shot,
}) => {
  const { t } = useTranslation();
  const draftsRef = useLatestDrafts(drafts);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [lifting, setLifting] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [recoveringJobId, setRecoveringJobId] = useState<string | null>(null);
  const chainChangeDescriptionId = useId();
  const generationRecoveryId = useId();
  const generationBlockDescriptionId = useId();
  const liftButtonRef = useRef<HTMLButtonElement | null>(null);
  const confirmationHandleRef = useRef<ModalConfirmationHandle | null>(null);
  const restoreLiftFocusAfterCloseRef = useRef(false);
  const liftAuthorityRef = useRef({
    actions,
    disabled,
    hidden,
    liftAllowed: false,
    lifting,
    mounted: true,
    onParkSettled,
    projectId,
    projectRevision: projection.projectRevision,
    shotId: shot.id,
  });
  const shotCardRef = useRef<HTMLElement | null>(null);
  const shootingScriptKey = shotDraftKey(shot.id, 'shootingScript');
  const durationKey = shotDraftKey(shot.id, 'durationSeconds');
  const shootingScript = draftString(drafts, shootingScriptKey, shot.shootingScript);
  const durationSeconds = draftNumber(drafts, durationKey, shot.durationSeconds);
  const draftKeys = [shootingScriptKey, durationKey] as const;
  const dirty = draftKeys.some((key) => hasDraft(drafts, key));
  const liftEligibility = exactEligibility(projection, {
    subject: 'shot',
    action: 'park',
    beatId: beat.id,
    shotId: shot.id,
  });
  const firstLiftBlocker = liftEligibility?.blockers[0] ?? null;
  const downstream = shot.downstreamShotIds;
  const downstreamPositions = downstream.flatMap((shotId) => {
    const position = exactShotPosition(projection, shotId);
    return position === null ? [] : [position];
  });
  const downstreamLabels = downstreamPositions.map((position) =>
    t(`${KEY_ROOT}.shots.position`, {
      beatIndex: position.beatIndex + 1,
      shotIndex: position.shotIndex + 1,
    })
  );
  const liftAllowed = liftEligibility?.allowed === true && !dirty && downstreamPositions.length === downstream.length;
  liftAuthorityRef.current = {
    actions,
    disabled,
    hidden,
    liftAllowed,
    lifting,
    mounted: liftAuthorityRef.current.mounted,
    onParkSettled,
    projectId,
    projectRevision: projection.projectRevision,
    shotId: shot.id,
  };
  const reviewChoices = reviewGraph?.choices ?? null;
  const reviewBlock = reviewGraph?.block?.reason ?? null;
  const blockedShotId = reviewGraph?.block?.item.shotId ?? shot.id;
  const reviewPreferences = reviewChoices?.map((choice): BeatPanelReviewChoice => ({ ...choice })) ?? null;
  const reviewBlockCopy = reviewBlock === null ? null : generationBlockMessage(reviewBlock);
  const reviewBlockRemedy = reviewBlock === null ? 'none' : generationBlockAction(reviewBlock);
  const reviewedGenerationBlocked =
    reviewChoices === null ||
    reviewChoices.some((choice) => {
      const reviewedShot = exactShotProjection(projection, choice.shotId);
      return (
        reviewedShot === null ||
        (choice.purpose === 'seed_still' ? reviewedShot.seedGenerationBlocked : reviewedShot.videoGenerationBlocked)
      );
    });
  const chainChangeIntent = shot.chainBreak === 'hard_cut' ? 'rejoin' : 'sever';
  const chainChangeBlocked =
    disabled || drafts.staleRevision || dirty || reviewBlocked || shot.seedAuthorizationLock !== null;
  const chainState =
    index === 0
      ? 'segment_head'
      : shot.segmentHead
        ? shot.chainBreak === 'hard_cut'
          ? 'hard_cut'
          : 'segment_head'
        : 'continuous';

  const save = async (): Promise<void> => {
    if (!dirty || saving || disabled || drafts.staleRevision) return;
    const submitted = [
      [shootingScriptKey, shootingScript],
      [durationKey, durationSeconds],
    ] as const;
    const changes: Partial<Record<'shootingScript' | 'durationSeconds', string | number>> = {};
    if (shootingScript !== shot.shootingScript) changes.shootingScript = shootingScript;
    if (durationSeconds !== shot.durationSeconds) changes.durationSeconds = durationSeconds;
    if (Object.keys(changes).length === 0) {
      submitted.forEach(([key, value]) => draftsRef.current.resetIfValue(key, value));
      return;
    }
    setSaving(true);
    try {
      const saved = await actions.saveShot([{ shotId: shot.id, changes: changes as StudioEditableShotChanges }]);
      if (saved) submitted.forEach(([key, value]) => draftsRef.current.resetIfValue(key, value));
    } finally {
      setSaving(false);
    }
  };

  const reset = (): void => {
    draftKeys.forEach(drafts.reset);
  };

  const importSeed = async (): Promise<void> => {
    if (importing || disabled) return;
    setImporting(true);
    try {
      await actions.importSeedStill(shot.id);
    } finally {
      setImporting(false);
    }
  };

  useEffect(() => {
    if (!hidden) return;
    setMenuOpen(false);
    confirmationHandleRef.current?.close();
    confirmationHandleRef.current = null;
    shotCardRef.current?.querySelectorAll<HTMLVideoElement>('video[controls]').forEach((video) => {
      if (video.paused) return;
      try {
        video.pause();
      } catch {
        // Native media may already be detached or failed; hiding the inspector still proceeds.
      }
    });
  }, [hidden]);

  useEffect(() => {
    if (disabled || !liftAllowed) {
      setMenuOpen(false);
      confirmationHandleRef.current?.close();
      confirmationHandleRef.current = null;
    }
  }, [disabled, liftAllowed]);

  useEffect(() => {
    setMenuOpen(false);
    confirmationHandleRef.current?.close();
    confirmationHandleRef.current = null;
  }, [projectId, projection.projectRevision]);

  useEffect(
    () => () => {
      liftAuthorityRef.current.mounted = false;
      confirmationHandleRef.current?.close();
      confirmationHandleRef.current = null;
    },
    []
  );

  const parkShot = async (expectedShotId: string): Promise<void> => {
    const authority = liftAuthorityRef.current;
    if (
      !authority.mounted ||
      authority.hidden ||
      authority.disabled ||
      authority.lifting ||
      !authority.liftAllowed ||
      authority.shotId !== expectedShotId
    ) {
      return;
    }
    restoreLiftFocusAfterCloseRef.current = true;
    setLifting(true);
    let parked = false;
    try {
      parked = await authority.actions.parkShot(authority.shotId);
    } catch {
      // The action owner presents commit errors. A rejected provider is never treated as success.
    } finally {
      setLifting(false);
    }
    authority.onParkSettled(authority.shotId, parked);
    if (!parked) restoreLiftFocusAfterCloseRef.current = true;
  };

  const retryGenerationJob = async (jobId: string, acknowledgePossibleDuplicateCharge: boolean): Promise<void> => {
    if (disabled || recoveringJobId !== null) return;
    setRecoveringJobId(jobId);
    try {
      await actions.retryGenerationJob(jobId, acknowledgePossibleDuplicateCharge);
    } finally {
      setRecoveringJobId(null);
    }
  };

  const cancelGenerationJob = async (jobId: string): Promise<void> => {
    if (disabled || recoveringJobId !== null) return;
    setRecoveringJobId(jobId);
    try {
      await actions.cancelGenerationJob(jobId);
    } finally {
      setRecoveringJobId(null);
    }
  };

  const liftBodyKey = downstream.length === 0 ? `${KEY_ROOT}.lift.shotBodyNoStale` : `${KEY_ROOT}.lift.shotBodyStale`;
  const confirmParkShot = (): void => {
    if (disabled || lifting || !liftAllowed) return;
    setMenuOpen(false);
    const expectedProjectId = projectId;
    const expectedProjectRevision = projection.projectRevision;
    const expectedShotId = shot.id;
    restoreLiftFocusAfterCloseRef.current = false;
    confirmationHandleRef.current?.close();
    confirmationHandleRef.current = Modal.confirm({
      afterClose: () => {
        confirmationHandleRef.current = null;
        const authority = liftAuthorityRef.current;
        if (
          restoreLiftFocusAfterCloseRef.current &&
          authority.mounted &&
          !authority.hidden &&
          !authority.disabled &&
          authority.projectId === expectedProjectId &&
          authority.projectRevision === expectedProjectRevision &&
          authority.shotId === expectedShotId
        ) {
          liftButtonRef.current?.focus();
        }
        restoreLiftFocusAfterCloseRef.current = false;
      },
      cancelText: t(`${KEY_ROOT}.common.cancel`),
      content: t(liftBodyKey, { shots: downstreamLabels.join(', ') }),
      okButtonProps: { status: 'danger' },
      okText: t(`${KEY_ROOT}.lift.confirmShot`),
      onCancel: () => {
        restoreLiftFocusAfterCloseRef.current = true;
      },
      onOk: () => {
        if (
          liftAuthorityRef.current.projectId !== expectedProjectId ||
          liftAuthorityRef.current.projectRevision !== expectedProjectRevision
        ) {
          return;
        }
        return parkShot(expectedShotId);
      },
      title: t(`${KEY_ROOT}.lift.shotTitle`, { index: index + 1 }),
    });
  };
  const shotMenu = (
    <Menu data-shot-id={shot.id} data-shot-overflow-menu>
      <Menu.Item
        key='move-to-bin'
        data-shot-move-to-bin
        disabled={disabled || lifting || !liftAllowed}
        onClick={confirmParkShot}
      >
        {t(`${KEY_ROOT}.lift.shot`)}
      </Menu.Item>
    </Menu>
  );
  const pictureLabel = t(`${KEY_ROOT}.picture.label`, { index: index + 1 });
  const currentPictureUrl =
    shot.currentPicture === null ? null : createManagedStudioAssetUrl(projectId, shot.currentPicture.assetId);
  const currentPicturePosterUrl =
    shot.currentPicture?.posterAssetId === null || shot.currentPicture?.posterAssetId === undefined
      ? null
      : createManagedStudioAssetUrl(projectId, shot.currentPicture.posterAssetId);
  const currentPictureAvailable =
    shot.currentPicture !== null &&
    currentPictureUrl !== null &&
    (shot.currentPicture.posterAssetId === null || currentPicturePosterUrl !== null);
  return (
    <article ref={shotCardRef} className={styles.shotCard} data-shot-card data-shot-id={shot.id} hidden={hidden}>
      <header className={styles.shotHeader}>
        <div>
          <h3 className={styles.shotTitle}>{t(`${KEY_ROOT}.shots.heading`, { index: index + 1 })}</h3>
          <p className={styles.chainState} data-chain-state={chainState}>
            <bdi dir='auto'>
              {chainState === 'segment_head'
                ? t(`${KEY_ROOT}.chain.segmentHead`)
                : chainState === 'hard_cut'
                  ? t(`${KEY_ROOT}.chain.hardCutState`)
                  : t(`${KEY_ROOT}.chain.continuous`, { position: String(index).padStart(2, '0') })}
            </bdi>
          </p>
          {shot.dirtyCauses.includes('continuity_stale') && shot.chainBreak !== 'hard_cut' ? (
            <p className={styles.warning}>{t(`${KEY_ROOT}.chain.systemContinuityStale`)}</p>
          ) : null}
          {shot.dirtyCauses.includes('generation_out_of_date') ? (
            <p className={styles.warning}>{t(`${KEY_ROOT}.chain.generationOutOfDate`)}</p>
          ) : null}
        </div>
        <div className={styles.actions}>
          <Button
            aria-label={t(`${KEY_ROOT}.reorder.previous`, { index: index + 1 })}
            disabled={disabled || !canMovePrevious}
            onClick={() => onMove(index, -1)}
            size='small'
          >
            {t(`${KEY_ROOT}.reorder.previousShort`)}
          </Button>
          <Button
            aria-label={t(`${KEY_ROOT}.reorder.next`, { index: index + 1 })}
            disabled={disabled || !canMoveNext}
            onClick={() => onMove(index, 1)}
            size='small'
          >
            {t(`${KEY_ROOT}.reorder.nextShort`)}
          </Button>
          <Dropdown
            droplist={shotMenu}
            getPopupContainer={() => document.body}
            onVisibleChange={setMenuOpen}
            popupVisible={menuOpen}
            position='br'
            trigger='click'
          >
            <Button
              ref={(node) => {
                liftButtonRef.current = node instanceof HTMLButtonElement ? node : null;
              }}
              aria-expanded={menuOpen}
              aria-haspopup='menu'
              aria-label={`${t('common.more')} · ${t(`${KEY_ROOT}.shots.heading`, { index: index + 1 })}`}
              data-shot-id={shot.id}
              data-shot-overflow-trigger
              disabled={disabled || lifting || !liftAllowed}
              icon={<MoreOne aria-hidden='true' />}
              loading={lifting}
              shape='circle'
              size='small'
              type='text'
            />
          </Dropdown>
        </div>
      </header>

      <div className={styles.editorGrid}>
        <label data-shot-field='shooting-script'>
          <span>{t(`${KEY_ROOT}.fields.shootingScript`)}</span>
          <Input.TextArea
            aria-label={t(`${KEY_ROOT}.fields.shootingScriptFor`, { index: index + 1 })}
            autoSize={{ minRows: 3, maxRows: 6 }}
            disabled={disabled}
            onChange={(value) => drafts.setValue(shootingScriptKey, value)}
            value={shootingScript}
          />
        </label>
        <label data-shot-duration-field>
          <span>{t(`${KEY_ROOT}.fields.duration`)}</span>
          <InputNumber
            aria-label={t(`${KEY_ROOT}.fields.durationFor`, { index: index + 1 })}
            disabled={disabled}
            max={15}
            min={4}
            onChange={(value) => {
              if (typeof value === 'number' && Number.isSafeInteger(value)) drafts.setValue(durationKey, value);
            }}
            precision={0}
            value={durationSeconds}
          />
        </label>
      </div>
      <div className={styles.shotActionCluster}>
        <div className={styles.shotActionBand} data-shot-action-band>
          <div className={styles.editorActions} data-shot-actions>
            <Button
              disabled={disabled || drafts.staleRevision || saving || !dirty}
              loading={saving}
              onClick={() => void save()}
              type='primary'
            >
              {t(`${KEY_ROOT}.common.saveShot`)}
            </Button>
            <Button disabled={disabled || saving || !dirty} onClick={reset}>
              {t(`${KEY_ROOT}.common.resetShot`)}
            </Button>
            {index > 0 ? (
              <div className={styles.chainChangeControl} data-chain-change-control>
                <Button
                  aria-describedby={chainChangeDescriptionId}
                  aria-haspopup='dialog'
                  data-chain-change-intent={chainChangeIntent}
                  data-chain-change-trigger
                  data-shot-id={shot.id}
                  disabled={chainChangeBlocked}
                  onClick={() => actions.reviewContinuity(shot.id, chainChangeIntent === 'sever')}
                >
                  <span>
                    {t(
                      chainChangeIntent === 'sever' ? `${KEY_ROOT}.chain.reviewSever` : `${KEY_ROOT}.chain.reviewRejoin`
                    )}
                  </span>
                </Button>
              </div>
            ) : null}
          </div>
        </div>
        {index > 0 ? (
          <p className={styles.chainChangeDescription} data-chain-change-description id={chainChangeDescriptionId}>
            {t(
              chainChangeIntent === 'sever'
                ? `${KEY_ROOT}.chain.reviewSeverDescription`
                : `${KEY_ROOT}.chain.reviewRejoinDescription`,
              { shot: index + 1, previous: index }
            )}
          </p>
        ) : null}
      </div>

      {shot.segmentHead || shot.seedStills.length > 0 ? (
        <section aria-label={t(`${KEY_ROOT}.seeds.label`, { index: index + 1 })} className={styles.subsection}>
          {shot.segmentHead ? (
            <div className={styles.subsectionHeader}>
              <div>
                <h4 className={styles.subsectionTitle}>{t(`${KEY_ROOT}.seeds.title`)}</h4>
                <p className={styles.muted}>
                  {t(
                    shot.effectiveSeedAssetId === null
                      ? `${KEY_ROOT}.seeds.pending`
                      : shot.explicitSeedAssetId === null
                        ? `${KEY_ROOT}.seeds.latestDefault`
                        : `${KEY_ROOT}.seeds.pinned`
                  )}
                </p>
              </div>
              <Button disabled={disabled || importing} loading={importing} onClick={() => void importSeed()}>
                {t(`${KEY_ROOT}.seeds.import`)}
              </Button>
            </div>
          ) : (
            <h4 className={styles.subsectionTitle}>{t(`${KEY_ROOT}.seeds.title`)}</h4>
          )}
          <div className={styles.mediaStrip}>
            {shot.seedStills.map((still, stillIndex) => (
              <SeedStillCard
                key={still.assetId}
                actions={actions}
                canManageSeed={shot.segmentHead}
                disabled={disabled}
                projectId={projectId}
                shot={shot}
                shotIndex={index}
                still={still}
                stillIndex={stillIndex}
              />
            ))}
          </div>
          {shot.seedAuthorizationLock !== null ? (
            <Alert content={t(`${KEY_ROOT}.seeds.authorizationLocked`)} showIcon type='warning' />
          ) : null}
          {shot.seedStills.length === 0 ? <p className={styles.muted}>{t(`${KEY_ROOT}.seeds.empty`)}</p> : null}
        </section>
      ) : null}

      <section aria-label={pictureLabel} className={styles.subsection}>
        <h4 className={styles.subsectionTitle}>{t(`${KEY_ROOT}.picture.title`)}</h4>
        {shot.currentPicture === null ? (
          <p className={styles.muted}>{t(`${KEY_ROOT}.picture.empty`)}</p>
        ) : !currentPictureAvailable ? (
          <p className={styles.warning} role='alert'>
            {t(`${KEY_ROOT}.picture.unavailable`)}
          </p>
        ) : (
          <article className={styles.mediaCard} data-asset-id={shot.currentPicture.assetId} data-current-picture>
            <FullscreenMediaFrame className={styles.mediaPreviewFrame}>
              <video
                aria-label={t(`${KEY_ROOT}.picture.videoPreview`, { label: pictureLabel })}
                className={styles.mediaPreview}
                controls
                poster={currentPicturePosterUrl ?? undefined}
                preload='metadata'
                src={currentPictureUrl!}
              />
            </FullscreenMediaFrame>
            <div className={styles.mediaDetails}>
              <span className={styles.mediaIdentity} dir='auto'>
                {pictureLabel}
              </span>
              <span>
                <bdi>
                  {t(`${KEY_ROOT}.picture.sourceDuration`, {
                    seconds: shot.currentPicture.sourceDurationSeconds,
                  })}
                </bdi>
              </span>
            </div>
          </article>
        )}
        <div className={styles.shotFooter} data-shot-footer>
          {reviewBlockCopy === null && reviewPreferences === null ? (
            <p className={styles.blocker} role='status'>
              {t(`${KEY_ROOT}.generation.reviewUnavailable`)}
            </p>
          ) : reviewBlockCopy === null ? null : (
            <div>
              <p className={styles.blocker} id={generationBlockDescriptionId} role='status'>
                {t(reviewBlockCopy.key, reviewBlockCopy.values)}
              </p>
              {reviewBlockRemedy === 'none' ? null : (
                <Button
                  onClick={() => {
                    if (reviewBlock === null) return;
                    if (reviewBlockRemedy === 'duration') {
                      const fields = document.querySelectorAll<HTMLInputElement>(
                        `[data-shot-card][data-shot-id="${blockedShotId}"] [data-shot-duration-field] input`
                      );
                      if (fields.length === 1) fields[0]!.focus();
                      return;
                    }
                    actions.resolveGenerationBlock(blockedShotId, reviewBlock);
                  }}
                  size='small'
                >
                  {t(
                    reviewBlockRemedy === 'routes'
                      ? 'conversation.creativeStudio.models.blocked.actionSetEngines'
                      : reviewBlockRemedy === 'references'
                        ? 'conversation.creativeStudio.workspace.gate.reviewShotBinding'
                        : 'conversation.creativeStudio.models.blocked.actionShorten'
                  )}
                </Button>
              )}
            </div>
          )}
          <Button
            aria-describedby={reviewBlock === null ? undefined : generationBlockDescriptionId}
            disabled={
              disabled ||
              reviewBlocked ||
              reviewedGenerationBlocked ||
              reviewPreferences === null ||
              reviewBlock !== null ||
              shot.seedAuthorizationLock !== null
            }
            onClick={() => {
              if (reviewPreferences !== null && reviewPreferences.length > 0) {
                actions.reviewShot(shot.id, reviewPreferences as [BeatPanelReviewChoice, ...BeatPanelReviewChoice[]]);
              }
            }}
            type='primary'
          >
            {t(
              shot.segmentHead && shot.effectiveSeedAssetId === null
                ? `${KEY_ROOT}.generation.generateSeed`
                : `${KEY_ROOT}.generation.renderVideo`
            )}
          </Button>
        </div>
      </section>

      {shot.attentionJobs.length > 0 ? (
        <section
          aria-label={t(`${JOB_KEY_ROOT}.status.needsAttention`)}
          className={styles.recoveryCard}
          data-generation-recovery
        >
          {shot.attentionJobs.map((job) => {
            const duplicateChargeAcknowledgement = job.error.code === 'submission_unknown';
            const jobPending = recoveringJobId === job.id;
            const jobDescriptionId = `${generationRecoveryId}-${job.id}`;
            return (
              <div key={job.id} className={styles.jobRecoveryRow} data-job-id={job.id}>
                <div id={jobDescriptionId}>
                  <p>{t(job.error.messageKey)}</p>
                  <p className={styles.muted}>
                    {t(
                      job.purpose === 'seed_still'
                        ? `${KEY_ROOT}.generation.purpose.seedStill`
                        : 'conversation.creativeStudio.scene.video'
                    )}
                  </p>
                </div>
                <div className={styles.actions}>
                  {job.canRetry && duplicateChargeAcknowledgement ? (
                    <Popconfirm
                      cancelText={t(`${KEY_ROOT}.common.cancel`)}
                      content={t(`${JOB_KEY_ROOT}.retryChargeBody`)}
                      disabled={disabled || recoveringJobId !== null}
                      okText={t(`${JOB_KEY_ROOT}.retryChargeConfirm`)}
                      onOk={() => void retryGenerationJob(job.id, true)}
                      title={t(`${JOB_KEY_ROOT}.retryChargeTitle`)}
                    >
                      <Button
                        aria-describedby={jobDescriptionId}
                        disabled={disabled || recoveringJobId !== null}
                        loading={jobPending}
                      >
                        {t(`${JOB_KEY_ROOT}.retry`)}
                      </Button>
                    </Popconfirm>
                  ) : job.canRetry ? (
                    <Button
                      aria-describedby={jobDescriptionId}
                      disabled={disabled || recoveringJobId !== null}
                      loading={jobPending}
                      onClick={() => void retryGenerationJob(job.id, false)}
                    >
                      {t(`${JOB_KEY_ROOT}.retry`)}
                    </Button>
                  ) : null}
                  {job.canCancel ? (
                    <Button
                      aria-describedby={jobDescriptionId}
                      disabled={disabled || recoveringJobId !== null}
                      loading={jobPending}
                      onClick={() => void cancelGenerationJob(job.id)}
                    >
                      {t(`${JOB_KEY_ROOT}.cancel`)}
                    </Button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </section>
      ) : null}

      {!liftAllowed ? (
        <p className={styles.blocker} role='status'>
          {dirty
            ? t(`${KEY_ROOT}.blocker.unsavedDrafts`)
            : firstLiftBlocker === null
              ? t(`${KEY_ROOT}.blocker.statusUnavailable`)
              : t(BLOCKER_KEYS[firstLiftBlocker.code])}
        </p>
      ) : null}
    </article>
  );
};

type RecoveryProps = Pick<BeatPanelProps, 'actions' | 'beat' | 'pending' | 'projection'> & {
  reviewBlocked: boolean;
};

const Recovery: React.FC<RecoveryProps> = ({ actions, beat, pending, projection, reviewBlocked }) => {
  const { t } = useTranslation();
  const shotIds = new Set(beat.shots.map((shot) => shot.id));
  const rows = projection.cascadeProgress.filter((row) => shotIds.has(row.dependentShotId));
  const standaloneFailures = projection.conditioningFailures.filter(
    (failure) =>
      shotIds.has(failure.dependentShotId) &&
      !rows.some((row) => row.dependentShotId === failure.dependentShotId && row.canRetryConditioningFrame)
  );
  if (rows.length === 0 && standaloneFailures.length === 0) return null;
  return (
    <section aria-label={t(`${KEY_ROOT}.recovery.label`)} className={styles.recovery}>
      <h3 className={styles.subsectionTitle}>{t(`${KEY_ROOT}.recovery.title`)}</h3>
      {rows.map((row) => {
        const shotIndex = beat.shots.findIndex((shot) => shot.id === row.dependentShotId);
        const shot = shotIndex < 0 ? undefined : beat.shots[shotIndex];
        const isAuthorizedSeedChoice =
          row.waitingReason === 'choose_seed' && row.upstreamShotId === row.dependentShotId;
        const canStructurallyRejoin = shotIndex > 0 && shot?.chainBreak === 'hard_cut';
        const canCancelAndReviewRejoin =
          row.canCancelWaiting &&
          isAuthorizedSeedChoice &&
          canStructurallyRejoin &&
          shot.seedAuthorizationLock?.waitingReason === 'choose_seed' &&
          shot.seedAuthorizationLock.canCancelWaiting;
        return (
          <article
            key={`cascade:${row.dependentShotId}`}
            className={styles.recoveryCard}
            data-waiting-reason={row.waitingReason}
          >
            <p>{t(`${KEY_ROOT}.recovery.reason.${row.waitingReason}`)}</p>
            {row.waitingReason === 'dependency_failed' || row.waitingReason === 'cancelled' ? (
              <p className={styles.warning}>{t(`${KEY_ROOT}.recovery.freshQuoteRequired`)}</p>
            ) : null}
            <div className={styles.actions}>
              {row.canRetryConditioningFrame ? (
                <Button disabled={pending} onClick={() => void actions.retryConditioning(row.dependentShotId)}>
                  {t(`${KEY_ROOT}.recovery.retryFree`)}
                </Button>
              ) : null}
              {canCancelAndReviewRejoin ? (
                <Popconfirm
                  cancelText={t(`${KEY_ROOT}.common.keepWaiting`)}
                  content={t(`${KEY_ROOT}.recovery.cancelAndReviewRejoinBody`)}
                  disabled={pending || reviewBlocked}
                  okText={t(`${KEY_ROOT}.recovery.cancelAndReviewRejoinConfirm`)}
                  onOk={() => actions.cancelAndReviewRejoin(row.dependentShotId)}
                  title={t(`${KEY_ROOT}.recovery.cancelAndReviewRejoinTitle`)}
                >
                  <Button disabled={pending || reviewBlocked} status='danger'>
                    {t(`${KEY_ROOT}.recovery.cancelAndReviewRejoin`)}
                  </Button>
                </Popconfirm>
              ) : row.canCancelWaiting && (!isAuthorizedSeedChoice || !canStructurallyRejoin) ? (
                <Popconfirm
                  cancelText={t(`${KEY_ROOT}.common.keepWaiting`)}
                  content={t(`${KEY_ROOT}.recovery.cancelBody`)}
                  disabled={pending}
                  okText={t(`${KEY_ROOT}.recovery.cancelConfirm`)}
                  onOk={() => actions.cancelWaiting(row.dependentShotId)}
                  title={t(`${KEY_ROOT}.recovery.cancelTitle`)}
                >
                  <Button disabled={pending} status='danger'>
                    {t(`${KEY_ROOT}.recovery.cancelWaiting`)}
                  </Button>
                </Popconfirm>
              ) : null}
            </div>
          </article>
        );
      })}
      {standaloneFailures.map((failure) => (
        <article
          key={`failure:${failure.dependentShotId}`}
          className={styles.recoveryCard}
          data-waiting-reason={failure.reason}
        >
          <p>{t(`${KEY_ROOT}.recovery.localConditioningFailure`)}</p>
          {failure.canRetry ? (
            <Button disabled={pending} onClick={() => void actions.retryConditioning(failure.dependentShotId)}>
              {t(`${KEY_ROOT}.recovery.retryFree`)}
            </Button>
          ) : null}
        </article>
      ))}
    </section>
  );
};

/** Human Beat/Shot authoring and recovery surface. Native authority stays in semantic parent callbacks. */
export const BeatPanel: React.FC<BeatPanelProps> = ({
  projectId,
  beat,
  beatIds,
  beatIndex,
  projection,
  drafts,
  reviewGraphs,
  errorMessageKey,
  pending,
  gateLocked,
  reviewBlockedMessageKey,
  onParkShotSuccess,
  onSelectBeat,
  onClose,
  actions,
}) => {
  const { t } = useTranslation();
  const draftsRef = useLatestDrafts(drafts);
  const [savingBeat, setSavingBeat] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [reorderAnnouncement, setReorderAnnouncement] = useState('');
  const [shotLiftAnnouncement, setShotLiftAnnouncement] = useState('');
  const beatMenuTriggerRef = useRef<HTMLButtonElement | null>(null);
  const confirmationHandleRef = useRef<ModalConfirmationHandle | null>(null);
  const restoreMenuFocusAfterCloseRef = useRef(false);
  const beatLiftAuthorityRef = useRef({
    actions,
    allowed: false,
    beatId: beat.id,
    locked: false,
    mounted: true,
    projectId,
    projectRevision: projection.projectRevision,
  });
  const [inspectedShotSelection, setInspectedShotSelection] = useState<{
    beatId: string;
    shotId: string | null;
  }>(() => ({ beatId: beat.id, shotId: beat.shots[0]?.id ?? null }));
  const storyKey = beatDraftKey(beat.id, 'story');
  const targetKey = beatDraftKey(beat.id, 'targetSeconds');
  const story = draftString(drafts, storyKey, beat.story);
  const targetSeconds = draftNullableNumber(drafts, targetKey, beat.targetSeconds);
  const beatDraftKeys = [storyKey, targetKey] as const;
  const beatDirty = beatDraftKeys.some((key) => hasDraft(drafts, key));
  const mutationLocked = pending || gateLocked;
  const coverageDraftDirty =
    beatDirty ||
    beat.shots.some((shot) =>
      (['shootingScript', 'durationSeconds'] as const).some((field) => hasDraft(drafts, shotDraftKey(shot.id, field)))
    );
  const coverageDisabled = mutationLocked || drafts.staleRevision || coverageDraftDirty;
  const safeBeatIndex = beatIds[beatIndex] === beat.id ? beatIndex : beatIds.indexOf(beat.id);
  const previousBeatId = safeBeatIndex > 0 ? (beatIds[safeBeatIndex - 1] ?? null) : null;
  const nextBeatId = safeBeatIndex >= 0 ? (beatIds[safeBeatIndex + 1] ?? null) : null;
  const beatLiftEligibility = exactEligibility(projection, {
    subject: 'beat',
    action: 'park',
    beatId: beat.id,
    shotId: null,
  });
  const firstBeatBlocker = beatLiftEligibility?.blockers[0] ?? null;
  const containedShotIds = new Set(beat.shots.map((shot) => shot.id));
  const beatDownstream = [
    ...new Set(beat.shots.flatMap((shot) => shot.downstreamShotIds).filter((shotId) => !containedShotIds.has(shotId))),
  ];
  const beatDownstreamPositions = beatDownstream.flatMap((shotId) => {
    const position = exactShotPosition(projection, shotId);
    return position === null ? [] : [position];
  });
  const beatDownstreamLabels = beatDownstreamPositions.map((position) =>
    t(`${KEY_ROOT}.shots.position`, {
      beatIndex: position.beatIndex + 1,
      shotIndex: position.shotIndex + 1,
    })
  );
  const beatLiftAllowed =
    beatLiftEligibility?.allowed === true &&
    !coverageDraftDirty &&
    beatDownstreamPositions.length === beatDownstream.length;
  beatLiftAuthorityRef.current = {
    actions,
    allowed: beatLiftAllowed,
    beatId: beat.id,
    locked: mutationLocked,
    mounted: beatLiftAuthorityRef.current.mounted,
    projectId,
    projectRevision: projection.projectRevision,
  };
  const displayBeatIndex = safeBeatIndex >= 0 ? safeBeatIndex + 1 : Math.max(beatIndex + 1, 1);
  const beatTitle = beat.title.trim() || t(`${KEY_ROOT}.untitledBeat`, { index: displayBeatIndex });
  const requestedInspectedShotId = inspectedShotSelection.beatId === beat.id ? inspectedShotSelection.shotId : null;
  const inspectedShotId = beat.shots.some((shot) => shot.id === requestedInspectedShotId)
    ? requestedInspectedShotId
    : (beat.shots[0]?.id ?? null);

  const inspectShot = (shotId: string): void => {
    if (!beat.shots.some((shot) => shot.id === shotId)) return;
    setInspectedShotSelection({ beatId: beat.id, shotId });
  };

  const saveBeat = async (): Promise<void> => {
    if (!beatDirty || savingBeat || mutationLocked || drafts.staleRevision) return;
    const submitted = [
      [storyKey, story],
      [targetKey, targetSeconds],
    ] as const;
    const changes: Partial<{ story: string; targetSeconds: number | null }> = {};
    if (story !== beat.story) changes.story = story;
    if (targetSeconds !== beat.targetSeconds) changes.targetSeconds = targetSeconds;
    if (Object.keys(changes).length === 0) {
      submitted.forEach(([key, value]) => draftsRef.current.resetIfValue(key, value));
      return;
    }
    setSavingBeat(true);
    try {
      const saved = await actions.saveBeat(beat.id, changes as StudioEditableBeatChanges);
      if (saved) submitted.forEach(([key, value]) => draftsRef.current.resetIfValue(key, value));
    } finally {
      setSavingBeat(false);
    }
  };

  const moveShot = async (index: number, delta: -1 | 1): Promise<void> => {
    if (mutationLocked) return;
    const nextIndex = index + delta;
    if (nextIndex < 0 || nextIndex >= beat.shots.length) return;
    const nextOrder = beat.shots.map((shot) => shot.id);
    const [moved] = nextOrder.splice(index, 1);
    if (moved === undefined) return;
    nextOrder.splice(nextIndex, 0, moved);
    if (await actions.reorderShots(beat.id, nextOrder)) {
      setReorderAnnouncement(
        t(`${KEY_ROOT}.reorder.announcement`, { from: index + 1, to: nextIndex + 1, total: beat.shots.length })
      );
    }
  };

  const commitPlanningDurations = (changes: CoveragePlanningPairChange): Promise<boolean> => {
    if (coverageDisabled) return Promise.resolve(false);
    return actions.saveShot([
      { shotId: changes[0].shotId, changes: { durationSeconds: changes[0].durationSeconds } },
      { shotId: changes[1].shotId, changes: { durationSeconds: changes[1].durationSeconds } },
    ]);
  };

  const commitTrim = (shotId: string, trimInSeconds: number | null, trimOutSeconds: number | null): Promise<boolean> =>
    coverageDisabled ? Promise.resolve(false) : actions.trimShot(shotId, trimInSeconds, trimOutSeconds);

  const beatLiftBodyKey =
    beatDownstream.length === 0 ? `${KEY_ROOT}.lift.beatBodyNoStale` : `${KEY_ROOT}.lift.beatBodyStale`;
  const confirmParkBeat = (): void => {
    if (mutationLocked || !beatLiftAllowed) return;
    setMenuOpen(false);
    const expectedBeatId = beat.id;
    const expectedProjectId = projectId;
    const expectedProjectRevision = projection.projectRevision;
    restoreMenuFocusAfterCloseRef.current = false;
    confirmationHandleRef.current?.close();
    confirmationHandleRef.current = Modal.confirm({
      afterClose: () => {
        confirmationHandleRef.current = null;
        const authority = beatLiftAuthorityRef.current;
        if (
          restoreMenuFocusAfterCloseRef.current &&
          authority.mounted &&
          !authority.locked &&
          authority.allowed &&
          authority.beatId === expectedBeatId &&
          authority.projectId === expectedProjectId &&
          authority.projectRevision === expectedProjectRevision
        ) {
          beatMenuTriggerRef.current?.focus();
        }
        restoreMenuFocusAfterCloseRef.current = false;
      },
      cancelText: t(`${KEY_ROOT}.common.cancel`),
      content: t(beatLiftBodyKey, { shots: beatDownstreamLabels.join(', ') }),
      okButtonProps: { status: 'danger' },
      okText: t(`${KEY_ROOT}.lift.confirmBeat`),
      onCancel: () => {
        restoreMenuFocusAfterCloseRef.current = true;
      },
      onOk: () => {
        const authority = beatLiftAuthorityRef.current;
        if (
          !authority.mounted ||
          authority.locked ||
          !authority.allowed ||
          authority.beatId !== expectedBeatId ||
          authority.projectId !== expectedProjectId ||
          authority.projectRevision !== expectedProjectRevision
        ) {
          return;
        }
        restoreMenuFocusAfterCloseRef.current = true;
        return authority.actions.parkBeat(authority.beatId);
      },
      title: t(`${KEY_ROOT}.lift.beatTitle`),
    });
  };
  const beatMenu = (
    <Menu data-beat-id={beat.id} data-beat-overflow-menu>
      <Menu.Item
        key='move-to-bin'
        data-beat-move-to-bin
        disabled={mutationLocked || !beatLiftAllowed}
        onClick={confirmParkBeat}
      >
        {t(`${KEY_ROOT}.lift.beat`)}
      </Menu.Item>
    </Menu>
  );

  useEffect(() => {
    if (mutationLocked || !beatLiftAllowed) {
      setMenuOpen(false);
      confirmationHandleRef.current?.close();
      confirmationHandleRef.current = null;
    }
  }, [beatLiftAllowed, mutationLocked]);

  useEffect(() => {
    setMenuOpen(false);
    confirmationHandleRef.current?.close();
    confirmationHandleRef.current = null;
  }, [beat.id]);

  useEffect(() => {
    setMenuOpen(false);
    confirmationHandleRef.current?.close();
    confirmationHandleRef.current = null;
  }, [projectId, projection.projectRevision]);

  useEffect(
    () => () => {
      beatLiftAuthorityRef.current.mounted = false;
      confirmationHandleRef.current?.close();
      confirmationHandleRef.current = null;
    },
    []
  );

  return (
    <Modal
      className={styles.modal}
      closable={!pending}
      footer={null}
      maskClosable={false}
      onCancel={pending ? undefined : onClose}
      title={t(`${KEY_ROOT}.title`, { title: beatTitle })}
      unmountOnExit={false}
      visible
    >
      <section aria-label={t(`${KEY_ROOT}.label`, { title: beatTitle })} className={styles.root}>
        <header className={styles.panelHeader} data-panel-header>
          <div>
            <p className={styles.eyebrow}>
              {t(`${KEY_ROOT}.beatPosition`, { index: safeBeatIndex + 1, total: beatIds.length })}
            </p>
            <h2 className={styles.panelTitle} dir='auto'>
              {beatTitle}
            </h2>
          </div>
          <div className={styles.actions}>
            <Button
              aria-label={t(`${KEY_ROOT}.previousBeat`)}
              disabled={pending || previousBeatId === null}
              onClick={() => previousBeatId !== null && onSelectBeat(previousBeatId)}
            >
              {t(`${KEY_ROOT}.previousBeatShort`)}
            </Button>
            <Button
              aria-label={t(`${KEY_ROOT}.nextBeat`)}
              disabled={pending || nextBeatId === null}
              onClick={() => nextBeatId !== null && onSelectBeat(nextBeatId)}
            >
              {t(`${KEY_ROOT}.nextBeatShort`)}
            </Button>
            <Dropdown
              droplist={beatMenu}
              getPopupContainer={() => document.body}
              onVisibleChange={setMenuOpen}
              popupVisible={menuOpen}
              position='br'
              trigger='click'
            >
              <Button
                ref={(node) => {
                  beatMenuTriggerRef.current = node instanceof HTMLButtonElement ? node : null;
                }}
                aria-expanded={menuOpen}
                aria-haspopup='menu'
                aria-label={`${t('common.more')} · ${beatTitle}`}
                data-beat-id={beat.id}
                data-beat-overflow-trigger
                disabled={mutationLocked || !beatLiftAllowed}
                icon={<MoreOne aria-hidden='true' />}
                shape='circle'
                type='text'
              />
            </Dropdown>
          </div>
        </header>

        {!beatLiftAllowed ? (
          <p className={styles.blocker} data-beat-removal-blocker role='status'>
            {coverageDraftDirty
              ? t(`${KEY_ROOT}.blocker.unsavedDrafts`)
              : firstBeatBlocker === null
                ? t(`${KEY_ROOT}.blocker.statusUnavailable`)
                : t(BLOCKER_KEYS[firstBeatBlocker.code])}
          </p>
        ) : null}

        {errorMessageKey === null ? null : <Alert content={t(errorMessageKey)} type='error' />}

        <section aria-label={t(`${KEY_ROOT}.beatFieldsLabel`)} className={styles.beatEditor}>
          <label className={styles.beatField} data-beat-field='story'>
            <span className={styles.beatFieldHeading}>
              <span className={styles.fieldGuidance}>{t(`${KEY_ROOT}.fieldGuidance.story`)}</span>
            </span>
            <Input.TextArea
              aria-label={t(`${KEY_ROOT}.fields.story`)}
              autoSize={{ minRows: 3, maxRows: 8 }}
              disabled={mutationLocked}
              onChange={(value) => drafts.setValue(storyKey, value)}
              value={story}
            />
          </label>
          <div className={styles.beatMetaRow} data-beat-meta-row>
            <label className={styles.beatTargetField} data-beat-field='target'>
              <span>{t(`${KEY_ROOT}.fields.targetSeconds`)}</span>
              <InputNumber
                aria-label={t(`${KEY_ROOT}.fields.targetSeconds`)}
                disabled={mutationLocked}
                min={1}
                onChange={(value) => drafts.setValue(targetKey, typeof value === 'number' ? value : null)}
                precision={0}
                value={targetSeconds ?? undefined}
              />
            </label>
            <div className={styles.editorActions} data-beat-editor-actions>
              <Button
                disabled={mutationLocked || drafts.staleRevision || savingBeat || !beatDirty}
                loading={savingBeat}
                onClick={() => void saveBeat()}
                type='primary'
              >
                {t(`${KEY_ROOT}.common.saveBeat`)}
              </Button>
              <Button
                disabled={mutationLocked || savingBeat || !beatDirty}
                onClick={() => beatDraftKeys.forEach(drafts.reset)}
              >
                {t(`${KEY_ROOT}.common.resetBeat`)}
              </Button>
              <Button disabled={mutationLocked} onClick={() => actions.requestResplit(beat.id)}>
                {t(`${KEY_ROOT}.coverage.reviewResplit`)}
              </Button>
            </div>
          </div>
        </section>

        <BeatPlayer
          beat={beat}
          inspector={
            <section
              aria-label={t(`${KEY_ROOT}.shots.label`)}
              className={styles.shotInspector}
              data-inspected-shot-id={inspectedShotId ?? undefined}
              data-shot-inspector
            >
              {beat.shots.map((shot, index) => (
                <ShotCard
                  key={shot.id}
                  actions={actions}
                  beat={beat}
                  canMoveNext={index < beat.shots.length - 1}
                  canMovePrevious={index > 0}
                  disabled={mutationLocked}
                  drafts={drafts}
                  hidden={shot.id !== inspectedShotId}
                  index={index}
                  onMove={(position, delta) => void moveShot(position, delta)}
                  onParkSettled={(shotId, parked) => {
                    if (parked) {
                      onParkShotSuccess(shotId);
                      return;
                    }
                    setShotLiftAnnouncement(t(`${KEY_ROOT}.lift.shotFailed`));
                  }}
                  projectId={projectId}
                  projection={projection}
                  reviewBlocked={reviewBlockedMessageKey !== null || gateLocked}
                  reviewGraph={exactReviewGraph(
                    projection,
                    reviewGraphs,
                    shot.id,
                    shot.segmentHead && shot.effectiveSeedAssetId === null ? 'seed_still' : 'video_take'
                  )}
                  shot={shot}
                />
              ))}
              {beat.shots.length === 0 ? <p className={styles.muted}>{t(`${KEY_ROOT}.shots.empty`)}</p> : null}
            </section>
          }
          projectId={projectId}
          projection={projection}
        >
          {(playback) => (
            <CoverageBar
              disabled={coverageDisabled}
              inspectedShotId={inspectedShotId}
              onCommitPlanningDurations={commitPlanningDurations}
              onCommitTrim={commitTrim}
              onInspectShot={inspectShot}
              playback={playback}
              projectId={projectId}
              shots={beat.shots}
            />
          )}
        </BeatPlayer>

        {reviewBlockedMessageKey !== null || gateLocked ? (
          <p className={styles.warning} role='status'>
            {t(reviewBlockedMessageKey ?? `${KEY_ROOT}.generation.gateLocked`)}
          </p>
        ) : null}

        <Recovery
          actions={actions}
          beat={beat}
          pending={mutationLocked}
          projection={projection}
          reviewBlocked={reviewBlockedMessageKey !== null}
        />

        <span aria-atomic='true' aria-live='polite' className={styles.srOnly}>
          {shotLiftAnnouncement || reorderAnnouncement}
        </span>
      </section>
    </Modal>
  );
};

export { CoverageBar } from './CoverageBar';
export type { CoverageBarProps, CoveragePlayback } from './CoverageBar';
export { BeatPlayer } from './BeatPlayer';
export type { BeatPlaybackControl, BeatPlayerProps } from './BeatPlayer';
export {
  buildCoverageGeometry,
  clampCoverageTrim,
  coverageDensityForWidth,
  coveragePlanningPairBounds,
  coveragePointerDeltaSeconds,
  coveragePointerPositionSeconds,
  coverageSeekLaneRatio,
  coverageSeekPositionSeconds,
  maximumCoverageTrim,
  resizeCoveragePlanningPair,
} from './coverageGeometry';
export type {
  CoverageDensity,
  CoverageGeometry,
  CoveragePlanningDurationChange,
  CoveragePlanningPairBounds,
  CoveragePlanningPairChange,
  CoverageSegmentGeometry,
} from './coverageGeometry';
export {
  beatPlaybackJoins,
  buildBeatPlaybackSequence,
  formatBeatPlaybackClock,
  resolveBeatPlaybackLocation,
} from './beatPlaybackSequence';
export type {
  BeatPlaybackLocation,
  BeatPlaybackSegment,
  BeatPlaybackSequence,
  BeatPlaybackSlateSegment,
  BeatPlaybackVideoSegment,
} from './beatPlaybackSequence';
