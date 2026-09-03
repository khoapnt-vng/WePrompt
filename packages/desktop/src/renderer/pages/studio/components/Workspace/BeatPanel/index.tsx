/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Alert, Button, Dropdown, Input, InputNumber, Menu, Modal, Popconfirm } from '@arco-design/web-react';
import { MoreOne, Notes } from '@icon-park/react';
import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  STUDIO_MAX_SHOT_SECONDS,
  STUDIO_MIN_SHOT_SECONDS,
  type StudioEditableShotChanges,
  type StudioAspectRatio,
  type StudioGenerationBlockV2,
  type StudioRendererParkBlockerCodeV2,
  type StudioRendererParkEligibilityV2,
  type StudioView,
} from '@/common/types/project/creativeStudioTypes';

import { createManagedStudioAssetUrl } from '@/renderer/pages/studio/studioManagedAssetUrl';

import type { UseWorkspaceDraftsResult } from '../useWorkspaceDrafts';
import type { WorkspaceBeatProjection, WorkspaceProjection, WorkspaceShotProjection } from '../workspaceProjection';
import { generationBlockAction, generationBlockMessage } from '../Gate/generationBlockers';
import { deriveWorkspaceShotStatus } from '../Views/shotStatus';
import styles from './BeatPanel.module.css';
import { BeatPlayer } from './BeatPlayer';
import { CoverageBar } from './CoverageBar';
import type { CoveragePlanningPairChange } from './coverageGeometry';
import { FirstFrames } from './FirstFrames';

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

export type BeatPanelBeatSaveChanges = { story: string };

export type StudioShotEditFocusIntent = {
  id: string;
  projectId: string;
  view: StudioView;
  beatId: string;
  shotIds: readonly string[];
};

export type BeatPanelActions = {
  saveBeat: (beatId: string, changes: BeatPanelBeatSaveChanges) => Promise<boolean>;
  saveShot: (updates: readonly [BeatPanelShotSave, ...BeatPanelShotSave[]]) => Promise<boolean>;
  setSeedStill: (shotId: string, assetId: string | null) => Promise<boolean>;
  dismissSeedStill: (shotId: string, assetId: string) => Promise<boolean>;
  trimShot: (shotId: string, trimInSeconds: number | null, trimOutSeconds: number | null) => Promise<boolean>;
  reorderShots: (beatId: string, shotOrder: readonly string[]) => Promise<boolean>;
  importSeedStill: (shotId: string) => Promise<BeatPanelImportResult>;
  persistCapturedPoster: (input: {
    shotId: string;
    videoAssetId: string;
    dataUrl: string;
    width: number;
    height: number;
  }) => Promise<boolean>;
  parkShot: (shotId: string, onCommitted?: () => void) => Promise<boolean>;
  parkBeat: (beatId: string) => Promise<boolean>;
  reviewShot: (triggerShotId: string, choices: readonly [BeatPanelReviewChoice, ...BeatPanelReviewChoice[]]) => void;
  reviewSeedStill: (shotId: string) => void;
  reviewContinuity: (shotId: string, hardCut: boolean) => void;
  reviewReferences: (shotId: string) => void;
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
  /** Republished on this panel's root because the Modal portals out of the workspace subtree. */
  aspectRatio: StudioAspectRatio;
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
  referenceBindings?: readonly {
    shotId: string;
    status: 'unassigned' | 'ready' | 'invalid';
    characterReferenceIds: readonly string[];
    backgroundReferenceId: string | null;
  }[];
  referenceMaxConditioningImages?: number | null;
  onParkShotSuccess: (shotId: string) => void;
  onSelectBeat: (beatId: string) => void;
  onClose: () => void;
  shotEditFocusIntent?: StudioShotEditFocusIntent | null;
  onShotEditFocusIntentConsumed?: (intentId: string) => void;
  actions: BeatPanelActions;
};

const beatDraftKey = (beatId: string): string => `beat.${beatId}.story`;

const shotDraftKey = (shotId: string, field: 'shootingScript' | 'durationSeconds'): string => `shot.${shotId}.${field}`;

