/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Alert, Button, Empty, Input, Modal, Popconfirm, Progress, Tooltip } from '@arco-design/web-react';
import { Delete } from '@icon-park/react';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  STUDIO_MAX_PROJECT_REFERENCES,
  STUDIO_MAX_REFERENCE_LABEL_LENGTH,
  STUDIO_MAX_REFERENCE_PROMPT_LENGTH,
  type StudioAspectRatio,
  type StudioRendererJobV2,
} from '@/common/types/project/creativeStudioTypes';
import { FullscreenMediaFrame } from '@/renderer/pages/studio/components/FullscreenMediaFrame';
import { createManagedStudioAssetUrl } from '@/renderer/pages/studio/studioManagedAssetUrl';
import styles from './References.module.css';
export type {
  ReferenceDownloadRecoveryClaim,
  ReferenceRemovalBlocker,
  ReferenceRetainedShotBinOwner,
  ReferenceRetainedShotReviewClaim,
} from './referenceRemovalBlockers';
import type {
  ReferenceDownloadRecoveryClaim,
  ReferenceRemovalBlocker,
  ReferenceRetainedShotReviewClaim,
} from './referenceRemovalBlockers';
import { referenceWorkspaceStatus } from './referenceStatus';
import { StudioBlockerAlert } from '@/renderer/pages/studio/components/StudioBlockerAlert';

export type ReferenceCandidateJob = Pick<
  StudioRendererJobV2,
  'id' | 'status' | 'error' | 'canCancel' | 'canRetry' | 'canRetryDownload'
>;

export type ReferenceWorkspaceItem = {
  id: string;
  kind: 'character' | 'background';
  label: string;
  prompt: string;
  lastRunPrompt: string | null;
  approvedAssetId: string | null;
  generatedAssetIds: readonly string[];
  assetCreatedAt: Readonly<Record<string, string>>;
  assetOrdinalById: Readonly<Record<string, number>>;
  removalBlockers: readonly ReferenceRemovalBlocker[];
  generationStatus: 'idle' | 'queued' | 'running' | 'succeeded' | 'failed';
  candidateJob: ReferenceCandidateJob | null;
};

export type StudioReferenceFocusIntent = {
  id: string;
  projectId: string;
  referenceIds: readonly string[];
  assetIds: readonly string[];
  shotIds: readonly string[];
};

export type ReferencesViewActions = {
  addBackground: (background: { label: string; prompt: string }) => Promise<boolean>;
  updateDetails: (referenceId: string, details: { label: string; prompt: string }) => Promise<boolean>;
  selectImage: (referenceId: string, assetId: string) => Promise<boolean>;
  removeImage: (referenceId: string, assetId: string) => Promise<boolean>;
  importPhoto: (referenceId: string) => Promise<boolean>;
  regenerate: (referenceId: string, prompt: string) => Promise<boolean>;
  retryJob: (referenceId: string, jobId: string, acknowledgePossibleDuplicateCharge: boolean) => Promise<boolean>;
  retryDownload: (referenceId: string, jobId: string) => Promise<boolean>;
  retryBlockingDownload: (claim: ReferenceDownloadRecoveryClaim) => Promise<boolean>;
  reviewRetainedShot: (claim: ReferenceRetainedShotReviewClaim) => Promise<boolean>;
  cancelJob: (referenceId: string, jobId: string) => Promise<boolean>;
  openBindings: () => void;
};

export type ReferencesViewProps = {
  projectId: string;
  aspectRatio: StudioAspectRatio;
  references: readonly ReferenceWorkspaceItem[];
  pendingReferenceId: string | null;
  gateLocked: boolean;
  errorMessageKey: string | null;
  onRefreshRoutes?: () => void;
  focusIntent?: StudioReferenceFocusIntent | null;
  onFocusIntentConsumed?: (intentId: string) => void;
  actions: ReferencesViewActions;
};

type ReferenceDetailsDraft = { label: string; prompt: string };

const ROOT = 'conversation.creativeStudio.workspace.referenceWorkflow';
const PANEL_ROOT = `${ROOT}.panel`;
const JOB_ROOT = 'conversation.creativeStudio.jobs';
const REFERENCE_HIGHLIGHT_MS = 1_600;

