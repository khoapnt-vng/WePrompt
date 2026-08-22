/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Alert, Button, Checkbox, Input, InputNumber, Modal, Popconfirm, Select } from '@arco-design/web-react';
import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  STUDIO_LOOK_SOFT_WORD_LIMIT,
  STUDIO_MAX_GENERATIONS_PER_SHOT_PER_SUBMISSION,
  type StudioCascadeProgressV2,
  type StudioEditableBeatChanges,
  type StudioEditableShotChanges,
  type StudioRendererParkBlockerCodeV2,
  type StudioRendererParkEligibilityV2,
} from '@/common/types/project/creativeStudioTypes';
import { createManagedStudioAssetUrl } from '@/renderer/pages/studio/studioManagedAssetUrl';

import type { UseWorkspaceDraftsResult } from '../useWorkspaceDrafts';
import type {
  WorkspaceBeatProjection,
  WorkspaceProjection,
  WorkspaceShotProjection,
  WorkspaceTakeProjection,
} from '../workspaceProjection';
import styles from './BeatPanel.module.css';
import { BeatPlayer } from './BeatPlayer';
import { CoverageBar } from './CoverageBar';
import { COVERAGE_MIN_PLAYED_SECONDS, type CoveragePlanningPairChange } from './coverageGeometry';

const KEY_ROOT = 'conversation.creativeStudio.workspace.beatPanel';
const JOB_KEY_ROOT = 'conversation.creativeStudio.jobs';

export type BeatPanelImportResult = 'cancelled' | 'imported' | 'failed';

export type BeatPanelGenerationCount = 1 | 2 | 3 | 4;

export type BeatPanelReviewPreference = {
  purpose: 'seed_still' | 'video_take';
  generationCount: BeatPanelGenerationCount;
  referenceAssetId: string | null;
};

export type BeatPanelReviewChoiceIdentity = Pick<BeatPanelReviewPreference, 'purpose'> & {
  shotId: string;
};

export type BeatPanelReviewChoice = BeatPanelReviewChoiceIdentity &
  Pick<BeatPanelReviewPreference, 'generationCount' | 'referenceAssetId'>;

export type BeatPanelReviewGraph = {
  triggerShotId: string;
  choices: readonly [BeatPanelReviewChoiceIdentity, ...BeatPanelReviewChoiceIdentity[]];
};

export type BeatPanelBriefReferenceOption = {
  assetId: string;
  label: string;
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
  redetachLine: (shotId: string, line: string) => Promise<boolean>;
  restoreLine: (shotId: string, historyEntryId: string) => Promise<boolean>;
  importSeedStill: (shotId: string) => Promise<BeatPanelImportResult>;
  selectTake: (shotId: string, assetId: string) => Promise<boolean>;
  parkTake: (shotId: string, assetId: string) => Promise<boolean>;
  addAlternateTake: (shotId: string, assetId: string) => Promise<boolean>;
  restoreTake: (shotId: string, assetId: string) => Promise<boolean>;
  parkShot: (shotId: string, onCommitted?: () => void) => Promise<boolean>;
  parkBeat: (beatId: string) => Promise<boolean>;
  reviewShot: (triggerShotId: string, choices: readonly [BeatPanelReviewChoice, ...BeatPanelReviewChoice[]]) => void;
  retryGenerationJob: (jobId: string, acknowledgePossibleDuplicateCharge: boolean) => Promise<boolean>;
  cancelGenerationJob: (jobId: string) => Promise<boolean>;
  chooseCascadeAsset: (row: StudioCascadeProgressV2, assetId: string) => Promise<boolean>;
  retryConditioning: (dependentShotId: string) => Promise<boolean>;
  cancelWaiting: (dependentShotId: string) => Promise<boolean>;
  requestReviewedRederive: (shotId: string) => void;
  requestResplit: (beatId: string) => void;
};

export type BeatPanelProps = {
  projectId: string;
  beat: WorkspaceBeatProjection;
  beatIds: readonly string[];
  beatIndex: number;
  projection: WorkspaceProjection;
  drafts: UseWorkspaceDraftsResult;
  briefReferenceOptions: readonly BeatPanelBriefReferenceOption[];
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

const beatDraftKey = (beatId: string, field: 'action' | 'look' | 'targetSeconds'): string => `beat.${beatId}.${field}`;

const shotDraftKey = (shotId: string, field: 'line' | 'narration' | 'onScreenText' | 'durationSeconds'): string =>
  `shot.${shotId}.${field}`;

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

const wordCount = (value: string): number => {
  const trimmed = value.trim();
  return trimmed.length === 0 ? 0 : trimmed.split(/\s+/u).length;
};

type GatePreferenceRecord = Record<string, Pick<BeatPanelReviewPreference, 'generationCount' | 'referenceAssetId'>>;

const SAFE_STUDIO_ID = /^[A-Za-z0-9_-]{1,256}$/;

const isGenerationCount = (value: unknown): value is BeatPanelGenerationCount =>
  typeof value === 'number' &&
  Number.isSafeInteger(value) &&
  value >= 1 &&
  value <= STUDIO_MAX_GENERATIONS_PER_SHOT_PER_SUBMISSION;

const parseGatePreferences = (value: unknown): GatePreferenceRecord => {
  if (typeof value !== 'string') return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    const result: GatePreferenceRecord = Object.create(null) as GatePreferenceRecord;
    for (const [key, candidate] of Object.entries(parsed)) {
      const keyMatch = /^([A-Za-z0-9_-]{1,256}):(seed_still|video_take)$/.exec(key);
      if (keyMatch === null || typeof candidate !== 'object' || candidate === null) continue;
      const row = candidate as Record<string, unknown>;
      if (
        !isGenerationCount(row.generationCount) ||
        (row.referenceAssetId !== null &&
          (typeof row.referenceAssetId !== 'string' || !SAFE_STUDIO_ID.test(row.referenceAssetId))) ||
        (keyMatch[2] === 'video_take' && row.referenceAssetId !== null)
      ) {
        continue;
      }
      result[key] = {
        generationCount: row.generationCount,
        referenceAssetId: row.referenceAssetId as string | null,
      };
    }
    return result;
  } catch {
    return {};
  }
};