const draftString = (drafts: UseWorkspaceDraftsResult, key: string, fallback: string): string => {
  const value = drafts.value(key);
  return typeof value === 'string' ? value : fallback;
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
  referenceBinding: NonNullable<BeatPanelProps['referenceBindings']>[number] | null;
  referenceMaxConditioningImages: number | null;
  /** Set when a duration blocker's remedy points at this Shot, so the hidden field is revealed. */
  revealDuration: boolean;
  /** A duration blocker can point at a downstream Shot, so the reveal is raised to the Beat. */
  onRevealDuration: (shotId: string) => void;
  focusShootingScript: boolean;
  onShootingScriptFocused: () => void;
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
  onRevealDuration,
  focusShootingScript,
  onShootingScriptFocused,
  reviewBlocked,
  reviewGraph,
  referenceBinding,
  referenceMaxConditioningImages,
  revealDuration,
  shot,
}) => {
  const { t } = useTranslation();
  const draftsRef = useLatestDrafts(drafts);
  const [saving, setSaving] = useState(false);
  const [lifting, setLifting] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [recoveringJobId, setRecoveringJobId] = useState<string | null>(null);
  const [firstFramePickerOpen, setFirstFramePickerOpen] = useState(false);
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
  // Planned duration leaves the Shot editor and is revealed from that Shot's overflow menu.
  const [durationOpen, setDurationOpen] = useState(false);
  const durationFieldRef = useRef<HTMLLabelElement | null>(null);
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
  const chainState =
    index === 0
      ? 'segment_head'
      : shot.segmentHead
        ? shot.chainBreak === 'hard_cut'
          ? 'hard_cut'
          : 'segment_head'
        : 'continuous';

  const save = async (): Promise<boolean> => {
    if (!dirty) return true;
    if (saving || disabled || drafts.staleRevision) return false;
    const submitted = [
      [shootingScriptKey, shootingScript],
      [durationKey, durationSeconds],
    ] as const;
    const changes: Partial<Record<'shootingScript' | 'durationSeconds', string | number>> = {};
    if (shootingScript !== shot.shootingScript) changes.shootingScript = shootingScript;
    if (durationSeconds !== shot.durationSeconds) changes.durationSeconds = durationSeconds;
    if (Object.keys(changes).length === 0) {
      submitted.forEach(([key, value]) => draftsRef.current.resetIfValue(key, value));
      return true;
    }
    setSaving(true);
    try {
      const saved = await actions.saveShot([{ shotId: shot.id, changes: changes as StudioEditableShotChanges }]);
      if (saved) submitted.forEach(([key, value]) => draftsRef.current.resetIfValue(key, value));
      return saved;
    } finally {
      setSaving(false);
    }
  };

  const reset = (): void => {
    draftKeys.forEach(drafts.reset);
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
  useEffect(() => {
    if (revealDuration) setDurationOpen(true);
  }, [revealDuration]);

  useEffect(() => {
    if (!focusShootingScript || hidden || disabled) return;
    const field = shotCardRef.current?.querySelector<HTMLTextAreaElement>(
      'textarea[data-shot-field="shooting-script"]'
    );
    if (field === undefined || field === null) return;
    field.focus({ preventScroll: true });
    if (document.activeElement !== field) return;
    field.scrollIntoView?.({ behavior: 'smooth', block: 'center', inline: 'nearest' });
    onShootingScriptFocused();
  }, [disabled, focusShootingScript, hidden, onShootingScriptFocused]);

  useEffect(() => {
    if (!durationOpen) return;
    durationFieldRef.current?.querySelector('input')?.focus();
  }, [durationOpen]);

  const shotMenu = (
    <Menu data-shot-id={shot.id} data-shot-overflow-menu>
      <Menu.Item
        key='move-earlier'
        data-shot-move-earlier
        disabled={disabled || !canMovePrevious}
        onClick={() => onMove(index, -1)}
      >
        {t(`${KEY_ROOT}.reorder.previous`, { index: index + 1 })}
      </Menu.Item>
      <Menu.Item
        key='move-later'
        data-shot-move-later
        disabled={disabled || !canMoveNext}
        onClick={() => onMove(index, 1)}
      >
        {t(`${KEY_ROOT}.reorder.next`, { index: index + 1 })}
      </Menu.Item>
      <Menu.Item
        key='save-shot'
        data-shot-save
        disabled={disabled || drafts.staleRevision || saving || !dirty}
        onClick={() => void save()}
      >
        {t(`${KEY_ROOT}.common.saveShot`)}
      </Menu.Item>
      <Menu.Item key='reset-shot' data-shot-reset disabled={disabled || saving || !dirty} onClick={reset}>
        {t(`${KEY_ROOT}.common.resetShot`)}
      </Menu.Item>
      <Menu.Item
        key='planned-duration'
        data-shot-duration-reveal
        disabled={disabled}
        onClick={() => setDurationOpen(true)}
      >
        {t(`${KEY_ROOT}.fields.duration`)}
      </Menu.Item>
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
  const conditioningFailure = projection.conditioningFailures.find((failure) => failure.dependentShotId === shot.id);
  const {
    word: composerStatus,
    stale: composerStatusStale,
    latestAttemptFailed: composerLatestAttemptFailed,
  } = deriveWorkspaceShotStatus(shot, conditioningFailure !== undefined);
  const effectiveFrame = shot.firstFrames.find((frame) => frame.effectiveSeed) ?? null;
  const effectiveFrameUrl =
    effectiveFrame === null ? null : createManagedStudioAssetUrl(projectId, effectiveFrame.assetId);
  const referenceCount =
    referenceBinding === null
      ? 0
      : referenceBinding.characterReferenceIds.length + (referenceBinding.backgroundReferenceId === null ? 0 : 1);
  const referenceLimit = referenceMaxConditioningImages;
  const promptChanged =
    shot.currentPicture !== null &&
    (shot.currentPicture.prompt !== shootingScript ||
      shot.currentPicture.promptChanged ||
      shot.currentPicture.firstFrameChanged);
  const cascadeRow = projection.cascadeProgress.find((row) => row.dependentShotId === shot.id) ?? null;
  const generationDisabled =
    disabled ||
    reviewBlocked ||
    reviewedGenerationBlocked ||
    reviewPreferences === null ||
    reviewBlock !== null ||
    shot.seedAuthorizationLock !== null;
  const generateVideo = async (): Promise<void> => {
    if (generationDisabled || reviewPreferences === null || reviewPreferences.length === 0) return;
    if (!(await save())) return;
    actions.reviewShot(shot.id, reviewPreferences as [BeatPanelReviewChoice, ...BeatPanelReviewChoice[]]);
  };
  const regenerateFrame = async (): Promise<void> => {
    if (disabled || reviewBlocked || !shot.segmentHead || shot.seedAuthorizationLock !== null) return;
    if (!(await save())) return;
    actions.reviewSeedStill(shot.id);
  };
  const cancelComposerRun = async (): Promise<void> => {
    if (shot.activeGenerationJob?.canCancel) {
      await actions.cancelGenerationJob(shot.activeGenerationJob.id);
      return;
    }
    if (cascadeRow?.canCancelWaiting) await actions.cancelWaiting(shot.id);
  };
  const composerAction = async (): Promise<void> => {
    if (composerStatus === 'rendering' || composerStatus === 'queued') {
      await cancelComposerRun();
      return;
    }
    if (conditioningFailure !== undefined) {
      await actions.retryConditioning(shot.id);
      return;
    }
    await generateVideo();
  };
  const composerActionDisabled =
    composerStatus === 'notReady' ||
    (conditioningFailure !== undefined
      ? disabled || !conditioningFailure.canRetry
      : composerStatus === 'rendering' || composerStatus === 'queued'
        ? disabled || (shot.activeGenerationJob?.canCancel !== true && cascadeRow?.canCancelWaiting !== true)
        : generationDisabled);
  const composerActionKey =
    composerStatus === 'rendering'
      ? 'cancelRun'
      : composerStatus === 'queued'
        ? 'removeFromChain'
        : conditioningFailure !== undefined
          ? 'fixStartFrame'
          : composerStatus === 'failed'
            ? 'tryAgain'
            : composerStatus === 'rendered'
              ? 'regenerate'
              : 'generate';
  const composerFootnoteKey =
    composerStatus === 'notReady'
      ? 'startRequired'
      : composerStatus === 'queued'
        ? 'startArrives'
        : composerStatus === 'rendering'
          ? 'promptAsFired'
          : conditioningFailure !== undefined
            ? 'startFrameFailed'
            : composerStatus === 'rendered' && index < beat.shots.length - 1
              ? 'lastFrameStartsNext'
              : composerStatus === 'failed'
                ? 'engineFailed'
                : null;
  return (
    <article
      ref={shotCardRef}
      className={styles.shotCard}
      data-composer-status={composerStatus}
      data-composer-status-latest-attempt-failed={composerLatestAttemptFailed}
      data-composer-status-stale={composerStatusStale}
      data-shot-card
      data-shot-id={shot.id}
      hidden={hidden}
    >
      <header className={styles.shotHeader} data-composer-row='identity' data-shot-header>
        <span className={styles.onTag}>{t(`${KEY_ROOT}.firstFrames.on`)}</span>
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
        <span
          className={styles.shotStatus}
          data-composer-status-word={composerStatus}
          data-latest-attempt-failed={composerLatestAttemptFailed}
          data-stale={composerStatusStale}
        >
          {t(`conversation.creativeStudio.workspace.shotStatus.${composerStatus}`)}
          {composerStatus === 'rendering' && shot.generationProgressPercent !== null
            ? ` · ${Math.round(shot.generationProgressPercent)}%`
            : ''}
          {composerLatestAttemptFailed
            ? ` · ${t('conversation.creativeStudio.workspace.shotStatus.latestAttemptFailed')}`
            : ''}
        </span>
        <div className={styles.actions}>
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
              disabled={disabled || lifting}
              icon={<MoreOne aria-hidden='true' />}
              loading={lifting}
              shape='circle'
              size='small'
              type='text'
            />
          </Dropdown>
        </div>
      </header>

      <div className={styles.framesHeader} data-composer-row='frames'>
        <span>
          {t(`${KEY_ROOT}.composer.framesSet`, { count: (effectiveFrame === null ? 0 : 1) + referenceCount })}
        </span>
        <Button
          disabled={disabled || !shot.segmentHead || shot.seedAuthorizationLock !== null}
          onClick={() => {
            setFirstFramePickerOpen(true);
            void actions.importSeedStill(shot.id);
          }}
          size='mini'
        >
          {t(`${KEY_ROOT}.firstFrames.import`)}
        </Button>
      </div>

      <div className={styles.frameSlots}>
        <button
          aria-expanded={firstFramePickerOpen}
          className={styles.frameSlot}
          data-composer-start-slot
          data-composer-row='start-slot'
          data-filled={effectiveFrame === null ? 'false' : 'true'}
          onClick={() => setFirstFramePickerOpen((open) => !open)}
          type='button'
        >
          {effectiveFrameUrl === null ? (
            <span className={styles.emptySlotCopy}>▣ {t(`${KEY_ROOT}.composer.start`)}</span>
          ) : (
            <img alt={t(`${KEY_ROOT}.composer.startPreview`)} src={effectiveFrameUrl} />
          )}
          <span className={styles.slotBadge}>
            {effectiveFrame?.origin === 'inherited' && effectiveFrame.sourceShotNumber !== null
              ? t(`${KEY_ROOT}.composer.fromShot`, { shot: effectiveFrame.sourceShotNumber })
              : t(`${KEY_ROOT}.composer.start`)}
          </span>
        </button>
        <button
          aria-describedby={`${generationBlockDescriptionId}-end-frame`}
          className={styles.frameSlot}
          data-composer-end-slot
          data-composer-row='end-slot'
          disabled
          type='button'
        >
          <span className={styles.emptySlotCopy}>▣ {t(`${KEY_ROOT}.composer.end`)}</span>
          <span className={styles.slotBadge}>{t(`${KEY_ROOT}.composer.end`)}</span>
          <span className={styles.slotReason} id={`${generationBlockDescriptionId}-end-frame`}>
            {t(`${KEY_ROOT}.composer.endUnavailable`)}
          </span>
        </button>
        <button
          className={styles.frameSlot}
          data-composer-reference-slot
          data-composer-row='references-slot'
          data-filled={referenceCount === 0 ? 'false' : 'true'}
          onClick={() => actions.reviewReferences(shot.id)}
          type='button'
        >
          <span className={styles.emptySlotCopy}>▣ {t(`${KEY_ROOT}.composer.references`)}</span>
          <span className={styles.slotBadge}>
            {t(`${KEY_ROOT}.composer.referencesBudget`, {
              count: referenceCount,
              limit: referenceLimit === null ? '—' : referenceLimit,
            })}
          </span>
        </button>
      </div>

      {firstFramePickerOpen && !hidden ? (
        <FirstFrames
          actions={actions}
          disabled={disabled}
          generationDescriptionId={reviewBlockCopy === null ? undefined : generationBlockDescriptionId}
          generateVideoDisabled={generationDisabled}
          importDisabled={!shot.segmentHead || shot.seedAuthorizationLock !== null}
          onGenerateVideo={generateVideo}
          onImport={() => actions.importSeedStill(shot.id)}
          onPromptChange={(value) => drafts.setValue(shootingScriptKey, value)}
          onRegenerateFrame={regenerateFrame}
          onSendLastFrame={
            beat.shots[index + 1]?.chainBreak === 'hard_cut'
              ? () => actions.reviewContinuity(beat.shots[index + 1]!.id, false)
              : null
          }
          projectId={projectId}
          prompt={shootingScript}
          shot={shot}
          shotIndex={index}
          showGenerationAction={false}
        />
      ) : null}

      <Input.TextArea
        aria-label={t(`${KEY_ROOT}.fields.shootingScriptFor`, { index: index + 1 })}
        autoSize={{ minRows: 2, maxRows: 2 }}
        className={styles.shotPromptInput}
        data-composer-row='prompt'
        data-shot-field='shooting-script'
        disabled={disabled}
        onChange={(value) => drafts.setValue(shootingScriptKey, value)}
        placeholder={t(`${KEY_ROOT}.composer.promptPlaceholder`)}
        value={shootingScript}
      />

      <div className={styles.composerActionRow} data-composer-row='action'>
        <span
          className={styles.composerAttentionTag}
          data-visible={promptChanged || composerStatus === 'failed' || conditioningFailure !== undefined}
        >
          {conditioningFailure !== undefined
            ? t(`${KEY_ROOT}.composer.tag.startFrameFailed`)
            : composerStatus === 'failed'
              ? t(`${KEY_ROOT}.composer.tag.notCharged`)
              : promptChanged
                ? t(`${KEY_ROOT}.firstFrames.promptChanged`)
                : ''}
        </span>
        <Button
          aria-describedby={reviewBlockCopy === null ? undefined : generationBlockDescriptionId}
          className={styles.composerAction}
          data-action-kind={composerActionKey}
          disabled={composerActionDisabled}
          onClick={() => void composerAction()}
          type={
            composerStatus === 'rendered' && !promptChanged && conditioningFailure === undefined
              ? 'secondary'
              : 'primary'
          }
        >
          {t(`${KEY_ROOT}.composer.action.${composerActionKey}`, { shot: index + 1 })}
        </Button>
      </div>

      <p
        aria-hidden={composerFootnoteKey === null}
        className={styles.composerFootnote}
        data-composer-row='footnote'
        data-visible={composerFootnoteKey === null ? 'false' : 'true'}
      >
        {composerFootnoteKey === null
          ? '\u00a0'
          : t(`${KEY_ROOT}.composer.footnote.${composerFootnoteKey}`, {
              next: index + 2,
              previous: Math.max(1, index),
            })}
      </p>

      {shot.dirtyCauses.includes('continuity_stale') && shot.chainBreak !== 'hard_cut' ? (
        <p className={styles.warning}>{t(`${KEY_ROOT}.chain.systemContinuityStale`)}</p>
      ) : null}
      {shot.dirtyCauses.includes('generation_out_of_date') ? (
        <p className={styles.warning}>{t(`${KEY_ROOT}.chain.generationOutOfDate`)}</p>
      ) : null}

      <div className={styles.editorGrid}>
        {durationOpen ? (
          <label data-shot-duration-field ref={durationFieldRef}>
            <span>{t(`${KEY_ROOT}.fields.duration`)}</span>
            <InputNumber
              aria-label={t(`${KEY_ROOT}.fields.durationFor`, { index: index + 1 })}
              disabled={disabled}
              max={STUDIO_MAX_SHOT_SECONDS}
              min={STUDIO_MIN_SHOT_SECONDS}
              onChange={(value) => {
                if (typeof value === 'number' && Number.isSafeInteger(value)) drafts.setValue(durationKey, value);
              }}
              precision={0}
              value={durationSeconds}
            />
          </label>
        ) : null}
      </div>
      {shot.seedAuthorizationLock !== null ? (
        <Alert content={t(`${KEY_ROOT}.seeds.authorizationLocked`)} showIcon type='warning' />
      ) : null}
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
                  onRevealDuration(blockedShotId);
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
  aspectRatio,
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
  referenceBindings = [],
  referenceMaxConditioningImages = null,
  onParkShotSuccess,
  onSelectBeat,
  onClose,
  shotEditFocusIntent = null,
  onShotEditFocusIntentConsumed,
  actions,
}) => {
  const { t } = useTranslation();
  const draftsRef = useLatestDrafts(drafts);
  const [savingBeat, setSavingBeat] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [reorderAnnouncement, setReorderAnnouncement] = useState('');
  const [shotLiftAnnouncement, setShotLiftAnnouncement] = useState('');
  const beatMenuTriggerRef = useRef<HTMLButtonElement | null>(null);
  // Story is context for this screen rather than its work: it reads on hover and opens to edit.
  const [storyOpen, setStoryOpen] = useState(false);
  const storyFieldRef = useRef<HTMLLabelElement | null>(null);
  // A duration blocker's remedy may point at a downstream Shot, so the reveal lives at Beat level.
  const [durationRevealShotId, setDurationRevealShotId] = useState<string | null>(null);
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
  const consumedShotEditFocusIntentRef = useRef<{ projectId: string; intentId: string } | null>(null);
  const storyKey = beatDraftKey(beat.id);
  const story = draftString(drafts, storyKey, beat.story);
  const beatDraftKeys = [storyKey] as const;
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
  const shotEditFocusTargetId =
    shotEditFocusIntent !== null &&
    shotEditFocusIntent.projectId === projectId &&
    shotEditFocusIntent.beatId === beat.id &&
    shotEditFocusIntent.shotIds.length > 0 &&
    shotEditFocusIntent.shotIds.every((shotId) => beat.shots.some((shot) => shot.id === shotId))
      ? (shotEditFocusIntent.shotIds[0] ?? null)
      : null;

  useLayoutEffect(() => {
    if (
      shotEditFocusIntent === null ||
      (consumedShotEditFocusIntentRef.current !== null &&
        consumedShotEditFocusIntentRef.current.projectId !== projectId)
    ) {
      consumedShotEditFocusIntentRef.current = null;
    }
  }, [projectId, shotEditFocusIntent]);

  useEffect(() => {
    if (shotEditFocusTargetId === null) return;
    setInspectedShotSelection({ beatId: beat.id, shotId: shotEditFocusTargetId });
  }, [beat.id, shotEditFocusTargetId]);

  const consumeShotEditFocus = useCallback((): void => {
    if (
      shotEditFocusIntent === null ||
      shotEditFocusIntent.projectId !== projectId ||
      shotEditFocusIntent.beatId !== beat.id ||
      shotEditFocusTargetId === null ||
      inspectedShotId !== shotEditFocusTargetId ||
      (consumedShotEditFocusIntentRef.current?.projectId === projectId &&
        consumedShotEditFocusIntentRef.current.intentId === shotEditFocusIntent.id)
    ) {
      return;
    }
    consumedShotEditFocusIntentRef.current = { projectId, intentId: shotEditFocusIntent.id };
    onShotEditFocusIntentConsumed?.(shotEditFocusIntent.id);
  }, [beat.id, inspectedShotId, onShotEditFocusIntentConsumed, projectId, shotEditFocusIntent, shotEditFocusTargetId]);
  const chainRunning = beat.shots.some(
    (shot) =>
      shot.videoGenerationInFlight ||
      shot.segmentState.kind === 'queued' ||
      shot.segmentState.kind === 'waiting_on_shot' ||
      shot.segmentState.kind === 'waiting_on_frame'
  );
  const chainTriggerShot =
    beat.shots.find(
      (shot) =>
        shot.currentPicture === null ||
        shot.dirtyCauses.includes('generation_out_of_date') ||
        shot.dirtyCauses.includes('continuity_stale')
    ) ?? null;
  const chainReviewGraph =
    chainTriggerShot === null
      ? null
      : exactReviewGraph(
          projection,
          reviewGraphs,
          chainTriggerShot.id,
          chainTriggerShot.segmentHead && chainTriggerShot.effectiveSeedAssetId === null ? 'seed_still' : 'video_take'
        );
  const chainShotCount =
    chainReviewGraph === null ? 0 : new Set(chainReviewGraph.choices.map((choice) => choice.shotId)).size;
  const chainCancelableJob =
    beat.shots.map((shot) => shot.activeGenerationJob).find((job) => job?.canCancel === true) ?? null;
  const chainCancelableWait =
    projection.cascadeProgress.find(
      (row) => beat.shots.some((shot) => shot.id === row.dependentShotId) && row.canCancelWaiting
    ) ?? null;

  const runOrStopChain = (): void => {
    if (chainRunning) {
      if (chainCancelableWait !== null) {
        void actions.cancelWaiting(chainCancelableWait.dependentShotId);
      } else if (chainCancelableJob !== null) {
        void actions.cancelGenerationJob(chainCancelableJob.id);
      }
      return;
    }
    if (chainTriggerShot === null || chainReviewGraph === null) return;
    actions.reviewShot(
      chainTriggerShot.id,
      chainReviewGraph.choices.map((choice) => ({ ...choice })) as [BeatPanelReviewChoice, ...BeatPanelReviewChoice[]]
    );
  };

  const inspectShot = (shotId: string): void => {
    if (!beat.shots.some((shot) => shot.id === shotId)) return;
    setInspectedShotSelection({ beatId: beat.id, shotId });
  };

  const saveBeat = async (): Promise<void> => {
    if (!beatDirty || savingBeat || mutationLocked || drafts.staleRevision) return;
    const submitted = [[storyKey, story]] as const;
    if (story === beat.story) {
      submitted.forEach(([key, value]) => draftsRef.current.resetIfValue(key, value));
      return;
    }
    setSavingBeat(true);
    try {
      const saved = await actions.saveBeat(beat.id, { story });
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
        key='save-beat'
        data-beat-save
        disabled={mutationLocked || drafts.staleRevision || savingBeat || !beatDirty}
        onClick={() => void saveBeat()}
      >
        {t(`${KEY_ROOT}.common.saveBeat`)}
      </Menu.Item>
      <Menu.Item
        key='reset-beat'
        data-beat-reset
        disabled={mutationLocked || savingBeat || !beatDirty}
        onClick={() => beatDraftKeys.forEach(drafts.reset)}
      >
        {t(`${KEY_ROOT}.common.resetBeat`)}
      </Menu.Item>
      <Menu.Item
        key='resplit'
        data-beat-resplit
        disabled={mutationLocked}
        onClick={() => actions.requestResplit(beat.id)}
      >
        {t(`${KEY_ROOT}.coverage.reviewResplit`)}
      </Menu.Item>
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
    // A Beat that cannot be lifted still has a reachable menu; only the pending park confirmation
    // is retracted. Closing the menu here would hide Save exactly while drafts are dirty.
    if (!beatLiftAllowed) {
      confirmationHandleRef.current?.close();
      confirmationHandleRef.current = null;
    }
    if (mutationLocked) setMenuOpen(false);
  }, [beatLiftAllowed, mutationLocked]);

  useEffect(() => {
    if (!storyOpen) return;
    storyFieldRef.current?.querySelector('textarea')?.focus();
  }, [storyOpen]);

  useEffect(() => {
    setStoryOpen(false);
    setDurationRevealShotId(null);
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
      <section
        aria-label={t(`${KEY_ROOT}.label`, { title: beatTitle })}
        className={styles.root}
        data-aspect-ratio={aspectRatio}
      >
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
              aria-expanded={storyOpen}
              aria-label={t(`${KEY_ROOT}.fields.story`)}
              data-beat-story-toggle
              icon={<Notes aria-hidden='true' />}
              onClick={() => setStoryOpen((open) => !open)}
              shape='circle'
              title={story}
              type='text'
            />
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
                disabled={mutationLocked}
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

        {!storyOpen ? null : (
          <section aria-label={t(`${KEY_ROOT}.beatFieldsLabel`)} className={styles.beatEditor}>
            <label className={styles.beatField} data-beat-field='story' ref={storyFieldRef}>
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
          </section>
        )}

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
                  onRevealDuration={setDurationRevealShotId}
                  focusShootingScript={shot.id === shotEditFocusTargetId && shot.id === inspectedShotId}
                  onShootingScriptFocused={consumeShotEditFocus}
                  revealDuration={durationRevealShotId === shot.id}
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
                  referenceBinding={referenceBindings.find((binding) => binding.shotId === shot.id) ?? null}
                  referenceMaxConditioningImages={referenceMaxConditioningImages}
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
            <section className={styles.shotStrip} data-chain-running={chainRunning} data-shot-strip>
              <header className={styles.shotStripHeader}>
                <h3>{t(`${KEY_ROOT}.shots.label`)}</h3>
                <span>
                  {t(chainRunning ? `${KEY_ROOT}.composer.chain.runningRule` : `${KEY_ROOT}.composer.chain.rule`)}
                </span>
                <Button
                  className={styles.chainAction}
                  data-chain-action
                  disabled={
                    mutationLocked ||
                    drafts.staleRevision ||
                    coverageDraftDirty ||
                    (chainRunning
                      ? chainCancelableJob === null && chainCancelableWait === null
                      : chainReviewGraph === null || chainReviewGraph.block !== null || chainShotCount === 0)
                  }
                  onClick={runOrStopChain}
                  type={chainRunning ? 'secondary' : 'primary'}
                >
                  {chainRunning
                    ? t(`${KEY_ROOT}.composer.chain.stop`)
                    : t(`${KEY_ROOT}.composer.chain.generate`, { count: chainShotCount })}
                </Button>
              </header>
              <div className={styles.shotChips}>
                {beat.shots.map((shot, index) => {
                  const { word: composerStatus } = deriveWorkspaceShotStatus(
                    shot,
                    projection.conditioningFailures.some((failure) => failure.dependentShotId === shot.id)
                  );
                  return (
                    <React.Fragment key={shot.id}>
                      {index === 0 ? null : (
                        <>
                          <Button
                            aria-describedby={`${shot.id}-chain-change-description`}
                            aria-haspopup='dialog'
                            aria-label={t(
                              shot.chainBreak === 'hard_cut'
                                ? `${KEY_ROOT}.chain.reviewRejoin`
                                : `${KEY_ROOT}.chain.reviewSever`
                            )}
                            className={styles.joinButton}
                            data-chain-change-intent={shot.chainBreak === 'hard_cut' ? 'rejoin' : 'sever'}
                            data-chain-change-trigger
                            data-shot-id={shot.id}
                            disabled={
                              mutationLocked ||
                              drafts.staleRevision ||
                              coverageDraftDirty ||
                              reviewBlockedMessageKey !== null ||
                              shot.seedAuthorizationLock !== null
                            }
                            onClick={() => actions.reviewContinuity(shot.id, shot.chainBreak !== 'hard_cut')}
                            size='mini'
                          >
                            ×
                          </Button>
                          <span className={styles.srOnly} id={`${shot.id}-chain-change-description`}>
                            {t(
                              shot.chainBreak === 'hard_cut'
                                ? `${KEY_ROOT}.chain.reviewRejoinDescription`
                                : `${KEY_ROOT}.chain.reviewSeverDescription`,
                              { shot: index + 1, previous: index }
                            )}
                          </span>
                        </>
                      )}
                      <button
                        aria-pressed={shot.id === inspectedShotId}
                        className={styles.shotChip}
                        data-active={shot.id === inspectedShotId}
                        data-shot-id={shot.id}
                        onClick={() => inspectShot(shot.id)}
                        type='button'
                      >
                        <span>{t(`${KEY_ROOT}.shots.heading`, { index: index + 1 })}</span>
                        {shot.id === inspectedShotId ? <b>{t(`${KEY_ROOT}.firstFrames.on`)}</b> : null}
                        <small>{t(`conversation.creativeStudio.workspace.shotStatus.${composerStatus}`)}</small>
                      </button>
                    </React.Fragment>
                  );
                })}
              </div>
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
            </section>
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