const slugReferenceLabel = (label: string): string =>
  label
    .normalize('NFKD')
    .toLowerCase()
    .replace(/\p{M}+/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/** Display-only handle; creation order comes from immutable asset timestamps, never take recency. */
export const referencePhotoHandle = (
  label: string,
  kind: ReferenceWorkspaceItem['kind'],
  creationIndex: number
): string => {
  const slug = slugReferenceLabel(label) || (kind === 'character' ? 'character' : 'place');
  return `@${slug}-${String(creationIndex + 1).padStart(2, '0')}`;
};

const orderedAssetIds = (item: ReferenceWorkspaceItem): string[] =>
  [...new Set(item.generatedAssetIds)].toSorted((left, right) => {
    const byCreatedAt = (item.assetCreatedAt[left] ?? '').localeCompare(item.assetCreatedAt[right] ?? '');
    return byCreatedAt === 0 ? left.localeCompare(right) : byCreatedAt;
  });

/** Project-level identity and location references, made current before any Shot candidates are made. */
export const ReferencesView: React.FC<ReferencesViewProps> = ({
  projectId,
  aspectRatio,
  references,
  pendingReferenceId,
  gateLocked,
  errorMessageKey,
  onRefreshRoutes,
  focusIntent = null,
  onFocusIntentConsumed,
  actions,
}) => {
  const { t } = useTranslation();
  const cardRefs = useRef(new Map<string, HTMLLIElement>());
  const characterHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const backgroundHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const handledFocusIntentIdRef = useRef<string | null>(null);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [activeFocusIntent, setActiveFocusIntent] = useState<StudioReferenceFocusIntent | null>(null);
  const [addBackgroundOpen, setAddBackgroundOpen] = useState(false);
  const [backgroundLabel, setBackgroundLabel] = useState('');
  const [backgroundPrompt, setBackgroundPrompt] = useState('');
  const [addingBackground, setAddingBackground] = useState(false);
  const [detailDrafts, setDetailDrafts] = useState<Record<string, ReferenceDetailsDraft>>({});
  const [cardActionPending, setCardActionPending] = useState(false);
  const characters = useMemo(() => references.filter((item) => item.kind === 'character'), [references]);
  const backgrounds = useMemo(() => references.filter((item) => item.kind === 'background'), [references]);
  const charactersGenerated = characters.every((item) => item.approvedAssetId !== null);
  const currentCount = references.filter((item) => item.approvedAssetId !== null).length;
  const allCurrent = references.length > 0 && currentCount === references.length;
  const currentPercent = references.length === 0 ? 0 : Math.round((currentCount * 100) / references.length);
  const focusIds = useMemo(() => new Set(activeFocusIntent?.referenceIds ?? []), [activeFocusIntent]);
  const focusAssets = useMemo(() => new Set(activeFocusIntent?.assetIds ?? []), [activeFocusIntent]);

  useEffect(() => {
    handledFocusIntentIdRef.current = null;
    setActiveFocusIntent(null);
    setAddBackgroundOpen(false);
    setBackgroundLabel('');
    setBackgroundPrompt('');
    setAddingBackground(false);
    setDetailDrafts({});
    setCardActionPending(false);
  }, [projectId]);

  useEffect(() => {
    setDetailDrafts((current) => {
      let changed = false;
      const referenceById = new Map(references.map((reference) => [reference.id, reference]));
      const next = { ...current };
      for (const [referenceId, draft] of Object.entries(current)) {
        const reference = referenceById.get(referenceId);
        if (reference === undefined || (draft.label === reference.label && draft.prompt === reference.prompt)) {
          delete next[referenceId];
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [references]);

  useEffect(() => {
    if (
      focusIntent === null ||
      focusIntent.projectId !== projectId ||
      handledFocusIntentIdRef.current === focusIntent.id
    ) {
      return;
    }
    const requestedReferenceIds = new Set(focusIntent.referenceIds);
    const requestedAssetIds = new Set(focusIntent.assetIds);
    if (highlightTimerRef.current !== null) clearTimeout(highlightTimerRef.current);
    highlightTimerRef.current = null;
    const focused = references.find(
      (item) =>
        cardRefs.current.has(item.id) &&
        (requestedReferenceIds.has(item.id) || item.generatedAssetIds.some((assetId) => requestedAssetIds.has(assetId)))
    );
    if (focused === undefined) return;
    handledFocusIntentIdRef.current = focusIntent.id;
    setActiveFocusIntent(focusIntent);
    cardRefs.current.get(focused.id)?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
    (focused.kind === 'character' ? characterHeadingRef.current : backgroundHeadingRef.current)?.focus();
    onFocusIntentConsumed?.(focusIntent.id);
    highlightTimerRef.current = setTimeout(() => {
      setActiveFocusIntent((current) => (current?.id === focusIntent.id ? null : current));
      highlightTimerRef.current = null;
    }, REFERENCE_HIGHLIGHT_MS);
  }, [focusIntent, onFocusIntentConsumed, projectId, references]);

  useEffect(
    () => () => {
      if (highlightTimerRef.current !== null) clearTimeout(highlightTimerRef.current);
    },
    []
  );

  const trimmedBackgroundLabel = backgroundLabel.trim();
  const trimmedBackgroundPrompt = backgroundPrompt.trim();
  const duplicateBackground = backgrounds.some((reference) => reference.label === trimmedBackgroundLabel);
  const maySubmitBackground =
    !gateLocked &&
    !addingBackground &&
    pendingReferenceId === null &&
    references.length < STUDIO_MAX_PROJECT_REFERENCES &&
    trimmedBackgroundLabel.length > 0 &&
    trimmedBackgroundLabel.length <= STUDIO_MAX_REFERENCE_LABEL_LENGTH &&
    trimmedBackgroundPrompt.length > 0 &&
    trimmedBackgroundPrompt.length <= STUDIO_MAX_REFERENCE_PROMPT_LENGTH &&
    !duplicateBackground;
  const closeAddBackground = (): void => {
    if (addingBackground) return;
    setAddBackgroundOpen(false);
    setBackgroundLabel('');
    setBackgroundPrompt('');
  };
  const submitBackground = async (): Promise<void> => {
    if (!maySubmitBackground) return;
    setAddingBackground(true);
    try {
      if (await actions.addBackground({ label: trimmedBackgroundLabel, prompt: trimmedBackgroundPrompt })) {
        setAddBackgroundOpen(false);
        setBackgroundLabel('');
        setBackgroundPrompt('');
      }
    } finally {
      setAddingBackground(false);
    }
  };

  const detailsFor = (item: ReferenceWorkspaceItem): ReferenceDetailsDraft =>
    detailDrafts[item.id] ?? { label: item.label, prompt: item.prompt };
  const updateDraft = (item: ReferenceWorkspaceItem, changes: Partial<ReferenceDetailsDraft>): void => {
    setDetailDrafts((current) => ({
      ...current,
      [item.id]: { label: item.label, prompt: item.prompt, ...current[item.id], ...changes },
    }));
  };
  const saveDetails = async (item: ReferenceWorkspaceItem): Promise<void> => {
    if (gateLocked || pendingReferenceId !== null || cardActionPending) return;
    const draft = detailsFor(item);
    const label = draft.label.trim();
    const prompt = draft.prompt.trim();
    const duplicate = references.some(
      (candidate) => candidate.id !== item.id && candidate.kind === item.kind && candidate.label === label
    );
    if (
      duplicate ||
      label.length === 0 ||
      label.length > STUDIO_MAX_REFERENCE_LABEL_LENGTH ||
      prompt.length === 0 ||
      prompt.length > STUDIO_MAX_REFERENCE_PROMPT_LENGTH
    ) {
      return;
    }
    if (label === item.label && prompt === item.prompt) return;
    setCardActionPending(true);
    try {
      await actions.updateDetails(item.id, { label, prompt });
    } finally {
      setCardActionPending(false);
    }
  };

  const renderCard = (item: ReferenceWorkspaceItem): React.ReactNode => {
    const status = referenceWorkspaceStatus(item);
    const highlighted =
      activeFocusIntent !== null &&
      (focusIds.has(item.id) || item.generatedAssetIds.some((assetId) => focusAssets.has(assetId)));
    const busy = pendingReferenceId === item.id;
    const generationActive = item.generationStatus === 'queued' || item.generationStatus === 'running';
    const recoveryPending = item.candidateJob?.status === 'needs_attention';
    const downloadRecoveryPending = item.candidateJob?.canRetryDownload === true;
    const recoveryDescriptionId = `studio-reference-recovery-${item.id}`;
    const removalBlockersId = `studio-reference-removal-blockers-${item.id}`;
    const actionsDisabled = gateLocked || pendingReferenceId !== null;
    const removalBlocked = item.removalBlockers.length > 0;
    const draft = detailsFor(item);
    const trimmedPrompt = draft.prompt.trim();
    const duplicateLabel = references.some(
      (candidate) => candidate.id !== item.id && candidate.kind === item.kind && candidate.label === draft.label.trim()
    );
    const promptDirty =
      item.approvedAssetId !== null && item.lastRunPrompt !== null && trimmedPrompt !== item.lastRunPrompt;
    const assets = orderedAssetIds(item);
    const currentIndex = assets.findIndex((assetId) => assetId === item.approvedAssetId);
    const currentOrdinal =
      item.approvedAssetId === null
        ? undefined
        : (item.assetOrdinalById?.[item.approvedAssetId] ?? (currentIndex < 0 ? undefined : currentIndex));
    const currentHandle =
      currentIndex < 0 || currentOrdinal === undefined
        ? null
        : referencePhotoHandle(draft.label.trim(), item.kind, currentOrdinal);
    const generationDisabled =
      gateLocked ||
      generationActive ||
      recoveryPending ||
      downloadRecoveryPending ||
      pendingReferenceId !== null ||
      trimmedPrompt.length === 0 ||
      trimmedPrompt.length > STUDIO_MAX_REFERENCE_PROMPT_LENGTH ||
      duplicateLabel ||
      (!charactersGenerated && item.kind === 'background');
    const retryJob = (acknowledgePossibleDuplicateCharge: boolean): void => {
      if (item.candidateJob === null) return;
      void actions.retryJob(item.id, item.candidateJob.id, acknowledgePossibleDuplicateCharge);
    };
    const generate = async (): Promise<void> => {
      if (generationDisabled || cardActionPending) return;
      setCardActionPending(true);
      try {
        await actions.regenerate(item.id, trimmedPrompt);
      } finally {
        setCardActionPending(false);
      }
    };
    const selectImage = async (assetId: string): Promise<void> => {
      if (assetId === item.approvedAssetId || actionsDisabled || cardActionPending) return;
      setCardActionPending(true);
      try {
        await actions.selectImage(item.id, assetId);
      } finally {
        setCardActionPending(false);
      }
    };
    const removeImage = async (assetId: string): Promise<void> => {
      if (assetId !== item.approvedAssetId || actionsDisabled || removalBlocked || cardActionPending) {
        return;
      }
      setCardActionPending(true);
      try {
        await actions.removeImage(item.id, assetId);
      } finally {
        setCardActionPending(false);
      }
    };
    const importPhoto = async (): Promise<void> => {
      if (actionsDisabled || generationActive || recoveryPending || downloadRecoveryPending || cardActionPending) {
        return;
      }
      setCardActionPending(true);
      try {
        await actions.importPhoto(item.id);
      } finally {
        setCardActionPending(false);
      }
    };
    const primaryLabel = generationActive
      ? t(`${PANEL_ROOT}.action.cancelRun`)
      : item.approvedAssetId === null
        ? t(`${PANEL_ROOT}.action.generate`)
        : promptDirty
          ? t(`${PANEL_ROOT}.action.generateAgain`)
          : t(`${PANEL_ROOT}.action.generateAnother`);
    return (
      <li
        ref={(node) => {
          if (node === null) cardRefs.current.delete(item.id);
          else cardRefs.current.set(item.id, node);
        }}
        className={`${styles.card} ${item.approvedAssetId === null ? styles.cardEmpty : styles.cardCurrent} ${highlighted ? styles.cardHighlighted : ''}`}
        data-reference-id={item.id}
        data-reference-kind={item.kind}
        data-reference-highlighted={highlighted || undefined}
        key={item.id}
      >
        <div className={styles.identityRow} data-reference-row='identity'>
          <span aria-hidden='true' className={styles.identityDot} />
          <Input
            aria-label={t(`${PANEL_ROOT}.nameLabel`, { kind: t(`${PANEL_ROOT}.kind.${item.kind}`) })}
            className={styles.nameInput}
            disabled={actionsDisabled || cardActionPending}
            maxLength={STUDIO_MAX_REFERENCE_LABEL_LENGTH}
            value={draft.label}
            onBlur={() => void saveDetails(item)}
            onChange={(label) => updateDraft(item, { label })}
            onPressEnter={(event) => event.currentTarget.blur()}
          />
          <span className={styles.meta}>{t(`${PANEL_ROOT}.meta.${item.kind}`, { count: assets.length })}</span>
          <span className={styles.statusWord} data-reference-status={status}>
            {t(`${PANEL_ROOT}.status.${status}`)}
          </span>
        </div>
        {duplicateLabel ? (
          <p className={styles.inlineError} role='alert'>
            {t(`${PANEL_ROOT}.duplicateName`)}
          </p>
        ) : null}
        {item.approvedAssetId === null ? (
          <button
            className={`${styles.pictureBand} ${styles.pictureBandEmpty}`}
            data-reference-preview='empty'
            disabled={generationDisabled || cardActionPending}
            onClick={() => void generate()}
            type='button'
          >
            <span aria-hidden='true' className={styles.emptyGlyph}>
              ▣
            </span>
            <span>{t(`${PANEL_ROOT}.emptyPhoto`)}</span>
          </button>
        ) : (
          <FullscreenMediaFrame className={styles.fullscreenFrame}>
            <div
              className={`${styles.pictureBand} ${generationActive ? styles.pictureBandGenerating : ''}`}
              data-reference-preview='current'
            >
              <img
                alt={t(`${ROOT}.previewAlt`, { label: item.label })}
                src={createManagedStudioAssetUrl(projectId, item.approvedAssetId)}
              />
              <span className={styles.currentBadge}>{t(`${PANEL_ROOT}.currentHandle`, { handle: currentHandle })}</span>
              <a
                aria-label={t(`${PANEL_ROOT}.download`, { handle: currentHandle })}
                className={styles.downloadControl}
                download={`${currentHandle ?? 'reference'}.png`}
                href={createManagedStudioAssetUrl(projectId, item.approvedAssetId)}
                onClick={(event) => event.stopPropagation()}
              >
                ↓
              </a>
              <Button
                aria-label={t(`${PANEL_ROOT}.removePhoto`, { handle: currentHandle })}
                className={styles.removeControl}
                disabled={actionsDisabled || removalBlocked || cardActionPending}
                icon={<Delete aria-hidden='true' />}
                aria-describedby={removalBlocked ? removalBlockersId : undefined}
                onClick={(event) => {
                  event.stopPropagation();
                  void removeImage(item.approvedAssetId!);
                }}
                shape='circle'
                size='mini'
                status='danger'
                title={removalBlocked ? t(`${PANEL_ROOT}.removePhotoLocked`) : undefined}
                type='secondary'
              />
              <div className={styles.fullscreenTitle}>
                <strong>{currentHandle}</strong>
                <span>{t(`${PANEL_ROOT}.currentReference`)}</span>
              </div>
            </div>
          </FullscreenMediaFrame>
        )}
        {item.removalBlockers.length === 0 ? null : (
          <ul className={styles.removalBlockers} id={removalBlockersId}>
            {item.removalBlockers.map((blocker) => {
              if (blocker.kind === 'invalid_authority') {
                return (
                  <li
                    className={styles.removalBlocker}
                    data-blocker-kind={blocker.kind}
                    data-reference-removal-blocker={`${blocker.referenceId}:${blocker.assetId}`}
                    key={`${blocker.kind}:${blocker.referenceId}:${blocker.assetId}`}
                  >
                    <span>{t(`${PANEL_ROOT}.removalBlocker.invalidAuthority`)}</span>
                  </li>
                );
              }
              const hasActivePosition = blocker.beatPosition !== null && blocker.shotPosition !== null;
              const purpose = t(`conversation.creativeStudio.workspace.gate.purpose.${blocker.purpose}`);
              const message =
                blocker.kind === 'active_reference_job'
                  ? t(`${PANEL_ROOT}.removalBlocker.activeReferenceJob`, { purpose, jobId: blocker.jobId })
                  : blocker.kind === 'active_asset_consumer'
                    ? hasActivePosition
                      ? t(`${PANEL_ROOT}.removalBlocker.activeAssetConsumer`, {
                          purpose,
                          beatPosition: blocker.beatPosition,
                          shotPosition: blocker.shotPosition,
                        })
                      : blocker.shotId === null
                        ? t(`${PANEL_ROOT}.removalBlocker.activeAssetConsumerOther`, { purpose, jobId: blocker.jobId })
                        : t(`${PANEL_ROOT}.removalBlocker.activeAssetConsumerRetained`, {
                            purpose,
                            shotId: blocker.shotId,
                          })
                    : blocker.recoveryAction === 'restore_shot'
                      ? blocker.retainedOwner.kind === 'shot'
                        ? t(`${PANEL_ROOT}.removalBlocker.downloadRecoveryRetainedShot`, {
                            purpose,
                            shotId: blocker.shotId,
                          })
                        : t(`${PANEL_ROOT}.removalBlocker.downloadRecoveryRetainedBeat`, {
                            purpose,
                            shotId: blocker.shotId,
                            beatId: blocker.retainedOwner.beatId,
                          })
                      : hasActivePosition
                        ? t(`${PANEL_ROOT}.removalBlocker.downloadRecovery`, {
                            purpose,
                            beatPosition: blocker.beatPosition,
                            shotPosition: blocker.shotPosition,
                          })
                        : t(`${PANEL_ROOT}.removalBlocker.downloadRecoveryOther`, { purpose, jobId: blocker.jobId });
              return (
                <li
                  className={styles.removalBlocker}
                  data-blocker-kind={blocker.kind}
                  data-reference-removal-blocker={blocker.jobId}
                  key={`${blocker.kind}:${blocker.jobId}`}
                >
                  <span>{message}</span>
                  {blocker.kind === 'download_recovery' && blocker.recoveryAction === 'retry_download' ? (
                    <Button
                      disabled={actionsDisabled}
                      loading={busy}
                      onClick={() => void actions.retryBlockingDownload(blocker)}
                      size='small'
                    >
                      {t(`${JOB_ROOT}.retryDownload`)}
                    </Button>
                  ) : blocker.kind === 'download_recovery' ? (
                    <Button
                      disabled={actionsDisabled}
                      loading={busy}
                      onClick={() => void actions.reviewRetainedShot(blocker)}
                      size='small'
                    >
                      {t(`${PANEL_ROOT}.removalBlocker.reviewInBoard`)}
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
        <div className={styles.takeStrip} data-reference-row='takes'>
          {assets.map((assetId, index) => {
            const handle = referencePhotoHandle(
              draft.label.trim(),
              item.kind,
              item.assetOrdinalById?.[assetId] ?? index
            );
            const current = assetId === item.approvedAssetId;
            return (
              <button
                aria-current={current ? 'true' : undefined}
                aria-label={t(`${PANEL_ROOT}.choosePhoto`, { handle })}
                className={styles.take}
                disabled={actionsDisabled || cardActionPending || current}
                key={assetId}
                onClick={() => void selectImage(assetId)}
                type='button'
              >
                <img alt='' src={createManagedStudioAssetUrl(projectId, assetId)} />
                <span>{handle}</span>
              </button>
            );
          })}
          <button
            aria-label={t(`${PANEL_ROOT}.addPhoto`)}
            className={styles.addTake}
            disabled={generationDisabled || cardActionPending}
            onClick={() => void generate()}
            type='button'
          >
            +
          </button>
          <span className={styles.photoCount}>{t(`${PANEL_ROOT}.photoCount`, { count: assets.length })}</span>
        </div>
        <Input.TextArea
          aria-label={t(`${PANEL_ROOT}.promptLabel`, { label: item.label })}
          className={styles.prompt}
          disabled={actionsDisabled || cardActionPending}
          maxLength={STUDIO_MAX_REFERENCE_PROMPT_LENGTH}
          placeholder={t(`${PANEL_ROOT}.promptPlaceholder.${item.kind}`)}
          rows={2}
          value={draft.prompt}
          onBlur={() => void saveDetails(item)}
          onChange={(prompt) => updateDraft(item, { prompt })}
        />
        {item.candidateJob?.error === null || item.candidateJob === null ? null : (
          <p className={styles.jobError} id={recoveryDescriptionId} role='alert'>
            {t(item.candidateJob.error.messageKey)}
          </p>
        )}
        <div className={styles.actionRow} data-reference-row='action'>
          {generationActive ? <span className={styles.runningTag}>{t(`${PANEL_ROOT}.tag.running`)}</span> : null}
          {!generationActive && promptDirty ? (
            <span className={styles.editedTag}>{t(`${PANEL_ROOT}.tag.edited`)}</span>
          ) : null}
          <span className={styles.actionSpacer} />
          {item.candidateJob?.status === 'needs_attention' && item.candidateJob.canRetry ? (
            item.candidateJob.error?.code === 'submission_unknown' ? (
              <Popconfirm
                cancelText={t('conversation.creativeStudio.workspace.beatPanel.common.cancel')}
                content={t(`${JOB_ROOT}.retryChargeBody`)}
                disabled={actionsDisabled}
                okText={t(`${JOB_ROOT}.retryChargeConfirm`)}
                onOk={() => retryJob(true)}
                title={t(`${JOB_ROOT}.retryChargeTitle`)}
              >
                <Button
                  aria-describedby={item.candidateJob.error === null ? undefined : recoveryDescriptionId}
                  disabled={actionsDisabled}
                  loading={busy}
                  size='small'
                >
                  {t(`${JOB_ROOT}.retry`)}
                </Button>
              </Popconfirm>
            ) : (
              <Button
                aria-describedby={item.candidateJob.error === null ? undefined : recoveryDescriptionId}
                disabled={actionsDisabled}
                loading={busy}
                onClick={() => retryJob(false)}
                size='small'
              >
                {t(`${JOB_ROOT}.retry`)}
              </Button>
            )
          ) : null}
          {item.candidateJob?.status === 'failed' &&
          item.candidateJob.error?.code === 'download_failed' &&
          item.candidateJob.canRetryDownload ? (
            <Button
              aria-describedby={recoveryDescriptionId}
              disabled={actionsDisabled}
              loading={busy}
              onClick={() => void actions.retryDownload(item.id, item.candidateJob!.id)}
              size='small'
            >
              {t(`${JOB_ROOT}.retryDownload`)}
            </Button>
          ) : null}
          {!generationActive && item.candidateJob?.canCancel ? (
            <Button
              aria-describedby={item.candidateJob.error ? recoveryDescriptionId : undefined}
              disabled={actionsDisabled}
              loading={busy}
              onClick={() => void actions.cancelJob(item.id, item.candidateJob!.id)}
              size='small'
            >
              {t(`${JOB_ROOT}.cancel`)}
            </Button>
          ) : null}
          <Button
            disabled={
              actionsDisabled || generationActive || recoveryPending || downloadRecoveryPending || cardActionPending
            }
            loading={cardActionPending}
            onClick={() => void importPhoto()}
            size='small'
          >
            {t(`${PANEL_ROOT}.importPhoto`)}
          </Button>
          <Button
            aria-describedby={item.candidateJob?.error ? recoveryDescriptionId : undefined}
            className={styles.primaryAction}
            disabled={
              generationActive
                ? actionsDisabled || item.candidateJob?.canCancel !== true
                : generationDisabled || cardActionPending
            }
            loading={busy || cardActionPending}
            onClick={() => {
              if (generationActive && item.candidateJob?.canCancel) {
                void actions.cancelJob(item.id, item.candidateJob.id);
              } else {
                void generate();
              }
            }}
            size='small'
            type={item.approvedAssetId === null || promptDirty ? 'primary' : 'secondary'}
          >
            {primaryLabel}
          </Button>
        </div>
      </li>
    );
  };

  return (
    <section className={styles.root} data-aspect-ratio={aspectRatio} data-studio-references-view>
      <header className={styles.titleBar}>
        <strong className={styles.title}>{t('conversation.creativeStudio.workspace.views.references')}</strong>
        <span>{t(`${PANEL_ROOT}.canonicalImages`)}</span>
      </header>
      <div className={styles.panelBody}>
        <header className={styles.introduction}>
          <p>{t(`${PANEL_ROOT}.intro`)}</p>
          <div className={styles.progressBlock} aria-live='polite'>
            <Progress percent={currentPercent} showText={false} />
            <div className={styles.progressActions}>
              <span>{t(`${PANEL_ROOT}.progress`, { current: currentCount, total: references.length })}</span>
              <Button
                disabled={!allCurrent || gateLocked || pendingReferenceId !== null}
                onClick={actions.openBindings}
              >
                {t(`${PANEL_ROOT}.bindShots`)}
              </Button>
            </div>
          </div>
        </header>
        <StudioBlockerAlert messageKey={errorMessageKey} onRefreshRoutes={onRefreshRoutes} />
        <section className={styles.section} aria-labelledby='studio-reference-characters'>
          <header className={styles.sectionHeader}>
            <div className={styles.sectionTitleRow}>
              <h3 id='studio-reference-characters' ref={characterHeadingRef} tabIndex={-1}>
                {t(`${ROOT}.characters.title`)}
              </h3>
              <span>{t(`${PANEL_ROOT}.characterRule`)}</span>
              <Tooltip content={t(`${PANEL_ROOT}.addCharacterUnavailable`)}>
                <span>
                  <Button disabled>{t(`${PANEL_ROOT}.addCharacter`)}</Button>
                </span>
              </Tooltip>
            </div>
          </header>
          {characters.length === 0 ? (
            <Empty description={t(`${ROOT}.characters.empty`)} />
          ) : (
            <ul className={styles.grid}>{characters.map(renderCard)}</ul>
          )}
        </section>
        <section className={styles.section} aria-labelledby='studio-reference-backgrounds'>
          <header className={styles.sectionHeader}>
            <div className={styles.sectionTitleRow}>
              <h3 id='studio-reference-backgrounds' ref={backgroundHeadingRef} tabIndex={-1}>
                {t(`${PANEL_ROOT}.places`)}
              </h3>
              <span>{t(`${PANEL_ROOT}.placeRule`)}</span>
              <Button
                disabled={
                  gateLocked || pendingReferenceId !== null || references.length >= STUDIO_MAX_PROJECT_REFERENCES
                }
                onClick={() => setAddBackgroundOpen(true)}
              >
                {t(`${PANEL_ROOT}.addPlace`)}
              </Button>
            </div>
            {!charactersGenerated ? <p>{t(`${ROOT}.backgrounds.charactersRequired`)}</p> : null}
          </header>
          {backgrounds.length === 0 ? (
            <Empty description={t(`${ROOT}.backgrounds.empty`)} />
          ) : (
            <ul className={styles.grid}>{backgrounds.map(renderCard)}</ul>
          )}
        </section>
      </div>
      <Modal
        footer={null}
        title={t(`${ROOT}.backgrounds.addTitle`)}
        unmountOnExit={false}
        visible={addBackgroundOpen}
        onCancel={closeAddBackground}
      >
        <form
          className={styles.backgroundForm}
          onSubmit={(event) => {
            event.preventDefault();
            void submitBackground();
          }}
        >
          <label>
            <span>{t(`${ROOT}.backgrounds.nameLabel`)}</span>
            <Input
              autoFocus
              disabled={addingBackground}
              maxLength={STUDIO_MAX_REFERENCE_LABEL_LENGTH}
              value={backgroundLabel}
              onChange={setBackgroundLabel}
            />
          </label>
          <label>
            <span>{t(`${ROOT}.backgrounds.promptLabel`)}</span>
            <Input.TextArea
              autoSize={{ minRows: 4, maxRows: 10 }}
              disabled={addingBackground}
              maxLength={STUDIO_MAX_REFERENCE_PROMPT_LENGTH}
              value={backgroundPrompt}
              onChange={setBackgroundPrompt}
            />
          </label>
          {duplicateBackground ? <Alert type='error' content={t(`${ROOT}.backgrounds.duplicate`)} /> : null}
          <div className={styles.modalActions}>
            <Button disabled={addingBackground} onClick={closeAddBackground}>
              {t(`${ROOT}.backgrounds.cancel`)}
            </Button>
            <Button htmlType='submit' loading={addingBackground} type='primary' disabled={!maySubmitBackground}>
              {t(`${ROOT}.backgrounds.confirm`)}
            </Button>
          </div>
        </form>
      </Modal>
    </section>
  );
};