const exactBriefReferenceOptions = (
  options: readonly BeatPanelBriefReferenceOption[]
): BeatPanelBriefReferenceOption[] => {
  const counts = new Map<string, number>();
  options.forEach(({ assetId }) => counts.set(assetId, (counts.get(assetId) ?? 0) + 1));
  return options.flatMap((option) =>
    SAFE_STUDIO_ID.test(option.assetId) && option.label.trim().length > 0 && counts.get(option.assetId) === 1
      ? [{ assetId: option.assetId, label: option.label.trim() }]
      : []
  );
};

const reviewPreferenceKey = (shotId: string, purpose: BeatPanelReviewPreference['purpose']): string =>
  `${shotId}:${purpose}`;

const exactEligibility = (
  projection: WorkspaceProjection,
  identity: Pick<StudioRendererParkEligibilityV2, 'subject' | 'action' | 'beatId' | 'shotId' | 'assetId'>
): StudioRendererParkEligibilityV2 | null => {
  if (!projection.workspaceStatusReady) return null;
  const matches = projection.parkEligibility.filter(
    (row) =>
      row.subject === identity.subject &&
      row.action === identity.action &&
      row.beatId === identity.beatId &&
      row.shotId === identity.shotId &&
      row.assetId === identity.assetId
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
): BeatPanelReviewGraph['choices'] | null => {
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
  return choices;
};

type RecoveryChoice = {
  mediaKind: WorkspaceTakeProjection['mediaKind'];
  shotPosition: ShotPosition;
  takeIndex: number;
};

const videoTakeFitsShotTrims = (shot: WorkspaceShotProjection, take: WorkspaceTakeProjection): boolean => {
  if (take.mediaKind !== 'video') return false;
  const duration = take.sourceDurationSeconds;
  const trimIn = shot.trimInSeconds ?? 0;
  const trimOut = shot.trimOutSeconds ?? 0;
  return (
    duration !== null &&
    Number.isFinite(duration) &&
    duration > 0 &&
    Number.isFinite(trimIn) &&
    trimIn >= 0 &&
    Number.isFinite(trimOut) &&
    trimOut >= 0 &&
    trimIn < duration &&
    trimOut < duration &&
    duration - trimIn - trimOut >= COVERAGE_MIN_PLAYED_SECONDS
  );
};

const exactRecoveryChoice = (
  projection: WorkspaceProjection,
  row: StudioCascadeProgressV2,
  assetId: string
): RecoveryChoice | null => {
  if (
    row.eligiblePrimaryAssetIds.filter((eligibleId) => eligibleId === assetId).length !== 1 ||
    (row.waitingReason !== 'choose_seed' &&
      row.waitingReason !== 'choose_take' &&
      row.waitingReason !== 'conditioning_failed')
  ) {
    return null;
  }
  const upstreamMatches = projection.activeBeats.flatMap((beat, beatIndex) =>
    beat.shots.flatMap((shot, shotIndex) =>
      shot.id === row.upstreamShotId ? [{ shot, shotPosition: { beatIndex, shotIndex } }] : []
    )
  );
  if (upstreamMatches.length !== 1) return null;
  const [{ shot, shotPosition }] = upstreamMatches;
  const candidates: Array<{ take: WorkspaceTakeProjection; takeIndex: number }> =
    row.waitingReason === 'choose_seed'
      ? shot.imageTakes.map((take, takeIndex) => ({ take, takeIndex }))
      : shot.videoTakes.map((take, takeIndex) => ({ take, takeIndex }));
  const matches = candidates.flatMap(({ take, takeIndex }) => {
    if (
      take.assetId !== assetId ||
      take.binReason !== null ||
      (row.waitingReason === 'conditioning_failed' && take.selected)
    ) {
      return [];
    }
    if (take.mediaKind === 'video' && !videoTakeFitsShotTrims(shot, take)) return [];
    return [{ mediaKind: take.mediaKind, shotPosition, takeIndex }];
  });
  return matches.length === 1 ? matches[0]! : null;
};

const BLOCKER_KEYS = {
  current_match_to: `${KEY_ROOT}.blocker.currentMatchTo`,
  own_nonterminal_job: `${KEY_ROOT}.blocker.ownNonterminalJob`,
  own_pending_frame: `${KEY_ROOT}.blocker.ownPendingFrame`,
  downstream_nonterminal_job: `${KEY_ROOT}.blocker.downstreamNonterminalJob`,
  downstream_pending_frame: `${KEY_ROOT}.blocker.downstreamPendingFrame`,
  waiting_authorization_dependency: `${KEY_ROOT}.blocker.waitingAuthorizationDependency`,
  bound_nonterminal_request: `${KEY_ROOT}.blocker.boundNonterminalRequest`,
  current_selected_take: `${KEY_ROOT}.blocker.currentSelectedTake`,
  current_seed_still: `${KEY_ROOT}.blocker.currentSeedStill`,
  nonterminal_conditioning_use: `${KEY_ROOT}.blocker.nonterminalConditioningUse`,
  take_bin_capacity_reached: `${KEY_ROOT}.blocker.takeBinCapacityReached`,
  beat_shot_capacity_reached: `${KEY_ROOT}.blocker.beatShotCapacityReached`,
} as const satisfies Record<StudioRendererParkBlockerCodeV2, string>;

const useLatestDrafts = (drafts: UseWorkspaceDraftsResult): React.MutableRefObject<UseWorkspaceDraftsResult> => {
  const ref = useRef(drafts);
  ref.current = drafts;
  return ref;
};

type TakeCardProps = {
  actions: BeatPanelActions;
  beatId: string;
  canManageSeed: boolean;
  disabled: boolean;
  projectId: string;
  projection: WorkspaceProjection;
  shot: WorkspaceShotProjection;
  shotIndex: number;
  take: WorkspaceTakeProjection;
  takeIndex: number;
};

const TakeCard: React.FC<TakeCardProps> = ({
  actions,
  beatId,
  canManageSeed,
  disabled,
  projectId,
  projection,
  shot,
  shotIndex,
  take,
  takeIndex,
}) => {
  const { t } = useTranslation();
  const assetUrl = createManagedStudioAssetUrl(projectId, take.assetId);
  const posterUrl = take.posterAssetId === null ? null : createManagedStudioAssetUrl(projectId, take.posterAssetId);
  const active = take.binReason === null;
  const parkEligibility = active
    ? exactEligibility(projection, {
        subject: 'take',
        action: 'park',
        beatId,
        shotId: shot.id,
        assetId: take.assetId,
      })
    : null;
  const restoreEligibility = active
    ? null
    : exactEligibility(projection, {
        subject: 'take',
        action: 'restore',
        beatId,
        shotId: shot.id,
        assetId: take.assetId,
      });
  const actionEligibility = active ? parkEligibility : restoreEligibility;
  const actionAllowed = actionEligibility?.allowed === true;
  const firstBlocker = actionEligibility?.blockers[0] ?? null;
  const selectableVideoTake = take.mediaKind === 'video' && videoTakeFitsShotTrims(shot, take);

  if (assetUrl === null || (take.posterAssetId !== null && posterUrl === null)) {
    return (
      <article className={styles.takeCard} data-asset-id={take.assetId} data-media-kind={take.mediaKind}>
        <p className={styles.warning} role='alert'>
          {t(`${KEY_ROOT}.takes.unavailable`)}
        </p>
      </article>
    );
  }

  const takeLabel = t(
    take.mediaKind === 'image' ? `${KEY_ROOT}.takes.imageTakeLabel` : `${KEY_ROOT}.takes.videoTakeLabel`,
    { shotIndex: shotIndex + 1, takeIndex: takeIndex + 1 }
  );
  return (
    <article
      aria-label={takeLabel}
      className={styles.takeCard}
      data-asset-id={take.assetId}
      data-bin-reason={take.binReason ?? undefined}
      data-effective-seed={take.effectiveSeed}
      data-explicit-seed={take.explicitSeed}
      data-media-kind={take.mediaKind}
      data-selected={take.selected}
    >
      {take.mediaKind === 'image' ? (
        <img
          alt={t(`${KEY_ROOT}.takes.previewAlt`, { label: takeLabel })}
          className={styles.takePreview}
          src={assetUrl}
        />
      ) : (
        <video
          aria-label={t(`${KEY_ROOT}.takes.videoPreview`, { label: takeLabel })}
          className={styles.takePreview}
          controls
          poster={posterUrl ?? undefined}
          preload='metadata'
          src={assetUrl}
        />
      )}
      <div className={styles.takeDetails}>
        <span className={styles.takeIdentity} dir='auto'>
          {takeLabel}
        </span>
        <div className={styles.badges}>
          {take.selected ? <span>{t(`${KEY_ROOT}.takes.selected`)}</span> : null}
          {take.effectiveSeed ? <span>{t(`${KEY_ROOT}.takes.effectiveSeed`)}</span> : null}
          {take.explicitSeed ? <span>{t(`${KEY_ROOT}.takes.pinnedSeed`)}</span> : null}
          {take.binReason !== null ? <span>{t(`${KEY_ROOT}.takes.binReason.${take.binReason}`)}</span> : null}
          {take.sourceDurationSeconds !== null ? (
            <span>
              <bdi>{t(`${KEY_ROOT}.takes.sourceDuration`, { seconds: take.sourceDurationSeconds })}</bdi>
            </span>
          ) : null}
        </div>
      </div>
      <div className={styles.actions}>
        {canManageSeed && active && take.mediaKind === 'image' && !take.explicitSeed ? (
          <Button disabled={disabled} onClick={() => void actions.setSeedStill(shot.id, take.assetId)} size='small'>
            {t(`${KEY_ROOT}.seeds.pin`)}
          </Button>
        ) : null}
        {canManageSeed && active && take.mediaKind === 'image' && take.explicitSeed ? (
          <Button disabled={disabled} onClick={() => void actions.setSeedStill(shot.id, null)} size='small'>
            {t(`${KEY_ROOT}.seeds.clearPin`)}
          </Button>
        ) : null}
        {active && take.mediaKind === 'video' && !take.selected ? (
          <Button
            disabled={disabled || !selectableVideoTake}
            onClick={() => void actions.selectTake(shot.id, take.assetId)}
            size='small'
            type='primary'
          >
            {t(`${KEY_ROOT}.takes.select`)}
          </Button>
        ) : null}
        {active ? (
          <>
            <Popconfirm
              cancelText={t(`${KEY_ROOT}.common.cancel`)}
              content={t(`${KEY_ROOT}.takes.parkConfirmBody`)}
              disabled={disabled || !actionAllowed}
              okText={t(`${KEY_ROOT}.takes.park`)}
              onOk={() => actions.parkTake(shot.id, take.assetId)}
              title={t(`${KEY_ROOT}.takes.parkConfirmTitle`)}
            >
              <Button disabled={disabled || !actionAllowed} size='small'>
                {t(`${KEY_ROOT}.takes.park`)}
              </Button>
            </Popconfirm>
            <Popconfirm
              cancelText={t(`${KEY_ROOT}.common.cancel`)}
              content={t(`${KEY_ROOT}.takes.alternateConfirmBody`)}
              disabled={disabled || !actionAllowed}
              okText={t(`${KEY_ROOT}.takes.addAlternate`)}
              onOk={() => actions.addAlternateTake(shot.id, take.assetId)}
              title={t(`${KEY_ROOT}.takes.alternateConfirmTitle`)}
            >
              <Button disabled={disabled || !actionAllowed} size='small'>
                {t(`${KEY_ROOT}.takes.addAlternate`)}
              </Button>
            </Popconfirm>
          </>
        ) : (
          <Button
            disabled={disabled || !actionAllowed}
            onClick={() => void actions.restoreTake(shot.id, take.assetId)}
            size='small'
          >
            {t(`${KEY_ROOT}.takes.restore`)}
          </Button>
        )}
      </div>
      {active && take.mediaKind === 'video' && !take.selected && !selectableVideoTake ? (
        <p className={styles.warning} role='status'>
          {t(`${KEY_ROOT}.takes.trimIncompatible`)}
        </p>
      ) : null}
      {!actionAllowed ? (
        <p className={styles.blocker} role='status'>
          {firstBlocker === null ? t(`${KEY_ROOT}.blocker.statusUnavailable`) : t(BLOCKER_KEYS[firstBlocker.code])}
        </p>
      ) : null}
    </article>
  );
};

type ShotCardProps = {
  actions: BeatPanelActions;
  beat: WorkspaceBeatProjection;
  briefReferenceOptions: readonly BeatPanelBriefReferenceOption[];
  canMoveNext: boolean;
  canMovePrevious: boolean;
  drafts: UseWorkspaceDraftsResult;
  disabled: boolean;
  gatePreferences: GatePreferenceRecord;
  hidden: boolean;
  index: number;
  onMove: (index: number, delta: -1 | 1) => void;
  onParkSettled: (shotId: string, parked: boolean) => void;
  onUpdateReviewPreference: (
    shotId: string,
    purpose: BeatPanelReviewPreference['purpose'],
    changes: Partial<Pick<BeatPanelReviewPreference, 'generationCount' | 'referenceAssetId'>>
  ) => void;
  projectId: string;
  projection: WorkspaceProjection;
  reviewBlocked: boolean;
  reviewChoices: BeatPanelReviewGraph['choices'] | null;
  shot: WorkspaceShotProjection;
};

const ShotCard: React.FC<ShotCardProps> = ({
  actions,
  beat,
  briefReferenceOptions,
  canMoveNext,
  canMovePrevious,
  drafts,
  disabled,
  gatePreferences,
  hidden,
  index,
  onMove,
  onParkSettled,
  onUpdateReviewPreference,
  projectId,
  projection,
  reviewBlocked,
  reviewChoices,
  shot,
}) => {
  const { t } = useTranslation();
  const draftsRef = useLatestDrafts(drafts);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [lifting, setLifting] = useState(false);
  const [recoveringJobId, setRecoveringJobId] = useState<string | null>(null);
  const [restoreLiftFocus, setRestoreLiftFocus] = useState(false);
  const hardCutUnavailableId = useId();
  const lineGuidanceId = useId();
  const generationRecoveryId = useId();
  const liftButtonRef = useRef<HTMLButtonElement | null>(null);
  const lineKey = shotDraftKey(shot.id, 'line');
  const narrationKey = shotDraftKey(shot.id, 'narration');
  const onScreenTextKey = shotDraftKey(shot.id, 'onScreenText');
  const durationKey = shotDraftKey(shot.id, 'durationSeconds');
  const line = draftString(drafts, lineKey, shot.line);
  const narration = draftString(drafts, narrationKey, shot.narration);
  const onScreenText = draftString(drafts, onScreenTextKey, shot.onScreenText);
  const durationSeconds = draftNumber(drafts, durationKey, shot.durationSeconds);
  const draftKeys = [lineKey, narrationKey, onScreenTextKey, durationKey] as const;
  const dirty = draftKeys.some((key) => hasDraft(drafts, key));
  const liftEligibility = exactEligibility(projection, {
    subject: 'shot',
    action: 'park',
    beatId: beat.id,
    shotId: shot.id,
    assetId: null,
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
  const history = beat.lineHistory;
  const reviewPreferences =
    reviewChoices?.map((choice): BeatPanelReviewChoice => {
      const stored = gatePreferences[reviewPreferenceKey(choice.shotId, choice.purpose)];
      const referenceAssetId =
        choice.purpose === 'seed_still' &&
        stored?.referenceAssetId !== null &&
        briefReferenceOptions.some((option) => option.assetId === stored?.referenceAssetId)
          ? (stored?.referenceAssetId ?? null)
          : null;
      return {
        ...choice,
        generationCount: stored?.generationCount ?? 1,
        referenceAssetId,
      };
    }) ?? null;
  const reviewedGenerationBlocked =
    reviewChoices === null ||
    reviewChoices.some((choice) => {
      const reviewedShot = exactShotProjection(projection, choice.shotId);
      return (
        reviewedShot === null ||
        (choice.purpose === 'seed_still' ? reviewedShot.seedGenerationBlocked : reviewedShot.videoGenerationBlocked)
      );
    });

  const save = async (): Promise<void> => {
    if (!dirty || saving || disabled || drafts.staleRevision) return;
    const submitted = [
      [lineKey, line],
      [narrationKey, narration],
      [onScreenTextKey, onScreenText],
      [durationKey, durationSeconds],
    ] as const;
    const changes: Partial<Record<'line' | 'narration' | 'onScreenText' | 'durationSeconds', string | number>> = {};
    if (line !== shot.line) changes.line = line;
    if (narration !== shot.narration) changes.narration = narration;
    if (onScreenText !== shot.onScreenText) changes.onScreenText = onScreenText;
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
    if (!restoreLiftFocus || disabled || lifting) return;
    liftButtonRef.current?.focus();
    setRestoreLiftFocus(false);
  }, [disabled, lifting, restoreLiftFocus]);

  const parkShot = async (): Promise<void> => {
    if (disabled || lifting || !liftAllowed) return;
    setLifting(true);
    let parked = false;
    try {
      parked = await actions.parkShot(shot.id);
    } catch {
      // The action owner presents commit errors. A rejected provider is never treated as success.
    } finally {
      setLifting(false);
    }
    onParkSettled(shot.id, parked);
    if (!parked) setRestoreLiftFocus(true);
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
  return (
    <article className={styles.shotCard} data-shot-id={shot.id} hidden={hidden}>
      <header className={styles.shotHeader}>
        <div>
          <h3>{t(`${KEY_ROOT}.shots.heading`, { index: index + 1 })}</h3>
          <span id={lineGuidanceId} className={styles.lineGuidance} data-line-derivation={shot.derivation}>
            {t(
              `${KEY_ROOT}.derivation.${shot.derivation === 'derived' ? 'attachedLineGuidance' : 'detachedLineGuidance'}`
            )}
          </span>
          <p
            className={styles.chainState}
            data-chain-state={
              shot.segmentHead ? (shot.chainBreak === 'hard_cut' ? 'hard_cut' : 'segment_head') : 'continuous'
            }
          >
            <bdi dir='auto'>
              {shot.segmentHead
                ? t(`${KEY_ROOT}.chain.segmentHead`)
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
        </div>
      </header>

      <div className={styles.editorGrid}>
        <label data-shot-field='line'>
          <span>{t(`${KEY_ROOT}.fields.line`)}</span>
          <Input.TextArea
            aria-describedby={lineGuidanceId}
            aria-label={t(`${KEY_ROOT}.fields.lineFor`, { index: index + 1 })}
            autoSize={{ minRows: 2, maxRows: 2 }}
            disabled={disabled}
            onChange={(value) => drafts.setValue(lineKey, value)}
            value={line}
          />
        </label>
        <label>
          <span>{t(`${KEY_ROOT}.fields.narration`)}</span>
          <Input.TextArea
            aria-label={t(`${KEY_ROOT}.fields.narrationFor`, { index: index + 1 })}
            autoSize={{ minRows: 2, maxRows: 6 }}
            disabled={disabled}
            onChange={(value) => drafts.setValue(narrationKey, value)}
            value={narration}
          />
        </label>
        <label>
          <span>{t(`${KEY_ROOT}.fields.onScreenText`)}</span>
          <Input.TextArea
            aria-label={t(`${KEY_ROOT}.fields.onScreenTextFor`, { index: index + 1 })}
            autoSize={{ minRows: 2, maxRows: 6 }}
            disabled={disabled}
            onChange={(value) => drafts.setValue(onScreenTextKey, value)}
            value={onScreenText}
          />
        </label>
        <label>
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
          <dl className={styles.takeSummary} data-shot-take-summary>
            {shot.segmentHead || shot.imageTakes.length > 0 ? (
              <div>
                <dt>{t(shot.segmentHead ? `${KEY_ROOT}.seeds.title` : `${KEY_ROOT}.seeds.imageTitle`)}</dt>
                <dd>
                  <bdi>{shot.imageTakes.length}</bdi>
                </dd>
              </div>
            ) : null}
            <div>
              <dt>{t(`${KEY_ROOT}.takes.videoTitle`)}</dt>
              <dd>
                <bdi>{shot.videoTakes.length}</bdi>
              </dd>
            </div>
          </dl>
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
            <div
              aria-describedby={hardCutUnavailableId}
              aria-labelledby={`${hardCutUnavailableId}-label`}
              className={styles.hardCutControl}
              data-hard-cut-contained
              role='group'
            >
              <Checkbox checked={shot.chainBreak === 'hard_cut'} disabled>
                <span id={`${hardCutUnavailableId}-label`}>{t(`${KEY_ROOT}.chain.authorHardCut`)}</span>
              </Checkbox>
            </div>
          </div>
        </div>
        <p className={styles.hardCutExplanation} data-hard-cut-explanation id={hardCutUnavailableId}>
          {t(`${KEY_ROOT}.chain.hardCutUnavailable`)}
        </p>
      </div>

      <section aria-label={t(`${KEY_ROOT}.derivation.label`, { index: index + 1 })} className={styles.subsection}>
        <h4>{t(`${KEY_ROOT}.derivation.title`)}</h4>
        <p data-line-derivation-state={shot.derivation}>
          {t(`${KEY_ROOT}.derivation.${shot.derivation}`)}
          {shot.derivationStale ? ` ${t(`${KEY_ROOT}.derivation.stale`)}` : null}
        </p>
        <div className={styles.actions}>
          {shot.derivation === 'derived' ? (
            <Button
              disabled={disabled || dirty}
              onClick={() => void actions.redetachLine(shot.id, shot.line)}
              size='small'
            >
              {t(`${KEY_ROOT}.derivation.detach`)}
            </Button>
          ) : null}
          <Button disabled={disabled} onClick={() => actions.requestReviewedRederive(shot.id)} size='small'>
            {t(`${KEY_ROOT}.derivation.rederiveReviewed`)}
          </Button>
        </div>
        {history.length > 0 ? (
          <ol className={styles.historyList}>
            {history.map((entry) => (
              <li key={entry.id}>
                <span dir='auto'>{entry.text}</span>
                <Button
                  disabled={disabled || dirty}
                  onClick={() => void actions.restoreLine(shot.id, entry.id)}
                  size='small'
                >
                  {t(`${KEY_ROOT}.derivation.restoreHistory`)}
                </Button>
              </li>
            ))}
          </ol>
        ) : null}
      </section>

      {shot.segmentHead || shot.imageTakes.length > 0 ? (
        <section
          aria-label={t(shot.segmentHead ? `${KEY_ROOT}.seeds.label` : `${KEY_ROOT}.seeds.imageLabel`, {
            index: index + 1,
          })}
          className={styles.subsection}
        >
          {shot.segmentHead ? (
            <div className={styles.subsectionHeader}>
              <div>
                <h4>{t(`${KEY_ROOT}.seeds.title`)}</h4>
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
            <h4>{t(`${KEY_ROOT}.seeds.imageTitle`)}</h4>
          )}
          <div className={styles.takeGrid}>
            {shot.imageTakes.map((take, takeIndex) => (
              <TakeCard
                key={take.assetId}
                actions={actions}
                beatId={beat.id}
                canManageSeed={shot.segmentHead}
                disabled={disabled}
                projectId={projectId}
                projection={projection}
                shot={shot}
                shotIndex={index}
                take={take}
                takeIndex={takeIndex}
              />
            ))}
          </div>
          {shot.imageTakes.length === 0 ? <p className={styles.muted}>{t(`${KEY_ROOT}.seeds.empty`)}</p> : null}
        </section>
      ) : null}

      <section aria-label={t(`${KEY_ROOT}.takes.videoLabel`, { index: index + 1 })} className={styles.subsection}>
        <h4>{t(`${KEY_ROOT}.takes.videoTitle`)}</h4>
        <div className={styles.takeGrid}>
          {shot.videoTakes.map((take, takeIndex) => (
            <TakeCard
              key={take.assetId}
              actions={actions}
              beatId={beat.id}
              canManageSeed={false}
              disabled={disabled}
              projectId={projectId}
              projection={projection}
              shot={shot}
              shotIndex={index}
              take={take}
              takeIndex={takeIndex}
            />
          ))}
        </div>
        {shot.videoTakes.length === 0 ? <p className={styles.muted}>{t(`${KEY_ROOT}.takes.empty`)}</p> : null}
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
                        : `${KEY_ROOT}.generation.purpose.videoTake`
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

      <div className={styles.shotFooter}>
        <div className={styles.generationPreferences}>
          {reviewPreferences?.map((preference) => {
            const position = exactShotPosition(projection, preference.shotId)!;
            const purpose = t(
              preference.purpose === 'seed_still'
                ? `${KEY_ROOT}.generation.purpose.seedStill`
                : `${KEY_ROOT}.generation.purpose.videoTake`
            );
            const choiceLabel = t(`${KEY_ROOT}.generation.choiceLabel`, {
              beatIndex: position.beatIndex + 1,
              shotIndex: position.shotIndex + 1,
              purpose,
            });
            return (
              <div
                key={reviewPreferenceKey(preference.shotId, preference.purpose)}
                className={styles.generationPreference}
                data-generation-purpose={preference.purpose}
              >
                <p>{choiceLabel}</p>
                <label>
                  <span>{t(`${KEY_ROOT}.generation.countForChoice`, { choice: choiceLabel })}</span>
                  <InputNumber
                    aria-label={t(`${KEY_ROOT}.generation.countForChoice`, { choice: choiceLabel })}
                    disabled={disabled}
                    max={STUDIO_MAX_GENERATIONS_PER_SHOT_PER_SUBMISSION}
                    min={1}
                    onChange={(value) => {
                      if (isGenerationCount(value)) {
                        onUpdateReviewPreference(preference.shotId, preference.purpose, {
                          generationCount: value,
                        });
                      }
                    }}
                    precision={0}
                    value={preference.generationCount}
                  />
                </label>
                {preference.purpose === 'seed_still' ? (
                  <label>
                    <span>{t(`${KEY_ROOT}.generation.referenceForChoice`, { choice: choiceLabel })}</span>
                    <Select
                      allowClear
                      aria-label={t(`${KEY_ROOT}.generation.referenceForChoice`, { choice: choiceLabel })}
                      disabled={disabled}
                      onChange={(value) =>
                        onUpdateReviewPreference(preference.shotId, preference.purpose, {
                          referenceAssetId:
                            typeof value === 'string' &&
                            briefReferenceOptions.some((option) => option.assetId === value)
                              ? value
                              : null,
                        })
                      }
                      placeholder={t(`${KEY_ROOT}.generation.noReference`)}
                      value={preference.referenceAssetId ?? undefined}
                    >
                      {briefReferenceOptions.map((option) => (
                        <Select.Option key={option.assetId} value={option.assetId}>
                          <span dir='auto'>{option.label}</span>
                        </Select.Option>
                      ))}
                    </Select>
                  </label>
                ) : null}
              </div>
            );
          })}
          {reviewPreferences === null ? (
            <p className={styles.blocker} role='status'>
              {t(`${KEY_ROOT}.generation.reviewUnavailable`)}
            </p>
          ) : null}
        </div>
        <Button
          disabled={disabled || reviewBlocked || reviewedGenerationBlocked || reviewPreferences === null}
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
        <Popconfirm
          cancelText={t(`${KEY_ROOT}.common.cancel`)}
          content={t(liftBodyKey, { shots: downstreamLabels.join(', ') })}
          disabled={disabled || lifting || !liftAllowed}
          okText={t(`${KEY_ROOT}.lift.confirmShot`)}
          onCancel={() => liftButtonRef.current?.focus()}
          onOk={parkShot}
          title={t(`${KEY_ROOT}.lift.shotTitle`, { index: index + 1 })}
        >
          <Button
            ref={(node) => {
              if (node === null) liftButtonRef.current = null;
              else if (node instanceof HTMLButtonElement) liftButtonRef.current = node;
            }}
            disabled={disabled || lifting || !liftAllowed}
            loading={lifting}
            status='danger'
          >
            {t(`${KEY_ROOT}.lift.shot`)}
          </Button>
        </Popconfirm>
      </div>
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

type RecoveryProps = Pick<BeatPanelProps, 'actions' | 'beat' | 'pending' | 'projectId' | 'projection'>;

const Recovery: React.FC<RecoveryProps> = ({ actions, beat, pending, projectId, projection }) => {
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
      <h3>{t(`${KEY_ROOT}.recovery.title`)}</h3>
      {rows.map((row) => (
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
            {row.eligiblePrimaryAssetIds.map((assetId) => {
              const choice = exactRecoveryChoice(projection, row, assetId);
              const url = createManagedStudioAssetUrl(projectId, assetId);
              if (choice === null || url === null) return null;
              return (
                <Button key={assetId} disabled={pending} onClick={() => void actions.chooseCascadeAsset(row, assetId)}>
                  {t(
                    choice.mediaKind === 'image'
                      ? `${KEY_ROOT}.recovery.chooseImage`
                      : `${KEY_ROOT}.recovery.chooseVideo`,
                    {
                      beatIndex: choice.shotPosition.beatIndex + 1,
                      shotIndex: choice.shotPosition.shotIndex + 1,
                      takeIndex: choice.takeIndex + 1,
                    }
                  )}
                </Button>
              );
            })}
            {row.canRetryConditioningFrame ? (
              <Button disabled={pending} onClick={() => void actions.retryConditioning(row.dependentShotId)}>
                {t(`${KEY_ROOT}.recovery.retryFree`)}
              </Button>
            ) : null}
            {row.canCancelWaiting ? (
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
      ))}
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
  briefReferenceOptions,
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
  const [reorderAnnouncement, setReorderAnnouncement] = useState('');
  const [shotLiftAnnouncement, setShotLiftAnnouncement] = useState('');
  const [inspectedShotSelection, setInspectedShotSelection] = useState<{
    beatId: string;
    shotId: string | null;
  }>(() => ({ beatId: beat.id, shotId: beat.shots[0]?.id ?? null }));
  const actionKey = beatDraftKey(beat.id, 'action');
  const lookKey = beatDraftKey(beat.id, 'look');
  const targetKey = beatDraftKey(beat.id, 'targetSeconds');
  const action = draftString(drafts, actionKey, beat.action);
  const look = draftString(drafts, lookKey, beat.look);
  const targetSeconds = draftNullableNumber(drafts, targetKey, beat.targetSeconds);
  const beatDraftKeys = [actionKey, lookKey, targetKey] as const;
  const beatDirty = beatDraftKeys.some((key) => hasDraft(drafts, key));
  const mutationLocked = pending || gateLocked;
  const coverageDraftDirty =
    beatDirty ||
    beat.shots.some((shot) =>
      (['line', 'narration', 'onScreenText', 'durationSeconds'] as const).some((field) =>
        hasDraft(drafts, shotDraftKey(shot.id, field))
      )
    );
  const coverageDisabled = mutationLocked || drafts.staleRevision || coverageDraftDirty;
  const gatePreferences = useMemo(() => parseGatePreferences(drafts.value('gate.choices')), [drafts.entries]);
  const safeBriefReferenceOptions = useMemo(
    () => exactBriefReferenceOptions(briefReferenceOptions),
    [briefReferenceOptions]
  );
  const lookWords = wordCount(look);
  const lookWarns = lookWords > STUDIO_LOOK_SOFT_WORD_LIMIT;
  const safeBeatIndex = beatIds[beatIndex] === beat.id ? beatIndex : beatIds.indexOf(beat.id);
  const previousBeatId = safeBeatIndex > 0 ? (beatIds[safeBeatIndex - 1] ?? null) : null;
  const nextBeatId = safeBeatIndex >= 0 ? (beatIds[safeBeatIndex + 1] ?? null) : null;
  const beatLiftEligibility = exactEligibility(projection, {
    subject: 'beat',
    action: 'park',
    beatId: beat.id,
    shotId: null,
    assetId: null,
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
      [actionKey, action],
      [lookKey, look],
      [targetKey, targetSeconds],
    ] as const;
    const changes: Partial<{ action: string; look: string; targetSeconds: number | null }> = {};
    if (action !== beat.action) changes.action = action;
    if (look !== beat.look) changes.look = look;
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

  const updateReviewPreference = (
    shotId: string,
    purpose: BeatPanelReviewPreference['purpose'],
    changes: Partial<Pick<BeatPanelReviewPreference, 'generationCount' | 'referenceAssetId'>>
  ): void => {
    if (mutationLocked || !SAFE_STUDIO_ID.test(shotId)) return;
    const key = reviewPreferenceKey(shotId, purpose);
    const current = gatePreferences[key] ?? { generationCount: 1, referenceAssetId: null };
    const next = { ...current, ...changes };
    if (
      !isGenerationCount(next.generationCount) ||
      (next.referenceAssetId !== null &&
        (purpose === 'video_take' ||
          !safeBriefReferenceOptions.some((option) => option.assetId === next.referenceAssetId)))
    ) {
      return;
    }
    drafts.setValue('gate.choices', JSON.stringify({ ...gatePreferences, [key]: next }));
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
        <header className={styles.panelHeader}>
          <div>
            <p className={styles.eyebrow}>
              {t(`${KEY_ROOT}.beatPosition`, { index: safeBeatIndex + 1, total: beatIds.length })}
            </p>
            <h2 dir='auto'>{beatTitle}</h2>
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
          </div>
        </header>

        {errorMessageKey === null ? null : <Alert content={t(errorMessageKey)} type='error' />}

        <section aria-label={t(`${KEY_ROOT}.beatFieldsLabel`)} className={styles.beatEditor}>
          <label className={styles.beatField} data-beat-field='action'>
            <span className={styles.beatFieldHeading}>
              <span className={styles.fieldGuidance}>{t(`${KEY_ROOT}.fieldGuidance.action`)}</span>
            </span>
            <Input.TextArea
              aria-label={t(`${KEY_ROOT}.fields.action`)}
              autoSize={{ minRows: 3, maxRows: 8 }}
              disabled={mutationLocked}
              onChange={(value) => drafts.setValue(actionKey, value)}
              value={action}
            />
          </label>
          <label className={styles.beatField} data-beat-field='look'>
            <span className={styles.beatFieldHeading}>
              <span className={styles.fieldGuidance}>{t(`${KEY_ROOT}.fieldGuidance.look`)}</span>
              <bdi
                aria-atomic='true'
                className={`${styles.fieldGuidance} ${lookWarns ? styles.warning : styles.muted}`}
                data-look-warning={lookWarns}
                dir='auto'
                role='status'
              >
                {t(`${KEY_ROOT}.lookCounter`, { count: lookWords, limit: STUDIO_LOOK_SOFT_WORD_LIMIT })}
              </bdi>
            </span>
            <Input.TextArea
              aria-label={t(`${KEY_ROOT}.fields.look`)}
              autoSize={{ minRows: 3, maxRows: 8 }}
              disabled={mutationLocked}
              onChange={(value) => drafts.setValue(lookKey, value)}
              value={look}
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
                  briefReferenceOptions={safeBriefReferenceOptions}
                  canMoveNext={index < beat.shots.length - 1}
                  canMovePrevious={index > 0}
                  disabled={mutationLocked}
                  drafts={drafts}
                  gatePreferences={gatePreferences}
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
                  onUpdateReviewPreference={updateReviewPreference}
                  projectId={projectId}
                  projection={projection}
                  reviewBlocked={reviewBlockedMessageKey !== null || gateLocked}
                  reviewChoices={exactReviewGraph(
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
          projectId={projectId}
          projection={projection}
        />

        <footer className={styles.panelFooter}>
          <Popconfirm
            cancelText={t(`${KEY_ROOT}.common.cancel`)}
            content={t(beatLiftBodyKey, { shots: beatDownstreamLabels.join(', ') })}
            disabled={mutationLocked || !beatLiftAllowed}
            okText={t(`${KEY_ROOT}.lift.confirmBeat`)}
            onOk={() => actions.parkBeat(beat.id)}
            title={t(`${KEY_ROOT}.lift.beatTitle`)}
          >
            <Button disabled={mutationLocked || !beatLiftAllowed} status='danger'>
              {t(`${KEY_ROOT}.lift.beat`)}
            </Button>
          </Popconfirm>
          {!beatLiftAllowed ? (
            <p className={styles.blocker} role='status'>
              {coverageDraftDirty
                ? t(`${KEY_ROOT}.blocker.unsavedDrafts`)
                : firstBeatBlocker === null
                  ? t(`${KEY_ROOT}.blocker.statusUnavailable`)
                  : t(BLOCKER_KEYS[firstBeatBlocker.code])}
            </p>
          ) : null}
        </footer>
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
